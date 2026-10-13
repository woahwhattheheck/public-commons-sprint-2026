"""Complete source recipe transfer through the existing workspace object store.

TokenJunkieLabs. A received recipe preserves its original project, request bodies,
all editions and source bytes. New scientific commits use a fresh local inspection.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile
from .common import _sync_directory as _sync_original_directory, _path_stat, _fd_stat

from .common import (atomic_json, canonical, digest, file_digest,
                     held, identifier, now, read_json, retain_file)
from .client_source_files import need
from .client_source_recipes import (validate_record, validate_use, validate_applied,
    validate_custody, validate_use_custody, validate_applied_custody,
    definition_descriptors, use_descriptors, applied_descriptors)

FORMAT = "upstate.client-source-recipe-archive/v1"
RECEIPT = "upstate.client-source-recipe-transfer/v1"
CHUNK = 1024 * 1024
_METADATA = re.compile(
    r"^(recipe/record\.json|recipe/custody/[1-9][0-9]*\.json|"
    r"uses/[0-9a-f]{64}/(use|custody|applied|applied-custody)\.json)$")


def recipe_root(ws):
    return Path(ws.root) / "client-source-recipes"


@contextmanager
def locked_recipes(root, *, blocking=False):
    with held(Path(root) / "client-source-recipes" / ".writer.lock", blocking=blocking):
        yield


def _plain(path):
    path = Path(path)
    value = _path_stat(path)
    need(stat.S_ISREG(value.st_mode), "Keep each complete recipe member as a regular file.")
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _regular(root, relative):
    path = Path(root)
    for part in relative.split("/"):
        need(part not in {"", ".", ".."} and "\\" not in part and "\0" not in part,
             "Keep each recipe member within its original directory.")
        path = path / part
        need(not path.is_symlink(), "A recipe member cannot be a filesystem alias.")
    _plain(path)
    return path


def _fsync_directory(path):
    _sync_original_directory(path)


def _object_expectations(descriptors):
    expected = {}
    for row in descriptors:
        key = identifier(row["sha256"])
        need(type(row.get("bytes")) is int and row["bytes"] >= 0,
             "Keep the full original source byte count.")
        need(key not in expected or expected[key] == row["bytes"],
             "One original object cannot have conflicting byte counts.")
        expected[key] = row["bytes"]
    return expected


def _objects(custody, descriptors):
    expected = _object_expectations(descriptors)
    actual = {}
    for row in custody.get("objects", []):
        key = identifier(row["sha256"])
        need(key not in actual and row.get("object") == "objects/" + key,
             "Keep each original source object once in the existing workspace store.")
        need(type(row.get("bytes")) is int and row["bytes"] >= 0,
             "Keep the full retained source byte count.")
        actual[key] = row["bytes"]
    need(actual == expected, "Retain every complete original and projected source object.")
    return actual


def _applied_custody(use, applied, custody):
    validate_applied_custody(applied, use, custody)
    return _objects(custody, applied_descriptors(applied))


def _compatible(first, second):
    validate_record(first)
    validate_record(second)
    need({k: v for k, v in first.items() if k != "events"} ==
         {k: v for k, v in second.items() if k != "events"},
         "The same recipe identity belongs to a different original record.")
    common = min(len(first["events"]), len(second["events"]))
    need(first["events"][:common] == second["events"][:common],
         "This recipe has divergent saved editions. Keep both originals for reconciliation.")
    return first if len(first["events"]) >= len(second["events"]) else second


def _validate_metadata(metadata):
    need("recipe/record.json" in metadata, "Keep the complete recipe and its full history.")
    record = validate_record(metadata["recipe/record.json"])
    identifier(record["id"])
    expected_names = {"recipe/record.json"}
    objects = {}
    for event in record["events"]:
        name = "recipe/custody/" + str(event["revision"]) + ".json"
        need(name in metadata, "Retain custody for every saved recipe edition.")
        expected_names.add(name)
        custody = validate_custody(record, event, metadata[name])
        for key, size in _objects(custody, definition_descriptors(event["definition"])).items():
            need(key not in objects or objects[key] == size, "Conflicting source byte counts.")
            objects[key] = size
    uses = {}
    for name in sorted(metadata):
        if not name.startswith("uses/") or not name.endswith("/use.json"):
            continue
        key = name.split("/")[1]
        value = validate_use(metadata[name])
        need(value["id"] == key and value["recipe_record"]["id"] == record["id"],
             "A received use selects a different recipe or request.")
        _compatible(record, value["recipe_record"])
        need(len(value["recipe_record"]["events"]) <= len(record["events"]),
             "Keep the full recipe history referenced by every retained use.")
        uses[key] = value
        base = "uses/" + key + "/"
        expected_names.add(name)
        need(base + "custody.json" in metadata, "Retain the full prepared use's source custody.")
        expected_names.add(base + "custody.json")
        custody = validate_use_custody(value, metadata[base + "custody.json"])
        pending = _objects(custody, use_descriptors(value))
        if base + "applied.json" in metadata:
            expected_names |= {base + "applied.json", base + "applied-custody.json"}
            need(base + "applied-custody.json" in metadata, "Retain every applied native result's objects.")
            applied = validate_applied(metadata[base + "applied.json"], value)
            for object_id, size in _applied_custody(value, applied, metadata[base + "applied-custody.json"]).items():
                need(object_id not in pending or pending[object_id] == size, "Conflicting applied source byte counts.")
                pending[object_id] = size
        for object_id, size in pending.items():
            need(object_id not in objects or objects[object_id] == size, "Conflicting source byte counts.")
            objects[object_id] = size
    need(set(metadata) == expected_names, "The archive contains detached or undeclared recipe metadata.")
    return record, uses, objects


def _metadata(ws, recipe_id):
    recipe_id = identifier(recipe_id)
    root = recipe_root(ws)
    record = validate_record(read_json(_regular(root, "recipes/" + recipe_id + "/record.json")))
    need(record["id"] == recipe_id, "The saved recipe directory selects another record.")
    paths = {"recipe/record.json": root / "recipes" / recipe_id / "record.json"}
    for event in record["events"]:
        name = "custody/" + str(event["revision"]) + ".json"
        paths["recipe/" + name] = _regular(root, "recipes/" + recipe_id + "/" + name)
    for directory in sorted((root / "uses").glob("*")):
        need(not directory.is_symlink(), "Keep original uses in ordinary directories.")
        if not directory.is_dir() or not (directory / "use.json").exists():
            continue
        key = identifier(directory.name)
        use = validate_use(read_json(_regular(root, "uses/" + key + "/use.json")))
        if use["recipe_record"]["id"] != recipe_id:
            continue
        for leaf in ("use.json", "custody.json", "applied.json", "applied-custody.json"):
            path = directory / leaf
            if path.exists():
                paths["uses/" + key + "/" + leaf] = _regular(root, "uses/" + key + "/" + leaf)
    metadata = {name: read_json(path) for name, path in paths.items()}
    record, uses, objects = _validate_metadata(metadata)
    return metadata, paths, record, uses, objects


def _verified_object(ws, key, size, verified_members=None):
    path = _regular(ws.root, "objects/" + identifier(key))
    need(path.stat().st_size == size, "The retained scientific source has a different byte count.")
    # Callers only supply this index after their original archive stream has
    # already checked every member against these complete hashes.
    retained = (verified_members or {}).get("workspace/objects/" + key)
    if retained is None:
        retained = (verified_members or {}).get("objects/" + key)
    if retained is not None:
        need(retained.get("sha256") == key and retained.get("bytes") == size,
             "The verified workspace archive contains another original source object.")
    else:
        need(file_digest(path) == key, "The retained scientific source object changed.")
    return path


def verify_workspace(ws, verified_members=None):
    root = recipe_root(ws)
    if not root.exists():
        return []
    need(not root.is_symlink(), "Keep recipe history in its original workspace directory.")
    summaries, checked = [], {}
    known = set()
    for path in sorted((root / "recipes").glob("*/record.json")):
        recipe_id = identifier(path.parent.name)
        metadata, _, record, uses, objects = _metadata(ws, recipe_id)
        for key, size in objects.items():
            if key not in checked:
                _verified_object(ws, key, size, verified_members)
                checked[key] = size
            need(checked[key] == size, "Conflicting retained original source sizes.")
        known.add(recipe_id)
        summaries.append({"recipe_id": recipe_id, "record_sha256": digest(record),
            "revisions": len(record["events"]), "origin_project_id": record["origin_project_id"],
            "uses": [{"id": key, "sha256": uses[key]["sha256"],
                      "applied_sha256": metadata.get("uses/" + key + "/applied.json", {}).get("sha256")}
                     for key in sorted(uses)],
            "objects": [{"sha256": key, "bytes": objects[key]} for key in sorted(objects)]})
    for path in sorted((root / "uses").glob("*/use.json")):
        use = validate_use(read_json(_regular(root, "uses/" + identifier(path.parent.name) + "/use.json")))
        need(use["recipe_record"]["id"] in known, "A prepared use has lost its complete original recipe history.")
    return summaries


def _json_bytes(value):
    return canonical(value) + b"\n"


def _unique_pairs(pairs):
    output = {}
    for key, value in pairs:
        need(key not in output, "A retained JSON member repeats an object key.")
        output[key] = value
    return output


def _json(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite retained number")))


def _read_archive(source, extraction=None):
    before = _plain(source)
    metadata = {}
    with Path(source).open("rb") as opened:
        opened_stat = _fd_stat(opened.fileno())
        need((opened_stat.st_dev, opened_stat.st_ino, opened_stat.st_size,
              opened_stat.st_mtime_ns, opened_stat.st_ctime_ns) == before,
             "The selected archive changed before it was opened.")
        with zipfile.ZipFile(opened) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            need(len(names) == len(set(names)) and "ARCHIVE.json" in names,
                 "Keep one manifest and each complete archive member exactly once.")
            for item in infos:
                mode = item.external_attr >> 16
                need(not item.is_dir() and not stat.S_ISLNK(mode) and
                     (not stat.S_IFMT(mode) or stat.S_ISREG(mode)) and not item.flag_bits & 1,
                     "Only ordinary unencrypted recipe files can be received.")
                need(item.filename == "ARCHIVE.json" or _METADATA.fullmatch(item.filename) or
                     re.fullmatch(r"objects/[0-9a-f]{64}", item.filename),
                     "The recipe archive contains an undeclared path.")
            manifest = _json(archive.read("ARCHIVE.json"))
            need(isinstance(manifest, dict) and set(manifest) ==
                 {"schema", "recipe_id", "origin_project_id", "record_sha256", "revisions", "uses", "members"} and
                 manifest["schema"] == FORMAT and isinstance(manifest["members"], dict),
                 "Open a complete original source recipe archive.")
            need(set(manifest["members"]) == set(names) - {"ARCHIVE.json"},
                 "The recipe manifest and complete member population differ.")
            for item in infos:
                name = item.filename
                if name == "ARCHIVE.json":
                    continue
                expected = manifest["members"][name]
                need(isinstance(expected, dict) and set(expected) == {"bytes", "sha256"} and
                     type(expected["bytes"]) is int and expected["bytes"] >= 0 and
                     item.file_size == expected["bytes"],
                     "Retain the complete recipe member byte count.")
                identifier(expected["sha256"])
                hashing, size = hashlib.sha256(), 0
                buffer = bytearray() if _METADATA.fullmatch(name) else None
                target = None
                try:
                    if extraction is not None:
                        target_path = Path(extraction).joinpath(*name.split("/"))
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        target = target_path.open("xb")
                    with archive.open(item) as member:
                        for block in iter(lambda: member.read(CHUNK), b""):
                            hashing.update(block)
                            size += len(block)
                            if buffer is not None:
                                buffer.extend(block)
                            if target is not None:
                                target.write(block)
                    if target is not None:
                        target.flush()
                        os.fsync(target.fileno())
                finally:
                    if target is not None:
                        target.close()
                need(size == expected["bytes"] and hashing.hexdigest() == expected["sha256"],
                     "A complete received recipe member differs from the original.")
                if buffer is not None:
                    metadata[name] = _json(bytes(buffer))
            record, uses, objects = _validate_metadata(metadata)
            need(manifest["recipe_id"] == record["id"] and manifest["origin_project_id"] == record["origin_project_id"]
                 and manifest["record_sha256"] == digest(record) and manifest["revisions"] == len(record["events"])
                 and manifest["uses"] == sorted(uses), "The archive summary selects another original recipe.")
            object_members = {name.split("/")[1]: row for name, row in manifest["members"].items()
                              if name.startswith("objects/")}
            need(object_members == {key: {"bytes": size, "sha256": key} for key, size in objects.items()},
                 "The archive must contain every referenced source object and no detached objects.")
        opened.seek(0)
        hashing = hashlib.sha256()
        for block in iter(lambda: opened.read(CHUNK), b""):
            hashing.update(block)
    need(_plain(source) == before, "The selected recipe archive changed during receiving.")
    return {"manifest": manifest, "metadata": metadata, "archive_sha256": hashing.hexdigest(),
            "archive_bytes": before[2], "record": record, "uses": uses, "objects": objects}


def inspect_recipe_archive(path):
    value = _read_archive(Path(path))
    return {"schema": FORMAT, "archive_sha256": value["archive_sha256"],
            "archive_bytes": value["archive_bytes"], **deepcopy(value["manifest"])}


def _archive_descriptor(ws, path):
    absolute = Path(path).absolute()
    try:
        relative = absolute.relative_to(Path(ws.root).absolute()).as_posix()
    except ValueError:
        relative = str(absolute)
    return {"path": relative, "bytes": absolute.stat().st_size, "sha256": file_digest(absolute)}


def _operation(ws, kind, operation_id, request):
    directory = recipe_root(ws) / "transfers" / kind / identifier(operation_id)
    directory.mkdir(parents=True, exist_ok=True)
    atomic_json(directory / "request.json", request, immutable=True)
    return directory


def export_recipe(ws, recipe_id, output, *, operation_id):
    recipe_id, operation_id = identifier(recipe_id), identifier(operation_id)
    output = Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    resolved = output.resolve()
    for protected in (Path(ws.root) / "objects", recipe_root(ws) / "recipes",
                      recipe_root(ws) / "uses", recipe_root(ws) / "operations",
                      recipe_root(ws) / "transfers"):
        need(not resolved.is_relative_to(protected.resolve()),
             "Choose an export path outside retained source and recipe records.")
    need(not output.is_symlink(), "Choose an ordinary output archive path.")
    request = {"schema": RECEIPT, "action": "export", "operation_id": operation_id,
               "project_id": ws.project["id"], "recipe_id": recipe_id, "output": str(output)}
    with locked_recipes(ws.root):
        directory = _operation(ws, "export", operation_id, request)
        receipt_path = directory / "receipt.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            need(receipt["request"] == request, "Keep the original recipe export request.")
            need(output.exists() and _archive_descriptor(ws, output) == receipt["archive"],
                 "Restore the retained exported archive at its original requested path.")
            inspect_recipe_archive(output)
            return receipt
        candidate_path = directory / "candidate.json"
        archive_path = directory / "archive.zip"
        if candidate_path.exists():
            candidate = read_json(candidate_path)
            need(candidate["request"] == request, "Keep the complete pending export request.")
            inspected = inspect_recipe_archive(archive_path)
            need(inspected["archive_sha256"] == candidate["archive"]["sha256"] and
                 inspected["archive_bytes"] == candidate["archive"]["bytes"],
                 "The pending complete recipe archive changed.")
        else:
            metadata, paths, record, uses, objects = _metadata(ws, recipe_id)
            inputs = {name: _json_bytes(value) for name, value in metadata.items()}
            retained = {key: _verified_object(ws, key, size) for key, size in objects.items()}
            members = {name: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                       for name, body in inputs.items()}
            members.update({"objects/" + key: {"bytes": size, "sha256": key} for key, size in objects.items()})
            manifest = {"schema": FORMAT, "recipe_id": recipe_id,
                        "origin_project_id": record["origin_project_id"], "record_sha256": digest(record),
                        "revisions": len(record["events"]), "uses": sorted(uses), "members": members}
            handle, temporary = tempfile.mkstemp(prefix=".archive-recipe-", suffix=".pending", dir=directory)
            os.close(handle)
            temporary = Path(temporary)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=3, allowZip64=True) as archive:
                    for name, body in sorted(inputs.items()):
                        archive.writestr(name, body)
                    for key, source in sorted(retained.items()):
                        before = _plain(source)
                        hashed, size = hashlib.sha256(), 0
                        with source.open("rb") as incoming, archive.open("objects/" + key, "w", force_zip64=True) as outgoing:
                            for block in iter(lambda: incoming.read(CHUNK), b""):
                                outgoing.write(block)
                                hashed.update(block)
                                size += len(block)
                        need(_plain(source) == before and hashed.hexdigest() == key and size == objects[key],
                             "An original scientific source changed during export.")
                    archive.writestr("ARCHIVE.json", _json_bytes(manifest))
                # The original Windows file flush requires a writable handle.
                with temporary.open("r+b") as saved:
                    os.fsync(saved.fileno())
                if archive_path.exists():
                    # A crash before candidate publication leaves an unselected
                    # archive. Replace it only inside this exact locked operation.
                    archive_path.unlink()
                os.link(temporary, archive_path)
                _fsync_directory(directory)
            finally:
                temporary.unlink(missing_ok=True)
            descriptor = _archive_descriptor(ws, archive_path)
            candidate = {"schema": RECEIPT, "action": "export", "request": request,
                         "created_at": now(), "recipe_id": recipe_id,
                         "revisions": len(record["events"]), "uses": sorted(uses),
                         "archive": {"path": _archive_descriptor_path(ws, output), **{k: descriptor[k] for k in ("bytes", "sha256")}},
                         "manifest": manifest}
            atomic_json(candidate_path, candidate, immutable=True)
        if output.exists():
            need(_archive_descriptor(ws, output) == candidate["archive"],
                 "The requested archive path already contains another file.")
        else:
            # Cross-filesystem destinations are copied into their own filesystem,
            # then linked without replacing a concurrent independent publication.
            handle, staged = tempfile.mkstemp(prefix=".archive-recipe-", suffix=".pending", dir=output.parent)
            try:
                with os.fdopen(handle, "wb") as outgoing, archive_path.open("rb") as incoming:
                    for block in iter(lambda: incoming.read(CHUNK), b""):
                        outgoing.write(block)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                need(file_digest(Path(staged)) == candidate["archive"]["sha256"],
                     "The complete exported archive changed during delivery.")
                os.link(staged, output)
                _fsync_directory(output.parent)
            finally:
                Path(staged).unlink(missing_ok=True)
        atomic_json(receipt_path, candidate, immutable=True)
        return read_json(receipt_path)


def _archive_descriptor_path(ws, path):
    try:
        return Path(path).absolute().relative_to(Path(ws.root).absolute()).as_posix()
    except ValueError:
        return str(Path(path).absolute())


def _publish_received(ws, value):
    root = recipe_root(ws)
    record = value["record"]
    destination = root / "recipes" / identifier(record["id"]) / "record.json"
    current = validate_record(read_json(destination)) if destination.exists() else None
    selected = _compatible(current, record) if current else record
    # Check every collision before making any received metadata visible.
    for name, body in value["metadata"].items():
        if name == "recipe/record.json":
            continue
        target = (destination.parent / name[len("recipe/"):]) if name.startswith("recipe/") else root / name
        if target.exists():
            need(read_json(_regular(root, target.relative_to(root).as_posix())) == body,
                 "The receiving workspace already has a different complete recipe member.")
    if current:
        _, _, _, _, current_objects = _metadata(ws, record["id"])
        for key, size in current_objects.items():
            if key not in value["objects"]:
                _verified_object(ws, key, size)
            else:
                need(value["objects"][key] == size, "Conflicting existing source byte counts.")
    # CAS objects are complete before history visibility. An interrupted receive
    # can safely reuse already retained content and complete the same request.
    for key, size in value["objects"].items():
        source = value["staging"] / "objects" / key
        retained = retain_file(ws.root, source, key)
        need(retained["bytes"] == size, "The received original object's byte count changed.")
    # Publish custody first, full record second, prepared uses last.
    for name, body in sorted(value["metadata"].items()):
        if name.startswith("recipe/custody/"):
            atomic_json(destination.parent / name[len("recipe/"):], body, immutable=True)
    if current != selected:
        atomic_json(destination, selected)
    for name, body in sorted(value["metadata"].items(), key=lambda item: (item[0].endswith("/use.json"), item[0])):
        if name.startswith("uses/"):
            atomic_json(root / name, body, immutable=True)
    return selected


def receive_recipe(ws, archive, *, operation_id):
    operation_id = identifier(operation_id)
    archive = Path(archive).absolute()
    root = recipe_root(ws)
    root.mkdir(parents=True, exist_ok=True)
    # Full stream validation and extraction precede any destination publication.
    with tempfile.TemporaryDirectory(prefix=".receive-recipe-", dir=root) as temporary:
        value = _read_archive(archive, Path(temporary))
        value["staging"] = Path(temporary)
        request = {"schema": RECEIPT, "action": "receive", "operation_id": operation_id,
                   "project_id": ws.project["id"], "archive_sha256": value["archive_sha256"],
                   "archive_bytes": value["archive_bytes"], "recipe_id": value["record"]["id"]}
        with locked_recipes(ws.root):
            directory = _operation(ws, "receive", operation_id, request)
            receipt_path = directory / "receipt.json"
            existing_receipt = read_json(receipt_path) if receipt_path.exists() else None
            if existing_receipt:
                need(existing_receipt["request"] == request, "Keep the exact original recipe receiving request.")
            retained_archive = retain_file(ws.root, archive, value["archive_sha256"])
            need(retained_archive["bytes"] == value["archive_bytes"],
                 "The full incoming recipe archive changed before retention.")
            selected = _publish_received(ws, value)
            metadata, _, current, uses, objects = _metadata(ws, selected["id"])
            for key, size in objects.items():
                _verified_object(ws, key, size)
            if existing_receipt:
                return existing_receipt
            receipt = {"schema": RECEIPT, "action": "receive", "request": request, "created_at": now(),
                       "recipe_id": selected["id"], "origin_project_id": selected["origin_project_id"],
                       "received_record_sha256": digest(value["record"]),
                       "received_revisions": len(value["record"]["events"]),
                       "retained_record_sha256": digest(current), "retained_revisions": len(current["events"]),
                       "received_uses": sorted(value["uses"]), "retained_uses": sorted(uses),
                       "archive": {"path": retained_archive["object"], "bytes": value["archive_bytes"],
                                   "sha256": value["archive_sha256"]},
                       "source_objects": len(value["objects"])}
            atomic_json(receipt_path, receipt, immutable=True)
            return read_json(receipt_path)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Carry complete scientific source recipes between workspaces.")
    commands = parser.add_subparsers(dest="command", required=True)
    exported = commands.add_parser("export")
    exported.add_argument("workspace")
    exported.add_argument("recipe_id")
    exported.add_argument("archive")
    exported.add_argument("--operation-id", required=True)
    received = commands.add_parser("receive")
    received.add_argument("workspace")
    received.add_argument("archive")
    received.add_argument("--operation-id", required=True)
    inspected = commands.add_parser("inspect")
    inspected.add_argument("archive")
    verified = commands.add_parser("verify")
    verified.add_argument("workspace")
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = inspect_recipe_archive(args.archive)
    else:
        from .workspace import Workspace
        path = Path(args.workspace)
        need(path.is_dir(), "Select an existing scientific workspace.")
        ws = Workspace(path)
        if args.command == "export":
            result = export_recipe(ws, args.recipe_id, args.archive, operation_id=args.operation_id)
        elif args.command == "receive":
            result = receive_recipe(ws, args.archive, operation_id=args.operation_id)
        else:
            with locked_recipes(ws.root):
                result = verify_workspace(ws)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
