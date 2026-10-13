"""Reviewed property/lease/platform continuity; all inputs remain original retained exports."""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import json
import re
from migration_store import MigrationError, canonical, identity, text
from financial_domain import (original_rows as _original_rows, original_kind, selected_cell,
                              decimal_value, decimal_text, date_value)

SCHEMA = "commons.property-continuity/v1"
TYPES = ("exact", "text", "decimal", "date", "instant", "boolean")
COVERAGE = ("complete", "partial", "unknown")
STATUSES = ("MATCH", "DIFFERENT", "UNKNOWN", "AMBIGUOUS", "MISSING", "UNEXPECTED")

def require(ok, code, message, **details):
    if not ok: raise MigrationError(code, message, details)

def obj(value, required=(), optional=()):
    require(isinstance(value, dict), "PROPERTY_OBJECT", "Use a complete property object.")
    require(set(required) <= set(value) and not set(value)-set(required)-set(optional),
            "PROPERTY_FIELDS", "Use the documented fields.", required=list(required), actual=list(value))
    return value

def names(value, label, *, empty=False):
    require(isinstance(value, list) and (value or empty) and all(isinstance(x, str) and x.strip() for x in value),
            "PROPERTY_NAMES", "Select explicit named " + label + ".")
    require(len(value) == len(set(value)), "PROPERTY_DUPLICATE", "Keep each " + label + " distinct.")
    return value

def instant(value):
    require(isinstance(value, str) and re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value),
        "PROPERTY_INSTANT", "Use an ISO instant with explicit timezone and at most microsecond precision.")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(stamp.tzinfo is not None, "PROPERTY_INSTANT", "The original instant needs a timezone.")
        return stamp.astimezone(timezone.utc).isoformat(timespec="microseconds")
    except (ValueError, OverflowError) as exc:
        raise MigrationError("PROPERTY_INSTANT", "Invalid calendar instant or offset.") from exc

def review(value):
    obj(value, ("actor", "note", "evidence_files"))
    text(value["actor"], "review actor"); text(value["note"], "review note")
    require(isinstance(value["evidence_files"], list), "PROPERTY_REVIEW", "Retain original review file identities.")
    return value

