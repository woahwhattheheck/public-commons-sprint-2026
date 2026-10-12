"""Original receipt intake and buyer credit decisions in the existing expense Store."""
import base64
import io
import json
import zipfile
from domain import Problem, canonical, digest, identifier, now, text, row_key
from native_woo import capture_refund
from native_adjustments import capture_adjustments as read_adjustments
from credits import data_context, coding_basis, purchase_matches, validate_credit_coding, credit_period

CREDIT_TABLES = {"refund_packets", "credits", "credit_codings", "credit_coding_heads"}
CREDIT_DDL = """
CREATE TABLE IF NOT EXISTS refund_packets(id TEXT PRIMARY KEY,manifest_sha256 TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credits(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,item_id TEXT NOT NULL,packet_id TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_codings(id TEXT PRIMARY KEY,credit_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_coding_heads(credit_id TEXT PRIMARY KEY,coding_id TEXT NOT NULL);
"""


def native_kind(native):
    return native.get("source_kind", "woo_refund")


def native_credits(native):
    return native.get("credits", [native["credit"]] if native.get("credit") else [])


def origin_key(native):
    if native_kind(native) == "merchant_adjustments":
        return digest(["merchant_adjustments", native["source_identity"]])
    p = native["purchase"]
    return digest([p["site_url"], p["order_reference"], p["transfer_identity"]])


def credit_identity(native, purchase, credit):
    if native_kind(native) == "merchant_adjustments":
        return "credit-" + digest(["merchant_adjustments", credit["network"], credit["adjustment_id"]])
    return "credit-" + digest([purchase["site_url"], credit["adjustment_id"]])


def credit_native_basis(native, credit):
    fields = ("adjustment_id", "order_reference", "event_id", "original_transaction", "amount", "network",
              "asset", "payer", "recipient", "transaction", "transfer_identity", "observation_sha256",
              "currency", "store_amount", "input_sha256")
    if native_kind(native) == "woo_refund":
        return digest({k: credit[k] for k in fields})
    return digest({k: credit.get(k) for k in fields} | {"source_kind": "merchant_adjustments",
                  "request_sha256": credit["request_sha256"]})


