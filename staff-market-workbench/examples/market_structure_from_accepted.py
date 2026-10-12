#!/usr/bin/env python3
"""Carry an existing accepted comparison through the original pay-structure workflow.

Uses the supplied native workspace and its supported backup/restore operations.
Every mutation has a durable, stable original request before execution. Run once
with --until saved, then run the same command with --until complete to reopen it
in a new process. No browser, downloaded runtime or invented source records.
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid
import zipfile

APP = Path(os.environ.get("MARKET_WORKBENCH_APP", Path(__file__).resolve().parents[1])).resolve()
sys.path.insert(0, str(APP))
from core import Workspace, Problem, restore, stable
from market_structure import engine

SCHEMA = "staff-market-workbench.market-structure-example.v1"


def raw_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def exact(path, raw):
    path = Path(path)
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("A retained original artifact differs: " + str(path))
    else:
        atomic(path, raw)
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


def revision(workspace):
    with workspace.connect() as db:
        return workspace.meta(db)["revision"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-workspace", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--until", choices=("saved", "complete"), default="complete")
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    with (output / "operation.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        run(args, output)


def run(args, output):
    source_root = Path(args.source_workspace).expanduser().resolve()
    receiving_root = Path(args.workspace).expanduser().resolve()
    if source_root == receiving_root:
        raise ValueError("Receive this example into its own native workspace snapshot")
    context = {"source_workspace": str(source_root), "workspace": str(receiving_root),
               "analysis_id": args.analysis_id, "reviewer": args.reviewer}
    context_raw = raw_json(context)
    exact(output / "context.json", context_raw)
    prior_progress = json.loads((output / "PROGRESS.json").read_bytes()) if (output / "PROGRESS.json").exists() else {}
    invocation = {"id": uuid.uuid4().hex, "pid": os.getpid(), "started_at": datetime.now(timezone.utc).isoformat()}
    saved_invocation = prior_progress.get("saved_invocation")
    prefix = "market-structure-example-" + sha(context_raw)[:24]
    journal = output / "operations"
    journal.mkdir(exist_ok=True)
    replayed = []

    def call(workspace, stage, action, payload):
        request_path = journal / (stage + ".request.json")
        if request_path.exists():
            retained = json.loads(request_path.read_bytes())
            if retained["action"] != action or retained["workspace"] != str(workspace.root):
                raise ValueError("Original mutation identity changed: " + stage)
            body = retained["body"]
            if {k: v for k, v in body.items() if k not in {"operation_id", "expected_revision"}} != payload:
                raise ValueError("Original mutation arguments changed: " + stage)
        else:
            body = {"operation_id": prefix + ":" + stage,
                    "expected_revision": revision(workspace), **payload}
            atomic(request_path, raw_json({"workspace": str(workspace.root), "action": action, "body": body}))
        response = workspace.mutate(action, body)
        original = journal / (stage + ".response.json")
        if original.exists():
            if json.loads(original.read_bytes())["result"] != response["result"]:
                raise ValueError("Original native replay returned a different result: " + stage)
        else:
            atomic(original, raw_json(response))
        atomic(journal / (stage + ".latest.json"), raw_json(response))
        if response["replayed"]:
            replayed.append(stage)
        return response["result"]

    original = Workspace(source_root)
    prepared = call(original, "00-source-snapshot", "prepare_backup", {})
    source_archive = original.backup(prepared["id"])
    source_receipt = {"id": prepared["id"], "path": str(source_archive),
                      "bytes": source_archive.stat().st_size, "sha256": sha(source_archive.read_bytes())}
    exact(output / "source-snapshot.json", raw_json(source_receipt))
    restore(source_archive, receiving_root)
    workspace = Workspace(receiving_root)
    snapshot = workspace.extension_read("market_structure", "document", "analysis", args.analysis_id)
    analysis = snapshot["analysis"]
    review = snapshot.get("accepted_review")
    if not review or review["outcome"] != "accepted":
        raise Problem("Choose the exact currently accepted original comparison", 409, "REVIEW_REQUIRED")
    exact(output / "original-analysis.json", raw_json(snapshot))
    ref = engine.analysis_ref(snapshot)
    dates = [analysis.get("target_date")] if analysis.get("target_date") else []
    document = {
        "name": "Published market illustration — proposed grade G01",
        "edition": "Original accepted percentile decisions",
        "basis": "An analyst operating example using the complete existing accepted comparison. "
                 "The explicit grade and role choices demonstrate the receiving workflow; "
                 "the published numeric illustration does not declare an adopted pay plan.",
        "source_refs": [],
        "analyses": [ref],
        "currency": analysis["currency"],
        "rate_basis": "annual_fulltime",
        "effective_date": "",
        "effective_timing": "Operating illustration; no implementation date declared",
        "date_basis": "common_target_date" if dates else "retained_source_dates",
        "date_basis_note": "Keep the original accepted target date and every source date. "
                           "The illustration has no new market-aging assumption.",
        "source_use_note": "Use the original source files only within their retained permitted-use scope. "
                           "The published FSU example supplies numeric comparisons, not a current "
                           "job-content validation or an adopted compensation decision.",
        "grades": [{
            "id": "G01", "label": "G01 — published comparison illustration",
            "analysis_id": analysis["id"], "reference_mode": "analysis_measure",
            "reference_measure": "p50", "reference_label": "Original accepted 50th percentile",
            "range_mode": "analysis_measures", "lower_measure": "p25", "upper_measure": "p75",
            "rounding": "exact",
            "rationale": "Explicitly select the accepted 25th, 50th and 75th percentiles for this "
                         "receiving illustration; retain their original currency, dates and methodology."
        }],
        "roles": [{
            "id": "role-" + sha(analysis["job"]["id"].encode())[:20],
            "analysis_id": analysis["id"], "grade_id": "G01",
            "rationale": "Assign the original illustrated job to G01 for this operating example. "
                         "Keep its complete source description and published-example limitation."
        }]
    }
    imported = "\ufeff" + raw_json(document).decode("utf-8")
    exact(output / "original-decisions.json", imported.encode("utf-8"))
    payload = {"document": document,
               "original": {"filename": "original-decisions.json", "content": imported},
               "edited_original": False}
    preview = call(workspace, "10-preview", "market_structure.preview", payload)
    expected = {key: Decimal(analysis["consensus"][measure])
                for key, measure in (("min", "p25"), ("reference", "p50"), ("max", "p75"))}
    grade = preview["method"]["grades"][0]
    if any(Decimal(grade[key]) != expected[key] for key in expected):
        raise ValueError("The selected grade no longer retains the exact accepted percentiles")
    proposal = call(workspace, "20-save-proposal", "market_structure.save_proposal",
                    {**payload, "expected_preview_sha256": preview["preview_sha256"], "actor": args.reviewer})
    progress = {"schema": SCHEMA, "phase": "saved", "context": context, "source_snapshot": source_receipt,
                "analysis": ref, "proposal": {"id": proposal["id"], "sha256": proposal["sha256"]},
                "selected_grade": grade, "replayed_stages": replayed, "invocation": invocation,
                "saved_invocation": saved_invocation or (invocation if args.until == "saved" else None)}
    if args.until == "saved":
        atomic(output / "PROGRESS.json", raw_json(progress))
        print(json.dumps(progress, ensure_ascii=False))
        return
    accepted = call(workspace, "30-accept-proposal", "market_structure.review", {
        "id": proposal["id"], "expected_sha256": proposal["sha256"], "outcome": "accepted",
        "reviewer": args.reviewer,
        "notes": "Reviewed the actual original published comparison, exact selected percentiles, "
                 "source descriptions and permitted-use limits. Accepted as this operating illustration."})
    derived = call(workspace, "40-derive-editions", "market_structure.derive", {
        "id": proposal["id"], "expected_sha256": proposal["sha256"],
        "expected_review_id": accepted["id"], "actor": args.reviewer})
    method = workspace.extension_read("classification", "document", "method", derived["method"]["id"])
    roles = workspace.extension_read("classification", "document", "roles", derived["roles"]["id"])
    if method["sha256"] != derived["method"]["sha256"] or roles["sha256"] != derived["roles"]["sha256"]:
        raise ValueError("Derived original editions differ from the native derivation")
    if roles["parents"]["method"]["id"] != method["id"] or roles["parents"]["method"]["sha256"] != method["sha256"]:
        raise ValueError("Derived roles have a different original method")
    if roles["content"]["rows"][0]["native_job"] != analysis["job"]:
        raise ValueError("Derived role no longer retains its exact original job")
    for kind, value, stage in (("method", method, "50-accept-method"), ("roles", roles, "60-accept-roles")):
        call(workspace, stage, "classification.review", {
            "kind": kind, "id": value["id"], "expected_sha256": value["sha256"], "outcome": "accepted",
            "reviewer": args.reviewer,
            "notes": "Reviewed this exact derived original edition against its accepted proposed "
                     "structure and complete retained source. Operating illustration only."})
    reused = call(workspace, "61-reopen-original-derivation", "market_structure.derive", {
        "id": proposal["id"], "expected_sha256": proposal["sha256"],
        "expected_review_id": accepted["id"], "actor": args.reviewer})
    if any(reused[key] != derived[key] for key in ("id", "method", "roles")) or not reused.get("reused"):
        raise ValueError("Reopening a proposal did not retain its original native editions")
    exports = {}
    for kind in ("editable", "accepted-csv", "accepted-package", "source-package"):
        download = workspace.extension_read("market_structure", "download", kind, proposal["id"])
        exports[kind] = exact(output / "exports" / download["filename"], download["data"])
    csv_rows = list(csv.DictReader(io.StringIO(Path(exports["accepted-csv"]["path"]).read_text(encoding="utf-8-sig"))))
    if len(csv_rows) != 1 or csv_rows[0]["proposal_acceptance_id"] != accepted["id"]:
        raise ValueError("Accepted row export lost the original acceptance")
    for role in csv_rows:
        for field, target in (("minimum", "min"), ("reference", "reference"), ("maximum", "max")):
            if Decimal(role[field]) != expected[target]:
                raise ValueError("Accepted CSV changed the retained amount")
        if role["anchor_current_review_id"] != review["id"] or role["role_current_review_id"] != review["id"]:
            raise ValueError("Accepted CSV lost the exact current original review")
    with zipfile.ZipFile(exports["source-package"]["path"]) as package:
        if package.testzip() is not None:
            raise ValueError("Source package did not reopen completely")
        source_members = {item.filename: sha(package.read(item.filename)) for item in package.infolist()}
    backup = call(workspace, "70-complete-backup", "prepare_backup", {})
    archive = workspace.backup(backup["id"])
    backup_receipt = {"id": backup["id"], "path": str(archive), "bytes": archive.stat().st_size,
                      "sha256": sha(archive.read_bytes())}
    reopened_root = output / ("restored-" + backup["id"])
    restore(archive, reopened_root)
    reopened = Workspace(reopened_root)
    for kind, receipt in exports.items():
        download = reopened.extension_read("market_structure", "download", kind, proposal["id"])
        if download["data"] != Path(receipt["path"]).read_bytes():
            raise ValueError("Restored original export differs: " + kind)
    for kind, reference in (("method", derived["method"]), ("roles", derived["roles"])):
        before = workspace.extension_read("classification", "document", kind, reference["id"])
        after = reopened.extension_read("classification", "document", kind, reference["id"])
        if before != after:
            raise ValueError("Restored native edition differs: " + kind)
    same_operation = call(workspace, "40-derive-editions", "market_structure.derive", {
        "id": proposal["id"], "expected_sha256": proposal["sha256"],
        "expected_review_id": accepted["id"], "actor": args.reviewer})
    if same_operation != derived:
        raise ValueError("Original operation replay changed its result")
    with workspace.connect() as db:
        counts = {table: db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                  for table in ("market_structure_proposals", "market_structure_derivations")}
    result = {**progress, "phase": "complete", "proposal_acceptance": accepted,
              "derivation": derived, "native_counts": counts, "exports": exports,
              "source_package_members": source_members, "backup": backup_receipt,
              "reopened_workspace": str(reopened_root), "replayed_stages": replayed,
              "executed_transport": "Original Workspace mutation/read and backup/restore APIs in Linux",
              "browser": "Uses the existing separately coordinated browser continuation"}
    data = raw_json(result)
    atomic(output / "RESULT.json", data)
    atomic(output / "PROGRESS.json", data)
    print(json.dumps({"phase": "complete", "result": str(output / "RESULT.json"),
                      "proposal": result["proposal"], "derivation": derived["id"],
                      "grade": grade, "native_counts": counts, "replayed_stages": replayed,
                      "exports": exports, "backup": backup_receipt}, ensure_ascii=False))


if __name__ == "__main__":
    main()
