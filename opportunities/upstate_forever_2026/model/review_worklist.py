"""Current customer requests and original engineering work across one project."""
from __future__ import annotations

import copy
import csv
import io
import json

from .common import digest, held, identifier, now
from . import reviews, review_handback

SCHEMA = "upstate.customer-review-worklist/v1"
EDITION = "current-customer-requests-20261013-v1"
DISPOSITIONS = ("unrecorded", "planned", "addressed", "deferred")
FILTERS = ("q", "review_id", "owner", "owner_state", "requested_assignee", "disposition", "priority")


def _copy(value):
    return copy.deepcopy(value)


def _text(value, name, maximum=2000):
    return reviews._text("" if value is None else value, name, maximum=maximum)


def filters(value=None):
    value = value or {}
    result = {key: _text(value.get(key), key, 2000 if key == "q" else 10000 if key == "requested_assignee" else 500) for key in FILTERS}
    for key in ("review_id",):
        if result[key]:
            identifier(result[key])
    if result["disposition"] and result["disposition"] not in DISPOSITIONS:
        raise ValueError("Choose an existing engineering disposition")
    if result["owner_state"] not in ("", "assigned", "unassigned"):
        raise ValueError("Choose all, assigned or unassigned engineering requests")
    return result


def _page(value, name, default, maximum=None):
    raw = value.get(name)
    if raw in (None, ""):
        return default
    if isinstance(raw, bool):
        raise ValueError(name + " must be a whole number")
    if isinstance(raw, str):
        if not raw.isascii() or not raw.isdigit():
            raise ValueError(name + " must be a whole number")
        raw = int(raw)
    if type(raw) is not int or raw < (1 if name == "limit" else 0) or (maximum and raw > maximum):
        raise ValueError("Choose a valid worklist " + name)
    return raw


def _matched(row, selected):
    if selected["review_id"] and row["review_id"] != selected["review_id"]:
        return False
    if selected["owner"] and row["engineering_owner"] != selected["owner"]:
        return False
    if selected["requested_assignee"] and row["requested_assignee"] != selected["requested_assignee"]:
        return False
    if selected["owner_state"] == "assigned" and not row["engineering_owner"].strip():
        return False
    if selected["owner_state"] == "unassigned" and row["engineering_owner"].strip():
        return False
    if selected["disposition"] and row["engineering_disposition"] != selected["disposition"]:
        return False
    if selected["priority"] and row["priority"] != selected["priority"]:
        return False
    if selected["q"]:
        text = json.dumps(row, sort_keys=True, ensure_ascii=False).casefold()
        if selected["q"].casefold() not in text:
            return False
    return True


def _evidence(record, artifact_ids, requirement_ids):
    if record is None:
        return {"artifacts": [], "requirements": []}
    artifacts = {row["id"]: row for row in record["artifacts"]}
    requirements = {row["id"]: row for row in record["requirements"]}
    return {
        "artifacts": [_copy(artifacts[key]) for key in artifact_ids],
        "requirements": [_copy(requirements[key]) for key in requirement_ids],
    }


