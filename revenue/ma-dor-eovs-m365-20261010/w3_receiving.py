#!/usr/bin/env python3
"""Retain complete W3 browser editions in the original MigrationWorkspace.

This module performs source custody and original-operation receiving. Message
mapping and reconciliation remain in the selected browser model.
"""
from __future__ import annotations
import argparse
import base64
from decimal import Decimal
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import unicodedata

from migration_store import MigrationError, canonical, identity, identifier, integer, text
from migration_workspace import MigrationWorkspace
from migration_portable import ordinary_directory, publish_bytes, receive_delivery

BUNDLE = "commons.w3-integration-handover/v1"
RECORD = "commons.w3-integration-workbench/v1"
RECEIPT = "commons.w3-native-source-receipt/v1"
COLLECTIONS = ("scope_editions", "sources", "mappings", "populations",
               "rehearsals", "decisions", "releases", "history")
MAX_PACKAGE = 256 * 1024 * 1024
MAX_MEMBERS = 4096
SHA = re.compile(r"[0-9a-f]{64}")
RESERVED = ".w3-received.json"
WINDOWS_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", re.I)


def need(value, message):
    if not value:
        raise MigrationError("W3_RECEIVING", message)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def parse(body):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "Repeated JSON property: " + key)
            result[key] = value
        return result
    def invalid(token):
        raise MigrationError("W3_RECEIVING", "Non-finite JSON number: " + token)
    try:
        return json.loads(body.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=invalid, parse_float=Decimal)
    except (UnicodeError, ValueError) as exc:
        raise MigrationError("W3_RECEIVING", "Read the complete original UTF-8 JSON: " + str(exc)) from exc


def frozen(value):
    """Compare retained JSON without coercing original decimals or booleans."""
    if isinstance(value, dict):
        return ("object", tuple((key, frozen(value[key])) for key in sorted(value)))
    if isinstance(value, list):
        return ("array", tuple(frozen(item) for item in value))
    return (type(value).__name__, str(value) if isinstance(value, Decimal) else value)


def explicit_time(value):
    text(value, "observed_at")
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})", value),
         "Record the actual observation time with its explicit offset")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise MigrationError("W3_RECEIVING", "Invalid observation time") from exc
    return value


def member_name(value):
    need(isinstance(value, str) and value and len(value) <= 1024,
         "Keep each original portable member name")
    need("\\" not in value and ":" not in value and not any(ord(ch) < 32 or ord(ch) == 127 for ch in value)
         and unicodedata.normalize("NFC", value) == value,
         "Use an NFC portable member name without controls or backslashes")
    selected = PurePosixPath(value)
    need(not selected.is_absolute() and selected.as_posix() == value
         and all(part not in ("", ".", "..") for part in value.split("/")),
         "A member must stay inside its original package")
    need(all(len(part) <= 255 and part.rstrip(" .") == part
             and not WINDOWS_RESERVED.fullmatch(part) for part in value.split("/")),
         "Each member segment must remain portable across receiving filesystems")
    need(len(selected.name) <= 240, "Original attachment basename exceeds the native Store limit of 240 characters")
    need(value.split("/")[0].casefold() != RESERVED.casefold(),
         "The receiving marker is reserved")
    return value


def descriptor(row, body):
    need(isinstance(row, dict), "Keep each complete original member descriptor")
    n = row.get("bytes")
    need(isinstance(n, int) and not isinstance(n, bool) and n == len(body),
         "Original member byte count differs: " + str(row.get("path", "")))
    need(isinstance(row.get("sha256"), str) and SHA.fullmatch(row["sha256"])
         and row["sha256"] == sha(body),
         "Original member SHA256 differs: " + str(row.get("path", "")))
    return {"path": member_name(row.get("path")), "bytes": n, "sha256": row["sha256"]}


def read_regular(path, limit=MAX_PACKAGE):
    path = Path(path).expanduser().absolute()
    for parent in [*reversed(path.parents), path]:
        need(not parent.is_symlink(), "Original receiving paths must not be symlinks")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
             "The original source must be a bounded regular file")
        body = source.read(limit + 1)
        after = os.fstat(source.fileno())
    need(len(body) <= limit and (before.st_dev, before.st_ino, before.st_size,
         before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino,
         after.st_size, after.st_mtime_ns, after.st_ctime_ns),
         "Original receiving file changed during reading")
    return body


