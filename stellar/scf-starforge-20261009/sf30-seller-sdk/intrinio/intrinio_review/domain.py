"""Canonical source-domain interpretation inside the original immutable workspace."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from .model import ReviewError, canonical, parse_response

SCHEMA = "tj.intrinio-fundamentals-workspace.v1"
INDEX = "workspace.json"
STATUSES = {"accept": "confirmed", "revisit": "question", "exclude": "excluded"}
SINGLE = {"company", "fundamental", "fundamental-lookup", "filing", "standardized-dimensions", "bulk-index"}


def view_id(edition_id, source_id):
    return quote(edition_id, safe="~()*!.'").replace("~", "%7E") + "~" + quote(source_id, safe="~()*!.'").replace("~", "%7E")


def read_document(root):
    raw = (root / INDEX).read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ReviewError("WORKSPACE_SIZE", "workspace.json exceeds the original source-file limit.")
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("schema") != SCHEMA or not all(
            isinstance(value.get(key), list) for key in ("editions", "reviews", "comparisonBindings")):
        raise ReviewError("WORKSPACE_SCHEMA", "The selected source needs its original Intrinio workspace.json.")
    return value


def index_document(document):
    op = document.get("operator", {})
    result = {"document": document, "captures": op.get("captures", []), "editions": {}, "reviews": {},
              "projections": op.get("projections", {}), "operations": op.get("operations", {})}
    for edition in document["editions"]:
        for source in edition["sources"]:
            key = view_id(edition["id"], source["id"])
            if key in result["editions"]:
                raise ReviewError("SOURCE_IDENTITY", "A source view has a repeated edition/source identity.")
            result["editions"][key] = {
                "id": key, "editionId": edition["id"], "responseId": source["id"],
                "label": edition["label"] + " · " + source["id"], "operation": source["kind"],
                "path": source["path"], "sha256": source["sha256"], "bytes": source["bytes"],
                "source": source, "scope": edition["scope"], "acquisition": edition.get("acquisition"),
                "importedAt": edition["capturedAt"]}
            reviews = [item for item in document["reviews"]
                       if item["editionId"] == edition["id"] and item["sourceSha256"] == source["sha256"]]
            meta = op.get("reviews", {}).get(key, {})
            decisions = {}
            for item in reviews:
                decisions[item["recordId"]] = {"status": STATUSES[item["disposition"]], "note": item["note"],
                                               "reviewer": item["reviewer"], "createdAt": item["createdAt"]}
            result["reviews"][key] = {
                "revision": len(reviews) + meta.get("sequence", 0), "title": meta.get("title", result["editions"][key]["label"]),
                "notes": meta.get("notes", ""), "decisions": decisions,
                "actor": meta.get("actor", reviews[-1]["reviewer"] if reviews else ""),
                "updatedAt": meta.get("updatedAt", reviews[-1]["createdAt"] if reviews else None)}
    return result


def read_source(root, source, cache=None):
    key = (source["sha256"], source["kind"], canonical(source))
    if cache is not None and key in cache:
        return cache[key]
    member = source["path"]
    pure = PurePosixPath(member)
    if pure.is_absolute() or "\\" in member or any(item in ("", ".", "..") for item in member.split("/")):
        raise ReviewError("SOURCE_PATH", "A retained response path is invalid.")
    selected = root.joinpath(*pure.parts)
    if selected.is_symlink() or not selected.is_file() or selected.stat().st_size > 8 * 1024 * 1024:
        raise ReviewError("SOURCE_FILE", "The selected original response is not a complete regular retained file.")
    resolved = selected.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ReviewError("SOURCE_PATH", "The selected response leaves the materialized source revision.")
    raw = selected.read_bytes()
    if len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
        raise ReviewError("SOURCE_CHANGED", "The complete response differs from its retained byte count or SHA-256.")
    result = parse_response(raw, source["kind"], source)
    if cache is not None:
        cache[key] = result
    return result


def collection_coverage(root, document, edition_id, collection_id, cache=None):
    edition = next(item for item in document["editions"] if item["id"] == edition_id)
    selected = [source for source in edition["sources"] if source.get("page", {}).get("collectionId") == collection_id]
    if not selected:
        return {"status": "unknown", "reason": "No retained page collection was declared.", "complete": False}
    selected.sort(key=lambda source: source["page"]["index"])
    first = selected[0]
    baseline = dict(first["request"]["query"])
    baseline.pop("next_page", None)
    previous = None
    parents, tokens, seen_indices = set(), set(), set()
    problems, observations = [], []
    for position, source in enumerate(selected):
        page, query = source["page"], dict(source["request"]["query"])
        incoming = query.pop("next_page", None)
        if page["index"] in seen_indices or page["index"] != position:
            problems.append("The retained page indices repeat, skip or do not begin at zero.")
        seen_indices.add(page["index"])
        if position == 0 and (not page["first"] or page["cursor"] is not None or incoming is not None):
            problems.append("The retained collection does not begin with an original first request.")
        if position > 0 and (page["first"] or page["cursor"] != previous or previous is None):
            problems.append("A page does not follow the preceding original response cursor.")
        if source["kind"] != first["kind"] or source["request"]["pathParams"] != first["request"]["pathParams"] or query != baseline:
            problems.append("Request scope changed inside the retained collection.")
        if incoming != page["cursor"]:
            problems.append("The declared cursor differs from the original request.")
        if page["cursor"] in tokens and position > 0:
            problems.append("An incoming continuation cursor repeats.")
        tokens.add(page["cursor"])
        try:
            snapshot = read_source(root, source, cache)
        except ReviewError as error:
            problems.append(str(error))
            continue
        context = snapshot.get("fundamental") or snapshot.get("filing") or snapshot.get("company") or {}
        if context.get("id") is not None:
            parents.add(context["id"])
        observations.append({"sourceId": source["id"], "sha256": source["sha256"], "coverage": snapshot["coverage"]})
        previous = snapshot["coverage"]["next_page"]
    if len(parents) > 1:
        problems.append("The original response parent changes within this collection.")
    terminal = bool(observations) and observations[-1]["coverage"]["complete"]
    if first["kind"] in SINGLE and len(selected) != 1:
        problems.append("A singleton response collection contains more than one source.")
    if first["kind"] not in SINGLE and (not terminal or previous == ""):
        problems.append("No usable original terminal cursor was observed.")
    return {"status": "complete" if not problems else "incomplete", "complete": not problems,
            "collectionId": collection_id, "pages": len(selected), "observations": observations,
            "findings": list(dict.fromkeys(problems)), "scope": "This exact retained request collection only.",
            "acquisition": edition.get("acquisition")}


def snapshot(root, key, cache=None):
    document = read_document(root)
    state = index_document(document)
    record = state["editions"].get(key)
    if record is None:
        raise ReviewError("EDITION_NOT_FOUND", "Choose a source view retained in this exact revision.")
    # Cached parse results stay private to one original function invocation.
    value = dict(read_source(root, record["source"], cache))
    value["facts"] = [dict(fact) for fact in value["facts"]]
    page = record["source"].get("page")
    value["collection_coverage"] = collection_coverage(root, document, record["editionId"], page["collectionId"], cache) if page else {
        "status": "unknown", "complete": False, "scope": "No collection identity was declared."}
    for fact in value["facts"]:
        fact.update({"editionId": record["editionId"], "sourceId": record["responseId"], "sourceSha256": record["sha256"],
                     "sourceRecordPointer": fact["source_pointer"], "kind": record["operation"],
                     "company": value["company"], "fundamental": value["fundamental"], "filing": value["filing"]})
    return state, record, value


def normalized_record(fact, snapshot_value, record, review=None):
    """The original source ABI's record fields, with exact values and original row."""
    return {"id": fact["id"], "editionId": record["editionId"], "sourceId": record["responseId"],
            "sourceSha256": record["sha256"], "sourceRecordPointer": fact["source_pointer"],
            "kind": record["operation"], "company": snapshot_value["company"], "fundamental": snapshot_value["fundamental"],
            "filing": snapshot_value["filing"], "tag": {"code": fact["tag"], "id": fact["tag_id"], "name": fact["name"]},
            "dimensions": fact["identity_fields"]["dimensions"], "valueText": fact["value"], "valueType": fact["value_kind"],
            "unit": fact["unit"], "raw": fact["provider_row"], "review": review}


def pointer(record, path):
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 1000:
        raise ReviewError("COLUMN_POINTER", "Customer columns need explicit JSON pointers into the selected original record.")
    value = record
    for escaped in path[1:].split("/"):
        key = escaped.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict):
            if key not in value:
                return {"present": False, "value": None}
            value = value[key]
        elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        else:
            return {"present": False, "value": None}
    return {"present": True, "value": value}
