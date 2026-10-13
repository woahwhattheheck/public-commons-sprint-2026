"""Review-response reconciliation through the original extension host."""
from __future__ import annotations

from pathlib import Path

from model.common import identifier, now
from model import reviews
from model import review_reconciliation as reconciliation

ACTIONS = frozenset({"customer.review.response.stage", "customer.review.response.reconcile"})


class ReviewReconciliation:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def _guard(self, function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except reconciliation.ReconciliationError as error:
            status = 409 if error.code in {
                "REVIEW_HEAD_CHANGED", "REVIEW_OPERATION_REUSED",
                "REVIEW_RECONCILIATION_CHANGED", "REVIEW_ORIGINAL_CHANGED",
                "REVIEW_RECONCILIATION_PLAN", "REVIEW_DRAFT_CHANGED",
            } else 422
            raise self.Fault(error.code, str(error), status) from error

    @staticmethod
    def _id(value, name):
        return identifier(value.get(name))

    def _incoming(self, payload):
        if ("upload_id" in payload) == ("response" in payload):
            raise ValueError("Choose one complete response document or its retained upload.")
        if "upload_id" in payload:
            uploaded = self.operator.upload(self._id(payload, "upload_id"))
            path = Path(uploaded["path"])
            value = reviews._read_json_file(path)
        else:
            value, path = payload["response"], None
        if not isinstance(value, dict):
            raise ValueError("Choose the complete returned-response JSON object.")
        if payload.get("review_id") is not None and value.get("review_id") != payload["review_id"]:
            raise ValueError("The returned response belongs to another selected review.")
        return value, path

    def _draft(self, workspace, payload):
        value = self._guard(reconciliation.read_draft, workspace, self._id(payload, "draft_id"),
                            include_response=True)
        if payload.get("review_id") is not None and payload["review_id"] != value["review_id"]:
            raise ValueError("The retained returned response belongs to another review.")
        return value

    @staticmethod
    def _draft_summary(value):
        return {key: value[key] for key in (
            "draft_id", "project_id", "review_id", "received_at", "created_at",
            "reviewer", "disposition", "summary", "artifacts", "requirements",
            "corrections", "base_response_id", "incoming_response_sha256")}

    def _original_ticket(self, workspace_key, draft):
        value = draft["original_file"]
        return self.operator._ticket(workspace_key, Path(value["path"]), value,
                                     "Original returned response")

    def overview(self, workspace_key):
        ws = self.operator.ws(workspace_key)
        return {"returned_responses": reconciliation.list_drafts(ws),
                "reconciliations": reconciliation.list_reconciliations(ws)}

    def read(self, workspace_key, operation, payload):
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            selected = []
            for review in ws._list("reviews"):
                chain = reviews.history(ws, review["id"])
                selected.append({
                    "id": review["id"], "title": review["title"], "purpose": review["purpose"],
                    "artifacts": len(review["artifacts"]), "requirements": len(review["requirements"]),
                    "responses": len(chain), "latest_response_id": chain[-1]["id"] if chain else None,
                    "latest_reviewer": chain[-1]["response"]["reviewer"] if chain else None,
                })
            return {"workspace_key": workspace_key, "project": ws.project,
                    "reviews": selected, **self.overview(workspace_key)}
        if operation in ("preview", "validate"):
            draft = self._draft(ws, payload)
            expected = {}
            if "expected_response_id" in payload:
                expected["expected_response_id"] = payload["expected_response_id"]
            plan = self._guard(reconciliation.preview_response, ws, draft["response"], **expected)
            result = {"workspace_key": workspace_key, "draft": self._draft_summary(draft),
                      "plan": plan, "_original_download": self._original_ticket(workspace_key, draft)}
            if operation == "validate":
                if payload.get("plan_id") != plan["id"]:
                    raise self.Fault("REVIEW_RECONCILIATION_PLAN",
                                     "The comparison changed. Refresh it before retaining decisions.", 409)
                response = self._guard(
                    reconciliation.resolved_response, ws, draft["response"], plan,
                    payload.get("choices", {}), reviewer=payload.get("reviewer"),
                    created_at=payload.get("created_at") or now(),
                    disposition=payload.get("disposition"), summary=payload.get("summary"))
                result["response"] = response
                result["valid"] = True
            return result
        if operation == "detail":
            operation_id = identifier(payload.get("operation_id") or payload.get("id"))
            result = self._guard(reconciliation.inspect_reconciliation, ws, operation_id)
            directory = ws.root / reconciliation.DIRECTORY / operation_id
            prepared = result["prepared"]
            downloads = [self.operator._ticket(
                workspace_key, directory / "returned-response.json",
                prepared["original_file"], "Original returned response")]
            if result.get("result"):
                for name, label in (("prepared_file", "Reconciliation choices and original revisions"),
                                    ("completed_file", "Completed response import")):
                    value = result["result"][name]
                    downloads.append(self.operator._ticket(workspace_key, value["path"], value, label))
            return {"workspace_key": workspace_key, **result, "_downloads": downloads}
        raise self.Fault("REVIEW_RECONCILIATION_READ", "Choose a supported response comparison.", 404)

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        payload = task["payload"]
        if task["action"] == "customer.review.response.stage":
            incoming, source_path = self._incoming(payload)
            draft = self._guard(reconciliation.stage_response, ws, incoming,
                                operation_id=task["id"], created_at=task["created_at"],
                                source_path=source_path)
            return {"review_id": draft["review_id"], "draft_id": draft["draft_id"],
                    "draft": self._draft_summary(draft)}
        if task["action"] == "customer.review.response.reconcile":
            draft = self._draft(ws, payload)
            if "expected_response_id" not in payload:
                raise ValueError("Open the current comparison before retaining this response.")
            result = self._guard(
                reconciliation.commit_response, ws, draft["response"],
                plan_id=self._id(payload, "plan_id"),
                expected_response_id=payload["expected_response_id"],
                choices=payload.get("choices", {}), reviewer=payload.get("reviewer"),
                operation_id=task["id"], created_at=task["created_at"],
                disposition=payload.get("disposition"), summary=payload.get("summary"),
                note=payload.get("note", ""), source_path=draft["original_file"]["path"])
            return {**result, "draft_id": draft["draft_id"]}
        raise self.Fault("REVIEW_RECONCILIATION_ACTION", "Choose a supported response receiving task.")

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = task["result"]
        task["_review"] = {"review_id": result["review_id"]}
        task["_reconciliation"] = {
            "view": "review-reconciliation", "draft_id": result["draft_id"],
            "operation_id": task["id"], "review_id": result["review_id"],
        }
        ws = self.operator.ws(task["workspace"])
        draft = self._guard(reconciliation.read_draft, ws, result["draft_id"])
        task["_downloads"] = [self._original_ticket(task["workspace"], draft)]
        if task["action"] == "customer.review.response.reconcile":
            actual = self._guard(reconciliation.inspect_reconciliation, ws, task["id"])["result"]
            for field, label in (("prepared_file", "Selected reconciliation and original revisions"),
                                 ("completed_file", "Completed response import")):
                value = actual[field]
                task["_downloads"].append(self.operator._ticket(task["workspace"],
                                                                 value["path"], value, label))
        return task
