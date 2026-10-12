"""MIT. NDJSON source adapter for the existing retained source workspace."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit
import zipfile

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / "xml"
sys.path.insert(0, str(SHARED))
from workspace import (Workspace as RetainedWorkspace, SourceFormat, InputError, json_bytes,
                       load_json, private_write, file_digest, sync_dir)
from server import OperatorServer as RetainedServer, Handler as RetainedHandler
sys.path.remove(str(SHARED))
import ndjson_source

FORMAT = SourceFormat("ndjson", "NDJSON", ndjson_source.inventory, ndjson_source.validate_plan,
                      ndjson_source.extract, ndjson_source.dataset_spec)


class Workspace(RetainedWorkspace):
    def __init__(self, root: str | Path, create: bool = False):
        super().__init__(root, create=create, source_format=FORMAT)

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
                    capture_output=True, timeout=180, check=False)
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

    def _post(self):
        if urlsplit(self.path).path != "/api/merchant":
            return super()._post()
        self._gate()
        body = load_json(self._body().read())
        if not isinstance(body, dict) or set(body) != {"build", "payment", "origin", "path"}:
            raise InputError("Supply the reviewed build, payment terms, public origin and route")
        ws = self.server.workspace
        with ws.mutex, ws.scratch() as temp:
            package = temp / "merchant"
            manifest = ws.prepare_merchant(body["build"], body["payment"], body["origin"], body["path"], package)
            archive = temp / "ndjson-merchant.zip"
            with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as output:
                for name in [*manifest["files"], "merchant.json"]:
                    output.write(package / name, name)
            archive.chmod(0o600)
            self._download(archive, archive.name, "application/zip")


class OperatorServer(RetainedServer):
    def __init__(self, workspace: Workspace, port: int = 0):
        super().__init__(workspace, port, assets_directory=HERE / "public", handler_class=Handler)
