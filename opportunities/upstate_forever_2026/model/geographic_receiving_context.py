"""Connect completed geographic scenarios to original receiving-water reports.

All scientific quantities come from maintained Receiving analyses of original
native outputs. This module never dispatches a native model.
"""
from __future__ import annotations

import argparse
import hashlib
from copy import deepcopy
import json
from pathlib import Path
import sys

from .common import (atomic_json, digest, file_digest, held, identifier,
                     now, read_json, verify_file)
from . import observed_context, receiving_waters as waters
from . import receiving_water_report_source as reports

SCHEMA = "upstate.geographic-receiving-context/v1"
FOLDER = "geographic-receiving-contexts"
PUBLIC_SPEC = "source/water_context/20261012/public-water/receiving-waters.public-spec.json"
SCOPES = ("model_domain", "reporting")
INTERPRETATION = (
    "Annual modeled land export reaching streams within the selected original "
    "source support. Published protection areas and potential HUC12 upstream "
    "catchments are distinct relationships. Reservoir transport, delivery to an "
    "intake, concentration and treatment removal are not calculated."
)


def _retained_preparation(workspace, prepared):
    if not isinstance(prepared, dict):
        raise ValueError("Select the original saved geographic preparation")
    key = identifier(prepared.get("id"))
    path = workspace.root / "geographic-headwaters" / key / "prepared.json"
    original = read_json(path)
    if original != prepared or original.get("schema") != "upstate.geographic-headwaters-prepared/v1":
        raise ValueError("Use the exact original geographic prepared.json")
    if original["project_id"] != workspace.project["id"] or original["state"] != "prepared":
        raise ValueError("Geographic preparation belongs to another project or state")
    receipt = read_json(path.parent / "inputs" / "input-receipt.json")
    if receipt["identity"]["id"] != key:
        raise ValueError("Geographic input receipt differs")
    if receipt["geography"] != original["geography"]:
        raise ValueError("Geographic preparation and original input support differ")
    runtime_locks = []
    for member in receipt["files"]:
        if Path(member["path"]).name.endswith(".lock"):
            # The maintained portable inventory omits process synchronization
            # files; their absence after restore does not alter scientific input.
            runtime_locks.append(member["path"])
            continue
        verify_file(path.parent / "inputs", member)
    receipt_binding = {"sha256": file_digest(path.parent / "inputs" / "input-receipt.json"),
                       "runtime_lock_paths_omitted_by_portable": sorted(runtime_locks)}
    return original, path, receipt_binding


def _selector(value):
    """Use the original Receiving selector; never silently lose a named member."""
    selected = deepcopy(value)
    if selected.pop("part", None) is not None:
        raise ValueError("Select a Receiving-compatible retained vector entry for a named original member")
    return selected



def _original_entry(workspace, choice, expected):
    """Bind the actual retained original, decoding a gzip only when necessary."""
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    expected_identity = (expected["sha256"], expected["bytes"])
    raw = (entry["body"]["sha256"], entry["body"]["bytes"])
    if raw == expected_identity:
        return {"source": deepcopy(choice), "body": deepcopy(entry["body"]),
                "original_sha256": raw[0], "original_bytes": raw[1], "encoding": "original"}
    with Path(path).open("rb") as stream:
        compressed = stream.read(2) == b"\x1f\x8b"
    if not compressed:
        raise ValueError("Retained source differs from the original public specification: " + choice["source_id"])
    import gzip
    checksum, count = hashlib.sha256(), 0
    with gzip.open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
            count += len(chunk)
            if count > expected["bytes"]:
                raise ValueError("Decoded original source exceeds its declared original length")
    if (checksum.hexdigest(), count) != expected_identity:
        raise ValueError("Decoded retained source differs from the original public specification")
    return {"source": deepcopy(choice), "body": deepcopy(entry["body"]),
            "original_sha256": checksum.hexdigest(), "original_bytes": count, "encoding": "gzip"}


