"""Leitura e geração de arquivos para o plugin do Prisma.

Lê texto (TXT, MD, CSV, JSON, legendas VTT/SRT; em UTF-8, UTF-16 ou Windows-1252), PDF, Word (DOCX/DOCM),
Excel (XLSX/XLSM), PowerPoint (PPTX), OpenDocument (ODT/ODS/ODP), RTF, e-mail (EML, com anexos), HTML, BPMN e
.zip (cada arquivo de dentro, inclusive .zip dentro de .zip). Gera TXT, MD, HTML, DOCX, PDF, XLSX e BPMN.

Usa só bibliotecas que já vêm no container do Hermes: pypdf, python-docx, openpyxl, python-pptx, reportlab, lxml
e markdown, mais a biblioteca padrão (zipfile, email).
Nada aqui fala com a rede nem com o Prisma: o __init__.py decide quem pode ler o quê e para onde o arquivo vai.

Segurança:
- Leitura só de arquivos dentro do cache de documentos do Hermes (onde o adaptador do Discord grava os anexos
  recebidos na DM ou nos canais) — ver resolve_cached(). Nada de caminho arbitrário vindo do LLM.
- XML (BPMN, HTML, Office, OpenDocument) lido com lxml sem entidades externas nem rede (sem XXE).
- .zip e pacotes do Office lidos em memória, nunca extraídos em disco, com limites de quantidade, tamanho,
  taxa de compressão e profundidade (contra bomba de compressão).
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
TEXT_EXT = {
    ".txt", ".text", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".jsonl", ".ndjson", ".yaml", ".yml",
    ".ini", ".cfg", ".toml", ".sql", ".vtt", ".srt",
}
READ_EXT = TEXT_EXT | {
    ".pdf", ".docx", ".docm", ".dotx", ".dotm", ".xlsx", ".xlsm", ".xltx", ".xltm", ".pptx", ".pptm",
    ".odt", ".ods", ".odp", ".rtf", ".eml", ".html", ".htm", ".xhtml", ".bpmn", ".xml", ".zip",
}
LEGACY = {".doc": ".docx", ".xls": ".xlsx", ".ppt": ".pptx", ".dot": ".docx", ".pps": ".pptx"}
OTHER_ARCHIVES = {".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".svg"}
MEDIA_EXT = {".mp3", ".m4a", ".ogg", ".opus", ".wav", ".webm", ".mp4", ".mov", ".avi", ".mkv"}
FORMATS_MSG = ("Leio TXT, MD, CSV, JSON, legendas (VTT/SRT), PDF, Word (DOCX), Excel (XLSX), PowerPoint (PPTX), "
               "OpenDocument (ODT/ODS/ODP), RTF, e-mail (EML), HTML, BPMN e .zip.")
# Pacotes: limites contra bomba de compressão e pacotes enormes.
ZIP_MAX_MEMBERS = 300  # arquivos lidos de um .zip
ZIP_MAX_TOTAL = 100 * 1024 * 1024  # soma descompactada lida de todos os .zip de um anexo
ZIP_MAX_RATIO = 200  # descompactado/compactado acima disso (em arquivo > 1 MB) é recusado
PACKAGE_MAX_BYTES = 200 * 1024 * 1024  # DOCX/XLSX/PPTX/ODF descompactados
MAX_NEST = 3  # .zip dentro de .zip (ou anexo de e-mail dentro de .zip...)
BUNDLE_MAX_CHARS = 1_000_000  # texto total extraído de um pacote
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
# Cada leitor recebe os bytes do arquivo (não o caminho): assim o mesmo código lê o anexo e os arquivos de
# dentro de um .zip ou de um e-mail, sem gravar nada em disco.

_BOMS = (
    (b"\xff\xfe\x00\x00", "utf-32-le"), (b"\x00\x00\xfe\xff", "utf-32-be"), (b"\xef\xbb\xbf", "utf-8"),
    (b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be"),
)


def _decode_raw(data: bytes) -> str:
    for bom, enc in _BOMS:
        if data.startswith(bom):
            return data[len(bom):].decode(enc, errors="replace")
    # UTF-16 sem BOM (Bloco de Notas, exportações do Teams/Word): metade dos bytes é zero.
    sample = data[:4000]
    if len(sample) >= 4:
        half = len(sample) / 2
        even, odd = sample[0::2].count(0), sample[1::2].count(0)
        if odd > half * 0.3 and even < half * 0.05:
            return data.decode("utf-16-le", errors="replace")
        if even > half * 0.3 and odd < half * 0.05:
            return data.decode("utf-16-be", errors="replace")
    for enc in ("utf-8", "cp1252"):  # UTF-8; senão Windows-1252 (Excel e Bloco de Notas em pt-BR)
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _decode(data: bytes) -> str:
    text = _decode_raw(data).replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\x00", "")


def _safe_xml_parser():
    from lxml import etree
    return etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False, remove_comments=True)


def _check_package(data: bytes) -> None:
    """DOCX, XLSX, PPTX e ODF são .zip por dentro: recusa pacote que descompactado passaria do limite."""
    import zipfile
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            total = sum(i.file_size for i in zf.infolist())
    except zipfile.BadZipFile:
        raise FileError("O arquivo está corrompido ou não é do formato indicado pela extensão.")
    if total > PACKAGE_MAX_BYTES:
        raise FileError("O arquivo descompactado é grande demais para ler.")


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
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


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _word_xml_text(data: bytes) -> str:
    """Plano B do Word (DOCM, DOTX ou DOCX que o python-docx recusa): texto direto do word/document.xml."""
    import zipfile
    from lxml import etree
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        root = etree.fromstring(zf.read("word/document.xml"), parser=_safe_xml_parser())
    w = f"{{{W_NS}}}"

    def para(p) -> str:
        parts = []
        for el in p.iter(f"{w}t", f"{w}tab", f"{w}br"):
            if el.tag == f"{w}t":
                parts.append(el.text or "")
            else:
                parts.append("\t" if el.tag == f"{w}tab" else "\n")
        return "".join(parts).strip()

    out: list[str] = []
    body = root.find(f"{w}body")
    for child in (body if body is not None else []):
        if child.tag == f"{w}p":
            if text := para(child):
                out.append(text)
        elif child.tag == f"{w}tbl":
            rows = []
            for tr in child.iter(f"{w}tr"):
                cells = [" ".join(para(p) for p in tc.iter(f"{w}p")).strip() for tc in tr.findall(f"{w}tc")]
                rows.append("| " + " | ".join(c.replace("\n", " ") for c in cells) + " |")
            if rows:
                out.append("\n".join(rows))
    return "\n\n".join(out)


def _docx_text(data: bytes) -> str:
    _check_package(data)
    try:
        import docx
        d = docx.Document(io.BytesIO(data))
    except Exception:  # noqa: BLE001 — DOCM/DOTX e DOCX fora do padrão
        return _word_xml_text(data)
    from docx.table import Table
    from docx.text.paragraph import Paragraph

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


def _sheet_md(title: str, rows: list[list[str]], cut: bool) -> str:
    lines = []
    for cells in rows:
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            lines.append("| " + " | ".join(c.replace("|", "/") for c in cells) + " |")
    head = f"## Aba: {title}" + (f" (primeiras {MAX_XLSX_ROWS} linhas)" if cut else "")
    return head + "\n" + ("\n".join(lines) if lines else "(vazia)")


def _xlsx_text(data: bytes) -> str:
    import openpyxl
    _check_package(data)
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out: list[str] = []
    try:
        for ws in wb.worksheets:
            rows: list[list[str]] = []
            cut = False
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= MAX_XLSX_ROWS:
                    cut = True
                    break
                rows.append([_cell(v) for v in row[:MAX_XLSX_COLS]])
            out.append(_sheet_md(ws.title, rows, cut))
    finally:
        wb.close()
    return "\n\n".join(out)


def _pptx_text(data: bytes) -> str:
    from pptx import Presentation
    _check_package(data)
    prs = Presentation(io.BytesIO(data))

    def shapes(group):
        for shape in group:
            if hasattr(shape, "shapes"):  # grupo de formas
                yield from shapes(shape.shapes)
            else:
                yield shape

    out: list[str] = []
    for i, slide in enumerate(prs.slides, 1):
        title_shape = slide.shapes.title
        title = title_shape.text_frame.text.strip() if title_shape is not None and title_shape.has_text_frame else ""
        lines: list[str] = []
        for shape in shapes(slide.shapes):
            if title_shape is not None and shape.shape_id == title_shape.shape_id:
                continue
            if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    text = (p.text or "").replace("\v", " ").strip()
                    if text:
                        lines.append(("  " * (p.level or 0)) + "- " + text)
            elif getattr(shape, "has_table", False) and shape.has_table:
                for r in shape.table.rows:
                    lines.append("| " + " | ".join(c.text.strip().replace("\n", " ") for c in r.cells) + " |")
        if slide.has_notes_slide:
            notes = (slide.notes_slide.notes_text_frame.text or "").strip() if slide.notes_slide.notes_text_frame else ""
            if notes:
                lines.append(f"Notas do apresentador: {notes}")
        head = f"--- Slide {i}" + (f": {title}" if title else "") + " ---"
        out.append(head + ("\n" + "\n".join(lines) if lines else ""))
    return "\n\n".join(out)


# OpenDocument (LibreOffice): o conteúdo fica no content.xml do pacote.
ODF = {
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "draw": "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    "presentation": "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
}


def _odf_root(data: bytes):
    import zipfile
    from lxml import etree
    _check_package(data)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return etree.fromstring(zf.read("content.xml"), parser=_safe_xml_parser())


def _odf_inline(el) -> str:
    """Texto de um text:p/text:h, com espaços (text:s), tabulação e quebra de linha; sem notas de rodapé."""
    from lxml import etree
    parts = [el.text or ""]
    for c in el:
        local = etree.QName(c).localname if isinstance(c.tag, str) else ""
        if local == "s":
            parts.append(" " * int(c.get(f"{{{ODF['text']}}}c") or 1))
        elif local == "tab":
            parts.append("\t")
        elif local == "line-break":
            parts.append("\n")
        elif local not in {"note", "annotation", ""}:
            parts.append(_odf_inline(c))
        parts.append(c.tail or "")
    return "".join(parts)


def _odf_cell(cell) -> str:
    t = f"{{{ODF['text']}}}"
    return " ".join(_odf_inline(p).strip() for p in cell.iter(f"{t}p", f"{t}h")).strip().replace("\n", " ")


def _odt_text(data: bytes) -> str:
    from lxml import etree
    root = _odf_root(data)
    t, tb = f"{{{ODF['text']}}}", f"{{{ODF['table']}}}"
    out: list[str] = []

    def walk(el, depth: int = 0):
        for c in el:
            if not isinstance(c.tag, str):
                continue
            if c.tag == f"{t}h":
                level = int(c.get(f"{t}outline-level") or 1)
                if text := _odf_inline(c).strip():
                    out.append(f"{'#' * min(level, 6)} {text}")
            elif c.tag == f"{t}p":
                if text := _odf_inline(c).strip():
                    out.append(("  " * (depth - 1) + "- " if depth else "") + text)
            elif c.tag == f"{t}list":
                for item in c:
                    walk(item, depth + 1)
            elif c.tag == f"{tb}table":
                rows = ["| " + " | ".join(_odf_cell(cell) for cell in r if etree.QName(cell).localname == "table-cell") + " |"
                        for r in c.iter(f"{tb}table-row")]
                if rows:
                    out.append("\n".join(rows))
            elif etree.QName(c).localname not in {"tracked-changes", "sequence-decls", "variable-decls"}:
                walk(c, depth)

    body = root.find(f"{{{ODF['office']}}}body")
    walk(body if body is not None else root)
    return "\n\n".join(out)


def _ods_text(data: bytes) -> str:
    root = _odf_root(data)
    tb = f"{{{ODF['table']}}}"
    out: list[str] = []
    for table in root.iter(f"{tb}table"):
        rows: list[list[str]] = []
        cut = False
        for r in table.iter(f"{tb}table-row"):
            cells: list[str] = []
            for cell in r:
                if not isinstance(cell.tag, str) or not cell.tag.endswith(("table-cell", "covered-table-cell")):
                    continue
                n = min(int(cell.get(f"{tb}number-columns-repeated") or 1), MAX_XLSX_COLS)
                cells.extend([_odf_cell(cell)] * n)
                if len(cells) >= MAX_XLSX_COLS:
                    break
            cells = cells[:MAX_XLSX_COLS]
            reps = int(r.get(f"{tb}number-rows-repeated") or 1)
            if not any(cells):  # linhas vazias repetidas (o LibreOffice grava milhares)
                continue
            for _ in range(min(reps, MAX_XLSX_ROWS)):
                if len(rows) >= MAX_XLSX_ROWS:
                    cut = True
                    break
                rows.append(list(cells))
            if cut:
                break
        out.append(_sheet_md(table.get(f"{tb}name") or "Planilha", rows, cut))
    return "\n\n".join(out)


def _odp_text(data: bytes) -> str:
    root = _odf_root(data)
    t, d, pr = f"{{{ODF['text']}}}", f"{{{ODF['draw']}}}", f"{{{ODF['presentation']}}}"
    out: list[str] = []
    for i, page in enumerate(root.iter(f"{d}page"), 1):
        notes = page.find(f"{pr}notes")
        lines = []
        for child in page:
            if child.tag == f"{pr}notes":
                continue
            for p in child.iter(f"{t}p", f"{t}h"):
                if text := _odf_inline(p).strip():
                    lines.append("- " + text)
        if notes is not None:
            note = " ".join(_odf_inline(p).strip() for p in notes.iter(f"{t}p")).strip()
            if note:
                lines.append(f"Notas do apresentador: {note}")
        out.append(f"--- Slide {i} ---" + ("\n" + "\n".join(lines) if lines else ""))
    return "\n\n".join(out)


# RTF: leitor mínimo (texto, acentos \'hh e \uN, parágrafos e tabelas), sem imagens, campos ocultos e tabelas
# de fonte/cor/estilo.
_RTF_SKIP = {
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "objdata", "fldinst", "header", "headerl",
    "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "listtable", "listoverridetable", "rsidtbl",
    "generator", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "filetbl",
    "revtbl", "pgdsctbl", "shppict", "nonshppict", "bkmkstart", "bkmkend", "xe", "tc", "footnote", "annotation",
    "atnid", "atnauthor", "atndate", "listtext", "pntext", "pntxta", "pntxtb", "mmathPr", "userprops",
}
_RTF_CHAR = {
    "par": "\n", "line": "\n", "sect": "\n\n", "page": "\n\n", "tab": "\t", "cell": " | ", "row": "\n",
    "emdash": "—", "endash": "–", "bullet": "•", "lquote": "‘", "rquote": "’", "ldblquote": "“", "rdblquote": "”",
    "emspace": " ", "enspace": " ", "qmspace": " ",
}
_RTF_TOKEN = re.compile(r"\\([a-zA-Z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-fA-F]{2})|\\(.)|([{}])|[\r\n]+|([^\\{}\r\n]+)", re.S)


def _rtf_text(data: bytes) -> str:
    import codecs
    s = data.decode("latin-1")
    if not s.lstrip().startswith("{\\rtf"):
        raise FileError("O arquivo não é um RTF válido.")
    enc = "cp1252"
    if m := re.search(r"\\ansicpg(\d+)", s[:4000]):
        try:
            enc = codecs.lookup(f"cp{m.group(1)}").name
        except LookupError:
            pass
    out: list[str] = []
    stack: list[tuple[int, bool]] = []
    uc, skip_dest, pending_skip = 1, False, 0
    for m in _RTF_TOKEN.finditer(s):
        word, arg, hexc, sym, brace, text = m.groups()
        if brace:
            pending_skip = 0
            if brace == "{":
                stack.append((uc, skip_dest))
            elif stack:
                uc, skip_dest = stack.pop()
        elif word:
            pending_skip = 0
            if word in _RTF_SKIP:
                skip_dest = True
            elif skip_dest:
                continue
            elif word in _RTF_CHAR:
                out.append(_RTF_CHAR[word])
            elif word == "uc":
                uc = int(arg or 1)
            elif word == "u" and arg:
                code = int(arg)
                out.append(chr(code + 65536 if code < 0 else code))
                pending_skip = uc
        elif hexc:
            if pending_skip:
                pending_skip -= 1
            elif not skip_dest:
                out.append(bytes([int(hexc, 16)]).decode(enc, errors="replace"))
        elif sym:
            pending_skip = 0
            if sym == "*":
                skip_dest = True
            elif skip_dest:
                continue
            elif sym in "\\{}":
                out.append(sym)
            elif sym == "~":
                out.append("\xa0")
            elif sym == "_":
                out.append("-")
            elif sym in "\r\n":
                out.append("\n")
        elif text:
            if pending_skip:  # caracteres de reserva depois de \uN
                n = min(pending_skip, len(text))
                text, pending_skip = text[n:], pending_skip - n
            if not skip_dest and text:
                out.append(text)
    result = "".join(out)
    result = re.sub(r"[ \t]+\n", "\n", result)
    return re.sub(r"\n{3,}", "\n\n", result).strip()


def _subtitle_text(text: str) -> str:
    """VTT/SRT (legendas e transcrições do Teams): tira numeração e tempos, junta falas seguidas do mesmo autor."""
    out: list[str] = []
    last_speaker = cue_speaker = None
    skipping_block = False
    raw_lines = text.split("\n")
    for i, raw in enumerate(raw_lines):
        s = raw.strip()
        if i + 1 < len(raw_lines) and "-->" in raw_lines[i + 1]:  # identificador da fala (número ou id do Teams)
            continue
        if not s:
            skipping_block = False
            continue
        if skipping_block or s.startswith(("WEBVTT", "Kind:", "Language:")):
            continue
        if s.startswith(("NOTE", "STYLE", "REGION")):
            skipping_block = True
            continue
        if "-->" in s:  # tempo: começa outra fala
            cue_speaker = None
            continue
        if s.isdigit():
            continue
        speaker = None
        if m := re.match(r"<v(?:\.[^\s>]*)?\s+([^>]+)>(.*)$", s):
            speaker, s = m.group(1).strip(), m.group(2)
        elif m := re.match(r"^([A-ZÀ-Ý][\w.'\- ]{1,40}):\s+(.+)$", s):
            speaker, s = m.group(1).strip(), m.group(2)
        speaker = speaker or cue_speaker  # fala de várias linhas continua com o mesmo autor
        cue_speaker = speaker
        s = html_lib.unescape(re.sub(r"<[^>]+>", "", s)).strip()
        if not s:
            continue
        if speaker:
            if speaker == last_speaker and out:
                out[-1] += " " + s
            else:
                out.append(f"{speaker}: {s}")
        elif out and last_speaker is None and not out[-1].endswith((".", "?", "!")):
            out[-1] += " " + s
        else:
            out.append(s)
        last_speaker = speaker
    return "\n".join(out)


def _html_text(data: bytes | str) -> str:
    from lxml import html as lhtml
    if isinstance(data, bytes) and data.startswith((b"\xff\xfe", b"\xfe\xff")):
        data = _decode(data)
    if isinstance(data, str):
        data = re.sub(r"^\s*<\?xml[^>]*\?>", "", data)  # lxml recusa str com declaração de codificação
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
        ann_ids = {ta.get("id") for ta in proc.findall(".//b:textAnnotation", ns)}
        linked: dict[str, str] = {}  # anotação -> etapa (a associação pode vir nos dois sentidos)
        for a in root.iter(f"{{{BPMN_NS}}}association"):
            s_, t_ = a.get("sourceRef"), a.get("targetRef")
            if t_ in ann_ids:
                linked[t_] = s_
            elif s_ in ann_ids:
                linked[s_] = t_
        notes = []
        for ta in proc.findall(".//b:textAnnotation", ns):
            text = " ".join(" ".join(t.itertext()) for t in ta.findall("b:text", ns)).strip()
            other = linked.get(ta.get("id"))
            if text:
                notes.append(text + (f" (etapa: {names[other]})" if other in names and other != ta.get("id") else ""))
        if notes:
            out.append("\n## Anotações")
            out.extend(f"- {n}" for n in notes)
    return "\n".join(out).strip()


def _eml_text(data: bytes, budget: dict) -> str:
    import email
    from email import policy
    msg = email.message_from_bytes(data, policy=policy.default)
    out: list[str] = []
    for header, label in (("From", "De"), ("To", "Para"), ("Cc", "Cc"), ("Date", "Data"), ("Subject", "Assunto")):
        if value := msg.get(header):
            out.append(f"{label}: {value}")
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is not None:
        content = body.get_content()
        if isinstance(content, bytes):
            content = _decode(content)
        text = _html_text(content) if body.get_content_type() == "text/html" else content
        out.append("\n" + text.replace("\r\n", "\n").strip())
    attachments = [(part.get_filename() or "anexo", part) for part in msg.iter_attachments()]
    if attachments:
        items = [(name, part.get_payload(decode=True) or b"") for name, part in attachments]
        out.append("\n" + _bundle_text(items, budget, "Anexos do e-mail"))
    return "\n".join(out).strip()


# --- pacotes (.zip) ----------------------------------------------------------------------------------------

def _zip_name(info) -> str:
    """Nome do arquivo no .zip: sem a marca UTF-8, o Windows grava na página de código OEM (cp850 no Brasil)."""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("cp850")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def _size(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB" if n >= 1024 * 1024 else f"{max(1, round(n / 1024))} KB"


def _bundle_text(items: list[tuple[str, bytes | None]], budget: dict, title: str, notes: dict | None = None) -> str:
    """Lista os arquivos e extrai o texto de cada um que dá para ler. items: (nome, bytes ou None se pulado)."""
    lines: list[str] = []
    sections: list[str] = []
    notes = notes or {}
    for name, data in items:
        if name in notes:
            lines.append(f"- {name} — não lido: {notes[name]}")
            continue
        size = f" ({_size(len(data))})" if data is not None else ""
        ext = Path(name).suffix.lower()
        if ext not in READ_EXT and not _sniff(data or b""):
            lines.append(f"- {name}{size} — não lido: {_unsupported(ext)}")
            continue
        if budget["chars"] <= 0:
            lines.append(f"- {name}{size} — não lido: limite de texto do pacote atingido")
            continue
        try:
            kind, text = _extract(ext, data or b"", budget["depth"] + 1, budget)
        except FileError as e:
            lines.append(f"- {name}{size} — não lido: {e}")
            continue
        text = text.strip()
        budget["chars"] -= len(text)
        lines.append(f"- {name}{size} — lido ({kind})")
        sections.append(f"=== Arquivo: {name} ===\n{text or '(sem texto)'}")
    head = f"## {title} ({len(items)} arquivo{'s' if len(items) != 1 else ''})\n" + "\n".join(lines)
    return head + ("\n\n" + "\n\n".join(sections) if sections else "")


def _zip_text(data: bytes, budget: dict) -> str:
    import zipfile
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise FileError("O .zip está corrompido.")
    items: list[tuple[str, bytes | None]] = []
    notes: dict[str, str] = {}
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        infos = [i for i in infos if not re.search(r"(^|/)(__MACOSX/|\._|\.DS_Store$|Thumbs\.db$|desktop\.ini$)", i.filename)]
        extra = len(infos) - ZIP_MAX_MEMBERS
        for info in infos[:ZIP_MAX_MEMBERS]:
            name = _zip_name(info)
            ext = Path(name).suffix.lower()
            reason = _unsupported(ext) if ext and ext not in READ_EXT else None  # sem extensão: tenta reconhecer
            if not reason and info.flag_bits & 0x1:
                reason = "protegido por senha"
            elif not reason and info.file_size > MAX_READ_BYTES:
                reason = f"grande demais ({_size(info.file_size)}; limite de 20 MB)"
            elif not reason and info.file_size > 1024 * 1024 and info.file_size > ZIP_MAX_RATIO * max(info.compress_size, 1):
                reason = "taxa de compressão suspeita"
            elif not reason and info.file_size > budget["bytes"]:
                reason = "limite de tamanho do pacote atingido"
            if reason:
                notes[name] = reason
                items.append((name, None))
                continue
            with zf.open(info) as f:
                content = f.read(MAX_READ_BYTES + 1)
            if len(content) > MAX_READ_BYTES:
                notes[name] = "grande demais (limite de 20 MB)"
                items.append((name, None))
                continue
            budget["bytes"] -= len(content)
            items.append((name, content))
    text = _bundle_text(items, budget, "Conteúdo do .zip", notes)
    if extra > 0:
        text = text.replace("\n", f"\n(mostrando os primeiros {ZIP_MAX_MEMBERS}; outros {extra} ficaram de fora)\n", 1)
    return text


# --- entrada única -----------------------------------------------------------------------------------------

def _unsupported(ext: str) -> str:
    if ext in LEGACY:
        return f"formato antigo ({ext}); abra no Office e salve como {LEGACY[ext]}"
    if ext in OTHER_ARCHIVES:
        return f"compactado em {ext}; envie em .zip"
    if ext in IMAGE_EXT:
        return "imagem (não leio imagens dentro de pacotes; envie a imagem direto na conversa)"
    if ext in MEDIA_EXT:
        return "áudio ou vídeo (envie como mensagem de voz para transcrever)"
    return f"formato {ext or 'sem extensão'} não suportado"


def _sniff(data: bytes) -> str:
    """Extensão provável de um arquivo sem extensão conhecida (anexo renomeado ou baixado sem nome)."""
    if data.startswith(b"%PDF-"):
        return ".pdf"
    if data.lstrip()[:5] == b"{\\rtf":
        return ".rtf"
    if data.startswith(b"PK\x03\x04"):
        import zipfile
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
                mimetype = zf.read("mimetype").decode("ascii", "ignore") if "mimetype" in names else ""
        except zipfile.BadZipFile:
            return ""
        if "word/document.xml" in names:
            return ".docx"
        if "xl/workbook.xml" in names:
            return ".xlsx"
        if "ppt/presentation.xml" in names:
            return ".pptx"
        for suffix, ext in (("text", ".odt"), ("spreadsheet", ".ods"), ("presentation", ".odp")):
            if mimetype.endswith(suffix):
                return ext
        return ".zip"
    return ""


def _extract(ext: str, data: bytes, depth: int = 0, budget: dict | None = None) -> tuple[str, str]:
    budget = budget if budget is not None else {"bytes": ZIP_MAX_TOTAL, "chars": BUNDLE_MAX_CHARS, "depth": 0}
    if depth > MAX_NEST:
        raise FileError("Arquivos compactados uns dentro dos outros em níveis demais.")
    if ext not in READ_EXT and (sniffed := _sniff(data)):
        ext = sniffed
    if ext not in READ_EXT:
        reason = _unsupported(ext)
        raise FileError(f"{reason[0].upper()}{reason[1:]}. {FORMATS_MSG}")
    outer_depth = budget["depth"]
    budget["depth"] = depth
    try:
        if ext == ".pdf":
            return "pdf", _pdf_text(data)
        if ext in {".docx", ".docm", ".dotx", ".dotm"}:
            return "docx", _docx_text(data)
        if ext in {".xlsx", ".xlsm", ".xltx", ".xltm"}:
            return "xlsx", _xlsx_text(data)
        if ext in {".pptx", ".pptm"}:
            return "pptx", _pptx_text(data)
        if ext == ".odt":
            return "odt", _odt_text(data)
        if ext == ".ods":
            return "ods", _ods_text(data)
        if ext == ".odp":
            return "odp", _odp_text(data)
        if ext == ".rtf":
            return "rtf", _rtf_text(data)
        if ext == ".eml":
            return "eml", _eml_text(data, budget)
        if ext == ".zip":
            return "zip", _zip_text(data, budget)
        if ext in {".html", ".htm", ".xhtml"}:
            return "html", _html_text(data)
        if ext == ".bpmn" or (ext == ".xml" and b"BPMN/20100524/MODEL" in data[:4000]):
            return "bpmn", _bpmn_text(data)
        if ext in {".vtt", ".srt"}:
            return ext.lstrip("."), _subtitle_text(_decode(data))
        return ext.lstrip("."), _decode(data)
    except FileError:
        raise
    except Exception as e:  # noqa: BLE001
        raise FileError(f"Não consegui ler o arquivo ({type(e).__name__}). Ele pode estar corrompido.") from e
    finally:
        budget["depth"] = outer_depth


def extract_text(p: Path) -> tuple[str, str]:
    """Devolve (tipo, texto). Levanta FileError com mensagem amigável."""
    return _extract(p.suffix.lower(), p.read_bytes())


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
# Visual (0.14.0): tarefas largas (200x80) para o texto caber, colunas com a largura do maior elemento,
# anotações de texto (campo `nota`, ex.: o detalhe de um GAP) ligadas à etapa por associação pontilhada,
# acima ou abaixo dela, e saídas de gateway por lados diferentes para os rótulos não se sobreporem.

_BPMN_TYPES = {
    "inicio": ("startEvent", 36, 36), "fim": ("endEvent", 36, 36), "tarefa": ("task", 200, 80),
    "gateway": ("exclusiveGateway", 50, 50), "paralelo": ("parallelGateway", 50, 50),
    "evento": ("intermediateThrowEvent", 36, 36), "subprocesso": ("subProcess", 200, 80),
}
_GAP_X = 70          # espaço horizontal entre colunas
_GW_EXTRA = 70       # espaço a mais depois de um gateway com saídas rotuladas
_FLOW_LABEL_W = 120  # largura máxima do rótulo de um fluxo (quebra em linhas)
_ROW_H = 130         # altura de uma linha de elementos dentro da raia
_LANE_X = 30
_LANE_LABEL = 30
_POOL_LABEL = 30
_ANN_W = 250         # largura da anotação
_ANN_CHARS = 38      # caracteres por linha da anotação (fonte padrão do Camunda/bpmn-js)
_ANN_LINE = 15
_ANN_GAP = 30        # espaço entre a anotação e a etapa (linha pontilhada)


def _xml_id(raw: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]", "_", raw or "id")
    if not re.match(r"[A-Za-z_]", base):
        base = "id_" + base
    out, n = base, 2
    while out in used:
        out, n = f"{base}_{n}", n + 1
    used.add(out)
    return out


def _ann_height(text: str) -> int:
    lines = 0
    for para in (text or "").split("\n"):
        cur = 0
        lines += 1
        for w in para.split():
            if cur and cur + 1 + len(w) > _ANN_CHARS:
                lines, cur = lines + 1, len(w)
            else:
                cur += (1 if cur else 0) + len(w)
    return 14 + max(1, lines) * _ANN_LINE


def make_bpmn(processo: dict) -> bytes:
    from xml.sax.saxutils import escape, quoteattr

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
                      "nota": str(e.get("nota") or "").strip()[:600], "in": [], "out": []}
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

    # Largura de cada coluna = maior elemento dela + espaço.
    max_col = max(col.values()) if col else 0
    col_w = [0] * (max_col + 1)
    for k in order:
        col_w[col[k]] = max(col_w[col[k]], _BPMN_TYPES[nodes[k]["tipo"]][1])
    x0 = _LANE_X + _POOL_LABEL + _LANE_LABEL + 50
    col_x, acc = [], x0
    gw_cols = {col[f["de"]] for f in flows if f["rotulo"] and nodes[f["de"]]["tipo"] in ("gateway", "paralelo")}
    for c, w in enumerate(col_w):
        col_x.append(acc)
        acc += w + _GAP_X + (_GW_EXTRA if c in gw_cols else 0)  # espaço para o rótulo da saída do gateway

    # Anotações: faixa de cima ou de baixo da raia, alternando entre etapas vizinhas com nota.
    band: dict[str, str] = {}
    for r in raias:
        noted = sorted((k for k in order if nodes[k]["raia"] == r and nodes[k]["nota"]), key=lambda k: (col[k], slot[k]))
        for i, k in enumerate(noted):
            if depth[r] > 1:
                band[k] = "top" if slot[k] == 0 else "bottom"
            else:
                band[k] = "top" if i % 2 == 0 else "bottom"
    ann_h = {k: _ann_height(nodes[k]["nota"]) for k in band}

    # Posição x de cada elemento (só depende da coluna) e da anotação desejada.
    elem_cx = {k: col_x[col[k]] + col_w[col[k]] // 2 for k in order}
    ann_x: dict[str, int] = {}
    for k in band:
        w = _BPMN_TYPES[nodes[k]["tipo"]][1]
        # evento e gateway têm o nome embaixo (ou em cima): a anotação vai ao lado dele
        ann_x[k] = elem_cx[k] - 30 if nodes[k]["tipo"] in ("tarefa", "subprocesso") else elem_cx[k] + w // 2 + 40

    # Camadas: anotações que colidiriam na mesma faixa sobem (ou descem) uma camada, em vez de escorregar
    # para o lado; a camada 0 é a mais próxima das etapas.
    ann_tier: dict[str, int] = {}
    tier_h: dict[tuple[str, str, int], int] = {}
    for r in raias:
        for bnd in ("top", "bottom"):
            tiers: list[int] = []  # borda direita ocupada em cada camada
            for k in sorted((k for k in band if band[k] == bnd and nodes[k]["raia"] == r), key=lambda k: ann_x[k]):
                t = next((i for i, rt in enumerate(tiers) if ann_x[k] >= rt + 15), len(tiers))
                if t == len(tiers):
                    tiers.append(0)
                tiers[t] = ann_x[k] + _ANN_W
                ann_tier[k] = t
                tier_h[(r, bnd, t)] = max(tier_h.get((r, bnd, t), 0), ann_h[k])
    top_h = {r: 0 for r in raias}
    bot_h = {r: 0 for r in raias}
    for (r, bnd, _t), h in tier_h.items():
        if bnd == "top":
            top_h[r] += h + 10
        else:
            bot_h[r] += h + 10
    for r in raias:
        top_h[r] += _ANN_GAP - 10 if top_h[r] else 0
        bot_h[r] += _ANN_GAP - 10 if bot_h[r] else 0

    lane_y: dict[str, int] = {}
    lane_h: dict[str, int] = {}
    y = 40
    for r in raias:
        lane_y[r] = y
        lane_h[r] = top_h[r] + depth[r] * _ROW_H + bot_h[r] + 20
        y += lane_h[r]
    pool_h = y - 40

    bounds: dict[str, tuple[int, int, int, int]] = {}
    for k in order:
        n = nodes[k]
        _, w, h = _BPMN_TYPES[n["tipo"]]
        cy = lane_y[n["raia"]] + 10 + top_h[n["raia"]] + slot[k] * _ROW_H + _ROW_H // 2
        bounds[k] = (elem_cx[k] - w // 2, cy - h // 2, w, h)

    ann_b: dict[str, tuple[int, int, int, int]] = {}
    for k in band:
        r, t, h = nodes[k]["raia"], ann_tier[k], ann_h[k]
        rows_top = lane_y[r] + 10 + top_h[r]
        if band[k] == "top":
            y_bottom = rows_top - (_ANN_GAP - 10) - sum(tier_h[(r, "top", i)] + 10 for i in range(t))
            ay = y_bottom - h
        else:
            ay = rows_top + depth[r] * _ROW_H + sum(tier_h[(r, "bottom", i)] + 10 for i in range(t))
        ann_b[k] = (ann_x[k], ay, _ANN_W, h)

    right = max([x + w for x, _, w, _ in bounds.values()] + [x + w for x, _, w, _ in ann_b.values()])
    pool_w = right + 50 - _LANE_X

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
    ann_ids: dict[str, tuple[str, str]] = {}
    for k in order:
        if k in ann_b:
            tid = _xml_id(f"Annotation_{nodes[k]['xid']}", used)
            aid = _xml_id(f"Association_{nodes[k]['xid']}", used)
            ann_ids[k] = (tid, aid)
            proc.append(f"    <bpmn:textAnnotation id={a(tid)}><bpmn:text>{escape(nodes[k]['nota'])}</bpmn:text>"
                        f"</bpmn:textAnnotation>")
            proc.append(f'    <bpmn:association id={a(aid)} associationDirection="None" '
                        f"sourceRef={a(nodes[k]['xid'])} targetRef={a(tid)} />")

    di: list[str] = []
    di.append(f'      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">'
              f'<dc:Bounds x="{_LANE_X}" y="40" width="{pool_w}" height="{pool_h}" /></bpmndi:BPMNShape>')
    for r in raias:
        di.append(f'      <bpmndi:BPMNShape id="{lane_ids[r]}_di" bpmnElement="{lane_ids[r]}" isHorizontal="true">'
                  f'<dc:Bounds x="{_LANE_X + _POOL_LABEL}" y="{lane_y[r]}" width="{pool_w - _POOL_LABEL}" '
                  f'height="{lane_h[r]}" /></bpmndi:BPMNShape>')
    def cy_of(k: str) -> int:
        return bounds[k][1] + bounds[k][3] // 2

    def crosses(pts: list, skip: tuple) -> int:
        """Quantas caixas (fora origem e destino) os segmentos retos atravessam."""
        n = 0
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            for k, (bx, by, bw, bh) in bounds.items():
                if k in skip:
                    continue
                bx, by, bw, bh = bx - 4, by - 4, bw + 8, bh + 8
                if x1 == x2 and bx < x1 < bx + bw and min(y1, y2) < by + bh and max(y1, y2) > by:
                    n += 1
                elif y1 == y2 and by < y1 < by + bh and min(x1, x2) < bx + bw and max(x1, x2) > bx:
                    n += 1
        return n

    bottom = 40 + pool_h - 12
    top_line = 40 + 12
    used_channels: dict[int, int] = {}

    def channel_y(k: str, side: str) -> int:
        """Altura livre logo acima (up) ou abaixo (down) da fileira do elemento, dentro da raia."""
        base = cy_of(k) - _ROW_H // 2 + 6 if side == "up" else cy_of(k) + _ROW_H // 2 - 6
        n = used_channels.get(base, 0)
        used_channels[base] = n + 1
        return base + (8 * n if side == "up" else -8 * n)

    # Rota de cada fluxo: testa as opções em ordem e fica com a primeira que não atravessa nenhuma caixa.
    # Gateway: reto (mesma fileira), tronco por baixo/cima até a fileira do destino, contorno pela borda.
    # Tarefa/evento: reto, cotovelo perto do destino, cotovelo perto da origem, contorno pela borda.
    route: dict[str, tuple[list, str, int]] = {}  # fluxo -> (pontos, lado de saída, índice do ponto do rótulo)
    for f in flows:
        s, t = f["de"], f["para"]
        sx, sy, sw, sh = bounds[s]
        tx, ty, tw, th = bounds[t]
        scx, scy, tcx, tcy = sx + sw // 2, cy_of(s), tx + tw // 2, cy_of(t)
        is_gw = nodes[s]["tipo"] in ("gateway", "paralelo")
        cands: list[tuple[list, str, int]] = []
        if col[t] > col[s]:
            if scy == tcy:
                cands.append(([(sx + sw, scy), (tx, tcy)], "right", 0))
            if is_gw and scy != tcy:
                d = "down" if tcy > scy else "up"
                cands.append(([(scx, sy + sh if d == "down" else sy), (scx, tcy), (tx, tcy)], d, 1))
            if scy != tcy:
                for mx in (tx - _GAP_X // 2, sx + sw + _GAP_X // 2):
                    cands.append(([(sx + sw, scy), (mx, scy), (mx, tcy), (tx, tcy)], "right", 0))
            for d in (("up", "down") if tcy <= scy else ("down", "up")):
                # contorno: sai por cima/baixo, corre na borda da fileira de destino e entra por cima/baixo
                yd_t = tcy - _ROW_H // 2 + 6 if d == "up" or tcy > scy else tcy + _ROW_H // 2 - 6
                if scy == tcy:
                    yd_t = tcy - _ROW_H // 2 + 6 if d == "up" else tcy + _ROW_H // 2 - 6
                enter = ty if yd_t < tcy else ty + th
                if is_gw:
                    pts = [(scx, sy + sh if yd_t > scy else sy), (scx, yd_t), (tcx, yd_t), (tcx, enter)]
                    cands.append((pts, "down" if yd_t > scy else "up", 0))
                mx = sx + sw + _GAP_X // 2
                cands.append(([(sx + sw, scy), (mx, scy), (mx, yd_t), (tcx, yd_t), (tcx, enter)], "right", 0))
        elif col[t] == col[s]:
            d = "down" if ty > sy else "up"
            cands.append(([(scx, sy + sh if d == "down" else sy), (tcx, ty if d == "down" else ty + th)], d, 0))
        else:  # retorno: por baixo ou por cima da pool
            cands.append(([(scx, sy + sh), (scx, bottom), (tcx, bottom), (tcx, ty + th)], "down", 0))
            cands.append(([(scx, sy), (scx, top_line), (tcx, top_line), (tcx, ty)], "up", 0))
        best = min(range(len(cands)), key=lambda i: (crosses(cands[i][0], (s, t)), i))
        pts, side, li = cands[best]
        # contorno na mesma borda: afasta linhas paralelas
        if len(pts) >= 4 and pts[-2][1] == pts[-3][1] and pts[-2][1] not in (scy, tcy, bottom, top_line):
            yd = channel_y(t, "up" if pts[-2][1] < tcy else "down")
            pts = [p if p[1] != pts[-2][1] else (p[0], yd) for p in pts]
        route[f["id"]] = (pts, side, li)

    # Lados usados pelas saídas de cada gateway (para o nome dele não cair em cima de uma linha ou rótulo).
    gw_sides: dict[str, set] = {k: set() for k in nodes}
    for f in flows:
        gw_sides[f["de"]].add(route[f["id"]][1])

    for k in order:
        x, y_, w, h = bounds[k]
        extra = ' isMarkerVisible="true"' if nodes[k]["tipo"] == "gateway" else ""
        label = ""
        if nodes[k]["tipo"] in ("inicio", "fim", "evento", "gateway", "paralelo") and nodes[k]["nome"]:
            lw, lh = 110, 40
            lx, ly = x + w // 2 - lw // 2, y_ + h + 5
            sides = gw_sides[k] if nodes[k]["tipo"] in ("gateway", "paralelo") else set()
            if "down" in sides and "up" not in sides:
                ly = y_ - lh - 5  # nome acima
                if "right" in sides:
                    lx = x + w // 2 - lw + 20  # e à esquerda, longe do rótulo da saída da direita
            elif {"down", "up"} <= sides:
                lx, ly = x - lw - 5, y_ - lh  # cima e baixo ocupados: nome à esquerda
            elif "right" in sides and "down" not in sides:
                lx = x + w // 2 - lw + 20  # nome embaixo, à esquerda
            label = (f'<bpmndi:BPMNLabel><dc:Bounds x="{lx}" y="{ly}" width="{lw}" '
                     f'height="{lh}" /></bpmndi:BPMNLabel>')
        di.append(f'      <bpmndi:BPMNShape id="{nodes[k]["xid"]}_di" bpmnElement="{nodes[k]["xid"]}"{extra}>'
                  f'<dc:Bounds x="{x}" y="{y_}" width="{w}" height="{h}" />{label}</bpmndi:BPMNShape>')
    for f in flows:
        pts, side, li = route[f["id"]]
        wp = "".join(f'<di:waypoint x="{px}" y="{py}" />' for px, py in pts)
        label = ""
        if f["rotulo"]:
            text_w = 7 * len(f["rotulo"]) + 4
            lw = max(24, min(text_w, _FLOW_LABEL_W))
            lh = 14 * -(-text_w // lw)
            # rótulo no começo do último trecho horizontal (a entrada do ramo): saídas do mesmo gateway
            # que começam no mesmo ponto ficam com os rótulos separados
            horiz = [i for i in range(len(pts) - 1) if pts[i][1] == pts[i + 1][1] and pts[i][0] != pts[i + 1][0]]
            li = horiz[-1] if horiz and pts[horiz[-1]][1] not in (bottom, top_line) else li
            px, py = pts[li]
            if li > 0 or side != "down":
                lx, ly = px + 6, py - 4 - lh  # acima da linha, logo depois do ponto
            else:
                lx, ly = px + 6, py + 4  # saída por baixo: ao lado da linha, logo abaixo do gateway
            label = (f'<bpmndi:BPMNLabel><dc:Bounds x="{lx}" y="{ly}" width="{lw}" height="{lh}" />'
                     f"</bpmndi:BPMNLabel>")
        di.append(f'      <bpmndi:BPMNEdge id="{f["id"]}_di" bpmnElement="{f["id"]}">{wp}{label}</bpmndi:BPMNEdge>')
    for k, (tid, aid) in ann_ids.items():
        ax, ay, aw, ah = ann_b[k]
        ex, ey, ew, eh = bounds[k]
        di.append(f'      <bpmndi:BPMNShape id="{tid}_di" bpmnElement="{tid}">'
                  f'<dc:Bounds x="{ax}" y="{ay}" width="{aw}" height="{ah}" /></bpmndi:BPMNShape>')
        if nodes[k]["tipo"] not in ("tarefa", "subprocesso"):  # evento/gateway: sai pela lateral, longe do nome
            pts = [(ex + ew, ey + eh // 2), (ax, ay + ah if band[k] == "top" else ay)]
        elif band[k] == "top":
            pts = [(ex + ew // 2, ey), (ax + 20, ay + ah)]
        else:
            pts = [(ex + ew // 2, ey + eh), (ax + 20, ay)]
        wp = "".join(f'<di:waypoint x="{px}" y="{py}" />' for px, py in pts)
        di.append(f'      <bpmndi:BPMNEdge id="{aid}_di" bpmnElement="{aid}">{wp}</bpmndi:BPMNEdge>')

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