def validate_contract(value):
    obj(value, ("title", "scope_id", "platforms", "families", "lease_rule", "review"),
        ("parent_id", "description", "change_reference"))
    text(value["title"], "title"); text(value["scope_id"], "scope")
    require(isinstance(value["platforms"], list) and value["platforms"], "PROPERTY_PLATFORMS", "Declare each authoritative platform.")
    platforms = {}
    for p in value["platforms"]:
        obj(p, ("id", "writer", "contract_reference"))
        for key in p: text(p[key], key)
        require(p["id"] not in platforms, "PROPERTY_PLATFORM", "Platform identifiers are distinct.")
        platforms[p["id"]] = p
    require(isinstance(value["families"], list) and value["families"], "PROPERTY_FAMILIES", "Declare the complete accepted family inventory.")
    families = {}
    for f in value["families"]:
        obj(f, ("id", "platform", "identity", "fields", "relations"), ("description",))
        text(f["id"], "family"); require(f["id"] not in families, "PROPERTY_FAMILY", "Family identifiers are distinct.")
        require(f["platform"] in platforms, "PROPERTY_AUTHORITY", "Select a declared authoritative platform.")
        require(isinstance(f["fields"], dict) and f["fields"] and len(f["fields"]) <= 1000,
                "PROPERTY_FIELDS", "Declare every selected field and its comparison semantics.")
        for name, field in f["fields"].items():
            text(name, "field", max_length=240); obj(field, ("type", "required"))
            require(field["type"] in TYPES and type(field["required"]) is bool,
                    "PROPERTY_FIELD_TYPE", "Select an exact type and explicit required flag.")
        names(f["identity"], "identity fields")
        require(all(k in f["fields"] and f["fields"][k]["type"] in ("text", "exact") and
                    f["fields"][k]["required"] for k in f["identity"]),
                "PROPERTY_IDENTITY", "Identities require exact or text fields; no inferred numeric/date conversion.")
        require(isinstance(f["relations"], list), "PROPERTY_RELATIONS", "Declare an explicit relationship list, including an empty list.")
        families[f["id"]] = f
    for f in families.values():
        seen = set()
        for r in f["relations"]:
            obj(r, ("id", "fields", "target_family", "target_fields", "optional"))
            text(r["id"], "relationship")
            require(r["id"] not in seen, "PROPERTY_RELATION", "Keep relationship identities distinct within each family."); seen.add(r["id"])
            names(r["fields"], "relationship fields"); names(r["target_fields"], "parent identity fields")
            require(r["target_family"] in families, "PROPERTY_RELATION", "Declare the complete parent family.")
            target = families[r["target_family"]]
            require(r["target_fields"] == target["identity"] and len(r["fields"]) == len(r["target_fields"]),
                    "PROPERTY_RELATION_IDENTITY", "Bind the complete ordered parent identity, including scope keys.")
            require(all(k in f["fields"] for k in r["fields"]) and type(r["optional"]) is bool,
                    "PROPERTY_RELATION", "Declare every relationship field and optionality.")
            require(all(f["fields"][a]["type"] == target["fields"][b]["type"]
                        for a,b in zip(r["fields"], r["target_fields"])),
                    "PROPERTY_RELATION_TYPES", "Child and parent identity semantics must agree explicitly.")
    rule = value["lease_rule"]
    obj(rule, ("family", "space_family", "space_fields", "space_identity", "status_field",
               "active_values", "start_field", "end_field", "time_kind", "end_boundary", "open_end"),
        ("cardinality_mode",))
    require(rule["family"] in families and rule["space_family"] in families and rule["family"] != rule["space_family"],
            "PROPERTY_LEASE_FAMILY", "Lease and Rental Space are separate declared families.")
    lease, space = families[rule["family"]], families[rule["space_family"]]
    names(rule["space_fields"], "lease-to-space fields"); names(rule["space_identity"], "Rental Space identity")
    require(rule["space_identity"] == space["identity"] and len(rule["space_fields"]) == len(space["identity"]),
            "PROPERTY_SPACE_IDENTITY", "Bind the complete Rental Space identity.")
    require(all(k in lease["fields"] for k in rule["space_fields"]), "PROPERTY_SPACE_FIELDS", "Select actual lease-to-space fields.")
    require(all(lease["fields"][a]["type"] == space["fields"][b]["type"]
                for a,b in zip(rule["space_fields"], rule["space_identity"])),
            "PROPERTY_SPACE_TYPES", "Rental Space and lease reference types must agree.")
    require(rule["time_kind"] in ("date", "instant") and rule["end_boundary"] in ("inclusive", "exclusive") and type(rule["open_end"]) is bool,
            "PROPERTY_INTERVAL_POLICY", "Declare time precision, end boundary and explicit open-end policy.")
    require(rule.get("cardinality_mode", "declared") in ("declared", "at_cutoff"),
            "PROPERTY_CARDINALITY", "Choose declared active states or effective-at-cutoff cardinality explicitly.")
    for k in (rule["start_field"], rule["end_field"]):
        require(k in lease["fields"] and lease["fields"][k]["type"] == rule["time_kind"],
                "PROPERTY_INTERVAL_FIELDS", "Lease interval fields need the selected date/instant semantics.")
    require(rule["status_field"] in lease["fields"] and lease["fields"][rule["status_field"]]["type"] == "text",
            "PROPERTY_LEASE_STATUS", "Map the exact text status field; dates alone do not establish LIVE/ACTIVE.")
    names(rule["active_values"], "active status values")
    review(value["review"])
    if value.get("parent_id"): text(value.get("change_reference"), "reviewed contract change")
    return value

def family_for(contract, family):
    found = next((f for f in contract["families"] if f["id"] == family), None)
    require(found is not None, "PROPERTY_FAMILY", "Select a family from the current reviewed contract.")
    return found

def original_rows(raw_bytes, format_name, dialect, columns=None):
    # A genuine empty JSON snapshot has no discoverable columns. The reviewed map
    # supplies those column names; no placeholder record is inserted.
    if format_name == "json-table":
        encoding = dialect.get("encoding", "utf-8-sig")
        require(encoding in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"),
                "PROPERTY_ENCODING", "Choose a supported explicit source encoding.")
        try: empty = raw_bytes.decode(encoding).strip() == "[]"
        except UnicodeError: empty = False
        if empty:
            names(columns, "empty export columns")
            return list(columns), []
    return _original_rows(raw_bytes, format_name, dialect)

