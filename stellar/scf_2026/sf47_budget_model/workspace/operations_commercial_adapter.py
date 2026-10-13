"""Configured connection to the original running customer receivables service."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

from model import Problem, canonical

_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")
_SCHEMA = "stellar-forge.commercial-receivables-connections.v1"


class CommercialConnectionAdapter:
    def __init__(self, workspace):
        self.workspace = workspace
        self.helper = Path(__file__).with_name("node_commercial_receivables.mjs")
        with workspace.mutex:
            workspace.db.execute("""
                CREATE TABLE IF NOT EXISTS commercial_receivables_connections (
                    id TEXT PRIMARY KEY,
                    document TEXT NOT NULL
                )
            """)

    def endpoints(self):
        with self.workspace.mutex:
            rows = self.workspace.db.execute(
                "SELECT document FROM commercial_receivables_connections ORDER BY id"
            ).fetchall()
        return {"schema": _SCHEMA, "endpoints": [json.loads(row[0]) for row in rows]}

    def endpoint(self, identifier):
        if not isinstance(identifier, str) or not _IDENTIFIER.fullmatch(identifier):
            raise Problem("Choose a saved accounting connection.", 422, "COMMERCIAL_CONNECTION_REQUIRED")
        with self.workspace.mutex:
            row = self.workspace.db.execute(
                "SELECT document FROM commercial_receivables_connections WHERE id=?", (identifier,)
            ).fetchone()
        if row is None:
            raise Problem("The accounting connection is unavailable. Reconnect the original accounting workspace.",
                          404, "COMMERCIAL_CONNECTION_NOT_FOUND")
        return json.loads(row[0])

    def configure(self, body):
        if not isinstance(body, dict):
            raise Problem("Send a connection object.", 422, "COMMERCIAL_INPUT_INVALID")
        identifier, label, actor = body.get("id"), body.get("label"), body.get("actor")
        if not isinstance(identifier, str) or not _IDENTIFIER.fullmatch(identifier):
            raise Problem("Enter a connection name using letters, digits, periods, colons or hyphens.",
                          422, "COMMERCIAL_CONNECTION_INVALID")
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 160:
            raise Problem("Enter a short accounting connection label.", 422, "COMMERCIAL_CONNECTION_INVALID")
        if not isinstance(actor, str) or not 1 <= len(actor.strip()) <= 1000:
            raise Problem("Enter the recording operator.", 422, "COMMERCIAL_ACTOR_REQUIRED")
        raw_url = body.get("baseUrl")
        try:
            url = urlsplit(raw_url)
            valid_url = (
                url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")
                and not url.username and not url.password and not url.query and not url.fragment
                and url.path.startswith("/") and "//" not in url.path and url.port is not None
            )
        except (TypeError, ValueError):
            valid_url = False
        if not valid_url:
            raise Problem("Use the local receivables API address, including its port.",
                          422, "COMMERCIAL_ENDPOINT_INVALID")
        # Connection inspection is a read. Save only the original server identity it returns.
        identity = self._call("connect", {"baseUrl": raw_url}, {})
        document = {
            "id": identifier, "label": label.strip(), "baseUrl": identity["baseUrl"],
            "workspaceId": identity["workspaceId"], "sourcesSha256": identity["sourcesSha256"],
            "recordedBy": actor.strip(),
        }
        payload = {"operation": "commercial.connection", **body}

        def save():
            row = self.workspace.db.execute(
                "SELECT document FROM commercial_receivables_connections WHERE id=?", (identifier,)
            ).fetchone()
            if row is not None:
                original = json.loads(row[0])
                if any(original[key] != document[key] for key in ("workspaceId", "sourcesSha256")):
                    raise Problem("This connection already belongs to another accounting workspace. Use its original server, or create a separate connection.",
                                  409, "COMMERCIAL_CONNECTION_RETARGETED")
            self.workspace.db.execute(
                "INSERT INTO commercial_receivables_connections(id,document) VALUES (?,?) "
                "ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                (identifier, canonical(document)),
            )
            return document

        return self.workspace._transaction(body.get("requestId"), payload, save)

    def _call(self, operation, endpoint, payload):
        try:
            completed = subprocess.run(
                ["node", str(self.helper)],
                input=json.dumps({"operation": operation, "endpoint": endpoint, "payload": payload}),
                text=True, encoding="utf-8", capture_output=True, timeout=35, check=False,
            )
        except FileNotFoundError as exc:
            raise Problem("Install Node.js to connect this workspace to native receivables.",
                          503, "COMMERCIAL_NODE_UNAVAILABLE") from exc
        except subprocess.TimeoutExpired as exc:
            raise Problem("The accounting server did not finish responding. Reopen the saved billing item and retry the same operation.",
                          504, "COMMERCIAL_TRANSPORT_TIMEOUT") from exc
        try:
            response = json.loads(completed.stdout)
        except (TypeError, ValueError) as exc:
            raise Problem("The accounting response could not be read. Reopen the saved billing item and retry the same operation.",
                          502, "COMMERCIAL_TRANSPORT_FAILED") from exc
        if not response.get("ok"):
            error = response.get("error") or {}
            status = error.get("status", 502)
            if not isinstance(status, int) or not 400 <= status <= 599:
                status = 502
            raise Problem(str(error.get("message") or "The accounting operation could not finish."),
                          status, str(error.get("code") or "COMMERCIAL_TRANSPORT_FAILED"))
        return response["result"]

    def __call__(self, operation, payload):
        if operation == "endpoints":
            return self.endpoints()
        if operation == "configure":
            return self.configure(payload)
        endpoint = self.endpoint(payload.get("endpointId"))
        return self._call(operation, endpoint, payload)


def commercial_store(operations):
    with operations.workspace.mutex:
        if operations.commercial.adapter is None:
            operations.commercial.adapter = CommercialConnectionAdapter(operations.workspace)
        return operations.commercial
