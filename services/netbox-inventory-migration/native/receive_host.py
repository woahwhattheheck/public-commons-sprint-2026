#!/usr/bin/env python3
"""Receive the original NetBox migration and customer desk on real NetBox 4.7.2.

Run this foreground under the existing Commons native worker or an accepted
Muse receiver. It owns only its selected private instance, reuses the pinned
PostgreSQL package helper and an existing Redis binary, and creates no scheduler
or system service. All application/queue/database files survive continuation.
"""
from __future__ import annotations
import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))
from inventory_migration import InventoryError, SOURCE_COMMIT
from prepare_inventory import json_bytes, read_json, workspace_lock, write_atomic
from operate_inventory import NativeApi

OPERATION = "NETBOX-INVENTORY-RECEIVING-20261012-B9D2"
PG_HELPER_BLOB = "8d642424b872ee6a00b470a7f7bd0968ba391ef9"
PG_PACKAGES = ("postgresql-17", "postgresql-client-17", "libpq5")
APP_FILES = {
    "netbox/cli.py": "6b6c86de2d0fe2392adeca3a99e5344982877082",
    "netbox/settings.py": "37555e987eb7abc28c61ce08235815fd62ab5e8e",
    "users/models/tokens.py": "3cd7ded8311f10e2d65f2880e9ddbf69455dfa95",
    "extras/models/scripts.py": "042744fc6986227349b7a05ffe11af2aae0c6cc0",
    "extras/api/views.py": "739901d828cf54e96cff332c6e5559e3593a50ee",
    "extras/api/urls.py": "dcc359c7a860204cc6923175d2b8ae7716c265cc",
    "core/models/files.py": "49cfbe2a30a8bf79b6aac2a8f6f19f6b681bcc99",
}
CHILD = r"""
import ctypes, json, os, signal, subprocess, sys, time
from pathlib import Path
parent, gate, journal = map(int, sys.argv[1:4])
me = os.getpid()
boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
namespace = os.readlink('/proc/self/ns/pid')
stopping = None
journal_failed = False
def request_stop(number, _frame):
    global stopping
    stopping = stopping or number
signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)
libc = ctypes.CDLL(None, use_errno=True)
for option, argument in ((36, 1), (1, signal.SIGTERM)):
    if libc.prctl(option, argument, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Cannot retain native child ownership')
if os.getppid() != parent:
    raise SystemExit(125)
def ident(pid):
    try:
        raw = Path('/proc/%s/stat' % pid).read_text()
        f = raw[raw.rfind(')') + 2:].split()
        return dict(pid=int(pid), start=f[19], state=f[0], ppid=int(f[1]),
                    group=int(f[2]), session=int(f[3]), boot=boot, namespace=namespace)
    except (FileNotFoundError, ProcessLookupError):
        return None
def same(a, b):
    return bool(a and b and a['state'] != 'Z'
                and all(a[k] == b[k] for k in ('pid','start','boot','namespace')))
def members():
    rows = {}
    for item in Path('/proc').iterdir():
        if item.name.isdigit():
            value = ident(item.name)
            if value and value['state'] != 'Z':
                rows[value['pid']] = value
    selected = {me}
    while True:
        add = {pid for pid, value in rows.items()
               if value['ppid'] in selected or value['session'] == me}
        newer = selected | add
        if newer == selected:
            return [rows[pid] for pid in sorted(selected - {me}) if pid in rows]
        selected = newer
def note(state, rows, **extra):
    global journal_failed, stopping
    try:
        raw = (json.dumps(dict(state=state, wrapper=ident(me), members=rows,
                               at=time.time(), **extra), sort_keys=True) + '\n').encode()
        while raw:
            raw = raw[os.write(journal, raw):]
        os.fsync(journal)
        return True
    except (OSError, ValueError) as exc:
        # Storage loss cannot abandon an executing command or its descendants.
        # Stop this command and keep the cleanup path active without journaling.
        journal_failed = True
        stopping = stopping or signal.SIGTERM
        try:
            os.write(2, ('Native member journal unavailable; retiring owned command: ' + str(exc) + '\n').encode())
        except OSError:
            pass
        return False
def send(saved, number):
    try:
        fd = os.pidfd_open(saved['pid'])
    except ProcessLookupError:
        return
    try:
        if same(ident(saved['pid']), saved):
            signal.pidfd_send_signal(fd, number)
    finally:
        os.close(fd)
# The original command cannot start until its owner has durably saved this
# wrapper's identity. A failed write or lost parent closes the pipe.
try:
    permitted = os.read(gate, 1)
finally:
    os.close(gate)
if permitted != b'1' or stopping or os.getppid() != parent:
    note('CLEANUP_COMPLETE', [], command_started=False, returncode=125)
    raise SystemExit(125)
command = subprocess.Popen(sys.argv[4:], stdin=None, stdout=None, stderr=None)
last = None
known = {}
code = None
failure = None
def observe():
    global last
    rows = members()
    for member in rows:
        known[(member['pid'], member['start'])] = member
    signature = [(p['pid'],p['start'],p['session'],p['group']) for p in rows]
    if signature != last:
        note('ACTIVE', rows, command_pid=command.pid)
        last = signature
    return rows
try:
    while True:
        code = command.poll()
        observe()
        if stopping is not None or code is not None:
            break
        time.sleep(0.05)
except BaseException as exc:
    failure = exc
finally:
    deadline = time.monotonic() + 15
    while True:
        observed = False
        try:
            rows = observe()
            observed = True
        except OSError:
            rows = [member for member in known.values() if same(ident(member['pid']), member)]
        number = signal.SIGTERM if time.monotonic() < deadline else signal.SIGKILL
        for member in rows:
            send(member, number)
        code = command.poll()
        if code is not None:
            while True:
                try:
                    pid, _status = os.waitpid(-1, os.WNOHANG)
                    if pid == 0:
                        break
                except ChildProcessError:
                    break
            if observed and not members():
                break
        time.sleep(0.05)
result = 125 if failure is not None or journal_failed else (code if code else (128 + stopping if stopping else 0))
note('CLEANUP_COMPLETE', [], command_started=True, returncode=result)
os.close(journal)
if failure is not None:
    raise failure
raise SystemExit(result)

"""


