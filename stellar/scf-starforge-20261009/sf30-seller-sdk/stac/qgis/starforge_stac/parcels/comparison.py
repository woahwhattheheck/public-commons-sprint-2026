# SPDX-License-Identifier: MIT
"""Named comparison of two exact frozen parcel portfolios in the original workspace."""
from __future__ import annotations
import copy
import csv
from decimal import Decimal, InvalidOperation, localcontext
import html
import io

from ..model import require, value_sha, json_bytes, retain_bytes, member, read_json, utc_now
from . import portfolio
from .workspace import json_file
from .state import parcel_state

SCHEMA = "starforge.parcel-portfolio-comparison.v1"
GROUPS = frozenset(("owner", "accountable", "status", "ward"))

def definition(value):
    require(isinstance(value, dict) and set(value) == {"title", "leftPortfolioId", "rightPortfolioId",
            "periodPolicy", "groupBy", "note"} and
            isinstance(value["title"], str) and 0 < len(value["title"].strip()) <= 512 and
            isinstance(value["note"], str) and 0 < len(value["note"].strip()) <= 4000 and
            isinstance(value["leftPortfolioId"], str) and isinstance(value["rightPortfolioId"], str) and
            value["leftPortfolioId"] != value["rightPortfolioId"] and
            value["periodPolicy"] in ("same-period", "compare-declared-periods") and
            isinstance(value["groupBy"], list) and len(value["groupBy"]) <= 4 and
            all(isinstance(x, str) for x in value["groupBy"]) and
            len(set(value["groupBy"])) == len(value["groupBy"]) and set(value["groupBy"]) <= GROUPS,
            "PARCEL_COMPARISON_DEFINITION", "Choose two distinct saved portfolios, a period policy, grouping and review note.")
    return copy.deepcopy(value)

def _number(value):
    if value is None: return None
    require(isinstance(value, str) and len(value) <= 1024, "PARCEL_COMPARISON_NUMBER",
            "Keep exact decimal text from each original frozen portfolio.")
    try:
        result = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid original decimal value") from exc
    require(result.is_finite(), "PARCEL_COMPARISON_NUMBER", "The original measure must be a finite decimal.")
    return result

def _measure(left, right, kind, policy):
    name = "assessment" if kind == "assessment" else "area"
    basis = "assessmentBasis" if kind == "assessment" else "areaBasis"
    unit = "currency" if kind == "assessment" else "areaUnit"
    result = {"left": left.get(name) if left else None, "right": right.get(name) if right else None,
              "leftBasis": left.get(basis) if left else None, "rightBasis": right.get(basis) if right else None,
              "leftUnit": left.get(unit) if left else None, "rightUnit": right.get(unit) if right else None,
              "comparable": False, "delta": None, "reasons": []}
    if kind == "assessment":
        result["leftPeriod"] = {key: left.get(key) for key in ("taxYear", "asOfDate")} if left else None
        result["rightPeriod"] = {key: right.get(key) for key in ("taxYear", "asOfDate")} if right else None
    reasons = result["reasons"]
    if left is None or right is None:
        reasons.append("cohort-added" if left is None else "cohort-removed")
        return result
    a, b = _number(result["left"]), _number(result["right"])
    if a is None or b is None: reasons.append("measure-missing")
    if result["leftBasis"] != result["rightBasis"]: reasons.append("basis-differs")
    if result["leftUnit"] != result["rightUnit"]: reasons.append("unit-differs")
    if kind == "assessment":
        periods = (result["leftPeriod"], result["rightPeriod"])
        if any(any(p[key] in (None, "") for key in ("taxYear", "asOfDate")) for p in periods):
            reasons.append("period-missing")
        elif policy == "same-period" and periods[0] != periods[1]:
            reasons.append("period-differs")
    if not reasons:
        result["comparable"] = True
        result["delta"] = str(b - a)
    return result

