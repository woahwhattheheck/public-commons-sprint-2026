"""Member ballot packets, retained returns and explicit adoption into existing votes.

The original standards engine owns eligibility, dates, ballot arithmetic, closure
and publication. This exchange adds no remote sending or identity authentication.
"""
from __future__ import annotations
import csv
import hashlib
import html
import io
from copy import deepcopy
from pathlib import Path

if __package__:
    from . import engine, consultation
else:
    import engine, consultation

ROOT = Path(__file__).resolve().parent
PACKET_SCHEMA = "standards-member-ballot/v1"
RETURN_SCHEMA = "standards-member-ballot-return/v1"
DOSSIER_SCHEMA = "standards-ballot-decision-handover/v1"
MAX_RETURN_BYTES = 2 * 1024 * 1024
COLLECTIONS = ("ballot_packets", "ballot_returns", "ballot_adoptions")
OPERATIONS = ("ballot.packet", "ballot.receive", "ballot.adopt")
BINDING_FIELDS = ("project_id", "packet_id", "packet_sha256", "ballot_id",
                  "ballot_sha256", "edition_id", "edition_sha256", "person_id")
RETURN_FIELDS = {"schema", *BINDING_FIELDS, "response_id", "response_revision",
                 "previous_response_sha256", "choice", "justification", "cast_at",
                 "declared_name", "language"}
_object, _sha = consultation._object, consultation._sha


def _closed(state, ballot_id):
    return any(r["ballot_id"] == ballot_id for r in state["ballot_closures"])


def _vote(state, ballot_id, person_id):
    return next((r for r in state["votes"] if r["ballot_id"] == ballot_id
                 and r["person_id"] == person_id), None)


def _packet(state, packet_id):
    row = engine.record(state, "ballot_packets", packet_id)
    if engine.digest(row["snapshot"]) != row["packet_sha256"]:
        raise ValueError("The retained member packet differs from its frozen content.")
    return row


def binding(packet):
    snap = packet["snapshot"]
    return {"project_id": snap["project_id"], "packet_id": packet["id"],
            "packet_sha256": packet["packet_sha256"], "ballot_id": packet["ballot_id"],
            "ballot_sha256": snap["ballot"]["snapshot_sha256"],
            "edition_id": packet["edition_id"], "edition_sha256": snap["source_edition_sha256"],
            "person_id": packet["person_id"]}


def freeze_packet(state, payload, record_id):
    _object(payload, {"id", "ballot_id", "person_id", "title", "instructions_en",
                     "instructions_fr", "reply_route_en", "reply_route_fr"}, "Member packet",
            ("ballot_id", "person_id", "title"))
    ballot = engine.record(state, "ballots", payload["ballot_id"])
    if _closed(state, ballot["id"]):
        raise ValueError("The ballot is closed. Existing member packets remain downloadable.")
    member = next((r for r in ballot["roster"] if r["person_id"] == payload["person_id"]
                   and r["voting"]), None)
    if member is None:
        raise ValueError("Select an eligible person from this ballot's frozen roster.")
    edition = engine.record(state, "editions", ballot["edition_id"])
    projected = consultation._public_edition(edition)
    controls = {k: engine.text(payload.get(k, ""), k, k == "title", 20000)
                for k in ("title", "instructions_en", "instructions_fr", "reply_route_en", "reply_route_fr")}
    snap = {"schema": PACKET_SCHEMA, "project_id": state["id"], "packet_id": record_id,
            "mode": state["mode"], "project_title": state["title"], **controls,
            "prepared_at": engine.now(), "source_edition_sha256": edition["sha256"],
            "edition": projected,
            "ballot": {k: deepcopy(ballot[k]) for k in
                       ("id", "title", "edition_id", "opens", "closes", "method",
                        "profile", "source_procedure_id", "frozen_at", "snapshot_sha256")},
            "member": deepcopy(member),
            "identity_note": "This packet identifies one frozen roster entry. Returned names and votes "
                             "are declarations; the secretariat verifies the original sender before adoption."}
    return {"id": record_id, "title": controls["title"], "ballot_id": ballot["id"],
            "edition_id": edition["id"], "person_id": member["person_id"],
            "prepared_at": snap["prepared_at"], "packet_sha256": engine.digest(snap), "snapshot": snap}


