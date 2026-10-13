"""Adopt completed native CLI reports into the original saved-edition lifecycle.

TokenJunkieLabs. The original renderer and archive capture remain authoritative.
Adoption retains their bytes and render identity; it never renders a new report.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path

from .common import atomic_json, describe_file, digest, held, identifier, read_json, relative_file, verify_file
from . import observed_context
from . import scientific_report_editions as editions

KIND = "observed-reports"
CAPTURE_SCHEMA = "upstate.observed-report-capture/v1"
ORIGIN_SCHEMA = "upstate.scientific-report-capture-origin/v1"
PREVIEW_SCHEMA = "upstate.scientific-report-capture-preview/v1"


def _file(root, name):
    root = Path(root).resolve(strict=True)
    path = relative_file(root, name)
    if (path.is_symlink() or not path.is_file()
            or path.resolve(strict=True) != root / name):
        raise ValueError("Keep the original captured report files at their ordinary retained paths.")
    return path


def _verified(root, descriptor, *, contents=True):
    if (not isinstance(descriptor, dict) or type(descriptor.get("bytes")) is not int
            or descriptor["bytes"] < 0):
        raise ValueError("The captured report needs its exact file length and SHA256.")
    identifier(descriptor.get("sha256"))
    path = _file(root, descriptor.get("path"))
    if path.stat().st_size != descriptor["bytes"]:
        raise ValueError("A retained completed report file changed length.")
    if contents:
        verify_file(root, descriptor)
    return path


def _capture_directory(workspace, capture_id):
    capture_id = identifier(capture_id)
    root = Path(workspace.root).resolve(strict=True)
    directory = root / KIND / capture_id
    if (directory.is_symlink() or not directory.is_dir()
            or directory.resolve(strict=True) != directory):
        raise ValueError("Choose an original completed report captured inside this Workspace.")
    return directory


def _validate(workspace, capture_id, capture, identity, result, operation):
    if (not isinstance(capture, dict) or capture.get("schema") != CAPTURE_SCHEMA
            or capture.get("project_id") != workspace.project["id"]):
        raise ValueError("The captured report belongs to another original project.")
    if (not isinstance(identity, dict)
            or identity.get("schema") != "upstate.observed-report-native/v1"):
        raise ValueError("Keep the original completed report selection.")
    edition_id = digest(identity)
    if (not isinstance(result, dict) or result.get("state") != "complete"
            or result.get("operation_id") != "observed-report-" + edition_id[:20]
            or any(result.get(name) != value for name, value in identity.items())):
        raise ValueError("The captured operation differs from its completed render identity.")
    retained_key = digest({name: value for name, value in result.items()
                           if name not in ("files", "output")})
    if capture_id != retained_key:
        raise ValueError("The completed report capture has another original identity.")
    files = result.get("files")
    if (not isinstance(files, dict) or not files or "operation" in files or "capture" in files
            or any(not isinstance(item, dict) for item in files.values())):
        raise ValueError("Keep the complete original report file roles and descriptors.")
    if (capture.get("operation_id") != result["operation_id"]
            or capture.get("selection") != identity.get("selection")
            or capture.get("report_binding") != identity.get("binding")
            or capture.get("files") != {**files, "operation": operation}):
        raise ValueError("The capture differs from its original operation, sources or files.")
    if (files.get("selection") or {}).get("path") != "selection.json":
        raise ValueError("The original report selection file is missing.")
    if any(item.get("path") in ("edition.json", ".adoption.json") for item in files.values()):
        raise ValueError("An original report file uses the saved-edition metadata path.")
    if (not isinstance(identity.get("selection"), dict)
            or not isinstance(identity["selection"].get("source_roles", {}), dict)):
        raise ValueError("Keep the original report's source selection object and role mapping.")
    choices = observed_context.source_choices(identity["selection"])
    sources = result.get("sources")
    if (not isinstance(sources, list) or any(not isinstance(row, dict) for row in sources)
            or result.get("source_count") != len(choices)
            or [{"source_collection_id": row.get("source_collection_id"),
                 "source_id": row.get("source_id")} for row in sources] != choices):
        raise ValueError("The completed report changed its original source order.")
    for role in ("report_pdf", "report_html", "report_data"):
        if role not in files:
            raise ValueError("Keep the completed report's original PDF, HTML and data files.")
    return edition_id


def _load(workspace, capture_id, *, verify=True, bind=True):
    directory = _capture_directory(workspace, capture_id)
    capture_path = _file(directory, "capture.json")
    captured = describe_file(directory, capture_path)
    raw = capture_path.read_bytes()
    if len(raw) != captured["bytes"] or hashlib.sha256(raw).hexdigest() != captured["sha256"]:
        raise ValueError("The report capture changed while it was read.")
    capture_text = raw.decode("utf-8")
    capture = json.loads(capture_text)
    operation = describe_file(directory, _file(directory, "operation.json"))
    result = read_json(directory / "operation.json")
    identity = read_json(_file(directory, "selection.json"))
    edition_id = _validate(workspace, capture_id, capture, identity, result, operation)
    seen = {}
    for descriptor in capture["files"].values():
        name = descriptor.get("path")
        _verified(directory, descriptor, contents=verify)
        previous = seen.setdefault(name, descriptor)
        if previous != descriptor:
            raise ValueError("Captured report roles disagree about an original file.")
    if bind and observed_context.bind(workspace, identity["selection"]) != identity["binding"]:
        raise ValueError("The original captured report sources changed.")
    return {"directory": directory, "capture_id": capture_id, "capture": capture,
            "capture_text": capture_text, "capture_file": captured,
            "operation_file": operation, "result": result,
            "identity": identity, "edition_id": edition_id}


def _summary(workspace, value):
    result = value["result"]
    members = {item["path"]: item for item in value["capture"]["files"].values()}
    return {"capture_id": value["capture_id"], "edition_id": value["edition_id"],
            "capture_sha256": value["capture_file"]["sha256"],
            "project_id": workspace.project["id"], "title": result["title"],
            "operation_id": result["operation_id"], "source_count": result["source_count"],
            "section_count": result["section_count"], "figure_count": result["figure_count"],
            "file_count": len(members), "bytes": sum(item["bytes"] for item in members.values()),
            "state": "complete", "sources": deepcopy(result["sources"]),
            "registered": (editions.directory(workspace, value["edition_id"]) / "edition.json").is_file()}


def catalog(workspace):
    reports, issues = [], []
    for path in sorted((Path(workspace.root) / KIND).glob("*/capture.json")):
        try:
            # The catalogue checks identities and lengths. An explicit preview
            # and queued adoption verify every original report byte and source.
            reports.append(_summary(workspace, _load(
                workspace, path.parent.name, verify=False, bind=False)))
        except (OSError, ValueError, KeyError, TypeError) as error:
            issues.append({"capture_id": path.parent.name, "message": str(error)})
    return {"reports": reports, "issues": issues}


def preview(workspace, capture_id):
    value = _load(workspace, identifier(capture_id))
    return {"schema": PREVIEW_SCHEMA, **_summary(workspace, value),
            "render_identity": deepcopy(value["identity"])}


def verify_origin(workspace, record, directory):
    """Verify optional adoption provenance without requiring the donor capture."""
    origin = record.get("capture_origin")
    if origin is None:
        return
    if not isinstance(origin, dict) or origin.get("schema") != ORIGIN_SCHEMA:
        raise ValueError("The saved report's original capture provenance changed.")
    capture_id = identifier(origin.get("capture_id"))
    captured = origin.get("capture")
    if (not isinstance(captured, dict) or not isinstance(captured.get("content"), str)
            or type(captured.get("bytes")) is not int):
        raise ValueError("Retain the complete original capture document.")
    raw = captured["content"].encode("utf-8")
    if (len(raw) != captured["bytes"]
            or hashlib.sha256(raw).hexdigest() != identifier(captured.get("sha256"))):
        raise ValueError("The saved report's original capture bytes changed.")
    operation = describe_file(directory, _file(directory, "operation.json"))
    result = read_json(directory / "operation.json")
    capture = json.loads(captured["content"])
    key = _validate(workspace, capture_id, capture, record["render_identity"], result, operation)
    if key != record["id"]:
        raise ValueError("The original capture belongs to another saved report edition.")


def adopt(workspace, capture_id, *, expected_capture_sha256, expected_edition_id):
    capture_id = identifier(capture_id)
    expected_capture_sha256 = identifier(expected_capture_sha256)
    expected_edition_id = identifier(expected_edition_id)
    with held(workspace.root / ".workspace.lock"):
        value = _load(workspace, capture_id)
        if (value["edition_id"] != expected_edition_id
                or value["capture_file"]["sha256"] != expected_capture_sha256):
            raise ValueError("Review this exact completed report capture again before adopting it.")
        result, identity = value["result"], value["identity"]
        target = editions.directory(workspace, expected_edition_id)
        if target.is_symlink():
            raise ValueError("Keep the saved edition in its original ordinary directory.")
        if target.exists():
            record, directory, original = editions.inspect(workspace, expected_edition_id)
            if (record["render_identity"] != identity or record["files"] != result["files"]
                    or original != result):
                raise ValueError("A saved edition with this render identity retains different original bytes.")
            return {"scientific_report_edition_id": expected_edition_id,
                    "capture_id": capture_id, "title": record["title"],
                    "state": "complete", "operation_id": result["operation_id"],
                    "source_count": result["source_count"], "reused": True}
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = target.parent / ("." + expected_edition_id + ".capture-" + expected_capture_sha256)
        if stage.is_symlink():
            raise ValueError("Keep the adoption stage in the original saved-edition directory.")
        stage.mkdir(mode=0o700, exist_ok=True)
        request = {"capture_id": capture_id, "capture_sha256": expected_capture_sha256,
                   "edition_id": expected_edition_id, "project_id": workspace.project["id"]}
        atomic_json(stage / ".adoption.json", request, immutable=True)
        # The same original immutable copy routine retains existing files exactly.
        from .observed_report_render import _retain_original
        for descriptor in value["capture"]["files"].values():
            source = _verified(value["directory"], descriptor)
            destination = stage / descriptor["path"]
            if destination.is_symlink() or destination.resolve() != stage.resolve() / descriptor["path"]:
                raise ValueError("Keep adopted report files inside their ordinary stage.")
            _retain_original(source, destination, descriptor)
            _verified(stage, descriptor)
        record = {"schema": editions.SCHEMA, "id": expected_edition_id,
                  "project_id": workspace.project["id"], "title": identity["title"],
                  "render_identity": deepcopy(identity),
                  **{name: deepcopy(result[name]) for name in (
                      "state", "operation_id", "source_count", "section_count",
                      "figure_count", "sources", "files")},
                  "capture_origin": {"schema": ORIGIN_SCHEMA, "capture_id": capture_id,
                      "capture": {"content": value["capture_text"],
                                  "bytes": value["capture_file"]["bytes"],
                                  "sha256": value["capture_file"]["sha256"]}}}
        atomic_json(stage / "edition.json", record, immutable=True)
        verify_origin(workspace, record, stage)
        declared = {item["path"] for item in value["capture"]["files"].values()}
        declared.update({"edition.json", ".adoption.json"})
        for path in stage.rglob("*"):
            if path.is_symlink():
                raise ValueError("The report adoption stage contains an aliased member.")
            if path.is_file() and path.relative_to(stage).as_posix() not in declared:
                if path.name.startswith(".observed-source-"):
                    path.unlink()
                else:
                    raise ValueError("The report adoption stage contains an undeclared file.")
        (stage / ".adoption.json").unlink()
        os.rename(stage, target)
        if os.name != "nt":
            fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        editions.inspect(workspace, expected_edition_id)
        return {"scientific_report_edition_id": expected_edition_id,
                "capture_id": capture_id, "title": record["title"],
                "state": "complete", "operation_id": result["operation_id"],
                "source_count": result["source_count"], "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    for name in ("preview", "adopt"):
        command = commands.add_parser(name)
        command.add_argument("capture_id")
        if name == "adopt":
            command.add_argument("--capture-sha256", required=True)
            command.add_argument("--edition-id", required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(Path(args.workspace).resolve())
    if args.command == "catalog":
        result = catalog(workspace)
    elif args.command == "preview":
        result = preview(workspace, args.capture_id)
    else:
        result = adopt(workspace, args.capture_id,
                       expected_capture_sha256=args.capture_sha256,
                       expected_edition_id=args.edition_id)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
