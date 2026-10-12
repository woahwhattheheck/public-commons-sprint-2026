"""MIT. NDJSON source adapter for the existing retained source workspace."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit, parse_qs

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / "xml"
sys.path.insert(0, str(SHARED))
from workspace import (Workspace as RetainedWorkspace, SourceFormat, InputError, json_bytes,
                       load_json, private_write, file_digest, sync_dir)
from server import OperatorServer as RetainedServer, Handler as RetainedHandler
sys.path.remove(str(SHARED))
import ndjson_source
from merchant_packages import MerchantPackages, MAX_PACKAGE

FORMAT = SourceFormat("ndjson", "NDJSON", ndjson_source.inventory, ndjson_source.validate_plan,
                      ndjson_source.extract, ndjson_source.dataset_spec)


class Workspace(MerchantPackages, RetainedWorkspace):
    def __init__(self, root: str | Path, create: bool = False):
        super().__init__(root, create=create, source_format=FORMAT)

    def state(self):
        with self.mutex:
            return {**super().state(), "merchants": self.merchant_packages()}

    def prepare_merchant(self, build_id: str, payment: dict, origin: str, route: str,
                         destination: str | Path) -> dict:
        """Export the original full source plus native merchant and customer SDK."""
        destination = Path(destination).expanduser().absolute()
        with self.mutex:
            view = self.build_view(build_id)
            source = self.root / "sources" / (view["source"] + ".ndjson")
            plan = self.root / "plans" / (view["plan"] + ".json")
            if file_digest(source) != view["source"] or file_digest(plan, 65536) != view["plan"]:
                raise InputError("Retained source or mapping changed")
            self.export_dataset(build_id, destination)
            try:
                for name, path in [("source.ndjson", source), ("plan.json", plan)]:
                    with path.open("rb") as inp, os.fdopen(os.open(destination / name,
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                        shutil.copyfileobj(inp, out, 1048576)
                        out.flush()
                        os.fsync(out.fileno())
                private_write(destination / "payment.json", json_bytes(payment))
                executable = os.environ.get("SF30_XML_NODE", "node")
                run = subprocess.run([executable, str(HERE / "merchant.mjs"), "prepare",
                    "--prepared", str(destination), "--origin", origin, "--path", route],
                    capture_output=True, timeout=180, check=False,
                    pass_fds=(self.lease.fileno(),) if os.name == "posix" else ())
                if run.returncode:
                    message = run.stderr.decode("utf-8", errors="replace").strip()[-3000:]
                    raise InputError(message or "Original merchant preparation failed")
                result = load_json(run.stdout)
                sync_dir(destination)
                return result
            except BaseException:
                # This call created the directory; never remove an existing package.
                shutil.rmtree(destination, ignore_errors=True)
                raise


class Handler(RetainedHandler):
    server_version = "SF30-NDJSON"

    def _get(self):
        target = urlsplit(self.path)
        if target.path in {"/api/merchants", "/api/merchants/package", "/api/merchants/download"}:
            self._gate()
            query = parse_qs(target.query, keep_blank_values=True)
            if target.path == "/api/merchants":
                if query:
                    raise InputError("Merchant listing has no query parameters")
                return self._json({"merchants": self.server.workspace.merchant_packages()})
            if set(query) != {"id"} or len(query["id"]) != 1:
                raise InputError("Select exactly one retained merchant ID")
            if target.path.endswith("/download"):
                return self._merchant_download(query["id"][0])
            return self._json(self.server.workspace.merchant_package(query["id"][0]))
        if target.path != "/api/launch":
            return super()._get()
        self._gate()
        if target.query:
            raise InputError("The original launch endpoint has no query parameters")
        if self.server.launch is None:
            self._json({"error": "The managed NDJSON console is not available"}, 503)
            return
        self._json(self.server.launch)

    def _merchant_download(self, package_id):
        with self.server.workspace.merchant_download(package_id) as (stream, info):
            self._headers(200, "application/zip", info.st_size, "ndjson-merchant.zip")
            shutil.copyfileobj(stream, self.wfile, 65536)

    def _post(self):
        path = urlsplit(self.path).path
        if path not in {"/api/merchant", "/api/merchants/prepare", "/api/merchants/receive"}:
            return super()._post()
        target = self._gate()
        if target.query:
            raise InputError("Merchant mutations have no query parameters")
        ws = self.server.workspace
        if path == "/api/merchants/receive":
            # Uploading and downloading do not hold the workspace writer mutex.
            with ws.scratch() as temp:
                upload = temp / "merchant.zip"
                with os.fdopen(os.open(upload, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                    shutil.copyfileobj(self._body(MAX_PACKAGE), out, 1048576)
                    out.flush()
                    os.fsync(out.fileno())
                return self._json(ws.receive_merchant(upload), 201)
        body = load_json(self._body().read())
        keys = {"build", "payment", "origin", "path"}
        allowed = keys | ({"requestId"} if path == "/api/merchants/prepare" else set())
        if not isinstance(body, dict) or not keys <= set(body) or not set(body) <= allowed:
            raise InputError("Supply the reviewed build, payment terms, public origin and route")
        package = ws.save_merchant(body["build"], body["payment"], body["origin"], body["path"], body.get("requestId"))
        if path == "/api/merchant":
            return self._merchant_download(package["id"])
        self._json(package, 201)


class OperatorServer(RetainedServer):
    def __init__(self, workspace: Workspace, port: int = 0):
        super().__init__(workspace, port, assets_directory=HERE / "public", handler_class=Handler)
        self.launch = None
