"""Leitura e geração de arquivos para o plugin do Prisma (TXT, MD, CSV, PDF, DOCX, XLSX, HTML, BPMN).

Usa só bibliotecas que já vêm no container do Hermes: pypdf, python-docx, openpyxl, reportlab, lxml e markdown.
Nada aqui fala com a rede nem com o Prisma: o __init__.py decide quem pode ler o quê e para onde o arquivo vai.

Segurança:
- Leitura só de arquivos dentro do cache de documentos do Hermes (onde o adaptador do Discord grava os anexos
  recebidos na DM ou nos canais) — ver resolve_cached(). Nada de caminho arbitrário vindo do LLM.
- XML (BPMN, HTML) lido com lxml sem entidades externas nem rede (sem XXE).
- O texto extraído é dado, não instrução: quem chama marca isso na resposta ao LLM.
"""
from __future__ import annotations

import datetime as dt
import html as html_lib
import io
import os
import re
import uuid
from pathlib import Path

MAX_READ_BYTES = 20 * 1024 * 1024
MAX_XLSX_ROWS = 500
MAX_XLSX_COLS = 50
READ_EXT = {".txt", ".md", ".markdown", ".csv", ".pdf", ".docx", ".xlsx", ".html", ".htm", ".bpmn", ".xml"}
WRITE_FORMATS = ("txt", "md", "html", "docx", "pdf", "xlsx", "bpmn")
MIME = {
    "txt": "text/plain", "md": "text/markdown", "html": "text/html", "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "bpmn": "application/xml",
}


class FileError(Exception):
    """Erro com mensagem em pt-BR, segura para devolver ao LLM."""


def doc_dir() -> Path:
    return Path(os.environ.get("HERMES_HOME", "/opt/data")) / "cache" / "documents"


# --- caminhos ----------------------------------------------------------------------------------------------

def resolve_cached(raw: str) -> Path:
    """Aceita só arquivos regulares dentro do cache de documentos do Hermes."""
    if not isinstance(raw, str) or not raw.strip():
        raise FileError("Informe o caminho do arquivo recebido na conversa.")
    base = doc_dir().resolve()
    p = Path(raw.strip())
    if not p.is_absolute():
        p = base / p.name
    if p.is_symlink():
        raise FileError("Arquivo não permitido.")
    p = p.resolve()
    if not p.is_relative_to(base) or not p.is_file():
        raise FileError("Só leio arquivos enviados na conversa (anexos) ou gerados por mim.")
    if p.stat().st_size > MAX_READ_BYTES:
        raise FileError("Arquivo grande demais (limite de 20 MB).")
    return p


def display_name(p: Path) -> str:
    """Nome original: o Hermes grava como doc_<12 hex>_<nome>."""
    m = re.match(r"^doc_[0-9a-f]{12}_(.+)$", p.name)
    return m.group(1) if m else p.name


def safe_filename(name: str, fmt: str) -> str:
    stem = re.sub(r"[^\w.\- ]+", "_", (name or "").strip()).strip(" ._") or "arquivo"
    stem = re.sub(r"\.(txt|md|html?|docx|pdf|xlsx|bpmn|xml)$", "", stem, flags=re.I)[:80]
    return f"{stem}.{fmt}"


def save_generated(data: bytes, filename: str) -> Path:
    d = doc_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"doc_{uuid.uuid4().hex[:12]}_{filename}"
    p.write_bytes(data)
    return p


# --- leitura -----------------------------------------------------------------------------------------------

def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _safe_xml_parser():
    from lxml import etree
    return etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_comments=True)


def _pdf_text(p: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(p))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:  # noqa: BLE001
            raise FileError("O PDF está protegido por senha.")
    pages = []
    for i, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        pages.append(f"--- Página {i} ---\n{text}" if text else f"--- Página {i} --- (sem texto; pode ser imagem escaneada)")
    return "\n\n".join(pages)


def _docx_text(p: Path) -> str:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    d = docx.Document(str(p))
    out: list[str] = []
    for child in d.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, d)
            text = para.text.strip()
            if not text:
                continue
            style = (para.style.name if para.style is not None else "") or ""
            m = re.match(r"(?:Heading|Título)\s*(\d)", style, re.I)
            if m:
                out.append(f"{'#' * min(int(m.group(1)), 6)} {text}")
            elif re.match(r"(List|Lista)", style, re.I):
                out.append(f"- {text}")
            else:
                out.append(text)
        elif tag == "tbl":
            table = Table(child, d)
            rows = []
            for r in table.rows:
                cells = [c.text.strip().replace("\n", " ") for c in r.cells]
                rows.append("| " + " | ".join(cells) + " |")
            if rows:
                out.append("\n".join(rows))
    return "\n\n".join(out)


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%d/%m/%Y %H:%M") if (v.hour or v.minute) else v.strftime("%d/%m/%Y")
    if isinstance(v, dt.date):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).replace("\n", " ").strip()


