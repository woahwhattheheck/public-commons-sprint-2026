#!/usr/bin/env python3
"""Receive the complete Apex public input bundle in the original workbench.

Requests use the original workspace operation ledger. Re-running the same
operation ID and unchanged inputs recovers saved results after response loss.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent


def text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def receive(workbench_source, workspace_path, compiled, operation_id, actor,
            reviewer, notes, create=False):
    sys.path.insert(0, str(workbench_source.resolve()))
    from core import Workspace, initialize
    from classification import engine
    # Validate the source method before creating or changing a workspace.
    engine.method(read(compiled / "method.json"))
    if not workspace_path.exists():
        if not create:
            raise ValueError("Choose an existing workspace, or explicitly use --create")
        initialize(workspace_path, "Town of Apex public-safety classification")
    workspace = Workspace(workspace_path)
    events = []

    def call(step, action, **payload):
        response = workspace.mutate(action, {
            "operation_id": operation_id + "." + step,
            "expected_revision": workspace.state()["workspace"]["revision"],
            **payload,
        })
        result = response["result"]
        events.append({
            "step": step, "action": action, "operation_id": operation_id + "." + step,
            "operation_revision": response["operation_revision"],
            "replayed": response["replayed"],
            "id": result.get("id") or result.get("source_id"),
            "sha256": result.get("sha256"),
        })
        return result

    def reviewed(kind, document, step):
        return call("review-" + step, "classification.review", kind=kind,
                    id=document["id"], expected_sha256=document["sha256"],
                    reviewer=reviewer, outcome="accepted", notes=notes)

    compiled_method = read(compiled / "method.json")
    preview = call("source-preview", "preview", kind="jobs",
                   text=(compiled / "jobs-source-import.json").read_text(encoding="utf-8"),
                   filename="apex-fy27-jobs-and-original-sources.json",
                   source_name="Town of Apex FY27 public-safety source",
                   edition=compiled_method["edition"],
                   metadata={
                       "number_format": "plain", "currency": "USD",
                       "reference_basis": "Published Market Salary, annual full-time 1.0 FTE",
                       "original_source_bundle": "All original PDFs, source rows and RFP/authorization mapping are retained in this raw JSON import.",
                   })
    if preview.get("errors"):
        raise ValueError("Correct the native source preview errors before import: " + text(preview["errors"]))
    imported = call("source-import", "import", preview_id=preview["id"])
    records = workspace.records("jobs", source_id=imported["source_id"], limit=500)
    if records["total"] != 47 or len(records["items"]) != 47:
        raise ValueError("The native Apex source must contain all 47 original public-safety roles")
    jobs = {row["record_key"]: row["id"] for row in records["items"]}

    method_input = deepcopy(compiled_method)
    for ref in method_input["source_refs"]:
        ref["native_import_id"] = imported["source_id"]
    method = call("method", "classification.save_method", actor=actor,
                  document=method_input, content=text(method_input),
                  format="json", filename="apex-fy27-method.json")
    method_review = reviewed("method", method, "method")

    roles_input = read(compiled / "roles.json")
    for ref in roles_input["source_refs"]:
        ref["native_import_id"] = imported["source_id"]
    for row in roles_input["rows"]:
        row["native_job_id"] = jobs[row["id"]]
    roles = call("roles", "classification.save_roles", actor=actor,
                 method_id=method["id"], document=roles_input,
                 content=text(roles_input), format="json", filename="apex-fy27-roles.json")
    if roles["content"].get("errors"):
        raise ValueError("Correct the displayed native role errors: " + text(roles["content"]["errors"]))
    roles_review = reviewed("roles", roles, "roles")

    rosters = []
    for scope in ("all-public-safety", "rfp-listed"):
        for envelope in ("lower", "upper"):
            filename = f"planning-{scope}-{envelope}.json"
            value = read(compiled / filename)
            roster = call("roster-" + scope + "-" + envelope, "classification.save_roster",
                          actor=actor, roles_id=roles["id"], document=value,
                          content=text(value), format="json", filename=filename)
            if roster["content"].get("errors"):
                raise ValueError("Correct the displayed workforce errors: " + text(roster["content"]["errors"]))
            review = reviewed("roster", roster, scope + "-" + envelope)
            rosters.append({
                "scope": scope, "envelope": envelope,
                "id": roster["id"], "sha256": roster["sha256"],
                "review_id": review["id"], "planning_summary": value["planning_summary"],
            })
    return {
        "schema": "apex.native-input-receiving/v1",
        "operation_id": operation_id, "workspace_directory": str(workspace_path.resolve()),
        "workspace": workspace.state()["workspace"],
        "source_id": imported["source_id"], "source_rows": records["total"],
        "method": {"id": method["id"], "sha256": method["sha256"], "review_id": method_review["id"]},
        "roles": {"id": roles["id"], "sha256": roles["sha256"], "review_id": roles_review["id"]},
        "rosters": rosters, "operations": events,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbench-source", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--compiled", type=Path, default=HERE / "compiled")
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--review-notes", required=True)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = receive(args.workbench_source, args.workspace, args.compiled,
                     args.operation_id, args.actor, args.reviewer, args.review_notes, args.create)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text(result), encoding="utf-8")
    print(text(result), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
