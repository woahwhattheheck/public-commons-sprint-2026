from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import html
import io
import json
import os
import re
import stat
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from offsite_records_storage_invoice_reconciliation import engine

SCHEMA = "tj.records-operator-workspace.v1"
FILE_LIMIT = 8 * 1024 * 1024
RESULT_LIMIT = 1024 * 1024
PAGE_BUDGET = 650 * 1024
TABLES = ("sites", "rates", "cartons", "events", "invoices")
LEDGER_TABLES = {"policy": ("sites", "rates"), "custody": ("cartons",), "services": ("events",), "invoices": ("invoices",)}
TABLE_LEDGER = {table: ledger for ledger, tables in LEDGER_TABLES.items() for table in tables}
ARRAY_NAMES = {"sites": "sites", "rates": "rates", "cartons": "cartons", "events": "events", "invoices": "rows"}
FIELDS = {
    "sites": ("site_ref", "active_from", "active_until"),
    "rates": ("charge_code", "unit", "scope", "rate_minor", "event_required", "effective_from", "effective_until", "pricing"),
    "cartons": ("carton_ref", "site_ref", "admitted_at", "terminated_at", "termination_kind", "evidence_ref", "evidence_sha256"),
    "events": ("event_id", "site_ref", "carton_ref", "charge_code", "occurred_at", "quantity", "unit", "evidence_ref", "evidence_sha256"),
    "invoices": ("row_id", "invoice_ref", "site_ref", "carton_ref", "event_id", "charge_code", "service_at", "quantity", "unit",
                 "rate_minor", "amount_minor", "evidence_ref", "evidence_sha256", "line_kind", "row_role", "credit_of",
                 "basis_row_ids", "billed_at", "billed_percent"),
}
NULLABLE = {"active_until", "effective_until", "terminated_at", "termination_kind", "site_ref", "carton_ref", "event_id", "credit_of", "billed_percent"}
PRICING_FIELDS = {"kind", "minimum_minor", "maximum_minor", "percent", "basis_scope", "basis_charge_codes", "tiers", "credit_method"}
REVIEW_STATUSES = {"open", "accepted", "dispute-prepared", "resolved-in-source", "revisit"}
ASSIGNMENT_STATUSES = {"planned", "ready", "in-transit", "received", "reconciled", "exception"}
CHECK_KINDS = ("manifest", "custody-transfer", "destination-receipt", "inventory-reconciliation", "access-handoff")
CHECK_STATUSES = {"pending", "accepted", "rejected"}
DEFAULT_COLUMNS = [
    {"name": "Invoice", "path": "/values/invoice_ref"}, {"name": "InvoiceLine", "path": "/values/row_id"},
    {"name": "ChargeCode", "path": "/values/charge_code"}, {"name": "Carton", "path": "/values/carton_ref"},
    {"name": "Quantity", "path": "/values/quantity"}, {"name": "Unit", "path": "/values/unit"},
    {"name": "BilledMinor", "path": "/values/amount_minor"}, {"name": "ExpectedMinor", "path": "/analysis/expectedAmountMinor"},
    {"name": "VarianceMinor", "path": "/analysis/varianceMinor"}, {"name": "EngineStates", "path": "/analysis/states"},
    {"name": "ReviewStatus", "path": "/analysis/reviewStatus"}, {"name": "Source", "path": "/_source/id"},
    {"name": "SourceSHA256", "path": "/_source/sha256"},
]
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DECIMAL_RE = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$")


class InputError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def identity(value):
    return digest(canonical(value).encode("utf-8"))


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise InputError("Duplicate JSON key: " + key)
        result[key] = value
    return result


def decode_json(raw):
    try:
        return json.loads(raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw,
                          object_pairs_hook=pairs, parse_float=str,
                          parse_constant=lambda value: (_ for _ in ()).throw(InputError("Nonfinite JSON number: " + value)))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InputError("Original UTF-8 JSON cannot be read: " + str(exc)) from exc


def obj(value, label):
    if type(value) is not dict:
        raise InputError(label + " must be an object")
    return value


def arr(value, label, limit=10000):
    if type(value) is not list or len(value) > limit:
        raise InputError(label + " must be an array within " + str(limit) + " entries")
    return value


def text(value, label, limit=160, optional=False):
    if optional and value is None:
        return ""
    if type(value) is not str or (not optional and not value.strip()) or len(value) > limit or "\x00" in value:
        raise InputError(label + " must be text within " + str(limit) + " characters")
    return value


def identifier(value, label):
    return text(value, label, 160)


def integer(value, label, minimum=0, maximum=engine.MAX_SAFE_INTEGER):
    if type(value) is not int or not minimum <= value <= maximum:
        raise InputError(label + " must be an integer within its declared bounds")
    return value


def unique(items, key, label):
    seen = set()
    for item in items:
        ref = identifier(obj(item, label).get(key), label + "." + key)
        if ref in seen:
            raise InputError("Duplicate " + label + " ID: " + ref)
        seen.add(ref)
    return items


def utc(value, label):
    try:
        return engine._utc(value, label)
    except engine.InputError as exc:
        raise InputError(str(exc)) from exc


def pointer(value, path, missing=None):
    if path == "":
        return value
    if type(path) is not str or not path.startswith("/"):
        raise InputError("Use an RFC6901 pointer beginning with /")
    if re.search(r"~(?![01])", path):
        raise InputError("Invalid JSON pointer escape")
    current = value
    for part in path.split("/")[1:]:
        if re.search(r"~(?![01])", part):
            raise InputError("Invalid JSON pointer escape")
        key = part.replace("~1", "/").replace("~0", "~")
        if type(current) is dict:
            if key not in current:
                return missing
            current = current[key]
        elif type(current) is list and re.fullmatch(r"0|[1-9][0-9]*", key):
            index = int(key)
            if index >= len(current):
                return missing
            current = current[index]
        else:
            return missing
    return current


def flat_get(value, field):
    current = value
    for key in field.split("."):
        if type(current) is not dict or key not in current:
            return None
        current = current[key]
    return current


def flat_has(value, field):
    current = value
    keys = field.split(".")
    for key in keys[:-1]:
        if type(current) is not dict or key not in current:
            return False
        current = current[key]
    return type(current) is dict and keys[-1] in current


def flat_set(value, field, new_value):
    current = value
    keys = field.split(".")
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        if type(current[key]) is not dict:
            raise InputError("Mapped field overlaps a non-object: " + field)
        current = current[key]
    current[keys[-1]] = copy.deepcopy(new_value)


def mapped_field(table, field):
    if type(field) is not str:
        return False
    if field in FIELDS[table]:
        return True
    return table == "rates" and field.startswith("pricing.") and field.split(".", 1)[1] in PRICING_FIELDS


def number_text(value, label, signed=False):
    if type(value) is int:
        value = str(value)
    if type(value) is not str or not DECIMAL_RE.fullmatch(value) or (not signed and value.startswith("-")):
        raise InputError(label + " needs exact decimal text, without separators, exponents or currency symbols")
    return value


def money(value, scale, digits, label, integral=False):
    raw = number_text(value, label, signed=integral)
    result = Fraction(raw) * (10 ** digits if scale == "major" else 1)
    if abs(result) > engine.MAX_SAFE_INTEGER:
        raise InputError(label + " exceeds original money limits")
    if integral:
        if result.denominator != 1:
            raise InputError(label + " has a fractional minor unit; correct the declared unit or original amount explicitly")
        return result.numerator
    if result < 0:
        raise InputError(label + " cannot be negative")
    return engine._fraction_text(result)


def boolean(value, label):
    if type(value) is bool:
        return value
    if type(value) is int and value in (0, 1):
        return bool(value)
    if value in ("true", "1"):
        return True
    if value in ("false", "0"):
        return False
    raise InputError(label + " needs true/false or exact 1/0")


def nested_json(value, label):
    if type(value) is str:
        try:
            return decode_json(value)
        except InputError as exc:
            raise InputError(label + " needs original JSON: " + str(exc)) from exc
    return copy.deepcopy(value)


def safe_relative(base, name):
    if type(name) is not str or not name or "\\" in name or "\x00" in name:
        raise InputError("Use a nonempty relative source path")
    relative = Path(name)
    if relative.is_absolute() or any(part in ("..", ".") for part in relative.parts):
        raise InputError("Source path must remain inside the saved workspace")
    root = base.resolve(strict=True)
    candidate = root / relative
    try:
        if not stat.S_ISREG(candidate.lstat().st_mode):
            raise InputError("Source must be a regular retained file: " + name)
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise InputError("Retained source cannot be opened: " + name) from exc
    return resolved


def file_bytes(base, descriptor, require_binding=True):
    desc = obj(descriptor, "source")
    path = safe_relative(base, desc.get("path"))
    if path.stat().st_size > FILE_LIMIT:
        raise InputError("Source exceeds the original 8 MiB per-file limit")
    raw = path.read_bytes()
    if len(raw) > FILE_LIMIT:
        raise InputError("Source changed beyond the per-file limit")
    actual = {"path": desc["path"], "sha256": digest(raw), "bytes": len(raw)}
    if require_binding:
        if not SHA_RE.fullmatch(str(desc.get("sha256", ""))) or desc.get("sha256") != actual["sha256"] or type(desc.get("bytes")) is not int or desc["bytes"] != actual["bytes"]:
            raise InputError("Retained source bytes or SHA256 differ: " + desc["path"])
    elif "sha256" in desc and desc["sha256"] != actual["sha256"] or "bytes" in desc and desc["bytes"] != actual["bytes"]:
        raise InputError("Retained reference identity differs: " + desc["path"])
    return raw, actual


