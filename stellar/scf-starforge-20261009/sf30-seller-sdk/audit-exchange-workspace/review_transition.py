"""Explicit review decisions across retained native source revisions."""
from __future__ import annotations
import copy
import html
import json
from common import canonical, digest, now, require, text
from exchange import package_bytes
from model import compare_models

READ_ACTIONS = {"review.transition.preview", "review.transition.history"}
WRITE_ACTIONS = {"review.transition.apply"}
FORMAT = "commons.audit-review-transition.v1"
FIELDS = {"entityKey", "status", "title", "note", "assignee", "dueDate", "evidence"}
MAX_PREVIEW = 64 * 1024 * 1024

def encoded(value):
    return (canonical(value) + "\n").encode("utf-8")

def budget(value, used=0):
    # Bound cumulative complete comparisons before a large selection accumulates
    # hundreds of repeated document-wide row lists or one huge serialized body.
    encoder = json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    for part in encoder.iterencode(value):
        for offset in range(0, len(part), 64 * 1024):
            used += len(part[offset:offset + 64 * 1024].encode("utf-8"))
            require(used <= MAX_PREVIEW, "transition_capacity", "The complete review comparison exceeds 64 MiB; select fewer reviews.")
    return used

def entity_scope(model, selected):
    if not selected:
        return {row["key"] for row in model["entities"]}
    keys = {selected}
    while True:
        extended = keys | {row["key"] for row in model["entities"] if row.get("parentKey") in keys}
        if extended == keys:
            return keys
        keys = extended

def impact(before, after, selected, comparison):
    old = entity_scope(before, selected)
    new = entity_scope(after, selected)
    result = {
        "added": [row for row in comparison["added"] if row["entityKey"] in new],
        "removed": [row for row in comparison["removed"] if row["entityKey"] in old],
        "changed": [row for row in comparison["changed"] if row["before"]["entityKey"] in old or row["after"]["entityKey"] in new],
        "referenceChanges": [row for row in comparison["referenceChanges"]
                             if not selected or row["reference"].get("fromKey") in old | new
                             or row["reference"].get("targetKey") in old | new
                             or bool(set(row["reference"].get("targetKeys", [])) & (old | new))],
    }
    result["counts"] = {name: len(rows) for name, rows in result.items()}
    return result

def preview(ws, db, inputs):
    source_id = text(inputs.get("sourceId"), "sourceId", blank=False)
    target_id = text(inputs.get("toRevisionId"), "toRevisionId", blank=False)
    selected = inputs.get("reviewIds")
    require(isinstance(selected, list) and 1 <= len(selected) <= 250
            and all(isinstance(item, str) and item for item in selected)
            and len(set(selected)) == len(selected), "transition_selection",
            "Choose one to 250 distinct retained reviews.")
    source = ws._get(db, "source", source_id)
    require(source["currentRevisionId"] == target_id, "transition_target",
            "Select the current revision of this original source.", status=409)
    target = ws._get(db, "revision", target_id)
    require(target["sourceId"] == source_id, "transition_target", "The target revision belongs to another source.")
    target_entities = {row["key"]: row for row in target["model"]["entities"]}
    revisions, rows = {}, []
    used = budget({"targetEntities": target["model"]["entities"], "targetValidation": target["validation"]})
    for review_id in selected:
        review = ws._get(db, "review", review_id)
        require(review["sourceId"] == source_id, "transition_review", "Every selected review must belong to this original source.")
        previous = ws._get(db, "revision", review["revisionId"])
        require(previous["sourceId"] == source_id and previous["number"] < target["number"],
                "transition_revision", "Select reviews retained on an earlier source revision.")
        if previous["id"] not in revisions:
            previous_comparison = {
                "revision": ws._revision_summary(previous), "validation": previous["validation"],
                "comparison": compare_models(previous["model"], target["model"]),
            }
            used = budget(previous_comparison, used)
            revisions[previous["id"]] = previous_comparison
        selected_entity = review.get("entityKey", "")
        old_entity = next((r for r in previous["model"]["entities"] if r["key"] == selected_entity), None)
        require(not selected_entity or old_entity is not None, "transition_review", "The retained review has an absent original entity.")
        current_entity = target_entities.get(selected_entity)
        row = {"review": copy.deepcopy(review),
                     "reviewSha256": digest(encoded(review)),
                     "fromRevisionId": previous["id"], "beforeEntity": old_entity,
                     "samePathEntity": current_entity,
                     "identityChanged": bool(selected_entity and (not current_entity or
                         any(old_entity.get(k) != current_entity.get(k) for k in ("xmlId", "namespace", "kind")))),
                     "impact": impact(previous["model"], target["model"], selected_entity, revisions[previous["id"]]["comparison"])}
        used = budget(row, used)
        rows.append(row)
    value = {"format": FORMAT, "workspaceId": ws._meta(db)["workspaceId"],
             "version": ws._meta(db)["version"], "sourceId": source_id, "sourceName": source["name"],
             "toRevision": ws._revision_summary(target), "targetValidation": target["validation"],
             "targetEntities": target["model"]["entities"], "fromRevisions": revisions, "reviews": rows,
             "selection": {"sourceId": source_id, "toRevisionId": target_id, "reviewIds": list(selected)}}
    raw = encoded(value)
    require(len(raw) <= MAX_PREVIEW, "transition_capacity",
            "This complete review comparison exceeds 64 MiB; select fewer reviews.")
    value["previewSha256"] = digest(raw)
    return value

def read(ws, db, action, inputs):
    if action == "review.transition.preview":
        return preview(ws, db, inputs)
    return {"workspaceId": ws._meta(db)["workspaceId"],
            "archives": [row for row in ws._all(db, "export") if row["kind"] == "review-transition"]}

