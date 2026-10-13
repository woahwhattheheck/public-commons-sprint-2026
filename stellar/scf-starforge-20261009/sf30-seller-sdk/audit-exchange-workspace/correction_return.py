"""Source-bound colleague corrections for the original Audit Exchange workspace.

The public functions only read the caller's transaction. Complete archive
validation uses the maintained receiver with an ephemeral in-memory sink.
The caller retains the original ZIP and applies prepared results in its one
existing request/version transaction.
"""
from __future__ import annotations
import copy
import json
from collections import Counter
from urllib.parse import urlparse
from lxml import etree

from common import AuditError, canonical, decode64, digest, key, require, text
from exchange import SNAPSHOT_FORMAT, unpack_package
from model import inspect_xml, patch_document, validate_document

FORMAT = "commons.audit-exchange.correction-return.v1"
PLAN_FORMAT = "commons.audit-exchange.correction-plan.v1"
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024


class _ReceivingSink:
    """Reuse the whole native receiver without writing the operating workspace."""
    def __init__(self):
        self.records = {}
        self.objects = {}
        self.sequence = 0

    def _object(self, db, raw):
        identity = digest(raw)
        self.objects[identity] = raw
        return identity

    def _put(self, db, kind, value):
        self.records[(kind, value["id"])] = value

    def _export_record(self, db, raw, kind, name, **metadata):
        self.sequence += 1
        identity = "validation-export-" + str(self.sequence)
        row = {"id": identity, "kind": kind, "name": name, "bytes": len(raw),
               "sha256": self._object(db, raw), "downloadUrl": "/api/download/" + identity, **metadata}
        self._put(db, "export", row)
        return row


def _stable(value):
    """Remove only actual validator clock fields from a fingerprint."""
    if isinstance(value, list):
        return [_stable(item) for item in value]
    if isinstance(value, dict):
        return {name: _stable(item) for name, item in value.items()
                if name not in {"startedAt", "endedAt"}}
    return value


def _fingerprint(value):
    return digest(canonical(_stable(value)).encode("utf-8"))


def _summary(revision):
    return {name: copy.deepcopy(revision.get(name)) for name in (
        "id", "number", "parentId", "sha256", "bytes", "createdAt", "actor",
        "note", "selectedSchema", "profileIds", "declaredVersion")}


def _receiving_history(record):
    rows = record.get("receivedHistory", [])
    require(isinstance(rows, list), "return_provenance", "The complete receiving history must be a list")
    if record.get("receivedFrom") is not None:
        rows = rows + [record["receivedFrom"]]
    result = []
    for row in rows:
        require(isinstance(row, dict), "return_provenance", "A receiving history entry is not a native record")
        if all(isinstance(row.get(name), str) and row[name] for name in ("workspaceId", "recordId", "packageSha256")):
            result.append((row["workspaceId"], row["recordId"], row["packageSha256"]))
    return result


def _related(left, left_workspace, right, right_workspace, left_exports, right_exports):
    """Match exact native coordinates and known receiving package identities."""
    if left_workspace == right_workspace and left["id"] == right["id"]:
        return {"kind": "same-native-record", "workspaceId": left_workspace, "recordId": left["id"]}
    a, b = _receiving_history(left), _receiving_history(right)
    for origin, record_id, archive_sha in b:
        if origin == left_workspace and record_id == left["id"] and archive_sha in left_exports:
            return {"kind": "returned-original-record", "workspaceId": origin,
                    "recordId": record_id, "packageSha256": archive_sha}
    for origin, record_id, archive_sha in a:
        if origin == right_workspace and record_id == right["id"] and archive_sha in right_exports:
            return {"kind": "received-original-record", "workspaceId": origin,
                    "recordId": record_id, "packageSha256": archive_sha}
    common = sorted(set(a) & set(b))
    if common:
        origin, record_id, archive_sha = common[-1]
        return {"kind": "shared-received-record", "workspaceId": origin,
                "recordId": record_id, "packageSha256": archive_sha}
    return None


