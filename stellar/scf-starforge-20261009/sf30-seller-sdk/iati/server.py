"""MIT. IATI operations over the original XML source console's private HTTP carrier."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import shutil
import sys
from urllib.parse import urlsplit, parse_qs

from iati_workspace import IatiWorkspace, InputError, MAX_SOURCE, MAX_PACKET, load_json

HERE = Path(__file__).resolve().parent
SHARED = HERE.parent / "xml"
# Load the existing handler under a distinct module name: this file is also server.py.
_spec = importlib.util.spec_from_file_location("_sf30_iati_original_server", SHARED / "server.py")
_original = importlib.util.module_from_spec(_spec)
sys.path.insert(0, str(SHARED))
try:
    _spec.loader.exec_module(_original)
finally:
    sys.path.remove(str(SHARED))


def revision(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value.isdecimal() or str(int(value)) != value or int(value) < 1:
        raise InputError("Select one original positive portfolio revision")
    return int(value)


class Handler(_original.Handler):
    server_version = "SF30-IATI"

    def _get(self):
        target = urlsplit(self.path)
        if not target.path.startswith("/api/iati/") and target.path != "/api/launch":
            return super()._get()
        self._gate()
        values = parse_qs(target.query, keep_blank_values=True)
        if any(len(items) != 1 for items in values.values()):
            raise InputError("Repeated IATI query parameters are not accepted")
        q = {key: items[0] for key, items in values.items()}
        ws = self.server.workspace
        if target.path == "/api/launch":
            if q:
                raise InputError("The original launch endpoint takes no query parameters")
            if self.server.launch is None:
                self._json({"error": "This original IATI process has no active managed launch"}, 503)
            else:
                self._json(self.server.launch)
        elif target.path == "/api/iati/presets":
            if q:
                raise InputError("Presets take no query parameters")
            self._json(ws.presets())
        elif target.path == "/api/iati/profile":
            if set(q) != {"source"}:
                raise InputError("Select one original IATI source")
            self._json(ws.profile(q["source"]))
        elif target.path == "/api/iati/portfolios":
            if q:
                raise InputError("Portfolio inventory takes no query parameters")
            self._json({"portfolios": ws.portfolios()})
        elif target.path == "/api/iati/history":
            if set(q) != {"portfolio"}:
                raise InputError("Select one full original portfolio ID")
            self._json({"history": ws.history(q["portfolio"])})
        elif target.path in {"/api/iati/portfolio", "/api/iati/report", "/api/iati/export", "/api/iati/report/export"}:
            key = "id" if target.path == "/api/iati/portfolio" else "portfolio"
            if key not in q or set(q) - {key, "revision"}:
                raise InputError("Select the complete original portfolio ID and optional revision")
            selected_revision = revision(q.get("revision"))
            if target.path == "/api/iati/portfolio":
                self._json(ws.portfolio(q[key], selected_revision))
            elif target.path == "/api/iati/report":
                self._json(ws.report(q[key], selected_revision))
            else:
                with ws.mutex, ws.scratch() as temp:
                    archive = temp / ("iati-report.zip" if target.path == "/api/iati/report/export" else "iati-portfolio.zip")
                    if target.path == "/api/iati/report/export":
                        ws.write_report(q[key], archive, selected_revision)
                    else:
                        ws.export_portfolio(q[key], archive, selected_revision)
                    self._download(archive, archive.name, "application/zip")
        else:
            self._json({"error": "Unknown IATI source route"}, 404)

    def _post(self):
        target = urlsplit(self.path)
        if not target.path.startswith("/api/iati/") and target.path != "/api/import":
            return super()._post()
        self._gate()
        if target.query:
            raise InputError("IATI actions take a body, not query parameters")
        ws = self.server.workspace
        if target.path in {"/api/iati/receive", "/api/import"}:
            with ws.mutex, ws.scratch() as temp:
                packet = temp / "portfolio.zip"
                with packet.open("xb") as out:
                    packet.chmod(0o600)
                    shutil.copyfileobj(self._body(MAX_PACKET), out, 65536)
                self._json(ws.receive_portfolio(packet) if target.path == "/api/iati/receive" else ws.import_packet(packet), 201)
            return
        body = load_json(self._body().read())
        if not isinstance(body, dict):
            raise InputError("Use a complete original IATI object payload")
        if target.path == "/api/iati/portfolio":
            self._json(ws.save_portfolio(body), 201)
        elif target.path == "/api/iati/compare":
            self._json(ws.compare_portfolio(body), 201)
        else:
            self._json({"error": "Unknown IATI source action"}, 404)


class OperatorServer(_original.OperatorServer):
    def __init__(self, workspace: IatiWorkspace, port: int = 0):
        super().__init__(workspace, port, assets_directory=HERE / "public", handler_class=Handler)
        self.launch = None
