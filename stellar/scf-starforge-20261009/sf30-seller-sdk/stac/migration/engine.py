#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Execute one complete migration operation with the selected native Python."""
from __future__ import annotations
import argparse
import contextlib
import json
from pathlib import Path
import sys

# All native/UI entrypoints share one package and the original paired providers.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from migration.workspace import Workspace
from migration.native import files, vector, need, source_closure

MAX_REQUEST = 40 * 1024 * 1024
RESULT_MARKER = "MIGRATION_RESULT_JSON "
READ_COMMANDS = frozenset(("state", "records", "document", "draft", "source-rows",
                         "issues", "history", "operation", "files", "native-info", "comparison-rows",
                         "cartography.inventory", "cartography.preview", "cartography.operation",
                         "cartography.publication", "cartography.download", "qgis-info"))
WRITE_COMMANDS = frozenset(("capture", "receive-capture", "save-plan", "review-plan",
                           "build-edition", "build-projects", "export", "receive", "compare-captures",
                           "cartography.save-plan", "cartography.publish", "cartography.reopen"))

def is_read(command):
    return command in READ_COMMANDS

def _file(workspace, path):
    records = {item["path"]: item for item in workspace.project_files()}
    need(path in records, "MIGRATION_FILE_NOT_DECLARED", path)
    files.verify_file(workspace.root, records[path])
    return records[path]

