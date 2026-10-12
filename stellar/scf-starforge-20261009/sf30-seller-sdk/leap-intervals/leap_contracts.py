"""MIT. Exact device load intervals and explicit Utility profile mappings."""
from __future__ import annotations

import calendar
import csv
import io
import json
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "utility-energy"))
from utility_time import instant, utc, decimal as exact_decimal, decimal_text

SCHEMA = "stellar-forge.leap-interval-workspace.v1"
MAPPING_SCHEMA = "stellar-forge.leap-interval-mapping.v1"
LOAD_COLUMNS = (
    "meter_id", "interval_start_time_utc", "interval_end_time_utc",
    "energy_net_kwh", "energy_consumed_kwh", "energy_generated_kwh",
)
OPTIONAL_COLUMNS = ("final", "region")
ENERGY_COLUMNS = LOAD_COLUMNS[3:]
PROFILE_COLUMNS = (
    "meter_id", "series_id", "channel", "start_utc", "end_utc",
    "duration_seconds", "energy_kwh", "source_row_id",
)
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_ROWS = 2_000_000
INTERVAL_US = 900_000_000


class LeapError(ValueError):
    def __init__(self, code, message, **detail):
        super().__init__(message)
        self.code, self.detail = code, detail

    def as_dict(self):
        return {"code": self.code, "message": str(self), **self.detail}


def require(ok, code, message, **detail):
    if not ok:
        raise LeapError(code, message, **detail)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def now_text():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def utc_text(value):
    return utc(value).replace(".000000Z", "Z")


def cutoff(now_us):
    # Leap publishes "two years", without an exact day-count convention.
    # Use the same calendar date two years earlier; Feb 29 becomes Feb 28.
    current = datetime.fromisoformat(utc(now_us).replace("Z", "+00:00"))
    year = current.year - 2
    day = min(current.day, calendar.monthrange(year, current.month)[1])
    return instant(current.replace(year=year, day=day).isoformat())


def identifier(value, label="meter_id"):
    require(isinstance(value, str) and UUID.fullmatch(value), "LOCAL_UUID", label + " must be an explicit Leap UUID.")
    return value.lower()


def text_value(value, label, maximum=256):
    require(isinstance(value, str) and 0 < len(value.strip()) <= maximum and "\x00" not in value,
            "LOCAL_TEXT", label + " must be a nonempty string of at most " + str(maximum) + " characters.")
    return value.strip()


def sha_value(value, label):
    require(isinstance(value, str) and SHA.fullmatch(value), "LOCAL_SHA256", label + " must name its original SHA256.")
    return value