def read_rows(raw, source):
    if source["format"] == "csv":
        try:
            body = raw.decode("utf-8-sig")
            csv.field_size_limit(FILE_LIMIT)
            reader = csv.reader(io.StringIO(body, newline=""), strict=True)
            headers = next(reader, None)
            if headers is None:
                raise InputError("A CSV source needs its original header, including an empty ledger")
            if any(not column for column in headers) or len(set(headers)) != len(headers):
                raise InputError("CSV headers must be nonempty and unique")
            rows = []
            for index, values in enumerate(reader):
                if len(values) != len(headers):
                    raise InputError("CSV row " + str(index + 2) + " has a different column count")
                rows.append(dict(zip(headers, values)))
                if len(rows) > 10000:
                    raise InputError("Source exceeds the original 10,000-row ledger limit")
            return rows, headers
        except (UnicodeDecodeError, csv.Error) as exc:
            raise InputError("Original UTF-8 CSV cannot be read: " + str(exc)) from exc
    if source["format"] == "json":
        value = decode_json(raw)
        selected = pointer(value, source.get("rowPath", ""))
        rows = arr(selected, "selected source rows")
        for row in rows:
            obj(row, "source row")
        headers = list(dict.fromkeys(key for row in rows for key in row))
        return rows, headers
    raise InputError("Source format must be csv or json")


def row_id(table, value, index):
    if table == "rates":
        return ":".join(str(value.get(key, "")) for key in ("charge_code", "unit", "scope", "effective_from")) or str(index)
    key = {"sites": "site_ref", "cartons": "carton_ref", "events": "event_id", "invoices": "row_id"}[table]
    return str(value.get(key, "row:" + str(index)))


def generation_evidence(ledger, descriptors, corrections):
    value = {"ledger": ledger, "sources": descriptors, "corrections": corrections}
    sha = identity(value)
    return {"evidence_ref": "ledger:" + ledger + ":" + sha[:24], "evidence_sha256": sha}


def scalar(value):
    if value is None:
        return ""
    if type(value) is bool:
        return "true" if value else "false"
    return canonical(value) if isinstance(value, (dict, list)) else str(value)


def csv_cell(value):
    rendered = scalar(value)
    if type(value) in (int, bool) or DECIMAL_RE.fullmatch(rendered):
        return rendered
    return "'" + rendered if re.match(r"^[\s]*[=+\-@]", rendered) else rendered


