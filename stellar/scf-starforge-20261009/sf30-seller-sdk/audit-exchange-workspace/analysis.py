"""Retained, explicitly selected BuildingSync energy analysis with native nmecr.

The web worker owns the directory lease. This module never installs dependencies
or discovers customer data during a run; it consumes the complete selected source
and the operator's original weather file.
"""
from __future__ import annotations

import contextlib
import csv
import datetime as dt
import decimal
import fcntl
import hashlib
import io
import json
import math
import mimetypes
import os
from pathlib import Path
import signal
import stat
import subprocess
import time
import traceback
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SCHEMA = "commons.audit.native-analysis.v1"
NMECR_COMMIT = "343146d7a1e20d027e6ca48bd7ca2b38c646592a"
NMECR_VERSION = "1.0.18"
MODELS = ("Mean", "SLR", "3PC", "3PH", "4P", "5P", "HDD", "CDD", "HDD-CDD", "TOW", "TOWT")
MODEL_ARGUMENTS = {
    "has_temp_knots_defined", "equal_temp_segment_points", "temp_segments_numeric",
    "temp_knots_value", "initial_breakpoints", "occupancy_threshold", "day_normalized",
}
OPTIONS = {
    "models", "sourceTimezone", "weatherTimezone", "weatherColumns", "weatherUnits",
    "weatherInterval", "endPolicy", "lastEnd", "interval", "baseline", "reporting",
    "normalization", "modelArguments", "balancePoint", "confidenceLevel",
    "allowNegativePredictions", "seed", "timeoutSeconds", "weatherMissingValues",
}
ENERGY_UNITS = {
    "Wh", "kWh", "MWh", "GWh", "Btu", "kBtu", "MBtu", "MMBtu", "therms", "Therms",
    "therm", "MJ", "GJ", "kJ", "J", "kcal", "Mcal", "MMcal",
}
INTERVAL_SECONDS = {"15-min": 900, "Hourly": 3600, "Daily": 86400}
UTC = dt.timezone.utc


class AnalysisInputError(ValueError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details or {}


def need(condition, code, message, details=None):
    if not condition:
        raise AnalysisInputError(code, message, details)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, body, *, immutable=False):
    path = Path(path)
    need(path.parent.resolve() == path.parent.absolute(), "analysis_path",
         "Keep the analysis in its original ordinary directory.")
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.exists() or path.is_symlink():
        need(not path.is_symlink() and path.is_file(), "analysis_path",
             "A retained analysis name is not an ordinary file.")
        if immutable:
            need(path.read_bytes() == body, "analysis_input_changed",
                 "This analysis directory already contains different original input.",
                 {"name": path.name})
            return
    candidate = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    try:
        with candidate.open("xb") as out:
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        candidate.chmod(0o600)
        if immutable:
            try:
                os.link(candidate, path)
            except FileExistsError:
                need(path.read_bytes() == body, "analysis_input_changed",
                     "The retained original input changed during receiving.")
        else:
            os.replace(candidate, path)
        fsync_dir(path.parent)
    finally:
        candidate.unlink(missing_ok=True)


def json_file(path, value, *, immutable=False):
    atomic(path, encoded(value) + b"\n", immutable=immutable)


def ordinary_file(path):
    path = Path(path)
    need(not path.is_symlink() and path.is_file(), "source_file",
         "The complete original source file is unavailable.")
    return path.read_bytes()


def zone(name, label):
    need(isinstance(name, str) and bool(name), "timezone_required",
         f"Choose the {label} timezone explicitly for timestamps without offsets.")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise AnalysisInputError("timezone_unknown", f"The {label} timezone is not an IANA name.",
                                 {"timezone": name}) from exc


def timestamp(value, timezone_name, label):
    need(isinstance(value, str) and bool(value.strip()), "timestamp_required",
         f"The {label} timestamp is missing.")
    try:
        parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise AnalysisInputError("timestamp_invalid", f"The {label} timestamp is not ISO 8601.",
                                 {"value": value}) from exc
    if parsed.tzinfo is None:
        tz = zone(timezone_name, label)
        first, second = parsed.replace(tzinfo=tz, fold=0), parsed.replace(tzinfo=tz, fold=1)
        need(first.utcoffset() == second.utcoffset(), "timestamp_ambiguous",
             "An ambiguous local timestamp needs its original UTC offset.",
             {"label": label, "value": value, "timezone": timezone_name})
        need(first.astimezone(UTC).astimezone(tz).replace(tzinfo=None) == parsed,
             "timestamp_nonexistent", "A local timestamp falls in a clock change gap.",
             {"label": label, "value": value})
        parsed = first
    return parsed


