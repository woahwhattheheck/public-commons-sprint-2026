"""Loopback-only human-crop workspace; no hosted service or external API calls."""
from __future__ import annotations

import argparse
import base64
import binascii
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
from typing import Any

from .agent import canonical, compile_trace
from .crop import CropResult, crop_evidence, export_bundle, strict_json
from .synth import make_case
from .vision import MAX_IMAGE_BYTES, VisionError, _cv

MAX_REQUEST_BYTES = (MAX_IMAGE_BYTES + 2) // 3 * 4 + 256 * 1024
ASSETS = {"/": ("workspace.html", "text/html; charset=utf-8"),
          "/workspace.css": ("workspace.css", "text/css; charset=utf-8"),
          "/workspace.js": ("workspace.js", "text/javascript; charset=utf-8")}


@dataclass
class Case:
    case_id: str
    raw: bytes
    parent: dict[str, Any]
    priors: list[dict[str, str]]
    synthetic: bool
    result: CropResult | None = None


class Workspace:
    def __init__(self, *, allow_opencv4_dev: bool = False) -> None:
        self.dev = allow_opencv4_dev
        self.cv2, self.np, self.version, self.competition = _cv(None, allow_opencv4_dev=self.dev)
        self.token = secrets.token_urlsafe(32)
        self.case: Case | None = None

    def preview(self, raw: bytes) -> str:
        image = self.cv2.imdecode(self.np.frombuffer(raw, dtype=self.np.uint8), self.cv2.IMREAD_COLOR)
        if image is None:
            raise VisionError("could not render preview")
        height, width = image.shape[:2]
        if max(height, width) > 1024:
            factor = 1024 / max(height, width)
            image = self.cv2.resize(image, (max(1, round(width * factor)), max(1, round(height * factor))),
                                    interpolation=self.cv2.INTER_AREA)
        ok, png = self.cv2.imencode(".png", image)
        if not ok:
            raise VisionError("could not encode preview")
        return base64.b64encode(png.tobytes()).decode("ascii")

    def ingest(self, raw: bytes, evidence_id: str, priors: list[dict[str, str]], *, synthetic: bool) -> dict[str, Any]:
        # Only replace the current case after canonical processing fully succeeds.
        parent = compile_trace(raw, evidence_id=evidence_id, prior_fingerprints=priors,
                               allow_opencv4_dev=self.dev)
        preview = self.preview(raw)
        case = Case(secrets.token_hex(16), raw, parent, priors, synthetic)
        self.case = case
        return {"case_id": case.case_id, "trace": parent, "preview_png_b64": preview,
                "synthetic": synthetic, "prior_count": len(priors)}

    def current(self, case_id: Any) -> Case:
        if self.case is None or type(case_id) is not str or case_id != self.case.case_id:
            raise VisionError("case changed; load the current image before continuing")
        return self.case

    def crop(self, data: dict[str, Any]) -> dict[str, Any]:
        case = self.current(data.get("case_id"))
        result = crop_evidence(case.raw, case.parent, data.get("rectangle"),
                               human_confirmed=data.get("human_confirmed"), note=data.get("note"),
                               prior_fingerprints=case.priors, allow_opencv4_dev=self.dev)
        preview = self.preview(result.png)
        case.result = result
        return {"case_id": case.case_id, "trace": result.trace, "receipt": result.receipt,
                "preview_png_b64": preview}

    def export(self, data: dict[str, Any]) -> bytes:
        case = self.current(data.get("case_id"))
        if case.result is None or data.get("receipt_sha256") != case.result.receipt["receipt_sha256"]:
            raise VisionError("crop changed; re-evaluate before exporting")
        return export_bundle(case.raw, case.parent, case.result,
                             prior_fingerprints=case.priors, allow_opencv4_dev=self.dev)


