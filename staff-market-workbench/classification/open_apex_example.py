#!/usr/bin/env python3
"""Open the complete source-native Apex public planning case in one workspace."""
from __future__ import annotations

import argparse
import fcntl
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
WORKBENCH = HERE.parent
INPUTS = HERE / "inputs" / "apex-fy27"


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(json_bytes(value))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def retain_exports(path, members):
    """Keep an existing exact export archive; create new bytes deterministically."""
    with path.with_name(path.name + ".lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if path.exists():
            with zipfile.ZipFile(path) as retained:
                names = retained.namelist()
                if (len(names) != len(members) or len(names) != len(set(names))
                        or set(names) != set(members)
                        or any(retained.read(name) != body for name, body in members.items())):
                    raise ValueError("The retained export archive belongs to different results; choose another output directory")
            return
        fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "w+b") as output:
                with zipfile.ZipFile(output, "w") as archive:
                    for member, body in members.items():
                        info = zipfile.ZipInfo(member, (1980, 1, 1, 0, 0, 0))
                        info.create_system = 3
                        info.external_attr = 0o100644 << 16
                        archive.writestr(info, body, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def open_case(workspace_path, output_path, operation_id, actor, reviewer, notes,
              create=False, source_receiving=None):
    sys.path.insert(0, str(WORKBENCH))
    from core import Workspace
    if source_receiving is None:
        spec = importlib.util.spec_from_file_location("apex_original_intake", INPUTS / "native_import.py")
        receiver = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(receiver)
        source = receiver.receive(WORKBENCH, workspace_path, INPUTS / "compiled",
                                  operation_id + ".source", actor, reviewer, notes, create)
    else:
        source = json.loads(source_receiving.read_text(encoding="utf-8"))
    workspace = Workspace(workspace_path)
    if source["workspace"]["id"] != workspace.state()["workspace"]["id"]:
        raise ValueError("The source-receiving record belongs to another workspace")
    output_path.mkdir(parents=True, exist_ok=True)
    write_json(output_path / "original-input-receiving.json", source)
    events = []

    def read(kind, identity):
        return workspace.extension_read("classification", "document", kind, identity)

    def call(step, action, **payload):
        response = workspace.mutate("classification." + action, {
            "operation_id": operation_id + "." + step,
            "expected_revision": workspace.state()["workspace"]["revision"], **payload})
        result = response["result"]
        events.append({"step": step, "operation_id": operation_id + "." + step,
                       "operation_revision": response["operation_revision"],
                       "replayed": response["replayed"], "id": result.get("id"),
                       "sha256": result.get("sha256")})
        return result

    structure = read("method", source["method"]["id"])
    roles = read("roles", source["roles"]["id"])
    selected = next(row for row in source["rosters"]
                    if row["scope"] == "rfp-listed" and row["envelope"] == "lower")
    lower = read("roster", selected["id"])
    for document, expected in ((structure, source["method"]), (roles, source["roles"]), (lower, selected)):
        if document["sha256"] != expected["sha256"]:
            raise ValueError("The retained source-receiving identity has changed")
    for document, key, parent in ((roles, "method", structure),
                                  (lower, "roles", roles), (lower, "method", structure)):
        ref = document.get("parents", {}).get(key, {})
        if any(ref.get(field) != parent[field] for field in ("id", "sha256", "kind")):
            raise ValueError("The source-receiving documents do not share the same original parent editions")
    grades = {row["id"]: row for row in structure["content"]["grades"]}
    by_role = {row["id"]: row for row in roles["content"]["rows"]}
    target = deepcopy(lower["content"])
    target["name"] = "Apex RFP-listed public cohort — minimum to published market"
    target["edition"] += " / same-grade published market targets"
    target["basis"] = (
        "Public planning comparison using the retained RFP-listed lower-envelope allocation. "
        "Each combined authorization group keeps one original FTE total and its selected role. "
        "The target is that same grade's Published Market Salary from the adopted FY27 pay table. "
        "Source rates and targets are annual full-time amounts; the original group FTE is applied once. "
        "Current employee pay and actual career-level allocations enter through a separately reviewed workforce edition.")
    target["source_refs"].append({"kind": "native-source-roster", "id": lower["id"],
                                   "sha256": lower["sha256"], "basis": lower["content"]["basis"]})
    for row in target["rows"]:
        grade = grades[by_role[row["role_id"]]["grade_id"]]
        row["proposed_annual_base_rate"] = grade["reference"]
        row["placement_rationale"] = (
            "Same retained grade " + grade["id"] + ": use its exact Published Market Salary "
            + grade["reference"] + " while preserving the original lower-envelope allocation.")
    target_document = call("market-target-roster", "save_roster", actor=actor,
                           roles_id=roles["id"], document=target,
                           content=json_bytes(target).decode("utf-8"), format="json",
                           filename="apex-same-grade-market-targets.json", supersedes=lower["id"])
    if target_document["content"].get("errors"):
        raise ValueError("Correct the displayed target-workforce errors before calculation")
    target_review = call("review-market-target-roster", "review", kind="roster",
                         id=target_document["id"], expected_sha256=target_document["sha256"],
                         reviewer=reviewer, outcome="accepted", notes=notes)
    variants = {
        "immediate": [{"effective_date": "2027-07-01", "share_pct": "100"}],
        "phased": [{"effective_date": "2027-07-01", "share_pct": "50"},
                   {"effective_date": "2028-01-01", "share_pct": "100"}],
        "deferred": [{"effective_date": "2028-01-01", "share_pct": "100"}],
    }
    scenarios = []
    package_path = output_path / "apex-accepted-placement-exports.zip"
    members = {}
    for name, phases in variants.items():
        config = {"title": "Apex public planning — " + name,
                  "purpose": target["basis"], "placement": "manual",
                  "period_start": "2027-07-01", "period_end": "2028-06-30",
                  "day_basis": "actual_actual", "include_incentives": False,
                  "allow_explicit_reductions": False, "burden_pct": "0",
                  "burden_basis": "Explicit incremental base-pay-only public planning comparison.",
                  "minimum_manager_gap_pct": "0", "experience_pct_per_year": "0",
                  "maximum_credited_years": "0", "phases": phases, "incentive_rules": []}
        selection = {"method_id": structure["id"], "roles_id": roles["id"],
                     "roster_id": target_document["id"], "config": config}
        preview = call(name + "-preview", "preview_scenario", **selection)
        if preview.get("errors"):
            raise ValueError("Correct the displayed " + name + " scenario errors before saving")
        scenario = call(name + "-scenario", "save_scenario", actor=actor,
                        expected_preview_sha256=preview["preview_sha256"], **selection)
        review = call(name + "-review", "review", kind="scenario", id=scenario["id"],
                      expected_sha256=scenario["sha256"], reviewer=reviewer,
                      outcome="accepted", notes=notes)
        exports = []
        for kind, suffix in (("scenario-csv", "csv"), ("scenario-package", "json")):
            result = workspace.extension_read("classification", "download", kind, scenario["id"])
            body = result["data"]
            member = name + "-accepted." + suffix
            members[member] = body
            exports.append({"member": member, "bytes": len(body),
                            "sha256": hashlib.sha256(body).hexdigest()})
        scenarios.append({"name": name, "id": scenario["id"], "sha256": scenario["sha256"],
                          "review_id": review["id"], "totals": scenario["content"]["totals"],
                          "exports": exports})
    retain_exports(package_path, members)
    manifest = {"schema": "apex.public-planning-case/v1", "operation_id": operation_id,
                "workspace": workspace.state()["workspace"], "input_receiving": "original-input-receiving.json",
                "target_roster": {"id": target_document["id"], "sha256": target_document["sha256"],
                                  "review_id": target_review["id"]},
                "scenarios": scenarios, "operations": events,
                "accepted_exports": {"filename": package_path.name, "bytes": package_path.stat().st_size,
                                     "sha256": hashlib.sha256(package_path.read_bytes()).hexdigest()}}
    write_json(output_path / "apex-public-planning-case.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--review-notes", required=True)
    parser.add_argument("--input-receiving", type=Path)
    parser.add_argument("--create", action="store_true")
    args = parser.parse_args()
    result = open_case(args.workspace, args.out or args.workspace / "classification" / "apex-example",
                       args.operation_id, args.actor, args.reviewer, args.review_notes,
                       args.create, args.input_receiving)
    print(json_bytes(result).decode("utf-8"), end="")


if __name__ == "__main__":
    main()
