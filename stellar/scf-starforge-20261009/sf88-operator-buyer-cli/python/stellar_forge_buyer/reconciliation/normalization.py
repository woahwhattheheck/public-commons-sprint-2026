"""Explicit, lossless source-unit and time normalization in the original warehouse.

The imported editions are never rewritten. Every selected original value has a
retained conversion record; a failed conversion quarantines its original row.
Canonical scalars use reviewed native SQL types and the existing paired engine.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import re

from ..duckdb_dataset import _hex, _json, _qid
from ..errors import StateError
from .comparison_rules import decimal_text, numeric_type, _fraction

SCHEMA = "stellar-forge.duckdb-reconciliation.normalizations.v1"
FEATURE_SCHEMA = "stellar-forge.duckdb-reconciliation.v3"
STATES = ("CONVERTED", "NULL_PRESERVED", "NOT_NUMERIC", "NON_FINITE", "OUT_OF_RANGE",
          "PRECISION_LOSS", "INVALID_TIME", "OFFSET_REQUIRED", "OFFSET_CONFLICT",
          "SUBMICROSECOND", "NUMERIC_LIMIT")
COLUMNS = (
    ("side", "VARCHAR"), ("row", "BIGINT"), ("column_index", "INTEGER"),
    ("column_name", "VARCHAR"), ("role", "VARCHAR"), ("original_column", "VARCHAR"),
    ("original_sql_type", "VARCHAR"), ("canonical_sql_type", "VARCHAR"),
    ("mode", "VARCHAR"), ("policy_json", "VARCHAR"), ("original_unit", "VARCHAR"),
    ("canonical_unit", "VARCHAR"), ("original_value_text", "VARCHAR"),
    ("original_exact_numeric", "VARCHAR"), ("canonical_value_text", "VARCHAR"),
    ("canonical_exact_numeric", "VARCHAR"), ("state", "VARCHAR"), ("reason", "VARCHAR"),
)
_NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
_DECIMAL_TYPE = re.compile(r"^DECIMAL\(([1-9]|[12][0-9]|3[0-8]),(0|[1-9]|[12][0-9]|3[0-8])\)$")
_OFFSET = re.compile(r"^([+-])([0-9]{2}):([0-9]{2})$")
_ISO = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt ]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?(Z|[+-][0-9]{2}:[0-9]{2})?$")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_UNIX = {"unix-seconds": Fraction(1000000), "unix-milliseconds": Fraction(1000),
         "unix-microseconds": Fraction(1), "unix-nanoseconds": Fraction(1, 1000)}


def _fail(code):
    raise StateError("DUCKDB_RECONCILIATION_" + code)


class _Conversion(Exception):
    def __init__(self, state):
        self.state = state


def _fields(value, names):
    if not isinstance(value, dict) or set(value) != set(names):
        _fail("NORMALIZATION_FIELDS_INVALID")


def _text(value, maximum):
    if (not isinstance(value, str) or not value.strip() or "\x00" in value
            or len(value.encode("utf-8")) > maximum):
        _fail("NORMALIZATION_TEXT_INVALID")
    return value


def _number(value, *, coefficient=False):
    if type(value) is str:
        maximum = 256 if coefficient else 4096
        if value.casefold() in {"nan", "+nan", "-nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity"}:
            raise _Conversion("NON_FINITE")
        if not 1 <= len(value) <= maximum or not value.isascii() or not _NUMBER.fullmatch(value):
            raise _Conversion("NOT_NUMERIC")
        try:
            parsed = Decimal(value)
        except InvalidOperation:
            raise _Conversion("NOT_NUMERIC") from None
        if (not parsed.is_finite() or len(parsed.as_tuple().digits) > 256
                or abs(parsed.as_tuple().exponent) > 256):
            raise _Conversion("NUMERIC_LIMIT")
        return Fraction(parsed)
    if coefficient:
        raise _Conversion("NOT_NUMERIC")
    if type(value) not in {int, float, Decimal}:
        raise _Conversion("NOT_NUMERIC")
    result = _fraction(value)
    if result is None:
        raise _Conversion("NON_FINITE")
    return result


def _coefficient(value, *, scale=False):
    try:
        result = _number(value, coefficient=True)
    except _Conversion:
        _fail("NORMALIZATION_DECIMAL_STRING_REQUIRED")
    if scale and result == 0:
        _fail("NORMALIZATION_NONZERO_SCALE_REQUIRED")
    return result


def _offset(value):
    match = _OFFSET.fullmatch(value) if isinstance(value, str) else None
    if not match or value == "-00:00":
        raise _Conversion("OFFSET_REQUIRED")
    sign, hours, minutes = match.groups()
    hours, minutes = int(hours), int(minutes)
    if hours > 23 or minutes > 59:
        raise _Conversion("OFFSET_REQUIRED")
    offset = timedelta(minutes=(hours * 60 + minutes) * (-1 if sign == "-" else 1))
    return timezone(offset)


def _native_numeric(kind):
    return kind == "VARCHAR" or numeric_type(kind)


def validate(value, role, source_type, target_type):
    if not isinstance(value, dict):
        _fail("NORMALIZATION_INVALID")
    mode = value.get("mode")
    if mode == "numeric-affine":
        _fields(value, ("mode", "canonical_type", "canonical_unit", "source", "target", "basis"))
        if role != "value" or not all(_native_numeric(k) for k in (source_type, target_type)):
            _fail("NORMALIZATION_NUMERIC_VALUE_REQUIRED")
        kind = value["canonical_type"]
        match = _DECIMAL_TYPE.fullmatch(kind) if isinstance(kind, str) else None
        if not isinstance(kind, str) or (kind not in {"BIGINT", "HUGEINT"} and not match):
            _fail("NORMALIZATION_CANONICAL_NUMERIC_TYPE")
        if match and int(match.group(2)) > int(match.group(1)):
            _fail("NORMALIZATION_CANONICAL_NUMERIC_TYPE")
        _text(value["canonical_unit"], 240)
        for side in ("source", "target"):
            selected = value[side]
            _fields(selected, ("unit", "scale", "offset"))
            _text(selected["unit"], 240)
            _coefficient(selected["scale"], scale=True)
            _coefficient(selected["offset"])
    elif mode == "time-utc":
        _fields(value, ("mode", "canonical_type", "source", "target", "basis"))
        if value["canonical_type"] != "TIMESTAMPTZ":
            _fail("NORMALIZATION_CANONICAL_TIME_TYPE")
        for side, kind in (("source", source_type), ("target", target_type)):
            selected = value[side]
            _fields(selected, ("format", "offset"))
            format_ = selected["format"]
            if not isinstance(format_, str):
                _fail("NORMALIZATION_TIME_FORMAT")
            if format_ == "native":
                if kind not in {"DATE", "TIMESTAMP", "TIMESTAMPTZ"}:
                    _fail("NORMALIZATION_NATIVE_TIME_TYPE")
                if kind == "TIMESTAMPTZ":
                    if selected["offset"] != "embedded":
                        _fail("NORMALIZATION_TIME_OFFSET_POLICY")
                elif selected["offset"] == "embedded":
                    _fail("NORMALIZATION_TIME_OFFSET_POLICY")
            elif format_ == "iso8601":
                if kind != "VARCHAR":
                    _fail("NORMALIZATION_ISO_TEXT_REQUIRED")
            elif format_ in _UNIX:
                if not _native_numeric(kind) or selected["offset"] != "utc":
                    _fail("NORMALIZATION_UNIX_POLICY")
                continue
            else:
                _fail("NORMALIZATION_TIME_FORMAT")
            if selected["offset"] != "embedded":
                try:
                    _offset(selected["offset"])
                except _Conversion:
                    _fail("NORMALIZATION_TIME_OFFSET_POLICY")
    else:
        _fail("NORMALIZATION_MODE_INVALID")
    _text(value["basis"], 4000)
    return deepcopy(value)


def manifest(definition, types):
    columns = [
        {"index": index, "name": column["name"], "role": column["role"],
         "source_type": types[index]["source_type"], "target_type": types[index]["target_type"],
         "canonical_type": types[index]["type"], "normalization": deepcopy(column["normalization"])}
        for index, column in enumerate(definition["columns"]) if "normalization" in column
    ]
    if not columns:
        return None
    return {
        "schema": SCHEMA, "columns": columns,
        "arithmetic": "Exact original numeric rational * reviewed scale + reviewed offset; canonical native type must represent the result exactly.",
        "time": "Explicit original native/ISO/Unix representation and embedded or fixed offset; exact UTC microseconds, with no inferred timezone or rounding.",
        "failures": "Every original value and conversion is retained. Failed conversion quarantines its original row; NULL keys retain the original key rule.",
    }


def _canonical_number(value, kind):
    if kind in {"BIGINT", "HUGEINT"}:
        bits = 64 if kind == "BIGINT" else 128
        if value.denominator != 1:
            raise _Conversion("PRECISION_LOSS")
        if not -(2 ** (bits - 1)) <= value.numerator < 2 ** (bits - 1):
            raise _Conversion("OUT_OF_RANGE")
        return value.numerator
    match = _DECIMAL_TYPE.fullmatch(kind)
    precision, scale = map(int, match.groups())
    scaled = value * 10 ** scale
    if scaled.denominator != 1:
        raise _Conversion("PRECISION_LOSS")
    if abs(scaled.numerator) >= 10 ** precision:
        raise _Conversion("OUT_OF_RANGE")
    return Decimal(decimal_text(value))


def _time(value, raw_text, policy):
    format_, offset = policy["format"], policy["offset"]
    if format_ in _UNIX:
        numeric = _number(value)
        micros = numeric * _UNIX[format_]
        if micros.denominator != 1:
            raise _Conversion("SUBMICROSECOND")
        try:
            return _EPOCH + timedelta(microseconds=micros.numerator), numeric
        except (OverflowError, ValueError):
            raise _Conversion("OUT_OF_RANGE") from None
    if isinstance(raw_text, str) and raw_text.casefold() in {"infinity", "-infinity", "nan", "-nan"}:
        raise _Conversion("NON_FINITE")
    if format_ == "iso8601":
        match = _ISO.fullmatch(value) if isinstance(value, str) else None
        if not match:
            raise _Conversion("INVALID_TIME")
        year, month, day, hour, minute, second, fraction, embedded = match.groups()
        fraction = fraction or ""
        if any(char != "0" for char in fraction[6:]):
            raise _Conversion("SUBMICROSECOND")
        try:
            parsed = datetime(*map(int, (year, month, day, hour, minute, second)),
                              microsecond=int((fraction[:6] or "0").ljust(6, "0")))
        except ValueError:
            raise _Conversion("INVALID_TIME") from None
        if embedded:
            parsed = parsed.replace(tzinfo=timezone.utc if embedded == "Z" else _offset(embedded))
    elif type(value) is date:
        parsed = datetime.combine(value, datetime.min.time())
    elif isinstance(value, datetime):
        parsed = value
    else:
        raise _Conversion("INVALID_TIME")
    aware = parsed.utcoffset() is not None
    if offset == "embedded":
        if not aware:
            raise _Conversion("OFFSET_REQUIRED")
    else:
        if aware:
            raise _Conversion("OFFSET_CONFLICT")
        parsed = parsed.replace(tzinfo=_offset(offset))
    try:
        return parsed.astimezone(timezone.utc), None
    except (ValueError, OverflowError):
        raise _Conversion("OUT_OF_RANGE") from None


def window_bound(raw, policy):
    """Bounds are in the reviewed canonical unit/time, with exact precision."""
    try:
        if policy["mode"] == "numeric-affine":
            return _canonical_number(_number(raw), policy["canonical_type"])
        return _time(raw, raw, {"format": "iso8601", "offset": "embedded"})[0]
    except _Conversion as error:
        _fail("NORMALIZATION_WINDOW_" + error.state)


def detail(review, side, index, row, value, raw_text):
    column = review["definition"]["columns"][index]
    policy = column["normalization"]
    type_ = review["comparison_columns"][index]
    numeric = policy["mode"] == "numeric-affine"
    original_unit = policy[side]["unit"] if numeric else policy[side]["format"]
    canonical_unit = policy["canonical_unit"] if numeric else "UTC microseconds"
    original_exact = canonical_exact = canonical_text = None
    canonical = None
    state, reason = "NULL_PRESERVED", ""
    if value is not None:
        try:
            if numeric:
                original = _number(value)
                original_exact = decimal_text(original)
                normalized = original * _coefficient(policy[side]["scale"], scale=True) + _coefficient(policy[side]["offset"])
                canonical_exact = decimal_text(normalized)
                canonical = _canonical_number(normalized, policy["canonical_type"])
                canonical_text = canonical_exact
            else:
                canonical, original = _time(value, raw_text, policy[side])
                if original is not None:
                    original_exact = decimal_text(original)
                canonical_text = canonical.isoformat(timespec="microseconds")
            state = "CONVERTED"
        except _Conversion as error:
            state = error.state
            reason = "NORMALIZATION:" + column["name"] + ":" + state
            canonical = None
            canonical_text = None
            # The exact mathematical numeric candidate remains useful when the
            # selected native type cannot represent it. It is never grouped.
    record = [
        side, row, index, column["name"], column["role"], column[side],
        type_[side + "_type"], type_["type"], policy["mode"], _json(policy),
        original_unit, canonical_unit, raw_text, original_exact,
        canonical_text, canonical_exact, state, reason,
    ]
    return canonical, record


def detail_table(identity):
    return "sf_reconciliation_normalizations_" + _hex(identity)


def stage_table(identity, side):
    if side not in {"source", "target"}:
        _fail("SIDE_INVALID")
    return "sf_reconciliation_normalized_" + _hex(identity) + "_" + side


def materialize(db, identity, review, editions):
    """Retain all conversion records in the SAME original run transaction."""
    chosen = [i for i, col in enumerate(review["definition"]["columns"]) if "normalization" in col]
    if not chosen:
        return {}
    target = _qid(detail_table(identity))
    db.execute("CREATE TABLE " + target + "(" + ",".join(_qid(name) + " " + kind for name, kind in COLUMNS) + ")")
    result = {}
    insert_details = "INSERT INTO " + target + " VALUES(" + ",".join("?" for _ in COLUMNS) + ")"
    for side in ("source", "target"):
        edition = editions[side]
        stage = stage_table(identity, side)
        db.execute("CREATE TEMP TABLE " + _qid(stage) + "(row_id BIGINT PRIMARY KEY," +
                   ",".join(_qid("c" + str(i)) + " " + review["comparison_columns"][i]["type"] for i in chosen) +
                   ",reason VARCHAR NOT NULL)")
        projection = ["sf_row"]
        for index in chosen:
            name = _qid(review["definition"]["columns"][index][side])
            projection.extend((name, "CAST(" + name + " AS VARCHAR)"))
        select = ("SELECT " + ",".join(projection) + " FROM " + _qid(edition["table"]) +
                  " WHERE sf_row>? AND sf_row<=? ORDER BY sf_row")
        retained = 0
        for offset in range(0, edition["row_count"], 128):
            originals = db.execute(select, [offset, offset + 128]).fetchall()
            native_rows, records = [], []
            for original in originals:
                row = original[0]
                canonical, reasons = [row], []
                for position, index in enumerate(chosen):
                    value, record = detail(review, side, index, row, original[1 + position * 2], original[2 + position * 2])
                    canonical.append(value)
                    records.append(record)
                    if record[-1]:
                        reasons.append(record[-1])
                native_rows.append(canonical + [";".join(reasons)])
            if native_rows:
                db.executemany("INSERT INTO " + _qid(stage) + " VALUES(" +
                               ",".join("?" for _ in range(len(chosen) + 2)) + ")", native_rows)
                db.executemany(insert_details, records)
            retained += len(originals)
        if retained != edition["row_count"]:
            _fail("NORMALIZATION_ORIGINAL_ROWS_CHANGED")
        result[side] = stage
    return result


def release(db, stages):
    for name in stages.values():
        db.execute("DROP TABLE " + _qid(name))


def summary(db, identity):
    rows = db.execute("SELECT side,state,count(*)::BIGINT FROM " + _qid(detail_table(identity)) +
                      " GROUP BY side,state ORDER BY side,state").fetchall()
    result = {}
    for side in ("source", "target"):
        states = [{"state": state, "values": count} for selected, state, count in rows if selected == side]
        counts = {item["state"]: item["values"] for item in states}
        values = sum(counts.values())
        converted, nulls = counts.get("CONVERTED", 0), counts.get("NULL_PRESERVED", 0)
        result[side] = {"values": values, "converted": converted, "nulls": nulls,
                        "failed": values - converted - nulls, "states": states}
    return result
