#!/usr/bin/env python3
"""Stream exact retained BLS source files or typed LAUS/QCEW observations.

Stdlib csv handles the original tab-separated LAUS files and quoted QCEW CSV.
The byte-level record hash includes every original physical line ending. No
network operation is performed by this worker.
"""
from __future__ import annotations

import argparse
import base64
import calendar
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import sys

from capture import BlsError, load_source, member, open_regular, require

MAX_SAFE_INTEGER = 9007199254740991
OWNERSHIP = {
    "0": "Total covered", "1": "Federal government", "2": "State government",
    "3": "Local government", "5": "Private", "8": "Total government",
    "9": "UI covered (excludes federal government)",
}
AGGREGATION = {
    "70": "County, total covered", "71": "County, by ownership",
    "72": "County, by domain", "73": "County, by supersector",
    "74": "County, by NAICS sector", "75": "County, by 3-digit NAICS",
    "76": "County, by 4-digit NAICS", "77": "County, by 5-digit NAICS",
    "78": "County, by 6-digit NAICS",
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


class PhysicalLines:
    def __init__(self, stream, maximum):
        self.stream = stream
        self.maximum = maximum
        self.line_number = 0
        self.digest = hashlib.sha256()
        self.byte_count = 0
        self.begin()

    def begin(self):
        self.parts = []
        self.record_bytes = 0
        self.start_line = self.line_number + 1

    def __iter__(self):
        return self

    def __next__(self):
        raw = self.stream.readline(self.maximum + 1)
        if not raw:
            raise StopIteration
        self.record_bytes += len(raw)
        require(self.record_bytes <= self.maximum,
                "CSV/TSV physical record exceeds max_record_bytes")
        self.line_number += 1
        self.byte_count += len(raw)
        self.digest.update(raw)
        self.parts.append(raw)
        # A UTF-8 BOM is a file encoding marker; its bytes remain in the hash.
        return raw.decode("utf-8-sig" if self.line_number == 1 else "utf-8")


def records(context, source, delimiter):
    limits = context["contract"]["limits"]
    inventory = context["inventory"][source["path"]]
    csv.field_size_limit(limits["max_record_bytes"])
    with open_regular(member(context["directory"], source["path"])) as stream:
        before = os.fstat(stream.fileno())
        lines = PhysicalLines(stream, limits["max_record_bytes"])
        reader = csv.reader(lines, delimiter=delimiter, strict=True)
        try:
            original_header = next(reader)
        except StopIteration as exc:
            raise BlsError("Source is empty: " + source["path"]) from exc
        header = [name.strip() for name in original_header]
        require(header and all(header) and len(set(header)) == len(header),
                "Source has empty or duplicate column names: " + source["path"])
        while True:
            lines.begin()
            try:
                fields = next(reader)
            except StopIteration:
                break
            if not fields:
                continue
            require(len(fields) == len(header),
                    f"Source column count differs at {source['path']}:{lines.start_line}")
            raw_record = b"".join(lines.parts)
            yield {"fields": dict(zip(header, fields)),
                   "raw_record": compact(dict(zip(original_header, fields))),
                   "source_row_sha256": hashlib.sha256(raw_record).hexdigest(),
                   "source_line": lines.start_line, "source_line_end": lines.line_number}
        after = os.fstat(stream.fileno())
        require(lines.byte_count == inventory["bytes"]
                and lines.digest.hexdigest() == inventory["sha256"]
                and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                "Source changed during projection: " + source["path"])


def fields_required(fields, names, source):
    missing = set(names) - set(fields)
    require(not missing, "Missing original columns in " + source["path"] + ": " + ", ".join(sorted(missing)))


def one_source(context, role):
    found = [s for s in context["manifest"]["sources"] if s["role"] == role]
    require(len(found) == 1, "Expected one retained " + role + " definition")
    return found[0]


def county_from_area(area_code):
    match = re.fullmatch(r"CN(\d{5})0{8}", area_code)
    return match[1] if match else ""


def definitions(context):
    selected = context["manifest"]["selection"]
    counties = set(selected["counties"])
    area_source = one_source(context, "laus-area")
    series_source = one_source(context, "laus-series")
    measure_source = one_source(context, "laus-measure")
    footnote_source = one_source(context, "laus-footnote")
    areas, series, measures, footnotes = {}, {}, {}, {}
    for record in records(context, area_source, "\t"):
        raw = record["fields"]
        fields_required(raw, ("area_code", "area_type_code", "area_text"), area_source)
        row = {key: value.strip() for key, value in raw.items()}
        if county_from_area(row["area_code"]) not in counties:
            continue
        require(row["area_code"] not in areas, "Duplicate selected LAUS area definition")
        areas[row["area_code"]] = row
    missing = counties - {county_from_area(code) for code in areas}
    require(not missing, "Retained LAUS area definitions do not contain selected counties: " + ", ".join(sorted(missing)))
    for record in records(context, series_source, "\t"):
        raw = record["fields"]
        fields_required(raw, ("series_id", "area_code", "area_type_code", "measure_code",
                              "seasonal", "series_title", "footnote_codes"), series_source)
        row = {key: value.strip() for key, value in raw.items()}
        if (row["area_code"] not in areas
                or row["measure_code"] not in selected["laus"]["measures"]
                or row["seasonal"] not in selected["laus"]["seasonal"]):
            continue
        require(row["series_id"] not in series, "Duplicate selected LAUS series definition")
        require(row["series_id"] == "LA" + row["seasonal"] + row["area_code"] + row["measure_code"],
                "LAUS series identifier disagrees with its captured definition")
        require(row["area_type_code"] == areas[row["area_code"]]["area_type_code"],
                "LAUS series and area definitions disagree")
        series[row["series_id"]] = row
    require(series, "No retained LAUS series matches the explicit county/measure/seasonal selection")
    for record in records(context, measure_source, "\t"):
        row = {key: value.strip() for key, value in record["fields"].items()}
        fields_required(row, ("measure_code", "measure_text"), measure_source)
        require(row["measure_code"] not in measures, "Duplicate LAUS measure definition")
        measures[row["measure_code"]] = row["measure_text"]
    for record in records(context, footnote_source, "\t"):
        row = {key: value.strip() for key, value in record["fields"].items()}
        fields_required(row, ("footnote_code", "footnote_text"), footnote_source)
        require(row["footnote_code"] not in footnotes, "Duplicate LAUS footnote definition")
        footnotes[row["footnote_code"]] = row["footnote_text"]
    for row in series.values():
        require(row["measure_code"] in measures, "Selected series has no retained measure definition")
    retained = compact([{"role": source["role"], "path": source["path"],
                         "sha256": context["inventory"][source["path"]]["sha256"],
                         "url": source["url"], "retrieved_at": source["retrieved_at"]}
                        for source in (area_source, series_source, measure_source, footnote_source)])
    return areas, series, measures, footnotes, retained


def numeric(raw):
    token = raw.strip()
    if token in ("", "-", "--", "NA", "N/A", "(NA)", "."):
        return None, "missing"
    try:
        value = Decimal(token)
    except InvalidOperation:
        return None, "non_numeric"
    if not value.is_finite():
        return None, "non_finite"
    if abs(value) > MAX_SAFE_INTEGER:
        return None, "unsafe_integer_precision"
    if value == value.to_integral_value():
        return int(value), "reported"
    number = float(value)
    if not math.isfinite(number):
        return None, "non_finite"
    return number, "reported"


def footnote_codes(*values, dictionary):
    output = []
    for value in values:
        for token in re.findall(r"[A-Za-z0-9]+", value):
            codes = [token] if token in dictionary else (
                list(token) if all(char in dictionary for char in token) else [token])
            for code in codes:
                if code not in output:
                    output.append(code)
    return output


def month_dates(year, month):
    return (dt.date(year, month, 1).isoformat(),
            dt.date(year, month, calendar.monthrange(year, month)[1]).isoformat())


def common_fields(context, source, record):
    return {"capture_id": context["capture_sha256"], "source_file": source["path"],
            "source_sha256": context["inventory"][source["path"]]["sha256"],
            "source_row_sha256": record["source_row_sha256"],
            "source_url": source["url"], "retrieved_at": source["retrieved_at"],
            "release_vintage": source.get("release_vintage", ""),
            "raw_record": record["raw_record"], "source_line": record["source_line"],
            "source_line_end": record["source_line_end"]}


def observation_id(parts):
    return hashlib.sha256(compact(parts).encode("utf-8")).hexdigest()


def laus_rows(context):
    selection = context["manifest"]["selection"]["laus"]
    areas, series, measures, footnotes, retained = definitions(context)
    years, periods = set(selection["years"]), set(selection["periods"])
    seen = set()
    for source in context["manifest"]["sources"]:
        if source["role"] != "laus-data":
            continue
        for record in records(context, source, "\t"):
            raw = record["fields"]
            fields_required(raw, ("series_id", "year", "period", "value", "footnote_codes"), source)
            sid = raw["series_id"].strip()
            if sid not in series:
                continue
            year = int(raw["year"].strip())
            period = raw["period"].strip()
            if year not in years or period not in periods:
                continue
            require(re.fullmatch(r"M(?:0[1-9]|1[0-3])", period), "Invalid original LAUS period")
            info = series[sid]
            area = areas[info["area_code"]]
            codes = footnote_codes(raw["footnote_codes"], info["footnote_codes"], dictionary=footnotes)
            details = [{"code": code, "text": footnotes.get(code, "")} for code in codes]
            value, status = numeric(raw["value"])
            if "U" in codes:
                value, status = None, "annual_average_unavailable"
            elif "X" in codes:
                value, status = None, "data_unavailable"
            elif "N" in codes:
                value, status = None, "not_available"
            elif any(code not in footnotes for code in codes) and status == "reported":
                status = "reported_unresolved_footnote"
            annual = period == "M13"
            if annual:
                start, end = f"{year:04d}-01-01", f"{year:04d}-12-31"
                coverage = 12 if value is not None else None
            else:
                start, end = month_dates(year, int(period[1:]))
                coverage = 1 if value is not None else None
            excluded = []
            coverage_note = ""
            if annual and year == 2025 and "G" in codes:
                coverage = 11 if value is not None else None
                excluded = ["2025-10"]
                coverage_note = footnotes.get("G", "")
            elif annual and value is None:
                coverage_note = " ".join(footnotes[code] for code in codes if code in footnotes)
            elif not annual and "X" in codes:
                excluded = [start[:7]]
                coverage_note = footnotes.get("X", "")
            oid = observation_id(["laus", sid, year, period])
            require(oid not in seen, "Duplicate selected LAUS series/year/period observation")
            seen.add(oid)
            yield {**common_fields(context, source, record), "observation_id": oid,
                   "provider": "BLS_LAUS", "measure_code": info["measure_code"],
                   "measure_name": measures[info["measure_code"]],
                   "unit": "percent" if info["measure_code"] in ("03", "07", "08") else "persons",
                   "basis": "place_of_residence", "series_id": sid, "series_title": info["series_title"],
                   "area_code": info["area_code"], "area_type_code": info["area_type_code"],
                   "area_name": area["area_text"], "county_fips": county_from_area(info["area_code"]),
                   "seasonal": info["seasonal"], "year": year, "period": period,
                   "period_kind": "annual_average" if annual else "month",
                   "period_start": start, "period_end": end, "value_raw": raw["value"],
                   "value": value, "value_status": status, "footnote_codes": ",".join(codes),
                   "footnotes": compact(details), "coverage_months": coverage,
                   "excluded_months": compact(excluded), "coverage_note": coverage_note,
                   "definition_sources": retained}


def qcew_metric(metric):
    group = "lq" if metric.startswith("lq_") else "oty" if metric.startswith("oty_") else "base"
    base = metric[3:] if group == "lq" else metric[4:] if group == "oty" else metric
    percentage = base.endswith("_pct_chg")
    base = base.removesuffix("_pct_chg").removesuffix("_chg")
    if group == "lq":
        unit = "ratio"
    elif percentage:
        unit = "percent"
    elif "estabs" in base:
        unit = "establishments"
    elif "emplvl" in base:
        unit = "jobs"
    elif "wkly_wage" in base:
        unit = "USD_per_week"
    elif "annual_pay" in base:
        unit = "USD_per_year"
    elif "wages" in base or "contributions" in base:
        unit = "USD"
    else:
        raise BlsError("No declared unit for selected QCEW metric: " + metric)
    month = re.search(r"month([123])_emplvl", base)
    return group, unit, int(month[1]) if month else None


def qcew_rows(context):
    selection = context["manifest"]["selection"]
    chosen = selection["qcew"]
    areas, _, _, _, _ = definitions(context)
    area_names = {county_from_area(code): value["area_text"] for code, value in areas.items()}
    periods = {(p["year"], p["quarter"]) for p in chosen["periods"]}
    seen = set()
    for source in context["manifest"]["sources"]:
        if (source["role"] != "qcew-data" or source["area_fips"] not in selection["counties"]
                or (source["year"], source["quarter"]) not in periods):
            continue
        for record in records(context, source, ","):
            raw = record["fields"]
            fields_required(raw, ("area_fips", "own_code", "industry_code", "agglvl_code",
                                  "size_code", "year", "qtr", "disclosure_code",
                                  "lq_disclosure_code", "oty_disclosure_code"), source)
            row = {key: value.strip() for key, value in raw.items()}
            year = int(row["year"])
            quarter = 0 if row["qtr"].upper() in ("A", "0") else int(row["qtr"])
            require((row["area_fips"], year, quarter) == (source["area_fips"], source["year"], source["quarter"]),
                    "QCEW row area/period differs from its original source URL")
            if (row["own_code"] not in chosen["ownership_codes"]
                    or row["industry_code"] not in chosen["industry_codes"]
                    or row["size_code"] not in chosen["size_codes"]):
                continue
            fields_required(raw, chosen["metrics"], source)
            for metric in chosen["metrics"]:
                group, unit, month = qcew_metric(metric)
                disclosure_field = "disclosure_code" if group == "base" else group + "_disclosure_code"
                disclosure = row[disclosure_field]
                value, status = numeric(raw[metric])
                if disclosure == "N":
                    value, status = None, "withheld"
                elif disclosure:
                    value, status = None, "unrecognized_disclosure"
                if quarter == 0:
                    start, end = f"{year:04d}-01-01", f"{year:04d}-12-31"
                elif month:
                    start, end = month_dates(year, (quarter - 1) * 3 + month)
                else:
                    start = month_dates(year, (quarter - 1) * 3 + 1)[0]
                    end = month_dates(year, quarter * 3)[1]
                oid = observation_id(["qcew", row["area_fips"], row["own_code"],
                                      row["industry_code"], row["agglvl_code"],
                                      row["size_code"], year, quarter, metric])
                require(oid not in seen, "Duplicate selected QCEW area/industry/ownership/metric row")
                seen.add(oid)
                yield {**common_fields(context, source, record), "observation_id": oid,
                       "provider": "BLS_QCEW", "area_fips": row["area_fips"],
                       "area_name": row.get("area_title", "") or area_names.get(row["area_fips"], ""),
                       "ownership_code": row["own_code"],
                       "ownership_title": row.get("own_title", "") or OWNERSHIP.get(row["own_code"], ""),
                       "industry_code": row["industry_code"], "industry_title": row.get("industry_title", ""),
                       "aggregation_code": row["agglvl_code"],
                       "aggregation_title": row.get("agglvl_title", "") or AGGREGATION.get(row["agglvl_code"], ""),
                       "size_code": row["size_code"], "size_title": row.get("size_title", ""),
                       "year": year, "quarter": quarter, "metric": metric, "unit": unit,
                       "basis": "place_of_employment", "period_start": start, "period_end": end,
                       "value_raw": raw[metric], "value": value, "value_status": status,
                       "disclosure_code": disclosure, "disclosure_group": group}


def source_file_rows(context):
    chunk_bytes = context["contract"]["chunk_bytes"]
    manifest_path = context["contract"]["manifest_path"]
    inventory = [*context["manifest"]["files"],
                 {"path": manifest_path, "bytes": len(context["manifest_bytes"]),
                  "sha256": context["capture_sha256"]}]
    for item in sorted(inventory, key=lambda value: value["path"]):
        count = max(1, math.ceil(item["bytes"] / chunk_bytes))
        digest = hashlib.sha256()
        total = 0
        with open_regular(member(context["directory"], item["path"])) as stream:
            for index in range(count):
                block = stream.read(chunk_bytes)
                require(block or item["bytes"] == 0, "Source-file member ended before its declared chunk count")
                digest.update(block)
                total += len(block)
                yield {"capture_id": context["capture_sha256"], "path": item["path"],
                       "file_sha256": item["sha256"], "file_bytes": item["bytes"],
                       "chunk_index": index, "chunk_count": count,
                       "chunk_sha256": hashlib.sha256(block).hexdigest(),
                       "content_base64": base64.b64encode(block).decode("ascii")}
            require(not stream.read(1), "Source-file member grew after verification")
        require(total == item["bytes"] and digest.hexdigest() == item["sha256"],
                "Source-file member changed during delivery: " + item["path"])


class Protocol:
    def __init__(self, context, query):
        self.context = context
        self.query = query
        self.columns = context["contract"]["projections"][query]["columns"]
        self.limits = context["contract"]["limits"]
        self.rows = 0
        self.bytes = 0

    def write(self, envelope):
        raw = (compact(envelope) + "\n").encode("utf-8")
        self.bytes += len(raw)
        require(self.bytes <= self.limits["max_projected_bytes"],
                "Projection exceeds max_projected_bytes; narrow the retained selection")
        sys.stdout.buffer.write(raw)

    def row(self, row):
        require(set(row) == set(self.columns), "Worker row columns differ from its declared contract")
        for name, spec in self.columns.items():
            value = row[name]
            if value is None:
                require(spec["nullable"], "Worker emitted null for required field: " + name)
                continue
            kind = spec["type"]
            require((kind == "string" and isinstance(value, str))
                    or (kind == "integer" and type(value) is int and abs(value) <= MAX_SAFE_INTEGER)
                    or (kind == "number" and type(value) in (int, float) and math.isfinite(value)),
                    "Worker emitted the wrong type for field: " + name)
        self.rows += 1
        require(self.rows <= self.limits["max_projected_rows"],
                "Projection exceeds max_projected_rows; narrow the retained selection")
        self.write({"kind": "row", "row": row})

    def complete(self):
        self.write({"kind": "complete", "result": {
            "schema": self.context["contract"]["extraction_schema"], "projection": self.query,
            "sourceHash": self.context["source_hash"], "captureHash": self.context["capture_sha256"],
            "completeSelection": True, "sourceVerified": True, "rawValuesPreserved": True,
            "rowCount": self.rows}})
        sys.stdout.buffer.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--query", required=True, choices=("laus", "qcew", "source_files"))
    args = parser.parse_args()
    require(Path(args.source).is_absolute(), "--source must be an absolute path")
    context = load_source(args.source)
    protocol = Protocol(context, args.query)
    iterator = {"laus": laus_rows, "qcew": qcew_rows, "source_files": source_file_rows}[args.query]
    for row in iterator(context):
        protocol.row(row)
    protocol.complete()


if __name__ == "__main__":
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    try:
        main()
    except (BlsError, OSError, UnicodeError, ValueError, csv.Error) as exc:
        print(json.dumps({"error": "BLS_PROJECTION_FAILED", "message": str(exc)}), file=sys.stderr)
        sys.exit(1)
