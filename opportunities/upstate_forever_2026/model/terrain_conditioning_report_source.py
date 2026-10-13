"""Retained terrain native responses as ordinary scientific report sources.

TokenJunkieLabs. Reads completed native records; no terrain or model execution.
"""
from __future__ import annotations
from copy import deepcopy
from pathlib import Path
import shutil
from model.common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                          held, identifier, read_json, verify_file)
from source_tools import terrain_conditioning as terrain
from source_tools import terrain_conditioning_response as response

KIND = "terrain-conditioning-report-sources"
FOLDER = "terrain-conditioning-report-source-output"
SCHEMA = "upstate.terrain-conditioning-report-source/v1"
VERSION = "terrain-native-scientific-source-20261013-v1"

def normalize(selection):
    if not isinstance(selection, dict) or set(selection) != {"response_id", "title", "reason"}:
        raise ValueError("Choose a completed original terrain response, report title and interpretation purpose")
    result = {"response_id": identifier(selection["response_id"])}
    for name in ("title", "reason"):
        value = selection[name]
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Retain the report " + name)
        result[name] = value.strip()
    return result

def _source_entry(ws, collection_id, source_id):
    collection = ws._get("sources", identifier(collection_id))
    entry = next((e for e in collection["entries"] if e["id"] == source_id), None)
    if entry is None:
        raise ValueError("Retain the original terrain input source")
    for body in [entry["body"], *entry.get("companions", [])]:
        verify_file(ws.root, {**body, "path": body["object"]})
    return {"collection_id": collection_id, "entry": deepcopy(entry)}

def _bind(ws, selection):
    selected = normalize(selection)
    original = response.inspect(ws, selected["response_id"])
    if original.get("state") != "complete" or original.get("schema") != "upstate.terrain-native-response/v1":
        raise ValueError("Complete the original native terrain response before issuing a scientific source")
    case_id = identifier(original["selection"]["case_id"])
    case = terrain.inspect(ws, case_id, verify=True)
    if case.get("state") != "complete":
        raise ValueError("Retain the completed original terrain case")
    baseline = ws.inspect_run(original["selection"]["baseline_run_id"])
    alternatives = [ws.inspect_run(row["run_id"]) for row in original["selection"]["alternatives"]]
    runs = [baseline, *alternatives]
    for run in runs:
        if run.get("state") != "complete" or digest(run["selection"]) != run["id"]:
            raise ValueError("Retain every exact completed native run")
    snapshots = [describe_file(ws.root, ws.root / response.KIND / (selected["response_id"] + ".json")),
                 describe_file(ws.root, ws.root / response.FOLDER / selected["response_id"] / "result.json"),
                 describe_file(ws.root, ws.root / terrain.KIND / (case_id + ".json")),
                 describe_file(ws.root, ws.root / terrain.RUNS / case_id / "result.json")]
    # The response already retains immutable copies of its original run.json
    # records and native outputs. Their exact descriptors below bind this
    # historical analysis without freezing unrelated later live-run stages.
    source_records = [_source_entry(ws, case["case"]["dem"]["collection_id"], case["case"]["dem"]["source_id"])]
    hydro = case["case"].get("hydrography")
    if hydro:
        source_records.append(_source_entry(ws, hydro["collection_id"], hydro["source_id"]))
    quantities = {}
    for row in original["rows"]:
        if row["metric"] not in quantities:
            quantities[row["metric"]] = {"units": row["units"], "joint_valid_cells": row["joint_valid_cells"],
                "joint_area_ha": row["joint_area_ha"], "baseline_joint_total": row["baseline_joint_total"]}
        elif quantities[row["metric"]] != {"units": row["units"], "joint_valid_cells": row["joint_valid_cells"],
                "joint_area_ha": row["joint_area_ha"], "baseline_joint_total": row["baseline_joint_total"]}:
            raise ValueError("Retained terrain alternatives do not share the same native quantity support")
    binding = {"project_id": ws.project["id"], "case_id": case_id, "response_id": original["id"],
        "baseline_run_id": baseline["id"], "alternatives": deepcopy(original["selection"]["alternatives"]),
        "native_versions": deepcopy(original["selection"]["native_versions"]),
        "case": deepcopy(case["case"]), "source_classification": original.get("source_classification"),
        "original_source_records": source_records, "original_records": snapshots,
        "original_response_files": deepcopy(original["files"]), "quantity_support": quantities,
        "direction": "alternative minus baseline", "sum_basis": "original normalized pixel mass summed once"}
    return selected, binding, original, case