def validate_mapping(mapping, columns, family):
    require(isinstance(mapping, dict) and set(mapping) == set(family["fields"]),
            "PROPERTY_MAPPING", "Map every reviewed field exactly once.")
    require(all(isinstance(c,str) and c in columns for c in mapping.values()),
            "PROPERTY_MAPPING_COLUMN", "Select original column names.")
    return mapping

def converted(cell, field_type):
    if not cell["present"] or cell.get("value") is None or cell.get("value") == "":
        return dict(cell)
    value = cell["value"]; kind = cell["kind"]
    if field_type == "exact": return dict(cell)
    if field_type == "text":
        require(kind == "string", "PROPERTY_TEXT", "Text is not inferred from an original number or boolean.")
    elif field_type == "boolean":
        require(kind == "boolean", "PROPERTY_BOOLEAN", "Use an actual JSON boolean or an explicitly transformed source export.")
    elif field_type == "decimal":
        require(kind in ("string", "number"), "PROPERTY_DECIMAL", "Use original exact decimal text or number.")
        value = decimal_text(decimal_value(value)); kind = "decimal"
    elif field_type == "date":
        require(kind == "string", "PROPERTY_DATE", "Use an explicit original calendar date.")
        value = date_value(value); kind = "date"
    elif field_type == "instant":
        require(kind == "string", "PROPERTY_INSTANT", "Use an explicit original timestamp.")
        value = instant(value); kind = "instant"
    return {"present":True, "kind":kind, "value":value}

def absent(c):
    return not c["present"] or c.get("value") is None or c.get("value") == ""

def normalize(raw_rows, mapping, family):
    rows, counts = [], Counter()
    for ordinal, raw in enumerate(raw_rows, 1):
        cells, issues = {}, []
        for name, spec in family["fields"].items():
            cell = selected_cell(raw, mapping[name])
            try: cells[name] = converted(cell, spec["type"])
            except MigrationError as exc:
                cells[name] = {**cell, "invalid":exc.code if hasattr(exc,"code") else "INVALID"}
                issues.append({"field":name,"code":"INVALID_" + spec["type"].upper()})
            if spec["required"] and absent(cell): issues.append({"field":name,"code":"REQUIRED_FIELD"})
        key = [cells[k] for k in family["identity"]]
        key_id = identity({"family":family["id"], "key":key})
        rows.append({"ordinal":ordinal, "family":family["id"], "id":key_id, "key":key, "cells":cells,
                     "raw":raw, "raw_types":{k:original_kind(v) for k,v in raw.items()}, "issues":issues})
        counts[key_id] += 1
    for row in rows:
        if counts[row["id"]] > 1: row["issues"].append({"field":None,"code":"DUPLICATE_IDENTITY"})
    return rows

def validate_context(value, contract, family):
    obj(value, ("scope_id", "family", "role", "system", "source_reference", "captured_at", "cutoff",
                "coverage", "authority", "extraction_reference", "independent", "parameters", "review"))
    require(value["scope_id"] == contract["scope_id"] and value["family"] == family["id"],
            "PROPERTY_SCOPE", "Keep exact contract scope and family.")
    require(value["role"] in ("source", "target") and value["coverage"] in COVERAGE and type(value["independent"]) is bool,
            "PROPERTY_CONTEXT", "Declare source/target, coverage and independently acquired return.")
    for k in ("system", "source_reference", "authority", "extraction_reference"): text(value[k], k)
    instant(value["captured_at"])
    time_value(value["cutoff"], contract["lease_rule"]["time_kind"])
    require(isinstance(value["parameters"], dict), "PROPERTY_PARAMETERS", "Retain original extraction parameters.")
    review(value["review"])
    return value

def time_value(value, kind):
    return date_value(value) if kind == "date" else instant(value)

def row_ref(selected, row):
    return {"dataset_id":selected["dataset"]["id"], "ordinal":row["ordinal"], "id":row["id"]}