def _evidence(review):
    evidence = review.get("evidence", [])
    require(isinstance(evidence, list), "return_review_evidence", "The complete returned evidence must be a list")
    for item in evidence:
        require(isinstance(item, dict), "return_review_evidence", "Each original evidence link must be an object")
        text(item.get("label"), "evidence label", blank=False)
        url = text(item.get("url"), "evidence URL", blank=False)
        require(urlparse(url).scheme in {"http", "https"}, "return_review_evidence",
                "Review evidence must retain an ordinary HTTP or HTTPS URL")
    return evidence


def _load(workspace, db, inputs):
    require(isinstance(inputs, dict), "return_input", "Colleague-return inputs must be an object")
    raw = decode64(inputs.get("contentBase64"), maximum=MAX_ARCHIVE_BYTES)
    name = text(inputs.get("name"), "name", blank=False)
    manifest, members = unpack_package(raw)
    require(manifest.get("kind") in {"workspace", "application"} and "workspace.json" in members,
            "return_package", "Select the complete original Audit workspace or application ZIP")
    try:
        snapshot = json.loads(members["workspace.json"])
    except (ValueError, UnicodeError) as error:
        raise AuditError("return_snapshot", "The returned native workspace is unreadable") from error
    require(isinstance(snapshot, dict) and snapshot.get("format") == SNAPSHOT_FORMAT,
            "return_snapshot", "The returned workspace format is unsupported")
    # The maintained receiver checks every source chain, original object, saved
    # edition, source-bound review/link, complete analysis and eight-table export.
    # It receives its own independently parsed snapshot; this original stays exact.
    sink = _ReceivingSink()
    type(workspace)._receive(sink, None, raw, {"actor": "Read-only colleague source inspection"})
    records = snapshot["records"]
    original = {}
    for record in records:
        original.setdefault(record["kind"], {})[record["id"]] = record["payload"]
    # The original receiver validates review/source bindings. Validate every
    # displayed current and historical evidence link before a browser preview.
    reviews = list(original.get("review", {}).values())
    for edition in original.get("edition", {}).values():
        reviews.extend(edition.get("reviews", []))
    for review in reviews:
        _evidence(review)
        for historical in review.get("history", []):
            _evidence(historical)
    rebuilt = {}
    for (kind, _), value in sink.records.items():
        if kind == "revision":
            rebuilt[value["receivedFrom"]["recordId"]] = {
                "model": value["model"], "validation": value["validation"]}
    objects = {row["sha256"]: members[row["path"]] for row in snapshot["objects"]}
    local_meta = workspace._meta(db)
    local = {kind: {row["id"]: row for row in workspace._all(db, kind)}
             for kind in ("source", "revision", "review")}
    local_exports = {row["sha256"] for row in workspace._all(db, "export")
                     if isinstance(row.get("sha256"), str)}
    for row in workspace._all(db, "received-export"):
        original_export = row.get("original", {})
        if isinstance(original_export, dict) and isinstance(original_export.get("sha256"), str):
            local_exports.add(original_export["sha256"])
    return {
        "workspace": workspace, "db": db, "raw": raw, "manifest": manifest,
        "snapshot": snapshot, "objects": objects, "original": original, "rebuilt": rebuilt,
        "local": local, "localMeta": local_meta,
        "localExports": local_exports,
        "returnedExports": {row["sha256"] for row in snapshot.get("priorExports", [])
                            if isinstance(row.get("sha256"), str)},
        "archive": {"name": name, "sha256": digest(raw), "bytes": len(raw),
                    "kind": manifest["kind"], "origin": copy.deepcopy(snapshot["workspace"]),
                    "selectedEditionId": snapshot.get("selectedEditionId"),
                    "memberCount": len(manifest["members"])},
        "xmlCache": {},
    }