def _xlsx_text(p: Path) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
    out: list[str] = []
    try:
        for ws in wb.worksheets:
            rows: list[str] = []
            cut = False
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= MAX_XLSX_ROWS:
                    cut = True
                    break
                cells = [_cell(v) for v in row[:MAX_XLSX_COLS]]
                while cells and not cells[-1]:
                    cells.pop()
                if cells:
                    rows.append("| " + " | ".join(cells) + " |")
            head = f"## Aba: {ws.title}"
            if cut:
                head += f" (primeiras {MAX_XLSX_ROWS} linhas)"
            out.append(head + "\n" + ("\n".join(rows) if rows else "(vazia)"))
    finally:
        wb.close()
    return "\n\n".join(out)


def _html_text(data: bytes) -> str:
    from lxml import html as lhtml
    doc = lhtml.document_fromstring(data)
    for bad in doc.xpath("//script|//style|//noscript|//template|//iframe|//object|//embed"):
        bad.drop_tree()
    lines: list[str] = []
    title = doc.findtext(".//title")
    if title and title.strip():
        lines.append(f"# {title.strip()}")
    for el in doc.body.iter() if doc.body is not None else []:
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.lower()
        if tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            lines.append(f"{'#' * int(tag[1])} {el.text_content().strip()}")
        elif tag in {"p", "li", "blockquote", "pre"}:
            text = re.sub(r"\s+", " ", el.text_content()).strip()
            if text:
                lines.append(("- " if tag == "li" else "") + text)
        elif tag == "tr":
            cells = [re.sub(r"\s+", " ", c.text_content()).strip() for c in el if isinstance(c.tag, str) and c.tag.lower() in {"td", "th"}]
            if any(cells):
                lines.append("| " + " | ".join(cells) + " |")
    if len(lines) <= 1:  # HTML sem estrutura: texto corrido
        lines.append(re.sub(r"\s+", " ", doc.text_content()).strip())
    return "\n".join(lines)


BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
_BPMN_KIND = {
    "startEvent": "Início", "endEvent": "Fim", "intermediateCatchEvent": "Evento intermediário",
    "intermediateThrowEvent": "Evento intermediário", "boundaryEvent": "Evento de borda",
    "task": "Tarefa", "userTask": "Tarefa de usuário", "serviceTask": "Tarefa de serviço",
    "manualTask": "Tarefa manual", "scriptTask": "Tarefa de script", "sendTask": "Envio", "receiveTask": "Recebimento",
    "businessRuleTask": "Regra de negócio", "subProcess": "Subprocesso", "callActivity": "Atividade de chamada",
    "exclusiveGateway": "Gateway exclusivo", "parallelGateway": "Gateway paralelo",
    "inclusiveGateway": "Gateway inclusivo", "eventBasedGateway": "Gateway baseado em evento",
}


def _bpmn_text(data: bytes) -> str:
    from lxml import etree
    root = etree.fromstring(data, parser=_safe_xml_parser())
    ns = {"b": BPMN_NS}
    if etree.QName(root).namespace != BPMN_NS:
        raise FileError("O arquivo não é um BPMN 2.0 (namespace OMG ausente).")
    out: list[str] = []
    names: dict[str, str] = {}
    for el in root.iter():
        if isinstance(el.tag, str) and el.get("id"):
            names[el.get("id")] = (el.get("name") or "").strip() or el.get("id")
    for part in root.findall(".//b:participant", ns):
        out.append(f"Participante (pool): {names.get(part.get('id'))}")
    for proc in root.findall("b:process", ns):
        out.append(f"\n# Processo: {proc.get('name') or proc.get('id')}")
        lane_of: dict[str, str] = {}
        lanes = proc.findall(".//b:lane", ns)
        for lane in lanes:
            for ref in lane.findall("b:flowNodeRef", ns):
                lane_of[(ref.text or "").strip()] = lane.get("name") or lane.get("id")
        if lanes:
            out.append("Raias: " + ", ".join(l.get("name") or l.get("id") for l in lanes))
        out.append("\n## Elementos")
        for el in proc.iter():
            if not isinstance(el.tag, str):
                continue
            local = etree.QName(el).localname
            if local in _BPMN_KIND and el.get("id"):
                lane = lane_of.get(el.get("id"))
                out.append(f"- [{_BPMN_KIND[local]}] {names[el.get('id')]}" + (f" (raia: {lane})" if lane else ""))
        flows = proc.findall(".//b:sequenceFlow", ns)
        if flows:
            out.append("\n## Fluxos")
            for f in flows:
                label = f" [{f.get('name')}]" if f.get("name") else ""
                out.append(f"- {names.get(f.get('sourceRef'), '?')} → {names.get(f.get('targetRef'), '?')}{label}")
        notes = [(" ".join(t.itertext())).strip() for t in proc.findall(".//b:textAnnotation/b:text", ns)]
        if any(notes):
            out.append("\n## Anotações")
            out.extend(f"- {n}" for n in notes if n)
    return "\n".join(out).strip()


