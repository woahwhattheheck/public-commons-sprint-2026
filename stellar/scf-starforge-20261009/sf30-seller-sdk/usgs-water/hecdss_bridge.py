#!/usr/bin/env python3
"""Original HEC-DSS 0.1.33 write/read bridge for retained USGS observations.

No network, installation, resampling, unit conversion, timezone conversion, or
daily-label shift occurs here. The caller supplies the reviewed wall-clock and
zone convention. Native stdout/stderr belongs to the caller's retained run log.

probe  --result NEW_JSON
write  --request REQUEST_JSON --output-dir NEW_DIRECTORY
verify --request REQUEST_JSON --file EXISTING_DSS --result NEW_JSON
"""
from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
import locale
import math
import os
from pathlib import Path
import platform
import re
import stat
import struct
import sys
import tempfile
import time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

REQUEST_SCHEMA = "starforge.usgs-dss-native.v1"
RESULT_SCHEMA = "starforge.usgs-dss-native-result.v1"
BINDING_VERSION = "0.1.33"
RELEASE_COMMIT = "db04b43a460678939e461105adc622e7df389a08"
RELEASE_WHEEL_SHA256 = "acbf8b5c94e84db6db57a29bf0a4dee449a5819a03ad4b801bee6534b2ae86b5"
MAX_REQUEST_BYTES = 64 * 1024 * 1024
MAX_MISMATCH_SAMPLES = 50
MISSING = -3.4028234663852886e38
CLOCK = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
IRREGULAR_BLOCKS = {"ir-day", "ir-month", "ir-year", "ir-decade", "ir-century"}
PINNED_PYTHON_BLOBS = {
    "hecdss.py": "fecaaacdc66181aa2dda2cd4a4e34558e2726c97",
    "native.py": "9d91e6e36a950d19ed2d0b4b853b01a0393452bf",
    "regular_timeseries.py": "bac6001bf93510846971d7c8c3542cf0ebf8d8a3",
    "irregular_timeseries.py": "5bab01425f531058cd56ab4547afc192708ca16b",
    "dateconverter.py": "d35222d086040b8454f8cbc73bbcd4214c7f086c",
    "catalog.py": "cf504f746415c587af142b41b699f2baf862c62a",
}


class BridgeFailure(Exception):
    def __init__(self, code: str, message: str, **detail: Any):
        super().__init__(message)
        self.code = code
        self.detail = detail

    def record(self) -> dict[str, Any]:
        return {"code": self.code, "message": str(self), **self.detail}


def need(condition: bool, code: str, message: str, **detail: Any) -> None:
    if not condition:
        raise BridgeFailure(code, message, **detail)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def absolute(path: str | Path) -> Path:
    path = Path(path)
    need(path.is_absolute(), "ABSOLUTE_PATH_REQUIRED", "Use an absolute retained file path.", path=str(path))
    return path


def fingerprint(st: os.stat_result) -> tuple[int, int, int, int]:
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns


def open_regular(path: Path):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "REGULAR_FILE_REQUIRED",
             "The selected input is not a regular file.", path=str(path))
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def file_identity(path: Path) -> dict[str, Any]:
    with open_regular(path) as handle:
        before = os.fstat(handle.fileno())
        digest = hashlib.sha256()
        count = 0
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            count += len(block)
        after = os.fstat(handle.fileno())
    need(fingerprint(before) == fingerprint(after) and count == before.st_size,
         "INPUT_CHANGED", "The retained file changed while it was read.", path=str(path))
    need(fingerprint(os.stat(path, follow_symlinks=False)) == fingerprint(after),
         "INPUT_REPLACED", "The retained file path changed while it was read.", path=str(path))
    return {"path": str(path), "bytes": count, "sha256": digest.hexdigest()}


def pairs_unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "DUPLICATE_JSON_KEY", "A JSON object repeats a field.", field=key)
        value[key] = item
    return value


def reject_constant(value: str):
    raise BridgeFailure("NONFINITE_JSON", "JSON must not contain NaN or Infinity.", value=value)


