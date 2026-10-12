"""Exact retained-source Finage market workbench. No acquisition or network I/O."""
from __future__ import annotations
import argparse, base64, collections, csv, datetime as dt, hashlib, html, io, json, os, re, shutil, sys, tempfile
from decimal import Decimal, localcontext, InvalidOperation
from pathlib import Path

SCHEMA = "tj.finage-market-workspace.v1"
MAX_FILE = 8 * 1024 * 1024
MAX_OUTPUT = 1024 * 1024
PAGE_BYTES = 420000
UNITS = {"seconds": 1000000000, "milliseconds": 1000000, "microseconds": 1000, "nanoseconds": 1}
KINDS = {"live-public-provider-endpoint", "live-authorized-provider-api", "live-authorized-provider-stream", "provider-published-documentation-example", "provider-published-response-model"}
FORMATS = {"finage-snapshot-json", "finage-aggregates-json", "finage-websocket-events-v1", "finage-websocket-jsonl", "finage-model-catalog-json"}
VIEWS = ("records", "findings", "symbols", "changes", "sources", "events")

class MarketError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

class Number(str):
    """Original JSON numeric token, deliberately distinct from a JSON string."""

def require(ok, code, message):
    if not ok:
        raise MarketError(code, message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def dumps(value, *, sort=False):
    if isinstance(value, Number):
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return json.dumps(value, allow_nan=False)
    if isinstance(value, Decimal):
        require(value.is_finite(), "NUMBER", "A derived decimal is not finite.")
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(dumps(x, sort=sort) for x in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value) if sort else value
        return "{" + ",".join(dumps(k) + ":" + dumps(value[k], sort=sort) for k in keys) + "}"
    raise MarketError("JSON_TYPE", "Unsupported JSON value: " + type(value).__name__)

def unique_pairs(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, "DUPLICATE_JSON_KEY", "Original JSON repeats a key: " + key)
        out[key] = value
    return out

def loads(data, exact=False):
    try:
        return json.loads(data, object_pairs_hook=unique_pairs, parse_int=Number if exact else int,
                          parse_float=Number if exact else Decimal,
                          parse_constant=lambda x: (_ for _ in ()).throw(MarketError("NONFINITE", "Nonfinite JSON token: " + x)))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise MarketError("JSON", "The retained input is not complete UTF-8 JSON: " + str(exc)) from exc

def cell(value):
    if value is None:
        return {"kind": "null", "text": None}
    if isinstance(value, Number):
        return {"kind": "number", "text": str(value)}
    if isinstance(value, bool):
        return {"kind": "boolean", "text": "true" if value else "false"}
    if isinstance(value, str):
        return {"kind": "string", "text": value}
    if isinstance(value, (int, Decimal)):
        return {"kind": "number", "text": str(value)}
    return {"kind": "array" if isinstance(value, list) else "object", "text": dumps(value)}

def visible(value):
    if isinstance(value, (Number, Decimal)):
        return cell(value)
    if isinstance(value, dict):
        return {k: visible(v) for k, v in value.items()}
    if isinstance(value, list):
        return [visible(v) for v in value]
    return value

def scalar(value):
    return cell(value)["text"]

def decimal(value):
    if value is None or isinstance(value, bool) or isinstance(value, (dict, list)):
        return None
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError):
        return None

def integer(value):
    x = decimal(value)
    return int(x) if x is not None and x == x.to_integral_value() and abs(x) < Decimal("1e30") else None

def pointer(value, path):
    if path == "":
        return value
    if not isinstance(path, str) or not path.startswith("/"):
        return None
    for part in path[1:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", part) and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value

def checked_file(root, item):
    require(isinstance(item, dict), "SOURCE", "A source descriptor must be an object.")
    name = item.get("path")
    require(isinstance(name, str) and "\\" not in name and "\0" not in name
            and not name.startswith("/") and all(p not in ("", ".", "..") for p in name.split("/")),
            "SOURCE_PATH", "Use a safe relative capture path.")
    path = root / name
    require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()),
            "SOURCE_PATH", "The complete source must be a regular file inside the workspace: " + name)
    require(type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_FILE, "SOURCE_SIZE", "A source exceeds the original native 8 MiB file limit.")
    data = path.read_bytes()
    require(len(data) == item["bytes"] and digest(data) == item.get("sha256"), "SOURCE_IDENTITY", "Retained bytes differ from the source descriptor: " + name)
    return data

def source_fingerprint(edition):
    return digest(dumps({"id": edition["id"], "scope": edition.get("scope"), "sources": edition["sources"]}, sort=True).encode())

def iso_seconds(value):
    try:
        date = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if date.tzinfo is None:
            return None
        delta = date.astimezone(dt.timezone.utc) - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
        return Decimal(delta.days * 86400 + delta.seconds) + Decimal(delta.microseconds) / 1000000
    except (ValueError, TypeError, OverflowError):
        return None

def normalized_time(raw, unit):
    out = {"value": raw, "raw": cell(raw), "unit": unit, "unixNs": None, "utc": None}
    if raw is None or unit not in UNITS:
        return out
    value = decimal(raw)
    if value is None:
        out["error"] = "TIMESTAMP_VALUE"
        return out
    with localcontext() as ctx:
        ctx.prec = max(80, min(4096, len(str(raw)) + 40))
        ns = value * UNITS[unit]
        if ns != ns.to_integral_value():
            out["error"] = "SUBNANOSECOND_PRECISION"
            return out
        if abs(ns) >= Decimal("1e30"):
            out["error"] = "TIMESTAMP_RANGE"
            return out
        number = int(ns)
    out["unixNs"] = str(number)
    seconds, fraction = divmod(number, 1000000000)
    if -62135596800 <= seconds <= 253402300799:
        date = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=seconds)
        out["utc"] = date.strftime("%Y-%m-%dT%H:%M:%S") + "." + str(fraction).zfill(9) + "Z"
    else:
        out["error"] = "TIMESTAMP_RANGE"
    return out

