"""Authenticated HTTP adapter for the original SF47 local workspace."""
from __future__ import annotations

from urllib.parse import parse_qs, unquote
import re

from model import Problem
from operations import Operations, decoded


def register_static(static):
    static.update({"/operations_implementation.mjs": ("operations_implementation.mjs", "text/javascript; charset=utf-8"),
                   "/operations_implementation.css": ("operations_implementation.css", "text/css; charset=utf-8"),
                   "/operations_cohort.mjs": ("operations_cohort.mjs", "text/javascript; charset=utf-8"),
                   "/operations_cohort.css": ("operations_cohort.css", "text/css; charset=utf-8"),
                   "/operations_installations.mjs": ("operations_installations.mjs", "text/javascript; charset=utf-8"),
                   "/operations_installations.css": ("operations_installations.css", "text/css; charset=utf-8"),
                   "/operations_buyer.mjs": ("operations_buyer.mjs", "text/javascript; charset=utf-8"),
                   "/operations_buyer.css": ("operations_buyer.css", "text/css; charset=utf-8"),
                   "/operations_completion.mjs": ("operations_completion.mjs", "text/javascript; charset=utf-8"),
                   "/operations_completion.css": ("operations_completion.css", "text/css; charset=utf-8"),
                   "/operations_support.mjs": ("operations_support.mjs", "text/javascript; charset=utf-8"),
                   "/operations.mjs": ("operations.mjs", "text/javascript; charset=utf-8"),
                   "/operations.css": ("operations.css", "text/css; charset=utf-8"),
                   "/forecast.mjs": ("forecast.mjs", "text/javascript; charset=utf-8"),
                   "/forecast.css": ("forecast.css", "text/css; charset=utf-8"),
                   "/portfolio.mjs": ("portfolio.mjs", "text/javascript; charset=utf-8"),
                   "/portfolio.css": ("portfolio.css", "text/css; charset=utf-8")})


def store(handler):
    with handler.server.workspace.mutex:
        if not hasattr(handler.server, "operations"):
            handler.server.operations = Operations(handler.server.workspace)
        return handler.server.operations


