"""The joined audit operator: source intake through receiving and recovery."""
from __future__ import annotations

import base64
import copy
import csv
import io
import hashlib
import html
import os
import stat
import json
from pathlib import Path
import secrets
import zipfile

from . import exchange, reporting
from .archive import create_backup, inspect_backup, restore_backup
from .model import SCHEMAS, STAGES, current_review, engagement_id, follow_up_queue, readiness, risk_score, validate_payload
from .store import Conflict, DOMAIN_KINDS, Forbidden, MAX_SOURCE, Store, atomic_write, digest, encoded, fingerprint, identifier, now, private_directory, safe_name

INTERNAL_SOURCE_ROLES = {"import_plan", "receipt_plan", "receipt", "report_projection", "report", "handoff", "received_bundle", "comparison", "native_export"}
GRAPH_DIAGNOSTICS = {"missing_relationship", "missing_review_target", "cross_engagement_relationship", "area_cycle", "relationship_kind_mismatch"}
SOURCE_ROOT = Path(__file__).resolve().parent.parent

def require_auditor(actor):
    if actor.get("role") != "auditor":
        raise Forbidden("This action belongs to an authenticated auditor.")

def _new(kind, payload, namespace, original_id, source_revision=None, locator=None):
    rid = (exchange.stable_record_id(kind, namespace, original_id) if kind in DOMAIN_KINDS
           else kind + "-" + fingerprint([kind, namespace, original_id])[:32])
    stamp = now()
    return {"kind": kind, "id": rid, "revision": 1,
            "source": {"namespace": namespace, "id": original_id,
                       "revision": str(source_revision or fingerprint(payload)), "locator": locator},
            "payload": copy.deepcopy(payload), "created_at": stamp, "updated_at": stamp}

