# SPDX-License-Identifier: MIT
"""Frozen parcel portfolios with explicit assessment and area bases."""
from __future__ import annotations
import copy
import csv
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
import io

from ..model import require, json_bytes, value_sha, sha_bytes, retain_bytes, utc_now, member, read_json
from .intake import ASSESSMENTS, KEY
from .workspace import json_file
from .state import parcel_state

SCHEMA = "starforge.parcel-portfolio.v1"
AREA_BASES = {"city-reported-square-feet": "square-feet", "county-reported-square-feet": "square-feet",
              "publisher-reported-acreage": "acres"}
GROUPS = frozenset(("owner", "accountable", "status", "ward"))
COLUMNS = ("parcelKey", "reviewStatus", "owner", "accountable", "status", "ward", "assessmentBasis",
           "assessment", "currency", "taxYear", "asOfDate", "areaBasis", "area", "areaUnit",
           "geometryAvailable", "sourceIssues", "decisionSha256", "factsSha256")

def selection(workspace, definition, edition):
    require(isinstance(definition, dict) and set(definition) <= {"editionId", "title", "selection",
            "assessmentBasis", "areaBasis", "groupBy", "note", "requireCompleteReview"} and
            definition.get("editionId") == edition["id"] and
            isinstance(definition.get("title"), str) and 0 < len(definition["title"].strip()) <= 512 and
            definition.get("assessmentBasis") in ASSESSMENTS and definition.get("areaBasis") in AREA_BASES and
            isinstance(definition.get("groupBy"), list) and all(isinstance(item, str) for item in definition["groupBy"]) and len(definition["groupBy"]) <= len(GROUPS) and
            len(set(definition["groupBy"])) == len(definition["groupBy"]) and set(definition["groupBy"]) <= GROUPS and
            isinstance(definition.get("note"), str) and 0 < len(definition["note"].strip()) <= 4000 and
            type(definition.get("requireCompleteReview", False)) is bool,
            "PARCEL_PORTFOLIO_DEFINITION", "Choose the source edition, assessment basis, area basis, grouping and portfolio scope.")
    scope = definition.get("selection")
    require(isinstance(scope, dict) and set(scope) in ({"keys"}, {"filters"}),
            "PARCEL_PORTFOLIO_SELECTION", "Select exact parcel keys or the explicit current source filters.")
    index = workspace.index(edition)
    known = {row["key"] for row in index["rows"]}
    if "keys" in scope:
        require(isinstance(scope["keys"], list) and scope["keys"] and len(scope["keys"]) <= 100000 and
                all(isinstance(key, str) and KEY.fullmatch(key) and key in known for key in scope["keys"]) and
                len(set(scope["keys"])) == len(scope["keys"]), "PARCEL_PORTFOLIO_SELECTION",
                "Select distinct original parcel keys from this edition.")
        keys = sorted(scope["keys"])
    else:
        filters = scope["filters"]
        require(isinstance(filters, dict) and set(filters) <= {"query", "ward", "issue"} and
                all(isinstance(value, str) and len(value) <= 1000 for value in filters.values()),
                "PARCEL_PORTFOLIO_FILTER", "Use the reviewed source search, ward and issue filters.")
        keys = sorted(row["key"] for row in index["rows"]
                      if (not filters.get("query") or filters["query"].casefold() in row["search"]) and
                         (not filters.get("ward") or filters["ward"] in row["wards"]) and
                         (not filters.get("issue") or filters["issue"] in row["issues"]))
        require(keys, "PARCEL_PORTFOLIO_EMPTY", "Select at least one original parcel.")
    return keys, index

