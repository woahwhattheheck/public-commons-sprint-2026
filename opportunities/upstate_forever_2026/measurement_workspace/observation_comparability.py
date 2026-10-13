"""Source-preserving, common-calendar-month comparisons of observed water quality.

This module consumes the maintained original-result index. It never fits a model,
substitutes a reporting limit, pools different analytical series, or rewrites an
original measurement. Exact rational arithmetic retains the censoring statements.
"""
from __future__ import annotations

import argparse
import calendar
from collections import Counter, defaultdict
import csv
from datetime import date
from fractions import Fraction
import hashlib
import itertools
import json
import re
from pathlib import Path, PurePosixPath
import shutil
from typing import Any, Iterable

SCHEMA = "upstate.observation-comparability/v1"
VERSION = "observation-comparability/2"
INDEX = "observations/sv833_2021_2026/original-result-index.csv"
SERIES_FIELDS = ("station", "project", "characteristic", "unit", "fraction",
                 "speciation", "method", "method_context", "value_type")
INTERVAL_FIELDS = ("lower", "upper", "lower_open", "upper_open", "censoring",
                   "analysis_eligible", "quality_flag")


def canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def identity(path: Path, root: Path | None = None) -> dict[str, Any]:
    raw = path.read_bytes()
    return {"path": path.relative_to(root).as_posix() if root else path.name,
            "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def member(root: Path, name: str) -> Path:
    logical = PurePosixPath(name)
    if (not name or "\\" in name or logical.is_absolute()
            or any(part in (".", "..") for part in logical.parts)):
        raise ValueError("Use an original relative source path: " + name)
    candidate = root.joinpath(*logical.parts).resolve(strict=True)
    if not candidate.is_relative_to(root.resolve()):
        raise ValueError("Source path leaves the selected application: " + name)
    if not candidate.is_file():
        raise ValueError("Source member is not a file: " + name)
    return candidate


def _bool(value: str) -> bool:
    if value not in ("true", "false"):
        raise ValueError("Original index needs explicit true/false fields")
    return value == "true"


def interval(row: dict[str, str]) -> dict[str, Any] | None:
    if not _bool(row["analysis_eligible"]):
        return None
    lower = Fraction(row["lower"]) if row["lower"] else None
    upper = Fraction(row["upper"]) if row["upper"] else None
    lo, hi = _bool(row["lower_open"]), _bool(row["upper_open"])
    censor = row["censoring"]
    if censor == "none":
        if lower is None or upper is None or lower != upper or lo or hi:
            return None
    elif censor == "below":
        if lower is None or upper is None or not hi:
            return None
    elif censor == "above":
        if lower is None or not lo or upper is not None:
            return None
    else:
        return None
    if lower is not None and upper is not None:
        if lower > upper or (lower == upper and (lo or hi)):
            return None
    return {"lower": lower, "upper": upper, "lower_open": lo, "upper_open": hi}


def _mean(values: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    values = list(values)
    if not values:
        return None
    result: dict[str, Any] = {}
    for side in ("lower", "upper"):
        endpoints = [value[side] for value in values]
        result[side] = (None if any(value is None for value in endpoints)
                        else sum(endpoints, Fraction()) / len(endpoints))
        result[side + "_open"] = any(value[side + "_open"] for value in values)
    return result


def _difference(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Return B minus A; None at a lower/upper endpoint denotes -/+ infinity."""
    lo = None if b["lower"] is None or a["upper"] is None else b["lower"] - a["upper"]
    hi = None if b["upper"] is None or a["lower"] is None else b["upper"] - a["lower"]
    return {"lower": lo, "upper": hi,
            "lower_open": b["lower_open"] or a["upper_open"],
            "upper_open": b["upper_open"] or a["lower_open"]}


def _number(value: Fraction | None, *, lower: bool = False) -> str:
    return ("-infinity" if lower else "+infinity") if value is None else format(float(value), ".6g")


def encoded(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    lo, hi = value["lower"], value["upper"]
    point = lo is not None and lo == hi and not value["lower_open"] and not value["upper_open"]
    text = _number(lo) if point else (
        ("(" if value["lower_open"] or lo is None else "[") + _number(lo, lower=True)
        + ", " + _number(hi) + (")" if value["upper_open"] or hi is None else "]"))
    return {"lower": float(lo) if lo is not None else None,
            "upper": float(hi) if hi is not None else None,
            "lower_exact": str(lo) if lo is not None else None,
            "upper_exact": str(hi) if hi is not None else None,
            "lower_open": value["lower_open"], "upper_open": value["upper_open"],
            "text": text}


def _direction(value: dict[str, Any]) -> str:
    lo, hi = value["lower"], value["upper"]
    if lo is not None and (lo > 0 or (lo == 0 and value["lower_open"])):
        return "Higher within retained limit bounds"
    if hi is not None and (hi < 0 or (hi == 0 and value["upper_open"])):
        return "Lower within retained limit bounds"
    if lo == hi == 0:
        return "Same retained arithmetic mean"
    return "Limit bounds span zero change"


def load_index(application: Path, name: str = INDEX) -> tuple[list[dict[str, str]], list[str]]:
    """Read the accepted source index and retain its exact original row selectors."""
    index_path = member(application, name)
    with index_path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = set(SERIES_FIELDS + INTERVAL_FIELDS) | {
            "result_id", "activity", "date", "source_path", "source_sha256", "source_data_row"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Select the complete maintained original-result index")
        rows = list(reader)
    if not rows or len({row["result_id"] for row in rows}) != len(rows):
        raise ValueError("Original result identifiers must be present and unique")
    source_names = {name}
    source_cache: dict[str, tuple[str, list[dict[str, str]]]] = {}
    for row in rows:
        date.fromisoformat(row["date"])
        for field in INTERVAL_FIELDS:
            if field not in row:
                raise ValueError("The original result index lacks " + field)
        src_name = row["source_path"]
        if src_name not in source_cache:
            path = member(application, src_name)
            with path.open(encoding="utf-8-sig", newline="") as stream:
                original = list(csv.DictReader(stream))
            source_cache[src_name] = (identity(path)["sha256"], original)
        actual_hash, originals = source_cache[src_name]
        position = int(row["source_data_row"])
        if (actual_hash != row["source_sha256"] or position < 1 or position > len(originals)
                or originals[position - 1].get("ResultIdentifier") != row["result_id"]):
            raise ValueError("Original row selector no longer matches " + row["result_id"])
        source_names.add(src_name)
        if row.get("original_activity_path"):
            source_names.add(row["original_activity_path"])
    # Keep the complete publisher response set, including limits and full-profile
    # reconciliation selectors referenced by the original index.
    for source_name in tuple(source_names):
        if "/original/" in source_name:
            for path in member(application, source_name).parent.iterdir():
                if path.is_file() and path.suffix in (".csv", ".json"):
                    source_names.add(path.relative_to(application).as_posix())
    return rows, sorted(source_names)


def build(rows: list[dict[str, str]]) -> dict[str, Any]:
    cohorts: dict[tuple[str, ...], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        cohorts[tuple(row[field] for field in SERIES_FIELDS)].append(row)
    series_out, measurements_out, comparisons, cells = [], [], [], []
    for series_key, series_rows in sorted(cohorts.items()):
        original = dict(zip(SERIES_FIELDS, series_key))
        sid = hashlib.sha256(canonical(original)).hexdigest()[:20]
        groups: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
        for row in series_rows:
            groups[(row["activity"], row["date"])].append(row)
        measurements = []
        for (activity, day), members in sorted(groups.items(), key=lambda item: item[0][1]):
            signatures = {tuple(row[field] for field in INTERVAL_FIELDS) for row in members}
            agreeing = len(signatures) == 1
            bound = interval(members[0]) if agreeing else None
            reason = ("Conflicting original values in one analytical activity" if not agreeing else
                      members[0]["quality_flag"] or "Unsupported original numeric interval")
            item = {"id": hashlib.sha256(canonical([sid, activity, day])).hexdigest()[:24],
                    "series_id": sid, "activity": activity, "date": day,
                    "year": int(day[:4]), "month": int(day[5:7]),
                    "original_result_ids": [row["result_id"] for row in members],
                    "original_rows": len(members), "agreeing_results": agreeing,
                    "included": bound is not None, "exclusion": None if bound else reason,
                    "censoring": members[0]["censoring"] if agreeing else "conflicting",
                    "interval": encoded(bound), "_interval": bound}
            measurements.append(item)
            measurements_out.append({key: value for key, value in item.items() if key != "_interval"})
        by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
        month_values: dict[tuple[int, int], dict[str, Any]] = {}
        for item in measurements:
            by_year[item["year"]].append(item)
        yearly = []
        for year, year_items in sorted(by_year.items()):
            admitted = [item for item in year_items if item["included"]]
            monthly = defaultdict(list)
            for item in year_items:
                monthly[item["month"]].append(item)
            for month, mm in sorted(monthly.items()):
                included = [item for item in mm if item["included"]]
                mean = _mean(item["_interval"] for item in included)
                # A month with a flagged or conflicting source measurement is
                # retained in the ledger, but not used for a complete-month match.
                complete = bool(included) and len(included) == len(mm)
                month_values[(year, month)] = {"mean": mean, "complete": complete,
                                              "included": included, "all": mm}
                cells.append({"series_id": sid, **original, "year": year, "month": month,
                              "activities": len(mm), "admitted_activities": len(included),
                              "original_rows": sum(item["original_rows"] for item in mm),
                              "complete_source_support": complete, "mean": encoded(mean),
                              "measurement_ids": [item["id"] for item in mm],
                              "censored_activities": sum(item["censoring"] != "none" for item in included)})
            yearly.append({"year": year, "activities": len(year_items), "admitted_activities": len(admitted),
                           "original_rows": sum(item["original_rows"] for item in year_items),
                           "observed_months": sorted(monthly),
                           "complete_supported_months": [month for month in sorted(monthly)
                                                        if month_values[(year, month)]["complete"]],
                           "first_date": min(item["date"] for item in year_items),
                           "last_date": max(item["date"] for item in year_items),
                           "mean": encoded(_mean(item["_interval"] for item in admitted)),
                           "measurement_ids": [item["id"] for item in year_items]})
        for year_a, year_b in itertools.combinations(sorted(by_year), 2):
            common = [month for month in range(1, 13)
                      if month_values.get((year_a, month), {}).get("complete")
                      and month_values.get((year_b, month), {}).get("complete")]
            pair = {"id": sid + ":" + str(year_a) + ":" + str(year_b), "series_id": sid,
                    **original, "year_a": year_a, "year_b": year_b,
                    "common_months": common, "common_month_count": len(common)}
            for letter, year in (("a", year_a), ("b", year_b)):
                selected = [item for month in common for item in month_values[(year, month)]["included"]]
                means = [month_values[(year, month)]["mean"] for month in common]
                all_included = [item for item in by_year[year] if item["included"]]
                pair["activities_" + letter] = len(selected)
                pair["all_activities_" + letter] = len(by_year[year])
                pair["original_rows_" + letter] = sum(item["original_rows"] for item in selected)
                pair["measurement_ids_" + letter] = [item["id"] for item in selected]
                pair["unmatched_months_" + letter] = sorted({item["month"] for item in by_year[year]} - set(common))
                pair["excluded_activities_" + letter] = len(by_year[year]) - len(all_included)
                pair["censored_activities_" + letter] = sum(item["censoring"] != "none" for item in selected)
                pair["matched_mean_" + letter] = encoded(_mean(means))
                pair["observed_period_mean_" + letter] = encoded(_mean(item["_interval"] for item in all_included))
            if common:
                a = _mean(month_values[(year_a, month)]["mean"] for month in common)
                b = _mean(month_values[(year_b, month)]["mean"] for month in common)
                delta = _difference(a, b)
                pair.update(change=encoded(delta), direction=_direction(delta))
            else:
                pair.update(change=None, direction="No shared fully supported calendar month")
            pair["monthly"] = [{"month": month,
                                "a": encoded(month_values[(year_a, month)]["mean"]),
                                "b": encoded(month_values[(year_b, month)]["mean"]),
                                "change": encoded(_difference(month_values[(year_a, month)]["mean"],
                                                              month_values[(year_b, month)]["mean"])),
                                "activities_a": len(month_values[(year_a, month)]["included"]),
                                "activities_b": len(month_values[(year_b, month)]["included"])} for month in common]
            comparisons.append(pair)
        series_out.append({"id": sid, **original, "original_rows": len(series_rows),
                           "activities": len(measurements), "years": yearly})
    counts = {"original_result_ids": len(rows), "activities": len({row["activity"] for row in rows}),
              "dates": len({row["date"] for row in rows}), "analytical_series": len(series_out),
              "characteristics": len({row["characteristic"] for row in rows}),
              "activity_measurements": len(measurements_out),
              "agreeing_multi_result_groups": sum(item["original_rows"] > 1 and item["agreeing_results"]
                                                  for item in measurements_out),
              "admitted_activity_measurements": sum(item["included"] for item in measurements_out),
              "excluded_activity_measurements": sum(not item["included"] for item in measurements_out),
              "source_row_censoring": dict(Counter(row["censoring"] for row in rows)),
              "comparisons": len(comparisons),
              "supported_comparisons": sum(bool(pair["common_months"]) for pair in comparisons)}
    return {"schema": SCHEMA, "version": VERSION, "counts": counts,
            "period": {"start": min(row["date"] for row in rows), "end": max(row["date"] for row in rows)},
            "years": sorted({int(row["date"][:4]) for row in rows}),
            "series_fields": list(SERIES_FIELDS), "series": series_out,
            "measurements": measurements_out, "month_cells": cells,
            "comparisons": comparisons, "original_rows": rows}


def presentation(data: dict[str, Any], index_name: str, *,
                 title: str | None = None, source_prefix: str | None = None) -> dict[str, Any]:
    """Name the selected retained cohort without relabelling its source rows."""
    stations = sorted({row["station"] for row in data["original_rows"]})
    if title is not None and (not isinstance(title, str) or not title.strip()):
        raise ValueError("Use a nonempty report title")
    if source_prefix is None:
        station_key = re.sub(r"[^a-z0-9]+", "-", stations[0].lower()).strip("-") if len(stations) == 1 else ""
        if station_key and not station_key[0].isalpha():
            station_key = "station-" + station_key
        source_prefix = ((station_key[:48] + "-") if station_key else "") + "observation-comparability"
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", source_prefix):
        raise ValueError("Source prefix must be 1-80 lowercase letters, digits or hyphens, starting with a letter")
    title = title.strip() if title else (
        (stations[0] if len(stations) == 1 and stations[0] else str(len(stations)) + " stations")
        + " comparable-period water quality")
    return {
        "title": title, "source_prefix": source_prefix, "index_path": index_name,
        "stations": stations, "projects": sorted({row["project"] for row in data["original_rows"]}),
        "source_uris": sorted({row.get("source_uri", "") for row in data["original_rows"] if row.get("source_uri")}),
        "source_vintage": ("Original observations " + data["period"]["start"] + " through "
                           + data["period"]["end"] + "; " + VERSION),
        "series_labels": {item["id"]: "S" + str(n).zfill(3)
                          for n, item in enumerate(data["series"], 1)},
    }


def _series_label(data: dict[str, Any], series_id: str) -> str:
    labels = data.get("presentation", {}).get("series_labels", {})
    return labels.get(series_id, series_id)


def fmt(value: dict[str, Any] | None) -> str:
    return value["text"] if value else "Not compared"


def sections(data: dict[str, Any], year_a: int, year_b: int) -> list[Any]:
    c = data["counts"]
    view = data.get("presentation") or presentation(data, INDEX)
    index_name = view["index_path"]
    selected = [pair for pair in data["comparisons"] if (pair["year_a"], pair["year_b"]) == (year_a, year_b)]
    findings = [
        f"The retained cohort contains {c['original_result_ids']} distinct original result IDs, "
        f"{c['activities']} sampling activities and {c['characteristics']} characteristics. "
        f"Its observed dates run from {data['period']['start']} through {data['period']['end']}.",
        f"Agreement within the same analytical activity yields {c['activity_measurements']} measurement groups. "
        f"All {c['original_result_ids']} result IDs remain present; {c['agreeing_multi_result_groups']} groups "
        "contain agreeing multiple result IDs and receive one activity weight rather than repeated weight.",
        f"The printable comparison is {year_b} minus {year_a}. The offline desk includes all "
        f"{c['comparisons']} same-series year-pair selections. Each comparison uses only calendar months "
        "represented in both years with complete original numerical support after the retained source screen.",
        f"This edition contains {len(view['stations'])} original station identity/identities and ends on "
        f"{data['period']['end']}. Each year can have different seasonal coverage. The matched-period table "
        "uses equal weights across the actual common months; within each month, each admitted activity has equal weight.",
        "Series labels identify the complete original station, project, characteristic, unit, fraction, "
        "chemical specification, method, method context and value type listed below. Repeated characteristics "
        "with different analytical identities remain distinct rows."

    ]
    rows = []
    detail = []
    for pair in selected:
        months = ", ".join(calendar.month_abbr[m] for m in pair["common_months"]) or "None"
        label = _series_label(data, pair["series_id"])
        rows.append([label, pair["characteristic"], pair["unit"],
                     f"{pair['activities_a']} / {pair['activities_b']}",
                     str(pair["common_month_count"]), fmt(pair["change"])])
        detail.append([label + " / " + pair["characteristic"], months,
                       fmt(pair["matched_mean_a"]), fmt(pair["matched_mean_b"])])
    annual = []
    for year in data["years"]:
        originals = [row for row in data["original_rows"] if int(row["date"][:4]) == year]
        annual.append([str(year), str(len({row["activity"] for row in originals})), str(len(originals)),
                       ", ".join(calendar.month_abbr[m] for m in sorted({int(row["date"][5:7]) for row in originals})),
                       max(row["date"] for row in originals)])
    series_rows = []
    for item in data["series"]:
        series_rows.append([
            _series_label(data, item["id"]) + "\n" + item["id"],
            "Station: " + (item["station"] or "(empty)") + "\nProject: " + (item["project"] or "(empty)"),
            "Characteristic: " + (item["characteristic"] or "(empty)") + "\nUnit: " + (item["unit"] or "(empty)"),
            "Method: " + (item["method"] or "(empty)") + "\nContext: " + (item["method_context"] or "(empty)"),
            "Fraction: " + (item["fraction"] or "(empty)") + "\nSpecification: " + (item["speciation"] or "(empty)")
            + "\nValue type: " + (item["value_type"] or "(empty)"),
        ])
    exclusions = [item for item in data["measurements"] if not item["included"]]
    return [
        ["Decision summary", findings],
        [f"Comparable-month change: {year_b} minus {year_a}", [
            {"kind": "table", "columns": ["Series", "Characteristic", "Unit", "Activities A / B", "Months", "Change bounds"],
             "rows": rows, "widths": [.6, 1.5, .8, .8, .6, 1.5],
             "caption": "Change bounds describe the retained activity measurements and source censor statements. "
                        "They are arithmetic bounds, not statistical confidence intervals or evidence of a trend."},
            "An open parenthesis excludes that endpoint; an infinity endpoint has no finite bound. "
            "All reported units, analytical methods, fractions, specifications, value types and source projects remain separate."
        ]],
        ["Matched periods and original means", [
            {"kind": "table", "columns": ["Series / characteristic", "Matched months", str(year_a) + " mean", str(year_b) + " mean"],
             "rows": detail, "widths": [1.5, 2, 1.2, 1.2],
             "caption": "The two means use the same calendar-month set with equal month weights. "
                        "A calendar month does not imply continuous daily coverage."}
        ]],
        ["Complete original analytical series", [
            {"kind": "table", "columns": ["Series / full identity", "Station / project", "Characteristic / unit",
                                        "Method / context", "Fraction / specification / value type"],
             "rows": series_rows, "widths": [1, 1, 1.2, 1.2, 1.4],
             "caption": "Each label maps to exactly one retained analytical series. Empty source fields remain empty; "
                        "no method, unit, project or station is inferred. Full original strings remain in the downloadable JSON and CSV."}
        ]],
        ["Original calendar coverage", [
            {"kind": "table", "columns": ["Year", "Activities", "Result IDs", "Observed months", "Last observation"],
             "rows": annual, "widths": [.5, .65, .65, 3, 1.1],
             "caption": "Original irregular grab-sampling dates, not an assumed monthly sampling programme."},
            "Every original station and source project remains a separate analytical identity. "
            "A project or series observed in one year remains in this source inventory without an invented year-pair comparison."
        ]],
        ["Interpretation and source screen", [
            "Quantified values remain points. Below-limit results keep their retained lower bound "
            "and open reporting-limit upper bound. Above-limit results retain an open lower bound and unbounded upper endpoint. "
            "No individual result is assigned zero, half a limit or a fitted value.",
            "Different methods, units, fractions, specifications, projects and value types are never pooled. "
            "Arithmetic pH summaries describe reported pH values; they are not mean hydrogen-ion concentrations. "
            "These grab samples do not establish annual mass loads, a cause of change, regulatory compliance or a population trend.",
            f"The original source screen excludes {len(exclusions)} activity-measurement group(s) from numerical matching. "
            "Their original values and source selectors remain in the desk and CSV. A month with an excluded or "
            "conflicting measurement is omitted from the complete-month match instead of being silently treated as complete.",
            *[f"{item['date']} / {item['activity']}: {item['exclusion']}. "
              f"Original result IDs: {', '.join(item['original_result_ids'])}." for item in exclusions],
            "For future review, use the same selected analytical series and same calendar months, retain the original "
            "result IDs and reporting limits, and examine exact dates and support before interpreting a difference."
        ]],
        ["Open the complete working evidence", [
            {"kind": "links", "items": [
                {"title": "Offline comparable-period desk and original-row inspector", "path": "index.html"},
                {"title": "Every year-pair comparison", "path": "comparisons.csv"},
                {"title": "Complete monthly support ledger", "path": "monthly-support.csv"},
                {"title": "Exact original result index", "path": "originals/" + index_name},
                {"title": "Structured arithmetic and complete source selectors", "path": "comparability.json"}]}
        ]]
    ]


def _csv(path: Path, fields: list[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            values = {}
            for key in fields:
                value = row.get(key)
                if isinstance(value, dict) and "text" in value:
                    value = value["text"]
                elif isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                values[key] = value
            writer.writerow(values)


def write(application: Path, output: Path, *, index_name: str = INDEX,
          year_a: int = 2025, year_b: int = 2026,
          title: str | None = None, source_prefix: str | None = None) -> dict[str, Any]:
    application, output = application.resolve(strict=True), output.resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Choose an empty output directory to preserve a previous source edition")
    if year_a >= year_b:
        raise ValueError("Choose an earlier year A and later year B")
    rows, originals = load_index(application, index_name)
    data = build(rows)
    if year_a not in data["years"] or year_b not in data["years"]:
        raise ValueError("Selected years are not present in the original source")
    data["default_comparison"] = {"year_a": year_a, "year_b": year_b}
    data["presentation"] = presentation(data, index_name, title=title, source_prefix=source_prefix)
    output.mkdir(parents=True, exist_ok=True)
    retained = []
    for name in originals:
        source = member(application, name)
        target = output / "originals" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        retained.append(identity(target, output))
    data["original_inputs"] = retained
    for name in ("observation_comparability.py", "observation_comparability.html"):
        source = Path(__file__).with_name(name)
        target = output / "producer" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    data["producer"] = [identity(path, output) for path in sorted((output / "producer").iterdir())]
    data["edition_id"] = hashlib.sha256(canonical({
        "original_inputs": retained, "producer": data["producer"],
        "presentation": data["presentation"], "default_comparison": data["default_comparison"],
    })).hexdigest()
    (output / "comparability.json").write_bytes(canonical(data))
    selected_sections = sections(data, year_a, year_b)
    template = Path(__file__).with_suffix(".html").read_text(encoding="utf-8")
    embedded = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    embedded = embedded.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    (output / "index.html").write_text(template.replace("__COMPARABILITY_DATA__", embedded), encoding="utf-8")
    _csv(output / "comparisons.csv", ["id", *SERIES_FIELDS, "year_a", "year_b", "common_months",
         "activities_a", "activities_b", "original_rows_a", "original_rows_b", "censored_activities_a",
         "censored_activities_b", "matched_mean_a", "matched_mean_b", "change", "direction",
         "unmatched_months_a", "unmatched_months_b", "excluded_activities_a", "excluded_activities_b",
         "observed_period_mean_a", "observed_period_mean_b", "measurement_ids_a", "measurement_ids_b"], data["comparisons"])
    _csv(output / "monthly-support.csv", ["series_id", *SERIES_FIELDS, "year", "month", "activities",
         "admitted_activities", "original_rows", "censored_activities", "complete_source_support", "mean", "measurement_ids"], data["month_cells"])
    _csv(output / "activity-measurements.csv", ["id", "series_id", "activity", "date", "original_result_ids",
         "original_rows", "included", "exclusion", "censoring", "interval"], data["measurements"])
    inputs = [identity(path, output) for path in sorted(output.rglob("*")) if path.is_file()]
    fingerprint = hashlib.sha256(canonical({"inputs": inputs, "selection": data["default_comparison"]})).hexdigest()
    recipe = {"schema": "upstate.observed-report/v1", "title": data["presentation"]["title"],
              "edition": VERSION + "/" + fingerprint[:20], "period": data["period"],
              "inputs": inputs, "sections": selected_sections,
              "source_links": ["index.html", "comparability.json", "comparisons.csv", "monthly-support.csv",
                               "activity-measurements.csv", "originals/" + index_name]}
    recipe_path = output / "observed-report.json"
    recipe_path.write_bytes(canonical(recipe))
    source_id = data["presentation"]["source_prefix"] + "-" + fingerprint[:20]
    manifest = {"schema": "upstate.sources/v1", "title": recipe["title"], "entries": [{
        "id": source_id, "title": recipe["title"], "kind": "document", **identity(recipe_path, output),
        "uri": (data["presentation"]["source_uris"] or [member(application, index_name).as_uri()])[0],
        "vintage": data["presentation"]["source_vintage"],
        "metadata": {"report_schema": recipe["schema"], "context_layer": True,
                     "observation_kind": "comparable_observed_periods", "source_kind": SCHEMA,
                     "original_result_count": len(rows), "basis": "equal-activity within equal common-month weights",
                     "default_comparison": data["default_comparison"],
                     "cohort": data["presentation"]},
        "companions": inputs}]} 
    (output / "model-sources.json").write_bytes(canonical(manifest))
    return {"source_id": source_id, "manifest": str(output / "model-sources.json"),
            "counts": data["counts"], "fingerprint": fingerprint, "period": data["period"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--index", default=INDEX)
    parser.add_argument("--year-a", type=int, default=2025)
    parser.add_argument("--year-b", type=int, default=2026)
    parser.add_argument("--title", help="Optional report title; original analytical identities remain unchanged")
    parser.add_argument("--source-prefix", help="Optional stable lowercase source family name; complete inputs still bind each edition")
    args = parser.parse_args(argv)
    result = write(args.application, args.output, index_name=args.index, year_a=args.year_a, year_b=args.year_b,
                   title=args.title, source_prefix=args.source_prefix)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
