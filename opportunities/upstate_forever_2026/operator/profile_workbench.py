"""Profile editions on the maintained operator's actions and download transport."""
from __future__ import annotations
from copy import deepcopy
import json

from model import profile_editions as model
from model import profile_customer_review as customer_review
from model import biophysical_evidence as evidence
from model.common import describe_file, verify_file

CUSTOMER_ACTIONS = frozenset({"profile.customer_review.create", "profile.customer_review.apply"})
BIOPHYSICAL_ACTIONS = frozenset({
    "profile.biophysical.evidence.save", "profile.biophysical.ranges.prepare",
    "profile.biophysical.experiment.prepare",
})
ACTIONS = frozenset({"profile.edition.save", "profile.edition.review"}) | CUSTOMER_ACTIONS | BIOPHYSICAL_ACTIONS
READS = frozenset({"catalog", "inspect", "table", "preview", "compare", "methods",
                   "customer-review-catalog", "customer-review-inspect", "customer-review-preview",
                   "biophysical-catalog", "biophysical-template", "biophysical-evidence-preview",
                   "biophysical-evidence-inspect", "biophysical-ranges-preview", "biophysical-ranges-inspect"})


class ProfileWorkbench:
    def __init__(self, operator, fault):
        self.operator = operator
        self.Fault = fault


    def _customer_downloads(self, workspace_key, result):
        ws = self.operator.ws(workspace_key)
        collection = result["source_collection_id"]
        downloads, seen = [], set()
        entries = {}
        for row in result.get("files", []):
            source_id = row["source_id"]
            if source_id not in entries:
                _, entries[source_id] = ws.source_file(collection, source_id)
            entry = entries[source_id]
            parts = [entry["body"], *entry.get("companions", [])]
            part = row["part"]
            if isinstance(part, bool) or not isinstance(part, int) or not 0 <= part < len(parts):
                raise ValueError("Choose an actual retained profile review source member")
            body = parts[part]
            if (row["sha256"] != body["sha256"] or row["bytes"] != body["bytes"]
                    or row["path"] != (body.get("view_path") or body["filename"])):
                raise ValueError("Profile review download differs from its original source")
            record = {"path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"],
                      "filename": body["filename"]}
            path = verify_file(ws.root, record)
            ticket = self.operator._ticket(workspace_key, path, record, row["label"])
            if ticket["id"] not in seen:
                downloads.append(ticket)
                seen.add(ticket["id"])
        for application in result.get("applications", []):
            review_id = application["profile_review_id"]
            path = ws.root / "profile-reviews" / (review_id + ".json")
            record = describe_file(ws.root, path, media_type="application/json")
            ticket = self.operator._ticket(workspace_key, path, record, "Applied scientific review")
            if ticket["id"] not in seen:
                downloads.append(ticket)
                seen.add(ticket["id"])
        return downloads

    def _evidence_downloads(self, workspace_key, record, kind):
        ws = self.operator.ws(workspace_key)
        path = ws.root / kind / (record["id"] + ".json")
        downloads = [self.operator._ticket(workspace_key, path,
                     describe_file(ws.root, path, media_type="application/json"),
                     "Coefficient evidence" if kind == evidence.EVIDENCE_KIND else "Selected endpoint profiles")]
        original = record if kind == evidence.EVIDENCE_KIND else evidence.inspect_evidence(ws, record["evidence_id"])
        if kind != evidence.EVIDENCE_KIND:
            evidence_path = ws.root / evidence.EVIDENCE_KIND / (original["id"] + ".json")
            downloads.append(self.operator._ticket(workspace_key, evidence_path,
                             describe_file(ws.root, evidence_path, media_type="application/json"),
                             "Bound coefficient evidence"))
        source = original["source"]
        source_path, entry = ws.source_file(source["source_collection_id"], source["source_id"])
        downloads.append(self.operator._ticket(workspace_key, source_path, entry["body"],
                         "Original coefficient evidence CSV"))
        return downloads

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        value = payload or {}
        if not isinstance(value, dict):
            raise self.Fault("PROFILE_REQUEST", "Use a profile selection object.")
        if operation.startswith(("customer-review-", "biophysical-")):
            value = {key: item for key, item in value.items() if key != "workspace"}
        if operation == "biophysical-catalog":
            result = evidence.catalog(ws, value.get("profile_id"))
        elif operation == "biophysical-template":
            result = evidence.template(ws, value.get("profile_id"))
        elif operation == "biophysical-evidence-preview":
            result = evidence.preview_evidence(ws, value)
        elif operation == "biophysical-evidence-inspect":
            result = evidence.inspect_evidence(ws, value.get("evidence_id"))
            result["_downloads"] = self._evidence_downloads(workspace_key, result, evidence.EVIDENCE_KIND)
        elif operation == "biophysical-ranges-preview":
            result = evidence.preview_ranges(ws, value)
        elif operation == "biophysical-ranges-inspect":
            result = evidence.inspect_ranges(ws, value.get("range_id"))
            result["_downloads"] = self._evidence_downloads(workspace_key, result, evidence.RANGES_KIND)
        elif operation == "customer-review-catalog":
            result = customer_review.catalog(ws, value.get("profile_id"))
        elif operation == "customer-review-inspect":
            result = customer_review.inspect(ws, value.get("capture_id"))
            result["_downloads"] = self._customer_downloads(workspace_key, result)
        elif operation == "customer-review-preview":
            result = customer_review.preview(ws, value)
        elif operation == "catalog":
            result = model.catalog(ws)
        elif operation == "methods":
            result = model.methods()
        elif operation == "inspect":
            result = model.inspect(ws, value.get("profile_id"))
            profile_path = ws.root / "profiles" / (result["profile_id"] + ".json")
            table_path, entry = ws.source_file(result["profile"]["source_collection_id"],
                                               result["profile"]["biophysical_source_id"])
            result["_downloads"] = [
                self.operator._ticket(workspace_key, profile_path,
                                      describe_file(ws.root, profile_path), "Native parameter profile"),
                self.operator._ticket(workspace_key, table_path, entry["body"], "Original coefficient CSV")]
        elif operation == "table":
            active = value.get("models")
            if isinstance(active, str):
                active = json.loads(active) if active.startswith("[") else [part.strip() for part in active.split(",")]
            result = model.read_table(ws, value.get("source_collection_id"),
                                      value.get("biophysical_source_id") or value.get("source_id"),
                                      selected_models=active)
        elif operation == "preview":
            result = model.preview(ws, value)
        elif operation == "compare":
            result = model.compare(ws, value.get("left_profile_id"), value.get("right_profile_id"))
        else:
            raise self.Fault("PROFILE_READ", "Choose a supported profile workbench view.", 404)
        return {"workspace_key": workspace_key, **result}

    def invoke(self, task):
        ws = self.operator.ws(task["workspace"])
        action = task["action"]
        if action == "profile.biophysical.evidence.save":
            return evidence.save_evidence(ws, task["payload"])
        if action == "profile.biophysical.ranges.prepare":
            return evidence.prepare_ranges(ws, task["payload"])
        if action == "profile.biophysical.experiment.prepare":
            return evidence.prepare_experiment(ws, task["payload"])
        if action == "profile.customer_review.create":
            return customer_review.create(ws, task["payload"], operation_id=task["id"],
                                          created_at=task.get("created_at"))
        if action == "profile.customer_review.apply":
            return customer_review.apply(ws, task["payload"], operation_id=task["id"])
        if action == "profile.edition.save":
            return model.save(ws, task["payload"], operation_id=task["id"])
        if action == "profile.edition.review":
            return model.review(ws, task["payload"], operation_id=task["id"])
        raise self.Fault("PROFILE_ACTION", "Choose a supported profile operation.", 404)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or not isinstance(task.get("result"), dict):
            return task
        value = deepcopy(task)
        result = value["result"]
        ws = self.operator.ws(value["workspace"])
        if task["action"] in BIOPHYSICAL_ACTIONS:
            if task["action"] == "profile.biophysical.evidence.save":
                detail = evidence.inspect_evidence(ws, result["id"])
                value["_downloads"] = self._evidence_downloads(value["workspace"], detail, evidence.EVIDENCE_KIND)
            elif task["action"] == "profile.biophysical.ranges.prepare":
                detail = evidence.inspect_ranges(ws, result["id"])
                value["_downloads"] = self._evidence_downloads(value["workspace"], detail, evidence.RANGES_KIND)
            return value
        if task["action"] in CUSTOMER_ACTIONS:
            # Customer capture files are source-relative list entries. Resolve them
            # through their original collection; never treat view paths as outputs.
            detail = customer_review.inspect(ws, result["capture_id"])
            value["_downloads"] = self._customer_downloads(value["workspace"], detail)
            return value
        files = dict(result.get("files") or {})
        if task["action"] == "profile.edition.review" and result.get("review_id"):
            path = ws.root / "profile-reviews" / (result["review_id"] + ".json")
            files["review"] = describe_file(ws.root, path, media_type="application/json")
        downloads = list(value.get("_downloads") or [])
        existing = {row.get("id") for row in downloads}
        for label, record in files.items():
            path = verify_file(ws.root, record)
            ticket = self.operator._ticket(value["workspace"], path, record,
                                            "Profile " + label.replace("_", " "))
            if ticket["id"] not in existing:
                downloads.append(ticket)
                existing.add(ticket["id"])
        value["_downloads"] = downloads
        return value

    def verify_all(self, workspace):
        return {**model.verify_all(workspace),
                "customer_reviews": customer_review.verify_all(workspace),
                "biophysical_evidence": evidence.verify_all(workspace)}