def _intake_reference(workspace, preferred, expected):
    """Find the exact already-retained original intake body, including other collections."""
    candidates = []
    preferred_id = preferred["source_collection_id"]
    collections = [preferred_id]
    collections.extend(path.stem for path in sorted((workspace.root / "sources").glob("*.json"))
                       if path.stem != preferred_id)
    for collection_id in collections:
        collection = workspace._get("sources", collection_id)
        for entry in collection["entries"]:
            body = entry["body"]
            raw_match = (body["sha256"], body["bytes"]) == (expected["sha256"], expected["bytes"])
            decoded_match = (entry.get("decoded_sha256"), entry.get("decoded_bytes")) == (
                expected["sha256"], expected["bytes"])
            if raw_match or decoded_match:
                candidates.append({"source_collection_id": collection_id, "source_id": entry["id"]})
    if not candidates:
        raise ValueError("Retain the original public intake body " + expected["sha256"] +
                         " through the existing source intake")
    selected = next((choice for choice in candidates if choice == {
        "source_collection_id": preferred_id, "source_id": preferred["source_id"]}), candidates[0])
    binding = _original_entry(workspace, selected, expected)
    return {**deepcopy(preferred), **selected}, binding


def _source_choices(workspace, prepared):
    selection = prepared["selection"]
    hucs = _selector(selection["huc_polygons"])
    fields = selection["huc_field"]
    topology = {
        row["huc12"]: row
        for row in prepared["geography"]["selected_topology_rows"]
    }
    expected = set(prepared["geography"]["model_domain_huc12s"])
    if set(topology) != expected:
        raise ValueError("Retained original topology and model-domain membership differ")
    anchors = list(selection["reporting_huc12s"])
    if set(anchors) != set(prepared["geography"]["reporting_huc12s"]):
        raise ValueError("Selected geographic anchors changed")
    catchments = {**hucs, "id_field": fields, "downstream_field": "tohuc"}
    receptors = []
    for code in anchors:
        row = topology[code]
        where = dict(hucs.get("where", {}))
        if fields in where and where[fields] != code:
            raise ValueError("Original source filter conflicts with selected HUC anchor")
        where[fields] = code
        receptors.append({
            "id": "huc-" + code,
            "title": row["name"] + " — HUC12 " + code,
            "family": "critical_drinking_water",
            "source": {**hucs, "where": where},
            "relation": {
                "method": "upstream_huc", "seed_huc_ids": [code],
                "evidence": "geographic-edition:" + prepared["id"] + "/reporting_huc12s/" + code,
                "rationale": (
                    "Explicit original HUC12 study anchor and its retained ToHUC ancestors. "
                    "The selected HUC is the geographic analysis anchor, not an inferred "
                    "intake point or a delineation at a drinking-water intake."
                ),
            },
            "classification": {"original_huc12": code, "original_topology_attributes": row},
            "metadata": {
                "geographic_edition_id": prepared["id"],
                "utility_context_title": selection["utility_label"],
                "interpretation": INTERPRETATION,
            },
        })
    upstream = {
        "title": selection["title"] + ": original HUC12 upstream areas",
        "analysis_crs": prepared["geography"]["grid"]["crs"],
        "catchments": catchments, "receptors": receptors,
        "metadata": {"geographic_edition_id": prepared["id"],
                     "expected_union_huc12s": sorted(expected),
                     "support": "Full original HUC polygons; quantity scope is selected separately"},
    }
    spec_path = Path(__file__).resolve().parents[1] / PUBLIC_SPEC
    public = read_json(spec_path)
    protection = deepcopy(public)
    protection["title"] = selection["title"] + ": original published protection areas"
    protection["analysis_crs"] = prepared["geography"]["grid"]["crs"]
    chosen = []
    for focus in selection["utility_focus"]:
        if focus.get("part") is not None:
            raise ValueError("Published protection selectors must retain their original vector entry")
        matches = []
        for row in public["receptors"]:
            source = row["source"]
            if source["source_id"] != focus["source_id"]:
                continue
            original_where = source.get("where", {})
            if all(key in original_where and type(original_where[key]) is type(value)
                   and original_where[key] == value
                   for key, value in focus.get("where", {}).items()):
                matches.append(row)
        if not matches:
            raise ValueError("Selected utility is absent from the retained original public protection specification")
        collection_id = identifier(focus["source_collection_id"])
        for row in matches:
            item = deepcopy(row)
            item["source"]["source_collection_id"] = collection_id
            if focus.get("layer") is not None:
                item["source"]["layer"] = focus["layer"]
            # Preserve the exact original nested intake reference as a real
            # retained source; never replace it with a clipped union or point.
            original_protection = item["metadata"]["protection_source"]
            binding = _original_entry(workspace, item["source"], original_protection)
            item["metadata"]["retained_protection_binding"] = binding
            reference = item.get("metadata", {}).get("intake_reference")
            if reference is not None:
                original_intakes = [source for source in public["metadata"]["public_source_identity"]
                                    if source["path"].endswith("/raw/public-intakes.esri.json")]
                if len(original_intakes) != 1:
                    raise ValueError("Original public intake specification is ambiguous")
                reference["source_collection_id"] = collection_id
                reference, intake_binding = _intake_reference(workspace, reference, original_intakes[0])
                item["metadata"]["intake_reference"] = reference
                item["metadata"]["retained_intake_binding"] = intake_binding
            if all(previous["id"] != item["id"] for previous in chosen):
                chosen.append(item)
    protection["receptors"] = chosen
    protection["metadata"].update(
        geographic_edition_id=prepared["id"],
        original_public_spec={"path": PUBLIC_SPEC, "sha256": file_digest(spec_path)},
        interpretation=INTERPRETATION,
    )
    return {"upstream_huc": upstream, "published_protection": protection}


