"""MIT. Typed Gravity operating records and exact original source catalogue."""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from referral_runtime import InputError, source, fhir

HERE = Path(__file__).resolve().parent
SCHEMA = "stellar-forge.gravity-referral.v1"
PROFILE_ID = "gravity-referral-3.0.0"
KINDS = {"configurations", "editions", "reviews", "assessments", "decisions",
         "comparisons", "correctionPreviews", "corrections", "exchangeRequests",
         "exchangeOperations", "monitoring", "handoffs", "receivings", "receives"}
MUTABLE = {"exchangeOperations", "receives"}
TASK_STATUSES = ["draft", "requested", "accepted", "rejected", "in-progress",
                 "on-hold", "failed", "completed", "cancelled", "entered-in-error"]
REVIEW_STATES = ["unreviewed", "applicable", "met", "gap", "not-applicable"]
TOPOLOGIES = ["direct", "direct-light", "intermediary", "intermediary-light"]
ROLES = ["source", "intermediary", "target"]
EXCHANGE_TYPES = ["Task", "ServiceRequest", "Consent", "Procedure", "CarePlan",
                  "Condition", "Observation", "QuestionnaireResponse"]
TERMINAL_TASKS = {"completed", "cancelled", "entered-in-error", "failed", "rejected"}

def obj(value, allowed, required=(), label="Record"):
    if not isinstance(value, dict):
        raise InputError(label + " must be an object")
    source.exact(value, set(allowed), label)
    missing = set(required) - set(value)
    if missing:
        raise InputError(label + " requires " + ", ".join(sorted(missing)))
    return deepcopy(value)

def text(value, name, maximum=4000, required=False):
    return source.text(value, name, maximum, not required)

def enum(value, choices, name):
    if value not in choices:
        raise InputError(name + " must be one of " + ", ".join(choices))
    return value

def ids(value, name, maximum=100, nonempty=False):
    if not isinstance(value, list) or len(value) > maximum or (nonempty and not value):
        raise InputError(name + " must retain its selected array within " + str(maximum))
    result = [source.identity(v) for v in value]
    if len(set(result)) != len(result):
        raise InputError(name + " repeats an original identity")
    return result

