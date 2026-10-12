#!/usr/bin/env python3
"""Run and preserve the original SCF fleet recovery and operator case on one Linux boundary."""
from __future__ import annotations
import base64
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import selectors
import signal
import time
import shutil
import stat
import subprocess
import sys
import tempfile
import traceback
import zipfile

OPERATION = "SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012"
PREFIX = "stellar/scf-starforge-20261009/"
GITHUB_HELPER_SHA256 = "86f055b8ff4da2ebb35fdeeba48e0f76f09b843eb2de5fd8bd7f92329c49618a"
OPERATOR = PREFIX + "sf101-merchant-recovery/workspace/receiving/fleet-operator.mjs"
SECRET_NAME = "SCF_RECOVERY_0747_PASSPHRASE"

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def digest(body):
    return hashlib.sha256(body).hexdigest()

def git_blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()

def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()

def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)

def require(value, message):
    if not value:
        raise RuntimeError(message)

def atomic(path, value):
    path = Path(path)
    raw = value if isinstance(value, bytes) else encode(value)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def identity(path):
    path = Path(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode), "Expected a regular file: " + str(path))
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            "File changed during archive selection: " + str(path))
    return {"path": str(path), "bytes": before.st_size, "sha256": h.hexdigest()}

def safe_relative(value):
    p = PurePosixPath(value)
    require(isinstance(value, str) and value and not p.is_absolute()
            and str(p) == value and all(x not in ("", ".", "..") for x in p.parts)
            and "\\" not in value, "Invalid source member")
    return p