def csv_body(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow([csv_cell(value) for value in row])
    return out.getvalue()


def file_record(name, body, kind):
    raw = body.encode("utf-8")
    return {"name": name, "body": body, "contentType": kind, "bytes": len(raw), "sha256": digest(raw)}


def bounded(value):
    if len(canonical(value).encode("utf-8")) > RESULT_LIMIT:
        raise InputError("The complete native result exceeds 1 MiB; inspect a smaller page or use the full saved-source export")
    return value


class Records:
    def __init__(self, value=None, workspace_path=None, *, compare=True):
        options = {} if value is None else obj(value, "function input")
        allowed = {"periodId", "editionId", "view", "offset", "limit", "query", "id"}
        if set(options) - allowed:
            raise InputError("Unknown records input: " + ", ".join(sorted(set(options) - allowed)))
        selected_path = Path(workspace_path or "workspace.json")
        if selected_path.is_dir():
            selected_path = selected_path / "workspace.json"
        self.path = selected_path.resolve(strict=True)
        self.base = self.path.parent
        if self.path.stat().st_size > FILE_LIMIT:
            raise InputError("workspace.json exceeds 8 MiB")
        self.config = obj(decode_json(self.path.read_bytes()), "workspace")
        if self.config.get("schema") != SCHEMA:
            raise InputError("Use tj.records-operator-workspace.v1")
        self.title = text(self.config.get("title"), "workspace.title", 500)
        periods = unique(arr(self.config.get("periods"), "periods", 120), "id", "period")
        if not periods:
            raise InputError("At least one named period is required")
        for period in periods:
            unique(arr(period.get("editions"), "period.editions", 100), "id", "edition")
            if not period["editions"]:
                raise InputError("Each named period needs a retained edition")
        period_id = options.get("periodId", self.config.get("selectedPeriod"))
        self.period = next((item for item in periods if item["id"] == period_id), None)
        if self.period is None:
            raise InputError("Select an existing named period")
        edition_id = options.get("editionId", self.period.get("selectedEdition"))
        self.edition = next((item for item in self.period["editions"] if item["id"] == edition_id), None)
        if self.edition is None:
            raise InputError("Select an existing edition in the named period")
        self.view = options.get("view", "findings")
        if self.view not in (*TABLES, "sources", "findings", "transition", "changes", "requirements", "catalog", "reviews", "checks", "cooperative", "cooperative-basis", "input-errors", "customer-invoices"):
            raise InputError("Unknown records view")
        self.offset = integer(options.get("offset", 0), "offset", 0, 1000000)
        self.limit = integer(options.get("limit", 100), "limit", 1, 500)
        self.query = text(options.get("query", ""), "query", 300, optional=True).casefold()
        self.selected_id = options.get("id")
        if self.selected_id is not None:
            identifier(self.selected_id, "id")
        self.input_errors = []
        self.review_errors = []
        self.transition_errors = []
        self.source_records = []
        self.source_bindings = {}
        self.tables = {table: [] for table in TABLES}
        self.corrected = []
        self.corrected_ids = set()
        self.correction_index = defaultdict(list)
        self.omitted = []
        self.packet = None
        self.request = None
        self.request_sha = None
        self.findings = []
        self.finding_map = {}
        self.changes = []
        self.comparison = None
        self.current_reviews = {}
        self.stale_reviews = []
        self.review_items = []
        self.transition_rows = []
        self.transition_checks = []
        self.transition_summary = {}
        self.cooperative_rows = []
        self.cooperative_basis = []
        self.cooperative_summary = None
        self.requirement_rows = []
        self.catalog_rows = []
        self.reference_bindings = []
        self.columns = self._columns()
        self._load_inputs()
        self._compile()
        self._reviews()
        self._enrich_invoices()
        self._transition()
        self._cooperative()
        self._references()
        if compare and self.edition.get("compareToEdition"):
            self._compare()

    def error(self, code, message, **where):
        self.input_errors.append({"code": code, "message": str(message), **where})

    def _columns(self):
        customer = obj(self.config.get("customer", {}), "customer")
        supplied = customer.get("columns", [])
        selected = DEFAULT_COLUMNS if supplied == [] else arr(supplied, "customer.columns", 100)
        result, names = [], set()
        for item in selected:
            row = obj(item, "customer column")
            name = text(row.get("name"), "column.name", 160)
            path = text(row.get("path"), "column.path", 1000)
            pointer({}, path)
            if name in names:
                raise InputError("Customer column names must be unique")
            names.add(name)
            result.append({"name": name, "path": path})
        return result

    def _mapping(self, source):
        table = source["table"]
        mapping = obj(source.get("mapping", {}), "source.mapping")
        constants = obj(source.get("constants", {}), "source.constants")
        maps = obj(source.get("valueMaps", {}), "source.valueMaps")
        for field, column in mapping.items():
            if not mapped_field(table, field):
                raise InputError("Unsupported canonical field for " + table + ": " + field)
            text(column, "mapping column", 300)
        for field in constants:
            if not mapped_field(table, field):
                raise InputError("Unsupported constant field: " + field)
        if set(mapping) & set(constants):
            raise InputError("A mapping and constant cannot define the same field")
        for field, entries in maps.items():
            if not mapped_field(table, field):
                raise InputError("Unsupported value map field: " + field)
            obj(entries, "valueMap entries")
        scale = source.get("moneyScale")
        if table in ("rates", "invoices") and scale not in ("minor", "major"):
            raise InputError("Rates/invoices need an explicit moneyScale of minor or major")
        return mapping, constants, maps, identity({"table": table, "mapping": mapping, "constants": constants,
                                                 "valueMaps": maps, "moneyScale": scale})

    def _mapped(self, source, original, mapping, constants, maps):
        table = source["table"]
        result = {}
        if mapping:
            for field, column in mapping.items():
                if column not in original:
                    raise InputError("Mapped original column is absent: " + column)
                flat_set(result, field, original[column])
        else:
            for field in FIELDS[table]:
                if field in original:
                    result[field] = copy.deepcopy(original[field])
        for field, value in constants.items():
            if flat_has(result, field):
                raise InputError("Constant overlaps an original canonical field: " + field)
            flat_set(result, field, value)
        for field, entries in maps.items():
            if flat_has(result, field):
                raw = flat_get(result, field)
                key = scalar(raw)
                if key in entries:
                    flat_set(result, field, entries[key])
        return result

    def _corrections(self, source, index, mapped, mapping_sha, raw_sha):
        omitted = False
        applied = []
        for correction in self.correction_index.get((source["id"], index), []):
            if correction.get("sourceSha256") != source["sha256"] or correction.get("mappingSha256") != mapping_sha:
                raise InputError("Correction source/mapping changed; inspect the exact row before carrying it forward")
            identifier(correction.get("id"), "correction.id")
            text(correction.get("author"), "correction.author", 300)
            text(correction.get("note"), "correction.note", 8000)
            utc(correction.get("at"), "correction.at")
            field = correction.get("field")
            if field != "$omit" and not mapped_field(source["table"], field):
                raise InputError("Correction field is not part of this mapped table")
            before = omitted if field == "$omit" else flat_get(mapped, field)
            if canonical(before) != canonical(correction.get("before")):
                raise InputError("Correction before value differs from the current mapped cell")
            if field == "$omit":
                if type(correction.get("value")) is not bool:
                    raise InputError("Omission correction value must be boolean")
                omitted = correction["value"]
            else:
                flat_set(mapped, field, correction.get("value"))
            applied.append(copy.deepcopy(correction))
        self.corrected.extend(applied)
        self.corrected_ids.update(item["id"] for item in applied)
        return omitted, applied

    def _typed(self, table, mapped, source, evidence):
        row = copy.deepcopy(mapped)
        if "pricing" in row:
            row["pricing"] = nested_json(row["pricing"], "pricing")
        for field in list(row):
            if field in NULLABLE and row[field] == "":
                row[field] = None
        for field in NULLABLE & set(FIELDS[table]):
            row.setdefault(field, None)
        if table == "rates":
            row["event_required"] = boolean(row.get("event_required"), "event_required")
            pricing = obj(row.get("pricing", {"kind": "unit"}), "pricing")
            for key in ("tiers", "basis_charge_codes"):
                if key in pricing:
                    pricing[key] = nested_json(pricing[key], "pricing." + key)
            for key in ("minimum_minor", "maximum_minor"):
                if key in pricing and pricing[key] == "":
                    pricing[key] = None
                elif pricing.get(key) is not None:
                    pricing[key] = money(pricing[key], "minor", self.digits, "pricing." + key, integral=True)
            if "percent" in pricing:
                pricing["percent"] = number_text(pricing["percent"], "pricing.percent")
            if "tiers" in pricing:
                for tier in arr(pricing["tiers"], "pricing.tiers", 512):
                    obj(tier, "tier")
                    if tier.get("upto") is not None:
                        tier["upto"] = number_text(tier["upto"], "tier.upto")
                    tier["rate_minor"] = money(tier.get("rate_minor"), source["moneyScale"], self.digits, "tier.rate_minor")
            row["pricing"] = pricing
            if row.get("rate_minor") in ("", None) and pricing.get("kind") == "percentage":
                row["rate_minor"] = None
            else:
                row["rate_minor"] = money(row.get("rate_minor"), source["moneyScale"], self.digits, "rate_minor")
        if table in ("events", "invoices"):
            row["quantity"] = number_text(row.get("quantity"), "quantity")
        if table == "invoices":
            row["rate_minor"] = None if row.get("rate_minor") in ("", None) else money(row["rate_minor"], source["moneyScale"], self.digits, "rate_minor")
            row["amount_minor"] = money(row.get("amount_minor"), source["moneyScale"], self.digits, "amount_minor", integral=True)
            row["line_kind"] = row.get("line_kind") or "CHARGE"
            row["row_role"] = row.get("row_role") or "BILLED"
            row["basis_row_ids"] = nested_json(row.get("basis_row_ids") or [], "basis_row_ids")
            row["billed_at"] = row.get("billed_at") or row.get("service_at")
            if row.get("billed_percent") is not None:
                row["billed_percent"] = number_text(row["billed_percent"], "billed_percent")
        if table in ("cartons", "events", "invoices"):
            if row.get("evidence_ref") in ("", None):
                row["evidence_ref"] = evidence["evidence_ref"]
            if row.get("evidence_sha256") in ("", None):
                row["evidence_sha256"] = evidence["evidence_sha256"]
        return row

    def _project(self, source, originals, *, original_version=False):
        mapping, constants, maps, mapping_sha = self._mapping(source)
        rows = []
        for index, original in enumerate(originals):
            raw_sha = identity(original)
            meta = {"id": source["id"], "path": source["path"], "sha256": source["sha256"], "recordIndex": index,
                    "locator": "row " + str(index + (2 if source["format"] == "csv" else 1)),
                    "mappingSha256": mapping_sha, "rawRowSha256": raw_sha}
            record = {"id": "row:" + str(index), "table": source["table"], "values": None, "mapped": {},
                      "original": copy.deepcopy(original), "_source": meta, "omitted": False, "errors": []}
            try:
                mapped = self._mapped(source, original, mapping, constants, maps)
                record["mapped"] = mapped
                omitted, corrections = self._corrections(source, index, mapped, mapping_sha, raw_sha)
                record["omitted"] = omitted
                record["corrections"] = corrections
                if omitted:
                    self.omitted.append(meta)
                    record["id"] = row_id(source["table"], mapped, index)
                    rows.append(record)
                    continue
                evidence_sha = identity({"source": meta, "mapped": mapped, "corrections": corrections})
                evidence = {"evidence_ref": "row:" + evidence_sha[:32], "evidence_sha256": evidence_sha}
                typed = copy.deepcopy(mapped) if original_version else self._typed(source["table"], mapped, source, evidence)
                if original_version and corrections and source["table"] in ("cartons", "events", "invoices"):
                    typed.update(evidence)
                record["values"] = typed
                record["id"] = row_id(source["table"], typed, index)
            except (InputError, engine.InputError) as exc:
                record["errors"].append(str(exc))
                self.error("SOURCE_ROW_CORRECTION", str(exc), sourceId=source["id"], recordIndex=index)
            rows.append(record)
        self.tables[source["table"]].extend(rows)
        return rows, mapping_sha

    def _load_inputs(self):
        edition = self.edition
        try:
            utc(edition.get("capturedAt"), "edition.capturedAt")
            text(edition.get("sourceKind"), "edition.sourceKind", 300)
            corrections = unique(arr(edition.get("corrections", []), "edition.corrections", 20000), "id", "correction")
            for correction in corrections:
                source_id = identifier(correction.get("sourceId"), "correction.sourceId")
                index = integer(correction.get("recordIndex"), "correction.recordIndex", 0, 9999)
                self.correction_index[(source_id, index)].append(correction)
            if "requestSource" in edition:
                self._load_request()
                return
            ledgers = obj(edition.get("ledgers"), "edition.ledgers")
            if set(ledgers) != set(LEDGER_TABLES):
                raise InputError("Supply all four original ledger metadata objects")
            self.digits = integer(obj(ledgers["policy"], "policy").get("minor_unit_digits"), "minor_unit_digits", 0, 9)
            sources = unique(arr(edition.get("sources"), "edition.sources", 500), "id", "source")
            for source in sources:
                try:
                    table = source.get("table")
                    if table not in TABLES:
                        raise InputError("Select an original ledger table")
                    utc(source.get("capturedAt"), "source.capturedAt")
                    text(source.get("sourceKind"), "source.sourceKind", 300)
                    raw, binding = file_bytes(self.base, source)
                    if not re.fullmatch(r"captures/[0-9a-f]{64}\.(csv|json)", source["path"]) or Path(source["path"]).name.split(".")[0] != binding["sha256"]:
                        raise InputError("Use a content-addressed original CSV/JSON capture")
                    self.source_bindings[source["path"]] = binding
                    originals, columns = read_rows(raw, source)
                    projected, mapping_sha = self._project(source, originals)
                    self.source_records.append({**copy.deepcopy(source), "columns": columns, "rows": len(originals),
                                                "omittedRows": sum(row["omitted"] for row in projected),
                                                "rowErrors": sum(bool(row["errors"]) for row in projected),
                                                "mappingSha256": mapping_sha, "status": "retained"})
                except (InputError, engine.InputError, OSError) as exc:
                    self.error("SOURCE_IMPORT", str(exc), sourceId=source.get("id"))
                    self.source_records.append({**copy.deepcopy(source), "status": "correction-required", "error": str(exc)})
            known = {source["id"] for source in sources}
            for correction in corrections:
                if correction.get("sourceId") not in known:
                    self.error("CORRECTION_SOURCE_MISSING", "Correction references an absent source", correctionId=correction["id"])
                elif correction["id"] not in self.corrected_ids:
                    self.error("CORRECTION_NOT_APPLIED", "Correction row is absent or failed before application", correctionId=correction["id"])
            request = {"schema": engine.SCHEMA_V2}
            for ledger, tables in LEDGER_TABLES.items():
                generation = copy.deepcopy(obj(ledgers[ledger], "ledger metadata"))
                selected = [source for source in self.source_records if source.get("table") in tables]
                relevant = [item for item in corrections if item.get("sourceId") in {source["id"] for source in selected}]
                generation["evidence"] = generation_evidence(ledger, selected, relevant)
                for table in tables:
                    generation[ARRAY_NAMES[table]] = [row["values"] for row in self.tables[table] if not row["omitted"] and not row["errors"]]
                request[ledger] = generation
            self.request = request
        except (InputError, engine.InputError, OSError) as exc:
            self.error("LEDGER_SETUP", str(exc))

    def _load_request(self):
        raw, binding = file_bytes(self.base, self.edition["requestSource"])
        request = obj(decode_json(raw), "original request")
        version = request.get("schema")
        if version not in (engine.SCHEMA, engine.SCHEMA_V2):
            raise InputError("Retain an original V1 or V2 reconciliation request")
        self.digits = request.get("policy", {}).get("minor_unit_digits", 2)
        self.source_bindings[binding["path"]] = binding
        self.request = copy.deepcopy(request)
        for table in TABLES:
            ledger = TABLE_LEDGER[table]
            generation = obj(request.get(ledger), "original " + ledger)
            originals = arr(generation.get(ARRAY_NAMES[table]), "original " + table)
            source = {**binding, "id": "request:" + table, "table": table, "format": "json", "moneyScale": "minor",
                      "capturedAt": generation.get("captured_at"), "sourceKind": self.edition["sourceKind"],
                      "rowPath": "/" + ledger + "/" + ARRAY_NAMES[table], "mapping": {}, "constants": {}, "valueMaps": {}}
            projected, mapping_sha = self._project(source, originals, original_version=True)
            self.source_records.append({**source, "rows": len(originals), "columns": list(dict.fromkeys(key for row in originals for key in row)),
                                        "mappingSha256": mapping_sha, "status": "retained-original-request"})
            self.request[ledger][ARRAY_NAMES[table]] = [row["values"] for row in projected if not row["omitted"] and not row["errors"]]
        for ledger, tables in LEDGER_TABLES.items():
            changes = [item for item in self.corrected if item["sourceId"] in {"request:" + table for table in tables}]
            if changes:
                self.request[ledger]["evidence"] = generation_evidence(ledger, [binding], changes)
        for correction in self.edition.get("corrections", []):
            if correction.get("id") not in self.corrected_ids:
                self.error("CORRECTION_NOT_APPLIED", "Original-request correction did not bind to a retained row", correctionId=correction.get("id"))

    def _compile(self):
        if self.input_errors or self.request is None:
            return
        try:
            self.request = engine.normalize_request(self.request)
            roots = engine.trusted_roots_for_request(self.request)
            mode = self.edition.get("mode", engine.MODE_HISTORICAL)
            if mode == engine.MODE_CURRENT:
                self.packet = engine.compile_current(self.request, roots)
            elif mode == engine.MODE_HISTORICAL:
                at = utc(self.edition.get("evaluatedAt"), "edition.evaluatedAt")
                self.packet = engine.compile_historical(self.request, roots, at)
            else:
                raise InputError("Select original current or historical review mode")
            self.request_sha = self.packet["request_sha256"]
            for finding in self.packet["result"]["findings"]:
                sha = engine.sha256_json(finding)
                row = {**copy.deepcopy(finding), "id": finding["finding_id"], "sha256": sha,
                       "currentReview": None, "staleReviewCount": 0}
                self.findings.append(row)
                self.finding_map[finding["finding_id"]] = row
        except (InputError, engine.InputError) as exc:
            self.error("ENGINE_INPUT", str(exc))

    def _reviews(self):
        reviews = arr(self.config.get("reviews", []), "reviews", 50000)
        for index, review in enumerate(reviews):
            try:
                obj(review, "review")
                if review.get("periodId") != self.period["id"]:
                    continue
                identifier(review.get("findingId"), "review.findingId")
                text(review.get("owner"), "review.owner", 300)
                text(review.get("note", ""), "review.note", 8000, optional=True)
                utc(review.get("at"), "review.at")
                if review.get("status") not in REVIEW_STATUSES:
                    raise InputError("Unsupported review disposition")
                evidence = arr(review.get("evidence", []), "review.evidence", 100)
                for item in evidence:
                    obj(item, "review evidence")
                    text(item.get("sourceId", ""), "evidence.sourceId", 160, optional=True)
                    text(item.get("reference"), "evidence.reference", 2000)
                finding = self.finding_map.get(review["findingId"])
                current = bool(finding and review.get("editionId") == self.edition["id"] and review.get("requestSha256") == self.request_sha and review.get("findingSha256") == finding["sha256"])
                retained = {**copy.deepcopy(review), "index": index, "applies": current}
                self.review_items.append(retained)
                if current:
                    previous = self.current_reviews.get(review["findingId"])
                    if previous is None or (review["at"], index) >= (previous["at"], previous["index"]):
                        self.current_reviews[review["findingId"]] = retained
                else:
                    self.stale_reviews.append(retained)
                    if finding:
                        finding["staleReviewCount"] += 1
            except InputError as exc:
                self.review_errors.append({"index": index, "message": str(exc)})
        for ref, review in self.current_reviews.items():
            self.finding_map[ref]["currentReview"] = review

    def _enrich_invoices(self):
        for record in self.tables["invoices"]:
            if record["values"] is None:
                continue
            row = record["values"]
            finding = self.finding_map.get("invoice:" + str(row.get("row_id")))
            if finding:
                expected = (finding.get("calculation") or {}).get("expected_amount_minor")
                if self.request and self.request["schema"] == engine.SCHEMA:
                    rate = engine._rate_for(self.request["policy"], row["charge_code"], row["unit"], row["service_at"])
                    if rate:
                        expected = engine._checked_product(row["quantity"], rate["rate_minor"])
                review = finding["currentReview"]
                record["analysis"] = {"findingId": finding["id"], "findingSha256": finding["sha256"],
                                      "expectedAmountMinor": expected,
                                      "varianceMinor": None if expected is None else row["amount_minor"] - expected,
                                      "states": finding["states"], "calculation": finding.get("calculation"),
                                      "reviewStatus": review["status"] if review else "unreviewed",
                                      "reviewOwner": review["owner"] if review else None,
                                      "reviewNote": review["note"] if review else None}
            else:
                record["analysis"] = {"findingId": None, "expectedAmountMinor": None, "varianceMinor": None,
                                      "states": ["REFERENCE_ONLY"] if row.get("row_role") == "REFERENCE" else ["CALCULATION_UNAVAILABLE"],
                                      "reviewStatus": "unreviewed"}


    def _transition(self):
        transition = obj(self.config.get("transition", {"waves": [], "assignments": [], "checks": []}), "transition")
        waves = unique(arr(transition.get("waves", []), "transition.waves", 1000), "id", "wave")
        wave_map = {}
        for wave in waves:
            try:
                text(wave.get("label"), "wave.label", 500)
                text(wave.get("owner", ""), "wave.owner", 300, optional=True)
                text(wave.get("notes", ""), "wave.notes", 8000, optional=True)
                if wave.get("targetAt"):
                    utc(wave["targetAt"], "wave.targetAt")
                wave_map[wave["id"]] = copy.deepcopy(wave)
            except InputError as exc:
                self.transition_errors.append({"waveId": wave["id"], "message": str(exc)})
        selected = lambda item: item.get("periodId") == self.period["id"] and item.get("editionId") == self.edition["id"]
        assignments = defaultdict(list)
        for index, assignment in enumerate(arr(transition.get("assignments", []), "transition.assignments", 10000)):
            try:
                obj(assignment, "assignment")
                if not selected(assignment):
                    continue
                carton_ref = identifier(assignment.get("cartonRef"), "assignment.cartonRef")
                wave_id = identifier(assignment.get("waveId"), "assignment.waveId")
                if wave_id not in wave_map:
                    raise InputError("Assignment wave is absent")
                if assignment.get("status") not in ASSIGNMENT_STATUSES:
                    raise InputError("Unsupported assignment status")
                for field, limit in (("destination", 1000), ("owner", 300), ("notes", 8000)):
                    text(assignment.get(field, ""), "assignment." + field, limit, optional=True)
                assignments[carton_ref].append(copy.deepcopy(assignment))
            except InputError as exc:
                self.transition_errors.append({"assignmentIndex": index, "message": str(exc)})
        latest_checks = {}
        for index, check in enumerate(arr(transition.get("checks", []), "transition.checks", 20000)):
            try:
                obj(check, "transition check")
                if not selected(check):
                    continue
                if check.get("waveId") not in wave_map or check.get("kind") not in CHECK_KINDS or check.get("status") not in CHECK_STATUSES:
                    raise InputError("Transition check must bind an existing wave and supported kind/status")
                text(check.get("owner"), "check.owner", 300)
                text(check.get("note", ""), "check.note", 8000, optional=True)
                utc(check.get("at"), "check.at")
                evidence = arr(check.get("evidence", []), "check.evidence", 100)
                for item in evidence:
                    obj(item, "check evidence")
                    text(item.get("reference"), "check.evidence.reference", 2000)
                key = (check["waveId"], check["kind"])
                retained = {**copy.deepcopy(check), "index": index}
                previous = latest_checks.get(key)
                if previous is None or (check["at"], index) >= (previous["at"], previous["index"]):
                    latest_checks[key] = retained
                self.transition_checks.append(retained)
            except InputError as exc:
                self.transition_errors.append({"checkIndex": index, "message": str(exc)})
        known_cartons = set()
        wave_counts = Counter()
        unassigned = conflicts = 0
        for record in self.tables["cartons"]:
            if record["omitted"] or record["values"] is None:
                continue
            carton = record["values"]
            ref = carton.get("carton_ref")
            known_cartons.add(ref)
            candidates = assignments.get(ref, [])
            findings = []
            basis_at = self.request["policy"]["period_end"] if self.request else self.edition.get("capturedAt")
            try:
                available = engine._carton_active(carton, basis_at)
            except (engine.InputError, KeyError):
                available = False
            if not candidates and available:
                unassigned += 1
                findings.append("UNASSIGNED_CARTON")
            elif not candidates:
                findings.append("OUTSIDE_ACTIVE_CUSTODY_AT_REVIEW_BOUNDARY")
            elif len(candidates) > 1:
                conflicts += 1
                findings.append("MULTIPLE_TRANSITION_ASSIGNMENTS")
            assignment = candidates[0] if len(candidates) == 1 else None
            wave = wave_map.get(assignment["waveId"]) if assignment else None
            if assignment:
                if not available:
                    findings.append("CARTON_NOT_AVAILABLE_AT_REVIEW_BOUNDARY")
                if carton.get("termination_kind") == "DESTROYED":
                    findings.append("DESTRUCTION_RECORDED_IN_ORIGINAL_CUSTODY")
                wave_counts[assignment["waveId"]] += 1
                if not assignment.get("owner") and not wave.get("owner"):
                    findings.append("TRANSITION_OWNER_MISSING")
                if not assignment.get("destination"):
                    findings.append("DESTINATION_MISSING")
                if assignment["status"] == "exception":
                    findings.append("OPERATOR_RECORDED_EXCEPTION")
            self.transition_rows.append({
                "id": str(ref), "carton": copy.deepcopy(carton), "_source": copy.deepcopy(record["_source"]),
                "assignment": assignment, "wave": wave, "findings": findings,
                "availableAtReviewBoundary": available, "availabilityBasisAt": basis_at,
            })
        for ref, candidates in assignments.items():
            if ref not in known_cartons:
                self.transition_errors.append({"cartonRef": ref, "message": "Transition assignment refers to a carton absent from the selected retained inventory"})
        wave_report = []
        for wave in wave_map.values():
            checks = {kind: latest_checks.get((wave["id"], kind)) for kind in CHECK_KINDS}
            missing = [kind for kind, item in checks.items() if item is None or item["status"] != "accepted"]
            evidence_missing = [kind for kind, item in checks.items() if item and item["status"] == "accepted" and not item.get("evidence")]
            assignment_issues = [row["id"] for row in self.transition_rows if (row["assignment"] or {}).get("waveId") == wave["id"] and row["findings"]]
            wave_report.append({**wave, "assignedCartons": wave_counts[wave["id"]], "assignmentIssues": assignment_issues,
                                "checks": checks, "pendingOrRejected": missing, "acceptedWithoutEvidence": evidence_missing,
                                "acceptanceComplete": not missing and not evidence_missing and not assignment_issues and bool(wave_counts[wave["id"]])})
        self.transition_summary = {"waves": wave_report, "cartons": len(known_cartons), "unassigned": unassigned,
                                   "multipleAssignments": conflicts, "errors": self.transition_errors,
                                   "completeWaves": sum(wave["acceptanceComplete"] for wave in wave_report),
                                   "interpretation": "Named operator planning/acceptance; original custody records remain unchanged."}

    def _cooperative(self):
        settings = self.config.get("cooperative")
        if settings is None:
            return
        if self.input_errors or not self.packet or self.packet["result"]["overall_state"] == "HOLD":
            self.cooperative_summary = {"complete": False, "rows": [], "months": [],
                "errors": [{"code": "LEDGER_CALCULATION_UNAVAILABLE", "message": "Correct the selected ledger inputs before preparing monthly amounts"}]}
            return
        errors = []
        try:
            c = obj(settings, "cooperative")
            percent = number_text(c.get("percent"), "cooperative.percent")
            rounding = engine._rounding_mode(c.get("roundingMode"))
            if c.get("creditTreatment") not in ("NET_BILLED", "EXCLUDE_CREDITS"):
                raise InputError("Select the actual cooperative credit treatment")
            zone_name = text(c.get("reportingTimeZone"), "cooperative.reportingTimeZone", 160)
            try:
                zone = ZoneInfo(zone_name)
            except (ValueError, ZoneInfoNotFoundError) as exc:
                raise InputError("The explicit reporting timezone is unavailable: " + zone_name) from exc
            included = arr(c.get("includedChargeCodes"), "cooperative.includedChargeCodes", 512)
            if not included or any(type(code) is not str for code in included) or len(set(included)) != len(included):
                raise InputError("Declare distinct included charge codes, with tax excluded as required by the actual contract")
            agency_map = {}
            for assignment in arr(c.get("agencyAssignments"), "cooperative.agencyAssignments", 10000):
                obj(assignment, "agency assignment")
                invoice = identifier(assignment.get("invoiceRef"), "agency.invoiceRef")
                agency = {"agencyId": text(assignment.get("agencyId", ""), "agency.agencyId", 160, optional=True),
                          "agencyName": text(assignment.get("agencyName", ""), "agency.agencyName", 500, optional=True)}
                if invoice in agency_map and agency_map[invoice] != agency:
                    raise InputError("One original invoice has conflicting agency assignments")
                agency_map[invoice] = agency
            period_start = self.request["policy"]["period_start"]
            period_end = self.request["policy"]["period_end"]
            def month_coverage(month):
                year, number = (int(part) for part in month.split("-"))
                try:
                    start_local = datetime(year, number, 1, tzinfo=zone)
                    end_local = datetime(year + (number == 12), 1 if number == 12 else number + 1, 1, tzinfo=zone)
                    start_utc = start_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    end_utc = end_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                except (ValueError, OverflowError) as exc:
                    raise InputError("Reporting month cannot be represented in its declared timezone") from exc
                return {"reportingTimeZone": zone_name, "monthStart": start_utc, "monthEndExclusive": end_utc,
                        "sourcePeriodStart": period_start, "sourcePeriodEndExclusive": period_end,
                        "complete": period_start <= start_utc and period_end >= end_utc}
            grouped = defaultdict(list)
            excluded_credits = []
            excluded_codes = Counter()
            outside_period = []
            for record in self.tables["invoices"]:
                if record["omitted"] or record["values"] is None:
                    continue
                row = record["values"]
                if row.get("row_role", "BILLED") != "BILLED":
                    continue
                if row["charge_code"] not in included:
                    excluded_codes[row["charge_code"]] += 1
                    continue
                if row.get("line_kind") == "CREDIT" and c["creditTreatment"] == "EXCLUDE_CREDITS":
                    excluded_credits.append(row["row_id"])
                    continue
                at = utc(row.get("billed_at", row["service_at"]), "billed_at")
                if not (self.request["policy"]["period_start"] <= at < self.request["policy"]["period_end"]):
                    outside_period.append(row["row_id"])
                    continue
                month = datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).astimezone(zone).strftime("%Y-%m")
                agency = agency_map.get(row["invoice_ref"], {"agencyId": "", "agencyName": ""})
                # Missing IDs remain distinct by original invoice, never an invented agency.
                key = (month, agency["agencyId"], agency["agencyName"], row["invoice_ref"] if not agency["agencyId"] else "")
                grouped[key].append(row)
                self.cooperative_basis.append({"month": month, **agency, "invoiceRef": row["invoice_ref"],
                                               "rowId": row["row_id"], "chargeCode": row["charge_code"],
                                               "lineKind": row.get("line_kind", "CHARGE"), "amountMinor": row["amount_minor"],
                                               "sourceId": record["_source"]["id"], "sourceSha256": record["_source"]["sha256"]})
            for key, rows in sorted(grouped.items()):
                month, agency_id, agency_name, unassigned_invoice = key
                calculated = engine.calculate_percentage_fee([{"row_id": row["row_id"], "amount_minor": row["amount_minor"]} for row in rows],
                                                             percent, rounding)
                findings = []
                coverage = month_coverage(month)
                if not coverage["complete"]:
                    findings.append("PARTIAL_REPORTING_MONTH_SOURCE")
                if not agency_id or not agency_name:
                    findings.append("AGENCY_ID_OR_NAME_MISSING")
                if calculated["basis_amount_minor"] < 0:
                    findings.append("NEGATIVE_NET_SALES_CREDIT_POLICY_REVIEW")
                if not calculated["complete"]:
                    findings.append("FRACTIONAL_ADMIN_FEE_REVIEW")
                unresolved = [row["row_id"] for row in rows if not self.finding_map.get("invoice:" + row["row_id"]) or
                              self.finding_map["invoice:" + row["row_id"]]["states"] != ["MATCHED_REFERENCE"]]
                if unresolved:
                    findings.append("BASIS_INVOICES_REQUIRE_REVIEW")
                self.cooperative_rows.append({"id": identity(key), "month": month, "agencyId": agency_id or None,
                                              "agencyName": agency_name or None, "unassignedInvoiceRef": unassigned_invoice or None,
                                              "netSalesMinor": calculated["basis_amount_minor"], "adminFeeMinor": calculated["amount_minor"],
                                              "percent": percent, "calculation": calculated, "findings": findings,
                                              "coverage": coverage,
                                              "unresolvedInvoiceRows": unresolved, "complete": not findings})
            remittances = defaultdict(list)
            for item in arr(c.get("remittances", []), "cooperative.remittances", 1000):
                obj(item, "remittance")
                month = text(item.get("month"), "remittance.month", 7)
                if not re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", month):
                    raise InputError("Remittance month must be YYYY-MM")
                amount = integer(item.get("amountMinor"), "remittance.amountMinor", -engine.MAX_SAFE_INTEGER)
                number = text(item.get("checkWireNumber"), "remittance.checkWireNumber", 300)
                remittances[month].append({"checkWireNumber": number, "amountMinor": amount})
            monthly = []
            for month in sorted({row["month"] for row in self.cooperative_rows} | set(remittances)):
                groups = [row for row in self.cooperative_rows if row["month"] == month]
                fees = [row["adminFeeMinor"] for row in groups]
                complete = bool(groups) and all(value is not None for value in fees)
                due = engine._checked_sum(fees) if complete else None
                retained = remittances.get(month, [])
                remitted = engine._checked_sum(item["amountMinor"] for item in retained) if retained else None
                monthly.append({"month": month, "feeMinor": due, "remittedMinor": remitted,
                                "varianceMinor": None if due is None or remitted is None else engine._checked_sum([remitted, -due]),
                                "coverage": month_coverage(month), "calculationComplete": complete,
                                "remittances": retained, "reportComplete": bool(groups) and all(row["complete"] for row in groups),
                                "remittanceRecorded": bool(retained)})
            for name in ("supplier", "contractId", "leadAgencyId"):
                if not c.get(name):
                    errors.append({"code": "REPORT_HEADER_MISSING", "field": name, "message": "Supply the actual monthly report header"})
                elif type(c[name]) is not str:
                    raise InputError("Cooperative report headers must be text")
            self.cooperative_summary = {"percent": percent, "roundingMode": rounding, "creditTreatment": c["creditTreatment"],
                                        "reportingTimeZone": zone_name, "groups": len(self.cooperative_rows),
                                        "rows": self.cooperative_rows, "months": monthly, "errors": errors,
                                        "excludedChargeCodes": dict(excluded_codes), "excludedCreditRowIds": excluded_credits,
                                        "outsidePeriodExcludedCount": len(outside_period),
                                        "complete": not errors and bool(self.cooperative_rows) and all(row["complete"] for row in self.cooperative_rows),
                                        "interpretation": "Prepared amounts use the selected declared source period. A complete monthly report also needs the entire calendar month in its declared reporting timezone; partial known subtotals remain visible. No filing or remittance performed."}
        except (InputError, engine.InputError, KeyError) as exc:
            self.cooperative_summary = {"complete": False, "errors": [{"code": "COOPERATIVE_INPUT", "message": str(exc)}],
                                        "rows": self.cooperative_rows, "months": []}

    def _references(self):
        requirements = obj(self.config.get("requirements", {}), "requirements")
        if requirements.get("path"):
            try:
                raw, binding = file_bytes(self.base, requirements, require_binding=False)
                self.reference_bindings.append(binding)
                original = obj(decode_json(raw), "technical question source")
                questions = arr(original.get("questions"), "technical questions", 5000)
                responses = {}
                for response in arr(requirements.get("responses", []), "requirement responses", 20000):
                    obj(response, "requirement response")
                    ref = str(response.get("id"))
                    status = response.get("status", "unanswered")
                    if status not in ("unanswered", "draft", "reviewed"):
                        raise InputError("Unsupported requirement response state")
                    text(response.get("response", ""), "requirement response", 30000, optional=True)
                    text(response.get("owner", ""), "requirement owner", 300, optional=True)
                    if status == "reviewed" and (not response.get("owner") or not response.get("at")):
                        raise InputError("Reviewed answers need their actual reviewer and time")
                    if response.get("at"):
                        utc(response["at"], "response.at")
                    arr(response.get("evidence", []), "response.evidence", 100)
                    responses[ref] = copy.deepcopy(response)
                known = set()
                for question in questions:
                    obj(question, "technical question")
                    ref = str(question.get("id"))
                    if ref in known:
                        raise InputError("Duplicate original question ID")
                    known.add(ref)
                    self.requirement_rows.append({"id": ref, "original": copy.deepcopy(question),
                                                  "response": responses.get(ref), "source": binding})
                unknown = set(responses) - known
                if unknown:
                    self.review_errors.append({"message": "Requirement responses refer to absent original question IDs", "ids": sorted(unknown)})
            except (InputError, OSError) as exc:
                self.review_errors.append({"message": "Original requirement source: " + str(exc)})
        catalog = obj(self.config.get("catalog", {}), "catalog")
        if catalog.get("path"):
            try:
                raw, binding = file_bytes(self.base, catalog, require_binding=False)
                self.reference_bindings.append(binding)
                original = obj(decode_json(raw), "original cost catalog")
                for index, item in enumerate(arr(original.get("items"), "cost catalog", 10000)):
                    obj(item, "catalog item")
                    self.catalog_rows.append({"id": str(item.get("sheet", "")) + ":" + str(item.get("row", index)),
                                              "original": copy.deepcopy(item), "source": binding})
            except (InputError, OSError) as exc:
                self.review_errors.append({"message": "Original cost catalog: " + str(exc)})

    def _compare(self):
        ref = self.edition["compareToEdition"]
        if ref == self.edition["id"]:
            self.comparison = {"comparableScope": False, "reason": "An edition cannot compare to itself"}
            return
        try:
            previous = Records({"periodId": self.period["id"], "editionId": ref}, self.path, compare=False)
            if not self.request or not previous.request or self.input_errors or previous.input_errors:
                self.comparison = {"comparableScope": False, "reason": "Correct both original ledger inputs before comparison"}
                return
            keys = ("entity_ref", "provider_ref", "currency", "period_start", "period_end")
            current_scope = {key: self.request["policy"].get(key) for key in keys}
            previous_scope = {key: previous.request["policy"].get(key) for key in keys}
            if current_scope != previous_scope:
                self.comparison = {"comparableScope": False, "reason": "Retained account/provider/currency/period scopes differ",
                                   "from": previous_scope, "to": current_scope}
                return
            totals = Counter()
            for table in TABLES:
                def index_rows(records):
                    result = {}
                    for record in records:
                        if record["omitted"] or record["values"] is None:
                            continue
                        value = {key: val for key, val in record["values"].items() if key not in ("evidence_ref", "evidence_sha256")}
                        if record["id"] in result and result[record["id"]] != value:
                            raise InputError("Duplicate exact record identity prevents unambiguous comparison: " + record["id"])
                        result[record["id"]] = value
                    return result
                old = index_rows(previous.tables[table])
                new = index_rows(self.tables[table])
                for identifier_ in sorted(set(old) | set(new)):
                    before, after = old.get(identifier_), new.get(identifier_)
                    if before is None:
                        state = "added"
                    elif after is None:
                        state = "removed"
                    elif canonical(before) != canonical(after):
                        state = "changed"
                    else:
                        totals["unchanged"] += 1
                        continue
                    totals[state] += 1
                    fields = sorted(set(before or {}) | set(after or {}))
                    changed_fields = [field for field in fields if canonical((before or {}).get(field)) != canonical((after or {}).get(field))]
                    self.changes.append({"id": table + ":" + identifier_, "table": table, "recordId": identifier_,
                                         "state": state, "before": before, "after": after, "changedFields": changed_fields})
            self.comparison = {"comparableScope": True, "fromEdition": ref, "toEdition": self.edition["id"],
                               "counts": dict(totals), "fromSummary": previous.packet["result"]["summary"] if previous.packet else None,
                               "toSummary": self.packet["result"]["summary"] if self.packet else None,
                               "interpretation": "Same named period and exact business IDs; removed rows are source changes, not a destruction or cancellation claim."}
        except (InputError, engine.InputError, OSError) as exc:
            self.comparison = {"comparableScope": False, "errorCode": "COMPARISON_INPUT", "reason": str(exc)}


    def report(self, customer=False):
        result = self.packet["result"] if self.packet else None
        counts = {table: sum(not row["omitted"] and row["values"] is not None for row in self.tables[table]) for table in TABLES}
        invoices = [record["values"] for record in self.tables["invoices"] if record["values"] is not None and not record["omitted"]]
        counts.update({"billedRows": sum(row.get("row_role", "BILLED") == "BILLED" for row in invoices),
                       "referenceRows": sum(row.get("row_role", "BILLED") == "REFERENCE" for row in invoices),
                       "findings": len(self.findings),
                       "reviewRequired": sum(finding["states"] != ["MATCHED_REFERENCE"] for finding in self.findings)})
        review_counts = dict(Counter(review["status"] for review in self.current_reviews.values()))
        transition = {"cartons": self.transition_summary.get("cartons", 0),
                      "unassigned": self.transition_summary.get("unassigned", 0),
                      "multipleAssignments": self.transition_summary.get("multipleAssignments", 0),
                      "completeWaves": self.transition_summary.get("completeWaves", 0),
                      "waveCount": len(self.transition_summary.get("waves", [])),
                      "waves": [{"id": wave["id"], "label": wave["label"], "owner": wave.get("owner"),
                                 "targetAt": wave.get("targetAt"), "assignedCartons": wave["assignedCartons"],
                                 "acceptanceComplete": wave["acceptanceComplete"],
                                 "pendingOrRejected": wave["pendingOrRejected"],
                                 "acceptedWithoutEvidence": wave["acceptedWithoutEvidence"]}
                                for wave in self.transition_summary.get("waves", [])[:100]],
                      "errorCount": len(self.transition_errors), "errors": self.transition_errors[:30]}
        cooperative = None
        if self.cooperative_summary is not None:
            cooperative = {key: value for key, value in self.cooperative_summary.items()
                           if key not in ("rows", "excludedCreditRowIds")}
            cooperative["excludedCreditCount"] = len(self.cooperative_summary.get("excludedCreditRowIds", []))
            cooperative["basisRowCount"] = len(self.cooperative_basis)
            cooperative["groupCount"] = len(self.cooperative_rows)
        requirements = {"total": len(self.requirement_rows),
                        "answered": sum(bool((row["response"] or {}).get("response")) for row in self.requirement_rows),
                        "reviewed": sum((row["response"] or {}).get("status") == "reviewed" for row in self.requirement_rows)}
        reconciliation = {
            "status": "INPUT_CORRECTION_REQUIRED" if self.input_errors else result["overall_state"] if result else "INPUT_CORRECTION_REQUIRED",
            "calculationAvailable": bool(result and result["overall_state"] != "HOLD"),
            "requestSha256": self.request_sha, "packetSha256": self.packet["packet_sha256"] if self.packet else None,
            "mode": self.packet["mode"] if self.packet else self.edition.get("mode"),
            "evaluatedAt": self.packet["evaluated_at"] if self.packet else self.edition.get("evaluatedAt"),
            "summary": result["summary"] if result else None,
            "holdReasons": result["hold_reasons"] if result else [],
            "interpretation": "Source reconciliation and named operator decisions; no AP posting, payment, savings or actual transfer is asserted.",
        }
        output = {
            "workspace": {"title": self.title, "periodCount": len(self.config["periods"]),
                          "editionCount": sum(len(period["editions"]) for period in self.config["periods"])},
            "period": {"id": self.period["id"], "label": self.period.get("label", self.period["id"])},
            "edition": {key: self.edition.get(key) for key in ("id", "label", "capturedAt", "sourceKind")},
            "input": {"sourceCount": len(self.source_bindings), "sourceBytes": sum(item["bytes"] for item in self.source_bindings.values()),
                      "tableSourceCount": len(self.source_records), "correctionCount": len(self.corrected),
                      "omittedRows": len(self.omitted), "errorCount": len(self.input_errors), "errors": self.input_errors[:50],
                      "referenceFiles": self.reference_bindings,
                      "sourceIdentity": identity(list(self.source_bindings.values()))},
            "reconciliation": reconciliation, "counts": counts,
            "reviews": {"current": len(self.current_reviews), "stale": len(self.stale_reviews), "byStatus": review_counts,
                        "errorCount": len(self.review_errors), "errors": self.review_errors[:30]},
            "comparison": self.comparison, "transition": transition, "cooperative": cooperative,
            "requirements": requirements,
            "catalog": {"total": len(self.catalog_rows),
                        "priced": sum(row["original"].get("unitPrice") is not None for row in self.catalog_rows)},
            "customerColumns": self.columns,
            "customerMapping": self.customer_mapping(),
        }
        if customer:
            output["input"].pop("referenceFiles", None)
            output["input"]["errors"] = [{**{key: item[key] for key in ("code", "sourceId", "recordIndex") if key in item},
                "message": "Original input requires an operator correction; detailed source errors are retained in the operator delivery."}
                for item in self.input_errors[:50]]
            output["reviews"].pop("errors", None)
            output["transition"].pop("errors", None)
            if output["comparison"] and output["comparison"].get("errorCode"):
                output["comparison"] = {**output["comparison"],
                    "reason": "The original comparison input requires operator inspection; detailed source errors are retained in the operator delivery."}
        return output

    def page(self):
        views = {**self.tables, "sources": self.source_records, "findings": self.findings, "transition": self.transition_rows,
                 "changes": self.changes, "requirements": self.requirement_rows, "catalog": self.catalog_rows,
                 "reviews": self.review_items, "checks": self.transition_checks, "cooperative": self.cooperative_rows,
                 "cooperative-basis": self.cooperative_basis, "input-errors": self.input_errors,
                 "customer-invoices": list(self.invoices(customer=True)) if self.view == "customer-invoices" else []}
        records = views[self.view]
        if self.selected_id is not None:
            records = [row for row in records if str(row.get("id", row.get("findingId", row.get("rowId", "")))) == self.selected_id]
        if self.query:
            records = [row for row in records if self.query in canonical(row).casefold()]
        report_size = len(canonical(self.report()).encode("utf-8"))
        allowance = max(1000, min(PAGE_BUDGET, RESULT_LIMIT - report_size - 16000))
        items, size = [], 0
        for record in records[self.offset:self.offset + self.limit]:
            added = len(canonical(record).encode("utf-8")) + 1
            if size + added > allowance:
                if not items:
                    raise InputError("The selected original row exceeds the native page budget; use its saved source file or full export")
                break
            items.append(record)
            size += added
        next_offset = self.offset + len(items)
        return {"view": self.view, "offset": self.offset, "requestedLimit": self.limit, "limit": len(items),
                "total": len(records), "items": items, "nextOffset": next_offset if next_offset < len(records) else None,
                "hasMore": next_offset < len(records), "byteLimited": len(items) < min(self.limit, max(0, len(records) - self.offset))}

    def customer_invoice(self, record):
        # Build the customer projection before evaluating any configured pointer.
        # Parent-object pointers therefore cannot recover private descendants.
        projected = {
            "id": record["id"], "table": "invoices", "values": copy.deepcopy(record["values"]),
            "_source": {key: copy.deepcopy(value) for key, value in record["_source"].items() if key != "path"},
            "analysis": {key: copy.deepcopy(value) for key, value in (record.get("analysis") or {}).items()
                         if key not in ("reviewNote", "reviewOwner")},
        }
        missing = object()
        fields, unavailable = {}, []
        for column in self.columns:
            value = pointer(projected, column["path"], missing=missing)
            fields[column["name"]] = None if value is missing else copy.deepcopy(value)
            if value is missing:
                unavailable.append({"name": column["name"], "path": column["path"], "code": "PATH_UNAVAILABLE"})
        projected["customerFields"] = fields
        projected["unavailableFields"] = unavailable
        return projected

    def customer_mapping(self):
        if hasattr(self, "_customer_mapping"):
            return self._customer_mapping
        counts = {column["name"]: {"availableRows": 0, "nullRows": 0, "unavailableRows": 0} for column in self.columns}
        row_count = 0
        for record in self.invoices(customer=True):
            row_count += 1
            absent = {item["name"] for item in record["unavailableFields"]}
            for column in self.columns:
                name = column["name"]
                if name in absent:
                    counts[name]["unavailableRows"] += 1
                else:
                    counts[name]["availableRows"] += 1
                    counts[name]["nullRows"] += record["customerFields"][name] is None
        columns = [{**column, **counts[column["name"]]} for column in self.columns]
        unavailable = sum(column["unavailableRows"] for column in columns)
        self._customer_mapping = {
            "projection": "customer-invoice", "rows": row_count, "columns": columns,
            "unavailableCells": unavailable, "complete": unavailable == 0,
            "unavailableValue": None,
            "interpretation": "Pointers address the customer projection only. An absent path is null plus PATH_UNAVAILABLE; a present source null remains a present null.",
        }
        return self._customer_mapping

    def invoices(self, customer=False):
        for record in self.tables["invoices"]:
            if record["values"] is None or record["omitted"] or record["values"].get("row_role", "BILLED") != "BILLED":
                continue
            yield self.customer_invoice(record) if customer else record

    def compact_files(self, customer=False):
        report = self.report(customer)
        prefix = "customer" if customer else "operator"
        return [
            file_record(prefix + "-summary.json", json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", "application/json"),
            file_record(prefix + "-report.html", render_report(report), "text/html; charset=utf-8"),
            file_record("customer-field-mapping.json", json.dumps(self.customer_mapping(), ensure_ascii=False, indent=2) + "\n", "application/json"),
            file_record("HANDOFF.md", self.handoff_text(customer), "text/markdown; charset=utf-8"),
        ]

    def handoff_text(self, customer):
        report = self.report(customer)
        return "\n".join([
            "# " + self.title, "",
            "Named period: " + self.period["id"] + "; retained edition: " + self.edition["id"] + ".",
            "Source kind: " + str(self.edition.get("sourceKind")) + ".",
            "Calculation status: " + report["reconciliation"]["status"] + ".",
            "Request SHA256: " + str(self.request_sha) + ".", "",
            "The report uses every admitted row in the selected saved source. The compact native preview does not embed full ledgers.",
            "Use the application workbench handoff command with this exact saved build preview for complete CSV/NDJSON outputs.",
            "The customer package contains complete agreed invoice mapping, inventory/transition, prepared monthly reports, source lineage and question responses.",
            "The operator package additionally retains the exact original request/packet, source inventory, private decisions/corrections and original portable workspace.",
            "Review dispositions do not change calculated states. No invoice posting, payment, filing or storage transfer was performed.",
            "Open report.html and the complete CSV files. Check manifest.json for every delivered file's exact bytes/SHA256.",
            "The original portable reopens all retained source editions and native history with the same maintained Python workspace.", "",
        ])


def render_report(report):
    escape = lambda value: html.escape(scalar(value), quote=True)
    def definitions(items):
        return "<dl>" + "".join("<dt>" + escape(key) + "</dt><dd>" + escape(value) + "</dd>" for key, value in items) + "</dl>"
    def section(title, body):
        return "<section><h2>" + escape(title) + "</h2>" + body + "</section>"
    reconciliation = report["reconciliation"]
    summary = reconciliation.get("summary") or {}
    items = [("Status", reconciliation["status"]), ("Calculation available", reconciliation["calculationAvailable"]),
             ("Currency", summary.get("currency")), ("Matched signed minor units", summary.get("matched_amount_minor")),
             ("Review signed minor units", summary.get("review_amount_minor")), ("Review gross minor units", summary.get("review_gross_minor")),
             ("Billed rows", report["counts"]["billedRows"]), ("Reference rows", report["counts"]["referenceRows"]),
             ("Input errors", report["input"]["errorCount"]), ("Review-required findings", report["counts"]["reviewRequired"])]
    notes = report["input"]["errors"] + [{"message": reason} for reason in reconciliation.get("holdReasons", [])]
    error_html = "<ul>" + "".join("<li>" + escape(item.get("message")) + "</li>" for item in notes) + "</ul>" if notes else "<p>No input correction is recorded in this selected calculation.</p>"
    counts = definitions(list(report["counts"].items()))
    lineage = definitions([("Period", report["period"]["label"]), ("Edition", report["edition"].get("label")),
                           ("Source kind", report["edition"].get("sourceKind")), ("Capture", report["edition"].get("capturedAt")),
                           ("Original source files", report["input"]["sourceCount"]), ("Source bytes", report["input"]["sourceBytes"]),
                           ("Corrections", report["input"]["correctionCount"]), ("Explicit omitted rows", report["input"]["omittedRows"]),
                           ("Request SHA256", reconciliation.get("requestSha256")), ("Packet SHA256", reconciliation.get("packetSha256"))])
    transition = definitions([(key, report["transition"].get(key)) for key in ("waveCount", "cartons", "unassigned", "completeWaves", "multipleAssignments", "errorCount")])
    fee = "<p>No cooperative fee report was configured.</p>" if report["cooperative"] is None else "<pre>" + escape(json.dumps(report["cooperative"], ensure_ascii=False, indent=2)) + "</pre>"
    comparison = "<p>No comparison was selected.</p>" if report["comparison"] is None else "<pre>" + escape(json.dumps(report["comparison"], ensure_ascii=False, indent=2)) + "</pre>"
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Records reconciliation report</title><style>
body{font:15px/1.55 system-ui,sans-serif;color:#171717;background:#fff;margin:0;padding:36px;max-width:1100px}
h1{font-size:28px;font-weight:650;margin:0}h2{font-size:18px;margin:0 0 14px}section{border-top:1px solid #ccc;padding:24px 0}
header p{color:#555}dl{display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:8px 22px;margin:0}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px;font:12px/1.5 ui-monospace,monospace}
footer{border-top:1px solid #999;padding-top:18px;color:#555}a{color:inherit}@media print{body{padding:0}section{break-inside:avoid}}
</style><header><h1>""" + escape(report["workspace"]["title"]) + "</h1><p>" + escape(report["period"]["label"]) + " · " + escape(report["edition"].get("label")) + "</p></header>" + \
        section("Reconciliation", definitions(items)) + section("Source and revision", lineage) + section("Input corrections", error_html) + \
        section("Complete selected inventory", counts) + section("Edition comparison", comparison) + section("Transition acceptance", transition) + \
        section("Prepared monthly report", fee) + section("Original procurement response register", definitions(list(report["requirements"].items()) + [("Cost catalog items", report["catalog"]["total"]), ("Original priced items", report["catalog"]["priced"])])) + \
        "<footer><p>Complete row details are in the accompanying CSV/NDJSON exports and exact manifest. " + escape(reconciliation["interpretation"]) + "</p></footer></html>\n"


def inspect_records(value=None, *, workspace_path=None):
    records = Records(value, workspace_path)
    return bounded({"schema": "tj.records-operator-inspection.v1", "report": records.report(), "page": records.page()})


def build_records(value=None, *, workspace_path=None):
    records = Records(value, workspace_path)
    return bounded({"schema": "tj.records-operator-build.v1", "report": records.report(), "files": records.compact_files()})


def customer_records(value=None, *, workspace_path=None):
    records = Records(value, workspace_path)
    return bounded({"schema": "tj.records-operator-customer.v1", "report": records.report(True), "files": records.compact_files(True)})


def export_complete(workspace_path, output_dir, period_id=None, edition_id=None, audience="operator"):
    if audience not in ("operator", "customer"):
        raise InputError("Export audience must be operator or customer")
    options = {key: value for key, value in (("periodId", period_id), ("editionId", edition_id)) if value is not None}
    records = Records(options, workspace_path)
    destination = Path(output_dir).resolve()
    if destination.exists():
        raise InputError("Choose a new output directory; previous deliveries are retained")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="." + destination.name + ".preparing-", dir=destination.parent))
    customer = audience == "customer"
    manifests = []
    operator_names = {"calculation.json", "normalized-request.json", "source-inventory.json", "review-decisions.json",
                      "source-corrections.json", "input-errors.json", "mapped-source-records.ndjson", "operator-invoices.ndjson",
                      "findings.ndjson", "cooperative-basis.csv"}
    def output_path(name):
        relative = name if name == "manifest.json" else ("operator/" if name in operator_names else "customer/") + name
        path = temporary / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        return relative, path
    def write(name, body, content_type):
        relative, path = output_path(name)
        raw = body.encode("utf-8")
        with path.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        manifests.append({"path": relative, "bytes": len(raw), "sha256": digest(raw), "contentType": content_type})
    def stream_jsonl(name, values):
        relative, path = output_path(name)
        sha = hashlib.sha256()
        size = 0
        with path.open("xb") as handle:
            for value in values:
                raw = (canonical(value) + "\n").encode("utf-8")
                handle.write(raw)
                sha.update(raw)
                size += len(raw)
            handle.flush()
            os.fsync(handle.fileno())
        manifests.append({"path": relative, "bytes": size, "sha256": sha.hexdigest(), "contentType": "application/x-ndjson"})
    def stream_csv(name, headers, rows):
        relative, path = output_path(name)
        with path.open("x", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, lineterminator="\r\n")
            writer.writerow(headers)
            for row in rows:
                writer.writerow([csv_cell(value) for value in row])
            handle.flush()
            os.fsync(handle.fileno())
        sha = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                sha.update(chunk)
                size += len(chunk)
        manifests.append({"path": relative, "bytes": size, "sha256": sha.hexdigest(), "contentType": "text/csv; charset=utf-8"})
    try:
        # Customer-directory files use the same projection for both delivery audiences.
        # Full operator diagnostics remain in the separate original operator files.
        report = records.report(True)
        write("summary.json", json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", "application/json")
        write("report.html", render_report(report), "text/html; charset=utf-8")
        write("README.md", records.handoff_text(True), "text/markdown; charset=utf-8")
        write("customer-field-mapping.json", json.dumps(records.customer_mapping(), ensure_ascii=False, indent=2) + "\n", "application/json")
        stream_jsonl("customer.ndjson", records.invoices(customer=True))
        stream_csv("customer.csv", [column["name"] for column in records.columns],
                   ([record["customerFields"][column["name"]] for column in records.columns] for record in records.invoices(customer=True)))
        ap_headers = ["period_id", "edition_id", "invoice_ref", "row_id", "charge_code", "carton_ref", "site_ref", "event_id",
                      "service_at", "billed_at", "line_kind", "credit_of", "quantity", "unit", "billed_rate_minor", "amount_minor",
                      "expected_amount_minor", "variance_minor", "engine_states", "review_status", "source_id", "source_sha256"]
        def ap_rows():
            for record in records.invoices():
                value, analysis = record["values"], record.get("analysis") or {}
                yield [records.period["id"], records.edition["id"], *[value.get(key) for key in ("invoice_ref", "row_id", "charge_code", "carton_ref", "site_ref", "event_id",
                       "service_at", "billed_at", "line_kind", "credit_of", "quantity", "unit", "rate_minor", "amount_minor")],
                       analysis.get("expectedAmountMinor"), analysis.get("varianceMinor"), analysis.get("states"), analysis.get("reviewStatus"),
                       record["_source"]["id"], record["_source"]["sha256"]]
        stream_csv("ap-reconciliation.csv", ap_headers, ap_rows())
        stream_csv("inventory.csv", ["carton_ref", "site_ref", "admitted_at", "terminated_at", "termination_kind", "source_id", "source_sha256"],
                   ([*[record["values"].get(key) for key in ("carton_ref", "site_ref", "admitted_at", "terminated_at", "termination_kind")],
                     record["_source"]["id"], record["_source"]["sha256"]]
                    for record in records.tables["cartons"] if record["values"] is not None and not record["omitted"]))
        stream_csv("transition-manifest.csv", ["carton_ref", "site_ref", "wave_id", "wave_label", "destination", "owner", "status", "findings", "source_sha256"],
                   ([row["id"], row["carton"].get("site_ref"), (row["wave"] or {}).get("id"), (row["wave"] or {}).get("label"),
                     (row["assignment"] or {}).get("destination"), (row["assignment"] or {}).get("owner") or (row["wave"] or {}).get("owner"),
                     (row["assignment"] or {}).get("status"), row["findings"], row["_source"]["sha256"]] for row in records.transition_rows))
        stream_csv("transition-checks.csv", ["wave_id", "kind", "status", "owner", "at", "evidence"],
                   ([row["waveId"], row["kind"], row["status"], row["owner"], row["at"], row.get("evidence", [])] for row in records.transition_checks))
        cooperative = records.config.get("cooperative") or {}
        unit_scale = 10 ** getattr(records, "digits", 2)
        as_major = lambda amount: None if amount is None else engine._fraction_text(Fraction(amount, unit_scale))
        stream_csv("cooperative-monthly.csv", ["Supplier", "Contract ID", "Month", "Year", "Lead Agency ID", "Agency ID", "Agency Name", "Monthly Net Sales", "Monthly Admin Fees", "Currency", "Complete", "Findings"],
                   ([cooperative.get("supplier"), cooperative.get("contractId"), row["month"][5:], row["month"][:4], cooperative.get("leadAgencyId"),
                     row["agencyId"], row["agencyName"], as_major(row["netSalesMinor"]), as_major(row["adminFeeMinor"]),
                     records.request["policy"]["currency"] if records.request else None, row["complete"], row["findings"]]
                    for row in records.cooperative_rows))
        stream_csv("requirements-response.csv", ["Question ID", "Section", "Original question", "Sheet", "Question cell", "Response cell", "Response", "Status", "Owner", "At", "Evidence"],
                   ([row["id"], row["original"].get("section"), row["original"].get("question"), row["original"].get("sheet"),
                     row["original"].get("questionCell"), row["original"].get("responseCell"),
                     (row["response"] or {}).get("response"), (row["response"] or {}).get("status", "unanswered"),
                     (row["response"] or {}).get("owner"), (row["response"] or {}).get("at"), (row["response"] or {}).get("evidence", [])]
                    for row in records.requirement_rows))
        catalog_keys = ["sheet", "row", "item", "family", "description", "unit", "unitPrice", "minimum", "surcharge", "notes"]
        stream_csv("original-cost-catalog.csv", catalog_keys,
                   ([row["original"].get(key) for key in catalog_keys] for row in records.catalog_rows))
        stream_csv("record-changes.csv", ["table", "record_id", "state", "changed_fields", "before", "after"],
                   ([row["table"], row["recordId"], row["state"], row["changedFields"], row["before"], row["after"]] for row in records.changes))
        if not customer:
            write("calculation.json", json.dumps(records.packet, ensure_ascii=False, indent=2, allow_nan=False) + "\n", "application/json")
            write("normalized-request.json", json.dumps(records.request, ensure_ascii=False, indent=2, allow_nan=False) + "\n", "application/json")
            write("source-inventory.json", json.dumps({"sources": records.source_records, "references": records.reference_bindings}, ensure_ascii=False, indent=2) + "\n", "application/json")
            write("review-decisions.json", json.dumps(records.review_items, ensure_ascii=False, indent=2) + "\n", "application/json")
            write("source-corrections.json", json.dumps(records.edition.get("corrections", []), ensure_ascii=False, indent=2) + "\n", "application/json")
            write("input-errors.json", json.dumps(records.input_errors, ensure_ascii=False, indent=2) + "\n", "application/json")
            stream_jsonl("mapped-source-records.ndjson", (record for table in TABLES for record in records.tables[table]))
            stream_jsonl("operator-invoices.ndjson", records.invoices())
            stream_jsonl("findings.ndjson", iter(records.findings))
            stream_csv("cooperative-basis.csv", ["month", "agencyId", "agencyName", "invoiceRef", "rowId", "chargeCode", "lineKind", "amountMinor", "sourceId", "sourceSha256"],
                       ([row.get(key) for key in ("month", "agencyId", "agencyName", "invoiceRef", "rowId", "chargeCode", "lineKind", "amountMinor", "sourceId", "sourceSha256")]
                        for row in records.cooperative_basis))
        manifest = {"schema": "tj.records-operator-delivery.v1", "audience": audience,
                    "workspaceSha256": digest(records.path.read_bytes()),
                    "periodId": records.period["id"], "editionId": records.edition["id"], "requestSha256": records.request_sha,
                    "calculationStatus": report["reconciliation"]["status"], "sourceFiles": list(records.source_bindings.values()),
                    "files": [dict(item) for item in manifests], "counts": report["counts"],
                    "completeRowExport": not records.input_errors, "inputErrorCount": len(records.input_errors),
                    "interpretation": "Every mapped admitted invoice row is exported; exact original/invalid/omitted source records remain in operator source."}
        write("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "application/json")
        if destination.exists():
            raise InputError("Output destination appeared while preparing; existing work is preserved")
        os.rename(temporary, destination)
        directory_fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"directory": str(destination), "manifest": manifest, "files": len(manifests), "bytes": sum(item["bytes"] for item in manifests)}
    except BaseException:
        # Preserve a failed export's own exact partials for explicit continuation.
        # No peer source or prior delivery is removed.
        raise


def main():
    parser = argparse.ArgumentParser(description="Records operator over the original reconciliation engine")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--workspace", required=True)
    inspect.add_argument("--period")
    inspect.add_argument("--edition")
    inspect.add_argument("--view", default="findings")
    inspect.add_argument("--offset", type=int, default=0)
    inspect.add_argument("--limit", type=int, default=100)
    export = sub.add_parser("export")
    export.add_argument("--workspace", required=True)
    export.add_argument("--out", required=True)
    export.add_argument("--period")
    export.add_argument("--edition")
    export.add_argument("--audience", choices=("operator", "customer"), default="operator")
    args = parser.parse_args()
    if args.command == "inspect":
        value = {"view": args.view, "offset": args.offset, "limit": args.limit}
        if args.period:
            value["periodId"] = args.period
        if args.edition:
            value["editionId"] = args.edition
        result = inspect_records(value, workspace_path=args.workspace)
    else:
        result = export_complete(args.workspace, args.out, args.period, args.edition, args.audience)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (InputError, engine.InputError, OSError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
