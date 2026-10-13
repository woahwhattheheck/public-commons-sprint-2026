"""Receiving-water operations through the original operator task and file APIs."""
from __future__ import annotations
from model.common import atomic_json, describe_file, held, identifier, now, read_json
from model import receiving_waters

ACTIONS = frozenset({
    "receiving.water.plan", "receiving.water.profile", "receiving.water.analyze",
    "receiving.water.catalog",
})
READS = frozenset({"catalog", "plan", "analysis", "designation-catalog"})


class ReceivingWaterActions:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    @staticmethod
    def _plan_summary(row):
        return {
            "id": row["id"], "title": row["title"], "state": row["state"],
            "created_at": row["created_at"], "receptor_count": len(row["receptors"]),
            "families": sorted({item["family"] for item in row["receptors"]}),
            "source_count": len({
                (item["source_collection_id"], item["source_id"], item["body_sha256"])
                for item in row["identity"]["source_identities"]
            }),
        }

    @staticmethod
    def _analysis_summary(row):
        names = (
            "id", "title", "state", "created_at", "completed_at", "plan_id",
            "baseline_run_id", "alternative_run_ids", "quantity_scope", "pollutants",
            "completed_subjects", "total_subjects", "error",
        )
        return {name: row.get(name) for name in names}

    @staticmethod
    def _catalog_summary(row):
        return {name: row.get(name) for name in (
            "id", "title", "state", "created_at", "as_of", "record_count",
            "selected_count", "prepared_plan_ids", "error",
        )}

    def snapshot(self, workspace):
        ws = self.operator.ws(workspace)
        return {
            "receiving_water_catalogs": [
                self._catalog_summary(read_json(path))
                for path in sorted((ws.root / "receiving-water-catalogs").glob("*/operator-catalog.json"))
            ],
            "receiving_water_plans": [
                self._plan_summary(row) for row in receiving_waters.list_plans(ws)
            ],
            "receiving_water_analyses": [
                self._analysis_summary(row) for row in receiving_waters.list_analyses(ws)
            ],
        }

    def read(self, workspace, operation, value=None):
        ws = self.operator.ws(workspace)
        value = value or {}
        if operation == "catalog":
            overview = ws.overview()
            try:
                from source_tools.receiving_water_catalog import PROFILES, FIELD_ALIASES, CLASS_CODES
            except ModuleNotFoundError as error:
                if error.name not in ("source_tools", "source_tools.receiving_water_catalog"):
                    raise
                compiler_profiles = []
            else:
                compiler_profiles = [
                    {"id": key, **row,
                     "required_fields": ["classification"] if row["kind"] == "classified_water" else [],
                     "field_aliases": FIELD_ALIASES, "class_codes": list(CLASS_CODES)}
                    for key, row in PROFILES.items()
                ]
            return {
                "workspace_key": workspace, "project": ws.project, **self.snapshot(workspace),
                "sources": [
                    {"id": row["id"], "title": row["title"], "captured_at": row.get("captured_at"),
                     "entries": [
                         {key: entry.get(key) for key in
                          ("id", "title", "kind", "role", "vintage", "uri", "layer", "metadata")}
                         for entry in row["entries"] if entry["kind"] == "vector"
                     ]}
                    for row in overview["sources"]
                ],
                "grids": [
                    {"id": row["id"], "state": row["state"], "spec": row["spec"],
                     "grid": row["grid"]} for row in overview["grids"]
                ],
                "runs": [
                    {"id": row["id"], "state": row["state"], "selection": row["selection"]}
                    for row in overview["runs"]
                ],
                "profiles": overview["profiles"], "scenarios": overview["scenarios"],
                "families": list(receiving_waters.FAMILIES),
                "relationships": ["upstream_huc", "source_area", "geometric_context"],
                "quantity_scopes": ["reporting", "model_domain"],
                "compiler_profiles": compiler_profiles,
            }
        if operation == "designation-catalog":
            key = identifier(value.get("catalog_id"))
            directory = ws.root / "receiving-water-catalogs" / key
            result = read_json(directory / "operator-catalog.json")
            if result.get("id") != key:
                raise ValueError("The retained receiving-water catalog identity changed")
            catalog = read_json(directory / "receiving-water-catalog.json")
            result["catalog"] = {
                **catalog,
                "records": [
                    {name: field for name, field in row.items() if name != "geometry"}
                    for row in catalog["records"]
                ],
            }
            filename = "operator-catalog.json"
        elif operation == "plan":
            key = identifier(value.get("plan_id"))
            result = receiving_waters.inspect_plan(ws, key, verify=False)
            directory = ws.root / "receiving-water-plans" / key
            filename = "plan.json"
        elif operation == "analysis":
            key = identifier(value.get("analysis_id"))
            result = receiving_waters.inspect(ws, key, verify=False)
            directory = ws.root / "receiving-water-analyses" / key
            filename = "analysis.json"
        else:
            raise self.Fault("RECEIVING_WATER_READ", "Choose a receiving-water view.", 404)
        downloads = self.operator._files(workspace, result, directory)
        downloads.append(self.operator._ticket(
            workspace, directory / filename, describe_file(directory, directory / filename),
            "Complete receiving-water " + operation,
        ))
        return {**result, "_downloads": downloads}

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        value = task["payload"]
        action = task["action"]
        if action == "receiving.water.catalog":
            from source_tools.receiving_water_catalog import compile_catalog, write_catalog
            selection = value.get("selection", value)
            vintage = value.get("prepare_vintage", "effective")
            if vintage not in ("effective", "proposed", None):
                raise ValueError("Choose effective or proposed designation vintage")
            compiled = compile_catalog(ws, selection)
            catalog = compiled["catalog"]
            key = identifier(catalog["id"])
            directory = ws.root / "receiving-water-catalogs" / key
            record_path = directory / "operator-catalog.json"
            with held(ws.root / ".workspace.lock"):
                previous = read_json(record_path) if record_path.is_file() else {}
                if previous and previous.get("id") != key:
                    raise ValueError("The retained source catalog belongs to another selection")
                write_catalog(compiled, directory)
                result = {
                    "id": key, "title": catalog.get("title") or selection.get("title") or "Receiving-water source catalog",
                    "state": "compiled", "created_at": previous.get("created_at") or now(), "as_of": selection.get("as_of"),
                    "record_count": len(catalog["records"]),
                    "selected_count": sum(bool(row.get("selected")) for row in catalog["records"]),
                    "prepared_plan_ids": dict(previous.get("prepared_plan_ids", {})), "files": {},
                }
                for name in (
                    "receiving-water-catalog.json", "receiving-water-records.geojson",
                    "prepare-effective.json", "prepare-proposed.json",
                    "receiving-water-index.csv", "catalog-files.json",
                ):
                    if (directory / name).is_file():
                        result["files"][name] = describe_file(directory, directory / name)
                atomic_json(record_path, result)
            try:
                if vintage and compiled["plans"][vintage].get("receptors"):
                    plan = receiving_waters.prepare(ws, compiled["plans"][vintage])
                    result["prepared_plan_ids"][vintage] = plan["id"]
                result["state"] = "complete"
                with held(ws.root / ".workspace.lock"):
                    atomic_json(record_path, result)
                return self._catalog_summary(result)
            except BaseException as error:
                result.update(state="failed", error={"type": type(error).__name__, "message": str(error)})
                with held(ws.root / ".workspace.lock"):
                    atomic_json(record_path, result)
                raise
        if action == "receiving.water.plan":
            result = receiving_waters.prepare(ws, value.get("selection", value))
            return self._plan_summary(result)
        if action == "receiving.water.profile":
            result = receiving_waters.prepare_receptor_spec(
                ws, value["receptor_spec"], grid_id=value.get("grid_id"),
            )
            return self._plan_summary(result)
        if action == "receiving.water.analyze":
            result = receiving_waters.analyze(ws, value.get("selection", value))
            return self._analysis_summary(result)
        raise self.Fault("RECEIVING_WATER_ACTION", "Choose a receiving-water operation.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = task["result"]
        kind = ("analysis" if task["action"] == "receiving.water.analyze"
                else "designation-catalog" if task["action"] == "receiving.water.catalog" else "plan")
        field = "catalog_id" if kind == "designation-catalog" else kind + "_id"
        original = self.read(task["workspace"], kind, {field: result["id"]})
        return {
            **task, "_receiving_water": {"kind": kind, "id": result["id"]},
            "_downloads": original["_downloads"],
        }