def make_server(port: int = 8769, *, allow_opencv4_dev: bool = False) -> ThreadingHTTPServer:
    workspace = Workspace(allow_opencv4_dev=allow_opencv4_dev)
    processing = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "VisualLedgerLocal/1"

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, *_: Any) -> None:
            # Do not log document names, request bodies or session tokens.
            pass

        def allowed(self, *, mutation: bool = False) -> bool:
            port_number = self.server.server_address[1]
            allowed_hosts = {f"127.0.0.1:{port_number}", f"localhost:{port_number}"}
            hosts = self.headers.get_all("Host", [])
            host = hosts[0] if len(hosts) == 1 else ""
            if host not in allowed_hosts or self.headers.get("Sec-Fetch-Site") == "cross-site":
                return False
            if mutation:
                return (self.headers.get("Origin") == f"http://{host}" and
                        self.headers.get("X-Workspace-Token") == workspace.token)
            return True

        def respond(self, status: int, raw: bytes, content_type: str, *, download: bool = False) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; "
                             "img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; "
                             "form-action 'none'; frame-ancestors 'none'")
            if download:
                self.send_header("Content-Disposition", 'attachment; filename="visualledger-crop-evidence.zip"')
            self.end_headers()
            self.wfile.write(raw)

        def json_response(self, value: Any, status: int = 200) -> None:
            self.respond(status, canonical(value), "application/json")

        def do_GET(self) -> None:
            if not self.allowed():
                self.json_response({"error": "loopback same-site access required"}, 403)
                return
            if self.path in ASSETS:
                name, kind = ASSETS[self.path]
                self.respond(200, Path(__file__).with_name(name).read_bytes(), kind)
            elif self.path == "/api/config":
                self.json_response({"token": workspace.token, "opencv_version": workspace.version,
                                    "competition_opencv5_runtime": workspace.competition,
                                    "max_image_bytes": MAX_IMAGE_BYTES})
            else:
                self.json_response({"error": "not found"}, 404)

        def do_POST(self) -> None:
            if not self.allowed(mutation=True):
                self.json_response({"error": "same-origin workspace token required"}, 403)
                return
            if self.path not in {"/api/demo", "/api/case", "/api/crop", "/api/export"}:
                self.json_response({"error": "not found"}, 404)
                return
            if not processing.acquire(blocking=False):
                self.json_response({"error": "Another local operation is running; retry after it finishes."}, 429)
                return
            try:
                if (self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json" or
                        self.headers.get("Transfer-Encoding") or self.headers.get("Content-Encoding") or
                        len(self.headers.get_all("Content-Length", [])) != 1):
                    raise VisionError("one bounded plain JSON body is required")
                length = int(self.headers["Content-Length"])
                if not 1 <= length <= MAX_REQUEST_BYTES:
                    raise VisionError("request exceeds the bounded image/context limit")
                raw_body = self.rfile.read(length)
                if len(raw_body) != length:
                    raise VisionError("incomplete request body")
                data = strict_json(raw_body)
                if type(data) is not dict:
                    raise VisionError("request must be a JSON object")
                if self.path == "/api/demo":
                    kind = data.get("kind", "two_docs")
                    raw = make_case(kind)
                    response = workspace.ingest(raw, "SYNTH-" + kind, [], synthetic=True)
                elif self.path == "/api/case":
                    encoded = data.get("image_b64")
                    if type(encoded) is not str or len(encoded) > (MAX_IMAGE_BYTES + 2) // 3 * 4:
                        raise VisionError("encoded image exceeds size bound")
                    raw = base64.b64decode(encoded, validate=True)
                    priors = data.get("prior_fingerprints", [])
                    if "prior_fingerprints_json" in data:
                        text = data["prior_fingerprints_json"]
                        if "prior_fingerprints" in data or type(text) is not str or len(text.encode("utf-8")) > 256 * 1024:
                            raise VisionError("supply one bounded prior fingerprint JSON context")
                        priors = strict_json(text.encode("utf-8"))
                    response = workspace.ingest(raw, data.get("evidence_id"), priors, synthetic=False)
                elif self.path == "/api/crop":
                    response = workspace.crop(data)
                else:
                    self.respond(200, workspace.export(data), "application/zip", download=True)
                    return
                self.json_response(response)
            except VisionError as exc:
                self.json_response({"error": str(exc)}, 400)
            except (ValueError, KeyError, TypeError, binascii.Error, OverflowError, workspace.cv2.error):
                self.json_response({"error": "Invalid request or evidence. Check dimensions, crop bounds, "
                                    "reason, confirmation, prior context and current case."}, 400)
            except TimeoutError:
                self.json_response({"error": "request timed out"}, 408)
            finally:
                processing.release()

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8769)
    parser.add_argument("--allow-opencv4-dev", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    try:
        server = make_server(args.port, allow_opencv4_dev=args.allow_opencv4_dev)
    except (VisionError, OSError) as exc:
        parser.exit(2, f"Workspace unavailable: {exc}\n")
    print(f"VisualLedger local workspace: http://127.0.0.1:{server.server_address[1]}", flush=True)
    print("Single-user local processing only. Keep source/crop exports confidential. Ctrl-C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
