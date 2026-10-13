#!/usr/bin/env python3
"""Prepare the complete saved Freeform case for native Workshare receiving.

The original case export, saved Workshare edition, plan and source packet must
agree. Phase effort uses explicit original estimate-role names, keeping the
support phase and all original schedule and commercial fields.
"""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile

OPERATION = "SCF-WORKSHARE-INSTALLATION-20261012"
CASE = "freeform-association-civicrm-workshare-20261012"
ARCHIVE_BYTES = 1585449
ARCHIVE_SHA = "6c35e631b63ebfb27990e8aba12d26fd0b21d2911f2a2edab789e4bb4e4c9db4"
PACKET_SHA = "87d2c30116cca3c7ff872acff063aac56f110984fd1deab2be98fffd7d9fcf73"
PLAN_SHA = "bc6d207bfa87e429c0215f7ed29d68bfd6ebfe3df7f72f22220d2ac290d0be93"
PREFIX = "case-export/cases/" + CASE + "/"
PACKET_MEMBER = "case-export/sources/" + PACKET_SHA + "/Freeform_Association_Workshare_Case_20261012.json"
ROLE_MAPPING = (
    ("intake", "Source inventory and native access/role configuration"),
    ("mapping", "Native source capture including line-item and legacy payment relationships, explicit identity mapping and one annual-conference model"),
    ("native", "Native correction extension, original preimages and receipt/recovery integration"),
    ("operation", "Staff membership/event/payment reconciliation and two consolidated correction cycles"),
    ("handover", "Original full backup/reopen, operator training and customer deployment handover"),
    ("support", "Included scope-defect response and correction allowance after acceptance"),
)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")

def require(condition, message):
    if not condition:
        raise ValueError(message)