DEFAULT_COLUMNS = [
    {"name": name, "path": path} for name, path in [
        ("record_id", "/id"), ("source_id", "/sourceId"), ("source_sha256", "/sourceSha256"),
        ("source_kind", "/sourceKind"), ("record_kind", "/kind"), ("symbol", "/symbol"),
        ("customer_symbol", "/customerSymbol"), ("event_time", "/time/value"),
        ("event_time_kind", "/time/raw/kind"), ("event_time_unit", "/time/unit"),
        ("event_time_unix_ns", "/time/unixNs"), ("event_time_utc", "/time/utc"),
        ("price", "/values/price"), ("bid", "/values/bid"), ("ask", "/values/ask"),
        ("size", "/values/size"), ("bid_size", "/values/bidSize"), ("ask_size", "/values/askSize"),
        ("open", "/values/open"), ("high", "/values/high"), ("low", "/values/low"),
        ("close", "/values/close"), ("volume", "/values/volume"),
        ("capture_order", "/localOrdinal"), ("captured_at", "/capturedAt")]
]

def validate_columns(columns):
    require(isinstance(columns, list) and len(columns) <= 128, "COLUMNS", "Customer columns must be an ordered list of at most 128 fields.")
    seen = set()
    for column in columns:
        require(isinstance(column, dict) and isinstance(column.get("name"), str)
                and column["name"].strip() and len(column["name"]) <= 160 and column["name"] not in seen,
                "COLUMN_NAME", "Each customer column needs a unique nonempty exact label.")
        require(isinstance(column.get("path"), str) and column["path"].startswith("/")
                and len(column["path"]) <= 512, "COLUMN_PATH", "Each column needs a JSON pointer into the normalized record.")
        require(not column["path"].startswith(("/review", "/decision")), "PRIVATE_COLUMN", "Private review decisions are not customer data.")
        seen.add(column["name"])
    return columns

def load_workspace(path=None):
    path = Path(path or "workspace.json").resolve()
    require(path.is_file() and path.stat().st_size <= MAX_FILE, "WORKSPACE", "Use the saved native workspace.json.")
    data = path.read_bytes()
    doc = loads(data)
    require(isinstance(doc, dict) and doc.get("schema") == SCHEMA, "WORKSPACE_SCHEMA", "Use tj.finage-market-workspace.v1.")
    editions = doc.get("editions")
    require(isinstance(editions, list) and editions, "EDITIONS", "Retain at least one original source edition.")
    ids = set()
    known = {}
    for edition in editions:
        require(isinstance(edition, dict) and isinstance(edition.get("id"), str) and edition["id"] and edition["id"] not in ids,
                "EDITION_ID", "Each edition needs one unique exact identity.")
        ids.add(edition["id"])
        require(isinstance(edition.get("scope"), dict) and isinstance(edition.get("sources"), list) and edition["sources"], "EDITION", "Each edition needs original scope and complete sources.")
        source_ids = set()
        for source in edition["sources"]:
            require(isinstance(source, dict) and isinstance(source.get("id"), str) and source["id"] not in source_ids
                    and source.get("format") in FORMATS and source.get("sourceKind") in KINDS,
                    "SOURCE", "Each source needs its exact unique identity, format and provenance.")
            source_ids.add(source["id"])
            known[(edition["id"], source["id"])] = source.get("sha256")
    require(doc.get("selectedEdition") in ids, "EDITION_SELECTION", "Select an existing edition.")
    for field in ("reviews", "symbolMappings", "timeInterpretations"):
        require(isinstance(doc.get(field, []), list), "DECISIONS", field + " must retain ordered decisions.")
        entries = set()
        for entry in doc.get(field, []):
            require(isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry["id"] and entry["id"] not in entries,
                    "DECISION_ID", "Each decision needs one unique retained ID.")
            entries.add(entry["id"])
            require(known.get((entry.get("editionId"), entry.get("sourceId"))) == entry.get("sourceSha256"),
                    "DECISION_SOURCE", "A decision no longer matches its exact original source.")
            require(all(isinstance(entry.get(k), str) and entry[k].strip() for k in ("reviewer", "note", "at"))
                    and iso_seconds(entry["at"]) is not None, "NAMED_DECISION", "Retain reviewer, reason and actual timezone-qualified decision time.")
            if field == "timeInterpretations":
                require(entry.get("unit") in (*UNITS, "uninterpreted"), "TIME_UNIT", "Choose an explicit source time interpretation.")
            elif field == "symbolMappings":
                require(isinstance(entry.get("symbol"), str) and isinstance(entry.get("customerSymbol"), str) and entry["customerSymbol"],
                        "SYMBOL_MAPPING", "Map the exact original symbol to an explicit customer label.")
            else:
                require(entry.get("targetType") in ("source", "finding", "symbol", "record")
                        and isinstance(entry.get("targetId"), str) and entry.get("decision") in ("accept", "exclude", "revisit"),
                        "REVIEW", "Use an explicit review target and accept, exclude or revisit.")
                require(not (entry["targetType"] == "finding" and entry["decision"] == "exclude"), "EXCLUSION_TARGET", "Exclude an original source, symbol or record; findings record acceptance or a revisit.")
    customer = doc.setdefault("customer", {"mode": "all", "columns": []})
    require(customer.get("mode", "all") in ("all", "reviewed"), "CUSTOMER_MODE", "Use all or reviewed customer selection.")
    validate_columns(customer.get("columns", []))
    analysis = doc.setdefault("analysis", {"priceBasis": "native", "staleAfterSeconds": None})
    require(analysis.get("priceBasis", "native") in ("native", "midpoint"), "PRICE_BASIS", "Select native or explicit quote midpoint.")
    stale = analysis.get("staleAfterSeconds")
    require(stale is None or (decimal(stale) is not None and decimal(stale) >= 0), "STALENESS", "Choose null or an exact nonnegative stale threshold.")
    return path, doc, data


def first(raw, names):
    return next((raw[k] for k in names if k in raw), None)