def number(value, label):
    need(not isinstance(value, bool), "number_invalid", f"The {label} value is not a number.")
    try:
        exact = decimal.Decimal(str(value))
        result = float(exact)
    except (decimal.InvalidOperation, OverflowError, ValueError) as exc:
        raise AnalysisInputError("number_invalid", f"The {label} value is not numeric.",
                                 {"value": str(value)}) from exc
    need(exact.is_finite() and math.isfinite(result), "number_nonfinite",
         f"The {label} value must be finite.", {"value": str(value)})
    return result


def next_period(start, interval):
    if interval == "Monthly":
        year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
        try:
            return start.replace(year=year, month=month)
        except ValueError as exc:
            raise AnalysisInputError("interval_end_required",
                                     "This monthly reading needs its original end timestamp.") from exc
    if interval == "Daily":
        return start + dt.timedelta(days=1)
    need(interval in INTERVAL_SECONDS, "interval_unknown",
         "Choose 15-min, Hourly, Daily, or Monthly.")
    return start + dt.timedelta(seconds=INTERVAL_SECONDS[interval])


def infer_interval(rows, requested=None):
    if requested is not None:
        need(requested in (*INTERVAL_SECONDS, "Monthly"), "interval_unknown",
             "Choose 15-min, Hourly, Daily, or Monthly.")
        interval = requested
    else:
        durations = [b.timestamp() - a.timestamp() for a, b, _, _ in rows]
        if all(28 * 86400 <= value <= 32 * 86400 for value in durations):
            interval = "Monthly"
        else:
            matching = [key for key, seconds in INTERVAL_SECONDS.items()
                        if all(abs(value - seconds) < 0.001 for value in durations)]
            need(len(matching) == 1, "interval_required",
                 "Choose a supported interval matching the original readings.")
            interval = matching[0]
    for start, end, _, source in rows:
        expected = next_period(start, interval)
        if interval == "Monthly":
            # Native monthly billing intervals can differ in length, but must
            # begin/end on whole local days and keep their original boundaries.
            need(start.time() == dt.time() and end.time() == dt.time()
                 and 28 * 86400 - 3600 <= end.timestamp() - start.timestamp() <= 35 * 86400 + 3600,
                 "monthly_boundary", "Monthly energy needs whole-day original billing intervals.",
                 {"reading": source.get("key")})
        else:
            need(abs(expected.timestamp() - end.timestamp()) < 0.001, "interval_mismatch",
                 "The requested model interval differs from an original reading.",
                 {"reading": source.get("key"), "interval": interval})
    return interval