def _build(workspace, definition):
    state = workspace.workspace.read()
    edition = workspace.edition(definition.get("editionId"), state)
    keys, index = selection(workspace, definition, edition)
    reviews = workspace.review_index(edition)
    output, groups = [], {}
    for key in keys:
        row = workspace.row(edition, key, index=index)
        decision = workspace.decision(edition, key, reviews=reviews)
        reviewed = bool(decision and decision["factsSha256"] == row["factsSha256"])
        if definition.get("requireCompleteReview"):
            require(reviewed, "PARCEL_PORTFOLIO_REVIEW", "Finish the selected parcel review before this complete-review portfolio.",
                    key=key)
        fields = {"owner": None, "accountable": None, "status": None, "ward": None}
        assessment, area, geometry = None, None, None
        if reviewed:
            for role in ("owner", "status", "ward"):
                choice = decision[role]
                fields[role] = choice["claim"]["value"] if choice["mode"] == "source" else None
            if decision["accountable"]["mode"] == "entity":
                fields["accountable"] = decision["accountable"]["entity"]["label"]
            assessment = next((claim for claim in decision["assessments"] if claim["basis"] == definition["assessmentBasis"]), None)
            area = decision["area"] if decision["area"] and decision["area"]["basis"] == definition["areaBasis"] else None
            geometry = decision["geometry"]
        item = {"parcelKey": key, "reviewStatus": "REVIEWED" if reviewed else "UNREVIEWED",
                **fields, "assessmentBasis": definition["assessmentBasis"],
                "assessment": assessment["value"] if assessment else None,
                "currency": assessment["currency"] if assessment else "USD",
                "taxYear": assessment["taxYear"] if assessment else None,
                "asOfDate": assessment["asOfDate"] if assessment else None,
                "areaBasis": definition["areaBasis"], "area": area["value"] if area else None,
                "areaUnit": AREA_BASES[definition["areaBasis"]], "geometryAvailable": geometry is not None,
                "sourceIssues": sorted({problem["code"] for problem in row["issues"]}),
                "decisionSha256": decision["sha256"] if reviewed else None, "factsSha256": row["factsSha256"],
                "ownerClaim": copy.deepcopy(decision["owner"].get("claim")) if reviewed else None,
                "accountableEntity": copy.deepcopy(decision["accountable"].get("entity")) if reviewed else None,
                "assessmentClaim": copy.deepcopy(assessment), "areaClaim": copy.deepcopy(area),
                "geometryClaim": copy.deepcopy(geometry)}
        output.append(item)
        # Every amount grouping always retains its certified year and original as-of date.
        grouping = {field: fields[field] for field in definition["groupBy"]}
        if "accountable" in definition["groupBy"]:
            entity = item["accountableEntity"]
            grouping.update(accountableEntityId=entity["entityId"] if entity else None,
                            accountableEntityVersion=entity["id"] if entity else None)
        grouping.update(taxYear=item["taxYear"], asOfDate=item["asOfDate"], currency=item["currency"],
                        assessmentBasis=definition["assessmentBasis"], areaBasis=definition["areaBasis"],
                        areaUnit=item["areaUnit"])
        group_id = value_sha(grouping)
        group = groups.setdefault(group_id, {"group": grouping, "parcels": 0, "reviewed": 0,
            "assessmentCount": 0, "areaCount": 0, "pairedCount": 0, "geometryCount": 0,
            "assessmentTotal": Decimal(0), "areaTotal": Decimal(0),
            "pairedAssessmentTotal": Decimal(0), "pairedAreaTotal": Decimal(0)})
        group["parcels"] += 1; group["reviewed"] += int(reviewed); group["geometryCount"] += int(geometry is not None)
        amount = Decimal(item["assessment"]) if item["assessment"] is not None else None
        measure = Decimal(item["area"]) if item["area"] is not None else None
        if amount is not None:
            group["assessmentCount"] += 1; group["assessmentTotal"] += amount
        if measure is not None:
            group["areaCount"] += 1; group["areaTotal"] += measure
        if amount is not None and measure is not None and measure > 0:
            group["pairedCount"] += 1; group["pairedAssessmentTotal"] += amount; group["pairedAreaTotal"] += measure
    group_rows = []
    for group_id in sorted(groups):
        group = groups[group_id]
        numerator, denominator = group["pairedAssessmentTotal"], group["pairedAreaTotal"]
        factor = Decimal(43560) if group["group"]["areaUnit"] == "square-feet" else Decimal(1)
        ratio = None
        if group["pairedCount"] and denominator > 0:
            with localcontext() as context:
                context.prec = 1024
                display = (numerator * factor / denominator).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
            ratio = {"numeratorAssessment": str(numerator), "denominatorArea": str(denominator),
                     "areaUnit": group["group"]["areaUnit"], "squareFeetPerAcre": "43560" if factor != 1 else None,
                     "assessmentPerAcreDisplay": str(display), "displayRounding": "half-even, 2 decimal places",
                     "pairedParcelCount": group["pairedCount"]}
        for field in ("assessmentTotal", "areaTotal", "pairedAssessmentTotal", "pairedAreaTotal"):
            count = group["assessmentCount"] if field == "assessmentTotal" else group["areaCount"] if field == "areaTotal" else group["pairedCount"]
            group[field] = str(group[field]) if count else None
        group["ratio"] = ratio
        group_rows.append(group)
    value = {"schema": SCHEMA, "editionId": edition["id"], "editionLabel": edition["label"],
             "editionCapturedAt": edition.get("capturedAt"), "editionCreatedAt": edition.get("createdAt"), "definition": copy.deepcopy(definition),
             "selectedKeys": keys, "rows": output, "groups": group_rows,
             "summary": {"parcels": len(output), "reviewed": sum(row["reviewStatus"] == "REVIEWED" for row in output),
                         "withAssessment": sum(row["assessment"] is not None for row in output),
                         "withSelectedArea": sum(row["area"] is not None for row in output),
                         "withSelectedGeometry": sum(row["geometryAvailable"] for row in output),
                         "withSourceIssues": sum(bool(row["sourceIssues"]) for row in output)}}
    return {**value, "previewSha256": value_sha(value)}

