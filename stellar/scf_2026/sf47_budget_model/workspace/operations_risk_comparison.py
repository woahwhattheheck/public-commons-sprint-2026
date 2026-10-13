"""Complete read-only comparison of original saved SF47 delivery risk editions."""
from __future__ import annotations

from copy import deepcopy
from html import escape
import json
import re
from urllib.parse import parse_qs

from model import Problem, canonical, digest, csv_bytes
import operations_risks as risks
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-delivery-risk-comparison.v1"
ENGINE_VERSION = 1
FIELDS = {"beforeReviewId", "beforeReviewSha256", "afterReviewId", "afterReviewSha256"}
SELECTION_FILES = {
    "risk-comparison-selection.json", "risk-comparison.json",
    "risk-comparison-before-review.json", "risk-comparison-after-review.json",
    "risk-comparison.html", "risk-comparison-risks.csv", "risk-comparison-actions.csv",
    "risk-comparison-context.csv",
}
NOTICE = ("This comparison preserves the operator's original dated judgments. "
          "Likelihood, impact and priority are qualitative values, not scores. "
          "Count and overdue differences use each edition's own as-of date. "
          "Comparing or exporting does not change an edition, draft or other case workflow.")
_MISSING = object()


def fail(message, code="INVALID_RISK_COMPARISON", status=422):
    raise Problem(message, status, code)


def selection(value):
    if not isinstance(value, dict) or set(value) != FIELDS:
        fail("Select both complete original review IDs and their SHA-256 identities.")
    return {
        "beforeReviewId": risks.ident(value["beforeReviewId"], "Before risk review"),
        "beforeReviewSha256": domain.sha(value["beforeReviewSha256"], "Before review identity", False),
        "afterReviewId": risks.ident(value["afterReviewId"], "After risk review"),
        "afterReviewSha256": domain.sha(value["afterReviewSha256"], "After review identity", False),
    }


def selected_reviews(reviews, value):
    chosen = selection(value)
    by_id = {row["id"]: row for row in reviews if row.get("purpose") == risks.PURPOSE}
    result = []
    for side in ("before", "after"):
        review = by_id.get(chosen[side + "ReviewId"])
        if review is None:
            fail("An original selected risk edition is unavailable.", "RISK_NOT_FOUND", 404)
        risks.validate_review(review)
        if review["sha256"] != chosen[side + "ReviewSha256"]:
            fail("The selected original risk review identity changed.", "RISK_REVIEW_CHANGED", 409)
        result.append(review)
    return chosen, result[0], result[1]


def _cell(value):
    return {"present": value is not _MISSING,
            "value": None if value is _MISSING else deepcopy(value)}