class OriginalRun:
    def __init__(self, selection, library_child):
        self.selection = selection
        self.library_child = library_child
        self.root = Path(selection["root"])
        require(self.root.is_absolute() and str(self.root.resolve()) == str(self.root)
                and self.root.parent.is_dir(), "Select the original canonical writable parent")
        require(selection.get("storage") in ("persistent", "volatile"), "Select the actual runtime storage")
        if selection["storage"] == "volatile":
            require(str(self.root).startswith("/dev/"), "Select the original volatile runtime root")
        self.source = self.root / "source"
        self.case = self.root / "case"
        self.control = self.root / "control"
        self.delivery = self.root / "delivery"
        self.children = []
        self.child_records = []
        self.owned_root = False
        self.case_generation = 0
        self.archive_generation = None
        self.saved_generation = None
        self.journey_invoked = False
        self.tmp = self.root / "runtime-tmp"
        self.saved = None
        self.state = {"schema": "scf-original-cloud-run/v1", "operation_id": OPERATION,
                      "selection": selection, "started_at": now(), "state": "PREPARING",
                      "commands": [], "github_reads": [], "saves": [], "archives": [], "case_generation": 0}
        self.started_case = False
        self.lock = None
        self.archive = None
        self.prepared = False
        self.saved_archive_sha256 = None

    def save_state(self):
        require(self.owned_root, "Only the original root owner may publish its state")
        atomic(self.control / "progress.json", self.state)

    def retain_state(self, context):
        try:
            self.save_state()
            return True
        except BaseException as error:
            self.state.setdefault("journal_errors", []).append(
                {"at": now(), "context": context, "type": type(error).__name__, "error": str(error)})
            emit({"event": "original_state_retained_in_memory", "context": context,
                  "type": type(error).__name__, "error": str(error)})
            return False

    def invalidate_saved_generation(self, reason):
        require(self.owned_root, "Only the original owner may advance this case")
        self.case_generation += 1
        self.state["case_generation"] = self.case_generation
        self.state["generation_reason"] = reason
        self.saved = None
        self.saved_archive_sha256 = None
        self.saved_generation = None
        self.save_state()

    def reconcile_children(self):
        changed = False
        for record in self.child_records:
            child, row = record["process"], record["row"]
            code = child.poll()
            if code is None or row.get("state") == "CLOSED":
                continue
            row.update(state="CLOSED", returncode=code, closed_at=now())
            for stream_name in ("stdout", "stderr"):
                path = Path(row[stream_name])
                if path.exists():
                    with path.open("rb") as stream:
                        os.fsync(stream.fileno())
                    row[stream_name + "_identity"] = identity(path)
            changed = True
            emit({"event": "original_child_closed", "operation_id": OPERATION,
                  "label": row["label"], "pid": child.pid, "returncode": code,
                  "stdout_tail": Path(row["stdout"]).read_text(errors="replace")[-6000:],
                  "stderr_tail": Path(row["stderr"]).read_text(errors="replace")[-6000:]})
        if changed:
            self.retain_state("original child return")
        return all(p.poll() is not None for p in self.children)

    def handle_signal(self, signum, frame):
        self.state.setdefault("signals", []).append({"at": now(), "number": signum})
        raise InterruptedError("Original controller received signal " + str(signum))

    def prepare(self):
        require(self.selection["operation_id"] == OPERATION, "Keep the original operation")
        require(sys.platform.startswith("linux"), "Run the original fleet recovery on Linux")
        require(not self.root.exists() or self.owned_root, "The original root already exists; use its live controller")
        free = os.statvfs(self.root.parent)
        require(free.f_bavail * free.f_frsize >= 768 * 1024 * 1024,
                "The selected runtime needs 768 MiB of available native storage")
        helper = Path(self.selection["github_helper"])
        require(digest(helper.read_bytes()) == GITHUB_HELPER_SHA256, "The configured Git caller changed")
        spec = importlib.util.spec_from_file_location("scf_original_github_caller", helper)
        github = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(github)
        self.github = github
        service_name = self.selection.get("service_user")
        if not service_name:
            service_name = pwd.getpwuid(os.geteuid()).pw_name if os.geteuid() > 0 else "nobody"
        self.service = pwd.getpwnam(service_name)
        require(self.service.pw_uid > 0 and self.service.pw_gid > 0, "Use the existing service account")
        self.runtime = {k: str(Path(v).resolve(strict=True)) for k, v in self.selection["runtime"].items()}
        for k in ("python", "node", "chromium"):
            require(os.access(self.runtime[k], os.X_OK), "Missing executable: " + k)
        # Observe the real service credentials before creating the original root.
        # An existing unprivileged owner runs directly; a privileged controller
        # must demonstrate a genuine kernel credential switch.
        probe_argv = [self.runtime["python"], "-B", "-c",
                      "import os,json; print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups()}))"]
        probe = subprocess.run(probe_argv, capture_output=True, text=True, preexec_fn=self.demote)
        require(probe.returncode == 0, "Use an existing Linux service account: " + probe.stderr[-2000:])
        service_observed = json.loads(probe.stdout)
        require(service_observed["uid"] == self.service.pw_uid
                and service_observed["gid"] == self.service.pw_gid,
                "Bind the original actual service UID and GID")
        self.state["service_preflight"] = {"at": now(), "argv": probe_argv, "returncode": probe.returncode,
                                            "observed": service_observed}
        if not self.owned_root:
            self.root.mkdir(mode=0o711)
            self.owned_root = True
        self.root.chmod(0o711)
        for p in (self.source, self.control, self.delivery):
            p.mkdir(mode=0o700, exist_ok=True)
        if self.lock is None:
            self.lock = (self.control / "controller.lock").open("xb")
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        atomic(self.control / "selection.json", self.selection)
        atomic(self.control / "library-child.py", self.library_child.encode())
        self.state["runtime"] = {k: identity(v) for k, v in self.runtime.items()}
        self.state["service"] = {"name": self.service.pw_name, "uid": self.service.pw_uid, "gid": self.service.pw_gid}
        self.state["controller"] = {"pid": os.getpid(), "uid": os.getuid(), "started_at": now()}
        self.save_state()
        self.fetch(self.selection["controller"], "cloud-recovery-run.py")
        application = self.fetch(self.selection["application"], "application.json")
        packet = json.loads(application)
        if "parts" in packet:
            source_files = []
            require(isinstance(packet["parts"], list) and packet["parts"], "Keep the complete source index")
            for i, part in enumerate(packet["parts"]):
                part_raw = self.fetch(part, "source-parts/" + str(i).zfill(3) + ".json")
                part_body = json.loads(part_raw)
                require(isinstance(part_body.get("files"), list), "Source part body")
                source_files.extend(part_body["files"])
                emit({"event": "original_source_part", "part": i + 1, "total_parts": len(packet["parts"]),
                      "files": len(part_body["files"]), "bytes": len(part_raw)})
            packet = {"manifest": packet["manifest"], "files": source_files}
        manifest = packet["manifest"]
        require(manifest["commit"] == self.selection["application"]["commit"], "Keep the selected source commit")
        rows = {r["path"]: r for r in manifest["files"]}
        require(len(rows) == len(manifest["files"]) == len(packet["files"]) and set(rows) == {f["path"] for f in packet["files"]}, "Source member uniqueness")
        require(manifest["repository"] == "woahwhattheheck/public-commons-sprint-2026", "Use the original public application source")
        for item in packet["files"]:
            name = item["path"]
            safe_relative(name)
            require(name in rows, "Unexpected application member: " + name)
            body = item["content"].encode("utf-8")
            expected = rows[name]
            require(len(body) == expected["bytes"] and digest(body) == expected["sha256"]
                    and git_blob(body) == expected["git_blob_sha"], "Source identity mismatch: " + name)
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            if path.exists():
                require(path.is_file() and not path.is_symlink() and path.read_bytes() == body, "Preserve different staged source: " + name)
            else:
                atomic(path, body)
            path.chmod(0o555 if expected.get("mode") == "100755" else 0o444)
        require((self.source / OPERATOR).is_file(), "Include the complete operator receiver")
        module_root = self.selection.get("node_module_directory")
        if module_root:
            module_root = Path(module_root).resolve(strict=True)
            require(module_root.is_dir() and not module_root.is_relative_to(self.root), "Use the installed runtime dependency directory")
            target = self.source / "node_modules"
            if target.is_symlink():
                require(target.resolve() == module_root, "Preserve the original dependency directory")
            else:
                require(not target.exists(), "Preserve the original source node_modules path")
                target.symlink_to(module_root, target_is_directory=True)
            self.state["node_module_directory"] = str(module_root)
        for directory, _, _ in os.walk(self.source, topdown=False):
            Path(directory).chmod(0o555)
        self.fetch(self.selection["journey"], "recovery-journey.mjs")
        self.journey = self.control / "recovery-journey.mjs"
        self.journey.chmod(0o444)
        os.chmod(self.control, 0o711)
        self.tmp = self.root / "runtime-tmp"
        self.tmp.mkdir(mode=0o700, exist_ok=True)
        if (self.tmp.stat().st_uid, self.tmp.stat().st_gid) != (self.service.pw_uid, self.service.pw_gid):
            os.chown(self.tmp, self.service.pw_uid, self.service.pw_gid)
        self.secret_file = self.control / "original-passphrase"
        if not self.secret_file.exists():
            with self.secret_file.open("xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(base64.urlsafe_b64encode(os.urandom(48)))
                stream.flush()
                os.fsync(stream.fileno())
        self.env = os.environ.copy()
        self.env.update({SECRET_NAME: self.secret_file.read_text(), "PYTHONDONTWRITEBYTECODE": "1",
                         "TMPDIR": str(self.tmp)})
        self.source_manifest = manifest
        self.prepared = True
        self.state.update(state="READY", source_files=len(rows), source_bytes=sum(v["bytes"] for v in rows.values()))
        self.save_state()
        emit({"event": "original_source_ready", "operation_id": OPERATION,
              "files": len(rows), "source": str(self.source), "service": self.state["service"]})

    def fetch(self, selected, name):
        existing = self.control / name
        if existing.exists():
            raw = existing.read_bytes()
            require(len(raw) == selected["bytes"] and digest(raw) == selected["sha256"] and git_blob(raw) == selected["blob"], "Preserve the original selected source")
            return raw
        try:
            result = self.github.api_response("/repos/" + selected["repository"] + "/git/blobs/" + selected["blob"],
                                              actor=self.selection.get("github_actor", "tokenjunkielabs"))
        except self.github.GitHubAPIError as error:
            self.state["github_reads"].append(error.receipt)
            self.save_state()
            raise
        self.state["github_reads"].append(result["receipt"])
        self.save_state()
        row = result["data"]
        require(row["sha"] == selected["blob"] and row["encoding"] == "base64", "Original Git blob changed")
        raw = base64.b64decode(row["content"])
        require(len(raw) == selected["bytes"] and digest(raw) == selected["sha256"]
                and git_blob(raw) == selected["blob"], "Original Git body identity")
        atomic(self.control / name, raw)
        return raw

    def demote(self):
        if (os.getuid(), os.getgid()) != (self.service.pw_uid, self.service.pw_gid):
            os.setgroups([])
            os.setgid(self.service.pw_gid)
            os.setuid(self.service.pw_uid)
        os.umask(0o077)

    def run_command(self, label, argv, service=True, input_bytes=None, cwd=None, env=None, changes_case=True):
        require(self.owned_root and self.reconcile_children(), "Continue the original owned child before another command")
        if changes_case:
            self.invalidate_saved_generation(label)
        index = len(self.state["commands"])
        directory = self.control / "commands"
        directory.mkdir(mode=0o700, exist_ok=True)
        out = directory / (str(index).zfill(3) + "-" + label + ".stdout")
        err = directory / (str(index).zfill(3) + "-" + label + ".stderr")
        row = {"label": label, "argv": argv, "started_at": now(), "state": "STARTING",
               "stdout": str(out), "stderr": str(err), "case_generation": self.case_generation}
        self.state["commands"].append(row)
        self.save_state()
        stdin_file = None
        try:
            if input_bytes is not None:
                request_path = directory / (str(index).zfill(3) + "-" + label + ".stdin.json")
                atomic(request_path, input_bytes)
                stdin_file = request_path.open("rb")
            with out.open("xb") as stdout, err.open("xb") as stderr:
                try:
                    child = subprocess.Popen(argv, stdin=stdin_file if stdin_file else subprocess.DEVNULL,
                                             stdout=stdout, stderr=stderr, cwd=cwd or self.source,
                                             env=env if env is not None else self.env,
                                             preexec_fn=self.demote if service else None,
                                             start_new_session=True)
                except BaseException as error:
                    row.update(state="START_FAILED", error_type=type(error).__name__,
                               error=str(error), closed_at=now())
                    self.retain_state("definite process start failure")
                    raise
                self.children.append(child)
                self.child_records.append({"process": child, "row": row})
                if label == "original-fleet-recovery":
                    self.journey_invoked = True
                row.update(state="RUNNING", pid=child.pid)
                self.retain_state("original child started")
                emit({"event": "original_child_started", "operation_id": OPERATION, "label": label, "pid": child.pid})
                try:
                    code = child.wait()
                finally:
                    stdout.flush()
                    stderr.flush()
                    os.fsync(stdout.fileno())
                    os.fsync(stderr.fileno())
        finally:
            if stdin_file is not None:
                stdin_file.close()
            self.reconcile_children()
        return code

    def operate(self):
        require(self.prepared and not self.journey_invoked and self.reconcile_children(),
                "Continue the already started original journey through its actual phase")
        if self.started_case:
            require(self.case.is_dir() and not any(self.case.iterdir()),
                    "Only a definite no-spawn may resume this original empty case")
        # Resolve every real ESM dependency before allocating the original native case.
        modules = [PREFIX + p for p in ("merchant-fleet-gateway/release-bootstrap.mjs",
                   "merchant-fleet-gateway/deploy.mjs", "merchant-fleet-gateway/deploy-runtime.mjs",
                   "merchant-fleet-gateway/recovery.mjs",
                   "sf101-merchant-recovery/workspace/merchant-provider.mjs")]
        script = "import {pathToFileURL} from 'node:url'; for(const p of " + json.dumps(
                 [str(self.source / p) for p in modules]) + ") await import(pathToFileURL(p));"
        code = self.run_command("load-original-runtime", [self.runtime["node"], "--input-type=module", "-e", script])
        require(code == 0, "Complete the original source imports before case allocation")
        if not self.started_case:
            self.case.mkdir(mode=0o700)
            if (self.case.stat().st_uid, self.case.stat().st_gid) != (self.service.pw_uid, self.service.pw_gid):
                os.chown(self.case, self.service.pw_uid, self.service.pw_gid)
            self.started_case = True
        self.journey_argv = [self.runtime["node"], str(self.journey), "--source", str(self.source),
                             "--directory", str(self.case), "--python", self.runtime["python"],
                             "--pass-env", SECRET_NAME, "--port-base", str(self.selection.get("port_base", 24840))]
        self.operator_argv = [self.runtime["node"], str(self.source / OPERATOR), "--source", str(self.source),
                             "--case", str(self.case), "--python", self.runtime["python"],
                             "--chromium", self.runtime["chromium"], "--playwright", self.runtime["playwright"],
                             "--quiesced"]
        self.state.update(state="OPERATING", journey_argv=self.journey_argv, operator_argv=self.operator_argv)
        self.save_state()
        code = self.run_command("original-fleet-recovery", self.journey_argv)
        if code == 0:
            code = self.run_command("original-fleet-operator", self.operator_argv)
        self.state["state"] = "COMPLETE" if code == 0 else "NEEDS_CONTINUATION"
        self.save_state()
        return code

    def archive_case(self):
        require(self.owned_root and self.reconcile_children(), "Close original children before archive")
        if self.archive is not None and self.archive_generation == self.case_generation:
            require(identity(self.archive) == self.state["archives"][-1]["archive"],
                    "Preserve the original selected archive")
            return self.archive
        self.save_state()
        files = []
        links = []
        for directory, directories, names in os.walk(self.root, followlinks=False):
            directory = Path(directory)
            if directory == self.delivery or self.delivery in directory.parents or directory == self.tmp or self.tmp in directory.parents:
                continue
            for name in directories:
                candidate = directory / name
                if candidate.is_symlink():
                    relative = candidate.relative_to(self.root).as_posix()
                    require(relative == "source/node_modules" and str(candidate.resolve()) == self.state.get("node_module_directory"),
                            "Inspect unexpected directory link: " + relative)
                    links.append({"path": relative, "target": str(candidate.resolve()), "kind": "installed_runtime_dependencies"})
            for name in names:
                path = directory / name
                relative = path.relative_to(self.root).as_posix()
                info = path.lstat()
                if stat.S_ISLNK(info.st_mode):
                    require(name in ("SingletonLock", "SingletonSocket", "SingletonCookie")
                            and path.is_relative_to(self.case),
                            "Retain and inspect unexpected source link: " + relative)
                    links.append({"path": relative, "target": os.readlink(path),
                                  "kind": "closed_chromium_singleton"})
                    continue
                require(stat.S_ISREG(info.st_mode), "Retain and inspect special file: " + relative)
                row = identity(path)
                files.append({"path": relative, "bytes": row["bytes"], "sha256": row["sha256"]})
        manifest = {"schema": "scf-original-operating-archive/v1", "operation_id": OPERATION,
                    "state": self.state["state"], "case_generation": self.case_generation, "created_at": now(), "selection": self.selection,
                    "original_case": str(self.case), "source_directory": str(self.source),
                    "service": self.state.get("service"), "runtime": self.state.get("runtime"),
                    "files": sorted(files, key=lambda r: r["path"]), "runtime_links": links}
        number = len(list(self.delivery.glob("SCF-Original-Fleet-*.zip")))
        path = self.delivery / ("SCF-Original-Fleet-Recovery-20261012-0747-" + str(number).zfill(2) + ".zip")
        pending = path.with_suffix(".pending-" + str(time.time_ns()))
        with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr("manifest.json", encode(manifest))
            for row in manifest["files"]:
                require(identity(self.root / row["path"])["sha256"] == row["sha256"], "Archive input changed")
                archive.write(self.root / row["path"], row["path"])
        with zipfile.ZipFile(pending) as archive:
            require(archive.testzip() is None, "Archive CRC failed")
            require(len(archive.namelist()) == len(manifest["files"]) + 1, "Archive member count")
            for row in manifest["files"]:
                raw = archive.read(row["path"])
                require(len(raw) == row["bytes"] and digest(raw) == row["sha256"], "Archive body mismatch")
        os.replace(pending, path)
        with path.open("rb") as stream:
            os.fsync(stream.fileno())
        self.archive = path
        self.archive_generation = self.case_generation
        self.state["archives"].append({"archive": identity(path), "case_generation": self.case_generation,
                                      "created_at": now(), "state": self.state["state"]})
        self.saved = None
        self.saved_archive_sha256 = None
        self.saved_generation = None
        self.save_state()
        atomic(self.delivery / ("archive-" + str(number).zfill(2) + ".json"), identity(path))
        emit({"event": "original_archive_ready", "operation_id": OPERATION, "archive": identity(path),
              "members": len(files), "case_state": self.state["state"]})
        return path

    def save_outcome(self, attempt):
        require(identity(attempt["archive"]["path"]) == attempt["archive"],
                "Preserve the exact archive selected by this save")
        if attempt.get("state") == "SAVED":
            require(isinstance(attempt.get("result"), dict), "Keep the actual original saved result")
            if attempt["generation"] == self.case_generation and self.archive is not None:
                require(attempt["archive"] == identity(self.archive), "Bind the original saved generation")
                self.saved = attempt["result"]
                self.saved_generation = self.case_generation
                self.saved_archive_sha256 = attempt["archive"]["sha256"]
            return True
        state = Path(attempt["directory"]) / "state"
        result_file = state / "helper-result.json"
        results = json.loads(result_file.read_text()).get("results") if result_file.is_file() else None
        calls_file = state / "calls.json"
        calls = json.loads(calls_file.read_text()) if calls_file.is_file() else []
        finalizations = [row for row in calls if row.get("tool") == "finalize_uploads"]
        if results is None:
            for call in reversed(finalizations):
                if call.get("state") != "RETURNED":
                    continue
                response = call.get("response", {})
                values = response.get("structuredContent", {}).get("results")
                if values is None:
                    for block in response.get("content", []):
                        if block.get("type") != "text":
                            continue
                        try:
                            values = json.loads(block["text"]).get("results")
                        except (ValueError, AttributeError):
                            continue
                        if isinstance(values, list):
                            break
                if isinstance(values, list) and len(values) == 1:
                    row = values[0]
                    if row.get("operation") == "create_library_file" and row.get("status") == "succeeded":
                        results = [{**row, "purpose": row["operation"], "local_path": attempt["archive"]["path"],
                                    "local_metadata_applied": False, "recovered_original_finalize_response": True}]
                    break
        if isinstance(results, list) and len(results) == 1 and results[0].get("status") == "succeeded":
            row = results[0]
            require(row.get("purpose") == "create_library_file"
                    and row.get("local_path") == attempt["archive"]["path"],
                    "The original save returned another file")
            require(all(isinstance(row.get(k), str) and row[k] for k in ("file_id", "library_file_id", "file_name")),
                    "The saved original archive needs its complete identity")
            version = row.get("current_version_number")
            require(version is None or (type(version) is int and version >= 0),
                    "Keep the actual saved version")
            metadata = {}
            try:
                for name in os.listxattr(attempt["archive"]["path"]):
                    if name.startswith("user.library"):
                        metadata[name] = os.getxattr(attempt["archive"]["path"], name).decode("utf-8", "replace")
            except OSError as error:
                metadata = {"read_error": str(error)}
            attempt.update(state="SAVED", result=row, xattrs=metadata, closed_at=now())
            if attempt["generation"] == self.case_generation and self.archive is not None:
                require(attempt["archive"] == identity(self.archive), "Bind the current archive generation")
                self.saved = row
                self.saved_generation = self.case_generation
                self.saved_archive_sha256 = attempt["archive"]["sha256"]
            self.retain_state("original archive saved")
            emit({"event": "original_archive_saved", "operation_id": OPERATION,
                  "archive": attempt["archive"], "generation": attempt["generation"], "result": row})
            return True
        attempt["state"] = "UNKNOWN_FINALIZATION" if finalizations else "FAILED_BEFORE_FINALIZATION"
        attempt["helper_results"] = results
        attempt["call_boundaries"] = [{k: v for k, v in row.items() if k != "response"} for row in calls]
        self.retain_state("original archive save outcome")
        return False

    def save_archive(self):
        require(self.owned_root and self.reconcile_children(), "Reconcile the original owned command first")
        require(self.archive is not None and self.archive_generation == self.case_generation,
                "Archive the current original case generation before saving")
        selected = identity(self.archive)
        previous = [row for row in self.state["saves"] if row["archive"]["sha256"] == selected["sha256"]]
        if previous:
            attempt = previous[-1]
            if self.save_outcome(attempt):
                return True
            require(attempt["state"] == "FAILED_BEFORE_FINALIZATION",
                    "Read back the original uncertain finalization before another save")
        transfer = self.delivery / ("save-" + str(len(self.state["saves"])).zfill(3))
        transfer.mkdir(mode=0o700)
        request = {"uploads": [{"local_path": str(self.archive), "purpose": "create_library_file",
                                "library_artifact_type": "other"}]}
        attempt = {"directory": str(transfer), "archive": selected, "generation": self.case_generation,
                   "state": "PREPARED", "started_at": now(), "request_sha256": digest(encode(request))}
        self.state["saves"].append(attempt)
        self.save_state()
        atomic(transfer / "request.json", request)
        argv = [self.runtime["python"], "-B", str(self.control / "library-child.py"),
                self.selection["library_helper"], str(transfer / "state")]
        try:
            attempt["returncode"] = self.run_command("save-original-" + str(len(self.state["saves"])).zfill(3),
                argv, service=False, input_bytes=encode(request), cwd=self.root,
                env=os.environ.copy(), changes_case=False)
        except BaseException as error:
            attempt["process_error"] = {"at": now(), "type": type(error).__name__, "error": str(error)}
            self.retain_state("original save process interrupted")
            if not self.reconcile_children():
                raise
        if self.save_outcome(attempt):
            return True
        emit({"event": "original_save_needs_continuation", "operation_id": OPERATION,
              "transfer": str(transfer), "archive": selected, "state": attempt["state"],
              "returncode": attempt.get("returncode")})
        return False

    def confirm_saved_readback(self, evidence):
        require(self.archive is not None and self.archive_generation == self.case_generation,
                "Select the current original archive")
        selected = identity(self.archive)
        require(evidence.get("schema") == "scf-verified-library-readback/v1"
                and evidence.get("archive_sha256") == selected["sha256"]
                and evidence.get("archive_bytes") == selected["bytes"], "Select the original complete archive bytes")
        for key in ("library_file_id", "file_id", "file_name", "readback_receipt", "verified_by"):
            require(isinstance(evidence.get(key), str) and evidence[key], "Keep the actual readback " + key)
        require(type(evidence.get("current_version_number")) is int and evidence["current_version_number"] >= 0,
                "Keep the observed saved version")
        receipt_sha = evidence.get("readback_receipt_sha256", "")
        require(len(receipt_sha) == 64 and all(c in "0123456789abcdef" for c in receipt_sha),
                "Retain the exact complete readback receipt")
        attempt = next((row for row in reversed(self.state["saves"])
                        if row["archive"]["sha256"] == selected["sha256"]), None)
        require(attempt is not None and attempt["state"] == "UNKNOWN_FINALIZATION",
                "Reconcile the original uncertain save")
        atomic(Path(attempt["directory"]) / "verified-readback.json", evidence)
        result = {key: evidence[key] for key in ("library_file_id", "file_id", "file_name", "current_version_number")}
        attempt.update(state="SAVED", result=result, verified_readback=evidence, closed_at=now())
        self.saved = result
        self.saved_generation = self.case_generation
        self.saved_archive_sha256 = selected["sha256"]
        self.retain_state("verified original saved archive")
        emit({"event": "original_archive_saved", "archive": selected, "result": result})

    def can_close_saved(self):
        return (self.owned_root and self.reconcile_children() and self.saved is not None
                and self.archive is not None and self.saved_generation == self.case_generation
                and self.archive_generation == self.case_generation
                and self.saved_archive_sha256 == identity(self.archive)["sha256"])

    def control_loop(self):
        emit({"event": "original_controller_retained", "operation_id": OPERATION, "pid": os.getpid(),
              "root": str(self.root), "state": self.state["state"],
              "commands": ["status", "inspect", "prepare", "run-original", "continue-operator", "archive", "save", "reconcile-original-save", "close-saved"]})
        require(self.owned_root, "Only the original owner may control this root")
        while True:
            try:
                self.reconcile_children()
                line = sys.stdin.readline()
                if not line:
                    time.sleep(1)
                    continue
                request = json.loads(line)
                action = request.get("action")
                if action == "status":
                    emit({"state": self.state, "saved": self.saved, "archive": identity(self.archive) if self.archive else None})
                elif action == "inspect":
                    name = str(safe_relative(request["path"]))
                    require(not name.endswith("original-passphrase"), "Keep the retained passphrase private")
                    path = self.root / name
                    require(path.resolve().is_relative_to(self.root), "Inspect the original root")
                    if path.is_dir():
                        emit({"path": name, "entries": [p.name for p in path.iterdir()]})
                    else:
                        maximum = min(int(request.get("maximum", 12000)), 100000)
                        raw = path.read_bytes()
                        emit({"path": name, "identity": identity(path), "text": raw[-maximum:].decode("utf-8", errors="replace")})
                elif action == "prepare":
                    require(not self.started_case, "Preserve the started original case")
                    self.prepare()
                elif action == "run-original":
                    self.operate()
                elif action == "continue-operator":
                    require(self.started_case and json.loads((self.case / "journey.json").read_text())["state"] == "COMPLETE",
                            "Complete the original journey before its operator stage")
                    require(self.reconcile_children(), "Receive the original active stage before its operator")
                    self.state["state"] = "OPERATING"
                    code = self.run_command("original-fleet-operator-continuation", self.operator_argv)
                    self.state["state"] = "COMPLETE" if code == 0 else "NEEDS_CONTINUATION"
                    self.save_state()
                elif action == "archive":
                    self.archive_case()
                elif action == "save":
                    self.save_archive()
                elif action == "reconcile-original-save":
                    self.confirm_saved_readback(request["readback"])
                elif action == "close-saved":
                    require(self.can_close_saved(), "Save the current original case generation before closing")
                    emit({"event": "original_controller_closed", "operation_id": OPERATION, "saved": self.saved})
                    return
                else:
                    raise ValueError("Use an original controller action")
            except BaseException as error:
                self.state["last_error"] = {"at": now(), "type": type(error).__name__, "error": str(error)}
                self.retain_state("original control error")
                emit({"event": "original_control_error", "type": type(error).__name__, "error": str(error)})

def main():
    os.umask(0o077)
    selection = json.loads(sys.argv[1])
    library_raw = base64.b64decode(sys.argv[2], validate=True)
    require(len(library_raw) == selection["library_child"]["bytes"]
            and digest(library_raw) == selection["library_child"]["sha256"],
            "Bind the exact original Library child before preparation")
    executed_source = globals().get("EXECUTED_SOURCE_BYTES")
    require(isinstance(executed_source, bytes)
            and len(executed_source) == selection["controller"]["bytes"]
            and digest(executed_source) == selection["controller"]["sha256"]
            and git_blob(executed_source) == selection["controller"]["blob"],
            "Bind the actual executing controller to the selected complete source")
    library_child = library_raw.decode()
    run = OriginalRun(selection, library_child)
    signal.signal(signal.SIGTERM, run.handle_signal)
    signal.signal(signal.SIGINT, run.handle_signal)
    try:
        run.prepare()
        run.operate()
        run.archive_case()
        if run.save_archive() and run.state["state"] == "COMPLETE" and run.can_close_saved():
            emit({"event": "original_run_complete", "operation_id": OPERATION, "saved": run.saved})
            return 0
    except BaseException as error:
        if run.owned_root:
            run.state["state"] = "NEEDS_CONTINUATION"
            run.state["last_error"] = {"at": now(), "type": type(error).__name__, "error": str(error)}
            run.retain_state("original controller exception")
        emit({"event": "original_run_needs_continuation", "operation_id": OPERATION,
              "error_type": type(error).__name__, "error": str(error), "traceback": traceback.format_exc()[-10000:]})
    if run.owned_root:
        run.control_loop()
        return 0
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
