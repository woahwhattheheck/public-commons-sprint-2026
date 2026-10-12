"""MIT. Complete source-native Gravity referral operating workspace."""
from __future__ import annotations
from collections import Counter, defaultdict
import io
import os
from pathlib import Path
import re
import stat
import uuid
import zipfile
from referral_runtime import (BaseWorkspace, InputError, ConflictError, original_workspace,
    source, fhir, safe_read, now, private_directory, atomic_json, write_zip,
    public_row, qualified_identity, changed_values, CorrectionMixin)
import referral_schema as schema
import referral_domain as domain
from referral_receiving import ReferralReceiving
from referral_exchange import ReferralExchange

MAX_RECORD = 64 * 1024 * 1024
SOURCE_MANIFEST = "stellar-forge.gravity-referral-original.v1"

def digest(kind, value):
    return source.sha(source.jbytes({"kind": kind, "value":
        {k: v for k, v in value.items() if k not in {"id", "createdAt"}}}))

def clean_record(kind, raw):
    if kind not in schema.KINDS or not isinstance(raw, dict):
        raise InputError("Unknown native referral collection or record")
    ident = fhir.operation_id(raw.get("id")) if kind in schema.MUTABLE else source.identity(raw.get("id"))
    if kind not in schema.MUTABLE and digest(kind, raw) != ident:
        raise InputError("Original referral record differs from its complete content identity")
    return raw

class _CorrectionBridge:
    def __init__(self, ws):
        self.ws = ws
    def __getattr__(self, name):
        return getattr(self.ws, name)
    def edition(self, ident):
        return self.ws.referral_record("editions", ident)