def record_kind(raw):
    if any(k in raw for k in ("a", "ap")) and any(k in raw for k in ("b", "bp")):
        return "quote"
    if all(k in raw for k in ("o", "h", "l", "c")):
        return "bar"
    if "p" in raw:
        return "trade"
    return "observation"

def source_items(root, edition, source):
    """Yield record/event markers; never substitute capture time for source time."""
    data = checked_file(root, source)
    for meta in source.get("metadata", []):
        checked_file(root, meta)
    fmt = source["format"]
    if fmt in ("finage-websocket-events-v1", "finage-websocket-jsonl"):
        previous_ordinal = None
        for line_no, line in enumerate(data.splitlines(), 1):
            if not line.strip():
                continue
            original = loads(line, exact=True)
            transport = {"line": line_no, "connectionId": None, "observedAt": None}
            if fmt == "finage-websocket-events-v1":
                require(isinstance(original, dict) and original.get("schema") == "commons.finage.message.v1",
                        "STREAM_ENVELOPE", "Use the original Finage acquisition event envelope.")
                ordinal = integer(original.get("ordinal"))
                require(ordinal is not None and (previous_ordinal is None or ordinal > previous_ordinal),
                        "LOCAL_ORDER", "Capture ordinals must preserve strictly increasing local order.")
                previous_ordinal = ordinal
                transport.update({"ordinal": ordinal, "connectionId": original.get("connectionId"),
                                  "observedAt": original.get("observedAt"), "eventKind": original.get("kind"),
                                  "direction": original.get("direction")})
                event = {**transport, "detail": visible(original.get("detail"))}
                yield "event", "/lines/" + str(line_no), event, transport
                payload = original.get("payload")
                if original.get("direction") != "incoming" or original.get("kind") != "message":
                    continue
                require(isinstance(payload, dict) and payload.get("encoding") == "base64" and payload.get("type") == "text",
                        "STREAM_PAYLOAD", "Incoming text messages require retained exact Base64 payloads.")
                try:
                    decoded = base64.b64decode(payload["base64"], validate=True)
                except (ValueError, KeyError) as exc:
                    raise MarketError("STREAM_BASE64", "Invalid original message payload.") from exc
                require(len(decoded) == integer(payload.get("bytes")) and digest(decoded) == payload.get("sha256"),
                        "STREAM_IDENTITY", "Original application payload bytes differ from their event envelope.")
                original = loads(decoded, exact=True)
            rows = original if isinstance(original, list) else [original]
            for index, raw in enumerate(rows):
                require(isinstance(raw, dict), "STREAM_RECORD", "A provider message must contain object observations.")
                yield "record", "/lines/" + str(line_no) + "/" + str(index), raw, transport
        return
    body = loads(data, exact=True)
    if fmt == "finage-snapshot-json":
        require(isinstance(body, dict), "SNAPSHOT", "The complete snapshot body must be an object.")
        symbols = set()
        count = 0
        for name, kind in (("lastQuotes", "quote"), ("lastTrades", "trade")):
            require(name in body, "SNAPSHOT_COLLECTION", "The original snapshot must retain " + name + ", including null.")
            rows = body[name]
            require(rows is None or isinstance(rows, list), "SNAPSHOT_COLLECTION", name + " must be an original list or null.")
            if rows is not None:
                for index, raw in enumerate(rows):
                    require(isinstance(raw, dict), "SNAPSHOT_RECORD", "Snapshot observations must be objects.")
                    symbol = first(raw, ("s", "symbol"))
                    if isinstance(symbol, str) and not isinstance(symbol, Number):
                        symbols.add(symbol)
                    count += 1
                    yield "record", "/" + name + "/" + str(index), raw, {"kind": kind}
        yield "source-summary", "/", {
            "reportedTotalResults": cell(body.get("totalResults")), "uniqueExactSymbols": len(symbols),
            "lastQuotes": None if body.get("lastQuotes") is None else len(body["lastQuotes"]),
            "lastTrades": None if body.get("lastTrades") is None else len(body["lastTrades"]),
            "reportedCountMatches": integer(body.get("totalResults")) == len(symbols), "records": count}, {}
    elif fmt == "finage-aggregates-json":
        require(isinstance(body, dict) and isinstance(body.get("results"), list), "AGGREGATES", "Retain the complete aggregate object and results array.")
        symbol = first(body, ("symbol", "ticker", "s"))
        for index, raw in enumerate(body["results"]):
            require(isinstance(raw, dict), "AGGREGATE_RECORD", "Aggregate records must be objects.")
            yield "record", "/results/" + str(index), raw, {"kind": "bar", "symbol": symbol}
        query = source.get("request", {}).get("query", {})
        limit = integer(query.get("limit", 100))
        yield "source-summary", "/", {"records": len(body["results"]), "providerFields": visible({k: v for k, v in body.items() if k != "results"}),
              "mayBeCapped": limit is not None and len(body["results"]) >= limit, "pageChainComplete": source.get("coverage", {}).get("pageChainComplete")}, {}
    else:
        require(isinstance(body, list), "MODEL_CATALOG", "Retain the original model catalog array.")
        for index, model in enumerate(body):
            require(isinstance(model, dict) and isinstance(model.get("structure"), str), "MODEL_STRUCTURE", "Each model needs its original JSON structure string.")
            raw = loads(model["structure"], exact=True)
            for nested, value in enumerate(raw if isinstance(raw, list) else [raw]):
                require(isinstance(value, dict), "MODEL_RECORD", "A published model must describe an object observation.")
                yield "record", "/" + str(index) + "/structure/" + str(nested), value, {
                    "modelId": scalar(model.get("id")), "modelName": model.get("name"), "referenceModel": True}
        yield "source-summary", "/", {"modelDefinitions": len(body)}, {}

