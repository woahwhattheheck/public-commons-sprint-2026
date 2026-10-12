#!/usr/bin/env python3
"""MIT. Installed native eLTSS capture, field review, correction and receiving commands."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

from eltss_workspace import Workspace, InputError, ConflictError, ProviderError
import eltss_source as source


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def read_json(path):
    data = Path(path).expanduser().read_bytes()
    if len(data) > source.MAX_INTERACTIVE:
        raise InputError("Operator JSON input exceeds 4 MiB; use a complete original file upload for larger data")
    return source.json_value(data)


def copy_original(path, output):
    destination = Path(output).expanduser().absolute()
    with Path(path).open("rb") as inp, os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        shutil.copyfileobj(inp, out, 65536)
        out.flush()
        os.fsync(out.fileno())
    from eltss_runtime import original_workspace
    return {"file": str(destination), "bytes": destination.stat().st_size,
            "sha256": original_workspace.file_digest(destination, 512 * 1024 * 1024)}


def parser():
    result = argparse.ArgumentParser(description="Retain original FHIR care-plan sources, all 56 eLTSS field reviews and complete editable receiving.")
    sub = result.add_subparsers(dest="command", required=True)
    commands = {}
    def command(name, help, *, body=False):
        p = sub.add_parser(name, help=help)
        p.add_argument("--workspace", required=True, help="Absolute original eLTSS workspace directory")
        p.add_argument("--credentials-file", help="Absolute existing private FHIR authentication-profile file")
        p.add_argument("--expected-workspace-id", help="Require this exact retained workspace UUID before operating")
        if body:
            p.add_argument("--input", required=True, help="Complete UTF-8 JSON request file")
        commands[name] = p
        return p
    command("init", "Create a new retained native workspace")
    command("status", "Read retained sources, operations and authored editions")
    command("catalogue", "Read the complete typed operator catalogue")
    p = command("profile", "Read all original field definitions and selector drafts")
    p.add_argument("--profile-id", default="eltss-stu2-2.0.0")
    command("auth-profiles", "Read available local profile names without credentials")
    for name, help in [
        ("connection-save", "Save a selected source connection"), ("request-save", "Save an exact original native acquisition request"),
        ("edition-save", "Save an original CarePlan cohort edition"), ("review-profile", "Adopt all 56 source rows as a complete review draft"),
        ("review-save", "Save a complete authored successor field review"), ("assess", "Assess the saved edition through its exact reviewed selectors"),
        ("decision-save", "Retain a scoped original source/reference/field decision"), ("edition-compare", "Compare two retained original source editions"),
        ("correction-preview", "Review exact authored patches against original resource locators"),
        ("correction-apply", "Apply the retained preview and exact request hash"),
        ("handoff-prepare", "Freeze a complete source, graph, mapping and receiving selection"),
        ("receiving-save", "Retain an actual destination result with original operation identity"),
        ("plan-save", "Save an original SF30 dataset mapping")]:
        command(name, help, body=True)
    selectors = {
        "connection": "connection-id", "discover": "connection-id", "discovery": "discovery-id",
        "request": "request-id", "operation": "operation-id", "pause": "operation-id", "resume": "operation-id",
        "source": "source-id", "source-members": "source-id", "graph": "graph-id", "edition": "edition-id",
        "review": "review-id", "assessment": "assessment-id", "decision": "decision-id",
        "edition-comparison": "comparison-id", "handoff": "handoff-id", "receiving": "receiving-id",
        "plan": "plan-id", "build-show": "build-id"
    }
    for name, ident in selectors.items():
        command(name, "Open the retained original " + name).add_argument("--" + ident, required=True)
    p = command("advance", "Advance one original HTTP step using the same saved operation ID")
    p.add_argument("--request-id", required=True)
    p.add_argument("--operation-id", required=True)
    for name in ["source-add", "artifact-add"]:
        p = command(name, "Retain one complete unchanged original file")
        p.add_argument("--input", required=True)
        p.add_argument("--label")
        p.add_argument("--name")
        if name == "artifact-add":
            p.add_argument("--content-type", default="application/octet-stream")
    p = command("source-file", "Copy one complete original source or archive member")
    p.add_argument("--source-id", required=True)
    p.add_argument("--member")
    p.add_argument("--out", required=True)
    for name, identity in [("source-rows", "source-id"), ("graph-nodes", "graph-id"), ("graph-edges", "graph-id")]:
        p = command(name, "Read one bounded page of original records or references")
        p.add_argument("--" + identity, required=True)
        p.add_argument("--offset", type=int, default=0)
        p.add_argument("--limit", type=int, default=50)
        p.add_argument("--query", default="")
        p.add_argument("--resource-type")
        p.add_argument("--status")
    for name, identity in [("source-row", "source-id"), ("graph-node", "graph-id")]:
        p = command(name, "Open an exact retained resource record")
        p.add_argument("--" + identity, required=True)
        p.add_argument("--record-id", required=True)
    p = command("graph-create", "Retain the selected original reference resolution", body=True)
    p.add_argument("--source-id", required=True)
    p = command("assessment-cells", "Read original frozen CarePlan/field observations")
    p.add_argument("--assessment-id", required=True)
    p.add_argument("--care-plan-id")
    p.add_argument("--field-key")
    p.add_argument("--status")
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=50)
    for name, identity in [("assessment-file", "assessment-id"), ("edition-changes-file", "comparison-id"),
                           ("comparison-file", "comparison-id"), ("artifact-file", "artifact-id")]:
        p = command(name, "Copy the complete verified original retained file")
        p.add_argument("--" + identity, required=True)
        p.add_argument("--out", required=True)
    for name in ["edition-changes", "comparison-changes"]:
        p = command(name, "Read actual retained comparison offsets")
        p.add_argument("--comparison-id", required=True)
        p.add_argument("--offset", type=int, default=0)
        p.add_argument("--limit", type=int, default=50)
    p = command("mapping", "Prepare an original native dataset mapping")
    p.add_argument("--source-id", required=True)
    p.add_argument("--resource-type", required=True)
    p.add_argument("--name")
    p = command("preview", "Review selected original resource projection", body=True)
    p.add_argument("--source-id", required=True)
    p.add_argument("--limit", type=int, default=25)
    p = command("build", "Build and retain the original SF30 dataset")
    p.add_argument("--source-id", required=True)
    p.add_argument("--plan-id", required=True)
    p = command("query", "Run the original selected dataset query")
    p.add_argument("--build-id", required=True)
    p.add_argument("--query-file", help="Exact scalar-string native query object")
    p = command("compare", "Compare original native builds with one saved unique-key mapping")
    p.add_argument("--before-id", required=True)
    p.add_argument("--after-id", required=True)
    for name, identity in [("handoff-export", "handoff-id"), ("dataset-export", "build-id"), ("packet-export", "build-id")]:
        p = command(name, "Export complete original receiving files")
        p.add_argument("--" + identity, required=True)
        p.add_argument("--out", required=True, help="New output directory for dataset-export; new file for packets")
    command("workspace-export", "Export the entire editable source/domain/operation workspace").add_argument("--out", required=True)
    for name in ["handoff-receive", "packet-receive", "workspace-receive"]:
        command(name, "Receive the complete original packet and resume the same archive").add_argument("--input", required=True)
    p = command("serve", "Open the original private industrial operator and live connection descriptor")
    p.add_argument("--port", type=int, default=0)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    root = Path(args.workspace).expanduser()
    if not root.is_absolute():
        raise InputError("--workspace must select an absolute native directory")
    create = args.command == "init" or args.command == "serve" and not root.exists()
    with Workspace(root, create=create, credentials_file=args.credentials_file) as ws:
        if args.expected_workspace_id and ws.workspace_id != args.expected_workspace_id:
            raise ConflictError("Selected native workspace UUID differs from the reviewed owner identity")
        command = args.command
        if command == "serve":
            if not 0 <= args.port <= 65535:
                raise InputError("Choose a valid local operator port")
            from eltss_server import OperatorServer
            with OperatorServer(ws, args.port) as server:
                emit(server.startup())
                server.serve_forever(poll_interval=0.2)
            return 0
        bodies = {"connection-save": ws.save_connection, "request-save": ws.save_request,
            "edition-save": ws.save_edition, "review-profile": ws.adopt_profile, "review-save": ws.save_review_set,
            "assess": ws.assess, "decision-save": ws.save_decision, "edition-compare": ws.compare_editions,
            "correction-preview": ws.preview_correction, "correction-apply": ws.apply_correction,
            "handoff-prepare": ws.prepare_handoff, "receiving-save": ws.save_receiving, "plan-save": ws.save_plan}
        if command in bodies:
            result = bodies[command](read_json(args.input))
        elif command in {"init", "status"}:
            result = ws.state()
        elif command == "catalogue":
            result = ws.catalogue()
        elif command == "profile":
            result = ws.profile(args.profile_id)
        elif command == "auth-profiles":
            result = ws.auth_profiles()
        elif command == "advance":
            result = ws.advance(args.request_id, args.operation_id)
        elif command in {"source-add", "artifact-add"}:
            path = Path(args.input).expanduser()
            with path.open("rb") as stream:
                result = ws.add_source(stream, args.label, args.name or path.name) if command == "source-add" else ws.add_artifact(
                    stream, args.label, args.name or path.name, args.content_type)
        elif command == "source-file":
            if args.member:
                with ws.open_source_member(args.source_id, args.member) as stream:
                    destination = Path(args.out).expanduser().absolute()
                    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                        shutil.copyfileobj(stream, out, 65536)
                        out.flush()
                        os.fsync(out.fileno())
                from eltss_runtime import original_workspace
                result = {"file": str(destination), "bytes": destination.stat().st_size,
                          "sha256": original_workspace.file_digest(destination, 512 * 1024 * 1024)}
            else:
                result = copy_original(ws.source_path(args.source_id), args.out)
        elif command == "source-rows":
            result = ws.source_rows(args.source_id, args.resource_type, args.offset, args.limit, args.query)
        elif command == "source-row":
            result = ws.source_row(args.source_id, args.record_id)
        elif command == "graph-create":
            result = ws.graph(args.source_id, read_json(args.input))
        elif command == "graph-nodes":
            result = ws.graph_nodes(args.graph_id, args.resource_type, args.offset, args.limit, args.query)
        elif command == "graph-edges":
            result = ws.graph_edges(args.graph_id, args.status, args.offset, args.limit, args.query)
        elif command == "graph-node":
            result = ws.graph_node(args.graph_id, args.record_id)
        elif command == "assessment-cells":
            result = ws.assessment_cells(args.assessment_id, args.care_plan_id, args.field_key, args.status, args.offset, args.limit)
        elif command in {"assessment-file", "edition-changes-file", "comparison-file", "artifact-file"}:
            path = {"assessment-file": lambda: ws.assessment_file(args.assessment_id),
                "edition-changes-file": lambda: ws.edition_changes_file(args.comparison_id),
                "comparison-file": lambda: ws.comparison_file(args.comparison_id),
                "artifact-file": lambda: ws.artifact_path(args.artifact_id)}[command]()
            result = copy_original(path, args.out)
        elif command in {"edition-changes", "comparison-changes"}:
            result = ws.edition_changes(args.comparison_id, args.offset, args.limit) if command == "edition-changes" else ws.comparison_page(
                args.comparison_id, args.offset, args.limit)
        elif command == "mapping":
            result = ws.default_mapping(args.source_id, args.resource_type, args.name)
        elif command == "preview":
            result = ws.projection_preview(args.source_id, read_json(args.input), args.limit)
        elif command == "build":
            result = ws.build(args.source_id, args.plan_id)
        elif command == "query":
            query = read_json(args.query_file) if args.query_file else {}
            if not isinstance(query, dict) or any(type(value) is not str for value in query.values()):
                raise InputError("Original native query parameters are scalar strings")
            result = ws.query(args.build_id, query)
        elif command == "compare":
            result = ws.compare(args.before_id, args.after_id)
        elif command == "handoff-export":
            result = ws.export_handoff(args.handoff_id, Path(args.out))
        elif command == "dataset-export":
            result = ws.export_dataset(args.build_id, Path(args.out))
        elif command == "packet-export":
            result = ws.export_packet(args.build_id, Path(args.out))
        elif command == "workspace-export":
            result = ws.export_workspace(Path(args.out))
        elif command in {"handoff-receive", "packet-receive", "workspace-receive"}:
            result = {"handoff-receive": ws.import_handoff, "packet-receive": ws.import_packet,
                      "workspace-receive": ws.import_workspace}[command](Path(args.input))
        else:
            functions = {"connection": (ws.connection, args.__dict__.get("connection_id")),
                "discover": (ws.discover, args.__dict__.get("connection_id")),
                "discovery": (ws.discovery, args.__dict__.get("discovery_id")),
                "request": (ws.request, args.__dict__.get("request_id")),
                "operation": (ws.operation, args.__dict__.get("operation_id")),
                "pause": (ws.pause, args.__dict__.get("operation_id")),
                "resume": (ws.resume, args.__dict__.get("operation_id")),
                "source": (ws.source, args.__dict__.get("source_id")),
                "source-members": (ws.source_members, args.__dict__.get("source_id")),
                "graph": (ws.graph_view, args.__dict__.get("graph_id")),
                "edition": (ws.edition, args.__dict__.get("edition_id")),
                "review": (ws.review_set, args.__dict__.get("review_id")),
                "assessment": (ws.assessment, args.__dict__.get("assessment_id")),
                "decision": (ws.decision, args.__dict__.get("decision_id")),
                "edition-comparison": (ws.edition_comparison, args.__dict__.get("comparison_id")),
                "handoff": (ws.handoff, args.__dict__.get("handoff_id")),
                "receiving": (ws.receiving, args.__dict__.get("receiving_id")),
                "plan": (ws.plan, args.__dict__.get("plan_id")),
                "build-show": (ws.build_view, args.__dict__.get("build_id"))}
            fn, ident = functions[command]
            result = fn(ident)
        emit(result)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (InputError, ConflictError, ProviderError) as error:
        emit({"error": str(error), "kind": type(error).__name__,
              **({"status": error.status} if getattr(error, "status", None) is not None else {})})
        raise SystemExit(2)
