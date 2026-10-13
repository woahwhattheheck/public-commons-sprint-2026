"""Retain one complete imported watershed source entry in a portable report.

Calculation inputs keep the loader's existing names and fingerprint. The
selected entry's complete native directory layout and metadata have a separate
identity and an ordinary Workspace-importable manifest.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile

from model.common import (
    atomic_json, canonical, describe_file, digest, file_digest, identifier,
    relative_file,
)

SCHEMA = "upstate.watershed-source-entry-closure/v1"
RESERVED = frozenset({
    "_source-entry.json", "_source-entry-manifest.json",
    "_original-source-manifest.json",
})


def _clone(value):
    return json.loads(canonical(value))


def _native_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Retain the original portable source member path.")
    member = Path(value)
    if (member.is_absolute() or not member.parts or ".." in member.parts
            or member.as_posix() != value or value == "."):
        raise ValueError("Retain the original portable source member path.")
    return member


def _input_fingerprint(inputs):
    """Match the existing regional loader's calculation-input identity."""
    return digest(sorted(
        ({"id": row["name"], "sha256": row["sha256"]} for row in inputs),
        key=lambda row: row["id"],
    ))


def capture_source_entry(workspace, collection_id, source_id, *, model_inputs):
    """Resolve all selected-entry bytes, including companions in sibling dates.

    model_inputs is the original load_source_edition()["source_files"] list.
    No directory scan or unrelated entry is added to the retained selection.
    Paths in the returned members are live local references for the writer;
    the portable record omits those local paths.
    """
    model_inputs = [dict(row) for row in model_inputs]
    collection_id = identifier(collection_id)
    if not isinstance(source_id, str) or not source_id:
        raise ValueError("Choose the original imported source entry.")
    context_path, entry = workspace.source_file(collection_id, source_id)
    context_path = Path(context_path).resolve(strict=True)
    collection = workspace._get("sources", collection_id)
    if entry.get("id") != source_id:
        raise ValueError("The selected source entry identity changed.")

    body = entry["body"]
    body_name = body.get("view_path", body["filename"])
    body_member = _native_path(body_name)
    view_root = context_path
    for _ in body_member.parts:
        view_root = view_root.parent
    if (view_root / body_member).resolve(strict=True) != context_path:
        raise ValueError("The original source view layout changed.")

    members = []
    by_path = {}
    names = set()
    originals = [("body", body)] + [
        ("companion", member) for member in entry.get("companions", [])
    ]
    for role, original in originals:
        name = original.get("view_path", original["filename"])
        member = _native_path(name)
        if name in names or member.parts[0] in RESERVED:
            raise ValueError("The selected source has colliding portable member names.")
        names.add(name)
        path = view_root / member
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(view_root):
            raise ValueError("The original source member escapes its selected entry.")
        path = path.resolve(strict=True)
        retained = relative_file(workspace.root, original["object"])
        if (not path.is_file() or path.stat().st_size != original["bytes"]
                or file_digest(path) != original["sha256"]):
            raise ValueError("A selected source member differs from its original bytes.")
        # source_file already verified each underlying original and created
        # the native view; this retains the same authoritative descriptor.
        if not retained.is_file():
            raise ValueError("An original retained source object is unavailable.")
        row = {
            "name": name, "view_path": name, "role": role,
            "path": str(path), "bytes": original["bytes"],
            "sha256": original["sha256"],
        }
        members.append(row)
        by_path[str(path)] = row

    inputs = []
    seen_inputs = set()
    for supplied in model_inputs:
        row = dict(supplied)
        name = row.get("name")
        if not isinstance(name, str) or not name or name in seen_inputs:
            raise ValueError("Keep distinct original model-input names.")
        seen_inputs.add(name)
        selected = by_path.get(str(Path(row["path"]).resolve(strict=True)))
        if selected is None:
            raise ValueError("A model input is outside the selected source entry.")
        if row["bytes"] != selected["bytes"] or row["sha256"] != selected["sha256"]:
            raise ValueError("A model input differs from its retained original member.")
        inputs.append({
            "name": name, "bytes": row["bytes"], "sha256": row["sha256"],
            "member_path": selected["view_path"],
        })
    if not inputs or str(context_path) not in {
            str(Path(row["path"]).resolve(strict=True)) for row in model_inputs}:
        raise ValueError("The original source context must be a calculation input.")
    inputs.sort(key=lambda row: row["name"])
    members.sort(key=lambda row: row["view_path"])

    native_entry = {
        key: _clone(value) for key, value in entry.items()
        if key not in {"body", "companions"}
    }
    native_entry.update({
        "path": body_name, "sha256": body["sha256"],
        "companions": [
            {"path": row["view_path"], "sha256": row["sha256"]}
            for row in members if row["role"] == "companion"
        ],
    })
    manifest = {
        "schema": "upstate.sources/v1",
        "title": collection.get("title") or entry["title"],
        "captured_at": collection.get("captured_at"),
        "entries": [native_entry],
        "notes": _clone(collection.get("notes", [])),
        "scope": _clone(collection.get("scope", {})),
    }
    original_manifest = collection.get("original_manifest")
    if not original_manifest:
        raise ValueError("The original imported source manifest is unavailable.")
    original_manifest_path = relative_file(workspace.root, original_manifest["object"])
    if (original_manifest_path.stat().st_size != original_manifest["bytes"]
            or file_digest(original_manifest_path) != original_manifest["sha256"]):
        raise ValueError("The original imported manifest bytes changed.")
    identity = {
        "source_collection_id": collection_id, "source_id": source_id,
        "manifest": manifest,
        "members": [
            {key: row[key] for key in ("view_path", "role", "bytes", "sha256")}
            for row in members
        ],
        "original_manifest": {
            "bytes": original_manifest["bytes"],
            "sha256": original_manifest["sha256"],
        },
    }
    return {
        "schema": SCHEMA,
        "source_collection_id": collection_id, "source_id": source_id,
        "body_view_path": body_name,
        "model_inputs": inputs,
        "model_input_fingerprint": _input_fingerprint(inputs),
        "source_edition_fingerprint": digest(identity),
        "identity": identity, "manifest": manifest, "members": members,
        "original_manifest": {
            "path": str(original_manifest_path),
            "bytes": original_manifest["bytes"],
            "sha256": original_manifest["sha256"],
        },
    }


