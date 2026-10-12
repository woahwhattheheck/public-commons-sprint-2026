#!/usr/bin/env python3
"""Continue the complete institutional-access workflow on an original audit backup.

One owner process holds the original audit HTTPS host, the supplied maintained
HTTPS OIDC practice provider, and one browser child. All credentials and live
workspaces stay in the caller's private operation directory.
"""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit

PROVIDER_SHA256 = "1cde024aebaf92050d35a8d20f015755ecb587bfbf79728689fec1da5f998b37"
RESULT_NAME = "UMICH_Institutional_Receiving_Result.json"
READY_NAME = "private-institutional-ready.json"
FORMAT = "commons-audit-institutional-receiving/1"
SOURCE_ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def write(path, value):
    body = value if isinstance(value, bytes) else canonical(value) + b"\n"
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("wb") as stream:
        os.chmod(temporary, 0o600)
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_json(path):
    return json.loads(path.read_bytes())


def identity(path):
    data = path.read_bytes()
    return {"path": str(path), "bytes": len(data), "sha256": digest(data)}


def event(stage, **detail):
    print(json.dumps({"stage": stage, **detail}), flush=True)


class Journey:
    def __init__(self, args):
        self.args = args
        self.root = Path(args.operation).resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.stat().st_mode & 0o077:
            raise ValueError("The operation directory must be private.")
        self.lease = (self.root / "native.lock").open("a+b")
        os.chmod(self.lease.name, 0o600)
        fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.result_path = self.root / RESULT_NAME
        self.result = read_json(self.result_path) if self.result_path.exists() else {
            "schema": FORMAT, "operation_id": args.operation_id, "status": "RUNNING",
            "started_at": time.time(), "phases": {},
        }
        if self.result.get("operation_id") != args.operation_id:
            raise ValueError("Continue this operation's original identity.")
        self.private_path = self.root / "private-receiving-state.json"
        self.private = read_json(self.private_path) if self.private_path.exists() else {
            "backup_passphrase": secrets.token_urlsafe(36),
        }
        write(self.private_path, self.private)
        self.provider = self.server = self.server_thread = self.child = None
        self.workspace = self.root / "institutional-workspace"
        self.log = (self.root / "private-native.log").open("a", encoding="utf-8")
        os.chmod(self.log.name, 0o600)
        self.closed = False

    def save(self):
        write(self.result_path, self.result)

    def setup(self):
        if self.args.dependencies:
            sys.path.insert(0, str(Path(self.args.dependencies).resolve()))
        sys.path.insert(0, str(SOURCE_ROOT))
        import jwt
        from audit_operator import archive, host, store
        self.archive, self.host, self.store_module = archive, host, store
        if jwt.__version__ != "2.15.1":
            raise ValueError("Use the declared PyJWT 2.15.1 dependency.")
        selected = read_json(Path(self.args.source_pins))
        for row in selected["files"]:
            name = row["path"]
            if name.startswith("/") or ".." in Path(name).parts:
                raise ValueError("The source closure uses application-relative paths.")
            p = SOURCE_ROOT / name
            actual = identity(p)
            if actual["bytes"] != row["bytes"] or actual["sha256"] != row["sha256"]:
                raise ValueError("Pinned source changed: " + name)
        self.result["source"] = {
            "selection": identity(Path(self.args.source_pins)),
            "source_reference": selected.get("source_reference"),
            "files": selected["files"],
        }
        editions = self.result.setdefault("source_editions", [])
        if not editions or editions[-1]["selection"]["sha256"] != self.result["source"]["selection"]["sha256"]:
            editions.append({**self.result["source"], "selected_at": time.time()})
        fixture = Path(self.args.provider_file).resolve()
        if identity(fixture)["sha256"] != PROVIDER_SHA256:
            raise ValueError("Select the exact maintained HTTPS practice provider.")
        spec = importlib.util.spec_from_file_location("maintained_institutional_provider", fixture)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.provider_type = module.IdentityProvider
        self.result["provider_source"] = identity(fixture)
        original = Path(self.args.original_backup).resolve()
        original_identity = identity(original)
        if original_identity["sha256"] != self.args.original_sha256:
            raise ValueError("The original completed audit backup differs from its receiving reference.")
        if "original_backup" in self.result and self.result["original_backup"] != original_identity:
            raise ValueError("This continuation already selected another original backup.")
        self.result["original_backup"] = original_identity
        retained_original = self.root / "Original_Completed_Audit_Backup.cab"
        if retained_original.exists():
            if identity(retained_original)["sha256"] != original_identity["sha256"]:
                raise ValueError("The retained original case input has different bytes.")
        else:
            write(retained_original, original.read_bytes())
        source_phrase = store.private_bytes(Path(self.args.passphrase_file), 4096)
        retained_key = self.root / "private-original-case-recovery-key.txt"
        if retained_key.exists():
            if store.private_bytes(retained_key, 4096) != source_phrase:
                raise ValueError("Continue with the same original private recovery key.")
        else:
            write(retained_key, source_phrase)
        self.result["retained_original_backup"] = identity(retained_original)
        self.private["original_passphrase_file"] = str(retained_key)
        write(self.private_path, self.private)
        if not self.workspace.exists():
            phrase = store.private_bytes(Path(self.args.passphrase_file), 4096).decode().rstrip("\r\n")
            restored = archive.restore_backup(original.read_bytes(), phrase, self.workspace)
            self.result["original_receiving"] = restored
        elif "original_receiving" not in self.result:
            with sqlite3.connect((self.workspace / "workspace.sqlite").as_uri() + "?mode=ro", uri=True) as db:
                values = dict(db.execute("SELECT key,value FROM settings"))
            if values.get("restored_from") != original_identity["sha256"]:
                raise ValueError("The retained workspace is not this original backup's restoration.")
            self.result["original_receiving"] = {
                "workspace_id": values["workspace_id"], "directory": str(self.workspace),
                "backup_sha256": values["restored_from"], "restored_at": values.get("restored_at"),
                "access_renewed": True, "recovered_original_receipt": True,
            }
        self.original_baseline_path = self.root / "original-audit-basis.json"
        if not self.original_baseline_path.exists():
            baseline = self.raw_basis(self.workspace)
            write(self.original_baseline_path, baseline)
        self.baseline = read_json(self.original_baseline_path)
        if self.baseline["workspace_id"] != self.result["original_receiving"]["workspace_id"]:
            raise ValueError("The restored practice workspace changed identity.")
        self.save()

    def raw_basis(self, workspace):
        database = workspace / "workspace.sqlite"
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            workspace_id = db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0]
            records = [json.loads(r[0]) for r in db.execute(
                "SELECT r.body FROM heads h JOIN revisions r USING(kind,id,revision) ORDER BY r.kind,r.id")
                if json.loads(r[0])["kind"] in self.store_module.DOMAIN_KINDS]
            revisions = [json.loads(r[0]) for r in db.execute(
                "SELECT body FROM revisions ORDER BY kind,id,revision")
                if json.loads(r[0])["kind"] in self.store_module.DOMAIN_KINDS]
            sources = [json.loads(r[0]) for r in db.execute("SELECT body FROM sources ORDER BY id")]
        return {"workspace_id": workspace_id, "records": records, "revisions": revisions, "sources": sources}

    def check_original(self, workspace):
        actual = self.raw_basis(workspace)
        if actual["workspace_id"] != self.baseline["workspace_id"]:
            raise ValueError("The original audit workspace identity changed.")
        for key in ("records", "revisions"):
            if canonical(actual[key]) != canonical(self.baseline[key]):
                raise ValueError("The original audit " + key + " changed during institutional operation.")
        sources = {s["id"]: s for s in actual["sources"]}
        for item in self.baseline["sources"]:
            if canonical(sources.get(item["id"])) != canonical(item):
                raise ValueError("An original audit source record changed.")
            body = workspace / "objects" / item["sha256"]
            if digest(body.read_bytes()) != item["sha256"]:
                raise ValueError("An original audit source body changed.")
        return {
            "workspace_id": actual["workspace_id"], "domain_records": len(actual["records"]),
            "domain_revisions": len(actual["revisions"]), "original_sources": len(self.baseline["sources"]),
            "source_count": len(actual["sources"]),
            "domain_sha256": digest(canonical({k: actual[k] for k in ("workspace_id", "records", "revisions")})),
            "original_sources_retained": True,
        }

    def start(self):
        private_provider = self.root / "private-provider"
        old_ready = read_json(self.root / READY_NAME) if (self.root / READY_NAME).exists() else {}
        old_issuer = old_ready.get("provider", {}).get("issuer")
        provider_port = urlsplit(old_issuer).port if old_issuer else 0
        self.provider = self.provider_type(private_provider, port=provider_port,
                                           resume=(private_provider / "client-secret.txt").exists()).start()
        os.environ["UMICH_NATIVE_OIDC_SECRET"] = self.provider.client_secret
        os.environ["UMICH_NATIVE_OIDC_CA"] = str(self.provider.ca_path)
        old_origin = old_ready.get("origin")
        port = urlsplit(old_origin).port if old_origin else 0
        self.start_server(port)
        for directory in self.private.get("registered_workspaces", {}).values():
            retained = Path(directory).resolve()
            if retained.parent != self.root or not retained.is_dir():
                raise ValueError("The original receiving workspace is no longer present.")
            self.server.registry.open(retained)
        self.private.setdefault("provider_id", "provider-native-" + secrets.token_hex(10))
        write(self.private_path, self.private)
        self.register(self.private.get("active_workspace") or self.server.registry.default_key, self.private["provider_id"])
        service = self.server.registry.get(self.server.registry.default_key)
        with service.store.lock:
            initial_selection = service.store.selection_hash()
        self.result.setdefault("initial_business_selection_sha256", initial_selection)
        self.result["original_audit"] = self.check_original(self.workspace)
        self.result["phases"].setdefault("original-complete-case-receiving", {
            **self.result["original_audit"], "source_files_verified": len(self.result["source"]["files"]),
        })
        self.save()
        self.write_ready()

    def start_server(self, port):
        self.server = self.host.AuditHTTPServer(
            self.workspace, port, listen="127.0.0.1",
            tls_cert=self.provider.cert_path, tls_key=self.provider.key_path)
        self.server.public_origin = self.server.origin
        self.server_thread = threading.Thread(target=self.server.serve_forever,
                                              kwargs={"poll_interval": 0.05}, daemon=True)
        self.server_thread.start()

    def register(self, workspace_key, provider_id):
        self.server.registry.get(workspace_key)
        self.store_module.identifier(provider_id)
        callback = self.server.origin + "/api/identity/callback?" + urlencode({
            "workspace": workspace_key, "provider": provider_id,
        })
        self.provider.register_redirect(callback)
        self.private["provider_id"] = provider_id
        self.private["active_workspace"] = workspace_key
        self.private.setdefault("registered_workspaces", {})[workspace_key] = str(
            self.server.registry.get(workspace_key).store.root)
        write(self.private_path, self.private)
        return {"callback": callback}

    def write_ready(self):
        key = self.server.registry.default_key
        data = {
            "schema": "commons-audit-institutional-private-ready/1",
            "origin": self.server.origin, "url": self.server.origin + "/?" + urlencode({"workspace": key}),
            "workspace": key, "workspace_directory": str(self.workspace),
            "owner_key_file": str(self.workspace / "operator.key"), "source_root": str(SOURCE_ROOT),
            "operation_root": str(self.root), "private_state_file": str(self.private_path),
            "provider": {"id": self.private["provider_id"], "label": "Practice institutional access",
                "issuer": self.provider.issuer, "client_id": self.provider.client_id,
                "client_secret_env": "UMICH_NATIVE_OIDC_SECRET", "ca_bundle_env": "UMICH_NATIVE_OIDC_CA",
                "control_url": self.provider.issuer + "/__control",
                "control_secret_file": str(self.provider.control_path)},
            "browser_result": str(self.root / "institutional-browser-result.json"),
            "python": sys.executable, "playwright": self.args.playwright, "chromium": self.args.chromium,
            "source_selection_sha256": self.result["source"]["selection"]["sha256"],
        }
        write(self.root / READY_NAME, data)

    def bridge(self, request):
        command = request["command"]
        if command == "register_callback":
            return self.register(request["workspace"], request["provider_id"])
        if command == "open_received":
            name = self.store_module.identifier(request["directory_name"])
            destination = self.root / name
            if not destination.exists():
                return {"exists": False}
            with sqlite3.connect((destination / "workspace.sqlite").as_uri() + "?mode=ro", uri=True) as db:
                values = dict(db.execute("SELECT key,value FROM settings"))
            if values.get("restored_from") != request["backup_sha256"]:
                raise ValueError("The receiving folder belongs to another original backup.")
            key = self.server.registry.open(destination)
            self.private.setdefault("registered_workspaces", {})[key] = str(destination)
            write(self.private_path, self.private)
            return {"exists": True, "workspace": key, "directory": str(destination),
                    "url": self.server.origin + "/?" + urlencode({"workspace": key}),
                    "owner_key_file": str(destination / "operator.key"),
                    "backup_sha256": values["restored_from"]}
        if command == "inspect":
            service = self.server.registry.get(request.get("workspace") or self.server.registry.default_key)
            with service.store.lock:
                checked = self.check_original(service.store.root)
                identity_rows = service.store.records()
                identity_rows = [r for r in identity_rows if r["kind"].startswith("identity_")]
                identity_history = [dict(r) for r in service.store.db.execute(
                    "SELECT kind,id,revision,sha256 FROM revisions WHERE kind LIKE 'identity#_%' ESCAPE '#' ORDER BY kind,id,revision")]
                transient = {table: service.store.db.execute("SELECT count(*) FROM " + table).fetchone()[0]
                             for table in ("grants", "sessions", "identity_logins", "identity_session_details", "identity_rate")}
                return {**checked, "selection_sha256": service.store.selection_hash(),
                        "identity_records": len(identity_rows), "identity_revision_rows": identity_history,
                        "identity_sha256": digest(canonical(identity_rows)),
                        "transient_counts": transient, "provider": self.provider.status()}
        if command == "restart":
            original_port = self.server.server_port
            self.server.shutdown()
            self.server_thread.join(timeout=5)
            self.server.server_close()
            self.start_server(original_port)
            self.write_ready()
            return {"origin": self.server.origin, "original": self.check_original(self.workspace)}
        if command == "complete":
            browser = read_json(self.root / "institutional-browser-result.json")
            if browser.get("status") != "COMPLETE" or not browser.get("phases"):
                raise ValueError("Complete the original browser operation first.")
            self.result["phases"].update(browser["phases"])
            self.result["browser_result"] = identity(self.root / "institutional-browser-result.json")
            self.result["receiving"] = self.bridge({"command": "inspect", "workspace": request["workspace"]})
            self.result["provider"] = self.provider.status()
            self.result["status"] = "COMPLETE"
            self.result["completed_at"] = time.time()
            self.save()
            return {"status": "COMPLETE", "result": str(self.result_path)}
        raise ValueError("Unknown native receiving bridge command.")

    def run_browser(self):
        command = [self.args.node, str(SOURCE_ROOT / "examples/INSTITUTIONAL_RECEIVING.mjs"),
                   str(self.root / READY_NAME)]
        environment = dict(os.environ)
        environment.pop("UMICH_NATIVE_OIDC_SECRET", None)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        temporary = self.root / "browser-tmp"
        temporary.mkdir(mode=0o700, exist_ok=True)
        environment["TMPDIR"] = str(temporary)
        self.child = subprocess.Popen(command, cwd=SOURCE_ROOT, env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
            text=True, bufsize=1, start_new_session=True)
        for line in self.child.stdout:
            if line.startswith("UMICH_BRIDGE "):
                request = json.loads(line[len("UMICH_BRIDGE "):])
                try:
                    value = self.bridge(request)
                    response = {"id": request["id"], "ok": True, "value": value}
                except Exception as exc:
                    self.log.write(type(exc).__name__ + ": " + str(exc) + "\n")
                    self.log.flush()
                    response = {"id": request["id"], "ok": False, "error": str(exc)}
                self.child.stdin.write(json.dumps(response) + "\n")
                self.child.stdin.flush()
            elif line.startswith("UMICH_STAGE "):
                item = json.loads(line[len("UMICH_STAGE "):])
                event(item["stage"], status=item.get("status"))
            else:
                self.log.write(line)
                self.log.flush()
        code = self.child.wait(timeout=10)
        if code or self.result.get("status") != "COMPLETE":
            raise RuntimeError("The original browser continuation requires its retained result: exit " + str(code))

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            if self.child and self.child.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.child.pid, signal.SIGTERM)
                try:
                    self.child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(self.child.pid, signal.SIGKILL)
                    self.child.wait(timeout=5)
            if self.server:
                self.server.shutdown()
                self.server_thread.join(timeout=5)
                self.server.server_close()
            if self.provider:
                self.provider.close()
        finally:
            self.result["native_closed_at"] = time.time()
            self.result["native_child_exit_code"] = self.child.poll() if self.child else None
            self.save()
            self.log.close()
            self.lease.close()

    def run(self):
        if self.result.get("status") == "COMPLETE":
            event("already_completed", result=str(self.result_path))
            self.closed = True
            self.log.close()
            self.lease.close()
            return
        try:
            self.setup()
            self.start()
            event("institutional_browser_started", operation_id=self.args.operation_id)
            self.run_browser()
        except BaseException as exc:
            self.result["status"] = "CONTINUATION_REQUIRED"
            self.result["last_error"] = {"type": type(exc).__name__, "message": str(exc)}
            self.save()
            raise
        finally:
            self.close()
        event("institutional_receiving_completed", result=str(self.result_path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--operation-id", default="UMICH-INSTITUTIONAL-ACCESS-20261012-7A2F")
    parser.add_argument("--original-backup", required=True)
    parser.add_argument("--original-sha256", required=True)
    parser.add_argument("--passphrase-file", required=True)
    parser.add_argument("--source-pins", required=True)
    parser.add_argument("--provider-file", required=True)
    parser.add_argument("--dependencies")
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chromium", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    journey = Journey(args)
    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    journey.run()


if __name__ == "__main__":
    main()
