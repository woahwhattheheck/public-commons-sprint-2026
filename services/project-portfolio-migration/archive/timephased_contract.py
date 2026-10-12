"""Native timephased reporting selection and relational column contract."""
from __future__ import annotations

from datetime import datetime
import re

from portfolio.storage import digest, require

PROFILE_SCHEMA = "portfolio.timephased-profile.v1"
CAPTURE_SCHEMA = "portfolio.timephased-native-capture.v1"
PROJECTION = "portfolio.archive-projection.timephased.v1"
MAX_PERIODS = 3660
MAX_FACTS = 2_000_000
MAX_ACCRUAL_STEPS = 100_000
RANGE_SEMANTICS = "project-local native ranges; duration overlap excludes the finish; instant cost accrual includes endpoints and uses the first matching range"
MAX_CAPTURE_BYTES = 2 * 1024 ** 3
MAX_LINE_BYTES = 64 * 1024 ** 2
NAME = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
LOCAL = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?\Z")
UNITS = frozenset(
    {name for base in ("MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS")
     for name in (base, "ELAPSED_" + base)}
)
FIELDS = {
    "work": {"WORK", "ACTUAL_WORK", "ACTUAL_REGULAR_WORK", "ACTUAL_OVERTIME_WORK",
             "REMAINING_WORK", "REMAINING_REGULAR_WORK", "REMAINING_OVERTIME_WORK",
             "PLANNED_WORK", "BUDGET_WORK"},
    "money": {"COST", "ACTUAL_COST", "ACTUAL_REGULAR_COST", "ACTUAL_OVERTIME_COST",
              "REMAINING_COST", "REMAINING_REGULAR_COST", "REMAINING_OVERTIME_COST",
              "PLANNED_COST", "BUDGET_COST"},
    "material": {"MATERIAL", "ACTUAL_MATERIAL", "REMAINING_MATERIAL", "PLANNED_MATERIAL"},
}
for _index in range(11):
    _prefix = "BASELINE" + (str(_index) if _index else "")
    for _kind, _suffix in (("work", "WORK"), ("money", "COST"), ("material", "MATERIAL")):
        FIELDS[_kind].add(_prefix + "_" + _suffix)
        if _kind in {"work", "money"}:
            FIELDS[_kind].add(_prefix + "_BUDGET_" + _suffix)
NATIVE_TYPES = {"work": {"WORK"}, "money": {"CURRENCY"}, "material": {"NUMERIC", "UNITS"}}

HEADERS = {
    "timephased_source_sets": ("source_set_id", "project_key", "edition_id", "assignment_entity_id",
        "source_key", "field", "native_data_type", "definition_sha256", "capture", "state",
        "span_count", "value_sha256", "source_pointer", "resource_type", "dimension"),
    "timephased_spans": ("span_id", "source_set_id", "project_key", "edition_id",
        "assignment_entity_id", "source_key", "field", "ordinal", "start_text", "finish_text",
        "amount_per_hour_text", "amount_per_hour_type", "amount_per_hour_units", "amount_per_hour_elapsed",
        "total_amount_text", "total_amount_type", "total_amount_units", "total_amount_elapsed",
        "resource_type", "dimension", "material_label", "value_json", "source_pointer"),
    "resource_rate_entries": ("rate_entry_id", "project_key", "edition_id", "resource_entity_id",
        "source_key", "table_index", "entry_ordinal", "start_text", "finish_text",
        "cost_per_use_text", "cost_per_use_type", "currency", "currency_source",
        "value_json", "source_pointer"),
    "resource_rate_values": ("rate_value_id", "rate_entry_id", "project_key", "edition_id",
        "resource_entity_id", "rate_index", "amount_text", "units", "currency",
        "value_json", "source_pointer"),
    "resource_availability": ("availability_id", "project_key", "edition_id", "resource_entity_id",
        "source_key", "ordinal", "range_json", "units_text", "value_json", "source_pointer"),
    "calendar_rules": ("rule_id", "project_key", "edition_id", "calendar_entity_id", "source_key",
        "rule_kind", "ordinal", "weekday", "name", "start_text", "finish_text", "day_type",
        "working", "value_json", "source_pointer"),
    "timephased_captures": ("capture_id", "project_key", "edition_id", "model_sha256",
        "profile_sha256", "recipe_sha256", "native_version", "native_runtime_json",
        "captured_at", "assignment_count", "fact_count", "sha256", "bytes", "package_path",
        "baseline_calendar_uid", "baseline_calendar_entity_id", "baseline_calendar_resolution",
        "baseline_calendar_sha256", "baseline_calendar_json", "input_admission_json", "binding_json"),
    "timephased_periods": ("period_id", "project_key", "edition_id", "profile_sha256", "period_key",
        "label", "ordinal", "start_text", "finish_text", "range_semantics"),
    "timephased_series": ("series_id", "project_key", "edition_id", "profile_sha256", "series",
        "field", "kind", "requested_units", "native_data_type", "definition_sha256", "definition_json",
        "method", "grain", "calendar_basis", "boundary_semantics", "source_pointer"),
    "timephased_assignment_basis": ("basis_id", "capture_id", "project_key", "edition_id",
        "assignment_entity_id", "source_key", "task_entity_id", "task_resolution", "resource_entity_id",
        "resource_resolution", "resource_type", "material_label", "effective_calendar_uid",
        "calendar_entity_id", "calendar_resolution", "calendar_sha256", "effective_calendar_json",
        "cost_rate_table_json", "resource_rates_sha256", "native_range_admission_json", "source_pointer"),
    "timephased_values": ("fact_id", "capture_id", "basis_id", "project_key", "edition_id",
        "assignment_entity_id", "source_key", "series_id", "series", "field", "kind", "calendar_basis", "calendar_sha256", "period_id",
        "period_key", "start_text", "finish_text", "state", "value_text", "value_type", "units", "elapsed",
        "currency", "currency_source", "material_label", "resource_entity_id", "resource_type",
        "native_data_type", "definition_sha256", "value_json", "error_json", "source_pointer"),
    "timephased_totals": ("total_id", "capture_id", "project_key", "edition_id", "series_id",
        "series", "field", "kind", "grain", "period_id", "period_key", "start_text", "finish_text",
        "currency", "currency_source", "units", "elapsed", "material_resource_entity_id",
        "material_label", "native_data_type", "definition_sha256", "total_text", "value_rows",
        "null_rows", "not_applicable_rows", "error_rows", "completeness"),
}
PRIMARY = {table: (columns[0],) for table, columns in HEADERS.items()}


