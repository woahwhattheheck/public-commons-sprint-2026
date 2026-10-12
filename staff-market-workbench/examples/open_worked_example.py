#!/usr/bin/env python3
"""Open the published FSU example through the complete native receiving workflow."""
import argparse
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
import sys
import time

SOURCE = Path(__file__).absolute().parents[1]
sys.path.insert(0, str(SOURCE))
from core import Workspace, Problem, initialize, restore, file_digest, atomic_json, now

OPERATION = "fsu-published-market-example-20261011"


def retain_bytes(path, data):
    if path.exists():
        if path.read_bytes() != data:
            raise Problem("Retained receiving output differs: " + str(path), 409)
        return
    with path.open("xb") as output:
        output.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="New example directory, or this same previously initialized example")
    parser.add_argument("--restore-directory", help="Fresh receiving directory; defaults to the workspace name plus -restored")
    args = parser.parse_args()
    start, started = time.monotonic(), now()
    root = Path(args.workspace).expanduser().resolve()
    receiving = Path(args.restore_directory).expanduser().resolve() if args.restore_directory else root.with_name(root.name + "-restored")
    provenance = json.loads((SOURCE / "examples/PROVENANCE.json").read_text())
    original_files = {kind: SOURCE / "examples" / (kind + ".csv") for kind in ("jobs", "surveys")}
    contract = {"operation": OPERATION, "source_files": {kind: file_digest(path) for kind, path in original_files.items()}}
    marker = root / "EXAMPLE.json"
    if not root.exists():
        initialize(root, "FSU published market-pricing example")
        atomic_json(marker, contract)
    elif not marker.is_file() or json.loads(marker.read_text()) != contract:
        raise Problem("Choose a new directory or the unchanged original published-example workspace", 409)
    w = Workspace(root)
    replayed = []
    def call(step, action, payload):
        result = w.mutate(action, {"operation_id": OPERATION + ":" + step, "expected_revision": w.state()["workspace"]["revision"], **payload})
        if result["replayed"]:
            replayed.append(step)
        return result["result"]

    editions = {}
    for kind, path in original_files.items():
        preview = call("preview-" + kind, "preview", {
            "kind": kind, "text": path.read_text(encoding="utf-8"), "filename": path.name,
            "source_name": "FSU published worked example / " + kind,
            "edition": "Printed page 22; source retrieved 2026-10-11",
            "metadata": {"source_url": provenance["original_url"], "number_format": "plain",
                         "permitted_use": "Published numeric illustration for this native operating example",
                         "basis": provenance["basis"], "original_printed_page": 22,
                         "date_basis": provenance["date_basis"], "currency_basis": provenance["units"]["currency_basis"]},
            "defaults": {}})
        if preview["errors"]:
            raise Problem("Resolve the actual source preview", details=preview["errors"])
        editions[kind] = call("import-" + kind, "import", {"preview_id": preview["id"]})["source_id"]

    job = w.records("jobs", current=False, source_id=editions["jobs"])["items"][0]
    surveys = w.records("surveys", current=False, source_id=editions["surveys"])["items"]
    call("job-disposition", "job_review", {"job_id": job["id"], "outcome": "benchmark_candidate",
         "reviewer": "Published example reconstruction",
         "rationale": "Use the two pairings explicitly printed in the source's worked table for this reconstruction."})
    selections = []
    for survey in surveys:
        selected = call("match-" + survey["record_key"], "selection", {
            "job_id": job["id"], "survey_id": survey["id"], "outcome": "selected",
            "reviewer": "Published example reconstruction",
            "rationale": "The original printed page 22 pairs this survey row with Student Financial Aid Specialist at weight 1 and scope adjustment 0%.",
            "weight": "1", "scope_adjustment_pct": "0", "aging_mode": "none",
            "aging_rate_pct": "0", "day_basis": "365.25",
            "factor_rationale": "Retain the original worked-table basis; no effective dates are supplied for these specific rows."})
        selections.append(selected["id"])

    analysis = call("analysis", "analysis", {
        "job_id": job["id"], "selection_ids": selections,
        "title": "FSU published two-survey market-pricing illustration",
        "source_mode": "historical", "target_date": None,
        "basis_note": "Reconstruction of Staff Pay Administration Guidelines, printed page 22. Source amounts are in thousands on the guideline's annualized salary basis; USD is the explicit receiving interpretation. Original equal weights and zero scope adjustments are retained. The specific table rows have no stated effective date."})
    actual_consensus = {k: Decimal(v) for k, v in analysis["consensus"].items() if v is not None}
    expected_consensus = {k: Decimal(v) for k, v in provenance["expected_unrounded_annual_consensus"].items()}
    if analysis["errors"] or actual_consensus != expected_consensus:
        raise Problem("The native comparison differs from the original published calculation", details=analysis)
    ratios = {name: str(Decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
              for name, value in analysis["reference_percent_of_consensus"].items()}
    if ratios != provenance["published_display"]["reference_percent"]:
        raise Problem("The receiving display percentages differ from the published table", details=ratios)
    review = call("review", "review", {
        "analysis_id": analysis["id"], "result_sha256": analysis["result_sha256"],
        "reviewer": "Native published-example comparison",
        "outcome": "accepted",
        "notes": "Compared all three exact annual consensus figures and all three one-decimal reference percentages with the original printed page 22. Accepted for operating-example reconstruction. Commissioned compensation decisions use the receiving specialist's actual job descriptions, licenses, dates and factors."})
    outputs = root / "receiving"
    outputs.mkdir(exist_ok=True, mode=0o700)
    output_files = {}
    for fmt in ("csv", "json"):
        path = outputs / ("published-market-comparison." + fmt)
        retain_bytes(path, w.report(analysis["id"], fmt))
        output_files[fmt] = {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}
    backup = call("backup", "prepare_backup", {})
    package = w.backup(backup["id"])
    restored = restore(package, receiving)
    receiving_workspace = Workspace(receiving)
    reopened = receiving_workspace.document("analysis", analysis["id"])
    if reopened["result_sha256"] != analysis["result_sha256"] or receiving_workspace.report(analysis["id"], "json") != w.report(analysis["id"], "json"):
        raise Problem("The reopened receiving comparison differs from its original accepted state")
    result = {"operation": OPERATION, "started_at": started, "completed_at": now(),
              "elapsed_seconds": round(time.monotonic() - start, 6),
              "workspace": w.state()["workspace"], "source_editions": editions,
              "job_id": job["id"], "survey_rows": len(surveys), "selection_ids": selections,
              "analysis_id": analysis["id"], "analysis_sha256": analysis["result_sha256"],
              "consensus_annual": analysis["consensus"], "reference_annual": analysis["reference"]["annual_amount"],
              "reference_percent_one_decimal": ratios, "review_id": review["id"],
              "outputs": output_files, "backup": {"id": backup["id"], "path": str(package), "bytes": package.stat().st_size, "sha256": file_digest(package)},
              "restored": restored, "restored_review_and_report_match": True, "replayed_steps": replayed}
    retained = root / "EXAMPLE-RESULT.json"
    if not retained.exists():
        atomic_json(retained, result)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Problem, OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "code": getattr(exc, "code", "NATIVE_ERROR")}), file=sys.stderr)
        raise SystemExit(2)
