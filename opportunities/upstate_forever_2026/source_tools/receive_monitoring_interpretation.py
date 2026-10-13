#!/usr/bin/env python3
"""Continue the original Eco study through monitoring comparison, export and cold reopen."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--study-id", default="utility-ecoli-2021-2025")
    parser.add_argument("--version-id")
    parser.add_argument("--profile-id", default="sc-ecoli-ambient-126-349")
    parser.add_argument("--operation-id", default="ECO-WO30-MONITORING-INTERPRETATION-3FC8-20261013")
    args = parser.parse_args()
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from measurement_workspace.published_studies import PublishedStudyStore, _atomic, _json_bytes
    from measurement_workspace.monitoring_interpretation import MonitoringInterpretations, _binding
    from measurement_workspace import utility_microbiology
    workspace = Workspace(args.workspace)
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    choices = store.list_studies()["studies"]
    if not any(row["study_id"] == args.study_id for row in choices):
        if args.study_id != utility_microbiology.BUILTIN_ID or args.version_id:
            raise ValueError("Select the original already-retained study edition.")
        source, evidence = utility_microbiology.builtin_companion(application)
        store.import_source(source, evidence=evidence, operation_id=args.operation_id+"-original-study")
    complete = store.get_study(args.study_id, args.version_id)
    if args.study_id == utility_microbiology.BUILTIN_ID and len(complete["observation_rows"]) != 730:
        raise ValueError("The original full utility source must retain all 730 result rows.")
    service = MonitoringInterpretations(store, application)
    request = {"study_id": args.study_id, "version_id": complete["record"]["version_id"],
        "profile_id": args.profile_id,
        "selection": {"site_ids": [], "parameters": [], "strata": [], "year": None, "months": []},
        "applicability": {"jurisdiction": "", "water_use": "", "reviewer": "",
            "note": "Original complete study compared descriptively with the explicitly selected reference profile; responsible analyst completes site/use/method applicability in the existing operator.",
            "method_note": "", "confirmed": False, "confirmations": {}},
        "options": {"include_qualified": False, "qualified_note": ""}}
    preview = service.preview(request)
    request.update(title=complete["study"]["title"]+" — monitoring reference comparison",
                   preview_id=preview["id"])
    saved = service.save(request)
    repeated = service.save(request)
    if repeated["interpretation"]["id"] != saved["interpretation"]["id"] or not repeated["reused"]:
        raise ValueError("The same source and analyst request did not reopen the same interpretation.")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    _atomic(out/"request.json", _json_bytes(request))
    _atomic(out/"preview.json", _json_bytes(preview))
    exported = service.export(saved["interpretation"]["id"], out/"export")
    receiver = Workspace(out/"cold-workspace", create=True, title="Received original monitoring comparison")
    receiver_store = PublishedStudyStore(receiver, receiver.root/"published_studies")
    received = MonitoringInterpretations(receiver_store, application).receive(
        out/"export"/"monitoring-interpretation.zip", args.operation_id+"-cold-receive")
    if received["interpretation"]["content"] != saved["interpretation"]["content"]:
        raise ValueError("The reopened original interpretation differs.")
    reopened = receiver_store.get_study(args.study_id, complete["record"]["version_id"])
    if _binding(reopened["record"]) != _binding(complete["record"]):
        raise ValueError("The independently reopened original study binding differs.")
    files = []
    for path in exported["files"]:
        raw = path.read_bytes()
        files.append({"path": str(path.resolve()), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest()})
    result = {"schema": "upstate.monitoring-interpretation-receiving/v1",
        "operation_id": args.operation_id, "application": str(application),
        "workspace": str(workspace.root), "workspace_id": workspace.project["id"],
        "interpretation_id": saved["interpretation"]["id"],
        "binding": _binding(complete["record"]), "profile_id": args.profile_id,
        "summary": preview["summary"], "source_observations": len(complete["observation_rows"]),
        "reopened_observations": len(reopened["observation_rows"]),
        "cold_workspace": str(receiver.root), "files": files,
        "browser_continuation": "Open the same workspace in the existing Published studies desk. Use Monitoring interpretation, select the saved interpretation, inspect every profile/source/support row, preview a changed original selection, save its child edition, download the actual five exports and reopen the complete ZIP. View desktop and narrow output and each original downloaded attachment before presenting the edition.",
        "owner_direction": "CURRENT_OWNER_DIRECTION.md version2026-10-13.4; AGENTS.md2026-10-13.1"}
    _atomic(out/"receiving.json", _json_bytes(result))
    print(json.dumps(result, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