def identity_complete(selected):
    return selected["dataset"]["context"]["coverage"] == "complete" and all(
        all(not absent(c) and not c.get("invalid") for c in row["key"]) for row in selected["rows"])

def indexed(rows):
    out = defaultdict(list)
    for row in rows: out[row["id"]].append(row)
    return out

def make_check(code, side, family, subject, status, note, **details):
    key = {"code":code, "side":side, "family":family, "subject":subject}
    return {"id":identity(key), **key, "status":status, "note":note, **details}

def relation_checks(contract, selected, side):
    result = []
    for family in contract["families"]:
        current = selected[family["id"]]
        for relation in family["relations"]:
            target = selected[relation["target_family"]]
            parents = indexed(target["rows"]); parent_complete = identity_complete(target)
            for row in current["rows"]:
                cells = [row["cells"][x] for x in relation["fields"]]
                missing = [absent(c) for c in cells]
                target_id = identity({"family":relation["target_family"], "key":cells})
                hits = parents.get(target_id, [])
                if all(missing) and relation["optional"]: status, note = "PASS", "Explicitly optional relation is empty."
                elif any(missing) or any(c.get("invalid") for c in cells): status, note = "UNKNOWN", "Relationship identity is incomplete or invalid."
                elif len(hits) > 1: status, note = "FAIL", "Parent identity is ambiguous."
                elif not hits:
                    status = "FAIL" if parent_complete else "UNKNOWN"
                    note = "No exact parent identity in the selected complete/partial parent population."
                elif hits[0]["issues"]: status, note = "UNKNOWN", "Selected parent has unresolved source issues."
                else: status, note = "PASS", "Complete typed parent identity resolves exactly once."
                result.append(make_check("RELATION",side,family["id"],[relation["id"],row["id"],row["ordinal"]],
                    status,note,source=row_ref(current,row),target_family=relation["target_family"],
                    target_rows=[row_ref(target,r) for r in hits]))
    return result