def _runs(workspace, prepared):
    ids = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    if len(ids) != len(set(ids)) or len(ids) != 3:
        raise ValueError("Keep the original baseline, restoration and matched-control cohort")
    runs = [workspace.inspect_run(identifier(key)) for key in ids]
    scenarios = [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]
    for run, scenario in zip(runs, scenarios):
        if run["state"] != "complete":
            raise ValueError("Complete the original geographic native cohort before utility reporting")
        selected = run["selection"]
        if (selected["grid_id"] != prepared["grid_id"]
                or selected["profile_id"] != prepared["profile_id"]
                or selected["scenario_id"] != scenario):
            raise ValueError("Selected native run differs from the original geographic preparation")
    from .native_versions import comparison_versions, models_for_outputs
    from .model_selection import common_comparison_outputs
    outputs = common_comparison_outputs(runs)
    versions = comparison_versions(runs, models_for_outputs(outputs))
    return runs, outputs, versions


def _verify(workspace, record):
    if record.get("schema") != SCHEMA or record.get("state") != "complete":
        raise ValueError("Select a completed original geographic receiving context")
    if record["project_id"] != workspace.project["id"]:
        raise ValueError("Receiving context belongs to another project")
    for key in record["plan_ids"].values():
        waters.inspect_plan(workspace, key)
    for item in record["analyses"]:
        analysis = waters.inspect(workspace, item["analysis_id"], verify=True)
        if (analysis["state"] != "complete"
                or analysis["plan_id"] != record["plan_ids"][item["relationship"]]
                or analysis["quantity_scope"] != item["quantity_scope"]
                or analysis["baseline_run_id"] != record["baseline_run_id"]
                or analysis["alternative_run_ids"] != record["alternative_run_ids"]):
            raise ValueError("Retained original utility analysis differs")
        source = reports.inspect(workspace, item["report_source_id"], verify=True)
        if source["source"] != item["source"] or source["selection"]["analysis_id"] != analysis["id"]:
            raise ValueError("Retained utility scientific report differs")
    return record


def inspect(workspace, key):
    record = read_json(workspace.root / FOLDER / identifier(key) / "context.json")
    if digest(record["identity"]) != record["id"]:
        raise ValueError("Retained geographic receiving identity differs")
    return _verify(workspace, record)


