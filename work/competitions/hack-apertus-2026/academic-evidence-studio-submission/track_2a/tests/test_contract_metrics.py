"""Focused contract/metrics regressions for the 086 correction.

ONLY new discriminating behavior is exercised; the older accepted tests are
not touched or rerun. Everything is stdlib + mocks: no model calls, no
network, no PDF downloads, no package installs.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import evaluate_dev
import main


def case_b(**over):
    case = {
        "id": "c1",
        "vote": "Volksinitiative",
        "claim": {"text": "Der Text stuetzt die Behauptung.", "language": "de"},
        "reference": {"text": "Amtlicher Referenztext der Vorlage.", "language": "de"},
    }
    case.update(over)
    return case


def prediction_row(case_id="c1", label=1, label_name="neutral", evidence=None,
                   metrics=None):
    return {
        "id": case_id,
        "label": label,
        "label_name": label_name,
        "evidence": [] if evidence is None else evidence,
        "metrics": {"input_tokens": 10, "output_tokens": 4,
                    "inference_time_ms": 123} if metrics is None else metrics,
    }


def gold_row(case_id="g1", label=1, src="de", dst="de"):
    return {"id": case_id, "label": label,
            "reference_language": src, "claim_language": dst}


def fake_response(payload):
    body = json.dumps(payload).encode("utf-8")
    response = mock.MagicMock()
    response.__enter__.return_value.read.return_value = body
    response.read.return_value = body
    cm = mock.MagicMock()
    cm.__enter__.return_value = response
    cm.__exit__.return_value = False
    return cm


MODEL_OK = {
    "choices": [{"message": {"content": '{"label":1,"evidence":[]}'}}],
    "usage": {"prompt_tokens": 11, "completion_tokens": 3},
}


class InputContractTests(unittest.TestCase):
    def test_bool_and_numeric_ids_rejected_before_model(self):
        for bad in (True, 7, "", "   ", None):
            with self.subTest(bad=bad):
                with self.assertRaises(main.CaseError):
                    main.validate_case(case_b(id=bad))

    def test_int_id_never_reaches_model(self):
        opener = mock.MagicMock()
        with mock.patch.object(main.urllib.request, "urlopen", opener):
            with self.assertRaises(main.CaseError):
                main.predict_case(case_b(id=42), Path("in.jsonl"),
                                  Path("/data"), "full", 120000)
        opener.assert_not_called()

    def test_empty_vote_and_missing_claim_language_rejected(self):
        with self.assertRaises(main.CaseError):
            main.validate_case(case_b(vote="   "))
        bad_claim = {"text": "x", "language": "en"}
        with self.assertRaises(main.CaseError):
            main.validate_case(case_b(claim=bad_claim))
        no_lang = {"text": "x"}
        with self.assertRaises(main.CaseError):
            main.validate_case(case_b(claim=no_lang))

    def test_exactly_one_source_and_malformed_other_rejected(self):
        both = case_b(booklet={"path": "b.pdf", "language": "de"})
        with self.assertRaises(main.CaseError):
            main.validate_case(both)          # two sources: invalid
        malformed_other = case_b(reference=42, booklet={"path": "b.pdf",
                                                        "language": "de"})
        with self.assertRaises(main.CaseError):
            main.validate_case(malformed_other)  # other key present, malformed
        neither = case_b()
        del neither["reference"]
        with self.assertRaises(main.CaseError):
            main.validate_case(neither)
        bad_source_lang = case_b(reference={"text": "t", "language": "en"})
        with self.assertRaises(main.CaseError):
            main.validate_case(bad_source_lang)

    def test_strict_json_rejects_duplicate_keys_and_nonfinite(self):
        with self.assertRaises(ValueError):
            main.strict_loads('{"id":"a","id":"b"}')
        with self.assertRaises(ValueError):
            main.strict_loads('{"x": NaN}')
        with self.assertRaises(ValueError):
            main.strict_loads('{"x": Infinity}')


class ModelOutputContractTests(unittest.TestCase):
    def test_label_must_be_real_int(self):
        pages = [main.Passage(None, "x")]
        for bad in (True, 1.0, "2", None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    main.validate_prediction({"label": bad, "evidence": []},
                                             "B", pages)
        label, _ = main.validate_prediction({"label": 2, "evidence": []},
                                            "B", pages)
        self.assertEqual(label, 2)

    def test_task_b_nonnull_evidence_page_dropped(self):
        pages = [main.Passage(None, "Amtlicher Referenztext")]
        raw = {"label": 2,
               "evidence": [{"page": 3, "text": "Amtlicher Referenztext"},
                            {"page": None, "text": "Amtlicher Referenztext"}]}
        _, evidence = main.validate_prediction(raw, "B", pages)
        self.assertEqual(evidence, [{"page": None, "text": "Amtlicher Referenztext"}])

    def test_task_a_wrong_page_corrected_to_verified_page(self):
        pages = [main.Passage(1, "Uneb relevante Seite"),
                 main.Passage(4, "Entscheidender Quellentext hier.")]
        raw = {"label": 0,
               "evidence": [{"page": 1, "text": "Entscheidender Quellentext hier."}]}
        _, evidence = main.validate_prediction(raw, "A", pages)
        self.assertEqual(evidence[0]["page"], 4)
        self.assertEqual(evidence[0]["text"], "Entscheidender Quellentext hier.")


class ModelMetricsTests(unittest.TestCase):
    def test_missing_usage_fails_loudly(self):
        payload = {"choices": [{"message": {"content": '{"label":1,"evidence":[]}'}}]}
        env = {"BASE_URL": "http://x", "API_KEY": "k",
               "MODEL_NAME": "swiss-ai/Apertus-v1.5-8B"}
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(main.urllib.request, "urlopen",
                               return_value=fake_response(payload)):
            with self.assertRaisesRegex(RuntimeError, "usage"):
                main.invoke_apertus(case_b(), "B", "ctx")

    def test_nonfinite_usage_fails_loudly(self):
        payload = dict(MODEL_OK)
        payload["usage"] = {"prompt_tokens": float("nan"), "completion_tokens": 3}
        env = {"BASE_URL": "http://x", "API_KEY": "k",
               "MODEL_NAME": "swiss-ai/Apertus-v1.5-8B"}
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(main.urllib.request, "urlopen",
                               return_value=fake_response(payload)):
            with self.assertRaisesRegex(RuntimeError, "token metrics"):
                main.invoke_apertus(case_b(), "B", "ctx")

    def test_inference_time_is_full_case_wallclock(self):
        # perf_counter sequence: predict t0, http start, http end, predict end.
        ticks = iter([0.0, 5.0, 5.3, 8.0])
        env = {"BASE_URL": "http://x", "API_KEY": "k",
               "MODEL_NAME": "swiss-ai/Apertus-v1.5-8B"}
        with mock.patch.dict(os.environ, env, clear=False), \
             mock.patch.object(main.time, "perf_counter", side_effect=lambda: next(ticks)), \
             mock.patch.object(main.urllib.request, "urlopen",
                               return_value=fake_response(MODEL_OK)):
            pred = main.predict_case(case_b(), Path("in.jsonl"),
                                     Path("/data"), "full", 120000)
        self.assertEqual(pred["metrics"]["inference_time_ms"], 8000)
        self.assertEqual(pred["metrics"]["input_tokens"], 11)


def run_eval(tmp, gold_rows, pred_rows, pred_name="run"):
    gold = Path(tmp) / "gold.jsonl"
    gold.write_text("".join(json.dumps(r) + "\n" for r in gold_rows),
                    encoding="utf-8")
    preds = Path(tmp) / f"{pred_name}.jsonl"
    if isinstance(pred_rows, str):
        preds.write_text(pred_rows, encoding="utf-8")
    else:
        preds.write_text("".join(json.dumps(r) + "\n" for r in pred_rows),
                         encoding="utf-8")
    out = Path(tmp) / "report.json"
    code = evaluate_dev.main(["--gold", str(gold),
                              "--predictions", f"{pred_name}={preds}",
                              "--output", str(out)])
    if not out.exists():
        return code, None
    return code, json.loads(out.read_text(encoding="utf-8"))["runs"][pred_name]


class EvaluatorAccountingTests(unittest.TestCase):
    def test_missing_prediction_counts_wrong_and_fn(self):
        gold = [gold_row("g1", 0), gold_row("g2", 1)]
        preds = [prediction_row("g1", 0, "entailment")]
        with tempfile.TemporaryDirectory() as tmp:
            code, run = run_eval(tmp, gold, preds)
        self.assertEqual(code, 1)
        self.assertEqual(run["status"], "INCOMPLETE")
        self.assertEqual(run["missing_predictions"], 1)
        self.assertEqual(run["class_false_negatives"]["1"], 1)
        # g2 unanswered: class-1 f1 must be 0, not silently dropped.
        self.assertEqual(run["class_f1"]["1"], 0.0)
        self.assertAlmostEqual(run["macro_f1"], (1.0 + 0.0 + 0.0) / 3)

    def test_absent_class_still_penalizes_macrof1(self):
        gold = [gold_row("g1", 0), gold_row("g2", 0), gold_row("g3", 2)]
        preds = [prediction_row("g1", 0, "entailment"),
                 prediction_row("g2", 0, "entailment")]
        with tempfile.TemporaryDirectory() as tmp:
            code, run = run_eval(tmp, gold, preds)
        self.assertEqual(run["status"], "INCOMPLETE")
        self.assertEqual(run["class_f1"]["2"], 0.0)
        self.assertEqual(run["class_support"]["2"], 1)

    def test_duplicate_and_unknown_ids_recorded_not_overwritten(self):
        gold = [gold_row("g1", 1)]
        dup = prediction_row("g1", 1)
        preds = [dup, prediction_row("g1", 0, "entailment"),
                 prediction_row("stranger", 1)]
        with tempfile.TemporaryDirectory() as tmp:
            code, run = run_eval(tmp, gold, preds)
        self.assertEqual(code, 1)
        self.assertEqual(run["status"], "INVALID")
        self.assertEqual(run["failure_counts"]["duplicate_id"], 2)
        self.assertEqual(run["failure_counts"]["unknown_id"], 1)
        # The duplicated gold id yields no valid answer -> counts wrong.
        self.assertEqual(run["valid_predictions"], 0)
        self.assertEqual(run["wrong"], 1)

    def test_invalid_schema_counts_wrong(self):
        gold = [gold_row("g1", 0), gold_row("g2", 1), gold_row("g3", 2)]
        preds = [
            prediction_row("g1", True, "entailment"),          # bool label
            prediction_row("g2", 1, "entailment"),              # label_name mismatch
            prediction_row("g3", 2, "contradiction",
                           metrics={"input_tokens": 1}),        # missing metric keys
        ]
        with tempfile.TemporaryDirectory() as tmp:
            code, run = run_eval(tmp, gold, preds)
        self.assertEqual(code, 1)
        self.assertEqual(run["status"], "INVALID")
        self.assertEqual(run["failure_counts"]["invalid_schema"], 3)
        self.assertEqual(run["valid_predictions"], 0)
        self.assertEqual(run["wrong"], 3)
        self.assertEqual(run["macro_f1"], 0.0)

    def test_gold_malformed_or_duplicate_aborts(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _ = run_eval(tmp, [], [prediction_row("g1", 1)])
            self.assertEqual(code, 2)
        with tempfile.TemporaryDirectory() as tmp:
            gold = Path(tmp) / "gold.jsonl"
            gold.write_text(json.dumps(gold_row("g1", 1)) + "\n" +
                            json.dumps(gold_row("g1", 2)) + "\n",
                            encoding="utf-8")
            self.assertEqual(evaluate_dev.main(
                ["--gold", str(gold), "--predictions", "x"]), 2)
        with tempfile.TemporaryDirectory() as tmp:
            gold = Path(tmp) / "gold.jsonl"
            gold.write_text('{"id":"g1","id":"g2","label":1,'
                            '"reference_language":"de","claim_language":"de"}\n',
                            encoding="utf-8")
            self.assertEqual(evaluate_dev.main(
                ["--gold", str(gold), "--predictions", "x"]), 2)

    def test_complete_run_exits_zero(self):
        gold = [gold_row("g1", 0, "de", "fr"), gold_row("g2", 1, "fr", "it"),
                gold_row("g3", 2, "it", "de")]
        preds = [prediction_row("g1", 0, "entailment"),
                 prediction_row("g2", 1),
                 prediction_row("g3", 2, "contradiction")]
        with tempfile.TemporaryDirectory() as tmp:
            code, run = run_eval(tmp, gold, preds)
        self.assertEqual(code, 0)
        self.assertEqual(run["status"], "COMPLETE")
        self.assertEqual(sorted(run["language_pairs"]),
                         ["de->fr", "fr->it", "it->de"])
        self.assertAlmostEqual(run["macro_f1"], 1.0)


if __name__ == "__main__":
    unittest.main()
