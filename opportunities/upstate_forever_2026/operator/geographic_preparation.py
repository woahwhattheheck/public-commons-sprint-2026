"""Geographic headwaters choices on the original operator queue and Workspace.

The geographic producer owns source geometry, simulated inputs, grid, profiles,
scenarios and prepared runs. This adapter retains the operator selection and
presents its original preview, saved case and complete source files.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import importlib.metadata
import json
from pathlib import Path

from model.common import atomic_json, describe_file, digest, file_digest, held, identifier, now, read_json, relative_file
from model import geographic_headwaters as native
from source_preparation import SourcePreparation

ACTIONS = frozenset({"geography.prepare", "geography.compose"})
METHOD = {
    "id": "geographic-headwaters",
    "title": "Upper Savannah geographic model case",
    "description": "Select original watershed polygons, the South Carolina reporting boundary and actual utility protection areas. Preview their distinct extents at 30 m, then prepare the native baseline, restoration, matched control and parameter study.",
    "inputs": [
        {"name": "huc_polygons", "label": "Complete original HUC polygon edition", "required": True, "kinds": ["vector"],
         "help": "Choose the retained whole upstream polygon source; the original topology determines contributing HUCs."},
        {"name": "reporting_boundary", "label": "Original South Carolina reporting boundary", "required": True, "kinds": ["vector"],
         "help": "Choose the original reporting geometry, with its exact attribute selection below."},
        {"name": "utility_focus", "label": "Original utility protection polygons", "required": True, "kinds": ["vector"],
         "help": "Use the published source-area polygons. Additional retained utility sources can be included below."},
    ],
    "options": [
        {"name": "question", "label": "Study question", "type": "textarea", "required": True},
        {"name": "reporting_huc12s", "label": "Reporting HUC12 identifiers", "type": "textarea", "required": True,
         "help": "One original twelve-digit HUC per line. Use Select watersheds above to choose from the retained topology."},
        {"name": "huc_field", "label": "Original HUC identifier field", "type": "text", "required": True, "default": "huc12"},
        {"name": "huc_layer", "label": "HUC source layer (when applicable)", "type": "text"},
        {"name": "huc_where", "label": "HUC source attribute selection", "type": "textarea", "default": "{}",
         "help": "Exact original field/value JSON. Empty selects the complete original source."},
        {"name": "reporting_layer", "label": "Reporting boundary layer", "type": "text"},
        {"name": "reporting_where", "label": "Reporting boundary attribute selection", "type": "textarea", "default": "{}",
         "help": "Use original property spelling and value types; for Planning Basins select its original Upper Savannah Basin value."},
        {"name": "reporting_boundary_description", "label": "Reporting boundary meaning", "type": "textarea", "required": True},
        {"name": "utility_layer", "label": "Utility source layer", "type": "text"},
        {"name": "utility_where", "label": "Utility source attribute selection", "type": "textarea", "default": "{}"},
        {"name": "additional_utility_focus", "label": "Additional original utility source selections", "type": "textarea", "default": "[]",
         "help": "Optional complete source_collection_id/source_id selectors with layer, part and exact where values. Original source identifiers are available in Sources."},
        {"name": "intakes", "label": "Original intake point selections", "type": "textarea", "default": "[]",
         "help": "Optional original point source_collection_id/source_id selectors, with layer, part and exact where values. These remain distinct from utility protection polygons."},
        {"name": "utility_label", "label": "Utility focus description", "type": "text", "required": True},
        {"name": "seed", "label": "Deterministic simulated field seed", "type": "integer", "default": 20261013, "min": 0, "max": 4294967295},
        {"name": "matching_method", "label": "Control matching method", "type": "text",
         "choices": [{"value": "", "label": "Original legacy selection"}, {"value": "greedy", "label": "Greedy"}, {"value": "exact_monge", "label": "Exact Monge"}],
         "help": "Blank preserves the original selection. An explicit method belongs to a new scientific edition; the native producer validates its exact method and byte budget."},
        {"name": "max_working_bytes", "label": "Matching working-memory budget (bytes)", "type": "integer", "min": 1, "max": 9007199254740991,
         "help": "Optional positive integer bytes with an explicit method. The native default is 1073741824; the exact four-anchor preset declares 2147483648."},
        {"name": "corridor_width_m", "label": "Corridor buffer on each side (m)", "type": "number", "default": 90, "min": 0,
         "help": "Positive per-side buffer: 90 m means a nominal 180 m total corridor. The prepared source retains the exact assumption and changed-cell footprint."},
    ],
}


def _object_text(value, name, expected):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError) as error:
            raise ValueError(name + " needs complete valid JSON") from error
    if not isinstance(value, expected):
        raise ValueError(name + " has the wrong JSON type")
    return value


def _selector(value, options, prefix):
    if not isinstance(value, dict) or not value.get("collection_id") or not value.get("source_id"):
        raise ValueError("Choose an already imported original vector source. Receive new complete sources in Original sources first.")
    if set(value) - {"collection_id", "source_id", "companion_path"}:
        raise ValueError("Use the retained source collection and original member")
    result = {"source_collection_id": value["collection_id"], "source_id": value["source_id"]}
    if value.get("companion_path"):
        result["part"] = value["companion_path"]
    if options.get(prefix + "_layer"):
        result["layer"] = options[prefix + "_layer"]
    where = _object_text(options.get(prefix + "_where", "{}"), prefix + " attributes", dict)
    if where:
        result["where"] = where
    return result


def selection(payload):
    if not isinstance(payload, dict) or payload.get("method") != METHOD["id"]:
        raise ValueError("Choose the original geographic headwaters preparation")
    if payload.get("import_sources") is False:
        raise ValueError("A native geographic case retains its prepared original source edition in this study")
    if set(payload) - {"method", "inputs", "options", "title", "import_sources", "expected_preview_sha256", "producer_sha256"}:
        raise ValueError("The geographic request contains an unsupported field")
    inputs, options = payload.get("inputs"), payload.get("options")
    if not isinstance(inputs, dict) or not isinstance(options, dict):
        raise ValueError("Retain the original source and assumption choices")
    if set(inputs) - {field["name"] for field in METHOD["inputs"]} or set(options) - {field["name"] for field in METHOD["options"]}:
        raise ValueError("The geographic request contains an unsupported source or assumption")
    hucs = options.get("reporting_huc12s", "")
    if not isinstance(hucs, str):
        raise ValueError("Choose the original HUC identifiers")
    hucs = [part.strip() for part in hucs.replace(",", "\n").splitlines() if part.strip()]
    additional = _object_text(options.get("additional_utility_focus", "[]"), "Additional utility sources", list)
    seed = options.get("seed", 20261013)
    if isinstance(seed, str):
        if not seed.isdigit():
            raise ValueError("The simulation seed must be a whole nonnegative integer")
        seed = int(seed)
    width = options.get("corridor_width_m", 90)
    if isinstance(width, str):
        try:
            width = float(width)
        except ValueError as error:
            raise ValueError("The corridor width must be numeric") from error
    matching = {}
    if options.get("matching_method") not in (None, ""):
        if options["matching_method"] not in ("greedy", "exact_monge"):
            raise ValueError("Choose greedy or exact_monge, or leave the original selection blank")
        matching["matching_method"] = options["matching_method"]
    if options.get("max_working_bytes") not in (None, ""):
        budget = options["max_working_bytes"]
        if isinstance(budget, str) and budget.isdigit():
            budget = int(budget)
        if type(budget) is not int or not 0 < budget <= 9007199254740991:
            raise ValueError("Matching memory must be a positive exactly representable integer byte count")
        matching["max_working_bytes"] = budget
    return native.normalize({
        "schema": native.SCHEMA, "title": payload.get("title", ""),
        "question": options.get("question", ""), "reporting_huc12s": hucs,
        "huc_polygons": _selector(inputs.get("huc_polygons"), options, "huc"),
        "huc_field": options.get("huc_field", "huc12"),
        "reporting_boundary": _selector(inputs.get("reporting_boundary"), options, "reporting"),
        "reporting_boundary_description": options.get("reporting_boundary_description", ""),
        "utility_focus": [_selector(inputs.get("utility_focus"), options, "utility"), *additional],
        "utility_label": options.get("utility_label", ""),
        "intakes": _object_text(options.get("intakes", "[]"), "Original intake point selections", list),
        "seed": seed, "corridor_width_m": width, **matching,
    })


class GeographyPreparation(SourcePreparation):
    @staticmethod
    def _record_path(workspace, task_id):
        return workspace.root / "geography-operations" / identifier(task_id) / "operation.json"

    def _native_root(self, workspace, task_id):
        return self.operator.root / "geography-operations" / str(workspace.project["id"]) / identifier(task_id)

    def _records(self, workspace):
        return [read_json(path) for path in sorted((workspace.root / "geography-operations").glob("*/operation.json"))]

    @staticmethod
    def _cases(workspace):
        cases = []
        for path in sorted((workspace.root / "geographic-headwaters").glob("*/prepared.json")):
            value = read_json(path)
            if value.get("project_id") != workspace.project["id"] or value.get("id") != path.parent.name:
                raise ValueError("A saved geographic case changed its original identity")
            cases.append(value)
        return cases

    def catalog(self, workspace):
        ws = self.operator.ws(workspace)
        value = super().catalog(workspace)
        original = native.catalog(ws)
        value["methods"] = [deepcopy(METHOD)]
        value["sources"] = [{
            "collection_id": row["source_collection_id"], "source_id": row["source_id"],
            "title": row["title"], "kind": "vector", "vintage": row.get("vintage"),
            "selector": {"collection_id": row["source_collection_id"], "source_id": row["source_id"]},
            "companions": [{"path": member.get("view_path", member["filename"]), "title": member["filename"],
                           "kind": "vector", "selector": {"collection_id": row["source_collection_id"],
                           "source_id": row["source_id"], "companion_path": member.get("view_path", member["filename"])}}
                          for member in row.get("companions", [])
                          if Path(member["filename"]).suffix.lower() in {".gpkg", ".geojson", ".json", ".gz", ".shp"}],
        } for row in original["vectors"]]
        value.update(roots=[], uploads=[], bundled=[], native_cases=self._cases(ws),
                     producer_sha256=file_digest(Path(native.__file__)), project_id=ws.project["id"])
        # This is the same exact fixed topology read by the geographic producer.
        # No polygon, downstream membership or source property is reinterpreted.
        _, nodes = native._topology()
        value["watersheds"] = [{"huc12": key, "name": row.get("name", row.get("Name", "")),
                                "downstream_huc12": row.get("tohuc")} for key, row in sorted(nodes.items())]
        return value

    def _preview(self, workspace, payload):
        value = native.preview(workspace, selection(payload))
        # Pin the same complete numerical source family and installed geographic
        # runtime that the native producer uses to identify a prepared edition.
        from source_tools.geographic_matched_control import _implementation_snapshot
        control_sources = _implementation_snapshot()
        implementation = {
            "control_source_closure": {name: {"bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest()}
                for name, body in control_sources.items()},
            "geographic_runtime": {name: importlib.metadata.version(name)
                for name in ("numpy", "rasterio", "fiona", "shapely", "pyproj")},
        }
        basis = {"preview": value, "producer_sha256": file_digest(Path(native.__file__)),
                 "implementation": implementation}
        return {**basis, "preview_sha256": digest(basis)}

    def _case_downloads(self, workspace_key, workspace, case):
        directory = workspace.root / "geographic-headwaters" / identifier(case["id"])
        names = ["prepared.json", "inputs/geographic-selection.json", "inputs/geographic-binding.json",
                 "inputs/assumptions.json", "inputs/input-receipt.json", "inputs/sources.json", "inputs/biophysical.csv"]
        return [self.operator._ticket(workspace_key, directory / name,
                describe_file(workspace.root, directory / name), name)
                for name in names if (directory / name).is_file()]

    def read(self, workspace, operation, value=None):
        ws, value = self.operator.ws(workspace), value or {}
        if operation == "catalog":
            return self.catalog(workspace)
        if operation == "preview":
            return self._preview(ws, value.get("payload", value))
        if operation == "case":
            key = identifier(value.get("case_id"))
            found = next((item for item in self._cases(ws) if item["id"] == key), None)
            if found is None:
                self._fail("GEOGRAPHY_CASE", "Choose a saved geographic case in this study.", 404)
            return {"case": found, "_downloads": self._case_downloads(workspace, ws, found)}
        if operation not in {"progress", "result"}:
            self._fail("GEOGRAPHY_READ", "Choose the geographic catalogue, preview, saved case or operation.")
        task_id = identifier(value.get("task_id"))
        path = self._record_path(ws, task_id)
        if not path.exists():
            task = self.operator.task(task_id)
            if task.get("workspace") != workspace or task.get("action") not in ACTIONS:
                self._fail("GEOGRAPHY_PROJECT", "Choose an original geographic operation in this study.", 404)
            queued = {"task_id": task_id, "state": task["state"], "stage": task["state"],
                      "elapsed_seconds": 0, "updated_at": task["created_at"], "error": task.get("error"),
                      "outputs": task.get("result"), "log_tail": []}
            return queued if operation == "progress" else {"workspace_key": workspace, "task_id": task_id,
                "progress": queued, "result": task.get("result"), "stages": []}
        return super().read(workspace, operation, value)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        ws = self.operator.ws(task["workspace"])
        path = self._record_path(ws, task["id"])
        if path.exists():
            record = read_json(path)
            task["_geography_preparation"] = self._progress(record, task)
            task.setdefault("_downloads", []).extend(self._record_downloads(
                task["workspace"], ws, path, record.get("result") or {}))
        return task

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            self._fail("GEOGRAPHY_ACTION", "Choose a geographic preparation or source composition.")
        ws = self.operator.ws(task["workspace"])
        path, root = self._record_path(ws, task["id"]), self._native_root(ws, task["id"])
        root.mkdir(parents=True, exist_ok=True)
        with held(root / ".operation.lock", blocking=False):
            record = read_json(path) if path.exists() else {
                "schema": "upstate.geography-operation/v1", "task_id": task["id"],
                "project_id": ws.project["id"], "action": task["action"],
                "request_sha256": task["request_sha256"], "method": task["payload"].get("method"),
                "title": task["payload"].get("title") or "Upper Savannah geographic inputs",
                "created_at": now(), "updated_at": now(), "state": "queued", "stages": [],
            }
            if record["request_sha256"] != task["request_sha256"] or record["project_id"] != ws.project["id"]:
                raise ValueError("This original geographic operation belongs to another selection")
            record["attempt"] = len(task.get("attempts", [])) or 1
            if record["state"] == "complete":
                return record["result"]
            atomic_json(path, record)
            try:
                if task["action"] == "geography.compose":
                    result = self._compose(ws, task, root, record)
                else:
                    value = task["payload"]
                    preview = self._stage(ws, record, "Reading original geographic coverage", lambda: self._preview(ws, value))
                    if value.get("expected_preview_sha256") and value["expected_preview_sha256"] != preview["preview_sha256"]:
                        raise ValueError("The original geographic preview changed; retain this request and review the current source selection.")
                    if value.get("producer_sha256") and value["producer_sha256"] != preview["producer_sha256"]:
                        raise ValueError("The selected geographic producer changed before preparation.")
                    selection_path = path.parent / "selection.json"
                    atomic_json(selection_path, {"schema": "upstate.geography-operator-selection/v1",
                        "request_sha256": task["request_sha256"], "payload": value, **preview}, immutable=True)
                    # A complete original native preparation is idempotent by its
                    # own scientific identity and remains in this same Workspace.
                    prepared = self._stage(ws, record, "Preparing original geographic model inputs and native cases",
                                          lambda: native.prepare(ws, preview["preview"]["selection"]))
                    native_root = ws.root / "geographic-headwaters" / identifier(prepared["id"])
                    result = self._finish(ws, task, native_root, record, native_root / "inputs" / "sources.json")
                    result.update(native_case=prepared, geographic_case_id=prepared["id"],
                                  summary=self._summary(preview, prepared))
                    for name, label in [("prepared.json", "Prepared native case"),
                                        ("inputs/geographic-binding.json", "Original geographic binding"),
                                        ("inputs/assumptions.json", "Declared physical and model assumptions"),
                                        ("inputs/input-receipt.json", "Complete original input receipt")]:
                        result["documents"].append(describe_file(ws.root, native_root / name, label=label))
                record.update(state="complete", stage="complete", result=result, ended_at=now(), updated_at=now())
                record.pop("error", None)
                atomic_json(path, record)
                return result
            except BaseException as error:
                record.update(state="failed", ended_at=now(), updated_at=now(),
                              error={"code": type(error).__name__, "message": str(error) or type(error).__name__})
                atomic_json(path, record)
                raise

    @staticmethod
    def _summary(preview, prepared):
        geo = prepared["geography"]
        grid, areas = geo["grid"], geo["areas_ha"]
        inputs = prepared.get("input_summary", {})
        return {"title": "Prepared geographic study",
                "rows": [["Native state", prepared["state"]], ["Grid", str(grid["width"]) + " × " + str(grid["height"])],
                         ["Resolution", str(grid["resolution_m"]) + " m"], ["Original model-domain HUCs", len(geo["model_domain_huc12s"])],
                         ["Reporting HUCs", len(geo["reporting_huc12s"])], ["Upstream HUCs", len(geo["upstream_huc12s"])],
                         ["Model domain (ha)", areas["model_domain"]], ["SC reporting area (ha)", areas["reporting_area"]],
                         ["Utility/reporting intersection (ha)", areas["utility_reporting_intersection"]],
                         ["Declared matching method", prepared["selection"].get("matching_method", "Original legacy selection")],
                         ["Declared matching budget (bytes)", prepared["selection"].get("max_working_bytes", "Original legacy selection")],
                         ["Changed cells", inputs.get("changed_cells")], ["Prepared native runs", 1 + len(prepared["alternative_run_ids"])]],
                "details": {"Original geographic sources and support": geo, "Input quantities and control": inputs,
                            "Complete authored selection": prepared["selection"],
                            "Prepared original run identities": [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]}}
