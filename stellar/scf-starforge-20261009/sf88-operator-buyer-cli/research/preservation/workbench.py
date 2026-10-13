#!/usr/bin/env python3
"""Local browser workbench for the retained research-preservation application."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import http.server
import importlib.util
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import signal
import sys
import shutil
import stat
import tempfile
import threading
from urllib.parse import parse_qs, quote, urlsplit
import uuid
import zipfile

import preservation as p
import roda
import roda_client
import collection_accession as collection
import transfer_inspection as transfers

SCHEMA = "stellar-forge.preservation-workbench.v1"
SNAPSHOT_SCHEMA = SCHEMA + ".snapshot"
BODY_LIMIT = 16 * 1024 * 1024
MAX_SNAPSHOT = 8 * 1024 * 1024 * 1024
MAX_SNAPSHOT_MEMBER = 2 * 1024 * 1024 * 1024
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}")
HASH = re.compile(r"[0-9a-f]{64}")
STATIC = {"workbench.html", "workbench.js", "collection_accession.js", "transfer_inspection.js"}
APPLICATION = (
    "research/preservation/preservation.py",
    "research/preservation/roda.py",
    "research/preservation/roda_client.py",
    "research/preservation/workbench.py",
    "research/preservation/workbench.html",
    "research/preservation/workbench.js",
    "research/preservation/WORKBENCH.md",
    "research/preservation/README.md",
    "research/preservation/RODA.md",
    "research/preservation/RODA_REST.md",
    "research/preservation/cli.mjs",
    "research/oai/oai_feed.py",
)
PRESERVICA_APPLICATION = (
    "research/preservation/preservica.py",
    "research/preservation/preservica_client.py",
    "research/preservation/PRESERVICA.md",
    "research/preservation/PRESERVICA_PROVIDER_CONTRACT.md",
)
LIBNOVA_APPLICATION = (
    "research/preservation/libnova.py",
    "research/preservation/libnova_client.py",
    "research/preservation/LIBNOVA.md",
    "research/preservation/LIBNOVA_PROVIDER_CONTRACT.md",
    "research/preservation/libnova-requirements.txt",
)
ARCHIVEMATICA_APPLICATION = (
    "research/preservation/archivematica.py",
    "research/preservation/archivematica_client.py",
    "research/preservation/ARCHIVEMATICA.md",
    "research/preservation/ARCHIVEMATICA_PROVIDER_CONTRACT.md",
    "research/preservation/archivematica-requirements.txt",
)

COLLECTION_APPLICATION = (
    "research/preservation/collection_accession.py",
    "research/preservation/collection_accession.js",
    "research/preservation/COLLECTION_ACCESSION.md",
    "research/preservation/receiving/collection_accession_receive.py",
    "research/preservation/receiving/collection_accession_browser.mjs",
)

TRANSFER_APPLICATION = (
    "research/preservation/transfer_inspection.py",
    "research/preservation/transfer_inspection.js",
    "research/preservation/TRANSFER_INSPECTION.md",
    "research/preservation/receiving/transfer_inspection_receive.py",
    "research/preservation/receiving/transfer_inspection_browser.mjs",
)


class Problem(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.details = code, details

    def as_dict(self):
        return {"error": self.code, "message": str(self), "details": self.details}


def failure(error):
    if isinstance(error, Problem):
        return error.as_dict()
    if isinstance(error, roda_client.RodaError):
        return {"error": error.code, "message": str(error), "details": error.details}
    code = getattr(error, "code", type(error).__name__)
    return {"error": code, "message": str(error),
            "details": getattr(error, "details", {})}


def read_json(path, limit=BODY_LIMIT):
    path = Path(path)
    return p.parse_json(p.read_regular(path.parent, path.name, limit))


def write_json(path, value, *, replace=False):
    (p.replace_bytes if replace else p.write_new)(Path(path), p.canonical(value))


def identifier(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Problem("OPERATION_ID", "Use 1–96 letters, digits, underscores or hyphens for the operation ID.")
    return value


def regular(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise Problem("REGULAR_FILE", "Expected an original regular file.", path=str(path))
    return info


def file_digest(path, limit=MAX_SNAPSHOT_MEMBER):
    original = regular(path)
    if original.st_size > limit:
        raise Problem("FILE_SIZE", "The file exceeds this receiving profile's member size.", path=str(path))
    sha = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        if (before.st_dev, before.st_ino) != (original.st_dev, original.st_ino):
            raise Problem("FILE_CHANGED", "The source file changed while opening.", path=str(path))
        length = 0
        for body in iter(lambda: source.read(1024 * 1024), b""):
            length += len(body)
            if length > limit:
                raise Problem("FILE_SIZE", "The source grew beyond the receiving limit.", path=str(path))
            sha.update(body)
        after = os.fstat(source.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Problem("FILE_CHANGED", "The source changed while reading.", path=str(path))
    return {"bytes": length, "sha256": sha.hexdigest()}


def directory(path):
    path = Path(path)
    if path.is_symlink():
        raise Problem("DIRECTORY", "Workspace directories must not be symlinks.", path=str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir():
        raise Problem("DIRECTORY", "Expected a workspace directory.", path=str(path))
    return path


def tree_files(root):
    root = Path(root)
    result = {}
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            folder = Path(parent) / name
            if folder.is_symlink():
                raise Problem("SOURCE_SYMLINK", "A receiving tree contains a symlink.", path=str(folder))
        for name in files:
            path = Path(parent) / name
            rel = p.safe_name(path.relative_to(root).as_posix())
            regular(path)
            result[rel] = path
    return dict(sorted(result.items()))


def copy_file(source, destination, expected=None):
    expected = expected or file_digest(source)
    destination = Path(destination)
    directory(destination.parent)
    if destination.exists():
        if file_digest(destination) != expected:
            raise Problem("EXISTING_FILE", "An existing retained member has different bytes.", path=str(destination))
        return expected
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    temporary = None
    try:
        with os.fdopen(fd, "rb") as incoming:
            if not stat.S_ISREG(os.fstat(incoming.fileno()).st_mode):
                raise Problem("REGULAR_FILE", "Source is not a regular file.", path=str(source))
            out_fd, name = tempfile.mkstemp(prefix=".member-", dir=destination.parent)
            temporary = Path(name)
            sha, size = hashlib.sha256(), 0
            with os.fdopen(out_fd, "wb") as out:
                for body in iter(lambda: incoming.read(1024 * 1024), b""):
                    size += len(body)
                    if size > expected["bytes"]:
                        raise Problem("FILE_CHANGED", "The copied source grew.", path=str(source))
                    sha.update(body)
                    out.write(body)
                out.flush()
                os.fsync(out.fileno())
        if {"bytes": size, "sha256": sha.hexdigest()} != expected:
            raise Problem("FILE_CHANGED", "Copied source differs from its retained identity.", path=str(source))
        os.link(temporary, destination, follow_symlinks=False)
        p.fsync_dir(destination.parent)
        return expected
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def source_selection(status):
    return {"sourceManifestSha256": status["project"]["binding"]["manifestSha256"],
            "revision": status["revision"], "reviewSha256": status["reviewSha256"]}


def selected_review(value):
    if (not isinstance(value, dict) or set(value) !=
            {"sourceManifestSha256", "revision", "reviewSha256"}):
        raise Problem("SOURCE_SELECTION", "Select the original source and saved review revision.")
    if (type(value["revision"]) is not int or value["revision"] < 0
            or not isinstance(value["reviewSha256"], str) or not HASH.fullmatch(value["reviewSha256"])
            or not isinstance(value["sourceManifestSha256"], str)
            or not HASH.fullmatch(value["sourceManifestSha256"])):
        raise Problem("SOURCE_SELECTION", "The saved source/review identity is invalid.")
    return dict(value)


def freeze_source(workspace, destination, selection):
    """Receive an exact saved review into a separate source workspace."""
    selection = selected_review(selection)
    destination = Path(destination)
    directory(destination.parent)
    stage = None
    with p.project_lock(workspace):
        project, prepared = p.project_files(workspace)
        if project["binding"]["manifestSha256"] != selection["sourceManifestSha256"]:
            raise Problem("SOURCE_CHANGED", "The selected original edition differs from this workspace.")
        current, _ = p.current_review(workspace, prepared)
        published = _review_history(workspace, {
            "sourceManifestSha256": project["binding"]["manifestSha256"],
            "revision": current["revision"], "reviewSha256": current["reviewSha256"]})
        if not any(item["selection"] == selection for item in published):
            raise Problem("UNPUBLISHED_REVIEW", "Select a review in the original published history.")
        if destination.exists():
            status = p.show(destination)
            if source_selection(status) != selection:
                raise Problem("FROZEN_SOURCE_CHANGED", "The prepared source belongs to another saved review.")
            return status
        rel = "reviews/%08d-%s.json" % (selection["revision"], selection["reviewSha256"])
        saved = read_json(Path(workspace) / rel)
        normalized = p.normalize_review(saved.get("review"), prepared)
        if (saved.get("schema") != p.SCHEMA + ".revision"
                or saved.get("revision") != selection["revision"]
                or saved.get("reviewSha256") != selection["reviewSha256"]
                or p.digest(p.canonical(normalized)) != selection["reviewSha256"]):
            raise Problem("REVIEW_CHANGED", "The selected immutable review no longer matches.")
        p.mapped_records(prepared, normalized)
        stage = Path(tempfile.mkdtemp(prefix=".frozen-source-", dir=destination.parent))
        try:
            for name, path in tree_files(workspace).items():
                if (name in {"project.json", "prepared.json", "source-example.zip"}
                        or name.startswith(("source/", "reviews/"))):
                    copy_file(path, stage / name)
            write_json(stage / "current.json", {
                "revision": selection["revision"], "reviewSha256": selection["reviewSha256"], "path": rel})
            p.write_new(stage / "workspace.lock", b"")
            actual = p.show(stage)
            if source_selection(actual) != selection:
                raise Problem("FROZEN_SOURCE_CHANGED", "Frozen source failed its original review binding.")
            p.sync_tree(stage)
            os.rename(stage, destination)
            stage = None
            p.fsync_dir(destination.parent)
            return actual
        finally:
            if stage is not None:
                shutil.rmtree(stage)



def _review_history(workspace, selection):
    """Read published ancestry while the caller holds the core workspace lock."""
    result, revision, review_sha = [], selection["revision"], selection["reviewSha256"]
    while True:
        name = "reviews/%08d-%s.json" % (revision, review_sha)
        saved = read_json(Path(workspace) / name)
        review = saved.get("review")
        if (saved.get("schema") != p.SCHEMA + ".revision"
                or saved.get("revision") != revision or saved.get("reviewSha256") != review_sha
                or not isinstance(review, dict)
                or review.get("sourceManifestSha256") != selection["sourceManifestSha256"]
                or p.digest(p.canonical(review)) != review_sha):
            raise Problem("REVIEW_HISTORY", "An original published review changed.", member=name)
        result.append({"selection": {**selection, "revision": revision, "reviewSha256": review_sha},
                       "createdAt": saved.get("createdAt"), "note": review.get("note", ""),
                       "decisions": len(review.get("decisions", []))})
        if revision == 0:
            break
        review_sha = saved.get("previousReviewSha256")
        if not isinstance(review_sha, str) or not HASH.fullmatch(review_sha):
            raise Problem("REVIEW_HISTORY", "An original review is missing its preceding revision.", member=name)
        revision -= 1
    return result


def review_history(workspace, status):
    """Return the published review ancestry selected by this status snapshot."""
    with p.project_lock(workspace):
        return _review_history(workspace, source_selection(status))


def load_preservica():
    module_path = Path(__file__).with_name("preservica.py")
    client_path = Path(__file__).with_name("preservica_client.py")
    if not module_path.is_file() or not client_path.is_file():
        return None, None
    import preservica
    import preservica_client
    return preservica, preservica_client


def load_libnova():
    module_path = Path(__file__).with_name("libnova.py")
    client_path = Path(__file__).with_name("libnova_client.py")
    if not module_path.is_file() or not client_path.is_file():
        return None, None
    import libnova
    import libnova_client
    return libnova, libnova_client


def load_archivematica():
    module_path = Path(__file__).with_name("archivematica.py")
    client_path = Path(__file__).with_name("archivematica_client.py")
    if not module_path.is_file() or not client_path.is_file():
        return None, None
    import archivematica
    import archivematica_client
    return archivematica, archivematica_client


def selected_provider(provider):
    if provider == "preservica":
        producer, client = load_preservica()
        label = "Preservica"
    elif provider == "libnova":
        producer, client = load_libnova()
        label = "LIBNOVA"
    elif provider == "archivematica":
        producer, client = load_archivematica()
        label = "Archivematica"
    else:
        raise Problem("DESTINATION", "Select an original saved provider.")
    if producer is None or client is None:
        raise Problem("APPLICATION_SOURCE", "Install the complete " + label + " producer, client and guides.")
    return producer, client


def provider_templates():
    producer, client = load_preservica()
    libnova, libnova_client = load_libnova()
    archivematica, archivematica_client = load_archivematica()
    agreement = roda.agreement_template()
    return {
        "archivematica": {"label": "Archivematica",
            "available": archivematica is not None and archivematica_client is not None,
            "settings": archivematica.settings_template() if archivematica else None,
            "configuration": archivematica_client.configuration_template() if archivematica_client else None,
            "reconciliationTemplates": {kind: archivematica_client.reconciliation_template(kind)
                for kind in archivematica_client.RECONCILIATION_KINDS} if archivematica_client else {}},
        "roda": {
            "label": "RODA", "available": True,
            "settings": agreement,
            "configuration": {"schema": roda_client.SCHEMA, "baseUrl": "",
                "repositoryUsername": "", "auth": {"type": "bearer", "tokenEnv": "RODA_ACCESS_TOKEN"},
                "timeoutSeconds": 120, "maxResponseBytes": 16777216,
                "reportPageSize": 100, "maxPages": 1000},
            "jobTemplate": {"name": "", "plugin": "org.roda.core.plugins.base.ingest.v2.ConfigurableIngestPlugin",
                "pluginParameters": {"parameter.sip_to_aip_class": "org.roda.core.plugins.base.ingest.BagitToAIPPlugin"},
                "priority": "MEDIUM", "parallelism": "NORMAL"},
        },
        "preservica": {"label": "Preservica", "available": producer is not None,
            "settings": producer.settings_template() if producer else None,
            "configuration": client.configuration_template() if client else None,
            "reconciliationTemplates": {kind: client.reconciliation_template(kind)
                for kind in ("original-response", "progress-observation", "process-observation")} if client else {}},
        "libnova": {"label": "LIBNOVA", "available": libnova is not None and libnova_client is not None,
            "settings": libnova.mapping_template() if libnova else None,
            "configuration": libnova_client.configuration_template() if libnova_client else None,
            "reconciliationTemplates": {kind: libnova_client.reconciliation_template(kind)
                for kind in ("original-function-response", "original-job-id")} if libnova_client else {}},
    }


class Workbench:
    def __init__(self, workspace):
        self.root = Path(workspace).absolute()
        if self.root.is_symlink():
            raise Problem("WORKSPACE", "Select the original workspace directory.")
        directory(self.root.parent)
        self.control = directory(self.root.parent / (self.root.name + ".operator"))
        self.lock_fd = os.open(self.control / "server.lock",
                               os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            if not stat.S_ISREG(os.fstat(self.lock_fd).st_mode):
                raise Problem("SERVER_LOCK", "Operator lock is not a regular file.")
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self.lock_fd)
            raise Problem("SERVER_RUNNING", "The operator application is already open for this workspace.")
        try:
            self.guard = threading.RLock()
            self.csrf = secrets.token_urlsafe(32)
            self.instance_id = uuid.uuid4().hex
            self.launch = None
            self.port = None
            self.active = None
            self.worker = None
            self.closing = False
            self.operations = directory(self.control / "operations")
            self.accessions = self.control / "accessions"
            self.packages = directory(self.control / "packages")
            self.deliveries = directory(self.control / "deliveries")
            self.jobs_path = self.control / "jobs.json"
            self.artifacts_path = self.control / "artifacts.json"
            self.jobs = read_json(self.jobs_path)["jobs"] if self.jobs_path.exists() else []
            self.artifacts = read_json(self.artifacts_path)["artifacts"] if self.artifacts_path.exists() else []
            for job in self.jobs:
                if job["state"] in {"QUEUED", "RUNNING"}:
                    job.update({"state": "INTERRUPTED", "completedAt": p.utc(),
                                "message": "The saved process ended before this operator session. Continue its original operation."})
            self.persist_jobs()
            if not self.artifacts_path.exists():
                write_json(self.artifacts_path, {"schema": SCHEMA + ".artifacts", "artifacts": self.artifacts})

        except BaseException:
            os.close(self.lock_fd)
            self.lock_fd = None
            raise

    def close(self):
        if self.lock_fd is None:
            return
        with self.guard:
            self.closing = True
            worker = self.worker
        if worker is not None and worker.ident is not None and worker is not threading.current_thread():
            worker.join()
        fcntl.flock(self.lock_fd, fcntl.LOCK_UN)
        os.close(self.lock_fd)
        self.lock_fd = None

    def persist_jobs(self):
        value = {"schema": SCHEMA + ".jobs", "jobs": self.jobs}
        write_json(self.jobs_path, value, replace=self.jobs_path.exists())

    def queue(self, kind, arguments, action):
        with self.guard:
            if self.closing:
                raise Problem("SERVER_CLOSING", "The original operator application is finishing its active work.")
            if self.active:
                raise Problem("BUSY", "The original workspace operation is still running.", jobId=self.active)
            job = {"id": uuid.uuid4().hex, "kind": kind, "arguments": arguments,
                   "state": "QUEUED", "createdAt": p.utc()}
            self.jobs.append(job)
            try:
                self.persist_jobs()
            except BaseException:
                job.update({"state": "FAILED", "completedAt": p.utc(),
                            "message": "The operation was not started because its queue record could not be saved."})
                raise
            self.active = job["id"]

        def retain_outcome():
            try:
                self.persist_jobs()
                job.pop("persistenceError", None)
            except BaseException as error:
                job["persistenceError"] = failure(error)

        def work():
            try:
                with self.guard:
                    job.update({"state": "RUNNING", "startedAt": p.utc()})
                    self.persist_jobs()
                result = action(job)
                with self.guard:
                    job.update({"state": "COMPLETED", "completedAt": p.utc(), "result": result})
            except BaseException as error:
                with self.guard:
                    job.update({"state": "FAILED", "completedAt": p.utc(), "error": failure(error)})
            finally:
                with self.guard:
                    self.active = None
                    retain_outcome()

        thread = threading.Thread(target=work, name="preservation-" + kind, daemon=False)
        with self.guard:
            self.worker = thread
        try:
            thread.start()
        except BaseException as error:
            with self.guard:
                self.active = None
                job.update({"state": "FAILED", "completedAt": p.utc(), "error": failure(error)})
                retain_outcome()
            raise
        return {"queued": True, "job": dict(job)}

    def recover_export(self, job_id):
        """Adopt the exact archive published by an interrupted original local job."""
        with self.guard:
            if self.closing or self.active:
                raise Problem("BUSY", "Finish the active workspace operation before recovering an export.")
            job = next((item for item in self.jobs if item["id"] == job_id), None)
            if job is None or job["kind"] not in {"complete-export", "destination-export"}:
                raise Problem("EXPORT_JOB", "Select the original complete export job.")
            if job["state"] == "COMPLETED":
                artifact = job.get("result", {}).get("artifact", {})
                self.artifact_path(artifact.get("id"))
                return {"job": json.loads(json.dumps(job)), "recovered": True}
            if job["state"] not in {"INTERRUPTED", "FAILED"}:
                raise Problem("EXPORT_ACTIVE", "The original export is still running.")
            operation_id = None
            if job["kind"] == "destination-export":
                operation_id = identifier(job["arguments"].get("operationId"))
                operation_root, selected = self.operation(operation_id)
                if selected["provider"] != "archivematica":
                    raise Problem("DESTINATION", "Select the original Archivematica export.")
                output = self.deliveries / ("Archivematica_Complete_" + operation_id + "_" + job["id"] + ".zip")
                kind = "archivematica-complete-destination"
            else:
                if job["arguments"]:
                    raise Problem("EXPORT_JOB", "The saved complete export arguments changed.")
                output = self.deliveries / ("Research_Preservation_Complete_" + job["id"] + ".zip")
                kind = "complete-workspace"
            if not output.exists():
                raise Problem("EXPORT_INCOMPLETE", "The original export did not publish a complete archive.",
                              jobId=job["id"])
            original = file_digest(output)
            with zipfile.ZipFile(output) as archive:
                if operation_id is not None:
                    producer, _ = selected_provider("archivematica")
                    manifest = producer.verify_snapshot(archive)
                    prepared = operation_root / "prepared"
                    saved = producer.verify(prepared)
                    member = next((row for row in manifest["members"]
                                   if row["path"] == "workspace/manifest.json"), None)
                    if (manifest["packageId"] != saved["packageId"] or member is None
                            or {key: member[key] for key in ("bytes", "sha256")}
                            != producer.file_identity(prepared / "manifest.json")):
                        raise Problem("EXPORT_CHANGED", "The archive belongs to another original receiving package.")
                    selection = selected["selection"]
                    result = {"operationId": operation_id,
                              "receiving": {"path": str(output), **original, "manifest": manifest, "reused": True}}
                else:
                    manifest = snapshot_manifest(archive)
                    archived_jobs = p.parse_json(archive.read("operator/jobs.json")).get("jobs", [])
                    archived = [item for item in archived_jobs if item.get("id") == job["id"]]
                    if (len(archived) != 1 or any(archived[0].get(key) != job.get(key)
                            for key in ("id", "kind", "arguments", "createdAt"))
                            or archived[0].get("state") not in {"QUEUED", "RUNNING"}):
                        raise Problem("EXPORT_CHANGED", "The archive does not retain this original export job.")
                    selection = manifest["selection"]
                    result = {"selection": selection, "members": len(manifest["files"]) + 1,
                              "sourceRecords": manifest["sourceRecords"],
                              "includedRecords": manifest["includedRecords"]}
            if file_digest(output) != original:
                raise Problem("EXPORT_CHANGED", "The original export changed during recovery.")
            result["artifact"] = self.artifact(output, kind, selection, operation_id)
            recovered_at = p.utc()
            previous = json.loads(json.dumps(job))
            job["recovery"] = {"at": recovered_at, "previousState": job["state"],
                               "archive": original, "manifestSha256": p.digest(p.canonical(manifest)),
                               "method": "original-published-archive"}
            job.update({"state": "COMPLETED", "completedAt": recovered_at, "result": result})
            for key in ("error", "message", "persistenceError"):
                job.pop(key, None)
            try:
                self.persist_jobs()
            except BaseException:
                job.clear()
                job.update(previous)
                raise
            return {"job": json.loads(json.dumps(job)), "recovered": True}

    def artifact(self, path, kind, selection=None, operation_id=None):
        path = Path(path)
        rel = p.safe_name(path.relative_to(self.control).as_posix())
        item = {"id": p.digest(rel.encode("utf-8")), "name": path.name, "path": rel,
                "kind": kind, "createdAt": p.utc(), **file_digest(path)}
        if selection is not None:
            item["selection"] = selected_review(selection)
        if operation_id is not None:
            item["operationId"] = identifier(operation_id)
        with self.guard:
            prior = next((x for x in self.artifacts if x["path"] == rel), None)
            if prior:
                if any(prior.get(k) != item.get(k) for k in ("bytes", "sha256", "kind", "selection", "operationId")):
                    raise Problem("ARTIFACT_CHANGED", "A published artifact no longer matches its original identity.")
                return dict(prior)
            self.artifacts.append(item)
            try:
                write_json(self.artifacts_path, {"schema": SCHEMA + ".artifacts", "artifacts": self.artifacts}, replace=True)
            except BaseException:
                self.artifacts.pop()
                raise
        return dict(item)

    def artifact_path(self, artifact_id):
        with self.guard:
            item = next((dict(x) for x in self.artifacts if x["id"] == artifact_id), None)
        if item is None:
            raise Problem("ARTIFACT", "Choose a saved package or handoff.")
        path = self.control / p.safe_name(item["path"])
        if file_digest(path) != {k: item[k] for k in ("bytes", "sha256")}:
            raise Problem("ARTIFACT_CHANGED", "The retained delivery file changed.")
        return path, item

    def operation(self, operation_id):
        operation_id = identifier(operation_id)
        root = self.operations / operation_id
        value = read_json(root / "selection.json")
        if (value.get("schema") != SCHEMA + ".operation" or value.get("id") != operation_id
                or value.get("provider") not in {"roda", "preservica", "libnova", "archivematica"}):
            raise Problem("OPERATION", "The saved destination selection is invalid.")
        selected_review(value.get("selection"))
        expected = value.get("requestSha256")
        request = {k: value[k] for k in ("id", "provider", "label", "selection", "settings", "configuration", "jobTemplate")}
        if p.digest(p.canonical(request)) != expected:
            raise Problem("OPERATION_CHANGED", "The original destination choices changed.")
        for name, data in (("settings.json", value["settings"]), ("configuration.json", value["configuration"])):
            if read_json(root / name) != data:
                raise Problem("OPERATION_CHANGED", "A retained destination input changed.", member=name)
        if value["provider"] == "roda" and read_json(root / "job-template.json") != value["jobTemplate"]:
            raise Problem("OPERATION_CHANGED", "The original RODA job template changed.")
        return root, value

    def migration_status(self, operation_id):
        root, value = self.operation(operation_id)
        result = dict(value)
        prepared = root / "prepared"
        if not prepared.exists():
            result["progress"] = {"status": "PREPARATION_PENDING"}
            return result
        try:
            if value["provider"] == "roda":
                result["package"] = roda.show(prepared)
                result["progress"] = roda_client.status(prepared)
            else:
                producer, client = selected_provider(value["provider"])
                result["package"] = producer.show(prepared)
                result["progress"] = client.show(prepared, operation_id)
        except BaseException as error:
            result["progress"] = {"status": "RECEIVING_REQUIRES_ATTENTION", **failure(error)}
        return result

    def state(self):
        status = p.show(self.root) if self.root.exists() else None
        with self.guard:
            jobs = json.loads(json.dumps(self.jobs))
            artifacts = [dict(x) | {"available": (self.control / x["path"]).is_file()} for x in self.artifacts]
            active = self.active
        migrations = []
        for root in sorted(self.operations.iterdir()):
            if root.name.startswith("."):
                continue
            if root.is_symlink() or not root.is_dir():
                raise Problem("OPERATION", "An operation directory changed.")
            if not (root / "selection.json").is_file():
                raise Problem("OPERATION", "An operation is missing its original selection.", operationId=root.name)
            _, saved = self.operation(root.name)
            migrations.append({k: saved[k] for k in ("id", "provider", "label", "selection", "createdAt")})
        return {"schema": SCHEMA, "initialized": status is not None, "status": status,
                "workspace": str(self.root), "instanceId": self.instance_id,
                "csrf": self.csrf, "active": active,
                "jobs": jobs[-100:], "jobCount": len(jobs), "artifacts": artifacts,
                "migrations": migrations, "providers": provider_templates(),
                 "reviewHistory": review_history(self.root, status) if status is not None else [],
                "editableFields": sorted(p.REVIEW_FIELDS),
                "accessions": collection.bindings(self.accessions)}

    def preview(self, supplied=None, query="", included="all", offset=0, limit=50):
        with p.project_lock(self.root):
            project, prepared = p.project_files(self.root)
            current, saved = p.current_review(self.root, prepared)
            review = p.normalize_review(supplied, prepared) if supplied is not None else saved["review"]
            rows = p.mapped_records(prepared, review)
            query = str(query).casefold().strip()
            if included not in {"all", "included", "excluded", "changed", "issues"}:
                raise Problem("FILTER", "Unknown record filter.")
            def matches(row):
                if query.startswith("id:"):
                    return row["identifier"].casefold() == query[3:].strip()
                searchable = (row["identifier"] + " " + " ".join(row["reviewedDc"].get("title", []))
                              + " " + " ".join(row["reviewedDc"].get("creator", []))).casefold()
                return not query or query in searchable
            selected = [x for x in rows if
                (included == "all" or included == "included" and x["include"]
                 or included == "excluded" and not x["include"]
                 or included == "changed" and x["decision"] is not None
                 or included == "issues" and bool(x["issues"])) and matches(x)]
            offset, limit = max(0, int(offset)), max(1, min(200, int(limit)))
            return {"selection": {"sourceManifestSha256": project["binding"]["manifestSha256"],
                                 "revision": current["revision"], "reviewSha256": current["reviewSha256"]},
                    "draft": supplied is not None, "rows": selected[offset:offset + limit],
                    "offset": offset, "limit": limit, "total": len(selected),
                    "counts": {"source": len(rows), "included": sum(x["include"] for x in rows),
                               "excluded": sum(not x["include"] for x in rows)}}

    def accession(self, accession_id):
        return self.accessions / collection.ident(accession_id)

    def inspect_accession(self, source):
        value = collection.inspect(source)
        root = directory(self.control / "accession-inspections")
        target = root / (value["inventory"]["sha256"] + ".json")
        if target.exists():
            if read_json(target) != value["inventory"]:
                raise Problem("SOURCE_CHANGED", "The retained inspection differs from its original inventory.")
        else:
            write_json(target, value["inventory"])
        return {"source": value["source"], "inventorySha256": value["inventory"]["sha256"],
                "files": len(value["inventory"]["files"]), "directories": len(value["inventory"]["directories"]),
                "bytes": value["inventory"]["bytes"], "notice": value["notice"]}

    def initialize_accession(self, source, root, selected, inventory_sha256):
        expected = self.control / "accession-inspections" / (inventory_sha256 + ".json")
        if not HASH.fullmatch(str(inventory_sha256)) or not expected.is_file():
            raise Problem("SOURCE_REVIEW", "Inspect this original collection first.")
        inspected = collection.validate_inventory(read_json(expected))
        if inspected["sha256"] != inventory_sha256:
            raise Problem("SOURCE_CHANGED", "The original inspection identity changed.")
        value = collection.initialize(source, root, selected, inventory_sha256)
        return {key: value[key] for key in ("id", "revision", "reviewSha256", "settings", "summary", "reused")}

    def retain_transfer(self, selected):
        if not isinstance(selected, dict) or selected.get("kind") not in {"artifact", "path"}:
            raise Problem("TRANSFER_SELECTION", "Choose a complete saved or incoming package.")
        if selected["kind"] == "artifact":
            if set(selected) != {"kind", "id"}:
                raise Problem("TRANSFER_SELECTION", "Select the original saved package ID.")
            source, artifact = self.artifact_path(selected["id"])
            if not source.name.lower().endswith(".zip") or artifact["kind"] == "complete-workspace":
                raise Problem("TRANSFER_SELECTION", "Select an original BagIt ZIP, not a complete workspace.")
            # Existing original delivery bytes are already in complete workspace custody.
            # Retain their exact binding without making another full package copy.
            return source, {"name": source.name, "bytes": artifact["bytes"], "sha256": artifact["sha256"],
                            "retainedPath": artifact["path"], "artifactId": artifact["id"]}
        else:
            if set(selected) != {"kind", "path"} or not isinstance(selected["path"], str) or not selected["path"].strip():
                raise Problem("TRANSFER_SELECTION", "Enter the complete original ZIP path on this host.")
            source = Path(selected["path"]).expanduser().absolute()
        expected = file_digest(source, p.MAX_TOTAL)
        home = self.packages / "transfer-desk" / "originals"
        directory(home)
        retained = home / (expected["sha256"] + ".zip")
        copy_file(source, retained, expected)
        if file_digest(source, p.MAX_TOTAL) != expected:
            raise Problem("FILE_CHANGED", "The selected original package changed during retention.")
        original = self.artifact(retained, "transfer-original")
        return retained, {"name": source.name, **expected, "retainedPath": original["path"],
                          "artifactId": original["id"]}

    def transfer_report(self, mode, selections):
        if mode not in {"inspect", "compare"} or not isinstance(selections, list) or len(selections) != (1 if mode == "inspect" else 2):
            raise Problem("TRANSFER_SELECTION", "Select one package or an ordered pair of original editions.")
        retained = [self.retain_transfer(value) for value in selections]
        if mode == "inspect":
            report = transfers.inspect(retained[0][0], retained[0][1])
        else:
            report = transfers.compare(retained[0][0], retained[1][0], retained[0][1], retained[1][1])
        for path, identity in retained:
            if file_digest(path, p.MAX_TOTAL) != {key: identity[key] for key in ("bytes", "sha256")}:
                raise Problem("FILE_CHANGED", "A retained original package changed during inspection.")
        bodies = {"json": transfers.encoded(report), "html": transfers.report_html(report),
                  "csv": transfers.report_csv(report)}
        if any(len(body) > transfers.MAX_REPORT for body in bodies.values()):
            raise Problem("TRANSFER_REPORT_SIZE", "The complete report exceeds the 64 MiB report limit.")
        report_id = p.digest(bodies["json"])
        folder = self.packages / "transfer-desk" / "reports"
        directory(folder)
        result = {"mode": mode, "profile": report["kind"], "reportId": report_id,
                  "summary": report["summary"], "packages": [value for _, value in retained],
                  "artifacts": {}}
        for extension, body in bodies.items():
            target = folder / ("Transfer_" + mode + "_" + report_id + "." + extension)
            if target.exists():
                if p.read_regular(target.parent, target.name, transfers.MAX_REPORT) != body:
                    raise Problem("TRANSFER_REPORT_CHANGED", "A retained report differs from its original package selection.")
            else:
                p.write_new(target, body)
            result["artifacts"][extension] = self.artifact(target, "transfer-" + mode + "-" + extension)
        return result

    def transfer_view(self, report_id, offset=0, query="", changed_only=False):
        path, artifact = self.artifact_path(report_id)
        if artifact["kind"] not in {"transfer-inspect-json", "transfer-compare-json"}:
            raise Problem("TRANSFER_REPORT", "Select a complete saved transfer inspection or comparison.")
        report = p.parse_json(p.read_regular(path.parent, path.name, transfers.MAX_REPORT))
        return {**transfers.page(report, offset=int(offset), query=query, changed_only=changed_only),
                "artifact": artifact}

    def build_accession(self, accession_id, revision):
        root = self.accession(accession_id)
        current = collection.show(root)
        if current["revision"] != revision:
            raise Problem("STALE_REVISION", "Choose the current saved accession review.")
        name = "Collection_" + accession_id + "_" + str(revision) + "_" + current["reviewSha256"][:16] + ".zip"
        output = self.packages / name
        receipt = collection.build(root, output, revision)
        return {"package": receipt, "artifact": self.artifact(output, "collection-transfer")}

    def build_package(self, selection):
        selection = selected_review(selection)
        label = "r%08d-%s" % (selection["revision"], selection["reviewSha256"][:16])
        frozen = self.packages / (label + "-source")
        freeze_source(self.root, frozen, selection)
        path = self.packages / ("Research_Archivematica_" + label + ".zip")
        receipt = p.build(frozen, path, selection["revision"], zipped=True)
        return {"package": receipt, "artifact": self.artifact(path, "archivematica", selection)}

    def prepare_migration(self, request):
        allowed = {"id", "provider", "label", "selection", "settings", "configuration", "jobTemplate"}
        if not isinstance(request, dict) or set(request) != allowed:
            raise Problem("DESTINATION", "A destination requires its complete saved source and configuration.")
        operation_id = identifier(request["id"])
        provider = request["provider"]
        if provider not in {"roda", "preservica", "libnova", "archivematica"}:
            raise Problem("DESTINATION", "Select Archivematica, RODA, Preservica or LIBNOVA.")
        selected_review(request["selection"])
        p.text(request["label"], "destination label", empty=False)
        if not isinstance(request["settings"], dict) or not isinstance(request["configuration"], dict):
            raise Problem("DESTINATION", "Settings and configuration must be complete JSON objects.")
        if provider == "roda" and not isinstance(request["jobTemplate"], dict):
            raise Problem("DESTINATION", "Select the complete RODA ingest job template.")
        if provider in {"preservica", "libnova", "archivematica"} and request["jobTemplate"] is not None:
            raise Problem("DESTINATION", "This destination does not use a RODA job template.")
        if provider in {"libnova", "archivematica"}:
            producer, client = selected_provider(provider)
            request = json.loads(json.dumps(request))
            prevent_literal_credentials(request["configuration"])
            request["settings"] = (producer.normalize_settings(request["settings"]) if provider == "archivematica"
                                   else producer.normalize_mapping(request["settings"]))
            request["configuration"] = client.normalize_configuration(request["configuration"])
        root = self.operations / operation_id
        expected = p.digest(p.canonical(request))
        if root.exists():
            _, existing = self.operation(operation_id)
            if existing["requestSha256"] != expected:
                raise Problem("OPERATION_CONFLICT", "This operation ID already has different source or destination choices.")
        else:
            stage = Path(tempfile.mkdtemp(prefix=".destination-", dir=self.operations))
            try:
                write_json(stage / "settings.json", request["settings"])
                write_json(stage / "configuration.json", request["configuration"])
                if provider == "roda":
                    write_json(stage / "job-template.json", request["jobTemplate"])
                    roda.validate_agreement(p.canonical(request["settings"]))
                    roda_client._config(stage / "configuration.json")
                else:
                    producer, client = selected_provider(provider)
                write_json(stage / "selection.json", {
                    "schema": SCHEMA + ".operation", **request,
                    "requestSha256": expected, "createdAt": p.utc()})
                p.sync_tree(stage)
                os.rename(stage, root)
                stage = None
                p.fsync_dir(self.operations)
            finally:
                if stage is not None:
                    shutil.rmtree(stage)
        frozen = root / "source"
        freeze_source(self.root, frozen, request["selection"])
        prepared = root / "prepared"
        if provider == "roda":
            bag = root / "original-transfer.zip"
            p.build(frozen, bag, request["selection"]["revision"], zipped=True)
            roda.prepare(bag, root / "settings.json", prepared)
            roda_client.plan(prepared, root / "configuration.json", root / "job-template.json")
        elif provider in {"libnova", "archivematica"}:
            producer, client = selected_provider(provider)
            bag = root / "original-transfer.zip"
            p.build(frozen, bag, request["selection"]["revision"], zipped=True)
            producer.prepare(bag, prepared, request["settings"])
            client.plan(prepared, request["configuration"], operation_id)
            self.artifact(bag, provider + "-original-bagit", request["selection"], operation_id)
            report = prepared / "report.html"
            if report.is_file():
                self.artifact(report, provider + "-source-review", request["selection"], operation_id)
        else:
            producer, client = load_preservica()
            producer.prepare(frozen, prepared, request["selection"]["revision"], settings=request["settings"])
            client.plan(prepared, request["configuration"], operation_id)
        package = prepared / "transfer.zip"
        if package.is_file():
            self.artifact(package, provider, request["selection"], operation_id)
        if provider in {"libnova", "archivematica"}:
            self.receiving_artifacts(operation_id)
        return self.migration_status(operation_id)

    def libnova_receiving_artifacts(self, operation_id):
        _, selected = self.operation(operation_id)
        if selected["provider"] != "libnova":
            raise Problem("DESTINATION", "Select the original LIBNOVA destination.")
        return self.receiving_artifacts(operation_id)

    def receiving_artifacts(self, operation_id):
        root, selected = self.operation(operation_id)
        provider = selected["provider"]
        if provider not in {"libnova", "archivematica"}:
            raise Problem("DESTINATION", "Select the original receiving destination.")
        label = {"libnova": "LIBNOVA", "archivematica": "Archivematica"}[provider]
        producer, client = selected_provider(provider)
        prepared = root / "prepared"
        with producer.lock(prepared):
            progress = client.show(prepared, operation_id)
            state = progress["state"]
            if state.get("state") != "VERIFIED":
                return []
            proof = state.get("proof")
            proof_prefix = ("operations/" + operation_id + "/" if provider == "archivematica" else "")
            receiving_prefix = proof_prefix + "receiving/"
            if (not isinstance(proof, dict) or set(proof) != {"path", "bytes", "sha256"}
                    or type(proof["bytes"]) is not int or proof["bytes"] < 0
                    or not isinstance(proof["sha256"], str) or not HASH.fullmatch(proof["sha256"])
                    or proof["path"] != receiving_prefix + proof["sha256"] + ".json"
                    or state.get("report") != receiving_prefix + proof["sha256"] + ".html"):
                raise Problem("RECEIVING_EVIDENCE", "The saved " + label + " receiving identity is invalid.")
            proof_root = prepared if provider == "archivematica" else prepared / "operations" / operation_id
            proof_path = proof_root / proof["path"]
            if file_digest(proof_path) != {"bytes": proof["bytes"], "sha256": proof["sha256"]}:
                raise Problem("RECEIVING_EVIDENCE", "The original receiving evidence changed.")
            evidence = read_json(proof_path, MAX_SNAPSHOT_MEMBER)
            if (evidence.get("schema") != "stellar-forge." + provider + "-operation.v1.receiving"
                    or evidence.get("operationId") != operation_id
                    or evidence.get("packageId") != progress["operation"]["packageId"]
                    or evidence.get("summary") != state.get("summary")
                    or provider == "libnova" and evidence.get("job") != state.get("job")):
                raise Problem("RECEIVING_EVIDENCE", "The receiving report belongs to different saved results.")
            report_path = proof_root / state["report"]
            regular(report_path)
            return [
                self.artifact(proof_path, provider + "-receiving-evidence", selected["selection"], operation_id),
                self.artifact(report_path, provider + "-receiving-report", selected["selection"], operation_id),
            ]

    def continue_migration(self, operation_id, action, evidence=None):
        root, selected = self.operation(operation_id)
        prepared = root / "prepared"
        if not prepared.is_dir():
            raise Problem("PREPARATION_PENDING", "Complete the original saved package and migration plan first.")
        if selected["provider"] == "roda":
            if action == "run":
                result = roda_client.run(prepared, root / "configuration.json", root / "job-template.json", poll_seconds=0)
            elif action == "refresh":
                result = roda_client.reconcile(prepared, root / "configuration.json", poll_seconds=0)
            elif action == "reconcile":
                if not isinstance(evidence, dict) or set(evidence) - {"transferUuid", "jobId"}:
                    raise Problem("ORIGINAL_ID", "Select the original transfer UUID and/or original job ID.")
                if not evidence.get("transferUuid") and not evidence.get("jobId"):
                    raise Problem("ORIGINAL_ID", "Enter at least one original repository identifier.")
                result = roda_client.reconcile(prepared, root / "configuration.json",
                    transfer_uuid=evidence.get("transferUuid"), job_id=evidence.get("jobId"), poll_seconds=0)
            else:
                raise Problem("ACTION", "Unknown saved migration action.")
        else:
            producer, client = selected_provider(selected["provider"])
            if action == "run":
                result = client.run(prepared, operation_id)
            elif action == "refresh":
                result = client.refresh(prepared, operation_id)
            elif action == "reconcile":
                if not isinstance(evidence, dict):
                    raise Problem("ORIGINAL_ID", "Original request evidence must be a JSON object.")
                result = client.reconcile(prepared, operation_id, evidence)
            elif action == "decide" and selected["provider"] == "archivematica":
                if not isinstance(evidence, dict):
                    raise Problem("INGEST_CHOICE", "Choose an observed option for the original Archivematica job.")
                result = client.decide(prepared, operation_id, evidence)
            else:
                raise Problem("ACTION", "Unknown saved migration action.")
        if selected["provider"] in {"libnova", "archivematica"}:
            self.receiving_artifacts(operation_id)
        return {"operationId": operation_id, "result": result,
                "migration": self.migration_status(operation_id)}


def zip_member(archive, name, source, expected):
    info = zipfile.ZipInfo(p.safe_name(name), date_time=(1980, 1, 1, 0, 0, 0))
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    info.compress_type = zipfile.ZIP_STORED if name.endswith(".zip") else zipfile.ZIP_DEFLATED
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    sha, size = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as incoming, archive.open(info, "w", force_zip64=True) as out:
        before = os.fstat(incoming.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise Problem("REGULAR_FILE", "A snapshot source is not a regular file.", member=name)
        for body in iter(lambda: incoming.read(1024 * 1024), b""):
            size += len(body)
            if size > expected["bytes"]:
                raise Problem("SOURCE_CHANGED", "The snapshot source grew.", member=name)
            sha.update(body)
            out.write(body)
        after = os.fstat(incoming.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Problem("SOURCE_CHANGED", "The snapshot source changed.", member=name)
    if {"bytes": size, "sha256": sha.hexdigest()} != expected:
        raise Problem("SOURCE_CHANGED", "The snapshot member differs from its original source.", member=name)


def snapshot_manifest(archive):
    members = archive.infolist()
    if len(members) > 100000:
        raise Problem("SNAPSHOT_LIMIT", "The snapshot has too many members.")
    names = [p.safe_name(x.filename) for x in members]
    if len(set(names)) != len(names) or "MANIFEST.json" not in names:
        raise Problem("SNAPSHOT_MANIFEST", "Expected unique snapshot members and one manifest.")
    for entry in members:
        mode = stat.S_IFMT(entry.external_attr >> 16)
        if entry.is_dir() or mode not in {0, stat.S_IFREG} or entry.flag_bits & 1:
            raise Problem("SNAPSHOT_MEMBER", "Snapshots contain unencrypted regular files only.", member=entry.filename)
        if entry.file_size > MAX_SNAPSHOT_MEMBER:
            raise Problem("SNAPSHOT_LIMIT", "A snapshot member exceeds the receiving limit.", member=entry.filename)
    if archive.getinfo("MANIFEST.json").file_size > BODY_LIMIT:
        raise Problem("SNAPSHOT_LIMIT", "The manifest exceeds the receiving limit.")
    manifest = p.parse_json(archive.read("MANIFEST.json"))
    if not isinstance(manifest, dict) or manifest.get("schema") != SNAPSHOT_SCHEMA:
        raise Problem("SNAPSHOT_MANIFEST", "Unsupported preservation-workbench snapshot.")
    descriptors = manifest.get("files")
    if not isinstance(descriptors, dict) or set(descriptors) | {"MANIFEST.json"} != set(names):
        raise Problem("SNAPSHOT_MANIFEST", "The complete archive inventory differs from its manifest.")
    total = 0
    for name, value in descriptors.items():
        rel = p.safe_name(name)
        if rel.split("/", 1)[0] not in {"workspace", "operator", "application"} or "/" not in rel:
            raise Problem("SNAPSHOT_MEMBER", "Unknown snapshot member root.", member=name)
        if (not isinstance(value, dict) or set(value) != {"bytes", "sha256"}
                or type(value["bytes"]) is not int or not 0 <= value["bytes"] <= MAX_SNAPSHOT_MEMBER
                or not isinstance(value["sha256"], str) or not HASH.fullmatch(value["sha256"])
                or value["bytes"] != archive.getinfo(name).file_size):
            raise Problem("SNAPSHOT_MANIFEST", "Invalid snapshot member identity.", member=name)
        total += value["bytes"]
    if total > MAX_SNAPSHOT:
        raise Problem("SNAPSHOT_LIMIT", "The complete snapshot exceeds its receiving limit.")
    collection_only = manifest.get("collectionOnly", False)
    if type(collection_only) is not bool:
        raise Problem("SNAPSHOT_MANIFEST", "Invalid collection-only snapshot selection.")
    if collection_only:
        if manifest.get("selection") is not None or not (manifest.get("collectionBindings") or manifest.get("transferReports")):
            raise Problem("SNAPSHOT_MANIFEST", "Non-research snapshots retain their original accessions or complete transfer reports.")
        if any(name.startswith("workspace/") for name in descriptors):
            raise Problem("SNAPSHOT_MANIFEST", "A collection-only snapshot cannot substitute a research workspace.")
    else:
        selected_review(manifest.get("selection"))
    required = {"operator/jobs.json", "operator/artifacts.json"}
    if not collection_only:
        required.update({"workspace/project.json", "workspace/prepared.json", "workspace/current.json"})
    required.update("application/" + name for name in APPLICATION)
    provider_groups = {"preservica": PRESERVICA_APPLICATION, "libnova": LIBNOVA_APPLICATION,
                       "archivematica": ARCHIVEMATICA_APPLICATION, "collections": COLLECTION_APPLICATION,
                       "transfers": TRANSFER_APPLICATION}
    selected_collections = manifest.get("collectionBindings", [])
    if not isinstance(selected_collections, list):
        raise Problem("SNAPSHOT_MANIFEST", "Invalid accession bindings.")
    collection_ids = set()
    for item in selected_collections:
        if (not isinstance(item, dict) or set(item) != {"id", "title", "inventorySha256", "revision", "reviewSha256", "summary"}
                or collection.ident(item.get("id")) in collection_ids
                or not HASH.fullmatch(str(item.get("inventorySha256", "")))
                or not HASH.fullmatch(str(item.get("reviewSha256", "")))
                or type(item.get("revision")) is not int or item["revision"] < 0):
            raise Problem("SNAPSHOT_MANIFEST", "Invalid original accession binding.")
        collection_ids.add(item["id"])
        required.update("operator/accessions/" + item["id"] + "/" + name
                        for name in ("accession.json", "inventory.json", "current.json", "reviews/00000000.json"))
    actual_collection_ids = {name.split("/")[2] for name in descriptors
                            if name.startswith("operator/accessions/") and len(name.split("/")) > 3
                            and not name.split("/")[2].startswith(".")}
    # Interrupted private accession stages remain full archive members. Only
    # published ordinary accession roots participate in the selected bindings.
    if collection_ids != actual_collection_ids:
        raise Problem("SNAPSHOT_MANIFEST", "The complete accession inventory differs from its selection.")
    if collection_ids:
        required.update("application/" + name for name in COLLECTION_APPLICATION)
    selected_reports = manifest.get("transferReports", [])
    if not isinstance(selected_reports, list) or len(set(selected_reports)) != len(selected_reports):
        raise Problem("SNAPSHOT_MANIFEST", "Invalid retained transfer report selection.")
    artifact_member = "operator/artifacts.json"
    if artifact_member not in descriptors or descriptors[artifact_member]["bytes"] > BODY_LIMIT:
        raise Problem("SNAPSHOT_MANIFEST", "Missing original artifact registry.")
    registry = p.parse_json(archive.read(artifact_member))
    artifacts = registry.get("artifacts") if isinstance(registry, dict) else None
    if not isinstance(artifacts, list) or not all(isinstance(item, dict) for item in artifacts):
        raise Problem("SNAPSHOT_MANIFEST", "Invalid original artifact registry.")
    actual_reports = [item for item in artifacts if item.get("kind") in {"transfer-inspect-json", "transfer-compare-json"}]
    if set(selected_reports) != {item.get("path") for item in actual_reports}:
        raise Problem("SNAPSHOT_MANIFEST", "Complete transfer report selection differs from its original registry.")
    for item in actual_reports:
        if descriptors.get("operator/" + p.safe_name(item["path"])) != {key: item.get(key) for key in ("bytes", "sha256")}:
            raise Problem("SNAPSHOT_MANIFEST", "A complete transfer report differs from its saved artifact.")
    for name in selected_reports:
        p.safe_name(name)
        if not re.fullmatch(r"packages/transfer-desk/reports/Transfer_(inspect|compare)_[0-9a-f]{64}\.json", name):
            raise Problem("SNAPSHOT_MANIFEST", "Invalid complete transfer report member.")
        required.add("operator/" + name)
    # Bind complete reports to the exact original packages they identify.
    for name in selected_reports:
        member = "operator/" + name
        if member not in descriptors or descriptors[member]["bytes"] > transfers.MAX_REPORT:
            raise Problem("SNAPSHOT_MANIFEST", "A retained complete transfer report is missing or oversized.")
        report = p.parse_json(archive.read(member))
        if report.get("schema") not in {transfers.SCHEMA + ".inspection", transfers.SCHEMA + ".comparison"}:
            raise Problem("SNAPSHOT_MANIFEST", "Invalid original transfer report.")
        for key in ("package", "previousPackage", "currentPackage"):
            if key not in report:
                continue
            value = report[key]
            path = p.safe_name(value["retainedPath"])
            original_member = "operator/" + path
            if not path.startswith("packages/") or descriptors.get(original_member) != {key: value[key] for key in ("bytes", "sha256")}:
                raise Problem("SNAPSHOT_MANIFEST", "A selected original transfer package differs from its complete report.")
            required.add(original_member)
    if any(name.startswith("operator/packages/transfer-desk/") for name in descriptors):
        required.update("application/" + name for name in TRANSFER_APPLICATION)
    for source_group in provider_groups.values():
        provider_names = {"application/" + name for name in source_group}
        if provider_names & set(descriptors):
            required.update(provider_names)
    # The retained destination also requires its provider even if an archive
    # omits every member of that optional source group.
    for name in descriptors:
        match = re.fullmatch(r"operator/operations/([^/]+)/selection\.json", name)
        if match is None or match.group(1).startswith("."):
            continue
        operation_id = identifier(match.group(1))
        if descriptors[name]["bytes"] > BODY_LIMIT:
            raise Problem("SNAPSHOT_LIMIT", "The saved destination selection exceeds its receiving limit.")
        saved = p.parse_json(archive.read(name))
        request_fields = ("id", "provider", "label", "selection", "settings", "configuration", "jobTemplate")
        if (not isinstance(saved, dict) or saved.get("schema") != SCHEMA + ".operation"
                or saved.get("id") != operation_id or saved.get("provider") not in {"roda", "preservica", "libnova", "archivematica"}
                or any(field not in saved for field in request_fields)):
            raise Problem("SNAPSHOT_OPERATION", "The snapshot destination selection is invalid.", member=name)
        selected_review(saved["selection"])
        if p.digest(p.canonical({field: saved[field] for field in request_fields})) != saved.get("requestSha256"):
            raise Problem("SNAPSHOT_OPERATION", "The original destination choices changed.", member=name)
        required.update("application/" + item for item in provider_groups.get(saved["provider"], ()))
    if not required <= set(descriptors):
        raise Problem("SNAPSHOT_MANIFEST", "The complete application/workspace closure is incomplete.")
    for name, expected in descriptors.items():
        sha, size = hashlib.sha256(), 0
        with archive.open(name) as incoming:
            for body in iter(lambda: incoming.read(1024 * 1024), b""):
                size += len(body)
                sha.update(body)
        if {"bytes": size, "sha256": sha.hexdigest()} != expected:
            raise Problem("SNAPSHOT_MEMBER", "A snapshot member differs from its original identity.", member=name)
    return manifest


def export_workspace(app, output):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise Problem("EXISTING_EXPORT", "Choose a new complete-export filename.")
    application_root = Path(__file__).resolve().parent.parent.parent
    stage = None
    with contextlib.ExitStack() as locks:
        collection_only = not app.root.exists()
        if not collection_only:
            locks.enter_context(p.project_lock(app.root))
            project, prepared = p.project_files(app.root)
            current, saved = p.current_review(app.root, prepared)
            selection = {"sourceManifestSha256": project["binding"]["manifestSha256"],
                         "revision": current["revision"], "reviewSha256": current["reviewSha256"]}
        else:
            prepared, saved, selection = {"records": []}, None, None
        if app.accessions.exists():
            locks.enter_context(p.project_lock(app.accessions))
            for child in sorted(app.accessions.iterdir()):
                if child.name.startswith(".") or child.name == "workspace.lock":
                    continue
                collection.ident(child.name)
                locks.enter_context(p.project_lock(child))
        accession_bindings = collection.bindings(app.accessions, True, locked=True)
        with app.guard:
            transfer_reports = [item["path"] for item in app.artifacts
                                if item["kind"] in {"transfer-inspect-json", "transfer-compare-json"}]
        for name in transfer_reports:
            regular(app.control / p.safe_name(name))
        if collection_only and not accession_bindings and not transfer_reports:
            raise Problem("EMPTY_WORKSPACE", "Receive a research source, retain an original collection, or inspect a complete package before exporting.")
        libnova_operations = set()
        archivematica_operations = set()
        for operation_root in sorted(app.operations.iterdir()):
            if operation_root.is_dir() and not operation_root.name.startswith("."):
                _, selected = app.operation(operation_root.name)
                if selected["provider"] == "libnova":
                    libnova_operations.add(operation_root.name)
                elif selected["provider"] == "archivematica":
                    archivematica_operations.add(operation_root.name)
                if (operation_root / "prepared").is_dir():
                    if selected["provider"] in {"libnova", "archivematica"}:
                        producer, _ = selected_provider(selected["provider"])
                        locks.enter_context(producer.lock(operation_root / "prepared"))
                    else:
                        locks.enter_context(p.project_lock(operation_root / "prepared"))
        members = {}
        for name, path in tree_files(app.root).items():
            if name != "workspace.lock":
                members["workspace/" + name] = path
        for name, path in tree_files(app.control).items():
            parts = name.split("/")
            libnova_runtime_lock = (len(parts) >= 3 and parts[0] == "operations"
                and parts[1] in libnova_operations and (
                    parts[2:] == ["prepared", ".libnova.lock"]
                    or len(parts) == 3 and re.fullmatch(r"\.libnova-output-[0-9a-f]{32}\.lock", parts[2])))
            if (name == "server.lock" or name.endswith(("/workspace.lock", "/operation.lock"))
                    or name.startswith("deliveries/") or libnova_runtime_lock
                    or len(parts) == 3 and parts[0] == "operations"
                    and parts[1] in archivematica_operations
                    and re.fullmatch(r"\.archivematica-output-[0-9a-f]{32}\.lock", parts[2])):
                continue
            members["operator/" + name] = path
        source_names = list(APPLICATION)
        for label, source_group in (("Preservica", PRESERVICA_APPLICATION), ("LIBNOVA", LIBNOVA_APPLICATION),
                                    ("Archivematica", ARCHIVEMATICA_APPLICATION), ("Collection accession", COLLECTION_APPLICATION),
                                    ("Transfer inspection", TRANSFER_APPLICATION)):
            present = [(application_root / name).is_file() for name in source_group]
            if any(present):
                if not all(present):
                    raise Problem("APPLICATION_SOURCE", "Install all " + label + " source and guide members before exporting.")
                source_names.extend(source_group)
        for name in source_names:
            path = application_root / name
            regular(path)
            members["application/" + name] = path
        descriptors = {name: file_digest(path) for name, path in sorted(members.items())}
        if sum(x["bytes"] for x in descriptors.values()) > MAX_SNAPSHOT:
            raise Problem("SNAPSHOT_LIMIT", "The full source/workspace snapshot exceeds its receiving limit.")
        with app.guard:
            previous_exports = [{k: x[k] for k in ("id", "name", "bytes", "sha256", "createdAt")}
                                for x in app.artifacts if x["kind"] == "complete-workspace"]
        manifest = {"schema": SNAPSHOT_SCHEMA, "createdAt": p.utc(), "selection": selection,
                    "applicationEntry": "application/research/preservation/workbench.py",
                    "workspacePath": "workspace", "operatorPath": "operator",
                    "sourceRecords": len(prepared["records"]),
                    "includedRecords": sum(x["include"] for x in p.mapped_records(prepared, saved["review"])) if saved else 0,
                    "collectionOnly": collection_only, "collectionBindings": accession_bindings,
                    "transferReports": transfer_reports,
                    "files": descriptors,
                    "previousCompleteExports": previous_exports,
                    "exportHistory": "Prior complete ZIP files are listed by identity. This snapshot contains the current source, retained review revisions and current operation/workspace files."}
        directory(output.parent)
        fd, name = tempfile.mkstemp(prefix=".preservation-export-", dir=output.parent)
        os.close(fd)
        stage = Path(name)
        stage.unlink()
        try:
            with zipfile.ZipFile(stage, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                for name, source in sorted(members.items()):
                    zip_member(archive, name, source, descriptors[name])
                info = zipfile.ZipInfo("MANIFEST.json", date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, p.canonical(manifest))
            with zipfile.ZipFile(stage) as archive:
                snapshot_manifest(archive)
            with open(stage, "rb") as incoming:
                os.fsync(incoming.fileno())
            os.link(stage, output, follow_symlinks=False)
            p.fsync_dir(output.parent)
        finally:
            if stage is not None:
                stage.unlink(missing_ok=True)
    return {"artifact": app.artifact(output, "complete-workspace", selection),
            "selection": selection, "members": len(descriptors) + 1,
            "sourceRecords": manifest["sourceRecords"], "includedRecords": manifest["includedRecords"]}


def receive_workspace(source, output):
    source, output = Path(source).absolute(), Path(output).absolute()
    original = regular(source)
    if original.st_size > MAX_SNAPSHOT:
        raise Problem("SNAPSHOT_LIMIT", "The complete archive exceeds its receiving limit.")
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as incoming_archive:
        opened = os.fstat(incoming_archive.fileno())
        if (not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino)):
            raise Problem("SNAPSHOT_CHANGED", "The original archive changed while opening.")
        stamp = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)

        def unchanged():
            current = os.fstat(incoming_archive.fileno())
            if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns) != stamp:
                raise Problem("SNAPSHOT_CHANGED", "The original archive changed during receiving.")

        sha, length = hashlib.sha256(), 0
        for block in iter(lambda: incoming_archive.read(1024 * 1024), b""):
            length += len(block)
            if length > MAX_SNAPSHOT:
                raise Problem("SNAPSHOT_LIMIT", "The complete archive grew beyond its receiving limit.")
            sha.update(block)
        unchanged()
        identity = {"bytes": length, "sha256": sha.hexdigest()}
        incoming_archive.seek(0)
        with zipfile.ZipFile(incoming_archive) as archive:
            manifest = snapshot_manifest(archive)
            if output.exists() or output.is_symlink():
                if output.is_symlink():
                    raise Problem("EXISTING_RECEIVER", "The receiving directory is a symlink.")
                retained = read_json(output / "RECEIVED.json")
                if retained.get("archive") != identity or retained.get("manifest") != manifest:
                    raise Problem("EXISTING_RECEIVER", "The receiving directory belongs to another original handoff.")
                current = None if manifest.get("collectionOnly", False) else p.show(output / "workspace")
                if current is not None and current["project"]["binding"]["manifestSha256"] != manifest["selection"]["sourceManifestSha256"]:
                    raise Problem("RECEIVED_SOURCE", "The received original source changed.")
                received_accessions = collection.bindings(output / "workspace.operator/accessions", True)
                original_accessions = {item["id"]: item for item in manifest.get("collectionBindings", [])}
                current_accessions = {item["id"]: item for item in received_accessions}
                if not set(original_accessions) <= set(current_accessions) or any(
                        current_accessions[key]["inventorySha256"] != item["inventorySha256"]
                        for key, item in original_accessions.items()):
                    raise Problem("RECEIVED_SOURCE", "The received original accession changed.")
                original_transfer_paths = set()
                for name in manifest.get("transferReports", []):
                    report = p.parse_json(archive.read("operator/" + name))
                    for key in ("package", "previousPackage", "currentPackage"):
                        if key in report:
                            original_transfer_paths.add("operator/" + p.safe_name(report[key]["retainedPath"]))
                for name, expected in manifest["files"].items():
                    retained_path = output / name if name.startswith("application/") else output / "workspace.operator" / name.removeprefix("operator/")
                    if (name.startswith("application/") or name.startswith("operator/packages/transfer-desk/") or name in original_transfer_paths) and file_digest(retained_path) != expected:
                        raise Problem("RECEIVED_APPLICATION", "The received application differs from its original handoff.", member=name)
                unchanged()
                return {"received": True, "reused": True, "directory": str(output),
                        "archive": identity, "status": current}
            directory(output.parent)
            stage = Path(tempfile.mkdtemp(prefix=".preservation-receive-", dir=output.parent))
            try:
                for name, expected in manifest["files"].items():
                    relative = PurePosixPath(p.safe_name(name))
                    parts = relative.parts
                    target = stage.joinpath(*(("workspace.operator",) + parts[1:] if parts[0] == "operator" else parts))
                    directory(target.parent)
                    sha, size = hashlib.sha256(), 0
                    with archive.open(name) as incoming, open(target, "xb") as out:
                        os.chmod(target, 0o600)
                        for body in iter(lambda: incoming.read(1024 * 1024), b""):
                            size += len(body)
                            sha.update(body)
                            out.write(body)
                        out.flush()
                        os.fsync(out.fileno())
                    if {"bytes": size, "sha256": sha.hexdigest()} != expected:
                        raise Problem("RECEIVED_MEMBER", "Received member differs from the original snapshot.", member=name)
                status = None if manifest.get("collectionOnly", False) else p.show(stage / "workspace")
                if status is not None and source_selection(status) != manifest["selection"]:
                    raise Problem("RECEIVED_REVIEW", "The received source/review selection differs.")
                collection.restore_directories(stage / "workspace.operator/accessions")
                if collection.bindings(stage / "workspace.operator/accessions", True) != manifest.get("collectionBindings", []):
                    raise Problem("RECEIVED_REVIEW", "The received accession source/review selection differs.")
                # Application bytes are retained, not imported or executed while receiving an external archive.
                write_json(stage / "RECEIVED.json", {"schema": SCHEMA + ".received",
                    "receivedAt": p.utc(), "archive": identity, "manifest": manifest})
                p.sync_tree(stage)
                unchanged()
                os.rename(stage, output)
                stage = None
                p.fsync_dir(output.parent)
                if status is not None:
                    status["workspace"] = str(output / "workspace")
                return {"received": True, "reused": False, "directory": str(output),
                        "archive": identity, "status": status,
                        "entry": str(output / manifest["applicationEntry"])}
            finally:
                if stage is not None:
                    shutil.rmtree(stage)


def prevent_literal_credentials(value):
    forbidden = {"password", "token", "accesstoken", "refreshtoken", "secret", "secretkey",
                 "apikey", "authorization", "cookie", "cookies", "credentials"}
    if isinstance(value, dict):
        for key, child in value.items():
            compact = re.sub(r"[-_\s]", "", str(key)).casefold()
            if compact in forbidden:
                raise Problem("CREDENTIAL_REFERENCE", "Use the documented environment-variable reference for credentials.",
                              field=key)
            prevent_literal_credentials(child)
    elif isinstance(value, list):
        for child in value:
            prevent_literal_credentials(child)


def validated_destination(app, body):
    request = json.loads(json.dumps(body))
    allowed = {"id", "provider", "label", "selection", "settings", "configuration", "jobTemplate"}
    if not isinstance(request, dict) or set(request) != allowed:
        raise Problem("DESTINATION", "Submit the complete original destination selection.")
    identifier(request["id"])
    selected_review(request["selection"])
    prevent_literal_credentials(request["configuration"])
    if request["provider"] == "preservica":
        producer, client = load_preservica()
        if producer is None:
            raise Problem("APPLICATION_SOURCE", "Install the complete Preservica application source.")
        request["configuration"] = client.validate_configuration(request["configuration"])
        request["settings"] = producer.validate_settings(request["settings"])
    elif request["provider"] == "libnova":
        producer, client = selected_provider("libnova")
        request["configuration"] = client.normalize_configuration(request["configuration"])
        request["settings"] = producer.normalize_mapping(request["settings"])
    elif request["provider"] == "archivematica":
        producer, client = selected_provider("archivematica")
        request["configuration"] = client.normalize_configuration(request["configuration"])
        request["settings"] = producer.normalize_settings(request["settings"])
    elif request["provider"] == "roda":
        roda.validate_agreement(p.canonical(request["settings"]))
        if not isinstance(request["configuration"], dict):
            raise Problem("DESTINATION", "RODA configuration must be a JSON object.")
        # The RODA validator accepts a file. Its private temporary input is removed
        # before any persistent operation/job selection is published.
        with tempfile.TemporaryDirectory(prefix=".configuration-", dir=app.control) as folder:
            path = Path(folder) / "configuration.json"
            write_json(path, request["configuration"])
            roda_client._config(path)
    else:
        raise Problem("DESTINATION", "Select Archivematica, RODA, Preservica or LIBNOVA.")
    return request


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "PreservationWorkbench/1.0"

    @property
    def app(self):
        return self.server.workbench

    def log_message(self, format, *args):
        return

    def base_checks(self, mutation=False):
        hosts = {f"127.0.0.1:{self.app.port}", f"localhost:{self.app.port}"}
        if self.app.port == 80:
            hosts.update({"127.0.0.1", "localhost"})
        if self.headers.get("Host", "") not in hosts:
            raise Problem("HOST", "Use the local operator address printed by the application.")
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + host for host in hosts}:
            raise Problem("ORIGIN", "This request came from another website.")
        if mutation and not secrets.compare_digest(self.headers.get("X-Workspace-Token", ""), self.app.csrf):
            raise Problem("REQUEST_TOKEN", "Refresh this operator tab before sending a change.")

    def response_headers(self, status, length, content_type, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))

    def send_content(self, status, value, content_type="application/json; charset=utf-8", filename=None):
        if isinstance(value, str):
            value = value.encode("utf-8")
        self.response_headers(status, len(value), content_type, filename)
        self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(value)

    def send_json(self, status, value):
        self.send_content(status, p.canonical(value))

    def body(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise Problem("CONTENT_TYPE", "Send an application/json request.")
        if self.headers.get("Transfer-Encoding"):
            raise Problem("CONTENT_LENGTH", "Use a Content-Length for this operator request.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise Problem("CONTENT_LENGTH", "The request length must be an integer.")
        if not 0 < length <= BODY_LIMIT:
            raise Problem("CONTENT_LENGTH", "Operator requests must contain 1 byte to 16 MiB of JSON.")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise Problem("REQUEST_BODY", "The complete request body was not received.")
        value = p.parse_json(raw)
        if not isinstance(value, dict):
            raise Problem("JSON", "The request body must be a JSON object.")
        return value

    def send_error_value(self, error):
        value = failure(error)
        code = value.get("error", "")
        status = 409 if code in {"BUSY", "OPERATION_CONFLICT", "EXISTING_FILE"} or str(error).startswith("STALE_REVISION") else 400
        if isinstance(error, FileNotFoundError):
            status = 404
        self.send_json(status, value)

    def send_download(self, path, item):
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as incoming:
            info = os.fstat(incoming.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != item["bytes"]:
                raise Problem("ARTIFACT_CHANGED", "The saved delivery file changed while opening.")
            sha = hashlib.sha256()
            for body in iter(lambda: incoming.read(1024 * 1024), b""):
                sha.update(body)
            after = os.fstat(incoming.fileno())
            if (sha.hexdigest() != item["sha256"] or
                    (info.st_size, info.st_mtime_ns, info.st_ctime_ns) !=
                    (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                raise Problem("ARTIFACT_CHANGED", "The saved delivery file differs from its original identity.")
            incoming.seek(0)
            content_type = {".zip": "application/zip", ".json": "application/json; charset=utf-8",
                            ".html": "text/html; charset=utf-8", ".csv": "text/csv; charset=utf-8"}.get(
                                Path(item["name"]).suffix.lower(), "application/octet-stream")
            self.response_headers(200, info.st_size, content_type, item["name"])
            self.send_header("X-Content-SHA256", item["sha256"])
            self.end_headers()
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                shutil.copyfileobj(incoming, self.wfile, 1024 * 1024)

    def do_GET(self):
        try:
            self.base_checks()
            request = urlsplit(self.path)
            args = parse_qs(request.query)
            if request.path in {"/", "/workbench.html", "/workbench.js", "/collection_accession.js", "/transfer_inspection.js"}:
                name = "workbench.html" if request.path == "/" else request.path.lstrip("/")
                if name not in STATIC:
                    raise Problem("PATH", "Unknown application asset.")
                path = Path(__file__).with_name(name)
                self.send_content(200, p.read_regular(path.parent, path.name, BODY_LIMIT),
                                  "text/html; charset=utf-8" if name.endswith(".html") else "text/javascript; charset=utf-8")
            elif request.path == "/api/launch":
                if self.app.launch is None:
                    raise Problem("APPLICATION_STARTING", "The original operator is still opening.")
                self.send_json(200, self.app.launch)
            elif request.path == "/api/state":
                self.send_json(200, self.app.state())
            elif request.path == "/api/transfer-report":
                self.send_json(200, self.app.transfer_view(args.get("id", [""])[0],
                    args.get("offset", [0])[0], args.get("q", [""])[0], args.get("changed", ["false"])[0] == "true"))
            elif request.path == "/api/accessions":
                self.send_json(200, {"accessions": collection.bindings(self.app.accessions)})
            elif request.path == "/api/accession":
                self.send_json(200, collection.show(self.app.accession(args.get("id", [""])[0])))
            elif request.path == "/api/preview":
                self.send_json(200, self.app.preview(query=args.get("q", [""])[0],
                    included=args.get("filter", ["all"])[0], offset=args.get("offset", [0])[0]))
            elif request.path == "/api/migration":
                operation_id = args.get("id", [""])[0]
                with self.app.guard:
                    active = self.app.active
                if active:
                    root, selected = self.app.operation(operation_id)
                    progress = {"status": "OPERATOR_RUNNING",
                                "message": "The original operator action is still running. Its saved identifiers remain selected."}
                    if selected["provider"] in {"preservica", "libnova", "archivematica"} and (root / "prepared").is_dir():
                        _, client = selected_provider(selected["provider"])
                        if client is not None:
                            try:
                                progress = client.show(root / "prepared", operation_id)
                            except Exception as error:
                                progress = {"status": "PREPARATION_PENDING", **failure(error)}
                    self.send_json(200, {**selected, "operatorRunning": active, "progress": progress})
                else:
                    self.send_json(200, self.app.migration_status(operation_id))
            elif request.path == "/api/review":
                status = p.show(self.app.root)
                self.send_json(200, {"selection": source_selection(status), "review": status["review"]})
            elif request.path == "/review":
                with p.project_lock(self.app.root):
                    project, prepared = p.project_files(self.app.root)
                    current, saved = p.current_review(self.app.root, prepared)
                    value = p.report_html(prepared["binding"], p.mapped_records(prepared, saved["review"]),
                                          current["revision"], current["reviewSha256"], project.get("sourceProfile"))
                self.send_content(200, value, "text/html; charset=utf-8")
            elif request.path == "/download":
                path, item = self.app.artifact_path(args.get("id", [""])[0])
                self.send_download(path, item)
            else:
                self.send_json(404, {"error": "NOT_FOUND", "message": "Unknown operator route."})
        except Exception as error:
            self.send_error_value(error)

    def do_POST(self):
        try:
            self.base_checks(mutation=True)
            body = self.body()
            path = urlsplit(self.path).path
            if path == "/api/transfer-report":
                if set(body) != {"mode", "selections"} or body["mode"] not in {"inspect", "compare"}:
                    raise Problem("TRANSFER_SELECTION", "Select the complete inspection or ordered comparison.")
                result = self.app.queue("transfer-" + body["mode"], body,
                    lambda job: self.app.transfer_report(body["mode"], body["selections"]))
            elif path == "/api/accession-inspect":
                if set(body) != {"source"}:
                    raise Problem("SOURCE", "Select the complete original source directory.")
                result = self.app.queue("collection-inspect", body,
                    lambda job: self.app.inspect_accession(Path(body["source"]).expanduser().absolute()))
            elif path == "/api/accession-init":
                if set(body) != {"source", "settings", "inventorySha256"}:
                    raise Problem("SOURCE", "Submit the inspected source and its exact inventory digest.")
                selected = collection.settings(body["settings"])
                root = self.app.accession(selected["id"])
                source = Path(body["source"]).expanduser().absolute()
                if self.app.control.resolve().is_relative_to(source.resolve()):
                    raise Problem("SOURCE", "The source cannot contain this operator's mutable control directory.")
                result = self.app.queue("collection-intake", body, lambda job:
                    self.app.initialize_accession(source, root, selected, body["inventorySha256"]))
            elif path == "/api/accession-review":
                if set(body) != {"id", "review", "expectedRevision"}:
                    raise Problem("REVIEW", "Send the complete selected accession review.")
                with self.app.guard:
                    if self.app.active:
                        raise Problem("BUSY", "Finish the current operator action before saving.")
                    result = collection.save_review(self.app.accession(body["id"]), body["review"], body["expectedRevision"])
            elif path == "/api/accession-build":
                if set(body) != {"id", "expectedRevision"} or type(body["expectedRevision"]) is not int:
                    raise Problem("REVIEW", "Choose the saved accession and review revision.")
                accession_id = collection.ident(body["id"])
                result = self.app.queue("collection-transfer", body, lambda job:
                    self.app.build_accession(accession_id, body["expectedRevision"]))
            elif path == "/api/init":
                if set(body) != {"source", "prefix", "organization", "contact"}:
                    raise Problem("SOURCE", "Source intake requires its path, prefix, organization and contact.")
                source = Path(body["source"]).expanduser().absolute()
                result = self.app.queue("source-intake", body, lambda job: p.initialize(
                    source, self.app.root, body["prefix"], organization=body["organization"], contact=body["contact"]))
            elif path == "/api/review":
                if set(body) != {"review", "expectedRevision"}:
                    raise Problem("REVIEW", "Submit the complete review and its expected saved revision.")
                result = p.save_review(self.app.root, body["review"], body["expectedRevision"])
                result["status"] = p.show(self.app.root)
            elif path == "/api/preview":
                allowed = {"review", "query", "filter", "offset"}
                if set(body) - allowed:
                    raise Problem("PREVIEW", "Unknown record-preview field.")
                result = self.app.preview(body.get("review"), body.get("query", ""),
                                          body.get("filter", "all"), body.get("offset", 0))
            elif path == "/api/package":
                if set(body) != {"selection"}:
                    raise Problem("PACKAGE", "Choose the saved source and review revision.")
                selection = selected_review(body["selection"])
                result = self.app.queue("native-package", {"selection": selection},
                                        lambda job: self.app.build_package(selection))
            elif path == "/api/prepare":
                request = validated_destination(self.app, body)
                arguments = {"operationId": request["id"], "provider": request["provider"],
                             "selection": request["selection"], "requestSha256": p.digest(p.canonical(request))}
                result = self.app.queue("destination-preparation", arguments,
                                        lambda job: self.app.prepare_migration(request))
            elif path == "/api/resume-preparation":
                if set(body) != {"operationId"}:
                    raise Problem("OPERATION", "Select the original saved destination.")
                _, selected = self.app.operation(body["operationId"])
                request = {k: selected[k] for k in ("id", "provider", "label", "selection",
                                                   "settings", "configuration", "jobTemplate")}
                result = self.app.queue("destination-preparation",
                    {"operationId": selected["id"], "provider": selected["provider"],
                     "selection": selected["selection"], "requestSha256": selected["requestSha256"]},
                    lambda job: self.app.prepare_migration(request))
            elif path in {"/api/run", "/api/refresh", "/api/reconcile", "/api/decide"}:
                action = path.rsplit("/", 1)[1]
                allowed = {"operationId", "evidence"} if action in {"reconcile", "decide"} else {"operationId"}
                if set(body) != allowed:
                    raise Problem("OPERATION", "Submit the selected original operation and its requested action.")
                operation_id = identifier(body["operationId"])
                self.app.operation(operation_id)
                evidence = body.get("evidence")
                if evidence is not None:
                    prevent_literal_credentials(evidence)
                result = self.app.queue("migration-" + action,
                    {"operationId": operation_id, "evidence": evidence} if evidence is not None else {"operationId": operation_id},
                    lambda job: self.app.continue_migration(operation_id, action, evidence))
            elif path == "/api/export-destination":
                if set(body) != {"operationId"}:
                    raise Problem("OPERATION", "Choose the saved Archivematica receiving operation.")
                operation_id = identifier(body["operationId"])
                operation_root, selected = self.app.operation(operation_id)
                if selected["provider"] != "archivematica":
                    raise Problem("DESTINATION", "Choose an Archivematica receiving operation.")
                prepared = operation_root / "prepared"
                if not prepared.is_dir():
                    raise Problem("PREPARATION_PENDING", "Complete the saved source preparation before exporting.")
                def export_destination(job):
                    producer, _ = selected_provider(selected["provider"])
                    output = self.app.deliveries / ("Archivematica_Complete_" + operation_id + "_" + job["id"] + ".zip")
                    received = producer.export(prepared, output)
                    return {"artifact": self.app.artifact(output, "archivematica-complete-destination",
                                                         selected["selection"], operation_id),
                            "operationId": operation_id, "receiving": received}
                result = self.app.queue("destination-export", {"operationId": operation_id}, export_destination)
            elif path == "/api/recover-export":
                if set(body) != {"jobId"}:
                    raise Problem("EXPORT_JOB", "Choose the original export job ID.")
                result = self.app.recover_export(identifier(body["jobId"]))
            elif path == "/api/export":
                if body:
                    raise Problem("EXPORT", "Export uses the current complete saved workspace.")
                def export_job(job):
                    output = self.app.deliveries / ("Research_Preservation_Complete_" + job["id"] + ".zip")
                    return export_workspace(self.app, output)
                result = self.app.queue("complete-export", {}, export_job)
            else:
                self.send_json(404, {"error": "NOT_FOUND", "message": "Unknown operator route."})
                return
            self.send_json(202 if result.get("queued") else 200, result)
        except Exception as error:
            self.send_error_value(error)


MANAGED_BINDING_SCHEMA = "stellar-forge.preservation-workbench-binding.v1"
MANAGED_STARTUP_SCHEMA = "stellar-forge.preservation-workbench-launch.v1"


def managed_binding(workspace):
    """Read the original source/workspace identity without opening an operator."""
    if sys.version_info < (3, 11):
        raise Problem("PYTHON_VERSION", "Choose the existing Python 3.11 or later executable.")
    supplied = Path(workspace).absolute()
    if supplied.is_symlink():
        raise Problem("WORKSPACE", "Choose the original workspace directory.")
    root = supplied.resolve()
    parent = root.parent
    if not parent.is_dir():
        raise Problem("WORKSPACE_PARENT", "Choose an existing private parent for this workspace.")
    parent_info = parent.stat()
    identity = {"parent": str(parent), "parentDevice": str(parent_info.st_dev),
                "parentInode": str(parent_info.st_ino), "state": "awaiting-source"}
    if root.exists():
        if not root.is_dir():
            raise Problem("WORKSPACE", "Choose a retained preservation workspace or a new directory path.")
        before = root.stat()
        project_file = file_digest(root / "project.json", BODY_LIMIT)
        prepared_file = file_digest(root / "prepared.json", MAX_SNAPSHOT_MEMBER)
        project, prepared = p.project_files(root)
        after = root.stat()
        if ((before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
                or project_file != file_digest(root / "project.json", BODY_LIMIT)
                or prepared_file != file_digest(root / "prepared.json", MAX_SNAPSHOT_MEMBER)):
            raise Problem("WORKSPACE_CHANGED", "The selected source workspace changed while reading.")
        identity.update({"state": "initialized", "device": str(after.st_dev), "inode": str(after.st_ino),
                         "projectSha256": project_file["sha256"],
                         "preparedSha256": prepared_file["sha256"],
                         "sourceBindingSha256": p.digest(p.canonical(project["binding"])),
                         "sourceRecords": len(prepared["records"])})
    source_root = Path(__file__).resolve().parents[2]
    names = list(APPLICATION)
    for label, source_group in (("Preservica", PRESERVICA_APPLICATION), ("LIBNOVA", LIBNOVA_APPLICATION),
                                    ("Archivematica", ARCHIVEMATICA_APPLICATION), ("Collection accession", COLLECTION_APPLICATION),
                                    ("Transfer inspection", TRANSFER_APPLICATION)):
        optional = [(source_root / name).exists() for name in source_group]
        if any(optional):
            if not all(optional):
                raise Problem("APPLICATION_SOURCE", "Retain the complete original " + label + " source and guides.")
            names.extend(source_group)
    hashes = {name: file_digest(source_root / name, BODY_LIMIT)["sha256"] for name in names}
    current_parent = parent.stat()
    if (parent_info.st_dev, parent_info.st_ino) != (current_parent.st_dev, current_parent.st_ino):
        raise Problem("WORKSPACE_CHANGED", "The selected workspace parent changed while reading.")
    value = {"schema": MANAGED_BINDING_SCHEMA, "workspace": str(root), "workspaceIdentity": identity,
             "sourceRoot": str(source_root), "source": hashes,
             "python": {"executable": os.path.realpath(sys.executable),
                        "version": list(sys.version_info[:3])}}
    return value | {"sha256": p.digest(p.canonical(value))}


def serve(workspace, port=8785, expected_binding=None):
    if type(port) is not int or not 0 <= port <= 65535:
        raise Problem("PORT", "Choose a local port from 0 through 65535.")
    selected = None
    if expected_binding is not None:
        if not isinstance(expected_binding, str) or not HASH.fullmatch(expected_binding):
            raise Problem("MANAGED_BINDING", "Use the original reviewed workspace binding SHA-256.")
        selected = managed_binding(workspace)
        if selected["sha256"] != expected_binding:
            raise Problem("MANAGED_BINDING_CHANGED", "The selected workspace, source or Python changed after review.")
        workspace = selected["workspace"]
    app = Workbench(workspace)
    server = None
    previous_signals = {}
    interrupted = False

    def interrupt(signum, frame):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise KeyboardInterrupt

    try:
        if selected is not None and managed_binding(workspace)["sha256"] != expected_binding:
            raise Problem("MANAGED_BINDING_CHANGED", "The workspace changed before its original operator opened.")
        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous_signals[signum] = signal.getsignal(signum)
                signal.signal(signum, interrupt)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        server.workbench = app
        server.daemon_threads = False
        app.port = server.server_address[1]
        origin = "http://127.0.0.1" + (f":{app.port}" if app.port != 80 else "")
        app.launch = {"application": SCHEMA, "workspace": str(app.root), "url": origin,
                      "pid": os.getpid(), "instanceId": app.instance_id}
        if selected is not None:
            app.launch = {"schema": MANAGED_STARTUP_SCHEMA, "status": "PRESERVATION_WORKBENCH_READY",
                          **app.launch, "bindingSha256": selected["sha256"],
                          "workspaceIdentity": selected["workspaceIdentity"],
                          "sourceRoot": selected["sourceRoot"], "source": selected["source"],
                          "python": selected["python"]}
        print(json.dumps(app.launch), flush=True)
        server.serve_forever(poll_interval=0.25)
    finally:
        try:
            try:
                if server is not None:
                    server.server_close()
            finally:
                app.close()
        finally:
            for signum, handler in previous_signals.items():
                signal.signal(signum, handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Research preservation operator workbench")
    commands = parser.add_subparsers(dest="command", required=True)
    web = commands.add_parser("serve", help="Open one retained workspace in the local browser")
    web.add_argument("--workspace", required=True)
    web.add_argument("--port", type=int, default=8785)
    web.add_argument("--expected-binding", help="Original reviewed managed binding SHA-256")
    binding = commands.add_parser("binding", help="Read original workspace, source and selected Python identity")
    binding.add_argument("--workspace", required=True)
    receiving = commands.add_parser("receive", help="Receive a complete operator application/workspace")
    receiving.add_argument("--source", required=True)
    receiving.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "serve":
        serve(args.workspace, args.port, args.expected_binding)
    elif args.command == "binding":
        print(json.dumps(managed_binding(args.workspace), ensure_ascii=False))
    else:
        print(json.dumps(receive_workspace(args.source, args.output), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (Problem, p.PreservationError, roda_client.RodaError, OSError, ValueError) as error:
        print(json.dumps(failure(error), ensure_ascii=False), file=__import__("sys").stderr)
        raise SystemExit(2)
