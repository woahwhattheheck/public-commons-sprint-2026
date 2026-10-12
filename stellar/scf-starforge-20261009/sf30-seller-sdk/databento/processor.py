"""Retained Databento migration assessment and complete streaming delivery.

All acquisition and DBN decoding belong to the original provider adapter.
This module preserves supplied record values and works without network access.
"""
from __future__ import annotations

import argparse
import bisect
import calendar
import csv
import gzip
import hashlib
import html
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

WORKSPACE_SCHEMA = "tj.databento-migration-workspace.v1"
REPORT_SCHEMA = "tj.databento-migration-report.v1"
NANO = 1_000_000_000
DAY_NS = 86_400 * NANO
PRICE_UNDEFINED = 9_223_372_036_854_775_807
TIME_UNDEFINED = 18_446_744_073_709_551_615
MAX_NATIVE_BYTES = 1_048_576
PAGE_BYTES = 620_000
NY = ZoneInfo("America/New_York")
UTC = timezone.utc
RTYPES = {"mbo": "160", "mbp-1": "1", "tbbo": "1", "definition": "19", "status": "18", "trades": "0"}
PRICE_FIELDS = {
    "price", "bid_px", "ask_px", "open", "high", "low", "close", "min_price_increment",
    "display_factor", "high_limit_price", "low_limit_price", "max_price_variation",
    "trading_reference_price", "unit_of_measure_qty", "min_price_increment_amount",
    "price_ratio", "strike_price", "leg_price", "leg_delta",
}
TIME_FIELDS = {"ts_event", "ts_recv", "expiration", "activation"}
# Original DBN definition field widths, rather than a generic 64-bit sentinel.
DEF_UNDEFINED = {
    **dict.fromkeys(("inst_attrib_value", "market_depth_implied", "market_depth",
                     "min_lot_size", "min_lot_size_block", "min_lot_size_round_lot",
                     "contract_multiplier", "decay_quantity", "original_contract_size",
                     "leg_ratio_price_numerator", "leg_ratio_price_denominator",
                     "leg_ratio_qty_numerator", "leg_ratio_qty_denominator"), "2147483647"),
    **dict.fromkeys(("market_segment_id", "max_trade_vol", "min_trade_vol"), "4294967295"),
    **dict.fromkeys(("maturity_year", "decay_start_date", "trading_reference_date"), "65535"),
    "appl_id": "32767",
    **dict.fromkeys(("main_fraction", "price_display_format", "sub_fraction",
                     "underlying_product", "maturity_month", "maturity_day", "maturity_week",
                     "tick_rule", "settl_price_type"), "255"),
    **dict.fromkeys(("contract_multiplier_unit", "flow_schedule_type"), "127"),
}
STATUS_ACTIONS = dict(enumerate((
    "NONE", "PRE_OPEN", "PRE_CROSS", "QUOTING", "CROSS", "ROTATION",
    "NEW_PRICE_INDICATION", "TRADING", "HALT", "PAUSE", "SUSPEND", "PRE_CLOSE",
    "CLOSE", "POST_CLOSE", "SSR_CHANGE", "NOT_AVAILABLE_FOR_TRADING",
)))
DEFAULT_COLUMNS = [
    {"name": "identity", "path": "/identity/key"},
    {"name": "symbol", "path": "/identity/rawSymbol"},
    {"name": "event_time", "path": "/time/event/raw"},
    {"name": "event_ns", "path": "/time/event/ns"},
    {"name": "received_time", "path": "/time/receive/raw"},
    {"name": "price", "path": "/prices/price/raw"},
    {"name": "price_atomic", "path": "/prices/price/atomic"},
    {"name": "action", "path": "/record/action"},
    {"name": "side", "path": "/record/side"},
    {"name": "size", "path": "/record/size"},
    {"name": "sequence", "path": "/record/sequence"},
    {"name": "review", "path": "/review/decision"},
]
RULE_URLS = {
    "nasdaq": "https://databento.com/blog/nasdaq-historical-data-changes-2026-09",
    "batch": "https://databento.com/blog/batch-api-changes-2026-08",
    "dbn": "https://github.com/databento/dbn",
}
ISO_RE = re.compile(r"^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$")
INT_RE = re.compile(r"^-?\d+$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$")


class MigrationError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(f"{code}: {message}")


def require(ok, code, message):
    if not ok:
        raise MigrationError(code, message)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else dumps(value).encode("utf-8")).hexdigest()


def pairs_unique(items):
    result = {}
    for key, value in items:
        require(key not in result, "DUPLICATE_JSON_KEY", f"Repeated original JSON field {key!r}.")
        result[key] = value
    return result


def exact_json(text):
    return json.loads(text, parse_int=str, parse_float=str,
                      parse_constant=lambda x: (_ for _ in ()).throw(MigrationError("INVALID_JSON_NUMBER", x)),
                      object_pairs_hook=pairs_unique)


def read_json(path, exact=False):
    with Path(path).open("r", encoding="utf-8-sig") as f:
        return exact_json(f.read()) if exact else json.load(f, object_pairs_hook=pairs_unique)


def str_value(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, Decimal)):
        return str(value)
    return None


def original_field(record, name):
    hd = record.get("hd")
    if isinstance(hd, dict) and name in hd:
        return hd[name]
    return record.get(name)


def pointer(value, path):
    if path == "":
        return value
    for part in path.split("/")[1:]:
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


@lru_cache(maxsize=8192)
def iso_second(d, t, offset):
    dt = datetime.fromisoformat(d + "T" + t + ("+00:00" if offset == "Z" else offset)).astimezone(UTC)
    return calendar.timegm(dt.utctimetuple())


@lru_cache(maxsize=8192)
def utc_second(seconds):
    dt = datetime.fromtimestamp(seconds, UTC)
    return dt, dt.strftime("%Y-%m-%dT%H:%M:%S")


@lru_cache(maxsize=8192)
def local_second(seconds):
    dt = utc_second(seconds)[0]
    local = dt.astimezone(NY)
    minute = local.hour * 60 + local.minute
    session = "premarket" if 240 <= minute < 570 else "regular" if 570 <= minute < 960 else "after-hours" if 960 <= minute < 1200 else "outside-session"
    return {"session": session, "newYorkDate": local.date().isoformat(), "newYorkSecond": local.strftime("%H:%M:%S"),
            "estAfterHours": dt.hour == 0 and local.utcoffset() == timedelta(hours=-5),
            "utcDate": dt.date().isoformat(), "dayOfWeek": local.strftime("%A")}


class DigestReader(io.RawIOBase):
    def __init__(self, source):
        super().__init__()
        self.source, self.sha, self.bytes = source, hashlib.sha256(), 0

    def readable(self):
        return True

    def readinto(self, buffer):
        data = self.source.read(len(buffer))
        self.sha.update(data)
        self.bytes += len(data)
        buffer[:len(data)] = data
        return len(data)

    def close(self):
        try:
            self.source.close()
        finally:
            super().close()


def timestamp(raw, encoding):
    text = str_value(raw)
    result = {"raw": text, "ns": None, "iso": None, "state": "missing"}
    if text is None or text == "":
        return result
    if encoding not in ("iso8601-nanoseconds", "integer-nanos"):
        result["state"] = "unknown-encoding"
        return result
    try:
        if encoding == "integer-nanos":
            if not INT_RE.fullmatch(text):
                raise ValueError("not an integer")
            value = int(text)
            if value == TIME_UNDEFINED:
                result["state"] = "undefined"
                return result
            if not 0 <= value < TIME_UNDEFINED:
                raise ValueError("outside u64 timestamp")
        else:
            match = ISO_RE.fullmatch(text)
            if not match:
                raise ValueError("expected explicit ISO UTC offset and at most nine fractional digits")
            d, t, frac, offset = match.groups()
            value = iso_second(d, t, offset) * NANO + int((frac or "").ljust(9, "0"))
        seconds, remainder = divmod(value, NANO)
        iso = utc_second(seconds)[1]
        result.update(ns=str(value), iso=iso + f".{remainder:09d}Z", state="known")
    except (ValueError, OverflowError, OSError):
        result["state"] = "invalid"
    return result


