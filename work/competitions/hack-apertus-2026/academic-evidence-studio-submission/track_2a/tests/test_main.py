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


if __name__ == "__main__":
    unittest.main()
