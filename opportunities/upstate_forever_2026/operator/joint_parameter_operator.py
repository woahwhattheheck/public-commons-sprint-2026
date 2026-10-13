"""Joint parameter studies on the existing authenticated operator queue."""
from __future__ import annotations

from copy import deepcopy
import json

from model import experiments, joint_parameter_studies as studies
from model.common import (atomic_bytes, atomic_json, digest, file_digest, held, identifier,
                          read_json, verify_file)
from experiment_operator import ExperimentOperator

ACTIONS = frozenset({"joint-study.prepare", "joint-study.run", "joint-study.analyze"})


class JointParameterOperator:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault
        self.original = ExperimentOperator(operator, fault)

    def summaries(self, workspace):
        return studies.catalog(self.operator.ws(workspace))

    def _id(self, value):
        return identifier(value.get("study_id", value.get("id")))

    def _decorate(self, workspace, result):
        value = deepcopy(result)
        ws = self.operator.ws(workspace)
        directory = ws.root / studies.DIRECTORY / value["id"]
        files = {}
        for name in ("definition.json", "state.json"):
            path = directory / name
            if path.is_file():
                files[name] = {"path": name, "bytes": path.stat().st_size, "sha256": file_digest(path)}
        value["_downloads"] = self.operator._files(workspace, {"files": files}, directory)
        experiment_id = value.get("experiment_id")
        if experiment_id:
            native = self.original.retained_result(workspace, experiment_id)
            if native:
                value["native_summary"] = {key: native.get(key) for key in (
                    "id", "state", "progress", "counts", "study_report")}
                value["_downloads"].extend(native.get("_downloads", []))
            marker = directory / "analysis-current.json"
            summary_path = ws.root / "experiments" / experiment_id / "summary.json"
            if marker.is_file():
                retained = read_json(marker)
                current = (experiments.read_summary(ws, experiment_id) is not None
                           and summary_path.is_file()
                           and retained.get("summary_sha256") == file_digest(summary_path))
                if (retained.get("study_id") != value["id"]
                        or retained.get("experiment_id") != experiment_id):
                    raise ValueError("The retained joint analysis points to another study")
                value["analysis"] = {"state": "current" if current else "stale", **retained}
                if current:
                    for item in retained["files"].values():
                        verify_file(directory, item)
                    value["_downloads"].extend(self.operator._files(workspace, retained, directory))
        return value

    def read(self, workspace, operation, payload):
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            overview = ws.operator_overview()
            scenarios = {row["id"]: row for row in overview.get("scenarios", [])}
            return {
                "studies": self.summaries(workspace),
                "axes": experiments.supported_axes(),
                "runs": [row for row in overview.get("runs", [])
                         if row.get("state") == "complete"
                         and scenarios.get(row.get("selection", {}).get("scenario_id"), {}).get("kind") == "baseline"],
                "scenarios": list(scenarios.values()),
                "profiles": overview.get("profiles", []),
            }
        if operation == "preview":
            return studies.preview(ws, payload.get("specification", payload))
        if operation == "inspect":
            return self._decorate(workspace, studies.inspect(ws, self._id(payload)))
        if operation == "analysis":
            current = studies.inspect(ws, self._id(payload))
            directory = ws.root / studies.DIRECTORY / current["id"]
            marker = read_json(directory / "analysis-current.json")
            experiment_id = current["experiment_id"]
            path = ws.root / "experiments" / experiment_id / "summary.json"
            if (marker.get("study_id") != current["id"] or marker.get("experiment_id") != experiment_id
                    or experiments.read_summary(ws, experiment_id) is None
                    or marker["summary_sha256"] != file_digest(path)):
                raise ValueError("Analyze the current completed native cases before opening this analysis")
            return read_json(verify_file(directory, marker["files"]["analysis"]))
        raise self.Fault("JOINT_PARAMETER_READ", "Choose an installed joint parameter study view.", 404)

    def _analyze(self, workspace, study_id):
        from model import joint_parameter_analysis as analysis
        ws = self.operator.ws(workspace)
        current = studies.inspect(ws, study_id)
        experiment_id = current["experiment_id"]
        directory = ws.root / studies.DIRECTORY / study_id
        # Match preparation/portable lock ordering: joint study before experiment.
        with held(directory / ".joint-study.lock", blocking=False):
            with held(ws.root / "experiments" / experiment_id / ".experiment.lock", blocking=False):
                summary = experiments.read_summary(ws, experiment_id)
                if summary is None:
                    raise ValueError("Run or summarize the original experiment before analysis")
                value = analysis.collect(ws, summary)
                if value is None:
                    raise ValueError("The native experiment has no original joint-design binding")
                summary_sha256 = file_digest(ws.root / "experiments" / experiment_id / "summary.json")
                scope = directory / "analyses" / summary_sha256 / digest(value)
                scope.mkdir(parents=True, exist_ok=True)
                files = {}
                payloads = dict(analysis.downloads(value))
                payloads["joint-analysis.json"] = ("Joint parameter analysis", "application/json",
                                                    (json.dumps(value, ensure_ascii=False, sort_keys=True,
                                                                allow_nan=False, indent=2) + "\n").encode("utf-8"))
                payloads["joint-analysis.html"] = ("Joint parameter report", "text/html",
                                                    analysis.render_html(value).encode("utf-8"))
                for name, (label, mime, data) in payloads.items():
                    if "/" in name or "\\" in name or name.startswith("."):
                        raise ValueError("The original analysis download name is not a complete file")
                    target = scope / name
                    atomic_bytes(target, data, immutable=True)
                    key = "analysis" if name == "joint-analysis.json" else name
                    files[key] = {"path": target.relative_to(directory).as_posix(),
                                  "bytes": target.stat().st_size, "sha256": file_digest(target),
                                  "title": label, "mime": mime}
                marker = {"schema": "upstate.joint-parameter-analysis-files/v1",
                          "study_id": study_id, "experiment_id": experiment_id,
                          "summary_sha256": summary_sha256, "files": files}
                atomic_json(directory / "analysis-current.json", marker)
        return marker

    def invoke(self, task):
        action = task["action"]
        if action not in ACTIONS:
            raise self.Fault("JOINT_PARAMETER_ACTION", "Choose a joint study action.", 404)
        workspace, payload = task["workspace"], task["payload"]
        ws = self.operator.ws(workspace)
        if action == "joint-study.prepare":
            result = studies.prepare(ws, payload["definition"])
            task["joint_study_id"] = result["id"]
            task["experiment_id"] = result["experiment_id"]
            return result
        study_id = self._id(payload)
        current = studies.inspect(ws, study_id)
        if not current.get("experiment_id"):
            current = studies.prepare(ws, current["definition"])
        task["joint_study_id"] = study_id
        task["experiment_id"] = current["experiment_id"]
        native = dict(task, action="experiment.run" if action == "joint-study.run" else "experiment.summarize",
                      payload={"experiment_id": current["experiment_id"]})
        try:
            self.original.invoke(native)
        finally:
            if native.get("study_report_error"):
                task["study_report_error"] = native["study_report_error"]
        self._analyze(workspace, study_id)
        return studies.inspect(ws, study_id)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS:
            return task
        result = task.get("result") or {}
        study_id = task.get("joint_study_id") or result.get("id") or task.get("payload", {}).get("study_id")
        if not study_id:
            return task
        task["joint_study"] = {"id": identifier(study_id)}
        try:
            value = self._decorate(task["workspace"],
                                   studies.inspect(self.operator.ws(task["workspace"]), study_id))
            task["joint_study"].update({key: value.get(key) for key in (
                "state", "sample_count", "prepared_samples", "experiment_id")})
            task["_downloads"] = value["_downloads"]
        except (OSError, ValueError, KeyError) as error:
            task["joint_study"]["error"] = str(error)
        return task
