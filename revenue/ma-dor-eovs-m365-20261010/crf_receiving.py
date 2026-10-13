#!/usr/bin/env python3
"""Run an explicit CRF reporting plan through two editable receivers.

Original files, mapping decisions and any native workbook evidence are supplied by the
operator. This programme uses the maintained Store and full portable receiver.
It does not call a platform, post money, infer acceptance or claim browser review.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import io
import json
import os
from pathlib import Path
import stat
import sqlite3
import sys
from migration_store import (
    MigrationError, canonical, identity, parse_json, file_hash,
    identifier, digest, integer, basename, text, regular,
)
from migration_workspace import MigrationWorkspace
from migration_portable import (
    PortableService, receive_delivery, inspect_delivery, publish_bytes,
    ordinary_directory, capture_file, file_description, application_selection,
    APPLICATION_FILES, APPLICATION_PROFILE, canonical as encoded,
)
import crf_workspace as crf_records
from crf_domain import require, obj

SCHEMA = "commons.crf-receiving-plan/v1"
RESULT_SCHEMA = "commons.crf-receiving-result/v1"
PHASE_SCHEMA = "commons.crf-receiving-phase/v1"
MAX_PLAN_BYTES = 64 * 1024 * 1024
RESERVED = {"actor", "expected_revision", "operation_id"}
REFERENCE_KEYS = {"$file", "$sha", "$step", "$record"}


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "CRF_PLAN_DUPLICATE_KEY",
                "The original plan repeats a JSON object key.", key=key)
        result[key] = value
    return result


def decode_plan(raw):
    def reject_constant(value):
        raise MigrationError("CRF_PLAN_JSON", "The plan contains a nonfinite JSON token.", {"token": value})
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique_pairs, parse_constant=reject_constant)
    except (ValueError, UnicodeError) as error:
        raise MigrationError("CRF_PLAN_JSON", "The complete original plan is not valid UTF-8 JSON.") from error


def application_binding(source_root):
    source_root = ordinary_directory(source_root)
    members = [file_description(source_root / name, "application/" + name) for name in APPLICATION_FILES]
    profile = application_selection(members, profile=APPLICATION_PROFILE)
    require(profile == APPLICATION_PROFILE and {"crf_domain.py","crf_workspace.py","crf_workbook.py","crf_receiving.py","CRF_REPORTING.md","public/crf.html","public/crf.js","public/crf.css"} <= set(APPLICATION_FILES),
            "CRF_APPLICATION_SELECTION", "Use the complete maintained application including all CRF reporting leaves.")
    return {"profile": profile, "files": members, "sha256": identity(members)}


def execution_binding(source_root):
    executable = Path(sys.executable).resolve(strict=True)
    regular(executable)
    # Bind this actual interpreter once per invocation; file hashing is streamed.
    runtime = {"executable": str(executable), **file_hash(executable), "version": sys.version,
               "implementation": sys.implementation.name, "cache_tag": sys.implementation.cache_tag,
               "sqlite_version": sqlite3.sqlite_version, "byteorder": sys.byteorder}
    # Reject already imported application modules supplied from another source root.
    root = Path(source_root).resolve(strict=True)
    for name in APPLICATION_FILES:
        if "/" in name or not name.endswith(".py"): continue
        module = sys.modules.get(name[:-3])
        if module is not None:
            require(Path(module.__file__).resolve(strict=True) == root / name,
                    "CRF_IMPORTED_SOURCE", "An imported application module came from another source edition.", module=name)
    return {"schema": "commons.crf-execution-binding/v1", "application": application_binding(root), "runtime": runtime}


def assert_application(source_root, binding):
    require(application_binding(source_root) == binding["application"], "CRF_APPLICATION_CHANGED",
            "The original programme's complete application selection changed; preserve its exact source before continuing.")


def read_plan(path):
    path = Path(path).expanduser().absolute()
    regular(path)
    with path.open("rb") as stream:
        before = file_hash(stream)
        require(before["bytes"] <= MAX_PLAN_BYTES, "CRF_PLAN_SIZE",
                "The complete plan exceeds the explicit 64 MiB bound.")
        raw = stream.read(MAX_PLAN_BYTES + 1)
    require(len(raw) == before["bytes"] and identity_bytes(raw) == before["sha256"],
            "CRF_PLAN_CHANGED", "Original plan changed while it was read.")
    return raw, before


def identity_bytes(raw):
    import hashlib
    return hashlib.sha256(raw).hexdigest()


def references(value, files, previous):
    """Validate reference scope before admitting any original mutation."""
    if isinstance(value, list):
        for item in value: references(item, files, previous)
    elif isinstance(value, dict):
        selected = set(value) & REFERENCE_KEYS
        if selected:
            require(len(value) == 1, "CRF_PLAN_REFERENCE",
                    "A file or step reference must be its complete one-key object.")
            key = next(iter(selected))
            name = value[key]
            require(isinstance(name, str) and name in (files if key in ("$file", "$sha") else previous),
                    "CRF_PLAN_REFERENCE", "Reference an original file or an earlier retained step.", reference=value)
        else:
            for item in value.values(): references(item, files, previous)


def validate_plan(value):
    obj(value, ("schema", "operation_id", "title", "actor", "workbook_required",
                "files", "steps", "first_edit", "second_edit"))
    require(value["schema"] == SCHEMA, "CRF_PLAN_SCHEMA", "Use the complete crf receiving plan.")
    identifier(value["operation_id"], "operation_id")
    text(value["title"], "title"); text(value["actor"], "actor")
    require(type(value["workbook_required"]) is bool, "CRF_PLAN_WORKBOOK",
            "Declare explicitly whether the actual native workbook return is part of this original course.")
    require(isinstance(value["files"], list), "CRF_PLAN_FILES", "Supply the complete original file inventory.")
    file_keys = set()
    for member in value["files"]:
        obj(member, ("key", "path", "filename", "sha256", "bytes"), ("purpose",))
        identifier(member["key"], "file key")
        require(member["key"] not in file_keys, "CRF_PLAN_FILE_KEY", "Keep original file keys unique.")
        file_keys.add(member["key"])
        text(member["path"], "original path"); basename(member["filename"])
        digest(member["sha256"]); integer(member["bytes"], "original bytes")
        if "purpose" in member: text(member["purpose"], "file purpose")
    for name in ("first_edit", "second_edit"):
        obj(value[name], ("actor", "steps"))
        text(value[name]["actor"], name + " actor")
    actors = [value["actor"], value["first_edit"]["actor"], value["second_edit"]["actor"]]
    require(len(set(actors)) == 3, "CRF_PLAN_RECIPIENT",
            "Name the original operator and both independent receiving operators distinctly.")
    previous = set()
    for phase, steps in (("original", value["steps"]), ("first-edit", value["first_edit"]["steps"]),
                         ("second-edit", value["second_edit"]["steps"])):
        require(isinstance(steps, list) and steps, "CRF_PLAN_STEPS",
                "Retain the complete original course and both explicit recipient edits.", phase=phase)
        for step in steps:
            obj(step, ("key", "operation", "payload"))
            identifier(step["key"], "step key")
            require(step["key"] not in previous, "CRF_PLAN_STEP_KEY", "Keep all programme step keys unique.")
            require(step["operation"] in crf_records.MUTATIONS, "CRF_PLAN_OPERATION",
                    "Use an advertised original crf mutation.", operation=step["operation"])
            require(isinstance(step["payload"], dict) and not set(step["payload"]) & RESERVED,
                    "CRF_PLAN_ENVELOPE", "The programme binds actor, original operation ID and current revision.")
            references(step["payload"], file_keys, previous)
            previous.add(step["key"])
    operations = [step["operation"] for step in value["steps"]]
    require("crf.contract.create" in operations and operations.count("crf.edition.create") >= 2
            and "crf.comparison.create" in operations,
            "CRF_PLAN_COURSE", "Retain an original contract, two complete reporting editions and their complete comparison.")
    if value["workbook_required"]:
        require("crf.workbook_output.create" in operations and "crf.workbook_return.create" in operations, "CRF_PLAN_WORKBOOK",
                "The required original workbook course includes actual template-derived output and its independently returned native file.")
    return value


def resolve(value, files, records):
    if isinstance(value, list): return [resolve(item, files, records) for item in value]
    if not isinstance(value, dict): return value
    if set(value) == {"$file"}:
        member = files[value["$file"]]
        return {key: member[key] for key in ("sha256", "filename", "purpose") if key in member}
    if set(value) == {"$sha"}: return files[value["$sha"]]["sha256"]
    if set(value) in ({"$step"}, {"$record"}): return records[next(iter(value.values()))]["id"]
    return {key: resolve(item, files, records) for key, item in value.items()}


@contextmanager
def programme_lock(output):
    """Only one continuation may advance this retained programme directory."""
    fd = os.open(output / "programme.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "CRF_PROGRAMME_LOCK", "Programme lock must be an ordinary file.")
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("CRF_PROGRAMME_BUSY", "The same programme already has an active owner.") from error
        yield
    finally:
        os.close(fd)


def original_operation(workspace, operation, payload, *, resume):
    old = workspace._operation(payload["operation_id"], required=False)
    if old:
        semantic = {key: value for key, value in payload.items() if key not in ("operation_id", "expected_revision")}
        require(old["operation"] == operation and old["request_sha256"] ==
                identity({"operation": operation, "payload": semantic}),
                "CRF_PLAN_CONTINUITY", "The original step is bound to different inputs, actor or decisions.")
        if old["status"] == "SUCCEEDED": return old["result"]["result"]
        require(resume, "CRF_PLAN_RESUME", "Explicitly resume the same interrupted original operation.",
                operation_id=old["id"], status=old["status"])
        return workspace.resume_original(old["id"], actor=payload["actor"],
            reason="Explicit continuation of the complete original crf receiving plan.",
            expected_revision=workspace.project["revision"], handler=workspace._handler(operation))["result"]
    return workspace.dispatch(operation, payload)["result"]


def stage_files(workspace, plan, raw_plan):
    workspace.stage_file(io.BytesIO(raw_plan), "crf-original-plan.json",
                         expected_sha256=identity_bytes(raw_plan), expected_bytes=len(raw_plan))
    result = {}
    for member in plan["files"]:
        # A completed original intake remains usable if its former external path
        # has moved. open_file verifies the original content-addressed bytes.
        known = workspace.conn.execute("SELECT sha256 FROM files WHERE sha256=?", (member["sha256"],)).fetchone()
        if known:
            with workspace.open_file(member["sha256"]) as stream:
                actual = file_hash(stream)
            require(actual == {"sha256": member["sha256"], "bytes": member["bytes"]},
                    "CRF_PLAN_FILE", "Retained original file differs from the admitted plan.")
        else:
            path = Path(member["path"]).expanduser().absolute()
            regular(path)
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "CRF_PLAN_FILE",
                        "Original source must be an ordinary file.")
                workspace.stage_file(stream, member["filename"], expected_sha256=member["sha256"],
                                     expected_bytes=member["bytes"])
        result[member["key"]] = {"sha256": member["sha256"], "bytes": member["bytes"], "filename": member["filename"]}
        if "purpose" in member: result[member["key"]]["purpose"] = member["purpose"]
    return result


def record_pins(records):
    return {key: {"id": value["id"], "kind": value["kind"], "sha256": identity(value)}
            for key, value in records.items()}


def checked_phase(path, binding, records, current_verification, readiness=None):
    pins = record_pins(records)
    if path.exists():
        regular(path)
        saved = parse_json(path.read_text("utf-8"))
        require(saved["schema"] == PHASE_SCHEMA and saved["binding"] == binding and saved["records"] == pins
                and saved["verification"]["workspace_id"] == current_verification["workspace_id"],
                "CRF_PHASE_CONTINUITY", "Retained phase is bound to different original operations or workspace.")
        if readiness is not None:
            require(saved["readiness"] == readiness, "CRF_PHASE_READINESS", "Original phase selections changed.")
        # The current verification may contain later edits. Keep the original
        # immutable phase receipt, after checking the current complete workspace.
        return saved
    saved = {"schema": PHASE_SCHEMA, "binding": binding, "records": pins,
             "verification": current_verification, "readiness": readiness}
    publish_bytes(path, encoded(saved))
    return saved


def run_steps(workspace, plan, steps, files, records, phase, actor, *, resume, source_root, binding):
    selected = {}
    for step in steps:
        assert_application(source_root, binding)
        payload = resolve(step["payload"], files, records)
        payload.update(operation_id="crf-" + identity({
            "plan": plan["operation_id"], "phase": phase, "step": step["key"]})[:50],
            expected_revision=workspace.project["revision"], actor=actor)
        result = original_operation(workspace, step["operation"], payload, resume=resume)
        require(result.get("kind") == step["operation"].removesuffix(".create"),
                "CRF_STEP_RESULT", "Original operation returned another crf record kind.")
        records[step["key"]] = result; selected[step["key"]] = result
        print(canonical({"event": "crf_step", "phase": phase, "key": step["key"], "id": result["id"],
                         "workspace_id": workspace.project["id"], "revision": workspace.project["revision"]}), flush=True)
    return selected


def original_readiness(workspace, plan, records):
    contracts={value["id"] for value in records.values() if value["kind"]=="crf.contract"}
    editions=[value for value in records.values() if value["kind"]=="crf.edition"]
    comparisons=[value for value in records.values() if value["kind"]=="crf.comparison"]
    require(len({value["id"] for value in editions})>=2,"CRF_PLAN_EDITIONS","Retain two distinct complete original reporting editions.")
    for edition in editions:
        require(edition["contract_id"] in contracts,"CRF_PLAN_CONTRACT","Each reporting edition binds the original reviewed contract.")
    original_ids={value["id"] for value in editions}
    require(any(value["earlier_id"] in original_ids and value["later_id"] in original_ids and value["earlier_id"]!=value["later_id"] for value in comparisons),
            "CRF_PLAN_COMPARISON","Retain the complete comparison of two distinct original reporting editions.")
    outputs=[value for value in records.values() if value["kind"]=="crf.workbook_output"]
    for output in outputs:
        require(output["edition_id"] in original_ids and output["contract_id"] in contracts,
                "CRF_PLAN_WORKBOOK_EDITION", "Each original workbook output binds a selected reporting edition and its original reviewed contract.")
    output_ids={value["id"] for value in outputs}
    returned=[value for value in records.values() if value["kind"]=="crf.workbook_return"]
    for returned_workbook in returned:
        require(returned_workbook["output_id"] in output_ids and returned_workbook["contract_id"] in contracts,
                "CRF_PLAN_WORKBOOK_RETURN", "Each original native workbook return binds an original-course workbook output and its reviewed contract.")
    if plan["workbook_required"]:
        require(returned,"CRF_PLAN_WORKBOOK","The required actual native workbook return has not returned.")
    return {"outcome":"native-workbook-return-retained" if returned else "editable-reporting-workspace-received",
            "workbook_required":plan["workbook_required"],"workbook_return":returned[-1] if returned else None,
            "editions":[{"id":value["id"],"period":value["period"],"report":value["report"],"sections":value["sections"]} for value in editions],
            "comparisons":[{"id":value["id"],"earlier_id":value["earlier_id"],"later_id":value["later_id"],"counts":value["counts"]} for value in comparisons],
            "reviews":[{"id":value["id"],"edition_id":value["edition_id"],"statuses":value["statuses"]} for value in records.values() if value["kind"]=="crf.review"],
            "meaning":"Original reporting values and actual supplied workbook return are retained. This does not establish Section 151 sign-off, copied submission email, DWP acceptance or actual rendered-product inspection."}

def prepare_archive(workspace, source_root, output, plan, phase, actor, *, resume, binding):
    assert_application(source_root, binding)
    service = PortableService(workspace, workspace.root, source_root)
    payload = {"operation_id": "crf-delivery-" + identity({"plan": plan["operation_id"], "phase": phase})[:45],
               "expected_revision": workspace.project["revision"], "actor": actor,
               "title": plan["title"] + " — " + phase,
               "note": "Complete CRF contracts, original sources, reporting editions, lineage, decisions, actual workbook files, application and editable workspace."}
    result = original_operation(workspace, "delivery.prepare", payload, resume=resume)
    record, stream = service.open_delivery(result["id"])
    stream.close()
    destination = output / record["filename"]
    captured = capture_file(workspace.root / record["relative_path"], destination, destination.name,
        expected={"path": destination.name, "sha256": record["archive_sha256"], "bytes": record["archive_bytes"]})
    inspected = inspect_delivery(destination)
    selected = [member for member in inspected["manifest"]["files"] if member["path"].startswith("application/")]
    require(sorted(selected, key=lambda x: x["path"]) ==
            sorted(binding["application"]["files"], key=lambda x: x["path"]),
            "CRF_ARCHIVE_SOURCE", "The portable archive contains another complete application edition.")
    return {"path": str(destination), "sha256": captured["sha256"], "bytes": captured["bytes"],
            "delivery_id": record["id"], "operation_id": payload["operation_id"]}


def verify_archive(entry):
    regular(entry["path"])
    require(file_hash(entry["path"]) == {key: entry[key] for key in ("sha256", "bytes")},
            "CRF_ARCHIVE_IDENTITY", "Retained full delivery archive changed.")
    inspect_delivery(entry["path"])


def cold_reopen(receivers, workspace_id, phases, plan):
    actual = []
    plan_phases = [("original", plan["actor"], plan["steps"]),
                   ("first-edit", plan["first_edit"]["actor"], plan["first_edit"]["steps"]),
                   ("second-edit", plan["second_edit"]["actor"], plan["second_edit"]["steps"])]
    files = {member["key"]: member for member in plan["files"]}
    for index, entry in enumerate(receivers):
        with MigrationWorkspace(entry["workspace"]) as workspace:
            require(workspace.project["id"] == workspace_id, "CRF_RECEIVER_ID",
                    "The editable recipient no longer has the original workspace identity.")
            verification = crf_records.verify(workspace)
            aliases = {}
            # Receiver one has original+first-edit. Receiver two has all three.
            for phase_index, (phase, actor, steps) in enumerate(plan_phases[:index + 2]):
                selected = {}
                for step in steps:
                    op_id = "crf-" + identity({"plan": plan["operation_id"], "phase": phase, "step": step["key"]})[:50]
                    operation = workspace._operation(op_id)
                    payload = resolve(step["payload"], files, aliases)
                    payload["actor"] = actor
                    require(operation["operation"] == step["operation"] and operation["status"] == "SUCCEEDED"
                            and operation["request_sha256"] == identity({"operation": step["operation"], "payload": payload}),
                            "CRF_RECEIVER_OPERATION", "A received original command differs from the admitted plan.")
                    value = operation["result"]["result"]
                    retained = crf_records.get(workspace, value["kind"], value["id"])
                    require(retained == value, "CRF_RECEIVER_HISTORY", "Original received result differs from its record.")
                    aliases[step["key"]] = value; selected[step["key"]] = value
                require(record_pins(selected) == phases[phase_index]["records"],
                        "CRF_RECEIVER_HISTORY", "Original phase result identities changed or are missing.")
            actual.append(verification)
    return actual


def resume_complete(result, intent, output, plan):
    require(result["schema"] == RESULT_SCHEMA and result["intent"] == intent,
            "CRF_PROGRAMME_IDENTITY", "Completed programme belongs to a different original plan or workspace.")
    require(len(result["phases"]) == 3 and len(result["archives"]) == 3,
            "CRF_PROGRAMME_COMPLETE", "Retain all three original phases and all three complete archives.")
    for index, name in enumerate(("original", "first-edit", "second-edit")):
        phase_path = output / "phases" / (name + ".json")
        regular(phase_path)
        require(parse_json(phase_path.read_text("utf-8")) == result["phases"][index],
                "CRF_PHASE_CONTINUITY", "Complete result differs from the original retained phase.")
    receivers = [result["first_receiver"], result["second_receiver"], result["final_receiver"]]
    for index, (entry, receiver) in enumerate(zip(result["archives"], receivers)):
        destination = output / ("receiver-one", "receiver-two", "receiver-final")[index]
        require(receiver["destination"] == str(destination) and receiver["workspace"] == str(destination / "workspace")
                and Path(entry["path"]).parent == output, "CRF_RECEIVER_PATH", "Original receiving paths changed.")
        # Never reconstruct a missing completed recipient: it may hold later edits.
        regular(destination / "READY.json")
        verify_archive(entry)
        receive_delivery(entry["path"], destination)
    cold_reopen(receivers, result["workspace_id"], result["phases"], plan)
    return {**result, "reused": True, "later_edits_preserved": True}


def run_locked(plan, raw_plan, plan_identity, workspace_path, output, binding, *, create, resume):
    intent = {"schema": "commons.crf-receiving-intent/v1", "operation_id": plan["operation_id"],
              "plan": plan_identity, "workspace": str(workspace_path), "output": str(output), "execution": binding}
    publish_bytes(output / "intent.json", encoded(intent))
    publish_bytes(output / "original-plan.json", raw_plan)
    complete = output / "COMPLETE.json"
    if complete.exists():
        regular(complete)
        return resume_complete(parse_json(complete.read_text("utf-8")), intent, output, plan)
    source_root = Path(__file__).parent
    phase_root = ordinary_directory(output / "phases", create=True)
    records = {}
    exists = (workspace_path / "workspace.sqlite3").exists()
    require(exists or create, "CRF_PROGRAMME_WORKSPACE",
            "Select the existing original workspace or explicitly create it.")
    with MigrationWorkspace(workspace_path, create=not exists, title=plan["title"]) as original:
        workspace_id = original.project["id"]
        publish_bytes(output / "workspace-binding.json", encoded({"intent": intent, "workspace_id": workspace_id}))
        files = stage_files(original, plan, raw_plan)
        original_records = run_steps(original, plan, plan["steps"], files, records, "original", plan["actor"], resume=resume, source_root=source_root, binding=binding)
        verification = crf_records.verify(original)
        readiness = original_readiness(original, plan, original_records)
        first_phase = checked_phase(phase_root / "original.json",
            {"intent": intent, "phase": "original", "actor": plan["actor"]}, original_records, verification, readiness)
        first_archive = prepare_archive(original, source_root, output, plan, "original", plan["actor"], resume=resume, binding=binding)
        publish_bytes(phase_root / "first-archive.json", encoded(first_archive))
    first_received = receive_delivery(first_archive["path"], output / "receiver-one")
    with MigrationWorkspace(first_received["workspace"]) as receiver:
        require(receiver.project["id"] == workspace_id, "CRF_RECEIVER_ID", "First receiver changed original identity.")
        # Resume the original admitted edit before full verification: a prior
        # interruption may have committed its entity before its terminal result.
        first_records = run_steps(receiver, plan, plan["first_edit"]["steps"], files, records,
                                  "first-edit", plan["first_edit"]["actor"], resume=resume, source_root=source_root, binding=binding)
        second_phase = checked_phase(phase_root / "first-edit.json",
            {"intent": intent, "phase": "first-edit", "actor": plan["first_edit"]["actor"]},
            first_records, crf_records.verify(receiver))
        second_archive = prepare_archive(receiver, source_root, output, plan, "first-edit",
                                         plan["first_edit"]["actor"], resume=resume, binding=binding)
        publish_bytes(phase_root / "second-archive.json", encoded(second_archive))
    second_received = receive_delivery(second_archive["path"], output / "receiver-two")
    with MigrationWorkspace(second_received["workspace"]) as receiver:
        require(receiver.project["id"] == workspace_id, "CRF_RECEIVER_ID", "Second receiver changed original identity.")
        # Resume the original admitted edit before full verification: a prior
        # interruption may have committed its entity before its terminal result.
        second_records = run_steps(receiver, plan, plan["second_edit"]["steps"], files, records,
                                   "second-edit", plan["second_edit"]["actor"], resume=resume, source_root=source_root, binding=binding)
        third_phase = checked_phase(phase_root / "second-edit.json",
            {"intent": intent, "phase": "second-edit", "actor": plan["second_edit"]["actor"]},
            second_records, crf_records.verify(receiver))
        third_archive = prepare_archive(receiver, source_root, output, plan, "second-edit",
                                        plan["second_edit"]["actor"], resume=resume, binding=binding)
        publish_bytes(phase_root / "third-archive.json", encoded(third_archive))
    final_received = receive_delivery(third_archive["path"], output / "receiver-final")
    phases = [first_phase, second_phase, third_phase]
    cold_reopen([first_received, second_received, final_received], workspace_id, phases, plan)
    # Receiver return metadata can legitimately show reopened/edits_preserved on
    # a later continuation. Freeze the first complete return rather than rewrite it.
    receiving_path = phase_root / "receivers.json"
    receiving = {"first_receiver": first_received, "second_receiver": second_received, "final_receiver": final_received}
    if receiving_path.exists():
        regular(receiving_path)
        previous = parse_json(receiving_path.read_text("utf-8"))
        for name in receiving:
            require(previous[name]["workspace"] == receiving[name]["workspace"],
                    "CRF_RECEIVER_PATH", "Original receiving destination changed.")
        receiving = previous
    else:
        publish_bytes(receiving_path, encoded(receiving))
    result = {"schema": RESULT_SCHEMA, "status": "COMPLETED", "intent": intent,
              "workspace_id": workspace_id, "outcome": first_phase["readiness"]["outcome"],
              "workbook_return": first_phase["readiness"]["workbook_return"], "readiness": first_phase["readiness"],
              "records": record_pins(records), "phases": phases, **receiving,
              "archives": [first_archive, second_archive, third_archive],
              "cold_reopened": True, "both_recipient_edits_retained": True, "final_edition_independently_received": True,
              "provider_calls": 0, "tenant_writes": 0, "financial_postings": 0,
              "rendered_product": {"status": "NOT_VERIFIED", "browser_executed": False, "client_ready": False,
                "required": ["Actual populated, empty and error views at intended and mobile widths",
                             "Important controls, complete downloads and reload/reopen",
                             "Viewed outgoing screenshots or live rendered output"]},
              "meaning": "Completed original local plan, two recipient edits, and independent receiving of the final complete edited delivery. "
                         "This source/CLI receipt does not establish a browser-verified product or new customer acceptance."}
    publish_bytes(complete, encoded(result))
    return result


def run(plan_path, workspace_path, output, *, create=False, resume=False):
    raw_plan, plan_identity = read_plan(plan_path)
    plan = validate_plan(decode_plan(raw_plan))
    workspace_path = Path(workspace_path).expanduser().absolute()
    output = ordinary_directory(Path(output).expanduser().absolute(), create=True)
    require(workspace_path != output and workspace_path not in output.parents and output not in workspace_path.parents,
            "CRF_PROGRAMME_PATHS", "Keep the original workspace and receiving output in separate nonnested directories.")
    with programme_lock(output):
        binding = execution_binding(Path(__file__).parent)
        return run_locked(plan, raw_plan, plan_identity, workspace_path, output, binding, create=create, resume=resume)


def prepare_reference(directory):
    """Create one complete, explicitly authored CRF receiving course.

    This is software reference material, never customer records, an issued MI
    workbook, a payment return, a competition entry or an authority's approval.
    Only immutable input/plan files are published here. The normal run() performs
    the actual original operations and independent editable receiving later.
    """
    from copy import deepcopy
    domain = crf_records.domain
    destination = ordinary_directory(Path(directory).expanduser().absolute(), create=True)
    operation = "CRF-AUTHORED-REFERENCE-20261013-V1"
    original_actor = "Authored reference operator"
    first_actor = "Authored first receiving operator"
    second_actor = "Authored second receiving reviewer"
    period = domain.PERIODS["interim"]
    families = tuple(domain.FIELDS)
    require(set(families) == {"applications", "awards", "allocations",
                             "payment_controls", "repeat_counts", "contributions"},
            "CRF_REFERENCE_FAMILIES", "This complete authored course needs the reviewed six-family contract.")
    files, pending, file_map, predicted = [], {}, {}, {}
    original_steps, first_steps, second_steps = [], [], []

    def keep(key, value, *, filename=None, purpose=None, plain=False):
        identifier(key, "reference file key")
        require(key not in file_map, "CRF_REFERENCE_FILE", "Reference file keys must remain unique.")
        filename = basename(filename or ("REFERENCE-" + key + ".json"))
        raw = value.encode("utf-8") if plain else encoded(value)
        require(len(raw) <= crf_records.MAX_SOURCE_BYTES, "CRF_REFERENCE_SIZE",
                "The complete original reference file exceeds the source allowance.")
        member = {"key": key, "path": str(destination / filename), "filename": filename,
                  "bytes": len(raw), "sha256": identity_bytes(raw)}
        if purpose is not None: member["purpose"] = purpose
        files.append(member); file_map[key] = member; pending[key] = raw
        return member

    def evidence(key):
        member = file_map[key]
        return {field: member[field] for field in ("sha256", "filename", "purpose") if field in member}

    def review(actor, note, keys):
        return {"actor": actor, "role": "Authored reference course; no authority sign-off",
                "note": note, "evidence_files": [{"$file": key} for key in keys]}

    def add_step(phase, actor, steps, key, mutation, body):
        step = {"key": key, "operation": mutation, "payload": body}
        # Derive the real deterministic record ID through the retained backend.
        # A decisions file is immutable JSON: the runner does not resolve $step
        # within file bytes, so write its actual predicted edition ID below.
        resolved = resolve(body, file_map, predicted)
        semantic = {**resolved, "actor": actor}
        op_id = "crf-" + identity({"plan": operation, "phase": phase, "step": key})[:50]
        request_sha = identity({"operation": mutation, "payload": semantic})
        metadata = crf_records.base(
            {"id": op_id, "request_sha256": request_sha, "created_at": "REFERENCE-PREPARATION",
             "reserved_revision": 0, "actor": actor},
            mutation.removesuffix(".create"), body["title"])
        predicted[key] = {"id": metadata["id"], "kind": metadata["kind"],
                          "operation_id": op_id, "request_sha256": request_sha}
        steps.append(step)
        return resolved

    keep("course", """# Authored CRF reference course

