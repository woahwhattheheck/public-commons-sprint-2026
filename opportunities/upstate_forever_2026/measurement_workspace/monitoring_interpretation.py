"""Source-bound monitoring interpretation in the existing Published studies store.

Original observation strings remain authoritative. Comparisons preserve censoring
and analytical cohorts; they do not issue an advisory or regulatory determination.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
import csv
import hashlib
import html
import io
import json
from pathlib import Path
import re
import tempfile
import zipfile

from model.common import held
from .published_studies import _atomic, _json_bytes, _name
from .study_reviews import _binding, PublishedStudyReviews
from .source_observations import statistical_rows

SCHEMA = "upstate.monitoring-interpretation/v1"
PREVIEW = "upstate.monitoring-interpretation-preview/v1"
BUNDLE = "upstate.monitoring-interpretation-export/v1"
ENGINE = "monitoring-interpretation/1"
SOURCE_ROOT = "source/monitoring_interpretation_20261013"
MAX_BYTES = 256 * 1024 * 1024
COHORT_FIELDS = ("site_id", "parameter_original", "support_unit", "method_authority",
                 "method_id", "sample_fraction", "result_value_type", "result_weight_basis",
                 "result_time_basis", "result_temperature_basis", "result_particle_size_basis",
                 "source_depth_token", "depth_unit", "project_id", "series_key")

def _hash(raw):
    return hashlib.sha256(raw).hexdigest()

def _text(value, label, maximum=12000, required=False):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        raise ValueError(label + " must be bounded text.")
    value = value.strip()
    if required and not value:
        raise ValueError("Enter " + label + ".")
    return value

def _decimal(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("Boolean values are not measured quantities.")
    text = str(value).strip()
    if len(text) > 120 or not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", text):
        raise ValueError("Unsupported decimal quantity: " + text[:80])
    result = Decimal(text)
    if not result.is_finite() or abs(result.adjusted()) > 1000:
        raise ValueError("Measured quantities must be finite and within supported scale.")
    return result

def _value(number):
    if number is None:
        return None
    if number == 0:
        return "0"
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text

def _day(value, label):
    value = _text(value, label, 10, True)
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError(label + " must be an ISO calendar date.")
    return parsed

def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"interpretation-[0-9a-f]{64}", value):
        raise ValueError("Choose an original saved interpretation.")
    return value

def load_catalog(application=None):
    root = Path(application or Path(__file__).resolve().parent.parent) / SOURCE_ROOT
    path = root / "profiles.json"
    raw = path.read_bytes()
    catalog = json.loads(raw)
    if catalog.get("schema") != "tjl.monitoring-interpretation-profiles.v1":
        raise ValueError("The installed monitoring profile catalog is incompatible.")
    profiles = catalog.get("profiles")
    if not isinstance(profiles, list) or not profiles or len(profiles) > 200:
        raise ValueError("The installed profile catalog must contain its complete profiles.")
    ids = [p.get("id") for p in profiles]
    if len(ids) != len(set(ids)) or any(not isinstance(i, str) or not i for i in ids):
        raise ValueError("Monitoring profile identities must be unique.")
    files = {}
    for source in sorted(root.rglob("*")):
        if source.is_file():
            name = source.relative_to(root).as_posix()
            if "__pycache__" in source.parts or name.startswith("."):
                continue
            data = source.read_bytes()
            if len(data) > 32 * 1024 * 1024:
                raise ValueError("An installed profile source is too large.")
            files[name] = data
    if sum(map(len, files.values())) > 64 * 1024 * 1024:
        raise ValueError("The complete profile source catalog exceeds 64 MiB.")
    return catalog, files

def _normal_request(payload, complete):
    if not isinstance(payload, dict):
        raise ValueError("The interpretation request must be an object.")
    if payload.get("study_id") != complete["record"]["study_id"] or payload.get("version_id") != complete["record"]["version_id"]:
        raise ValueError("Choose the exact retained study edition.")
    selection = PublishedStudyReviews._filters(payload.get("selection", {}))
    known = {row["site_id"] for row in complete["available_stations"]}
    if set(selection["site_ids"]) - known:
        raise ValueError("The interpretation selects an unknown retained station.")
    period = payload.get("period") or {}
    if not isinstance(period, dict) or set(period) - {"start", "end"}:
        raise ValueError("Use the original period start and end.")
    dates = [r["date"] for r in complete.get("observation_rows", [])]
    if not dates:
        raise ValueError("This study edition has no original dated observation rows.")
    start = _day(period.get("start") or min(dates), "Period start")
    end = _day(period.get("end") or max(dates), "Period end")
    if start > end:
        raise ValueError("Period end precedes its start.")
    applicability = payload.get("applicability") or {}
    if not isinstance(applicability, dict):
        raise ValueError("Applicability must be an explicit analyst selection.")
    app = {key: _text(applicability.get(key, ""), key, 12000 if key.endswith("note") else 240)
           for key in ("jurisdiction", "water_use", "reviewer", "note", "method_note")}
    if not isinstance(applicability.get("confirmed", False), bool):
        raise ValueError("Applicability confirmation must be true or false.")
    app["confirmed"] = applicability.get("confirmed", False)
    confirmations = applicability.get("confirmations", {})
    if not isinstance(confirmations, dict) or any(not isinstance(k, str) or not isinstance(v, bool) for k, v in confirmations.items()):
        raise ValueError("Profile confirmations must retain named true/false choices.")
    app["confirmations"] = confirmations
    options = payload.get("options") or {}
    if not isinstance(options, dict) or set(options) - {"include_qualified", "qualified_note"}:
        raise ValueError("Unsupported monitoring interpretation options.")
    include = options.get("include_qualified", False)
    if not isinstance(include, bool):
        raise ValueError("Qualified-record inclusion must be explicit.")
    note = _text(options.get("qualified_note", ""), "Qualified-record rationale")
    if include and not note:
        raise ValueError("Explain the selected qualified-record inclusion.")
    return {"study_id": payload["study_id"], "version_id": payload["version_id"],
            "selection": selection, "profile_id": _text(payload.get("profile_id"), "profile", 160, True),
            "period": {"start": start.isoformat(), "end": end.isoformat()}, "applicability": app,
            "options": {"include_qualified": include, "qualified_note": note}}

def _unit(profile, unit):
    accepted = profile.get("units", {}).get("accepted", [])
    for item in accepted:
        if isinstance(item, str):
            item = {"unit": item, "factor": "1"}
        if item.get("unit") == unit:
            factor = _decimal(item.get("factor", "1"))
            if factor is None or factor <= 0:
                raise ValueError("Profile unit factors must be positive.")
            # Numeric unit scaling never changes a colony assay into an MPN assay.
            if (("MPN" in unit.upper()) != ("MPN" in str(item.get("target", unit)).upper())):
                raise ValueError("CFU/MPN conversions are not supported.")
            return factor
    return None

def _interval(row, profile):
    raw = row.get("raw_cells", {})
    original_condition = str(row.get("detection_condition", "")).strip()
    condition = re.sub(r"([a-z])([A-Z])", r"\1 \2", original_condition)
    condition = re.sub(r"[_-]+", " ", condition)
    direction = row.get("censor_direction", "")
    if re.search(r"not reported|not analyzed|not sampled", condition, re.I):
        return None, None, False, False, ["VALUE_NOT_REPORTED"]
    if not direction:
        if re.search(r"below|not detected|less than", condition, re.I):
            direction = "below"
        elif re.search(r"above.*quantification|above.*limit|greater than", condition, re.I):
            direction = "above"
    token = str(row.get("source_value_token", raw.get("ResultMeasureValue", ""))).strip()
    comparator = re.fullmatch(r"(<=|>=|<|>)\s*(.+)", token)
    if comparator and not direction:
        direction = "below" if comparator[1].startswith("<") else "above"
    unit = row.get("unit") or (row.get("detection_limit_unit", "") if direction else "")
    factor = _unit(profile, unit)
    if factor is None:
        return None, None, False, False, ["UNIT_NOT_SELECTED"]
    limit_token = raw.get("DetectionQuantitationLimitMeasure/MeasureValue",
                         raw.get("detection_limit", row.get("detection_limit")))
    if direction:
        try:
            limit = _decimal(limit_token)
            source_bound = _decimal(comparator[2]) if comparator else None
            quantified = _decimal(token) if token and not comparator else None
        except ValueError:
            return None, None, False, False, ["NONNUMERIC_OR_UNSUPPORTED_CENSOR_TOKEN"]
        if limit is None:
            return None, None, False, False, ["CENSOR_LIMIT_MISSING"]
        if limit < 0 or (quantified is not None and quantified < 0):
            return None, None, False, False, ["NEGATIVE_MEASUREMENT"]
        if comparator and (source_bound != limit or
                (comparator[1].startswith("<") != (direction == "below"))):
            return None, None, False, False, ["CENSOR_TOKEN_AND_BOUND_DISAGREE"]
        bound_unit = row.get("detection_limit_unit", "")
        bound_factor = _unit(profile, bound_unit)
        if bound_factor is None or (("MPN" in bound_unit.upper()) != ("MPN" in unit.upper())):
            return None, None, False, False, ["CENSOR_LIMIT_UNIT_INCOMPATIBLE"]
        kind = str(row.get("detection_limit_type", raw.get("DetectionQuantitationLimitTypeName", "")))
        if direction == "above" and not re.search(r"upper|quantitation", kind, re.I):
            return None, None, False, False, ["UPPER_CENSOR_BOUND_UNSUPPORTED"]
        if direction == "below" and re.search(r"upper", kind, re.I):
            return None, None, False, False, ["LOWER_CENSOR_BOUND_UNSUPPORTED"]
        bound = limit if bound_factor == 1 else limit * bound_factor
        strict = comparator[1] in ("<", ">") if comparator else True
        return ((Decimal(0), bound, False, strict, []) if direction == "below"
                else (bound, None, strict, False, []))
    if condition:
        return None, None, False, False, ["DETECTION_CONDITION_REQUIRES_REVIEW"]
    try:
        value = _decimal(token)
    except ValueError:
        return None, None, False, False, ["NONNUMERIC_OR_UNSUPPORTED_VALUE"]
    if value is None:
        return None, None, False, False, ["VALUE_MISSING"]
    if value < 0:
        return None, None, False, False, ["NEGATIVE_MEASUREMENT"]
    value = value if factor == 1 else value * factor
    return value, value, False, False, []

def _compare(lower, upper, threshold, lower_open=False):
    if lower is not None and (lower > threshold or lower == threshold and lower_open):
        return "ABOVE_THRESHOLD"
    if upper is not None and upper <= threshold:
        return "AT_OR_BELOW_THRESHOLD"
    return "INDETERMINATE"

def _clock(row):
    clock = str(row.get("local_time", "")).strip()
    zone = str(row.get("source_timezone", "")).strip().upper()
    if not clock:
        return None
    offsets = {"UTC": 0, "GMT": 0, "EST": -5, "EDT": -4, "CST": -6, "CDT": -5}
    if zone not in offsets:
        return None
    try:
        return datetime.fromisoformat(row["date"] + "T" + clock).replace(
            tzinfo=timezone(timedelta(hours=offsets[zone]))).astimezone(timezone.utc)
    except ValueError:
        return None

def _aggregate(rows, metric):
    aggregation = metric["aggregation"]
    lows = [_decimal(r["lower"]) for r in rows]
    highs = [_decimal(r["upper"]) for r in rows]
    if not rows:
        return None, None
    if aggregation == "exceedance_fraction":
        threshold = _decimal(metric["threshold"])
        definite = sum(_compare(lo, hi, threshold, r["lower_open"]) == "ABOVE_THRESHOLD"
                       for r, lo, hi in zip(rows, lows, highs))
        possible = sum(not (hi is not None and hi <= threshold) for hi in highs)
        return Decimal(definite) / len(rows), Decimal(possible) / len(rows)
    if aggregation == "geometric_mean":
        def geometric(values):
            if any(v is None for v in values):
                return None
            if any(v == 0 for v in values):
                return Decimal(0)
            with localcontext() as ctx:
                ctx.prec = 40
                return (sum(v.ln() for v in values) / len(values)).exp()
        return geometric(lows), geometric(highs)
    if aggregation == "seasonal_arithmetic_mean":
        return (sum(lows) / len(rows) if all(v is not None for v in lows) else None,
                sum(highs) / len(rows) if all(v is not None for v in highs) else None)
    if aggregation == "single_sample":
        return lows[0], highs[0]
    raise ValueError("Unsupported profile aggregation: " + str(aggregation))

def _metric_comparison(rows, metric, lower, upper, limit):
    if not rows:
        return "INDETERMINATE"
    if metric["aggregation"] == "geometric_mean":
        target = Fraction(_decimal(metric["threshold"])) ** len(rows)
        def product(field):
            result = Fraction(1)
            for row in rows:
                value = _decimal(row[field])
                if value is None:
                    return None
                result *= Fraction(value)
            return result
        low, high = product("lower"), product("upper")
        strict = any(row["lower_open"] for row in rows) and all(
            _decimal(row["lower"]) is not None and _decimal(row["lower"]) > 0 for row in rows)
        if low is not None and (low > target or low == target and strict):
            return "ABOVE_THRESHOLD"
        if high is not None and high <= target:
            return "AT_OR_BELOW_THRESHOLD"
        return "INDETERMINATE"
    if metric["aggregation"] == "seasonal_arithmetic_mean":
        target = Fraction(limit) * len(rows)
        lows = [_decimal(r["lower"]) for r in rows]
        highs = [_decimal(r["upper"]) for r in rows]
        low = sum((Fraction(v) for v in lows), Fraction(0)) if all(v is not None for v in lows) else None
        high = sum((Fraction(v) for v in highs), Fraction(0)) if all(v is not None for v in highs) else None
        if low is not None and (low > target or low == target and any(r["lower_open"] for r in rows)):
            return "ABOVE_THRESHOLD"
        if high is not None and high <= target:
            return "AT_OR_BELOW_THRESHOLD"
        return "INDETERMINATE"
    if metric["aggregation"] == "exceedance_fraction":
        threshold = _decimal(metric["threshold"])
        definite = sum(_compare(_decimal(r["lower"]), _decimal(r["upper"]),
                                threshold, r["lower_open"]) == "ABOVE_THRESHOLD" for r in rows)
        possible = sum(not (r["upper"] is not None and _decimal(r["upper"]) <= threshold) for r in rows)
        target = Fraction(limit) * len(rows)
        if definite > target:
            return "ABOVE_THRESHOLD"
        if possible <= target:
            return "AT_OR_BELOW_THRESHOLD"
        return "INDETERMINATE"
    return _compare(lower, upper, limit,
                    metric["aggregation"] == "single_sample" and rows[0]["lower_open"])

def _source_support(original):
    row = dict(original)
    raw = row.get("raw_cells", {})
    fields = {
        "project_id": "ProjectIdentifier", "method_authority": "ResultAnalyticalMethod/MethodIdentifierContext",
        "method_id": "ResultAnalyticalMethod/MethodIdentifier",
        "sample_fraction": "ResultSampleFractionText", "source_depth_token": "ActivityDepthHeightMeasure/MeasureValue",
        "depth_unit": "ActivityDepthHeightMeasure/MeasureUnitCode",
        "activity_type": "ActivityTypeCode", "local_time": "ActivityStartTime/Time",
        "source_timezone": "ActivityStartTime/TimeZoneCode",
        "result_value_type": "ResultValueTypeName", "result_weight_basis": "ResultWeightBasisText",
        "result_time_basis": "ResultTimeBasisText", "result_temperature_basis": "ResultTemperatureBasisText",
        "result_particle_size_basis": "ResultParticleSizeBasisText",
    }
    recovered, mismatches = {}, []
    for target, source in fields.items():
        if source not in raw or raw[source] == "":
            continue
        if row.get(target) in (None, ""):
            recovered[target] = {"previous": row.get(target), "source_column": source, "value": raw[source]}
            row[target] = raw[source]
        elif str(row[target]) != str(raw[source]):
            mismatches.append({"field": target, "normalized": row[target], "source_column": source, "original": raw[source]})
    row["recovered_original_support"] = recovered
    row["source_support_mismatches"] = mismatches
    row["laboratory_comment"] = raw.get("ResultLaboratoryCommentText", row.get("laboratory_comment", ""))
    row["result_comment"] = raw.get("ResultCommentText", row.get("result_comment", ""))
    row["activity_comment"] = raw.get("ActivityCommentText", row.get("activity_comment", ""))
    return row

def calculate(complete, request, profile):
    selection = request["selection"]
    aliases = set(profile["parameter"].get("aliases", [])) | {profile["parameter"]["canonical"]}
    records, grouped = [], defaultdict(list)
    source_rows = [_source_support(r) for r in complete.get("observation_rows", [])]
    canonical = statistical_rows(source_rows, complete["study"], include_excluded=True)
    canonical_by_id = {}
    for measurement in canonical:
        originals = measurement.get("measurement_original_records") or [{"record_id": measurement["record_id"]}]
        for original in originals:
            canonical_by_id[original["record_id"]] = measurement
    required_uses = profile.get("applicability", {}).get("designatedUses", [])
    jurisdiction = str(profile.get("authority", {}).get("jurisdiction", ""))
    app = request["applicability"]
    warnings = []
    if not app["confirmed"] or not app["reviewer"] or not app["note"]:
        warnings.append("APPLICABILITY_NOT_CONFIRMED")
    if required_uses and app["water_use"] not in required_uses:
        warnings.append("DESIGNATED_USE_NOT_SELECTED")
    if jurisdiction and jurisdiction not in ("US", "United States", "Federal", "EPA") and app["jurisdiction"] != jurisdiction:
        warnings.append("JURISDICTION_NOT_SELECTED")
    if (profile.get("units", {}).get("methodReviewRequired") or profile.get("method", {}).get("reviewRequired") or any(isinstance(u, dict) and u.get("methodReviewRequired") for u in profile.get("units", {}).get("accepted", []))) and not app["method_note"]:
        warnings.append("METHOD_APPLICABILITY_NOT_REVIEWED")
    for confirmation in profile.get("applicability", {}).get("requiredConfirmations", []):
        key = confirmation.get("id") if isinstance(confirmation, dict) else confirmation
        if not app.get("confirmations", {}).get(key):
            warnings.append("CONFIRMATION_REQUIRED:" + str(key))
    metrics = profile.get("metrics", [])
    for metric in metrics:
        if metric.get("operator", "gt") != "gt" or _decimal(metric.get("threshold")) is None:
            raise ValueError("The profile metric must define its explicit greater-than threshold.")
        minimum = metric.get("minSamples", 1)
        if type(minimum) is not int or not 1 <= minimum <= 10000:
            raise ValueError("The profile sample minimum must be a positive integer.")
        months = metric.get("seasonMonths") or profile.get("applicability", {}).get("seasonMonths") or []
        if any(type(m) is not int or not 1 <= m <= 12 for m in months):
            raise ValueError("Profile seasons require original calendar months.")
        if metric.get("aggregation") == "exceedance_fraction":
            fraction = _decimal(metric.get("allowedExcursionFraction"))
            if fraction is None or not 0 <= fraction <= 1:
                raise ValueError("The permitted excursion fraction must be between zero and one.")
    for source in source_rows:
        row = dict(source)
        measurement = canonical_by_id[row["record_id"]]
        canonical_first = measurement["record_id"] == row["record_id"]
        stamp = _day(row["date"], "Observation date")
        selected = (request["period"]["start"] <= row["date"] <= request["period"]["end"]
                    and (not selection["site_ids"] or row["site_id"] in selection["site_ids"])
                    and (not selection["parameters"] or row["parameter"] in selection["parameters"] or row.get("parameter_original") in selection["parameters"])
                    and (not selection["strata"] or ("surface" in selection["strata"] and complete["study"].get("observation_calendar_filters") is not True))
                    and (selection["year"] is None or stamp.year == selection["year"])
                    and (not selection["months"] or stamp.month in selection["months"]))
        reasons = []
        if not selected:
            reasons.append("OUTSIDE_SELECTED_PERIOD_OR_COHORT")
        if row.get("parameter_original", row.get("parameter")) not in aliases and row.get("parameter") not in aliases:
            reasons.append("PARAMETER_NOT_SELECTED")
        activity_type = str(row.get("activity_type", row.get("raw_cells", {}).get("ActivityTypeCode", "")))
        if activity_type != "Sample-Routine":
            reasons.append("NON_ROUTINE_OR_REPLICATE_ACTIVITY")
        if measurement.get("statistical_exclusions") or measurement.get("statistical_exclusion"):
            reasons.append("ORIGINAL_STATISTICAL_EXCLUSION")
        if not canonical_first:
            reasons.append("CANONICAL_ACTIVITY_DUPLICATE")
        if row["source_support_mismatches"]:
            reasons.append("NORMALIZED_SOURCE_SUPPORT_MISMATCH")
        if re.search(r"holding\s+time\s+exceeded", row["laboratory_comment"], re.I) and not request["options"]["include_qualified"]:
            reasons.append("LABORATORY_HOLDING_TIME_EXCEEDED")
        qualifiers = row.get("qualifier") or row.get("raw_cells", {}).get("MeasureQualifierCode", "")
        if qualifiers and not request["options"]["include_qualified"]:
            reasons.append("QUALIFIED_RECORD_NOT_INCLUDED")
        lower, upper, lower_open, upper_open, interval_reasons = _interval(row, profile)
        reasons.extend(interval_reasons)
        identity = [row.get(key, "") for key in COHORT_FIELDS]
        identity[2] = row.get("support_unit") or row.get("unit") or row.get("detection_limit_unit", "")
        cohort = "series-" + _hash(_json_bytes(identity))[:24]
        output = {"record_id": row["record_id"], "site_id": row["site_id"], "date": row["date"],
                  "parameter": row.get("parameter_original", row["parameter"]), "unit": identity[2],
                  "lower": _value(lower), "upper": _value(upper), "lower_open": lower_open, "upper_open": upper_open,
                  "status": "OUTSIDE_SCOPE" if any(r.startswith("OUTSIDE") or r=="PARAMETER_NOT_SELECTED" for r in reasons)
                            else "EXCLUDED" if reasons else "INDETERMINATE",
                  "reason_codes": reasons, "source_file": row.get("original_source_path", row["source_file"]),
                  "source_csv_row": row["source_csv_row"], "source_sha256": row.get("original_source_sha256"),
                  "activity_id": row.get("activity_id"), "local_time": row.get("local_time"),
                  "source_timezone": row.get("source_timezone"), "method_id": row.get("method_id", ""),
                  "method_authority": row.get("method_authority", ""), "series_id": cohort,
                  "selected": selected, "eligible": not reasons, "raw_cells": row.get("raw_cells", {}),
                  "comparisons": [], "original": row,
                  "canonical_record_id": measurement["record_id"],
                  "canonical_original_records": measurement.get("measurement_original_records", []),
                  "canonical_weight": 1 if canonical_first else 0,
                  "laboratory_comment": row["laboratory_comment"], "result_comment": row["result_comment"],
                  "recovered_original_support": row["recovered_original_support"],
                  "source_support_mismatches": row["source_support_mismatches"]}
        if not reasons:
            for metric in metrics:
                months = metric.get("seasonMonths") or profile.get("applicability", {}).get("seasonMonths")
                if months and stamp.month not in months:
                    continue
                if metric["aggregation"] in ("single_sample", "exceedance_fraction"):
                    output["comparisons"].append({"metric_id": metric["id"], "threshold": str(metric["threshold"]),
                        "status": _compare(lower, upper, _decimal(metric["threshold"]), lower_open)})
            states = [r["status"] for r in output["comparisons"]]
            output["status"] = ("ABOVE_THRESHOLD" if "ABOVE_THRESHOLD" in states else
                                "INDETERMINATE" if "INDETERMINATE" in states or not states else "AT_OR_BELOW_THRESHOLD")
        if not any(reason in reasons for reason in (
                "OUTSIDE_SELECTED_PERIOD_OR_COHORT", "PARAMETER_NOT_SELECTED",
                "NON_ROUTINE_OR_REPLICATE_ACTIVITY", "ORIGINAL_STATISTICAL_EXCLUSION",
                "CANONICAL_ACTIVITY_DUPLICATE")):
            # Unavailable selected routine results prevent unsupported complete assessments.
            grouped[cohort].append(output)
        records.append(output)
    series = []
    for identity, rows in sorted(grouped.items()):
        rows.sort(key=lambda r: (r["date"], r.get("local_time") or "", r["record_id"]))
        outcomes = []
        for metric in metrics:
            months = metric.get("seasonMonths") or profile.get("applicability", {}).get("seasonMonths")
            eligible = [r for r in rows if not months or date.fromisoformat(r["date"]).month in months]
            if metric.get("assessment") == "contextual" or metric["aggregation"] not in (
                    "single_sample", "geometric_mean", "exceedance_fraction", "seasonal_arithmetic_mean"):
                outcomes.append({"metric_id": metric["id"], "aggregation": metric["aggregation"],
                    "window_start": request["period"]["start"], "window_end": request["period"]["end"],
                    "n": len(eligible), "lower": None, "upper": None, "threshold": str(metric["threshold"]),
                    "measurement_threshold": str(metric["threshold"]), "unit": rows[0]["unit"], "criterion_unit": profile["units"]["criterion"],
                    "status": "NOT_ASSESSED", "numeric_comparison": "NOT_ASSESSED",
                    "reason_codes": ["PROFILE_FREQUENCY_REQUIRES_SEPARATE_ASSESSMENT"],
                    "record_ids": [r["record_id"] for r in eligible], "rule": metric})
                continue
            if metric["aggregation"] == "single_sample":
                windows = [(r["date"], r["date"], [r]) for r in eligible]
            elif metric["aggregation"] == "seasonal_arithmetic_mean":
                years = sorted({date.fromisoformat(r["date"]).year for r in eligible})
                windows = [((date(y, min(months or [1]), 1)).isoformat(),
                            (date(y + (1 if max(months or [12]) == 12 else 0),
                                  (max(months or [12]) % 12) + 1, 1) - timedelta(days=1)).isoformat(),
                            [r for r in eligible if r["date"].startswith(str(y)+"-")]) for y in years]
            else:
                days = metric.get("windowDays")
                if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 366:
                    raise ValueError("Rolling metrics require an explicit 1–366 day window.")
                windows = []
                for endpoint in sorted({r["date"] for r in eligible}):
                    first = (date.fromisoformat(endpoint) - timedelta(days=days-1)).isoformat()
                    windows.append((first, endpoint, [r for r in eligible if first <= r["date"] <= endpoint]))
            for first, last, chosen in windows:
                reasons = []
                chosen_ids = {r["record_id"] for r in chosen}
                def compatible_ambiguous(candidate):
                    if not candidate["selected"] or candidate["eligible"] or not candidate["canonical_weight"]:
                        return False
                    if not first <= candidate["date"] <= last or candidate["record_id"] in chosen_ids:
                        return False
                    if candidate["site_id"] != rows[0]["site_id"] or candidate["parameter"] != rows[0]["parameter"]:
                        return False
                    if any(reason in candidate["reason_codes"] for reason in (
                            "NON_ROUTINE_OR_REPLICATE_ACTIVITY", "ORIGINAL_STATISTICAL_EXCLUSION",
                            "PARAMETER_NOT_SELECTED", "CANONICAL_ACTIVITY_DUPLICATE")):
                        return False
                    for field in COHORT_FIELDS:
                        if field in ("site_id", "parameter_original", "series_key"):
                            continue
                        left, right = candidate["original"].get(field), rows[0]["original"].get(field)
                        if field == "support_unit":
                            left, right = candidate["unit"], rows[0]["unit"]
                        if left not in (None, "") and right not in (None, "") and left != right:
                            return False
                    return True
                unassigned = [r["record_id"] for r in records if compatible_ambiguous(r)]
                if unassigned:
                    reasons.append("UNASSIGNED_SOURCE_SUPPORT_IN_WINDOW")
                if first < request["period"]["start"]:
                    reasons.append("WINDOW_TRUNCATED_BY_SELECTED_PERIOD")
                days_in_window = [date.fromisoformat(first) + timedelta(days=d)
                                  for d in range((date.fromisoformat(last)-date.fromisoformat(first)).days+1)]
                if selection["year"] is not None and any(d.year != selection["year"] for d in days_in_window):
                    reasons.append("WINDOW_TRUNCATED_BY_SELECTED_YEAR")
                if selection["months"] and any(d.month not in selection["months"] for d in days_in_window):
                    reasons.append("WINDOW_TRUNCATED_BY_SELECTED_MONTHS")
                minimum = metric.get("minSamples", 1)
                if len(chosen) < minimum:
                    reasons.append("INSUFFICIENT_SAMPLES")
                activities = [r["activity_id"] for r in chosen]
                if len(activities) != len(set(activities)):
                    reasons.append("DUPLICATE_ACTIVITY")
                spacing = metric.get("minSpacingHours")
                if spacing:
                    clocks = [_clock(r["original"]) for r in chosen]
                    if any(v is None for v in clocks):
                        reasons.append("SAMPLE_CLOCK_OR_ZONE_MISSING")
                    elif any((b-a).total_seconds() < float(spacing)*3600 for a,b in zip(sorted(clocks), sorted(clocks)[1:])):
                        reasons.append("MINIMUM_SAMPLE_SPACING_NOT_MET")
                if months and metric.get("windowDays") and any(
                        (date.fromisoformat(first) + timedelta(days=d)).month not in months
                        for d in range((date.fromisoformat(last)-date.fromisoformat(first)).days+1)):
                    reasons.append("WINDOW_CROSSES_PROFILE_SEASON")
                if metric.get("requireMonthlyCompositeConfirmation") and not app.get("confirmations", {}).get("monthly-photic-zone-composite"):
                    reasons.append("MONTHLY_PHOTIC_COMPOSITE_NOT_CONFIRMED")
                if metric["aggregation"] == "geometric_mean" and any(
                        r["lower"] is None or r["upper"] is None or r["lower"] != r["upper"]
                        or _decimal(r["lower"]) <= 0 for r in chosen):
                    reasons.append("EXACT_GEOMETRIC_MEAN_UNSUPPORTED")
                if any(not r["eligible"] for r in chosen):
                    reasons.append("INCOMPLETE_VALUE_SUPPORT")
                monthly = metric.get("requiredMonths") or (
                    months if metric.get("requireMonthlyComposite") or metric.get("requireExactlyOneSelectedRepresentativePerMonth") else [])
                if monthly:
                    month_counts = Counter(date.fromisoformat(r["date"]).month for r in chosen)
                    if any(month_counts.get(m, 0) != 1 for m in monthly):
                        reasons.append("ONE_REVIEWED_COMPOSITE_PER_REQUIRED_MONTH_NOT_PRESENT")
                paired = metric.get("pairedMetricId")
                if paired:
                    pair = next((m for m in metrics if m["id"] == paired), None)
                    if pair is None:
                        raise ValueError("The profile paired metric is missing.")
                    if len(chosen) < pair.get("minSamples", 1):
                        reasons.append("PAIRED_METRIC_SAMPLE_SUPPORT_INCOMPLETE")
                    pair_spacing = pair.get("minSpacingHours")
                    if pair_spacing:
                        pair_clocks = [_clock(r["original"]) for r in chosen]
                        present_clocks = sorted(v for v in pair_clocks if v)
                        if any(v is None for v in pair_clocks) or any(
                                (b-a).total_seconds() < float(pair_spacing)*3600
                                for a,b in zip(present_clocks, present_clocks[1:])):
                            reasons.append("PAIRED_METRIC_SPACING_SUPPORT_INCOMPLETE")
                supported = [r for r in chosen if r["eligible"]]
                aggregate_rows = ([r if r["eligible"] else {**r, "lower": None, "upper": None}
                                   for r in chosen] if metric["aggregation"] == "exceedance_fraction" else supported)
                lower, upper = _aggregate(aggregate_rows, metric)
                limit = (_decimal(metric.get("allowedExcursionFraction"))
                         if metric["aggregation"] == "exceedance_fraction" else _decimal(metric["threshold"]))
                if limit is None:
                    raise ValueError("Excursion metrics require their permitted fraction.")
                status = _metric_comparison(aggregate_rows, metric, lower, upper, limit)
                outcomes.append({"metric_id": metric["id"], "aggregation": metric["aggregation"],
                    "window_start": first, "window_end": last, "n": len(chosen), "supported_n": len(supported),
                    "lower": _value(lower), "upper": _value(upper), "threshold": _value(limit),
                    "measurement_threshold": str(metric["threshold"]), "unit": "fraction" if metric["aggregation"]=="exceedance_fraction" else rows[0]["unit"],
                    "criterion_unit": profile["units"]["criterion"],
                    "status": "INDETERMINATE" if reasons else status, "numeric_comparison": status,
                    "numeric_basis": "All chosen canonical routine samples, with unknown bounds retained" if metric["aggregation"]=="exceedance_fraction" else "Supported canonical sample bounds; see n, supported_n and exclusions",
                    "reason_codes": reasons, "record_ids": [r["record_id"] for r in chosen],
                    "unassigned_record_ids": unassigned})
        first = rows[0]
        series.append({"id": identity, "site_id": first["site_id"], "parameter": first["parameter"],
                       "unit": first["unit"], "method": first["method_authority"]+"/"+first["method_id"],
                       "cohort": {key: first["original"].get(key, "") for key in COHORT_FIELDS},
                       "n": len(rows), "metrics": outcomes})
    count = Counter(r["status"] for r in records)
    return {"engine": ENGINE, "summary": {"total": len(records), "selected": sum(r["selected"] for r in records),
        "eligible": sum(r["eligible"] for r in records), "excluded": sum(not r["eligible"] for r in records),
        "above": count["ABOVE_THRESHOLD"], "below": count["AT_OR_BELOW_THRESHOLD"],
        "indeterminate": count["INDETERMINATE"], "series": len(series),
        "windows": sum(len(s["metrics"]) for s in series)},
        "applicability_state": "ANALYST_CONFIRMED" if not warnings else "DESCRIPTIVE_COMPARISON",
        "warnings": warnings, "rows": records, "series": series,
        "interpretation": "Threshold comparisons on the selected sampled observations. Regulatory assessment, advisory issuance and designated-use determinations remain with the responsible authority.",
        "window_convention": "Rolling dates include the endpoint and the preceding windowDays−1 calendar dates. A reported window is anchored at an actual selected sample date; unsampled days do not become zero.",
        "contextual_rules": {"profile": profile.get("frequency"), "metrics": [{"id": m["id"], "frequency": m.get("frequency")} for m in metrics if m.get("frequency")], "other": profile.get("contextualRules", [])},
        "censoring": "Original finite bounds are propagated without half-limit or zero substitutions. A missing upper bound remains unbounded. Bounds express censoring, not confidence intervals. Source-declared agreeing activity results receive one analytical weight; all original rows and identifiers remain retained."}

def _verify_profile_binding(body, sources):
    entries = body.get("source_files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Retain the complete profile-source inventory.")
    seen = set()
    for item in entries:
        name = _name(item["path"])
        if name in seen:
            raise ValueError("Profile source paths must be unique.")
        seen.add(name)
        raw = sources.get(name)
        if raw is None or len(raw) != item["bytes"] or _hash(raw) != item["sha256"]:
            raise ValueError("The saved authoritative source changed: " + name)
    if "profiles.json" not in seen or _hash(sources["profiles.json"]) != body["catalog_sha256"]:
        raise ValueError("The interpretation's original profile catalog differs.")
    catalog = json.loads(sources["profiles.json"])
    if catalog.get("schema") != "tjl.monitoring-interpretation-profiles.v1":
        raise ValueError("The retained profile catalog is incompatible.")
    matches = [p for p in catalog.get("profiles", []) if p.get("id") == body["request"]["profile_id"]]
    if len(matches) != 1 or matches[0] != body["profile"]:
        raise ValueError("The comparison profile differs from its retained authoritative catalog.")

class MonitoringInterpretations:
    def __init__(self, store, application=None):
        self.store = store
        self.root = store.root / "interpretations"
        self.application = application

    def _path(self, identity):
        return self.root / (_identifier(identity)+".json")

    def _read(self, identity):
        value = json.loads(self._path(identity).read_bytes())
        if value.get("schema") != SCHEMA or value.get("id") != identity:
            raise ValueError("Saved interpretation identity changed.")
        if "interpretation-"+_hash(_json_bytes(value["content"])) != identity:
            raise ValueError("Saved interpretation content changed.")
        return value

    def catalog(self, study_id=None, version_id=None):
        catalog, files = load_catalog(self.application)
        saved = []
        if self.root.exists():
            for path in self.root.glob("interpretation-*.json"):
                value = self._read(path.stem)
                body = value["content"]
                if study_id and body["binding"]["study_id"] != study_id or version_id and body["binding"]["version_id"] != version_id:
                    continue
                saved.append({"id": value["id"], "title": body["title"], "saved_at": value["saved_at"],
                              "profile_id": body["profile"]["id"], **body["binding"]})
        return {"profiles": catalog["profiles"], "catalog": {k:v for k,v in catalog.items() if k!="profiles"},
                "sources": json.loads(files["source-index.json"])["sources"],
                "saved": sorted(saved, key=lambda r:(r["saved_at"],r["id"]), reverse=True)}

    def preview(self, payload):
        if not isinstance(payload, dict) or any(
                not isinstance(payload.get(key), str) or not payload[key]
                for key in ("study_id", "version_id")):
            raise ValueError("Choose the exact retained study and version before previewing.")
        complete = self.store.get_study(payload["study_id"], payload["version_id"])
        request = _normal_request(payload, complete)
        catalog, files = load_catalog(self.application)
        profile = next((p for p in catalog["profiles"] if p["id"] == request["profile_id"]), None)
        if profile is None:
            raise ValueError("Choose an installed original monitoring profile.")
        result = calculate(complete, request, profile)
        content = {"binding": _binding(complete["record"]), "request": request, "profile": profile,
                   "catalog_sha256": _hash(files["profiles.json"]),
                   "source_files": [{"path":name,"bytes":len(raw),"sha256":_hash(raw)} for name,raw in sorted(files.items())],
                   "result": result, "study_title": complete["study"]["title"]}
        return {"schema": PREVIEW, "id": "preview-"+_hash(_json_bytes(content)), **content,
                **{k:result[k] for k in ("summary","series","rows","warnings","applicability_state")},
                "sources": json.loads(files["source-index.json"])["sources"],
                "originalCounts": complete["record"]["counts"]}

    def save(self, payload):
        preview = self.preview(payload)
        if payload.get("preview_id") != preview["id"]:
            raise ValueError("Preview the exact current source, profile and choices before saving.")
        parent = payload.get("parent_id")
        if parent is not None:
            previous = self._read(_identifier(parent))
            if previous["content"]["binding"] != preview["binding"]:
                raise ValueError("A revision must retain its original study edition; save another interpretation for a different source.")
        _, sources = load_catalog(self.application)
        body = {key:preview[key] for key in ("binding","request","profile","catalog_sha256","source_files","result","study_title")}
        body.update(title=_text(payload.get("title"),"interpretation title",200,True), parent_id=parent)
        identity = "interpretation-"+_hash(_json_bytes(body))
        value = {"schema":SCHEMA,"id":identity,"saved_at":datetime.now(timezone.utc).isoformat(),"content":body}
        with held(self.root/".lock"):
            if self._path(identity).exists():
                return {"interpretation":self._read(identity),"reused":True}
            root = self.root/(identity+"-sources")
            for item in body["source_files"]:
                raw = sources[item["path"]]
                if _hash(raw) != item["sha256"]:
                    raise ValueError("Profile source changed during save.")
                _atomic(root/item["path"],raw)
            _atomic(self._path(identity),_json_bytes(value))
        return {"interpretation":value,"reused":False}

    def get(self, identity):
        value = self._read(identity)
        binding = value["content"]["binding"]
        complete = self.store.get_study(binding["study_id"],binding["version_id"])
        if _binding(complete["record"]) != binding:
            raise ValueError("The saved interpretation's original study changed.")
        sources = {item["path"]: (self.root/(identity+"-sources")/_name(item["path"])).read_bytes()
                   for item in value["content"]["source_files"]}
        _verify_profile_binding(value["content"], sources)
        return {"interpretation":value, "sources":json.loads(sources["source-index.json"])["sources"]}

    def export(self, identity, destination):
        value = self.get(identity)["interpretation"]
        body = value["content"]
        destination = Path(destination); destination.mkdir(parents=True,exist_ok=True)
        self.store.export_study(body["binding"]["study_id"],destination/"original-study.zip",body["binding"]["version_id"])
        _atomic(destination/"interpretation.json",_json_bytes(value))
        _atomic(destination/"report.html",report_html(value).encode("utf-8"))
        _atomic(destination/"observations.csv",rows_csv(body["result"]["rows"]))
        _atomic(destination/"windows.csv",windows_csv(body["result"]["series"]))
        names = ["interpretation.json","report.html","observations.csv","windows.csv","original-study.zip"]
        for item in body["source_files"]:
            name="profile-sources/"+_name(item["path"])
            _atomic(destination/name,(self.root/(identity+"-sources")/item["path"]).read_bytes());names.append(name)
        source = Path(__file__)
        _atomic(destination/"reproduction/monitoring_interpretation.py",source.read_bytes())
        names.append("reproduction/monitoring_interpretation.py")
        _atomic(destination/"OPEN.md",("Open report.html for the complete selected comparison; CSVs retain every original row and window. Import monitoring-interpretation.zip in the existing Published studies desk to reopen the exact study, interpretation and profile sources. Original study data are in original-study.zip. The maintained Python module runs preview/save/export/receive with the original Workspace. Threshold comparisons do not issue health advice or compliance decisions.\n").encode())
        names.append("OPEN.md")
        inventory=[{"path":name,"bytes":(destination/name).stat().st_size,"sha256":_hash((destination/name).read_bytes())} for name in sorted(names)]
        index={"schema":BUNDLE,"interpretation_id":identity,"files":inventory,"engine":ENGINE}
        _atomic(destination/"interpretation-export.json",_json_bytes(index))
        target=destination/"monitoring-interpretation.zip"
        with tempfile.NamedTemporaryFile(dir=destination,suffix=".zip",delete=False) as temp:
            temporary=Path(temp.name)
        try:
            with zipfile.ZipFile(temporary,"w",zipfile.ZIP_DEFLATED) as archive:
                for name in [*sorted(names),"interpretation-export.json"]:
                    archive.write(destination/name,name)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return {"interpretation":value,"files":[destination/"report.html",destination/"observations.csv",destination/"windows.csv",destination/"interpretation.json",target]}

    def receive(self, source, operation_id):
        raw=source if isinstance(source,bytes) else Path(source).read_bytes()
        if len(raw)>MAX_BYTES: raise ValueError("Interpretation archive exceeds 256 MiB.")
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names=archive.namelist()
            if len(names)!=len(set(names)) or "interpretation-export.json" not in names:
                raise ValueError("Choose the complete original interpretation archive.")
            if archive.getinfo("interpretation-export.json").file_size>4*1024*1024:
                raise ValueError("Archive index exceeds its supported size.")
            index=json.loads(archive.read("interpretation-export.json"))
            if index.get("schema")!=BUNDLE: raise ValueError("Unsupported interpretation archive.")
            files=index.get("files",[])
            if not isinstance(files,list) or len(files)>2000: raise ValueError("Invalid source inventory.")
            inventory={_name(item["path"]):item for item in files}
            if len(inventory)!=len(files) or set(names)!=set(inventory)|{"interpretation-export.json"}:
                raise ValueError("The complete archive inventory differs.")
            if not {"interpretation.json","original-study.zip","report.html"}<=set(inventory):
                raise ValueError("The original interpretation/study is missing.")
            if sum(archive.getinfo(n).file_size for n in inventory)>MAX_BYTES:
                raise ValueError("Expanded interpretation archive exceeds 256 MiB.")
            retained={}
            for name,item in inventory.items():
                data=archive.read(name)
                if len(data)!=item["bytes"] or _hash(data)!=item["sha256"]:
                    raise ValueError("Archive source changed: "+name)
                retained[name]=data
        value=json.loads(retained["interpretation.json"])
        identity=_identifier(value.get("id"))
        if value.get("schema")!=SCHEMA or index.get("interpretation_id")!=identity or "interpretation-"+_hash(_json_bytes(value["content"]))!=identity:
            raise ValueError("Original interpretation content changed.")
        body=value["content"]
        incoming_sources = {item["path"]: retained.get("profile-sources/"+_name(item["path"]))
                            for item in body["source_files"]}
        _verify_profile_binding(body, incoming_sources)
        imported=self.store.import_source(retained["original-study.zip"],operation_id=operation_id,make_current=False)
        if _binding(imported["record"])!=body["binding"]:
            raise ValueError("The incoming original study differs from its bound interpretation.")
        # Recalculate from the received originals using the saved profile, never today's catalog.
        complete=self.store.get_study(body["binding"]["study_id"],body["binding"]["version_id"])
        request=_normal_request(body["request"],complete)
        if request!=body["request"] or calculate(complete,request,body["profile"])!=body["result"]:
            raise ValueError("The saved comparison does not reproduce from its original study.")
        with held(self.root/".lock"):
            reused=self._path(identity).exists()
            if reused:
                existing=self._read(identity)
                if existing["content"]!=body: raise ValueError("Existing interpretation differs.")
                value=existing
            else:
                for item in body["source_files"]:
                    name="profile-sources/"+_name(item["path"])
                    data=retained.get(name)
                    if data is None or len(data)!=item["bytes"] or _hash(data)!=item["sha256"]:
                        raise ValueError("Original authoritative profile source is missing.")
                    _atomic(self.root/(identity+"-sources")/item["path"],data)
                _atomic(self._path(identity),_json_bytes(value))
        return {"interpretation":self.get(identity)["interpretation"],"reused":reused}

def _csv(records, columns):
    stream=io.StringIO(newline="");writer=csv.writer(stream)
    writer.writerow(columns)
    for row in records:
        values=[]
        for key in columns:
            value=row.get(key,"")
            if value is None:value=""
            if isinstance(value,(dict,list)):value=json.dumps(value,ensure_ascii=False,separators=(",",":"))
            if isinstance(value,str) and re.match(r"^[\s]*[=+@\t\r-]",value):value="'"+value
            values.append(value)
        writer.writerow(values)
    return stream.getvalue().encode("utf-8")

def rows_csv(rows):
    return _csv(rows,("record_id","site_id","date","local_time","source_timezone","activity_id","parameter","unit","method_authority","method_id","laboratory_comment","result_comment","recovered_original_support","source_support_mismatches","lower","upper","lower_open","upper_open","status","reason_codes","comparisons","source_file","source_csv_row","source_sha256","raw_cells"))

def windows_csv(series):
    return _csv([{**row,"series_id":s["id"],"site_id":s["site_id"],"parameter":s["parameter"],"method":s["method"]} for s in series for row in s["metrics"]],("series_id","site_id","parameter","method","metric_id","aggregation","window_start","window_end","n","supported_n","lower","upper","unit","criterion_unit","threshold","measurement_threshold","status","numeric_comparison","numeric_basis","reason_codes","record_ids","unassigned_record_ids"))

def report_html(value):
    body=value["content"];result=body["result"];esc=html.escape
    def e(x):return esc(str(x if x is not None else "Unbounded / unavailable"))
    def table(rows,fields):
        return '<div class="table"><table><thead><tr>'+"".join("<th>"+e(k.replace("_"," "))+"</th>" for k in fields)+"</tr></thead><tbody>"+"".join("<tr>"+"".join("<td>"+e(json.dumps(r.get(k),ensure_ascii=False) if isinstance(r.get(k),(dict,list)) else r.get(k))+"</td>" for k in fields)+"</tr>" for r in rows)+"</tbody></table></div>"
    doc='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(body["title"])+'</title><style>body{font:16px/1.5 system-ui;color:#202020;background:#fff;margin:0}main{max-width:88rem;margin:auto;padding:28px}h1{font-size:1.8rem}h2{margin-top:2rem}.table{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}td,th{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}a{color:inherit}p,li,dd{overflow-wrap:anywhere}.notice{border-left:4px solid #555;padding:10px;background:#f5f5f5}details{margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:480px){main{padding:14px}h1{font-size:1.5rem}}@media print{main{padding:0}body{font-size:10pt}.table{overflow:visible}table{font-size:8pt;min-width:0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}}</style><main><h1>'+e(body["title"])+'</h1><p>'+e(body["study_title"])+'</p><p><strong>'+e(body["profile"]["label"])+'</strong> · '+e(body["profile"]["authority"].get("kind"))+' · '+e(body["profile"]["authority"].get("edition"))+'</p><p class="notice">'+e(result["interpretation"])+'</p><p>'+e(result["applicability_state"])+' · '+e("; ".join(result["warnings"]))+'</p><p>'+e(body["request"]["period"]["start"])+' to '+e(body["request"]["period"]["end"])+'</p><p>'+e(result["censoring"])+'</p><p>'+e(result["window_convention"])+'</p>'
    doc+='<nav><a href="observations.csv">All original observation comparisons CSV</a> · <a href="windows.csv">All analytical windows CSV</a> · <a href="interpretation.json">Complete editable selection and result</a> · <a href="original-study.zip">Complete original study</a></nav>'
    doc+='<h2>Selected support</h2>'+table([result["summary"]],list(result["summary"]))
    doc+='<h2>Analyst applicability</h2><pre>'+e(json.dumps(body["request"]["applicability"],indent=2,ensure_ascii=False))+'</pre>'
    for s in result["series"]:
        doc+='<h2>'+e(s["site_id"])+' · '+e(s["parameter"])+' · '+e(s["method"])+'</h2><p>'+e(s["n"])+' selected canonical routine records; units '+e(s["unit"])+'</p>'+table(s["metrics"],("metric_id","aggregation","window_start","window_end","n","supported_n","lower","upper","unit","criterion_unit","threshold","status","reason_codes"))
    doc+='<h2>Original observation comparisons</h2>'+table(result["rows"],("site_id","date","activity_id","parameter","unit","lower","upper","status","reason_codes","source_file","source_csv_row"))
    doc+='<h2>Source profile and limitations</h2><pre>'+e(json.dumps(body["profile"],indent=2,ensure_ascii=False))+'</pre><h2>Retained profile sources</h2><ul>'
    for item in body["source_files"]:
        doc+='<li><a href="profile-sources/'+html.escape(item["path"],quote=True)+'">'+e(item["path"])+'</a> · '+e(item["bytes"])+' bytes</li>'
    return doc+'</ul><details><summary>Exact study and source identities</summary><pre>'+e(json.dumps(body["binding"],indent=2))+'</pre></details></main></html>'

def main(argv=None):
    import argparse
    from model.workspace import Workspace
    from .published_studies import PublishedStudyStore
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",required=True);parser.add_argument("--result")
    commands=parser.add_subparsers(dest="command",required=True)
    commands.add_parser("catalog")
    for name in ("preview","save"):
        item=commands.add_parser(name);item.add_argument("--request",required=True)
    for name in ("open","export"):
        item=commands.add_parser(name);item.add_argument("--interpretation-id",required=True)
        if name=="export":item.add_argument("--out",required=True)
    item=commands.add_parser("receive");item.add_argument("--source",required=True);item.add_argument("--operation-id",required=True)
    args=parser.parse_args(argv);ws=Workspace(args.workspace)
    service=MonitoringInterpretations(PublishedStudyStore(ws,ws.root/"published_studies"))
    if args.command=="catalog":result=service.catalog()
    elif args.command in ("preview","save"):result=getattr(service,args.command)(json.loads(Path(args.request).read_text("utf-8-sig")))
    elif args.command=="open":result=service.get(args.interpretation_id)
    elif args.command=="export":
        result=service.export(args.interpretation_id,args.out);result["files"]=[str(p.resolve()) for p in result["files"]]
    else:result=service.receive(Path(args.source),args.operation_id)
    raw=_json_bytes(result)
    if args.result:_atomic(Path(args.result),raw);print(json.dumps({"path":str(Path(args.result).resolve()),"bytes":len(raw),"sha256":_hash(raw)}))
    else:print(raw.decode())
    return 0

if __name__=="__main__":
    raise SystemExit(main())