def normalize_return(raw, packet):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_RETURN_BYTES:
        raise ValueError("Supply the complete member JSON, up to 2 MiB.")
    value = consultation._json(raw)
    _object(value, RETURN_FIELDS, "Member return", RETURN_FIELDS)
    if value["schema"] != RETURN_SCHEMA:
        raise ValueError("Use the ballot return downloaded from the member page.")
    for key, expected in binding(packet).items():
        if value[key] != expected:
            raise ValueError("Member return differs from its frozen " + key + ".")
    engine.identity(value["response_id"], "Member response ID")
    if type(value["response_revision"]) is not int or not 1 <= value["response_revision"] <= 1000000:
        raise ValueError("Member response revision must be a positive integer.")
    previous = value["previous_response_sha256"]
    if not isinstance(previous, str):
        raise ValueError("Previous member return digest must be a string, empty only for the original response.")
    if previous:
        _sha(previous, "Previous member return")
    if bool(previous) != (value["response_revision"] > 1):
        raise ValueError("A corrected return needs its exact preceding return digest.")
    if value["choice"] not in ("yes", "no", "abstain", "blank"):
        raise ValueError("Choose yes, no, abstain or an explicitly blank response.")
    if value["language"] not in ("en", "fr"):
        raise ValueError("Choose English or French.")
    for field, required, limit in (("declared_name", True, 500), ("justification", False, 120000)):
        normalized = engine.text(value[field], field, required, limit)
        if normalized != value[field]:
            raise ValueError("Member text must preserve the normalized complete string.")
    engine.instant(value["cast_at"], "Member-declared vote date", True)
    # Apply the original exact roster/date semantics without appending a vote.
    snap = packet["snapshot"]
    vote = {**engine.template("votes"), "id": "preview-member-vote",
            "ballot_id": packet["ballot_id"], "person_id": packet["person_id"],
            "choice": value["choice"], "justification": value["justification"],
            "cast_at": value["cast_at"]}
    minimal = {"ballots": [{**snap["ballot"], "roster": [snap["member"]]}],
               "people": [{"id": packet["person_id"]}], "sources": []}
    engine.validate_record("votes", vote, minimal)
    return deepcopy(value)


def preview_return(state, raw, packet_id, filename="member-return.json"):
    packet = _packet(state, packet_id)
    value = normalize_return(raw, packet)
    sha = engine.digest(value)
    rows = [r for r in state.get("ballot_returns", []) if r["packet_id"] == packet_id]
    duplicate = next((r for r in rows if r["response_sha256"] == sha), None)
    predecessor = None
    if value["previous_response_sha256"]:
        predecessor = next((r for r in rows if r["response_sha256"] == value["previous_response_sha256"]), None)
        if predecessor is None:
            raise ValueError("Receive the exact preceding return before its corrected edition.")
        if (predecessor["response"]["response_id"] != value["response_id"] or
                predecessor["response"]["response_revision"] + 1 != value["response_revision"]):
            raise ValueError("A correction must continue the same response ID and next revision.")
        branches = [r for r in rows if r["supersedes_id"] == predecessor["id"] and
                    r["response_sha256"] != sha]
        if branches:
            raise ValueError("This preceding return already has a different correction. Retain and reconcile that edition.")
    elif not duplicate and rows:
        raise ValueError("A member packet already has a return. A correction must explicitly continue its original response.")
    current = _vote(state, packet["ballot_id"], packet["person_id"])
    profile = packet["snapshot"]["ballot"]["profile"]
    observations = []
    if value["choice"] == "blank":
        observations.append("The original calculation records blank responses separately.")
    if value["choice"] == "no" and profile["exclude_unjustified_negative"] and not value["justification"].strip():
        observations.append("The selected procedure excludes a negative response without its required justification.")
    if value["choice"] == "abstain" and profile["exclude_unjustified_abstention"] and not value["justification"].strip():
        observations.append("The selected procedure excludes an abstention without its required justification.")
    return {"packet_id": packet_id, "response": value, "response_sha256": sha,
            "source_sha256": hashlib.sha256(raw).hexdigest(), "source_bytes": len(raw),
            "filename": filename, "duplicate_of": duplicate["id"] if duplicate else None,
            "supersedes_id": predecessor["id"] if predecessor else "",
            "current_vote": deepcopy(current), "current_vote_sha256": engine.digest(current) if current else "",
            "ballot_closed": _closed(state, packet["ballot_id"]), "observations": observations,
            "identity_note": packet["snapshot"]["identity_note"]}