def packet_summary(value):
    native = value["native"]
    credits = native_credits(native)
    return {k: value.get(k) for k in ("id", "status", "manifest_sha256", "created_at", "reviewed_at",
             "operator", "reason", "name", "data_context", "provenance", "source_id", "credit_id", "credit_ids", "item_id")} | {
             "source_kind": native_kind(native), "source_directory": native["source_directory"],
             "source_file": native.get("source_file"), "source_sha256": native.get("source_sha256"),
             "source_reference": native.get("source_reference"), "site_url": native.get("site_url"),
             "manifest_kind": native.get("manifest_kind", "ORIGINAL_MERCHANT_MANIFEST"),
             "purchase": native.get("purchase"), "credit": credits[0] if credits else None, "credits": credits,
             "adjustments": native.get("adjustments", []), "original_event": native.get("original_event"),
             "payment_status": native.get("payment_status"), "receipt": native["receipt"],
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
            raise Problem("REFUND_PACKET_NOT_FOUND", "Select an original retained return receipt", 404)
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
                for item in self._items() if value["purchase"] and purchase_matches(item, value["purchase"])]
            return value

    def refund_original(self, ident):
        with self.lock:
            native = self._packet(ident)["native"]
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                def member(name, raw):
                    item = zipfile.ZipInfo(name); item.create_system = 3
                    item.external_attr = 0o100600 << 16; item.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(item, raw)
                manifest_name = "buyer-selection.json" if native.get("manifest_kind") == "BUYER_INTAKE_SELECTION" else "original/manifest.json"
                member(manifest_name, base64.b64decode(native["manifest_base64"], validate=True))
                for entry in native["files"]:
                    member("original/" + entry["name"], base64.b64decode(entry["base64"], validate=True))
                member("buyer-intake.json", (canonical(packet_summary(self._packet(ident))) + "\n").encode())
            return output.getvalue()

    def _capture_receipt(self, payload, expected, reader, source_kind):
        name = text(payload.get("name"), "Original receipt source name", maximum=160)
        provenance = text(payload.get("provenance"), "Original operation provenance", maximum=6000)
        context = data_context(payload.get("data_context"))
        with self.lock:
            self._context(context)
            if self.revision() != expected:
                raise Problem("WORKSPACE_CHANGED", "Refresh the original workspace before capturing this receipt", 409)
            native = reader()
            manifest = native["manifest_sha256"]
            existing = self.connection.execute("SELECT id FROM refund_packets WHERE manifest_sha256=?", (manifest,)).fetchone()
            if existing:
                saved = self._packet(existing[0])
                if saved["data_context"] != context or native_kind(saved["native"]) != source_kind:
                    raise Problem("REFUND_SOURCE_CHANGED", "The same original receipt has a different retained context", 409)
                if source_kind == "woo_refund" and saved["native"]["site_url"] != native["site_url"]:
                    raise Problem("REFUND_SOURCE_CHANGED", "The same original packet has another store binding", 409)
                return self._change(expected, "refund.capture.reopen", lambda: packet_summary(saved))
            def operation():
                self._context(context)
                value = {"id": identifier("refund-packet"), "status": "PENDING", "created_at": now(),
                         "manifest_sha256": manifest, "name": name, "data_context": context,
                         "provenance": provenance, "native": native}
                self.connection.execute("INSERT INTO refund_packets VALUES(?,?,?,?,?)",
                    (value["id"], manifest, value["status"], value["created_at"], canonical(value)))
                return packet_summary(value)
            return self._change(expected, "refund.capture", operation)

    def capture_refund(self, payload, expected):
        directory = text(payload.get("directory"), "Original refund handoff directory", maximum=4096)
        site = text(payload.get("site_url"), "Original store URL", maximum=2048)
        manifest = text(payload.get("manifest_sha256"), "Original manifest SHA-256", maximum=64)
        return self._capture_receipt(payload, expected, lambda: capture_refund(
            directory, manifest, site, self.root / "refund-intake" / manifest, self.node_executable), "woo_refund")

    def capture_adjustments(self, payload, expected):
        source_file = text(payload.get("source_file"), "Original accounting-export file", maximum=4096)
        source_sha = text(payload.get("source_sha256"), "Original export SHA-256", maximum=64)
        event_id = text(payload.get("event_id"), "Original accounting event ID", maximum=64)
        return self._capture_receipt(payload, expected, lambda: read_adjustments(
            source_file, source_sha, event_id, payload.get("expected_job"), self.node_executable), "merchant_adjustments")

    def decide_refund(self, ident, payload, expected):
        decision = payload.get("decision")
        if decision not in ("ACCEPT", "REJECT"):
            raise Problem("REFUND_DECISION", "Accept or reject the retained original receipt")
        owner = text(payload.get("operator"), "Buyer source reviewer", maximum=240)
        reason = text(payload.get("reason"), "Buyer source decision", maximum=4000)
        def operation():
            packet = self._packet(ident)
            if packet["status"] != "PENDING":
                raise Problem("REFUND_REVIEWED", "This receipt already has a retained decision", 409)
            native = packet["native"]
            packet.update(status="ACCEPTED" if decision == "ACCEPT" else "REJECTED",
                          operator=owner, reason=reason, reviewed_at=now())
            if decision == "ACCEPT":
                self._context(packet["data_context"], commit=True)
                kind, p, returns = native_kind(native), native.get("purchase"), native_credits(native)
                if kind == "merchant_adjustments":
                    from native_adjustments import purchase_row, purchase_capture
                else:
                    from native_woo import purchase_row, purchase_capture
                origin = origin_key(native)
                source = next((s for s in self._bodies("sources") if s.get("credit_origin_key") == origin), None)
                requested = payload.get("purchase_item_id") or None
                linked = source.get("linked_purchase_item") if source and source.get("purchase_item_id") else requested
                item_id = source.get("purchase_item_id") if source else None
                if p is None:
                    if requested or payload.get("register_original_purchase") is True or returns:
                        raise Problem("ORIGINAL_PAYMENT_PROOF_REQUIRED", "This source records the merchant decision without a complete original payment proof. Accept its reference without registering an expense.", 409)
                else:
                    if item_id:
                        if requested and requested != item_id:
                            raise Problem("CREDIT_PURCHASE_LINK", "This original payment already binds to its retained buyer row", 409)
                        if not purchase_matches(self.item(item_id), p):
                            raise Problem("CREDIT_PURCHASE_LINK", "This receipt differs from the previously accepted original buyer payment", 409)
                    elif requested and not purchase_matches(self.item(requested), p):
                        raise Problem("CREDIT_PURCHASE_LINK", "Select the exact original payment event, parties, asset and amount", 409)
                    other_bindings = [c for c in self._credit_views() if c["purchase"]["transfer_identity"] == p["transfer_identity"]]
                    if other_bindings:
                        original_item = other_bindings[0]["item_id"]
                        if (requested and requested != original_item) or (item_id and item_id != original_item):
                            raise Problem("CREDIT_PURCHASE_LINK", "This original payment already has returns bound to another expense row", 409)
                        if not item_id:
                            linked = original_item
                    if not item_id and not linked and payload.get("register_original_purchase") is not True:
                        raise Problem("CREDIT_PURCHASE_SELECTION", "Choose the matching buyer payment or explicitly register the reviewed original purchase")
                if source is None:
                    source = {"id": identifier("source"), "name": packet["name"], "kind": kind,
                              "path": native.get("source_file", native["source_directory"]),
                              "identity": {"purchase_identity": origin}, "credit_origin_key": origin,
                              "immutable_intake": True, "data_context": packet["data_context"], "provenance": packet["provenance"],
                              "created_at": now(), "current_capture": None, "linked_purchase_item": linked,
                              "purchase_item_id": None}
                if p and not item_id:
                    item_id = linked or row_key(source["id"], purchase_row(native, packet["data_context"])["request_id"])
                    source.update(purchase_item_id=item_id, linked_purchase_item=linked)
                source["latest_refund_packet"] = ident
                self._put("sources", source)
                credit_ids = []
                for n in returns:
                    credit_id = credit_identity(native, p, n)
                    previous = self.connection.execute("SELECT body FROM credits WHERE id=?", (credit_id,)).fetchone()
                    previous = json.loads(previous[0]) if previous else None
                    native_basis = credit_native_basis(native, n)
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
                    credit_ids.append(credit_id)
                packet.update(source_id=source["id"], credit_id=credit_ids[0] if credit_ids else None,
                              credit_ids=credit_ids, item_id=item_id)
                packets = [{"id": row["id"], "manifest_sha256": row["manifest_sha256"]}
                           for row in (json.loads(r[0]) for r in self.connection.execute("SELECT body FROM refund_packets WHERE status='ACCEPTED' ORDER BY created_at,id"))
                           if row.get("source_id") == source["id"]]
                packets.append({"id": ident, "manifest_sha256": packet["manifest_sha256"]})
                # A reference-only successor does not remove an already retained
                # independently proved purchase or relabel it as newly observed.
                if p or not source.get("purchase_item_id"):
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
        latest = {s["id"]: {n["adjustment_id"] for n in native_credits(self._packet(s["latest_refund_packet"])["native"])}
                  for s in sources.values() if s.get("kind") == "merchant_adjustments" and s.get("latest_refund_packet")}
        values = []
        for row in self.connection.execute("SELECT body FROM credits ORDER BY id"):
            value = json.loads(row[0]); source = sources[value["source_id"]]
            value.update(source_name=source["name"], capture_id=source["current_capture"],
                         coding=heads.get(value["id"]),
                         present_in_latest_receipt=value["native"]["adjustment_id"] in latest[source["id"]] if source["id"] in latest else True)
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
            {c["id"]: c for c in self._bodies("centers")}, self._dispositions(view["period"]["id"]), closed, self._data_context(), self._adjustment_outcomes())

    def _adjustment_outcomes(self):
        result = []
        for source in self._bodies("sources"):
            ident = source.get("latest_refund_packet")
            if source.get("kind") != "merchant_adjustments" or not ident:
                continue
            packet = self._packet(ident)
            native = packet["native"]
            common = {"packet_id": ident, "source_id": source["id"], "source_name": source["name"],
                      "source_capture": source["current_capture"], "manifest_sha256": packet["manifest_sha256"],
                      "source_sha256": native["source_sha256"], "event_id": native["source_identity"]["event_id"],
                      "data_context": packet["data_context"], "payment_status": native["payment_status"],
                      "source_reference": native["source_reference"],
                      "network": native["original_event"]["network"], "asset_digest": native["original_event"]["assetDigest"],
                      "merchant_totals": native["receipt"]["totals"]}
            if native["adjustments"]:
                result.extend(common | row for row in native["adjustments"])
            else:
                result.append(common | {"kind": "ORIGINAL_EVENT", "status": "NO_ADJUSTMENT", "adjustment_id": None,
                                         "amount": None, "native_verified": False, "eligible_return": False})
        return result

    def _issued_refund_packets(self, report):
        rows = report.get("merchant_credit_outcomes", []) + report.get("merchant_adjustment_outcomes", [])
        ids = sorted({row["packet_id"] for row in rows})
        return [self._packet(ident) for ident in ids]
