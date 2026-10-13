"""Joint delivery planning joins the original queue, CustomerReviews and file tickets."""
from __future__ import annotations

from pathlib import Path
from model import joint_delivery as engine
from model.common import atomic_bytes, canonical, digest, file_digest, identifier
from customer_reviews import CustomerReviews

ACTIONS = frozenset({"joint-delivery.create"})


class JointDelivery:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.reviews = CustomerReviews(operator, fault)

    def _documents(self, workspace, result):
        directory = self.operator.root / "outputs" / "joint-delivery" / digest(result)
        documents = (
            ("Joint_Delivery.json", canonical(result) + b"\n", "Complete allocation, input dependencies and returned history"),
            ("Joint_Delivery.csv", engine.csv_document(result).encode("utf-8"), "Complete requirement allocation — CSV"),
            ("Prime_Inputs.csv", engine.inputs_csv(result).encode("utf-8"), "Prime-only inputs and dependent outputs — CSV"),
            ("Joint_Delivery.html", engine.html_document(result).encode("utf-8"), "Readable joint delivery allocation"),
        )
        links = []
        for name, body, label in documents:
            path = directory / name
            atomic_bytes(path, body, immutable=True)
            links.append(self.operator._ticket(workspace, path,
                {"filename": name, "path": name, "bytes": len(body), "sha256": file_digest(path)}, label))
        return links

    def read(self, workspace, operation, payload=None):
        payload = payload or {}
        ws = self.operator.ws(workspace)
        if operation == "catalog":
            original = self.reviews.read(workspace, "catalog")
            selected_profile = engine.profile()
            return {"workspace_key": workspace, "project": ws.project, "profile": selected_profile, "draft": engine.draft(selected_profile),
                    **{key: original[key] for key in ("sources", "runs", "deliveries", "spatial_exports")},
                    **engine.catalogue(ws)}
        if operation == "evidence":
            return {"workspace_key": workspace, **engine.evidence(ws, payload.get("selection"))}
        if operation == "preview":
            return {"workspace_key": workspace, **engine.preview(ws, payload.get("definition"))}
        if operation == "detail":
            review_id = identifier(payload.get("id"))
            kwargs = {}
            if "response_id" in payload:
                kwargs["response_id"] = identifier(payload["response_id"]) if payload["response_id"] else None
            result = engine.snapshot(ws, review_id, **kwargs)
            original = self.reviews.read(workspace, "review", {"review_id": review_id})
            # The returned snapshot remains pinned to its selected response even
            # when the separate original desk now exposes a later response.
            return {"workspace_key": workspace, **result, "_downloads": self._documents(workspace, result),
                    "original_review": original}
        raise self.Fault("JOINT_DELIVERY_READ", "Choose a joint delivery planning view.", 404)

    def invoke(self, task):
        if task["action"] not in ACTIONS:
            raise self.Fault("JOINT_DELIVERY_ACTION", "Choose an original joint delivery operation.")
        payload = task["payload"]
        record = engine.create(self.operator.ws(task["workspace"]), payload.get("definition"),
                               payload.get("preview_sha256"), created_at=task["created_at"])
        return {"review_id": record["id"], "definition_sha256": digest(record["joint_delivery"]["definition"]),
                "preview_sha256": record["joint_delivery"]["preview_sha256"], "review": record}

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = task["result"]
        review_id = identifier(result.get("review_id"))
        ws = self.operator.ws(task["workspace"])
        record = ws._get("reviews", review_id)
        engine._checked(ws, record)
        return {**task, "_review": {"kind": "review", "review_id": review_id,
            "title": record["title"], "artifact_count": len(record["artifacts"])}}

    def verify_workspace(self, workspace):
        result = engine.catalogue(workspace)
        if result["issues"]:
            raise ValueError("A retained joint delivery differs from its original review: " +
                             "; ".join(row["message"] for row in result["issues"]))
        return {"joint_deliveries": result["reviews"]}