All people, IDs, amounts, extracts, control rows, contributions and review notes
in this directory were authored for software onboarding. They are not Theseus,
Leicestershire, DWP or other customer data, independent banking evidence, a
competition submission or an official workbook. No credentials are supplied.
No eligibility, statutory acceptance, paid transaction or rendered-product
inspection is established by preparing or running this local course.

The reporting contract is deliberately explicit: an application/non-application
row is a reporting unit, one awarded unit links to one award, and split spend
belongs to allocations. Two other application rows are pending/accepted but not
awarded and remain outside the Table 9 reporting population. The two distinct
recipient history classifications are supplied authored decisions, not a rule
resolving the official guidance's previous-versus-current-award ambiguity.

Initial reference: six nonempty original families, 20 retained rows, three
awards, one refused unit, two excluded pending units. Recognised spend is GBP
200.00. The separately authored paid-control fixture deliberately says GBP
99.00 for award REF-AWARD-1, whose allocations total GBP 100.00. Exactly one
PAYMENT_CONTROL_DIFFERENCE must result. One application-to-payment interval is
exactly 48 calendar hours; another is 49 hours. The non-application/in-kind award
is outside that timing population. The same recipient appears in two awards but
contributes once to the period-end repeat classification.

Original operator: preserve every original file; replace only the paid-control
dataset with its explicit descendant (GBP 100.00); create a complete corrected
edition retaining all other families; compare every original row and metric;
record one corrected decision for every initial finding and an explicit full
empty decision array for the corrected edition.