def need(ok, message):
    if not ok:
        raise InventoryError(message)


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def git_blob(path):
    raw = Path(path).read_bytes()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def directory(path, mode=0o700):
    path.mkdir(parents=True, exist_ok=True, mode=mode)
    need(path.is_dir() and not path.is_symlink(), "Select an ordinary owned directory: " + str(path))
    path.chmod(mode)
    return path


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def identity(pid):
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        fields = stat[stat.rfind(")") + 2:].split()
        return {"pid": int(pid), "start": fields[19], "state": fields[0],
                "ppid": int(fields[1]), "group": int(fields[2]), "session": int(fields[3]),
                "boot": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "namespace": os.readlink("/proc/self/ns/pid")}
    except (FileNotFoundError, ProcessLookupError):
        return None


def alive(saved):
    if not isinstance(saved, dict) or not all(key in saved for key in ("pid", "start", "boot", "namespace")):
        return False
    actual = identity(saved["pid"])
    return bool(actual and actual["state"] != "Z"
                and all(actual[key] == saved[key] for key in ("pid", "start", "boot", "namespace")))


def signal_identity(saved, number):
    """Signal only the actual retained process, using a kernel-held PID handle."""
    if not alive(saved):
        return
    try:
        fd = os.pidfd_open(saved["pid"])
    except ProcessLookupError:
        return
    try:
        if alive(saved):
            signal.pidfd_send_signal(fd, number)
    finally:
        os.close(fd)


def process_ownership(owned):
    """Return verified original members separately from an unproven old session."""
    original = owned.get("identity")
    if not isinstance(original, dict):
        return [], []
    here = identity(os.getpid())
    if any(original[key] != here[key] for key in ("boot", "namespace")):
        return [], []
    known = {}
    journal = Path(owned["members"]) if owned.get("members") else None
    if journal is not None and journal.exists():
        with journal.open("rb") as stream:
            for raw in stream:
                if not raw.endswith(b"\n"):
                    break
                value = json.loads(raw)
                for member in value.get("members", []):
                    known[(member["pid"], member["start"])] = member
    rows = {}
    for item in Path("/proc").iterdir():
        if item.name.isdigit():
            value = identity(item.name)
            if value and value["state"] != "Z":
                rows[value["pid"]] = value
    # An exact live retained identity is required before expanding a session.
    # An old session number on its own confers no signalling authority.
    selected = {original["pid"]} if alive(original) else set()
    selected.update(member["pid"] for member in known.values() if alive(member))
    sessions = {rows[pid]["session"] for pid in selected if pid in rows}
    while True:
        add = {pid for pid, value in rows.items()
               if value["ppid"] in selected or value["session"] in sessions}
        newer = selected | add
        newer_sessions = sessions | {rows[pid]["session"] for pid in newer if pid in rows}
        if newer == selected and newer_sessions == sessions:
            break
        selected, sessions = newer, newer_sessions
    replacement = rows.get(original["pid"])
    reused_leader = bool(replacement and replacement["session"] == original["pid"]
                         and replacement["start"] != original["start"])
    unproven = [] if original["pid"] in sessions or reused_leader else [
        value for value in rows.values() if value["session"] == original["pid"]
        and int(value["start"]) >= int(original["start"])]
    return [rows[pid] for pid in sorted(selected) if pid in rows], unproven


