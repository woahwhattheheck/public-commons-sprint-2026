#!/usr/bin/env python3
"""MIT. Complete original GTFS Schedule selection for the native Frictionless publisher."""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import zipfile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import engine

SCHEMA = "stellar-forge.gtfs-edition.v1"
RECIPE = "stellar-forge.gtfs-selection.v1"
HASH = re.compile(r"[a-f0-9]{64}")
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}")
ZIP_MAX = 16 * 1024 * 1024
EXPANDED_MAX = 128 * 1024 * 1024
ROW_MAX = 1000000
UTC = dt.timezone.utc
SPEC = "https://gtfs.org/documentation/schedule/reference/"
KEYS = {
    "agency.txt": ["agency_id"], "stops.txt": ["stop_id"], "routes.txt": ["route_id"],
    "trips.txt": ["trip_id"], "stop_times.txt": ["trip_id", "stop_sequence"],
    "calendar.txt": ["service_id"], "calendar_dates.txt": ["service_id", "date"],
    "frequencies.txt": ["trip_id", "start_time"], "shapes.txt": ["shape_id", "shape_pt_sequence"],
    "feed_info.txt": [], "levels.txt": ["level_id"], "pathways.txt": ["pathway_id"],
    "booking_rules.txt": ["booking_rule_id"], "networks.txt": ["network_id"],
    "areas.txt": ["area_id"], "fare_products.txt": ["fare_product_id", "rider_category_id", "fare_media_id"],
    "fare_media.txt": ["fare_media_id"], "rider_categories.txt": ["rider_category_id"],
}
TRIP_FIELDS = ["instance_id", "service_date", "trip_id", "service_id", "route_id", "agency_id",
               "agency_timezone", "direction_id", "trip_headsign", "block_id", "shape_id",
               "start_time", "end_time", "start_seconds", "end_seconds", "start_utc", "end_utc",
               "shift_seconds", "schedule_kind"]
CALL_FIELDS = ["instance_id", "service_date", "trip_id", "service_id", "route_id", "agency_id",
               "agency_timezone", "stop_id", "stop_sequence", "stop_name", "trip_headsign",
               "arrival_time", "departure_time", "arrival_seconds", "departure_seconds",
               "arrival_utc", "departure_utc", "source_arrival_time", "source_departure_time",
               "pickup_type", "drop_off_type", "timepoint", "shape_dist_traveled",
               "source_record", "schedule_kind"]
WINDOW_FIELDS = ["service_date", "trip_id", "service_id", "route_id", "agency_id", "agency_timezone",
                 "start_time", "end_time", "start_utc", "end_utc", "headway_seconds", "schedule_kind"]

class GtfsError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def fail(code, message):
    raise GtfsError(code, message)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def digest(value):
    return hashlib.sha256(value).hexdigest()

def read_json(path, maximum=8*1024*1024):
    raw = private_read(path, maximum)
    def unique(items):
        obj = {}
        for key, value in items:
            if key in obj:
                fail("GTFS_JSON_DUPLICATE_KEY", "The source JSON repeats a key.")
            obj[key] = value
        return obj
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError):
        fail("GTFS_JSON_INVALID", "Use complete UTF-8 JSON.")

def private_read(path, maximum):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            fail("GTFS_INPUT_SIZE", "The selected original file exceeds its supported size.")
        raw = handle.read(maximum + 1)
        after = os.fstat(handle.fileno())
        if len(raw) > maximum or len(raw) != before.st_size or (before.st_ino, before.st_dev, before.st_mtime_ns, before.st_size) != (after.st_ino, after.st_dev, after.st_mtime_ns, after.st_size):
            fail("GTFS_INPUT_CHANGED", "The selected original file changed while being read.")
        return raw

def create(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())

def sync(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def package_module():
    path = Path(__file__).resolve().parent.parent / "frictionless" / "package.py"
    spec = importlib.util.spec_from_file_location("starforge_gtfs_original_package", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def csv_rows(raw, name):
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
        fields = reader.fieldnames
        if not fields or len(fields) != len(set(fields)) or any(not f or "\x00" in f for f in fields):
            fail("GTFS_TABLE_COLUMNS", "Invalid original field names in " + name + ".")
        for index, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                fail("GTFS_TABLE_ROW", "Invalid original CSV record in " + name + ":" + str(index) + ".")
            yield fields, index, row
        return
    except (UnicodeError, csv.Error):
        fail("GTFS_TABLE_ENCODING", name + " must contain valid UTF-8 CSV text.")

def table_fields(raw, name):
    try:
        fields = next(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline="")), None)
    except (UnicodeError, csv.Error):
        fail("GTFS_TABLE_COLUMNS", "Invalid original field names in " + name + ".")
    if not fields or len(fields) != len(set(fields)) or any(not f or "\x00" in f for f in fields):
        fail("GTFS_TABLE_COLUMNS", "Invalid original field names in " + name + ".")
    return fields

