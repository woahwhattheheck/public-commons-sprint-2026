"""MIT. Complete field reviews, original value assessments and retained edition decisions."""
from __future__ import annotations
from collections import Counter
from contextlib import contextmanager
import os
from pathlib import Path
from urllib.parse import urlsplit

from eltss_runtime import InputError, ConflictError, original_workspace, fhir
import eltss_source as source
from eltss_validation import typed, checked_selectors
from eltss_graph import select_field, public_row, without_history, rest_base, values_at
from eltss_correction import CorrectionMixin


def _defaults(value, defaults):
    return {**defaults, **value}


def _cell_view(value, budget):
    if len(source.jbytes(value)) <= budget:
        return value
    result = {key: val for key, val in value.items() if key not in
              {"values", "beforeJson", "afterJson", "changes", "unresolved"}}
    result["contentOmitted"] = "Open the complete retained JSONL file or original resource files"
    for key in ["values", "changes", "unresolved"]:
        if key in value:
            result[key + "Count"] = len(value[key])
    if len(source.jbytes(result)) > budget:
        result = {key: value.get(key) for key in ["carePlanId", "fieldKey", "label", "group", "status", "identity"] if key in value}
        result["contentOmitted"] = "Open the complete retained JSONL file"
        for key in ["values", "changes", "unresolved", "before", "after", "findings"]:
            if key in value:
                result[key + "Count"] = len(value[key])
    return result


def qualified_identity(index, row, policy):
    if row.get("containedIn"):
        parent = index.row(row["rootRecordId"])
        original = parent.get("fullUrl")
        if not original and parent.get("sourceUrl") and rest_base(parent["sourceUrl"], parent["resourceType"], parent.get("id")):
            original = parent["sourceUrl"]
        if not original and policy.get("referencePolicy") == "selected-base" and parent.get("id"):
            original = policy["baseUrl"].rstrip("/") + "/" + parent["resourceType"] + "/" + parent["id"]
        return without_history(original)[0] + "#" + row["id"] if original and row.get("id") else None
    if row.get("fullUrl"):
        return without_history(row["fullUrl"])[0]
    if row.get("sourceUrl") and rest_base(row["sourceUrl"], row["resourceType"], row.get("id")):
        return without_history(row["sourceUrl"])[0]
    if policy.get("referencePolicy") == "selected-base" and row.get("id"):
        return policy["baseUrl"].rstrip("/") + "/" + row["resourceType"] + "/" + row["id"]
    return None


def changed_values(before, after, path=()):
    """Exact source values; array position is retained, not silently realigned."""
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            if key not in before:
                yield {"path": list(path + (key,)), "pointer": source.pointer(path + (key,)),
                       "action": "added", "beforeJson": None, "afterJson": source.lexical_json(after[key])}
            elif key not in after:
                yield {"path": list(path + (key,)), "pointer": source.pointer(path + (key,)),
                       "action": "removed", "beforeJson": source.lexical_json(before[key]), "afterJson": None}
            else:
                yield from changed_values(before[key], after[key], path + (key,))
    elif isinstance(before, list) and isinstance(after, list):
        for number in range(max(len(before), len(after))):
            at = path + (str(number),)
            if number >= len(before):
                yield {"path": list(at), "pointer": source.pointer(at), "action": "added",
                       "beforeJson": None, "afterJson": source.lexical_json(after[number])}
            elif number >= len(after):
                yield {"path": list(at), "pointer": source.pointer(at), "action": "removed",
                       "beforeJson": source.lexical_json(before[number]), "afterJson": None}
            else:
                yield from changed_values(before[number], after[number], at)
    elif source.lexical_json(before) != source.lexical_json(after):
        yield {"path": list(path), "pointer": source.pointer(path), "action": "changed",
               "beforeJson": source.lexical_json(before), "afterJson": source.lexical_json(after)}


