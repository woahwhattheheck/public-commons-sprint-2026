"""Exact, reviewed column and window contracts over original imported editions."""
from __future__ import annotations

from copy import deepcopy
import re

from ..duckdb_dataset import _convert, _hex, _json, _name, _qid
from ..errors import StateError
from ..storage import digest
from .comparison_rules import validate_rule, manifest as rules_manifest
from .normalization import validate as validate_normalization, manifest as normalization_manifest, window_bound

SCHEMA = "stellar-forge.duckdb-reconciliation.v1"
REQUEST = re.compile(r"^[0-9a-f]{32}$")
OUTCOMES = ("OPEN", "ACCEPTED_DIFFERENCE", "REQUIRES_CORRECTION", "DEFERRED")
CATEGORIES = ("MATCHED", "SOURCE_ONLY", "TARGET_ONLY", "VALUE_DIFFERENCE",
              "MULTISET_DIFFERENCE", "NOT_COMPARABLE", "TOLERANCE_MATCHED")
STATUSES = ("INCLUDED", "QUARANTINED", "EXCLUDED_WINDOW")
MAX_COLUMNS = 64
MAX_MAP = 10000


def fail(code):
    raise StateError("DUCKDB_RECONCILIATION_" + code)


def fields(value, required=(), optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional):
        fail("FIELDS_INVALID")
    if set(required) - set(value):
        fail("FIELDS_REQUIRED")
    return value


def text(value, *, maximum=4000, empty=False):
    if (not isinstance(value, str) or (not empty and not value.strip())
            or len(value.encode("utf-8")) > maximum or "\x00" in value):
        fail("TEXT_INVALID")
    return value


def integer(value, *, minimum=0, maximum=1000000000):
    if type(value) is not int or not minimum <= value <= maximum:
        fail("INTEGER_INVALID")
    return value


def request_id(value):
    if not isinstance(value, str) or not REQUEST.fullmatch(value):
        fail("REQUEST_ID_REQUIRED")
    return value


def sha(value):
    return digest(_json(value).encode("utf-8"))


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    return "'" + str(value).replace("'", "''") + "'"


def page(offset=0, limit=25):
    return integer(offset), integer(limit, minimum=1, maximum=100)


def mapping(value):
    if not isinstance(value, list) or len(value) > MAX_MAP:
        fail("VALUE_MAP_INVALID")
    result, seen = [], set()
    for item in value:
        fields(item, ("original", "canonical"))
        original = text(item["original"], maximum=4096, empty=True)
        canonical = text(item["canonical"], maximum=4096, empty=True)
        if original in seen:
            fail("VALUE_MAP_DUPLICATE")
        seen.add(original)
        result.append({"original": original, "canonical": canonical})
    return result


