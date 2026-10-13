"""Queued Community report source preparation on the original operator."""
from __future__ import annotations

from model import community_report_context
from model.common import identifier, verify_file

ACTION = "community.report.source.prepare"


class CommunityReportContext:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def invoke(self, task):
        if task.get("action") != ACTION:
            raise self.Fault("COMMUNITY_REPORT_SOURCE_ACTION", "Choose a saved Community report.", 404)
        value = task.get("payload") or {}
        return community_report_context.prepare(
            self.operator.ws(task["workspace"]), identifier(value.get("report_id")),
            report_sha256=identifier(value.get("report_sha256")),
            delivery_id=value.get("delivery_id") or None)

    def decorate_task(self, task):
        if task.get("action") != ACTION or task.get("state") != "complete":
            return task
        result = task.get("result") or {}
        if result.get("source"):
            ws = self.operator.ws(task["workspace"])
            task["_community_report_source"] = {
                "report_id": result["community_report_id"], "plan_id": result["plan_id"],
                "title": result["title"], "source": result["source"]}
            task["_downloads"] = [
                self.operator._ticket(task["workspace"], verify_file(ws.root, item),
                                      item, item["path"].rsplit("/", 1)[-1])
                for item in result.get("files", [])]
        return task
