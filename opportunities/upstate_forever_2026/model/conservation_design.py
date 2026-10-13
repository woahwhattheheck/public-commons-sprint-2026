"""Original Conservation plans through the retained editable-geometry workbench.

This is a receiving adapter. It calls the original editor and the maintained
Workspace writers; saved plans, scenario IDs and native runs keep their stores.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import threading

from . import conservation, conservation_bindings, conservation_scenarios
from .common import atomic_json, describe_file, digest, held, identifier, now, read_json, verify_file

SCHEMA = "upstate.conservation-design/v1"
ROLES = ("reporting_units", "whole_units", "reporting_union", "whole_unit_union")
EDITOR_PACKAGE = "_upstate_original_scenario_design"
MODULE_LOCK = threading.RLock()
MAX_INLINE_BYTES = 2 * 1024 * 1024
MAX_BUNDLE_BYTES = 100 * 1024 * 1024


def _editor():
    """Load the shipped editor under one private package, without global aliases."""
    root = Path(__file__).resolve().parents[1] / "scenario-design"
    init = root / "__init__.py"
    if not init.is_file():
        raise FileNotFoundError("Receive the complete scenario-design source and its native package initializer")
    with MODULE_LOCK:
        current = sys.modules.get(EDITOR_PACKAGE)
        if current is not None and Path(current.__file__).resolve() != init.resolve():
            raise ValueError("The loaded scenario editor belongs to another application source")
        if current is None:
            spec = importlib.util.spec_from_file_location(
                EDITOR_PACKAGE, init, submodule_search_locations=[str(root)])
            current = importlib.util.module_from_spec(spec)
            sys.modules[EDITOR_PACKAGE] = current
            try:
                spec.loader.exec_module(current)
            except BaseException:
                sys.modules.pop(EDITOR_PACKAGE, None)
                raise
        engine = importlib.import_module(EDITOR_PACKAGE + ".engine")
        design = importlib.import_module(EDITOR_PACKAGE + ".conservation")
    return engine, design


def _base(workspace):
    return workspace.root / "conservation-design"


def _choice(value):
    if not isinstance(value, dict):
        raise ValueError("Supply an original saved plan and an explicit geometry view")
    if set(value) - {"plan_id", "geometry_role", "title"}:
        raise ValueError("Use plan_id, geometry_role and optional title")
    role = value.get("geometry_role", "reporting_units")
    if role not in ROLES:
        raise ValueError("Choose a retained original geometry view")
    title = value.get("title")
    if title is not None and (not isinstance(title, str) or not title.strip() or len(title) > 500):
        raise ValueError("Use a nonempty project title of at most 500 characters")
    return {"plan_id": identifier(value.get("plan_id")),
            "geometry_role": role, "title": title.strip() if title else None}


def prepare(workspace, value):
    """Retain an original binding and a ready-to-edit project for the same plan."""
    choice = _choice(value)
    binding = conservation_bindings.bind_plan(workspace, choice["plan_id"], include_geometry=True)
    selection = {**choice, "binding_id": binding["id"],
                 "source_reference": binding["source_reference"]}
    key = digest(selection)
    directory = _base(workspace) / "preparations" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        if (directory / "preparation.json").exists():
            return {**get_preparation(workspace, key), "reused": True}
        engine, design = _editor()
        binding_path = directory / "conservation-binding.json"
        atomic_json(binding_path, binding, immutable=True)
        raw = binding_path.read_bytes()
        project_path = directory / "project.json"
        if project_path.exists():
            project = read_json(project_path)
            retained = design.binding_for(project)
            if retained["id"] != binding["id"] or (
                    project["baseline"]["source"]["conservation"]["geometry_role"] != choice["geometry_role"]):
                raise ValueError("The retained editable project refers to another original selection")
        else:
            project = design.import_binding(raw, title=choice["title"], geometry_role=choice["geometry_role"])
            design._retain(project_path, engine.encode(project))
        editable = directory / "editable-project.zip"
        design._retain(editable, engine.export_bundle(project))
        record = {
            "schema": SCHEMA, "kind": "preparation", "id": key, "state": "complete",
            "selection": selection, "plan_id": binding["plan"]["id"], "study_id": binding["study"]["id"],
            "workspace_id": workspace.project["id"], "binding_id": binding["id"],
            "project_id": project["id"], "title": project["title"], "geometry_role": choice["geometry_role"],
            "selected_unit_count": len(binding["selected_units"]), "created_at": now(),
            "files": {name: describe_file(workspace.root, path) for name, path in {
                "binding": binding_path, "project": project_path, "editable_project": editable}.items()},
            "editor": {"directory": "scenario-design", "command": "python server.py",
                       "receive": "Receive project → editable-project.zip",
                       "export": "Land-cover scenario → Export complete native handover"},
        }
        atomic_json(directory / "preparation.json", record, immutable=True)
        return record


def get_preparation(workspace, preparation_id):
    key = identifier(preparation_id)
    record = read_json(_base(workspace) / "preparations" / key / "preparation.json")
    if (record.get("schema") != SCHEMA or record.get("kind") != "preparation"
            or record.get("id") != key or digest(record.get("selection")) != key
            or record.get("workspace_id") != workspace.project["id"] or record.get("state") != "complete"):
        raise ValueError("The design preparation belongs to another original Workspace selection")
    for descriptor in record["files"].values():
        verify_file(workspace.root, descriptor)
    binding = read_json(verify_file(workspace.root, record["files"]["binding"]))
    conservation_bindings.validate_binding(binding)
    conservation_bindings.resolve_reference(workspace, binding["source_reference"], include_geometry=False)
    if binding["id"] != record["binding_id"]:
        raise ValueError("The prepared binding differs from its retained original file")
    return record


def _bundle(workspace, value):
    """Full file references keep large handovers out of the operator JSON body."""
    if not isinstance(value, dict) or set(value) - {"file", "source", "bundle_base64"}:
        raise ValueError("Choose one retained handover file, imported source, or small browser upload")
    choices = [name for name in ("file", "source", "bundle_base64") if value.get(name) is not None]
    if len(choices) != 1:
        raise ValueError("Choose exactly one original handover input")
    name = choices[0]
    if name == "file":
        descriptor = value["file"]
        if not isinstance(descriptor, dict):
            raise ValueError("Supply the complete workspace-relative file descriptor")
        path = verify_file(workspace.root, descriptor)
        if path.stat().st_size > MAX_BUNDLE_BYTES:
            raise ValueError("The original design handover exceeds 100 MiB")
        raw = path.read_bytes()
        identity = {"kind": "workspace_file", "file": describe_file(workspace.root, path)}
    elif name == "source":
        selection = value["source"]
        if not isinstance(selection, dict) or set(selection) != {"source_collection_id", "source_id"}:
            raise ValueError("Choose the retained source collection and original source entry")
        path, entry = workspace.source_file(selection["source_collection_id"], selection["source_id"])
        if entry["kind"] != "document":
            raise ValueError("Import the full design ZIP as a document source")
        if path.stat().st_size > MAX_BUNDLE_BYTES:
            raise ValueError("The original design handover exceeds 100 MiB")
        raw = path.read_bytes()
        identity = {"kind": "source_document", "selection": dict(selection),
                    "file": describe_file(workspace.root, path), "source": entry}
    else:
        encoded = value["bundle_base64"]
        if not isinstance(encoded, str) or len(encoded) > ((MAX_INLINE_BYTES + 2) // 3) * 4:
            raise ValueError("Use a retained file or imported document for a design ZIP larger than 2 MiB")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError("Receive the original base64-encoded ZIP bytes") from error
        if len(raw) > MAX_INLINE_BYTES:
            raise ValueError("Use a retained file for a design ZIP larger than 2 MiB")
        identity = {"kind": "browser_upload"}
    if not raw:
        raise ValueError("Receive a complete nonempty design handover")
    identity.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    return raw, identity


class _ReceivingWorkspace:
    """Delegate all original writers and normalize only the requested run scope."""
    def __init__(self, workspace, run_selection):
        self.workspace, self.run_selection = workspace, run_selection

    def import_sources(self, path):
        return self.workspace.import_sources(path)

    def save_scenario(self, value):
        return self.workspace.save_scenario(value)

    def prepare_run(self, value):
        supplied = {key: item for key, item in value.items() if key != "scenario_id"}
        if self.run_selection is None:
            raise ValueError("This design did not request native run preparation")
        requested = conservation_scenarios._effective_run(self.workspace, supplied)
        if requested != self.run_selection:
            raise ValueError("The design run selection changed during receiving")
        return self.workspace.prepare_run({**self.run_selection, "scenario_id": value["scenario_id"]})


def receive(workspace, value):
    """Receive the full edited design through the original source/scenario writers."""
    raw, input_reference = _bundle(workspace, value)
    engine, design = _editor()
    project, request, members = design.read_landcover(raw)
    reference = request["design_source_reference"]
    conservation_bindings.resolve_reference(workspace, reference, include_geometry=False)
    key = digest({"workspace_id": workspace.project["id"], "handover_sha256": input_reference["sha256"]})
    directory = _base(workspace) / "received" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".receive.lock", blocking=False):
        if (directory / "receiving.json").exists():
            return {**get_receiving(workspace, key), "reused": True}
        original_zip = directory / "original-handover.zip"
        design._retain(original_zip, raw)
        revision = directory / "revision"
        revision.mkdir(parents=True, exist_ok=True)
        design._retain(revision / "design.geojson", members["design.geojson"])
        effective = None
        coverage = None
        if request.get("prepare_run") is not None:
            effective = conservation_scenarios._effective_run(workspace, request["prepare_run"])
            coverage = conservation_scenarios._validate_run(
                workspace, {"prepare_run": effective, "to_code": request["to_code"]},
                revision / "design.geojson", None)
        receipt = design.register_landcover(
            _ReceivingWorkspace(workspace, effective), raw, revision,
            resolve_reference=lambda _view, ref: conservation_bindings.resolve_reference(
                workspace, ref, include_geometry=False))
        selected_ids = list(reference["selected_ids"])
        files = {"handover": describe_file(workspace.root, original_zip)}
        for name in sorted(members):
            files[name] = describe_file(workspace.root, revision / name)
        for name in ("sources.json", "native-receipt.json"):
            files[name] = describe_file(workspace.root, revision / name)
        record = {
            "schema": SCHEMA, "kind": "receiving", "id": key, "state": "complete",
            "workspace_id": workspace.project["id"], "created_at": now(),
            "input": input_reference, "plan_id": reference["plan_id"], "study_id": reference["study_id"],
            "source_reference": reference, "binding_id": request["binding_id"],
            "project_id": project["id"], "design_revision_id": request["design_revision_id"],
            "alternative_id": request["alternative_id"], "title": request["title"],
            "selected_ids": selected_ids, "geometry_role": request["geometry_role"],
            "edited_feature_count": request["footprint"]["feature_count"],
            "scenario_id": receipt["scenario_id"], "run_id": receipt.get("run_id"),
            "source_collection_id": receipt["source_collection_id"], "source_id": receipt["source_id"],
            "run_selection": effective, "model_domain_coverage": coverage,
            "native_receipt": receipt, "files": files,
            "meaning": "Edited alternative geometry and explicit land-cover inputs derived from the original saved plan",
            "native_execution": "Continue the returned original run through the existing run.start operation",
        }
        atomic_json(directory / "receiving.json", record, immutable=True)
        return record


def get_receiving(workspace, receiving_id):
    key = identifier(receiving_id)
    record = read_json(_base(workspace) / "received" / key / "receiving.json")
    expected = digest({"workspace_id": workspace.project["id"],
                       "handover_sha256": record.get("input", {}).get("sha256")})
    if (record.get("schema") != SCHEMA or record.get("kind") != "receiving"
            or record.get("id") != key or expected != key or record.get("state") != "complete"
            or record.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The design receiving belongs to another original handover")
    for descriptor in record["files"].values():
        verify_file(workspace.root, descriptor)
    conservation_bindings.resolve_reference(workspace, record["source_reference"], include_geometry=False)
    scenario = workspace._get("scenarios", record["scenario_id"])
    if scenario["id"] != record["scenario_id"]:
        raise ValueError("The original native scenario identity changed")
    if record.get("run_id"):
        run = workspace._get("runs", record["run_id"])
        if run["selection"]["scenario_id"] != scenario["id"]:
            raise ValueError("The original prepared native run belongs to another scenario")
    return record


def overview(workspace):
    result = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
              "geometry_roles": list(ROLES), "inline_upload_limit_bytes": MAX_INLINE_BYTES,
              "plans": [], "preparations": [], "receivings": []}
    result["plans"] = [{"id": plan["id"], "title": plan.get("title", plan["id"]),
                        "study_id": plan["study_id"], "state": plan["state"]}
                       for plan in conservation.overview(workspace)["plans"]
                       if plan.get("state") == "complete"]
    for folder, filename, group in (("preparations", "preparation.json", "preparations"),
                                     ("received", "receiving.json", "receivings")):
        parent = _base(workspace) / folder
        if not parent.exists():
            continue
        for path in sorted(parent.glob("*/" + filename)):
            item = read_json(path)
            if item.get("schema") != SCHEMA or item.get("workspace_id") != workspace.project["id"]:
                raise ValueError("A retained design operation belongs to another Workspace")
            result[group].append({key: item.get(key) for key in (
                "id", "title", "state", "created_at", "plan_id", "study_id",
                "geometry_role", "project_id", "scenario_id", "run_id")})
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    sub = parser.add_subparsers(dest="operation", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("--plan-id", required=True)
    prepare_parser.add_argument("--geometry-role", choices=ROLES, default="reporting_units")
    prepare_parser.add_argument("--title")
    receive_parser = sub.add_parser("receive")
    receive_parser.add_argument("--descriptor", required=True, type=Path,
                                help="JSON containing a complete workspace-relative file descriptor")
    sub.add_parser("list")
    read_parser = sub.add_parser("inspect")
    read_parser.add_argument("--kind", choices=("preparation", "receiving"), required=True)
    read_parser.add_argument("--id", required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.operation == "prepare":
        result = prepare(workspace, {"plan_id": args.plan_id, "geometry_role": args.geometry_role,
                                     "title": args.title})
    elif args.operation == "receive":
        result = receive(workspace, {"file": read_json(args.descriptor)})
    elif args.operation == "inspect":
        result = (get_preparation if args.kind == "preparation" else get_receiving)(workspace, args.id)
    else:
        result = overview(workspace)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