def _pointer(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def fields(before, after, path=""):
    """Keep absence distinct from null; ordered arrays remain complete values."""
    if before is _MISSING or after is _MISSING:
        return [] if before is after else [{"path": path or "/", "before": _cell(before), "after": _cell(after)}]
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            result.extend(fields(before.get(key, _MISSING), after.get(key, _MISSING),
                                 path + "/" + _pointer(key)))
        return result
    if canonical(before) == canonical(after):
        return []
    return [{"path": path or "/", "before": _cell(before), "after": _cell(after)}]


def _change(before, after):
    if before is None:
        return "ADDED"
    if after is None:
        return "REMOVED"
    return "UNCHANGED" if canonical(before) == canonical(after) else "CHANGED"


def _without(value, keys):
    return {key: deepcopy(item) for key, item in value.items() if key not in keys} if value is not None else _MISSING


def _context(review):
    value = review["riskRegister"]
    bound = risks.binding(risks.snapshot_context(review), value["document"])
    result = {
        ("SOURCE_IDENTITY", "original-source"): deepcopy(value["source"]),
        ("PLAN", "plan"): {key: deepcopy(bound[key]) for key in
                           ("mode", "planContentSha256", "planSourceSha256")},
    }
    for kind, key in (("CONTRIBUTOR", "contributors"), ("PACKAGE", "packages"), ("SOURCE", "sources")):
        for row in bound[key]:
            result[(kind, row["id"])] = deepcopy(row)
    return result


def _linked_changed(before, after, changed_context, *, action=False):
    if ("PLAN", "plan") in changed_context:
        return True
    selected = [row for row in (before, after) if row is not None]
    for row in selected:
        if row.get("ownerId") and ("CONTRIBUTOR", row["ownerId"]) in changed_context:
            return True
        if any(("SOURCE", sid) in changed_context for sid in row.get("sourceIds", [])):
            return True
        if not action:
            if any(("PACKAGE", cid) in changed_context for cid in row.get("costIds", [])):
                return True
            if any(_linked_changed(part, None, changed_context, action=True) for part in row["actions"]):
                return True
    return False


def calculate(before, after):
    risks.validate_review(before)
    risks.validate_review(after)
    return _calculate_validated(before, after)


def _calculate_validated(before, after):
    """Borrow only reviews already admitted by this original read snapshot."""
    choice = {"beforeReviewId": before["id"], "beforeReviewSha256": before["sha256"],
              "afterReviewId": after["id"], "afterReviewSha256": after["sha256"]}
    old, new = before["riskRegister"], after["riskRegister"]
    old_context, new_context = _context(before), _context(after)
    context_rows = []
    for kind, ident in sorted(set(old_context) | set(new_context)):
        a, b = old_context.get((kind, ident)), new_context.get((kind, ident))
        context_rows.append({"kind": kind, "id": ident, "change": _change(a, b),
                             "before": deepcopy(a), "after": deepcopy(b),
                             "fields": fields(a if a is not None else _MISSING,
                                              b if b is not None else _MISSING)})
    changed_context = {(row["kind"], row["id"]) for row in context_rows if row["change"] != "UNCHANGED"}
    old_risks = {row["id"]: row for row in old["document"]["risks"]}
    new_risks = {row["id"]: row for row in new["document"]["risks"]}
    old_report = {row["id"]: row for row in old["report"]["entries"]}
    new_report = {row["id"]: row for row in new["report"]["entries"]}
    risk_rows, action_rows = [], []
    for rid in sorted(set(old_risks) | set(new_risks)):
        a, b = old_risks.get(rid), new_risks.get(rid)
        ar, br = old_report.get(rid), new_report.get(rid)
        risk_rows.append({"id": rid, "change": _change(a, b), "before": deepcopy(a), "after": deepcopy(b),
            "fields": fields(_without(a, {"actions"}), _without(b, {"actions"})),
            "reportBefore": deepcopy(ar), "reportAfter": deepcopy(br),
            "reportFields": fields(_without(ar, {"actions"}), _without(br, {"actions"})),
            "contextChanged": _linked_changed(a, b, changed_context)})
        old_actions = {row["id"]: row for row in (a or {}).get("actions", [])}
        new_actions = {row["id"]: row for row in (b or {}).get("actions", [])}
        old_action_report = {row["id"]: row for row in (ar or {}).get("actions", [])}
        new_action_report = {row["id"]: row for row in (br or {}).get("actions", [])}
        for aid in sorted(set(old_actions) | set(new_actions)):
            x, y = old_actions.get(aid), new_actions.get(aid)
            xr, yr = old_action_report.get(aid), new_action_report.get(aid)
            action_rows.append({"id": aid, "riskId": rid, "change": _change(x, y),
                "before": deepcopy(x), "after": deepcopy(y),
                "fields": fields(x if x is not None else _MISSING, y if y is not None else _MISSING),
                "reportBefore": deepcopy(xr), "reportAfter": deepcopy(yr),
                "reportFields": fields(xr if xr is not None else _MISSING, yr if yr is not None else _MISSING),
                "contextChanged": _linked_changed(x, y, changed_context, action=True)})
    counts = []
    for name in sorted(set(old["report"]["counts"]) | set(new["report"]["counts"])):
        a, b = old["report"]["counts"].get(name), new["report"]["counts"].get(name)
        counts.append({"name": name, "before": a, "after": b,
                       "delta": b - a if type(a) is int and type(b) is int else None})
    result = {"schema": SCHEMA, "engineVersion": ENGINE_VERSION, "selection": choice,
        "direction": ("SAME_EDITION" if before["id"] == after["id"] else
                      "FORWARD" if before["version"] < after["version"] else "REVERSE"),
        "before": risks.summary(before), "after": risks.summary(after),
        "originals": {"before": deepcopy(before), "after": deepcopy(after)},
        "registerFields": fields(_without(old["document"], {"risks"}), _without(new["document"], {"risks"})),
        "counts": counts, "riskRows": risk_rows, "actionRows": action_rows,
        "contextRows": context_rows, "notice": NOTICE}
    result["comparisonSha256"] = digest(result)
    return result


def compare(operations, context, value):
    chosen = selection(value)
    before = risks.raw_review(operations, context["program"]["id"], chosen["beforeReviewId"])
    after = risks.raw_review(operations, context["program"]["id"], chosen["afterReviewId"])
    if (before["sha256"] != chosen["beforeReviewSha256"]
            or after["sha256"] != chosen["afterReviewSha256"]):
        fail("The selected original risk review identity changed.", "RISK_REVIEW_CHANGED", 409)
    return {"comparison": _calculate_validated(before, after),
            "current": {"programId": context["program"]["id"], "version": context["program"]["version"]}}


def require_digest(comparison, expected):
    if domain.sha(expected, "Reviewed risk comparison identity", False) != comparison["comparisonSha256"]:
        fail("Reopen the selected complete comparison before downloading.", "RISK_COMPARISON_CHANGED", 409)


def _json(value):
    return (canonical(value) + "\n").encode("utf-8")


def csv_files(comparison):
    result = {}
    for key, filename in (("riskRows", "risk-comparison-risks.csv"),
                          ("actionRows", "risk-comparison-actions.csv"),
                          ("contextRows", "risk-comparison-context.csv")):
        data = []
        for row in comparison[key]:
            data.append({
                "id": row["id"], "riskId": row.get("riskId", ""), "kind": row.get("kind", ""),
                "change": row["change"], "beforePresent": row["before"] is not None,
                "afterPresent": row["after"] is not None,
                "before": canonical(row["before"]), "after": canonical(row["after"]),
                "fieldChanges": canonical(row["fields"]),
                "reportedBefore": canonical(row.get("reportBefore")),
                "reportedAfter": canonical(row.get("reportAfter")),
                "reportedChanges": canonical(row.get("reportFields", [])),
                "contextChanged": row.get("contextChanged", False),
                "beforeReviewId": comparison["selection"]["beforeReviewId"],
                "afterReviewId": comparison["selection"]["afterReviewId"],
                "comparisonSha256": comparison["comparisonSha256"],
            })
        result[filename] = csv_bytes(["id", "riskId", "kind", "change", "beforePresent", "afterPresent",
            "before", "after", "fieldChanges", "reportedBefore", "reportedAfter", "reportedChanges",
            "contextChanged", "beforeReviewId", "afterReviewId", "comparisonSha256"], data)
    return result


def html(comparison):
    def e(value):
        return escape(str(value), quote=True)
    def display(value, present=True):
        if not present:
            return "<em>Absent</em>"
        if value is None:
            return "<code>null</code>"
        return "<pre>" + e(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)) + "</pre>"
    def table(headers, rows):
        return "<table><thead><tr>" + "".join("<th>" + e(h) + "</th>" for h in headers) + "</tr></thead><tbody>" + "".join(
            "<tr>" + "".join("<td>" + cell + "</td>" for cell in row) + "</tr>" for row in rows) + "</tbody></table>"
    def differences(changes):
        if not changes:
            return "<p>No field change.</p>"
        return table(["Field", "Before", "After"], [
            [e(row["path"]), display(row["before"]["value"], row["before"]["present"]),
             display(row["after"]["value"], row["after"]["present"])] for row in changes])
    sections = []
    for key, label in (("riskRows", "Risks and issues"), ("actionRows", "Mitigation actions"), ("contextRows", "Original context")):
        entries = []
        for row in comparison[key]:
            current = row["after"] or row["before"] or {}
            title = current.get("title", row["id"]) if isinstance(current, dict) else row["id"]
            entries.append("<article><h3>" + e(title) + "</h3><p>" + e(row.get("kind", "")) + " " +
                e(row["id"]) + " · " + e(row["change"]) +
                (" · linked original context changed" if row.get("contextChanged") else "") + "</p>" +
                differences(row["fields"]) +
                ("<h4>Original reported values</h4>" + differences(row["reportFields"]) if row.get("reportFields") else "") +
                "<details open><summary>Complete before and after records</summary>" +
                table(["Before", "After"], [[display(row["before"], row["before"] is not None),
                                              display(row["after"], row["after"] is not None)]]) + "</details></article>")
        sections.append("<section><h2>" + e(label) + "</h2>" + ("".join(entries) or "<p>No records.</p>") + "</section>")
    before, after = comparison["before"], comparison["after"]
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Delivery Risk edition review</title><style>body{font:15px system-ui,sans-serif;line-height:1.5;'
        'color:#161616;background:white;max-width:1200px;margin:32px auto;padding:0 20px}h1,h2,h3{line-height:1.25}'
        'table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0}th,td{border:1px solid #aaa;'
        'padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}'
        'pre{font:12px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}'
        'article{border-top:1px solid #bbb;padding:12px 0}small{overflow-wrap:anywhere}'
        '@media print{body{margin:0}details{display:block}details>summary{display:none}tr{break-inside:avoid}'
        'h2,h3,h4{break-after:avoid}pre{font-size:10px}}</style><h1>Delivery Risk edition review</h1><p>' +
        e(NOTICE) + "</p><p>Direction: " + e(comparison["direction"]) + "</p>" +
        table(["Selection", "Before", "After"], [
            [e("Name"), e(before["name"]), e(after["name"])],
            [e("As of"), e(before["asOfDate"]), e(after["asOfDate"])],
            [e("Case version"), e(before["version"]), e(after["version"])],
            [e("Review"), e(before["id"]), e(after["id"])],
            [e("SHA-256"), e(before["sha256"]), e(after["sha256"])],
            [e("Recorded by"), e(before["actor"]), e(after["actor"])],
            [e("Edition note"), e(before["note"]), e(after["note"])],
        ]) + "<h2>Original dated counts</h2>" + table(["Measure", "Before", "After", "After minus before"], [
            [e(row["name"]), display(row["before"]), display(row["after"]), display(row["delta"])]
            for row in comparison["counts"]]) + "<h2>Register fields</h2>" + differences(comparison["registerFields"]) +
        "".join(sections) + "<footer><p>Comparison " + e(comparison["comparisonSha256"]) +
        "</p><p>The complete case ZIP includes both original reviews, all case history, original files and planning. "
        "Use the original case import to continue its retained risk identities.</p></footer></html>").encode("utf-8")


