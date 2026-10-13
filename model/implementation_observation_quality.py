"""Describe the support of actual saved field measurements and campaign records.

Summaries retain original result types, methods, units, fractions, basis, QA and
qualifiers. Campaign coverage uses only explicitly linked visits and exact
declared site/parameter strings. Sampling dates describe collection events.
"""
from __future__ import annotations

from collections import Counter, defaultdict
import csv
import datetime as dt
import io
import json
from pathlib import Path

from .common import atomic_bytes, atomic_json, digest
from .implementation_schema import document_digest, validate_plan

SCHEMA = "upstate.implementation-observation-quality/v1"
EDITION = "field-measurement-support-20261013-v2-source-method-context"
TYPES = ("numeric", "censored", "text", "missing")
DIMENSIONS = ("site_id", "parameter", "unit", "basis", "fraction", "method",
              "method_context", "method_name", "activity_method",
              "activity_method_context", "activity_method_name", "qa_status", "qualifier")
RESULT_FIELDS = ("result_rows", "numeric", "censored", "text", "missing")
WQP_LIMIT_FIELDS = (
    "DetectionQuantitationLimitTypeName",
    "DetectionQuantitationLimitMeasure/MeasureValue",
    "DetectionQuantitationLimitMeasure/MeasureUnitCode",
)
TABLES = {
    "comparison-strata.csv": ("comparison_strata", (
        "id", *DIMENSIONS, *RESULT_FIELDS, "numeric_min", "numeric_max",
        "dated_rows", "undated_rows", "first_collection", "last_collection",
        "distinct_collection_instants", "distinct_local_dates", "observation_ids")),
    "definition-variants.csv": ("definition_variants", (
        "site_id", "parameter", "result_rows", "strata_count", "units", "bases",
        "fractions", "methods", "method_contexts", "method_names", "activity_methods",
        "activity_method_contexts", "activity_method_names", "qa_codes", "qualifiers",
        "stratum_ids", "observation_ids")),
    "campaign-coverage.csv": ("campaign_coverage", (
        "campaign_id", "campaign_title", "site_id", "parameter", "linked_visits",
        "complete_visits", "planned_visits", "cancelled_visits", "sample_activities",
        "samples_with_collection_time", *RESULT_FIELDS, "nonmissing_rows",
        "rows_on_cancelled_visits", "dated_rows", "first_collection",
        "last_collection", "units", "methods", "observation_ids")),
    "sample-followup.csv": ("sample_followup", (
        "activity_id", "sample_id", "site_id", "visit_id", "visit_status",
        "campaign_id", "collected_at", "activity_method", "custody_ref",
        "state", *RESULT_FIELDS, "observation_ids")),
    "sampling-calendar.csv": ("sampling_calendar", (
        "site_id", "parameter", "local_month", *RESULT_FIELDS, "activity_count",
        "distinct_local_dates", "observation_ids")),
    "source-limits.csv": ("source_limits", (
        "observation_id", "site_id", "parameter", "result_type", "original_result",
        "result_unit", "limit_origin", "limit_type", "limit_value", "limit_unit",
        "source_link_id", "source_record", "original_pointer")),
    "method-inventory.csv": ("method_inventory", (
        "id", "parameter", "method", "method_context", "method_name", "method_binding",
        "activity_method", "activity_method_context", "activity_method_name", "activity_method_binding",
        "collection_equipment", "original_analytical_method", "original_collection_method",
        "collection_field_origins", "original_collection_conflicts", *RESULT_FIELDS,
        "site_ids", "activity_ids", "observation_ids", "source_link_ids", "original_pointers")),
    "metadata-availability.csv": ("metadata_availability", (
        "field", "recorded_rows", "unstated_rows", "total_rows", "meaning")),
}


def _text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def _stamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def _counts(records):
    counts = Counter(row["observation"]["result_type"] for row in records)
    return {"result_rows": len(records), **{kind: counts[kind] for kind in TYPES}}


def _times(records):
    stamps = [row["activity"].get("collected_at") for row in records
              if row["activity"].get("collected_at")]
    ordered = sorted(stamps, key=_stamp)
    return {
        "dated_rows": len(stamps), "undated_rows": len(records) - len(stamps),
        "first_collection": ordered[0] if ordered else None,
        "last_collection": ordered[-1] if ordered else None,
        "distinct_collection_instants": len({_stamp(value) for value in stamps}),
        "distinct_local_dates": len({_stamp(value).date().isoformat() for value in stamps}),
    }


