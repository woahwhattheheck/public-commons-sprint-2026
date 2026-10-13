# SPDX-License-Identifier: MIT
"""Parcel review custody in the original QgisWorkspace transaction and files."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile

from ..model import (require, QgisReceivingError, descriptor, member, file_digest,
    retain_bytes, retain_copy, json_bytes, value_sha, sha_bytes, utc_now, HASH, REQUEST)
from .intake import ParcelIntake, original_records, exact_bytes, KEY, ASSESSMENTS
from .state import parcel_state, empty_state
from .formats import compare_formats, rebind_review

INDEX_SCHEMA = "starforge.parcel-index.v1"
REVIEW_INDEX_SCHEMA = "starforge.parcel-review-index.v1"
MAX_PAGE = 100

def json_file(root, record):
    record = descriptor(record)
    path = member(root, record["path"])
    require(record["bytes"] <= 256 * 1024 * 1024, "PARCEL_JSON_SIZE", "The selected retained JSON exceeds 256 MiB.")
    body = path.read_bytes()
    require(len(body) == record["bytes"] and sha_bytes(body) == record["sha256"],
            "PARCEL_FILE_CHANGED", "The original parcel file changed.", path=record["path"])
    return json.loads(body.decode("utf-8"))

def _retain_lines(workspace, rows, prefix, *, make_index=False):
    staging = member(workspace.root, "parcels/staging/placeholder", existing=False).parent
    staging.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=prefix + "-", dir=staging)
    digest, size, index = hashlib.sha256(), 0, []
    try:
        with os.fdopen(fd, "wb") as output:
            for row in rows:
                body = json_bytes(row)
                metadata = {"key": row["key"], "offset": size, "bytes": len(body), "sha256": sha_bytes(body)}
                if make_index:
                    metadata.update(factsSha256=row["factsSha256"],
                        search=" ".join([row["key"]] + [record.get("address") or "" for record in row["records"]] +
                            [claim["value"] for claim in row["claims"] if claim["kind"] in
                             ("owner-assertion", "status-assertion", "ward-assertion", "inventory-assertion")]).casefold(),
                        wards=sorted({claim["value"] for claim in row["claims"] if claim["kind"] == "ward-assertion"}),
                        issues=sorted({problem["code"] for problem in row["issues"]}),
                        coverage={key: value["state"] for key, value in row["coverage"].items()})
                index.append(metadata)
                output.write(body); digest.update(body); size += len(body)
                require(size <= 512 * 1024 * 1024, "PARCEL_PROJECTION_SIZE",
                        "The complete parcel projection exceeds 512 MiB.")
            output.flush(); os.fsync(output.fileno())
        record = retain_copy(Path(name), workspace.root, "parcels/data/" + digest.hexdigest() + ".ndjson",
                             {"bytes": size, "sha256": digest.hexdigest()})
        return record, index
    finally:
        Path(name).unlink(missing_ok=True)

def read_line(root, file, ref):
    file = descriptor(file)
    require(type(ref.get("offset")) is int and ref["offset"] >= 0 and
            type(ref.get("bytes")) is int and 0 < ref["bytes"] <= 16 * 1024 * 1024 and
            ref["offset"] + ref["bytes"] <= file["bytes"] and HASH.fullmatch(ref.get("sha256", "")),
            "PARCEL_ROW_REFERENCE", "Keep the exact selected original row offset and identity.")
    path = member(root, file["path"])
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        require(os.fstat(source.fileno()).st_size == file["bytes"], "PARCEL_FILE_CHANGED",
                "The retained parcel projection length changed.")
        source.seek(ref["offset"]); body = source.read(ref["bytes"])
    require(len(body) == ref["bytes"] and sha_bytes(body) == ref["sha256"],
            "PARCEL_ROW_CHANGED", "The selected parcel row changed.")
    return json.loads(body.decode("utf-8"))

class ParcelWorkspace:
    def __init__(self, workspace):
        self.workspace = workspace

    def edition(self, identity=None, state=None):
        data = parcel_state(state or self.workspace.read())
        identity = identity or data["activeEditionId"]
        row = next((row for row in data["editions"] if row["id"] == identity), None)
        require(row is not None, "PARCEL_EDITION_REQUIRED", "Select an imported original parcel edition.")
        return copy.deepcopy(row)

    def index(self, edition):
        index = json_file(self.workspace.root, edition["index"])
        require(index.get("schema") == INDEX_SCHEMA and index.get("editionId") == edition["id"] and
                isinstance(index.get("rows"), list) and len(index["rows"]) == edition["summary"]["selectedKeys"] and
                len({row["key"] for row in index["rows"]}) == len(index["rows"]),
                "PARCEL_INDEX_IDENTITY", "Retain the complete parcel index for this source edition.")
        return index

    def review_index(self, edition):
        if edition.get("reviewIndex") is None: return {}
        value = json_file(self.workspace.root, edition["reviewIndex"])
        require(value.get("schema") == REVIEW_INDEX_SCHEMA and value.get("editionId") == edition["id"] and
                isinstance(value.get("decisions"), dict), "PARCEL_REVIEW_INDEX",
                "Retain the exact decision index for this source edition.")
        return value["decisions"]

    def row(self, edition, key, *, index=None):
        index = index or self.index(edition)
        ref = next((row for row in index["rows"] if row["key"] == key), None)
        require(ref is not None, "PARCEL_NOT_SELECTED", "Select an original key in this edition.", key=key)
        row = read_line(self.workspace.root, edition["rows"], ref)
        require(row.get("key") == key and row.get("factsSha256") == ref["factsSha256"],
                "PARCEL_ROW_IDENTITY", "The original parcel row and index differ.")
        return row

    def decision(self, edition, key, *, reviews=None):
        reviews = self.review_index(edition) if reviews is None else reviews
        ref = reviews.get(key)
        if ref is None: return None
        row = read_line(self.workspace.root, ref["file"], ref)
        require(row.get("key") == key and row.get("editionId") == edition["id"] and
                row.get("sha256") == ref.get("decisionSha256") and
                value_sha({k:v for k,v in row.items() if k != "sha256"}) == row["sha256"],
                "PARCEL_DECISION_CHANGED", "The retained decision differs from its original review.")
        return row

    def view(self):
        state = self.workspace.read()
        data = parcel_state(state)
        return {"workspaceId": state["id"], "revision": state["revision"], **copy.deepcopy(data),
                "assessmentBases": [{"id": key, "field": fields[0], "currency": "USD"} for key, fields in ASSESSMENTS.items()],
                "areaBases": [{"id": "city-reported-square-feet", "unit": "square-feet"},
                              {"id": "county-reported-square-feet", "unit": "square-feet"},
                              {"id": "publisher-reported-acreage", "unit": "acres"}]}

    def rows(self, edition_id=None, *, offset=0, limit=50, query="", ward="", issue="", review=""):
        require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= MAX_PAGE and
                all(isinstance(value, str) and len(value) <= 1000 for value in (query, ward, issue, review)) and
                review in ("", "reviewed", "unreviewed"), "PARCEL_PAGE", "Choose a page of up to 100 original parcels.")
        edition = self.edition(edition_id)
        index, decisions = self.index(edition), self.review_index(edition)
        selected = [row for row in index["rows"]
            if (not query or query.casefold() in row["search"]) and (not ward or ward in row["wards"]) and
               (not issue or issue in row["issues"]) and (not review or (row["key"] in decisions) == (review == "reviewed"))]
        items = []
        for entry in selected[offset:offset+limit]:
            row = self.row(edition, entry["key"], index=index)
            decision = self.decision(edition, row["key"], reviews=decisions)
            items.append({"key": row["key"], "factsSha256": row["factsSha256"],
                "addresses": sorted({record["address"] for record in row["records"] if record.get("address")}),
                "owners": sorted({claim["value"] for claim in row["claims"] if claim["kind"] == "owner-assertion"}),
                "statuses": sorted({claim["value"] for claim in row["claims"] if claim["kind"] == "status-assertion"}),
                "wards": entry["wards"], "issues": row["issues"], "coverage": row["coverage"],
                "decision": decision})
        return {"editionId": edition["id"], "items": items, "offset": offset, "limit": limit,
                "total": len(selected), "complete": offset + len(items) >= len(selected)}

    def detail(self, edition_id, key):
        edition = self.edition(edition_id)
        row = self.row(edition, key)
        return {"editionId": edition["id"], "parcel": row, "decision": self.decision(edition, key),
                "inputs": [{k:v for k,v in item.items() if k != "object"} for item in edition["inputs"]
                           if item["sha256"] in {ref["fileSha256"] for record in row["records"] for ref in record["references"]}]}

    def raw_record(self, edition_id, key, record_id):
        edition = self.edition(edition_id)
        row = self.row(edition, key)
        record = next((item for item in row["records"] if item["id"] == record_id), None)
        require(record is not None, "PARCEL_SOURCE_RECORD", "Select a retained source record for this parcel.")
        ref = record["references"][0]
        original = next(item for item in edition["inputs"] if item["sha256"] == ref["fileSha256"] and item["path"] == ref["path"])
        path = member(self.workspace.root, original["object"]["path"])
        file_digest(path, expected=original["object"])
        for index, raw, geometry in original_records(path.read_bytes(), original["family"]):
            if index == ref["row"]:
                # JSON output retains exact numeric lexemes as source text, separately from the original bytes.
                return {"source": ref, "family": original["family"], "sourceUrl": original["sourceUrl"],
                        "capturedAt": original["capturedAt"], "originalRecordJson": exact_bytes(raw).decode("utf-8"),
                        "originalGeometryJson": exact_bytes(geometry).decode("utf-8") if geometry is not None else None}
        raise QgisReceivingError("PARCEL_SOURCE_RECORD", "The retained source record is missing.")

    def preview(self, directory, expected_sha256=None, progress=None):
        intake = ParcelIntake(directory, expected_sha256, progress=progress)
        prepared = intake.prepare(progress)
        digest = hashlib.sha256()
        for row in prepared["rows"]: digest.update(json_bytes(row))
        value = {"manifestSha256": intake.id, "label": intake.manifest["label"],
                 "capturedAt": intake.manifest.get("capturedAt"), "createdAt": intake.manifest.get("createdAt"), "summary": prepared["summary"],
                 "projectionSha256": digest.hexdigest(),
                 "exceptionsSha256": value_sha(prepared["exceptions"])}
        return {**value, "previewSha256": value_sha(value), "exceptions": prepared["exceptions"][:50],
                "examples": [{"key": row["key"], "factsSha256": row["factsSha256"], "issues": row["issues"],
                              "coverage": row["coverage"]} for row in prepared["rows"][:25]]}

    def import_source(self, directory, *, expected_sha256, preview_sha256, revision, request_id, actor, progress=None):
        payload = {"manifestSha256": expected_sha256, "previewSha256": preview_sha256}
        previous = self.workspace.operation(request_id, "parcels.imported", payload)
        if previous: return previous
        intake = ParcelIntake(directory, expected_sha256, progress=progress)
        prepared = intake.prepare(progress)
        digest = hashlib.sha256()
        for row in prepared["rows"]: digest.update(json_bytes(row))
        preview = {"manifestSha256": intake.id, "label": intake.manifest["label"],
                   "capturedAt": intake.manifest.get("capturedAt"), "createdAt": intake.manifest.get("createdAt"), "summary": prepared["summary"],
                   "projectionSha256": digest.hexdigest(), "exceptionsSha256": value_sha(prepared["exceptions"])}
        require(value_sha(preview) == preview_sha256, "PARCEL_PREVIEW_CHANGED",
                "Inspect this complete source edition before importing its parcel projection.")
        inputs = []
        for item in prepared["files"]:
            stored = retain_copy(member(intake.root, item["path"]), self.workspace.root,
                "parcels/objects/" + item["sha256"], item, progress)
            inputs.append({**copy.deepcopy(item), "object": stored})
        manifest = retain_bytes(self.workspace.root, "parcels/objects/" + intake.id, intake.body)
        rows, index = _retain_lines(self.workspace, prepared["rows"], "intake", make_index=True)
        index_body = json_bytes({"schema": INDEX_SCHEMA, "editionId": intake.id, "rows": index})
        index_file = retain_bytes(self.workspace.root, "parcels/data/" + sha_bytes(index_body) + ".json", index_body)
        exception_body = json_bytes({"schema": "starforge.parcel-source-exceptions.v1", "editionId": intake.id,
                                     "exceptions": prepared["exceptions"]})
        exceptions = retain_bytes(self.workspace.root, "parcels/data/" + sha_bytes(exception_body) + ".json", exception_body)
        record = {"id": intake.id, "label": intake.manifest["label"], "capturedAt": intake.manifest.get("capturedAt"), "createdAt": intake.manifest.get("createdAt"),
                  "importedAt": utc_now(), "actor": actor, "manifest": manifest, "inputs": inputs,
                  "rows": rows, "index": index_file, "exceptions": exceptions, "summary": prepared["summary"],
                  "reviewIndex": None}
        def update(state):
            data = state.setdefault("parcels", empty_state())
            existing = next((row for row in data["editions"] if row["id"] == record["id"]), None)
            if existing is None: data["editions"].append(copy.deepcopy(record))
            if data["activeEditionId"] is None: data["activeEditionId"] = record["id"]
            return {"editionId": record["id"], "summary": record["summary"], "alreadyImported": existing is not None}
        return self.workspace._mutate(revision, request_id, actor, "parcels.imported", payload, update)

    def select(self, edition_id, *, revision, request_id, actor):
        def update(state):
            data = state.setdefault("parcels", empty_state())
            self.edition(edition_id, state)
            previous = data["activeEditionId"]; data["activeEditionId"] = edition_id
            return {"editionId": edition_id, "previousEditionId": previous}
        return self.workspace._mutate(revision, request_id, actor, "parcels.selected", {"editionId": edition_id}, update)

    def save_entity(self, definition, *, revision, request_id, actor):
        require(isinstance(definition, dict) and set(definition) <=
                {"entityId", "label", "kind", "parentEntityId", "note", "expectedVersion"} and
                isinstance(definition.get("entityId"), str) and REQUEST.fullmatch(definition["entityId"]) and
                isinstance(definition.get("label"), str) and 0 < len(definition["label"].strip()) <= 512 and
                definition.get("kind") in ("government", "authority", "department", "organization", "other") and
                isinstance(definition.get("note"), str) and 0 < len(definition["note"].strip()) <= 4000 and
                "expectedVersion" in definition, "PARCEL_ENTITY_DEFINITION",
                "Name the reviewed entity, its type, current version and assignment context.")
        normalized = {key: copy.deepcopy(value) for key, value in definition.items() if key != "expectedVersion"}
        normalized["label"] = normalized["label"].strip()
        identity = "entity-" + value_sha(normalized)
        def update(state):
            data = state.setdefault("parcels", empty_state())
            require(data["activeEntities"].get(normalized["entityId"]) == definition["expectedVersion"],
                    "PARCEL_ENTITY_CHANGED", "Review the current entity version before saving.")
            parent = normalized.get("parentEntityId")
            require(parent is None or parent in data["activeEntities"] and parent != normalized["entityId"],
                    "PARCEL_ENTITY_PARENT", "Choose an existing distinct parent entity.")
            cursor, visited = parent, {normalized["entityId"]}
            while cursor is not None:
                require(cursor not in visited, "PARCEL_ENTITY_PARENT", "The reviewed entity hierarchy must remain acyclic.")
                visited.add(cursor)
                current_version = data["activeEntities"].get(cursor)
                current_entity = next((row for row in data["entities"] if row["id"] == current_version), None)
                cursor = current_entity.get("parentEntityId") if current_entity else None
            if not any(row["id"] == identity for row in data["entities"]):
                data["entities"].append({"id": identity, **normalized, "at": utc_now(), "actor": actor})
            data["activeEntities"][normalized["entityId"]] = identity
            return {"entityId": normalized["entityId"], "version": identity, "definition": normalized}
        return self.workspace._mutate(revision, request_id, actor, "parcels.entity.saved", definition, update)

    def _normalize_decision(self, edition, row, original, data, current):
        require(isinstance(original, dict) and set(original) <= {"key", "factsSha256", "expectedDecisionSha256",
                "owner", "accountable", "status", "ward", "assessmentRecordId", "areaClaimId", "geometryClaimId",
                "reason", "evidence"} and original.get("key") == row["key"] and
                original.get("factsSha256") == row["factsSha256"] and "expectedDecisionSha256" in original and
                original["expectedDecisionSha256"] == (current["sha256"] if current else None),
                "PARCEL_REVIEW_CHANGED", "Review the exact parcel facts and current decision before saving.", key=row["key"])
        require(isinstance(original.get("reason"), str) and 0 < len(original["reason"].strip()) <= 4000,
                "PARCEL_REVIEW_REASON", "Record the reason for this parcel decision.")
        claims = {claim["id"]: claim for claim in row["claims"]}
        selected = {}
        for role, kind in (("owner", "owner-assertion"), ("status", "status-assertion"), ("ward", "ward-assertion")):
            choice = original.get(role)
            require(isinstance(choice, dict) and choice.get("mode") in ("source", "unresolved") and
                    set(choice) <= {"mode", "claimId"}, "PARCEL_REVIEW_CHOICE",
                    "Choose a source assertion or explicitly leave this role unresolved.", role=role)
            if choice["mode"] == "source":
                claim = claims.get(choice.get("claimId"))
                require(claim is not None and claim["kind"] == kind, "PARCEL_REVIEW_CLAIM",
                        "Select the original assertion for this role.", role=role)
                selected[role] = {"mode": "source", "claim": copy.deepcopy(claim)}
            else: selected[role] = {"mode": "unresolved"}
        accountable = original.get("accountable")
        require(isinstance(accountable, dict) and accountable.get("mode") in ("entity", "unassigned") and
                set(accountable) <= {"mode", "entityId", "entityVersion"},
                "PARCEL_ACCOUNTABLE_CHOICE", "Choose a reviewed accountable entity or explicitly leave it unassigned.")
        if accountable["mode"] == "entity":
            version = data["activeEntities"].get(accountable.get("entityId"))
            require(version == accountable.get("entityVersion") and version is not None,
                    "PARCEL_ENTITY_CHANGED", "Choose the current reviewed entity version.")
            entity = next(item for item in data["entities"] if item["id"] == version)
            selected["accountable"] = {"mode": "entity", "entity": copy.deepcopy(entity)}
        else: selected["accountable"] = {"mode": "unassigned"}
        for field, kind in (("areaClaimId", "area"), ("geometryClaimId", "geometry")):
            require(field in original, "PARCEL_REVIEW_CHOICE", "Explicitly select or leave this source measurement unresolved.", field=field)
            claim = claims.get(original[field]) if original[field] is not None else None
            require(original[field] is None or claim is not None and claim["kind"] == kind,
                    "PARCEL_REVIEW_CLAIM", "Select the matching original source claim.", field=field)
            selected[field.removesuffix("ClaimId")] = copy.deepcopy(claim)
        require("assessmentRecordId" in original, "PARCEL_REVIEW_CHOICE",
                "Select a County assessment record or explicitly leave it unresolved.")
        assessment = original["assessmentRecordId"]
        require(assessment is None or any(record["id"] == assessment and record["family"] == "county-assessment-json"
                for record in row["records"]), "PARCEL_ASSESSMENT_RECORD", "Select an actual original County assessment record.")
        selected["assessmentRecordId"] = assessment
        selected["assessments"] = [copy.deepcopy(claim) for claim in row["claims"]
                                  if claim["kind"] == "assessment" and claim["recordId"] == assessment]
        evidence = original.get("evidence", [])
        require(isinstance(evidence, list) and len(evidence) <= 100, "PARCEL_REVIEW_EVIDENCE", "Keep the selected original evidence references.")
        for ref in evidence:
            require(isinstance(ref, dict) and set(ref) <= {"editionId", "fileSha256", "note"} and
                    isinstance(ref.get("note", ""), str) and len(ref.get("note", "")) <= 4000,
                    "PARCEL_REVIEW_EVIDENCE", "Use an exact retained source reference and optional note.")
            source = next((item for item in data["editions"] if item["id"] == ref.get("editionId")), None)
            require(source is not None and any(item["sha256"] == ref.get("fileSha256") for item in source["inputs"]),
                    "PARCEL_REVIEW_EVIDENCE", "The reviewed evidence must belong to an original retained source.")
        return {"key": row["key"], "editionId": edition["id"], "factsSha256": row["factsSha256"],
                **selected, "reason": original["reason"].strip(), "evidence": copy.deepcopy(evidence),
                "previousDecisionSha256": current["sha256"] if current else None}

    def _review_files(self, edition, decisions, reviews, request_id, actor):
        at = utc_now()
        saved = []
        for decision in decisions:
            value = {**decision, "requestId": request_id, "reviewedAt": at, "actor": actor}
            value["sha256"] = value_sha(value); saved.append(value)
        file, entries = _retain_lines(self.workspace, saved, "review")
        updated = copy.deepcopy(reviews)
        for entry, value in zip(entries, saved):
            updated[value["key"]] = {**entry, "file": file, "decisionSha256": value["sha256"],
                                     "factsSha256": value["factsSha256"]}
        body = json_bytes({"schema": REVIEW_INDEX_SCHEMA, "editionId": edition["id"], "decisions": updated})
        index = retain_bytes(self.workspace.root, "parcels/data/" + sha_bytes(body) + ".json", body)
        files = [file, index]
        if edition.get("reviewIndex"): files.append(edition["reviewIndex"])
        review = {"id": "review-" + value_sha({"requestId": request_id, "editionId": edition["id"]}),
                  "editionId": edition["id"], "at": at, "actor": actor, "count": len(saved),
                  "files": files, "index": index, "previousIndex": edition.get("reviewIndex")}
        return review

    def review(self, edition_id, decisions, *, revision, request_id, actor, preview_sha256=None):
        payload = {"editionId": edition_id, "decisions": decisions}
        if preview_sha256 is not None: payload["previewSha256"] = preview_sha256
        previous = self.workspace.operation(request_id, "parcels.reviewed", payload)
        if previous: return previous
        require(isinstance(decisions, list) and 1 <= len(decisions) <= 1000 and
                all(isinstance(row, dict) and isinstance(row.get("key"), str) for row in decisions) and
                len({row["key"] for row in decisions}) == len(decisions), "PARCEL_REVIEW_BATCH",
                "Review up to 1,000 distinct original parcel keys in one action.")
        state = self.workspace.read(); data = parcel_state(state)
        edition = self.edition(edition_id, state); index = self.index(edition); reviews = self.review_index(edition)
        normalized = [self._normalize_decision(edition, self.row(edition, item["key"], index=index),
                        item, data, self.decision(edition, item["key"], reviews=reviews)) for item in decisions]
        if preview_sha256 is not None:
            require(preview_sha256 == value_sha({"editionId": edition_id, "decisions": normalized}),
                    "PARCEL_REVIEW_PREVIEW_CHANGED", "Review this exact batch and its current source decisions before saving.")
        retained = self._review_files(edition, normalized, reviews, request_id, actor)
        def update(current):
            target = next(item for item in current["parcels"]["editions"] if item["id"] == edition_id)
            require(target.get("reviewIndex") == edition.get("reviewIndex"), "PARCEL_REVIEW_CHANGED",
                    "The original decision index changed before this review.")
            current["parcels"]["reviews"].append(copy.deepcopy(retained))
            target["reviewIndex"] = retained["index"]
            return {"editionId": edition_id, "reviewId": retained["id"], "reviewedKeys": len(normalized)}
        return self.workspace._mutate(revision, request_id, actor, "parcels.reviewed", payload, update)

    def compare(self, left_id, right_id):
        left, right = self.edition(left_id), self.edition(right_id)
        left_index, right_index = self.index(left), self.index(right)
        old = {row["key"]: row["factsSha256"] for row in left_index["rows"]}
        new = {row["key"]: row["factsSha256"] for row in right_index["rows"]}
        changed = sorted(key for key in old.keys() & new.keys() if old[key] != new[key])
        equivalents = compare_formats(self, left, right, left_index, right_index, changed)
        result = {"leftEditionId": left_id, "rightEditionId": right_id,
                  "added": sorted(set(new) - set(old)), "removed": sorted(set(old) - set(new)),
                  "changed": [key for key in changed if key not in equivalents],
                  "unchanged": sorted({key for key in old.keys() & new.keys() if old[key] == new[key]} | set(equivalents))}
        if equivalents:
            result["sourceFormatEquivalence"] = [equivalents[key] for key in sorted(equivalents)]
        return {**result, "comparisonSha256": value_sha(result)}

    def review_successor(self, definition, *, revision, request_id, actor):
        require(isinstance(definition, dict) and set(definition) == {"leftEditionId", "rightEditionId",
                "comparisonSha256", "unchanged", "changed", "removed", "note"} and
                definition["leftEditionId"] != definition["rightEditionId"] and
                definition["unchanged"] in ("carry-reviewed", "leave-unreviewed") and
                definition["changed"] == "leave-unreviewed" and definition["removed"] == "retain-history" and
                isinstance(definition["note"], str) and 0 < len(definition["note"].strip()) <= 4000,
                "PARCEL_SUCCESSOR_REVIEW", "Review both editions and the explicit carry, changed and removed-key policy.")
        previous = self.workspace.operation(request_id, "parcels.successor.reviewed", definition)
        if previous: return previous
        comparison = self.compare(definition["leftEditionId"], definition["rightEditionId"])
        require(comparison["comparisonSha256"] == definition["comparisonSha256"],
                "PARCEL_COMPARISON_CHANGED", "Read the complete original successor comparison first.")
        left, right = self.edition(definition["leftEditionId"]), self.edition(definition["rightEditionId"])
        old, new = self.review_index(left), self.review_index(right)
        carry = []
        equivalents = {item["key"]: item for item in comparison.get("sourceFormatEquivalence", [])}
        right_index = self.index(right) if equivalents else None
        if definition["unchanged"] == "carry-reviewed":
            for key in comparison["unchanged"]:
                if key not in old or key in new: continue
                original = self.decision(left, key, reviews=old)
                decision = (rebind_review(original, self.row(right, key, index=right_index), equivalents[key])
                            if key in equivalents else
                            {k: copy.deepcopy(value) for k, value in original.items()
                             if k not in ("sha256", "requestId", "reviewedAt", "actor")})
                decision.update(editionId=right["id"], previousDecisionSha256=None,
                    carriedFrom={"editionId": left["id"], "decisionSha256": original["sha256"]},
                    reason=definition["note"].strip())
                carry.append(decision)
        retained = self._review_files(right, carry, new, request_id, actor) if carry else None
        result = {"id": "successor-" + value_sha({"requestId": request_id, "definition": definition}),
            "leftEditionId": left["id"], "rightEditionId": right["id"], "definition": copy.deepcopy(definition),
            "counts": {key: len(comparison[key]) for key in ("added", "removed", "changed", "unchanged")},
            "carriedReviews": len(carry), "preservedTargetReviews": len(new),
            "sourceFormatEquivalentKeys": sorted(equivalents), "at": utc_now(), "actor": actor,
            "files": retained["files"] if retained else []}
        def update(state):
            data = state["parcels"]
            current_left = next(item for item in data["editions"] if item["id"] == left["id"])
            current_right = next(item for item in data["editions"] if item["id"] == right["id"])
            require(current_left.get("reviewIndex") == left.get("reviewIndex") and
                    current_right.get("reviewIndex") == right.get("reviewIndex"),
                    "PARCEL_REVIEW_CHANGED", "The retained decisions changed during successor review.")
            if retained:
                data["reviews"].append(copy.deepcopy(retained)); current_right["reviewIndex"] = retained["index"]
            data["successors"].append(copy.deepcopy(result)); data["activeEditionId"] = right["id"]
            return {"successorId": result["id"], "editionId": right["id"],
                    "counts": result["counts"], "carriedReviews": len(carry), "preservedTargetReviews": len(new)}
        return self.workspace._mutate(revision, request_id, actor, "parcels.successor.reviewed", definition, update)