def _xml(context, side, revision):
    cache_key = (side, revision["id"])
    if cache_key in context["xmlCache"]:
        return context["xmlCache"][cache_key]
    if side == "local":
        raw = context["workspace"]._bytes(context["db"], revision["sha256"])
        source = context["local"]["source"][revision["sourceId"]]
    else:
        raw = context["objects"][revision["sha256"]]
        source = context["original"]["source"][revision["sourceId"]]
    require(digest(raw) == revision["sha256"] and len(raw) == revision["bytes"],
            "return_revision", "A complete selected native source revision differs")
    model, tree, nodes = inspect_xml(raw, source["nativeIdentity"])
    shape = []
    if tree is not None:
        for path, node in nodes.items():
            children = []
            for child in node:
                if isinstance(child.tag, str):
                    children.append({"kind": "element", "tag": child.tag})
                else:
                    children.append({"kind": "node", "type": type(child).__name__,
                                     "text": child.text, "target": getattr(child, "target", None)})
                if child.tail is not None and child.tail.strip():
                    children[-1]["tail"] = child.tail
            shape.append({"path": path, "tag": node.tag,
                          "attributes": sorted(node.attrib),
                          "children": children,
                          "mixedText": node.text if any(isinstance(c.tag, str) for c in node) else None,
                          "leafTextPresent": (node.text is not None) if not any(isinstance(c.tag, str) for c in node) else None})
        surrounding = []
        root = tree.getroot()
        cursor = root.getprevious()
        while cursor is not None:
            surrounding.insert(0, {"type": type(cursor).__name__, "text": cursor.text,
                                   "target": getattr(cursor, "target", None)})
            cursor = cursor.getprevious()
        cursor = root.getnext()
        while cursor is not None:
            surrounding.append({"type": type(cursor).__name__, "text": cursor.text,
                                "target": getattr(cursor, "target", None)})
            cursor = cursor.getnext()
        shape.append({"documentNodes": surrounding})
    result = {"raw": raw, "model": model, "treeAvailable": tree is not None,
              "shape": shape, "shapeSha256": _fingerprint(shape)}
    context["xmlCache"][cache_key] = result
    return result


def _cells(model):
    result = {}
    for field in model["fields"]:
        identity = (field["path"], field["kind"], field.get("attributeName"))
        require(identity not in result, "return_field", "The native field inventory repeats an identity")
        result[identity] = field
    return result


def _cell(field):
    if field is None:
        return None
    return {"value": field["value"], "presentText": field.get("presentText"),
            "editable": bool(field.get("editable")), "entityKey": field["entityKey"],
            "fieldKey": field["key"], "namespace": field.get("namespace", "")}


def _cell_value(field):
    return None if field is None else (field["value"], field.get("presentText"))


def _shape_summary(base, current, returned):
    maps = [{r["path"]: r for r in item["shape"] if "path" in r}
            for item in (base, current, returned)]
    added, removed, changed = [], [], []
    for path in sorted(set(maps[0]) | set(maps[1]) | set(maps[2])):
        values = [m.get(path) for m in maps]
        if values[0] == values[1] == values[2]:
            continue
        row = {"path": path, "baseline": values[0], "current": values[1], "returned": values[2]}
        if values[0] is None:
            added.append(row)
        elif values[1] is None or values[2] is None:
            removed.append(row)
        else:
            changed.append(row)
    moved = []
    # A same-size reorder of uniquely identified siblings is structural even
    # when expanded-name positional paths still have the same shape.
    identities = []
    for item in (base, current, returned):
        rows = [e for e in item["model"]["entities"] if e.get("xmlId")]
        counts = Counter((e["namespace"], e["kind"], e["xmlId"]) for e in rows)
        identities.append({(e["namespace"], e["kind"], e["xmlId"]): e["path"]
                           for e in rows if counts[(e["namespace"], e["kind"], e["xmlId"])] == 1})
    for identity in sorted(set(identities[0]) | set(identities[1]) | set(identities[2])):
        positions = [items.get(identity) for items in identities]
        present = [p for p in positions if p is not None]
        if len(set(present)) > 1:
            moved.append({"namespace": identity[0], "kind": identity[1], "xmlId": identity[2],
                          "baseline": positions[0], "current": positions[1], "returned": positions[2]})
    compatible = (all(item["treeAvailable"] for item in (base, current, returned))
                  and base["shapeSha256"] == current["shapeSha256"] == returned["shapeSha256"]
                  and not moved)
    return {"compatible": compatible, "added": added, "removed": removed, "changed": changed, "moved": moved,
            "baselineShapeSha256": base["shapeSha256"],
            "currentShapeSha256": current["shapeSha256"], "returnedShapeSha256": returned["shapeSha256"],
            "treeAvailable": {"baseline": base["treeAvailable"], "current": current["treeAvailable"],
                              "returned": returned["treeAvailable"]}}


