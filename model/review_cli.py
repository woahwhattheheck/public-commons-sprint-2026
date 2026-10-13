#!/usr/bin/env python3
"""Review, exchange and reopen original Upper Savannah scientific work."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import atomic_json, file_digest
from .workspace import Workspace
from . import reviews, review_handback


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--workspace", type=Path, help="Original or restored scientific workspace")
    root.add_argument("--json-output", type=Path, help="Also retain the result in a new JSON file")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("catalogue", help="List original sources, model outputs, deliveries and saved map exports")
    commands.add_parser("list", help="List review purposes and latest retained dispositions")
    create = commands.add_parser("create", help="Select original source editions, completed model runs, deliveries or saved maps")
    create.add_argument("selection", type=Path)
    maps = commands.add_parser("create-map", help="Review complete saved map exports and their original source context")
    maps.add_argument("export_ids", nargs="+", help="Original completed map export IDs from catalogue")
    maps.add_argument("--title", required=True)
    maps.add_argument("--purpose", required=True)
    maps.add_argument("--source-edition", action="append", default=[], dest="source_ids",
                      help="Also include this retained source edition; repeat for additional editions")
    maps.add_argument("--requirements", type=Path,
                      help="Original requirement list or issuer profile containing requirements")
    maps.add_argument("--note", action="append", default=[], dest="notes")
    show = commands.add_parser("show", help="Reopen a selected review with its original files and response history")
    show.add_argument("review_id")
    show.add_argument("--no-previews", action="store_true", help="Omit text excerpts from this JSON display")
    export = commands.add_parser("export", help="Create a complete offline review desk and selected original files")
    export.add_argument("review_id")
    export.add_argument("destination", type=Path)
    export.add_argument("--zip", dest="archive", type=Path, help="Also create a complete review ZIP")
    template = commands.add_parser("response-template", help="Export an editable response for the latest review history")
    template.add_argument("review_id")
    template.add_argument("destination", type=Path)
    response = commands.add_parser("response-import", help="Retain a completed response without replacing earlier reviews")
    response.add_argument("response", type=Path)
    history = commands.add_parser("history", help="Read the complete ordered response history")
    history.add_argument("review_id")
    compare = commands.add_parser("compare", help="Compare source files and metadata between two review selections")
    compare.add_argument("before_id")
    compare.add_argument("after_id")
    validate = commands.add_parser("validate", help="Reopen review identities, selected original records and response chains")
    validate.add_argument("--files", action="store_true", help="Also read all selected original file bytes")
    inspect = commands.add_parser("packet-inspect", help="Inspect a complete review folder or ZIP")
    inspect.add_argument("packet", type=Path)
    receive = commands.add_parser("packet-receive", help="Extract and reopen a complete offline review packet")
    receive.add_argument("packet", type=Path)
    receive.add_argument("destination", type=Path)
    receive.add_argument("--join", action="store_true", help="Join its review history to --workspace after receiving")
    join = commands.add_parser("packet-import", help="Join original review records to their restored scientific workspace")
    join.add_argument("packet", type=Path)
    backup = commands.add_parser("workspace-backup", help="Use the original full scientific workspace/application archive")
    backup.add_argument("destination", type=Path)
    backup.add_argument("--omit-native-intermediates", action="store_true")
    restore = commands.add_parser("workspace-restore", help="Use original workspace restore, then reopen customer reviews")
    restore.add_argument("archive", type=Path)
    restore.add_argument("destination", type=Path)
    handbacks = commands.add_parser("handbacks", help="List engineering editions attached to original customer requests")
    handbacks.add_argument("--review-id")
    draft = commands.add_parser("handback-template", help="Prepare actual requests and original revised evidence choices")
    draft.add_argument("review_id")
    draft.add_argument("destination", type=Path)
    draft.add_argument("--response-id")
    draft.add_argument("--handback-id")
    draft.add_argument("--revised-review-id")
    save = commands.add_parser("handback-save", help="Save an immutable engineering assignment or ready handback")
    save.add_argument("draft", type=Path)
    show = commands.add_parser("handback-show", help="Reopen engineering response, actual requests and edition history")
    show.add_argument("handback_id")
    export = commands.add_parser("handback-export", help="Export complete original and revised desks with engineering history")
    export.add_argument("handback_id")
    export.add_argument("destination", type=Path)
    export.add_argument("--zip", dest="archive", type=Path)
    inspect = commands.add_parser("handback-inspect", help="Verify a complete engineering handback independently")
    inspect.add_argument("packet", type=Path)
    receive = commands.add_parser("handback-receive", help="Receive both review desks and all engineering editions")
    receive.add_argument("packet", type=Path)
    receive.add_argument("destination", type=Path)
    receive.add_argument("--join", action="store_true", help="Join records to their original restored --workspace")
    return root


def _catalogue(workspace):
    overview = workspace.overview()
    spatial_exports = []
    if overview.get("spatial_exports"):
        from .spatial_exports import SpatialExports
        exporter = SpatialExports(workspace)
        for item in overview["spatial_exports"]:
            original = exporter.inspect(item["id"])
            spatial_exports.append({
                "id": original["id"], "title": original.get("title", original["id"][:12]),
                "state": original["state"], "reviewable": original["state"] == "complete",
                "review_id": original["review_id"], "created_at": original.get("created_at"),
                "selection": original["selection"], "files": len(original.get("files", {})),
                "summary": original.get("summary", {}),
            })
    return {"project": workspace.project,
        "source_editions": [{"id": item["id"], "title": item["title"],
                            "captured_at": item.get("captured_at"), "scope": item.get("scope", {}),
                            "entries": [{"id": row["id"], "title": row["title"], "kind": row["kind"],
                                         "uri": row["uri"], "vintage": row["vintage"],
                                         "bytes": row["body"]["bytes"], "sha256": row["body"]["sha256"],
                                         "companions": len(row["companions"])} for row in item["entries"]]}
                           for item in overview["sources"]],
        "native_runs": [{"id": item["id"], "state": item["state"], "selection": item["selection"],
                         "reviewable": item["state"] == "complete", "artifacts": len(item["artifacts"])}
                        for item in overview["runs"]],
        "deliveries": [{"id": item["id"], "state": item["state"],
                        "title": item["selection"].get("title", item["id"][:12]),
                        "reviewable": item["state"] == "complete", "files": len(item["files"])}
                       for item in overview["deliveries"]],
        "spatial_exports": spatial_exports}


def perform(args):
    if args.command == "handback-inspect":
        inspected = review_handback.inspect_packet(args.packet)
        return {"manifest": inspected["manifest"], "handback": inspected["handback"],
                "engineering_editions": len(inspected["document"]["history"]),
                "review_generations": len(inspected["document"]["reviews"])}
    if args.command == "handback-receive" and not args.join:
        return review_handback.receive_packet(args.packet, args.destination)
    if args.command == "packet-inspect":
        inspected = reviews.inspect_packet(args.packet)
        return {"manifest": inspected["manifest"], "title": inspected["packet"]["review"]["title"],
                "purpose": inspected["packet"]["review"]["purpose"],
                "artifacts": len(inspected["packet"]["files"]),
                "latest_response_id": inspected["packet"]["latest_response_id"]}
    if args.command == "workspace-restore":
        from .portable import restore
        received = restore(args.archive, args.destination)
        workspace = Workspace(received["workspace"])
        return {**received, "customer_reviews": reviews.validate_workspace(workspace)}
    if args.command == "packet-receive" and not args.join:
        return reviews.receive_packet(args.packet, args.destination)
    if args.workspace is None:
        raise ValueError("--workspace is required for this operation")
    workspace = Workspace(args.workspace)
    if args.command == "handbacks":
        return {"project": workspace.project, "handbacks": review_handback.list_handbacks(workspace, args.review_id)}
    if args.command == "handback-template":
        kwargs = {key: getattr(args, key) for key in ("response_id", "handback_id", "revised_review_id")
                  if getattr(args, key) is not None}
        result = review_handback.template(workspace, args.review_id, **kwargs)
        atomic_json(args.destination, result["draft"], immutable=True)
        return {**result, "draft_path": str(args.destination)}
    if args.command == "handback-save":
        value = reviews._read_json_file(args.draft)
        return review_handback.save(workspace, value.get("draft", value))
    if args.command == "handback-show":
        return review_handback.show(workspace, args.handback_id)
    if args.command == "handback-export":
        return review_handback.export_handback(workspace, args.handback_id, args.destination, archive=args.archive)
    if args.command == "handback-receive":
        return review_handback.receive_packet(args.packet, args.destination, workspace=workspace)
    if args.command == "catalogue":
        return _catalogue(workspace)
    if args.command == "list":
        return {"project": workspace.project, "reviews": reviews.list_reviews(workspace)}
    if args.command == "create":
        return reviews.create_review(workspace, reviews._read_json_file(args.selection))
    if args.command == "create-map":
        requirements = []
        notes = list(args.notes)
        if args.requirements is not None:
            profile = reviews._read_json_file(args.requirements)
            requirements = profile.get("requirements") if isinstance(profile, dict) else profile
            if not isinstance(requirements, list):
                raise ValueError("Choose the original requirement list or retained issuer profile")
            notes.append("Requirement source " + args.requirements.name + " SHA256 " + file_digest(args.requirements))
        return reviews.create_review(workspace, {
            "schema": reviews.SELECTION_SCHEMA, "title": args.title, "purpose": args.purpose,
            "source_collection_ids": args.source_ids, "run_ids": [], "delivery_ids": [],
            "spatial_export_ids": args.export_ids, "requirements": requirements, "notes": notes,
        })
    if args.command == "show":
        return reviews.show_review(workspace, args.review_id, previews=not args.no_previews)
    if args.command == "export":
        return reviews.export_review(workspace, args.review_id, args.destination, archive=args.archive)
    if args.command == "response-template":
        value = reviews.response_template(workspace, args.review_id)
        atomic_json(args.destination, value, immutable=True)
        return {"path": str(args.destination), "review_id": args.review_id,
                "previous_response_id": value["previous_response_id"]}
    if args.command == "response-import":
        return reviews.import_response(workspace, reviews._read_json_file(args.response))
    if args.command == "history":
        return {"review_id": args.review_id, "responses": reviews.history(workspace, args.review_id)}
    if args.command == "compare":
        return reviews.compare_reviews(workspace, args.before_id, args.after_id)
    if args.command == "validate":
        return reviews.validate_workspace(workspace, verify_files=args.files)
    if args.command == "packet-import":
        return reviews.import_packet(workspace, reviews.inspect_packet(args.packet)["packet"])
    if args.command == "packet-receive":
        return reviews.receive_packet(args.packet, args.destination, workspace=workspace)
    if args.command == "workspace-backup":
        reviews.validate_workspace(workspace)
        return workspace.backup(args.destination, include_intermediates=not args.omit_native_intermediates)
    raise ValueError("Unknown original customer review operation")


def main(argv=None):
    try:
        args = parser().parse_args(argv)
        result = perform(args)
        if args.json_output is not None:
            atomic_json(args.json_output, result, immutable=True)
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, IndexError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
