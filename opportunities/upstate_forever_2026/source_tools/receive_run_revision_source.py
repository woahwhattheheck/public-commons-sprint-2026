#!/usr/bin/env python3
"""Receive the reviewed PR4322 source through the maintained application assembler.

Read an existing complete application and the exact public ten-file carrier.
The maintained assembler checks the complete original component/import closure
and publishes a separate application directory. This command changes no running
application, Workspace, task, model result or process.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

BANK_SHA256 = "251e805fe9486da340ad1065e14140d5c8d0b5b31f68c4237719826c8e685c72"
BANK_BYTES = 280022
OPERATION = "ECO-264B-RUN-REVISION-GIS-PR4322"
EDITION = "gis-run-revision-pr4322"
COMPONENT = "gis-run-revision"
# Exact later public owner repair; its complete PR4322 runtime joins are unchanged.
RETAINED_SUCCESSORS = {
    "source/GIS_RUN_REVISION.md": {
        "7fadde091b71a406c7c7eec6ab1bef339aed9ca6": "a2c1fd5ccf36e51ba1e4a6cb542aa386782dc50c946d6de1f1b47b92e55f36f7",
    },
    "operator/gis_projects.py": {
        "8866d4380e5d2c2da6b3132f6dd75665853570cc": "1514b5774992ee0a7430a817a6e14cbf428b79599ef05b919851b0888fa78ebd",
    },
}


def sha(body):
    return hashlib.sha256(body).hexdigest()


def plain(path):
    path = Path(path).absolute()
    for candidate in (path, *path.parents):
        if candidate.is_symlink():
            raise ValueError("Choose a retained path without symbolic links: " + str(path))
    return path


def member(root, name):
    relative = PurePosixPath(name)
    if (not isinstance(name, str) or not name or relative.is_absolute()
            or relative.as_posix() != name or "\\" in name
            or any(part in {".", ".."} for part in relative.parts)):
        raise ValueError("Invalid application-relative source path")
    path = plain(root.joinpath(*relative.parts))
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Source path leaves the selected application")
    return path


def original_blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode("ascii") + b"\0" + body).hexdigest()


def receive(application, bank_path, output):
    application = plain(application).resolve(strict=True)
    bank_path = plain(bank_path)
    output = plain(output).resolve()
    if output == application or output.is_relative_to(application) or application.is_relative_to(output):
        raise ValueError("The receiving application must be separate from its original")
    bank = json.loads(bank_path.read_text(encoding="utf-8-sig"))
    if bank.get("schema") == "upstate.run-revision-source-receiving/v1":
        bank = bank["source_bank"]
    normalized = (json.dumps(bank, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(normalized) != BANK_BYTES or sha(normalized) != BANK_SHA256:
        raise ValueError("Use the complete independently verified PR4322 ten-file carrier")
    if bank.get("schema") != "commons.source-bank/v1" or bank.get("file_count") != 10:
        raise ValueError("Unexpected source bank schema/count")
    files, manifest = bank["files"], bank["manifest"]
    if (len(manifest) != 10 or len(files) != 10
            or len({row["path"] for row in manifest}) != 10
            or set(files) != {row["path"] for row in manifest}):
        raise ValueError("The source bank member inventories differ")
    metadata, joins, conflicts = {}, [], []
    selected_files = dict(files)
    for row in manifest:
        name = row["path"]
        body = files[name].encode("utf-8")
        if len(body) != row["bytes"] or sha(body) != row["sha256"]:
            raise ValueError("Original source member differs: " + name)
        if original_blob(body) != row["git_blob"]:
            raise ValueError("Original public Git member differs: " + name)
        destination = member(application, name)
        existing = destination.read_bytes() if destination.is_file() else None
        if destination.exists() and existing is None:
            raise ValueError("Source destination is not a regular file: " + name)
        mode = "100755" if existing is not None and destination.stat().st_mode & 0o111 else "100644"
        item = {"encoding": "utf-8", "mode": mode, "bytes": len(body),
                "sha256": sha(body), "git_blob": row["git_blob"]}
        if existing is None:
            state = "add_complete_member"
        elif existing == body:
            state = "retain_identical_member"
        elif RETAINED_SUCCESSORS.get(name, {}).get(original_blob(existing)) == sha(existing):
            selected_files[name] = existing.decode("utf-8")
            item.update(bytes=len(existing), sha256=sha(existing), git_blob=original_blob(existing))
            state = "retain_verified_complete_successor"
        elif original_blob(existing) == row.get("predecessor_git_blob"):
            item["base_sha256"] = sha(existing)
            state = "join_reviewed_predecessor"
        else:
            conflicts.append({"path": name, "current_git_blob": original_blob(existing),
                              "current_sha256": sha(existing),
                              "reviewed_predecessor_git_blob": row.get("predecessor_git_blob"),
                              "incoming_git_blob": row["git_blob"]})
            continue
        metadata[name] = item
        joins.append({"path": name, "state": state,
                      "before_sha256": sha(existing) if existing is not None else None,
                      "sha256": item["sha256"], "bytes": item["bytes"],
                      "git_blob": item["git_blob"]})
    if conflicts:
        error = ValueError("Compose the actual newer/earlier owner sources before receiving")
        error.source_joins = conflicts
        raise error

    assembler = member(application, "source_tools/application_assembly.py")
    if not assembler.is_file():
        raise ValueError("Receive the maintained cumulative application assembler first")
    sys.path[:0] = [str(application), str(application / "source_tools")]
    spec = importlib.util.spec_from_file_location("_upstate_original_application_assembly", assembler)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    for name in ("snapshot_application", "layer_from_document", "compose", "canonical",
                 "source_receipt", "require_components", "receive_directory"):
        if not callable(getattr(module, name, None)):
            raise ValueError("The retained application assembler lacks " + name)
    overlay = {**bank, "files": selected_files, "file_metadata": metadata}
    base = module.snapshot_application(application)
    layer = module.layer_from_document(overlay, {
        "carrier_name": bank_path.name, "payload_sha256": BANK_SHA256,
        "payload_bytes": BANK_BYTES, "original_public_carrier": True})
    document = module.compose([base, layer], edition=EDITION, operation_id=OPERATION)
    closure = module.require_components(document)
    for row in manifest:
        if document["files"].get(row["path"]) != selected_files[row["path"]]:
            raise ValueError("The maintained composition did not retain all ten source members")
    # Component reports retain the authoritative selected catalogue and its IDs.
    if COMPONENT not in json.loads(document["files"]["integration/component_fragments/gis-run-revision.json"])["components"]:
        raise ValueError("The original run-revision component fragment was not admitted")
    payload = module.canonical(document)
    receipt = module.source_receipt(document, payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    received = module.receive_directory(output, document, receipt)
    return {"state": "application_source_received", "operation_id": OPERATION,
            "original_application": str(application), "application": str(output),
            "source_bank_sha256": BANK_SHA256, "reviewed_members": joins,
            "component_inventory": closure, "received": received,
            "native_execution": "not_started", "workspace_changed": False,
            "next": "The sole existing owner uses this application at the original completed writer boundary."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--bank", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = receive(args.application, args.bank, args.output)
    except Exception as error:
        result = {"state": "error", "type": type(error).__name__, "message": str(error)}
        for key in ("source_joins", "component_closure"):
            if hasattr(error, key):
                result[key] = getattr(error, key)
        print(json.dumps(result, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