def _decode(value):
    if not isinstance(value, str) or len(value) > (MAX_SOURCE * 4 // 3 + 8):
        raise ValueError("One uploaded source may contain at most 64 MiB.")
    try:
        data = base64.b64decode(value, validate=True)
    except ValueError:
        raise ValueError("The uploaded file is incomplete.") from None
    if len(data) > MAX_SOURCE:
        raise ValueError("One uploaded source may contain at most 64 MiB.")
    return data

def _record_label(record):
    p = record["payload"]
    label = SCHEMAS.get(record["kind"], {}).get("label")
    return str(p.get(label) or p.get("title") or p.get("label") or p.get("filename") or record["source"]["id"])

def _same_import(previous, incoming):
    return (previous["source"]["namespace"] == incoming["source"]["namespace"]
            and previous["source"]["id"] == incoming["source"]["id"]
            and str(previous["source"].get("revision")) == str(incoming["source"].get("revision"))
            and previous["payload"] == incoming["payload"])

def _zip(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
    value = stream.getvalue()
    if len(value) > MAX_SOURCE:
        raise ValueError("This downloadable handoff exceeds 64 MiB.")
    return value

class AuditService:
    def __init__(self, root):
        self.store = Store(root)
        self.output_directory = private_directory(self.store.root / "downloads")
        self.catalog_bytes = (SOURCE_ROOT / "reference/event-catalog.json").read_bytes()
        self.catalog = exchange._load_json(self.catalog_bytes, "original issuer catalog")
        self.catalog_sha = digest(self.catalog_bytes)
        self.contract_bytes = (SOURCE_ROOT / "reference/audit-domain-contract.json").read_bytes()
        self.contract = exchange._load_json(self.contract_bytes, "audit domain contract")
        request = {"catalog_sha256": self.catalog_sha, "contract_sha256": digest(self.contract_bytes)}
        def initialize():
            a = self.store._source(self.catalog_bytes, "event-catalog.json", "application/json", "reference", "umich-rfp-1442341", self.catalog["source"])
            b = self.store._source(self.contract_bytes, "audit-domain-contract.json", "application/json", "reference", "umich-public-process")
            return {"source_ids": [a["id"], b["id"]]}
        self.store.execute("reference-" + fingerprint(request)[:32], "reference_installed", request, "system", initialize)

    def close(self):
        self.store.close()

    def _snapshot(self, actor, history=False):
        snapshot = self.store.snapshot(include_history=history and actor.get("role") == "auditor")
        if actor.get("role") == "auditor":
            return snapshot
        projected = reporting.project_for_access(snapshot, audience=self.audience(actor, None))
        # The live viewer receives only its scoped records, not the global omission/source index.
        projected.pop("projection", None)
        return projected

    @staticmethod
    def audience(actor, requested):
        if actor.get("role") == "auditor" and requested:
            if not isinstance(requested, dict):
                raise ValueError("Select a reporting audience.")
            allowed = {"role", "unit_ids", "selected_record_ids", "recipient_unit_ids"}
            if set(requested) - allowed:
                raise ValueError("The reporting audience contains unsupported fields.")
            return {**requested, "unit_ids": requested.get("unit_ids", [])}
        return {k: copy.deepcopy(actor.get(k, [] if k != "role" else None))
                for k in ("role", "unit_ids", "selected_record_ids", "recipient_unit_ids")}

    def state(self, actor):
        snapshot = self._snapshot(actor)
        records = snapshot["records"]
        counts = {}
        for r in records:
            counts[r["kind"]] = counts.get(r["kind"], 0) + 1
        can_edit = actor.get("role") == "auditor"
        queue = follow_up_queue(records)
        by_id = {(r["kind"], r["id"]): r for r in records}
        return {"workspace_id": snapshot["workspace_id"], "actor": actor,
                "schemas": SCHEMAS, "stages": STAGES, "counts": counts,
                "source_count": len(snapshot["sources"]), "can_edit": can_edit,
                "restored_from": self.store.setting("restored_from") if can_edit else None,
                "overview": {"engagements": counts.get("engagement", 0), "observations": counts.get("observation", 0),
                    "open_actions": sum(not q["auditor_verified"] for q in queue),
                    "committee_review_due": sum(q["committee_review_due"] for q in queue),
                    "follow_up_due": sum(q["follow_up_due"] for q in queue),
                    "unresolved_priorities": sum(q["priority_unresolved"] for q in queue),
                    "current_workpapers_reviewed": sum(bool(current_review(r, records)) for r in records if r["kind"] == "workpaper")},
                "readiness": readiness(records)[:200] if can_edit else [],
                "reference_sources": self.contract.get("sources", [])}

    def records(self, actor, kind=None, query="", offset=0, limit=100):
        snapshot = self._snapshot(actor)
        all_records = snapshot["records"]
        value = [r for r in all_records if kind is None or r["kind"] == kind]
        query = str(query).casefold()
        if query:
            value = [r for r in value if query in encoded(r["payload"]).casefold() or query in r["source"]["id"].casefold()]
        value.sort(key=lambda r: (_record_label(r).casefold(), r["id"]))
        offset, limit = max(0, int(offset)), max(1, min(int(limit), 500))
        selected = value[offset:offset+limit]
        output = []
        for record in selected:
            review = current_review(record, all_records) if actor.get("role") == "auditor" else None
            extra = {"label": _record_label(record), "current_review": review["payload"] if review else None}
            if record["kind"] == "risk":
                extra["score"] = risk_score(record["payload"])
            output.append({"record": record, **extra})
        return {"items": output, "total": len(value), "offset": offset, "limit": limit}

    def record(self, actor, kind, record_id, revision=None):
        if actor.get("role") == "auditor":
            return self.store.get(kind, record_id, revision)
        if revision is not None:
            raise Forbidden("Revision history belongs to the audit team.")
        for record in self._snapshot(actor)["records"]:
            if record["kind"] == kind and record["id"] == record_id:
                return record
        raise KeyError("This record is not in the selected access scope.")

    def history(self, actor, kind, record_id):
        require_auditor(actor)
        return {"records": self.store.history(kind, record_id)}

    def sources(self, actor):
        require_auditor(actor)
        return [s for s in self.store.sources() if s["role"] not in INTERNAL_SOURCE_ROLES]

    def source_bytes(self, actor, source_id):
        require_auditor(actor)
        source = self.store.source(source_id)
        return self.store.bytes(source["sha256"]), source

    def catalog_view(self, actor):
        require_auditor(actor)
        responses = {r["payload"].get("question_id"): r for r in self.store.records("questionnaire_response")
                     if r["payload"].get("catalog_sha256", r["payload"].get("catalog_sha")) == self.catalog_sha}
        return {**self.catalog, "catalog_sha256": self.catalog_sha, "responses": responses,
                "answered": sum(bool(r["payload"].get("response", "").strip()) for r in responses.values())}

    def follow_up(self, actor, as_of=None):
        return follow_up_queue(self._snapshot(actor)["records"], as_of)

    def artifacts(self, actor):
        values = self.store.records("artifact")
        return [r for r in reversed(values) if actor.get("role") == "auditor" or r["payload"].get("created_by") == actor["id"]]

    def artifact_bytes(self, actor, artifact_id):
        value = self.store.get("artifact", artifact_id)
        p = value["payload"]
        if actor.get("role") != "auditor" and p.get("created_by") != actor["id"]:
            raise Forbidden("This saved output belongs to another reporting scope.")
        if p.get("download_file"):
            path = self.output_directory / safe_name(p["download_file"])
            data = path.read_bytes()
            if digest(data) != p["sha256"] or len(data) != p["bytes"]:
                raise ValueError("The original saved download changed.")
        else:
            source = self.store.source(p["source_id"])
            data = self.store.bytes(source["sha256"])
        return data, {"name": p["name"], "media_type": p["media_type"], "sha256": p["sha256"], "bytes": p["bytes"]}

    def _artifact(self, data, name, media_type, role, actor, operation_id, detail=None):
        source = self.store._source(data, name, media_type, role, self.store.setting("workspace_id"))
        payload = {"source_id": source["id"], "name": name, "media_type": media_type, "sha256": source["sha256"],
                   "bytes": len(data), "created_by": actor["id"], "detail": detail or {}}
        record = _new("artifact", payload, self.store.setting("workspace_id"), operation_id)
        self.store._insert_record(record, 0, actor["id"])
        return record

    def _plan_record(self, kind, plan, actor, operation_id, role):
        source = self.store._source(encoded(plan).encode(), kind + "-" + operation_id + ".json", "application/json", role)
        record = _new(kind, {"source_id": source["id"], "sha256": source["sha256"], "created_by": actor["id"]},
                      self.store.setting("workspace_id"), operation_id)
        self.store._insert_record(record, 0, actor["id"])
        return record

    def _load_plan(self, kind, plan_id):
        record = self.store.get(kind, plan_id)
        source = self.store.source(record["payload"]["source_id"])
        return record, exchange._load_json(self.store.bytes(source["sha256"]), kind)

    def save_record(self, actor, p, operation_id):
        require_auditor(actor)
        kind = p["kind"]
        if kind not in DOMAIN_KINDS or kind in {"review_decision", "receiving_projection"}:
            raise ValueError("Use the corresponding review or reporting action for this record.")
        expected = p.get("expected_revision", 0)
        if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
            raise ValueError("Keep the original expected revision.")
        old = self.store.get(kind, p["id"]) if p.get("id") else None
        if old and old["revision"] != expected:
            raise Conflict("The record has changed. Reopen its current revision.")
        records = self.store.snapshot()["records"]
        value = copy.deepcopy(p["payload"])
        if kind == "observation" and value.get("priority_normalized") == "":
            value["priority_normalized"] = None
        value = validate_payload(kind, value, records)
        if kind == "evidence":
            source = self.store.source_for_evidence(value["source_id"], value["sha256"])
            if value["sha256"] != source["sha256"] or value["size"] != source["bytes"]:
                raise ValueError("Evidence metadata must retain the selected original file.")
        if kind == "questionnaire_response":
            if value.get("catalog_sha256") != self.catalog_sha or value["question_id"] not in {q["id"] for q in self.catalog["questions"]}:
                raise ValueError("Keep the original issuer question and catalog hash.")
        if old:
            record = {**copy.deepcopy(old), "payload": value, "revision": expected + 1, "updated_at": now()}
            record.pop("projection", None)
        else:
            if expected != 0:
                raise Conflict("A new record begins at expected revision zero.")
            source_id = (value["question_id"] if kind == "questionnaire_response" else str(p.get("source_id") or operation_id))
            namespace = ("issuer-questionnaire:" + self.catalog_sha if kind == "questionnaire_response" else str(p.get("source_namespace") or self.store.setting("workspace_id")))
            record = _new(kind, value, namespace, source_id, p.get("source_revision"), p.get("source_locator"))
            if any(r["id"] == record["id"] for r in records):
                raise Conflict("This original record already exists. Open and edit its current revision.")
        prospective = [r for r in records if r["id"] != record["id"]] + [record]
        failures = exchange.validate_records(prospective)
        if failures:
            raise exchange.ExchangeError("record_graph_invalid", "Resolve the indicated record fields before saving.", failures)
        return {"record": self.store._insert_record(record, expected, actor["id"])}

    def review(self, actor, p, operation_id):
        require_auditor(actor)
        record = self.store.get(p["kind"], p["id"])
        if record["revision"] != p.get("expected_revision") or fingerprint(record) != p.get("input_hash"):
            raise Conflict("Review the original current record revision.")
        if p.get("decision") not in {"approved", "rework", "withdrawn"} or not str(p.get("reason", "")).strip():
            raise ValueError("Record an explicit decision and its reason.")
        value = {"record_type": record["kind"], "record_id": record["id"], "record_revision": record["revision"],
                 "source_revision": record["source"]["revision"], "decision": p["decision"],
                 "reason": p["reason"], "reviewer_reference": actor["label"], "reviewer_id": actor["id"],
                 "reviewed_at": now(), "input_hash": fingerprint(record)}
        reviewed = _new("review_decision", value, self.store.setting("workspace_id"), operation_id)
        return {"review": self.store._insert_record(reviewed, 0, actor["id"])}

    def verify_action(self, actor, p, operation_id):
        require_auditor(actor)
        action = self.store.get("management_action", p["id"])
        if action["revision"] != p.get("expected_revision"):
            raise Conflict("Reopen the current action before recording verification.")
        evidence_ids = p.get("evidence_ids", [])
        if not isinstance(evidence_ids, list) or not evidence_ids or not str(p.get("assessment", "")).strip():
            raise ValueError("Link implementation evidence and record the auditor's assessment.")
        all_records = self.store.snapshot()["records"]
        by_id = {(r["kind"], r["id"]): r for r in all_records}
        parent = engagement_id(action, by_id)
        for evidence_id in evidence_ids:
            evidence = self.store.get("evidence", evidence_id)
            if evidence["payload"].get("engagement_id") != parent:
                raise ValueError("Verification evidence belongs to another engagement.")
            source = self.store.source_for_evidence(evidence["payload"]["source_id"], evidence["payload"]["sha256"])
            self.store.bytes(source["sha256"])
        completed = p.get("completed") is True
        review = _new("follow_up_review", {"action_id": action["id"], "review_date": p["review_date"],
            "source_status": action["payload"].get("source_status"), "implementation_evidence": p["assessment"],
            "evidence_ids": evidence_ids, "auditor_verification": p["assessment"], "verification_completed": completed,
            "reviewer_reference": actor["label"], "next_review_date": p.get("next_review_date"),
            "memo_reference": p.get("memo_reference")}, self.store.setting("workspace_id"), operation_id)
        review["payload"] = validate_payload("follow_up_review", review["payload"], all_records)
        self.store._insert_record(review, 0, actor["id"])
        payload = {**action["payload"], "verified_at": now() if completed else None,
                   "verification_reference": review["id"] if completed else None,
                   "completion_evidence_ids": evidence_ids}
        next_action = {**action, "revision": action["revision"] + 1, "updated_at": now(), "payload": payload}
        self.store._insert_record(next_action, action["revision"], actor["id"])
        return {"review": review, "action": next_action}

    def upload_source(self, actor, p, operation_id):
        require_auditor(actor)
        data = _decode(p["data_base64"])
        if p.get("sha256") and p["sha256"] != digest(data):
            raise ValueError("The upload does not match its original SHA-256.")
        role = p.get("role", "original")
        if role not in {"original", "evidence", "reference", "target_contract"}:
            raise ValueError("Choose an original-source role.")
        source = self.store._source(data, p["name"], p.get("media_type", "application/octet-stream"),
                                    role, p.get("namespace", ""), p.get("locator"))
        return {"source": source}

    def inspect_source(self, actor, source_id, kind=None, delimiter=",", encoding="utf-8-sig"):
        require_auditor(actor)
        source = self.store.source(source_id)
        data = self.store.bytes(source["sha256"])
        name = source["name"].lower()
        if name.endswith(".csv") or source["media_type"] == "text/csv":
            if delimiter not in {",", ";", "\t", "|"} or encoding not in {"utf-8", "utf-8-sig", "utf-16", "utf-16-le"}:
                raise ValueError("Choose the source's actual delimiter and Unicode encoding.")
            rows = list(csv.reader(io.StringIO(data.decode(encoding), newline=""), delimiter=delimiter))
            headers, body = (rows[0], rows[1:]) if rows else ([], [])
            return {"source": source, "format": "csv", "headers": [{"ordinal": i, "name": n} for i, n in enumerate(headers)],
                    "rows": len(body), "columns": len(headers), "preview": body[:20], "kind": kind,
                    "delimiter": delimiter, "encoding": encoding}
        if name.endswith((".json", ".jsonl")) or source["media_type"] in {"application/json", "application/x-ndjson"}:
            if name.endswith(".jsonl"):
                rows = [exchange._load_json(line, "JSONL row") for line in data.splitlines() if line.strip()]
                value = {kind: rows}
            else:
                value = exchange._load_json(data, "original structured source")
                value = value.get("rows_by_kind", value) if isinstance(value, dict) else {kind: value}
            if not isinstance(value, dict) or any(not isinstance(v, list) for v in value.values()):
                return {"source": source, "format": "json_document", "keys": list(value) if isinstance(value, dict) else [],
                        "message": "This is a retained reference document. Audit row imports use an array or rows_by_kind."}
            return {"source": source, "format": "json", "counts": {k: len(v) for k, v in value.items()},
                    "preview": {k: v[:5] for k, v in value.items()}}
        return {"source": source, "format": "document", "message": "Original bytes retained. Link this file as evidence or a reference."}

    def _source_rows(self, p):
        source = self.store.source(p["source_id"])
        data = self.store.bytes(source["sha256"])
        kind = p.get("kind")
        name = source["name"].lower()
        if name.endswith(".csv") or source["media_type"] == "text/csv":
            delimiter, encoding = p.get("delimiter", ","), p.get("encoding", "utf-8-sig")
            if delimiter not in {",", ";", "\t", "|"} or encoding not in {"utf-8", "utf-8-sig", "utf-16", "utf-16-le"}:
                raise ValueError("Choose the actual source delimiter and encoding.")
            rows = list(csv.reader(io.StringIO(data.decode(encoding), newline=""), delimiter=delimiter))
            return source, {kind: rows[1:] if rows else []}
        if name.endswith(".jsonl"):
            return source, {kind: [exchange._load_json(line, "JSONL row") for line in data.splitlines() if line.strip()]}
        value = exchange._load_json(data, "original structured source")
        if isinstance(value, list):
            return source, {kind: value}
        if isinstance(value, dict):
            return source, value.get("rows_by_kind", value)
        raise ValueError("Import complete audit rows or a rows_by_kind object.")

    def prepare_import(self, actor, p, operation_id):
        require_auditor(actor)
        source, rows = self._source_rows(p)
        mappings = p.get("mappings", [])
        if p.get("mapping_id"):
            mappings = self.store.get("source_mapping", p["mapping_id"])
        normalized = exchange.normalize_records(rows, mappings, p["source_namespace"])
        current = {r["id"]: r for r in self.store.snapshot()["records"]}
        prepared_at = now()
        choices, combined = [], dict(current)
        for record in normalized["records"]:
            record["created_at"] = record.get("created_at") or prepared_at
            record["updated_at"] = record.get("updated_at") or prepared_at
            previous = current.get(record["id"])
            status = "new" if previous is None else "same" if _same_import(previous, record) else "changed"
            choices.append({"id": record["id"], "kind": record["kind"], "label": _record_label(record),
                            "status": status, "expected_revision": previous["revision"] if previous else 0,
                            "expected_sha256": fingerprint(previous) if previous else None})
            combined[record["id"]] = record
        diagnostics = [d for d in normalized["diagnostics"] if d["code"] not in GRAPH_DIAGNOSTICS]
        diagnostics.extend(exchange.validate_records(list(combined.values())))
        plan = {"format": "commons-audit-import-plan/1", "prepared_at": prepared_at, "source_id": source["id"],
                "source_sha256": source["sha256"], "source_namespace": p["source_namespace"], "mappings": mappings,
                "records": normalized["records"], "choices": choices, "diagnostics": diagnostics,
                "valid": not any(d.get("severity") == "error" for d in diagnostics),
                "counts": normalized["counts"]}
        saved = self._plan_record("import_preview", plan, actor, operation_id, "import_plan")
        return {"preview": saved, "valid": plan["valid"], "counts": plan["counts"], "choices": choices,
                "diagnostics": diagnostics[:200], "diagnostic_count": len(diagnostics),
                "complete_plan_source_id": saved["payload"]["source_id"]}

    def adopt_import(self, actor, p, operation_id):
        require_auditor(actor)
        saved, plan = self._load_plan("import_preview", p["preview_id"])
        if not plan["valid"]:
            raise ValueError("Correct the complete source or mapping before adopting this import.")
        incoming = {r["id"]: r for r in plan["records"]}
        decisions = p.get("decisions", {})
        current = {r["id"]: r for r in self.store.snapshot()["records"]}
        writes, retained, unchanged = [], [], []
        for choice in plan["choices"]:
            rid, expected = choice["id"], choice["expected_revision"]
            previous = current.get(rid)
            if (previous["revision"] if previous else 0) != expected or (fingerprint(previous) if previous else None) != choice["expected_sha256"]:
                raise Conflict("A record changed after this import review: " + rid)
            if choice["status"] == "same":
                unchanged.append(rid)
                continue
            if choice["status"] == "changed":
                decision = decisions.get(rid, {})
                if (decision.get("expected_revision") != expected or decision.get("expected_sha256") != choice["expected_sha256"]
                    or decision.get("choice") not in {"keep_local", "accept_incoming"}):
                    raise ValueError("Explicitly choose each changed record's current revision.")
                if decision["choice"] == "keep_local":
                    retained.append(rid)
                    continue
            record = copy.deepcopy(incoming[rid])
            record["revision"] = expected + 1
            record["created_at"] = previous["created_at"] if previous else record["created_at"]
            record["updated_at"] = now()
            writes.append((record, expected))
            current[rid] = record
        failures = exchange.validate_records(list(current.values()))
        if failures:
            raise exchange.ExchangeError("import_graph_conflict", "These combined correction choices conflict.", failures)
        for record, expected in writes:
            self.store._insert_record(record, expected, actor["id"])
        result = {"status": "accepted", "preview_id": saved["id"], "source_id": plan["source_id"],
                  "source_sha256": plan["source_sha256"], "imported": [r["id"] for r, _ in writes],
                  "retained_local": retained, "unchanged": unchanged, "accepted_at": now(), "accepted_by": actor["label"]}
        receipt = self._plan_record("import_receipt", result, actor, operation_id, "receipt")
        return {**result, "receipt_id": receipt["id"]}


    @staticmethod
    def _domain_hash(snapshot):
        return fingerprint({"workspace_id": snapshot["workspace_id"],
            "records": sorted(snapshot["records"], key=lambda r: (r["kind"], r["id"])),
            "sources": sorted(snapshot["sources"], key=lambda s: s["id"])})

    def _owned_plan(self, kind, plan_id, actor):
        record, plan = self._load_plan(kind, plan_id)
        if actor.get("role") != "auditor" and record["payload"].get("created_by") != actor["id"]:
            raise Forbidden("This reviewed output belongs to another access scope.")
        return record, plan

    def prepare_report(self, actor, p, operation_id):
        snapshot = self.store.snapshot(include_history=True)
        audience = self.audience(actor, p.get("audience"))
        selected = p.get("selected_engagement_ids")
        if not isinstance(selected, list) or not selected:
            raise ValueError("Select the engagements this report covers.")
        if actor.get("role") != "auditor":
            allowed = {r["id"] for r in self._snapshot(actor)["records"] if r["kind"] == "engagement"}
            if not set(selected).issubset(allowed):
                raise Forbidden("Choose engagements within this access link.")
        note = str(p.get("review_note", "")).strip()
        if not note:
            raise ValueError("Record what this reporting release is intended to cover.")
        reference = {"id": operation_id, "reviewer_id": actor["id"], "reviewer_reference": actor["label"],
                     "reviewed_at": now(), "note": note}
        projected = reporting.project_snapshot(snapshot, audience=audience,
            selected_engagement_ids=selected, review_reference=reference)
        rendered = reporting.render_reports(projected)
        outputs = []
        for path, data in rendered.items():
            artifact = self._artifact(data, path.rsplit("/", 1)[-1],
                "text/html; charset=utf-8" if path.endswith(".html") else "text/csv; charset=utf-8",
                "report", actor, operation_id + "-" + fingerprint(path)[:12],
                {"audience": audience, "preview_operation_id": operation_id})
            outputs.append({"name": path, "artifact": artifact})
        plan = {"format": "commons-audit-report-preview/1", "snapshot": snapshot, "projected": projected,
                "domain_hash": self._domain_hash(snapshot), "audience": audience,
                "selected_engagement_ids": selected, "review_reference": reference, "reports": outputs}
        saved = self._plan_record("report_preview", plan, actor, operation_id, "report_projection")
        counts = {}
        for r in projected["records"]:
            counts[r["kind"]] = counts.get(r["kind"], 0) + 1
        return {"preview_id": saved["id"], "audience": audience, "counts": counts,
                "reports": outputs, "review_reference": reference,
                "source_selection_hash": projected["projection"]["source_selection_hash"]}

    def build_handoff(self, actor, p, operation_id):
        saved, plan = self._owned_plan("report_preview", p["preview_id"], actor)
        if self._domain_hash(self.store.snapshot()) != plan["domain_hash"]:
            raise Conflict("Records or original sources changed after this report preview. Prepare the current release.")
        if self.audience(actor, plan["audience"]) != plan["audience"]:
            raise Forbidden("The current access scope differs from this report preview.")
        value, manifest = exchange.build_handoff(plan["snapshot"], self.store.bytes,
            audience=plan["audience"], selected_engagement_ids=plan["selected_engagement_ids"],
            review_reference=plan["review_reference"])
        artifact = self._artifact(value, "Audit-handoff-" + operation_id + ".zip", "application/zip",
                                  "handoff", actor, operation_id, {"manifest": manifest, "preview_id": saved["id"]})
        return {"artifact": artifact, "manifest": manifest, "preview_id": saved["id"]}

    def prepare_native(self, actor, p, operation_id):
        require_auditor(actor)
        _, report = self._owned_plan("report_preview", p["preview_id"], actor)
        source = self.store.source(p["target_contract_source_id"])
        contract = exchange._load_json(self.store.bytes(source["sha256"]), "selected native target contract")
        native = exchange.export_native(report["projected"], contract)
        files = dict(native["files"])
        files["NATIVE-MANIFEST.json"] = encoded(native["manifest"]).encode()
        files["TARGET-CONTRACT.json"] = encoded(contract).encode()
        plan = {"format": "commons-audit-native-plan/1", "preview_id": p["preview_id"],
                "projected": report["projected"], "contract": contract, "manifest": native["manifest"],
                "target_contract_source_id": source["id"], "target_contract_source_sha256": source["sha256"]}
        saved = self._plan_record("native_preview", plan, actor, operation_id, "native_export")
        artifact = self._artifact(_zip(files), "Audit-native-" + operation_id + ".zip", "application/zip",
                                  "native_export", actor, operation_id,
                                  {"native_id": saved["id"], "manifest": native["manifest"]})
        return {"native_id": saved["id"], "artifact": artifact, "manifest": native["manifest"]}

    def _native_return_files(self, source, contract):
        data = self.store.bytes(source["sha256"])
        if not zipfile.is_zipfile(io.BytesIO(data)):
            if len(contract["tables"]) != 1:
                raise ValueError("Return every declared table in a ZIP, or a single CSV for a one-table contract.")
            return {contract["tables"][0]["file"]: data}
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(e.file_size for e in entries) > MAX_SOURCE * 2:
                raise ValueError("The complete returned archive exceeds 128 MiB or 1,000 members.")
            names, files = set(), {}
            for item in entries:
                name = exchange._portable_path(item.filename)
                if (name.casefold() in names or item.is_dir() or item.flag_bits & 1
                    or stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK):
                    raise ValueError("The returned archive contains a duplicate or unsafe file.")
                names.add(name.casefold())
                files[name] = archive.read(item)
            return files

    def compare_native(self, actor, p, operation_id):
        require_auditor(actor)
        _, plan = self._owned_plan("native_preview", p["native_id"], actor)
        source = self.store.source(p["return_source_id"])
        files = self._native_return_files(source, plan["contract"])
        namespaces = {r["source"]["namespace"] for r in plan["projected"]["records"]}
        namespace = p.get("source_namespace") or (next(iter(namespaces)) if len(namespaces) == 1 else None)
        if not namespace:
            raise ValueError("Choose the declared returned source namespace, retaining per-row namespaces where supplied.")
        normalized = exchange.normalize_native_files(files, plan["contract"], namespace)
        comparison = exchange.reconcile_native(plan["projected"], normalized, plan["contract"])
        comparison.update({"native_id": p["native_id"], "return_source_id": source["id"],
                           "return_source_sha256": source["sha256"], "compared_at": now(), "compared_by": actor["label"]})
        saved = self._plan_record("native_comparison", comparison, actor, operation_id, "comparison")
        artifact = self._artifact(encoded(comparison).encode(), "Native-comparison-" + operation_id + ".json",
                                  "application/json", "comparison", actor, operation_id, {"status": comparison["status"]})
        return {"comparison_id": saved["id"], "comparison": comparison, "artifact": artifact}

    def _receipts(self):
        return [self._load_plan("receiving_receipt", r["id"])[1] for r in self.store.records("receiving_receipt")]

    def prepare_receipt(self, actor, p, operation_id):
        require_auditor(actor)
        source = self.store.source(p["source_id"])
        original = self.store.bytes(source["sha256"])
        received = exchange.read_handoff(original)
        # Change source role for this exact retained copy, preserving the original upload record.
        # The internal copy prevents future handoffs from recursively embedding received archives.
        bundle = self.store._source(original, source["name"], "application/zip", "received_bundle",
                                    received["snapshot"]["workspace_id"], source.get("locator"))
        current = self.store.snapshot(include_history=True)
        # The uploaded original archive itself is not a business source inside a receiving graph.
        current["sources"] = [s for s in current["sources"] if s["sha256"] != source["sha256"]]
        plan = exchange.plan_receipt(current, received, prior_receipts=self._receipts())
        value = {"format": "commons-audit-receipt-preview/1", "source_id": bundle["id"],
                 "uploaded_source_id": source["id"], "bundle_sha256": source["sha256"], "plan": plan}
        saved = self._plan_record("receiving_preview", value, actor, operation_id, "receipt_plan")
        return {"preview_id": saved["id"], "plan": plan}

    def adopt_receipt(self, actor, p, operation_id):
        require_auditor(actor)
        saved, preview = self._owned_plan("receiving_preview", p["preview_id"], actor)
        original = self.store.bytes(preview["bundle_sha256"])
        received = exchange.read_handoff(original)
        prior = self._receipts()
        replay = next((r for r in prior if r.get("bundle_sha256") == preview["bundle_sha256"]
                       and r.get("status") == "accepted"), None)
        if replay:
            return {**replay, "replayed_bundle": True}
        current = self.store.snapshot(include_history=True)
        current["sources"] = [s for s in current["sources"] if s["sha256"] != preview["bundle_sha256"]]
        plan = preview["plan"]
        if plan["status"] == "conflicted":
            plan = exchange.resolve_receipt(current, received, plan, p.get("resolutions", []),
                reviewer_reference=actor["label"] + " [" + actor["id"] + "]", reviewed_at=now(), prior_receipts=prior)
        prepared = exchange.prepare_adoption(current, received, plan)
        self.store._adopt_sources(prepared["snapshot"]["sources"], prepared["blobs"])
        self.store._adopt_snapshot(prepared["snapshot"], actor["id"])
        for record in prepared.get("projection_variants", []):
            self.store.db.execute("INSERT OR IGNORE INTO projection_variants VALUES(?,?,?,?,?)",
                (record["kind"], record["id"], record["revision"], fingerprint(record), encoded(record)))
        result = {**prepared["receipt"], "status": "accepted",
                  "imported": prepared["receipt"].get("prepared_record_ids", []),
                  "accepted_at": now(), "accepted_by": actor["label"], "preview_id": saved["id"]}
        receipt = self._plan_record("receiving_receipt", result, actor, operation_id, "receipt")
        result["saved_receipt_id"] = receipt["id"]
        return result

    def export_questionnaire(self, actor, p, operation_id):
        require_auditor(actor)
        catalog = self.catalog_view(actor)
        responses = catalog["responses"]
        rows = []
        for question in self.catalog["questions"]:
            record = responses.get(question["id"])
            response = (record or {}).get("payload", {})
            rows.append({"question_id": question["id"], "group_id": question["group_id"],
                         "source_pages": question.get("source_pages", []), "question": question["text"],
                         "response": response.get("response", ""), "status": response.get("status", "Not started"),
                         "evidence_references": response.get("evidence_references", []),
                         "responder_reference": response.get("responder_reference", ""),
                         "record_id": record["id"] if record else None, "revision": record["revision"] if record else None})
        value = {"format": "commons-audit-issuer-responses/1", "catalog_sha256": self.catalog_sha,
                 "issuer_source": self.catalog["source"], "exported_at": now(), "exported_by": actor["label"],
                 "question_count": len(rows), "answered": catalog["answered"], "responses": rows}
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        fields = ["question_id", "group_id", "source_pages", "question", "response", "status",
                  "evidence_references", "responder_reference", "record_id", "revision"]
        writer.writerow(fields)
        for row in rows:
            writer.writerow([encoded(row[k]) if isinstance(row[k], (list, dict)) else row[k] for k in fields])
        body = "".join("<section><h2>" + html.escape(r["question_id"]) + "</h2><p>" + html.escape(r["question"]) +
                       "</p><p class='response'>" + html.escape(r["response"] or "No response recorded") +
                       "</p><p class='meta'>" + html.escape(r["status"]) + " · source pages " +
                       html.escape(", ".join(map(str, r["source_pages"]))) + "</p></section>" for r in rows)
        page = "<!doctype html><html lang='en'><meta charset='utf-8'><title>Original issuer questionnaire</title>" \
               "<style>body{font:16px/1.6 system-ui;max-width:64rem;margin:3rem auto;padding:0 1.5rem;color:#202020}" \
               "section{border-top:1px solid #bbb;padding:1rem 0;break-inside:avoid}.response{white-space:pre-wrap}.meta{font-size:.85rem}</style>" \
               "<h1>Internal Audit Software — recorded responses</h1><p>" + str(catalog["answered"]) + " of " + str(len(rows)) + \
               " questions have a recorded response. Original question IDs, wording and page locations are retained.</p>" + body + "</html>"
        files = {"responses.json": encoded(value).encode(), "responses.csv": stream.getvalue().encode("utf-8-sig"),
                 "responses.html": page.encode(), "original-event-catalog.json": self.catalog_bytes}
        artifact = self._artifact(_zip(files), "Issuer-responses-" + operation_id + ".zip",
                                  "application/zip", "report", actor, operation_id,
                                  {"answered": catalog["answered"], "questions": len(rows), "catalog_sha256": self.catalog_sha})
        return {"artifact": artifact, "answered": catalog["answered"], "questions": len(rows)}

    def backup(self, actor, p, operation_id):
        require_auditor(actor)
        passphrase = p.get("passphrase")
        request = {"passphrase_digest": fingerprint(passphrase), "label": str(p.get("label", ""))}
        with self.store.lock:
            previous = self.store.operation(operation_id, "backup", request, actor["id"])
            if previous:
                return previous
            filename = "Audit-backup-" + identifier(operation_id) + ".cab"
            path = self.output_directory / filename
            intent = self.output_directory / (filename + ".intent.json")
            expected = {"operation_id": operation_id, "actor": actor["id"], "request_sha256": fingerprint(request)}
            if intent.exists():
                original = json.loads(intent.read_text())
                if any(original.get(k) != v for k, v in expected.items()):
                    raise Conflict("This backup operation already belongs to another request.")
            else:
                atomic_write(intent, encoded(expected).encode())
            if path.exists():
                data = path.read_bytes()
                manifest, _ = inspect_backup(data, passphrase)
                if manifest["workspace_id"] != self.store.setting("workspace_id"):
                    raise Conflict("The retained backup belongs to another workspace.")
            else:
                data, manifest = create_backup(self.store, passphrase)
                atomic_write(path, data)
            payload = {"download_file": filename, "name": filename, "media_type": "application/octet-stream",
                       "sha256": digest(data), "bytes": len(data), "created_by": actor["id"],
                       "detail": {"label": p.get("label", ""), "manifest": manifest, "encrypted": True}}
            def commit():
                artifact = _new("artifact", payload, self.store.setting("workspace_id"), operation_id)
                self.store._insert_record(artifact, 0, actor["id"])
                return {"artifact": artifact, "manifest": manifest}
            return self.store.execute(operation_id, "backup", request, actor["id"], commit)

    def restore(self, actor, p, operation_id):
        if not actor.get("admin"):
            raise Forbidden("Only the workspace owner can open a restored workspace.")
        if p.get("artifact_id"):
            data, _ = self.artifact_bytes(actor, p["artifact_id"])
        elif p.get("source_id"):
            source = self.store.source(p["source_id"])
            data = self.store.bytes(source["sha256"])
        else:
            data = _decode(p["data_base64"])
        request = {"backup_sha256": digest(data), "passphrase_digest": fingerprint(p.get("passphrase")),
                   "destination_name": identifier(p.get("destination_name") or "restored-" + operation_id)}
        with self.store.lock:
            previous = self.store.operation(operation_id, "restore", request, actor["id"])
            if previous:
                return previous
            destination = self.store.root.parent / request["destination_name"]
            if destination == self.store.root:
                raise ValueError("Choose a new receiving workspace name.")
            intent = self.output_directory / ("restore-" + identifier(operation_id) + ".json")
            expected = {"request_sha256": fingerprint(request), "actor": actor["id"], "destination": str(destination)}
            if intent.exists():
                original = json.loads(intent.read_text())
                if any(original.get(k) != v for k, v in expected.items()):
                    raise Conflict("This restore operation has different original inputs.")
            else:
                if destination.exists():
                    raise ValueError("Choose a new receiving workspace directory.")
                atomic_write(intent, encoded(expected).encode())
            # Authentication is rechecked on every retry, including a retained destination.
            manifest, contents = inspect_backup(data, p.get("passphrase"))
            if destination.exists():
                recovered = Store(destination)
                try:
                    if (recovered.setting("restored_from") != request["backup_sha256"] or
                        recovered.setting("workspace_id") != manifest["workspace_id"]):
                        raise Conflict("The existing destination is not this original restore.")
                    result = {"workspace_id": manifest["workspace_id"], "directory": str(destination),
                              "files": len(contents), "records": len(recovered.records()), "source_count": manifest["source_count"],
                              "backup_sha256": request["backup_sha256"], "access_renewed": True,
                              "restored_at": recovered.setting("restored_at")}
                finally:
                    recovered.close()
            else:
                result = restore_backup(data, p.get("passphrase"), destination)
            return self.store.execute(operation_id, "restore", request, actor["id"], lambda: result)

    def dispatch(self, actor, action, p, operation_id):
        if not isinstance(actor, dict) or not actor.get("active"):
            raise Forbidden("Open an active workspace access link.")
        if not isinstance(p, dict):
            raise ValueError("Action inputs must be a JSON object.")
        identifier(operation_id)
        if action == "create_grant":
            return self.store.create_grant(p, actor, operation_id)
        if action == "revoke_grant":
            # Revocation is naturally idempotent and returns the retained current grant.
            result = self.store.revoke_grant(p["grant_id"], actor)
            return {"grant": result, "operation_id": operation_id}
        if action in {"backup", "restore"}:
            # SQLite backup and filesystem restore run outside a database write transaction.
            return getattr(self, action)(actor, p, operation_id)
        handlers = {name: getattr(self, name) for name in (
            "save_record", "review", "verify_action", "upload_source", "prepare_import", "adopt_import",
            "prepare_report", "build_handoff", "prepare_native", "compare_native",
            "prepare_receipt", "adopt_receipt", "export_questionnaire")}
        if action not in handlers:
            raise ValueError("Unknown workspace action.")
        return self.store.execute(operation_id, action, p, actor["id"],
                                  lambda: handlers[action](actor, p, operation_id))