def definition(value, source, target):
    fields(value, ("name", "label", "source_edition", "target_edition", "columns"),
           ("window_column", "windows", "notes"))
    name, label = _name(value["name"]), text(value["label"], maximum=240)
    if _hex(value["source_edition"]) != source["edition_id"] or _hex(value["target_edition"]) != target["edition_id"]:
        fail("EDITION_CHANGED")
    originals = {"source": {x["name"]: x for x in source["columns"]},
                 "target": {x["name"]: x for x in target["columns"]}}
    if not isinstance(value["columns"], list) or not 1 <= len(value["columns"]) <= MAX_COLUMNS:
        fail("COLUMNS_REQUIRED")
    columns, used, seen = [], {"source": set(), "target": set()}, set()
    for item in value["columns"]:
        fields(item, ("name", "source", "target", "role"),
               ("meaning", "source_map", "target_map", "comparison", "normalization"))
        canonical = _name(item["name"])
        if canonical.casefold() in seen:
            fail("CANONICAL_COLUMN_DUPLICATE")
        seen.add(canonical.casefold())
        if item["role"] not in {"key", "value"}:
            fail("COLUMN_ROLE_INVALID")
        for side in ("source", "target"):
            original = item[side]
            if original not in originals[side] or original in used[side]:
                fail("ORIGINAL_COLUMN_INVALID")
            used[side].add(original)
        a, b = originals["source"][item["source"]], originals["target"][item["target"]]
        normalization = (validate_normalization(item["normalization"], item["role"], a["type"], b["type"])
                         if "normalization" in item else None)
        if normalization is None and a["type"] != b["type"]:
            fail("IDENTICAL_REVIEWED_SQL_TYPES_REQUIRED")
        canonical_type = normalization["canonical_type"] if normalization else a["type"]
        maps = {side + "_map": mapping(item.get(side + "_map", [])) for side in ("source", "target")}
        if any(maps.values()) and (a["type"] != "VARCHAR" or normalization):
            fail("EXACT_VARCHAR_MAP_REQUIRED")
        rule = ({"comparison": validate_rule(item["comparison"], item["role"], canonical_type)}
                if "comparison" in item else {})
        if normalization and rule:
            if normalization["mode"] != "numeric-affine" or rule["comparison"]["unit"] != normalization["canonical_unit"]:
                fail("NORMALIZATION_TOLERANCE_UNIT_CHANGED")
        columns.append({"name": canonical, "source": item["source"], "target": item["target"],
                        "role": item["role"], "meaning": text(item.get("meaning", ""), empty=True),
                        **maps, **rule, **({"normalization": normalization} if normalization else {})})
    if not any(x["role"] == "key" for x in columns):
        fail("KEY_COLUMNS_REQUIRED")
    selected = {x["name"]: {"type": x["normalization"]["canonical_type"] if "normalization" in x
                                           else originals["source"][x["source"]]["type"]} for x in columns}
    windows = value.get("windows", [])
    window_column = value.get("window_column")
    if not isinstance(windows, list) or len(windows) > 32:
        fail("WINDOWS_INVALID")
    retained, ranges, ids = [], [], set()
    if windows:
        if window_column not in selected:
            fail("WINDOW_COLUMN_REQUIRED")
        kind = selected[window_column]["type"]
        if kind not in {"VARCHAR", "BIGINT", "HUGEINT", "DATE", "TIMESTAMP", "TIMESTAMPTZ"} and not kind.startswith("DECIMAL("):
            fail("EXACT_WINDOW_TYPE_REQUIRED")
        for item in windows:
            fields(item, ("id", "start", "end", "basis"))
            identity = _name(item["id"])
            if identity.casefold() in ids:
                fail("WINDOW_ID_DUPLICATE")
            ids.add(identity.casefold())
            start, end = (text(item[k], maximum=4096) for k in ("start", "end"))
            if kind == "VARCHAR":
                if item["basis"] != "lexical":
                    fail("EXPLICIT_LEXICAL_WINDOW_REQUIRED")
                low, high = start, end
            else:
                if item["basis"] != "native":
                    fail("NATIVE_WINDOW_BASIS_REQUIRED")
                column = {"type": kind, "nullable": False}
                normalization = next(x.get("normalization") for x in columns if x["name"] == window_column)
                low, high = ((window_bound(start, normalization), window_bound(end, normalization)) if normalization
                             else (_convert(start, column), _convert(end, column)))
            if low >= high or any(low < y and x < high for x, y in ranges):
                fail("WINDOWS_OVERLAP_OR_EMPTY")
            ranges.append((low, high))
            retained.append({"id": identity, "start": start, "end": end, "basis": item["basis"]})
    elif window_column is not None:
        fail("WINDOW_BOUNDS_REQUIRED")
    result = {"name": name, "label": label, "source_edition": source["edition_id"],
              "target_edition": target["edition_id"], "columns": columns,
              "window_column": window_column, "windows": retained,
              "notes": text(value.get("notes", ""), maximum=16000, empty=True)}
    types = [{"name": x["name"], "type": x["normalization"]["canonical_type"] if "normalization" in x
              else originals["source"][x["source"]]["type"], "role": x["role"],
              **({"source_type": originals["source"][x["source"]]["type"],
                  "target_type": originals["target"][x["target"]]["type"]} if "normalization" in x else {})}
             for x in columns]
    return result, types, {side: [x["name"] for x in edition["columns"] if x["name"] not in used[side]]
                           for side, edition in (("source", source), ("target", target))}


def public_edition(edition, meanings):
    return {"edition_id": edition["edition_id"], "row_count": edition["row_count"],
            "manifest_sha256": edition["manifest_sha256"],
            "source_binding_sha256": edition["source"]["source_binding_sha256"],
            "columns": deepcopy(edition["columns"]), "keys": deepcopy(edition["keys"]),
            "source_scope": deepcopy(edition["source"]["manifest"]["dataset"]),
            "source_meanings": meanings}


def bound_review(value, source, target, source_meanings, target_meanings, workspace_id):
    normalized, types, omitted = definition(value, source, target)
    review = {"schema": SCHEMA, "workspace_id": workspace_id, "definition": normalized,
              "source": public_edition(source, source_meanings),
              "target": public_edition(target, target_meanings),
              "comparison_columns": types, "omitted": omitted,
              "comparison_basis": "Exact original SQL types and reviewed literal VARCHAR maps; no implicit rounding, tolerance, unit or timezone conversion."}
    rules = rules_manifest(normalized, types)
    if rules:
        review["comparison_rules"] = rules
        review["comparison_basis"] = ("Exact native keys and source units; explicitly reviewed numeric value allowances: " +
                                     rules["formula"] + ". Duplicate groups retain exact multiset accounting. " +
                                     "No implicit rounding, unit or timezone conversion.")
    normalizations = normalization_manifest(normalized, types)
    if normalizations:
        review["normalizations"] = normalizations
        review["comparison_basis"] = (
            "Explicit reviewed unit/time normalization into exact native canonical types; original values and every conversion retained. "
            "Unrepresentable or unresolved conversions quarantine the original row. Complete canonical key/window and duplicate multiset accounting." +
            (" Numeric allowances apply only in the reviewed canonical unit: " + rules["formula"] + "." if rules else ""))
    return {**review, "review_sha256": sha(review)}