def inspect_bytes(body):
    need(isinstance(body, bytes) and len(body) <= MAX_PACKAGE,
         "The complete W3 package must fit within 256 MiB")
    value = parse(body)
    need(isinstance(value, dict) and value.get("schema") == BUNDLE,
         "Choose the complete W3 integration handover")
    rows = value.get("files")
    need(isinstance(rows, list) and 0 < len(rows) <= MAX_MEMBERS,
         "Keep the complete nonempty original file inventory")
    files, descriptors, folded = {}, [], set()
    total = 0
    for row in rows:
        need(isinstance(row, dict), "Each handover member must be an object")
        encoding = row.get("encoding", "utf-8")
        need(isinstance(row.get("content"), str), "Keep every complete original member body")
        if encoding == "utf-8":
            try:
                content = row["content"].encode("utf-8")
            except UnicodeError as exc:
                raise MigrationError("W3_RECEIVING", "Invalid member Unicode") from exc
        elif encoding == "base64":
            try:
                content = base64.b64decode(row["content"], validate=True)
            except (ValueError, TypeError) as exc:
                raise MigrationError("W3_RECEIVING", "Invalid original binary member encoding") from exc
        else:
            raise MigrationError("W3_RECEIVING", "Unsupported member encoding")
        selected = descriptor(row, content)
        name, key = selected["path"], selected["path"].casefold()
        need(key not in folded, "The original package repeats a portable member name")
        folded.add(key)
        files[name] = content
        descriptors.append(selected)
        total += len(content)
        need(total <= MAX_PACKAGE, "Decoded original members exceed the 256 MiB bound")
    for name in files:
        parents = PurePosixPath(name).parents
        need(not any(parent.as_posix().casefold() in folded for parent in parents
                     if parent.as_posix() != "."),
             "Original member names collide with a parent directory")
    manifest = value.get("manifest")
    need(isinstance(manifest, dict) and isinstance(manifest.get("files"), list),
         "Retain the whole original handover manifest")
    declared = []
    for row in manifest["files"]:
        need(isinstance(row, dict) and isinstance(row.get("path"), str) and row["path"] in files,
             "Manifest names an absent original member")
        declared.append(descriptor(row, files[row["path"]]))
    need(len(declared) == len(descriptors)
         and len({row["path"] for row in declared}) == len(declared)
         and sorted(declared, key=lambda x:x["path"]) == sorted(descriptors, key=lambda x:x["path"]),
         "Manifest must describe every original member exactly once")
    selected = manifest.get("record")
    need(isinstance(selected, dict) and isinstance(selected.get("path"), str) and selected["path"] in files,
         "Select the exact complete primary W3 record")
    primary = files[selected["path"]]
    need(selected.get("sha256") == sha(primary), "The selected primary record hash differs")
    record = parse(primary)
    need(isinstance(record, dict) and record.get("schema") == RECORD,
         "The primary body is not the maintained W3 record")
    text(record.get("id"), "W3 project id", max_length=1024)
    integer(record.get("revision"), "W3 revision")
    integer(selected.get("revision"), "selected W3 revision")
    need(selected.get("id") == record["id"] and selected.get("revision") == record["revision"],
         "The selected project/revision differs from the original record")
    for key in COLLECTIONS:
        need(isinstance(record.get(key), list), "Keep the complete original " + key)
    return {"schema": BUNDLE, "package": {"bytes": len(body), "sha256": sha(body)},
            "record": {"path": selected["path"], "id": record["id"],
                       "revision": record["revision"], "bytes": len(primary), "sha256": sha(primary)},
            "members": descriptors, "files": files, "value": record}


def public_inspection(selected):
    return {key:selected[key] for key in ("schema", "package", "record", "members")}


def retained_receipt(workspace, source_id):
    source = workspace.dispatch("source.get", {"id": source_id})
    need(source["status"] == "READY" and source["format"] == "attachment",
         "Choose the original completed W3 receipt source")
    with workspace.open_file(source["file_sha256"]) as handle:
        body = handle.read(MAX_PACKAGE + 1)
    need(len(body) <= MAX_PACKAGE, "The retained receipt exceeds its source bound")
    value = parse(body)
    need(isinstance(value, dict) and value.get("schema") == RECEIPT
         and value.get("native_workspace_id") == workspace.project["id"],
         "The retained receipt belongs to another native workspace")
    return source, value