class Assessment:
    def __init__(self, path, document, workspace_bytes, edition_id, view="records", offset=0, limit=100, sink=None):
        self.path, self.root, self.document = path, path.parent, document
        self.workspace_sha = digest(workspace_bytes)
        self.edition = next((x for x in document["editions"] if x["id"] == edition_id), None)
        require(self.edition is not None, "EDITION_SELECTION", "The requested edition does not exist.")
        self.fingerprint = source_fingerprint(self.edition)
        self.view, self.offset, self.limit, self.sink = view, offset, limit, sink
        self.page, self.page_total, self.page_bytes, self.byte_limited = [], 0, 0, False
        self.findings, self.symbols, self.sources, self.events = {}, {}, [], []
        self.summary = collections.Counter()
        self.source_counts = {}
        self.observation_keys = set()
        self.columns = validate_columns(document.get("customer", {}).get("columns", [])) or DEFAULT_COLUMNS
        self.active_reviews, self.times, self.mappings = {}, {}, {}
        for name, target in (("reviews", self.active_reviews), ("timeInterpretations", self.times), ("symbolMappings", self.mappings)):
            for entry in document.get(name, []):
                if entry["editionId"] != self.edition["id"]:
                    continue
                key = (entry["sourceId"], entry["targetType"], entry["targetId"]) if name == "reviews" else (
                    (entry["sourceId"], entry["symbol"]) if name == "symbolMappings" else entry["sourceId"])
                target[key] = entry
        self.review_events = [x for x in document.get("reviews", []) if x["editionId"] == self.edition["id"]]
        self.comparison = {"status": "not-selected", "baselineEditionId": self.edition.get("compareToEdition"),
                           "sameScope": None, "added": 0, "removed": 0, "changed": 0, "unchanged": 0, "ambiguousKeys": 0}
        self.change_rows, self.baseline, self.current_keys = [], {}, set()

    def present(self, item):
        self.page_total += 1
        if self.page_total <= self.offset or len(self.page) >= self.limit or self.byte_limited:
            return
        value = visible(item)
        size = len(dumps(value).encode())
        require(size <= PAGE_BYTES, "VIEW_ITEM_SIZE", "One complete item exceeds the native page size; use the complete export.")
        if self.page_bytes + size > PAGE_BYTES and self.page:
            self.byte_limited = True
            return
        self.page.append(value)
        self.page_bytes += size

    def decision(self, source, kind, target):
        return self.active_reviews.get((source["id"], kind, target))

    def finding(self, source, code, message, record=None):
        identity = "finding-" + digest((source["sha256"] + "\0" + code).encode())
        if identity not in self.findings:
            review = self.decision(source, "finding", identity) or self.decision(source, "source", source["id"])
            self.findings[identity] = {"id": identity, "sourceId": source["id"], "sourceSha256": source["sha256"],
                "code": code, "message": message, "count": 0, "sampleRecords": [], "decision": review.get("decision") if review else None}
        item = self.findings[identity]
        item["count"] += 1
        if record and len(item["sampleRecords"]) < 8:
            item["sampleRecords"].append(record["id"])

    def normalize(self, source, raw, source_pointer, transport, ordinal):
        symbol = first(raw, ("s", "symbol"))
        if symbol is None:
            symbol = transport.get("symbol")
        symbol = symbol if isinstance(symbol, str) and not isinstance(symbol, Number) else None
        role = "reference" if self.edition.get("role") == "reference" or source["sourceKind"].startswith("provider-published-") or transport.get("referenceModel") else "primary"
        kind = transport.get("kind") or record_kind(raw)
        selected_time = self.times.get(source["id"])
        unit = selected_time["unit"] if selected_time else "uninterpreted"
        time = normalized_time(first(raw, ("t", "timestamp")), unit)
        time.update({"decisionId": selected_time["id"] if selected_time else None,
                     "declaredUnit": source.get("timestampUnit") or source.get("provenance", {}).get("timestampUnitDeclared")})
        values = {"price": first(raw, ("p",)), "bid": first(raw, ("b", "bp")), "ask": first(raw, ("a", "ap")),
                  "size": first(raw, ("sz", "q", "v")), "bidSize": first(raw, ("bsz", "bs")),
                  "askSize": first(raw, ("asz", "as")), "open": raw.get("o"), "high": raw.get("h"),
                  "low": raw.get("l"), "close": raw.get("c"), "volume": raw.get("v")}
        if self.document.get("analysis", {}).get("priceBasis", "native") == "midpoint" and kind == "quote":
            bid, ask = decimal(values["bid"]), decimal(values["ask"])
            if bid is not None and ask is not None:
                with localcontext() as ctx:
                    ctx.prec = max(80, min(4096, len(str(bid)) + len(str(ask)) + 10))
                    values["price"] = Number(str((bid + ask) / 2))
        identity = "record-" + digest((self.edition["id"] + "\0" + source["sha256"] + "\0" + source_pointer).encode())
        mapping = self.mappings.get((source["id"], symbol))
        record = {"id": identity, "editionId": self.edition["id"], "sourceId": source["id"], "sourceSha256": source["sha256"],
                  "sourceKind": source["sourceKind"], "role": role, "kind": kind, "sourcePointer": source_pointer,
                  "symbol": symbol, "customerSymbol": mapping["customerSymbol"] if mapping else symbol,
                  "capturedAt": source.get("capturedAt"), "localOrdinal": ordinal,
                  "raw": raw, "fields": {k: cell(v) for k, v in raw.items()}, "values": values, "time": time,
                  "transport": transport, "excluded": False}
        decision = self.decision(source, "record", identity) or (self.decision(source, "symbol", symbol) if symbol else None) or self.decision(source, "source", source["id"])
        record["excluded"] = bool(decision and decision["decision"] == "exclude") or (
            self.document.get("customer", {}).get("mode") == "reviewed" and not (decision and decision["decision"] == "accept"))
        return record


    def comparison_key(self, record):
        parts = [record["kind"], record["symbol"]]
        if record["kind"] == "bar":
            parts.append(record["time"]["raw"])
        return dumps(parts, sort=True)

    def prepare_comparison(self):
        baseline_id = self.edition.get("compareToEdition")
        if not baseline_id:
            return
        previous = next((x for x in self.document["editions"] if x["id"] == baseline_id), None)
        require(previous is not None and previous["id"] != self.edition["id"], "COMPARISON_EDITION", "Select another existing original baseline.")
        self.comparison["sameScope"] = dumps(previous["scope"], sort=True) == dumps(self.edition["scope"], sort=True)
        if not self.comparison["sameScope"]:
            self.comparison["status"] = "different-scope"
            return
        if any(x["format"].startswith("finage-websocket") for x in self.edition["sources"] + previous["sources"]):
            self.comparison["status"] = "stream-intervals-not-aligned"
            return
        prior = Assessment(self.path, self.document, b"", baseline_id)
        def units(engine):
            grouped = collections.defaultdict(set)
            for source in engine.edition["sources"]:
                grouped[(source.get("operation"), source["format"])].add(engine.times.get(source["id"], {}).get("unit", "uninterpreted"))
            return {k: sorted(v) for k, v in grouped.items()}
        if units(prior) != units(self):
            self.comparison["status"] = "different-time-interpretation"
            return
        self.comparison["status"] = "compared"
        self.comparison["priceBasis"] = self.document.get("analysis", {}).get("priceBasis", "native")
        for source in previous["sources"]:
            ordinal = 0
            for kind, path, raw, transport in source_items(self.root, previous, source):
                if kind != "record":
                    continue
                ordinal += 1
                record = prior.normalize(source, raw, path, transport, ordinal)
                key = self.comparison_key(record)
                if key in self.baseline:
                    self.baseline[key] = None
                else:
                    self.baseline[key] = record

    def compare_record(self, record):
        if self.comparison["status"] != "compared":
            return
        key = self.comparison_key(record)
        if key in self.current_keys:
            self.comparison["ambiguousKeys"] += 1
            self.change_rows.append({"status": "ambiguous-current-key", "key": loads(key), "recordId": record["id"]})
            return
        self.current_keys.add(key)
        if key not in self.baseline:
            self.comparison["added"] += 1
            self.change_rows.append({"status": "added", "key": loads(key), "after": visible(record["raw"]), "recordId": record["id"]})
            return
        prior = self.baseline[key]
        if prior is None:
            self.comparison["ambiguousKeys"] += 1
            self.change_rows.append({"status": "ambiguous-baseline-key", "key": loads(key), "recordId": record["id"]})
            return
        fields = []
        for field in sorted(set(prior["raw"]) | set(record["raw"])):
            before, after = prior["raw"].get(field), record["raw"].get(field)
            missing_before, missing_after = field not in prior["raw"], field not in record["raw"]
            if dumps(before) == dumps(after) and missing_before == missing_after:
                continue
            item = {"field": field, "before": cell(before), "after": cell(after),
                    "beforeMissing": missing_before, "afterMissing": missing_after, "decimalDelta": None}
            if not missing_before and not missing_after and cell(before)["kind"] == cell(after)["kind"] == "number":
                a, b = decimal(before), decimal(after)
                if a is not None and b is not None:
                    with localcontext() as ctx:
                        ctx.prec = max(80, min(4096, len(str(a)) + len(str(b)) + 10))
                        item["decimalDelta"] = str(b - a)
            fields.append(item)
        if fields:
            self.comparison["changed"] += 1
            self.change_rows.append({"status": "changed", "key": loads(key), "beforeRecordId": prior["id"],
                                     "recordId": record["id"], "fields": fields})
        else:
            self.comparison["unchanged"] += 1

    def observe(self, source, record):
        s = self.summary
        s["totalRecords"] += 1
        s[record["role"] + "Records"] += 1
        s[record["kind"] + "Records"] += 1
        if source["format"] == "finage-snapshot-json":
            key = (source["id"], record["kind"], record["symbol"])
            if key in self.observation_keys:
                self.finding(source, "DUPLICATE_SNAPSHOT_SYMBOL", "The snapshot repeats an exact symbol within the same quote/trade collection.", record)
            self.observation_keys.add(key)
        if record["role"] == "primary":
            s["excludedPrimaryRecords" if record["excluded"] else "customerRecords"] += 1
        if record["symbol"] is None:
            self.finding(source, "MISSING_SYMBOL", "The original observation has no exact textual symbol.", record)
        else:
            key = (source["id"], record["symbol"])
            item = self.symbols.setdefault(key, {"id": record["symbol"], "symbol": record["symbol"],
                "sourceId": source["id"], "sourceSha256": source["sha256"], "records": 0,
                "customerSymbol": record["customerSymbol"], "kinds": collections.Counter()})
            item["records"] += 1
            item["kinds"][record["kind"]] += 1
        time = record["time"]
        if time["raw"]["kind"] == "null" and record["kind"] in ("trade", "quote", "bar"):
            self.finding(source, "MISSING_TIMESTAMP", "This original market observation has no event timestamp.", record)
        if time["declaredUnit"] in UNITS and time["unit"] in UNITS and time["declaredUnit"] != time["unit"]:
            self.finding(source, "DECLARED_TIME_DIFFERENCE", "The explicit operator interpretation differs from the retained provider unit declaration.", record)
        if time["raw"]["kind"] != "null" and time["unit"] == "uninterpreted":
            self.finding(source, "TIME_INTERPRETATION", "Event timestamp units have not been explicitly interpreted for this source.", record)
        if decimal(time["raw"]["text"]) == 0:
            self.finding(source, "ZERO_TIMESTAMP", "An original event timestamp is zero; it was retained unchanged.", record)
        if time.get("error"):
            self.finding(source, time["error"], "The selected event-time interpretation cannot represent this original value exactly.", record)
        threshold = self.document.get("analysis", {}).get("staleAfterSeconds")
        capture = iso_seconds(source.get("capturedAt"))
        if time["unixNs"] is not None and capture is not None:
            age = capture - Decimal(time["unixNs"]) / 1000000000
            if age < 0:
                self.finding(source, "EVENT_AFTER_CAPTURE", "The interpreted event time occurs after the recorded source capture.", record)
            elif threshold is not None and age > decimal(threshold):
                self.finding(source, "STALE_OBSERVATION", "The interpreted event exceeds the operator's explicit stale threshold.", record)
        bid, ask = decimal(record["values"]["bid"]), decimal(record["values"]["ask"])
        if bid is not None and ask is not None and bid > ask:
            self.finding(source, "CROSSED_QUOTE", "The original bid is greater than the original ask.", record)
        if record["kind"] == "bar":
            values = [decimal(record["values"][x]) for x in ("open", "high", "low", "close")]
            if all(x is not None for x in values):
                opening, high, low, close = values
                if low > high or not low <= opening <= high or not low <= close <= high:
                    self.finding(source, "BAR_RANGE", "The original OHLC values do not fit the reported high/low range.", record)
        self.compare_record(record)
        if self.view == "records":
            self.present(record)
        if self.sink is not None and record["role"] == "primary" and not record["excluded"]:
            self.sink(record)

    def run(self):
        self.prepare_comparison()
        for source in self.edition["sources"]:
            public = {k: source.get(k) for k in ("id", "operation", "format", "path", "sha256", "bytes", "capturedAt", "sourceKind", "originalWireBytes", "coverage", "inspection", "provenance")}
            public["metadata"] = [{k: m.get(k) for k in ("path", "bytes", "sha256")} for m in source.get("metadata", [])]
            public["role"] = "reference" if self.edition.get("role") == "reference" or source["sourceKind"].startswith("provider-published-") else "primary"
            public["interpretation"] = {k: self.times.get(source["id"], {}).get(k) for k in ("id", "unit")}
            ordinal = 0
            for kind, path, raw, transport in source_items(self.root, self.edition, source):
                if kind == "source-summary":
                    public["processed"] = raw
                    if raw.get("reportedCountMatches") is False:
                        self.finding(source, "REPORTED_COUNT", "Reported snapshot totalResults differs from the unique exact symbols in both original collections.")
                    if raw.get("mayBeCapped"):
                        self.finding(source, "AGGREGATE_LIMIT", "The response reaches its request limit; complete body does not establish complete requested-window coverage.")
                elif kind == "event":
                    event = {"sourceId": source["id"], "sourceSha256": source["sha256"], "sourcePointer": path, **raw}
                    self.events.append(event)
                    if raw.get("eventKind") in ("connection-ended", "reconnect-wait", "unsubscribe-error"):
                        self.finding(source, "STREAM_BOUNDARY", "The original stream includes a connection boundary; retained intervals are not assumed continuous.")
                    if raw.get("eventKind", "").startswith("credential-redacted"):
                        self.finding(source, "REDACTED_MESSAGE", "This retained derivative redacts credentials; original byte identity stays distinct.")
                else:
                    ordinal += 1
                    self.observe(source, self.normalize(source, raw, path, transport, ordinal))
            public["processedRecords"] = ordinal
            self.source_counts[source["id"]] = ordinal
            self.sources.append(public)
            if source.get("coverage", {}).get("bodyComplete") is not True:
                self.finding(source, "BODY_COVERAGE", "The retained source does not declare its original body complete.")
        if self.comparison["status"] == "compared":
            for key, prior in self.baseline.items():
                if key not in self.current_keys:
                    if prior is None:
                        self.comparison["ambiguousKeys"] += 1
                    else:
                        self.comparison["removed"] += 1
                        self.change_rows.append({"status": "removed", "key": loads(key), "beforeRecordId": prior["id"], "before": visible(prior["raw"])})
            if self.comparison["ambiguousKeys"]:
                self.comparison["status"] = "ambiguous-keys"
        self.summary["uniqueExactSymbols"] = len({key[1] for key in self.symbols})
        self.summary["localCaptureEvents"] = len(self.events)
        for name in ("totalRecords", "primaryRecords", "referenceRecords", "customerRecords", "excludedPrimaryRecords"):
            self.summary.setdefault(name, 0)
        if self.view != "records":
            for item in self.rows(self.view):
                self.present(item)
        return self

    def rows(self, view):
        if view == "findings":
            return iter(self.findings.values())
        if view == "symbols":
            return iter(self.symbols.values())
        if view == "changes":
            return iter(self.change_rows)
        if view == "sources":
            return iter(self.sources)
        if view == "events":
            return iter(self.events)
        return iter(())

    def report(self, operator=True):
        unresolved = [x for x in self.findings.values() if x["decision"] not in ("accept", "exclude")]
        reviewed_sources = sum(1 for source in self.edition["sources"] if self.decision(source, "source", source["id"])
                               and self.decision(source, "source", source["id"])["decision"] in ("accept", "exclude"))
        coverage = {"bodyComplete": all(s.get("coverage", {}).get("bodyComplete") is True for s in self.edition["sources"]),
                    "requestedWindowComplete": all(s.get("coverage", {}).get("requestedWindowComplete") is True for s in self.edition["sources"]),
                    "accountEntitledCapture": all(s["sourceKind"].startswith("live-authorized-") for s in self.edition["sources"]),
                    "basis": "Original source declarations; timestamp interpretation and operator review do not change coverage."}
        result = {"schema": "tj.finage-market-report.v1", "title": self.document.get("title", "Finage market workspace"),
            "workspaceSha256": self.workspace_sha, "sourceFingerprint": self.fingerprint,
            "edition": {**{k: self.edition.get(k) for k in ("id", "label", "capturedAt", "scope")}, "role": self.edition.get("role", "primary")},
            "summary": dict(self.summary), "sources": self.sources,
            "ready": not unresolved and reviewed_sources == len(self.edition["sources"]) and bool(self.document["customer"].get("columns")),
            "assessment": {"sourceIntegrityVerified": True, "comparison": self.comparison, "sourceCoverage": coverage,
                           "reviewedSources": reviewed_sources, "priceBasis": self.document.get("analysis", {}).get("priceBasis", "native"),
                           "customerMode": self.document["customer"].get("mode", "all"), "explicitColumns": bool(self.document["customer"].get("columns")),
                           "interpretation": "OTC/P2P/market-maker source observations; no exchange tape, executable-price, tradability or SLA claim."},
            "findings": {"total": len(self.findings), "occurrences": sum(x["count"] for x in self.findings.values()),
                         "unresolved": len(unresolved), "sample": list(self.findings.values())[:25]},
            "columns": self.columns, "dataExport": {"included": False, "completeRecords": self.summary["customerRecords"],
                "command": "python3 processor.py export --workspace workspace.json --out NEW_DIRECTORY --edition-id " + self.edition["id"] + " --audience customer"}}
        if operator:
            result["reviews"] = self.review_events
            result["timeInterpretations"] = [x for x in self.document.get("timeInterpretations", []) if x["editionId"] == self.edition["id"]]
            result["symbolMappings"] = [x for x in self.document.get("symbolMappings", []) if x["editionId"] == self.edition["id"]]
        return result