def _group(row, fields):
    if row is None: return None
    out = {name: row.get(name) for name in fields}
    if "accountable" in fields:
        entity = row.get("accountableEntity")
        out.update(accountableEntityId=entity.get("entityId") if entity else None,
                   accountableEntityVersion=entity.get("id") if entity else None)
    out.update(assessmentBasis=row["assessmentBasis"], currency=row["currency"],
               taxYear=row.get("taxYear"), asOfDate=row.get("asOfDate"),
               areaBasis=row["areaBasis"], areaUnit=row["areaUnit"])
    return out

def _build_values(left, right, chosen):
    """Pure comparison over complete verified portfolio values; never downloads publisher data."""
    require(left.get("schema") == portfolio.SCHEMA and right.get("schema") == portfolio.SCHEMA and
            isinstance(left.get("rows"), list) and isinstance(right.get("rows"), list),
            "PARCEL_COMPARISON_INPUT", "Use two complete verified frozen portfolios.")
    lmap = {row["parcelKey"]: row for row in left["rows"]}
    rmap = {row["parcelKey"]: row for row in right["rows"]}
    require(len(lmap) == len(left["rows"]) and len(rmap) == len(right["rows"]) and
            set(lmap) == set(left["selectedKeys"]) and set(rmap) == set(right["selectedKeys"]),
            "PARCEL_COMPARISON_COHORT", "Every frozen portfolio must retain one row for each selected original key.")
    rows, groups = [], {}
    for key in sorted(set(lmap) | set(rmap)):
        a, b = lmap.get(key), rmap.get(key)
        cohort = "added" if a is None else "removed" if b is None else "common"
        fields = []
        if a is not None and b is not None:
            for name in ("reviewStatus", "owner", "accountable", "status", "ward",
                         "accountableEntity", "ownerClaim", "assessmentClaim", "areaClaim",
                         "geometryClaim", "geometryAvailable", "sourceIssues", "factsSha256", "decisionSha256"):
                if a.get(name) != b.get(name): fields.append(name)
        amount = _measure(a, b, "assessment", chosen["periodPolicy"])
        area = _measure(a, b, "area", chosen["periodPolicy"])
        if cohort == "common":
            for name in ("assessment", "assessmentBasis", "currency", "taxYear", "asOfDate",
                         "area", "areaBasis", "areaUnit"):
                if a.get(name) != b.get(name) and name not in fields: fields.append(name)
        transition = {"left": _group(a, chosen["groupBy"]), "right": _group(b, chosen["groupBy"])}
        row = {"parcelKey": key, "cohort": cohort, "changed": bool(fields), "changedFields": fields,
               "assessment": amount, "area": area, "transition": transition,
               "left": copy.deepcopy(a), "right": copy.deepcopy(b)}
        rows.append(row)
        gid = value_sha(transition)
        group = groups.setdefault(gid, {"id": gid, "transition": transition, "parcels": 0,
            "added": 0, "removed": 0, "common": 0, "changed": 0,
            "comparableAssessmentCount": 0, "assessmentDeltaTotal": Decimal(0),
            "comparableAreaCount": 0, "areaDeltaTotal": Decimal(0), "parcelKeys": []})
        group["parcels"] += 1; group[cohort] += 1; group["changed"] += int(bool(fields))
        group["parcelKeys"].append(key)
        if amount["comparable"]:
            group["comparableAssessmentCount"] += 1
            group["assessmentDeltaTotal"] += Decimal(amount["delta"])
        if area["comparable"]:
            group["comparableAreaCount"] += 1
            group["areaDeltaTotal"] += Decimal(area["delta"])
    group_rows = []
    for gid in sorted(groups):
        group = groups[gid]
        for count, total in (("comparableAssessmentCount", "assessmentDeltaTotal"),
                             ("comparableAreaCount", "areaDeltaTotal")):
            group[total] = str(group[total]) if group[count] else None
        group_rows.append(group)
    return {"rows": rows, "groups": group_rows, "summary": {
        "leftParcels": len(lmap), "rightParcels": len(rmap),
        "added": sum(x["cohort"] == "added" for x in rows),
        "removed": sum(x["cohort"] == "removed" for x in rows),
        "common": sum(x["cohort"] == "common" for x in rows),
        "changedCommon": sum(x["cohort"] == "common" and x["changed"] for x in rows),
        "unchangedCommon": sum(x["cohort"] == "common" and not x["changed"] for x in rows),
        "comparableAssessment": sum(x["assessment"]["comparable"] for x in rows),
        "comparableArea": sum(x["area"]["comparable"] for x in rows),
        "amountAttention": sum(x["cohort"] == "common" and not x["assessment"]["comparable"] for x in rows),
        "areaAttention": sum(x["cohort"] == "common" and not x["area"]["comparable"] for x in rows)}}

