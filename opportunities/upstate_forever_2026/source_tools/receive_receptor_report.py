"""Receive a saved source-water report through the original scientific workflow.

Reuses retained network/preparation products and queued report operations, then
reopens their complete Workspace and optional editable selected Study.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import atomic_json, digest, held, identifier, read_json
from model.workspace import Workspace
from model import receptor_report_source as source
from model import receptor_scenarios


def require(value, message):
    if not value:
        raise ValueError(message)


def file_identity(path):
    checksum = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            checksum.update(block)
    return {"bytes": size, "sha256": checksum.hexdigest()}


def receiver():
    path = APP / "source/observed-report-20261013/receive_operator.py"
    require(path.is_file(), "Install the complete original scientific report receiving family.")
    spec = importlib.util.spec_from_file_location("upstate_receptor_scientific_receiver", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    require(callable(getattr(module, "receive", None)),
            "The maintained scientific receiver must expose receive(args).")
    return module, path


def selected_receiver():
    from model import receptor_study_transfer
    require(callable(getattr(receptor_study_transfer, "verify_received", None)),
            "Install the current six-root Source-water Study transfer family with verify_received.")
    return receptor_study_transfer


def snapshot(workspace, report_id):
    """Read and verify exact saved products; opening never renders new maps."""
    product = source.inspect(workspace, identifier(report_id))
    network_root, network, _ = receptor_scenarios._network(workspace, product["network_result_id"])
    prepared = (receptor_scenarios.inspect(workspace, product["preparation_id"])
                if product["preparation_id"] is not None else None)
    require(not prepared or prepared["network_result_id"] == network["id"],
            "The retained prepared areas changed their original network.")
    require(product["source_binding"] == network["source_binding"]
            and (prepared is None or prepared["source_binding"] == network["source_binding"]),
            "The original source-water products changed their shared source binding.")
    report_root = workspace.root / source.FOLDER / product["id"]
    return {
        "project_id": workspace.project["id"], "report_id": product["id"],
        "source_choice": product["source_choice"], "title": product["title"],
        "network_result_id": network["id"],
        "preparation_id": (prepared or {}).get("id"),
        "prepared_source_collection_id": (prepared or {}).get("source_collection_id"),
        "source_binding": product["source_binding"],
        "report_result": file_identity(report_root / "result.json"),
        "network_result": file_identity(network_root / "result.json"),
        "prepared_result": (file_identity(workspace.root / receptor_scenarios.FOLDER
                                          / prepared["id"] / "result.json") if prepared else None),
        "network_huc12_count": product["network_huc12_count"],
        "selected_huc12_count": product["selected_huc12_count"],
        "areas": [{"id": area["id"], "huc12_count": area["huc12_count"]}
                  for area in (prepared or network)["areas"]],
        "include_maps": bool(product["selection"].get("include_maps", False)),
        "source_identity": product["identity"],
    }


def retain(path, value):
    if path.exists():
        require(read_json(path) == value, "The retained original receiving record changed: " + path.name)
    else:
        atomic_json(path, value, immutable=True)
    return value


def operate(args):
    # Resolve every caller path before loading the original receiver, which
    # installs its application import paths. Relative paths retain their meaning.
    workspace_path = args.workspace.resolve(strict=True)
    output = args.output.resolve()
    browser_node = args.browser_node.resolve(strict=True) if args.browser_node else None
    require(workspace_path.is_dir(), "Open an existing complete Workspace directory.")
    require(not output.is_relative_to(workspace_path) and not workspace_path.is_relative_to(output)
            and not output.is_relative_to(APP) and not APP.is_relative_to(output),
            "Keep application, original Workspace and receiving output in separate trees.")
    require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64,
            "Use positive task time and upload capacity from 1 to 64 GiB.")
    require(not args.video or browser_node is not None, "--video requires the actual browser Node interpreter.")
    require(not args.report_id or (not args.include_maps and args.title is None),
            "A retained --report-id already owns its original title and map selection.")
    if output.exists():
        require(args.resume and output.is_dir(), "Use --resume with the same retained receiving directory.")
    else:
        require(not args.resume, "Start this receiving operation before requesting --resume.")
        output.mkdir(parents=True)
    with held(output / ".source-water-receiving.lock", blocking=False):
        return _operate(args, workspace_path, output, browser_node)


def _operate(args, workspace_path, output, browser_node):
    workspace = Workspace(workspace_path, create=False)
    require(not args.expected_project or workspace.project["id"] == args.expected_project,
            "The opened Workspace belongs to a different original project.")
    chosen = {}
    if args.prepared:
        chosen["preparation_id"] = identifier(args.prepared)
    elif args.network:
        chosen["network_id"] = identifier(args.network)
    if args.title is not None:
        require(bool(args.title.strip()), "Enter a nonempty source geography title.")
        chosen["title"] = args.title.strip()
    if args.include_maps:
        chosen["include_maps"] = True
    requested = {
        "schema": "upstate.source-water-report-receiving-selection/v1",
        "project_id": workspace.project["id"], "workspace": str(workspace.root),
        "source_selection": chosen, "report_id": identifier(args.report_id) if args.report_id else None,
        "selected_study": not args.full_project_only,
    }
    request_path = output / "source-water-selection.json"
    if not request_path.exists():
        require(not any(path.name != ".source-water-receiving.lock" for path in output.iterdir()),
                "Choose an empty receiving directory or the original retained operation.")
    retain(request_path, requested)
    operation_id = digest(requested)
    phase = "opening"
    exception_path = output / "exception.json"

    def progress(name, **values):
        nonlocal phase
        phase = name
        record = {"schema": "upstate.source-water-report-receiving-progress/v1",
                  "operation_id": operation_id, "phase": name, **values}
        atomic_json(output / "progress.json", record)
        print(json.dumps(record, sort_keys=True, allow_nan=False), flush=True)

    try:
        progress("opening", workspace=str(workspace.root), application=str(APP),
                 output=str(output), project_id=workspace.project["id"])
        # Coordinate source publication with ordinary Workspace backup. Release
        # this lock before the queued receiver acquires its own Workspace lock.
        with held(workspace.root / ".workspace.lock"):
            plan_path = output / "source-plan.json"
            if plan_path.exists():
                plan = read_json(plan_path)
                require(plan.get("operation_id") == operation_id
                        and plan.get("id") == digest(plan.get("identity")),
                        "The saved source plan belongs to a different original operation.")
            else:
                if requested["report_id"] is not None:
                    original = source.inspect(workspace, requested["report_id"])
                    identity = original["identity"]
                    selection = original["selection"]
                else:
                    selection, identity, _, _, _, _ = source._capture(workspace, chosen)
                plan = {"schema": "upstate.source-water-report-receiving-plan/v1",
                        "operation_id": operation_id, "id": digest(identity),
                        "selection": selection, "identity": identity}
                atomic_json(plan_path, plan, immutable=True)
            require(plan["identity"].get("workspace_id") == workspace.project["id"]
                    and (not requested["report_id"] or plan["id"] == requested["report_id"]),
                    "The saved source plan changed its original project or requested report.")
            report_path = workspace.root / source.FOLDER / identifier(plan["id"]) / "result.json"
            progress("source", source_report_id=plan["id"])
            if report_path.exists():
                product = source.inspect(workspace, plan["id"])
            else:
                require(requested["report_id"] is None, "The selected retained source report is absent.")
                _, current_identity, _, _, _, _ = source._capture(workspace, plan["selection"])
                require(current_identity == plan["identity"],
                        "The prepared source/runtime changed before completion; retain this operation "
                        "and explicitly start a new output for the changed edition.")
                product = source.build(workspace, plan["selection"])
            require(product["id"] == plan["id"] and product["identity"] == plan["identity"],
                    "Source preparation changed the original frozen identity.")
            expected = snapshot(workspace, product["id"])
            retain(output / "source-products.json", expected)
            selection_path = output / "scientific-selection.json"
            retain(selection_path, {"sources": [product["source_choice"]], "title": product["title"]})
            progress("source-retained", source_report_id=product["id"],
                     source_choice=product["source_choice"], areas=expected["areas"],
                     include_maps=expected["include_maps"])
    
        transfer = selected_receiver() if requested["selected_study"] else None
        module, receiver_path = receiver()
        course = output / "scientific"
        progress("scientific-report", source_report_id=product["id"],
                 receiver={"path": str(receiver_path), **file_identity(receiver_path)},
                 receiving_output=str(course))
        code = module.receive(SimpleNamespace(
            workspace=workspace.root, output=course, manifest=None, selection=selection_path,
            course=None, title=None, contact_json=None, create_workspace=False,
            resume=course.exists(), selected_study=requested["selected_study"],
            timeout=args.timeout, upload_limit_gib=args.upload_limit_gib,
            browser_node=browser_node, video=args.video))
        require(code == 0, "The original scientific receiver did not complete successfully.")
        course_receipt_path = course / "scientific-report-receiving.json"
        received = read_json(course_receipt_path)
        require(received.get("schema") == "upstate.scientific-report-receiving-workflow/v1"
                and received.get("state") == "complete"
                and received.get("project_id") == workspace.project["id"]
                and received.get("original_workspace") == str(workspace.root)
                and received.get("sources") == [product["source_choice"]],
                "The scientific receiving receipt changed the original project or source selection.")
        progress("independent-reopen", source_report_id=product["id"],
                 scientific_edition_id=received["edition_id"])
        restored_path = Path(received["restored_workspace"]).resolve(strict=True)
        require(restored_path != workspace.root.resolve(),
                "The scientific receiver must reopen an independent Workspace.")
        restored = Workspace(restored_path, create=False)
        require(snapshot(restored, product["id"]) == expected,
                "The whole-Workspace restore changed the saved source-water products.")
        selected_detail = None
        if requested["selected_study"]:
            selected = received.get("selected_study_receiving")
            require(isinstance(selected, dict) and selected.get("edition_id") == received["edition_id"],
                    "The original scientific course omitted its selected Study receiving.")
            selected_path = Path(selected["workspace"]).resolve(strict=True)
            require(selected_path not in {workspace.root.resolve(), restored_path},
                    "The selected Study must reopen in its own independent Workspace.")
            selected_workspace = Workspace(selected_path, create=False)
            require(snapshot(selected_workspace, product["id"]) == expected,
                    "The selected Study restore changed the editable source-water products.")
            selected_detail = transfer.verify_received(selected_workspace, product["id"])
            matched = [row for row in selected_detail["source_water_reports"]
                       if row["study_id"] == selected["study_id"]
                       and row["source_collection_id"] == product["source_choice"]["source_collection_id"]
                       and row["source_id"] == product["source_choice"]["source_id"]
                       and row["relationship"] == "same_project" and row["editable_products"]]
            require(len(matched) == 1 and matched[0]["network_result_id"] == expected["network_result_id"]
                    and matched[0]["preparation_id"] == expected["preparation_id"],
                    "The selected Study lacks the exact editable source-water lineage receipt.")
            atomic_json(output / "selected-source-water-receiving.json", selected_detail)
        outcome = {
            "schema": "upstate.source-water-report-receiving/v1", "state": "complete",
            "operation_id": operation_id, "project_id": workspace.project["id"],
            "application": str(APP), "workspace": str(workspace.root), "output": str(output),
            "source_products": expected, "scientific_edition_id": received["edition_id"],
            "scientific_receiving": {"path": str(course_receipt_path), **file_identity(course_receipt_path)},
            "restored_workspace": str(restored_path),
            "selected_study_receiving": received.get("selected_study_receiving"),
            "selected_source_water_receiving": selected_detail,
            "report_files": received["report_files"], "report_archive": received["report_archive"],
            "workspace_archive": received["workspace_archive"], "tasks": received["tasks"],
            "identity": "MATCH",
        }
        atomic_json(output / "source-water-report-receiving.json", outcome)
        exception_path.unlink(missing_ok=True)
        progress("complete", receipt=str(output / "source-water-report-receiving.json"),
                 source_report_id=product["id"], scientific_edition_id=received["edition_id"],
                 restored_workspace=str(restored_path))
        return outcome
    except BaseException as error:
        failure = {"schema": "upstate.source-water-report-receiving-exception/v1",
                   "operation_id": operation_id, "phase": phase,
                   "type": type(error).__name__, "message": str(error),
                   "workspace": str(workspace.root), "output": str(output),
                   "scientific_progress": str(output / "scientific/receiving-progress.json")}
        try:
            atomic_json(exception_path, failure)
        except OSError as recording_error:
            failure["recording_error"] = {"type": type(recording_error).__name__,
                                          "message": str(recording_error)}
        try:
            print(json.dumps(failure, sort_keys=True, allow_nan=False), file=sys.stderr, flush=True)
        except OSError:
            pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    selected = parser.add_mutually_exclusive_group(required=True)
    selected.add_argument("--prepared", help="Existing prepared source-area result ID")
    selected.add_argument("--network", help="Existing original network result ID")
    selected.add_argument("--report-id", help="Reopen one already prepared scientific source exactly")
    parser.add_argument("--title")
    parser.add_argument("--include-maps", action="store_true",
                        help="Explicitly prepare a new projected-map edition using this host's real native runtime")
    parser.add_argument("--expected-project", help="Require this original Workspace project ID")
    parser.add_argument("--full-project-only", action="store_true",
                        help="Run the full-project course without selected Study export; use a separate output")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    parser.add_argument("--browser-node", type=Path)
    parser.add_argument("--video", action="store_true")
    outcome = operate(parser.parse_args(argv))
    print(json.dumps(outcome, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