def selected_readings(selection, options):
    reading_type = selection.get("readingType")
    need(reading_type == "Total", "non_energy_selection",
         "Choose a Total energy stream for energy modeling.",
         {"readingType": reading_type, "units": selection.get("units"),
          "supportedPurpose": "energy consumption"})
    units = selection.get("units")
    need(isinstance(units, str) and bool(units), "units_required",
         "The selected energy stream needs its original units.")
    # Volume-based fuel inputs may be useful but need an explicit, retained
    # calorific-value conversion first. Never present their totals as energy.
    need(units in ENERGY_UNITS, "energy_units_required",
         "This stream needs energy units before it can enter the energy model.",
         {"units": units})
    building, scenario, resource = (selection.get(key) or {} for key in ("building", "scenario", "resource"))
    for label, value in (("building", building), ("scenario", scenario), ("resource", resource)):
        need(bool(value.get("key")), "selection_required", f"Select one original {label}.")
    need(resource.get("resourceUnits") in (None, "", units), "resource_units_mismatch",
         "The selected units differ from the resource's original energy units.")
    raw = selection.get("readings")
    need(isinstance(raw, list) and len(raw) >= 3, "readings_required",
         "Select at least three complete original energy readings.")
    starts = [timestamp(row.get("start"), options.get("sourceTimezone"), "meter")
              for row in raw]
    rows, keys = [], set()
    for index, (source, start) in enumerate(zip(raw, starts)):
        need(isinstance(source, dict), "reading_shape", "Each selected reading must be an object.")
        key = source.get("key") or source.get("path")
        need(bool(key) and key not in keys, "reading_duplicate",
             "Each original reading must appear exactly once.")
        keys.add(key)
        need(source.get("readingType") == "Total" and source.get("units") == units,
             "mixed_quantity", "The selection contains different quantities or units.",
             {"reading": key})
        quantity = source.get("quantity")
        need(quantity not in ("Cost", "Peak", "Demand"), "non_energy_selection",
             "The reading quantity is not total energy.", {"reading": key, "quantity": quantity})
        need(source.get("resourceKey") == resource["key"], "mixed_resource",
             "The selection contains a different resource.", {"reading": key})
        need(source.get("scenarioKey") == scenario["key"], "mixed_scenario",
             "The selection contains a different scenario.", {"reading": key})
        linked_buildings = source.get("buildingKeys") or []
        need(not linked_buildings or linked_buildings == [building["key"]],
             "building_ambiguous", "The stream has conflicting or multiple original building associations.",
             {"reading": key, "buildingKeys": linked_buildings})
        end_literal = source.get("end")
        if end_literal:
            end = timestamp(end_literal, options.get("sourceTimezone"), "meter end")
        else:
            policy = options.get("endPolicy", "required")
            if policy == "next-reading" and index + 1 < len(raw):
                end = starts[index + 1]
            elif policy == "frequency":
                end = next_period(start, options.get("interval"))
            elif policy == "next-reading" and options.get("lastEnd"):
                end = timestamp(options["lastEnd"], options.get("sourceTimezone"), "final meter end")
            else:
                raise AnalysisInputError("interval_end_required",
                                         "Retain the original end timestamp or choose an explicit end policy.",
                                         {"reading": key})
        need(end.timestamp() > start.timestamp(), "interval_invalid",
             "Each original interval must end after it starts.", {"reading": key})
        value = number(source.get("value"), "energy reading")
        rows.append((start, end, value, source))
    for before, after in zip(rows, rows[1:]):
        need(before[0].timestamp() < after[0].timestamp(), "reading_order",
             "Retain readings in strictly increasing source time order.")
        need(abs(before[1].timestamp() - after[0].timestamp()) < 0.001, "meter_gap_or_overlap",
             "Energy intervals must be contiguous and non-overlapping.",
             {"before": before[3].get("key"), "after": after[3].get("key")})
    interval = infer_interval(rows, options.get("interval"))
    # nmecr's intervals are inferred from UTC elapsed time. Its daily algorithms
    # require a fixed 1,440-minute median. Original local clock shifts remain in
    # the retained inputs; nonuniform hourly/monthly boundaries are verified later.
    return rows, interval


