"""Meter/register/AMI/bill analysis on the maintained complete CSV discovery case.

This module imports the original discovery engine. It creates no source connectors,
changes no original rows and makes no automatic leak, meter-failure or refund decision.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from fractions import Fraction as F
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from discovery_engine import (
    DiscoveryError, require, read_json, write_json, json_bytes, digest, parse_json_bytes, safe_relative, finite_decimal,
    file_digest, run_manifest, record_database, verify_original_sources,
    create_handover, receive_handover,
)

SCHEMA = "tjlabs.water-reconciliation.selection.v1"
RESULT = "tjlabs.water-reconciliation.result.v1"
FIELDS = {
    "periods": ("period_id", "account_id", "start", "end", "billed_quantity",
                "billed_unit", "billed_water_charge", "tariff_id",
                "tariff_application_at", "fixed_charge_factor", "source_reference",
                "recorded_quantity", "recorded_unit", "recorded_source_reference"),
    "segments": ("segment_id", "period_id", "meter_id", "endpoint_id", "start",
                 "end", "start_read_id", "end_read_id", "rollover_count",
                 "register_modulus", "source_reference"),
    "reads": ("read_id", "account_id", "meter_id", "at", "value", "unit",
              "multiplier", "quality", "source_reference"),
    "intervals": ("interval_id", "account_id", "meter_id", "endpoint_id",
                  "start", "end", "quantity", "unit", "multiplier",
                  "quality", "source_reference"),
}
OPTIONAL_FIELDS = {"recorded_quantity", "recorded_unit", "recorded_source_reference"}
UTC = dt.timezone.utc

def exact(value):
    require(isinstance(value, str) and value and len(value) <= 1000,
            "Use a nonempty base-ten decimal string")
    try:
        number = finite_decimal(value)
        require(number.is_finite() and abs(number.as_tuple().exponent) <= 1000,
                "Nonfinite or excessive decimal")
        return F(number)
    except (ValueError, ArithmeticError) as error:
        raise DiscoveryError("Invalid exact decimal") from error

def stamp(value):
    require(isinstance(value, str) and ("T" in value), "Timestamp needs date and time")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None and parsed.utcoffset() is not None,
                "Timestamp needs its actual UTC offset; ambiguous local time is unresolved")
        return parsed.astimezone(UTC)
    except ValueError as error:
        raise DiscoveryError("Invalid offset timestamp") from error

def micros(value):
    delta = value - dt.datetime(1970, 1, 1, tzinfo=UTC)
    return delta.days * 86400000000 + delta.seconds * 1000000 + delta.microseconds

def rounded_integer(value, mode):
    require(mode in ("HALF_UP", "HALF_EVEN", "DOWN"), "Unknown rounding mode")
    sign = -1 if value < 0 else 1
    numerator, denominator = abs(value.numerator), value.denominator
    whole, remainder = divmod(numerator, denominator)
    if mode == "HALF_UP" and remainder * 2 >= denominator:
        whole += 1
    if mode == "HALF_EVEN" and (remainder * 2 > denominator or
                              (remainder * 2 == denominator and whole % 2)):
        whole += 1
    return sign * whole

def rounded(value, places, mode):
    require(type(places) is int and 0 <= places <= 12, "Decimal places must be 0 through 12")
    scale = 10 ** places
    return F(rounded_integer(value * scale, mode), scale)

def display(value, places=12):
    if value is None:
        return None
    scaled = rounded_integer(value * 10 ** places, "HALF_EVEN")
    sign = "-" if scaled < 0 else ""
    digits = str(abs(scaled)).rjust(places + 1, "0")
    return sign + (digits[:-places] + "." + digits[-places:] if places else digits)

def number(value):
    if value is None:
        return None
    return {"numerator": str(value.numerator), "denominator": str(value.denominator),
            "decimal_12": display(value), "display_rounding": "HALF_EVEN"}

def issue(items, code, references, detail):
    items.append({"code": code, "source_records": references, "detail": detail})

def contiguous(rows, start, end):
    """Return exact coverage diagnostics; never interpolate or prorate an interval."""
    issues, cursor = [], start
    for left, right, reference in sorted(rows, key=lambda row: (row[0], row[1], str(row[2]))):
        if right <= left:
            issues.append(("NONPOSITIVE_SPAN", reference))
            continue
        if left < start or right > end:
            issues.append(("CROSSES_SELECTED_BOUNDARY", reference))
        if left < cursor:
            issues.append(("OVERLAPPING_SPANS", reference))
        elif left > cursor:
            issues.append(("UNCOVERED_SPAN", {"start": cursor.isoformat(), "end": left.isoformat()}))
        cursor = max(cursor, right)
    if cursor < end:
        issues.append(("UNCOVERED_SPAN", {"start": cursor.isoformat(), "end": end.isoformat()}))
    return issues

def validate(selection, manifest):
    require(selection.get("schema") == SCHEMA, "Unsupported water selection")
    require(selection.get("interpretation_reference"), "Retain approved mapping/interpretation reference")
    tables = {t["id"]: t for t in manifest["tables"]}
    roles = selection.get("roles", {})
    require(set(roles) == set(FIELDS), "Select all four original table roles")
    for role, fields in FIELDS.items():
        binding = roles[role]
        require(binding.get("table") in tables, "Role must identify an original table")
        columns = {x["name"] for x in tables[binding["table"]]["columns"]}
        require(set(fields)-OPTIONAL_FIELDS <= set(binding.get("fields", {})) <= set(fields),
                "Declare every required original role field: " + role)
        require(all(v in columns for v in binding["fields"].values()), "Field mapping references missing source")
    ids = selection.get("period_ids")
    require(isinstance(ids, list) and ids and len(ids) == len(set(ids)) and
            all(isinstance(x, str) and x for x in ids), "Select explicit unique period IDs")
    require(isinstance(selection.get("accepted_read_quality"), list) and selection["accepted_read_quality"],
            "Declare accepted original register quality values")
    require(isinstance(selection.get("accepted_interval_quality"), list) and selection["accepted_interval_quality"],
            "Declare accepted original interval quality values")
    require(selection.get("timezone_interpretation_reference"), "Retain the timezone/offset interpretation")
    units = selection.get("units", {})
    require(units and all(isinstance(k, str) and k for k in units), "Declare source units")
    for unit, definition in units.items():
        require(definition.get("reference"), "Unit conversion needs its source reference")
        require(exact(definition["gallons_numerator"]) > 0 and exact(definition["gallons_denominator"]) > 0,
                "Unit ratio must be positive")
    require(exact(selection["volume_tolerance_gallons"]) >= 0, "Volume tolerance must be nonnegative")
    require(exact(selection["charge_tolerance"]) >= 0, "Charge tolerance must be nonnegative")
    require(selection.get("tolerance_reference"), "Comparison tolerance needs its reviewed source")
    tariffs = selection.get("tariffs")
    require(isinstance(tariffs, dict), "Declare selected tariff interpretations, including an empty map when unresolved")
    for tariff_id, tariff in tariffs.items():
        require(tariff_id and tariff.get("source_records") and tariff.get("interpretation_reference"),
                "Retain actual tariff rows and interpretation")
        require(tariff["quantity_unit"] in units and exact(tariff["fixed_charge"]) >= 0,
                "Tariff needs explicit quantity unit and fixed water charge, including confirmed zero")
        require(stamp(tariff["valid_from"]) < stamp(tariff["valid_to"]), "Invalid tariff application window")
        require(tariff["currency"] and tariff["rounding_stage"] in ("LINE", "TOTAL"),
                "Declare actual currency and rounding stage")
        rounded(F(0), tariff["currency_places"], tariff["rounding_mode"])
        quantity_rounding = tariff.get("quantity_rounding")
        require(quantity_rounding == "NONE" or isinstance(quantity_rounding, dict),
                "Quantity rounding must be NONE or an explicit places/mode object")
        if isinstance(quantity_rounding, dict):
            rounded(F(0), quantity_rounding["places"], quantity_rounding["mode"])
        tiers = tariff.get("tiers")
        require(isinstance(tiers, list) and tiers and tiers[-1]["through"] is None,
                "Tier schedule needs a final unbounded tier")
        previous = F(0)
        for i, tier in enumerate(tiers):
            require(exact(tier["price_per_unit"]) >= 0, "Tier rate must be nonnegative")
            if tier["through"] is None:
                require(i == len(tiers)-1, "Only the last tier can be unbounded")
            else:
                limit = exact(tier["through"])
                require(limit > previous, "Tier boundaries must strictly increase")
                previous = limit
    pattern = selection.get("patterns")
    if pattern is not None:
        require(pattern.get("interpretation_reference"), "Pattern criteria need a reviewed interpretation")
        try:
            ZoneInfo(pattern["timezone"])
        except (KeyError, ZoneInfoNotFoundError) as error:
            raise DiscoveryError("Pattern timezone is unavailable") from error
        require(isinstance(pattern.get("night_hours"), list) and
                all(type(x) is int and 0 <= x < 24 for x in pattern["night_hours"]),
                "Night hours must be explicitly selected local clock hours")
        require(exact(pattern["continuous_threshold_gpm"]) >= 0 and
                exact(pattern["minimum_continuous_hours"]) > 0,
                "Continuous-use criteria need nonnegative flow and positive elapsed time")
    return tables

def unit_factor(selection, name):
    require(name in selection["units"], "Unknown original unit: " + str(name))
    definition = selection["units"][name]
    return exact(definition["gallons_numerator"]) / exact(definition["gallons_denominator"])

def role_rows(db, manifest, selection, role):
    binding = selection["roles"][role]
    table_index = next(i for i,t in enumerate(manifest["tables"]) if t["id"] == binding["table"])
    table = manifest["tables"][table_index]
    columns = [x["name"] for x in table["columns"]]
    fields = list(FIELDS[role])
    positions = [columns.index(binding["fields"][x]) if x in binding["fields"] else None for x in fields]
    sql = "SELECT _row,_valid," + ",".join("NULL" if i is None else "n%d"%i for i in positions) + " FROM t%d"%table_index
    for row in db.execute(sql):
        yield {**dict(zip(fields, row[2:])), "_valid": bool(row[1]),
               "_source": {"table": table["id"], "record": row[0]}}

def source_reference_valid(db, manifest, reference):
    require(isinstance(reference, dict) and type(reference.get("record")) is int and reference["record"] > 0,
            "Evidence reference needs original table ID and positive record number")
    indices = {t["id"]: i for i,t in enumerate(manifest["tables"])}
    require(reference.get("table") in indices, "Evidence table absent")
    row = db.execute("SELECT _valid FROM t%d WHERE _row=?"%indices[reference["table"]],
                     (reference["record"],)).fetchone()
    require(row == (1,), "Evidence row is missing or invalid")

def billing(quantity_gallons, fixed_factor, at, tariff, selection):
    require(stamp(tariff["valid_from"]) <= at < stamp(tariff["valid_to"]),
            "Selected tariff does not cover its declared application timestamp")
    require(fixed_factor >= 0, "Fixed-charge factor must be nonnegative")
    quantity = quantity_gallons / unit_factor(selection, tariff["quantity_unit"])
    require(quantity >= 0, "Negative chargeable consumption needs separate reviewed credit treatment")
    rule = tariff["quantity_rounding"]
    if rule != "NONE":
        quantity = rounded(quantity, rule["places"], rule["mode"])
    components = []
    fixed = exact(tariff["fixed_charge"]) * fixed_factor
    components.append({"kind": "fixed_water_charge", "quantity": number(fixed_factor), "amount": fixed})
    previous, left = F(0), quantity
    for ordinal, tier in enumerate(tariff["tiers"], 1):
        limit = None if tier["through"] is None else exact(tier["through"])
        count = left if limit is None else min(left, limit-previous)
        count = max(F(0), count)
        amount = count * exact(tier["price_per_unit"])
        components.append({"kind": "tier", "tier": ordinal, "quantity": number(count),
                           "price_per_unit": tier["price_per_unit"], "amount": amount})
        left -= count
        if limit is not None:
            previous = limit
    require(left == 0, "Tariff did not allocate complete chargeable consumption")
    if tariff["rounding_stage"] == "LINE":
        total = sum((rounded(c["amount"], tariff["currency_places"], tariff["rounding_mode"])
                     for c in components), F(0))
    else:
        total = rounded(sum((c["amount"] for c in components), F(0)),
                        tariff["currency_places"], tariff["rounding_mode"])
    return {"currency": tariff["currency"], "chargeable_quantity": number(quantity),
            "quantity_unit": tariff["quantity_unit"], "amount": number(total),
            "components": [{**c, "amount": number(c["amount"]),
                            "charged_amount": number(rounded(c["amount"], tariff["currency_places"],
                                                      tariff["rounding_mode"]))
                            if tariff["rounding_stage"] == "LINE" else None} for c in components],
            "rounding_stage": tariff["rounding_stage"], "rounding_mode": tariff["rounding_mode"]}, total

def interval_patterns(db, selection, account, left, right):
    """Descriptive actual-interval arithmetic, with explicit local calendar coverage."""
    rule = selection.get("patterns")
    if rule is None:
        return {"status": "NOT_SELECTED"}
    zone = ZoneInfo(rule["timezone"])
    days, cross_days, runs = {}, set(), []
    threshold = exact(rule["continuous_threshold_gpm"])
    minimum = exact(rule["minimum_continuous_hours"]) * 3600
    current = None

    def close_run():
        nonlocal current
        if current is not None:
            duration = F(micros(current["end"])-micros(current["start"]), 1000000)
            runs.append({"start": current["start"].isoformat(), "end": current["end"].isoformat(),
                         "elapsed_hours": number(duration/3600), "gallons": number(current["volume"]),
                         "minimum_interval_gpm": number(current["minimum"]),
                         "meets_selected_duration": duration >= minimum, "source_records": current["refs"]})
            current = None

    for (payload,) in db.execute("SELECT payload FROM water_intervals WHERE account=? AND a<? AND b>? ORDER BY a,b,id",
                                 (account, micros(right), micros(left))):
        row = json.loads(payload)
        a, b = stamp(row["start"]), stamp(row["end"])
        require(left <= a < b <= right, "Patterns require complete selected boundaries")
        volume = exact(row["quantity"])*exact(row["multiplier"])*unit_factor(selection, row["unit"])
        seconds = F(micros(b)-micros(a), 1000000)
        gpm = volume*60/seconds
        local_start, local_end = a.astimezone(zone), (b-dt.timedelta(microseconds=1)).astimezone(zone)
        if local_start.date() != local_end.date():
            date = local_start.date()
            while date <= local_end.date():
                cross_days.add(date.isoformat())
                date += dt.timedelta(days=1)
        else:
            key = local_start.date().isoformat()
            day = days.setdefault(key, {"spans": [], "volume": F(0), "night_volume": F(0),
                                        "night_seconds": F(0), "night_unallocated": [], "refs": [], "flows": []})
            day["spans"].append((a,b,row["_source"]))
            day["volume"] += volume
            day["refs"].append(row["_source"])
            day["flows"].append(gpm)
            hours = set(range(min(local_start.hour,local_end.hour), max(local_start.hour,local_end.hour)+1))
            if hours.issubset(set(rule["night_hours"])):
                day["night_volume"] += volume
                day["night_seconds"] += seconds
            elif hours.intersection(rule["night_hours"]):
                day["night_unallocated"].append(row["_source"])
        if gpm > threshold:
            if current is None or current["end"] != a:
                close_run()
                current = {"start": a, "end": b, "volume": volume, "minimum": gpm, "refs": [row["_source"]]}
            else:
                current["end"] = b
                current["volume"] += volume
                current["minimum"] = min(current["minimum"],gpm)
                current["refs"].append(row["_source"])
        else:
            close_run()
    close_run()
    daily, prior = [], None
    first_day = left.astimezone(zone).date()
    last_day = (right-dt.timedelta(microseconds=1)).astimezone(zone).date()
    date = first_day
    while date <= last_day:
        key = date.isoformat()
        a = dt.datetime.combine(date,dt.time(),zone).astimezone(UTC)
        b = dt.datetime.combine(date+dt.timedelta(days=1),dt.time(),zone).astimezone(UTC)
        day = days.get(key, {"spans": [], "volume": F(0), "night_volume": F(0), "night_seconds": F(0),
                             "night_unallocated": [], "refs": [], "flows": []})
        complete = left <= a and b <= right and key not in cross_days and not contiguous(day["spans"],a,b)
        hours = F(micros(b)-micros(a),3600000000)
        record = {"local_date": key, "timezone": rule["timezone"], "actual_day_hours": number(hours),
                  "complete_day": complete, "source_records": day["refs"],
                  "gallons": number(day["volume"]) if complete else None,
                  "minimum_interval_gpm": number(min(day["flows"])) if complete and day["flows"] else None,
                  "maximum_interval_gpm": number(max(day["flows"])) if complete and day["flows"] else None,
                  "night_hours": rule["night_hours"], "night_crossing_records": day["night_unallocated"],
                  "night_gallons": number(day["night_volume"]) if complete and not day["night_unallocated"] else None,
                  "night_observed_hours": number(day["night_seconds"]/3600) if complete and not day["night_unallocated"] else None,
                  "previous_complete_day_difference_gallons": None,
                  "previous_complete_day_relative_change": None}
        if complete:
            if prior is not None and prior[0]+dt.timedelta(days=1) == date:
                delta = day["volume"]-prior[1]
                record["previous_complete_day_difference_gallons"] = number(delta)
                if prior[1] != 0:
                    record["previous_complete_day_relative_change"] = number(delta/prior[1])
            prior = (date,day["volume"])
        else:
            record["coverage_note"] = "Partial selected calendar day, crossing interval or incomplete daily allocation; daily total is uncomputed"
            prior = None
        daily.append(record)
        date += dt.timedelta(days=1)
    return {"status": "COMPLETE", "criteria": rule, "daily": daily, "continuous_runs": runs,
            "meaning": "Observed interval patterns and exact elapsed-time arithmetic. Night usage, an abrupt difference or sustained flow is not by itself a leak or meter-failure finding."}

def analyse(db, manifest, report, selection):
    validate(selection, manifest)
    for tariff in selection["tariffs"].values():
        for reference in tariff["source_records"]:
            source_reference_valid(db, manifest, reference)
    selected = set(selection["period_ids"])
    periods = {}
    for row in role_rows(db, manifest, selection, "periods"):
        if row["period_id"] in selected:
            periods.setdefault(row["period_id"], []).append(row)
    accounts = {r["account_id"] for group in periods.values() for r in group}
    segments, reads, unassigned_segments = {}, {}, []
    for row in role_rows(db, manifest, selection, "segments"):
        if row["period_id"] is None:
            unassigned_segments.append(row["_source"])
        if row["period_id"] in selected:
            segments.setdefault(row["period_id"], []).append(row)
    required_reads = {s[k] for group in segments.values() for s in group for k in ("start_read_id","end_read_id")}
    for row in role_rows(db, manifest, selection, "reads"):
        if row["read_id"] in required_reads:
            reads.setdefault(row["read_id"], []).append(row)
    # Full selected-account interval population remains disk backed. No row sampling.
    db.execute("PRAGMA temp_store=FILE")
    db.execute("CREATE TEMP TABLE water_intervals(account TEXT,meter TEXT,endpoint TEXT,a INTEGER,b INTEGER,id TEXT,payload TEXT)")
    malformed, unassigned_intervals = {}, []
    for row in role_rows(db, manifest, selection, "intervals"):
        if row["account_id"] is None:
            unassigned_intervals.append(row["_source"])
        if row["account_id"] not in accounts:
            continue
        try:
            left, right = stamp(row["start"]), stamp(row["end"])
            require(right > left, "Interval has nonpositive duration")
            db.execute("INSERT INTO water_intervals VALUES(?,?,?,?,?,?,?)",
                       (row["account_id"], row["meter_id"], row["endpoint_id"], micros(left), micros(right),
                        row["interval_id"], json.dumps(row)))
        except (DiscoveryError, TypeError, KeyError):
            malformed.setdefault(row["account_id"], []).append(row["_source"])
    db.execute("CREATE INDEX temp.water_interval_period ON water_intervals(account,meter,endpoint,a,b)")
    db.execute("CREATE INDEX temp.water_interval_id ON water_intervals(id)")
    results = []
    for period_id in selection["period_ids"]:
        group, problems = periods.get(period_id, []), []
        result = {"period_id": period_id, "classification": "REVIEW_ITEM",
                  "register_gallons": None, "ami_gallons": None, "recorded_gallons": None, "billed_gallons": None,
                  "billing": None, "comparisons": [], "issues": problems, "segments": []}
        results.append(result)
        if not group:
            issue(problems, "SELECTED_PERIOD_MISSING", [],
                  "The selected original period ID is absent; preserve the selection and provide or correct its source in a later edition")
            continue
        if len(group) != 1 or not group[0]["_valid"]:
            issue(problems, "PERIOD_AMBIGUOUS_OR_INVALID", [x["_source"] for x in group],
                  "Correct the original selected period and create a later source edition")
            continue
        p = group[0]
        result.update({"account_id": p["account_id"], "source_record": p["_source"],
                       "period": {"start": p["start"], "end": p["end"]}})
        try:
            left, right = stamp(p["start"]), stamp(p["end"])
            require(right > left, "Period has nonpositive duration")
        except (DiscoveryError, TypeError) as error:
            issue(problems, "PERIOD_TIME_UNRESOLVED", [p["_source"]], str(error))
            continue
        parts = segments.get(period_id, [])
        coverage, register_total, ami_total = [], F(0), F(0)
        register_ok, ami_ok = bool(parts), bool(parts)
        if unassigned_segments:
            register_ok = ami_ok = False
            issue(problems, "SEGMENT_POPULATION_MEMBERSHIP_UNRESOLVED", unassigned_segments,
                  "Original segment rows have no period ID; resolve their selected-population membership")
        if unassigned_intervals:
            ami_ok = False
            issue(problems, "INTERVAL_POPULATION_MEMBERSHIP_UNRESOLVED", unassigned_intervals,
                  "Original interval rows have no account ID; resolve their selected-population membership")
        part_ids = [x["segment_id"] for x in parts]
        if len(part_ids) != len(set(part_ids)):
            register_ok = ami_ok = False
            issue(problems, "SEGMENT_ID_AMBIGUOUS", [x["_source"] for x in parts], "Repeated selected segment ID")
        for part in parts:
            refs = [part["_source"]]
            record = {"segment_id": part["segment_id"], "source_record": part["_source"],
                      "register_gallons": None, "ami_gallons": None, "interval_records": []}
            result["segments"].append(record)
            try:
                require(part["_valid"] and part["source_reference"], "Selected segment has invalid or unreferenced source")
                a, b = stamp(part["start"]), stamp(part["end"])
                require(b > a, "Segment has nonpositive duration")
                coverage.append((a, b, part["_source"]))
            except (DiscoveryError, TypeError) as error:
                register_ok = ami_ok = False
                issue(problems, "SEGMENT_UNRESOLVED", refs, str(error))
                continue
            try:
                boundary = []
                for field, at in (("start_read_id", a), ("end_read_id", b)):
                    candidates = reads.get(part[field], [])
                    require(len(candidates) == 1, "Boundary register ID missing or repeated")
                    reading = candidates[0]
                    refs.append(reading["_source"])
                    require(reading["_valid"] and reading["source_reference"], "Boundary register row invalid or unreferenced")
                    require(reading["account_id"] == p["account_id"] and reading["meter_id"] == part["meter_id"],
                            "Boundary register belongs to another account or physical meter")
                    require(stamp(reading["at"]) == at, "Register is not at the exact selected boundary")
                    require(reading["quality"] in selection["accepted_read_quality"], "Register quality requires interpretation")
                    require(exact(reading["multiplier"]) > 0 and exact(reading["value"]) >= 0, "Invalid register scale/value")
                    boundary.append(reading)
                first, last = boundary
                require(first["unit"] == last["unit"] and exact(first["multiplier"]) == exact(last["multiplier"]),
                        "Register scale changed inside the selected physical-meter segment")
                rollovers = exact(part["rollover_count"])
                require(rollovers.denominator == 1 and rollovers >= 0, "Rollover count needs a documented nonnegative integer")
                modulus = F(0) if part["register_modulus"] is None else exact(part["register_modulus"])
                require(rollovers == 0 or modulus > max(exact(first["value"]), exact(last["value"])),
                        "Rollover needs the actual valid register modulus")
                delta = exact(last["value"]) - exact(first["value"]) + rollovers * modulus
                require(delta >= 0, "Negative register change needs a replacement/reset/rollover interpretation")
                volume = delta * exact(first["multiplier"]) * unit_factor(selection, first["unit"])
                register_total += volume
                record["register_gallons"] = number(volume)
                record["register_records"] = [first["_source"], last["_source"]]
            except (DiscoveryError, TypeError, KeyError) as error:
                register_ok = False
                issue(problems, "REGISTER_UNCOMPUTED", refs, str(error))
            try:
                require(not malformed.get(p["account_id"]), "An interval for this account has unresolved timestamps")
                spans, volume = [], F(0)
                cursor = db.execute("SELECT payload FROM water_intervals WHERE account=? AND meter=? AND endpoint=? AND a<? AND b>? ORDER BY a,b,id",
                                    (p["account_id"], part["meter_id"], part["endpoint_id"], micros(b), micros(a)))
                # A second cursor preserves iteration while checking full-source ID uniqueness.
                for (payload,) in cursor:
                    item = json.loads(payload)
                    record["interval_records"].append(item["_source"])
                    require(item["_valid"] and item["source_reference"], "Interval row invalid or unreferenced")
                    require(item["interval_id"] and db.execute("SELECT COUNT(*) FROM water_intervals WHERE id=?",
                                                             (item["interval_id"],)).fetchone()[0] == 1,
                            "Interval identity is missing or repeated in the selected-account population")
                    require(item["quality"] in selection["accepted_interval_quality"], "Interval quality requires interpretation")
                    x, y = stamp(item["start"]), stamp(item["end"])
                    spans.append((x, y, item["_source"]))
                    quantity, multiplier = exact(item["quantity"]), exact(item["multiplier"])
                    require(quantity >= 0 and multiplier > 0, "Invalid interval quantity/scale")
                    volume += quantity * multiplier * unit_factor(selection, item["unit"])
                gaps = contiguous(spans, a, b)
                require(not gaps, "AMI coverage is not exact: " + json.dumps(gaps))
                ami_total += volume
                record["ami_gallons"] = number(volume)
                duration = F(micros(b)-micros(a), 1000000)
                record["average_gallons_per_minute"] = number(volume*60/duration)
                record["same_average_30_day_gallons"] = number(volume*2592000/duration)
                record["projection_meaning"] = "Constant-average arithmetic projection; no future-use or leak conclusion"
            except (DiscoveryError, TypeError, KeyError) as error:
                ami_ok = False
                issue(problems, "AMI_UNCOMPUTED", [part["_source"]] + malformed.get(p["account_id"], []), str(error))
        # Every interval overlapping this selected account period must have one
        # matching physical-meter/endpoint segment; do not hide alternate streams.
        unassigned = []
        for (payload,) in db.execute("SELECT payload FROM water_intervals WHERE account=? AND a<? AND b>?",
                                     (p["account_id"], micros(right), micros(left))):
            item = json.loads(payload)
            x, y = stamp(item["start"]), stamp(item["end"])
            matches = 0
            for part in parts:
                try:
                    if (part["meter_id"] == item["meter_id"] and part["endpoint_id"] == item["endpoint_id"]
                            and stamp(part["start"]) <= x and y <= stamp(part["end"])):
                        matches += 1
                except (DiscoveryError, TypeError):
                    pass
            if matches != 1:
                unassigned.append(item["_source"])
        if unassigned:
            ami_ok = False
            issue(problems, "INTERVAL_ASSIGNMENT_UNRESOLVED", unassigned,
                  "Each overlapping interval needs exactly one selected physical-meter/endpoint span")
        coverage_issues = contiguous(coverage, left, right)
        if coverage_issues:
            register_ok = ami_ok = False
            issue(problems, "PERIOD_SEGMENT_COVERAGE", [x["_source"] for x in parts], json.dumps(coverage_issues))
        if register_ok:
            result["register_gallons"] = number(register_total)
        if ami_ok:
            result["ami_gallons"] = number(ami_total)
            result["patterns"] = interval_patterns(db, selection, p["account_id"], left, right)
        else:
            result["patterns"] = {"status": "UNCOMPUTED", "reason": "Resolve the full AMI coverage and source identity first"}
        billed = None
        try:
            require(p["source_reference"], "Billed quantity needs its original source reference")
            billed = exact(p["billed_quantity"]) * unit_factor(selection, p["billed_unit"])
            require(billed >= 0, "Negative billed quantity needs explicit adjustment interpretation")
            result["billed_gallons"] = number(billed)
        except (DiscoveryError, TypeError, KeyError) as error:
            billed = None
            issue(problems, "BILLED_VOLUME_UNCOMPUTED", [p["_source"]], str(error))
        recorded = None
        try:
            require(p.get("recorded_source_reference"), "Separate recorded account consumption was not supplied")
            recorded = exact(p.get("recorded_quantity")) * unit_factor(selection, p.get("recorded_unit"))
            require(recorded >= 0, "Negative recorded consumption needs explicit adjustment interpretation")
            result["recorded_gallons"] = number(recorded)
            result["recorded_source_reference"] = p["recorded_source_reference"]
        except (DiscoveryError, TypeError, KeyError) as error:
            recorded = None
            issue(problems, "RECORDED_CONSUMPTION_UNCOMPUTED", [p["_source"]], str(error))
        values = {"register": register_total if register_ok else None, "ami": ami_total if ami_ok else None,
                  "recorded": recorded, "billed": billed}
        tolerance = exact(selection["volume_tolerance_gallons"])
        for first, last in (("register","ami"),("ami","recorded"),("recorded","billed"),("register","billed")):
            if values[first] is not None and values[last] is not None:
                difference = values[last]-values[first]
                result["comparisons"].append({"from": first, "to": last, "difference_gallons": number(difference),
                                             "within_selected_tolerance": abs(difference) <= tolerance})
                if abs(difference) > tolerance:
                    refs = [p["_source"]] + [q["_source"] for q in parts]
                    issue(problems, "VOLUME_DIFFERENCE_OUTSIDE_TOLERANCE", refs,
                          json.dumps({"from": first, "to": last, "from_gallons": number(values[first]),
                                      "to_gallons": number(values[last]), "difference_gallons": number(difference),
                                      "tolerance_gallons": number(tolerance)}))
        try:
            require(billed is not None, "Billed source quantity unresolved")
            require(p["tariff_id"] in selection["tariffs"], "Selected tariff is unavailable")
            tariff = selection["tariffs"][p["tariff_id"]]
            calculation, charge = billing(billed, exact(p["fixed_charge_factor"]),
                                          stamp(p["tariff_application_at"]), tariff, selection)
            actual = exact(p["billed_water_charge"])
            calculation.update({"tariff_id": p["tariff_id"], "source_records": tariff["source_records"],
                                "billed_water_charge": number(actual), "difference": number(actual-charge),
                                "within_selected_tolerance": abs(actual-charge) <= exact(selection["charge_tolerance"]),
                                "scope": "Reviewed water charge only; excludes separately identified taxes, arrears, penalties and unrelated charges"})
            result["billing"] = calculation
            if not calculation["within_selected_tolerance"]:
                issue(problems, "WATER_CHARGE_DIFFERENCE_OUTSIDE_TOLERANCE",
                      [p["_source"]] + tariff["source_records"],
                      json.dumps({"calculated_charge": number(charge), "billed_water_charge": number(actual),
                                  "difference": number(actual-charge),
                                  "tolerance": number(exact(selection["charge_tolerance"]))}))
        except (DiscoveryError, TypeError, KeyError) as error:
            issue(problems, "BILL_ARITHMETIC_UNCOMPUTED", [p["_source"]], str(error))
        if not problems and all(x["within_selected_tolerance"] for x in result["comparisons"]) and result["billing"]["within_selected_tolerance"]:
            result["classification"] = "RECONCILED_WITHIN_SELECTED_TOLERANCES"
    return {"schema": RESULT, "source_run_identity": report["run_identity"], "data_class": report["data_class"],
            "interpretation_reference": selection["interpretation_reference"],
            "selected_periods": len(selection["period_ids"]), "selected_accounts": len(accounts),
            "missing_selected_period_ids": sorted(selected-set(periods)),
            "selection_sha256": digest(json_bytes(selection)), "recipe_sha256": file_digest(__file__),
            "source_inputs": report["lineage"]["inputs"], "results": results,
            "meaning": "Complete selected-period arithmetic and coverage. Engineering/field conclusions require the prime's actual evidence and approval."}

def render(result):
    lines = ["# Meter, interval and bill reconciliation", "",
             "Data class: " + result["data_class"], "",
             "Source case: " + result["source_run_identity"], "",
             "Selected accounts: %d; periods: %d."%(result["selected_accounts"],result["selected_periods"]), "",
             "| Period | Register gallons | AMI gallons | Recorded gallons | Billed gallons | Review items |",
             "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in result["results"]:
        values = [row.get(k) for k in ("register_gallons","ami_gallons","recorded_gallons","billed_gallons")]
        label = str(row["period_id"]).replace("|", "\\|").replace("\n", " ")
        lines.append("| %s | %s | %s | %s | %s | %d |"%(label, *[v["decimal_12"] if v else "Uncomputed" for v in values], len(row["issues"])))
    lines += ["", "Full exact rational values, tier lines, comparison decisions and source record references are in result.json.",
              "A missing value is uncomputed. Complete CSV snapshots and original field meanings remain in the source case.",
              "Review items are arithmetic/coverage observations; the prime assigns substantive findings from its complete field evidence.", ""]
    return "\n".join(lines)

def run_water(manifest_path, selection_path, output, input_root=None):
    output = Path(output).resolve()
    require(not output.exists(), "Choose a new complete water case directory")
    selection_bytes = Path(selection_path).read_bytes()
    selection = parse_json_bytes(selection_bytes)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="."+output.name+"-", dir=output.parent))
    try:
        case = stage/"case"
        original = run_manifest(manifest_path, case, root=input_root)
        report = original["report"]
        manifest = verify_original_sources(case, report)
        with record_database(case, report) as (database, database_mode):
            with sqlite3.connect(Path(database).as_uri()+"?mode=ro", uri=True) as db:
                result = analyse(db, manifest, report, selection)
        water = case/"water"
        water.mkdir()
        (water/"selection.original.json").write_bytes(selection_bytes)
        write_json(water/"selection.json", selection)
        from water_report import render_html
        recipe_dir = Path(__file__).resolve().parent
        result["recipe_files"] = [{"path": name, "bytes": (recipe_dir/name).stat().st_size,
                                   "sha256": file_digest(recipe_dir/name)}
                                  for name in ("water_reconciliation.py", "water_report.py")]
        result["database_mode"] = database_mode
        result["selection_original_sha256"] = digest(selection_bytes)
        write_json(water/"result.json", result)
        (water/"report.md").write_text(render(result), encoding="utf-8")
        (water/"report.html").write_text(render_html(result, report, manifest), encoding="utf-8")
        # All exceptions are exported. Formula-leading values are escaped only for presentation.
        with open(water/"review-items.csv", "w", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["period_id","code","source_records","detail"])
            for row in result["results"]:
                for item in row["issues"]:
                    values = [row["period_id"], item["code"], json.dumps(item["source_records"]), item["detail"]]
                    writer.writerow(["'"+v if v.lstrip().startswith(("=","+","-","@")) else v for v in values])
        write_json(water/"delivery.json", {
            "schema": "tjlabs.water-reconciliation.delivery.v1",
            "source_run_identity": result["source_run_identity"],
            "files": [{"path": path.relative_to(water).as_posix(), "bytes": path.stat().st_size,
                       "sha256": file_digest(path)} for path in sorted(water.rglob("*")) if path.is_file()]})
        os.rename(case, output)
        return {"output": str(output), "source_run_identity": result["source_run_identity"],
                "selected_accounts": result["selected_accounts"], "selected_periods": result["selected_periods"],
                "review_items": sum(len(r["issues"]) for r in result["results"])}
    finally:
        shutil.rmtree(stage, ignore_errors=True)

def pack_water(run_directory, destination):
    root = Path(run_directory).resolve()
    report = read_json(root/"report.json")
    verify_original_sources(root, report)
    water = root/"water"
    delivery = read_json(water/"delivery.json")
    require(delivery.get("schema") == "tjlabs.water-reconciliation.delivery.v1" and
            delivery["source_run_identity"] == report["run_identity"], "Water delivery belongs to another source run")
    declared = delivery["files"]
    names = [x["path"] for x in declared]
    require(len(names) == len(set(names)), "Duplicate delivered water path")
    actual = [p.relative_to(water).as_posix() for p in water.rglob("*") if p.is_file() and p != water/"delivery.json"]
    require(set(names) == set(actual), "Complete water delivery member set changed")
    for item in declared:
        path = water/safe_relative(item["path"])
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(water.resolve()),
                "Water delivery member must remain in its original case")
        require(path.stat().st_size == item["bytes"] and file_digest(path) == item["sha256"],
                "Water delivery member changed: "+item["path"])
    original_selection = (water/"selection.original.json").read_bytes()
    selection = parse_json_bytes(original_selection)
    result = read_json(water/"result.json")
    require(selection == read_json(water/"selection.json"), "Original and normalized selected interpretation differ")
    require(result["schema"] == RESULT and result["source_run_identity"] == report["run_identity"] and
            result["source_inputs"] == report["lineage"]["inputs"] and
            result["selection_sha256"] == digest(json_bytes(selection)) and
            result["selection_original_sha256"] == digest(original_selection),
            "Water result source or selection binding changed")
    here = Path(__file__).resolve().parent
    expected = {row["path"]: row for row in result["recipe_files"]}
    require(set(expected) == {"water_reconciliation.py", "water_report.py"},
            "Result must select the complete calculator and rendered-report implementation")
    for name, identity in expected.items():
        require((here/name).is_file() and (here/name).stat().st_size == identity["bytes"] and
                file_digest(here/name) == identity["sha256"], "Restore the original selected recipe file before packing: "+name)
    require(result["recipe_sha256"] == expected["water_reconciliation.py"]["sha256"],
            "Water recipe identity differs from the result")
    required = ("discovery_engine.py", "discovery_cli.py", "water_reconciliation.py", "water_report.py",
                "README.md", "OPERATOR_GUIDE.md", "WATER_RECONCILIATION.md", "WATER_SELECTION_API.json")
    require(all((here/name).is_file() for name in required), "Complete source and every operating guide are required")
    return create_handover(root, destination, [here/name for name in required])

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--manifest", required=True)
    run.add_argument("--selection", required=True)
    run.add_argument("--output", required=True)
    run.add_argument("--input-root")
    pack = sub.add_parser("pack")
    pack.add_argument("--run", required=True)
    pack.add_argument("--output", required=True)
    receive = sub.add_parser("receive")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            answer = run_water(args.manifest, args.selection, args.output, args.input_root)
        elif args.command == "pack":
            answer = pack_water(args.run, args.output)
        else:
            answer = receive_handover(args.archive, args.output)
        print(json.dumps({"status":"COMPLETE", **answer}, ensure_ascii=False))
        return 0
    except (DiscoveryError, ValueError, OSError, sqlite3.Error, KeyError, TypeError) as error:
        print(json.dumps({"status":"ERROR", "type":type(error).__name__, "message":str(error)}, ensure_ascii=False))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