def receive_return(state, raw, packet_id, source_id, filename, receipt_note=""):
    preview = preview_return(state, raw, packet_id, filename)
    if preview["duplicate_of"]:
        return None, preview
    packet = _packet(state, packet_id)
    value = {"id": "ballot-return-" + preview["response_sha256"][:32],
             "packet_id": packet_id, "ballot_id": packet["ballot_id"], "person_id": packet["person_id"],
             "source_id": source_id, "source_sha256": preview["source_sha256"],
             "response_sha256": preview["response_sha256"], "received_at": engine.now(),
             "supersedes_id": preview["supersedes_id"],
             "receipt_note": engine.text(receipt_note, "Receipt note", False, 20000),
             "response": preview["response"]}
    return value, preview


def prepare_adoption(state, payload, record_id):
    _object(payload, {"id", "return_id", "expected_vote_sha256", "verification_note"},
            "Ballot adoption", ("return_id", "expected_vote_sha256", "verification_note"))
    returned = engine.record(state, "ballot_returns", payload["return_id"])
    if any(r["return_id"] == returned["id"] for r in state.get("ballot_adoptions", [])):
        raise ValueError("This return was already adopted. Reopen its original result; do not recreate a vote.")
    if any(r["supersedes_id"] == returned["id"] for r in state.get("ballot_returns", [])):
        raise ValueError("A corrected return supersedes this edition. Select the current retained return.")
    if _closed(state, returned["ballot_id"]):
        raise ValueError("Closed ballots retain their votes and closure. This return remains original evidence.")
    packet = _packet(state, returned["packet_id"])
    current = _vote(state, returned["ballot_id"], returned["person_id"])
    current_sha = engine.digest(current) if current else ""
    if payload["expected_vote_sha256"] != current_sha:
        raise ValueError("The recorded vote changed after preview. Review it before adopting the member return.")
    note = engine.text(payload["verification_note"], "Original sender and correction verification", True, 20000)
    response = returned["response"]
    vote = deepcopy(current) if current else engine.template("votes")
    vote.update({"id": current["id"] if current else "member-vote-" + engine.digest(
        {"project": state["id"], "ballot": returned["ballot_id"], "person": returned["person_id"]})[:32],
        "ballot_id": returned["ballot_id"], "person_id": returned["person_id"],
        "choice": response["choice"], "justification": response["justification"], "cast_at": response["cast_at"],
        "source_ids": list(dict.fromkeys((current["source_ids"] if current else []) + [returned["source_id"]])),
        "negative_resolution": "", "notification_at": "", "notification_evidence": ""})
    # Existing vote identity is preserved; prior responses/resolutions remain in history.
    vote["revision"] = current["revision"] + 1 if current else 1
    vote = engine.validate_record("votes", vote, state)
    snapshot = {"return_id": returned["id"], "response_sha256": returned["response_sha256"],
                "packet_sha256": packet["packet_sha256"], "before_vote": deepcopy(current),
                "after_vote": deepcopy(vote), "verification_note": note}
    adoption = {"id": record_id, "return_id": returned["id"], "ballot_id": returned["ballot_id"],
                "person_id": returned["person_id"], "vote_id": vote["id"], "recorded_at": engine.now(),
                "verification_note": note, "input_sha256": engine.digest(snapshot), "input_snapshot": snapshot}
    return adoption, vote