def _values(records, field):
    return sorted({row["dimensions"][field] for row in records})


def _original_pointer(index, collection="observations"):
    return "original/plan.json#/" + collection + "/" + str(index)


COLLECTION_SOURCE_FIELDS = {
    "identifier": "SampleCollectionMethod/MethodIdentifier",
    "context": "SampleCollectionMethod/MethodIdentifierContext",
    "name": "SampleCollectionMethod/MethodName",
    "qualifier": "SampleCollectionMethod/MethodQualifierTypeName",
    "description": "SampleCollectionMethod/MethodDescriptionText",
    "equipment": "SampleCollectionEquipmentName",
    "equipment_comment": "SampleCollectionMethod/SampleCollectionEquipmentCommentText",
    "container_type": "SampleContainerTypeName",
    "container_color": "SampleContainerColorName",
    "chemical_preservative": "ChemicalPreservativeUsedName",
    "thermal_preservative": "ThermalPreservativeUsedName",
    "transport_storage": "SampleTransportStorageDescription",
}


def _declared(value):
    return value if isinstance(value, str) else ""


def method_context(observation, activity):
    """Expose original declared method definitions without replacing native fields."""
    lab = observation.get("lab_source")
    lab = lab if isinstance(lab, dict) else {}
    raw = lab.get("original_row")
    raw = raw if isinstance(raw, dict) else {}
    original_activity = activity.get("original_activity")
    original_activity = original_activity if isinstance(original_activity, dict) else {}
    analytical = {
        "identifier": _declared(raw.get("ResultAnalyticalMethod/MethodIdentifier")),
        "context": _declared(raw.get("ResultAnalyticalMethod/MethodIdentifierContext")),
        "name": _declared(raw.get("ResultAnalyticalMethod/MethodName")),
        "description": _declared(raw.get("MethodDescriptionText")),
    }
    collection, origins, conflicts = {}, {}, []
    definition_fields = ("identifier", "context", "name", "qualifier", "description")
    # Keep one original collection-method declaration together. Independent
    # equipment/container fields may fall back without creating a mixed method.
    activity_definition = any(_declared(original_activity.get(COLLECTION_SOURCE_FIELDS[key])).strip()
                              for key in definition_fields)
    definition_source = (original_activity if activity_definition else raw)
    definition_origin = ("activity.original_activity" if activity_definition
                         else "observation.lab_source.original_row")
    for field, header in COLLECTION_SOURCE_FIELDS.items():
        from_activity = _declared(original_activity.get(header))
        from_result = _declared(raw.get(header))
        if field in definition_fields:
            collection[field] = _declared(definition_source.get(header))
            origins[field] = definition_origin if collection[field].strip() else ""
        elif from_activity.strip():
            collection[field], origins[field] = from_activity, "activity.original_activity"
        elif from_result.strip():
            collection[field], origins[field] = from_result, "observation.lab_source.original_row"
        else:
            collection[field], origins[field] = "", ""
        if from_activity.strip() and from_result.strip() and from_activity != from_result:
            conflicts.append({"field": field, "header": header,
                              "original_activity": from_activity, "original_result_row": from_result})

    def bind(canonical, native_context, native_name, original):
        canonical = _declared(canonical)
        explicit_context, explicit_name = _declared(native_context), _declared(native_name)
        explicit_context = explicit_context if explicit_context.strip() else ""
        explicit_name = explicit_name if explicit_name.strip() else ""
        matches_id = bool(canonical.strip() and original["identifier"].strip()
                          and canonical.strip() == original["identifier"].strip())
        matches_name = bool(canonical.strip() and original["name"].strip()
                            and canonical.strip() == original["name"].strip())
        linked = matches_id or matches_name
        context_agrees = (not explicit_context.strip() or not original["context"].strip()
                          or explicit_context.strip() == original["context"].strip())
        binding = ("explicit_native_context" if explicit_context else
                   "matches_original_identifier" if matches_id else
                   "matches_original_name" if matches_name else
                   "original_definition_retained_separately")
        return {
            "context": explicit_context or (original["context"] if linked else ""),
            "name": explicit_name or (original["name"] if linked and context_agrees else ""),
            "binding": binding,
        }

    laboratory = bind(observation.get("method"), observation.get("method_context"),
                      observation.get("method_name"), analytical)
    field = bind(activity.get("method"), activity.get("method_context"),
                 activity.get("method_name"), collection)
    original_link = activity.get("original_source")
    original_link = original_link if isinstance(original_link, dict) else {}
    return {
        "method_context": laboratory["context"], "method_name": laboratory["name"],
        "method_binding": laboratory["binding"],
        "activity_method_context": field["context"], "activity_method_name": field["name"],
        "activity_method_binding": field["binding"],
        "collection_equipment": collection["equipment"],
        "original_analytical_method": analytical,
        "original_collection_method": collection,
        "collection_field_origins": origins,
        "original_collection_conflicts": conflicts,
        "original_source_links": list(dict.fromkeys(value for value in (
            lab.get("source_link_id"), original_link.get("source_link_id"), activity.get("source_ref"))
            if isinstance(value, str) and value)),
        "original_lab_record": lab.get("record"),
        "original_activity_record": original_link.get("csv_record"),
    }


