#!/usr/bin/env python3
"""Prepare whole saved Delivery handovers for the installed Workshare receiver.

The saved snapshot owns the original customer source, plan, terms and phase
identities. The maintained Workshare intake reads those original inputs, and
receive.mjs carries the prepared source into the existing Operations case.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat

SCHEMA = "stellar-forge.installation-handover-selection.v1"


def source_tools():
    path = Path(__file__).resolve().with_name("source-inputs.py")
    spec = importlib.util.spec_from_file_location("installation_handover_source_tools", path)
    if spec is None or spec.loader is None:
        raise ValueError("Retain the installed source-inputs.py beside this command.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    raw = module.stable_file(path)
    return module, {"path": str(path), "bytes": len(raw), "sha256": module.sha(raw)}


def handover_workshare(source, raw, case_id, expected_plan_sha):
    """Join one complete native snapshot to its unchanged saved Workshare."""
    value = source.json_object(raw, case_id + " delivery handover")
    snapshot = value.get("snapshot")
    source.require(isinstance(snapshot, dict)
                   and snapshot.get("version") == "dealscout.delivery-handover.v1",
                   "Use a complete saved dealscout.delivery-handover.v1 snapshot.")
    source.require(isinstance(value.get("sha256"), str)
                   and source.sha(source.canonical(snapshot).encode("utf-8")) == value["sha256"],
                   "The original delivery handover snapshot hash differs: " + case_id)
    case = snapshot.get("case")
    workshare = snapshot.get("workshare")
    execution = snapshot.get("execution")
    scope = snapshot.get("scope")
    source.require(isinstance(case, dict) and case.get("id") == case_id
                   and isinstance(workshare, dict) and isinstance(execution, dict)
                   and isinstance(scope, dict),
                   "Keep the complete original case, saved Workshare, scope and delivery board.")
    source.require(isinstance(workshare.get("id"), str) and bool(workshare["id"])
                   and value.get("workshare_id") == workshare["id"]
                   and execution.get("workshare_id") == workshare["id"]
                   and execution.get("workshare_number") == workshare.get("number")
                   and value.get("board_id") == execution.get("id")
                   and isinstance(execution.get("id"), str) and bool(execution["id"])
                   and workshare.get("scope_id") == scope.get("id")
                   and execution.get("scope_id") == scope.get("id")
                   and isinstance(scope.get("id"), str) and bool(scope["id"]),
                   "Keep the original handover, Workshare, scope and delivery identities together.")
    original_source, plan = workshare.get("source"), workshare.get("plan")
    source.require(isinstance(original_source, dict)
                   and original_source.get("case_id") == case_id
                   and isinstance(plan, dict) and plan.get("version") == "dealscout.workshare-plan.v1",
                   "The original saved Workshare must contain this case's complete source and plan.")
    inputs = {"source": original_source, "plan": plan}
    input_sha = source.sha(source.canonical(inputs).encode("utf-8"))
    source.require(input_sha == workshare.get("input_sha256")
                   and input_sha == execution.get("input_sha256"),
                   "The saved Workshare and delivery must select the same unchanged source and plan.")
    plan_sha = source.sha(source.canonical(plan).encode("utf-8"))
    source.require(plan_sha == expected_plan_sha, "The selected original Workshare plan differs: " + case_id)
    phases, delivered = plan.get("phases"), execution.get("phases")
    source.require(isinstance(phases, list) and bool(phases) and isinstance(delivered, list),
                   "Retain all original planned and saved delivery phases.")
    source.require(all(isinstance(row, dict) and isinstance(row.get("id"), str) for row in phases + delivered),
                   "Retain each original phase identity.")
    by_id = {row["id"]: row for row in phases}
    delivered_by_id = {row["id"]: row for row in delivered}
    source.require(len(by_id) == len(phases) and len(delivered_by_id) == len(delivered)
                   and set(by_id) == set(delivered_by_id),
                   "Keep the complete original phase population once.")
    for ident, phase in by_id.items():
        saved = delivered_by_id[ident]
        source.require(saved.get("source") == phase
                       and saved.get("source_sha256") == source.sha(source.canonical(phase).encode("utf-8")),
                       "The saved delivery phase must match its original Workshare phase: " + ident)
    source.require(isinstance(value.get("id"), str) and bool(value["id"])
                   and isinstance(value.get("total"), int) and not isinstance(value["total"], bool)
                   and value["total"] == len(phases)
                   and isinstance(value.get("completed"), int) and not isinstance(value["completed"], bool)
                   and 0 <= value["completed"] <= value["total"],
                   "Retain the original handover identity and full phase counts.")
    identity = {"handoverId": value["id"], "handoverNumber": value.get("number"),
                "snapshotSha256": value["sha256"], "caseId": case_id,
                "workshareId": workshare["id"], "workshareNumber": workshare.get("number"),
                "workshareInputSha256": input_sha, "scopeId": scope["id"],
                "deliveryId": execution["id"], "createdAt": value.get("created_at"),
                "originalCompletedPhases": value["completed"], "originalTotalPhases": value["total"]}
    return deepcopy(inputs), identity


def prepare(selection_path, source_root, destination):
    source, tools_identity = source_tools()
    require = source.require
    selection_path = Path(os.path.abspath(selection_path))
    source_root = Path(os.path.abspath(source_root))
    require(source_root.resolve() == source_root and source_root.is_dir(),
            "Use the complete original source directory without symbolic-link ancestors.")
    selected_raw = source.stable_file(selection_path)
    selected = source.json_object(selected_raw, "handover source selection")
    source.exact_keys(selected,
                      ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl", "observedAt", "cases"),
                      ("schema", "operationId", "requestPrefix", "receivingName", "sourceUrl", "observedAt", "cases"),
                      "handover source selection")
    require(selected["schema"] == SCHEMA
            and isinstance(selected["operationId"], str) and source.PREFIX.fullmatch(selected["operationId"])
            and isinstance(selected["requestPrefix"], str) and source.PREFIX.fullmatch(selected["requestPrefix"]),
            "Retain the original operation and receiving request prefix.")
    require(isinstance(selected["receivingName"], str) and 0 < len(selected["receivingName"]) <= 300,
            "Name the internal complete-case receiving operation.")
    require(isinstance(selected["sourceUrl"], str) and 0 < len(selected["sourceUrl"]) <= 4000,
            "Retain the source selection's original URL.")
    from datetime import datetime
    require(isinstance(selected["observedAt"], str)
            and datetime.fromisoformat(selected["observedAt"].replace("Z", "+00:00")).utcoffset() is not None,
            "Retain the source selection observation with its timezone.")
    cases = selected["cases"]
    require(isinstance(cases, list) and 0 < len(cases) <= 20, "Select one to twenty complete customer handovers.")
    known, total, case_ids, rows, customers, summaries, profiles = {}, [0], set(), [], [], [], {}
    for case in cases:
        source.exact_keys(case,
                          ("caseId", "profile", "handover", "planSha256", "productionEffort", "effortTotal", "files", "bindings", "programme"),
                          ("caseId", "profile", "handover", "planSha256", "productionEffort", "effortTotal", "files"),
                          "customer handover selection")
        ident = case["caseId"]
        require(isinstance(ident, str) and 0 < len(ident) <= 500 and ident not in case_ids,
                "Select each complete original customer case once.")
        profile = source.installed_profile(case["profile"])
        if profile["id"] in profiles:
            require(profiles[profile["id"]] == profile, "The selected installed profile changed during preparation.")
        profiles[profile["id"]] = profile
        require(isinstance(case["planSha256"], str) and source.SHA256.fullmatch(case["planSha256"]),
                "Select the original canonical Workshare plan SHA-256.")
        require(isinstance(case["files"], list), "Select the complete original customer document list.")
        raw, handover_file = source.source_descriptor(source_root, case["handover"], known, total)
        inputs, original = handover_workshare(source, raw, ident, case["planSha256"])
        documents = [handover_file]
        for selected_file in case["files"]:
            _, metadata = source.source_descriptor(source_root, selected_file, known, total)
            require(metadata["filename"] not in {entry["filename"] for entry in documents},
                    "Select each original customer source file once.")
            documents.append(metadata)
        customer_sources = {entry["filename"]: known[entry["filename"]] for entry in documents}
        effort, complete_effort = source.phase_effort(
            inputs["plan"], case["productionEffort"], case["effortTotal"], customer_sources)
        rows.append({"case_id": ident, "workshare_input": inputs,
                     "plan_sha256": case["planSha256"], "production_effort": effort,
                     "original_handover": {"file": handover_file, **original},
                     "complete_effort": complete_effort})
        customer = {"profile": case["profile"], "workshareCaseId": ident,
                    "planSha256": case["planSha256"], "files": documents}
        if "bindings" in case:
            require(isinstance(case["bindings"], dict), "Use the explicit original customer bindings.")
            customer["bindings"] = deepcopy(case["bindings"])
        if "programme" in case:
            customer["programme"] = source.customer_programme(case["programme"], documents, known)
        customers.append(customer)
        summaries.append({"caseId": ident, "profile": case["profile"],
                          "planSha256": case["planSha256"], "originalHandover": original,
                          "commercial": inputs["plan"]["commercial"], "schedule": inputs["plan"]["schedule"],
                          "phaseIds": [phase["id"] for phase in inputs["plan"]["phases"]],
                          "productionEffort": effort, "completeEffort": complete_effort})
        case_ids.add(ident)
    commissioning = {"version": "dealscout.workshare-commissioning-inputs.v1",
                     "operation_id": selected["operationId"],
                     "source": {"selection_sha256": source.sha(selected_raw),
                                "original_files": [entry["record"] for entry in known.values()],
                                "source_url": selected["sourceUrl"], "observed_at": selected["observedAt"]},
                     "cases": rows}
    native, native_identity = source.original_intake()
    verified = native.load_workshares(commissioning, receiving_packet=None, require_proposed_usd=False)
    require([(row["caseId"], row["planSha256"], row["phaseCount"]) for row in verified]
            == [(row["caseId"], row["planSha256"], len(row["phaseIds"])) for row in summaries],
            "The maintained native intake selected different customer plans or phase populations.")
    commissioning_raw = source.json_bytes(commissioning)
    require(len(commissioning_raw) <= source.MAX_FILE,
            "The complete commissioning file exceeds the native receiver's 8 MiB bound.")
    for profile in profiles.values():
        require(source.installed_profile(profile["id"]) == profile,
                "The selected installed profile changed before retaining the source.")
    require(source.sha(source.stable_file(tools_identity["path"])) == tools_identity["sha256"],
            "The installed source preparation helper changed during this operation.")
    output = source.private_directory(destination)
    descriptor = os.open(output / "source-preparation.lock",
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info, named = os.fstat(descriptor), os.lstat(output / "source-preparation.lock")
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077
                and info.st_uid == os.getuid() and (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                "Retain the private owned source preparation lease.")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        outputs = [source.retain(output / "SOURCE_SELECTION.json", selected_raw)]
        outputs.extend(source.retain(output / entry["record"]["filename"], entry["raw"])
                       for entry in known.values())
        commissioning_file = source.retain(output / "Supplier_Workshare_Commissioning.json", commissioning_raw)
        outputs.append(commissioning_file)
        for customer in customers:
            customer["files"] = [
                {**commissioning_file, "role": "commissioning", "sourceUrl": selected["sourceUrl"],
                 "observedAt": selected["observedAt"], "mediaType": "application/json"},
                *[{**entry, "role": "source"} for entry in customer["files"]]]
        receiving = {"schema": source.RECEIVING, "requestPrefix": selected["requestPrefix"],
                     "receivingName": selected["receivingName"], "customers": customers}
        outputs.append(source.retain(output / "SUPPLIER_RECEIVING.json", source.json_bytes(receiving)))
        report = {"schema": "stellar-forge.installation-handover-preparation.v1", "state": "PREPARED_SOURCE",
                  "operationId": selected["operationId"],
                  "sourceSelection": {"bytes": len(selected_raw), "sha256": source.sha(selected_raw)},
                  "sourceTools": tools_identity, "originalIntake": native_identity,
                  "profiles": list(profiles.values()), "cases": summaries,
                  "nativeWorkshares": [{"caseId": row["caseId"], "planSha256": row["planSha256"],
                                       "hours": row["hours"], "phaseCount": row["phaseCount"],
                                       "packetPresent": row["packetPresent"]} for row in verified],
                  "outputs": outputs}
        receipt = source.retain(output / "SOURCE_PREPARATION.json", source.json_bytes(report))
        return {**report, "output": {**receipt, "path": str(output / receipt["filename"])}}
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, help="Complete original handover selection JSON")
    parser.add_argument("--source-root", required=True, help="Directory containing every selected original file")
    parser.add_argument("--out", required=True, help="Private create-only preparation directory")
    args = parser.parse_args()
    print(json.dumps(prepare(args.selection, args.source_root, args.out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
