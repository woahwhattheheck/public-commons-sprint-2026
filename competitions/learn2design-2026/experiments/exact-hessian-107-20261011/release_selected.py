#!/usr/bin/env python3
"""Compose original native phase outputs and package an exact selected optimizer arm."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "runner"))
from invocation import arm_identity, load_selection
from compare_native import compare, finite
from run_phase import atomic_json, freeze, read, sha, summarize

SCHEMA = "tjlabs.l2d.selected-release/v1"
OFFICIAL_REF = "9ebce9bfe5c33242c297f84f4c79d088b7b52e70"
VALIDATOR_SHA256 = "fdc0ae8d4c341b6c493cd1559638246585517f38e171a5c9778fd23f926342e5"
PACKAGER_SHA256 = "b595df7c8c8a314fe66c4f9c186a8e144f5c6d718f3606148580e147005f036f"


def canonical(value):
    return (json.dumps(value, sort_keys=True, indent=2,
                       ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def retained_member(root, name):
    relative = Path(name)
    if not name or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Use an original relative source member")
    path = (root / relative).resolve()
    path.relative_to(root.resolve())
    if not path.is_file():
        raise ValueError("Original source member is missing: " + name)
    return path


def _expected(args):
    return freeze(SimpleNamespace(
        phase=args["phase"], candidate=args["candidates"], baseline=args["baseline"],
        partition_count=None, partition_index=None))[1]


def collect_phase(directories):
    """Read original completions; never admit work or replace a retained result."""
    if not directories:
        raise ValueError("Supply at least one original --phase-dir")
    sources = read(ROOT / "SOURCES.json")
    full = None
    seen_roots, owners, actual, reports, receipts = set(), {}, {}, [], []
    report_cells, completions = {}, {}
    for supplied in directories:
        root = supplied.expanduser().resolve()
        if root in seen_roots:
            raise ValueError("The same phase directory was supplied twice")
        seen_roots.add(root)
        phase_bytes = (root / "phase.json").read_bytes()
        original = json.loads(phase_bytes)
        intent = original["intent"]
        partition = intent.get("topology_partition")
        args = SimpleNamespace(
            phase=intent["phase"], candidate=intent["candidates"], baseline=intent["baseline"],
            partition_count=partition["count"] if partition else None,
            partition_index=partition["index"] if partition else None)
        _, expected = freeze(args)
        if {k: v for k, v in intent.items() if k != "runtime"} != expected:
            raise ValueError("Retained phase does not match its original frozen plan: " + str(root))
        if not isinstance(intent.get("runtime"), dict):
            raise ValueError("Retained phase is missing its original runtime declaration")
        complete = _expected(intent)
        if full is None:
            full = complete
        elif full != complete:
            raise ValueError("Select partitions of the same original phase, sources and candidates")
        for cell in intent["cells"]:
            if cell["id"] in owners:
                raise ValueError("Overlapping retained topology/candidate cell: " + cell["id"])
            owners[cell["id"]] = str(root)
        current = summarize(root, intent, sources, publish=False)
        for row in current["cells"]:
            actual[row["cell"]] = row
            if row.get("native_status") is not None:
                report = retained_member(root, row["native_report"])
                # Only completed original processes participate. An in-progress
                # report remains visible but cannot supply a finished selection.
                if (root / "cells" / row["cell"] / "completion.json").is_file():
                    reports.append(report)
                    report_cells[str(report)] = next(c for c in intent["cells"] if c["id"] == row["cell"])
                    completions[str(report)] = read(root / "cells" / row["cell"] / "completion.json")
        if (root / "phase.json").read_bytes() != phase_bytes:
            raise ValueError("Original phase intent changed during collection")
        receipts.append({"directory": str(root), "phase_file": identity(phase_bytes),
                         "partition": partition, "planned_cells": current["planned_cells"],
                         "retained_native_reports": current["retained_native_reports"],
                         "all_cells_ended": current["all_cells_ended"]})
    comparison = compare(reports, sources, full["baseline"]) if reports else None
    expected_cells = full["cells"]
    rows = [{**cell, "directory": owners.get(cell["id"]),
             "outcome": actual.get(cell["id"], {"state": "partition_not_supplied"})}
            for cell in expected_cells]
    expected_count = len(rows)
    records = comparison["records"] if comparison else []
    conditions = {c["id"]: c for c in (comparison["conditions"] if comparison else [])}
    eligible = set()
    for record in records:
        planned = report_cells[record["report"]]
        condition = conditions[record["condition_id"]]["cell"]
        if (record["candidate"] != planned["candidate"] or record["arm_sha256"] != planned["arm_sha256"]
                or condition.get("topology_seed") != planned["topology_seed"]
                or condition.get("algorithm_seed") != planned["algorithm_seed"]
                or condition.get("max_time_s") != planned["max_time_seconds"]
                or condition.get("population_size_override") is not None):
            raise ValueError("Original report changed or differs from its retained cell")
        completion = completions[record["report"]]
        qualified = (completion.get("cell") == planned["id"]
                     and completion.get("state") == "process_ended"
                     and completion.get("exit_code") == 0 and completion.get("termination") is None)
        if qualified:
            eligible.add((record["condition_id"], record["candidate"]))
    table = []
    for candidate in full["candidates"]:
        selected = [r for r in records if r["candidate"] == candidate]
        values = [r["best_feasible_loss"] for r in selected
                  if (r["condition_id"], candidate) in eligible and finite(r["best_feasible_loss"])]
        need = sum(c["candidate"] == candidate for c in expected_cells)
        complete_values = len(values) == need and len({r["cohort_id"] for r in selected}) == 1
        table.append({
            "candidate": candidate, "expected_cells": need, "retained_finished_cells": len(selected),
            "finite_feasible_cells": len(values),
            "whole_panel_mean_best_feasible_loss": sum(values) / need if complete_values else None,
            "observed_finite_mean": sum(values) / len(values) if values else None,
            "observed_finite_mean_cells": len(values),
            "runtime_cohorts": sorted({r["cohort_id"] for r in selected}),
            "statuses": {s: sum(r["status"] == s for r in selected)
                         for s in sorted({r["status"] for r in selected})}})
    # A whole-panel number requires all matched topology/seed pairs and one
    # recorded runtime cohort. Partial means are descriptive, never rankings.
    paired = []
    for candidate in full["candidates"]:
        if candidate == full["baseline"]:
            continue
        pairs = [p for p in (comparison["pairs"] if comparison else []) if p["candidate"] == candidate]
        count = sum(c["candidate"] == candidate for c in expected_cells)
        cohorts = sorted({p["cohort_id"] for p in pairs})
        valid = (len(pairs) == count and len(cohorts) == 1
                 and all(finite(p["delta"]) and (p["condition_id"], candidate) in eligible
                         and (p["condition_id"], full["baseline"]) in eligible for p in pairs))
        paired.append({"candidate": candidate, "baseline": full["baseline"],
                       "expected_pairs": count, "retained_pairs": len(pairs),
                       "numeric_pairs": sum(finite(p["delta"]) for p in pairs),
                       "runtime_cohorts": cohorts, "complete_same_cohort": valid,
                       "whole_panel_mean_delta": sum(p["delta"] for p in pairs) / count if valid else None})
    return {"schema": SCHEMA, "phase": full["phase"], "baseline": full["baseline"],
            "candidates": full["candidates"], "expected_cells": expected_count,
            "supplied_cells": len(owners), "finished_native_reports": len(records),
            "complete_native_panel": len(records) == expected_count,
            "full_objective_budget": all(c["max_time_seconds"] == 14400 for c in expected_cells),
            "source_sha256": full["source_sha256"], "physics": full["physics"],
            "partitions": receipts, "cells": rows, "candidate_summary": table,
            "paired_panel": paired, "comparison": comparison,
            "interpretation": (
                 "All original outcomes are retained. Selection summaries use original processes "
                "that exited normally within their container limit. Finite-only partial means are descriptive. "
                "A whole paired delta requires the complete original panel in one runtime cohort. "
                "No hidden-topology score or organizer random-search fallback is inferred. "
                "The existing entrant explicitly selects the source ID for packaging.")}


def entrypoint(row, selection):
    """One direct subclass, delegating once to the exact retained implementation."""
    name = row["class"]
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError("Selected class must be an explicit Python identifier")
    options = json.dumps(selection["optimize_kwargs"], sort_keys=True,
                         ensure_ascii=True, allow_nan=False)
    return (
        '"""Exact selected Learn2Design arm; original implementation is retained alongside."""\n'
        "from copy import deepcopy\n"
        "import json\n"
        "from dfbench import OptimizationAlgorithm\n"
        "import retained_algorithm as _original\n\n"
        f"_OPTIONS = json.loads({options!r})\n"
        f"SOURCE_ID = {row['id']!r}\n"
        f"ARM_SHA256 = {arm_identity(row)!r}\n\n"
        "class SelectedOptimizer(OptimizationAlgorithm):\n"
        f"    algorithm_str = _original.{name}.algorithm_str\n"
        f"    if hasattr(_original.{name}, 'algorithm_type'):\n"
        f"        algorithm_type = _original.{name}.algorithm_type\n\n"
        "    def __init__(self):\n"
        f"        self._implementation = _original.{name}()\n"
        "        self.last_run_diagnostics = getattr(self._implementation, 'last_run_diagnostics', {})\n\n"
        "    def optimize(self, objective, **kwargs):\n"
        "        if set(kwargs).intersection(_OPTIONS):\n"
        "            raise ValueError('Caller options conflict with the selected source arm')\n"
        "        try:\n"
        "            return self._implementation.optimize(objective, **kwargs, **deepcopy(_OPTIONS))\n"
        "        finally:\n"
        "            self.last_run_diagnostics = getattr(self._implementation, 'last_run_diagnostics', {})\n"
    ).encode("utf-8")


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load the retained source helper")
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous
        raise
    return module


def package_selected(source_id, archive, panel=None):
    manifest_path = ROOT / "SOURCES.json"
    sources = read(manifest_path)
    selected = [r for r in sources["candidates"] if r["id"] == source_id]
    if len(selected) != 1:
        raise ValueError("Choose one original frozen source ID")
    row = selected[0]
    bound = load_selection(manifest_path, source_id, retained_member(ROOT, row["submission"]))
    payloads = {}
    originals = []

    def add(name, path, expected):
        if name in payloads:
            raise ValueError("Two original sources map to one archive member: " + name)
        raw = path.read_bytes()
        actual = identity(raw)
        if actual["sha256"] != expected:
            raise ValueError("Original source changed while packaging: " + str(path))
        payloads[name] = raw
        originals.append({"archive_path": name, "source_path": str(path.relative_to(ROOT)), **actual})

    add("retained_algorithm.py", retained_member(ROOT, row["submission"]), row["submission_sha256"])
    tree = ast.parse(payloads["retained_algorithm.py"], filename="retained_algorithm.py")
    if sum(isinstance(n, ast.ClassDef) and n.name == row["class"] for n in tree.body) != 1:
        raise ValueError("The exact selected implementation class is missing")
    add("requirements.txt", retained_member(ROOT, row["requirements"]), row["requirements_sha256"])
    reserved = {"submission.py", "retained_algorithm.py", "requirements.txt", "RELEASE.json",
                "THIRD_PARTY_LICENSE.txt"}
    invocation = row.get("invocation", {})
    for companion in invocation.get("companions", []):
        name = companion["module"] + ".py"
        if name in reserved:
            raise ValueError("Original companion conflicts with an entrypoint member")
        add(name, retained_member(ROOT, companion["path"]), companion["sha256"])
    for asset in invocation.get("assets", []):
        if asset["name"] in reserved:
            raise ValueError("Original asset conflicts with an entrypoint member")
        add(asset["name"], retained_member(ROOT, asset["path"]), asset["sha256"])
        if len(payloads[asset["name"]]) != asset["bytes"]:
            raise ValueError("Original asset byte length changed")
    payloads["submission.py"] = entrypoint(row, bound["selection"])
    # Keep public donor provenance and its existing original license.
    license_path = ROOT / "official" / "LICENSE"
    payloads["THIRD_PARTY_LICENSE.txt"] = license_path.read_bytes()
    declaration = {
        "schema": SCHEMA, "source_id": source_id, "class": row["class"],
        "arm_sha256": bound["arm_sha256"], "selection": bound["selection"],
        "source_manifest_sha256": bound["manifest_sha256"],
        "source_manifest_content_sha256": bound["manifest_content_sha256"],
        "original_members": originals, "entrypoint": identity(payloads["submission.py"]),
        "official_source": OFFICIAL_REF,
        "source_manifest_declared_submission_bytes": row.get("submission_bytes"),
        "actual_original_submission": identity(payloads["retained_algorithm.py"]),
        "semantics": "One direct optimizer subclass forwards the original Objective and caller options "
                     "once to the exact retained implementation with the selected frozen options. "
                     "Original source, companions, assets and requirements are unchanged."}
    payloads["RELEASE.json"] = canonical(declaration)
    validator_path = ROOT / "official" / "final-validator-20261013.py"
    if sha(validator_path) != VALIDATOR_SHA256:
        raise ValueError("Use the pinned current official static validator")
    validator = load_module(validator_path, "_l2d_selected_release_validator")
    packager_path = ROOT / "batch-portfolio-d76c" / "package_candidate.py"
    if sha(packager_path) != PACKAGER_SHA256:
        raise ValueError("Use the original complete archive publisher")
    # The existing publisher depends on the original NumPy donor reader; it
    # performs only file handling here and imports no optimizer or simulator.
    sys.path.insert(0, str(packager_path.parent))
    try:
        packager = load_module(packager_path, "_l2d_selected_release_publisher")
    finally:
        sys.path.pop(0)
    target = archive.expanduser().absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".selected-release-", dir=target.parent) as temporary:
        pending = Path(temporary) / "submission.zip"
        packager.publish_archive(pending, payloads)
        findings = validator.validate_zip(str(pending))
        failures = [f.render() for f in findings if f.severity == "FAIL"]
        if failures:
            raise ValueError("Current official archive validation failed: " + "; ".join(failures))
        published = packager.publish_archive(target, payloads)
    if panel is not None and source_id not in panel["candidates"]:
        raise ValueError("Selected source is outside the supplied original comparison")
    return {"schema": SCHEMA, "archive": str(target), **published, "release": declaration,
            "members": {name: identity(raw) for name, raw in payloads.items()},
            "official_static_validation": [f.render() for f in findings],
            "selected_phase": panel,
            "next_operation": "Use this exact archive with the existing source-native receiver and "
                              "existing final entrant. The supplied panel retains its actual measured status."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "package"))
    parser.add_argument("--phase-dir", type=Path, action="append", default=[])
    parser.add_argument("--source-id")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--out", type=Path, help="New retained JSON output; existing files are preserved")
    args = parser.parse_args()
    if args.action == "inspect":
        result = collect_phase(args.phase_dir)
    else:
        if not args.source_id or not args.archive:
            parser.error("package requires --source-id and --archive")
        panel = collect_phase(args.phase_dir) if args.phase_dir else None
        if panel is not None and args.source_id not in panel["candidates"]:
            raise ValueError("Selected source is outside the supplied original comparison")
        result = package_selected(args.source_id, args.archive, panel)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(args.out, result, create=True)
        print(json.dumps({"output": str(args.out), "action": args.action,
                          "archive": result.get("archive"), "sha256": result.get("sha256")}))
    else:
        print(canonical(result).decode("utf-8"), end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
        print(json.dumps({"state": "selected_release_not_completed",
                          "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        raise SystemExit(2)
