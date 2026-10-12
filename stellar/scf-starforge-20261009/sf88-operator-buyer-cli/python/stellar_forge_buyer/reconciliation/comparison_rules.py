"""Reviewed numeric allowances over native values in the original warehouse.

Arithmetic uses exact rational representations of native integers, decimals and
binary floats. It never rounds observations, converts units or pairs duplicates.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from fractions import Fraction
import math
import re

from ..duckdb_dataset import _json, _qid
from ..errors import StateError

RULE_SCHEMA = "stellar-forge.duckdb-reconciliation.numeric-rules.v1"
FEATURE_SCHEMA = "stellar-forge.duckdb-reconciliation.v2"
FORMULA = "abs(source-target) <= absolute + relative * max(abs(source),abs(target))"
FIELD_STATES = ("EXACT_EQUAL", "EXACT_DIFFERENT", "NULLS_EQUAL", "WITHIN_TOLERANCE",
                "OUTSIDE_TOLERANCE", "NULL_NOT_COMPARABLE", "NON_FINITE_NOT_COMPARABLE",
                "DUPLICATE_NOT_PAIRED", "ONE_SIDED", "QUARANTINED")
_NUMERIC = re.compile(r"^(?:BIGINT|HUGEINT|DOUBLE|DECIMAL\((?:[1-9]|[12][0-9]|3[0-8]),(?:0|[1-9]|[12][0-9]|3[0-8])\))$")
_DECIMAL = re.compile(r"^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")


def _fail(code):
    raise StateError("DUCKDB_RECONCILIATION_" + code)


def numeric_type(kind):
    return isinstance(kind, str) and _NUMERIC.fullmatch(kind) is not None


def _amount(raw, *, relative=False):
    if (not isinstance(raw, str) or not 1 <= len(raw) <= 256
            or not raw.isascii() or not _DECIMAL.fullmatch(raw)):
        _fail("TOLERANCE_DECIMAL_STRING_REQUIRED")
    try:
        value = Decimal(raw)
    except InvalidOperation:
        _fail("TOLERANCE_DECIMAL_STRING_REQUIRED")
    if (not value.is_finite() or value < 0 or len(value.as_tuple().digits) > 256
            or abs(value.as_tuple().exponent) > 256):
        _fail("TOLERANCE_DECIMAL_LIMIT")
    if relative and value > 1:
        _fail("RELATIVE_TOLERANCE_RANGE")
    return Fraction(value)


def validate_rule(value, role, kind):
    names = {"mode", "absolute", "relative", "unit", "nulls", "basis"}
    if not isinstance(value, dict) or set(value) != names or value.get("mode") != "numeric-tolerance":
        _fail("COMPARISON_RULE_INVALID")
    if role != "value" or not numeric_type(kind):
        _fail("NUMERIC_VALUE_RULE_REQUIRED")
    _amount(value["absolute"])
    _amount(value["relative"], relative=True)
    for key, maximum in (("unit", 240), ("basis", 4000)):
        text = value[key]
        if (not isinstance(text, str) or not text.strip() or "\x00" in text
                or len(text.encode("utf-8")) > maximum):
            _fail("COMPARISON_RULE_TEXT_REQUIRED")
    if value["nulls"] not in {"equal", "uncomparable"}:
        _fail("COMPARISON_NULL_POLICY_REQUIRED")
    # Preserve the exact approved decimal strings and source-unit statement.
    return {key: value[key] for key in ("mode", "absolute", "relative", "unit", "nulls", "basis")}


def manifest(definition, types):
    columns = [{"index": i, "name": column["name"], "type": types[i]["type"],
                "comparison": column["comparison"]}
               for i, column in enumerate(definition["columns"]) if "comparison" in column]
    if not columns:
        return None
    return {"schema": RULE_SCHEMA, "formula": FORMULA, "columns": columns,
            "arithmetic": "Exact native integer/decimal/binary-float rational values; no rounding or unit conversion.",
            "duplicates": "Exact original multiset only; tolerance never assigns a duplicate row pairing.",
            "missing": "One NULL and every nonfinite numeric value are uncomparable; two NULLs require explicit equal policy."}


def _fraction(value):
    if value is None:
        return None
    if type(value) is float:
        return Fraction.from_float(value) if math.isfinite(value) else None
    if type(value) is int:
        return Fraction(value)
    if isinstance(value, Decimal):
        return Fraction(value) if value.is_finite() else None
    _fail("NATIVE_NUMERIC_TYPE_CHANGED")


def decimal_text(value):
    """Lossless terminating decimal; no context precision or float conversion."""
    numerator, denominator = value.numerator, value.denominator
    two = five = 0
    while denominator % 2 == 0:
        denominator //= 2
        two += 1
    while denominator % 5 == 0:
        denominator //= 5
        five += 1
    if denominator != 1:
        _fail("NATIVE_NUMERIC_RATIO_CHANGED")
    scale = max(two, five)
    digits = str(abs(numerator) * (2 ** (scale - two)) * (5 ** (scale - five)))
    if scale:
        digits = digits.zfill(scale + 1)
        digits = (digits[:-scale] + "." + digits[-scale:]).rstrip("0").rstrip(".")
    return ("-" if numerator < 0 else "") + digits


def evaluator(rule):
    """Exact native values only; materialized before saving SQL reports."""
    absolute = _amount(rule["absolute"]) if rule else Fraction(0)
    relative = _amount(rule["relative"], relative=True) if rule else Fraction(0)

    def compare(left, right, sql_equal):
        a, b = _fraction(left), _fraction(right)
        result = {"source_exact_numeric": decimal_text(a) if a is not None else None,
                  "target_exact_numeric": decimal_text(b) if b is not None else None,
                  "signed_difference": None, "absolute_difference": None,
                  "relative_scale": None, "allowed_difference": None}
        if a is not None and b is not None:
            signed = b - a
            difference, scale = abs(signed), max(abs(a), abs(b))
            allowed = absolute + relative * scale
            result.update(signed_difference=decimal_text(signed),
                          absolute_difference=decimal_text(difference),
                          relative_scale=decimal_text(scale),
                          allowed_difference=decimal_text(allowed))
        if rule is None:
            state = "EXACT_EQUAL" if sql_equal else "EXACT_DIFFERENT"
        elif left is None or right is None:
            state = ("NULLS_EQUAL" if left is None and right is None and rule["nulls"] == "equal"
                     else "NULL_NOT_COMPARABLE")
        elif a is None or b is None:
            state = "NON_FINITE_NOT_COMPARABLE"
        elif a == b:
            state = "EXACT_EQUAL"
        else:
            state = "WITHIN_TOLERANCE" if difference <= allowed else "OUTSIDE_TOLERANCE"
        return {"state": state, **result}
    return compare


def materialize(db, identity, review):
    """Explanations in the original run transaction, without optional UDF deps."""
    rows = _qid("sf_reconciliation_rows_" + identity)
    groups = _qid("sf_reconciliation_groups_" + identity)
    target = _qid("sf_reconciliation_fields_" + identity)
    db.execute("CREATE TABLE " + target + """(
        group_id BIGINT,column_index INTEGER,column_name VARCHAR,sql_type VARCHAR,
        source_column VARCHAR,target_column VARCHAR,source_row BIGINT,target_row BIGINT,
        source_count BIGINT,target_count BIGINT,source_value_text VARCHAR,target_value_text VARCHAR,
        source_exact_numeric VARCHAR,target_exact_numeric VARCHAR,policy_mode VARCHAR,
        rule_json VARCHAR,unit VARCHAR,state VARCHAR,signed_difference VARCHAR,
        absolute_difference VARCHAR,relative_scale VARCHAR,allowed_difference VARCHAR)""")
    maximum = db.execute("SELECT coalesce(max(group_id),0) FROM " + groups).fetchone()[0]
    for index, column in enumerate(review["definition"]["columns"]):
        if column["role"] != "value":
            continue
        kind = review["comparison_columns"][index]["type"]
        rule = column.get("comparison")
        name = "c" + str(index)
        metadata = [index, column["name"], kind, column["source"], column["target"]]
        policy = [rule["mode"] if rule else "exact", _json(rule) if rule else None,
                  rule["unit"] if rule else None]
        joined = (" FROM " + groups + " g LEFT JOIN " + rows +
                  " s ON s.group_id=g.group_id AND s.side='source' AND g.source_count=1"
                  " LEFT JOIN " + rows + " t ON t.group_id=g.group_id AND t.side='target' AND g.target_count=1")
        same = "s." + name + " IS NOT DISTINCT FROM t." + name
        blocked = ("CASE WHEN g.source_quarantined>0 OR g.target_quarantined>0 THEN 'QUARANTINED'"
                   " WHEN g.source_count=0 OR g.target_count=0 THEN 'ONE_SIDED'"
                   " WHEN g.duplicate_key THEN 'DUPLICATE_NOT_PAIRED' ELSE NULL END")
        if not numeric_type(kind):
            db.execute("INSERT INTO " + target + " SELECT g.group_id,?,?,?,?,?,s.row_id,t.row_id,"
                       "g.source_count,g.target_count,CAST(s." + name + " AS VARCHAR),CAST(t." + name +
                       " AS VARCHAR),NULL,NULL,?,?,?,coalesce((" + blocked + "),CASE WHEN " + same +
                       " THEN 'EXACT_EQUAL' ELSE 'EXACT_DIFFERENT' END),NULL,NULL,NULL,NULL" + joined,
                       metadata + policy)
            continue
        stage = _qid("sf_reconciliation_numeric_stage_" + identity + "_" + str(index))
        # Sort native temporary numeric scalars once. Disjoint range reads use
        # its zone maps instead of rebuilding a source/group join per page.
        # No arbitrary source strings or complete input are buffered in Python.
        db.execute("CREATE TEMP TABLE " + stage + " AS SELECT g.group_id,s.row_id AS source_row,t.row_id AS target_row,"
                   "g.source_count,g.target_count,CAST(s." + name + " AS VARCHAR) AS source_text,"
                   "CAST(t." + name + " AS VARCHAR) AS target_text,s." + name + " AS source_value,t." + name +
                   " AS target_value,(" + same + ") AS sql_equal,(" + blocked + ") AS blocked" +
                   joined + " ORDER BY g.group_id")
        compare = evaluator(rule)
        try:
            for offset in range(0, maximum, 512):
                page = db.execute("SELECT * FROM " + stage + " WHERE group_id>? AND group_id<=? ORDER BY group_id",
                                  [offset, offset + 512]).fetchall()
                retained = []
                for group, source_row, target_row, source_count, target_count, source_text, target_text, left, right, equal, blocked_state in page:
                    result = compare(left, right, equal) if blocked_state is None else {"state": blocked_state}
                    retained.append([group, *metadata, source_row, target_row, source_count, target_count,
                                     source_text, target_text, result.get("source_exact_numeric"),
                                     result.get("target_exact_numeric"), *policy, result["state"],
                                     result.get("signed_difference"), result.get("absolute_difference"),
                                     result.get("relative_scale"), result.get("allowed_difference")])
                if retained:
                    db.executemany("INSERT INTO " + target + " VALUES(" + ",".join("?" for _ in range(22)) + ")", retained)
        except BaseException:
            try:
                db.execute("DROP TABLE " + stage)
            except BaseException:
                # A failed transaction is rolled back and its temporary table
                # released by the unchanged native connection owner.
                pass
            raise
        else:
            db.execute("DROP TABLE " + stage)
    db.execute("ALTER TABLE " + groups + " ADD COLUMN canonical_matched_count BIGINT")
    db.execute("ALTER TABLE " + groups + " ADD COLUMN exact_matched_count BIGINT")
    db.execute("ALTER TABLE " + groups + " ADD COLUMN tolerance_matched_count BIGINT")
    db.execute("UPDATE " + groups + " SET canonical_matched_count=matched_count,exact_matched_count=matched_count,tolerance_matched_count=0")
    counts = ("SELECT group_id,count(*) FILTER(WHERE state NOT IN "
              "('EXACT_EQUAL','NULLS_EQUAL','WITHIN_TOLERANCE')) AS failed,"
              "count(*) FILTER(WHERE state='WITHIN_TOLERANCE') AS tolerated,"
              "count(*) FILTER(WHERE state IN ('NULL_NOT_COMPARABLE','NON_FINITE_NOT_COMPARABLE')) AS uncomparable "
              "FROM " + target + " GROUP BY group_id")
    db.execute("UPDATE " + groups + " g SET matched_count=CASE WHEN f.failed=0 THEN 1 ELSE 0 END,"
               "exact_matched_count=CASE WHEN f.failed=0 AND f.tolerated=0 THEN 1 ELSE 0 END,"
               "tolerance_matched_count=CASE WHEN f.failed=0 AND f.tolerated>0 THEN 1 ELSE 0 END,"
               "source_unmatched=CASE WHEN f.failed=0 THEN 0 ELSE 1 END,"
               "target_unmatched=CASE WHEN f.failed=0 THEN 0 ELSE 1 END,"
               "category=CASE WHEN f.uncomparable>0 THEN 'NOT_COMPARABLE'"
               " WHEN f.failed>0 THEN 'VALUE_DIFFERENCE' WHEN f.tolerated>0 THEN 'TOLERANCE_MATCHED' ELSE 'MATCHED' END"
               " FROM (" + counts + ") f WHERE g.group_id=f.group_id AND g.source_count=1 AND g.target_count=1"
               " AND g.source_quarantined=0 AND g.target_quarantined=0")
