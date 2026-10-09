"""Source-replayed option comparison; never an instruction to invest or spend."""
from __future__ import annotations

import argparse
import os
import stat
import sys
from decimal import localcontext
from pathlib import Path
from typing import Any

from .core import CircularValueError, canonical_json, compile_case, digest_json, loads_strict

SCHEMA = "circularvalue.comparison/v1"
BASIS_FIELDS = ("currency", "evaluatedOn", "horizonYears", "discountRateBps")
CASE_LIMIT = 4 * 1024 * 1024
COMPARISON_LIMIT = 32 * 1024 * 1024


def _envelope(baseline: dict, option: dict) -> dict[str, int]:
    """Independent endpoint bounds; not paired scenarios or a confidence interval."""
    return {
        "lowMinor": option["lowMinor"] - baseline["highMinor"],
        "centralMinor": option["centralMinor"] - baseline["centralMinor"],
        "highMinor": option["highMinor"] - baseline["lowMinor"],
    }


def _changes(before: dict, after: dict) -> list[dict]:
    changes = []
    for key in sorted(before.keys() | after.keys()):
        old, new = before.get(key), after.get(key)
        if canonical_json(old) != canonical_json(new):
            changes.append({
                "id": key,
                "change": "added" if key not in before else "removed" if key not in after else "modified",
                "before": old,
                "after": new,
            })
    return changes


def compare_cases(baseline: dict[str, Any], option: dict[str, Any]) -> dict[str, Any]:
    """Compile both source cases, require a common valuation basis, then compare."""
    if type(baseline) is not dict or type(option) is not dict:
        raise CircularValueError("baseline and option must be case objects")
    # The existing calculation generation uses precision 40. Isolate it from callers.
    with localcontext() as context:
        context.prec = 40
        before, after = compile_case(baseline), compile_case(option)
    incompatible = [key for key in BASIS_FIELDS if baseline[key] != option[key]]
    if incompatible:
        raise CircularValueError("incompatible comparison basis: " + ", ".join(incompatible))

    old_evidence = {row["id"]: row for row in before["evidence"]}
    new_evidence = {row["id"]: row for row in after["evidence"]}
    evidence_changes = _changes(old_evidence, new_evidence)
    changed_evidence_ids = {row["id"] for row in evidence_changes}
    old_levers = {row["id"]: row for row in before["levers"]}
    new_levers = {row["id"]: row for row in after["levers"]}
    lever_changes = {row["id"]: row for row in _changes(old_levers, new_levers)}
    for key in sorted(old_levers.keys() | new_levers.keys()):
        old, new = old_levers.get(key), new_levers.get(key)
        refs = set((old or {}).get("evidenceIds", [])) | set((new or {}).get("evidenceIds", []))
        affected = sorted(refs & changed_evidence_ids)
        if affected or key in lever_changes:
            row = lever_changes.setdefault(key, {
                "id": key, "change": "evidence_only", "before": old, "after": new,
            })
            row["changedEvidenceIds"] = affected

    zero = {"lowMinor": 0, "centralMinor": 0, "highMinor": 0}
    category_changes = {
        key: _envelope(before["categoryTotals"].get(key, zero), after["categoryTotals"].get(key, zero))
        for key in sorted(before["categoryTotals"].keys() | after["categoryTotals"].keys())
    }
    npv_delta = _envelope(before["npv"], after["npv"])
    # This is only a numerical range relationship. Quality flags remain independent.
    relation = (
        "OPTION_RANGE_ABOVE_BASELINE" if npv_delta["lowMinor"] > 0
        else "OPTION_RANGE_BELOW_BASELINE" if npv_delta["highMinor"] < 0
        else "RANGES_OVERLAP_OR_TOUCH"
    )
    payload = {
        "schema": SCHEMA,
        "basis": {key: baseline[key] for key in BASIS_FIELDS},
        "baseline": before,
        "option": after,
        "deltaConvention": "option_minus_baseline_independent_endpoint_envelope",
        "annualValueDelta": _envelope(before["annualValue"], after["annualValue"]),
        "npvDelta": npv_delta,
        "categoryAnnualValueDeltas": category_changes,
        "assumptionChanges": _changes(before["assumptions"], after["assumptions"]),
        "evidenceChanges": evidence_changes,
        "leverChanges": [lever_changes[key] for key in sorted(lever_changes)],
        "npvRangeRelation": relation,
        "authority": {
            "investmentRecommendation": False, "environmentalCertification": False,
            "accountingConclusion": False, "externalAction": False, "fundsMovement": False,
        },
    }
    return {**payload, "comparisonSha256": digest_json(payload)}


def verify_comparison(baseline: dict, option: dict, comparison: Any) -> bool:
    """Replay sources: changing a value and recomputing its hash cannot pass."""
    if type(comparison) is not dict:
        return False
    try:
        return canonical_json(compare_cases(baseline, option)) == canonical_json(comparison)
    except (CircularValueError, TypeError, ValueError, OverflowError, UnicodeError):
        return False


def _read(path: str, limit: int = CASE_LIMIT) -> dict:
    source = Path(path)
    before = source.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise CircularValueError("input must be a regular non-symlink file")
    if before.st_size > limit:
        raise CircularValueError(f"input exceeds {limit} byte limit")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(source, flags)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise CircularValueError("input changed while opening")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(limit + 1)
    finally:
        os.close(fd)
    if len(data) > limit:
        raise CircularValueError(f"input exceeds {limit} byte limit")
    value = loads_strict(data.decode("utf-8"))
    if type(value) is not dict:
        raise CircularValueError("top-level JSON must be object")
    return value


def _write_new(path: str, text: str) -> None:
    # Encode before creating anything; refuse existing files, including symlinks.
    data = text.encode("utf-8")
    destination = Path(path)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("short write")
            view = view[written:]
    except BaseException:
        try:
            current, opened = destination.lstat(), os.fstat(fd)
            if stat.S_ISREG(current.st_mode) and (current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino):
                destination.unlink()
        except OSError:
            pass
        raise
    finally:
        os.close(fd)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two CircularValue source cases offline.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("compile", "report", "verify"):
        command = commands.add_parser(name)
        command.add_argument("baseline")
        command.add_argument("option")
        if name == "verify":
            command.add_argument("comparison")
        else:
            command.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        baseline, option = _read(args.baseline), _read(args.option)
        if args.command == "verify":
            valid = verify_comparison(baseline, option, _read(args.comparison, COMPARISON_LIMIT))
            print("VALID" if valid else "INVALID")
            return 0 if valid else 2
        if args.command == "report":
            from .comparison_report import render_comparison_html
            _write_new(args.out, render_comparison_html(baseline, option))
            print(args.out)
        else:
            comparison = compare_cases(baseline, option)
            _write_new(args.out, canonical_json(comparison) + "\n")
            print(comparison["npvRangeRelation"], comparison["comparisonSha256"])
        return 0
    except (OSError, CircularValueError, UnicodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
