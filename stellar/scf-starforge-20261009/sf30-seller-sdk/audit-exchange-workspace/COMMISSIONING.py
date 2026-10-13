#!/usr/bin/env python3
"""Commission one complete Audit Exchange case through its native HTTP and browser workflows.

The original request files, source cohort, observed weather, native outputs, receiving
workspaces and full archive stay in one operation directory across continuation.
"""
from __future__ import annotations
import argparse
import base64
import contextlib
import csv
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
import uuid
import zipfile

FORMAT = "commons.audit-exchange.commissioning.v1"
INPUT_FORMAT = "commons.audit-exchange.commissioning-input.v1"
OPERATION = "AUDIT-EXCHANGE-NATIVE-6804-20261012"
FIXTURES = {
    "combined": ("fixture-l100-bsyncr-2.7.0.xml", 71256,
                 "9862c46fce26d90f019dab4ec9c2ccd79f4602cd48e117fb39d7e2103975c7b5"),
    "shared": ("fixture-multibuilding-2.6.0.xml", 7534,
               "dad421844083622b5d35031aa2438bf596218668ad1d6d04997de7de59c549fc"),
}

def canonical(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
def raw_json(value):
    return (canonical(value) + "\n").encode("utf-8")
def sha(raw):
    return hashlib.sha256(raw).hexdigest()
def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
def need(condition, message):
    if not condition:
        raise RuntimeError(message)
def emit(value):
    print(canonical(value), flush=True)
def read_json(path):
    return json.loads(Path(path).read_bytes())
def safe_name(value):
    need(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
         "Use one retained relative member name.")
    p = Path(value)
    need(not p.is_absolute() and all(part not in {"", ".", ".."} for part in p.parts),
         "Keep every source member inside its selected application.")
    return p

def atomic(path, raw, *, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not replace:
        need(not path.is_symlink() and path.read_bytes() == raw,
             "A retained original file differs: " + str(path))
        return
    fd, candidate = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        if replace:
            os.replace(candidate, path)
        else:
            try:
                os.link(candidate, path, follow_symlinks=False)
            except FileExistsError:
                need(path.read_bytes() == raw, "Another original file differs: " + str(path))
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(candidate).unlink(missing_ok=True)

def package(raw):
    """Read and verify the actual export's complete member inventory."""
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        need(len(names) == len(set(names)) and "manifest.json" in names,
             "The complete export must contain one original member per name.")
        for item in members:
            safe_name(item.filename)
            need(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16),
                 "A workspace export contains ordinary complete members.")
        manifest = json.loads(archive.read("manifest.json"))
        rows = manifest["members"]
        need(len(rows) == len(names) - 1 and {row["path"] for row in rows} == set(names) - {"manifest.json"},
             "The actual export inventory does not cover its full member set.")
        bodies = {}
        for row in rows:
            body = archive.read(row["path"])
            need(len(body) == row["bytes"] and sha(body) == row["sha256"],
                 "The retained export member changed: " + row["path"])
            bodies[row["path"]] = body
        return manifest, bodies

class Case:
    def __init__(self, directory, inputs_path, application, adopt_source=False):
        self.root = Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.guard = os.open(self.root / "operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(self.guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.input_path = Path(inputs_path).resolve()
        self.inputs = read_json(self.input_path)
        need(self.inputs.get("format") == INPUT_FORMAT, "Select the complete original commissioning input.")
        need(self.inputs.get("operation", OPERATION) == OPERATION, "Keep this original commissioning operation.")
        need(isinstance(self.inputs.get("operator"), str) and self.inputs["operator"].strip(),
             "Record the actual commissioning operator.")
        atomic(self.root / "inputs" / "original-input.json", raw_json(self.inputs))
        self.operator = self.inputs["operator"]
        self.hosts = []
        self.application = self.freeze(Path(application).resolve(), adopt_source)
        self.fixtures = {}
        for label, (name, length, digest) in FIXTURES.items():
            raw = (self.application / "standards" / name).read_bytes()
            need(len(raw) == length and sha(raw) == digest, "Retain the untouched original " + name)
            path = self.root / "inputs" / name
            atomic(path, raw)
            self.fixtures[label] = {"path": str(path), "name": name, "bytes": length, "sha256": digest}
        weather = self.inputs["weather"]
        weather_path = Path(weather["path"])
        if not weather_path.is_absolute():
            weather_path = self.input_path.parent / weather_path
        weather_raw = weather_path.read_bytes()
        need(sha(weather_raw) == weather["sha256"] and isinstance(weather.get("source"), str) and weather["source"].strip(),
             "Use the exact acquired weather file and its acquisition reference.")
        atomic(self.root / "inputs" / "observed-weather.csv", weather_raw)
        atomic(self.root / "inputs" / "weather-acquisition.json", raw_json(weather))
        self.weather = {**weather, "path": str(self.root / "inputs" / "observed-weather.csv"), "bytes": len(weather_raw)}
        self.models = self.inputs["modelOptions"]
        need(isinstance(self.models, dict) and self.models.get("weatherUnits") and self.models.get("weatherInterval"),
             "Retain the actual observed weather units, interval and complete native model options.")

    def freeze(self, directory, adopt):
        manifest = directory / "SOURCE_FILES.json"
        source_names = read_json(manifest)["files"]
        need(isinstance(source_names, list) and len(source_names) == len(set(source_names)),
             "Use the original complete application inventory.")
        names = sorted(set(source_names + ["SOURCE_FILES.json"]))
        bodies, rows = {}, []
        for name in names:
            path = directory / safe_name(name)
            need(path.is_file() and not path.is_symlink(), "A complete application source is missing: " + name)
            raw = path.read_bytes()
            bodies[name] = raw
            rows.append({"path": name, "bytes": len(raw), "sha256": sha(raw)})
        digest = sha(raw_json(rows))
        active = self.root / "active-source.json"
        if active.exists():
            previous = read_json(active)
            need(previous["sha256"] == digest or adopt,
                 "Use --adopt-source to retain a deliberate complete source correction in the same operation.")
        target = self.root / "source" / digest
        for name, body in bodies.items():
            atomic(target / name, body)
        record = {"format": FORMAT, "operation": OPERATION, "sha256": digest, "files": rows}
        atomic(self.root / "source" / (digest + ".json"), raw_json(record))
        atomic(active, raw_json(record), replace=True)
        return target

    def step(self, name, run):
        path = self.root / "stages" / (name + ".json")
        if path.exists():
            result = read_json(path)
            need(result.get("operation") == OPERATION and result.get("stage") == name,
                 "Open the same original completed stage.")
        else:
            result = {"format": FORMAT, "operation": OPERATION, "stage": name, "at": now(), "result": run()}
            atomic(path, raw_json(result))
        emit(result)
        return result["result"]

    def mutation(self, host, label, action, inputs):
        original = self.root / "requests" / (label + ".json")
        if original.exists():
            envelope = read_json(original)
            need(envelope["action"] == action and envelope["inputs"] == inputs,
                 "Keep the complete original mutation inputs for " + label)
        else:
            envelope = {"action": action, "inputs": inputs,
                        "requestId": str(uuid.uuid5(uuid.NAMESPACE_URL, OPERATION + ":" + host.name + ":" + label)),
                        "expectedVersion": host.state()["version"]}
            atomic(original, raw_json(envelope))
        receipt = self.root / "responses" / (label + ".json")
        if receipt.exists():
            outcome = read_json(receipt)
            observed = host.read("operation.get", {"requestId": envelope["requestId"]})
            need(observed["action"] == action and observed["result"] == outcome["result"],
                 "The original workspace mutation receipt differs.")
            return outcome["result"]
        try:
            response = host.action(envelope)
        except (OSError, urllib.error.URLError, RuntimeError):
            # Reconcile one actual committed result before any original envelope is resent.
            try:
                observed = host.read("operation.get", {"requestId": envelope["requestId"]})
            except Exception:
                raise
            need(observed["action"] == action, "The original request belongs to another action.")
            response = {"ok": True, "result": observed["result"], "state": host.state(), "recovered": True}
        atomic(receipt, raw_json(response))
        return response["result"]

    def download(self, host, record, name):
        path = self.root / "deliveries" / name
        raw = host.http(record["downloadUrl"], raw=True)[1]
        need(len(raw) == record["bytes"] and sha(raw) == record["sha256"],
             "The complete retained delivery changed.")
        atomic(path, raw)
        atomic(path.with_name(path.name + ".source.json"), raw_json(record))
        return path, raw

    def close(self):
        errors = []
        for host in reversed(self.hosts):
            try:
                host.close()
            except Exception as error:
                errors.append(str(error))
        if errors:
            raise RuntimeError("; ".join(errors))

    def archive(self, status):
        # A still-running original native process keeps its own input/output lease.
        for lock in self.root.glob("workspaces/*/native-analysis/*/operation.lock"):
            fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(fd)
        paths = []
        for path in sorted(self.root.rglob("*")):
            if path.is_symlink():
                raise RuntimeError("Keep the complete case's source files ordinary: " + str(path))
            if path.is_file():
                relative = path.relative_to(self.root).as_posix()
                if "__pycache__" in path.parts or path.name in {"operation.lock"}:
                    continue
                paths.append((relative, path))
        members = []
        fd, candidate = tempfile.mkstemp(prefix="." + self.root.name + ".case.", suffix=".zip", dir=self.root.parent)
        os.close(fd)
        try:
            with zipfile.ZipFile(candidate, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, path in paths:
                    before = path.stat()
                    raw = path.read_bytes()
                    after = path.stat()
                    need((before.st_ino, before.st_size, before.st_mtime_ns) ==
                         (after.st_ino, after.st_size, after.st_mtime_ns), "Close original writers before complete archival.")
                    archive.writestr(name, raw)
                    members.append({"path": name, "bytes": len(raw), "sha256": sha(raw)})
                archive.writestr("complete-case-manifest.json", raw_json({
                    "format": FORMAT, "operation": OPERATION, "status": status, "files": members}))
            body = Path(candidate).read_bytes()
            digest = sha(body)
            path = self.root.parent / (self.root.name + "-" + status + "-" + digest[:20] + ".zip")
            try:
                os.link(candidate, path)
            except FileExistsError:
                need(path.read_bytes() == body, "Keep the original completed case archive.")
            with zipfile.ZipFile(path) as archive:
                need({item.filename for item in archive.infolist()} ==
                     {row["path"] for row in members} | {"complete-case-manifest.json"}, "Archive closure changed.")
                for row in members:
                    raw = archive.read(row["path"])
                    need(len(raw) == row["bytes"] and sha(raw) == row["sha256"], "Archive member changed.")
            result = {"format": FORMAT, "operation": OPERATION, "status": status, "path": str(path),
                      "bytes": len(body), "sha256": digest, "files": len(members)}
            atomic(self.root.parent / (self.root.name + "-latest-archive.json"), raw_json(result), replace=True)
            emit({"stage": "COMPLETE_CASE_ARCHIVE", **result})
            return result
        finally:
            Path(candidate).unlink(missing_ok=True)

class Host:
    def __init__(self, case, name, application=None):
        self.case, self.name = case, name
        self.application = Path(application or case.application)
        self.directory = case.root / "workspaces" / name
        self.directory.mkdir(parents=True, exist_ok=True)
        self.process = None
        self.log = None
        self.startup_file = case.root / "hosts" / (name + ".json")
        self.connection = None
        if self.startup_file.exists():
            saved = read_json(self.startup_file)
            self.connection = saved["startup"]
            try:
                current = self.state()
                identity = self.http("/api/identity")[1]
                need(identity == self.connection and current["workspaceId"] == self.connection["workspaceId"],
                     "The existing native listener's exact identity changed.")
                self.process_identity = saved["process"]
                self.owned_here = False
                case.hosts.append(self)
                return
            except (OSError, urllib.error.URLError):
                self.connection = None
        self.log_path = case.root / "logs" / (name + "-server.log")
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log = self.log_path.open("ab", buffering=0)
        command = [sys.executable, str(self.application / "application.py"), "serve",
                   "--directory", str(self.directory), "--host", "127.0.0.1", "--port", "0"]
        environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
        self.process = subprocess.Popen(command, cwd=self.application, env=environment,
                                        stdout=subprocess.PIPE, stderr=self.log, start_new_session=True)
        self.process_identity = {"pid": self.process.pid, "command": command, "start": self.process_start(self.process.pid)}
        self.owned_here = True
        case.hosts.append(self)
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            need(selector.select(timeout=90), "The actual native server has not returned its startup record.")
            line = self.process.stdout.readline()
            startup = json.loads(line)
            need(startup["schema"] == "commons.audit-exchange.startup.v1" and
                 Path(startup["directory"]).resolve() == self.directory.resolve(),
                 "Use the server's actual original workspace startup record.")
            self.connection = startup
            atomic(self.startup_file, raw_json({"startup": startup, "process": self.process_identity}), replace=True)
            need(self.state()["workspaceId"] == startup["workspaceId"], "The native server identity differs.")
        finally:
            selector.close()

    @staticmethod
    def process_start(pid):
        try:
            return Path("/proc", str(pid), "stat").read_text().rsplit(")", 1)[1].split()[19]
        except (OSError, IndexError):
            return None

    def http(self, path, body=None, raw=False):
        headers = {"X-Audit-Workspace-Id": self.connection["workspaceId"]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.connection["url"].rstrip("/") + path,
                                         data=body, headers=headers, method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                value = response.read()
                return dict(response.headers), value if raw else json.loads(value)
        except urllib.error.HTTPError as error:
            observed = error.read().decode("utf-8", "replace")
            raise RuntimeError("Native HTTP " + str(error.code) + ": " + observed) from error

    def state(self):
        return self.http("/api/state")[1]["result"]
    def read(self, action, inputs):
        return self.action({"action": action, "inputs": inputs})["result"]
    def action(self, envelope):
        response = self.http("/api/action", raw_json(envelope))[1]
        need(response.get("ok") is True, "The complete native action was refused.")
        return response

    def close(self):
        if self.process is not None and self.owned_here:
            # The live Popen child handle is authoritative in its own producing
            # process, including PID namespaces without readable /proc/<pid>.
            if self.process.poll() is None:
                if self.connection is not None:
                    try:
                        identity = self.http("/api/identity")[1]
                    except (OSError, urllib.error.URLError):
                        identity = None
                    need(identity is None or identity == self.connection,
                         "Keep the owned original listener's exact HTTP identity.")
                self.process.terminate()
                self.process.wait(timeout=30)
            if self.log:
                self.log.close()
            self.connection = None
            return
        if self.connection is None:
            if self.log:
                self.log.close()
            return
        pid = self.process_identity["pid"]
        try:
            identity = self.http("/api/identity")[1]
        except (OSError, urllib.error.URLError):
            identity = None
        start = self.process_identity["start"]
        if identity is not None:
            need(identity == self.connection and start is not None and self.process_start(pid) == start,
                 "Retain the original server process until its exact owner can close it.")
            os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 30
            while self.process_start(pid) == start:
                need(time.monotonic() < deadline, "The original native listener is still closing.")
                time.sleep(.1)
        elif start is not None:
            need(self.process_start(pid) != start,
                 "Reconcile the original retained server process before capturing its workspace.")
        if self.log:
            self.log.close()
        self.connection = None

def import_source(case, host, label):
    original = case.fixtures[label]
    return case.mutation(host, "import-" + label, "source.import", {
        "name": original["name"], "contentBase64": base64.b64encode(Path(original["path"]).read_bytes()).decode("ascii"),
        "selectedSchema": "2.7.0", "profileIds": ["ashrae-l100", "bsyncr-input"] if label == "combined" else [],
        "actor": case.operator, "note": "Retain the complete unchanged published BuildingSync example and original validation selection."})

def full_source(case, host, imported, label):
    inputs = {"sourceId": imported["sourceId"], "revisionId": imported["revisionId"]}
    detail = host.read("source.get", inputs)
    atomic(case.root / "sources" / (label + "-complete-detail.json"), raw_json(detail))
    for section in ("entities", "fields", "references", "timeSeries", "diagnostics"):
        rows, offset = [], 0
        while True:
            page = host.read("source.page", {**inputs, "section": section, "offset": offset, "limit": 500})
            need(page["sourceId"] == inputs["sourceId"] and page["revisionId"] == inputs["revisionId"] and
                 page["sha256"] == detail["revision"]["sha256"] and page["offset"] == offset,
                 "Continue the same complete native source page.")
            rows.extend(page["items"])
            if page["nextOffset"] is None:
                need(len(rows) == page["total"], "The full native source page sequence is incomplete.")
                break
            need(page["nextOffset"] > offset, "The original source page did not advance.")
            offset = page["nextOffset"]
        need(rows == detail["model"][section], "The full original model page sequence changed.")
        atomic(case.root / "sources" / (label + "-" + section + ".json"), raw_json(rows))
    raw, offset = bytearray(), 0
    while True:
        part = host.read("source.bytes", {**inputs, "offset": offset, "length": 1024 * 1024})
        need(part["id"] == imported["revisionId"] and part["offset"] == offset and part["sha256"] == detail["revision"]["sha256"],
             "Keep the original complete XML byte identity.")
        chunk = base64.b64decode(part["contentBase64"], validate=True)
        need(len(chunk) == part["length"], "An original source byte range changed.")
        raw.extend(chunk)
        if part["complete"]:
            need(len(raw) == part["bytes"] and part["nextOffset"] is None, "The native XML read ended early.")
            break
        need(part["nextOffset"] == len(raw), "The next original XML offset differs.")
        offset = part["nextOffset"]
    need(bytes(raw) == Path(case.fixtures[label]["path"]).read_bytes(), "The complete original XML bytes changed.")
    counts = detail["source"]["counts"]
    if label == "combined":
        need(counts["timeSeries"] == 84 and counts["scenarios"] == 4 and counts["measures"] == 2 and counts["resources"] == 3,
             "The complete original L100/BSyncr model differs from the published fixture.")
        streams = {}
        for row in detail["model"]["timeSeries"]:
            streams.setdefault(row["streamKey"], []).append(row)
        need(len(streams) == 7 and all(len(rows) == 12 for rows in streams.values()), "The original seven complete streams changed.")
        need(all(not row["buildingKeys"] for row in detail["model"]["timeSeries"]),
             "Retain the original example's unassigned building associations.")
    else:
        systems = [row for row in detail["model"]["entities"] if row.get("semanticKind") == "system"]
        need(counts["buildings"] == 2 and len(systems) == 3 and sorted(len(row["buildingKeys"]) for row in systems) == [1, 2, 2],
             "The complete shared-system associations differ.")
        need(detail["source"]["declaredVersion"] == "2.6.0" and detail["revision"]["selectedSchema"] == "2.7.0",
             "Keep declared version and selected schema separate.")
    need(detail["validation"]["xsd"]["valid"], "The untouched original example did not pass its selected native schema.")
    return {"sourceId": imported["sourceId"], "revisionId": imported["revisionId"],
            "sha256": detail["revision"]["sha256"], "counts": counts}

def chosen_analysis(detail, requested=None):
    requested = requested or {}
    entities = detail["model"]["entities"]
    choices = {}
    for key, kind, default in (("buildingKey", "building", "Building-A"),
                               ("scenarioKey", "scenario", "Report-A-Scenario-A"),
                               ("resourceKey", "resource-use", "ResourceUse-Electricity")):
        supplied = requested.get(key.replace("Key", "XmlId"), default)
        found = [row for row in entities if row.get("semanticKind") == kind and row["xmlId"] == supplied]
        need(len(found) == 1, "Choose one actual source-local " + kind + " identity.")
        choices[key] = found[0]["key"]
    reading_type, units = requested.get("readingType", "Total"), requested.get("units", "kWh")
    rows = [row for row in detail["model"]["timeSeries"] if
            row["scenarioKey"] == choices["scenarioKey"] and row["resourceKey"] == choices["resourceKey"] and
            row["readingType"] == reading_type and row["units"] == units]
    streams = {row["streamKey"] for row in rows}
    selected_stream = requested.get("streamKey")
    need(selected_stream in streams if selected_stream else len(streams) == 1,
         "Choose the exact native stream for the observed weather/model run.")
    return {"sourceId": detail["source"]["id"], "revisionId": detail["revision"]["id"], **choices,
            "readingType": reading_type, "units": units, "streamKey": selected_stream or next(iter(streams))}

def browser_journey(case, host, combined):
    detail = host.read("source.get", {"sourceId": combined["sourceId"], "revisionId": combined["revisionId"]})
    selection = chosen_analysis(detail, case.inputs.get("analysisSelection"))
    preview = host.read("analysis.preview", selection)
    need(len(preview["readings"]) == 12 and not any(row["severity"] == "error" for row in preview["diagnostics"]),
         "The actual complete twelve-reading source selection needs its native source corrections.")
    atomic(case.root / "sources" / "original-analysis-preview.json", raw_json(preview))
    document = {"format": "commons.audit-exchange.browser-input.v1", "operation": OPERATION,
                "url": host.connection["url"], "workspaceId": host.connection["workspaceId"],
                "instanceId": host.connection["instanceId"], "operator": case.operator,
                "directory": str(case.root / "browser"), "sharedFixture": case.fixtures["shared"],
                "combined": combined, "analysisSelection": selection, "weather": case.weather,
                "modelOptions": case.models, "browser": case.inputs.get("browser", {})}
    wire = case.root / "browser" / "current-connection.json"
    atomic(wire, raw_json(document), replace=True)
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    need(node, "Use the actual installed Node runtime for the complete operator journey.")
    log = case.root / "logs" / "browser-native.log"
    attempts = case.root / "browser" / "native-attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    number = max((int(path.name) for path in attempts.iterdir() if path.is_dir() and path.name.isdigit()), default=0) + 1
    attempt = attempts / ("%04d" % number)
    attempt.mkdir()
    command = [node, str(case.application / "BROWSER_COMMISSIONING.mjs"), "--input", str(wire)]
    log_offset = log.stat().st_size if log.exists() else 0
    invocation = {"format": FORMAT, "operation": OPERATION, "attempt": number, "startedAt": now(),
                  "command": command, "directory": str(case.application), "inputPath": str(wire),
                  "inputSha256": sha(raw_json(document)), "timeoutSeconds": 900,
                  "sourceSha256": read_json(case.root / "active-source.json")["sha256"],
                  "browserSourceSha256": sha((case.application / "BROWSER_COMMISSIONING.mjs").read_bytes()),
                  "logPath": str(log), "logOffset": log_offset}
    atomic(attempt / "input.json", raw_json(document))
    atomic(attempt / "invocation.json", raw_json(invocation))
    child = None
    failure = None
    try:
        with log.open("ab", buffering=0) as output:
            child = subprocess.Popen(command, cwd=case.application, stdout=output, stderr=subprocess.STDOUT,
                                     env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"), start_new_session=True,
                                     pass_fds=(case.guard,))
            atomic(attempt / "process.json", raw_json({"pid": child.pid, "start": Host.process_start(child.pid),
                                                        "command": command, "startedAt": now()}))
            try:
                child.wait(timeout=900)
            except subprocess.TimeoutExpired as error:
                failure = error
                child.terminate()
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=30)
    except BaseException as error:
        failure = error
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=30)
    finally:
        observed = log.read_bytes()[log_offset:] if log.exists() else b""
        outcome = {"format": FORMAT, "operation": OPERATION, "attempt": number, "finishedAt": now(),
                   "returncode": child.poll() if child is not None else None,
                   "started": child is not None, "logPath": str(log), "logOffset": log_offset,
                   "logBytes": len(observed), "logSha256": sha(observed),
                   "errorType": type(failure).__name__ if failure else None,
                   "error": str(failure) if failure else None}
        atomic(attempt / "native-output.log", observed)
        atomic(attempt / "outcome.json", raw_json(outcome))
        emit({"stage": "ORIGINAL_BROWSER_NATIVE_RETURNED", **outcome})
    if failure is not None:
        raise RuntimeError("Original browser attempt " + str(number) + " returned " +
                           str(outcome["returncode"]) + "; inspect " + str(attempt / "outcome.json") +
                           ": " + str(failure)) from failure
    need(outcome["returncode"] == 0, "Original browser attempt " + str(number) + " returned " +
         str(outcome["returncode"]) + "; inspect " + str(attempt / "outcome.json") + " and " + str(log))
    outcome = read_json(case.root / "browser" / "result.json")
    need(outcome["operation"] == OPERATION and outcome["workspaceId"] == host.connection["workspaceId"] and
         outcome["status"] == "passed", "The original full operator journey has not completed.")
    return outcome

def projection_handoff(case, host, browser):
    exported = host.read("export.get", {"exportId": browser["projection"]["exportId"]})
    path, raw = case.download(host, exported, "Complete_Audit_Turnover_Projection.zip")
    manifest, members = package(raw)
    selection = json.loads(members["projection.json"])
    catalogue = read_json(case.application / "standards" / "standards.json")["consumerTables"]
    csv_names = {name for name in members if name.startswith("registers/") and name.endswith(".csv")}
    need(csv_names == {"registers/" + name + ".csv" for name in catalogue},
         "The complete handoff needs all eight original consumer tables.")
    rows = {}
    for name, contract in catalogue.items():
        csv_body = members["registers/" + name + ".csv"].decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(csv_body, newline=""))
        need(reader.fieldnames == contract["columns"], "Keep the consumer's exact table columns: " + name)
        rows[name] = list(reader)
        need(rows[name] == selection["tables"][name], "The full native table projection differs: " + name)
    need(sha(members[selection["sourcePath"]]) == selection["tables"]["sources"][0]["sha256"],
         "The full source XML must accompany its eight-table projection.")
    handoff = case.root / "handoff" / "turnover"
    for name, body in members.items():
        atomic(handoff / safe_name(name), body)
    with zipfile.ZipFile(io.BytesIO(raw)) as original_archive:
        atomic(handoff / "manifest.json", original_archive.read("manifest.json"))
    result = {"projectionSha256": sha(raw), "path": str(path), "directory": str(handoff),
              "sourceId": selection["sourceId"], "revisionId": selection["revisionId"],
              "selectionSha256": selection["selectionSha256"],
              "tables": {name: len(items) for name, items in rows.items()},
              "sourceEntityKeys": selection["selection"]["assetEntityKeys"],
              "sourceEntityKey": selection["selection"]["assetEntityKeys"][0],
              "exportId": exported["id"]}
    atomic(case.root / "handoff" / "projection.json", raw_json(result))
    emit({"stage": "COMPLETE_TURNOVER_READY_FOR_ORIGINAL_CONSUMER", **result})
    return result

def native_analysis(case, host, browser, resume_label=None):
    identity = browser["analysis"]["analysisId"]
    def selected():
        return next(row for row in host.state()["analysisRuns"] if row["id"] == identity)
    row = selected()
    if row["status"] in {"needs-runtime", "needs-input", "failed"} and row.get("metadata", {}).get("terminal") is False:
        need(resume_label, "Repair the reported native condition and continue with --resume-analysis LABEL on this original analysis ID.")
        need(all(char.isalnum() or char in "-_" for char in resume_label), "Use one retained native continuation label.")
        case.mutation(host, "resume-analysis-" + resume_label, "analysis.resume", {
            "analysisId": identity, "actor": case.operator,
            "note": "Continue the same original native inputs after runtime repair: " + resume_label})
    deadline = time.monotonic() + max(600, int(case.models.get("timeoutSeconds", 3600)) + 180)
    previous = None
    while True:
        row = selected()
        status = row["status"]
        if status != previous:
            emit({"stage": "ORIGINAL_NATIVE_ANALYSIS", "analysisId": identity, "status": status,
                  "diagnostics": row.get("diagnostics", []), "at": now()})
            previous = status
        if status not in {"queued", "running"}:
            break
        need(time.monotonic() < deadline, "The same original native analysis is still running; preserve its ID and retained input.")
        time.sleep(3)
    atomic(case.root / "analysis" / (identity + "-" + sha(raw_json(row))[:16] + ".json"), raw_json(row))
    need(status in {"complete", "partial"} and row.get("metadata", {}).get("terminal") is True,
         "Continue the retained native outcome after its actual reported condition is repaired: " + canonical(row.get("diagnostics", [])))
    need(row.get("readingCount") == 12 and row["modelOptions"] == case.models,
         "The native engine must retain the original full readings and complete model options.")
    outputs = []
    for item in row["outputs"]:
        export = host.read("export.get", {"exportId": item["id"]})
        path, raw = case.download(host, export, "native/" + safe_name(item["name"]).name)
        outputs.append({"id": export["id"], "name": item["name"], "path": str(path),
                        "sha256": sha(raw), "bytes": len(raw)})
    need(outputs, "Retain the actual native model outputs with their full input and model outcomes.")
    return {"analysisId": identity, "status": status, "outputs": outputs,
            "metadata": row.get("metadata", {}), "diagnostics": row["diagnostics"]}

def consumer_join(case, host, projection, receipt_path=None):
    path = Path(receipt_path) if receipt_path else case.root / "handoff" / "consumer-receipt.json"
    need(path.is_file(), "The original consumer can now write its complete receiving result to " + str(path))
    receipt = read_json(path)
    need(receipt.get("format") == "commons.audit-exchange.consumer-receipt.v1" and
         receipt["projectionSha256"] == projection["projectionSha256"] and
         receipt["sourceId"] == projection["sourceId"] and receipt["revisionId"] == projection["revisionId"] and
         receipt["sourceEntityKey"] in projection["sourceEntityKeys"] and receipt["targetKind"] == "turnover",
         "Join the actual original consumer result to this exact source projection.")
    evidence = Path(receipt["evidence"]["path"])
    if not evidence.is_absolute():
        evidence = path.parent / evidence
    evidence_raw = evidence.read_bytes()
    need(sha(evidence_raw) == receipt["evidence"]["sha256"], "Retain the complete original consumer result.")
    atomic(case.root / "handoff" / "consumer-original-result.json", evidence_raw)
    atomic(case.root / "handoff" / "accepted-consumer-receipt.json", raw_json(receipt))
    result = case.mutation(host, "native-consumer-source-link", "link.save", {
        "sourceId": receipt["sourceId"], "revisionId": receipt["revisionId"], "entityKey": receipt["sourceEntityKey"],
        "targetKind": "turnover", "targetWorkspaceId": receipt["targetWorkspaceId"],
        "targetRecordId": receipt["targetRecordId"], "note": receipt["note"], "actor": case.operator})
    return {"linkId": result["linkId"], "consumer": receipt}

def frozen_review(case, host, browser):
    original = browser["reviewRecord"]
    need(original["id"] == browser["review"]["reviewId"] and
         original["sourceId"] == browser["patched"]["sourceId"] and
         original["revisionId"] == browser["patched"]["revisionId"],
         "Keep the complete original review before its accepted continuation.")
    updated = {name: original.get(name, "") for name in
               ("id", "sourceId", "revisionId", "entityKey", "title", "assignee", "dueDate", "evidence")}
    updated.update(status="accepted", note="Original source-bound review accepted after full native commissioning.",
                   actor=case.operator)
    case.mutation(host, "accept-source-review", "review.save", updated)
    exported = case.mutation(host, "frozen-original-edition-review", "export.create", {
        "kind": "review", "editionId": browser["edition"]["editionId"],
        "actor": case.operator, "note": "Retain the complete previously saved edition and its original review state."})
    path, raw = case.download(host, exported, "Original_Edition_Review.html")
    body = raw.decode("utf-8")
    need(original["note"] in body and updated["note"] not in body,
         "The saved edition's full review must retain its original source-bound state.")
    return {"reviewId": original["id"], "editionId": browser["edition"]["editionId"],
            "export": exported, "path": str(path)}

def snapshot_history(snapshot):
    records = snapshot["records"]
    sources = {row["id"]: row["payload"] for row in records if row["kind"] == "source"}
    revisions = [row["payload"] for row in records if row["kind"] == "revision"]
    return {"originalSourceHashes": sorted(row["originalSha256"] for row in sources.values()),
            "revisionHashes": sorted(row["sha256"] for row in revisions),
            "sources": len(sources), "revisions": len(revisions),
            "editions": sum(row["kind"] == "edition" for row in records),
            "reviews": sum(row["kind"] == "review" for row in records),
            "links": sum(row["kind"] == "link" for row in records),
            "analysis": sum(row["kind"] == "analysis" for row in records)}

def receiving_chain(case, host, browser):
    edition = case.mutation(host, "complete-native-delivery-edition", "edition.save", {
        "name": "Complete native audit and turnover receiving", "note": "Full reviewed source, actual native model outcomes and original consumer join.",
        "actor": case.operator})
    exported = case.mutation(host, "complete-editable-application", "export.create", {
        "kind": "application", "editionId": edition["editionId"], "actor": case.operator,
        "note": "Complete original XML, every revision and edition, native inputs/outputs, review work and editable application."})
    path, raw = case.download(host, exported, "Complete_Audit_Exchange_Application.zip")
    manifest, members = package(raw)
    original_snapshot = json.loads(members["workspace.json"])
    original_history = snapshot_history(original_snapshot)
    received_application = case.root / "received-application"
    application_names = []
    for name, body in members.items():
        if name.startswith("application/"):
            relative = name[len("application/"):]
            atomic(received_application / safe_name(relative), body)
            application_names.append(relative)
    declared = read_json(received_application / "SOURCE_FILES.json")["files"]
    need(set(declared) <= set(application_names) and {"application.py", "public/app.js", "analysis.py"} <= set(application_names),
         "The receiving package must contain the complete executable application inventory.")
    first = Host(case, "recipient-one", received_application)
    received = case.mutation(first, "receive-complete-application-once", "workspace.receive", {
        "contentBase64": base64.b64encode(raw).decode("ascii"), "name": path.name,
        "actor": case.operator, "note": "Receive the complete original audit under distinct local identities."})
    need(received["receivedSources"] == original_history["sources"] and
         set(received["sourceIdMap"]) == {row["id"] for row in original_snapshot["records"] if row["kind"] == "source"} and
         all(old != new for old, new in received["sourceIdMap"].items()),
         "The first receiving must retain complete sources with distinct local identities.")
    for source in first.state()["sources"]:
        original_id = next(old for old, new in received["sourceIdMap"].items() if new == source["id"])
        original_record = next(row["payload"] for row in original_snapshot["records"] if row["kind"] == "source" and row["id"] == original_id)
        need(source["originalSha256"] == original_record["originalSha256"], "Receiving changed the original source bytes.")
        detail = first.read("source.get", {"sourceId": source["id"]})
        for revision in detail["revisions"]:
            first.read("source.get", {"sourceId": source["id"], "revisionId": revision["id"]})
    forwarded = case.mutation(first, "forward-full-received-workspace", "export.create", {
        "kind": "workspace", "actor": case.operator, "note": "Forward the complete received audit with its original source and review history."})
    second_path, second_raw = case.download(first, forwarded, "Received_Audit_Forwarded_Workspace.zip")
    _, forwarded_members = package(second_raw)
    forwarded_snapshot = json.loads(forwarded_members["workspace.json"])
    need(snapshot_history(forwarded_snapshot) == original_history, "Forwarding changed the full original audit history.")
    second = Host(case, "recipient-two", received_application)
    twice = case.mutation(second, "receive-forwarded-audit-once", "workspace.receive", {
        "contentBase64": base64.b64encode(second_raw).decode("ascii"), "name": second_path.name,
        "actor": case.operator, "note": "Receive the complete forwarded original case and prior receiving history."})
    final = case.mutation(second, "retain-second-complete-receiving", "export.create", {
        "kind": "workspace", "actor": case.operator, "note": "Retain every original source generation and complete receiving hop."})
    final_path, final_raw = case.download(second, final, "Twice_Received_Complete_Audit.zip")
    _, final_members = package(final_raw)
    final_snapshot = json.loads(final_members["workspace.json"])
    need(snapshot_history(final_snapshot) == original_history, "The second full receiving changed source or review history.")
    revisions = [row["payload"] for row in final_snapshot["records"] if row["kind"] == "revision"]
    need(all(len(row.get("derivedHistory", [])) >= 2 for row in revisions),
         "The second receiving must retain the complete prior parsed model and validation history.")
    for row in final_snapshot["records"]:
        if row["kind"] in {"review", "link", "analysis", "edition", "projection"}:
            payload = row["payload"]
            need(payload.get("receivedFrom", {}).get("workspaceId") == first.connection["workspaceId"] and
                 len(payload.get("receivedHistory", [])) >= 1 and
                 payload["receivedHistory"][0].get("workspaceId") == host.connection["workspaceId"],
                 "The second receiving lost a complete original receiving hop.")
    for edition_summary in second.state()["editions"]:
        retained = second.read("edition.get", {"editionId": edition_summary["id"]})
        for analysis in retained["analysisRuns"]:
            for output in analysis["outputs"]:
                meta = second.read("export.get", {"exportId": output["id"]})
                need(output["downloadUrl"] == meta["downloadUrl"], "A frozen edition retained an obsolete output link.")
                _, output_bytes = second.http(output["downloadUrl"], raw=True)
                need(len(output_bytes) == meta["bytes"] and sha(output_bytes) == meta["sha256"],
                     "The full frozen native output changed after receiving.")
    second.close()
    cli_result = subprocess.run([sys.executable, str(received_application / "application.py"), "state",
                                 "--directory", str(second.directory), "--workspace-id", second_state_id(second)],
                                cwd=received_application, capture_output=True, timeout=120,
                                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
    atomic(case.root / "logs" / "received-application-cli.stdout.json", cli_result.stdout)
    atomic(case.root / "logs" / "received-application-cli.stderr.log", cli_result.stderr)
    need(cli_result.returncode == 0, "The complete received application did not reopen its original native workspace.")
    state = json.loads(cli_result.stdout)["result"]
    need(len(state["sources"]) == original_history["sources"], "The independent received CLI lost complete source history.")
    return {"edition": edition, "application": exported, "applicationPath": str(path), "applicationFiles": len(application_names),
            "first": received, "second": twice, "history": original_history,
            "forwardedPath": str(second_path), "finalPath": str(final_path), "finalSha256": sha(final_raw),
            "receivedCliWorkspaceId": state["workspaceId"]}

def second_state_id(host):
    return read_json(host.startup_file)["startup"]["workspaceId"]

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, help="Complete selected application containing SOURCE_FILES.json")
    parser.add_argument("--directory", required=True, help="Original native operation directory")
    parser.add_argument("--inputs", required=True, help="Complete original observed-weather and operator input JSON")
    parser.add_argument("--consumer-receipt", help="Actual original eight-table consumer result binding")
    parser.add_argument("--resume-analysis", metavar="REPAIR_LABEL", help="Continue the same recoverable native analysis after a named runtime repair")
    parser.add_argument("--adopt-source", action="store_true", help="Retain a deliberate full source correction alongside prior generations")
    args = parser.parse_args(argv)
    case = None
    error = None
    result = None
    try:
        case = Case(args.directory, args.inputs, args.application, args.adopt_source)
        host = Host(case, "author")
        combined = case.step("01-original-combined-source", lambda: import_source(case, host, "combined"))
        case.step("02-complete-original-source", lambda: full_source(case, host, combined, "combined"))
        browser = case.step("03-complete-operator-workflow", lambda: browser_journey(case, host, combined))
        case.step("04-original-shared-source", lambda: full_source(case, host, browser["shared"], "shared"))
        projection = case.step("05-complete-native-turnover-handoff", lambda: projection_handoff(case, host, browser))
        analysis = case.step("06-actual-native-models", lambda: native_analysis(case, host, browser, args.resume_analysis))
        joined = case.step("07-original-consumer-source-link", lambda: consumer_join(case, host, projection, args.consumer_receipt))
        case.step("08-original-frozen-edition-review", lambda: frozen_review(case, host, browser))
        received = case.step("09-complete-receiving-and-reopen", lambda: receiving_chain(case, host, browser))
        original_result = read_json(case.root / "result.json") if (case.root / "result.json").is_file() else None
        result = {"format": FORMAT, "operation": OPERATION, "status": "passed",
                  "completedAt": original_result["completedAt"] if original_result else now(),
                  "workspaceId": host.connection["workspaceId"], "sourceSha256": read_json(case.root / "active-source.json")["sha256"],
                  "nativeAnalysis": analysis, "consumer": joined, "receiving": received,
                  "stages": [read_json(path) for path in sorted((case.root / "stages").glob("*.json"))]}
        atomic(case.root / "result.json", raw_json(result))
    except BaseException as failure:
        error = failure
        if case:
            failure_record = {"format": FORMAT, "operation": OPERATION, "at": now(),
                              "error": str(failure), "traceback": traceback.format_exc()}
            atomic(case.root / "failures" / (sha(raw_json(failure_record)) + ".json"), raw_json(failure_record))
            emit({"stage": "ORIGINAL_OPERATION_CONTINUES", **failure_record})
    finally:
        if case:
            try:
                case.close()
                case.archive("passed" if result else "continuing")
            except BaseException as capture_error:
                emit({"stage": "ORIGINAL_CASE_CAPTURE_CONTINUES", "operation": OPERATION, "directory": str(case.root),
                      "error": str(capture_error), "traceback": traceback.format_exc()})
                error = error or capture_error
            os.close(case.guard)
    if error:
        return 1
    emit(result)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
