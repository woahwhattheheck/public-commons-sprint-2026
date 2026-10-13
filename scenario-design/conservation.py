"""Original conservation-plan intake and native Upstate scenario design.

Saved-plan selections are imported, not recomputed. The exact received binding is
sealed into the immutable baseline. Native registration reopens that reference
through the maintained model.conservation_bindings module before writing.
"""
from __future__ import annotations
import argparse
import base64
import copy
import hashlib
import importlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any

if __package__:
    from .engine import (DesignError, digest, encode, export_bundle, new_project,
                         realize, require, validate_collection, validate_project)
else:
    from engine import (DesignError, digest, encode, export_bundle, new_project,
                        realize, require, validate_collection, validate_project)

BINDING = "upstate.conservation-binding/v1"
REFERENCE = "upstate.conservation-plan-reference/v1"
ENVELOPE = "eco.conservation-source/v1"
HANDOFF = "eco.upstate-landcover-design/v1"
ROLES = ("reporting_units", "whole_units", "reporting_union", "whole_unit_union")
MAX_BINDING_BYTES = 32 * 1024 * 1024


def read_binding(raw: bytes) -> dict:
    """Read a complete portable view without replacing its owner's validator.

    The offline checks establish the correspondence used by this editor. Original
    selection content/registry checks are performed by the original consumer when
    attached to a native Workspace, using resolve_reference and validate_binding.
    """
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_BINDING_BYTES,
            "Use a complete conservation binding of at most 32 MiB")
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise DesignError("The conservation binding is not UTF-8 JSON") from error
    require(isinstance(value, dict) and value.get("schema") == BINDING,
            "Import the complete upstate.conservation-binding/v1 export")
    for name in ("source_reference", "plan", "study", "source_assets", "native_runs",
                 "geometry", "artifacts", "scientific_contract", "consumer_contract"):
        require(isinstance(value.get(name), dict), f"The complete binding needs {name}")
    require(isinstance(value.get("id"), str) and re.fullmatch(r"[a-f0-9]{64}", value["id"]),
            "The original binding id must be retained")
    reference, plan, study = value["source_reference"], value["plan"], value["study"]
    require(reference.get("schema") == REFERENCE and reference.get("kind") == "conservation_plan",
            "Retain the original conservation-plan reference")
    require(isinstance(reference.get("workspace_id"), str) and reference["workspace_id"],
            "The original Workspace id is required")
    require(plan.get("id") == reference.get("plan_id") and study.get("id") == reference.get("study_id")
            and plan.get("study_id") == study.get("id"), "Plan/study reference mismatch")
    require(plan.get("state") == study.get("state") == "complete", "Import a completed saved plan")
    selected, rows = reference.get("selected_ids"), value.get("selected_units")
    require(isinstance(selected, list) and selected and all(isinstance(v, str) and v for v in selected)
            and len(set(selected)) == len(selected), "Original selected IDs must be unique strings")
    require(plan.get("selected_ids") == selected and isinstance(rows, list) and len(rows) == len(selected),
            "Retain the complete original selection in saved order")
    keys = []
    for native_id, row in zip(selected, rows):
        require(isinstance(row, dict), "Every selected unit must retain its original record")
        require(isinstance(row.get("unit_ref"), dict) and isinstance(row.get("candidate"), dict), "Original unit identity and candidate are required")
        ref, candidate = row.get("unit_ref", {}), row.get("candidate", {})
        require(ref.get("native_id") == candidate.get("id") == native_id,
                "A selected native string ID differs from its original candidate")
        for name in ("unit_key", "source_collection_id", "source_id"):
            require(isinstance(ref.get(name), str) and ref[name], f"Missing selected-unit {name}")
        require(row.get("plan_ref") == {k: reference[k] for k in ("workspace_id", "plan_id", "study_id")},
                "A selected unit refers to a different plan")
        require(isinstance(row.get("implementation_basis"), dict), "Original planning context is required")
        keys.append(ref["unit_key"])
    require(len(set(keys)) == len(keys), "Source-edition unit keys must be unique")
    geometry = value["geometry"]
    require(geometry.get("representation_crs") == "EPSG:4326" and
            geometry.get("coordinate_order") == "longitude, latitude", "Use the original WGS84 geometry export")
    for role in ROLES:
        collection = geometry.get(role)
        validate_collection(collection)
        expected = keys if role.endswith("units") else [plan["id"]]
        require([f.get("id") for f in collection["features"]] == expected,
                f"{role}: the complete original geometry inventory differs")
    return value