class ReviewMixin(CorrectionMixin):
    def save_edition(self, raw):
        value = typed("edition", raw)
        value = _defaults(value, {"predecessorId": None, "referencePolicy": "bundle",
            "baseUrl": "", "decisionIds": [], "owner": "", "note": ""})
        with self.mutex:
            self.source(value["sourceId"])
            if value["predecessorId"]:
                self.edition(value["predecessorId"])
            if not 1 <= len(value["carePlanIds"]) <= source.MAX_CAREPLANS:
                raise InputError("Select 1–100 distinct original CarePlan resource records")
            graph = self.graph(value["sourceId"], {key: value[key] for key in ["referencePolicy", "baseUrl", "decisionIds"]})
            available = {row["recordId"] for row in graph["carePlans"]}
            if any(ident not in available for ident in value["carePlanIds"]):
                raise InputError("Each selected CarePlan must be an original record in this graph")
            return self._store("editions", {**value, "graphId": graph["id"]})

    def edition(self, ident):
        return self._get("editions", ident)

    def adopt_profile(self, raw):
        source.exact(raw, {"profileId", "label", "actor", "note", "predecessorId"}, "Complete field profile adoption")
        profile = self.profile(raw.get("profileId"))
        fields = [field["defaultReview"] for field in profile["fields"]]
        return self.save_review_set({**raw, "fields": fields})

    def save_review_set(self, raw):
        value = typed("reviewSet", raw)
        value = _defaults(value, {"predecessorId": None, "note": ""})
        with self.mutex:
            profile = self.profile(value["profileId"])
            expected = [field["key"] for field in profile["fields"]]
            seen = [field["fieldKey"] for field in value["fields"]]
            if len(set(seen)) != len(expected) or set(seen) != set(expected):
                raise InputError("Retain exactly one review for each of the 56 original source field keys")
            normalized = {}
            for field in value["fields"]:
                field = _defaults(field, {"targetProfile": "", "targetPath": "", "terminologyVersion": "",
                    "multiplicity": "retain_all", "conversion": {"kind": "identity", "entries": []},
                    "owner": "", "reviewer": "", "reviewedAt": None, "note": ""})
                checked_selectors(field["selectors"])
                conversion = field["conversion"]
                conversion.setdefault("kind", "identity")
                conversion.setdefault("entries", [])
                if conversion["kind"] != "value-map" and conversion["entries"]:
                    raise InputError("Conversion entries belong to an explicitly reviewed value-map")
                mapping_keys = set()
                for entry in conversion["entries"]:
                    if set(entry) != {"fromJson", "toJson"}:
                        raise InputError("Each value conversion needs complete original and selected JSON")
                    key = source.lexical_json(source.json_value(entry["fromJson"], lexical=True))
                    if key in mapping_keys:
                        raise InputError("A reviewed value-map cannot give one original value multiple destinations")
                    mapping_keys.add(key)
                if field["status"] == "reviewed" and not field["reviewer"]:
                    field["reviewer"] = value["actor"]
                normalized[field["fieldKey"]] = field
            if value["predecessorId"]:
                old = self.review_set(value["predecessorId"])
                if old["profileId"] != value["profileId"]:
                    raise InputError("A successor review retains the same original field profile")
            value["fields"] = [normalized[key] for key in expected]
            return self._store("reviewSets", {**value, "fieldCount": 56,
                "reviewedCount": sum(field["status"] == "reviewed" for field in value["fields"]),
                "sourceProfileSha256": source.sha(source.jbytes(profile)), "profileSnapshot": profile})

    def review_set(self, ident):
        return self._get("reviewSets", ident)

    def assess(self, raw):
        value = typed("assessment", raw)
        with self.mutex:
            edition = self.edition(value["editionId"])
            review = self.review_set(value["reviewSetId"])
            selected = value.get("carePlanIds") or list(edition["carePlanIds"])
            if not selected or len(set(selected)) != len(selected) or any(i not in edition["carePlanIds"] for i in selected):
                raise InputError("Assessment CarePlans must be distinct selected records in the saved edition")
            value["carePlanIds"] = selected
            request_sha = source.sha(source.jbytes(value))
            for old in self._list("assessments"):
                if old["requestSha256"] == request_sha:
                    self._file_path(old["cellsFile"])
                    return old
            profile = review.get("profileSnapshot") or self.profile(review["profileId"])
            if source.sha(source.jbytes(profile)) != review["sourceProfileSha256"]:
                raise InputError("Retained review source profile identity differs")
            source_fields = {f["key"]: f for f in profile["fields"]}
            counts, by_field, by_plan = Counter(), {}, {}
            total, bytes_written = 0, 0
            with self.scratch() as temp, self._graph(edition["graphId"]) as (graph, index, resolved, decisions):
                path = temp / "cells.jsonl"
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                    for careplan in selected:
                        for field in review["fields"]:
                            original = source_fields[field["fieldKey"]]
                            observed, unresolved = select_field(index, careplan, field["selectors"], graph["policy"], decisions, resolved)
                            findings = []
                            conversion = field["conversion"]
                            mapped = {source.lexical_json(source.json_value(e["fromJson"], lexical=True)):
                                      source.lexical_json(source.json_value(e["toJson"], lexical=True))
                                      for e in conversion["entries"]}
                            for item in observed:
                                item["originalJsonText"] = item["jsonText"]
                                if conversion["kind"] == "string":
                                    original_value = source.json_value(item["jsonText"], lexical=True)
                                    try:
                                        text = fhir.scalar_text(original_value, "Reviewed field conversion")
                                    except InputError:
                                        text = None
                                        findings.append({"kind": "conversion-needs-input", "recordId": item["recordId"], "pointer": item["pointer"]})
                                    item["convertedJsonText"] = source.lexical_json(text) if text is not None else None
                                elif conversion["kind"] == "value-map":
                                    item["convertedJsonText"] = mapped.get(item["jsonText"])
                                    if item["jsonText"] not in mapped:
                                        findings.append({"kind": "unmapped-original-value", "recordId": item["recordId"], "pointer": item["pointer"]})
                                else:
                                    item["convertedJsonText"] = item["jsonText"]
                            if field["applicability"] == "not_applicable":
                                status = "not_applicable"
                            elif field["status"] != "reviewed" or field["applicability"] == "undetermined":
                                status = "review_pending"
                            elif observed:
                                status = "present"
                            elif unresolved:
                                status = "unresolved"
                            else:
                                status = "absent"
                            if not observed and field["applicability"] == "applicable" and field["absencePolicy"] in {"required", "needs_input"}:
                                findings.append({"kind": "authored-absence-policy", "policy": field["absencePolicy"]})
                            if field["multiplicity"] == "single" and len(observed) > 1:
                                findings.append({"kind": "multiple-original-values", "count": len(observed)})
                            cell = {"carePlanId": careplan, "fieldKey": field["fieldKey"],
                                "label": original["label"], "group": original["group"], "status": status,
                                "applicability": field["applicability"], "reviewStatus": field["status"],
                                "absencePolicy": field["absencePolicy"], "values": observed,
                                "unresolved": unresolved, "findings": findings}
                            raw_cell = source.jbytes(cell)
                            if len(raw_cell) > 32 * 1024 * 1024:
                                raise InputError("One complete field cell exceeds 32 MiB including original and converted values")
                            bytes_written += len(raw_cell)
                            if bytes_written > source.MAX_SOURCE:
                                raise InputError("The complete frozen assessment exceeds 256 MiB; select a smaller explicit CarePlan cohort")
                            output.write(raw_cell)
                            total += 1
                            counts[status] += 1
                            counts["values"] += len(observed)
                            counts["findings"] += len(findings)
                            by_field.setdefault(field["fieldKey"], Counter())[status] += 1
                            by_plan.setdefault(careplan, Counter())[status] += 1
                    output.flush()
                    os.fsync(output.fileno())
                descriptor = self._retain_file(path, "field-assessment-cells")
            return self._store("assessments", {**value, "requestSha256": request_sha,
                "graphId": edition["graphId"], "profileId": review["profileId"], "cellsFile": descriptor,
                "summary": {"carePlans": len(selected), "fields": 56, "cells": total,
                    "statusCounts": {key: counts[key] for key in ["present", "absent", "unresolved", "not_applicable", "review_pending"]},
                    "values": counts["values"], "findings": counts["findings"],
                    "byField": {key: dict(val) for key, val in by_field.items()},
                    "byCarePlan": {key: dict(val) for key, val in by_plan.items()},
                    "resourceBudget": {"assessmentBytes": source.MAX_SOURCE, "actualBytes": bytes_written,
                                       "cellValuesBytes": 16 * 1024 * 1024, "selectorMatches": 25000}}})

    def assessment(self, ident):
        return self._get("assessments", ident)

    def assessment_file(self, ident):
        return self._file_path(self.assessment(ident)["cellsFile"])

    def _jsonl_page(self, descriptor, *, offset=0, limit=50, selected=None):
        offset = source.integer(offset, 0, 10_000_000, "Page offset")
        limit = source.integer(limit, 1, 500, "Page limit")
        rows, total, consumed, size = [], 0, 0, 0
        with self._file_path(descriptor).open("rb") as stream:
            for raw in stream:
                value = source.json_value(raw)
                if selected and not selected(value):
                    continue
                position = total
                total += 1
                if position < offset or len(rows) >= limit:
                    continue
                view = _cell_view(value, source.MAX_INTERACTIVE)
                amount = len(source.jbytes(view))
                if size + amount > source.MAX_INTERACTIVE:
                    continue
                # Preserve consecutive filtered rows when a byte page fills.
                if position != offset + consumed:
                    continue
                rows.append(view)
                consumed += 1
                size += amount
        return {"rows": rows, "total": total, "offset": offset,
            "nextOffset": offset + consumed if offset + consumed < total else None,
            "pageBytes": size, "pageByteBudget": source.MAX_INTERACTIVE,
            "file": descriptor}

    def assessment_cells(self, ident, care_plan_id=None, field_key=None, status=None, offset=0, limit=50):
        with self.mutex:
            assessment = self.assessment(ident)
            if care_plan_id and care_plan_id not in assessment["carePlanIds"]:
                raise InputError("Choose a CarePlan in this frozen assessment")
            if field_key and field_key not in {f["key"] for f in self.profile(assessment["profileId"])["fields"]}:
                raise InputError("Choose an original field key")
            return {"assessmentId": ident, **self._jsonl_page(assessment["cellsFile"], offset=offset, limit=limit,
                selected=lambda row: (not care_plan_id or row["carePlanId"] == care_plan_id)
                    and (not field_key or row["fieldKey"] == field_key) and (not status or row["status"] == status))}

    def save_decision(self, raw):
        value = typed("decision", raw)
        value = _defaults(value, {"editionIds": [], "sourceRefs": [], "fieldKeys": [], "edgeId": None,
            "selectedRecordId": None, "assessmentId": None, "supersedesId": None, "owner": ""})
        with self.mutex:
            editions = [self.edition(ident) for ident in value["editionIds"]]
            value["sourceRefs"] = [self._source_ref(ref) for ref in value["sourceRefs"]]
            if not editions and not value["sourceRefs"] and not value["assessmentId"]:
                raise InputError("A decision needs its exact source, edition or assessment scope")
            if value["assessmentId"]:
                assessment = self.assessment(value["assessmentId"])
                if value["editionIds"] and assessment["editionId"] not in value["editionIds"]:
                    raise InputError("Decision assessment must belong to its selected edition scope")
            fields = {f["key"] for f in self.profile(self.catalogue()["profiles"][0]["id"])["fields"]}
            if any(key not in fields for key in value["fieldKeys"]):
                raise InputError("Decision fields must be exact original profile keys")
            if value["supersedesId"]:
                predecessor = self.decision(value["supersedesId"])
                if predecessor["kind"] != value["kind"]:
                    raise InputError("A successor decision retains its predecessor's decision kind")
            if value["kind"] == "reference" and value["outcome"] in {"accepted", "resolved"}:
                source.identity(value["edgeId"])
                source.identity(value["selectedRecordId"])
                found = False
                from eltss_graph import resolve_edge
                for source_id in {ref["sourceId"] for ref in value["sourceRefs"]}:
                    with self._index(source_id) as index:
                        edge_row = index.db.execute("SELECT body FROM edges WHERE id=?", (value["edgeId"],)).fetchone()
                        if edge_row is None:
                            continue
                        edge = source.json_value(edge_row[0])
                        policy = {"referencePolicy": "bundle", "baseUrl": "", "decisionIds": []}
                        selected_edition = next((e for e in editions if e["sourceId"] == source_id), None)
                        if selected_edition:
                            policy = {key: selected_edition[key] for key in ["referencePolicy", "baseUrl", "decisionIds"]}
                        resolved = resolve_edge(index, index.row(edge["fromRecordId"]), edge, policy)
                        if value["selectedRecordId"] not in resolved["candidateRecordIds"]:
                            raise InputError("Reference decisions must select an observed candidate from this original edge")
                        found = True
                if not found:
                    raise InputError("Reference decision needs the original edge source citation")
            elif value["selectedRecordId"]:
                if not any(ref["recordId"] == value["selectedRecordId"] for ref in value["sourceRefs"]):
                    raise InputError("Selected identity must be an explicitly cited original record")
            return self._store("decisions", value)

    def decision(self, ident):
        return self._get("decisions", ident)

    def compare_editions(self, raw):
        source.exact(raw, {"beforeId", "afterId", "label"}, "Original edition comparison")
        value = {"beforeId": source.identity(raw.get("beforeId")), "afterId": source.identity(raw.get("afterId")),
                 "label": source.text(raw.get("label", "Original care-plan edition comparison"), "Comparison label", 160, False)}
        with self.mutex:
            before, after = self.edition(value["beforeId"]), self.edition(value["afterId"])
            request_sha = source.sha(source.jbytes(value))
            for old in self._list("editionComparisons"):
                if old["requestSha256"] == request_sha:
                    self._file_path(old["changesFile"])
                    return old
            counts, total, bytes_written = Counter(), 0, 0
            with self._graph(before["graphId"]) as (_, left, __, ___), self._graph(after["graphId"]) as (____, right, _____, ______), self.scratch() as temp:
                sides = []
                for index, edition in [(left, before), (right, after)]:
                    groups = {}
                    for row in index.all_rows():
                        key = qualified_identity(index, row, edition)
                        key = key if key is not None else "unmatched:" + edition["sourceId"] + ":" + row["recordId"]
                        groups.setdefault(key, []).append(public_row(row, False))
                    sides.append(groups)
                path = temp / "edition-changes.jsonl"
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                    for key in sorted(set(sides[0]) | set(sides[1])):
                        lrows, rrows = sides[0].get(key, []), sides[1].get(key, [])
                        lhash, rhash = {r["resourceSha256"] for r in lrows}, {r["resourceSha256"] for r in rrows}
                        if key.startswith("unmatched:"):
                            state = "unmatched"
                        elif len(lhash) > 1 or len(rhash) > 1:
                            state = "ambiguous"
                        elif not lrows:
                            state = "added"
                        elif not rrows:
                            state = "removed"
                        elif lhash == rhash:
                            state = "unchanged"
                        else:
                            state = "changed"
                        changes = []
                        if state == "changed":
                            lresource = left.row(lrows[0]["recordId"])["_resource"]
                            rresource = right.row(rrows[0]["recordId"])["_resource"]
                            size = 0
                            for change in changed_values(lresource, rresource):
                                size += len(source.jbytes(change))
                                if size > 32 * 1024 * 1024:
                                    raise InputError("One resource's exact edition changes exceed 32 MiB")
                                changes.append(change)
                        row = {"identity": None if key.startswith("unmatched:") else key, "status": state,
                            "before": lrows, "after": rrows, "changes": changes}
                        raw_row = source.jbytes(row)
                        bytes_written += len(raw_row)
                        if bytes_written > source.MAX_SOURCE:
                            raise InputError("Complete original edition comparison exceeds 256 MiB")
                        output.write(raw_row)
                        counts[state] += 1
                        total += 1
                    output.flush()
                    os.fsync(output.fileno())
                descriptor = self._retain_file(path, "edition-comparison-changes")
            return self._store("editionComparisons", {**value, "requestSha256": request_sha,
                "beforeSourceId": before["sourceId"], "afterSourceId": after["sourceId"],
                "counts": {key: counts[key] for key in ["added", "removed", "changed", "unchanged", "ambiguous", "unmatched"]},
                "rows": total, "changesFile": descriptor,
                "identityPolicy": "Exact original qualified resource URI and owning contained identity; conflicting versions remain ambiguous"})

    def edition_comparison(self, ident):
        return self._get("editionComparisons", ident)

    def edition_changes_file(self, ident):
        return self._file_path(self.edition_comparison(ident)["changesFile"])

    def edition_changes(self, ident, offset=0, limit=50):
        with self.mutex:
            return {"comparisonId": ident, **self._jsonl_page(
                self.edition_comparison(ident)["changesFile"], offset=offset, limit=limit)}
