"""Original queued operations and downloads for native feature cohorts."""
from __future__ import annotations

import hashlib
import threading
import time

from model.common import atomic_json
from model.spatial_cohorts import SpatialCohorts


class CohortOperations:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault
        self.models, self.catalogues = {}, {}
        self.lock = threading.RLock()

    def model(self, workspace):
        ws = self.operator.ws(workspace)
        with self.lock:
            if workspace not in self.models or self.models[workspace].workspace.root != ws.root:
                self.models[workspace] = SpatialCohorts(ws, spatial=self.operator.spatial_reviews[workspace])
            return self.models[workspace]

    def invoke(self, task):
        if task.get("action") != "spatial.cohort.analyze":
            raise self.fault("COHORT_ACTION", "Choose the original vector cohort analysis action.")
        last_progress = [0.0, None]
        def progress(value):
            stamp, stage = time.monotonic(), value.get("stage")
            if stage != "complete" and stage == last_progress[1] and stamp - last_progress[0] < .5:
                return
            last_progress[:] = [stamp, stage]
            with self.operator.lock:
                task["cohort_progress"] = value
                atomic_json(self.operator.root / "tasks" / (task["id"] + ".json"), task)
        result = self.model(task["workspace"]).analyze(task["payload"], progress=progress)
        progress({"stage": "complete", "cohort_id": result["id"],
                  "completed": result["completed_count"], "excluded": result["excluded_count"],
                  "missing": result["missing_count"], "selected": result["feature_count"]})
        return result

    def catalogue(self, workspace):
        model = self.model(workspace)
        folder = model.workspace.root / "spatial-cohorts"
        signature = tuple((p.name, p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_ctime_ns)
                          for p in sorted(folder.glob("*.json")))
        with self.lock:
            previous = self.catalogues.get(workspace)
            if previous and previous[0] == signature:
                return previous[1]
            items = model.catalog()
            self.catalogues[workspace] = (signature, items)
            return items

    def read(self, workspace, operation, payload):
        if operation == "catalog":
            return {"workspace_key": workspace, "cohorts": self.catalogue(workspace)}
        if operation == "result":
            return {"workspace_key": workspace, **self.item(workspace, payload)}
        raise self.fault("COHORT_READ", "Choose a saved native feature cohort.")

    def item(self, workspace, payload):
        model = self.model(workspace)
        result = model.page(payload.get("id"), **{key: payload[key] for key in (
            "offset", "limit", "search", "sort", "descending") if key in payload})
        result["_downloads"] = self.downloads(workspace, result)
        return result

    def downloads(self, workspace, result):
        model = self.model(workspace)
        manifest = model.workspace.root / "spatial-cohorts" / (result["id"] + ".json")
        data = manifest.read_bytes()
        tickets = [self.operator._ticket(workspace, manifest,
                   {"filename": manifest.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
                   "Saved native feature cohort")]
        for metadata in [*result["files"], result["rows_file"]]:
            path = model._file(metadata)
            label = {"summary.csv": "Per-feature native measurements", "categories.csv": "Per-feature native categories",
                     "rows.sqlite": "Original cohort rows (SQLite)"}.get(path.name, path.name)
            tickets.append(self.operator._ticket(workspace, path,
                           {"filename": path.name, "bytes": metadata["bytes"], "sha256": metadata["sha256"]}, label))
        return tickets

    def decorate_task(self, task):
        if task.get("state") == "complete" and task.get("result", {}).get("id"):
            model = self.model(task["workspace"])
            task["_downloads"] = self.downloads(task["workspace"], model.inspect(task["result"]["id"]))
        return task

    def state(self, workspace):
        return self.catalogue(workspace)

    def verify_workspace(self, workspace):
        return SpatialCohorts(workspace).verify()