First independent receiver: create descendants of the allocation and corrected
control datasets, changing REF-AWARD-2 consistently from GBP 75.25 to GBP 80.25.
Create the later complete edition, compare all six families and retain its full
review. Spend becomes GBP 205.00; original rows, prior findings and old decisions
remain retained. This is an actual data edit, not merely reopening the archive.

Second independent receiver: revise the original finding review through its
existing parent, binding the correction to that later complete descendant and
its authored evidence; independently revise the later edition's complete review.
Both edits remain in the final complete archive and cold-reopened workspace.
The original correction is never overwritten.

workbook_required is false: no issued workbook has been acquired. No workbook
file, binding, recalculation, sign-off, email or DWP submission is fabricated.
The exact plan and every original file are byte-pinned; existing differing
files are never replaced. Preparation repeats are create-only and deterministic.

Owner rendered-product instruction:
Before calling any customer/prospect-facing application, website, dashboard,
demo, report, presentation or export ready, open/run/render the exact outgoing
version, look at the rendered screen or its actual screenshots, and operate the
important user controls. Inspect the actual screenshare width and narrow/mobile
width where relevant, populated/empty/loading/error states, downloads/exports
and reopening. Capturing screenshots without viewing them is insufficient.
Code review, DOM counts, HTTP 200, unit checks and another worker's approval do
not replace seeing the actual product. This includes all attachments: open the
usable contents of ZIPs/projects and every applicable report/PDF page.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within
the authorised work before presenting it. Use plain industrial software design:
readable tables, clear hierarchy, consistent typography and spacing, restrained
controls, useful labels and responsive layouts. Preserve real workflows, source
data and computations. Inspection must lead directly to repairs and must not
replace implementation/integration or become repeated checking. Keep validation
focused on the actual remaining risk; do not run broad suites or build a
verification product.

Include this complete instruction in delegated assignments and the active
owner-controlled policy, boot, build and receiving guidance those workers
actually read. Preserve all other owner controls and original operation
identities. Leave historical records and third-party/vendor policies intact.
Do not force restarts, create watchers or revive owner-stopped work. When a
runtime is unavailable, join the existing equipped receiver with the complete
exact version and opening steps, review its actual rendered result, and continue
independent implementation while it runs.