def lease_checks(contract, selected, side, cutoff):
    rule = contract["lease_rule"]; family = rule["family"]
    leases, spaces = selected[family], selected[rule["space_family"]]
    parents = indexed(spaces["rows"]); spaces_complete = identity_complete(spaces); groups = defaultdict(list); result = []
    inclusive = rule["end_boundary"] == "inclusive"
    cutoff_value = time_value(cutoff,rule["time_kind"])
    for row in leases["rows"]:
        ref = row_ref(leases,row); cells = row["cells"]
        status_cell = cells[rule["status_field"]]
        space_key = [cells[k] for k in rule["space_fields"]]
        space_id = identity({"family":rule["space_family"],"key":space_key})
        hits = parents.get(space_id,[])
        if any(absent(c) or c.get("invalid") for c in space_key): status, note = "UNKNOWN", "Rental Space identity is incomplete."
        elif len(hits)>1: status, note = "FAIL", "Rental Space identity is ambiguous."
        elif not hits:
            status = "FAIL" if spaces_complete else "UNKNOWN"
            note = "No selected Rental Space with the complete typed identity."
        elif hits[0]["issues"]: status, note = "UNKNOWN", "Rental Space has unresolved source issues."
        else: status, note = "PASS", "Lease resolves to its exact Rental Space."
        result.append(make_check("LEASE_SPACE",side,family,[row["id"],row["ordinal"]],status,note,source=ref,space_id=space_id))
        if absent(status_cell) or status_cell.get("invalid"):
            result.append(make_check("LEASE_STATUS",side,family,[row["id"],row["ordinal"]],"UNKNOWN",
                                     "Lease state is absent or invalid; activity is not inferred from dates.",source=ref))
            continue
        active = status_cell["value"] in rule["active_values"]
        start_cell, end_cell = cells[rule["start_field"]], cells[rule["end_field"]]
        try:
            require(not absent(start_cell) and not start_cell.get("invalid"), "PROPERTY_START", "Lease start is required.")
            start = time_value(start_cell["value"],rule["time_kind"])
            require(end_cell["present"] and not end_cell.get("invalid"), "PROPERTY_END", "Lease end must be explicitly present.")
            end = None if absent(end_cell) and rule["open_end"] else time_value(end_cell["value"],rule["time_kind"])
            require(end is None or (start <= end if inclusive else start < end),
                    "PROPERTY_INTERVAL", "Lease interval is empty or reversed under the selected boundary rule.")
            interval_status, interval_note = "PASS", "Reviewed lease interval is valid."
        except (MigrationError, KeyError, TypeError):
            start, end = None, None
            interval_status, interval_note = "UNKNOWN", "Lease interval is invalid or not explicitly bounded/open-ended."
        result.append(make_check("LEASE_INTERVAL",side,family,[row["id"],row["ordinal"]],interval_status,interval_note,source=ref))
        # Retain state cardinality even if dates are invalid. Effective-at-cutoff
        # cardinality cannot make an unknown interval inactive.
        if active and not any(absent(c) or c.get("invalid") for c in space_key):
            groups[space_id].append({"row":row,"ref":ref,"start":start,"end":end,
                                    "valid":interval_status=="PASS","space":space_key})
    for space_id, members in groups.items():
        valid = [x for x in members if x["valid"]]
        at_cutoff = [x for x in valid if x["start"] <= cutoff_value and
                     (x["end"] is None or (cutoff_value <= x["end"] if inclusive else cutoff_value < x["end"]))]
        controlling = members if rule.get("cardinality_mode","declared") == "declared" else at_cutoff
        uncertain = rule.get("cardinality_mode","declared") == "at_cutoff" and len(valid) != len(members)
        status = "FAIL" if len(controlling)>1 else ("UNKNOWN" if uncertain else "PASS")
        result.append(make_check("LEASE_CARDINALITY",side,family,space_id,status,
            "At most one lease in the reviewed active states for this Rental Space and selected policy.",
            cutoff=cutoff,policy=rule.get("cardinality_mode","declared"),count=len(controlling),
            members=[x["ref"] for x in members],effective_members=[x["ref"] for x in at_cutoff]))
        # Sorted sweep emits conflict groups rather than O(n^2) pairs. Every
        # participating record remains listed once per connected overlap group.
        ordered = sorted(valid,key=lambda x:(x["start"],x["row"]["ordinal"]))
        cluster, maximum_end, unbounded = [], None, False
        def finish():
            if len(cluster)>1:
                result.append(make_check("LEASE_OVERLAP",side,family,
                    [space_id,sorted([x["row"]["id"] for x in cluster])],"FAIL",
                    "Active-state lease intervals overlap under the selected boundary policy.",
                    end_boundary=rule["end_boundary"],members=[x["ref"] for x in cluster]))
        for member in ordered:
            overlaps = bool(cluster) and (unbounded or (member["start"] <= maximum_end if inclusive else member["start"] < maximum_end))
            if cluster and not overlaps: finish(); cluster=[]; maximum_end=None; unbounded=False
            cluster.append(member)
            if member["end"] is None: unbounded=True
            elif maximum_end is None or member["end"] > maximum_end: maximum_end=member["end"]
        finish()
    return result

