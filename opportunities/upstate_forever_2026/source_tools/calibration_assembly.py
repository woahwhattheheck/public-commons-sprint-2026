#!/usr/bin/env python3
"""Join calibration and source components through the current application assembler.

The local assembler and this cohort's installer are trusted executable tools.
Selected source carriers remain data. Registration is applied before the complete
source map, directory receipt and ZIP are produced.
"""
from __future__ import annotations

import argparse
import ast
import base64
import gzip
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

SOURCE_ROOT = "opportunities/upstate_forever_2026"
SELF_NAME = "source_tools/calibration_assembly.py"
INSTALLER_NAME = "operator/install_calibration.py"
REQUIRED = ("model/workspace.py", "model/observations.py", "model/common.py",
            "model/calibration.py", "model/CALIBRATION.md",
            "model/calibration_uncertainty.py", "model/CALIBRATION_UNCERTAINTY.md",
            "model/calibration_maps.py", "model/CALIBRATION_MAPS.md",
            "model/calibration_review.py", "model/CALIBRATION_REVIEW.md", "model/spatial.py", "operator/server.py",
            "operator/calibration.py", "operator/web/app.mjs", "operator/web/index.html",
            "operator/web/calibration.mjs", "operator/web/calibration_maps.mjs",
            "operator/web/calibration_review.mjs", "operator/web/calibration.css",
            "operator/extensions/calibration.json", "operator/extension_registry.py",
            "operator/web/extension_host.mjs", "install_extensions.py",
            "operator/web/calibration_design.mjs", "operator/CALIBRATION_DESIGN.md",
            "operator/calibration_design_patch.json", "operator/install_calibration_design.py",
            "source/calibration-design/upper-savannah-reference-support.json")


def _tool(name, path):
    path = Path(path).resolve(strict=True)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load the current source tool: " + str(path))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _read(path, limit):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select a retained regular source file: " + str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError("Source file is outside the receiving capacity: " + str(path))
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size,
                              value.st_mtime_ns, value.st_ctime_ns)
    if identity(before) != identity(after) or len(data) > limit:
        raise ValueError("Source changed while reading: " + str(path))
    return data


def _name(assembly, value):
    assembly.member_name(value)
    if value.startswith(SOURCE_ROOT + "/"):
        value = value[len(SOURCE_ROOT) + 1:]
    elif value.startswith("opportunities/"):
        raise ValueError("Source member belongs to a different application: " + value)
    assembly.member_name(value)
    return value


def _aliases(entry, names, label):
    values = [entry[name] for name in names if entry.get(name) is not None]
    if values and any(value != values[0] for value in values):
        raise ValueError("Conflicting source identity fields for " + label)
    return values[0] if values else None


def _normalize(assembly, document):
    if not isinstance(document, dict) or "files" not in document:
        raise ValueError("Select a complete source carrier with its file inventory")
    raw = document["files"]
    if isinstance(raw, dict):
        metadata = document.get("file_metadata")
        if not isinstance(metadata, dict) or set(metadata) != set(raw):
            raise ValueError("Complete source-map metadata and files differ")
        entries = [{**metadata[name], "path": name, "content": value} for name, value in raw.items()]
    elif isinstance(raw, list):
        entries = raw
    else:
        raise ValueError("The carrier needs complete source file entries")
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Source file entry must be an object")
        name = _name(assembly, entry.get("path"))
        size = _aliases(entry, ("bytes", "byte_length"), name)
        git_blob = _aliases(entry, ("git_blob", "git_blob_sha", "github_blob_sha"), name)
        item = {**entry, "path": name, "bytes": size}
        for field in ("byte_length", "github_blob_sha", "git_blob_sha"):
            item.pop(field, None)
        if git_blob is not None:
            item["git_blob"] = git_blob
        normalized.append(item)
    value = {**document, "files": normalized}
    if value.get("schema") != assembly.MAP_SCHEMA:
        value["schema"] = "commons.source-bank/v1"
    if "file_metadata" in value:
        value.pop("file_metadata")
    if "external_sources" in value:
        value["external_sources"] = [{**item, "path": _name(assembly, item["path"]),
                                       "bytes": _aliases(item, ("bytes", "byte_length"), item["path"])}
                                      for item in value["external_sources"]]
    return value


def _decoded(assembly, data):
    try:
        return assembly.decode_carrier(data)
    except ValueError as original_error:
        # The original assembler recognizes its three source schemas. New source
        # banks still carry the same explicit per-file bytes and identities.
        text = data.decode("utf-8-sig")
        blocks = re.findall(assembly.FENCE + r"([a-zA-Z0-9_-]*)[ \t]*\r?\n(.*?)\r?\n"
                            + assembly.FENCE, text, re.S)
        documents = []
        for language, body in blocks:
            if language.lower() not in ("json", "") or not body.lstrip().startswith("{"):
                continue
            candidate = assembly.transport_json(body)
            if isinstance(candidate, dict) and "files" in candidate:
                documents.append(body.encode("utf-8"))
        if len(documents) != 1 or any(language.lower() == "base64" for language, _ in blocks):
            raise original_error
        return documents[0]


