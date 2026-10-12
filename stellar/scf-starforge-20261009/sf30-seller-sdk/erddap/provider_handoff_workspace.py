"""MIT. Immutable provider reviews and retained intake bundles in the original workspace."""
from __future__ import annotations
import io
import json
import os
from pathlib import Path
import time
import zipfile
import erddap_source as source
from erddap_source import InputError
from erddap_workspace import atomic, ident, _original
import provider_handoff as handoff

class HandoffStore:
    def __init__(self, workspace):
        self.workspace = workspace
        self.root = workspace.root / "provider-handoffs"
        with workspace.mutex:
            for path in [self.root, self.root / "exports", self.root / "received"]:
                path.mkdir(mode=0o700, exist_ok=True)
                if path.is_symlink() or not path.is_dir():
                    raise InputError("Provider handoffs require a real workspace directory")
            workspace.db.executescript("""
                CREATE TABLE IF NOT EXISTS erddap_handoff_reviews(
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, parent TEXT,
                    body TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS erddap_handoff_heads(
                    source TEXT PRIMARY KEY, revision TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS erddap_handoff_received(
                    id TEXT PRIMARY KEY, body TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS erddap_handoff_source_reviews
                    ON erddap_handoff_reviews(source,created);
            """)

    def _capture(self, source_id):
        sid = ident(source_id)
        self.workspace.source(sid)
        path = self.workspace.root / "sources" / (sid + ".erddap")
        _original.regular(path, 2 * source.MAX_SOURCE)
        raw = path.read_bytes()
        if source.sha(raw) != sid:
            raise InputError("Retained ERDDAP source bytes changed")
        return handoff.Capture(raw)

    def _head(self, source_id):
        row = self.workspace.db.execute("SELECT revision FROM erddap_handoff_heads WHERE source=?", (source_id,)).fetchone()
        return row["revision"] if row else None

    def get(self, revision):
        with self.workspace.mutex:
            row = self.workspace.db.execute("SELECT * FROM erddap_handoff_reviews WHERE id=?", (ident(revision),)).fetchone()
            if not row:
                raise InputError("Provider review revision was not found")
            value = source.json_value(row["body"])
            if value.get("schema") != handoff.REVIEW or value.get("id") != revision or value.get("sourceId") != row["source"] or value.get("parent") != row["parent"] or handoff.record_revision_id(value) != revision:
                raise InputError("Retained provider review identity changed")
            return {**value, "created": row["created"]}

    def history(self, source_id, offset=0, limit=100):
        sid = ident(source_id)
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise InputError("Review history requires a nonnegative offset and 1-250 revisions")
        with self.workspace.mutex:
            self.workspace.source(sid)
            rows = list(self.workspace.db.execute(
                "SELECT id FROM erddap_handoff_reviews WHERE source=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
                (sid, limit + 1, offset)))
            items = []
            for row in rows[:limit]:
                value = self.get(row["id"])
                items.append({"id": value["id"], "parent": value["parent"], "sourceId": sid,
                    "created": value["created"], "title": value["profile"]["title"],
                    "reviewedBy": value["profile"]["reviewedBy"], "ready": value["review"]["ready"],
                    "issueCount": value["review"]["issueCount"], "errorCount": value["review"]["errorCount"]})
            return {"sourceId": sid, "head": self._head(sid), "revisions": items, "offset": offset,
                "nextOffset": offset + limit if len(rows) > limit else None}

    def preview(self, source_id, profile):
        with self.workspace.mutex:
            c = self._capture(source_id)
            checked = handoff.review(c, profile)
            return {"sourceId": c.id, "head": self._head(c.id), "profile": checked["profile"],
                "review": checked["review"], "source": c.summary()}

    def draft(self, source_id):
        with self.workspace.mutex:
            c = self._capture(source_id)
            head = self._head(c.id)
            profile = self.get(head)["profile"] if head else handoff.draft_profile(c)
            checked = handoff.review(c, profile)
            return {"sourceId": c.id, "head": head, "profile": checked["profile"],
                "review": checked["review"], "source": c.summary(), "history": self.history(c.id)}

    def save(self, source_id, profile, expected_head=None):
        with self.workspace.mutex:
            c = self._capture(source_id)
            normalized = handoff.normalize_profile(profile, c)
            if expected_head is not None:
                ident(expected_head)
            # A retry names the original request, not the software version now
            # evaluating it. Recover supported earlier records before new review.
            candidates = {handoff.revision_id(normalized, expected_head),
                handoff.revision_id(normalized, expected_head, handoff.CURRENT_EVALUATION)}
            existing = [row for candidate in candidates for row in self.workspace.db.execute(
                "SELECT id,body FROM erddap_handoff_reviews WHERE id=?", (candidate,))]
            if len(existing) > 1:
                raise InputError("The original review request has conflicting retained generations")
            if existing:
                selected, record = handoff.validate_record(c, source.json_value(existing[0]["body"]))
                if record["parent"] != expected_head or source.jbytes(record["profile"]) != source.jbytes(normalized):
                    raise InputError("Existing review differs from the exact original request")
                return self.get(existing[0]["id"])
            record = handoff.make_review_record(c, normalized, expected_head)
            revision = record["id"]
            encoded = source.jbytes(record).decode("utf-8")
            current = self._head(c.id)
            if current != expected_head:
                error = InputError("The provider review changed. Reopen the latest revision and reconcile your edits.")
                error.status = 409
                error.current_revision = current
                raise error
            with self.workspace.db:
                self.workspace.db.execute("INSERT INTO erddap_handoff_reviews VALUES(?,?,?,?,?)",
                    (revision, c.id, expected_head, encoded, time.time()))
                self.workspace.db.execute("INSERT INTO erddap_handoff_heads VALUES(?,?) ON CONFLICT(source) DO UPDATE SET revision=excluded.revision",
                    (c.id, revision))
            return self.get(revision)

    def state(self):
        with self.workspace.mutex:
            heads = []
            for row in self.workspace.db.execute("SELECT source,revision FROM erddap_handoff_heads ORDER BY source"):
                value = self.get(row["revision"])
                heads.append({"sourceId": row["source"], "head": value["id"], "title": value["profile"]["title"],
                    "reviewedBy": value["profile"]["reviewedBy"], "created": value["created"],
                    "ready": value["review"]["ready"], "issueCount": value["review"]["issueCount"],
                    "errorCount": value["review"]["errorCount"], "rowCount": value["review"]["rowCount"],
                    "stationCount": value["review"]["stationCount"]})
            received = [source.json_value(row["body"]) for row in self.workspace.db.execute(
                "SELECT body FROM erddap_handoff_received ORDER BY created DESC")]
            return {"schema": "stellar-forge.erddap-provider-workspace.v1", "heads": heads,
                "received": received, "limits": {"profileBytes": handoff.MAX_PROFILE,
                    "bundleBytes": handoff.MAX_HANDOFF, "stations": handoff.MAX_STATIONS}}

    def export(self, revision, mode="review"):
        if mode not in {"review", "ready"}:
            raise InputError("Choose review or ready export")
        with self.workspace.mutex:
            value = self.get(ident(revision))
            path = self.root / "exports" / (revision + "-" + mode + ".zip")
            receipt_path = path.with_suffix(".json")
            if path.exists():
                _original.regular(path, handoff.MAX_HANDOFF)
                raw = path.read_bytes()
                digest = source.sha(raw)
                verified = handoff.receive_bundle(raw)
                if verified["revision"] != revision or verified["mode"] != mode or verified["sourceId"] != value["sourceId"] or source.jbytes(verified["review"]) != source.jbytes(value["review"]):
                    raise InputError("Retained export differs from its original supported evaluation")
                if receipt_path.exists():
                    _original.regular(receipt_path, 4 * handoff.MAX_PROFILE)
                    receipt = source.json_value(receipt_path.read_bytes())
                    if receipt.get("sha256") != digest or receipt.get("bytes") != len(raw) or receipt.get("revision") != revision or receipt.get("mode") != mode or receipt.get("sourceId") != value["sourceId"] or source.jbytes(receipt.get("review")) != source.jbytes(verified["review"]):
                        raise InputError("Retained provider export differs from its receipt")
                else:
                    # The ZIP may have completed before its receipt. Reopen the
                    # existing bytes and adopt their original source/review identity.
                    result = verified
                    if result["revision"] != revision or result["mode"] != mode or result["sourceId"] != value["sourceId"]:
                        raise InputError("Retained provider export belongs to another review")
                    receipt = {"schema": "stellar-forge.erddap-provider-export.v1",
                        "revision": revision, "mode": mode, "sourceId": value["sourceId"],
                        "bytes": len(raw), "sha256": digest, "review": result["review"]}
                    atomic(receipt_path, source.jbytes(receipt))
                return {**receipt, "path": str(path)}
            c = self._capture(value["sourceId"])
            record = {key: item for key, item in value.items() if key != "created"}
            built = handoff.build_bundle(c, value["profile"], mode, value["parent"], record=record)
            if built["manifest"]["revision"] != revision:
                raise InputError("Export review revision differs from the retained original")
            atomic(path, built["raw"])
            receipt = {"schema": "stellar-forge.erddap-provider-export.v1",
                "revision": revision, "mode": mode, "sourceId": c.id,
                "bytes": built["bytes"], "sha256": built["sha256"], "review": built["review"]}
            atomic(receipt_path, source.jbytes(receipt))
            return {**receipt, "path": str(path)}

    def receive(self, value):
        raw = value if isinstance(value, bytes) else value.read(handoff.MAX_HANDOFF + 1)
        result = handoff.receive_bundle(raw)
        with self.workspace.mutex:
            path = self.root / "received" / (result["sha256"] + ".zip")
            if path.exists():
                _original.regular(path, handoff.MAX_HANDOFF)
                existing = path.read_bytes()
                if existing != raw:
                    raise InputError("Existing received provider bundle changed")
            else:
                atomic(path, raw)
            result = {**result, "retained": True}
            encoded = source.jbytes(result).decode("utf-8")
            existing = self.workspace.db.execute("SELECT body FROM erddap_handoff_received WHERE id=?", (result["sha256"],)).fetchone()
            if existing and existing["body"] != encoded:
                raise InputError("Original provider receiving receipt changed")
            if not existing:
                with self.workspace.db:
                    self.workspace.db.execute("INSERT INTO erddap_handoff_received VALUES(?,?,?)",
                        (result["sha256"], encoded, time.time()))
            return result

    def received_path(self, receipt_id):
        with self.workspace.mutex:
            identity = ident(receipt_id)
            row = self.workspace.db.execute("SELECT body FROM erddap_handoff_received WHERE id=?", (identity,)).fetchone()
            if not row:
                raise InputError("Received provider bundle was not found")
            receipt = source.json_value(row["body"])
            path = self.root / "received" / (identity + ".zip")
            _original.regular(path, handoff.MAX_HANDOFF)
            if path.stat().st_size != receipt["bytes"] or source.sha(path.read_bytes()) != identity:
                raise InputError("Received provider bundle identity changed")
            return path

    def received(self, receipt_id):
        with self.workspace.mutex:
            identity = ident(receipt_id)
            path = self.received_path(identity)
            row = self.workspace.db.execute("SELECT body FROM erddap_handoff_received WHERE id=?", (identity,)).fetchone()
            receipt = source.json_value(row["body"])
            with zipfile.ZipFile(path) as z:
                record = source.json_value(z.read("provider-review.json"))
                original = handoff.Capture(z.read("original/capture.erddap.zip"))
            original, record = handoff.validate_record(original, record)
            if original.id != receipt["sourceId"] or record.get("id") != receipt["revision"] or source.jbytes(record["review"]) != source.jbytes(receipt["review"]):
                raise InputError("Received provider profile differs from its original receipt")
            return {"receipt": receipt, "profile": record["profile"], "review": record["review"],
                "source": original.summary()}