def status(state, ballot_id=None):
    ballots = [r for r in state["ballots"] if ballot_id is None or r["id"] == ballot_id]
    packets = state.get("ballot_packets", [])
    returns = state.get("ballot_returns", [])
    adoptions = state.get("ballot_adoptions", [])
    rows = []
    for ballot in ballots:
        members = []
        for member in ballot["roster"]:
            if not member["voting"]:
                continue
            chosen = [p for p in packets if p["ballot_id"] == ballot["id"] and p["person_id"] == member["person_id"]]
            packet_ids = {p["id"] for p in chosen}
            responses = [r for r in returns if r["packet_id"] in packet_ids]
            adopted = [a for a in adoptions if a["return_id"] in {r["id"] for r in responses}]
            current = _vote(state, ballot["id"], member["person_id"])
            members.append({"member": deepcopy(member), "packets": [
                {k: p[k] for k in ("id", "title", "prepared_at", "packet_sha256")} for p in chosen],
                "returns": [{k: deepcopy(r[k]) for k in ("id", "packet_id", "received_at", "supersedes_id",
                    "source_id", "source_sha256", "response_sha256", "response")} for r in responses],
                "adoptions": deepcopy(adopted), "current_vote": deepcopy(current),
                "current_vote_sha256": engine.digest(current) if current else ""})
        rows.append({"ballot": deepcopy(ballot), "closed": _closed(state, ballot["id"]),
                     "members": members, "calculation": engine.calculate_ballot(engine.ballot_input(state, ballot["id"])),
                     "closures": deepcopy([r for r in state["ballot_closures"] if r["ballot_id"] == ballot["id"]])})
    return {"project_id": state["id"], "revision": state["revision"], "ballots": rows}


def validate_state(state):
    packets = state.get("ballot_packets", [])
    returns = state.get("ballot_returns", [])
    adoptions = state.get("ballot_adoptions", [])
    byid = {r["id"]: r for r in returns}
    for p in packets:
        snap = p["snapshot"]
        if engine.digest(snap) != p["packet_sha256"] or snap.get("schema") != PACKET_SCHEMA:
            raise ValueError("Member packet content or schema differs.")
        ballot = engine.record(state, "ballots", p["ballot_id"])
        edition = engine.record(state, "editions", p["edition_id"])
        member = next((r for r in ballot["roster"] if r["person_id"] == p["person_id"] and r["voting"]), None)
        if (snap.get("project_id") != state["id"] or snap.get("packet_id") != p["id"] or
                p["edition_id"] != ballot["edition_id"] or member != snap.get("member") or
                p["prepared_at"] != snap.get("prepared_at") or p["title"] != snap.get("title") or
                snap.get("source_edition_sha256") != edition["sha256"]):
            raise ValueError("Member packet lost its exact project, ballot, edition or frozen membership.")
        expected_ballot = {k: deepcopy(ballot[k]) for k in
                           ("id", "title", "edition_id", "opens", "closes", "method", "profile",
                            "source_procedure_id", "frozen_at", "snapshot_sha256")}
        if snap["ballot"] != expected_ballot or snap["edition"] != consultation._public_edition(edition):
            raise ValueError("The member packet no longer matches its frozen ballot and bilingual edition.")
    seen = set()
    successors = set()
    roots = set()
    for r in returns:
        packet = _packet(state, r["packet_id"])
        value = normalize_return(engine.canonical(r["response"]).encode(), packet)
        sha = engine.digest(value)
        if sha != r["response_sha256"] or r["id"] != "ballot-return-" + sha[:32] or sha in seen:
            raise ValueError("Retained ballot return identity or complete content differs.")
        seen.add(sha)
        if r["ballot_id"] != packet["ballot_id"] or r["person_id"] != packet["person_id"]:
            raise ValueError("Member return belongs to another ballot or person.")
        source = engine.record(state, "sources", r["source_id"])
        if source["sha256"] != r["source_sha256"] or not source["source_file_id"]:
            raise ValueError("Member return lost its retained original source.")
        previous = byid.get(r["supersedes_id"]) if r["supersedes_id"] else None
        if previous:
            if (previous["packet_id"] != r["packet_id"] or
                    previous["response_sha256"] != value["previous_response_sha256"] or
                    previous["response"]["response_id"] != value["response_id"] or
                    previous["response"]["response_revision"] + 1 != value["response_revision"] or
                    previous["id"] in successors):
                raise ValueError("Member correction history branches or changes identity.")
            successors.add(previous["id"])
        elif value["previous_response_sha256"] or r["supersedes_id"]:
            raise ValueError("Member correction is missing its original predecessor.")
        else:
            if r["packet_id"] in roots or value["response_revision"] != 1:
                raise ValueError("A member packet must have exactly one original response chain.")
            roots.add(r["packet_id"])
    used = set()
    for a in adoptions:
        returned = byid[a["return_id"]]
        snap = a["input_snapshot"]
        vote = snap.get("after_vote", {})
        before = snap.get("before_vote")
        if (a["return_id"] in used or engine.digest(snap) != a["input_sha256"] or
                snap.get("return_id") != returned["id"] or snap.get("response_sha256") != returned["response_sha256"] or
                snap.get("packet_sha256") != _packet(state, returned["packet_id"])["packet_sha256"] or
                snap.get("verification_note") != a["verification_note"]):
            raise ValueError("Ballot adoption no longer matches its original return and verification.")
        used.add(a["return_id"])
        for k in ("ballot_id", "person_id"):
            if a[k] != returned[k] or vote.get(k) != returned[k]:
                raise ValueError("Ballot adoption changes voter identity.")
        if a["vote_id"] != vote.get("id") or (before and before["id"] != vote["id"]):
            raise ValueError("Ballot adoption changes the existing recorded vote identity.")
        if engine.validate_record("votes", vote, state) != vote:
            raise ValueError("Adopted vote is not a complete original-engine record.")
        for k in ("choice", "justification", "cast_at"):
            if vote[k] != returned["response"][k]:
                raise ValueError("Adopted vote differs from the retained member declaration.")
        expected_sources=list(dict.fromkeys((before["source_ids"] if before else [])+[returned["source_id"]]))
        if vote["source_ids"] != expected_sources or vote["revision"] != (before["revision"]+1 if before else 1):
            raise ValueError("Adopted vote lost its exact original sources or revision.")
        if before:
            if (before["ballot_id"] != returned["ballot_id"] or before["person_id"] != returned["person_id"] or
                    engine.validate_record("votes",before,state) != before):
                raise ValueError("The prior vote snapshot belongs to another ballot or person.")
        elif vote["id"] != "member-vote-"+engine.digest({"project":state["id"],"ballot":returned["ballot_id"],"person":returned["person_id"]})[:32]:
            raise ValueError("The first adopted vote identity differs from its original ballot and person.")
        if vote["negative_resolution"] or vote["notification_at"] or vote["notification_evidence"]:
            raise ValueError("A new return cannot inherit another vote's resolution or notification.")
    return state


