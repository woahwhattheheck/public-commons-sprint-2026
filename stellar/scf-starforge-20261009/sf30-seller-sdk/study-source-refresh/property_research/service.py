"""Property research uses the original workspace transaction, lock and event stream."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile

from model import clone, encoded, fail, hash_id, identity, integer, now, parse, private_directory, read, sync_directory, text, write
from workspace import file_identity, unpack
from . import model as m


def install(workspace):
    current = workspace.connection.execute("SELECT value FROM meta WHERE key='property_research'").fetchone()
    if current:
        if current[0] != m.EXTENSION:
            fail("PROPERTY_WORKSPACE_VERSION_MISMATCH")
        return
    with workspace.mutation():
        for statement in m.DDL.split(";"):
            if statement.strip():
                workspace.connection.execute(statement)
        workspace.connection.execute("INSERT OR IGNORE INTO meta VALUES('property_research',?)", (m.EXTENSION,))


def overview(workspace):
    if not workspace.connection.execute("SELECT 1 FROM meta WHERE key='property_research'").fetchone():
        return {"documents": [], "studies": [], "editions": [], "reviews": [], "selections": []}
    result = {}
    for table in m.TABLES:
        values = []
        for row in workspace.connection.execute("SELECT * FROM " + table + " ORDER BY created DESC"):
            body = unpack(row["body"])
            item = {"id": row["id"], "created": row["created"], **body}
            for key in ("properties", "original_packet", "rows", "decisions", "review_snapshot", "items"):
                item.pop(key, None)
            values.append(item)
        result[table.removeprefix("property_")] = values
    return result


def copy_original(source, destination):
    source = Path(source).expanduser().absolute()
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    digest, size = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 512 * 1024 * 1024:
            fail("PROPERTY_DOCUMENT_FILE_REQUIRED")
        out = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(out, "wb") as retained:
            while raw := stream.read(65536):
                size += len(raw)
                if size > before.st_size:
                    fail("PROPERTY_DOCUMENT_CHANGED")
                digest.update(raw)
                retained.write(raw)
            retained.flush()
            os.fsync(retained.fileno())
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or size != before.st_size:
            fail("PROPERTY_DOCUMENT_CHANGED")
    return {"bytes": size, "sha256": digest.hexdigest()}


class PropertyResearch:
    def __init__(self, workspace):
        self.w = workspace
        install(workspace)

    def status(self):
        return {"schema": m.EXTENSION, **overview(self.w), "criteria": m.CRITERIA}

    def _record(self, table, record_id):
        if table not in m.TABLES:
            fail("PROPERTY_RECORD_KIND_INVALID")
        row = self.w.connection.execute("SELECT * FROM " + table + " WHERE id=?", (hash_id(record_id),)).fetchone()
        if row is None:
            fail("PROPERTY_RECORD_NOT_FOUND", kind=table, id=record_id)
        return {"id": row["id"], "created": row["created"], **unpack(row["body"])}

    def _put(self, table, body, operation, record_id=None):
        rid = record_id or identity(body)
        previous = self.w.connection.execute("SELECT body FROM " + table + " WHERE id=?", (rid,)).fetchone()
        if previous:
            if unpack(previous["body"]) != body:
                fail("PROPERTY_RECORD_CONFLICT", kind=table, id=rid)
            return {**self._record(table, rid), "reopened": True}
        self.w.connection.execute("INSERT INTO " + table + " VALUES(?,?,?)", (rid, encoded(body).decode(), now()))
        self.w.event(operation, rid, {"schema": body["schema"], "label": body.get("label", body.get("name"))})
        return {**self._record(table, rid), "reopened": False}

    def document(self, document_id):
        item = self._record("property_documents", document_id)
        root = self.w.directory / "property-documents" / document_id
        if root.is_symlink() or root.resolve(strict=True) != root:
            fail("PROPERTY_DOCUMENT_INVENTORY_CHANGED")
        if {x["path"] for x in item["files"]} != {str(p.relative_to(root)) for p in root.rglob("*") if not p.is_dir()}:
            fail("PROPERTY_DOCUMENT_INVENTORY_CHANGED")
        for member in item["files"]:
            path = root / member["path"]
            if path.resolve(strict=True) != path or file_identity(path) != {k: member[k] for k in ("bytes", "sha256")}:
                fail("PROPERTY_DOCUMENT_CHANGED", document_id=document_id)
        return item

    def import_document(self, path, metadata):
        metadata = m.document(metadata)
        suffix = Path(path).suffix.lower()
        if suffix not in (".pdf", ".csv", ".json", ".txt", ".html", ".xlsx", ".geojson", ".zip"):
            fail("PROPERTY_DOCUMENT_FORMAT_UNSUPPORTED")
        parent = private_directory(self.w.directory / "property-documents")
        stage = Path(tempfile.mkdtemp(prefix=".document-", dir=parent))
        try:
            name = "original" + suffix
            digest = copy_original(path, stage / name)
            body = {"schema": "stellar-forge.property-document.v1", "metadata": metadata,
                    "label": metadata["title"], "key": metadata["key"], "files": [{"path": name, **digest}]}
            rid = identity(body)
            with self.w.mutation():
                target = parent / rid
                if target.exists():
                    for file in body["files"]:
                        if file_identity(target / file["path"]) != {k: file[k] for k in ("bytes", "sha256")}:
                            fail("PROPERTY_DOCUMENT_CONFLICT")
                else:
                    os.rename(stage, target)
                    stage = None
                    sync_directory(parent)
                saved = self._put("property_documents", body, "property.document.import")
                self.document(rid)
                return saved
        finally:
            if stage is not None:
                shutil.rmtree(stage)

    def _bindings(self, document_ids):
        if not isinstance(document_ids, dict) or len(document_ids) > 1000:
            fail("PROPERTY_DOCUMENT_BINDINGS_REQUIRED")
        documents = {}
        for key, rid in document_ids.items():
            item = self.document(rid)
            if key != item["key"]:
                fail("PROPERTY_DOCUMENT_KEY_MISMATCH")
            documents[key] = item["metadata"]
        return documents

    def freeze_study(self, value, document_ids):
        documents = self._bindings(document_ids)
        body = {"schema": "stellar-forge.property-study.v1", **m.study(value, documents), "document_ids": clone(document_ids)}
        with self.w.mutation():
            return self._put("property_studies", body, "property.study.freeze")

    def intake(self, *, document_ids, operator, label, packet=None, path=None, previous_id=None, note=""):
        text(operator, "operator", maximum=200)
        text(label, "label", maximum=1000)
        m.optional_text(note, "note", 16000)
        if (packet is None) == (path is None):
            fail("PROPERTY_INTAKE_ONE_INPUT_REQUIRED")
        raw = read(Path(path).expanduser().resolve(), 64 * 1024 * 1024) if path is not None else encoded(packet)
        original = parse(raw)
        documents = self._bindings(document_ids)
        value = m.intake(original, documents)
        declared = {item["key"]: m.document(item) for item in value.get("documents", [])}
        for key, doc in documents.items():
            if key not in declared or any(declared[key].get(f) != doc.get(f) for f in ("key", "title", "url")):
                fail("PROPERTY_DOCUMENT_DECLARATION_MISMATCH", document_key=key)
        if previous_id:
            previous = self._record("property_editions", previous_id)
            if previous["study_key"] != value["study"]["key"]:
                fail("PROPERTY_STUDY_LINEAGE_MISMATCH")
            text(note, "revision note", maximum=16000)
        study_body = {"schema": "stellar-forge.property-study.v1", **value["study"], "document_ids": clone(document_ids)}
        study_id = identity(study_body)
        details = m.edition_details(value["properties"])
        body = {"schema": "stellar-forge.property-edition.v1", "study_id": study_id, "study_key": value["study"]["key"],
                "document_ids": clone(document_ids), "operator": operator, "label": label, "note": note,
                "previous_id": previous_id, "properties": value["properties"], "source_comparables": value["source_comparables"],
                "original_packet": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()},
                **details}
        eid = identity(body)
        parent = private_directory(self.w.directory / "property-intakes")
        stage = Path(tempfile.mkdtemp(prefix=".intake-", dir=parent))
        try:
            write(stage / "intake.json", raw)
            with self.w.mutation():
                target = parent / eid
                if target.exists():
                    if file_identity(target / "intake.json") != body["original_packet"]:
                        fail("PROPERTY_INTAKE_FILE_CHANGED")
                else:
                    os.rename(stage, target)
                    stage = None
                    sync_directory(parent)
                self._put("property_studies", study_body, "property.study.freeze")
                return self._put("property_editions", body, "property.edition.freeze")
        finally:
            if stage is not None:
                shutil.rmtree(stage)

    def packet(self, edition_id):
        edition = self._record("property_editions", edition_id)
        path = self.w.directory / "property-intakes" / edition_id / "intake.json"
        if file_identity(path) != edition["original_packet"]:
            fail("PROPERTY_INTAKE_FILE_CHANGED")
        return parse(read(path, 64 * 1024 * 1024))

    def edition(self, edition_id, *, search="", offset=0, limit=50):
        value = self._record("property_editions", edition_id)
        integer(offset, "offset", maximum=10000000)
        integer(limit, "limit", minimum=1, maximum=10000)
        search = text(search, "search", empty=True, maximum=2000).casefold()
        rows = [p for p in value["properties"] if search in " ".join(str(p.get(f, "")) for f in ("key", "name", "address", "programs")).casefold()]
        return {**value, "properties": rows[offset:offset + limit], "offset": offset, "total": len(rows),
                "next": offset + limit if offset + limit < len(rows) else None,
                "study": self._record("property_studies", value["study_id"])}

    def revise(self, edition_id, packet, operator, label, note, document_ids=None):
        original = self._record("property_editions", edition_id)
        return self.intake(packet=packet, document_ids=document_ids if document_ids is not None else original["document_ids"],
                           operator=operator, label=label, previous_id=edition_id, note=note)

    def compare(self, candidate_id, operator, label, baseline_id=None, note="", unchanged="review"):
        if unchanged not in ("review", "accept"):
            fail("PROPERTY_UNCHANGED_POLICY_INVALID")
        text(operator, "operator", maximum=200)
        text(label, "label", maximum=1000)
        m.optional_text(note, "note", 16000)
        candidate = self._record("property_editions", candidate_id)
        baseline = self._record("property_editions", baseline_id) if baseline_id else None
        if baseline and baseline["study_key"] != candidate["study_key"]:
            fail("PROPERTY_STUDY_LINEAGE_MISMATCH")
        rows = m.comparison_rows(candidate, baseline)
        request = {"baseline_id": baseline_id, "candidate_id": candidate_id, "operator": operator,
                   "label": label, "note": note, "unchanged": unchanged}
        rid = identity(request)
        decisions = {r["key"]: {"action": "accept", "automatic": True, "operator": operator,
                      "note": "Frozen unchanged-record policy"} for r in rows if r["kind"] == "unchanged" and unchanged == "accept"}
        body = {"schema": "stellar-forge.property-review.v1", **request, "version": 0, "rows": rows, "decisions": decisions}
        with self.w.mutation():
            if self.w.connection.execute("SELECT 1 FROM property_reviews WHERE id=?", (rid,)).fetchone():
                return self.comparison(rid)
            self._put("property_reviews", body, "property.comparison.create", rid)
        return self.comparison(rid)

    def comparison(self, review_id, offset=0, limit=50):
        body = self._record("property_reviews", review_id)
        integer(offset, "offset", maximum=10000000)
        integer(limit, "limit", minimum=1, maximum=10000)
        all_rows = body["rows"]
        candidate = self._record("property_editions", body["candidate_id"])
        baseline = self._record("property_editions", body["baseline_id"]) if body["baseline_id"] else None
        before = {p["key"]: p for p in baseline["properties"]} if baseline else {}
        after = {p["key"]: p for p in candidate["properties"]}
        rows = [{**row, "decision": body["decisions"].get(row["key"]),
                 "before": before.get(row["key"]), "after": after.get(row["key"])} for row in all_rows[offset:offset + limit]]
        return {**body, "rows": rows, "pending": sum(row["key"] not in body["decisions"] for row in all_rows),
                "total": len(all_rows), "offset": offset, "next": offset + limit if offset + limit < len(all_rows) else None}

    def review(self, review_id, expected_version, keys, action, operator, note):
        if action not in ("accept", "exclude"):
            fail("PROPERTY_REVIEW_ACTION_INVALID")
        text(operator, "operator", maximum=200)
        text(note, "review note", maximum=16000)
        integer(expected_version, "expected_version")
        if not isinstance(keys, list) or not keys or any(not isinstance(k, str) for k in keys) or len(keys) != len(set(keys)):
            fail("PROPERTY_REVIEW_KEYS_REQUIRED")
        with self.w.mutation():
            value = self._record("property_reviews", review_id)
            if value["version"] != expected_version:
                fail("REVIEW_CHANGED", current_version=value["version"])
            row_keys = {r["key"] for r in value["rows"]}
            if not set(keys) <= row_keys or any(k.startswith("@") for k in keys) and action != "accept":
                fail("PROPERTY_REVIEW_KEY_INVALID")
            prior = {key: value["decisions"].get(key) for key in keys}
            decision = {"action": action, "operator": operator, "note": note, "automatic": False, "time": now()}
            for key in keys:
                value["decisions"][key] = decision
            value["version"] += 1
            body = {k: v for k, v in value.items() if k not in ("id", "created")}
            self.w.connection.execute("UPDATE property_reviews SET body=? WHERE id=?", (encoded(body).decode(), review_id))
            self.w.event("property.review.apply", review_id, {"version": value["version"], "keys": keys, "before": prior, "decision": decision})
        return self.comparison(review_id)

    def select(self, review_id, expected_version, operator, purpose, label, items, criteria=None, note=""):
        text(operator, "operator", maximum=200)
        text(purpose, "purpose", maximum=1000)
        text(label, "label", maximum=1000)
        m.optional_text(note, "note", 16000)
        integer(expected_version, "expected_version")
        criteria = clone(m.CRITERIA if criteria is None else criteria)
        if not isinstance(criteria, list) or not 1 <= len(criteria) <= 100:
            fail("PROPERTY_SELECTION_CRITERIA_REQUIRED")
        criterion_keys = set()
        for c in criteria:
            c = m.object_value(c, "criterion")
            ck = m.key(c.get("key"), "criterion key")
            text(c.get("label"), "criterion label", maximum=1000)
            if ck in criterion_keys:
                fail("PROPERTY_DUPLICATE_CRITERION")
            criterion_keys.add(ck)
        with self.w.mutation():
            review = self._record("property_reviews", review_id)
            if review["version"] != expected_version:
                fail("REVIEW_CHANGED", current_version=review["version"])
            if any(row["key"] not in review["decisions"] for row in review["rows"]):
                fail("PROPERTY_REVIEW_INCOMPLETE")
            edition = self._record("property_editions", review["candidate_id"])
            properties = {p["key"]: p for p in edition["properties"]}
            if not isinstance(items, list) or len(items) != len(properties) or any(not isinstance(x, dict) for x in items) or {x.get("property_key") for x in items} != set(properties):
                fail("PROPERTY_SELECTION_ALL_PROPERTIES_REQUIRED")
            normalized = []
            for item in items:
                item = m.object_value(item, "selection item")
                pk = item["property_key"]
                if item.get("decision") not in ("comparable", "context", "exclude"):
                    fail("PROPERTY_SELECTION_DECISION_INVALID")
                item["reason"] = text(item.get("reason"), "selection reason", maximum=16000)
                assessments = m.object_value(item.get("assessments", {}), "assessments")
                if not set(assessments) <= criterion_keys:
                    fail("PROPERTY_CRITERION_NOT_IN_SELECTION")
                for value in assessments.values():
                    text(value, "criterion assessment", maximum=8000)
                item["assessments"] = assessments
                if item["decision"] != "exclude" and review["decisions"][pk]["action"] != "accept":
                    fail("PROPERTY_SELECTION_SOURCE_EXCLUDED", property_key=pk)
                available = {u["key"] for u in properties[pk]["units"]}
                selected = item.get("unit_keys", sorted(available))
                if not isinstance(selected, list) or any(not isinstance(k, str) for k in selected) or len(set(selected)) != len(selected) or not set(selected) <= available:
                    fail("PROPERTY_SELECTION_UNIT_NOT_FOUND")
                if item["decision"] == "comparable" and not selected:
                    fail("PROPERTY_COMPARABLE_UNIT_SELECTION_REQUIRED")
                item["unit_keys"] = sorted(selected)
                normalized.append(item)
            body = {"schema": "stellar-forge.property-selection.v1", "review_id": review_id,
                    "review_version": expected_version, "candidate_id": review["candidate_id"], "baseline_id": review["baseline_id"],
                    "study_id": edition["study_id"], "operator": operator, "purpose": purpose, "label": label, "note": note,
                    "criteria": criteria, "items": sorted(normalized, key=lambda x: x["property_key"]),
                    "review_snapshot": {k: v for k, v in review.items() if k not in ("id", "created")},
                    "counts": {decision: sum(x["decision"] == decision for x in normalized) for decision in ("comparable", "context", "exclude")}}
            return self._put("property_selections", body, "property.selection.freeze")

    def selection(self, selection_id):
        item = self._record("property_selections", selection_id)
        body = {k: v for k, v in item.items() if k not in ("id", "created")}
        if identity(body) != selection_id:
            fail("PROPERTY_SELECTION_CHANGED")
        return item

    def report(self, selection_id):
        from .reporting import report
        return report(self, self.selection(selection_id))

    def export(self, selection_id, operator, label, destination=None):
        from .delivery import export_package
        return export_package(self, selection_id, operator, label, destination)
