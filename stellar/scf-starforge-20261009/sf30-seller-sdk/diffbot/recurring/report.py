"""Recurring review and customer delivery over the original retained Diffbot editions.

No acquisition, scheduling or persistence lives here. Exact provider numbers and
opaque identities arrive from the dataset engine without reparsing or coercion.
"""
from __future__ import annotations

import copy
import hashlib
import html
import json
from collections import Counter
from datetime import datetime
from urllib.parse import urlsplit

SCHEMA = "tj.diffbot-recurring-report.v1"
DATASET_SCHEMA = "tj.diffbot-dataset-report.v1"
DEFAULT_FIELDS = ["title", "text", "date", "author", "siteName", "brand",
                  "productId", "sku", "offerPrice", "regularPrice",
                  "offerPriceDetails", "availability", "specs"]
DECISIONS = {"accept", "ignore", "revisit"}
SELECTORS = ("kinds", "sourceUrls", "sourceIds", "recordIds")
CHANGE_KEYS = ("added", "changed", "notSeen", "unchanged")
_MISSING = object()


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _sha(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _text(value, name, *, empty=False, maximum=20000):
    if not isinstance(value, str) or (not empty and not value.strip()):
        raise ValueError(name + " must be " + ("a string" if empty else "a nonempty string"))
    if len(value) > maximum:
        raise ValueError(name + " is too long")
    return value


def _strings(value, name):
    if not isinstance(value, list):
        raise ValueError(name + " must be an array")
    out, seen = [], set()
    for item in value:
        _text(item, name + " entry")
        if item not in seen:
            out.append(item)
            seen.add(item)
    return out


def normalize_config(config=None, previous_config=None):
    """Validate the existing workspace.recurring object, preserving event order.

    Call with the last stored config before saving to enforce append-only review
    history inside the parent's original workspace/CAS transaction.
    """
    if config is None:
        config = {}
    if not isinstance(config, dict):
        raise ValueError("recurring config must be an object")
    allowed = {"watchlist", "decisions", "delivery"}
    if set(config) - allowed:
        raise ValueError("unknown recurring config field: " + ", ".join(sorted(set(config) - allowed)))
    watches = config.get("watchlist", [])
    events = config.get("decisions", [])
    delivery = config.get("delivery", {})
    if not isinstance(watches, list) or not isinstance(events, list):
        raise ValueError("watchlist and decisions must be arrays")
    if not isinstance(delivery, dict):
        raise ValueError("delivery must be an object")
    if set(delivery) - {"title", "fields"}:
        raise ValueError("delivery accepts title and fields")
    out = {"watchlist": [], "decisions": [], "delivery": {
        "title": _text(delivery.get("title", "Recurring web intelligence"),
                       "delivery title", maximum=300),
        "fields": _strings(delivery.get("fields", DEFAULT_FIELDS), "delivery fields")}}
    seen = set()
    for watch in watches:
        if not isinstance(watch, dict):
            raise ValueError("watchlist entries must be objects")
        if set(watch) - {"id", "label", "enabled", "selectors"}:
            raise ValueError("unknown watchlist field")
        wid = _text(watch.get("id"), "watch id", maximum=300)
        if wid in seen:
            raise ValueError("duplicate watch id: " + wid)
        seen.add(wid)
        enabled = watch.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("watch enabled must be boolean")
        selectors = watch.get("selectors", {})
        if not isinstance(selectors, dict) or set(selectors) - set(SELECTORS) - {"text"}:
            raise ValueError("unsupported watch selector")
        selected = {key: _strings(selectors.get(key, []), key) for key in SELECTORS}
        selected["text"] = _text(selectors.get("text", ""), "watch text", empty=True, maximum=2000)
        out["watchlist"].append({
            "id": wid, "label": _text(watch.get("label", wid), "watch label", maximum=300),
            "enabled": enabled, "selectors": selected})
    for event in events:
        if not isinstance(event, dict) or set(event) != {
                "recordId", "editionId", "decision", "reviewer", "at", "note"}:
            raise ValueError("review events require exactly recordId, editionId, decision, reviewer, at and note")
        if event["decision"] not in DECISIONS:
            raise ValueError("review decision must be accept, ignore or revisit")
        for key in ("recordId", "editionId", "reviewer", "at"):
            _text(event[key], "review " + key, maximum=1000)
        _text(event["note"], "review note", empty=True)
        try:
            stamp = datetime.fromisoformat(event["at"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("timezone is required")
        except (ValueError, TypeError) as exc:
            raise ValueError("review at must be an ISO timestamp with timezone") from exc
        out["decisions"].append(copy.deepcopy(event))
    if previous_config is not None:
        prior = normalize_config(previous_config)["decisions"]
        if out["decisions"][:len(prior)] != prior:
            raise ValueError("stored review history is append-only; append a superseding decision")
    return out


def validate_config_update(previous_config, next_config):
    """Convenience integration seam for the parent's existing save transaction."""
    return normalize_config(next_config, previous_config)


def _report(value, label):
    if not isinstance(value, dict) or value.get("schema") != DATASET_SCHEMA:
        raise ValueError(label + " must be a " + DATASET_SCHEMA + " report")
    edition = value.get("edition")
    if not isinstance(edition, dict):
        raise ValueError(label + " edition must be an object")
    _text(edition.get("id"), label + " edition id")
    for group in ("sources", "records"):
        rows = value.get(group)
        if not isinstance(rows, list):
            raise ValueError(label + " " + group + " must be an array")
        ids = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(label + " " + group + " entries must be objects")
            rid = _text(row.get("id"), label + " " + group + " id")
            if rid in ids:
                raise ValueError(label + " has duplicate " + group + " id: " + rid)
            ids.add(rid)
            if group == "records":
                if not isinstance(row.get("fields"), dict):
                    raise ValueError("record fields must be an object")
                if not isinstance(row.get("numberTokens", {}), dict):
                    raise ValueError("numberTokens must be a JSON pointer map")
    coverage = value.get("coverage", {})
    if not isinstance(coverage, dict):
        raise ValueError(label + " coverage must be an object")
    for key in ("selectedUrls", "successfulUrls", "failedUrls", "notSeenUrls"):
        if key in coverage:
            _strings(coverage[key], label + " coverage " + key)
    _json(value)  # Reject NaN/non-JSON values without changing original numeric lexemes.
    return value


def _change_id(entry):
    if isinstance(entry, str) and entry:
        return entry
    if isinstance(entry, dict):
        values = [entry[key] for key in ("recordId", "id")
                  if isinstance(entry.get(key), str) and entry[key]]
        if values and len(set(values)) == 1:
            return values[0]
    return None


def _pointer(key):
    return "/" + str(key).replace("~", "~0").replace("/", "~1")


def _differences(before, after, before_tokens, after_tokens, path=""):
    """Exact typed/lexical differences; absence and null remain different."""
    if isinstance(before, dict) and isinstance(after, dict):
        rows = []
        for key in sorted(set(before) | set(after)):
            rows.extend(_differences(before.get(key, _MISSING), after.get(key, _MISSING),
                                     before_tokens, after_tokens, path + _pointer(key)))
        return rows
    if isinstance(before, list) and isinstance(after, list):
        rows = []
        for index in range(max(len(before), len(after))):
            rows.extend(_differences(before[index] if index < len(before) else _MISSING,
                                     after[index] if index < len(after) else _MISSING,
                                     before_tokens, after_tokens, path + "/" + str(index)))
        return rows
    btoken, atoken = before_tokens.get(path, _MISSING), after_tokens.get(path, _MISSING)
    if before is not _MISSING and after is not _MISSING and _json(before) == _json(after):
        if btoken == atoken:
            return []
    row = {"path": path, "beforePresent": before is not _MISSING,
           "afterPresent": after is not _MISSING}
    if before is not _MISSING:
        row["before"] = copy.deepcopy(before)
    if after is not _MISSING:
        row["after"] = copy.deepcopy(after)
    if btoken is not _MISSING:
        row["beforeNumberToken"] = btoken
    if atoken is not _MISSING:
        row["afterNumberToken"] = atoken
    return [row]


def _source_for(record, sources):
    return sources.get(record.get("sourceId")) if record else None


def _watch_matches(watch, row, field_text=None):
    if not watch["enabled"]:
        return False
    record = row["record"] or row["previous"]
    if not record:
        return False
    selector = watch["selectors"]
    source = row["source"] if row["record"] else row["previousSource"]
    urls = {record.get("sourceUrl")}
    if source:
        urls.add(source.get("request", {}).get("pageUrl"))
    values = {
        "kinds": {record.get("kind")},
        "sourceUrls": urls,
        "sourceIds": {record.get("sourceId")},
        "recordIds": {row["recordId"]},
    }
    for key in SELECTORS:
        if selector[key] and not values[key].intersection(selector[key]):
            return False
    phrase = selector["text"].lower()
    return not phrase or phrase in (field_text if field_text is not None else _json(record.get("fields", {})).lower())


def _field_selected(path, fields):
    return any(path == _pointer(key) or path.startswith(_pointer(key) + "/") for key in fields)


def _selected_record(record, fields):
    if not record:
        return None
    keys = ("id", "identityKind", "providerId", "kind", "sourceId", "sourceUrl",
            "resolvedUrl", "capturedAt", "lineage", "conflicts", "fieldSha256")
    out = {key: copy.deepcopy(record[key]) for key in keys if key in record}
    out["fields"] = {key: copy.deepcopy(record["fields"][key])
                     for key in fields if key in record["fields"]}
    out["selectedFieldsSha256"] = _sha(out["fields"])
    out["numberTokens"] = {
        path: value for path, value in record.get("numberTokens", {}).items()
        if _field_selected(path, fields)}
    return out


def _customer_row(row, fields):
    review = row["decision"]
    return {
        "recordId": row["recordId"], "editionId": row["editionId"],
        "observedEditionId": row["observedEditionId"],
        "status": row["status"], "currentObjectObserved": row["record"] is not None,
        "record": _selected_record(row["record"], fields),
        "previous": _selected_record(row["previous"], fields),
        "source": copy.deepcopy(row["source"]),
        "previousSource": copy.deepcopy(row["previousSource"]),
        "fieldChanges": [copy.deepcopy(item) for item in row["fieldChanges"]
                         if _field_selected(item["path"], fields)],
        "comparison": copy.deepcopy(row["comparison"]),
        "changeEvidenceSha256": _sha(row["changeEvidence"]),
        "review": {key: review[key] for key in
                   ("recordId", "editionId", "decision", "reviewer", "at")},
        "findings": copy.deepcopy(row["findings"]),
    }


def build_recurring_report(current_report, previous_report=None, config=None):
    """Produce a deterministic operator report and an accepted customer projection.

    Classification comes from the original dataset engine. We never synthesize
    object identity, deletion or a price/currency inference from a missing page.
    """
    current = _report(current_report, "current")
    previous = _report(previous_report, "previous") if previous_report is not None else None
    cfg = normalize_config(config)
    edition = current["edition"]
    eid = edition["id"]
    old_eid = previous["edition"]["id"] if previous else None
    sources = {source["id"]: source for source in current["sources"]}
    old_sources = {source["id"]: source for source in previous["sources"]} if previous else {}
    records = {record["id"]: record for record in current["records"]}
    old_records = {record["id"]: record for record in previous["records"]} if previous else {}
    changes = current.get("changes", {})
    if not isinstance(changes, dict):
        raise ValueError("changes must be an object")
    comparable = changes.get("comparableScope") is True
    base_matches = bool(previous and changes.get("baseEditionId") == old_eid)
    comparison = {
        "baseEditionId": changes.get("baseEditionId"), "suppliedPreviousEditionId": old_eid,
        "previousReportAvailable": previous is not None, "baseMatches": base_matches,
        "scopeComparable": comparable,
        "exactPreviousComparisonAvailable": base_matches and comparable,
    }
    findings = []
    classified = {}
    evidence = {}
    ordered = list(records)
    ordered_ids = set(ordered)
    histories = {}
    for index, event in enumerate(cfg["decisions"]):
        histories.setdefault((event["editionId"], event["recordId"]), []).append(
            {**copy.deepcopy(event), "sequence": index + 1})
    for category in CHANGE_KEYS:
        entries = changes.get(category, [])
        if not isinstance(entries, list):
            raise ValueError("changes." + category + " must be an array")
        for index, entry in enumerate(entries):
            rid = _change_id(entry)
            if rid is None:
                findings.append({"code": "unresolved_change_entry", "category": category,
                                 "index": index, "entry": copy.deepcopy(entry)})
                continue
            classified.setdefault(rid, set()).add(category)
            evidence.setdefault(rid, []).append({"category": category, "entry": copy.deepcopy(entry)})
            if rid not in ordered_ids:
                ordered.append(rid)
                ordered_ids.add(rid)
    rows = []
    for rid in ordered:
        record = records.get(rid)
        # Never join an arbitrary supplied previous report to an unrelated base.
        old = old_records.get(rid) if base_matches else None
        kinds = classified.get(rid, set())
        status = next(iter(kinds)) if len(kinds) == 1 else (
            "conflict" if kinds else ("baseline" if not changes.get("baseEditionId") else "unclassified"))
        row_findings = []
        if len(kinds) > 1:
            row_findings.append({"code": "conflicting_classifications", "categories": sorted(kinds)})
        if not record and status != "notSeen":
            row_findings.append({"code": "change_without_current_record"})
        if status == "notSeen" and record:
            row_findings.append({"code": "not_seen_has_current_record"})
        if record and old and record.get("kind") != old.get("kind"):
            row_findings.append({"code": "identity_kind_changed"})
        source = _source_for(record, sources)
        old_source = _source_for(old, old_sources)
        if record and not source:
            row_findings.append({"code": "missing_current_source"})
        if old and not old_source:
            row_findings.append({"code": "missing_previous_source"})
        if record and old and base_matches:
            field_changes = _differences(old["fields"], record["fields"],
                                         old.get("numberTokens", {}), record.get("numberTokens", {}))
        else:
            field_changes = []
        history = histories.get((eid, rid), [])
        row = {
            "recordId": rid, "editionId": eid,
            "observedEditionId": eid if record else (old_eid if old else None),
            "status": status, "record": copy.deepcopy(record), "previous": copy.deepcopy(old),
            "source": copy.deepcopy(source), "previousSource": copy.deepcopy(old_source),
            "comparison": copy.deepcopy(comparison), "fieldChanges": field_changes,
            "changeEvidence": evidence.get(rid, []), "findings": row_findings,
            "decisionHistory": history, "decision": history[-1] if history else None,
            "reviewState": history[-1]["decision"] if history else "unreviewed",
        }
        field_text = _json((record or old or {}).get("fields", {})).lower()
        row["matchingWatchIds"] = [watch["id"] for watch in cfg["watchlist"]
                                   if _watch_matches(watch, row, field_text)]
        row["selected"] = not cfg["watchlist"] or bool(row["matchingWatchIds"])
        rows.append(row)
    warnings = []
    if previous is None:
        warnings.append("No previous report was supplied; previous source values are unavailable.")
    elif not base_matches:
        warnings.append("The supplied previous edition does not match changes.baseEditionId; its objects were not joined.")
    if changes.get("baseEditionId") and not comparable:
        warnings.append("The original engine does not declare these acquisition scopes comparable.")
    for label, report in (("Current", current), ("Previous", previous)):
        if report and report.get("coverage", {}).get("state") != "complete":
            warnings.append(label + " acquisition coverage is " +
                            str(report.get("coverage", {}).get("state", "unspecified")) + ".")
    warnings.append("Not seen means the current retained acquisition did not observe the object; it does not establish deletion.")
    selected_rows = [row for row in rows if row["selected"]]
    accepted = [row for row in selected_rows if row["reviewState"] == "accept"]
    selected_ids = set(ordered)
    orphaned = [
        {"sequence": i + 1, "recordId": event["recordId"], "editionId": event["editionId"],
         "reason": "different_edition" if event["editionId"] != eid else "record_not_in_report"}
        for i, event in enumerate(cfg["decisions"])
        if event["editionId"] != eid or event["recordId"] not in selected_ids]
    available_fields = sorted({key for row in rows for record in (row["record"], row["previous"])
                               if record for key in record["fields"]})
    counts = {
        "records": len(rows), "selected": len(selected_rows), "accepted": len(accepted),
        "reviewStates": dict(Counter(row["reviewState"] for row in selected_rows)),
        "classifications": dict(Counter(row["status"] for row in selected_rows)),
    }
    result = {
        "schema": SCHEMA, "currentEdition": copy.deepcopy(edition),
        "previousEdition": copy.deepcopy(previous["edition"]) if previous else None,
        "inputSha256": {"current": _sha(current), "previous": _sha(previous) if previous else None},
        "config": cfg, "configSha256": _sha(cfg),
        "coverage": {"current": copy.deepcopy(current.get("coverage", {})),
                     "previous": copy.deepcopy(previous.get("coverage", {})) if previous else None,
                     "comparison": comparison, "warnings": warnings},
        "rows": rows, "counts": counts, "availableFields": available_fields,
        "orphanedDecisions": orphaned,
        "findings": findings,
        "originalFindings": {"current": copy.deepcopy(current.get("findings", [])),
                             "previous": copy.deepcopy(previous.get("findings", [])) if previous else []},
    }
    customer = {
        "schema": "tj.diffbot-recurring-delivery.v1", "title": cfg["delivery"]["title"],
        "currentEdition": copy.deepcopy(edition),
        "previousEdition": copy.deepcopy(result["previousEdition"]),
        "inputSha256": copy.deepcopy(result["inputSha256"]),
        "configSha256": result["configSha256"], "fields": copy.deepcopy(cfg["delivery"]["fields"]),
        "coverage": copy.deepcopy(result["coverage"]), "counts": counts,
        "records": [_customer_row(row, cfg["delivery"]["fields"]) for row in accepted],
        "reviewPolicy": "Only the latest accept decision for this exact record and current edition, within the enabled watch selection, is delivered. Operator notes remain in the saved workspace.",
    }
    customer["contentSha256"] = _sha(customer)
    result["customer"] = customer
    result["customerHtml"] = render_recurring_html(result)
    return result


STYLE = """
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202020;background:#fff}
*{box-sizing:border-box}body{margin:0;padding:32px;max-width:1180px;margin-inline:auto;font-size:14px;line-height:1.5}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:20px;margin:28px 0 10px}
h3{font-size:17px;margin:0 0 8px}p{margin:8px 0}a{color:inherit;text-underline-offset:2px;overflow-wrap:anywhere}
.muted{color:#555}.meta{display:grid;grid-template-columns:180px 1fr;gap:6px 14px}
.meta dt{font-weight:700}.meta dd{margin:0;overflow-wrap:anywhere}
.notice{border:1px solid #aaa;background:#f5f5f5;padding:14px;margin:16px 0}
.card{border:1px solid #aaa;padding:18px;margin:16px 0;break-inside:avoid}
table{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}
th,td{vertical-align:top;text-align:left;border:1px solid #bbb;padding:8px;overflow-wrap:anywhere}
th{background:#f0f0f0;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:0;font:12px/1.5 ui-monospace,monospace}
code{overflow-wrap:anywhere}details{margin:12px 0}summary{cursor:pointer;font-weight:700}
ul{padding-left:22px}.tag{display:inline-block;border:1px solid #888;font-size:12px;padding:2px 7px;margin:0 6px 8px 0}
@media(max-width:620px){body{padding:14px}.meta{grid-template-columns:1fr;gap:2px}.meta dd{margin-bottom:8px}h1{font-size:24px}.card{padding:12px}}
@media print{body{max-width:none;padding:0;font-size:10pt}details{display:block}details>*{display:block}summary{display:none}a{text-decoration:none}.card{break-inside:auto}h2,h3{break-after:avoid}}
"""


def _esc(value):
    return html.escape(str(value), quote=True)


def _display(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) if isinstance(value, (dict, list)) else (
        "null" if value is None else ("true" if value is True else ("false" if value is False else str(value))))


def _link(value):
    text = "" if value is None else str(value)
    try:
        parts = urlsplit(text)
        safe = parts.scheme.lower() in {"https", "http"} and bool(parts.netloc) and not parts.username and not parts.password
    except ValueError:
        safe = False
    return '<a href="' + _esc(text) + '" rel="noopener noreferrer">' + _esc(text) + "</a>" if safe else _esc(text)


def _meta(entries):
    return '<dl class="meta">' + "".join("<dt>" + _esc(key) + "</dt><dd>" +
           value + "</dd>" for key, value in entries) + "</dl>"


def _source_html(source, label):
    if not source:
        return "<p>" + _esc(label) + ": source metadata unavailable.</p>"
    request = source.get("request", {})
    entries = [
        ("Source", _esc(source.get("id", ""))), ("Retained source SHA-256", _esc(source.get("sha256", ""))),
        ("Bytes / format", _esc(str(source.get("bytes", "")) + " / " + str(source.get("format", "")))),
        ("Captured", _esc(source.get("capturedAt", ""))),
        ("Source page", _link(request.get("pageUrl", ""))),
        ("Source representation", _esc(source.get("sourceKind", "Not supplied"))),
        ("Original wire bytes", _esc(_display(source.get("originalWireBytes", "Not supplied")))),
        ("Original request", "<pre>" + _esc(_display(request)) + "</pre>"),
        ("Provider request", "<pre>" + _esc(_display(source.get("providerRequest", {}))) + "</pre>"),
        ("Acquisition provenance", "<pre>" + _esc(_display(source.get("provenance", {}))) + "</pre>"),
        ("Original capture relationship", "<pre>" + _esc(_display(source.get("original", {}))) + "</pre>"),
        ("Explicit credential redactions", "<pre>" + _esc(_display(source.get("redactions", []))) + "</pre>"),
    ]
    if source.get("job"):
        entries.append(("Original Bulk job", "<pre>" + _esc(_display(source["job"])) + "</pre>"))
    return "<details><summary>" + _esc(label) + "</summary>" + _meta(entries) + "</details>"


def render_recurring_html(report):
    """Self-contained, script-free customer report. Provider HTML is inert text."""
    customer = report.get("customer", report)
    if customer.get("schema") != "tj.diffbot-recurring-delivery.v1":
        raise ValueError("expected a recurring report or customer delivery")
    title = customer["title"]
    current = customer["currentEdition"]
    previous = customer.get("previousEdition")
    head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    head += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; base-uri \'none\'; form-action \'none\'">'
    head += "<title>" + _esc(title) + "</title><style>" + STYLE + "</style></head><body>"
    pieces = [head, "<header><p class=\"muted\">Retained web intelligence · reviewed customer delivery</p><h1>" +
              _esc(title) + "</h1>" + _meta([
                  ("Current edition", _esc(current.get("label") or current["id"])),
                  ("Current edition ID", _esc(current["id"])),
                  ("Current capture", _esc(current.get("capturedAt", "Not provided"))),
                  ("Previous edition", _esc(previous["id"] if previous else "Not supplied")),
                  ("Accepted observations", _esc(len(customer["records"]))),
                  ("Content SHA-256", _esc(customer.get("contentSha256", ""))),
              ]) + "</header>"]
    pieces.append('<section class="notice"><h2 style="margin-top:0">Coverage and interpretation</h2><ul>' +
                  "".join("<li>" + _esc(item) + "</li>" for item in customer["coverage"]["warnings"]) + "</ul>")
    pieces.append("<table><thead><tr><th>Retained acquisition</th><th>Current edition</th><th>Previous edition</th></tr></thead><tbody>")
    for key, label in (("state", "Declared state"), ("selectedUrls", "Selected URLs"),
                       ("successfulUrls", "Successful URLs"), ("failedUrls", "Failed URLs"),
                       ("notSeenUrls", "Not-seen URLs")):
        cells = []
        for group in ("current", "previous"):
            cov = customer["coverage"].get(group)
            value = cov.get(key) if cov else None
            cells.append("<td><pre>" + _esc(_display(value)) + "</pre></td>")
        pieces.append("<tr><th>" + _esc(label) + "</th>" + "".join(cells) + "</tr>")
    pieces.append("</tbody></table><p>" + _esc(customer["reviewPolicy"]) + "</p></section>")
    if not customer["records"]:
        pieces.append("<p>No selected observations have an accept decision for this edition.</p>")
    for row in customer["records"]:
        record = row["record"] or row["previous"]
        fields = record.get("fields", {}) if record else {}
        heading = fields.get("title") or row["recordId"]
        pieces.append('<article class="card"><span class="tag">' + _esc(row["status"]) + '</span><span class="tag">' +
                      _esc(record.get("kind", "Unknown kind") if record else "Unresolved object") + "</span><h2 style=\"margin-top:0\">" +
                      _esc(_display(heading)) + "</h2>")
        if not row["currentObjectObserved"]:
            pieces.append('<p class="notice">No current object was observed. Any values below are from the explicitly identified previous edition; deletion is not established.</p>')
        pieces.append(_meta([
            ("Record ID", _esc(row["recordId"])),
            ("Identity basis", _esc(record.get("identityKind", "Not provided") if record else "Unavailable")),
            ("Provider identity", _esc(record.get("providerId", "Not provided") if record else "Unavailable")),
            ("Observed edition", _esc(row.get("observedEditionId") or "Unavailable")),
            ("Source URL", _link(record.get("sourceUrl", "") if record else "")),
            ("Reviewed", _esc(row["review"]["reviewer"] + " · " + row["review"]["at"])),
            ("Comparable original base", _esc("Yes" if row["comparison"]["exactPreviousComparisonAvailable"] else "No")),
        ]))
        if record and record.get("kind") == "product" and ("offerPrice" in fields or "regularPrice" in fields):
            pieces.append("<p class=\"muted\">Prices retain provider lexical values. Currency and availability are shown only when supplied; absence means unknown.</p>")
        pieces.append("<table><thead><tr><th style=\"width:24%\">Selected field</th><th>Original retained value</th></tr></thead><tbody>")
        for field in customer["fields"]:
            value = fields.get(field, _MISSING)
            pieces.append("<tr><th>" + _esc(field) + "</th><td><pre>" +
                          ("Not provided" if value is _MISSING else _esc(_display(value))) + "</pre></td></tr>")
        pieces.append("</tbody></table>")
        if row["fieldChanges"]:
            pieces.append("<h3 style=\"margin-top:18px\">Exact selected-field differences</h3><table><thead><tr><th>Field path</th><th>Previous</th><th>Current</th></tr></thead><tbody>")
            for change in row["fieldChanges"]:
                before = _display(change["before"]) if change["beforePresent"] else "Not provided"
                after = _display(change["after"]) if change["afterPresent"] else "Not provided"
                pieces.append("<tr><th>" + _esc(change["path"]) + "</th><td><pre>" + _esc(before) +
                              "</pre></td><td><pre>" + _esc(after) + "</pre></td></tr>")
            pieces.append("</tbody></table>")
        if row["findings"]:
            pieces.append("<p>Recorded interpretation findings:</p><pre>" + _esc(_display(row["findings"])) + "</pre>")
        pieces.append(_source_html(row["source"], "Current source provenance"))
        pieces.append(_source_html(row["previousSource"], "Previous source provenance"))
        if record and (record.get("numberTokens") or record.get("lineage") or record.get("conflicts")):
            pieces.append("<details><summary>Exact number tokens and record lineage</summary><pre>" +
                          _esc(_display({key: record.get(key) for key in ("numberTokens", "lineage", "conflicts")})) +
                          "</pre></details>")
        pieces.append("</article>")
    pieces.append("<footer><p class=\"muted\">Generated from retained source editions. This file contains no active provider HTML, remote images, scripts or acquisition credentials. Original dataset digests: <code>" +
                  _esc(_display(customer["inputSha256"])) + "</code>.</p></footer></body></html>")
    return "".join(pieces)
