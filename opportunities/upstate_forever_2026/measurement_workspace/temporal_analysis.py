"""Source-preserving, month-matched change analysis for the original workbench.

This module adds descriptive interval/Sen support calculations. It does not
substitute values for censored observations or assign sampling p-values.
The command line and the native operator use the same engine and saved format.
"""
from __future__ import annotations

import argparse
import base64
import calendar
import gzip
from collections import Counter, defaultdict
import csv
from datetime import date
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import statistics
import tempfile
from typing import Any
import zipfile

VERSION = "1.2.0"
SCHEMA = "upstate.temporal-analysis/v1"
BASE = Path(__file__).resolve().parents[1]
DATASETS = {
    "sv833": {"title": "Three and Twenty Creek: SV-833", "kind": "water_quality",
              "table": "observations/sv833_2021_2026/activity-characteristic-measurements.csv",
              "manifest": "observations/sv833_2021_2026/input-manifest.json"},
    "streams": {"title": "Eighteenmile: four stream nutrient stations", "kind": "water_quality",
                "table": "observations/eighteenmile_stream_nutrients_2020_2025/analysis/source-result-index.csv",
                "manifest": "observations/eighteenmile_stream_nutrients_2020_2025/analysis/input-manifest.json"},
    "microbial": {"title": "Utility catchments: microbial monitoring", "kind": "water_quality",
                  "table": "source/ecoli_temporal_analysis/20261013/record-intervals.csv",
                  "manifest": "source/ecoli_temporal_analysis/20261013/source-manifest.json"},
    "flow": {"title": "Six-year observed discharge: 16 USGS gauges", "kind": "daily_flow",
             "table": "observations/observed_hydrology_20261013/derived/daily_flow.csv",
             "manifest": "observations/observed_hydrology_20261013/inputs.json"},
}
DATASETS['workspace'] = {'title': 'Imported scientist measurements', 'kind': 'water_quality',
    'table': 'source/temporal-workspace-observations/records.json',
    'manifest': 'source/temporal-workspace-observations/manifest.json'}
DEFAULT = {"title": "Upper Savannah: season-matched monitoring change", "datasets": ["sv833", "streams", "microbial", "flow"],
           "start_date": None, "end_date": None, "stations": [], "parameters": [],
           "months": list(range(1, 13)), "exclude_information_only": True,
           "approved_flow_only": True, "exclude_estimated_flow": False,
           "minimum_flow_month_coverage": 1.0, "separate_projects": False}
DIMENSIONS = ("dataset", "station", "parameter", "unit", "fraction", "speciation",
              "method_authority", "method", "depth", "depth_unit", "value_type",
              "weight_basis", "time_basis", "temperature_basis", "particle_size_basis")