def read_component(assembly, path, expected=None):
    data = _read(path, assembly.MAX_BYTES)
    payload = _decoded(assembly, data)
    if expected is not None and assembly.sha256(payload) != expected:
        raise ValueError("Selected original decoded carrier differs: " + str(path))
    original = assembly.transport_json(payload.decode("utf-8"))
    normalized = _normalize(assembly, original)
    receipt = {"carrier_name": Path(path).name, "carrier_sha256": assembly.sha256(data),
               "carrier_bytes": len(data), "payload_sha256": assembly.sha256(payload),
               "payload_bytes": len(payload), "original_schema": original.get("schema"),
               "path_normalization": "Application-relative paths; the exact project prefix is removed when present"}
    return assembly.layer_from_document(normalized, receipt)


def _entry(assembly, path, data, *, previous=None, mode=None):
    row = {"path": path, "bytes": len(data), "sha256": assembly.sha256(data),
           "content_base64": base64.b64encode(data).decode("ascii"), "mode": mode or "100644"}
    if previous is not None:
        row["base_sha256"] = previous
    return row


def current_layer(assembly, root):
    capture = getattr(assembly, "snapshot_application", None)
    if not callable(capture):
        raise ValueError("Use the current application assembler with snapshot_application for --current")
    root = Path(root).absolute()
    layer = capture(root)
    return layer, (root, layer)


def _check_current(assembly, snapshot):
    if snapshot is None:
        return
    root, selected = snapshot
    current = assembly.snapshot_application(root)
    if (current.files != selected.files or current.metadata != selected.metadata
            or current.document.get("external_sources", []) != selected.document.get("external_sources", [])):
        raise ValueError("Current application source changed during composition; compose the latest retained edition")


def _extension_changes(assembly, installer, current, additions):
    manifest = current["files"].get("operator/calibration-install.json")
    recorded = json.loads(manifest).get("installed", {}) if manifest else {}
    owned = set(REQUIRED) - {"model/workspace.py", "model/observations.py", "model/common.py", "model/spatial.py",
                             "operator/server.py", "operator/web/app.mjs", "operator/web/index.html",
                             "operator/extension_registry.py", "operator/web/extension_host.mjs",
                             "install_extensions.py"}
    owned.update((SELF_NAME, INSTALLER_NAME, "operator/CALIBRATION.md"))
    for layer in additions:
        for name, incoming in layer.files.items():
            existing = current["files"].get(name)
            if name not in owned or existing is None or existing == incoming:
                continue
            actual = assembly.sha256(existing.encode("utf-8"))
            if recorded.get(name) != actual and actual not in installer.PREDECESSORS.get(name, set()):
                raise ValueError("Current calibration extension has independent source changes: " + name)


def registration_layer(assembly, installer, extension_installer, document, tool_root):
    for name in REQUIRED:
        if name not in document["files"]:
            raise ValueError("Cumulative calibration source is missing " + name)
    for name in (INSTALLER_NAME, SELF_NAME):
        local = _read(tool_root / name, assembly.MAX_BYTES)
        if document["files"].get(name, "").encode("utf-8") != local:
            raise ValueError("Use the same complete executing calibration cohort selected in the operator carrier: " + name)
    maintained_source = _read(Path(extension_installer.__file__), assembly.MAX_BYTES)
    if document["files"]["install_extensions.py"].encode("utf-8") != maintained_source:
        raise ValueError("Use the exact maintained extension installer selected in the cumulative source")
    changes = installer.register_sources(document["files"], extension_installer)
    installed = {}
    for name in (*installer.FILES, *installer.SHARED):
        if name not in document["files"]:
            raise ValueError("The complete calibration cohort is missing " + name)
        content = changes.get(name, document["files"][name])
        if name.endswith(".py"):
            ast.parse(content, filename=name)
        installed[name] = assembly.sha256(content.encode("utf-8"))
    dependencies = {name: document["file_metadata"][name]["sha256"] for name in installer.DEPENDENCIES}
    registration_id = assembly.sha256(assembly.canonical({"installed": installed, "dependencies": dependencies}))
    changes["operator/calibration-install.json"] = json.dumps({
        "schema": installer.VERSION, "operation_id": registration_id, "installed": installed,
        "dependencies": dependencies, "catalogue": "/api/extensions",
        "receiving": "Registered before cumulative application source-map and ZIP publication",
    }, sort_keys=True, indent=2) + "\n"
    entries = [_entry(assembly, name, content.encode("utf-8"),
                      previous=document["file_metadata"].get(name, {}).get("sha256"),
                      mode=document["file_metadata"].get(name, {}).get("mode"))
               for name, content in changes.items()]
    layer = assembly.layer_from_document({
        "schema": "commons.source-bank/v1", "edition": "calibration-registration-" + registration_id,
        "source_root": SOURCE_ROOT, "files": entries,
    })
    return layer, {"id": registration_id, "paths": sorted(changes), "dependencies": dependencies,
                   "descriptor": "operator/extensions/calibration.json", "catalogue": "/api/extensions",
                   "source_operation": "Maintained extension host registered before final cumulative identities"}