def parse_input(value):
    value = {} if value is None else value
    require(isinstance(value, dict) and set(value) <= {"editionId", "view", "offset", "limit"}, "INPUT", "Use editionId, view, offset and limit.")
    view, offset, limit = value.get("view", "records"), value.get("offset", 0), value.get("limit", 100)
    require(view in VIEWS and type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 1000,
            "PAGE", "Choose an existing view, nonnegative offset and limit1–1000.")
    return value, view, offset, limit

def assess(value=None, workspace_path=None, sink=None):
    value, view, offset, limit = parse_input(value)
    path, document, data = load_workspace(workspace_path)
    return Assessment(path, document, data, value.get("editionId") or document["selectedEdition"], view, offset, limit, sink).run()

def bounded(value):
    value = visible(value)
    require(len(dumps(value).encode()) <= MAX_OUTPUT, "OUTPUT_SIZE", "Use a smaller inspection page or the complete file export for this result.")
    return value

def inspect_market(value=None, *, workspace_path=None):
    engine = assess(value, workspace_path)
    next_offset = min(engine.page_total, engine.offset + len(engine.page))
    return bounded({"schema": "tj.finage-market-inspection.v1", "report": engine.report(), "page": {
        "view": engine.view, "offset": engine.offset, "requestedLimit": engine.limit, "limit": len(engine.page),
        "total": engine.page_total, "items": engine.page, "nextOffset": next_offset,
        "hasMore": next_offset < engine.page_total, "byteLimited": engine.byte_limited}})

