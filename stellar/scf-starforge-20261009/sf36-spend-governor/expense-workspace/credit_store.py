"""Native refund intake and buyer credit decisions in the original expense Store."""
import base64
import io
import json
import zipfile
from pathlib import Path
from domain import Problem, canonical, digest, identifier, now, text, row_key
from native_woo import capture_refund, purchase_capture
from credits import data_context, coding_basis, purchase_matches, validate_credit_coding, credit_period

CREDIT_TABLES = {"refund_packets", "credits", "credit_codings", "credit_coding_heads"}
CREDIT_DDL = """
CREATE TABLE IF NOT EXISTS refund_packets(id TEXT PRIMARY KEY,manifest_sha256 TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credits(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,item_id TEXT NOT NULL,packet_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_codings(id TEXT PRIMARY KEY,credit_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_coding_heads(credit_id TEXT PRIMARY KEY,coding_id TEXT NOT NULL);
"""


def packet_summary(value):
    native = value["native"]
    return {k: value.get(k) for k in ("id", "status", "manifest_sha256", "created_at", "reviewed_at",
             "operator", "reason", "name", "data_context", "provenance", "source_id", "credit_id", "item_id")} | {
             "source_directory": native["source_directory"], "site_url": native["site_url"],
             "purchase": native["purchase"], "credit": native["credit"],
             "receipt": native["receipt"],
             "files": [{k: f[k] for k in ("name", "bytes", "sha256")} for f in native["files"]]}


