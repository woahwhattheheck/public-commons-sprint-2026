"""MIT. Source-bound grant review, edition reconciliation, and exact financial meaning."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation, localcontext
import datetime as dt
import hashlib
import json
import re
import uuid

SCHEMA = "stellar-forge.grant-portfolio.v1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
OPERATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\Z")
MAX_PACKET = 4 * 1024 * 1024 * 1024
MAX_JSON = 1024 * 1024
MAX_SOURCES = 64
TABLES = ("entities", "financial", "links", "decisions", "candidates", "changes", "sources")


class InputError(ValueError):
    def __init__(self, message, code="INVALID_INPUT", status=400):
        super().__init__(message)
        self.code, self.status = code, status


def require(value, message, code="INVALID_INPUT", status=400):
    if not value:
        raise InputError(message, code, status)


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value)).hexdigest()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate JSON member: " + key)
        result[key] = value
    return result


def parse(value):
    def bad(token):
        raise InputError("Non-finite JSON number: " + token)
    try:
        return json.loads(value, object_pairs_hook=pairs, parse_constant=bad)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise InputError("Invalid UTF-8 JSON: " + str(error)) from error


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def short(value, name, maximum=1000, empty=False):
    require(isinstance(value, str) and len(value) <= maximum and (empty or value.strip()),
            name + " must be " + ("0" if empty else "1") + "–" + str(maximum) + " characters")
    return value if empty else value.strip()


def sha(value):
    require(isinstance(value, str) and bool(HEX.fullmatch(value)), "Select an exact SHA-256 identity")
    return value


def identifier(value):
    try:
        valid = str(uuid.UUID(value, version=4)) == value and uuid.UUID(value).version == 4
    except (ValueError, TypeError, AttributeError):
        valid = False
    require(valid, "Select a canonical UUID version 4")
    return value


def revision(value):
    require(type(value) is int and value > 0, "Select a positive integer revision")
    return value


def operation(value):
    require(isinstance(value, str) and bool(OPERATION.fullmatch(value)), "Invalid operation identity")
    return value


def shape(value, allowed, required=()):
    require(isinstance(value, dict), "Expected an object")
    require(not (set(value) - set(allowed)), "Unknown fields: " + ", ".join(sorted(set(value) - set(allowed))))
    require(set(required) <= set(value), "Missing fields: " + ", ".join(sorted(set(required) - set(value))))
    return value


def entity_key(kind, original_id):
    return digest([kind, original_id])


def reference(entity):
    return {key: entity[key] for key in ("sourceId", "entityKey", "sha256")}


def ref_key(ref):
    return ref["sourceId"], ref["entityKey"]


def checked_ref(value, lookup):
    shape(value, ("sourceId", "entityKey", "sha256"), ("sourceId", "entityKey", "sha256"))
    for item in value.values():
        sha(item)
    actual = lookup.get(ref_key(value))
    require(actual is not None, "The selected record is outside this portfolio revision", "RECORD_NOT_SELECTED", 409)
    require(actual["sha256"] == value["sha256"], "The selected record changed; open its current complete detail",
            "RECORD_CHANGED", 409)
    return dict(value), actual


def validate_decision(raw, lookup, reviewer, reviewed_at):
    shape(raw, ("id", "type", "left", "right", "relation", "disposition", "rationale", "record", "related"),
          ("type", "disposition", "rationale"))
    ident = identifier(raw["id"]) if raw.get("id") else str(uuid.uuid4())
    result = {"id": ident, "type": raw["type"],
              "disposition": raw["disposition"], "rationale": short(raw["rationale"], "Rationale", 8000),
              "reviewer": reviewer, "reviewedAt": reviewed_at, "status": "CURRENT"}
    if raw["type"] == "link":
        require(not (set(raw) & {"record", "related"}), "Link decisions use left and right records")
        left, a = checked_ref(raw.get("left"), lookup)
        right, b = checked_ref(raw.get("right"), lookup)
        require(ref_key(left) != ref_key(right), "Select two distinct records")
        relation = raw.get("relation")
        require(relation in {"same-organization", "grant-activity", "duplicate"}, "Select a supported relation")
        require(raw["disposition"] in {"confirmed", "rejected", "ambiguous"}, "Select a link disposition")
        if relation == "same-organization":
            require(a["kind"] == b["kind"] == "organization", "Organization links require two organization records")
        elif relation == "grant-activity":
            require({a["kind"], b["kind"]} == {"grant", "activity"}, "Grant–activity links require one of each record kind")
        else:
            require(a["kind"] == b["kind"], "Duplicate links require the same record kind")
        result.update(left=left, right=right, relation=relation)
    elif raw["type"] == "record":
        require(not (set(raw) & {"left", "right", "relation"}), "Record decisions use a single record")
        selected, actual = checked_ref(raw.get("record"), lookup)
        require(raw["disposition"] in {"unmatched", "coverage-only", "duplicate"}, "Select a record disposition")
        result["record"] = selected
        if raw.get("related") is not None:
            related, other = checked_ref(raw["related"], lookup)
            require(raw["disposition"] == "duplicate" and actual["kind"] == other["kind"]
                    and ref_key(related) != ref_key(selected), "A duplicate reference must select another record of the same kind")
            result["related"] = related
        require(raw["disposition"] != "duplicate" or "related" in result, "Identify the original record for a duplicate")
    else:
        raise InputError("Select link or record review")
    return result


def decision_refs(decision):
    return [decision[key] for key in ("left", "right", "record", "related") if key in decision]


def reconcile_decisions(decisions, lookup, replacements):
    """Carry only unchanged complete native records; retain every original decision."""
    output = []
    for original in decisions:
        result = dict(original)
        if original.get("status") == "STALE":
            output.append(result)
            continue
        proposed, differences = {}, []
        for field in ("left", "right", "record", "related"):
            if field not in original:
                continue
            old = original[field]
            selected = {"sourceId": replacements.get(old["sourceId"], old["sourceId"]),
                        "entityKey": old["entityKey"]}
            current = lookup.get(ref_key(selected))
            if not current:
                differences.append({"field": field, "reason": "record-removed", "previous": old})
            elif current["sha256"] != old["sha256"]:
                differences.append({"field": field, "reason": "record-changed", "previous": old,
                                    "current": reference(current)})
            else:
                proposed[field] = reference(current)
        if differences:
            result.update(status="STALE", staleReasons=differences)
            result["proposedReferences"] = proposed
        else:
            result.update(proposed)
            if any(result[k] != original[k] for k in proposed):
                result["carriedFrom"] = {k: original[k] for k in proposed}
        output.append(result)
    return output


def compact_entity(entity):
    return {k: v for k, v in entity.items() if k not in {"original", "variants", "financialRecords"}}


def suggest(entities):
    """Exact identifiers and exact titles nominate reviews; neither creates a link."""
    orgs, titles, identifiers = defaultdict(list), defaultdict(list), defaultdict(list)
    for entity in entities:
        if entity["kind"] == "organization" and entity.get("originalId"):
            orgs[entity["originalId"]].append(entity)
        elif entity["kind"] in {"grant", "activity"}:
            if entity.get("title", "").strip():
                titles[" ".join(entity["title"].casefold().split())].append(entity)
            for token in entity.get("referenceTokens", []):
                identifiers[token].append(entity)
    candidates = {}
    def nominate(a, b, relation, basis):
        if a["sourceId"] == b["sourceId"] or a["standard"] == b["standard"]:
            return
        if relation == "grant-activity" and {a["kind"], b["kind"]} != {"grant", "activity"}:
            return
        left, right = sorted((reference(a), reference(b)), key=lambda r: (r["sourceId"], r["entityKey"]))
        ident = digest([left, right, relation])
        if ident not in candidates:
            candidates[ident] = {"id": ident, "left": left, "right": right, "relation": relation,
                                 "leftTitle": a["title"] if left == reference(a) else b["title"],
                                 "rightTitle": b["title"] if right == reference(b) else a["title"],
                                 "basis": [], "status": "PROPOSED"}
        if basis not in candidates[ident]["basis"]:
            candidates[ident]["basis"].append(basis)
    for groups, relation, basis in ((orgs, "same-organization", "same-published-organization-identifier"),
                                     (identifiers, "grant-activity", "shared-published-reference"),
                                     (titles, "grant-activity", "same-normalized-title")):
        for members in groups.values():
            for index, left in enumerate(members):
                for right in members[index + 1:]:
                    nominate(left, right, relation, basis)
    multiplicity = defaultdict(int)
    for candidate in candidates.values():
        for side in ("left", "right"):
            multiplicity[(candidate["relation"], ref_key(candidate[side]))] += 1
    for candidate in candidates.values():
        if any(multiplicity[(candidate["relation"], ref_key(candidate[side]))] > 1 for side in ("left", "right")):
            candidate["status"] = "AMBIGUOUS"
    return sorted(candidates.values(), key=lambda row: row["id"])


def review_queue(candidates, decisions):
    current = {}
    for decision in decisions:
        if decision["type"] == "link" and decision["status"] == "CURRENT":
            ends = sorted((decision["left"], decision["right"]), key=lambda r: (r["sourceId"], r["entityKey"]))
            current[digest([*ends, decision["relation"]])] = decision
    output = []
    for candidate in candidates:
        row = dict(candidate)
        if candidate["id"] in current:
            decision = current[candidate["id"]]
            row.update(status=decision["disposition"].upper(), decisionId=decision["id"])
        output.append(row)
    return output


def decimal_amount(value):
    if value is None or value == "":
        return None
    require(isinstance(value, str) and len(value) <= 4096, "Financial values must retain their original decimal text")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise InputError("Invalid original financial decimal") from error
    require(number.is_finite(), "Non-finite financial amount")
    return number


def financial_totals(rows):
    """Group independently by source, meaning, currency, and every original dimension."""
    groups = {}
    with localcontext() as context:
        context.prec = 8192
        for row in rows:
            dimensions = {"sourceId": row["sourceId"], "standard": row["standard"],
                          "kind": row["kind"], **row["dimensions"]}
            key = digest(dimensions)
            target = groups.setdefault(key, {"id": key, "dimensions": dimensions,
                "amount": Decimal(0), "includedRecords": 0, "excludedRecords": 0, "missingRecords": 0})
            amount = decimal_amount(row.get("value"))
            if amount is None:
                target["missingRecords"] += 1
            if row["eligible"] and amount is not None:
                target["amount"] += amount
                target["includedRecords"] += 1
            else:
                target["excludedRecords"] += 1
        return [{**value, "amount": str(value["amount"]) if value["includedRecords"] else None}
                for _, value in sorted(groups.items())]


def make_changes(previous_entities, current_entities, replacements):
    previous = {ref_key(x): x for x in previous_entities}
    current = {ref_key(x): x for x in current_entities}
    matched, changes = set(), []
    for key, old in sorted(previous.items()):
        current_key = (replacements.get(key[0], key[0]), key[1])
        new = current.get(current_key)
        if new is None:
            changes.append({"kind": "removed", "before": reference(old), "title": old["title"]})
        else:
            matched.add(current_key)
            if old["sha256"] != new["sha256"]:
                changes.append({"kind": "changed", "before": reference(old), "after": reference(new),
                                "title": new["title"]})
            elif key[0] != current_key[0]:
                changes.append({"kind": "unchanged-in-following-edition", "before": reference(old),
                                "after": reference(new), "title": new["title"]})
    for key in sorted(set(current) - matched):
        new = current[key]
        changes.append({"kind": "added", "after": reference(new), "title": new["title"]})
    return [{"id": digest(row), **row} for row in changes]
