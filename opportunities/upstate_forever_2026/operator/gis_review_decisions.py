"""Native source-review decisions, original uploads, queue and downloads."""
from __future__ import annotations
import zipfile

from model import gis_review_decisions as decisions
from model import gis_vector_review as reviews

ACTIONS = {"gis.review.decisions.save", "gis.review.decisions.receive"}
KIND = "gis_review_decisions"


class GISReviewDecisions:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _decorate(self, workspace, record):
        return {**record, "workspace_key": workspace,
                "_downloads": self.operator._files(workspace, record, self.operator.ws(workspace).root)}

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        try:
            if not isinstance(payload, dict):
                raise ValueError("Choose an original source review.")
            ws = self.operator.ws(workspace_key)
            if operation == "catalog":
                return {"workspace_key": workspace_key, "reviews": reviews.catalog(ws),
                        "revisions": decisions.catalog(ws)}
            if operation == "view":
                result = decisions.view(ws, payload.get("review_id"), payload.get("snapshot_id") or None)
                if result["snapshot"]:
                    result["snapshot"] = self._decorate(workspace_key, result["snapshot"])
                return {"workspace_key": workspace_key, **result}
            if operation == "feature":
                return {"workspace_key": workspace_key,
                        **decisions.feature(ws, payload.get("review_id"), payload.get("key"))}
            if operation == "inspect":
                return self._decorate(workspace_key, decisions.inspect(ws, payload.get("id")))
            if operation == "receive-preview":
                upload = self.operator.upload(payload.get("upload_id"))
                ref = decisions.reference(ws, payload.get("review_id"))
                document, comparison = decisions.read_transfer(upload["path"], extraction_limit=self.operator.extraction_limit)
                rows = decisions.validate_transfer(document, comparison, ref)
                return {"workspace_key": workspace_key, "title": document["title"],
                        "reviewer": document["reviewer"], "origin": document["origin"],
                        "comparison_sha256": ref["comparison_sha256"],
                        "counts": decisions._counts(ref, rows)}
            raise self.Fault("GIS_REVIEW_DECISIONS_READ", "Choose a saved source-review action.", 404)
        except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as error:
            raise self.Fault("GIS_REVIEW_DECISIONS_INPUT", str(error)) from error

    def invoke(self, task):
        try:
            ws = self.operator.ws(task["workspace"])
            payload = task["payload"]
            if task["action"] == "gis.review.decisions.save":
                return decisions.save(ws, payload)
            if task["action"] == "gis.review.decisions.receive":
                upload = self.operator.upload(payload.get("upload_id"))
                return decisions.receive(ws, upload["path"], payload,
                                         extraction_limit=self.operator.extraction_limit)
            raise ValueError("Choose a source-review decision action.")
        except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as error:
            raise self.Fault("GIS_REVIEW_DECISIONS_INPUT", str(error)) from error

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        record = self.read(task["workspace"], "inspect", {"id": task["result"]["id"]})
        return {**task, "_item": {"kind": KIND, "id": record["id"]},
                "_downloads": record["_downloads"]}

    def verify_workspace(self, workspace):
        rows = decisions.catalog(workspace)
        references = {}
        for row in rows:
            key = row["review_id"]
            if key not in references:
                references[key] = decisions.reference(workspace, key)
            decisions.inspect(workspace, row["id"], ref=references[key])
        return {"gis_review_decisions": len(rows)}
