"""MIT. Original HSDS/HSD file custody, source indices, editions and complete comparison."""
from __future__ import annotations
from contextlib import contextmanager
from collections import Counter
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import zipfile
from directory_runtime import (InputError, ConflictError, private_directory, safe_read, now,
    fhir, original_workspace)
from directory_source_schema import (SOURCE_SCHEMA, EDITION_SCHEMA, COMPARISON_SCHEMA, CAPTURE_SCHEMA,
    MAX_BYTES, MAX_RECORD, MAX_INTERACTIVE, MAX_MEMBERS, MAX_ROWS, MAX_PAGES, source_catalogue,
    import_value, typed, sha, jbytes, json_value, lexical_json, standards, descriptor_ref)
from directory_acquisition import DirectoryAcquisition
import directory_index as index
from eltss_source import member_name
from eltss_runtime import write_zip


def _content_type(name):
    name = name.lower()
    if name.endswith(".json"):
        return "application/json"
    if name.endswith(".ndjson") or name.endswith(".jsonl"):
        return "application/x-ndjson"
    if name.endswith(".csv"):
        return "text/csv"
    if name.endswith(".zip"):
        return "application/zip"
    return "application/octet-stream"


def _original_filename(spec, original_sha256):
    """Use a reviewed filename or exact-content name, never a runtime upload path."""
    if spec.get("filename"):
        return member_name(spec["filename"])
    extension = ".zip" if spec["format"].endswith("-zip") or spec["format"] == "directory-capture" else \
        ".csv" if spec["format"] == "hsds-csv" else ".json"
    return "directory-" + original_sha256 + extension


def _copy(stream, path, maximum=MAX_BYTES):
    total, digest = 0, hashlib.sha256()
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        while block := stream.read(65536):
            total += len(block)
            if total > maximum:
                raise InputError("Complete original directory file exceeds its supported byte budget")
            digest.update(block)
            out.write(block)
        out.flush()
        os.fsync(out.fileno())
    return {"bytes": total, "sha256": digest.hexdigest()}


def _zip_members(archive):
    infos = archive.infolist()
    if len(infos) > MAX_MEMBERS or len({i.filename for i in infos}) != len(infos):
        raise InputError("Original directory archive has duplicate or excessive members")
    total, output = 0, []
    for info in infos:
        name = info.filename[:-1] if info.is_dir() else info.filename
        member_name(name)
        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode) or info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise InputError("Original directory archive has an unsupported member type or encryption")
        if info.is_dir():
            continue
        total += info.file_size
        if info.file_size > MAX_BYTES or total > MAX_BYTES:
            raise InputError("Complete expanded original directory archive exceeds 256 MiB")
        output.append(info)
    if not output:
        raise InputError("Original directory archive contains no complete source members")
    return output


def retained_file_descriptors(value):
    """Return only native original-file descriptors, including nested operation recovery."""
    found = {}
    def walk(item):
        if isinstance(item, dict):
            if isinstance(item.get("sha256"), str) and len(item["sha256"]) == 64 and \
                    type(item.get("bytes")) is int and isinstance(item.get("role"), str):
                fhir.identity(item["sha256"])
                fhir.integer(item["bytes"], 0, MAX_BYTES, "Retained directory file size")
                found[item["sha256"]] = {k: item[k] for k in ("sha256", "bytes", "role")}
            for child in item.values():
                walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)
    walk(value)
    return [found[k] for k in sorted(found)]


