"""MIT. Private FHIR Bulk Data operator over the original SF30 workspace server."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys
from urllib.parse import parse_qs, unquote
import zipfile

from fhir_workspace import Workspace, InputError, original_workspace, original_server


HERE = Path(__file__).resolve().parent
MAX_UPLOAD = 2 * original_workspace.MAX_SOURCE


class OperatorServer(original_server.OperatorServer):
    def __init__(self, workspace: Workspace, port: int = 0, **kwargs):
        kwargs.setdefault("assets_directory", HERE / "public")
        kwargs.setdefault("handler_class", Handler)
        super().__init__(workspace, port, **kwargs)


class Handler(original_server.Handler):
    server_version = "SF30-FHIR-Bulk"

    def _run(self, callback):
        try:
            callback()
        except PermissionError as exc:
            self._json({"error": str(exc)}, 403)
        except FileNotFoundError:
            self._json({"error": "Retained file or operation was not found"}, 404)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception as exc:
            provider_status = getattr(exc, "provider_status", None)
            if provider_status is not None or exc.__class__.__name__ == "ProviderError":
                body = {"error": str(exc), "providerStatus": provider_status}
                for attribute, name in (("retry_after", "retryAfter"),
                                        ("not_before", "notBefore"),
                                        ("receipt", "receipt")):
                    value = getattr(exc, attribute, None)
                    if value is not None:
                        body[name] = value
                self._json(body, 502)
            elif getattr(exc, "status", None) == 409 or getattr(exc, "http_status", None) == 409 or exc.__class__.__name__ in {"ConflictError", "OperationConflict"}:
                self._json({"error": str(exc), "kind": "operation-conflict"}, 409)
            elif isinstance(exc, (InputError, ValueError, KeyError, zipfile.BadZipFile)):
                self._json({"error": str(exc), "kind": "validation"}, 422)
            else:
                self._json({"error": "The local operation failed. Reopen the retained operation to continue."}, 500)

    @staticmethod
    def _parts(path):
        # Decode one URL path component at a time: encoded source member slashes
        # belong to the last component and never create another HTTP route.
        if not path.startswith("/") or path.endswith("/"):
            return []
        return [unquote(component, encoding="utf-8", errors="strict") for component in path[1:].split("/")]

    @staticmethod
    def _query(target, allowed=None):
        values = parse_qs(target.query, keep_blank_values=True, strict_parsing=True, max_num_fields=40)
        if any(len(value) != 1 for value in values.values()):
            raise InputError("Repeated query parameters are not accepted")
        result = {name: value[0] for name, value in values.items()}
        if allowed is not None and set(result) - set(allowed):
            raise InputError("Unknown query parameter: " + ", ".join(sorted(set(result) - set(allowed))))
        return result

    @staticmethod
    def _integer(raw, name, minimum=0, maximum=None):
        if isinstance(raw, bool):
            raise InputError(name + " must be an integer")
        try:
            value = int(raw)
        except (ValueError, TypeError):
            raise InputError(name + " must be an integer") from None
        if str(value) != str(raw) or value < minimum or (maximum is not None and value > maximum):
            raise InputError(name + " is outside its supported range")
        return value

    def _json_body(self, allowed=None, required=()):
        value = original_workspace.load_json(self._body().read())
        if not isinstance(value, dict):
            raise InputError("Expected a JSON object")
        if allowed is not None and set(value) - set(allowed):
            raise InputError("Unknown request field: " + ", ".join(sorted(set(value) - set(allowed))))
        missing = set(required) - set(value)
        if missing:
            raise InputError("Missing request field: " + ", ".join(sorted(missing)))
        return value

    def _download_member(self, source_id, name):
        ws = self.server.workspace
        members = ws.source_members(source_id)
        if isinstance(members, dict):
            members = members.get("files", members.get("members", []))
        member = next((item for item in members if item.get("name") == name), None)
        if member is None:
            raise FileNotFoundError(name)
        # Member lookup is performed by the workspace; untrusted source names
        # are never opened as filesystem paths or reflected into HTTP headers.
        with ws.open_source_member(source_id, name) as stream:
            length = member.get("bytes")
            if not isinstance(length, int) or length < 0:
                raise InputError("Retained source member has no verified byte length")
            filename = "fhir-original.ndjson" if name.endswith((".ndjson", ".jsonl")) else "fhir-original.bin"
            self._headers(200, "application/octet-stream", length, filename)
            remaining = length
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    raise InputError("Retained source member ended before its verified length")
                self.wfile.write(block)
                remaining -= len(block)

    def _get(self):
        target = self._gate(api=False)
        assets = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
        }
        if target.path in assets:
            if target.query:
                raise InputError("The private operator entry point does not use query parameters")
            name, media = assets[target.path]
            body = (self.server.assets_directory / name).read_bytes()
            self._headers(200, media, len(body))
            self.wfile.write(body)
            return

        self._gate()
        parts = self._parts(target.path)
        ws = self.server.workspace
        if parts == ["api", "catalogue"]:
            self._query(target, ())
            self._json(ws.catalogue())
        elif parts == ["api", "state"]:
            self._query(target, ())
            self._json(ws.state())
        elif parts == ["api", "auth-profiles"]:
            self._query(target, ())
            self._json(ws.auth_profiles())
        elif len(parts) == 3 and parts[:2] == ["api", "connections"]:
            self._query(target, ())
            self._json(ws.connection(parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "discoveries"]:
            self._query(target, ())
            self._json(ws.discovery(parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "group-pages"]:
            self._query(target, ())
            self._json(ws.group_page(parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "exports"]:
            self._query(target, ())
            self._json(ws.export_plan(parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "operations"]:
            self._query(target, ())
            self._json(ws.operation(parts[2]))
        elif len(parts) == 3 and parts[:2] == ["api", "sources"]:
            self._query(target, ())
            self._json(ws.source(parts[2]))
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "members":
            self._query(target, ())
            self._json(ws.source_members(parts[2]))
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "rows":
            q = self._query(target, {"resourceType", "kind", "offset", "limit", "query"})
            self._json(ws.source_rows(
                parts[2], resource_type=q.get("resourceType") or None, kind=q.get("kind", "output"),
                offset=self._integer(q.get("offset", "0"), "offset"),
                limit=self._integer(q.get("limit", "50"), "limit", 1, 250),
                query=q.get("query", "")))
        elif len(parts) == 6 and parts[:2] == ["api", "sources"] and parts[3] == "rows":
            self._query(target, ())
            self._json(ws.source_row(parts[2], parts[4], self._integer(parts[5], "line", 1)))
        elif len(parts) == 5 and parts[:2] == ["api", "sources"] and parts[3] == "files":
            self._query(target, ())
            self._download_member(parts[2], parts[4])
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "packet":
            self._query(target, ())
            self._download(ws.source_path(parts[2]), "fhir-original-source.zip", "application/zip")
        elif len(parts) == 3 and parts[:2] == ["api", "plans"]:
            self._query(target, ())
            self._json({"id": parts[2], "plan": ws.plan(parts[2])})
        elif len(parts) == 3 and parts[:2] == ["api", "builds"]:
            self._query(target, ())
            self._json(ws.build_view(parts[2]))
        elif len(parts) == 4 and parts[:2] == ["api", "builds"] and parts[3] == "query":
            self._json(ws.query(parts[2], self._query(target)))
        elif len(parts) == 4 and parts[:2] == ["api", "builds"] and parts[3] in {"packet", "dataset"}:
            self._query(target, ())
            with ws.mutex, ws.scratch() as temp:
                archive = temp / ("fhir-customer-packet.zip" if parts[3] == "packet" else "fhir-dataset.zip")
                if parts[3] == "packet":
                    ws.export_packet(parts[2], archive)
                else:
                    folder = temp / "dataset"
                    ws.export_dataset(parts[2], folder)
                    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as out:
                        for name in ("data.csv", "dataset.json", ws.lineage_name):
                            out.write(folder / name, name)
                    archive.chmod(0o600)
                self._download(archive, archive.name, "application/zip")
        elif len(parts) == 4 and parts[:2] == ["api", "comparisons"] and parts[3] == "changes":
            q = self._query(target, {"offset", "limit"})
            self._json(ws.comparison_page(
                parts[2], self._integer(q.get("offset", "0"), "offset"),
                self._integer(q.get("limit", "50"), "limit", 1, 250)))
        elif len(parts) == 4 and parts[:2] == ["api", "comparisons"] and parts[3] == "file":
            self._query(target, ())
            self._download(ws.comparison_file(parts[2]), "fhir-edition-changes.jsonl", "application/x-ndjson")
        elif parts == ["api", "workspace", "packet"]:
            self._query(target, ())
            with ws.mutex, ws.scratch() as temp:
                archive = temp / "fhir-editable-workspace.zip"
                ws.export_workspace(archive)
                self._download(archive, archive.name, "application/zip")
        else:
            self._json({"error": "Unknown local route"}, 404)

    def _receive_packet(self, route):
        ws = self.server.workspace
        with ws.mutex, ws.scratch() as temp:
            path = temp / "receiving.zip"
            with path.open("xb") as out:
                path.chmod(0o600)
                shutil.copyfileobj(self._body(MAX_UPLOAD), out, 65536)
            result = ws.import_workspace(path) if route == "workspace" else ws.import_packet(path)
            self._json(result, 201)

    def _post(self):
        target = self._gate()
        self._query(target, ())
        parts = self._parts(target.path)
        ws = self.server.workspace
        if parts == ["api", "sources"]:
            name = unquote(self.headers.get("X-Source-Name", "fhir-source.zip"), encoding="utf-8", errors="strict")
            label = unquote(self.headers.get("X-Source-Label", name), encoding="utf-8", errors="strict")
            self._json(ws.add_source(self._body(MAX_UPLOAD), label, name), 201)
        elif parts == ["api", "packets"]:
            self._receive_packet("dataset")
        elif parts == ["api", "workspace", "packet"]:
            self._receive_packet("workspace")
        elif parts == ["api", "connections"]:
            self._json(ws.save_connection(self._json_body()), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "discover":
            self._json_body(())
            self._json(ws.discover(parts[2]))
        elif len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "groups":
            body = self._json_body({"url"})
            self._json(ws.groups(parts[2], url=body.get("url")))
        elif parts == ["api", "exports"]:
            self._json(ws.save_export(self._json_body()), 201)
        elif len(parts) == 4 and parts[:2] == ["api", "exports"] and parts[3] == "advance":
            body = self._json_body({"operationId"}, {"operationId"})
            self._json(ws.advance(parts[2], body["operationId"]))
        elif len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] == "status":
            body = self._json_body({"statusUrl", "reason"}, {"statusUrl", "reason"})
            self._json(ws.adopt_status(parts[2], body))
        elif len(parts) == 4 and parts[:2] == ["api", "operations"] and parts[3] == "cancel":
            body = self._json_body({"requestId"}, {"requestId"})
            self._json(ws.cancel(parts[2], body["requestId"]))
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "mapping":
            body = self._json_body({"resourceType", "name"}, {"resourceType"})
            self._json(ws.default_mapping(parts[2], body["resourceType"], name=body.get("name")))
        elif len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "preview":
            body = self._json_body({"plan", "limit"}, {"plan"})
            self._json(ws.projection_preview(
                parts[2], body["plan"], limit=self._integer(body.get("limit", 25), "limit", 1, 250)))
        elif parts == ["api", "compositions"]:
            self._json(ws.compose(self._json_body()), 201)
        elif parts == ["api", "plans"]:
            self._json(ws.save_plan(self._json_body()), 201)
        elif parts == ["api", "builds"]:
            body = self._json_body({"sourceId", "planId"}, {"sourceId", "planId"})
            self._json(ws.build(body["sourceId"], body["planId"]), 201)
        elif parts == ["api", "comparisons"]:
            body = self._json_body({"beforeId", "afterId"}, {"beforeId", "afterId"})
            self._json(ws.compare(body["beforeId"], body["afterId"]), 201)
        else:
            self._json({"error": "Unknown local route"}, 404)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Open the private FHIR Bulk Data operator")
    parser.add_argument("--workspace", required=True, help="Original private workspace directory")
    parser.add_argument("--port", default=0, type=int, help="Loopback port; default chooses a free port")
    parser.add_argument("--credentials-file", help="Local configured authentication profiles")
    args = parser.parse_args(argv)
    credentials = None
    if args.credentials_file:
        credentials = Path(args.credentials_file).expanduser().resolve(strict=True)
        if not credentials.is_file():
            parser.error("--credentials-file must be a regular file")
    workspace_path = Path(args.workspace).expanduser().absolute()
    with Workspace(workspace_path, create=not workspace_path.exists(), credentials_file=credentials) as ws:
        with OperatorServer(ws, args.port) as server:
            print(json.dumps({"url": server.url, "workspace": str(ws.root)}, ensure_ascii=False), flush=True)
            try:
                server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
