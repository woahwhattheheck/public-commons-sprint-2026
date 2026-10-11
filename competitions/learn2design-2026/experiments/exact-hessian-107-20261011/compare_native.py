#!/usr/bin/env python3
"""Compare source-matched records from the unchanged public UIFO runner."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "runner"))
from run_public_uifo import classify_cell


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False).encode()).hexdigest()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def runtime_context(path, report_bytes, report, source_manifest):
    """Join retained bytes to their effective dispatch settings without changing them."""
    sidecar = Path(str(path) + ".runtime.json")
    report_sha = hashlib.sha256(report_bytes).hexdigest()
    if not sidecar.exists():
        # Old records do not say whether CPU dispatch was asynchronous. Keep each
        # one visible, but do not infer identical runtime from matching package names.
        return {"status": "not_recorded", "isolation_report_sha256": report_sha}, None
    raw = sidecar.read_bytes()
    context = json.loads(raw)
    expected_capture = source_manifest["runtime_capture"]["sha256"]
    if (context.get("schema") != "tjlabs.l2d.runtime-context/v1" or
            context.get("state") != "native_report_retained" or
            context.get("report_sha256") != report_sha or
            context.get("capture_unchanged") is not True or
            context.get("runner_unchanged") is not True or
            context.get("native_sources_unchanged") is not True or
            context.get("source_before", {}).get("capture_sha256") != expected_capture or
            context.get("source_before", {}).get("runner_sha256") != report["runner"]["sha256"] or
            context.get("source_before", {}).get("candidate_sha256") != report["candidate_before"]["sha256"] or
            context.get("condition", {}).get("capture_sha256") != expected_capture):
        raise ValueError(f"{sidecar}: runtime context does not bind this unchanged native report")
    return {"status": "captured", **context["condition"]}, {
        "file": str(sidecar), "sha256": hashlib.sha256(raw).hexdigest(),
        "captured_at": context.get("captured_at"), "finished_at": context.get("finished_at")}


def cohort_for(condition):
    """Pool topology/algorithm seeds only; keep budgets, devices and physics separate."""
    cohort = dict(condition)
    cohort["cell"] = {key: value for key, value in condition["cell"].items()
                      if key not in ("topology_seed", "algorithm_seed")}
    spec = condition["problem_spec"]
    # Exact dfbench 0.3.3 UIFOProblem serialization: params.topology is the
    # generated discrete network. Other constructor parameters remain invariant.
    if isinstance(spec, dict) and spec.get("type") == "UIFOProblem" and isinstance(spec.get("params"), dict):
        cohort["problem_spec"] = {**spec, "params": {
            key: value for key, value in spec["params"].items() if key != "topology"}}
    return cohort


def compare(paths, source_manifest, baseline):
    expected = {row["submission_sha256"]: row["id"] for row in source_manifest["candidates"]}
    runner_sha = source_manifest["native_runner"]["sha256"]
    groups = {}
    cohorts = {}
    seen = set()
    records = []
    for path in paths:
        data = path.read_bytes()
        report = json.loads(data)
        source_sha = report.get("candidate_before", {}).get("sha256")
        if source_sha not in expected:
            raise ValueError(f"{path}: source is outside this frozen comparison")
        if report.get("runner", {}).get("sha256") != runner_sha:
            raise ValueError(f"{path}: different original runner; retain it as a separate condition")
        candidate = expected[source_sha]
        runtime, runtime_receipt = runtime_context(path, data, report, source_manifest)
        condition = {"cell": report["cell"], "problem_spec": report["problem_spec"],
                     "environment": report["environment"], "runner_sha256": runner_sha,
                     "runtime_context": runtime}
        condition_id = digest(condition)
        cohort = cohort_for(condition)
        cohort_id = digest(cohort)
        cohorts[cohort_id] = cohort
        identity = (condition_id, candidate)
        if identity in seen:
            raise ValueError(f"{path}: duplicate candidate/condition; select the intended retained run explicitly")
        seen.add(identity)
        m = report.get("metrics", {})
        unchanged = (report.get("candidate_unchanged") is True and
                     report.get("candidate_after", {}).get("sha256") == source_sha)
        status = classify_cell(report.get("error"), m, unchanged)
        loss = m.get("best_feasible_loss")
        usable = status.startswith("COMPLETE_")
        if loss is not None and (not finite(loss) or not usable):
            loss = None
        record = {"candidate": candidate, "report": str(path),
                  "report_sha256": hashlib.sha256(data).hexdigest(),
                  "source_sha256": source_sha, "condition_id": condition_id,
                  "cohort_id": cohort_id,
                  "status": status, "reported_status": report.get("status"),
                  "error": report.get("error"), "best_feasible_loss": loss,
                  "feasible_points": m.get("feasible_points"),
                  "logged_points": m.get("logged_points"),
                  "time_to_first_feasible_s": m.get("time_to_first_feasible_s"),
                  "time_to_best_feasible_s": m.get("time_to_best_feasible_s"),
                  "budget": report.get("budget"),
                  "runtime_context": runtime_receipt,
                  "algorithm_diagnostics": report.get("algorithm_diagnostics")}
        records.append(record)
        group = groups.setdefault(condition_id, {"condition": condition, "records": {}})
        group["records"][candidate] = record
    if baseline not in {row["id"] for row in source_manifest["candidates"]}:
        raise ValueError("baseline must identify one frozen candidate")
    pairs = []
    for condition_id, group in groups.items():
        base = group["records"].get(baseline)
        for candidate, result in group["records"].items():
            if candidate == baseline:
                continue
            a = result["best_feasible_loss"]
            b = base["best_feasible_loss"] if base else None
            comparable = finite(a) and finite(b)
            pairs.append({"condition_id": condition_id, "cohort_id": result["cohort_id"], "candidate": candidate,
                          "baseline": baseline, "candidate_loss": a, "baseline_loss": b,
                          "candidate_status": result["status"],
                          "baseline_status": base["status"] if base else "not_supplied",
                          "delta": a - b if comparable else None,
                          "outcome": ("win" if a < b else "loss" if a > b else "tie")
                                     if comparable else "no_numeric_pair"})
    summaries = []
    for candidate, cohort_id in sorted({(p["candidate"], p["cohort_id"]) for p in pairs}):
        selected = [p for p in pairs if p["candidate"] == candidate and p["cohort_id"] == cohort_id]
        values = [p["delta"] for p in selected if p["delta"] is not None]
        summaries.append({"candidate": candidate, "baseline": baseline,
                          "cohort_id": cohort_id,
                          "conditions": len(selected), "numeric_pairs": len(values),
                          "wins": sum(p["outcome"] == "win" for p in selected),
                          "ties": sum(p["outcome"] == "tie" for p in selected),
                          "losses": sum(p["outcome"] == "loss" for p in selected),
                          "mean_delta": statistics.mean(values) if values else None,
                          "median_delta": statistics.median(values) if values else None,
                          "best_delta": min(values) if values else None,
                          "worst_delta": max(values) if values else None})
    return {"schema": "tjlabs.l2d.exact-hessian-comparison/v2", "baseline": baseline,
            "source_manifest_sha256": digest(source_manifest),
            "conditions": [{"id": k, **v["condition"]} for k, v in groups.items()],
            "cohorts": [{"id": k, **v} for k, v in cohorts.items()],
            "records": records, "pairs": pairs, "summaries": summaries,
            "interpretation": "Negative paired feasible-loss delta is better. All native failures and no-feasible outcomes remain in the records. A missing feasible value is not replaced by an invented random-search fallback. Runtime, effective affinity/dispatch/thread configuration, native source, problem, seeds, supplied budget and original runner must match within a pair. Reports without recorded effective runtime remain individually visible and do not form inferred pairs."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--sources", type=Path, default=ROOT / "SOURCES.json")
    parser.add_argument("--baseline", default="099")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.reports, json.loads(args.sources.read_text()), args.baseline)
    with args.out.open("x") as stream:
        json.dump(result, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.out), "records": len(result["records"]),
                      "conditions": len(result["conditions"]), "summaries": result["summaries"]}))


if __name__ == "__main__":
    main()
