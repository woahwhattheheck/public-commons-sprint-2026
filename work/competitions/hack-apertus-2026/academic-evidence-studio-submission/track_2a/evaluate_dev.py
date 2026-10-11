#!/usr/bin/env python3
"""Compute OST dev metrics from organizer labels and solution predictions."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any

LABELS = (0, 1, 2)


def load(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def metrics(rows: list[dict[str, Any]], predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    confusion = [[0 for _ in LABELS] for _ in LABELS]
    valid = 0
    correct = 0
    latencies: list[float] = []
    input_tokens: list[int] = []
    output_tokens: list[int] = []
    for row in rows:
        expected = int(row["label"])
        prediction = predictions.get(str(row["id"]))
        actual = prediction.get("label") if isinstance(prediction, dict) else None
        if actual not in LABELS:
            continue
        valid += 1
        confusion[expected][actual] += 1
        correct += int(expected == actual)
        item_metrics = prediction.get("metrics") or {}
        if isinstance(item_metrics.get("inference_time_ms"), (int, float)):
            latencies.append(float(item_metrics["inference_time_ms"]))
        if isinstance(item_metrics.get("input_tokens"), int):
            input_tokens.append(item_metrics["input_tokens"])
        if isinstance(item_metrics.get("output_tokens"), int):
            output_tokens.append(item_metrics["output_tokens"])
    f1: list[float] = []
    for label in LABELS:
        tp = confusion[label][label]
        fp = sum(confusion[row][label] for row in LABELS if row != label)
        fn = sum(confusion[label][column] for column in LABELS if column != label)
        denominator = 2 * tp + fp + fn
        f1.append((2 * tp / denominator) if denominator else 0.0)
    denominator = len(rows)
    return {
        "denominator": denominator,
        "valid_predictions": valid,
        "abstentions": denominator - valid,
        "accuracy": correct / denominator if denominator else 0.0,
        "macro_f1": sum(f1) / len(LABELS),
        "class_f1": {str(label): f1[label] for label in LABELS},
        "confusion_gold_rows_pred_columns": confusion,
        "mean_inference_time_ms": statistics.fmean(latencies) if latencies else None,
        "mean_input_tokens": statistics.fmean(input_tokens) if input_tokens else None,
        "mean_output_tokens": statistics.fmean(output_tokens) if output_tokens else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", required=True, type=Path)
    parser.add_argument("--predictions", required=True, action="append", help="PATH or NAME=PATH")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    gold = load(args.gold)
    report: dict[str, Any] = {"gold_rows": len(gold), "runs": {}}
    for specification in args.predictions:
        name, separator, raw_path = specification.partition("=")
        if not separator:
            raw_path = name
            name = Path(raw_path).stem
        prediction_rows = load(Path(raw_path))
        by_id = {str(row.get("id")): row for row in prediction_rows}
        run = metrics(gold, by_id)
        run["language_pairs"] = {}
        pairs = sorted({(row["reference_language"], row["claim_language"]) for row in gold})
        for source, claim in pairs:
            subset = [row for row in gold if row["reference_language"] == source and row["claim_language"] == claim]
            run["language_pairs"][f"{source}->{claim}"] = metrics(subset, by_id)
        report["runs"][name] = run
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
