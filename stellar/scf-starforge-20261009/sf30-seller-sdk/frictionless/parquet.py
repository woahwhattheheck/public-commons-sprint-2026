"""MIT. Frictionless projections of the maintained Wherobots Parquet reader.

The original reader owns Arrow decoding, row groups, metadata and typed values.
This adapter only maps those retained values into Frictionless physical scalars.
"""
from __future__ import annotations

import datetime as dt
import importlib
import importlib.metadata
import itertools
import math
import re
import stat
import sys
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UNIT_SCALE = {"s": 1, "ms": 1000, "us": 1000000, "ns": 1000000000}
DECODER_DIRECTORY = Path(__file__).resolve().parent.parent / "wherobots" / "source"


def _decoder(fail):
    """Load the original sibling component without selecting an arbitrary module."""
    expected = DECODER_DIRECTORY / "wherobots_operator" / "editions.py"
    if not expected.is_file():
        fail("PACKAGE_PARQUET_SOURCE_REQUIRED",
             "Install the complete SF30 Wherobots output component beside Frictionless.")
    directory = str(DECODER_DIRECTORY)
    sys.path.insert(0, directory)
    try:
        module = importlib.import_module("wherobots_operator.editions")
    except ImportError as error:
        fail("PACKAGE_PARQUET_SOURCE_REQUIRED", str(error))
    finally:
        sys.path.remove(directory)
    if Path(module.__file__).resolve() != expected.resolve():
        fail("PACKAGE_PARQUET_SOURCE_CHANGED", "Use the original installed SF30 decoder.")
    reader = getattr(module, "read_parquet_part", None) or module._parquet_part
    try:
        version = importlib.metadata.version("pyarrow")
    except importlib.metadata.PackageNotFoundError:
        fail("PACKAGE_PARQUET_DEPENDENCY",
             "Install the existing Wherobots PyArrow requirement in SF_FRICTIONLESS_PYTHON.")
    return reader, module._lossless_json, module.OutputError, version


def _stamp(path, fail):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_nlink != 1:
        fail("PACKAGE_PRIVATE_FILE_REQUIRED", str(path))
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _timestamp(value, fail):
    unit, zone = value.get("unit"), value.get("timezone")
    ticks = value.get("$timestamp")
    if (unit not in UNIT_SCALE or not isinstance(ticks, str)
            or not re.fullmatch(r"-?(0|[1-9][0-9]*)", ticks)
            or zone is not None and not isinstance(zone, str)):
        fail("PACKAGE_PARQUET_TIMESTAMP_INVALID")
    scale = UNIT_SCALE[unit]
    whole, fraction = divmod(int(ticks), scale)
    try:
        instant = dt.datetime(1970, 1, 1) + dt.timedelta(seconds=whole)
        if zone is not None:
            # UTC epoch arithmetic precedes local-zone rendering. The exact
            # remainder is retained separately, including nanosecond values.
            instant = instant.replace(tzinfo=dt.timezone.utc)
            if zone in ("UTC", "Etc/UTC", "GMT", "Z", "+00:00"):
                target = dt.timezone.utc
            elif re.fullmatch(r"[+-][0-9]{2}:[0-9]{2}", zone):
                sign = 1 if zone[0] == "+" else -1
                hours, minutes = int(zone[1:3]), int(zone[4:6])
                if hours > 23 or minutes > 59:
                    fail("PACKAGE_PARQUET_TIMEZONE_INVALID", zone)
                target = dt.timezone(sign * dt.timedelta(hours=hours, minutes=minutes))
            else:
                target = ZoneInfo(zone)
            instant = instant.astimezone(target)
        text = instant.isoformat(timespec="seconds")
    except (OverflowError, ValueError, ZoneInfoNotFoundError) as error:
        fail("PACKAGE_PARQUET_TIMESTAMP_INVALID", str(error))
    if scale > 1:
        width = len(str(scale)) - 1
        text = text[:19] + "." + str(fraction).zfill(width) + text[19:]
    return text


def _clock(value, dtype, fail):
    match = re.fullmatch(r"time(?:32|64)\[(s|ms|us|ns)\]", dtype)
    ticks = value.get("$temporal_ticks")
    if not match or not isinstance(ticks, str) or not re.fullmatch(r"[0-9]+", ticks):
        fail("PACKAGE_PARQUET_TIME_INVALID", dtype)
    scale = UNIT_SCALE[match[1]]
    whole, fraction = divmod(int(ticks), scale)
    if whole >= 86400:
        fail("PACKAGE_PARQUET_TIME_INVALID", dtype)
    hours, remainder = divmod(whole, 3600)
    minutes, seconds = divmod(remainder, 60)
    text = f"{hours:02}:{minutes:02}:{seconds:02}"
    return text + ("." + str(fraction).zfill(len(str(scale)) - 1) if scale > 1 else "")