def assess(contract, expected, observed, cutoff):
    validate_contract(contract)
    time_value(cutoff,contract["lease_rule"]["time_kind"])
    families = {f["id"]:f for f in contract["families"]}
    require(isinstance(expected,dict) and isinstance(observed,dict) and set(expected)==set(families)==set(observed),
            "PROPERTY_EDITION_INVENTORY", "Select each complete contracted family exactly once in both editions.")
    items, checks, coverage = [], [], []
    for side, selected, role in (("source",expected,"source"),("target",observed,"target")):
        dataset_ids = []
        for family_id, member in selected.items():
            obj(member,("dataset","rows")); dataset=member["dataset"]; rows=member["rows"]
            require(isinstance(dataset,dict) and isinstance(dataset.get("id"),str) and isinstance(rows,list),
                    "PROPERTY_EDITION", "Select retained datasets and their complete normalized rows.")
            context=validate_context(dataset["context"],contract,families[family_id])
            require(context["role"]==role and time_value(context["cutoff"],contract["lease_rule"]["time_kind"])==
                    time_value(cutoff,contract["lease_rule"]["time_kind"]), "PROPERTY_CUTOFF", "Source and return need the same reviewed effective cutoff.")
            dataset_ids.append(dataset["id"])
            require(all(r["family"]==family_id for r in rows), "PROPERTY_ROW_FAMILY", "Selected normalized rows belong to another family.")
            coverage.append({"side":side,"family":family_id,"dataset_id":dataset["id"],
                             "coverage":context["coverage"],"rows":len(rows)})
            checks.append(make_check("COVERAGE",side,family_id,family_id,
                "PASS" if context["coverage"]=="complete" else "UNKNOWN",
                "Coverage is the recorded full-population extraction review.",dataset_id=dataset["id"],coverage=context["coverage"]))
            if side=="target":
                independent=context["independent"] and context["extraction_reference"] != expected[family_id]["dataset"]["context"]["extraction_reference"]
                checks.append(make_check("INDEPENDENT_RETURN",side,family_id,family_id,"PASS" if independent else "UNKNOWN",
                    "The target needs its own actual acquisition and extraction reference.",dataset_id=dataset["id"]))
                authority=context["authority"]==families[family_id]["platform"]
                checks.append(make_check("PLATFORM_AUTHORITY",side,family_id,family_id,"PASS" if authority else "FAIL",
                    "Return must come from the explicitly selected authoritative platform.",
                    expected=families[family_id]["platform"],observed=context["authority"]))
            for row in rows:
                if row["issues"]:
                    checks.append(make_check("ROW_QUALITY",side,family_id,[row["id"],row["ordinal"]],"UNKNOWN",
                                             "Retained source issues require a later corrected original.",source=row_ref(member,row),issues=row["issues"]))
        require(len(set(dataset_ids))==len(dataset_ids),"PROPERTY_DATASET_REUSE","Each family needs its own retained dataset selection.")
        checks.extend(relation_checks(contract,selected,side))
        checks.extend(lease_checks(contract,selected,side,cutoff))
    require(not ({m["dataset"]["id"] for m in expected.values()} & {m["dataset"]["id"] for m in observed.values()}),
            "PROPERTY_SOURCE_ECHO","An original source dataset cannot also be its independent target return.")
    for family_id, family in families.items():
        left,right=expected[family_id],observed[family_id]
        li,ri=indexed(left["rows"]),indexed(right["rows"])
        left_complete,right_complete=identity_complete(left),identity_complete(right)
        for key in sorted(set(li)|set(ri)):
            a,b=li.get(key,[]),ri.get(key,[])
            changes={}
            if len(a)>1 or len(b)>1: status="AMBIGUOUS"
            elif any(r["issues"] for r in a+b): status="UNKNOWN"
            elif not a: status="UNEXPECTED" if left_complete else "UNKNOWN"
            elif not b: status="MISSING" if right_complete else "UNKNOWN"
            else:
                changes={name:{"expected":a[0]["cells"][name],"observed":b[0]["cells"][name]}
                         for name in family["fields"] if a[0]["cells"][name]!=b[0]["cells"][name]}
                status="DIFFERENT" if changes else "MATCH"
            items.append({"id":identity({"family":family_id,"key":key}),"family":family_id,"key_id":key,
                          "key":(a or b)[0]["key"],"status":status,"changes":changes,
                          "expected":[row_ref(left,r) for r in a],"observed":[row_ref(right,r) for r in b]})
    unknown = any(x["status"]=="UNKNOWN" for x in checks) or any(x["status"] in ("UNKNOWN","AMBIGUOUS") for x in items)
    counts=dict(Counter(i["status"] for i in items)); check_counts=dict(Counter(c["status"] for c in checks))
    complete=not unknown and all(c["coverage"]=="complete" for c in coverage)
    ready=complete and all(i["status"]=="MATCH" for i in items) and all(c["status"]=="PASS" for c in checks)
    return {"schema":SCHEMA+"/assessment","scope_id":contract["scope_id"],"contract_sha256":identity(contract),
            "cutoff":cutoff,"items":items,"checks":checks,"coverage":coverage,"complete":complete,"ready":ready,
            "summary":{"items":len(items),"item_statuses":counts,"checks":len(checks),"check_statuses":check_counts,
                       "source_rows":sum(len(m["rows"]) for m in expected.values()),
                       "target_rows":sum(len(m["rows"]) for m in observed.values())},
            "meaning":"Complete retained source/return comparison and reviewed property rules. No vendor write, accounting posting, spatial transformation or production acceptance is performed."}