def selected_files(context, reviews, value):
    chosen, before, after = selected_reviews(reviews, value)
    comparison = _calculate_validated(before, after)
    return {"risk-comparison-selection.json": _json({"schema": SCHEMA + ".selection", **chosen,
                "comparisonSha256": comparison["comparisonSha256"]}),
            "risk-comparison.json": _json(comparison),
            "risk-comparison-before-review.json": _json(before),
            "risk-comparison-after-review.json": _json(after),
            "risk-comparison.html": html(comparison), **csv_files(comparison)}


def export_file(comparison, kind):
    if kind == "export.json":
        return _json(comparison), "application/json", "risk-comparison.json"
    if kind == "export.html":
        return html(comparison), "text/html; charset=utf-8", "risk-comparison.html"
    filename = {"risks.csv": "risk-comparison-risks.csv", "actions.csv": "risk-comparison-actions.csv",
                "context.csv": "risk-comparison-context.csv"}.get(kind)
    if filename:
        return csv_files(comparison)[filename], "text/csv; charset=utf-8", filename
    fail("Select an original comparison download.")


def validate_import(context, reviews, files):
    if not SELECTION_FILES.intersection(files):
        return None
    if not SELECTION_FILES.issubset(files):
        fail("The complete risk comparison handover is missing a member.")
    try:
        saved = json.loads(files["risk-comparison-selection.json"])
    except (ValueError, TypeError, UnicodeError) as error:
        fail("The complete comparison selection is unreadable: " + str(error))
    if not isinstance(saved, dict) or set(saved) != FIELDS | {"schema", "comparisonSha256"} or saved.get("schema") != SCHEMA + ".selection":
        fail("Use the complete original risk comparison selection.")
    chosen = selection({key: saved[key] for key in FIELDS})
    expected = selected_files(context, reviews, chosen)
    if any(files[name] != content for name, content in expected.items()):
        fail("The selected comparison files differ from their complete original editions.", "RISK_COMPARISON_CHANGED", 409)
    return saved

