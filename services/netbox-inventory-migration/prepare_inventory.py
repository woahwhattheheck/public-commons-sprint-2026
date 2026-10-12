#!/usr/bin/env python3
"""Prepare an auditable inventory packet for the original NetBox custom script."""
from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import uuid

from inventory_migration import (
    CATALOG, FIELDS, LINKS, MAX_BYTES, MAX_OBJECTS, MAX_RESULT_BYTES, ORDER, SCHEMA,
    InventoryError, canonical, clean_scalar, digest, keys, load_json, positive_id, validate_packet,
)

MAPPING_SCHEMA = "tjlabs.netbox.mapping/v1"
WORKSPACE_SCHEMA = "tjlabs.netbox.workspace/v1"
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024
OMIT = object()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def read_bytes(path, maximum=MAX_RESULT_BYTES):
    path = Path(path)
    with path.open("rb") as handle:
        raw = handle.read(maximum + 1)
    if len(raw) > maximum:
        raise InventoryError(str(path) + " exceeds its supported byte limit.")
    return raw


def read_json(path, maximum=MAX_RESULT_BYTES):
    return load_json(read_bytes(path, maximum), limit=maximum)


def sync_directory(path):
    descriptor = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_atomic(path, raw, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise InventoryError("The retained output path is a symbolic link: " + str(path))
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        if immutable:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if read_bytes(path, max(MAX_RESULT_BYTES, len(raw))) != raw:
                    raise InventoryError("This retained filename contains another edition: " + str(path))
        else:
            os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


@contextlib.contextmanager
def workspace_lock(directory):
    root = Path(directory).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    descriptor = os.open(str(root / ".inventory.lock"),
                         os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise InventoryError("The original workspace is in use by another operator command.") from exc
        yield root
    finally:
        os.close(descriptor)


def load_workspace(directory):
    root = Path(directory).resolve()
    restore_marker = root / ".restore-operation.json"
    if restore_marker.exists() and read_json(restore_marker).get("state") != "COMPLETE":
        raise InventoryError("The original handover restore is still incomplete; resume that same archive.")
    return _read_workspace_files(root)


def _read_workspace_files(directory):
    """Validate original workspace bytes; the restorer calls this before publication."""
    root = Path(directory).resolve()
    manifest = read_json(root / "workspace.json")
    keys(manifest, ("schema", "operation_id", "created_at", "mapping_sha256", "request_sha256",
                    "payload_sha256", "netbox_url", "tenant_id", "sources", "source_manifest_sha256"),
         "Workspace")
    if manifest.get("schema") != WORKSPACE_SCHEMA:
        raise InventoryError("Unsupported inventory workspace.")
    request = read_bytes(root / "request.json", MAX_BYTES)
    if sha_bytes(request) != manifest["request_sha256"]:
        raise InventoryError("The retained request bytes differ from their original workspace identity.")
    packet = validate_packet(load_json(request))
    if digest(packet) != manifest["payload_sha256"] or packet["operation_id"] != manifest["operation_id"]:
        raise InventoryError("The retained inventory no longer matches the original operation.")
    source_manifest = read_json(root / "sources.json")
    if digest(source_manifest) != manifest["source_manifest_sha256"]:
        raise InventoryError("The original source-file manifest changed.")
    for item in source_manifest:
        source = root / item["retained"]
        if source.parent.resolve() != (root / "sources").resolve():
            raise InventoryError("A retained source path escapes the source directory.")
        raw = read_bytes(source, MAX_SOURCE_BYTES)
        if len(raw) != item["bytes"] or sha_bytes(raw) != item["sha256"]:
            raise InventoryError("A retained original source file changed: " + item["name"])
    return root, manifest, packet, request


def expression(expression, record, *, permitted_extra=()):
    keys(expression, ("column", "value", "trim", "lower", "blank", "values", *permitted_extra), "Mapping expression")
    if expression.get("blank", "omit") not in ("omit", "null", "empty"):
        raise InventoryError("blank must be omit, null or empty.")
    if ("column" in expression) == ("value" in expression):
        raise InventoryError("A mapping expression must select one column or one literal value.")
    if "column" in expression:
        column = expression["column"]
        if not isinstance(column, str) or column not in record:
            raise InventoryError("Missing source column: " + str(column))
        value = record[column]
    else:
        value = expression["value"]
    for option in ("trim", "lower"):
        if option in expression and not isinstance(expression[option], bool):
            raise InventoryError(option + " must be a JSON boolean.")
    if isinstance(value, str):
        if expression.get("trim", True):
            value = value.strip()
        if expression.get("lower", False):
            value = value.lower()
        if value == "":
            blank = expression.get("blank", "omit")
            if blank == "omit":
                return OMIT
            if blank == "null":
                return None
            if blank != "empty":
                raise InventoryError("blank must be omit, null or empty.")
    if "values" in expression:
        choices = expression["values"]
        if not isinstance(choices, dict):
            raise InventoryError("values must be an explicit source-value mapping.")
        lookup = str(value)
        if lookup not in choices:
            raise InventoryError("No mapped value for source value: " + lookup)
        value = choices[lookup]
    return value


def convert(value, kind):
    if value is OMIT or value is None:
        return value
    if kind in ("int", "id"):
        if isinstance(value, str):
            if not re.fullmatch(r"[+-]?[0-9]+", value):
                raise InventoryError("Expected an exact integer, found " + repr(value))
            value = int(value)
        if not isinstance(value, int) or isinstance(value, bool):
            raise InventoryError("Expected an integer.")
        if kind == "id" and not positive_id(value):
            raise InventoryError("A native NetBox ID must be a positive integer.")
        return value
    if kind == "bool":
        if isinstance(value, str):
            lowered = value.lower()
            if lowered in ("true", "yes", "1"):
                value = True
            elif lowered in ("false", "no", "0"):
                value = False
            else:
                raise InventoryError("Expected true/false, yes/no or 1/0.")
        return clean_scalar(value, "bool")
    if kind == "decimal" and isinstance(value, (int, float)):
        raise InventoryError("An exact decimal must be a CSV string or a JSON string, not a floating-point number.")
    return clean_scalar(value, kind)


def csv_records(raw, path):
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise InventoryError(str(path) + " is not UTF-8 CSV: " + str(exc)) from exc
    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        headers = next(reader)
    except StopIteration as exc:
        raise InventoryError(str(path) + " has no header row.") from exc
    if not headers or any(not name or "\x00" in name for name in headers) or len(headers) != len(set(headers)):
        raise InventoryError(str(path) + " has empty or duplicate CSV header names.")
    records = []
    for row in reader:
        if len(row) != len(headers):
            raise InventoryError(str(path) + ": data row " + str(len(records) + 1)
                                 + " has a different number of fields from its header.")
        records.append(dict(zip(headers, row)))
        if len(records) > MAX_OBJECTS:
            raise InventoryError(str(path) + " exceeds 5,000 data rows in this migration.")
    return records


def compile_mapping(mapping, mapping_path, operation_id):
    keys(mapping, ("schema", "netbox_url", "tenant_id", "source_notes", "sources"), "Mapping")
    if mapping.get("schema") != MAPPING_SCHEMA:
        raise InventoryError("Unsupported mapping schema.")
    sources = mapping.get("sources")
    if not isinstance(sources, list) or not 1 <= len(sources) <= 32:
        raise InventoryError("Select one to 32 CSV source mappings.")
    packet = {"schema": SCHEMA, "operation_id": operation_id, "tenant_id": mapping.get("tenant_id"),
              "netbox_url": mapping.get("netbox_url"), "source_notes": mapping.get("source_notes", ""),
              "sources": [], "objects": []}
    captures, errors, source_names = {}, [], set()
    for source_number, definition in enumerate(sources, 1):
        try:
            keys(definition, ("kind", "file", "key", "match_id", "fields", "links", "catalog", "primary"), "CSV source mapping")
            kind = definition.get("kind")
            if kind not in ORDER:
                raise InventoryError("Select a supported inventory kind.")
            if not isinstance(definition.get("file"), str) or not definition["file"]:
                raise InventoryError("Select the original CSV path.")
            path = Path(definition["file"])
            if not path.is_absolute():
                path = Path(mapping_path).resolve().parent / path
            path = path.resolve()
            raw = read_bytes(path, MAX_SOURCE_BYTES)
            file_sha = sha_bytes(raw)
            records = csv_records(raw, path)
            if file_sha not in captures:
                if sum(len(value[1]) for value in captures.values()) + len(raw) > MAX_TOTAL_SOURCE_BYTES:
                    raise InventoryError("The selected original CSV sources exceed 64 MiB.")
                retained = "sources/" + file_sha + ".csv"
                name = path.name
                if name in source_names:
                    name = str(source_number) + "-" + name
                source_names.add(name)
                capture = {"name": name, "sha256": file_sha, "bytes": len(raw), "rows": len(records),
                           "original_path": str(path), "retained": retained}
                captures[file_sha] = (capture, raw)
                packet["sources"].append({key: capture[key] for key in ("name", "sha256", "bytes", "rows")})
            for target, allowed in (("fields", FIELDS[kind]), ("links", LINKS[kind]), ("catalog", CATALOG[kind])):
                keys(definition.get(target, {}), allowed, kind + " " + target)
            for row_number, record in enumerate(records, 1):
                try:
                    key = convert(expression(definition.get("key"), record), "text")
                    if key is OMIT or not key:
                        raise InventoryError("The source key is empty.")
                    row = {"kind": kind, "key": key, "fields": {}, "links": {}, "catalog": {},
                           "source": {"sha256": file_sha, "row": row_number, "row_sha256": digest(record)}}
                    if "match_id" in definition:
                        value = convert(expression(definition["match_id"], record), "id")
                        if value is not OMIT and value is not None:
                            row["match_id"] = value
                    for field, rule in definition.get("fields", {}).items():
                        value = convert(expression(rule, record), FIELDS[kind][field])
                        if value is not OMIT:
                            row["fields"][field] = value
                    for field, rule in definition.get("links", {}).items():
                        mode = rule.get("by") if isinstance(rule, dict) else None
                        if mode not in ("key", "id"):
                            raise InventoryError("A link must explicitly use by:key or by:id.")
                        value = convert(expression(rule, record, permitted_extra=("by",)),
                                        "text" if mode == "key" else "id")
                        if value is not OMIT:
                            row["links"][field] = None if value is None else {mode: value}
                    for field, rule in definition.get("catalog", {}).items():
                        value = convert(expression(rule, record), "id")
                        if value is not OMIT:
                            row["catalog"][field] = value
                    if "primary" in definition:
                        value = convert(expression(definition["primary"], record), "bool")
                        if value is not OMIT:
                            row["primary"] = value
                    packet["objects"].append(row)
                    if len(packet["objects"]) > MAX_OBJECTS:
                        raise InventoryError("The combined inventory exceeds 5,000 objects.")
                except (InventoryError, TypeError, KeyError) as exc:
                    errors.append({"source": path.name, "kind": kind, "row": row_number, "error": str(exc)})
        except (InventoryError, OSError, csv.Error) as exc:
            errors.append({"source_mapping": source_number, "error": str(exc)})
    if not errors:
        try:
            validate_packet(packet)
            if len(json_bytes(packet)) > MAX_BYTES:
                raise InventoryError("The complete request.json exceeds 8 MiB.")
        except InventoryError as exc:
            errors.append({"error": str(exc)})
    return packet, list(captures.values()), errors


def prepare(mapping_path, directory, operation_id=None):
    mapping_path = Path(mapping_path).resolve()
    mapping_raw = read_bytes(mapping_path, MAX_BYTES)
    mapping = load_json(mapping_raw)
    with workspace_lock(directory) as root:
        prior = read_json(root / "workspace.json") if (root / "workspace.json").exists() else None
        started_path = root / "preparation.json"
        if started_path.exists():
            started = read_json(started_path)
            if started["mapping_sha256"] != sha_bytes(mapping_raw):
                raise InventoryError("This preparation has another mapping. Prepare the corrected edition in a new directory.")
            if operation_id and operation_id != started["operation_id"]:
                raise InventoryError("The original preparation already has another operation ID.")
            operation_id = started["operation_id"]
        else:
            operation_id = operation_id or "nbx-" + uuid.uuid4().hex
            started = {"operation_id": operation_id, "mapping_sha256": sha_bytes(mapping_raw), "created_at": now()}
            write_atomic(started_path, json_bytes(started), immutable=True)
        packet, captures, errors = compile_mapping(mapping, mapping_path, operation_id)
        write_atomic(root / "mapping.json", mapping_raw, immutable=True)
        for capture, raw in captures:
            write_atomic(root / capture["retained"], raw, immutable=True)
        source_manifest = [capture for capture, _ in captures]
        write_atomic(root / "sources.json", json_bytes(source_manifest), immutable=True)
        correction = {"schema": "tjlabs.netbox.corrections/v1", "operation_id": operation_id,
                      "mapping_sha256": sha_bytes(mapping_raw), "errors": errors}
        write_atomic(root / "corrections.json", json_bytes(correction), immutable=True)
        if errors:
            return {"state": "CORRECTION_REQUIRED", "workspace": str(root), "operation_id": operation_id,
                    "errors": len(errors), "corrections": str(root / "corrections.json")}
        request = json_bytes(packet)
        manifest = {"schema": WORKSPACE_SCHEMA, **started, "request_sha256": sha_bytes(request),
                    "payload_sha256": digest(packet), "netbox_url": packet["netbox_url"],
                    "tenant_id": packet["tenant_id"], "sources": len(source_manifest),
                    "source_manifest_sha256": digest(source_manifest)}
        write_atomic(root / "request.json", request, immutable=True)
        write_atomic(root / "workspace.json", json_bytes(manifest), immutable=True)
        _, retained, original, _ = load_workspace(root)
        if prior and retained != prior:
            raise InventoryError("The original workspace manifest changed during preparation.")
        return {"state": "PREPARED", "workspace": str(root), "operation_id": operation_id,
                "payload_sha256": retained["payload_sha256"],
                "objects": {kind: sum(row["kind"] == kind for row in original["objects"]) for kind in ORDER},
                "request": str(root / "request.json")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", required=True, help="The exact customer CSV mapping JSON.")
    parser.add_argument("--workspace", required=True, help="A private directory retaining this migration edition.")
    parser.add_argument("--operation-id", help="Optional stable ID for a first preparation; preserved on reopen.")
    args = parser.parse_args()
    try:
        result = prepare(args.mapping, args.workspace, args.operation_id)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["state"] == "PREPARED" else 2
    except (InventoryError, OSError, csv.Error) as exc:
        print(json.dumps({"state": "CORRECTION_REQUIRED", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