METHODS = {
    "estimand": "Change in observed monthly medians within the same original station and analytical cohort.",
    "aggregation": "Agreeing repeated results with the same retained source activity identifier count once. Where no source activity identifier was selected, each explicitly labeled original-record fallback remains a distinct record identity, not a proven sampling visit. These identifiers in the same calendar month contribute to an interval median; each resulting month-year is one value.",
    "censoring": "Original interval endpoints are retained with a conservative closed-endpoint envelope. Monthly median bounds are medians of lower and upper endpoints. No reporting-limit substitution is used.",
    "seasonal_pairs": "Compare month-year medians only with the same calendar month in another year. For each pair divide the possible difference by the integer difference in calendar years. The medians of all lower and upper pair slopes enclose the possible season-matched Sen slope.",
    "score": "Each pair contributes an interval containing every feasible sign of its later-minus-earlier difference. Summed score bounds divided by the number of compared pairs give conservative seasonal ordering support. These are support bounds, not sampling confidence intervals or a significance test.",
    "coverage": "The common-month calculation uses only calendar months observed in every selected year of that cohort. Daily-flow months must satisfy the explicit original-date coverage fraction; default 100 percent.",
    "sensitivity": "Leave one observed year out and repeat the month-matched calculation. This identifies dependence on a particular year without deleting it from the original result.",
    "interpretation": "Changes describe sampled conditions and the selected record period. Method, unit, fraction, speciation, depth and reported-versus-calculated value remain separate. Programme identifiers are retained; optionally require the same programme. No catchment load is calculated from grab samples or daily means.",
    "original_analytical_context": "Imported original chemical basis, solids basis, method name, sampling-depth values and references, microbial-count method, turbidity scale and conductivity temperature correction remain separate source-specific cohorts. Declared nulls and independent source namespaces are retained. No measured value, source ID or review state is used to split these cohorts. Legacy records without extra context keep their original cohort identity.",
    "sources": [
        {"title": "Hirsch, Slack and Smith (1982), Techniques of trend analysis for monthly water quality data", "url": "https://pubs.usgs.gov/publication/70011649", "use": "Same-calendar-season comparison and slope; seasonality, missingness and serial correlation considerations."},
        {"title": "Schertz, Alexander and Ohe (1991), ESTREND", "url": "https://pubs.usgs.gov/publication/wri914040", "use": "Distinguishing censoring patterns and statistical assumptions in multi-station trend analysis."}
    ],
    "derivation": "For interval x_i=[L_i,U_i], a monotone order statistic lies between the corresponding order statistics of L and U. For y_j>y_i, pair slope lies in [(L_j-U_i)/(y_j-y_i),(U_j-L_i)/(y_j-y_i)]. Taking the median of each bound preserves an enclosure. Shared observations may make individual pair extrema incompatible, so the envelope is conservative. No probabilistic claim is attached."
}


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def clean(value: Any) -> Any:
    """JSON has no infinities: null endpoints are accompanied by explicit flags."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    return value


def checked_selection(value: dict | None = None) -> dict:
    if value is not None and not isinstance(value, dict):
        raise ValueError("An analysis selection must be an object.")
    supplied = value or {}
    if set(supplied) - set(DEFAULT):
        raise ValueError("Unknown analysis controls: " + ", ".join(sorted(set(supplied) - set(DEFAULT))))
    out = {**DEFAULT, **supplied}
    if not isinstance(out["title"], str) or not out["title"].strip() or len(out["title"]) > 200:
        raise ValueError("Enter a title of 1 to 200 characters.")
    out["title"] = out["title"].strip()
    for name in ("datasets", "stations", "parameters", "months"):
        if not isinstance(out[name], list) or len(out[name]) != len(set(out[name])):
            raise ValueError(name + " must be a list of distinct selections.")
    if not out["datasets"] or set(out["datasets"]) - set(DATASETS):
        raise ValueError("Choose at least one installed monitoring source.")
    if not out["months"] or any(type(x) is not int or x not in range(1, 13) for x in out["months"]):
        raise ValueError("Choose at least one calendar month, from 1 to 12.")
    for name in ("stations", "parameters"):
        if any(not isinstance(x, str) or not x for x in out[name]):
            raise ValueError(name + " requires nonempty text identifiers.")
    for name in ("start_date", "end_date"):
        if out[name] in (None, ""):
            out[name] = None
        elif not isinstance(out[name], str) or date.fromisoformat(out[name]).isoformat() != out[name]:
            raise ValueError("Use ISO calendar dates: YYYY-MM-DD.")
    if out["start_date"] and out["end_date"] and out["start_date"] > out["end_date"]:
        raise ValueError("The start date must not be after the end date.")
    for name in ("exclude_information_only", "approved_flow_only", "exclude_estimated_flow", "separate_projects"):
        if type(out[name]) is not bool:
            raise ValueError(name + " must be true or false.")
    coverage = out["minimum_flow_month_coverage"]
    if isinstance(coverage, bool) or not isinstance(coverage, (int, float)) or not 0 < coverage <= 1:
        raise ValueError("Flow month coverage must be greater than zero and at most one.")
    out["datasets"] = [k for k in DATASETS if k in out["datasets"]]
    out["months"] = sorted(out["months"])
    out["stations"] = sorted(out["stations"])
    out["parameters"] = sorted(out["parameters"])
    return out


class Sources:
    """Capture original inputs once, without changing the maintained application."""
    def __init__(self, application: Path):
        self.root = application.resolve(strict=True)
        self.data: dict[str, bytes] = {}
        self.metadata: dict[str, dict] = {}
        self.csv_cache: dict[str, list] = {}

    def path(self, name: str, relative_to: str = "") -> str:
        path = (self.root / relative_to / name).resolve(strict=True)
        if not path.is_relative_to(self.root) or not path.is_file():
            raise ValueError("Source must be a file in the maintained application: " + name)
        return path.relative_to(self.root).as_posix()

    def read(self, name: str, descriptor: dict | None = None, relative_to: str = "") -> bytes:
        key = self.path(name, relative_to)
        if key not in self.data:
            self.data[key] = (self.root / key).read_bytes()
            self.metadata[key] = {"path": key, "bytes": len(self.data[key]), "sha256": sha(self.data[key])}
        raw = self.data[key]
        if descriptor:
            if descriptor.get("bytes") is not None and len(raw) != descriptor["bytes"]:
                raise ValueError("Original source size differs: " + key)
            if descriptor.get("sha256") and sha(raw) != descriptor["sha256"]:
                raise ValueError("Original source hash differs: " + key)
            self.metadata[key].update({k: descriptor[k] for k in ("role", "uri", "url", "source_url", "id") if k in descriptor})
        return raw

    def json(self, name: str, descriptor: dict | None = None, relative_to: str = "") -> Any:
        return json.loads(self.read(name, descriptor, relative_to))

    def csv(self, name: str) -> list[dict]:
        key = self.path(name)
        if key not in self.csv_cache:
            reader = csv.DictReader(io.StringIO(self.read(key).decode("utf-8-sig"), newline=""))
            if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise ValueError("Source CSV needs distinct named columns: " + key)
            rows = list(reader)
            if any(None in row or any(v is None for v in row.values()) for row in rows):
                raise ValueError("Malformed original CSV: " + key)
            self.csv_cache[key] = rows
        return self.csv_cache[key]


def boolstr(value: Any) -> bool:
    return value is True or value == "true"


def number(value: str | float | None, default: float | None = None) -> float | None:
    if value is None or value == "":
        return default
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Non-finite numeric source value.")
    return result


def base_record(dataset: str, row: dict, index: int, path: str) -> dict:
    return {"id": sha(canonical([dataset, path, index, row]))[:24], "dataset": dataset,
            "source_table": path, "source_csv_row": index + 2, "raw": row,
            "station": "", "parameter": "", "unit": "", "fraction": "", "speciation": "",
            "method_authority": "", "method": "", "depth": "", "depth_unit": "",
            "value_type": "Actual", "weight_basis": "", "time_basis": "",
            "temperature_basis": "", "particle_size_basis": "", "project": "",
            "activity": "", "date": "", "time": "", "timezone": "", "comment": "",
            "flags": [], "qualifiers": [], "source_references": [], "eligible": True}


def source_dimensions(record: dict, raw: dict) -> None:
    mapping = {"speciation": "MethodSpecificationName", "method_authority": "ResultAnalyticalMethod/MethodIdentifierContext",
               "depth": "ActivityDepthHeightMeasure/MeasureValue", "depth_unit": "ActivityDepthHeightMeasure/MeasureUnitCode",
               "weight_basis": "ResultWeightBasisText", "time_basis": "ResultTimeBasisText",
               "temperature_basis": "ResultTemperatureBasisText", "particle_size_basis": "ResultParticleSizeBasisText"}
    for key, column in mapping.items():
        if raw.get(column):
            record[key] = raw[column]


def load_sv833(sources: Sources) -> list[dict]:
    spec = DATASETS["sv833"]
    manifest = sources.json(spec["manifest"])
    for d in manifest["files"]:
        sources.read(d["path"], d)
    index_path = "observations/sv833_2021_2026/original-result-index.csv"
    originals = sources.csv(index_path)
    # The original result index is retained whole; reference enrichment is keyed
    # by the publisher ResultIdentifier, never station/date proximity.
    id_column = next((key for key in ("result_id", "result_identifier", "ResultIdentifier") if key in originals[0]), None)
    original_map = {r[id_column]: r for r in originals} if id_column else {}
    result = []
    for i, row in enumerate(sources.csv(spec["table"])):
        r = base_record("sv833", row, i, spec["table"])
        for key, field in {"station":"station", "parameter":"characteristic", "unit":"unit", "fraction":"fraction",
                           "speciation":"speciation", "method":"method", "value_type":"value_type", "project":"project",
                           "activity":"activity", "date":"date", "time":"time", "timezone":"timezone"}.items():
            r[key] = row[field]
        r["station"] = "21SC60WQ_WQX-" + r["station"]
        r.update(lower=number(row["lower"]), upper=number(row["upper"], math.inf),
                 censored=row["censoring"] != "none", eligible=boolstr(row["analysis_eligible"]))
        r["flags"] = [row["quality_flag"]] if row["quality_flag"] else []
        ids = row["result_ids"].split(";")
        r["source_references"] = [{"publisher_result_ids": ids, "original_selectors": row["original_selectors"],
                                  "index": index_path}]
        # Source types already grouped on interval, fraction, speciation, method,
        # time and unit by the original study; retain every original ID.
        r["original_result_count"] = int(row["result_count"])
        r["original_result_records"] = [original_map[v] for v in ids if v in original_map]
        if len(r["original_result_records"]) != len(ids):
            raise ValueError("Every grouped SV-833 result must retain its exact publisher-ID index row.")
        authorities = {v.get("method_context", "") for v in r["original_result_records"]}
        if len(authorities) != 1:
            raise ValueError("Grouped SV-833 source methods have different authorities.")
        r["method_authority"] = authorities.pop()
        original = r["original_result_records"][0]
        original_cells = sources.csv(original["source_path"])[int(original["source_data_row"]) - 1]
        # Preserve the exact result-depth and physical-basis dimensions. The
        # original activity metadata is separately available by its source row.
        source_dimensions(r, original_cells)
        r["depth"] = original_cells.get("ResultDepthHeightMeasure/MeasureValue", "")
        r["depth_unit"] = original_cells.get("ResultDepthHeightMeasure/MeasureUnitCode", "")
        r["original_cells"] = original_cells
        result.append(r)
    return result


def load_streams(sources: Sources) -> list[dict]:
    spec = DATASETS["streams"]
    manifest = sources.json(spec["manifest"])
    for d in manifest["files"]:
        sources.read(d["path"], d)
    result = []
    for i, row in enumerate(sources.csv(spec["table"])):
        raw = sources.csv(row["source_path"])[int(row["source_data_row"]) - 1]
        r = base_record("streams", row, i, spec["table"])
        for key, field in {"station":"station", "parameter":"characteristic", "unit":"unit", "fraction":"fraction",
                           "method":"method", "value_type":"value_type", "project":"project", "activity":"activity",
                           "date":"date", "time":"time", "timezone":"timezone", "depth":"depth", "depth_unit":"depth_unit"}.items():
            r[key] = row[field]
        r["station"] = row["organization"] + "-" + r["station"]
        source_dimensions(r, raw)
        r.update(lower=number(row["lower"]), upper=number(row["upper"], math.inf), censored=boolstr(row["censored"]))
        r["source_references"] = [{"path": row["source_path"], "sha256": row["source_sha256"],
                                  "csv_row": int(row["source_data_row"]) + 1}]
        r["comment"] = raw.get("ResultCommentText", "")
        r["original_cells"] = raw
        result.append(r)
    return result


def load_microbial(sources: Sources) -> list[dict]:
    spec = DATASETS["microbial"]
    manifest = sources.json(spec["manifest"])
    source_root = "source/ecoli_utility_context/20261013"
    for d in manifest["original_microbiology_sources"]:
        sources.read(d["path"], d, source_root)
    for d in manifest["inputs"]:
        sources.read(d["path"], d, str(Path(spec["manifest"]).parent))
    result = []
    for i, row in enumerate(sources.csv(spec["table"])):
        source_path = source_root + "/" + row["source_file"]
        raw = sources.csv(source_path)[int(row["source_row"]) - 2]
        r = base_record("microbial", row, i, spec["table"])
        for key, field in {"station":"station_id", "unit":"unit", "method_authority":"method_context", "method":"method",
                           "activity":"activity_id", "date":"date", "time":"time", "timezone":"timezone", "comment":"source_result_comment"}.items():
            r[key] = row[field]
        r["parameter"] = "Escherichia coli"
        source_dimensions(r, raw)
        r["project"] = raw.get("ProjectIdentifier", "")
        r["fraction"] = raw.get("ResultSampleFractionText", "")
        r["value_type"] = raw.get("ResultValueTypeName", "Actual")
        r.update(lower=number(row["lower"]), upper=number(row["upper"], math.inf),
                 censored=row["status"] not in ("measured", "not_reported"),
                 eligible=boolstr(row["bounded"]) and row["activity_type"] == "Sample-Routine")
        r["flags"] = json.loads(row["source_comment_flags"])
        if row["activity_type"] != "Sample-Routine":
            r["flags"].append("non-routine activity: " + row["activity_type"])
        if not boolstr(row["bounded"]):
            r["flags"].append("no interpretable reported interval")
        r["source_references"] = [{"path": source_path, "csv_row": int(row["source_row"])}]
        r["original_cells"] = raw
        result.append(r)
    return result


def load_flow(sources: Sources) -> list[dict]:
    spec = DATASETS["flow"]
    manifest = sources.json(spec["manifest"])
    prefix = str(Path(spec["manifest"]).parent)
    result, seen = [], {}
    for descriptor in manifest["originals"]:
        if descriptor.get("role") != "daily_flow":
            continue
        path = sources.path(descriptor["path"], prefix)
        data = sources.json(path, descriptor)
        for series_index, series in enumerate(data["value"]["timeSeries"]):
            if not any(code["value"] == "00060" for code in series["variable"]["variableCode"]):
                continue
            station = series["sourceInfo"]["siteCode"][0]["value"]
            variable = series["variable"]
            unit = variable.get("unit", {}).get("unitCode", "")
            if unit != "ft3/s":
                raise ValueError("Expected original ft3/s daily discharge, received " + unit)
            # The retained publisher selection requests statistic 00003. Check
            # the actual response options as well when the publisher supplies it.
            stats = [v.get("optionCode") for v in variable.get("options", {}).get("option", []) if v.get("name") == "Statistic"]
            if stats and stats != ["00003"]:
                raise ValueError("Selected discharge is not an original daily mean.")
            for values_index, values in enumerate(series["values"]):
                method = str(values.get("method", [{}])[0].get("methodID", ""))
                for source_index, raw in enumerate(values["value"]):
                    day = raw["dateTime"][:10]
                    signature = (station, day, method)
                    r = base_record("flow", raw, source_index, path)
                    amount = number(raw["value"])
                    r.update(station="USGS-" + station, station_name=series["sourceInfo"].get("siteName", ""),
                             parameter="Daily mean discharge", unit=unit, method=method, method_authority="USGS",
                             activity=station + ":" + day, date=day, lower=amount, upper=amount, censored=False,
                             qualifiers=raw.get("qualifiers", []), time_basis="daily mean", source_csv_row=None,
                             eligible=amount is not None and amount != variable.get("noDataValue") and amount >= 0)
                    r["source_references"] = [{"path": path, "sha256": descriptor["sha256"], "url": descriptor.get("uri"),
                                              "series_index": series_index, "values_index": values_index, "record_index": source_index}]
                    if signature in seen:
                        previous = seen[signature]
                        if (previous["lower"], previous["qualifiers"]) != (r["lower"], r["qualifiers"]):
                            raise ValueError("Conflicting original daily values for " + str(signature))
                        previous["source_references"].extend(r["source_references"])
                        continue
                    seen[signature] = r
                    result.append(r)
    return result


def load_workspace(sources: Sources) -> list[dict]:
    manifest = sources.json(DATASETS['workspace']['manifest'])
    if manifest.get('schema') != 'upstate.temporal-workspace-source/v1':
        raise ValueError('Choose the captured original Measurements source.')
    for descriptor in manifest['sources']:
        sources.read(descriptor['path'], descriptor)
    records = sources.json(manifest['records']['path'], manifest['records'])
    for r in records:
        if r.get('lower_unbounded'):
            r['lower'] = -math.inf
        if r.get('upper_unbounded'):
            r['upper'] = math.inf
        if not r.get('eligible'):
            r['lower'], r['upper'] = None, None
    return records


LOADERS = {"workspace": load_workspace, "sv833": load_sv833, "streams": load_streams, "microbial": load_microbial, "flow": load_flow}


def load_records(sources: Sources, selection: dict) -> list[dict]:
    records = []
    for dataset in selection["datasets"]:
        records.extend(LOADERS[dataset](sources))
    for r in records:
        try:
            if date.fromisoformat(r["date"]).isoformat() != r["date"]:
                raise ValueError()
            r["year"], r["month"] = int(r["date"][:4]), int(r["date"][5:7])
        except (ValueError, TypeError):
            if r['dataset'] != 'workspace':
                raise ValueError("An original sampling date is not an ISO calendar date.")
            r['eligible'], r['year'], r['month'] = False, None, None
            r['flags'].append('original date is not a complete calendar day')
        if r["lower"] is not None and r["lower"] > r["upper"]:
            raise ValueError("An original interpreted interval is reversed.")
    return records


def selection_reason(r: dict, config: dict) -> str | None:
    if r.get('year') is None:
        return '; '.join(r['flags']) or 'source date cannot be season matched'
    if config["start_date"] and r["date"] < config["start_date"]:
        return "before selected date"
    if config["end_date"] and r["date"] > config["end_date"]:
        return "after selected date"
    if r["month"] not in config["months"]:
        return "outside selected months"
    if config["stations"] and r["station"] not in config["stations"]:
        return "outside selected stations"
    if config["parameters"] and r["parameter"] not in config["parameters"]:
        return "outside selected parameters"
    if not r["eligible"] or r["lower"] is None:
        return "; ".join(r["flags"]) or "source quality or unreported interval"
    if config["exclude_information_only"] and ("information" in " ".join(r["flags"]).lower() or "infomation" in r["comment"].lower() or "information only" in r["comment"].lower()):
        return "original information-only comment"
    if r["dataset"] == "flow":
        if config["approved_flow_only"] and "A" not in r["qualifiers"]:
            return "daily value not marked approved"
        if config["exclude_estimated_flow"] and "e" in r["qualifiers"]:
            return "original estimated daily value"
    return None


def cohort_key(r: dict, separate_projects=False) -> str:
    fields = (*DIMENSIONS, "project") if separate_projects else DIMENSIONS
    identity = [r.get(k, "") for k in fields]
    context = r.get("source_context")
    if context is not None and not isinstance(context, dict):
        raise ValueError("Original analytical source context must be an object.")
    if context:
        identity.append({"source_context": context})
    return sha(canonical(identity))[:24]


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def endpoints(lo: float | None, hi: float | None, prefix: str = "") -> dict:
    return {prefix + "lower": clean(lo), prefix + "upper": clean(hi),
            prefix + "lower_unbounded": lo == -math.inf,
            prefix + "upper_unbounded": hi == math.inf}


def sign(value: float) -> int:
    return int(value > 0) - int(value < 0)


def seasonal_estimate(months: list[dict], *, retain_pairs=False) -> dict:
    """Mathematically conservative interval extension of same-month slopes."""
    ordered = sorted((m for m in months if m["eligible"]), key=lambda m: (m["year"], m["month"]))
    pairs, lows, highs = [], [], []
    s_lo = s_hi = certain_increase = certain_decrease = exact_ties = unresolved = 0
    for i, earlier in enumerate(ordered):
        for later in ordered[i + 1:]:
            if earlier["month"] != later["month"] or earlier["year"] == later["year"]:
                continue
            years = later["year"] - earlier["year"]
            lo = (later["_lower"] - earlier["_upper"]) / years
            hi = (later["_upper"] - earlier["_lower"]) / years
            low_sign, high_sign = sign(lo), sign(hi)
            s_lo += low_sign; s_hi += high_sign
            certain_increase += low_sign == 1
            certain_decrease += high_sign == -1
            exact_ties += low_sign == high_sign == 0
            unresolved += low_sign != high_sign
            lows.append(lo); highs.append(hi)
            if retain_pairs:
                pairs.append({"cohort_id": earlier["cohort_id"], "calendar_month": earlier["month"],
                              "earlier_year": earlier["year"], "later_year": later["year"], "year_gap": years,
                              **endpoints(lo, hi, "slope_"), "sign_lower": low_sign, "sign_upper": high_sign,
                              "earlier_month_id": earlier["id"], "later_month_id": later["id"]})
    count = len(lows)
    lo, hi = median(lows), median(highs)
    direction = "no comparable month pairs" if not count else "positive support" if lo > 0 else "negative support" if hi < 0 else "zero slope" if lo == hi == 0 else "includes zero"
    return {"pair_count": count, **endpoints(lo, hi, "slope_"), "score_lower": s_lo, "score_upper": s_hi,
            "order_lower": s_lo / count if count else None, "order_upper": s_hi / count if count else None,
            "certain_increase_pairs": certain_increase, "certain_decrease_pairs": certain_decrease,
            "exact_tie_pairs": exact_ties, "unresolved_pairs": unresolved, "direction": direction,
            **({"pairs": pairs} if retain_pairs else {})}


def analyze(records: list[dict], config: dict) -> dict:
    all_rows, groups, counts = [], defaultdict(list), Counter()
    for original in records:
        r = dict(original)
        reason = selection_reason(r, config)
        r["analysis_exclusion"] = reason
        r["cohort_id"] = cohort_key(r, config["separate_projects"])
        all_rows.append(r)
        counts[reason or "selected"] += 1
        if reason is None:
            groups[r["cohort_id"]].append(r)
    if not groups:
        raise ValueError("No eligible source records match this selection. Change the dates, stations or source-quality controls.")
    cohort_rows, monthly_rows, pair_rows, sensitivity_rows = [], [], [], []
    for key, source_rows in sorted(groups.items()):
        first = source_rows[0]
        monthly_groups = defaultdict(list)
        # Exact agreeing within-activity duplicates retain all source IDs, but
        # their count cannot silently overweight the monthly median.
        repeated = defaultdict(list)
        for r in source_rows:
            repeated[(r["activity"], r["date"], r["time"], r["lower"], r["upper"])].append(r)
        for same in repeated.values():
            r = dict(same[0]); r["retained_ids"] = [x["id"] for x in same]
            monthly_groups[(r["year"], r["month"])].append(r)
        months = []
        for (year, month), rows in sorted(monthly_groups.items()):
            lo, hi = median([r["lower"] for r in rows]), median([r["upper"] for r in rows])
            original_ids = [rid for r in rows for rid in r["retained_ids"]]
            days = sorted({r["date"] for r in rows})
            expected_days = calendar.monthrange(year, month)[1]
            flow = first["dataset"] == "flow"
            fraction = len(days) / expected_days
            entry = {"id": key + ":" + f"{year:04}-{month:02}", "cohort_id": key, "year": year, "month": month,
                     "date": f"{year:04}-{month:02}-15", "dataset": first["dataset"], "station": first["station"],
                     "parameter": first["parameter"], "unit": first["unit"], "_lower": lo, "_upper": hi,
                     **endpoints(lo, hi), "source_record_count": len(original_ids), "activity_count": len(rows),
                     "sampled_days": len(days), "expected_calendar_days": expected_days if flow else None,
                     "daily_coverage_fraction": fraction if flow else None,
                     "censored_activities": sum(r["censored"] for r in rows),
                     "first_observed_date": min(days), "last_observed_date": max(days),
                     "projects": sorted({r["project"] for r in rows if r["project"]}),
                     "qualifiers": sorted({q for r in rows for q in r["qualifiers"]}),
                     "record_ids": original_ids,
                     "eligible": not flow or fraction + 1e-12 >= config["minimum_flow_month_coverage"]}
            entry["exclusion"] = None if entry["eligible"] else "daily calendar coverage below selected fraction"
            months.append(entry)
        years = sorted({r["year"] for r in months if r["eligible"]})
        year_month_sets = [{m["month"] for m in months if m["year"] == year and m["eligible"]} for year in years]
        common = sorted(set.intersection(*year_month_sets)) if year_month_sets else []
        estimate = seasonal_estimate(months, retain_pairs=True)
        pair_rows.extend(estimate.pop("pairs"))
        fixed = seasonal_estimate([m for m in months if m["month"] in common])
        omit = []
        if len(years) >= 3:
            for year in years:
                result = {"cohort_id": key, "omitted_year": year,
                          **seasonal_estimate([m for m in months if m["year"] != year])}
                omit.append(result); sensitivity_rows.append(result)
        early_late = []
        if len(years) > 1:
            for month in sorted(set(year_month_sets[0]) & set(year_month_sets[-1])):
                a = next(m for m in months if m["year"] == years[0] and m["month"] == month)
                b = next(m for m in months if m["year"] == years[-1] and m["month"] == month)
                early_late.append((b["_lower"] - a["_upper"], b["_upper"] - a["_lower"]))
        stable = bool(omit) and len({o["direction"] for o in omit} | {estimate["direction"]}) == 1
        cohort_rows.append({"id": key, **{dim: first[dim] for dim in DIMENSIONS},
                            **({"source_context": first["source_context"]} if first.get("source_context") else {}),
                            "dataset_title": first.get("dataset_title") or DATASETS[first["dataset"]]["title"],
                            "station_name": first.get("station_name", ""), "source_record_count": len(source_rows),
                            "activity_count": len(repeated), "collapsed_agreeing_record_count": len(source_rows) - len(repeated),
                            "original_record_identity_count": sum(r.get("activity_identity_basis") == "original_record" for r in source_rows),
                            "reporting_limit_unit_choice_count": sum(r.get("unit_choice", {}).get("effective_basis") == "explicit_original_reporting_limit_unit" for r in source_rows),
                            "activity_count_basis": "Distinct retained source activity identifiers or labeled original-record fallbacks; not independently verified sampling visits",
                            "first_date": min(r["date"] for r in source_rows), "last_date": max(r["date"] for r in source_rows),
                            "years": years, "months_with_records": len(months), "months_eligible": sum(m["eligible"] for m in months),
                            "censored_source_records": sum(r["censored"] for r in source_rows),
                            "projects": sorted({r["project"] for r in source_rows if r["project"]}),
                            "estimate": estimate, "common_calendar_months": common, "common_month_estimate": fixed,
                            "leave_one_year_out_direction_stable": stable,
                            "first_last": {"earlier_year": years[0] if years else None, "later_year": years[-1] if years else None,
                                           "matched_month_count": len(early_late),
                                           **endpoints(median([p[0] for p in early_late]), median([p[1] for p in early_late]), "change_")}})
        monthly_rows.extend({k: v for k, v in m.items() if not k.startswith("_")} for m in months)
    cohort_rows.sort(key=lambda c: (c["dataset"], c["station"], c["parameter"], c["method"], c["id"]))
    return {"schema": SCHEMA, "version": VERSION, "selection": config, "methods": METHODS,
            "summary": {"retained_source_records": len(records), "selected_records": counts["selected"],
                        "distinct_selected_stations": len({c["station"] for c in cohort_rows}), "cohort_count": len(cohort_rows),
                        "cohorts_with_month_pairs": sum(c["estimate"]["pair_count"] > 0 for c in cohort_rows),
                        "month_year_count": len(monthly_rows), "eligible_month_year_count": sum(m["eligible"] for m in monthly_rows),
                        "same_month_pair_count": len(pair_rows), "source_selection_counts": dict(counts),
                        "dataset_counts": dict(Counter(r["dataset"] for r in records)),
                        "selected_dataset_counts": dict(Counter(r["dataset"] for r in all_rows if not r["analysis_exclusion"])),
                        "count_basis": "Source-cohort records, not a deduplicated multi-study census. Overlapping SV-833 observations in the microbial edition remain separate; datasets are never pooled."},
            "cohorts": cohort_rows, "monthly": monthly_rows, "pairs": pair_rows,
            "leave_one_year_out": sensitivity_rows, "records": clean(all_rows)}


def csv_bytes(rows: list[dict], fields: list[str] | None = None) -> bytes:
    fields = fields or list(dict.fromkeys(k for r in rows for k in r))
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: json.dumps(clean(v), ensure_ascii=False, separators=(",", ":")) if isinstance(v, (dict, list)) else clean(v)
                         for k, v in row.items() if k in fields})
    return text.getvalue().encode("utf-8")


def render_report(result: dict, template: Path | None = None) -> bytes:
    template = template or Path(__file__).with_name("temporal_report.html")
    data = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    compressed = base64.b64encode(gzip.compress(data.encode("utf-8"), compresslevel=9, mtime=0)).decode("ascii")
    return template.read_text(encoding="utf-8").replace("__TEMPORAL_DATA__", compressed).encode("utf-8")


def build(application: Path, output: Path, selection: dict | None = None) -> dict:
    application = application.resolve(strict=True)
    output = output.resolve()
    if output.exists():
        raise ValueError("Choose a new output directory; an existing edition is never overwritten.")
    config = checked_selection(selection)
    sources = Sources(application)
    records = load_records(sources, config)
    result = analyze(records, config)
    source_list = sorted(sources.metadata.values(), key=lambda x: x["path"])
    implementation = {p.name: sha(p.read_bytes()) for p in (Path(__file__), Path(__file__).with_name("temporal_report.html"))}
    result["input_sources"] = source_list
    result["implementation"] = implementation
    result["id"] = sha(canonical({"selection": config, "sources": source_list, "implementation": implementation}))
    result = clean(result)
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".temporal-", dir=output.parent))
    try:
        (pending / "selection.json").write_bytes(canonical(config))
        (pending / "analysis.json").write_bytes(canonical(result))
        (pending / "review.html").write_bytes(render_report(result))
        flat = [{**{k: v for k, v in c.items() if k not in ("estimate", "common_month_estimate", "first_last")},
                 **c["estimate"], **{"common_" + k: v for k, v in c["common_month_estimate"].items()}, **c["first_last"]} for c in result["cohorts"]]
        for filename, rows in [("cohort-summary.csv", flat), ("monthly-intervals.csv", result["monthly"]),
                               ("matched-month-pairs.csv", result["pairs"]), ("leave-one-year-out.csv", result["leave_one_year_out"]),
                               ("source-records.csv", result["records"])]:
            (pending / filename).write_bytes(csv_bytes(rows))
        (pending / "input-sources.json").write_bytes(canonical(source_list))
        for name, raw in sources.data.items():
            p = pending / "inputs" / name
            p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(raw)
        code_dir = pending / "engine"; code_dir.mkdir()
        for name in ("temporal_analysis.py", "temporal_report.html", "TEMPORAL_ANALYSIS.md"):
            src = Path(__file__).with_name(name)
            if src.is_file():
                shutil.copyfile(src, code_dir / name)
        (pending / "OPEN_ME.txt").write_text(
            "Open review.html directly in a browser. All results and source-row references are embedded.\n"
            "Use Save review JSON / Open review JSON for editable analyst notes and source-bound selections.\n"
            "To recalculate from the exact captured inputs:\n"
            "python engine/temporal_analysis.py --application inputs --config selection.json --output ../recalculated-analysis\n"
            "In the maintained workbench open Monitoring change and queue the same selection.\n", encoding="utf-8")
        hashes = [{"path": p.relative_to(pending).as_posix(), "bytes": p.stat().st_size, "sha256": sha(p.read_bytes())}
                  for p in sorted(pending.rglob("*")) if p.is_file()]
        (pending / "package-manifest.json").write_bytes(canonical({"schema": "upstate.temporal-package/v1", "analysis_id": result["id"], "members": hashes}))
        with zipfile.ZipFile(pending / "temporal-analysis.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for p in sorted(pending.rglob("*")):
                if p.is_file() and p.name != "temporal-analysis.zip":
                    archive.write(p, p.relative_to(pending).as_posix())
        pending.rename(output)
    except BaseException:
        shutil.rmtree(pending, ignore_errors=True)
        raise
    return {"id": result["id"], "title": config["title"], "selection": config,
            "summary": result["summary"], "output": str(output), "implementation": implementation}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=BASE)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    try:
        selection = json.loads(args.config.read_text()) if args.config else None
        print(json.dumps(build(args.application, args.output, selection), ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, "Monitoring analysis: " + str(error) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