def _duration(value, dtype, fail):
    match = re.fullmatch(r"duration\[(s|ms|us|ns)\]", dtype)
    ticks = value.get("$temporal_ticks")
    if not match or not isinstance(ticks, str) or not re.fullmatch(r"-?[0-9]+", ticks):
        fail("PACKAGE_PARQUET_DURATION_INVALID", dtype)
    amount, scale = int(ticks), UNIT_SCALE[match[1]]
    whole, fraction = divmod(abs(amount), scale)
    seconds = str(whole)
    if fraction:
        seconds += "." + str(fraction).zfill(len(str(scale)) - 1)
    return ("-" if amount < 0 else "") + "PT" + seconds + "S"


def physical_scalar(value, dtype, lossless_json, fail):
    """Encode a native value without a float conversion of decimal or integer data."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "INF" if value > 0 else "-INF"
        return repr(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dict):
        # Dispatch by the original physical type, so a user struct containing
        # similarly named properties stays an ordinary nested value.
        if dtype.startswith("timestamp["):
            return _timestamp(value, fail)
        if dtype.startswith(("time32[", "time64[")):
            return _clock(value, dtype, fail)
        if dtype.startswith("duration["):
            return _duration(value, dtype, fail)
    try:
        # This is the original decoder's lossless nested/binary serialization.
        # Its typed tags remain visible instead of being silently flattened.
        return lossless_json(value)
    except (TypeError, ValueError) as error:
        fail("PACKAGE_PARQUET_VALUE_INVALID", str(error))


def _open(path, resource, fields, field_mapping, fail):
    reader, lossless_json, output_error, version = _decoder(fail)
    before = _stamp(path, fail)
    rows = None
    try:
        info, rows = reader(path, {"format": "parquet"}, start=0)
        # Enter the original generator before any metadata/mapping rejection.
        # Its native close is in that generator's finally block.
        sentinel = object()
        first = next(rows, sentinel)
        columns = info.get("columns")
        if not isinstance(columns, list) or any(not isinstance(v, dict) for v in columns):
            fail("PACKAGE_PARQUET_SCHEMA_INVALID", resource["name"])
        names = [v.get("name") for v in columns]
        mapping = field_mapping(names, fields, resource["schema"])
        if not isinstance(info.get("metadata_rows"), int) or info["metadata_rows"] < 0:
            fail("PACKAGE_PARQUET_ROW_COUNT_INVALID", resource["name"])
        remaining = rows if first is sentinel else itertools.chain((first,), rows)
        return {
            "info": info, "columns": columns, "mapping": mapping,
            "records": remaining, "close": rows.close, "before": before,
            "lossless_json": lossless_json, "error": output_error, "version": version,
        }
    except Exception as error:
        if rows is not None:
            rows.close()
        if isinstance(error, output_error):
            fail("PACKAGE_PARQUET_INVALID", error.code + ": " + str(error))
        raise


def inspect_physical(capture, resource, fields, field_mapping, fail):
    members = []
    for item in resource["members"]:
        if item.get("inline"):
            fail("PACKAGE_PARQUET_FILE_REQUIRED", resource["name"])
        path = capture["files"][item["file"]]
        opened = _open(path, resource, fields, field_mapping, fail)
        try:
            info = opened["info"]
            members.append({
                "file": item["file"], "sha256": item["sha256"], "bytes": item["bytes"],
                "format": "parquet", "rows": info["metadata_rows"],
                "rowGroups": info["row_groups"],
                "columns": [{key: column[key] for key in ("name", "type", "nullable")}
                            for column in opened["columns"]],
                "geometry": info.get("geometry", {}),
                "reader": "wherobots_operator.editions", "pyarrow": opened["version"],
            })
        finally:
            opened["close"]()
            if _stamp(path, fail) != opened["before"]:
                fail("PACKAGE_CAPTURE_MEMBER_CHANGED", item["file"])
    return {"format": "parquet", "members": members}


def iter_resource_rows(capture, resource, fields, field_mapping, fail):
    for item in resource["members"]:
        if item.get("inline"):
            fail("PACKAGE_PARQUET_FILE_REQUIRED", resource["name"])
        path = capture["files"][item["file"]]
        opened = _open(path, resource, fields, field_mapping, fail)
        count = 0
        try:
            for record in opened["records"]:
                if not isinstance(record, tuple) or len(record) != 4:
                    fail("PACKAGE_PARQUET_PROTOCOL_INVALID", resource["name"])
                ordinal, raw, _, _ = record
                if ordinal != count or not isinstance(raw, dict):
                    fail("PACKAGE_PARQUET_PROTOCOL_INVALID", resource["name"])
                values = {}
                for name, index in opened["mapping"].items():
                    if index is None:
                        values[name] = None
                    else:
                        column = opened["columns"][index]
                        if name not in raw:
                            fail("PACKAGE_PARQUET_COLUMN_MISSING", name)
                        values[name] = physical_scalar(
                            raw[name], column["type"], opened["lossless_json"], fail)
                count += 1
                yield values
            if count != opened["info"]["metadata_rows"]:
                fail("PACKAGE_PARQUET_ROW_COUNT_CHANGED", resource["name"])
        except opened["error"] as error:
            fail("PACKAGE_PARQUET_INVALID", error.code + ": " + str(error))
        finally:
            opened["close"]()
            if _stamp(path, fail) != opened["before"]:
                fail("PACKAGE_CAPTURE_MEMBER_CHANGED", item["file"])