def validate_originals(state, originals):
    for r in state.get("ballot_returns", []):
        source = engine.record(state, "sources", r["source_id"])
        raw = originals[source["source_file_id"]]
        value = normalize_return(raw, _packet(state, r["packet_id"]))
        if hashlib.sha256(raw).hexdigest() != r["source_sha256"] or value != r["response"]:
            raise ValueError("Original ballot return bytes differ from the retained complete declaration.")


def packet_files(state, packet_id):
    packet = _packet(state, packet_id)
    payload = {"packet_sha256": packet["packet_sha256"], "packet": packet["snapshot"]}
    data = engine.canonical(payload).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    template = (ROOT / "web/member-ballot.html").read_text(encoding="utf-8")
    for marker in ("__BALLOT_STYLE__", "__BALLOT_DATA__", "__BALLOT_SCRIPT__"):
        if template.count(marker) != 1:
            raise ValueError("The complete installed member ballot template is missing.")
    page = template.replace("__BALLOT_STYLE__", (ROOT / "web/member-ballot.css").read_text(encoding="utf-8"))
    page = page.replace("__BALLOT_DATA__", data).replace("__BALLOT_SCRIPT__", (ROOT / "web/member-ballot.js").read_text(encoding="utf-8"))
    guide = (ROOT / "web/member-ballot-guide.txt").read_bytes()
    return {"member-ballot.html": page.encode(), "packet.json": (engine.canonical(payload) + "\n").encode(),
            "READ-ME.txt": guide}