def _retain_exact(source, target, expected):
    source, target = Path(source), Path(target)
    if target.is_symlink():
        raise ValueError("A portable source member must be a regular file.")
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        try:
            os.link(source, target)
        except FileExistsError:
            pass
        except OSError:
            pending = None
            try:
                with tempfile.NamedTemporaryFile(
                        dir=target.parent, prefix=".source-entry-", delete=False) as out:
                    pending = Path(out.name)
                    with source.open("rb") as incoming:
                        shutil.copyfileobj(incoming, out, 1024 * 1024)
                    out.flush()
                    os.fsync(out.fileno())
                if (pending.stat().st_size != expected["bytes"]
                        or file_digest(pending) != expected["sha256"]):
                    raise ValueError("An original source changed during portable retention.")
                try:
                    os.link(pending, target)
                except FileExistsError:
                    pass
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
    if (target.is_symlink() or not target.is_file()
            or target.stat().st_size != expected["bytes"]
            or file_digest(target) != expected["sha256"]):
        raise ValueError("The portable source member differs from its original.")


def retain_source_entry(closure, report_directory, *, source_prefix="source"):
    """Write a complete selected edition; return ordinary report file descriptors.

    Call inside the report's existing workspace transaction before its final
    record is committed. Existing identical bytes are reused; changed files
    require the caller's new edition/report selection.
    """
    if closure.get("schema") != SCHEMA:
        raise ValueError("Choose a captured original source-entry closure.")
    if digest(closure["identity"]) != closure["source_edition_fingerprint"]:
        raise ValueError("The complete source-edition identity changed.")
    root = Path(report_directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    prefix = _native_path(source_prefix)
    source_root = root / prefix
    if not source_root.resolve().is_relative_to(root):
        raise ValueError("The portable source directory escapes the report.")
    expected_members = {
        row["view_path"]: row for row in closure["identity"]["members"]
    }
    if set(expected_members) != {row["view_path"] for row in closure["members"]}:
        raise ValueError("The complete selected source membership changed.")
    if (_input_fingerprint(closure["model_inputs"])
            != closure["model_input_fingerprint"]):
        raise ValueError("The calculation-input fingerprint changed.")
    for row in closure["model_inputs"]:
        selected = expected_members.get(row["member_path"])
        if selected is None or any(
                row[key] != selected[key] for key in ("bytes", "sha256")):
            raise ValueError("A calculation input differs from the retained source entry.")
    if (closure["body_view_path"]
            != closure["identity"]["manifest"]["entries"][0]["path"]):
        raise ValueError("The original source-context path changed.")
    files = {}
    for row in closure["members"]:
        name = row["view_path"]
        expected = expected_members[name]
        if any(row[key] != expected[key] for key in ("role", "bytes", "sha256")):
            raise ValueError("The selected source descriptor changed.")
        member = _native_path(name)
        if member.parts[0] in RESERVED:
            raise ValueError("The selected source has colliding portable member names.")
        target = source_root / member
        if not target.parent.resolve().is_relative_to(source_root.resolve()):
            raise ValueError("A portable source member escapes the report source directory.")
        _retain_exact(row["path"], target, expected)
        descriptor = describe_file(root, target)
        files[descriptor["path"]] = descriptor

    original = closure["original_manifest"]
    expected = closure["identity"]["original_manifest"]
    if any(original[key] != expected[key] for key in ("bytes", "sha256")):
        raise ValueError("The original source-manifest descriptor changed.")
    target = source_root / "_original-source-manifest.json"
    _retain_exact(original["path"], target, expected)
    descriptor = describe_file(root, target)
    files[descriptor["path"]] = descriptor

    manifest = closure["identity"]["manifest"]
    if manifest != closure["manifest"]:
        raise ValueError("The portable source manifest changed.")
    record = {
        key: _clone(closure[key]) for key in (
            "schema", "source_collection_id", "source_id", "body_view_path",
            "model_inputs", "model_input_fingerprint", "source_edition_fingerprint",
            "identity",
        )
    }
    for name, value in (
            ("_source-entry-manifest.json", manifest),
            ("_source-entry.json", record)):
        target = source_root / name
        if target.is_symlink():
            raise ValueError("A portable source manifest must be a regular file.")
        atomic_json(target, value, immutable=True)
        descriptor = describe_file(root, target)
        files[descriptor["path"]] = descriptor
    return files
