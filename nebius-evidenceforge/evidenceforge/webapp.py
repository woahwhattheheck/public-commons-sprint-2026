from __future__ import annotations

import html
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .core import MemorySandbox, compile_change


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FIXTURE = PROJECT_ROOT / "demo" / "scenario.json"


def _compile_demo() -> dict:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    sandbox = MemorySandbox(
        files=fixture["sandbox"]["files"],
        tests={k: (v["exit_code"], v["output"]) for k, v in fixture["sandbox"]["tests"].items()},
    )
    return compile_change(
        json.dumps(fixture["request"]),
        json.dumps(fixture["model_plan"]),
        sandbox,
        provider_evidence=fixture["provider_evidence"],
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "EvidenceForge/0.1"

    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/healthz":
            self._send(HTTPStatus.OK, "application/json", b'{"ok":true}\n')
            return
        if path == "/api/demo":
            body = (json.dumps(_compile_demo(), indent=2, sort_keys=True) + "\n").encode()
            self._send(HTTPStatus.OK, "application/json; charset=utf-8", body)
            return
        if path != "/":
            self._send(HTTPStatus.NOT_FOUND, "text/plain; charset=utf-8", b"not found\n")
            return
        receipt = _compile_demo()
        events = "".join(
            f"<li><code>{html.escape(event['kind'])}</code> "
            f"{html.escape(event.get('path') or event.get('name') or '')}</li>"
            for event in receipt["events"]
        )
        status = "GREEN" if receipt["required_tests_green"] else "RED"
        authority = receipt["authority"]
        page = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>EvidenceForge</title>
<style>
body{{font-family:system-ui;margin:3rem;max-width:850px}} code{{background:#eee;padding:.1rem .25rem}}
.card{{border:1px solid #aaa;border-radius:12px;padding:1rem;margin:1rem 0}}
</style></head><body>
<h1>EvidenceForge</h1>
<p>Evidence-gated coding agent foundation for Nebius × NVIDIA.</p>
<div class="card"><strong>Demo tests:</strong> {status}<br>
<strong>Receipt:</strong> <code>{receipt['receipt_sha256']}</code></div>
<h2>Bounded execution</h2><ol>{events}</ol>
<h2>Authority ceiling</h2>
<p>Sandbox execution: {authority['sandbox_execution']}. Real repository mutation:
{authority['real_repository_mutation']}. Human approval required:
{authority['human_approval_required']}.</p>
<p><a href="/api/demo">View machine-readable receipt</a></p>
</body></html>"""
        self._send(HTTPStatus.OK, "text/html; charset=utf-8", page.encode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    host, port = "127.0.0.1", 8080
    print(f"EvidenceForge demo: http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