class Workspace(ReferralReceiving, ReferralExchange, BaseWorkspace):
    def __init__(self, root, create=False, credentials_file=None):
        super().__init__(root, create=create, credentials_file=credentials_file)
        try:
            private_directory(self.root / "referral")
            private_directory(self.root / "referral" / "operations")
            self.db.execute("""CREATE TABLE IF NOT EXISTS referral_records(
                kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,
                PRIMARY KEY(kind,id))""")
            self.db.commit()
        except Exception:
            self.close()
            raise

    def referral_catalogue(self):
        return schema.catalogue()

    def referral_profile(self):
        return schema.profile()

    def referral_record(self, kind, ident, required=True):
        if kind not in schema.KINDS:
            raise InputError("Unknown referral collection")
        ident = fhir.operation_id(ident) if kind in schema.MUTABLE else source.identity(ident)
        with self.mutex:
            row = self.db.execute("SELECT body FROM referral_records WHERE kind=? AND id=?", (kind, ident)).fetchone()
            if row is None:
                if required:
                    raise InputError("Unknown retained referral " + kind + " record")
                return None
            return clean_record(kind, source.json_value(row[0]))

    def referral_records(self, kind, *, offset=None, limit=50, query=""):
        if kind not in schema.KINDS:
            raise InputError("Unknown referral collection")
        with self.mutex:
            records = [clean_record(kind, source.json_value(row[0])) for row in
                self.db.execute("SELECT body FROM referral_records WHERE kind=? ORDER BY created,id", (kind,))]
        if offset is None:
            return records
        query = schema.text(query, "Record search", 1000)
        if query:
            records = [r for r in records if query.casefold() in source.jbytes(r).decode().casefold()]
        return self._referral_page(records, offset, limit)

    @staticmethod
    def _referral_page(rows, offset=0, limit=50):
        source.integer(offset, 0, 10000000, "Page offset")
        source.integer(limit, 1, 250, "Page size")
        selected, used = [], 0
        for row in rows[offset:offset + limit]:
            size = len(source.jbytes(row))
            if size > source.MAX_INTERACTIVE:
                raise InputError("Open the complete retained file for this record larger than one interactive page")
            if selected and used + size > source.MAX_INTERACTIVE:
                break
            selected.append(row); used += size
        nxt = offset + len(selected)
        return {"rows": selected, "total": len(rows), "offset": offset,
                "nextOffset": nxt if nxt < len(rows) else None, "pageBytes": used}

    def _referral_save(self, kind, record):
        clean_record(kind, record)
        raw = source.jbytes(record)
        if len(raw) > MAX_RECORD:
            raise InputError("One complete referral record exceeds 64 MiB")
        with self.mutex:
            previous = self.referral_record(kind, record["id"], required=False)
            if previous and kind not in schema.MUTABLE and source.jbytes(previous) != raw:
                raise ConflictError("Original referral content ID is already bound to another body")
            with self.db:
                self.db.execute("""INSERT INTO referral_records VALUES(?,?,?,?)
                    ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body""",
                    (kind, record["id"], raw.decode(), record.get("createdAt", now())))
        return record

    def _referral_store(self, kind, value):
        if kind in schema.MUTABLE or "id" in value or "createdAt" in value:
            raise InputError("Immutable referral input leaves its identity and creation time to the original store")
        ident = digest(kind, value)
        existing = self.referral_record(kind, ident, required=False)
        return existing or self._referral_save(kind, {"id": ident, **value, "createdAt": now()})

    def referral_state(self):
        projections = {
            "configurations": ["label", "topology", "sourceVersion", "classification", "recipientHostRole", "predecessorId"],
            "editions": ["label", "sourceId", "configurationId", "taskIds", "graphId", "predecessorId", "actor"],
            "reviews": ["label", "profileId", "predecessorId", "counts", "actor"],
            "assessments": ["label", "editionId", "configurationId", "reviewId", "asOf", "summary", "reportFile"],
            "decisions": ["label", "kind", "outcome", "editionId", "taskIds", "owner", "supersedesId"],
            "comparisons": ["label", "beforeId", "afterId", "summary", "changesFile"],
            "correctionPreviews": ["label", "editionId", "requestSha256", "changeCount", "changesFile"],
            "corrections": ["label", "editionId", "sourceEditionId", "sourceId", "previewId", "actor"],
            "exchangeRequests": ["label", "editionId", "connectionId", "method", "resourceType", "logicalId", "requestSha256", "actor"],
            "exchangeOperations": ["requestId", "state", "phase", "requestSha256", "updatedAt", "notBefore", "sourceId", "result"],
            "monitoring": ["label", "configurationId", "connectionId", "requestId", "search", "since", "until", "actor"],
            "handoffs": ["label", "editionId", "assessmentId", "receiver", "scope", "taskCount", "files", "requestSha256"],
            "receivings": ["label", "handoffId", "receiver", "state", "artifactId", "destinationObjectId", "operationId"],
            "receives": ["state", "archiveSha256", "workspaceId", "kind", "updatedAt"]}
        records = {}
        for kind, keys in projections.items():
            records[kind] = [{k: r.get(k) for k in ["id", "createdAt", *keys]}
                             for r in self.referral_records(kind)]
        return {"schema": schema.SCHEMA, "workspaceId": self.workspace_id, **records}

    def state(self):
        return {**super().state(), "referral": self.referral_state()}

    def _referral_refs(self, values):
        result = schema.refs(values)
        originals = None
        for value in result:
            if value.get("sourceId"):
                self._source_ref({k: value[k] for k in ["sourceId", "recordId", "pointer"] if k in value})
                if value.get("resourceSha256") and self.source_row(value["sourceId"], value["recordId"])["resourceSha256"] != value["resourceSha256"]:
                    raise InputError("Native source citation changed its original resource hash")
            if value.get("member"):
                if originals is None:
                    originals = {f["path"]: f for f in source.json_value((Path(__file__).parent / "gravity-source.json").read_bytes())["files"]}
                row = originals.get(value["member"])
                if not row:
                    raise InputError("The source citation names an absent original guidance member")
                if value.get("sourceSha256") and value["sourceSha256"] != row["sha256"]:
                    raise InputError("The source citation hash differs from its exact original member")
        return result

    def save_referral_configuration(self, raw):
        value = schema.configuration(raw)
        with self.mutex:
            if value["predecessorId"]:
                self.referral_record("configurations", value["predecessorId"])
            if value["legacyProfileArtifactId"]:
                self.artifact_path(value["legacyProfileArtifactId"])
            for role in value["roles"]:
                if role["connectionId"]:
                    self.connection(role["connectionId"])
            return self._referral_store("configurations", value)

    def save_referral_edition(self, raw):
        value = schema.edition(raw)
        with self.mutex:
            self.source(value["sourceId"])
            self.referral_record("configurations", value["configurationId"])
            if value["predecessorId"]:
                self.referral_record("editions", value["predecessorId"])
            with self._index(value["sourceId"]) as index:
                for ident in value["taskIds"]:
                    if index.row(ident)["resourceType"] != "Task":
                        raise InputError("Each selected referral record is an original Task")
            policy = {k: value[k] for k in ["referencePolicy", "baseUrl", "decisionIds"]}
            graph = self.graph(value["sourceId"], policy)
            return self._referral_store("editions", {**value, "graphId": graph["id"]})

    def initial_referral_review(self, raw):
        value = schema.common(schema.obj(raw, {"label", "actor", "note"}, {"label", "actor"}, "Profile adoption"))
        p = self.referral_profile()
        return self.save_referral_review({**value, "profileId": schema.PROFILE_ID,
            "requirements": [{"key": r["key"], "status": "unreviewed"} for r in p["requirements"]],
            "fields": [{"key": r["key"], "status": "unreviewed"} for r in p["fields"]]})

    def save_referral_review(self, raw):
        value = schema.review(raw)
        with self.mutex:
            if value["predecessorId"]:
                self.referral_record("reviews", value["predecessorId"])
            for row in value["requirements"] + value["fields"]:
                row["sourceRefs"] = self._referral_refs(row["sourceRefs"])
                if row["receivingId"]:
                    self.referral_record("receivings", row["receivingId"])
            return self._referral_store("reviews", {**value,
                "counts": {k: dict(Counter(r["status"] for r in value[k])) for k in ["requirements", "fields"]},
                "profileSha256": source.sha(source.jbytes(self.referral_profile())),
                "profileSnapshot": self.referral_profile()})

    def assess_referrals(self, raw):
        value = schema.common(schema.obj(raw, {"label", "actor", "note", "editionId", "reviewId", "asOf"},
            {"label", "actor", "editionId", "reviewId"}, "Referral assessment"))
        with self.mutex:
            edition = self.referral_record("editions", value["editionId"])
            review = self.referral_record("reviews", value["reviewId"])
            config = self.referral_record("configurations", edition["configurationId"])
            value["asOf"] = schema.timestamp(value.get("asOf") or now(), "Assessment time", False)
            report = domain.evaluate(self, edition, review, config, as_of=value["asOf"])
            with self.scratch() as temp:
                path = Path(temp) / "assessment.json"
                original_workspace.private_write(path, source.jbytes(report))
                descriptor = self._retain_file(path, "gravity-referral-assessment")
            return self._referral_store("assessments", {**value, "configurationId": config["id"],
                "sourceId": edition["sourceId"], "summary": report["summary"], "reportFile": descriptor})

    def referral_assessment(self, ident):
        row = self.referral_record("assessments", ident)
        value = source.json_value(safe_read(self._file_path(row["reportFile"]), MAX_RECORD))
        if value["editionId"] != row["editionId"] or value["reviewId"] != row["reviewId"]:
            raise InputError("The complete assessment differs from its retained input edition")
        return value

    def referral_assessment_page(self, ident, group, offset=0, limit=50, query="", task_id=None):
        if group not in {"tasks", "findings", "cells", "decisions"}:
            raise InputError("Choose a complete assessment collection")
        rows = self.referral_assessment(ident)[group]
        if task_id:
            rows = [r for r in rows if r.get("taskId") == task_id or task_id in r.get("taskIds", [])]
        if query:
            query = schema.text(query, "Assessment search", 1000).casefold()
            rows = [r for r in rows if query in source.jbytes(r).decode().casefold()]
        return self._referral_page(rows, offset, limit)

    def save_referral_decision(self, raw):
        value = schema.decision(raw)
        with self.mutex:
            edition = self.referral_record("editions", value["editionId"])
            if any(t not in edition["taskIds"] for t in value["taskIds"]):
                raise InputError("Decision Tasks must belong to this exact source edition")
            value["sourceRefs"] = self._referral_refs(value["sourceRefs"])
            if value["supersedesId"]:
                before = self.referral_record("decisions", value["supersedesId"])
                if before["kind"] != value["kind"] or before["editionId"] != value["editionId"]:
                    raise InputError("A decision successor retains its original kind and source edition")
            with self._index(edition["sourceId"]) as index:
                for ident in value["resourceIds"]:
                    index.row(ident)
                if value["kind"] == "consent" and any(index.row(i)["resourceType"] != "Consent" for i in value["resourceIds"]):
                    raise InputError("Consent decisions select their actual original Consent resources")
                for link in value["relatedRecords"]:
                    index.row(link["fromRecordId"])
                    other = self.referral_record("editions", link["toEditionId"])
                    self.source_row(other["sourceId"], link["toRecordId"])
            if value["findingIds"]:
                if not value["assessmentId"]:
                    raise InputError("Finding decisions retain the original assessment")
                assessment = self.referral_assessment(value["assessmentId"])
                if assessment["editionId"] != edition["id"] or not set(value["findingIds"]) <= {f["id"] for f in assessment["findings"]}:
                    raise InputError("Select actual findings from the same retained source assessment")
            return self._referral_store("decisions", value)

    def compare_referral_editions(self, raw):
        value = schema.common(schema.obj(raw, {"label", "actor", "note", "beforeId", "afterId", "decisionIds"},
            {"label", "actor", "beforeId", "afterId"}, "Original edition comparison"))
        value["decisionIds"] = schema.ids(value.get("decisionIds", []), "Reviewed relationship decisions", 1000)
        with self.mutex:
            before = self.referral_record("editions", value["beforeId"])
            after = self.referral_record("editions", value["afterId"])
            decisions = [self.referral_record("decisions", i) for i in value["decisionIds"]]
            explicit = defaultdict(list)
            for decision in decisions:
                if decision["kind"] != "resource-link" or decision["editionId"] != before["id"] or decision["outcome"] not in {"accepted", "resolved"}:
                    raise InputError("Edition relationships need an accepted original resource-link decision")
                for link in decision["relatedRecords"]:
                    if link["toEditionId"] != after["id"]:
                        raise InputError("The reviewed link selects another successor edition")
                    explicit[link["fromRecordId"]].append({**link, "decisionId": decision["id"]})
            with self._graph(before["graphId"]) as (bg, bi, _, __), self._graph(after["graphId"]) as (ag, ai, ___, ____):
                old, new = list(bi.all_rows()), list(ai.all_rows())
                indexed = defaultdict(list)
                for row in new:
                    identity = qualified_identity(ai, row, ag["policy"])
                    if identity:
                        indexed[identity].append(row)
                used, changes = set(), []
                for row in old:
                    identity = qualified_identity(bi, row, bg["policy"])
                    matches = explicit.get(row["recordId"])
                    if matches:
                        candidates = [(ai.row(m["toRecordId"]), m) for m in matches]
                    else:
                        candidates = [(r, None) for r in indexed.get(identity, [])] if identity else []
                    if len(candidates) > 1 and not matches:
                        changes.append({"state": "ambiguous", "identity": identity, "beforeRecordId": row["recordId"],
                            "candidateRecordIds": [r["recordId"] for r, _ in candidates]})
                        continue
                    if not candidates:
                        changes.append({"state": "removed" if identity else "unresolved-identity",
                            "identity": identity, "beforeRecordId": row["recordId"], "beforeSha256": row["resourceSha256"]})
                    for target, reviewed in candidates:
                        used.add(target["recordId"])
                        unchanged = row["resourceSha256"] == target["resourceSha256"]
                        changes.append({"state": "unchanged" if unchanged else "changed", "identity": identity,
                            "beforeRecordId": row["recordId"], "afterRecordId": target["recordId"],
                            "beforeSha256": row["resourceSha256"], "afterSha256": target["resourceSha256"],
                            "reviewedLink": reviewed,
                            "changes": [] if unchanged else list(changed_values(row["_resource"], target["_resource"]))})
                for row in new:
                    if row["recordId"] not in used:
                        changes.append({"state": "added", "identity": qualified_identity(ai, row, ag["policy"]),
                            "afterRecordId": row["recordId"], "afterSha256": row["resourceSha256"]})
            with self.scratch() as temp:
                path = Path(temp) / "changes.json"
                original_workspace.private_write(path, source.jbytes(changes))
                descriptor = self._retain_file(path, "gravity-original-edition-comparison")
            return self._referral_store("comparisons", {**value, "summary": dict(Counter(c["state"] for c in changes)),
                "changesFile": descriptor, "beforeSourceId": before["sourceId"], "afterSourceId": after["sourceId"]})

    def referral_changes(self, ident, offset=0, limit=50):
        row = self.referral_record("comparisons", ident)
        return self._referral_page(source.json_value(safe_read(self._file_path(row["changesFile"]), MAX_RECORD)), offset, limit)

    def _referral_correction_request(self, raw):
        value = schema.common(schema.obj(raw, {"label", "actor", "note", "editionId", "reason", "patches"},
            {"label", "actor", "editionId", "reason", "patches"}, "Reviewed resource correction"))
        source.identity(value["editionId"])
        value["reason"] = schema.text(value["reason"], "Correction reason", 16000, True)
        if not isinstance(value["patches"], list) or not 1 <= len(value["patches"]) <= 1000:
            raise InputError("Retain 1–1,000 exact original path corrections")
        result = []
        for raw_patch in value["patches"]:
            p = schema.obj(raw_patch, {"recordId", "path", "action", "valueJson"}, {"recordId", "path", "action"}, "Exact resource patch")
            source.identity(p["recordId"])
            if isinstance(p["path"], str):
                p["path"] = source.pointer_tokens(p["path"])
            if not isinstance(p["path"], list) or any(not isinstance(t, str) or t == "*" for t in p["path"]):
                raise InputError("Select an exact JSON Pointer or original path-token array")
            schema.enum(p["action"], ["add", "replace", "remove"], "Patch action")
            if p["action"] != "remove":
                if not isinstance(p.get("valueJson"), str):
                    raise InputError("Add/replace retains its complete authored JSON value")
                source.json_value(p["valueJson"], lexical=True)
            elif p.get("valueJson") is not None:
                raise InputError("Remove has no replacement value")
            result.append(p)
        value["patches"] = result
        return value

    def preview_referral_correction(self, raw):
        value = self._referral_correction_request(raw)
        with self.mutex, self.scratch() as temp:
            self.referral_record("editions", value["editionId"])
            derived = CorrectionMixin._derive_correction(_CorrectionBridge(self), value, temp)
            retained = self._retain_file(derived["changesPath"], "gravity-reviewed-correction")
            changes = [source.json_value(line) for line in safe_read(derived["changesPath"], MAX_RECORD).splitlines() if line]
            return self._referral_store("correctionPreviews", {"label": value["label"], "editionId": value["editionId"],
                "request": value, "requestSha256": derived["requestSha256"], "changesFile": retained,
                "changeCount": derived["changeCount"], "derivedDocument": derived["document"],
                "preview": self._referral_page(changes, 0, 50)})

    def apply_referral_correction(self, raw):
        value = schema.obj(raw, {"previewId", "expectedRequestSha256"}, {"previewId", "expectedRequestSha256"}, "Apply exact correction")
        with self.mutex:
            preview = self.referral_record("correctionPreviews", value["previewId"])
            if preview["requestSha256"] != value["expectedRequestSha256"]:
                raise ConflictError("The selected correction differs from its retained preview")
            for previous in self.referral_records("corrections"):
                if previous["previewId"] == preview["id"]:
                    self.source(previous["sourceId"])
                    return previous
            request = preview["request"]
            before = self.referral_record("editions", request["editionId"])
            with self.scratch() as temp:
                derived = CorrectionMixin._derive_correction(_CorrectionBridge(self), request, temp)
                if derived["document"] != preview["derivedDocument"] or original_workspace.file_digest(derived["changesPath"]) != preview["changesFile"]["sha256"]:
                    raise ConflictError("Original correction source differs from the exact reviewed preview")
                old = self.source_path(before["sourceId"])
                metadata = {"schema": "stellar-forge.gravity-referral-correction.v1", "previewId": preview["id"],
                    "request": request, "requestSha256": preview["requestSha256"], "recordMap": derived["recordMap"],
                    "sourceId": before["sourceId"], "sourceEditionId": before["id"]}
                protocol_raw = source.jbytes(metadata)
                protocol = source.descriptor("protocol/correction.json", protocol_raw, role="reviewed-original-correction")
                original = {"name": "predecessors/" + before["sourceId"] + ".eltss",
                    "bytes": old.stat().st_size, "sha256": before["sourceId"], "role": "complete-original-predecessor"}
                manifest = {"schema": source.SOURCE_SCHEMA, "origin": "operator_transformation",
                    "documents": [derived["document"]], "protocol": [protocol], "predecessors": [original], "context": metadata}
                path = Path(temp) / "referral-corrected-source.zip"
                write_zip(path, {derived["document"]["name"]: derived["bundlePath"], protocol["name"]: protocol_raw,
                    original["name"]: old, "manifest.json": source.jbytes(manifest)})
                with path.open("rb") as stream:
                    added = self.add_source(stream, request["label"], path.name)
                successor = self.save_referral_edition({"label": request["label"], "actor": request["actor"],
                    "note": request["reason"], "sourceId": added["id"], "configurationId": before["configurationId"],
                    "predecessorId": before["id"], "taskIds": [derived["recordMap"][i] for i in before["taskIds"]],
                    "referencePolicy": before["referencePolicy"], "baseUrl": before["baseUrl"], "decisionIds": []})
            return self._referral_store("corrections", {"label": request["label"], "actor": request["actor"],
                "sourceEditionId": before["id"], "sourceId": added["id"], "editionId": successor["id"],
                "previewId": preview["id"], "requestSha256": preview["requestSha256"], "recordMap": derived["recordMap"]})

    def _dataset_source_scope(self, original):
        seen = set()
        while original["id"] not in seen:
            seen.add(original["id"])
            context = original["inventory"].get("sourceContext", {})
            if context.get("schema") != "stellar-forge.gravity-referral-correction.v1":
                return super()._dataset_source_scope(original)
            original = self.source(source.identity(context["sourceId"]))
        raise InputError("Original referral correction lineage is cyclic")

    def import_published_examples(self, stream, raw):
        value = schema.common(schema.obj(raw, {"label", "actor", "note", "publicationUrl", "referenceBase"},
            {"label", "actor", "publicationUrl", "referenceBase"}, "Original published examples"))
        value["publicationUrl"] = fhir.http_url(value["publicationUrl"], "Original archive URL")
        value["referenceBase"] = fhir.http_url(value["referenceBase"], "Reviewed example reference base", True)
        with self.mutex, self.scratch() as temp:
            archive_path = Path(temp) / "original-examples.zip"
            total = 0
            with archive_path.open("xb") as out:
                archive_path.chmod(0o600)
                while chunk := stream.read(65536):
                    total += len(chunk)
                    if total > source.MAX_SOURCE:
                        raise InputError("The complete original examples archive exceeds 256 MiB")
                    out.write(chunk)
            archive_sha = original_workspace.file_digest(archive_path)
            with zipfile.ZipFile(archive_path) as archive:
                infos = archive.infolist()
                if not 1 <= len(infos) <= 4096 or len({i.filename for i in infos}) != len(infos):
                    raise InputError("Original examples archive has repeated or excessive members")
                members, protocol, entry_rows, mapping, expanded = {}, [], [], [], 0
                for info in infos:
                    source.member_name(info.filename)
                    if info.is_dir():
                        continue
                    if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                        raise InputError("Original examples archive contains an unsupported member")
                    expanded += info.file_size
                    if info.file_size > source.MAX_RESOURCE or expanded > source.MAX_SOURCE:
                        raise InputError("The expanded original examples exceed the source budget")
                    data = archive.read(info.filename)
                    name = "originals/members/" + info.filename
                    members[name] = data
                    protocol.append(source.descriptor(name, data, role="unchanged-published-member"))
                    if not info.filename.endswith(".json"):
                        continue
                    resource = source.json_value(data, lexical=True)
                    if not isinstance(resource, dict) or not isinstance(resource.get("resourceType"), str):
                        continue
                    entry = {"resource": resource}
                    if isinstance(resource.get("id"), str):
                        full_url = value["referenceBase"].rstrip("/") + "/" + resource["resourceType"] + "/" + resource["id"]
                        entry["fullUrl"] = full_url
                        mapping.append({"member": info.filename, "sha256": source.sha(data), "resourceType": resource["resourceType"],
                            "logicalId": resource["id"], "reviewedFullUrl": full_url})
                    entry_rows.append(entry)
            if not entry_rows:
                raise InputError("The original selected archive contains no FHIR JSON resource examples")
            derived = source.lexical_json({"resourceType": "Bundle", "type": "collection",
                "id": "gravity-examples-" + archive_sha[:32], "entry": entry_rows}).encode() + b"\n"
            document = source.descriptor("documents/reviewed-example-collection.json", derived,
                role="reviewed-original-resource-collection", sourceUrl=None)
            context = {"schema": "stellar-forge.gravity-published-example-context.v1", **value,
                "archiveSha256": archive_sha, "referenceAssignments": mapping,
                "classification": "published_example",
                "derivation": "Unchanged published resource values in a reviewed collection; every original member and archive is retained"}
            context_raw = source.jbytes(context)
            protocol.append(source.descriptor("protocol/reviewed-context.json", context_raw, role="reviewed-reference-context"))
            protocol.append({"name": "originals/complete-examples.zip", "bytes": total,
                             "sha256": archive_sha, "role": "complete-published-original"})
            manifest = {"schema": source.SOURCE_SCHEMA, "origin": "operator_transformation",
                        "documents": [document], "protocol": protocol, "predecessors": [], "context": context}
            members.update({document["name"]: derived, "protocol/reviewed-context.json": context_raw,
                            "originals/complete-examples.zip": archive_path, "manifest.json": source.jbytes(manifest)})
            output = Path(temp) / "gravity-original-source.zip"
            write_zip(output, members)
            with output.open("rb") as received:
                added = self.add_source(received, value["label"], "gravity-original-source.zip")
            return {"source": added, "archiveSha256": archive_sha, "resourceDocuments": len(entry_rows),
                    "referenceAssignments": mapping}