def _method_inventory(records):
    grouped = defaultdict(list)
    for record in records:
        method = record["method_definition"]
        definition = {
            "parameter": record["observation"]["parameter"],
            "method": record["observation"].get("method") or "",
            "activity_method": record["activity"].get("method") or "",
            **{key: method[key] for key in (
                "method_context", "method_name", "method_binding",
                "activity_method_context", "activity_method_name", "activity_method_binding",
                "collection_equipment", "original_analytical_method", "original_collection_method",
                "collection_field_origins", "original_collection_conflicts")},
        }
        grouped[digest(definition)].append((definition, record))
    inventory = []
    for key, values in sorted(grouped.items()):
        definition = values[0][0]
        rows = [item[1] for item in values]
        inventory.append({
            "id": "field-method-" + key[:24], **definition, **_counts(rows),
            "site_ids": sorted({row["site"]["id"] for row in rows}),
            "activity_ids": sorted({row["activity"]["id"] for row in rows}),
            "observation_ids": [row["observation"]["id"] for row in rows],
            "source_link_ids": sorted({source for row in rows
                                      for source in row["method_definition"]["original_source_links"]}),
            "original_pointers": [row["original_pointer"] for row in rows],
        })
    return inventory


def _method_label(code, context, name):
    return "\n".join(label + ": " + value for label, value in
                     (("Identifier", _declared(code)), ("Context", _declared(context)),
                      ("Name", _declared(name))) if value)


def _collection_label(method):
    collection = method["original_collection_method"]
    lines = [_method_label(collection["identifier"], collection["context"], collection["name"])]
    lines.extend(label + ": " + collection[field] for field, label in (
        ("equipment", "Equipment"), ("container_type", "Container"),
        ("container_color", "Container colour"), ("chemical_preservative", "Chemical preservation"),
        ("thermal_preservative", "Thermal preservation"), ("transport_storage", "Transport / storage"))
        if collection[field])
    return "\n".join(line for line in lines if line)


