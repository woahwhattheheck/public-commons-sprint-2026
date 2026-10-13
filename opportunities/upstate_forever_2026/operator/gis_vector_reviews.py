"""Received working-vector reviews in the original task and download lifecycle."""
from __future__ import annotations

from model import gis_vector_review as reviews

ACTION = "gis.vector.review"
ITEM_KIND = "gis_vector_reviews"


class GISVectorReviews:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _decorate(self, key, record):
        files = self.operator._files(key, record, self.operator.ws(key).root)
        return {**record, "workspace_key": key, "_downloads": files}

    def read(self, workspace_key, operation, payload=None):
        value = payload or {}
        try:
            if not isinstance(value, dict):
                raise ValueError("Choose a retained working-vector review.")
            workspace = self.operator.ws(workspace_key)
            if operation == "catalog":
                return {"workspace_key": workspace_key, "reviews": reviews.catalog(workspace)}
            if operation == "inspect":
                return self._decorate(workspace_key, reviews.inspect(workspace, value.get("id")))
            raise self.Fault("GIS_VECTOR_REVIEW_READ", "Choose a retained working-vector review.", 404)
        except (ValueError, TypeError, KeyError, OSError) as error:
            raise self.Fault("GIS_VECTOR_REVIEW_INPUT", str(error)) from error

    def invoke(self, task):
        try:
            if task.get("action") != ACTION:
                raise ValueError("Choose the original working-vector review action.")
            return reviews.build(self.operator.ws(task["workspace"]), task["payload"])
        except (ValueError, TypeError, KeyError, OSError) as error:
            raise self.Fault("GIS_VECTOR_REVIEW_INPUT", str(error)) from error

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        record = self.read(task["workspace"], "inspect", {"id": task["result"]["id"]})
        return {**task, "_item": {"kind": ITEM_KIND, "id": record["id"]},
                "_downloads": record["_downloads"]}

    def verify_workspace(self, workspace):
        rows = reviews.catalog(workspace)
        for row in rows:
            reviews.inspect(workspace, row["id"])
        return {"gis_vector_reviews": len(rows)}