def extract_text(p: Path) -> tuple[str, str]:
    """Devolve (tipo, texto). Levanta FileError com mensagem amigável."""
    ext = p.suffix.lower()
    if ext not in READ_EXT:
        raise FileError("Formato não suportado. Leio TXT, MD, CSV, PDF, DOCX, XLSX, HTML e BPMN.")
    try:
        if ext == ".pdf":
            return "pdf", _pdf_text(p)
        if ext == ".docx":
            return "docx", _docx_text(p)
        if ext == ".xlsx":
            return "xlsx", _xlsx_text(p)
        data = p.read_bytes()
        if ext in {".html", ".htm"}:
            return "html", _html_text(data)
        if ext == ".bpmn" or (ext == ".xml" and b"BPMN/20100524/MODEL" in data[:4000]):
            return "bpmn", _bpmn_text(data)
        return ext.lstrip("."), _decode(data)
    except FileError:
        raise
    except Exception as e:  # noqa: BLE001
        raise FileError(f"Não consegui ler o arquivo ({type(e).__name__}). Ele pode estar corrompido.") from e


# --- Markdown simples (base de TXT, DOCX e PDF) ------------------------------------------------------------
# Blocos: título (#), item (- * •), item numerado (1.), tabela (| a | b |), parágrafo e linha em branco.
# Inline: **negrito**, *itálico*, `código`.

