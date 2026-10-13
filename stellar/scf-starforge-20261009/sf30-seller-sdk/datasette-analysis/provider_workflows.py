"""Installed provider operations composed from the original partner-workflow CLIs.

The original CLI owns acquisition, source validation, preparation and receiving.
This controller retains operation/attempt identity, immutable file selections and
the explicit handoff to Workflow; it never writes to a provider business API.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import argparse
import fcntl
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile

SCHEMA = "stellar-forge.provider-workflows.v1"
OP_SCHEMA = "stellar-forge.provider-operation.v1"
HERE = Path(__file__).resolve().parent
KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}")
ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
CLIS = {
    "shopify-payments": "shopify_payments_cli.mjs",
    "xero-contacts": "xero_contacts_cli.mjs",
    "odoo-target": "odoo_target_cli.mjs",
}
ACTIONS = {
    "shopify-payments": ["capture", "inspect", "prepare", "handover", "receive", "configure"],
    "xero-contacts": ["capture", "inspect", "review", "compare", "prepare", "handover", "receive", "configure"],
    "odoo-target": ["capture", "inspect", "prepare", "reconcile", "handover", "receive", "configure"],
}
FIELDS = {
    "capture": set(),
    "inspect": {"captureOperationId"}, "review": {"captureOperationId"},
    "compare": {"beforeOperationId", "afterOperationId"},
    "prepare": {"captureOperationId", "contactsInputId", "decisions", "installationId"},
    "reconcile": {"captureOperationId", "baselineOperationId", "nativeResultInputId", "installationId"},
    "handover": {"captureOperationId", "preparedOperationId", "baselineOperationId", "nativeDeliveryInputId", "nativeRequestId"},
    "receive": {"handoverOperationId", "handoverInputId"},
    "configure": {"preparedOperationId", "installationId", "request"},
}


class ProviderWorkflowError(RuntimeError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def need(ok, code, message):
    if not ok:
        raise ProviderWorkflowError(code, message)


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value).encode()).hexdigest()


def key(value, label="ID"):
    need(isinstance(value, str) and KEY.fullmatch(value), "PROVIDER_ID", "Use a plain original " + label + ".")
    return value


def ordinary(path, directory=False):
    p = Path(path).expanduser().absolute()
    need(not p.is_symlink() and p.exists() and p.resolve() == p, "PROVIDER_PATH", "Use a canonical existing ordinary path.")
    need(p.is_dir() if directory else p.is_file(), "PROVIDER_PATH", "Use the complete original directory or file.")
    return p


def private_dir(path):
    p = Path(path).absolute()
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    ordinary(p, True)
    os.chmod(p, 0o700)
    return p


def read_json(path):
    p = ordinary(path)
    need(p.stat().st_size <= 64 * 1024 * 1024, "PROVIDER_JSON_SIZE", "Retain large source bodies in their original files.")
    return json.loads(p.read_bytes())


def atomic(path, value):
    p = Path(path)
    private_dir(p.parent)
    raw = canonical(value).encode() + b"\n"
    fd, temporary = tempfile.mkstemp(prefix=".provider-", dir=p.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, p)
        parent = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def immutable_json(path, value):
    p = Path(path)
    if p.exists():
        need(canonical(read_json(p)) == canonical(value), "PROVIDER_INPUT_CHANGED", "Retain the original complete operation input.")
    else:
        atomic(p, value)


def descriptor(path):
    p = ordinary(path)
    with p.open("rb") as f:
        result = {"bytes": os.fstat(f.fileno()).st_size,
                  "sha256": hashlib.file_digest(f, "sha256").hexdigest()}
    return result


def verify(path, expected):
    actual = descriptor(path)
    need(all(actual[k] == expected[k] for k in ("bytes", "sha256")),
         "PROVIDER_FILE_CHANGED", "The selected complete original file has changed.")
    return ordinary(path)


def copy_original(source, destination):
    source = ordinary(source)
    expected = descriptor(source)
    destination = Path(destination)
    private_dir(destination.parent)
    if destination.exists():
        verify(destination, expected)
        return expected
    fd, temporary = tempfile.mkstemp(prefix=".source-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush(); os.fsync(out.fileno())
        verify(temporary, expected)
        os.link(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
    verify(source, expected)
    return expected


def inventory(root):
    root = ordinary(root, True)
    rows = []
    for parent, dirs, names in os.walk(root, followlinks=False):
        dirs.sort(); names.sort()
        for name in dirs:
            ordinary(Path(parent) / name, True)
        for name in names:
            p = ordinary(Path(parent) / name)
            rows.append({"path": p.relative_to(root).as_posix(), **descriptor(p)})
    return rows


def process_identity(pid):
    try:
        raw = Path("/proc", str(int(pid)), "stat").read_text()
        tail = raw[raw.rfind(")") + 2:].split()
        if tail[0] == "Z":
            return None
        return {"pid": int(pid), "start": tail[19], "host": socket.gethostname(),
                "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (OSError, ValueError, IndexError):
        return None


def live(identity):
    return bool(identity and process_identity(identity.get("pid")) == identity)


@contextmanager
def locked(path, blocking=True):
    private_dir(Path(path).parent)
    with Path(path).open("a+b") as f:
        os.fchmod(f.fileno(), 0o600)
        try:
            fcntl.flock(f, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            raise ProviderWorkflowError("PROVIDER_RUNNING", "The original provider operation is still running.") from None
        try:
            yield f
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def lock_busy(path):
    try:
        with locked(path, False):
            return False
    except ProviderWorkflowError:
        return True


def last_json(path):
    text = ordinary(path).read_text(errors="replace")
    decoder = json.JSONDecoder()
    for line in reversed(text.splitlines()):
        try:
            value = json.loads(line)
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    for i, ch in enumerate(text):
        if ch == "{":
            try:
                value, end = decoder.raw_decode(text[i:])
                if not text[i + end:].strip() and isinstance(value, dict):
                    return value
            except ValueError:
                pass
    return None


class ProviderWorkflows:
    def __init__(self, workspace, configuration=None, configuration_file=None):
        self.workspace = ordinary(getattr(workspace, "path", workspace), True)
        self.root = private_dir(self.workspace / "provider-workflows")
        self.operations = private_dir(self.root / "operations")
        self.private = private_dir(self.root / "private")
        self.configuration = None
        self._children = []
        with sqlite3.connect(self.workspace / "source-workflow.sqlite3") as db:
            row = db.execute("SELECT value FROM workflow_meta WHERE key='workspaceId'").fetchone()
        need(row, "PROVIDER_WORKSPACE", "Open the original workflow workspace first.")
        self.workspace_id = row[0]
        from provider_inputs import ProviderInputs
        self.inputs = ProviderInputs(self.workspace, self.workspace_id)
        if configuration_file is not None:
            if isinstance(configuration_file, dict):
                configuration_file = verify(configuration_file["path"], configuration_file)
            original = read_json(configuration_file)
            need(configuration is None or canonical(configuration) == canonical(original),
                 "PROVIDER_CONFIGURATION_CHANGED", "The configured provider descriptor differs from its original file.")
            configuration = original
        if configuration is not None:
            self.configuration = self._configuration(configuration)
            self.configuration_path = self.private / ("configuration-" + digest(self.configuration) + ".json")
            immutable_json(self.configuration_path, self.configuration)

    def _configuration(self, value):
        need(isinstance(value, dict) and value.get("schema") == SCHEMA, "PROVIDER_CONFIGURATION", "Use the installed private provider descriptor.")
        need(set(value) <= {"schema", "node", "connections", "inputs", "installations"}, "PROVIDER_CONFIGURATION", "Use only supported installed provider fields.")
        cfg = json.loads(canonical(value))
        node = cfg.get("node")
        need(isinstance(node, str) and Path(node).is_absolute(), "PROVIDER_NODE", "Select the installed absolute Node executable.")
        ordinary(node)
        need(os.access(node, os.X_OK), "PROVIDER_NODE", "Select the installed executable Node runtime.")
        for group in ("connections", "inputs", "installations"):
            rows = cfg.setdefault(group, [])
            need(isinstance(rows, list), "PROVIDER_CONFIGURATION", "Use an installed selector list.")
            seen = set()
            for item in rows:
                need(isinstance(item, dict), "PROVIDER_CONFIGURATION", "Use complete installed selector records.")
                ident = key(item.get("id"), group + " ID")
                need(ident not in seen, "PROVIDER_CONFIGURATION", "Installed selector IDs must be unique.")
                seen.add(ident)
                need(isinstance(item.get("title", ident), str), "PROVIDER_CONFIGURATION", "Use a plain selector title.")
                if group == "connections":
                    need(item.get("provider") in CLIS and isinstance(item.get("capture"), dict), "PROVIDER_CONNECTION", "Select an original provider and its complete capture selection.")
                    need(ENV.fullmatch(item.get("tokenEnv", "")), "PROVIDER_CREDENTIAL_REFERENCE", "Select an existing credential environment reference.")
                    need(set(item) <= {"id", "title", "provider", "capture", "tokenEnv", "maxAttempts", "timeoutSeconds"}, "PROVIDER_CONNECTION", "Keep provider credentials in existing host environment references.")
                    # Original CLIs take tokens only through token-env, never JSON.
                    def no_secrets(obj):
                        if isinstance(obj, dict):
                            for k, v in obj.items():
                                need(k.lower().replace("_", "").replace("-", "") not in
                                     {"token", "accesstoken", "apikey", "password", "authorization", "clientsecret"},
                                     "PROVIDER_CREDENTIAL_VALUE", "Keep credential values in the existing host environment.")
                                no_secrets(v)
                        elif isinstance(obj, list):
                            for v in obj:
                                no_secrets(v)
                    no_secrets(item["capture"])
                    for field in ("maxAttempts", "timeoutSeconds"):
                        if field in item:
                            need(isinstance(item[field], int) and 1 <= item[field] <= 3600,
                                 "PROVIDER_CONNECTION", "Use positive original CLI execution limits.")
                elif group == "inputs":
                    need(isinstance(item.get("kind"), str) and isinstance(item.get("path"), str) and Path(item["path"]).is_absolute(),
                         "PROVIDER_INPUT", "Select an original absolute input file and its kind.")
                else:
                    need(re.fullmatch(r"[a-f0-9]{32}", item.get("operationId", "")), "PROVIDER_INSTALLATION", "Retain the original Analysis operation ID.")
                    for field in ("analysisWorkspace", "parser", "sourceArchive"):
                        need(isinstance(item.get(field), str) and Path(item[field]).is_absolute(), "PROVIDER_INSTALLATION", "Select absolute original installed paths.")
        return cfg

    def _selected(self, group, ident):
        need(self.configuration is not None, "PROVIDER_NOT_CONFIGURED", "Open with the installed private provider descriptor to start new work.")
        rows = [x for x in self.configuration[group] if x["id"] == ident]
        if group == "inputs" and not rows:
            return self.inputs.selected(ident)
        need(len(rows) == 1, "PROVIDER_SELECTION", "Select an existing installed " + group + " ID.")
        return rows[0]

    def begin_input(self, request):
        need(isinstance(request, dict), "PROVIDER_INPUT", "Select the complete original file.")
        configured = (self.configuration or {}).get("inputs", [])
        need(not any(x["id"] == request.get("inputId") for x in configured),
             "PROVIDER_INPUT_COLLISION", "Retain the configured original input and use a new received input ID.")
        return self.inputs.begin(request)

    def list_inputs(self):
        return self.inputs.list()

    def input_status(self, ident):
        return self.inputs.status(ident)

    def input_chunk(self, ident, *, offset, length, sha256, source):
        return self.inputs.chunk(ident, offset=offset, length=length, sha256=sha256, source=source)

    def complete_input(self, ident, request=None):
        return self.inputs.complete(ident, request)

    def input_file(self, ident):
        return self.inputs.file(ident)

    def _catalog_inputs(self, configured):
        rows = [{"id": x["id"], "title": x.get("title", x["id"]), "kind": x["kind"],
                 "available": Path(x["path"]).is_file(), "origin": "installed"}
                for x in configured]
        seen = {x["id"] for x in rows}
        for item in self.inputs.list()["inputs"]:
            need(item["id"] not in seen, "PROVIDER_INPUT_COLLISION",
                 "A received input ID conflicts with the installed configuration.")
            if item["status"] == "COMPLETE":
                rows.append(item)
        return rows

    def catalog(self):
        cfg = self.configuration or {"connections": [], "inputs": [], "installations": []}
        return {"schema": SCHEMA, "configured": self.configuration is not None, "workspaceId": self.workspace_id,
                "connections": [{"id": x["id"], "title": x.get("title", x["id"]), "provider": x["provider"],
                                 "credential": {"reference": x["tokenEnv"], "available": bool(os.environ.get(x["tokenEnv"]))},
                                 "selection": x["capture"], "actions": ACTIONS[x["provider"]]} for x in cfg["connections"]],
                "inputs": self._catalog_inputs(cfg["inputs"]),
                "installations": [{"id": x["id"], "title": x.get("title", x["id"]),
                                   "available": all(Path(x[k]).exists() for k in ("analysisWorkspace", "parser", "sourceArchive"))}
                                  for x in cfg["installations"]],
                "actions": ACTIONS, "nativeRequests": self._native_requests()}

    def _native_requests(self):
        from workflow_engine import Workflow
        with Workflow(self.workspace) as workflow:
            return [{k: row.get(k) for k in ("requestId", "profile", "status", "resultSha256", "deliveryId")}
                    for row in workflow.status()["requests"] if row.get("resultSha256")]

    def _directory(self, ident):
        return self.operations / key(ident, "operation ID")

    def _record(self, ident):
        record = read_json(self._directory(ident) / "operation.json")
        need(record.get("schema") == OP_SCHEMA and record.get("workspaceId") == self.workspace_id
             and record.get("id") == ident, "PROVIDER_OPERATION", "Retain this workspace's original provider operation.")
        return record

    def _active(self, record):
        return (lock_busy(self._directory(record["id"]) / "running.lock")
                or live(record.get("worker")) or live(record.get("command")))

    def _public(self, record):
        active = self._active(record)
        status = record["status"]
        if status in {"RUNNING", "QUEUED"} and not active:
            status = "INTERRUPTED"
        return {**{k: record.get(k) for k in ("id", "connectionId", "provider", "action", "title", "createdAt",
                                              "updatedAt", "inputs", "result", "error", "artifacts", "preparedOperation", "submission", "nativeDelivery", "nativeReceiving")},
                "schema": OP_SCHEMA, "status": status, "active": active,
                "attempts": [{k: a.get(k) for k in ("id", "status", "startedAt", "finishedAt", "exitCode", "worker", "command",
                                                   "recoverLockId", "error")} for a in record["attempts"]],
                "recovery": self._recovery(record)}

    def _recovery(self, record):
        if record["action"] != "capture":
            return None
        name = "capture.json.lock" if record["provider"] == "xero-contacts" else "capture.lock"
        p = self._directory(record["id"]) / "output" / "capture" / name / "owner.json"
        if not p.is_file():
            return None
        try:
            owner = read_json(p)
            return {"recoverLockId": owner.get("id") or digest(owner), "host": owner.get("host"), "pid": owner.get("pid")}
        except (OSError, ValueError, ProviderWorkflowError):
            return None

    def list_operations(self):
        rows = []
        for p in sorted(self.operations.iterdir()):
            if p.is_dir() and not p.is_symlink() and (p / "operation.json").is_file():
                rows.append(self.operation(p.name))
        rows.sort(key=lambda x: (x["updatedAt"], x["id"]), reverse=True)
        return {"schema": SCHEMA, "operations": rows}

    def operation(self, ident):
        return self._public(self._record(key(ident)))

    def _source(self):
        names = ["preparation.mjs", "profiles.mjs", "prepare_cli.mjs", "README.md", "SOURCE_CONTRACTS.md",
                 "shopify_payments.mjs", "shopify_payments_cli.mjs", "SHOPIFY_PAYMENTS.md",
                 "xero_contacts.mjs", "xero_contacts_cli.mjs", "XERO_CONTACTS.md",
                 "odoo_target.mjs", "odoo_target_cli.mjs", "ODOO_TARGET.md"]
        rows = []
        for name in names:
            p = HERE / "partner-workflows" / name
            rows.append({"path": str(p), **descriptor(p)})
        for name in ("workflow_cli.py", "workflow_engine.py", "provider_workflows.py", "provider_inputs.py"):
            p = HERE / name
            rows.append({"path": str(p), **descriptor(p)})
        return rows

    def _reference(self, ident, provider, actions, *, complete=True):
        r = self._record(key(ident))
        need(r["provider"] == provider and r["action"] in actions, "PROVIDER_REFERENCE", "Select the original compatible provider operation.")
        need(not complete or r["status"] == "COMPLETE", "PROVIDER_REFERENCE_INCOMPLETE", "Complete the selected original operation first.")
        if complete:
            for item in r["artifacts"]:
                verify(self._directory(r["id"]) / item["path"], item)
        return r

    def _role(self, record, role):
        relative = record.get("outputs", {}).get(role)
        need(isinstance(relative, str), "PROVIDER_OUTPUT_ROLE", "The selected operation has no original " + role + " output.")
        p = self._directory(record["id"]) / relative
        need(p.resolve().is_relative_to(self._directory(record["id"]).resolve()), "PROVIDER_OUTPUT_PATH", "Retain the original operation's output.")
        return p

    def _installation(self, ident, input_root):
        selected = self._selected("installations", ident)
        ordinary(selected["analysisWorkspace"], True)
        parser = descriptor(selected["parser"]); archive = descriptor(selected["sourceArchive"])
        result = {k: selected[k] for k in ("analysisWorkspace", "operationId", "parser", "sourceArchive")}
        p = input_root / "installation.json"
        immutable_json(p, result)
        return {"id": ident, "path": str(p), "selection": result,
                "files": [{"path": selected["parser"], **parser}, {"path": selected["sourceArchive"], **archive}]}

    def _input(self, ident, kinds, input_root, name):
        selected = self._selected("inputs", ident)
        need(selected["kind"] in kinds, "PROVIDER_INPUT_KIND", "Select an original input of kind " + ", ".join(kinds) + ".")
        dest = input_root / name
        receipt = copy_original(selected["path"], dest)
        return {"id": ident, "kind": selected["kind"], "path": str(dest),
                "originalName": selected.get("fileName") or Path(selected["path"]).name,
                **({"sourceInput": selected["inputRecord"]} if selected.get("inputRecord") else {}), **receipt}

    def _bind(self, body, connection, directory):
        action, inp, provider = body["action"], body["inputs"], connection["provider"]
        root = private_dir(directory / "input")
        bound = {"connection": connection, "node": self.configuration["node"], "source": self._source(),
                 "nodeIdentity": descriptor(self.configuration["node"]), "references": {}, "files": {}}
        reference_fields = {
            "captureOperationId": {"capture", "receive"},
            "beforeOperationId": {"capture", "receive"}, "afterOperationId": {"capture", "receive"},
            "preparedOperationId": {"prepare", "reconcile", "receive", "configure"},
            "baselineOperationId": {"prepare", "reconcile", "receive", "configure"},
            "handoverOperationId": {"handover"},
        }
        for field, allowed in reference_fields.items():
            if field in inp:
                ref = self._reference(inp[field], provider, allowed, complete=action != "inspect")
                need(action == "compare" or ref["connectionId"] == connection["id"],
                     "PROVIDER_CONNECTION_MISMATCH", "Select an operation from this installed connection; explicit comparison validates its original tenant separately.")
                bound["references"][field] = {"id": ref["id"], "submissionSha256": ref["submissionSha256"],
                                              "artifactsSha256": digest(ref["artifacts"])}
        required = {"inspect": ["captureOperationId"], "review": ["captureOperationId"],
                    "compare": ["beforeOperationId", "afterOperationId"], "prepare": ["captureOperationId"],
                    "reconcile": ["captureOperationId", "baselineOperationId", "nativeResultInputId"],
                    "handover": ["preparedOperationId"], "receive": [],
                    "configure": ["preparedOperationId", "installationId", "request"]}.get(action, [])
        for field in required:
            need(field in inp, "PROVIDER_INPUT_REQUIRED", "Supply the original " + field + ".")
        if action == "receive":
            need(("handoverOperationId" in inp) != ("handoverInputId" in inp), "PROVIDER_HANDOVER_SELECTION", "Select one retained operation or complete registered handover ZIP.")
            if "handoverInputId" in inp:
                bound["files"]["handover"] = self._input(inp["handoverInputId"], {"provider-handover", "handover"}, root, "provider-handover.zip")
        if action == "handover" and provider != "xero-contacts":
            need("captureOperationId" in inp, "PROVIDER_INPUT_REQUIRED", "Select the original capture for this handover.")
        if action == "prepare" and provider == "odoo-target":
            need("contactsInputId" in inp, "PROVIDER_INPUT_REQUIRED", "Select the complete original contacts input.")
        if action == "prepare" and provider == "xero-contacts":
            need(isinstance(inp.get("decisions"), dict), "PROVIDER_DECISIONS", "Retain the complete original Xero decision document.")
            immutable_json(root / "decisions.json", inp["decisions"])
            bound["files"]["decisions"] = {"path": str(root / "decisions.json"), **descriptor(root / "decisions.json")}
        if "contactsInputId" in inp:
            need(provider == "odoo-target" and action == "prepare", "PROVIDER_INPUT_KIND", "Contacts selection belongs to Odoo preparation.")
            bound["files"]["contacts"] = self._input(inp["contactsInputId"], {"contacts"}, root, "contacts.json")
        if "nativeResultInputId" in inp:
            bound["files"]["nativeResult"] = self._input(inp["nativeResultInputId"], {"native-result"}, root, "native-result.json")
        need(not ("nativeDeliveryInputId" in inp and "nativeRequestId" in inp), "PROVIDER_NATIVE_SELECTION", "Select one original native delivery.")
        if "nativeDeliveryInputId" in inp:
            bound["files"]["nativeDelivery"] = self._input(inp["nativeDeliveryInputId"], {"native-delivery"}, root, "native-delivery.zip")
        if "nativeRequestId" in inp:
            from workflow_engine import Workflow
            with Workflow(self.workspace) as workflow:
                row = workflow._row(inp["nativeRequestId"])
                need(bool(row["result_sha"]) and bool(row["configuration_json"]), "PROVIDER_NATIVE_PENDING", "Complete the original native business request first.")
                cfg = json.loads(row["configuration_json"])
                prepared_ref = self._record(bound["references"]["preparedOperationId"]["id"])
                prepared = self._role(prepared_ref, "prepared")
                metadata = cfg.get("source", {}).get("metadata")
                need(isinstance(metadata, dict), "PROVIDER_NATIVE_RELATION", "Select the native result from this complete original preparation.")
                verify(metadata["path"], metadata)
                native_input = read_json(metadata["path"]).get("originalInput", {})
                need(native_input.get("sha256") == descriptor(prepared / "original-input.json")["sha256"],
                     "PROVIDER_NATIVE_RELATION", "The native result belongs to a different original preparation.")
                bound["nativeRequest"] = {"requestId": row["request_id"], "requestSha256": row["request_sha"],
                                          "resultSha256": row["result_sha"], "configurationSha256": row["configuration_sha"]}
        if "installationId" in inp:
            bound["installation"] = self._installation(inp["installationId"], root)
        if action == "configure":
            request = inp["request"]
            need(isinstance(request, dict) and isinstance(request.get("requestId"), str) and request["requestId"],
                 "PROVIDER_BUSINESS_REQUEST", "Supply the complete original business request and its stable requestId.")
            need(isinstance(request.get("parameters", {}), dict), "PROVIDER_BUSINESS_REQUEST", "Keep the original business parameters.")
            immutable_json(root / "native-request.json", request)
            bound["files"]["request"] = {"path": str(root / "native-request.json"), **descriptor(root / "native-request.json")}
        return bound

    def submit(self, incoming):
        need(isinstance(incoming, dict) and set(incoming) <= {"operationId", "connectionId", "action", "inputs", "title", "recoverLockId"},
             "PROVIDER_SUBMISSION", "Use the complete provider operation form.")
        body = json.loads(canonical({k: v for k, v in incoming.items() if k != "recoverLockId"}))
        ident = key(body.get("operationId"), "operation ID")
        body.setdefault("inputs", {})
        need(isinstance(body["inputs"], dict), "PROVIDER_INPUTS", "Provider action inputs must be an object.")
        need(body.get("action") in FIELDS and set(body["inputs"]) <= FIELDS[body["action"]],
             "PROVIDER_ACTION", "Use the selected original action's supported inputs.")
        need(isinstance(body.get("title", ""), str) and len(body.get("title", "")) <= 300, "PROVIDER_TITLE", "Use a title of at most 300 characters.")
        directory = private_dir(self._directory(ident))
        with locked(directory / "launch.lock"):
            path = directory / "operation.json"
            record = self._record(ident) if path.exists() else None
            if record:
                need(record["submissionSha256"] == digest(body), "PROVIDER_OPERATION_CHANGED", "This operation ID already has different inputs; create a successor operation.")
                if record["status"] == "COMPLETE" or self._active(record):
                    return self._public(record)
            connection = self._selected("connections", body.get("connectionId"))
            need(body["action"] in ACTIONS[connection["provider"]], "PROVIDER_ACTION", "This provider does not implement that original action.")
            if record:
                need(canonical(record["binding"]["connection"]) == canonical(connection)
                     and record["binding"]["node"] == self.configuration["node"],
                     "PROVIDER_CONFIGURATION_CHANGED", "Resume with the same installed connection and executable.")
            else:
                binding = self._bind(body, connection, directory)
                timestamp = now()
                record = {"schema": OP_SCHEMA, "workspaceId": self.workspace_id, "id": ident,
                          "submission": body, "submissionSha256": digest(body), "connectionId": connection["id"],
                          "provider": connection["provider"], "action": body["action"],
                          "title": body.get("title") or (connection.get("title", connection["id"]) + " — " + body["action"]),
                          "inputs": body["inputs"], "createdAt": timestamp, "updatedAt": timestamp,
                          "status": "QUEUED", "attempts": [], "artifacts": [], "outputs": {}, "binding": binding}
            token = incoming.get("recoverLockId")
            if token is not None:
                recovery = self._recovery(record)
                need(record["action"] == "capture" and isinstance(token, str) and recovery
                     and recovery.get("recoverLockId") == token, "PROVIDER_RECOVERY_LOCK", "Select the actual retained original capture lock.")
            if record["action"] == "capture":
                need(bool(os.environ.get(connection["tokenEnv"])), "PROVIDER_CREDENTIAL_UNAVAILABLE", "The configured host credential reference is not available.")
            attempt = {"id": uuid.uuid4().hex, "status": "QUEUED", "startedAt": now(), "recoverLockId": token}
            record["attempts"].append(attempt)
            record.update(status="QUEUED", updatedAt=now(), error=None, worker=None, command=None)
            atomic(path, record)
            attempt_dir = private_dir(directory / "attempts" / attempt["id"])
            log = (attempt_dir / "runner.log").open("ab")
            try:
                proc = subprocess.Popen([sys.executable, "-B", str(HERE / "provider_workflows.py"),
                                         "--workspace", str(self.workspace), "--operation", ident, "--attempt", attempt["id"]],
                                        cwd=str(HERE), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                        start_new_session=True, close_fds=True)
                self._children.append(proc)
                identity = process_identity(proc.pid)
                need(identity, "PROVIDER_LAUNCH", "The original provider runner did not remain active.")
                record["worker"] = identity
                attempt["worker"] = identity
                atomic(path, record)
            except Exception as exc:
                record.update(status="INTERRUPTED", updatedAt=now(), error={"code": "PROVIDER_LAUNCH", "message": str(exc)})
                attempt.update(status="INTERRUPTED", finishedAt=now(), error=record["error"])
                atomic(path, record)
                raise
            finally:
                log.close()
        return self.operation(ident)

    def file(self, operation_id, file_id):
        record = self._record(key(operation_id))
        selected = [x for x in record["artifacts"] if x["id"] == file_id]
        need(len(selected) == 1, "PROVIDER_FILE", "Select an original retained artifact ID.")
        row = selected[0]
        p = self._directory(record["id"]) / row["path"]
        need(p.resolve().is_relative_to(self._directory(record["id"]).resolve()), "PROVIDER_FILE", "Retain this operation's original file.")
        return verify(p, row), dict(row)

    def prepared(self, operation_id):
        record = self._record(key(operation_id))
        need(record["status"] == "COMPLETE" and record["action"] == "configure", "PROVIDER_PREPARED", "Complete the original native configuration operation first.")
        selected = record["preparedOperation"]
        request_path, _ = self.file(record["id"], selected["requestFileId"])
        config_path, _ = self.file(record["id"], selected["configurationFileId"])
        request, configuration = read_json(request_path), read_json(config_path)
        need(request.get("requestId") == selected["requestId"] and request.get("profile") == configuration.get("profile"),
             "PROVIDER_PREPARED_CHANGED", "Retain the exact configured original business request.")
        for row in record["binding"].get("installation", {}).get("files", []):
            verify(row["path"], row)
        # Validate every generated source location again before the explicit run.
        for source in [configuration["source"], *configuration.get("relatedSources", {}).values()]:
            if source.get("kind") == "csv":
                verify(source["path"], {"bytes": source["bytes"], "sha256": source["sha256"]})
                if source.get("metadata"):
                    verify(source["metadata"]["path"], source["metadata"])
                need(descriptor(source["parser"])["sha256"] == source["parserSha256"],
                     "PROVIDER_PARSER_CHANGED", "Retain the exact installed parser selected during configuration.")
        if isinstance(configuration.get("sourceArchive"), dict):
            verify(configuration["sourceArchive"]["path"], configuration["sourceArchive"])
        return {"request": request, "configuration": configuration, **selected}

    def close(self):
        # The runner owns its operation lock and record; server shutdown does not
        # discard an in-flight capture or relaunch it under a different identity.
        for child in self._children:
            child.poll()
        self._children = []


class OperationRunner:
    def __init__(self, controller, record, attempt_id):
        self.controller, self.record = controller, record
        self.root = controller._directory(record["id"])
        self.path = self.root / "operation.json"
        self.attempt = next(a for a in record["attempts"] if a["id"] == attempt_id)
        self.attempt_root = private_dir(self.root / "attempts" / attempt_id)
        self.output = private_dir(self.root / "output")
        self.binding = record["binding"]
        self.provider = record["provider"]
        self.cli = [self.binding["node"], str(HERE / "partner-workflows" / CLIS[self.provider])]
        self.secrets = [os.environ.get(self.binding["connection"]["tokenEnv"], "")]
        self.secrets = sorted([s for s in self.secrets if s], key=len, reverse=True)
        self.command_count = 0

    def clean(self, value):
        if isinstance(value, str):
            for secret in self.secrets:
                value = value.replace(secret, "[host credential]")
            return value
        if isinstance(value, list):
            return [self.clean(x) for x in value]
        if isinstance(value, dict):
            return {k: self.clean(v) for k, v in value.items()}
        return value

    def save(self):
        self.record["updatedAt"] = now()
        atomic(self.path, self.record)

    def ref(self, name):
        selected = self.binding["references"][name]
        r = self.controller._record(selected["id"])
        need(r["submissionSha256"] == selected["submissionSha256"], "PROVIDER_REFERENCE_CHANGED", "Retain the original operation input selection.")
        if self.record["action"] != "inspect":
            need(r["status"] == "COMPLETE" and digest(r["artifacts"]) == selected["artifactsSha256"],
                 "PROVIDER_REFERENCE_CHANGED", "Retain the complete selected operation generation.")
            for row in r["artifacts"]:
                verify(self.controller._directory(r["id"]) / row["path"], row)
        return r

    def role(self, ref, role):
        return self.controller._role(ref, role)

    def role_out(self, role, path):
        path = Path(path)
        self.record["outputs"][role] = path.relative_to(self.root).as_posix()
        return path

    def run(self, args, label):
        self.command_count += 1
        base = self.attempt_root / ("%02d-%s" % (self.command_count, label))
        out, err = Path(str(base) + ".stdout.log"), Path(str(base) + ".stderr.log")
        p, code, command = None, None, None
        primary_error, cleanup_errors, drain_errors = None, [], []
        drains, started = [], []
        started_at = now()
        @contextmanager
        def logs():
            opened = []
            try:
                stdout = out.open("w"); opened.append(stdout)
                stderr = err.open("w"); opened.append(stderr)
                yield stdout, stderr
            finally:
                for sink in reversed(opened):
                    try:
                        sink.close()
                    except BaseException as exc:
                        cleanup_errors.append(exc)

        with logs() as (stdout, stderr):
            os.chmod(out, 0o600); os.chmod(err, 0o600)

            def drain(source, sink):
                writable = True
                try:
                    for line in iter(source.readline, b""):
                        if not writable:
                            continue
                        try:
                            sink.write(self.clean(line.decode("utf-8", errors="replace")))
                            sink.flush()
                        except BaseException as exc:
                            drain_errors.append(exc)
                            writable = False
                    if writable:
                        os.fsync(sink.fileno())
                except BaseException as exc:
                    drain_errors.append(exc)
                finally:
                    try:
                        source.close()
                    except BaseException as exc:
                        drain_errors.append(exc)

            try:
                p = subprocess.Popen([str(x) for x in args], cwd=str(HERE), stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False, close_fds=True)
                ident = process_identity(p.pid)
                self.record["command"] = ident
                self.attempt["command"] = ident
                command = {"label": label, "command": ident, "startedAt": started_at}
                self.attempt.setdefault("commands", []).append(command)
                drains = [(p.stdout, threading.Thread(target=drain, args=(p.stdout, stdout))),
                          (p.stderr, threading.Thread(target=drain, args=(p.stderr, stderr)))]
                for source, thread in drains:
                    thread.start()
                    started.append(thread)
                self.save()
                code = p.wait()
            except BaseException as exc:
                primary_error = exc
            finally:
                if p is not None:
                    # A failed journal write or interrupted waiter still owns
                    # this exact child. Receive it before releasing either log.
                    if primary_error is not None and p.poll() is None:
                        try:
                            p.terminate()
                        except ProcessLookupError:
                            pass
                        except BaseException as exc:
                            cleanup_errors.append(exc)
                    killed = False
                    while p.returncode is None:
                        try:
                            code = p.wait(timeout=5 if not killed and
                                          (primary_error is not None or cleanup_errors) else None)
                        except subprocess.TimeoutExpired:
                            try:
                                p.kill()
                                killed = True
                            except ProcessLookupError:
                                killed = True
                            except BaseException as exc:
                                cleanup_errors.append(exc)
                        except BaseException as exc:
                            cleanup_errors.append(exc)
                            if not killed:
                                try:
                                    p.kill()
                                    killed = True
                                except ProcessLookupError:
                                    killed = True
                                except BaseException as stop_error:
                                    cleanup_errors.append(stop_error)
                    code = p.returncode
                    # Pipes belong to this child immediately after Popen,
                    # including failures before identities or threads exist.
                    # Started readers retain their pipes until the original EOF.
                    owned = {source for source, thread in drains if thread in started}
                    for source in (p.stdout, p.stderr):
                        if source is not None and source not in owned:
                            try:
                                source.close()
                            except BaseException as exc:
                                cleanup_errors.append(exc)
                    for thread in started:
                        while thread.is_alive():
                            try:
                                thread.join()
                            except BaseException as exc:
                                cleanup_errors.append(exc)
        # All started readers have finished before the sink contexts close.
        # Preserve actual process outcomes even when the earlier save failed.
        if command is None and p is not None:
            command = {"label": label, "command": process_identity(p.pid), "startedAt": started_at}
            self.attempt.setdefault("commands", []).append(command)
        if command is not None:
            command["finishedAt"] = now()
            if code is not None:
                command["exitCode"] = code
            if primary_error is not None:
                command["error"] = {"code": getattr(primary_error, "code", type(primary_error).__name__),
                                    "message": self.clean(str(primary_error))}
            failures = [*cleanup_errors, *drain_errors]
            if failures:
                command["cleanupErrors"] = [
                    {"code": getattr(exc, "code", type(exc).__name__), "message": self.clean(str(exc))}
                    for exc in failures]
        if p is not None and p.returncode is not None:
            self.record["command"] = None
        if code is not None and code:
            self.attempt["exitCode"] = code
        try:
            self.save()
        except BaseException as exc:
            if primary_error is None:
                primary_error = exc
            else:
                primary_error.add_note("Provider command final receipt could not be saved: " + self.clean(str(exc)))
        if primary_error is not None:
            raise primary_error
        need(not cleanup_errors, "PROVIDER_COMMAND_CLOSE", "Receive the original command's complete process and output closure.")
        need(not drain_errors, "PROVIDER_LOG_WRITE", "Retain the complete original command diagnostics.")
        need(code is not None, "PROVIDER_COMMAND_CLOSE", "Receive the original command's actual exit before continuing.")
        # Original source bytes stay untouched. Process diagnostics are redacted
        # before writing; tokens never appear in argv or a persisted config.
        result = last_json(out)
        if code:
            error = last_json(err) or {"error": "PROVIDER_CLI_EXIT", "detail": "Original CLI exited " + str(code)}
            raise ProviderWorkflowError(str(error.get("error", "PROVIDER_CLI_EXIT")),
                                        self.clean(canonical(error)))
        need(result is not None, "PROVIDER_CLI_RESULT", "The original CLI did not return its complete JSON result.")
        return self.clean(result)

    def source_checks(self):
        verify(self.binding["node"], self.binding["nodeIdentity"])
        for row in self.binding["source"]:
            verify(row["path"], row)
        for row in self.binding["files"].values():
            verify(row["path"], row)
        for row in self.binding.get("installation", {}).get("files", []):
            verify(row["path"], row)

    def installation_args(self):
        installed = self.binding.get("installation")
        return ["--installation", installed["path"]] if installed else []

    def capture_of(self, record):
        if "capture" in record.get("outputs", {}):
            return self.role(record, "capture")
        references = record.get("binding", {}).get("references", {})
        reference = references.get("captureOperationId") or references.get("preparedOperationId")
        need(reference, "PROVIDER_CAPTURE_LINEAGE", "Select a preparation retaining its original capture lineage.")
        return self.capture_of(self.controller._record(reference["id"]))

    def execute(self):
        self.source_checks()
        action = self.record["action"]
        if action == "capture":
            conn = self.binding["connection"]
            if self.provider == "xero-contacts":
                folder = private_dir(self.output / "capture")
                state = folder / "capture.json"
                self.role_out("capture", state)
                if self.attempt.get("recoverLockId"):
                    lock = Path(str(state) + ".lock")
                    owner = read_json(lock / "owner.json")
                    need(digest(owner) == self.attempt["recoverLockId"] and process_identity(owner.get("pid")) is None,
                         "PROVIDER_RECOVERY_LOCK", "The original Xero lock has changed or its process is still present.")
                    known = [c.get("command") for a in self.record["attempts"][:-1] for c in a.get("commands", [])]
                    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
                    need(any(x and x.get("pid") == owner.get("pid") and x.get("host") == socket.gethostname()
                             and x.get("boot") == boot for x in known),
                         "PROVIDER_RECOVERY_LOCK", "Reconcile the original Xero lock on its recorded host before retrying.")
                    retained = self.attempt_root / "closed-original-xero-lock"
                    os.rename(ordinary(lock, True), retained)
                selection = conn["capture"]
                need(set(selection) <= {"tenant", "tenantId", "pageSize", "maxRecords"},
                     "PROVIDER_XERO_SELECTION", "Use the original Xero tenant, page size and record limit.")
                args = ["capture", "--state", state, "--tenant", selection.get("tenantId", selection.get("tenant", "")),
                        "--token-env", conn["tokenEnv"]]
                if "pageSize" in selection:
                    args += ["--page-size", str(selection["pageSize"])]
                if "maxRecords" in selection:
                    args += ["--max-records", str(selection["maxRecords"])]
            else:
                config = self.root / "input" / "capture-selection.json"
                immutable_json(config, conn["capture"])
                folder = self.output / "capture"
                self.role_out("capture", folder)
                args = ["capture", "--config", config, "--out", folder, "--token-env", conn["tokenEnv"]]
                for field, flag in (("maxAttempts", "--max-attempts"), ("timeoutSeconds", "--timeout-seconds")):
                    if field in conn:
                        args += [flag, str(conn[field])]
                if self.attempt.get("recoverLockId"):
                    args += ["--recover-lock", self.attempt["recoverLockId"]]
            self.save()
            return self.run(self.cli + args, action)
        if action in {"inspect", "review"}:
            capture = self.capture_of(self.ref("captureOperationId"))
            if self.provider == "xero-contacts":
                target = self.output / ("review-" + self.attempt["id"] + ".json")
                result = self.run(self.cli + ["review", "--capture", capture, "--out", target], "review")
                self.role_out("review", target)
                return result
            return self.run(self.cli + ["inspect", "--input", capture], "inspect")
        if action == "compare":
            target = self.output / "comparison.json"
            result = self.run(self.cli + ["compare", "--before", self.capture_of(self.ref("beforeOperationId")),
                                         "--after", self.capture_of(self.ref("afterOperationId")), "--out", target], action)
            self.role_out("comparison", target)
            return result
        if action in {"prepare", "reconcile"}:
            capture = self.capture_of(self.ref("captureOperationId"))
            output = self.output / "prepared"
            args = [action, "--out", output]
            if self.provider == "xero-contacts":
                args += ["--capture", capture, "--decisions", self.binding["files"]["decisions"]["path"]]
            else:
                args += ["--input", capture]
                if action == "prepare" and self.provider == "odoo-target":
                    args += ["--contacts", self.binding["files"]["contacts"]["path"]]
                if action == "reconcile":
                    args += ["--baseline", self.role(self.ref("baselineOperationId"), "prepared"),
                             "--native-result", self.binding["files"]["nativeResult"]["path"]]
            result = self.run(self.cli + args + self.installation_args(), action)
            self.role_out("prepared", output)
            return result
        if action == "handover":
            selected_prepared = self.ref("preparedOperationId")
            original_prepared = selected_prepared
            while original_prepared["action"] == "configure":
                parent = original_prepared["binding"]["references"]["preparedOperationId"]
                prior = self.controller._record(parent["id"])
                need(prior["status"] == "COMPLETE" and prior["submissionSha256"] == parent["submissionSha256"]
                     and digest(prior["artifacts"]) == parent["artifactsSha256"], "PROVIDER_PREPARATION_LINEAGE", "Retain the original provider preparation behind this native configuration.")
                original_prepared = prior
            prepared = self.role(original_prepared, "prepared")
            for row in original_prepared["artifacts"]:
                verify(self.controller._directory(original_prepared["id"]) / row["path"], row)
            output = self.output / "handover"
            native = self.native_delivery()
            if self.provider == "xero-contacts":
                private_dir(output)
                original = output / "prepared"
                result = self.run(self.cli + ["receive", "--input", prepared, "--out", original], "handover")
                self.role_out("prepared", original)
                self.role_out("capture", original / "xero-capture.json")
                if native:
                    copy_original(native, output / "native" / "delivery.zip")
                immutable_json(output / "provider-handover.json", {
                    "schema": "stellar-forge.xero-prepared-handover-transport.v1",
                    "operationId": self.record["id"], "prepared": "prepared",
                    "preparedManifest": descriptor(original / "manifest.json"),
                    "nativeDelivery": ({"path": "native/delivery.zip", **descriptor(output / "native" / "delivery.zip")} if native else None)})

            else:
                capture = self.capture_of(self.ref("captureOperationId"))
                if self.provider == "shopify-payments" and output.exists():
                    # Original Shopify handover requires a fresh destination.
                    # Its own receiver validates an already published handover
                    # after a lost monitor; no second handover is manufactured.
                    saved = read_json(output / "handover.json")
                    need(saved["captureManifestSha256"] == descriptor(capture / "capture-manifest.json")["sha256"]
                         and saved["preparedManifestSha256"] == descriptor(prepared / "manifest.json")["sha256"],
                         "PROVIDER_HANDOVER_CHANGED", "The retained handover is from different original inputs.")
                    expected_native = descriptor(native) if native else None
                    actual_native = saved.get("nativeDelivery")
                    need(bool(expected_native) == bool(actual_native) and
                         (not expected_native or all(expected_native[k] == actual_native[k] for k in ("bytes", "sha256"))),
                         "PROVIDER_HANDOVER_CHANGED", "The retained original native delivery differs.")
                    verified = self.output / ("verified-handover-" + self.attempt["id"])
                    result = self.run(self.cli + ["receive", "--input", output, "--out", verified], "handover-reopen")
                else:
                    args = ["handover", "--input", capture, "--prepared", prepared, "--out", output]
                    if "baselineOperationId" in self.binding["references"]:
                        args += ["--baseline-capture", self.capture_of(self.ref("baselineOperationId"))]
                    if native:
                        args += ["--native-delivery", native]
                    result = self.run(self.cli + args, action)
                self.role_out("prepared", output / "prepared")
                self.role_out("capture", output / "capture")
            self.role_out("handover", output)
            self.archive(output, self.output / "provider-handover.zip")
            return result
        if action == "receive":
            original = (self.receive_transport() if "handover" in self.binding["files"]
                        else self.role(self.ref("handoverOperationId"), "handover"))
            output = self.output / "received"
            if self.provider == "xero-contacts":
                transport = read_json(original / "provider-handover.json")
                need(transport.get("schema") == "stellar-forge.xero-prepared-handover-transport.v1"
                     and transport.get("prepared") == "prepared", "PROVIDER_HANDOVER", "Retain the original Xero preparation transport.")
                verify(original / "prepared" / "manifest.json", transport["preparedManifest"])
                private_dir(output)
                result = self.run(self.cli + ["receive", "--input", original / "prepared", "--out", output / "prepared"], action)
                if transport.get("nativeDelivery"):
                    source = verify(original / "native" / "delivery.zip", transport["nativeDelivery"])
                    copy_original(source, output / "native" / "delivery.zip")
                immutable_json(output / "provider-handover.json", transport)
            else:
                result = self.run(self.cli + ["receive", "--input", original, "--out", output], action)
            self.role_out("handover", output)
            self.role_out("prepared", output / "prepared")
            self.role_out("capture", output / "prepared" / "xero-capture.json" if self.provider == "xero-contacts" else output / "capture")
            self.archive(output, self.output / "received-provider-handover.zip")
            native = output / "native" / "delivery.zip"
            if native.is_file():
                from workflow_engine import Workflow
                native_id = descriptor(native)
                received = Workflow.receive(native, self.output / "received-workflow",
                                            expected_sha256=native_id["sha256"],
                                            analysis_destination=self.output / "received-analysis")
                self.role_out("nativeWorkflow", self.output / "received-workflow")
                self.role_out("nativeAnalysis", self.output / "received-analysis")
                self.record["nativeReceiving"] = {
                    "workflowDirectory": str(self.output / "received-workflow"),
                    "analysisDirectory": str(self.output / "received-analysis"),
                    "requestId": received.get("requestId"), "status": received.get("status"),
                    "archive": {"path": native.relative_to(self.root).as_posix(), **native_id},
                    "result": received}
                immutable_json(self.output / "native-receiving.json", self.record["nativeReceiving"])
                result = {"provider": result, "native": received}
            return result
        if action == "configure":
            return self.configure()
        raise ProviderWorkflowError("PROVIDER_ACTION", "Select an installed original provider action.")

    def receive_transport(self):
        """Receive only a registered complete ZIP; original provider validation follows."""
        selected = self.binding["files"]["handover"]
        archive = verify(selected["path"], selected)
        root = self.output / "incoming-handover"
        received = self.output / "incoming-handover-transport.json"
        if root.exists():
            marker = read_json(received)
            need(marker.get("archiveSha256") == selected["sha256"], "PROVIDER_TRANSPORT_CHANGED", "Resume the same complete source handover.")
            need(canonical(inventory(root)) == canonical(marker["files"]), "PROVIDER_TRANSPORT_CHANGED", "The retained received source differs.")
            copy_original(archive, self.output / "Original_Provider_Handover.zip")
            return root
        staging = private_dir(self.output / ("incoming-handover.pending-" + self.attempt["id"]))
        need(not any(staging.iterdir()), "PROVIDER_TRANSPORT_PENDING", "Retain the original interrupted transport and resume with its next attempt.")
        try:
            with zipfile.ZipFile(archive) as z:
                entries = z.infolist()
                need(len(entries) <= 100000 and len(entries) == len({x.filename for x in entries}),
                     "PROVIDER_TRANSPORT_MEMBERS", "Use one complete source transport with unique members.")
                files = []
                for info in entries:
                    name = info.filename
                    relative = Path(name)
                    mode = (info.external_attr >> 16) & 0o170000
                    need(name and not relative.is_absolute() and relative.as_posix() == name.rstrip("/")
                         and all(x not in {"", ".", ".."} for x in relative.parts)
                         and "\\" not in name and "\0" not in name and not info.flag_bits & 1
                         and mode in {0, stat.S_IFREG, stat.S_IFDIR},
                         "PROVIDER_TRANSPORT_PATH", "Use ordinary original relative handover members.")
                    target = staging / relative
                    if info.is_dir():
                        private_dir(target)
                        continue
                    private_dir(target.parent)
                    hasher, total = hashlib.sha256(), 0
                    with z.open(info) as source, target.open("xb") as sink:
                        os.chmod(target, 0o600)
                        while block := source.read(1024 * 1024):
                            total += len(block)
                            need(total <= info.file_size, "PROVIDER_TRANSPORT_LENGTH", "Retain the complete declared original member.")
                            hasher.update(block); sink.write(block)
                        sink.flush(); os.fsync(sink.fileno())
                    need(total == info.file_size, "PROVIDER_TRANSPORT_LENGTH", "The complete original member is required.")
                    files.append({"path": name, "bytes": total, "sha256": hasher.hexdigest()})
                files.sort(key=lambda x: x["path"])
            need(canonical(inventory(staging)) == canonical(files), "PROVIDER_TRANSPORT_MEMBERS", "The received ordinary member inventory differs.")
            marker = {"schema": "stellar-forge.provider-directory-received.v1",
                      "archiveSha256": selected["sha256"], "archiveBytes": selected["bytes"], "files": files}
            immutable_json(received, marker)
            os.rename(staging, root)
            copy_original(archive, self.output / "Original_Provider_Handover.zip")
            return root
        except BaseException:
            if staging.exists():
                shutil.rmtree(staging)
            raise

    def native_delivery(self):
        if "nativeDelivery" in self.binding["files"]:
            return verify(self.binding["files"]["nativeDelivery"]["path"], self.binding["files"]["nativeDelivery"])
        selected = self.binding.get("nativeRequest")
        if not selected:
            return None
        from workflow_engine import Workflow
        with Workflow(self.controller.workspace) as workflow:
            row = workflow._row(selected["requestId"])
            need(row["request_sha"] == selected["requestSha256"] and row["result_sha"] == selected["resultSha256"]
                 and row["configuration_sha"] == selected["configurationSha256"],
                 "PROVIDER_NATIVE_CHANGED", "Retain the selected original native request result and configuration.")
            target = self.output / ("Source_Workflow_" + row["run_id"] + "_" + row["result_sha"][:12] + ".zip")
            exported = workflow.export(selected["requestId"], target)
        archive = verify(exported["archive"]["path"], exported["archive"])
        self.record["nativeDelivery"] = {**selected, "archive": {"path": archive.relative_to(self.root).as_posix(), **descriptor(archive)}}
        self.save()
        return archive

    def configure(self):
        reference = self.ref("preparedOperationId")
        prepared = self.role(reference, "prepared")
        installed = self.binding["installation"]["selection"]
        # Regenerate the installed template with the ORIGINAL transformation,
        # retaining the complete original preparation input. The old bundle and
        # its source remain immutable and downloadable through their operation.
        target = self.output / "native-prepared"
        self.run([self.binding["node"], HERE / "partner-workflows" / "prepare_cli.mjs",
                  "prepare", "--input", prepared / "original-input.json", "--out", target,
                  "--installation", self.binding["installation"]["path"]], "native-template")
        template = read_json(target / "profile-template.json")
        request = read_json(self.binding["files"]["request"]["path"])
        need(request.get("profile") == template["profile"], "PROVIDER_REQUEST_PROFILE", "Keep the business request's original prepared profile.")
        need(request.get("schema", "stellar-forge.source-workflow-request.v1") == "stellar-forge.source-workflow-request.v1",
             "PROVIDER_BUSINESS_REQUEST", "Use the original source workflow request schema.")
        params = request.get("parameters", {})
        names = {name for query in template.get("analysis", {}).get("queries", []) for name in query.get("parameterNames", [])}
        need(all(name in params for name in names), "PROVIDER_BUSINESS_PARAMETERS", "Supply the actual original business selection: " + ", ".join(sorted(names)) + ".")
        config_path = self.output / "native-configuration.json"
        args = [sys.executable, HERE / "workflow_cli.py", "configure", "--template", target / "profile-template.json",
                "--output", config_path, "--analysis-workspace", installed["analysisWorkspace"],
                "--operation-id", installed["operationId"], "--source-archive", installed["sourceArchive"],
                "--source-csv", target / Path(template["source"]["path"]).name,
                "--source-metadata", target / "original-metadata.json"]
        for alias, source in template.get("relatedSources", {}).items():
            args += ["--related-csv", alias + "=" + str(target / Path(source["path"]).name),
                     "--related-metadata", alias + "=" + str(target / "original-metadata.json")]
        result = self.run(args, "native-configure")
        configuration = read_json(config_path)
        need(configuration.get("profile") == request["profile"], "PROVIDER_REQUEST_PROFILE", "Retain the configured original profile.")
        request_path = self.output / "native-request.json"
        immutable_json(request_path, request)
        self.role_out("prepared", target)
        self.role_out("configuration", config_path)
        self.role_out("request", request_path)
        self.record["preparedOperation"] = {"requestId": request["requestId"], "profile": request["profile"],
                                             "installationId": self.record["inputs"]["installationId"],
                                             "configurationSha256": descriptor(config_path)["sha256"],
                                             "requestSha256": descriptor(request_path)["sha256"]}
        return result

    def archive(self, source, destination):
        rows = inventory(source)
        manifest_path = destination.with_suffix(".transport.json")
        transport = {"schema": "stellar-forge.provider-directory-transport.v1",
                     "operationId": self.record["id"], "files": rows}
        if destination.exists():
            need(canonical(read_json(manifest_path)) == canonical(transport), "PROVIDER_TRANSPORT_CHANGED", "The complete original handover transport differs.")
            with zipfile.ZipFile(destination) as z:
                need(sorted(z.namelist()) == sorted(x["path"] for x in rows), "PROVIDER_TRANSPORT_CHANGED", "Retain every original handover member.")
                for row in rows:
                    with z.open(row["path"]) as f:
                        need(hashlib.file_digest(f, "sha256").hexdigest() == row["sha256"], "PROVIDER_TRANSPORT_CHANGED", "The original handover transport member differs.")
            return
        temporary = destination.with_name(destination.name + ".pending-" + uuid.uuid4().hex)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as z:
                for row in rows:
                    p = verify(source / row["path"], row)
                    z.write(p, row["path"])
            immutable_json(manifest_path, transport)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def finish_artifacts(self, successful):
        rows = []
        roots = [self.attempt_root]
        if successful:
            roots.append(self.output)
        for root in roots:
            for parent, dirs, names in os.walk(root, followlinks=False):
                dirs.sort(); names.sort()
                if root == self.output and Path(parent) == self.output:
                    # These are complete editable original applications. Their
                    # immutable input ZIP and receiving result are downloadable;
                    # a later user edit must not invalidate this operation.
                    dirs[:] = [d for d in dirs if d not in {"received-workflow", "received-analysis"}]
                for d in dirs:
                    ordinary(Path(parent) / d, True)
                for name in names:
                    p = Path(parent) / name
                    if name == "runner.log" or name.endswith(".private") or ".pending-" in name:
                        continue
                    relative = p.relative_to(self.root).as_posix()
                    row = {"path": relative, "name": name, **descriptor(p),
                           "contentType": mimetypes.guess_type(name)[0] or "application/octet-stream",
                           "role": "log" if root == self.attempt_root else "provider-output"}
                    row["id"] = digest({"path": relative, "sha256": row["sha256"]})[:32]
                    rows.append(row)
        previous = [x for x in self.record.get("artifacts", []) if x["path"].startswith("attempts/")]
        self.record["artifacts"] = sorted({x["path"]: x for x in previous + rows}.values(), key=lambda x: x["path"])
        if successful and self.record.get("preparedOperation"):
            for role, field in (("request", "requestFileId"), ("configuration", "configurationFileId")):
                path = self.record["outputs"][role]
                selected = next(x for x in self.record["artifacts"] if x["path"] == path)
                self.record["preparedOperation"][field] = selected["id"]


def run_operation(workspace, operation_id, attempt_id):
    controller = ProviderWorkflows(workspace)
    directory = controller._directory(operation_id)
    running = None
    with locked(directory / "launch.lock"):
        record = controller._record(operation_id)
        need(record["attempts"][-1]["id"] == attempt_id, "PROVIDER_ATTEMPT_CHANGED", "Run the current original operation attempt.")
        need(not live(record.get("command")), "PROVIDER_RUNNING", "The retained original CLI process is still running.")
        running = (directory / "running.lock").open("a+b")
        fcntl.flock(running, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record["worker"] = process_identity(os.getpid())
        record["status"] = "RUNNING"
        record["attempts"][-1].update(status="RUNNING", worker=record["worker"])
        record["updatedAt"] = now()
        atomic(directory / "operation.json", record)
    runner = OperationRunner(controller, record, attempt_id)
    code = 1
    try:
        result = runner.execute()
        runner.record["result"] = result
        runner.finish_artifacts(True)
        runner.record.update(status="COMPLETE", error=None)
        runner.attempt.update(status="COMPLETE", finishedAt=now(), exitCode=0)
        code = 0
    except BaseException as exc:
        error = {"code": getattr(exc, "code", "PROVIDER_EXECUTION"), "message": runner.clean(str(exc))}
        runner.record.update(status="INTERRUPTED" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "FAILED", error=error)
        runner.attempt.update(status=runner.record["status"], finishedAt=now(), exitCode=runner.attempt.get("exitCode", 1), error=error)
        try:
            runner.finish_artifacts(False)
        except Exception as file_error:
            error["artifactError"] = runner.clean(str(file_error))
    finally:
        # Retain the exact last process identities. Their /proc start/boot
        # identity decides activity after exit, including an interrupted waiter
        # whose original CLI child is still completing.
        if not live(runner.record.get("command")):
            runner.record["command"] = None
        runner.save()
        fcntl.flock(running, fcntl.LOCK_UN)
        running.close()
        controller.close()
    return code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--attempt", required=True)
    args = parser.parse_args()
    raise SystemExit(run_operation(args.workspace, args.operation, args.attempt))
