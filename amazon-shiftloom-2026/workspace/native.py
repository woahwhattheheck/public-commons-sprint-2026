"""Project actual Get Connected need, response and per-user qualification records."""
from __future__ import annotations

import json
from sources import WorkError, clean_text, fail, id_value, json_text, now, parse_source

SNAPSHOT_SCHEMA = "getconnected.coverage-snapshot.v1"


def unwrap(value, pointer):
    if isinstance(value, dict) and "data" in value:
        return value["data"], pointer + "/data"
    return value, pointer


def object_rows(value, pointer):
    value, pointer = unwrap(value, pointer)
    if isinstance(value, dict):
        return [(value, pointer)]
    if not isinstance(value, list) or any(not isinstance(x, dict) for x in value):
        fail("NATIVE_ROWS", f"{pointer} must contain original object records.")
    return [(row, f"{pointer}/{index}") for index, row in enumerate(value)]


def ref_id(value, label, optional=False):
    if isinstance(value, dict):
        value = value.get("id")
    if optional and value in ("", None):
        return ""
    return id_value(value, label)


def native_projection(raw):
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        fail("NATIVE_JSON", "Choose a complete original Get Connected capture JSON.")
    if not isinstance(value, dict) or value.get("schema") != SNAPSHOT_SCHEMA:
        fail("NATIVE_SCHEMA", f"Use the {SNAPSHOT_SCHEMA} bundle produced by capture_getconnected.py or described in the source guide.")
    domain = id_value(value.get("domain_id"), "native site/domain ID")
    captured_at = clean_text(value.get("captured_at", ""), "capture timestamp", 100)
    locations = {}
    original_requests = value.get("requests", [])
    if "requests" in value:
        from capture_getconnected import decode_capture_requests
        records, locations = decode_capture_requests(value)
        value = {**value, **records}
    output = {key: [] for key in ("volunteers", "shifts", "assignments", "qualifications")}
    identities = {key: {} for key in output}
    need_ids, shift_needs = set(), {}
    issues = []

    def scope(row, pointer):
        actual = row.get("domain_id")
        if actual not in ("", None) and ref_id(actual, "record domain ID") != domain:
            fail("NATIVE_DOMAIN", f"{pointer} belongs to a different site/domain.")

    def add(role, key, item):
        previous = identities[role].get(key)
        if previous is not None:
            left = {k: v for k, v in previous.items() if k != "source_pointer"}
            right = {k: v for k, v in item.items() if k != "source_pointer"}
            if left != right:
                fail("NATIVE_DUPLICATE", f"Conflicting native {role} record {key}; keep one exact capture cohort.")
            return
        identities[role][key] = item
        output[role].append(item)

    for need, pointer in object_rows(value.get("needs", []), "/needs"):
        scope(need, pointer)
        nid = ref_id(need.get("id"), "native opportunity ID")
        need_ids.add(nid)
        shifts = need.get("shifts", [])
        if shifts is None:
            shifts = []
        if not isinstance(shifts, list):
            fail("NATIVE_SHIFTS", f"{pointer}/shifts must be the original shift array.")
        for index, shift in enumerate(shifts):
            if not isinstance(shift, dict):
                fail("NATIVE_SHIFTS", "Each native shift must be an object.")
            sid = ref_id(shift.get("id"), "native shift ID")
            if sid in shift_needs and shift_needs[sid] != nid:
                fail("NATIVE_SHIFT_SCOPE", f"Native shift {sid} appears under different opportunities.")
            shift_needs[sid] = nid
            add("shifts", sid, dict(id=sid, need_id=nid, need_title=need.get("need_title", ""),
                label=f"{need.get('need_title', nid)} / {sid}", start=shift.get("start", ""),
                end=shift.get("end", ""), slots=shift.get("slots", ""), duration=shift.get("duration", ""),
                need_status=need.get("need_status", ""), domain_id=domain,
                source_pointer=f"{pointer}/shifts/{index}"))

    for user, pointer in object_rows(value.get("users", []), "/users"):
        scope(user, pointer)
        uid = ref_id(user.get("id"), "native volunteer ID")
        name = " ".join(str(user.get(k, "")).strip() for k in ("user_fname", "user_lname")).strip()
        add("volunteers", uid, dict(id=uid, display_name=name, user_fname=user.get("user_fname", ""),
            user_lname=user.get("user_lname", ""), user_status=user.get("user_status", ""),
            domain_id=domain, source_pointer=pointer))

    for response, pointer in object_rows(value.get("responses", []), "/responses"):
        scope(response, pointer)
        rid = ref_id(response.get("id"), "native response ID")
        sid = ref_id(response.get("shift"), "native response shift ID")
        nid = ref_id(response.get("need"), "native response opportunity ID")
        uid = ref_id(response.get("user"), "native response volunteer ID")
        if sid not in shift_needs or shift_needs[sid] != nid:
            fail("NATIVE_RESPONSE_SCOPE", f"Response {rid} does not match an included opportunity/shift pair.")
        if isinstance(response.get("user"), dict):
            scope(response["user"], pointer + "/user")
        if isinstance(response.get("need"), dict):
            scope(response["need"], pointer + "/need")
        add("assignments", rid, dict(id=rid, shift_id=sid, need_id=nid, user_id=uid,
            response_status=response.get("response_status", ""),
            team_id=ref_id(response.get("team"), "native team ID", True),
            response_date_added=response.get("response_date_added", ""),
            response_date_updated=response.get("response_date_updated", ""),
            answers=response.get("answers", []), domain_id=domain, source_pointer=pointer))

    qualification_groups = value.get("qualifications", [])
    if not isinstance(qualification_groups, list):
        fail("NATIVE_QUALIFICATIONS", "Retain each qualification request's user_id with its data array.")
    for index, group in enumerate(qualification_groups):
        if not isinstance(group, dict):
            fail("NATIVE_QUALIFICATIONS", "Every qualification request needs its original user_id and data.")
        uid = ref_id(group.get("user_id"), "qualification request volunteer ID")
        if uid not in identities["volunteers"]:
            fail("NATIVE_QUALIFICATION_SCOPE", f"Qualification request {uid} has no included volunteer record.")
        items = group.get("data", group.get("response", []))
        for qualification, pointer in object_rows(items, f"/qualifications/{index}/data"):
            scope(qualification, pointer)
            qid = ref_id(qualification.get("qualification_id"), "native qualification ID")
            exact_id = ref_id(qualification.get("id"), "native user qualification ID", True)
            key = (uid, exact_id or qid, qualification.get("status"), qualification.get("expires"))
            add("qualifications", key, dict(user_id=uid, id=exact_id, qualification_id=qid,
                qualification_title=qualification.get("qualification_title", ""),
                status=qualification.get("status", ""), expires=qualification.get("expires", ""),
                duration=qualification.get("duration", ""), domain_id=domain, source_pointer=pointer))

    for response in output["assignments"]:
        if response["user_id"] not in identities["volunteers"]:
            issues.append(dict(code="NATIVE_MISSING_USER", severity="warning",
                message=f"Response {response['id']} refers to user {response['user_id']}; include that user before confirming it as assigned.",
                source_pointer=response["source_pointer"]))
    capture = value.get("capture", {})
    if not isinstance(capture, dict):
        fail("NATIVE_CAPTURE", "The optional capture metadata must be an object.")
    if capture.get("complete") is False or value.get("errors"):
        issues.append(dict(code="NATIVE_PARTIAL_CAPTURE", severity="warning",
            message="This capture reports incomplete reads. Review its retained errors and obtain the missing source before declaring the cohort complete."))
    suggestions = {
        "volunteers": dict(mapping={"id": "id", "name": "display_name", "active": "user_status"},
                           constants={}, value_maps={}),
        "shifts": dict(mapping={"id": "id", "label": "label", "start": "start", "end": "end",
                                "capacity": "slots", "need_id": "need_id"}, constants={}, value_maps={}),
        "assignments": dict(mapping={"id": "id", "shift_id": "shift_id", "volunteer_id": "user_id",
                                     "status": "response_status", "team_id": "team_id"}, constants={}, value_maps={}),
        "qualifications": dict(mapping={"volunteer_id": "user_id", "qualification_id": "qualification_id",
                                        "status": "status", "expires": "expires", "label": "qualification_title"},
                              constants={}, value_maps={})
    }
    empty_headers = {
        "volunteers": ["id", "display_name", "user_status", "domain_id", "source_pointer"],
        "shifts": ["id", "need_id", "label", "start", "end", "slots", "domain_id", "source_pointer"],
        "assignments": ["id", "shift_id", "need_id", "user_id", "response_status", "team_id", "domain_id", "source_pointer"],
        "qualifications": ["user_id", "qualification_id", "status", "expires", "qualification_title", "domain_id", "source_pointer"]
    }
    projections = {}
    for role, rows in output.items():
        for row in rows:
            pointer = row["source_pointer"]
            parents = [prefix for prefix in locations if pointer == prefix or pointer.startswith(prefix + "/")]
            if parents:
                prefix = max(parents, key=len)
                location = locations[prefix]
                request = original_requests[location["request_index"]]
                row["source_pointer"] = location["json_pointer"] + pointer[len(prefix):]
                row["source_request_index"] = location["request_index"]
                row["source_request_url"] = request["url"]
                row["source_response_sha256"] = request["sha256"]
        encoded = json_text(rows).encode("utf-8")
        headers, parsed = parse_source(encoded, "json")
        projections[role] = dict(raw=encoded, rows=parsed, headers=headers or empty_headers[role],
            config={**suggestions[role], "datetime_format": "", "overrides": {}, "history": []})
    return dict(projections=projections, metadata=dict(schema=SNAPSHOT_SCHEMA, domain_id=domain,
        captured_at=captured_at, imported_at=now(), selected_need_ids=sorted(need_ids),
        capture=capture, issues=issues, counts={key: len(rows) for key, rows in output.items()}))

