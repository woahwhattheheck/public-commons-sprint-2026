"""Frozen bilingual consultation packets and source-bound returned comments.

The reviewer page works from local files. Returned identities are declarations,
not authenticated committee membership. Original return bytes, draft amendments
and resolution snapshots remain in the existing project and transaction history.
"""
from __future__ import annotations

import hashlib
import html
import json
from copy import deepcopy
from datetime import date
from pathlib import Path

if __package__:
    from . import engine
else:
    import engine

PACKET_SCHEMA = "standards-consultation-packet/v1"
RESPONSE_SCHEMA = "standards-consultation-response/v1"
REPLY_SCHEMA = "standards-consultation-dispositions/v1"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_COMMENTS = 500
COLLECTIONS = ("review_packets", "review_responses", "review_amendments", "review_resolutions")
OPERATIONS = ("review.packet", "review.receive", "review.amend", "review.resolve", "review.carry")
COMMENT_FIELDS = ("edition_id", "clause_id", "consultation_id", "author_label", "kind", "body",
                  "source_id", "source_comment_id", "source_locator")
CLAUSE_FIELDS = ("title_en", "body_en", "table_en", "title_fr", "body_fr", "table_fr")
ROOT = Path(__file__).resolve().parent


def _object(value, allowed, label, required=()):
    if not isinstance(value, dict):
        raise ValueError(label + " must be an object.")
    unknown = set(value) - set(allowed)
    if unknown:
        raise ValueError(label + " contains unsupported fields: " + ", ".join(sorted(unknown)))
    if set(required) - set(value):
        raise ValueError(label + " is missing: " + ", ".join(sorted(set(required) - set(value))))
    return value


def _sha(value, label):
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError(label + " must be a lowercase SHA-256 digest.")
    return value


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Returned JSON repeats the field " + key + ".")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON is not supported.")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("Use the complete UTF-8 JSON returned by the reviewer page.") from exc


def _public_edition(edition):
    if __package__:
        from .exports import public_edition
    else:
        from exports import public_edition
    return public_edition(edition)


def _packet(state, packet_id):
    packet = engine.record(state, "review_packets", packet_id)
    if engine.digest(packet["snapshot"]) != packet["packet_sha256"]:
        raise ValueError("The retained consultation packet differs from its frozen digest.")
    return packet


def _comment_from_entry(response, entry, index):
    reviewer = response["response"]["reviewer"]
    author = reviewer["name"] or "Unattributed returned comment"
    if reviewer["organization"]:
        author += " — " + reviewer["organization"]
    value = engine.template("comments")
    value.update({
        "id": "review-comment-" + engine.digest({"response": response["response_sha256"], "entry": entry["id"]})[:32],
        "edition_id": response["edition_id"], "clause_id": entry["clause_id"],
        "consultation_id": response["consultation_id"], "author_label": author,
        "kind": entry["kind"], "body": entry["body"], "source_id": response["source_id"],
        "source_comment_id": entry["id"], "source_locator": "/comments/" + str(index),
        "notes": "Original proposed wording and reviewer-declared language are retained in " + response["id"] + ", entry " + entry["id"] + ".",
    })
    return value


def freeze_packet(state, payload, record_id):
    _object(payload, {"id", "consultation_id", "title", "instructions_en", "instructions_fr", "reply_route_en", "reply_route_fr"},
            "Packet")
    consultation = engine.record(state, "consultations", payload.get("consultation_id"))
    edition = engine.record(state, "editions", consultation["edition_id"])
    profile = engine.record(state, "procedures", consultation["procedure_id"])
    if edition["snapshot"]["scope"]["deliverable_type"] not in profile["applies_to"]:
        raise ValueError("Select a procedure applicable to the exact edition's standards-solution type.")
    projected = _public_edition(edition)
    title = engine.text(payload.get("title") or consultation["title"], "Packet title", True, 500)
    prepared = engine.now()
    snapshot = {
        "schema": PACKET_SCHEMA, "packet_id": record_id, "title": title, "prepared_at": prepared,
        "source_edition_sha256": edition["sha256"], "projection_sha256": projected["projection_sha256"],
        "edition": projected,
        "consultation": {k: deepcopy(consultation[k]) for k in ("id", "title", "edition_id", "kind", "opens", "closes")},
        "procedure": {k: deepcopy(profile[k]) for k in ("id", "title", "edition", "profile_status", "applies_to",
                     "public_review_days", "public_review_requirement", "require_peer_review", "require_workshop")},
        "instructions_en": engine.text(payload.get("instructions_en", ""), "English reviewer instructions", False, 16000),
        "instructions_fr": engine.text(payload.get("instructions_fr", ""), "French reviewer instructions", False, 16000),
        "reply_route_en": engine.text(payload.get("reply_route_en", ""), "English return route", False, 2000),
        "reply_route_fr": engine.text(payload.get("reply_route_fr", ""), "French return route", False, 2000),
        "prepared_from_example": state.get("mode") != "working",
    }
    return engine.validate_record("review_packets", {
        "id": record_id, "title": title, "consultation_id": consultation["id"], "edition_id": edition["id"],
        "prepared_at": prepared, "source_edition_sha256": edition["sha256"],
        "projection_sha256": projected["projection_sha256"], "packet_sha256": engine.digest(snapshot), "snapshot": snapshot,
    }, state)


