"""Exact per-project reporting measures with an explicit native row grain."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation, localcontext
import re

from portfolio.storage import digest, require
from .projection import encoded, row_identity, pointer_token

DEFAULTS = (
    {"name": "planned_work", "field": "WORK", "kind": "work"},
    {"name": "actual_work", "field": "ACTUAL_WORK", "kind": "work"},
    {"name": "remaining_work", "field": "REMAINING_WORK", "kind": "work"},
    {"name": "current_cost", "field": "COST", "kind": "money"},
    {"name": "actual_cost", "field": "ACTUAL_COST", "kind": "money"},
    {"name": "baseline_cost", "field": "BASELINE_COST", "kind": "money"},
)
TOTAL_HEADERS = ("metric_id", "project_key", "edition_id", "grain", "metric", "field", "kind",
                 "native_data_type", "definition_sha256", "currency", "currency_source", "units", "elapsed", "total_text", "contributing_rows",
                 "missing_rows", "unsupported_rows", "excluded_summary_rows", "completeness")
CONTRIBUTION_HEADERS = ("metric_id", "project_key", "edition_id", "entity_id", "family", "source_key",
                        "metric", "field", "state", "value_text", "currency", "units", "elapsed",
                        "value_json", "source_pointer", "reason", "native_data_type", "definition_sha256")
KINDS = {"money": {"CURRENCY"}, "work": {"WORK", "DURATION", "DELAY"},
         "number": {"NUMERIC", "INTEGER", "SHORT"}}
DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
NAME = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")


def measure_profile(value, coverage):
    value = {} if value is None else value
    require(isinstance(value, dict) and set(value) <= {"grain", "measures"},
            "archive_measures", "Use the named native grain and measure definitions.")
    grain = value.get("grain", "project")
    require(grain in {"project", "leaf_tasks", "assignments"},
            "archive_measure_grain", "Choose project properties, leaf tasks or assignments.")
    family = "tasks" if grain == "leaf_tasks" else grain
    definitions = {item["field"]: item for item in coverage[family]}
    available = set(definitions)
    measures = value.get("measures", [dict(item) for item in DEFAULTS if item["field"] in available])
    require(isinstance(measures, list) and len(measures) <= 32,
            "archive_measure_selection", "Choose up to 32 exact native reporting measures.")
    names = set()
    for item in measures:
        require(isinstance(item, dict) and set(item) == {"name", "field", "kind"}
                and isinstance(item["name"], str) and NAME.fullmatch(item["name"])
                and item["field"] in available and item["kind"] in {"money", "work", "number"},
                "archive_measure_definition", "Choose a unique measure name, actual native field and numeric kind.")
        require(item["name"] not in names, "archive_measure_name", "Give each measure a distinct report name.")
        declared = definitions[item["field"]]["definitions"]
        data_types = {definition.get("data_type") for definition in declared.values()
                      if isinstance(definition, dict) and definition.get("data_type") is not None}
        require(data_types and data_types <= KINDS[item["kind"]],
                "archive_measure_native_type",
                "Bind this measure to its original native data type; keep non-additive or differently defined values in the source tables.",
                {"field": item["field"], "kind": item["kind"], "data_types": sorted(data_types),
                 "definition_sha256s": sorted(declared)})
        names.add(item["name"])
    return {"grain": grain, "measures": [dict(item) for item in measures]}


def currency_context(member, model):
    original = model["project"].get("fields", {}).get("CURRENCY_CODE")
    native = original.get("value") if isinstance(original, dict) else None
    native_code = native if isinstance(native, str) and re.fullmatch(r"[A-Z]{3}", native) else None
    declared = member.get("currency")
    if declared is not None:
        require(isinstance(declared, dict) and set(declared) == {"code", "note"}
                and isinstance(declared["code"], str) and re.fullmatch(r"[A-Z]{3}", declared["code"])
                and isinstance(declared["note"], str) and bool(declared["note"].strip()),
                "archive_currency", "A project currency declaration needs its three-letter code and source note.")
        require(native_code is None or native_code == declared["code"],
                "archive_currency_conflict", "The declared currency differs from the actual native project code.")
        return declared["code"], encoded({"kind": "reviewed_declaration", **declared,
                                         "native_currency_code": original})
    if native_code:
        return native_code, encoded({"kind": "native_field", "field": "CURRENCY_CODE", "value": original})
    return "UNSPECIFIED:" + member["project_key"], encoded({
        "kind": "project_specific_unspecified", "native_currency_code": original,
        "native_symbol": model["project"].get("fields", {}).get("CURRENCY_SYMBOL"),
    })


def decimal_value(text):
    if not isinstance(text, str) or len(text) > 4096 or not DECIMAL.fullmatch(text):
        raise ValueError("The native numeric value is not finite original decimal text.")
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError("The native decimal value could not be read.") from exc
    if not value.is_finite() or abs(value.as_tuple().exponent) > 10000 or abs(value.adjusted()) > 10000:
        raise ValueError("The original value is outside the declared exact-decimal reporting range.")
    return value


def exact_sum(values):
    if not values:
        return None
    minimum_exponent = min(value.as_tuple().exponent for value in values)
    maximum_adjusted = max(value.adjusted() for value in values)
    with localcontext() as context:
        context.prec = max(28, maximum_adjusted - minimum_exponent + len(str(len(values))) + 4)
        context.Emax, context.Emin = 999999, -999999
        return format(sum(values, Decimal(0)), "f")


def selected_rows(model, grain):
    if grain == "project":
        return [("project", model["project"], "/project")], [], []
    if grain == "assignments":
        return [("assignments", row, "/assignments/" + str(i))
                for i, row in enumerate(model["assignments"])], [], []
    rows = model["tasks"]
    indices = defaultdict(list)
    for row in rows:
        if row.get("uid") is not None:
            indices[str(row["uid"])].append(row["key"])
    parents, ambiguous = set(), set()
    for row in rows:
        if row.get("parent_uid") is not None:
            matches = indices.get(str(row["parent_uid"]), [])
            if len(matches) == 1:
                parents.add(matches[0])
            elif matches:
                ambiguous.update(matches)
    included, excluded, findings = [], [], []
    for i, row in enumerate(rows):
        summary = row.get("fields", {}).get("SUMMARY")
        marked = summary.get("value") if isinstance(summary, dict) and summary.get("type") == "boolean" else None
        is_parent = row["key"] in parents
        if marked is True or is_parent or row["key"] in ambiguous:
            excluded.append(row["key"])
            if marked is False and is_parent or row["key"] in ambiguous:
                item = {"code": "archive_leaf_grain", "severity": "review",
                        "path": "/tasks/" + str(i),
                        "message": "This row was excluded from leaf-task totals because its original hierarchy requires review.",
                        "details": {"key": row["key"], "native_summary": summary,
                                    "has_native_children": is_parent, "ambiguous_parent_uid": row["key"] in ambiguous}}
                findings.append({"id": digest(item), **item})
        else:
            included.append(("tasks", row, "/tasks/" + str(i)))
    return included, excluded, findings


def project_measures(member, edition, profile, emit=None):
    """Retain each original contribution; stream rows when building a large archive."""
    model, eid = edition["model"], edition["id"]
    rows, excluded, findings = selected_rows(model, profile["grain"])
    currency, currency_source = currency_context(member, model)
    measure_family = "tasks" if profile["grain"] == "leaf_tasks" else profile["grain"]
    catalogue = model.get("field_catalogue", {}).get(measure_family, {})
    totals, contributions = [], []
    for spec in profile["measures"]:
        definition = catalogue.get(spec["field"])
        data_type = definition.get("data_type") if isinstance(definition, dict) else None
        definition_sha = digest(definition) if definition is not None else None
        groups = {}
        incomplete = {"missing": 0, "unsupported": 0}

        def identity(code, units, elapsed):
            return digest({"project_key": member["project_key"], "edition_id": eid, "grain": profile["grain"],
                           "metric": spec["name"], "field": spec["field"], "kind": spec["kind"],
                           "currency": code, "units": units, "elapsed": elapsed})

        for family, row, pointer in rows:
            value = row.get("fields", {}).get(spec["field"])
            entry = {"project_key": member["project_key"], "edition_id": eid,
                     "entity_id": row_identity(eid, family, row["key"]), "family": family,
                     "source_key": row["key"], "metric": spec["name"], "field": spec["field"],
                     "currency": currency if spec["kind"] == "money" else None,
                     "units": None, "elapsed": None, "value_json": encoded(value),
                     "source_pointer": pointer + "/fields/" + pointer_token(spec["field"]),
                     "value_text": None, "reason": None, "metric_id": None,
                     "native_data_type": data_type, "definition_sha256": definition_sha}
            if value is None:
                entry.update(state="missing", reason="The selected original native field has no value.")
                incomplete["missing"] += 1
            else:
                try:
                    if not isinstance(value, dict):
                        raise ValueError("The selected field lacks its original typed value.")
                    if data_type not in KINDS[spec["kind"]]:
                        raise ValueError("The original field definition does not support this selected additive measure kind.")
                    if spec["kind"] == "work":
                        if value.get("type") != "duration" or not isinstance(value.get("units"), str):
                            raise ValueError("Work totals require an original duration with its native units.")
                        if value.get("elapsed") is not None and type(value["elapsed"]) is not bool:
                            raise ValueError("The original elapsed flag is not a boolean.")
                        entry["units"] = value["units"]
                        entry["elapsed"] = "unspecified" if value.get("elapsed") is None else "true" if value["elapsed"] else "false"
                    elif value.get("type") not in {"integer", "number"}:
                        raise ValueError("The selected money or numeric field is not an original numeric value.")
                    amount = decimal_value(value.get("value"))
                    entry.update(state="included", value_text=value["value"])
                    group_key = (entry["currency"], entry["units"], entry["elapsed"])
                    selected = groups.setdefault(group_key, {"total": None, "count": 0})
                    selected["total"] = amount if selected["total"] is None else Decimal(exact_sum([selected["total"], amount]))
                    selected["count"] += 1
                    entry["metric_id"] = identity(*group_key)
                except ValueError as error:
                    entry.update(state="unsupported", reason=str(error))
                    incomplete["unsupported"] += 1
            if emit is None:
                contributions.append(entry)
            else:
                emit(entry)
        if not groups:
            groups[(currency if spec["kind"] == "money" else None, None, None)] = {"total": None, "count": 0}
        for (code, units, elapsed), group in groups.items():
            totals.append({"metric_id": identity(code, units, elapsed), "project_key": member["project_key"],
                           "edition_id": eid, "grain": profile["grain"], "metric": spec["name"],
                           "field": spec["field"], "kind": spec["kind"], "native_data_type": data_type,
                           "definition_sha256": definition_sha, "currency": code,
                           "currency_source": currency_source if spec["kind"] == "money" else None,
                           "units": units, "elapsed": elapsed,
                           "total_text": None if group["total"] is None else format(group["total"], "f"),
                           "contributing_rows": str(group["count"]), "missing_rows": str(incomplete["missing"]),
                           "unsupported_rows": str(incomplete["unsupported"]), "excluded_summary_rows": str(len(excluded)),
                           "completeness": "empty" if not rows else "unavailable" if not group["count"]
                               else "partial" if any(incomplete.values()) else "complete"})
    return totals, contributions, findings
