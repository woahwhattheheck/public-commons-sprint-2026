"""Bind Eco Investigations to the original Upper Savannah Operator and Workspace.

The native workspace owns datasets, model selections, output registries and tasks.
This module keeps only investigation state and exact plan-to-native-task bindings.
It performs no model calculation and creates no replacement native job queue.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
import errno
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import tempfile
import threading
import uuid
from typing import Callable, Iterable

from model.common import digest as native_digest, file_digest, identifier, read_json
from .adapters import CallbackGateway, StoreBackedRepository
from .common import IntelligenceError, digest, dumps, now, public_metadata
from .engine import Engine
from .provider import Assistant, ProviderConfig
from .schemas import Action
from .store import Store

FORMAT = "upstate.eco-investigations/v1"
BINDING_TABLE = """
CREATE TABLE IF NOT EXISTS upstate_native_bindings (
    tenant TEXT NOT NULL, plan_id TEXT NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (tenant, plan_id)
);
CREATE TABLE IF NOT EXISTS upstate_native_task_receipts (
    tenant TEXT NOT NULL, task_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    body TEXT NOT NULL, observed_at TEXT NOT NULL,
    PRIMARY KEY (tenant, task_id, source_sha256)
);
"""


def _copy(value):
    return json.loads(dumps(value))


def _member(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise IntelligenceError("The original source member is invalid.", 409)
    member = PurePosixPath(value)
    if not member.parts or member.is_absolute() or any(p in (".", "..") for p in member.parts) or str(member) != value:
        raise IntelligenceError("The original source member must be canonical and relative.", 409)
    return member


def _inside(root, value, *, existing=False):
    root = Path(root).resolve(strict=True)
    path = Path(value)
    path = path if path.is_absolute() else root / path
    resolved = path.resolve(strict=existing)
    if not resolved.is_relative_to(root):
        raise IntelligenceError("The registered source leaves its original workspace.", 403)
    if existing and (not resolved.is_file() or path.is_symlink()):
        raise IntelligenceError("The registered source must be a retained regular file.", 409)
    return resolved


def _identity(body):
    if not isinstance(body, dict):
        raise IntelligenceError("The original file descriptor is missing.", 409)
    size, sha = body.get("bytes"), body.get("sha256")
    if (isinstance(size, bool) or not isinstance(size, int) or size < 0
            or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha)):
        raise IntelligenceError("The original file descriptor needs its byte length and SHA-256.", 409)
    return size, sha


def _verify(path, body):
    size, sha = _identity(body)
    if path.stat().st_size != size or file_digest(path) != sha:
        raise IntelligenceError("The selected file differs from its original registered bytes.", 409)
    return path


def _record_public(row):
    return public_metadata({k: v for k, v in row.items() if k != "_upstate"})


def _dataset_id(kind, value):
    return kind + "-" + native_digest(value)


def _registered(value, trail=()):
    """Visit every declared descriptor, including descriptors nested in summaries."""
    if isinstance(value, dict):
        if {"path", "bytes", "sha256"}.issubset(value):
            _identity(value)
            yield trail, value
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                yield from _registered(item, trail + (str(key),))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _registered(item, trail + (str(index),))


@dataclass(frozen=True)
class NativeAction:
    """A host-selected original operation, never supplied by a browser or provider.

    build_payload(workspace, Action, paired_payload_or_none, context) must be a
    pure call to the host's real validated payload builder. It returns the exact
    original Operator action payload. No native work starts in this callback.
    catalog(workspace_key, workspace), when supplied for an ensemble, returns the
    complete original normalized ensemble records with original IDs and job_id.
    """
    kind: str
    operator_action: str
    description: str
    build_payload: Callable
    catalog: Callable | None = None

    def __post_init__(self):
        if self.kind not in {"run_job", "ensemble", "calibration"}:
            raise ValueError("NativeAction kind must be run_job, ensemble or calibration.")
        if not self.operator_action or not self.description or not callable(self.build_payload):
            raise ValueError("A native method needs its actual action, description and payload builder.")
        if self.catalog is not None and not callable(self.catalog):
            raise ValueError("The native catalog must be a server callable.")


class UpstateEngine(Engine):
    """Native plans use stable project identity across original workspace restore."""
    def __init__(self, repository, store, *, gateway, experiments=None):
        super().__init__(repository, store, gateway=gateway)
        self.experiments = experiments

    def registry_source(self, tenant, kind, row):
        workspace = self.repo.owner.operator.ws(tenant)
        record = public_metadata(row)
        record.pop("tenant_id", None)
        scope = {"schema": "upstate.project-record/v1",
                 "project_id": workspace.project["id"]}
        identity = {"scope": scope, "kind": kind, "record": record}
        return {"registry": kind, "id": row["id"], "sha256": digest(identity),
                "project_scope": scope}

    def verify_sources(self, tenant, sources):
        for source in sources:
            scope = source.get("project_scope")
            if scope is None:
                super().verify_sources(tenant, [source])
                continue
            workspace = self.repo.owner.operator.ws(tenant)
            if (scope != {"schema": "upstate.project-record/v1",
                          "project_id": workspace.project["id"]}
                    or source.get("registry") not in {"job", "ensemble"}):
                raise IntelligenceError("This plan belongs to a different original project.", 403)
            row = self.repo.row(tenant, source["registry"], source["id"])
            actual = self.registry_source(tenant, source["registry"], row)
            if actual["sha256"] != source["sha256"]:
                raise IntelligenceError("The original native record changed after this plan was prepared.", 409)

    def prepare(self, tenant, sid, action):
        if action.kind == "ensemble" and self.experiments is not None:
            return self.experiments.prepare(self, tenant, sid, action)
        if action.native_experiment_id is not None:
            raise IntelligenceError("Enable the installed original Scenario experiments binding.", 503)
        if action.kind not in {"run_job", "ensemble"}:
            return super().prepare(tenant, sid, action)
        self.store.authorize(tenant, sid)
        self.gateway.check(action.kind)
        job = public_metadata(self.repo.row(tenant, "job", action.job_id or ""))
        sources = [self.registry_source(tenant, "job", job)]
        context = {"job": job}
        if action.kind == "run_job":
            if str(job.get("status", "")).lower() in {
                    "running", "queued", "complete", "completed", "succeeded", "success"}:
                raise IntelligenceError("Open the active or completed native run, or select a new retained scenario.", 409)
        else:
            keys = sorted(action.parameter_grid)
            if not keys or any(not action.parameter_grid[key] for key in keys):
                raise IntelligenceError("Supply nonempty parameter value lists.")
            count = 1
            for key in keys:
                count *= len(action.parameter_grid[key])
            if count > action.max_members:
                raise IntelligenceError("The selected parameter grid exceeds its requested max_members.")
            context["members"] = count
            context["existing_ensembles"] = [
                row["id"] for row in self.repo.inventory(tenant)["ensembles"]
                if row.get("job_id") == job["id"]]
        result = self.store.put_plan(tenant, sid, {
            "action": action.model_dump(exclude_none=True), "sources": sources, "context": context})
        self.store.event(tenant, sid, "plan_prepared", {
            "plan_id": result["id"], "kind": action.kind})
        return result


class ProjectStore(Store):
    """The original Store in a portable project namespace and workspace directory.

    Every connection holds a shared original .workspace.lock through commit and
    close. The original portable backup takes that lock exclusively; it therefore
    receives a closed, checkpointed SQLite database along with the whole workspace.
    """
    def __init__(self, owner, workspace_key, path):
        self.owner, self.workspace_key = owner, workspace_key
        project_id = owner.operator.ws(workspace_key).project["id"]
        try:
            valid_project = isinstance(project_id, str) and str(uuid.UUID(project_id)) == project_id
        except (ValueError, AttributeError):
            valid_project = False
        if not valid_project:
            raise IntelligenceError("The original workspace project UUID is invalid.", 409)
        self.project_id = project_id
        self.namespace = "project:" + self.project_id
        super().__init__(path)

    def storage_tenant(self, tenant):
        ws = self.owner.operator.ws(self.workspace_key)
        if ws.project["id"] != self.project_id or tenant not in {self.workspace_key, self.namespace}:
            raise IntelligenceError("This investigation belongs to another original project.", 403)
        return self.namespace

    @contextmanager
    def workspace_guard(self):
        ws = self.owner.operator.ws(self.workspace_key)
        self.storage_tenant(self.workspace_key)
        with (ws.root / ".workspace.lock").open("a+b") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    @contextmanager
    def db(self):
        with self.workspace_guard():
            with super().db() as db:
                yield db

    def _public(self, row):
        result = dict(row)
        if "tenant" in result:
            result["tenant"] = self.workspace_key
        if "plans" in result:
            result["plans"] = [self._public(plan) for plan in result["plans"]]
        return result

    def create_session(self, tenant, title):
        return self._public(super().create_session(self.storage_tenant(tenant), title))

    def sessions(self, tenant):
        return [self._public(row) for row in super().sessions(self.storage_tenant(tenant))]

    def session(self, tenant, sid):
        return self._public(super().session(self.storage_tenant(tenant), sid))

    def authorize(self, tenant, sid):
        return super().authorize(self.storage_tenant(tenant), sid)

    def get_evidence(self, tenant, sid, eid):
        return super().get_evidence(self.storage_tenant(tenant), sid, eid)

    def event(self, tenant, sid, kind, body):
        return super().event(self.storage_tenant(tenant), sid, kind, body)

    def evidence(self, tenant, sid, body):
        return super().evidence(self.storage_tenant(tenant), sid, body)

    def put_plan(self, tenant, sid, body):
        return self._public(super().put_plan(self.storage_tenant(tenant), sid, body))

    def plan(self, tenant, pid):
        return self._public(super().plan(self.storage_tenant(tenant), pid))

    def begin_plan(self, tenant, pid):
        return super().begin_plan(self.storage_tenant(tenant), pid)

    def finish_plan(self, tenant, pid, status, result):
        return super().finish_plan(self.storage_tenant(tenant), pid, status, result)

    def request(self, tenant, sid, rid):
        return super().request(self.storage_tenant(tenant), sid, rid)

    def finish_request(self, tenant, sid, rid, value, failed=False):
        return super().finish_request(self.storage_tenant(tenant), sid, rid, value, failed)


class UpstateRepository(StoreBackedRepository):
    """Read the original workspace; materialize named CAS views only on selection."""
    def __init__(self, owner):
        self.owner = owner
        self._scope = ContextVar("upstate_investigation_read_scope", default=None)
        super().__init__(owner._records, owner._artifacts,
                         lambda tenant: owner.operator.ws(tenant).root)


    @contextmanager
    def read_scope(self, tenant):
        """One synchronous read snapshot; never retained across queued mutations."""
        ws = self.owner.operator.ws(tenant)
        identity = (tenant, str(ws.root.resolve()), native_digest(ws.project))
        current = self._scope.get()
        if current is not None and current["identity"] == identity:
            yield self
            return
        token = self._scope.set({"identity": identity, "memo": {}})
        try:
            yield self
        finally:
            self._scope.reset(token)

    def _memo(self, tenant, group, key, loader, *, detached=True):
        scope = self._scope.get()
        if scope is None or scope["identity"][0] != tenant:
            return loader()
        bucket = scope["memo"].setdefault(group, {})
        if key not in bucket:
            bucket[key] = deepcopy(loader())
        return deepcopy(bucket[key]) if detached else bucket[key]

    def _records(self, tenant, kind):
        with self.read_scope(tenant):
            return self._memo(
                tenant, "validated_records", kind,
                lambda: super(UpstateRepository, self)._records(tenant, kind),
            )

    def row(self, tenant, kind, object_id):
        with self.read_scope(tenant):
            if kind != "job":
                index = self._memo(
                    tenant, "record_indexes", kind,
                    lambda: {row["id"]: row for row in self._records(tenant, kind)},
                    detached=False,
                )
                if not isinstance(object_id, str) or object_id not in index:
                    raise IntelligenceError("Registered object not found for tenant.", 404)
                return deepcopy(index[object_id])

            def selected():
                ws = self.owner.operator.ws(tenant)
                if not isinstance(object_id, str) or not re.fullmatch(r"[0-9a-f]{64}", object_id):
                    raise IntelligenceError("Registered object not found for tenant.", 404)
                path = ws.root / "runs" / object_id / "run.json"
                if not path.is_file():
                    raise IntelligenceError("Registered object not found for tenant.", 404)
                rows = list(self.owner._jobs(tenant, ws, job_ids=(object_id,)))
                if len(rows) != 1 or rows[0].get("id") != object_id or rows[0].get("tenant_id") != tenant:
                    raise IntelligenceError("The original run registry changed identity.", 409)
                return rows[0]

            return self._memo(tenant, "selected_jobs", object_id, selected)

    def _artifact_rows(self, tenant, job_id):
        with self.read_scope(tenant):
            return self._memo(
                tenant, "validated_artifacts", job_id,
                lambda: super(UpstateRepository, self)._artifact_rows(tenant, job_id),
            )

    def inventory(self, tenant):
        with self.read_scope(tenant):
            return self._inventory(tenant)

    def _inventory(self, tenant):
        self.owner.operator.ws(tenant)
        result = {"tenant_id": tenant, "counts": {}}
        for kind, table in (("dataset", "datasets"), ("job", "jobs"),
                            ("aoi", "aois"), ("ensemble", "ensembles")):
            result[table] = [_record_public(row) for row in self._records(tenant, kind)]
            result["counts"][table] = len(result[table])
        return result

    def path(self, tenant, ref):
        with self.read_scope(tenant):
            return self._path(tenant, ref)

    def _path(self, tenant, ref):
        self.owner.operator.ws(tenant)
        if ref.get("kind") == "dataset":
            row = self.row(tenant, "dataset", str(ref.get("id", "")))
        elif ref.get("kind") == "artifact":
            row = next((item for item in self._artifact_rows(tenant, str(ref.get("id", "")))
                        if item["member"] == ref.get("member")), None)
            if row is None:
                raise IntelligenceError("The selected artifact is absent from the native registry.", 404)
        else:
            raise IntelligenceError("Select a registered dataset or native artifact.")
        ws = self.owner.operator.ws(tenant)
        _inside(ws.root, row["path"])
        self.owner._materialize(tenant, row)
        path = _inside(ws.root, row["path"], existing=True)
        if row.get("bytes") is not None:
            _verify(path, row)
        elif file_digest(path) != row["sha256"]:
            raise IntelligenceError("The selected scientific export differs from its registered hash.", 409)
        return path, public_metadata(row.get("metadata") or {})

    def artifacts(self, tenant, job_id):
        with self.read_scope(tenant):
            return self._artifacts(tenant, job_id)

    def _artifacts(self, tenant, job_id):
        """Complete manifest inventory; selected analysis verifies actual file hashes.

        Opening a run should enumerate its whole declared output registry without
        rereading every multi-gigabyte raster. Missing files remain visible.
        """
        ws = self.owner.operator.ws(tenant)
        row = _record_public(self.row(tenant, "job", job_id))
        files = []
        for item in self._artifact_rows(tenant, job_id):
            value = {
                "kind": "artifact", "id": job_id, "member": item["member"],
                "bytes": item["bytes"], "sha256": item["sha256"],
                "metadata": public_metadata(item.get("metadata") or {}),
            }
            try:
                path = _inside(ws.root, item["path"], existing=True)
                size = path.stat().st_size
                value.update(availability="present" if size == item["bytes"] else "length_changed",
                             observed_bytes=size)
            except FileNotFoundError:
                value["availability"] = "absent"
            except IntelligenceError as error:
                value.update(availability="unavailable", error=str(error))
            files.append(value)
        return {
            "job": row, "files": files, "registered_files": len(files),
            "present_files": sum(item["availability"] == "present" for item in files),
            "record_sha256": digest(row),
            "file_identity": "Original registered SHA-256; selected analysis verifies retained bytes.",
        }


class UpstateInvestigations:
    """One binding per existing Operator; tenant keys always resolve through ws()."""
    def __init__(self, operator, *, state_directory=None, dataset_providers=(),
                 provider_config=None, provider_transport=None, native_actions=(),
                 native_experiments=False):
        if not all(callable(getattr(operator, name, None))
                   for name in ("ws", "submit", "task", "task_list")):
            raise TypeError("Select the original Upper Savannah Operator instance.")
        self.operator = operator
        self.root = Path(state_directory) if state_directory is not None else None
        if self.root is not None:
            if self.root.is_symlink():
                raise ValueError("Investigation state needs its original directory.")
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.root = self.root.resolve(strict=True)
        self.experiments = None
        if native_experiments:
            from .upstate_experiments import OriginalExperiments
            self.experiments = OriginalExperiments(operator)
        self.providers = tuple(dataset_providers) + (
            (self.experiments.records,) if self.experiments is not None else ())
        if not all(callable(provider) for provider in self.providers):
            raise TypeError("Dataset providers must be server callables.")
        self.provider_config = provider_config if provider_config is not None else ProviderConfig.env()
        self.provider_transport = provider_transport
        self._lock = threading.RLock()
        self._contexts = {}
        run = NativeAction(
            "run_job", "run.start",
            "Original Upper Savannah Workspace.run over the retained InVEST run selection.",
            lambda ws, action, paired, context: {"run_id": identifier(action.job_id)},
        )
        self.actions = {run.kind: run}
        for method in (*native_actions, *((self.experiments.method,) if self.experiments is not None else ())):
            if not isinstance(method, NativeAction):
                raise TypeError("native_actions must contain NativeAction instances.")
            if method.kind in self.actions:
                raise ValueError("A native method is already connected: " + method.kind)
            self.actions[method.kind] = method
        self.repository = UpstateRepository(self)
        self.gateway = CallbackGateway(
            self._submit, self._lookup, {kind: method.description for kind, method in self.actions.items()})

    def _context(self, tenant):
        ws = self.operator.ws(tenant)
        if not isinstance(tenant, str) or not re.fullmatch(r"[0-9a-f]{64}", tenant):
            raise IntelligenceError("Select the original registered workspace key.", 404)
        identity = (str(ws.root.resolve()), native_digest(ws.project))
        with self._lock:
            current = self._contexts.get(tenant)
            if current is not None:
                if current["identity"] != identity:
                    raise IntelligenceError("The registered workspace identity changed.", 409)
                return current
            directory = self.root / tenant if self.root is not None else ws.root / "intelligence"
            if directory.is_symlink():
                raise IntelligenceError("The original investigation state directory changed.", 409)
            directory.mkdir(mode=0o700, exist_ok=True)
            path = directory / "investigations.sqlite3"
            if path.is_symlink():
                raise IntelligenceError("The original investigation state file changed.", 409)
            store = ProjectStore(self, tenant, path)
            with store.db() as db:
                db.executescript(BINDING_TABLE)
            engine = UpstateEngine(self.repository, store, gateway=self.gateway,
                                   experiments=self.experiments)
            current = {"identity": identity, "engine": engine, "store": store,
                       "assistant": Assistant(engine, self.provider_config, self.provider_transport)}
            self._contexts[tenant] = current
            return current

    def engine(self, workspace_key):
        return self._context(workspace_key)["engine"]

    def assistant(self, workspace_key):
        return self._context(workspace_key)["assistant"]

    def storage_tenant(self, workspace_key):
        return self._context(workspace_key)["store"].storage_tenant(workspace_key)

    def state_path(self, workspace_key):
        """Server-only source for the original complete export/receiving adapter."""
        return self._context(workspace_key)["store"].path

    def experiment_results(self, workspace_key, experiment_id, *, offset=0, limit=100):
        """The original complete result page, with original authenticated downloads."""
        if self.experiments is None:
            raise IntelligenceError("Install the original Scenario experiments integration.", 503)
        self.operator.ws(workspace_key)
        return self.experiments.page(workspace_key, experiment_id, offset=offset, limit=limit)


    def _native_rows(self, tenant, ws, family):
        """Enumerate just one original registry, retaining its native validation."""
        def read():
            if family in {"sources", "observations", "observation_comparisons"}:
                folder = family.replace("_", "-")
                return ws.sources() if family == "sources" else ws._list(folder)
            filename = {"grids": "grid.json", "comparisons": "comparison.json"}[family]
            records = []
            for path in sorted((ws.root / family).glob("*/" + filename)):
                key = identifier(path.parent.name)
                _inside(ws.root, path, existing=True)
                if callable(getattr(ws, "retained_item", None)):
                    record = ws.retained_item(family, key)
                else:
                    record = read_json(path)
                    if record.get("id") != key:
                        raise IntelligenceError("The original native registry changed identity.", 409)
                records.append(record)
            return records
        return self.repository._memo(tenant, "native_registries", family, read)

    def _native_item(self, tenant, ws, family, key):
        key = identifier(key)
        def read():
            if family in {"profiles", "scenarios"}:
                return ws._get(family, key)
            path = ws.root / family / key / "grid.json"
            if not path.is_file():
                return None
            _inside(ws.root, path, existing=True)
            if callable(getattr(ws, "retained_item", None)):
                return ws.retained_item(family, key)
            value = read_json(path)
            if value.get("id") != key:
                raise IntelligenceError("The original native registry changed identity.", 409)
            return value
        return self.repository._memo(tenant, "native_items", (family, key), read)

    def _native_run(self, tenant, ws, key):
        key = identifier(key)
        def read():
            _inside(ws.root, ws.root / "runs" / key / "run.json", existing=True)
            value = ws.inspect_run(key)
            if value.get("id") != key:
                raise IntelligenceError("The original run registry changed identity.", 409)
            return value
        return self.repository._memo(tenant, "native_runs", key, read)

    def _source_rows(self, tenant, ws):
        for collection in self._native_rows(tenant, ws, "sources"):
            collection_sha = native_digest(collection)
            collection_id = identifier(collection["id"])
            for entry in collection.get("entries", []):
                source_id = entry["id"]
                if not isinstance(source_id, str) or not source_id:
                    raise IntelligenceError("An original source ID is invalid.", 409)
                view = ws.root / "source-views" / collection_id / native_digest(source_id)
                bodies = [("primary", entry["body"])] + [
                    ("companion", body) for body in entry.get("companions", [])]
                members = set()
                for role, body in bodies:
                    size, sha = _identity(body)
                    member = str(_member(body.get("view_path", body["filename"])))
                    if member in members:
                        raise IntelligenceError("The original source has duplicate view members.", 409)
                    members.add(member)
                    binding = {"collection_id": collection_id, "source_id": source_id,
                               "member": member, "role": role}
                    yield {
                        "id": _dataset_id("source", binding), "tenant_id": tenant,
                        "title": entry.get("title", source_id) + (" / " + member if role != "primary" else ""),
                        "path": str(view.joinpath(*PurePosixPath(member).parts)),
                        "bytes": size, "sha256": sha,
                        "_upstate": {"kind": "source", **binding},
                        "metadata": {
                            "native_kind": "retained_source", "source_binding": binding,
                            "collection": {k: v for k, v in collection.items() if k != "entries"},
                            "source": entry, "selected_member": body,
                            "source_record_sha256": collection_sha,
                        },
                    }

    def _observation_rows(self, tenant, ws):
        for record in self._native_rows(tenant, ws, "observations"):
            key = identifier(record["id"])
            body = record["original"]
            size, sha = _identity(body)
            filename = str(_member(body["filename"]))
            path = ws.root / "source-views" / "observations" / key / filename
            metadata = {k: v for k, v in record.items() if k != "rows"}
            yield {
                "id": "observation-" + key, "tenant_id": tenant,
                "title": record.get("metadata", {}).get("title", "Retained observations"),
                "path": str(path), "bytes": size, "sha256": sha,
                "_upstate": {"kind": "observation", "observation_id": key},
                "metadata": {
                    "native_kind": "retained_observation_table", "observation_id": key,
                    "native_record": metadata, "row_count": len(record.get("rows", [])),
                    "source_record_sha256": native_digest(record),
                    "interpretation": "Original values and qualifiers; native annual-load admission remains in the retained observation record.",
                },
            }

    def _derived_rows(self, tenant, ws):
        for family in ("grids", "comparisons", "observation_comparisons"):
            for record in self._native_rows(tenant, ws, family):
                record_sha = native_digest(record)
                key = identifier(record["id"])
                if family == "grids":
                    root = ws.root / "grids" / key
                elif family == "comparisons":
                    root = ws.root / "comparisons" / key
                else:
                    root = ws.root
                selected = {}
                for trail, body in _registered(record):
                    member = str(_member(body["path"]))
                    path = _inside(ws.root, root / member)
                    label = path.relative_to(ws.root).as_posix()
                    prior = selected.get(label)
                    if prior and (prior["bytes"], prior["sha256"]) != _identity(body):
                        raise IntelligenceError("A native registry declares conflicting file identities.", 409)
                    if prior is None:
                        selected[label] = {
                            "id": _dataset_id("derived", {"family": family, "id": key, "member": label}),
                            "tenant_id": tenant, "title": family.replace("_", " ") + " / " + "/".join(trail),
                            "path": str(path), "bytes": body["bytes"], "sha256": body["sha256"],
                            "metadata": {
                                "native_kind": family, "native_id": key, "native_selection": record.get("selection", record.get("spec")),
                                "source_record_sha256": record_sha, "file": body,
                                "registry_locations": [list(trail)],
                            },
                        }
                    else:
                        prior["metadata"]["registry_locations"].append(list(trail))
                yield from selected.values()

    def _jobs(self, tenant, ws, *, job_ids=None):
        tasks = self.repository._memo(tenant, "native_tasks", "all",
                                      lambda: self.operator.task_list(tenant))
        active = {}
        for task in tasks:
            if task.get("action") == "run.start" and task.get("state") in {"queued", "running"}:
                active.setdefault(task.get("payload", {}).get("run_id"), []).append(task)
        if job_ids is None:
            job_ids = [identifier(path.parent.name)
                       for path in sorted((ws.root / "runs").glob("*/run.json"))]
        profiles, scenarios, grids = {}, {}, {}
        for key in job_ids:
            run = self._native_run(tenant, ws, key)
            selection = run["selection"]
            for family, cache, selected in (
                    ("profiles", profiles, selection["profile_id"]),
                    ("scenarios", scenarios, selection["scenario_id"]),
                    ("grids", grids, selection["grid_id"])):
                if selected not in cache:
                    cache[selected] = self._native_item(tenant, ws, family, selected)
            related = active.get(run["id"], [])
            status = run.get("state", "prepared")
            if related and status not in {"complete", "completed", "succeeded"}:
                status = "running" if any(t["state"] == "running" for t in related) else "queued"
            yield {
                "id": run["id"], "tenant_id": tenant, "status": status,
                "title": "Native InVEST run " + run["id"][:12],
                "metadata": {
                    "native_kind": "native_model_run", "native_state": run.get("state"),
                    "native_record": run, "source_record_sha256": native_digest(run),
                    "profile": deepcopy(profiles[selection["profile_id"]]),
                    "scenario": deepcopy(scenarios[selection["scenario_id"]]),
                    "grid": deepcopy(grids.get(selection["grid_id"])),
                    "active_tasks": [{k: task.get(k) for k in
                                      ("id", "operation_id", "action", "state", "request_sha256")} for task in related],
                },
            }

    def _records(self, tenant, kind):
        with self.repository.read_scope(tenant):
            return self.repository._memo(
                tenant, "original_records", kind,
                lambda: list(self._record_rows(tenant, kind)),
            )

    def _record_rows(self, tenant, kind):
        ws = self.operator.ws(tenant)
        if kind == "dataset":
            yield from self._source_rows(tenant, ws)
            yield from self._observation_rows(tenant, ws)
            yield from self._derived_rows(tenant, ws)
            for provider in self.providers:
                for supplied in provider(tenant, ws):
                    row = dict(supplied)
                    if row.get("tenant_id") != tenant:
                        raise IntelligenceError("A scientific provider returned another workspace.", 403)
                    if "_upstate" in row:
                        raise IntelligenceError("A scientific provider cannot select native source-view operations.", 409)
                    if not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
                        raise IntelligenceError("A scientific provider needs the original content hash.", 409)
                    if row.get("bytes") is not None:
                        _identity(row)
                    _inside(ws.root, row["path"])
                    row.setdefault("title", row.get("label", row.get("id")))
                    yield row
        elif kind == "job":
            yield from self._jobs(tenant, ws)
        elif kind == "aoi":
            for collection in self._native_rows(tenant, ws, "sources"):
                collection_sha = native_digest(collection)
                for entry in collection.get("entries", []):
                    if entry.get("kind") == "vector":
                        key = {"collection_id": collection["id"], "source_id": entry["id"]}
                        yield {"id": _dataset_id("aoi", key), "tenant_id": tenant,
                               "title": entry.get("title", entry["id"]),
                               "metadata": {"source_binding": key, "native_source": entry,
                                            "source_record_sha256": collection_sha}}
        elif kind == "ensemble":
            for method in self.actions.values():
                if method.kind == "ensemble" and method.catalog is not None:
                    yield from method.catalog(tenant, ws)
        else:
            raise IntelligenceError("Unknown original workspace record kind.")

    def _artifacts(self, tenant, job_id):
        ws = self.operator.ws(tenant)
        run = self._native_run(tenant, ws, job_id)
        root = ws.root / "runs" / run["id"]
        selected = {}
        for trail, body in _registered(run):
            member = str(_member(body["path"]))
            path = _inside(ws.root, root / member)
            prior = selected.get(member)
            if prior and (prior["bytes"], prior["sha256"]) != _identity(body):
                raise IntelligenceError("The native run registers conflicting artifact identities.", 409)
            if prior is None:
                selected[member] = {
                    "member": member, "path": str(path),
                    "bytes": body["bytes"], "sha256": body["sha256"],
                    "metadata": {"native_run_id": run["id"], "selection": run["selection"],
                                 "file": body, "registry_locations": [list(trail)]},
                }
            else:
                prior["metadata"]["registry_locations"].append(list(trail))
        return [selected[member] for member in sorted(selected)]

    def _materialize(self, tenant, row):
        ws = self.operator.ws(tenant)
        locator = row.get("_upstate") or {}
        if locator.get("kind") == "source":
            primary, entry = ws.source_file(locator["collection_id"], locator["source_id"])
            binding = {"collection_id": locator["collection_id"], "source_id": locator["source_id"],
                       "member": locator["member"], "role": locator["role"]}
            if row["id"] != _dataset_id("source", binding):
                raise IntelligenceError("The selected source binding changed.", 409)
            if locator["role"] == "primary" and primary.resolve() != Path(row["path"]).resolve():
                raise IntelligenceError("The original source view returned a different member.", 409)
        elif locator.get("kind") == "observation":
            record = ws._get("observations", identifier(locator["observation_id"]))
            body = record["original"]
            if _identity(body) != (row["bytes"], row["sha256"]):
                raise IntelligenceError("The retained observation edition changed.", 409)
            original = _verify(_inside(ws.root, body["object"], existing=True), body)
            target = _inside(ws.root, row["path"])
            if Path(row["path"]).is_symlink():
                raise IntelligenceError("The observation source view became a file alias.", 409)
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                pending = None
                try:
                    try:
                        os.link(original, target)
                    except FileExistsError:
                        pass
                    except OSError as error:
                        if error.errno not in {errno.EXDEV, errno.EPERM, errno.EACCES,
                                              errno.EMLINK, errno.ENOSYS, errno.EOPNOTSUPP}:
                            raise
                        with original.open("rb") as src, tempfile.NamedTemporaryFile(
                                dir=target.parent, prefix=".source-view-", delete=False) as output:
                            pending = Path(output.name)
                            shutil.copyfileobj(src, output, 1024 * 1024)
                            output.flush()
                            os.fsync(output.fileno())
                        _verify(pending, body)
                        try:
                            os.link(pending, target)
                        except FileExistsError:
                            pass
                finally:
                    if pending is not None:
                        pending.unlink(missing_ok=True)
            _verify(_inside(ws.root, target, existing=True), body)

    def _binding(self, tenant, plan_id):
        with self._context(tenant)["store"].db() as db:
            row = db.execute("SELECT body FROM upstate_native_bindings WHERE tenant=? AND plan_id=?",
                             (self.storage_tenant(tenant), plan_id)).fetchone()
            return json.loads(row["body"]) if row else None

    def _retain_binding(self, tenant, plan_id, body):
        with self._context(tenant)["store"].db() as db:
            db.execute("INSERT OR IGNORE INTO upstate_native_bindings VALUES (?,?,?)",
                       (self.storage_tenant(tenant), plan_id, dumps(body)))
            stored = db.execute("SELECT body FROM upstate_native_bindings WHERE tenant=? AND plan_id=?",
                                (self.storage_tenant(tenant), plan_id)).fetchone()
            if json.loads(stored["body"]) != body:
                raise IntelligenceError("This investigation plan already names a different original task.", 409)

    def _plan(self, tenant, plan_id, action=None):
        if not isinstance(plan_id, str) or not re.fullmatch(r"(?:[0-9a-f]{32}|[0-9a-f]{64})", plan_id):
            raise IntelligenceError("Select the original investigation plan ID.", 404)
        plan = self._context(tenant)["store"].plan(tenant, plan_id)
        if action is not None and plan["body"]["action"] != action.model_dump(exclude_none=True):
            raise IntelligenceError("The original guided action changed.", 409)
        return plan

    def _task(self, binding, workspace_key):
        self.operator.ws(workspace_key)
        if binding.get("storage_tenant") != self.storage_tenant(workspace_key):
            raise IntelligenceError("The retained native task belongs to another project.", 403)
        origin = "original_operator"
        try:
            task = self.operator.task(binding["native_task_id"])
        except FileNotFoundError:
            with self._context(workspace_key)["store"].db() as db:
                row = db.execute(
                    "SELECT body FROM upstate_native_task_receipts WHERE tenant=? AND task_id=? "
                    "ORDER BY observed_at DESC, source_sha256 DESC LIMIT 1",
                    (self.storage_tenant(workspace_key), binding["native_task_id"])).fetchone()
            if row is None:
                return None
            task = json.loads(row["body"])
            origin = "retained_snapshot"
        expected = {
            "id": binding["native_task_id"], "operation_id": binding["native_operation_id"],
            "workspace": binding["tenant"], "action": binding["native_action"],
            "payload": binding["native_payload"], "request_sha256": binding["request_sha256"],
        }
        if any(task.get(key) != value for key, value in expected.items()):
            raise IntelligenceError("The native task differs from its retained plan correlation.", 409)
        if origin == "original_operator":
            with self._context(workspace_key)["store"].db() as db:
                db.execute("INSERT OR IGNORE INTO upstate_native_task_receipts VALUES (?,?,?,?,?)",
                           (self.storage_tenant(workspace_key), task["id"], native_digest(task), dumps(task), now()))
        return {**task, "_intelligence_origin": origin}

    def _receipt(self, binding, task, workspace_key):
        if task is None:
            raise IntelligenceError("The original native task record is awaiting receiving.", 409)
        ws = self.operator.ws(workspace_key)
        native = {key: task.get(key) for key in
                  ("id", "operation_id", "workspace", "action", "state", "created_at",
                   "started_at", "ended_at", "finished_at", "updated_at", "request_sha256")}
        native["result"] = public_metadata(task.get("result"))
        if isinstance(task.get("error"), dict):
            native["error_type"] = task["error"].get("type")
        result = {
            "format": FORMAT, "receipt_type": "native_job_submission",
            "plan_id": binding["plan_id"], "native": native,
            "joined_existing_task": binding["joined_existing_task"],
            "method": binding["method"], "task_source": task["_intelligence_origin"],
            "original_workspace_key": binding["tenant"],
            "reopen": {"workspace": workspace_key, "task_id": task["id"]},
        }
        if binding["kind"] == "run_job":
            run_id = binding["native_payload"]["run_id"]
            result["reopen"]["run_id"] = run_id
            result["native_run"] = public_metadata(ws.inspect_run(run_id))
        elif binding["kind"] == "ensemble" and self.experiments is not None:
            key = identifier(binding["native_payload"]["experiment_id"])
            result["reopen"]["experiment_id"] = key
            result["native_experiment"] = public_metadata(self.experiments.receive(workspace_key, key))
        return result

    def _submit(self, tenant, action, plan_id, paired, context, *, continuing=False):
        ws = self.operator.ws(tenant)
        plan = self._plan(tenant, plan_id, action)
        method = self.actions.get(action.kind)
        if method is None:
            raise IntelligenceError("This native method has no original host binding.", 503)
        if plan["body"]["context"] != context:
            raise IntelligenceError("The original native action context changed.", 409)
        with self.operator.lock:
            binding = self._binding(tenant, plan_id)
            if binding is not None:
                if binding["source_plan_sha256"] != digest(plan["body"]):
                    raise IntelligenceError("The retained plan differs from its original native binding.", 409)
                existing = self._task(binding, tenant)
                if existing is not None:
                    return self._receipt(binding, existing, tenant)
                if not continuing:
                    raise IntelligenceError("Continue this original guided submission using its retained plan ID.", 409)
                if binding["tenant"] != tenant:
                    raise IntelligenceError("Open the retained native run in this restored workspace to prepare its current continuation.", 409)
                if binding["joined_existing_task"]:
                    raise IntelligenceError("Restore the original native task record before continuing this joined task.", 409)
            else:
                payload = _copy(method.build_payload(ws, action, paired, _copy(context)))
                if not isinstance(payload, dict):
                    raise IntelligenceError("The original native payload builder must return an object.")
                request = {"workspace": tenant, "action": method.operator_action, "payload": payload}
                request_sha = native_digest(request)
                operation_id = "eco-intelligence-" + plan_id
                task_id = native_digest({"workspace": tenant, "operation_id": operation_id})
                # Operator.submit returns active identical work before creating a
                # new task. Persist that exact existing ID under this plan first.
                joined = next((task for task in self.operator.task_list(tenant)
                               if task.get("state") in {"queued", "running"}
                               and task.get("request_sha256") == request_sha), None)
                binding = {
                    "format": FORMAT, "tenant": tenant, "storage_tenant": self.storage_tenant(tenant), "plan_id": plan_id,
                    "source_plan_sha256": digest(plan["body"]), "kind": action.kind,
                    "native_action": method.operator_action, "native_payload": payload,
                    "native_operation_id": joined["operation_id"] if joined else operation_id,
                    "native_task_id": joined["id"] if joined else task_id,
                    "request_sha256": request_sha, "joined_existing_task": joined is not None,
                    "method": method.description, "retained_at": now(),
                }
                self._retain_binding(tenant, plan_id, binding)
                if joined is not None:
                    return self._receipt(binding, self._task(binding, tenant), tenant)
            task = self.operator.submit(
                tenant, binding["native_action"], _copy(binding["native_payload"]), binding["native_operation_id"])
            if task.get("id") != binding["native_task_id"]:
                # The original lock should prevent a same-operator race. Preserve
                # the actual response on the native queue; never invent an alias.
                raise IntelligenceError("The native operator returned another active task; receive its original record.", 409)
            return self._receipt(binding, self._task(binding, tenant), tenant)

    def _lookup(self, tenant, plan_id, action, plan):
        self.operator.ws(tenant)
        actual = self._plan(tenant, plan_id, action)
        binding = self._binding(tenant, plan_id)
        if binding is None:
            return None
        if binding["source_plan_sha256"] != digest(actual["body"]):
            raise IntelligenceError("The native binding belongs to a different source plan.", 409)
        task = self._task(binding, tenant)
        return self._receipt(binding, task, tenant) if task is not None else None

    def continue_submission(self, workspace_key, plan_id):
        """Explicit continuation of a persisted admission interrupted before submit.

        The host calls this on its separate analysis worker after the operator
        selects Continue original submission. Reconcile the same Engine plan after
        this receipt. Existing/complete original tasks are returned without resume.
        """
        context = self._context(workspace_key)
        plan = self._plan(workspace_key, plan_id)
        action = Action.model_validate(plan["body"]["action"])
        if action.kind == "analyze_collection":
            raise IntelligenceError("Continue analysis through the original investigation engine.")
        received = self._lookup(workspace_key, plan_id, action, plan)
        if received is not None:
            return received
        if plan["status"] not in {"executing", "reconcile"}:
            raise IntelligenceError("Execute the reviewed plan through its investigation before continuing admission.", 409)
        context["engine"].verify_sources(workspace_key, plan["body"]["sources"])
        paired = None
        if action.kind == "calibration" and self._binding(workspace_key, plan_id) is None:
            paired, _, _ = context["engine"].calibration_data(workspace_key, action)
        return self._submit(workspace_key, action, plan_id, paired, plan["body"]["context"], continuing=True)

    def native_tasks(self, workspace_key):
        """Original task IDs for the host's native task reopening and full export."""
        self.operator.ws(workspace_key)
        with self._context(workspace_key)["store"].db() as db:
            bindings = [json.loads(row["body"]) for row in db.execute(
                "SELECT body FROM upstate_native_bindings WHERE tenant=? ORDER BY plan_id", (self.storage_tenant(workspace_key),))]
        return self._native_task_rows(workspace_key, bindings)

    def _native_task_rows(self, workspace_key, bindings):
        result = []
        for binding in bindings:
            task = self._task(binding, workspace_key)
            result.append({"plan_id": binding["plan_id"], "task_id": binding["native_task_id"],
                           "operation_id": binding["native_operation_id"],
                           "joined_existing_task": binding["joined_existing_task"],
                           "admission": "retained" if task is not None else "pending",
                           "native_state": task.get("state") if task is not None else None,
                           "task_source": task.get("_intelligence_origin") if task is not None else None})
        return result

    def native_task(self, workspace_key, task_id):
        """Read a plan-bound original task, including its portable captured record."""
        identifier(task_id)
        with self._context(workspace_key)["store"].db() as db:
            records = [json.loads(row["body"]) for row in db.execute(
                "SELECT body FROM upstate_native_bindings WHERE tenant=?",
                (self.storage_tenant(workspace_key),))]
        binding = next((row for row in records if row["native_task_id"] == task_id), None)
        if binding is None:
            raise IntelligenceError("This native task is not bound to the current project.", 404)
        task = self._task(binding, workspace_key)
        if task is None:
            raise IntelligenceError("The original native task is awaiting admission.", 404)
        return task

    def snapshot_state(self, workspace_key, destination):
        with self._context(workspace_key)["store"].workspace_guard():
            self.native_tasks(workspace_key)
            return self._snapshot_state(workspace_key, destination)

    def _snapshot_state(self, workspace_key, destination):
        """Copy the original Store using the shared native snapshot implementation."""
        from .study_transfer import snapshot_project_state
        ws = self.operator.ws(workspace_key)
        store = self._context(workspace_key)["store"]
        namespace = store.storage_tenant(workspace_key)
        with store.db() as source:
            return snapshot_project_state(
                ws, source, destination, namespace=namespace,
                workspace_key=workspace_key, snapshot_format=FORMAT + "/state-snapshot",
            )

    def prepare_study_snapshot(self, workspace_key):
        """Bind before the study exporter acquires the original exclusive lock.

        The returned callback(staged_workspace, plan) uses this same Store's
        configured path and never reacquires its shared lock during capture.
        """
        from .study_transfer import prepare_workspace_study_snapshot
        context = self._context(workspace_key)
        store = context["store"]
        workspace = self.operator.ws(workspace_key)
        root = workspace.root.resolve()
        project_sha256 = native_digest(workspace.project)
        # Capture the existing original queue receipts while normal Store
        # locking is available, before the selected-study exclusive guard.
        self.native_tasks(workspace_key)

        def validate_binding():
            current = self.operator.ws(workspace_key)
            if (current.root.resolve() != root
                    or native_digest(current.project) != project_sha256):
                raise IntelligenceError("The investigation binding moved to another workspace.", 409)
            store.storage_tenant(workspace_key)

        return prepare_workspace_study_snapshot(
            workspace, database_path=store.path, workspace_key=workspace_key,
            validate_binding=validate_binding,
            snapshot_format=FORMAT + "/state-snapshot",
        )
