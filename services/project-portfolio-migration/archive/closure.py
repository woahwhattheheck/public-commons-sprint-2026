"""Selected native edition/source closure for an archive delivery.

This follows the existing portfolio record and MsPlanner read-transport contracts.
It copies original immutable bytes through their maintained stores and never
reopens a provider or includes unrelated workspace projects.
"""
from __future__ import annotations

import base64
import hashlib
import json

from portfolio.storage import canonical, checked_id, digest, file_identity, require


class SourceClosure:
    def __init__(self, portfolio, operator_store, sink):
        self.portfolio, self.operator, self.sink = portfolio, operator_store, sink
        self.records, self.objects, self.native_json = {}, {}, {}
        self.active = set()

    def portfolio_object(self, identity):
        identity = checked_id(identity)
        key = ("portfolio", identity)
        if key in self.objects:
            return self.objects[key]
        path = self.portfolio.store.object_path(identity)
        actual = file_identity(path)
        require(actual["sha256"] == identity, "archive_source_hash", "Retain the exact original portfolio object.")
        name = "source/portfolio-objects/" + identity
        self.sink.add_file(name, path, actual, role="portfolio_object", object_id=identity)
        self.objects[key] = name
        return name

    def operator_file(self, identity, expected_bytes=None):
        """Stream a complete original binary/capture object into this package."""
        identity = checked_id(identity)
        require(self.operator is not None, "archive_capture_store",
                "Open the original operator store for this native calculation.")
        key = ("operator", identity)
        path = self.operator.root / "objects" / identity
        actual = file_identity(path)
        require(actual["sha256"] == identity and (expected_bytes is None or actual["bytes"] == expected_bytes),
                "archive_capture_bytes", "The complete original native calculation changed.")
        if key not in self.objects:
            name = "source/operator-objects/" + identity
            self.sink.add_file(name, path, actual, role="operator_object", object_id=identity)
            self.objects[key] = name
        return self.objects[key]

    def operator_object(self, identity):
        identity = checked_id(identity)
        key = ("operator", identity)
        if key not in self.objects:
            require(self.operator is not None, "archive_capture_store",
                    "Open the original operator store to retain the selected native read capture.")
            raw = self.operator.read_bytes(identity)
            self.sink.add_bytes("source/operator-objects/" + identity, raw,
                                role="operator_object", object_id=identity)
            self.objects[key] = "source/operator-objects/" + identity
        return json.loads(self.operator.read_bytes(identity).decode("utf-8"))

    def operator_bytes(self, identity, expected_bytes=None):
        identity = checked_id(identity)
        raw = self.operator.read_bytes(identity)
        require(expected_bytes is None or len(raw) == expected_bytes,
                "archive_capture_bytes", "A retained native reader response changed its size.")
        key = ("operator", identity)
        if key not in self.objects:
            self.sink.add_bytes("source/operator-objects/" + identity, raw,
                                role="operator_object", object_id=identity)
            self.objects[key] = "source/operator-objects/" + identity
        return raw

    def record(self, table, identity):
        identity = checked_id(identity)
        key = (table, identity)
        if key in self.records:
            return self.records[key]
        row = self.portfolio.store.record(table, identity)
        require(row.get("id") == identity and digest({k: v for k, v in row.items() if k not in {"id", "created_at"}}) == identity,
                "archive_record_identity", "A selected native portfolio record changed its content identity.")
        name = "source/records/" + table + "/" + identity + ".json"
        raw = canonical(row)
        require(len(raw) <= 64 * 1024 * 1024, "archive_record_size",
                "An original JSON record exceeds the complete receiving record limit.")
        self.sink.add_bytes(name, raw, role="portfolio_record", table=table, record_id=identity)
        self.records[key] = row
        return row

    def reader_capture(self, provenance):
        if not provenance.get("read_transport_sha256"):
            return
        state = self.operator_object(provenance["read_transport_sha256"])
        require(state.get("schema") == "portfolio.msplanner-read-transport.v1" and state.get("complete") is True
                and state.get("binding", {}).get("project_id") == provenance.get("project_id")
                and state.get("binding", {}).get("native_reader") == provenance.get("native_reader"),
                "archive_reader_capture", "Retain this edition's complete original native read capture.")
        if provenance.get("probe_object_sha256"):
            self.operator_object(provenance["probe_object_sha256"])
        for url, selected in state.get("pages", {}).items():
            receipt = self.operator_object(selected["evidence_sha256"])
            require(receipt.get("url") == url and selected.get("url") == url
                    and receipt.get("status") == 200 and receipt.get("complete") is True,
                    "archive_reader_page", "A retained native page belongs to another source response.")
            raw = base64.b64decode(receipt["body_base64"], validate=True)
            require(len(raw) == receipt["bytes"] == selected["bytes"]
                    and hashlib.sha256(raw).hexdigest() == receipt["sha256"] == selected["body_sha256"],
                    "archive_reader_page_hash", "The selected original native response bytes changed.")
        for url, selected in state.get("requests", {}).items():
            require(selected.get("url") == url, "archive_reader_request", "Retain the exact original reader request.")
            self.operator_bytes(selected["body_sha256"], selected["bytes"])
        for selected in state.get("expanded_collections", {}).values():
            initial = self.operator_object(selected["inline_sha256"])
            combined = self.operator_object(selected["reader_collection_sha256"])
            require(isinstance(initial, list) and isinstance(combined, list)
                    and len(initial) == selected["inline_count"] and len(combined) == selected["reader_count"],
                    "archive_reader_collection", "A retained original expanded collection changed.")

    def edition(self, identity):
        identity = checked_id(identity)
        require(identity not in self.active, "archive_edition_cycle", "The original edition ancestry contains a cycle.")
        if ("editions", identity) in self.records:
            return self.portfolio.read_edition(identity)
        self.active.add(identity)
        try:
            record = self.record("editions", identity)
            self.portfolio_object(record["sha256"])
            edition = self.portfolio.read_edition(identity)
            model = edition["model"]
            require(model.get("schema") == "project-portfolio-model.v1",
                    "archive_model", "Retain an original complete project portfolio model.")
            require(record.get("source_ids") == list(dict.fromkeys(x["sha256"] for x in record.get("sources", []))),
                    "archive_source_ids", "The native edition's original source catalogue changed.")
            for source in record.get("sources", []):
                self.portfolio_object(source["sha256"])
                actual = file_identity(self.portfolio.store.object_path(source["sha256"]))
                require(actual["bytes"] == source["bytes"], "archive_source_size", "An original input changed its size.")
            if record.get("parent_id"):
                self.edition(record["parent_id"])
            if record.get("review_id"):
                review = self.record("reviews", record["review_id"])
                if review.get("edition_id"):
                    self.edition(review["edition_id"])
            recipe = record.get("recipe", {})
            if recipe.get("source_id"):
                self.portfolio_object(recipe["source_id"])
            if model.get("native_reopen", {}).get("comparison_sha256"):
                self.portfolio_object(model["native_reopen"]["comparison_sha256"])
            raw_text = model.get("native_json_text")
            require(isinstance(raw_text, str), "archive_native_json", "Keep the exact native JsonWriter bytes.")
            raw = raw_text.encode("utf-8")
            actual = {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
            require(actual == model.get("native_json_identity") and json.loads(raw) == model.get("native_json"),
                    "archive_native_json_hash", "The original native JSON representation changed.")
            if actual["sha256"] not in self.native_json:
                name = "source/native-json/" + actual["sha256"] + ".json"
                self.sink.add_bytes(name, raw, role="native_json", object_id=actual["sha256"])
                self.native_json[actual["sha256"]] = name
            self.reader_capture(model.get("provenance", {}))
            return edition
        finally:
            self.active.remove(identity)

    def summary(self):
        return {"record_count": len(self.records), "portfolio_objects": sum(k[0] == "portfolio" for k in self.objects),
                "operator_objects": sum(k[0] == "operator" for k in self.objects),
                "native_json_files": len(self.native_json)}


def restore_sources(portfolio, operator_store, manifest, selected_files, staged_file):
    """Rejoin original stores; binary objects use their existing file intake."""
    for item in manifest["files"]:
        role = item.get("role")
        if role not in {"portfolio_object", "operator_object"}:
            continue
        require(item["object_id"] == item["sha256"],
                "archive_object_identity", "The original object ID changed.")
        with staged_file(item["path"]) as source:
            if role == "portfolio_object":
                result = portfolio.store.put_file(source)
            else:
                require(operator_store is not None, "archive_operator_identity",
                        "Receive the original native capture into its operator store.")
                result = operator_store.retain_file(source, item["sha256"], item["bytes"])
            require(result["sha256"] == item["object_id"] and result["bytes"] == item["bytes"],
                    "archive_object_write", "The original store returned another object.")
    record_count = 0
    for item in manifest["files"]:
        if item.get("role") != "portfolio_record":
            continue
        require(item.get("table") in {"editions", "reviews", "comparisons", "exports"},
                "archive_record_family", "Receive an original portfolio record family.")
        require(item["bytes"] <= 64 * 1024 * 1024, "archive_record_size",
                "An original JSON record exceeds the complete receiving record limit.")
        raw = selected_files(item["path"])
        require(len(raw) == item["bytes"] and hashlib.sha256(raw).hexdigest() == item["sha256"],
                "archive_receiving_hash", "A selected archive member changed during receiving.", item["path"])
        row = json.loads(raw.decode("utf-8"))
        require(row.get("id") == item.get("record_id")
                and digest({k: v for k, v in row.items() if k not in {"id", "created_at"}}) == row["id"],
                "archive_record_hash", "An original native record changed.")
        portfolio.store.put_record(item["table"], row)
        record_count += 1
    for member in manifest["review"]["members"]:
        edition = portfolio.read_edition(member["edition_id"])
        require(edition["sha256"] == member["model_sha256"],
                "archive_received_edition", "The received original source edition changed.")
    return {"records": record_count, "editions": [row["edition_id"] for row in manifest["review"]["members"]]}
