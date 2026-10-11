"""Routes composed into the original Bologna HTTP handler; no second server."""
from __future__ import annotations

import io
import json
import zipfile
from urllib.parse import parse_qs, urlparse

import survey

ASSETS = {"/survey": "survey.html", "/survey/": "survey.html", "/survey.html": "survey.html",
          "/survey.js": "survey.js", "/survey.css": "survey.css"}


def _query(handler):
    raw = parse_qs(urlparse(handler.path).query, keep_blank_values=True)
    if any(len(value) != 1 for value in raw.values()):
        raise ValueError("Repeated query arguments are not accepted")
    return {key: value[0] for key, value in raw.items()}


def _analysis(state, query):
    if query.get("publication"):
        return survey.publication_analysis(state, query["publication"])
    return survey.analyze(state, {k: v for k, v in query.items() if k in {"street", "role", "cohort"}})


def get(handler, state_loader):
    """Return True when a survey route handled the request, otherwise False."""
    path = urlparse(handler.path).path
    if not path.startswith("/api/survey"):
        return False
    try:
        query = _query(handler)
        if path == "/api/survey/schema":
            handler.send_json(200, survey.schema())
        elif path == "/api/survey/template":
            handler.send_bytes(200, survey.template_csv(), "text/csv; charset=utf-8")
        else:
            state = state_loader(handler.server.state_root)
            if path == "/api/survey":
                handler.send_json(200, survey.view(state, {k: v for k, v in query.items() if k in {"street", "role", "cohort"}}))
            elif path == "/api/survey/questionnaire":
                handler.send_bytes(200, survey.questionnaire_html(state), "text/html; charset=utf-8")
            elif path == "/api/survey/source":
                handler.send_bytes(200, survey.source_bytes(state, query.get("id")), "text/csv; charset=utf-8")
            elif path == "/api/survey/report":
                handler.send_bytes(200, survey.render_report(_analysis(state, query), query.get("language", "it")), "text/html; charset=utf-8")
            elif path == "/api/survey/export":
                analysis = _analysis(state, query)
                files = survey.export_tables(analysis)
                files["manifest.json"] = survey._bytes({"schema": "bologna-survey-export/v1", "workspaceRevision": analysis["workspaceRevision"],
                    "publicationId": query.get("publication") or None,
                    "files": [{"name": name, "bytes": len(content), "sha256": survey._hash(content)} for name, content in files.items()]})
                out = io.BytesIO()
                with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for name, content in sorted(files.items()):
                        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = 0o600 << 16
                        archive.writestr(info, content)
                handler.send_bytes(200, out.getvalue(), "application/zip")
            else:
                handler.send_json(404, {"error": "NOT_FOUND"})
    except (ValueError, KeyError, TypeError) as exc:
        handler.send_json(400, {"error": "INVALID_SURVEY_REQUEST", "message": str(exc)})
    return True


def check_post(handler):
    """Refuse cross-origin browser writes; command-line JSON clients remain usable."""
    if handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ValueError("Content-Type must be application/json")
    origin = handler.headers.get("Origin")
    if origin:
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or parsed.netloc != handler.headers.get("Host"):
            raise ValueError("Cross-origin workspace writes are not accepted")


def preview(handler, state_loader):
    if urlparse(handler.path).path != "/api/survey/preview":
        return False
    try:
        check_post(handler)
        length = int(handler.headers.get("Content-Length", "0"))
        if not 2 <= length <= 1_000_000:
            raise ValueError("JSON body must be 2–1000000 bytes")
        payload = json.loads(handler.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("Preview payload must be an object")
        handler.send_json(200, survey.preview_import(state_loader(handler.server.state_root), payload))
    except (ValueError, KeyError, TypeError) as exc:
        handler.send_json(400, {"error": "INVALID_SURVEY_PREVIEW", "message": str(exc)})
    return True
