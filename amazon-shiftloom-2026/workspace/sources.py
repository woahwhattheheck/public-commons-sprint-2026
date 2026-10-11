"""Original-file intake and coordinator-owned planning fields."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100000


class WorkError(Exception):
    def __init__(self, code, message, status=422, **extra):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def fail(code, message, status=422, **extra):
    raise WorkError(code, message, status, **extra)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def field(key, label, required=True, help=""):
    return dict(key=key, label=label, required=required, help=help)


ROLES = [
    dict(key="volunteers", label="Volunteer roster", fields=[
        field("id", "Volunteer ID"), field("name", "Display name"),
        field("active", "Active in this roster", help="Map the actual source state to true or false."),
        field("weekly_limit", "Maximum assignments in this planning week", help="A coordinator field or explicit constant; zero permits no new booking.")]),
    dict(key="shifts", label="Shifts and reserved places", fields=[
        field("id", "Shift / occurrence ID"), field("label", "Shift label"),
        field("start", "Start"), field("end", "End"), field("capacity", "Total places"),
        field("reserved", "Additional reserved places", help="Occupied places beyond the named responses. Set zero explicitly when all places have named assignments."),
        field("required", "Required qualification IDs", help="Separate IDs with |. An explicit blank means none."),
        field("target", "Can plan this shift", False), field("need_id", "Opportunity ID", False)]),
    dict(key="assignments", label="Original responses and assignments", fields=[
        field("id", "Response / assignment ID"), field("shift_id", "Shift ID"),
        field("volunteer_id", "Volunteer ID"), field("status", "Response status", help="Map exact source states to confirmed or excluded."),
        field("team_id", "Team ID", False)]),
    dict(key="availability", label="Coordinator availability and eligibility", fields=[
        field("volunteer_id", "Volunteer ID"), field("shift_id", "Shift ID"),
        field("available", "Affirmative availability"), field("eligible", "Coordinator eligibility"),
        field("preferred", "Volunteer preference", False),
        field("eligibility_note", "Eligibility source or explanation", False),
        field("observed_at", "Observed at", False)]),
    dict(key="qualifications", label="Individual qualifications", fields=[
        field("volunteer_id", "Volunteer ID"), field("qualification_id", "Qualification ID"),
        field("status", "Qualification status"),
        field("expires", "Original expiration date", False),
        field("valid_from", "Valid from", False), field("label", "Qualification title", False)])
]
ROLE_BY_KEY = {r["key"]: r for r in ROLES}


def scalar(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json_text(value)
    return str(value)


def clean_text(value, label, maximum=1000, required=True):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in "\n\t\r" for c in value):
        fail("INVALID_TEXT", f"{label} must be ordinary text of at most {maximum} characters.")
    value = value.strip()
    if required and not value:
        fail("REQUIRED_INPUT", f"Enter {label}.")
    return value


def raw_upload(body):
    if body.get("content_b64") is not None:
        try:
            raw = base64.b64decode(body["content_b64"], validate=True)
        except (ValueError, TypeError):
            fail("INVALID_UPLOAD", "The file bytes are not valid base64.")
    elif isinstance(body.get("text"), str):
        raw = body["text"].encode("utf-8")
    else:
        fail("REQUIRED_UPLOAD", "Choose an original file or paste its content.")
    if len(raw) > MAX_SOURCE_BYTES:
        fail("SOURCE_SIZE", "Each source file may be at most 20 MiB.", 413)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        fail("SOURCE_ENCODING", "Export the source as UTF-8 CSV or JSON.")
    return raw, text


def flatten(value, prefix="", out=None):
    out = {} if out is None else out
    if isinstance(value, dict):
        for key, item in value.items():
            key = str(key)
            joined = prefix + "." + key if prefix else key
            if isinstance(item, dict):
                flatten(item, joined, out)
            else:
                if joined in out:
                    fail("DUPLICATE_HEADER", "The JSON object has ambiguous flattened fields.")
                out[joined] = item
    else:
        fail("SOURCE_ROWS", "Every JSON source row must be an object.")
    return out


def parse_source(raw, fmt, root_path=""):
    text = raw.decode("utf-8-sig")
    if fmt == "csv":
        try:
            dialect = csv.Sniffer().sniff(text[:16384], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        parsed = list(csv.reader(io.StringIO(text, newline=""), dialect))
        if not parsed:
            fail("SOURCE_HEADERS", "The CSV needs a header row.")
        headers = [h.strip() for h in parsed[0]]
        if not headers or any(not h for h in headers) or len(set(headers)) != len(headers):
            fail("SOURCE_HEADERS", "Use distinct, nonempty source headers.")
        rows = []
        for index, cells in enumerate(parsed[1:], 2):
            if not cells or all(c == "" for c in cells):
                continue
            if len(cells) != len(headers):
                fail("SOURCE_COLUMNS", f"CSV row {index} has {len(cells)} values for {len(headers)} headers.")
            rows.append(dict(zip(headers, cells)))
    elif fmt == "json":
        try:
            value = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            fail("SOURCE_JSON", "The source JSON is not complete.")
        if root_path:
            for part in root_path.split("."):
                if isinstance(value, dict) and part in value:
                    value = value[part]
                else:
                    fail("SOURCE_ROOT", f"The JSON source has no array at {root_path}.")
        elif isinstance(value, dict) and isinstance(value.get("data"), list):
            value = value["data"]
        if not isinstance(value, list):
            fail("SOURCE_ROWS", "Choose the JSON array of original records.")
        rows = [flatten(r) for r in value]
        headers = list(dict.fromkeys(k for row in rows for k in row))
    else:
        fail("SOURCE_FORMAT", "Choose CSV or JSON.")
    if len(rows) > MAX_ROWS:
        fail("SOURCE_ROWS", f"A source may contain at most {MAX_ROWS:,} rows.")
    if len(headers) > 250:
        fail("SOURCE_HEADERS", "A source may contain at most 250 selected columns.")
    return headers, rows


def validate_mapping(dataset, body):
    role = ROLE_BY_KEY[dataset["role"]]
    fields = {f["key"] for f in role["fields"]}
    mapping = body.get("mapping", {})
    constants = body.get("constants", {})
    maps = body.get("value_maps", {})
    if not all(isinstance(v, dict) for v in (mapping, constants, maps)):
        fail("MAPPING", "Mapping, constants and value maps must be objects.")
    if (set(mapping) | set(constants) | set(maps)) - fields:
        fail("MAPPING", "The mapping contains an unknown planning field.")
    mapping = {key: value for key, value in mapping.items() if value not in ("", None)}
    for key, value in mapping.items():
        if not isinstance(value, str) or value not in dataset["headers"]:
            fail("MAPPING", f"Choose an original header for {key}.")
    if set(mapping) & set(constants):
        fail("MAPPING", "A field uses either its original header or an explicit constant.")
    for key, value in constants.items():
        if isinstance(value, (dict, list)) or len(scalar(value)) > 4000:
            fail("MAPPING", f"Enter a scalar coordinator value for {key}.")
    for key, values in maps.items():
        if not isinstance(values, dict) or len(values) > 100:
            fail("VALUE_MAP", f"Use a source-to-planning value map for {key}.")
        for source, target in values.items():
            if not isinstance(source, str) or isinstance(target, (dict, list)):
                fail("VALUE_MAP", "Value-map entries must be scalar source and target values.")
    fmt = clean_text(body.get("datetime_format", ""), "datetime format", 120, False)
    return dict(mapping=mapping, constants=constants, value_maps=maps, datetime_format=fmt)


def mapped_rows(dataset):
    fields = ROLE_BY_KEY[dataset["role"]]["fields"]
    rows, errors = [], []
    config = dataset.get("config", {})
    mapping, constants, maps = (config.get(k, {}) for k in ("mapping", "constants", "value_maps"))
    overrides = config.get("overrides", {})
    for index, raw in enumerate(dataset["rows"], 1):
        override = overrides.get(str(index), {})
        values = {}
        for f in fields:
            key = f["key"]
            supplied = key in mapping or key in constants or key in override
            if key in override:
                value = override[key]
            elif key in constants:
                value = constants[key]
            else:
                value = raw.get(mapping.get(key, ""), "")
            if key in maps and key not in override:
                value = maps[key].get(scalar(value), value)
            values[key] = value
            if f["required"] and not supplied:
                errors.append(dict(code="MISSING_MAPPING", severity="error", dataset_id=dataset["id"], role=dataset["role"],
                                   row_index=index, field=key, message=f"Map {f['label']} or supply its coordinator value."))
        ref = dict(dataset_id=dataset["id"], role=dataset["role"], row_index=index, sha256=dataset["sha256"])
        rows.append(dict(row_index=index, original=raw, canonical=values, overrides=override, source_ref=ref,
                         datetime_format=config.get("datetime_format", "")))
    return rows, errors


def id_value(value, label):
    if isinstance(value, bool) or isinstance(value, float):
        fail("IDENTITY", f"{label} must retain its exact string ID.")
    value = scalar(value).strip()
    if not value or len(value) > 160 or any(ord(c) < 32 for c in value):
        fail("IDENTITY", f"Enter an exact {label}.")
    return value


def boolean(value, label, optional=False):
    if optional and value in ("", None):
        return False
    if value is True or scalar(value).strip().lower() == "true":
        return True
    if value is False or scalar(value).strip().lower() == "false":
        return False
    fail("VALUE_MAP", f"Map {label} to true or false.")


def integer(value, label, maximum=10000):
    value = scalar(value).strip()
    if not re.fullmatch(r"[0-9]+", value) or int(value) > maximum:
        fail("INTEGER", f"{label} must be an integer between 0 and {maximum:,}.")
    return int(value)


def localize(dt, zone, label):
    options = []
    for fold in (0, 1):
        aware = dt.replace(tzinfo=zone, fold=fold)
        back = aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
        if back == dt:
            options.append(aware)
    if not options:
        fail("NONEXISTENT_TIME", f"{label} falls in a local clock change; supply an explicit offset.")
    if len({x.utcoffset() for x in options}) > 1:
        fail("AMBIGUOUS_TIME", f"{label} is ambiguous at a local clock change; supply an explicit offset.")
    return options[0]


def timestamp(value, settings, label, fmt="", optional=False, expiry=False):
    raw = scalar(value).strip()
    if not raw and optional:
        return ""
    try:
        if fmt:
            dt = datetime.strptime(raw, fmt)
            date_only = not any(t in fmt for t in ("%H", "%I", "%M", "%S", "%p"))
        else:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            date_only = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw))
    except (ValueError, TypeError):
        fail("DATETIME", f"{label} needs a full ISO timestamp or its configured source date format.")
    if expiry and date_only and settings["expiry_date_inclusive"]:
        dt += timedelta(days=1)
    if dt.tzinfo is None:
        dt = localize(dt, ZoneInfo(settings["timezone"]), label)
    return dt.isoformat()


def settings_checked(settings):
    value = dict(settings)
    value["organization"] = clean_text(value.get("organization", ""), "site or organization", 200)
    value["label"] = clean_text(value.get("label", ""), "workspace label", 200)
    try:
        ZoneInfo(value["timezone"])
    except (KeyError, ValueError, TypeError):
        fail("TIMEZONE", "Choose the actual site IANA time zone, such as America/Denver.")
    try:
        start = date.fromisoformat(value["week_start"])
    except (KeyError, ValueError, TypeError):
        fail("PLANNING_WEEK", "Choose the first date of the seven-day planning period.")
    value["week_start"] = start.isoformat()
    value["expiry_date_inclusive"] = boolean(value.get("expiry_date_inclusive"), "expiration-date policy")
    value["cohort_complete"] = boolean(value.get("cohort_complete"), "complete selected-roster declaration")
    value["source_observed_at"] = timestamp(value.get("source_observed_at"), value, "source observation time")
    value["notes"] = clean_text(value.get("notes", ""), "source scope notes", 5000, False)
    return value


def build_state(datasets, settings):
    settings = settings_checked(settings)
    issues, normalized = [], {}
    if not settings["cohort_complete"]:
        issues.append(dict(code="COHORT_SCOPE", severity="error", message="Confirm that the selected roster includes its existing planning-week assignments and overlap context."))
    for role in ROLE_BY_KEY:
        dataset = datasets.get(role)
        if not dataset:
            issues.append(dict(code="MISSING_SOURCE", severity="error", role=role, message=f"Select and confirm {ROLE_BY_KEY[role]['label']}."))
            normalized[role] = []
            continue
        rows, errors = mapped_rows(dataset)
        normalized[role] = rows
        issues.extend(errors)
    state = dict(event=settings["label"], date=settings["week_start"], revision=0, volunteers=[], shifts=[], unavailable={})
    volunteers, shifts, assignments, availability = {}, {}, set(), set()
    start = date.fromisoformat(settings["week_start"])
    end = start + timedelta(days=7)

    def problem(row, role, error):
        issues.append(dict(code=error.code, severity="error", role=role, dataset_id=row["source_ref"]["dataset_id"],
                           row_index=row["row_index"], message=error.message))

    for row in normalized["volunteers"]:
        c = row["canonical"]
        try:
            ident = id_value(c["id"], "volunteer ID")
            if ident in volunteers:
                fail("DUPLICATE_ID", f"Volunteer {ident} appears more than once.")
            v = dict(id=ident, name=clean_text(scalar(c["name"]), "display name", 250), active=boolean(c["active"], "volunteer state"),
                     weeklyLimit=integer(c["weekly_limit"], "weekly assignment limit"), skills=[], available=[], preferred=[],
                     qualificationWindows=[], eligibility={}, source_refs=[row["source_ref"]])
            volunteers[ident] = v
            state["volunteers"].append(v)
        except WorkError as exc:
            problem(row, "volunteers", exc)
    for row in normalized["shifts"]:
        c = row["canonical"]
        try:
            ident = id_value(c["id"], "shift ID")
            if ident in shifts:
                fail("DUPLICATE_ID", f"Shift {ident} appears more than once.")
            begin = timestamp(c["start"], settings, "shift start", row["datetime_format"])
            finish = timestamp(c["end"], settings, "shift end", row["datetime_format"])
            if datetime.fromisoformat(begin) >= datetime.fromisoformat(finish):
                fail("SHIFT_INTERVAL", "A shift must end after it starts.")
            local_start = datetime.fromisoformat(begin).astimezone(ZoneInfo(settings["timezone"])).date()
            in_week = start <= local_start < end
            raw_required = c["required"]
            if isinstance(raw_required, list):
                requirements = [id_value(v, "required qualification") for v in raw_required]
            else:
                requirements = [id_value(v.strip(), "required qualification") for v in scalar(raw_required).split("|") if v.strip()]
            target = in_week if c["target"] in ("", None) else boolean(c["target"], "target shift")
            if target and not in_week:
                fail("PLANNING_WEEK", "A target shift must start in the selected seven-day period; retain it as context or select its week.")
            s = dict(id=ident, label=clean_text(scalar(c["label"]), "shift label", 300),
                     start=begin, end=finish, capacity=integer(c["capacity"], "shift capacity"),
                     reservedSlots=integer(c["reserved"], "additional reserved places"),
                     required=list(dict.fromkeys(requirements)), assigned=[], target=target,
                     countsTowardLimit=in_week, needId=scalar(c.get("need_id", "")), source_refs=[row["source_ref"]])
            if s["reservedSlots"] > s["capacity"]:
                fail("RESERVED_CAPACITY", "Additional reserved places exceed total shift capacity.")
            shifts[ident] = s
            state["shifts"].append(s)
        except WorkError as exc:
            problem(row, "shifts", exc)
    excluded_assignments = 0
    for row in normalized["assignments"]:
        c = row["canonical"]
        try:
            ident = id_value(c["id"], "response ID")
            if ident in assignments:
                fail("DUPLICATE_ID", f"Response {ident} appears more than once.")
            assignments.add(ident)
            status = scalar(c["status"]).strip().lower()
            if status not in ("confirmed", "excluded"):
                fail("RESPONSE_STATUS", f"Map the original response state {scalar(c['status'])!r} to confirmed or excluded.")
            if status == "excluded":
                excluded_assignments += 1
                continue
            sid, vid = id_value(c["shift_id"], "response shift"), id_value(c["volunteer_id"], "response volunteer")
            if sid not in shifts or vid not in volunteers:
                fail("UNMATCHED_ASSIGNMENT", f"Response {ident} references a shift or volunteer outside the supplied cohort.")
            if vid in shifts[sid]["assigned"]:
                fail("DUPLICATE_ASSIGNMENT", f"Volunteer {vid} has multiple confirmed responses for shift {sid}.")
            shifts[sid]["assigned"].append(vid)
            shifts[sid]["source_refs"].append(row["source_ref"])
            volunteers[vid]["source_refs"].append(row["source_ref"])
        except WorkError as exc:
            problem(row, "assignments", exc)
    for row in normalized["availability"]:
        c = row["canonical"]
        try:
            sid, vid = id_value(c["shift_id"], "availability shift"), id_value(c["volunteer_id"], "availability volunteer")
            if sid not in shifts or vid not in volunteers:
                fail("UNMATCHED_AVAILABILITY", "Availability references a shift or volunteer outside the supplied cohort.")
            if (vid, sid) in availability:
                fail("DUPLICATE_AVAILABILITY", f"Volunteer {vid} has multiple availability decisions for shift {sid}.")
            availability.add((vid, sid))
            available = boolean(c["available"], "affirmative availability")
            eligible = boolean(c["eligible"], "coordinator eligibility")
            if available:
                volunteers[vid]["available"].append(sid)
            else:
                state["unavailable"].setdefault(vid, []).append(sid)
            volunteers[vid]["eligibility"][sid] = eligible
            if boolean(c["preferred"], "shift preference", True):
                volunteers[vid]["preferred"].append(sid)
            if c["observed_at"] not in ("", None):
                timestamp(c["observed_at"], settings, "availability observation", row["datetime_format"])
            volunteers[vid]["source_refs"].append(row["source_ref"])
        except WorkError as exc:
            problem(row, "availability", exc)
    qualifications = set()
    for row in normalized["qualifications"]:
        c = row["canonical"]
        try:
            vid, qid = id_value(c["volunteer_id"], "qualified volunteer"), id_value(c["qualification_id"], "qualification ID")
            if vid not in volunteers:
                fail("UNMATCHED_QUALIFICATION", "Qualification references a volunteer outside the supplied roster.")
            status = scalar(c["status"]).strip().lower()
            if status not in ("active", "pending", "inactive", "expired", "rejected", "resubmit"):
                fail("QUALIFICATION_STATUS", f"Map or correct the original qualification state {status!r}.")
            expires = timestamp(c["expires"], settings, "qualification expiry", row["datetime_format"], True, True)
            begins = timestamp(c["valid_from"], settings, "qualification valid-from", row["datetime_format"], True)
            if expires and begins and datetime.fromisoformat(expires) < datetime.fromisoformat(begins):
                fail("QUALIFICATION_INTERVAL", "Qualification expiry precedes its valid-from value.")
            signature = (vid, qid, status, begins, expires)
            if signature in qualifications:
                fail("DUPLICATE_QUALIFICATION", f"The same qualification interval for {vid}/{qid} appears more than once.")
            qualifications.add(signature)
            v = volunteers[vid]
            if qid not in v["skills"]:
                v["skills"].append(qid)
            v["qualificationWindows"].append(dict(id=qid, status=status, label=scalar(c["label"]), **{"from": begins, "until": expires},
                                                  originalExpiry=scalar(c["expires"]), source_ref=row["source_ref"]))
            v["source_refs"].append(row["source_ref"])
        except WorkError as exc:
            problem(row, "qualifications", exc)
    if not state["volunteers"]:
        issues.append(dict(code="EMPTY_ROSTER", severity="error", message="The selected roster has no valid volunteers."))
    if not any(s["target"] for s in state["shifts"]):
        issues.append(dict(code="EMPTY_TARGETS", severity="error", message="The selected period has no valid target shifts."))
    return dict(state=state, issues=issues, normalized=normalized, counts=dict(volunteers=len(volunteers), shifts=len(shifts),
                target_shifts=sum(s["target"] for s in state["shifts"]), confirmed_assignments=sum(len(s["assigned"]) for s in state["shifts"]),
                excluded_responses=excluded_assignments, availability=len(availability), qualification_intervals=len(qualifications)))


def coverage(state):
    return [dict(id=s["id"], label=s["label"], start=s["start"], end=s["end"], capacity=s["capacity"],
                 named=len(s["assigned"]), reserved=s.get("reservedSlots", 0),
                 gap=max(0, s["capacity"] - len(s["assigned"]) - s.get("reservedSlots", 0)), target=s.get("target", True))
            for s in state["shifts"]]