def md_blocks(md: str) -> list[tuple]:
    blocks: list[tuple] = []
    para: list[str] = []
    table: list[list[str]] = []

    def flush():
        nonlocal para, table
        if para:
            blocks.append(("p", " ".join(s.strip() for s in para)))
            para = []
        if table:
            blocks.append(("table", table))
            table = []

    for raw in (md or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        s = line.strip()
        if s.startswith("|") and s.endswith("|") and len(s) > 1:
            if para:
                blocks.append(("p", " ".join(para)))
                para = []
            cells = [c.strip() for c in s[1:-1].split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                table.append(cells)
            continue
        if table:
            flush()
        if not s:
            flush()
            continue
        if m := re.match(r"^(#{1,6})\s+(.*)$", s):
            flush()
            blocks.append(("h", len(m.group(1)), m.group(2).strip()))
        elif m := re.match(r"^[-*•]\s+(.*)$", s):
            flush()
            blocks.append(("li", m.group(1)))
        elif m := re.match(r"^(\d+)[.)]\s+(.*)$", s):
            flush()
            blocks.append(("ol", m.group(1), m.group(2)))
        elif re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
            flush()
            blocks.append(("hr",))
        else:
            para.append(s)
    flush()
    return blocks


_INLINE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|`[^`]+`)")


def inline_runs(text: str) -> list[tuple[str, str]]:
    """[(estilo, texto)] com estilo em {'', 'b', 'i', 'code'}."""
    runs: list[tuple[str, str]] = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if (part.startswith("**") and part.endswith("**")) or (part.startswith("__") and part.endswith("__")):
            runs.append(("b", part[2:-2]))
        elif part.startswith("`") and part.endswith("`"):
            runs.append(("code", part[1:-1]))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            runs.append(("i", part[1:-1]))
        else:
            runs.append(("", part))
    return runs


def plain(text: str) -> str:
    return "".join(t for _, t in inline_runs(text))


# --- geração -----------------------------------------------------------------------------------------------

def make_txt(md: str, title: str = "") -> bytes:
    lines: list[str] = []
    if title:
        lines += [title, "=" * len(title), ""]
    for b in md_blocks(md):
        if b[0] == "h":
            t = plain(b[2])
            lines += ["", t, ("=" if b[1] == 1 else "-") * len(t)]
        elif b[0] == "li":
            lines.append(f"  • {plain(b[1])}")
        elif b[0] == "ol":
            lines.append(f"  {b[1]}. {plain(b[2])}")
        elif b[0] == "table":
            widths = [max(len(plain(r[i])) if i < len(r) else 0 for r in b[1]) for i in range(max(len(r) for r in b[1]))]
            for r in b[1]:
                lines.append("  ".join(plain(r[i] if i < len(r) else "").ljust(widths[i]) for i in range(len(widths))).rstrip())
            lines.append("")
        elif b[0] == "hr":
            lines.append("-" * 40)
        else:
            lines += [plain(b[1]), ""]
    return ("\r\n".join(lines).strip() + "\r\n").encode("utf-8-sig")


_HTML_CSS = """
body{font-family:"Red Hat Display",system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2430;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.55}
h1,h2,h3{line-height:1.25;color:#2b2f6b}h1{font-size:1.8rem}h2{font-size:1.35rem;margin-top:2rem}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.95rem}th,td{border:1px solid #d6d8e0;padding:.4rem .6rem;text-align:left;vertical-align:top}
th{background:#f1f2f7}code{background:#f1f2f7;padding:0 .25rem;border-radius:4px}hr{border:0;border-top:1px solid #d6d8e0;margin:2rem 0}
footer{margin-top:3rem;font-size:.8rem;color:#6b7080}
"""


def make_html(md: str, title: str = "") -> bytes:
    import markdown
    body = markdown.markdown(md or "", extensions=["tables", "sane_lists"], output_format="html")
    # Markdown aceita HTML cru: remove script/iframe/handlers para o arquivo gerado não executar nada.
    body = re.sub(r"<(script|iframe|object|embed|style)\b.*?</\1\s*>", "", body, flags=re.I | re.S)
    body = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", body, flags=re.I)
    body = re.sub(r"(href|src)\s*=\s*([\"'])\s*javascript:[^\"']*\2", r'\1="#"', body, flags=re.I)
    t = html_lib.escape(title or "Documento")
    head_title = f"<h1>{t}</h1>\n" if title and not re.match(r"^\s*#\s", md or "") else ""
    page = (
        "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{t}</title>\n<style>{_HTML_CSS}</style>\n</head>\n<body>\n{head_title}{body}\n"
        f"<footer>Gerado pelo Prisma em {dt.datetime.now().strftime('%d/%m/%Y')}.</footer>\n</body>\n</html>\n"
    )
    return page.encode("utf-8")


# Papel timbrado oficial da Ambiente (FOR-AMBT-06): logo no cabeçalho, barra de contatos no rodapé, A4 com as
# margens do modelo. O documento parte do próprio .docx do modelo e só o corpo é trocado; cabeçalho, rodapé,
# imagens, fontes embutidas, estilos e a seção (sectPr) ficam como estão. Atualizar o timbre = trocar o arquivo.
TIMBRADO_DOCX = Path(__file__).resolve().parent / "assets" / "FOR-AMBT-06_Modelo_timbrado_Ambiente.docx"
DOCX_MODELOS = ("simples", "timbrado")


def _docx_timbrado(title: str):
    import docx
    from docx.oxml.ns import qn

    if not TIMBRADO_DOCX.is_file():
        raise FileError("O modelo timbrado não está instalado no plugin. Gere o docx simples.")
    d = docx.Document(str(TIMBRADO_DOCX))
    body = d.element.body
    for el in list(body):
        if el.tag != qn("w:sectPr"):
            body.remove(el)
    # Metadados do modelo (autor, revisão, datas) não passam para o documento gerado.
    cp = d.core_properties
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None, microsecond=0)
    cp.author, cp.last_modified_by, cp.title = "Ambiente Consultoria", "Prisma", title or ""
    cp.subject = cp.keywords = cp.comments = cp.category = ""
    cp.revision, cp.created, cp.modified = 1, now, now
    return d


def make_docx(md: str, title: str = "", modelo: str = "simples") -> bytes:
    import docx
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, Twips

    timbrado = modelo == "timbrado"
    if timbrado:
        d = _docx_timbrado(title)
    else:
        d = docx.Document()
        d.styles["Normal"].font.name = "Calibri"
        d.styles["Normal"].font.size = Pt(11)
    if title:
        d.add_heading(title, level=0)

    def add_runs(par, text: str):
        for style, t in inline_runs(text):
            r = par.add_run(t)
            r.bold = style == "b"
            r.italic = style == "i"
            if style == "code":
                r.font.name = "Consolas"

    def list_item(marker: str, text: str):
        # O modelo timbrado não tem os estilos List Bullet/List Number: marcador e recuo pendente no próprio
        # parágrafo, como na skill requisitos-sefic (recuo 720, pendente 360 twips).
        par = d.add_paragraph()
        pf = par.paragraph_format
        pf.left_indent, pf.first_line_indent, pf.space_after = Twips(720), Twips(-360), Pt(4)
        pf.tab_stops.add_tab_stop(Twips(720))
        par.add_run(f"{marker}\t")
        add_runs(par, text)

    for b in md_blocks(md):
        if b[0] == "h":
            add_runs(d.add_heading(level=min(b[1], 4)), b[2])
        elif b[0] == "li":
            if timbrado:
                list_item("•", b[1])
            else:
                add_runs(d.add_paragraph(style="List Bullet"), b[1])
        elif b[0] == "ol":
            if timbrado:
                list_item(f"{b[1]}.", b[2])
            else:
                add_runs(d.add_paragraph(style="List Number"), b[2])
        elif b[0] == "table":
            rows = b[1]
            ncols = max(len(r) for r in rows)
            t = d.add_table(rows=len(rows), cols=ncols)
            t.style = "Table Grid"
            for i, r in enumerate(rows):
                for j in range(ncols):
                    cell = t.cell(i, j)
                    cell.text = ""
                    add_runs(cell.paragraphs[0], r[j] if j < len(r) else "")
                    if i == 0:
                        for run in cell.paragraphs[0].runs:
                            run.bold = True
                        if timbrado:
                            shd = OxmlElement("w:shd")
                            shd.set(qn("w:val"), "clear")
                            shd.set(qn("w:color"), "auto")
                            shd.set(qn("w:fill"), "D9D9D9")
                            cell._tc.get_or_add_tcPr().append(shd)
            if timbrado and len(rows) > 1:
                # Cabeçalho da tabela repete em cada página.
                t.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
            d.add_paragraph()
        elif b[0] == "hr":
            d.add_paragraph("―" * 30)
        else:
            add_runs(d.add_paragraph(), b[1])
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def make_pdf(md: str, title: str = "") -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import HRFlowable, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontName="Helvetica", fontSize=10.5, leading=14)
    cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=11.5)
    heads = {1: ss["Heading1"], 2: ss["Heading2"], 3: ss["Heading3"]}

    def rich(text: str) -> str:
        out = []
        for style, t in inline_runs(text):
            t = html_lib.escape(t)
            out.append({"b": f"<b>{t}</b>", "i": f"<i>{t}</i>", "code": f'<font face="Courier">{t}</font>'}.get(style, t))
        return "".join(out)

    story = []
    if title:
        story += [Paragraph(html_lib.escape(title), ss["Title"]), Spacer(1, 6)]
    pending_list: list = []

    def flush_list():
        nonlocal pending_list
        if pending_list:
            kind = pending_list[0][0]
            items = [ListItem(Paragraph(rich(t), body), leftIndent=12) for _, t in pending_list]
            if kind == "ol":
                story.append(ListFlowable(items, bulletType="1", start="1", leftIndent=14))
            else:
                story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=14))
            story.append(Spacer(1, 4))
            pending_list = []

    for b in md_blocks(md):
        if b[0] in {"li", "ol"}:
            if pending_list and pending_list[0][0] != b[0]:
                flush_list()
            pending_list.append((b[0], b[1] if b[0] == "li" else b[2]))
            continue
        flush_list()
        if b[0] == "h":
            story.append(Paragraph(rich(b[2]), heads.get(b[1], ss["Heading4"])))
        elif b[0] == "table":
            rows = b[1]
            ncols = max(len(r) for r in rows)
            data = [[Paragraph(rich(r[j] if j < len(r) else ""), cell) for j in range(ncols)] for r in rows]
            width = (A4[0] - 4 * cm) / ncols
            t = Table(data, colWidths=[width] * ncols, repeatRows=1)
            t.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c9ccd6")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef0f6")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story += [Spacer(1, 4), t, Spacer(1, 8)]
        elif b[0] == "hr":
            story.append(HRFlowable(width="100%", color=colors.HexColor("#c9ccd6")))
        else:
            story.append(Paragraph(rich(b[1]), body))
    flush_list()

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#6b7080"))
        canvas.drawString(2 * cm, 1.2 * cm, f"Prisma · {dt.datetime.now().strftime('%d/%m/%Y')}")
        canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Página {doc.page}")
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title=title or "Documento", author="Prisma")
    doc.build(story or [Paragraph("(vazio)", body)], onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


_DATE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATE_BR = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def _xlsx_value(v):
    if isinstance(v, str):
        s = v.strip()
        try:
            if _DATE_ISO.match(s):
                return dt.date.fromisoformat(s)
            if _DATE_BR.match(s):
                d, m, y = s.split("/")
                return dt.date(int(y), int(m), int(d))
        except ValueError:
            return v
        if s[:1] in "=+-@":  # sem fórmulas vindas de texto (injeção de fórmula)
            return "'" + s
        return v
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    return str(v)


def make_xlsx(tabela: dict) -> bytes:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    abas = (tabela or {}).get("abas") if isinstance(tabela, dict) else None
    if not isinstance(abas, list) or not abas:
        raise FileError('Para XLSX, envie tabela = {"abas": [{"nome", "colunas", "linhas"}]}.')
    if len(abas) > 20:
        raise FileError("No máximo 20 abas.")
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    used: set[str] = set()
    for i, aba in enumerate(abas, 1):
        if not isinstance(aba, dict):
            raise FileError("Cada aba precisa ser um objeto com nome, colunas e linhas.")
        name = re.sub(r"[\[\]:*?/\\]", "-", str(aba.get("nome") or f"Aba {i}"))[:31] or f"Aba {i}"
        while name in used:
            name = f"{name[:28]}-{i}"
        used.add(name)
        ws = wb.create_sheet(name)
        cols = [str(c) for c in (aba.get("colunas") or [])]
        rows = aba.get("linhas") or []
        if not isinstance(rows, list) or len(rows) > 20000:
            raise FileError("Cada aba aceita até 20 mil linhas.")
        if cols:
            ws.append(cols)
            for c in ws[1]:
                c.font = Font(bold=True)
                c.fill = PatternFill("solid", fgColor="EEF0F6")
                c.alignment = Alignment(vertical="top", wrap_text=True)
        for r in rows:
            ws.append([_xlsx_value(v) for v in (r if isinstance(r, list) else [r])])
        widths: dict[int, int] = {}
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, dt.date):
                    c.number_format = "DD/MM/YYYY"
                    n = 10
                else:
                    n = len(str(c.value)) if c.value is not None else 0
                widths[c.column] = max(widths.get(c.column, 0), min(n, 60))
        for col, w in widths.items():
            ws.column_dimensions[get_column_letter(col)].width = max(8, w + 2)
        if cols:
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --- BPMN 2.0 com diagrama (DI) e layout automático --------------------------------------------------------
# Padrão Ambiente: uma pool (participante) com uma raia por ator; fluxo da esquerda para a direita.

_BPMN_TYPES = {
    "inicio": ("startEvent", 36, 36), "fim": ("endEvent", 36, 36), "tarefa": ("task", 110, 70),
    "gateway": ("exclusiveGateway", 50, 50), "paralelo": ("parallelGateway", 50, 50),
    "evento": ("intermediateThrowEvent", 36, 36), "subprocesso": ("subProcess", 110, 70),
}
_COL_W = 170
_ROW_H = 110
_LANE_X = 30
_LANE_LABEL = 30
_POOL_LABEL = 30


def _xml_id(raw: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]", "_", raw or "id")
    if not re.match(r"[A-Za-z_]", base):
        base = "id_" + base
    out, n = base, 2
    while out in used:
        out, n = f"{base}_{n}", n + 1
    used.add(out)
    return out


def make_bpmn(processo: dict) -> bytes:
    from xml.sax.saxutils import quoteattr

    if not isinstance(processo, dict):
        raise FileError("Para BPMN, envie processo = {nome, raias, elementos, fluxos}.")
    nome = str(processo.get("nome") or "Processo")[:200]
    raias = [str(r)[:120] for r in (processo.get("raias") or []) if str(r).strip()] or ["Processo"]
    elementos = processo.get("elementos") or []
    fluxos = processo.get("fluxos") or []
    if not isinstance(elementos, list) or not elementos:
        raise FileError("Informe ao menos um elemento (inicio, tarefa, gateway, fim).")
    if len(elementos) > 300 or len(fluxos) > 600:
        raise FileError("Processo grande demais (até 300 elementos e 600 fluxos).")

    used: set[str] = {"Definitions_1", "Collaboration_1", "Participant_1", "Process_1", "LaneSet_1", "Diagram_1", "Plane_1"}
    nodes: dict[str, dict] = {}
    order: list[str] = []
    for e in elementos:
        if not isinstance(e, dict):
            raise FileError("Cada elemento precisa ser um objeto {id, tipo, nome, raia}.")
        key = str(e.get("id") or "").strip()
        if not key or key in nodes:
            raise FileError(f"Elemento sem id ou com id repetido: {key or '(vazio)'}.")
        tipo = str(e.get("tipo") or "tarefa").lower()
        if tipo not in _BPMN_TYPES:
            raise FileError(f"Tipo '{tipo}' inválido. Use: {', '.join(_BPMN_TYPES)}.")
        raia = str(e.get("raia") or raias[0])
        if raia not in raias:
            raias.append(raia[:120])
        nodes[key] = {"xid": _xml_id(key, used), "tipo": tipo, "nome": str(e.get("nome") or "")[:300], "raia": raia,
                      "in": [], "out": []}
        order.append(key)

    flows = []
    for i, f in enumerate(fluxos, 1):
        if not isinstance(f, dict):
            raise FileError("Cada fluxo precisa ser um objeto {de, para, rotulo}.")
        a, b = str(f.get("de") or ""), str(f.get("para") or "")
        if a not in nodes or b not in nodes:
            raise FileError(f"Fluxo {i} liga elementos inexistentes ({a or '?'} → {b or '?'}).")
        fid = _xml_id(f"Flow_{i}", used)
        flows.append({"id": fid, "de": a, "para": b, "rotulo": str(f.get("rotulo") or "")[:120]})
        nodes[a]["out"].append(fid)
        nodes[b]["in"].append(fid)

    # Colunas: caminho mais longo a partir das origens, ignorando arestas de retorno (DFS).
    succ: dict[str, list[str]] = {k: [] for k in nodes}
    for f in flows:
        succ[f["de"]].append(f["para"])
    back: set[tuple[str, str]] = set()
    state: dict[str, int] = {}

    def dfs(u: str):
        state[u] = 1
        for v in succ[u]:
            if state.get(v) == 1:
                back.add((u, v))
            elif v not in state:
                dfs(v)
        state[u] = 2

    starts = [k for k in order if nodes[k]["tipo"] == "inicio"] + [k for k in order if not nodes[k]["in"]]
    for k in starts + order:
        if k not in state:
            dfs(k)
    col = {k: 0 for k in nodes}
    for _ in range(len(nodes)):
        changed = False
        for f in flows:
            if (f["de"], f["para"]) in back:
                continue
            if col[f["para"]] < col[f["de"]] + 1:
                col[f["para"]] = col[f["de"]] + 1
                changed = True
        if not changed:
            break

    # Linhas dentro de cada raia: elementos na mesma raia e coluna são empilhados.
    slot: dict[str, int] = {}
    depth: dict[str, int] = {r: 1 for r in raias}
    taken: dict[tuple[str, int], int] = {}
    for k in order:
        key = (nodes[k]["raia"], col[k])
        slot[k] = taken.get(key, 0)
        taken[key] = slot[k] + 1
        depth[nodes[k]["raia"]] = max(depth[nodes[k]["raia"]], taken[key])
    lane_y: dict[str, int] = {}
    y = 40
    for r in raias:
        lane_y[r] = y
        y += depth[r] * _ROW_H + 20
    pool_h = y - 40
    max_col = max(col.values()) if col else 0
    pool_w = _POOL_LABEL + _LANE_LABEL + 60 + (max_col + 1) * _COL_W
    x0 = _LANE_X + _POOL_LABEL + _LANE_LABEL + 40

    bounds: dict[str, tuple[int, int, int, int]] = {}
    for k in order:
        n = nodes[k]
        _, w, h = _BPMN_TYPES[n["tipo"]]
        cx = x0 + col[k] * _COL_W + 55
        cy = lane_y[n["raia"]] + 10 + slot[k] * _ROW_H + _ROW_H // 2
        bounds[k] = (cx - w // 2, cy - h // 2, w, h)

    def a(v: str) -> str:
        return quoteattr(v)

    proc: list[str] = []
    proc.append('    <bpmn:laneSet id="LaneSet_1">')
    lane_ids = {r: _xml_id(f"Lane_{i}", used) for i, r in enumerate(raias, 1)}
    for r in raias:
        proc.append(f"      <bpmn:lane id={a(lane_ids[r])} name={a(r)}>")
        proc += [f"        <bpmn:flowNodeRef>{nodes[k]['xid']}</bpmn:flowNodeRef>" for k in order if nodes[k]["raia"] == r]
        proc.append("      </bpmn:lane>")
    proc.append("    </bpmn:laneSet>")
    for k in order:
        n = nodes[k]
        tag = _BPMN_TYPES[n["tipo"]][0]
        inner = [f"      <bpmn:incoming>{fid}</bpmn:incoming>" for fid in n["in"]]
        inner += [f"      <bpmn:outgoing>{fid}</bpmn:outgoing>" for fid in n["out"]]
        if inner:
            proc.append(f"    <bpmn:{tag} id={a(n['xid'])} name={a(n['nome'])}>")
            proc += inner
            proc.append(f"    </bpmn:{tag}>")
        else:
            proc.append(f"    <bpmn:{tag} id={a(n['xid'])} name={a(n['nome'])} />")
    for f in flows:
        name = f" name={a(f['rotulo'])}" if f["rotulo"] else ""
        proc.append(f"    <bpmn:sequenceFlow id={a(f['id'])}{name} sourceRef={a(nodes[f['de']]['xid'])} "
                    f"targetRef={a(nodes[f['para']]['xid'])} />")

    di: list[str] = []
    di.append(f'      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">'
              f'<dc:Bounds x="{_LANE_X}" y="40" width="{pool_w}" height="{pool_h}" /></bpmndi:BPMNShape>')
    for r in raias:
        h = depth[r] * _ROW_H + 20
        di.append(f'      <bpmndi:BPMNShape id="{lane_ids[r]}_di" bpmnElement="{lane_ids[r]}" isHorizontal="true">'
                  f'<dc:Bounds x="{_LANE_X + _POOL_LABEL}" y="{lane_y[r]}" width="{pool_w - _POOL_LABEL}" height="{h}" />'
                  f"</bpmndi:BPMNShape>")
    for k in order:
        x, y_, w, h = bounds[k]
        extra = ' isMarkerVisible="true"' if nodes[k]["tipo"] == "gateway" else ""
        di.append(f'      <bpmndi:BPMNShape id="{nodes[k]["xid"]}_di" bpmnElement="{nodes[k]["xid"]}"{extra}>'
                  f'<dc:Bounds x="{x}" y="{y_}" width="{w}" height="{h}" /></bpmndi:BPMNShape>')
    bottom = 40 + pool_h - 12
    for f in flows:
        sx, sy, sw, sh = bounds[f["de"]]
        tx, ty, tw, th = bounds[f["para"]]
        if col[f["para"]] > col[f["de"]]:  # para frente: sai pela direita, entra pela esquerda (cotovelo)
            p1 = (sx + sw, sy + sh // 2)
            p4 = (tx, ty + th // 2)
            mx = (p1[0] + p4[0]) // 2
            pts = [p1, (mx, p1[1]), (mx, p4[1]), p4] if p1[1] != p4[1] else [p1, p4]
        elif col[f["para"]] == col[f["de"]]:  # mesma coluna: vertical
            down = ty > sy
            pts = [(sx + sw // 2, sy + sh if down else sy), (tx + tw // 2, ty if down else ty + th)]
        else:  # retorno: por baixo da pool
            pts = [(sx + sw // 2, sy + sh), (sx + sw // 2, bottom), (tx + tw // 2, bottom), (tx + tw // 2, ty + th)]
        wp = "".join(f'<di:waypoint x="{px}" y="{py}" />' for px, py in pts)
        label = ""
        if f["rotulo"]:
            lx, ly = pts[0][0] + 6, pts[0][1] - 20
            label = f'<bpmndi:BPMNLabel><dc:Bounds x="{lx}" y="{ly}" width="60" height="14" /></bpmndi:BPMNLabel>'
        di.append(f'      <bpmndi:BPMNEdge id="{f["id"]}_di" bpmnElement="{f["id"]}">{wp}{label}</bpmndi:BPMNEdge>')

    xml = "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
        'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
        'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" '
        'targetNamespace="http://bpmn.io/schema/bpmn" exporter="Prisma" exporterVersion="1.0">',
        '  <bpmn:collaboration id="Collaboration_1">',
        f'    <bpmn:participant id="Participant_1" name={a(nome)} processRef="Process_1" />',
        "  </bpmn:collaboration>",
        f'  <bpmn:process id="Process_1" name={a(nome)} isExecutable="false">',
        *proc,
        "  </bpmn:process>",
        '  <bpmndi:BPMNDiagram id="Diagram_1">',
        '    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collaboration_1">',
        *di,
        "    </bpmndi:BPMNPlane>",
        "  </bpmndi:BPMNDiagram>",
        "</bpmn:definitions>",
        "",
    ])
    return xml.encode("utf-8")


def generate(fmt: str, title: str, conteudo: str | None, tabela: dict | None, processo: dict | None,
             modelo: str | None = None) -> bytes:
    fmt = (fmt or "").lower().lstrip(".")
    if fmt not in WRITE_FORMATS:
        raise FileError(f"Formato inválido. Use: {', '.join(WRITE_FORMATS)}.")
    modelo = (modelo or "simples").strip().lower()
    if modelo not in DOCX_MODELOS:
        raise FileError(f"Modelo inválido. Use: {', '.join(DOCX_MODELOS)}.")
    if modelo == "timbrado" and fmt != "docx":
        raise FileError("O modelo timbrado só existe para docx. Gere em docx ou tire o modelo.")
    if fmt == "xlsx":
        return make_xlsx(tabela or {})
    if fmt == "bpmn":
        return make_bpmn(processo or {})
    md = conteudo or ""
    if not md.strip():
        raise FileError("Informe o conteudo (em Markdown) do documento.")
    if len(md) > 500_000:
        raise FileError("Conteúdo grande demais (até 500 mil caracteres).")
    if fmt == "md":
        return ((f"# {title}\n\n" if title and not md.lstrip().startswith("#") else "") + md).encode("utf-8")
    if fmt == "docx":
        return make_docx(md, title, modelo)
    return {"txt": make_txt, "html": make_html, "pdf": make_pdf}[fmt](md, title)
