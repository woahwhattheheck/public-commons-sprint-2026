"""Original native evidence beside explicit Sampling targets.

TokenJunkieLabs. Frozen scientific sources support analyst-authored sampling
questions. This adapter computes no model, information gain or target priority.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier, read_json, verify_file
from .monitoring_common import ContractError, canonical_bytes

SCHEMA = "upstate.monitoring-native-evidence/v1"
FAMILIES = {
    "multivariate_control_outcomes_id": ("control_outcomes", "urn:upstate:multivariate-control-outcomes:"),
    "terrain_conditioning_report_source_id": ("terrain_response", "urn:upstate:terrain-conditioning-report-source:"),
}
LIMITATIONS = [
    "This is retained native-model evidence supporting an analyst-authored sampling question; no information gain, target priority or statistical power is calculated.",
    "The source's modeled support is not established as this station's contributing catchment. Original station, network and catchment assignments are retained without inferring equivalence from names or identifiers.",
    "Annual modeled source-pixel exports to streams are not station concentrations or intake loads. No flow conversion, calibration or annual-to-seasonal allocation is performed.",
    "The exact observed characteristic, fraction, speciation, method and unit remain distinct. A modeled nitrogen, phosphorus or sediment quantity does not establish equivalence to nitrate, dissolved fractions, orthophosphate or suspended-solids measurements.",
    "Several deterministic control placements or terrain variants are sensitivity evidence, not independent observed replicates, probabilities or confidence intervals.",
]


def normalize(value):
    if not isinstance(value, dict) or set(value) != {
            "source_collection_id", "source_id", "pollutant", "applicability"}:
        raise ContractError("Choose one exact native report source, quantity and authored applicability")
    result = {"source_collection_id": identifier(value["source_collection_id"])}
    for key in ("source_id", "pollutant", "applicability"):
        text = value.get(key)
        if not isinstance(text, str) or not text.strip() or len(text) > (20000 if key == "applicability" else 300):
            raise ContractError("Retain the exact native evidence " + key)
        result[key] = text if key == "source_id" else text.strip()
    if _name(result["source_id"]) != result["source_id"] or "/" in result["source_id"]:
        raise ContractError("Retain a portable original source entry ID")
    return result


def _name(value):
    if not isinstance(value, str):
        raise ContractError("A native evidence member needs its original relative name")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or str(path) != value
            or ".." in path.parts or "\\" in value or "\0" in value):
        raise ContractError("A native evidence source member is not portable")
    return value


def _document(workspace, collection_id, source_id):
    collection = workspace._get("sources", identifier(collection_id))
    entries = [e for e in collection["entries"] if e["id"] == source_id]
    if len(entries) != 1:
        raise ContractError("Choose an exact retained native evidence entry")
    entry = entries[0]
    if entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT":
        raise ContractError("Native evidence must be an original scientific report document")
    metadata = entry.get("metadata", {})
    if not isinstance(metadata, dict):
        raise ContractError("The selected native evidence needs original typed source metadata")
    families = [(key, spec) for key, spec in FAMILIES.items() if key in metadata]
    if len(families) != 1 or metadata.get("report_schema") != "upstate.observed-report/v1":
        raise ContractError("Choose a supported completed native outcome or terrain report")
    key, (family, prefix) = families[0]
    native_id = identifier(metadata[key])
    if entry.get("uri") != prefix + native_id:
        raise ContractError("The native report URI differs from its retained identity")
    bodies, paths = {}, {}
    companions = entry.get("companions", [])
    if not isinstance(entry.get("body"), dict) or not isinstance(companions, list) or any(not isinstance(v, dict) for v in companions):
        raise ContractError("The native evidence source needs complete body and companion descriptors")
    for body in [entry["body"], *companions]:
        name = _name(body.get("view_path", body["filename"]))
        if name in bodies:
            raise ContractError("The native scientific source repeats an original member")
        bodies[name] = deepcopy(body)
        paths[name] = verify_file(workspace.root, {**body, "path": body["object"]})
    recipe = read_json(paths[_name(entry["body"].get("view_path", entry["body"]["filename"]))])
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ContractError("The original report recipe has an unsupported schema")
    expected = {}
    for member in recipe.get("inputs", []):
        name = _name(member["path"])
        if name in expected:
            raise ContractError("The native recipe repeats an original companion")
        expected[name] = (member["bytes"], member["sha256"])
    actual = {_name(body.get("view_path", body["filename"])): (body["bytes"], body["sha256"])
              for body in entry.get("companions", [])}
    if expected != actual:
        raise ContractError("The complete native evidence companion inventory differs from its recipe")
    if recipe.get("project_id") != metadata.get("project_id"):
        raise ContractError("The native evidence project differs from its original source")
    source = {"collection_id": collection_id, "source_id": source_id,
              "collection_sha256": digest(collection), "entry_sha256": digest(entry),
              "body": deepcopy(entry["body"]), "members": deepcopy(entry.get("companions", [])),
              "title": entry.get("title", source_id), "uri": entry["uri"],
              "classification": deepcopy(metadata.get("classification"))}
    return collection, entry, paths, source, family, native_id, recipe


def _json(paths, name):
    if name not in paths:
        raise ContractError("Retain the native evidence companion " + name)
    return read_json(paths[name])


def _native(workspace, entry, paths, family, native_id, recipe):
    metadata = entry["metadata"]
    project_id = metadata["project_id"]
    local = project_id == workspace.project["id"]
    if family == "control_outcomes":
        value = _json(paths, "assessment.json")
        if (value.get("schema") != "upstate.multivariate-control-outcomes/v1"
                or value.get("id") != native_id or value.get("state") != "complete"
                or digest(value["identity"]) != native_id
                or value["identity"]["project_id"] != project_id
                or value["selection"] != value["identity"]["selection"]
                or value["binding"] != value["identity"]["binding"]
                or _json(paths, "selection.json") != value["selection"]
                or _json(paths, "input-binding.json") != value["binding"]):
            raise ContractError("The completed outcome evidence changed its original identity")
        if local:
            from . import multivariate_control_outcomes as original
            retained = original.inspect(workspace, native_id)
            if any(retained.get(k) != v for k, v in value.items()):
                raise ContractError("The selected report differs from its original native outcome")
        pollutants = value["selection"]["pollutants"]
        units = {}
        for region in value["regions"]:
            for pollutant, row in region["siting_contrasts"].items():
                if pollutant in units and units[pollutant] != row["units"]:
                    raise ContractError("One original native quantity has inconsistent annual units")
                units[pollutant] = row["units"]
        if set(units) != set(pollutants):
            raise ContractError("The native outcome evidence lost a selected quantity")
        classifications = []
        for member in value["binding"]["members"]:
            design = _json(paths, "originals/" + member["design_id"] + "/design.json")
            if (design.get("id") != member["design_id"]
                    or digest(design["identity"]) != member["design_id"]
                    or design["binding"] != design["identity"]["binding"]
                    or design["selection"] != member["selection"]):
                raise ContractError("The original design-source classification lost its retained identity")
            classifications.append({"design_id": member["design_id"],
                "selection": deepcopy(member["selection"]),
                "grid_sources": deepcopy(design["binding"]["grid_sources"]),
                "external_covariates": deepcopy(design["binding"]["external_covariates"]),
                "grid_inputs": deepcopy(design["binding"]["grid_inputs"]),
                "exclusion_source": deepcopy(design["binding"]["exclusion_source"])})
        result = {"family": family, "id": native_id, "project_id": project_id,
            "quantity_scope": value["selection"]["quantity_scope"],
            "quantities": [{"pollutant": p, "units": units[p]} for p in pollutants],
            "run_ids": list(value["binding"]["runs"]),
            "grid_id": value["binding"]["grid_id"], "profile_id": value["binding"]["profile_id"],
            "geometry": deepcopy(value["binding"]["grid_files"]),
            "rows": deepcopy(value["regions"]), "support": deepcopy(value["summary"]["group_common_support"]),
            "placements": deepcopy(value["placements"]),
            "placement_overlaps": deepcopy(value["placement_overlaps"]),
            "native_execution": deepcopy(value["binding"]["native_execution"]),
            "classification": deepcopy(metadata.get("classification")),
            "original_input_classifications": classifications,
            "source_project_relation": "same_project" if local else "retained_foreign_source"}
    else:
        selection = _json(paths, "selection.json")
        raw = {k: v for k, v in selection.items() if k != "id"}
        binding = _json(paths, "input-binding.json")
        value = _json(paths, "original-native-response.json")
        if (selection.get("schema") != "upstate.terrain-conditioning-report-sources/v1"
                or selection.get("id") != native_id or digest(raw) != native_id
                or selection.get("project_id") != project_id or selection.get("binding") != binding
                or value.get("schema") != "upstate.terrain-native-response/v1"
                or value.get("state") != "complete"
                or selection["response_id"] != value["id"]
                or selection["case_id"] != value["selection"]["case_id"]
                or metadata.get("terrain_conditioning_response_id") != value["id"]
                or metadata.get("terrain_conditioning_case_id") != selection["case_id"]
                or binding["response_id"] != value["id"] or binding["project_id"] != project_id):
            raise ContractError("The terrain evidence differs from its original completed response")
        if local:
            from . import terrain_conditioning_report_source as original
            retained = original.inspect(workspace, native_id)
            if retained.get("state") != "complete" or retained["selection"] != selection or retained["binding"] != binding:
                raise ContractError("The selected source differs from its original native terrain report")
        units = {}
        for row in value["rows"]:
            p = row["metric"]
            if p in units and units[p] != row["units"]:
                raise ContractError("One terrain quantity has inconsistent annual units")
            units[p] = row["units"]
        if set(units) != set(binding["quantity_support"]):
            raise ContractError("The original terrain report lost its complete quantity support")
        result = {"family": family, "id": native_id, "response_id": value["id"],
            "case_id": selection["case_id"], "project_id": project_id,
            "quantity_scope": "original_terrain_joint_native_support",
            "quantities": [{"pollutant": p, "units": units[p]} for p in units],
            "run_ids": [binding["baseline_run_id"], *[r["run_id"] for r in binding["alternatives"]]],
            "geometry": deepcopy(binding["case"]),
            "rows": deepcopy(value["rows"]), "support": deepcopy(binding["quantity_support"]),
            "native_execution": deepcopy(binding["native_versions"]),
            "classification": deepcopy(binding.get("source_classification")),
            "original_input_classifications": deepcopy(binding["original_source_records"]),
            "source_project_relation": "same_project" if local else "retained_foreign_source"}
    result["report_title"] = recipe.get("title", entry.get("title"))
    return result


def describe(workspace, collection_id, source_id):
    collection, entry, paths, source, family, native_id, recipe = _document(
        workspace, collection_id, source_id)
    native = _native(workspace, entry, paths, family, native_id, recipe)
    return {"source": source, "native": native}


def catalog(workspace):
    choices, issues = [], []
    for path in sorted((workspace.root / "sources").glob("*.json")):
        try:
            collection = workspace._get("sources", path.stem)
        except (ValueError, KeyError, OSError, TypeError) as error:
            issues.append({"source_collection_id": path.stem, "message": str(error)})
            continue
        for entry in collection.get("entries", []):
            metadata = entry.get("metadata", {})
            if (entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT"
                    or not isinstance(metadata, dict) or not any(k in metadata for k in FAMILIES)):
                continue
            try:
                value = describe(workspace, collection["id"], entry["id"])
                native = value["native"]
                choices.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                    "title": entry.get("title", entry["id"]), "family": native["family"],
                    "project_id": native["project_id"], "native_id": native["id"],
                    "quantities": native["quantities"], "support_scope": native["quantity_scope"],
                    "classification": native["classification"],
                    "source_project_relation": native["source_project_relation"]})
            except (ValueError, KeyError, OSError, ImportError, TypeError) as error:
                issues.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                               "message": str(error)})
    return {"schema": SCHEMA, "choices": choices, "issues": issues, "limitations": LIMITATIONS}


def resolve(workspace, record, selection):
    from .monitoring_recommendations import _context_view
    view = _context_view(record)
    stations = {row["source_station_id"]: row for row in view["stations"]}
    cohorts = {row["id"]: row for row in view["cohorts"]}
    results, cache = {}, {}
    for target in selection["targets"]:
        if "model_evidence" not in target:
            continue
        chosen = normalize(target["model_evidence"])
        key = chosen["source_collection_id"], chosen["source_id"]
        if key not in cache:
            cache[key] = describe(workspace, *key)
        value = deepcopy(cache[key])
        native = value["native"]
        quantities = {q["pollutant"]: q for q in native["quantities"]}
        if chosen["pollutant"] not in quantities:
            raise ContractError("Choose a quantity actually present in the exact selected native source")
        pollutant = chosen["pollutant"]
        native["selected_quantity"] = deepcopy(quantities[pollutant])
        native["support"] = deepcopy(native["support"][pollutant])
        if native["family"] == "control_outcomes":
            native["rows"] = [{**r, "siting_contrasts": {pollutant: r["siting_contrasts"][pollutant]},
                              "native_support": {pollutant: r["native_support"][pollutant]}}
                             for r in native["rows"]]
        else:
            native["rows"] = [r for r in native["rows"] if r["metric"] == pollutant]
        value.update(schema=SCHEMA, selection=chosen, applicability=chosen["applicability"],
            target_binding={"context_id": record["id"], "context_digest": digest(record),
                "network_id": record["network_id"], "network_digest": record["network_digest"],
                "station": deepcopy(stations[target["station_id"]]),
                "cohort": deepcopy(cohorts[target["cohort_id"]]),
                "evidence_start": selection["evidence_start"], "evidence_end": selection["evidence_end"],
                "months": deepcopy(target["months"])},
            relation={"spatial": "not_established", "constituent": "analyst_context_only",
                "temporal": "annual_model_vs_selected_observation_window", "quantitative_comparison": False},
            limitations=deepcopy(LIMITATIONS))
        results[target["id"]] = value
    return results


def export_members(workspace, records):
    from .monitoring_packet import bytes_member, file_member
    seen = set()
    for record in records:
        for target in record["targets"]:
            value = target.get("model_evidence")
            if value is None:
                continue
            source = value["source"]
            key = source["collection_id"], source["source_id"]
            if key in seen:
                continue
            seen.add(key)
            collection, entry, paths, current, _, _, _ = _document(workspace, *key)
            if current != source:
                raise ContractError("The exact saved target evidence changed before export")
            prefix = "native-evidence/" + key[0] + "/" + key[1] + "/"
            yield prefix + "source-edition.json", bytes_member(canonical_bytes(collection))
            yield prefix + "source-entry.json", bytes_member(canonical_bytes(entry))
            for body in [entry["body"], *entry.get("companions", [])]:
                name = _name(body.get("view_path", body["filename"]))
                yield prefix + name, file_member(paths[name], body["bytes"], body["sha256"])


def include(closure, proposal):
    """Original Study resolver owns source objects and all local native histories."""
    for target in proposal.get("targets", []):
        value = target.get("model_evidence")
        if value is None:
            continue
        source = value["source"]
        collection_id, source_id = source["collection_id"], source["source_id"]
        closure.need("sources", collection_id, "Original sampling target native evidence")
        if value["native"]["project_id"] == closure.workspace.project["id"]:
            kind = ("multivariate-control-outcomes" if value["native"]["family"] == "control_outcomes"
                    else "terrain-conditioning-report-sources")
            closure.need(kind, value["native"]["id"],
                         "Complete original native evidence for an explicit sampling target")