def _compare(context, source, baseline, current, returned):
    views = (_xml(context, "local", baseline), _xml(context, "local", current),
             _xml(context, "returned", returned))
    structural = _shape_summary(*views)
    maps = [_cells(view["model"]) for view in views]
    rows = []
    for identity in sorted(set(maps[0]) | set(maps[1]) | set(maps[2]),
                           key=lambda item: (item[0], item[1], item[2] or "")):
        values = [m.get(identity) for m in maps]
        b, c, r = [_cell_value(item) for item in values]
        if b == c == r:
            status = "unchanged"
        elif any(item is None for item in values):
            status = "structural"
        elif c == r:
            status = "same-change"
        elif c == b:
            status = "returned-change"
        elif r == b:
            status = "author-change"
        else:
            status = "conflict"
        exemplar = next(item for item in values if item is not None)
        rows.append({"fieldId": "return-field-" + key(source["nativeIdentity"], identity[0], identity[1], identity[2] or "")[:32],
                     "path": identity[0], "kind": identity[1], "attributeName": identity[2],
                     "name": exemplar["name"], "baseline": _cell(values[0]),
                     "current": _cell(values[1]), "returned": _cell(values[2]), "status": status,
                     "patchable": structural["compatible"] and all(v is not None and v["editable"] for v in values)})
    return rows, structural


def _pairs(context):
    local_sources = context["local"]["source"]
    returned_sources = context["original"].get("source", {})
    local_revisions = context["local"]["revision"]
    returned_revisions = context["original"].get("revision", {})
    pairs, unmatched = [], []
    left_workspace = context["localMeta"]["workspaceId"]
    right_workspace = context["snapshot"]["workspace"]["workspaceId"]
    for returned_source in returned_sources.values():
        candidates = []
        for source in local_sources.values():
            if (source.get("nativeIdentity") != returned_source.get("nativeIdentity")
                    or source.get("originalSha256") != returned_source.get("originalSha256")):
                continue
            source_provenance = _related(source, left_workspace, returned_source, right_workspace,
                                         context["localExports"], context["returnedExports"])
            if not source_provenance:
                continue
            original_raw = context["workspace"]._bytes(context["db"], source["originalSha256"])
            if original_raw != context["objects"].get(returned_source["originalSha256"]):
                continue
            baselines = []
            for local_revision in local_revisions.values():
                if local_revision["sourceId"] != source["id"]:
                    continue
                for returned_revision in returned_revisions.values():
                    if (returned_revision["sourceId"] != returned_source["id"]
                            or local_revision["sha256"] != returned_revision["sha256"]):
                        continue
                    provenance = _related(local_revision, left_workspace, returned_revision, right_workspace,
                                          context["localExports"], context["returnedExports"])
                    if provenance and context["workspace"]._bytes(context["db"], local_revision["sha256"]) == context["objects"][returned_revision["sha256"]]:
                        baselines.append({"revision": local_revision, "returnedRevision": returned_revision,
                                          "provenance": provenance})
            if baselines:
                baselines.sort(key=lambda row: (row["revision"]["number"], row["returnedRevision"]["number"], row["returnedRevision"]["id"]))
                candidates.append({"source": source, "returnedSource": returned_source,
                                   "provenance": source_provenance, "baselines": baselines})
        if not candidates:
            unmatched.append({"returnedSourceId": returned_source["id"], "name": returned_source["name"],
                              "nativeIdentity": returned_source["nativeIdentity"],
                              "originalSha256": returned_source["originalSha256"],
                              "reason": "No original source and revision have matching complete bytes and exact receiving provenance."})
        else:
            pairs.extend(candidates)
    return pairs, unmatched