def retained_bundle(workspace, receipt):
    source = workspace.dispatch("source.get", {"id": receipt["bundle_source_id"]})
    need(source["status"] == "READY" and source["file_sha256"] == receipt["package"]["sha256"],
         "The original W3 package source changed")
    with workspace.open_file(source["file_sha256"]) as handle:
        body = handle.read(MAX_PACKAGE + 1)
    selected = inspect_bytes(body)
    need(public_inspection(selected) == receipt["package_selection"],
         "The retained complete package no longer matches its source receipt")
    return body, selected


def check_predecessor(workspace, selected, previous_source_id):
    if not previous_source_id:
        return None
    source, receipt = retained_receipt(workspace, previous_source_id)
    _, previous = retained_bundle(workspace, receipt)
    need(previous["record"]["id"] == selected["record"]["id"],
         "A revised return must belong to the same W3 project")
    old_revision, revision = previous["record"]["revision"], selected["record"]["revision"]
    need(revision >= old_revision, "The returned W3 revision predates its selected predecessor")
    if previous["record"]["sha256"] != selected["record"]["sha256"]:
        need(revision > old_revision, "Changed W3 bytes require a later project revision")
    for key in COLLECTIONS:
        old, current = previous["value"][key], selected["value"][key]
        need(len(current) >= len(old) and frozen(current[:len(old)]) == frozen(old),
             "The revised return rewrote or reordered original immutable " + key)
    for row in previous["members"]:
        # Workspace, report and app presentation may acquire a successor; their
        # previous complete bytes remain in the original native object store.
        need(workspace.file_info(row["sha256"])["bytes"] == row["bytes"],
             "An earlier retained W3 member is absent")
    return {"source_id": previous_source_id, "sha256": source["file_sha256"],
            "record": previous["record"], "operation_id": receipt["operation_id"]}