def import_binding(raw: bytes, *, title: str | None = None, geometry_role: str = "reporting_units") -> dict:
    value = read_binding(raw)
    require(title is None or isinstance(title, str), "The project title must be text")
    require(geometry_role in ROLES, "Select one of the four explicit original geometry views")
    collection = value["geometry"][geometry_role]
    project = new_project(collection, title or (value["plan"].get("title") or "Conservation design"),
                          f"conservation-{value['plan']['id']}-{geometry_role}.geojson")
    project["baseline"]["source"]["conservation"] = {
        "schema": ENVELOPE, "binding_id": value["id"], "geometry_role": geometry_role,
        "original_binding": {"encoding": "base64", "bytes": len(raw),
                             "sha256": hashlib.sha256(raw).hexdigest(),
                             "data": base64.b64encode(raw).decode("ascii")},
        "source_reference": copy.deepcopy(value["source_reference"]),
        "area_basis": value["geometry"].get("area_basis"),
    }
    validate_project(project)
    return project


def binding_for(project: dict) -> dict | None:
    source = project.get("baseline", {}).get("source", {}).get("conservation")
    if source is None:
        return None
    require(isinstance(source, dict) and source.get("schema") == ENVELOPE,
            "Invalid conservation source envelope")
    original = source.get("original_binding", {})
    require(original.get("encoding") == "base64" and isinstance(original.get("data"), str),
            "The exact original binding bytes are required")
    try:
        raw = base64.b64decode(original["data"], validate=True)
    except (ValueError, TypeError) as error:
        raise DesignError("The original conservation binding encoding is invalid") from error
    require(len(raw) == original.get("bytes") and hashlib.sha256(raw).hexdigest() == original.get("sha256"),
            "The retained original conservation binding changed")
    value = read_binding(raw)
    role = source.get("geometry_role")
    require(role in ROLES and source.get("binding_id") == value["id"]
            and source.get("source_reference") == value["source_reference"],
            "The retained design source differs from the original binding")
    require(digest(value["geometry"][role]) == digest(project["baseline"]["collection"]),
            "The design baseline differs from the selected original geometry view")
    return value


def source_summary(project: dict) -> dict | None:
    value = binding_for(project)
    if value is None:
        return None
    return {"binding_id": value["id"], "source_reference": value["source_reference"],
            "geometry_role": project["baseline"]["source"]["conservation"]["geometry_role"],
            "selected_unit_count": len(value["selected_units"]),
            "area_basis": value["geometry"].get("area_basis"),
            "analysis_crs": value["geometry"].get("analysis_crs"),
            "scientific_contract": value["scientific_contract"],
            "native_run_ids": list(value["native_runs"])}


def landcover_plan(project: dict, alternative_id: str, *, from_codes: list[int], to_code: int,
                   reason: str, prepare_run: dict | None = None) -> dict:
    validate_project(project)
    binding = binding_for(project)
    require(binding is not None, "Receive a saved conservation plan before creating this native handover")
    alt = next((a for a in project["alternatives"] if a["id"] == alternative_id), None)
    require(alt is not None, "Select an independently editable alternative")
    require(isinstance(from_codes, list) and from_codes and all(type(v) is int for v in from_codes)
            and len(set(from_codes)) == len(from_codes), "Source land-cover codes must be unique explicit integers")
    require(type(to_code) is int, "The destination land-cover code must be an explicit integer")
    require(isinstance(reason, str) and 0 < len(reason.strip()) <= 5000, "Give the intended land-cover change reason")
    require(not any(e.get("values") for e in alt.get("edits", {}).values()),
            "This land-cover handover uses geometry and codes; export numeric property changes through the factor adapter")
    if prepare_run is not None:
        require(isinstance(prepare_run, dict) and set(prepare_run) <= {"grid_id", "profile_id", "models"},
                "Use the original grid_id, profile_id and optional selected models")
        for key in ("grid_id", "profile_id"):
            require(isinstance(prepare_run.get(key), str) and prepare_run[key], f"Select an existing {key}")
        if "models" in prepare_run:
            require(isinstance(prepare_run["models"], list) and prepare_run["models"]
                    and all(isinstance(x, str) and x for x in prepare_run["models"])
                    and len(set(prepare_run["models"])) == len(prepare_run["models"]), "Selected models must be unique names")
    geojson = realize(project, alternative_id)
    native_reference = copy.deepcopy(binding["source_reference"])
    return {"schema": HANDOFF, "project_id": project["id"], "project_canonical_sha256": digest(project),
            "alternative_id": alternative_id, "title": alt["title"],
            "design_revision_id": digest(project), "design_source_reference": native_reference,
            "binding_id": binding["id"], "geometry_role": project["baseline"]["source"]["conservation"]["geometry_role"],
            "footprint": {"path": "design.geojson", "sha256": hashlib.sha256(encode(geojson)).hexdigest(),
                          "feature_count": len(geojson["features"]), "meaning": "All included polygons of this explicit alternative"},
            "reason": reason.strip(), "from_codes": list(from_codes), "to_code": to_code,
            "prepare_run": copy.deepcopy(prepare_run),
            "original_binding": "conservation-binding.json", "editable_design": "design-project.zip"}


