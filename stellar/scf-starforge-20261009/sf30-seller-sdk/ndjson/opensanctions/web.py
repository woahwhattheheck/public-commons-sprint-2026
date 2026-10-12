"""MIT. Native OpenSanctions console attached to the original NDJSON server."""
from __future__ import annotations

import gzip
import io
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote

from model import (Domain, Workspace, InputError, MAX_SOURCE, json_bytes, load_json,
                   MONITORING_DEFAULT, ndjson_application)
import matching
import updates

HERE = Path(__file__).resolve().parent

class Handler(ndjson_application.Handler):
    server_version = "Starforge-Source-Monitoring"

    @property
    def domain(self):
        return self.server.domain

    def _get(self):
        target = urlsplit(self.path)
        assets = {"/monitor": ("index.html", "text/html; charset=utf-8"),
                  "/monitor/": ("index.html", "text/html; charset=utf-8"),
                  "/monitor/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/monitor/style.css": ("style.css", "text/css; charset=utf-8")}
        if target.path in assets:
            self._gate(api=False)
            name, media = assets[target.path]
            body = (HERE / "public" / name).read_bytes()
            self._headers(200, media, len(body)); self.wfile.write(body); return
        if not target.path.startswith("/api/os/"):
            return super()._get()
        self._gate()
        params = parse_qs(target.query, keep_blank_values=True)
        if any(len(v) != 1 for v in params.values()):
            raise InputError("Repeated local query parameters are not accepted")
        q = {k: v[0] for k, v in params.items()}
        path = target.path[len("/api/os/"):]
        d = self.domain
        if path == "state":
            return self._json(d.state())
        if path == "contract":
            return self._json({"schema": "starforge.opensanctions-console.v1",
                "monitoring": MONITORING_DEFAULT, "publisherDelta": updates.DELTA_CONTRACT,
                "sourceFormats": ["Flat FtM JSON Lines", "Original dataset metadata", "Original delta JSON Lines", "Native statements CSV"],
                "auth": "Credentials stay in named environment references",
                "rawQuery": "/api/query"})
        if path == "entity":
            return self._json(d.entity(q["scope"], q["id"]))
        if path == "entities":
            return self._json(d.entity_page(q["scope"], int(q.get("offset", "0")), int(q.get("limit", "50"))))
        if path == "aliases":
            return self._json({"rows": d.aliases(q["scope"], q["id"])})
        if path == "changes":
            return self._json(d.changes(q["comparison"], int(q.get("offset", "0")), int(q.get("limit", "50")), q.get("kind"),
                                       material=q.get("material") == "true"))
        if path == "impacts":
            return self._json(d.impacted_cases(q["comparison"]))
        if path == "case":
            return self._json(d.case_history(q["id"]))
        if path == "statements":
            return self._json(d.statement_page(q["set"], q.get("entity"), int(q.get("offset", "0")), int(q.get("limit", "50"))))
        if path == "response":
            return self._json(matching.response_view(d, q["id"]))
        if path == "request":
            return self._json(d._one("requests", q["id"]))
        if path == "update-plan":
            return self._json(updates.update_plan(d, q["before"], q["after"], q["index"]))
        if path == "object":
            obj = d._one("objects", q["id"])
            return self._download(d.object_path(q["id"]), obj["name"], obj["media"])
        if path == "source":
            src = d.ws.source(q["id"])
            return self._download(d._source_path(q["id"]), src["name"], "application/x-ndjson")
        if path == "export":
            with d.mutex, d.ws.scratch() as temp:
                archive = temp / "OpenSanctions_Receiving_Workspace.zip"
                d.export_packet(archive)
                return self._download(archive, archive.name, "application/zip")
        return self._json({"error": "Unknown source-monitoring route"}, 404)

    def _post(self):
        target = urlsplit(self.path)
        if not target.path.startswith("/api/os/"):
            return super()._post()
        self._gate()
        d = self.domain
        path = target.path[len("/api/os/"):]
        if path == "object":
            name = unquote(self.headers.get("X-Original-Name", "original"))
            source_url = unquote(self.headers.get("X-Original-URL", ""))
            body = self._body(MAX_SOURCE)
            if self.headers.get("X-Original-Compression") == "gzip":
                body = gzip.GzipFile(fileobj=body, mode="rb")
                if name.endswith(".gz"):
                    name = name[:-3]
            result = d.put_object(body, name, self.headers.get("Content-Type", "application/octet-stream"),
                                  {"url": source_url} if source_url else {})
            return self._json(result, 201)
        if path == "import":
            with d.mutex, d.ws.scratch() as temp:
                archive = temp / "incoming.zip"
                with archive.open("xb") as out:
                    archive.chmod(0o600)
                    stream = self._body(4 * MAX_SOURCE)
                    while chunk := stream.read(65536):
                        out.write(chunk)
                return self._json(d.import_packet(archive), 201)
        body = load_json(self._body(24 * 1024 * 1024).read())
        if not isinstance(body, dict):
            raise InputError("Expected the selected operation's JSON object")
        if path == "published-edition":
            return self._json(updates.receive_published(d, body["metadataUrl"], body.get("entitlement")), 201)
        if path == "edition":
            with d.object_path(body["metadata"]).open("rb") as meta, d.object_path(body["entities"]).open("rb") as entities:
                return self._json(d.accept_edition(meta, entities, metadata_url=body["metadataUrl"],
                                    label=body.get("label"), entitlement=body.get("entitlement")), 201)
        if path == "portfolio":
            with d.object_path(body["original"]).open("rb") as original:
                return self._json(d.accept_portfolio(original, key=body["key"], label=body["label"]), 201)
        if path == "statement-set":
            with d.object_path(body["original"]).open("rb") as original:
                return self._json(d.accept_statements(body["edition"], original, source_url=body["sourceUrl"],
                                  name=body.get("name", "statements.csv"), complete=body.get("complete", False),
                                  scope=body.get("scope")), 201)
        if path == "compare":
            return self._json(d.compare(body["before"], body["after"], body.get("statementBefore"), body.get("statementAfter")), 201)
        if path == "update":
            return self._json(updates.stage_update(d, body["before"], body["after"], body["index"], body["deltas"]), 201)
        if path == "fetch-update":
            return self._json(updates.fetch_update(d, body["before"], body["after"]), 201)
        if path == "select-update":
            return self._json(updates.select_update(d, body["id"], reviewer=body["reviewer"],
                                                    reason=body["reason"], expected=body.get("expected")))
        if path == "review":
            return self._json(d.review_change(body["change"], decision=body["decision"], reason=body["reason"],
                                              reviewer=body["reviewer"], authority_url=body.get("authorityUrl"),
                                              expected=body.get("expected")), 201)
        if path == "case":
            return self._json(d.save_case(**body), 201)
        if path == "profile":
            return self._json(matching.save_profile(d, body), 201)
        if path == "prepare":
            profile = body.pop("profile")
            return self._json(matching.prepare(d, profile, **body), 201)
        if path == "dispatch":
            return self._json(matching.dispatch(d, body["id"], expected=body["expected"]))
        if path == "receive-response":
            data = d.object_path(body["original"]).read_bytes()
            return self._json(matching.receive(d, body["id"], data, status=body["status"],
                                               headers=body.get("headers"), source_note=body["sourceNote"],
                                               expected=body.get("expected")), 201)
        return self._json({"error": "Unknown source-monitoring operation"}, 404)

class OperatorServer(ndjson_application.RetainedServer):
    def __init__(self, workspace, port=0):
        self.domain = getattr(workspace, "opensanctions", None) or Domain(workspace)
        matching.recover_interrupted(self.domain)
        super().__init__(workspace, port, assets_directory=ndjson_application.HERE / "public", handler_class=Handler)
        self.launch = None
        self.url = self.origin + "/monitor#" + self.token