def prepare(workspace, prepared, *, scopes=SCOPES, progress=None):
    """Reuse original runs in source-bound, separately scoped utility analyses."""
    prepared, prepared_path, receipt_binding = _retained_preparation(workspace, prepared)
    scopes = tuple(scopes)
    if not scopes or len(scopes) != len(set(scopes)) or set(scopes) - set(SCOPES):
        raise ValueError("Select distinct model_domain/reporting quantity scopes")
    scopes = tuple(value for value in SCOPES if value in scopes)
    runs, outputs, versions = _runs(workspace, prepared)
    specs = _source_choices(workspace, prepared)
    identity = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "prepared_id": prepared["id"], "prepared_sha256": file_digest(prepared_path),
        "original_input_receipt": receipt_binding,
        "implementation_sha256": file_digest(__file__),
        "receiving_implementation_sha256": file_digest(waters.__file__),
        "report_implementation_sha256": file_digest(reports.__file__),
        "plan_selections": specs, "quantity_scopes": list(scopes),
        "runs": [{"id": run["id"], "selection": run["selection"], "artifacts": run["artifacts"]}
                 for run in runs],
        "common_outputs": list(outputs), "native_version_provenance": versions,
    }
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    with held(directory / ".context.lock", blocking=False):
        final = directory / "context.json"
        if final.exists():
            return inspect(workspace, key)
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "selection.json", identity, immutable=True)
        record = {
            "schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
            "identity": identity, "created_at": now(), "state": "building",
            "prepared_id": prepared["id"], "baseline_run_id": runs[0]["id"],
            "alternative_run_ids": [run["id"] for run in runs[1:]],
            "plan_ids": {}, "analyses": [], "interpretation": INTERPRETATION,
        }
        def publish(stage, **extra):
            atomic_json(directory / "progress.json", {**record, "stage": stage, **extra})
            if progress:
                progress({"stage": stage, "context_id": key, **extra})
        for relationship, spec in specs.items():
            publish("original_plan", relationship=relationship)
            plan = waters.prepare(workspace, spec)
            record["plan_ids"][relationship] = plan["id"]
            if relationship == "upstream_huc":
                actual = {code for row in plan["receptors"]
                          for code in row["relation"]["upstream_huc_ids"]}
                expected = set(prepared["geography"]["model_domain_huc12s"])
                if actual != expected:
                    raise ValueError("Receiving HUC closure differs from the original native geographic domain")
            for scope in scopes:
                publish("physical_comparison", relationship=relationship, quantity_scope=scope)
                selected = {
                    "title": spec["title"] + " — " + scope.replace("_", " "),
                    "plan_id": plan["id"], "baseline_run_id": runs[0]["id"],
                    "alternative_run_ids": [run["id"] for run in runs[1:]],
                    "quantity_scope": scope, "pollutants": list(outputs),
                }
                analysis = waters.analyze(workspace, selected, progress=progress)
                if analysis["state"] != "complete":
                    raise ValueError("Continue the original receiving analysis until complete")
                publish("scientific_report_source", relationship=relationship, quantity_scope=scope)
                report = reports.prepare(workspace, {
                    "analysis_id": analysis["id"], "title": selected["title"],
                }, progress=progress)
                record["analyses"].append({
                    "relationship": relationship, "quantity_scope": scope,
                    "analysis_id": analysis["id"], "report_source_id": report["id"],
                    "source": report["source"],
                    "units": {name: waters.TOTAL_UNITS[name] for name in outputs},
                    "subjects": [
                        {"id": row["id"], "kind": row["kind"], "title": row["title"],
                         "relationship_precision": row["relationship_precision"],
                         "contribution_area_ha": row["contribution_area_ha"],
                         "area_in_quantity_scope_ha": row["area_in_quantity_scope_ha"],
                         "selected_cells": row["metrics"]["selected_cells"],
                         "selected_pixel_area_ha": row["metrics"]["selected_pixel_area_ha"]}
                        for row in analysis["subjects"]],
                })
                publish("report_source_complete")
        record.update(state="complete", completed_at=now())
        _verify(workspace, record)
        atomic_json(final, record, immutable=True)
        return record


def append_sources(selection, context):
    """Append original report sources while preserving existing ordered choices."""
    if context.get("schema") != SCHEMA or context.get("state") != "complete":
        raise ValueError("Append a completed geographic receiving context")
    selected = deepcopy(selection)
    choices = observed_context.source_choices(selected)
    for item in context["analyses"]:
        source = item["source"]
        if source not in choices:
            choices.append(deepcopy(source))
    selected["observed_context_sources"] = choices
    if choices:
        selected.setdefault("source_roles", {})[observed_context.ROLE] = deepcopy(choices[0])
    selected.pop("observed_context_binding", None)
    return selected


def source_collection_ids(context):
    return list(dict.fromkeys(item["source"]["source_collection_id"] for item in context["analyses"]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--scope", choices=SCOPES, action="append")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.output and args.output.resolve().is_relative_to(workspace.root.resolve()):
        raise ValueError("Place the optional returned result outside the original Workspace")
    result = prepare(workspace, read_json(args.prepared), scopes=args.scope or SCOPES,
                     progress=lambda value: print(json.dumps(value), file=sys.stderr, flush=True))
    if args.output:
        atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
