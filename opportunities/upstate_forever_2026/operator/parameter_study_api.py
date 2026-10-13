"""Parameter-study operations and result-table reads for the local operator."""
from __future__ import annotations

import json

from model import parameter_studies as experiments
from model import parameter_calibration
from model.common import identifier

ACTIONS = {"parameter-study.prepare", "parameter-study.run", "parameter-study.summarize"}
READS = {"catalog", "results", "calibration", "execution"}


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

    def read(self, workspace_id, operation, payload):
        workspace = self.operator.ws(workspace_id)
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