def source_archive(path, expected=None):
    raw = private_read(path, ZIP_MAX)
    if expected is not None and (not isinstance(expected, str) or not HASH.fullmatch(expected) or digest(raw) != expected):
        fail("GTFS_SOURCE_CHANGED", "The selected ZIP differs from its reviewed SHA-256.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        fail("GTFS_ZIP_INVALID", "Select a complete original GTFS Schedule ZIP.")
    entries = archive.infolist()
    names = [entry.filename for entry in entries]
    if not entries or len(entries) > 1000 or len(names) != len(set(names)):
        archive.close()
        fail("GTFS_ZIP_MEMBERS", "The original archive must have unique root-level members.")
    if sum(entry.file_size for entry in entries) > EXPANDED_MAX:
        archive.close()
        fail("GTFS_EXPANDED_SIZE", "The original feed expands beyond 128 MiB.")
    for entry in entries:
        if entry.is_dir() or "/" in entry.filename or "\\" in entry.filename or entry.filename in (".", "..") or any(ord(c) < 32 for c in entry.filename) or entry.flag_bits & 1:
            archive.close()
            fail("GTFS_ZIP_MEMBERS", "GTFS members must be ordinary, unencrypted files at the archive root.")
    return raw, archive

def inspect_archive(path, expected=None):
    raw, archive = source_archive(path, expected)
    catalog, tables, known = [], [], {}
    with archive:
        for entry in archive.infolist():
            content = archive.read(entry)
            item = {"name": entry.filename, "bytes": len(content), "sha256": digest(content),
                    "crc32": f"{entry.CRC:08x}"}
            catalog.append(item)
            if entry.filename.endswith(".txt"):
                try:
                    fields = table_fields(content, entry.filename)
                    count = 0
                    samples = []
                    for _, _, row in csv_rows(content, entry.filename):
                        count += 1
                        if entry.filename in ("agency.txt", "routes.txt", "feed_info.txt"):
                            if len(samples) < 10000:
                                samples.append(row)
                    known[entry.filename] = samples
                    tables.append({**item, "fields": fields, "rows": count,
                                   "publishable": 0 < len(fields) <= 64 and count <= ROW_MAX,
                                   "error": None if count <= ROW_MAX else {"code": "GTFS_PUBLISHER_ROW_LIMIT",
                                       "message": "This complete original table exceeds the native publisher limit of one million rows."}})
                except GtfsError as error:
                    tables.append({**item, "fields": [], "rows": None, "publishable": False,
                                   "error": {"code": error.code, "message": str(error)}})
    fixed = {"available": False, "message": None}
    resolved_agencies = []
    try:
        feed = engine.load_feed(path)
        if feed["sha256"] != digest(raw):
            fail("GTFS_SOURCE_CHANGED", "The original feed changed during native inspection.")
        for agency_id, agency in feed["agency"].items():
            zone = agency.get("agency_timezone", "")
            try:
                ZoneInfo(zone)
            except (ZoneInfoNotFoundError, ValueError):
                fail("GTFS_AGENCY_TIMEZONE", "The original agency has an unavailable IANA timezone: " + zone)
            resolved_agencies.append({"id": agency_id, "name": agency.get("agency_name", ""),
                                     "timezone": zone, "singleAgencyDefault": agency_id == "_single_agency"})
        fixed = {"available": True, "message": None}
    except (ValueError, KeyError, TypeError) as error:
        fixed = {"available": False, "message": str(error)}
    return {"schema": "stellar-forge.gtfs-inspection.v1", "feedSha256": digest(raw), "feedBytes": len(raw),
            "members": catalog, "tables": tables, "agencies": resolved_agencies,
            "originalAgencies": known.get("agency.txt", []), "routes": known.get("routes.txt", []),
            "feedInfo": known.get("feed_info.txt", []), "fixedStopSchedule": fixed,
            "catalog": {key: {"total": next((v["rows"] for v in tables if v["name"] == key), 0),
                              "returned": len(known.get(key, [])), "maximum": 10000}
                        for key in ("agency.txt", "routes.txt", "feed_info.txt")},
            "publicationLimits": {"rowsPerResource": ROW_MAX, "columnsPerResource": 64, "resources": 64},
            "semantics": {"reference": SPEC, "originalEncoding": "UTF-8 physical strings",
                          "serviceTime": "Agency timezone; noon minus 12 hours plus GTFS seconds",
                          "frequencyService": "Exact departures only for exact_times=1; other windows stay separate",
                          "originalMembers": "Every member remains in the original ZIP, including unselected extensions"}}

def text(value, label, maximum=2000, empty=False):
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value or not empty and not value.strip():
        fail("GTFS_SELECTION_INVALID", "Enter " + label + ".")
    return value.strip()

def selection(value, inspection, valid_route_ids=None):
    allowed = {"schema", "title", "feedSha256", "startDate", "endDate", "agencyIds", "routeIds",
               "tables", "includeSchedule", "authority", "note"}
    if not isinstance(value, dict) or set(value) - allowed or value.get("schema") != RECIPE:
        fail("GTFS_SELECTION_INVALID", "Use the GTFS selection contract.")
    if value.get("feedSha256") != inspection["feedSha256"]:
        fail("GTFS_SOURCE_CHANGED", "Review the exact original feed before selecting its data.")
    include = value.get("includeSchedule", True)
    if type(include) is not bool:
        fail("GTFS_SELECTION_INVALID", "includeSchedule must be a boolean.")
    dates = []
    start, end = value.get("startDate", ""), value.get("endDate", "")
    if include:
        if not inspection["fixedStopSchedule"]["available"]:
            fail("GTFS_FIXED_SCHEDULE_UNAVAILABLE", inspection["fixedStopSchedule"]["message"] or "Review this feed's fixed-stop schedule first.")
        try:
            dates = engine.dates(start, end)
        except (TypeError, ValueError):
            fail("GTFS_SERVICE_DATES", "Select one to 367 valid ISO service dates.")
    elif start or end:
        fail("GTFS_SELECTION_INVALID", "Service dates apply when scheduled resources are selected.")
    def ids(key, valid):
        supplied = value.get(key, [])
        if not isinstance(supplied, list) or len(supplied) > 10000 or any(not isinstance(v, str) or v not in valid for v in supplied) or len(supplied) != len(set(supplied)):
            fail("GTFS_SELECTION_INVALID", "Select current original " + key + ".")
        return sorted(supplied)
    agencies = ids("agencyIds", {v["id"] for v in inspection["agencies"]})
    routes = ids("routeIds", valid_route_ids if valid_route_ids is not None else {v["route_id"] for v in inspection["routes"] if "route_id" in v})
    if not include and (agencies or routes):
        fail("GTFS_SELECTION_INVALID", "Agency and route filters apply to derived schedules; original tables remain complete.")
    available = {v["name"]: v for v in inspection["tables"] if v["publishable"]}
    chosen = value.get("tables", [v["name"] for v in inspection["tables"] if v["publishable"]])
    if not isinstance(chosen, list) or len(chosen) != len(set(chosen)) or any(not isinstance(v, str) or v not in available for v in chosen):
        fail("GTFS_TABLE_SELECTION", "Select complete, inspected original tables.")
    if not chosen and not include or len(chosen) + (3 if include else 0) > 64:
        fail("GTFS_TABLE_SELECTION", "Choose one to 64 original or derived publication resources.")
    authority = value.get("authority", {})
    if not isinstance(authority, dict) or set(authority) - {"sourceUrl", "licenseUrl", "licenseName", "attribution", "retrievedAt"}:
        fail("GTFS_SOURCE_AUTHORITY", "Use the original source and rights fields.")
    authority = {key: text(authority.get(key, ""), key, 4096, True)
                 for key in ("sourceUrl", "licenseUrl", "licenseName", "attribution", "retrievedAt")}
    for key in ("sourceUrl", "licenseUrl"):
        if authority[key] and not re.match(r"^https?://[^\s]+$", authority[key]):
            fail("GTFS_SOURCE_AUTHORITY", key + " must be the original HTTP(S) URL.")
    if authority["retrievedAt"]:
        try:
            stamp = dt.datetime.fromisoformat(authority["retrievedAt"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError()
        except ValueError:
            fail("GTFS_SOURCE_AUTHORITY", "retrievedAt must include its timezone.")
    return {"schema": RECIPE, "title": text(value.get("title"), "a selection title", 128),
            "feedSha256": inspection["feedSha256"], "startDate": start, "endDate": end,
            "agencyIds": agencies, "routeIds": routes, "tables": sorted(chosen), "includeSchedule": include,
            "authority": authority, "note": text(value.get("note", ""), "an operating note", 4000, True)}, dates

def service_instant(day, seconds, timezone):
    if seconds is None:
        return ""
    local_noon = dt.datetime.combine(dt.date.fromisoformat(day), dt.time(12), ZoneInfo(timezone))
    value = local_noon.astimezone(UTC) - dt.timedelta(hours=12) + dt.timedelta(seconds=seconds)
    return value.isoformat().replace("+00:00", "Z")

def write_csv(path, fields, rows):
    count = 0
    with Path(path).open("x", encoding="utf-8", newline="") as handle:
        os.chmod(path, 0o600)
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n", extrasaction="raise")
        writer.writeheader()
        for row in rows:
            count += 1
            if count > ROW_MAX:
                fail("GTFS_DERIVED_ROWS", "The complete selection exceeds the native publisher limit of one million rows per resource; choose a smaller date or route selection.")
            writer.writerow({key: "" if row.get(key) is None else row.get(key, "") for key in fields})
        handle.flush()
        os.fsync(handle.fileno())
    return count

def scheduled_resources(feed, recipe, days):
    agencies, routes = set(recipe["agencyIds"]), set(recipe["routeIds"])
    selected = {tid: trip for tid, trip in feed["trips"].items()
                if (not routes or trip["route_id"] in routes)
                and (not agencies or feed["routes"][trip["route_id"]]["agency_id"] in agencies)}
    trip_count = call_count = window_count = 0
    for day in days:
        for tid, trip in selected.items():
            if not engine.active(feed, trip["service_id"], day):
                continue
            count = 1
            if tid in feed["frequencies"]:
                count = 0
                for frequency in feed["frequencies"][tid]:
                    if frequency.get("exact_times", "0") == "1":
                        count += len(range(frequency["start"], frequency["end"], frequency["headway"]))
                    else:
                        window_count += 1
            trip_count += count
            call_count += count * len(feed["stop_times"][tid])
            if max(trip_count, call_count, window_count) > ROW_MAX:
                fail("GTFS_DERIVED_ROWS", "The complete selection exceeds the native publisher limit of one million rows per resource; select fewer service dates or routes.")
    view = {**feed, "trips": selected}
    trips, windows = engine.instances(view, days)
    if len(trips) > ROW_MAX or len(windows) > ROW_MAX:
        fail("GTFS_DERIVED_ROWS", "The complete selection exceeds the native publisher limit of one million rows per resource.")
    ordinal = {(row["trip_id"], int(row["stop_sequence"])): index
               for index, row in enumerate(feed["data"]["stop_times"], 2)}
    def trip_rows():
        for instance in trips:
            trip = feed["trips"][instance["trip_id"]]
            timezone = feed["agency"][instance["agency_id"]]["agency_timezone"]
            yield {"instance_id": instance["id"], "service_date": instance["date"], "trip_id": instance["trip_id"],
                   "service_id": trip["service_id"], "route_id": instance["route_id"], "agency_id": instance["agency_id"],
                   "agency_timezone": timezone, "direction_id": instance["direction_id"], "trip_headsign": instance["headsign"],
                   "block_id": instance["block_id"], "shape_id": instance["shape_id"],
                   "start_time": engine.clock(instance["start"]), "end_time": engine.clock(instance["end"]),
                   "start_seconds": instance["start"], "end_seconds": instance["end"],
                   "start_utc": service_instant(instance["date"], instance["start"], timezone),
                   "end_utc": service_instant(instance["date"], instance["end"], timezone),
                   "shift_seconds": instance["shift_seconds"], "schedule_kind": instance["kind"]}
    def call_rows():
        for instance in trips:
            trip = feed["trips"][instance["trip_id"]]
            timezone = feed["agency"][instance["agency_id"]]["agency_timezone"]
            for point in feed["stop_times"][instance["trip_id"]]:
                arrival = None if point["arrival"] is None else point["arrival"] + instance["shift_seconds"]
                departure = None if point["departure"] is None else point["departure"] + instance["shift_seconds"]
                yield {"instance_id": instance["id"], "service_date": instance["date"],
                       "trip_id": instance["trip_id"], "service_id": trip["service_id"],
                       "route_id": instance["route_id"], "agency_id": instance["agency_id"], "agency_timezone": timezone,
                       "stop_id": point["stop_id"], "stop_sequence": point["stop_sequence"],
                       "stop_name": feed["stops"][point["stop_id"]].get("stop_name", ""),
                       "trip_headsign": instance["headsign"],
                       "arrival_time": engine.clock(arrival), "departure_time": engine.clock(departure),
                       "arrival_seconds": arrival, "departure_seconds": departure,
                       "arrival_utc": service_instant(instance["date"], arrival, timezone),
                       "departure_utc": service_instant(instance["date"], departure, timezone),
                       "source_arrival_time": point.get("arrival_time", ""), "source_departure_time": point.get("departure_time", ""),
                       "pickup_type": point.get("pickup_type", ""), "drop_off_type": point.get("drop_off_type", ""),
                       "timepoint": point.get("timepoint", ""), "shape_dist_traveled": point.get("shape_dist_traveled", ""),
                       "source_record": ordinal[(instance["trip_id"], point["sequence"])], "schedule_kind": instance["kind"]}
    def window_rows():
        for window in windows:
            trip = feed["trips"][window["trip_id"]]
            route = feed["routes"][window["route_id"]]
            timezone = feed["agency"][route["agency_id"]]["agency_timezone"]
            yield {"service_date": window["date"], "trip_id": window["trip_id"], "service_id": trip["service_id"],
                   "route_id": window["route_id"], "agency_id": route["agency_id"], "agency_timezone": timezone,
                   "start_time": window["start"], "end_time": window["end"],
                   "start_utc": service_instant(window["date"], engine.time_seconds(window["start"]), timezone),
                   "end_utc": service_instant(window["date"], engine.time_seconds(window["end"]), timezone),
                   "headway_seconds": window["headway_seconds"], "schedule_kind": window["kind"]}
    return [("Derived_ScheduledTrips", TRIP_FIELDS, trip_rows(), ["instance_id"]),
            ("Derived_ScheduledCalls", CALL_FIELDS, call_rows(), ["instance_id", "stop_sequence"]),
            ("Derived_FrequencyWindows", WINDOW_FIELDS, window_rows(), ["service_date", "trip_id", "start_time"])]

def compile_edition(archive_file, recipe_file, output):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        fail("GTFS_EDITION_EXISTS", "Choose a new edition directory or reopen the saved original request.")
    source_recipe = read_json(recipe_file)
    inspected = inspect_archive(archive_file, source_recipe.get("feedSha256"))
    feed = engine.load_feed(archive_file) if source_recipe.get("includeSchedule", True) else None
    if feed is not None and feed["sha256"] != inspected["feedSha256"]:
        fail("GTFS_SOURCE_CHANGED", "The original feed changed during selection.")
    recipe, days = selection(source_recipe, inspected, set(feed["routes"]) if feed is not None else None)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".gtfs-edition-", dir=output.parent))
    try:
        raw, archive = source_archive(archive_file, inspected["feedSha256"])
        original = temporary / "original.gtfs.zip"
        create(original, raw)
        create(temporary / "selection.json", encoded(recipe))
        create(temporary / "inspection.json", encoded(inspected))
        data_dir = temporary / "tables"
        data_dir.mkdir(mode=0o700)
        resources, metadata, aliases = [], [], set()
        table_map = {item["name"]: item for item in inspected["tables"]}
        def resource(name, filename, fields, count, original_member=None, keys=None):
            if name in aliases:
                fail("GTFS_RESOURCE_NAME", "Two selected resources have the same publication alias.")
            aliases.add(name)
            schema = {"fields": [{"name": field, "type": "string"} for field in fields], "missingValues": []}
            if keys and all(key in fields for key in keys):
                # Keys are source identities. Native inspection reports every duplicate before publication.
                schema["primaryKey"] = keys
            resources.append({"name": name, "path": "tables/" + filename, "format": "csv", "encoding": "utf-8",
                              "schema": schema, "dialect": {"header": True},
                              "gtfs": {"member": original_member, "valueEncoding": "physical strings",
                                       "serviceTime": inspected["semantics"]["serviceTime"]}})
            content = private_read(data_dir / filename, EXPANDED_MAX)
            metadata.append({"resource": name, "file": "tables/" + filename, "fields": fields, "rows": count,
                             "bytes": len(content), "sha256": digest(content), "originalMember": original_member,
                             "primaryKey": keys or []})
        with archive:
            for number, member in enumerate(recipe["tables"], 1):
                item = table_map[member]
                name = member[:-4]
                if not NAME.fullmatch(name) or name.startswith("Derived_"):
                    name = "Original_" + digest(member.encode())[:16]
                filename = f"original-{number:03d}.csv"
                content = archive.read(member)
                # Re-encode only the UTF-8 BOM to keep the original physical strings available to all readers.
                if content.startswith(b"\xef\xbb\xbf"):
                    content = content[3:]
                create(data_dir / filename, content)
                keys = KEYS.get(member)
                if keys is not None and (not keys or any(key not in item["fields"] for key in keys)):
                    keys = None
                resource(name, filename, item["fields"], item["rows"], member, keys)
        if recipe["includeSchedule"]:
            for name, fields, rows, keys in scheduled_resources(feed, recipe, days):
                filename = name + ".csv"
                count = write_csv(data_dir / filename, fields, rows)
                resource(name, filename, fields, count, None, keys)
        authority = recipe["authority"]
        package = {"name": "gtfs_schedule", "title": recipe["title"], "profile": "tabular-data-package",
                   "resources": resources,
                   "gtfs": {"schema": RECIPE, "feedSha256": inspected["feedSha256"], "feedBytes": inspected["feedBytes"],
                            "selection": recipe, "selectionSha256": digest(encoded(recipe)), "reference": SPEC,
                            "engine": "2926b9bfd280e93ee93c6f6229343c1f6e01aafb",
                            "originalMembers": inspected["members"]}}
        if authority["sourceUrl"]:
            package["sources"] = [{"title": "Original GTFS Schedule feed", "path": authority["sourceUrl"]}]
        if authority["licenseUrl"] or authority["licenseName"]:
            package["licenses"] = [{key: value for key, value in
                                    (("name", authority["licenseName"]), ("path", authority["licenseUrl"])) if value}]
        if authority["attribution"]:
            package["contributors"] = [{"title": authority["attribution"], "role": "author"}]
        create(temporary / "datapackage.json", encoded(package))
        native = package_module()
        capture = native.capture_package(str(temporary / "datapackage.json"), str(temporary / "capture"),
                                         references=[str(original), str(temporary / "selection.json"), str(temporary / "inspection.json")])
        suggested = temporary / "source.suggested.json"
        native.suggest_source(capture["captureFile"], str(suggested))
        source = read_json(suggested)
        source["connection"]["file"] = "capture/capture.json"
        suggested.unlink()
        create(temporary / "source.json", encoded(source))
        edition = {"schema": SCHEMA, "createdAt": dt.datetime.now(UTC).isoformat(), "title": recipe["title"],
                   "feedSha256": inspected["feedSha256"], "feedBytes": inspected["feedBytes"],
                   "selectionSha256": digest(encoded(recipe)), "selection": recipe,
                   "captureSha256": capture["sha256"], "sourceSha256": digest(encoded(source)), "resources": metadata,
                   "sourceMembers": inspected["members"], "semantics": inspected["semantics"]}
        create(temporary / "edition.json", encoded(edition))
        sync(data_dir)
        sync(temporary)
        os.rename(temporary, output)
        sync(output.parent)
        return {"directory": str(output), **edition}
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

def read_edition(directory):
    directory = Path(directory).absolute()
    edition = read_json(directory / "edition.json")
    if edition.get("schema") != SCHEMA or not HASH.fullmatch(edition.get("feedSha256", "")):
        fail("GTFS_EDITION_INVALID", "Select a complete original GTFS edition.")
    source = private_read(directory / "source.json", 8*1024*1024)
    if digest(source) != edition.get("sourceSha256"):
        fail("GTFS_EDITION_CHANGED", "The retained source selection has changed.")
    inspected = package_module().source_inspection(str(directory / "source.json"))
    if inspected["captureSha256"] != edition.get("captureSha256") or inspected["capture"]["package"].get("gtfs", {}).get("feedSha256") != edition["feedSha256"]:
        fail("GTFS_EDITION_CHANGED", "The retained edition and original capture differ.")
    selection_bytes = private_read(directory / "selection.json", 8*1024*1024)
    if digest(selection_bytes) != edition.get("selectionSha256"):
        fail("GTFS_EDITION_CHANGED", "The retained selection changed.")
    return directory, edition

def rows_page(directory, resource, offset=0, limit=50, query=""):
    root, edition = read_edition(directory)
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200 or not isinstance(query, str) or len(query) > 256:
        fail("GTFS_ROW_PAGE", "Use a non-negative offset, 1–200 rows and a short search.")
    item = next((r for r in edition["resources"] if r["resource"] == resource), None)
    if item is None or not re.fullmatch(r"tables/[A-Za-z0-9_.-]+\.csv", item.get("file", "")):
        fail("GTFS_RESOURCE_REQUIRED", "Choose a retained original or derived resource.")
    raw = private_read(root / item["file"], EXPANDED_MAX)
    if len(raw) != item["bytes"] or digest(raw) != item["sha256"]:
        fail("GTFS_RESOURCE_CHANGED", "The retained resource differs from its original edition.")
    result, matches = [], 0
    query = query.casefold()
    for _, record, row in csv_rows(raw, resource):
        if query and not any(query in value.casefold() for value in row.values()):
            continue
        if offset <= matches < offset + limit:
            result.append({"record": record, "values": row})
        matches += 1
    return {"resource": resource, "fields": item["fields"], "rows": result, "total": matches, "offset": offset, "limit": limit,
            "next": offset + len(result) if offset + len(result) < matches else None,
            "feedSha256": edition["feedSha256"], "selectionSha256": edition["selectionSha256"]}

def archive_rows_page(archive_file, expected, resource, offset=0, limit=50, query=""):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200 or not isinstance(query, str) or len(query) > 256:
        fail("GTFS_ROW_PAGE", "Use a non-negative offset, 1–200 rows and a short search.")
    raw, archive = source_archive(archive_file, expected)
    with archive:
        if not isinstance(resource, str) or not resource.endswith(".txt") or resource not in archive.namelist():
            fail("GTFS_RESOURCE_REQUIRED", "Choose a retained original GTFS table.")
        content = archive.read(resource)
    fields = table_fields(content, resource)
    selected, matches = [], 0
    query = query.casefold()
    for _, record, row in csv_rows(content, resource):
        if query and not any(query in value.casefold() for value in row.values()):
            continue
        if offset <= matches < offset + limit:
            selected.append({"record": record, "values": row})
        matches += 1
    return {"resource": resource, "fields": fields, "rows": selected, "total": matches, "offset": offset, "limit": limit,
            "next": offset + len(selected) if offset + len(selected) < matches else None,
            "feedSha256": digest(raw)}

def comparison(before, after, output):
    left_root, left = read_edition(before)
    right_root, right = read_edition(after)
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        fail("GTFS_COMPARISON_EXISTS", "Reopen the saved comparison request or choose a new output.")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".gtfs-comparison-", dir=output.parent))
    db = None
    try:
        native = package_module()
        source = native.compare_captures(str(left_root / "capture/capture.json"), str(right_root / "capture/capture.json"))
        sources = [{"root": left_root, "edition": left}, {"root": right_root, "edition": right}]
        maps = [{r["resource"]: r for r in selected["edition"]["resources"]} for selected in sources]
        db = sqlite3.connect(temporary / "keys.sqlite")
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA cache_size=-2048")
        db.execute("PRAGMA temp_store=FILE")
        db.execute("CREATE TABLE rows(side INTEGER,name TEXT,key TEXT,row TEXT,PRIMARY KEY(side,name,key))")
        result = []
        changes = temporary / "changes.jsonl"
        with changes.open("x", encoding="utf-8") as change_file:
            os.chmod(changes, 0o600)
            for name in sorted(set(maps[0]) | set(maps[1])):
                a, b = maps[0].get(name), maps[1].get(name)
                keys = (a or b)["primaryKey"]
                item = {"resource": name, "beforeRows": a["rows"] if a else 0, "afterRows": b["rows"] if b else 0,
                        "dataChanged": a is None or b is None or a["sha256"] != b["sha256"],
                        "fieldsChanged": a is None or b is None or a["fields"] != b["fields"],
                        "primaryKey": keys, "added": None, "removed": None, "changed": None, "unchanged": None}
                if not keys or a and b and a["primaryKey"] != b["primaryKey"]:
                    item["comparison"] = "Complete file/field comparison; the source has no common declared row key."
                    result.append(item)
                    continue
                duplicate = None
                for side, resource in enumerate((a, b)):
                    if resource is None:
                        continue
                    raw = private_read(sources[side]["root"] / resource["file"], EXPANDED_MAX)
                    if digest(raw) != resource["sha256"]:
                        fail("GTFS_RESOURCE_CHANGED", "A comparison input changed.")
                    for _, record, row in csv_rows(raw, name):
                        key = json.dumps([row[field] for field in keys], ensure_ascii=False, separators=(",", ":"))
                        try:
                            db.execute("INSERT INTO rows VALUES(?,?,?,?)", (side, name, key, json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))))
                        except sqlite3.IntegrityError:
                            duplicate = {"side": "before" if side == 0 else "after", "record": record, "key": json.loads(key)}
                db.commit()
                if duplicate:
                    item["comparison"] = "The source repeats a selected row key; inspect the retained original records."
                    item["duplicate"] = duplicate
                    result.append(item)
                    db.execute("DELETE FROM rows WHERE name=?", (name,))
                    db.commit()
                    continue
                counts = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0}
                query = """SELECT a.key,a.row,b.row FROM rows a LEFT JOIN rows b
                           ON b.side=1 AND b.name=a.name AND b.key=a.key WHERE a.side=0 AND a.name=?
                           UNION ALL SELECT b.key,NULL,b.row FROM rows b LEFT JOIN rows a
                           ON a.side=0 AND a.name=b.name AND a.key=b.key WHERE b.side=1 AND b.name=? AND a.key IS NULL"""
                for key, old, new in db.execute(query, (name, name)):
                    kind = "added" if old is None else "removed" if new is None else "unchanged" if old == new else "changed"
                    counts[kind] += 1
                    if kind != "unchanged":
                        change_file.write(json.dumps({"resource": name, "key": json.loads(key), "change": kind,
                                                      "before": json.loads(old) if old else None,
                                                      "after": json.loads(new) if new else None}, ensure_ascii=False, separators=(",", ":")) + "\n")
                item.update(counts)
                item["comparison"] = "Complete exact source-key comparison."
                result.append(item)
                db.execute("DELETE FROM rows WHERE name=?", (name,))
                db.commit()
            change_file.flush()
            os.fsync(change_file.fileno())
        db.close()
        db = None
        (temporary / "keys.sqlite").unlink()
        change_file_identity = native.fingerprint(changes, 512*1024*1024, True)
        report = {"schema": "stellar-forge.gtfs-comparison.v1", "before": {"feedSha256": left["feedSha256"], "selectionSha256": left["selectionSha256"], "captureSha256": left["captureSha256"]},
                  "after": {"feedSha256": right["feedSha256"], "selectionSha256": right["selectionSha256"], "captureSha256": right["captureSha256"]},
                  "selectionChanged": left["selection"] != right["selection"], "resources": result, "originalCaptureComparison": source,
                  "changes": {"file": "changes.jsonl", **change_file_identity}}
        create(temporary / "comparison.json", encoded(report))
        sync(temporary)
        os.rename(temporary, output)
        sync(output.parent)
        return report
    except BaseException:
        if db is not None:
            db.close()
        shutil.rmtree(temporary, ignore_errors=True)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--archive", required=True)
    inspect.add_argument("--sha256")
    compile = sub.add_parser("compile")
    compile.add_argument("--archive", required=True)
    compile.add_argument("--recipe", required=True)
    compile.add_argument("--output", required=True)
    rows = sub.add_parser("rows")
    rows.add_argument("--edition", required=True)
    rows.add_argument("--resource", required=True)
    rows.add_argument("--offset", type=int, default=0)
    rows.add_argument("--limit", type=int, default=50)
    rows.add_argument("--query", default="")
    table = sub.add_parser("table")
    table.add_argument("--archive", required=True)
    table.add_argument("--sha256", required=True)
    table.add_argument("--resource", required=True)
    table.add_argument("--offset", type=int, default=0)
    table.add_argument("--limit", type=int, default=50)
    table.add_argument("--query", default="")
    edition = sub.add_parser("read-edition")
    edition.add_argument("--edition", required=True)
    compare = sub.add_parser("compare")
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    compare.add_argument("--output", required=True)
    args = parser.parse_args()
    csv.field_size_limit(1048576)
    if args.command == "inspect":
        result = inspect_archive(args.archive, args.sha256)
    elif args.command == "compile":
        result = compile_edition(args.archive, args.recipe, args.output)
    elif args.command == "rows":
        result = rows_page(args.edition, args.resource, args.offset, args.limit, args.query)
    elif args.command == "table":
        result = archive_rows_page(args.archive, args.sha256, args.resource, args.offset, args.limit, args.query)
    elif args.command == "read-edition":
        root, result = read_edition(args.edition)
    else:
        result = comparison(args.before, args.after, args.output)
    sys.stdout.buffer.write(encoded(result))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = getattr(error, "code", "GTFS_SOURCE_ERROR")
        sys.stderr.write(json.dumps({"error": code, "message": str(error)}, ensure_ascii=False) + "\n")
        sys.exit(1)
