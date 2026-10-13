"""Exact CSV cohort discovery and metric reconciliation. Python standard library."""
from __future__ import annotations
import csv
from contextlib import contextmanager, ExitStack
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN, localcontext

SCHEMA = "commons.discovery.cohort-manifest.v1"
REPORT_SCHEMA = "commons.discovery.cohort-report.v1"
TYPES = {"text", "integer", "decimal", "date", "boolean"}
ROUNDINGS = {"HALF_UP": ROUND_HALF_UP, "HALF_EVEN": ROUND_HALF_EVEN, "DOWN": ROUND_DOWN}
ID = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,95}$")
DECIMAL = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")
INTEGER = re.compile(r"^[+-]?\d+$")
MAX_DIGITS = 1000

class DiscoveryError(ValueError):
    pass

def require(test, message):
    if not test:
        raise DiscoveryError(message)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()

def parse_json_bytes(data):
    def duplicate(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON key: " + key)
            result[key] = value
        return result
    return json.loads(data.decode("utf-8"), object_pairs_hook=duplicate,
                      parse_constant=lambda value: (_ for _ in ()).throw(DiscoveryError("Non-finite JSON number")))

def read_json(path):
    return parse_json_bytes(Path(path).read_bytes())

def write_json(path, value):
    Path(path).write_bytes(json_bytes(value))

def safe_relative(path):
    p = Path(path)
    require(bool(path) and not p.is_absolute() and all(x not in ("..", "") for x in p.parts),
            "Expected a relative path without parent traversal")
    return p

def finite_decimal(value):
    text = str(value)
    require(bool(DECIMAL.fullmatch(text)) and len(text) <= MAX_DIGITS,
            "Expected a finite base-ten decimal with at most 1000 characters")
    result = Decimal(text)
    require(result.is_finite(), "Non-finite decimal")
    return result

def canonical(value, column):
    if value is None:
        return None
    require(isinstance(value, (str, int, float, bool, Decimal)), "Unsupported scalar")
    if isinstance(value, bool):
        text = "true" if value else "false"
    else:
        text = str(value)
    if column.get("trim", False):
        text = text.strip()
    if text in column.get("null_values", [""]):
        return None
    kind = column["type"]
    if kind == "text":
        out = text
    elif kind == "integer":
        require(bool(INTEGER.fullmatch(text)) and len(text) <= MAX_DIGITS, "Expected an integer")
        out = str(int(text))
    elif kind == "decimal":
        number = finite_decimal(text)
        out = format(number, "f")
        if "." in out:
            out = out.rstrip("0").rstrip(".")
        if out in ("-0", "+0", ""):
            out = "0"
    elif kind == "date":
        require(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", text)), "Expected YYYY-MM-DD")
        out = dt.date.fromisoformat(text).isoformat()
    elif kind == "boolean":
        require(text in ("true", "false", "1", "0"), "Expected true, false, 1 or 0")
        out = "1" if text in ("true", "1") else "0"
    else:
        raise DiscoveryError("Unknown column type")
    if "enum" in column:
        require(out in [canonical(x, {k: v for k, v in column.items() if k != "enum"})
                        for x in column["enum"]], "Value outside the declared enumeration")
    return out

def decimal_compare(a, b):
    if a is None or b is None:
        return None
    da, db = Decimal(a), Decimal(b)
    return (da > db) - (da < db)

def connect(path):
    db = sqlite3.connect(str(path))
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA temp_store=FILE")
    db.execute("PRAGMA cache_size=-8192")
    db.create_function("decimal_compare", 2, decimal_compare, deterministic=True)
    db.create_collation("EXACT_DECIMAL", decimal_compare)
    return db

def validate_manifest(manifest):
    require(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA, "Unsupported manifest schema")
    require(ID.fullmatch(manifest.get("edition", "")), "Give this source edition a stable identifier")
    require(manifest.get("data_class") in ("DEMONSTRATION", "AUTHORIZED_CUSTOMER_EXPORT"),
            "Declare DEMONSTRATION or AUTHORIZED_CUSTOMER_EXPORT")
    auth = manifest.get("source_authorization", {})
    require(isinstance(auth, dict) and auth.get("reference") and auth.get("owner"),
            "Retain the original extraction authority/reference and owner")
    tables = manifest.get("tables")
    require(isinstance(tables, list) and 0 < len(tables) <= 1000, "Declare 1–1000 original CSV tables")
    by_id = {}
    for table in tables:
        require(isinstance(table, dict) and ID.fullmatch(table.get("id", "")), "Invalid table ID")
        tid = table["id"]
        require(tid not in by_id, "Repeated table ID")
        by_id[tid] = table
        safe_relative(table.get("path", ""))
        require(table.get("encoding", "utf-8-sig") in ("utf-8", "utf-8-sig"), "Use UTF-8 CSV")
        require(len(table.get("delimiter", ",")) == 1 and len(table.get("quotechar", '"')) == 1,
                "CSV delimiter and quote character must each be one character")
        require(table.get("header_mode", "exact") in ("exact", "allow_extra"), "Unknown header policy")
        columns = table.get("columns")
        require(isinstance(columns, list) and 0 < len(columns) <= 500, "Declare 1–500 columns")
        names = set()
        for col in columns:
            require(isinstance(col, dict) and isinstance(col.get("name"), str) and col["name"],
                    "Every column needs its original header")
            require(col["name"] not in names, "Repeated declared column")
            names.add(col["name"])
            require(col.get("type") in TYPES, "Unsupported column type")
            require(isinstance(col.get("required", False), bool), "required must be boolean")
            require(isinstance(col.get("trim", False), bool), "trim must be boolean")
            require(isinstance(col.get("null_values", [""]), list) and
                    all(isinstance(x, str) for x in col.get("null_values", [""])),
                    "Null tokens must be explicit strings")
        pk = table.get("primary_key", [])
        require(isinstance(pk, list) and len(pk) == len(set(pk)) and all(x in names for x in pk),
                "Primary key must name distinct declared columns")
        for fk in table.get("foreign_keys", []):
            require(ID.fullmatch(fk.get("id", "")), "Foreign key needs a stable ID")
            require(fk.get("columns") and all(x in names for x in fk["columns"]), "Invalid child key")
    for table in tables:
        fids = set()
        for fk in table.get("foreign_keys", []):
            require(fk["id"] not in fids, "Repeated foreign key ID")
            fids.add(fk["id"])
            target = by_id.get(fk.get("references", {}).get("table"))
            require(target is not None, "Foreign key references an undeclared table")
            keys = fk["references"].get("columns", [])
            require(len(keys) == len(fk["columns"]) and all(x in {c["name"] for c in target["columns"]} for x in keys),
                    "Foreign key arity or target columns do not match")
            types = {c["name"]: c["type"] for c in table["columns"]}
            target_types = {c["name"]: c["type"] for c in target["columns"]}
            require(all(types[a] == target_types[b] for a, b in zip(fk["columns"], keys)), "Foreign key types differ")
    metrics = manifest.get("metrics", [])
    require(isinstance(metrics, list) and len(metrics) <= 1000, "Invalid metric collection")
    mids = set()
    for metric in metrics:
        require(ID.fullmatch(metric.get("id", "")) and metric["id"] not in mids, "Invalid or repeated metric ID")
        mids.add(metric["id"])
        require(metric.get("table") in by_id, "Metric references an undeclared cohort")
        require(metric.get("invalid_rows", "reject") in ("reject", "exclude"), "Declare invalid-row treatment")
        require(metric.get("rounding", {}).get("mode", "HALF_UP") in ROUNDINGS, "Unsupported rounding convention")
        places = metric.get("rounding", {}).get("places", 1)
        require(isinstance(places, int) and not isinstance(places, bool) and 0 <= places <= 8, "Rounding places must be 0–8")
        unit = metric.get("unit", {"kind": "rows"})
        require(unit.get("kind") in ("rows", "distinct"), "Metric units must be rows or explicit distinct keys")
        if unit["kind"] == "distinct":
            require(unit.get("columns") and len(set(unit["columns"])) == len(unit["columns"]) and
                    all(c in {x["name"] for x in by_id[metric["table"]]["columns"]} for c in unit["columns"]),
                    "Distinct cohort unit needs declared nonduplicated columns")
        outcomes = metric.get("outcomes", [])
        require(isinstance(outcomes, list) and 0 < len(outcomes) <= 100 and all(isinstance(o, dict) and "where" in o for o in outcomes), "Declare 1–100 explicit outcome filters")
        ids = [o.get("id") for o in outcomes]
        require(all(isinstance(x, str) and ID.fullmatch(x) for x in ids) and len(ids) == len(set(ids)),
                "Outcome IDs must be unique")
    return by_id

def compile_filter(node, table, params):
    if node is None:
        return "1"
    require(isinstance(node, dict), "A filter must be a typed expression")
    logical = [key for key in ("all", "any", "not") if key in node]
    if logical:
        require(len(logical) == 1 and len(node) == 1, "Ambiguous logical filter")
        key = logical[0]
        if key == "not":
            return "(NOT (" + compile_filter(node[key], table, params) + "))"
        values = node[key]
        require(isinstance(values, list), "Logical expression requires a list")
        if not values:
            return "1" if key == "all" else "0"
        return "(" + (" AND " if key == "all" else " OR ").join(compile_filter(x, table, params) for x in values) + ")"
    require(set(node).issubset({"column", "op", "value"}), "Unknown filter field")
    columns = {c["name"]: (i, c) for i, c in enumerate(table["columns"])}
    require(node.get("column") in columns, "Filter references an undeclared column")
    index, column = columns[node["column"]]
    ref = "n" + str(index)
    op = node.get("op")
    if op in ("is_null", "not_null"):
        require("value" not in node, "Null predicates do not take a value")
        return ref + (" IS NULL" if op == "is_null" else " IS NOT NULL")
    require(op in ("eq", "ne", "lt", "le", "gt", "ge", "in", "not_in"), "Unsupported filter operator")
    values = node.get("value") if op in ("in", "not_in") else [node.get("value")]
    require(isinstance(values, list), "Set predicate requires a list")
    encoded = [canonical(value, column) for value in values]
    require(all(x is not None for x in encoded), "Use an explicit null predicate")
    if op in ("in", "not_in"):
        if not encoded:
            return "0" if op == "in" else "1"
        parts = []
        for value in encoded:
            params.append(value)
            parts.append(("decimal_compare(" + ref + ",?)=0") if column["type"] in ("integer", "decimal")
                         else ref + "=?")
        inside = "(" + " OR ".join(parts) + ")"
        return ("NOT " + inside) if op == "not_in" else inside
    params.append(encoded[0])
    operator = {"eq": "=", "ne": "!=", "lt": "<", "le": "<=", "gt": ">", "ge": ">="}[op]
    return ("decimal_compare(" + ref + ",?)" + operator + "0") if column["type"] in ("integer", "decimal") else ref + operator + "?"

def snapshot(source, destination, expected_sha=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    size = 0
    with open(source, "rb") as inp, open(destination, "xb") as out:
        before = os.fstat(inp.fileno())
        while True:
            chunk = inp.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            h.update(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
        after = os.fstat(inp.fileno())
    require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns),
            "Original CSV changed while receiving its complete snapshot")
    actual = h.hexdigest()
    require(expected_sha is None or expected_sha == actual, "CSV differs from its declared SHA-256")
    return {"bytes": size, "sha256": actual}

def scalar(db, sql, params=()):
    return db.execute(sql, params).fetchone()[0]

def load_table(db, table, path, sql_name):
    columns = table["columns"]
    names = [c["name"] for c in columns]
    definitions = ["_row INTEGER PRIMARY KEY", "_valid INTEGER NOT NULL", "_width_valid INTEGER NOT NULL"]
    for i in range(len(columns)):
        definitions += ["r%d TEXT" % i, "n%d TEXT" % i, "x%d INTEGER NOT NULL" % i]
    db.execute("CREATE TABLE " + sql_name + "(" + ",".join(definitions) + ")")
    errors = []
    count, invalid, bad_width = 0, 0, 0
    nulls = [0] * len(columns)
    bad = [0] * len(columns)
    with open(path, encoding=table.get("encoding", "utf-8-sig"), newline="") as stream:
        reader = csv.reader(stream, delimiter=table.get("delimiter", ","), quotechar=table.get("quotechar", '"'), strict=True)
        header = next(reader, None)
        require(header is not None and len(header) == len(set(header)), "Missing or repeated CSV header")
        require(all(name in header for name in names), "Declared column missing from original CSV")
        if table.get("header_mode", "exact") == "exact":
            require(header == names, "CSV header/order differs from the declared exact schema")
        positions = [header.index(name) for name in names]
        insert = "INSERT INTO " + sql_name + " VALUES(" + ",".join("?" for _ in definitions) + ")"
        for row in reader:
            count += 1
            width_ok = len(row) == len(header)
            valid = width_ok
            bad_width += int(not width_ok)
            cells = []
            reasons = []
            if not width_ok:
                reasons.append("column_count")
            for i, (position, column) in enumerate(zip(positions, columns)):
                raw = row[position] if position < len(row) else None
                value, ok = None, True
                try:
                    value = canonical(raw, column)
                    if value is None:
                        nulls[i] += 1
                        require(not column.get("required", False), "required")
                except (DiscoveryError, ValueError, InvalidOperation):
                    ok = False
                    bad[i] += 1
                    reasons.append(column["name"])
                valid = valid and ok
                cells.extend((raw, value, int(ok)))
            invalid += int(not valid)
            if reasons and len(errors) < 50:
                errors.append({"record_number": count, "physical_line_end": reader.line_num, "fields": reasons})
            db.execute(insert, (count, int(valid), int(width_ok), *cells))
            if count % 10000 == 0:
                db.commit()
    db.commit()
    profiles = []
    for i, column in enumerate(columns):
        ref = "n%d" % i
        valid_clause = "x%d=1 AND %s IS NOT NULL" % (i, ref)
        distinct = scalar(db, "SELECT COUNT(DISTINCT " + ref + ") FROM " + sql_name + " WHERE " + valid_clause)
        item = {"name": column["name"], "type": column["type"], "null_rows": nulls[i],
                "invalid_rows": bad[i], "distinct_valid_non_null": distinct,
                "profile_scope": "column-valid values across all original records"}
        if column["type"] in ("integer", "decimal", "date") and distinct:
            collation = " COLLATE EXACT_DECIMAL" if column["type"] in ("integer", "decimal") else ""
            for label, order in (("minimum", "ASC"), ("maximum", "DESC")):
                item[label] = scalar(db, "SELECT " + ref + " FROM " + sql_name + " WHERE " + valid_clause +
                                     " ORDER BY " + ref + collation + " " + order + " LIMIT 1")
        profiles.append(item)
    result = {"declared_schema": {"columns": columns, "primary_key": table.get("primary_key", [])}, "id": table["id"], "rows": count, "valid_rows": count-invalid, "invalid_rows": invalid,
              "width_invalid_rows": bad_width, "original_headers": header,
              "unmodelled_headers": [x for x in header if x not in names],
              "columns": profiles, "issue_locations": errors, "issue_locations_limit": 50}
    key = table.get("primary_key", [])
    if key:
        keys = ["n%d" % names.index(k) for k in key]
        good = " AND ".join(k + " IS NOT NULL" for k in keys) + " AND _valid=1"
        duplicates = db.execute("SELECT COUNT(*),COALESCE(SUM(n),0),COALESCE(SUM(n-1),0) FROM (SELECT COUNT(*) n FROM " +
                                sql_name + " WHERE " + good + " GROUP BY " + ",".join(keys) + " HAVING COUNT(*)>1)").fetchone()
        null_count = scalar(db, "SELECT COUNT(*) FROM " + sql_name + " WHERE " +
                            " OR ".join("(" + k + " IS NULL AND x" + k[1:] + "=1)" for k in keys))
        result["primary_key"] = {"columns": key, "null_key_rows": null_count, "duplicate_groups": duplicates[0],
                                 "rows_in_duplicate_groups": duplicates[1], "extra_duplicate_rows": duplicates[2],
                                 "eligible_rows": scalar(db, "SELECT COUNT(*) FROM " + sql_name + " WHERE " + good), "scope": "fully valid rows with complete keys"}
    if key:
        index_name = "_keys_" + sql_name
        db.execute("CREATE TABLE " + index_name + "(k TEXT PRIMARY KEY,n INTEGER NOT NULL,invalid INTEGER NOT NULL,v TEXT NOT NULL)")
        positions = [names.index(k) for k in key]
        selected = ["_valid"] + ["n%d" % i for i in range(len(columns))] + ["x%d" % i for i in positions]
        unkeyed = 0
        for record in db.execute("SELECT " + ",".join(selected) + " FROM " + sql_name):
            valid, values, key_valid = record[0], record[1:1+len(columns)], record[1+len(columns):]
            if any(values[i] is None for i in positions) or not all(key_valid):
                unkeyed += 1
                continue
            business_key = json_bytes([values[i] for i in positions]).decode("utf-8")
            value_hash = digest(json_bytes(list(values)))
            db.execute("INSERT INTO " + index_name + "(k,n,invalid,v) VALUES(?,1,?,?) " +
                       "ON CONFLICT(k) DO UPDATE SET n=n+1,invalid=invalid+excluded.invalid",
                       (business_key,int(not valid),value_hash))
        db.commit()
        result["record_index"] = {"schema": "commons.discovery.canonical-record-index.v1",
            "key_columns": key, "unkeyed_rows": unkeyed, "rows_with_usable_key": count-unkeyed,
            "key_groups": scalar(db,"SELECT COUNT(*) FROM " + index_name),
            "ambiguous_key_groups": scalar(db,"SELECT COUNT(*) FROM " + index_name + " WHERE n<>1 OR invalid>0"),
            "value_hash": "SHA-256 of canonical JSON ordered declared-column values",
            "scope": "Any duplicate or invalid record makes its complete business key ambiguous"}
    return result

def foreign_keys(db, tables, names):
    result = []
    by_id = {t["id"]: t for t in tables}
    for table in tables:
        child_columns = [x["name"] for x in table["columns"]]
        for fk in table.get("foreign_keys", []):
            target = by_id[fk["references"]["table"]]
            target_columns = [x["name"] for x in target["columns"]]
            child = names[table["id"]]
            parent = names[target["id"]]
            ck = ["n%d" % child_columns.index(k) for k in fk["columns"]]
            pk = ["n%d" % target_columns.index(k) for k in fk["references"]["columns"]]
            nonnull = " AND ".join("c." + k + " IS NOT NULL" for k in ck)
            equal = " AND ".join("c." + c + "=p." + p for c, p in zip(ck, pk))
            parent_good = " AND ".join(k + " IS NOT NULL" for k in pk) + " AND _valid=1"
            index_name = "idx_" + child + "_" + str(len(result))
            db.execute("CREATE INDEX " + index_name + " ON " + parent + "(" + ",".join(pk) + ")")
            eligible = scalar(db, "SELECT COUNT(*) FROM " + child + " c WHERE c._valid=1 AND " + nonnull)
            unmatched = scalar(db, "SELECT COUNT(*) FROM " + child + " c WHERE c._valid=1 AND " + nonnull +
                               " AND NOT EXISTS(SELECT 1 FROM " + parent + " p WHERE p._valid=1 AND " + equal + ")")
            duplicate_groups = scalar(db, "SELECT COUNT(*) FROM (SELECT COUNT(*) n FROM " + parent +
                                      " WHERE " + parent_good + " GROUP BY " + ",".join(pk) + " HAVING COUNT(*)>1)")
            nulls = scalar(db, "SELECT COUNT(*) FROM " + child + " c WHERE c._valid=1 AND NOT (" + nonnull + ")")
            result.append({"table": table["id"], "id": fk["id"], "columns": fk["columns"],
                           "references": fk["references"], "eligible_child_rows": eligible,
                           "null_child_key_rows": nulls, "unmatched_child_rows": unmatched,
                           "matched_child_rows": eligible-unmatched, "duplicate_parent_key_groups": duplicate_groups,
                           "status": "PASS" if unmatched == 0 and duplicate_groups == 0 else "REVIEW"})
    return result

def percentage(numerator, denominator, places, mode):
    if denominator == 0:
        return None
    with localcontext() as ctx:
        ctx.prec = MAX_DIGITS + 50
        result = (Decimal(numerator) * 100 / Decimal(denominator)).quantize(
            Decimal(1).scaleb(-places), rounding=ROUNDINGS[mode])
        return format(result, "." + str(places) + "f")

def calculate_metric(db, metric, table, sql_name, profile):
    result = {"id": metric["id"], "label": metric.get("label", metric["id"]), "definition": metric,
              "definition_sha256": digest(json_bytes({"metric": metric, "columns": table["columns"]})), "table": table["id"],
              "input_rows": profile["rows"], "invalid_input_rows": profile["invalid_rows"],
              "invalid_row_policy": metric.get("invalid_rows", "reject")}
    params = []
    outcome_exprs = [compile_filter(o.get("where"), table, params) for o in metric["outcomes"]]
    cohort_params = []
    cohort = compile_filter(metric.get("cohort"), table, cohort_params)
    if profile["invalid_rows"] and metric.get("invalid_rows", "reject") == "reject":
        return {**result, "status": "INVALID_INPUT", "denominator": None, "outcomes": [],
                "reason": "Declared reject policy preserves the uncomputed denominator until original rows are corrected"}
    unit = metric.get("unit", {"kind": "rows"})
    group = ["_row"] if unit["kind"] == "rows" else [
        "n%d" % [x["name"] for x in table["columns"]].index(k) for k in unit["columns"]]
    null_unit = scalar(db, "SELECT COUNT(*) FROM " + sql_name + " WHERE _valid=1 AND (" + cohort + ") AND (" +
                       " OR ".join(x + " IS NULL" for x in group) + ")", cohort_params)
    if null_unit:
        return {**result, "status": "INVALID_UNIT", "null_unit_rows": null_unit, "denominator": None, "outcomes": []}
    eligible = scalar(db, "SELECT COUNT(*) FROM " + sql_name + " WHERE _valid=1 AND (" + cohort + ")", cohort_params)
    selects = ["MAX(CASE WHEN (" + expression + ") THEN 1 ELSE 0 END) AS o%d" % i
               for i, expression in enumerate(outcome_exprs)]
    subquery = "SELECT " + ",".join(group + selects) + " FROM " + sql_name + \
               " WHERE _valid=1 AND (" + cohort + ") GROUP BY " + ",".join(group)
    total_flags = "+".join("o%d" % i for i in range(len(outcome_exprs)))
    query = "SELECT COUNT(*)," + ",".join("COALESCE(SUM(o%d),0)" % i for i in range(len(outcome_exprs))) + \
            ",COALESCE(SUM(CASE WHEN (" + total_flags + ")>1 THEN 1 ELSE 0 END),0)" + \
            ",COALESCE(SUM(CASE WHEN (" + total_flags + ")=0 THEN 1 ELSE 0 END),0) FROM (" + subquery + ")"
    values = db.execute(query, params + cohort_params).fetchone()
    denominator = values[0]
    overlap, missing = values[-2:]
    rounding = metric.get("rounding", {})
    places, mode = rounding.get("places", 1), rounding.get("mode", "HALF_UP")
    outcomes = [{"id": outcome["id"], "label": outcome.get("label", outcome["id"]),
                 "count": values[i+1], "denominator": denominator,
                 "percentage": percentage(values[i+1], denominator, places, mode)}
                for i, outcome in enumerate(metric["outcomes"])]
    return {**result, "status": "PARTITION_REVIEW" if metric.get("require_partition", False) and (overlap or missing) else "COMPLETE",
            "cohort_source_rows": eligible, "non_cohort_valid_rows": profile["valid_rows"]-eligible,
            "explicitly_excluded_invalid_rows": profile["invalid_rows"] if metric.get("invalid_rows") == "exclude" else 0,
            "unit": unit, "denominator": denominator, "outcomes": outcomes,
            "overlapping_outcome_units": overlap, "unclassified_units": missing,
            "rounding": {"places": places, "mode": mode},
            "rounded_percent_total": format(sum(Decimal(x["percentage"]) for x in outcomes), "f") if denominator else None}

def review_registers(manifest):
    tables = {t["id"]: t for t in manifest["tables"]}
    source_rows = manifest.get("source_register", [])
    require(isinstance(source_rows, list), "Source register must be a list")
    sources = {}
    for row in source_rows:
        require(ID.fullmatch(row.get("id", "")) and row["id"] not in sources, "Invalid or repeated source-system ID")
        require(row.get("owner") and row.get("source_reference"), "Source-system owner/reference required")
        sources[row["id"]] = row
    for row in sources.values():
        require(all(d in sources for d in row.get("depends_on", [])), "Source dependency is undeclared")
    visited, active, order, cycles = set(), [], [], []
    def visit(sid):
        if sid in active:
            cycles.append(active[active.index(sid):] + [sid])
            return
        if sid in visited:
            return
        active.append(sid)
        for dep in sources[sid].get("depends_on", []):
            visit(dep)
        active.pop()
        visited.add(sid)
        order.append(sid)
    for sid in sources:
        visit(sid)
    mappings = manifest.get("mappings", [])
    require(isinstance(mappings, list), "Mappings must be a list")
    seen = set()
    for mapping in mappings:
        require(ID.fullmatch(mapping.get("id", "")) and mapping["id"] not in seen, "Invalid or repeated mapping ID")
        seen.add(mapping["id"])
        require(mapping.get("status") in ("PROPOSED", "REVIEWED", "ACCEPTED", "REJECTED"), "Mapping review state required")
        for item in mapping.get("source_fields", []):
            require(item.get("table") in tables and item.get("column") in [c["name"] for c in tables[item["table"]]["columns"]],
                    "Mapping source field is undeclared")
        require(mapping.get("target") and mapping.get("transformation") and mapping.get("owner"),
                "Mapping target, explicit transformation and accountable owner required")
    return {"source_register": source_rows, "dependency_order": order if not cycles else None,
            "dependency_cycles": cycles, "mappings": mappings,
            "status": "REVIEW" if cycles or any(m["status"] not in ("ACCEPTED", "REJECTED") for m in mappings) else "COMPLETE"}

def run_manifest(manifest_path, output, *, root=None, max_field_chars=16*1024*1024):
    manifest_path = Path(manifest_path).resolve()
    base = Path(root).resolve() if root else manifest_path.parent
    original_manifest = manifest_path.read_bytes()
    manifest = parse_json_bytes(original_manifest)
    validate_manifest(manifest)
    registers = review_registers(manifest)
    output = Path(output).resolve()
    require(not output.exists(), "Choose a new output directory; existing editions are immutable")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="." + output.name + "-", dir=output.parent))
    csv.field_size_limit(max_field_chars)
    db = None
    try:
        (stage / "inputs").mkdir()
        (stage / "manifest.original.json").write_bytes(original_manifest)
        write_json(stage / "manifest.json", manifest)
        names, profiles, snapshots = {}, [], []
        db = connect(stage / "cohort.sqlite")
        for i, table in enumerate(manifest["tables"]):
            source = (base / safe_relative(table["path"])).resolve()
            require(source.is_relative_to(base) and source.is_file(), "Original source must remain within the authorized input root")
            target = stage / "inputs" / (table["id"] + ".csv")
            snap = snapshot(source, target, table.get("sha256"))
            snapshots.append({"table": table["id"], "original_path": table["path"],
                              "retained_path": target.relative_to(stage).as_posix(), **snap})
            sql_name = "t%d" % i
            names[table["id"]] = sql_name
            profiles.append(load_table(db, table, target, sql_name))
        db.commit()
        table_map = {t["id"]: t for t in manifest["tables"]}
        profile_map = {p["id"]: p for p in profiles}
        foreign = foreign_keys(db, manifest["tables"], names)
        metrics = [calculate_metric(db, m, table_map[m["table"]], names[m["table"]], profile_map[m["table"]])
                   for m in manifest.get("metrics", [])]
        db.commit()
        db.close()
        db = None
        lineage = {"manifest_sha256": digest(original_manifest), "definition_sha256": digest(json_bytes(manifest)),
                   "inputs": snapshots, "engine_version": "1.0.0",
                   "engine_sha256": digest(Path(__file__).read_bytes())}
        identity = digest(json_bytes(lineage))
        with sqlite3.connect(stage / "cohort.sqlite") as binding:
            binding.execute("CREATE TABLE _run_binding(identity TEXT NOT NULL)")
            binding.execute("INSERT INTO _run_binding VALUES(?)",(identity,))
        quality_review = any(p["invalid_rows"] or p.get("primary_key", {}).get("null_key_rows") or p.get("primary_key", {}).get("extra_duplicate_rows") for p in profiles) or any(f["status"] != "PASS" for f in foreign) or any(m["status"] != "COMPLETE" for m in metrics) or registers["status"] != "COMPLETE"
        report = {"quality_status": "REVIEW" if quality_review else "PASS", "schema": REPORT_SCHEMA, "edition": manifest["edition"], "label": manifest.get("label", manifest["edition"]),
                  "data_class": manifest["data_class"], "source_authorization": manifest["source_authorization"],
                  "run_identity": identity, "lineage": lineage, "tables": profiles, "foreign_keys": foreign,
                  "metrics": metrics, "registers": registers,
                  "published_references": manifest.get("published_references", []),
                  "interpretation": "Published references are independent source records, never inferred row-level customer data."}
        write_json(stage / "report.json", report)
        (stage / "report.md").write_text(render_report(report), encoding="utf-8")
        write_outputs(stage, report)
        receiving_manifest = json.loads(json.dumps(manifest))
        for table, snap in zip(receiving_manifest["tables"], snapshots):
            table["path"], table["sha256"] = snap["retained_path"], snap["sha256"]
        write_json(stage / "manifest.receiving.json", receiving_manifest)
        os.rename(stage, output)
        return {"output": str(output), "report": report}
    except BaseException:
        if db is not None:
            db.close()
        shutil.rmtree(stage, ignore_errors=True)
        raise