def file_record(name, body, content_type):
    data = body.encode()
    return {"name": name, "body": body, "contentType": content_type, "bytes": len(data), "sha256": digest(data)}

def report_html(report):
    esc = lambda value: html.escape(str(value), quote=True)
    rows = "".join("<tr><th>" + esc(k) + "</th><td>" + esc(v) + "</td></tr>" for k, v in report["summary"].items())
    findings = "".join("<li><strong>" + esc(x["code"]) + "</strong>: " + esc(x["message"]) + " (" + str(x["count"]) + ")</li>" for x in report["findings"]["sample"])
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finage market delivery</title><style>body{font:15px system-ui,sans-serif;max-width:1080px;margin:32px auto;padding:0 24px;color:#202020;background:#fff}h1{font-size:28px}h2{font-size:20px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{padding:9px;text-align:left;border-bottom:1px solid #ccc}th{width:65%;font-weight:500}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}small{color:#555}li{margin:12px 0}</style><h1>""" + esc(report["title"]) + "</h1><p>" + esc(report["edition"]["label"] or report["edition"]["id"]) + "</p><h2>Complete selected source</h2><table>" + rows + "</table><h2>Original scope</h2><pre>" + esc(dumps(report["edition"]["scope"])) + "</pre><h2>Comparison</h2><pre>" + esc(dumps(report["assessment"]["comparison"])) + "</pre><h2>Source coverage</h2><pre>" + esc(dumps(report["assessment"]["sourceCoverage"])) + "</pre><h2>Findings</h2><ul>" + findings + "</ul><h2>Customer records</h2><p>" + ("The complete mapped CSV and NDJSON are included." if report["dataExport"]["included"] else "This compact report includes no complete mapped dataset. Use the source-bound full export.") + "</p><pre>" + esc(report["dataExport"]["command"]) + "</pre><p><small>Original JSON numbers and strings remain distinct. Source capture time is not event time. Published models and anonymous public snapshots do not establish account entitlements or executable prices.</small></p></html>\n"

def small_files(engine, operator=True, complete=False):
    customer, private = engine.report(False), engine.report(True)
    customer["dataExport"]["included"] = private["dataExport"]["included"] = complete
    source_index = {"schema": "tj.finage-source-index.v1", "editionId": engine.edition["id"],
                    "sources": engine.sources, "coverage": customer["assessment"]["sourceCoverage"]}
    columns = {"schema": "tj.finage-output-columns.v1", "columns": engine.columns,
               "missingValues": "JSON null; empty CSV field. Original empty strings remain strings.",
               "numericKinds": "Original number tokens stay numbers in NDJSON; CSV preserves token text. Explicit typed-cell text mappings produce strings."}
    guide = "# Finage market delivery\n\nEdition: " + engine.edition["id"] + ".\n\n" + str(engine.summary["totalRecords"]) + " selected observations were processed completely; " + str(engine.summary["customerRecords"]) + " primary records are in the customer selection and " + str(engine.summary["excludedPrimaryRecords"]) + " were explicitly excluded.\n\n" + (
        "Both mapped-records.csv and mapped-records.ndjson contain the full selection.\n\n" if complete else
        "This native report is compact; obtain the full dataset with the same original source processor:\n\n    " + customer["dataExport"]["command"] + "\n\n") + (
        "source-index.json retains original hashes, provenance and declared coverage. output-columns.json retains exact labels and JSON pointers. "
        "Numbers preserve their original JSON token and kind; source time is interpreted only by explicit saved choices. Capture UTC never fills a missing event timestamp. "
        "Reference model observations never become captured live feed records. Comparison requires the same exact scope and interpreted time basis.\n\n"
        "Private reviewer identities and notes are excluded from customer files. The operator portable workspace retains source bytes, original revisions, named decisions and preview history. "
        "A complete captured body is distinct from complete market coverage, account entitlement and provider service guarantees.\n")
    result = [
        file_record("market-summary.json", dumps(customer) + "\n", "application/json"),
        file_record("market-summary.html", report_html(customer), "text/html; charset=utf-8"),
        file_record("source-index.json", dumps(source_index) + "\n", "application/json"),
        file_record("output-columns.json", dumps(columns) + "\n", "application/json"),
        file_record("DELIVERY.md", guide, "text/markdown; charset=utf-8")]
    if operator:
        result += [file_record("market-report.json", dumps(private) + "\n", "application/json"),
                   file_record("review-decisions.json", dumps({"schema": "tj.finage-review-history.v1", "editionId": engine.edition["id"],
                       "reviews": engine.review_events, "timeInterpretations": private["timeInterpretations"],
                       "symbolMappings": private["symbolMappings"]}) + "\n", "application/json")]
    return result

def build_market(value=None, *, workspace_path=None):
    engine = assess(value, workspace_path)
    return bounded({"schema": "tj.finage-market-build.v1", "report": engine.report(), "files": small_files(engine)})

def customer_market(value=None, *, workspace_path=None):
    engine = assess(value, workspace_path)
    return bounded({"schema": "tj.finage-customer-market.v1", "report": engine.report(False), "files": small_files(engine, False)})

def csv_cell(value):
    return "" if value is None else (str(value) if isinstance(value, (str, int, Decimal)) and not isinstance(value, bool) else dumps(value))

def write_file(path, data):
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())

