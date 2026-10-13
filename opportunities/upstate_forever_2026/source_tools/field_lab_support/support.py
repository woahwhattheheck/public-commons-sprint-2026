"""Source-bound analytical support for an existing FIELD12 laboratory delivery.

The original saved plan is read, never rewritten. All reporting-limit fields are
kept under their publisher's names rather than relabeled detection/quantitation.
"""
from __future__ import annotations

import base64
from collections import Counter, defaultdict
import csv
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
from typing import Any

SCHEMA = "upstate.field-lab-analytical-support/v1"
EDITION = "20261013.1"
MAX_BYTES = 64 * 1024 * 1024
LIMIT_TYPE = "DetectionQuantitationLimitTypeName"
LIMIT_VALUE = "DetectionQuantitationLimitMeasure/MeasureValue"
LIMIT_UNIT = "DetectionQuantitationLimitMeasure/MeasureUnitCode"
SOURCE_PATHS = {
    "results": "sources/three-lake-results-2023-original.csv",
    "activities": "sources/three-lake-activities-2023-original.csv",
    "stations": "sources/three-lake-stations-original.csv",
    "plan": "laboratory-report/plan.json",
}
NUMERIC_FIELDS = (
    "source_row", "result_text", "reported_limit_text", "native_value", "interval_lower", "interval_upper",
)
CSV_COLUMNS = (
    "observation_id", "activity_id", "sample_id", "station_id", "station_name", "date", "clock",
    "timezone", "collected_at", "parameter", "fraction", "basis", "result_type", "result_text",
    "result_unit", "display_unit", "unit_origin", "condition", "qualifier", "reported_limit_type",
    "reported_limit_text", "reported_limit_unit", "native_detection_limit", "native_quantitation_limit",
    "method_id", "method_authority", "method_name", "status", "support_kind", "interval_lower",
    "interval_upper", "lower_inclusive", "upper_inclusive", "support_note", "source_row", "source_sha256",
)


class SourceError(ValueError):
    """A supplied input does not match the retained original selection."""


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def description(raw: bytes) -> dict:
    return {"bytes": len(raw), "sha256": sha(raw)}


def decimal(value: Any, *, nonnegative: bool = False) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        answer = Decimal(str(value).strip())
    except InvalidOperation as error:
        raise SourceError("Non-numeric original value: " + repr(value)) from error
    if not answer.is_finite() or (nonnegative and answer < 0):
        raise SourceError("The original value must be finite" + (" and nonnegative" if nonnegative else ""))
    return answer


def decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def member(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or relative.as_posix() != name:
        raise SourceError("Expected an ordinary relative delivery member")
    path = root.joinpath(*relative.parts)
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise SourceError("Original member is unavailable: " + name)
    if path.stat().st_size > MAX_BYTES:
        raise SourceError("Original member exceeds the 64 MiB input limit: " + name)
    return path


def table(raw: bytes) -> tuple[list[str], list[dict[str, str]]]:
    csv.field_size_limit(max(csv.field_size_limit(), MAX_BYTES))
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    try:
        headers = next(reader)
    except StopIteration as error:
        raise SourceError("An original CSV has no header") from error
    if not headers or len(headers) != len(set(headers)) or any(not h for h in headers):
        raise SourceError("Original CSV headers must be nonempty and unique")
    records = []
    for cells in reader:
        if not cells:
            continue
        if len(cells) != len(headers):
            raise SourceError("Original CSV field count differs at physical line " + str(reader.line_num))
        records.append(dict(zip(headers, cells)))
    return headers, records


def bind(delivery: Path) -> tuple[dict, dict[str, bytes]]:
    """Receive the exact selected source files from a completed delivery."""
    manifest_raw = member(delivery, "delivery.json").read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest.get("schema") != "upstate.field-source-delivery/v1":
        raise SourceError("Select a completed upstate.field-source-delivery/v1 directory")
    originals = {}
    for label, name in SOURCE_PATHS.items():
        raw = member(delivery, name).read_bytes()
        expected = manifest.get("files", {}).get(name)
        if expected != description(raw):
            raise SourceError("The retained delivery identity differs for " + name)
        originals[label] = raw
    plan = json.loads(originals["plan"])
    plan_selection = manifest.get("binding", {}).get("plans", {}).get(plan.get("id"), {})
    if plan.get("revision") != plan_selection.get("revision"):
        raise SourceError("The selected original plan revision differs from the delivery")
    return {
        "project_id": manifest["binding"]["project_id"],
        "delivery_id": manifest["id"],
        "delivery_manifest": description(manifest_raw),
        "plan_id": plan["id"], "plan_revision": plan["revision"],
        "plan_document_digest": plan_selection.get("document_digest"),
        "plan_file": description(originals["plan"]),
        "original_report": manifest["binding"]["reports"]["laboratory"],
    }, originals


def support_interval(row: dict) -> dict:
    """Use only explicitly recognized original condition/limit combinations.

    Left-censored intervals assume nonnegative concentration. A bound is not a
    substituted measurement or a statistical confidence interval. Unknown or
    contradictory semantics stay unresolved, and are carried into every export.
    """
    answer = {"support_kind": "unresolved", "interval_lower": None, "interval_upper": None,
              "lower_inclusive": None, "upper_inclusive": None, "support_note": ""}
    if row["result_type"] == "numeric":
        raw_value = decimal(row["result_text"])
        native_value = decimal(row["native_value"])
        if raw_value is None or native_value != raw_value:
            raise SourceError("Original/native numeric mismatch for " + row["observation_id"])
        if row["condition"] not in ("Present Above Quantification Limit", ""):
            answer["support_note"] = "Original detection condition requires explicit interpretation; numeric text is retained."
            return answer
        answer.update(support_kind="reported numeric", interval_lower=decimal_text(raw_value),
                      interval_upper=decimal_text(raw_value), lower_inclusive=True, upper_inclusive=True,
                      support_note="Point support for the reported value; analytical measurement uncertainty is not supplied.")
        return answer
    if row["result_type"] != "censored":
        answer["support_note"] = "Original result is " + row["result_type"] + "; no concentration interval is inferred."
        return answer
    try:
        raw_value = decimal(row["result_text"])
    except SourceError:
        answer["support_note"] = "Original censored result text is nonnumeric; its publisher wording is retained."
        return answer
    if raw_value is not None:
        answer["support_note"] = "A censored original also supplies numeric text; keep both without choosing an interpretation."
        return answer
    if row["condition"] != "Below Reporting Limit" or row["reported_limit_type"] != "Lower Reporting Limit":
        answer["support_note"] = "This original condition and limit type are outside the explicit below-reporting-limit rule."
        return answer
    try:
        limit = decimal(row["reported_limit_text"], nonnegative=True)
    except SourceError:
        answer["support_note"] = "Original reporting limit is not a finite nonnegative number."
        return answer
    if limit is None or limit <= 0:
        answer["support_note"] = "No positive original reporting limit is available."
        return answer
    if not row["reported_limit_unit"] or row["reported_limit_unit"] != row["display_unit"]:
        answer["support_note"] = "Original limit and displayed concentration units do not match; no conversion is assumed."
        return answer
    answer.update(support_kind="below reporting limit", interval_lower="0", interval_upper=decimal_text(limit),
                  lower_inclusive=True, upper_inclusive=False,
                  support_note="0 <= concentration < original lower reporting limit, assuming nonnegative concentration.")
    return answer


def summarize(records: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    # Distinct methods, fractions, bases and activity types remain distinct groups.
    fields = ("station_id", "parameter", "display_unit", "fraction", "basis", "method_id", "method_authority", "method_name", "activity_type", "project")
    for row in records:
        groups[tuple(row[field] for field in fields)].append(row)
    result = []
    for key, members in sorted(groups.items()):
        record = dict(zip(fields, key))
        record.update(id="group-" + sha(canonical(key))[:20], count=len(members),
                      numeric_count=sum(r["result_type"] == "numeric" for r in members),
                      censored_count=sum(r["result_type"] == "censored" for r in members),
                      unresolved_count=sum(r["support_kind"] == "unresolved" for r in members),
                      first_date=min(r["date"] for r in members), last_date=max(r["date"] for r in members),
                      dates=sorted({r["date"] for r in members}),
                      reporting_limits=[list(x) for x in sorted({(r["reported_limit_type"], r["reported_limit_text"], r["reported_limit_unit"]) for r in members})],
                      observation_ids=[r["observation_id"] for r in members],
                      mean_lower=None, mean_upper=None, mean_lower_inclusive=None, mean_upper_inclusive=None,
                      sum_lower=None, sum_upper=None)
        if not record["unresolved_count"]:
            with localcontext() as context:
                context.prec = 40
                lower = sum((Decimal(r["interval_lower"]) for r in members), Decimal(0))
                upper = sum((Decimal(r["interval_upper"]) for r in members), Decimal(0))
                record.update(sum_lower=decimal_text(lower), sum_upper=decimal_text(upper),
                              mean_lower=decimal_text(lower / len(members)), mean_upper=decimal_text(upper / len(members)),
                              mean_lower_inclusive=all(r["lower_inclusive"] for r in members),
                              mean_upper_inclusive=all(r["upper_inclusive"] for r in members))
        result.append(record)
    return result


def build(delivery: Path) -> tuple[dict, dict[str, bytes]]:
    binding, originals = bind(delivery)
    plan = json.loads(originals["plan"])
    headers, results = table(originals["results"])
    activity_headers, activities = table(originals["activities"])
    station_headers, stations = table(originals["stations"])
    station_lookup = {r["MonitoringLocationIdentifier"]: r for r in stations}
    if len(station_lookup) != len(stations):
        raise SourceError("Original station identifiers are not unique")
    activity_lookup = defaultdict(list)
    for index, activity in enumerate(activities, 1):
        activity_lookup[activity["ActivityIdentifier"]].append({"source_row": index, "original": activity})
    native_activities = {a["id"]: a for a in plan["activities"]}
    source_sha = sha(originals["results"])
    records, used_rows, ids = [], set(), set()
    for observation in plan["observations"]:
        source = observation.get("lab_source", {})
        index = source.get("record")
        if source.get("csv_sha256") != source_sha or type(index) is not int or index < 1 or index > len(results):
            raise SourceError("Observation source does not bind to the supplied original CSV: " + observation["id"])
        original = results[index - 1]
        if source.get("original_row") != original or source.get("original_headers") != headers:
            raise SourceError("Retained original row/header mismatch: " + observation["id"])
        if observation["id"] in ids:
            raise SourceError("Native observation IDs must be unique")
        ids.add(observation["id"])
        used_rows.add(index)
        activity = native_activities.get(observation["activity_id"])
        if not activity or activity.get("sample_id") != original["ActivityIdentifier"]:
            raise SourceError("Native sample binding differs from the original row")
        if activity.get("site_id") != original["MonitoringLocationIdentifier"]:
            raise SourceError("Native station binding differs from the original row")
        activity_matches = activity_lookup.get(original["ActivityIdentifier"], [])
        if not activity_matches:
            raise SourceError("Original activity is absent from the retained activity CSV")
        station = station_lookup.get(original["MonitoringLocationIdentifier"])
        if not station:
            raise SourceError("Original station is absent from the retained station CSV")
        for matched in activity_matches:
            for field in ("MonitoringLocationIdentifier", "ActivityStartDate", "ActivityStartTime/Time", "ActivityStartTime/TimeZoneCode"):
                if matched["original"][field] != original[field]:
                    raise SourceError("Original result/activity metadata disagree for " + field)
        original_unit = original["ResultMeasure/MeasureUnitCode"]
        limit_unit = original[LIMIT_UNIT]
        shown_unit = original_unit or (limit_unit if observation["result_type"] == "censored" else "")
        if observation.get("parameter") != original["CharacteristicName"] or observation.get("unit", "") != shown_unit:
            raise SourceError("Native parameter/unit binding differs from the original source")
        row = {
            "observation_id": observation["id"], "activity_id": observation["activity_id"],
            "sample_id": original["ActivityIdentifier"], "station_id": original["MonitoringLocationIdentifier"],
            "station_name": station.get("MonitoringLocationName", ""),
            "date": original["ActivityStartDate"], "clock": original["ActivityStartTime/Time"],
            "timezone": original["ActivityStartTime/TimeZoneCode"], "collected_at": activity.get("collected_at", ""),
            "activity_type": original["ActivityTypeCode"], "project": original["ProjectIdentifier"],
            "parameter": original["CharacteristicName"], "fraction": original["ResultSampleFractionText"],
            "basis": original["ResultWeightBasisText"], "result_type": observation["result_type"],
            "result_text": original["ResultMeasureValue"], "native_value": observation.get("value"),
            "native_original_text": observation.get("original_text", ""), "result_unit": original_unit,
            "display_unit": shown_unit, "unit_origin": "original result" if original_unit else ("original limit" if shown_unit else "unavailable"),
            "condition": original["ResultDetectionConditionText"], "qualifier": original["MeasureQualifierCode"],
            "reported_limit_type": original[LIMIT_TYPE], "reported_limit_text": original[LIMIT_VALUE], "reported_limit_unit": limit_unit,
            "native_detection_limit": observation.get("detection_limit"), "native_quantitation_limit": observation.get("quantitation_limit"),
            "method_id": original["ResultAnalyticalMethod/MethodIdentifier"],
            "method_authority": original["ResultAnalyticalMethod/MethodIdentifierContext"],
            "method_name": original["ResultAnalyticalMethod/MethodName"], "status": original["ResultStatusIdentifier"],
            "source_row": index, "source_sha256": source_sha, "source_link_id": source["source_link_id"],
            "original": original, "original_activities": activity_matches,
        }
        row.update(support_interval(row))
        records.append(row)
    records.sort(key=lambda r: (r["date"], r["clock"], r["station_id"], r["parameter"], r["source_row"]))
    event_groups = defaultdict(list)
    for row in records:
        event_groups[(row["station_id"], row["date"], row["clock"], row["timezone"])].append(row)
    events = [{"station_id": key[0], "date": key[1], "clock": key[2], "timezone": key[3],
               "observation_ids": [r["observation_id"] for r in members],
               "activity_ids": sorted({r["sample_id"] for r in members}),
               "parameters": sorted({r["parameter"] for r in members}),
               "source_rows": [r["source_row"] for r in members]}
              for key, members in sorted(event_groups.items(), key=lambda item: (item[0][1], item[0][2], item[0][0]))]
    identity = {"schema": SCHEMA, "edition": EDITION, "binding": binding,
                "sources": {label: description(raw) for label, raw in sorted(originals.items())}}
    data = {
        **identity, "dataset_id": sha(canonical(identity)), "title": "Eighteenmile laboratory analytical support",
        "headers": headers, "activity_headers": activity_headers, "station_headers": station_headers,
        "stations": stations, "records": records, "groups": summarize(records), "events": events,
        "counts": {"results": len(records), "original_result_rows": len(results), "original_activity_rows": len(activities),
                   "stations": len(stations), "events": len(events), "numeric": sum(r["result_type"] == "numeric" for r in records),
                   "censored": sum(r["result_type"] == "censored" for r in records),
                   "unresolved": sum(r["support_kind"] == "unresolved" for r in records),
                   "single_analyte_events": sum(len(e["parameters"]) == 1 for e in events),
                   "source_rows_not_in_plan": len(results) - len(used_rows)},
        "methods": {
            "interval_rule": "Recognized Below Reporting Limit + Lower Reporting Limit rows use [0, limit), conditional on nonnegative concentration and matching units. Original numeric results use point support for the reported value.",
            "means": "Within each exact station/parameter/unit/fraction/basis/method/activity-type/project group, sum the lower and upper support endpoints and divide by the record count. Any unresolved record prevents a full-group mean bound. These descriptive support bounds are not confidence intervals or substitution estimates.",
            "grouping": "Method authority, identifier and name, original activity type and project are part of each group. Methods are not pooled. Dates and displayed clocks remain the publisher's originals; a shared event is a station/date/clock/timezone tuple, not a claim that separate sample IDs are one bottle.",
            "precision": "CSV/JSON sums are exact decimal arithmetic; mean endpoints use 40 significant decimal digits. Displayed values are rounded separately.",
            "scope": "The selected native plan and all three original CSV files are retained unchanged. Reported lower limits remain reporting limits; native detection_limit and quantitation_limit fields are not filled from them.",
            "references": [
                {"title": "EPA WQX Detection Limits Best Practices Guide", "url": "https://www.epa.gov/waterdata/wqx-detection-limits-best-practices-guide"},
                {"title": "EPA TADA Module 1: censored-data classification", "url": "https://usepa.github.io/EPATADA/articles/TADAModule1.html"},
                {"title": "Original WQP observations", "url": "https://www.waterqualitydata.us/"},
            ],
        },
        "original_files": {label: {"filename": Path(SOURCE_PATHS[label]).name, **description(raw),
                                   "base64": base64.b64encode(raw).decode("ascii")}
                           for label, raw in originals.items()},
    }
    return data, originals


def export_csv(records: list[dict]) -> bytes:
    """Derived columns and every original WQP column, in original source order."""
    raw_headers = list(records[0]["original"]) if records else []
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow([*CSV_COLUMNS, *("original." + key for key in raw_headers)])
    for row in records:
        writer.writerow([*(row.get(key) if row.get(key) is not None else "" for key in CSV_COLUMNS),
                         *(row["original"].get(key, "") for key in raw_headers)])
    return output.getvalue().encode("utf-8")
