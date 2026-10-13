"""MIT. Explicit customer portfolio refresh in the original Source Monitoring store.

Original FtM differences do not decide identity or relevance. Named reviewers
retain an old case or continue that same case against a selected new portfolio.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import html
import time

from model import (InputError, json_bytes, load_json, sha, stable, exact_id, text,
                   bounded_int, entity_changes, RESOLUTION, RELEVANCE)

SCHEMA = "starforge.customer-portfolio-refresh.v1"
EVENT = "starforge.customer-portfolio-refresh-review.v1"
DECISIONS = {"retain", "continue", "reviewed"}


def _digest(value):
    return sha(stable(value))


def _portfolio(domain, ident):
    value = domain._one("portfolios", exact_id(ident))
    expected = sha(json_bytes({"kind": "portfolio", "key": value["key"], "source": value["source"]}))
    if expected != ident:
        raise InputError("The original customer portfolio identity changed")
    return value


def _pointer(entry):
    if entry is None:
        return None
    return {"line": entry["line"], "record": entry["record"], "semanticSha256": entry["semantic"]}


def _population(domain, before, after):
    left, right = domain._scope_entities(before), domain._scope_entities(after)
    result = []
    for key in sorted(set(left) | set(right)):
        l, r = left.get(key), right.get(key)
        previous, current = l["entity"] if l else None, r["entity"] if r else None
        properties, fields = entity_changes(previous, current)
        metadata = [{"field": name, "beforePresent": name in (previous or {}),
                     "afterPresent": name in (current or {}),
                     "before": (previous or {}).get(name), "after": (current or {}).get(name)}
                    for name in fields]
        if l is None:
            kind = "added"
        elif r is None:
            kind = "removed"
        elif l["semantic"] == r["semantic"]:
            kind = "unchanged"
        else:
            kind = "changed"
        result.append({"entityId": key, "caption": (current or previous).get("caption", key),
                       "kind": kind, "before": _pointer(l), "after": _pointer(r),
                       "properties": properties, "metadata": metadata,
                       "meaningfulProperties": [p["property"] for p in properties if not p["orderOnly"]],
                       "interpretation": "Source attributes only; no identity or relevance conclusion"})
    return result


def prepare(domain, before, after):
    """Prepare the whole exact population; no case or provider changes."""
    with domain.mutex:
        left, right = _portfolio(domain, before), _portfolio(domain, after)
        if before == after or left["key"] != right["key"]:
            raise InputError("Select two distinct original portfolios with the same customer key")
        identity = {"schema": SCHEMA, "before": before, "after": after,
                    "portfolioKey": left["key"], "sources": [left["source"], right["source"]],
                    "builds": [left["build"], right["build"]]}
        ident = _digest(identity)
        prior = domain.db.execute("SELECT body FROM os_portfolio_refreshes WHERE id=?", (ident,)).fetchone()
        if prior:
            return _comparison(domain, ident)
        rows = _population(domain, before, after)
        original_sources = [{"side": side, "portfolio": deepcopy(original),
                             "source": deepcopy(domain.ws.source(original["source"]))}
                            for side, original in (("before", left), ("after", right))]
        record = {"schema": SCHEMA, "id": ident, "identity": identity,
                  "before": before, "after": after, "portfolioKey": left["key"],
                  "rows": rows, "originalSources": original_sources,
                  "counts": dict(Counter(row["kind"] for row in rows)),
                  "population": len(rows), "createdAt": time.time()}
        record["contentSha256"] = _digest(record)
        with domain.db:
            domain._put("portfolio_refreshes", record)
        return record


def _comparison(domain, ident, verify=True):
    value = domain._one("portfolio_refreshes", exact_id(ident))
    raw = deepcopy(value); declared = raw.pop("contentSha256", None)
    if value.get("schema") != SCHEMA or _digest(raw) != declared or _digest(value.get("identity")) != ident:
        raise InputError("The retained portfolio comparison changed")
    left, right = _portfolio(domain, value["before"]), _portfolio(domain, value["after"])
    expected = {"schema": SCHEMA, "before": left["id"], "after": right["id"],
                "portfolioKey": left["key"], "sources": [left["source"], right["source"]],
                "builds": [left["build"], right["build"]]}
    if left["key"] != right["key"] or left["id"] == right["id"] or value["identity"] != expected:
        raise InputError("The retained comparison no longer binds its original customer sources")
    captured_sources = value.get("originalSources")
    if not isinstance(captured_sources, list) or len(captured_sources) != 2:
        raise InputError("The comparison lost its exact original customer source descriptors")
    for index, (side, original) in enumerate((("before", left), ("after", right))):
        captured = captured_sources[index]
        current_source = domain.ws.source(original["source"])
        if (captured.get("side") != side or stable(captured.get("portfolio")) != stable(original)
                or any(stable(captured.get("source", {}).get(key)) != stable(current_source.get(key))
                       for key in ("id", "bytes", "inventory"))):
            raise InputError("The retained comparison source bytes or inventory changed")
    if verify:
        rows = _population(domain, left["id"], right["id"])
        if stable(rows) != stable(value["rows"]) or value["population"] != len(rows) or value["counts"] != dict(Counter(row["kind"] for row in rows)):
            raise InputError("The full original counterparty population differs")
    return value


def _request(value):
    if not isinstance(value, dict):
        raise InputError("Supply one original portfolio review request")
    allowed = {"requestId", "comparisonId", "entityId", "caseId", "expectedCaseRevision",
               "decision", "reviewer", "reason", "resolution", "relevance", "matchRequest"}
    if set(value) - allowed:
        raise InputError("Use the supported portfolio refresh review fields")
    request = deepcopy(value)
    text(request.get("requestId"), "Request id", 160)
    exact_id(request.get("comparisonId"))
    text(request.get("entityId"), "Original counterparty id", 512)
    text(request.get("reviewer"), "Reviewer", 160)
    text(request.get("reason"), "Reason", 8000)
    if request.get("decision") not in DECISIONS:
        raise InputError("Explicitly retain the old case, continue it, or record a source review")
    if request["decision"] in {"retain", "continue"}:
        exact_id(request.get("caseId")); exact_id(request.get("expectedCaseRevision"))
    elif any(name in request for name in ("caseId", "expectedCaseRevision")):
        raise InputError("A source-only review does not change or mark an existing case")
    if request["decision"] == "continue":
        if request.get("resolution") not in RESOLUTION or request.get("relevance") not in RELEVANCE:
            raise InputError("Choose explicit separate identity and relevance decisions for the continued case")
        if request.get("matchRequest") is not None:
            exact_id(request["matchRequest"])
    elif any(name in request for name in ("resolution", "relevance", "matchRequest")):
        raise InputError("Case decisions are only supplied when explicitly continuing that case")
    return request


def _event_id(request_id):
    return _digest({"schema": EVENT, "requestId": text(request_id, "Request id", 160)})


def _case_revision(domain, revision, case_id):
    # The original read-only verifier checks the complete predecessor chain,
    # event.previous, case identity and chronological revision custody.
    from review_cycles import case_event
    event = case_event(domain, revision)
    value = event["value"]
    if value["id"] != case_id:
        raise InputError("The retained case revision belongs to a different case")
    return value


def _verify_event(domain, event, comparisons=None):
    request = _request(event.get("request"))
    if event.get("schema") != EVENT or event.get("id") != _event_id(request["requestId"]) or event.get("requestSha256") != _digest(request):
        raise InputError("The retained portfolio review request changed")
    raw = deepcopy(event); declared = raw.pop("eventSha256", None)
    if declared != _digest(raw):
        raise InputError("The retained portfolio review record changed")
    comparison = (comparisons or {}).get(request["comparisonId"]) or _comparison(domain, request["comparisonId"])
    rows = {row["entityId"]: row for row in comparison["rows"]}
    if request["entityId"] not in rows:
        raise InputError("A refresh review refers outside the original compared population")
    before = event.get("beforeCase")
    after = event.get("afterCase")
    if request["decision"] == "reviewed":
        if before is not None or after is not None:
            raise InputError("A source-only review contains an unexpected case mutation")
    else:
        if before is None or stable(_case_revision(domain, request["expectedCaseRevision"], request["caseId"])) != stable(before):
            raise InputError("The refresh review lost its captured original case")
        if before["portfolio"] != comparison["before"] or before["portfolioKey"] != comparison["portfolioKey"] or before["counterpartyId"] != request["entityId"]:
            raise InputError("The captured case belongs to a different portfolio or counterparty")
        if request["decision"] == "retain":
            if after is not None:
                raise InputError("A retain decision must leave the original case unchanged")
        else:
            if after is None or rows[request["entityId"]]["after"] is None:
                raise InputError("An absent counterparty cannot receive an automatic case continuation")
            if stable(_case_revision(domain, after["revision"], before["id"])) != stable(after):
                raise InputError("The continued case revision is missing or changed")
            permitted = {"portfolio", "resolution", "relevance", "reason", "reviewer",
                         "matchRequest", "updatedAt", "previousRevision", "revision", "resolvedCurrentIds"}
            if any(stable(after.get(key)) != stable(before.get(key)) for key in (set(after) | set(before)) - permitted):
                raise InputError("Portfolio continuation changed an unrelated original case field")
            if (after["portfolio"] != comparison["after"] or after["previousRevision"] != before["revision"]
                    or after["resolution"] != request["resolution"] or after["relevance"] != request["relevance"]
                    or after["reviewer"] != request["reviewer"] or after["reason"] != request["reason"]
                    or after["matchRequest"] != request.get("matchRequest")):
                raise InputError("The continued case differs from its explicit review request")
            pointers = sorted({r["canonical"] for r in domain.aliases(after["edition"], after["candidateId"])})
            if after["resolvedCurrentIds"] != pointers:
                raise InputError("The continued case has different original candidate bindings")
            if after["matchRequest"]:
                match = domain._one("requests", after["matchRequest"])
                candidates = (match.get("response") or {}).get("summary", {}).get("candidates", {}).get(after["counterpartyId"], [])
                if match.get("state") != "RECEIVED" or match.get("portfolio") != comparison["after"] or after["candidateId"] not in candidates:
                    raise InputError("The continued case lacks its exact selected native match response")
    expected_result = {"operationId": event["id"], "requestId": request["requestId"],
                       "comparisonId": comparison["id"], "entityId": request["entityId"],
                       "decision": request["decision"], "case": after or before,
                       "caseChanged": after is not None}
    if stable(event.get("result")) != stable(expected_result):
        raise InputError("The original refresh result changed")
    return event


def operation(domain, request_id):
    with domain.mutex:
        row = domain.db.execute("SELECT body FROM os_portfolio_refresh_events WHERE id=?", (_event_id(request_id),)).fetchone()
        if row is None:
            return {"requestId": request_id, "committed": False}
        event = _verify_event(domain, load_json(row[0]))
        return {"requestId": request_id, "committed": True, "event": event, "result": event["result"]}


def command(domain, value):
    request = _request(value)
    with domain.mutex:
        prior = operation(domain, request["requestId"])
        if prior["committed"]:
            if prior["event"]["requestSha256"] != _digest(request):
                raise InputError("The original request id is already bound to different review choices")
            return prior["result"]
        comparison = _comparison(domain, request["comparisonId"])
        row = next((row for row in comparison["rows"] if row["entityId"] == request["entityId"]), None)
        if row is None:
            raise InputError("Select an original counterparty from this complete comparison")
        # This is the original connection. Own one transaction for its native
        # case event and refresh event; the public case API cannot bypass commit.
        if domain.db.in_transaction:
            raise InputError("Finish the original workspace transaction before a refresh command")
        domain.db.execute("BEGIN IMMEDIATE")
        try:
            before = after = None
            if request["decision"] != "reviewed":
                before = domain._one("cases", request["caseId"])
                if before.get("mergedInto") or before["revision"] != request["expectedCaseRevision"]:
                    raise InputError("This case changed; reopen its current revision before reviewing")
                if before["portfolio"] != comparison["before"] or before["portfolioKey"] != comparison["portfolioKey"] or before["counterpartyId"] != request["entityId"]:
                    raise InputError("Review the exact case still bound to the selected original portfolio")
                if request["decision"] == "continue":
                    if row["after"] is None:
                        raise InputError("This counterparty is absent from the selected following portfolio; retain its case or review the original source")
                    after = domain._save_case(
                        portfolio_id=comparison["after"], counterparty_id=before["counterpartyId"],
                        candidate_id=before["candidateId"], edition_id=before["edition"],
                        resolution=request["resolution"], relevance=request["relevance"],
                        reason=request["reason"], reviewer=request["reviewer"],
                        match_request=request.get("matchRequest"), case_id=before["id"],
                        expected=before["revision"], monitoring=before["monitoring"], _commit=False)
            event = {"schema": EVENT, "id": _event_id(request["requestId"]),
                     "request": request, "requestSha256": _digest(request),
                     "createdAt": time.time(), "beforeCase": before, "afterCase": after}
            event["result"] = {"operationId": event["id"], "requestId": request["requestId"],
                              "comparisonId": comparison["id"], "entityId": request["entityId"],
                              "decision": request["decision"], "case": after or before,
                              "caseChanged": after is not None}
            event["eventSha256"] = _digest(event)
            domain._put("portfolio_refresh_events", event)
            _verify_event(domain, event, {comparison["id"]: comparison})
            domain.db.commit()
            return event["result"]
        except BaseException:
            domain.db.rollback()
            raise


def verify_all(domain):
    """Read-only complete replay, including old case revisions after later edits."""
    with domain.mutex:
        comparisons = {}
        for row in domain.db.execute("SELECT id FROM os_portfolio_refreshes ORDER BY id").fetchall():
            value = _comparison(domain, row[0]); comparisons[value["id"]] = value
        for row in domain.db.execute("SELECT body FROM os_portfolio_refresh_events ORDER BY id").fetchall():
            _verify_event(domain, load_json(row[0]), comparisons)
        return comparisons


def _events(domain, comparison_id):
    events = []
    for row in domain.db.execute("SELECT body FROM os_portfolio_refresh_events ORDER BY id"):
        value = load_json(row[0])
        if value["request"]["comparisonId"] == comparison_id:
            events.append(value)
    return sorted(events, key=lambda value: (value["createdAt"], value["id"]))


def view(domain, comparison_id=None, *, offset=0, limit=50, kind=None, query=""):
    with domain.mutex:
        if comparison_id is None:
            values = []
            for row in domain.db.execute("SELECT body FROM os_portfolio_refreshes"):
                item = load_json(row[0])
                values.append({key: item[key] for key in ("id", "before", "after", "portfolioKey", "counts", "population", "createdAt")})
            return {"schema": SCHEMA, "rows": sorted(values, key=lambda row: (row["createdAt"], row["id"]), reverse=True)}
        bounded_int(offset, 0, 1000000, "Offset"); bounded_int(limit, 1, 250, "Limit")
        text(query, "Search", 512, blank=True)
        if kind not in (None, "", "added", "removed", "changed", "unchanged"):
            raise InputError("Choose a supported counterparty change kind")
        value = _comparison(domain, comparison_id, verify=False)
        cases = [load_json(row[0]) for row in domain.db.execute("SELECT body FROM os_cases")]
        cases = [case for case in cases if case["portfolioKey"] == value["portfolioKey"] and not case.get("mergedInto")]
        by_entity = {}
        for case in cases:
            by_entity.setdefault(case["counterpartyId"], []).append(case)
        events = _events(domain, comparison_id)
        latest = {}
        for event in events:
            request = event["request"]
            latest[(request["entityId"], request.get("caseId"))] = event
        rows = []
        search = query.casefold().strip()
        for source in value["rows"]:
            if kind and source["kind"] != kind or search and search not in (source["entityId"] + " " + source["caption"]).casefold():
                continue
            row = deepcopy(source)
            row["cases"] = []
            for case in sorted(by_entity.get(source["entityId"], []), key=lambda c: c["id"]):
                review = latest.get((source["entityId"], case["id"]))
                current_review = bool(review and (
                    (review["afterCase"] or review["beforeCase"])["revision"] == case["revision"]))
                row["cases"].append({"case": case, "eligible": case["portfolio"] == value["before"],
                                     "canContinue": case["portfolio"] == value["before"] and source["after"] is not None,
                                     "review": review, "reviewCurrent": current_review})
            row["sourceReview"] = latest.get((source["entityId"], None))
            rows.append(row)
        return {"schema": SCHEMA, "comparison": {k: v for k, v in value.items() if k != "rows"},
                "before": _portfolio(domain, value["before"]), "after": _portfolio(domain, value["after"]),
                "total": len(rows), "offset": offset, "limit": limit, "rows": rows[offset:offset+limit],
                "eventCount": len(events), "workspace": str(domain.ws.root)}


def report(domain, comparison_id):
    with domain.mutex:
        comparisons = verify_all(domain)
        value = comparisons.get(exact_id(comparison_id))
        if value is None:
            raise InputError("Select an original retained portfolio comparison")
        cases = [load_json(row[0]) for row in domain.db.execute("SELECT body FROM os_cases")]
        cases = [case for case in cases if case["portfolioKey"] == value["portfolioKey"]]
        # Import may give the same native source a local label/time. Keep the
        # author's exact descriptors captured in the immutable comparison.
        sources = deepcopy(value["originalSources"])
        body = {"schema": SCHEMA + ".report", "comparison": value, "sources": sources,
                "reviewEvents": _events(domain, comparison_id), "currentCases": sorted(cases, key=lambda row: row["id"]),
                "interpretation": "Explicit source and case review. No screening dispatch, legal conclusion, automatic match or implicit case retirement."}
        return body | {"sha256": _digest(body)}


def report_html(domain, comparison_id):
    value = report(domain, comparison_id)
    escape = lambda item: html.escape(str(item), quote=True)
    pre = lambda item: "<pre>" + escape(stable(item).decode()) + "</pre>"
    rows = "".join("<tr><td>" + escape(row["entityId"]) + "<br>" + escape(row["caption"]) +
                   "</td><td>" + escape(row["kind"]) + "</td><td>" + pre(row["properties"]) +
                   "</td><td>" + pre(row["metadata"]) + "</td></tr>" for row in value["comparison"]["rows"])
    reviews = "".join("<article><h3>" + escape(event["request"]["entityId"]) + " · " +
                      escape(event["request"]["decision"]) + "</h3><p>" + escape(event["request"]["reviewer"]) +
                      "</p><p>" + escape(event["request"]["reason"]) + "</p>" + pre(event) + "</article>"
                      for event in value["reviewEvents"])
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
            "<title>Customer portfolio refresh</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#20252a;"
            "max-width:1120px;margin:auto;padding:24px}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%}"
            "th,td{padding:12px;border:1px solid #ccd1d5;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
            "pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}"
            "article{border-top:1px solid #ccd1d5;padding:16px 0}.table{overflow:auto}"
            "@media(max-width:600px){body{padding:14px}th,td{padding:8px}}</style><h1>Customer portfolio refresh</h1>"
            "<p>" + escape(value["interpretation"]) + "</p><p>Snapshot SHA256 " + escape(value["sha256"]) +
            "</p><h2>Original customer sources</h2>" + pre(value["sources"]) +
            "<h2>Complete compared population</h2><div class='table'><table><thead><tr><th>Counterparty</th>"
            "<th>Change</th><th>Properties</th><th>Other original fields</th></tr></thead><tbody>" + rows +
            "</tbody></table></div><h2>Attributed review history</h2>" + (reviews or "<p>No review decisions yet.</p>") +
            "<h2>Current original cases</h2>" + pre(value["currentCases"]) + "</html>")
