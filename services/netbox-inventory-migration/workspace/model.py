"""Retained CSV authoring and native editions for the original inventory product."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.parse import urlencode, urlsplit

HERE = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(HERE.parent))
from inventory_migration import (
    CATALOG, FIELDS, LINKS, MAX_BYTES, MAX_OBJECTS, MAX_RESULT_BYTES, ORDER, REQUIRED_NEW,
    InventoryError, digest, keys, load_json, positive_id, validate_native_result,
)
from prepare_inventory import (
    MAPPING_SCHEMA, MAX_SOURCE_BYTES, MAX_TOTAL_SOURCE_BYTES, OMIT, compile_mapping, convert, csv_records, expression,
    json_bytes, load_workspace, now, prepare, read_bytes, read_json, sha_bytes,
    sync_directory, workspace_lock, write_atomic,
)
from operate_inventory import NativeApi, current_attempt, hash_file, inspect, restore

SCHEMA = "tjlabs.netbox.customer-desk/v1"
PROJECT_SCHEMA = "tjlabs.netbox.customer-project/v1"
REQUEST_SCHEMA = "tjlabs.netbox.customer-request/v1"
MAX_UPLOADS = 32
MAX_HANDOVER_UPLOAD = 512 * 1024 * 1024
IDENTITY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}\Z")
FILE_ID = re.compile(r"u-[0-9a-f]{24}\Z")
PROJECT_ID = re.compile(r"p-[0-9a-f]{24}\Z")
EDITION_ID = re.compile(r"e-[0-9a-f]{24}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")

CATALOGUES = {
    "tenants": ("/api/tenancy/tenants/", ()),
    "device_types": ("/api/dcim/device-types/", ("manufacturer_id",)),
    "roles": ("/api/dcim/device-roles/", ()),
    "platforms": ("/api/dcim/platforms/", ("manufacturer_id",)),
    "locations": ("/api/dcim/locations/", ("site_id",)),
    "vrfs": ("/api/ipam/vrfs/", ("tenant_id",)),
    "sites": ("/api/dcim/sites/", ("tenant_id",)),
    "racks": ("/api/dcim/racks/", ("tenant_id", "site_id", "location_id")),
    "devices": ("/api/dcim/devices/", ("tenant_id", "site_id", "rack_id")),
    "interfaces": ("/api/dcim/interfaces/", ("device_id",)),
    "ip_addresses": ("/api/ipam/ip-addresses/", ("tenant_id", "vrf_id", "device_id")),
}


class DeskError(InventoryError):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details


def need(value, code, message, status=400, details=None):
    if not value:
        raise DeskError(code, message, status, details)


def request_id(value):
    need(isinstance(value, str) and IDENTITY.fullmatch(value), "request_id",
         "Keep one stable 8–128 character request ID for this action.")
    return value


def identifier(value, expression, label):
    need(isinstance(value, str) and expression.fullmatch(value), "identity",
         "Select an original " + label + " identity.")
    return value


def revision(value):
    need(type(value) is int and value > 0, "revision", "Use the displayed positive project revision.")
    return value


def filename(value):
    need(isinstance(value, str) and 0 < len(value) <= 255 and
         not any(c in value for c in ("/", "\\", "\x00", "\r", "\n")) and value not in (".", ".."),
         "filename", "Use the original filename without directory components.")
    return value


def short_text(value, limit, label, empty=False):
    need(isinstance(value, str) and "\x00" not in value and len(value) <= limit
         and (empty or value.strip()), "text", "Use " + label + " within " + str(limit) + " characters.")
    return value


def safe_regular(path, maximum=MAX_RESULT_BYTES):
    path = Path(path)
    need(not path.is_symlink() and path.is_file(), "retained_file", "The retained original file is unavailable.", 409)
    return read_bytes(path, maximum)


def put_copy(source, target, maximum):
    source, target = Path(source), Path(target)
    size, sha = hash_file(source)
    need(size <= maximum, "upload_size", "The original upload exceeds its supported byte limit.", 413)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if target.exists():
        need(not target.is_symlink() and hash_file(target) == (size, sha), "retained_file",
             "This retained file contains a different original edition.", 409)
        return size, sha
    descriptor, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as original:
            os.fchmod(output.fileno(), 0o600)
            shutil.copyfileobj(original, output, length=1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        need(hash_file(temporary) == (size, sha), "upload_changed", "The uploaded bytes changed during retention.", 409)
        try:
            os.link(temporary, target)
        except FileExistsError:
            need(not target.is_symlink() and hash_file(target) == (size, sha), "retained_file",
                 "The selected retained filename has another edition.", 409)
        sync_directory(target.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return size, sha


class Desk:
    def __init__(self, directory, config):
        self.root = Path(directory).expanduser().resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.config_source = Path(config).expanduser().resolve()
        raw = safe_regular(self.config_source, MAX_BYTES)
        value = load_json(raw)
        keys(value, ("schema", "netbox_url", "script", "token_env", "authorization_scheme",
                     "branch", "timeout_seconds"), "Connection")
        need(value.get("schema") == "tjlabs.netbox.connection/v1", "connection", "Use the original NetBox connection.")
        parsed = urlsplit(str(value.get("netbox_url", "")))
        need(parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username
             and not parsed.password and not parsed.query and not parsed.fragment,
             "connection", "Use the exact original NetBox API URL.")
        # Credentials are resolved only by NativeApi for a requested provider operation.
        self.config = value
        self.config_path = self.root / "connection.json"
        identity = {"schema": SCHEMA, "connection_sha256": sha_bytes(raw),
                    "base_url": str(value["netbox_url"]).rstrip("/"),
                    "script": value.get("script", "inventory_migration.InventoryMigration"),
                    "branch": value.get("branch")}
        with workspace_lock(self.root):
            path = self.root / "desk.json"
            if path.exists():
                need(read_json(path) == identity, "connection_changed",
                     "Open this desk with its original connection configuration.", 409)
            write_atomic(self.config_path, raw, immutable=True)
            write_atomic(path, json_bytes(identity), immutable=True)
        for name in ("projects", "requests", "catalogue", "tmp"):
            (self.root / name).mkdir(mode=0o700, exist_ok=True)
        self.identity = identity

    def connection(self):
        name = self.config.get("token_env", "NETBOX_TOKEN")
        return {"base_url": self.identity["base_url"], "script": self.identity["script"],
                "branch": self.identity["branch"],
                "token_configured": isinstance(name, str) and bool(os.environ.get(name, ""))}

    def schema(self):
        return {"kinds": list(ORDER), "fields": FIELDS, "links": LINKS, "catalog": CATALOG,
                "required_new": REQUIRED_NEW, "catalogues": list(CATALOGUES),
                "source_limits": {"file_bytes": MAX_SOURCE_BYTES, "total_bytes": MAX_TOTAL_SOURCE_BYTES,
                                  "files": MAX_UPLOADS, "rows": MAX_OBJECTS}}

    def project_root(self, identity):
        return self.root / "projects" / identifier(identity, PROJECT_ID, "project")

    def project_meta(self, identity):
        root = self.project_root(identity)
        need((root / "project.json").is_file(), "project_missing", "The original project was not found.", 404)
        value = read_json(root / "project.json")
        need(value.get("schema") == PROJECT_SCHEMA and value.get("id") == identity,
             "project_changed", "The saved project identity changed.", 409)
        return value

    def version(self, identity, number):
        revision(number)
        value = read_json(self.project_root(identity) / "versions" / ("%08d.json" % number))
        need(value["id"] == identity and value["revision"] == number, "project_changed",
             "The retained draft revision changed.", 409)
        return value

    def upload_meta(self, project, identity):
        identifier(identity, FILE_ID, "CSV upload")
        value = read_json(self.project_root(project) / "uploads" / (identity + ".json"))
        need(value.get("id") == identity and value.get("file") == "uploads/" + identity + ".csv"
             and isinstance(value.get("name"), str) and isinstance(value.get("sha256"), str)
             and SHA.fullmatch(value["sha256"]) and type(value.get("bytes")) is int
             and 0 <= value["bytes"] <= MAX_SOURCE_BYTES
             and identity == "u-" + digest({"name": value["name"], "sha256": value["sha256"]})[:24],
             "upload_changed", "The retained upload identity changed.", 409)
        filename(value["name"])
        return value

    def upload_bytes(self, project, identity):
        item = self.upload_meta(project, identity)
        raw = safe_regular(self.project_root(project) / item["file"], MAX_SOURCE_BYTES)
        need(len(raw) == item["bytes"] and sha_bytes(raw) == item["sha256"], "upload_changed",
             "The original CSV bytes differ from the retained upload.", 409)
        return item, raw

    def uploads(self, project):
        meta = self.project_meta(project)
        return [self.upload_meta(project, identity) for identity in meta["upload_ids"]]

    def project(self, identity):
        value = self.project_meta(identity)
        editions = []
        base = self.project_root(identity) / "editions"
        if base.exists():
            for path in sorted(base.glob("e-*/edition.json")):
                editions.append(self.edition(identity, path.parent.name))
        return {key: value[key] for key in ("id", "label", "revision", "tenant_id", "source_notes",
                                           "mapping", "created_at", "updated_at")} | {
            "uploads": self.uploads(identity), "editions": sorted(editions, key=lambda row: (row["created_at"], row["id"]))}

    def state(self):
        projects = []
        for path in sorted((self.root / "projects").glob("p-*/project.json")):
            value = self.project(path.parent.name)
            projects.append({key: value[key] for key in ("id", "label", "revision", "updated_at")} | {
                "uploads_count": len(value["uploads"]), "editions_count": len(value["editions"])})
        return {"connection": self.connection(), "schema": self.schema(),
                "projects": sorted(projects, key=lambda row: (row["updated_at"], row["id"]), reverse=True)}

    def request_root(self, identity):
        return self.root / "requests" / request_id(identity)

    def request(self, identity):
        path = self.request_root(identity) / "request.json"
        need(path.is_file(), "request_missing", "The original request was not found.", 404)
        return read_json(path)

    def command(self, identity, kind, payload, function):
        root = self.request_root(identity)
        with workspace_lock(root):
            path = root / "request.json"
            expected = {"kind": kind, "payload": payload}
            if path.exists():
                intent = read_json(path)
                need(intent["sha256"] == digest(expected), "request_conflict",
                     "This request ID already belongs to another exact action.", 409)
            else:
                intent = {"schema": REQUEST_SCHEMA, "id": identity, "kind": kind, "payload": payload,
                          "sha256": digest(expected), "created_at": now()}
                write_atomic(path, json_bytes(intent), immutable=True)
            complete = root / "complete.json"
            if complete.exists():
                return read_json(complete)
            result = function(intent)
            write_atomic(complete, json_bytes(result), immutable=True)
            return result

    def publish_project(self, value, intent, expected=None):
        root = self.project_root(value["id"])
        number = value["revision"]
        target = root / "versions" / ("%08d.json" % number)
        if target.exists():
            saved = read_json(target)
            need(saved["request_id"] == intent["id"] and saved == value, "revision_conflict",
                 "The requested project revision was already used by another action.", 409)
        write_atomic(target, json_bytes(value), immutable=True)
        current_path = root / "project.json"
        current = read_json(current_path) if current_path.exists() else None
        if current and current["revision"] >= number:
            return value
        need((current["revision"] if current else None) == expected, "stale_revision",
             "The project changed after this action was prepared.", 409,
             {"current_revision": current["revision"] if current else None})
        write_atomic(current_path, json_bytes(value))
        return value

    def prior_change(self, project, intent, expected):
        revision(expected)
        root = self.project_root(project)
        target = root / "versions" / ("%08d.json" % (expected + 1))
        if target.exists():
            value = read_json(target)
            if value["request_id"] == intent["id"]:
                current = self.project_meta(project)
                if current["revision"] == expected:
                    self.publish_project(value, intent, expected)
                return value
        current = self.project_meta(project)
        need(current["revision"] == expected, "stale_revision", "Reload the current project revision before saving.",
             409, {"current_revision": current["revision"]})
        return None

    def create_project(self, body):
        keys(body, ("request_id", "label", "tenant_id"), "Project creation")
        identity = request_id(body.get("request_id"))
        label = short_text(body.get("label"), 160, "a project label")
        tenant = body.get("tenant_id")
        need(tenant is None or positive_id(tenant), "tenant", "Select an original tenant ID.")
        payload = {"label": label, "tenant_id": tenant}
        project = "p-" + digest({"request_id": identity})[:24]
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                value = {"schema": PROJECT_SCHEMA, "id": project, "label": label, "revision": 1,
                         "tenant_id": tenant, "source_notes": "", "upload_ids": [], "request_id": identity,
                         "created_at": intent["created_at"], "updated_at": intent["created_at"],
                         "mapping": {"schema": MAPPING_SCHEMA, "netbox_url": self.identity["base_url"],
                                     "tenant_id": tenant, "source_notes": "", "sources": []}}
                self.publish_project(value, intent)
                return {"project_id": project, "saved_revision": 1}
        return self.command(identity, "create_project", payload, apply)

    def upload(self, project, identity, expected, name, raw):
        request_id(identity); revision(expected); filename(name)
        need(isinstance(raw, bytes) and len(raw) <= MAX_SOURCE_BYTES, "upload_size",
             "A CSV upload must fit the original 32 MiB source limit.", 413)
        records = csv_records(raw, name)
        headers = next(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True))
        source_sha = sha_bytes(raw)
        upload_id = "u-" + digest({"name": name, "sha256": source_sha})[:24]
        payload = {"project_id": project, "expected_revision": expected,
                   "name": name, "sha256": source_sha, "bytes": len(raw)}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                meta = self.project_meta(project)
                if upload_id in meta["upload_ids"]:
                    self.upload_bytes(project, upload_id)
                    return {"project_id": project, "upload_id": upload_id, "saved_revision": meta["revision"]}
                prior = self.prior_change(project, intent, expected)
                if prior:
                    return {"project_id": project, "upload_id": upload_id, "saved_revision": prior["revision"]}
                existing = self.uploads(project)
                need(len(existing) < MAX_UPLOADS and sum(item["bytes"] for item in existing) + len(raw) <= MAX_TOTAL_SOURCE_BYTES,
                     "project_source_limit", "Keep at most 32 uploads and 64 MiB of source bytes in one project.", 413)
                samples = [{key: value if len(value) <= 240 else value[:240] + "…" for key, value in row.items()}
                           for row in records[:10]]
                item = {"id": upload_id, "name": name, "file": "uploads/" + upload_id + ".csv",
                        "sha256": source_sha, "bytes": len(raw), "headers": headers,
                        "row_count": len(records), "sample": samples, "captured_at": intent["created_at"]}
                root = self.project_root(project)
                write_atomic(root / item["file"], raw, immutable=True)
                metadata_path = root / "uploads" / (upload_id + ".json")
                if metadata_path.exists():
                    item = self.upload_meta(project, upload_id)
                    self.upload_bytes(project, upload_id)
                else:
                    write_atomic(metadata_path, json_bytes(item), immutable=True)
                value = dict(meta, revision=expected + 1, request_id=identity, updated_at=intent["created_at"],
                             upload_ids=[*meta["upload_ids"], upload_id])
                self.publish_project(value, intent, expected)
                return {"project_id": project, "upload_id": upload_id, "saved_revision": value["revision"]}
        return self.command(identity, "upload", payload, apply)

    def save_mapping(self, project, body):
        keys(body, ("request_id", "expected_revision", "label", "tenant_id", "source_notes", "mapping"), "Mapping save")
        identity = request_id(body.get("request_id")); expected = revision(body.get("expected_revision"))
        label = short_text(body.get("label"), 160, "a project label")
        tenant = body.get("tenant_id")
        need(tenant is None or positive_id(tenant), "tenant", "Select an original tenant ID.")
        notes = short_text(body.get("source_notes", ""), 16000, "source notes", True)
        mapping = body.get("mapping")
        keys(mapping, ("schema", "netbox_url", "tenant_id", "source_notes", "sources"), "Mapping")
        need(mapping.get("schema") == MAPPING_SCHEMA and isinstance(mapping.get("sources"), list)
             and len(mapping["sources"]) <= 32, "mapping", "Use up to 32 original CSV mappings.")
        need(mapping.get("netbox_url") == self.identity["base_url"]
             and mapping.get("tenant_id") == tenant and mapping.get("source_notes", "") == notes,
             "mapping_binding", "The mapping must use this connection, selected tenant and source notes.")
        payload = {key: body[key] for key in body if key != "request_id"} | {"project_id": project}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                prior = self.prior_change(project, intent, expected)
                if prior:
                    return {"project_id": project, "saved_revision": prior["revision"]}
                meta = self.project_meta(project)
                files = {item["file"] for item in self.uploads(project)}
                for definition in mapping["sources"]:
                    keys(definition, ("kind", "file", "key", "match_id", "fields", "links", "catalog", "primary"),
                         "Original CSV source mapping")
                    need(definition.get("kind") in ORDER and isinstance(definition.get("file"), str)
                         and definition["file"] in files,
                         "mapping_source", "Choose an uploaded CSV and its original inventory kind.")
                value = dict(meta, revision=expected + 1, request_id=identity, updated_at=intent["created_at"],
                             label=label, tenant_id=tenant, source_notes=notes, mapping=mapping)
                self.publish_project(value, intent, expected)
                return {"project_id": project, "saved_revision": value["revision"]}
        return self.command(identity, "save_mapping", payload, apply)

    def native_mapping(self, project, value):
        mapping = json.loads(json.dumps(value["mapping"]))
        known = {item["file"]: item for item in self.uploads(project)}
        for definition in mapping["sources"]:
            name = definition.get("file")
            need(isinstance(name, str) and name in known, "mapping_source", "The mapping selects a different original upload.", 409)
            item, _ = self.upload_bytes(project, known[name]["id"])
            definition["file"] = str(self.project_root(project) / item["file"])
        return mapping

    def preview(self, project, body):
        keys(body, ("request_id", "expected_revision"), "Mapping preview")
        identity = request_id(body.get("request_id")); expected = revision(body.get("expected_revision"))
        payload = {"project_id": project, "expected_revision": expected}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                meta = self.project_meta(project)
                need(meta["revision"] == expected, "stale_revision", "Preview the current project revision.", 409,
                     {"current_revision": meta["revision"]})
                mapping = self.native_mapping(project, meta)
                operation = "nbx-desk-" + digest({"project": project, "revision": expected})[:32]
                packet, captures, errors = compile_mapping(mapping, self.project_root(project) / "mapping.json", operation)
                public = {"revision": expected, "ready": not errors,
                          "counts": {kind: sum(row["kind"] == kind for row in packet["objects"]) for kind in ORDER},
                          "errors": errors, "rows": packet["objects"][:100], "row_count": len(packet["objects"])}
                retained = {"schema": "tjlabs.netbox.customer-preview/v1", "project_id": project,
                            "revision": expected, "operation_id": operation, "mapping": mapping,
                            "mapping_sha256": sha_bytes(json_bytes(mapping)),
                            "sources": [item for item, _ in captures], "packet_sha256": digest(packet), "preview": public}
                sha = digest(retained)
                write_atomic(self.project_root(project) / "previews" / (sha + ".json"),
                             json_bytes(retained), immutable=True)
                return {"project_id": project, "preview_sha256": sha}
        return self.command(identity, "preview", payload, apply)

    def preview_value(self, project, sha):
        need(isinstance(sha, str) and SHA.fullmatch(sha), "preview", "Select the exact retained preview SHA-256.")
        value = read_json(self.project_root(project) / "previews" / (sha + ".json"))
        need(digest(value) == sha and value["project_id"] == project, "preview_changed",
             "The retained preview identity changed.", 409)
        return dict(value["preview"], sha256=sha)

    def prepare_edition(self, project, body):
        keys(body, ("request_id", "expected_revision", "preview_sha256"), "Native preparation")
        identity = request_id(body.get("request_id")); expected = revision(body.get("expected_revision"))
        sha = body.get("preview_sha256")
        self.preview_value(project, sha)
        edition_id = "e-" + digest({"project": project, "revision": expected, "preview": sha})[:24]
        payload = {"project_id": project, "expected_revision": expected, "preview_sha256": sha}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                root = self.project_root(project) / "editions" / edition_id
                meta = self.project_meta(project)
                prior_path = root / "edition.json"
                prior = read_json(prior_path) if prior_path.exists() else None
                if prior:
                    need(prior["project_revision"] == expected and prior["preview_sha256"] == sha,
                         "edition_conflict", "The original preparation belongs to a different draft.", 409)
                else:
                    need(meta["revision"] == expected, "stale_revision", "Prepare the displayed project revision.", 409)
                saved = read_json(self.project_root(project) / "previews" / (sha + ".json"))
                need(saved["revision"] == expected and saved["preview"]["ready"], "mapping_correction",
                     "Resolve the original preview corrections before native preparation.", 409)
                original = self.version(project, expected)
                mapping = self.native_mapping(project, original)
                need(sha_bytes(json_bytes(mapping)) == saved["mapping_sha256"], "mapping_changed",
                     "The exact selected mapping changed after preview.", 409)
                packet, captures, errors = compile_mapping(mapping, root / "authoring-mapping.json",
                                                           saved["operation_id"])
                need(not errors and digest(packet) == saved["packet_sha256"]
                     and [item for item, _ in captures] == saved["sources"], "preview_source_changed",
                     "The exact retained source bytes no longer match the selected preview.", 409)
                definition = {"schema": "tjlabs.netbox.customer-edition/v1", "id": edition_id, "project_id": project,
                              "project_revision": expected, "operation_id": saved["operation_id"],
                              "preview_sha256": sha, "payload_sha256": saved["packet_sha256"],
                              "created_at": saved.get("created_at", intent["created_at"]),
                              "kind": "prepared"}
                if prior:
                    definition = prior
                write_atomic(root / "edition.json", json_bytes(definition), immutable=True)
                path = root / "authoring-mapping.json"
                write_atomic(path, json_bytes(mapping), immutable=True)
                result = prepare(path, root / "native", saved["operation_id"])
                need(result["state"] == "PREPARED" and result.get("payload_sha256") == saved["packet_sha256"],
                     "prepared_source_changed", "The prepared native request differs from the reviewed source preview.", 409)
                self.edition(project, edition_id)
                return {"project_id": project, "edition_id": edition_id, "native_preparation": result}
        return self.command(identity, "prepare", payload, apply)

    def edition_root(self, project, identity):
        identifier(identity, EDITION_ID, "prepared edition")
        root = self.project_root(project) / "editions" / identity
        need((root / "edition.json").is_file(), "edition_missing", "The original edition was not found.", 404)
        return root

    def edition(self, project, identity):
        root = self.edition_root(project, identity)
        meta = read_json(root / "edition.json")
        need(meta["id"] == identity and meta["project_id"] == project, "edition_changed",
             "The prepared edition identity changed.", 409)
        native = root / "native"
        if (native / "workspace.json").exists():
            status = inspect(native)
            need(status["operation_id"] == meta["operation_id"]
                 and status["payload_sha256"] == meta.get("payload_sha256"),
                 "edition_source_changed", "The native request no longer matches its original selected edition.", 409)
        else:
            correction = read_json(native / "corrections.json") if (native / "corrections.json").exists() else None
            status = {"state": "CORRECTION_REQUIRED" if correction else "PREPARING",
                      "operation_id": meta["operation_id"]}
        signatures = {}
        for name in ("workspace.json", "review.json", "applied.json", "current.json", ".restore-operation.json"):
            path = native / name
            if path.is_file():
                signatures[name] = hash_file(path)[1]
        if (native / "current.json").exists():
            directory, request = current_attempt(native)
            if directory and (directory / "state.json").exists():
                signatures["attempt_state"] = hash_file(directory / "state.json")[1]
        active = None
        active_path = root / "active-action.json"
        if active_path.exists():
            candidate = request_id(read_json(active_path).get("id"))
            if not (self.request_root(candidate) / "complete.json").exists():
                active = candidate
        return {key: meta[key] for key in ("id", "project_revision", "operation_id", "created_at", "kind")} | {
            key: status[key] for key in ("state", "review_digest", "counts", "journal", "receipt_sha256",
                                       "execution_reference", "phase") if key in status} | {
            "status_sha256": digest({"status": status, "sources": signatures}), "active_action_id": active}

    def edition_detail(self, project, identity):
        root = self.edition_root(project, identity) / "native"
        value = self.edition(project, identity)
        chosen = root / ("applied.json" if value["state"] == "APPLIED" else "review.json")
        result = read_json(chosen) if chosen.is_file() else None
        corrections = read_json(root / "corrections.json") if (root / "corrections.json").is_file() else None
        return {"edition": value, "result": result, "corrections": corrections}

    def file_rows(self, project, identity, offset=0, limit=50):
        need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 200,
             "page", "Use a nonnegative offset and page size between 1 and 200.")
        item, raw = self.upload_bytes(project, identity)
        rows = csv_records(raw, item["name"])
        return {"upload": item, "rows": rows[offset:offset + limit], "total": len(rows),
                "offset": offset, "limit": limit}

    def catalogue(self, kind, query):
        need(kind in CATALOGUES, "catalogue", "Select an original native catalogue.")
        path, permitted = CATALOGUES[kind]
        keys(query, ("q", *permitted), "Catalogue filters")
        params = {"limit": 100}
        if query.get("q"):
            params["q"] = short_text(query["q"], 200, "a native catalogue search")
        for key in permitted:
            if key in query and query[key] not in (None, ""):
                value = query[key]
                if isinstance(value, str) and value.isdecimal():
                    value = int(value)
                need(positive_id(value), "catalogue_filter", "Use an actual positive NetBox ID for " + key + ".")
                params[key] = value
        api = NativeApi(read_json(self.config_path))
        rows, pages = api.pages(path + "?" + urlencode(params))
        items = []
        for row in rows:
            need(isinstance(row, dict) and positive_id(row.get("id")), "catalogue_response",
                 "The native catalogue returned an invalid object identity.", 502)
            label = row.get("display") or row.get("name") or row.get("model") or row.get("address") or str(row["id"])
            items.append({"id": row["id"], "label": str(label), "record": row})
        result = {"kind": kind, "query": params, "items": items, "pages": pages, "observed_at": now()}
        sha = digest(result)
        write_atomic(self.root / "catalogue" / (sha + ".json"), json_bytes(result), immutable=True)
        return dict(result, sha256=sha)

    def receive(self, project, identity, expected, name, source):
        request_id(identity); revision(expected); filename(name)
        size, sha = hash_file(source)
        need(size <= MAX_HANDOVER_UPLOAD, "upload_size", "The original handover exceeds 512 MiB.", 413)
        edition_id = "e-" + digest({"project": project, "archive_sha256": sha})[:24]
        payload = {"project_id": project, "expected_revision": expected, "name": name,
                   "archive_sha256": sha, "archive_bytes": size}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                root = self.project_root(project) / "editions" / edition_id
                original = self.project_meta(project)
                prior_path = root / "edition.json"
                archive = root / "received-handover.zip"
                if prior_path.exists():
                    prior = read_json(prior_path)
                    need(prior.get("archive_sha256") == sha and hash_file(archive) == (size, sha),
                         "restore_identity", "The retained received archive has another identity.", 409)
                    # A later native review/recovery belongs to this same live
                    # edition. Do not rewrite it from the incoming archive.
                    current = inspect(root / "native")
                    need(current["operation_id"] == prior["operation_id"]
                         and current["payload_sha256"] == prior["payload_sha256"],
                         "restore_identity", "The received native operation changed.", 409)
                    return {"project_id": project, "edition_id": edition_id,
                            "native_restore": dict(current, archive_sha256=sha, reused=True)}
                need(original["revision"] == expected, "stale_revision", "Receive into the current project revision.", 409)
                put_copy(source, archive, MAX_HANDOVER_UPLOAD)
                result = restore(archive, root / "native")
                _, manifest, _, _ = load_workspace(root / "native")
                need(manifest["netbox_url"] == self.identity["base_url"], "restore_connection",
                     "The received inventory belongs to another NetBox connection.", 409)
                binding = root / "native" / "binding.json"
                if binding.exists():
                    saved_binding = read_json(binding)
                    need(saved_binding.get("script") == self.identity["script"]
                         and saved_binding.get("branch") == self.identity["branch"],
                         "restore_connection", "The received inventory selects another native script or branch.", 409)
                meta = {"schema": "tjlabs.netbox.customer-edition/v1", "id": edition_id, "project_id": project,
                        "project_revision": expected, "operation_id": manifest["operation_id"],
                        "created_at": intent["created_at"], "kind": "received", "archive_sha256": sha,
                        "payload_sha256": manifest["payload_sha256"]}
                if prior_path.exists():
                    meta = read_json(prior_path)
                    need(meta.get("archive_sha256") == sha and meta["operation_id"] == manifest["operation_id"],
                         "restore_identity", "The original received edition has a different archive.", 409)
                write_atomic(prior_path, json_bytes(meta), immutable=True)
                return {"project_id": project, "edition_id": edition_id, "native_restore": result}
        return self.command(identity, "restore", payload, apply)


    def draft_from_edition(self, project, edition, body):
        """Create a new editable revision from exact retained native inputs."""
        keys(body, ("request_id", "expected_revision"), "Corrected draft")
        identity = request_id(body.get("request_id")); expected = revision(body.get("expected_revision"))
        payload = {"project_id": project, "edition_id": edition, "expected_revision": expected}
        def apply(intent):
            with workspace_lock(self.project_root(project)):
                prior = self.prior_change(project, intent, expected)
                if prior:
                    return {"project_id": project, "saved_revision": prior["revision"],
                            "source_draft": prior["source_draft"]}
                selected = self.edition(project, edition)
                native = self.edition_root(project, edition) / "native"
                _, manifest, packet, _ = load_workspace(native)
                original = self.project_meta(project)
                mapping_raw = safe_regular(native / "mapping.json", MAX_BYTES)
                need(sha_bytes(mapping_raw) == manifest["mapping_sha256"], "mapping_changed",
                     "The retained original authoring mapping changed.", 409)
                mapping = load_json(mapping_raw)
                captures = read_json(native / "sources.json")
                existing = self.uploads(project)
                items = {item["id"]: item for item in existing}
                selected_sources, source_rows = [], {}
                for capture in captures:
                    name = filename(capture["name"])
                    raw = safe_regular(native / capture["retained"], MAX_SOURCE_BYTES)
                    need(len(raw) == capture["bytes"] and sha_bytes(raw) == capture["sha256"],
                         "edition_source_changed", "A retained native source differs from its captured edition.", 409)
                    upload_id = "u-" + digest({"name": name, "sha256": capture["sha256"]})[:24]
                    records = csv_records(raw, name)
                    source_rows[capture["sha256"]] = records
                    if upload_id not in items:
                        need(len(items) < MAX_UPLOADS
                             and sum(item["bytes"] for item in items.values()) + len(raw) <= MAX_TOTAL_SOURCE_BYTES,
                             "project_source_limit",
                             "This draft would exceed 32 uploads or 64 MiB. Receive the edition into a new project.", 413)
                        headers = next(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True))
                        samples = [{key: value if len(value) <= 240 else value[:240] + "…"
                                    for key, value in row.items()} for row in records[:10]]
                        item = {"id": upload_id, "name": name, "file": "uploads/" + upload_id + ".csv",
                                "sha256": capture["sha256"], "bytes": len(raw), "headers": headers,
                                "row_count": len(records), "sample": samples, "captured_at": intent["created_at"]}
                        path = self.project_root(project)
                        write_atomic(path / item["file"], raw, immutable=True)
                        metadata = path / "uploads" / (upload_id + ".json")
                        if metadata.exists():
                            item = self.upload_meta(project, upload_id)
                            self.upload_bytes(project, upload_id)
                        else:
                            write_atomic(metadata, json_bytes(item), immutable=True)
                        items[upload_id] = item
                    else:
                        self.upload_bytes(project, upload_id)
                    selected_sources.append((capture, items[upload_id]))

                # Only committed native receipts contain durable new-object IDs.
                # A dry-run's rolled-back CREATE IDs must never become a match.
                resolved = {}
                if (native / "applied.json").exists():
                    committed = validate_native_result(read_json(native / "applied.json"),
                                                       manifest["operation_id"], manifest["payload_sha256"])
                    for row in committed.get("resolved", []):
                        need(isinstance(row, dict) and row.get("kind") in ORDER
                             and isinstance(row.get("key"), str) and positive_id(row.get("id")),
                             "resolved_identity", "The original applied result has an invalid resolved object.", 409)
                        label = (row["kind"], row["key"])
                        need(label not in resolved or resolved[label] == row["id"], "resolved_identity",
                             "The original receipt has conflicting resolved native IDs.", 409)
                        resolved[label] = row["id"]

                warnings, matched_ids = [], 0
                for number, definition in enumerate(mapping.get("sources", []), 1):
                    source_path = definition.get("file")
                    candidates = []
                    if isinstance(source_path, str):
                        path = Path(source_path)
                        for capture, item in selected_sources:
                            original_path = Path(capture["original_path"])
                            exact = str(original_path) == str(path)
                            relative = (not path.is_absolute() and ".." not in path.parts
                                        and bool(path.parts) and original_path.parts[-len(path.parts):] == path.parts)
                            if exact or relative:
                                candidates.append((capture, item))
                    if len(candidates) != 1:
                        definition["file"] = ""
                        warnings.append({"source_mapping": number, "code": "choose_retained_source",
                                         "message": "Select the exact retained CSV for this mapping; its original path is ambiguous."})
                        continue
                    capture, item = candidates[0]
                    definition["file"] = item["file"]
                    if not resolved:
                        continue
                    rule = definition.get("key")
                    try:
                        keys(rule, ("column", "value", "trim", "lower", "blank", "values"), "Original source key")
                        base_rule = {key: value for key, value in rule.items() if key != "values"}
                        values, associated = {}, 0
                        for record in source_rows[capture["sha256"]]:
                            key = convert(expression(rule, record), "text")
                            lookup = expression(base_rule, record)
                            if key is OMIT or key is None or lookup is OMIT or lookup is None:
                                raise InventoryError("A retained key cannot bind an exact native object.")
                            native_id = resolved.get((definition["kind"], key))
                            if native_id is None:
                                raise InventoryError("The committed receipt has no resolved ID for " + str(key) + ".")
                            token = str(lookup)
                            if token in values and values[token] != native_id:
                                raise InventoryError("Different resolved objects share the same source-key input.")
                            values[token] = native_id
                            associated += 1
                        definition["match_id"] = dict(base_rule, values=values)
                        matched_ids += associated
                    except (InventoryError, TypeError, KeyError) as exc:
                        warnings.append({"source_mapping": number, "code": "choose_native_matches", "message": str(exc)})
                mapping["netbox_url"] = self.identity["base_url"]
                mapping["tenant_id"] = manifest["tenant_id"]
                notes = mapping.get("source_notes", "")
                source_draft = {"edition_id": edition, "operation_id": selected["operation_id"],
                                "warnings": warnings, "matched_ids": matched_ids,
                                "native_receipt_sha256": selected.get("receipt_sha256")}
                value = dict(original, revision=expected + 1, request_id=identity, updated_at=intent["created_at"],
                             tenant_id=manifest["tenant_id"], source_notes=notes, mapping=mapping,
                             upload_ids=list(items), source_draft=source_draft)
                self.publish_project(value, intent, expected)
                return {"project_id": project, "saved_revision": value["revision"], "source_draft": source_draft}
        return self.command(identity, "draft_from_edition", payload, apply)

    def download(self, project, edition, name):
        root = self.edition_root(project, edition) / "native"
        choices = {"handover.zip": ("exports/inventory-handover.zip", "application/zip", "inventory-handover.zip"),
                   "report.html": ("exports/inventory-review.html", "text/html; charset=utf-8", "inventory-review.html"),
                   "result.json": ("applied.json" if (root / "applied.json").is_file() else "review.json",
                                   "application/json", "native-inventory-result.json"),
                   "resolved.csv": ("exports/resolved-objects.csv", "text/csv; charset=utf-8", "resolved-objects.csv"),
                   "request.json": ("request.json", "application/json", "request.json"),
                   "mapping.json": ("mapping.json", "application/json", "mapping.json")}
        need(name in choices, "download", "Select an original inventory output.", 404)
        relative, mime, filename = choices[name]
        path = root / relative
        need(path.is_file() and not path.is_symlink(), "download_missing",
             "The original output is not retained yet. Run its report or handover action.", 404)
        return path, mime, filename

    def hydrate(self, result):
        value = {}
        if result.get("project_id"):
            value["project"] = self.project(result["project_id"])
        if result.get("upload_id"):
            value["upload"] = self.upload_meta(result["project_id"], result["upload_id"])
        if result.get("preview_sha256"):
            value["preview"] = self.preview_value(result["project_id"], result["preview_sha256"])
        if result.get("edition_id"):
            value["edition"] = self.edition(result["project_id"], result["edition_id"])
        return value | {key: result[key] for key in ("saved_revision", "native_preparation", "native_restore", "source_draft") if key in result}
