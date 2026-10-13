#!/usr/bin/env python3
"""Adopt an original regional atlas and continue the maintained report receiver.

The atlas producer owns its recipe, figures, data and geographic selections.
This entrypoint retains those originals and delegates rendering, complete export
and independent reopening to the application's existing scientific receiver.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys
from types import SimpleNamespace

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.common import atomic_json, digest, file_digest, held, read_json, relative_file, verify_file
from model import observed_context
from model.workspace import Workspace

SCHEMA = "upstate.regional-atlas-adoption/v1"


def require(value, message):
    if not value:
        raise ValueError(message)


def identity(path):
    path = Path(path)
    return {"bytes": path.stat().st_size, "sha256": file_digest(path)}


def member(root, name):
    require(isinstance(name, str) and "\\" not in name and "\0" not in name,
            "Atlas source members need portable relative paths.")
    path = PurePosixPath(name)
    require(not path.is_absolute() and bool(path.parts) and ".." not in path.parts
            and path.as_posix() == name, "Atlas source members must stay within their original directory.")
    return relative_file(root, name)


def manifest_inventory(path, source_id=None):
    value = read_json(path)
    require(value.get("schema") == "upstate.sources/v1" and isinstance(value.get("entries"), list),
            "Select the original upstate.sources/v1 manifest.")
    reports = [row for row in value["entries"]
               if row.get("kind") == "document"
               and (row.get("metadata") or {}).get("report_schema") == observed_context.SCHEMA
               and (source_id is None or row.get("id") == source_id)]
    require(len(reports) == 1, "Select one original typed report, using --source-id when needed.")
    files = {}
    for row in value["entries"]:
        for descriptor in [row] + row.get("companions", []):
            name = descriptor["path"]
            actual = identity(member(path.parent, name))
            require(not descriptor.get("sha256") or descriptor["sha256"] == actual["sha256"],
                    "An original atlas source hash changed: " + name)
            require("bytes" not in descriptor or descriptor["bytes"] == actual["bytes"],
                    "An original atlas source size changed: " + name)
            require(name not in files or files[name] == actual, "Conflicting original atlas member: " + name)
            files[name] = actual
    return {"path": str(path), **identity(path), "source_id": reports[0]["id"],
            "members": {name: files[name] for name in sorted(files)}}


def source_record(workspace, choice):
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    require(entry.get("kind") == "document"
            and (entry.get("metadata") or {}).get("report_schema") == observed_context.SCHEMA,
            "Choose the original typed regional atlas document.")
    recipe = read_json(path)
    require(recipe.get("schema") == observed_context.SCHEMA,
            "The selected atlas needs its original observed-report recipe.")
    require(recipe.get("project_id") == workspace.project["id"],
            "Open the atlas's original project before adopting its scientific sources.")
    metadata_project = (entry.get("metadata") or {}).get("project_id")
    require(metadata_project is None or metadata_project == workspace.project["id"],
            "The atlas entry and original project disagree.")
    binding = observed_context.bind(workspace, {"observed_context_sources": [choice]})
    collection = workspace.retained_item("sources", choice["source_collection_id"])
    original_manifest = collection["original_manifest"]
    verify_file(workspace.root, {**original_manifest, "path": original_manifest["object"]})
    return {"source": choice, "entry": entry, "binding": binding,
            "original_manifest": collection["original_manifest"],
            "recipe_project_id": recipe["project_id"],
            "native_bindings": recipe.get("native_bindings"),
            "source_links": recipe.get("source_links", []),
            "recipe_title": recipe.get("title") or entry["title"]}


def receiver():
    path = APP / "source/observed-report-20261013/receive_operator.py"
    spec = importlib.util.spec_from_file_location("upstate_regional_atlas_receiver", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    require(callable(getattr(module, "receive", None)), "Install the complete maintained scientific receiver.")
    return module


def adopt(args):
    workspace_path = args.workspace.resolve(strict=True)
    output = args.output.resolve()
    require(not output.is_relative_to(workspace_path) and not workspace_path.is_relative_to(output)
            and not output.is_relative_to(APP) and not APP.is_relative_to(output),
            "Keep application, original Workspace and adoption output in separate trees.")
    require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64,
            "Use positive task time and upload capacity from 1 to 64 GiB.")
    workspace = Workspace(workspace_path, create=False)
    supplied_source = bool(args.manifest or args.source_collection or args.source_id)
    if args.resume:
        require(output.is_dir(), "Select the retained atlas adoption output.")
    else:
        require(not output.exists(), "Use --resume for this retained atlas adoption.")
        require(bool(args.manifest) != bool(args.source_collection),
                "Provide an original manifest or retained source collection.")
        require(not args.source_collection or bool(args.source_id),
                "A retained collection needs its original source ID.")
        output.mkdir(parents=True)

    with held(output / ".regional-atlas-adoption.lock", blocking=False):
        request_path = output / "atlas-selection.json"
        if request_path.exists():
            require(args.resume, "Resume the original atlas adoption.")
            require(not supplied_source and args.title is None and args.contact_json is None,
                    "Resume the saved atlas selection without replacement sources, title or contact.")
            request = read_json(request_path)
            require(request.get("schema") == SCHEMA
                    and request.get("workspace") == str(workspace_path)
                    and request.get("project_id") == workspace.project["id"],
                    "The saved atlas adoption belongs to a different original Workspace.")
        else:
            require(bool(args.manifest) != bool(args.source_collection),
                    "Supply the original source selection to finish an interrupted first adoption.")
            require(not args.source_collection or bool(args.source_id),
                    "A retained collection needs its original source ID.")
            require(not any(path.name != ".regional-atlas-adoption.lock" for path in output.iterdir()),
                    "The atlas adoption output already contains another operation.")
            title = args.title
            require(title is None or isinstance(title, str) and bool(title.strip()),
                    "Enter a nonempty report title.")
            contact = read_json(args.contact_json.resolve(strict=True)) if args.contact_json else None
            require(contact is None or isinstance(contact, dict), "Report contact must be an object.")
            inventory = manifest_inventory(args.manifest.resolve(strict=True), args.source_id) if args.manifest else None
            choice = ({"source_collection_id": args.source_collection, "source_id": args.source_id}
                      if args.source_collection else None)
            request = {"schema": SCHEMA, "workspace": str(workspace_path),
                       "project_id": workspace.project["id"], "manifest": inventory,
                       "source": choice, "title": title, "contact": contact}
            atomic_json(request_path, request, immutable=True)

        operation_id = digest(request)
        receipt_path = output / "regional-atlas-source.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            require(receipt.get("schema") == SCHEMA and receipt.get("operation_id") == operation_id,
                    "The saved atlas source receipt belongs to another selection.")
            record = source_record(workspace, receipt["source"])
            # Collector implementation editions may advance while original source
            # objects and an already-completed report stay unchanged.
            def original_source(value):
                return {**value, "binding": {key: item for key, item in value["binding"].items()
                                            if key != "edition"}}
            require(original_source(record) == original_source(receipt["retained_source"]),
                    "The original retained atlas source changed.")
            record = receipt["retained_source"]
        else:
            selected = request["source"]
            if request["manifest"] is not None:
                original = request["manifest"]
                manifest_path = Path(original["path"])
                require(manifest_inventory(manifest_path, original["source_id"]) == original,
                        "The original atlas manifest or companions changed before adoption.")
                imported = workspace.import_sources(manifest_path)
                require(manifest_inventory(manifest_path, original["source_id"]) == original,
                        "The original atlas changed during source import.")
                selected = {"source_collection_id": imported["id"], "source_id": original["source_id"]}
            record = source_record(workspace, selected)
            receipt = {"schema": SCHEMA, "state": "adopted", "operation_id": operation_id,
                       "project_id": workspace.project["id"], "workspace": str(workspace_path),
                       "source": selected, "retained_source": record,
                       "report_selection": {"sources": [selected],
                           "title": request["title"] or record["recipe_title"]}}
            if request["contact"] is not None:
                receipt["report_selection"]["contact"] = request["contact"]
            atomic_json(receipt_path, receipt, immutable=True)

        if request["manifest"] is not None:
            originals = request["manifest"]["members"]
            for descriptor in [record["entry"]["body"]] + record["entry"].get("companions", []):
                expected = originals.get(descriptor["source_path"])
                require(expected is not None
                        and all(descriptor[key] == expected[key] for key in ("bytes", "sha256")),
                        "The retained atlas differs from the original imported member.")
        selection_path = output / "source-selection.json"
        atomic_json(selection_path, receipt["report_selection"], immutable=True)
        result = {"schema": SCHEMA, "state": "adopted", "operation_id": operation_id,
                  "project_id": workspace.project["id"], "source": receipt["source"],
                  "source_receipt": str(receipt_path), "selection": str(selection_path),
                  "receiving_output": str(output / "receiving"),
                  "browser": {"view": "sources", "section": "Source reports",
                              "source": receipt["source"]}}
        if args.receive:
            maintained = receiver()
            receiving_output = output / "receiving"
            maintained.receive(SimpleNamespace(
                workspace=workspace_path, output=receiving_output, manifest=None,
                selection=selection_path, course=None, title=None, contact_json=None,
                create_workspace=False, resume=receiving_output.exists(), selected_study=True,
                timeout=args.timeout, upload_limit_gib=args.upload_limit_gib,
                browser_node=args.browser_node, video=args.video))
            receiving_path = receiving_output / "scientific-report-receiving.json"
            received = read_json(receiving_path)
            require(received.get("state") == "complete"
                    and received.get("project_id") == workspace.project["id"]
                    and received.get("original_workspace") == str(workspace_path)
                    and received.get("sources") == [receipt["source"]],
                    "The maintained receiver returned a different original atlas selection.")
            result.update(state="complete", receiving_receipt=str(receiving_path),
                          receiving_receipt_identity=identity(receiving_path),
                          receiving_operation_id=received["operation_id"],
                          edition_id=received["edition_id"],
                          restored_workspace=received["restored_workspace"],
                          selected_study_receiving=received["selected_study_receiving"])
        result_path = output / "regional-atlas-receiving.json"
        if not args.receive and result_path.exists():
            prior = read_json(result_path)
            require(prior.get("operation_id") == operation_id and prior.get("source") == receipt["source"],
                    "The retained atlas outcome belongs to another source.")
            if prior.get("state") == "complete":
                require(identity(Path(prior["receiving_receipt"])) == prior["receiving_receipt_identity"],
                        "The original completed receiving receipt changed.")
                result = prior
        atomic_json(result_path, result)
        print(json.dumps(result, sort_keys=True, allow_nan=False), flush=True)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--manifest", type=Path, help="Original regional-atlas.sources.json, unchanged.")
    source.add_argument("--source-collection", help="Already-retained original source collection ID.")
    parser.add_argument("--source-id", help="Original typed report ID; required with --source-collection.")
    parser.add_argument("--title")
    parser.add_argument("--contact-json", type=Path)
    parser.add_argument("--receive", action="store_true",
                        help="Continue native rendering, complete archive and independent reopening.")
    parser.add_argument("--resume", action="store_true",
                        help="Continue only the saved atlas selection and original receiving tasks.")
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    parser.add_argument("--browser-node", type=Path)
    parser.add_argument("--video", action="store_true")
    return adopt(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