def price(raw, encoding):
    text = str_value(raw)
    result = {"raw": text, "atomic": None, "decimal": None, "state": "missing"}
    if text is None or text == "":
        return result
    if encoding not in ("decimal-fixed9", "integer-nanos"):
        result["state"] = "unknown-encoding"
        return result
    try:
        if encoding == "integer-nanos":
            if not INT_RE.fullmatch(text):
                raise ValueError("not an integer")
            atomic = int(text)
        else:
            number = Decimal(text)
            if not number.is_finite():
                raise ValueError("not finite")
            scaled = number * NANO
            if scaled != scaled.to_integral_value():
                raise ValueError("more than nine nonzero decimal places")
            atomic = int(scaled)
        if atomic == PRICE_UNDEFINED:
            result["state"] = "undefined"
            return result
        if not -(2**63) <= atomic < PRICE_UNDEFINED:
            raise ValueError("outside fixed-price i64")
        whole, fraction = divmod(abs(atomic), NANO)
        result.update(atomic=str(atomic), decimal=("-" if atomic < 0 else "") + f"{whole}.{fraction:09d}", state="known")
    except (ValueError, InvalidOperation, OverflowError):
        result["state"] = "invalid"
    return result


def flags(raw):
    text = str_value(raw)
    result = {"raw": text, "mask": None, "snapshot": None, "last": None,
              "badTsReceive": None, "maybeBadBook": None}
    if text in (None, ""):
        return result
    if not text.isdigit() or not 0 <= int(text) <= 255:
        result["state"] = "invalid"
        return result
    mask = int(text)
    result.update(mask=mask, snapshot=bool(mask & 32), last=bool(mask & 128),
                  badTsReceive=bool(mask & 8), maybeBadBook=bool(mask & 4))
    return result


def clock_info(event, received):
    chosen = event if event["state"] == "known" else received
    result = {"session": "unknown", "newYorkDate": None, "newYorkTime": None,
              "estAfterHours": False, "utcMidnight": False, "utcDate": None,
              "dayOfWeek": None, "basis": "event" if chosen is event else "receive"}
    if chosen["state"] != "known":
        return result
    ns = int(chosen["ns"])
    seconds, remainder = divmod(ns, NANO)
    basis = local_second(seconds)
    result.update({k: v for k, v in basis.items() if k != "newYorkSecond"})
    result.update(newYorkTime=basis["newYorkSecond"] + f".{remainder:09d}", utcMidnight=ns % DAY_NS == 0)
    return result


def safe_url(value):
    if not isinstance(value, str):
        return value
    try:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or parts.username or parts.password:
            return None
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                 if not re.search(r"key|token|secret|signature|credential|authorization", k, re.I)]
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))
    except ValueError:
        return None


def validate_columns(value):
    require(isinstance(value, list) and value, "OUTPUT_COLUMNS", "Provide a nonempty outputColumns array.")
    seen = set()
    for column in value:
        require(isinstance(column, dict), "OUTPUT_COLUMNS", "Each output column needs name and path.")
        name, path = column.get("name"), column.get("path")
        require(isinstance(name, str) and name.strip() and name not in seen, "OUTPUT_COLUMNS", "Column names must be nonempty and unique.")
        seen.add(name)
        require(isinstance(path, str) and (
            path in ("/id", "/sourceId", "/row", "/schema", "/review/decision")
            or any(path.startswith(p) for p in ("/identity/", "/time/", "/prices/", "/flags/", "/record/"))
        ), "OUTPUT_COLUMNS", f"Unsupported public output path: {path!r}.")
    return value


def file_identity(path):
    sha = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            sha.update(block)
            size += len(block)
    return size, sha.hexdigest()


def safe_path(root, value):
    require(isinstance(value, str) and value and not Path(value).is_absolute(), "SOURCE_PATH", "Source paths must be relative.")
    path = (root / value).resolve()
    require(path.is_relative_to(root.resolve()) and path.is_file(), "SOURCE_PATH", f"Unavailable or escaping source: {value}.")
    return path


def load_workspace(path):
    path = Path(path).resolve()
    document = read_json(path)
    require(isinstance(document, dict) and document.get("schema") == WORKSPACE_SCHEMA, "WORKSPACE_SCHEMA", f"Expected {WORKSPACE_SCHEMA}.")
    editions = document.get("editions")
    require(isinstance(editions, list) and editions, "EDITIONS", "At least one retained edition is required.")
    ids = set()
    for edition in editions:
        require(isinstance(edition, dict) and isinstance(edition.get("id"), str) and ID_RE.fullmatch(edition["id"]), "EDITION_ID", "Edition IDs must be stable identifiers.")
        require(edition["id"] not in ids, "EDITION_ID", f"Repeated edition {edition['id']}.")
        ids.add(edition["id"])
        require(edition.get("role") in ("reference", "baseline", "preview"), "EDITION_ROLE", "Use reference, baseline, or preview.")
        require(isinstance(edition.get("scope"), dict) and edition["scope"].get("dataset") and edition["scope"].get("schema"), "EDITION_SCOPE", "Dataset and schema are required.")
        require(isinstance(edition["scope"].get("symbols", []), list) and all(isinstance(s, str) for s in edition["scope"].get("symbols", [])), "SCOPE_SYMBOLS", "Scope symbols must be an explicit array of original symbol strings.")
        require(edition["scope"].get("timeField", "ts_recv") in ("ts_recv", "ts_event"), "SCOPE_TIME_FIELD", "Choose original ts_recv or ts_event for scope selection.")
        require(isinstance(edition.get("sources"), list) and edition["sources"], "SOURCES", "An edition needs explicit source descriptors.")
        source_ids = set()
        for source in edition["sources"]:
            require(isinstance(source, dict) and isinstance(source.get("id"), str) and ID_RE.fullmatch(source["id"]), "SOURCE_ID", "Source IDs must be stable identifiers.")
            require(source["id"] not in source_ids, "SOURCE_ID", f"Repeated source {source['id']} in one edition.")
            source_ids.add(source["id"])
            require(source.get("role", "primary") in ("primary", "reference"), "SOURCE_ROLE", "Use primary or reference source role.")
            require(source.get("kind", "records") in ("records", "dbn-metadata", "symbology", "batch-list", "batch-details"), "SOURCE_KIND", f"Unsupported source kind {source.get('kind')}.")
            require(source.get("format") in ("csv", "dbn-jsonl", "json"), "SOURCE_FORMAT", f"Unsupported source format for {source['id']}.")
            require(source.get("compression") in (None, "gzip"), "SOURCE_COMPRESSION", "Only exact uncompressed or gzip input is supported by this core.")
    require(document.get("selectedEdition") in ids, "SELECTED_EDITION", "Select an existing retained edition.")
    document["outputColumns"] = validate_columns(document.get("outputColumns") or [dict(x) for x in DEFAULT_COLUMNS])
    seen_reviews = set()
    for review in document.get("reviews", []):
        require(isinstance(review, dict) and review.get("id") and review["id"] not in seen_reviews, "REVIEW_ID", "Append reviews with unique IDs.")
        seen_reviews.add(review["id"])
        require(review.get("editionId") in ids and review.get("targetType") in ("source", "instrument", "finding", "edition") and review.get("targetId"), "REVIEW_TARGET", "Review targets require exact edition/type/id.")
        require(review.get("decision") in ("accept", "revisit", "exclude") and isinstance(review.get("reviewer"), str) and review["reviewer"].strip(), "REVIEW_DECISION", "A named reviewer and explicit decision are required.")
        require(timestamp(review.get("at"), "iso8601-nanoseconds")["state"] == "known", "REVIEW_TIME", "Review at needs an explicit ISO time and timezone.")
    return path, document