def read(handler, parsed):
    if not parsed.path.startswith("/api/operations"):
        return False
    ops, query = store(handler), parse_qs(parsed.query)
    path = parsed.path
    if path == "/api/operations":
        handler.send(200, {"cases": ops.list(query.get("planId", [None])[0])})
        return True
    match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})(?:/(report|history|export.zip|installations(?:/installation-[a-f0-9]{32}(?:/history|/export.zip)?)?|completion|completion-reviews/review-[a-f0-9]{32}/export.zip|cohort-reviews/review-[a-f0-9]{32}/export.zip|implementation-reviews/review-[a-f0-9]{32}/export.zip|implementation-originals/source-[a-f0-9]{32}/[a-f0-9]{64}|sources/source-[a-f0-9]{32}|reviews/review-[a-f0-9]{32}|forecasts(?:/forecast-[a-f0-9]{32}(?:/export.zip)?)?|portfolios(?:/portfolio-[a-f0-9]{32}(?:/export.zip)?)?))?", path)
    if not match:
        raise Problem("Operations page not found.", 404, "NOT_FOUND")
    ident, action = match.groups()
    if not action:
        handler.send(200, ops.read(ident))
    elif action == "report":
        handler.send(200, ops.report(ident))
    elif action == "history":
        handler.send(200, ops.history(ident, int(query.get("after", ["0"])[0]), int(query.get("limit", ["100"])[0])))
    elif action == "export.zip":
        handler.send(200, ops.export(ident), "application/zip", ident + ".zip")
    elif action == "installations":
        handler.send(200, {"installations": ops.list_installations(ident)})
    elif action.startswith("installations/"):
        installation_id = action.split("/")[1]
        selected = query.get("revision", [None])[0]
        revision = int(selected) if selected is not None else None
        if action.endswith("/history"):
            before = query.get("before", [None])[0]
            handler.send(200, ops.installation_history(ident, installation_id,
                int(before) if before is not None else None, int(query.get("limit", ["25"])[0])))
        elif action.endswith("/export.zip"):
            if revision is None:
                raise Problem("Select the saved installation edition for this complete handover.", 422, "INVALID_INSTALLATION")
            handler.send(200, ops.export_installation(ident, installation_id, revision), "application/zip",
                         installation_id + "-edition-" + str(revision) + ".zip")
        else:
            handler.send(200, ops.installation(ident, installation_id, revision))
    elif action == "completion":
        handler.send(200, ops.completion_calendar(ident, query.get("asOfDate", [None])[0]))
    elif action.startswith("implementation-reviews/"):
        review_id = action.split("/")[1]
        handler.send(200, ops.export_implementation(ident, review_id), "application/zip", review_id + "-implementation.zip")
    elif action.startswith("implementation-originals/"):
        _, source_id, sha256 = action.split("/")
        metadata, raw = ops.implementation_original(ident, source_id, sha256)
        safe_name = re.sub(r'[^A-Za-z0-9._ -]', "_", metadata["filename"])
        handler.send(200, raw, "application/octet-stream", safe_name)
    elif action.startswith("cohort-reviews/"):
        review_id = action.split("/")[1]
        handler.send(200, ops.export_cohort(ident, review_id), "application/zip", review_id + "-cohort.zip")
    elif action.startswith("completion-reviews/"):
        review_id = action.split("/")[1]
        handler.send(200, ops.export_completion(ident, review_id), "application/zip", review_id + "-completion.zip")
    elif action == "forecasts":
        handler.send(200, {"forecasts": ops.list_forecasts(ident)})
    elif action.startswith("forecasts/"):
        fid = action.split("/")[1]
        if action.endswith("/export.zip"):
            handler.send(200, ops.export_forecast(ident, fid), "application/zip", fid + ".zip")
        else:
            handler.send(200, ops.forecast(ident, fid))
    elif action == "portfolios":
        handler.send(200, {"portfolios": ops.list_portfolios(ident)})
    elif action.startswith("portfolios/"):
        pid = action.split("/")[1]
        if action.endswith("/export.zip"):
            handler.send(200, ops.export_portfolio(ident, pid), "application/zip", pid + ".zip")
        else:
            handler.send(200, ops.portfolio(ident, pid))
    elif action.startswith("sources/"):
        metadata, raw = ops.source(ident, action.split("/")[1])
        # All original documents are downloads, never executable inline content.
        safe_name = re.sub(r'[^A-Za-z0-9._ -]', "_", metadata["filename"])
        handler.send(200, raw, "application/octet-stream", safe_name)
    else:
        handler.send(200, ops.review(ident, action.split("/")[1]))
    return True


def write(handler, parsed):
    if not parsed.path.startswith("/api/operations"):
        return False
    ops, path = store(handler), parsed.path
    if path == "/api/operations/import":
        query = parse_qs(parsed.query)
        result = ops.import_bundle(handler.raw_body(), query.get("name", ["Imported delivery operations"])[0],
                                   handler.headers.get("X-Request-ID"), unquote(handler.headers.get("X-Recorded-By", "")))
    elif path == "/api/operations/intake":
        from operations_intake import import_source_intake
        body = handler.json_body()
        raw = decoded(body.pop("packetBase64", None))
        result = import_source_intake(ops, raw, body)
    elif path == "/api/operations":
        result = ops.create(handler.json_body())
    else:
        match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})/(command|implementation-source|implementation-preview|cohort-seed|cohort-preview|installation-seed|installation-preview|completion-seed|completion-preview|support-preview|buyer-preview|forecast-preview|portfolio-preview|portfolio-seed|portfolio-selection)", path)
        if not match:
            raise Problem("Operations command not found.", 404, "NOT_FOUND")
        body = handler.json_body()
        methods = {"command": ops.command, "implementation-source": ops.seed_implementation,
                   "implementation-preview": ops.preview_implementation, "cohort-seed": ops.seed_cohort, "cohort-preview": ops.preview_cohort, "installation-seed": ops.seed_installation,
                   "installation-preview": ops.preview_installation, "completion-seed": ops.seed_completion, "completion-preview": ops.preview_completion,
                   "support-preview": ops.preview_support, "buyer-preview": ops.preview_buyer,
                   "forecast-preview": ops.preview_forecast,
                   "portfolio-preview": ops.preview_portfolio, "portfolio-seed": ops.seed_portfolio,
                   "portfolio-selection": ops.select_portfolio}
        result = methods[match.group(2)](match.group(1), body)
    handler.send(200, result)
    return True
