"""Round-2 focused regressions: the four Root-identified correctness gaps.

Only the new behavior is exercised. The accepted 17-case file is untouched.
Stdlib + mocks only — no model calls, network, PDFs or installs.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import evaluate_dev
import main


def pred_row(case_id, label=1, label_name="neutral", evidence=None):
    return {
        "id": case_id, "label": label, "label_name": label_name,
        "evidence": [] if evidence is None else evidence,
        "metrics": {"input_tokens": 10, "output_tokens": 4,
                    "inference_time_ms": 50},
    }


def gold_row(case_id="g1", label=1, src="de", dst="de"):
    return {"id": case_id, "label": label,
            "reference_language": src, "claim_language": dst}


def case_b():
    return {"id": "c1", "vote": "Volksinitiative",
            "claim": {"text": "Der Text stuetzt.", "language": "de"},
            "reference": {"text": "Amtlicher Referenztext.", "language": "de"}}


class SourceQuoteUnicodeTests(unittest.TestCase):
    def test_casefold_expansion_returns_original_span(self):
        # 'ß' folds to 'ss': folded offsets shift relative to the original.
        # The returned text must be the ORIGINAL characters, not a folded-
        # offset slice of them.
        passage = main.Passage(2, "Die Straße ist lang.")
        matched = main.source_quote("strasse", [passage], 2)
        self.assertIsNotNone(matched)
        page, text = matched
        self.assertEqual(page, 2)
        self.assertEqual(text, "Straße")

    def test_whitespace_normalized_match_returns_verbatim_original(self):
        passage = main.Passage(1, "Die\n  Straße\tist\n\nlang.")
        matched = main.source_quote("Die Straße ist lang.", [passage], 1)
        self.assertIsNotNone(matched)
        page, text = matched
        self.assertEqual(page, 1)
        # verbatim original characters incl. real whitespace
        self.assertEqual(text, "Die\n  Straße\tist\n\nlang.")
        self.assertIn(text, passage.text)

    def test_unverifiable_quote_still_rejected(self):
        passage = main.Passage(1, "Amtlicher Quellentext.")
        self.assertIsNone(main.source_quote("erfundener Text", [passage], 1))


class StrictJsonTests(unittest.TestCase):
    def test_model_json_duplicate_label_key_rejected(self):
        with self.assertRaises(ValueError):
            main.parse_model_json('{"label":1,"label":2,"evidence":[]}')
        # and through the regex-fallback path
        with self.assertRaises(ValueError):
            main.parse_model_json('noise {"label":0,"label":1} tail')

    def test_provider_json_duplicate_key_rejected(self):
        env = {"BASE_URL": "http://x", "API_KEY": "k",
               "MODEL_NAME": "swiss-ai/Apertus-v1.5-8B"}
        body = b'{"choices":[{"message":{"content":"{\\"label\\":1,\\"evidence\\":[]}"}}],' \
               b'"usage":{"prompt_tokens":1,"completion_tokens":1},' \
               b'"usage":{"prompt_tokens":9,"completion_tokens":9}}'
        response = mock.MagicMock()
        response.read.return_value = body
        cm = mock.MagicMock()
        cm.__enter__.return_value = response
        cm.__exit__.return_value = False
        with mock.patch.dict("os.environ", env, clear=False), \
             mock.patch.object(main.urllib.request, "urlopen", return_value=cm):
            with self.assertRaises(ValueError):
                main.invoke_apertus(case_b(), "B", "ctx")

    def test_invalid_strategy_rejected_before_model_call(self):
        opener = mock.MagicMock()
        with mock.patch.object(main.urllib.request, "urlopen", opener):
            with self.assertRaises(ValueError):
                main.predict_case(case_b(), Path("in.jsonl"), Path("/data"),
                                  "selectd", 120000)
        opener.assert_not_called()


class EvaluatorShapeTests(unittest.TestCase):
    def run_eval(self, tmp, gold_rows, pred_rows, names=("run",)):
        gold = Path(tmp) / "gold.jsonl"
        gold.write_text("".join(json.dumps(r) + "\n" for r in gold_rows),
                        encoding="utf-8")
        specs = []
        for name, rows in zip(names, pred_rows):
            p = Path(tmp) / f"{name}.jsonl"
            p.write_text("".join(json.dumps(r) + "\n" for r in rows),
                         encoding="utf-8")
            specs.append(f"{name}={p}")
        out = Path(tmp) / "report.json"
        code = evaluate_dev.main(["--gold", str(gold),
                                  *sum((["--predictions", s] for s in specs), []),
                                  "--output", str(out)])
        return code, out

    def test_evidence_over_five_items_is_schema_valid(self):
        # Official: only first 5 items are scored; a longer list is legal.
        ev = [{"page": None, "text": f"zitat {i}"} for i in range(7)]
        gold = [gold_row("g1", 1)]
        preds = [pred_row("g1", 1, "neutral", evidence=ev)]
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self.run_eval(tmp, gold, [preds])
            self.assertEqual(code, 0)
            report = json.loads(out.read_text(encoding="utf-8"))
            run = report["runs"]["run"]
            self.assertEqual(run["status"], "COMPLETE")
            self.assertEqual(run["valid_predictions"], 1)

    def test_duplicate_run_label_fails_without_overwrite(self):
        gold = [gold_row("g1", 1)]
        preds = [[pred_row("g1", 1)], [pred_row("g1", 0, "entailment")]]
        with tempfile.TemporaryDirectory() as tmp:
            # same name twice -> nonzero exit, no report written/overwritten
            code, out = self.run_eval(tmp, gold, preds, names=("run", "run"))
            self.assertEqual(code, 2)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