def local_time(value):
    require(isinstance(value, str) and LOCAL.fullmatch(value), "timephased_local_time",
            "Use an explicit project-local date and time with T and no timezone conversion.", value)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError("The selected project-local period boundary is not a valid calendar value.") from error
    require(parsed.tzinfo is None, "timephased_timezone", "Keep the native project's local time.")
    return parsed.isoformat(timespec="microseconds" if parsed.microsecond else "seconds")


def normalize_profile(value, coverage):
    if value is None:
        return None
    require(isinstance(value, dict) and set(value) <= {"schema", "periods", "series"},
            "timephased_profile", "Select the original native reporting ranges and assignment series.")
    require(value.get("schema", PROFILE_SCHEMA) == PROFILE_SCHEMA, "timephased_profile_schema",
            "Use the original timephased reporting profile.")
    periods = value.get("periods")
    require(isinstance(periods, list) and 1 <= len(periods) <= MAX_PERIODS,
            "timephased_period_count", "Select 1 to 3,660 exact reporting periods.")
    normalized, keys, previous_finish = [], set(), None
    for ordinal, item in enumerate(periods):
        require(isinstance(item, dict) and set(item) == {"key", "label", "start", "finish"},
                "timephased_period", "Retain each period key, label and the exact native local start/finish bounds.")
        key, label = item["key"], item["label"]
        require(isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", key)
                and key not in keys and isinstance(label, str) and 0 < len(label) <= 240,
                "timephased_period_identity", "Give every period a unique key and readable label.")
        start, finish = local_time(item["start"]), local_time(item["finish"])
        require(datetime.fromisoformat(start) < datetime.fromisoformat(finish)
                and (previous_finish is None or datetime.fromisoformat(start) >= datetime.fromisoformat(previous_finish)),
                "timephased_period_overlap", "Keep the selected periods ordered, nonempty and nonoverlapping.")
        normalized.append({"key": key, "label": label, "start": start, "finish": finish})
        keys.add(key)
        previous_finish = finish
    definitions = {item["field"]: item for item in coverage["assignments"]}
    selected, names = value.get("series"), set()
    require(isinstance(selected, list) and 1 <= len(selected) <= 32,
            "timephased_series_count", "Choose 1 to 32 named native assignment series.")
    result = []
    for item in selected:
        require(isinstance(item, dict) and set(item) <= {"name", "field", "kind", "units"}
                and all(key in item for key in ("name", "field", "kind")),
                "timephased_series", "Keep the native series name, field, kind and work unit.")
        name, field, kind = item["name"], item["field"], item["kind"]
        require(isinstance(name, str) and NAME.fullmatch(name) and name not in names
                and kind in FIELDS and field in FIELDS[kind] and field in definitions,
                "timephased_native_field", "Choose a distinct series and a supported native assignment field.", item)
        types = {entry.get("data_type") for entry in definitions[field]["definitions"].values()}
        require(types and None not in types and types <= NATIVE_TYPES[kind],
                "timephased_native_type", "The chosen field's original native definitions do not match this series kind.",
                {"field": field, "kind": kind, "definitions": definitions[field]["definitions"]})
        units = item.get("units")
        require(units in UNITS if kind == "work" else units is None,
                "timephased_units", "Choose an explicit native work unit; currency and material retain their own units.")
        result.append({"name": name, "field": field, "kind": kind, **({"units": units} if kind == "work" else {})})
        names.add(name)
    return {"schema": PROFILE_SCHEMA, "periods": normalized, "series": result}


def profile_sha(profile):
    return digest(profile)


def source_binding(edition, profile):
    return {"edition_id": edition["id"], "model_sha256": edition["sha256"],
            "source_ids": edition["source_ids"], "recipe_sha256": digest(edition["recipe"]),
            "profile_sha256": profile_sha(profile)}


def period_identity(edition_id, profile, key):
    return digest({"edition_id": edition_id, "profile_sha256": profile_sha(profile), "period": key})


def series_identity(edition_id, profile, name):
    return digest({"edition_id": edition_id, "profile_sha256": profile_sha(profile), "series": name})


def method(series):
    return "ResourceAssignment.getTimephasedDurationValues" if series["kind"] == "work" else "ResourceAssignment.getTimephasedNumericValues"


def applicable(kind, resource_type):
    if kind == "work" and resource_type in {"MATERIAL", "COST"}:
        return False
    if kind == "material" and resource_type != "MATERIAL":
        return False
    return True


def series_semantics(series):
    return {
        "calendar_basis": "project_baseline_calendar" if series["field"].startswith("BASELINE") else "assignment_effective_calendar",
        "boundary_semantics": RANGE_SEMANTICS if series["kind"] == "money" else "project-local native duration/material overlap; finish excluded from duration overlap",
    }
