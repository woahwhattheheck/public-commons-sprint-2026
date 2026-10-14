"""Monitoring-change editions in the maintained workspace and native queue."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile

from model.common import describe_file, identifier, relative_file, now
from measurement_workspace import temporal_analysis as engine
from measurement_workspace.temporal_transfer import receive
from measurement_workspace import temporal_workspace as original_observations
from measurement_workspace import temporal_comparison as comparison_engine

KIND = "temporal_analyses"
ACTION = "temporal.analysis.build"
RECEIVE = "temporal.analysis.receive"
OBSERVED = "temporal.analysis.observations"
COMPARISONS = "temporal_comparisons"
COMPARE = "temporal.comparison.build"
RECEIVE_COMPARE = "temporal.comparison.receive"


class TemporalAnalysisProvider:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.application = Path(__file__).resolve().parents[1]

    def state(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        return [{k: row.get(k) for k in ("id", "title", "summary", "created_at", "analysis_id", "selection")}
                for row in ws._list(KIND)]

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        value = payload or {}
        if operation == "catalog":
            source_application = self.application
            if value.get("source_edition_id"):
                prior = ws._get(KIND, identifier(value["source_edition_id"]))
                source_application = ws.root / "temporal-analysis-editions" / identifier(prior["analysis_id"]) / "inputs"
            sources = [{"id": key, "title": spec["title"], "kind": spec["kind"],
                        "available": (source_application / spec["manifest"]).is_file()
                                      and (key == "flow" or (source_application / spec["table"]).is_file())}
                       for key, spec in engine.DATASETS.items()]
            return {"datasets": sources, "defaults": engine.DEFAULT, "editions": self.state(workspace_key), "observations": original_observations.catalog(ws),
                    "comparisons": [{key: row.get(key) for key in ("id", "title", "comparison_id", "selection", "summary", "created_at")}
                                    for row in ws._list(COMPARISONS)]}
        if operation == "comparison":
            return self.comparison(workspace_key, value.get("id"))
        if operation == "observation":
            return original_observations.preview(ws, value.get("id"))
        if operation == "edition":
            return self.edition(workspace_key, value.get("id"))
        raise self.Fault("TEMPORAL_READ", "Choose a monitoring-change catalog or saved edition.", 422)

    def edition(self, workspace_key, key):
        ws = self.operator.ws(workspace_key)
        row = ws._get(KIND, identifier(key))
        downloads = []
        for item in row["files"]:
            path = relative_file(ws.root, item["path"])
            downloads.append(self.operator._ticket(workspace_key, path, item, item["label"]))
        return {**row, "_downloads": downloads}

    def invoke(self, task):
        if task.get("action") in (COMPARE, RECEIVE_COMPARE):
            return self.invoke_comparison(task)
        if task.get("action") not in (ACTION, RECEIVE, OBSERVED):
            raise self.Fault("TEMPORAL_ACTION", "Choose the registered monitoring-change build operation.", 422)
        ws = self.operator.ws(task["workspace"])
        payload = task.get("payload") or {}
        selection = engine.checked_selection(payload.get("selection")) if task["action"] in (ACTION, OBSERVED) else None
        source_application = self.application
        if task["action"] == ACTION and payload.get("source_edition_id"):
            prior = ws._get(KIND, identifier(payload["source_edition_id"]))
            source_application = ws.root / "temporal-analysis-editions" / identifier(prior["analysis_id"]) / "inputs"
        destination_root = ws.root / "temporal-analysis-editions"
        destination_root.mkdir(parents=True, exist_ok=True)
        parent = Path(tempfile.mkdtemp(prefix=".build-", dir=destination_root))
        try:
            if task["action"] == RECEIVE:
                upload = self.operator.upload(identifier(payload.get("upload_id")))
                result = receive(Path(upload["path"]), parent / "edition", maximum_bytes=min(512 * 1024 * 1024, self.operator.extraction_limit))
                selection = result["selection"]
            else:
                if task['action'] == OBSERVED:
                    source_application = parent / 'captured-source'
                    original_observations.capture(ws, payload.get('observation_id'), source_application, payload.get('interpretation'))
                    selection = engine.checked_selection({**selection, 'datasets': ['workspace']})
                result = engine.build(source_application, parent / "edition", selection)
            destination = destination_root / result["id"]
            if destination.exists():
                # An identical scientific selection has an immutable identity.
                old = json.loads((destination / "analysis.json").read_text())
                if old.get("id") != result["id"]:
                    raise ValueError("The saved monitoring edition has a conflicting identity.")
            else:
                (parent / "edition").rename(destination)
            for old in ws._list(KIND):
                if old.get("analysis_id") == result["id"]:
                    return {"id": old["id"], "analysis_id": old["analysis_id"], "title": old["title"], "summary": old["summary"]}
            wanted = ("review.html", "temporal-analysis.zip", "cohort-summary.csv", "monthly-intervals.csv",
                      "matched-month-pairs.csv", "leave-one-year-out.csv", "source-records.csv", "analysis.json", "selection.json")
            files = []
            for name in wanted:
                p = destination / name
                item = describe_file(ws.root, p)
                item["path"] = p.relative_to(ws.root).as_posix()
                item["label"] = name
                files.append(item)
            record = ws._save(KIND, {"title": result["title"], "analysis_id": result["id"],
                                    "selection": selection, "summary": result["summary"],
                                    "implementation": result["implementation"], "created_at": now(),
                                    "files": files, "source_task_id": task.get("id"),
                                    "source_edition_id": payload.get("source_edition_id"),
                                    "observation_id": payload.get("observation_id"), "interpretation": payload.get("interpretation"),
                                    "received_package": result.get("received_package")})
            return {"id": record["id"], "analysis_id": result["id"], "title": record["title"], "summary": record["summary"]}
        finally:
            shutil.rmtree(parent, ignore_errors=True)

    def decorate_task(self, task):
        if task.get("action") in (COMPARE, RECEIVE_COMPARE) and task.get("state") == "complete" and task.get("result", {}).get("id"):
            record = self.comparison(task["workspace"], task["result"]["id"])
            task.setdefault("_downloads", []).extend(record["_downloads"])
            return task
        if task.get("action") in (ACTION, RECEIVE, OBSERVED) and task.get("state") == "complete" and task.get("result", {}).get("id"):
            record = self.edition(task["workspace"], task["result"]["id"])
            task.setdefault("_downloads", []).extend(record["_downloads"])
        return task


    def comparison(self, workspace_key, key):
        ws = self.operator.ws(workspace_key)
        row = ws._get(COMPARISONS, identifier(key))
        directory = ws.root / "temporal-comparison-editions" / identifier(row["comparison_id"])
        descriptor = next(item for item in row["files"] if Path(item["path"]).name == "comparison.json")
        path = relative_file(ws.root, descriptor["path"])
        if comparison_engine._digest_file(path) != {name: descriptor[name] for name in ("bytes", "sha256")}:
            raise ValueError("Retained saved comparison changed.")
        complete = json.loads(path.read_text("utf-8"))
        if complete["id"] != row["comparison_id"] or complete["selection"] != row["selection"]:
            raise ValueError("Original comparison selection differs from its saved record.")
        overview = {"id":complete["id"],"rule":complete["rule"],"selection":complete["selection"],
                    "input_archives":complete["input_archives"],"summary":complete["summary"],
                    "series":[{key: value for key, value in item.items() if key not in ("before","after")} |
                              {"before": {key:item["before"].get(key) for key in ("estimate","unit","source_record_count","first_date","last_date","source_context")} if item["before"] is not None else None,
                               "after": {key:item["after"].get(key) for key in ("estimate","unit","source_record_count","first_date","last_date","source_context")} if item["after"] is not None else None}
                              for item in complete["series"]]}
        downloads = [self.operator._ticket(workspace_key, relative_file(ws.root, item["path"]), item, item["label"])
                     for item in row["files"]]
        return {**row, "overview": overview, "_downloads": downloads}

    def _comparison_original(self, ws, key):
        row = ws._get(KIND, identifier(key))
        descriptor = next((item for item in row["files"] if Path(item["path"]).name == "temporal-analysis.zip"), None)
        if descriptor is None:
            raise ValueError("Selected saved analysis lacks its complete original ZIP.")
        path = relative_file(ws.root, descriptor["path"])
        if comparison_engine._digest_file(path) != {name: descriptor[name] for name in ("bytes", "sha256")}:
            raise ValueError("Selected original analysis package changed.")
        return row, path

    def invoke_comparison(self, task):
        ws = self.operator.ws(task["workspace"])
        payload = task.get("payload") or {}
        root = ws.root / "temporal-comparison-editions"
        root.mkdir(parents=True, exist_ok=True)
        parent = Path(tempfile.mkdtemp(prefix=".comparison-", dir=root))
        try:
            if task["action"] == RECEIVE_COMPARE:
                upload = self.operator.upload(identifier(payload.get("upload_id")))
                result = comparison_engine.receive(Path(upload["path"]), parent/"edition",
                    maximum_bytes=min(comparison_engine.MAXIMUM_BYTES, self.operator.extraction_limit))
            else:
                before, before_path = self._comparison_original(ws, payload.get("before_id"))
                after, after_path = self._comparison_original(ws, payload.get("after_id"))
                if before["id"] == after["id"]:
                    raise ValueError("Select two distinct saved Workspace editions.")
                selection = {"title": payload.get("title"), "before_edition_id":before["id"], "after_edition_id":after["id"]}
                result = comparison_engine.build(before_path, after_path, parent/"edition", selection)
                if result["input_archives"]["before"]["analysis_id"] != before["analysis_id"] or result["input_archives"]["after"]["analysis_id"] != after["analysis_id"]:
                    raise ValueError("Original selected saved edition has a different analysis.")
            destination = root / identifier(result["id"])
            if destination.exists():
                verification = comparison_engine.receive(destination/"temporal-comparison.zip", parent/"existing",
                    maximum_bytes=min(comparison_engine.MAXIMUM_BYTES, self.operator.extraction_limit))
                if verification["id"] != result["id"] or verification["selection"] != result["selection"]:
                    raise ValueError("Existing comparison edition differs.")
            else:
                (parent/"edition").rename(destination)
            for old in ws._list(COMPARISONS):
                if old.get("comparison_id") == result["id"]:
                    return {"id":old["id"],"comparison_id":old["comparison_id"],"title":old["title"],"summary":old["summary"]}
            wanted = list(comparison_engine.OPENING_FILES)
            wanted += ["before/temporal-analysis.zip", "after/temporal-analysis.zip"]
            files = []
            for name in wanted:
                path = relative_file(destination, name)
                item = describe_file(ws.root, path)
                item["path"] = path.relative_to(ws.root).as_posix()
                item["label"] = name
                files.append(item)
            record = ws._save(COMPARISONS, {"title":result["selection"]["title"],"comparison_id":result["id"],
                "selection":result["selection"],"summary":result["summary"],"input_archives":result["input_archives"],
                "implementation":result["implementation"],"created_at":now(),"files":files,
                "source_task_id":task.get("id"),"received_package":result.get("received_package")})
            return {"id":record["id"],"comparison_id":record["comparison_id"],"title":record["title"],"summary":record["summary"]}
        finally:
            shutil.rmtree(parent, ignore_errors=True)
