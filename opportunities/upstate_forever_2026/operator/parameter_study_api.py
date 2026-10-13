"""Parameter-study operations and result-table reads for the local operator."""
from __future__ import annotations

import json

from model import parameter_studies as experiments
from model import parameter_calibration
from model.common import identifier

ACTIONS = {"parameter-study.prepare", "parameter-study.run", "parameter-study.summarize", "parameter-study.source.prepare", "parameter-study.ensemble.continue"}
READS = {"catalog", "results", "calibration", "execution", "view", "source-catalog", "scientific-source", "ensemble-studies"}


class ParameterStudyAPI:
    def __init__(self, operator, fault):
        self.operator = operator
        self.fault = fault

    def invoke(self, task):
        workspace = self.operator.ws(task["workspace"])
        payload = task["payload"]
        if task["action"] == "parameter-study.ensemble.continue":
            from model.ensemble_parameter_studies import continue_studies
            return self._ensemble_studies(task["workspace"], continue_studies(workspace, payload))
        if task["action"] == "parameter-study.prepare":
            return experiments.prepare(workspace, payload)
        if task["action"] == "parameter-study.source.prepare":
            from model import parameter_report_source
            return self._source(task["workspace"], parameter_report_source.prepare(
                workspace, payload, render=payload.get("render", True)))
        experiment_id = identifier(payload.get("experiment_id"))
        if task["action"] == "parameter-study.run":
            return self.operator.native_jobs.execute_parameter_study(task, workspace, experiment_id)
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

    def _source(self, workspace_id, value):
        if value is None:
            return None
        from model.common import relative_file
        workspace = self.operator.ws(workspace_id)
        return {**value, "workspace_key": workspace_id,
                "scientific_report_selection": {"workspace_key": workspace_id,
                    "sources": [value["source"]], "title": value["title"]} if value.get("source") else None,
                "downloads": [self.operator._ticket(workspace_id,
                    relative_file(workspace.root, item["path"]), item, name.replace("_", " "))
                    for name, item in value.get("files", {}).items()]}

    def _ensemble_studies(self, workspace_id, value):
        if value is None:
            return None
        return {**value, "workspace_key": workspace_id,
                "studies": [{**row, "source": self._source(workspace_id, row.get("source"))}
                            for row in value.get("studies", [])]}

    def ensemble_studies(self, workspace_id, operation_id):
        from model.ensemble_parameter_studies import get
        return self._ensemble_studies(workspace_id,
            get(self.operator.ws(workspace_id), identifier(operation_id)))

    def read(self, workspace_id, operation, payload):
        workspace = self.operator.ws(workspace_id)
        if operation == "ensemble-studies":
            from model.ensemble_parameter_studies import latest, preview
            key = identifier(payload.get("id"))
            return {"workspace_key": workspace_id,
                    "preview": preview(workspace, {"ensemble_id": key}),
                    "latest": self._ensemble_studies(workspace_id, latest(workspace, key))}
        if operation == "source-catalog":
            from model import parameter_report_source
            return parameter_report_source.catalog(workspace, identifier(payload.get("id")))
        if operation == "scientific-source":
            from model import parameter_report_source
            result = (parameter_report_source.get(workspace, identifier(payload["source_id"]))
                      if payload.get("source_id") else
                      parameter_report_source.latest(workspace, identifier(payload.get("id"))))
            return self._source(workspace_id, result)
        if operation == "view":
            from model.parameter_views import DEFAULT_VIEWS
            value = DEFAULT_VIEWS.read(workspace, identifier(payload.get("id")), **{
                name: payload[name] for name in ("offset", "limit", "case_filter", "query", "run_id")
                if payload.get(name) not in (None, "")})
            from model.parameter_report_source import summary
            value["scientific_source"] = summary(workspace, value["id"],
                value.get("artifacts", {}).get("results", {}).get("sha256"))
            value["_downloads"] = self.operator._files(
                workspace_id, value, workspace.root / "experiments" / value["id"])
            return value
        if operation == "execution":
            from model.parameter_case_status import read
            return read(workspace, identifier(payload.get("id")),
                        identifier(payload.get("run_id")),
                        **{name: payload[name] for name in (
                            "attempt_id", "stream", "log_offset", "expected_attempt_id",
                            "history_offset", "limit") if payload.get(name) not in (None, "")})
        if operation == "catalog":
            return experiments.catalog(workspace, identifier(payload.get("baseline_run_id")))
        if operation == "calibration":
            run_ids = payload.get("candidate_run_ids")
            if isinstance(run_ids, str):
                try:
                    run_ids = json.loads(run_ids)
                except (TypeError, ValueError) as error:
                    raise self.fault("PARAMETER_STUDY_CANDIDATES", "Select the completed original study cases.") from error
            return parameter_calibration.candidates(
                workspace, identifier(payload.get("id")), candidate_run_ids=run_ids)
        if operation != "results":
            raise self.fault("PARAMETER_STUDY_READ", "Choose the parameter catalog, completed results or calibration candidates.")

        experiment_id = identifier(payload.get("id"))
        from model.parameter_result_query import DEFAULT_RESULTS
        try:
            return DEFAULT_RESULTS.read(workspace, experiment_id, **{
                name: payload[name] for name in (
                    "area_id", "pollutant", "offset", "limit", "range_offset", "range_limit",
                    "expected_artifact_sha256") if payload.get(name) not in (None, "")
            })
        except FileNotFoundError as error:
            raise self.fault("PARAMETER_STUDY_RESULTS", str(error), 404) from error
        except BlockingIOError as error:
            raise self.fault(
                "PARAMETER_STUDY_RESULTS_BUSY",
                "The original study is publishing results. Reopen the completed result table after that operation.",
                409) from error
