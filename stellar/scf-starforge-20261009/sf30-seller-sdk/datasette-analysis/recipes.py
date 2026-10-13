"""Source-edition analysis recipes for the original Datasette Analysis engine.

The caller supplies one captured edition. Numeric source lexemes may be strings;
aggregated quantities are decimal text, and count/rank columns are integers.
Original observations remain in plants, including source years and attribution.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, localcontext
import json
import math
import re

_DECIMAL = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")
_GENERATION = re.compile(r"generation_gwh_(\d{4})\Z")
_TYPE_ALIASES = {
    "int": "integer", "integer": "integer", "float": "number",
    "real": "number", "number": "number", "decimal": "number",
    "str": "text", "string": "text", "text": "text", "bool": "boolean",
    "boolean": "boolean", "null": "null", "none": "null",
    "array": "array", "list": "array", "object": "object",
    "dict": "object", "blob": "blob",
}
_AGGREGATE_COLUMNS = [
    "capacity_rank", "plant_count", "capacity_known_count",
    "capacity_missing_count", "capacity_absent_count", "capacity_null_count",
    "capacity_blank_count", "capacity_invalid_count", "disclosed_capacity_mw",
    "minimum_disclosed_capacity_mw", "maximum_disclosed_capacity_mw",
]
_COVERAGE_COLUMNS = [
    "kind", "field", "state", "value", "row_count", "present_count",
    "absent_count", "null_count", "blank_count", "known_count",
    "invalid_count", "disclosed_generation_gwh", "note",
]
_QUALITY_COLUMNS = [
    "category", "severity", "field", "row_number", "record_key",
    "state", "value", "count", "detail",
]


def _compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=True, allow_nan=False)


def _cell(value):
    """Keep source scalars; retain structured values as lossless JSON cells."""
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Source cells must contain finite JSON values")
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Source cells must contain finite JSON values")
    if isinstance(value, (dict, list)):
        return _compact(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise ValueError("Unsupported source cell type: " + type(value).__name__)


def _state(row, field):
    if field not in row:
        return "absent"
    value = row[field]
    if value is None:
        return "null"
    if isinstance(value, str) and not value.strip():
        return "blank"
    return "present"


def _hints(row, columns, source):
    type_column = source.get("type_column", "_datasette_types")
    mapping = source.get("type_mapping", source.get("column_mapping")) or {}
    value = row.get(type_column)
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return {}
    if isinstance(value, list):
        type_columns = [field for field in columns
                        if field != type_column]
        if len(value) == len(columns):
            value = dict(zip(columns, value))
        elif len(value) == len(type_columns):
            value = dict(zip(type_columns, value))
    if not isinstance(value, dict):
        return {}
    return {mapping.get(key, key): _TYPE_ALIASES.get(str(kind).lower(), str(kind))
            for key, kind in value.items() if mapping.get(key, key) in columns}


def _storage_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, (float, Decimal)):
        return "number"
    if isinstance(value, str):
        return "text"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _source_type(value, hint=None):
    if value is None:
        return "null"
    return hint or _storage_type(value)


def _number(value, *, nonnegative=False):
    """Return known/missing/invalid, exact Decimal or None, and a reason."""
    if value is None:
        return "missing", None, "null"
    if isinstance(value, str):
        lexical = value.strip()
        if not lexical:
            return "missing", None, "blank"
        if not _DECIMAL.fullmatch(lexical):
            return "invalid", None, "not_a_decimal_lexeme"
    elif isinstance(value, bool):
        return "invalid", None, "boolean"
    elif isinstance(value, float):
        return "invalid", None, "binary_float_requires_original_numeric_lexeme"
    elif isinstance(value, (int, Decimal)):
        lexical = str(value)
    else:
        return "invalid", None, "unsupported_type"
    # A source observation outside this supported arithmetic range is retained
    # and reported, rather than expanded into an unbounded output allocation.
    if len(lexical) > 10000:
        return "invalid", None, "decimal_lexeme_exceeds_10000_characters"
    try:
        value = Decimal(lexical)
    except InvalidOperation:
        return "invalid", None, "not_a_decimal_lexeme"
    if not value.is_finite():
        return "invalid", None, "nonfinite"
    if abs(value.as_tuple().exponent) > 10000 or abs(value.adjusted()) > 10000:
        return "invalid", None, "decimal_scale_exceeds_10000_places"
    if nonnegative and value < 0:
        return "invalid", None, "negative_capacity"
    return "known", value, ""


def _decimal_text(value):
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _exact_sum(values):
    """Set precision from every input position and the possible carry."""
    values = list(values)
    if not values:
        return None
    least_exponent = min(value.as_tuple().exponent for value in values)
    greatest_position = max(value.adjusted() for value in values)
    with localcontext() as context:
        context.prec = max(1, greatest_position - least_exponent + 1) + len(str(len(values))) + 2
        total = sum(values, Decimal(0))
    return _decimal_text(total)


def _identity_token(value, hint=None):
    kind = _source_type(value, hint)
    if kind in ("integer", "number"):
        if isinstance(value, float) and math.isfinite(value):
            return ("number", _decimal_text(Decimal.from_float(value)))
        status, number, _ = _number(value)
        if status == "known":
            return ("number", _decimal_text(number))
    return (kind, _compact(_cell(value)))


def _review_key(rows, fields, hints, *, text_fields=()):
    groups = defaultdict(list)
    states = Counter()
    unsupported = 0
    for number, row in enumerate(rows, 1):
        row_states = [_state(row, field) for field in fields]
        if any(state != "present" for state in row_states):
            for state in set(row_states) - {"present"}:
                states[state] += 1
            states["missing_rows"] += 1
            continue
        values = [row[field] for field in fields]
        if any(isinstance(value, (dict, list)) or
               (field in text_fields and _source_type(value, hints[number - 1].get(field)) != "text")
               for field, value in zip(fields, values)):
            unsupported += 1
            continue
        token = tuple(_identity_token(value, hints[number - 1].get(field))
                      for field, value in zip(fields, values))
        groups[token].append(number)
    duplicates = [
        {"value": [_cell(rows[indices[0] - 1][field]) for field in fields],
         "row_numbers": indices}
        for indices in groups.values() if len(indices) > 1
    ]
    return {
        "fields": list(fields), "rows_checked": len(rows),
        "eligible": bool(fields) and bool(rows) and not states["missing_rows"] and
                    not unsupported and not duplicates,
        "nonblank": not states["missing_rows"],
        "unique": not duplicates and not unsupported,
        "absent_rows": states["absent"], "null_rows": states["null"],
        "blank_rows": states["blank"], "missing_rows": states["missing_rows"],
        "unsupported_type_rows": unsupported,
        "distinct_nonblank_values": len(groups),
        "duplicate_group_count": len(duplicates),
        "duplicate_row_count": sum(len(group["row_numbers"]) for group in duplicates),
        "duplicate_excess_count": sum(len(group["row_numbers"]) - 1 for group in duplicates),
        "duplicate_groups": duplicates,
    }


def _capacity_summary(indices, rows, capacities):
    values = [capacities[index][1] for index in indices
              if capacities[index][0] == "known"]
    states = Counter(_state(rows[index], "capacity_mw") for index in indices)
    invalid = sum(capacities[index][0] == "invalid" for index in indices)
    return {
        "plant_count": len(indices), "capacity_known_count": len(values),
        "capacity_missing_count": states["absent"] + states["null"] + states["blank"],
        "capacity_absent_count": states["absent"], "capacity_null_count": states["null"],
        "capacity_blank_count": states["blank"], "capacity_invalid_count": invalid,
        "disclosed_capacity_mw": _exact_sum(values),
        "minimum_disclosed_capacity_mw": _decimal_text(min(values)) if values else None,
        "maximum_disclosed_capacity_mw": _decimal_text(max(values)) if values else None,
    }


def _group_capacity(rows, fields, hints, capacities):
    groups = {}
    for index, row in enumerate(rows):
        token = tuple((_state(row, field),
                       _identity_token(row.get(field), hints[index].get(field)))
                      for field in fields)
        if token not in groups:
            groups[token] = {
                "values": {field: _cell(row.get(field)) for field in fields},
                "states": {field + "_state": _state(row, field) for field in fields},
                "indices": [],
            }
        groups[token]["indices"].append(index)
    results = []
    for group in groups.values():
        result = dict(group["values"], **group["states"])
        result.update(_capacity_summary(group["indices"], rows, capacities))
        results.append(result)
    results.sort(key=lambda row: (
        row["disclosed_capacity_mw"] is None,
        Decimal(row["disclosed_capacity_mw"]).copy_negate()
            if row["disclosed_capacity_mw"] is not None else Decimal(0),
        _compact([row.get(field) for field in fields]),
        _compact([row.get(field + "_state") for field in fields]),
    ))
    previous = None
    rank = None
    for position, result in enumerate(results, 1):
        total = result["disclosed_capacity_mw"]
        if total is None:
            result["capacity_rank"] = None
            continue
        if total != previous:
            rank = position
        result["capacity_rank"] = rank
        previous = total
    return {
        "columns": list(fields) + [field + "_state" for field in fields] + _AGGREGATE_COLUMNS,
        "rows": results,
    }


def _coverage(kind, field, state, value=None, **counts):
    result = {column: None for column in _COVERAGE_COLUMNS}
    result.update(kind=kind, field=field, state=state, value=value)
    result.update(counts)
    return result


def _edition_scope(rows, source):
    """Recognize explicit edition markers; publisher/source names are not versions."""
    selected = source.get("edition_id")
    if selected is not None and not isinstance(selected, (str, int)):
        raise ValueError("edition_id must select one captured source edition")
    mapping = source.get("column_mapping") or {}
    edition_column = source.get("edition_column")
    if edition_column is None and "_datasette_edition_id" not in mapping.values():
        edition_column = "_datasette_edition_id"
    if edition_column is not None and not isinstance(edition_column, str):
        raise ValueError("edition_column must identify one explicit metadata field")
    markers = {str(row[edition_column]) for row in rows
               if edition_column is not None and row.get(edition_column) is not None}
    declared = source.get("edition_ids")
    if declared is not None:
        if not isinstance(declared, list) or any(
                not isinstance(value, (str, int)) for value in declared):
            raise ValueError("edition_ids must be an explicit list of source edition identifiers")
        markers.update(str(value) for value in declared)
    if selected is not None:
        markers.add(str(selected))
    if len(markers) > 1:
        raise ValueError("Analyze each captured source edition separately; capacity cannot be summed across editions")
    return next(iter(markers)) if markers else selected


def build_analysis(rows, columns, source):
    """Build complete collections and report recipes for one captured source edition.

    Source numbers should arrive as their JSON lexemes, integers, or Decimals.
    source.type_column names the native-kind JSON column; source.column_mapping
    maps its original field names to the safe aliases used in rows and columns.
    Legacy callers may omit these and supply _datasette_types directly.
    Generic tables receive complete rows, column profiles and key review.
    """
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("rows must be a list of dictionaries")
    if not isinstance(columns, list) or any(not isinstance(field, str) for field in columns):
        raise ValueError("columns must be a list of column names")
    if len(set(columns)) != len(columns):
        raise ValueError("Duplicate source column names cannot be analyzed unambiguously")
    if not isinstance(source, dict):
        raise ValueError("source must identify one captured edition")
    type_column = source.get("type_column", "_datasette_types")
    mapping = source.get("column_mapping") or {}
    if not isinstance(type_column, str) or not isinstance(mapping, dict) or any(
            not isinstance(original, str) or not isinstance(alias, str)
            for original, alias in mapping.items()):
        raise ValueError("Source type_column and column_mapping must describe source field aliases")
    columns = list(columns)
    # Preserve observed fields even when an input's advertised column list is incomplete.
    for row in rows:
        for field in row:
            if not isinstance(field, str):
                raise ValueError("Source column names must be strings")
            if field not in columns:
                columns.append(field)
            _cell(row[field])
    edition_id = _edition_scope(rows, source)
    hints = [_hints(row, columns, source) for row in rows]
    coverage = []
    quality = []
    profiles = []
    candidates = []
    metadata_columns = {type_column}
    if source.get("edition_column") is not None:
        metadata_columns.add(source["edition_column"])
    elif "_datasette_edition_id" not in mapping.values():
        metadata_columns.add("_datasette_edition_id")
    normal_columns = [field for field in columns if field not in metadata_columns]
    gppd_field = mapping.get("gppd_idnr", "gppd_idnr")
    rowid_field = mapping.get("rowid", "rowid")
    for field in normal_columns:
        states = Counter(_state(row, field) for row in rows)
        source_types = Counter(_source_type(row.get(field), hints[index].get(field))
                               for index, row in enumerate(rows) if field in row)
        storage_types = Counter(_storage_type(row[field]) for row in rows if field in row)
        distinct = {_identity_token(row[field], hints[index].get(field))
                    for index, row in enumerate(rows) if _state(row, field) == "present"}
        profile = {
            "field": field, "rows_checked": len(rows), "present_count": states["present"],
            "absent_count": states["absent"], "null_count": states["null"],
            "blank_count": states["blank"], "distinct_nonblank_count": len(distinct),
            "source_types": dict(sorted(source_types.items())),
            "storage_types": dict(sorted(storage_types.items())),
        }
        profiles.append(profile)
        coverage.append(_coverage(
            "column_profile", field, "observed", _compact(profile["source_types"]),
            row_count=len(rows), present_count=states["present"], absent_count=states["absent"],
            null_count=states["null"], blank_count=states["blank"],
            note="Types use retained source hints when present; blank text and null remain distinct.",
        ))
        candidate = _review_key(rows, [field], hints, text_fields=(gppd_field,))
        candidates.append(candidate)
    candidate_map = {item["fields"][0]: item for item in candidates}
    declared_fields = source.get("primary_keys")
    declared_key = None
    if declared_fields is not None:
        if not isinstance(declared_fields, list) or any(
                not isinstance(field, str) for field in declared_fields):
            raise ValueError("Declared primary_keys must contain source field names")
        declared_fields = [mapping.get(field, field) for field in declared_fields]
        if len(set(declared_fields)) != len(declared_fields):
            raise ValueError("Declared primary_keys contain duplicate column names")
        if any(field not in normal_columns for field in declared_fields):
            raise ValueError("Declared primary_keys must select observed data columns")
        if declared_fields:
            declared_key = _review_key(rows, declared_fields, hints, text_fields=(gppd_field,))
    reviewed_key = None
    reviewed_fields = source.get("reviewed_keys")
    if reviewed_fields is not None:
        if not isinstance(reviewed_fields, list) or any(
                not isinstance(field, str) for field in reviewed_fields):
            raise ValueError("reviewed_keys must contain explicitly selected source field names")
        reviewed_fields = [mapping.get(field, field) for field in reviewed_fields]
        # An explicit empty list selects no reviewed business key. It must
        # neither reject a complete table nor infer approval from a zero-column
        # key on a one-row source.
        if len(set(reviewed_fields)) != len(reviewed_fields) or any(
                field not in normal_columns for field in reviewed_fields):
            raise ValueError("reviewed_keys must select distinct observed data columns")
        reviewed_key = _review_key(rows, reviewed_fields, hints, text_fields=(gppd_field,))
    preferred = []
    if reviewed_key is not None:
        reviewed_key["business_key_eligible"] = (
            reviewed_key["eligible"] and rowid_field not in reviewed_fields)
        if reviewed_key["business_key_eligible"]:
            preferred = reviewed_fields
    else:
        mapped_ids = [alias for original, alias in mapping.items()
                      if original.lower().endswith("_id")]
        order = [gppd_field, mapping.get("id", "id")] + mapped_ids + [
            field for field in normal_columns if field.lower().endswith("_id")]
        preferred = next(([field] for field in order
                          if field != rowid_field and field in candidate_map
                          and candidate_map[field]["eligible"]), [])
    local_locator = preferred or (
        [rowid_field] if rowid_field in candidate_map and candidate_map[rowid_field]["eligible"] else [])

    def record_key(index):
        if not local_locator:
            return "row:" + str(index + 1)
        values = [_cell(rows[index].get(field)) for field in local_locator]
        return str(values[0]) if len(values) == 1 else _compact(values)

    def observe(category, field, state, detail, index=None, value=None,
                severity="info", count=1):
        quality.append({
            "category": category, "severity": severity, "field": field,
            "row_number": index + 1 if index is not None else None,
            "record_key": record_key(index) if index is not None else None,
            "state": state, "value": _cell(value), "count": count, "detail": detail,
        })

    identity_fields = list(dict.fromkeys(
        [field for field in (gppd_field, rowid_field) if field in candidate_map] +
        (declared_fields if declared_key and len(declared_fields) == 1 else [])))
    for field in identity_fields:
        review = candidate_map.get(field)
        if review is None:
            continue
        for index, row in enumerate(rows):
            state = _state(row, field)
            if state != "present":
                observe("record_key", field, state, "This field cannot identify this observation.",
                        index, row.get(field), "warning")
            elif field == gppd_field and _source_type(row[field], hints[index].get(field)) != "text":
                observe("record_key", field, "unsupported_type",
                        "A plant identifier must be nonblank text to be an optional key.",
                        index, row[field], "warning")
        for group in review["duplicate_groups"]:
            for number in group["row_numbers"]:
                observe("record_key", field, "duplicate",
                        "Equal key value occurs at source row numbers " +
                        ", ".join(str(item) for item in group["row_numbers"]),
                        number - 1, rows[number - 1].get(field), "warning")
    if declared_key and len(declared_fields) > 1:
        combined_field = ",".join(declared_fields)
        for index, row in enumerate(rows):
            missing = {field: _state(row, field) for field in declared_fields
                       if _state(row, field) != "present"}
            values = [row.get(field) for field in declared_fields]
            if missing:
                observe("record_key", combined_field, "missing_component",
                        _compact(missing), index, [_cell(value) for value in values], "warning")
            elif any(isinstance(value, (dict, list)) or
                     (field == gppd_field and _source_type(value, hints[index].get(field)) != "text")
                     for field, value in zip(declared_fields, values)):
                observe("record_key", combined_field, "unsupported_component",
                        "The declared composite key contains an unsupported component.",
                        index, [_cell(value) for value in values], "warning")
        for group in declared_key["duplicate_groups"]:
            for number in group["row_numbers"]:
                observe("record_key", combined_field, "duplicate",
                        "Equal composite key occurs at source row numbers " +
                        ", ".join(str(item) for item in group["row_numbers"]),
                        number - 1, group["value"], "warning")
    # The retained plants collection keeps reviewed customer aliases. Domain
    # recipes read their explicit source meanings, so renaming a reviewed field
    # does not remove its capacity, country, historical-year or attribution work.
    # An explicitly empty mapping means that no semantic alias was reviewed.
    semantic_mapping = ({original: alias for original, alias in mapping.items()
                         if alias in columns} if "column_mapping" in source
                        else {field: field for field in columns})
    semantic_columns = list(semantic_mapping)
    semantic_rows = [{original: row[alias] for original, alias in semantic_mapping.items()
                      if alias in row} for row in rows]
    semantic_hints = [{original: row_hints[alias]
                       for original, alias in semantic_mapping.items() if alias in row_hints}
                      for row_hints in hints]
    power_plants = {"name", "country", "capacity_mw", "primary_fuel"}.issubset(semantic_columns)
    collections = {
        "plants": {"columns": columns,
                   "rows": [{field: _cell(value) for field, value in row.items()} for row in rows]},
        "countries": {"columns": ["country", "country_state"] + _AGGREGATE_COLUMNS, "rows": []},
        "owners": {"columns": ["owner", "owner_state"] + _AGGREGATE_COLUMNS, "rows": []},
        "fuels": {"columns": ["primary_fuel", "primary_fuel_state"] + _AGGREGATE_COLUMNS, "rows": []},
    }
    capacity_review = None
    coordinate_review = None
    generation_review = []
    if power_plants:
        capacities = [_number(row.get("capacity_mw"), nonnegative=True) for row in semantic_rows]
        capacity_review = _capacity_summary(list(range(len(semantic_rows))), semantic_rows, capacities)
        for index, (status, value, reason) in enumerate(capacities):
            if status != "known":
                observe("capacity", "capacity_mw", _state(semantic_rows[index], "capacity_mw")
                        if status == "missing" else reason,
                        "Excluded from disclosed capacity totals; original observation is retained.",
                        index, semantic_rows[index].get("capacity_mw"),
                        "warning" if status == "invalid" else "info")
        country_fields = [field for field in ("country", "country_long") if field in semantic_columns]
        collections["countries"] = _group_capacity(semantic_rows, country_fields, semantic_hints, capacities)
        collections["fuels"] = _group_capacity(semantic_rows, ["primary_fuel"], semantic_hints, capacities)
        if "owner" in semantic_columns:
            collections["owners"] = _group_capacity(semantic_rows, ["owner"], semantic_hints, capacities)
        for field in ("year_of_capacity_data", "commissioning_year"):
            if field not in semantic_columns:
                continue
            buckets = {}
            for index, row in enumerate(semantic_rows):
                state = _state(row, field)
                value = row.get(field)
                token = (state, _identity_token(value, semantic_hints[index].get(field)))
                if token not in buckets:
                    buckets[token] = [state, _cell(value), 0]
                buckets[token][2] += 1
            for state, value, count in buckets.values():
                coverage.append(_coverage(
                    "source_year", field, state, value, row_count=count,
                    present_count=count if state == "present" else 0,
                    absent_count=count if state == "absent" else 0,
                    null_count=count if state == "null" else 0,
                    blank_count=count if state == "blank" else 0,
                    note="Source disclosure retained exactly; fractional years are not rounded.",
                ))
        for field in semantic_columns:
            match = _GENERATION.fullmatch(field)
            if not match:
                continue
            numbers = [_number(row.get(field)) for row in semantic_rows]
            states = Counter(_state(row, field) for row in semantic_rows)
            known = [number for status, number, _ in numbers if status == "known"]
            entry = {
                "field": field, "year": match.group(1), "known_count": len(known),
                "missing_count": states["absent"] + states["null"] + states["blank"],
                "invalid_count": sum(status == "invalid" for status, _, _ in numbers),
                "disclosed_generation_gwh": _exact_sum(known),
            }
            generation_review.append(entry)
            coverage.append(_coverage(
                "generation_year", field, "source_column_year", match.group(1),
                row_count=len(semantic_rows), present_count=states["present"],
                absent_count=states["absent"], null_count=states["null"],
                blank_count=states["blank"], known_count=len(known),
                invalid_count=entry["invalid_count"],
                disclosed_generation_gwh=entry["disclosed_generation_gwh"],
                note="One historical year only; quantities are never added across generation years.",
            ))
            for index, (status, value, reason) in enumerate(numbers):
                if status == "invalid":
                    observe("generation", field, reason,
                            "Excluded from this year's disclosed generation total.",
                            index, semantic_rows[index].get(field), "warning")
        for field in ("source", "generation_data_source", "geolocation_source",
                      "other_fuel1", "other_fuel2", "other_fuel3"):
            if field not in semantic_columns:
                continue
            buckets = {}
            for index, row in enumerate(semantic_rows):
                state = _state(row, field)
                token = (state, _identity_token(row.get(field), semantic_hints[index].get(field)))
                if token not in buckets:
                    buckets[token] = [state, _cell(row.get(field)), 0]
                buckets[token][2] += 1
            for state, value, count in buckets.values():
                coverage.append(_coverage(
                    "secondary_fuel" if field.startswith("other_fuel") else "attribution",
                    field, state, value, row_count=count,
                    note="Observed row count; capacity totals use primary_fuel only."
                         if field.startswith("other_fuel") else "Original source attribution.",
                ))
        if "latitude" in semantic_columns and "longitude" in semantic_columns:
            coordinate_states = Counter()
            good_latitudes = []
            good_longitudes = []
            for index, row in enumerate(semantic_rows):
                parsed = {}
                for field, bound in (("latitude", Decimal(90)), ("longitude", Decimal(180))):
                    status, value, reason = _number(row.get(field))
                    if status == "known" and not -bound <= value <= bound:
                        status, reason = "invalid", "outside_coordinate_range"
                    parsed[field] = (status, value, reason)
                statuses = [parsed[field][0] for field in ("latitude", "longitude")]
                state = ("invalid" if "invalid" in statuses else
                         "complete" if statuses == ["known", "known"] else
                         "absent" if statuses == ["missing", "missing"] else "partial")
                coordinate_states[state] += 1
                if state == "complete":
                    good_latitudes.append(parsed["latitude"][1])
                    good_longitudes.append(parsed["longitude"][1])
                else:
                    detail = _compact({field: {"status": values[0], "reason": values[2],
                                              "source_state": _state(row, field)}
                                       for field, values in parsed.items()})
                    observe("coordinates", "latitude,longitude", state, detail,
                            index, {"latitude": _cell(row.get("latitude")),
                                    "longitude": _cell(row.get("longitude"))},
                            "warning" if state in ("invalid", "partial") else "info")
            coordinate_review = {state + "_count": coordinate_states[state]
                                 for state in ("complete", "absent", "partial", "invalid")}
            coordinate_review["complete_pair_bounds"] = (
                {"latitude_min": _decimal_text(min(good_latitudes)),
                 "latitude_max": _decimal_text(max(good_latitudes)),
                 "longitude_min": _decimal_text(min(good_longitudes)),
                 "longitude_max": _decimal_text(max(good_longitudes))}
                if good_latitudes else None)
            for state in ("complete", "absent", "partial", "invalid"):
                coverage.append(_coverage(
                    "coordinates", "latitude,longitude", state,
                    row_count=coordinate_states[state],
                    note="Latitude -90..90 and longitude -180..180; complete pairs define bounds.",
                ))
    if not rows:
        observe("dataset", "", "empty", "The captured edition contains no received rows.", count=0)
    collections["coverage"] = {"columns": _COVERAGE_COLUMNS, "rows": coverage}
    collections["quality"] = {"columns": _QUALITY_COLUMNS, "rows": quality}
    aggregate_numeric = [field for field in _AGGREGATE_COLUMNS
                         if field == "capacity_rank" or field.endswith("_count")]
    recipes = [{
        "key": "plants", "title": "Plant records" if power_plants else "Source rows",
        "note": "Complete received source rows. Numeric lexemes remain text and source attribution is retained.",
        "sheet": "Plants" if power_plants else "Rows", "collection": "plants", "numeric": [],
    }]
    if power_plants:
        for name, title in (("countries", "Disclosed capacity by country"),
                            ("owners", "Disclosed capacity by owner"),
                            ("fuels", "Disclosed capacity by primary fuel")):
            if name == "owners" and "owner" not in semantic_columns:
                continue
            recipes.append({
                "key": name, "title": title, "sheet": name.title(), "collection": name,
                "numeric": aggregate_numeric,
                "note": "One source edition. Exact decimal MW totals include known, nonnegative capacity only; "
                        "unknown totals remain blank. Null, absent and blank group labels are distinct. "
                        "Capacity rank is computed with exact decimals; secondary fuels do not duplicate capacity.",
            })
    recipes.extend([
        {"key": "coverage", "title": "Source coverage", "sheet": "Coverage",
         "collection": "coverage",
         "numeric": [field for field in _COVERAGE_COLUMNS if field.endswith("_count")],
         "note": "Column types, nulls and blank values, with historical years and source attribution where present."},
        {"key": "quality", "title": "Observation review", "sheet": "Review",
         "collection": "quality", "numeric": ["row_number", "count"],
         "note": "Every affected observation retains its source row locator and original value."},
    ])
    return {
        "collections": collections, "recipes": recipes,
        "summary": {
            "rows": len(rows), "columns": len(normal_columns),
            "countries": len({_identity_token(row["country"], semantic_hints[index].get("country"))
                              for index, row in enumerate(semantic_rows)
                              if _state(row, "country") == "present"}) if power_plants else None,
            "owners": len({_identity_token(row["owner"], semantic_hints[index].get("owner"))
                           for index, row in enumerate(semantic_rows)
                           if _state(row, "owner") == "present"})
                      if power_plants and "owner" in semantic_columns else None,
            "primary_fuels": len({_identity_token(row["primary_fuel"], semantic_hints[index].get("primary_fuel"))
                                  for index, row in enumerate(semantic_rows)
                                  if _state(row, "primary_fuel") == "present"}) if power_plants else None,
            "disclosed_capacity_mw": capacity_review["disclosed_capacity_mw"] if capacity_review else None,
            "capacity_known_count": capacity_review["capacity_known_count"] if capacity_review else None,
            "capacity_missing_count": capacity_review["capacity_missing_count"] if capacity_review else None,
            "capacity_invalid_count": capacity_review["capacity_invalid_count"] if capacity_review else None,
            "capacity_year_missing_count": sum(
                _state(row, "year_of_capacity_data") != "present" for row in semantic_rows)
                if power_plants and "year_of_capacity_data" in semantic_columns else None,
            "coordinate_complete_count": coordinate_review["complete_count"] if coordinate_review else None,
            "recommended_key": ", ".join(preferred) or None,
        },
        "review": {
            "mode": "power_plants" if power_plants else "generic",
            "semantic_field_mapping": semantic_mapping,
            "edition_id": edition_id,
            "counts": {"rows": len(rows), "columns": len(columns),
                       "profiled_columns": len(normal_columns),
                       "eligible_single_column_keys": sum(item["eligible"] for item in candidates),
                       "observations": len(quality),
                       "warnings": sum(item["severity"] == "warning" for item in quality)},
            "keys": {"scope": "All received rows in this captured edition",
                     "recommended": preferred, "declared": declared_key,
                     "explicitly_reviewed": reviewed_key,
                     "local_locator": local_locator,
                     "gppd_idnr": candidate_map.get(gppd_field),
                     "candidates": candidates},
            "profiles": profiles, "capacity": capacity_review,
            "coordinates": coordinate_review, "generation_years": generation_review,
            "notes": [
                "Counts are integers; exact aggregated quantities remain decimal text for SQLite and workbook export.",
                "Original numeric lexemes, source labels, historical years and attribution remain in source rows.",
                "Null, blank text and an absent field are distinct observations.",
                "Key eligibility checks every received row; rowid and row:N are local source locators, not cross-edition business-key recommendations.",
                "Each call analyzes one captured source edition; publisher names are attribution, not dataset versions.",
            ],
        },
    }
