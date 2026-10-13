"""Station geography desk for the existing authenticated operator and task queue."""
from pathlib import Path
from model import station_geography as geography
from model import native_assessment_review
from model.common import describe_file, identifier, read_json, relative_file, verify_file

ACTIONS = frozenset(("station.geography.build", "station.geography.receive",
                     "station.geography.utility-microbial", "station.geography.review-selection"))

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

    def _microbial_catalog(self, ws):
        from model import utility_microbial_study as microbial
        installed = microbial.SOURCE_DIRECTORY / "source-manifest.json"
        source_editions = getattr(microbial, "SOURCE_EDITIONS", {microbial.MANIFEST_SHA256: None})
        retained = any(row.get("original_manifest", {}).get("sha256") in source_editions
                       for row in ws._list("sources"))
        return {"id": "utility-microbial", "title": microbial.TITLE,
                "available": installed.is_file() or retained,
                "installed": installed.is_file(), "retained": retained,
                "source_counts": microbial.EXPECTED_COUNTS}

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return {"workspace_key": workspace_key, **geography.catalog(ws),
                    "utility_microbial": self._microbial_catalog(ws),
                    "native_review_sources": native_assessment_review.catalog(ws)}
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
        elif task["action"] == "station.geography.review-selection":
            upload = self.operator.upload(identifier(payload.get("upload_id")))
            prepared = native_assessment_review.prepare(
                ws, upload["path"], payload.get("source_collection_id"),
                payload.get("source_id"), title=payload.get("title"))
            result = geography.build(ws, prepared["selection"])
            return {**{key: result[key] for key in (
                "id", "title", "build_id", "summary", "selection") if key in result},
                "native_review": prepared["review_binding"]}
        elif task["action"] == "station.geography.utility-microbial":
            from model import utility_microbial_study as microbial
            mode = payload.get("domain_mode", "required")
            if mode not in ("required", "auto", "none"):
                self._fail("STATION_DOMAIN", "Choose the original domain or station points.")
            installed = microbial.SOURCE_DIRECTORY / "source-manifest.json"
            received = microbial.build(ws, manifest=installed if installed.is_file() else None,
                                       domain_mode=mode)
            return {"id": received["station_geography_id"], "title": received["title"],
                    "build_id": received["station_geography_build_id"],
                    "summary": received["summary"], "selection": received["selection"],
                    "utility_microbial": {key: received[key] for key in (
                        "id", "source_collection_id", "source_counts", "domain", "receiving_file")},
                    "original_report": {key: received["original_report"][key] for key in (
                        "source_id", "source_sha256")}}
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
        microbial = (task.get("result") or {}).get("utility_microbial")
        if microbial and microbial.get("receiving_file"):
            ws = self.operator.ws(task["workspace"])
            item = microbial["receiving_file"]
            path = verify_file(ws.root, item)
            task["_downloads"].append(self.operator._ticket(
                task["workspace"], path, item, "Original microbial study receiving.json"))
        original_report = (task.get("result") or {}).get("original_report")
        if microbial and original_report:
            ws = self.operator.ws(task["workspace"])
            path, entry = ws.source_file(microbial["source_collection_id"],
                                         original_report["source_id"])
            if entry["body"]["sha256"] != original_report["source_sha256"]:
                self._fail("STATION_REPORT", "The retained original microbial report differs.", 409)
            item = describe_file(ws.root, path)
            task["_downloads"].append(self.operator._ticket(
                task["workspace"], path, item, "Original E. coli interactive explorer.html"))
        task["_station_geography"] = {
            "id": edition_id, "title": edition.get("title"),
            "summary": edition.get("summary", {}), "view": "station-geography",
        }
        return task