def summarize_field_quality(saved_plan, *, attachment_inventory=()):
    """Return source-bound, descriptive support for one original saved revision."""
    plan = validate_plan(saved_plan)
    sites = {row["id"]: row for row in plan["sites"]}
    visits = {row["id"]: row for row in plan["visits"]}
    activities = {row["id"]: row for row in plan["activities"]}
    campaigns = {row["id"]: row for row in plan["monitoring_plans"]}
    records, by_activity, by_campaign_pair = [], defaultdict(list), defaultdict(list)
    comparison, variants, calendar = defaultdict(list), defaultdict(list), defaultdict(list)
    source_limits = []
    for index, observation in enumerate(plan["observations"]):
        activity = activities[observation["activity_id"]]
        visit = visits[activity["visit_id"]]
        site = sites[activity["site_id"]]
        method = method_context(observation, activity)
        dimensions = {
            "site_id": site["id"], "parameter": observation["parameter"],
            "unit": observation["unit"], "activity_method": activity.get("method") or "",
            **{key: method[key] for key in ("method_context", "method_name",
                                          "activity_method_context", "activity_method_name")},
            **{key: observation.get(key) or "" for key in ("basis", "fraction", "method", "qa_status", "qualifier")},
        }
        record = {"observation": observation, "activity": activity, "visit": visit,
                  "site": site, "dimensions": dimensions, "method_definition": method,
                  "original_pointer": _original_pointer(index)}
        records.append(record)
        by_activity[activity["id"]].append(record)
        comparison[tuple(dimensions[field] for field in DIMENSIONS)].append(record)
        variants[(site["id"], observation["parameter"])].append(record)
        campaign_id = visit.get("monitoring_plan_id")
        if campaign_id:
            by_campaign_pair[(campaign_id, site["id"], observation["parameter"])].append(record)
        stamp = activity.get("collected_at")
        month = _stamp(stamp).date().isoformat()[:7] if stamp else ""
        calendar[(site["id"], observation["parameter"], month)].append(record)
        lab = observation.get("lab_source") or {}
        if not isinstance(lab, dict):
            lab = {}
        base_limit = {
            "observation_id": observation["id"], "site_id": site["id"],
            "parameter": observation["parameter"], "result_type": observation["result_type"],
            "original_result": observation["original_text"], "result_unit": observation["unit"],
            "source_link_id": lab.get("source_link_id"), "source_record": lab.get("record"),
            "original_pointer": _original_pointer(index),
        }
        for field in ("detection_limit", "quantitation_limit"):
            if observation.get(field) is not None:
                source_limits.append({
                    **base_limit, "limit_origin": "explicit_native_field",
                    "limit_type": field, "limit_value": observation[field],
                    "limit_unit": observation["unit"],
                })
        original = lab.get("original_row")
        if isinstance(original, dict) and all(key in original for key in WQP_LIMIT_FIELDS):
            values = [original[key] for key in WQP_LIMIT_FIELDS]
            if any(value not in (None, "") for value in values):
                source_limits.append({
                    **base_limit, "limit_origin": "original_WQP_labelled_fields",
                    "limit_type": values[0], "limit_value": values[1], "limit_unit": values[2],
                    "source_headers": list(WQP_LIMIT_FIELDS),
                })

    strata = []
    for key, group in sorted(comparison.items()):
        numeric = [row["observation"]["value"] for row in group
                   if row["observation"]["result_type"] == "numeric"]
        fields = dict(zip(DIMENSIONS, key))
        strata.append({
            "id": "field-stratum-" + digest(fields)[:24], **fields, **_counts(group), **_times(group),
            "numeric_min": min(numeric) if numeric else None,
            "numeric_max": max(numeric) if numeric else None,
            "observation_ids": [row["observation"]["id"] for row in group],
            "original_pointers": [row["original_pointer"] for row in group],
        })
    stratum_index = {tuple(item[field] for field in DIMENSIONS): item["id"] for item in strata}
    definitions = []
    for (site_id, parameter), group in sorted(variants.items()):
        selected = sorted({stratum_index[tuple(row["dimensions"][field] for field in DIMENSIONS)]
                           for row in group})
        definitions.append({
            "site_id": site_id, "parameter": parameter, "result_rows": len(group),
            "strata_count": len(selected),
            **{title: _values(group, field) for title, field in (
                ("units", "unit"), ("bases", "basis"), ("fractions", "fraction"),
                ("methods", "method"), ("method_contexts", "method_context"), ("method_names", "method_name"),
                ("activity_methods", "activity_method"), ("activity_method_contexts", "activity_method_context"),
                ("activity_method_names", "activity_method_name"),
                ("qa_codes", "qa_status"), ("qualifiers", "qualifier"))},
            "stratum_ids": selected,
            "observation_ids": [row["observation"]["id"] for row in group],
        })

    coverage = []
    campaign_summaries = []
    for campaign_index, campaign in enumerate(plan["monitoring_plans"]):
        campaign_visits = [row for row in plan["visits"] if row.get("monitoring_plan_id") == campaign["id"]]
        visit_ids = {row["id"] for row in campaign_visits}
        campaign_records = [row for row in records if row["visit"]["id"] in visit_ids]
        declared = {(site_id, parameter) for site_id in campaign["site_ids"] for parameter in campaign["parameters"]}
        represented = {(row["site"]["id"], row["observation"]["parameter"]) for row in campaign_records}
        nonmissing = {(row["site"]["id"], row["observation"]["parameter"]) for row in campaign_records
                      if row["observation"]["result_type"] != "missing"}
        campaign_summaries.append({
            "campaign_id": campaign["id"], "title": campaign["title"], "objective": campaign["objective"],
            "site_ids": list(campaign["site_ids"]), "parameters": list(campaign["parameters"]),
            "declared_frequency": campaign.get("frequency"), "declared_method_ref": campaign.get("method_ref"),
            "declared_site_parameter_pairs": len(declared),
            "pairs_with_any_result_record": len(declared & represented),
            "pairs_with_nonmissing_result": len(declared & nonmissing),
            "pairs_without_result_records": len(declared - represented),
            "additional_recorded_pairs": [list(pair) for pair in sorted(represented - declared)],
            "linked_visit_ids": [row["id"] for row in campaign_visits],
            "original_pointer": _original_pointer(campaign_index, "monitoring_plans"),
        })
        for site_id, parameter in sorted(declared):
            linked_visits = [row for row in campaign_visits if row["site_id"] == site_id]
            linked_ids = {row["id"] for row in linked_visits}
            samples = [row for row in plan["activities"] if row["visit_id"] in linked_ids and row["kind"] == "sample"]
            group = by_campaign_pair[(campaign["id"], site_id, parameter)]
            counts = _counts(group)
            coverage.append({
                "campaign_id": campaign["id"], "campaign_title": campaign["title"],
                "site_id": site_id, "parameter": parameter, "linked_visits": len(linked_visits),
                **{state + "_visits": sum(row["status"] == state for row in linked_visits)
                   for state in ("complete", "planned", "cancelled")},
                "sample_activities": len(samples),
                "samples_with_collection_time": sum(bool(row.get("collected_at")) for row in samples),
                **counts, "nonmissing_rows": counts["result_rows"] - counts["missing"],
                "rows_on_cancelled_visits": sum(row["visit"]["status"] == "cancelled" for row in group),
                **_times(group), "units": _values(group, "unit"), "methods": _values(group, "method"),
                "observation_ids": [row["observation"]["id"] for row in group],
            })

    followup = []
    for activity in plan["activities"]:
        if activity["kind"] != "sample":
            continue
        group = by_activity[activity["id"]]
        if group and any(row["observation"]["result_type"] != "missing" for row in group):
            continue
        visit = visits[activity["visit_id"]]
        state = ("only_missing_result_records" if group else
                 "collected_no_result_records" if activity.get("collected_at") else
                 "collection_time_unrecorded_no_results")
        followup.append({
            "activity_id": activity["id"], "sample_id": activity["sample_id"], "site_id": activity["site_id"],
            "visit_id": visit["id"], "visit_status": visit["status"],
            "campaign_id": visit.get("monitoring_plan_id"), "collected_at": activity.get("collected_at"),
            "activity_method": activity.get("method"), "custody_ref": activity.get("custody_ref"),
            "state": state, **_counts(group),
            "observation_ids": [row["observation"]["id"] for row in group],
        })
    months = []
    for (site_id, parameter, month), group in sorted(calendar.items()):
        months.append({
            "site_id": site_id, "parameter": parameter, "local_month": month or None, **_counts(group),
            "activity_count": len({row["activity"]["id"] for row in group}),
            "distinct_local_dates": _times(group)["distinct_local_dates"],
            "observation_ids": [row["observation"]["id"] for row in group],
        })
    availability = []
    for field, getter, meaning in (
        ("laboratory_method", lambda row: row["observation"].get("method"), "Original result method string"),
        ("laboratory_method_context", lambda row: row["method_definition"]["method_context"], "Explicit native or source-bound method identifier context"),
        ("laboratory_method_name", lambda row: row["method_definition"]["method_name"], "Explicit native or source-bound full analytical method name"),
        ("collection_method_context", lambda row: row["method_definition"]["activity_method_context"], "Explicit native or source-bound collection method identifier context"),
        ("collection_method_name", lambda row: row["method_definition"]["activity_method_name"], "Explicit native or source-bound full collection method name"),
        ("collection_equipment", lambda row: row["method_definition"]["collection_equipment"], "Original declared sampling equipment; not a substitute for a collection method"),
        ("collection_method", lambda row: row["activity"].get("method"), "Original sample/measurement activity method"),
        ("chemical_basis", lambda row: row["observation"].get("basis"), "Declared basis; blank is not assumed equivalent to another basis"),
        ("fraction", lambda row: row["observation"].get("fraction"), "Declared result fraction"),
        ("qa_status", lambda row: row["observation"].get("qa_status"), "Original QA code; no code is reclassified as accepted or rejected"),
        ("qualifier", lambda row: row["observation"].get("qualifier"), "Original qualifier; blank can be a legitimate unqualified result"),
        ("collection_time", lambda row: row["activity"].get("collected_at"), "Actual original collection timestamp, separate from visit/planned dates"),
        ("custody_reference", lambda row: row["activity"].get("custody_ref"), "Original activity custody reference, if recorded"),
        ("coordinate_datum", lambda row: row["site"].get("coordinate_reference_system"), "Explicit native site datum/CRS, if recorded; original source record also retained"),
        ("laboratory_source_record", lambda row: row["observation"].get("lab_source", {}).get("record")
         if isinstance(row["observation"].get("lab_source"), dict) else None, "Original CSV data-record number, if this row came through laboratory intake"),
    ):
        values = [getter(row) for row in records]
        present = sum(bool(value.strip()) if isinstance(value, str) else value is not None for value in values)
        availability.append({"field": field, "recorded_rows": present,
                             "unstated_rows": len(records) - present, "total_rows": len(records), "meaning": meaning})
    method_inventory = _method_inventory(records)
    source_states = Counter(item.get("state", "unspecified") for item in attachment_inventory)
    summary = {
        **_counts(records), **_times(records),
        "site_count": len({row["site"]["id"] for row in records}),
        "sample_activities": sum(row["kind"] == "sample" for row in plan["activities"]),
        "sample_followup_rows": len(followup),
        "collected_samples_without_results": sum(row["state"] == "collected_no_result_records" for row in followup),
        "samples_with_only_missing_results": sum(row["state"] == "only_missing_result_records" for row in followup),
        "sample_collection_time_unrecorded_without_results": sum(row["state"] == "collection_time_unrecorded_no_results" for row in followup),
        "comparison_strata": len(strata),
        "method_definitions": len(method_inventory),
        "rows_with_method_context": sum(bool(row["method_definition"]["method_context"]) for row in records),
        "rows_with_method_name": sum(bool(row["method_definition"]["method_name"]) for row in records),
        "rows_with_collection_equipment": sum(bool(row["method_definition"]["collection_equipment"]) for row in records),
        "rows_with_collection_source_differences": sum(bool(row["method_definition"]["original_collection_conflicts"]) for row in records),
        "site_parameter_groups_with_definition_variants": sum(row["strata_count"] > 1 for row in definitions),
        "declared_campaigns": len(campaigns),
        "declared_site_parameter_pairs": sum(row["declared_site_parameter_pairs"] for row in campaign_summaries),
        "declared_pairs_with_nonmissing_results": sum(row["pairs_with_nonmissing_result"] for row in campaign_summaries),
        "rows_without_explicit_campaign": sum(not row["visit"].get("monitoring_plan_id") for row in records),
        "rows_on_cancelled_visits": sum(row["visit"]["status"] == "cancelled" for row in records),
        "source_labelled_limit_rows": sum(row["limit_origin"] == "original_WQP_labelled_fields" for row in source_limits),
        "retained_source_states": dict(sorted(source_states.items())),
    }
    return {
        "schema": SCHEMA, "edition": EDITION,
        "plan": {"id": plan["id"], "revision": plan["revision"], "sha256": document_digest(plan), "title": plan["title"]},
        "summary": summary, "comparison_strata": strata, "definition_variants": definitions,
        "campaigns": campaign_summaries, "campaign_coverage": coverage,
        "sample_followup": followup, "sampling_calendar": months, "source_limits": source_limits,
        "metadata_availability": availability, "method_inventory": method_inventory,
        "interpretation": {
            "comparison": "Strata match exact site, parameter, unit, basis, fraction, laboratory method and its declared context/name, activity method and its declared context/name, QA and qualifier strings. Matching labels describe recorded definitions, not demonstrated laboratory equivalence.",
            "methods": "Original analytical method identifiers, their naming contexts and full names remain together. A source context/name attaches to the selected native method only when it matches the original identifier/name, or the native record explicitly declares it. Collection method and equipment metadata retain their original activity/result-row origins; conflicting original declarations remain in the complete inventory. Canonical field records, Outcomes and QC rules are unchanged.",
            "numeric_range": "Minimum/maximum use only original numeric records in the exact stratum. Censored, text and missing results are counted separately and never substituted into numeric ranges.",
            "campaign": "Declared site/parameter combinations are crossed exactly within each saved monitoring plan. Result records join only through visits explicitly linked to that campaign. Counts describe retained records; frequency text is not converted into an expected sampling schedule or a per-visit requirement.",
            "calendar": "Months and distinct dates use the original collection timestamp's local calendar. First/last timestamps are ordered by actual instant. A date span is not continuous monitoring coverage.",
            "metadata": "Unstated metadata are counted descriptively. No automatic QA acceptance, completeness score, compliance threshold or source-unit conversion is assigned.",
            "limits": "Explicit native detection/quantitation limits and original WQP labelled limit fields remain separate rows. Source-labelled reporting limits retain their original type/value/unit; no relabelling or censor substitution is performed.",
        },
    }


