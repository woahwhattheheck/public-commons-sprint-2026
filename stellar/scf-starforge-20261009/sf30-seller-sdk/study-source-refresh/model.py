"""Frozen source, portfolio and export contracts for the study review workspace."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

ROOT = Path(__file__).resolve().parent
SDK = ROOT.parent
BUYER_PYTHON = SDK.parent / "sf88-operator-buyer-cli" / "python"
sys.path.insert(0, str(BUYER_PYTHON))
from stellar_forge_buyer.storage import (
    digest, dump, lock, parse, private_directory, read, sync_directory, write,
)

FAMILIES = ("acs", "laus", "qcew", "hud_income_limits")
HASH = re.compile(r"[0-9a-f]{64}\Z")
SCHEMA = "stellar-forge.study-source-refresh.workspace.v1"
FIELDS = {
    "source_family": "text", "source_release_id": "text", "reference_period": "json",
    "source_geography_id": "text", "geography_vintage": "text",
    "geography_basis": "text", "geography_name": "text", "client_geography_id": "text",
    "source_measure_id": "text", "native_dimensions": "json", "raw_value": "text",
    "normalized_value": "decimal", "unit": "text", "status": "json",
    "raw_moe": "text", "normalized_moe": "decimal", "source_hash": "text",
    "source_locator": "json", "output_value": "decimal", "output_unit": "text",
}
DEFAULT_FIELDS = [
    "source_family", "source_release_id", "reference_period",
    "client_geography_id", "source_geography_id", "geography_vintage",
    "source_measure_id", "native_dimensions", "raw_value", "normalized_value",
    "unit", "status", "raw_moe", "source_hash", "source_locator",
    "output_value", "output_unit",
]


class StudyError(ValueError):
    def __init__(self, code, **details):
        self.code, self.details = code, details
        super().__init__(code)


def fail(code, **details):
    raise StudyError(code, **details)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def identity(value):
    return digest(encoded(value))


def clone(value):
    return json.loads(encoded(value))


def text(value, field, *, empty=False, maximum=2000):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        fail("TEXT_REQUIRED", field=field)
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        fail("CONTROL_CHARACTER", field=field)
    return value


def hash_id(value):
    if not isinstance(value, str) or not HASH.fullmatch(value):
        fail("INVALID_CONTENT_ID")
    return value


def member(value):
    text(value, "member", maximum=1000)
    if "\\" in value or "\x00" in value or PurePosixPath(value).is_absolute():
        fail("INVALID_MEMBER_PATH")
    if any(part in ("", ".", "..") for part in value.split("/")):
        fail("INVALID_MEMBER_PATH")
    return value


def integer(value, field, minimum=0, maximum=1_000_000):
    if type(value) is not int or not minimum <= value <= maximum:
        fail("INTEGER_OUT_OF_RANGE", field=field)
    return value


def decimal(value, field="decimal", nullable=True):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        fail("DECIMAL_REQUIRED", field=field)
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        fail("DECIMAL_REQUIRED", field=field)
    if not result.is_finite() or len(result.as_tuple().digits) > 100 or abs(result.adjusted()) > 100:
        fail("DECIMAL_OUT_OF_RANGE", field=field)
    return format(result, "f")


def exact(value, keys, field):
    if not isinstance(value, dict) or set(value) != set(keys):
        fail("INVALID_FIELDS", field=field, expected=sorted(keys))


def validate_portfolio(value):
    exact(value, ("schema", "name", "geographies", "measures"), "portfolio")
    if value["schema"] != "stellar-forge.study-portfolio.v1":
        fail("PORTFOLIO_SCHEMA")
    text(value["name"], "name", maximum=200)
    if not isinstance(value["geographies"], list) or not 1 <= len(value["geographies"]) <= 10000:
        fail("PORTFOLIO_GEOGRAPHIES_REQUIRED")
    seen = set()
    for geo in value["geographies"]:
        exact(geo, ("family", "source_geography_id", "source_geography_vintage",
                    "client_geography_id", "display_name", "geography_basis",
                    "comparison_group", "crosswalk_note"), "geography")
        if geo["family"] not in FAMILIES:
            fail("SOURCE_FAMILY_INVALID")
        for key in ("source_geography_id", "source_geography_vintage",
                    "client_geography_id", "display_name", "geography_basis"):
            text(geo[key], key, maximum=300)
        text(geo["comparison_group"], "comparison_group", empty=True, maximum=300)
        text(geo["crosswalk_note"], "crosswalk_note", empty=True)
        if geo["comparison_group"] and not geo["crosswalk_note"].strip():
            fail("CROSSWALK_NOTE_REQUIRED")
        key = tuple(geo[name] for name in ("family", "source_geography_id", "source_geography_vintage"))
        if key in seen:
            fail("DUPLICATE_GEOGRAPHY_MAPPING", key=key)
        seen.add(key)
    if not isinstance(value["measures"], list):
        fail("MEASURE_SELECTION_REQUIRED")
    for item in value["measures"]:
        exact(item, ("family", "measure_id"), "measure")
        if item["family"] not in FAMILIES:
            fail("SOURCE_FAMILY_INVALID")
        text(item["measure_id"], "measure_id", maximum=300)
    if len({(x["family"], x["measure_id"]) for x in value["measures"]}) != len(value["measures"]):
        fail("DUPLICATE_MEASURE_SELECTION")
    return clone(value)


def default_mapping(name="Canonical retained export"):
    return {
        "schema": "stellar-forge.study-mapping.v1", "name": name,
        "columns": [{"name": key, "field": key, "type": FIELDS[key],
                     "nullable": key in {"normalized_value", "raw_moe", "normalized_moe", "output_value"}}
                    for key in DEFAULT_FIELDS],
        "key_fields": ["source_family", "client_geography_id", "source_measure_id",
                       "reference_period", "native_dimensions"],
        "units": [],
    }


def validate_mapping(value):
    exact(value, ("schema", "name", "columns", "key_fields", "units"), "mapping")
    if value["schema"] != "stellar-forge.study-mapping.v1":
        fail("MAPPING_SCHEMA")
    text(value["name"], "name", maximum=200)
    columns = value["columns"]
    if not isinstance(columns, list) or not 1 <= len(columns) <= 100:
        fail("MAPPING_COLUMNS_REQUIRED")
    names = set()
    for column in columns:
        exact(column, ("name", "field", "type", "nullable"), "column")
        name = text(column["name"], "column.name", maximum=100)
        if name in names or name in {"__proto__", "constructor", "prototype"}:
            fail("DUPLICATE_OR_RESERVED_COLUMN")
        names.add(name)
        if column["field"] not in FIELDS or column["type"] not in ("text", "decimal", "integer", "json"):
            fail("MAPPING_FIELD_OR_TYPE_INVALID")
        if type(column["nullable"]) is not bool:
            fail("MAPPING_NULLABILITY_REQUIRED")
    if (not isinstance(value["key_fields"], list) or not value["key_fields"]
            or len(set(value["key_fields"])) != len(value["key_fields"])
            or any(name not in names for name in value["key_fields"])):
        fail("MAPPING_KEY_FIELDS_REQUIRED")
    if not isinstance(value["units"], list):
        fail("UNIT_RULES_REQUIRED")
    seen = set()
    for rule in value["units"]:
        exact(rule, ("family", "measure_id", "unit", "output_unit", "factor", "decimal_places"), "unit")
        if rule["family"] not in FAMILIES:
            fail("SOURCE_FAMILY_INVALID")
        for key in ("measure_id", "unit", "output_unit"):
            text(rule[key], key, maximum=300)
        factor = Decimal(decimal(rule["factor"], "factor", nullable=False))
        if factor <= 0:
            fail("UNIT_FACTOR_MUST_BE_POSITIVE")
        if rule["decimal_places"] is not None:
            integer(rule["decimal_places"], "decimal_places", maximum=18)
        key = (rule["family"], rule["measure_id"])
        if key in seen:
            fail("DUPLICATE_UNIT_RULE")
        seen.add(key)
    return clone(value)


def project_row(row, geography, mapping):
    """Apply explicit field/unit decisions without replacing native values."""
    value = clone(row)
    value["client_geography_id"] = geography["client_geography_id"]
    value["comparison_geography"] = geography["comparison_group"] or (
        row["source_geography_id"] + "|" + row["geography_vintage"])
    value["crosswalk_note"] = geography["crosswalk_note"]
    issues = []
    if geography["geography_basis"] != row["geography_basis"]:
        issues.append("geography_basis_mismatch")
    rules = [r for r in mapping["units"]
             if (r["family"], r["measure_id"]) == (row["source_family"], row["source_measure_id"])]
    rule = rules[0] if rules else None
    if rule and row["unit"] and row["unit"] != rule["unit"]:
        issues.append("native_unit_mismatch")
    unit = row["unit"] or (rule["unit"] if rule else "")
    if not unit:
        issues.append("unit_mapping_required")
    value["unit"] = unit
    value["output_unit"] = rule["output_unit"] if rule else unit
    value["unit_rule"] = rule or {"unit": unit, "output_unit": unit, "factor": "1", "decimal_places": None}
    output = row["normalized_value"]
    if output is not None and rule:
        with localcontext() as ctx:
            ctx.prec = 120
            ctx.rounding = ROUND_HALF_EVEN
            number = Decimal(output) * Decimal(rule["factor"])
            if rule["decimal_places"] is not None:
                number = number.quantize(Decimal(1).scaleb(-rule["decimal_places"]))
            output = format(number, "f")
    value["output_value"] = output
    mapped = {}
    for column in mapping["columns"]:
        item = value.get(column["field"])
        if item is None:
            if not column["nullable"]:
                issues.append("null_not_allowed:" + column["name"])
        elif column["type"] == "text":
            if isinstance(item, (dict, list)):
                issues.append("structured_value_requires_json:" + column["name"])
            else:
                item = str(item)
        elif column["type"] == "decimal":
            try:
                item = decimal(item, column["name"], nullable=False)
            except StudyError:
                issues.append("decimal_type:" + column["name"])
        elif column["type"] == "integer":
            try:
                number = Decimal(decimal(item, column["name"], nullable=False))
                if number != number.to_integral_value() or abs(number) > 9_007_199_254_740_991:
                    raise ValueError()
                item = int(number)
            except (StudyError, ValueError):
                issues.append("integer_type:" + column["name"])
        elif column["type"] == "json":
            item = clone(item)
        mapped[column["name"]] = item
    value["mapped"] = mapped
    value["issues"] = sorted(set(issues))
    value["export_key"] = identity([mapped[name] for name in mapping["key_fields"]])
    return value
