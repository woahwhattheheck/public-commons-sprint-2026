"""Portable audit interchange, explicit mappings, and immutable receiving plans.

All functions are side-effect-free. The host persists original input blobs,
reviewed corrections, and the returned receiving plan transactionally.
"""
from __future__ import annotations
import argparse
import base64
import copy
import csv
import datetime as dt
import hashlib
import io
import json
import math
import pathlib
import re
import stat
import sys
import zipfile
from collections import Counter
from decimal import Decimal, InvalidOperation
from .reporting import project_snapshot, render_reports, record_hash, resolve_engagement

MAX_ZIP_BYTES = 64 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 2000
MAX_RECORDS = 200000
KINDS = {
    "engagement", "audit_area", "sub_activity", "observation", "management_action",
    "evidence", "review_decision", "receiving_projection", "follow_up_review",
    "source_mapping", "risk", "workpaper", "advisory_memo", "questionnaire_response",
}
RELATIONSHIPS = {
    "audit_area": {"engagement_id":"engagement", "parent_area_id":"audit_area"},
    "sub_activity": {"area_id":"audit_area"},
    "observation": {"engagement_id":"engagement", "sub_activity_id":"sub_activity"},
    "management_action": {"observation_id":"observation"},
    "evidence": {"engagement_id":"engagement", "observation_id":"observation", "workpaper_id":"workpaper"},
    "follow_up_review": {"action_id":"management_action"},
    "risk": {"engagement_id":"engagement", "area_id":"audit_area"},
    "workpaper": {"engagement_id":"engagement", "area_id":"audit_area", "sub_activity_id":"sub_activity"},
    "advisory_memo": {"engagement_id":"engagement"},
}
REQUIRED_REFS = {
    "audit_area": ("engagement_id",), "sub_activity": ("area_id",),
    "observation": ("engagement_id",), "management_action": ("observation_id",),
    "follow_up_review": ("action_id",), "risk": ("engagement_id",),
    "workpaper": ("engagement_id",), "advisory_memo": ("engagement_id",),
}
DATE_FIELDS = {
    "issue_date","explicit_target_date","reference_target_date","review_date",
    "next_review_date","committee_reference_date",
}
BOOL_FIELDS = {
    "report_inclusion","is_it_audit","is_michigan_medicine",
    "committee_review_flag","verification_completed",
}
LIST_FIELDS = {"unit_ids","recipient_unit_ids","record_ids","evidence_ids","evidence_refs","included_record_ids"}
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_PATH_KEYS = {"custody_path", "local_path", "absolute_path"}

class ExchangeError(ValueError):
    def __init__(self, code, message, diagnostics=None):
        super().__init__(message)
        self.code = code
        self.diagnostics = diagnostics or []
    def as_dict(self):
        return {"code":self.code, "message":str(self), "diagnostics":self.diagnostics}