If video/audio is produced, use available high-quality generative voice/TTS and
useful generative media with natural professional delivery, preserving existing
spending/voice/attribution controls. Actually watch/listen to the final export,
including pacing, pronunciation, timing and audio alignment.
""", filename="REFERENCE-README.md", purpose="Authored reference provenance and complete operator course", plain=True)

    keep("correction-evidence", {
        "schema": "commons.crf-authored-reference-evidence/v1", "reference_only": True,
        "authoring_note": "Deliberate control correction in an authored fixture, not an observed payment.",
        "award_id": "REF-AWARD-1", "original_control": "99.00", "corrected_control": "100.00",
        "allocation_total": "100.00", "reason": "Exercise full finding-to-corrected-descendant binding."
    }, purpose="Authored original control correction")
    keep("first-edit-evidence", {
        "schema": "commons.crf-authored-reference-evidence/v1", "reference_only": True,
        "actor": first_actor, "award_id": "REF-AWARD-2", "before": "75.25", "after": "80.25",
        "reason": "Authorised reference exercise: revise allocation and its separate control together; preserve both original editions.",
        "expected_spend": "205.00", "not_customer_or_payment_evidence": True
    }, purpose="Authored first recipient data-edit rationale")
    keep("second-edit-evidence", {
        "schema": "commons.crf-authored-reference-evidence/v1", "reference_only": True,
        "actor": second_actor,
        "reason": "Independent reference review follows the complete original finding and the latest descendant sources; no original review is overwritten.",
        "review_scope": ["all original findings", "all six retained families", "later correction evidence", "complete later edition"],
        "not_signoff_or_rendered_inspection": True
    }, purpose="Authored second recipient review rationale")

    contract = {
        "scope_id": "AUTHORED-CRF-REFERENCE-2026",
        "authority_name": "Authored Reference County — not a public authority",
        "authority_type": "county", "financial_year": 2026,
        "recognition_basis": "Authored demonstration only: listed nonnegative GBP allocations are the selected spend; compare every award to its separately authored paid control. This does not prescribe real voucher recognition.",
        "repeat_count_basis": "Use each authored period-end previous_awards value directly over the full declared twelve months. No inference, subtraction or resolution of the issued-workbook counting ambiguity is made.",
        "review": review(original_actor, "Admit only this explicitly authored software reference population.", ["course"])
    }
    resolved_contract = add_step("original", original_actor, original_steps, "contract",
                                "crf.contract.create", {"title": "REFERENCE reporting contract", "contract": contract})
    domain.validate_contract(resolved_contract["contract"])
    contract_id = predicted["contract"]["id"]

    applications = [
        {"id": "REF-APP-" + str(n), "status": state, "reporting_on": "2026-09-03",
         "application_based": n != 3}
        for n, state in enumerate(("awarded", "awarded", "awarded", "refused", "pending", "accepted_unawarded"), 1)
    ]
    awards = []
    for n, recipient, application, route, method, crisis, need in (
        (1, "REF-RECIPIENT-A", True, "online", "cash", "income_loss", "food"),
        (2, "REF-RECIPIENT-B", True, "phone", "voucher", "essential_item_breakdown", "utilities"),
        (3, "REF-RECIPIENT-A", False, "other", "in_kind", "other", "transport"),
    ):
        awards.append({
            "id": "REF-AWARD-" + str(n), "application_id": "REF-APP-" + str(n),
            "recipient_id": recipient, "reporting_on": "2026-09-03",
            "application_based": application, "route": route, "support_method": method,
            "presenting_crisis": crisis, "crisis_need": need,
            "submitted_at": "2026-09-01T08:00:00Z" if application else None,
            "paid_at": ("2026-09-03T08:00:00Z" if n == 1 else "2026-09-03T09:00:00Z") if application else None,
            "children": n == 2, "pensioners": False, "disabled": n != 2,
            "other_individuals": False, "employed": n != 2, "benefits": n == 2,
        })
    allocations = []
    for n, award_number, amount in ((1, 1, "60.00"), (2, 1, "40.00"), (3, 2, "75.25"), (4, 3, "24.75")):
        award = awards[award_number - 1]
        allocations.append({"id": "REF-ALLOCATION-" + str(n), "award_id": award["id"],
            "reporting_on": "2026-09-03", "amount": amount,
            **{field: award[field] for field in ("presenting_crisis", "support_method", "crisis_need")}})
    controls = [
        {"id": "REF-CONTROL-" + str(n), "award_id": "REF-AWARD-" + str(n),
         "reporting_on": "2026-09-03", "amount": amount, "payment_status": "paid",
         "paid_at": stamp}
        for n, amount, stamp in ((1, "99.00", "2026-09-03T08:00:00Z"),
                                 (2, "75.25", "2026-09-03T09:00:00Z"),
                                 (3, "24.75", "2026-09-03T10:00:00Z"))
    ]
    repeats = [
        {"recipient_id": recipient, "as_of": "2026-09-30", "previous_awards": count,
         "history_start": "2025-10-01", "history_end": "2026-09-30",
         "basis_reference": "REFERENCE-README.md: explicit authored classification; not issued guidance interpretation"}
        for recipient, count in (("REF-RECIPIENT-A", "2"), ("REF-RECIPIENT-B", "0"))
    ]
    contributions = [
        {"id": "REF-CONTRIBUTION-1", "metric": "external.reference.admin_spend", "value": "12.50",
         "type": "money", "period_start": "2026-04-01", "period_end": "2026-09-30",
         "authority_reference": "Authored training contribution, not an authority return"},
        {"id": "REF-CONTRIBUTION-2", "metric": "external.reference.provenance", "value": "AUTHORED REFERENCE ONLY",
         "type": "text", "period_start": "2026-04-01", "period_end": "2026-09-30",
         "authority_reference": "REFERENCE-README.md"}
    ]
    source_rows = dict(zip(("applications", "awards", "allocations", "payment_controls", "repeat_counts", "contributions"),
                          (applications, awards, allocations, controls, repeats, contributions)))

    def dataset(phase, actor, steps, key, family, rows_value, capture, parent=None, evidence_keys=("course",)):
        keep(key, rows_value)
        # Parse the exact complete bytes through the maintained original parser.
        columns, originals = domain.original_rows(pending[key], "json-table", {"encoding": "utf-8"})
        mapping = {field: field for field in domain.FIELDS[family]}
        domain.validate_mapping(mapping, columns, family)
        normalized = domain.normalize(originals, mapping, family)
        require(len(normalized) == len(rows_value) and not any(row["issues"] for row in normalized),
                "CRF_REFERENCE_ROWS", "Every authored original row must retain its identity and valid complete mapping.", family=family)
        context = {
            "coverage": "complete", "period_start": "2025-10-01" if family == "repeat_counts" else period["start"],
            "period_end": period["end"], "captured_at": capture,
            "source_system": "Authored CRF reference fixtures — not a vendor system",
            "extraction_reference": "Authored complete original file " + file_map[key]["filename"],
            "review": review(actor, "Complete selected reference population; source capture dates are authored scenario dates.", evidence_keys)
        }
        body = {"title": "REFERENCE " + key, "contract_id": {"$step": "contract"}, "family": family,
                "file_sha256": {"$sha": key}, "filename": file_map[key]["filename"], "format": "json-table",
                "dialect": {"encoding": "utf-8"}, "mapping": mapping, "context": context}
        if parent is not None: body["parent_id"] = {"$step": parent}
        resolved = add_step(phase, actor, steps, key, "crf.dataset.create", body)
        domain.validate_context(resolved["context"])
        return {"dataset": {"id": predicted[key]["id"], "contract_id": contract_id, "family": family,
                            "context": resolved["context"], "parent_id": predicted[parent]["id"] if parent else None},
                "rows": normalized}

    initial = {}
    for family in families:
        key = "initial-" + family.replace("_", "-")
        initial[family] = dataset("original", original_actor, original_steps, key, family,
                                  source_rows[family], "2026-10-01T12:00:00Z")
    initial_keys = {family: "initial-" + family.replace("_", "-") for family in families}

    def edition(phase, actor, steps, key, selected_keys, parent, note):
        body = {"title": "REFERENCE " + key, "contract_id": {"$step": "contract"}, "period": "interim",
                "dataset_ids": [{"$step": selected_keys[family]} for family in families], "note": note}
        if parent: body["parent_id"] = {"$step": parent}
        add_step(phase, actor, steps, key, "crf.edition.create", body)

    edition("original", original_actor, original_steps, "initial-edition", initial_keys, None,
            "Authored complete original reporting edition with one deliberate payment-control mismatch.")
    first_report = domain.calculate(resolved_contract["contract"], "interim", initial)
    require(len(first_report["checks"]) == 1 and first_report["checks"][0]["code"] == "PAYMENT_CONTROL_DIFFERENCE"
            and first_report["checks"][0]["status"] == "FAIL"
            and domain.decimal_value(first_report["checks"][0]["details"]["allocation"]) == domain.decimal_value("100.00")
            and domain.decimal_value(first_report["checks"][0]["details"]["paid_control"]) == domain.decimal_value("99.00"),
            "CRF_REFERENCE_FAULT", "The reference must contain exactly the intended original allocation/control difference.")
    expected_counts = {"t9.received": 4, "t9.awarded": 3, "t9.refused": 1,
                       "t10.online": 1, "t10.phone": 1, "t10.other": 1,
                       "t12.within_48h": 1, "t12.over_48h": 1,
                       "t13.none": 1, "t13.one": 0, "t13.two_or_more": 1}

    def check_report(report, spend, *, corrected):
        metrics = {row["id"]: row for row in report["metrics"]}
        require(report["selected_source_rows"] == 20 and
                all(metrics[key]["value"] == number for key, number in expected_counts.items()) and
                metrics["t8.spend"]["value"] == spend and
                metrics["t11.non_application"]["value"] == "24.75" and
                metrics["external.reference.admin_spend"]["value"] == "12.50",
                "CRF_REFERENCE_TOTALS", "The complete authored reporting populations or expected amounts changed.")
        require((not report["checks"]) == corrected and
                all(row["status"] == ("COMPLETE" if corrected else "PROVISIONAL") for row in report["metrics"]),
                "CRF_REFERENCE_STATUS", "A reference edition must preserve its actual findings and metric status.")
        return {key: metrics[key]["value"] for key in ("t8.spend", *expected_counts)}
    check_report(first_report, "200.00", corrected=False)

    corrected_controls = deepcopy(controls); corrected_controls[0]["amount"] = "100.00"
    corrected = dict(initial)
    corrected["payment_controls"] = dataset("original", original_actor, original_steps,
        "corrected-payment-controls", "payment_controls", corrected_controls, "2026-10-02T12:00:00Z",
        parent=initial_keys["payment_controls"], evidence_keys=("course", "correction-evidence"))
    corrected_keys = {**initial_keys, "payment_controls": "corrected-payment-controls"}
    edition("original", original_actor, original_steps, "corrected-edition", corrected_keys, "initial-edition",
            "Authored paid-control correction; retain all six complete original families or their explicit descendants.")
    corrected_report = domain.calculate(resolved_contract["contract"], "interim", corrected)
    corrected_metrics = check_report(corrected_report, "200.00", corrected=True)
    comparison = domain.compare(first_report, corrected_report, initial, corrected)
    require(comparison["counts"] == {"UNCHANGED": 19, "CHANGED": 1} and len(comparison["changes"]) == 20
            and len(comparison["metrics"]) == len(first_report["metrics"]),
            "CRF_REFERENCE_COMPARISON", "The complete initial correction must change one source row and retain every comparison.")
    add_step("original", original_actor, original_steps, "original-comparison", "crf.comparison.create",
        {"title": "REFERENCE complete original-to-corrected comparison",
         "earlier_id": {"$step": "initial-edition"}, "later_id": {"$step": "corrected-edition"},
         "note": "Compare every retained original occurrence and every metric; no echo target or workbook acceptance."})

    def finding_review(phase, actor, steps, key, edition_key, findings, *, corrected_key=None, parent=None, evidence_keys=("course",), note):
        decisions = []
        for check in findings:
            require(corrected_key is not None, "CRF_REFERENCE_DECISION", "Every intended fault needs its real corrected descendant.")
            decisions.append({"check_id": check["id"], "status": "corrected", "note": note,
                              "evidence_files": [evidence(name) for name in evidence_keys],
                              "correction_edition_id": predicted[corrected_key]["id"]})
        keep(key + "-decisions", decisions)
        body = {"title": "REFERENCE " + key, "edition_id": {"$step": edition_key},
                "decisions_file": {"$file": key + "-decisions"}, "review": review(actor, note, evidence_keys)}
        if parent: body["parent_id"] = {"$step": parent}
        add_step(phase, actor, steps, key, "crf.review.create", body)
        require({row["check_id"] for row in decisions} == {row["id"] for row in findings},
                "CRF_REFERENCE_DECISION", "The full original finding population must have one retained decision.")
        return decisions

    original_decisions = finding_review("original", original_actor, original_steps, "original-finding-review",
        "initial-edition", first_report["checks"], corrected_key="corrected-edition",
        evidence_keys=("course", "correction-evidence", "corrected-payment-controls"),
        note="Authored reference: the complete corrected descendant replaces only the deliberate control mismatch; retain this original finding.")
    finding_review("original", original_actor, original_steps, "corrected-full-review",
        "corrected-edition", corrected_report["checks"], evidence_keys=("course", "correction-evidence"),
        note="Authored reference: full corrected edition reviewed, including the explicit empty finding population; no statutory sign-off.")

    received_allocations = deepcopy(allocations); received_allocations[2]["amount"] = "80.25"
    received_controls = deepcopy(corrected_controls); received_controls[1]["amount"] = "80.25"
    received = dict(corrected)
    received["allocations"] = dataset("first-edit", first_actor, first_steps,
        "recipient-allocations", "allocations", received_allocations, "2026-10-03T12:00:00Z",
        parent=initial_keys["allocations"], evidence_keys=("course", "first-edit-evidence"))
    received["payment_controls"] = dataset("first-edit", first_actor, first_steps,
        "recipient-payment-controls", "payment_controls", received_controls, "2026-10-03T12:00:00Z",
        parent="corrected-payment-controls", evidence_keys=("course", "first-edit-evidence"))
    received_keys = {**corrected_keys, "allocations": "recipient-allocations",
                     "payment_controls": "recipient-payment-controls"}
    edition("first-edit", first_actor, first_steps, "recipient-edition", received_keys, "corrected-edition",
            "Authored independent recipient changes allocation and separate control together; complete scope and earlier editions retained.")
    received_report = domain.calculate(resolved_contract["contract"], "interim", received)
    received_metrics = check_report(received_report, "205.00", corrected=True)
    received_comparison = domain.compare(corrected_report, received_report, corrected, received)
    require(received_comparison["counts"] == {"UNCHANGED": 18, "CHANGED": 2}
            and len(received_comparison["changes"]) == 20,
            "CRF_REFERENCE_RECIPIENT", "The first receiver must make the two intended original-row edits.")
    add_step("first-edit", first_actor, first_steps, "recipient-comparison", "crf.comparison.create",
        {"title": "REFERENCE complete recipient change comparison",
         "earlier_id": {"$step": "corrected-edition"}, "later_id": {"$step": "recipient-edition"},
         "note": "Two source-row changes; full six-family and metric populations remain visible."})
    finding_review("first-edit", first_actor, first_steps, "recipient-full-review",
        "recipient-edition", received_report["checks"],
        evidence_keys=("course", "first-edit-evidence", "recipient-allocations", "recipient-payment-controls"),
        note="Authored first recipient reviews the full later edition and GBP 205.00 source/control agreement; no workbook or payment claim.")
    second_decisions = finding_review("second-edit", second_actor, second_steps, "second-finding-review",
        "initial-edition", first_report["checks"], corrected_key="recipient-edition", parent="original-finding-review",
        evidence_keys=("course", "correction-evidence", "first-edit-evidence", "second-edit-evidence",
                       "recipient-allocations", "recipient-payment-controls"),
        note="Authored second recipient traces the original mismatch through the complete latest corrected descendant and preserves the earlier decision.")
    finding_review("second-edit", second_actor, second_steps, "second-full-review",
        "recipient-edition", received_report["checks"], parent="recipient-full-review",
        evidence_keys=("course", "first-edit-evidence", "second-edit-evidence"),
        note="Authored second recipient's independent full-review revision; all 20 source rows, six families and zero remaining findings remain explicit.")
    require(original_decisions != second_decisions and
            not {row["id"] for row in first_report["checks"]} &
                {row["id"] for row in received_report["checks"]},
            "CRF_REFERENCE_REVIEW_EDIT", "The second recipient must retain a real changed review and resolved original finding.")

    expected = {"reference_only": True, "family_rows": {family: len(item["rows"]) for family, item in initial.items()},
                "initial_findings": first_report["checks"], "corrected_metrics": corrected_metrics,
                "recipient_metrics": received_metrics, "original_comparison": comparison["counts"],
                "recipient_comparison": received_comparison["counts"],
                "all_original_findings_reviewed": len(original_decisions),
                "second_review_is_descendant": True, "issued_workbook": None,
                "meaning": "Preparation-time domain assertions only; the normal runner still must execute and independently receive all three complete archives."}
    keep("expected", expected, purpose="Authored domain calculation and complete-course expectations")
    plan = {"schema": SCHEMA, "operation_id": operation,
            "title": "Authored CRF reference — complete reporting, correction and two editable receivers",
            "actor": original_actor, "workbook_required": False, "files": files, "steps": original_steps,
            "first_edit": {"actor": first_actor, "steps": first_steps},
            "second_edit": {"actor": second_actor, "steps": second_steps}}
    validate_plan(plan)
    raw_plan = encoded(plan)
    require(len(raw_plan) <= MAX_PLAN_BYTES and
            sum(member["bytes"] for member in files) <= MAX_PLAN_BYTES,
            "CRF_REFERENCE_SIZE", "The complete reference source and plan must stay within the stated 64 MiB bounds.")
    # All domain calculations, expected populations and plan references are
    # checked before any source/plan member is published. Failed complete writes
    # retain the original helper's prefixes and create-only continuation.
    for member in files:
        publish_bytes(destination / member["filename"], pending[member["key"]])
    plan_path = destination / "REFERENCE-plan.json"
    publish_bytes(plan_path, raw_plan)
    manifest = {"schema": "commons.crf-authored-reference/v1", "reference_only": True,
                "operation_id": operation, "plan": {"path": str(plan_path), "bytes": len(raw_plan),
                                                   "sha256": identity_bytes(raw_plan)},
                "files": files, "predicted_records": predicted, "expected": expected,
                "prepared_against": {
                    "domain_git_blob": "faa594a59fa7324b4e2b3d7846b46c3157fd967a",
                    "workspace_git_blob": "5102756ef1966a182ac06aa2b2f4b179433bd3c2",
                    "receiving_base_git_blob": "690c2619cb010405a36eb8f7b302829a31d28261"},
                "executing_source": [
                    {"path": Path(module.__file__).name, **file_hash(Path(module.__file__))}
                    for module in (domain, crf_records)],
                "provider_calls": 0, "tenant_writes": 0, "workbook_required": False,
                "rendered_product": {"status": "NOT_VERIFIED", "client_ready": False}}
    manifest_path = destination / "REFERENCE-MANIFEST.json"
    publish_bytes(manifest_path, encoded(manifest))
    return {"schema": manifest["schema"], "reference_only": True, "plan": str(plan_path),
            "plan_sha256": manifest["plan"]["sha256"], "plan_bytes": len(raw_plan),
            "manifest": str(manifest_path), "files": len(files),
            "phase_steps": [len(original_steps), len(first_steps), len(second_steps)],
            "expected": expected, "workbook_required": False, "client_ready": False}



# The browser course is embedded so the complete application roster stays fixed.
# It executes only the supplied complete authored plan's existing recipient edits.
CRF_BROWSER_JS = "// Complete local CRF operator course. Embedded by crf_receiving.py.\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport crypto from 'node:crypto';\nimport {spawn} from 'node:child_process';\nimport {pathToFileURL} from 'node:url';\nconst config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));\nconst root=config.output, phases=path.join(root,'browser-phases');\nfs.mkdirSync(phases,{recursive:true,mode:0o700});\nconst fail=(message)=>{throw Error(message);};\nconst canon=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(sorted):sorted(x):x);\nfunction sorted(x){if(Array.isArray(x))return x.map(sorted);if(x&&typeof x==='object'){const o={};for(const k of Object.keys(x).sort())o[k]=sorted(x[k]);return o;}return x;}\nconst same=(a,b)=>canon(a)===canon(b);\nfunction hashFile(filename){const fd=fs.openSync(filename,'r'),h=crypto.createHash('sha256'),buf=Buffer.allocUnsafe(262144);let bytes=0;try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))){h.update(buf.subarray(0,n));bytes+=n;}}finally{fs.closeSync(fd);}return{bytes,sha256:h.digest('hex')};}\nfunction read(p){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;}\nfunction save(p,value,replace=false){const b=Buffer.from(JSON.stringify(value,null,2)+'\\n');if(fs.existsSync(p)&&!replace){if(!fs.readFileSync(p).equals(b))fail('Retained browser bytes differ: '+p);return;}\nconst tmp=p+'.pending-'+process.pid;if(fs.existsSync(tmp))fs.unlinkSync(tmp);const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}\nif(replace)fs.renameSync(tmp,p);else{try{fs.linkSync(tmp,p);}catch(e){if(e.code!=='EEXIST')throw e;if(!fs.readFileSync(p).equals(b))throw e;}finally{fs.unlinkSync(tmp);}}\nconst d=fs.openSync(path.dirname(p),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}\nlet context=null,page=null,active=null,routeFailure=null,stopping=false,base=null;\nconst servers=[],screenshots=[],downloads=[];\nconst playwright=await import(pathToFileURL(config.playwright).href);\nconst chromium=playwright.chromium||playwright.default?.chromium;if(!chromium)fail('The selected original module does not export Chromium.');\nasync function stop(){if(stopping)return;stopping=true;if(context)await context.close().catch(()=>{});for(const s of servers)s.child.stdin.end();await Promise.all(servers.map(s=>s.closed));}\nprocess.stdin.on('end',()=>{stop().finally(()=>process.exit(3));});process.stdin.resume();\nprocess.on('SIGTERM',()=>{stop().finally(()=>process.exit(143));});\nasync function serve(workspace){\n const child=spawn(config.python,[config.receiving,'browser-serve','--workspace',workspace],{stdio:['pipe','pipe','pipe',Number(process.env.CRF_BROWSER_LOCK_FD)]});\n const index=servers.length,log=fs.createWriteStream(path.join(root,'server-'+index+'.stderr.log'),{flags:'a',mode:0o600});\n child.stderr.pipe(log);let buffer='',readyResolve,readyReject;\n const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});\n const closed=new Promise(resolve=>child.once('close',(code,signal)=>{log.end();readyReject(Error('Server closed before readiness: '+code+'/'+signal));resolve({code,signal});}));\n const s={child,closed};servers.push(s);child.on('error',readyReject);\n child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);fs.appendFileSync(path.join(root,'server-'+index+'.stdout.log'),line+'\\n',{mode:0o600});try{const v=JSON.parse(line);if(v.event==='crf_browser_server_ready')readyResolve(v);}catch{}}});\n const timer=setTimeout(()=>readyReject(Error('Original server did not acknowledge readiness; retain its same child.')),30000);\n try{const v=await ready;if(v.workspace_id!==config.workspaceId&&workspace===config.workspace)fail('Browser server changed original workspace.');return v;}finally{clearTimeout(timer);}\n}\nasync function api(operation,payload={}){const r=await page.request.post(base+'/api/read',{data:{operation,payload}});const v=await r.json();if(!r.ok()||v.error)fail('Read failed: '+JSON.stringify(v));return v;}\nasync function idle(){await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'),{},{timeout:120000});if(routeFailure)throw routeFailure;}\nasync function tab(name){await idle();await page.locator('nav [data-tab=\"'+name+'\"]').click();await idle();}\nconst field=(form,name)=>page.locator('#'+form+' [name=\"'+name+'\"]');\nasync function fill(form,name,value){const el=field(form,name),tag=await el.evaluate(e=>e.tagName);if(tag==='SELECT')await el.selectOption(Array.isArray(value)?value:String(value??''));else await el.fill(String(value??''));}\nasync function snapshot(name){await idle();const filename=name+'.png',file=path.join(root,filename);await page.screenshot({path:file,fullPage:true});screenshots.push({path:file,...hashFile(file)});const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));if(overflow.scrollWidth>overflow.width+2)fail('Visible page overflow at '+name+': '+JSON.stringify(overflow));}\nasync function session(){return page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage)));}\nasync function rememberSession(){save(path.join(root,'session.json'),await session(),true);}\nasync function openPage(url,restore=true){\n page=await context.newPage();page.on('pageerror',e=>{routeFailure=e;});\n const saved=restore?read(path.join(root,'session.json')):null;\n if(saved)await page.addInitScript(v=>{if(!sessionStorage.getItem('__crf_course_restored')){for(const[k,x]of Object.entries(v))sessionStorage.setItem(k,x);sessionStorage.setItem('__crf_course_restored','1');}},saved);\n await page.route('**/api/operations',async route=>{\n  try{\n   const request=JSON.parse(route.request().postData()||'null');\n   if(!active)fail('No admitted browser phase owns this mutation.');\n   const isResume=request.operation==='operation.resume';\n   if(isResume){const original=read(path.join(active.dir,'request.json'));if(!original||request.payload.target_operation_id!==original.request.payload.operation_id)fail('Continuation changed its original target.');}\n   else{\n    if(request.operation!==active.operation)fail('UI dispatched an unexpected operation.');\n    if(active.check)await active.check(request.payload);\n   }\n   const record={request,session:await session()},file=isResume?'control-'+request.payload.operation_id+'.json':'request.json';\n   const old=read(path.join(active.dir,file));\n   if(old){if(!same(old.request,request))fail('Original UI request identity changed.');}\n   else save(path.join(active.dir,file),record);\n   save(path.join(root,'session.json'),record.session,true);\n   if(!isResume){const loading=path.join(root,'loading-'+path.basename(active.dir)+'.png');await page.screenshot({path:loading,fullPage:true});screenshots.push({path:loading,...hashFile(loading)});}\n   const attempt=fs.readdirSync(active.dir).filter(x=>x.startsWith('dispatch-')).length;\n   const dispatch=path.join(active.dir,'dispatch-'+String(attempt).padStart(4,'0')+'.json');\n   save(dispatch,{request});\n   const response=await route.fetch({timeout:120000}),body=await response.body();\n   save(dispatch+'.return',{status:response.status(),headers:response.headers(),body:body.toString('utf8')});\n   await route.fulfill({response,body});\n  }catch(error){routeFailure=error;await route.abort().catch(()=>{});}\n });\n await page.goto(url,{waitUntil:'domcontentloaded'});await idle();\n}\nasync function resolvedOperation(request){const v=await api('operation.get',{id:request.payload.operation_id});if(!v.found)return null;const op=v.operation;\n if(op.operation!==request.operation||!same(op.request,request.payload))fail('Original operation request changed.');\n if(op.status!=='SUCCEEDED')return {pending:op};\n return {operation_id:op.id,result:op.result.result,request};}\nasync function action(key,operation,check,prepare,submit){\n const dir=path.join(phases,key);fs.mkdirSync(dir,{recursive:true,mode:0o700});active={dir,operation,check};\n try{\n  const completed=read(path.join(dir,'COMPLETE.json')),retained=read(path.join(dir,'request.json'));\n  if(retained&&check)await check(retained.request.payload);\n  if(completed){if(!retained)fail('Completed UI phase lost its original request.');const current=await resolvedOperation(retained.request);if(!current||current.pending||!same(current,completed))fail('Completed UI phase no longer matches its original return.');return current.result;}\n  if(retained){\n   let found=await resolvedOperation(retained.request);\n   if(found&&!found.pending){save(path.join(dir,'COMPLETE.json'),found);return found.result;}\n   await page.evaluate(snapshot=>{for(const[k,v]of Object.entries(snapshot))sessionStorage.setItem(k,v);},retained.session);\n   await page.reload({waitUntil:'domcontentloaded'});await idle();\n   found=await resolvedOperation(retained.request);if(found&&!found.pending){save(path.join(dir,'COMPLETE.json'),found);return found.result;}\n   await page.locator('#inspect-pending').click();await idle();\n   if(!found){if(!await page.locator('#retry-pending').isVisible())fail('Original unadmitted request cannot be retried through its UI.');await page.locator('#retry-pending').click();}\n   else{if(found.pending.status!=='INTERRUPTED'||!await page.locator('#resume-pending').isVisible())fail('Original mutation remains unresolved; no repeat dispatched.');await page.locator('#resume-pending').click();}\n   await idle();\n  }else{\n   if(await page.locator('#pending').isVisible())fail('Reconcile the earlier visible original request before this phase.');\n   await prepare();await idle();await submit();await idle();\n  }\n  const admitted=read(path.join(dir,'request.json'));if(!admitted)fail('UI did not admit this original request: '+await page.locator('#notice').innerText());\n  const result=await resolvedOperation(admitted.request);if(!result||result.pending)fail('Original UI request has no successful terminal result. Keep the same phase and session.');\n  save(path.join(dir,'COMPLETE.json'),result);await rememberSession();return result.result;\n }finally{active=null;}\n}\nasync function upload(original,purpose){\n await tab('sources');await page.locator('#upload-file').setInputFiles({name:original.filename,mimeType:'application/octet-stream',buffer:fs.readFileSync(original.path)});\n await page.locator('#file-purpose').selectOption(purpose);await page.locator('#upload-form button').click();await idle();\n const exists=await page.locator('#files .file-row').evaluateAll((rows,x)=>rows.some(row=>row.querySelector('code')?.textContent===x.sha&&row.querySelector('label')?.textContent==='Select '+x.purpose+' evidence'),{sha:original.sha256,purpose});\n if(!exists)fail('Complete original upload is absent from the actual UI.');\n}\nasync function selectEvidence(refs){\n await tab('sources');\n const rows=page.locator('#files .file-row'),n=await rows.count(),wanted=new Set(refs.map(r=>r.sha256+'\\n'+r.filename)),matched=new Set();\n for(let i=0;i<n;i++){const row=rows.nth(i),label=await row.locator('label').innerText(),sha=await row.locator('code').innerText(),href=await row.locator('a').getAttribute('href'),filename=new URL(href,base).searchParams.get('filename'),key=sha+'\\n'+filename;\n const yes=label==='Select evidence evidence'&&wanted.has(key);await row.locator('input[type=checkbox]').setChecked(yes);if(yes)matched.add(key);}\n if(matched.size!==wanted.size)fail('The complete selected evidence is not retained in the UI.');\n}\nconst uiEvidence=refs=>refs.map(x=>({sha256:x.sha256,filename:x.filename,purpose:'evidence'}));\nconst aliases={...config.originalRecords},nativeToActual={};\nfor(const [key,id]of Object.entries(config.originalStepIds))if(aliases[key])nativeToActual[id]=aliases[key].id;\nfunction resolve(value){if(Array.isArray(value))return value.map(resolve);if(value&&typeof value==='object'){\n if(Object.keys(value).length===1){if(value.$step||value.$record){const v=aliases[value.$step||value.$record];if(!v)fail('Missing retained prior record.');return v.id;}if(value.$sha)return config.files[value.$sha].sha256;if(value.$file){const f=config.files[value.$file];return Object.fromEntries(['sha256','filename','purpose'].filter(k=>k in f).map(k=>[k,f[k]]));}}\n return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));}return value;}\nasync function commonReview(form,review){await selectEvidence(review.evidence_files||[]);await tab(form==='dataset-form'?'sources':'review');await fill(form,'role',review.role);await fill(form,'note',review.note);}\nfunction semantic(payload){const x={...payload};delete x.operation_id;delete x.expected_revision;return x;}\nasync function performStep(step,actor){\n const expected=resolve(step.payload);let planned={...expected,actor},preparedDecisions=null;\n const form={ 'crf.dataset.create':'dataset-form','crf.edition.create':'edition-form','crf.comparison.create':'comparison-form','crf.review.create':'review-form'}[step.operation];\n if(!form)fail('This browser course does not guess controls for an unselected recipient operation: '+step.operation);\n if(step.operation==='crf.dataset.create'){planned={...planned,dialect:{encoding:expected.dialect?.encoding||'utf-8-sig',delimiter:expected.dialect?.delimiter||','},context:{...expected.context,review:{...expected.context.review,evidence_files:uiEvidence(expected.context.review.evidence_files||[])}}};}\n if(step.operation==='crf.review.create'){\n  const member=Object.values(config.files).find(f=>f.sha256===expected.decisions_file.sha256);if(!member)fail('Original complete decision file is absent.');\n  preparedDecisions=JSON.parse(fs.readFileSync(member.path,'utf8')).map(d=>({...d,evidence_files:uiEvidence(d.evidence_files||[]),...(d.correction_edition_id?{correction_edition_id:nativeToActual[d.correction_edition_id]||d.correction_edition_id}:{})}));\n  planned={...planned,review:{...expected.review,evidence_files:uiEvidence(expected.review.evidence_files||[])}};\n }\n const check=async actual=>{\n  if(step.operation==='crf.review.create'){\n   const r=await page.request.get(base+'/api/files/'+actual.decisions_file.sha256),raw=await r.body();\n   const actualDecisions=JSON.parse(raw.toString('utf8'));\n   const ordered=x=>x.map(d=>({...d,evidence_files:[...d.evidence_files].sort((a,b)=>canon(a).localeCompare(canon(b)))}));\n   if(!r.ok()||!same(ordered(actualDecisions),ordered(preparedDecisions)))fail('Actual complete UI decision file differs from the original selected decisions.');\n   planned.decisions_file=actual.decisions_file;\n  }\n  const equalEvidence=(a,b)=>Array.isArray(a)&&a.length===b.length&&same(a.map(sorted).sort((x,y)=>canon(x).localeCompare(canon(y))),b.map(sorted).sort((x,y)=>canon(x).localeCompare(canon(y))));\n  const group=step.operation==='crf.dataset.create'?'context':null;\n  if(group){if(!equalEvidence(actual.context.review.evidence_files,planned.context.review.evidence_files))fail('Selected review evidence changed.');planned.context.review.evidence_files=actual.context.review.evidence_files;}\n  if(step.operation==='crf.review.create'){if(!equalEvidence(actual.review.evidence_files,planned.review.evidence_files))fail('Selected complete review evidence changed.');planned.review.evidence_files=actual.review.evidence_files;}\n  if(step.operation==='crf.edition.create'){if(!Array.isArray(actual.dataset_ids)||!same([...actual.dataset_ids].sort(),[...planned.dataset_ids].sort()))fail('The actual selected family population differs.');planned.dataset_ids=actual.dataset_ids;}\n  if(!same(semantic(actual),planned))fail('Actual UI request differs from the bound source plan: '+step.key);\n };\n const result=await action(step.key,step.operation,check,async()=>{\n  await page.locator('#actor').fill(actor);\n  if(step.operation==='crf.dataset.create'){\n   await commonReview(form,expected.context.review);await tab('sources');\n   for(const name of ['title','contract_id','family','file_sha256','format'])await fill(form,name,expected[name]);\n   for(const name of ['coverage','period_start','period_end','captured_at','source_system','extraction_reference'])await fill(form,name,expected.context[name]);\n   await fill(form,'encoding',planned.dialect.encoding);await fill(form,'delimiter',planned.dialect.delimiter);await fill(form,'parent_id',expected.parent_id||'');\n   await fill(form,'mapping','[]');await page.locator('#preview-source').click();await idle();if(!await page.locator('#notice').evaluate(e=>e.classList.contains('error')))fail('Invalid mapping was not shown as an error.');\n   await snapshot('error-'+step.key);await fill(form,'mapping',JSON.stringify(expected.mapping));await page.locator('#preview-source').click();await idle();\n   await snapshot('mapping-'+step.key);\n  }else if(step.operation==='crf.edition.create'){\n   await tab('editions');for(const n of ['title','contract_id','period','dataset_ids','note'])await fill(form,n,expected[n]);await fill(form,'parent_id',expected.parent_id||'');\n  }else if(step.operation==='crf.comparison.create'){\n   await tab('editions');for(const n of ['title','earlier_id','later_id','note'])await fill(form,n,expected[n]);\n  }else{\n   await commonReview(form,expected.review);await tab('review');\n   await fill(form,'title',expected.title);await fill(form,'edition_id',expected.edition_id);await fill(form,'parent_id',expected.parent_id||'');await page.locator('#load-review').click();await idle();\n   const findings=await api('crf.rows',{kind:'crf.edition',id:expected.edition_id,section:'checks',offset:0,limit:500});\n   if(findings.total!==preparedDecisions.length||findings.total>500)fail('Selected reference review population differs from its complete original decisions.');\n   for(const d of preparedDecisions){\n    await page.locator('#review-query').fill(d.check_id);await page.locator('#filter-review').click();await idle();\n    const row=page.locator('#review-items .decision-row');if(await row.count()!==1)fail('Original finding is not uniquely visible.');\n    await selectEvidence(d.evidence_files);await tab('review');\n    await row.getByLabel('Finding disposition',{exact:true}).selectOption(d.status);await row.getByLabel('Finding explanation',{exact:true}).fill(d.note);\n    await row.getByLabel('Corrected descendant edition',{exact:true}).selectOption(d.correction_edition_id||'');await row.getByRole('button',{name:'Attach currently selected evidence',exact:true}).click();\n   }\n   await selectEvidence(expected.review.evidence_files||[]);await tab('review');\n   // Exercise the actual durable exact-parent draft, then reload every finding.\n   await page.locator('#review-query').fill('');await page.locator('#filter-review').click();await idle();await rememberSession();\n   await page.reload({waitUntil:'domcontentloaded'});await idle();await tab('review');await page.locator('#load-review').click();await idle();\n   if(await field(form,'title').inputValue()!==expected.title||await field(form,'parent_id').inputValue()!==(expected.parent_id||''))fail('Review metadata or exact parent draft changed across reload.');\n   await snapshot('review-'+step.key);\n  }\n },async()=>page.locator('#'+form+' button[type=submit], #'+form+' button:not([type])').last().click());\n aliases[step.key]=result;nativeToActual[config.originalStepIds[step.key]]=result.id;return result;\n}\nasync function download(link,name,description){\n const target=path.join(root,'downloads',name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});\n const promise=page.waitForEvent('download');await link.click();const d=await promise,temp=target+'.incoming';await d.saveAs(temp);\n const failure=await d.failure();if(failure)fail('Original download failed: '+failure);\n if(fs.existsSync(target)){if(!same(hashFile(target),hashFile(temp)))fail('Immutable download changed: '+name);fs.unlinkSync(temp);}else fs.renameSync(temp,target);\n const observed=hashFile(target);if(description.expected_sha256&&observed.sha256!==description.expected_sha256)fail('The downloaded bytes differ from the selected original identity.');\n const entry={...description,path:target,...observed};downloads.push(entry);return entry;\n}\nasync function all(kind){const rows=[];let total;do{const r=await api('crf.list',{kind,offset:rows.length,limit:500});if(total!==undefined&&total!==r.total)fail('Record population changed during export.');total=r.total;if(!r.rows.length&&rows.length<total)fail('Incomplete record page.');rows.push(...r.rows);}while(rows.length<total);return rows;}\nasync function recordExports(){\n await tab('records');\n for(const kind of ['contract','dataset','edition','comparison','review','workbook_binding','workbook_output','workbook_return'].map(k=>'crf.'+k)){\n  await page.locator('#record-kind').selectOption(kind);await idle();const records=await all(kind);\n  for(const [i,r]of records.entries()){\n   if(i&&i%50===0){await page.locator('#records-next').click();await idle();}\n   await page.locator('#records-list button').filter({hasText:r.id}).click();await idle();\n   if((await page.locator('#record-json').innerText()).indexOf(r.id)<0)fail('Record detail selected another identity.');\n   for(const format of ['csv','ndjson'])await download(page.locator('#selected-record a').filter({hasText:'Complete '+format.toUpperCase()+' export'}),kind+'-'+r.id+'.'+format,{kind,id:r.id,format,type:'record'});\n   for(const section of Object.keys(r.sections||{})){await page.locator('#row-section').selectOption(section);await idle();const rows=await api('crf.rows',{kind,id:r.id,section,offset:0,limit:500});if(rows.total!==r.sections[section].rows)fail('Visible complete section population differs.');}\n  }\n }\n await page.locator('#verify').click();await idle();if(!/verified/i.test(await page.locator('#notice').innerText()))fail('Original full-record verification did not finish.');\n}\nconst existing=read(path.join(root,config.mode==='return'?'RETURN-BROWSER-COMPLETE.json':'BROWSER-COMPLETE.json'));\nif(existing){if(!same(existing.input,config.inputIdentity))fail('Completed browser input changed.');for(const f of [...existing.downloads,...existing.screenshots])if(!same(hashFile(f.path),{bytes:f.bytes,sha256:f.sha256}))fail('Completed browser artifact changed.');process.exit(0);}\ntry{\nconst baseServer=await serve(config.workspace);base=baseServer.url;\nconst emptyServer=config.mode==='return'?null:await serve(config.emptyWorkspace);\nif(config.mode==='return'){\n context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{executablePath:config.chromium,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage']});\n await openPage(base+config.route,false);\n for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const name of ['contract','sources','editions','review','workbooks','records','handover']){await tab(name);await snapshot('returned-'+width+'-'+name);}}\n await tab('records');await page.locator('#verify').click();await idle();if(!/verified/i.test(await page.locator('#notice').innerText()))fail('Returned original-record verification did not finish.');\n for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(pathToFileURL(config.report).href);await snapshot('returned-report-'+width);if(!await page.locator('body').innerText())fail('The actual readable report is empty.');if(!await page.locator('h1').count())fail('The readable report has no heading.');}\n const hrefs=await page.locator('a[href]').evaluateAll(links=>links.map(a=>a.getAttribute('href')));\n for(const [i,href]of hrefs.entries()){if(href.startsWith('#'))continue;if(/^[a-z]+:/i.test(href))fail('Unexpected external report link; no external navigation.');const filename=path.resolve(path.dirname(config.report),decodeURIComponent(href.split('#')[0]));if(path.dirname(filename)!==path.dirname(config.report))fail('Report attachment left its original directory.');const h=hashFile(filename);downloads.push({type:'report-attachment',path:filename,...h});if(!/\\.(csv|ndjson|html)$/i.test(filename))fail('Unexpected report attachment type.');}\n save(path.join(root,'RETURN-BROWSER-COMPLETE.json'),{schema:'commons.crf-browser-return/v1',input:config.inputIdentity,workspace_id:config.workspaceId,downloads,screenshots,browser_executed:true,screenshots_viewed:false,client_ready:false,report:{path:config.report,...hashFile(config.report)}});\n}else{\n context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{executablePath:config.chromium,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage']});\n await openPage(emptyServer.url+config.route,false);\n for(const name of ['contract','sources','editions','review','workbooks','records','handover']){await tab(name);await snapshot('empty-'+name);}\n await page.close();await openPage(base+config.route);\n if((await page.request.get(base+'/api/state').then(r=>r.json())).project.id!==config.workspaceId)fail('Wrong original workspace.');\n // Full files remain stored as original bytes. Purpose is an explicit UI role,\n // not a change to the original plan's retained provenance descriptor.\n for(const f of Object.values(config.files)){await upload(f,'evidence');if(config.datasetShas.includes(f.sha256))await upload(f,'input');}\n await tab('contract');const contract=Object.values(config.originalRecords).find(r=>r.kind==='crf.contract');\n await page.locator('#contract-copy').selectOption(contract.id);await page.locator('#load-contract').click();await idle();\n const note='Browser draft only; original reviewed contract remains unchanged.';await fill('contract-form','note',note);await rememberSession();await page.reload({waitUntil:'domcontentloaded'});await idle();\n if(await field('contract-form','note').inputValue()!==note)fail('Copied contract draft did not reopen.');\n await snapshot('contract-copy-reopen');\n for(const lane of config.lanes)for(const step of lane.steps)await performStep(step,lane.actor);\n await recordExports();await tab('sources');\n const links=page.locator('#files .file-row a');for(let i=0;i<await links.count();i++){\n  const row=links.nth(i),href=await row.getAttribute('href'),sha=href.split('/api/files/')[1].split('?')[0];\n  await download(row,'original-'+i+'-'+sha,{type:'original',expected_sha256:sha});\n }\n for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const name of ['contract','sources','editions','review','workbooks','records','handover']){await tab(name);await snapshot('populated-'+width+'-'+name);}}\n await page.setViewportSize({width:1440,height:1000});\n const delivery=await action('complete-browser-delivery','delivery.prepare',actual=>{if(!same(semantic(actual),{title:'Complete CRF reporting handover',note:'Complete original CRF course, actual browser recipient edits and retained original evidence. No officer acceptance or DWP submission is inferred.',actor:config.lanes.at(-1).actor}))fail('Complete handover request changed.');},async()=>{await tab('handover');await page.locator('#actor').fill(config.lanes.at(-1).actor);await fill('delivery-form','note','Complete original CRF course, actual browser recipient edits and retained original evidence. No officer acceptance or DWP submission is inferred.');},async()=>page.locator('#delivery-form button').click());\n await tab('handover');const archive=await download(page.locator('#deliveries a[href=\"/api/deliveries/'+delivery.id+'\"]').first(),'complete-browser-return.zip',{type:'delivery',delivery_id:delivery.id});\n if(archive.sha256!==delivery.archive_sha256||archive.bytes!==delivery.archive_bytes)fail('The complete downloaded ZIP differs from the original delivery result.');\n await rememberSession();\n save(path.join(root,'BROWSER-COMPLETE.json'),{schema:'commons.crf-browser-result/v1',input:config.inputIdentity,workspace_id:config.workspaceId,\n  records:aliases,archive,downloads,screenshots,browser_executed:true,screenshots_viewed:false,client_ready:false,\n  original_plan_preserved:true,runtime:{node:process.versions,chromium:context.browser()?.version()||null},issued_workbook:config.workbookRequired?'Original supplied course evidence only':'NOT_SUPPLIED',\n  meaning:'Actual UI course and downloads completed. The producing operator must view the returned images and inspect every outgoing report before a product-ready claim.'});\n}\n}finally{await stop();process.stdin.removeAllListeners('end');process.stdin.destroy();}\n"


def _browser_json(path):
    path = Path(path).expanduser().absolute()
    regular(path)
    require(path.stat().st_size <= MAX_PLAN_BYTES, "CRF_BROWSER_JSON_SIZE",
            "The complete browser source receipt exceeds its explicit bound.")
    return decode_plan(path.read_bytes())


def _browser_runtime(path, name):
    path = Path(path).expanduser().resolve(strict=True)
    regular(path)
    return {"path": str(path), **file_hash(path), "name": name}


@contextmanager
def _browser_lock(output):
    fd = os.open(output / "browser.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "CRF_BROWSER_LOCK", "The browser lease must be an ordinary file.")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("CRF_BROWSER_BUSY", "The original browser course or one of its owned children still holds its lease.") from error
        yield fd
    finally:
        os.close(fd)


def _browser_serve(argv):
    """A child server whose owning Node pipe and inherited lease define its lifetime."""
    import threading
    from migration_server import WorkbenchHTTPServer
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args(argv)
    with MigrationWorkspace(args.workspace) as workspace:
        server = WorkbenchHTTPServer(("127.0.0.1", 0), workspace, Path(__file__).parent)
        print(canonical({"event": "crf_browser_server_ready", "workspace_id": workspace.project["id"],
                         "url": "http://127.0.0.1:" + str(server.server_address[1])}), flush=True)
        def watch_owner():
            # EOF from the original Node owner closes only this owned listener.
            try:
                sys.stdin.buffer.read()
            finally:
                server.shutdown()
        threading.Thread(target=watch_owner, daemon=True).start()
        try:
            server.serve_forever(poll_interval=0.1)
        finally:
            server.server_close()
    return 0


def _browser_child(config, node, output, lease, label):
    import subprocess
    source = output / "crf-browser.mjs"
    publish_bytes(source, CRF_BROWSER_JS.encode("utf-8"))
    configuration = output / (label + "-input.json")
    publish_bytes(configuration, encoded(config))
    complete = output / ("RETURN-BROWSER-COMPLETE.json" if config["mode"] == "return" else "BROWSER-COMPLETE.json")
    if complete.exists():
        value = _browser_json(complete)
        require(value["input"] == config["inputIdentity"], "CRF_BROWSER_INPUT", "The completed browser input changed.")
        for member in value["downloads"] + value["screenshots"]:
            regular(member["path"])
            require(file_hash(member["path"]) == {key: member[key] for key in ("sha256", "bytes")},
                    "CRF_BROWSER_ARTIFACT", "A completed original browser artifact is absent or changed.")
        return value
    attempts = ordinary_directory(output / "attempts", create=True)
    index = len(list(attempts.glob(label + "-*.intent.json")))
    stem = label + "-" + str(index).zfill(4)
    command = [node["path"], "--max-old-space-size=384", str(source), str(configuration)]
    publish_bytes(attempts / (stem + ".intent.json"), encoded({"argv": command, "input": config["inputIdentity"]}))
    with (attempts / (stem + ".stdout.log")).open("xb") as stdout, (attempts / (stem + ".stderr.log")).open("xb") as stderr:
        env = {**os.environ, "CRF_BROWSER_LOCK_FD": str(lease), "PYTHONDONTWRITEBYTECODE": "1"}
        child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                 env=env, pass_fds=(lease,), cwd=str(output))
        print(canonical({"event": "crf_browser_child", "pid": child.pid, "phase": label,
                         "output": str(output), "attempt": stem}), flush=True)
        try:
            returncode = child.wait()
        except BaseException:
            # Closing this owner pipe asks the same child to stop its browser and
            # listener; it never starts a replacement or changes an original ID.
            child.stdin.close()
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                # Its inherited lease remains held: another invocation cannot
                # replace an unknown original child or dispatch a second writer.
                pass
            raise
        finally:
            if child.poll() is not None and not child.stdin.closed:
                child.stdin.close()
        stdout.flush(); stderr.flush()
        os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
    publish_bytes(attempts / (stem + ".result.json"), encoded({"returncode": returncode}))
    require(returncode == 0 and complete.exists(), "CRF_BROWSER_INCOMPLETE",
            "The complete browser course did not return success. Retain its original phase, requests, profile and logs.",
            returncode=returncode, output=str(output), attempt=stem)
    return _browser_json(complete)


def _browser_verify_downloads(workspace, result):
    import hashlib
    for member in result["downloads"]:
        regular(member["path"])
        actual = file_hash(member["path"])
        require(actual == {key: member[key] for key in ("sha256", "bytes")},
                "CRF_BROWSER_DOWNLOAD", "A complete downloaded file changed.")
        if member["type"] == "original":
            require(actual["sha256"] == member["expected_sha256"], "CRF_BROWSER_ORIGINAL", "Original object download changed.")
            with workspace.open_file(member["expected_sha256"]) as held:
                require(file_hash(held) == actual, "CRF_BROWSER_ORIGINAL", "Download differs from the original retained file.")
        elif member["type"] == "record":
            hasher = hashlib.sha256(); count = 0
            for chunk in workspace.iter_export(member["kind"], member["id"], format=member["format"]):
                hasher.update(chunk); count += len(chunk)
            require({"sha256": hasher.hexdigest(), "bytes": count} == actual,
                    "CRF_BROWSER_EXPORT", "A browser download differs from the complete native original-record export.")
        elif member["type"] == "delivery":
            inspect_delivery(member["path"])
        else:
            raise MigrationError("CRF_BROWSER_DOWNLOAD", "Unknown browser download declaration.")


def _browser_verify_operations(workspace, output, records):
    for phase in sorted((output / "browser-phases").iterdir()):
        if not phase.is_dir():
            continue
        complete = phase / "COMPLETE.json"
        if not complete.exists():
            raise MigrationError("CRF_BROWSER_PHASE", "An original browser mutation has no retained terminal receipt.")
        value = _browser_json(complete)
        request = value["request"]
        original = workspace._operation(value["operation_id"])
        require(original["status"] == "SUCCEEDED" and original["operation"] == request["operation"]
                and original["request"] == request["payload"] and original["result"]["result"] == value["result"],
                "CRF_BROWSER_OPERATION", "The original browser request or its full result changed.")
    for record in records.values():
        require(crf_records.get(workspace, record["kind"], record["id"]) == record,
                "CRF_BROWSER_RECORD", "The received browser history changed or lost an original record.")
    return crf_records.verify(workspace)


def _browser_report_attachments(returned, observed, report, source_revision):
    """Read every linked complete attachment, preserving the archive's originals."""
    import csv
    import hashlib
    results = []
    csv.field_size_limit(MAX_PLAN_BYTES)
    with MigrationWorkspace(returned["workspace"]) as workspace:
        for member in observed["downloads"]:
            path = Path(member["path"])
            regular(path)
            require(path.parent == report.parent and file_hash(path) ==
                    {key: member[key] for key in ("sha256", "bytes")},
                    "CRF_BROWSER_REPORT_ATTACHMENT", "An actual report attachment differs.")
            kind = None
            for candidate in crf_records.KINDS:
                if path.stem.startswith(candidate.replace(".", "-") + "-"):
                    kind = candidate
                    break
            count = 0
            if path.suffix == ".ndjson":
                with path.open("rb") as stream:
                    for line in stream:
                        value = decode_plan(line)
                        require(isinstance(value, dict), "CRF_BROWSER_REPORT_JSON", "Original report row must be a complete object.")
                        count += 1
            elif path.suffix == ".csv":
                with path.open("r", encoding="utf-8", newline="") as stream:
                    reader = csv.DictReader(stream)
                    require(reader.fieldnames == ["original_record", "section", "ordinal", "complete_json"],
                            "CRF_BROWSER_REPORT_CSV", "The original complete CSV columns changed.")
                    for row in reader:
                        require(None not in row and all(value is not None for value in row.values()),
                                "CRF_BROWSER_REPORT_CSV", "A complete CSV row changed width.")
                        decode_plan(row["complete_json"].encode("utf-8"))
                        count += 1
            else:
                require(path.suffix == ".html" and path.stat().st_size > 0,
                        "CRF_BROWSER_REPORT_TYPE", "Select the original readable report attachment.")
            if kind:
                hasher = hashlib.sha256(); size = 0
                for chunk in workspace.iter_export(kind, path.stem, format=path.suffix[1:]):
                    hasher.update(chunk); size += len(chunk)
                require({"sha256": hasher.hexdigest(), "bytes": size} ==
                        {key: member[key] for key in ("sha256", "bytes")},
                        "CRF_BROWSER_REPORT_RECORD", "The actual report download differs from the entire original record and sections.")
            results.append({**member, "parsed_rows": count, "original_kind": kind})
        # Catalogue links are shown as names by the maintained report. Include
        # every complete inventory even though it has no anchor element.
        for kind in crf_records.KINDS:
            path = report.parent / (kind.replace(".", "-") + ".ndjson")
            regular(path)
            with path.open("rb") as stream:
                actual = [decode_plan(line) for line in stream]
            require(actual == list(crf_records.records(workspace, kind, before=source_revision + 1)),
                    "CRF_BROWSER_REPORT_INVENTORY", "The complete original record inventory differs.")
            results.append({"type": "report-inventory", "path": str(path), **file_hash(path), "parsed_rows": len(actual), "original_kind": kind})
    return results


