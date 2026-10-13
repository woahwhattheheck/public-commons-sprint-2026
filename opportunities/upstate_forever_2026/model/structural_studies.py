"""Source-native structural studies on explicit original grids and native runs.

This additive family leaves the ordinary same-grid comparison and the 30 m
production delivery unchanged. No raster is silently made into a new model run.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
import math
from pathlib import Path
import re

from .common import atomic_json, canonical, describe_file, digest, held, identifier, now, read_json, verify_file
from .model_selection import run_models, selected, required_outputs
from .profiles import checked_parameters
from . import structural_overlap

SCHEMA = "upstate.structural-study/v1"
SELECTION_SCHEMA = "upstate.structural-study-selection/v1"
VERSION = "original-grid-structural-study-1"
FAMILIES = {
    "resolution": "Original reference-grid resolution",
    "terrain": "Original terrain source",
    "domain": "Model domain and upstream context",
    "routing": "Native flow direction algorithm",
    "stream_definition": "Physical stream-initiation area",
}
MAX_CASES = 32


class StructuralError(ValueError):
    def __init__(self, code, message, *, case_id=None):
        super().__init__(message)
        self.code, self.case_id = code, case_id


def _need(value, code, message, case_id=None):
    if not value:
        raise StructuralError(code, message, case_id=case_id)


def _clone(value):
    import json
    return json.loads(canonical(value))


def _text(value, label, maximum=10000):
    _need(isinstance(value, str) and value.strip() and len(value) <= maximum,
          "STRUCTURAL_INPUT", "Supply " + label)
    return value


def _references(value):
    _need(isinstance(value, list) and len(value) <= 100,
          "STRUCTURAL_INPUT", "Retain scientific references as a list of source citations")
    return [_text(item, "each scientific reference", 4000) for item in value]


def _positive(value, name):
    _need(not isinstance(value, bool) and isinstance(value, (int, float))
          and math.isfinite(value) and value > 0, "STRUCTURAL_INPUT",
          "Supply a positive finite " + name)
    return float(value)


def _shape(grid):
    from pyproj import CRS
    native = grid["grid"]
    t = native["transform"]
    _need(isinstance(t, list) and len(t) >= 6
          and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in t[:6])
          and t[0] > 0 and t[4] < 0 and t[1] == 0 and t[3] == 0,
          "STRUCTURAL_GRID", "Use the retained original north-up unrotated native grid")
    crs = CRS.from_user_input(native["crs"])
    _need(crs.is_projected and len(crs.axis_info) >= 2
          and all(abs(axis.unit_conversion_factor - 1) <= 1e-12 for axis in crs.axis_info[:2]),
          "STRUCTURAL_CRS", "Use the original projected-metre native grid")
    return {"crs": crs.to_wkt(), "transform": list(t[:6]),
            "width": native["width"], "height": native["height"],
            "pixel_size_m": [t[0], -t[4]], "pixel_area_m2": abs(t[0] * t[4])}


def _implementation():
    from .portable import application_digest
    files = {}
    for name in ("structural_studies.py", "structural_overlap.py"):
        path = Path(__file__).with_name(name)
        raw = path.read_bytes()
        files[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    application = application_digest()
    for name, expected in files.items():
        raw = Path(__file__).with_name(name).read_bytes()
        _need(len(raw) == expected["bytes"] and hashlib.sha256(raw).hexdigest() == expected["sha256"],
              "STRUCTURAL_SOURCE_CHANGED", "Application source changed during study binding")
    return {"version": VERSION, "overlap_version": structural_overlap.VERSION,
            "application_sha256": application, "files": files}


def _selection(value):
    _need(isinstance(value, dict), "STRUCTURAL_INPUT", "Supply a complete structural-study selection")
    value = _clone(value)
    _need(not (set(value) - {"schema", "title", "purpose", "family", "references", "reference_run_id", "cases"}),
          "STRUCTURAL_INPUT", "Choose the documented original structural-study fields")
    _need(value.get("schema", SELECTION_SCHEMA) == SELECTION_SCHEMA, "STRUCTURAL_INPUT", "Choose a structural-study selection")
    value["schema"] = SELECTION_SCHEMA
    _text(value.get("title"), "a study title", 500)
    _text(value.get("purpose"), "the scientific question")
    _need(value.get("family") in FAMILIES, "STRUCTURAL_FAMILY", "Choose one explicit structural family")
    identifier(value.get("reference_run_id"))
    value["references"] = _references(value.get("references", []))
    rows = value.get("cases")
    _need(isinstance(rows, list) and 1 <= len(rows) <= MAX_CASES,
          "STRUCTURAL_INPUT", "Select between one and 32 explicit cases")
    ids, existing_runs = set(), set()
    for row in rows:
        _need(isinstance(row, dict) and not (set(row) - {
            "id", "label", "grid_id", "reason", "references", "routing", "stream_area_m2", "existing_run_id"}),
            "STRUCTURAL_INPUT", "Retain each explicit case selection")
        _need(isinstance(row.get("id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", row["id"])
              and row["id"] not in ids, "STRUCTURAL_INPUT", "Give each case a distinct retained ID")
        ids.add(row["id"])
        _text(row.get("label"), "a case label", 500)
        _text(row.get("reason"), "the scientific reason for this case")
        identifier(row.get("grid_id"))
        if row.get("existing_run_id") is not None:
            identifier(row["existing_run_id"])
            _need(row["existing_run_id"] not in existing_runs,
                  "STRUCTURAL_EXISTING_RUN_DUPLICATE",
                  "Select each completed original native run once within this study", row["id"])
            existing_runs.add(row["existing_run_id"])
        row["references"] = _references(row.get("references", []))
        _need(value["family"] == "routing" or "routing" not in row,
              "STRUCTURAL_FAMILY", "Routing changes belong in the routing family", row["id"])
        _need(value["family"] == "stream_definition" or "stream_area_m2" not in row,
              "STRUCTURAL_FAMILY", "Physical stream area changes belong in the stream-definition family", row["id"])
    return value


def _sources(workspace, grid):
    collection = workspace._get("sources", grid["spec"]["source_collection_id"])
    entries = {row["id"]: row for row in collection["entries"]}
    choices = dict(grid["spec"]["input_sources"])
    for name in ("model_domain", "reporting_area"):
        if isinstance(grid["spec"].get(name), dict):
            choices[name] = grid["spec"][name]["source_id"]
    result = {}
    for role, source_id in choices.items():
        _need(source_id in entries, "STRUCTURAL_SOURCE", "Retain the original grid source: " + role)
        entry = entries[source_id]
        result[role] = {**deepcopy(entry), "collection_id": collection["id"], "source_id": source_id,
                        "body": deepcopy(entry["body"]), "companions": deepcopy(entry.get("companions", []))}
    return result


def _source_identity(value):
    return {key: value.get(key) for key in ("units", "conversion", "resampling", "layer", "where")} | {
        "sha256": value["body"]["sha256"], "bytes": value["body"]["bytes"],
        "companions": [{key: part[key] for key in ("sha256", "bytes")} for part in value["companions"]]}


def _grid_context(workspace, grid):
    return {"id": grid["id"], "spec": deepcopy(grid["spec"]), "grid": deepcopy(grid["grid"]),
            "shape": _shape(grid), "files": deepcopy(grid["files"]),
            "inputs": deepcopy(grid["inputs"]), "sources": _sources(workspace, grid)}


def _changes(reference, case, model_reference, model_case):
    changes = []
    def add(field, before, after, meaning):
        if canonical(before) != canonical(after):
            changes.append({"field": field, "reference": before, "case": after, "meaning": meaning})
    for name in ("pixel_size_m", "transform", "width", "height"):
        add("grid." + name, reference["shape"][name], case["shape"][name],
            "Original native grid definition; no diagnostic resampling is a new model run")
    for role in sorted(set(reference["sources"]) | set(case["sources"])):
        a, b = reference["sources"].get(role), case["sources"].get(role)
        add("source." + role, _source_identity(a) if a else None, _source_identity(b) if b else None,
            "Original selected source bytes, declared units and conversion")
    for field in ("model_domain", "reporting_area", "upstream_buffer_m"):
        add("domain." + field, reference["spec"].get(field), case["spec"].get(field),
            "Original model/reporting support and upstream context")
    for model in model_reference:
        for field in ("flow_dir_algorithm", "threshold_flow_accumulation", "stream_area_m2"):
            add(model + "." + field, model_reference[model][field], model_case[model][field],
                "Pixel threshold is derived from explicit physical area; routing stays an original native choice")
    return changes


class StructuralStudies:
    def __init__(self, workspace):
        self.workspace, self.root = workspace, workspace.root
        self.directory = self.root / "structural-studies"
        self.operations = self.root / "structural-study-operations"

    def _base(self, **items):
        return {"schema": SCHEMA, "project_id": self.workspace.project["id"], **items}

    def summaries(self):
        """Read retained study metadata without opening native sources or results."""
        studies = []
        for path in sorted(self.directory.glob("*/study.json")):
            item = read_json(path)
            _need(item.get("schema") == SCHEMA and item.get("id") == path.parent.name
                  and item.get("project_id") == self.workspace.project["id"],
                  "STRUCTURAL_STATE_CHANGED", "Original structural study summary changed")
            studies.append({key: item[key] for key in
                            ("id", "title", "family", "state", "created_at", "updated_at")})
        return self._base(studies=studies)

    def catalog(self):
        # Native file bodies are checked only when their run/comparison executes.
        runs = []
        for path in sorted((self.root / "runs").glob("*/run.json")):
            run = self.workspace.inspect_run(path.parent.name)
            runs.append({"id": run["id"], "state": run["state"], "selection": run["selection"],
                         "models": list(run_models(run)), "artifacts": deepcopy(run.get("artifacts", {}))})
        grids = []
        for path in sorted((self.root / "grids").glob("*/grid.json")):
            raw = read_json(path)
            if raw.get("state") == "complete":
                grid = self.workspace.get_grid(path.parent.name)
                grids.append(_grid_context(self.workspace, grid))
        studies = self.summaries()["studies"]
        return self._base(families=[{"id": key, "label": label} for key, label in FAMILIES.items()],
                          runs=runs, grids=grids, profiles=self.workspace._list("profiles"),
                          studies=studies, routing_values=["mfd", "d8"],
                          threshold_units="native contributing pixel count derived from m2",
                          production_resolution_m=30, maximum_cases=MAX_CASES,
                          supported_comparison="Equivalent original projected-metre CRS; north-up unrotated rectangles")

    def _effective_profile(self, profile, active, *, table_summary=None):
        checked = checked_parameters(profile)
        collection = self.workspace._get("sources", profile["source_collection_id"])
        entries = [row for row in collection["entries"] if row["id"] == profile["biophysical_source_id"]]
        _need(len(entries) == 1 and entries[0]["kind"] == "table",
              "STRUCTURAL_TABLE_SOURCE", "Retain the exact original native biophysical source table")
        table = entries[0]
        return {"models": list(active), "parameters": {name: checked[name] for name in active},
                "table": _source_identity(table),
                "table_summary": deepcopy(table_summary if table_summary is not None else profile["table_summary"])}

    def _existing_case(self, row, changed_profile, reference, reference_profile, pollutants):
        from .native_versions import comparison_versions, models_for_outputs
        if row.get("existing_run_id") is None:
            return None
        run = self.workspace.inspect_run(row["existing_run_id"])
        active = list(run_models(reference))
        _need(run["state"] == "complete" and all(name in run.get("artifacts", {}) for name in pollutants),
              "STRUCTURAL_EXISTING_RUN_INCOMPLETE", "Select an already completed original case run", row["id"])
        _need(run["selection"]["grid_id"] == row["grid_id"]
              and run["selection"]["scenario_id"] == reference["selection"]["scenario_id"]
              and run["selection"]["invest_version"] == reference["selection"]["invest_version"]
              and list(run_models(run)) == active,
              "STRUCTURAL_EXISTING_RUN_SELECTION",
              "Existing case must retain the exact selected grid, original scenario, model scope and native version", row["id"])
        profile = self.workspace._get("profiles", run["selection"]["profile_id"])
        expected = self._effective_profile(changed_profile, active, table_summary=reference_profile["table_summary"])
        actual = self._effective_profile(profile, active)
        _need(canonical(expected) == canonical(actual), "STRUCTURAL_EXISTING_RUN_PROFILE",
              "Existing run must use the exact effective native parameters, physical threshold and original table bytes", row["id"])
        versions = comparison_versions([reference, run], models_for_outputs(pollutants))
        return {"run": run, "profile": profile, "effective_profile": actual,
                "native_version_provenance": versions,
                "meaning": "Explicitly selected completed original run; no new profile, run or numerical solve is created"}

    def _plan(self, selection):
        from pyproj import CRS
        selection = _selection(selection)
        reference = self.workspace.inspect_run(selection["reference_run_id"])
        _need(reference["state"] == "complete", "REFERENCE_NOT_COMPLETE",
              "Complete the actual original reference native run before preparing structural cases")
        active = list(run_models(reference))
        pollutants = list(required_outputs(active))
        _need(all(name in reference.get("artifacts", {}) for name in pollutants),
              "REFERENCE_OUTPUTS_MISSING", "Retain every selected model's actual annual mass output")
        profile = self.workspace._get("profiles", reference["selection"]["profile_id"])
        checked_parameters(profile)
        grid = self.workspace.get_grid(reference["selection"]["grid_id"])
        context = _grid_context(self.workspace, grid)
        scenario = self.workspace._get("scenarios", reference["selection"]["scenario_id"])
        models = {}
        for model in active:
            threshold = _positive(profile[model]["threshold_flow_accumulation"], "original stream threshold")
            area = threshold * context["shape"]["pixel_area_m2"]
            _positive(area, "original physical stream-initiation area")
            models[model] = {"flow_dir_algorithm": profile[model]["flow_dir_algorithm"],
                             "threshold_flow_accumulation": threshold, "stream_area_m2": area,
                             "pixel_area_m2": context["shape"]["pixel_area_m2"]}
        cases, issues = [], []
        for row in selection["cases"]:
            try:
                current_grid = self.workspace.get_grid(row["grid_id"])
                current = _grid_context(self.workspace, current_grid)
                _need(CRS.from_user_input(context["shape"]["crs"]).equals(
                          CRS.from_user_input(current["shape"]["crs"])),
                      "STRUCTURAL_CRS_TRANSFORMATION_REQUIRED",
                      "This case needs an explicitly reviewed CRS transformation; the original-grid overlap does not warp inputs", row["id"])
                _need(set(active).issubset(selected(current_grid["spec"])), "MODEL_GRID_UNAVAILABLE",
                      "Prepare every reference model on this actual grid", row["id"])
                available = {int(code) for code in current_grid["inputs"]["NLCD"]["class_counts"]}
                _need(not (available - set(profile["table_summary"]["lucodes"])),
                      "MODEL_TABLE_COVERAGE", "The original biophysical table lacks case-grid land-cover codes", row["id"])
                family = selection["family"]
                if family in ("routing", "stream_definition"):
                    _need(row["grid_id"] == grid["id"], "STRUCTURAL_FIXED_GRID",
                          "Routing and stream-definition cases retain the original reference grid", row["id"])
                # The existing precipitation/R family remains a separate study.
                for role in ("PRECIPITATION", "R_FACTOR", "K_FACTOR"):
                    a, b = context["sources"].get(role), current["sources"].get(role)
                    _need((a is None and b is None) or (a is not None and b is not None
                          and canonical(_source_identity(a)) == canonical(_source_identity(b))),
                          "STRUCTURAL_OTHER_SOURCE_FAMILY",
                          "Keep " + role + " fixed here; its separately sourced perturbation belongs to the original source/parameter family", row["id"])
                if family == "terrain":
                    _need(canonical(context["shape"]) == canonical(current["shape"]),
                          "TERRAIN_LATTICE_CHANGED", "Terrain cases retain the exact original comparison lattice", row["id"])
                    for role in ("NLCD", "model_domain", "reporting_area"):
                        _need(canonical(_source_identity(context["sources"][role])) ==
                              canonical(_source_identity(current["sources"][role])),
                              "TERRAIN_CONTEXT_CHANGED", "Retain the original " + role + " source in the terrain family", row["id"])
                    _need(context["spec"].get("upstream_buffer_m") == current["spec"].get("upstream_buffer_m"),
                          "TERRAIN_CONTEXT_CHANGED", "Retain the original model buffer in the terrain family", row["id"])
                    _need(canonical(_source_identity(context["sources"]["DEM"])) !=
                          canonical(_source_identity(current["sources"]["DEM"])),
                          "TERRAIN_UNCHANGED", "Select the actual different original terrain source", row["id"])
                if family == "resolution":
                    _need(canonical(context["shape"]["pixel_size_m"]) != canonical(current["shape"]["pixel_size_m"]),
                          "RESOLUTION_UNCHANGED", "Select an actual original source grid with different cell sizes", row["id"])
                if family == "domain":
                    _need(canonical(context["shape"]["pixel_size_m"]) == canonical(current["shape"]["pixel_size_m"]),
                          "DOMAIN_RESOLUTION_CHANGED", "Hold original resolution fixed in the domain family", row["id"])
                    for role in ("DEM", "NLCD"):
                        _need(canonical(_source_identity(context["sources"][role])) ==
                              canonical(_source_identity(current["sources"][role])),
                              "DOMAIN_SOURCE_CHANGED", "Hold the original " + role + " input fixed in the domain family", row["id"])
                    _need(any(canonical(context["spec"].get(key)) != canonical(current["spec"].get(key))
                              for key in ("model_domain", "reporting_area", "upstream_buffer_m"))
                          or any(canonical(_source_identity(context["sources"][key])) !=
                                 canonical(_source_identity(current["sources"][key]))
                                 for key in ("model_domain", "reporting_area")),
                          "DOMAIN_UNCHANGED", "Select actual different domain or upstream context", row["id"])
                routing = row.get("routing", {})
                stream = row.get("stream_area_m2", {})
                _need(isinstance(routing, dict) and not set(routing) - set(active),
                      "ROUTING_INPUT", "Choose routing only for the selected native models", row["id"])
                _need(isinstance(stream, dict) and not set(stream) - set(active),
                      "STREAM_AREA_INPUT", "Choose stream area only for the selected native models", row["id"])
                case_models, changed_profile = {}, deepcopy(profile)
                for model in active:
                    algorithm = routing.get(model, models[model]["flow_dir_algorithm"])
                    _need(algorithm in ("mfd", "d8"), "ROUTING_UNSUPPORTED",
                          "Use the original native mfd or d8 choice", row["id"])
                    area = _positive(stream.get(model, models[model]["stream_area_m2"]), "stream-initiation area in m2")
                    pixel_area = current["shape"]["pixel_area_m2"]
                    threshold = _positive(area / pixel_area, "derived native pixel threshold")
                    effective = threshold * pixel_area
                    _need(math.isclose(effective, area, rel_tol=1e-12, abs_tol=0),
                          "STREAM_AREA_PRECISION", "Physical stream area is not representable on this grid", row["id"])
                    changed_profile[model]["threshold_flow_accumulation"] = threshold
                    changed_profile[model]["flow_dir_algorithm"] = algorithm
                    case_models[model] = {"flow_dir_algorithm": algorithm,
                        "threshold_flow_accumulation": threshold, "stream_area_m2": area,
                        "effective_stream_area_m2": effective, "pixel_area_m2": pixel_area,
                        "conversion": "requested m2 / original projected pixel area; no integer rounding"}
                if family == "routing":
                    _need(any(case_models[m]["flow_dir_algorithm"] != models[m]["flow_dir_algorithm"] for m in active),
                          "ROUTING_UNCHANGED", "Choose an actual different supported routing algorithm", row["id"])
                if family == "stream_definition":
                    _need(any(case_models[m]["stream_area_m2"] != models[m]["stream_area_m2"] for m in active),
                          "STREAM_AREA_UNCHANGED", "Choose an explicit different physical stream area", row["id"])
                changed_profile.update(checked_parameters(changed_profile))
                for field in ("id", "schema", "table_summary"):
                    changed_profile.pop(field, None)
                changed_profile["title"] = selection["title"] + ": " + row["label"]
                refs = profile["references"] if isinstance(profile["references"], list) else [profile["references"]]
                changed_profile["references"] = list({canonical(ref): ref for ref in [*refs, *selection["references"], *row["references"]]}.values())
                reused = self._existing_case(row, changed_profile, reference, profile, pollutants)
                changes = _changes(context, current, models, case_models)
                cases.append({"id": row["id"], "label": row["label"], "reason": row["reason"],
                              "references": row["references"], "grid": current, "models": case_models,
                              "profile": changed_profile, "changes": changes, "reused": reused,
                              "run_selection": {**reference["selection"], "grid_id": current["id"]},
                              "scientific_interpretation": "Named structural diagnostic; inspect all changed source/context fields before attributing a difference"})
            except (ValueError, KeyError, FileNotFoundError) as error:
                issues.append({"code": getattr(error, "code", "CASE_SOURCE_UNAVAILABLE"),
                               "case_id": row["id"], "message": str(error)})
        return {"schema": "upstate.structural-study-plan/v1", "project_id": self.workspace.project["id"],
                "selection": selection, "reference": {"run": reference, "grid": context, "profile": profile,
                    "scenario": scenario, "models": models},
                "models": active, "pollutants": pollutants, "cases": cases, "issues": issues,
                "method": structural_overlap.METHOD,
                "production_designation": {"rfp_resolution_m": 30,
                    "reference_resolution_m": context["shape"]["pixel_size_m"],
                    "reference_is_30m": all(math.isclose(x, 30, rel_tol=1e-9) for x in context["shape"]["pixel_size_m"]),
                    "meaning": "Structural diagnostic only. The original 30 m production delivery and ordinary same-grid comparison remain unchanged."},
                "support_policy": "Pairwise geographic intersection of the two original finite valid-cell footprints",
                "direction": "case minus reference"}

    def preview(self, selection):
        try:
            plan = self._plan(selection)
            return self._base(eligible=not plan["issues"], issues=plan["issues"],
                              selection=plan["selection"], plan=plan)
        except (ValueError, KeyError, FileNotFoundError) as error:
            return self._base(eligible=False, issues=[{"code": getattr(error, "code", "REFERENCE_UNAVAILABLE"),
                              "message": str(error)}], selection=_clone(selection), plan=None)

    def _operation_path(self, operation_id):
        _text(operation_id, "an original operation ID", 200)
        return self.operations / digest(operation_id) / "intent.json"

    def _origin(self, context, operation_id, action, request):
        if context is None:
            return None
        value = _clone(context)
        required = {"task_id", "operation_id", "workspace", "action", "payload", "request_sha256"}
        _need(isinstance(value, dict) and required <= set(value),
              "STRUCTURAL_CONTEXT", "Retain the complete original operator task context")
        _need(value["task_id"] == operation_id and value["action"] == action
              and digest(value["payload"]) == digest(request),
              "STRUCTURAL_CONTEXT", "Original task differs from this exact structural operation")
        _text(value["operation_id"], "original operator UUID", 100)
        _text(value["workspace"], "original logical workspace", 10000)
        _need(digest({key: value[key] for key in ("workspace", "action", "payload")}) == value["request_sha256"]
              and value.get("project_id", self.workspace.project["id"]) == self.workspace.project["id"],
              "STRUCTURAL_CONTEXT", "Original request or project identity differs")
        value["project_id"] = self.workspace.project["id"]
        return value

    def _read_operation(self, operation_id):
        path = self._operation_path(operation_id)
        if not path.exists():
            return None
        record = read_json(path)
        _need(record.get("schema") == "upstate.structural-study-operation/v1"
              and record.get("project_id") == self.workspace.project["id"]
              and record.get("operation_id") == operation_id
              and record.get("request_sha256") == digest(record["request"])
              and record.get("action") in ("structural-study.prepare", "structural-study.run", "structural-study.report"),
              "STRUCTURAL_OPERATION_CHANGED", "Original structural operation changed")
        self._origin(record.get("origin"), operation_id, record["action"], record["request"])
        plan = self._read_plan(record["study_id"])
        if record["action"] == "structural-study.prepare":
            _need(canonical(_selection(record["request"])) == canonical(plan["selection"]),
                  "STRUCTURAL_OPERATION_CHANGED", "Original preparation request no longer selects its frozen plan")
        else:
            _need(canonical(record["request"]) == canonical({"study_id": record["study_id"]}),
                  "STRUCTURAL_OPERATION_CHANGED", "Original study operation request changed")
        return record

    def _match_operation(self, record, action, request, context):
        origin = self._origin(context, record["operation_id"], action, request)
        _need(record["action"] == action and record["request_sha256"] == digest(request)
              and (context is None or canonical(origin) == canonical(record.get("origin"))),
              "STRUCTURAL_OPERATION_CONFLICT", "Resume the exact original action, request and task context")

    def _ensure_operation(self, action, request, operation_id, context, study_id):
        if operation_id is None:
            _need(context is None, "STRUCTURAL_CONTEXT", "An original task context needs its operation ID")
            return None
        self._read_plan(study_id)
        path = self._operation_path(operation_id)
        with held(self.root / ".workspace.lock"):
            previous = self._read_operation(operation_id)
            if previous:
                self._match_operation(previous, action, request, context)
                _need(action == "structural-study.prepare" or previous["study_id"] == study_id, "STRUCTURAL_OPERATION_CONFLICT",
                      "Original request is bound to another exact study")
                return previous
            origin = self._origin(context, operation_id, action, request)
            record = {"schema": "upstate.structural-study-operation/v1",
                      "project_id": self.workspace.project["id"], "operation_id": operation_id,
                      "action": action, "request": _clone(request), "request_sha256": digest(request),
                      "origin": origin, "study_id": study_id, "created_at": now()}
            atomic_json(path, record, immutable=True)
            return record

    def _receipt_path(self, record):
        names = {"structural-study.prepare": "preparation-receipt.json",
                 "structural-study.run": "execution-receipt.json",
                 "structural-study.report": "report/report.json"}
        return self.directory / record["study_id"] / names[record["action"]]

    def _verify_receipt(self, record, result):
        study = self.inspect(record["study_id"])
        _need(canonical(result) == canonical(read_json(self._receipt_path(record))),
              "STRUCTURAL_RECEIPT_CHANGED", "Original operation result differs from its first complete receipt")
        if record["action"] == "structural-study.prepare":
            _need(result.get("state") == "prepared" and result.get("id") == study["id"]
                  and canonical(result.get("plan")) == canonical(study["plan"]),
                  "STRUCTURAL_RECEIPT_CHANGED", "Original preparation result lost its frozen plan")
            keys = ("id", "label", "profile_id", "grid_id", "run_id", "run_selection")
            original_cases = [{key: row[key] for key in keys} for row in result["cases"]]
            current_cases = [{key: row[key] for key in keys} for row in study["cases"]]
            _need(canonical(original_cases) == canonical(current_cases), "STRUCTURAL_RECEIPT_CHANGED",
                  "Original prepared native cases changed")
        elif record["action"] == "structural-study.run":
            _need(result.get("state") == "complete" and result.get("id") == study["id"]
                  and canonical(result.get("plan")) == canonical(study["plan"]),
                  "STRUCTURAL_RECEIPT_CHANGED", "Original completed study result changed")
            for descriptor in result["files"].values():
                verify_file(self.directory / study["id"], descriptor)
        else:
            _need(canonical(result) == canonical(read_json(self._receipt_path(record)))
                  and result.get("project_id") == self.workspace.project["id"]
                  and result.get("study_id") == study["id"]
                  and result.get("result_sha256") == study["files"]["result"]["sha256"],
                  "STRUCTURAL_RECEIPT_CHANGED", "Original report result binding changed")
            _need(isinstance(result.get("files"), dict) and result["files"],
                  "STRUCTURAL_RECEIPT_CHANGED", "Retain the complete original report inventory")
            for descriptor in result["files"].values():
                verify_file(self.directory / study["id"] / "report", descriptor)
        return result

    def _complete_operation(self, record, result):
        if record is None:
            return result
        self._verify_receipt(record, result)
        path = self._operation_path(record["operation_id"]).parent / "result.json"
        with held(self.root / ".workspace.lock"):
            atomic_json(path, result, immutable=True)
        return result

    def operation(self, operation_id):
        record = self._read_operation(operation_id)
        if record is None:
            return self._base(operation_id=operation_id, status="NOT_FOUND", action=None,
                              request=None, origin=None, result=None)
        result_path = self._operation_path(operation_id).parent / "result.json"
        result = None
        if result_path.exists():
            result = self._verify_receipt(record, read_json(result_path))
        else:
            receipt = self._receipt_path(record)
            if receipt.exists():
                # The original effect may have completed before its queue reply
                # or after a portable snapshot retained the original intent.
                result = self._verify_receipt(record, read_json(receipt))
        return self._base(operation_id=operation_id, action=record["action"],
                          status="COMPLETE" if result is not None else "PENDING",
                          request=record["request"], origin=record.get("origin"),
                          study_id=record["study_id"], result=result)

    def _plan_file(self, study_id):
        return self.directory / identifier(study_id) / "plan.json"

    def prepare(self, selection, *, operation_id=None, context=None):
        original = _clone(selection)
        action = "structural-study.prepare"
        previous = self._read_operation(operation_id) if operation_id is not None else None
        if previous:
            self._match_operation(previous, action, original, context)
            retained = self.operation(operation_id)
            if retained["result"] is not None:
                return retained["result"]
            return self._complete_operation(previous, self._prepare_retained(previous["study_id"]))
        _need(operation_id is not None or context is None, "STRUCTURAL_CONTEXT",
              "Supply the original operation ID with its task context")
        plan = self._plan(original)
        _need(not plan["issues"], "STRUCTURAL_NOT_READY",
              "; ".join(row["message"] for row in plan["issues"]))
        plan["implementation"] = _implementation()
        study_id = digest(plan)
        with held(self.root / ".workspace.lock"):
            atomic_json(self.directory / study_id / "plan.json", plan, immutable=True)
        record = self._ensure_operation(action, original, operation_id, context, study_id)
        return self._complete_operation(record, self._prepare_retained(record["study_id"] if record else study_id))

    def _read_plan(self, study_id):
        plan = read_json(self._plan_file(study_id))
        _need(digest(plan) == study_id and plan.get("schema") == "upstate.structural-study-plan/v1"
              and plan.get("project_id") == self.workspace.project["id"],
              "STRUCTURAL_PLAN_CHANGED", "Original structural study plan changed")
        return plan

    def _validate_original_context(self, plan):
        reference = self.workspace.inspect_run(plan["reference"]["run"]["id"])
        for field in ("selection", "artifacts", "stages", "runtime"):
            _need(canonical(reference.get(field)) == canonical(plan["reference"]["run"].get(field)),
                  "STRUCTURAL_REFERENCE_CHANGED", "Original reference native result changed: " + field)
        for expected in [plan["reference"]["grid"], *[case["grid"] for case in plan["cases"]]]:
            current = _grid_context(self.workspace, self.workspace.get_grid(expected["id"]))
            _need(canonical(current) == canonical(expected), "STRUCTURAL_GRID_SOURCE_CHANGED",
                  "Original grid source, alignment or output descriptors changed")
        return reference

    def _case_profile(self, plan, study_id, case):
        profile = deepcopy(case["profile"])
        profile["structural_study"] = {"study_id": study_id, "case_id": case["id"],
            "family": plan["selection"]["family"], "reference_profile_id": plan["reference"]["profile"]["id"],
            "reference_run_id": plan["reference"]["run"]["id"], "physical_stream_area": case["models"],
            "reason": case["reason"]}
        return profile

    def _write_state(self, path, state):
        with held(self.root / ".workspace.lock"):
            atomic_json(path, state)

    def _prepared_receipt(self, plan, state):
        path = self.directory / state["id"] / "preparation-receipt.json"
        if path.exists():
            return read_json(path)
        prepared_at = state.get("prepared_at")
        _need(prepared_at is not None, "STRUCTURAL_PREPARATION_INCOMPLETE",
              "Retain the completed original native case preparation first")
        result = {**self._base(), "id": state["id"], "title": state["title"], "family": state["family"],
                  "state": "prepared", "created_at": state["created_at"], "updated_at": prepared_at,
                  "prepared_at": prepared_at, "plan": plan,
                  "cases": [{**row, "state": row["prepared_state"]} for row in state["cases"]],
                  "files": {}, "report": None}
        with held(self.root / ".workspace.lock"):
            atomic_json(path, result, immutable=True)
        return result

    def _prepare_retained(self, study_id):
        plan = self._read_plan(study_id)
        directory = self.directory / study_id
        with held(directory / ".study.lock", blocking=False):
            path = directory / "study.json"
            if path.exists():
                state = read_json(path)
                self.inspect(study_id)
            else:
                state = {"schema": SCHEMA, "project_id": self.workspace.project["id"],
                         "id": study_id, "title": plan["selection"]["title"],
                         "family": plan["selection"]["family"], "state": "preparing",
                         "created_at": now(), "updated_at": now(), "cases": [], "files": {}}
                self._write_state(path, state)
            if len(state["cases"]) < len(plan["cases"]):
                _need(canonical(plan["implementation"]) == canonical(_implementation()),
                      "STRUCTURAL_SOURCE_CHANGED",
                      "Resume this incomplete preparation with its original application source edition")
                self._validate_original_context(plan)
                existing = {row["id"]: row for row in state["cases"]}
                for case in plan["cases"]:
                    if case["id"] in existing:
                        continue
                    if case.get("reused") is not None:
                        saved = self.workspace._get("profiles", case["reused"]["profile"]["id"])
                        prepared = self.workspace.inspect_run(case["reused"]["run"]["id"])
                        self._verify_reused_case(case, prepared, saved)
                    else:
                        saved = self.workspace.save_profile(self._case_profile(plan, study_id, case))
                        prepared = self.workspace.prepare_run({**case["run_selection"], "profile_id": saved["id"]})
                    state["cases"].append({"id": case["id"], "label": case["label"], "profile_id": saved["id"],
                        "grid_id": case["grid"]["id"], "run_id": prepared["id"],
                        "run_selection": deepcopy(prepared["selection"]), "state": prepared["state"],
                        "prepared_state": prepared["state"], "reused_original_run": case.get("reused") is not None})
                    state["updated_at"] = now()
                    self._write_state(path, state)
            if "prepared_at" not in state:
                state["prepared_at"] = now()
                if state["state"] == "preparing":
                    state["state"] = "prepared"
                state["updated_at"] = state["prepared_at"]
                self._write_state(path, state)
            self.inspect(study_id)
            return self._prepared_receipt(plan, state)

    def _verify_reused_case(self, case, run, profile):
        original = case["reused"]
        _need(profile["id"] == original["profile"]["id"]
              and canonical(profile) == canonical(original["profile"])
              and run["id"] == original["run"]["id"] and run["state"] == "complete",
              "STRUCTURAL_EXISTING_RUN_CHANGED", "Selected completed original run/profile identity changed", case["id"])
        for field in ("selection", "artifacts", "stages", "runtime"):
            _need(canonical(run.get(field)) == canonical(original["run"].get(field)),
                  "STRUCTURAL_EXISTING_RUN_CHANGED", "Selected original native result changed: " + field, case["id"])

    def inspect(self, study_id):
        study_id = identifier(study_id)
        plan = self._read_plan(study_id)
        path = self.directory / study_id / "study.json"
        if not path.exists():
            return self._base(id=study_id, title=plan["selection"]["title"],
                              family=plan["selection"]["family"], state="preparing", plan=plan,
                              cases=[], files={}, report=None)
        state = read_json(path)
        _need(state.get("id") == study_id and state.get("schema") == SCHEMA
              and state.get("project_id") == self.workspace.project["id"],
              "STRUCTURAL_STATE_CHANGED", "Original structural study state changed")
        selected = {row["id"]: row for row in plan["cases"]}
        seen = set()
        expected_order = [row["id"] for row in plan["cases"]]
        _need([row["id"] for row in state["cases"]] == expected_order[:len(state["cases"])]
              and len(state["cases"]) <= len(expected_order)
              and (state["state"] not in ("prepared", "running", "complete") or len(state["cases"]) == len(expected_order)),
              "STRUCTURAL_STATE_CHANGED", "Retain the original ordered case prefix and complete prepared roster")
        for row in state["cases"]:
            _need(row["id"] in selected and row["id"] not in seen,
                  "STRUCTURAL_STATE_CHANGED", "Structural case roster changed")
            seen.add(row["id"])
            run = self.workspace.inspect_run(row["run_id"])
            case = selected[row["id"]]
            _need(canonical(run["selection"]) == canonical(row["run_selection"])
                  and row["grid_id"] == case["grid"]["id"]
                  and run["selection"]["grid_id"] == row["grid_id"]
                  and run["selection"]["profile_id"] == row["profile_id"]
                  and run["selection"]["scenario_id"] == plan["reference"]["scenario"]["id"],
                  "STRUCTURAL_NATIVE_CHANGED", "A saved case no longer selects its original native run")
            actual_profile = self.workspace._get("profiles", row["profile_id"])
            if case.get("reused") is not None:
                self._verify_reused_case(case, run, actual_profile)
            else:
                expected_profile = self._case_profile(plan, study_id, case)
                profile_body = {key: value for key, value in actual_profile.items()
                                if key not in ("id", "schema", "table_summary")}
                _need(canonical(expected_profile) == canonical(profile_body)
                      and canonical(actual_profile["table_summary"]) == canonical(plan["reference"]["profile"]["table_summary"]),
                      "STRUCTURAL_NATIVE_CHANGED", "A saved case no longer uses its exact planned native profile")
            expected_selection = {**case["run_selection"], "profile_id": row["profile_id"]}
            _need(canonical(expected_selection) == canonical(run["selection"]),
                  "STRUCTURAL_NATIVE_CHANGED", "A saved case run selection differs from its frozen plan")
        if state["state"] == "complete":
            for descriptor in state["files"].values():
                verify_file(path.parent, descriptor)
        report_path = path.parent / "report" / "report.json"
        report = None
        if report_path.exists():
            from .structural_report import read as read_report
            report = read_report(self.workspace, study_id,
                                 result_sha256=state.get("files", {}).get("result", {}).get("sha256"))
        return {**state, "plan": plan, "report": report}

    def _execute(self, study_id, *, progress=None, run_executor=None):
        from .native_versions import comparison_versions, models_for_outputs
        study_id = identifier(study_id)
        self._prepare_retained(study_id)
        directory = self.directory / study_id
        with held(directory / ".study.lock", blocking=False):
            state = self.inspect(study_id)
            plan = state.pop("plan")
            state.pop("report", None)
            if state["state"] == "complete":
                return self._execution_receipt(study_id)
            _need(canonical(plan["implementation"]) == canonical(_implementation()), "STRUCTURAL_SOURCE_CHANGED",
                  "Resume this original study with its retained calculation source edition")
            path = directory / "study.json"
            try:
                state.update(state="running", updated_at=now())
                state.pop("error", None)
                self._write_state(path, state)
                reference = self._validate_original_context(plan)
                runs = []
                for index, case in enumerate(state["cases"]):
                    actual = self.workspace.inspect_run(case["run_id"])
                    if actual["state"] != "complete":
                        if progress:
                            progress({"phase": "native", "case_id": case["id"], "run_id": case["run_id"],
                                      "case_index": index, "total_cases": len(state["cases"])})
                        state["active_run_id"] = case["run_id"]
                        self._write_state(path, state)
                        if run_executor is None:
                            actual = self.workspace.run(case["run_id"])
                        else:
                            actual = run_executor(case["run_id"], progress=progress)
                        _need(actual["id"] == case["run_id"], "STRUCTURAL_NATIVE_CHANGED",
                              "Native supervisor returned another run", case["id"])
                    state.pop("active_run_id", None)
                    actual = self.workspace.inspect_run(case["run_id"])
                    case["state"] = actual["state"]
                    _need(actual["state"] == "complete", "STRUCTURAL_NATIVE_INCOMPLETE",
                          "The original native case did not complete", case["id"])
                    runs.append(actual)
                    state["updated_at"] = now()
                    self._write_state(path, state)
                versions = comparison_versions([reference, *runs], models_for_outputs(plan["pollutants"]))
                outputs = []
                case_plans = {row["id"]: row for row in plan["cases"]}
                for case, run in zip(state["cases"], runs):
                    comparisons = {}
                    for pollutant in plan["pollutants"]:
                        a_desc, b_desc = reference["artifacts"][pollutant], run["artifacts"][pollutant]
                        a = self.root / "runs" / reference["id"] / a_desc["path"]
                        b = self.root / "runs" / run["id"] / b_desc["path"]
                        output = directory / "overlap" / case["id"] / pollutant
                        compared = structural_overlap.compare(a, b, output, pollutant=pollutant,
                            reference_file=a_desc, case_file=b_desc, progress=progress)
                        comparisons[pollutant] = {**compared,
                            "output_directory": output.relative_to(self.root).as_posix(),
                            "result_file": describe_file(self.root, output / "result.json"),
                            "diagnostic_file": describe_file(self.root, verify_file(output, compared["diagnostic"]),
                                bands=compared["diagnostic"]["bands"], interpretation=compared["diagnostic"]["interpretation"])}
                        state["files"][case["id"] + "__" + pollutant + "__result"] = describe_file(directory, output / "result.json")
                        state["files"][case["id"] + "__" + pollutant + "__diagnostic"] = describe_file(
                            directory, verify_file(output, compared["diagnostic"]),
                            bands=compared["diagnostic"]["bands"], interpretation=compared["diagnostic"]["interpretation"])
                        state["updated_at"] = now()
                        self._write_state(path, state)
                    chosen = case_plans[case["id"]]
                    outputs.append({"id": case["id"], "label": case["label"], "run": run,
                                    "grid": chosen["grid"], "models": chosen["models"], "reused": chosen.get("reused"),
                                    "reason": chosen["reason"], "references": chosen["references"],
                                    "changes": chosen["changes"], "comparisons": comparisons,
                                    "scientific_interpretation": chosen["scientific_interpretation"]})
                result = {"schema": "upstate.structural-study-result/v1",
                    "id": study_id, "project_id": self.workspace.project["id"],
                    "title": plan["selection"]["title"], "purpose": plan["selection"]["purpose"],
                    "family": plan["selection"]["family"], "references": plan["selection"]["references"],
                    "selection": plan["selection"], "reference": plan["reference"],
                    "models": plan["models"], "pollutants": plan["pollutants"],
                    "production_designation": plan["production_designation"],
                    "direction": plan["direction"], "support_policy": plan["support_policy"],
                    "method": plan["method"], "implementation": plan["implementation"],
                    "native_version_provenance": versions, "cases": outputs,
                    "interpretation": "Inspect changed factors and pair-specific geographic support before scientific conclusions. Differences with multiple changed factors do not isolate a cause."}
                atomic_json(directory / "result.json", result, immutable=True)
                state["files"]["result"] = describe_file(directory, directory / "result.json")
                state.update(state="complete", updated_at=now(), completed_at=now())
                self._write_state(path, state)
            except BaseException as error:
                state.update(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                             updated_at=now(), error={"type": type(error).__name__, "message": str(error)})
                try:
                    self._write_state(path, state)
                except BaseException as journal_error:
                    if hasattr(error, "add_note"):
                        error.add_note("Original failure retained; structural state journal also failed: " + str(journal_error))
                raise
        return self._execution_receipt(study_id)

    def native_case_context(self, study_id, run_id):
        study = self.inspect(study_id)
        rows = [row for row in study["cases"] if row["run_id"] == identifier(run_id)]
        _need(len(rows) == 1, "STRUCTURAL_NATIVE_BINDING", "Select an original prepared structural case run")
        row = rows[0]
        case = next(item for item in study["plan"]["cases"] if item["id"] == row["id"])
        return {"schema": "upstate.structural-native-context/v1",
                "project_id": self.workspace.project["id"], "study_id": study["id"], "run_id": run_id,
                "case_id": row["id"], "case": case, "run_selection": row["run_selection"],
                "reference_run_id": study["plan"]["reference"]["run"]["id"],
                "plan_sha256": digest(study["plan"]), "implementation": study["plan"]["implementation"]}

    def record_interruption(self, study_id, error):
        directory = self.directory / identifier(study_id)
        with held(directory / ".study.lock", blocking=False):
            state = self.inspect(study_id)
            state.pop("plan")
            state.pop("report", None)
            if state["state"] != "complete":
                state.update(state="interrupted", updated_at=now(),
                             error={"type": type(error).__name__, "code": getattr(error, "code", None),
                                    "message": str(error)})
                self._write_state(directory / "study.json", state)
        return self.inspect(study_id)

    def _execution_receipt(self, study_id):
        path = self.directory / study_id / "execution-receipt.json"
        if path.exists():
            value = read_json(path)
            for descriptor in value["files"].values():
                verify_file(path.parent, descriptor)
            return value
        study = self.inspect(study_id)
        _need(study["state"] == "complete", "STRUCTURAL_NOT_COMPLETE", "Complete the original structural study")
        study["report"] = None
        with held(self.root / ".workspace.lock"):
            atomic_json(path, study, immutable=True)
        return study

    def execute(self, study_id, *, progress=None, run_executor=None, operation_id=None, context=None):
        study_id = identifier(study_id)
        record = self._ensure_operation("structural-study.run", {"study_id": study_id},
                                        operation_id, context, study_id)
        if record:
            retained = self.operation(operation_id)
            if retained["result"] is not None:
                return retained["result"]
        return self._complete_operation(record, self._execute(study_id, progress=progress,
                                                              run_executor=run_executor))

    def result(self, study_id):
        study = self.inspect(study_id)
        _need(study["state"] == "complete", "STRUCTURAL_NOT_COMPLETE", "Complete the actual original native comparison first")
        directory = self.directory / study["id"]
        return read_json(verify_file(directory, study["files"]["result"]))

    def report(self, study_id, *, operation_id=None, context=None):
        # The maintained human export module owns HTML/CSV/figures and editable
        # handover; it consumes these original results without recalculation.
        from .structural_report import build
        study_id = identifier(study_id)
        record = self._ensure_operation("structural-study.report", {"study_id": study_id},
                                        operation_id, context, study_id)
        if record:
            retained = self.operation(operation_id)
            if retained["result"] is not None:
                return retained["result"]
        study = self.inspect(study_id)
        return self._complete_operation(record, build(self.workspace, study, self.result(study_id)))


def verify_all(workspace):
    model = StructuralStudies(workspace)
    studies = []
    for path in sorted(model.directory.glob("*/plan.json")):
        studies.append(model.inspect(path.parent.name))
    operations = 0
    for path in sorted(model.operations.glob("*/intent.json")):
        value = read_json(path)
        _need(path.parent.name == digest(value["operation_id"]), "STRUCTURAL_OPERATION_CHANGED",
              "Retained structural operation path changed")
        model.operation(value["operation_id"])
        operations += 1
    return {"schema": SCHEMA, "project_id": workspace.project["id"],
            "studies": len(studies), "operations": operations,
            "completed": sum(row["state"] == "complete" for row in studies)}


verify_workspace = verify_all
