"""Station geography desk for the existing authenticated operator and task queue."""
from pathlib import Path
from model import station_geography as geography
from model.common import identifier, read_json, relative_file, verify_file

ACTIONS = frozenset(("station.geography.build", "station.geography.receive"))

class StationGeography:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _fail(self, code, message, status=422):
        raise self.Fault(code, message, status)

    def overview(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        return [
            {key: row[key] for key in ("id", "title", "build_id", "summary", "created_at") if key in row}
            for row in ws._list(geography.KIND)
        ]

    def _edition(self, workspace_key, edition_id, complete=True):
        ws = self.operator.ws(workspace_key)
        row = ws._get(geography.KIND, identifier(edition_id))
        files = row.get("files", [])
        if isinstance(files, dict):
            files = list(files.values())
        downloads = []
        for item in files:
            if not isinstance(item, dict) or not {"path", "bytes", "sha256"} <= set(item):
                continue
            path = relative_file(ws.root, item["path"])
            downloads.append(self.operator._ticket(
                workspace_key, path, item, item.get("label") or Path(item["path"]).name))
        result = dict(row)
        result.update(workspace_key=workspace_key, _downloads=downloads)
        if complete:
            candidates = [item for item in files if Path(item.get("path", "")).name == "analysis.json"]
            if len(candidates) != 1:
                self._fail("STATION_RESULT", "The saved station edition has no unique analysis file.", 409)
            analysis = read_json(verify_file(ws.root, candidates[0]))
            result["result"] = analysis
            for name, field in (("watersheds.geojson", "watershed_geojson"),
                                ("stations.geojson", "station_geojson"),
                                ("candidate_locations.geojson", "candidate_geojson")):
                selected = [item for item in files if Path(item.get("path", "")).name == name]
                if len(selected) == 1:
                    result[field] = read_json(verify_file(ws.root, selected[0]))
        return result

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return {"workspace_key": workspace_key, **geography.catalog(ws)}
        if operation == "edition":
            return self._edition(workspace_key, payload.get("id") or payload.get("edition_id"))
        if operation == "verify":
            edition_id = identifier(payload.get("id") or payload.get("edition_id"))
            geography.inspect(ws, edition_id, verify=True)
            return {"workspace_key": workspace_key, "id": edition_id, "verified": True}
        self._fail("STATION_READ", "Choose a registered station geography read.")

    def invoke(self, task):
        if task.get("action") not in ACTIONS:
            self._fail("STATION_ACTION", "Choose a registered station geography operation.")
        ws = self.operator.ws(task["workspace"])
        payload = task.get("payload") or {}
        if task["action"] == "station.geography.receive":
            upload = self.operator.upload(identifier(payload.get("upload_id")))
            result = geography.receive(ws, upload["path"], max_extracted_bytes=self.operator.extraction_limit)
        else:
            selection = payload.get("selection", payload)
            if not isinstance(selection, dict):
                self._fail("STATION_SELECTION", "Choose original station sources and study station IDs.")
            result = geography.build(ws, selection)
        return {key: result[key] for key in ("id", "title", "build_id", "summary", "selection") if key in result}

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        edition_id = (task.get("result") or {}).get("id")
        if not edition_id:
            return task
        edition = self._edition(task["workspace"], edition_id, complete=False)
        task.setdefault("_downloads", []).extend(edition["_downloads"])
        task["_station_geography"] = {
            "id": edition_id, "title": edition.get("title"),
            "summary": edition.get("summary", {}), "view": "station-geography",
        }
        return task
