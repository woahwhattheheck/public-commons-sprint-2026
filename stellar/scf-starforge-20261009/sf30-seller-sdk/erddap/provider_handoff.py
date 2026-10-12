"""MIT. Reviewed provider intake bundles over the original SF30 ERDDAP capture.

This module consumes erddap_source.read_capture unchanged. It preserves each
original response and numeric token, records explicit metadata decisions, and
prepares a station intake CSV without applying scientific quality control.
"""
from __future__ import annotations
import copy
import csv
import datetime as dt
import io
import json
import re
import stat
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
import erddap_source as source
from erddap_source import InputError

PROFILE = "stellar-forge.erddap-provider-handoff.v1"
REVIEW = "stellar-forge.erddap-provider-review.v1"
REPORT = "stellar-forge.erddap-provider-readiness.v1"
BUNDLE = "stellar-forge.erddap-provider-bundle.v1"
RECEIVED = "stellar-forge.erddap-provider-received.v1"
VERSION = "1.0.0"
EVALUATION_SCHEMA = "stellar-forge.erddap-provider-evaluation.v1"
CURRENT_EVALUATION = {"schema": EVALUATION_SCHEMA, "readiness": "1.0.0", "csvComparison": "decimal-v1"}
MAX_HANDOFF = 4 * source.MAX_SOURCE + 8 * 1024 * 1024
MAX_PROFILE = 2 * 1024 * 1024
MAX_STATIONS = 10000
ALIAS = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,127}\Z")
ISO = re.compile(r"(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(\.\d{1,30})?([Zz]|[+-]\d{2}:\d{2})\Z")
ROLES = {"time", "station", "latitude", "longitude", "depth", "measurement", "quality", "other"}
SOURCE_POLICY = ("Original ERDDAP destination values and quality flags are retained. "
                 "No rescaling, physical unit conversion, calibration, interpolation, "
                 "quality evaluation or row filtering is performed.")
INTAKE_GUIDE = "https://www.axiomdatascience.com/best-practices/SubmitDataSensors.html"

def _text(value, field, limit=8192):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise InputError(field + " must be text of at most " + str(limit) + " characters")
    return value

def _object(value, allowed, field):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise InputError(field + " contains missing structure or unknown fields")
    return value

def _flag(value, field):
    if type(value) is not bool:
        raise InputError(field + " must be true or false")
    return value