def weather_rows(body, options, meter_rows, interval):
    need(bool(body), "weather_required", "Attach the complete observed weather CSV.")
    try:
        text = body.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text, newline=""))
        original_rows = list(reader)
    except (UnicodeError, csv.Error) as exc:
        raise AnalysisInputError("weather_csv", "The weather input is not a UTF-8 CSV.") from exc
    need(bool(original_rows), "weather_empty", "The weather CSV has no readings.")
    columns = {"time": "time", "temp": "temp", **(options.get("weatherColumns") or {})}
    need(all(isinstance(k, str) and isinstance(v, str) for k, v in columns.items())
         and set(columns) <= {"time", "temp", "end", "station"},
         "weather_columns", "Use time, temp, optional end, and optional station column mappings.")
    need(all(value in (reader.fieldnames or []) for value in columns.values()),
         "weather_columns", "A selected weather column is missing.", {"columns": columns})
    units = options.get("weatherUnits")
    need(units in ("F", "C", "degF", "degC", "°F", "°C"), "weather_units_required",
         "Choose the original weather temperature units explicitly.")
    weather_interval = options.get("weatherInterval")
    need(weather_interval in ("15-min", "Hourly", "Daily"), "weather_interval_required",
         "Choose the original observed weather interval: 15-min, Hourly, or Daily.")
    need(interval == "Monthly" or INTERVAL_SECONDS[weather_interval] <= INTERVAL_SECONDS[interval],
         "weather_too_coarse", "Weather must be at least as frequent as the selected meter interval.")
    missing = {str(value).strip() for value in options.get("weatherMissingValues", ["", "NA", "NaN", "9999.9"])}
    rows, stations = [], set()
    for index, source in enumerate(original_rows, 2):
        literal = (source.get(columns["temp"]) or "").strip()
        need(literal not in missing, "weather_missing",
             "A weather row is missing its observed temperature.", {"csvLine": index})
        start = timestamp(source.get(columns["time"]), options.get("weatherTimezone"), "weather")
        end = (timestamp(source.get(columns["end"]), options.get("weatherTimezone"), "weather end")
               if "end" in columns else next_period(start, weather_interval))
        need(end.timestamp() > start.timestamp(), "weather_interval_invalid",
             "Each observed weather interval needs a positive duration.", {"csvLine": index})
        need(abs(next_period(start, weather_interval).timestamp() - end.timestamp()) < 0.001,
             "weather_interval_mismatch", "The weather end differs from its declared interval.",
             {"csvLine": index})
        value = number(literal, "weather temperature")
        fahrenheit = value * 9 / 5 + 32 if units in ("C", "degC", "°C") else value
        station = source.get(columns.get("station", ""), "")
        if station:
            stations.add(station)
        rows.append((start, end, fahrenheit, index, literal))
    need(len(stations) <= 1, "weather_station_mixed",
         "Select one observed weather station for this model.", {"stations": sorted(stations)})
    for before, after in zip(rows, rows[1:]):
        need(before[0].timestamp() < after[0].timestamp(), "weather_order",
             "Keep observed weather in strictly increasing timestamp order.")
        need(before[1].timestamp() <= after[0].timestamp() + 0.001, "weather_overlap",
             "Observed weather intervals overlap.")
    first, last = meter_rows[0][0].timestamp(), meter_rows[-1][1].timestamp()
    chosen = [row for row in rows if row[1].timestamp() > first and row[0].timestamp() < last]
    need(bool(chosen) and abs(chosen[0][0].timestamp() - first) < 0.001
         and abs(chosen[-1][1].timestamp() - last) < 0.001,
         "weather_coverage", "Observed weather must cover every complete selected energy interval.",
         {"meterStart": meter_rows[0][0].isoformat(), "meterEnd": meter_rows[-1][1].isoformat()})
    for before, after in zip(chosen, chosen[1:]):
        need(abs(before[1].timestamp() - after[0].timestamp()) < 0.001, "weather_gap",
             "Observed weather is missing an interval within the model period.",
             {"beforeCsvLine": before[3], "afterCsvLine": after[3]})
    return rows, chosen, {"originalRows": len(original_rows), "selectedRows": len(chosen),
                          "units": units, "nativeUnits": "F", "interval": weather_interval,
                          "stations": sorted(stations), "columns": columns}


def window(value, rows, tz_name, label):
    if value is None:
        return None
    need(isinstance(value, dict) and set(value) == {"start", "end"}, "period_shape",
         f"Choose both original boundaries for the {label} period.")
    start = timestamp(value["start"], tz_name, label).timestamp()
    end = timestamp(value["end"], tz_name, label).timestamp()
    chosen = [i for i, row in enumerate(rows)
              if row[0].timestamp() >= start and row[1].timestamp() <= end]
    need(len(chosen) >= 3 and rows[chosen[0]][0].timestamp() == start
         and rows[chosen[-1]][1].timestamp() == end, "period_boundary",
         f"The {label} period must contain at least three whole original readings.")
    return {"start": start, "end": end, "indices": [index + 1 for index in chosen],
            "original": value}


