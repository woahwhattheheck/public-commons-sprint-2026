#!/usr/bin/env python3
"""Prepare an isolated, editable INTERNAL example through original SF47 writers.

No customer delivery, grant receipt, invoice, payment or external acceptance is
asserted. The original Workspace, Operations, Installation and full ZIP receiver
own every state transition. Reopening preserves the selected historical edition
and all later operator changes.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import uuid

from model import Workspace, canonical
from operations import Operations
from commercial_effort_handoff import verify as verify_effort

SCHEMA = "stellar-forge.sf47-commercial-effort-example.v1"
RESULT_SCHEMA = "stellar-forge.sf47-commercial-effort-example-result.v1"
HASH = re.compile(r"[0-9a-f]{64}")
MAX_BYTES = 32 * 1024 * 1024
SCENARIO_SHA = "79090013305fd4173413e7b2aad3b63c0ec696d1e8323c526eaea2c18d402ece"
LABEL = "INTERNAL WALKTHROUGH ONLY: authored effort, not customer work or cash."
HERE = Path(__file__).resolve().parent


def fail(message):
    raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (canonical(value) + "\n").encode("utf-8")


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail(label + ": retain exactly the documented fields.")
    return value


def private_bytes(path, maximum=MAX_BYTES):
    path = Path(path)
    if not path.is_absolute():
        fail("Use absolute original file paths.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                or before.st_mode & 0o077 or before.st_nlink != 1
                or before.st_size > maximum):
            fail("Retain one owned private regular file within the size limit.")
        chunks, count = [], 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, maximum + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
            if count > maximum:
                fail("The retained original file exceeds its size limit.")
        after = os.fstat(fd)
        named = os.stat(path, follow_symlinks=False)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink")
        if any(getattr(before, key) != getattr(after, key) for key in fields) or \
                (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino):
            fail("The original file changed while it was read.")
        return b"".join(chunks)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path):
    path = Path(os.path.abspath(path))
    # Reject a symlink anywhere in the requested path, before any creation.
    for item in reversed((path, *path.parents)):
        if item.is_symlink():
            fail("Use a directory without symlink ancestors.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        fail("The example directory must be owned and private.")
    return path


def retain(path, raw):
    """Create-only publication; a crash leaves no named incomplete original."""
    try:
        prior = private_bytes(path)
    except FileNotFoundError:
        pass
    else:
        if prior != raw:
            fail("A retained example original changed: " + path.name)
        return
    fd, temp = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        # The enclosing original example flock is held throughout preparation.
        # Rename the complete owned temporary directly, avoiding a two-link
        # crash window that would make a later private-file check reject it.
        try:
            prior = private_bytes(path)
        except FileNotFoundError:
            os.replace(temp, path)
        else:
            if prior != raw:
                fail("A different original won publication: " + path.name)
            os.unlink(temp)
        sync_directory(path.parent)
        if private_bytes(path) != raw:
            fail("Published original differs: " + path.name)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def read_json(path):
    return json.loads(private_bytes(path))


def descriptor(path, raw):
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


def validated_input(raw, expected_sha):
    if not isinstance(expected_sha, str) or not HASH.fullmatch(expected_sha) or sha(raw) != expected_sha:
        fail("The complete example input differs from its selected SHA-256.")
    value = exact(json.loads(raw), ("schema", "operationId", "createdAt", "actor",
                                  "merchantSource", "selected"), "Example input")
    if value["schema"] != SCHEMA:
        fail("Use the original commercial effort example schema.")
    for key in ("operationId", "actor"):
        if not isinstance(value[key], str) or not value[key].strip() or len(value[key]) > 300:
            fail("Provide the explicit internal example operation and operator.")
    if not isinstance(value["createdAt"], str):
        fail("Retain the original example observation time.")
    stamp = datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00"))
    if stamp.utcoffset() is None:
        fail("Use an explicit timezone for the original example time.")
    source = exact(value["merchantSource"], ("path", "bytes", "sha256"), "Merchant source")
    if (not isinstance(source["path"], str) or not Path(source["path"]).is_absolute()
            or isinstance(source["bytes"], bool) or not isinstance(source["bytes"], int)
            or not 0 < source["bytes"] <= MAX_BYTES
            or not isinstance(source["sha256"], str) or not HASH.fullmatch(source["sha256"])):
        fail("Select the complete private original merchant HANDOFF.")
    selected = exact(value["selected"], ("quoteId", "quoteSha256", "acceptanceId",
                                         "acceptanceSha256"), "Original accepted quotation")
    for key in ("quoteId", "acceptanceId"):
        if not isinstance(selected[key], str) or not selected[key] or len(selected[key]) > 300:
            fail("Select the actual original quote and acceptance IDs.")
    for key in ("quoteSha256", "acceptanceSha256"):
        if not isinstance(selected[key], str) or not HASH.fullmatch(selected[key]):
            fail("Select the exact original quote and acceptance hashes.")
    return value, stamp.date().isoformat()


class OriginalRequests:
    """Retain original writer requests before dispatch, then replay their UUIDs."""
    def __init__(self, root, input_sha, ops, actor):
        self.root = private_directory(root / "requests")
        self.input_sha, self.ops, self.actor = input_sha, ops, actor

    def request(self, key, build, invoke):
        path = self.root / (key + ".request.json")
        try:
            record = read_json(path)
        except FileNotFoundError:
            record = {"schema": SCHEMA, "inputSha256": self.input_sha,
                      "key": key, "body": build()}
            retain(path, encoded(record))
        if (record.get("schema"), record.get("inputSha256"), record.get("key")) != \
                (SCHEMA, self.input_sha, key):
            fail("The original request belongs to another example.")
        body = record["body"]
        expected_id = "effort-example-" + self.input_sha[:32] + "-" + key
        if body.get("requestId") != expected_id or body.get("actor") != self.actor:
            fail("The original request identity or operator changed.")
        # Always use the original API even after a saved reply. Its transaction
        # replays the exact UUID before current-version checks, without a write.
        result = invoke(body)
        retain(self.root / (key + ".result.json"), encoded({
            "requestSha256": sha(encoded(record)), "result": result}))
        return result

    def command(self, key, case_id, action, data):
        def build():
            return {"expectedVersion": self.ops.read(case_id)["program"]["version"],
                    "requestId": "effort-example-" + self.input_sha[:32] + "-" + key,
                    "actor": self.actor, "note": LABEL,
                    "action": action, "data": data() if callable(data) else data}
        def invoke(body):
            if body.get("action") != action:
                fail("The retained original command action changed.")
            return self.ops.command(case_id, body)
        return self.request(key, build, invoke)


def prepare(input_path, input_sha, output):
    raw_input = private_bytes(input_path)
    value, day = validated_input(raw_input, input_sha)
    out = private_directory(output)
    if out == HERE or HERE in out.parents:
        fail("Keep example state outside installed application source.")
    lock_path = out / "example.lock"
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(lock_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_nlink != 1:
            fail("Use the original private example lock.")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return prepare_locked(value, day, raw_input, input_sha, out)
    finally:
        os.close(lock_fd)


def prepare_locked(value, day, raw_input, input_sha, out):
    # The complete input and selected executable make a retry concrete.
    retain(out / "input.json", raw_input)
    retain(out / "intent.json", encoded({
        "schema": SCHEMA, "inputSha256": input_sha, "directory": str(out),
        "operationId": value["operationId"], "classification": "INTERNAL_WALKTHROUGH",
        "programSha256": sha(Path(__file__).read_bytes()), "scenarioSha256": SCENARIO_SHA,
        "assumptions": {"recordedHours": ["18", "24"], "acceptedHours": "18",
                        "remainingHours": "30", "quotedTaskHours": None}}))
    original_source = private_bytes(value["merchantSource"]["path"])
    if len(original_source) != value["merchantSource"]["bytes"] or sha(original_source) != value["merchantSource"]["sha256"]:
        fail("The complete merchant source changed.")
    source_file = out / "original-merchant-HANDOFF.json"
    retain(source_file, original_source)
    scenario = (HERE.parent / "sf10_current_candidate.json").read_bytes()
    if sha(scenario) != SCENARIO_SHA:
        fail("The selected original scenario source differs from this example.")
    scenario_file = out / "original-scenario.json"
    retain(scenario_file, scenario)
    workspace_dir = private_directory(out / "workspace")
    workspace = Workspace(workspace_dir, scenario_file)
    try:
        ops = Operations(workspace)
        requests = OriginalRequests(out, input_sha, ops, value["actor"])
        try:
            plan_selection = read_json(out / "plan-selection.json")
        except FileNotFoundError:
            choices = [workspace.read(item["id"], 1) for item in workspace.list()]
            choices = [item for item in choices if item["source"]["sha256"] == SCENARIO_SHA]
            if len(choices) != 1:
                fail("Reconcile the isolated example's original planning selection.")
            plan_selection = {key: choices[0][key] for key in ("id", "revision", "contentSha256")}
            retain(out / "plan-selection.json", encoded(plan_selection))
        plan = workspace.read(plan_selection["id"], plan_selection["revision"])
        if plan["contentSha256"] != plan_selection["contentSha256"] or plan["source"]["sha256"] != SCENARIO_SHA:
            fail("The retained original planning selection changed.")
        case = requests.request("create", lambda: {
            "planId": plan["id"], "selectedRevision": plan["revision"],
            "expectedContentSha256": plan["contentSha256"],
            "name": "INTERNAL example — accepted quotation delivery effort",
            "mode": "WALKTHROUGH", "calendarStart": day, "actor": value["actor"],
            "requestId": "effort-example-" + input_sha[:32] + "-create"}, ops.create)
        case_id = case["id"]
        if ops.read(case_id)["program"]["mode"] != "WALKTHROUGH":
            fail("This example must stay in its original WALKTHROUGH case.")
        added = requests.command("source", case_id, "source.add", {
            "filename": source_file.name, "mediaType": "application/json",
            "contentBase64": base64.b64encode(original_source).decode("ascii"),
            "kind": "other", "sourceUrl": "", "observedAt": value["createdAt"]})
        source_id = added["recordId"]
        metadata, received_source = ops.source(case_id, source_id)
        if received_source != original_source or metadata["sha256"] != value["merchantSource"]["sha256"]:
            fail("The original writer retained a different merchant source.")
        source = {"sourceIds": [source_id], "sourceNote": LABEL}
        contributor = requests.command("contributor", case_id, "contributor.save", {
            "name": "Internal example implementation role", "kind": "ROLE", "contact": "",
            "note": LABEL, **source})
        work = []
        for index, hours in enumerate(("18", "24"), 1):
            made = requests.command("work-" + str(index), case_id, "work.save", {
                "contributorId": contributor["recordId"], "costId": None,
                "description": "Authored internal implementation effort " + str(index),
                "startDate": day, "endDate": day, "hours": hours,
                "fundingBasis": "INTERNAL", **source})
            work.append({"id": made["recordId"], "hours": hours})
        requests.command("submit-1", case_id, "work.submit", {"id": work[0]["id"]})
        requests.command("accept-1", case_id, "work.accept", {"id": work[0]["id"]})

        def first_document():
            inventory = ops.installation_commercial(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "sourceId": source_id, "expectedSourceSha256": metadata["sha256"]})
            if inventory.get("missingFiles"):
                fail("The authored merchant handoff requires its complete external source files.")
            seed = ops.seed_commercial_installation(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "sourceId": source_id, "expectedSourceSha256": metadata["sha256"],
                **value["selected"], "installationId": None, "expectedRevision": 0})
            if not seed.get("canApply"):
                fail("Review the original accepted scope's unresolved choices.")
            preview = ops.preview_installation(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": None, "expectedRevision": 0, "document": seed["document"]})
            return {"installationId": None, "expectedRevision": 0,
                    "document": preview["document"], "expectedPreviewSha256": preview["previewSha256"]}
        initial = requests.command("installation-initial", case_id, "installation.save", first_document)
        installation_id = initial["recordId"]
        initial_row = ops.installation(case_id, installation_id, initial["revision"])
        if initial_row["sha256"] != initial["sha256"]:
            fail("The first saved Installation changed.")

        def effort_document():
            seed = ops.seed_installation_effort(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": installation_id, "expectedRevision": initial["revision"], "asOfDate": day})
            phases = seed["phaseSource"]["phases"]
            if len(phases) != 1:
                fail("This explicit example expects the original single implementation task.")
            task_id = phases[0]["phaseId"]
            inventory = {row["workId"]: row for row in seed["workInventory"]}
            document = deepcopy(seed["document"])
            document["effort"]["note"] = LABEL + " 42 recorded hours plus 30 remaining; no task effort was quoted."
            document["effort"]["allocations"] = [{
                "workId": row["id"], "phaseId": task_id, "hours": row["hours"],
                "workContentSha256": inventory[row["id"]]["workContentSha256"], "note": LABEL}
                for row in work]
            document["effort"]["supportWindows"] = []
            preview = ops.preview_installation(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": installation_id, "expectedRevision": initial["revision"], "document": document})
            report = preview["report"]["effort"]
            document = deepcopy(preview["document"])
            document["effort"]["reviews"] = [{
                "phaseId": task_id, "remainingHours": "30", "reviewedBy": value["actor"],
                "reviewedAt": value["createdAt"], "basisSha256": report["phases"][0]["reviewBasisSha256"],
                "note": LABEL + " Authored remaining-work assumption for the internal example.",
                "sourceIds": [source_id]}]
            preview = ops.preview_installation(case_id, {
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": installation_id, "expectedRevision": initial["revision"], "document": document})
            if not preview["report"]["effort"]["readyForPlanning"]:
                fail("The original effort engine requires further review.")
            return {"installationId": installation_id, "expectedRevision": initial["revision"],
                    "document": preview["document"], "expectedPreviewSha256": preview["previewSha256"]}
        saved = requests.command("installation-effort", case_id, "installation.save", effort_document)
        selected = ops.installation(case_id, installation_id, saved["revision"])
        if selected["sha256"] != saved["sha256"]:
            fail("The selected original effort edition changed.")
        report = selected["preview"]["report"]["effort"]
        totals = report["summary"]
        if (report.get("sourceKind") != "COMMERCIAL" or not report["readyForPlanning"]
                or totals["quotedHours"] is not None
                or totals["recordedHours"] != "42" or totals["acceptedHours"] != "18"
                or totals["reviewedRemainingHours"] != "30" or totals["projectedTotalHours"] != "72"):
            fail("The saved original engine output differs from the explicit example.")
        for key in ("quoteId", "quoteSha256", "acceptanceId", "acceptanceSha256"):
            if report["commercial"][key] != value["selected"][key]:
                fail("The selected effort report belongs to another accepted quotation.")
        archive_path = out / "original-commercial-effort.zip"
        try:
            archive = private_bytes(archive_path)
        except FileNotFoundError:
            archive = ops.export_installation(case_id, installation_id, saved["revision"])
            retain(archive_path, archive)
        # Export includes complete current case history. On retry keep its first
        # exact bytes and selected edition; do not export a different later state.
        archive_info = descriptor(archive_path, archive)
        result = {"schema": RESULT_SCHEMA, "state": "PREPARED",
            "classification": "INTERNAL_WALKTHROUGH", "operationId": value["operationId"],
            "createdAt": value["createdAt"], "inputSha256": input_sha,
            "operations": {"workspaceDirectory": str(workspace_dir), "sourcePath": str(scenario_file),
                           "caseId": case_id, "planId": plan["id"]},
            "merchantSource": descriptor(source_file, original_source),
            "selected": {"installationId": installation_id, "installationRevision": saved["revision"],
                         "installationSha256": selected["sha256"], "reportSha256": report["reportSha256"]},
            "initial": {"installationId": installation_id, "installationRevision": initial["revision"],
                        "installationSha256": initial_row["sha256"]},
            "archive": archive_info, "sourceId": source_id, "contributorId": contributor["recordId"],
            "work": work, "tasks": [{"taskId": row["phaseId"], "title": row["title"],
                                    "remainingHours": row["remainingHours"]} for row in report["phases"]],
            "totals": deepcopy(totals), "report": report,
            "meaning": LABEL + " Recorded, internally accepted and estimated hours are distinct. Costs and profit remain explicit economics inputs."}
    finally:
        workspace.close()
    verified = verify_effort(archive, archive_sha256=archive_info["sha256"],
        installation_id=installation_id, revision=saved["revision"],
        installation_sha256=selected["sha256"], report_sha256=report["reportSha256"])
    if (verified["originalCase"]["id"] != case_id or verified["originalCase"]["mode"] != "WALKTHROUGH"
            or verified["report"] != report):
        fail("The complete original ZIP receiver returned a different example.")
    result["reportFile"] = verified["reportFile"]
    # Reader verification is retained separately from stable operator output.
    retain(out / "original-receiving.json", encoded(verified))
    retain(out / "prepared.json", encoded(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--input-sha", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = prepare(Path(args.input), args.input_sha, Path(args.out))
    sys.stdout.write(canonical(result) + "\n")


if __name__ == "__main__":
    def cancelled(signum, frame):
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        raise RuntimeError("Internal commercial effort preparation was cancelled.")
    signal.signal(signal.SIGINT, cancelled)
    signal.signal(signal.SIGTERM, cancelled)
    main()
