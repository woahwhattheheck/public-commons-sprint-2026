import tempfile
import unittest
from pathlib import Path

import main


class Track2ATests(unittest.TestCase):
    def test_selected_context_anchors_vote_and_claim(self):
        pages = [
            main.Passage(1, "Allgemeine Einleitung ohne Bezug."),
            main.Passage(2, "Die Reform AHV 21 stabilisiert die Finanzierung der Altersvorsorge."),
            main.Passage(3, "Weitere administrative Hinweise."),
        ]
        case = {"vote": "AHV 21", "claim": {"text": "La réforme stabilise le financement.", "language": "fr"}}
        selected = main.select_context(case, pages, limit=1)
        self.assertEqual(selected[0].page, 2)

    def test_prediction_rejects_unverifiable_quote(self):
        raw = {"label": 0, "evidence": [{"page": 2, "text": "invented text"}]}
        with self.assertRaisesRegex(ValueError, "source-verifiable"):
            main.validate_prediction(raw, "A", [main.Passage(2, "Exact official source text.")])

    def test_neutral_has_no_evidence(self):
        label, evidence = main.validate_prediction({"label": 1, "evidence": [{"text": "ignore"}]}, "B", [main.Passage(None, "x")])
        self.assertEqual((label, evidence), (1, []))

    def test_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            data_root = Path(root)
            input_path = data_root / "cases.jsonl"
            input_path.write_text("", encoding="utf-8")
            foreign = Path(outside) / "booklet.pdf"
            foreign.write_bytes(b"not a pdf")
            with self.assertRaisesRegex(ValueError, "escapes data root"):
                main.safe_source_path(str(foreign), input_path, data_root)

    def test_model_json_code_fence(self):
        parsed = main.parse_model_json('```json\n{"label":2,"evidence":[]}\n```')
        self.assertEqual(parsed["label"], 2)

    @unittest.skipIf(main.fitz is None, "PyMuPDF unavailable")
    def test_task_a_extracts_one_based_pdf_pages(self):
        with tempfile.TemporaryDirectory() as root:
            data_root = Path(root)
            input_path = data_root / "cases.jsonl"
            input_path.write_text("", encoding="utf-8")
            pdf_path = data_root / "booklet.pdf"
            document = main.fitz.open()
            first = document.new_page()
            first.insert_text((72, 72), "First official page")
            second = document.new_page()
            second.insert_text((72, 72), "Second official page")
            document.save(pdf_path)
            document.close()
            task, passages = main.case_passages(
                {"booklet": {"path": "booklet.pdf", "language": "en"}},
                input_path,
                data_root,
            )
            self.assertEqual(task, "A")
            self.assertEqual([passage.page for passage in passages], [1, 2])
            self.assertIn("Second official page", passages[1].text)

    def test_task_b_reference_contract(self):
        with tempfile.TemporaryDirectory() as root:
            data_root = Path(root)
            input_path = data_root / "cases.jsonl"
            input_path.write_text("", encoding="utf-8")
            task, passages = main.case_passages(
                {"reference": {"text": "Official supplied paragraph", "language": "en"}},
                input_path,
                data_root,
            )
            self.assertEqual((task, passages[0].page), ("B", None))
            self.assertEqual(passages[0].text, "Official supplied paragraph")


if __name__ == "__main__":
    unittest.main()
