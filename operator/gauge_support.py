"""Gauge support in the current operator queue and verified file transport."""
from copy import deepcopy
from pathlib import Path
from model import gauge_support, gauge_report_context, observed_context
from model.common import identifier, read_json, verify_file

ACTIONS = frozenset(("gauge.support.build", "gauge.support.report"))


class GaugeSupport:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def overview(self, workspace_key):
        return [{key: row.get(key) for key in ("id", "title", "created_at", "summary", "selection")}
                for row in self.operator.ws(workspace_key)._list(gauge_support.KIND)]

    def _report_choice(self, workspace_key, value):
        """Expose the original ordered report sources to the existing composer."""
        if not value or not value.get("source"):
            return value
        result = deepcopy(value)
        workspace = self.operator.ws(workspace_key)
        source = result["source"]
        selection = result.get("delivery_selection")
        if selection is None:
            selection = gauge_report_context.delivery_selection(workspace, source)
        sources = observed_context.source_choices(selection)
        if source not in sources:
            raise self.Fault("GAUGE_REPORT_SOURCE", "The prepared Gauge source is missing from its report selection.", 422)
        unused_path, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
        result["scientific_report_selection"] = {"workspace_key": workspace_key,
            "sources": deepcopy(sources), "title": entry["title"]}
        return result

    def _report(self, workspace_key, edition_id):
        ws = self.operator.ws(workspace_key)
        value = gauge_report_context.latest(ws, identifier(edition_id))
        if value is not None:
            value["_downloads"] = [self.operator._ticket(workspace_key,
                verify_file(ws.root, item), item, Path(item["path"]).name)
                for item in value.get("files", [])]
        return self._report_choice(workspace_key, value)

    def _edition(self, workspace_key, edition_id, complete=True):
        ws = self.operator.ws(workspace_key)
        row = gauge_support.inspect(ws, identifier(edition_id), verify=True, include_result=complete)
        row["workspace_key"] = workspace_key
        row["_downloads"] = [self.operator._ticket(workspace_key,
            verify_file(ws.root, item), item, item.get("label") or Path(item["path"]).name)
            for item in row["files"]]
        if complete:
            row["scientific_report"] = self._report(workspace_key, edition_id)
            for name, key in (("catchments.geojson","catchments"),("regional-hucs.geojson","hucs"),
                              ("gauges.geojson","gauges")):
                item = next(item for item in row["files"] if Path(item["path"]).name == name)
                row[key] = read_json(verify_file(ws.root, item))
        return row

    def read(self, workspace_key, operation, payload=None):
        payload = payload or {}
        ws = self.operator.ws(workspace_key)
        if operation == "catalog":
            return {"workspace_key": workspace_key, **gauge_support.catalog(ws)}
        if operation == "report":
            return self._report(workspace_key, payload.get("id") or payload.get("edition_id"))
        if operation == "edition":
            return self._edition(workspace_key, payload.get("id") or payload.get("edition_id"))
        if operation == "verify":
            row = gauge_support.inspect(ws, payload.get("id"), verify=True)
            return {"workspace_key": workspace_key, "id": row["id"], "verified": True}
        raise self.Fault("GAUGE_SUPPORT_READ", "Choose a registered gauge support read.", 422)

    def invoke(self, task):
        if task.get("action") not in ACTIONS:
            raise self.Fault("GAUGE_SUPPORT_ACTION", "Choose a registered gauge support action.", 422)
        payload = task.get("payload") or {}
        if task["action"] == "gauge.support.report":
            result = gauge_report_context.prepare(self.operator.ws(task["workspace"]),
                payload.get("edition_id"), delivery_id=payload.get("delivery_id") or None,
                render=payload.get("render", True))
            return self._report_choice(task["workspace"], result)
        result = gauge_support.build(self.operator.ws(task["workspace"]), payload.get("selection", payload))
        return {key: result.get(key) for key in ("id","title","summary","selection","build_id")}

    def decorate_task(self, task):
        if task.get("action") == "gauge.support.report" and task.get("state") == "complete":
            result = self._report_choice(task["workspace"], task.get("result") or {})
            task["result"] = result
            ws = self.operator.ws(task["workspace"])
            task.setdefault("_downloads", []).extend(self.operator._ticket(task["workspace"],
                verify_file(ws.root, item), item, Path(item["path"]).name) for item in result.get("files", []))
            task["_gauge_support"] = {"id": result.get("gauge_support_id"),
                "title": "Gauge scientific report", "view": "gauge-support"}
            return task
        if task.get("action") in ACTIONS and task.get("state") == "complete" and (task.get("result") or {}).get("id"):
            row = self._edition(task["workspace"], task["result"]["id"], complete=False)
            task.setdefault("_downloads", []).extend(row["_downloads"])
            task["_gauge_support"] = {"id": row["id"], "title": row["title"], "view": "gauge-support"}
        return task
