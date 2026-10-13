"""Retained selected-source collections in the original Operator task queue."""
from __future__ import annotations

from functools import wraps
import hashlib
import html
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
from urllib.parse import quote
import zipfile

from model.common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, identifier,
    read_json, relative_file,
)
from eco_intelligence.common import IntelligenceError, public_metadata
from science_catalog_delivery import (
    CatalogDeliveryError, bundle, prepare, project_repository, repository_read_scope,
)

SCHEMA = "upstate.intelligence-source-collection/v1"
REQUEST_SCHEMA = "upstate.intelligence-source-selection/v1"
ROOT_MEMBERS = (
    "catalog.json", "inventory.json", "inventory.csv", "OPEN.html",
    "delivery.json", "RECEIVE.md", "collection.json", "START.html",
)


def _errors(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except IntelligenceError:
            raise
        except CatalogDeliveryError as error:
            raise IntelligenceError(str(error), 409) from error
        except OSError as error:
            status = 507 if error.errno == 28 else 409
            raise IntelligenceError(
                "The source collection could not be read or retained: " +
                (error.strerror or str(error)), status) from error
        except (ValueError, KeyError, TypeError) as error:
            raise IntelligenceError(
                "The retained source collection is inconsistent: " + str(error), 409) from error
    return wrapped


def _ref(value):
    if not isinstance(value, dict) or set(value) - {"kind", "id", "member"}:
        raise IntelligenceError("Choose a registered dataset or artifact.", 422)
    kind, key = value.get("kind"), value.get("id")
    if kind not in {"dataset", "artifact"} or not isinstance(key, str) or not key or len(key) > 256:
        raise IntelligenceError("Choose a registered dataset or artifact.", 422)
    result = {"kind": kind, "id": key}
    member = value.get("member")
    if kind == "artifact":
        if not isinstance(member, str) or not member or "\\" in member:
            raise IntelligenceError("Choose a registered artifact member.", 422)
        path = PurePosixPath(member)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise IntelligenceError("Choose a registered artifact member.", 422)
        result["member"] = path.as_posix()
    elif member not in (None, ""):
        raise IntelligenceError("Dataset references do not have an artifact member.", 422)
    return result


def _unit(metadata):
    for source in (metadata, metadata.get("scientific")):
        if isinstance(source, dict):
            for key in ("units", "unit"):
                if source.get(key) not in (None, ""):
                    return source[key]
    return None


def _choice(row, ref, *, parent=None):
    metadata = public_metadata(row.get("metadata") or {})
    filename = Path(str(row.get("path") or ref.get("member") or ref["id"])).name
    label = row.get("label") or row.get("title") or metadata.get("label") or metadata.get("title") or filename
    if parent:
        label = str(parent.get("label") or parent.get("title") or parent["id"]) + " / " + str(label)
    return {
        "ref": ref, "label": str(label), "filename": filename,
        "bytes": row.get("bytes"), "sha256": row.get("sha256"),
        "units": _unit(metadata) if _unit(metadata) is not None else row.get("units", row.get("unit")),
        "metadata": metadata,
    }


class _ArchiveWriter:
    """Give ZIP a non-seeking sink so its exact bytes are hashed as they are written."""
    def __init__(self, stream):
        self.stream, self.hash, self.bytes = stream, hashlib.sha256(), 0

    def write(self, body):
        count = self.stream.write(body)
        if count != len(body):
            raise OSError("The source archive was only partially written.")
        self.hash.update(body)
        self.bytes += count
        return count

    def tell(self):
        return self.bytes

    def seek(self, *args):
        raise io.UnsupportedOperation("Streaming ZIP")

    def flush(self):
        self.stream.flush()


class CollectionExports:
    def __init__(self, operator):
        self.operator = operator
        self._verified = {}

    def _root(self, workspace):
        return self.operator.ws(workspace).root / "intelligence" / "source-collections"

    def _directory(self, workspace, collection_id):
        return self._root(workspace) / identifier(collection_id)

    @_errors
    def sources(self, workspace, repository):
        """Project declared records and artifact descriptors; no file-body hashing."""
        self.operator.ws(workspace)
        catalog = project_repository(repository, [workspace])
        native = catalog["tenants"][workspace]
        sources, seen = [], set()

        def add(row, ref, parent=None):
            ref = _ref(ref)
            key = digest(ref)
            if key in seen:
                raise IntelligenceError("The original catalog contains a duplicate source reference.", 409)
            seen.add(key)
            sources.append(_choice(row, ref, parent=parent))

        for row in native["datasets"]:
            add(row, {"kind": "dataset", "id": row["id"]})
        for job in native["jobs"]:
            for artifact in job.get("artifacts", []):
                add(artifact, {"kind": "artifact", "id": job["id"],
                               "member": artifact["member"]}, parent=job)
        return {"schema": "upstate.intelligence-collection-sources/v1",
                "workspace_key": workspace, "sources": sources}

    @_errors
    def summaries(self, workspace, sid):
        project_id = self.operator.ws(workspace).project["id"]
        rows = []
        for path in sorted(self._root(workspace).glob("*/manifest.json")):
            record = read_json(path)
            if record.get("session_id") != sid:
                continue
            if record.get("schema") != SCHEMA or record.get("project_id") != project_id:
                raise IntelligenceError("The retained source collection belongs to another project.", 409)
            rows.append(self._summary(record))
        return rows

    @staticmethod
    def _summary(record):
        return {key: record[key] for key in (
            "id", "session_id", "title", "created_at", "catalog_sha256",
            "selected_records", "copied_files", "copied_bytes",
        )}

    @_errors
    def export(self, engine, task, sid):
        """Freeze the selected edition, resume its byte transfer and retain one archive."""
        workspace, value = task["workspace"], task["payload"]
        if set(value) - {"session_id", "title", "refs"}:
            raise IntelligenceError("Choose the collection title and original source references.", 422)
        selected = value.get("refs")
        if not isinstance(selected, list) or not selected:
            raise IntelligenceError("Select at least one original file for this collection.", 422)
        refs, seen = [], set()
        for value_ref in selected:
            ref = _ref(value_ref)
            key = digest(ref)
            if key in seen:
                continue
            seen.add(key)
            refs.append(ref)
        title = value.get("title") or engine.store.session(workspace, sid)["title"] + " — source collection"
        if not isinstance(title, str) or not title.strip() or len(title) > 320:
            raise IntelligenceError("Enter a source collection title of up to 320 characters.", 422)
        title = title.strip()
        ws = self.operator.ws(workspace)
        directory = self._directory(workspace, task["id"])
        request_sha = digest({"action": task["action"], "payload": task["payload"],
                              "operation_id": task["operation_id"]})
        manifest = directory / "manifest.json"
        if manifest.is_file():
            record = read_json(manifest)
            self._verify_manifest(workspace, sid, task["id"], record, request_sha)
            return record

        snapshot_path = directory / "selection.json"
        retained_selection = snapshot_path.is_file()
        if retained_selection:
            snapshot = read_json(snapshot_path)
            if (snapshot.get("schema") != REQUEST_SCHEMA
                    or snapshot.get("request_sha256") != request_sha
                    or snapshot.get("project_id") != ws.project["id"]
                    or snapshot.get("session_id") != sid):
                raise IntelligenceError("The original task retained a different source selection.", 409)
        else:
            # The original native adapter creates typed CAS views and companions lazily.
            # Resolve only the chosen originals, before capturing their live descriptors.
            with repository_read_scope(engine.repo, workspace):
                for ref in refs:
                    engine.repo.path(workspace, ref)
                catalog = project_repository(engine.repo, [workspace])
            chosen = [{"tenant_id": workspace, **ref} for ref in refs]
            planned = prepare(catalog, ws.root, chosen)
            snapshot = {
                "schema": REQUEST_SCHEMA, "id": task["id"],
                "operation_id": task["operation_id"], "request_sha256": request_sha,
                "project_id": ws.project["id"], "session_id": sid,
                "title": title, "created_at": task["created_at"],
                "catalog": catalog, "refs": chosen,
                "input_signature": planned["input_signature"],
            }
            atomic_json(snapshot_path, snapshot, immutable=True)

        destination = directory / "collection"
        # A completed retained transfer can be reopened after the original files move.
        # An unfinished transfer must continue from the same selected source edition.
        if (destination / "delivery.json").is_file():
            delivery = read_json(destination / "delivery.json")
            if (delivery.get("status") != "complete"
                    or delivery.get("input_signature") != snapshot["input_signature"]):
                raise IntelligenceError("The retained transfer belongs to another source edition.", 409)
        else:
            if retained_selection:
                with repository_read_scope(engine.repo, workspace):
                    for ref in refs:
                        engine.repo.path(workspace, ref)
            current = prepare(snapshot["catalog"], ws.root, snapshot["refs"])
            if current["input_signature"] != snapshot["input_signature"]:
                raise IntelligenceError(
                    "A selected original changed after this export started. "
                    "Keep this task and export its current edition as a new collection.", 409)
            delivery = bundle(snapshot["catalog"], ws.root, destination, snapshot["refs"])

        index = read_json(destination / "inventory.json")
        portable = read_json(destination / "catalog.json")
        if self._catalog_digest(portable) != delivery["catalog_sha256"]:
            raise IntelligenceError("The retained collection catalog changed during export.", 409)
        selection = {
            "schema": SCHEMA, "id": task["id"], "project_id": ws.project["id"],
            "session_id": sid, "title": snapshot["title"],
            "created_at": snapshot["created_at"], "operation_id": task["operation_id"],
            "catalog_sha256": delivery["catalog_sha256"],
            "selected_records": delivery["selected_records"],
            "copied_files": delivery["copied_files"], "copied_bytes": delivery["copied_bytes"],
            "refs": snapshot["refs"],
        }
        atomic_json(destination / "collection.json", selection, immutable=True)
        start_page = destination / "START.html"
        if not start_page.is_file():
            atomic_bytes(start_page, self._page(selection, index).encode("utf-8"), immutable=True)
        # Existing delivery reports and source bytes remain members of the archive.
        members = {name: describe_file(destination, destination / name) for name in ROOT_MEMBERS}
        for relative, expected in delivery["files"].items():
            members[relative] = {"path": relative, **expected}
        archive = self._archive(directory / "sources.zip", destination, members)
        record = {
            **selection, "request_sha256": request_sha,
            "archive": {**archive, "path": (directory / "sources.zip").relative_to(ws.root).as_posix(),
                        "filename": "source-collection-" + task["id"][:12] + ".zip"},
            "root_files": {name: {**expected,
                "path": (destination / name).relative_to(ws.root).as_posix()}
                for name, expected in members.items() if name in ROOT_MEMBERS},
        }
        atomic_json(manifest, record, immutable=True)
        self._verified[str((directory / "sources.zip").resolve())] = (
            self._signature((directory / "sources.zip").stat()), archive["bytes"], archive["sha256"])
        return record

    @staticmethod
    def _catalog_digest(value):
        # Match the portable catalog format, independently of host JSON settings.
        body = json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False)
        return hashlib.sha256(body.encode("utf-8")).hexdigest()

    @staticmethod
    def _signature(value):
        return (value.st_dev, value.st_ino, value.st_size,
                value.st_mtime_ns, value.st_ctime_ns)

    def _verified_file(self, root, expected):
        path = self._retained(root, expected)
        signature = self._signature(path.stat())
        cache_key = (signature, expected["bytes"], expected["sha256"])
        if self._verified.get(str(path)) != cache_key:
            value = hashlib.sha256()
            with path.open("rb") as stream:
                before = self._signature(os.fstat(stream.fileno()))
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    value.update(block)
                after = self._signature(os.fstat(stream.fileno()))
            if (before != after or after != self._signature(path.stat())
                    or after != signature or value.hexdigest() != expected["sha256"]):
                raise IntelligenceError("A retained collection member changed after export.", 409)
            self._verified[str(path)] = cache_key
        return path

    def _verify_manifest(self, workspace, sid, collection_id, record, request_sha=None):
        ws = self.operator.ws(workspace)
        directory = self._directory(workspace, collection_id)
        self._same(record, ws.project["id"], sid, request_sha)
        if record.get("id") != collection_id or set(record.get("root_files", {})) != set(ROOT_MEMBERS):
            raise IntelligenceError("Choose this investigation's complete source collection.", 404)
        members = {"sources.zip": record["archive"], **{
            "collection/" + name: expected for name, expected in record["root_files"].items()}}
        for relative, expected in members.items():
            if (not isinstance(expected.get("bytes"), int) or isinstance(expected["bytes"], bool)
                    or expected["bytes"] < 0 or not isinstance(expected.get("sha256"), str)
                    or re.fullmatch(r"[0-9a-f]{64}", expected["sha256"]) is None):
                raise IntelligenceError("The collection member has an invalid byte identity.", 409)
            path = self._retained(ws.root, expected)
            if path != (directory / relative).resolve():
                raise IntelligenceError("The collection member belongs to another operation.", 409)
        self._verified_file(ws.root, record["archive"])
        selection = read_json(self._verified_file(ws.root, record["root_files"]["collection.json"]))
        for key, value in selection.items():
            if record.get(key) != value:
                raise IntelligenceError("The collection manifest differs from its retained selection.", 409)
        delivery = read_json(self._verified_file(ws.root, record["root_files"]["delivery.json"]))
        catalog = read_json(self._verified_file(ws.root, record["root_files"]["catalog.json"]))
        if (delivery.get("status") != "complete"
                or delivery.get("catalog_sha256") != record["catalog_sha256"]
                or self._catalog_digest(catalog) != record["catalog_sha256"]):
            raise IntelligenceError("The retained collection catalog changed after export.", 409)

    @staticmethod
    def _same(record, project_id, sid, request_sha=None):
        if (record.get("schema") != SCHEMA or record.get("project_id") != project_id
                or record.get("session_id") != sid
                or (request_sha is not None and record.get("request_sha256") != request_sha)):
            raise IntelligenceError("The source collection belongs to another investigation.", 409)

    @staticmethod
    def _archive(path, source_root, members):
        """Copy selected members to ZIP in bounded buffers and hash the archive once."""
        pending = path.with_name(path.name + ".receiving")
        try:
            with pending.open("wb") as output:
                sink = _ArchiveWriter(output)
                with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                    for relative in sorted(members):
                        expected = members[relative]
                        source = relative_file(source_root, relative)
                        info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                        info.file_size = expected["bytes"]
                        info.external_attr = 0o100644 << 16
                        total, file_hash = 0, hashlib.sha256()
                        with source.open("rb") as reader:
                            before = os.fstat(reader.fileno())
                            with archive.open(info, "w", force_zip64=info.file_size >= zipfile.ZIP64_LIMIT) as member:
                                for block in iter(lambda: reader.read(1024 * 1024), b""):
                                    member.write(block)
                                    file_hash.update(block)
                                    total += len(block)
                            after = os.fstat(reader.fileno())
                        if (total != expected["bytes"] or file_hash.hexdigest() != expected["sha256"]
                                or (before.st_size, before.st_mtime_ns, before.st_ino)
                                != (after.st_size, after.st_mtime_ns, after.st_ino)):
                            raise IntelligenceError("A retained source changed while its archive was written.", 409)
                output.flush()
                os.fsync(output.fileno())
            os.replace(pending, path)
            return {"bytes": sink.bytes, "sha256": sink.hash.hexdigest()}
        finally:
            pending.unlink(missing_ok=True)

    @staticmethod
    def _page(selection, index):
        rows = []
        for item in index:
            ref = {"kind": item["kind"], "id": item["id"]}
            if item.get("member") is not None:
                ref["member"] = item["member"]
            unit = _unit(item.get("metadata") or {})
            rows.append("<tr><td><a download href='" +
                        html.escape(quote(item["path"], safe="/"), quote=True) + "'>" +
                        html.escape(item["filename"]) + "</a></td><td>" +
                        html.escape(str(unit) if unit is not None else "Not declared") +
                        "</td><td>" + format(item["bytes"], ",") + "</td><td class='identity'>" +
                        html.escape(item["sha256"]) + "</td></tr>")
        return """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scientific source collection</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:28px;color:#242424;background:#fff}
h1{font-size:24px;overflow-wrap:anywhere}a{color:#242424}nav{display:flex;gap:18px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:10px;border:1px solid #ccc;vertical-align:top}
th{background:#eee}.identity{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.table{overflow-x:auto}
@media(max-width:600px){body{padding:16px}th,td{padding:8px}table{min-width:640px}}
</style></head><body><h1>""" + html.escape(selection["title"]) + "</h1><p>" + \
            str(selection["selected_records"]) + " selected original records; " + \
            str(selection["copied_files"]) + " files including required companions.</p>" + \
            "<p>Keep this directory together. Open this page to browse the retained original files. " + \
            "Their scientific descriptions are in the full inventory.</p>" + \
            "<nav><a href='OPEN.html'>Full scientific inventory</a>" + \
            "<a download href='inventory.csv'>Inventory CSV</a>" + \
            "<a download href='catalog.json'>Portable catalog JSON</a>" + \
            "<a download href='collection.json'>Original collection selection</a></nav>" + \
            "<div class='table'><table><thead><tr><th>Original file</th><th>Declared units</th>" + \
            "<th>Bytes</th><th>SHA-256</th></tr></thead><tbody>" + "".join(rows) + \
            "</tbody></table></div></body></html>"

    @staticmethod
    def _retained(root, expected):
        path = relative_file(root, expected["path"])
        if path.stat().st_size != expected["bytes"]:
            raise IntelligenceError("A retained collection member has changed size.", 409)
        return path

    @_errors
    def view(self, workspace, sid, collection_id):
        ws = self.operator.ws(workspace)
        directory = self._directory(workspace, collection_id)
        record = read_json(directory / "manifest.json")
        self._verify_manifest(workspace, sid, collection_id, record)
        files = []
        downloads = [
            ("zip", record["archive"], "Download original files and collection"),
            ("csv", record["root_files"]["inventory.csv"], "Download inventory CSV"),
            ("catalog", record["root_files"]["catalog.json"], "Download portable catalog JSON"),
        ]
        for kind, expected, label in downloads:
            path = self._retained(ws.root, expected)
            files.append({**self.operator._ticket(workspace, path, expected, label), "format": kind})
        index_expected = record["root_files"]["inventory.json"]
        index_path = self._verified_file(ws.root, index_expected)
        index = read_json(index_path)
        if (len(index) != record["selected_records"]
                or sorted((item["tenant_id"], item["kind"], item["id"], item.get("member") or "") for item in index)
                != sorted((item["tenant_id"], item["kind"], item["id"], item.get("member") or "") for item in record["refs"])):
            raise IntelligenceError("The collection inventory differs from its original references.", 409)
        sources = []
        for item in index:
            ref = {"kind": item["kind"], "id": item["id"]}
            if item.get("member") is not None:
                ref["member"] = item["member"]
            expected = {
                "path": (directory / "collection" / item["path"]).relative_to(ws.root).as_posix(),
                "bytes": item["bytes"], "sha256": item["sha256"], "filename": item["filename"],
            }
            path = self._retained(ws.root, expected)
            sources.append({
                **_choice({**item, "path": item["filename"]}, ref),
                "download": self.operator._ticket(workspace, path, expected, item["filename"]),
            })
        return {**self._summary(record), "sources": sources, "files": files}
