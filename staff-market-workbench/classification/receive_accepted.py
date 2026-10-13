#!/usr/bin/env python3
"""Receive complete accepted classification exports and deliver a native backup.

This caller uses the installed Workspace mutation/read/backup/restore APIs.
It retains every original request before mutation and reopens the same result.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import errno
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import core
from core import Workspace, initialize, restore, digest, stable
from classification import engine, host, receiving

SCHEMA = "staff-market.accepted-package-journey/v1"


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def checked_bytes(path, maximum=160 * 1024 * 1024):
    path = Path(path)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise ValueError("Read a complete bounded original file: " + str(path))
        before = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        current = path.stat(follow_symlinks=False)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        if len(raw) != info.st_size or identity(after) != before or identity(current) != before:
            raise ValueError("The selected file changed during reading: " + str(path))
    return raw


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_bytes(path, raw, *, immutable=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if immutable and (path.exists() or path.is_symlink()):
        if checked_bytes(path) != raw:
            raise ValueError("Retain the original completed bytes: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            try:
                os.link(name, path)
            except FileExistsError:
                if checked_bytes(path) != raw:
                    raise ValueError("The original retained output differs: " + str(path))
        else:
            os.replace(name, path)
        sync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def read_json(path):
    return json.loads(checked_bytes(path).decode("utf-8"))


def write_json(path, value, *, immutable=True):
    write_bytes(path, json_bytes(value), immutable=immutable)


def descriptor(path):
    raw = checked_bytes(path)
    return {"path": str(Path(path).resolve()), "bytes": len(raw), "sha256": digest(raw)}


def runtime_sources():
    sources = {
        "core.py": Path(core.__file__),
        "classification/engine.py": Path(engine.__file__),
        "classification/host.py": Path(host.__file__),
        "classification/receiving.py": Path(receiving.__file__),
        "classification/receive_accepted.py": Path(__file__),
    }
    return {name: {"bytes": len(raw), "sha256": digest(raw)}
            for name, path in sources.items() for raw in [checked_bytes(path)]}


def source_members(raw, filename):
    if raw.startswith(b"PK"):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            # Original receiving admission validates all member paths, types,
            # count, expansion limits, signatures and exact source relationships.
            return {entry.filename: archive.read(entry) for entry in archive.infolist()}
    return {filename: raw}


def compare_result(old, current):
    # A replay reports the workspace's present revision separately from the
    # immutable revision at which this original operation committed.
    if (type(old.get("operation_revision")) is not int
            or type(current.get("operation_revision")) is not int
            or old["operation_revision"] != current["operation_revision"]
            or stable(old.get("result")) != stable(current.get("result"))):
        raise ValueError("The native original operation returned a different result")


def publish_directory(stage, target):
    # Linux's create-only rename leaves any concurrently created target intact.
    # Both directories share a parent and therefore the same filesystem.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise OSError(errno.ENOSYS, "Create-only directory publication requires renameat2")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(target), 1) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number), str(target))
    sync_directory(target.parent)


def initialized_metadata(path, *, fresh=False):
    info = Path(path).lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("Retain the selected native workspace directory")
    workspace = Workspace(path)
    metadata = workspace.state()["workspace"]
    if (metadata.get("schema") != core.SCHEMA
            or not re.fullmatch(r"workspace-[a-f0-9]{32}", str(metadata.get("id", "")))
            or type(metadata.get("revision")) is not int
            or (fresh and metadata["revision"] != 0)):
        raise ValueError("The original native workspace initialization is incomplete")
    return workspace, metadata


def open_receiving_workspace(path, output, title, input_sha256):
    path = Path(path)
    marker_path = Path(output) / "WORKSPACE-INITIALIZATION.json"
    identity = {"schema": SCHEMA, "workspace_path": str(path), "input_sha256": input_sha256}
    marker = read_json(marker_path) if marker_path.exists() else None
    if marker is not None and any(marker.get(key) != value for key, value in identity.items()):
        raise ValueError("The workspace initialization belongs to another original input")
    if path.exists() or path.is_symlink():
        workspace, metadata = initialized_metadata(path)
        if marker and marker.get("workspace_id") and marker["workspace_id"] != metadata["id"]:
            raise ValueError("The initialized receiving workspace identity changed")
        return workspace
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if marker is None:
        marker = {**identity, "attempt": 1, "preserved_incomplete_stages": []}
        write_json(marker_path, marker, immutable=False)
    attempt = marker.get("attempt")
    if type(attempt) is not int or attempt < 1:
        raise ValueError("The retained workspace initialization attempt differs")
    stage = path.parent / ("." + path.name + "-receiving-" + input_sha256[:16] + "-" + str(attempt))
    metadata = None
    if stage.exists() or stage.is_symlink():
        if stage.is_symlink() or not stage.is_dir():
            raise ValueError("The caller-owned initialization stage changed")
        try:
            _, metadata = initialized_metadata(stage, fresh=True)
        except (core.Problem, sqlite3.DatabaseError, KeyError, ValueError) as error:
            if marker.get("workspace_id"):
                raise ValueError("Preserve the already prepared original workspace for recovery") from error
            # Keep the interrupted original initializer's directory as evidence.
            # A new attempt uses a new path; no existing database is reset.
            marker["preserved_incomplete_stages"].append({"path": str(stage), "error_type": type(error).__name__})
            marker["attempt"] += 1
            marker.pop("workspace_id", None)
            marker.pop("prepared_metadata", None)
            write_json(marker_path, marker, immutable=False)
            stage = path.parent / ("." + path.name + "-receiving-" + input_sha256[:16] + "-" + str(marker["attempt"]))
    if metadata is None:
        if marker.get("workspace_id"):
            raise ValueError("The already prepared original workspace stage is absent")
        initialize(stage, title)
        _, metadata = initialized_metadata(stage, fresh=True)
    if marker.get("workspace_id") and marker["workspace_id"] != metadata["id"]:
        raise ValueError("The retained original initialization stage has another identity")
    with os.fdopen(os.open(stage / "workspace.sqlite3", os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        os.fsync(stream.fileno())
    sync_directory(stage)
    marker.update(workspace_id=metadata["id"], prepared_metadata=metadata, stage=str(stage), state="prepared")
    write_json(marker_path, marker, immutable=False)
    try:
        publish_directory(stage, path)
    except FileExistsError:
        # A different writer may have created the target after the initial read.
        # Reopen only this exact completed identity; never replace that target.
        _, current = initialized_metadata(path)
        if current["id"] != metadata["id"]:
            raise ValueError("A different receiving workspace already occupies the target")
    workspace, current = initialized_metadata(path)
    if current["id"] != metadata["id"]:
        raise ValueError("The completed native workspace changed during publication")
    marker.update(state="published", published_at=timestamp())
    write_json(marker_path, marker, immutable=False)
    return workspace


class Journey:
    def __init__(self, args):
        self.args = args
        self.output = Path(args.output).expanduser().resolve()
        self.workspace_path = Path(args.workspace).expanduser().resolve()
        self.output.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.source = checked_bytes(args.package, receiving.MAX_SOURCE)
        if digest(self.source) != args.expected_source_sha256:
            raise ValueError("The complete original archive differs from its selected SHA-256")
        if args.expected_source_bytes is not None and len(self.source) != args.expected_source_bytes:
            raise ValueError("The complete original archive differs from its selected byte count")
        self.context = {"actor": args.actor.strip(), "origin_workspace_id": args.origin_workspace_id.strip(),
                        "source_ref": args.source_ref.strip(), "notes": args.notes.strip()}
        self.source_name = Path(args.package).name
        self.input = {"schema": SCHEMA, "operation_id": args.operation_id,
                      "source": {"filename": self.source_name, "bytes": len(self.source), "sha256": digest(self.source)},
                      "context": self.context, "workspace_path": str(self.workspace_path),
                      "restore_target": str(Path(args.restore_target).expanduser().resolve()) if args.restore_target else str(self.output / "restored-workspace"),
                      "runtime_sources": runtime_sources(),
                      "require_original_export_bytes": bool(args.require_original_export_bytes)}
        if args.expected_case:
            case_raw = checked_bytes(args.expected_case)
            self.case = json.loads(case_raw)
            self.input["expected_case"] = {"bytes": len(case_raw), "sha256": digest(case_raw)}
            if self.case["source"]["bytes"] != len(self.source) or self.case["source"]["sha256"] != digest(self.source):
                raise ValueError("The case selection differs from the retained original archive")
            if self.case["origin_workspace_id"] != self.context["origin_workspace_id"]:
                raise ValueError("The case's original workspace provenance differs")
            write_bytes(self.output / "ORIGINAL-CASE.json", case_raw)
        else:
            self.case = None
        write_json(self.output / "INPUT.json", self.input)
        write_bytes(self.output / "source" / self.source_name, self.source)
        self.workspace = open_receiving_workspace(self.workspace_path, self.output, args.title, digest(self.input))
        metadata = self.workspace.state()["workspace"]
        write_json(self.output / "RECEIVING-WORKSPACE.json",
                   {"id": metadata["id"], "path": str(self.workspace_path), "input_sha256": digest(self.input)})
        self.invocation = {"started_at": timestamp(), "pid": os.getpid(),
                           "source": str(Path(__file__).resolve()), "workspace_id": metadata["id"]}
        self.progress = {"schema": SCHEMA, "input_sha256": digest(self.input), "operation_id": args.operation_id,
                         "receiving_workspace_id": metadata["id"], "invocation": self.invocation}
        self.checkpoint("opened")

    def checkpoint(self, phase, **values):
        self.progress.update(phase=phase, observed_at=timestamp(), **values)
        write_json(self.output / "PROGRESS.json", self.progress, immutable=False)
        print(json.dumps({"phase": phase, "workspace_id": self.progress["receiving_workspace_id"],
                          "operation_id": self.args.operation_id}, sort_keys=True), flush=True)

    def call(self, step, action, args):
        path = self.output / "requests" / (step + ".json")
        selected = {"action": action, "args": args}
        if path.exists():
            record = read_json(path)
            if record["action"] != action or stable({key: value for key, value in record["body"].items()
                if key not in {"operation_id", "expected_revision"}}) != stable(args):
                raise ValueError("The retained native request has different original arguments: " + step)
            body = record["body"]
            if body["operation_id"] != self.args.operation_id + ":" + step:
                raise ValueError("The retained native operation identity differs")
        else:
            body = {"operation_id": self.args.operation_id + ":" + step,
                    "expected_revision": self.workspace.state()["workspace"]["revision"], **args}
            record = {"schema": SCHEMA, "workspace_id": self.progress["receiving_workspace_id"],
                      "action": action, "body": body, "args_sha256": digest(selected), "retained_at": timestamp()}
            write_json(path, record)
        if record["workspace_id"] != self.progress["receiving_workspace_id"] or record["args_sha256"] != digest(selected):
            raise ValueError("The native request belongs to different original input or workspace")
        response = self.workspace.mutate(action, body)
        result_path = self.output / "responses" / (step + ".json")
        if result_path.exists():
            first = read_json(result_path)
            compare_result(first, response)
        else:
            write_json(result_path, response)
            first = response
        self.checkpoint(step, last_response={"step": step, "revision": response["revision"],
                                             "operation_revision": response["operation_revision"],
                                             "replayed": response.get("replayed", False)})
        return first, body

    def exports(self, workspace, preview, receipt, prefix):
        output = self.output / prefix
        reopened = workspace.extension_read("classification", "document", "received", receipt["id"])
        if stable(reopened) != stable(receipt):
            raise ValueError("The complete original receiving record differs after reopen")
        original = workspace.extension_read("classification", "download", "received-original", receipt["id"])["data"]
        if original != self.source:
            raise ValueError("The complete retained original archive differs after reopen")
        write_bytes(output / self.source_name, original)
        documents = []
        for selected in preview["documents"]:
            value = workspace.extension_read("classification", "document", selected["kind"], selected["id"])
            if value["id"] != selected["id"] or value["sha256"] != selected["sha256"]:
                raise ValueError("An original document identity was not preserved")
            source_ids = selected["review_ids"]
            current_ids = [row["id"] for row in value["reviews"]]
            if current_ids[:len(source_ids)] != source_ids:
                raise ValueError("The ordered original review history was not retained")
            path = output / "documents" / (selected["id"] + ".json")
            write_json(path, value)
            documents.append({"id": selected["id"], "kind": selected["kind"], "document_sha256": selected["sha256"],
                              "source_review_ids": source_ids, "file": descriptor(path)})
        original_members = []
        for index, member in enumerate(preview["members"]):
            value = workspace.extension_read("classification", "download", "received-member", receipt["id"] + "~" + str(index))["data"]
            if len(value) != member["bytes"] or digest(value) != member["sha256"]:
                raise ValueError("An original export file differs after receiving")
            path = output / "original" / (str(index + 1).zfill(3) + "-" + Path(member["path"]).name)
            write_bytes(path, value)
            original_members.append({**member, "file": descriptor(path)})
        exports = []
        originals = {row["path"]: row for row in preview["members"]}
        for index, root in enumerate(preview["roots"]):
            stem = str(index + 1).zfill(3) + "-" + root["id"]
            for kind, suffix in (("scenario-package", ".json"), ("scenario-csv", ".csv")):
                result = workspace.extension_read("classification", "download", kind, root["id"])
                path = output / "accepted" / (stem + suffix)
                write_bytes(path, result["data"])
                matches = [row["path"] for row in preview["members"] if row["sha256"] == digest(result["data"])]
                if self.args.require_original_export_bytes:
                    if kind == "scenario-package" and digest(result["data"]) != originals[root["member"]]["sha256"]:
                        raise ValueError("The reopened accepted JSON differs from the selected original export")
                    if kind == "scenario-csv" and not any(name.lower().endswith(".csv") for name in matches):
                        raise ValueError("The reopened accepted CSV differs from every selected original export")
                exports.append({"root": root, "kind": kind, "matching_original_members": matches, "file": descriptor(path)})
        return {"workspace_id": workspace.state()["workspace"]["id"], "receipt": reopened,
                "documents": documents, "original_members": original_members, "accepted_exports": exports}

    def run(self):
        payload = {"content_base64": base64.b64encode(self.source).decode("ascii"), "filename": self.source_name,
                   "expected_source_sha256": digest(self.source), **self.context}
        preview_response, _ = self.call("preview", "classification.preview_package", payload)
        preview = preview_response["result"]
        if self.case:
            members = {row["path"]: row["sha256"] for row in preview["members"]}
            if members != self.case["members"]:
                raise ValueError("The case's complete original file set differs")
            if {row["id"] for row in preview["roots"]} != set(self.case["scenario_ids"]):
                raise ValueError("The case's original scenario identities differ")
            available = {row["id"]: row for row in preview["documents"]}
            for identity, expected in self.case["documents"].items():
                if identity not in available or available[identity]["sha256"] != expected["sha256"] or available[identity]["rows"] != expected["rows"]:
                    raise ValueError("An original case source edition differs: " + identity)
        result, request = self.call("receive", "classification.receive_package",
                                   {**payload, "expected_preview_sha256": preview["preview_sha256"]})
        receipt = result["result"]["receipt"]
        replay = self.workspace.mutate("classification.receive_package", request)
        if replay.get("replayed") is not True:
            raise ValueError("The original receiving operation did not reopen through native replay")
        compare_result(result, replay)
        replay_path = self.output / "responses" / "receive-replay.json"
        if replay_path.exists():
            compare_result(read_json(replay_path), replay)
        else:
            write_json(replay_path, replay)
        self.checkpoint("received", receiving_record={"id": receipt["id"], "sha256": receipt["sha256"]})
        received = self.exports(self.workspace, preview, receipt, "receiving-readback")
        write_json(self.output / "RECEIVING-READBACK.json", received)
        selection = {"schema": SCHEMA, "operation_id": self.args.operation_id,
                     "workspace_path": str(self.workspace_path), "workspace_id": received["workspace_id"],
                     "origin_workspace_id": self.context["origin_workspace_id"], "receipt_id": receipt["id"],
                     "receipt_sha256": receipt["sha256"], "source": self.input["source"],
                     "scenario_ids": [row["id"] for row in preview["roots"]],
                     "documents": preview["documents"], "runtime_sources": self.input["runtime_sources"]}
        write_json(self.output / "RECEIVING-SELECTION.json", selection)
        if self.args.until == "received":
            self.checkpoint("received-and-reopened")
            return {"state": "RECEIVED", "selection": selection, "receiving_readback": received}
        prepared, _ = self.call("backup", "prepare_backup", {})
        backup = self.workspace.backup(prepared["result"]["id"])
        backup_copy = self.output / "received-workspace-backup.zip"
        write_bytes(backup_copy, checked_bytes(backup, 512 * 1024 * 1024))
        restored = restore(backup_copy, self.input["restore_target"])
        reopened = Workspace(self.input["restore_target"])
        if reopened.state()["workspace"]["id"] != selection["workspace_id"]:
            raise ValueError("The native receiving workspace identity changed during restore")
        restored_readback = self.exports(reopened, preview, receipt, "restored-readback")
        for section in ("documents", "original_members", "accepted_exports"):
            source_rows, target_rows = received[section], restored_readback[section]
            if len(source_rows) != len(target_rows):
                raise ValueError("The restored complete case omitted an original " + section)
            for left, right in zip(source_rows, target_rows):
                if left["file"]["sha256"] != right["file"]["sha256"] or left["file"]["bytes"] != right["file"]["bytes"]:
                    raise ValueError("Restoring the case changed an original " + section)
        write_json(self.output / "RESTORE-READBACK.json", restored_readback)
        result = {"schema": SCHEMA, "state": "COMPLETE", "operation_id": self.args.operation_id,
                  "input_sha256": digest(self.input), "completed_at": timestamp(), "invocation": self.invocation,
                  "executed_transport": "Original Workspace mutation/read and backup/restore APIs",
                  "selection": selection, "receiving_readback": received, "same_operation_replay": replay,
                  "backup": {"id": prepared["result"]["id"], **descriptor(backup_copy)},
                  "restore": restored, "restored_readback": restored_readback,
                  "history_scope": receipt["history_scope"], "original_workspace_operations_included": False}
        path = self.output / "RESULT.json"
        if path.exists():
            prior = read_json(path)
            for key in ("input_sha256", "operation_id", "selection", "receiving_readback", "backup", "restored_readback"):
                if stable(prior[key]) != stable(result[key]):
                    raise ValueError("The completed receiving case differs from its original saved result")
            result = prior
        else:
            write_json(path, result)
        # The complete result is durable before a completed progress checkpoint.
        self.checkpoint("complete", result=descriptor(path), backup=descriptor(backup_copy))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--expected-source-bytes", type=int)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--origin-workspace-id", default="")
    parser.add_argument("--notes", default="")
    parser.add_argument("--title", default="Received classification and placement case")
    parser.add_argument("--restore-target")
    parser.add_argument("--expected-case")
    parser.add_argument("--require-original-export-bytes", action="store_true")
    parser.add_argument("--until", choices=["received", "complete"], default="complete")
    args = parser.parse_args()
    os.umask(0o077)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,169}", args.operation_id):
        raise ValueError("Use a stable original receiving operation ID, at most 170 characters")
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = output / ".receiving-operation.lock"
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600), "a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        result = Journey(args).run()
    print(json.dumps({"state": result["state"], "operation_id": args.operation_id,
                      "output": str(output), "selection": result["selection"]}, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"state": "RECEIVING_INTERRUPTED", "error_type": type(error).__name__,
                          "error": str(error)}, sort_keys=True), file=sys.stderr, flush=True)
        raise SystemExit(2)