def write(ws, db, action, inputs):
    require(action == "review.transition.apply", "transition_action", "Unknown review transition.")
    original = preview(ws, db, inputs)
    require(inputs.get("previewSha256") == original["previewSha256"], "transition_changed",
            "The source or a retained review has changed. Preview this exact selection again.", status=409)
    actor = text(inputs.get("actor"), "actor", blank=False)
    note = text(inputs.get("note", ""), "note")
    choices = inputs.get("decisions")
    require(isinstance(choices, list) and len(choices) == len(original["reviews"]),
            "transition_decisions", "Record an explicit decision for every selected review.")
    expected_ids = [row["review"]["id"] for row in original["reviews"]]
    require(all(isinstance(row, dict) for row in choices)
            and [row.get("reviewId") for row in choices] == expected_ids,
            "transition_decisions", "Decisions must preserve the complete selected review order.")
    # Validate complete shapes before the first original review.save. Further native
    # field/entity/evidence validation shares this same SQLite transaction.
    for choice in choices:
        mode = choice.get("mode")
        require(mode in {"retain", "update"}, "transition_decision", "Explicitly retain the earlier review or update it on the current revision.")
        expected_keys = {"reviewId", "mode", "reason"} | ({"review"} if mode == "update" else set())
        require(set(choice) == expected_keys, "transition_decision", "A decision has unsupported or incomplete fields.")
        text(choice["reason"], "decision reason", blank=False)
        if mode == "update":
            require(isinstance(choice["review"], dict) and set(choice["review"]) == FIELDS,
                    "transition_review", "An update needs the complete reviewed fields and explicit entity selection.")
            require(all(isinstance(choice["review"][field], str) for field in FIELDS - {"evidence"}),\
                    "transition_fields", "Every reviewed scalar must remain complete text.")
    selected_revisions = set(original["fromRevisions"]) | {original["toRevision"]["id"]}
    require(sum(ws._get(db, "revision", identity)["bytes"] for identity in selected_revisions) <= 512 * 1024 * 1024,
            "transition_capacity", "The complete selected XML exceeds 512 MiB; review fewer revision groups in one decision.")
    before = [copy.deepcopy(row["review"]) for row in original["reviews"]]
    after, updated, retained = [], [], []
    for choice in choices:
        identity = choice["reviewId"]
        if choice["mode"] == "update":
            ws._write(db, "review.save", {"id": identity, "sourceId": original["sourceId"],
                "revisionId": original["toRevision"]["id"], "actor": actor, **copy.deepcopy(choice["review"])})
            updated.append(identity)
        else:
            retained.append(identity)
        after.append(copy.deepcopy(ws._get(db, "review", identity)))
    record = {"format": FORMAT, "workspaceId": original["workspaceId"],
              "versionBefore": original["version"], "versionAfter": original["version"] + 1,
              "createdAt": now(), "actor": actor, "note": note, "preview": original,
              "decisions": copy.deepcopy(choices), "before": before, "after": after}
    members = {"review-transition.json": encoded(record)}
    for revision_id in sorted(selected_revisions):
        revision = ws._get(db, "revision", revision_id)
        raw = ws._bytes(db, revision["sha256"])
        require(len(raw) == revision["bytes"] and digest(raw) == revision["sha256"],
                "transition_source", "A complete retained original source differs.")
        members["sources/" + revision_id + ".xml"] = raw
    def escaped(value):
        return html.escape(str(value))
    table = "".join("<tr><td>" + escaped(old["title"]) + "</td><td>" + escaped(choice["mode"]) +
                    "</td><td>" + escaped(choice["reason"]) + "</td><td>" + escaped(new["status"]) +
                    "</td><td>" + escaped(new["assignee"]) + "</td><td>" + escaped(new["revisionId"]) + "</td></tr>"
                    for old, new, choice in zip(before, after, choices))
    members["OPEN.html"] = ("""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Audit revision review</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1100px;margin:2rem auto;padding:0 1rem}
h1{line-height:1.2}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;border:1px solid #bbb;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.wrap{overflow-x:auto}a{color:#222}code{overflow-wrap:anywhere}</style><h1>Audit revision review</h1><p>""" +
        escaped(original["sourceName"]) + " · " + escaped(actor) + " · " + escaped(record["createdAt"]) +
        "</p><p>" + escaped(note) + """</p><p><a href="review-transition.json">Complete decision, native comparison and before/after history</a></p>
<div class="wrap"><table><thead><tr><th>Review</th><th>Decision</th><th>Reason</th><th>Resulting status</th><th>Assignee</th><th>Retained revision</th></tr></thead><tbody>""" +
        table + "</tbody></table></div><p>Every selected original XML revision is included in sources/. Retained earlier reviews remain on their original revision; an update records a staff decision, not automated closure.</p></html>").encode("utf-8")
    raw = package_bytes(members, kind="review-transition",
                        summary={"workspaceId": original["workspaceId"], "sourceId": original["sourceId"],
                                 "previewSha256": original["previewSha256"], "updated": updated, "retained": retained})
    archive = ws._export_record(db, raw, "review-transition", "Audit_Revision_Review.zip",
                               sourceId=original["sourceId"], revisionId=original["toRevision"]["id"],
                               transition={"workspaceId": original["workspaceId"],
                                           "previewSha256": original["previewSha256"], "updated": updated, "retained": retained})
    return {"archive": archive, "updated": updated, "retained": retained,
            "previewSha256": original["previewSha256"], "sourceId": original["sourceId"],
            "revisionId": original["toRevision"]["id"]}