def browser_run(result_path, output, *, node, playwright, chromium):
    """Operate one complete authored plan through its original browser and return."""
    from migration_server import STATIC
    result_path = Path(result_path).expanduser().absolute()
    result = _browser_json(result_path)
    require(result.get("schema") == RESULT_SCHEMA and result.get("status") == "COMPLETED",
            "CRF_BROWSER_SOURCE_RESULT", "Select the original complete three-archive CRF result.")
    original_output = Path(result["intent"]["output"])
    plan_path = original_output / "original-plan.json"
    raw_plan, plan_identity = read_plan(plan_path)
    plan = validate_plan(decode_plan(raw_plan))
    require(plan_identity == result["intent"]["plan"], "CRF_BROWSER_PLAN", "Original plan bytes changed.")
    # This concrete operating course uses the actual reviewed reference inputs.
    # Actual customer plans retain their normal run() path; no private input or
    # unsupported form is silently converted to a reference example.
    require(plan["operation_id"] == "CRF-AUTHORED-REFERENCE-20261013-V1" and not plan["workbook_required"],
            "CRF_BROWSER_REFERENCE", "Use the explicit complete authored reference course; no issued workbook is manufactured.")
    output = ordinary_directory(Path(output).expanduser().absolute(), create=True)
    require(output != original_output and original_output not in output.parents and output not in original_output.parents,
            "CRF_BROWSER_DIRECTORY", "Keep the browser continuation in its own nonnested directory.")
    binding = execution_binding(Path(__file__).parent)
    require(binding["application"] == result["intent"]["execution"]["application"],
            "CRF_BROWSER_SOURCE", "The browser must use the exact complete application edition selected by the original course.")
    runtimes = {"node": _browser_runtime(node, "node"), "playwright": _browser_runtime(playwright, "playwright module"),
                "chromium": _browser_runtime(chromium, "chromium executable")}
    require(os.access(runtimes["node"]["path"], os.X_OK) and os.access(runtimes["chromium"]["path"], os.X_OK),
            "CRF_BROWSER_RUNTIME", "Select actual installed executable runtimes.")
    route = next((name for name, value in STATIC.items() if value[0] == "public/crf.html"), None)
    require(route, "CRF_BROWSER_ROUTE", "The current source does not mount its original CRF operator.")
    browser_intent = {"schema": "commons.crf-browser-intent/v1", "operation_id": plan["operation_id"] + "-BROWSER",
                      "original_result": {"path": str(result_path), **file_hash(result_path)},
                      "original_plan": plan_identity, "source": binding, "runtimes": runtimes,
                      "workspace_id": result["workspace_id"], "output": str(output)}
    with _browser_lock(output) as lease:
        publish_bytes(output / "intent.json", encoded(browser_intent))
        # Validate all original archives without recreating a missing progressed
        # recipient. The browser receives its own separate original first edition.
        require(len(result["archives"]) == 3, "CRF_BROWSER_ARCHIVES", "Retain every original complete archive.")
        for archive in result["archives"]:
            verify_archive(archive)
        progressed = ((output / "BROWSER-COMPLETE.json").exists() or
                      (output / "COMPLETE.json").exists() or
                      any((output / "browser-phases").glob("*/request.json")))
        if progressed:
            require((output / "receiver" / "READY.json").exists(), "CRF_BROWSER_RECEIVER_MISSING",
                    "Do not recreate a missing browser recipient after its original requests were admitted.")
        selected = [member for member in inspect_delivery(result["archives"][0]["path"])["manifest"]["files"]
                    if member["path"].startswith("application/")]
        require(sorted(selected, key=lambda x: x["path"]) ==
                sorted(binding["application"]["files"], key=lambda x: x["path"]),
                "CRF_BROWSER_ARCHIVE_SOURCE", "The original first archive contains another source edition.")
        received = receive_delivery(result["archives"][0]["path"], output / "receiver")
        originals = ordinary_directory(output / "originals", create=True)
        original_records, files = {}, {}
        with MigrationWorkspace(received["workspace"]) as workspace:
            require(workspace.project["id"] == result["workspace_id"], "CRF_BROWSER_WORKSPACE", "Received workspace identity changed.")
            for key, pin in result["phases"][0]["records"].items():
                value = crf_records.get(workspace, pin["kind"], pin["id"])
                require(identity(value) == pin["sha256"], "CRF_BROWSER_BASELINE", "The original first edition differs.")
                original_records[key] = value
            for member in plan["files"]:
                info = workspace.file_info(member["sha256"])
                destination = originals / (member["key"] + "-" + member["filename"])
                captured = capture_file(workspace.root / info["relative_path"], destination, destination.name,
                    expected={"path": destination.name, "bytes": member["bytes"], "sha256": member["sha256"]})
                files[member["key"]] = {**member, "path": str(destination)}
        empty = output / "empty-workspace"
        if not (empty / "workspace.sqlite3").exists():
            with MigrationWorkspace(empty, create=True, title="Authored CRF empty operator — no source or authority records"):
                pass
        complete = output / "COMPLETE.json"
        existing = _browser_json(complete) if complete.exists() else None
        if existing:
            require(existing["intent"] == browser_intent, "CRF_BROWSER_COMPLETE", "Completed browser course input changed.")
            require((output / "return-receiver" / "READY.json").exists(), "CRF_BROWSER_RETURN_MISSING",
                    "Do not recreate a missing completed browser recipient that could contain later edits.")
        input_value = {"mode": "operate", "output": str(output), "inputIdentity": identity(browser_intent),
                       "python": str(Path(sys.executable).resolve()), "receiving": str(Path(__file__).resolve()),
                       "workspace": received["workspace"], "workspaceId": result["workspace_id"],
                       "emptyWorkspace": str(empty), "route": route,
                       "playwright": runtimes["playwright"]["path"], "chromium": runtimes["chromium"]["path"],
                       "originalRecords": original_records, "originalStepIds": {
                           key: record["id"] for phase in result["phases"] for key, record in phase["records"].items()},
                       "files": files, "datasetShas": sorted({value["file_sha256"] for value in original_records.values() if value["kind"] == "crf.dataset"} |
                           {resolve(step["payload"]["file_sha256"], files, {}) for step in plan["first_edit"]["steps"] if step["operation"] == "crf.dataset.create"}),
                       "lanes": [plan["first_edit"], plan["second_edit"]], "workbookRequired": plan["workbook_required"]}
        assert_application(Path(__file__).parent, binding)
        observed = _browser_child(input_value, runtimes["node"], output, lease, "operate")
        with MigrationWorkspace(received["workspace"]) as workspace:
            _browser_verify_downloads(workspace, observed)
            verification = _browser_verify_operations(workspace, output, observed["records"])
        archive = observed["archive"]
        regular(archive["path"])
        require(file_hash(archive["path"]) == {key: archive[key] for key in ("sha256", "bytes")},
                "CRF_BROWSER_RETURN_ARCHIVE", "The exact downloaded browser return changed.")
        returned = receive_delivery(archive["path"], output / "return-receiver")
        with MigrationWorkspace(returned["workspace"]) as workspace:
            cold = _browser_verify_operations(workspace, output, observed["records"])
        report = Path(returned["destination"]) / "reports" / "crf-review.html"
        regular(report)
        return_output = ordinary_directory(output / "return-browser", create=True)
        returned_input = {**input_value, "mode": "return", "output": str(return_output),
                          "workspace": returned["workspace"], "report": str(report),
                          "inputIdentity": identity({"intent": browser_intent, "archive": archive,
                                                     "workspace": returned["workspace"], "report": file_hash(report)})}
        assert_application(Path(__file__).parent, binding)
        return_observed = _browser_child(returned_input, runtimes["node"], return_output, lease, "return")
        # The returned browser only reads; immutable CRF histories must still match.
        with MigrationWorkspace(returned["workspace"]) as workspace:
            final_verification = _browser_verify_operations(workspace, output, observed["records"])
        attachment_review = _browser_report_attachments(returned, return_observed, report,
            returned["source_revision"])
        assert_application(Path(__file__).parent, binding)
        completion = {"schema": "commons.crf-browser-receiving-result/v1", "status": "COMPLETED",
                      "intent": browser_intent, "browser": observed, "return_browser": return_observed,
                      "verification": verification, "cold_verification": cold,
                      "final_verification": final_verification, "return_receiver": returned,
                      "report_attachments": attachment_review,
                      "original_plan_and_archives_retained": True, "provider_calls": 0,
                      "tenant_writes": 0, "native_spreadsheet_calculation": "NOT_PERFORMED",
                      "issued_workbook": "NOT_SUPPLIED", "screenshots_viewed": False, "client_ready": False,
                      "required": "The producing operator must view the actual desktop/narrow screenshots and readable report, inspect complete exported attachments, and repair any concrete defects before a product-ready claim."}
        if existing:
            # Later valid recipient edits may change current verification metadata.
            # Validate above, but preserve the first complete receiving result.
            return {**existing, "reused": True, "later_edits_preserved": True}
        publish_bytes(complete, encoded(completion))
        return completion


