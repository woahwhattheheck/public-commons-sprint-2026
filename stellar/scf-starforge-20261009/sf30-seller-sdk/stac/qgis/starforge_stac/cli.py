# SPDX-License-Identifier: MIT
"""Original desktop workspace CLI. Native map commands run in QGIS's Python."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys

from .model import (QgisWorkspace, open_receiving_source, receive_package, read_json,
                    QgisReceivingError, require)
from . import qgis_project


def execute(args, progress=None):
    command = args.command
    if command == "source-open":
        source = open_receiving_source(args.directory, args.expected_sha256, progress=progress)
        return {"sourceId": source.id, "source": source.source, "summary": source.summary,
                "scenes": source.scene_rows(), "assets": source.asset_rows()}
    if command == "receive":
        result = receive_package(args.file, args.workspace, expected_sha256=args.expected_sha256, progress=progress)
        return {"receipt": result["receipt"], "replayed": result["replayed"], "state": result["workspace"].read()}
    if command == "create":
        return QgisWorkspace(args.workspace, create=True, title=args.title).read()
    workspace = QgisWorkspace(args.workspace)
    if command == "open":
        return workspace.read()
    if command == "scenes":
        return {"sourceId": workspace.source(args.source_id).id, "scenes": workspace.source(args.source_id).scene_rows()}
    if command == "assets":
        return {"sourceId": workspace.source(args.source_id).id,
                "assets": workspace.source(args.source_id).asset_rows(args.scene_key)}
    if command == "history":
        return {"state": workspace.read(), "history": workspace.history()}
    if command == "operation":
        return {"operation": workspace.operation(args.request_id)}
    if command == "compare":
        return workspace.compare(args.left, args.right)
    if command == "export":
        return workspace.export_package(args.file, expected_revision=args.revision, progress=progress)
    if command == "native-open":
        _, result = qgis_project.reopen_project(workspace, args.project_id, progress=progress)
        return result
    require(args.input, "INPUT_REQUIRED", "Supply the complete original --input JSON for this workspace action.")
    payload, _ = read_json(args.input)
    require(isinstance(payload, dict), "INPUT_REQUIRED", "Use a JSON action object.")
    if command == "native-inspect":
        return qgis_project.inspect_asset(workspace, payload["sourceId"], payload.get("collection"),
                                          payload["itemId"], payload["assetKey"], progress=progress)
    common = {"revision": payload.get("revision"), "request_id": payload.get("requestId"), "actor": payload.get("actor")}
    if command == "import":
        return workspace.import_source(payload["directory"], expected_manifest_sha256=payload.get("expectedManifestSha256"),
                                       progress=progress, **common)
    if command == "select":
        return workspace.activate_source(payload["sourceId"], **common)
    if command == "layers":
        return workspace.save_layers(payload["layers"], **common)
    if command == "review":
        return workspace.review_successor(payload["leftSourceId"], payload["rightSourceId"], payload["decisions"],
                                           note=payload.get("note"), **common)
    if command == "native-save":
        return qgis_project.save_project(workspace, project_crs=payload.get("projectCrs"), progress=progress, **common)
    raise QgisReceivingError("COMMAND_UNKNOWN", "Select a documented original QGIS workspace command.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["source-open", "create", "open", "import", "select", "scenes", "assets",
                                           "layers", "compare", "review", "native-inspect", "native-save", "native-open",
                                           "export", "receive", "history", "operation"])
    parser.add_argument("--workspace")
    parser.add_argument("--directory")
    parser.add_argument("--input")
    parser.add_argument("--file")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--source-id")
    parser.add_argument("--scene-key")
    parser.add_argument("--left")
    parser.add_argument("--right")
    parser.add_argument("--revision", type=int)
    parser.add_argument("--request-id")
    parser.add_argument("--project-id")
    parser.add_argument("--title", default="STAC GIS project")
    parser.add_argument("--progress", action="store_true")
    args = parser.parse_args(argv)
    if args.command != "source-open" and not args.workspace:
        parser.error("--workspace is required")
    application = None
    try:
        if args.command.startswith("native-"):
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            core = qgis_project.native()
            application = core.QgsApplication([], False)
            application.initQgis()
        progress = (lambda value: print(json.dumps(value, ensure_ascii=False), file=sys.stderr, flush=True)) if args.progress else None
        result = execute(args, progress=progress)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (QgisReceivingError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"error": getattr(exc, "code", type(exc).__name__), "message": str(exc),
                          "details": getattr(exc, "details", {})}, ensure_ascii=False), file=sys.stderr)
        return 2
    finally:
        if application is not None:
            application.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