class Assessment:
    def __init__(self, path, document, edition_id=None, record_page=None):
        self.path, self.root, self.document = path, path.parent, document
        self.edition = next((e for e in document["editions"] if e["id"] == (edition_id or document["selectedEdition"])), None)
        require(self.edition is not None, "EDITION_NOT_FOUND", "The requested retained edition does not exist.")
        self.scope = self.edition["scope"]
        self.sources, self.source_map = [], {}
        self.definitions = defaultdict(list)
        self.symbol_intervals = defaultdict(list)
        self.instruments, self.sessions, self.findings = {}, {}, {}
        self.metadata_rows, self.batch_jobs = [], {}
        self.review_index = {(r["targetType"], r["targetId"]): r for r in document.get("reviews", []) if r["editionId"] == self.edition["id"]}
        self.review_events = [r for r in document.get("reviews", []) if r["editionId"] == self.edition["id"]]
        self.summary = dict(totalRecords=0, primaryRecords=0, referenceRecords=0, sourceCount=0, sourceBytes=0,
                            instrumentCount=0, definitionRecords=0, statusRecords=0, excludedPrimaryRecords=0,
                            customerRecords=0, priceStates=Counter(), timestampStates=Counter(),
                            snapshotFlaggedRecords=0, utcMidnightRecords=0, estAfterHoursRecords=0,
                            unknownCurrencyRecords=0, preIdCutoffRecords=0, mboResetRecords=0, badTsReceiveRecords=0,
                            maybeBadBookRecords=0, undefinedTypedFields=0)
        self.page_request = record_page
        self.record_page, self.page_bytes, self.page_seen, self.page_byte_limited = [], 0, 0, False
        self.db, self.db_dir = None, None
        self.comparison = {"requested": bool(self.edition.get("compareToEditionId")), "eligible": False,
                           "baselineEditionId": self.edition.get("compareToEditionId"), "reasons": [], "counts": {}}
        self.baseline = None
        self._prepare()

    def close(self):
        if self.db is not None:
            self.db.close()
            self.db = None
        if self.db_dir is not None:
            self.db_dir.cleanup()
            self.db_dir = None
        if self.baseline is not None:
            self.baseline.close()
            self.baseline = None

    def finding(self, code, message, source_id=None, severity="warning", example=None, count=1):
        key = (code, source_id or "")
        if key not in self.findings:
            identity = "finding:" + digest([self.edition["id"], *key])[:24]
            self.findings[key] = {"id": identity, "code": code, "severity": severity,
                                  "message": message, "sourceId": source_id, "count": 0, "examples": []}
        item = self.findings[key]
        item["count"] += count
        if example is not None and len(item["examples"]) < 3:
            item["examples"].append(example)
        review = self.review_index.get(("finding", item["id"]))
        item["review"] = {"decision": review["decision"] if review else "unreviewed"}

    def _verify(self, descriptor, label):
        path = safe_path(self.root, descriptor.get("path"))
        expected_bytes, expected_sha = descriptor.get("bytes"), descriptor.get("sha256")
        require(isinstance(expected_bytes, int) and not isinstance(expected_bytes, bool) and expected_bytes >= 0,
                "SOURCE_BYTES", f"{label}: exact integer byte count is required.")
        require(isinstance(expected_sha, str) and HASH_RE.fullmatch(expected_sha), "SOURCE_HASH", f"{label}: exact SHA256 is required.")
        size, sha = file_identity(path)
        require(size == expected_bytes and sha == expected_sha, "SOURCE_MISMATCH", f"{label}: retained bytes/hash differ from the source descriptor.")
        return path

    def _prepare(self):
        for descriptor in self.edition["sources"]:
            path = self._verify(descriptor, descriptor["id"])
            info = {"descriptor": descriptor, "file": path, "records": 0, "outOfBounds": 0,
                    "firstTime": None, "lastTime": None, "rtypes": Counter(),
                    "invalidTimes": 0, "coverage": (descriptor.get("completeness") or {}).get("status", "unknown"), "bounds": {}, "priceColumns": None}
            for bound in ("start", "end"):
                text = (descriptor.get("completeness") or {}).get(bound)
                if text is not None:
                    value = timestamp(text, "integer-nanos" if str(text).isdigit() else "iso8601-nanoseconds")
                    require(value["state"] == "known", "PARTITION_TIME", f"{descriptor['id']}: explicit {bound} is not a valid timestamp.")
                    info["bounds"][bound] = int(value["ns"])
            index = (descriptor.get("corpus") or {}).get("index")
            if isinstance(index, dict) and index.get("path"):
                self._verify(index, descriptor["id"] + " corpus index")
            self.sources.append(info)
            self.source_map[descriptor["id"]] = info
            self.summary["sourceCount"] += 1
            self.summary["sourceBytes"] += descriptor["bytes"]
            if descriptor.get("kind", "records") != "records":
                self._metadata(info)
        # Effective definitions precede streaming market records; input descriptor order is immaterial.
        for info in self.sources:
            desc = info["descriptor"]
            if desc.get("kind", "records") != "records" or desc.get("schema", self.scope["schema"]) != "definition":
                continue
            encoding = desc.get("encoding") or {}
            for row, raw in self._rows(info):
                event = timestamp(original_field(raw, "ts_event"), encoding.get("timestamps"))
                recv = timestamp(original_field(raw, "ts_recv"), encoding.get("timestamps"))
                chosen = event if event["state"] == "known" else recv
                pub, inst = str_value(original_field(raw, "publisher_id")), str_value(original_field(raw, "instrument_id"))
                if chosen["state"] != "known" or not pub or not inst:
                    continue
                day = chosen["iso"][:10]
                key = (desc.get("dataset", self.scope["dataset"]), pub, day, inst)
                self.definitions[key].append((int(chosen["ns"]), {
                    "rawSymbol": str_value(raw.get("raw_symbol")) or None,
                    "rawInstrumentId": str_value(raw.get("raw_instrument_id")) or None,
                    "currency": str_value(raw.get("currency")) or None,
                    "sourceId": desc["id"], "row": row,
                }))
        for key, values in self.definitions.items():
            values.sort(key=lambda item: item[0])
            for earlier, later in zip(values, values[1:]):
                if earlier[0] == later[0] and any(earlier[1][k] != later[1][k] for k in ("rawSymbol", "rawInstrumentId", "currency")):
                    self.finding("DEFINITION_CONFLICT", "Same-time original definitions disagree within one instrument scope; source values remain separately retained.", severity="error", example={"identity": "|".join(key), "eventNs": str(earlier[0])})

    @contextmanager
    def _reader(self, info):
        binary = gzip.open(info["file"], "rb") if info["descriptor"].get("compression") == "gzip" else info["file"].open("rb")
        tracker = DigestReader(binary)
        with io.TextIOWrapper(io.BufferedReader(tracker), encoding="utf-8-sig", newline="") as text:
            yield text
        info["decoded"] = {"bytes": tracker.bytes, "sha256": tracker.sha.hexdigest()}
        partition = (info["descriptor"].get("corpus") or {}).get("partition")
        if isinstance(partition, dict):
            require(partition.get("bytes") == tracker.bytes and partition.get("sha256") == tracker.sha.hexdigest(),
                    "DECODED_SOURCE_MISMATCH", f"{info['descriptor']['id']}: decompressed original bytes/hash differ from retained partition identity.")

    def _rows(self, info):
        desc = info["descriptor"]
        with self._reader(info) as f:
            if desc["format"] == "csv":
                reader = csv.reader(f)
                header = next(reader, None)
                require(header is not None and len(header) == len(set(header)) and all(header), "CSV_HEADER", f"{desc['id']}: a unique nonempty original header is required.")
                for row, values in enumerate(reader, 1):
                    require(len(values) == len(header), "CSV_ROW_WIDTH", f"{desc['id']} row {row}: field count differs from its original header.")
                    yield row, dict(zip(header, values))
            elif desc["format"] == "dbn-jsonl":
                row = 0
                for line_number, line in enumerate(f, 1):
                    if not line.strip():
                        continue
                    row += 1
                    try:
                        record = exact_json(line)
                    except (ValueError, json.JSONDecodeError) as error:
                        raise MigrationError("DBN_JSONL_RECORD", f"{desc['id']} line {line_number}: {error}") from error
                    require(isinstance(record, dict), "DBN_JSONL_RECORD", f"{desc['id']} row {row} is not an original object.")
                    yield row, record
            else:
                raise MigrationError("RECORD_FORMAT", f"{desc['id']}: market records require csv or dbn-jsonl.")

    def _metadata(self, info):
        desc = info["descriptor"]
        require(desc["format"] == "json", "METADATA_FORMAT", f"{desc['id']}: metadata requires original JSON.")
        with self._reader(info) as f:
            obj = exact_json(f.read())
        kind = desc["kind"]
        self.metadata_rows.append((desc, obj))
        if kind == "symbology":
            request = (desc.get("representation") or {}).get("request") or {}
            stype_in = request.get("stypeIn", request.get("stype_in"))
            stype_out = request.get("stypeOut", request.get("stype_out"))
            mappings = obj.get("result") if isinstance(obj, dict) else None
            if isinstance(mappings, dict) and stype_in == "raw_symbol" and stype_out == "instrument_id":
                for symbol, intervals in mappings.items():
                    for interval in intervals:
                        if all(k in interval for k in ("d0", "d1", "s")):
                            self.symbol_intervals[(desc.get("dataset", self.scope["dataset"]), str(interval["s"]))].append(
                                (str(interval["d0"]), str(interval["d1"]), symbol))
            elif mappings is not None:
                self.finding("SYMBOLOGY_DIRECTION", "Retained symbology direction is not explicitly raw_symbol to instrument_id; mappings remain unmodified.", desc["id"])
        if kind == "dbn-metadata" and isinstance(obj, dict):
            meta = obj.get("metadata", obj)
            for mapping in meta.get("mappings", []) if isinstance(meta, dict) else []:
                symbol = mapping.get("raw_symbol")
                if symbol:
                    for interval in mapping.get("intervals", []):
                        start, end, instrument = interval.get("start_date", interval.get("d0")), interval.get("end_date", interval.get("d1")), interval.get("symbol", interval.get("s"))
                        if start is not None and end is not None and instrument is not None:
                            self.symbol_intervals[(desc.get("dataset", self.scope["dataset"]), str(instrument))].append((str(start), str(end), symbol))
            if isinstance(meta, dict):
                if meta.get("partial"):
                    self.finding("PROVIDER_PARTIAL", "Original DBN metadata marks partial symbols/coverage.", desc["id"], example=meta["partial"])
                if meta.get("not_found"):
                    self.finding("PROVIDER_NOT_FOUND", "Original DBN metadata reports symbols not found.", desc["id"], example=meta["not_found"])
                if meta.get("limit") not in (None, "", "0", 0):
                    self.finding("PROVIDER_LIMIT", "Original DBN metadata has an explicit record limit; preserve that source scope.", desc["id"], example=meta["limit"])
        if kind in ("batch-list", "batch-details"):
            jobs = obj if isinstance(obj, list) else obj.get("jobs", [obj]) if isinstance(obj, dict) else []
            for job in jobs:
                if not isinstance(job, dict) or not job.get("id"):
                    self.finding("BATCH_JOB_ID", "An original batch record lacks its required job id.", desc["id"], "error")
                    continue
                jid = str(job["id"])
                entry = self.batch_jobs.setdefault(jid, {"id": jid})
                if kind == "batch-list":
                    entry.update(summary={k: job.get(k) for k in ("id", "state", "ts_received")}, summarySourceId=desc["id"], listFields=list(job))
                else:
                    entry.update(details={k: job.get(k) for k in ("id", "state", "ts_received", "dataset", "schema", "start", "end", "record_count", "actual_size", "cost_usd", "limit")}, detailsSourceId=desc["id"])

    def normalize(self, info, row, raw):
        desc = info["descriptor"]
        encoding = desc.get("encoding") or {}
        schema, dataset = desc.get("schema", self.scope["schema"]), desc.get("dataset", self.scope["dataset"])
        event = timestamp(original_field(raw, "ts_event"), encoding.get("timestamps"))
        recv = timestamp(original_field(raw, "ts_recv"), encoding.get("timestamps"))
        clock = clock_info(event, recv)
        pub, inst = str_value(original_field(raw, "publisher_id")), str_value(original_field(raw, "instrument_id"))
        key_parts = (dataset, pub or "unknown", clock["utcDate"] or "unknown", inst or "unknown")
        definition = None
        defs = self.definitions.get(key_parts)
        chosen = event if event["state"] == "known" else recv
        if defs and chosen["state"] == "known":
            index = bisect.bisect_right(defs, int(chosen["ns"]), key=lambda item: item[0]) - 1
            if index >= 0:
                definition = defs[index][1]
        symbol = str_value(raw.get("raw_symbol")) or str_value(raw.get("symbol")) or None
        if not symbol and definition:
            symbol = definition["rawSymbol"]
        if not symbol and inst and clock["utcDate"]:
            matching = {s for d0, d1, s in self.symbol_intervals.get((dataset, inst), []) if d0 <= clock["utcDate"] < d1}
            if len(matching) == 1:
                symbol = next(iter(matching))
        identity = {"key": "|".join(key_parts), "dataset": dataset, "publisherId": pub, "utcDate": clock["utcDate"],
                    "instrumentId": inst, "rawSymbol": symbol,
                    "rawInstrumentId": (str_value(raw.get("raw_instrument_id")) or None) if schema == "definition" else definition["rawInstrumentId"] if definition else None,
                    "currency": (str_value(raw.get("currency")) or None) if schema == "definition" else definition["currency"] if definition else None}
        prices = {}
        if info["priceColumns"] is None or desc["format"] == "dbn-jsonl":
            info["priceColumns"] = tuple(name for name in raw if name in PRICE_FIELDS or re.fullmatch(r"(?:bid|ask)_px_\d+", name))
        for name in info["priceColumns"]:
            prices[name] = price(raw.get(name), encoding.get("prices"))
        for index, level in enumerate(raw.get("levels", [])):
            if isinstance(level, dict):
                for name in ("bid_px", "ask_px"):
                    if name in level:
                        prices[f"{name}_{index:02d}"] = price(level[name], encoding.get("prices"))
        undefined = {name: {"raw": str_value(value), "state": "undefined"} for name, value in raw.items()
                     if schema == "definition" and name in DEF_UNDEFINED and str_value(value) == DEF_UNDEFINED[name]}
        if str_value(raw.get("size")) == "4294967295":
            undefined["size"] = {"raw": "4294967295", "state": "undefined"}
        record = {"id": f"record:{desc['id']}:{row}", "sourceId": desc["id"], "row": row, "schema": schema,
                  "role": desc.get("role", "primary"), "identity": identity,
                  "time": {"event": event, "receive": recv,
                           "additional": {name: timestamp(raw[name], encoding.get("timestamps")) for name in TIME_FIELDS - {"ts_event", "ts_recv"} if name in raw},
                           **{k: v for k, v in clock.items() if k != "utcDate"}},
                  "prices": prices, "flags": flags(raw.get("flags")), "undefinedFields": undefined,
                  "record": raw}
        if definition:
            record["definition"] = {"sourceId": definition["sourceId"], "row": definition["row"]}
        decisions = [self.review_index.get((kind, target)) for kind, target in (
            ("instrument", identity["key"]), ("source", desc["id"]), ("edition", self.edition["id"]))]
        effective = next((x for x in decisions if x and x["decision"] == "exclude"), None) or next((x for x in decisions if x), None)
        record["review"] = {"decision": effective["decision"] if effective else "unreviewed"}
        record["excluded"] = any(x and x["decision"] == "exclude" for x in decisions)
        if schema == "status":
            action = str_value(raw.get("action"))
            record["status"] = {"action": action, "actionName": STATUS_ACTIONS.get(int(action)) if action and action.isdigit() else None,
                                "reason": str_value(raw.get("reason")), "tradingEvent": str_value(raw.get("trading_event")),
                                "isTrading": str_value(raw.get("is_trading")), "isQuoting": str_value(raw.get("is_quoting")),
                                "isShortSellRestricted": str_value(raw.get("is_short_sell_restricted"))}
        return record

    def _observe(self, info, record):
        desc, summary, raw = info["descriptor"], self.summary, record["record"]
        info["records"] += 1
        summary["totalRecords"] += 1
        primary = record["role"] == "primary"
        summary["primaryRecords" if primary else "referenceRecords"] += 1
        if primary:
            summary["excludedPrimaryRecords" if record["excluded"] else "customerRecords"] += 1
        rtype = str_value(original_field(raw, "rtype"))
        info["rtypes"][rtype or "missing"] += 1
        expected = RTYPES.get(record["schema"])
        if expected and rtype != expected:
            self.finding("RTYPE_SCHEMA_MISMATCH", "Observed original rtype differs from the explicitly requested schema.", desc["id"], "error", {"row": record["row"], "rtype": rtype, "expected": expected})
        for field, value in [("event", record["time"]["event"]), ("receive", record["time"]["receive"]), *record["time"]["additional"].items()]:
            summary["timestampStates"][value["state"]] += 1
            if value["state"] in ("invalid", "unknown-encoding"):
                self.finding("TIMESTAMP_" + value["state"].replace("-", "_").upper(), "Original timestamp could not be converted under its declared encoding; original text is retained.", desc["id"], "error", {"row": record["row"], "field": field, "raw": value["raw"]})
        for field, value in record["prices"].items():
            summary["priceStates"][value["state"]] += 1
            if value["state"] in ("invalid", "unknown-encoding"):
                self.finding("PRICE_" + value["state"].replace("-", "_").upper(), "Original price could not be converted under its declared encoding; original text is retained.", desc["id"], "error", {"row": record["row"], "field": field, "raw": value["raw"]})
        completeness = desc.get("completeness") or {}
        field = completeness.get("field", self.scope.get("timeField", "ts_recv"))
        chosen = record["time"]["receive" if field in ("ts_recv", "/ts_recv") else "event"]
        if chosen["state"] == "known":
            ns = int(chosen["ns"])
            info["firstTime"] = ns if info["firstTime"] is None else min(ns, info["firstTime"])
            info["lastTime"] = ns if info["lastTime"] is None else max(ns, info["lastTime"])
            outside = ("start" in info["bounds"] and ns < info["bounds"]["start"]) or ("end" in info["bounds"] and ns >= info["bounds"]["end"])
            if outside:
                info["outOfBounds"] += 1
                self.finding("PARTITION_BOUNDS", "Record lies outside the declared half-open partition interval.", desc["id"], "error", {"row": record["row"], "field": field, "value": chosen["raw"]})
        else:
            info["invalidTimes"] += 1
        ident = record["identity"]
        if not ident["publisherId"] or not ident["instrumentId"] or not ident["utcDate"]:
            self.finding("INSTRUMENT_SCOPE", "Dataset/publisher/UTC-date/instrument identity is incomplete.", desc["id"], "error", {"row": record["row"]})
        if primary and not ident["currency"]:
            summary["unknownCurrencyRecords"] += 1
        if primary and ident["dataset"] == "XNAS.ITCH" and ident["utcDate"] and ident["utcDate"] < "2023-11-28":
            summary["preIdCutoffRecords"] += 1
        if record["schema"] == "definition":
            summary["definitionRecords"] += 1
        if record["schema"] == "status":
            summary["statusRecords"] += 1
            for field in ("is_trading", "is_quoting", "is_short_sell_restricted"):
                if str_value(raw.get(field)) not in (None, "", "Y", "N", "~"):
                    self.finding("STATUS_TRISTATE", "Original status value is outside Y/N/~; its observed value remains unchanged.", desc["id"], example={"row": record["row"], "field": field, "value": raw.get(field)})
        if record["flags"].get("state") == "invalid":
            self.finding("FLAGS_INVALID", "Original flags are not a valid unsigned8-bit mask.", desc["id"], "error", {"row": record["row"], "raw": record["flags"]["raw"]})
        summary["undefinedTypedFields"] += len(record["undefinedFields"])
        summary["mboResetRecords"] += record["schema"] == "mbo" and str_value(raw.get("action")) == "R"
        summary["badTsReceiveRecords"] += bool(record["flags"]["badTsReceive"])
        summary["maybeBadBookRecords"] += bool(record["flags"]["maybeBadBook"])
        if record["flags"]["snapshot"]:
            summary["snapshotFlaggedRecords"] += 1
        if record["time"]["utcMidnight"]:
            summary["utcMidnightRecords"] += 1
        if primary and record["time"]["estAfterHours"]:
            summary["estAfterHoursRecords"] += 1
        key = ident["key"]
        instrument = self.instruments.setdefault(key, {"id": key, "identity": {k: ident[k] for k in ("dataset", "publisherId", "utcDate", "instrumentId")},
                                                       "records": 0, "primaryRecords": 0, "referenceRecords": 0, "rawSymbols": set(),
                                                       "rawInstrumentIds": set(), "currencies": set(), "firstEventNs": None, "lastEventNs": None,
                                                       "snapshotFlaggedRecords": 0, "statusValues": Counter()})
        instrument["records"] += 1
        instrument["primaryRecords" if primary else "referenceRecords"] += 1
        for field, target in (("rawSymbol", "rawSymbols"), ("rawInstrumentId", "rawInstrumentIds"), ("currency", "currencies")):
            if ident[field]:
                instrument[target].add(ident[field])
        event_ns = record["time"]["event"]["ns"]
        if event_ns is not None:
            n = int(event_ns)
            instrument["firstEventNs"] = n if instrument["firstEventNs"] is None else min(instrument["firstEventNs"], n)
            instrument["lastEventNs"] = n if instrument["lastEventNs"] is None else max(instrument["lastEventNs"], n)
        instrument["snapshotFlaggedRecords"] += bool(record["flags"]["snapshot"])
        if record["schema"] == "status":
            observed = "|".join(str_value(raw.get(f)) or "" for f in ("action", "is_trading", "is_quoting", "is_short_sell_restricted"))
            instrument["statusValues"][observed] += 1
        session_key = (ident["dataset"], ident["publisherId"], ident["utcDate"], record["time"]["newYorkDate"], record["time"]["session"])
        session = self.sessions.setdefault(session_key, {"id": "session:" + digest(session_key)[:24],
                    "dataset": ident["dataset"], "publisherId": ident["publisherId"], "utcDate": ident["utcDate"],
                    "newYorkDate": record["time"]["newYorkDate"], "session": record["time"]["session"],
                    "records": 0, "primaryRecords": 0, "referenceRecords": 0, "estAfterHoursRecords": 0, "utcMidnightRecords": 0})
        session["records"] += 1
        session["primaryRecords" if primary else "referenceRecords"] += 1
        session["estAfterHoursRecords"] += bool(record["time"]["estAfterHours"])
        session["utcMidnightRecords"] += bool(record["time"]["utcMidnight"])
        if self.page_request is not None:
            offset, limit = self.page_request
            if self.page_seen >= offset and len(self.record_page) < limit and not self.page_byte_limited:
                size = len(dumps(record).encode())
                if self.page_bytes + size > PAGE_BYTES and self.record_page:
                    self.page_byte_limited = True
                else:
                    require(size <= PAGE_BYTES, "RECORD_PAGE_SIZE", "One original normalized record exceeds the native presentation limit; use complete streaming export.")
                    self.record_page.append(record)
                    self.page_bytes += size
            self.page_seen += 1

    def scan(self, sink=None, comparison_side=None):
        for info in self.sources:
            desc = info["descriptor"]
            if desc.get("kind", "records") != "records":
                continue
            for row, raw in self._rows(info):
                record = self.normalize(info, row, raw)
                self._observe(info, record)
                if comparison_side is not None and record["role"] == "primary":
                    self._index_comparison(record, comparison_side)
                if sink is not None:
                    sink(record)
            completeness = desc.get("completeness") or {}
            expected = completeness.get("records")
            if expected is not None and (isinstance(expected, bool) or str(info["records"]) != str(expected)):
                self.finding("RECORD_COUNT_MISMATCH", "The full selected source count differs from its declared original count.", desc["id"], "error",
                             {"declared": expected, "observed": info["records"]})
            if info["coverage"] not in ("complete-partition", "complete-response"):
                self.finding("SOURCE_COVERAGE", "Every retained record was processed; the source declares partial or unknown upstream coverage.", desc["id"],
                             example=info["coverage"])
            if info["coverage"] == "complete-partition" and completeness.get("completeWithinCorpus") is not True:
                self.finding("PARTITION_CORPUS", "Partition completeness is not bound to the retained original corpus.", desc["id"])
        self.summary["instrumentCount"] = len(self.instruments)
        for instrument in self.instruments.values():
            if len(instrument["rawSymbols"]) > 1 or len(instrument["rawInstrumentIds"]) > 1:
                self.finding("SCOPED_IDENTITY_VARIANTS", "More than one observed symbol/venue identity occurs within one dataset/publisher/UTC-date/instrument scope.",
                             example={"identity": instrument["id"], "symbols": sorted(instrument["rawSymbols"]), "venueIds": sorted(instrument["rawInstrumentIds"])})
        if self.summary["unknownCurrencyRecords"]:
            self.finding("CURRENCY_NOT_SUPPLIED", "Currency is unknown where no actual effective definition supplies it; prices are not silently labelled USD.",
                         count=self.summary["unknownCurrencyRecords"])
        for job in self.batch_jobs.values():
            if "summary" in job and "details" not in job:
                self.finding("BATCH_DETAILS_REQUIRED", "The retained batch summary has no separately bound original get_job_details response.",
                             job.get("summarySourceId"), example=job["id"])
        self._partition_coverage()
        return self

    def _partition_coverage(self):
        primary = [s for s in self.sources if s["descriptor"].get("kind", "records") == "records" and s["descriptor"].get("role", "primary") == "primary"]
        self.scope_coverage = {"state": "unknown", "retainedSources": len(primary), "allRecordsProcessed": True,
                               "scopeKind": self.scope.get("gateway"), "sequenceGapsImplyMissingData": False}
        if not primary:
            return
        if all(s["coverage"] == "complete-response" for s in primary):
            self.scope_coverage["state"] = "complete-returned-responses"
            return
        ranges = []
        for source in primary:
            c = source["descriptor"].get("completeness") or {}
            if c.get("status") != "complete-partition" or not c.get("completeWithinCorpus") or not c.get("start") or not c.get("end") or source["outOfBounds"]:
                return
            start = timestamp(c["start"], "integer-nanos" if str(c["start"]).isdigit() else "iso8601-nanoseconds")
            end = timestamp(c["end"], "integer-nanos" if str(c["end"]).isdigit() else "iso8601-nanoseconds")
            if start["state"] != "known" or end["state"] != "known":
                return
            ranges.append((int(start["ns"]), int(end["ns"])))
        ranges.sort()
        start = timestamp(self.scope.get("start"), "integer-nanos" if str(self.scope.get("start", "")).isdigit() else "iso8601-nanoseconds")
        end = timestamp(self.scope.get("end"), "integer-nanos" if str(self.scope.get("end", "")).isdigit() else "iso8601-nanoseconds")
        if start["state"] != "known" or end["state"] != "known":
            return
        cursor, overlaps = int(start["ns"]), 0
        for lo, hi in ranges:
            if lo > cursor:
                self.finding("PARTITION_COVERAGE_GAP", "Declared complete retained partitions do not cover the entire selected scope.", severity="error",
                             example={"fromNs": str(cursor), "toNs": str(lo)})
                return
            if lo < cursor and hi > int(start["ns"]):
                overlaps += 1
            cursor = max(cursor, hi)
        if cursor < int(end["ns"]):
            self.finding("PARTITION_COVERAGE_GAP", "Declared complete retained partitions end before the selected scope.", severity="error",
                         example={"fromNs": str(cursor), "toNs": end["ns"]})
            return
        if overlaps:
            self.finding("PARTITION_OVERLAP", "Selected complete partitions overlap; original records are retained and are not silently deduplicated.", count=overlaps)
        self.scope_coverage["state"] = "complete-retained-partitions"

    def setup_comparison(self):
        if not self.comparison["requested"]:
            self.comparison["reasons"] = ["No explicit production-preview baseline was selected."]
            return
        baseline_id = self.edition.get("compareToEditionId")
        before = next((e for e in self.document["editions"] if e["id"] == baseline_id), None)
        reasons = []
        if self.edition["role"] != "preview" or before is None or before.get("role") != "baseline":
            reasons.append("Comparison requires an explicit preview edition and a baseline-role target.")
        if before:
            a, b = before["scope"], self.scope
            if a.get("gateway") != "historical" or b.get("gateway") != "preview":
                reasons.append("Gateway roles must be explicitly historical and preview.")
            for key in ("dataset", "schema", "stypeIn", "start", "end", "timeField"):
                if a.get(key) != b.get(key):
                    reasons.append(f"Source scope differs: {key}.")
            if sorted(a.get("symbols") or []) != sorted(b.get("symbols") or []):
                reasons.append("Selected source symbols differ.")
            def projection(edition):
                return sorted({dumps([s.get("format"), s.get("schema", edition["scope"]["schema"]), s.get("encoding")])
                               for s in edition["sources"] if s.get("role", "primary") == "primary" and s.get("kind", "records") == "records"})
            if projection(before) != projection(self.edition):
                reasons.append("Original record representations/encodings differ.")
        self.comparison["reasons"] = reasons
        if reasons:
            self.finding("COMPARISON_SCOPE", "Retained editions were assessed independently because explicit source comparison requirements differ.",
                         example=reasons)
            return
        self.comparison["eligible"] = True
        self.db_dir = tempfile.TemporaryDirectory(prefix="databento-migration-")
        self.db = sqlite3.connect(str(Path(self.db_dir.name) / "comparison.sqlite3"))
        self.db.execute("PRAGMA journal_mode=OFF")
        self.db.execute("PRAGMA synchronous=OFF")
        self.db.execute("CREATE TABLE events (side TEXT, event_key TEXT, n INTEGER, digest TEXT, record_id TEXT, source_id TEXT, row_no INTEGER, instrument TEXT, anchor TEXT, PRIMARY KEY(side,event_key))")
        self.baseline = Assessment(self.path, self.document, baseline_id)
        self.baseline.db = self.db
        self.baseline.scan(comparison_side="baseline")
        self.baseline.db = None

    def _index_comparison(self, record, side):
        ident, raw = record["identity"], record["record"]
        anchor = ("venue:" + ident["rawInstrumentId"]) if ident["rawInstrumentId"] else ("symbol:" + ident["rawSymbol"]) if ident["rawSymbol"] else ("instrument:" + str(ident["instrumentId"]))
        fields = [ident["dataset"], ident["publisherId"], ident["utcDate"], anchor, record["schema"],
                  record["time"]["event"]["ns"], str_value(raw.get("sequence")), str_value(raw.get("order_id")),
                  str_value(raw.get("action")), str_value(raw.get("side")), str_value(raw.get("depth"))]
        event_key = digest(fields)
        canonical = json.dumps(raw, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        field_hash = hashlib.sha256(canonical.encode()).hexdigest()
        self.db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(side,event_key) DO UPDATE SET n=n+1",
                        (side, event_key, 1, field_hash, record["id"], record["sourceId"], record["row"], ident["instrumentId"], anchor))

    def changes(self):
        if self.db is None:
            return
        query = """SELECT a.event_key,a.n,b.n,a.digest,b.digest,a.record_id,b.record_id,a.source_id,b.source_id,
                          a.row_no,b.row_no,a.instrument,b.instrument,a.anchor
                   FROM events a LEFT JOIN events b ON b.side='preview' AND b.event_key=a.event_key
                   WHERE a.side='baseline'
                   UNION ALL
                   SELECT b.event_key,NULL,b.n,NULL,b.digest,NULL,b.record_id,NULL,b.source_id,NULL,b.row_no,NULL,b.instrument,b.anchor
                   FROM events b LEFT JOIN events a ON a.side='baseline' AND a.event_key=b.event_key
                   WHERE b.side='preview' AND a.event_key IS NULL ORDER BY 1"""
        for key, an, bn, ah, bh, aid, bid, ass, bss, ar, br, ai, bi, anchor in self.db.execute(query):
            state = "ambiguous" if (an or 0) > 1 or (bn or 0) > 1 else "added" if an is None else "notSeen" if bn is None else "unchanged" if ah == bh else "changed"
            yield {"id": "change:" + key, "state": state, "baseline": {"recordId": aid, "sourceId": ass, "row": ar, "instrumentId": ai, "matches": an} if an else None,
                   "preview": {"recordId": bid, "sourceId": bss, "row": br, "instrumentId": bi, "matches": bn} if bn else None,
                   "identityAnchor": anchor, "instrumentIdChanged": bool(an == 1 and bn == 1 and ai != bi),
                   "baselineSha256": ah, "previewSha256": bh}

    def finish_comparison(self):
        if self.db is None:
            return
        self.db.commit()
        counts = Counter()
        identity_changes = 0
        for change in self.changes():
            counts[change["state"]] += 1
            identity_changes += change["instrumentIdChanged"]
        self.comparison["counts"] = dict(counts)
        self.comparison["observedInstrumentIdChanges"] = identity_changes
        if counts["ambiguous"]:
            self.finding("AMBIGUOUS_EVENT_MATCH", "Duplicate observed event identities are retained without fabricated one-to-one alignment.", count=counts["ambiguous"])
        if self.baseline:
            self.comparison["baselineSummary"] = dict(self.baseline.summary)
            self.comparison["sourceCoverage"] = {"baseline": self.baseline.scope_coverage, "preview": self.scope_coverage}
            self.comparison["afterHoursObservedDelta"] = self.summary["estAfterHoursRecords"] - self.baseline.summary["estAfterHoursRecords"]
            self.comparison["snapshotFlaggedDelta"] = self.summary["snapshotFlaggedRecords"] - self.baseline.summary["snapshotFlaggedRecords"]

    def public_source(self, info, private=False):
        d = info["descriptor"]
        representation = d.get("representation") or {}
        source = {"id": d["id"], "sha256": d["sha256"], "bytes": d["bytes"], "format": d["format"],
                  "compression": d.get("compression"), "kind": d.get("kind", "records"), "role": d.get("role", "primary"),
                  "dataset": d.get("dataset", self.scope["dataset"]), "schema": d.get("schema", self.scope["schema"]),
                  "encoding": d.get("encoding"), "representation": {k: representation.get(k) for k in ("sourceKind", "dbnVersion", "upgradePolicy", "mapSymbols")},
                  "sourceUrl": safe_url(representation.get("sourceUrl")), "completeness": d.get("completeness"),
                  "corpus": {k: (d.get("corpus") or {}).get(k) for k in ("id", "sha256", "bytes", "records", "partition")},
                  "observed": {"records": info["records"], "rtypes": dict(info["rtypes"]), "firstTimeNs": None if info["firstTime"] is None else str(info["firstTime"]),
                               "lastTimeNs": None if info["lastTime"] is None else str(info["lastTime"]), "outOfBounds": info["outOfBounds"], "decoded": info.get("decoded")}}
        if private:
            source["path"] = d["path"]
            source["originalDescriptor"] = d
        return source

    def instrument_rows(self):
        for key in sorted(self.instruments):
            item = self.instruments[key]
            result = {k: sorted(v) if isinstance(v, set) else str(v) if k in ("firstEventNs", "lastEventNs") and v is not None else dict(v) if isinstance(v, Counter) else v for k, v in item.items()}
            review = self.review_index.get(("instrument", key))
            result["review"] = {"decision": review["decision"] if review else "unreviewed"}
            yield result

    def finding_rows(self):
        for key in sorted(self.findings):
            yield self.findings[key]

    def session_rows(self):
        yield from sorted(self.sessions.values(), key=lambda x: (str(x["utcDate"]), str(x["publisherId"]), x["session"]))

    def view_rows(self, view):
        if view == "findings":
            return self.finding_rows()
        if view == "instruments":
            return self.instrument_rows()
        if view == "sessions":
            return self.session_rows()
        if view == "changes":
            return self.changes() or iter(())
        if view == "sources":
            return (self.public_source(x, True) for x in self.sources)
        raise MigrationError("INSPECTION_VIEW", f"Unknown view {view}.")

    def report(self, private=True):
        findings = list(self.finding_rows())
        summary = {k: dict(v) if isinstance(v, Counter) else v for k, v in self.summary.items()}
        source_summary = {"count": len(self.sources), "coverageStatuses": dict(Counter(s["coverage"] for s in self.sources)),
                          "sourceKinds": dict(Counter((s["descriptor"].get("representation") or {}).get("sourceKind", "unknown") for s in self.sources))}
        after_hours = {"timezone": "America/New_York", "utcWindow": "[00:00,01:00)", "condition": "Eastern Standard Time",
                       "observedRecords": summary["estAfterHoursRecords"], "localDateSemantics": "Previous New York date",
                       "sessionClassification": "Local clock windows only; no exchange holiday calendar is inferred.",
                       "rule": RULE_URLS["nasdaq"]}
        snapshot = {"schemas": ["mbo", "definition", "status"], "observedFlaggedRecords": summary["snapshotFlaggedRecords"],
                    "observedExactMidnightRecords": summary["utcMidnightRecords"], "mask": 32,
                    "definitionAndStatusFlags": "Not inferred when absent from the native schema",
                    "eligibleWeekdays": {"EST": ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], "EDT": ["Tuesday", "Wednesday", "Thursday", "Friday"]},
                    "rule": RULE_URLS["nasdaq"]}
        report = {"schema": REPORT_SCHEMA, "ready": not any(f["severity"] == "error" for f in findings),
                  "title": self.document.get("title", "Databento migration review"),
                  "edition": {k: self.edition.get(k) for k in ("id", "label", "capturedAt", "role", "scope")},
                  "summary": summary, "coverage": self.scope_coverage,
                  "assessment": {
                      "instrumentIdMigration": {"dataset": "XNAS.ITCH", "beforeDate": "2023-11-28", "observedAffectedRecords": summary["preIdCutoffRecords"],
                                                "applicableToObservedRecords": summary["preIdCutoffRecords"] > 0,
                                                "observedInstrumentIdChanges": self.comparison.get("observedInstrumentIdChanges", 0),
                                                "identityScope": "dataset + publisher + UTC date + instrument_id",
                                                "venueIdentifier": "Original definition.raw_instrument_id only", "rule": RULE_URLS["nasdaq"]},
                      "afterHours": after_hours, "midnightSnapshots": snapshot,
                      "batch": {"jobs": len(self.batch_jobs), "withDetails": sum("details" in j for j in self.batch_jobs.values()),
                                "withoutDetails": sum("summary" in j and "details" not in j for j in self.batch_jobs.values()),
                                "summaryFields": ["id", "state", "ts_received"], "detailOperation": "batch.get_job_details(job_id)",
                                "legacyShortRemovedOn": "2026-10-27", "rule": RULE_URLS["batch"]},
                      "comparison": self.comparison},
                  "findings": {"total": len(findings), "byCode": dict(Counter({f["code"]: sum(x["count"] for x in findings if x["code"] == f["code"]) for f in findings})),
                               "bySeverity": dict(Counter(f["severity"] for f in findings)), "sample": findings[:12]},
                  "sourceSummary": source_summary, "outputColumns": self.document["outputColumns"],
                  "reviewSummary": dict(Counter(r["decision"] for r in self.review_index.values())),
                  "dataExport": {"included": False, "candidateRecords": summary["primaryRecords"], "customerRecords": summary["customerRecords"],
                                 "excludedRecords": summary["excludedPrimaryRecords"],
                                 "command": f"python3 processor.py export --workspace workspace.json --out NEW_DIRECTORY --edition-id {self.edition['id']} --audience operator"}}
        if private:
            report["reviews"] = self.review_events
            report["batchJobs"] = list(self.batch_jobs.values())
        return report