def timestamp(value, name, nullable=True):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or len(value) > 80:
        raise InputError(name + " needs its original offset-aware timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise InputError(name + " is not an ISO timestamp") from None
    if parsed.tzinfo is None:
        raise InputError(name + " needs its original timezone offset")
    return value

def source_ref(raw):
    value = obj(raw, {"sourceId", "recordId", "pointer", "member", "sourceSha256", "resourceSha256",
                      "url", "locator", "note"}, label="Source citation")
    has_native = bool(value.get("sourceId") and value.get("recordId"))
    if bool(value.get("sourceId")) != bool(value.get("recordId")):
        raise InputError("A native citation retains both sourceId and recordId")
    if has_native:
        value["sourceId"], value["recordId"] = source.identity(value["sourceId"]), source.identity(value["recordId"])
        if "pointer" in value:
            source.pointer_tokens(value["pointer"])
    elif not value.get("url") and not value.get("member"):
        raise InputError("Cite an original native resource, source member, or primary URL")
    if value.get("sourceSha256"):
        source.identity(value["sourceSha256"])
    if value.get("resourceSha256"):
        source.identity(value["resourceSha256"])
    for key in ["url", "locator", "member", "note"]:
        if key in value:
            text(value[key], key, 4000)
    return value

def refs(value):
    if not isinstance(value, list) or len(value) > 256:
        raise InputError("Source citations must be a complete selected array")
    return [source_ref(v) for v in value]

def profile():
    value = source.json_value((HERE / "referral-profile.json").read_bytes())
    if value.get("id") != PROFILE_ID or len(value.get("requirements", [])) != 57 or len(value.get("fields", [])) != 24:
        raise InputError("Installed Gravity source profile must retain all 57 requirements and 24 field reviews")
    return value

def catalogue():
    p = profile()
    inputs = source.json_value((HERE / "referral-schema.json").read_bytes())
    return {"schema": SCHEMA, "productId": "gravity-referrals", "title": "Gravity Referrals",
        "version": "1.0.0", "profiles": [{"id": PROFILE_ID, "label": p["label"],
            "version": "3.0.0", "fhirVersion": "4.0.1", "requirements": 57, "fields": 24}],
        "taskStatuses": TASK_STATUSES, "reviewStates": REVIEW_STATES, "topologies": p["topologies"],
        "roles": ROLES, "collections": sorted(KINDS), "exchangeTypes": EXCHANGE_TYPES,
        "inputSchemas": inputs["schemas"], "native": inputs["native"], "sourceCitation": inputs["sourceCitation"],
        "limits": {"sourceBytes": source.MAX_SOURCE, "resources": source.MAX_RESOURCES,
                   "selectedReferrals": 100, "completeWorkspaceBytes": 512 * 1024 * 1024, "retainedArtifactBytes": source.MAX_SOURCE},
        "fields": [{"key": f["key"], "label": f["label"],
                    "interpretation": f["operating_interpretation"], "sourceRefs": f["source_refs"]}
                   for f in p["fields"]],
        "requirements": [{"key": r["key"], "category": r["category"],
                           "original": r["original"], "sourceRefs": r["source_refs"]} for r in p["requirements"]]}

def common(value):
    value["label"] = text(value.get("label", ""), "Label", 200, True)
    value["actor"] = text(value.get("actor", ""), "Actor", 160, True)
    value.setdefault("note", "")
    value["note"] = text(value["note"], "Note", 16000)
    return value

def configuration(raw):
    value = common(obj(raw, {"label", "actor", "note", "topology", "roles", "recipientHostRole",
        "sourceVersion", "legacyProfileArtifactId", "monitoring", "predecessorId", "classification"},
        {"label", "actor", "topology", "roles", "recipientHostRole"}, "Referral configuration"))
    value["topology"] = enum(value["topology"], TOPOLOGIES, "Topology")
    value["sourceVersion"] = enum(value.get("sourceVersion", "3.0.0"), ["3.0.0", "2.3.0"], "Selected original source version")
    value["classification"] = enum(value.get("classification", "client_supplied"),
        ["published_example", "client_supplied", "operator_transformation"], "Source classification")
    value.setdefault("legacyProfileArtifactId", None)
    if value["sourceVersion"] == "2.3.0" and not value["legacyProfileArtifactId"]:
        raise InputError("A selected legacy interface retains its complete original profile artifact")
    if value["legacyProfileArtifactId"]:
        source.identity(value["legacyProfileArtifactId"])
    value.setdefault("predecessorId", None)
    if value["predecessorId"]:
        source.identity(value["predecessorId"])
    if not isinstance(value["roles"], list) or not 2 <= len(value["roles"]) <= 3:
        raise InputError("Retain the actual source, target, and selected intermediary roles")
    roles = []
    for raw_role in value["roles"]:
        role = obj(raw_role, {"role", "organization", "connectionId", "owner", "note"},
                   {"role", "organization", "owner"}, "Selected actor")
        role["role"] = enum(role["role"], ROLES, "Actor role")
        role["organization"] = text(role["organization"], "Original organization reference", 2000, True)
        role["owner"] = text(role["owner"], "Operating owner", 160, True)
        role.setdefault("connectionId", None)
        if role["connectionId"]:
            source.identity(role["connectionId"])
        role["note"] = text(role.get("note", ""), "Actor note", 4000)
        roles.append(role)
    required = {"source", "target", "intermediary"} if value["topology"].startswith("intermediary") else {"source", "target"}
    if {r["role"] for r in roles} != required or len(roles) != len(required):
        raise InputError("The topology must retain exactly its selected actor roles")
    host = enum(value["recipientHostRole"], ROLES, "Recipient server owner")
    allowed_host = {"direct": {"target"}, "direct-light": {"source"},
                    "intermediary": {"target"}, "intermediary-light": {"source", "intermediary"}}
    if host not in allowed_host[value["topology"]]:
        raise InputError("Recipient server ownership differs from the selected topology")
    value["roles"] = sorted(roles, key=lambda r: ROLES.index(r["role"]))
    policy = obj(value.get("monitoring", {}), {"mode", "intervalMinutes", "timezone",
        "businessDays", "businessStart", "businessEnd", "urgent", "reason", "owner"}, label="Selected monitoring policy")
    policy.setdefault("mode", "manual")
    enum(policy["mode"], ["manual", "poll", "subscription"], "Monitoring mode")
    policy.setdefault("intervalMinutes", None)
    if policy["intervalMinutes"] is not None:
        source.integer(policy["intervalMinutes"], 1, 10080, "Selected interval")
    policy.setdefault("timezone", "UTC")
    try:
        ZoneInfo(policy["timezone"])
    except (ZoneInfoNotFoundError, TypeError):
        raise InputError("Select an actual IANA timezone") from None
    policy.setdefault("businessDays", [1, 2, 3, 4, 5])
    if not isinstance(policy["businessDays"], list) or any(type(d) is not int or not 1 <= d <= 7 for d in policy["businessDays"]) or len(set(policy["businessDays"])) != len(policy["businessDays"]):
        raise InputError("Business days use distinct ISO weekday numbers 1–7")
    for key, default in [("businessStart", "09:00"), ("businessEnd", "17:00")]:
        policy.setdefault(key, default)
        if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", policy[key]):
            raise InputError("Business times use HH:MM")
    policy.setdefault("urgent", False)
    if type(policy["urgent"]) is not bool:
        raise InputError("Urgency is an explicit boolean selection")
    policy["reason"] = text(policy.get("reason", ""), "Monitoring reason", 4000)
    policy["owner"] = text(policy.get("owner", ""), "Monitoring owner", 160)
    if policy["mode"] == "poll" and policy["intervalMinutes"] is None:
        raise InputError("A polling selection needs its actual chosen interval")
    if policy["intervalMinutes"] is not None and policy["intervalMinutes"] < 15 and not (policy["urgent"] and policy["reason"]):
        raise InputError("The original guidance reserves sub-15-minute polling for an explicitly recorded urgent situation")
    value["monitoring"] = policy
    return value

def edition(raw):
    v = common(obj(raw, {"label", "actor", "note", "sourceId", "configurationId", "taskIds",
        "predecessorId", "referencePolicy", "baseUrl", "decisionIds"},
        {"label", "actor", "sourceId", "configurationId", "taskIds"}, "Referral edition"))
    for k in ["sourceId", "configurationId"]:
        source.identity(v[k])
    v["taskIds"] = ids(v["taskIds"], "Selected original Tasks", 100, True)
    v.setdefault("predecessorId", None)
    if v["predecessorId"]:
        source.identity(v["predecessorId"])
    v["referencePolicy"] = enum(v.get("referencePolicy", "bundle"), ["bundle", "selected-base"], "Reference policy")
    v["baseUrl"] = v.get("baseUrl", "")
    v["decisionIds"] = ids(v.get("decisionIds", []), "Reference decisions", 512)
    return v

def review(raw):
    v = common(obj(raw, {"label", "actor", "note", "profileId", "predecessorId", "requirements", "fields"},
        {"label", "actor", "requirements", "fields"}, "Complete source review"))
    v["profileId"] = v.get("profileId", PROFILE_ID)
    if v["profileId"] != PROFILE_ID:
        raise InputError("Select the installed complete Gravity source profile")
    v.setdefault("predecessorId", None)
    if v["predecessorId"]:
        source.identity(v["predecessorId"])
    p = profile()
    for group, originals in [("requirements", p["requirements"]), ("fields", p["fields"])]:
        rows = v[group]
        expected = [r["key"] for r in originals]
        if not isinstance(rows, list) or len(rows) != len(expected) or {r.get("key") for r in rows if isinstance(r, dict)} != set(expected):
            raise InputError("Retain one review for every original " + group + " key")
        checked = {}
        for row in rows:
            r = obj(row, {"key", "status", "reason", "owner", "reviewer", "reviewedAt",
                "sourceRefs", "targetPath", "mapping", "receivingId"}, {"key", "status"}, "Original source review row")
            r["status"] = enum(r["status"], REVIEW_STATES, "Review status")
            for key in ["reason", "targetPath", "mapping"]:
                r[key] = text(r.get(key, ""), key, 8000)
            for key in ["owner", "reviewer"]:
                r[key] = text(r.get(key, ""), key, 160)
            r["sourceRefs"] = refs(r.get("sourceRefs", []))
            r["reviewedAt"] = timestamp(r.get("reviewedAt"), "Review time")
            r.setdefault("receivingId", None)
            if r["receivingId"]:
                source.identity(r["receivingId"])
            if r["status"] != "unreviewed" and (not r["reviewer"] or not r["reason"]):
                raise InputError("An authored review retains its reviewer and concrete reason")
            checked[r["key"]] = r
        v[group] = [checked[k] for k in expected]
    return v

def decision(raw):
    v = common(obj(raw, {"label", "actor", "note", "editionId", "kind", "outcome", "reason",
        "taskIds", "sourceRefs", "resourceIds", "relatedRecords", "purpose", "expiresAt",
        "recordedAt", "supersedesId", "owner", "assessmentId", "findingIds"},
        {"label", "actor", "editionId", "kind", "outcome", "reason"}, "Referral decision"))
    source.identity(v["editionId"])
    v["kind"] = enum(v["kind"], ["consent", "ownership", "workflow", "finding", "resource-link", "receiving", "contact"], "Decision kind")
    v["outcome"] = enum(v["outcome"], ["permit", "deny", "review-required", "accepted", "resolved", "deferred", "rejected"], "Decision outcome")
    v["reason"] = text(v["reason"], "Decision reason", 16000, True)
    v["taskIds"] = ids(v.get("taskIds", []), "Decision Tasks", 100)
    v["resourceIds"] = ids(v.get("resourceIds", []), "Selected original resources", 1000)
    v["sourceRefs"] = refs(v.get("sourceRefs", []))
    v["purpose"] = text(v.get("purpose", ""), "Selected purpose", 4000)
    v["owner"] = text(v.get("owner", ""), "Decision owner", 160)
    v["recordedAt"] = timestamp(v.get("recordedAt"), "Decision time", False)
    v["expiresAt"] = timestamp(v.get("expiresAt"), "Decision expiry")
    v.setdefault("supersedesId", None)
    if v["supersedesId"]:
        source.identity(v["supersedesId"])
    v.setdefault("assessmentId", None)
    if v["assessmentId"]:
        source.identity(v["assessmentId"])
    v["findingIds"] = ids(v.get("findingIds", []), "Selected original findings", 1000)
    rel = v.get("relatedRecords", [])
    if not isinstance(rel, list) or len(rel) > 1000:
        raise InputError("Reviewed resource links must be an array within 1,000 links")
    v["relatedRecords"] = []
    for row in rel:
        row = obj(row, {"fromRecordId", "toRecordId", "toEditionId", "relationship", "reason"},
                  {"fromRecordId", "toRecordId", "toEditionId", "relationship", "reason"}, "Reviewed resource link")
        for key in ["fromRecordId", "toRecordId", "toEditionId"]:
            source.identity(row[key])
        enum(row["relationship"], ["same", "successor", "related", "split", "copy", "proxy"], "Resource relationship")
        text(row["reason"], "Link reason", 4000, True)
        v["relatedRecords"].append(row)
    return v