def _producer():
    from model import terrain_conditioning_scientific_report as report
    from model import scientific_report, scientific_figures, native_versions
    paths = [Path(__file__), Path(report.__file__), Path(scientific_report.__file__),
             Path(scientific_figures.__file__), Path(native_versions.__file__)]
    return {p.name: {"bytes": p.stat().st_size, "sha256": file_digest(p)} for p in paths}, paths

def _body(ws, selected, binding):
    producer, paths = _producer()
    return {"schema": "upstate." + KIND + "/v1", "project_id": ws.project["id"], **selected, "case_id": binding["case_id"],
            "binding": binding, "producer": producer}, paths

def _verify_binding(ws, binding):
    if binding["project_id"] != ws.project["id"]:
        raise ValueError("Open the terrain report's original project")
    for item in binding["original_records"] + binding["original_response_files"]:
        verify_file(ws.root, item)
    case = terrain.inspect(ws, binding["case_id"], verify=True)
    original = response.inspect(ws, binding["response_id"])
    if case["case"] != binding["case"] or original.get("state") != "complete":
        raise ValueError("Original terrain source or completed response changed")
    for source in binding["original_source_records"]:
        actual = _source_entry(ws, source["collection_id"], source["entry"]["id"])
        # Source-view paths are historical import provenance. Source objects and
        # scientific metadata are verified through the original collection.
        if actual != source:
            raise ValueError("Original terrain input source record changed")

def preview(ws, selection):
    selected, binding, original, case = _bind(ws, selection)
    body, _ = _body(ws, selected, binding)
    key = digest(body)
    result = {"id": key, "state": "ready", "selection": selected, "binding": binding,
              "summary": {"response_id": original["id"], "case_id": case["id"],
                "native_alternatives": len(binding["alternatives"]),
                "quantities": list(binding["quantity_support"]),
                "source_classification": binding["source_classification"]}}
    if (ws.root / FOLDER / key / "result.json").exists():
        result["state"] = "existing"
        result["existing"] = inspect(ws, key)
    return result

def _source_matches(ws, result, root):
    collection = ws._get("sources", result["source"]["source_collection_id"])
    entry = next((e for e in collection["entries"] if e["id"] == result["source"]["source_id"]), None)
    if entry is None:
        raise ValueError("The original terrain scientific source is missing")
    declared = read_json(root / "sources.json")["entries"][0]
    expected = {v["path"]: (v["bytes"], v["sha256"]) for v in [declared, *declared["companions"]]}
    actual = {v.get("view_path", v["filename"]): (v["bytes"], v["sha256"])
              for v in [entry["body"], *entry.get("companions", [])]}
    if actual != expected:
        raise ValueError("Retain every original terrain report, figure and map companion")
    for v in [entry["body"], *entry.get("companions", [])]:
        verify_file(ws.root, {**v, "path": v["object"]})
    return entry

def inspect(ws, key):
    selection = ws._get(KIND, identifier(key))
    root = ws.root / FOLDER / key
    path = root / "result.json"
    if not path.exists():
        return {"schema": SCHEMA, "id": key, "state": "prepared", "selection": selection,
                "binding": selection["binding"], "files": []}
    result = read_json(path)
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or result.get("selection") != selection or result.get("binding") != selection["binding"]):
        raise ValueError("The retained terrain report identity changed")
    _verify_binding(ws, result["binding"])
    for member in result["files"]:
        verify_file(ws.root, member)
    _source_matches(ws, result, root)
    return result

def catalog(ws):
    items, issues = [], []
    for row in ws._list(KIND):
        try:
            value = inspect(ws, row["id"])
            items.append({"id": row["id"], "title": row["title"], "response_id": row["response_id"],
                          "case_id": row["case_id"], "state": value["state"], "source": value.get("source")})
        except (ValueError, KeyError, OSError) as error:
            issues.append({"id": row["id"], "message": str(error)})
    return {"project_id": ws.project["id"], "report_sources": items, "issues": issues}