def _list(value, field, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise InputError(field + " must be a list of at most " + str(limit) + " items")
    return value

def _attrs(meta, name):
    return {k: v.get("value") for k, v in meta.get("attributes", {}).get(name, {}).items()}

def _scalar(value):
    return "" if value is None else str(value)

def _decimal(value):
    if not isinstance(value, str) or len(value) > 256 or not source.NUMBER.fullmatch(value):
        raise ValueError("Use a finite decimal number")
    d = Decimal(value)
    if not d.is_finite():
        raise ValueError("Use a finite decimal number")
    return d

def _csv(rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def evaluation(value):
    """A closed, declared evaluator identity; unknown versions are never guessed."""
    if not isinstance(value, dict) or set(value) != {"schema", "readiness", "csvComparison"}:
        raise InputError("Provider evaluation requires its exact schema and supported versions")
    if value["schema"] != EVALUATION_SCHEMA or value["readiness"] != "1.0.0" or value["csvComparison"] not in {"lexical-v1", "decimal-v1"}:
        raise InputError("Unsupported provider evaluation or original comparison version")
    return dict(value)

def _evaluation_capture(original, declared, legacy_comparison=None):
    """Re-evaluate the same parsed original without changing its shared source."""
    c = capture(original)
    selected = copy.copy(c)
    selected.evaluation = evaluation(declared) if declared is not None else None
    version = selected.evaluation["csvComparison"] if selected.evaluation is not None else legacy_comparison
    if version not in {"lexical-v1", "decimal-v1"}:
        raise InputError("Original review comparison version is missing")
    selected.comparison = source.csv_comparison(c.originals["data.csv"], c.table, comparison_version=version)
    return selected

class Capture:
    """A complete original capture parsed by the maintained ERDDAP source engine."""
    def __init__(self, value):
        raw = value if isinstance(value, bytes) else value.read(2 * source.MAX_SOURCE + 1)
        if not isinstance(raw, bytes) or len(raw) > 2 * source.MAX_SOURCE:
            raise InputError("Choose a complete original ERDDAP capture within the source budget")
        self.raw = raw
        self.id = source.sha(raw)
        self.manifest, self.meta, self.table, self.originals = source.read_capture(io.BytesIO(raw))
        self.names = self.table["columnNames"]
        self.slots = {name: i for i, name in enumerate(self.names)}
        self.columns = []
        by = {v["name"]: v for v in self.meta["variables"] + self.meta["dimensions"]}
        missing = [0] * len(self.names)
        empty = [0] * len(self.names)
        samples = [[] for _ in self.names]
        for row in self.table["rows"]:
            for i, v in enumerate(row):
                if v is None:
                    missing[i] += 1
                elif v == "" and not isinstance(v, source.Number):
                    empty[i] += 1
                if v not in samples[i] and len(samples[i]) < 5:
                    samples[i].append(v)
        for i, name in enumerate(self.names):
            self.columns.append({"name": name, "type": self.table["columnTypes"][i],
                "units": self.table["columnUnits"][i], "metadata": by.get(name, {}),
                "missing": missing[i], "emptyStrings": empty[i], "samples": samples[i]})
        self.evaluation = evaluation(CURRENT_EVALUATION)
        self.comparison = source.csv_comparison(self.originals["data.csv"], self.table,
            comparison_version=self.evaluation["csvComparison"])

    def summary(self):
        m = self.manifest
        return {"id": self.id, "bytes": len(self.raw), "server": m["server"],
            "datasetId": m["datasetId"], "protocol": m["protocol"],
            "selection": m["selection"], "query": m["query"],
            "rowCount": len(self.table["rows"]), "metadata": self.meta,
            "columns": self.columns, "csvComparison": self.comparison,
            "valuePolicy": SOURCE_POLICY}

def capture(value):
    return value if isinstance(value, Capture) else Capture(value)

def utc_time(value, representation):
    """Explicit time conversion, preserving the original fractional value."""
    if value is None or value == "":
        raise ValueError("Timestamp is missing")
    if representation == "iso8601-offset":
        if not isinstance(value, str) or isinstance(value, source.Number):
            raise ValueError("ISO time requires a source string with an explicit UTC offset")
        m = ISO.fullmatch(value)
        if not m:
            raise ValueError("Use an ISO timestamp with seconds and Z or an explicit offset")
        day, clock, fraction, zone = m.groups()
        base = dt.datetime.fromisoformat(day + "T" + clock)
        if zone == "-00:00":
            raise ValueError("A negative-zero offset does not establish the original UTC offset")
        if zone.upper() == "Z":
            offset = dt.timedelta()
        else:
            hours, minutes = int(zone[1:3]), int(zone[4:6])
            if hours > 14 or minutes > 59 or (hours == 14 and minutes):
                raise ValueError("Timestamp offset is outside the supported UTC offset range")
            offset = dt.timedelta(minutes=(1 if zone[0] == "+" else -1) * (60 * hours + minutes))
        result = base - offset
        return result.isoformat(timespec="seconds") + (fraction or "") + "Z"
    if representation == "unix-seconds":
        if not isinstance(value, source.Number):
            raise ValueError("Unix seconds requires the original numeric JSON token")
        number = _decimal(str(value))
        if not Decimal("-62135596800") <= number < Decimal("253402300800"):
            raise ValueError("Unix seconds is outside the supported calendar range")
        # Decimal subtraction is performed with sufficient precision for the source
        # token. Splitting the fixed-point spelling avoids binary floating point.
        parts = number.as_tuple()
        if len(parts.digits) > 128 or parts.exponent < -30 or parts.exponent > 12:
            raise ValueError("Timestamp precision or exponent exceeds the supported exact UTC representation")
        spelling = format(number, "f")
        if len(spelling) > 128:
            raise ValueError("Timestamp precision exceeds the supported 128-character value")
        seconds = int(number.to_integral_value(rounding=ROUND_FLOOR))
        from decimal import localcontext
        with localcontext() as context:
            context.prec = max(64, len(spelling) + 10)
            fraction = number - Decimal(seconds)
            suffix = format(fraction, "f")[1:].rstrip("0") if fraction else ""
        result = dt.datetime(1970, 1, 1) + dt.timedelta(seconds=seconds)
        return result.isoformat(timespec="seconds") + suffix + "Z"
    raise ValueError("Choose ISO timestamps with an offset or numeric Unix seconds")

def _time_key(stamp):
    match = ISO.fullmatch(stamp)
    return (match.group(1), match.group(2), Decimal(match.group(3) or "0"))


def _station(value):
    keys = ["sourceValue", "id", "name", "latitude", "longitude", "depth",
        "depthUnits", "depthPositive", "platformType", "positionKind",
        "expectedStart", "expectedEnd", "institutions", "attribution", "links",
        "previousDeployments", "notes", "reviewed"]
    _object(value, keys, "station")
    result = {key: _text(value.get(key, ""), "station." + key, 8192 if key in
        {"notes", "links", "previousDeployments", "attribution"} else 1024)
        for key in keys if key != "reviewed"}
    result["reviewed"] = _flag(value.get("reviewed", False), "station.reviewed")
    if result["positionKind"] not in {"fixed", "mobile", "representative"}:
        raise InputError("station.positionKind must be fixed, mobile or representative")
    if result["depthPositive"] not in {"", "up", "down"}:
        raise InputError("station.depthPositive must be up, down or empty")
    return result

def normalize_profile(value, original):
    c = capture(original)
    if len(source.jbytes(value)) > MAX_PROFILE:
        raise InputError("Provider profile exceeds its supported size")
    keys = ["schema", "sourceId", "title", "organization", "contacts", "license",
        "access", "time", "stationColumn", "stations", "variables", "quality", "reviewedBy", "notes", "dataEdition"]
    _object(value, keys, "provider profile")
    if value.get("schema") != PROFILE or value.get("sourceId") != c.id:
        raise InputError("Provider profile belongs to another original capture")
    p = {"schema": PROFILE, "sourceId": c.id, "dataEdition": value.get("dataEdition", "require-equivalent")}
    if p["dataEdition"] not in {"require-equivalent", "canonical-json"}:
        raise InputError("Choose the reviewed original JSON/CSV edition policy")
    for key in ["title", "organization", "stationColumn", "reviewedBy", "notes"]:
        p[key] = _text(value.get(key, ""), key, 65536 if key == "notes" else 1024)
    contacts = _object(value.get("contacts"), {"technical", "scientific"}, "contacts")
    p["contacts"] = {}
    for role in ["technical", "scientific"]:
        item = _object(contacts.get(role), {"name", "email", "organization", "notes"}, role + " contact")
        p["contacts"][role] = {k: _text(item.get(k, ""), role + "." + k, 8192 if k == "notes" else 1024)
            for k in ["name", "email", "organization", "notes"]}
    lic = _object(value.get("license"), {"text", "attribution", "reviewed"}, "license")
    p["license"] = {k: _text(lic.get(k, ""), "license." + k, 65536) for k in ["text", "attribution"]}
    p["license"]["reviewed"] = _flag(lic.get("reviewed", False), "license.reviewed")
    access = _object(value.get("access"), {"sourceUrl", "refresh", "preprocessing", "documentation"}, "access")
    p["access"] = {k: _text(access.get(k, ""), "access." + k, 32768)
        for k in ["sourceUrl", "refresh", "preprocessing", "documentation"]}
    timing = _object(value.get("time"), {"column", "representation", "originalTimezone", "calendar",
        "daylightSaving", "notes", "reviewed"}, "time")
    p["time"] = {k: _text(timing.get(k, ""), "time." + k, 8192) for k in
        ["column", "representation", "originalTimezone", "calendar", "daylightSaving", "notes"]}
    p["time"]["reviewed"] = _flag(timing.get("reviewed", False), "time.reviewed")
    if p["time"]["representation"] not in {"iso8601-offset", "unix-seconds"}:
        raise InputError("Choose an explicit supported timestamp representation")
    if p["time"]["calendar"] not in {"standard", "gregorian", "proleptic_gregorian", "other"}:
        raise InputError("Choose the documented source calendar")
    p["stations"] = [_station(s) for s in _list(value.get("stations"), "stations", MAX_STATIONS)]
    p["variables"] = []
    for v in _list(value.get("variables"), "variables", source.MAX_COLUMNS):
        _object(v, {"source", "name", "role", "standardName", "description", "qcFor",
            "qcConvention", "flagDefinitions", "reviewed"}, "variable")
        item = {k: _text(v.get(k, ""), "variable." + k, 32768 if k in
            {"description", "flagDefinitions"} else 256) for k in
            ["source", "name", "role", "standardName", "description", "qcConvention", "flagDefinitions"]}
        item["qcFor"] = [_text(n, "qcFor", 256) for n in _list(v.get("qcFor", []), "qcFor", source.MAX_COLUMNS)]
        item["reviewed"] = _flag(v.get("reviewed", False), "variable.reviewed")
        if item["role"] not in ROLES or item["qcConvention"] not in {"provider", "QARTOD"}:
            raise InputError("Choose supported variable roles and a declared quality-flag convention")
        p["variables"].append(item)
    quality = _object(value.get("quality"), {"processing", "requested", "checks", "notes", "reviewed"}, "quality")
    p["quality"] = {k: _text(quality.get(k, ""), "quality." + k, 65536)
        for k in ["processing", "requested", "checks", "notes"]}
    p["quality"]["reviewed"] = _flag(quality.get("reviewed", False), "quality.reviewed")
    if p["quality"]["requested"] not in {"none", "QARTOD", "custom"}:
        raise InputError("Quality request must be none, QARTOD or custom")
    return p

def draft_profile(original):
    c = capture(original)
    g = {k: v.get("value") for k, v in c.meta["globalAttributes"].items()}
    def text_attr(key):
        return g[key] if isinstance(g.get(key), str) else ""
    found = {}
    for name in c.names:
        a = _attrs(c.meta, name)
        role = ("time" if a.get("standard_name") == "time" or a.get("axis") == "T" or name == "time"
            else "station" if a.get("cf_role") == "timeseries_id" or name in {"station", "station_id"}
            else "latitude" if a.get("standard_name") == "latitude"
            else "longitude" if a.get("standard_name") == "longitude"
            else "depth" if a.get("standard_name") == "depth"
            else "quality" if "flag_values" in a or "flag_masks" in a
            else "measurement")
        found[name] = role
    p = {"schema": PROFILE, "sourceId": c.id, "dataEdition": "require-equivalent", "title": c.meta.get("title") or c.manifest["datasetId"],
        "organization": text_attr("institution"),
        "contacts": {
            "technical": {"name": text_attr("creator_name"), "email": text_attr("creator_email"),
                "organization": text_attr("institution"), "notes": ""},
            "scientific": {"name": "", "email": "", "organization": text_attr("institution"), "notes": ""}},
        "license": {"text": c.meta.get("license") or "", "attribution": text_attr("acknowledgement"), "reviewed": False},
        "access": {"sourceUrl": c.manifest["server"] + c.manifest["protocol"] + "/" + c.manifest["datasetId"],
            "refresh": "", "preprocessing": SOURCE_POLICY, "documentation": text_attr("infoUrl")},
        "time": {"column": next((n for n in c.names if found[n] == "time"), ""),
            "representation": "iso8601-offset", "originalTimezone": "", "calendar": "standard",
            "daylightSaving": "", "notes": "", "reviewed": False},
        "stationColumn": next((n for n in c.names if found[n] == "station"), ""),
        "stations": [], "variables": [], "quality": {"processing": SOURCE_POLICY,
            "requested": "none", "checks": "", "notes": "", "reviewed": False},
        "reviewedBy": "", "notes": ""}
    used = set()
    for n in c.names:
        a = _attrs(c.meta, n)
        alias = re.sub(r"[^A-Za-z0-9_]", "_", n)[:115]
        if not alias or not re.match(r"[A-Za-z_]", alias):
            alias = "field_" + alias
        if n == p["time"]["column"]:
            alias = "time"
        candidate, serial = alias, 2
        while candidate in used:
            candidate = alias + "_" + str(serial); serial += 1
        used.add(candidate)
        definitions = {k: v for k, v in a.items() if k in {"flag_values", "flag_masks", "flag_meanings"}}
        p["variables"].append({"source": n, "name": candidate, "role": found[n],
            "standardName": a.get("standard_name") if isinstance(a.get("standard_name"), str) else "",
            "description": a.get("long_name") if isinstance(a.get("long_name"), str) else "",
            "qcFor": [], "qcConvention": "provider", "flagDefinitions": json.dumps(definitions, ensure_ascii=False) if definitions else "",
            "reviewed": False})
    time_col = p["time"]["column"]
    if time_col:
        a = _attrs(c.meta, time_col)
        column = c.columns[c.slots[time_col]]
        if column["units"] == "UTC":
            p["time"]["originalTimezone"] = "Retained ERDDAP response declares UTC; upstream station time context requires review."
        if a.get("calendar") in {"standard", "gregorian", "proleptic_gregorian"}:
            p["time"]["calendar"] = a["calendar"]
        elif a.get("calendar"):
            p["time"]["calendar"] = "other"
            p["time"]["notes"] = "Provider calendar: " + str(a["calendar"])
    station_col = p["stationColumn"]
    observed = {}
    for row in c.table["rows"]:
        key = _scalar(row[c.slots[station_col]]) if station_col else ""
        if key not in observed and len(observed) >= MAX_STATIONS:
            raise InputError("This provider handoff supports up to 10,000 station definitions")
        observed.setdefault(key, []).append(row)
    for key, rows in observed.items():
        s = {k: "" for k in ["sourceValue", "id", "name", "latitude", "longitude", "depth", "depthUnits",
            "depthPositive", "platformType", "expectedStart", "expectedEnd", "institutions", "attribution",
            "links", "previousDeployments", "notes"]}
        s.update(sourceValue=key, id=key, institutions=text_attr("institution"), positionKind="fixed", reviewed=False)
        for role in ["latitude", "longitude", "depth"]:
            names = [n for n in c.names if found[n] == role]
            if len(names) == 1:
                n = names[0]
                values = list(dict.fromkeys(_scalar(r[c.slots[n]]) for r in rows if r[c.slots[n]] is not None))
                units = c.table["columnUnits"][c.slots[n]]
                allowed = {"degrees_north", "degree_north", "degrees_N", "degree_N"} if role == "latitude" else {"degrees_east", "degree_east", "degrees_E", "degree_E"}
                if len(values) == 1 and (role == "depth" or units in allowed):
                    s[role] = values[0]
                    if role == "depth":
                        s["depthUnits"] = units or ""
                        s["depthPositive"] = _attrs(c.meta, n).get("positive", "") if _attrs(c.meta, n).get("positive", "") in {"up", "down"} else ""
                elif len(values) > 1:
                    s["notes"] += "Observed " + role + " varies; review station position or deployment context. "
        p["stations"].append(s)
    return normalize_profile(p, c)

def analyze(original, profile):
    c = capture(original)
    p = normalize_profile(profile, c)
    issues, aggregates = [], {}
    def issue(code, field, message, count=1, example=None, severity="error"):
        key = (code, field)
        if key not in aggregates:
            entry = {"code": code, "field": field, "message": message, "severity": severity, "count": 0, "examples": []}
            aggregates[key] = entry; issues.append(entry)
        entry = aggregates[key]; entry["count"] += count
        if example is not None and len(entry["examples"]) < 8:
            entry["examples"].append(example)
    if c.manifest["protocol"] != "tabledap":
        issue("station_protocol", "source", "Station intake requires a tabledap capture. The review bundle retains this complete original capture.")
    if not c.table["rows"]:
        issue("empty_selection", "source", "This explicit selection contains no observations.")
    for field in ["title", "organization", "reviewedBy"]:
        if not p[field].strip(): issue("required", field, "Complete " + field + ".")
    for role, item in p["contacts"].items():
        if not item["name"].strip() or not re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", item["email"]):
            issue("contact", "contacts." + role, "Supply the named " + role + " contact and a usable email address.")
    if not p["license"]["text"].strip():
        issue("license", "license.text", "Document the data license or access terms.")
    for section in ["license", "time", "quality"]:
        if not p[section]["reviewed"]:
            issue("review", section + ".reviewed", "Review the " + section + " disclosure.")
    for field in ["refresh", "preprocessing", "documentation"]:
        if not p["access"][field].strip():
            issue("access_context", "access." + field, "Document " + field + "; state explicitly when the provider has not supplied it.")
    for field in ["originalTimezone", "daylightSaving"]:
        if not p["time"][field].strip():
            issue("time_context", "time." + field, "Document " + field + "; preserve any unknown upstream context explicitly.")
    if p["time"]["calendar"] == "other":
        issue("calendar", "time.calendar", "The intake CSV requires a Gregorian UTC time mapping; retain the original calendar and review it.")
    for field in ["processing", "checks"]:
        if not p["quality"][field].strip():
            issue("quality_context", "quality." + field, "Document the provider's " + field + "; an unknown check is a documented unknown.")
    mapped = [v["source"] for v in p["variables"]]
    columns_ok = len(mapped) == len(c.names) and set(mapped) == set(c.names) and len(set(mapped)) == len(mapped)
    if not columns_ok:
        issue("columns", "variables", "Map every exact source column once; original columns cannot be silently omitted.")
    aliases = [v["name"] for v in p["variables"]]
    aliases_ok = len(set(aliases)) == len(aliases) and all(ALIAS.fullmatch(n) for n in aliases)
    if not aliases_ok:
        issue("aliases", "variables", "Choose distinct output names using letters, digits and underscores.")
    by = {v["source"]: v for v in p["variables"]}
    roles = {role: [v for v in p["variables"] if v["role"] == role] for role in ROLES}
    time_col = p["time"]["column"]
    time_ok = time_col in c.slots and len(roles["time"]) == 1 and roles["time"][0]["source"] == time_col
    if not time_ok:
        issue("time_column", "time.column", "Choose one retained time column and give it the time role.")
    elif p["time"]["representation"] == "unix-seconds" and c.table["columnUnits"][c.slots[time_col]] not in {
        "seconds since 1970-01-01T00:00:00Z", "seconds since 1970-01-01T00:00:00",
        "seconds since 1970-01-01 00:00:00", "seconds since 1970-01-01 00:00:00 UTC",
        "seconds since 1970-01-01", "s since 1970-01-01T00:00:00Z"}:
        issue("time_units", "time.representation", "Numeric Unix conversion requires documented seconds since the Unix epoch; other time units need an explicit scientific mapping.")
        time_ok = False
    if time_ok and by[time_col]["name"] != "time":
        issue("time_name", "variables", "The intake timestamp column must be named time.")
        aliases_ok = False
    for role in ["latitude", "longitude", "depth"]:
        if len(roles[role]) > 1:
            issue("coordinate_roles", "variables", "Choose at most one " + role + " column.")
    station_col = p["stationColumn"]
    station_ok = not station_col or station_col in c.slots
    if not station_ok:
        issue("station_column", "stationColumn", "Choose a retained station column or explicitly define one fixed station.")
    if station_col and (len(roles["station"]) != 1 or roles["station"][0]["source"] != station_col):
        issue("station_role", "stationColumn", "The selected station column must have the station role.")
    if not station_col and roles["station"]:
        issue("station_role", "stationColumn", "Select the column assigned the station role.")
    for i, v in enumerate(p["variables"]):
        if not v["reviewed"]: issue("review", "variables." + str(i) + ".reviewed", "Review the meaning and mapping of " + v["source"] + ".")
        if not v["description"].strip(): issue("variable_description", "variables." + str(i), "Describe " + v["source"] + ".")
        if len(set(v["qcFor"])) != len(v["qcFor"]) or any(n not in c.slots or n == v["source"] for n in v["qcFor"]):
            issue("quality_mapping", "variables." + str(i), "Quality associations must identify distinct retained observation columns.")
        if v["role"] == "quality":
            if not v["flagDefinitions"].strip() or not v["qcFor"]:
                issue("quality_mapping", "variables." + str(i), "Document the retained flag definitions and associated observations.")
            if v["qcConvention"] == "QARTOD" and (len(v["qcFor"]) != 1 or
                not v["name"].endswith("_qc") or v["name"] != by.get(v["qcFor"][0], {}).get("name", "") + "_qc"):
                issue("qartod_name", "variables." + str(i), "A QARTOD intake flag must map to one observation and use its output name followed by _qc.")
        elif v["qcFor"] or v["qcConvention"] == "QARTOD":
            issue("quality_role", "variables." + str(i), "Only a retained quality column can declare a quality-flag mapping.")
    station_map, station_bounds = {}, {}
    ids = set()
    for i, s in enumerate(p["stations"]):
        key = s["sourceValue"]
        if key in station_map or s["id"] in ids:
            issue("station_duplicate", "stations." + str(i), "Each source station and output station ID must be unique.")
        station_map[key] = s; ids.add(s["id"])
        if not s["reviewed"]: issue("review", "stations." + str(i) + ".reviewed", "Review the station definition.")
        if station_col and s["id"] != key:
            issue("station_identity", "stations." + str(i) + ".id", "Retain the exact source station identifier in id; use name for its human-readable label.")
        for field in ["id", "name", "platformType", "institutions", "expectedStart", "expectedEnd"]:
            if not s[field].strip(): issue("station_context", "stations." + str(i) + "." + field, "Complete station " + field + ".")
        for field, low, high in [("latitude", -90, 90), ("longitude", -180, 180)]:
            try:
                if not Decimal(low) <= _decimal(s[field]) <= Decimal(high): raise ValueError()
            except (ValueError, InvalidOperation):
                issue("station_coordinate", "stations." + str(i) + "." + field, "Use a documented station coordinate in decimal degrees.")
        if s["depth"]:
            try: _decimal(s["depth"])
            except (ValueError, InvalidOperation): issue("station_depth", "stations." + str(i), "Station depth must retain its documented decimal value.")
            if not s["depthUnits"] or not s["depthPositive"]:
                issue("station_depth", "stations." + str(i), "Document station depth units and positive direction.")
        bounds = {}
        for field in ["expectedStart", "expectedEnd"]:
            if s[field] and not (field == "expectedEnd" and s[field] == "ongoing"):
                try: bounds[field] = _time_key(utc_time(s[field], "iso8601-offset"))
                except (ValueError, OverflowError, InvalidOperation):
                    issue("station_range", "stations." + str(i) + "." + field, "Use a timestamp with a UTC offset for the expected range.")
        station_bounds[key] = bounds
        if "expectedStart" in bounds and "expectedEnd" in bounds and bounds["expectedStart"] > bounds["expectedEnd"]:
            issue("station_range_order", "stations." + str(i), "The expected station start is after its expected end.")
        if s["positionKind"] != "fixed" and not s["notes"].strip():
            issue("station_position", "stations." + str(i), "Explain the mobile or representative station position.")
    if not station_col and (len(p["stations"]) != 1 or "" not in station_map):
        issue("fixed_station", "stations", "A capture without a station column needs one explicitly reviewed station with empty sourceValue.")
    observed, normalized_times, earliest, latest = {}, [], None, None
    qvars = [v for v in p["variables"] if v["role"] == "quality" and v["source"] in c.slots]
    for ordinal, row in enumerate(c.table["rows"], 1):
        key = _scalar(row[c.slots[station_col]]) if station_col and station_ok else ""
        observed[key] = observed.get(key, 0) + 1
        if station_col and station_ok and (row[c.slots[station_col]] is None or key == ""):
            issue("station_missing", "stationColumn", "An observation has no station identifier.", example={"row": ordinal})
        s = station_map.get(key)
        if not s:
            issue("station_unmapped", "stations", "An observed station has no definition.", example={"row": ordinal, "sourceValue": key})
        if time_ok:
            try:
                stamp = utc_time(row[c.slots[time_col]], p["time"]["representation"])
                normalized_times.append(stamp)
                if p["time"]["calendar"] in {"standard", "gregorian"} and stamp[:10] < "1582-10-15":
                    issue("historical_calendar", "time.calendar", "Historical mixed Gregorian/Julian timestamps need a scientific calendar mapping; use proleptic_gregorian only when the source declares it.", example={"row": ordinal})
                # Lexicographic comparison is performed with a decimal fractional
                # second key so integral and fractional timestamps order correctly.
                key_time = _time_key(stamp)
                bounds = station_bounds.get(key, {})
                if s and (("expectedStart" in bounds and key_time < bounds["expectedStart"]) or
                          ("expectedEnd" in bounds and key_time > bounds["expectedEnd"])):
                    issue("station_observation_range", "stations." + s["id"], "An observation falls outside the declared station coverage; review the deployment range.", example={"row": ordinal, "time": stamp})
                if earliest is None or key_time < earliest[0]: earliest = (key_time, stamp)
                if latest is None or key_time > latest[0]: latest = (key_time, stamp)
            except (ValueError, OverflowError, InvalidOperation) as e:
                normalized_times.append(None)
                issue("timestamp", "time.column", str(e), example={"row": ordinal, "value": row[c.slots[time_col]]})
        else:
            normalized_times.append(None)
        if s and s["positionKind"] == "fixed":
            for role in ["latitude", "longitude"]:
                if len(roles[role]) != 1: continue
                v = roles[role][0]
                if v["source"] not in c.slots: continue
                slot = c.slots[v["source"]]
                allowed = {"degrees_north", "degree_north", "degrees_N", "degree_N"} if role == "latitude" else {"degrees_east", "degree_east", "degrees_E", "degree_E"}
                if c.table["columnUnits"][slot] not in allowed:
                    issue("coordinate_units", "variables." + v["source"], "Coordinate units require an explicit scientific mapping before comparison.", example={"units": c.table["columnUnits"][slot]})
                    continue
                try:
                    if row[slot] is not None and _decimal(str(row[slot])) != _decimal(s[role]):
                        issue("station_position_mismatch", "stations." + s["id"], "The fixed station coordinate differs from an observation; review deployment or mobile position.", example={"row": ordinal, "coordinate": role, "value": row[slot]})
                except (ValueError, InvalidOperation):
                    pass
        for v in qvars:
            value = row[c.slots[v["source"]]]
            if value is not None and v["qcConvention"] == "QARTOD":
                try:
                    valid = (_decimal(str(value)) in {Decimal(n) for n in [1,2,3,4,9]}) if isinstance(value, source.Number) else (isinstance(value, str) and value in {"1","2","3","4","9"})
                    if not valid: raise ValueError()
                except (ValueError, InvalidOperation):
                    issue("qartod_value", "variables." + v["source"], "Declared QARTOD values must retain the 1, 2, 3, 4 or 9 flag codes.", example={"row": ordinal, "value": value})
    for key in station_map:
        if key not in observed:
            issue("unused_station", "stations", "This definition has no observations in the retained selection.", example=key, severity="warning")
    if c.comparison["status"] != "equivalent":
        issue("response_editions", "dataEdition", "Provider JSON and CSV differ. Review both retained originals and explicitly choose the canonical JSON edition before ready export.", severity="warning" if p["dataEdition"] == "canonical-json" else "error")
    report = {"schema": REPORT, "version": VERSION, "sourceId": c.id,
        "ready": not any(x["severity"] == "error" for x in issues), "issues": issues,
        "issueCount": len(issues), "errorCount": sum(x["severity"] == "error" for x in issues),
        "warningCount": sum(x["severity"] == "warning" for x in issues),
        "rowCount": len(c.table["rows"]), "stationCount": len(observed),
        "observedStations": [{"sourceValue": k, "rows": v} for k,v in observed.items()],
        "timeRange": {"start": earliest[1] if earliest else None, "end": latest[1] if latest else None},
        "missingByColumn": {x["name"]: x["missing"] for x in c.columns},
        "emptyStringsByColumn": {x["name"]: x["emptyStrings"] for x in c.columns},
        "csvComparison": c.comparison, "valuePolicy": SOURCE_POLICY,
        "transformations": ["Retained source columns are reordered and explicitly aliased.",
            "The selected timestamp is rendered as ISO 8601 UTC using the reviewed representation.",
            "Numeric tokens are copied without binary floating-point conversion.",
            "Missing and empty-string cells are distinguished by one-based row ordinals in data/missing-values.json.",
            "Original station values and quality flags remain in the observation data."]}
    if c.evaluation is not None:
        report["evaluation"] = evaluation(c.evaluation)
    writable = columns_ok and aliases_ok and time_ok and all(t is not None for t in normalized_times) and c.manifest["protocol"] == "tabledap"
    return p, report, {"times": normalized_times, "writable": writable}

def review(original, profile):
    p, report, unused = analyze(original, profile)
    return {"profile": p, "review": report}

def revision_id(profile, parent=None, evaluated=None):
    if parent is not None and (not isinstance(parent, str) or not source.HEX.fullmatch(parent)):
        raise InputError("Expected a full preceding review identity")
    if not isinstance(profile, dict) or not isinstance(profile.get("sourceId"), str) or not source.HEX.fullmatch(profile["sourceId"]):
        raise InputError("Provider profile is missing its original source identity")
    material = {"schema": REVIEW, "sourceId": profile["sourceId"], "parent": parent, "profile": profile}
    if evaluated is not None:
        material["evaluation"] = evaluation(evaluated)
    return source.sha(source.jbytes(material))

def _record(c, profile, report, parent):
    value = {"schema": REVIEW, "id": revision_id(profile, parent, c.evaluation),
        "sourceId": c.id, "parent": parent, "profile": profile, "review": report}
    if c.evaluation is not None:
        value["evaluation"] = evaluation(c.evaluation)
    return value

def record_revision_id(record):
    required = {"schema", "id", "sourceId", "parent", "profile", "review"}
    if not isinstance(record, dict) or not required <= set(record) or set(record) - (required | {"evaluation"}):
        raise InputError("Provider review record has missing or unknown fields")
    if record["schema"] != REVIEW or not isinstance(record["review"], dict) or record["review"].get("schema") != REPORT or record["review"].get("version") != VERSION:
        raise InputError("Unsupported original provider review record")
    if not isinstance(record["profile"], dict) or record["profile"].get("sourceId") != record["sourceId"]:
        raise InputError("Provider review profile belongs to another original source")
    declared = evaluation(record["evaluation"]) if "evaluation" in record else None
    return revision_id(record["profile"], record["parent"], declared)

def validate_record(original, record):
    """Reproduce the entire saved review under its supported original evaluator."""
    c = capture(original)
    if record_revision_id(record) != record["id"] or record["sourceId"] != c.id:
        raise InputError("Provider review identity differs from its original source and profile")
    if "evaluation" in record:
        candidates = [(record["evaluation"], None)]
    else:
        # The parser advanced during the original unversioned 1.0.0 interval.
        # Try only its two known evaluators and compare every canonical byte.
        # Incoming report flags do not select or define evaluator behavior.
        candidates = [(None, version) for version in ["lexical-v1", "decimal-v1"]]
    encoded = source.jbytes(record)
    for declared, legacy in candidates:
        selected = _evaluation_capture(c, declared, legacy)
        profile, report, unused = analyze(selected, record["profile"])
        expected = _record(selected, profile, report, record["parent"])
        if encoded == source.jbytes(expected):
            return selected, expected
    raise InputError("Provider review differs from every supported original evaluation")

def make_review_record(original, profile, parent=None):
    c = capture(original)
    p, report, unused = analyze(c, profile)
    return _record(c, p, report, parent)

def _readme(c, p, report, mode, has_csv):
    lines = ["# " + p["title"].replace("\n", " "), "",
        "## Provider handoff", "",
        "Organization: " + p["organization"],
        "Review author: " + p["reviewedBy"],
        "Bundle edition: " + mode,
        "Original dataset: " + c.manifest["datasetId"],
        "Original provider: " + c.manifest["server"],
        "Observations in the complete selected response: " + str(report["rowCount"]),
        "Observed station identifiers: " + str(report["stationCount"]), "",
        "## Files", "",
        "- original/capture.erddap.zip contains the exact original six-member capture.",
        "- provider-review.json records the explicit profile, its revision and readiness findings.",
        "- station-list.csv records the reviewed station and deployment context.",
        "- variable-mapping.csv connects every output field to its source name, type, units and metadata.",
        "- time-context.json documents time interpretation and the observed UTC range.",
        "- quality-control.json documents retained flags, upstream checks and requested future work.",
        "- manifest.json identifies every delivered file.", ""]
    if has_csv:
        lines += ["data/observations.csv has names in its first row and units in its second row. "
            "Its first column is time, rendered in UTC. Observation row 1 begins on CSV record 3 "
            "(quoted values may contain embedded newlines). data/missing-values.json distinguishes "
            "source null from an empty string using one-based observation row ordinals.", ""]
    else:
        lines += ["The review findings identify the remaining mapping or timestamp decisions needed "
            "to create an intake CSV. The complete original source remains available in this bundle.", ""]
    lines += ["## Source and processing", "", SOURCE_POLICY, "",
        p["access"]["preprocessing"], "", "Refresh context: " + p["access"]["refresh"],
        "Documentation: " + p["access"]["documentation"], "", "## License and attribution", "",
        p["license"]["text"], "", p["license"]["attribution"], "", "## Contacts", ""]
    for role, contact in p["contacts"].items():
        lines += [role.capitalize() + ": " + contact["name"] + " <" + contact["email"] + ">, " + contact["organization"],
            contact["notes"], ""]
    lines += ["## Review findings", ""]
    if not report["issues"]: lines += ["The reviewed intake fields are complete.", ""]
    for item in report["issues"]:
        lines += ["- " + item["severity"].upper() + " " + item["field"] + ": " + item["message"]]
    lines += ["", "## Intake reference", "", "The station handoff format follows the published sensor intake guidance: " + INTAKE_GUIDE,
        "", "Final provider acceptance and any requested scientific quality evaluation are part of the receiving organization's workflow.",
        "", p["notes"], ""]
    return "\n".join(lines).encode("utf-8")

def bundle_files(original, profile, mode="review", parent=None, *, record=None):
    c = capture(original)
    if mode not in {"review", "ready"}: raise InputError("Choose review or ready export")
    if record is not None:
        c, saved = validate_record(c, record)
        if parent != saved["parent"] or source.jbytes(profile) != source.jbytes(saved["profile"]):
            raise InputError("Export request differs from the original reviewed profile")
    p, report, context = analyze(c, profile)
    if mode == "ready" and not report["ready"]:
        raise InputError("Complete the reported intake fields before creating a ready bundle")
    record = _record(c, p, report, parent)
    revision = record["id"]
    columns = {x["name"]: x for x in c.columns}
    fields = ["sourceValue", "id", "name", "latitude", "longitude", "depth", "depthUnits", "depthPositive",
        "platformType", "positionKind", "expectedStart", "expectedEnd", "institutions", "attribution", "links",
        "previousDeployments", "notes", "reviewed"]
    files = {"original/capture.erddap.zip": c.raw,
        "provider-review.json": source.jbytes(record),
        "station-list.csv": _csv([fields] + [[s[k] for k in fields] for s in p["stations"]])}
    mapping_header = ["output_name", "source_name", "role", "source_type", "source_units", "output_units",
        "standard_name", "description", "qc_for", "qc_convention", "flag_definitions", "reviewed"]
    mapping = [mapping_header]
    flags = []
    for v in p["variables"]:
        col = columns.get(v["source"], {"type": "", "units": ""})
        mapping.append([v["name"], v["source"], v["role"], col["type"], col["units"],
            "UTC" if v["source"] == p["time"]["column"] else col["units"], v["standardName"], v["description"],
            json.dumps(v["qcFor"], ensure_ascii=False), v["qcConvention"], v["flagDefinitions"], v["reviewed"]])
        if v["role"] == "quality":
            flags.append({"source": v["source"], "output": v["name"], "for": v["qcFor"],
                "convention": v["qcConvention"], "definitions": v["flagDefinitions"],
                "originalAttributes": _attrs(c.meta, v["source"])})
    files["variable-mapping.csv"] = _csv(mapping)
    files["quality-control.json"] = source.jbytes({"schema": "stellar-forge.erddap-provider-quality.v1",
        "review": p["quality"], "retainedFlags": flags, "performedByExporter": [], "rowPolicy": "retain-all",
        "sourcePolicy": SOURCE_POLICY})
    files["time-context.json"] = source.jbytes({"schema": "stellar-forge.erddap-provider-time.v1",
        "review": p["time"], "sourceAttributes": _attrs(c.meta, p["time"]["column"]),
        "sourceUnits": columns.get(p["time"]["column"], {}).get("units"),
        "outputUnits": "UTC", "observedRange": report["timeRange"]})
    if context["writable"]:
        ordered = [v for v in p["variables"] if v["source"] == p["time"]["column"]] + [v for v in p["variables"] if v["source"] != p["time"]["column"]]
        out = io.StringIO(newline=""); writer = csv.writer(out, lineterminator="\n")
        writer.writerow([v["name"] for v in ordered])
        writer.writerow(["UTC" if v["source"] == p["time"]["column"] else columns[v["source"]]["units"] for v in ordered])
        missing = {v["name"]: {"source": v["source"], "nullRows": [], "emptyStringRows": []} for v in ordered}
        for ordinal, row in enumerate(c.table["rows"], 1):
            cells = []
            for v in ordered:
                value = row[c.slots[v["source"]]]
                if value is None: missing[v["name"]]["nullRows"].append(ordinal)
                elif value == "" and not isinstance(value, source.Number): missing[v["name"]]["emptyStringRows"].append(ordinal)
                cells.append(context["times"][ordinal - 1] if v["source"] == p["time"]["column"] else _scalar(value))
            writer.writerow(cells)
        files["data/observations.csv"] = out.getvalue().encode("utf-8")
        files["data/missing-values.json"] = source.jbytes({"schema": "stellar-forge.erddap-provider-missing.v1",
            "rowOrdinals": "one-based observation records; header and units rows excluded", "columns": missing})
    files["README.md"] = _readme(c, p, report, mode, context["writable"])
    manifest = {"schema": BUNDLE, "version": VERSION, "mode": mode, "revision": revision,
        "sourceId": c.id, "profileId": source.sha(source.jbytes(p)), "ready": report["ready"],
        "rowCount": report["rowCount"], "hasObservationCsv": context["writable"],
        "source": {"server": c.manifest["server"], "datasetId": c.manifest["datasetId"],
            "protocol": c.manifest["protocol"], "selection": c.manifest["selection"],
            "query": c.manifest["query"], "completeness": c.manifest["completeness"]},
        "files": {name: {"bytes": len(raw), "sha256": source.sha(raw)} for name,raw in sorted(files.items())}}
    if c.evaluation is not None:
        manifest["evaluation"] = evaluation(c.evaluation)
    files["manifest.json"] = source.jbytes(manifest)
    if sum(len(b) for b in files.values()) > MAX_HANDOFF:
        raise InputError("Provider bundle exceeds the supported handoff budget; retain the original source and choose a smaller explicit selection")
    return files, manifest, report

def build_bundle(original, profile, mode="review", parent=None, *, record=None):
    files, manifest, report = bundle_files(original, profile, mode, parent, record=record)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            z.writestr(info, raw)
    raw = out.getvalue()
    if len(raw) > MAX_HANDOFF: raise InputError("Compressed provider bundle exceeds its supported budget")
    return {"raw": raw, "bytes": len(raw), "sha256": source.sha(raw), "manifest": manifest, "review": report}

def receive_bundle(value):
    raw = value if isinstance(value, bytes) else value.read(MAX_HANDOFF + 1)
    if not isinstance(raw, bytes) or len(raw) > MAX_HANDOFF:
        raise InputError("Provider bundle exceeds its supported budget")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            entries = z.infolist()
            if not 8 <= len(entries) <= 16 or len({x.filename for x in entries}) != len(entries):
                raise InputError("Provider bundle has missing or duplicate members")
            if sum(x.file_size for x in entries) > MAX_HANDOFF:
                raise InputError("Expanded provider bundle exceeds its supported budget")
            for item in entries:
                if item.filename.startswith("/") or any(n in {"", ".", ".."} for n in item.filename.split("/")) or "\\" in item.filename or item.is_dir() or item.flag_bits & 1 or stat.S_ISLNK(item.external_attr >> 16) or item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise InputError("Provider bundle contains an unsupported member")
                if item.filename in {"manifest.json", "provider-review.json"} and item.file_size > 4 * MAX_PROFILE:
                    raise InputError("Provider bundle metadata exceeds its supported budget")
            received = {item.filename: z.read(item) for item in entries}
    except (zipfile.BadZipFile, OSError, EOFError) as e:
        raise InputError("Expected a complete provider handoff ZIP") from e
    for name in ["manifest.json", "provider-review.json", "original/capture.erddap.zip"]:
        if name not in received: raise InputError("Provider bundle is missing " + name)
    manifest = source.json_value(received["manifest.json"])
    record = source.json_value(received["provider-review.json"])
    if not isinstance(manifest, dict) or manifest.get("schema") != BUNDLE or manifest.get("version") != VERSION:
        raise InputError("Unsupported provider handoff format")
    if not isinstance(record, dict) or record.get("schema") != REVIEW:
        raise InputError("Provider review record is missing")
    c = Capture(received["original/capture.erddap.zip"])
    expected, canonical, report = bundle_files(c, record.get("profile"), manifest.get("mode"), record.get("parent"), record=record)
    if set(received) != set(expected):
        raise InputError("Provider bundle members differ from its complete reviewed export")
    for name, body in expected.items():
        if received[name] != body:
            raise InputError("Provider bundle content differs from its reviewed source: " + name)
    result = {"schema": RECEIVED, "status": "received", "version": VERSION, "bytes": len(raw),
        "sha256": source.sha(raw), "revision": canonical["revision"], "sourceId": c.id,
        "profileId": canonical["profileId"], "mode": canonical["mode"], "ready": report["ready"],
        "rowCount": report["rowCount"], "stationCount": report["stationCount"],
        "fileCount": len(received), "hasObservationCsv": canonical["hasObservationCsv"],
        "source": canonical["source"], "review": report}
    if "evaluation" in canonical:
        result["evaluation"] = evaluation(canonical["evaluation"])
    return result