def browser_main(argv):
    parser = argparse.ArgumentParser(description="Complete original CRF authored browser and editable receiving course.")
    parser.add_argument("--result", required=True, help="The original three-archive COMPLETE.json.")
    parser.add_argument("--output", required=True, help="One original independent browser output directory.")
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True, help="Exact existing Playwright module entry.")
    parser.add_argument("--chromium", required=True)
    args = parser.parse_args(argv)
    try:
        print(canonical(browser_run(args.result, args.output, node=args.node, playwright=args.playwright, chromium=args.chromium)))
        return 0
    except Exception as error:
        value = error.as_dict() if isinstance(error, MigrationError) else {"code": type(error).__name__, "message": str(error)}
        print(canonical({"error": value}), file=sys.stderr)
        return 2


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "browser":
        return browser_main(argv[1:])
    if argv and argv[0] == "browser-serve":
        return _browser_serve(argv[1:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-reference", metavar="DIRECTORY", help="Prepare the complete authored six-family source and two-recipient course.")
    parser.add_argument("--plan")
    parser.add_argument("--workspace")
    parser.add_argument("--output")
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.prepare_reference:
            require(not any((args.plan, args.workspace, args.output, args.create, args.resume)),
                    "CRF_REFERENCE_ARGUMENTS", "Prepare reference files separately from executing their original plan.")
            print(canonical(prepare_reference(args.prepare_reference)))
            return 0
        require(all((args.plan, args.workspace, args.output)), "CRF_PROGRAMME_ARGUMENTS",
                "Supply --plan, --workspace and --output for the complete receiving programme.")
        print(canonical(run(args.plan, args.workspace, args.output, create=args.create, resume=args.resume)))
        return 0
    except Exception as error:
        value = error.as_dict() if isinstance(error, MigrationError) else {"code": type(error).__name__, "message": str(error)}
        print(canonical({"error": value}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