def build(workspace):
    """Read a coherent current snapshot, indexing each retained history bank once."""
    with held(workspace.root / ".workspace.lock", blocking=False):
        originals = {row["id"]: row for row in workspace._list("reviews")}
        responses, handbacks = {}, {}
        for row in workspace._list("review-responses"):
            if row.get("review_id") not in originals:
                raise ValueError("A retained customer response lacks its original review")
            responses.setdefault(row["review_id"], []).append(row)
        for row in workspace._list(review_handback.KIND):
            if row.get("review_id") not in originals:
                raise ValueError("An engineering edition lacks its original review")
            handbacks.setdefault((row["review_id"], row["response_id"]), []).append(row)
        histories = {}

        def history(key):
            if key not in histories:
                if key not in originals:
                    raise ValueError("Restore the original revised review before opening its worklist")
                histories[key] = reviews.history_from_records(workspace, originals[key], responses.get(key, []))
            return histories[key]

        items, sources, choices = [], [], []
        for review_id, original in sorted(originals.items()):
            chain = history(review_id)
            response = chain[-1] if chain else None
            requests = review_handback.requests_for(original, response) if response else []
            engineering = []
            if response:
                for record in handbacks.get((review_id, response["id"]), []):
                    revision = originals.get(record["revised_review_id"]) if record.get("revised_review_id") else None
                    if record.get("revised_review_id") and revision is None:
                        raise ValueError("An engineering edition lacks its original revised review")
                    review_handback._check_record(record, original, response, revision, workspace.project["id"])
                    if revision is not None:
                        reviews.response_prefix(history(revision["id"]), record["revised_response_id"])
                    engineering.append(record)
            engineering = review_handback._chain(engineering)
            last = engineering[-1] if engineering else None
            revised = originals[last["revised_review_id"]] if last and last["revised_review_id"] else None
            resolutions = {row["request_id"]: row for row in last["items"]} if last else {}
            sources.append({"review_id": review_id, "response_id": response["id"] if response else None,
                            "handback_id": last["id"] if last else None})
            choices.append({"id": review_id, "title": original["title"], "purpose": original["purpose"],
                            "response_id": response["id"] if response else None, "requests": len(requests)})
            for request in requests:
                resolution = resolutions.get(request["id"])
                original_evidence = _evidence(original, request["artifact_ids"], request["requirement_ids"])
                replacement = _evidence(
                    revised, resolution["replacement_artifact_ids"] if resolution else [],
                    resolution["replacement_requirement_ids"] if resolution else [])
                items.append({
                    "request_id": request["id"], "request_kind": request["kind"],
                    "source_id": request["source_id"], "title": request["title"],
                    "description": request["description"], "priority": request["priority"],
                    "requested_assignee": request["owner"], "original_request": _copy(request),
                    "review_id": review_id, "review_title": original["title"], "review_purpose": original["purpose"],
                    "response_id": response["id"], "response_created_at": response["response"]["created_at"],
                    "response_imported_at": response.get("imported_at"),
                    "reviewer": _copy(response["response"]["reviewer"]),
                    "customer_disposition": response["response"]["disposition"],
                    "handback_id": last["id"] if last else None,
                    "handback_state": last["state"] if last else None,
                    "handback_created_at": last["created_at"] if last else None,
                    "prepared_by": _copy(last["prepared_by"]) if last else None,
                    "engineering_disposition": resolution["disposition"] if resolution else "unrecorded",
                    "engineering_owner": resolution["owner"] if resolution else "",
                    "engineering_note": resolution["note"] if resolution else "",
                    "engineering_item": _copy(resolution),
                    "revised_review_id": revised["id"] if revised else None,
                    "revised_review_title": revised["title"] if revised else None,
                    "revised_response_id": last["revised_response_id"] if last else None,
                    "original_evidence": original_evidence, "replacement_evidence": replacement,
                })
        items.sort(key=lambda row: (row["review_title"].casefold(), row["review_id"],
                                   row["request_kind"], row["source_id"]))
        snapshot = digest({"schema": SCHEMA, "edition": EDITION, "project": workspace.project, "sources": sources})
        return {
            "schema": SCHEMA, "edition": EDITION, "snapshot_id": snapshot, "read_at": now(),
            "project": _copy(workspace.project), "sources": sources, "rows": items,
            "reviews": choices,
            "summary": {
                "reviews": len(originals), "responses": sum(bool(row["response_id"]) for row in sources),
                "reviews_with_requests": sum(bool(row["requests"]) for row in choices),
                "customer_requests": len(items),
                "engineering_dispositions": {key: sum(row["engineering_disposition"] == key for row in items)
                                            for key in DISPOSITIONS},
                "unassigned_engineering_requests": sum(not row["engineering_owner"].strip() for row in items),
            },
            "options": {
                "owners": sorted({row["engineering_owner"] for row in items if row["engineering_owner"]}),
                "requested_assignees": sorted({row["requested_assignee"] for row in items if row["requested_assignee"]}),
                "priorities": sorted({row["priority"] for row in items}),
                "dispositions": list(DISPOSITIONS),
            },
        }


def _guard(snapshot, expected):
    if expected:
        identifier(expected)
        if snapshot["snapshot_id"] != expected:
            raise ValueError("Current customer requests or engineering editions changed. Refresh the worklist before continuing.")


def select(workspace, supplied=None, *, complete=False):
    value = supplied or {}
    chosen = filters(value)
    snapshot = build(workspace)
    _guard(snapshot, value.get("snapshot_id"))
    matching = [row for row in snapshot["rows"] if _matched(row, chosen)]
    offset = 0 if complete else _page(value, "offset", 0)
    limit = len(matching) if complete else _page(value, "limit", 50, 500)
    if offset > len(matching):
        offset = (max(0, len(matching) - 1) // limit) * limit
    result = {**snapshot, "filters": chosen, "total": len(matching), "offset": offset,
              "limit": limit, "next_offset": offset + limit if offset + limit < len(matching) else None,
              "rows": matching if complete else matching[offset:offset + limit]}
    return result


def item(workspace, supplied):
    snapshot = build(workspace)
    _guard(snapshot, supplied.get("snapshot_id"))
    request_id = identifier(supplied.get("request_id"))
    row = next((row for row in snapshot["rows"] if row["request_id"] == request_id), None)
    if row is None:
        raise ValueError("This request is outside the current customer response. Open its retained response history or refresh the worklist.")
    return {"schema": SCHEMA, "snapshot_id": snapshot["snapshot_id"],
            "read_at": snapshot["read_at"], "project": snapshot["project"], "item": row}


def csv_document(result):
    fields = (
        "review_title", "review_id", "response_id", "reviewer", "customer_disposition",
        "request_id", "request_kind", "source_id", "title", "description", "priority",
        "requested_assignee", "engineering_owner", "engineering_disposition", "engineering_note",
        "handback_id", "handback_state", "handback_created_at", "prepared_by",
        "revised_review_id", "revised_review_title", "revised_response_id",
        "original_evidence", "replacement_evidence",
    )
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(("snapshot_id", *fields))
    for row in result["rows"]:
        values = []
        for value in (result["snapshot_id"], *(row.get(key) for key in fields)):
            if isinstance(value, (dict, list)):
                value = json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            values.append("" if value is None else value)
        writer.writerow(values)
    return out.getvalue()