def parse_input(value):
    require(value is None or isinstance(value, dict), "FUNCTION_INPUT", "Function input must be an object.")
    value = value or {}
    limit, offset = value.get("limit", 100), value.get("offset", 0)
    require(isinstance(limit, int) and not isinstance(limit, bool) and 1 <= limit <= 250, "PAGE_LIMIT", "Use limit1 through250.")
    require(isinstance(offset, int) and not isinstance(offset, bool) and offset >= 0, "PAGE_OFFSET", "Use a nonnegative record offset.")
    view = value.get("view", "records")
    require(view in ("records", "findings", "instruments", "sessions", "changes", "sources"), "INSPECTION_VIEW", "Choose an original inspection view.")
    return value, view, offset, limit


def assess(value=None, workspace_path=None, record_page=False, sink=None):
    value, view, offset, limit = parse_input(value)
    # The original native worker imports a saved module without changing CWD.
    # Resolve its retained companion file beside this immutable source module.
    path, document = load_workspace(workspace_path if workspace_path is not None else Path(__file__).with_name("workspace.json"))
    engine = Assessment(path, document, value.get("editionId"), (offset, limit) if record_page and view == "records" else None)
    try:
        engine.setup_comparison()
        engine.scan(sink=sink, comparison_side="preview" if engine.comparison["eligible"] else None)
        engine.finish_comparison()
        return engine
    except BaseException:
        engine.close()
        raise