def exact_file(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        require(path.read_bytes() == raw, "The retained original output differs: " + str(path))
    else:
        fd, temporary = tempfile.mkstemp(prefix=".workshare-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                require(path.read_bytes() == raw, "A concurrent original output differs.")
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            os.unlink(temporary)
    return {"path": str(path.resolve()), "bytes": len(raw), "sha256": sha(raw)}

def prepare(archive_path, directory):
    archive_path, directory = Path(archive_path).resolve(), Path(directory).resolve()
    archive = archive_path.read_bytes()
    require(len(archive) == ARCHIVE_BYTES and sha(archive) == ARCHIVE_SHA,
            "Use the complete original saved Freeform case handover.")
    with zipfile.ZipFile(archive_path) as source:
        require(len(source.infolist()) == 30 and source.testzip() is None,
                "The complete thirty-member saved handover must remain readable.")
        packet_bytes = source.read(PACKET_MEMBER)
        require(len(packet_bytes) == 53955 and sha(packet_bytes) == PACKET_SHA,
                "The original receiving packet differs.")
        packet = json.loads(packet_bytes)
        saved_case = json.loads(source.read(PREFIX + CASE + ".json"))
        plan = json.loads(source.read(PREFIX + CASE + "-workshare-r1-plan.json"))
        case_source = json.loads(source.read(PREFIX + CASE + "-workshare-r1-source.json"))
        native_receiving = json.loads(source.read("COMPLETE_CASE_RECEIVING.json"))
        editions = saved_case["workshare_work"]["revisions"]
        saved = next(row for row in editions if row["id"] == "workshare-fd8c92e1df02f7e1eafdda6b")
        require(saved["number"] == 1 and saved["plan"] == plan and saved["source"] == case_source,
                "The saved native Workshare edition differs from its exported original files.")
        require(packet["prepared_case"]["id"] == CASE and saved_case["id"] == CASE
                and packet["workshare_input"] == {"source": case_source, "plan": plan},
                "The original case, saved Workshare and receiving packet must agree.")
        require(sha(canonical(plan).encode()) == PLAN_SHA, "The complete original Workshare plan differs.")
        require(native_receiving["case_id"] == CASE and native_receiving["complete"] is True,
                "Use the actually completed original case receiving result.")
        original_files = [{"path": item.filename, "bytes": item.file_size,
                           "sha256": sha(source.read(item.filename))} for item in source.infolist()]
    phases = {row["id"]: row for row in plan["phases"]}
    roles = plan["estimate"]["roles"]
    require(set(phases) == {phase for phase, _ in ROLE_MAPPING} and len(roles) == len(ROLE_MAPPING),
            "Use every original phase and estimate role once.")
    effort = []
    for phase, role_name in ROLE_MAPPING:
        matches = [(index, row) for index, row in enumerate(roles) if row["name"] == role_name]
        require(len(matches) == 1, "The original phase estimate role changed: " + phase)
        index, role = matches[0]
        minutes = role["minutes"]
        require(isinstance(minutes, int) and not isinstance(minutes, bool) and minutes >= 0,
                "Retain the original whole-minute phase estimate.")
        hours = Decimal(minutes) / Decimal(60)
        effort.append({"phase_id": phase, "hours": str(hours), "basis": {
            "source": "original-saved-workshare-plan", "pointer": "/estimate/roles/" + str(index),
            "role": role_name, "minutes": minutes, "workshare_id": saved["id"],
            "scope_id": saved["scope_id"]}})
    require(sum((Decimal(row["hours"]) for row in effort), Decimal(0)) == Decimal(64),
            "Retain the original six-phase sixty-four-hour allocation.")
    require("business_days" not in phases["support"],
            "Preserve the original support phase without inventing a business-day allocation.")
    commissioning = {
        "version": "dealscout.workshare-commissioning-inputs.v1",
        "operation_id": OPERATION,
        "source": {"filename": archive_path.name, "bytes": ARCHIVE_BYTES, "sha256": ARCHIVE_SHA,
                   "packet_member": PACKET_MEMBER, "packet_sha256": PACKET_SHA,
                   "saved_case_member": PREFIX + CASE + ".json",
                   "saved_workshare": {key: saved[key] for key in
                       ("id", "number", "saved_at", "scope_id", "input_sha256")}},
        "cases": [{"case_id": CASE, "workshare_input": packet["workshare_input"],
                   "plan_sha256": PLAN_SHA, "production_effort": effort}],
    }
    packets = {"version": "dealscout.workshare-receiving-packets.v1", "packets": [packet]}
    result = {
        "schema": "stellar-forge.sf47-workshare-installation-inputs.v1",
        "operation": OPERATION, "state": "COMPLETE", "caseId": CASE,
        "savedWorkshareId": saved["id"], "savedScopeId": saved["scope_id"],
        "planSha256": PLAN_SHA, "phaseHours": effort,
        "originalArchive": {"path": str(archive_path), "bytes": ARCHIVE_BYTES, "sha256": ARCHIVE_SHA},
        "originalFiles": original_files,
        "commissioning": exact_file(directory / "Freeform_Original_Workshare_Commissioning.json", json_bytes(commissioning)),
        "packets": exact_file(directory / "Freeform_Complete_Receiving_Packets.json", json_bytes(packets)),
        "originalPacket": exact_file(directory / "Freeform_Original_Receiving_Packet.json", packet_bytes),
    }
    exact_file(directory / "Original_Workshare_Input_Receiving.json", json_bytes(result))
    return result


def verify_cli_export(archive_path, reference_path, case_id, installation_id, revision, edition_sha):
    """Recover an original CLI export using the native reader and full saved case."""
    import io
    from operations import Operations
    import operations_completion as completion
    import operations_installations as installations
    from model import MAX_BUNDLE
    archive_path, reference_path = Path(archive_path), Path(reference_path)
    raw, reference = archive_path.read_bytes(), reference_path.read_bytes()
    document, files = Operations._unpack(raw)
    original, original_files = Operations._unpack(reference)
    def business(value):
        value = dict(value)
        require(isinstance(value.pop("exportedAt", None), str), "Retain the original export timestamp.")
        return value
    require(business(document) == business(original), "The CLI archive belongs to another complete saved case.")
    selected = installations.selection_from_files(document, files)
    require(document["program"]["id"] == case_id and selected ==
            {"id": installation_id, "revision": revision, "sha256": edition_sha},
            "The CLI archive selects another original Installation edition.")
    require(set(files) == set(original_files), "The complete CLI case file inventory differs.")
    def planning_files(payload):
        with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
            members = bundle.infolist()
            require(len(members) <= 20 and len({item.filename for item in members}) == len(members)
                    and sum(item.file_size for item in members) <= MAX_BUNDLE,
                    "The complete original planning archive has invalid entries.")
            manifest = json.loads(bundle.read("MANIFEST.json"))
            require(manifest["schema"] == "stellar-forge.sf47-planning.v1.bundle",
                    "Use the original complete planning bundle.")
            entries = manifest["files"]
            require(len(entries) == len(members) - 1 and
                    {entry["path"] for entry in entries} == {item.filename for item in members} - {"MANIFEST.json"},
                    "The original planning manifest is incomplete.")
            result = {}
            for entry in entries:
                body = bundle.read(entry["path"])
                require(len(body) == entry["bytes"] and sha(body) == entry["sha256"],
                        "A complete original planning file differs.")
                result[entry["path"]] = body
            return result
    current_plan, source_plan = planning_files(files["planning.zip"]), planning_files(original_files["planning.zip"])
    require(set(current_plan) == set(source_plan), "The original planning file selection differs.")
    for name in current_plan:
        if name == "workspace.json":
            require(business(json.loads(current_plan[name])) == business(json.loads(source_plan[name])),
                    "The original full planning revision history differs.")
        else:
            require(current_plan[name] == source_plan[name], "The original planning source differs: " + name)
    context = {**document, "sources": {item["id"]: item for item in document["sources"]}}
    for name in files:
        if name in ("operations.json", "planning.zip"):
            continue
        if name == "completion-calendar.json":
            calendar = json.loads(files[name])
            require(calendar == completion.dashboard(context, calendar["asOfDate"]),
                    "The retained dated calendar differs from the original native calculation.")
        else:
            require(files[name] == original_files[name], "The complete original case member differs: " + name)
    return {"path": str(archive_path.resolve()), "bytes": len(raw), "sha256": sha(raw),
            "caseId": case_id, "installationId": installation_id, "revision": revision,
            "editionSha256": edition_sha, "files": len(files), "planningFiles": len(current_plan)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--directory", required=True)
    options = parser.parse_args()
    print(json.dumps(prepare(options.archive, options.directory), ensure_ascii=False))

if __name__ == "__main__":
    main()