def execute(workspace_path, command, payload, *, progress=None, exports_root=None):
    need(isinstance(payload, dict), "MIGRATION_REQUEST_OBJECT_REQUIRED")
    need(command in READ_COMMANDS | WRITE_COMMANDS | {"create", "verify", "native-reopen"},
         "MIGRATION_COMMAND_UNKNOWN", command)
    if command == "create":
        return Workspace(workspace_path, create=True, title=payload.get("title", "GIS migration")).summary()
    if command == "receive":
        from migration import receiving
        result = receiving.receive(payload["archive"], payload["destination"],
            expected_sha256=payload["expectedSha256"], progress=progress,
            native_reopen=payload.get("nativeReopen", "auto"))
        return {key: value for key, value in result.items() if key != "workspace"}
    workspace = Workspace(workspace_path)
    if command == "state":
        return workspace.summary()
    if command == "records":
        return workspace.records(payload["kind"], offset=payload.get("offset", 0), limit=payload.get("limit", 50))
    if command == "document":
        return workspace.document(payload["kind"], payload["id"])
    if command == "draft":
        return workspace.draft(payload["captureId"], payload.get("predecessorPlanId"))
    if command == "source-rows":
        return workspace.source_rows(payload["captureId"], payload["layerId"],
                                     offset=payload.get("offset", 0), limit=payload.get("limit", 50))
    if command == "issues":
        return workspace.issues(payload["planId"], offset=payload.get("offset", 0),
            limit=payload.get("limit", 50), layer_id=payload.get("layerId"), kind=payload.get("kind"))
    if command == "comparison-rows":
        return workspace.comparison_rows(payload["comparisonId"], offset=payload.get("offset", 0),
            limit=payload.get("limit", 50), layer_id=payload.get("layerId"), status=payload.get("status"))
    if command == "history":
        return workspace.history_page(offset=payload.get("offset", 0), limit=payload.get("limit", 50))
    if command == "operation":
        return {"requestId": payload["requestId"], "result": workspace.operation(payload["requestId"])}
    if command == "files":
        if payload.get("path") is not None:
            return _file(workspace, payload["path"])
        offset, limit = payload.get("offset", 0), payload.get("limit", 50)
        from migration.workspace import _page
        _page(offset, limit)
        records = workspace.project_files()
        query = payload.get("query", "")
        need(isinstance(query, str), "MIGRATION_FILE_QUERY_INVALID")
        if query:
            records = [row for row in records if query.casefold() in row["path"].casefold()]
        return {"offset": offset, "limit": limit, "total": len(records),
                "rows": records[offset:offset + limit], "hasMore": offset + limit < len(records)}
    if command == "native-info":
        return {"vector": vector.capabilities(), "source": source_closure()}
    if command == "qgis-info":
        from starforge_stac.qgis_project import native_version
        return {"qgis": native_version(), "source": source_closure()}
    if command == "verify":
        return workspace.verify_migration()
    if command == "native-reopen":
        from migration.receiving import reopen_handover
        return reopen_handover(workspace, progress=progress)
    if command.startswith("cartography."):
        from migration import cartography
        return cartography.execute(workspace, command.split(".", 1)[1], payload, progress=progress)
    common = {"revision": payload.get("revision"), "request_id": payload.get("requestId"),
              "actor": payload.get("actor")}
    if command == "capture":
        return workspace.capture(payload["selection"], payload["sourceRoot"],
                                 original_base64=payload.get("originalBase64"), **common)
    if command == "receive-capture":
        return workspace.receive_capture(payload["directory"], payload["expectedManifestSha256"], **common)
    if command == "save-plan":
        return workspace.save_plan(payload["plan"], original_base64=payload.get("originalBase64"), **common)
    if command == "review-plan":
        return workspace.review_plan(payload["planId"], payload["outcome"], payload["note"], **common)
    if command == "compare-captures":
        return workspace.compare_captures(payload["beforeCaptureId"], payload["afterCaptureId"], **common)
    if command == "build-edition":
        return workspace.build_edition(payload["planId"], **common)
    if command == "build-projects":
        from migration.receiving import build_projects
        return build_projects(workspace, payload["editionId"], request_id=common["request_id"],
                              actor=common["actor"], expected_revision=common["revision"], progress=progress)
    if command == "export":
        from migration.receiving import export_handover
        need(type(payload.get("revision")) is int, "MIGRATION_REVISION_REQUIRED")
        if exports_root is not None:
            root = files.private_directory(exports_root)
            need(isinstance(payload.get("requestId"), str), "MIGRATION_EXPORT_REQUEST_REQUIRED")
            destination = root / ("migration-" + files.digest({
                "workspaceId": workspace.read()["id"], "revision": payload["revision"],
                "requestId": payload["requestId"]}) + ".zip")
        else:
            destination = Path(payload["destination"]).expanduser().absolute()
        result = export_handover(workspace, destination, expected_revision=payload["revision"],
                                  expected_sha256=payload.get("expectedSha256"), progress=progress)
        if exports_root is not None:
            result["download"] = {"kind": "archive", "path": destination.name}
        return result
    raise ValueError("Unsupported migration command.")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--input", help="Complete original request JSON; stdin if omitted.")
    parser.add_argument("--output", help="Atomic complete result JSON.")
    parser.add_argument("--exports-root", help="Original server-owned archive directory.")
    parser.add_argument("--progress", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.input:
            path = Path(args.input)
            need(path.stat().st_size <= MAX_REQUEST, "MIGRATION_REQUEST_TOO_LARGE")
            raw = path.read_bytes()
        else:
            raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        need(len(raw) <= MAX_REQUEST, "MIGRATION_REQUEST_TOO_LARGE")
        request = files.parse_json(raw)
        need(isinstance(request, dict) and isinstance(request.get("command"), str)
             and isinstance(request.get("payload", {}), dict), "MIGRATION_REQUEST_REQUIRED")
        progress = (lambda value: print(files.canonical(value), file=sys.stderr, flush=True)) if args.progress else None
        with contextlib.redirect_stdout(sys.stderr):
            result = execute(args.workspace, request["command"], request.get("payload", {}),
                             progress=progress, exports_root=args.exports_root)
        envelope = {"ok": True, "result": result}
        code = 0
    except (OSError, ValueError, KeyError, TypeError, ImportError) as exc:
        envelope = {"ok": False, "error": {"code": getattr(exc, "code", type(exc).__name__),
                    "message": str(exc), "details": getattr(exc, "details", getattr(exc, "detail", None))}}
        code = 2
    if args.output:
        files.atomic_json(args.output, envelope)
    print(RESULT_MARKER + files.canonical(envelope), flush=True)
    return code

if __name__ == "__main__":
    raise SystemExit(main())