def selected_rows(review, side, table, normalized_table=None):
    """One SQL row per original observation; normalization never removes a row."""
    definition = review["definition"]
    expressions, reasons, aliases = [], (["nullif(n.reason,\'\')"] if normalized_table else []), []
    for index, column in enumerate(definition["columns"]):
        alias = "c" + str(index)
        original = ("b." if normalized_table else "") + _qid(column[side])
        entries = column[side + "_map"]
        expression = "n." + _qid(alias) if "normalization" in column and normalized_table else original
        if entries:
            expression = ("CASE " + original + " " + " ".join("WHEN " + literal(x["original"]) +
                          " THEN " + literal(x["canonical"]) for x in entries) + " ELSE NULL END")
            reasons.append("CASE WHEN " + original + " IS NOT NULL AND " + original + " NOT IN (" +
                           ",".join(literal(x["original"]) for x in entries) + ") THEN " +
                           literal("UNMAPPED:" + column["name"]) + " ELSE NULL END")
        expressions.append(expression + " AS " + alias)
        aliases.append(alias)
        if column["role"] == "key":
            reasons.append("CASE WHEN " + expression + " IS NULL THEN " +
                           literal("NULL_KEY:" + column["name"]) + " ELSE NULL END")
    reason = "concat_ws(';'," + ",".join(reasons) + ")" if reasons else "''"
    source = (_qid(table) + " b JOIN " + _qid(normalized_table) + " n ON b.sf_row=n.row_id"
              if normalized_table else _qid(table))
    projected = "SELECT " + ("b." if normalized_table else "") + "sf_row AS row_id," + ",".join(expressions) + "," + reason + " AS reason FROM " + source
    window = "'all'"
    if definition["windows"]:
        index = next(i for i, c in enumerate(definition["columns"]) if c["name"] == definition["window_column"])
        column, kind = aliases[index], review["comparison_columns"][index]["type"]
        normalization = definition["columns"][index].get("normalization")
        def bound(raw):
            return literal(window_bound(raw, normalization) if normalization else raw)
        window = "CASE " + " ".join("WHEN " + column + " >= CAST(" + bound(w["start"]) + " AS " + kind +
                    ") AND " + column + " < CAST(" + bound(w["end"]) + " AS " + kind + ") THEN " + literal(w["id"])
                    for w in definition["windows"]) + " ELSE NULL END"
        # A null or unresolvable time remains quarantined rather than outside scope.
        projected = ("SELECT * REPLACE (concat_ws(';',nullif(reason,''),CASE WHEN " + column +
                     " IS NULL THEN 'NULL_WINDOW_VALUE' ELSE NULL END) AS reason) FROM (" + projected + ")")
    annotated = "SELECT *," + window + " AS window_id FROM (" + projected + ")"
    return ("SELECT " + literal(side) + " AS side,row_id," + ",".join(aliases) + ",window_id,reason,"
            "CASE WHEN reason<>'' THEN 'QUARANTINED' WHEN window_id IS NULL THEN 'EXCLUDED_WINDOW' ELSE 'INCLUDED' END AS status "
            "FROM (" + annotated + ")")


def pair_key(review):
    return sha(review["definition"]["name"].casefold())


def table(kind, identity):
    _hex(identity)
    if kind not in {"rows", "values", "groups", "fields"}:
        fail("TABLE_KIND_INVALID")
    return "sf_reconciliation_" + kind + "_" + identity


def subject(value):
    if not isinstance(value, dict):
        fail("DECISION_SUBJECT_INVALID")
    if value.get("kind") == "group":
        fields(value, ("kind", "group_id"))
        group = integer(value["group_id"], minimum=1)
        return {"kind": "group", "group_id": group}, "group:" + str(group)
    if value.get("kind") == "row":
        fields(value, ("kind", "side", "row"))
        if value["side"] not in {"source", "target"}:
            fail("SIDE_INVALID")
        row = integer(value["row"], minimum=1)
        return {"kind": "row", "side": value["side"], "row": row}, value["side"] + ":" + str(row)
    fail("DECISION_SUBJECT_INVALID")