def _baseline_requests(inputs):
    rows = inputs.get("baselines", [])
    require(isinstance(rows, list), "return_baseline", "Baselines must be an explicit list")
    result = {}
    for row in rows:
        require(isinstance(row, dict), "return_baseline", "Every baseline selection must be an object")
        identity = (text(row.get("sourceId"), "sourceId", blank=False),
                    text(row.get("returnedSourceId"), "returnedSourceId", blank=False))
        require(identity not in result, "return_baseline", "Select one baseline per original/returned source pair")
        result[identity] = text(row.get("baselineRevisionId"), "baselineRevisionId", blank=False)
    return result


def _preview(context, inputs):
    pairs, unmatched = _pairs(context)
    requested = _baseline_requests(inputs)
    rows, internals = [], {}
    for pair in pairs:
        source, returned_source = pair["source"], pair["returnedSource"]
        identity = (source["id"], returned_source["id"])
        baseline_id = requested.pop(identity, None)
        options = pair["baselines"]
        if baseline_id is None:
            chosen = options[-1]
        else:
            options_with_id = [entry for entry in options if entry["revision"]["id"] == baseline_id]
            require(options_with_id, "return_baseline", "The selected baseline is not a proven complete common revision")
            chosen = options_with_id[-1]
        baseline = chosen["revision"]
        current = context["local"]["revision"][source["currentRevisionId"]]
        returned = context["original"]["revision"][returned_source["currentRevisionId"]]
        fields, structural = _compare(context, source, baseline, current, returned)
        reviews = [copy.deepcopy(r) for r in context["original"].get("review", {}).values()
                   if r["sourceId"] == returned_source["id"]]
        key_value = source["id"] + ":" + returned_source["id"]
        candidates = {}
        for candidate in pair["baselines"]:
            revision = candidate["revision"]
            candidates.setdefault(revision["id"], {**_summary(revision), "returnedRevisionIds": [], "provenance": []})
            candidates[revision["id"]]["returnedRevisionIds"].append(candidate["returnedRevision"]["id"])
            candidates[revision["id"]]["provenance"].append(candidate["provenance"])
        row = {"sourceKey": key_value, "sourceId": source["id"], "returnedSourceId": returned_source["id"],
               "name": source["name"], "returnedName": returned_source["name"],
               "nativeIdentity": source["nativeIdentity"], "originalSha256": source["originalSha256"],
               "provenance": pair["provenance"], "baselineCandidates": list(candidates.values()),
               "baseline": _summary(baseline), "current": _summary(current), "returned": _summary(returned),
               "fields": fields, "changedFields": [field for field in fields if field["status"] != "unchanged"],
               "structuralSummary": structural, "reviews": reviews,
               "returnedValidation": copy.deepcopy(context["rebuilt"][returned["id"]]["validation"]),
               "returnedSource": copy.deepcopy(returned_source)}
        rows.append(row)
        internals[key_value] = {"source": source, "returnedSource": returned_source, "baseline": baseline,
                                "current": current, "returned": returned, "row": row}
    require(not requested, "return_baseline", "A selected baseline refers to an unmatched original source")
    result = {"format": FORMAT, "workspaceId": context["localMeta"]["workspaceId"],
              "workspaceVersion": context["localMeta"]["version"], "archive": context["archive"],
              "sources": rows, "unmatchedSources": unmatched}
    result["previewSha256"] = _fingerprint(result)
    return result, internals


def preview(workspace, db, inputs):
    result, _ = _preview(_load(workspace, db, inputs), inputs)
    return result


