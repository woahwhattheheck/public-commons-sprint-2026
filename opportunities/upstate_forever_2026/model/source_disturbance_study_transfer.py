"""Carry a source-selected disturbance study through original editable Study transfer.

The resolver follows retained records and source CAS. It does not rasterize,
prepare a native run, reconstruct a project from a report or create source views.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import canonical, digest, identifier, read_json
from .source_disturbance import SCHEMA, selection as study_selection

KIND = "source-disturbance-studies"
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "plan.json"}
LABELS = {KIND: "Source-selected disturbance studies"}


def _need(condition, message):
    if not condition:
        raise ValueError("Original source-disturbance Study: " + message)


def _same(left, right, message):
    _need(canonical(left) == canonical(right), message)


def _path(value):
    _need(isinstance(value, str) and value and "\\" not in value,
          "a retained member needs its original relative path")
    path = PurePosixPath(value)
    _need(not path.is_absolute() and ".." not in path.parts
          and str(path) == value and value != ".", "a retained member leaves its original directory")
    return value


def _optional(closure, relative):
    path = closure.root / relative
    return closure.read(relative) if path.exists() or path.is_symlink() else None


def _descriptor(closure, prefix, descriptor):
    _need(isinstance(descriptor, dict), "a retained file descriptor is missing")
    relative = prefix + _path(descriptor["path"])
    closure.add_file(relative, descriptor)
    return relative


def _inventory(closure, prefix, files):
    _need(isinstance(files, dict), "the complete original inventory is missing")
    paths = set()
    for name, descriptor in files.items():
        _path(name)
        relative = _descriptor(closure, prefix, descriptor)
        _need(relative not in paths, "two inventory entries select the same member")
        paths.add(relative)
    return paths


def _record(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    _need(value.get("schema") == "upstate." + kind + "/v1" and digest(value) == key,
          "a saved " + kind + " record changed")
    return {**value, "id": key}


def _source(closure, collection_id, source_id):
    value = _record(closure, "sources", collection_id)
    entries = [row for row in value["entries"] if row["id"] == source_id]
    _need(len(entries) == 1, "the selected source is absent from its original collection")
    closure.need("sources", collection_id, "Original selected polygon, protection or coefficient source")
    entry = entries[0]
    for descriptor in [entry["body"], *entry.get("companions", [])]:
        closure.add_file(descriptor["object"], descriptor)
    return value, entry


def _run(closure, run_id):
    run_id = identifier(run_id)
    value = closure.read("runs/" + run_id + "/run.json")
    _need(value.get("id") == run_id and digest(value.get("selection")) == run_id,
          "an original native run changed its selection")
    closure.need("runs", run_id, "Original source-disturbance native run")
    return value


def _identity(descriptor):
    return {"bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}


def _copy(files, name, source, message):
    _need(name in files, "report omitted " + name)
    _same(_identity(files[name]), _identity(source), message)


def _footprint(closure, case):
    key = identifier(case["footprint_id"])
    value = _record(closure, "scenario-footprints", key)
    _need(value["run_id"] == case["run_id"], "a native footprint names another run")
    _same(value["selection"], case["run_selection"], "a native footprint selection changed")
    prefix = "scenario-footprint-output/" + digest(value["request"]) + "/"
    manifest = closure.read(prefix + "complete.json")
    _need(manifest["schema"] == "upstate.scenario-footprint-files/v1",
          "a native footprint completion manifest changed")
    _same(manifest["request"], value["request"], "a native footprint request changed")
    _same(value["files"], {name: {**item, "path": prefix + item["path"]}
                          for name, item in manifest["files"].items()},
          "the native footprint file roster changed")
    _inventory(closure, "", value["files"])
    closure.tree(prefix.rstrip("/"))
    report = closure.read(value["files"]["report"]["path"])
    _same(report["request"], value["request"], "the native footprint report names another request")
    closure._source_refs(value["request"], "Original native footprint sources")
    return value, report, prefix.rstrip("/") + ".lock"


def _operations(closure, key, prefix, prepared, report, pinned):
    result = []
    if pinned is None:
        candidates = []
        for path in sorted((closure.root / "source-disturbance-operations").glob("*/intent.json")):
            original = read_json(path)
            if original.get("study_id") == key:
                candidates.append((path.parent.name, original))
    else:
        candidates = [(digest(row["operation_id"]), None) for row in pinned["operations"]]
    for directory_id, _ in candidates:
        relative = "source-disturbance-operations/" + directory_id + "/"
        original = closure.read(relative + "intent.json")
        operation_id, action = original["operation_id"], original["action"]
        _need(directory_id == digest(operation_id)
              and original.get("schema") == "upstate.source-disturbance-operation/v1"
              and original.get("project_id") == closure.workspace.project["id"]
              and original.get("study_id") == key
              and original.get("request_sha256") == digest(original["request"]),
              "a saved operation lost its original request identity")
        _need(action in ("source-disturbance.prepare", "source-disturbance.report"),
              "a saved operation names an unrelated action")
        expected = prepared if action.endswith(".prepare") else report
        if action.endswith(".prepare"):
            _same(study_selection(original["request"]), closure.read(prefix + "plan.json")["selection"],
                  "the original prepare request selects another study")
        else:
            _same(original["request"], {"study_id": key}, "the original report request changed")
        origin = original.get("origin")
        if origin is not None:
            _need(origin.get("task_id") == operation_id
                  and origin.get("project_id") == closure.workspace.project["id"]
                  and origin.get("action") == action,
                  "the original queue context changed")
            _same(origin.get("payload"), original["request"], "the original queued payload changed")
            _need(origin.get("request_sha256") == digest({
                "workspace": origin.get("workspace"), "action": action, "payload": original["request"]}),
                "the original queued request digest changed")
        output = _optional(closure, relative + "result.json")
        if output is not None:
            _need(expected is not None, "an accepted operation lost its original receipt")
            _same(output, expected, "an accepted operation result changed")
        result.append({"operation_id": operation_id,
                       "intent_sha256": closure.files[relative + "intent.json"]["sha256"],
                       "result_sha256": (closure.files[relative + "result.json"]["sha256"]
                                         if output is not None else None)})
    return sorted(result, key=lambda row: row["operation_id"])


def _report(closure, key, prefix, plan, prepared, footprints):
    report = _optional(closure, prefix + "report/report.json")
    if report is None:
        return None
    _need(prepared is not None, "a completed report lost its original preparation")
    _need(report.get("schema") == "upstate.source-disturbance-report/v1"
          and report.get("project_id") == closure.workspace.project["id"]
          and report.get("study_id") == key and report.get("state") == "complete",
          "the retained report identity changed")
    _same(report["selection"], plan["selection"], "the report selection changed")
    _same(report["grid"], plan["grid"], "the report grid changed")
    base, files = prefix + "report/", report["files"]
    _inventory(closure, base, files)
    _need(all(name == descriptor["path"] for name, descriptor in files.items()),
          "report filenames differ from their original inventory")
    result = closure.read(base + "result.json")
    expected = {name: value for name, value in report.items() if name not in ("files", "result_sha256")}
    expected["schema"] = SCHEMA
    _same(result, expected, "the report and native result differ")
    _need(report["result_sha256"] == files["result.json"]["sha256"],
          "the report lost its original result bytes")
    _same(closure.read(base + "plan.json"), plan, "the report contains another plan")
    _same(closure.read(base + "preparation-receipt.json"), prepared, "the report contains another preparation")
    _same(report["footprints"], prepared["footprints"], "the report changes original footprint quantities")
    _same(report["cases"], [{**case, "state": "complete"} for case in prepared["cases"]],
          "the report case roster changed")
    expected_runs = {row["run"]["id"] for row in plan["baselines"]} | {row["run_id"] for row in prepared["cases"]}
    _need(set(report["native_records"]) == expected_runs, "the report native run roster changed")
    for run_id, original in report["native_records"].items():
        _same(_run(closure, run_id), original, "a reported original native result changed")
        _same(closure.read(base + "native/" + run_id + "/run.json"), original,
              "the copied report run differs from its original")
    _same(report["footprint_records"], {case["run_id"]: footprints[case["run_id"]][0]
                                        for case in prepared["cases"]},
          "the reported native footprints changed")
    for run_id, (footprint, _, _) in footprints.items():
        for descriptor in footprint["files"].values():
            _copy(files, "footprints/" + run_id + "/" + PurePosixPath(descriptor["path"]).name,
                  descriptor, "a report footprint member differs from its original")
    _need([row["baseline_run_id"] for row in report["comparisons"]]
          == [row["run"]["id"] for row in plan["baselines"]], "the report comparison roster changed")
    expected_measurements = []
    for row in report["comparisons"]:
        comparison_id = identifier(row["comparison_id"])
        comparison = closure.read("comparisons/" + comparison_id + "/comparison.json")
        _same(comparison, row["comparison"], "the report comparison differs from its original")
        _need(comparison["baseline_run_id"] == row["baseline_run_id"], "a comparison names another baseline")
        closure.need("comparisons", comparison_id, "Original reported native differences")
        cases = [case for case in prepared["cases"] if case["baseline_run_id"] == row["baseline_run_id"]]
        _need([item["run_id"] for item in comparison["alternatives"]] == [case["run_id"] for case in cases],
              "a comparison changed its original alternatives")
        for alternative, case in zip(comparison["alternatives"], cases):
            _need(alternative["profile_changed"] is False, "a reported source case changed coefficients")
            for name, descriptor in alternative["artifacts"].items():
                _copy(files, "differences/" + case["run_id"] + "/" + name + ".tif", descriptor,
                      "a report difference raster differs from the original comparison")
                expected_measurements.append({
                    "case_id": case["case_id"], "label": case["label"],
                    "baseline_run_id": row["baseline_run_id"], "run_id": case["run_id"],
                    "profile_id": case["profile_id"], "profile_changed": False, "artifact": name,
                    "units": descriptor["units"], "direction": comparison["direction"],
                    "sum_change": descriptor["sum_change"], "valid_cells": descriptor["valid_cells"],
                    "valid_hectares": descriptor["valid_cells"] * plan["pixel_area_ha"]})
        for run_id in [row["baseline_run_id"], *[case["run_id"] for case in cases]]:
            for name in comparison["common_artifacts"]:
                _copy(files, "native/" + run_id + "/" + name + ".tif",
                      report["native_records"][run_id]["artifacts"][name],
                      "a report native raster differs from its original run")
    _same(report["measurement_rows"], expected_measurements, "the report changes original native quantities")
    source_inventory = {}
    for source in plan["sources"].values():
        ref, entry = source["selection"], source["entry"]
        source_key = digest({"collection": ref["source_collection_id"], "source_id": ref["source_id"]})
        if source_key in source_inventory:
            continue
        originals = []
        for item in [entry["body"], *entry.get("companions", [])]:
            name = "original-sources/" + source_key + "/" + _path(item.get("view_path", item["filename"]))
            _copy(files, name, item, "a report original source or companion changed")
            originals.append(files[name])
        source_inventory[source_key] = {"selection": ref, "entry": entry, "files": originals}
    _same(report["original_sources"], source_inventory, "the report source inventory changed")
    for original in plan["baselines"]:
        profile = original["profile"]
        _, entry = _source(closure, profile["source_collection_id"], profile["biophysical_source_id"])
        _copy(files, "coefficients/" + profile["id"] + "/original/" + _path(entry["body"]["filename"]),
              entry["body"], "the reported coefficient table differs from its original")
        _same(closure.read(base + "coefficients/" + profile["id"] + "/profile.json"), profile,
              "the report coefficient profile changed")
    for name, descriptor in prepared["files"].items():
        _copy(files, "masks/" + name, descriptor, "a report mask differs from its prepared original")
    manifest = closure.read(base + "manifest.json")
    _same(manifest, {"schema": "upstate.source-disturbance-report-members/v1",
                    "project_id": closure.workspace.project["id"], "study_id": key,
                    "files": {name: item for name, item in files.items()
                              if name not in ("manifest.json", "source-disturbance-report.zip")},
                    "meaning": plan["semantics"]}, "the report ZIP member manifest changed")
    _need("source-disturbance-report.zip" in files, "the original complete report ZIP is missing")
    return report


def visit(closure, kind, key, plan):
    if kind != KIND:
        return False
    key = identifier(key)
    _need(plan.get("schema") == SCHEMA and digest(plan) == key
          and plan.get("project_id") == closure.workspace.project["id"], "the saved plan identity changed")
    _same(study_selection(plan["selection"]), plan["selection"], "the saved selection is not normalized")
    prefix = KIND + "/" + key + "/"
    pins = getattr(closure, "source_disturbance_selection", None)
    pinned = next((row for row in pins if row["study_id"] == key), None) if pins is not None else None
    _need(pins is None or pinned is not None, "the receiving lineage omitted this selected study")
    grid_id = identifier(plan["grid"]["id"])
    _same(closure.read("grids/" + grid_id + "/grid.json"), plan["grid"], "the original grid changed")
    closure.need("grids", grid_id, "Original source-disturbance model grid")
    for original in plan["baselines"]:
        run = original["run"]
        _same(_run(closure, run["id"]), run, "an original completed baseline changed")
        closure.add_file(original["run_file"]["path"], original["run_file"])
        for family, singular in (("profiles", "profile"), ("scenarios", "scenario")):
            record = original[singular]
            _same(_record(closure, family, record["id"]), record, "an original baseline input changed")
            closure.need(family, record["id"], "Original source-disturbance baseline input")
    for source in plan["sources"].values():
        ref = source["selection"]
        collection, entry = _source(closure, ref["source_collection_id"], ref["source_id"])
        _same(entry, source["entry"], "a selected polygon or protection source changed")
        _same(collection["original_manifest"], source["collection_manifest"], "the original source manifest changed")
    prepared = _optional(closure, prefix + "preparation-receipt.json")
    footprints, locks = {}, [KIND + "/" + key + ".lock"]
    if prepared is not None:
        _need(prepared.get("schema") == SCHEMA and prepared.get("project_id") == plan["project_id"]
              and prepared.get("id") == key and prepared.get("study_id") == key
              and prepared.get("state") == "prepared", "the first preparation receipt changed")
        _same(prepared["plan"], plan, "the preparation belongs to another plan")
        _need(prepared["mask_manifest"]["path"] == "masks/masks.json", "the mask manifest moved")
        mask_path = _descriptor(closure, prefix, prepared["mask_manifest"])
        masks = closure.read(mask_path)
        _need(masks["schema"] == "upstate.source-disturbance-masks/v1" and masks["study_id"] == key,
              "the original mask manifest names another study")
        _inventory(closure, prefix + "masks/", masks["files"])
        _same(prepared["files"], {name: {**item, "path": "masks/" + item["path"]}
                                 for name, item in masks["files"].items()}, "the preparation mask inventory changed")
        collection = _record(closure, "sources", prepared["source_collection_id"])
        closure.need("sources", collection["id"], "Original derived binary mask source collection")
        _same(_identity(collection["original_manifest"]), _identity(masks["files"]["sources.json"]),
              "the imported mask source manifest changed")
        _need([(row["case_id"], row["baseline_run_id"]) for row in prepared["cases"]]
              == [(case["id"], baseline["run"]["id"]) for case in plan["selection"]["cases"]
                  for baseline in plan["baselines"]], "the prepared case roster changed")
        for case in prepared["cases"]:
            run = _run(closure, case["run_id"])
            _same(run["selection"], case["run_selection"], "a prepared run changed its original selection")
            _need(all(case[field] == run["selection"][field] for field in ("grid_id", "scenario_id", "profile_id")),
                  "a prepared case lost its original native IDs")
            scenario = _record(closure, "scenarios", case["scenario_id"])
            _need(scenario.get("source_disturbance_study_id") == key
                  and scenario.get("source_disturbance_case_id") == case["case_id"]
                  and scenario.get("source_collection_id") == collection["id"],
                  "a prepared scenario lost its source-study association")
            footprints[case["run_id"]] = _footprint(closure, case)
            locks.append(footprints[case["run_id"]][2])
    report = _report(closure, key, prefix, plan, prepared, footprints)
    operations = _operations(closure, key, prefix, prepared, report, pinned)
    closure.tree(prefix.rstrip("/"))
    row = {"study_id": key, "plan_sha256": closure.files[prefix + "plan.json"]["sha256"],
           "preparation_sha256": (closure.files[prefix + "preparation-receipt.json"]["sha256"] if prepared else None),
           "report_sha256": (closure.files[prefix + "report/report.json"]["sha256"] if report else None),
           "operations": operations}
    if not hasattr(closure, "source_disturbance_records"):
        closure.source_disturbance_records = {}
        closure.source_disturbance_locks = set()
    if pinned is not None:
        # The captured generation remains the receipt authority after legitimate
        # later preparation, reporting or completion of an originally pending call.
        _need(row["plan_sha256"] == pinned["plan_sha256"], "the received original plan changed")
        for field in ("preparation_sha256", "report_sha256"):
            if pinned[field] is not None:
                _need(row[field] == pinned[field], "the received original " + field + " changed")
        current_operations = {item["operation_id"]: item for item in row["operations"]}
        for original in pinned["operations"]:
            current = current_operations[original["operation_id"]]
            _need(current["intent_sha256"] == original["intent_sha256"],
                  "the received original operation intent changed")
            if original["result_sha256"] is not None:
                _need(current["result_sha256"] == original["result_sha256"],
                      "the received original accepted operation result changed")
        row = deepcopy(pinned)
    closure.source_disturbance_records[key] = row
    closure.source_disturbance_locks.update(locks)
    closure.nodes[(kind, key)]["state"] = "complete" if report else "prepared" if prepared else "preparing"
    return True


def receipt(closure):
    return [deepcopy(row) for _, row in sorted(getattr(closure, "source_disturbance_records", {}).items())]


def verify_receipt(closure, expected):
    _same(receipt(closure), expected, "the received selected study differs from its original captured generation")


def lock_paths(closure):
    return sorted(getattr(closure, "source_disturbance_locks", set()))


def catalogue(workspace):
    rows = []
    for path in sorted((workspace.root / KIND).glob("*/plan.json")):
        key, plan = identifier(path.parent.name), read_json(path)
        _need(plan.get("schema") == SCHEMA and digest(plan) == key
              and plan.get("project_id") == workspace.project["id"], "a catalog plan changed")
        prepared = path.parent / "preparation-receipt.json"
        report = path.parent / "report/report.json"
        rows.append({"kind": KIND, "id": key, "title": plan["selection"]["title"],
                     "state": "complete" if report.is_file() else "prepared" if prepared.is_file() else "preparing",
                     "baselines": len(plan["baselines"]), "cases": len(plan["selection"]["cases"])})
    return rows
