"""Saved Conservation decisions beside explicit original Sampling targets.

TokenJunkieLabs. This reads the original scientific report's retained records,
without solving a portfolio, running native models or inferring station support.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
import zipfile
from pathlib import PurePosixPath

from .common import digest, identifier, read_json, verify_file
from .monitoring_common import ContractError

FAMILY = "conservation_portfolio"
SOURCE_SCHEMA = "upstate.conservation-report-source/v1"
QUANTITY_SCOPE = "saved_conservation_selected_reporting_union"


def _need(ok, message):
    if not ok:
        raise ContractError(message)


def is_source(entry):
    metadata = entry.get("metadata", {})
    return (entry.get("kind") == "document" and entry.get("role") == "OBSERVED_CONTEXT"
            and isinstance(metadata, dict)
            and metadata.get("source_kind") == "saved_conservation_portfolio")


def _name(value):
    _need(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
          "Retain an ordinary Conservation source member name")
    path = PurePosixPath(value)
    _need(not path.is_absolute() and str(path) == value
          and all(part not in ("", ".", "..") and ":" not in part for part in path.parts),
          "The original Conservation source member is not portable")
    return value


def _same(left, right):
    return (isinstance(left, dict) and isinstance(right, dict)
            and all(left.get(key) == right.get(key) and key in left for key in ("bytes", "sha256")))


def document(workspace, collection, entry):
    """Use the original source collection and complete recipe companion inventory."""
    from .conservation_study_transfer import REPORT_EDITIONS
    _need(is_source(entry), "Choose an original saved Conservation report source")
    body = entry.get("body")
    companions = entry.get("companions")
    _need(isinstance(body, dict) and isinstance(companions, list)
          and all(isinstance(item, dict) for item in companions),
          "Retain the complete Conservation recipe and source companion descriptors")
    paths, descriptors = {}, {}
    for item in [body, *companions]:
        name = _name(item.get("view_path", item.get("filename")))
        _need(name not in paths, "The Conservation source repeats an original member")
        paths[name] = verify_file(workspace.root, {**item, "path": item["object"]})
        descriptors[name] = deepcopy(item)
    recipe = read_json(paths[_name(body.get("view_path", body.get("filename")))])
    origin = recipe.get("origin")
    _need(recipe.get("schema") == "upstate.observed-report/v1"
          and recipe.get("edition") in REPORT_EDITIONS and isinstance(origin, dict)
          and origin.get("schema") == SOURCE_SCHEMA
          and origin == entry["metadata"].get("origin"),
          "The Conservation recipe and original source identity differ")
    for name in ("id", "study_id", "plan_id", "packet_id"):
        identifier(origin.get(name))
    project_id = origin.get("project_id")
    _need(isinstance(project_id, str) and project_id,
          "The Conservation source lost its original project identity")
    _need(entry["id"] == "conservation-portfolio-" + origin["id"]
          and entry.get("uri") == "workspace://" + project_id + "/conservation-plans/" + origin["plan_id"],
          "The Conservation entry names a different saved portfolio")
    expected = {}
    for member in recipe.get("inputs", []):
        _need(isinstance(member, dict), "The scientific recipe has an invalid original member")
        name = _name(member.get("path"))
        _need(name not in expected, "The scientific recipe repeats a companion")
        expected[name] = (member["bytes"], member["sha256"])
    actual = {_name(item.get("view_path", item.get("filename"))): (item["bytes"], item["sha256"])
              for item in companions}
    _need(expected == actual and len(actual) == len(companions),
          "The complete Conservation source inventory differs from its recipe")
    _need(origin.get("mode") == "native_model" and bool(expected),
          "Choose a Conservation source with completed native modeled quantities; geographic context alone remains separate")
    source = {"collection_id": collection["id"], "source_id": entry["id"],
              "collection_sha256": digest(collection), "entry_sha256": digest(entry),
              "body": deepcopy(body), "members": deepcopy(companions),
              "title": entry.get("title", entry["id"]), "uri": entry["uri"],
              "classification": "Retained native-model Conservation portfolio"}
    return collection, entry, paths, source, FAMILY, origin["id"], recipe


def _json(paths, name):
    _need(name in paths, "Retain the complete Conservation companion " + name)
    return read_json(paths[name])


def _descriptor(entry, name):
    values = [item for item in entry["companions"]
              if item.get("view_path", item.get("filename")) == name]
    _need(len(values) == 1, "Retain one original Conservation member " + name)
    return values[0]


def _packet_support(paths, study, plan, support):
    """Bind foreign-source support to the original ZIP members without extraction."""
    _need("decision-packet.zip" in paths, "Retain the original complete decision packet")
    with zipfile.ZipFile(paths["decision-packet.zip"]) as packet:
        infos = packet.infolist()
        names = [item.filename for item in infos]
        _need(len(names) == len(set(names)), "The original decision packet repeats a member")
        for name in names:
            _name(name)
        _need("packet-manifest.json" in names, "Retain the original packet manifest")
        with packet.open("packet-manifest.json") as stream:
            manifest = json.load(stream)
        _need(manifest.get("schema") == "upstate.conservation-packet/v1"
              and manifest.get("study_id") == study["id"]
              and manifest.get("plan_id") == plan["id"],
              "The original packet belongs to another saved decision")
        def verified(name, descriptor, read=False):
            _need(name in names and _same(manifest.get("members", {}).get(name), descriptor),
                  "The original packet lost its retained support member: " + name)
            info = packet.getinfo(name)
            _need(info.file_size == descriptor["bytes"],
                  "The retained support member changed its original byte length")
            checksum, size, chunks = hashlib.sha256(), 0, []
            with packet.open(info) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(block)
                    checksum.update(block)
                    if read:
                        chunks.append(block)
            _need(size == descriptor["bytes"] and checksum.hexdigest() == descriptor["sha256"],
                  "The retained support member changed its original bytes")
            return json.loads(b"".join(chunks)) if read else None
        retained = verified("matched-family-support.json",
                            study["files"]["matched_family_support"], read=True)
        _need(retained == support, "The packet and original study have different common support")
        for pollutant, value in support["metrics"].items():
            mask = value.get("mask")
            if mask is not None:
                name = "matched-support-" + pollutant + ".tif"
                _need(_same(study["files"].get("matched_support_" + pollutant), mask),
                      "The retained study has a different original support raster")
                verified(name, mask)


def native(workspace, entry, paths, native_id, recipe):
    """Project exact selected-union values; never add overlapping parcel masses."""
    from .conservation import POLLUTANTS
    origin = recipe["origin"]
    plan = _json(paths, "records/plan.json")
    study = _json(paths, "records/study.json")
    state = _json(paths, "records/study-inspection.json")
    portfolio = _json(paths, "records/portfolio.json")
    candidates = _json(paths, "records/candidates.json")
    sources = _json(paths, "records/source-bindings.json")
    _need(plan.get("schema") == "upstate.conservation-plan/v1"
          and plan.get("state") == "complete" and plan.get("id") == origin["plan_id"]
          and digest(plan.get("selection")) == plan["id"]
          and study.get("schema") == "upstate.conservation-study/v1"
          and study.get("state") == "complete" and study.get("id") == origin["study_id"]
          and digest(study.get("selection")) == study["id"]
          and plan.get("study_id") == study["id"]
          and plan["selection"].get("study_id") == study["id"],
          "The saved Conservation decision or study changed its original identity")
    for name in ("id", "schema", "state", "selection", "files", "mode", "metric_state",
                 "purpose", "unit_type", "planning_unit_label", "analysis_crs", "matched_family_support"):
        _need(state.get(name) == study.get(name),
              "The scientific inspection differs from its original study: " + name)
    spec, bindings = study["selection"]["spec"], study["selection"]["bindings"]
    _need(state.get("spec") == spec and study.get("mode") == "native_model"
          and study.get("metric_state") == "modeled"
          and origin["mode"] == study["mode"] and origin["purpose"] == study["purpose"]
          and origin["unit_type"] == study["unit_type"],
          "The source's scientific interpretation differs from its original native study")
    _need(portfolio.get("schema") == "upstate.conservation-portfolio/v1"
          and portfolio.get("id") == plan["id"] and portfolio.get("study_id") == study["id"]
          and portfolio.get("selected_ids") == plan.get("selected_ids")
          and portfolio.get("summary") == plan.get("summary")
          and _same(plan["files"]["portfolio"], _descriptor(entry, "records/portfolio.json")),
          "The report's selected-union quantities differ from the saved plan")
    _need(candidates.get("schema") == "upstate.conservation-candidates/v1"
          and candidates.get("study_id") == study["id"]
          and _same(study["files"]["candidates"], _descriptor(entry, "records/candidates.json"))
          and plan["selection"].get("candidates_sha256") == study["files"]["candidates"]["sha256"]
          and plan["selection"].get("geometries_sha256") == study["files"]["geometries"]["sha256"],
          "The selected decision lost its exact candidate/geometry edition")
    inventory = candidates.get("candidates")
    selected = portfolio.get("selected_candidates")
    _need(isinstance(inventory, list) and isinstance(selected, list),
          "Retain the complete original planning-unit inventories")
    by_id = {row["id"]: row for row in inventory}
    _need(len(by_id) == len(inventory) and [row["id"] for row in selected] == plan["selected_ids"]
          and len(set(plan["selected_ids"])) == len(selected)
          and all(by_id.get(row["id"]) == row for row in selected),
          "Selected units differ from their complete original candidate rows")
    _need(sources.get("schema") == "upstate.conservation-report-originals/v1"
          and sources.get("study_id") == study["id"] and isinstance(sources.get("sources"), list),
          "Retain the original planning/source classification register")
    for original in sources["sources"]:
        collection_id = identifier(original.get("source_collection_id"))
        original_entry = original.get("entry", {})
        _need(original_entry.get("id") == original.get("source_id"),
              "The original planning-source register changed its source ID")
        prefix = "originals/" + collection_id + "/" + digest(original["source_id"]) + "/"
        for item in [original_entry["body"], *original_entry.get("companions", [])]:
            name = prefix + _name(item.get("view_path", item.get("filename")))
            _need(_same(item, _descriptor(entry, name)),
                  "The original planning-source register lost its retained member: " + name)
    local = origin["project_id"] == workspace.project["id"]
    if local:
        from . import conservation_report_source as original
        retained = original.get(workspace, native_id)
        _need(retained["plan_id"] == plan["id"] and retained["study_id"] == study["id"]
              and retained["source"]["source_id"] == entry["id"]
              and _same(retained["files"]["recipe"], entry["body"]),
              "The selected source differs from its original local Conservation report")
        for name in ("records/plan.json", "records/study.json", "records/portfolio.json",
                     "records/candidates.json", "records/study-inspection.json"):
            _need(_same(retained["members"].get(name), _descriptor(entry, name)),
                  "The local report changed a selected scientific member: " + name)
    geometry_name = "portfolio/geopackage/" + PurePosixPath(plan["files"]["geopackage"]["path"]).name
    _need(_same(plan["files"]["geopackage"], _descriptor(entry, geometry_name))
          and _same(plan["files"]["footprint"], plan["files"]["geopackage"])
          and plan["files"]["footprint"].get("layer") == "selected_union",
          "The selected original land geometry is missing from the report")
    families = {row["id"]: row for row in spec.get("matched_families", [])}
    _need(len(families) == len(spec.get("matched_families", [])),
          "The original scientific families have repeated IDs")
    support_record = study.get("matched_family_support")
    if families:
        from .conservation_families import _selection, validate
        validate(spec, bindings["runs"])
        _need(isinstance(support_record, dict)
              and support_record.get("schema") == "upstate.conservation-matched-family-support/v1"
              and support_record.get("selection") == _selection(study)
              and digest({key: value for key, value in support_record.items() if key != "id"})
                  == support_record.get("id"),
              "Retain the exact all-family scientific support identity")
        try:
            _packet_support(paths, study, plan, support_record)
        except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError) as error:
            raise ContractError("The original Conservation support packet cannot be read: " + str(error)) from error
    rows, quantities, support = [], [], {}
    selected_outputs = {pollutant for run in bindings["runs"].values() for pollutant in run["outputs"]}
    for pollutant, metric in plan["summary"].get("pollutants", {}).items():
        if pollutant not in selected_outputs:
            continue
        unit = metric.get("unit")
        _need(pollutant in POLLUTANTS and unit == POLLUTANTS[pollutant][2],
              "Retain each pollutant's original physical unit")
        quantities.append({"pollutant": pollutant, "units": unit})
        rows.append({"metric": pollutant, "support_kind": "baseline_own", "label": "Original baseline",
                     "baseline_run_id": spec["baseline_run_id"], "alternative_run_id": None,
                     "units": unit, "baseline_own_total": metric.get("baseline"),
                     "baseline_own_coverage_fraction": metric.get("coverage_fraction"),
                     "baseline_own_valid_area_ha": metric.get("valid_area_ha"),
                     "baseline_own_structural_area_ha": metric.get("structural_stream_area_ha"),
                     "baseline_own_missing_area_ha": metric.get("missing_area_ha"),
                     "availability": metric.get("availability"),
                     "availability_reason": metric.get("availability_reason")})
        for run_id in spec.get("alternative_run_ids", []):
            value = metric.get("alternatives", {}).get(run_id)
            if value is None:
                continue
            rows.append({"metric": pollutant, "support_kind": "fixed_baseline_pair",
                         "label": "Original alternative", "baseline_run_id": spec["baseline_run_id"],
                         "alternative_run_id": run_id, "units": unit, **deepcopy(value)})
        matched = metric.get("matched_families", {})
        _need(set(matched) == set(families),
              "The selected-union result lost an original matched family")
        for family_id, value in matched.items():
            family = families[family_id]
            _need(value.get("family_id") == family_id
                  and value.get("baseline_run_id") == family["baseline_run_id"]
                  and value.get("alternative_run_id") == family["alternative_run_id"]
                  and value.get("unit") == unit
                  and value.get("support_id") == support_record["id"]
                  and value.get("support_sha256") == ((support_record["metrics"][pollutant].get("mask") or {}).get("sha256")),
                  "A paired Conservation result differs from its original family/support")
            rows.append({"metric": pollutant, "support_kind": "all_family_common",
                         "label": family["label"], "scientific_reason": family["reason"],
                         "reference": family.get("reference"), "units": unit, **deepcopy(value)})
        support[pollutant] = {
            "selected_union_area_ha": plan["summary"]["union_area_ha"],
            "original_selected_union_metric": deepcopy(metric),
            "all_family_grid_support": deepcopy((support_record or {}).get("metrics", {}).get(pollutant)),
            "policy": "Original fixed-baseline pairwise support remains distinct from each pollutant's all-declared-family footprint"}
    _need(quantities, "This saved decision contains no original modeled pollutant quantities")
    decision = {"plan_id": plan["id"], "study_id": study["id"], "title": plan["title"],
                "study_title": study["title"], "purpose": study["purpose"],
                "selected_ids": deepcopy(plan["selected_ids"]), "summary": deepcopy(plan["summary"]),
                "selection": deepcopy(plan["selection"]), "planning_unit_label": study["planning_unit_label"],
                "selected_units": deepcopy(selected), "matched_families": deepcopy(list(families.values())),
                "optimization": None}
    reference = plan["selection"].get("optimization")
    if reference is not None:
        if recipe["edition"] == "conservation-saved-plan-report/1" and "optimization/analysis.json" not in paths:
            # This original edition predates separate optimization companions.
            # Preserve its authored decision, without claiming absent case rows.
            decision["optimization"] = {
                "id": reference["analysis_id"], "request": deepcopy(reference["request"]),
                "engine": deepcopy(reference["engine"]),
                "normalization": deepcopy(reference["normalization"]),
                "solver_result": deepcopy(reference["solver_result"]),
                "reference": deepcopy(reference), "detail_availability": "historical_reference_only",
                "detail_reason": "The original report edition predates separate analysis companions",
            }
        else:
            analysis = _json(paths, "optimization/analysis.json")
            from .conservation_study_transfer import _optimization_analysis
            _optimization_analysis(study, plan, analysis)
            _need(_same(reference["files"]["analysis"], _descriptor(entry, "optimization/analysis.json")),
                  "The original saved priority analysis changed its retained file")
            decision["optimization"] = {key: deepcopy(analysis.get(key)) for key in (
                "id", "request", "engine", "normalization", "counts", "methods",
                "scenario_stability", "stability", "joint_comparison", "selection")}
            decision["optimization"]["detail_availability"] = "retained_complete_analysis"
    runs = bindings.get("runs", {})
    _need(isinstance(runs, dict) and spec["baseline_run_id"] in runs,
          "Retain the completed original native run bindings")
    return {"family": FAMILY, "id": native_id, "project_id": origin["project_id"],
            "quantity_scope": QUANTITY_SCOPE, "quantities": quantities, "rows": rows,
            "support": support, "run_ids": list(runs), "grid_id": bindings["grid"]["id"],
            "geometry": {"analysis_crs": plan["analysis_crs"], "original_geopackage": deepcopy(
                _descriptor(entry, geometry_name)), "selected_union": deepcopy(plan["files"]["footprint"]),
                "planning_source": deepcopy(bindings["sources"]["parcels"]),
                "selected_ids": deepcopy(plan["selected_ids"]), "areas": {
                    key: deepcopy(plan["summary"].get(key)) for key in (
                        "union_area_ha", "whole_unit_union_area_ha", "overlap_area_ha",
                        "whole_unit_overlap_area_ha", "source_water_area_ha", "protected_area_ha")}},
            "native_execution": deepcopy(state.get("native_execution", {})),
            "classification": "Retained native-model results on the saved selected reporting union",
            "original_input_classifications": deepcopy(sources["sources"]),
            "source_project_relation": "same_project" if local else "retained_foreign_source",
            "decision": decision, "report_title": recipe.get("title", entry.get("title"))}
