"""Testes offline da geração de .docx (simples e no timbre FOR-AMBT-06). Sem rede.

Precisam do python-docx (já vem no container do Hermes); sem ele, os testes de docx são pulados.
Rodar a partir da raiz do repositório:
    python -m unittest discover -s hermes/plugin-prisma -p "test_*.py" -v
"""
from __future__ import annotations

import hashlib
import importlib.util
import io
import sys
import unittest
import zipfile
from pathlib import Path

_spec = importlib.util.spec_from_file_location("prisma_files", Path(__file__).with_name("files.py"))
f = importlib.util.module_from_spec(_spec)
sys.modules["prisma_files"] = f
_spec.loader.exec_module(f)

try:
    import docx  # noqa: F401
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

MD = """# Lista de Requisitos de Melhorias: Compras

Goiânia, 26 de novembro de 2026.

## Contexto do processo

| Campo | Descrição |
|---|---|
| Processo | Compras de **materiais** |
| Área | Suprimentos |

## Requisitos de melhoria

- Aprovação por alçada
- Integração com o *ERP*

1. Mapear o fluxo
2. Validar com a TI
"""


def _zip_parts(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class ModeloValidationTests(unittest.TestCase):
    def test_timbrado_only_for_docx(self):
        with self.assertRaises(f.FileError):
            f.generate("pdf", "T", "texto", None, None, "timbrado")

    def test_invalid_modelo(self):
        with self.assertRaises(f.FileError):
            f.generate("docx", "T", "texto", None, None, "colorido")

    def test_template_asset_is_shipped(self):
        self.assertTrue(f.TIMBRADO_DOCX.is_file(), f.TIMBRADO_DOCX)
        self.assertTrue(zipfile.is_zipfile(f.TIMBRADO_DOCX))


@unittest.skipUnless(HAS_DOCX, "python-docx não instalado")
class DocxTimbradoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = f.generate("docx", "Lista de Requisitos", MD, None, None, "timbrado")
        cls.parts = _zip_parts(cls.data)
        cls.tpl = _zip_parts(f.TIMBRADO_DOCX.read_bytes())
        cls.doc = docx.Document(io.BytesIO(cls.data))

    def test_opens_and_keeps_section_of_template(self):
        s = self.doc.sections[0]
        self.assertEqual((s.page_width.twips, s.page_height.twips), (11906, 16838))  # A4
        self.assertEqual((s.top_margin.twips, s.bottom_margin.twips), (1417, 1417))
        self.assertEqual((s.left_margin.twips, s.right_margin.twips), (1701, 1701))
        self.assertEqual(len(self.doc.sections), 1)

    def test_header_and_footer_come_from_template(self):
        s = self.doc.sections[0]
        self.assertFalse(s.header.is_linked_to_previous)
        self.assertFalse(s.footer.is_linked_to_previous)
        tpl_images = {_sha(b) for n, b in self.tpl.items() if n.startswith("word/media/")}
        for part in (s.header.part, s.footer.part):
            xml = part.blob.decode("utf-8")
            self.assertIn("<w:drawing", xml)
            imgs = [r.target_part.blob for r in part.rels.values() if "image" in r.reltype]
            self.assertTrue(imgs)
            for blob in imgs:
                self.assertIn(_sha(blob), tpl_images)  # logo e barra de contatos do modelo, intactas
        header_img = [r.target_part.blob for r in s.header.part.rels.values() if "image" in r.reltype][0]
        footer_img = [r.target_part.blob for r in s.footer.part.rels.values() if "image" in r.reltype][0]
        self.assertNotEqual(_sha(header_img), _sha(footer_img))

    def test_body_has_headings_lists_and_table(self):
        paras = self.doc.paragraphs
        styles = [(p.style.name, p.text) for p in paras]
        self.assertEqual(styles[0], ("Title", "Lista de Requisitos"))
        self.assertIn(("Heading 1", "Lista de Requisitos de Melhorias: Compras"), styles)
        self.assertIn(("Heading 2", "Contexto do processo"), styles)
        texts = [p.text for p in paras]
        self.assertIn("•\tAprovação por alçada", texts)
        self.assertIn("•\tIntegração com o ERP", texts)
        self.assertIn("1.\tMapear o fluxo", texts)
        self.assertIn("2.\tValidar com a TI", texts)
        item = next(p for p in paras if p.text.startswith("•\tAprovação"))
        self.assertEqual(item.paragraph_format.left_indent.twips, 720)
        self.assertEqual(len(self.doc.tables), 1)
        t = self.doc.tables[0]
        self.assertEqual([[c.text for c in r.cells] for r in t.rows],
                         [["Campo", "Descrição"], ["Processo", "Compras de materiais"], ["Área", "Suprimentos"]])
        self.assertTrue(all(r.bold for r in t.rows[0].cells[0].paragraphs[0].runs))
        self.assertIn("w:tblHeader", t.rows[0]._tr.xml)
        bold = [r.text for r in t.rows[1].cells[1].paragraphs[0].runs if r.bold]
        self.assertEqual(bold, ["materiais"])

    def test_template_placeholder_and_metadata_are_replaced(self):
        body = self.parts["word/document.xml"].decode("utf-8")
        self.assertNotIn("75E70D98", body)  # parágrafo vazio do modelo saiu
        cp = self.doc.core_properties
        self.assertEqual((cp.author, cp.last_modified_by, cp.title), ("Ambiente Consultoria", "Prisma", "Lista de Requisitos"))
        self.assertEqual(cp.revision, 1)

    def test_simple_docx_stays_default(self):
        data = f.generate("docx", "T", MD, None, None)
        parts = _zip_parts(data)
        self.assertFalse(any(n.startswith("word/header") for n in parts))
        d = docx.Document(io.BytesIO(data))
        self.assertIn("List Bullet", {p.style.name for p in d.paragraphs})
        self.assertEqual(f.generate("docx", "T", MD, None, None, "simples")[:4], b"PK\x03\x04")


if __name__ == "__main__":
    unittest.main()