def build(workspace, raw):
    chosen = definition(raw)
    lrecord, left = portfolio.get(workspace, chosen["leftPortfolioId"])
    rrecord, right = portfolio.get(workspace, chosen["rightPortfolioId"])
    with localcontext() as ctx:
        ctx.prec = 4096
        compared = _build_values(left, right, chosen)
    value = {"schema": SCHEMA, "definition": chosen,
             "left": {"portfolioId": left["id"], "previewSha256": left["previewSha256"],
                      "editionId": left["editionId"], "title": left["definition"]["title"],
                      "files": copy.deepcopy(lrecord["files"])},
             "right": {"portfolioId": right["id"], "previewSha256": right["previewSha256"],
                      "editionId": right["editionId"], "title": right["definition"]["title"],
                      "files": copy.deepcopy(rrecord["files"])},
             **compared}
    return {**value, "previewSha256": value_sha(value)}

def preview(workspace, raw):
    value = build(workspace, raw)
    return {key: copy.deepcopy(value[key]) for key in
            ("schema", "definition", "left", "right", "summary", "groups", "previewSha256")} | {
            "examples": value["rows"][:50], "rowCount": len(value["rows"])}

def _csv(value):
    columns = ("parcelKey", "cohort", "changedFields", "leftOwner", "rightOwner",
        "leftAccountable", "rightAccountable", "leftWard", "rightWard",
        "leftAssessment", "rightAssessment", "assessmentDelta", "assessmentComparable", "assessmentReasons",
        "leftAssessmentBasis", "rightAssessmentBasis", "leftCurrency", "rightCurrency",
        "leftPeriod", "rightPeriod", "leftArea", "rightArea", "areaDelta", "areaComparable", "areaReasons",
        "leftAreaBasis", "rightAreaBasis", "leftAreaUnit", "rightAreaUnit",
        "leftDecisionSha256", "rightDecisionSha256", "leftFactsSha256", "rightFactsSha256")
    out = io.StringIO(newline=""); writer = csv.DictWriter(out, fieldnames=columns, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writeheader()
    numeric = {"leftAssessment", "rightAssessment", "assessmentDelta", "leftArea", "rightArea", "areaDelta"}
    for row in value["rows"]:
        a, b = row["left"] or {}, row["right"] or {}; m, area = row["assessment"], row["area"]
        item = {"parcelKey": row["parcelKey"], "cohort": row["cohort"], "changedFields": row["changedFields"],
            "leftOwner": a.get("owner"), "rightOwner": b.get("owner"), "leftAccountable": a.get("accountable"),
            "rightAccountable": b.get("accountable"), "leftWard": a.get("ward"), "rightWard": b.get("ward"),
            "leftAssessment": m["left"], "rightAssessment": m["right"], "assessmentDelta": m["delta"],
            "assessmentComparable": m["comparable"], "assessmentReasons": m["reasons"],
            "leftAssessmentBasis": m["leftBasis"], "rightAssessmentBasis": m["rightBasis"],
            "leftCurrency": m["leftUnit"], "rightCurrency": m["rightUnit"],
            "leftPeriod": m.get("leftPeriod"), "rightPeriod": m.get("rightPeriod"),
            "leftArea": area["left"], "rightArea": area["right"], "areaDelta": area["delta"],
            "areaComparable": area["comparable"], "areaReasons": area["reasons"],
            "leftAreaBasis": area["leftBasis"], "rightAreaBasis": area["rightBasis"],
            "leftAreaUnit": area["leftUnit"], "rightAreaUnit": area["rightUnit"],
            "leftDecisionSha256": a.get("decisionSha256"), "rightDecisionSha256": b.get("decisionSha256"),
            "leftFactsSha256": a.get("factsSha256"), "rightFactsSha256": b.get("factsSha256")}
        for key, val in item.items():
            if isinstance(val, (dict, list)): val = json_bytes(val).decode("utf-8").rstrip("\n")
            if val is None: val = ""
            if key not in numeric and isinstance(val, str) and val.startswith(("=", "+", "-", "@", "\t", "\r")):
                val = "'" + val
            item[key] = val
        writer.writerow(item)
    return out.getvalue().encode("utf-8")

def _report(value):
    esc = lambda x: html.escape(str(x if x is not None else "Missing"), quote=True)
    def measure(value, kind):
        parts = []
        for side in ("left", "right"):
            parts.append(side.title() + ": " + str(value[side] if value[side] is not None else "Missing") +
                         " " + str(value[side + "Unit"]) + " · " + str(value[side + "Basis"]))
            if kind == "assessment":
                period = value.get(side + "Period") or {}
                parts.append("Tax year " + str(period.get("taxYear")) + " · as of " + str(period.get("asOfDate")))
        parts.append("Change: " + (value["delta"] if value["comparable"] else "Not comparable"))
        if value["reasons"]: parts.append("Attention: " + ", ".join(value["reasons"]))
        return "<br>".join(esc(part) for part in parts)
    rows = "".join("<tr><td>" + esc(r["parcelKey"]) + "</td><td>" + esc(r["cohort"]) +
        "</td><td>" + esc(", ".join(r["changedFields"]) or "No changed fields") +
        "</td><td>" + measure(r["assessment"], "assessment") + "</td><td>" +
        measure(r["area"], "area") + "</td><td><details><summary>Both original rows and reviewed decisions</summary><pre>" +
        esc(json_bytes({"left": r["left"], "right": r["right"]}).decode("utf-8")) +
        "</pre></details></td></tr>" for r in value["rows"])
    body = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + esc(value["definition"]["title"]) + "</title><style>body{font:15px system-ui;max-width:1500px;margin:24px auto;padding:0 18px;color:#171717}table{border-collapse:collapse;width:100%}th,td{padding:7px;border:1px solid #aaa;text-align:left;vertical-align:top}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:12px;max-width:70em}h1{font-size:26px}summary{cursor:pointer}td{min-width:8em}</style></head><body>"
    body += "<h1>" + esc(value["definition"]["title"]) + "</h1><p>" + esc(value["definition"]["note"]) + "</p>"
    body += "<p>Left: " + esc(value["left"]["title"]) + " · Right: " + esc(value["right"]["title"]) + "</p>"
    body += "<p>Period policy: " + esc(value["definition"]["periodPolicy"]) + ". Amount and area changes are shown only for compatible retained measures. Cohort additions/removals keep their original one-sided values; missing values are not zero.</p>"
    body += "<h2>Coverage</h2><pre>" + esc(json_bytes(value["summary"]).decode("utf-8")) + "</pre><div class=scroll><table><thead><tr>"
    body += "".join("<th>" + esc(x) + "</th>" for x in ("Parcel", "Cohort", "Changed fields", "Assessment, basis and period", "Area and basis", "Original lineage"))
    body += "</tr></thead><tbody>" + rows + "</tbody></table></div>"
    body += "<h2>Grouped transitions</h2><p>Totals use only comparable common parcels in each exact left-to-right grouping. Group identities retain measurement bases, currency, units and periods.</p><pre>" + esc(json_bytes(value["groups"]).decode("utf-8")) + "</pre>"
    body += "<details><summary>Complete exact comparison and original row lineage</summary><pre>" + esc(json_bytes(value).decode("utf-8")) + "</pre></details></body></html>"
    return body.encode("utf-8")

def create(workspace, raw, expected_preview_sha256, *, revision, request_id, actor):
    payload = {"definition": raw, "previewSha256": expected_preview_sha256}
    previous = workspace.workspace.operation(request_id, "parcels.portfolio-comparison.created", payload)
    if previous: return previous
    value = build(workspace, raw)
    require(value["previewSha256"] == expected_preview_sha256, "PARCEL_COMPARISON_CHANGED",
            "Preview the exact retained portfolio pair and comparison policy before saving.")
    identity = "comparison-" + value_sha({"requestId": request_id, "previewSha256": expected_preview_sha256})
    target = member(workspace.workspace.root, "parcels/comparisons/" + identity + "/comparison.json", existing=False)
    expected = {**value, "id": identity, "actor": actor}
    if target.exists():
        complete, original = read_json(target, limit=256 * 1024 * 1024)
        require(isinstance(complete, dict) and set(complete) == set(expected) | {"createdAt"} and
                {k: v for k, v in complete.items() if k != "createdAt"} == expected and
                isinstance(complete.get("createdAt"), str) and complete["createdAt"] and json_bytes(complete) == original,
                "PARCEL_COMPARISON_RECOVERY", "Retained comparison must match this original request and pair.")
    else:
        complete = {**expected, "createdAt": utc_now()}
    files = [retain_bytes(workspace.workspace.root, "parcels/comparisons/" + identity + "/" + name, body)
             for name, body in (("comparison.json", json_bytes(complete)), ("changes.csv", _csv(complete)),
                                ("report.html", _report(complete)))]
    record = {"id": identity, "title": raw["title"], "leftPortfolioId": raw["leftPortfolioId"],
              "rightPortfolioId": raw["rightPortfolioId"], "definition": copy.deepcopy(raw),
              "previewSha256": expected_preview_sha256, "summary": value["summary"],
              "createdAt": complete["createdAt"], "actor": actor, "files": files}
    def update(state):
        state["parcels"].setdefault("comparisons", []).append(copy.deepcopy(record))
        return {"comparison": copy.deepcopy(record)}
    return workspace.workspace._mutate(revision, request_id, actor, "parcels.portfolio-comparison.created", payload, update)

def get(workspace, identity):
    record = next((x for x in parcel_state(workspace.workspace.read()).get("comparisons", []) if x["id"] == identity), None)
    require(record is not None, "PARCEL_COMPARISON_REQUIRED", "Choose a retained comparison in this workspace.")
    source = next(x for x in record["files"] if x["path"].endswith("/comparison.json"))
    value = json_file(workspace.workspace.root, source)
    require(value.get("schema") == SCHEMA and value.get("id") == identity and
            value.get("previewSha256") == record["previewSha256"], "PARCEL_COMPARISON_IDENTITY",
            "Retain the exact comparison identity.")
    basis = {k: v for k, v in value.items() if k not in ("id", "actor", "createdAt", "previewSha256")}
    require(value_sha(basis) == value["previewSha256"], "PARCEL_COMPARISON_CHANGED", "Retained comparison content changed.")
    expected = build(workspace, record["definition"])
    require({k: v for k, v in value.items() if k not in ("id", "actor", "createdAt")} == expected,
            "PARCEL_COMPARISON_SOURCE_CHANGED", "Comparison must reproduce from both complete frozen portfolios.")
    return copy.deepcopy(record), value
