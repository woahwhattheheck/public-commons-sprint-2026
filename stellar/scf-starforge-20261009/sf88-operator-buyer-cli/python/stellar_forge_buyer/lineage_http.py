"""Additive routes under the existing Analysis capability/origin boundary."""
from __future__ import annotations

from . import _analysis_lineage_ui
from .analysis_lineage_projection import need


def assets():
    return {"/lineage": (_analysis_lineage_ui.HTML, "text/html;charset=utf-8"),
            "/lineage.js": (_analysis_lineage_ui.JS, "text/javascript;charset=utf-8"),
            "/lineage.css": (_analysis_lineage_ui.CSS, "text/css;charset=utf-8")}


def _page(query):
    need(not set(query) - {"before", "limit"}, "QUERY_FIELDS_INVALID")
    return {"before": int(query["before"][0]) if "before" in query else None,
            "limit": int(query.get("limit", ["25"])[0])}


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"} or parts[:2] != ["api", "lineage"]:
        return False
    if parts == ["api", "lineage", "configuration"]:
        need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, workspace.lineage.configuration())
    elif parts == ["api", "lineage", "jobs"]:
        handler._reply(200, workspace.lineage.jobs(**_page(query)))
    elif parts == ["api", "lineage", "plans"]:
        handler._reply(200, workspace.lineage.plans(**_page(query)))
    elif len(parts) == 4 and parts[:3] == ["api", "lineage", "plans"]:
        need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, workspace.lineage.plan(parts[3]))
    elif len(parts) == 5 and parts[:3] == ["api", "lineage", "plans"] and parts[4] == "downloads":
        need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, workspace.lineage.downloads(parts[3]))
    elif len(parts) == 5 and parts[:3] == ["api", "lineage", "plans"] and parts[4] == "file":
        need("name" in query and not set(query) - {"name", "sha256"} and
             all(len(values) == 1 for values in query.values()), "DOWNLOAD_REQUIRED")
        result = workspace.lineage.download(parts[3], query["name"][0],
                                            expected_sha256=query.get("sha256", [None])[0])
        raw = result["bytes"]
        handler.send_response(200)
        handler.send_header("Content-Type", result["mime"])
        handler.send_header("Content-Length", str(len(raw)))
        handler.send_header("X-Content-SHA256", result["sha256"])
        handler._headers(result["filename"])
        handler.end_headers()
        if handler.command != "HEAD":
            handler.wfile.write(raw)
    else:
        return False
    return True


def post(handler, workspace, url, parts, body):
    if parts[:2] != ["api", "lineage"]:
        return False
    need(not url.query, "QUERY_FIELDS_INVALID")
    if parts == ["api", "lineage", "review"]:
        handler._reply(200, workspace.lineage.review(body))
    elif parts == ["api", "lineage", "plans"]:
        handler._reply(201, workspace.lineage.save_plan(body))
    elif (len(parts) == 5 and parts[:3] == ["api", "lineage", "publications"]
          and parts[4] == "cancel"):
        need(not body, "CANCEL_FIELDS_INVALID")
        handler._reply(200, workspace.lineage.cancel(parts[3]))
    else:
        return False
    return True
