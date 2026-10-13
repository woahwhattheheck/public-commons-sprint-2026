#!/usr/bin/env python3
"""Operate retained Water and Habitat Context analyses without a browser.

Authored by TokenJunkieLabs. Use the existing Upper Savannah application and
Workspace; the explicit build command calls the original context core.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

from model import water_context
from model.common import identifier, read_json, relative_file, verify_file
from model.workspace import Workspace


def _emit(value, stream=sys.stdout):
    json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
    stream.write("\n")


def _selection(workspace, args):
    if args.selection_id:
        value = workspace._get("water-context-selections", identifier(args.selection_id))
        return {key: item for key, item in value.items() if key not in ("id", "schema")}
    if args.selection == "-":
        value = json.load(sys.stdin)
    else:
        with Path(args.selection).expanduser().open(encoding="utf-8-sig") as stream:
            value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("The selection file must contain a context selection object")
    return value


def _export(workspace, record, artifact, destination, *, overwrite):
    if record["state"] != "complete":
        raise ValueError("The selected context analysis has no completed export")
    files = record.get("files", {})
    if artifact not in files:
        raise ValueError("Choose an available artifact: " + ", ".join(sorted(files)))
    expected = files[artifact]
    directory = workspace.root / "water-context" / identifier(record["id"])
    source = relative_file(directory, expected["path"])
    output = Path(destination).expanduser().absolute()
    if output.resolve() == source.resolve():
        raise ValueError("Choose a destination separate from the retained context artifact")
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and not overwrite:
        raise FileExistsError("The output already exists; choose another path or pass --overwrite")
    descriptor, name = tempfile.mkstemp(prefix=".water-context-export-", dir=output.parent)
    pending = Path(name)
    try:
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(descriptor, "wb") as receiving, source.open("rb") as original:
            for block in iter(lambda: original.read(1024 * 1024), b""):
                receiving.write(block)
                digest.update(block)
                size += len(block)
            receiving.flush()
            os.fsync(receiving.fileno())
        if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
            raise ValueError("The selected artifact differs from its retained analysis record")
        if overwrite:
            os.replace(pending, output)
        else:
            os.link(pending, output)
            pending.unlink()
    finally:
        pending.unlink(missing_ok=True)
    return {"schema": "upstate.water-context-export/v1", "analysis_id": record["id"],
            "artifact": artifact, "path": str(output), "bytes": size,
            "sha256": digest.hexdigest()}


def _parser():
    parser = argparse.ArgumentParser(
        description="Inspect, build, reopen and export retained Water and Habitat Context analyses.")
    parser.add_argument("--workspace", required=True, metavar="DIRECTORY",
                        help="Existing Upper Savannah scientific Workspace directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog", help="List retained vector/raster source choices and saved analyses")
    commands.add_parser("list", help="List saved context analyses using retained metadata")

    build = commands.add_parser("build", help="Build or reopen a complete context analysis")
    choice = build.add_mutually_exclusive_group(required=True)
    choice.add_argument("--selection", metavar="JSON",
                        help="Complete selection JSON file, or - to read standard input")
    choice.add_argument("--selection-id", metavar="ID",
                        help="Reuse an immutable selection retained in this Workspace")

    show = commands.add_parser("show", help="Read a saved context record")
    show.add_argument("analysis_id", metavar="ANALYSIS_ID")
    show.add_argument("--boundaries", action="store_true",
                      help="Include the saved HUC and utility inventory summaries")

    preview = commands.add_parser("preview", help="Read the saved prepared map preview")
    preview.add_argument("analysis_id", metavar="ANALYSIS_ID")

    export = commands.add_parser("export", help="Copy and verify an existing context artifact")
    export.add_argument("analysis_id", metavar="ANALYSIS_ID")
    export.add_argument("--artifact", default="archive", metavar="KEY",
                        help="Saved artifact key; default archive exports the complete ZIP")
    export.add_argument("--output", required=True, metavar="FILE",
                        help="Destination file for the selected retained artifact")
    export.add_argument("--overwrite", action="store_true",
                        help="Replace an existing destination after verifying the exported bytes")

    commands.add_parser("verify", help="Verify retained context selections, source editions and exports")
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    try:
        workspace = Workspace(Path(args.workspace).expanduser())
        if args.command == "catalog":
            value = water_context.catalog(workspace)
        elif args.command == "list":
            value = {"schema": "upstate.water-context-list/v1",
                     "method": water_context.METHOD,
                     "analyses": water_context.list_saved(workspace)}
        elif args.command == "build":
            value = water_context.build(workspace, _selection(workspace, args))
        elif args.command == "show":
            value = water_context.get_saved(workspace, identifier(args.analysis_id))
            if args.boundaries and value["state"] == "complete":
                directory = workspace.root / "water-context" / value["id"]
                path = verify_file(directory, value["files"]["boundary_summaries_json"])
                value = {**value, "boundary_summaries": read_json(path)["boundaries"]}
        elif args.command == "preview":
            value = water_context.preview(workspace, identifier(args.analysis_id))
        elif args.command == "export":
            value = _export(workspace,
                            water_context.get_saved(workspace, identifier(args.analysis_id)),
                            args.artifact, args.output, overwrite=args.overwrite)
        elif args.command == "verify":
            value = water_context.verify_all(workspace)
        else:
            raise ValueError("Choose a documented context command")
        _emit(value)
        return 1 if args.command == "verify" and not value["ok"] else 0
    except Exception as error:
        _emit({"schema": "upstate.water-context-error/v1", "command": args.command,
               "error": {"type": type(error).__name__, "message": str(error)}},
              stream=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