def _table(headings, rows):
    return "<div class='table-wrap'><table><thead><tr>" + "".join("<th>" + html.escape(str(x)) + "</th>" for x in headings) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + html.escape(str(x)) + "</td>" for x in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def decision_files(state, ballot_id, originals):
    ballot = engine.record(state, "ballots", ballot_id)
    snapshot = engine.ballot_input(state, ballot_id)
    packets = [p for p in state.get("ballot_packets", []) if p["ballot_id"] == ballot_id]
    returned = [r for r in state.get("ballot_returns", []) if r["ballot_id"] == ballot_id]
    adopted = [a for a in state.get("ballot_adoptions", []) if a["ballot_id"] == ballot_id]
    closures = [r for r in state["ballot_closures"] if r["ballot_id"] == ballot_id]
    closure_ids = {r["id"] for r in closures}
    procedures = [r for r in state["procedural_reviews"] if r["closure_id"] in closure_ids]
    publications = [r for r in state["publications"] if r["closure_id"] in closure_ids]
    result = {"schema": DOSSIER_SCHEMA, "project_id": state["id"], "project_revision": state["revision"],
              "mode": state["mode"], "ballot": snapshot, "current_calculation": engine.calculate_ballot(snapshot),
              "member_packets": packets, "member_returns": returned, "vote_adoptions": adopted,
              "authority_closures": closures, "procedural_reviews": procedures, "publications": publications,
              "audience": "Private secretariat handover; member identities and original returns are included."}
    files = {"decision.json": (engine.canonical(result) + "\n").encode()}
    sources = set()
    for r in returned:
        sources.add(r["source_id"])
    for row in snapshot["votes"] + closures + procedures + publications:
        sources.update(row.get("source_ids", []))
        sources.update(row.get("authority_source_ids", []))
        sources.update(row.get("appointment_source_ids", []))
    source_rows = []
    for sid in sorted(sources):
        source = engine.record(state, "sources", sid)
        fid = source["source_file_id"]
        if not fid:
            source_rows.append({"source": deepcopy(source), "path": None})
            continue
        meta = next(m for m in state["files"] if m["id"] == fid)
        raw = originals[fid]
        if len(raw) != meta["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
            raise ValueError("Decision source differs from its retained original.")
        path = "originals/" + fid + "/" + meta["filename"]
        files[path] = raw
        source_rows.append({"source": deepcopy(source), "file": deepcopy(meta), "path": path})
    files["sources.json"] = (engine.canonical(source_rows) + "\n").encode()
    rows = [[r["person_name"], r["interest"], "eligible" if r["voting"] else "non-voting"] for r in ballot["roster"]]
    votes = [[v["person_id"], v["choice"], v["justification"], v["cast_at"], v["negative_resolution"], v["notification_evidence"]] for v in snapshot["votes"]]
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["person_id", "choice", "justification", "cast_at", "negative_resolution", "notification_evidence"])
    for row in votes:
        writer.writerow([("'" + x) if isinstance(x, str) and x.lstrip().startswith(("=", "+", "-", "@")) else x for x in row])
    files["recorded-votes.csv"] = output.getvalue().encode("utf-8-sig")
    body = "<h1>" + html.escape(ballot["title"]) + "</h1><p>Private committee decision handover · " + html.escape(state["title"]) + \
        "</p><p>This handover preserves recorded member declarations, the original calculation and the authority's separate decision.</p>"
    body += "<h2>Frozen membership</h2>" + _table(["Member", "Interest", "Eligibility"], rows)
    body += "<h2>Recorded votes</h2>" + _table(["Member ID", "Choice", "Justification", "Cast", "Negative resolution", "Notification"], votes)
    body += "<h2>Authority closures</h2>" + _table(["Decision", "Authority", "Rationale", "Recorded"], [
        [r["recorded_decision"], r["authority"], r["rationale"], r["recorded_at"]] for r in closures])
    body += "<h2>Independent procedural review</h2>" + _table(["Reviewer", "Decision", "Rationale"], [
        [r["reviewer_id"], r["decision"], r["rationale"]] for r in procedures])
    body += "<h2>Publication records</h2>" + _table(["Version", "Status", "Issued", "Authority"], [
        [r["version"], r["status"], r["issued"], r["authority"]] for r in publications])
    body += "<p>decision.json retains every frozen packet, corrected return, adoption before/after and exact closure input. "
    body += "sources.json indexes the complete retained original files. Restore the separately selected full private project archive for editable continuation.</p>"
    files["decision.html"] = consultation._document(ballot["title"], body).encode()
    return files
