"""Community report sources and complete original report handovers."""
from model import community_report_context, community_report_handover
from model.common import identifier, verify_file

PREPARE = "community.report.source.prepare"
EXPORT = "community.report.handover.export"
RECEIVE = "community.report.handover.receive"
ACTIONS = (PREPARE, EXPORT, RECEIVE)


class CommunityReportContext:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def read(self, workspace_key, operation, payload):
        if operation != "handover-preview":
            raise self.Fault("COMMUNITY_REPORT_READ", "Choose a Community source handover.", 404)
        self.operator.ws(workspace_key)
        uploaded = self.operator.upload(identifier(payload.get("upload_id")))
        inspected = community_report_handover.inspect_archive(
            uploaded["path"], expected_sha256=uploaded["sha256"])
        return {"workspace_key": workspace_key,
                "upload": {key: uploaded[key] for key in ("id", "filename", "bytes", "sha256")},
                "handover": inspected}

    def invoke(self, task):
        action = task.get("action")
        if action not in ACTIONS:
            raise self.Fault("COMMUNITY_REPORT_ACTION", "Choose a Community report source operation.", 404)
        value = task.get("payload") or {}
        workspace = self.operator.ws(task["workspace"])
        if action == EXPORT:
            return community_report_handover.export(
                workspace, identifier(value.get("report_id")),
                report_sha256=identifier(value.get("report_sha256")))
        if action == RECEIVE:
            uploaded = self.operator.upload(identifier(value.get("upload_id")))
            expected = identifier(value.get("archive_sha256"))
            if uploaded["sha256"] != expected:
                raise self.Fault("COMMUNITY_HANDOVER_CHANGED",
                                 "The selected original report handover changed.", 409)
            return community_report_handover.receive(
                workspace, uploaded["path"], expected_sha256=expected,
                delivery_id=value.get("delivery_id") or None)
        return community_report_context.prepare(
            workspace, identifier(value.get("report_id")),
            report_sha256=identifier(value.get("report_sha256")),
            delivery_id=value.get("delivery_id") or None)

    def decorate_task(self, task):
        if task.get("action") not in ACTIONS or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        if result.get("source"):
            task["_community_report_source"] = {
                "report_id": result["community_report_id"],
                "plan_id": result["plan_id"], "title": result["title"],
                "source": result["source"]}
        if result.get("files"):
            workspace = self.operator.ws(task["workspace"])
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], verify_file(workspace.root, item),
                                      item, item["path"].rsplit("/", 1)[-1])
                for item in result["files"]]
        return task