def load_request(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    with open_regular(path) as handle:
        before = os.fstat(handle.fileno())
        need(before.st_size <= MAX_REQUEST_BYTES, "REQUEST_TOO_LARGE",
             "The native JSON request exceeds the 64 MiB file limit.", bytes=before.st_size)
        raw = handle.read(MAX_REQUEST_BYTES + 1)
        after = os.fstat(handle.fileno())
    need(len(raw) <= MAX_REQUEST_BYTES and fingerprint(before) == fingerprint(after),
         "INPUT_CHANGED", "The request changed while it was read.")
    need(fingerprint(os.stat(path, follow_symlinks=False)) == fingerprint(after),
         "INPUT_REPLACED", "The request path changed while it was read.")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs_unique,
                           parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise BridgeFailure("INVALID_REQUEST_JSON", "The request is not complete UTF-8 JSON.",
                            detail=str(error)) from error
    need(isinstance(value, dict) and value.get("schema") == REQUEST_SCHEMA,
         "REQUEST_SCHEMA", "The native request schema is not supported.",
         expected=REQUEST_SCHEMA)
    return value, {"path": str(path), "bytes": len(raw),
                   "sha256": hashlib.sha256(raw).hexdigest()}


def utf8(value: Any, field: str, *, nonempty: bool = True, maximum: int | None = None) -> str:
    need(isinstance(value, str), "STRING_REQUIRED", "A native text field must be a string.", field=field)
    need(not nonempty or bool(value), "EMPTY_FIELD", "A required native text field is empty.", field=field)
    need("\0" not in value, "EMBEDDED_NUL", "Native strings cannot contain NUL.", field=field)
    try:
        encoded = value.encode("utf-8")
    except UnicodeError as error:
        raise BridgeFailure("INVALID_UNICODE", "A text field contains an incomplete Unicode character.",
                            field=field) from error
    need(maximum is None or len(encoded) <= maximum, "TEXT_TOO_LONG",
         "A native text field exceeds its exact UTF-8 readback capacity.",
         field=field, maximumBytes=maximum, actualBytes=len(encoded))
    return value


def path_parts(value: str, *, request: bool) -> list[str]:
    parts = value.split("/")
    need(len(parts) == 8 and parts[0] == "" and parts[-1] == "",
         "DSS_PATHNAME", "DSS pathnames require exactly /A/B/C/D/E/F/.", pathname=value)
    parts = parts[1:-1]
    need(all(not any(ord(c) < 32 or ord(c) == 127 for c in p) for p in parts),
         "DSS_PATHNAME", "DSS pathname parts cannot contain control characters.", pathname=value)
    if request:
        need(parts[3] == "", "DSS_DATE_PART",
             "The bridge writes a logical series; its pathname D part must be blank.", pathname=value)
        need(all(parts[i] == parts[i].upper() for i in (0, 1, 2, 5)),
             "DSS_CANONICAL_PATH", "A/B/C/F pathname parts must use the reviewed uppercase form.",
             pathname=value)
    return parts


def logical_path(value: str) -> str:
    parts = path_parts(value, request=False)
    parts[3] = ""
    return ("/" + "/".join(parts) + "/").upper()


@dataclass
class Series:
    key: str
    pathname: str
    kind: str
    interval: str
    times: list[datetime]
    clocks: list[str]
    values: list[float | None]
    units: str
    data_type: str
    time_zone: str
    zone: ZoneInfo
    quality: list[int]
    notes: list[str]
    granularity: int = 1

    @property
    def count(self) -> int:
        return len(self.times)

    @property
    def missing_count(self) -> int:
        return sum(value is None for value in self.values)


def validate_request(value: dict[str, Any]) -> list[Series]:
    raw_series = value.get("series")
    need(isinstance(raw_series, list) and bool(raw_series),
         "SERIES_REQUIRED", "Select at least one complete series.")
    seen_keys: set[str] = set()
    seen_paths: set[str] = set()
    result = []
    for ordinal, raw in enumerate(raw_series):
        need(isinstance(raw, dict), "SERIES_OBJECT", "Each series must be an object.", index=ordinal)
        key = utf8(raw.get("key"), "series.key")
        need(key not in seen_keys, "DUPLICATE_SERIES_KEY", "Series keys must be unique.", key=key)
        pathname = utf8(raw.get("pathname"), key + ".pathname")
        parts = path_parts(pathname, request=True)
        identity = logical_path(pathname)
        need(identity not in seen_paths, "DUPLICATE_DSS_SERIES",
             "Two request series select the same native DSS identity.", key=key, pathname=pathname)
        kind = raw.get("kind")
        need(kind in ("regular", "irregular"), "SERIES_KIND",
             "A series must explicitly select regular or irregular.", key=key)
        interval = utf8(raw.get("interval"), key + ".interval")
        need(parts[4].casefold() == interval.casefold(), "INTERVAL_PATH_MISMATCH",
             "The selected interval/block and pathname E part differ.", key=key)
        if kind == "irregular":
            need(interval.casefold() in IRREGULAR_BLOCKS, "IRREGULAR_BLOCK",
                 "An irregular series requires an explicit Ir-Day/Month/Year/Decade/Century block.",
                 key=key)
        units = utf8(raw.get("units"), key + ".units", maximum=39)
        data_type = utf8(raw.get("dataType"), key + ".dataType", maximum=39)
        need(data_type == data_type.upper(), "DATA_TYPE_CASE",
             "Use the explicit native measurement type, such as INST-VAL or PER-AVER.", key=key)
        time_zone = utf8(raw.get("timeZone"), key + ".timeZone", maximum=39)
        try:
            zone = ZoneInfo(time_zone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise BridgeFailure("TIME_ZONE", "The exact IANA time zone is unavailable.",
                                key=key, timeZone=time_zone) from error
        raw_times, raw_values = raw.get("times"), raw.get("values")
        need(isinstance(raw_times, list) and len(raw_times) > 0 and
             isinstance(raw_values, list) and len(raw_times) == len(raw_values),
             "SERIES_LENGTH", "Complete times and values must have the same nonzero length.", key=key)
        need(len(raw_times) < 2147483647, "SERIES_LENGTH", "The native row count exceeds int32.", key=key)
        times, clocks, values = [], [], []
        for row, (clock, value_at_row) in enumerate(zip(raw_times, raw_values)):
            need(isinstance(clock, str) and CLOCK.fullmatch(clock) is not None,
                 "WHOLE_SECOND_CLOCK", "Each time must be a naive YYYY-MM-DDTHH:MM:SS clock.",
                 key=key, row=row)
            try:
                stamp = datetime.fromisoformat(clock)
            except ValueError as error:
                raise BridgeFailure("INVALID_CLOCK", "A supplied calendar clock is invalid.",
                                    key=key, row=row, clock=clock) from error
            need(stamp.strftime("%Y") == f"{stamp.year:04d}", "DATE_REPRESENTATION",
                 "This binding cannot format the selected year as a four-digit DSS date.",
                 key=key, row=row)
            need(not times or stamp > times[-1], "TIME_ORDER",
                 "Times must be strictly increasing; duplicate observations need a reviewed source decision.",
                 key=key, row=row)
            localized = stamp.replace(tzinfo=zone, fold=0)
            round_trip = localized.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
            need(round_trip == stamp, "NONEXISTENT_LOCAL_CLOCK",
                 "The selected local clock does not exist in this time zone.", key=key, row=row)
            need(localized.utcoffset() == stamp.replace(tzinfo=zone, fold=1).utcoffset(),
                 "AMBIGUOUS_LOCAL_CLOCK",
                 "This local clock has two offsets; normalize the original observation to an explicit UTC clock.",
                 key=key, row=row)
            if value_at_row is None:
                numeric = None
            else:
                need(type(value_at_row) in (int, float), "FLOAT64_VALUE",
                     "A value must be a finite float64 number or null.", key=key, row=row)
                try:
                    numeric = float(value_at_row)
                except (ValueError, OverflowError) as error:
                    raise BridgeFailure("FLOAT64_VALUE", "A value is outside float64.",
                                        key=key, row=row) from error
                need(math.isfinite(numeric), "FLOAT64_VALUE", "A value is not finite.", key=key, row=row)
                need(type(value_at_row) is not int or int(numeric) == value_at_row,
                     "FLOAT64_INTEGER_LOSS", "An integer cannot be represented exactly as float64.",
                     key=key, row=row)
                need(numeric != MISSING, "MISSING_VALUE_COLLISION",
                     "Use null for missing; a numeric observation equals the DSS missing sentinel.",
                     key=key, row=row)
            times.append(stamp)
            clocks.append(clock)
            values.append(numeric)
        quality = raw.get("quality", [])
        notes = raw.get("notes", [])
        need(isinstance(quality, list) and len(quality) in (0, len(times)), "QUALITY_LENGTH",
             "Quality must be absent/empty or one signed int32 word per observation.", key=key)
        need(all(type(q) is int and -(2**31) <= q < 2**31 for q in quality), "QUALITY_INT32",
             "Each quality word must be a signed int32 integer.", key=key)
        need(isinstance(notes, list) and len(notes) in (0, len(times)), "NOTES_LENGTH",
             "Notes must be absent/empty or contain exactly one note per observation.", key=key)
        for row, note in enumerate(notes):
            utf8(note, f"{key}.notes[{row}]", nonempty=False, maximum=39)
        plan = Series(key, pathname, kind, interval, times, clocks, values, units,
                      data_type, time_zone, zone, quality, notes)
        if kind == "irregular":
            try:
                base = times[0].replace(hour=0, minute=0, second=0) - timedelta(days=1)
            except OverflowError as error:
                raise BridgeFailure("DATE_REPRESENTATION", "The irregular Julian base is outside datetime.",
                                    key=key) from error
            offsets = [(t - base).days * 86400 + (t - base).seconds for t in times]
            choices = [grain for grain in (1, 60, 3600, 86400)
                       if max(offsets) // grain < 2147483647 and
                       all(offset % grain == 0 for offset in offsets)]
            need(bool(choices), "IRREGULAR_TIME_RANGE",
                 "No supported int32 time granularity preserves every supplied clock exactly.", key=key)
            plan.granularity = choices[0]
        seen_keys.add(key)
        seen_paths.add(identity)
        result.append(plan)
    return result

class Engine:
    def __init__(self):
        self.meta: dict[str, Any] = {
            "package": "hecdss",
            "requiredVersion": BINDING_VERSION,
            "releaseCommit": RELEASE_COMMIT,
            "releaseWheelSha256": RELEASE_WHEEL_SHA256,
            "python": platform.python_version(),
            "executable": sys.executable,
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "dateLocale": locale.setlocale(locale.LC_TIME, "C"),
        }
        self.HecDss = self.RegularTimeSeries = self.IrregularTimeSeries = None
        self.native = None

    def load(self) -> None:
        try:
            version = importlib.metadata.version("hecdss")
        except importlib.metadata.PackageNotFoundError as error:
            raise BridgeFailure("BINDING_NOT_INSTALLED",
                                "The official hecdss 0.1.33 binding is not installed in this Python environment.") from error
        self.meta["version"] = version
        need(version == BINDING_VERSION, "BINDING_VERSION",
             "Use the pinned official binding version for this retained run.",
             expected=BINDING_VERSION, actual=version)
        try:
            import hecdss
            from hecdss import HecDss, RegularTimeSeries, IrregularTimeSeries
            from hecdss.hecdss import DSS_UNDEFINED_VALUE
            from hecdss.native import _Native
            from hecdss.dateconverter import DateConverter
            import hecdss.native as native_module
            self.HecDss, self.RegularTimeSeries = HecDss, RegularTimeSeries
            self.IrregularTimeSeries = IrregularTimeSeries
            self.DateConverter = DateConverter
            need(float(DSS_UNDEFINED_VALUE) == MISSING, "MISSING_SENTINEL",
                 "The loaded binding has a different missing-value definition.")
            self.native = _Native()
            package_dir = Path(hecdss.__file__).resolve().parent
            self.meta["packagePath"] = str(package_dir)
            name = os.fsdecode(self.native.dll._name)
            library_path = Path(name).resolve(strict=True)
            expected_library = Path(native_module.__file__).resolve().parent / "lib" / (
                "hecdss.dll" if sys.platform == "win32" else "libhecdss.so")
            need(library_path == expected_library.resolve(strict=True), "NATIVE_LIBRARY_SHADOW",
                 "The loader selected a library outside the installed official binding. Use a controlled working directory.",
                 selected=str(library_path), packaged=str(expected_library))
            self.meta["native"] = file_identity(library_path)
            self.meta["native"]["apiVersion"] = None
            api_version = getattr(self.native.dll, "hec_dss_api_version", None)
            if api_version is not None:
                api_version.argtypes = []
                api_version.restype = ctypes.c_char_p
                raw_version = api_version()
                self.meta["native"]["apiVersion"] = raw_version.decode("ascii", errors="strict") if raw_version else None
            file_version = getattr(self.native.dll, "hec_dss_getFileVersion", None)
            need(file_version is not None, "NATIVE_FILE_VERSION_API",
                 "The loaded native library does not expose its documented DSS file-version query.")
            file_version.argtypes = [ctypes.c_char_p]
            file_version.restype = ctypes.c_int
            self.file_version_api = file_version
            source_files = []
            for filename, expected_blob in PINNED_PYTHON_BLOBS.items():
                source_path = package_dir / filename
                identity = file_identity(source_path)
                raw = source_path.read_bytes()
                git_blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
                source_files.append({**identity, "gitBlob": git_blob,
                                     "releaseGitBlob": expected_blob, "releaseMatch": git_blob == expected_blob})
            self.meta["pythonSources"] = source_files
            self.meta["pythonSourcesMatchRelease"] = all(row["releaseMatch"] for row in source_files)
            self.meta["missingValue"] = MISSING
            self.meta["supports"] = {
                "fileVersion": 7,
                "regularMinimumIntervalSeconds": 60,
                "irregularWholeSeconds": True,
                "qualityWordsPerObservation": 1,
                "noteMaximumUtf8Bytes": 39,
                "timezoneConversion": False,
                "dailyLabelShift": False,
            }
        except BridgeFailure:
            raise
        except (ImportError, OSError, AttributeError, UnicodeError, ValueError) as error:
            raise BridgeFailure("NATIVE_ENGINE_LOAD", "The installed native binding could not be loaded.",
                                detail=str(error)) from error

    def unchanged(self) -> None:
        observed = file_identity(Path(self.meta["native"]["path"]))
        need(observed["sha256"] == self.meta["native"]["sha256"], "ENGINE_CHANGED",
             "The native library changed during the retained run.")

    def check_open_engine(self, dss) -> None:
        observed = Path(os.fsdecode(dss._native.dll._name)).resolve(strict=True)
        need(str(observed) == self.meta["native"]["path"], "ENGINE_CHANGED",
             "This DSS handle loaded a different native library.", selected=str(observed))

    def file_version(self, path: Path) -> int:
        observed = int(self.file_version_api(os.fsencode(path)))
        need(observed == 7, "DSS_FILE_VERSION",
             "The selected output is not a DSS7 file.", actual=observed, path=str(path))
        return observed

    def container(self, plan: Series):
        values = [MISSING if value is None else value for value in plan.values]
        common = dict(values=values, quality=plan.quality, notes=plan.notes,
                      units=plan.units, data_type=plan.data_type,
                      time_zone_name=plan.time_zone, path=plan.pathname)
        try:
            if plan.kind == "regular":
                seconds = self.DateConverter.intervalString_to_sec(plan.interval)
                need(type(seconds) is int and seconds >= 60, "REGULAR_INTERVAL",
                     "The public 0.1.33 regular reader requires a supported interval of at least one minute; use an irregular series for exact second-level observations.",
                     key=plan.key, interval=plan.interval)
                need(all(stamp.second == 0 for stamp in plan.times), "REGULAR_WINDOW_PRECISION",
                     "The public regular reader's explicit window is minute-aligned; use irregular storage to retain these exact clocks.",
                     key=plan.key)
                container = self.RegularTimeSeries.create(
                    start_date=plan.times[0], interval=plan.interval, **common)
                generated = [stamp.replace(tzinfo=None).isoformat(timespec="seconds")
                             for stamp in container.times]
                mismatch = next((row for row in range(max(len(generated), plan.count))
                                 if (generated[row] if row < len(generated) else None) !=
                                 (plan.clocks[row] if row < plan.count else None)), None)
                need(mismatch is None, "REGULAR_GRID",
                     "The complete supplied clock sequence does not match the official regular interval. Preserve it as irregular or correct the explicit mapping.",
                     key=plan.key, row=mismatch,
                     expected=generated[mismatch] if mismatch is not None and mismatch < len(generated) else None,
                     supplied=plan.clocks[mismatch] if mismatch is not None and mismatch < plan.count else None)
                return container
            return self.IrregularTimeSeries.create(
                times=plan.times, interval=0, time_granularity_seconds=plan.granularity, **common)
        except BridgeFailure:
            raise
        except Exception as error:
            raise BridgeFailure("NATIVE_SERIES_CONSTRUCTION",
                                "The original binding could not represent the selected series.",
                                key=plan.key, detail=str(error)) from error


def serializable(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return repr(value)


class Differences:
    def __init__(self):
        self.counts: dict[str, int] = {}
        self.samples: list[dict[str, Any]] = []

    def add(self, field: str, expected: Any, actual: Any, row: int | None = None) -> None:
        self.counts[field] = self.counts.get(field, 0) + 1
        if len(self.samples) < MAX_MISMATCH_SAMPLES:
            item = {"field": field, "expected": serializable(expected), "actual": serializable(actual)}
            if row is not None:
                item["row"] = row
            self.samples.append(item)

    def equal(self, field: str, expected: Any, actual: Any, row: int | None = None) -> None:
        if expected != actual:
            self.add(field, expected, actual, row)

    def report(self) -> dict[str, Any]:
        total = sum(self.counts.values())
        return {"mismatchCount": total, "mismatchCountsByField": self.counts,
                "mismatches": self.samples, "mismatchesTruncated": total > len(self.samples)}


def exact_float(left: float, right: float) -> bool:
    return struct.pack(">d", left) == struct.pack(">d", right)


def compare_series(plan: Series, actual, engine: Engine, records: list[dict[str, Any]]) -> dict[str, Any]:
    differences = Differences()
    actual_times = list(actual.times)
    actual_values = list(actual.values)
    actual_quality = list(actual.quality)
    actual_notes = list(actual.notes)
    actual_kind = "regular" if isinstance(actual, engine.RegularTimeSeries) else (
        "irregular" if isinstance(actual, engine.IrregularTimeSeries) else type(actual).__name__)
    differences.equal("kind", plan.kind, actual_kind)
    differences.equal("pathname", logical_path(plan.pathname), logical_path(str(actual.id)))
    differences.equal("rowCount", plan.count, len(actual_values))
    differences.equal("clockCount", plan.count, len(actual_times))
    differences.equal("units", plan.units, actual.units)
    differences.equal("dataType", plan.data_type, actual.data_type)
    differences.equal("timeZone", plan.time_zone, actual.time_zone_name)
    clocks = []
    for row in range(max(plan.count, len(actual_times))):
        expected = plan.clocks[row] if row < plan.count else None
        stamp = actual_times[row] if row < len(actual_times) else None
        actual_clock = stamp.replace(tzinfo=None).isoformat(timespec="seconds") if isinstance(stamp, datetime) else None
        if row < len(actual_times):
            clocks.append(actual_clock)
        differences.equal("times", expected, actual_clock, row)
        if isinstance(stamp, datetime):
            differences.equal("timePrecision", 0, stamp.microsecond, row)
            differences.equal("clockTimeZone", plan.time_zone, getattr(stamp.tzinfo, "key", None), row)
            if row < plan.count:
                expected_offset = plan.times[row].replace(tzinfo=plan.zone).utcoffset()
                differences.equal("clockOffset", str(expected_offset), str(stamp.utcoffset()), row)
    missing_count = 0
    for row in range(max(plan.count, len(actual_values))):
        expected_present = row < plan.count
        actual_present = row < len(actual_values)
        expected = plan.values[row] if expected_present else None
        raw = actual_values[row] if actual_present else None
        try:
            observed = float(raw) if actual_present else None
        except (ValueError, TypeError, OverflowError):
            observed = None
            differences.add("values", expected, raw, row)
        missing = actual_present and observed == MISSING
        missing_count += int(missing)
        if expected_present and actual_present:
            differences.equal("missingMask", expected is None, missing, row)
            if expected is None:
                if not missing:
                    differences.add("values", "DSS missing sentinel", observed, row)
            elif observed is None or not math.isfinite(observed) or not exact_float(expected, observed):
                differences.add("values", expected, observed, row)
        elif expected_present or actual_present:
            differences.add("values", expected if expected_present else "(no row)",
                            observed if actual_present else "(no row)", row)
    differences.equal("qualityCount", len(plan.quality), len(actual_quality))
    for row in range(max(len(plan.quality), len(actual_quality))):
        expected = plan.quality[row] if row < len(plan.quality) else None
        observed = int(actual_quality[row]) if row < len(actual_quality) else None
        differences.equal("quality", expected, observed, row)
    # The wrapper may return N empty notes when no cnotes were supplied.
    expected_notes = plan.notes if plan.notes else [""] * plan.count
    if not actual_notes and all(note == "" for note in expected_notes):
        compared_notes = [""] * plan.count
    else:
        compared_notes = actual_notes
    differences.equal("notesCount", plan.count, len(compared_notes))
    for row in range(max(plan.count, len(compared_notes))):
        expected = expected_notes[row] if row < plan.count else None
        observed = compared_notes[row] if row < len(compared_notes) else None
        differences.equal("notes", expected, observed, row)
    fields = ("kind", "pathname", "rowCount", "clockCount", "times", "timePrecision",
              "units", "dataType", "timeZone", "clockTimeZone", "clockOffset",
              "values", "missingMask", "qualityCount", "quality", "notesCount", "notes")
    return {
        "key": plan.key, "pathname": plan.pathname, "kind": plan.kind,
        "status": "VERIFIED" if not differences.counts else "MISMATCH",
        "interval": plan.interval,
        "expected": {"rows": plan.count, "first": plan.clocks[0], "last": plan.clocks[-1],
                     "missing": plan.missing_count, "units": plan.units, "dataType": plan.data_type,
                     "timeZone": plan.time_zone, "qualityWords": len(plan.quality),
                     "notes": len(plan.notes), "timeGranularitySeconds": plan.granularity},
        "actual": {"rows": len(actual_values), "clocks": len(actual_times),
                   "first": clocks[0] if clocks else None, "last": clocks[-1] if clocks else None,
                   "missing": missing_count, "units": actual.units, "dataType": actual.data_type,
                   "timeZone": actual.time_zone_name, "qualityWords": len(actual_quality),
                   "notes": len(actual_notes), "timeGranularitySeconds": actual.time_granularity_seconds},
        "checks": {field: field not in differences.counts for field in fields},
        "catalogRecords": records, **differences.report(),
    }


def verify_open_file(path: Path, plans: list[Series], engine: Engine) -> dict[str, Any]:
    engine.file_version(path)
    expected_paths = {logical_path(plan.pathname) for plan in plans}
    series_results = []
    with engine.HecDss(str(path)) as dss:
        engine.check_open_engine(dss)
        native_catalog = dss.get_catalog()
        raw_paths = list(native_catalog.uncondensed_paths)
        raw_types = list(native_catalog.rawRecordTypes)
        need(len(raw_paths) == len(raw_types), "NATIVE_CATALOG_LENGTH",
             "The native catalogue returned different path and type counts.")
        entries = [{"pathname": str(p), "recordType": int(t)}
                   for p, t in zip(raw_paths, raw_types)]
        by_path: dict[str, list[dict[str, Any]]] = {}
        for entry in entries:
            by_path.setdefault(logical_path(entry["pathname"]), []).append(entry)
        actual_paths = set(by_path)
        duplicates = len(raw_paths) != len({str(p).upper() for p in raw_paths})
        record_count = int(dss.record_count())
        missing = sorted(expected_paths - actual_paths)
        unexpected = sorted(actual_paths - expected_paths)
        catalog_verified = not missing and not unexpected and not duplicates and record_count == len(entries)
        catalog = {
            "status": "VERIFIED" if catalog_verified else "MISMATCH",
            "physicalCount": record_count, "rawCount": len(entries),
            "logicalCount": len(actual_paths), "raw": entries,
            "condensed": [str(item) for item in native_catalog],
            "missing": missing, "unexpected": unexpected, "duplicateRawPaths": duplicates,
        }
        for plan in plans:
            records = by_path.get(logical_path(plan.pathname), [])
            if not records:
                series_results.append({
                    "key": plan.key, "pathname": plan.pathname, "kind": plan.kind,
                    "status": "MISMATCH", "expected": {"rows": plan.count, "missing": plan.missing_count},
                    "actual": {"rows": 0}, "checks": {"catalog": False},
                    "mismatchCount": 1, "mismatchCountsByField": {"catalog": 1},
                    "mismatches": [{"field": "catalog", "expected": plan.pathname, "actual": None}],
                    "mismatchesTruncated": False, "catalogRecords": [],
                })
                continue
            try:
                actual = dss.get(plan.pathname, startdatetime=plan.times[0],
                                 enddatetime=plan.times[-1], trim=False)
                series_results.append(compare_series(plan, actual, engine, records))
            except Exception as error:
                series_results.append({
                    "key": plan.key, "pathname": plan.pathname, "kind": plan.kind,
                    "status": "ERROR", "catalogRecords": records,
                    "error": {"code": "NATIVE_READBACK", "message": str(error)},
                })
    engine.unchanged()
    status = "ERROR" if any(row["status"] == "ERROR" for row in series_results) else (
        "VERIFIED" if catalog_verified and all(row["status"] == "VERIFIED" for row in series_results) else "MISMATCH")
    return {"status": status, "series": series_results, "catalog": catalog, "fileVersion": 7}

def fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_file(path: Path) -> None:
    with open_regular(path) as handle:
        os.fsync(handle.fileno())


def new_result_path(path: Path) -> None:
    need(path.parent.is_dir(), "RESULT_PARENT", "The retained result parent directory must exist.",
         path=str(path.parent))
    need(not os.path.lexists(path), "RESULT_EXISTS",
         "The result path already exists. Reopen its original operation or select a new result path.",
         path=str(path))


def save_result(path: Path, result: dict[str, Any]) -> None:
    new_result_path(path)
    data = (json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")
    fd, temporary_name = tempfile.mkstemp(prefix=".hecdss-result-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # Same-filesystem publication is atomic and refuses an existing result.
        os.link(temporary, path, follow_symlinks=False)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def copy_original(source: Path, destination: Path) -> dict[str, Any]:
    with open_regular(source) as reader:
        before = os.fstat(reader.fileno())
        digest = hashlib.sha256()
        count = 0
        with open(destination, "xb") as writer:
            os.chmod(destination, 0o600)
            while True:
                block = reader.read(1024 * 1024)
                if not block:
                    break
                writer.write(block)
                digest.update(block)
                count += len(block)
            writer.flush()
            os.fsync(writer.fileno())
        after = os.fstat(reader.fileno())
    need(fingerprint(before) == fingerprint(after) and count == before.st_size,
         "INPUT_CHANGED", "The selected DSS file changed during the verification copy.", path=str(source))
    need(fingerprint(os.stat(source, follow_symlinks=False)) == fingerprint(after),
         "INPUT_REPLACED", "The selected DSS path changed during the verification copy.", path=str(source))
    return {"path": str(source), "bytes": count, "sha256": digest.hexdigest()}


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    probe = commands.add_parser("probe", help="Inspect the installed official binding; create no DSS file.")
    probe.add_argument("--result", required=True)
    write = commands.add_parser("write", help="Write and independently reopen a new retained DSS7 export.")
    write.add_argument("--request", required=True)
    write.add_argument("--output-dir", required=True)
    verify = commands.add_parser("verify", help="Verify a retained DSS7 file without opening the original for writing.")
    verify.add_argument("--request", required=True)
    verify.add_argument("--file", required=True)
    verify.add_argument("--result", required=True)
    return parser


def main(argv=None) -> int:
    args = make_parser().parse_args(argv)
    os.umask(0o077)
    started_at = now()
    started = time.monotonic()
    result: dict[str, Any] = {
        "schema": RESULT_SCHEMA, "command": args.command, "status": "ERROR",
        "startedAt": started_at, "networkUsed": False,
        "semantics": {
            "times": "Caller-reviewed naive calendar clocks with the exact explicit IANA zone.",
            "dailyLabelsShifted": False, "timezoneConversion": False,
            "unitsConverted": False, "resampled": False,
            "values": "Exact float64; null maps only to the original DSS missing sentinel.",
        },
    }
    result_path = None
    engine = None
    output_dir = None
    created_dss = None
    try:
        if args.command == "write":
            output_dir = absolute(args.output_dir)
            need(output_dir.parent.is_dir(), "OUTPUT_PARENT", "The output parent directory must exist.",
                 path=str(output_dir.parent))
            try:
                output_dir.mkdir(mode=0o700)
            except FileExistsError as error:
                raise BridgeFailure("OUTPUT_EXISTS",
                                    "The output directory already exists. Reopen that retained run or choose a new output directory.",
                                    path=str(output_dir)) from error
            result_path = output_dir / "result.json"
            fsync_directory(output_dir.parent)
        else:
            result_path = absolute(args.result)
            new_result_path(result_path)
        engine = Engine()
        if args.command == "probe":
            engine.load()
            engine.unchanged()
            result["status"] = "READY"
        else:
            request_path = absolute(args.request)
            request, request_identity = load_request(request_path)
            result["request"] = request_identity
            plans = validate_request(request)
            del request
            engine.load()
            # Construct through the original API before opening any target. This
            # validates all generated regular clocks against the supplied grid.
            containers = [engine.container(plan) for plan in plans]
            result["requestedSeries"] = len(plans)
            result["requestedObservations"] = sum(plan.count for plan in plans)
            if args.command == "write":
                created_dss = output_dir / "observations.dss"
                need(not os.path.lexists(created_dss), "DSS_EXISTS", "The new DSS target already exists.")
                result["writes"] = []
                with engine.HecDss(str(created_dss)) as dss:
                    engine.check_open_engine(dss)
                    for plan, container in zip(plans, containers):
                        status = int(dss.put(container))
                        result["writes"].append({"key": plan.key, "pathname": plan.pathname,
                                                 "status": status, "rows": plan.count,
                                                 "timeGranularitySeconds": plan.granularity})
                        need(status == 0, "NATIVE_WRITE", "The native library refused a series write.",
                             key=plan.key, nativeStatus=status)
                os.chmod(created_dss, 0o600)
                sync_file(created_dss)
                fsync_directory(output_dir)
                del containers
                result.update(verify_open_file(created_dss, plans, engine))
                sync_file(created_dss)
                result["dss"] = {**file_identity(created_dss), "fileVersion": 7}
                result["verification"] = {
                    "method": "close_and_reopen",
                    "exactRequestedWindow": True, "trim": False,
                    "allRowsCompared": all("values" in row.get("checks", {}) for row in result["series"]),
                    "maximumMismatchSamplesPerSeries": MAX_MISMATCH_SAMPLES,
                }
            else:
                source_dss = absolute(args.file)
                del containers
                with tempfile.TemporaryDirectory(prefix=".hecdss-verify-", dir=result_path.parent) as scratch:
                    copied = Path(scratch) / "original.dss"
                    original_identity = copy_original(source_dss, copied)
                    copied_before = file_identity(copied)
                    need(copied_before["sha256"] == original_identity["sha256"], "COPY_MISMATCH",
                         "The private verification copy does not match the selected original DSS bytes.")
                    result["dss"] = {**original_identity, "fileVersion": None}
                    result.update(verify_open_file(copied, plans, engine))
                    copied_after = file_identity(copied)
                    original_after = file_identity(source_dss)
                    need(original_after["sha256"] == original_identity["sha256"] and
                         original_after["bytes"] == original_identity["bytes"], "DSS_CHANGED_DURING_VERIFY",
                         "The selected original DSS file changed during verification.")
                    result["dss"] = {**original_identity, "fileVersion": 7}
                    result["verification"] = {
                        "method": "private_exact_copy",
                        "originalOpenedByNative": False,
                        "copyBeforeSha256": copied_before["sha256"],
                        "copyAfterSha256": copied_after["sha256"],
                        "originalUnchanged": True,
                        "exactRequestedWindow": True, "trim": False,
                        "allRowsCompared": all("values" in row.get("checks", {}) for row in result["series"]),
                    "maximumMismatchSamplesPerSeries": MAX_MISMATCH_SAMPLES,
                    }
            final_request = file_identity(request_path)
            need(final_request["sha256"] == request_identity["sha256"] and
                 final_request["bytes"] == request_identity["bytes"], "REQUEST_CHANGED",
                 "The source-bound native request changed during execution.")
            engine.unchanged()
    except BridgeFailure as error:
        result["status"] = "ERROR"
        result["error"] = error.record()
    except Exception as error:
        result["status"] = "ERROR"
        result["error"] = {"code": "NATIVE_OPERATION_ERROR", "message": str(error),
                           "exception": type(error).__name__}
    finally:
        if engine is not None:
            result["engine"] = engine.meta
        result["finishedAt"] = now()
        result["seconds"] = round(time.monotonic() - started, 6)
        if created_dss is not None and created_dss.is_file() and "dss" not in result:
            try:
                result["dss"] = {**file_identity(created_dss), "complete": False}
            except Exception as error:
                result["artifactError"] = str(error)
    # A directory creation/path error must not overwrite an earlier operation.
    if result_path is not None:
        try:
            save_result(result_path, result)
        except Exception as error:
            print(json.dumps({"schema": RESULT_SCHEMA, "status": "ERROR",
                              "error": {"code": "RESULT_NOT_COMMITTED", "message": str(error)},
                              "operationStatus": result["status"]}, ensure_ascii=False), file=sys.stderr)
            return 2
    else:
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), file=sys.stderr)
        return 2
    print(json.dumps({"schema": RESULT_SCHEMA, "status": result["status"],
                      "result": str(result_path)}, ensure_ascii=False))
    return 0 if result["status"] in ("READY", "VERIFIED") else (3 if result["status"] == "MISMATCH" else 2)


if __name__ == "__main__":
    raise SystemExit(main())
