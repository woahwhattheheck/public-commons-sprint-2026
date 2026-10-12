"""Accountant references on immutable issued buyer allocations, in the same Store."""
from __future__ import annotations
import base64
import hashlib
import json
from domain import Problem, canonical, digest, identifier, now, text
from native_accountant import return_bytes, inspect_return

ACCOUNTANT_TABLES = {"accountant_returns", "accountant_heads"}
ACCOUNTANT_DDL = """
CREATE TABLE IF NOT EXISTS accountant_returns(id TEXT PRIMARY KEY,close_id TEXT NOT NULL,handoff_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,packet_base64 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accountant_heads(handoff_id TEXT PRIMARY KEY,return_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS accountant_returns_close ON accountant_returns(close_id,created_at,id);
"""


class AccountantStore:
    def accountant_source(self, close_id):
        with self.lock:
            workspace_id = self.connection.execute("SELECT value FROM meta WHERE key='id'").fetchone()[0]
            value = {"schema": "stellar-forge.buyer-accountant-source.v1", "workspaceId": workspace_id,
                     "issued": self._get("closes", close_id)}
            return (canonical(value) + "\n").encode("utf-8")

    def _accountant_return(self, ident):
        row = self.connection.execute("SELECT body FROM accountant_returns WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise Problem("ACCOUNTANT_RETURN_NOT_FOUND", "Choose a retained accountant return", 404)
        return json.loads(row[0])

    def accountant_returns(self, close_id, offset=0, limit=50):
        from store import page
        with self.lock:
            source = self.accountant_source(close_id)
            values = [json.loads(row[0]) for row in self.connection.execute(
                "SELECT body FROM accountant_returns WHERE close_id=? ORDER BY created_at DESC,id DESC", (close_id,))]
            heads = dict(self.connection.execute("SELECT handoff_id,return_id FROM accountant_heads"))
            summaries = [{k: value[k] for k in ("id", "close_id", "handoff_id", "created_at", "name", "operator",
                                               "packet_sha256", "selected_revision_id", "summary", "previous", "supersedes")}
                         | {"current": heads.get(value["handoff_id"]) == value["id"]} for value in values]
            return page(summaries, offset, limit) | {"close_id": close_id,
                "source_sha256": hashlib.sha256(source).hexdigest(), "revision": self.revision()}

    def accountant_delivery(self, close_id, expected_revision=None):
        from exports import accountant_packet
        with self.lock:
            if expected_revision is not None and (type(expected_revision) is not int or expected_revision != self.revision()):
                raise Problem("REVISION_CHANGED", "Review the current workspace revision before preparing its bookkeeping packet", 409)
            doc = self._get("closes", close_id)
            heads = set(row[0] for row in self.connection.execute("SELECT return_id FROM accountant_heads"))
            records = [json.loads(row[0]) for row in self.connection.execute(
                "SELECT body FROM accountant_returns WHERE close_id=? ORDER BY created_at,id", (close_id,))]
            values = [value | {"current": value["id"] in heads} for value in records]
            return accountant_packet(doc, {"source":self.accountant_source(close_id), "revision":self.revision(),
                "returns":values, "originals":{row["id"]:self.accountant_original(row["id"]) for row in records}})

    def accountant_return(self, ident):
        with self.lock:
            value = self._accountant_return(ident)
            head = self.connection.execute("SELECT return_id FROM accountant_heads WHERE handoff_id=?", (value["handoff_id"],)).fetchone()
            return value | {"current": bool(head and head[0] == ident)}

    def accountant_original(self, ident):
        with self.lock:
            row = self.connection.execute("SELECT packet_base64 FROM accountant_returns WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise Problem("ACCOUNTANT_RETURN_NOT_FOUND", "Choose a retained accountant return", 404)
            return base64.b64decode(row[0], validate=True)

    def preview_accountant_return(self, close_id, payload):
        with self.lock:
            packet = return_bytes(payload)
            native = inspect_return(self.accountant_source(close_id), packet, self.node_executable)
            row = self.connection.execute("SELECT return_id FROM accountant_heads WHERE handoff_id=?", (native["handoffId"],)).fetchone()
            previous = self._accountant_return(row[0]) if row else None
            chain = {value["id"]: value for value in native["revisions"]}
            if previous:
                old = previous["native"]
                retained = chain.get(old["selectedRevisionId"])
                if retained is None or retained["sha256"] != old["selectedRevisionSha256"]:
                    raise Problem("ACCOUNTANT_RETURN_DIVERGED", "This file does not extend the accountant history already accepted for its original handoff", 409)
            heads = [json.loads(row[0]) for row in self.connection.execute(
                "SELECT r.body FROM accountant_returns r JOIN accountant_heads h ON h.return_id=r.id WHERE r.close_id=?", (close_id,))]
            same_rows = {row["sourceLineId"] for row in native["rows"]}
            overlap = [{"return_id": saved["id"], "handoff_id": saved["handoff_id"],
                        "source_line_ids": sorted(same_rows.intersection(row["sourceLineId"] for row in saved["native"]["rows"]))}
                       for saved in heads if saved["handoff_id"] != native["handoffId"]]
            overlap = [value for value in overlap if value["source_line_ids"]]
            basis = {"packet_sha256": native["packetSha256"], "source_sha256": native["source"]["sha256"],
                     "previous": previous["id"] if previous else None, "other_handoffs": overlap}
            return {"native": native, "previous": basis["previous"], "other_handoffs": overlap,
                    "duplicate": bool(previous and previous["packet_sha256"] == native["packetSha256"]),
                    "preview_sha256": digest(basis), "revision": self.revision()}

    def save_accountant_return(self, close_id, payload, expected):
        def operation():
            preview = self.preview_accountant_return(close_id, payload)
            if payload.get("preview_sha256") != preview["preview_sha256"]:
                raise Problem("ACCOUNTANT_PREVIEW_CHANGED", "Preview the exact returned file against the current accepted bookkeeping history", 409)
            if preview["duplicate"]:
                return self._accountant_return(preview["previous"]) | {"duplicate": True}
            operator = text(payload.get("operator"), "Bookkeeping operator", maximum=160)
            name = text(payload.get("name"), "Bookkeeping return name", maximum=160)
            supersedes = payload.get("supersedes", [])
            required = sorted(value["return_id"] for value in preview["other_handoffs"])
            if not isinstance(supersedes, list) or sorted(supersedes) != required:
                raise Problem("ACCOUNTANT_HANDOFF_CONFLICT", "Review and explicitly supersede every other accepted handoff for these same issued allocation lines", 409)
            reason = text(payload.get("reason", ""), "Bookkeeping review note", maximum=2000, optional=not bool(required))
            native = preview["native"]
            value = {"id": identifier("accountant-return"), "close_id": close_id, "handoff_id": native["handoffId"],
                     "created_at": now(), "name": name, "operator": operator, "reason": reason,
                     "packet_sha256": native["packetSha256"], "source_sha256": native["source"]["sha256"],
                     "selected_revision_id": native["selectedRevisionId"], "summary": native["summary"],
                     "previous": preview["previous"], "supersedes": supersedes, "native": native}
            self.connection.execute("INSERT INTO accountant_returns VALUES(?,?,?,?,?,?)",
                (value["id"], close_id, value["handoff_id"], value["created_at"], canonical(value), payload["content_base64"]))
            for prior in preview["other_handoffs"]:
                self.connection.execute("DELETE FROM accountant_heads WHERE handoff_id=? AND return_id=?",
                                        (prior["handoff_id"], prior["return_id"]))
            self.connection.execute("INSERT INTO accountant_heads VALUES(?,?) ON CONFLICT(handoff_id) DO UPDATE SET return_id=excluded.return_id",
                                    (native["handoffId"], value["id"]))
            return value
        return self._change(expected, "accountant.return", operation)