def csv_value(value):
    text = "" if value is None else str(value)
    if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text

def write_csv(path, headings, rows):
    with open(path, "w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(headings)
        for row in rows:
            writer.writerow([csv_value(row.get(k)) for k in headings])

def write_outputs(root, report):
    write_csv(root / "metric-outcomes.csv", ["metric", "status", "outcome", "count", "denominator", "percentage", "rounding_mode", "decimal_places"],
              [{"metric": m["id"], "status": m["status"], "outcome": o["id"], "count": o["count"],
                "denominator": o["denominator"], "percentage": o["percentage"], "rounding_mode": m["rounding"]["mode"],
                "decimal_places": m["rounding"]["places"]} for m in report["metrics"] for o in m["outcomes"]])
    write_csv(root / "source-register.csv", ["id", "name", "owner", "source_reference", "extract_method",
              "identifiers", "refresh_window", "retention", "authorised_access", "volume", "consumers", "depends_on"],
              [{**r, **{k: json.dumps(r.get(k, []), ensure_ascii=False) for k in ("identifiers", "consumers", "depends_on")}}
               for r in report["registers"]["source_register"]])
    write_csv(root / "mapping-register.csv", ["id", "status", "source_fields", "target", "transformation", "owner", "decision_reference"],
              [{**r, "source_fields": json.dumps(r.get("source_fields", []), ensure_ascii=False)}
               for r in report["registers"]["mappings"]])
    issues = []
    for table in report["tables"]:
        for row in table["issue_locations"]:
            issues.append({"table": table["id"], "category": "typed_row", "count": 1, "record_number": row["record_number"],
                           "detail": "; ".join(row["fields"]), "coverage": "first 50 locations; full totals in report"})
        if table.get("primary_key", {}).get("extra_duplicate_rows"):
            issues.append({"table": table["id"], "category": "duplicate_key",
                           "count": table["primary_key"]["extra_duplicate_rows"], "detail": json.dumps(table["primary_key"]["columns"]),
                           "coverage": "all valid rows"})
        if table.get("primary_key", {}).get("null_key_rows"):
            issues.append({"table": table["id"], "category": "null_primary_key",
                           "count": table["primary_key"]["null_key_rows"], "detail": json.dumps(table["primary_key"]["columns"]),
                           "coverage": "all original rows"})
    for fk in report["foreign_keys"]:
        if fk["status"] != "PASS":
            issues.append({"table": fk["table"], "category": "referential", "count": fk["unmatched_child_rows"],
                           "detail": fk["id"], "coverage": "all valid non-null child keys"})
    write_csv(root / "quality-issues.csv", ["table", "category", "count", "record_number", "detail", "coverage"], issues)

def render_report(report):
    lines = ["# " + report["label"], "", "**" + report["data_class"] + "**", "",
             "Edition: " + report["edition"], "Run identity: " + report["run_identity"], "",
             "## Full original files", "", "| Table | Rows | Valid | Invalid | SHA-256 |", "|---|---:|---:|---:|---|"]
    sources = {s["table"]: s for s in report["lineage"]["inputs"]}
    for t in report["tables"]:
        lines.append("| %s | %d | %d | %d | %s |" % (t["id"], t["rows"], t["valid_rows"], t["invalid_rows"], sources[t["id"]]["sha256"]))
    lines += ["", "Quality review: **" + report["quality_status"] + "**. This includes mapping decisions and every computed cohort.", "", "## Cohorts and outcomes", ""]
    for m in report["metrics"]:
        lines += ["### " + m["label"], "", "Status: **" + m["status"] + "**",
                  "Denominator: " + str(m["denominator"]), "Definition SHA-256: " + m["definition_sha256"], ""]
        if m["outcomes"]:
            lines += ["| Outcome | Count | Denominator | Percent |", "|---|---:|---:|---:|"]
            lines += ["| %s | %d | %d | %s |" % (o["id"], o["count"], o["denominator"], str(o["percentage"])) for o in m["outcomes"]]
            lines += ["", "Outcome overlap units: %s; unclassified units: %s." %
                      (m["overlapping_outcome_units"], m["unclassified_units"]),
                      "Rounding: %s, %d decimal places. Rounded outcomes need not add to exactly 100%%." %
                      (m["rounding"]["mode"], m["rounding"]["places"]), ""]
    lines += ["## Operating source", "", "The JSON report preserves every declared cohort/filter/unit/outcome definition, original file identity,",
              "full-file quality total, mapping decision and source-system dependency. Location examples contain row numbers only.",
              "Original CSV snapshots and the editable receiving manifest are included in the private handover.", ""]
    if report["published_references"]:
        lines += ["## Published reference records", ""]
        for ref in report["published_references"]:
            lines += ["- " + json.dumps(ref, ensure_ascii=False)]
    return "\n".join(lines) + "\n"

def compare_reports(left, right, left_root=None, right_root=None):
    require(left.get("schema") == REPORT_SCHEMA and right.get("schema") == REPORT_SCHEMA, "Compare complete original reports")
    lm, rm = ({m["id"]: m for m in report["metrics"]} for report in (left, right))
    changes = []
    for mid in sorted(set(lm) | set(rm)):
        a, b = lm.get(mid), rm.get(mid)
        row = {"metric": mid, "left": a, "right": b}
        if a is None or b is None:
            row["comparison"] = "ADDED" if a is None else "REMOVED"
        elif a["definition_sha256"] != b["definition_sha256"]:
            row["comparison"] = "DEFINITION_CHANGED"
        elif a["denominator"] is None or b["denominator"] is None:
            row["comparison"] = "UNCOMPUTED_EDITION"
        else:
            old = {o["id"]: o for o in a["outcomes"]}
            row.update({"comparison": "SAME_DEFINITION", "denominator_change": b["denominator"]-a["denominator"],
                        "outcome_changes": [{"id": o["id"], "count_change": o["count"]-old[o["id"]]["count"],
                          "left_denominator": a["denominator"], "right_denominator": b["denominator"],
                          "rounded_percentage_point_change": format(Decimal(o["percentage"])-Decimal(old[o["id"]]["percentage"]), "f")
                          if o["percentage"] is not None and old[o["id"]]["percentage"] is not None else None}
                          for o in b["outcomes"]]})
        changes.append(row)
    lt, rt = ({t["id"]: t for t in report["tables"]} for report in (left, right))
    return {"schema": "commons.discovery.edition-comparison.v1", "left_identity": left["run_identity"],
            "right_identity": right["run_identity"], "left_edition": left["edition"], "right_edition": right["edition"],
            "data_classes": [left["data_class"], right["data_class"]], "metrics": changes,
            "tables": [{"id": tid, "left": lt.get(tid), "right": rt.get(tid)} for tid in sorted(set(lt) | set(rt))],
            "record_comparison": compare_records(left, right, left_root, right_root),
            "interpretation": "Rates retain each edition's denominator. A changed metric definition has no automatic rate delta."}

def verify_original_sources(root, report):
    root = Path(root).resolve()
    original_bytes = (root/"manifest.original.json").read_bytes()
    require(digest(original_bytes) == report["lineage"]["manifest_sha256"],
            "Original manifest differs from the recorded run")
    original = parse_json_bytes(original_bytes)
    require(digest(json_bytes(original)) == report["lineage"]["definition_sha256"],
            "Original definition identity differs")
    require(digest(json_bytes(report["lineage"])) == report["run_identity"], "Run source identity differs")
    for source in report["lineage"]["inputs"]:
        path = (root/safe_relative(source["retained_path"])).resolve()
        require(path.is_relative_to(root) and path.is_file(), "Original snapshot is missing")
        require(path.stat().st_size == source["bytes"] and file_digest(path) == source["sha256"],
                "Original snapshot differs from its complete source: " + source["table"])
    return original

@contextmanager
def record_database(root, report):
    root = Path(root).resolve()
    manifest = verify_original_sources(root, report)
    path = root/"cohort.sqlite"
    matched = False
    if path.is_file():
        try:
            with sqlite3.connect(path.as_uri()+"?mode=ro",uri=True) as check:
                row = check.execute("SELECT identity FROM _run_binding").fetchone()
                matched = row == (report["run_identity"],)
        except sqlite3.Error:
            matched = False
    if matched:
        yield path, "RETAINED_BOUND_SQLITE"
        return
    with tempfile.TemporaryDirectory(prefix=".discovery-record-receiving-",dir=root.parent) as temp:
        path = Path(temp)/"cohort.sqlite"
        db = connect(path)
        try:
            snapshots = {x["table"]: x for x in report["lineage"]["inputs"]}
            expected = {x["id"]: x for x in report["tables"]}
            for i,table in enumerate(manifest["tables"]):
                profile = load_table(db,table,root/snapshots[table["id"]]["retained_path"],"t%d"%i)
                require(profile == expected[table["id"]], "Cold record receiving differs from its original full profile")
            db.commit()
        finally:
            db.close()
        yield path, "REBUILT_FROM_COMPLETE_ORIGINAL_SNAPSHOTS"

def compare_records(left,right,left_root=None,right_root=None):
    if left_root is None or right_root is None:
        return {"status":"INPUT_DIRECTORIES_REQUIRED",
                "reason":"Supply both original report directories for complete keyed record comparison"}
    results=[]
    lm,rm=({row["id"]:(i,row) for i,row in enumerate(report["tables"])} for report in (left,right))
    with ExitStack() as stack:
        lp,ls=stack.enter_context(record_database(left_root,left))
        rp,rs=stack.enter_context(record_database(right_root,right))
        db=sqlite3.connect(lp.as_uri()+"?mode=ro",uri=True)
        try:
            db.execute("ATTACH DATABASE ? AS right_side",(rp.as_uri()+"?mode=ro",))
            for tid in sorted(set(lm)|set(rm)):
                a,b=lm.get(tid),rm.get(tid)
                if a is None or b is None:
                    results.append({"table":tid,"status":"TABLE_ADDED" if a is None else "TABLE_REMOVED",
                                    "left_rows":a[1]["rows"] if a else None,"right_rows":b[1]["rows"] if b else None})
                    continue
                ai,ar=a;bi,br=b
                schema_a,schema_b=ar["declared_schema"],br["declared_schema"]
                keys=schema_a["primary_key"]
                if not keys or not schema_b["primary_key"]:
                    results.append({"table":tid,"status":"NO_STABLE_KEY","left_rows":ar["rows"],"right_rows":br["rows"]})
                    continue
                if schema_a!=schema_b:
                    results.append({"table":tid,"status":"KEY_OR_SCHEMA_CHANGED","left_schema":schema_a,"right_schema":schema_b})
                    continue
                la,rb="main._keys_t%d"%ai,"right_side._keys_t%d"%bi
                ambiguous="SELECT k FROM "+la+" WHERE n<>1 OR invalid>0 UNION SELECT k FROM "+rb+" WHERE n<>1 OR invalid>0"
                duplicate_groups=scalar(db,"SELECT COUNT(*) FROM ("+ambiguous+")")
                excluded_left=scalar(db,"SELECT COALESCE(SUM(l.n),0) FROM "+la+" l JOIN ("+ambiguous+") a ON l.k=a.k")
                excluded_right=scalar(db,"SELECT COALESCE(SUM(r.n),0) FROM "+rb+" r JOIN ("+ambiguous+") a ON r.k=a.k")
                removed=scalar(db,"SELECT COUNT(*) FROM "+la+" l WHERE l.n=1 AND l.invalid=0"+
                               " AND NOT EXISTS(SELECT 1 FROM "+rb+" r WHERE r.k=l.k)")
                inserted=scalar(db,"SELECT COUNT(*) FROM "+rb+" r WHERE r.n=1 AND r.invalid=0"+
                                " AND NOT EXISTS(SELECT 1 FROM "+la+" l WHERE l.k=r.k)")
                changed,unchanged=db.execute("SELECT COALESCE(SUM(l.v<>r.v),0),COALESCE(SUM(l.v=r.v),0) FROM "+
                       la+" l JOIN "+rb+" r ON l.k=r.k WHERE l.n=1 AND r.n=1 AND l.invalid=0 AND r.invalid=0").fetchone()
                unkeyed_left,unkeyed_right=ar["record_index"]["unkeyed_rows"],br["record_index"]["unkeyed_rows"]
                require(ar["rows"]==removed+changed+unchanged+excluded_left+unkeyed_left,
                        "Left logical-record conservation differs")
                require(br["rows"]==inserted+changed+unchanged+excluded_right+unkeyed_right,
                        "Right logical-record conservation differs")
                results.append({"table":tid,"status":"PARTIAL_AMBIGUOUS" if duplicate_groups or unkeyed_left or unkeyed_right else "COMPLETE",
                    "key_columns":keys,"key_schema_sha256":digest(json_bytes(schema_a)),
                    "left_original_rows":ar["rows"],"right_original_rows":br["rows"],
                    "inserted":inserted,"removed":removed,"changed":changed,"unchanged":unchanged,
                    "ambiguous_key_groups":duplicate_groups,"left_ambiguous_rows":excluded_left,"right_ambiguous_rows":excluded_right,
                    "left_unkeyed_rows":unkeyed_left,"right_unkeyed_rows":unkeyed_right,
                    "canonical_value_hash":ar["record_index"]["value_hash"],
                    "interpretation":"Counts compare fully valid unique keyed records. Every duplicate or invalid known key is excluded on both sides; unkeyed rows remain separate. Raw keys and customer row values are absent from this summary."})
        finally:
            db.close()
    return {"status":"COMPLETE" if all(x["status"]=="COMPLETE" for x in results) else "REVIEW",
            "left_receiving":ls,"right_receiving":rs,"tables":results}


def create_handover(run_directory, destination, source_files=()):
    root, destination = Path(run_directory).resolve(), Path(destination).resolve()
    require(root.is_dir() and (root / "report.json").is_file(), "Choose a complete run directory")
    require(not destination.exists(), "Choose a new handover filename")
    report = read_json(root / "report.json")
    original = verify_original_sources(root, report)
    require(read_json(root/"manifest.json") == original, "Completed canonical manifest changed; run a new edition")
    expected_receiving = json.loads(json.dumps(original))
    for table, snap in zip(expected_receiving["tables"], report["lineage"]["inputs"]):
        table["path"], table["sha256"] = snap["retained_path"], snap["sha256"]
    require(read_json(root/"manifest.receiving.json") == expected_receiving,
            "Receiving definition changed; run the edited manifest into a new edition before packing")
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name not in ("cohort.sqlite", "handover-manifest.json"):
            require(not path.is_symlink(), "Symlink is not part of the immutable handover")
            files[path.relative_to(root).as_posix()] = path
    for path in source_files:
        path = Path(path).resolve()
        if path.name == "discovery_engine.py":
            require(file_digest(path) == report["lineage"]["engine_sha256"], "Engine source changed after this run")
        name = "workbench/" + path.name
        require(name not in files, "Repeated operator source name")
        files[name] = path
    manifest = {"schema": "commons.discovery.handover.v1", "run_identity": read_json(root / "report.json")["run_identity"],
                "files": [{"path": name, "bytes": path.stat().st_size, "sha256": file_digest(path)}
                          for name, path in files.items()],
                "sqlite": "Rebuilt from the retained exact CSV snapshots and explicit receiving manifest"}
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + "-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, path in files.items():
                    archive.write(path, name)
                archive.writestr("handover-manifest.json", json_bytes(manifest))
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, destination)
    finally:
        os.unlink(temporary)
    return {"path": str(destination), "bytes": destination.stat().st_size, "sha256": file_digest(destination),
            "files": len(files), "run_identity": manifest["run_identity"]}

