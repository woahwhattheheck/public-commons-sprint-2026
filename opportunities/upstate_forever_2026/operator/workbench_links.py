"""Opening recovery on the existing operator; no new server or credential store.

Only public static recovery assets are eligible for the browser's offline cache.
Original reports, API responses, input data and session tokens remain uncached.
"""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

EDITION = "upstate.workbench-links/1"
WEB = Path(__file__).with_name("web")
ASSETS = {
    "/workbench-recovery-sw.mjs": ("workbench_recovery_sw.mjs", "text/javascript"),
    "/web/workbench_links.mjs": ("workbench_links.mjs", "text/javascript"),
    "/web/workbench_links.css": ("workbench_links.css", "text/css"),
    "/web/workbench_reopen.html": ("workbench_reopen.html", "text/html"),
}
# These are old document routes, not aliases for scientific records or API calls.
LEGACY_VIEWS = {"/designations.html": "water-designations",
                "/web/designations.html": "water-designations"}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; "
       "connect-src 'self'; img-src 'self' data:; object-src 'none'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'self'")


def portable_opening_html() -> bytes:
    """A complete offline opening file with no machine path, port or capability."""
    body = (WEB / "workbench_reopen.html").read_text("utf-8")
    style = (WEB / "workbench_links.css").read_text("utf-8")
    script = (WEB / "workbench_links.mjs").read_text("utf-8")
    # Inline modules run from file:// without needing to fetch another local file.
    body = body.replace('<link rel="stylesheet" href="/web/workbench_links.css">',
                        "<style>" + style.replace("</style", "<\\/style") + "</style>")
    body = body.replace('<script type="module" src="/web/workbench_links.mjs"></script>',
                        '<script type="module">' + script.replace("</script", "<\\/script") + "</script>")
    return body.encode("utf-8")


def _send(handler, body: bytes, mime: str, *, status=200, portable=False,
          service_worker=False):
    handler.close_connection = True
    handler.send_response(status)
    handler.send_header("Content-Type", mime + "; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Connection", "close")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Upstate-Recovery-Edition", EDITION)
    if service_worker:
        handler.send_header("Service-Worker-Allowed", "/")
    if portable:
        handler.send_header("Content-Disposition", 'attachment; filename="Reopen_Workbench.html"')
    policy = CSP.replace("script-src 'self'", "script-src 'unsafe-inline'").replace(
        "style-src 'self'", "style-src 'unsafe-inline'") if portable else CSP
    handler.send_header("Content-Security-Policy", policy)
    handler.end_headers()
    handler.wfile.write(body)


def serve(handler, target: str) -> bool:
    """Called after the original Host/origin check, before ordinary API routing."""
    parts = urlsplit(target)
    if parts.path in LEGACY_VIEWS:
        handler.close_connection = True
        handler.send_response(302)
        # The original fragment, including a supplied login token, is retained by
        # normal browser redirect handling. It never appears in this HTTP header.
        handler.send_header("Location", "/?view=" + LEGACY_VIEWS[parts.path])
        handler.send_header("Content-Length", "0")
        handler.send_header("Connection", "close")
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Referrer-Policy", "no-referrer")
        handler.end_headers()
        return True
    if parts.path == "/workbench-link-status":
        _send(handler, json.dumps({"schema": EDITION,
            "ready": not handler.app.closing}).encode("utf-8"), "application/json")
        return True
    item = ASSETS.get(parts.path)
    if item is None:
        return False
    portable = (parts.path == "/web/workbench_reopen.html"
                and parse_qs(parts.query).get("download") == ["1"])
    body = portable_opening_html() if portable else (WEB / item[0]).read_bytes()
    _send(handler, body, item[1], portable=portable,
          service_worker=parts.path == "/workbench-recovery-sw.mjs")
    return True


def navigation_failure(handler, error) -> bool:
    """Replace an expired *document navigation* ticket with usable opening help.

API callers keep their original JSON error/status; failed writes are untouched.
No error text, original filename, private query or capability enters this page.
"""
    if (urlsplit(handler.path).path.startswith("/api/file/")
            and handler.headers.get("Sec-Fetch-Mode") == "navigate"
            and getattr(error, "code", "") in {
                "DOWNLOAD_MISSING", "OPERATOR_TOKEN", "PROJECT_ACCESS"}):
        body = (WEB / "workbench_reopen.html").read_text("utf-8").replace(
            "This saved address is not responding.",
            "This saved download link has expired. Reopen its retained item in the workbench.")
        _send(handler, body.encode("utf-8"), "text/html",
              status=getattr(error, "status", 404))
        return True
    return False