class DirectorySources(DirectoryAcquisition):
    def init_directory_sources(self):
        # Existing original eLTSS file custody stores every index and HTTP body.
        # Only original operation journals need a private local recovery directory.
        private_directory(self.root / "directory")
        private_directory(self.root / "directory" / "operations")
        return {"schema": "stellar-forge.directory-source-storage.v1",
                "rowTables": [], "fileStore": "original-eltss", "workspaceId": self.workspace_id}

    def directory_source_catalogue(self):
        return source_catalogue()

    def _directory_source(self, ident):
        return self.directory_record("sources", fhir.identity(ident))

    def directory_source(self, ident):
        with self.mutex:
            return self._directory_source(ident)

    def directory_import(self, path, raw):
        """Retain complete original bytes before their explicit, immutable interpretation."""
        spec = import_value(raw)
        path = Path(path)
        with self.mutex:
            original_workspace.regular(path, MAX_BYTES)
            original = self._retain_file(path, "directory-original-source")
            # Interpret the retained verified copy, not a mutable caller-owned path.
            source_path = self._file_path(original)
            with self.scratch() as scratch:
                scratch = Path(scratch)
                rows_path = scratch / "directory-source.sqlite"
                builder = index.IndexBuilder(rows_path, reference_base=spec["referenceBase"])
                members, documents, capture = [], [], None
                try:
                    if spec["format"] in {"hsds-csv-zip", "fhir-json-zip", "directory-capture"}:
                        with zipfile.ZipFile(source_path) as archive:
                            infos = _zip_members(archive)
                            names = {i.filename: i for i in infos}
                            # Retain every original archive member, including non-indexed documentation.
                            for n, info in enumerate(infos):
                                temporary = scratch / ("member-" + str(n) + ".bin")
                                with archive.open(info) as stream:
                                    observed = _copy(stream, temporary, info.file_size)
                                if observed["bytes"] != info.file_size:
                                    raise InputError("Original archive member did not complete its declared byte count")
                                file = self._retain_file(temporary, "directory-original-member")
                                members.append({"name": info.filename, "bytes": file["bytes"], "sha256": file["sha256"],
                                    "contentType": _content_type(info.filename), "file": file})
                                temporary.unlink()
                            by_name = {m["name"]: m for m in members}
                            if spec["format"] == "directory-capture":
                                capture = self._directory_capture_manifest(archive, by_name)
                                selected = capture["documents"]
                            else:
                                selected = spec["members"]
                            seen = set()
                            for entry in selected:
                                name = member_name(entry["name"])
                                if name in seen or name not in names:
                                    raise InputError("Selected original archive member is repeated or missing: " + name)
                                seen.add(name)
                                member = by_name[name]
                                if spec["format"] == "directory-capture":
                                    selection = entry["selection"]
                                elif spec["format"] == "hsds-csv-zip":
                                    selection = {"format": "hsds-csv", "table": entry["table"],
                                        "encoding": entry.get("encoding", spec["encoding"]),
                                        "delimiter": entry.get("delimiter", spec["delimiter"])}
                                else:
                                    selection = {"format": "fhir-json"}
                                self._directory_validate_document(selection)
                                with self._file_path(member["file"]).open("rb") as stream:
                                    description = builder.document(member, selection, stream)
                                documents.append({k: v for k, v in description.items() if k != "header"})
                    else:
                        name = _original_filename(spec, original["sha256"])
                        member = {"name": name, "sha256": original["sha256"], "bytes": original["bytes"],
                            "contentType": _content_type(name), "file": original}
                        members = [member]
                        selection = {k: spec[k] for k in ("format", "table", "layout", "encoding", "delimiter") if k in spec}
                        self._directory_validate_document(selection)
                        with source_path.open("rb") as stream:
                            description = builder.document(member, selection, stream)
                        documents = [{k: v for k, v in description.items() if k != "header"}]
                    summary = builder.finish()
                except Exception as error:
                    builder.close()
                    if isinstance(error, (sqlite3.DatabaseError, zipfile.BadZipFile, RuntimeError, EOFError)):
                        raise InputError("The complete original directory or derived index could not be read within its supported limits") from error
                    raise
                index_file = self._retain_file(rows_path, "directory-source-index")
            record = {"schema": SOURCE_SCHEMA, "label": spec["label"], "format": spec["format"],
                "origin": spec["origin"], "scope": spec["scope"], "publisher": spec["publisher"],
                "sourceUrl": spec["sourceUrl"], "referenceBase": spec["referenceBase"],
                "note": spec["note"], "interpretation": spec, "originalFile": original,
                "originalSha256": original["sha256"], "members": members, "documents": documents,
                "indexFile": index_file, "inventory": summary,
                "schemaEditions": [{"id": "hsds-3.3.1", "release": "v3.3.1", "originalDatapackageVersion": standards()["datapackage"].get("version")},
                    {"id": "fhir-hsd-1.0.0-authoring", "release": "1.0.0-STU1", "underlyingHsdsMappingVersion": "2.0.1"}]}
            if capture is not None:
                record["capture"] = {k: capture.get(k) for k in
                    ("schema", "workspaceId", "operationId", "requestId", "requestSha256",
                     "complete", "state", "receivedRecords", "receivedRows", "pageCount", "scope")}
                record["capture"]["provenance"] = "verified-complete-imported-file-graph"
            return self._directory_store("sources", record)

    def _directory_validate_document(self, selection):
        if not isinstance(selection, dict):
            raise InputError("Original capture document interpretation must be an object")
        allowed = {"format", "table", "layout", "encoding", "delimiter"}
        if set(selection) - allowed or selection.get("format") not in {"hsds-json", "hsds-csv", "fhir-json"}:
            raise InputError("Unsupported original capture document interpretation")
        if selection["format"].startswith("hsds-"):
            layout = selection.get("layout", "entity")
            if layout != "tables" and selection.get("table") not in standards()["tables"]:
                raise InputError("Choose the exact selected canonical HSDS table")
            if layout not in {"entity", "array", "page", "tables"}:
                raise InputError("Unsupported selected HSDS document layout")
        return selection

    def _directory_capture_manifest(self, archive, members):
        if "manifest.json" not in members or members["manifest.json"]["bytes"] > MAX_RECORD:
            raise InputError("Directory capture needs its complete bounded manifest.json")
        raw = archive.read("manifest.json")
        value = json_value(raw)
        if not isinstance(value, dict) or value.get("schema") != CAPTURE_SCHEMA:
            raise InputError("Unsupported original directory capture manifest")
        if not isinstance(value.get("documents"), list) or not 1 <= len(value["documents"]) <= MAX_PAGES:
            raise InputError("Directory capture must retain 1–512 selected complete original documents")
        declared = value.get("files")
        if not isinstance(declared, list):
            raise InputError("Directory capture must declare every complete original member")
        seen = set()
        for item in declared:
            if not isinstance(item, dict):
                raise InputError("Invalid original capture member declaration")
            name = member_name(item.get("name"))
            if name == "manifest.json" or name in seen or name not in members:
                raise InputError("Original capture contains a repeated, missing or invalid member")
            seen.add(name)
            if item.get("sha256") != members[name]["sha256"] or item.get("bytes") != members[name]["bytes"]:
                raise InputError("Original capture member hash or byte count differs from its declaration")
        if seen | {"manifest.json"} != set(members):
            raise InputError("Original capture has undeclared complete files")
        for selected in value["documents"]:
            if not isinstance(selected, dict) or selected.get("name") not in seen:
                raise InputError("Original capture selected document is not a retained declared member")
            self._directory_validate_document(selected.get("selection"))
        return value

    def directory_source_members(self, ident):
        with self.mutex:
            return self._directory_source(ident)["members"]

    def directory_source_file(self, ident, member=None):
        with self.mutex:
            source = self._directory_source(ident)
            if member is None:
                file = source["originalFile"]
                name = _original_filename(source["interpretation"], source["originalSha256"])
                return self._file_path(file), {**file, "name": name, "contentType": _content_type(name)}
            name = member_name(member)
            file = next((m for m in source["members"] if m["name"] == name), None)
            if file is None:
                raise InputError("Choose an exact original member from this retained source")
            return self._file_path(file["file"]), {**file["file"], "name": name, "contentType": file["contentType"]}

    @contextmanager
    def directory_open_index(self, kind, ident):
        if kind not in {"sources", "editions", "comparisons"}:
            raise InputError("Select a source, edition or comparison index")
        with self.mutex:
            record = self.directory_record(kind, fhir.identity(ident))
            path = self._file_path(record["indexFile"])
            with index.open_index(path) as db:
                yield db

    def directory_source_rows(self, ident, offset=0, limit=50, table=None, query=""):
        with self.directory_open_index("sources", ident) as db:
            return {"sourceId": ident, **index.page(db, offset=offset, limit=limit, table=table, query=query, source_id=ident)}

    def directory_source_row(self, ident, record_id):
        with self.directory_open_index("sources", ident) as db:
            return index.one(db, record_id, output_source_id=ident)

    def directory_iter_rows(self, kind, ident, table=None):
        if kind not in {"sources", "editions"}:
            raise InputError("Iterate an exact retained source or frozen edition")
        with self.directory_open_index(kind, ident) as db:
            where, args = (" WHERE table_name=?", [table]) if table is not None else ("", [])
            for row in db.execute("SELECT * FROM records" + where + " ORDER BY table_name,source_id,rowid", args):
                yield index._record(row, ident if kind == "sources" else None)

    def directory_edition(self, raw):
        value = typed("edition", raw)
        if not value["label"].strip() or not value["actor"].strip():
            raise InputError("Name the directory edition and its reviewing operator")
        value.setdefault("predecessorId", None)
        value.setdefault("tables", [])
        value.setdefault("scope", "unknown")
        value.setdefault("note", "")
        if not value["sourceIds"] or len(set(value["sourceIds"])) != len(value["sourceIds"]):
            raise InputError("Freeze a nonempty exact source selection without repeated source IDs")
        if len(set(value["tables"])) != len(value["tables"]):
            raise InputError("Select each exact table/resource type once")
        with self.mutex:
            if value["predecessorId"]:
                self.directory_record("editions", value["predecessorId"])
            selected, descriptors = [], []
            for source_id in value["sourceIds"]:
                source = self._directory_source(source_id)
                selected.append((source_id, self._file_path(source["indexFile"]), value["tables"]))
                descriptors.append({"sourceId": source_id, "originalSha256": source["originalSha256"],
                    "format": source["format"], "origin": source["origin"], "scope": source["scope"],
                    "capture": source.get("capture"), "indexFile": source["indexFile"]})
            available = {table for source_id in value["sourceIds"] for table in self._directory_source(source_id)["inventory"]["tables"]}
            if set(value["tables"]) - available:
                raise InputError("A selected edition table/resource type has no original records in these sources")
            with self.scratch() as scratch:
                target = Path(scratch) / "directory-edition.sqlite"
                summary = index.compose_index(target, selected)
                file = self._retain_file(target, "directory-edition-index")
            return self._directory_store("editions", {"schema": EDITION_SCHEMA, **value,
                "sources": descriptors, "indexFile": file, "inventory": summary,
                "completeness": {"claim": value["scope"], "basis": "explicit-reviewed-source-selection",
                    "remoteCompletenessInferred": False},
                "identityPolicy": "Exact original IDs, source pointers and reference aliases; duplicates are preserved"})

    def directory_edition_rows(self, ident, offset=0, limit=50, table=None, query=""):
        with self.directory_open_index("editions", ident) as db:
            return {"editionId": ident, **index.page(db, offset=offset, limit=limit, table=table, query=query)}

    def directory_edition_row(self, ident, source_id, record_id):
        with self.directory_open_index("editions", ident) as db:
            return index.one(db, record_id, source_id)

    def directory_lookup(self, edition_id, protocol, table, native_id):
        if protocol not in {"hsds", "fhir-hsd"} or type(native_id) is not str:
            raise InputError("Exact identity lookup selects a protocol, table and original text ID")
        with self.directory_open_index("editions", edition_id) as db:
            count = db.execute("SELECT count(*) FROM records WHERE protocol=? AND table_name=? AND native_id=?",
                (protocol, table, native_id)).fetchone()[0]
            rows = [index._record(row, include_content=False) for row in db.execute(
                "SELECT * FROM records WHERE protocol=? AND table_name=? AND native_id=? ORDER BY source_id,record_id LIMIT 250",
                (protocol, table, native_id))]
            return {"editionId": edition_id, "protocol": protocol, "table": table, "nativeId": native_id,
                "state": "resolved" if count == 1 else "ambiguous" if count > 1 else "unresolved",
                "rows": rows, "total": count, "truncated": count > len(rows)}

    def directory_edition_links(self, ident, offset=0, limit=50, record_id=None):
        with self.directory_open_index("editions", ident) as db:
            return {"editionId": ident, **index.links_page(db, offset=offset, limit=limit, record_id=record_id)}

    def directory_link_targets(self, ident, source_id, link_id, offset=0, limit=50):
        fhir.identity(source_id)
        fhir.identity(link_id)
        fhir.integer(offset, 0, 10000000, "Reference target offset")
        fhir.integer(limit, 1, 250, "Reference target limit")
        with self.directory_open_index("editions", ident) as db:
            total = db.execute("SELECT count(*) FROM resolved_targets WHERE source_id=? AND link_id=?", (source_id, link_id)).fetchone()[0]
            rows = [{"sourceId": row[0], "recordId": row[1]} for row in db.execute(
                "SELECT target_source,target_record FROM resolved_targets WHERE source_id=? AND link_id=? ORDER BY target_source,target_record LIMIT ? OFFSET ?",
                (source_id, link_id, limit, offset))]
            return {"rows": rows, "total": total, "offset": offset, "limit": limit,
                "nextOffset": offset + len(rows) if offset + len(rows) < total else None,
                "bytes": len(jbytes(rows)), "byteBudget": MAX_INTERACTIVE}

    def directory_compare(self, raw):
        value = typed("comparison", raw)
        value.setdefault("reviewedLinks", [])
        value.setdefault("note", "")
        if not value["label"].strip() or not value["actor"].strip():
            raise InputError("Name the directory comparison and its reviewing operator")
        for link in value["reviewedLinks"]:
            if not link["reason"].strip():
                raise InputError("Every explicit cross-edition identity link needs its reviewed reason")
        with self.mutex:
            before = self.directory_record("editions", value["beforeEditionId"])
            after = self.directory_record("editions", value["afterEditionId"])
            with self.scratch() as scratch:
                target = Path(scratch) / "directory-comparison.sqlite"
                summary = index.compare_indices(target, self._file_path(before["indexFile"]),
                    self._file_path(after["indexFile"]), value["reviewedLinks"])
                file = self._retain_file(target, "directory-comparison-index")
            return self._directory_store("comparisons", {"schema": COMPARISON_SCHEMA, **value,
                "before": {"id": before["id"], "sourceIds": before["sourceIds"], "scope": before["scope"], "indexFile": before["indexFile"]},
                "after": {"id": after["id"], "sourceIds": after["sourceIds"], "scope": after["scope"], "indexFile": after["indexFile"]},
                "indexFile": file, "summary": summary})

    def directory_comparison(self, ident):
        with self.mutex:
            return self.directory_record("comparisons", fhir.identity(ident))

    def directory_changes(self, ident, offset=0, limit=50, state=None):
        with self.directory_open_index("comparisons", ident) as db:
            return {"comparisonId": ident, **index.changes_page(db, offset, limit, state)}

    def directory_index_file(self, kind, ident):
        if kind not in {"sources", "editions", "comparisons"}:
            raise InputError("Select an original source, frozen edition or comparison index")
        with self.mutex:
            record = self.directory_record(kind, fhir.identity(ident))
            return self._file_path(record["indexFile"]), {**record["indexFile"],
                "name": "directory-" + kind + "-" + ident + ".sqlite", "contentType": "application/vnd.sqlite3"}

    def directory_record_file(self, source_id, record_id):
        with self.directory_open_index("sources", source_id) as db:
            row = index.one(db, record_id, output_source_id=source_id)
            with self.scratch() as scratch:
                path = Path(scratch) / "record.json"
                raw = (row["json"] + "\n").encode("utf-8")
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                file = self._retain_file(path, "directory-complete-record-values")
        return self._file_path(file), {**file, "name": "directory-record-" + record_id + ".json", "contentType": "application/json"}

    def directory_changes_file(self, ident):
        with self.directory_open_index("comparisons", ident) as db:
            with self.scratch() as scratch:
                path = Path(scratch) / "changes.jsonl"
                size = 0
                with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                    for row in db.execute("SELECT body FROM changes ORDER BY ordinal"):
                        raw = row[0].rstrip("\n").encode() + b"\n"
                        size += len(raw)
                        if size > MAX_BYTES:
                            raise InputError("Complete comparison text exceeds 256 MiB; retain its full SQLite index instead")
                        stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                file = self._retain_file(path, "directory-complete-comparison")
        return self._file_path(file), {**file, "name": "directory-changes-" + ident + ".jsonl", "contentType": "application/x-ndjson"}

    def _directory_inspect_csv(self, path, selection):
        with self.scratch() as scratch:
            target = Path(scratch) / "original-page.sqlite"
            builder = index.IndexBuilder(target)
            file = {"name": "response.csv", "sha256": original_workspace.file_digest(path, MAX_BYTES),
                "bytes": original_workspace.regular(path, MAX_BYTES).st_size}
            try:
                with Path(path).open("rb") as stream:
                    document = builder.document(file, selection, stream)
                summary = builder.finish()
                return {"records": summary["records"], "rows": document["header"]["logicalRecords"], "header": document["header"]}
            finally:
                builder.close()

    def _directory_capture_packet(self, op, request):
        """Prepare one verified complete packet without discarding original HTTP/error bytes."""
        files = {}
        manifest_files = {}
        documents = []
        def add(file, suggested_name=None):
            path = self._file_path(file)
            # Repeated wire/decoded bytes share one original member; no re-encoding.
            name = suggested_name or "files/" + file["sha256"] + ".bin"
            if name in files and manifest_files[name]["sha256"] != file["sha256"]:
                raise InputError("Conflicting original directory capture member name")
            files[name] = path
            manifest_files[name] = {"name": name, "sha256": file["sha256"], "bytes": file["bytes"], "role": file["role"]}
            return name
        for page in op["pages"]:
            # Documents preserve the actual original URL/selection even if two pages have equal bytes.
            name = "documents/" + str(page["ordinal"]).zfill(6) + ("-response.csv" if page["selection"]["format"] == "hsds-csv" else "-response.json")
            add(page["decodedFile"], name)
            documents.append({"name": name, "selection": page["selection"], "url": page["url"],
                "requestUrl": page["requestUrl"], "receiptId": page["receiptId"],
                "sha256": page["decodedFile"]["sha256"], "bytes": page["decodedFile"]["bytes"]})
        for item in op.get("recoveryFiles", []):
            add(item["file"], "protocol/" + item["name"])
        manifest = {"schema": CAPTURE_SCHEMA, "workspaceId": op["workspaceId"], "operationId": op["id"],
            "requestId": op["requestId"], "requestSha256": op["requestSha256"], "request": request,
            "complete": op["state"] == "complete" or not op["queue"] and not op.get("error"),
            "state": op["state"], "scope": request["scope"], "receivedRecords": op["receivedRecords"],
            "receivedRows": op["receivedRows"], "pageCount": op["pageCount"], "documents": documents,
            "attempts": op["attempts"], "files": [manifest_files[k] for k in sorted(manifest_files)]}
        files["manifest.json"] = jbytes(manifest)
        total = sum(v.stat().st_size if isinstance(v, Path) else len(v) for v in files.values())
        if total > MAX_BYTES:
            raise InputError("The complete original capture packet exceeds 256 MiB; full operation files remain retained in the editable workspace")
        return manifest, files

    def _directory_capture_source(self, op, request, completed):
        with self.scratch() as scratch:
            path = Path(scratch) / "directory-original-capture.zip"
            copy = dict(op)
            if completed:
                copy["state"], copy["error"] = "complete", None
            manifest, files = self._directory_capture_packet(copy, request)
            write_zip(path, files)
            return self.directory_import(path, {"label": request["label"], "format": "directory-capture",
                "origin": request["origin"], "scope": request["scope"], "referenceBase": request["connectionSnapshot"]["baseUrl"] if
                    request["connectionSnapshot"]["protocol"] == "fhir-hsd" else None,
                "sourceUrl": request["connectionSnapshot"]["baseUrl"],
                "publisher": request["connectionSnapshot"]["publisher"], "note": request["note"]})

    def directory_capture_file(self, ident):
        with self.mutex:
            op = self.directory_operation(ident)
            self._directory_retain_recovery(op)
            self._directory_operation_save(op)
            request = self.directory_record("requests", op["requestId"])
            with self.scratch() as scratch:
                path = Path(scratch) / "directory-capture.zip"
                _, files = self._directory_capture_packet(op, request)
                write_zip(path, files)
                file = self._retain_file(path, "directory-complete-capture")
        return self._file_path(file), {**file, "name": "directory-capture-" + ident + ".zip", "contentType": "application/zip"}
