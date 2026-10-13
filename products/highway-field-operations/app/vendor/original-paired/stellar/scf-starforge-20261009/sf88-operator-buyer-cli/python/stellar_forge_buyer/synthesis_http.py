"""Synthesis routes on the original Analysis origin and capability owner."""
from ._analysis_export_http import send_export
from .evidence_synthesis import need


def assets():
    from . import _analysis_synthesis_ui as ui
    return {"/synthesis": (ui.HTML, "text/html;charset=utf-8"),
            "/synthesis.js": (ui.JS, "text/javascript;charset=utf-8"),
            "/synthesis.css": (ui.CSS, "text/css;charset=utf-8")}


def _only(query, allowed):
    need(not set(query) - set(allowed), "QUERY_FIELDS_INVALID")


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"}:
        return False
    value = lambda key, default=None: query.get(key, [default])[0]
    optional_int = lambda key: int(value(key)) if value(key) is not None else None
    owner = workspace.synthesis
    result = None
    if url.path == "/api/synthesis":
        _only(query, {"kind", "before", "limit"})
        result = owner.history(kind=value("kind", "protocols"), before=optional_int("before"),
                               limit=int(value("limit", "25")))
    elif len(parts) == 3 and parts[:2] == ["api", "synthesis-publications"]:
        _only(query, {"revision", "offset", "limit"})
        result = owner.publication(parts[2], revision=optional_int("revision"),
                                   offset=int(value("offset", "0")), limit=int(value("limit", "50")))
    elif len(parts) == 4 and parts[:2] == ["api", "synthesis-publications"] and parts[3] == "source":
        need(set(query) == {"revision"}, "SOURCE_REVISION_REQUIRED")
        with owner.download_publication(parts[2], int(value("revision"))) as (stream, record):
            send_export(handler, stream, record)
        return True
    elif len(parts) == 3 and parts[:2] == ["api", "synthesis-protocols"]:
        _only(query, {"revision"})
        result = owner.protocol(parts[2], revision=optional_int("revision"))
    elif len(parts) == 3 and parts[:2] == ["api", "synthesis-runs"]:
        _only(query, {})
        result = owner.result(parts[2])
    elif len(parts) == 5 and parts[:2] == ["api", "synthesis-runs"] and parts[3] == "files":
        _only(query, {})
        with owner.download(parts[2], parts[4]) as (stream, record):
            send_export(handler, stream, record)
        return True
    else:
        return False
    handler._reply(200, result)
    return True


def post(handler, workspace, url, parts, body):
    owner = workspace.synthesis
    if url.path == "/api/synthesis-publications":
        result = owner.import_publication(body)
    elif url.path == "/api/synthesis-protocols":
        result = owner.save_protocol(body)
    elif url.path == "/api/synthesis-review":
        need(set(body) == {"name", "revision"}, "REVIEW_FIELDS_INVALID")
        result = owner.review(body["name"], revision=body["revision"])
    elif url.path == "/api/synthesis-runs":
        result = workspace.start("synthesis", body)
    elif len(parts) == 4 and parts[:2] == ["api", "synthesis-runs"] and parts[3] == "cancel":
        need(not body, "CANCEL_FIELDS_INVALID")
        result = owner.cancel(parts[2])
    else:
        return False
    handler._reply(200, result)
    return True