def receive_package(workspace, body, *, operation_id, expected_revision, actor,
                    scope_id, identity_namespace, capture_kind, observed_at,
                    reason, previous_receipt_source_id=None, resume_reason=None):
    identifier(operation_id, "original receiving operation")
    need(len(operation_id) <= 64, "Keep the original receiving ID within 64 characters")
    integer(expected_revision, "expected_revision")
    text(actor, "actor", max_length=512)
    text(scope_id, "scope_id", max_length=1024)
    text(identity_namespace, "identity_namespace", max_length=1024)
    explicit_time(observed_at)
    text(reason, "reason")
    need(capture_kind in ("customer_export", "local_reference", "public_reference"),
         "Declare the actual source capture kind")
    selected = inspect_bytes(body)
    with workspace._mutex:
        previous = check_predecessor(workspace, selected, previous_receipt_source_id)
        context = {"scope_id": scope_id, "identity_namespace": identity_namespace,
                   "role": "attachment", "capture_kind": capture_kind,
                   "coverage": {"mode": "complete", "description":
                       "Complete bytes of this selected W3 package; message-population coverage remains in its original record."},
                   "producer": "W3 browser workbench", "observed_at": observed_at,
                   "note": reason, "job_id": operation_id,
                   "w3_project_id": selected["record"]["id"],
                   "w3_revision": selected["record"]["revision"],
                   "w3_package_sha256": selected["package"]["sha256"],
                   "w3_previous_receipt": previous}
        inputs = [("@package", "W3_Integration_Handover.json", body)] + [
            (row["path"], PurePosixPath(row["path"]).name, selected["files"][row["path"]])
            for row in selected["members"]]
        jobs = [(operation_id + "-f-" + sha(name.encode("utf-8"))[:20], name, filename, content)
                for name, filename, content in inputs]
        existing = [workspace.dispatch("operation.get", {"id": job[0]}) for job in jobs]
        if not any(row["found"] for row in existing):
            need(workspace.project["revision"] == expected_revision,
                 "The native workspace changed before receiving this original package")
        members, accepted = [], []
        def original_import(job, original_name, filename, content):
            staged = workspace.stage_file(io.BytesIO(content), filename,
                     expected_sha256=sha(content), expected_bytes=len(content))
            request = {"operation_id": job, "expected_revision": workspace.project["revision"],
                       "actor": actor, "filename": filename, "file_sha256": staged["sha256"],
                       "bytes": staged["bytes"], "format": "attachment",
                       "context": {**context, "w3_original_path": original_name}}
            old = workspace.dispatch("operation.get", {"id": job})
            if old["found"] and old["operation"]["status"] != "SUCCEEDED":
                semantic = {k:v for k,v in request.items() if k not in ("operation_id", "expected_revision")}
                need(old["operation"]["operation"] == "source.import"
                     and old["operation"]["request_sha256"] == identity({"operation":"source.import", "payload":semantic}),
                     "The interrupted original import has different source or receiving context")
                text(resume_reason, "explicit original-operation resume reason")
                result = workspace.dispatch("operation.resume", {
                    "operation_id": job + "-r-" + identity({"reason":resume_reason, "revision":workspace.project["revision"]})[:12],
                    "expected_revision": workspace.project["revision"], "actor":actor,
                    "target_operation_id":job, "reason":resume_reason})
                final = workspace.dispatch("operation.get", {"id": job})["operation"]
                need(final["status"] == "SUCCEEDED", "The original member import did not complete")
                result = {"operation_id":job, "revision":final["result"]["revision"],
                          "result":final["result"]["result"], "reused":True}
            else:
                result = workspace.dispatch("source.import", request)
            source = result["result"]
            need(source["status"] == "READY" and source["file_sha256"] == staged["sha256"],
                 "The retained original member import differs")
            return result
        for job, name, filename, content in jobs:
            result = original_import(job, name, filename, content)
            accepted.append({"operation_id":job, "revision":result["revision"],
                             "source_id":result["result"]["id"],
                             "request_sha256":workspace.dispatch("operation.get", {"id":job})["operation"]["request_sha256"]})
            if name != "@package":
                members.append({"path":name, "bytes":len(content), "sha256":sha(content),
                                "source_id":result["result"]["id"], "operation_id":job})
        receipt = {"schema":RECEIPT, "operation_id":operation_id,
                   "native_workspace_id":workspace.project["id"],
                   "package":selected["package"], "package_selection":public_inspection(selected),
                   "bundle_source_id":accepted[0]["source_id"], "record":selected["record"],
                   "previous_receipt":previous, "actor":actor, "observed_at":observed_at,
                   "reason":reason, "members":members, "accepted_operations":accepted}
        receipt_body = (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
        receipt_result = original_import(operation_id + "-receipt", "@receipt",
                                         "W3_Native_Source_Receipt.json", receipt_body)
        return {**receipt, "receipt_source_id":receipt_result["result"]["id"],
                "receipt_sha256":sha(receipt_body), "native_revision":receipt_result["revision"]}


def materialize_package(workspace, receipt_source_id, destination):
    _, receipt = retained_receipt(workspace, receipt_source_id)
    _, selected = retained_bundle(workspace, receipt)
    target = Path(destination).expanduser().absolute()
    marker = {"schema":RECEIPT + "/materialized", "receipt_source_id":receipt_source_id,
              "native_workspace_id":workspace.project["id"],
              "package":selected["package"], "record":selected["record"],
              "members":selected["members"]}
    marker_body = (json.dumps(marker, sort_keys=True, indent=2) + "\n").encode("utf-8")
    ordinary_directory(target.parent)
    if target.exists() or target.is_symlink():
        ordinary_directory(target)
        need(read_regular(target / RESERVED) == marker_body,
             "Existing receiving directory belongs to a different original package")
    else:
        target.mkdir(mode=0o700)
        # This is the receiving intent, not a claim that all members were written.
        # A retry may finish this exact intent without replacing edited originals.
        publish_bytes(target / RESERVED, marker_body)
    for row in selected["members"]:
        path = target / row["path"]
        ordinary_directory(path.parent, create=True)
        publish_bytes(path, selected["files"][row["path"]])
    return {**marker, "directory":str(target), "complete":True}



def course(first_body, returned_body, destination, *, actor, scope_id,
           identity_namespace, capture_kind, observed_at):
    """Execute the real Store/import/portable course on two selected exports."""
    first, returned = inspect_bytes(first_body), inspect_bytes(returned_body)
    need(first["record"]["id"] == returned["record"]["id"]
         and returned["record"]["revision"] > first["record"]["revision"],
         "The course requires the original first edition and its later returned edition")
    for key in COLLECTIONS:
        old, current = first["value"][key], returned["value"][key]
        need(len(current) >= len(old) and frozen(current[:len(old)]) == frozen(old),
             "Returned edition changed the original " + key)
    explicit_time(observed_at)
    root = Path(destination).expanduser().absolute()
    ordinary_directory(root.parent)
    intent = {"schema":"commons.w3-native-receiving-course/v1",
              "first":public_inspection(first), "returned":public_inspection(returned),
              "actor":actor, "scope_id":scope_id, "identity_namespace":identity_namespace,
              "capture_kind":capture_kind, "observed_at":observed_at}
    intent_body = (json.dumps(intent, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if root.exists() or root.is_symlink():
        ordinary_directory(root)
        need(read_regular(root / "course-intent.json") == intent_body,
             "This course directory belongs to another original request")
    else:
        root.mkdir(mode=0o700)
        publish_bytes(root / "course-intent.json", intent_body)
    args = {"actor":actor, "scope_id":scope_id, "identity_namespace":identity_namespace,
            "capture_kind":capture_kind, "observed_at":observed_at}
    with MigrationWorkspace(root / "original-workspace",
                            create=not (root / "original-workspace" / "workspace.sqlite3").exists(),
                            title="W3 original source receiving") as workspace:
        first_receipt = receive_package(workspace, first_body, operation_id="w3-first-import",
            expected_revision=workspace.project["revision"], reason="Retain the selected original first W3 edition", **args)
        before = workspace.project["revision"]
        repeat = receive_package(workspace, first_body, operation_id="w3-first-import",
            expected_revision=before, reason="Retain the selected original first W3 edition", **args)
        need(workspace.project["revision"] == before and repeat == first_receipt,
             "Exact original import retry changed its retained source or workspace revision")
        first_delivery = workspace.dispatch("delivery.prepare", {
            "operation_id":"w3-first-delivery", "expected_revision":workspace.project["revision"],
            "actor":actor, "title":"W3 first complete native handover", "note":"Complete original attachment custody"})["result"]
        first_archive = workspace.root / first_delivery["relative_path"]
    first_cold = receive_delivery(first_archive, root / "first-cold")
    with MigrationWorkspace(root / "first-cold" / "workspace", create=False) as workspace:
        _, recovered = retained_receipt(workspace, first_receipt["receipt_source_id"])
        need(recovered["record"] == first["record"], "Cold receiving changed the selected original record")
        returned_receipt = receive_package(workspace, returned_body, operation_id="w3-return-import",
            expected_revision=workspace.project["revision"], reason="Retain the selected later W3 return",
            previous_receipt_source_id=first_receipt["receipt_source_id"], **args)
        before = workspace.project["revision"]
        old_retry = receive_package(workspace, first_body, operation_id="w3-first-import",
            expected_revision=before, reason="Retain the selected original first W3 edition", **args)
        need(workspace.project["revision"] == before and old_retry == first_receipt,
             "Retrying the older operation replaced or advanced the returned workspace")
        returned_delivery = workspace.dispatch("delivery.prepare", {
            "operation_id":"w3-return-delivery", "expected_revision":workspace.project["revision"],
            "actor":actor, "title":"W3 revised complete native handover",
            "note":"Both original W3 editions and their native operations retained"})["result"]
        returned_archive = workspace.root / returned_delivery["relative_path"]
    second_cold = receive_delivery(returned_archive, root / "returned-cold")
    with MigrationWorkspace(root / "returned-cold" / "workspace", create=False) as workspace:
        for receipt in (first_receipt, returned_receipt):
            _, retained = retained_receipt(workspace, receipt["receipt_source_id"])
            _, package = retained_bundle(workspace, retained)
            need(package["record"] == receipt["record"], "Cold return lost an earlier exact source edition")
            for row in retained["members"]:
                source = workspace.dispatch("source.get", {"id":row["source_id"]})
                need(source["file_sha256"] == row["sha256"], "Cold return source identity differs")
                with workspace.open_file(row["sha256"]) as handle:
                    need(handle.read(MAX_PACKAGE + 1) == package["files"][row["path"]],
                         "Cold return changed complete original member bytes")
        materialized = materialize_package(workspace, returned_receipt["receipt_source_id"],
                                          root / "returned-browser")
        final_project = dict(workspace.project)
    result = {"schema":intent["schema"], "complete":True, "intent_sha256":sha(intent_body),
              "first_receipt":first_receipt, "returned_receipt":returned_receipt,
              "first_delivery":first_delivery, "returned_delivery":returned_delivery,
              "workspace_id":final_project["id"], "final_revision":final_project["revision"],
              "returned_browser":materialized,
              "checks":{"exact_import_retry":True, "first_cold_receiving":True,
                        "ordered_immutable_return":True, "older_retry_preserves_return":True,
                        "both_complete_source_editions_reopened":True,
                        "all_original_member_bytes_verified":True},
              "scope":"Original source custody and editable native handover; no middleware deployment, broker replay or business acceptance is claimed."}
    publish_bytes(root / "COURSE.json", (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("package")
    receive = commands.add_parser("import")
    receive.add_argument("package")
    receive.add_argument("--workspace", required=True)
    receive.add_argument("--operation-id", required=True)
    receive.add_argument("--expected-revision", required=True, type=int)
    receive.add_argument("--actor", required=True)
    receive.add_argument("--scope-id", required=True)
    receive.add_argument("--identity-namespace", required=True)
    receive.add_argument("--capture-kind", required=True, choices=("customer_export","local_reference","public_reference"))
    receive.add_argument("--observed-at", required=True)
    receive.add_argument("--reason", required=True)
    receive.add_argument("--previous-receipt-source-id")
    receive.add_argument("--resume-reason")
    extract = commands.add_parser("extract")
    extract.add_argument("--workspace", required=True)
    extract.add_argument("--receipt-source-id", required=True)
    extract.add_argument("--output", required=True)
    handover = commands.add_parser("handover")
    handover.add_argument("--workspace", required=True)
    handover.add_argument("--operation-id", required=True)
    handover.add_argument("--expected-revision", required=True, type=int)
    handover.add_argument("--actor", required=True)
    handover.add_argument("--title", required=True)
    handover.add_argument("--note", default="")
    cold = commands.add_parser("receive-native")
    cold.add_argument("archive")
    cold.add_argument("destination")
    rehearsal = commands.add_parser("course")
    rehearsal.add_argument("first")
    rehearsal.add_argument("returned")
    rehearsal.add_argument("--output", required=True)
    rehearsal.add_argument("--actor", required=True)
    rehearsal.add_argument("--scope-id", required=True)
    rehearsal.add_argument("--identity-namespace", required=True)
    rehearsal.add_argument("--capture-kind", required=True, choices=("customer_export","local_reference","public_reference"))
    rehearsal.add_argument("--observed-at", required=True)
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = public_inspection(inspect_bytes(read_regular(args.package)))
    elif args.command == "receive-native":
        result = receive_delivery(args.archive, args.destination)
    elif args.command == "course":
        result = course(read_regular(args.first), read_regular(args.returned), args.output,
                        actor=args.actor, scope_id=args.scope_id,
                        identity_namespace=args.identity_namespace,
                        capture_kind=args.capture_kind, observed_at=args.observed_at)
    else:
        with MigrationWorkspace(args.workspace, create=False) as workspace:
            if args.command == "import":
                result = receive_package(workspace, read_regular(args.package),
                    operation_id=args.operation_id, expected_revision=args.expected_revision,
                    actor=args.actor, scope_id=args.scope_id, identity_namespace=args.identity_namespace,
                    capture_kind=args.capture_kind, observed_at=args.observed_at, reason=args.reason,
                    previous_receipt_source_id=args.previous_receipt_source_id, resume_reason=args.resume_reason)
            elif args.command == "extract":
                result = materialize_package(workspace, args.receipt_source_id, args.output)
            else:
                result = workspace.dispatch("delivery.prepare", {"operation_id":args.operation_id,
                    "expected_revision":args.expected_revision, "actor":args.actor,
                    "title":args.title, "note":args.note})
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (MigrationError, ValueError, OSError) as exc:
        print(json.dumps({"error":exc.as_dict() if isinstance(exc, MigrationError)
                         else {"code":type(exc).__name__, "message":str(exc)}}, ensure_ascii=False),
              file=sys.stderr)
        raise SystemExit(2)