def csv_rows(path, kind):
    """Stream complete RFC4180 rows with physical source line references."""
    require(kind in {"leap-load", "utility-profile"}, "LOCAL_FORMAT", "Choose leap-load or utility-profile.")
    csv.field_size_limit(1024 * 1024)
    with open(path, "r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, restkey="__extra__", restval=None)
        header = reader.fieldnames
        require(header and len(header) == len(set(header)), "LOCAL_HEADER", "Use one nonduplicated CSV header.")
        required = LOAD_COLUMNS[:3] if kind == "leap-load" else PROFILE_COLUMNS
        require(set(required) <= set(header), "LOCAL_HEADER", "The selected CSV is missing required source columns.",
                missing=sorted(set(required) - set(header)))
        allowed = set(LOAD_COLUMNS + OPTIONAL_COLUMNS) if kind == "leap-load" else set(PROFILE_COLUMNS)
        require(set(header) <= allowed, "LOCAL_HEADER", "Map or remove unsupported columns in a new source edition; the original is retained.",
                unsupported=sorted(set(header) - allowed))
        count = 0
        while True:
            line = reader.line_num + 1
            try:
                row = next(reader)
            except StopIteration:
                break
            except (csv.Error, UnicodeError) as error:
                raise LeapError("LOCAL_CSV", "The source CSV is not complete UTF-8 CSV.", source_line=line) from error
            count += 1
            require(count <= MAX_ROWS, "LOCAL_CAPACITY", "Split this source into complete files of at most 2,000,000 rows.")
            require("__extra__" not in row and all(value is not None for value in row.values()),
                    "LOCAL_ROW_WIDTH", "The row does not match its complete header.", source_line=line)
            require(all("\x00" not in value for value in row.values()), "LOCAL_CSV", "A CSV value contains a NUL character.", source_line=line)
            yield line, row


def mapping_document(value):
    require(isinstance(value, dict) and value.get("schema") == MAPPING_SCHEMA,
            "LOCAL_MAPPING", "Use the complete Leap interval mapping document.")
    result = {
        "schema": MAPPING_SCHEMA,
        "name": text_value(value.get("name"), "Mapping name"),
        "partner_account_id": text_value(value.get("partner_account_id"), "Partner account ID", 128),
        "environment": value.get("environment"),
        "reviewer": text_value(value.get("reviewer"), "Mapping reviewer", 160),
        "ownership_evidence_source_id": sha_value(value.get("ownership_evidence_source_id"), "Partner ownership evidence"),
        "ownership": [], "entries": [],
    }
    require(result["environment"] in {"staging", "production"}, "LOCAL_ENVIRONMENT", "Choose staging or production.")
    require(isinstance(value.get("ownership"), list) and value["ownership"],
            "LOCAL_OWNERSHIP", "Retain the partner's stated device ownership periods.")
    for item in value["ownership"]:
        require(isinstance(item, dict), "LOCAL_OWNERSHIP", "Each device needs an explicit ownership period.")
        start, end = instant(item.get("start_utc")), instant(item.get("end_utc"))
        require(start < end, "LOCAL_OWNERSHIP", "Ownership starts before it ends.")
        result["ownership"].append({"meter_id": identifier(item.get("meter_id")), "start_utc": utc_text(start), "end_utc": utc_text(end)})
    entries = value.get("entries", [])
    require(isinstance(entries, list), "LOCAL_MAPPING", "Mapping entries must be a list.")
    seen = set()
    for entry in entries:
        require(isinstance(entry, dict), "LOCAL_MAPPING", "Each source series needs its own explicit mapping.")
        item = {key: text_value(entry.get(key), key, 512) for key in ("source_meter_id", "source_series_id", "source_channel")}
        item["leap_meter_id"] = identifier(entry.get("leap_meter_id"))
        require(entry.get("target_column") in ENERGY_COLUMNS, "LOCAL_MAPPING", "Select one exact Leap energy column.")
        item["target_column"] = entry["target_column"]
        key = tuple(item[name] for name in ("source_meter_id", "source_series_id", "source_channel"))
        require(key not in seen, "LOCAL_MAPPING", "One source series has more than one mapping.", series=list(key))
        seen.add(key)
        result["entries"].append(item)
    return result


def mapping_index(mapping):
    return {tuple(entry[key] for key in ("source_meter_id", "source_series_id", "source_channel")): entry for entry in mapping["entries"]}


def profile_row(row, index):
    key = tuple(row[key] for key in ("meter_id", "series_id", "channel"))
    require(key in index, "LOCAL_UNMAPPED_SERIES", "Select the intended device and energy channel for every included series.", series=list(key))
    entry = index[key]
    start, end = instant(row["start_utc"]), instant(row["end_utc"])
    require(exact_decimal(row["duration_seconds"]) == Decimal(end - start) / Decimal(1_000_000),
            "LOCAL_DURATION", "The source duration does not match its original UTC period.")
    output = {column: "" for column in LOAD_COLUMNS + OPTIONAL_COLUMNS}
    output.update(meter_id=entry["leap_meter_id"], interval_start_time_utc=utc_text(start), interval_end_time_utc=utc_text(end))
    output[entry["target_column"]] = decimal_text(exact_decimal(row["energy_kwh"]))
    return output, entry["target_column"]


def validate_load(row, mapping, clock_us):
    """Return canonical wire values and every useful row-level validation."""
    output = {column: row.get(column, "") for column in LOAD_COLUMNS + OPTIONAL_COLUMNS}
    issues = []
    def issue(code, column, message):
        issues.append({"code": code, "column": column, "message": message})
    try:
        output["meter_id"] = identifier(output["meter_id"])
    except (LeapError, ValueError):
        issue("LOCAL_UUID", "meter_id", "Use the explicit Leap device UUID.")
    times = {}
    for column, code in (("interval_start_time_utc", "STM"), ("interval_end_time_utc", "ETM")):
        try:
            value = instant(output[column])
            times[column] = value
            output[column] = utc_text(value)
            if value % INTERVAL_US:
                issue(code + "_0003", column, "Align this source instant to a UTC 15-minute boundary.")
            if value > clock_us:
                issue("LOCAL_FUTURE_INTERVAL", column, "Leap accepts past intervals.")
            if value < cutoff(clock_us):
                issue("LOCAL_INTERVAL_AGE", column, "This interval predates the application's two-calendar-year eligibility cutoff.")
        except (ValueError, TypeError):
            issue("LOCAL_TIMESTAMP", column, "Use a complete ISO8601 timestamp with an explicit UTC offset.")
    if len(times) == 2:
        start, end = times["interval_start_time_utc"], times["interval_end_time_utc"]
        if end - start != INTERVAL_US:
            issue("DTR_0003", "interval_end_time_utc", "Keep each complete original interval exactly 15 minutes.")
        ownership = [item for item in mapping["ownership"] if item["meter_id"] == output["meter_id"]]
        if not any(instant(item["start_utc"]) <= start and end <= instant(item["end_utc"]) for item in ownership):
            issue("LOCAL_OWNERSHIP_PERIOD", "meter_id", "Retain partner ownership evidence covering this complete interval.")
    numbers = {}
    for column in ENERGY_COLUMNS:
        value = output[column]
        if value == "":
            continue
        try:
            number = exact_decimal(value, column)
            numbers[column] = number
            output[column] = decimal_text(number)
            if column != "energy_net_kwh" and number < 0:
                issue("CON_0003" if column == "energy_consumed_kwh" else "GEN_0003", column, "Consumed and generated energy must be nonnegative.")
        except (ValueError, TypeError):
            issue("LOCAL_NUMBER", column, "Use a finite exact decimal number.")
    present = {column for column in ENERGY_COLUMNS if output[column] != ""}
    if present not in ({"energy_net_kwh"}, {"energy_consumed_kwh", "energy_generated_kwh"}, set(ENERGY_COLUMNS)):
        issue("NRG_0001", "energy_net_kwh", "Provide net energy, or both consumed and generated energy, or all three.")
    if len(numbers) == 3:
        with localcontext() as context:
            context.prec = 1024
            if numbers["energy_consumed_kwh"] - numbers["energy_generated_kwh"] != numbers["energy_net_kwh"]:
                issue("LOCAL_ENERGY_BALANCE", "energy_net_kwh", "Consumed minus generated must equal net exactly.")
    if output["final"] not in {"", "true", "false"}:
        issue("LOCAL_FINAL", "final", "Use true, false, or leave the optional final value empty.")
    if output["region"] and not re.fullmatch(r"[A-Z]{2}", output["region"]):
        issue("LOCAL_REGION", "region", "Use the partner's valid two-letter uppercase state code.")
    return output, issues


def load_csv_text(rows, optional=()):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=LOAD_COLUMNS + tuple(optional), lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in writer.fieldnames})
    return stream.getvalue()
