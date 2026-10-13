"""Dataset publication routes inside the original Analysis auth boundary."""
from __future__ import annotations

from . import _analysis_publication_ui
from .analysis_publication import _fields, _need


def assets():
    return {"/publication": (_analysis_publication_ui.HTML, "text/html;charset=utf-8"),
            "/publication.js": (_analysis_publication_ui.JS, "text/javascript;charset=utf-8"),
            "/publication.css": (_analysis_publication_ui.CSS, "text/css;charset=utf-8")}


def _page(query):
    _need(not set(query) - {"before", "limit"}
          and all(len(v) == 1 for v in query.values()), "QUERY_FIELDS_INVALID")
    return {"before": int(query["before"][0]) if "before" in query else None,
            "limit": int(query.get("limit", ["25"])[0])}


def _send(handler, download):
    # The component's operation owns verification, streaming and cleanup.
    with download as (stream, record):
        handler.send_response(200)
        handler.send_header("Content-Type", record["mime"])
        handler.send_header("Content-Length", str(record["bytes"]))
        handler.send_header("X-Content-SHA256", record["sha256"])
        handler._headers(record["name"])
        handler.end_headers()
        if handler.command != "HEAD":
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                handler.wfile.write(chunk)


def get(handler, workspace, url, query, parts):
    if handler.command not in {"GET", "HEAD"} or parts[:2] != ["api", "publication"]:
        return False
    publication = workspace.publications
    if parts == ["api", "publication", "configuration"]:
        _need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, publication.configuration())
    elif parts == ["api", "publication", "exports"]:
        handler._reply(200, publication.exports(**_page(query)))
    elif parts == ["api", "publication", "recipes"]:
        handler._reply(200, publication.recipes(**_page(query)))
    elif parts == ["api", "publication", "jobs"]:
        handler._reply(200, publication.history(**_page(query)))
    elif parts == ["api", "publication", "source-jobs"]:
        handler._reply(200, publication.sources.history(**_page(query)))
    elif len(parts) == 4 and parts[:3] == ["api", "publication", "recipes"]:
        _need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, publication.recipe(parts[3]))
    elif (len(parts) == 5 and parts[:3] == ["api", "publication", "jobs"]
          and parts[4] in {"downloads", "package"}):
        _need(not query, "QUERY_FIELDS_INVALID")
        method = publication.downloads if parts[4] == "downloads" else publication.sources.package_view
        handler._reply(200, method(parts[3]))
    elif (len(parts) == 5 and parts[:3] == ["api", "publication", "source-jobs"]
          and parts[4] == "downloads"):
        _need(not query, "QUERY_FIELDS_INVALID")
        handler._reply(200, publication.sources.downloads(parts[3]))
    elif (len(parts) == 5 and parts[:2] == ["api", "publication"]
          and parts[2] in {"jobs", "source-jobs"} and parts[4] == "file"):
        _need(set(query) <= {"name", "sha256"} and "name" in query
              and all(len(v) == 1 for v in query.values()), "DOWNLOAD_REQUIRED")
        owner = publication if parts[2] == "jobs" else publication.sources
        _send(handler, owner.download(parts[3], query["name"][0],
                                      expected_sha256=query.get("sha256", [None])[0]))
    else:
        return False
    return True


def post(handler, workspace, url, parts, body):
    if parts[:2] != ["api", "publication"]:
        return False
    _need(not url.query, "QUERY_FIELDS_INVALID")
    publication = workspace.publications
    if parts == ["api", "publication", "review"]:
        _fields(body, {"query_export_id"}, {"manifest_sha256", "sample_rows"})
        handler._reply(200, publication.review(
            body["query_export_id"], manifest_sha256=body.get("manifest_sha256"),
            sample_rows=body.get("sample_rows", 20)))
    elif parts == ["api", "publication", "recipes"]:
        handler._reply(201, publication.save_recipe(body))
    elif parts == ["api", "publication", "source-read"]:
        handler._reply(200, publication.sources.read(body))
    elif (len(parts) == 5 and parts[:2] == ["api", "publication"]
          and parts[2] in {"jobs", "source-jobs"} and parts[4] == "cancel"):
        _need(not body, "CANCEL_FIELDS_INVALID")
        handler._reply(200, publication.cancel(parts[3]))
    else:
        return False
    return True
