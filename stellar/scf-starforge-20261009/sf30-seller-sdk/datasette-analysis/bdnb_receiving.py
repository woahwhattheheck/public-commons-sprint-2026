#!/usr/bin/env python3
"""Receive, edit, return and reopen one supplied BDNB case through its original APIs.

One invocation owns its private journal and one native operator at a time.
No public dataset, customer record, broker receipt or review is fabricated.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import stat
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
for directory in (PYTHON, HERE):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
from stellar_forge_buyer.errors import BuyerError
from stellar_forge_buyer.storage import private_directory, sync_directory
from stellar_forge_buyer.workspace_archive import inspect_archive
from stellar_forge_buyer.workspace_archive_receive import restore_archive
from operator_server import create_operator
from operator_client import DatasetteOperatorClient
from bdnb_products import archive_catalogue
from workflow_engine import Workflow

SCHEMA = "stellar-forge.bdnb-receiving.v1"
ID = re.compile(r"[a-f0-9]{32}")
HASH = re.compile(r"[a-f0-9]{64}")
LIMIT = 96 * 1024 * 1024
PHASES = ["01-input", "02-producer", "03-producer-data", "04-products",
          "05-customer-receive", "06-customer", "07-earlier-replay",
          "08-return", "09-independent-return", "10-original-replay"]


def need(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "Duplicate original JSON key")
        result[key] = value
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda v: (_ for _ in ()).throw(ValueError("Non-finite JSON")))


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def file_identity(path):
    path = Path(path).expanduser().absolute()
    need(path.resolve() == path, "Select a canonical original path")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        need(stat.S_ISREG(before.st_mode), "Select an ordinary file")
        sha = hashlib.file_digest(source, "sha256").hexdigest()
        after = os.fstat(source.fileno())
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    need(all(getattr(before, k) == getattr(after, k) == getattr(path.lstat(), k) for k in fields),
         "The original file changed while reading")
    return {"bytes": before.st_size, "sha256": sha}


def read(path, maximum=LIMIT):
    path = Path(path)
    selected = file_identity(path)
    need(selected["bytes"] <= maximum, "Complete input exceeds its explicit receiving bound")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    need(len(raw) == selected["bytes"] and hashlib.sha256(raw).hexdigest() == selected["sha256"],
         "Original bytes changed")
    return raw


def canonical_path(value):
    need(isinstance(value, str) and Path(value).is_absolute(), "Select each full original absolute path")
    path = Path(value)
    need(path.resolve() == path, "Select canonical source and workspace paths")
    return path


def publish(path, raw):
    need(len(raw) <= LIMIT, "Complete JSON exceeds the 96 MiB receiving artifact bound")
    path = Path(path)
    private_directory(path.parent, create=True)
    expected = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    if path.exists():
        need(file_identity(path) == expected, "An original retained artifact differs")
        sync_directory(path.parent)
        return expected
    fd, temporary = tempfile.mkstemp(prefix=".bdnb-receive-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o600); target.write(raw); target.flush(); os.fsync(target.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            need(file_identity(path) == expected, "An original artifact publication conflicts")
        sync_directory(path.parent)
        return expected
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate_input(value):
    required = {"schema", "operation_id", "analysis_operation_id", "checkout", "node", "source_files",
                "producer_workspace", "customer_workspace", "return_workspace", "output",
                "producer_actions", "customer_actions", "producer_publication_id", "producer_pack_id",
                "customer_publication_id", "customer_pack_id", "customer_receive_id", "return_receive_id"}
    need(isinstance(value, dict) and set(value) == required and value["schema"] == SCHEMA + "/input",
         "Use the complete original receiving input")
    for key in required:
        if key.endswith("_id"):
            need(isinstance(value[key], str) and ID.fullmatch(value[key]), "Use exact UUID32 identities")
    paths = [canonical_path(value[k]) for k in
             ("checkout", "producer_workspace", "customer_workspace", "return_workspace", "output")]
    workspaces = paths[1:4]
    need(len(set(workspaces)) == 3 and all(not a.is_relative_to(b) for a in workspaces
             for b in workspaces if a != b), "Keep three disjoint original workspaces")
    need(all(not paths[4].is_relative_to(p) and not p.is_relative_to(paths[4]) for p in workspaces),
         "Keep the receiving journal outside all three workspaces")
    need(isinstance(value["node"], str) and value["node"], "Select the original installed Node command")
    need(isinstance(value["source_files"], list) and value["source_files"], "Retain complete selected source identities")
    seen = set()
    for item in value["source_files"]:
        name = item.get("path")
        need(isinstance(name, str) and name and not Path(name).is_absolute() and
             all(p not in {"", ".", ".."} for p in name.split("/")) and "\\" not in name and name not in seen,
             "Invalid selected source member")
        seen.add(name)
        need(file_identity(paths[0] / name) == {"bytes": item["bytes"], "sha256": item["sha256"]},
             "The selected executable source differs")
    own = str(Path(__file__).resolve().relative_to(paths[0]))
    need(own in seen and any(x.endswith("/bdnb_adapter.py") for x in seen) and
         any(x.endswith("/bdnb_products.py") for x in seen) and
         any(x.endswith("/analysis_exports.py") for x in seen) and
         any(x.endswith("/workspace_archive_receive.py") for x in seen),
         "Select the full current domain/product/receiving and native source cohort")
    all_requests = set()
    for side in ("producer", "customer"):
        actions = value[side + "_actions"]
        need(isinstance(actions, list) and actions, "Supply the actual reviewed case actions")
        for step in actions:
            need(isinstance(step, dict) and set(step) == {"request_id", "action", "body"} and
                 ID.fullmatch(step["request_id"]) and step["request_id"] not in all_requests and
                 step["action"] in {"bdnb.import", "bdnb.select", "bdnb.compare", "bdnb.review", "bdnb.publish", "bdnb.pack"} and
                 isinstance(step["body"], dict) and "resume" not in step["body"] and
                 len(encoded(step["body"])) <= 1024 * 1024, "Invalid complete case action")
            all_requests.add(step["request_id"])
            if step["action"] == "bdnb.pack":
                need(step["body"].get("pack_id") == step["request_id"], "Pack ID must match original request ID")
        need(actions[-1]["action"] == "bdnb.pack" and
             actions[-1]["body"]["pack_id"] == value[side + "_pack_id"] and
             actions[-1]["body"]["publication_id"] == value[side + "_publication_id"],
             "Each course ends with its exact selected publication's whole pack")
    need(any(a["action"] == "bdnb.compare" for a in value["producer_actions"]) and
         any(a["action"] == "bdnb.review" for a in value["customer_actions"]),
         "Select the original comparison and a real customer review continuation")
    return value


class Run:
    def __init__(self, value, *, resume=False, wait_seconds=3600):
        self.value, self.resume, self.wait_seconds = value, resume, wait_seconds
        self.root = private_directory(value["output"], create=True)
        self.owner = None
        self.files, self.phases = {}, []
        self.workspace = self.controller = self.server = self.thread = self.control = None
        self.closing_errors = []

    def retain(self, name, value):
        receipt = publish(self.root / name, encoded(value))
        self.files[name] = receipt
        return value

    def remember(self, path):
        path = Path(path)
        need(path.is_relative_to(self.root), "Retain only the selected original output")
        receipt = file_identity(path)
        sync_directory(path.parent)
        self.files[str(path.relative_to(self.root))] = receipt
        return receipt

    def verify(self, records):
        for name, receipt in records.items():
            need(isinstance(name, str) and name and all(p not in {"", ".", ".."} for p in name.split("/")) and
                 not Path(name).is_absolute() and "\\" not in name, "Invalid artifact member")
            need(self.remember(self.root / name) == receipt, "Original receiving artifact changed")

    def phase(self, name, function):
        need(name == PHASES[len(self.phases)], "Original phase sequence changed")
        path = self.root / (name + ".json")
        if path.exists():
            saved = parse(read(path))
            need(saved["schema"] == SCHEMA + "/phase" and saved["operation_id"] == self.value["operation_id"] and
                 saved["input_sha256"] == digest(self.value) and saved["name"] == name,
                 "Original phase binding changed")
            self.verify(saved["artifacts"])
            self.remember(path)
            self.phases.append(saved)
            return saved["value"]
        result = function()
        saved = {"schema": SCHEMA + "/phase", "operation_id": self.value["operation_id"],
                 "input_sha256": digest(self.value), "name": name,
                 "value": result, "artifacts": dict(self.files)}
        self.retain(name + ".json", saved)
        self.phases.append(saved)
        emit({"phase": name, "status": "COMPLETE"})
        return result

    def acquire(self):
        self.owner = os.open(self.root / "receiving.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(self.owner)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077, "Private operation lock required")
        fcntl.flock(self.owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.retain("input.json", self.value)

    def close_operator(self):
        errors = []
        if self.server is not None and self.thread is not None and self.thread.ident is not None:
            try:
                self.server.shutdown(); self.thread.join()
                need(not self.thread.is_alive(), "Original server thread remains")
                self.thread = None
            except BaseException as error:
                errors.append(error)
        elif self.thread is not None and self.thread.ident is None:
            self.thread = None
        if self.server is not None and self.thread is None:
            try:
                self.server.server_close(); self.server = None
            except BaseException as error:
                errors.append(error)
        if self.controller is not None and self.server is None:
            try:
                self.controller.close(); self.controller = None
            except BaseException as error:
                errors.append(error)
        if self.workspace is not None and self.controller is None and self.server is None:
            workspace = self.workspace
            # Signal all original native owners and drain its sole executor
            # before releasing the existing Analysis flock. Retain each owner
            # when a close fails, so a retry never treats _closed as proof.
            with workspace._mutex:
                workspace._closed = True
            for name in ("lineage", "synthesis", "research", "exports", "workbooks", "archives"):
                try:
                    getattr(workspace, name).close()
                except BaseException as error:
                    errors.append(error)
            try:
                workspace.profiles.cancel_all()
            except BaseException as error:
                errors.append(error)
            try:
                workspace._executor.shutdown(wait=True)
            except BaseException as error:
                errors.append(error)
            if not errors:
                try:
                    os.close(workspace._owner)
                    self.workspace = None
                except BaseException as error:
                    errors.append(error)
        if self.workspace is None and self.control is not None:
            for path in self.control:
                try:
                    path.unlink(missing_ok=True)
                except BaseException as error:
                    errors.append(error)
            if not errors:
                self.control = None
        self.closing_errors = [str(e) for e in errors]
        if errors:
            raise RuntimeError("Original owner closure incomplete: " + "; ".join(self.closing_errors))

    @contextmanager
    def operator(self, path):
        need(self.workspace is None and self.server is None, "An original operator is still owned")
        self.workspace = AnalysisWorkspace(path, checkout=self.value["checkout"], node=self.value["node"])
        try:
            server, control, _, controller = create_operator(self.workspace, operation_id=self.value["analysis_operation_id"], port=0)
            self.server, self.controller = server, controller
            self.control = [control, server.datasette_analysis_control]
            self.thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2},
                                           name="bdnb-receiving-http", daemon=False)
            self.thread.start()
            client = DatasetteOperatorClient.from_workspace(path)
            selected = client.status()
            need(selected["workspace_id"] == self.workspace.identity and
                 selected["operation_id"] == self.value["analysis_operation_id"], "Original operator identity changed")
            yield client
        finally:
            self.close_operator()

    def action(self, client, step, label):
        self.retain(label + "-request.json", step)
        current = client.submit(step["action"], step["body"], request_id=step["request_id"])["request"]
        if current["status"] in {"FAILED", "INTERRUPTED"}:
            need(self.resume, "Resume the same interrupted request explicitly")
            current = client.resume(step["request_id"])["request"]
        if current["status"] == "RUNNING":
            current = client.wait(step["request_id"], timeout=self.wait_seconds)
        self.retain(label + "-observation-" + digest(current) + ".json", current)
        need(current["status"] == "COMPLETE" and current["action"] == step["action"] and
             current["body"] == step["body"], "Original request has not completed exactly")
        accepted = {"request_id": step["request_id"], "request_sha256": current["request_sha256"],
                    "action": current["action"], "body": current["body"], "result": current["result"]}
        self.retain(label + "-accepted.json", accepted)
        entity = current["result"]["entity"]
        need(client.bdnb_read("bdnb.get", {"entity_id": entity["id"]}) == entity,
             "Original accepted entity is missing or changed")
        return entity

    def catalogue(self, client, label, *, original=None):
        state = client.bdnb_read("bdnb.status")
        identities = {e["id"]: {"kind": e["kind"], "sha256": e["sha256"]} for e in state["entities"]}
        if original is not None:
            need(all(identities.get(k) == v for k, v in original.items()), "Original immutable catalogue changed")
        self.retain(label + "-" + digest(state) + ".json", state)
        return identities

    def full_entity(self, client, identifier, label):
        entity = client.bdnb_read("bdnb.get", {"entity_id": identifier})
        self.retain(label + "-entity.json", entity)
        rows = {}
        for collection, selected in entity["collections"].items():
            final = self.root / (label + "-" + collection + ".jsonl")
            fd, temporary = tempfile.mkstemp(prefix=".rows-", dir=self.root)
            offset, sha = 0, hashlib.sha256()
            try:
                with os.fdopen(fd, "wb") as target:
                    while True:
                        page = client.bdnb_read("bdnb.rows", {"entity_id": identifier, "collection": collection,
                                                           "offset": offset, "limit": 250})
                        need(page["entity_id"] == identifier and page["entity_sha256"] == entity["sha256"] and
                             page["collection"] == collection and page["version_id"] == selected["version_id"] and
                             page["total"] == selected["row_count"] and page["offset"] == offset,
                             "Full data page identity changed")
                        need(isinstance(page["rows"], list) and len(page["rows"]) <= 250, "Invalid full data page")
                        for row in page["rows"]:
                            # Comparison read-time review annotations change
                            # as customer reviews are appended. Keep the whole
                            # observed row here; immutable evidence is separately
                            # fixed by the source entity and original row ID.
                            raw = encoded(row); target.write(raw); sha.update(raw)
                        offset += len(page["rows"])
                        if page["next_offset"] is None:
                            need(offset == selected["row_count"], "Incomplete original row population")
                            break
                        need(page["rows"] and page["next_offset"] == offset and offset < selected["row_count"],
                             "Non-advancing original row page")
                    target.flush(); os.fsync(target.fileno())
                observed = file_identity(temporary)
                # Every complete observation has its own content identity; a
                # later review cannot overwrite the earlier row observation.
                final = self.root / (label + "-" + collection + "-" + observed["sha256"] + ".jsonl")
                try:
                    os.link(temporary, final, follow_symlinks=False)
                except FileExistsError:
                    need(file_identity(final) == observed, "Earlier complete row artifact changed")
                sync_directory(self.root)
                self.remember(final)
                rows[collection] = {"version_id": selected["version_id"], "rows": offset,
                                    "bytes": observed["bytes"], "sha256": observed["sha256"], "file": final.name}
            finally:
                Path(temporary).unlink(missing_ok=True)
        return {"id": identifier, "sha256": entity["sha256"], "collections": rows}

    def download_products(self, client, publication_id, pack_id, label):
        publication = client.bdnb_read("bdnb.get", {"entity_id": publication_id})
        pack = client.bdnb_read("bdnb.get", {"entity_id": pack_id})
        need(publication["kind"] == "publication" and publication["summary"]["status"] == "COMPLETE" and
             pack["kind"] == "pack" and pack["summary"]["publication_sha256"] == publication["sha256"],
             "Exact full publication/pack required")
        result, archive = [], None
        directory = private_directory(self.root / label, create=True)
        for item in [*publication["files"], *pack["files"]]:
            need(Path(item["filename"]).name == item["filename"] and item["filename"] not in {"", ".", ".."},
                 "Invalid original download filename")
            target = directory / item["filename"]
            received = client.download(item["name"], target, expected_sha256=item["sha256"])
            need(received["bytes"] == item["bytes"], "Complete file length changed")
            self.remember(target)
            result.append({"file": str(target.relative_to(self.root)), **file_identity(target)})
            if item["kind"] == "bdnb-query-export" and item["native_name"] == "manifest.json":
                native = parse(read(target, 16 * 1024 * 1024))
                need(native.get("queryComplete") is True, "An annex is incomplete")
            if item["kind"] == "bdnb-archive" and item["native_name"] == "workspace.zip":
                need(archive is None, "Ambiguous original workspace archive")
                inspected = inspect_archive(target, expected_sha256=item["sha256"])
                self.retain(label + "-archive-inspection.json", inspected)
                with target.open("rb") as source:
                    actual_catalogue = archive_catalogue(source, inspected["manifest"],
                                                        self.value["analysis_operation_id"], directory)
                need(actual_catalogue == pack["summary"]["archive_catalogue"],
                     "The actual archived catalogue differs from the selected pack")
                archive = {"path": str(target), **file_identity(target), "manifest": inspected["manifest"],
                           "manifest_sha256": inspected["manifest_sha256"], "catalogue": actual_catalogue}
        need(archive is not None, "Original full workspace archive required")
        return {"publication": publication, "pack": pack, "files": result, "archive": archive}

    def receive(self, archive, destination, operation, label):
        result = restore_archive(archive["path"], destination, operation=operation, expected_sha256=archive["sha256"])
        self.retain(label + "-observation-" + digest(result) + ".json", result)
        stable = {k: v for k, v in result.items() if k != "reused"}
        self.retain(label + "-accepted.json", stable)
        return stable

    def actions(self, client, side):
        result = []
        baseline_path = self.root / (side + "-baseline.json")
        if baseline_path.exists():
            baseline = parse(read(baseline_path)); self.remember(baseline_path)
            self.catalogue(client, side + "-resume", original=baseline)
        else:
            baseline = self.catalogue(client, side + "-baseline-observation")
            self.retain(side + "-baseline.json", baseline)
        for index, step in enumerate(self.value[side + "_actions"]):
            result.append(self.action(client, step, side + "-action-" + str(index + 1)))
        return {"baseline": baseline, "entities": result,
                "catalogue": self.catalogue(client, side + "-after", original=baseline)}

    def execute(self):
        self.phase("01-input", lambda: {"operation_id": self.value["operation_id"],
            "source_files": self.value["source_files"], "runtime": {"python": sys.version,
            "executable": sys.executable, "platform": platform.platform()}, "input_sha256": digest(self.value)})
        with self.operator(self.value["producer_workspace"]) as client:
            producer = self.phase("02-producer", lambda: self.actions(client, "producer"))
            self.phase("03-producer-data", lambda: [self.full_entity(client, e["id"], "producer-data-" + e["id"])
                       for e in producer["entities"] if e["kind"] != "pack"])
            products = self.phase("04-products", lambda: self.download_products(
                client, self.value["producer_publication_id"], self.value["producer_pack_id"], "producer-products"))
        self.phase("05-customer-receive", lambda: self.receive(
            products["archive"], self.value["customer_workspace"], self.value["customer_receive_id"], "customer-receive"))
        with self.operator(self.value["customer_workspace"]) as client:
            self.catalogue(client, "customer-archive-selection", original=products["archive"]["catalogue"]["entities"])
            publication = products["publication"]
            need(client.bdnb_read("bdnb.get", {"entity_id": publication["id"]}) == publication,
                 "Received complete publication differs")
            customer = self.phase("06-customer", lambda: self.actions(client, "customer"))
        def earlier_replay():
            # Closed original owner, then native receiving replays its own
            # original marker without replacing later customer DB changes.
            result = self.receive(products["archive"], self.value["customer_workspace"],
                                  self.value["customer_receive_id"], "customer-receive")
            with self.operator(self.value["customer_workspace"]) as client:
                preserved = self.catalogue(client, "customer-preserved", original=customer["catalogue"])
            return {"receive": result, "preserved": preserved}
        self.phase("07-earlier-replay", earlier_replay)
        with self.operator(self.value["customer_workspace"]) as client:
            returned = self.phase("08-return", lambda: self.download_products(
                client, self.value["customer_publication_id"], self.value["customer_pack_id"], "customer-return"))
        def independent():
            received = self.receive(returned["archive"], self.value["return_workspace"],
                                    self.value["return_receive_id"], "independent-receive")
            with self.operator(self.value["return_workspace"]) as client:
                self.catalogue(client, "return-archive-selection", original=returned["archive"]["catalogue"]["entities"])
                need(client.bdnb_read("bdnb.get", {"entity_id": returned["publication"]["id"]}) == returned["publication"],
                     "Independent recipient publication changed")
                reports = [self.full_entity(client, e["id"], "returned-data-" + e["id"])
                           for e in customer["entities"] if e["kind"] != "pack"]
                catalogue = self.catalogue(client, "independent-return")
                for e in customer["entities"]:
                    if e["kind"] != "pack":
                        need(catalogue.get(e["id"], {}).get("sha256") == e["sha256"], "Customer edition is absent in returned archive")
            return {"receive": received, "entities": reports, "catalogue": catalogue}
        self.phase("09-independent-return", independent)
        def replay():
            proofs = []
            for side in ("producer", "customer"):
                with self.operator(self.value[side + "_workspace"]) as client:
                    before = self.catalogue(client, side + "-replay-before")
                    for index, step in enumerate(self.value[side + "_actions"]):
                        observed = self.action(client, step, side + "-action-" + str(index + 1))
                        proofs.append({"side": side, "request_id": step["request_id"],
                                       "entity_id": observed["id"], "sha256": observed["sha256"]})
                    after = self.catalogue(client, side + "-replay-after", original=before)
                    need(after == before, "Completed original request replay altered later work")
            return proofs
        self.phase("10-original-replay", replay)

    def complete_basis(self):
        """Reopen the whole original ordered course, not a summary claim."""
        phases = {}
        for name in PHASES:
            path = self.root / (name + ".json")
            need(path.exists(), "A required complete original phase is missing")
            saved = parse(read(path))
            need(saved.get("schema") == SCHEMA + "/phase" and saved.get("name") == name and
                 saved.get("operation_id") == self.value["operation_id"] and
                 saved.get("input_sha256") == digest(self.value), "Original phase binding changed")
            self.verify(saved["artifacts"])
            self.remember(path)
            phases[name] = saved["value"]
        products, returned = phases["04-products"], phases["08-return"]
        for side, result, action_phase in (("producer", products, "02-producer"),
                                           ("customer", returned, "06-customer")):
            need(result["publication"]["id"] == self.value[side + "_publication_id"] and
                 result["pack"]["id"] == self.value[side + "_pack_id"] and
                 result["pack"]["summary"]["publication_sha256"] == result["publication"]["sha256"],
                 "Original product selection changed")
            accepted = phases[action_phase]["entities"]
            need(len(accepted) == len(self.value[side + "_actions"]), "Original action course is incomplete")
            for index, (step, entity) in enumerate(zip(self.value[side + "_actions"], accepted)):
                request_path = self.root / (side + "-action-" + str(index + 1) + "-request.json")
                accepted_path = self.root / (side + "-action-" + str(index + 1) + "-accepted.json")
                need(parse(read(request_path)) == step, "Original action input changed")
                receipt = parse(read(accepted_path))
                need(receipt["request_id"] == step["request_id"] and receipt["action"] == step["action"] and
                     receipt["body"] == step["body"] and receipt["result"]["entity"] == entity,
                     "Original accepted action selection changed")
                self.remember(request_path); self.remember(accepted_path)
            archive = result["archive"]
            archive_path = canonical_path(archive["path"])
            need(archive_path.is_relative_to(self.root) and file_identity(archive_path) ==
                 {k: archive[k] for k in ("bytes", "sha256")}, "Original archive changed")
            inspected = inspect_archive(archive_path, expected_sha256=archive["sha256"])
            need(inspected["manifest"] == archive["manifest"] and
                 inspected["manifest_sha256"] == archive["manifest_sha256"], "Original archive manifest changed")
            with archive_path.open("rb") as source:
                selected = archive_catalogue(source, inspected["manifest"], self.value["analysis_operation_id"],
                                             archive_path.parent)
            need(selected == archive["catalogue"] == result["pack"]["summary"]["archive_catalogue"],
                 "Original archived catalogue changed")
            self.remember(archive_path)
        receives = [
            (phases["05-customer-receive"], products["archive"], "customer"),
            (phases["07-earlier-replay"]["receive"], products["archive"], "customer"),
            (phases["09-independent-return"]["receive"], returned["archive"], "return")]
        for receipt, archive, side in receives:
            need(receipt["state"] == "complete" and receipt["target"] == self.value[side + "_workspace"] and
                 receipt["operation_id"] == self.value[side + "_receive_id"] and
                 receipt["workspace_id"] == archive["manifest"]["workspace_id"] and
                 receipt["archive_sha256"] == archive["sha256"] and receipt["archive_bytes"] == archive["bytes"] and
                 receipt["manifest_sha256"] == archive["manifest_sha256"] and
                 receipt["archive_id"] == archive["manifest"]["id"], "Original receiving selection changed")
        proofs = [{"side": side, "request_id": step["request_id"], "entity_id": entity["id"], "sha256": entity["sha256"]}
                  for side, phase in (("producer", "02-producer"), ("customer", "06-customer"))
                  for step, entity in zip(self.value[side + "_actions"], phases[phase]["entities"])]
        need(phases["10-original-replay"] == proofs, "Original replay proof differs from accepted actions")
        return {"publications": {"producer": products["publication"]["sha256"],
                                 "customer": returned["publication"]["sha256"],
                                 "return": returned["publication"]["sha256"]},
                "workspace_ids": {"producer": products["archive"]["manifest"]["workspace_id"],
                                  "customer": products["archive"]["manifest"]["workspace_id"],
                                  "return": returned["archive"]["manifest"]["workspace_id"]},
                "archive_catalogues": {"producer": products["archive"]["catalogue"]["sha256"],
                                       "customer": returned["archive"]["catalogue"]["sha256"]}}

    def adopt_complete(self, record):
        need(record.get("schema") == SCHEMA + "/result" and record.get("status") == "COMPLETE" and
             record.get("operation_id") == self.value["operation_id"] and record.get("input_sha256") == digest(self.value) and
             record.get("phases") == PHASES and record.get("lifetime") == "CLOSED",
             "Original completion binding changed")
        self.verify(record["artifacts"])
        basis = self.complete_basis()
        need(all(record.get(k) == v for k, v in basis.items()) and
             all(record["artifacts"].get(k) == v for k, v in self.files.items()),
             "Original completion omits or changes its complete course")
        # Only immutable originals are required; legitimate later customer work
        # stays untouched. The receiving records fix each original workspace.
        for side, selected_key in (("producer", "producer_publication_id"), ("customer", "customer_publication_id"),
                                   ("return", "customer_publication_id")):
            with self.operator(self.value[side + "_workspace"]) as client:
                need(client.status()["workspace_id"] == basis["workspace_ids"][side], "Original workspace changed")
                observed = client.bdnb_read("bdnb.get", {"entity_id": self.value[selected_key]})
                need(observed["sha256"] == basis["publications"][side], "Original completed publication changed")
        return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--wait-seconds", type=float, default=3600)
    parser.add_argument("--checkout", help="Selected managed installation; must equal original input")
    args = parser.parse_args(argv)
    os.umask(0o077)
    value = validate_input(parse(read(args.input, 16 * 1024 * 1024)))
    if args.checkout is not None:
        need(args.checkout == value["checkout"], "Installed original checkout changed")
    need(0 < args.wait_seconds <= 86400, "Invalid original wait interval")
    run = Run(value, resume=args.resume, wait_seconds=args.wait_seconds)
    problem = None
    try:
        run.acquire()
        final = run.root / "complete.json"
        if final.exists():
            record = run.adopt_complete(parse(read(final)))
        else:
            run.execute()
            need(run.workspace is None and run.server is None and run.controller is None, "Original owners remain")
            basis = run.complete_basis()
            record = {"schema": SCHEMA + "/result", "status": "COMPLETE", "operation_id": value["operation_id"],
                      "input_sha256": digest(value), "phases": PHASES, "lifetime": "CLOSED",
                      **basis, "artifacts": dict(run.files),
                      "broker": "Not executed by this local receiving programme; use the maintained actual Kestra workflow contract."}
            run.retain("complete.json", record)
        emit(record)
    except BaseException as error:
        problem = error
        try:
            run.retain("failure-" + digest({"error": str(error), "artifacts": run.files}) + ".json",
                       {"schema": SCHEMA + "/failure", "operation_id": value["operation_id"],
                        "error": str(error), "artifacts": run.files})
        except BaseException:
            pass
    finally:
        # Never release the retained operation owner while any native executor,
        # server or workspace remains uncertain. Close retries retain owners.
        while run.workspace is not None or run.server is not None or run.controller is not None or run.control is not None:
            try:
                run.close_operator()
            except BaseException as error:
                try:
                    emit({"status": "CLOSING_HELD", "error": str(error)})
                except BaseException:
                    pass
                time.sleep(1)
        if run.owner is not None:
            os.close(run.owner)
    if problem:
        raise problem
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BuyerError, OSError, ValueError, RuntimeError, KeyboardInterrupt) as error:
        print(json.dumps({"schema": SCHEMA, "status": "INTERRUPTED", "error": str(error)}), file=sys.stderr)
        raise SystemExit(130 if isinstance(error, KeyboardInterrupt) else 1)