def bounded(value):
    require(len(dumps(value).encode("utf-8")) <= MAX_NATIVE_BYTES, "NATIVE_OUTPUT_SIZE",
            "This full report exceeds the native1MiB output limit; use the same processor CLI for complete file delivery.")
    return value


def inspect_migration(value=None, *, workspace_path=None):
    value, view, offset, limit = parse_input(value)
    engine = assess(value, workspace_path=workspace_path, record_page=True)
    try:
        report = engine.report()
        if view == "records":
            items, total, byte_limited = engine.record_page, engine.summary["totalRecords"], engine.page_byte_limited
        else:
            items, total, used, byte_limited = [], 0, 0, False
            for item in engine.view_rows(view):
                if total >= offset and len(items) < limit and not byte_limited:
                    n = len(dumps(item).encode())
                    if used + n > PAGE_BYTES and items:
                        byte_limited = True
                    else:
                        require(n <= PAGE_BYTES, "VIEW_ITEM_SIZE", "One full item exceeds the native presentation limit; use streaming export.")
                        items.append(item)
                        used += n
                total += 1
        next_offset = min(total, offset + len(items))
        return bounded({"schema": "tj.databento-migration-inspection.v1", "report": report,
                        "page": {"view": view, "offset": offset, "requestedLimit": limit, "limit": len(items), "total": total,
                                 "items": items, "nextOffset": next_offset, "hasMore": next_offset < total, "byteLimited": byte_limited}})
    finally:
        engine.close()


