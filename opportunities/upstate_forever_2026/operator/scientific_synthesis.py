"""Scientific synthesis on the original SourceReports queue and file transport."""
from __future__ import annotations
from pathlib import Path
from model.common import digest
from model import scientific_synthesis as model
from model import scientific_synthesis_catalog as references

class ScientificSynthesis:
    def __init__(self, operator, fault, source_reports):
        self.operator, self.Fault, self.source_reports = operator, fault, source_reports

    def read(self, workspace, operation, payload):
        ws = self.operator.ws(workspace)
        if operation == "synthesis-catalog":
            return {"workspace_key":workspace, "project_id":ws.project["id"],
                    "editions":model.list_editions(ws)}
        if operation == "synthesis-references":
            return {"workspace_key":workspace, "project_id":ws.project["id"],
                    "catalog":references.catalog(ws,payload.get("sources"))}
        if operation == "synthesis-operation":
            operation_id = model._id(payload.get("operation_id"), "Original operation ID")
            rows = [row for row in model.list_editions(ws) if row["operation_id"] == operation_id]
            if any(row["request_sha256"] != digest(payload) for row in rows):
                raise ValueError("The original operation ID names a different request")
            return {"workspace_key":workspace,"received":model.inspect(ws,rows[0]["collection_id"]) if rows else None}
        if operation == "synthesis-edition":
            return {"workspace_key":workspace, "project_id":ws.project["id"],
                    **model.inspect(ws,payload.get("collection_id"))}
        raise self.Fault("SCIENTIFIC_SYNTHESIS_READ","Choose an original synthesis source.",404)

    def invoke(self, task):
        workspace = task["workspace"]
        def archive_source(collection_id):
            result = self.source_reports.archive(workspace,{"collection_id":collection_id})
            ticket = result["download"]
            with self.operator.lock:
                retained = dict(self.operator.downloads[ticket["id"]])
            if retained["workspace"] != workspace or any(retained[k] != ticket[k] for k in ("bytes","sha256")):
                raise ValueError("The original source download ticket changed")
            collection = self.operator.ws(workspace).retained_item("sources",collection_id)
            return {"path":retained["path"],"descriptor":ticket,
                    "title":collection.get("title",collection_id),
                    **{key:result[key] for key in ("source_ids","manifest_member","original_manifest_sha256")}}
        return model.save(self.operator.ws(workspace),task["payload"],
                          archive_source=archive_source,
                          staging_root=self.operator.root/"outputs"/"scientific-synthesis-staging",
                          created_at=task["created_at"])

    def decorate_task(self, task):
        if task["action"] != "source-reports.synthesis-save" or task["state"] != "complete":
            return task
        result = task.get("result") or {}
        collection = result.get("collection_id")
        if not collection:
            return task
        archive = self.source_reports.archive(task["workspace"],{"collection_id":collection})
        return {**task,"_downloads":[archive["download"]]}

    def verify_workspace(self, workspace):
        rows = model.list_editions(workspace)
        for row in rows:
            model.inspect(workspace,row["collection_id"])
        return {"scientific_synthesis_editions":len(rows)}