class Host:
    def __init__(self, args):
        self.args = args
        self.root = directory(args.directory.resolve())
        self.runtime = directory(args.runtime_directory.resolve(), 0o755)
        self.logs = directory(self.root / "host-logs")
        self.private = directory(self.runtime / "private")
        self.work = directory(self.root / "migration")
        self.env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                        NETBOX_ROOT=str(self.runtime / "instance"),
                        NETBOX_NATIVE_DIRECTORY=str(self.work),
                        NETBOX_MIGRATION_SOURCE=str(SOURCE))
        self.children = []
        self.desk = None
        self.state_path = self.root / "host.json"
        binding = {"operation_id": OPERATION, "runtime": str(self.runtime),
                   "contract_source": SOURCE_COMMIT,
                   "redis_binary": str(args.redis_server.resolve()),
                   "redis_libraries": [str(p.resolve()) for p in args.redis_library_directory],
                   "netbox_source": str(args.netbox_source.resolve()) if args.netbox_source else None}
        if self.state_path.exists():
            self.state = read_json(self.state_path)
            need(self.state["binding"] == binding, "Resume the same selected native instance and dependencies.")
            for child in self.state.get("children", []):
                members, unproven = process_ownership(child)
                need(not members and not unproven, "Original native cleanup has live or unproven residual members; reconcile its retained foreground before resuming: " + child["name"])
        else:
            self.state = {"schema": "tjlabs.netbox.native-host/v1", "binding": binding,
                          "ports": {"postgres": port(), "redis": port(), "netbox": port()},
                          "stages": [], "children": [], "complete": False}
        self.save()
        self.verify_product()
        secret_file = self.private / "configuration-secrets.json"
        if not secret_file.exists():
            write_atomic(secret_file, json_bytes({
                "postgres": secrets.token_urlsafe(48), "application_database": secrets.token_urlsafe(48),
                "redis": secrets.token_urlsafe(48), "secret_key": secrets.token_urlsafe(60),
                "pepper": secrets.token_urlsafe(60)}), immutable=True)
        self.secrets = read_json(secret_file)

    def verify_product(self):
        manifest_path = SOURCE / "source-manifest.json"
        manifest = read_json(manifest_path)
        need(manifest.get("schema") == "tjlabs.netbox.source-manifest/v1"
             and manifest.get("operation_id") == OPERATION,
             "Select the complete original NetBox product source manifest.")
        for item in manifest["files"]:
            relative = Path(item["path"])
            need(not relative.is_absolute() and ".." not in relative.parts,
                 "The selected product manifest contains an invalid path.")
            target = SOURCE / relative
            need(target.is_file() and not target.is_symlink()
                 and target.stat().st_size == item["bytes"] and git_blob(target) == item["git_blob"],
                 "The selected product source differs: " + str(relative))
        self.state["product_manifest"] = {"path": str(manifest_path), "sha256": file_sha(manifest_path)}
        self.save()

    def save(self):
        write_atomic(self.state_path, json_bytes(self.state))

    def stage(self, name, state, **details):
        value = {"name": name, "state": state, "at": time.time(), **details}
        self.state["stages"].append(value)
        self.save()
        print(json.dumps({"operation_id": OPERATION, **value}), flush=True)

    def spawn(self, name, argv, *, env=None, user=None, group=None, input_data=None, pipe_output=False):
        suffix = name + "-" + uuid.uuid4().hex
        log = self.logs / (suffix + ".log")
        member_path = self.logs / (suffix + ".members.jsonl")
        output = log.open("xb")
        journal = member_path.open("xb", buffering=0)
        gate_read, gate_write = os.pipe()
        kw = {"stdin": subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
              "stdout": subprocess.PIPE if pipe_output else output, "stderr": output, "env": env or self.env,
              "start_new_session": True, "pass_fds": (gate_read, journal.fileno())}
        if user is not None:
            kw.update(user=user, group=group, extra_groups=[])
        wrapper = [str(self.args.python), "-B", "-c", CHILD, str(os.getpid()),
                   str(gate_read), str(journal.fileno()), *map(str, argv)]
        process = None
        owned = None
        try:
            process = subprocess.Popen(wrapper, **kw)
            os.close(gate_read)
            gate_read = None
            # The wrapper is waiting on the start pipe. A short command therefore
            # cannot disappear before its original identity is retained.
            saved = identity(process.pid)
            owned = {"name": name, "identity": saved, "members": str(member_path),
                     "log": str(log), "argv": [str(v) for v in argv]}
            self.children.append((process, output, owned))
            self.state["children"].append(owned)
            need(saved is not None and saved["session"] == process.pid,
                 "The native child wrapper exited before command admission; inspect " + str(log))
            self.stage(name, "STARTED", pid=process.pid, log=str(log))
            os.write(gate_write, b"1")
        except BaseException:
            if gate_write is not None:
                os.close(gate_write)
                gate_write = None
            if process is not None:
                self.stop_one(process, output, owned or {})
            else:
                output.close()
            raise
        finally:
            if gate_read is not None:
                os.close(gate_read)
            if gate_write is not None:
                os.close(gate_write)
            journal.close()
        if input_data is not None:
            try:
                process.stdin.write(input_data)
                process.stdin.close()
            except BaseException:
                self.stop_one(process, output, owned)
                raise
        return process, log

    def call(self, name, argv, **kw):
        process, log = self.spawn(name, argv, **kw)
        code = process.wait()
        owned = self.children[-1][2]
        self.stop_one(process, self.children[-1][1], owned)
        self.stage(name, "COMPLETE" if code == 0 else "FAILED", exit_code=code, log=str(log))
        need(code == 0, name + " returned " + str(code) + "; inspect its retained private log.")
        return log

    def stop_one(self, process, output, owned):
        # The original wrapper remains the session leader/subreaper while it
        # retires descendants, even after the direct command has exited.
        try:
            signal_identity(owned.get("identity"), signal.SIGTERM)
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                members, unproven = process_ownership(owned)
                need(not unproven, "An unproven historical session remains; preserve its original cleanup record without signalling by session number.")
                if not members:
                    process.poll()
                    return
                if not alive(owned.get("identity")) or time.monotonic() > deadline - 8:
                    for member in members:
                        if member["pid"] != process.pid:
                            signal_identity(member, signal.SIGKILL if time.monotonic() > deadline - 8 else signal.SIGTERM)
                process.poll()
                time.sleep(0.05)
            members, unproven = process_ownership(owned)
            need(not unproven, "An unproven historical session remains; reconcile its original cleanup.")
            descendants = [member for member in members if member["pid"] != process.pid]
            if not descendants:
                signal_identity(owned.get("identity"), signal.SIGKILL)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
            remaining, unproven = process_ownership(owned)
            need(not remaining and not unproven, "Native cleanup remains active for " + owned.get("name", "child") +
                 "; retain the same host and its recorded process members.")
        finally:
            output.close()

    def close(self):
        failures = []
        if self.desk is not None:
            try:
                self.desk.close()
            except BaseException as exc:
                failures.append(str(exc))
        # Cleanup is independent of the state writer and remains active on ENOSPC.
        for process, output, owned in reversed(self.children):
            try:
                self.stop_one(process, output, owned)
            except BaseException as exc:
                failures.append(str(exc))
        need(not failures, "Original native cleanup is incomplete: " + "; ".join(failures))

    def postgres_runtime(self):
        helper_path = self.args.postgres_helper.resolve()
        need(git_blob(helper_path) == PG_HELPER_BLOB, "Select the retained original PostgreSQL helper bytes.")
        spec = importlib.util.spec_from_file_location("netbox_original_pg_helper", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        prefix = self.runtime / "postgres-runtime"
        manifest_path = prefix / "selected-packages.json"
        if manifest_path.exists():
            manifest = read_json(manifest_path)
            need(manifest["helper_blob"] == PG_HELPER_BLOB, "The retained PostgreSQL helper selection changed.")
            for package in manifest["packages"]:
                for member in package["members"]:
                    target = prefix / member["path"]
                    if "sha256" in member:
                        need(target.is_file() and file_sha(target) == member["sha256"], "A retained PostgreSQL runtime file changed.")
                    else:
                        need(target.is_symlink() and os.readlink(target) == member["symlink"],
                             "A retained PostgreSQL runtime link changed.")
        else:
            need(not prefix.exists(), "Retain the incomplete original PostgreSQL setup for source reconciliation.")
            staging = self.runtime / "postgres-runtime.partial"
            # This staging contains only reproducible official package extraction,
            # and no server has ever been started from it.
            if staging.exists():
                shutil.rmtree(staging)
            directory(staging, 0o755)
            downloads = directory(self.runtime / "downloads")
            packages = []
            for name, version, url, size, expected in helper.PACKAGES:
                if name not in PG_PACKAGES:
                    continue
                archive_path = downloads / (name + ".deb")
                if archive_path.exists() and (archive_path.stat().st_size != size or file_sha(archive_path) != expected):
                    archive_path.unlink()
                if not archive_path.exists():
                    helper.download(url, archive_path, size, expected)
                item = {"name": name, "version": version, "url": url,
                        "bytes": size, "sha256": expected, "members": []}
                process, log = self.spawn("extract-" + name,
                                         ["dpkg-deb", "--fsys-tarfile", str(archive_path)],
                                         pipe_output=True)
                # Use the original helper's selected streaming archive extraction.
                try:
                    with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                        for member in archive:
                            if helper.selected_runtime(member.name):
                                selected = helper.extract_member(archive, member, staging,
                                                                  helper.member_path(member.name))
                                if selected:
                                    item["members"].append(selected)
                    code = process.wait()
                    need(code == 0, "The official Debian archive reader failed: " + str(log))
                finally:
                    process.stdout.close()
                    if process.poll() is None:
                        self.stop_one(process, self.children[-1][1], self.children[-1][2])
                packages.append(item)
                archive_path.unlink()
            need(tuple(p["name"] for p in packages) == PG_PACKAGES, "The selected official PostgreSQL packages are incomplete.")
            manifest = {"helper_blob": PG_HELPER_BLOB, "packages": packages}
            write_atomic(staging / "selected-packages.json", json_bytes(manifest), immutable=True)
            os.replace(staging, prefix)
        self.pgbin = prefix / "usr/lib/postgresql/17/bin"
        self.pgshare = prefix / "usr/share/postgresql/17"
        self.env["LD_LIBRARY_PATH"] = ":".join([str(prefix / "usr/lib/x86_64-linux-gnu"),
                                               *map(str, self.args.redis_library_directory),
                                               self.env.get("LD_LIBRARY_PATH", "")]).rstrip(":")
        self.env["PATH"] = str(self.pgbin) + ":" + self.env.get("PATH", "")
        for binary in ("postgres", "psql", "initdb", "pg_isready"):
            log = self.call("link-" + binary, ["ldd", self.pgbin / binary])
            need("not found" not in log.read_text(), "The selected PostgreSQL binary has an unresolved system library.")
        version = self.call("postgres-version", [self.pgbin / "postgres", "--version"]).read_text().strip()
        need("17.11" in version, "The actual PostgreSQL version differs from the pinned native packages.")
        self.state["postgres"] = {"version": version, "manifest": str(manifest_path),
                                  "sha256": file_sha(manifest_path)}
        self.save()

    def application(self):
        existing = self.args.netbox_python
        python = existing.resolve() if existing else self.runtime / "venv/bin/python"
        if not existing:
            if not python.exists():
                self.call("create-netbox-venv", [self.args.python, "-m", "venv", self.runtime / "venv"])
            # pip resumes the same private venv. It never changes shared Python.
            selection = ["netbox==4.7.2"]
            if self.args.netbox_source:
                requirements = self.args.netbox_source.resolve() / "requirements.txt"
                need(git_blob(requirements) == "ed2a3eb3167d4ee618be46b938208933f91db9fb",
                     "Select the original NetBox4.7.2 requirements.")
                selection = ["-r", str(requirements)]
            self.call("install-netbox", [python, "-m", "pip", "install", "--no-cache-dir",
                                        "--report", self.root / "package-install.json", *selection])
        self.python = python
        if self.args.netbox_source:
            app = self.args.netbox_source.resolve() / "netbox"
            self.command = [python, app / "manage.py"]
            self.env["PYTHONPATH"] = str(app) + ":" + self.env.get("PYTHONPATH", "")
        else:
            self.command = [python, "-m", "netbox"]
            probe = self.call("netbox-package-location", [python, "-c",
                "import importlib.util;from pathlib import Path;print(Path(importlib.util.find_spec('netbox').origin).parent.parent)"])
            app = Path(probe.read_text().strip())
        observed = {}
        for relative, expected in APP_FILES.items():
            path = app / relative
            need(path.is_file() and git_blob(path) == expected,
                 "The selected NetBox application differs from its reviewed 4.7.2 source: " + relative)
            observed[relative] = {"git_blob": expected, "sha256": file_sha(path)}
        self.state["application"] = {"python": str(python), "root": str(app),
                                     "contract_source": SOURCE_COMMIT, "files": observed}
        self.save()
        instance = directory(self.runtime / "instance")
        for name in ("conf", "media", "reports", "scripts", "static"):
            directory(instance / name)
        config = {
            "ALLOWED_HOSTS": ["127.0.0.1", "localhost"],
            "DATABASES": {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "netbox",
                "USER": "netbox", "PASSWORD": self.secrets["application_database"], "HOST": "127.0.0.1",
                "PORT": self.state["ports"]["postgres"], "CONN_MAX_AGE": 0}},
            "REDIS": {kind: {"HOST": "127.0.0.1", "PORT": self.state["ports"]["redis"],
                            "PASSWORD": self.secrets["redis"], "DATABASE": index, "SSL": False}
                      for index, kind in enumerate(("tasks", "caching"))},
            "SECRET_KEY": self.secrets["secret_key"], "API_TOKEN_PEPPERS": {1: self.secrets["pepper"]},
            "MEDIA_ROOT": str(instance / "media"), "REPORTS_ROOT": str(instance / "reports"),
            "SCRIPTS_ROOT": str(instance / "scripts"), "RQ_DEFAULT_TIMEOUT": 600,
            "CENSUS_REPORTING_ENABLED": False, "RELEASE_CHECK_URL": None, "DEBUG": False,
        }
        content = "".join(key + " = " + repr(value) + "\n" for key, value in config.items()).encode()
        write_atomic(instance / "conf/b9d2_native_configuration.py", content, immutable=True)
        self.env["NETBOX_CONFIGURATION"] = "b9d2_native_configuration"
        self.env["PYTHONPATH"] = str(instance / "conf") + ":" + self.env.get("PYTHONPATH", "")

    def ready(self, name, process, argv, *, env=None):
        for _ in range(120):
            need(process.poll() is None, "The original " + name + " process exited during startup.")
            completed = subprocess.run(list(map(str, argv)), env=env or self.env,
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, timeout=10)
            if completed.returncode == 0:
                return
            time.sleep(0.5)
        raise InventoryError("The original " + name + " service did not become ready; inspect its retained log.")

    def services(self):
        pg = directory(self.runtime / "postgres")
        uid, gid = (65534, 65534) if os.geteuid() == 0 else (os.geteuid(), os.getegid())
        # The selected database uid must traverse the actual full runtime path.
        # Do not broaden permissions on a private ancestor to make it work.
        probe = self.call("postgres-runtime-access", [self.args.python, "-c",
            "import os,sys;from pathlib import Path;p=Path(sys.argv[1]);"
            "bad=[str(x) for x in [p,*p.parents] if not os.access(x,os.X_OK)];"
            "print('\\n'.join(bad));sys.exit(bool(bad))", self.runtime], user=uid, group=gid)
        pg.chmod(0o700)
        if os.geteuid() == 0:
            os.chown(pg, uid, gid)
        sockets = directory(pg / "socket")
        if os.geteuid() == 0:
            os.chown(sockets, uid, gid)
        pwfile = pg / "password"
        if not pwfile.exists():
            write_atomic(pwfile, (self.secrets["postgres"] + "\n").encode(), immutable=True)
            if os.geteuid() == 0:
                os.chown(pwfile, uid, gid)
        data = pg / "data"
        if not data.exists():
            self.call("postgres-initdb", [self.pgbin / "initdb", "-D", data, "-L", self.pgshare,
                "--username=postgres", "--locale=C.UTF-8", "--encoding=UTF8", "--auth-local=trust",
                "--auth-host=scram-sha-256", "--pwfile=" + str(pwfile)], user=uid, group=gid)
        need((data / "PG_VERSION").read_text().strip() == "17", "The retained original PostgreSQL data is not version17.")
        pgproc, _ = self.spawn("postgres", [self.pgbin / "postgres", "-D", data, "-h", "127.0.0.1",
            "-p", self.state["ports"]["postgres"], "-k", sockets, "-c", "shared_buffers=32MB",
            "-c", "max_connections=30", "-c", "unix_socket_permissions=0700"],
            user=uid, group=gid)
        self.ready("postgres", pgproc, [self.pgbin / "pg_isready", "-h", "127.0.0.1",
                                       "-p", self.state["ports"]["postgres"]])
        pgenv = dict(self.env, PGHOST="127.0.0.1", PGPORT=str(self.state["ports"]["postgres"]),
                     PGUSER="postgres", PGPASSWORD=self.secrets["postgres"])
        # Fixed identifiers; private password comes from the same immutable instance.
        role_sql = ("SELECT 1 FROM pg_roles WHERE rolname='netbox';\n").encode()
        role = self.call("database-role-read", [self.pgbin / "psql", "-XAt", "-d", "postgres"],
                         env=pgenv, input_data=role_sql)
        if not role.read_text().strip():
            sql = ("CREATE ROLE netbox LOGIN PASSWORD '" + self.secrets["application_database"] + "';\n").encode()
            self.call("database-role-create", [self.pgbin / "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
                      env=pgenv, input_data=sql)
        database = self.call("database-read", [self.pgbin / "psql", "-XAt", "-d", "postgres"],
                            env=pgenv, input_data=b"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='netbox';\n")
        owner = database.read_text().strip()
        if not owner:
            self.call("database-create", [self.pgbin / "createdb", "--owner=netbox", "netbox"], env=pgenv)
        else:
            need(owner == "netbox", "The retained native database has another owner.")
        red = directory(self.runtime / "redis")
        redis_config = ("\n".join([
            "bind 127.0.0.1", "port " + str(self.state["ports"]["redis"]), "protected-mode yes",
            "requirepass " + self.secrets["redis"], "daemonize no", "appendonly yes", 'save ""',
            "dir " + json.dumps(str(red)), "logfile \"\"", "databases 2",
        ]) + "\n").encode()
        write_atomic(self.private / "redis.conf", redis_config, immutable=True)
        version = self.call("redis-version", [self.args.redis_server, "--version"]).read_text().strip()
        need("v=7.0.15" in version, "Select the existing pinned Redis7.0.15 receiver binary.")
        redis, _ = self.spawn("redis", [self.args.redis_server, self.private / "redis.conf"])
        redis_env = dict(self.env, NETBOX_REDIS_PASSWORD=self.secrets["redis"])
        self.ready("redis", redis, [self.python, "-c",
            "import os,redis;redis.Redis(host='127.0.0.1',port=" + str(self.state["ports"]["redis"]) +
            ",password=os.environ['NETBOX_REDIS_PASSWORD']).ping()"], env=redis_env)
        self.state["redis"] = {"version": version, "binary_sha256": file_sha(self.args.redis_server)}
        self.save()

    def shell(self, path, name, *, action=None):
        env = dict(self.env)
        if action:
            env["NETBOX_NATIVE_PROVISION_ACTION"] = action
        # Exact local source path; no private input is interpolated into shell code.
        env["NETBOX_NATIVE_SHELL_FILE"] = str(path)
        code = "import os;from pathlib import Path;p=Path(os.environ['NETBOX_NATIVE_SHELL_FILE']);exec(compile(p.read_text(),str(p),'exec'))"
        return self.call(name, [*self.command, "shell", "--command", code], env=env)

    def receive(self):
        self.postgres_runtime()
        self.application()
        self.services()
        self.call("netbox-migrations", [*self.command, "migrate", "--noinput"])
        self.shell(SOURCE / "native/provision_instance.py", "native-api-identity")
        auth = read_json(self.work / "api-identity.json")["authorization"]
        need(auth.startswith("Bearer "), "The retained original API identity is not a Bearer token.")
        self.env["NETBOX_TOKEN"] = auth[len("Bearer "):]
        base = "http://127.0.0.1:" + str(self.state["ports"]["netbox"])
        self.env["NETBOX_NATIVE_URL"] = base
        self.shell(SOURCE / "native/native_fixture.py", "original-native-fixture")
        # NativeApi reads the selected original token from this process environment.
        prior_token = os.environ.get("NETBOX_TOKEN")
        os.environ["NETBOX_TOKEN"] = self.env["NETBOX_TOKEN"]
        try:
            api = NativeApi(read_json(self.work / "connection.json"))
            self.spawn("netbox-rqworker", [*self.command, "rqworker", "high", "default", "low"])
            http, _ = self.spawn("netbox-http", [*self.command, "runserver",
                                                "127.0.0.1:" + str(self.state["ports"]["netbox"]),
                                                "--noreload", "--insecure"])
            for _ in range(120):
                need(http.poll() is None, "The original NetBox HTTP process exited during startup.")
                try:
                    api.request("/api/status/")
                    break
                except Exception:
                    time.sleep(0.5)
            else:
                raise InventoryError("The original NetBox API did not become ready.")
            self.shell(SOURCE / "native/provision_instance.py", "script-install-read", action="script-status")
            status = read_json(self.work / "script-install-status.json")
            if not status["installed"]:
                script = (SOURCE / "inventory_migration.py").read_bytes()
                boundary = "netbox-native-script-" + hashlib.sha256(script).hexdigest()[:24]
                body = (("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"inventory_migration.py\"\r\n"
                         "Content-Type: text/x-python\r\n\r\n").encode() + script +
                        ("\r\n--" + boundary + "--\r\n").encode())
                intent = {"operation_id": OPERATION, "path": "/api/extras/scripts/upload/", "method": "POST",
                          "source_sha256": hashlib.sha256(script).hexdigest(),
                          "body_sha256": hashlib.sha256(body).hexdigest()}
                write_atomic(self.work / "script-upload-intent.json", json_bytes(intent), immutable=True)
                result, meta = api.request(intent["path"], method="POST", body=body,
                                           content_type="multipart/form-data; boundary=" + boundary)
                write_atomic(self.work / "script-upload-response.json", json_bytes({"result": result, "meta": meta}), immutable=True)
                self.shell(SOURCE / "native/provision_instance.py", "script-install-readback", action="script-status")
                need(read_json(self.work / "script-install-status.json")["installed"], "The actual script upload did not install its original source.")
            api.script_metadata()
            self.call("original-migration-receiving",
                      [self.python, "-B", SOURCE / "native/run_native.py", "--directory", self.work])
            native = read_json(self.work / "native-result.json")
            need(native["state"] == "COMPLETE", "Retain the original migration stage before joining the customer desk.")
            sys.path.insert(0, str(SOURCE / "workspace"))
            from server import start_desk
            deskroot = directory(self.root / "customer-desk")
            uploads = directory(self.root / "desk-uploads")
            self.desk = start_desk(deskroot, self.work / "connection.json",
                                   temporary_root=uploads, wait_seconds=120)
            output = directory(self.root / "desk-output")
            entry = {"url": self.desk.url, "token": self.desk.token,
                     "inputs": str(self.work / "corrected-input"), "output": str(output),
                     "fixture": str(self.work / "fixture.json"),
                     "receipt": str(self.work / "edition-002/applied.json"),
                     "chromium": str(self.args.chromium.resolve()),
                     "archive": str(self.work / "edition-002/exports/inventory-handover.zip")}
            entry_path = self.private / "desk-entry.json"
            write_atomic(entry_path, json_bytes(entry))
            # This process owns the temporary browser profile in the current
            # mount namespace; saved projects and results remain in the workspace.
            with tempfile.TemporaryDirectory(prefix="netbox-desk-", dir="/dev") as temporary:
                browser_env = dict(self.env, NETBOX_DESK_ENTRY=str(entry_path),
                                   TMPDIR=temporary, TMP=temporary, TEMP=temporary)
                self.call("original-customer-desk", [self.args.node, SOURCE / "native/desk_receiving.mjs"], env=browser_env)
            result = read_json(output / "desk-result.json")
            need(result["state"] == "COMPLETE" and not result["page_errors"],
                 "The original customer desk needs its retained continuation.")
            self.state["complete"] = True
            self.state["results"] = {
                "migration": {"path": str(self.work / "native-result.json"), "sha256": file_sha(self.work / "native-result.json")},
                "desk": {"path": str(output / "desk-result.json"), "sha256": file_sha(output / "desk-result.json")},
            }
            self.stage("complete-native-receiving", "COMPLETE", actual_netbox_version="4.7.2",
                       results=self.state["results"])
        finally:
            if prior_token is None:
                os.environ.pop("NETBOX_TOKEN", None)
            else:
                os.environ["NETBOX_TOKEN"] = prior_token


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--runtime-directory", required=True, type=Path)
    parser.add_argument("--postgres-helper", required=True, type=Path)
    parser.add_argument("--redis-server", required=True, type=Path)
    parser.add_argument("--redis-library-directory", action="append", type=Path, default=[])
    parser.add_argument("--python", type=Path, default=Path(sys.executable))
    parser.add_argument("--netbox-python", type=Path, help="Existing actual NetBox4.7.2 Python; omitted installs the pinned evaluation package privately.")
    parser.add_argument("--netbox-source", type=Path, help="Optional actual pinned source checkout using netbox/manage.py.")
    parser.add_argument("--chromium", required=True, type=Path, help="Existing original Chromium executable for the native desktop/mobile receiver.")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
    args = parser.parse_args()
    host = None
    try:
        need(sys.platform == "linux" and platform.machine() == "x86_64", "Use the selected actual Linux x86_64 receiver.")
        directory(args.directory.resolve())
        with workspace_lock(args.directory.resolve() / "host-lock"):
            host = Host(args)
            if host.state["complete"]:
                for result in host.state["results"].values():
                    need(file_sha(result["path"]) == result["sha256"], "A completed native result changed.")
                print(json.dumps({"operation_id": OPERATION, "state": "COMPLETE", "results": host.state["results"]}), flush=True)
                return 0
            host.receive()
            return 0
    except (InventoryError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(json.dumps({"operation_id": OPERATION, "state": "CONTINUATION_REQUIRED",
                          "error": str(exc), "directory": str(args.directory)}), flush=True)
        return 2
    finally:
        if host is not None:
            host.close()


if __name__ == "__main__":
    raise SystemExit(main())