def file_record(name, body, content_type):
    data = body.encode("utf-8")
    return {"name": name, "contentType": content_type, "body": body, "bytes": len(data), "sha256": digest(data)}


def report_html(report):
    esc = lambda x: html.escape(str(x), quote=True)
    rows = "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in report["summary"].items() if not isinstance(v, dict))
    findings = "".join(f"<li><strong>{esc(f['code'])}</strong> ({f['count']}): {esc(f['message'])}</li>" for f in report["findings"]["sample"])
    comparison = report["assessment"]["comparison"]
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Databento migration review</title><style>body{font:15px system-ui,sans-serif;max-width:1050px;margin:40px auto;padding:0 24px;color:#202020;background:#fff}h1{font-size:28px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%}th,td{padding:9px;text-align:left;border-bottom:1px solid #ccc}th{width:62%;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:16px}small{color:#555}li{margin:12px 0}</style>
<h1>""" + esc(report["title"]) + "</h1><p>" + esc(report["edition"]["label"] or report["edition"]["id"]) + " · " + esc(report["edition"]["role"]) + "</p><h2>Complete source assessment</h2><table>" + rows + "</table><h2>Source scope</h2><pre>" + esc(json.dumps(report["edition"]["scope"], indent=2)) + "</pre><h2>Migration comparison</h2><pre>" + esc(json.dumps(comparison, indent=2)) + "</pre><h2>Findings</h2><ul>" + findings + "</ul><h2>Data delivery</h2><p>" + esc("Complete mapped records are included." if report["dataExport"]["included"] else "This native report is compact. Use the complete streaming export for every mapped primary record.") + "</p><pre>" + esc(report["dataExport"]["command"]) + "</pre><p><small>Original timestamp and price lexemes remain exact. Dataset, publisher and UTC date scope instrument identity. Source coverage and named operator review are separate facts.</small></p></html>\n"


def small_files(engine, include_operator=True, complete_data=False):
    customer = engine.report(False)
    operator = engine.report(True)
    for r in (customer, operator):
        r["dataExport"]["included"] = complete_data
    sources = {"schema": "tj.databento-source-index.v1", "editionId": engine.edition["id"],
               "sources": [engine.public_source(x) for x in engine.sources], "coverage": engine.scope_coverage}
    columns = {"schema": "tj.databento-output-columns.v1", "columns": engine.document["outputColumns"],
               "missingValues": "JSON null; empty CSV field", "priceAndTimestampUnits": "Declared per original source; exact text retained"}
    delivery = (
        "# Databento migration delivery\n\n"
        f"Edition: {engine.edition['id']}. Source role: {engine.edition['role']}.\n\n"
        f"Every selected source was processed: {engine.summary['totalRecords']} original records, including "
        f"{engine.summary['primaryRecords']} primary and {engine.summary['referenceRecords']} reference records. "
        f"Customer selection contains {engine.summary['customerRecords']} primary records; "
        f"{engine.summary['excludedPrimaryRecords']} were explicitly excluded by operator decisions.\n\n"
        + ("The complete mapped records are in mapped-records.ndjson and mapped-records.csv.\n\n" if complete_data
           else "These compact native report files do not contain the full mapped dataset. Run the same source processor to produce complete files:\n\n")
        + "    " + customer["dataExport"]["command"] + "\n\n"
        "Original source hashes, representation, corpus identity and declared completeness are in source-index.json. "
        "Customer files do not contain private reviewer names/notes. Native full portable workspace and original source custody remain with the operator.\n\n"
        "Prices use exact fixed-point integer strings and original decimal lexemes; missing currency remains unknown. "
        "The status action and independent Y/N/~ fields are preserved. A sequence gap in a symbol-scoped sample does not by itself prove missing data.\n\n"
        "Production-preview migration findings require explicit matching source roles/scopes; reference sample assessments do not invent such a pair.\n"
    )
    result = [
        file_record("migration-summary.json", dumps(customer) + "\n", "application/json"),
        file_record("migration-summary.html", report_html(customer), "text/html; charset=utf-8"),
        file_record("source-index.json", dumps(sources) + "\n", "application/json"),
        file_record("output-columns.json", dumps(columns) + "\n", "application/json"),
        file_record("DELIVERY.md", delivery, "text/markdown; charset=utf-8"),
    ]
    if include_operator:
        result.extend([
            file_record("migration-report.json", dumps(operator) + "\n", "application/json"),
            file_record("review-decisions.json", dumps({"schema": "tj.databento-review-history.v1", "editionId": engine.edition["id"], "reviews": engine.review_events}) + "\n", "application/json"),
        ])
    return result


def build_migration(value=None, *, workspace_path=None):
    engine = assess(value, workspace_path=workspace_path)
    try:
        return bounded({"schema": "tj.databento-migration-build.v1", "report": engine.report(), "files": small_files(engine)})
    finally:
        engine.close()


def customer_migration(value=None, *, workspace_path=None):
    engine = assess(value, workspace_path=workspace_path)
    try:
        return bounded({"schema": "tj.databento-customer-migration.v1", "report": engine.report(False), "files": small_files(engine, False)})
    finally:
        engine.close()


def mapped_row(record, columns):
    return {column["name"]: pointer(record, column["path"]) for column in columns}


def csv_cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list, bool)):
        return dumps(value)
    return str(value)


def export_complete(workspace_path, output, edition_id=None, audience="operator"):
    require(audience in ("operator", "customer"), "EXPORT_AUDIENCE", "Use operator or customer.")
    path, document = load_workspace(workspace_path)
    output = Path(output).resolve()
    require(not output.exists(), "EXPORT_EXISTS", "Choose a new output directory; completed deliveries are immutable.")
    require(output.parent.is_dir(), "EXPORT_PARENT", "The delivery parent directory must already exist.")
    temp = Path(tempfile.mkdtemp(prefix=output.name + ".pending-", dir=output.parent))
    engine = None
    try:
        customer_dir = temp / "customer"
        customer_dir.mkdir()
        columns = document["outputColumns"]
        emitted = 0
        with (customer_dir / "mapped-records.ndjson").open("w", encoding="utf-8", newline="") as ndjson, (customer_dir / "mapped-records.csv").open("w", encoding="utf-8", newline="") as csv_file:
            writer = csv.writer(csv_file, lineterminator="\n")
            writer.writerow([x["name"] for x in columns])
            def sink(record):
                nonlocal emitted
                if record["role"] != "primary" or record["excluded"]:
                    return
                mapped = mapped_row(record, columns)
                ndjson.write(dumps(mapped) + "\n")
                writer.writerow([csv_cell(mapped[x["name"]]) for x in columns])
                emitted += 1
            engine = assess({"editionId": edition_id} if edition_id else {}, workspace_path=path, sink=sink)
            for f in (ndjson, csv_file):
                f.flush()
                os.fsync(f.fileno())
        require(emitted == engine.summary["customerRecords"], "EXPORT_RECORD_COUNT", "Streamed mapped output differs from the complete assessment.")
        operator_names = {"migration-report.json", "review-decisions.json"}
        if audience == "operator":
            (temp / "operator").mkdir()
        for item in small_files(engine, audience == "operator", True):
            destination = temp / ("operator" if item["name"] in operator_names else "customer") / item["name"]
            with destination.open("wb") as f:
                f.write(item["body"].encode())
                f.flush()
                os.fsync(f.fileno())
        if audience == "operator":
            for name, rows in (("findings", engine.finding_rows()), ("instruments", engine.instrument_rows()),
                               ("sessions", engine.session_rows()), ("changes", engine.changes() or iter(()))):
                with (temp / "operator" / (name + ".ndjson")).open("w", encoding="utf-8", newline="") as f:
                    for item in rows:
                        f.write(dumps(item) + "\n")
                    f.flush()
                    os.fsync(f.fileno())
        files = []
        for p in sorted(temp.rglob("*")):
            if p.is_file():
                size, sha = file_identity(p)
                files.append({"path": p.relative_to(temp).as_posix(), "bytes": size, "sha256": sha})
        manifest = {"schema": "tj.databento-migration-delivery.v1", "audience": audience,
                    "editionId": engine.edition["id"], "workspaceSha256": digest(path.read_bytes()),
                    "processedRecords": engine.summary["totalRecords"], "primaryRecords": engine.summary["primaryRecords"],
                    "customerRecords": emitted, "excludedRecords": engine.summary["excludedPrimaryRecords"],
                    "allSelectedRecordsProcessed": True, "sourceCoverage": engine.scope_coverage,
                    "assessmentReady": engine.report(False)["ready"],
                    "sources": [engine.public_source(s) for s in engine.sources], "files": files}
        with (temp / "manifest.json").open("wb") as f:
            f.write((dumps(manifest) + "\n").encode())
            f.flush()
            os.fsync(f.fileno())
        require(not output.exists(), "EXPORT_EXISTS", "The chosen output directory appeared during delivery.")
        os.rename(temp, output)
        return {"directory": str(output), **manifest}
    finally:
        if engine is not None:
            engine.close()
        if temp.exists():
            shutil.rmtree(temp)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Assess retained Databento records and export every selected mapped record.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "build", "customer", "export"):
        p = sub.add_parser(name)
        p.add_argument("--workspace", required=True)
        p.add_argument("--edition-id")
        if name == "inspect":
            p.add_argument("--view", choices=("records", "findings", "instruments", "sessions", "changes", "sources"), default="records")
            p.add_argument("--offset", type=int, default=0)
            p.add_argument("--limit", type=int, default=100)
        if name == "export":
            p.add_argument("--out", required=True)
            p.add_argument("--audience", choices=("operator", "customer"), default="operator")
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            result = export_complete(args.workspace, args.out, args.edition_id, args.audience)
        else:
            value = {"editionId": args.edition_id} if args.edition_id else {}
            if args.command == "inspect":
                value.update(view=args.view, offset=args.offset, limit=args.limit)
            # The CLI uses its explicit selection; native functions use the saved module directory.
            workspace = Path(args.workspace).resolve()
            result = {"inspect": inspect_migration, "build": build_migration, "customer": customer_migration}[args.command](value, workspace_path=workspace)
        sys.stdout.write(dumps(result) + "\n")
        return 0
    except (MigrationError, OSError, json.JSONDecodeError, csv.Error) as error:
        sys.stderr.write(dumps({"error": getattr(error, "code", type(error).__name__), "message": str(error)}) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
