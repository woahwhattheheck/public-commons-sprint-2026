#!/usr/bin/env python3
"""Compute OST dev metrics from organizer labels and solution predictions.

DEVELOPMENT DIAGNOSTIC ONLY. The released default/train split is not the
private held-out benchmark; numbers here must never be presented as an
official held-out score.

Correctness contract (deliberately stricter than the previous version):

- Gold and prediction files are parsed with the strict loader (no duplicate
  JSON keys, no non-finite numbers).
- Gold rows must be complete (non-empty string id, integer label 0|1|2,
  de/fr/it language fields) and unique; empty, duplicate or malformed gold
  aborts instead of producing a misleading score.
- Predictions are matched to gold one-to-one. Duplicate prediction ids and
  ids absent from gold are recorded as failures, never silently overwritten
  or ignored. Missing and schema-invalid predictions count WRONG: they enter
  the per-class false-negative denominators, so gold classes the run never
  attempted still lower macro-F1.
- Every prediction must satisfy the complete official output schema
  (exact keys, integer label, agreeing label_name, evidence shape, finite
  non-negative metrics) to count as a valid answer.
- Each run reports COMPLETE / INCOMPLETE / INVALID and the process exits
  non-zero unless every run is COMPLETE.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any

LABELS = (0, 1, 2)
LABEL_NAMES = {0: "entailment", 1: "neutral", 2: "contradiction"}
LANGS = ("de", "fr", "it")
MAX_EVIDENCE_CHARS = 5000
OUTPUT_KEYS = {"id", "label", "label_name", "evidence", "metrics"}
METRIC_KEYS = {"input_tokens", "output_tokens", "inference_time_ms"}

STATUS_COMPLETE = "COMPLETE"
STATUS_INCOMPLETE = "INCOMPLETE"
STATUS_INVALID = "INVALID"


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-finite JSON number: {name}")


def strict_loads(text: str | bytes) -> Any:
    return json.loads(
        text,
        object_pairs_hook=_no_duplicate_keys,
        parse_constant=_reject_constant,
    )


def load(path: Path) -> list[dict[str, Any]]:
    """Strict JSONL load; any malformed line aborts the evaluation."""
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        try:
            rows.append(strict_loads(line))
        except ValueError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
    return rows


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_gold(rows: list[Any]) -> list[dict[str, Any]]:
    """Return validated gold rows or raise; no misleading score is emitted."""
    if not rows:
        raise ValueError("gold file is empty: a score over zero cases is meaningless")
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        where = f"gold row {index + 1}"
        if not isinstance(row, dict):
            raise ValueError(f"{where}: not a JSON object")
        if not _nonempty_str(row.get("id")):
            raise ValueError(f"{where}: id must be a non-empty string")
        if row["id"] in seen:
            raise ValueError(f"{where}: duplicate gold id {row['id']!r}")
        seen.add(row["id"])
        label = row.get("label")
        if type(label) is not int or label not in LABELS:
            raise ValueError(f"{where}: label must be integer 0|1|2")
        for field in ("reference_language", "claim_language"):
            if row.get(field) not in LANGS:
                raise ValueError(f"{where}: {field} must be one of de|fr|it")
        out.append(row)
    return out


def _nonneg_int(value: Any) -> bool:
    return type(value) is int and value >= 0


def _nonneg_finite(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def validate_prediction(row: Any) -> str | None:
    """Return None if the row satisfies the complete official output schema,
    else a short non-secret reason string."""
    if not isinstance(row, dict):
        return "not a JSON object"
    if set(row.keys()) != OUTPUT_KEYS:
        return "keys must be exactly id,label,label_name,evidence,metrics"
    if not _nonempty_str(row.get("id")):
        return "id must be a non-empty string"
    label = row["label"]
    if type(label) is not int or label not in LABELS:
        return "label must be integer 0|1|2"
    if row["label_name"] != LABEL_NAMES[label]:
        return "label_name does not agree with label"
    evidence = row["evidence"]
    # The official rules score only the FIRST 5 evidence items; they do not
    # forbid a longer list. Every supplied item must still be schema-shaped,
    # but the count itself is not an eligibility restriction.
    if not isinstance(evidence, list):
        return "evidence must be a list"
    for item in evidence:
        if not isinstance(item, dict) or set(item.keys()) != {"page", "text"}:
            return "evidence items must be exactly {page,text}"
        page = item["page"]
        if page is not None and (type(page) is not int or page < 1):
            return "evidence page must be null or a 1-based integer"
        if (
            not isinstance(item["text"], str)
            or not item["text"]
            or len(item["text"]) > MAX_EVIDENCE_CHARS
        ):
            return "evidence text must be 1..5000 characters"
    metrics = row["metrics"]
    if not isinstance(metrics, dict) or set(metrics.keys()) != METRIC_KEYS:
        return "metrics must be exactly input_tokens,output_tokens,inference_time_ms"
    if not _nonneg_int(metrics["input_tokens"]) or not _nonneg_int(metrics["output_tokens"]):
        return "token metrics must be non-negative integers"
    if not _nonneg_finite(metrics["inference_time_ms"]):
        return "inference_time_ms must be a finite non-negative number"
    return None


def index_predictions(
    rows: list[Any], gold_ids: set[str]
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """One-to-one accounting: duplicates and unknown ids are recorded, and a
    duplicated or unknown id never contributes a valid prediction."""
    counts: dict[str, int] = {}
    invalid_ids: dict[str, int] = {}
    seen: set[str] = set()
    duplicates: set[str] = set()
    for row in rows:
        row_id = row.get("id") if isinstance(row, dict) else None
        if isinstance(row_id, str) and row_id in seen:
            duplicates.add(row_id)
        if isinstance(row_id, str):
            seen.add(row_id)
    valid: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = row.get("id") if isinstance(row, dict) else None
        key = row_id if isinstance(row_id, str) else "<missing-or-nonstring-id>"
        reason = validate_prediction(row)
        if reason is not None:
            counts["invalid_schema"] = counts.get("invalid_schema", 0) + 1
            invalid_ids[key] = invalid_ids.get(key, 0) + 1
            continue
        if row_id not in gold_ids:
            counts["unknown_id"] = counts.get("unknown_id", 0) + 1
            invalid_ids[row_id] = invalid_ids.get(row_id, 0) + 1
            continue
        if row_id in duplicates:
            counts["duplicate_id"] = counts.get("duplicate_id", 0) + 1
            invalid_ids[row_id] = invalid_ids.get(row_id, 0) + 1
            continue
        valid[row_id] = row
    return valid, {"counts": counts, "invalid_or_rejected_ids": dict(sorted(invalid_ids.items()))}


def metrics(rows: list[dict[str, Any]], predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Score `rows` against `predictions` (id -> validated prediction).

    Missing or invalid predictions count wrong and enter the per-class
    false-negative denominators: a gold class the run never answered still
    lowers macro-F1. Subset metrics (language pairs) report their own
    missing count over their own denominator.
    """
    confusion = [[0 for _ in LABELS] for _ in LABELS]
    valid = 0
    correct = 0
    fn_per_class = {label: 0 for label in LABELS}
    fp_per_class = {label: 0 for label in LABELS}
    support = {label: 0 for label in LABELS}
    latencies: list[float] = []
    input_tokens: list[int] = []
    output_tokens: list[int] = []
    missing = 0
    for row in rows:
        expected = row["label"]
        support[expected] += 1
        prediction = predictions.get(str(row["id"]))
        if prediction is None:
            missing += 1
            fn_per_class[expected] += 1  # unaccounted-for gold counts as FN
            continue
        actual = prediction["label"]
        valid += 1
        confusion[expected][actual] += 1
        if expected == actual:
            correct += 1
        else:
            fn_per_class[expected] += 1
            fp_per_class[actual] += 1
        item_metrics = prediction["metrics"]
        latencies.append(float(item_metrics["inference_time_ms"]))
        input_tokens.append(item_metrics["input_tokens"])
        output_tokens.append(item_metrics["output_tokens"])
    f1: list[float] = []
    for label in LABELS:
        tp = confusion[label][label]
        denominator = 2 * tp + fp_per_class[label] + fn_per_class[label]
        f1.append((2 * tp / denominator) if denominator else 0.0)
    denominator = len(rows)
    result: dict[str, Any] = {
        "denominator": denominator,
        "valid_predictions": valid,
        "missing_predictions": missing,
        "wrong": denominator - correct,
        "accuracy": correct / denominator if denominator else 0.0,
        "macro_f1": sum(f1) / len(LABELS),
        "class_f1": {str(label): f1[label] for label in LABELS},
        "class_support": {str(label): support[label] for label in LABELS},
        "class_false_negatives": {str(label): fn_per_class[label] for label in LABELS},
        "class_false_positives": {str(label): fp_per_class[label] for label in LABELS},
        "confusion_gold_rows_pred_columns": confusion,
        "mean_inference_time_ms": statistics.fmean(latencies) if latencies else None,
        "mean_input_tokens": statistics.fmean(input_tokens) if input_tokens else None,
        "mean_output_tokens": statistics.fmean(output_tokens) if output_tokens else None,
    }
    return result