def read_http(handler, parsed, operations):
    match = re.fullmatch(
        r"/api/operations/(operation-[a-f0-9]{32})/risk-register-comparison(?:/(export\.json|export\.html|risks\.csv|actions\.csv|context\.csv|export\.zip))?",
        parsed.path)
    if not match:
        return False
    program_id, kind = match.groups()
    query = parse_qs(parsed.query, keep_blank_values=True)
    expected = set(FIELDS)
    if kind:
        expected.add("expectedComparisonSha256")
    if kind == "export.zip":
        expected.add("expectedVersion")
    if set(query) != expected or any(len(values) != 1 or not values[0] for values in query.values()):
        fail("Use each complete original comparison selection field exactly once.")
    chosen = selection({key: query[key][0] for key in FIELDS})
    if kind is None:
        handler.send(200, operations.compare_risks(program_id, chosen))
    elif kind == "export.zip":
        raw_version = query["expectedVersion"][0]
        if not re.fullmatch(r"[1-9][0-9]{0,7}", raw_version):
            fail("Use the reviewed original integer case version.")
        body = operations.export_risk_comparison(program_id, chosen, query["expectedComparisonSha256"][0],
                                                 expected_version=int(raw_version))
        handler.send(200, body, "application/zip", program_id + "-risk-comparison.zip")
    else:
        body, media_type, filename = operations.export_risk_comparison(
            program_id, chosen, query["expectedComparisonSha256"][0], kind=kind)
        handler.send(200, body, media_type, filename)
    return True
