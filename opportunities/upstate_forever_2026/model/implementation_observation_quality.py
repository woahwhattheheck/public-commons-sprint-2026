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
EDITION = "field-measurement-support-20261013-v1"
TYPES = ("numeric", "censored", "text", "missing")
DIMENSIONS = ("site_id", "parameter", "unit", "basis", "fraction", "method",
              "activity_method", "qa_status", "qualifier")
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
        "fractions", "methods", "activity_methods", "qa_codes", "qualifiers",
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
        dimensions = {
            "site_id": site["id"], "parameter": observation["parameter"],
            "unit": observation["unit"], "activity_method": activity.get("method") or "",
            **{key: observation.get(key) or "" for key in ("basis", "fraction", "method", "qa_status", "qualifier")},
        }
        record = {"observation": observation, "activity": activity, "visit": visit,
                  "site": site, "dimensions": dimensions, "original_pointer": _original_pointer(index)}
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
                ("methods", "method"), ("activity_methods", "activity_method"),
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
        "metadata_availability": availability,
        "interpretation": {
            "comparison": "Strata match exact site, parameter, unit, basis, fraction, laboratory method, activity method, QA and qualifier strings. Matching labels describe recorded definitions, not demonstrated laboratory equivalence.",
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
            _table(["Site", "Parameter", "Unit", "Basis", "Fraction", "Laboratory method", "Collection method",
                    "QA", "Qualifier", "Numeric", "Censored", "Text", "Missing", "Numeric minimum", "Numeric maximum"],
                   [[row[key] for key in DIMENSIONS] +
                    [row[key] for key in ("numeric", "censored", "text", "missing", "numeric_min", "numeric_max")]
                    for row in strata[:100]]),
            str(len(strata)) + " exact metadata strata; the first " + str(min(100, len(strata))) +
            " are shown. The complete table retains every original observation ID.",
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
            _table(["Site", "Parameter", "Original local month", "Numeric", "Censored", "Text", "Missing",
                    "Sample/measurement activities", "Distinct local dates"],
                   [[row[key] for key in ("site_id", "parameter", "local_month", "numeric", "censored", "text",
                                         "missing", "activity_count", "distinct_local_dates")]
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
            _table(["Observation", "Site", "Parameter", "Result type", "Original result", "Result unit",
                    "Limit origin", "Original limit type", "Original limit value", "Original limit unit", "CSV record"],
                   [[row.get(key) for key in ("observation_id", "site_id", "parameter", "result_type",
                    "original_result", "result_unit", "limit_origin", "limit_type", "limit_value",
                    "limit_unit", "source_record")] for row in limits[:100]]),
            str(len(limits)) + " retained native or original labelled-limit rows; first " +
            str(min(100, len(limits))) + " shown.",
            {"kind": "links", "items": links},
        ]],
    ]