def prepare(ws, selection, progress=None):
    from model import terrain_conditioning_scientific_report as report
    selected, binding, original, case = _bind(ws, selection)
    body, modules = _body(ws, selected, binding)
    key = digest(body)
    root = ws.root / FOLDER / key
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".report.lock", blocking=False):
        record = ws._save(KIND, body)
        if record["id"] != key:
            raise ValueError("The original terrain report identity differs")
        if (root / "result.json").exists():
            return inspect(ws, key)
        def emit(stage):
            if progress:
                progress({"report_source_id": key, "response_id": original["id"], "stage": stage})
        emit("retaining_original_response")
        atomic_json(root / "selection.json", record, immutable=True)
        atomic_json(root / "input-binding.json", binding, immutable=True)
        atomic_json(root / "original-native-response.json", original, immutable=True)
        atomic_json(root / "original-terrain-case.json", case, immutable=True)
        for module in modules:
            payload = module.read_bytes()
            declared = body["producer"][module.name]
            import hashlib
            if len(payload) != declared["bytes"] or hashlib.sha256(payload).hexdigest() != declared["sha256"]:
                raise ValueError("The original terrain report implementation changed")
            atomic_bytes(root / "implementation" / module.name, payload, immutable=True)
        original_root = ws.root / response.FOLDER / original["id"]
        copied = []
        for item in original["files"]:
            path = verify_file(ws.root, item)
            relative = path.relative_to(original_root)
            # Full native originals are retained through the original response
            # Study closure. The report keeps every original table/map/legend.
            if relative.name == "index.html":
                continue
            if relative.parts[0] == "original-runs" and relative.name != "run.json":
                continue
            destination = root / "response" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if file_digest(destination) != item["sha256"]:
                    raise ValueError("A retained terrain report companion changed")
            else:
                shutil.copyfile(path, destination)
            copied.append(describe_file(root, destination))
        recipe_path = root / "report-source.json"
        if recipe_path.exists():
            recipe = read_json(recipe_path)
            for member in recipe["inputs"]:
                verify_file(root, member)
        else:
            emit("rendering_original_scientific_report")
            sections, figure_contract = report.write(root, record, original, case, copied)
            members = [describe_file(root, p) for p in sorted(root.rglob("*"))
                       if p.is_file() and p.name not in {".report.lock", "result.json", "sources.json", "report-source.json"}]
            recipe = {"schema": "upstate.observed-report/v1", "edition": VERSION, "title": selected["title"],
                      "project_id": ws.project["id"], "inputs": members, "sections": sections,
                      "source_links": ["report.html", "report.pdf", "report.md", "report-data.json",
                                       "original-native-response.json", "original-terrain-case.json",
                                       "response/native-response.csv", "input-binding.json"], **figure_contract}
            atomic_json(recipe_path, recipe, immutable=True)
        source_id = "terrain-conditioning-report-source-" + key
        entry = {"id": source_id, "kind": "document", "role": "OBSERVED_CONTEXT", "title": selected["title"],
            "uri": "urn:upstate:terrain-conditioning-report-source:" + key, "vintage": VERSION,
            **describe_file(root, recipe_path), "companions": recipe["inputs"],
            "metadata": {"report_schema": "upstate.observed-report/v1", "project_id": ws.project["id"],
                "terrain_conditioning_report_source_id": key,
                "terrain_conditioning_response_id": original["id"], "terrain_conditioning_case_id": case["id"],
                "classification": "retained completed native terrain-input sensitivity",
                "original_source_classification": binding["source_classification"], "native_calculation": False}}
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1", "title": selected["title"],
                                          "entries": [entry]}, immutable=True)
        _verify_binding(ws, binding)
        collection = ws.import_sources(root / "sources.json")
        members = [describe_file(ws.root, root / x["path"]) for x in recipe["inputs"]]
        members += [describe_file(ws.root, root / n) for n in ("report-source.json", "sources.json")]
        result = {"schema": SCHEMA, "id": key, "state": "complete", "selection": record, "binding": binding,
                  "directory": root.relative_to(ws.root).as_posix(),
                  "source": {"source_collection_id": collection["id"], "source_id": source_id},
                  "summary": {"native_alternatives": len(binding["alternatives"]),
                              "quantities": list(binding["quantity_support"]),
                              "source_classification": binding["source_classification"]},
                  "files": members}
        atomic_json(root / "result.json", result, immutable=True)
        emit("complete")
        return inspect(ws, key)

def files(ws, key):
    return inspect(ws, key)["files"]