def _review_target(context, review, final_model):
    entity_key = review.get("entityKey", "")
    if not entity_key:
        return "", {"mode": "source", "originalEntityKey": ""}
    original_revision = context["original"]["revision"][review["revisionId"]]
    original_model = context["rebuilt"][original_revision["id"]]["model"]
    originals = [row for row in original_model["entities"] if row["key"] == entity_key]
    require(len(originals) == 1, "return_review", "The selected returned review has no one original native entity")
    original = originals[0]
    candidates = [row for row in final_model["entities"]
                  if row["namespace"] == original["namespace"] and row["kind"] == original["kind"]]
    if original["xmlId"]:
        candidates = [row for row in candidates if row["xmlId"] == original["xmlId"]]
        original_matches = [row for row in original_model["entities"]
                            if row["namespace"] == original["namespace"] and row["kind"] == original["kind"]
                            and row["xmlId"] == original["xmlId"]]
        if original.get("nativeIdentity"):
            original_matches = [row for row in original_model["entities"]
                                if row.get("nativeIdentity") and row.get("normalizedXmlId") == original.get("normalizedXmlId")]
            accepted_matches = [row for row in final_model["entities"]
                                if row.get("nativeIdentity") and row.get("normalizedXmlId") == original.get("normalizedXmlId")]
        else:
            accepted_matches = candidates
        require(len(original_matches) == 1 and len(candidates) == 1 and len(accepted_matches) == 1,
                "return_review_target", "The returned review's native ID is ambiguous or absent in the accepted source",
                {"reviewId": review["id"], "entityKey": entity_key})
        mode = "unique-native-id"
    else:
        # An anonymous structural entity is safe only when its complete element
        # layout stayed identical. A path alone cannot match reordered records.
        old_xml = _xml(context, "returned", original_revision)
        final_raw = context.get("finalRaw")
        final_parsed, final_tree, final_nodes = inspect_xml(final_raw, context["original"]["source"][review["sourceId"]]["nativeIdentity"])
        require(final_tree is not None, "return_review_target", "The accepted XML has no editable entity tree")
        candidates = [row for row in candidates if row["path"] == original["path"]]
        require(len(candidates) == 1, "return_review_target", "The returned anonymous review target is absent")
        candidate = candidates[0]
        _, old_tree, old_nodes = inspect_xml(old_xml["raw"], context["original"]["source"][review["sourceId"]]["nativeIdentity"])
        original_node = old_nodes.get(original["path"])
        target_node = final_nodes.get(candidate["path"])
        require(old_tree is not None and original_node is not None and target_node is not None
                and etree.tostring(original_node, method="c14n", with_comments=True)
                    == etree.tostring(target_node, method="c14n", with_comments=True),
                "return_review_target", "An anonymous returned review target changed; review it against its original source",
                {"reviewId": review["id"], "entityKey": entity_key})
        mode = "unchanged-anonymous-source"
    target = candidates[0]
    return target["key"], {"mode": mode, "originalEntityKey": entity_key,
                           "targetEntityKey": target["key"], "xmlId": original["xmlId"],
                           "originalPath": original["path"], "targetPath": target["path"]}


def _selected_reviews(context, selection, returned_source_id, final_model):
    selected = selection.get("reviewIds", [])
    require(isinstance(selected, list) and all(isinstance(x, str) and x for x in selected)
            and len(set(selected)) == len(selected), "return_reviews", "Choose distinct complete returned review IDs")
    originals = context["original"].get("review", {})
    results = []
    for identity in selected:
        require(identity in originals and originals[identity]["sourceId"] == returned_source_id,
                "return_review_source", "A selected review belongs to another returned source")
        review = originals[identity]
        text(review.get("title"), "returned review title", blank=False)
        _evidence(review)
        entity_key, mapping = _review_target(context, review, final_model)
        results.append({
            "original": copy.deepcopy(review), "targetEntityKey": entity_key, "mapping": mapping,
            "fields": {name: copy.deepcopy(review.get(name, [] if name == "evidence" else ""))
                       for name in ("title", "status", "assignee", "dueDate", "note", "evidence")},
            "provenance": {"workspaceId": context["snapshot"]["workspace"]["workspaceId"],
                           "recordId": review["id"], "sourceId": review["sourceId"],
                           "revisionId": review["revisionId"], "packageSha256": context["archive"]["sha256"]},
        })
    return results