def build(workspace, definition):
    with localcontext() as context:
        context.prec = 1024
        return _build(workspace, definition)

def preview(workspace, definition):
    value = build(workspace, definition)
    return {key: copy.deepcopy(value[key]) for key in
            ("schema", "editionId", "editionLabel", "editionCapturedAt", "editionCreatedAt", "definition", "summary", "groups", "previewSha256")} | {
            "selectedKeyCount": len(value["selectedKeys"]), "examples": value["rows"][:25]}

def _csv(value):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS, quoting=csv.QUOTE_ALL, lineterminator="\n")
    writer.writeheader()
    numeric = {"assessment", "area"}
    for row in value["rows"]:
        selected = {}
        for key in COLUMNS:
            item = row[key]
            if isinstance(item, list): item = "; ".join(item)
            if item is None: item = ""
            if key not in numeric and isinstance(item, str) and item.startswith(("=", "+", "-", "@", "\t", "\r")):
                item = "'" + item
            selected[key] = item
        writer.writerow(selected)
    return output.getvalue().encode("utf-8")

def create(workspace, definition, expected_preview_sha256, *, revision, request_id, actor):
    payload = {"definition": definition, "previewSha256": expected_preview_sha256}
    previous = workspace.workspace.operation(request_id, "parcels.portfolio.created", payload)
    if previous: return previous
    value = build(workspace, definition)
    require(value["previewSha256"] == expected_preview_sha256, "PARCEL_PORTFOLIO_CHANGED",
            "Review the exact selected decisions, assessment period and measurement basis before saving this portfolio.")
    identity = "portfolio-" + value_sha({"requestId": request_id, "previewSha256": expected_preview_sha256})
    retained_json = member(workspace.workspace.root,
                           "parcels/portfolios/" + identity + "/portfolio.json", existing=False)
    if retained_json.exists():
        # This exact file may have been published before the original SQLite commit.
        # Reuse its captured timestamp after checking every frozen input and result.
        complete, original_body = read_json(retained_json, limit=256 * 1024 * 1024)
        expected = {**value, "id": identity, "actor": actor}
        require(isinstance(complete, dict) and set(complete) == set(expected) | {"createdAt"} and
                {key: item for key, item in complete.items() if key != "createdAt"} == expected and
                isinstance(complete.get("createdAt"), str) and complete["createdAt"] and
                json_bytes(complete) == original_body,
                "PARCEL_PORTFOLIO_RECOVERY", "The retained portfolio must match this original request and reviewed input.")
    else:
        complete = {**value, "id": identity, "createdAt": utc_now(), "actor": actor}
    files = []
    for name, body in (("portfolio.json", json_bytes(complete)), ("parcels.csv", _csv(complete)),
                       ("groups.json", json_bytes({"schema": "starforge.parcel-portfolio-groups.v1",
                            "portfolioId": identity, "previewSha256": expected_preview_sha256, "groups": complete["groups"]}))):
        files.append(retain_bytes(workspace.workspace.root, "parcels/portfolios/" + identity + "/" + name, body))
    record = {"id": identity, "editionId": value["editionId"], "title": definition["title"],
              "previewSha256": expected_preview_sha256, "definition": copy.deepcopy(definition),
              "summary": value["summary"], "createdAt": complete["createdAt"], "actor": actor, "files": files}
    def update(state):
        state["parcels"]["portfolios"].append(copy.deepcopy(record))
        return {"portfolio": copy.deepcopy(record)}
    return workspace.workspace._mutate(revision, request_id, actor, "parcels.portfolio.created", payload, update)

def get(workspace, identity):
    data = parcel_state(workspace.workspace.read())
    record = next((row for row in data["portfolios"] if row["id"] == identity), None)
    require(record is not None, "PARCEL_PORTFOLIO_REQUIRED", "Choose a saved original portfolio.")
    source = next(item for item in record["files"] if item["path"].endswith("/portfolio.json"))
    value = json_file(workspace.workspace.root, source)
    require(value.get("schema") == SCHEMA and value.get("id") == identity and
            value.get("previewSha256") == record["previewSha256"], "PARCEL_PORTFOLIO_IDENTITY",
            "The retained portfolio differs from its original reviewed identity.")
    basis = {key: item for key, item in value.items() if key not in ("id", "createdAt", "actor", "previewSha256")}
    require(value_sha(basis) == value["previewSha256"], "PARCEL_PORTFOLIO_CHANGED",
            "The original reviewed portfolio content changed.")
    return copy.deepcopy(record), value
