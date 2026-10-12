"""MIT. Kafka controls and the maintained original NDJSON console on one private server."""
from __future__ import annotations
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit, parse_qs

from shared import HERE, SOURCE, RetainedHandler, RetainedServer, InputError, load_json
from contract import MAX_SOURCE, api_bytes, exact

MAX_PACKET = 6 * MAX_SOURCE + 32 * 1024 * 1024


def browser_assets():
    """Consume the same reviewed asset manifest used by the original packager."""
    manifest = load_json((HERE / "browser-assets.json").read_bytes())
    exact(manifest, {"schema", "root", "routes"})
    if manifest["schema"] != "stellar-forge.browser-assets.v1" or manifest["root"] != "./":
        raise InputError("Choose the original Kafka browser asset manifest")
    expected = {
        "/": ("public/index.html", "text/html; charset=utf-8"),
        "/app.js": ("public/app.js", "text/javascript; charset=utf-8"),
        "/style.css": ("public/style.css", "text/css; charset=utf-8"),
        "/ndjson-app.js": ("../ndjson/public/app.js", "text/javascript; charset=utf-8"),
        "/ndjson-style.css": ("../ndjson/public/style.css", "text/css; charset=utf-8"),
    }
    values = manifest["routes"]
    if not isinstance(values, list) or len(values) != len(expected):
        raise InputError("The Kafka console requires its complete five-route original asset map")
    result = {}
    for item in values:
        if not isinstance(item, list) or len(item) != 2 or not isinstance(item[0], str) or not isinstance(item[1], list) or len(item[1]) != 2:
            raise InputError("Invalid original Kafka browser route")
        route, asset = item
        if route in result or route not in expected or tuple(asset) != expected[route]:
            raise InputError("Kafka browser routes must match the original shared module and stylesheet")
        path = (HERE / asset[0]).resolve(strict=True)
        if not path.is_relative_to(SOURCE) or not path.is_file():
            raise InputError("The original Kafka browser asset is outside its source package")
        result[route] = (path, asset[1])
    return result


class Handler(RetainedHandler):
    server_version = "SF30-Kafka"

    def _json(self, value, status=200):
        data = api_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _query(self, target):
        parsed = parse_qs(target.query, keep_blank_values=True)
        if any(len(items) != 1 for items in parsed.values()):
            raise InputError("Repeated query parameters are not accepted")
        return {key: items[0] for key, items in parsed.items()}

    def _get(self):
        target = urlsplit(self.path)
        if target.path in self.server.browser_assets:
            self._gate(api=False)
            path, media = self.server.browser_assets[target.path]
            data = path.read_bytes()
            self._headers(200, media, len(data))
            self.wfile.write(data)
            return
        if not target.path.startswith("/api/kafka/"):
            return super()._get()
        self._gate()
        query = self._query(target)
        ws = self.server.workspace
        single = {
            "/api/kafka/connection": ws.connection,
            "/api/kafka/inspection": ws.inspection,
            "/api/kafka/capture": ws.capture,
            "/api/kafka/projection": ws.projection,
            "/api/kafka/message": ws.message,
        }
        if target.path in single:
            exact(query, {"id"})
            self._json(single[target.path](query["id"]))
        elif target.path == "/api/kafka/messages":
            exact(query, {"capture"}, {"offset", "limit"})
            self._json(ws.messages(query["capture"], int(query.get("offset", "0")), int(query.get("limit", "50"))))
        elif target.path == "/api/kafka/export":
            exact(query, {"build"}, {"projection"})
            with ws.mutex, ws.scratch() as temporary:
                archive = temporary / "kafka-project.zip"
                ws.export_kafka(query["build"], archive, query.get("projection"))
                self._download(archive, archive.name, "application/zip")
        else:
            self._json({"error": "Unknown local Kafka route"}, 404)

    def _post(self):
        target = urlsplit(self.path)
        if not target.path.startswith("/api/kafka/"):
            return super()._post()
        self._gate()
        if target.query:
            raise InputError("Kafka write routes do not accept query parameters")
        ws = self.server.workspace
        if target.path == "/api/kafka/import":
            with ws.mutex, ws.scratch() as temporary:
                archive = temporary / "customer-kafka.zip"
                with archive.open("xb") as output:
                    archive.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), output, 65536)
                    output.flush()
                    os.fsync(output.fileno())
                self._json(ws.import_kafka(archive), 201)
            return
        request = load_json(self._body(1024 * 1024).read())
        operations = {
            "/api/kafka/connection": ws.save_connection,
            "/api/kafka/inspect": ws.inspect_connection,
            "/api/kafka/capture": ws.prepare_capture,
            "/api/kafka/project": ws.project,
        }
        if target.path in operations:
            self._json(operations[target.path](request), 201)
        elif target.path == "/api/kafka/run":
            exact(request, {"capture", "expectedRevision"})
            self._json(ws.run_capture(request["capture"], request["expectedRevision"], background=True), 202)
        elif target.path == "/api/kafka/cancel":
            exact(request, {"capture"})
            self._json(ws.cancel_capture(request["capture"]), 202)
        else:
            self._json({"error": "Unknown local Kafka route"}, 404)


class OperatorServer(RetainedServer):
    def __init__(self, workspace, port=0):
        self.browser_assets = browser_assets()
        super().__init__(workspace, port, assets_directory=HERE / "public", handler_class=Handler)
        self.launch = None