def write_quality_sources(root, quality):
    """Retain complete machine-readable summaries inside the original source."""
    root = Path(root)
    names = ["quality/summary.json"]
    atomic_json(root / names[0], quality, immutable=True)
    for filename, (key, fields) in TABLES.items():
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows({field: _text(row.get(field)) for field in fields} for row in quality[key])
        name = "quality/" + filename
        atomic_bytes(root / name, output.getvalue().encode("utf-8"), immutable=True)
        names.append(name)
    return names


def _table(columns, rows):
    return {"kind": "table", "columns": columns, "rows": [[_text(value) for value in row] for row in rows]}


def quality_sections(quality, *, prefix="field/quality/"):
    """Render useful native report sections; complete companion tables retain all rows."""
    summary = quality["summary"]
    strata = quality["comparison_strata"]
    campaigns = quality["campaigns"]
    limits = quality["source_limits"]
    links = [{"title": "Complete measurement support, campaign coverage and original row identities", "path": prefix + "summary.json"}]
    links += [{"title": filename.replace("-", " ").removesuffix(".csv"), "path": prefix + filename}
              for filename in TABLES]
    return [
        ["Original measurement definitions and numeric support", [
            quality["interpretation"]["comparison"], quality["interpretation"]["numeric_range"],
            _table(["Site", "Parameter", "Unit / basis / fraction", "Methods", "Original QA / qualifier",
                    "Result counts / numeric range"],
                   [[row["site_id"], row["parameter"],
                     "\n".join(label + ": " + _text(row[key]) for key, label in
                               (("unit", "Unit"), ("basis", "Basis"), ("fraction", "Fraction"))),
                     "Laboratory\n" + _method_label(row["method"], row["method_context"], row["method_name"]) +
                     "\nCollection\n" + _method_label(row["activity_method"], row["activity_method_context"], row["activity_method_name"]),
                     "QA: " + _text(row["qa_status"]) + "\nQualifier: " + _text(row["qualifier"]),
                     "\n".join(label + ": " + _text(row[key]) for key, label in
                               (("numeric", "Numeric"), ("censored", "Censored"), ("text", "Text"),
                                ("missing", "Missing"), ("numeric_min", "Minimum"), ("numeric_max", "Maximum")))]
                    for row in strata[:100]]),
            str(len(strata)) + " exact metadata strata; the first " + str(min(100, len(strata))) +
            " are shown. The complete table retains every original observation ID.",
        ]],
        ["Original analytical and collection method definitions", [
            quality["interpretation"]["methods"],
            _table(["Parameter", "Recorded method", "Original analytical definition",
                    "Original collection / equipment", "Result counts", "Sites / source records"],
                   [[row["parameter"],
                     _method_label(row["method"], row["method_context"], "") +
                     "\nBinding: " + row["method_binding"],
                     _method_label(row["original_analytical_method"]["identifier"],
                                   row["original_analytical_method"]["context"],
                                   row["original_analytical_method"]["name"]),
                     _collection_label(row),
                     "\n".join(kind + ": " + str(row[kind]) for kind in TYPES),
                     ", ".join(row["site_ids"]) + "\nSources: " + ", ".join(row["source_link_ids"])]
                    for row in quality["method_inventory"][:100]]),
            str(len(quality["method_inventory"])) + " distinct retained method definitions; first " +
            str(min(100, len(quality["method_inventory"]))) +
            " shown. The complete method inventory retains descriptions, source differences and every original observation ID.",
        ]],
        ["Campaign coverage and sample follow-up", [
            quality["interpretation"]["campaign"],
            _table(["Campaign", "Declared site/parameter pairs", "Pairs with a nonmissing result",
                    "Pairs without a result record", "Linked visits"],
                   [[row["title"], row["declared_site_parameter_pairs"], row["pairs_with_nonmissing_result"],
                     row["pairs_without_result_records"], len(row["linked_visit_ids"])] for row in campaigns]),
            _table(["Source quantity", "Count"], [
                ["Original result rows without an explicitly linked campaign", summary["rows_without_explicit_campaign"]],
                ["Collected samples without result records", summary["collected_samples_without_results"]],
                ["Samples with only explicit missing-result records", summary["samples_with_only_missing_results"]],
                ["Sample records without a collection time or results", summary["sample_collection_time_unrecorded_without_results"]],
                ["Original result rows attached to cancelled visits", summary["rows_on_cancelled_visits"]],
            ]),
            _table(["Sample", "Site", "Visit status", "Collected at", "Source state"],
                   [[row[key] for key in ("sample_id", "site_id", "visit_status", "collected_at", "state")]
                    for row in quality["sample_followup"][:100]]),
            "Sample follow-up describes saved relationships. An absent timestamp does not establish whether collection occurred.",
        ]],
        ["Collection calendar and metadata availability", [
            quality["interpretation"]["calendar"], quality["interpretation"]["metadata"],
            _table(["Site", "Parameter", "Original local month", "Result counts",
                    "Sample/measurement activities", "Distinct local dates"],
                   [[row["site_id"], row["parameter"], row["local_month"],
                     "\n".join(label + ": " + _text(row[key]) for key, label in
                               (("numeric", "Numeric"), ("censored", "Censored"),
                                ("text", "Text"), ("missing", "Missing"))),
                     row["activity_count"], row["distinct_local_dates"]]
                    for row in quality["sampling_calendar"][:100]]),
            _table(["Original field", "Recorded rows", "Unstated rows", "Meaning"],
                   [[row[key] for key in ("field", "recorded_rows", "unstated_rows", "meaning")]
                    for row in quality["metadata_availability"]]),
            _table(["Original source availability state", "Source records"],
                   [[state, count] for state, count in sorted(summary["retained_source_states"].items())]),
            "Complete calendar and follow-up rows are retained in the linked source tables. Original source states describe the saved source inventory; the retained attachment inventory supplies each file identity.",
        ]],
        ["Original detection, quantitation and source-labelled limits", [
            quality["interpretation"]["limits"],
            _table(["Site / parameter", "Original result / type", "Limit origin", "Original limit type",
                    "Original limit value / unit", "Original record"],
                   [[_text(row.get("site_id")) + "\n" + _text(row.get("parameter")),
                     _text(row.get("result_type")) + "\n" + _text(row.get("original_result")) +
                     "\nUnit: " + _text(row.get("result_unit")),
                     row.get("limit_origin"), row.get("limit_type"),
                     _text(row.get("limit_value")) + "\nUnit: " + _text(row.get("limit_unit")),
                     _text(row.get("observation_id")) + "\nCSV record: " + _text(row.get("source_record"))]
                    for row in limits[:100]]),
            str(len(limits)) + " retained native or original labelled-limit rows; first " +
            str(min(100, len(limits))) + " shown.",
            {"kind": "links", "items": links},
        ]],
    ]