class CreditStore:
    def _data_context(self):
        row = self.connection.execute("SELECT value FROM meta WHERE key='data_context'").fetchone()
        return row[0] if row else ("operational" if self.connection.execute("SELECT COUNT(*) FROM sources").fetchone()[0] else "")

    def _context(self, selected, commit=False):
        selected = data_context(selected)
        current = self._data_context()
        if current and current != selected:
            raise Problem("SEPARATE_DATA_CONTEXT", "This workspace contains " + current + " records. Use a separate workspace for " + selected + " inputs", 409)
        if commit and not current:
            self.connection.execute("INSERT INTO meta VALUES('data_context',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (selected,))
        return selected

    def _packet(self, ident):
        row = self.connection.execute("SELECT body FROM refund_packets WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise Problem("REFUND_PACKET_NOT_FOUND", "Select an original retained refund packet", 404)
        return json.loads(row[0])

    def refund_packets(self, offset=0, limit=50):
        from store import page
        with self.lock:
            values = [packet_summary(json.loads(row[0])) for row in self.connection.execute(
                "SELECT body FROM refund_packets ORDER BY created_at DESC,id DESC")]
            return page(values, offset, limit)

    def refund_packet(self, ident):
        with self.lock:
            value = packet_summary(self._packet(ident))
            value["matching_purchases"] = [{"id": item["id"], "source_name": item["source_name"],
                "request_id": item["row"]["request_id"], "coding_status": item["status"]}
                for item in self._items() if purchase_matches(item, value["purchase"])]
            return value

    def refund_original(self, ident):
        with self.lock:
            packet = self._packet(ident)
            native = packet["native"]
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                def member(name, raw):
                    item = zipfile.ZipInfo(name); item.create_system = 3
                    item.external_attr = 0o100600 << 16; item.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(item, raw)
                member("original/manifest.json", base64.b64decode(native["manifest_base64"], validate=True))
                for entry in native["files"]:
                    member("original/" + entry["name"], base64.b64decode(entry["base64"], validate=True))
                member("buyer-intake.json", (canonical(packet_summary(packet)) + "\n").encode())
            return output.getvalue()

    def capture_refund(self, payload, expected):
        name = text(payload.get("name"), "Original refund source name", maximum=160)
        provenance = text(payload.get("provenance"), "Original operation provenance", maximum=6000)
        kind = data_context(payload.get("data_context"))
        directory = text(payload.get("directory"), "Original refund handoff directory", maximum=4096)
        site = text(payload.get("site_url"), "Original store URL", maximum=2048)
        manifest = text(payload.get("manifest_sha256"), "Original manifest SHA-256", maximum=64)
        with self.lock:
            self._context(kind)
            if self.revision() != expected:
                raise Problem("WORKSPACE_CHANGED", "Refresh the original workspace before capturing this refund", 409)
            existing = self.connection.execute("SELECT id FROM refund_packets WHERE manifest_sha256=?", (manifest,)).fetchone()
            if existing:
                saved = self._packet(existing[0])
                if saved["data_context"] != kind or saved["native"]["site_url"] != site:
                    raise Problem("REFUND_SOURCE_CHANGED", "The same original packet already has a different retained context", 409)
                return self._change(expected, "refund.capture.reopen", lambda: packet_summary(saved))
            native = capture_refund(directory, manifest, site, self.root / "refund-intake" / manifest, self.node_executable)
            def operation():
                self._context(kind)
                value = {"id": identifier("refund-packet"), "status": "PENDING", "created_at": now(),
                         "manifest_sha256": manifest, "name": name, "data_context": kind,
                         "provenance": provenance, "native": native}
                self.connection.execute("INSERT INTO refund_packets VALUES(?,?,?,?,?)",
                    (value["id"], manifest, value["status"], value["created_at"], canonical(value)))
                return packet_summary(value)
            return self._change(expected, "refund.capture", operation)

    def decide_refund(self, ident, payload, expected):
        decision = payload.get("decision")
        if decision not in ("ACCEPT", "REJECT"):
            raise Problem("REFUND_DECISION", "Accept or reject the retained original refund packet")
        owner = text(payload.get("operator"), "Buyer source reviewer", maximum=240)
        reason = text(payload.get("reason"), "Buyer source decision", maximum=4000)
        def operation():
            packet = self._packet(ident)
            if packet["status"] != "PENDING":
                raise Problem("REFUND_REVIEWED", "This packet already has a retained decision", 409)
            native = packet["native"]
            packet.update(status="ACCEPTED" if decision == "ACCEPT" else "REJECTED",
                          operator=owner, reason=reason, reviewed_at=now())
            if decision == "ACCEPT":
                self._context(packet["data_context"], commit=True)
                p, n = native["purchase"], native["credit"]
                origin = digest([p["site_url"], p["order_reference"], p["transfer_identity"]])
                source = next((s for s in self._bodies("sources") if s.get("credit_origin_key") == origin), None)
                candidate = payload.get("purchase_item_id") or None
                if source:
                    if candidate and candidate != source["purchase_item_id"]:
                        raise Problem("CREDIT_PURCHASE_LINK", "This original order already binds to its retained buyer payment", 409)
                    candidate = source["linked_purchase_item"]
                elif candidate:
                    item = self.item(candidate)
                    if not purchase_matches(item, p):
                        raise Problem("CREDIT_PURCHASE_LINK", "Select the exact original payment event, parties, asset and amount", 409)
                other_bindings = [c for c in self._credit_views() if c["purchase"]["transfer_identity"] == p["transfer_identity"]]
                if other_bindings:
                    original_item = other_bindings[0]["item_id"]
                    if candidate and candidate != original_item:
                        raise Problem("CREDIT_PURCHASE_LINK", "This original payment already has returns bound to another retained expense row; select that original row", 409)
                    if source is None:
                        candidate = original_item
                if source is None:
                    if not candidate and payload.get("register_original_purchase") is not True:
                        raise Problem("CREDIT_PURCHASE_SELECTION", "Choose the matching retained buyer payment or explicitly register the original reviewed Woo purchase")
                    source = {"id": identifier("source"), "name": packet["name"], "kind": "woo_refund",
                              "path": native["source_directory"], "identity": {"purchase_identity": origin},
                              "credit_origin_key": origin, "immutable_intake": True,
                              "data_context": packet["data_context"], "provenance": packet["provenance"],
                              "created_at": now(), "current_capture": None, "linked_purchase_item": candidate}
                    if not candidate:
                        from native_woo import purchase_row
                        candidate = row_key(source["id"], purchase_row(native, packet["data_context"])["request_id"])
                    source["purchase_item_id"] = candidate
                    self._put("sources", source)
                item_id = source["purchase_item_id"]
                credit_id = "credit-" + digest([p["site_url"], n["adjustment_id"]])
                previous = self.connection.execute("SELECT body FROM credits WHERE id=?", (credit_id,)).fetchone()
                previous = json.loads(previous[0]) if previous else None
                native_basis = digest({k: n[k] for k in ("adjustment_id", "order_reference", "event_id", "original_transaction",
                    "amount", "network", "asset", "payer", "recipient", "transaction", "transfer_identity",
                    "observation_sha256", "currency", "store_amount", "input_sha256")})
                if previous and (previous["native_basis"] != native_basis or previous["item_id"] != item_id or
                                 previous["data_context"] != packet["data_context"]):
                    raise Problem("ORIGINAL_REFUND_CHANGED", "The same original adjustment changed its immutable payment, amount or buyer binding", 409)
                value = {"id": credit_id, "source_id": source["id"], "item_id": item_id, "packet_id": ident,
                         "manifest_sha256": packet["manifest_sha256"], "native": n, "purchase": p,
                         "native_basis": native_basis, "data_context": packet["data_context"],
                         "created_at": previous["created_at"] if previous else packet["created_at"],
                         "packet_history": (previous.get("packet_history", []) if previous else []) + [ident]}
                self.connection.execute("INSERT INTO credits VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET packet_id=excluded.packet_id,body=excluded.body",
                    (credit_id, source["id"], item_id, ident, canonical(value)))
                packet.update(source_id=source["id"], credit_id=credit_id, item_id=item_id)
                packets = [{"id": row["packet_id"], "manifest_sha256": json.loads(row["body"])["manifest_sha256"]}
                    for row in self.connection.execute("SELECT packet_id,body FROM credits WHERE source_id=? ORDER BY id", (source["id"],))]
                captured = self._new_capture(source, purchase_capture(native, source, packets, source["linked_purchase_item"]))
                captured = self._get("captures", captured["id"])
                self._accept_capture(captured, source)
                captured.update(status="ACCEPTED", operator=owner, reason=reason, reviewed_at=packet["reviewed_at"])
                self.connection.execute("UPDATE captures SET status='ACCEPTED',body=? WHERE id=?", (canonical(captured), captured["id"]))
            self.connection.execute("UPDATE refund_packets SET status=?,body=? WHERE id=?", (packet["status"], canonical(packet), ident))
            return packet_summary(packet)
        return self._change(expected, "refund." + decision.lower(), operation)

    def _credit_views(self):
        purchases = {item["id"]: item for item in self._items()}
        sources = {s["id"]: s for s in self._bodies("sources")}
        heads = {row["credit_id"]: json.loads(row["body"]) for row in self.connection.execute(
            "SELECT h.credit_id,c.body FROM credit_coding_heads h JOIN credit_codings c ON c.id=h.coding_id")}
        values = []
        for row in self.connection.execute("SELECT body FROM credits ORDER BY id"):
            value = json.loads(row[0]); source = sources[value["source_id"]]
            value.update(source_name=source["name"], capture_id=source["current_capture"],
                         coding=heads.get(value["id"]))
            value["basis"] = coding_basis(value, purchases.get(value["item_id"]))
            value["status"] = "UNCODED" if not value["coding"] else "CODED" if value["coding"]["basis"] == value["basis"] else "STALE"
            values.append(value)
        return values

    def credits(self, offset=0, limit=50):
        from store import page
        with self.lock:
            return page(self._credit_views(), offset, limit)

    def credit(self, ident):
        with self.lock:
            value = next((c for c in self._credit_views() if c["id"] == ident), None)
            if value is None:
                raise Problem("CREDIT_NOT_FOUND", "Select a retained original buyer credit", 404)
            value["purchase_item"] = self.item(value["item_id"])
            value["coding_history"] = [json.loads(row[0]) for row in self.connection.execute(
                "SELECT body FROM credit_codings WHERE credit_id=? ORDER BY created_at DESC,id DESC", (ident,))]
            value["related_credits"] = [{"id": c["id"], "adjustment_id": c["native"]["adjustment_id"],
                "amount": c["native"]["amount"], "coding": c.get("coding")} for c in self._credit_views()
                if c["item_id"] == value["item_id"] and c["id"] != ident]
            return value

    def save_credit_coding(self, ident, payload, expected):
        def operation():
            credit = self.credit(ident)
            value = validate_credit_coding(credit, payload, credit["purchase_item"],
                {c["id"]: c for c in self._bodies("centers")}, self._credit_views())
            dates = [value["recognition_date"]]
            if credit.get("coding"):
                dates.append(credit["coding"]["recognition_date"])
            if any(p["state"] == "CLOSED" and any(p["from_day"] <= d <= p["through_day"] for d in dates) for p in self._bodies("periods")):
                raise Problem("PERIOD_CLOSED", "Reopen the affected original period before changing a return allocation", 409)
            value.update(id=identifier("credit-coding"), created_at=now(),
                         previous=credit["coding"]["id"] if credit.get("coding") else None)
            self.connection.execute("INSERT INTO credit_codings VALUES(?,?,?,?)", (value["id"], ident, value["created_at"], canonical(value)))
            self.connection.execute("INSERT INTO credit_coding_heads VALUES(?,?) ON CONFLICT(credit_id) DO UPDATE SET coding_id=excluded.coding_id",
                                    (ident, value["id"]))
            return value
        return self._change(expected, "credit.code", operation)

    def _credit_period(self, view):
        closed = []
        for period in self._bodies("periods"):
            if period["id"] == view["period"]["id"] or period["state"] != "CLOSED" or not period.get("latest_close"):
                continue
            doc = self._get("closes", period["latest_close"])
            for line in doc.get("credit_allocations", []):
                closed.append({k: line[k] for k in ("credit_id", "item_id", "transfer_identity", "recognition_date", "amount")} |
                              {"period_id": period["id"], "close_id": doc["id"]})
        pending = [json.loads(r[0]) for r in self.connection.execute("SELECT body FROM refund_packets WHERE status='PENDING' ORDER BY id")]
        return credit_period(view, self._credit_views(), pending, self._items(),
            {c["id"]: c for c in self._bodies("centers")}, self._dispositions(view["period"]["id"]), closed, self._data_context())

    def _issued_refund_packets(self, report):
        ids = sorted({row["packet_id"] for row in report.get("merchant_credit_outcomes", [])})
        return [self._packet(ident) for ident in ids]