def export_landcover(project: dict, alternative_id: str, **selection) -> bytes:
    plan = landcover_plan(project, alternative_id, **selection)
    envelope = project["baseline"]["source"]["conservation"]["original_binding"]
    files = {"design.geojson": encode(realize(project, alternative_id)),
             "baseline.geojson": encode(project["baseline"]["collection"]),
             "conservation-binding.json": base64.b64decode(envelope["data"], validate=True),
             "design-project.zip": export_bundle(project), "native-selection.json": encode(plan),
             "README.txt": ("Conservation design handover\nReceive using conservation.py receive with the original Upstate source and Workspace.\n"
                "The complete editable design and exact original saved-plan binding are retained. Referenced native inputs remain in the original Workspace or its complete portable restoration.\n"
                "The original importer, scenario writer and run preparation perform registration; computation is performed by the original native runner.\n").encode()}
    files["checksums.json"] = encode({name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                                     for name, data in files.items()})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return output.getvalue()


def read_landcover(raw: bytes) -> tuple[dict, dict, dict[str, bytes]]:
    """Verify and reopen a complete handover before creating native records."""
    if __package__:
        from .engine import receive_bundle
    else:
        from engine import receive_bundle
    require(isinstance(raw, bytes) and 0 < len(raw) <= 100 * 1024 * 1024,
            "Use a complete handover of at most 100 MiB")
    expected = {"design.geojson", "baseline.geojson", "conservation-binding.json", "design-project.zip",
                "native-selection.json", "README.txt", "checksums.json"}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            require(set(names) == expected and len(names) == len(expected), "Handover members differ")
            require(sum(i.file_size for i in archive.infolist()) <= 200 * 1024 * 1024,
                    "Expanded handover exceeds 200 MiB")
            files = {n: archive.read(n) for n in names}
    except (zipfile.BadZipFile, RuntimeError) as error:
        raise DesignError("Invalid complete design handover") from error
    inventory = json.loads(files["checksums.json"])
    require(set(inventory) == expected - {"checksums.json"}, "Complete member inventory is required")
    for name, item in inventory.items():
        require(item == {"bytes": len(files[name]), "sha256": hashlib.sha256(files[name]).hexdigest()},
                f"Handover content changed: {name}")
    project = receive_bundle(files["design-project.zip"])
    plan = json.loads(files["native-selection.json"])
    require(plan.get("schema") == HANDOFF, "Unsupported native design handover")
    rebuilt = landcover_plan(project, plan["alternative_id"], from_codes=plan["from_codes"],
                             to_code=plan["to_code"], reason=plan["reason"], prepare_run=plan.get("prepare_run"))
    require(plan == rebuilt, "Native selection differs from the complete editable project")
    envelope = project["baseline"]["source"]["conservation"]["original_binding"]
    require(files["conservation-binding.json"] == base64.b64decode(envelope["data"], validate=True),
            "Native source binding differs from the retained original")
    require(files["baseline.geojson"] == encode(project["baseline"]["collection"]), "Original geometry differs")
    require(files["design.geojson"] == encode(realize(project, plan["alternative_id"])), "Edited geometry differs")
    return project, plan, files