def canonical_json(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise ExchangeError("invalid_json_value", "Values must be finite, serializable JSON") from exc

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def _load_json(data, label):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ExchangeError("duplicate_json_key", "Duplicate JSON key in " + label + ": " + key)
            result[key] = value
        return result
    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except ExchangeError:
        raise
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ExchangeError("invalid_json", "Invalid JSON in " + label) from exc

def stable_record_id(kind, namespace, source_id):
    if kind not in KINDS:
        raise ExchangeError("unknown_kind", "Unsupported record kind: " + str(kind))
    if any(not isinstance(v, str) or not v or "\0" in v for v in (namespace, source_id)):
        raise ExchangeError("missing_identity", "namespace and source_id must be nonempty strings without NUL")
    return kind + "-" + hashlib.sha256((kind + "\0" + namespace + "\0" + source_id).encode("utf-8")).hexdigest()[:32]

def _diag(code, message, *, kind=None, row=None, field=None, record_id=None, severity="error"):
    return {key:value for key,value in {
        "severity":severity, "code":code, "message":message, "kind":kind,
        "row":row, "field":field, "record_id":record_id}.items() if value is not None}

def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Expected YYYY-MM-DD")
    return dt.date.fromisoformat(value).isoformat()

def _safe_scalar(value):
    return value is None or isinstance(value, (str, int, float, bool))

def _transform(value, mapping):
    null_rule = mapping.get("null_rule", "preserve")
    if null_rule not in {"preserve","null","empty_to_null","blank_to_null","required"}:
        raise ValueError("Unsupported null_rule")
    if null_rule in {"null","empty_to_null"} and value == "":
        value = None
    elif null_rule == "blank_to_null" and isinstance(value, str) and not value.strip():
        value = None
    if null_rule == "required" and (value is None or value == ""):
        raise ValueError("Required value is missing")
    if value is None:
        return None
    transform = mapping.get("transform") or "identity"
    if transform == "identity":
        return copy.deepcopy(value)
    if transform == "string":
        if not _safe_scalar(value):
            raise ValueError("String transform accepts a scalar")
        return str(value)
    if transform == "trim":
        if not isinstance(value, str):
            raise ValueError("Trim transform requires text")
        return value.strip()
    if transform in {"map","value_map"}:
        values = mapping.get("value_map")
        if not isinstance(values, dict):
            raise ValueError("value_map object is required")
        key = str(value)
        if key not in values:
            raise ValueError("No reviewed mapping for value " + repr(value))
        return copy.deepcopy(values[key])
    if transform == "integer":
        if isinstance(value, bool) or not re.fullmatch(r"[+-]?\d+", str(value)):
            raise ValueError("Expected an integer")
        return int(value)
    if transform == "decimal":
        try:
            result = Decimal(str(value))
        except InvalidOperation as exc:
            raise ValueError("Expected an exact decimal") from exc
        if not result.is_finite():
            raise ValueError("Decimal must be finite")
        return format(result, "f")
    if transform == "boolean":
        if type(value) is bool:
            return value
        lowered = str(value).strip().lower()
        if lowered in {"true","1","yes"}:
            return True
        if lowered in {"false","0","no"}:
            return False
        raise ValueError("Expected true/false, yes/no or 1/0")
    if transform == "date":
        return _date(value)
    if transform == "json":
        return _load_json(str(value).encode("utf-8"), "mapped field")
    if transform == "split":
        if not isinstance(value, str):
            raise ValueError("Split transform requires text")
        separator = mapping.get("separator", "|")
        if not isinstance(separator, str) or not separator:
            raise ValueError("A nonempty split separator is required")
        return [part.strip() for part in value.split(separator) if part.strip()]
    raise ValueError("Unsupported transform: " + str(transform))

def _mapping_groups(mappings):
    if mappings is None:
        return {}
    if isinstance(mappings, list):
        groups = {}
        for item in mappings:
            if not isinstance(item, dict):
                raise ExchangeError("invalid_mapping", "Each mapping must be an object")
            # A source_mapping Record is also accepted from an existing workspace.
            item = item.get("payload", item)
            kind = item.get("record_kind") or item.get("kind")
            if kind not in KINDS:
                raise ExchangeError("invalid_mapping_kind", "Mappings require a supported record_kind")
            groups.setdefault(kind, []).append(copy.deepcopy(item))
        return groups
    if isinstance(mappings, dict):
        if any(kind not in KINDS or not isinstance(items, list) for kind, items in mappings.items()):
            raise ExchangeError("invalid_mapping", "Mappings must be {record_kind:[field mappings]}")
        return copy.deepcopy(mappings)
    raise ExchangeError("invalid_mapping", "Mappings must be a list or an object")

def _read_column(row, source):
    if isinstance(row, dict):
        if source not in row:
            raise ValueError("Source field is absent: " + str(source))
        return row[source]
    if isinstance(source, bool) or not isinstance(source, int):
        raise ValueError("Positional rows require an integer source_field_or_ordinal")
    if source < 0 or source >= len(row):
        raise ValueError("Source ordinal is outside this row")
    return row[source]

def _clean_custody(value):
    if isinstance(value, dict):
        return {k:_clean_custody(v) for k,v in value.items() if k not in _PATH_KEYS}
    if isinstance(value, list):
        return [_clean_custody(v) for v in value]
    return copy.deepcopy(value)

def normalize_records(rows_by_kind, mappings=None, source_namespace=None):
    """Normalize a complete import without persistence.

    Mapping transforms are an allowlist, not executable expressions. A raw foreign
    key is resolved in the mapped relationship namespace. Unknown priorities,
    nulls, source statuses and original result symbols are never silently coerced
    into a successful/Low/verified state.
    """
    if not isinstance(rows_by_kind, dict):
        raise ExchangeError("invalid_rows", "rows_by_kind must be an object")
    if not isinstance(source_namespace, str) or not source_namespace or "\0" in source_namespace:
        raise ExchangeError("invalid_namespace", "A stable source_namespace is required")
    groups = _mapping_groups(mappings)
    diagnostics, records, positions = [], [], {}
    if sum(len(rows) if isinstance(rows, list) else MAX_RECORDS+1 for rows in rows_by_kind.values()) > MAX_RECORDS:
        raise ExchangeError("record_limit", "Import exceeds the record limit")
    for kind, rows in rows_by_kind.items():
        if kind not in KINDS or not isinstance(rows, list):
            diagnostics.append(_diag("invalid_kind_or_rows", "Unsupported kind or non-list rows", kind=kind))
            continue
        field_mappings = groups.get(kind, [])
        targets = []
        for mapping in field_mappings:
            if not isinstance(mapping, dict):
                diagnostics.append(_diag("invalid_mapping", "Field mapping must be an object", kind=kind))
                continue
            target = mapping.get("target_field")
            if not isinstance(target, str) or not FIELD_RE.fullmatch(target) or target in _PATH_KEYS:
                diagnostics.append(_diag("invalid_target_field", "Target must be a plain non-custody field name", kind=kind, field=str(target)))
            elif target in targets:
                diagnostics.append(_diag("duplicate_target_mapping", "Target field is mapped more than once", kind=kind, field=target))
            targets.append(target)
        for row_number, row in enumerate(rows, 1):
            if not isinstance(row, (dict, list)):
                diagnostics.append(_diag("invalid_row", "Row must be an object or positional array", kind=kind, row=row_number))
                continue
            payload = {} if field_mappings else (copy.deepcopy(row) if isinstance(row, dict) else {})
            row_failed = False
            if not field_mappings and not isinstance(row, dict):
                diagnostics.append(_diag("positional_mapping_required", "Positional rows need explicit ordinal mappings", kind=kind, row=row_number))
                continue
            for mapping in field_mappings:
                if not isinstance(mapping, dict):
                    row_failed = True
                    continue
                target = mapping.get("target_field")
                if not isinstance(target, str) or not FIELD_RE.fullmatch(target) or target in _PATH_KEYS:
                    row_failed = True
                    continue
                try:
                    value = (copy.deepcopy(mapping["constant"]) if "constant" in mapping
                             else _read_column(row, mapping.get("source_field_or_ordinal")))
                    value = _transform(value, mapping)
                    relation = mapping.get("relationship_key")
                    if relation and value not in (None, ""):
                        if not isinstance(relation, dict) or relation.get("kind") not in KINDS:
                            raise ValueError("relationship_key must contain a supported kind")
                        namespace = relation.get("namespace") or source_namespace
                        def relate(v):
                            v = str(v)
                            prefix = relation["kind"] + "-"
                            return v if re.fullmatch(re.escape(prefix)+r"[0-9a-f]{32}", v) else stable_record_id(relation["kind"], namespace, v)
                        value = [relate(v) for v in value] if isinstance(value, list) else relate(value)
                    payload[target] = value
                except (ValueError, TypeError, KeyError, OverflowError) as exc:
                    diagnostics.append(_diag("mapping_value_invalid", str(exc), kind=kind, row=row_number, field=target))
                    row_failed = True
            if row_failed:
                continue
            raw_id = payload.pop("source_id", payload.pop("id", None))
            if isinstance(raw_id, bool) or not isinstance(raw_id, (str, int)) or not str(raw_id):
                diagnostics.append(_diag("missing_source_id", "A stable source_id is required; row number is not used as an identity", kind=kind, row=row_number))
                continue
            raw_id = str(raw_id)
            namespace = payload.pop("source_namespace", source_namespace)
            try:
                rid = stable_record_id(kind, namespace, raw_id)
            except ExchangeError as exc:
                diagnostics.append(_diag(exc.code, str(exc), kind=kind, row=row_number))
                continue
            source_revision = payload.pop("source_revision", None)
            if source_revision is None:
                source_revision = sha256(canonical_json(row))
            source_locator = payload.pop("source_locator", kind + " row " + str(row_number))
            revision = payload.pop("revision", 1)
            created_at, updated_at = payload.pop("created_at", None), payload.pop("updated_at", None)
            # Already-named relation fields can contain original IDs; map them
            # through the same namespace unless explicitly canonical.
            for field, target_kind in RELATIONSHIPS.get(kind, {}).items():
                value = payload.get(field)
                if value not in (None, "") and isinstance(value, (str, int)) and not isinstance(value, bool):
                    prefix = target_kind + "-"
                    value = str(value)
                    if not re.fullmatch(re.escape(prefix)+r"[0-9a-f]{32}", value):
                        payload[field] = stable_record_id(target_kind, namespace, value)
            if kind == "review_decision" and payload.get("record_id") and payload.get("record_type") in KINDS:
                value = str(payload["record_id"])
                target_kind = payload["record_type"]
                if not re.fullmatch(re.escape(target_kind)+r"-[0-9a-f]{32}", value):
                    payload["record_id"] = stable_record_id(target_kind, namespace, value)
            for list_field, target_kind in (("evidence_ids","evidence"), ("evidence_refs","evidence")):
                if list_field in payload and isinstance(payload[list_field], list):
                    payload[list_field] = [v if isinstance(v, str) and re.fullmatch(re.escape(target_kind)+r"-[0-9a-f]{32}", v)
                                           else stable_record_id(target_kind, namespace, str(v))
                                           for v in payload[list_field]]
            if kind == "observation":
                raw_priority = payload.get("priority_raw")
                if "priority_normalized" not in payload:
                    payload["priority_normalized"] = (str(raw_priority).strip().lower()
                        if raw_priority is not None and str(raw_priority).strip().lower() in {"high","medium","low"} else None)
                if payload.get("priority_normalized") is None and raw_priority not in (None, ""):
                    diagnostics.append(_diag("priority_unresolved", "Raw priority retained; it is not classified as Low", kind=kind, row=row_number, field="priority_raw", record_id=rid, severity="warning"))
            if kind == "sub_activity" and "normalized_result" not in payload:
                raw = payload.get("raw_result_symbol")
                payload["normalized_result"] = ("observation" if raw == "O" else
                    "no_observation" if raw in ("✓","✔","\uf0fc") else None)
                if raw not in (None, "", "O", "✓", "✔", "\uf0fc"):
                    diagnostics.append(_diag("result_symbol_unresolved", "Original result symbol retained for explicit review", kind=kind, row=row_number, field="raw_result_symbol", record_id=rid, severity="warning"))
            if "custody_path" in payload:
                diagnostics.append(_diag("custody_path_excluded", "Local custody locations are not portable fields; original input remains a retained source blob", kind=kind, row=row_number, severity="warning"))
            payload = _clean_custody(payload)
            payload["source_values"] = _clean_custody(row)
            record = {"kind":kind,"id":rid,"revision":revision,
                      "source":{"namespace":namespace,"id":raw_id,"revision":str(source_revision),
                                "locator":source_locator},
                      "payload":payload,"created_at":created_at,"updated_at":updated_at}
            if rid in positions:
                previous = records[positions[rid]]
                # Row locators differ for duplicates; identity and content are the
                # meaningful comparison, while the raw input blob retains both.
                a, b = copy.deepcopy(previous), copy.deepcopy(record)
                a["source"]["locator"] = b["source"]["locator"] = None
                if canonical_json(a) == canonical_json(b):
                    diagnostics.append(_diag("duplicate_identical", "Identical repeated source identity coalesced; original rows retained in source", kind=kind, row=row_number, record_id=rid, severity="warning"))
                else:
                    diagnostics.append(_diag("duplicate_conflicting", "Source identity has conflicting rows in this import", kind=kind, row=row_number, record_id=rid))
                continue
            positions[rid] = len(records)
            records.append(record)
    diagnostics.extend(validate_records(records))
    return {"format":"commons-audit-normalization/1","source_namespace":source_namespace,
            "records":records,"mappings":copy.deepcopy(mappings or []),
            "diagnostics":diagnostics,"valid":not any(x["severity"]=="error" for x in diagnostics),
            "counts":dict(Counter(r["kind"] for r in records))}

def validate_records(records, *, external_ids=None):
    diagnostics, index = [], {}
    external_ids = set(external_ids or [])
    if not isinstance(records, list) or len(records) > MAX_RECORDS:
        return [_diag("invalid_records", "Records must be a bounded list")]
    for position, record in enumerate(records, 1):
        if not isinstance(record, dict):
            diagnostics.append(_diag("invalid_record", "Record must be an object", row=position))
            continue
        kind, rid, source, payload = record.get("kind"), record.get("id"), record.get("source"), record.get("payload")
        if kind not in KINDS or not isinstance(source, dict) or not isinstance(payload, dict):
            diagnostics.append(_diag("invalid_record_shape", "Record kind/source/payload is invalid", row=position, record_id=str(rid)))
            continue
        try:
            expected_id = stable_record_id(kind, source.get("namespace"), source.get("id"))
        except ExchangeError as exc:
            diagnostics.append(_diag(exc.code, str(exc), row=position, record_id=str(rid)))
            continue
        if rid != expected_id:
            diagnostics.append(_diag("identity_mismatch", "Record ID does not match kind, namespace and original source ID", row=position, record_id=str(rid)))
        if rid in index:
            diagnostics.append(_diag("duplicate_record_id", "Snapshot heads contain a repeated record ID", row=position, record_id=str(rid)))
            continue
        if not isinstance(rid, str):
            continue
        index[rid] = record
        if type(record.get("revision")) is not int or record["revision"] < 1:
            diagnostics.append(_diag("invalid_revision", "Local revision must be a positive integer", record_id=rid))
        if not isinstance(source.get("revision"), (str, int)) or isinstance(source.get("revision"), bool):
            diagnostics.append(_diag("missing_source_revision", "Original source revision/hash must be preserved", record_id=rid))
        for field in DATE_FIELDS:
            if payload.get(field) not in (None, ""):
                try:
                    _date(payload[field])
                except (ValueError, TypeError):
                    diagnostics.append(_diag("invalid_date", "Expected a real YYYY-MM-DD date", record_id=rid, field=field))
        for field in BOOL_FIELDS:
            if field in payload and payload[field] is not None and type(payload[field]) is not bool:
                diagnostics.append(_diag("invalid_boolean", "Explicit Boolean required; strings do not grant report access", record_id=rid, field=field))
        for field in LIST_FIELDS:
            if field in payload and (not isinstance(payload[field], list) or any(not isinstance(v, str) or not v for v in payload[field])):
                diagnostics.append(_diag("invalid_id_list", "Expected an array of nonempty original/canonical IDs", record_id=rid, field=field))
        for field in REQUIRED_REFS.get(kind, ()):
            if not payload.get(field):
                diagnostics.append(_diag("required_relationship", "Relationship is required", record_id=rid, field=field))
        if kind == "engagement" and not isinstance(payload.get("title"), str):
            diagnostics.append(_diag("missing_title", "Engagement title is required", record_id=rid, field="title"))
        if kind == "observation":
            if payload.get("priority_normalized") not in (None,"high","medium","low"):
                diagnostics.append(_diag("invalid_priority", "Priority is high, medium, low or null; raw value stays separate", record_id=rid, field="priority_normalized"))
        if kind == "evidence":
            if not any(payload.get(key) for key in ("engagement_id","observation_id","workpaper_id")):
                diagnostics.append(_diag("orphan_evidence", "Evidence must link an engagement, observation or workpaper", record_id=rid))
            if not isinstance(payload.get("sha256"), str) or not SHA_RE.fullmatch(payload["sha256"]):
                diagnostics.append(_diag("invalid_evidence_hash", "Evidence requires its complete SHA256", record_id=rid))
            if type(payload.get("size")) is not int or payload["size"] < 0:
                diagnostics.append(_diag("invalid_evidence_size", "Evidence requires a nonnegative byte size", record_id=rid))
        if kind == "questionnaire_response":
            if not isinstance(payload.get("question_id"),str) or not payload["question_id"]:
                diagnostics.append(_diag("question_identity","Question response must preserve original issuer question_id",record_id=rid))
            if not isinstance(payload.get("catalog_sha"),str) or not SHA_RE.fullmatch(payload["catalog_sha"]):
                diagnostics.append(_diag("question_catalog_hash","Question response must pin its exact source catalog SHA256",record_id=rid))
        if kind == "review_decision":
            if payload.get("record_type") not in KINDS or not isinstance(payload.get("record_id"), str):
                diagnostics.append(_diag("invalid_review_target", "Review must identify a supported record type and ID", record_id=rid))
            if not isinstance(payload.get("input_hash"), str) or not SHA_RE.fullmatch(payload["input_hash"]):
                diagnostics.append(_diag("invalid_review_hash", "Review must pin the exact input record hash", record_id=rid))
        try:
            canonical_json(record)
        except ExchangeError as exc:
            diagnostics.append(_diag(exc.code, str(exc), record_id=rid))
    for rid, record in index.items():
        kind, p = record["kind"], record["payload"]
        for field, target_kind in RELATIONSHIPS.get(kind, {}).items():
            target_id = p.get(field)
            if target_id in (None, ""):
                continue
            if not isinstance(target_id, str):
                diagnostics.append(_diag("invalid_relationship", "Relationship must be a canonical ID", record_id=rid, field=field))
            elif target_id not in index and target_id not in external_ids:
                diagnostics.append(_diag("missing_relationship", "Referenced record is absent", record_id=rid, field=field))
            elif target_id in index and index[target_id]["kind"] != target_kind:
                diagnostics.append(_diag("relationship_kind_mismatch", "Reference points to the wrong record kind", record_id=rid, field=field))
        if kind == "review_decision" and (not isinstance(p.get("record_id"), str) or (p["record_id"] not in index and p["record_id"] not in external_ids)):
            diagnostics.append(_diag("missing_review_target", "Reviewed record is absent", record_id=rid, field="record_id"))
        for field, target_kind in (("evidence_ids","evidence"), ("evidence_refs","evidence")):
            if isinstance(p.get(field), list):
                for target_id in p[field]:
                    if target_id not in index and target_id not in external_ids:
                        diagnostics.append(_diag("missing_relationship", "Referenced evidence is absent", record_id=rid, field=field))
                    elif target_id in index and index[target_id]["kind"] != target_kind:
                        diagnostics.append(_diag("relationship_kind_mismatch", "Evidence reference has wrong kind", record_id=rid, field=field))
        if kind in {"advisory_memo","receiving_projection"}:
            for field in ("record_ids","included_record_ids"):
                for target_id in p.get(field, []) if isinstance(p.get(field, []), list) else []:
                    if target_id not in index and target_id not in external_ids:
                        diagnostics.append(_diag("missing_relationship", "Selected source record is absent", record_id=rid, field=field))
        # Every explicit relationship in a record must resolve to one engagement.
        engagement_ids = {resolve_engagement(v, index) for key,v in p.items()
                          if key in RELATIONSHIPS.get(kind, {}) and isinstance(v, str) and v in index}
        engagement_ids.discard(None)
        if len(engagement_ids) > 1:
            diagnostics.append(_diag("cross_engagement_relationship", "Linked records belong to different engagements", record_id=rid))
        if kind == "audit_area":
            trail, cursor = {rid}, p.get("parent_area_id")
            while cursor in index:
                if cursor in trail:
                    diagnostics.append(_diag("area_cycle", "Parent areas form a cycle", record_id=rid))
                    break
                trail.add(cursor)
                cursor = index[cursor]["payload"].get("parent_area_id")
    return diagnostics

def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("format") != "commons-audit-snapshot/1":
        raise ExchangeError("snapshot_format", "Unsupported audit snapshot")
    if not isinstance(snapshot.get("workspace_id"), str) or not snapshot["workspace_id"]:
        raise ExchangeError("workspace_identity", "Snapshot must preserve workspace_id")
    diagnostics = validate_records(snapshot.get("records"))
    sources, source_ids = snapshot.get("sources", []), set()
    if not isinstance(sources, list):
        diagnostics.append(_diag("invalid_sources", "sources must be a list"))
        sources = []
    for source in sources:
        if not isinstance(source, dict):
            diagnostics.append(_diag("invalid_source", "Source manifest entry must be an object"))
            continue
        sid = source.get("id")
        if not isinstance(sid, str) or not sid or sid in source_ids:
            diagnostics.append(_diag("source_identity", "Source IDs must be nonempty and unique"))
        source_ids.add(sid) if isinstance(sid, str) else None
        if not isinstance(source.get("sha256"), str) or not SHA_RE.fullmatch(source["sha256"]):
            diagnostics.append(_diag("source_hash", "Source requires exact SHA256"))
        if type(source.get("bytes")) is not int or source["bytes"] < 0:
            diagnostics.append(_diag("source_size", "Source requires exact nonnegative byte size"))
        for field in ("name","media_type","role"):
            if not isinstance(source.get(field), str):
                diagnostics.append(_diag("source_metadata", "Source requires " + field))
    if diagnostics:
        errors = [d for d in diagnostics if d["severity"] == "error"]
        if errors:
            raise ExchangeError("snapshot_invalid", "Snapshot failed complete record/source preflight", diagnostics)
    revisions = snapshot.get("revisions", [])
    if not isinstance(revisions, list) or len(revisions) > MAX_RECORDS:
        raise ExchangeError("revision_limit", "Revision history must be a bounded list")
    heads = {r["id"]:r for r in snapshot["records"]}
    seen = set()
    for record in revisions:
        if not isinstance(record, dict) or record.get("id") not in heads:
            raise ExchangeError("orphan_revision", "History must refer to a retained head")
        failures = validate_records([record], external_ids=heads)
        if failures:
            raise ExchangeError("invalid_history", "History record is invalid", failures)
        key = (record["id"], record.get("revision"))
        if key in seen:
            raise ExchangeError("duplicate_revision", "History repeats an ID/revision")
        seen.add(key)
        failures = validate_records([record], external_ids=heads)
        if failures:
            raise ExchangeError("invalid_history", "History record is invalid", failures)
        if record["revision"] > heads[record["id"]]["revision"]:
            raise ExchangeError("future_history", "History revision exceeds its current head")
        if record["revision"] == heads[record["id"]]["revision"] and canonical_json(record) != canonical_json(heads[record["id"]]):
            raise ExchangeError("head_history_conflict", "Head differs from the same retained history revision")
    canonical_json(snapshot)
    return diagnostics

def _portable_path(name):
    if (not isinstance(name, str) or not name or len(name) > 240 or "\0" in name
            or "\\" in name or ":" in name or name.startswith("/")
            or any(part in {"", ".", ".."} for part in name.split("/"))):
        raise ExchangeError("unsafe_member_path", "Archive members must use safe relative POSIX paths")
    for part in name.split("/"):
        if part.endswith((" ", ".")) or part.split(".",1)[0].upper() in {
            "CON","PRN","AUX","NUL",*(f"COM{i}" for i in range(1,10)),*(f"LPT{i}" for i in range(1,10))}:
            raise ExchangeError("unsafe_member_path", "Archive name is not portable")
    return name

def _read_zip(data):
    if not isinstance(data, bytes) or len(data) > MAX_ZIP_BYTES:
        raise ExchangeError("zip_size", "ZIP exceeds the 64 MiB input limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (ValueError, zipfile.BadZipFile) as exc:
        raise ExchangeError("invalid_zip", "A complete ZIP archive is required") from exc
    result, names, expanded = {}, set(), 0
    with archive:
        members = archive.infolist()
        if len(members) > MAX_MEMBERS:
            raise ExchangeError("zip_member_limit", "ZIP exceeds 2,000 entries")
        for info in members:
            if info.is_dir():
                continue
            name = _portable_path(info.filename)
            if name.casefold() in names:
                raise ExchangeError("duplicate_zip_member", "Duplicate or case-colliding archive member: " + name)
            names.add(name.casefold())
            if info.flag_bits & 1 or stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK:
                raise ExchangeError("unsupported_zip_entry", "Encrypted and symbolic-link entries are not accepted")
            if info.file_size < 0 or info.file_size > MAX_EXPANDED_BYTES:
                raise ExchangeError("expanded_size", "Archive member exceeds the expanded size limit")
            expanded += info.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ExchangeError("expanded_size", "Archive exceeds 512 MiB expanded")
            try:
                content = archive.read(info)
            except (zipfile.BadZipFile, RuntimeError, ValueError, NotImplementedError) as exc:
                raise ExchangeError("invalid_zip_member", "Could not read complete archive member: " + name) from exc
            if len(content) != info.file_size:
                raise ExchangeError("truncated_member", "Expanded member size differs")
            result[name] = content
    return result

def _write_zip(files):
    if len(files) > MAX_MEMBERS or sum(len(value) for value in files.values()) > MAX_EXPANDED_BYTES:
        raise ExchangeError("package_limits", "Package exceeds 2,000 files or 512 MiB expanded; retain oversized custody separately")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        folded = set()
        for name in sorted(files):
            _portable_path(name)
            if name.casefold() in folded:
                raise ExchangeError("duplicate_zip_member", "Case-colliding package names")
            folded.add(name.casefold())
            if not isinstance(files[name], bytes):
                raise ExchangeError("invalid_file_bytes", "Package files must be byte strings")
            info = zipfile.ZipInfo(name, date_time=(1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, files[name])
    result = output.getvalue()
    if len(result) > MAX_ZIP_BYTES:
        raise ExchangeError("package_zip_limit", "Final ZIP exceeds 64 MiB; no incomplete package was produced")
    return result

def _manifest_entry(path, data, role, media_type):
    return {"path":path,"bytes":len(data),"sha256":sha256(data),"role":role,"media_type":media_type}

def build_handoff(snapshot, blob_resolver, *, audience, selected_engagement_ids, review_reference):
    """Produce (ZIP bytes, manifest) after complete record and blob verification.

    Auditor packages retain full selected records/history and exact original source
    and evidence bytes. Other audiences get reviewed projected records/reports and
    hash references; original source rows, mapping text, and evidence bodies stay
    private. The full encrypted workspace archive belongs to the host.
    """
    validate_snapshot(snapshot)
    try:
        projected = project_snapshot(snapshot, audience=audience,
            selected_engagement_ids=selected_engagement_ids, review_reference=review_reference)
    except (ValueError, TypeError, KeyError) as exc:
        raise ExchangeError("invalid_projection", str(exc)) from exc
    validate_snapshot(projected)
    files = {"snapshot.json":canonical_json(projected)}
    files.update(render_reports(projected))
    entries = [_manifest_entry(name, data, "snapshot" if name=="snapshot.json" else "report",
                "application/json" if name.endswith(".json") else
                "text/html; charset=utf-8" if name.endswith(".html") else "text/csv; charset=utf-8")
               for name,data in files.items()]
    role = projected["projection"]["audience"]["role"]
    referenced = {}
    if role == "auditor":
        for source in projected["sources"]:
            digest, size = source["sha256"], source["bytes"]
            if digest in referenced and referenced[digest]["bytes"] != size:
                raise ExchangeError("blob_size_conflict", "One hash has conflicting declared byte sizes")
            referenced[digest] = {"bytes":size,"role":"source","media_type":source["media_type"]}
        for record in projected["records"] + projected.get("revisions", []):
            if record["kind"] == "evidence":
                p = record["payload"]
                digest, size = p["sha256"], p["size"]
                if digest in referenced and referenced[digest]["bytes"] != size:
                    raise ExchangeError("blob_size_conflict", "Evidence and source manifest sizes differ")
                referenced[digest] = {"bytes":size,"role":"evidence","media_type":p.get("media_type","application/octet-stream")}
        if sum(item["bytes"] for item in referenced.values()) + sum(map(len,files.values())) > MAX_EXPANDED_BYTES:
            raise ExchangeError("custody_size_limit", "Retained blobs exceed portable handoff capacity before materialization")
        for digest, info in sorted(referenced.items()):
            try:
                data = blob_resolver(digest)
            except Exception as exc:
                raise ExchangeError("blob_unavailable", "Required retained blob could not be resolved: " + digest) from exc
            if not isinstance(data, bytes) or len(data) != info["bytes"] or sha256(data) != digest:
                raise ExchangeError("blob_identity_mismatch", "Retained source/evidence bytes differ from declared identity: " + digest)
            name = "blobs/" + digest
            files[name] = data
            entries.append(_manifest_entry(name, data, info["role"], info["media_type"]))
    manifest = {
        "format":"commons-audit-handoff/1",
        "source_workspace_id":snapshot["workspace_id"],
        "captured_at":snapshot.get("captured_at"),
        "snapshot_sha256":sha256(files["snapshot.json"]),
        "projection":copy.deepcopy(projected["projection"]),
        "record_counts":dict(Counter(r["kind"] for r in projected["records"])),
        "history_count":len(projected.get("revisions",[])),
        "files":sorted(entries,key=lambda x:x["path"]),
        "custody_mode":"complete_selected_auditor" if role=="auditor" else "projected_metadata_only",
    }
    manifest["bundle_id"] = "audit-" + sha256(canonical_json(manifest))
    files["manifest.json"] = canonical_json(manifest)
    data = _write_zip(files)
    return data, manifest

def read_handoff(data):
    """Verify every byte/member and return a persistence-free receiving object."""
    files = _read_zip(data)
    if "manifest.json" not in files or "snapshot.json" not in files:
        raise ExchangeError("missing_manifest", "Handoff requires manifest.json and snapshot.json")
    manifest = _load_json(files["manifest.json"], "manifest.json")
    if not isinstance(manifest,dict) or manifest.get("format")!="commons-audit-handoff/1":
        raise ExchangeError("handoff_format","Unsupported handoff format")
    entries = manifest.get("files")
    if not isinstance(entries,list):
        raise ExchangeError("manifest_files","Manifest files must be a list")
    declared = set()
    for entry in entries:
        if not isinstance(entry,dict):
            raise ExchangeError("manifest_file_shape","Invalid file manifest entry")
        name = _portable_path(entry.get("path"))
        if name=="manifest.json" or name in declared:
            raise ExchangeError("manifest_duplicate","Repeated or self-referential manifest file")
        declared.add(name)
        if (type(entry.get("bytes")) is not int or entry["bytes"]<0
                or not isinstance(entry.get("sha256"),str) or not SHA_RE.fullmatch(entry["sha256"])):
            raise ExchangeError("manifest_identity","Each file requires exact size and SHA256")
        if name not in files or len(files[name])!=entry["bytes"] or sha256(files[name])!=entry["sha256"]:
            raise ExchangeError("member_identity_mismatch","File differs from complete manifest: "+name)
    if set(files)-{"manifest.json"} != declared:
        raise ExchangeError("unmanifested_files","Every package member must be declared exactly once")
    if manifest.get("snapshot_sha256")!=sha256(files["snapshot.json"]):
        raise ExchangeError("snapshot_hash_mismatch","Snapshot identity does not match manifest")
    unsigned=copy.deepcopy(manifest)
    bundle_id=unsigned.pop("bundle_id",None)
    if bundle_id!="audit-"+sha256(canonical_json(unsigned)):
        raise ExchangeError("bundle_identity_mismatch","Manifest bundle identity is invalid")
    snapshot=_load_json(files["snapshot.json"],"snapshot.json")
    validate_snapshot(snapshot)
    projection=snapshot.get("projection")
    if not isinstance(projection,dict) or canonical_json(projection)!=canonical_json(manifest.get("projection")):
        raise ExchangeError("projection_identity_mismatch","Snapshot and manifest projection differ")
    if manifest.get("source_workspace_id")!=snapshot["workspace_id"]:
        raise ExchangeError("workspace_identity_mismatch","Original workspace identity differs")
    if manifest.get("record_counts")!=dict(Counter(r["kind"] for r in snapshot["records"])):
        raise ExchangeError("record_count_mismatch","Manifest counts differ from complete records")
    if manifest.get("history_count")!=len(snapshot.get("revisions",[])):
        raise ExchangeError("history_count_mismatch","History count differs")
    expected_reports=render_reports(snapshot)
    if any(files.get(name)!=content for name,content in expected_reports.items()):
        raise ExchangeError("report_projection_mismatch","Report bytes differ from the frozen audience projection")
    if any(name not in {"manifest.json","snapshot.json",*expected_reports} and not name.startswith("blobs/") for name in files):
        raise ExchangeError("unexpected_content","Package contains content outside the snapshot/report/blob contract")
    role=projection.get("audience",{}).get("role")
    if role!="auditor":
        if snapshot["sources"] or snapshot.get("revisions") or any(name.startswith("blobs/") for name in files):
            raise ExchangeError("non_auditor_raw_content","Nonauditor package contains full sources/history/blob bodies")
        # Re-projecting the already-projected snapshot would lose the original
        # hashes. Validate the allowed field contract directly instead.
        for record in snapshot["records"]:
            if (not isinstance(record.get("projection"),dict)
                    or record["projection"].get("audience_role")!=role
                    or not isinstance(record["projection"].get("source_record_sha256"),str)
                    or not SHA_RE.fullmatch(record["projection"]["source_record_sha256"])):
                raise ExchangeError("projection_record_identity","Projected records must retain original hashes and audience")
            if "source_values" in record["payload"] or any(key in record["payload"] for key in _PATH_KEYS):
                raise ExchangeError("projected_raw_values","Projected record contains raw source/custody fields")
        # The stored view is checked again against its declared audience. No
        # external role authorization is implied by accepting these bytes.
        try:
            safe=project_snapshot(snapshot,audience=projection["audience"],
                selected_engagement_ids=projection["selected_engagement_ids"],
                review_reference=projection["review_reference"])
        except (ValueError,TypeError,KeyError) as exc:
            raise ExchangeError("projection_policy",str(exc)) from exc
        safe_by_id={r["id"]:r for r in safe["records"]}
        for record in snapshot["records"]:
            safe_record=safe_by_id.get(record["id"])
            if safe_record is None or canonical_json(safe_record["payload"])!=canonical_json(record["payload"]):
                raise ExchangeError("projection_policy","Record content exceeds the declared audience projection")
    blobs={}
    required={}
    if role=="auditor":
        for source in snapshot["sources"]:
            required[source["sha256"]]=source["bytes"]
        for record in snapshot["records"]+snapshot.get("revisions",[]):
            if record["kind"]=="evidence":
                digest,size=record["payload"]["sha256"],record["payload"]["size"]
                if digest in required and required[digest]!=size:
                    raise ExchangeError("blob_size_conflict","Source and evidence sizes conflict")
                required[digest]=size
        for digest,size in required.items():
            name="blobs/"+digest
            if name not in files or len(files[name])!=size or sha256(files[name])!=digest:
                raise ExchangeError("required_blob_missing","Full auditor custody requires exact blob "+digest)
            blobs[digest]=files[name]
        if {name for name in files if name.startswith("blobs/")} != {"blobs/"+d for d in required}:
            raise ExchangeError("unreferenced_blob","Blob is not referenced by retained sources or evidence")
    return {"format":"commons-audit-received/1","bundle_sha256":sha256(data),
            "bundle_id":bundle_id,"manifest":manifest,"snapshot":snapshot,
            "files":files,"blobs":blobs,"projection_only":role!="auditor"}

def inspect_archive(data):
    """Read-only preview. Full handoffs are verified, never partially extracted."""
    received=read_handoff(data)
    return {"format":"commons-audit-archive-preview/1","valid":True,
            "bundle_sha256":received["bundle_sha256"],"bundle_id":received["bundle_id"],
            "source_workspace_id":received["snapshot"]["workspace_id"],
            "audience":copy.deepcopy(received["manifest"]["projection"]["audience"]),
            "counts":copy.deepcopy(received["manifest"]["record_counts"]),
            "history_count":received["manifest"]["history_count"],
            "files":copy.deepcopy(received["manifest"]["files"]),
            "omitted":copy.deepcopy(received["manifest"]["projection"]["omitted_records"]),
            "projection_only":received["projection_only"],
            "source_ids":[s["id"] for s in received["snapshot"]["sources"]]}

def plan_receipt(current_snapshot, received, *, prior_receipts=None):
    """Return a whole-operation plan; this function does not claim an import.

    Same ZIP hash replays are explicit. Revisions can advance automatically only
    when the supplied history contains the exact existing head. Every record and
    source conflict is returned before the caller performs any Store/blob write.
    """
    validate_snapshot(current_snapshot)
    if not isinstance(received,dict) or received.get("format")!="commons-audit-received/1":
        raise ExchangeError("received_format","Call read_handoff on original bytes first")
    incoming=received["snapshot"]
    validate_snapshot(incoming)
    digest=received["bundle_sha256"]
    if not SHA_RE.fullmatch(digest):
        raise ExchangeError("receipt_hash","Invalid exact bundle hash")
    base={"format":"commons-audit-receiving-plan/1","receipt_id":"receive-"+digest[:32],
          "bundle_sha256":digest,"bundle_id":received["bundle_id"],
          "source_workspace_id":incoming["workspace_id"],"workspace_id":current_snapshot["workspace_id"],
          "projection_only":received["projection_only"],"imported":[],
          "planned_imports":[],"conflicted":[],"omitted":copy.deepcopy(incoming["projection"]["omitted_records"]),
          "reused":[],"source_imports":[]}
    for receipt in prior_receipts or []:
        if isinstance(receipt,dict) and receipt.get("bundle_sha256")==digest and receipt.get("status") in {"accepted","imported","complete"}:
            base["status"]="replayed"
            base["prior_receipt_id"]=receipt.get("receipt_id")
            return base
    current={r["id"]:r for r in current_snapshot["records"]}
    ancestors={(r["id"],r["revision"]):r for r in incoming.get("revisions",[])}
    local_history={(r["id"],r["revision"]):r for r in current_snapshot.get("revisions",[])}
    for record in incoming["records"]:
        rid=record["id"]
        previous=current.get(rid)
        if previous is None:
            base["planned_imports"].append({"id":rid,"kind":record["kind"],"action":"create","record":copy.deepcopy(record)})
            continue
        if canonical_json(previous)==canonical_json(record):
            base["reused"].append({"id":rid,"reason":"same_record_bytes"})
            continue
        pp,rp=previous.get("projection"),record.get("projection")
        if rp and not pp and rp.get("source_record_sha256")==record_hash(previous):
            base["reused"].append({"id":rid,"reason":"full_original_already_present"})
            continue
        if pp and not rp and pp.get("source_record_sha256")==record_hash(record):
            base["planned_imports"].append({"id":rid,"kind":record["kind"],"action":"expand_projection","record":copy.deepcopy(record)})
            continue
        reason=None
        if pp or rp:
            reason="projection_scope_or_original_conflict"
        elif record["revision"]==previous["revision"]:
            reason="same_revision_different_content"
        elif record["revision"]<previous["revision"]:
            retained=local_history.get((rid,record["revision"]))
            if retained and canonical_json(retained)==canonical_json(record):
                base["reused"].append({"id":rid,"reason":"exact_older_revision_retained"})
                continue
            reason="unrecognized_older_revision"
        else:
            ancestor=ancestors.get((rid,previous["revision"]))
            if ancestor and canonical_json(ancestor)==canonical_json(previous):
                base["planned_imports"].append({"id":rid,"kind":record["kind"],"action":"advance_with_retained_ancestry","record":copy.deepcopy(record)})
                continue
            reason="missing_exact_local_ancestry"
        base["conflicted"].append({"id":rid,"kind":record["kind"],"reason":reason,
             "current_revision":previous["revision"],"incoming_revision":record["revision"],
             "current_sha256":record_hash(previous),"incoming_sha256":record_hash(record)})
    current_sources={s["id"]:s for s in current_snapshot["sources"]}
    for source in incoming["sources"]:
        previous=current_sources.get(source["id"])
        if previous is None:
            base["source_imports"].append(copy.deepcopy(source))
        elif canonical_json(previous)!=canonical_json(source):
            base["conflicted"].append({"id":source["id"],"kind":"source",
                "reason":"source_identity_conflict","current_sha256":previous["sha256"],"incoming_sha256":source["sha256"]})
    for record in incoming.get("revisions",[]):
        previous=local_history.get((record["id"],record["revision"])) or current.get(record["id"])
        if previous and previous["revision"]==record["revision"] and canonical_json(previous)!=canonical_json(record):
            base["conflicted"].append({"id":record["id"],"kind":record["kind"],"reason":"retained_history_conflict","revision":record["revision"]})
    # A package can be valid by itself but conflict with retained local graph
    # relationships. Compose and validate the entire prospective graph now.
    if not base["conflicted"]:
        combined={rid:copy.deepcopy(record) for rid,record in current.items()}
        for item in base["planned_imports"]:
            combined[item["id"]]=item["record"]
        failures=validate_records(list(combined.values()))
        if failures:
            base["conflicted"].extend({"kind":"graph","reason":"combined_graph_invalid","diagnostic":failure} for failure in failures)
    base["status"]="conflicted" if base["conflicted"] else "ready"
    return base

def prepare_adoption(current_snapshot, received, plan):
    """Prepare one atomic host adoption; caller must commit before marking accepted."""
    if plan.get("status") not in {"ready","replayed"} or plan.get("bundle_sha256")!=received.get("bundle_sha256"):
        raise ExchangeError("unready_receipt","Only an exact ready receiving plan can be adopted")
    fresh=plan_receipt(current_snapshot,received)
    # A retained replay is a no-op. A fresh plan is compared to prevent a review
    # from being applied after current heads have changed.
    if plan["status"]=="replayed":
        return {"snapshot":copy.deepcopy(current_snapshot),"receipt":copy.deepcopy(plan),"blobs":{}}
    if canonical_json(fresh)!=canonical_json(plan):
        raise ExchangeError("receiving_plan_stale","Current records changed after receiving review")
    snapshot=copy.deepcopy(current_snapshot)
    heads={r["id"]:r for r in snapshot["records"]}
    history={(r["id"],r["revision"]):r for r in snapshot.get("revisions",[])}
    for item in plan["planned_imports"]:
        previous=heads.get(item["id"])
        if previous and not previous.get("projection"):
            history[(previous["id"],previous["revision"])]=previous
        heads[item["id"]]=copy.deepcopy(item["record"])
    for record in received["snapshot"].get("revisions",[]):
        key=(record["id"],record["revision"])
        if key in history and canonical_json(history[key])!=canonical_json(record):
            raise ExchangeError("history_conflict","Retained history differs; no adoption was produced")
        history[key]=copy.deepcopy(record)
    snapshot["records"]=list(heads.values())
    snapshot["revisions"]=list(history.values())
    snapshot["sources"].extend(copy.deepcopy(plan["source_imports"]))
    validate_snapshot(snapshot)
    receipt={k:copy.deepcopy(v) for k,v in plan.items() if k not in {"planned_imports","source_imports"}}
    receipt["status"]="prepared"
    receipt["imported"]=[]
    receipt["prepared_record_ids"]=[item["id"] for item in plan["planned_imports"]]
    receipt["prepared_source_ids"]=[item["id"] for item in plan["source_imports"]]
    return {"snapshot":snapshot,"receipt":receipt,"blobs":received["blobs"]}

def _target_contract(contract):
    if not isinstance(contract,dict) or contract.get("format")!="commons-audit-target-contract/1":
        raise ExchangeError("target_contract","An explicit target contract is required")
    if not isinstance(contract.get("native_contract_reference"),(str,dict)) or not contract["native_contract_reference"]:
        raise ExchangeError("target_reference","Preserve the actual target/native contract reference")
    tables=contract.get("tables")
    if not isinstance(tables,list) or not tables:
        raise ExchangeError("target_tables","Target contract requires tables")
    names=set()
    for table in tables:
        if not isinstance(table,dict) or table.get("kind") not in KINDS:
            raise ExchangeError("target_kind","Every target table requires a supported kind")
        name=_portable_path(table.get("file"))
        if name.casefold() in names:
            raise ExchangeError("target_filename","Target filenames must be unique")
        names.add(name.casefold())
        fields=table.get("fields")
        if not isinstance(fields,list) or not fields:
            raise ExchangeError("target_fields","Target fields must be an ordered nonempty array")
        if not any(field.get("target_field")=="source_id" for field in fields if isinstance(field,dict)):
            raise ExchangeError("target_identity","Every target table must retain source_id for reconciliation")
        for field in fields:
            if (not isinstance(field,dict) or not isinstance(field.get("name"),str)
                    or not isinstance(field.get("target_field"),str) or not FIELD_RE.fullmatch(field["target_field"])):
                raise ExchangeError("target_field","Each target ordinal needs a name and canonical target_field")
        if table.get("encoding","utf-8-sig") not in {"utf-8","utf-8-sig","utf-16","utf-16-le"}:
            raise ExchangeError("target_encoding","Use a declared supported Unicode encoding")
        if table.get("delimiter",",") not in {",",";","\t","|"}:
            raise ExchangeError("target_delimiter","Unsupported declared delimiter")
        if table.get("line_ending","CRLF") not in {"CRLF","LF"} or type(table.get("header",True)) is not bool:
            raise ExchangeError("target_format","Declare header Boolean and CRLF/LF line ending")
    return contract

def _target_value(record, field, index):
    target=field["target_field"]
    if target=="source_id":
        value=record["source"]["id"]
    elif target=="source_namespace":
        value=record["source"]["namespace"]
    elif target=="source_revision":
        value=record["source"]["revision"]
    else:
        value=record["payload"].get(target)
    if field.get("relationship_key") and value not in (None,""):
        relation=field["relationship_key"]
        def original(v):
            linked=index.get(v)
            if linked is None:
                raise ExchangeError("target_reference_missing","Canonical relationship cannot resolve to a target source ID")
            if linked["kind"]!=relation.get("kind"):
                raise ExchangeError("target_reference_kind","Target relationship kind differs")
            expected_namespace=relation.get("namespace") or record["source"]["namespace"]
            if linked["source"]["namespace"]!=expected_namespace:
                raise ExchangeError("target_reference_namespace","Cross-namespace target relationship needs an explicit declared namespace")
            return linked["source"]["id"]
        value=[original(v) for v in value] if isinstance(value,list) else original(value)
    if value is None:
        if field.get("required"):
            raise ExchangeError("target_required","Target requires a missing value: "+target)
        return field.get("null_token","")
    export_map=field.get("export_value_map")
    if export_map is not None:
        if not isinstance(export_map,dict) or str(value) not in export_map:
            raise ExchangeError("target_value_map","No exact export mapping for "+target)
        value=export_map[str(value)]
    if isinstance(value,(list,dict)):
        if field.get("transform")=="split" and isinstance(value,list):
            separator=field.get("separator","|")
            if any(separator in str(v) for v in value):
                raise ExchangeError("target_separator_collision","List value contains the declared separator")
            return separator.join(str(v) for v in value)
        if field.get("transform")!="json":
            raise ExchangeError("target_complex_value","Array/object requires an explicit JSON or split contract")
        return canonical_json(value).decode("utf-8")
    if type(value) is bool:
        return field.get("true_token","true") if value else field.get("false_token","false")
    return str(value)

def export_native(projected_snapshot, contract):
    """Render ordered declared tables. No unspecified vendor schema is inferred."""
    validate_snapshot(projected_snapshot)
    if not isinstance(projected_snapshot.get("projection"),dict):
        raise ExchangeError("reviewed_projection_required","Create the reviewed audience projection before native export")
    _target_contract(contract)
    index={r["id"]:r for r in projected_snapshot["records"]}
    files, entries={},[]
    for table in contract["tables"]:
        stream=io.StringIO(newline="")
        writer=csv.writer(stream,delimiter=table.get("delimiter",","),
                          lineterminator="\r\n" if table.get("line_ending","CRLF")=="CRLF" else "\n")
        if table.get("header",True):
            writer.writerow([field["name"] for field in table["fields"]])
        records=sorted((r for r in projected_snapshot["records"] if r["kind"]==table["kind"]),key=lambda r:r["id"])
        for record in records:
            writer.writerow([_target_value(record,field,index) for field in table["fields"]])
        data=stream.getvalue().encode(table.get("encoding","utf-8-sig"))
        files[table["file"]]=data
        entry=_manifest_entry(table["file"],data,"declared_native_table","text/csv")
        entry.update({"kind":table["kind"],"records":len(records),"columns":len(table["fields"])})
        entries.append(entry)
    manifest={"format":"commons-audit-native-export/1",
              "target_contract_sha256":sha256(canonical_json(contract)),
              "native_contract_reference":copy.deepcopy(contract["native_contract_reference"]),
              "source_selection_hash":projected_snapshot["projection"]["source_selection_hash"],
              "projection_sha256":sha256(canonical_json(projected_snapshot)),
              "files":entries}
    return {"files":files,"manifest":manifest,"contract":copy.deepcopy(contract)}

def normalize_native_files(files, contract, source_namespace):
    """Parse exact ordered return files, retaining duplicate/blank header ordinals."""
    _target_contract(contract)
    if not isinstance(files,dict) or any(not isinstance(v,bytes) for v in files.values()):
        raise ExchangeError("native_files","Native files must be a filename→bytes object")
    rows, mappings, diagnostics, receipts={}, {}, [], []
    seen_kinds=set()
    for table in contract["tables"]:
        filename,kind=table["file"],table["kind"]
        if kind in seen_kinds:
            raise ExchangeError("native_duplicate_kind","Use one explicit table per kind for a receiving operation")
        seen_kinds.add(kind)
        if filename not in files:
            diagnostics.append(_diag("native_file_missing","Declared target file is absent",kind=kind,field=filename))
            continue
        data=files[filename]
        if len(data)>MAX_EXPANDED_BYTES:
            raise ExchangeError("native_file_size","Native file exceeds the expanded limit")
        receipts.append({"file":filename,"bytes":len(data),"sha256":sha256(data),
                         "native_contract_reference":copy.deepcopy(contract["native_contract_reference"])})
        try:
            text=data.decode(table.get("encoding","utf-8-sig"))
        except UnicodeError:
            diagnostics.append(_diag("native_encoding","File does not match the declared encoding",kind=kind,field=filename))
            continue
        try:
            parsed=list(csv.reader(io.StringIO(text,newline=""),delimiter=table.get("delimiter",","),strict=True))
        except csv.Error as exc:
            diagnostics.append(_diag("native_csv_invalid",str(exc),kind=kind,field=filename))
            continue
        if table.get("header",True):
            expected=[f["name"] for f in table["fields"]]
            if not parsed or parsed[0]!=expected:
                diagnostics.append(_diag("native_header_mismatch","Exact header labels and duplicate ordinals differ from selected contract",kind=kind,field=filename))
                continue
            parsed=parsed[1:]
        valid=[]
        for number,row in enumerate(parsed,2 if table.get("header",True) else 1):
            if len(row)!=len(table["fields"]):
                diagnostics.append(_diag("native_column_count","Returned row has an unexpected complete field count",kind=kind,row=number,field=filename))
            else:
                valid.append(row)
        rows[kind]=valid
        mappings[kind]=[]
        for ordinal,field in enumerate(table["fields"]):
            mapping={key:copy.deepcopy(value) for key,value in field.items()
                     if key in {"target_field","transform","value_map","null_rule","separator","relationship_key","revision"}}
            mapping["source_field_or_ordinal"]=ordinal
            mapping["native_contract_reference"]=copy.deepcopy(contract["native_contract_reference"])
            # Null tokens and Boolean tokens are explicit, never guessed.
            if "null_token" in field:
                token=field["null_token"]
                for row in rows[kind]:
                    if row[ordinal]==token:
                        row[ordinal]=None
            if "true_token" in field or "false_token" in field:
                mapping["transform"]="value_map"
                mapping["value_map"]={field.get("true_token","true"):True,field.get("false_token","false"):False}
            mappings[kind].append(mapping)
    normalized=normalize_records(rows,mappings,source_namespace)
    normalized["diagnostics"]=diagnostics+normalized["diagnostics"]
    normalized["valid"]=not any(d["severity"]=="error" for d in normalized["diagnostics"])
    normalized["native_receipts"]=receipts
    normalized["native_contract_sha256"]=sha256(canonical_json(contract))
    normalized["unselected_files"]=[{"file":name,"bytes":len(data),"sha256":sha256(data)}
                                     for name,data in files.items() if name not in {t["file"] for t in contract["tables"]}]
    return normalized

def reconcile_native(projected_snapshot, normalized_return, contract):
    """Compare every selected identity and declared canonical field after mapping."""
    _target_contract(contract)
    if not normalized_return.get("valid"):
        return {"format":"commons-audit-native-reconciliation/1","status":"invalid_return",
                "diagnostics":copy.deepcopy(normalized_return.get("diagnostics",[])),
                "matched":0,"missing":[],"added":[],"changed":[]}
    kinds={t["kind"] for t in contract["tables"]}
    expected={r["id"]:r for r in projected_snapshot["records"] if r["kind"] in kinds}
    actual={r["id"]:r for r in normalized_return["records"] if r["kind"] in kinds}
    fields={t["kind"]:[f["target_field"] for f in t["fields"] if f["target_field"] not in {"source_id","source_namespace","source_revision"}]
            for t in contract["tables"]}
    changed,matched=[],0
    for rid in sorted(set(expected)&set(actual)):
        a,b=expected[rid],actual[rid]
        differences=[]
        for field in fields[a["kind"]]:
            av,bv=a["payload"].get(field),b["payload"].get(field)
            if canonical_json(av)!=canonical_json(bv):
                differences.append({"field":field,"expected":copy.deepcopy(av),"returned":copy.deepcopy(bv)})
        if differences:
            changed.append({"id":rid,"kind":a["kind"],"differences":differences})
        else:
            matched+=1
    missing=[{"id":rid,"kind":expected[rid]["kind"]} for rid in sorted(set(expected)-set(actual))]
    added=[{"id":rid,"kind":actual[rid]["kind"]} for rid in sorted(set(actual)-set(expected))]
    return {"format":"commons-audit-native-reconciliation/1",
            "status":"match" if not(missing or added or changed) else "different",
            "matched":matched,"missing":missing,"added":added,"changed":changed,
            "expected_count":len(expected),"returned_count":len(actual),
            "target_contract_sha256":sha256(canonical_json(contract)),
            "source_selection_hash":projected_snapshot["projection"]["source_selection_hash"],
            "native_receipts":copy.deepcopy(normalized_return.get("native_receipts",[]))}

def main(argv=None):
    parser=argparse.ArgumentParser(description="Inspect, map, package and reconcile portable audit handoffs.")
    commands=parser.add_subparsers(dest="command",required=True)
    inspect=commands.add_parser("inspect")
    inspect.add_argument("archive")
    normalize=commands.add_parser("normalize")
    normalize.add_argument("rows_json")
    normalize.add_argument("--mappings")
    normalize.add_argument("--namespace",required=True)
    normalize.add_argument("--output",required=True)
    package=commands.add_parser("package")
    package.add_argument("snapshot")
    package.add_argument("--blobs",required=True,help="Content-addressed directory of <sha256> files")
    package.add_argument("--audience",required=True,help="JSON audience file")
    package.add_argument("--engagement",action="append",required=True)
    package.add_argument("--review-reference",required=True)
    package.add_argument("--output",required=True)
    receive=commands.add_parser("receive-plan")
    receive.add_argument("archive")
    receive.add_argument("--current",required=True)
    receive.add_argument("--receipts")
    receive.add_argument("--output",required=True)
    native=commands.add_parser("native-export")
    native.add_argument("projected_snapshot")
    native.add_argument("--contract",required=True)
    native.add_argument("--output",required=True,help="New output directory")
    returned=commands.add_parser("native-compare")
    returned.add_argument("projected_snapshot")
    returned.add_argument("--contract",required=True)
    returned.add_argument("--files",required=True)
    returned.add_argument("--namespace",required=True)
    returned.add_argument("--output",required=True)
    args=parser.parse_args(argv)
    def read_json(path):
        return _load_json(pathlib.Path(path).read_bytes(),path)
    def write_new(path,data):
        target=pathlib.Path(path)
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
    try:
        if args.command=="inspect":
            result=inspect_archive(pathlib.Path(args.archive).read_bytes())
        elif args.command=="normalize":
            result=normalize_records(read_json(args.rows_json),read_json(args.mappings) if args.mappings else [],args.namespace)
            write_new(args.output,canonical_json(result))
        elif args.command=="package":
            root=pathlib.Path(args.blobs).resolve()
            def resolve(digest):
                if not SHA_RE.fullmatch(digest):
                    raise ExchangeError("blob_hash","Invalid resolver hash")
                return (root/digest).read_bytes()
            data,manifest=build_handoff(read_json(args.snapshot),resolve,audience=read_json(args.audience),
                selected_engagement_ids=args.engagement,review_reference=args.review_reference)
            write_new(args.output,data)
            result={"file":str(pathlib.Path(args.output)),"bytes":len(data),"sha256":sha256(data),"bundle_id":manifest["bundle_id"]}
        elif args.command=="receive-plan":
            result=plan_receipt(read_json(args.current),read_handoff(pathlib.Path(args.archive).read_bytes()),
                                prior_receipts=read_json(args.receipts) if args.receipts else [])
            write_new(args.output,canonical_json(result))
        elif args.command=="native-export":
            rendered=export_native(read_json(args.projected_snapshot),read_json(args.contract))
            root=pathlib.Path(args.output)
            root.mkdir(parents=True,exist_ok=False)
            for name,data in rendered["files"].items():
                write_new(root/name,data)
            write_new(root/"native-manifest.json",canonical_json(rendered["manifest"]))
            result=rendered["manifest"]
        else:
            contract=read_json(args.contract)
            root=pathlib.Path(args.files)
            files={t["file"]:(root/t["file"]).read_bytes() for t in _target_contract(contract)["tables"] if (root/t["file"]).is_file()}
            normalized=normalize_native_files(files,contract,args.namespace)
            result=reconcile_native(read_json(args.projected_snapshot),normalized,contract)
            write_new(args.output,canonical_json(result))
        print(json.dumps(result,ensure_ascii=False,sort_keys=True))
        return 0
    except (ExchangeError,OSError,ValueError) as exc:
        result=exc.as_dict() if isinstance(exc,ExchangeError) else {"code":"operation_failed","message":str(exc)}
        print(json.dumps(result,ensure_ascii=False),file=sys.stderr)
        return 2

if __name__=="__main__":
    raise SystemExit(main())
