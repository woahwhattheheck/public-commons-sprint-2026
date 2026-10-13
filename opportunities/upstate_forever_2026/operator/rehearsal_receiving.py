#!/usr/bin/env python3
"""Complete the actual rehearsal/receiving journey on an existing Workspace.

TokenJunkieLabs. Uses the original authenticated operator, retained task queue,
scientific backup/restore, and original file tickets. No scientific case is
invented. Only explicitly selected fresh_run_ids can start original calculations.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import zipfile

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "operator"))
from model.common import canonical, digest, file_digest, identifier, now, read_json, verify_file
from model.rehearsal import STEP_IDS
from rehearsal_cli import Client
from server import start_server

SCHEMA = "upstate.rehearsal-receiving-input/v1"
ACTIVE = {"queued", "running"}
ACTIONS = {"rehearsal.save", "rehearsal.begin", "rehearsal.record", "rehearsal.export",
           "run.start", "workspace.backup", "workspace.restore"}


def publish(path, body, *, immutable=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("A retained output is a symlink: " + str(path))
    if immutable and path.exists():
        if path.read_bytes() != body:
            raise ValueError("A retained complete output has different bytes: " + str(path))
        return path
    fd, name = tempfile.mkstemp(prefix=".rehearsal-complete-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(body); out.flush(); os.fsync(out.fileno())
        if immutable:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != body:
                    raise ValueError("A different output appeared: " + str(path))
        else:
            os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        return path
    finally:
        temporary.unlink(missing_ok=True)


def retain(path, value, *, immutable=True):
    publish(path, canonical(value) + b"\n", immutable=immutable)
    return value


def describe(path, root):
    path = Path(path)
    before = path.stat()
    result = {"path": path.relative_to(root).as_posix(), "bytes": before.st_size,
              "sha256": file_digest(path)}
    after = path.stat()
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, field) != getattr(after, field) for field in fields):
        raise ValueError("The retained output changed during its complete read: " + result["path"])
    return result


OUTPUT_FOLDERS = ("requests", "uploads", "results", "downloads", "browser")


def output_files(output):
    selected = {output / "input.json"}
    for folder in OUTPUT_FOLDERS:
        root = output / folder
        if not root.exists():
            continue
        if root.is_symlink() or not root.is_dir():
            raise ValueError("The retained output directory changed: " + folder)
        for path in root.rglob("*"):
            if "private" in path.relative_to(output).parts:
                continue
            if path.is_symlink():
                raise ValueError("The retained output is a file alias: " + str(path))
            if path.is_file():
                selected.add(path)
    return sorted(selected)


def retained_inventory(output):
    return {item["path"]: {"bytes": item["bytes"], "sha256": item["sha256"]}
            for item in (describe(path, output) for path in output_files(output))}


def check_descriptor(output, item):
    if not isinstance(item, dict):
        raise ValueError("Retain the complete original file descriptor")
    name = item.get("path")
    path = Path(name) if isinstance(name, str) else None
    if (path is None or not path.parts or path.is_absolute() or path.as_posix() != name
            or "\\" in name or ".." in path.parts or "private" in path.parts
            or isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int)
            or item["bytes"] < 0 or not re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", ""))):
        raise ValueError("The retained complete file descriptor differs")
    selected = output
    for part in path.parts:
        selected = selected / part
        if selected.is_symlink():
            raise ValueError("The original retained file became an alias: " + name)
    # This is the original complete native file verifier, including full SHA.
    return verify_file(output, item)


def verify_browser_files(output, result, operation_id, rehearsal_id, *, inventory=None, checked=None):
    if (not isinstance(result, dict) or result.get("schema") != "upstate.rehearsal-browser-result/v1"
            or result.get("state") != "COMPLETE" or result.get("operation_id") != operation_id
            or result.get("rehearsal_id") != rehearsal_id
            or not isinstance(result.get("files"), list) or not result["files"]):
        raise ValueError("Retain the complete original browser result and file closure")
    seen = {}
    for member in result["files"]:
        if not isinstance(member, dict) or not isinstance(member.get("path"), str):
            raise ValueError("The original browser file descriptor differs")
        item = {**member, "path": "browser/" + member["path"]}
        identity = {"bytes": item.get("bytes"), "sha256": item.get("sha256")}
        if item["path"] in seen and seen[item["path"]] != identity:
            raise ValueError("The browser file has conflicting original identities")
        seen[item["path"]] = identity
        if inventory is not None and inventory.get(item["path"]) != identity:
            raise ValueError("The saved complete closure omitted an original browser file: " + item["path"])
        if checked is None or checked.get(item["path"]) != identity:
            check_descriptor(output, item)
            if checked is not None:
                checked[item["path"]] = identity


def verify_checkpoint(output, value, operation_id, checked=None):
    if (not isinstance(value, dict) or value.get("state") != "COMPLETE"
            or value.get("operation_id") != operation_id):
        raise ValueError("Select the original complete checkpoint for this operation")
    identifier(value.get("rehearsal_id"))
    files = value.get("retained_files")
    if not isinstance(files, dict) or "input.json" not in files:
        raise ValueError("The checkpoint lacks its original complete file closure; preserve it and recover "
                         "the missing original descriptors before continuing this same operation")
    checked = {} if checked is None else checked
    for name, identity in files.items():
        if not isinstance(identity, dict) or set(identity) != {"bytes", "sha256"}:
            raise ValueError("The checkpoint file identity differs: " + name)
        if name in checked:
            if checked[name] != identity:
                raise ValueError("Two retained checkpoints disagree about original file bytes: " + name)
        else:
            check_descriptor(output, {"path": name, **identity})
            checked[name] = identity

    def bound(item):
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("The original checkpoint omitted a required file descriptor")
        expected = {"bytes": item.get("bytes"), "sha256": item.get("sha256")}
        if files.get(item["path"]) != expected:
            raise ValueError("The checkpoint file closure differs from its original descriptor: " + item["path"])
        return output / item["path"]

    schema = value.get("schema")
    if schema == "upstate.rehearsal-native-receiving/v1":
        bound(value.get("scientific_archive"))
        teaching = value.get("teaching_files")
        if not isinstance(teaching, list) or not teaching:
            raise ValueError("The original native checkpoint lacks its complete teaching files")
        for item in teaching:
            bound(item)
    elif schema == "upstate.rehearsal-receiving/v1":
        if value.get("programme_opening") is not None:
            bound(value["programme_opening"].get("receipt_file"))
        native_path = bound(value.get("native"))
        original = read_json(native_path)
        if original.get("rehearsal_id") != value["rehearsal_id"]:
            raise ValueError("The final checkpoint names another native rehearsal")
        verify_checkpoint(output, original, operation_id, checked)
        final_files = value.get("files") or {}
        bound(final_files.get("scientific_archive"))
        teaching = final_files.get("teaching")
        if not isinstance(teaching, list) or not teaching:
            raise ValueError("The final checkpoint lacks its complete teaching files")
        for item in teaching:
            bound(item)
        if value.get("browser") is not None:
            browser = read_json(bound(value["browser"]))
            verify_browser_files(output, browser, operation_id, value["rehearsal_id"],
                                 inventory=files, checked=checked)
        elif value.get("browser_state") != "NOT_CONFIGURED":
            raise ValueError("The original completed browser receipt is missing")
    else:
        raise ValueError("Select a maintained complete rehearsal checkpoint")
    return value


def validate(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Select the complete original rehearsal receiving input")
    expected = {"schema", "operation_id", "workspace_directory", "output_directory",
                "rehearsal", "fresh_run_ids", "step_notes", "task_timeout_seconds", "browser",
                "programme_receiving"}
    if set(value) - expected:
        raise ValueError("Unexpected receiving input fields: " + ", ".join(sorted(set(value) - expected)))
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", value.get("operation_id", "")):
        raise ValueError("Choose one retained receiving operation ID")
    for key in ("workspace_directory", "output_directory"):
        if not isinstance(value.get(key), str) or not Path(value[key]).is_absolute():
            raise ValueError(key + " must be an explicit absolute path")
    definition = value.get("rehearsal")
    if not isinstance(definition, dict) or set(definition) != {
            "title", "operator", "audience", "mode", "selection", "notes", "science_notes"}:
        raise ValueError("Supply the full saved teaching definition")
    if definition["mode"] not in {"recorded", "live"}:
        raise ValueError("Choose recorded or live mode explicitly")
    selected = [definition["selection"].get("baseline_run_id")] + definition["selection"].get("alternative_run_ids", [])
    fresh = value.get("fresh_run_ids", [])
    if not isinstance(fresh, list) or len(set(fresh)) != len(fresh):
        raise ValueError("Fresh calculations must be distinct explicitly selected original runs")
    if fresh and definition["mode"] != "live":
        raise ValueError("Explicit fresh run requests require live teaching mode")
    for key in fresh:
        if identifier(key) not in selected:
            raise ValueError("A fresh run must belong to this saved teaching selection")
    if not isinstance(value.get("step_notes", {}), dict) or set(value.get("step_notes", {})) - set(STEP_IDS):
        raise ValueError("Use the nine maintained teaching-step names")
    timeout = value.get("task_timeout_seconds", 7200)
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 604800:
        raise ValueError("Choose an explicit task waiting interval from 1 second to 7 days")
    browser = value.get("browser")
    if browser is not None:
        if not isinstance(browser, dict) or set(browser) != {"node", "playwright_module", "executable"}:
            raise ValueError("Browser configuration uses the three existing native runtime paths")
        for key, path in browser.items():
            if not isinstance(path, str) or not Path(path).is_absolute():
                raise ValueError("Use an existing absolute browser/runtime path: " + key)
    if "programme_receiving" in value:
        choice = value["programme_receiving"]
        if not isinstance(choice, dict) or set(choice) != {"path", "bytes", "sha256", "programme_id"}:
            raise ValueError("Select the complete frozen Programme adoption descriptor")
        identifier(choice["programme_id"])
        name = choice.get("path")
        if (not isinstance(name, str) or not name or "\\" in name
                or Path(name).is_absolute() or any(part in ("", ".", "..") for part in name.split("/"))
                or isinstance(choice["bytes"], bool) or not isinstance(choice["bytes"], int)
                or choice["bytes"] <= 0 or not re.fullmatch(r"[0-9a-f]{64}", str(choice["sha256"]))):
            raise ValueError("Use the original Workspace-relative Programme adoption path and digest")
    return value


@contextmanager
def operator_session(value, output):
    server = thread = None
    started = False
    connection_file = output / "private" / "operator-connection.json"
    address_file = output / "private" / "operator-address.json"
    address = read_json(address_file) if address_file.exists() else None
    if address is not None:
        if (set(address) != {"schema", "operation_id", "port"}
                or address["schema"] != "upstate.rehearsal-loopback-address/v1"
                or address["operation_id"] != value["operation_id"]
                or isinstance(address["port"], bool) or not isinstance(address["port"], int)
                or not 1 <= address["port"] <= 65535):
            raise ValueError("The retained original loopback address differs")
    try:
        server, receipt = start_server(
            value["workspace_directory"], state_directory=output / "operator-state",
            restore_directory=output / "received", create=False,
            port=address["port"] if address else 0)
        if address is None:
            retain(address_file, {"schema": "upstate.rehearsal-loopback-address/v1",
                                  "operation_id": value["operation_id"],
                                  "port": server.server_address[1]})
        # Reuse this exact origin so the original browser profile can reopen its
        # pending IndexedDB requests after an interrupted operator process.
        thread = threading.Thread(target=server.serve_forever,
                                  kwargs={"poll_interval": .2}, daemon=True)
        thread.start()
        started = True
        publish(connection_file, canonical(receipt) + b"\n", immutable=False)
        os.chmod(connection_file, 0o600)
        yield server, Client(connection_file), connection_file
    finally:
        if server is not None:
            if started:
                server.shutdown()
            server.server_close()
            if started:
                thread.join()
            server.operator.close()
        # This private live capability is deliberately excluded from delivery.
        connection_file.unlink(missing_ok=True)


class Journey:
    def __init__(self, value, output, client, *, resolutions=None, resumes=()):
        self.value, self.output, self.client = value, output, client
        self.resolutions, self.resumes = resolutions or {}, set(resumes)
        self.tasks = {}

    def state(self, workspace):
        return self.client.json("/api/state?" + urllib.parse.urlencode({"workspace": workspace}))

    def current(self, workspace, key, revision=None):
        query = {"workspace": workspace, "id": key}
        if revision is not None:
            query["revision"] = revision
        return self.client.json("/api/rehearsals/record?" + urllib.parse.urlencode(query))

    @staticmethod
    def matches(task, request):
        selected = {k: request[k] for k in ("workspace", "action", "payload")}
        return (task.get("schema") == "upstate.operator-task/v1"
                and {k: task.get(k) for k in selected} == selected
                and task.get("request_sha256") == digest(selected)
                and task.get("id") == digest({"workspace": task.get("workspace"),
                                             "operation_id": task.get("operation_id")}))

    @staticmethod
    def census_row(task):
        return {name: deepcopy(task.get(name)) for name in (
            "id", "state", "created_at", "started_at", "ended_at", "attempts")}

    @staticmethod
    def possible_coalesced(task, before):
        original = before.get(task["id"])
        if original is None or original["state"] in ACTIVE:
            return True
        # The maintained resume first changes a failed/interrupted/cancelled
        # task to queued; the worker then appends its actual new attempt.
        if task["state"] in ACTIVE:
            return True
        old_attempts, attempts = original.get("attempts"), task.get("attempts")
        if (isinstance(old_attempts, list) and isinstance(attempts, list)
                and len(attempts) > len(old_attempts)
                and attempts[:len(old_attempts)] == old_attempts):
            return True
        return bool(task.get("started_at") and task.get("started_at") != original.get("started_at"))

    def execute(self, phase, workspace, action, payload):
        if action not in ACTIONS or not re.fullmatch(r"[a-z0-9-]{1,100}", phase):
            raise ValueError("Select a maintained complete programme phase")
        folder = self.output / "requests" / phase
        path = folder / "request.json"
        if path.exists():
            request = read_json(path)
            if request["workspace"] != workspace or request["action"] != action:
                raise ValueError("The retained phase belongs to another native action")
            # Full earlier payload, including the original expected revision, owns replay.
        else:
            request = {"workspace": workspace, "action": action, "payload": deepcopy(payload()),
                       "operation_id": digest({"operation": self.value["operation_id"], "phase": phase})}
            retain(path, request)
        state = self.state(workspace)
        census = state["tasks"]
        before_file = folder / "before.json"
        if before_file.exists():
            before = read_json(before_file)
        else:
            before = retain(before_file, {"tasks": [
                self.census_row(task) for task in census if self.matches(task, request)]})
        binding_file = folder / "task.json"
        selected = read_json(binding_file)["id"] if binding_file.exists() else None
        own = digest({"workspace": workspace, "operation_id": request["operation_id"]})
        own_tasks = [task for task in census if task.get("id") == own]
        if own_tasks:
            if len(own_tasks) != 1 or not self.matches(own_tasks[0], request):
                raise ValueError("The exact original operation ID has a different native input")
            selected = own
        if selected:
            task = self.client.task(selected)
            if not self.matches(task, request):
                raise ValueError("The retained actual task no longer matches its complete original request")
        else:
            attempted = (folder / "dispatch.json").exists()
            before_tasks = {x["id"]: x for x in before["tasks"]}
            possible = [t for t in census if self.matches(t, request)
                        and self.possible_coalesced(t, before_tasks)]
            resolution = self.resolutions.get(phase)
            if resolution:
                candidates = [t for t in possible if t["id"] == identifier(resolution)]
                if len(candidates) != 1:
                    raise ValueError("Select one actual matching retained task for " + phase)
                task = candidates[0]
                retain(folder / "resolution.json", {"id": task["id"], "request_sha256": task["request_sha256"]})
            elif attempted and len(possible) == 1:
                task = possible[0]
            elif attempted and len(possible) > 1:
                retain(folder / ("ambiguous-" + digest(possible) + ".json"), {"tasks": possible})
                raise ValueError("Multiple actual matching tasks remain for " + phase +
                                 "; inspect the retained census and use --resolve " + phase + "=TASK_ID")
            else:
                dispatch_path = folder / "dispatch.json"
                if dispatch_path.exists():
                    if read_json(dispatch_path)["request_sha256"] != digest(request):
                        raise ValueError("The original attempted request bytes changed")
                else:
                    retain(dispatch_path, {"request_sha256": digest(request), "first_dispatch_at": now()})
                task = self.client.json("/api/actions", request)
                retain(folder / ("response-" + digest(task) + ".json"), task)
                if not self.matches(task, request):
                    raise ValueError("The original operator returned a different complete action input")
            selected = task["id"]
        retain(binding_file, {"id": selected, "operation_id": task["operation_id"],
                              "request_sha256": task["request_sha256"], "request": request})
        if task["state"] in {"failed", "interrupted", "cancelled"}:
            if phase not in self.resumes:
                retain(folder / ("terminal-" + digest(task) + ".json"), task)
                raise ValueError("Original task " + selected + " is " + task["state"] +
                                 ". Inspect its retained error; resume this same phase with --resume " + phase)
            task = self.client.json("/api/task/resume", {"id": selected})
            if not self.matches(task, request):
                raise ValueError("Original task resume changed the frozen action")
        deadline = time.monotonic() + self.value.get("task_timeout_seconds", 7200)
        while task["state"] in ACTIVE:
            if time.monotonic() >= deadline:
                retain(folder / ("waiting-" + digest(task) + ".json"), task)
                raise TimeoutError("The original task remains " + task["state"] + ": " + selected)
            time.sleep(.25)
            task = self.client.task(selected)
            if not self.matches(task, request):
                raise ValueError("An active native task changed its original request binding")
        retain(folder / ("terminal-" + digest(task) + ".json"), task)
        if task["state"] != "complete":
            raise ValueError("Original task failed in " + phase + ": " + json.dumps(task.get("error", task)))
        self.tasks[phase] = {"id": selected, "action": action, "workspace": workspace,
                             "operation_id": task["operation_id"], "request_sha256": task["request_sha256"],
                             "attempts": task.get("attempts", []), "result": task["result"]}
        print(json.dumps({"phase": phase, "task_id": selected, "state": "complete"}), flush=True)
        return task

    def replay(self, phase):
        folder = self.output / "requests" / phase
        frozen = read_json(folder / "request.json")
        binding = read_json(folder / "task.json")
        original = self.client.task(binding["id"])
        if (original["state"] != "complete" or not self.matches(original, frozen)
                or original["operation_id"] != binding["operation_id"]):
            raise ValueError("Select the completed actual original task before replay")
        # Coalescing does not create a server-side alias for the unused submitted
        # operation ID. Replay the exact accepted task envelope, never that
        # unregistered alias after its matching task has become terminal.
        request = {name: deepcopy(original[name])
                   for name in ("workspace", "action", "payload", "operation_id")}
        retain(folder / "replay-request.json", {
            "request": request, "submitted_request": frozen,
            "task_id": original["id"], "meaning": "Literal replay of the original accepted native task"})
        response = self.client.json("/api/actions", request)
        retain(folder / ("replay-response-" + digest(response) + ".json"), response)
        if (not self.matches(response, request) or response["id"] != original["id"]
                or response["state"] != "complete" or response.get("result") != original.get("result")):
            raise ValueError("Literal native replay changed the original complete task result")
        return response

    def upload(self, path, phase, media="application/zip"):
        path = Path(path)
        identity = {"filename": path.name, "media_type": media,
                    "bytes": path.stat().st_size, "sha256": file_digest(path)}
        key = digest({k: identity[k] for k in ("sha256", "filename", "media_type")})
        folder = self.output / "uploads" / phase
        retain(folder / "input.json", identity)
        receipt_path = folder / "receipt.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["id"] != key or receipt["bytes"] != identity["bytes"] or receipt["sha256"] != identity["sha256"]:
                raise ValueError("The retained original upload receipt differs")
            return receipt
        connection = http.client.HTTPConnection("127.0.0.1", self.client.port, timeout=120)
        try:
            with path.open("rb") as source:
                connection.request("POST", "/api/upload", body=source, headers={
                    "Authorization": "Bearer " + self.client.token, "Content-Type": media,
                    "Content-Length": str(identity["bytes"]),
                    "X-Upload-Filename": urllib.parse.quote(path.name, safe="")})
                response = connection.getresponse()
                raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("Original upload receipt exceeds the complete metadata capacity")
            receipt = json.loads(raw)
            if response.status != 201:
                raise ValueError("Original upload refused: " + str(response.status) + " " + str(receipt))
            if (receipt.get("id") != key or receipt.get("sha256") != identity["sha256"]
                or receipt.get("bytes") != identity["bytes"] or receipt.get("filename") != path.name
                or receipt.get("mime_type") != media):
                raise ValueError("Original upload did not retain these exact complete bytes")
            retain(receipt_path, receipt)
            return receipt
        finally:
            connection.close()

    def files(self, task, folder):
        actual = self.client.task(task["id"])
        if actual["state"] != "complete" or actual["result"] != task["result"]:
            raise ValueError("The completed native download selection changed")
        tickets = actual.get("_downloads", [])
        if not tickets:
            raise ValueError("The original task has no complete download tickets")
        result = []
        names = set()
        for item in tickets:
            if item["filename"] in names:
                raise ValueError("Duplicate original download filename")
            names.add(item["filename"])
            destination = self.output / "downloads" / folder / item["filename"]
            self.client.download(item, destination)
            result.append({**describe(destination, self.output), "ticket_id": item["id"],
                           "filename": item["filename"]})
        return result


def verify_packet(path):
    with zipfile.ZipFile(path) as packet:
        names = packet.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate teaching packet members")
        manifest = json.loads(packet.read("MANIFEST.json"))
        if manifest.get("schema") != "upstate.operator-rehearsal-packet/v1":
            raise ValueError("Select the complete original teaching packet")
        if set(names) != set(manifest["members"]) | {"MANIFEST.json"}:
            raise ValueError("Teaching packet inventory differs")
        for name, expected in manifest["members"].items():
            h, count = hashlib.sha256(), 0
            with packet.open(name) as member:
                for block in iter(lambda: member.read(1024 * 1024), b""):
                    h.update(block); count += len(block)
            if count != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                raise ValueError("Teaching packet original member changed: " + name)
        record = json.loads(packet.read("rehearsal.json"))
        history = json.loads(packet.read("history.json"))
        if record != history[-1] or len(history) != record["revision"]:
            raise ValueError("Teaching packet history does not end at the selected revision")
        return manifest


def native(journey):
    value, sender = journey.value, journey.client.workspace
    created = journey.execute("create", sender, "rehearsal.save", lambda: value["rehearsal"])
    current = created["result"]
    key = current["id"]
    initial_project = journey.state(sender)["data"]["project"]
    selected_tasks = {}
    for step_id in STEP_IDS[:-1]:
        begin = journey.execute("begin-" + step_id, sender, "rehearsal.begin", lambda: {
            "id": key, "expected_revision": current["revision"], "step_id": step_id,
            "note": "Open and inspect the exact selected " + step_id + " evidence."})
        current = begin["result"]
        tasks = []
        if step_id == "calculation":
            for run_id in value.get("fresh_run_ids", []):
                run_task = journey.execute("calculate-" + run_id, sender, "run.start",
                                           lambda run_id=run_id: {"run_id": run_id})
                tasks.append(run_task["id"])
        observed = journey.current(sender, key)
        live = next(row for row in observed["live"]["steps"] if row["id"] == step_id)
        note = value.get("step_notes", {}).get(step_id) or (
            "Inspected the original selected evidence." if live["ready"] else
            "Deferred: " + "; ".join(live["missing"]))
        recorded = journey.execute("record-" + step_id, sender, "rehearsal.record", lambda: {
            "id": key, "expected_revision": current["revision"], "step_id": step_id,
            "outcome": "observed" if live["ready"] else "deferred", "task_ids": tasks,
            "upload_ids": [], "note": note})
        current = recorded["result"]
        selected_tasks[step_id] = {"begin": begin["id"], "record": recorded["id"]}
    begun = journey.execute("begin-transfer", sender, "rehearsal.begin", lambda: {
        "id": key, "expected_revision": current["revision"], "step_id": "transfer",
        "note": "Freeze this exact active teaching revision in the original scientific archive."})
    current = begun["result"]
    backup = journey.execute("transfer-backup", sender, "workspace.backup",
                             lambda: {"include_intermediates": True})
    copied = journey.files(backup, "active-transfer")
    if len(copied) != 1:
        raise ValueError("Original backup must supply one complete archive")
    upload = journey.upload(journey.output / copied[0]["path"], "active-transfer")
    restored = journey.execute("transfer-restore", sender, "workspace.restore",
                               lambda: {"upload_id": upload["id"]})
    receiver = restored["result"]["workspace_key"]
    if receiver == sender or restored["result"].get("identity") != "MATCH":
        raise ValueError("The original native receiver did not open an independent matching project")
    received = journey.current(receiver, key)["record"]
    if received != current:
        raise ValueError("The independent receiver changed the exact active teaching revision")
    finished = journey.execute("record-transfer", sender, "rehearsal.record", lambda: {
        "id": key, "expected_revision": current["revision"], "step_id": "transfer",
        "outcome": "observed", "task_ids": [backup["id"], restored["id"]], "upload_ids": [],
        "note": "Opened the independent original receiving Workspace and matched the entire active rehearsal revision."})
    sender_record = finished["result"]
    # The receiving copy starts at the exact pre-completion edition. Close its
    # copied active step explicitly, then retain an independent operator note.
    receiver_closed = journey.execute("receiver-close-active", receiver, "rehearsal.record", lambda: {
        "id": key, "expected_revision": received["revision"], "step_id": "transfer",
        "outcome": "deferred", "task_ids": [], "upload_ids": [],
        "note": "This receiving copy contains the original sender's active transfer record. Its transfer is not a new receiving-side backup; I am closing that copied attempt before a local note."})
    received = receiver_closed["result"]
    definition = {name: deepcopy(received[name]) for name in (
        "title", "operator", "audience", "mode", "selection", "notes", "science_notes")}
    definition["notes"] += "\nIndependent receiving operator note: the original project and saved teaching history reopened here."
    receiver_note = journey.execute("receiver-note", receiver, "rehearsal.save", lambda: {
        **definition, "id": key, "expected_revision": received["revision"]})
    exported = journey.execute("export-native", sender, "rehearsal.export", lambda: {
        "id": key, "revision": sender_record["revision"]})
    files = journey.files(exported, "native-walkthrough")
    selected_packet = [item for item in files if item["filename"] == "operator-walkthrough.zip"]
    if len(selected_packet) != 1:
        raise ValueError("The native teaching export lacks its original full packet")
    packet = verify_packet(journey.output / selected_packet[0]["path"])
    # Literal same requests replay after later sender and receiver editions.
    replay_create = journey.replay("create")
    replay_restore = journey.replay("transfer-restore")
    if replay_create["result"] != created["result"] or replay_restore["result"] != restored["result"]:
        raise ValueError("Original native request replay changed its saved result")
    latest_sender = journey.current(sender, key)["record"]
    latest_receiver = journey.current(receiver, key)["record"]
    if latest_sender != sender_record or latest_receiver != receiver_note["result"]:
        raise ValueError("Replay displaced the actual current sender or receiving rehearsal")
    if journey.state(receiver)["data"]["project"]["id"] != initial_project["id"]:
        raise ValueError("Receiving changed the original scientific project identity")
    result = {
        "schema": "upstate.rehearsal-native-receiving/v1", "state": "COMPLETE",
        "operation_id": value["operation_id"], "project": initial_project,
        "rehearsal_id": key, "sender_workspace": sender, "receiver_workspace": receiver,
        "sender": sender_record, "receiver": latest_receiver,
        "transferred_revision": current["revision"], "transferred_record_sha256": current["record_sha256"],
        "scientific_archive": copied[0], "teaching_files": files, "teaching_packet": packet,
        "tasks": deepcopy(journey.tasks),
        "meaning": "The selected original scientific evidence was inspected, every teaching step was recorded or explicitly deferred, and the exact saved rehearsal received through the original full Workspace archive. Native model completion is represented by each step's actual evidence and outcome.",
    }
    result["retained_files"] = retained_inventory(journey.output)
    return retain(journey.output / "results" / "native.json", result)


def bundle(output, complete):
    verify_checkpoint(output, complete, complete["operation_id"])
    selected = output_files(output)
    manifest = {"schema": "upstate.rehearsal-complete-delivery/v1",
                "operation_id": complete["operation_id"], "rehearsal_id": complete["rehearsal_id"],
                "files": {path.relative_to(output).as_posix(): {
                    "bytes": path.stat().st_size, "sha256": file_digest(path)}
                    for path in sorted(selected)},
                "meaning": "Complete original scientific and teaching archives, native/browser receipts, exact queued requests, and receiving records. Live connection capabilities and operator-state credentials are excluded."}
    manifest_bytes = canonical(manifest) + b"\n"
    name = "rehearsal-delivery-" + hashlib.sha256(manifest_bytes).hexdigest() + ".zip"
    destination = output / name
    if not destination.exists():
        fd, temporary_name = tempfile.mkstemp(prefix=".rehearsal-delivery-", dir=output)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "wb") as raw:
                with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as z:
                    z.writestr("DELIVERY.json", manifest_bytes)
                    for path in sorted(selected):
                        z.write(path, path.relative_to(output).as_posix())
                raw.flush(); os.fsync(raw.fileno())
            os.link(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
    with zipfile.ZipFile(destination) as z:
        if z.read("DELIVERY.json") != manifest_bytes or set(z.namelist()) != set(manifest["files"]) | {"DELIVERY.json"}:
            raise ValueError("The complete retained delivery differs")
        for name, expected in manifest["files"].items():
            h, count = hashlib.sha256(), 0
            with z.open(name) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(block); count += len(block)
            if count != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                raise ValueError("The retained complete delivery member differs: " + name)
    return describe(destination, output)


def _programme_source(operator, workspace_key, value):
    choice = value.get("programme_receiving")
    if choice is None:
        return None
    ws = operator.ws(workspace_key)
    adopted = read_json(verify_file(ws.root, choice))
    if (adopted.get("schema") != "upstate.simulated-programme-receiving/v1"
            or adopted.get("programme_id") != choice["programme_id"]
            or adopted.get("project_id") != ws.project["id"]):
        raise ValueError("The selected Programme opening belongs to another original case")
    selected = value["rehearsal"]["selection"]
    if ([row["run_id"] for row in adopted["native_runs"]] !=
            [selected["baseline_run_id"], *selected["alternative_run_ids"]]
            or adopted.get("existing_delivery_id") != selected["delivery_id"]):
        raise ValueError("The Programme opening differs from this rehearsal's native selection")
    return adopted


def _save_programme_opening(operator, workspace_key, value, output):
    adopted = _programme_source(operator, workspace_key, value)
    if adopted is None:
        return None
    from source_tools.adopt_simulated_headwaters_programme import save_operator_opening
    result = save_operator_opening(operator, workspace_key, adopted)
    path = output / "results" / ("programme-opening-" + digest(result) + ".json")
    retain(path, result)
    return {**result, "receipt_file": describe(path, output)}


def _verify_programme_opening(operator, workspace_key, value, opening):
    if value.get("programme_receiving") is None:
        if opening is not None:
            raise ValueError("An unselected Programme opening was added to the rehearsal")
        return None
    adopted = _programme_source(operator, workspace_key, value)
    if (not isinstance(opening, dict)
            or opening.get("programme_id") != adopted["programme_id"]
            or opening.get("opening_id") != adopted["operator_opening"]["id"]):
        raise ValueError("Retain the exact original Programme opening receipt")
    ws = operator.ws(workspace_key)
    selected = read_json(verify_file(ws.root, opening["operator_session_file"]))
    if (selected != opening["operator_session"]
            or operator.operator_session(workspace_key) != selected
            or selected["journey"]["selection"] != adopted["operator_opening"]["journey"]["selection"]):
        raise ValueError("The restored operator opening differs from its original saved view")
    return opening


def run_browser_child(command, output):
    """Close the original browser cooperatively before stopping its process group."""
    child = subprocess.Popen(command, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = child.communicate()
    except BaseException as error:
        receipt = {"state": "INTERRUPTED", "requested_signal": "SIGTERM",
                   "grace_seconds": 30, "escalated": False,
                   "error": {"type": type(error).__name__, "message": str(error)}}
        stdout = stderr = ""
        try:
            if child.poll() is None:
                child.terminate()
            try:
                stdout, stderr = child.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                receipt["escalated"] = True
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                stdout, stderr = child.communicate(timeout=10)
        except BaseException as stop_error:
            receipt["stop_error"] = {"type": type(stop_error).__name__,
                                     "message": str(stop_error)}
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError as kill_error:
                receipt["kill_error"] = str(kill_error)
            try:
                child.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired) as wait_error:
                receipt["wait_error"] = str(wait_error)
        receipt.update(returncode=child.poll(), stdout=stdout or "", stderr=stderr or "")
        try:
            retain(output / "results" / ("browser-stop-" + digest(receipt) + ".json"), receipt)
        except OSError as save_error:
            if hasattr(error, "add_note"):
                error.add_note("Browser interruption receipt could not be saved: " + str(save_error))
        raise
    return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)


def run(input_path, *, resolutions=None, resumes=(), skip_browser=False):
    value = validate(read_json(input_path))
    output = Path(value["output_directory"]).resolve()
    workspace = Path(value["workspace_directory"]).resolve(strict=True)
    if output == workspace or workspace in output.parents or output in workspace.parents:
        raise ValueError("Keep the original Workspace and receiving programme output in separate directories")
    output.mkdir(parents=True, exist_ok=True)
    with (output / ".journey.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        retain(output / "input.json", value)
        complete_path = output / "results" / "complete.json"
        native_path = output / "results" / "native.json"
        saved_complete = read_json(complete_path) if complete_path.exists() else None
        saved_native = read_json(native_path) if native_path.exists() else None
        if saved_complete is not None:
            verify_checkpoint(output, saved_complete, value["operation_id"])
        elif saved_native is not None:
            verify_checkpoint(output, saved_native, value["operation_id"])
        with operator_session(value, output) as (server, client, connection_file):
            journey = Journey(value, output, client, resolutions=resolutions, resumes=resumes)
            if saved_complete is not None:
                complete = saved_complete
                for name in ("sender", "receiver", "earlier_receiver"):
                    current = journey.current(complete[name]["workspace"], complete["rehearsal_id"])["record"]
                    retained = complete[name]
                    if current["revision"] < retained["revision"]:
                        raise ValueError("The completed working copy lost retained teaching history")
                    original = journey.current(retained["workspace"], complete["rehearsal_id"], retained["revision"])["record"]
                    if original["record_sha256"] != retained["record_sha256"]:
                        raise ValueError("The original completed teaching revision changed")
                retain(output / "results" / "reopened.json", {
                    "schema": "upstate.rehearsal-reopened/v1", "operation_id": value["operation_id"],
                    "rehearsal_id": complete["rehearsal_id"], "sender": complete["sender"],
                    "receiver": complete["receiver"], "earlier_receiver": complete["earlier_receiver"],
                    "state": "COMPLETE"})
                _verify_programme_opening(server.operator, complete["receiver"]["workspace"],
                                          value, complete.get("programme_opening"))
                return {**complete, "delivery": bundle(output, complete), "reopened": True}
            if saved_native is not None:
                original = saved_native
                for name, field in (("sender", "sender_workspace"), ("receiver", "receiver_workspace")):
                    retained = original[name]
                    current = journey.current(original[field], original["rehearsal_id"], retained["revision"])["record"]
                    if current != retained:
                        raise ValueError("The retained original native phase changed")
            else:
                original = native(journey)
            programme_opening = _save_programme_opening(
                server.operator, original["sender_workspace"], value, output)
            browser_result = None
            browser = value.get("browser")
            if browser and not skip_browser:
                config = {"schema": "upstate.rehearsal-browser-input/v1",
                          "operation_id": value["operation_id"], "connection_file": str(connection_file),
                          "rehearsal_id": original["rehearsal_id"], "sender_workspace": original["sender_workspace"],
                          "receiver_workspace": original["receiver_workspace"],
                          "output_directory": str(output / "browser"),
                          "playwright_module": browser["playwright_module"], "executable": browser["executable"]}
                browser_input = output / "private" / "browser-input.json"
                publish(browser_input, canonical(config) + b"\n", immutable=False)
                child = run_browser_child([browser["node"], str(APP / "operator" / "rehearsal_browser.mjs"),
                                           str(browser_input)], output)
                receipt = {"returncode": child.returncode, "stdout": child.stdout, "stderr": child.stderr}
                retain(output / "results" / ("browser-process-" + digest(receipt) + ".json"), receipt)
                if child.returncode:
                    raise ValueError("Original browser journey exited " + str(child.returncode) +
                                     "; its complete output is retained beside the native checkpoint")
                browser_result = read_json(output / "browser" / "result.json")
                verify_browser_files(output, browser_result, value["operation_id"], original["rehearsal_id"])
            elif browser and skip_browser:
                return {**original, "browser_state": "NOT_RUN", "meaning": "Native phase is retained. Reuse the same command without --native-only for the configured browser continuation."}
            # Preserve the original selected opening in the final scientific copy,
            # including after the browser exercised other actual views.
            programme_opening = _save_programme_opening(
                server.operator, original["sender_workspace"], value, output)
            current = journey.current(original["sender_workspace"], original["rehearsal_id"])["record"]
            retain(output / "results" / "final-selection.json", current)
            final_export = journey.execute("export-final", original["sender_workspace"], "rehearsal.export", lambda: {
                "id": current["id"], "revision": current["revision"]})
            if final_export["result"]["record_sha256"] != current["record_sha256"]:
                raise ValueError("The current rehearsal differs from the original frozen final export")
            final_files = journey.files(final_export, "final-walkthrough")
            final_backup = journey.execute("backup-final", original["sender_workspace"], "workspace.backup",
                                           lambda: {"include_intermediates": True})
            final_archive = journey.files(final_backup, "final-scientific")
            if len(final_archive) != 1:
                raise ValueError("The final original backup must be one complete archive")
            uploaded = journey.upload(output / final_archive[0]["path"], "final-scientific")
            final_restore = journey.execute("restore-final", original["sender_workspace"], "workspace.restore",
                                            lambda: {"upload_id": uploaded["id"]})
            final_receiver = final_restore["result"]["workspace_key"]
            _verify_programme_opening(server.operator, final_receiver, value, programme_opening)
            received = journey.current(final_receiver, current["id"])["record"]
            if received != current:
                raise ValueError("The final scientific receiving copy lacks the complete current walkthrough and media")
            prior_receiver = journey.current(original["receiver_workspace"], current["id"])["record"]
            if prior_receiver != original["receiver"]:
                raise ValueError("The later receiving operation displaced the earlier independent receiving note")
            complete = {
                "schema": "upstate.rehearsal-receiving/v1", "state": "COMPLETE",
                "operation_id": value["operation_id"], "rehearsal_id": current["id"],
                "project_id": original["project"]["id"],
                "native": describe(native_path, output),
                "programme_opening": programme_opening,
                "browser": describe(output / "browser" / "result.json", output) if browser_result else None,
                "browser_state": "COMPLETE" if browser_result else "NOT_CONFIGURED",
                "sender": {"workspace": original["sender_workspace"], "revision": current["revision"],
                           "record_sha256": current["record_sha256"]},
                "receiver": {"workspace": final_receiver, "revision": received["revision"],
                             "record_sha256": received["record_sha256"]},
                "earlier_receiver": {"workspace": original["receiver_workspace"],
                    "revision": prior_receiver["revision"], "record_sha256": prior_receiver["record_sha256"]},
                "files": {"scientific_archive": final_archive[0], "teaching": final_files},
                "meaning": "The complete actual rehearsal and original Workspace were exported, downloaded, received and reopened. Each selected scientific result retains its actual state; deferred steps are not scientific success claims.",
            }
            complete["retained_files"] = retained_inventory(output)
            retain(complete_path, complete)
        # Reopen the original operator and registry after closing all original tasks.
        with operator_session(value, output) as (server, client, connection_file):
            reopened = Journey(value, output, client)
            _verify_programme_opening(server.operator, complete["receiver"]["workspace"],
                                      value, complete.get("programme_opening"))
            for name in ("sender", "receiver", "earlier_receiver"):
                expected = complete[name]
                record = reopened.current(expected["workspace"], complete["rehearsal_id"])["record"]
                if record["revision"] != expected["revision"] or record["record_sha256"] != expected["record_sha256"]:
                    raise ValueError("The actual operator reopen changed a saved teaching edition")
            retain(output / "results" / "reopened.json", {
                "schema": "upstate.rehearsal-reopened/v1", "operation_id": value["operation_id"],
                "rehearsal_id": complete["rehearsal_id"],
                "sender": complete["sender"], "receiver": complete["receiver"],
                "earlier_receiver": complete["earlier_receiver"], "state": "COMPLETE"})
        return {**complete, "delivery": bundle(output, complete), "reopened": True}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--resolve", action="append", default=[], metavar="PHASE=TASK_ID")
    p.add_argument("--resume", action="append", default=[], metavar="PHASE")
    p.add_argument("--native-only", action="store_true", help="Retain the native phase before the already configured browser continuation")
    args = p.parse_args()
    resolutions = {}
    for item in args.resolve:
        phase, sep, key = item.partition("=")
        if not sep or phase in resolutions:
            p.error("Use one --resolve PHASE=TASK_ID for an actual ambiguous retained task")
        resolutions[phase] = identifier(key)
    try:
        result = run(args.input, resolutions=resolutions, resumes=args.resume, skip_browser=args.native_only)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except BaseException as error:
        try:
            value = read_json(args.input)
            output = Path(value["output_directory"])
            receipt = {"schema": "upstate.rehearsal-receiving-failure/v1", "operation_id": value.get("operation_id"),
                       "type": type(error).__name__, "message": str(error), "at": now()}
            retain(output / "results" / ("failure-" + digest(receipt) + ".json"), receipt)
        except BaseException:
            pass
        raise


if __name__ == "__main__":
    main()