def build(assembly, installer, extension_installer, *, base, overlays, model, operator,
          edition, operation_id=None, current=None, pins=None, tool_root=None):
    pins = pins or {}
    paths = [base, *overlays, model, operator]
    layers = [read_component(assembly, path, pins.get(index)) for index, path in enumerate(paths)]
    source_layers = layers[:1]
    document = assembly.compose(source_layers, edition=edition, operation_id=operation_id)
    snapshot = None
    if current:
        layer, snapshot = current_layer(assembly, current)
        source_layers.append(layer)
        document = assembly.compose(source_layers, edition=edition, operation_id=operation_id)
    source_layers.extend(layers[1:-2])
    document = assembly.compose(source_layers, edition=edition, operation_id=operation_id)
    _extension_changes(assembly, installer, document, layers[-2:])
    source_layers.extend(layers[-2:])
    document = assembly.compose(source_layers, edition=edition, operation_id=operation_id)
    root = Path(tool_root) if tool_root is not None else Path(__file__).resolve().parents[1]
    registration, summary = registration_layer(assembly, installer, extension_installer, document, root)
    source_layers.append(registration)
    document = assembly.compose(source_layers, edition=edition, operation_id=operation_id)
    return document, summary, snapshot


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", type=Path, help="Original or cumulative complete application source carrier")
    parser.add_argument("--overlay", action="append", type=Path, default=[],
                        help="Complete source component; repeat in current selected source order")
    parser.add_argument("--model", type=Path, required=True, help="Complete calibration model and scientific guide carrier")
    parser.add_argument("--operator", type=Path, required=True, help="This complete calibration operator and assembly-driver carrier")
    parser.add_argument("--assembler", type=Path, default=Path(__file__).with_name("application_assembly.py"),
                        help="The retained current application_assembly.py executable tool")
    parser.add_argument("--current", type=Path,
                        help="Retain actual current source before the explicitly selected complete component overlays")
    parser.add_argument("--extension-installer", type=Path,
                        help="Current maintained install_extensions.py; defaults to --current or this source cohort")
    parser.add_argument("--edition", required=True)
    parser.add_argument("--operation-id")
    parser.add_argument("--expect", action="append", default=[], metavar="INDEX:SHA256",
                        help="Pin decoded carrier: base 0, then overlays in order, then model and operator")
    parser.add_argument("--output", type=Path, help="Fresh complete application directory or identical retained receive")
    parser.add_argument("--source-map", type=Path, help="Complete compatible source map, optionally .gz")
    parser.add_argument("--zip", dest="archive_path", type=Path, help="Complete portable application ZIP")
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args(argv)
    try:
        tool_root = Path(__file__).resolve().parents[1]
        assembly = _tool("_upstate_current_application_assembly", args.assembler)
        installer = _tool("_upstate_calibration_installer", tool_root / INSTALLER_NAME)
        extension_path = args.extension_installer or ((args.current or tool_root) / "install_extensions.py")
        extension_installer = installer.load_extension_installer(extension_path)
        count = len(args.overlay) + 3
        pins = {}
        for value in args.expect:
            index, digest = value.split(":", 1)
            index = int(index)
            if index in pins or not 0 <= index < count or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise ValueError("Invalid or duplicate source pin INDEX:SHA256")
            pins[index] = digest
        if not args.inspect and not (args.output or args.source_map or args.archive_path):
            raise ValueError("Choose --output, --source-map or --zip, or use --inspect")
        if args.current and args.output and args.current.resolve() == args.output.resolve():
            raise ValueError("Receive a fresh cumulative source edition, then reopen the same scientific workspace with it")
        document, registration, snapshot = build(
            assembly, installer, extension_installer, base=args.base, overlays=args.overlay, model=args.model,
            operator=args.operator, edition=args.edition, operation_id=args.operation_id,
            current=args.current, pins=pins, tool_root=tool_root)
        payload = assembly.canonical(document)
        receipt = assembly.source_receipt(document, payload)
        result = {**receipt, "edition": args.edition, "calibration_registration": registration,
                  "layers": document["assembly"]["layers"],
                  "changes": document["assembly"]["changes"],
                  "external_sources": document["external_sources"],
                  "local_dependencies": assembly.local_dependencies(document),
                  "assembler": {"path": str(Path(assembly.__file__).resolve()),
                                "sha256": assembly.sha256(_read(Path(assembly.__file__), assembly.MAX_BYTES))}}
        _check_current(assembly, snapshot)
        if not args.inspect:
            if args.source_map:
                data = gzip.compress(payload, mtime=0) if args.source_map.suffix == ".gz" else payload
                result["source_map"] = assembly.publish_file(args.source_map, data)
            if args.output:
                result["received"] = assembly.receive_directory(args.output, document, receipt)
            if args.archive_path:
                result["archive"] = assembly.write_archive(args.archive_path, document, receipt)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, UnicodeError, EOFError, SyntaxError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
