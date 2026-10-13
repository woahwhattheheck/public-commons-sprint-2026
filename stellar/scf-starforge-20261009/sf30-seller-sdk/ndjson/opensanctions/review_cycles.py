"""MIT. Finite review cycles in the original OpenSanctions workspace.

The original case engine owns identity/relevance decisions. This module freezes
their review population and records assignment, completion and supervisor review.
No provider is called and no screening or legal conclusion is inferred.
"""
from __future__ import annotations
from contextlib import nullcontext
import copy
from datetime import datetime, timezone
import html
import json
import time
import uuid
from model import InputError, exact_id, text, sha, json_bytes, load_json, stable

SCHEMA = "starforge.opensanctions-review-cycle.v1"
MAX_EVENTS = 50000
MAX_CASES = 10000
MAX_STATE_BYTES = 96 * 1024 * 1024


def need(condition, message):
    if not condition:
        raise InputError(message)


def keys(value, expected, name):
    need(isinstance(value, dict) and set(value) == set(expected), name + " fields differ from the selected contract")
    return value


def actor(value):
    keys(value, ("id", "name"), "Reviewer")
    text(value["id"], "Reviewer ID", 160); text(value["name"], "Reviewer name", 160)
    return value


def instant(value, name="Time", nullable=False):
    if nullable and value is None:
        return None
    need(isinstance(value, str), name + " must be a UTC ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise InputError(name + " must be a UTC ISO timestamp") from None
    need(parsed.tzinfo is not None and value.endswith("Z") and parsed.utcoffset().total_seconds() == 0,
         name + " must have a UTC Z suffix")
    return parsed.timestamp()


def request_id(value):
    try:
        need(str(uuid.UUID(value)) == value, "Use the original canonical request UUID")
    except (ValueError, TypeError, AttributeError):
        raise InputError("Use the original canonical request UUID") from None
    return sha(("review-cycle-request:" + value).encode())


def evidence(domain, ids):
    need(isinstance(ids, list) and len(ids) <= 128 and len(set(ids)) == len(ids),
         "Evidence must be up to 128 distinct retained original object IDs")
    result = []
    for ident in ids:
        exact_id(ident)
        descriptor = domain._one("objects", ident)
        path = domain.object_path(ident)
        need(path.stat().st_size == descriptor["bytes"], "Retained review evidence size changed")
        result.append(descriptor)
    return result


def case_event(domain, revision, verified=None):
    """Verify the complete original ancestry; cache only within this replay call."""
    exact_id(revision)
    verified = {} if verified is None else verified
    if revision in verified:
        return verified[revision]
    cursor, seen, pending, identity, following_at = revision, set(), [], None, None
    while cursor is not None:
        exact_id(cursor)
        need(cursor not in seen, "Original case history contains a cycle")
        seen.add(cursor)
        if cursor in verified:
            event = verified[cursor]
        else:
            row = domain.db.execute("SELECT body FROM os_case_events WHERE id=?", (cursor,)).fetchone()
            need(row is not None, "The complete original case decision history is required")
            event = load_json(row[0])
            value = event.get("value", {})
            need(event.get("id") == cursor == value.get("revision") and event.get("case") == value.get("id"),
                 "Original case decision binding differs")
            core = {k: v for k, v in value.items() if k != "revision"}
            need(sha(json_bytes(core)) == cursor and event.get("previous") == value.get("previousRevision"),
                 "Original case decision bytes differ from their revision")
            pending.append((cursor, event))
        value = event["value"]
        selected = (value["id"], value["portfolioKey"], value["counterpartyId"])
        if identity is None:
            identity = selected
        need(selected == identity, "A case predecessor belongs to another customer case")
        need(following_at is None or value["updatedAt"] <= following_at,
             "Original case decision history has reversed observation times")
        following_at = value["updatedAt"]
        if cursor in verified:
            break  # This complete same-case chain was already verified under this mutex.
        cursor = event["previous"]
    for ident, event in pending:
        verified[ident] = event
    return verified[revision]


def source_basis(domain, comparison, cases, verified=None):
    original = domain._one("comparisons", comparison)
    before = domain._one("editions", original["before"])
    after = domain._one("editions", original["after"])
    for case in cases:
        need(case["dataset"] == original["dataset"] and not case.get("mergedInto"),
             "Cycle population must belong to the selected comparison dataset")
        need(stable(case_event(domain, case["revision"], verified)["value"]) == stable(case),
             "A cycle population case differs from its original saved decision")
    population = domain.impacted_cases(comparison, _cases=cases)
    population["rows"] = sorted(population["rows"], key=lambda row: row["case"]["id"])
    for row in population["rows"]:
        row["changes"] = sorted(row["changes"])
    return {"comparison": original, "beforeEdition": before, "afterEdition": after,
            "populationScope": {"dataset": original["dataset"], "selection": "All retained unmerged cases for this dataset at creation"},
            "caseSnapshots": sorted(cases, key=lambda case: case["id"]), "population": population}


def _envelope(command):
    keys(command, ("requestId", "cycleId", "expectedVersion", "action", "actor", "at", "body"), "Cycle command")
    request_id(command["requestId"]); actor(command["actor"]); instant(command["at"])
    need(type(command["expectedVersion"]) is int and command["expectedVersion"] >= 0, "Expected version must be an integer")
    need(command["action"] in {"create", "assign", "complete", "reopen", "signoff"}, "Select a cycle operation")
    need(isinstance(command["body"], dict), "Cycle operation body must be an object")


def _reduce(domain, current, command, observations, verified=None):
    """Deterministic replay from original commands and verified observed case versions."""
    _envelope(command)
    action, body = command["action"], command["body"]
    when = instant(command["at"])
    if current is None:
        need(action == "create" and command["cycleId"] is None and command["expectedVersion"] == 0,
             "Create a cycle before changing it")
        creation_fields = ("label", "comparison", "caseIds", "scopeNote", "supervisor", "dueAt")
        if body.get("sourceKind") is not None:
            need(body["sourceKind"] == "portfolio_refresh", "Choose the supported customer portfolio cycle kind")
            creation_fields += ("sourceKind",)
        keys(body, creation_fields, "New cycle")
        text(body["label"], "Cycle label", 240); text(body["scopeNote"], "Scope note", 8000)
        actor(body["supervisor"]); instant(body["dueAt"], "Cycle due time", True)
        exact_id(body["comparison"])
        keys(observations, ("basis",), "Cycle creation observation")
        basis = observations["basis"]
        need(isinstance(basis, dict) and isinstance(basis.get("caseSnapshots"), list) and
             len(basis["caseSnapshots"]) <= MAX_CASES, "Cycle population exceeds the supported complete scope")
        need(len({c["id"] for c in basis["caseSnapshots"]}) == len(basis["caseSnapshots"]), "Cycle case population contains duplicates")
        need(basis["comparison"]["createdAt"] <= when and
             all(case["updatedAt"] <= when for case in basis["caseSnapshots"]),
             "Cycle creation cannot precede its original comparison or frozen case decisions")
        if body.get("sourceKind") == "portfolio_refresh":
            import portfolio_review_cycles
            expected_basis = portfolio_review_cycles.basis(domain, body["comparison"], basis["caseSnapshots"], verified)
        else:
            expected_basis = source_basis(domain, body["comparison"], basis["caseSnapshots"], verified)
        need(stable(expected_basis) == stable(basis), "Frozen cycle source or case population changed")
        rows = basis["population"]["rows"]
        ids = body["caseIds"]
        if ids is None:
            ids = [row["case"]["id"] for row in rows]
        need(isinstance(ids, list) and len(ids) <= MAX_CASES and len(set(ids)) == len(ids),
             "Select distinct cases from the complete impact population")
        for ident in ids:
            exact_id(ident)
        need(set(ids) <= {r["case"]["id"] for r in rows}, "A selected case is outside the frozen comparison population")
        ident = request_id(command["requestId"])
        items = {r["case"]["id"]: {"caseId": r["case"]["id"], "impact": r, "assignment": None,
                                   "completion": None, "reopened": None}
                 for r in rows if r["case"]["id"] in ids}
        state = {"schema": SCHEMA, "id": ident, "label": body["label"], "scopeNote": body["scopeNote"],
                 "supervisor": body["supervisor"], "dueAt": body["dueAt"], "createdAt": command["at"],
                 "createdBy": command["actor"], "basis": basis, "items": items,
                 "excludedCaseIds": sorted(set(r["case"]["id"] for r in rows) - set(ids)),
                 "status": "OPEN", "reports": [], "version": 0, "revision": None}
    else:
        state = copy.deepcopy(current)
        need(action != "create" and command["cycleId"] == state["id"] and
             command["expectedVersion"] == state["version"], "The cycle changed; inspect its current version before a new command")
        need(when >= instant(state["updatedAt"]), "A cycle operation cannot precede its retained history")
        if state["status"] == "SIGNED":
            need(action == "reopen", "Reopen a selected case before changing a signed cycle")
        if action in {"assign", "complete", "reopen"}:
            ident = body.get("caseId")
            need(ident in state["items"], "Select a case from this frozen cycle")
            item = state["items"][ident]
        if action == "assign":
            keys(body, ("caseId", "reviewer", "dueAt", "note"), "Assignment")
            need(command["actor"]["id"] == state["supervisor"]["id"], "The selected cycle supervisor assigns reviews")
            actor(body["reviewer"]); instant(body["dueAt"], "Assignment due time", True); text(body["note"], "Assignment note", 8000, True)
            need(observations == {}, "Assignment has unexpected observations")
            item["assignment"] = {**body, "at": command["at"], "by": command["actor"], "requestId": command["requestId"]}
            item["completion"] = None
        elif action == "complete":
            customer_cycle = state["basis"].get("sourceKind") == "portfolio_refresh"
            completion_fields = ("caseId", "caseRevision", "disposition", "note", "evidence")
            if customer_cycle:
                completion_fields += ("portfolioReviewRequestId",)
            keys(body, completion_fields, "Case completion")
            need(item["assignment"] is not None and command["actor"]["id"] == item["assignment"]["reviewer"]["id"],
                 "The assigned reviewer records this completion")
            text(body["note"], "Review note", 8000)
            need(body["disposition"] in {"REVIEWED", "FOLLOW_UP"}, "Choose reviewed or follow-up")
            observation_fields = ("caseEvent", "evidence")
            if customer_cycle:
                observation_fields += ("portfolioRefreshEvent",)
            keys(observations, observation_fields, "Review observations")
            original = case_event(domain, body["caseRevision"], verified)
            need(stable(original) == stable(observations["caseEvent"]), "The retained decision observation changed")
            need(stable(evidence(domain, body["evidence"])) == stable(observations["evidence"]), "Review evidence changed")
            case, frozen = original["value"], item["impact"]["case"]
            need(case["id"] == ident and case["portfolioKey"] == frozen["portfolioKey"] and
                 case["counterpartyId"] == frozen["counterpartyId"] and case["dataset"] == frozen["dataset"],
                 "Completion must reference the original customer case")
            need(case["updatedAt"] <= when, "The case decision occurs after the supplied review time")
            if customer_cycle:
                import portfolio_review_cycles
                portfolio_review_cycles.verify_completion(domain, state, item, command,
                    observations["portfolioRefreshEvent"], case)
            if body["disposition"] == "REVIEWED" and not customer_cycle:
                need(case["edition"] == state["basis"]["comparison"]["after"], "Review against the cycle's exact following source edition")
                need(stable(case["monitoring"]) == stable(frozen["monitoring"]),
                     "The monitoring scope changed; retain follow-up or start a cycle for that explicit policy")
                allowed = {frozen["candidateId"], *item["impact"]["currentIds"]}
                need(case["candidateId"] in allowed, "The reviewed candidate is outside the frozen case identity chain")
                need(case["resolution"] != "undecided" or not item["impact"]["identityReview"],
                     "The required identity review remains undecided")
                need(case["resolution"] == "different_entity" or case["relevance"] != "undecided" or not item["impact"]["relevanceReview"],
                     "The required relevance review remains undecided")
                need(case["resolution"] != "same_entity" or len(case.get("resolvedCurrentIds", [])) == 1,
                     "The selected identity remains absent or ambiguous; retain follow-up")
            item["completion"] = {**body, "at": command["at"], "by": command["actor"],
                                  "requestId": command["requestId"], "caseEvent": original,
                                  "evidenceObjects": observations["evidence"],
                                  **({"portfolioRefreshEvent": observations["portfolioRefreshEvent"]} if customer_cycle else {})}
        elif action == "reopen":
            keys(body, ("caseId", "reason"), "Reopen")
            text(body["reason"], "Reopen reason", 8000)
            allowed = {state["supervisor"]["id"]}
            if state["status"] != "SIGNED" and item["assignment"]:
                allowed.add(item["assignment"]["reviewer"]["id"])
            need(command["actor"]["id"] in allowed, "The reviewer or supervisor reopens an active review; only the supervisor reopens a signed cycle")
            need(observations == {}, "Reopen has unexpected observations")
            item["completion"] = None
            item["reopened"] = {**body, "at": command["at"], "by": command["actor"], "requestId": command["requestId"]}
            state["status"] = "OPEN"
        elif action == "signoff":
            keys(body, ("note", "evidence"), "Supervisor sign-off")
            text(body["note"], "Supervisor note", 8000)
            need(command["actor"]["id"] == state["supervisor"]["id"], "Only the selected cycle supervisor signs this report")
            keys(observations, ("caseRevisions", "evidence"), "Sign-off observations")
            need(set(observations["caseRevisions"]) == set(state["items"]), "Sign-off must observe every selected case")
            need(stable(evidence(domain, body["evidence"])) == stable(observations["evidence"]), "Supervisor evidence changed")
            for ident, item in state["items"].items():
                done = item["completion"]
                need(done is not None and done["disposition"] == "REVIEWED", "Every selected case needs a completed review before sign-off")
                need(done["caseRevision"] == observations["caseRevisions"][ident],
                     "A case decision changed after completion; reopen and review that case")
                case_event(domain, done["caseRevision"], verified)
            report = {"schema": SCHEMA + ".report", "cycleId": state["id"], "version": state["version"] + 1,
                      "label": state["label"], "scopeNote": state["scopeNote"],
                      "createdAt": state["createdAt"], "signedAt": command["at"], "supervisor": command["actor"],
                      "note": body["note"], "evidence": observations["evidence"],
                      "basis": state["basis"], "items": copy.deepcopy(state["items"]),
                      "excludedCaseIds": state["excludedCaseIds"],
                      "meaning": "Completion of the selected customer review workflow; identity and relevance remain the original recorded decisions."}
            report["sha256"] = sha(json_bytes(report))
            state["reports"].append(report); state["status"] = "SIGNED"
    state["version"] += 1
    state["updatedAt"] = command["at"]; state["updatedBy"] = command["actor"]
    state["revision"] = sha(json_bytes({k: v for k, v in state.items() if k != "revision"}))
    need(len(json_bytes(state)) <= MAX_STATE_BYTES, "The complete review cycle exceeds 96 MiB; select a smaller explicit cycle scope")
    return state


def _receipt(state, command):
    return {"schema": SCHEMA + ".result", "requestId": command["requestId"], "cycleId": state["id"],
            "version": state["version"], "revision": state["revision"], "status": state["status"],
            "action": command["action"], "caseId": command["body"].get("caseId"),
            "reportSha256": state["reports"][-1]["sha256"] if command["action"] == "signoff" else None}


def replay(domain, rows=None):
    if rows is None:
        rows = []
        for row in domain.db.execute("SELECT id,body FROM os_cycle_events"):
            body = load_json(row[1])
            need(body.get("id") == row[0], "A cycle event differs from its retained row identity")
            rows.append(body)
    need(len(rows) <= MAX_EVENTS, "Complete review-cycle history exceeds 50,000 commands")
    states, seen, verified = {}, set(), {}
    for event in sorted(rows, key=lambda e: (e.get("cycleId", ""), e.get("version", -1))):
        keys(event, ("id", "cycleId", "version", "previous", "command", "observations", "result", "eventSha256"), "Cycle event")
        need(type(event["version"]) is int and event["version"] > 0, "Cycle event version must be a positive integer")
        command = event["command"]; _envelope(command)
        ident = request_id(command["requestId"])
        need(ident == event["id"] and ident not in seen, "Cycle request identities repeat or differ")
        seen.add(ident)
        current = states.get(event["cycleId"])
        need(event["previous"] == (current["revision"] if current else None), "Cycle history has a missing or changed predecessor")
        need(sha(json_bytes({k: v for k, v in event.items() if k != "eventSha256"})) == event["eventSha256"],
             "Cycle event hash changed")
        following = _reduce(domain, current, command, event["observations"], verified)
        need(following["id"] == event["cycleId"] and following["version"] == event["version"] and
             stable(_receipt(following, command)) == stable(event["result"]), "Cycle command/result replay differs")
        states[following["id"]] = following
    return states


def command(domain, value, *, _commit=True):
    if not _commit and not domain.db.in_transaction:
        raise InputError("The internal cycle writer requires its original caller-owned transaction")
    _envelope(value)
    ident = request_id(value["requestId"])
    with domain.mutex:
        states = replay(domain)
        old = domain.db.execute("SELECT body FROM os_cycle_events WHERE id=?", (ident,)).fetchone()
        if old:
            event = load_json(old[0])
            need(stable(event["command"]) == stable(value), "This original request UUID has different command bytes")
            return event["result"]
        need(instant(value["at"]) <= time.time() + 1, "Cycle command time cannot be in the future")
        need(domain.db.execute("SELECT COUNT(*) FROM os_cycle_events").fetchone()[0] < MAX_EVENTS,
             "Complete review history exceeds 50,000 commands")
        current = states.get(value["cycleId"])
        body, action = value["body"], value["action"]
        observations = {}
        if action == "create":
            if body.get("sourceKind") == "portfolio_refresh":
                import portfolio_review_cycles
                cases = portfolio_review_cycles.selected_cases(domain, body.get("comparison"))
                need(len(cases) <= MAX_CASES, "Complete retained case population exceeds the cycle's 10,000-case limit")
                observations = {"basis": portfolio_review_cycles.basis(domain, body.get("comparison"), cases)}
            else:
                comparison = domain._one("comparisons", body.get("comparison"))
                cases = [load_json(r[0]) for r in domain.db.execute("SELECT body FROM os_cases ORDER BY id")]
                cases = [case for case in cases if case["dataset"] == comparison["dataset"] and not case.get("mergedInto")]
                need(len(cases) <= MAX_CASES, "Complete retained case population exceeds the cycle's 10,000-case limit")
                observations = {"basis": source_basis(domain, body.get("comparison"), cases)}
        elif action == "complete":
            original = domain._one("cases", body.get("caseId"))
            need(original["revision"] == body.get("caseRevision"), "The case changed; inspect its current original decision")
            observations = {"caseEvent": case_event(domain, body["caseRevision"]), "evidence": evidence(domain, body.get("evidence"))}
            if current is not None and current["basis"].get("sourceKind") == "portfolio_refresh":
                import portfolio_review_cycles
                observations["portfolioRefreshEvent"] = portfolio_review_cycles.observe_completion(domain, body.get("portfolioReviewRequestId"))
        elif action == "signoff":
            need(current is not None, "Select the existing review cycle")
            observations = {"caseRevisions": {case: domain._one("cases", case)["revision"] for case in current["items"]},
                            "evidence": evidence(domain, body.get("evidence"))}
        following = _reduce(domain, current, value, observations)
        result = _receipt(following, value)
        event = {"id": ident, "cycleId": following["id"], "version": following["version"],
                 "previous": current["revision"] if current else None, "command": value,
                 "observations": observations, "result": result}
        event["eventSha256"] = sha(json_bytes(event))
        with domain.db if _commit else nullcontext():
            domain.db.execute("INSERT INTO os_cycle_events(id,body) VALUES(?,?)", (ident, json_bytes(event).decode()))
        return result


def request(domain, ident):
    with domain.mutex:
        replay(domain)
        row = domain.db.execute("SELECT body FROM os_cycle_events WHERE id=?", (request_id(ident),)).fetchone()
        return {"requestId": ident, "committed": row is not None, "event": load_json(row[0]) if row else None}


def _view(domain, state, now):
    value = copy.deepcopy(state)
    counts = {"selected": len(value["items"]), "assigned": 0, "reviewed": 0, "followUp": 0, "open": 0, "stale": 0, "overdue": 0}
    for ident, item in value["items"].items():
        current = domain._one("cases", ident)
        done = item["completion"]
        stale = done is not None and done["caseRevision"] != current["revision"]
        status = "STALE" if stale else ("REVIEWED" if done and done["disposition"] == "REVIEWED" else "FOLLOW_UP" if done else "OPEN")
        due = item["assignment"]["dueAt"] if item["assignment"] else value["dueAt"]
        item.update({"currentCaseRevision": current["revision"], "status": status,
                     "overdue": due is not None and instant(due) < now and status != "REVIEWED"})
        counts["assigned"] += item["assignment"] is not None
        counts[{"STALE": "stale", "REVIEWED": "reviewed", "FOLLOW_UP": "followUp", "OPEN": "open"}[status]] += 1
        counts["overdue"] += item["overdue"]
    value["counts"] = counts
    value["signoffReady"] = counts["reviewed"] == counts["selected"] and value["status"] == "OPEN"
    return value


def view(domain, ident=None):
    with domain.mutex:
        states = replay(domain)
        if ident is not None:
            need(ident in states, "Select a saved review cycle")
            return _view(domain, states[ident], time.time())
        rows = []
        for state in states.values():
            item = _view(domain, state, time.time())
            rows.append({k: item[k] for k in ("id", "label", "status", "version", "revision", "createdAt", "updatedAt", "supervisor", "dueAt", "counts")})
        return {"schema": SCHEMA, "rows": sorted(rows, key=lambda r: (r["createdAt"], r["id"]), reverse=True)}


def report(domain, ident, version):
    state = view(domain, ident)
    need(type(version) is int and version > 0, "Select the exact signed report version")
    for item in state["reports"]:
        if item["version"] == version:
            return item
    raise InputError("No signed report exists at this cycle version")


def report_html(domain, ident, version):
    original = report(domain, ident, version)
    esc = lambda value: html.escape(str(value), quote=True)
    rows = []
    for item in original["items"].values():
        decision, assignment = item["completion"], item["assignment"]
        case = decision["caseEvent"]["value"]
        rows.append("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in (
            case["counterpartyId"], case["candidateId"], assignment["reviewer"]["name"],
            case["resolution"], case["relevance"], decision["note"], decision["at"])) + "</tr>")
    body = json.dumps(original, ensure_ascii=False, indent=2)
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Source monitoring review cycle</title><style>body{font:16px/1.55 system-ui,sans-serif;margin:2rem;color:#171717;background:#fff}'
            'main{max-width:1200px;margin:auto}h1{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;'
            'padding:.6rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}.scroll{overflow:auto}pre{white-space:pre-wrap;'
            'overflow-wrap:anywhere;background:#eee;padding:1rem}dt{font-weight:700}dd{margin:0 0 .6rem}a{color:#222}</style><main><h1>' +
            esc(original["label"]) + '</h1><p>' + esc(original["meaning"]) + '</p><dl><dt>Scope</dt><dd>' +
            esc(original["scopeNote"]) + '</dd><dt>Source comparison</dt><dd>' + esc(original["basis"]["comparison"]["id"]) +
            '</dd><dt>Supervisor</dt><dd>' + esc(original["supervisor"]["name"]) + ' · ' + esc(original["signedAt"]) +
            '</dd><dt>Report version</dt><dd>' + str(original["version"]) + '</dd><dt>Supervisor note</dt><dd>' +
            esc(original["note"]) + '</dd><dt>Selected / excluded cases</dt><dd>' + str(len(original["items"])) + ' / ' +
            str(len(original["excludedCaseIds"])) + '</dd></dl><div class="scroll"><table><thead><tr>' +
            ''.join('<th>' + x + '</th>' for x in ('Counterparty', 'Candidate', 'Reviewer', 'Identity', 'Relevance', 'Review note', 'Completed')) +
            '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div><details><summary>Complete original report and source bindings</summary><pre>' +
            esc(body) + '</pre></details></main></html>')
