#!/usr/bin/env python3
"""Run an explicit property continuity plan through two editable receivers.

Original files, mapping decisions and any release evidence are supplied by the
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
import property_workspace as property_records
from property_domain import require, obj

SCHEMA = "commons.property-receiving-plan/v1"
RESULT_SCHEMA = "commons.property-receiving-result/v1"
PHASE_SCHEMA = "commons.property-receiving-phase/v1"
MAX_PLAN_BYTES = 64 * 1024 * 1024
RESERVED = {"actor", "expected_revision", "operation_id"}
REFERENCE_KEYS = {"$file", "$sha", "$step", "$record"}


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "PROPERTY_PLAN_DUPLICATE_KEY",
                "The original plan repeats a JSON object key.", key=key)
        result[key] = value
    return result


def decode_plan(raw):
    def reject_constant(value):
        raise MigrationError("PROPERTY_PLAN_JSON", "The plan contains a nonfinite JSON token.", {"token": value})
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique_pairs, parse_constant=reject_constant)
    except (ValueError, UnicodeError) as error:
        raise MigrationError("PROPERTY_PLAN_JSON", "The complete original plan is not valid UTF-8 JSON.") from error


def application_binding(source_root):
    source_root = ordinary_directory(source_root)
    members = [file_description(source_root / name, "application/" + name) for name in APPLICATION_FILES]
    profile = application_selection(members, profile=APPLICATION_PROFILE)
    require(profile == "commons.migration-workbench-application/v3" and len(members) == 39,
            "PROPERTY_APPLICATION_SELECTION", "Use the complete maintained 39-file property application.")
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
                    "PROPERTY_IMPORTED_SOURCE", "An imported application module came from another source edition.", module=name)
    return {"schema": "commons.property-execution-binding/v1", "application": application_binding(root), "runtime": runtime}


def assert_application(source_root, binding):
    require(application_binding(source_root) == binding["application"], "PROPERTY_APPLICATION_CHANGED",
            "The original programme's complete application selection changed; preserve its exact source before continuing.")


def read_plan(path):
    path = Path(path).expanduser().absolute()
    regular(path)
    with path.open("rb") as stream:
        before = file_hash(stream)
        require(before["bytes"] <= MAX_PLAN_BYTES, "PROPERTY_PLAN_SIZE",
                "The complete plan exceeds the explicit 64 MiB bound.")
        raw = stream.read(MAX_PLAN_BYTES + 1)
    require(len(raw) == before["bytes"] and identity_bytes(raw) == before["sha256"],
            "PROPERTY_PLAN_CHANGED", "Original plan changed while it was read.")
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
            require(len(value) == 1, "PROPERTY_PLAN_REFERENCE",
                    "A file or step reference must be its complete one-key object.")
            key = next(iter(selected))
            name = value[key]
            require(isinstance(name, str) and name in (files if key in ("$file", "$sha") else previous),
                    "PROPERTY_PLAN_REFERENCE", "Reference an original file or an earlier retained step.", reference=value)
        else:
            for item in value.values(): references(item, files, previous)


def validate_plan(value):
    obj(value, ("schema", "operation_id", "title", "actor", "release_required",
                "files", "steps", "first_edit", "second_edit"))
    require(value["schema"] == SCHEMA, "PROPERTY_PLAN_SCHEMA", "Use the complete property receiving plan.")
    identifier(value["operation_id"], "operation_id")
    text(value["title"], "title"); text(value["actor"], "actor")
    require(type(value["release_required"]) is bool, "PROPERTY_PLAN_RELEASE",
            "Declare explicitly whether an evidenced original release is required.")
    require(isinstance(value["files"], list), "PROPERTY_PLAN_FILES", "Supply the complete original file inventory.")
    file_keys = set()
    for member in value["files"]:
        obj(member, ("key", "path", "filename", "sha256", "bytes"), ("purpose",))
        identifier(member["key"], "file key")
        require(member["key"] not in file_keys, "PROPERTY_PLAN_FILE_KEY", "Keep original file keys unique.")
        file_keys.add(member["key"])
        text(member["path"], "original path"); basename(member["filename"])
        digest(member["sha256"]); integer(member["bytes"], "original bytes")
        if "purpose" in member: text(member["purpose"], "file purpose")
    for name in ("first_edit", "second_edit"):
        obj(value[name], ("actor", "steps"))
        text(value[name]["actor"], name + " actor")
    actors = [value["actor"], value["first_edit"]["actor"], value["second_edit"]["actor"]]
    require(len(set(actors)) == 3, "PROPERTY_PLAN_RECIPIENT",
            "Name the original operator and both independent receiving operators distinctly.")
    previous = set()
    for phase, steps in (("original", value["steps"]), ("first-edit", value["first_edit"]["steps"]),
                         ("second-edit", value["second_edit"]["steps"])):
        require(isinstance(steps, list) and steps, "PROPERTY_PLAN_STEPS",
                "Retain the complete original course and both explicit recipient edits.", phase=phase)
        for step in steps:
            obj(step, ("key", "operation", "payload"))
            identifier(step["key"], "step key")
            require(step["key"] not in previous, "PROPERTY_PLAN_STEP_KEY", "Keep all programme step keys unique.")
            require(step["operation"] in property_records.MUTATIONS, "PROPERTY_PLAN_OPERATION",
                    "Use an advertised original property mutation.", operation=step["operation"])
            require(isinstance(step["payload"], dict) and not set(step["payload"]) & RESERVED,
                    "PROPERTY_PLAN_ENVELOPE", "The programme binds actor, original operation ID and current revision.")
            references(step["payload"], file_keys, previous)
            previous.add(step["key"])
    operations = [step["operation"] for step in value["steps"]]
    require("property.contract.create" in operations and operations.count("property.edition.create") >= 4
            and operations.count("property.reconciliation.create") >= 2,
            "PROPERTY_PLAN_COURSE", "Retain an original contract and at least two source/target edition selections and reconciliations.")
    if value["release_required"]:
        require("property.release.create" in operations, "PROPERTY_PLAN_RELEASE",
                "The required release must be an original-stage step backed by its actual evidence.")
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
        require(stat.S_ISREG(os.fstat(fd).st_mode), "PROPERTY_PROGRAMME_LOCK", "Programme lock must be an ordinary file.")
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("PROPERTY_PROGRAMME_BUSY", "The same programme already has an active owner.") from error
        yield
    finally:
        os.close(fd)


def original_operation(workspace, operation, payload, *, resume):
    old = workspace._operation(payload["operation_id"], required=False)
    if old:
        semantic = {key: value for key, value in payload.items() if key not in ("operation_id", "expected_revision")}
        require(old["operation"] == operation and old["request_sha256"] ==
                identity({"operation": operation, "payload": semantic}),
                "PROPERTY_PLAN_CONTINUITY", "The original step is bound to different inputs, actor or decisions.")
        if old["status"] == "SUCCEEDED": return old["result"]["result"]
        require(resume, "PROPERTY_PLAN_RESUME", "Explicitly resume the same interrupted original operation.",
                operation_id=old["id"], status=old["status"])
        return workspace.resume_original(old["id"], actor=payload["actor"],
            reason="Explicit continuation of the complete original property receiving plan.",
            expected_revision=workspace.project["revision"], handler=workspace._handler(operation))["result"]
    return workspace.dispatch(operation, payload)["result"]


def stage_files(workspace, plan, raw_plan):
    workspace.stage_file(io.BytesIO(raw_plan), "property-original-plan.json",
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
                    "PROPERTY_PLAN_FILE", "Retained original file differs from the admitted plan.")
        else:
            path = Path(member["path"]).expanduser().absolute()
            regular(path)
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "PROPERTY_PLAN_FILE",
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
                "PROPERTY_PHASE_CONTINUITY", "Retained phase is bound to different original operations or workspace.")
        if readiness is not None:
            require(saved["readiness"] == readiness, "PROPERTY_PHASE_READINESS", "Original phase selections changed.")
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
        payload.update(operation_id="property-" + identity({
            "plan": plan["operation_id"], "phase": phase, "step": step["key"]})[:50],
            expected_revision=workspace.project["revision"], actor=actor)
        result = original_operation(workspace, step["operation"], payload, resume=resume)
        require(result.get("kind") == step["operation"].removesuffix(".create"),
                "PROPERTY_STEP_RESULT", "Original operation returned another property record kind.")
        records[step["key"]] = result; selected[step["key"]] = result
        print(canonical({"event": "property_step", "phase": phase, "key": step["key"], "id": result["id"],
                         "workspace_id": workspace.project["id"], "revision": workspace.project["revision"]}), flush=True)
    return selected


def original_readiness(workspace, plan, records):
    contracts = {value["id"] for value in records.values() if value["kind"] == "property.contract"}
    reconciliations = [value for value in records.values() if value["kind"] == "property.reconciliation"]
    selections = []
    for rec in reconciliations:
        require(rec["contract_id"] in contracts, "PROPERTY_PLAN_CONTRACT",
                "Original reconciliations must bind an original-stage reviewed contract.")
        source = property_records.get(workspace, "property.edition", rec["source_edition_id"])
        target = property_records.get(workspace, "property.edition", rec["target_edition_id"])
        require(source["role"] == "source" and target["role"] == "target"
                and source["contract_id"] == target["contract_id"] == rec["contract_id"],
                "PROPERTY_PLAN_SELECTION", "Retain the exact complete source/target selection.")
        selections.append({"reconciliation_id": rec["id"], "contract_id": rec["contract_id"],
            "source_edition_id": source["id"], "target_edition_id": target["id"], "cutoff": rec["cutoff"],
            "assessment_sha256": rec["assessment_sha256"], "assessment": rec["assessment"]})
    pairs = {(x["source_edition_id"], x["target_edition_id"]) for x in selections}
    require(len(pairs) >= 2, "PROPERTY_PLAN_REHEARSALS", "Retain at least two distinct complete source/target selections.")
    releases = [value for value in records.values() if value["kind"] == "property.release"]
    if plan["release_required"]:
        require(releases, "PROPERTY_PLAN_RELEASE", "The required original release has not actually returned.")
    release = releases[-1] if plan["release_required"] else None
    return {"outcome": "recorded-release-received" if release is not None else "working-record-received",
            "release_required": plan["release_required"], "release": release,
            "recorded_release_ids": [value["id"] for value in releases],
            "selections": selections,
            "reviews": [{"id": value["id"], "reconciliation_id": value["reconciliation_id"],
                         "effective_reconciliation_id": value["effective_reconciliation_id"], "ready": value["ready"]}
                        for value in records.values() if value["kind"] == "property.review"],
            "controls": [{"id": value["id"], "category": value["category"], "status": value["status"]}
                         for value in records.values() if value["kind"] == "property.control"],
            "meaning": "Readiness and any external acceptance remain exactly the supplied original evidence; held states are retained."}


def prepare_archive(workspace, source_root, output, plan, phase, actor, *, resume, binding):
    assert_application(source_root, binding)
    service = PortableService(workspace, workspace.root, source_root)
    payload = {"operation_id": "property-delivery-" + identity({"plan": plan["operation_id"], "phase": phase})[:45],
               "expected_revision": workspace.project["revision"], "actor": actor,
               "title": plan["title"] + " — " + phase,
               "note": "Complete original property definitions, files, decisions, assessments, application and editable workspace."}
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
            "PROPERTY_ARCHIVE_SOURCE", "The portable archive contains another complete application edition.")
    return {"path": str(destination), "sha256": captured["sha256"], "bytes": captured["bytes"],
            "delivery_id": record["id"], "operation_id": payload["operation_id"]}


def verify_archive(entry):
    regular(entry["path"])
    require(file_hash(entry["path"]) == {key: entry[key] for key in ("sha256", "bytes")},
            "PROPERTY_ARCHIVE_IDENTITY", "Retained full delivery archive changed.")
    inspect_delivery(entry["path"])


def cold_reopen(receivers, workspace_id, phases, plan):
    actual = []
    plan_phases = [("original", plan["actor"], plan["steps"]),
                   ("first-edit", plan["first_edit"]["actor"], plan["first_edit"]["steps"]),
                   ("second-edit", plan["second_edit"]["actor"], plan["second_edit"]["steps"])]
    files = {member["key"]: member for member in plan["files"]}
    for index, entry in enumerate(receivers):
        with MigrationWorkspace(entry["workspace"]) as workspace:
            require(workspace.project["id"] == workspace_id, "PROPERTY_RECEIVER_ID",
                    "The editable recipient no longer has the original workspace identity.")
            verification = property_records.verify(workspace)
            aliases = {}
            # Receiver one has original+first-edit. Receiver two has all three.
            for phase_index, (phase, actor, steps) in enumerate(plan_phases[:index + 2]):
                selected = {}
                for step in steps:
                    op_id = "property-" + identity({"plan": plan["operation_id"], "phase": phase, "step": step["key"]})[:50]
                    operation = workspace._operation(op_id)
                    payload = resolve(step["payload"], files, aliases)
                    payload["actor"] = actor
                    require(operation["operation"] == step["operation"] and operation["status"] == "SUCCEEDED"
                            and operation["request_sha256"] == identity({"operation": step["operation"], "payload": payload}),
                            "PROPERTY_RECEIVER_OPERATION", "A received original command differs from the admitted plan.")
                    value = operation["result"]["result"]
                    retained = property_records.get(workspace, value["kind"], value["id"])
                    require(retained == value, "PROPERTY_RECEIVER_HISTORY", "Original received result differs from its record.")
                    aliases[step["key"]] = value; selected[step["key"]] = value
                require(record_pins(selected) == phases[phase_index]["records"],
                        "PROPERTY_RECEIVER_HISTORY", "Original phase result identities changed or are missing.")
            actual.append(verification)
    return actual


def resume_complete(result, intent, output, plan):
    require(result["schema"] == RESULT_SCHEMA and result["intent"] == intent,
            "PROPERTY_PROGRAMME_IDENTITY", "Completed programme belongs to a different original plan or workspace.")
    require(len(result["phases"]) == 3 and len(result["archives"]) == 3,
            "PROPERTY_PROGRAMME_COMPLETE", "Retain all three original phases and all three complete archives.")
    for index, name in enumerate(("original", "first-edit", "second-edit")):
        phase_path = output / "phases" / (name + ".json")
        regular(phase_path)
        require(parse_json(phase_path.read_text("utf-8")) == result["phases"][index],
                "PROPERTY_PHASE_CONTINUITY", "Complete result differs from the original retained phase.")
    receivers = [result["first_receiver"], result["second_receiver"], result["final_receiver"]]
    for index, (entry, receiver) in enumerate(zip(result["archives"], receivers)):
        destination = output / ("receiver-one", "receiver-two", "receiver-final")[index]
        require(receiver["destination"] == str(destination) and receiver["workspace"] == str(destination / "workspace")
                and Path(entry["path"]).parent == output, "PROPERTY_RECEIVER_PATH", "Original receiving paths changed.")
        # Never reconstruct a missing completed recipient: it may hold later edits.
        regular(destination / "READY.json")
        verify_archive(entry)
        receive_delivery(entry["path"], destination)
    cold_reopen(receivers, result["workspace_id"], result["phases"], plan)
    return {**result, "reused": True, "later_edits_preserved": True}


def run_locked(plan, raw_plan, plan_identity, workspace_path, output, binding, *, create, resume):
    intent = {"schema": "commons.property-receiving-intent/v1", "operation_id": plan["operation_id"],
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
    require(exists or create, "PROPERTY_PROGRAMME_WORKSPACE",
            "Select the existing original workspace or explicitly create it.")
    with MigrationWorkspace(workspace_path, create=not exists, title=plan["title"]) as original:
        workspace_id = original.project["id"]
        publish_bytes(output / "workspace-binding.json", encoded({"intent": intent, "workspace_id": workspace_id}))
        files = stage_files(original, plan, raw_plan)
        original_records = run_steps(original, plan, plan["steps"], files, records, "original", plan["actor"], resume=resume, source_root=source_root, binding=binding)
        verification = property_records.verify(original)
        readiness = original_readiness(original, plan, original_records)
        first_phase = checked_phase(phase_root / "original.json",
            {"intent": intent, "phase": "original", "actor": plan["actor"]}, original_records, verification, readiness)
        first_archive = prepare_archive(original, source_root, output, plan, "original", plan["actor"], resume=resume, binding=binding)
        publish_bytes(phase_root / "first-archive.json", encoded(first_archive))
    first_received = receive_delivery(first_archive["path"], output / "receiver-one")
    with MigrationWorkspace(first_received["workspace"]) as receiver:
        require(receiver.project["id"] == workspace_id, "PROPERTY_RECEIVER_ID", "First receiver changed original identity.")
        # Resume the original admitted edit before full verification: a prior
        # interruption may have committed its entity before its terminal result.
        first_records = run_steps(receiver, plan, plan["first_edit"]["steps"], files, records,
                                  "first-edit", plan["first_edit"]["actor"], resume=resume, source_root=source_root, binding=binding)
        second_phase = checked_phase(phase_root / "first-edit.json",
            {"intent": intent, "phase": "first-edit", "actor": plan["first_edit"]["actor"]},
            first_records, property_records.verify(receiver))
        second_archive = prepare_archive(receiver, source_root, output, plan, "first-edit",
                                         plan["first_edit"]["actor"], resume=resume, binding=binding)
        publish_bytes(phase_root / "second-archive.json", encoded(second_archive))
    second_received = receive_delivery(second_archive["path"], output / "receiver-two")
    with MigrationWorkspace(second_received["workspace"]) as receiver:
        require(receiver.project["id"] == workspace_id, "PROPERTY_RECEIVER_ID", "Second receiver changed original identity.")
        # Resume the original admitted edit before full verification: a prior
        # interruption may have committed its entity before its terminal result.
        second_records = run_steps(receiver, plan, plan["second_edit"]["steps"], files, records,
                                   "second-edit", plan["second_edit"]["actor"], resume=resume, source_root=source_root, binding=binding)
        third_phase = checked_phase(phase_root / "second-edit.json",
            {"intent": intent, "phase": "second-edit", "actor": plan["second_edit"]["actor"]},
            second_records, property_records.verify(receiver))
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
                    "PROPERTY_RECEIVER_PATH", "Original receiving destination changed.")
        receiving = previous
    else:
        publish_bytes(receiving_path, encoded(receiving))
    result = {"schema": RESULT_SCHEMA, "status": "COMPLETED", "intent": intent,
              "workspace_id": workspace_id, "outcome": first_phase["readiness"]["outcome"],
              "release": first_phase["readiness"]["release"], "readiness": first_phase["readiness"],
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
            "PROPERTY_PROGRAMME_PATHS", "Keep the original workspace and receiving output in separate nonnested directories.")
    with programme_lock(output):
        binding = execution_binding(Path(__file__).parent)
        return run_locked(plan, raw_plan, plan_identity, workspace_path, output, binding, create=create, resume=resume)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        print(canonical(run(args.plan, args.workspace, args.output, create=args.create, resume=args.resume)))
        return 0
    except Exception as error:
        value = error.as_dict() if isinstance(error, MigrationError) else {"code": type(error).__name__, "message": str(error)}
        print(canonical({"error": value}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