def _retain(path: Path, data: bytes) -> None:
    """Create-only, repeat-safe original file receiving; never replace a peer edit."""
    import os
    import tempfile
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == data,
                f"Existing receiving file differs: {path.name}")
        return
    fd, temp = tempfile.mkstemp(prefix=".design-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temp, path)  # Atomic create only, including a concurrent receiver.
        except FileExistsError:
            require(not path.is_symlink() and path.read_bytes() == data,
                    f"Concurrent receiving file differs: {path.name}")
    finally:
        Path(temp).unlink(missing_ok=True)


def register_landcover(workspace: Any, raw: bytes, revision_directory: Path, *,
                       resolve_reference=None) -> dict:
    """Use the original Upstate importer, scenario writer and run preparation.

    The optional resolver injection is for the original application's composition
    and interface journeys; normal callers use its maintained model module. The
    caller owns the existing Workspace lock/queue. No native execution is started.
    """
    project, plan, files = read_landcover(raw)
    binding = binding_for(project)
    if resolve_reference is None:
        resolve_reference = importlib.import_module("model.conservation_bindings").resolve_reference
    # Reopening calls the original saved-plan resolver. Compare the original
    # selection and native asset descriptors, never editor-computed area values.
    resolved = resolve_reference(workspace, plan["design_source_reference"])
    require(isinstance(resolved, dict) and resolved.get("schema") == BINDING,
            "Original resolver must return the complete conservation binding")
    for key in ("source_reference", "selected_units", "source_assets", "scientific_contract"):
        require(digest(resolved.get(key)) == digest(binding[key]),
                f"Original Workspace conservation {key} differs from this retained design")
    root = Path(revision_directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        _retain(root / name, content)
    source_id = "design-" + plan["design_revision_id"][:24] + "-" + digest(plan["alternative_id"])[:12]
    companions = ["baseline.geojson", "conservation-binding.json", "design-project.zip", "native-selection.json"]
    provenance = {"source_reference": plan["design_source_reference"],
                  "binding_id": plan["binding_id"], "project_id": plan["project_id"],
                  "design_revision_id": plan["design_revision_id"], "alternative_id": plan["alternative_id"],
                  "geometry_role": plan["geometry_role"], "handover_sha256": hashlib.sha256(raw).hexdigest()}
    manifest = {"schema": "upstate.sources/v1", "title": plan["title"],
                "captured_at": project["updated_at"], "scope": {"design_revision": provenance}, "entries": [{
        "id": source_id, "kind": "vector", "role": "SCENARIO_MASK", "title": plan["title"],
        "uri": "urn:eco-design:" + plan["design_revision_id"], "vintage": project["updated_at"][:10],
        "path": "design.geojson", "sha256": hashlib.sha256(files["design.geojson"]).hexdigest(),
        "source_crs": "EPSG:4326", "companions": [
            {"path": name, "sha256": hashlib.sha256(files[name]).hexdigest()} for name in companions],
        "scope": {"design_revision": provenance}}]}
    _retain(root / "sources.json", encode(manifest))
    collection = workspace.import_sources(root / "sources.json")
    scenario = workspace.save_scenario({"title": plan["title"], "kind": "landcover",
        "source_collection_id": collection["id"], "reason": plan["reason"],
        "patches": [{"mask_source_id": source_id, "from_codes": plan["from_codes"],
                     "to_code": plan["to_code"], "reason": plan["reason"]}],
        "design_source_reference": plan["design_source_reference"], "design_revision_id": plan["design_revision_id"]})
    result = {"schema": "eco.upstate-landcover-receipt/v1", "source_collection_id": collection["id"],
              "scenario_id": scenario["id"], "design_source_reference": plan["design_source_reference"],
              "design_revision_id": plan["design_revision_id"], "source_id": source_id,
              "source_manifest": str(root / "sources.json"), "run_id": None}
    if plan["prepare_run"] is not None:
        run = workspace.prepare_run({**plan["prepare_run"], "scenario_id": scenario["id"]})
        result["run_id"] = run["id"]
    _retain(root / "native-receipt.json", encode(result))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import", help="Receive a complete native binding as an independently editable project")
    imp.add_argument("binding", type=Path); imp.add_argument("--output", type=Path, required=True)
    imp.add_argument("--title"); imp.add_argument("--geometry-role", choices=ROLES, default="reporting_units")
    exp = sub.add_parser("export", help="Export a complete land-cover design handover")
    exp.add_argument("project", type=Path); exp.add_argument("--alternative", required=True)
    exp.add_argument("--from-code", type=int, action="append", required=True); exp.add_argument("--to-code", type=int, required=True)
    exp.add_argument("--reason", required=True); exp.add_argument("--grid-id"); exp.add_argument("--profile-id")
    exp.add_argument("--model", action="append"); exp.add_argument("--output", type=Path, required=True)
    rec = sub.add_parser("receive", help="Register through the original Upstate Workspace")
    rec.add_argument("bundle", type=Path); rec.add_argument("--native-source", type=Path, required=True)
    rec.add_argument("--workspace", type=Path, required=True); rec.add_argument("--revision-directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "import":
            _retain(args.output, encode(import_binding(args.binding.read_bytes(), title=args.title, geometry_role=args.geometry_role)))
        elif args.command == "export":
            require(bool(args.grid_id) == bool(args.profile_id), "Select both the original grid and profile, or neither")
            require(not args.model or args.grid_id, "Select the existing grid and profile with selected models")
            prepare = {"grid_id": args.grid_id, "profile_id": args.profile_id} if args.grid_id else None
            if args.model: prepare["models"] = args.model
            _retain(args.output, export_landcover(json.loads(args.project.read_bytes()), args.alternative,
                    from_codes=args.from_code, to_code=args.to_code, reason=args.reason, prepare_run=prepare))
        else:
            native = args.native_source.resolve(strict=True)
            require((native / "model/workspace.py").is_file(), "Select the complete original Upstate application root")
            sys.path.insert(0, str(native))
            Workspace = importlib.import_module("model.workspace").Workspace
            workspace = Workspace(args.workspace)
            result = register_landcover(workspace, args.bundle.read_bytes(), args.revision_directory)
            print(json.dumps(result, indent=2))
    except (DesignError, ValueError, OSError, ImportError) as error:
        parser.exit(2, f"conservation design: {error}\n")


if __name__ == "__main__":
    main()
