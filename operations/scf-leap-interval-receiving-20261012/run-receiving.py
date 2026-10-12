#!/usr/bin/env python3
"""MIT. Complete Leap customer receiving through the installed original owner."""
from __future__ import annotations
import contextlib
import hashlib
import http.client
import json
import os
import re
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from uuid import uuid4
import zipfile

OPERATION = "LEAP-DEVICE-INTERVAL-DELIVERY-20261012"
SCHEMA = "stellar-forge.leap-complete-receiving.v1"
BASE = "stellar/scf-starforge-20261009"
HERE = Path(__file__).resolve().parent


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + str(uuid4()) + ".tmp")
    with open(temporary, "xb") as out:
        os.chmod(temporary, 0o600)
        out.write(json_bytes(value))
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def identity(path):
    path = Path(path)
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "Use a complete original regular file: " + str(path))
    sha, git, size = hashlib.sha256(), hashlib.sha1(), 0
    git.update(("blob " + str(info.st_size) + "\0").encode())
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            size += len(block)
            sha.update(block)
            git.update(block)
    after = path.stat()
    need((after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
         == (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns),
         "The original file changed during receiving: " + str(path))
    return {"bytes": size, "sha256": sha.hexdigest(), "gitBlob": git.hexdigest()}


def verify(path, declared):
    actual = identity(path)
    for field in ("bytes", "sha256", "gitBlob"):
        if field in declared:
            need(actual[field] == declared[field], "Original " + field + " mismatch: " + str(path))
    return actual


def stamp():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def private_directory(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == os.getuid()
         and info.st_mode & 0o077 == 0, "Use an owner-private receiving directory: " + str(path))
    return path


def copy_exact(source, destination, declared=None):
    source, destination = Path(source), Path(destination)
    if declared and (destination.exists() or destination.is_symlink()):
        original = verify(destination, declared)
        return {"path": str(destination), **original}
    original = verify(source, declared or {})
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() or destination.is_symlink():
        verify(destination, original)
        return {"path": str(destination), **original}
    temporary = destination.with_name(destination.name + "." + str(uuid4()) + ".tmp")
    with open(source, "rb") as inp, open(temporary, "xb") as out:
        os.chmod(temporary, 0o600)
        shutil.copyfileobj(inp, out, 1024 * 1024)
        out.flush()
        os.fsync(out.fileno())
    verify(temporary, original)
    os.replace(temporary, destination)
    return {"path": str(destination), **original}


class Receiving:
    def __init__(self, configuration):
        self.config = configuration
        need(configuration.get("operationId", OPERATION) == OPERATION, "Keep the original Leap operation identity.")
        self.config["operationId"] = OPERATION
        self.output = private_directory(configuration["outputDirectory"])
        self.artifacts = private_directory(configuration.get("artifactDirectory", self.output / "delivery"))
        self.report_path = self.output / "Leap_Interval_Operation.json"
        self.completion = self.output / "completed-delivery.json"
        self.finalization = self.output / "finalization.json"
        self.journal_path = self.output / "receiving-journal.json"
        self.state = read_json(self.journal_path) if self.journal_path.exists() else {
            "schema": SCHEMA, "operationId": OPERATION, "createdAt": stamp(), "phases": {}, "transfers": {}, "attempts": []
        }
        self.owner_process = None
        self.node = str(Path(configuration["nodeExecutable"]).absolute())
        self.python = str(Path(configuration["pythonExecutable"]).absolute())
        self.source = Path(configuration["sourceRoot"]).absolute()
        self.runtime = Path(configuration["runtimeDirectory"]).absolute()
        self.workspace = Path(configuration.get("workspaceDirectory", self.output / "workspace")).absolute()
        self.cold = Path(configuration.get("restoredDirectory", self.output / "restored-workspace")).absolute()
        self.env = {**os.environ, "CODEX_PRIMARY_RUNTIME_PYTHON": self.python, "STARFORGE_PYTHON": self.python,
                    "SF30_XML_NODE": self.node, "PYTHONDONTWRITEBYTECODE": "1"}
        self.input = configuration["input"]
        self.validate_input()
        semantic = {
            "configuration": self.input["configuration"],
            "sources": [{key: value for key, value in row.items() if key != "path"} for row in self.input["sources"]],
            "mappings": self.input["mappings"], "batches": self.input["batches"],
            "missingScopes": self.input.get("missingScopes", []), "deliveryBatchKey": self.input.get("deliveryBatchKey")
        }
        digest = hashlib.sha256(json_bytes(semantic)).hexdigest()
        need(not self.state.get("inputSha256") or self.state["inputSha256"] == digest,
             "Continue the same complete reviewed original input.")
        self.state["inputSha256"] = digest
        self.state["attempts"].append({"at": stamp(), "previousStatus": self.state.get("status"), "previousError": self.state.get("error")})
        self.state.pop("error", None)
        self.save()

    def save(self):
        self.state["updatedAt"] = stamp()
        atomic_json(self.journal_path, self.state)

    def validate_input(self):
        value = self.input
        need(isinstance(value, dict) and isinstance(value.get("configuration"), dict), "Provide the reviewed original Leap configuration.")
        for name in ("sources", "mappings", "batches"):
            need(isinstance(value.get(name), list) and value[name], "Provide the complete reviewed " + name + ".")
        for collection in ("mappings", "batches"):
            keys = [row.get("key") for row in value[collection]]
            need(all(isinstance(key, str) and key and len(key) <= 120 for key in keys) and len(keys) == len(set(keys)),
                 "Use distinct receiving keys for the reviewed " + collection + ".")
        for source in value["sources"]:
            need(source.get("format") in {"leap-load", "utility-profile", "evidence"}
                 and isinstance(source.get("sha256"), str) and len(source["sha256"]) == 64,
                 "Every original source needs its selected format and complete SHA256.")
            source["path"] = str(Path(source["path"]).absolute())
        need(isinstance(value.get("missingScopes", []), list), "Use the explicit original missing-window scopes.")
        value["operationId"] = OPERATION
        # Credentials are only inherited by the original process. They are never copied into input or reports.
        need(not any(key in value for key in ("token", "apiKey", "api_key", "secret")), "Use the named API-key environment variable.")

    def command(self, args, label, *, timeout=1800, json_result=True):
        directory = private_directory(self.output / "private-process")
        outpath, errpath = directory / (label + ".stdout"), directory / (label + ".stderr")
        with open(outpath, "wb") as out, open(errpath, "wb") as err:
            os.chmod(outpath, 0o600)
            os.chmod(errpath, 0o600)
            result = subprocess.run(args, cwd=self.source, env=self.env, stdout=out, stderr=err, timeout=timeout)
        if result.returncode:
            message = errpath.read_text(encoding="utf-8", errors="replace")[-3000:]
            token = self.env.get(self.input["configuration"].get("token_env", "LEAP_API_TOKEN"))
            if token:
                message = message.replace(token, "[private API key redacted]")
            raise RuntimeError(label + " returned " + str(result.returncode) + ": " + message)
        text = outpath.read_text(encoding="utf-8")
        if not json_result:
            return text
        try:
            return json.loads(text)
        except ValueError:
            for line in reversed(text.splitlines()):
                try:
                    return json.loads(line)
                except ValueError:
                    pass
            raise RuntimeError(label + " did not return the original complete JSON result.")

    def preflight(self, *, inspect_runtime=True):
        manifest_path = Path(self.config.get("sourceManifest", HERE / "source-manifest.json")).absolute()
        manifest = read_json(manifest_path)
        need(manifest.get("schema") == "stellar-forge.leap-receiving-source.v1" and isinstance(manifest.get("files"), list),
             "Use the original complete Leap source declaration.")
        members = []
        for row in manifest["files"]:
            relative = Path(row["path"])
            need(not relative.is_absolute() and ".." not in relative.parts, "Invalid declared source member.")
            members.append({"path": row["path"], **verify(self.source / relative, row)})
        for source in self.input["sources"]:
            verify(source["path"], source)
        if not inspect_runtime:
            need(members == self.state["source"]["members"], "The complete source changed after its original receiving.")
            verify(manifest_path, self.state["source"]["manifest"])
            return
        helper = self.source / BASE / "distribution/runtime-install.mjs"
        code = (
            "import {pathToFileURL} from 'node:url';"
            "const m=await import(pathToFileURL(process.argv[1]).href);"
            "console.log(JSON.stringify(await m.runtimeCommand({directory:process.argv[2],args:['leap-intervals']})));"
        )
        descriptor = self.command([self.node, "--input-type=module", "-e", code, str(helper), str(self.runtime)], "original-runtime-command")
        need(Path(descriptor["sourceRoot"]).resolve() == self.source.resolve(), "The READY runtime belongs to a different original source root.")
        self.original_command = [descriptor["executable"], *descriptor["args"], "--python", self.python]
        self.state["source"] = {
            "manifest": {"path": str(manifest_path), **identity(manifest_path)},
            "members": members, "runtime": descriptor, "verifiedAt": stamp()
        }
        self.state["phases"]["source"] = {"status": "COMPLETE", "at": stamp()}
        self.save()
        self.command([*self.original_command, "--workspace", str(self.workspace), "--help"], "installed-command-help", json_result=False)

    def cli(self, workspace, args, label):
        return self.command([*self.original_command, "--workspace", str(workspace), *args], label)

    @contextlib.contextmanager
    def owner(self, workspace, name):
        connection = self.output / "private-process" / (name + "-" + str(uuid4()) + ".url")
        log = self.output / "private-process" / (name + ".owner.log")
        log.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        output = open(log, "ab")
        os.chmod(log, 0o600)
        process = subprocess.Popen(
            [*self.original_command, "--workspace", str(workspace), "serve", "--port", "0", "--connection-file", str(connection)],
            cwd=self.source, env=self.env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True
        )
        self.owner_process = process
        descriptor = None
        try:
            deadline = time.monotonic() + 120
            while not connection.exists():
                need(process.poll() is None, "The original owner exited before publishing its private connection; inspect " + str(log))
                need(time.monotonic() < deadline, "The original owner did not publish a connection within its startup boundary.")
                time.sleep(0.1)
            descriptor = self.http_json(connection, "/api/launch")
            need(descriptor.get("status") == "READY" and Path(descriptor["workspace"]).resolve() == Path(workspace).resolve(),
                 "The original listener is not the selected receiving workspace.")
            self.state.setdefault("owners", []).append({"name": name, "pid": process.pid, "launch": descriptor, "startedAt": stamp(), "closed": False})
            self.save()
            yield connection, descriptor
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=240)
                except subprocess.TimeoutExpired:
                    output.close()
                    # Keep the same owner's state and actual error; no second owner is opened.
                    self.state["ownerDrainError"] = {"name": name, "pid": process.pid, "at": stamp(), "message": "Original listener did not drain after SIGTERM."}
                    self.save()
                    raise
            output.close()
            self.owner_process = None
            need(not connection.exists(), "The original owner did not remove its own connection file.")
            need(process.returncode in (0, 130, -signal.SIGTERM), "The original owner closed with " + str(process.returncode))
            if descriptor:
                for item in reversed(self.state.get("owners", [])):
                    if item["pid"] == process.pid and item["name"] == name:
                        item.update(closed=True, closedAt=stamp(), exitCode=process.returncode)
                        break
                self.save()

    @staticmethod
    def http_json(connection_file, path):
        url = urlsplit(Path(connection_file).read_text().strip())
        need(url.scheme == "http" and url.hostname == "127.0.0.1" and url.fragment, "Use the original private loopback URL.")
        client = http.client.HTTPConnection(url.hostname, url.port, timeout=180)
        try:
            client.request("GET", path, headers={"Authorization": "Bearer " + url.fragment, "Host": url.netloc})
            response = client.getresponse()
            data = response.read(64 * 1024 * 1024 + 1)
            need(response.status == 200 and len(data) <= 64 * 1024 * 1024, "The original owner read failed.")
            return json.loads(data)
        finally:
            client.close()

    def browser(self, connection, mode, expected=None):
        folder = self.output / ("browser" if mode == "operate" else "cold-browser")
        config = {"connectionFile": str(connection), "outputDirectory": str(folder), "input": self.input, "mode": mode,
                  "playwright": str(Path(self.config["playwright"]).absolute()), "chromium": str(Path(self.config["chromium"]).absolute())}
        if expected is not None:
            config["expected"] = expected
        path = self.output / "private-process" / (mode + "-browser.json")
        atomic_json(path, config)
        result = self.command([self.node, "--max-old-space-size=384", str(self.source / "operations/scf-leap-interval-receiving-20261012/run-browser.mjs"), str(path)],
                              mode + "-browser", timeout=int(self.config.get("browserTimeoutSeconds", 7200)))
        need(result.get("passed") is True and result.get("browserClosed") is True, "The complete original browser did not close successfully.")
        return result

    def export_cli(self, batch_id):
        phase = self.state["phases"].setdefault("cliExport", {"requestId": str(uuid4()), "status": "PREPARED"})
        destination = self.output / "Leap_Interval_Workspace.zip"
        if phase.get("status") == "COMPLETE":
            verify(destination, phase["file"])
            return phase
        state = self.cli(self.workspace, ["status"], "live-status-before-cli-export")
        if "expectedRevision" not in phase:
            phase["expectedRevision"] = state["revision"]
            self.save()
        if destination.exists():
            operation = self.cli(self.workspace, ["operation", "--id", phase["requestId"]], "original-cli-export-operation")
            need(operation.get("status") == "COMPLETED", "A receiving filename exists without the original completed export operation.")
            metadata = operation["result"]
            observed = identity(destination)
            if observed["sha256"] == metadata["sha256"] and observed["bytes"] == metadata["bytes"]:
                phase.update(status="COMPLETE", operation=operation, file={"path": str(destination), **observed})
                self.save()
                return phase
            retained = destination.with_name(destination.name + ".incomplete-" + phase["requestId"])
            need(not retained.exists(), "Preserve the original incomplete CLI output before another copy.")
            os.replace(destination, retained)
            phase.setdefault("incompleteFiles", []).append({"path": str(retained), **observed})
            self.save()
        result = self.cli(self.workspace, ["export", "--batch-id", batch_id, "--out", str(destination),
            "--request-id", phase["requestId"], "--expected-revision", str(phase["expectedRevision"])], "original-cli-export")
        metadata = result["result"]
        phase.update(status="COMPLETE", result=result, file={"path": str(destination), **verify(destination, metadata)})
        self.save()
        return phase

    def restore_cli(self, portable):
        phase = self.state["phases"].setdefault("cliRestore", {"requestId": str(uuid4()), "status": "PREPARED"})
        if phase.get("status") == "COMPLETE":
            need(self.cold.exists(), "Reopen the original restored workspace; it is no longer at its retained directory.")
            return phase
        need(self.cold.resolve() != self.workspace.resolve(), "Cold receiving requires a distinct private directory.")
        current = self.cli(self.cold, ["status"], "cold-status-before-restore")
        if "expectedRevision" not in phase:
            phase["expectedRevision"] = current["revision"]
            phase["originalEmptyWorkspaceId"] = current["workspace_id"]
            self.save()
        result = self.cli(self.cold, ["restore", "--file", str(portable), "--request-id", phase["requestId"],
            "--expected-revision", str(phase["expectedRevision"])], "original-cli-restore")
        phase.update(status="COMPLETE", result=result)
        self.save()
        return phase

    def finalize(self, live=None, cold=None):
        if self.finalization.exists():
            frozen = read_json(self.finalization)
            need(frozen.get("operationId") == OPERATION and frozen.get("inputSha256") == self.state["inputSha256"],
                 "Keep the original completed receiving and reviewed input during delivery.")
            report = frozen["report"]
        else:
            need(live and cold, "Complete the original receiving before freezing its delivery.")
            report = {
                "schema": SCHEMA, "operationId": OPERATION, "status": "PASS", "productPassed": True,
                "inputSha256": self.state["inputSha256"], "source": self.state["source"],
                "workspaceId": live["workspaceId"], "deliveryBatchId": live["deliveryBatchId"],
                "browser": live, "coldBrowser": cold, "phases": self.state["phases"],
                "owners": self.state.get("owners", []), "completedAt": stamp(),
            }
            original_browser = read_json(live["report"])
            report["providerStates"] = [
                {"batchId": item["batch"]["id"], "status": item["batch"]["status"],
                 "jobId": item["batch"].get("job_id"), "lastError": item["batch"].get("last_error")}
                for item in original_browser["batchRecords"].values()
            ]
            report["providerActionsRequested"] = sum(len(row.get("providerActions", [])) for row in self.input["batches"])
            report["providerIngestionCompleted"] = (
                all(row["status"] == "COMPLETED" and row["jobId"] for row in report["providerStates"])
                if report["providerActionsRequested"] else None
            )
            report["originalFiles"] = original_browser["files"]
            customer = self.artifacts / "Leap_Interval_Delivery"
            selected = [
                (self.output / "Leap_Interval_Workspace.zip", customer / "Leap_Interval_Workspace.zip"),
                (Path(self.state["source"]["manifest"]["path"]), customer / "source-manifest.json"),
                (self.source / "operations/scf-leap-interval-receiving-20261012/README.md", customer / "RECEIVING.md"),
                (self.source / BASE / "sf30-seller-sdk/leap-intervals/README.md", customer / "LEAP_OPERATOR.md"),
            ]
            # Source, connection capabilities and process logs remain with their original private owner.
            for folder in (self.output / "browser", self.output / "cold-browser"):
                for source in sorted(folder.rglob("*")):
                    if (source.is_file() and not source.is_symlink()
                            and not re.search(r"\.[0-9a-f]{8}-[0-9a-f-]{27}\.tmp$", source.name)):
                        selected.append((source, customer / folder.name / source.relative_to(folder)))
            reviewed = {
                "operationId": OPERATION, "configuration": self.input["configuration"],
                "sources": [{key: value for key, value in row.items() if key != "path"} for row in self.input["sources"]],
                "mappings": self.input["mappings"], "batches": self.input["batches"],
                "missingScopes": self.input.get("missingScopes", []), "deliveryBatchKey": self.input.get("deliveryBatchKey"),
            }
            frozen = {
                "schema": "stellar-forge.leap-receiving-finalization.v1", "operationId": OPERATION,
                "inputSha256": self.state["inputSha256"], "report": report, "reviewedInput": reviewed,
                "customerDirectory": str(customer),
                "copies": [{"source": str(source), "destination": str(destination), **identity(source)}
                           for source, destination in selected]
            }
            # Freeze the complete native result before generating or transferring any delivery bytes.
            atomic_json(self.finalization, frozen)
        customer = private_directory(frozen["customerDirectory"])
        atomic_json(self.report_path, report)
        copy_exact(self.report_path, customer / "Leap_Interval_Operation.json")
        for row in frozen["copies"]:
            copy_exact(row["source"], row["destination"], row)
        atomic_json(customer / "reviewed-input.json", frozen["reviewedInput"])
        declared_members = [customer / "Leap_Interval_Operation.json", customer / "reviewed-input.json",
                            *(Path(row["destination"]) for row in frozen["copies"])]
        need(len(declared_members) == len(set(declared_members)), "The complete customer member names must be distinct.")
        roster = {path.relative_to(customer).as_posix(): identity(path) for path in sorted(declared_members)}
        atomic_json(customer / "delivery-manifest.json", {
            "schema": "stellar-forge.leap-receiving-handoff.v1", "operationId": OPERATION,
            "workspaceId": report["workspaceId"], "deliveryBatchId": report["deliveryBatchId"], "files": roster
        })
        archive = self.artifacts / "Leap_Interval_Delivery.zip"
        temporary = archive.with_name(archive.name + "." + str(uuid4()) + ".tmp")
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as out:
            os.chmod(temporary, 0o600)
            for path in sorted([*declared_members, customer / "delivery-manifest.json"]):
                out.write(path, path.relative_to(customer).as_posix())
        with open(temporary, "rb") as source:
            os.fsync(source.fileno())
        os.replace(temporary, archive)
        fd = os.open(archive.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        completed = {
            "schema": SCHEMA, "operationId": OPERATION, "productPassed": True, "completedAt": report["completedAt"],
            "report": {"path": str(self.report_path), **identity(self.report_path)},
            "workspace": {"path": str(self.output / "Leap_Interval_Workspace.zip"), **identity(self.output / "Leap_Interval_Workspace.zip")},
            "delivery": {"path": str(archive), **identity(archive)}
        }
        atomic_json(self.completion, completed)
        self.state.update(status="COMPLETE", completion=completed)
        self.save()
        return completed

    def transfers(self, completed):
        targets = self.config.get("uploadTargets", [])
        need(isinstance(targets, list), "Use original prepared upload target objects.")
        for entry in targets:
            kind, target = entry["artifact"], entry["target"]
            need(kind in {"report", "workspace", "delivery"}, "Select one complete retained artifact.")
            original = completed[kind]
            verify(original["path"], original)
            target_id = target.get("file_id") or target.get("upload_session_id") or target.get("id")
            need(isinstance(target_id, str) and target_id, "Keep the original prepared upload target ID.")
            key = kind + ":" + target_id
            prior = self.state["transfers"].get(key)
            if prior and prior.get("status") == "UPLOADED":
                need(prior["sha256"] == original["sha256"] and prior["bytes"] == original["bytes"],
                     "A completed upload target belongs to different bytes.")
                continue
            need(prior is None, "Reconcile the original uncertain prepared upload " + target_id + " before another transfer.")
            method = target.get("method") or target.get("upload_method") or "PUT"
            url = target.get("upload_url") or target.get("url")
            parsed = urlsplit(url or "")
            need(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password and not parsed.fragment,
                 "Use the original signed HTTPS upload target.")
            need(method == "PUT", "Use the prepared single-file PUT upload route.")
            attempt = {"artifact": kind, "targetId": target_id, "sha256": original["sha256"], "bytes": original["bytes"],
                       "status": "UPLOADING", "startedAt": stamp()}
            self.state["transfers"][key] = attempt
            self.save()
            client = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=180)
            try:
                headers = dict(target.get("required_headers") or target.get("headers") or target.get("upload_headers") or {})
                headers["Content-Length"] = str(original["bytes"])
                route = parsed.path + ("?" + parsed.query if parsed.query else "")
                client.putrequest(method, route)
                for name, value in headers.items():
                    client.putheader(name, str(value))
                client.endheaders()
                with open(original["path"], "rb") as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        client.send(block)
                response = client.getresponse()
                response.read(64 * 1024)
                need(200 <= response.status < 300, "The prepared upload returned HTTP " + str(response.status))
                attempt.update(status="UPLOADED", httpStatus=response.status, etag=response.getheader("ETag"), completedAt=stamp())
                self.save()
            except Exception as error:
                attempt.update(status="UNCONFIRMED", errorType=type(error).__name__, failedAt=stamp())
                self.save()
                raise RuntimeError("The completed original " + kind + " upload is unconfirmed; keep its same target and bytes.") from None
            finally:
                client.close()
        return self.state["transfers"]

    def run(self):
        # A completed product resumes only its verified delivery; it opens no workspace or browser.
        if self.completion.exists():
            completed = read_json(self.completion)
            need(completed.get("productPassed") is True and completed.get("operationId") == OPERATION,
                 "The retained completion belongs to a different original operation.")
            for kind in ("report", "workspace", "delivery"):
                verify(completed[kind]["path"], completed[kind])
            self.transfers(completed)
            return {**completed, "transfers": self.state["transfers"]}
        if self.finalization.exists():
            completed = self.finalize()
            self.transfers(completed)
            return {**completed, "transfers": self.state["transfers"]}
        self.preflight()
        if self.state.get("workspaceId"):
            need(self.workspace.exists(), "The original accepted workspace is unavailable; restore its complete retained custody before resuming.")
        initial = self.cli(self.workspace, ["status" if self.state.get("workspaceId") else "init"], "original-workspace")
        if self.state.get("workspaceId"):
            need(initial["workspace_id"] == self.state["workspaceId"], "The reopened owner is a different original workspace.")
        else:
            self.state["workspaceId"] = initial["workspace_id"]
            self.save()
        live_phase = self.state["phases"].get("browser")
        if live_phase and live_phase.get("status") == "COMPLETE":
            live = live_phase["result"]
            verify(live["report"], live_phase["reportIdentity"])
        else:
            with self.owner(self.workspace, "original") as (connection, launch):
                need(launch["workspace_id"] == self.state["workspaceId"], "The original owner identity changed.")
                live = self.browser(connection, "operate")
            self.state["phases"]["browser"] = {"status": "COMPLETE", "result": live, "reportIdentity": identity(live["report"]), "at": stamp()}
            self.save()
        portable = self.export_cli(live["deliveryBatchId"])
        self.restore_cli(portable["file"]["path"])
        cold_phase = self.state["phases"].get("coldBrowser")
        if cold_phase and cold_phase.get("status") == "COMPLETE":
            cold = cold_phase["result"]
            verify(cold["report"], cold_phase["reportIdentity"])
        else:
            with self.owner(self.cold, "cold-receiver") as (connection, launch):
                need(launch["workspace_id"] == live["workspaceId"], "Cold receiving changed the original logical workspace.")
                cold = self.browser(connection, "inspect", expected={
                    "workspaceId": live["workspaceId"], "deliveryBatchId": live["deliveryBatchId"], "batches": live["batches"]
                })
            self.state["phases"]["coldBrowser"] = {"status": "COMPLETE", "result": cold, "reportIdentity": identity(cold["report"]), "at": stamp()}
            self.save()
        self.preflight(inspect_runtime=False)
        completed = self.finalize(live, cold)
        self.transfers(completed)
        return {**completed, "transfers": self.state["transfers"]}


def main():
    need(len(sys.argv) == 2, "Use run-receiving.py /private/complete-leap-receiving.json")
    configuration = read_json(sys.argv[1])
    receiver = Receiving(configuration)
    try:
        result = receiver.run()
        print(json.dumps({"status": "PASS", "operationId": OPERATION, "productPassed": True,
                          "report": result["report"], "workspace": result["workspace"], "delivery": result["delivery"],
                          "uploadedTargets": [row["targetId"] for row in result["transfers"].values() if row["status"] == "UPLOADED"]}), flush=True)
        return 0
    except BaseException as error:
        receiver.state["status"] = "DELIVERY_PENDING" if receiver.completion.exists() else "INCOMPLETE"
        receiver.state["error"] = {"type": type(error).__name__, "message": str(error), "at": stamp()}
        receiver.save()
        print(json.dumps({"status": receiver.state["status"], "operationId": OPERATION, "productPassed": receiver.completion.exists(),
                          "journal": str(receiver.journal_path), "error": receiver.state["error"]}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