def prepare(workspace, db, inputs):
    context = _load(workspace, db, inputs)
    selections = inputs.get("selections")
    require(isinstance(selections, list) and selections, "return_selections",
            "Select at least one complete source decision")
    # The exact baseline chosen in the preview is also supplied in each reviewed
    # selection. Other preview rows retain their explicit preview baseline.
    preview_inputs = copy.deepcopy(inputs)
    baselines = _baseline_requests(inputs)
    for selection in selections:
        require(isinstance(selection, dict), "return_selection", "Each selected source decision must be an object")
        identity = (text(selection.get("sourceId"), "sourceId", blank=False),
                    text(selection.get("returnedSourceId"), "returnedSourceId", blank=False))
        selected_baseline = text(selection.get("baselineRevisionId"), "baselineRevisionId", blank=False)
        require(identity not in baselines or baselines[identity] == selected_baseline,
                "return_baseline", "The selected source baseline differs from its preview")
        baselines[identity] = selected_baseline
    preview_inputs["baselines"] = [{"sourceId": s, "returnedSourceId": r, "baselineRevisionId": b}
                                  for (s, r), b in baselines.items()]
    viewed, internals = _preview(context, preview_inputs)
    require(inputs.get("expectedPreviewSha256") == viewed["previewSha256"], "return_changed",
            "The original source or selected return preview changed; review it again",
            {"previewSha256": viewed["previewSha256"], "workspaceVersion": viewed["workspaceVersion"]}, 409)
    prepared, public_sources = [], []
    seen_sources, seen_returned = set(), set()
    for selection in selections:
        source_id, returned_id = selection["sourceId"], selection["returnedSourceId"]
        source_key = source_id + ":" + returned_id
        require(source_key in internals and source_id not in seen_sources and returned_id not in seen_returned,
                "return_selection", "Apply each selected original and returned source once")
        seen_sources.add(source_id); seen_returned.add(returned_id)
        pair = internals[source_key]
        source, previous, returned = pair["source"], pair["current"], pair["returned"]
        require(selection.get("expectedCurrentRevisionId") == previous["id"]
                and selection.get("expectedCurrentSha256") == previous["sha256"],
                "return_current_changed", "The current native source changed after review",
                {"sourceId": source_id, "currentRevisionId": previous["id"], "sha256": previous["sha256"]}, 409)
        mode = selection.get("mode")
        require(mode in {"fields", "current", "returned-document"}, "return_mode",
                "Choose explicit field decisions, the complete current source, or the complete returned source")
        note = text(selection.get("note", ""), "source decision note")
        decisions = selection.get("decisions", [])
        require(isinstance(decisions, list), "return_decisions", "Field decisions must be a list")
        patches = []
        current_raw = _xml(context, "local", previous)["raw"]
        if mode != "fields":
            require(not decisions, "return_decisions", "A complete-document decision cannot also apply positional field edits")
            raw = current_raw if mode == "current" else _xml(context, "returned", returned)["raw"]
        else:
            row = pair["row"]
            require(row["structuralSummary"]["compatible"], "return_structure",
                    "Structural changes require an explicit complete current or returned document decision")
            allowed = {field["fieldId"]: field for field in row["changedFields"]}
            chosen = {}
            for decision in decisions:
                require(isinstance(decision, dict) and decision.get("fieldId") in allowed,
                        "return_field", "A decision must identify a displayed changed native field")
                field_id = decision["fieldId"]
                require(field_id not in chosen, "return_field", "Choose one decision for each changed field")
                choice = decision.get("choice")
                require(choice in {"current", "returned", "custom"}, "return_choice",
                        "Choose current, returned or an explicitly authored native string")
                field = allowed[field_id]
                require(field["patchable"] or choice == "current", "return_field",
                        "This complete field cannot be patched; keep current or select a whole document")
                if choice == "custom":
                    value = text(decision.get("value"), "custom field value")
                else:
                    value = field[choice]["value"]
                chosen[field_id] = {"fieldId": field_id, "choice": choice, "value": value}
                if value != field["current"]["value"]:
                    patches.append({"path": field["path"], "kind": field["kind"],
                                    "attributeName": field["attributeName"],
                                    "expected": field["current"]["value"], "value": value})
            require(set(chosen) == set(allowed), "return_decisions",
                    "Record an explicit choice for every changed field before applying",
                    {"missingFieldIds": sorted(set(allowed) - set(chosen))})
            raw = patch_document(current_raw, source["nativeIdentity"], patches) if patches else current_raw
        model, validation = validate_document(raw, source["nativeIdentity"], previous["selectedSchema"], previous["profileIds"])
        if mode == "fields":
            actual_fields = _cells(model)
            expected_fields = pair["row"]["fields"]
            require(set(actual_fields) == {(field["path"], field["kind"], field["attributeName"]) for field in expected_fields},
                    "return_patch_result", "Native field correction changed the complete source layout; choose a full document")
            for field in expected_fields:
                identity = (field["path"], field["kind"], field["attributeName"])
                actual = actual_fields[identity]
                decision = chosen.get(field["fieldId"])
                if decision and decision["choice"] == "custom":
                    matches = actual["value"] == decision["value"]
                else:
                    selected_cell = field[decision["choice"]] if decision else field["current"]
                    matches = (actual["value"], actual.get("presentText")) == (
                        selected_cell["value"], selected_cell["presentText"])
                require(matches, "return_patch_result",
                        "The native patch cannot represent this complete selected value/text presence; choose a full document",
                        {"fieldId": field["fieldId"], "path": field["path"], "actual": _cell(actual)})
        context["finalRaw"] = raw
        reviews = _selected_reviews(context, selection, returned_id, model)
        metadata = {"archive": copy.deepcopy(context["archive"]), "sourceKey": source_key,
                    "baseline": copy.deepcopy(pair["row"]["baseline"]),
                    "current": _summary(previous), "returned": _summary(returned),
                    "provenance": copy.deepcopy(pair["row"]["provenance"]), "mode": mode,
                    "decisions": copy.deepcopy(decisions), "note": note,
                    "reviewIds": list(selection.get("reviewIds", []))}
        public = {"sourceKey": source_key, "sourceId": source_id, "returnedSourceId": returned_id,
                  "baseline": copy.deepcopy(pair["row"]["baseline"]), "current": _summary(previous),
                  "returned": _summary(returned), "mode": mode,
                  "result": {"sha256": digest(raw), "bytes": len(raw), "changed": raw != current_raw},
                  "patches": copy.deepcopy(patches), "validation": validation,
                  "reviewCount": len(reviews), "reviews": copy.deepcopy(reviews), "note": note,
                  "metadata": metadata}
        public_sources.append(public)
        prepared.append({"source": copy.deepcopy(source), "previous": copy.deepcopy(previous),
                         "raw": raw, "patches": patches, "model": model, "validation": validation,
                         "returnedReviews": reviews, "metadata": metadata,
                         "changed": raw != current_raw})
    public_plan = {"format": PLAN_FORMAT, "workspaceId": viewed["workspaceId"],
                   "workspaceVersion": viewed["workspaceVersion"], "archive": context["archive"],
                   "previewSha256": viewed["previewSha256"], "sources": public_sources}
    public_plan["planSha256"] = _fingerprint(public_plan)
    return {"publicPlan": public_plan, "archiveRaw": context["raw"], "preparedSources": prepared}
