"""Strict held-out evaluation for RSNA Knee's twelve binary targets.

Missing labels are excluded per target, never filled with negatives. A macro
score exists only when every target has both classes. These functions do not
attest that input labels are official, gold, patient-independent, or out of fold;
the caller must retain that provenance and pass a gold-only validation mask.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from numbers import Integral
from pathlib import Path
from typing import Mapping, Sequence

LABELS = (
    "ACL", "MCL", "Medial Meniscus", "Lateral Meniscus", "Medial OA",
    "Lateral OA", "PF OA", "Effusion", "Synovitis", "Baker's", "Contusion",
    "Fracture",
)
STUDY_KEY = "StudyInstanceUID"


class EvaluationError(ValueError):
    """An input contract or leakage constraint was violated."""


def _missing(value: object) -> bool:
    if value is None or (isinstance(value, str) and not value.strip()):
        return True
    try:
        return math.isnan(float(value))
    except (ValueError, TypeError, OverflowError):
        return False


def _matrix(values: Sequence[Sequence[object]], name: str) -> list[list[object]]:
    result = [list(row) for row in values]
    if not result:
        raise EvaluationError(f"{name}: no study rows")
    for i, row in enumerate(result):
        if len(row) != len(LABELS):
            raise EvaluationError(f"{name}[{i}]: expected exactly 12 columns")
    return result


def _binary(value: object, context: str) -> int:
    try:
        number = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise EvaluationError(f"{context}: expected binary 0 or 1") from exc
    if number not in (0.0, 1.0):
        raise EvaluationError(f"{context}: expected binary 0 or 1, got {value!r}")
    return int(number)


def _targets_and_mask(targets, mask=None):
    target_rows = _matrix(targets, "targets")
    mask_rows = None if mask is None else _matrix(mask, "mask")
    if mask_rows is not None and len(mask_rows) != len(target_rows):
        raise EvaluationError("targets and mask have different row counts")
    cleaned, observed = [], []
    for i, row in enumerate(target_rows):
        values, flags = [], []
        for j, label in enumerate(LABELS):
            include = (
                not _missing(row[j]) if mask_rows is None
                else bool(_binary(mask_rows[i][j], f"mask[{i}] {label}"))
            )
            values.append(_binary(row[j], f"targets[{i}] {label}") if include else 0)
            flags.append(include)
        cleaned.append(values)
        observed.append(flags)
    return cleaned, observed


def _prediction_rows(predictions, n_rows: int):
    rows = _matrix(predictions, "predictions")
    if len(rows) != n_rows:
        raise EvaluationError("targets and predictions have different row counts")
    for i, row in enumerate(rows):
        for j, label in enumerate(LABELS):
            try:
                value = float(row[j])
            except (ValueError, TypeError, OverflowError) as exc:
                raise EvaluationError(f"predictions[{i}] {label}: not numeric") from exc
            if not math.isfinite(value) or not 0.0 <= value <= 1.0:
                raise EvaluationError(f"predictions[{i}] {label}: expected finite [0,1]")
            row[j] = value
    return rows


def _binary_auc(targets: Sequence[int], scores: Sequence[float]) -> float:
    """Mann-Whitney rank AUC; tied predictions receive half credit, O(N log N)."""
    ranked = sorted(zip(scores, targets), key=lambda pair: pair[0])
    n_positive = sum(targets)
    n_negative = len(targets) - n_positive
    if not n_positive or not n_negative:
        raise EvaluationError("AUC requires both target classes")
    rank_sum = 0.0
    i = 0
    while i < len(ranked):
        end = i + 1
        while end < len(ranked) and ranked[end][0] == ranked[i][0]:
            end += 1
        mean_rank = (i + 1 + end) / 2.0
        rank_sum += mean_rank * sum(target for _, target in ranked[i:end])
        i = end
    return (rank_sum - n_positive * (n_positive + 1) / 2.0) / (n_positive * n_negative)


def label_statistics(targets, mask=None) -> dict[str, object]:
    """Return per-label prevalence and training-only candidate BCE pos_weight.

    ``pos_weight`` is N_negative/N_positive, not a recommendation to apply it.
    Single-class/empty targets return null rather than a degenerate loss weight.
    Derive training weights from training rows only;
    compare any weighted-loss candidate on the same frozen held-out split.
    """
    values, observed = _targets_and_mask(targets, mask)
    per_label = {}
    for j, label in enumerate(LABELS):
        present = [row[j] for row, flags in zip(values, observed) if flags[j]]
        positive = sum(present)
        negative = len(present) - positive
        per_label[label] = {
            "observed": len(present), "missing": len(values) - len(present),
            "positive": positive, "negative": negative,
            "prevalence": positive / len(present) if present else None,
            "both_classes": bool(positive and negative),
            "pos_weight": negative / positive if positive and negative else None,
        }
    return {"rows": len(values), "labels": list(LABELS), "per_label": per_label}


def evaluate_predictions(targets, predictions, mask=None) -> dict[str, object]:
    """Return all twelve AUCs and their strict arithmetic mean, or null.

    Arrays must have shape [studies, 12] in LABELS order. With no explicit mask,
    only None, empty strings and NaN count as missing; -1 is not silently masked.
    Every prediction is validated, including those whose target is masked out.
    A single-class target makes macro_auc null, never an eleven-label mean.
    """
    values, observed = _targets_and_mask(targets, mask)
    scores = _prediction_rows(predictions, len(values))
    result = label_statistics(values, observed)
    undefined, aucs = [], []
    for j, label in enumerate(LABELS):
        stats = result["per_label"][label]
        if not stats["both_classes"]:
            status = (
                "no_observed_labels" if not stats["observed"] else
                "no_positive_labels" if not stats["positive"] else "no_negative_labels"
            )
            stats.update({"auc": None, "status": status})
            undefined.append(label)
            continue
        target = [row[j] for row, flags in zip(values, observed) if flags[j]]
        score = [row[j] for row, flags in zip(scores, observed) if flags[j]]
        auc = _binary_auc(target, score)
        stats.update({"auc": auc, "status": "defined"})
        aucs.append(auc)
    result.update({
        "metric": "unweighted_mean_of_12_per_target_ROC_AUCs",
        "macro_auc": math.fsum(aucs) / len(LABELS) if not undefined else None,
        "evaluable_labels": len(aucs), "undefined_labels": undefined,
        "status": "complete" if not undefined else "undefined_12_target_macro",
        "score_scope": "supplied_heldout_predictions_not_official_leaderboard",
    })
    return result


def compare_predictions(targets, baseline, candidate, mask=None) -> dict[str, object]:
    """Paired score deltas on identical rows/mask; not a significance claim."""
    before = evaluate_predictions(targets, baseline, mask)
    after = evaluate_predictions(targets, candidate, mask)
    delta = None
    if before["macro_auc"] is not None and after["macro_auc"] is not None:
        delta = after["macro_auc"] - before["macro_auc"]
    return {
        "baseline": before, "candidate": after, "macro_auc_delta": delta,
        "per_label_auc_delta": {
            label: (
                after["per_label"][label]["auc"] - before["per_label"][label]["auc"]
                if before["per_label"][label]["auc"] is not None else None
            ) for label in LABELS
        },
        "interpretation": "paired_descriptive_delta_not_statistical_significance",
    }


def _identifier(value: object, context: str) -> str:
    if _missing(value) or str(value).strip().lower() in {"none", "null", "nan"}:
        raise EvaluationError(f"{context}: missing identifier")
    result = str(value)
    if result != result.strip():
        raise EvaluationError(f"{context}: identifier contains surrounding whitespace")
    return result


def _row_targets(rows: Sequence[Mapping[str, object]]):
    for i, row in enumerate(rows):
        missing = [label for label in LABELS if label not in row]
        if missing:
            raise EvaluationError(f"row {i}: missing target columns {missing}")
    return [[row[label] for label in LABELS] for row in rows]


def audit_grouped_split(
    rows, folds, group_key, study_key=STUDY_KEY, validation_fold=0, mask=None,
) -> dict[str, object]:
    """Reject group/study fold leakage; report every held-out label's coverage.

    The group key must be a real patient identifier when available. Study-only
    grouping prevents study leakage but does not establish patient independence.
    The caller decides whether missing class coverage blocks a training run.
    """
    rows, folds = list(rows), list(folds)
    if not rows or len(rows) != len(folds):
        raise EvaluationError("split rows/folds must have equal nonzero lengths")
    if not group_key:
        raise EvaluationError("an explicit group_key is required")
    if any(isinstance(fold, bool) or not isinstance(fold, Integral) for fold in folds):
        raise EvaluationError("fold IDs must be integers")
    folds = [int(fold) for fold in folds]
    targets, observed = _targets_and_mask(_row_targets(rows), mask)
    group_folds, study_folds, study_groups = {}, {}, {}
    for i, (row, fold) in enumerate(zip(rows, folds)):
        group = _identifier(row.get(group_key), f"row {i} {group_key}")
        study = _identifier(row.get(study_key), f"row {i} {study_key}")
        group_folds.setdefault(group, set()).add(fold)
        study_folds.setdefault(study, set()).add(fold)
        study_groups.setdefault(study, set()).add(group)
    group_leaks = sum(len(value) > 1 for value in group_folds.values())
    study_leaks = sum(len(value) > 1 for value in study_folds.values())
    inconsistent_groups = sum(len(value) > 1 for value in study_groups.values())
    if group_leaks or study_leaks or inconsistent_groups:
        raise EvaluationError(
            f"split leakage: {group_leaks} groups and {study_leaks} studies span folds; "
            f"{inconsistent_groups} studies map to multiple groups"
        )
    partitions = {}
    for name, is_validation in (("train", False), ("validation", True)):
        indices = [i for i, fold in enumerate(folds) if (fold == validation_fold) == is_validation]
        if not indices:
            raise EvaluationError(f"{name} partition is empty")
        stats = label_statistics([targets[i] for i in indices], [observed[i] for i in indices])
        stats["groups"] = len({_identifier(rows[i].get(group_key), group_key) for i in indices})
        stats["studies"] = len({_identifier(rows[i].get(study_key), study_key) for i in indices})
        stats["labels_without_both_classes"] = [
            label for label in LABELS if not stats["per_label"][label]["both_classes"]
        ]
        partitions[name] = stats
    return {
        "status": "no_group_or_study_fold_overlap", "group_key": group_key,
        "study_key": study_key, "validation_fold": validation_fold,
        "group_overlap_count": 0, "study_overlap_count": 0,
        "duplicate_study_rows": len(rows) - len(study_folds),
        "patient_independence": "requires_verified_patient_group_provenance",
        "partitions": partitions,
        "strict_validation_macro_possible": not partitions["validation"]["labels_without_both_classes"],
    }


def _read_csv(path: Path, exact_header=False):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        header = reader.fieldnames or []
        expected = [STUDY_KEY, *LABELS]
        if len(set(header)) != len(header):
            raise EvaluationError(f"{path.name}: duplicate header columns")
        if exact_header and header != expected:
            raise EvaluationError(f"{path.name}: expected exact submission column order")
        if any(column not in header for column in expected):
            raise EvaluationError(f"{path.name}: missing study or target columns")
        result = {}
        for i, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise EvaluationError(f"{path.name}:{i}: malformed CSV field count")
            study = _identifier(row[STUDY_KEY], f"{path.name}:{i}")
            if study in result:
                raise EvaluationError(f"{path.name}:{i}: duplicate study identifier")
            result[study] = row
    if not result:
        raise EvaluationError(f"{path.name}: no study rows")
    return result


def _same_ids(reference, other, context):
    if set(reference) != set(other):
        raise EvaluationError(
            f"{context}: study sets differ; missing={len(set(reference) - set(other))}, "
            f"extra={len(set(other) - set(reference))}"
        )


def _file_identity(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"name": path.name, "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--mask", type=Path, help="Gold-only 0/1 mask, same study IDs and labels")
    parser.add_argument("--baseline", type=Path, help="Optional paired baseline predictions")
    parser.add_argument("--split", type=Path, help="Full train/validation metadata CSV with labels, groups and folds")
    parser.add_argument("--group-column", help="Explicit group column in --split CSV")
    parser.add_argument("--fold-column", default="fold")
    parser.add_argument("--validation-fold", type=int, default=0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    receipt = {"state": "failed", "score_scope": "local_heldout_not_official_leaderboard"}
    try:
        target_rows = _read_csv(args.targets)
        prediction_rows = _read_csv(args.predictions, exact_header=True)
        ordered = list(target_rows)
        _same_ids(target_rows, prediction_rows, "predictions")
        targets = _row_targets([target_rows[study] for study in ordered])
        predictions = _row_targets([prediction_rows[study] for study in ordered])
        mask = None
        files = {"targets": args.targets, "predictions": args.predictions}
        if args.mask:
            mask_rows = _read_csv(args.mask, exact_header=True)
            _same_ids(target_rows, mask_rows, "mask")
            mask = _row_targets([mask_rows[study] for study in ordered])
            files["mask"] = args.mask
        receipt["inputs"] = {name: _file_identity(path) for name, path in files.items()}
        receipt["evaluator"] = _file_identity(Path(__file__))
        receipt["evaluation"] = evaluate_predictions(targets, predictions, mask)
        receipt["split_audit"] = {"status": "not_supplied"}
        if bool(args.group_column) != bool(args.split):
            raise EvaluationError("--split and --group-column must be supplied together")
        if args.split:
            split_rows = _read_csv(args.split)
            split_order = list(split_rows)
            folds = [int(split_rows[study][args.fold_column]) for study in split_order]
            validation_ids = {
                study for study, fold in zip(split_order, folds) if fold == args.validation_fold
            }
            _same_ids(validation_ids, target_rows, "held-out validation targets")
            # Preserve the full split's training prevalence but use the explicit
            # validation mask, when supplied, for held-out class-coverage checks.
            split_targets = _row_targets([split_rows[study] for study in split_order])
            split_mask = [[not _missing(value) for value in row] for row in split_targets]
            _, validation_mask = _targets_and_mask(targets, mask)
            validation_mask_by_study = dict(zip(ordered, validation_mask))
            validation_targets_by_study = dict(zip(ordered, targets))
            for i, study in enumerate(split_order):
                if study in validation_mask_by_study:
                    split_mask[i] = validation_mask_by_study[study]
                    # The evaluated target bytes are authoritative for this audit;
                    # reject accidentally evaluating a differently labelled split.
                    expected, _ = _targets_and_mask([validation_targets_by_study[study]], [split_mask[i]])
                    actual, _ = _targets_and_mask([split_targets[i]], [split_mask[i]])
                    if actual != expected:
                        raise EvaluationError("validation target labels differ from the split metadata")
            receipt["split_audit"] = audit_grouped_split(
                [split_rows[study] for study in split_order], folds, args.group_column,
                validation_fold=args.validation_fold, mask=split_mask,
            )
            receipt["inputs"]["split"] = _file_identity(args.split)
        if args.baseline:
            baseline_rows = _read_csv(args.baseline, exact_header=True)
            _same_ids(target_rows, baseline_rows, "baseline")
            baseline = _row_targets([baseline_rows[study] for study in ordered])
            receipt["comparison"] = compare_predictions(targets, baseline, predictions, mask)
            receipt["inputs"]["baseline"] = _file_identity(args.baseline)
        receipt.update({"state": "completed", "input_provenance": "caller_supplied_not_independently_attested"})
        exit_code = 0
    except (EvaluationError, OSError, ValueError, KeyError) as exc:
        receipt["error"] = {"type": type(exc).__name__, "message": str(exc)}
        exit_code = 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"state": receipt["state"], "output": str(args.output), "exit_code": exit_code}))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
