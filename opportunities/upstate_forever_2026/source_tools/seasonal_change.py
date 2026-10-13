"""Build an offline, source-bound seasonal concentration-change study.

This is an interval enclosure of a descriptive seasonal median-pair slope,
not a Kendall significance test. No concentrations are substituted for limits.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import tempfile
from collections import Counter, defaultdict
from datetime import date
from typing import Any

VERSION = "upstate.seasonal-concentration-change/v1"
GROUP_FIELDS = ("utility_id", "station_id", "method_context", "method", "unit")
REQUIRED = {*GROUP_FIELDS, "source_file", "source_row", "activity_id", "activity_type",
            "date", "year", "month", "status", "lower", "upper", "upper_unbounded",
            "source_comment_flags", "source_result_comment"}
MODES = {"all_routine": "All routine records", "without_information_only": "Exclude Information Only comments"}
METHOD_URL = "https://pubs.usgs.gov/publication/70011649"
METHOD_NOTES = [
    "Keep utility, station, method authority, method code and reported physical unit separate. Use only original routine activities within the selected calendar years. Retain every excluded or uninterpretable source record in the package.",
    "Use one median interval per station/method/year/month. Each activity receives equal weight inside its cell. Median bounds are the median of the lower endpoints and the median of the upper endpoints. Missing bounds are never assigned a concentration.",
    "For every two observed years in the same calendar month, compute [(later lower - earlier upper)/elapsed years, (later upper - earlier lower)/elapsed years]. The seasonal slope enclosure is the median of all lower slopes through the median of all upper slopes. All available month-pairs receive equal weight; well-observed months supply more pairs.",
    "These endpoint-wise median bounds conservatively enclose the descriptive median-pair slope for every concentration allowed by the reported intervals. Shared observations mean the interval is not necessarily sharp. It is a censoring enclosure, not a sampling confidence interval or a significance test.",
    "The balanced-calendar sensitivity retains only months with usable cells in every usable year of that same station/method series. Every retained month then contributes the same number of pairs. A separate sensitivity omits each year in turn, without filling missing months.",
    "The comment sensitivity excludes only the original information_only flag, matching the retained source study. Power-interruption and other-analyte comments remain visible. A changed slope reflects a changed sample selection, not an automatic judgment of laboratory validity.",
    "Positive and negative bounds describe the direction of these selected sampled concentrations. They do not identify a discharge-adjusted trend, catchment-wide condition, a cause, regulatory exceedance or treatment effectiveness. Five observed years and changing sampling support should be read beside the original calendar study.",
]


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def json_text(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json_text(obj), encoding="utf-8")


def number(value: float | None) -> float | str | None:
    if value is None:
        return None
    if math.isinf(value):
        return "-Infinity" if value < 0 else "Infinity"
    if not math.isfinite(value):
        raise ValueError("Undefined statistical result")
    return value


def as_float(value: Any) -> float:
    return float(value)


def csv_write(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="raise")
        writer.writeheader()
        for row in rows:
            values = {}
            for key in fields:
                value = row.get(key)
                if isinstance(value, (list, dict)):
                    value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                # Source-preserving originals are separate. Derived text exports
                # are safe to open in spreadsheet applications.
                if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                    value = "'" + value
                values[key] = value
            writer.writerow(values)


def read_records(path: Path, first: int, last: int) -> tuple[list[dict], list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        absent = REQUIRED.difference(reader.fieldnames or [])
        if absent:
            raise ValueError("Missing source columns: " + ", ".join(sorted(absent)))
        records = list(reader)
    seen_sources, seen_activities = set(), set()
    for index, row in enumerate(records):
        origin = (row["source_file"], row["source_row"])
        if origin in seen_sources:
            raise ValueError("Repeated original source identity: " + repr(origin))
        seen_sources.add(origin)
        row["record_id"] = "r" + str(index + 1)
        row["flags"] = json.loads(row["source_comment_flags"])
        if not isinstance(row["flags"], list) or not all(isinstance(x, str) for x in row["flags"]):
            raise ValueError("Invalid source comment flags at " + str(origin))
        dt = date.fromisoformat(row["date"])
        if int(row["year"]) != dt.year or int(row["month"]) != dt.month:
            raise ValueError("Source date/year/month disagree at " + str(origin))
        row["year"], row["month"] = dt.year, dt.month
        row["included"] = row["activity_type"] == "Sample-Routine" and first <= dt.year <= last
        row["exclusion"] = "" if row["included"] else ("Non-routine activity" if row["activity_type"] != "Sample-Routine" else "Outside selected years")
        if row["included"]:
            identity = tuple(row[k] for k in GROUP_FIELDS) + (row["activity_id"],)
            if identity in seen_activities:
                raise ValueError("Repeated activity within one analytical series: " + repr(identity))
            seen_activities.add(identity)
        if row["upper_unbounded"] not in ("true", "false"):
            raise ValueError("Invalid unbounded flag at " + str(origin))
        if row["lower"] == "" and row["upper"] == "" and row["upper_unbounded"] == "false":
            row["lo"], row["hi"] = None, None
        else:
            lo = float(row["lower"])
            if row["upper_unbounded"] == "true":
                if row["upper"] != "":
                    raise ValueError("Unbounded interval has a numerical upper endpoint")
                hi = math.inf
            else:
                hi = float(row["upper"])
            if not math.isfinite(lo) or lo < 0 or math.isnan(hi) or hi < lo or hi == -math.inf:
                raise ValueError("Invalid concentration interval at " + str(origin))
            row["lo"], row["hi"] = lo, number(hi)
    return records, [r for r in records if r["included"]]


def retain_publisher(root: Path, destination: Path, records: list[dict]) -> dict:
    """Retain hash-bound publisher files and join exact original CSV row identities."""
    root = root.resolve(strict=True)
    registry_path = root / "source-inputs.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    source_rows = {}
    for entry in registry["sources"]:
        relative = Path(entry["path"])
        original = (root / relative).resolve(strict=True)
        if relative.is_absolute() or not original.is_relative_to(root):
            raise ValueError("Publisher source path escapes its retained edition")
        if sha(original) != entry["sha256"] or original.stat().st_size != entry["bytes"]:
            raise ValueError("Publisher source differs from its original registry: " + str(relative))
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        if str(relative) in {r["source_file"] for r in records}:
            with original.open(encoding="utf-8-sig", newline="") as stream:
                source_rows[str(relative)] = list(csv.DictReader(stream))
    shutil.copyfile(registry_path, destination / "source-inputs.json")
    for record in records:
        index = int(record["source_row"]) - 2
        if index < 0 or record["source_file"] not in source_rows:
            raise ValueError("Original publisher row is unavailable: " + record["record_id"])
        try:
            original = source_rows[record["source_file"]][index]
        except IndexError as error:
            raise ValueError("Original publisher row lies beyond its source") from error
        if (original["ActivityIdentifier"] != record["activity_id"] or
            original["MonitoringLocationIdentifier"] != record["station_id"]):
            raise ValueError("Publisher/interval source identities differ at " + record["record_id"])
        record["publisher_path"] = "inputs/publisher/" + record["source_file"]
        # Empty fields remain in the exact CSV. The inspector names this compact
        # view explicitly, rather than concealing or replacing their originals.
        record["publisher_nonblank_fields"] = {k:v for k,v in original.items() if v != ""}
    return {"registry_sha256": sha(registry_path), "retained_files": len(registry["sources"]),
            "matched_original_rows": len(records)}


def direction(lo: float | None, hi: float | None) -> str:
    if lo is None:
        return "No comparison"
    if lo > 0:
        return "Upward"
    if hi < 0:
        return "Downward"
    return "Includes zero"


def summarize(cells: list[dict], balanced: bool = False) -> tuple[dict, list[dict]]:
    years = sorted({c["year"] for c in cells})
    months = sorted({c["month"] for c in cells})
    if balanced:
        months = [m for m in months if {c["year"] for c in cells if c["month"] == m} == set(years)]
    pairs = []
    for month in months:
        same = sorted((c for c in cells if c["month"] == month), key=lambda c: c["year"])
        for earlier, later in itertools.combinations(same, 2):
            dt = later["year"] - earlier["year"]
            lower = (later["lower"] - as_float(earlier["upper"])) / dt
            upper = (as_float(later["upper"]) - earlier["lower"]) / dt
            pairs.append({"earlier_cell": earlier["cell_id"], "later_cell": later["cell_id"],
                          "month": month, "earlier_year": earlier["year"], "later_year": later["year"],
                          "elapsed_years": dt, "lower": number(lower), "upper": number(upper)})
    lower = statistics.median(as_float(p["lower"]) for p in pairs) if pairs else None
    upper = statistics.median(as_float(p["upper"]) for p in pairs) if pairs else None
    paired_months = sorted({p["month"] for p in pairs})
    return {"years": years, "months": paired_months, "pair_count": len(pairs),
            "lower": number(lower), "upper": number(upper),
            "direction": direction(lower, upper), "cell_count": len(cells),
            "year_span": years[-1] - years[0] if years else 0}, pairs


def analyze(records: list[dict]) -> dict:
    grouped = defaultdict(list)
    for row in records:
        if row["included"]:
            grouped[tuple(row[k] for k in GROUP_FIELDS)].append(row)
    groups, monthly, all_pairs, sensitivity = [], [], [], []
    for key, rows in sorted(grouped.items()):
        gid = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:12]
        group = {"group_id": gid, **dict(zip(GROUP_FIELDS, key)), "record_ids": [r["record_id"] for r in rows], "variants": {}}
        for mode in MODES:
            selected = [r for r in rows if mode == "all_routine" or "information_only" not in r["flags"]]
            cell_rows = defaultdict(list)
            for row in selected:
                if row["lo"] is not None:
                    cell_rows[(row["year"], row["month"])].append(row)
            cells = []
            for (year, month), values in sorted(cell_rows.items()):
                cell = {"group_id": gid, "mode": mode, "cell_id": f"{gid}:{mode}:{year}-{month:02}",
                        "year": year, "month": month, "activities": len(values),
                        "lower": statistics.median(v["lo"] for v in values),
                        "upper": number(statistics.median(as_float(v["hi"]) for v in values)),
                        "censored_activities": sum(v["status"] != "measured" for v in values),
                        "record_ids": [v["record_id"] for v in values]}
                cells.append(cell)
            monthly.extend(cells)
            summary, pairs = summarize(cells)
            balanced, balanced_pairs = summarize(cells, True)
            for panel, ps in (("available_months", pairs), ("balanced_months", balanced_pairs)):
                all_pairs.extend({"group_id": gid, "mode": mode, "panel": panel, **p} for p in ps)
            leaves = []
            for year in summary["years"]:
                leave, _ = summarize([c for c in cells if c["year"] != year])
                item = {"group_id": gid, "mode": mode, "omitted_year": year, **leave}
                leaves.append(item)
                sensitivity.append(item)
            stable = (len(summary["years"]) >= 3 and summary["direction"] in ("Upward", "Downward")
                      and all(x["direction"] == summary["direction"] for x in leaves))
            group["variants"][mode] = {"records": len(selected), "interval_records": sum(r["lo"] is not None for r in selected),
                "excluded_information_only": len(rows) - len(selected), "missing_interval": sum(r["lo"] is None for r in selected),
                "cells": [c["cell_id"] for c in cells], "seasonal": summary, "balanced": balanced,
                "leave_one_year_out": leaves, "same_direction_after_each_year_omission": stable}
        groups.append(group)
    return {"groups": groups, "monthly": monthly, "pairs": all_pairs, "sensitivity": sensitivity}


def printable(value: Any) -> str:
    if value is None:
        return "No estimate"
    if isinstance(value, str):
        return {"-Infinity": "unbounded below", "Infinity": "unbounded above"}.get(value, value)
    return f"{value:.6g}"


def flat_summaries(data: dict) -> list[dict]:
    rows = []
    for g in data["groups"]:
        for mode, v in g["variants"].items():
            for panel in ("seasonal", "balanced"):
                rows.append({"group_id": g["group_id"], **{k:g[k] for k in GROUP_FIELDS}, "mode": mode, "panel": panel,
                             "records": v["records"], "interval_records": v["interval_records"],
                             **v[panel], "same_direction_after_each_year_omission": v["same_direction_after_each_year_omission"] if panel == "seasonal" else None})
    return rows


def build(args: argparse.Namespace) -> dict:
    source = args.input.resolve(strict=True)
    template = Path(__file__).with_name("seasonal_view.html").resolve(strict=True)
    if args.last_year < args.first_year:
        raise ValueError("Last year must not precede first year")
    source_sha = sha(source)
    if args.sha256 and source_sha != args.sha256:
        raise ValueError("Selected original source bytes differ from requested SHA-256")
    identity = {"schema": VERSION, "source_sha256": source_sha, "first_year": args.first_year,
                "last_year": args.last_year, "project_id": args.project_id, "edition": args.edition,
                "producer_sha256": sha(Path(__file__)), "template_sha256": sha(template),
                "publisher_registry_sha256": sha(args.publisher_root / "source-inputs.json") if args.publisher_root else None}
    output = args.output.resolve()
    if output.exists():
        manifest = json.loads((output / "manifest.json").read_text())
        if manifest["build_identity"] != identity:
            raise ValueError("Output already belongs to a different source/producer edition")
        for member in manifest["files"]:
            if sha(output/member["path"]) != member["sha256"]:
                raise ValueError("Retained output changed: " + member["path"])
        return {"state": "reused", "output": str(output), **manifest["summary"]}
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = output.with_name(output.name + ".lock")
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    staging = Path(tempfile.mkdtemp(prefix=output.name + ".building-", dir=output.parent))
    try:
        records, routine = read_records(source, args.first_year, args.last_year)
        if any(r["unit"] != "MPN per 100 mL" for r in routine):
            raise ValueError("This E. coli report requires the retained MPN per 100 mL physical unit")
        data = analyze(records)
        (staging / "inputs").mkdir()
        shutil.copyfile(source, staging / "inputs/record-intervals.csv")
        publisher = retain_publisher(args.publisher_root, staging / "inputs/publisher", records) if args.publisher_root else None
        (staging / "source").mkdir()
        for path in (Path(__file__), template, Path(__file__).with_name("SEASONAL_CHANGE.md")):
            if path.is_file():
                shutil.copyfile(path, staging / "source" / path.name)
        summary = {"original_records": len(records), "routine_records": len(routine),
                   "interval_records": sum(r["lo"] is not None for r in routine),
                   "series": len(data["groups"]), "status_counts": dict(Counter(r["status"] for r in routine)),
                   "direction_counts": dict(Counter(g["variants"]["all_routine"]["seasonal"]["direction"] for g in data["groups"])),
                   "same_direction_after_each_year_omission": sum(g["variants"]["all_routine"]["same_direction_after_each_year_omission"] for g in data["groups"]),
                   "paired_series": sum(g["variants"]["all_routine"]["seasonal"]["pair_count"] > 0 for g in data["groups"])}
        data.update({"schema": VERSION, "build_identity": identity, "summary": summary, "methods": METHOD_NOTES,
                     "method_reference": METHOD_URL, "records": records, "publisher": publisher})
        write_json(staging / "data/analysis.json", data)
        flat = flat_summaries(data)
        csv_write(staging / "data/series-slopes.csv", flat, list(flat[0]) if flat else ["group_id"])
        for name, rows in (("monthly-cells",data["monthly"]), ("same-month-pairs",data["pairs"]), ("year-omission",data["sensitivity"])):
            csv_write(staging / f"data/{name}.csv", rows, list(rows[0]) if rows else ["group_id"])
        exclusions = [{"record_id":r["record_id"],"source_file":r["source_file"],"source_row":r["source_row"],
                       "activity_id":r["activity_id"],"reason":r["exclusion"] or "No interpretable concentration interval"}
                      for r in records if not r["included"] or r["lo"] is None]
        csv_write(staging / "data/exclusions.csv", exclusions, ["record_id","source_file","source_row","activity_id","reason"])
        payload = json.dumps(data,ensure_ascii=False,separators=(",", ":"),allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        (staging / "index.html").write_text(template.read_text().replace("__STUDY_PAYLOAD__", payload), encoding="utf-8")
        period=f"{args.first_year}-{args.last_year}"
        table = []
        for g in data["groups"]:
            v=g["variants"]["all_routine"];s=v["seasonal"]
            table.append([g["station_id"],g["method_context"]+" "+g["method"],
                          len(s["years"]),s["pair_count"],printable(s["lower"]),printable(s["upper"]),s["direction"]])
        calendar_changes = []
        for g in data["groups"]:
            v = g["variants"]["all_routine"]
            a, b = v["seasonal"], v["balanced"]
            if a["direction"] in ("Upward", "Downward") and b["direction"] in ("Upward", "Downward") and a["direction"] != b["direction"]:
                calendar_changes.append([g["station_id"], printable(a["lower"])+" to "+printable(a["upper"]),
                                         printable(b["lower"])+" to "+printable(b["upper"]), b["pair_count"]])
        sections = [
            ["Source and seasonal comparison",[
                f"The complete original {len(records)}-record source supplies {len(routine)} routine activities and {summary['interval_records']} interpretable concentration intervals for {period}. The {summary['series']} exact station/method series are kept separate.",
                f"{summary['paired_series']} series have at least one same-calendar-month comparison across years. Directions within the censoring enclosures: " + ", ".join(f"{v} {k.lower()}" for k,v in sorted(summary['direction_counts'].items())) + ".",
                f"{summary['same_direction_after_each_year_omission']} series retain their nonzero enclosure direction after every individual year is omitted. Inspect the original month support, available-pair count and comment sensitivity before using any series for follow-up.",
                "Use index.html to select a station, change the original-comment selection, compare the balanced calendar, inspect each monthly interval and open its unchanged original record. All derived tables and the complete original CSV travel with this report."]],
            ["Calendar balance changes the interpretation",[
                f"{len(calendar_changes)} series reverse their nonzero enclosure direction when the selection is restricted to months present in every usable year. This compares two explicit sampling calendars on the same original series.",
                {"kind":"table","columns":["Original station","All available months","Balanced months","Balanced pairs"],"rows":calendar_changes,"widths":[.32,.25,.25,.18]},
                "For subsequent study editions, retain a repeatable station/method/month panel and review the calendar beside the sampled concentration change. The full explorer identifies the months and individual activities behind each estimate."]],
            ["Complete station/method results",[{"kind":"table","columns":["Original station","Method","Years","Pairs","Lower slope","Upper slope","Direction"],"rows":table,"widths":[.28,.12,.08,.08,.13,.13,.18]},
                "Slope units: MPN per 100 mL per calendar year. Bounds represent allowed reported censoring, not a confidence interval. No comparison means that no month has usable observations in two different years."]],
            ["Methods and interpretation",METHOD_NOTES + ["Method reference: Hirsch, Slack and Smith (1982), Techniques of trend analysis for monthly water quality data. " + METHOD_URL]],
            ["Original source and reuse",[f"Original retained interval file SHA-256: {source_sha}",
                f"Original scientific project: {args.project_id}. Source edition: {args.edition}.",
                "The supplied source manifest imports this complete observed report into the maintained Sources / Review retained reports workflow. Existing calendar, first/last-year comparisons, laboratory definitions and native monitoring plans are preserved as separate original products."]],
        ]
        members = [{"path":str(p.relative_to(staging)),"sha256":sha(p),"bytes":p.stat().st_size} for p in sorted(staging.rglob("*")) if p.is_file()]
        report={"schema":"upstate.observed-report/v1","project_id":args.project_id,
                "title":f"Upper Savannah: all-year seasonal concentration change, {period}",
                "basis":identity,"sections":sections,"inputs":members,
                "source_links":["index.html","data/series-slopes.csv","data/monthly-cells.csv","data/year-omission.csv","inputs/record-intervals.csv"]}
        write_json(staging / "observed-report.json",report)
        sid="ecoli-seasonal-change-"+hashlib.sha256(json_text(identity).encode()).hexdigest()[:16]
        manifest={"schema":"upstate.sources/v1","title":report["title"],"captured_at":args.edition,"entries":[{
            "id":sid,"kind":"document","title":report["title"],"path":"observed-report.json","sha256":sha(staging/"observed-report.json"),
            "vintage":args.edition,"uri":"urn:commons:project:"+args.project_id+":"+sid,
            "metadata":{"project_id":args.project_id,"report_schema":"upstate.observed-report/v1"},
            "companions":[{"path":m["path"],"sha256":m["sha256"]} for m in members]}]}
        write_json(staging / "seasonal-change.sources.json",manifest)
        all_members=[{"path":str(p.relative_to(staging)),"sha256":sha(p),"bytes":p.stat().st_size} for p in sorted(staging.rglob("*")) if p.is_file()]
        write_json(staging / "manifest.json",{"schema":VERSION,"build_identity":identity,"summary":summary,"files":all_members})
        if output.exists():
            raise FileExistsError(output)
        staging.rename(output)
        return {"state":"complete","output":str(output),"source_id":sid,**summary}
    finally:
        lock.unlink(missing_ok=True)
        # A failed staging directory is deliberately retained for recovery.


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",type=Path,required=True,help="Original retained record-intervals.csv")
    parser.add_argument("--output",type=Path,required=True,help="New immutable study directory")
    parser.add_argument("--publisher-root",type=Path,help="Original utility E. coli source edition with source-inputs.json and raw files")
    parser.add_argument("--first-year",type=int,default=2021)
    parser.add_argument("--last-year",type=int,default=2025)
    parser.add_argument("--project-id",required=True)
    parser.add_argument("--edition",required=True)
    parser.add_argument("--sha256",help="Expected original source SHA-256")
    args=parser.parse_args()
    date.fromisoformat(args.edition)
    print(json_text(build(args)))

if __name__ == "__main__":
    main()
