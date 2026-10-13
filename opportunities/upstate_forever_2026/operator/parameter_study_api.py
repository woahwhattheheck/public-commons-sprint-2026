"""Parameter-study operations and result-table reads for the local operator."""
from __future__ import annotations

from model import parameter_studies as experiments
from model.common import identifier, read_json, verify_file
from model.model_selection import selected

ACTIONS = {"parameter-study.prepare", "parameter-study.run", "parameter-study.summarize"}
READS = {"catalog", "results"}


class ParameterStudyAPI:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def invoke(self, task):
        workspace = self.operator.ws(task["workspace"])
        payload = task["payload"]
        if task["action"] == "parameter-study.prepare":
            return experiments.prepare(workspace, payload)
        experiment_id = identifier(payload.get("experiment_id"))
        if task["action"] == "parameter-study.run":
            return experiments.execute(workspace, experiment_id)
        if task["action"] == "parameter-study.summarize":
            experiments.summarize(workspace, experiment_id)
            return experiments.inspect(workspace, experiment_id)
        raise self.fault("PARAMETER_STUDY_ACTION", "Choose a supported parameter-study operation.")

    def list(self, workspace_id, *, catalogue=None):
        ws = self.operator.ws(workspace_id)
        return experiments.list_experiments(ws) if catalogue is None else catalogue.parameter_studies(ws)

    def inspect(self, workspace_id, experiment_id):
        return experiments.inspect(self.operator.ws(workspace_id), identifier(experiment_id))

    def preview(self, workspace_id, payload):
        return experiments.preview(self.operator.ws(workspace_id), payload)

    def read(self, workspace_id, operation, payload):
        workspace = self.operator.ws(workspace_id)
        if operation == "catalog":
            return experiments.catalog(workspace, identifier(payload.get("baseline_run_id")))
        if operation != "results":
            raise self.fault("PARAMETER_STUDY_READ", "Choose the parameter catalog or results.")

        experiment_id = identifier(payload.get("id"))
        state = experiments.inspect(workspace, experiment_id)
        artifact = state.get("artifacts", {}).get("results")
        if not artifact:
            raise self.fault("PARAMETER_STUDY_RESULTS", "Run or summarize completed cases to create study results.", 404)
        path = verify_file(workspace.root / "experiments" / experiment_id, artifact)
        result = read_json(path)
        if result.get("experiment_id") != experiment_id or result.get("workspace_id") != workspace.project["id"]:
            raise self.fault("PARAMETER_STUDY_RESULTS_ID", "The result table belongs to another saved study.", 409)

        areas = result["areas"]
        pollutants = sorted({row["pollutant"] for row in result["rows"]})
        area_id = payload.get("area_id") or None
        pollutant = payload.get("pollutant") or None
        if area_id and area_id not in {area["id"] for area in areas}:
            raise self.fault("PARAMETER_STUDY_AREA", "Choose a reporting area from this study.")
        if pollutant and pollutant not in pollutants:
            raise self.fault("PARAMETER_STUDY_POLLUTANT", "Choose a pollutant from this study.")
        try:
            offset = max(0, int(payload.get("offset") or 0))
            limit = max(1, min(1000, int(payload.get("limit") or 100)))
        except (TypeError, ValueError) as error:
            raise self.fault("PARAMETER_STUDY_PAGE", "Use whole numbers for the result-table page.") from error

        def matches(row):
            return (not area_id or row["area_id"] == area_id) and (not pollutant or row["pollutant"] == pollutant)

        matching = [row for row in result["rows"] if matches(row)]
        if offset >= len(matching):
            offset = max(0, ((len(matching) - 1) // limit) * limit)
        return {
            "experiment_id": experiment_id,
            "title": result["title"],
            "purpose": result["purpose"],
            "design": result["design"],
            "models": result.get("models") or list(selected(result["baseline_selection"])),
            "mass_basis": result.get("mass_basis", "Sum of retained annual mass per pixel."),
            "completed_cases": result["completed_cases"],
            "total_cases": result["total_cases"],
            "areas": areas,
            "pollutants": pollutants,
            "rows": matching[offset:offset + limit],
            "ranges": [row for row in result["ranges"] if matches(row)],
            "total_rows": len(result["rows"]),
            "filtered_rows": len(matching),
            "offset": offset,
            "limit": limit,
            "comparison_basis": result["comparison_basis"],
            "range_basis": result["range_basis"],
            "aggregation": {name: value for name, value in result.get("aggregation", {}).items()
                            if name != "pairs"},
            "artifact_sha256": artifact["sha256"],
        }
