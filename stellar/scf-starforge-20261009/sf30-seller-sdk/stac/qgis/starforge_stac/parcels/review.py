# SPDX-License-Identifier: MIT
"""Prepare and preview explicit staff review batches without changing source facts."""
from __future__ import annotations
import copy
from ..model import require, value_sha
from .state import parcel_state
from .intake import KEY
from .portfolio import AREA_BASES

def decision_input(row, decision=None):
    value = {"key": row["key"], "factsSha256": row["factsSha256"],
             "expectedDecisionSha256": decision["sha256"] if decision else None,
             "owner": {"mode": "unresolved"}, "status": {"mode": "unresolved"},
             "ward": {"mode": "unresolved"}, "accountable": {"mode": "unassigned"},
             "assessmentRecordId": None, "areaClaimId": None, "geometryClaimId": None,
             "reason": "", "evidence": []}
    if decision:
        for role in ("owner", "status", "ward"):
            choice = decision[role]
            value[role] = {"mode": "source", "claimId": choice["claim"]["id"]} if choice["mode"] == "source" else {"mode": "unresolved"}
        if decision["accountable"]["mode"] == "entity":
            entity = decision["accountable"]["entity"]
            value["accountable"] = {"mode": "entity", "entityId": entity["entityId"], "entityVersion": entity["id"]}
        value.update(assessmentRecordId=decision["assessmentRecordId"],
                     areaClaimId=decision["area"]["id"] if decision["area"] else None,
                     geometryClaimId=decision["geometry"]["id"] if decision["geometry"] else None,
                     reason=decision["reason"], evidence=copy.deepcopy(decision.get("evidence", [])))
    return value

def prepare(workspace, edition_id, keys, rules):
    require(isinstance(keys, list) and 1 <= len(keys) <= 1000 and
            all(isinstance(key, str) and KEY.fullmatch(key) for key in keys) and len(set(keys)) == len(keys),
            "PARCEL_REVIEW_BATCH", "Select up to 1,000 distinct original parcel keys.")
    require(isinstance(rules, dict) and set(rules) <=
            {"uniqueAssertions", "sourcePreferences", "accountableEntityId", "uniqueAssessment",
             "areaBasis", "uniqueGeometry", "replaceReviewed", "reason"} and
            all(type(rules.get(key, False)) is bool for key in
                ("uniqueAssertions", "uniqueAssessment", "uniqueGeometry", "replaceReviewed")) and
            rules.get("areaBasis") in (None, *AREA_BASES) and
            isinstance(rules.get("reason"), str) and 0 < len(rules["reason"].strip()) <= 4000,
            "PARCEL_REVIEW_RULES", "Choose the explicit preparation rules and their staff review reason.")
    preferences = rules.get("sourcePreferences", {})
    require(isinstance(preferences, dict) and set(preferences) <= {"owner", "status", "ward"} and
            all(isinstance(value, str) and value for value in preferences.values()),
            "PARCEL_REVIEW_RULES", "Select actual original source IDs for optional assertion preferences.")
    state = workspace.workspace.read()
    data = parcel_state(state)
    edition = workspace.edition(edition_id, state)
    index, reviews = workspace.index(edition), workspace.review_index(edition)
    known_sources = {item["sourceId"] for item in edition["inputs"]}
    require(set(preferences.values()) <= known_sources, "PARCEL_REVIEW_RULES",
            "The preferred source must belong to this received edition.")
    entity_id = rules.get("accountableEntityId")
    version = data["activeEntities"].get(entity_id) if entity_id is not None else None
    require(entity_id is None or version is not None, "PARCEL_ENTITY_REQUIRED",
            "Choose an existing reviewed accountable entity.")
    decisions, unresolved, preserved = [], [], 0
    for key in sorted(keys):
        row = workspace.row(edition, key, index=index)
        current = workspace.decision(edition, key, reviews=reviews)
        decision = decision_input(row, current)
        if current and not rules.get("replaceReviewed"):
            preserved += 1
            continue
        else:
            decision["reason"] = rules["reason"].strip()
            by_record = {item["id"]: item for item in row["records"]}
            if rules.get("uniqueAssertions"):
                for role, kind in (("owner", "owner-assertion"), ("status", "status-assertion"), ("ward", "ward-assertion")):
                    candidates = [claim for claim in row["claims"] if claim["kind"] == kind and
                                  (role not in preferences or by_record[claim["recordId"]]["sourceId"] == preferences[role])]
                    decision[role] = ({"mode": "source", "claimId": candidates[0]["id"]}
                                      if len(candidates) == 1 else {"mode": "unresolved"})
            if version is not None:
                decision["accountable"] = {"mode": "entity", "entityId": entity_id, "entityVersion": version}
            if rules.get("uniqueAssessment"):
                candidates = [record for record in row["records"] if record["family"] == "county-assessment-json"]
                decision["assessmentRecordId"] = candidates[0]["id"] if len(candidates) == 1 else None
            if rules.get("areaBasis") is not None:
                candidates = [claim for claim in row["claims"] if claim["kind"] == "area" and claim["basis"] == rules["areaBasis"]]
                decision["areaClaimId"] = candidates[0]["id"] if len(candidates) == 1 else None
            if rules.get("uniqueGeometry"):
                candidates = [claim for claim in row["claims"] if claim["kind"] == "geometry"]
                decision["geometryClaimId"] = candidates[0]["id"] if len(candidates) == 1 else None
        pending = [role for role in ("owner", "status", "ward") if decision[role]["mode"] == "unresolved"]
        if decision["accountable"]["mode"] == "unassigned": pending.append("accountable")
        pending.extend(field for field in ("assessmentRecordId", "areaClaimId", "geometryClaimId") if decision[field] is None)
        if pending: unresolved.append({"key": key, "fields": pending})
        decisions.append(decision)
    return {"editionId": edition["id"], "revision": state["revision"], "rules": copy.deepcopy(rules),
            "decisions": decisions, "preservedReviewed": preserved, "unresolved": unresolved,
            "preparationSha256": value_sha({"editionId": edition["id"], "rules": rules, "decisions": decisions})}

def preview(workspace, edition_id, decisions):
    require(isinstance(decisions, list) and 1 <= len(decisions) <= 1000 and
            all(isinstance(row, dict) and isinstance(row.get("key"), str) for row in decisions) and
            len({row["key"] for row in decisions}) == len(decisions),
            "PARCEL_REVIEW_BATCH", "Review up to 1,000 distinct original parcel keys.")
    state = workspace.workspace.read()
    data = parcel_state(state)
    edition = workspace.edition(edition_id, state)
    index, reviews = workspace.index(edition), workspace.review_index(edition)
    normalized = [workspace._normalize_decision(edition, workspace.row(edition, item["key"], index=index),
                  item, data, workspace.decision(edition, item["key"], reviews=reviews)) for item in decisions]
    return {"editionId": edition_id, "revision": state["revision"], "decisions": normalized,
            "previewSha256": value_sha({"editionId": edition_id, "decisions": normalized}),
            "summary": {"parcels": len(normalized),
                "withOwner": sum(row["owner"]["mode"] == "source" for row in normalized),
                "withAccountable": sum(row["accountable"]["mode"] == "entity" for row in normalized),
                "withAssessment": sum(row["assessmentRecordId"] is not None for row in normalized),
                "withArea": sum(row["area"] is not None for row in normalized),
                "withGeometry": sum(row["geometry"] is not None for row in normalized)}}