def csv_bytes(header, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def outputs_in(root):
    outputs = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        if relative in ("result.json", "operation.lock") or ".pending-" in relative:
            continue
        body = path.read_bytes()
        media = ({".rds": "application/x-r-rds", ".R": "text/plain", ".log": "text/plain",
                  ".csv": "text/csv", ".json": "application/json"}.get(path.suffix)
                 or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        outputs.append({"name": relative, "path": str(path), "mime": media,
                        "bytes": len(body), "sha256": sha256(body)})
    return outputs


def valid_saved_result(path, digest, root):
    if not path.exists():
        return None
    result = json.loads(ordinary_file(path))
    need(result.get("metadata", {}).get("inputSha256") == digest,
         "analysis_input_changed", "The retained analysis belongs to different original input.")
    if not result.get("metadata", {}).get("terminal"):
        return None
    for entry in result.get("outputs", []):
        target = root / entry["name"]
        need(target.resolve().is_relative_to(root) and not target.is_symlink(),
             "analysis_output_path", "A retained analysis output escaped its original directory.")
        body = ordinary_file(target)
        need(len(body) == entry["bytes"] and sha256(body) == entry["sha256"],
             "analysis_output_changed", "A retained complete analysis output differs.",
             {"name": entry["name"]})
        entry["path"] = str(target)
    return result


def _run(selection, weather_bytes, weather_metadata, model_options, root, lease_fd):
    options = dict(model_options or {})
    need(isinstance(selection, dict) and isinstance(weather_metadata, dict), "analysis_shape",
         "Supply the original selection and weather metadata.")
    unknown = sorted(set(options) - OPTIONS)
    need(not unknown, "model_options_unknown", "The model options contain unsupported fields.",
         {"fields": unknown})
    script = Path(__file__).with_name("native_analysis.R")
    script_body = ordinary_file(script)
    wrapper_body = ordinary_file(Path(__file__))
    original = ordinary_file(selection.get("sourceXmlPath", ""))
    need(sha256(original) == selection.get("sourceSha256"), "source_hash",
         "The selected original XML differs from its saved source hash.")
    need(isinstance(weather_bytes, bytes), "weather_bytes", "Pass the complete original weather bytes.")
    need(weather_metadata.get("sha256") in (None, sha256(weather_bytes))
         and weather_metadata.get("bytes") in (None, len(weather_bytes)),
         "weather_hash", "The weather bytes differ from the saved original metadata.")
    source_selection = {key: value for key, value in selection.items() if key != "sourceXmlPath"}
    identity = {"schema": SCHEMA, "selection": source_selection, "weather": weather_metadata,
                "weatherSha256": sha256(weather_bytes), "modelOptions": options,
                "nativeScriptSha256": sha256(script_body), "wrapperSha256": sha256(wrapper_body)}
    digest = sha256(encoded(identity))
    saved = valid_saved_result(root / "result.json", digest, root)
    if saved is not None:
        return saved
    json_file(root / "input.json", identity, immutable=True)
    json_file(root / "selection.json", source_selection, immutable=True)
    atomic(root / "original.xml", original, immutable=True)
    atomic(root / "weather.csv", weather_bytes, immutable=True)
    json_file(root / "weather-metadata.json", weather_metadata, immutable=True)
    atomic(root / "native_analysis.R", script_body, immutable=True)
    metadata = {"schema": SCHEMA, "inputSha256": digest, "selectionSha256": selection.get("selectionSha256"),
                "sourceSha256": sha256(original), "weatherSha256": sha256(weather_bytes),
                "nmecrExpected": {"version": NMECR_VERSION, "sourceCommit": NMECR_COMMIT},
                "nativeScriptSha256": sha256(script_body), "startedAt": dt.datetime.now(UTC).isoformat(),
                "terminal": False}
    diagnostics = []
    native = None
    status = "failed"
    try:
        rows, interval = selected_readings(selection, options)
        unassigned = [row[3].get("key") for row in rows if not row[3].get("buildingKeys")]
        metadata["buildingScope"] = {
            "buildingKey": selection["building"]["key"],
            "assignment": "operator-selected" if unassigned else "original-source-linked",
            "originalUnassignedReadingKeys": unassigned,
        }
        if unassigned:
            diagnostics.append({"code": "operator_building_scope",
                "message": "The selected building is an explicit operator choice for originally unassigned readings.",
                "details": {"buildingKey": selection["building"]["key"], "unassignedReadings": len(unassigned)}})
        all_weather, chosen_weather, weather_info = weather_rows(weather_bytes, options, rows, interval)
        models = options.get("models", list(MODELS))
        need(isinstance(models, list) and bool(models) and len(models) == len(set(models))
             and all(model in MODELS for model in models), "models_invalid",
             "Choose named models from the complete native model catalog.")
        arguments = options.get("modelArguments", {})
        need(isinstance(arguments, dict) and set(arguments) <= MODEL_ARGUMENTS,
             "model_arguments", "Use the documented native model arguments.")
        baseline = window(options.get("baseline"), rows, options.get("sourceTimezone"), "baseline")
        reporting = window(options.get("reporting"), rows, options.get("sourceTimezone"), "reporting")
        need(not reporting or bool(baseline), "baseline_required",
             "Choose a baseline period before requesting reporting-period savings.")
        need(not reporting or not (set(reporting["indices"]) & set(baseline["indices"])),
             "period_overlap", "Baseline and reporting periods must use different original readings.")
        normalization = options.get("normalization")
        if normalization is not None:
            need(bool(reporting) and isinstance(normalization, dict)
                 and set(normalization) == {"start", "end"}, "normalization_period",
                 "Normalized savings needs explicit baseline, reporting, and weather periods.")
            ns = timestamp(normalization["start"], options.get("weatherTimezone"), "normalization").timestamp()
            ne = timestamp(normalization["end"], options.get("weatherTimezone"), "normalization").timestamp()
            weather_window = [row for row in all_weather
                              if row[0].timestamp() >= ns and row[1].timestamp() <= ne]
            need(bool(weather_window) and weather_window[0][0].timestamp() == ns
                 and weather_window[-1][1].timestamp() == ne, "normalization_weather",
                 "The original observed weather must cover the entire normalization period.")
            for left, right in zip(weather_window, weather_window[1:]):
                need(left[1].timestamp() == right[0].timestamp(), "normalization_weather_gap",
                     "The normalization weather has a missing interval.")
            normalization = {"start": ns, "end": ne, "original": normalization}
        model_tz = options.get("sourceTimezone")
        if not model_tz:
            first_offset = rows[0][0].utcoffset()
            need(first_offset == dt.timedelta(0) and all(row[0].utcoffset() == first_offset for row in rows),
                 "source_timezone_required",
                 "Choose the building's IANA timezone for modeling time-of-week.")
            model_tz = "UTC"
        zone(model_tz, "model")
        atomic(root / "meter-native.csv", csv_bytes(
            ["time", "end", "eload", "readingKey", "originalStart", "originalEnd", "originalValue"],
            [[row[0].timestamp(), row[1].timestamp(), format(row[2], ".17g"),
              row[3].get("key"), row[3].get("start"), row[3].get("end"), row[3].get("value")] for row in rows]),
               immutable=True)
        atomic(root / "weather-native.csv", csv_bytes(
            ["time", "end", "temp", "csvLine", "originalValue"],
            [[row[0].timestamp(), row[1].timestamp(), format(row[2], ".17g"), row[3], row[4]]
             for row in all_weather]), immutable=True)
        request = {"schema": SCHEMA, "inputSha256": digest, "directory": str(root),
                   "timezone": model_tz, "interval": interval, "models": models,
                   "arguments": arguments, "balancePoint": number(options.get("balancePoint", 65), "balance point"),
                   "confidenceLevel": number(options.get("confidenceLevel", 90), "confidence level"),
                   "allowNegativePredictions": bool(options.get("allowNegativePredictions", False)),
                   "seed": options.get("seed", 20261012), "baseline": baseline, "reporting": reporting,
                   "normalization": normalization, "units": selection["units"],
                   "expectedRows": len(rows), "weather": weather_info,
                   "source": {"id": selection.get("sourceId"), "revisionId": selection.get("revisionId"),
                              "building": selection["building"], "scenario": selection["scenario"],
                              "resource": selection["resource"], "readingType": selection["readingType"]}}
        need(0 < request["confidenceLevel"] < 100, "confidence_level",
             "The confidence level must be between zero and 100.")
        need(isinstance(request["seed"], int) and 0 <= request["seed"] <= 2147483647,
             "seed_invalid", "Use an integer random seed from zero through 2147483647.")
        timeout = number(options.get("timeoutSeconds", 3600), "timeout")
        need(30 <= timeout <= 86400, "timeout_invalid", "Choose an execution timeout of 30 to 86400 seconds.")
        json_file(root / "native-request.json", request, immutable=True)
        rscript = os.environ.get("AUDIT_RSCRIPT", "Rscript")
        command = [rscript, "--vanilla", str(root / "native_analysis.R"), str(root / "native-request.json")]
        json_file(root / "invocation.json", {"argv": command, "inputSha256": digest,
                  "startedAt": metadata["startedAt"], "timeoutSeconds": timeout,
                  "leaseInherited": lease_fd is not None})
        with (root / "native-stdout.log").open("ab", buffering=0) as stdout, \
             (root / "native-stderr.log").open("ab", buffering=0) as stderr:
            process = subprocess.Popen(command, cwd=root, stdout=stdout, stderr=stderr,
                                       pass_fds=(lease_fd,), start_new_session=True,
                                       env=dict(os.environ, TZ=model_tz))
            metadata["pid"] = process.pid
            try:
                returncode = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise AnalysisInputError("native_timeout",
                                         "The native model run reached its execution timeout; completed models are retained.")
        metadata["nativeExit"] = returncode
        json_file(root / "native-exit.json", {"exitCode": returncode, "inputSha256": digest,
                  "at": dt.datetime.now(UTC).isoformat()})
        native_path = root / "native-result.json"
        if native_path.exists():
            native = json.loads(ordinary_file(native_path))
            need(native.get("inputSha256") == digest, "native_result_identity",
                 "The native result belongs to different original input.")
            diagnostics.extend(native.get("diagnostics") or [])
            status = native.get("status", "failed")
            metadata["native"] = native.get("metadata", {})
            metadata["models"] = native.get("models", [])
            metadata["terminal"] = bool(native.get("terminal")) and returncode == 0
        else:
            diagnostics.append({"code": "native_exit", "message": "The native process returned before its final result.",
                                "details": {"exitCode": returncode}})
        metadata["inputRows"] = len(rows)
        metadata["interval"] = interval
        metadata["weather"] = weather_info
    except AnalysisInputError as exc:
        status = "needs-input" if exc.code not in ("native_timeout", "native_result_identity") else "failed"
        diagnostics.append({"code": exc.code, "message": str(exc), "details": exc.details})
        metadata["terminal"] = exc.code not in ("native_timeout", "native_result_identity")
    except FileNotFoundError as exc:
        status = "needs-runtime"
        diagnostics.append({"code": "runtime_unavailable",
                            "message": "Install the pinned native analysis runtime on this host.",
                            "details": {"filename": exc.filename}})
    except Exception as exc:
        diagnostics.append({"code": "analysis_error", "message": str(exc),
                            "details": {"type": type(exc).__name__}})
        atomic(root / "python-error.log", traceback.format_exc().encode("utf-8"))
    metadata["finishedAt"] = dt.datetime.now(UTC).isoformat()
    metadata["resumable"] = not metadata["terminal"] and status in ("needs-runtime", "failed")
    result = {"status": status, "outputs": outputs_in(root), "diagnostics": diagnostics,
              "metadata": metadata}
    json_file(root / "result.json", result)
    return result


def run_analysis(selection, weather_bytes, weather_metadata, model_options, workdir, *, lease_fd=None):
    """Run or resume one complete native analysis in its original owned directory.

    A supplied lease remains held by every native descendant. The caller owns its
    lifetime. Direct callers receive an equivalent nonblocking local directory
    lease and a useful busy result if another native invocation still holds it.
    """
    root = Path(workdir).expanduser().absolute()
    need(root.resolve() == root, "analysis_path", "Use an ordinary absolute analysis directory.")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    if lease_fd is not None:
        os.fstat(lease_fd)
        return _run(selection, weather_bytes, weather_metadata, model_options, root, lease_fd)
    lock_path = root / "operation.lock"
    need(not lock_path.is_symlink(), "analysis_path", "The analysis lease must be an ordinary file.")
    with lock_path.open("a+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "running", "outputs": [], "diagnostics": [],
                    "metadata": {"schema": SCHEMA, "directory": str(root), "leaseHeld": True}}
        return _run(selection, weather_bytes, weather_metadata, model_options, root, lock.fileno())