def normalize_response(raw, packet):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("A returned review must contain 1 byte through 8 MiB of original JSON.")
    value = _json(raw)
    allowed = {"schema", "packet_id", "packet_sha256", "edition_id", "source_edition_sha256", "projection_sha256",
               "response_id", "prepared_at", "exported_at", "reviewer", "comments", "authored_example"}
    _object(value, allowed, "Returned review", allowed - {"exported_at", "authored_example"})
    if value["schema"] != RESPONSE_SCHEMA:
        raise ValueError("Unsupported returned-review schema.")
    snap = packet["snapshot"]
    bindings = {"packet_id": packet["id"], "packet_sha256": packet["packet_sha256"],
                "edition_id": packet["edition_id"], "source_edition_sha256": packet["source_edition_sha256"],
                "projection_sha256": packet["projection_sha256"]}
    for name, expected in bindings.items():
        if value[name] != expected:
            raise ValueError("Returned " + name + " identifies another frozen packet or edition.")
    result = {"schema": RESPONSE_SCHEMA, **bindings, "response_id": engine.identity(value["response_id"], "Reviewer response ID")}
    result["prepared_at"] = engine.instant(value["prepared_at"], "Reviewer preparation time", True)
    exported = value.get("exported_at", "")
    if exported:
        engine.instant(exported, "Reviewer export time", True)
    reviewer = _object(value["reviewer"], {"name", "organization", "email", "language"}, "Reviewer declaration")
    result["reviewer"] = {
        "name": engine.text(reviewer.get("name", ""), "Reviewer name", False, 500),
        "organization": engine.text(reviewer.get("organization", ""), "Reviewer organization", False, 1000),
        "email": engine.text(reviewer.get("email", ""), "Reviewer return contact", False, 500),
        "language": reviewer.get("language", "en"),
    }
    if result["reviewer"]["language"] not in ("en", "fr", "bilingual"):
        raise ValueError("Choose en, fr or bilingual for the reviewer language.")
    example = value.get("authored_example", False)
    if type(example) is not bool:
        raise ValueError("authored_example must be true or false.")
    result["authored_example"] = example
    entries = value["comments"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_COMMENTS:
        raise ValueError("Return between 1 and 500 comment entries.")
    clauses = {c["id"] for c in snap["edition"]["snapshot"]["clauses"]}
    seen = set()
    result["comments"] = []
    entry_keys = {"id", "clause_id", "kind", "language", "body", "proposed_text_en", "proposed_text_fr"}
    for index, entry in enumerate(entries):
        _object(entry, entry_keys, "Comment " + str(index + 1), {"id", "clause_id", "kind", "language", "body"})
        key = engine.identity(entry["id"], "Returned comment ID")
        if key in seen:
            raise ValueError("The returned review repeats a comment ID.")
        seen.add(key)
        clause = engine.text(entry["clause_id"], "Reviewed clause", False, 160)
        if clause and clause not in clauses:
            raise ValueError("Returned comment " + key + " names a clause absent from this exact packet.")
        if entry["kind"] not in ("technical", "editorial", "public"):
            raise ValueError("Returned reviews cannot create votes or voting-member status.")
        if entry["language"] not in ("en", "fr", "bilingual"):
            raise ValueError("Comment language must be en, fr or bilingual.")
        result["comments"].append({
            "id": key, "clause_id": clause, "kind": entry["kind"], "language": entry["language"],
            "body": engine.text(entry["body"], "Returned comment text", True, 120000),
            "proposed_text_en": engine.text(entry.get("proposed_text_en", ""), "Proposed English text", False, 120000),
            "proposed_text_fr": engine.text(entry.get("proposed_text_fr", ""), "Proposed French text", False, 120000),
        })
    return result, exported


def response_preview(state, raw, packet_id, filename="returned-review.json"):
    packet = _packet(state, packet_id)
    response, exported = normalize_response(raw, packet)
    content_sha = engine.digest(response)
    prior = [r for r in state.get("review_responses", []) if r["packet_id"] == packet_id]
    duplicate = next((r for r in prior if r["response_sha256"] == content_sha), None)
    versions = [r for r in prior if r["response"]["response_id"] == response["response_id"]]
    latest = max(versions, key=lambda r: (r["received_at"], r["id"])) if versions else None
    old_entries = {r["id"]: r for r in latest["response"]["comments"]} if latest else {}
    new_entries = {r["id"]: r for r in response["comments"]}
    differences = []
    for key in sorted(set(old_entries) | set(new_entries)):
        before, after = old_entries.get(key), new_entries.get(key)
        if engine.canonical(before) != engine.canonical(after):
            differences.append({"entry_id": key, "kind": "added" if before is None else "removed" if after is None else "changed",
                                "before": before, "after": after})
    original = engine.record(state, "consultations", packet["consultation_id"])
    original_edition = engine.record(state, "editions", packet["edition_id"])
    current_clauses = {r["id"]: r for r in state["clauses"]}
    reviewed_clauses = {r["id"]: r for r in original_edition["snapshot"]["clauses"]}
    warnings = []
    if original["actual_closed"]:
        warnings.append("This consultation is recorded as closed. Receiving the original file preserves it and does not reopen the consultation.")
    if original["closes"] and original["closes"] < date.today().isoformat():
        warnings.append("The recorded close date has passed. The operator retains the actual receipt separately from the reviewer's declared dates.")
    if latest and not duplicate:
        warnings.append("This response identity has an earlier return. Select that retained predecessor; earlier comments and dispositions will remain until explicitly resolved.")
    rows = []
    for entry in response["comments"]:
        c = current_clauses.get(entry["clause_id"])
        old = reviewed_clauses.get(entry["clause_id"])
        status = "general" if not entry["clause_id"] else "removed_from_draft" if c is None else "changed_since_packet" if engine.digest(c) != engine.digest(old) else "same_as_packet"
        rows.append({"entry": deepcopy(entry), "draft_status": status, "current_clause": deepcopy(c)})
    return {"schema": RESPONSE_SCHEMA, "packet_id": packet_id, "packet_sha256": packet["packet_sha256"],
            "source_edition_sha256": packet["source_edition_sha256"], "projection_sha256": packet["projection_sha256"],
            "filename": filename, "bytes": len(raw), "source_sha256": hashlib.sha256(raw).hexdigest(),
            "response_sha256": content_sha, "response": response, "reviewer_exported_at": exported,
            "duplicate_of": duplicate["id"] if duplicate else None, "previous_response_id": latest["id"] if latest else None,
            "previous_comments_retained": len(latest["comment_bindings"]) if latest else 0,
            "differences": differences, "comments": rows, "warnings": warnings,
            "identity_status": "reviewer_declared"}


def receive_response(state, raw, packet_id, source_id, record_id, *, supersedes_id="", receipt_note=""):
    preview = response_preview(state, raw, packet_id)
    if preview["duplicate_of"]:
        return None, [], preview
    latest = preview["previous_response_id"]
    if latest and supersedes_id != latest:
        raise ValueError("This reviewer response has an earlier return. Inspect it and select previous_response_id=" + latest + " before receiving the correction.")
    if not latest and supersedes_id:
        raise ValueError("A predecessor can only reference an actual earlier return with the same packet and reviewer response identity.")
    if latest and not engine.text(receipt_note, "Correction receipt note", True, 8000).strip():
        raise ValueError("Record how this revised return relates to its predecessor.")
    packet = _packet(state, packet_id)
    record = {
        "id": record_id, "packet_id": packet_id, "consultation_id": packet["consultation_id"], "edition_id": packet["edition_id"],
        "packet_sha256": packet["packet_sha256"], "source_id": source_id, "source_sha256": preview["source_sha256"],
        "response_sha256": preview["response_sha256"], "received_at": engine.now(),
        "reviewer_exported_at": preview["reviewer_exported_at"], "supersedes_id": supersedes_id,
        "receipt_note": engine.text(receipt_note, "Receipt note", False, 8000),
        "response": preview["response"], "comment_bindings": [],
    }
    comments = []
    for index, entry in enumerate(record["response"]["comments"]):
        comment = _comment_from_entry(record, entry, index)
        comments.append(comment)
        record["comment_bindings"].append({"entry_id": entry["id"], "comment_id": comment["id"], "source_locator": "/comments/" + str(index)})
    return record, comments, preview


def response_for_comment(state, comment_id):
    for response in state.get("review_responses", []):
        for binding in response["comment_bindings"]:
            if binding["comment_id"] == comment_id:
                entry = next(r for r in response["response"]["comments"] if r["id"] == binding["entry_id"])
                return response, entry
    comment = engine.record(state, "comments", comment_id)
    seen = {comment_id}
    while comment.get("carried_from_id"):
        key = comment["carried_from_id"]
        if key in seen:
            raise ValueError("The carried comment history is cyclic.")
        seen.add(key)
        for response in state.get("review_responses", []):
            for binding in response["comment_bindings"]:
                if binding["comment_id"] == key:
                    return response, next(r for r in response["response"]["comments"] if r["id"] == binding["entry_id"])
        comment = engine.record(state, "comments", key)
    return None, None


def prepare_amendment(state, payload, record_id):
    _object(payload, {"id", "comment_id", "clause_id", "expected_clause_sha256", "changes", "rationale"}, "Draft amendment")
    comment = engine.record(state, "comments", payload.get("comment_id"))
    clause = engine.record(state, "clauses", payload.get("clause_id"))
    if _sha(payload.get("expected_clause_sha256"), "Expected clause digest") != engine.digest(clause):
        raise ValueError("The selected clause changed. Inspect its current text before applying this amendment.")
    edits = _object(payload.get("changes"), CLAUSE_FIELDS, "Selected clause changes")
    if not edits:
        raise ValueError("Select at least one actual clause field to change.")
    updated = deepcopy(clause)
    updated.update(deepcopy(edits))
    updated["revision"] = clause["revision"] + 1
    updated = engine.validate_record("clauses", updated, state)
    if all(engine.canonical(clause[k]) == engine.canonical(updated[k]) for k in CLAUSE_FIELDS):
        raise ValueError("The selected fields do not change the current clause.")
    response, entry = response_for_comment(state, comment["id"])
    snapshot = {"comment": deepcopy(comment), "before": deepcopy(clause), "after": deepcopy(updated),
                "response_id": response["id"] if response else "", "entry_id": entry["id"] if entry else "",
                "rationale": engine.text(payload.get("rationale"), "Amendment rationale", True, 16000)}
    amendment = {
        "id": record_id, "comment_id": comment["id"], "clause_id": clause["id"],
        "applied_at": engine.now(), "rationale": snapshot["rationale"],
        "before_sha256": engine.digest(clause), "after_sha256": engine.digest(updated),
        "snapshot": snapshot, "snapshot_sha256": engine.digest(snapshot),
    }
    return amendment, updated


def prepare_resolution(state, payload, record_id):
    _object(payload, {"id", "comment_id", "disposition", "rationale", "resolution_edition_id", "resolution_clause_id",
                     "amendment_ids", "response_visibility", "publication_basis"}, "Comment disposition")
    comment = engine.record(state, "comments", payload.get("comment_id"))
    disposition = payload.get("disposition")
    if disposition not in ("open", "accepted", "rejected", "deferred"):
        raise ValueError("Choose an explicit comment disposition.")
    rationale = engine.text(payload.get("rationale"), "Disposition rationale", disposition != "open", 16000)
    edition_id = engine.text(payload.get("resolution_edition_id", ""), "Resolution edition", False, 160)
    clause_id = engine.text(payload.get("resolution_clause_id", ""), "Resolution clause", False, 160)
    resolution_clause, edition = None, None
    if edition_id:
        edition = engine.record(state, "editions", edition_id)
        if clause_id:
            resolution_clause = next((c for c in edition["snapshot"]["clauses"] if c["id"] == clause_id), None)
            if resolution_clause is None:
                raise ValueError("The selected resolution clause is absent from that frozen edition.")
    elif clause_id:
        raise ValueError("Select the frozen edition containing the resolution clause.")
    amendment_ids = payload.get("amendment_ids", [])
    if not isinstance(amendment_ids, list) or len(amendment_ids) > 100 or len(set(amendment_ids)) != len(amendment_ids):
        raise ValueError("Select a distinct bounded list of applied amendments.")
    amendments = []
    for key in amendment_ids:
        amendment = engine.record(state, "review_amendments", key)
        if amendment["comment_id"] != comment["id"]:
            raise ValueError("A selected amendment belongs to a different comment.")
        if resolution_clause is None or amendment["clause_id"] != clause_id:
            raise ValueError("Link the exact frozen clause containing the selected applied amendment.")
        applied = amendment["snapshot"]["after"]
        if any(engine.canonical(applied[f]) != engine.canonical(resolution_clause[f]) for f in CLAUSE_FIELDS):
            raise ValueError("The chosen resolution edition does not contain this applied amendment's paired text. Select the actual later amendment or explain a disposition without this link.")
        amendments.append({"id": amendment["id"], "snapshot_sha256": amendment["snapshot_sha256"]})
    visibility = payload.get("response_visibility", "recipient_only")
    if visibility not in ("recipient_only", "public"):
        raise ValueError("Choose recipient_only or public for the response appendix.")
    basis = engine.text(payload.get("publication_basis", ""), "Public response inclusion basis", visibility == "public", 8000)
    updated = deepcopy(comment)
    updated.update({"disposition": disposition, "rationale": rationale, "resolution_edition_id": edition_id,
                    "resolution_clause_id": clause_id, "revision": comment["revision"] + 1})
    updated = engine.validate_record("comments", updated, state)
    response, entry = response_for_comment(state, comment["id"])
    snapshot = {"comment_before": deepcopy(comment), "comment_after": deepcopy(updated),
                "source_response_id": response["id"] if response else "", "source_entry_id": entry["id"] if entry else "",
                "resolution_edition_sha256": edition["sha256"] if edition else "",
                "resolution_clause": deepcopy(resolution_clause), "amendments": amendments,
                "response_visibility": visibility, "publication_basis": basis}
    result = {"id": record_id, "comment_id": comment["id"], "recorded_at": engine.now(),
              "disposition": disposition, "rationale": rationale, "resolution_edition_id": edition_id,
              "resolution_clause_id": clause_id, "response_visibility": visibility, "publication_basis": basis,
              "snapshot": snapshot, "snapshot_sha256": engine.digest(snapshot)}
    return result, updated


def _resolution_current(state, resolution):
    comment = next((c for c in state["comments"] if c["id"] == resolution["comment_id"]), None)
    if comment is None:
        return False
    frozen = resolution["snapshot"]["comment_after"]
    keys = COMMENT_FIELDS + ("disposition", "rationale", "resolution_edition_id", "resolution_clause_id")
    return all(engine.canonical(comment[k]) == engine.canonical(frozen[k]) for k in keys)


def analyze(state):
    responses = state.get("review_responses", [])
    comments = {r["id"]: r for r in state["comments"]}
    packets = []
    for packet in state.get("review_packets", []):
        current = engine.record(state, "consultations", packet["consultation_id"])
        frozen = packet["snapshot"]["consultation"]
        returns = [r for r in responses if r["packet_id"] == packet["id"]]
        ids = [b["comment_id"] for r in returns for b in r["comment_bindings"]]
        rows = [comments[cid] for cid in ids]
        packets.append({"id": packet["id"], "title": packet["title"], "consultation_id": packet["consultation_id"],
                        "edition_id": packet["edition_id"], "prepared_at": packet["prepared_at"],
                        "packet_sha256": packet["packet_sha256"], "source_edition_sha256": packet["source_edition_sha256"],
                        "projection_sha256": packet["projection_sha256"], "response_count": len(returns),
                        "comment_count": len(rows), "unresolved_count": sum(c["disposition"] in ("open", "deferred") for c in rows),
                        "consultation_changed_since_packet": any(current[k] != frozen[k] for k in frozen),
                        "actual_closed": current["actual_closed"]})
    rows = []
    for response in responses:
        relevant = [comments[b["comment_id"]] for b in response["comment_bindings"]]
        successor = [r["id"] for r in responses if r["supersedes_id"] == response["id"]]
        counts = {choice: sum(c["disposition"] == choice for c in relevant) for choice in ("open", "accepted", "rejected", "deferred")}
        rows.append({"id": response["id"], "packet_id": response["packet_id"], "edition_id": response["edition_id"],
                     "received_at": response["received_at"], "source_id": response["source_id"], "source_sha256": response["source_sha256"],
                     "response_sha256": response["response_sha256"], "reviewer": deepcopy(response["response"]["reviewer"]),
                     "authored_example": response["response"]["authored_example"], "comment_count": len(relevant),
                     "dispositions": counts, "supersedes_id": response["supersedes_id"], "successor_ids": successor,
                     "unchanged_decisions_available": decision_carry_preview(state, response["id"])["eligible_count"],
                     "earlier_open_comments": [b["comment_id"] for b in engine.record(state, "review_responses", response["supersedes_id"])["comment_bindings"]
                                              if comments[b["comment_id"]]["disposition"] in ("open", "deferred")] if response["supersedes_id"] else []})
    resolutions = [{"id": r["id"], "comment_id": r["comment_id"], "disposition": r["disposition"],
                    "resolution_edition_id": r["resolution_edition_id"], "response_visibility": r["response_visibility"],
                    "current": _resolution_current(state, r)} for r in state.get("review_resolutions", [])]
    return {"packets": packets, "responses": rows, "resolutions": resolutions,
            "counts": {name: len(state.get(name, [])) for name in COLLECTIONS},
            "identity_status": "reviewer_declared", "receipt_creates_vote": False}


def response_detail(state, response_id):
    response = engine.record(state, "review_responses", response_id)
    packet = _packet(state, response["packet_id"])
    reviewed = {c["id"]: c for c in packet["snapshot"]["edition"]["snapshot"]["clauses"]}
    current = {c["id"]: c for c in state["clauses"]}
    rows = []
    for binding in response["comment_bindings"]:
        entry = next(r for r in response["response"]["comments"] if r["id"] == binding["entry_id"])
        comment = engine.record(state, "comments", binding["comment_id"])
        clause = current.get(comment["clause_id"])
        amendments = [deepcopy(r) for r in state.get("review_amendments", []) if r["comment_id"] == comment["id"]]
        resolutions = [{**deepcopy(r), "current": _resolution_current(state, r)}
                       for r in state.get("review_resolutions", []) if r["comment_id"] == comment["id"]]
        rows.append({"entry": deepcopy(entry), "comment": deepcopy(comment), "reviewed_clause": deepcopy(reviewed.get(entry["clause_id"])),
                     "current_clause": deepcopy(clause), "current_clause_sha256": engine.digest(clause) if clause else None,
                     "amendments": amendments, "resolutions": resolutions})
    return {"id": response["id"], "response": deepcopy(response), "packet": {
        "id": packet["id"], "title": packet["title"], "packet_sha256": packet["packet_sha256"],
        "source_edition_sha256": packet["source_edition_sha256"], "projection_sha256": packet["projection_sha256"]},
        "comments": rows, "decision_carry": decision_carry_preview(state, response_id), "identity_status": "reviewer_declared"}



def decision_carry_preview(state, response_id):
    """Offer an explicit batch adoption of unchanged predecessor decisions."""
    response = engine.record(state, "review_responses", response_id)
    previous_id = response["supersedes_id"]
    result = {"response_id": response_id, "predecessor_id": previous_id,
              "response_sha256": response["response_sha256"], "entries": [], "eligible_count": 0}
    if not previous_id:
        return result
    previous = engine.record(state, "review_responses", previous_id)
    result["predecessor_sha256"] = previous["response_sha256"]
    old_entries = {r["id"]: r for r in previous["response"]["comments"]}
    old_bindings = {r["entry_id"]: r["comment_id"] for r in previous["comment_bindings"]}
    current_bindings = {r["entry_id"]: r["comment_id"] for r in response["comment_bindings"]}
    for entry in response["response"]["comments"]:
        old = old_entries.get(entry["id"])
        target = engine.record(state, "comments", current_bindings[entry["id"]])
        prior = engine.record(state, "comments", old_bindings[entry["id"]]) if old else None
        same = old is not None and engine.canonical(old) == engine.canonical(entry)
        reason = ""
        if old is None:
            reason = "This entry was added in the corrected return."
        elif not same:
            reason = "This entry changed; review its new content independently."
        elif prior["disposition"] == "open":
            reason = "The predecessor entry has no decision to adopt."
        elif not prior["rationale"].strip():
            reason = "The predecessor decision has no recorded rationale."
        elif target["disposition"] != "open" or target["rationale"] or target["resolution_edition_id"] or target["resolution_clause_id"]:
            reason = "The current entry already has a decision or resolution; preserve its current work."
        matches = [r for r in state.get("review_resolutions", [])
                   if prior and r["comment_id"] == prior["id"] and _resolution_current(state, r)]
        resolution = max(matches, key=lambda r: (r["recorded_at"], r["id"])) if matches else None
        result["entries"].append({
            "entry_id": entry["id"], "clause_id": entry["clause_id"], "body": entry["body"],
            "unchanged": same, "eligible": not reason, "reason": reason,
            "comment_id": target["id"], "current_disposition": target["disposition"],
            "predecessor_comment_id": prior["id"] if prior else None,
            "predecessor_comment_revision": prior["revision"] if prior else None,
            "predecessor_comment_sha256": engine.digest(prior) if prior else None,
            "predecessor_disposition": prior["disposition"] if prior else None,
            "predecessor_rationale": prior["rationale"] if prior else None,
            "resolution_edition_id": prior["resolution_edition_id"] if prior else None,
            "resolution_clause_id": prior["resolution_clause_id"] if prior else None,
            "predecessor_resolution_id": resolution["id"] if resolution else None,
        })
    result["eligible_count"] = sum(row["eligible"] for row in result["entries"])
    return result


def prepare_decision_carries(state, payload, record_id):
    _object(payload, {"id", "response_id", "predecessor_id", "entry_ids", "rationale"},
            "Unchanged decision adoption")
    response_id = payload.get("response_id")
    preview = decision_carry_preview(state, response_id)
    if not preview["predecessor_id"] or payload.get("predecessor_id") != preview["predecessor_id"]:
        raise ValueError("Select the actual retained predecessor of this corrected response.")
    selected = payload.get("entry_ids")
    if not isinstance(selected, list) or not 1 <= len(selected) <= MAX_COMMENTS or any(not isinstance(x, str) for x in selected) or len(set(selected)) != len(selected):
        raise ValueError("Select 1 through 500 distinct unchanged entry IDs.")
    rationale = engine.text(payload.get("rationale"), "Decision adoption rationale", True, 16000)
    rows = {r["entry_id"]: r for r in preview["entries"]}
    response = engine.record(state, "review_responses", response_id)
    predecessor = engine.record(state, "review_responses", preview["predecessor_id"])
    prepared = []
    for entry_id in selected:
        row = rows.get(entry_id)
        if not row or not row["eligible"]:
            raise ValueError("Entry " + entry_id + " cannot adopt its predecessor decision: " +
                             (row["reason"] if row else "entry absent from the corrected return."))
        prior = engine.record(state, "comments", row["predecessor_comment_id"])
        rid = "review-carry-" + engine.digest({"operation": record_id, "entry": entry_id})[:32]
        resolution, updated = prepare_resolution(state, {
            "comment_id": row["comment_id"], "disposition": prior["disposition"], "rationale": prior["rationale"],
            "resolution_edition_id": prior["resolution_edition_id"], "resolution_clause_id": prior["resolution_clause_id"],
            "amendment_ids": [], "response_visibility": "recipient_only", "publication_basis": "",
        }, rid)
        source_resolution = engine.record(state, "review_resolutions", row["predecessor_resolution_id"]) if row["predecessor_resolution_id"] else None
        resolution["snapshot"]["adopted_predecessor"] = {
            "response_id": predecessor["id"], "response_sha256": predecessor["response_sha256"],
            "receiving_response_id": response["id"], "receiving_response_sha256": response["response_sha256"],
            "entry_id": entry_id, "comment": deepcopy(prior), "comment_sha256": engine.digest(prior),
            "resolution_id": source_resolution["id"] if source_resolution else "",
            "resolution_snapshot_sha256": source_resolution["snapshot_sha256"] if source_resolution else "",
            "rationale": rationale,
        }
        resolution["snapshot_sha256"] = engine.digest(resolution["snapshot"])
        prepared.append((resolution, updated))
    return prepared, preview


def _validate_decision_adoption(state, resolution):
    adopted = resolution["snapshot"].get("adopted_predecessor")
    if not adopted:
        return
    old = engine.record(state, "review_responses", adopted["response_id"])
    new = engine.record(state, "review_responses", adopted["receiving_response_id"])
    if new["supersedes_id"] != old["id"] or adopted["response_sha256"] != old["response_sha256"] or adopted["receiving_response_sha256"] != new["response_sha256"]:
        raise ValueError("An adopted decision does not bind the exact predecessor response.")
    key = adopted["entry_id"]
    old_entry = next((r for r in old["response"]["comments"] if r["id"] == key), None)
    new_entry = next((r for r in new["response"]["comments"] if r["id"] == key), None)
    if old_entry is None or new_entry is None or engine.canonical(old_entry) != engine.canonical(new_entry):
        raise ValueError("A changed returned entry cannot inherit its predecessor decision.")
    old_binding = next(r for r in old["comment_bindings"] if r["entry_id"] == key)
    new_binding = next(r for r in new["comment_bindings"] if r["entry_id"] == key)
    prior = adopted["comment"]
    if prior["id"] != old_binding["comment_id"] or resolution["comment_id"] != new_binding["comment_id"] or engine.digest(prior) != adopted["comment_sha256"]:
        raise ValueError("An adopted decision has a different exact comment basis.")
    original = _comment_from_entry(old, old_entry, old["response"]["comments"].index(old_entry))
    if any(prior[k] != original[k] for k in COMMENT_FIELDS):
        raise ValueError("An adopted predecessor decision changed original comment content or source identity.")
    for key in ("disposition", "rationale", "resolution_edition_id", "resolution_clause_id"):
        if resolution[key] != prior[key]:
            raise ValueError("The adopted decision differs from the selected predecessor decision.")
    if prior["disposition"] == "open" or not prior["rationale"].strip():
        raise ValueError("An unchanged entry requires an actual predecessor decision and rationale.")
    if adopted["resolution_id"]:
        source = engine.record(state, "review_resolutions", adopted["resolution_id"])
        if source["comment_id"] != prior["id"] or source["snapshot_sha256"] != adopted["resolution_snapshot_sha256"]:
            raise ValueError("The adopted source-resolution identity differs.")
        fields = COMMENT_FIELDS + ("disposition", "rationale", "resolution_edition_id", "resolution_clause_id")
        if any(source["snapshot"]["comment_after"][k] != prior[k] for k in fields):
            raise ValueError("The adopted predecessor snapshot is not the selected resolution.")
    elif adopted["resolution_snapshot_sha256"]:
        raise ValueError("An adopted decision cannot name a missing source resolution.")
    engine.text(adopted["rationale"], "Decision adoption rationale", True, 16000)
    if resolution["response_visibility"] != "recipient_only" or resolution["publication_basis"]:
        raise ValueError("Decision adoption does not silently inherit public inclusion. Record a separate explicit publication selection.")


def validate_state(state):
    """Validate immutable joins without normalizing or replacing older project bytes."""
    packets = {r["id"]: r for r in state.get("review_packets", [])}
    responses = {r["id"]: r for r in state.get("review_responses", [])}
    origin_comments = {}
    content_keys = set()
    for packet in packets.values():
        snap = packet["snapshot"]
        if engine.digest(snap) != packet["packet_sha256"] or snap.get("schema") != PACKET_SCHEMA or snap.get("packet_id") != packet["id"]:
            raise ValueError("A consultation packet has an inconsistent frozen identity.")
        edition = engine.record(state, "editions", packet["edition_id"])
        if edition["sha256"] != packet["source_edition_sha256"] or snap.get("source_edition_sha256") != edition["sha256"]:
            raise ValueError("A packet no longer binds its exact original edition.")
        projected = _public_edition(edition)
        if engine.canonical(projected) != engine.canonical(snap.get("edition")) or packet["projection_sha256"] != projected["sha256"]:
            raise ValueError("The packet public projection differs from its retained edition.")
        if snap["consultation"]["id"] != packet["consultation_id"] or snap["consultation"]["edition_id"] != packet["edition_id"]:
            raise ValueError("The packet consultation identifies another edition.")
        # The editable consultation may have a successor schedule; this frozen copy stays intact.
    for response in responses.values():
        packet = packets.get(response["packet_id"])
        if packet is None:
            raise ValueError("A returned review lacks its frozen packet.")
        normalized, _ = normalize_response((engine.canonical(response["response"]) + "\n").encode(), packet)
        if normalized != response["response"] or engine.digest(normalized) != response["response_sha256"]:
            raise ValueError("A returned response snapshot differs from its content digest.")
        if response["packet_sha256"] != packet["packet_sha256"] or response["edition_id"] != packet["edition_id"] or response["consultation_id"] != packet["consultation_id"]:
            raise ValueError("A received review points to another packet or consultation.")
        source = engine.record(state, "sources", response["source_id"])
        if not source["source_file_id"] or source["sha256"] != response["source_sha256"]:
            raise ValueError("A received review lacks its exact retained original bytes.")
        content_key = (response["packet_id"], response["response_sha256"])
        if content_key in content_keys:
            raise ValueError("The same returned content was adopted twice.")
        content_keys.add(content_key)
        if response["supersedes_id"]:
            previous = responses.get(response["supersedes_id"])
            if previous is None or previous["id"] == response["id"] or previous["packet_id"] != response["packet_id"] or previous["response"]["response_id"] != response["response"]["response_id"]:
                raise ValueError("A corrected return must identify its actual prior response.")
        expected_bindings = []
        for index, entry in enumerate(response["response"]["comments"]):
            expected = _comment_from_entry(response, entry, index)
            expected_bindings.append({"entry_id": entry["id"], "comment_id": expected["id"], "source_locator": expected["source_locator"]})
            if expected["id"] in origin_comments:
                raise ValueError("A comment is bound to more than one returned response.")
            origin_comments[expected["id"]] = expected
            current = engine.record(state, "comments", expected["id"])
            if any(current[k] != expected[k] for k in COMMENT_FIELDS):
                raise ValueError("Returned comment text and source bindings are retained originals. Edit its disposition, or receive an explicit corrected return.")
        if response["comment_bindings"] != expected_bindings:
            raise ValueError("Returned comment-to-source bindings differ.")
    for response in responses.values():
        seen = {response["id"]}
        cursor = response
        while cursor["supersedes_id"]:
            key = cursor["supersedes_id"]
            if key in seen:
                raise ValueError("The response predecessor history is cyclic.")
            seen.add(key)
            cursor = responses[key]
    for amendment in state.get("review_amendments", []):
        snap = amendment["snapshot"]
        if engine.digest(snap) != amendment["snapshot_sha256"]:
            raise ValueError("An applied clause amendment snapshot differs.")
        if snap["comment"]["id"] != amendment["comment_id"] or snap["before"]["id"] != amendment["clause_id"] or snap["after"]["id"] != amendment["clause_id"]:
            raise ValueError("An amendment identifies another comment or clause.")
        if engine.digest(snap["before"]) != amendment["before_sha256"] or engine.digest(snap["after"]) != amendment["after_sha256"]:
            raise ValueError("An amendment's exact before/after identities differ.")
        if snap["after"]["revision"] != snap["before"]["revision"] + 1:
            raise ValueError("An amendment does not preserve adjacent clause revisions.")
        unchanged = set(engine.FIELDS["clauses"]) - set(CLAUSE_FIELDS)
        if any(snap["before"][key] != snap["after"][key] for key in unchanged):
            raise ValueError("A text amendment changed unrelated clause identity or source mappings.")
    for resolution in state.get("review_resolutions", []):
        _validate_decision_adoption(state, resolution)
        snap = resolution["snapshot"]
        if engine.digest(snap) != resolution["snapshot_sha256"]:
            raise ValueError("A comment disposition snapshot differs.")
        before, after = snap["comment_before"], snap["comment_after"]
        if before["id"] != resolution["comment_id"] or after["id"] != resolution["comment_id"] or after["revision"] != before["revision"] + 1:
            raise ValueError("A disposition must bind adjacent versions of its exact comment.")
        for key in ("disposition", "rationale", "resolution_edition_id", "resolution_clause_id"):
            if after[key] != resolution[key]:
                raise ValueError("A disposition summary differs from its frozen comment.")
        if any(before[key] != after[key] for key in COMMENT_FIELDS):
            raise ValueError("A disposition altered original reviewer text or source identity.")
        if snap["response_visibility"] != resolution["response_visibility"] or snap["publication_basis"] != resolution["publication_basis"]:
            raise ValueError("The selected response audience differs from its retained decision.")
        if resolution["resolution_edition_id"]:
            edition = engine.record(state, "editions", resolution["resolution_edition_id"])
            if edition["sha256"] != snap["resolution_edition_sha256"]:
                raise ValueError("A disposition names another resolution edition.")
            if resolution["resolution_clause_id"]:
                clause = next((c for c in edition["snapshot"]["clauses"] if c["id"] == resolution["resolution_clause_id"]), None)
                if clause != snap["resolution_clause"]:
                    raise ValueError("The resolution clause differs from its exact frozen edition.")
        elif snap["resolution_edition_sha256"] or snap["resolution_clause"] is not None:
            raise ValueError("A disposition without an edition cannot claim a frozen clause.")
        for link in snap["amendments"]:
            amendment = engine.record(state, "review_amendments", link["id"])
            if amendment["comment_id"] != resolution["comment_id"] or amendment["snapshot_sha256"] != link["snapshot_sha256"]:
                raise ValueError("A disposition's retained amendment binding differs.")
        if resolution["response_visibility"] == "public" and not resolution["publication_basis"].strip():
            raise ValueError("Record the explicit inclusion basis for a public response.")
    return state


def validate_originals(state, originals):
    """Validate restored received JSON against its actual archived source bytes."""
    files = {m["id"]: m for m in state["files"]}
    for response in state.get("review_responses", []):
        source = engine.record(state, "sources", response["source_id"])
        raw = originals[source["source_file_id"]]
        if hashlib.sha256(raw).hexdigest() != response["source_sha256"]:
            raise ValueError("A returned review's original bytes differ.")
        normalized, exported = normalize_response(raw, _packet(state, response["packet_id"]))
        if normalized != response["response"] or exported != response["reviewer_exported_at"]:
            raise ValueError("The archived return snapshot differs from its actual source file.")
    return True


def packet_files(state, packet_id):
    packet = _packet(state, packet_id)
    payload = {"packet_sha256": packet["packet_sha256"], "packet": deepcopy(packet["snapshot"])}
    encoded = engine.canonical(payload).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    template = (ROOT / "web" / "reviewer.html").read_text(encoding="utf-8")
    style = (ROOT / "web" / "reviewer.css").read_text(encoding="utf-8")
    script = (ROOT / "web" / "reviewer.js").read_text(encoding="utf-8")
    if any(template.count(marker) != 1 for marker in ("__REVIEW_STYLE__", "__REVIEW_DATA__", "__REVIEW_SCRIPT__")):
        raise ValueError("The installed reviewer template is incomplete.")
    page = template.replace("__REVIEW_STYLE__", style).replace("__REVIEW_DATA__", encoded).replace("__REVIEW_SCRIPT__", script)
    readme = """CONSULTATION / CONSULTATION

Open reviewer.html in a current browser. The English and French text and worked
cases belong to the exact frozen packet identified in packet.json.
Read the instructions and the recorded return route. Write comments against a
clause or the whole document. Export your response JSON and send it through that
route. No response is sent by this page. Save a local draft file before closing;
browser storage is optional and may be unavailable for local files.

Ouvrez reviewer.html dans un navigateur actuel. Les textes anglais et français
et les cas portent sur le dossier figé identifié dans packet.json.
Lisez les instructions et le mode de retour indiqué. Rédigez des commentaires
sur une clause ou sur le document entier. Exportez la réponse JSON et transmettez-la
par ce mode de retour. Cette page n'envoie aucune réponse. Enregistrez un fichier
de brouillon avant de fermer; le stockage du navigateur peut être indisponible.

The form records the identity and timestamps you enter or your browser supplies.
Its content hashes identify files; they are not signatures or voting credentials.
Les identités et dates sont déclarées. Les empreintes identifient le contenu;
elles ne constituent ni signatures ni droits de vote.
"""
    return {"reviewer.html": page.encode(), "packet.json": (engine.canonical(payload) + "\n").encode(),
            "READ-ME.txt": readme.encode()}


def _table(headers, rows):
    escape = lambda value: html.escape(str(value if value is not None else ""))
    return "<div class='table-wrap'><table><thead><tr>" + "".join("<th>" + escape(h) + "</th>" for h in headers) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td><div class='prose'>" + escape(v) + "</div></td>" for v in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def _document(title, content, language="en"):
    return ("<!doctype html><html lang='" + language + "'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
            "<title>" + html.escape(title) + "</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:32px auto;max-width:1100px;padding:0 22px}"
            "h1{font-size:26px}h2{font-size:20px;margin-top:32px}small{color:#555}table{border-collapse:collapse;width:100%;table-layout:fixed}"
            "td,th{border:1px solid #bbb;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#efefef}"
            ".prose{white-space:pre-wrap}.table-wrap{overflow:auto}code{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}h2{break-after:avoid}}</style><body>"
            + content + "</body></html>").encode()


def disposition_snapshot(state, response_id=None, edition_id=None, public=False):
    if public and not edition_id:
        raise ValueError("Select the exact publication edition for a public response appendix.")
    if response_id:
        selected = [engine.record(state, "review_responses", response_id)]
    else:
        selected = state.get("review_responses", [])
    included = []
    resolutions = state.get("review_resolutions", [])
    for response in selected:
        packet = _packet(state, response["packet_id"])
        for binding in response["comment_bindings"]:
            comment = engine.record(state, "comments", binding["comment_id"])
            entry = next(e for e in response["response"]["comments"] if e["id"] == binding["entry_id"])
            current = [r for r in resolutions if r["comment_id"] == comment["id"] and _resolution_current(state, r)]
            resolution = max(current, key=lambda r: (r["recorded_at"], r["id"])) if current else None
            if public and (resolution is None or resolution["response_visibility"] != "public" or resolution["resolution_edition_id"] != edition_id):
                continue
            target = None
            if resolution and resolution["resolution_edition_id"]:
                frozen = engine.record(state, "editions", resolution["resolution_edition_id"])
                projected = _public_edition(frozen)
                target = {"edition_id": frozen["id"], "source_edition_sha256": frozen["sha256"],
                          "projection_sha256": projected["sha256"], "label": frozen["label"]}
                if resolution["resolution_clause_id"]:
                    target["clause"] = next(c for c in projected["snapshot"]["clauses"] if c["id"] == resolution["resolution_clause_id"])
            included.append({
                "entry_id": entry["id"], "comment_id": comment["id"], "packet_id": packet["id"],
                "response_id": response["id"], "response_sha256": response["response_sha256"],
                "supersedes_response_id": response.get("supersedes_id"),
                "packet_sha256": packet["packet_sha256"], "reviewed_edition_id": packet["edition_id"],
                "reviewed_edition_sha256": packet["source_edition_sha256"], "clause_id": entry["clause_id"],
                "kind": entry["kind"], "language": entry["language"], "body": entry["body"],
                "proposed_text_en": entry["proposed_text_en"], "proposed_text_fr": entry["proposed_text_fr"],
                "disposition": comment["disposition"], "rationale": comment["rationale"],
                "resolution_id": resolution["id"] if resolution else None,
                "resolution_snapshot_sha256": resolution["snapshot_sha256"] if resolution else None,
                "target": target, "authored_example": response["response"]["authored_example"],
            })
    content = {"schema": REPLY_SCHEMA, "audience": "public_selected" if public else "selected_respondent",
               "response_id": response_id, "publication_edition_id": edition_id,
               "comments": included, "identity_projection": "Names, organizations, email addresses, receipt notes and source files are excluded."}
    return {**content, "sha256": engine.digest(content)}


def disposition_files(state, response_id=None, edition_id=None, public=False):
    snapshot = disposition_snapshot(state, response_id, edition_id, public)
    title = "Consultation response / Réponse à la consultation"
    body = "<h1>" + title + "</h1><p>" + html.escape(snapshot["audience"]) + "</p><p><small>Content identity / Empreinte du contenu: " + snapshot["sha256"] + "</small></p>"
    if not snapshot["comments"]:
        body += "<p>No response entries are selected for this output. / Aucun commentaire n'est sélectionné pour cette sortie.</p>"
    for row in snapshot["comments"]:
        body += "<h2>" + html.escape(row["clause_id"] or "General / Général") + "</h2>"
        body += "<p><small>" + html.escape(row["entry_id"]) + " · " + html.escape(row["reviewed_edition_id"]) + "</small></p>"
        body += "<p><small>Returned version / Version retournée: " + html.escape(row["response_id"]) + " · " + html.escape(row["response_sha256"]) + "</small></p>"
        if row["supersedes_response_id"]:
            body += "<p><small>Corrects / Corrige: " + html.escape(row["supersedes_response_id"]) + "</small></p>"
        body += _table(["Comment / Commentaire", "Proposed English text", "Texte français proposé"],
                       [[row["body"], row["proposed_text_en"], row["proposed_text_fr"]]])
        body += _table(["Disposition / Traitement", "Rationale / Motif"], [[row["disposition"], row["rationale"]]])
        if row["target"]:
            target = row["target"]
            body += "<p>Resolution edition / Édition de résolution: " + html.escape(target["label"]) + " <small>" + html.escape(target["source_edition_sha256"]) + "</small></p>"
            if target.get("clause"):
                clause = target["clause"]
                body += _table(["English", "Français"], [[clause["title_en"] + "\n" + clause["body_en"], clause["title_fr"] + "\n" + clause["body_fr"]]])
        if row["authored_example"]:
            body += "<p><small>Authored exercise response / Réponse d'exercice rédigée pour la démonstration.</small></p>"
    prefix = "publication/consultation" if public else "response"
    return {prefix + ".json": (engine.canonical(snapshot) + "\n").encode(),
            prefix + ".html": _document(title, body)}