def receive_handover(archive_path, destination, max_bytes=4*1024**3):
    destination = Path(destination).resolve()
    require(not destination.exists(), "Receiving requires a new directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="." + destination.name + "-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            items = archive.infolist()
            names = [i.filename for i in items]
            require(len(names) == len(set(names)) and len(names) <= 10000, "Duplicate or excessive archive members")
            require(sum(i.file_size for i in items) <= max_bytes, "Expanded handover exceeds the selected limit")
            require("handover-manifest.json" in names, "Original handover manifest is missing")
            declared = json.loads(archive.read("handover-manifest.json"))
            require(declared.get("schema") == "commons.discovery.handover.v1", "Unsupported handover")
            entries = {e["path"]: e for e in declared["files"]}
            require(len(entries) == len(declared["files"]) and set(names) == set(entries) | {"handover-manifest.json"},
                    "Archive differs from its complete original manifest")
            for item in items:
                rel = safe_relative(item.filename)
                require(not item.is_dir() and (item.external_attr >> 16) & 0o170000 != 0o120000,
                        "Unexpected directory or symbolic link member")
                target = stage / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                h, count = hashlib.sha256(), 0
                with archive.open(item) as inp, open(target, "xb") as out:
                    while True:
                        data = inp.read(1024*1024)
                        if not data:
                            break
                        count += len(data)
                        h.update(data)
                        out.write(data)
                if item.filename in entries:
                    expected = entries[item.filename]
                    require(count == expected["bytes"] and h.hexdigest() == expected["sha256"],
                            "Receiving source hash mismatch: " + item.filename)
        os.rename(stage, destination)
        return {"destination": str(destination), "files": len(names), "run_identity": declared["run_identity"]}
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
