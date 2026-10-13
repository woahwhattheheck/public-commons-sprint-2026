"""Conservation planning actions for the existing workspace operator.

The model owns geometry, raster quantities, eligibility and portfolio selection.
This adapter exposes the same persisted study through the existing task queue.
"""
from pathlib import Path

from model import conservation as model
from model.common import INVEST_VERSION
from model import keowee_priority, conservation_scenarios


class Conservation:
    ACTIONS = frozenset({
        "conservation.prepare", "conservation.build",
        "conservation.plan.save", "conservation.export", "conservation.scenario.create",
        "conservation.criteria.prepare", "conservation.experiment.prepare",
        "conservation.sources.capture", "conservation.report.source.prepare",
    })
    READS = frozenset({"overview", "study", "plan", "source-capture", "report-source"})

    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault

    def _mapping(self, value, label="Request"):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise self.Fault("conservation_invalid_request",
                             label + " must be a JSON object.")
        return value

    def _identifier(self, value, name):
        item = value.get(name)
        if isinstance(item, list):
            item = item[0] if len(item) == 1 else None
        if not isinstance(item, str) or not item.strip():
            raise self.Fault("conservation_missing_identifier",
                             "Choose a " + name.replace("_", " ") + ".")
        if len(item) > 256 or any(char in item for char in ("\0", "/", "\\")):
            raise self.Fault("conservation_invalid_identifier",
                             "The selected " + name.replace("_", " ") + " is invalid.")
        return item

    @staticmethod
    def _sources(rows):
        result = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            collection = {key: row[key] for key in ("id", "title", "state", "created_at", "captured_at", "scope")
                          if key in row}
            collection["entries"] = []
            for entry in row.get("entries", []):
                if not isinstance(entry, dict):
                    continue
                item = {key: entry[key] for key in
                        ("id", "title", "kind", "uri", "vintage", "filename", "path",
                         "format", "layers", "columns", "description", "crs", "bounds",
                         "layer", "id_field", "label_field", "scope", "units")
                        if key in entry}
                body = entry.get("body")
                if isinstance(body, dict):
                    item["body"] = {key: body[key] for key in
                                    ("path", "object", "bytes", "sha256", "filename") if key in body}
                collection["entries"].append(item)
            result.append(collection)
        return result

    def read(self, workspace, operation, value=None):
        if operation not in self.READS:
            raise self.Fault("conservation_unknown_read",
                             "Unknown conservation view.", status=404)
        ws = self.operator.ws(workspace)
        value = self._mapping(value)
        if operation == "overview":
            result = dict(model.overview(ws))
            result["published_methods"] = keowee_priority.catalog()
            result["scenario_bridges"] = conservation_scenarios.list_scenarios(ws)
            from model import conservation_report_source
            result["report_sources"] = conservation_report_source.list_sources(ws)
            from source_tools import parcel_criteria
            result["criteria_operations"] = parcel_criteria.overview(ws)["operations"]
            from source_tools import soil_floodplain_sources
            result["source_acquisitions"] = soil_floodplain_sources.overview(ws)["operations"]
            existing = ws.overview()
            result["available"] = {
                "invest_version": INVEST_VERSION,
                "scenarios": [
                    {key: row[key] for key in ("id", "title", "kind", "source_collection_id") if key in row}
                    for row in existing.get("scenarios", []) if isinstance(row, dict)
                ],
                "sources": self._sources(existing.get("sources", [])),
                "grids": [
                    {key: row[key] for key in ("id", "title", "state", "spec") if key in row}
                    for row in existing.get("grids", []) if isinstance(row, dict)
                ],
                "profiles": [
                    {key: row[key] for key in ("id", "title", "state", "models") if key in row}
                    for row in existing.get("profiles", []) if isinstance(row, dict)
                ],
                "runs": [
                    {**{key: run[key] for key in ("id", "title", "state", "selection", "model")
                        if key in run},
                     "execution": model._native_execution(run, require_supported=False)}
                    for run in existing.get("runs", []) if isinstance(run, dict)
                ],
            }
            return result
        if operation == "report-source":
            from model import conservation_report_source
            result = conservation_report_source.get(ws, self._identifier(value, "report_source_id"))
            decorated = self.decorate_task({"action": "conservation.report.source.prepare",
                                            "workspace": workspace, "result": result})
            return {**result, "_downloads": decorated.get("_downloads", [])}
        if operation == "source-capture":
            from source_tools import soil_floodplain_sources
            result = soil_floodplain_sources.inspect(ws, self._identifier(value, "operation_id"))
            decorated = self.decorate_task({"action": "conservation.sources.capture",
                                            "workspace": workspace, "result": result})
            return {**result, "_downloads": decorated.get("_downloads", [])}
        if operation == "study":
            return model.inspect(ws, self._identifier(value, "study_id"),
                                 include_candidates=True)
        return model.get_plan(ws, self._identifier(value, "plan_id"))

    def invoke(self, task):
        action = task.get("action")
        if action not in self.ACTIONS:
            raise self.Fault("conservation_unknown_action",
                             "Unknown conservation action.", status=404)
        ws = self.operator.ws(task["workspace"])
        value = self._mapping(task.get("payload"))
        if action == "conservation.report.source.prepare":
            from model import conservation_report_source
            return conservation_report_source.prepare(ws, self._mapping(value.get("spec", value), "Report source"))
        if action == "conservation.sources.capture":
            from source_tools import soil_floodplain_sources
            if value.get("operation_id"):
                return soil_floodplain_sources.continue_capture(
                    ws, self._identifier(value, "operation_id"), retry_failed=True)
            selected = self._mapping(value.get("spec", value), "Original source acquisition")
            return soil_floodplain_sources.capture(ws, selected, retry_failed=True)
        if action == "conservation.criteria.prepare":
            from source_tools import parcel_criteria
            if value.get("source_operation_id"):
                from source_tools import soil_floodplain_sources
                original = soil_floodplain_sources.inspect(
                    ws, self._identifier(value, "source_operation_id"))
                selected = original.get("parcel_criteria_selection")
                if not isinstance(selected, dict):
                    raise self.Fault("conservation_source_acquisition_pending",
                                     "Complete an original source family for this parcel study before preparing its criteria.")
                if value.get("settings") is not None:
                    settings = self._mapping(value["settings"], "Criterion geometry settings")
                    if set(settings) - {"spatial_criteria_basis"}:
                        raise self.Fault("conservation_criteria_settings",
                                         "Choose the source criterion geometry for this preparation.")
                    selected = {**selected, "settings": {**selected.get("settings", {}), **settings}}
                return parcel_criteria.prepare(ws, selected)
            selected = (self._identifier(value, "operation_id") if value.get("operation_id")
                        else self._mapping(value.get("spec", value), "Parcel criteria"))
            return parcel_criteria.prepare(ws, selected)
        if action == "conservation.experiment.prepare":
            from model.conservation_scenarios import prepare_experiment
            return prepare_experiment(ws, self._mapping(value.get("spec", value), "Paired experiment"))
        if action == "conservation.prepare":
            return model.prepare(ws, self._mapping(value.get("spec", value), "Study"))
        if action == "conservation.build":
            selection = (self._identifier(value, "study_id") if value.get("study_id")
                         else self._mapping(value.get("spec", value), "Study"))
            return model.build(ws, selection)
        if action == "conservation.plan.save":
            return model.save_plan(ws, self._mapping(value.get("spec", value), "Portfolio"))
        if action == "conservation.scenario.create":
            from model.conservation_scenarios import create_scenario
            return create_scenario(ws, self._mapping(value.get("spec", value), "Scenario"))
        return model.export_packet(
            ws, self._identifier(value, "study_id"),
            self._identifier(value, "plan_id") if value.get("plan_id") else None,
        )

    def decorate_task(self, task):
        """Expose retained outputs through the operator's existing file tickets."""
        if task.get("action") not in self.ACTIONS:
            return task
        result = task.get("result")
        if not isinstance(result, dict):
            result = task.get("output")
        if not isinstance(result, dict):
            return task
        decorated = dict(task)
        action = task["action"]
        payload = task.get("payload") or {}
        decorated["_conservation"] = {
            "study_id": result.get("study_id") or payload.get("study_id") or
                        (result.get("id") if action in
                         {"conservation.prepare", "conservation.build"} else None),
            "plan_id": result.get("id") if action == "conservation.plan.save" else
                       result.get("plan_id") or payload.get("plan_id"),
            "mode": result.get("mode"),
            "state": result.get("state"),
            "conservation_scenario_id": result.get("conservation_scenario_id"),
            "experiment_id": result.get("experiment_id") or
                             (result.get("experiment") or {}).get("id"),
        }
        ws = self.operator.ws(task["workspace"])
        root = Path(ws.root).resolve()
        downloads = list(task.get("_downloads") or [])
        seen = {(row.get("filename"), row.get("sha256"))
                for row in downloads if isinstance(row, dict)}
        unavailable = []

        def add(value, label):
            if not isinstance(value, dict):
                return
            if all(key in value for key in ("path", "bytes", "sha256")):
                relative = value["path"]
                if not isinstance(relative, str):
                    return
                path = (root / relative).resolve()
                try:
                    path.relative_to(root)
                except ValueError:
                    unavailable.append({"label": label,
                                        "message": "Output path leaves this workspace."})
                    return
                if not path.is_file():
                    unavailable.append({"label": label,
                                        "message": "The retained output file is unavailable."})
                    return
                marker = (value.get("filename") or path.name, value["sha256"])
                if marker not in seen:
                    downloads.append(self.operator._ticket(
                        task["workspace"], path, value, label))
                    seen.add(marker)
                return
            for key, child in value.items():
                if isinstance(child, dict):
                    add(child, str(key).replace("_", " ").capitalize())
                elif isinstance(child, list):
                    for index, item in enumerate(child):
                        add(item, str(key).replace("_", " ").capitalize()
                            + " " + str(index + 1))

        if action == "conservation.export":
            add(result, "Conservation project packet")
        add(result.get("files"), "Conservation files")
        if action == "conservation.report.source.prepare":
            add(result.get("packet"), "Original Conservation decision packet")
        handoff = result.get("experiment_handoff")
        if isinstance(handoff, dict):
            add(handoff.get("files"), "Paired experiment files")
        decorated["_downloads"] = downloads
        if unavailable:
            decorated["_conservation_download_errors"] = unavailable
        return decorated


ACTIONS = Conservation.ACTIONS
READS = Conservation.READS
