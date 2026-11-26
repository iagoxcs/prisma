"""Testes offline da leitura de arquivos (files.py): codificações, .zip, PowerPoint, OpenDocument, RTF, EML e VTT.

Os arquivos de teste são montados em memória. Testes que dependem de python-docx/python-pptx/openpyxl são pulados
se a biblioteca não estiver instalada (no container do Hermes todas existem).
Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import importlib.util
import io
import sys
import unittest
import zipfile
from email.message import EmailMessage
from pathlib import Path

_spec = importlib.util.spec_from_file_location("prisma_files_read", Path(__file__).with_name("files.py"))
f = importlib.util.module_from_spec(_spec)
sys.modules["prisma_files_read"] = f
_spec.loader.exec_module(f)


def _has(mod: str) -> bool:
    return importlib.util.find_spec(mod) is not None


TEXT = "Gente, precisa mapiar: Conciliação, Análise de Crédito — ação já!\nSegunda linha."


def _zip(files: dict[str, bytes], compression=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _docx(text: str) -> bytes:
    import docx
    d = docx.Document()
    d.add_heading("Título do POP", 1)
    d.add_paragraph(text)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


class DecodeTests(unittest.TestCase):
    def test_utf16_be_com_bom(self):  # o caso do Discord: Bloco de Notas "UTF-16 BE"
        kind, text = f._extract(".txt", b"\xfe\xff" + TEXT.encode("utf-16-be"))
        self.assertEqual((kind, text), ("txt", TEXT))

    def test_utf16_le_com_bom_e_crlf(self):
        _, text = f._extract(".txt", b"\xff\xfe" + TEXT.replace("\n", "\r\n").encode("utf-16-le"))
        self.assertEqual(text, TEXT)

    def test_utf16_sem_bom(self):
        self.assertEqual(f._extract(".txt", TEXT.encode("utf-16-le"))[1], TEXT)
        self.assertEqual(f._extract(".txt", TEXT.encode("utf-16-be"))[1], TEXT)

    def test_utf8_bom_e_cp1252(self):
        self.assertEqual(f._extract(".txt", b"\xef\xbb\xbf" + TEXT.encode("utf-8"))[1], TEXT)
        self.assertEqual(f._extract(".csv", TEXT.encode("cp1252"))[1], TEXT)

    def test_sem_caractere_nulo(self):
        _, text = f._extract(".txt", b"\xfe\xff" + TEXT.encode("utf-16-be"))
        self.assertNotIn("\x00", text)


class SubtitleTests(unittest.TestCase):
    def test_vtt_do_teams(self):
        vtt = (
            "WEBVTT\n\n"
            "a1b2/12-0\n00:00:01.000 --> 00:00:03.000\n<v Léa Zuppani>Bom dia a todos.</v>\n\n"
            "a1b2/13-0\n00:00:03.000 --> 00:00:05.000\n<v Léa Zuppani>Vamos ao contas a pagar.</v>\n\n"
            "a1b2/14-0\n00:00:05.000 --> 00:00:08.000\n<v Iago>Quem aprova\no pagamento?</v>\n"
        )
        kind, text = f._extract(".vtt", vtt.encode("utf-8"))
        self.assertEqual(kind, "vtt")
        self.assertEqual(text, "Léa Zuppani: Bom dia a todos. Vamos ao contas a pagar.\nIago: Quem aprova o pagamento?")

    def test_srt(self):
        srt = "1\n00:00:01,000 --> 00:00:02,000\nPrimeira parte\n\n2\n00:00:02,000 --> 00:00:03,000\nda frase.\n"
        self.assertEqual(f._extract(".srt", srt.encode("utf-8"))[1], "Primeira parte da frase.")


class RtfTests(unittest.TestCase):
    def test_rtf_com_acentos_e_unicode(self):
        rtf = (r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}}{\colortbl;\red0\green0\blue0;}"
               r"{\*\generator Riched20;}\f0 Concilia\'e7\'e3o banc\'e1ria\par "
               r"Cr\u233?dito " + chr(92) + "u8212? fim" + r"\par}")  # u8212 = travessão
        kind, text = f._extract(".rtf", rtf.encode("latin-1"))
        self.assertEqual(kind, "rtf")
        self.assertEqual(text, "Conciliação bancária\nCrédito — fim")


class OdfTests(unittest.TestCase):
    NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
          'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
          'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
          'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
          'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"')

    def _odf(self, mimetype: str, body: str) -> bytes:
        content = f'<?xml version="1.0" encoding="UTF-8"?><office:document-content {self.NS}><office:body>{body}</office:body></office:document-content>'
        return _zip({"mimetype": mimetype.encode(), "content.xml": content.encode("utf-8")}, zipfile.ZIP_STORED)

    def test_odt(self):
        data = self._odf("application/vnd.oasis.opendocument.text",
                         '<office:text><text:h text:outline-level="2">Etapas</text:h>'
                         '<text:p>Receber<text:s text:c="2"/>nota</text:p>'
                         '<text:list><text:list-item><text:p>Conferir</text:p></text:list-item></text:list>'
                         '<table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell>'
                         '<table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></table:table>'
                         '</office:text>')
        kind, text = f._extract(".odt", data)
        self.assertEqual(kind, "odt")
        self.assertEqual(text, "## Etapas\n\nReceber  nota\n\n- Conferir\n\n| A | B |")

    def test_ods_com_repeticoes(self):
        data = self._odf("application/vnd.oasis.opendocument.spreadsheet",
                         '<office:spreadsheet><table:table table:name="Contas">'
                         '<table:table-row><table:table-cell><text:p>Fornecedor</text:p></table:table-cell>'
                         '<table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell>'
                         '<table:table-cell table:number-columns-repeated="1000"/></table:table-row>'
                         '<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>'
                         '</table:table></office:spreadsheet>')
        self.assertEqual(f._extract(".ods", data)[1], "## Aba: Contas\n| Fornecedor | x | x |")

    def test_odp_com_notas(self):
        data = self._odf("application/vnd.oasis.opendocument.presentation",
                         '<office:presentation><draw:page><draw:frame><draw:text-box><text:p>Fluxo AP</text:p>'
                         '</draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box>'
                         '<text:p>Falar do ERP</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>'
                         '</office:presentation>')
        self.assertEqual(f._extract(".odp", data)[1], "--- Slide 1 ---\n- Fluxo AP\nNotas do apresentador: Falar do ERP")


@unittest.skipUnless(_has("pptx"), "python-pptx ausente")
class PptxTests(unittest.TestCase):
    def test_pptx_slides_tabela_e_notas(self):
        from pptx import Presentation
        from pptx.util import Inches
        prs = Presentation()
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = "Contas a Pagar"
        s.placeholders[1].text_frame.text = "Lançar nota no ERP"
        table = s.shapes.add_table(2, 2, Inches(1), Inches(4), Inches(4), Inches(1)).table
        table.cell(0, 0).text, table.cell(0, 1).text = "Etapa", "Dono"
        table.cell(1, 0).text, table.cell(1, 1).text = "Aprovar", "Diretoria"
        s.notes_slide.notes_text_frame.text = "Gargalo na aprovação"
        buf = io.BytesIO()
        prs.save(buf)
        kind, text = f._extract(".pptx", buf.getvalue())
        self.assertEqual(kind, "pptx")
        self.assertIn("--- Slide 1: Contas a Pagar ---", text)
        self.assertIn("- Lançar nota no ERP", text)
        self.assertIn("| Aprovar | Diretoria |", text)
        self.assertIn("Notas do apresentador: Gargalo na aprovação", text)


class ZipTests(unittest.TestCase):
    def test_zip_le_cada_arquivo_e_explica_o_resto(self):
        inner = _zip({"interno.txt": "Texto do zip interno".encode("utf-8")})
        files = {
            "transcricao.txt": b"\xfe\xff" + TEXT.encode("utf-16-be"),
            "pasta/notas.md": "# Notas\nItem".encode("utf-8"),
            "antigo.doc": b"\xd0\xcf\x11\xe0 legado",
            "foto.png": b"\x89PNG\r\n",
            "arquivos.rar": b"Rar!",
            "outro.zip": inner,
            "__MACOSX/._transcricao.txt": b"lixo",
        }
        if _has("docx"):
            files["pop.docx"] = _docx("Conferir o boleto")
        kind, text = f._extract(".zip", _zip(files))
        self.assertEqual(kind, "zip")
        self.assertIn("=== Arquivo: transcricao.txt ===\n" + TEXT, text)
        self.assertIn("=== Arquivo: pasta/notas.md ===\n# Notas\nItem", text)
        self.assertIn("antigo.doc — não lido: formato antigo (.doc); abra no Office e salve como .docx", text)
        self.assertIn("foto.png — não lido: imagem", text)
        self.assertIn("arquivos.rar — não lido: compactado em .rar; envie em .zip", text)
        self.assertIn("Texto do zip interno", text)
        self.assertNotIn("__MACOSX", text)
        if _has("docx"):
            self.assertIn("# Título do POP\n\nConferir o boleto", text)

    def test_zip_nome_em_cp850_do_windows(self):
        # O Explorer grava o nome na página de código OEM (cp850), sem a marca UTF-8.
        data = _zip({"Conciliacao.txt": b"ok"}).replace(b"Conciliacao.txt", "Conciliação.txt".encode("cp850"))
        self.assertIn("Conciliação.txt", f._extract(".zip", data)[1])

    def test_zip_bomba_de_compressao_e_recusada(self):
        data = _zip({"zeros.txt": b"\x00" * (3 * 1024 * 1024)})
        self.assertIn("zeros.txt — não lido: taxa de compressão suspeita", f._extract(".zip", data)[1])

    def test_zip_aninhado_tem_limite(self):
        data = _zip({"a.txt": b"fundo"})
        for _ in range(f.MAX_NEST + 1):
            data = _zip({"n.zip": data}, zipfile.ZIP_STORED)
        text = f._extract(".zip", data)[1]
        self.assertIn("níveis demais", text)
        self.assertNotIn("fundo", text)

    def test_zip_corrompido(self):
        with self.assertRaises(f.FileError):
            f._extract(".zip", b"PK\x03\x04 quebrado")


class EmlTests(unittest.TestCase):
    def test_eml_com_anexo(self):
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = "lea@example.com", "iago@example.com", "Mapeamento financeiro"
        msg.set_content("Segue a transcrição.")
        msg.add_attachment("Etapa 1: receber nota".encode("utf-8"), maintype="text", subtype="plain", filename="etapas.txt")
        kind, text = f._extract(".eml", msg.as_bytes())
        self.assertEqual(kind, "eml")
        self.assertIn("Assunto: Mapeamento financeiro", text)
        self.assertIn("Segue a transcrição.", text)
        self.assertIn("=== Arquivo: etapas.txt ===\nEtapa 1: receber nota", text)


class FormatTests(unittest.TestCase):
    def test_formato_antigo_pede_versao_nova(self):
        with self.assertRaises(f.FileError) as ctx:
            f._extract(".xls", b"\xd0\xcf\x11\xe0")
        self.assertIn("salve como .xlsx", str(ctx.exception))

    def test_rar_pede_zip(self):
        with self.assertRaises(f.FileError) as ctx:
            f._extract(".7z", b"7z")
        self.assertIn("envie em .zip", str(ctx.exception))

    @unittest.skipUnless(_has("docx"), "python-docx ausente")
    def test_sem_extensao_reconhece_pelo_conteudo(self):
        kind, text = f._extract("", _docx("Corpo"))
        self.assertEqual(kind, "docx")
        self.assertIn("Corpo", text)

    @unittest.skipUnless(_has("docx"), "python-docx ausente")
    def test_dotx_cai_no_leitor_de_xml(self):
        self.assertIn("Conferir", f._extract(".dotx", _docx("Conferir"))[1])

    @unittest.skipUnless(_has("openpyxl"), "openpyxl ausente")
    def test_xlsm(self):
        import openpyxl
        wb = openpyxl.Workbook()
        wb.active.append(["Título", "Prazo"])
        buf = io.BytesIO()
        wb.save(buf)
        self.assertIn("| Título | Prazo |", f._extract(".xlsm", buf.getvalue())[1])


if __name__ == "__main__":
    unittest.main()
