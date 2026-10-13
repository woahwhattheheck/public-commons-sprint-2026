"""Editable GIS handover for the original completed geographic reference trio.

The full captured study may retain pending sensitivity members. Only the three
original reference runs are selected for physical GIS layers and elapsed history.
No model execution or new scientific comparison is performed.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, identifier,
                     read_json, verify_file)
from . import geographic_programme as geography
from . import gis_project as gis
from . import gis_workspace
from . import native_run_history as history
from . import ensemble_study_transfer as study
from .gis_native_study import _SourceReader
from .observed_context import source_choices as observed_source_choices

SCHEMA = "upstate.geographic-reference-gis/v1"
VERSION = 1
DIRECTORY = "geographic-gis-handovers"
SOURCE_ID = "GEOGRAPHIC_REFERENCE_GIS_CONTEXT"


def _captured(workspace, scientific):
    if (scientific.get("workspace_id") != workspace.project["id"]
            or scientific.get("state") != "complete"):
        raise ValueError("Select this project's complete original scientific source edition")
    source = scientific["source"]
    collection = workspace._get("sources", identifier(source["source_collection_id"]))
    entries = [row for row in collection["entries"] if row["id"] == source["source_id"]]
    if len(entries) != 1:
        raise ValueError("Choose one original retained scientific source")
    entry = entries[0]
    captured = study._captured(_SourceReader(workspace), entry)
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    if (basis["workspace_id"] != workspace.project["id"]
            or basis["ensemble_id"] != scientific["ensemble_id"]
            or operation != scientific["id"]
            or workspace._get("ensembles", plan["id"]) != plan):
        raise ValueError("The scientific source differs from the original geographic study")
    return collection, entry, captured


def _source_choices(workspace, prepared, scientific, delivery, context_source):
    result = []
    def add(source):
        pair = {key: source[key] for key in ("source_collection_id", "source_id")}
        if pair not in result:
            result.append(pair)
    # Keep exact original geography, coefficients, assumptions and physical inputs.
    for row in workspace._get("sources", prepared["source_collection_id"])["entries"]:
        add({"source_collection_id": prepared["source_collection_id"], "source_id": row["id"]})
    add(scientific["source"])
    for row in observed_source_choices(delivery["selection"]):
        add(row)
    add(context_source)
    return result


def prepare(workspace, prepared, scientific, delivery, *, reference_basis):
    """Create ordinary source/history/GIS records at the existing writer boundary."""
    original, inputs, geographic_binding, unused, cases = geography._original(workspace, prepared["id"])
    if original != prepared:
        raise ValueError("Use the actual retained geographic preparation")
    run_ids = geographic_binding["run_ids"]
    if (reference_basis.get("reference_ready") is not True
            or reference_basis.get("project_id") != workspace.project["id"]
            or reference_basis.get("ensemble_id") != prepared["ensemble_id"]
            or reference_basis.get("reference_run_ids") != run_ids
            or reference_basis.get("baseline_run_id") != run_ids[0]
            or reference_basis.get("alternative_run_ids") != run_ids[1:]
            or reference_basis.get("reference_profile_id") != prepared["profile_id"]
            or any(row["state"] != "complete" for row in cases)):
        raise ValueError("Retain exactly the completed original baseline/restoration/control reference")
    if (delivery.get("state") != "complete"
            or delivery["selection"]["baseline_run_id"] != run_ids[0]
            or delivery["selection"]["scenario_run_ids"] != run_ids[1:]):
        raise ValueError("Choose the mapped delivery of the same reference trio")
    delivery_path = workspace.root / "deliveries" / identifier(delivery["id"]) / "delivery-state.json"
    if read_json(delivery_path) != delivery:
        raise ValueError("Use the unchanged complete original mapped delivery")
    collection, entry, captured = _captured(workspace, scientific)
    basis, operation, recipe, members, selected, plan, runs, grid, collections, comparisons, content = captured
    if (plan["id"] != prepared["ensemble_id"] or grid["id"] != prepared["grid_id"]
            or workspace.get_grid(grid["id"]) != grid):
        raise ValueError("The scientific report and reference preparation select different inputs")
    # The course's joint three-run comparison is a separate retained product
    # from the scientific source's baseline/alternative pair comparisons.
    comparison_id = identifier(reference_basis["comparison_id"])
    comparison_path = workspace.root / "comparisons" / comparison_id / "comparison.json"
    comparison_descriptor = describe_file(workspace.root, comparison_path)
    comparison = read_json(verify_file(workspace.root, comparison_descriptor))
    if comparison_id in comparisons and comparisons[comparison_id] != comparison:
        raise ValueError("The retained joint comparison differs from its captured scientific source")
    if (comparison.get("baseline_run_id") != run_ids[0]
            or [row["run_id"] for row in comparison.get("alternatives", [])] != run_ids[1:]):
        raise ValueError("Preserve the original ordered baseline/restoration/control comparison")
    selected_runs = {}
    reader = _SourceReader(workspace)
    for key in run_ids:
        saved = runs[key]
        current = workspace.inspect_run(key)
        if (saved.get("state") != "complete" or current.get("state") != "complete"
                or current["selection"] != saved["selection"]
                or current.get("stages", {}).get("landcover") != saved.get("stages", {}).get("landcover")
                or current.get("artifacts", {}) != saved.get("artifacts", {})):
            raise ValueError("A selected native output differs from the captured reference: " + key)
        for field, family in (("profile_id", "profiles"), ("scenario_id", "scenarios")):
            selected_id = saved["selection"][field]
            descriptor = members["original/" + family + "/" + selected_id + ".json"]
            reader.add_file(descriptor["object"], descriptor)
            if reader.read(descriptor["object"]) != workspace._get(family, selected_id):
                raise ValueError("A selected reference input differs from its captured original")
        selected_runs[key] = deepcopy(saved)
    from .native_versions import validate_run_comparison
    validate_run_comparison(study._CapturedRuns(selected_runs), comparison,
                            expected_id=comparison_id)
    history_selection = {"run_ids": run_ids, "title": prepared["selection"]["title"] + " — reference execution history"}
    preview = history.preview(workspace, history_selection)
    execution = history.build(workspace, history_selection, preview["id"])
    execution_root = workspace.root / history.ROOT / execution["id"]
    frozen = read_json(verify_file(execution_root, execution["files"]["originals.json"]))
    if ([row["id"] for row in frozen["runs"]] != run_ids
            or any(row["state"] != "complete" for row in frozen["runs"])):
        raise ValueError("The saved history differs from the selected complete trio")
    identity = {"schema": SCHEMA, "version": VERSION, "project_id": workspace.project["id"],
                "geographic_binding": geographic_binding, "reference_basis": deepcopy(reference_basis),
                "scientific_source": {"source_collection_id": collection["id"], "source_id": entry["id"],
                    "sha256": entry["body"]["sha256"], "operation_id": operation,
                    "selection": deepcopy(basis)},
                "delivery": describe_file(workspace.root, delivery_path),
                "comparison": comparison_descriptor,
                "history_id": execution["id"]}
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    directory.mkdir(parents=True, exist_ok=True)
    completed = directory / "record.json"
    if completed.exists():
        retained = read_json(completed)
        if retained["identity"] != identity:
            raise ValueError("Preserve the existing original geographic GIS handover")
        verify(workspace, retained)
        return retained
    context = {"schema": SCHEMA, "id": key, "identity": identity,
               "prepared": deepcopy(prepared), "reference_runs": selected_runs,
               "comparison": deepcopy(comparison), "history": execution,
               "planned_study": {"ensemble_id": plan["id"],
                    "run_states": {run_id: row["state"] for run_id, row in runs.items()},
                    "selected_physical_run_ids": run_ids},
               "interpretation": "Actual retained geography with explicitly simulated physical inputs. Only the three completed reference runs are exported as physical results. Pending sensitivity members remain pending in the full retained scientific source. Native annual mass reaches modeled streams; it is not concentration or measured intake delivery."}
    atomic_json(directory / "reference-context.json", context, immutable=True)
    # Retain readable history as a separate ordinary source, including its full
    # relative companion tree; immutable CAS retains identical original bytes.
    history_directory = directory / "history"
    for name, descriptor in execution["files"].items():
        original_path = verify_file(execution_root, descriptor)
        target = history_directory / gis.member(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_bytes(target, original_path.read_bytes(), immutable=True)
    original_manifest = {"schema": "upstate.sources/v1",
        "title": prepared["selection"]["title"] + " — geographic reference GIS context",
        "captured_at": execution["captured_at"],
        "scope": {"geographic_id": prepared["id"], "reference_run_ids": run_ids,
                  "full_ensemble_id": plan["id"], "reference_only": True},
        "entries": [
            {"id": SOURCE_ID, "kind": "document", "title": "Original geographic reference and full planned study",
             "uri": "urn:upstate:geographic-reference-gis:" + key, "vintage": execution["captured_at"],
             "path": "reference-context.json", "sha256": gis.sha256(directory / "reference-context.json"),
             "metadata": {"geographic_id": prepared["id"], "reference_run_ids": run_ids,
                          "full_ensemble_id": plan["id"], "reference_only": True}},
            {"id": SOURCE_ID + "_HISTORY", "kind": "document", "title": "Original reference execution history",
             "uri": "urn:upstate:native-run-history:" + execution["id"], "vintage": execution["captured_at"],
             "path": "history/index.html", "sha256": execution["files"]["index.html"]["sha256"],
             "companions": [{"path": "history/" + name, "sha256": descriptor["sha256"]}
                            for name, descriptor in execution["files"].items() if name != "index.html"],
             "metadata": {"native_history_id": execution["id"], "reference_run_ids": run_ids}}]}
    atomic_json(directory / "sources.json", original_manifest, immutable=True)
    imported = workspace.import_sources(directory / "sources.json")
    context_source = {"source_collection_id": imported["id"], "source_id": SOURCE_ID}
    sources = _source_choices(workspace, prepared, scientific, delivery, context_source)
    sources.append({"source_collection_id": imported["id"], "source_id": SOURCE_ID + "_HISTORY"})
    selected = {"title": prepared["selection"]["title"] + " — editable reference GIS",
        "delivery_id": delivery["id"], "baseline_run_id": run_ids[0],
        "scenario_run_ids": run_ids[1:], "grid_id": grid["id"], "include_grid": True,
        "comparison_ids": [comparison_id], "sources": sources,
        "notes": [context["interpretation"], "Original model domain, reporting mask and utility/intake supports remain distinct."]}
    exported = gis_workspace.export(workspace, selected)
    # Every captured physical quantity must remain the exact original descriptor.
    project = gis.load(workspace.root / "gis-exports" / exported["id"] / "project" / "project.json")
    physical = {(row["run_id"], row["metric"]): row
                for row in project["layers"] if row.get("source", {}).get("kind") == "original completed model artifact"}
    expected = {(run_id, metric): artifact for run_id, run in selected_runs.items()
                for metric, artifact in run.get("artifacts", {}).items()
                if Path(artifact.get("path", "")).suffix.lower() in {".tif", ".tiff"}}
    if set(physical) != set(expected):
        raise ValueError("The GIS project lost a selected original native quantity")
    for pair, artifact in expected.items():
        layer = physical[pair]
        if (layer["source"]["artifact"] != artifact or layer["units"] != artifact["units"]
                or layer["originals"][0]["sha256"] != artifact["sha256"]
                or layer["originals"][0]["bytes"] != artifact["bytes"]):
            raise ValueError("The GIS handover changed a selected native quantity")
    result = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"], "identity": identity,
              "reference_run_ids": run_ids, "comparison_id": comparison_id,
              "context_source": context_source, "history_source": sources[-1],
              "history_id": execution["id"], "export": exported,
              "files": {"context": describe_file(workspace.root, directory / "reference-context.json"),
                        "source_manifest": describe_file(workspace.root, directory / "sources.json"),
                        "editable_gis": exported["archive"],
                        "offline_opening": describe_file(workspace.root, workspace.root / exported["open"]),
                        "qgis_project": describe_file(workspace.root, workspace.root / exported["project"])}}
    atomic_json(completed, result, immutable=True)
    return verify(workspace, result)["record"]


def verify(workspace, record, *, receive=False):
    """Verify frozen context; optionally receive ZIP through the original GIS API."""
    if (record.get("schema") != SCHEMA or record.get("project_id") != workspace.project["id"]
            or digest(record["identity"]) != record["id"]):
        raise ValueError("The geographic GIS handover belongs to another original project")
    if read_json(workspace.root / DIRECTORY / identifier(record["id"]) / "record.json") != record:
        raise ValueError("The retained geographic GIS record changed")
    for descriptor in record["files"].values():
        verify_file(workspace.root, descriptor)
    context = read_json(verify_file(workspace.root, record["files"]["context"]))
    if "comparison" in record["identity"]:
        if read_json(verify_file(workspace.root, record["identity"]["comparison"])) != context["comparison"]:
            raise ValueError("The original joint reference comparison differs from its GIS capture")
    if context["identity"] != record["identity"] or list(context["reference_runs"]) != record["reference_run_ids"]:
        # JSON object ordering is not scientific identity; require the exact set below.
        if context["identity"] != record["identity"] or set(context["reference_runs"]) != set(record["reference_run_ids"]):
            raise ValueError("The frozen reference context differs")
    execution = history.inspect(workspace, record["history_id"])
    if execution != context["history"] or execution["selection"]["run_ids"] != record["reference_run_ids"]:
        raise ValueError("The original execution-history snapshot differs")
    for source in (record["context_source"], record["history_source"]):
        workspace.source_file(source["source_collection_id"], source["source_id"])
    root = workspace.root / "gis-exports" / record["export"]["id"] / "project"
    result = gis.verify(root)
    if result["fingerprint"] != record["export"]["result"]["fingerprint"]:
        raise ValueError("The GIS project differs from the original export")
    received = None
    if receive:
        received = gis_workspace.receive(workspace, verify_file(workspace.root, record["export"]["archive"]))
        if received["result"]["fingerprint"] != result["fingerprint"]:
            raise ValueError("Independent GIS ZIP receiving changed the original edition")
    return {"state": "verified", "project_id": workspace.project["id"],
            "reference_run_ids": record["reference_run_ids"], "history_id": record["history_id"],
            "gis_fingerprint": result["fingerprint"], "received": received, "record": record}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--scientific", type=Path)
    parser.add_argument("--delivery", type=Path)
    parser.add_argument("--reference-basis", type=Path)
    parser.add_argument("--verify", type=Path)
    parser.add_argument("--receive", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.verify:
        result = verify(workspace, read_json(args.verify), receive=args.receive)
    else:
        if not all((args.prepared, args.scientific, args.delivery, args.reference_basis)):
            parser.error("Preparation requires original prepared, scientific, delivery and reference-basis JSON")
        result = prepare(workspace, read_json(args.prepared), read_json(args.scientific),
                         read_json(args.delivery), reference_basis=read_json(args.reference_basis))
    atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