def identity(path):
    count, sha = 0, hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
            count += len(chunk)
    return {"bytes": count, "sha256": sha.hexdigest()}

def export_complete(workspace_path, output, edition_id=None, audience="operator"):
    require(audience in ("operator", "customer"), "AUDIENCE", "Choose operator or customer.")
    path, document, data = load_workspace(workspace_path)
    output = Path(output).resolve()
    require(not output.exists() and output.parent.is_dir(), "EXPORT_DESTINATION", "Choose a new directory with an existing parent.")
    columns = validate_columns(document["customer"].get("columns", [])) or DEFAULT_COLUMNS
    temp = Path(tempfile.mkdtemp(prefix=output.name + ".pending-", dir=output.parent))
    try:
        customer_dir = temp / "customer"
        customer_dir.mkdir()
        emitted = 0
        with (customer_dir / "mapped-records.ndjson").open("x", encoding="utf-8", newline="") as ndjson, (customer_dir / "mapped-records.csv").open("x", encoding="utf-8", newline="") as csv_file:
            writer = csv.writer(csv_file, lineterminator="\n")
            writer.writerow([x["name"] for x in columns])
            def sink(record):
                nonlocal emitted
                mapped = {column["name"]: pointer(record, column["path"]) for column in columns}
                ndjson.write(dumps(mapped) + "\n")
                writer.writerow([csv_cell(mapped[column["name"]]) for column in columns])
                emitted += 1
            engine = assess({"editionId": edition_id} if edition_id else {}, path, sink)
            for stream in (ndjson, csv_file):
                stream.flush()
                os.fsync(stream.fileno())
        require(emitted == engine.summary["customerRecords"], "EXPORT_COUNT", "Complete mapped count differs from the source assessment.")
        if audience == "operator":
            (temp / "operator").mkdir()
        for item in small_files(engine, audience == "operator", True):
            folder = "operator" if item["name"] in ("market-report.json", "review-decisions.json") else "customer"
            write_file(temp / folder / item["name"], item["body"].encode())
        if audience == "operator":
            for view in ("findings", "symbols", "changes", "events"):
                with (temp / "operator" / (view + ".ndjson")).open("x", encoding="utf-8", newline="") as stream:
                    for row in engine.rows(view):
                        stream.write(dumps(visible(row)) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
        files = [{"path": p.relative_to(temp).as_posix(), **identity(p)} for p in sorted(temp.rglob("*")) if p.is_file()]
        report = engine.report(False)
        manifest = {"schema": "tj.finage-market-delivery.v1", "audience": audience, "editionId": engine.edition["id"],
                    "workspaceSha256": digest(data), "processedRecords": engine.summary["totalRecords"],
                    "primaryRecords": engine.summary["primaryRecords"], "customerRecords": emitted,
                    "excludedRecords": engine.summary["excludedPrimaryRecords"], "allSelectedRecordsProcessed": True,
                    "assessmentReady": report["ready"], "sourceCoverage": report["assessment"]["sourceCoverage"],
                    "sources": engine.sources, "files": files}
        write_file(temp / "manifest.json", (dumps(manifest) + "\n").encode())
        require(not output.exists(), "EXPORT_EXISTS", "The output appeared during this operation.")
        os.rename(temp, output)
        parent = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        return {"directory": str(output), **manifest}
    finally:
        if temp.exists():
            shutil.rmtree(temp)

def main(argv=None):
    parser = argparse.ArgumentParser(description="Inspect and deliver complete retained Finage market observations.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "build", "customer", "export"):
        command = sub.add_parser(name)
        command.add_argument("--workspace", required=True)
        command.add_argument("--edition-id")
        if name == "inspect":
            command.add_argument("--view", choices=VIEWS, default="records")
            command.add_argument("--offset", type=int, default=0)
            command.add_argument("--limit", type=int, default=100)
        if name == "export":
            command.add_argument("--out", required=True)
            command.add_argument("--audience", choices=("operator", "customer"), default="operator")
    args = parser.parse_args(argv)
    value = {"editionId": args.edition_id} if args.edition_id else {}
    if args.command == "export":
        result = export_complete(args.workspace, args.out, args.edition_id, args.audience)
    else:
        if args.command == "inspect":
            value.update(view=args.view, offset=args.offset, limit=args.limit)
        result = {"inspect": inspect_market, "build": build_market, "customer": customer_market}[args.command](value, workspace_path=args.workspace)
    print(dumps(result))

if __name__ == "__main__":
    try:
        main()
    except MarketError as exc:
        print(dumps({"error": exc.code, "message": str(exc)}), file=sys.stderr)
        raise SystemExit(2)