def evaluate_run(gold: list[dict[str, Any]], prediction_rows: list[Any]) -> dict[str, Any]:
    gold_ids = {row["id"] for row in gold}
    valid, failures = index_predictions(prediction_rows, gold_ids)
    run = metrics(gold, valid)
    counts = failures["counts"]
    invalid_schema = counts.get("invalid_schema", 0)
    unknown = counts.get("unknown_id", 0)
    duplicated = counts.get("duplicate_id", 0)
    # Missing = gold ids that received no schema-valid non-duplicate response.
    run["failure_counts"] = {
        "missing_predictions": run["missing_predictions"],
        "invalid_schema": invalid_schema,
        "unknown_id": unknown,
        "duplicate_id": duplicated,
    }
    run["invalid_or_rejected_ids"] = failures["invalid_or_rejected_ids"]
    if invalid_schema or unknown or duplicated:
        run["status"] = STATUS_INVALID
    elif run["missing_predictions"]:
        run["status"] = STATUS_INCOMPLETE
    else:
        run["status"] = STATUS_COMPLETE
    pairs = sorted({(row["reference_language"], row["claim_language"]) for row in gold})
    run["language_pairs"] = {}
    for source, claim in pairs:
        subset = [
            row
            for row in gold
            if row["reference_language"] == source and row["claim_language"] == claim
        ]
        run["language_pairs"][f"{source}->{claim}"] = metrics(subset, valid)
    return run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", required=True, type=Path)
    parser.add_argument("--predictions", required=True, action="append", help="PATH or NAME=PATH")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    try:
        gold = validate_gold(load(args.gold))
    except (OSError, ValueError) as exc:
        print(f"error: invalid gold file: {exc}", file=sys.stderr)
        return 2

    report: dict[str, Any] = {
        "report_kind": "development_diagnostic_not_official_held_out",
        "gold_rows": len(gold),
        "runs": {},
    }
    all_complete = True
    for specification in args.predictions:
        name, separator, raw_path = specification.partition("=")
        if not separator:
            raw_path = name
            name = Path(raw_path).stem
        if not name.strip():
            print(f"error: empty run label in --predictions {specification!r}",
                  file=sys.stderr)
            return 2
        if name in report["runs"]:
            print(f"error: duplicate run label {name!r} would overwrite an "
                  f"earlier report run; use unique NAME=PATH labels",
                  file=sys.stderr)
            return 2
        try:
            prediction_rows = load(Path(raw_path))
        except (OSError, ValueError) as exc:
            report["runs"][name] = {
                "status": STATUS_INVALID,
                "error": f"unreadable or malformed predictions file: {exc}",
            }
            all_complete = False
            continue
        run = evaluate_run(gold, prediction_rows)
        if run["status"] != STATUS_COMPLETE:
            all_complete = False
        report["runs"][name] = run
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if all_complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
