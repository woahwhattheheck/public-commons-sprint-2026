"""Capability-authenticated routes for the original report review component."""
from __future__ import annotations
import hashlib
from . import _analysis_report_reviews_ui as ui
from .analysis_report_reviews import encoded, fail

def assets():
    return {"/report-reviews": (ui.HTML, "text/html;charset=utf-8"),
            "/report-reviews.js": (ui.JS, "text/javascript;charset=utf-8"),
            "/report-reviews.css": (ui.CSS, "text/css;charset=utf-8")}

def send(handler, body, mime, name):
    raw = body.encode("utf-8") if isinstance(body, str) else body
    handler.send_response(200)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("X-Content-SHA256", hashlib.sha256(raw).hexdigest())
    handler._headers(name)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(raw)

def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"}:
        return False
    get = lambda key, default=None: query.get(key, [default])[0]
    manager = workspace.report_reviews
    if parts == ["api", "report-reviews"]:
        if set(query) - {"before", "limit"}:
            fail("QUERY_INVALID")
        handler._reply(200, manager.history(before=int(get("before")) if get("before") else None, limit=int(get("limit", "25"))))
        return True
    if len(parts) in {3,4} and parts[:2] == ["api", "report-reviews"]:
        if set(query) - ({"returns_before", "applies_before", "limit"} if len(parts) == 3 else set()):
            fail("QUERY_INVALID")
        if len(parts) == 3:
            handler._reply(200, manager.detail(parts[2], returns_before=int(get("returns_before")) if get("returns_before") else None,
                                              applies_before=int(get("applies_before")) if get("applies_before") else None,
                                              limit=int(get("limit", "25"))))
            return True
        if parts[3] in {"review.html", "package.json"}:
            package = manager.package(parts[2])
            if parts[3] == "review.html":
                send(handler, ui.recipient_html(package), "text/html;charset=utf-8", "Report_Review_" + parts[2] + ".html")
            else:
                send(handler, encoded(package) + b"\n", "application/json;charset=utf-8", "Report_Review_Package_" + parts[2] + ".json")
            return True
    if len(parts) == 3 and parts[:2] == ["api", "report-review-returns"]:
        if query:
            fail("QUERY_INVALID")
        handler._reply(200, manager.returned(parts[2]))
        return True
    if len(parts) == 3 and parts[:2] == ["api", "report-review-applies"]:
        if query:
            fail("QUERY_INVALID")
        handler._reply(200, manager.apply_status(parts[2]))
        return True
    return False

def post(handler, workspace, url, parts, body):
    manager = workspace.report_reviews
    if parts == ["api", "report-reviews"]:
        handler._reply(200, manager.issue(body))
        return True
    if parts == ["api", "report-review-returns"]:
        handler._reply(200, manager.receive(body))
        return True
    if len(parts) == 4 and parts[:2] == ["api", "report-review-returns"]:
        if parts[3] == "preview":
            if set(body) - {"mapping"}:
                fail("PREVIEW_FIELDS_INVALID")
            handler._reply(200, manager.preview(parts[2], body.get("mapping")))
            return True
        if parts[3] == "apply":
            handler._reply(200, manager.apply(parts[2], body))
            return True
    return False
