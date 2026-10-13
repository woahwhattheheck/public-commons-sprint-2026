"""Native queue, workspace records and original download tickets for regions."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import threading

from model.common import atomic_json
from model.spatial_regions import SpatialRegions, csv_exports
from model.spatial_region_extract import RegionExtracts
from model.common import verify_file


class RegionOperations:
    def __init__(self, operator, fault):
        self.operator, self.fault = operator, fault
        self.models, self.catalogues = {}, {}
        self.lock = threading.RLock()

    def model(self, workspace):
        ws = self.operator.ws(workspace)
        with self.lock:
            if workspace not in self.models or self.models[workspace].workspace.root != ws.root:
                self.models[workspace] = SpatialRegions(ws, spatial=self.operator.spatial_reviews[workspace])
            return self.models[workspace]

    def invoke(self, task):
        if task.get("action") not in {"spatial.region.analyze", "spatial.region.extract"}:
            raise self.fault("REGION_ACTION", "Choose a saved Area calculation or native-grid extraction.")
        def progress(value):
            with self.operator.lock:
                task["region_progress"] = value
                atomic_json(self.operator.root / "tasks" / (task["id"] + ".json"), task)
        model = self.model(task["workspace"])
        if task["action"] == "spatial.region.extract":
            result = RegionExtracts(model.workspace, regions=model).export(task["payload"], progress=progress)
            progress({"stage": "complete", "extraction_id": result["id"], "region_id": result["analysis_id"]})
        else:
            result = model.analyze(task["payload"], progress=progress)
            progress({"stage": "complete", "region_id": result["id"]})
        return result

    def catalogue(self, workspace):
        model = self.model(workspace)
        folder = model.workspace.root / "spatial-regions"
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
            return {"workspace_key": workspace, "analyses": self.catalogue(workspace)}
        if operation == "result":
            return {"workspace_key": workspace, **self.item(workspace, payload)}
        if operation == "extract":
            return {"workspace_key": workspace, **self.extract_item(workspace, payload)}
        if operation == "extracts":
            model = self.model(workspace)
            return {"workspace_key": workspace, "extractions":
                    RegionExtracts(model.workspace, regions=model).catalog(payload.get("analysis_id"))}
        raise self.fault("REGION_READ", "Choose a saved region analysis or extraction.")

    def item(self, workspace, payload):
        model = self.model(workspace)
        result = model.inspect(payload.get("id"))
        result["_downloads"] = self.downloads(workspace, result)
        result["_extractions"] = RegionExtracts(model.workspace, regions=model).catalog(result["id"])
        return result

    def extract_item(self, workspace, payload):
        model = self.model(workspace)
        value = RegionExtracts(model.workspace, regions=model).inspect(payload.get("id"))
        directory = model.workspace.root / "spatial-region-extractions" / value["id"]
        value["_downloads"] = [
            self.operator._ticket(workspace, verify_file(directory, item),
                {**item, "filename": Path(item["path"]).name},
                {"editable_gis": "Complete editable GIS ZIP", "report": "Area extraction report",
                 "analysis": "Original Area analysis", "provenance": "Extraction source and method"}.get(
                     label, label.replace("_", " ").replace("-", " ")))
            for label, item in value["files"].items()
            if label not in {"qgis_project", "gis_open"}]
        return value

    def downloads(self, workspace, result):
        ws = self.operator.ws(workspace)
        folder = ws.root / "spatial-regions" / result["id"]
        if not folder.resolve().is_relative_to(ws.root.resolve()):
            raise ValueError("Region export directory leaves the selected scientific workspace")
        folder.mkdir(parents=True, exist_ok=True)
        files = [(ws.root / "spatial-regions" / (result["id"] + ".json"),
                  "Saved region analysis")]
        with self.lock:
            for name, body in csv_exports(result).items():
                path, data = folder / name, body.encode("utf-8")
                if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
                    pending = None
                    try:
                        with tempfile.NamedTemporaryFile(prefix="." + name + ".", dir=folder, delete=False) as target:
                            pending = Path(target.name)
                            target.write(data)
                            target.flush()
                            os.fsync(target.fileno())
                        os.replace(pending, path)
                        pending = None
                    finally:
                        if pending is not None:
                            pending.unlink(missing_ok=True)
                files.append((path, {"summary.csv": "Native region statistics",
                                    "histograms.csv": "Native region histogram bins",
                                    "categories.csv": "Native category counts"}[name]))
        tickets = []
        for path, label in files:
            data = path.read_bytes()
            tickets.append(self.operator._ticket(workspace, path,
                           {"filename": path.name, "bytes": len(data),
                            "sha256": hashlib.sha256(data).hexdigest()}, label))
        return tickets

    def decorate_task(self, task):
        if task.get("state") == "complete" and task.get("result", {}).get("id"):
            getter = self.extract_item if task.get("action") == "spatial.region.extract" else self.item
            task["_downloads"] = getter(task["workspace"], {"id": task["result"]["id"]})["_downloads"]
        return task

    def state(self, workspace):
        return self.catalogue(workspace)

    def verify_workspace(self, workspace):
        original = SpatialRegions(workspace).verify()
        extracts = RegionExtracts(workspace)
        for item in extracts.catalog():
            extracts.inspect(item["id"])
        return original
