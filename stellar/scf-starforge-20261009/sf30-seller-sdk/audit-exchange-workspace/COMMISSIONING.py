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
        for pid in getattr(self, "rendered_process_groups", []):
            need(not rendered_group_alive(pid),
                 "Keep the original case until its rendered browser and native readers have all drained.")
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
            except (OSError, urllib.error.URLError):
                self.connection = None
            else:
                need(identity == self.connection and current["workspaceId"] == self.connection["workspaceId"],
                     "The existing native listener's exact identity changed.")
                self.process_identity = saved["process"]
                self.owned_here = False
                command = self.process_identity.get("command")
                need(isinstance(command, list) and len(command) >= 2 and isinstance(command[1], str),
                     "Retain the recorded original listener's complete application launch command.")
                same_application = Path(command[1]).resolve() == (self.application / "application.py").resolve()
                case.hosts.append(self)
                if same_application:
                    return
                # Preserve and close the exact surviving old listener before
                # serving an explicitly adopted immutable source generation.
                # Cleanup errors stay visible; they cannot enter the new launch.
                atomic(case.root / "hosts" / "history" / name / (sha(raw_json(saved)) + ".json"), raw_json(saved))
                self.close()
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
        if self not in case.hosts:
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


def initial_lda_handover(case, host):
    """Deliver the original full case before its potentially long native models."""
    exported = case.mutation(host, "lda-initial-full-workspace", "export.create", {
        "kind": "workspace", "actor": case.operator,
        "note": "Receive the complete original Audit workspace in LDA before the original native model continuation."})
    path, raw = case.download(host, exported, "Complete_Audit_LDA_Initial_Workspace.zip")
    _, members = package(raw)
    result = {"format": "commons.audit-exchange.lda-source.v1", "operation": OPERATION,
              "workspaceId": host.connection["workspaceId"], "path": str(path),
              "bytes": len(raw), "sha256": sha(raw), "exportId": exported["id"], "members": len(members)}
    atomic(case.root / "handoff" / "lda-initial-workspace.json", raw_json(result))
    emit({"stage": "ORIGINAL_COMPLETE_LDA_INITIAL_WORKSPACE_READY", **result})
    return result


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
        path, raw = case.download(host, export, "native/" + safe_name(item["name"]).as_posix())
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



def rendered_group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False

def stop_rendered_group(child):
    """Drain this owned browser session and its inherited native-reader lifetime."""
    if rendered_group_alive(child.pid):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass
    if rendered_group_alive(child.pid):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)
    child.wait(timeout=30)
    deadline = time.monotonic() + 30
    while rendered_group_alive(child.pid):
        need(time.monotonic() < deadline,
             "Retain the original case until its same rendered native-reader process group has drained.")
        time.sleep(.1)


def rendered_source_inventory(application):
    names = sorted(set(read_json(application / "SOURCE_FILES.json")["files"] + ["SOURCE_FILES.json"]))
    rows = []
    for name in names:
        path = application / safe_name(name)
        need(path.is_file() and not path.is_symlink(), "Open the complete actual served application: " + name)
        body = path.read_bytes()
        rows.append({"path": name, "bytes": len(body), "sha256": sha(body)})
    return {"sha256": sha(raw_json(rows)), "files": rows}


def run_browser_continuation(case, command, attempt, document, role):
    """Keep the original controller in the browser and each synchronous native reader."""
    invocation = {"format": FORMAT, "operation": OPERATION, "role": role,
                  "startedAt": now(), "command": command, "inputSha256": sha(raw_json(document)),
                  "sourceSha256": document["sourceSha256"], "servedSourceSha256": document["servedSourceSha256"],
                  "browserSourceSha256": sha((case.application / "BROWSER_COMMISSIONING.mjs").read_bytes()),
                  "timeoutSeconds": 3600}
    atomic(attempt / "invocation.json", raw_json(invocation))
    child, failure = None, None
    log = attempt / "native-output.log"
    try:
        with log.open("ab", buffering=0) as output:
            child = subprocess.Popen(command, cwd=case.application, stdout=output, stderr=subprocess.STDOUT,
                                     env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"), start_new_session=True,
                                     pass_fds=(case.guard,))
            case.rendered_process_groups = getattr(case, "rendered_process_groups", []) + [child.pid]
            atomic(attempt / "process.json", raw_json({"pid": child.pid, "start": Host.process_start(child.pid),
                                                       "startedAt": now(), "command": command}))
            try:
                child.wait(timeout=3600)
                if rendered_group_alive(child.pid):
                    stop_rendered_group(child)
            except subprocess.TimeoutExpired as error:
                failure = error
                stop_rendered_group(child)
    except BaseException as error:
        failure = error
        if child is not None:
            stop_rendered_group(child)
    finally:
        if child is not None and child.poll() is not None and not rendered_group_alive(child.pid):
            case.rendered_process_groups.remove(child.pid)
        observed = log.read_bytes() if log.exists() else b""
        outcome = {"format": FORMAT, "operation": OPERATION, "role": role,
                   "finishedAt": now(), "returncode": child.poll() if child else None,
                   "started": child is not None, "logBytes": len(observed), "logSha256": sha(observed),
                   "errorType": type(failure).__name__ if failure else None, "error": str(failure) if failure else None}
        atomic(attempt / "outcome.json", raw_json(outcome))
        emit({"stage": "ORIGINAL_BROWSER_CONTINUATION_RETURNED", **outcome})
    if failure:
        raise RuntimeError("Continue the same original browser case from " + str(attempt / "outcome.json")) from failure
    need(outcome["returncode"] == 0, "Open the actual original continuation failure: " + str(attempt / "outcome.json"))
    return outcome


def render_final_host(case, host, role, shared_source_id, shared_revision_id):
    """Use this same case's existing read/download controls, retaining every attempt."""
    state = host.state()
    source = read_json(case.root / "active-source.json")
    served = rendered_source_inventory(host.application)
    root = case.root / "rendered" / source["sha256"] / role
    root.mkdir(parents=True, exist_ok=True)
    selection = {"format": "commons.audit-exchange.rendered-selection.v1", "operation": OPERATION,
                 "role": role, "workspaceId": state["workspaceId"], "version": state["version"],
                 "sourceSha256": source["sha256"], "servedSourceSha256": served["sha256"],
                 "sharedSourceId": shared_source_id, "sharedRevisionId": shared_revision_id,
                 "exports": [{"id": row["id"], "name": row["name"], "bytes": row["bytes"], "sha256": row["sha256"]}
                             for row in state["exports"]]}
    identity = sha(raw_json(selection))
    selected = root / identity
    selected.mkdir(parents=True, exist_ok=True)
    atomic(selected / "selection.json", raw_json(selection))
    atomic(selected / "served-application.json", raw_json(served))
    # A complete unchanged capture is reusable. Direct producer viewing of those
    # same retained screens does not require another browser run.
    for prior_path in sorted(selected.glob("capture-*.json"), reverse=True):
        prior = read_json(prior_path)
        need(prior["workspaceId"] == state["workspaceId"] and prior["version"] == state["version"] and
             prior["sourceSha256"] == source["sha256"] and prior["servedSourceSha256"] == served["sha256"],
             "Retain the original final rendered selection.")
        previous = Path(prior["directory"])
        captured = read_json(previous / "rendered-capture.json")
        for row in captured["captures"]:
            data = (previous / safe_name(row["path"])).read_bytes()
            need(len(data) == row["bytes"] and sha(data) == row["sha256"], "The retained actual screen differs.")
        for row in captured["downloads"]:
            data = Path(row["path"]).read_bytes()
            need(len(data) == row["bytes"] and sha(data) == row["sha256"], "The retained opened attachment differs.")
        emit({"stage": "ORIGINAL_COMPLETE_RENDERING_REUSED", **prior})
        return prior
    attempts = selected / "attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    number = max((int(path.name) for path in attempts.iterdir() if path.is_dir() and path.name.isdigit()), default=0) + 1
    attempt = attempts / ("%04d" % number)
    attempt.mkdir()
    document = {**selection, "format": "commons.audit-exchange.rendered-input.v1",
                "url": host.connection["url"], "instanceId": host.connection["instanceId"],
                "operator": case.operator, "directory": str(attempt),
                "sharedOriginalSha256": FIXTURES["shared"][2], "browser": case.inputs.get("browser", {}),
                "pythonExecutable": sys.executable, "pythonCourse": str(case.application / "COMMISSIONING.py"),
                "controllerFD": case.guard, "controllerLock": str(case.root / "operation.lock")}
    wire = attempt / "input.json"
    atomic(wire, raw_json(document))
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    need(node, "Use the existing installed Node and actual browser for final case rendering.")
    command = [node, str(case.application / "BROWSER_COMMISSIONING.mjs"), "--render", str(wire)]
    run_browser_continuation(case, command, attempt, document, role)
    captured = read_json(attempt / "rendered-capture.json")
    need(captured["operation"] == OPERATION and captured["workspaceId"] == state["workspaceId"] and
         captured["version"] == state["version"] and captured["sourceSha256"] == source["sha256"] and
         captured["servedSourceSha256"] == served["sha256"] and
         captured["status"] == "captured-awaiting-producer-view",
         "The full rendered result must identify the exact original case and both source editions.")
    for row in captured["captures"]:
        body = (attempt / safe_name(row["path"])).read_bytes()
        need(sha(body) == row["sha256"] and len(body) == row["bytes"], "Retain the complete actual rendered screen.")
    result = {"role": role, "workspaceId": state["workspaceId"], "version": state["version"],
              "sourceSha256": source["sha256"], "servedSourceSha256": served["sha256"],
              "directory": str(attempt), "capturePath": str(attempt / "rendered-capture.json"),
              "openPath": str(attempt / "OPEN.html"), "captureCount": len(captured["captures"]),
              "downloadCount": len(captured["downloads"]), "openedCount": len(captured["opened"]),
              "status": captured["status"]}
    atomic(selected / ("capture-" + str(number).zfill(4) + ".json"), raw_json(result))
    return result


def colleague_return_continuation(case, author, browser, received):
    """A complete colleague exchange within the existing two received workspaces."""
    root = case.root / "colleague-return"
    root.mkdir(parents=True, exist_ok=True)
    application = case.root / "received-application"
    recipient = Host(case, "recipient-two", application)
    need(recipient.connection["workspaceId"] == received["receivedCliWorkspaceId"],
         "The colleague continues the same original independently received workspace.")
    selection_path = root / "original-selection.json"
    if selection_path.exists():
        selection = read_json(selection_path)
    else:
        original = author.read("source.get", {"sourceId": browser["patched"]["sourceId"],
                                               "revisionId": browser["patched"]["revisionId"]})
        colleague_sources = [row for row in recipient.state()["sources"]
                             if row["originalSha256"] == FIXTURES["shared"][2]]
        need(len(colleague_sources) == 1, "Select the single original shared-system source in the second receiving.")
        colleague = recipient.read("source.get", {"sourceId": colleague_sources[0]["id"]})
        def field_for(detail, building_id):
            matches = [row for row in detail["model"]["entities"]
                       if row["semanticKind"] == "building" and row["xmlId"] == building_id]
            need(len(matches) == 1, "Use the actual original BuildingSync building identity.")
            fields = [row for row in detail["model"]["fields"]
                      if row["entityKey"] == matches[0]["key"] and row["name"] == "PremisesName"
                      and row["kind"] == "text" and row["editable"]]
            need(len(fields) == 1, "The actual native building name must identify one editable field.")
            return fields[0]
        original_field, colleague_field = field_for(original, "Building2"), field_for(colleague, "Building1")
        systems = [row for row in colleague["model"]["entities"] if row["semanticKind"] == "system"
                   and row["kind"] == "HVACSystem" and len(row["buildingKeys"]) == 2]
        need(len(systems) == 1, "Keep the original cooling system's explicit two-building association.")
        def selected(field, suffix):
            return {"path": field["path"], "kind": field["kind"], "attributeName": field.get("attributeName"),
                    "expected": field["value"], "value": field["value"] + suffix}
        selection = {"format": "commons.audit-exchange.colleague-selection.v1", "operation": OPERATION,
                     "authorWorkspaceId": author.connection["workspaceId"],
                     "colleagueWorkspaceId": recipient.connection["workspaceId"],
                     "original": {"sourceId": original["source"]["id"], "baselineRevisionId": original["revision"]["id"],
                                  "field": selected(original_field, " - author coordination")},
                     "colleague": {"sourceId": colleague["source"]["id"], "baselineRevisionId": colleague["revision"]["id"],
                                   "field": selected(colleague_field, " - colleague review"),
                                   "reviewEntityKey": systems[0]["key"], "reviewXmlId": systems[0]["xmlId"]}}
        atomic(selection_path, raw_json(selection))
    need(selection["operation"] == OPERATION and selection["authorWorkspaceId"] == author.connection["workspaceId"] and
         selection["colleagueWorkspaceId"] == recipient.connection["workspaceId"],
         "Preserve both original workspaces and the complete selected field edits.")
    original, colleague = selection["original"], selection["colleague"]
    changed_colleague = case.mutation(recipient, "colleague-shared-building-correction", "source.patch", {
        "sourceId": colleague["sourceId"], "expectedRevisionId": colleague["baselineRevisionId"],
        "patches": [colleague["field"]], "actor": case.operator,
        "note": "Record the colleague's first-building name correction on the original shared-system audit."})
    reviewed = case.mutation(recipient, "colleague-shared-cooling-review", "review.save", {
        "sourceId": colleague["sourceId"], "revisionId": changed_colleague["revisionId"],
        "entityKey": colleague["reviewEntityKey"], "title": "Preserve the shared cooling service to both buildings",
        "status": "investigating", "note": "The original cooling HVAC system explicitly links Building1 and Building2. Retain both native associations while accepting the first-building naming correction.",
        "assignee": case.operator, "dueDate": "", "evidence": [], "actor": case.operator})
    changed_original = case.mutation(author, "author-shared-building-correction", "source.patch", {
        "sourceId": original["sourceId"], "expectedRevisionId": original["baselineRevisionId"],
        "patches": [original["field"]], "actor": case.operator,
        "note": "Retain the author's separate second-building naming correction before reviewing the colleague return."})
    returned = case.mutation(recipient, "colleague-complete-original-return", "export.create", {
        "kind": "workspace", "actor": case.operator,
        "note": "Return the complete original received audit, colleague correction, shared cooling review and all native history."})
    archive_path, archive_raw = case.download(recipient, returned, "Colleague_Complete_Audit_Return.zip")
    package(archive_raw)
    source = read_json(case.root / "active-source.json")
    browser_root = root / "browser"
    attempts = root / "native-attempts"
    attempts.mkdir(parents=True, exist_ok=True)
    number = max((int(path.name) for path in attempts.iterdir() if path.is_dir() and path.name.isdigit()), default=0) + 1
    attempt = attempts / ("%04d" % number)
    attempt.mkdir()
    document = {"format": "commons.audit-exchange.colleague-browser-input.v1", "operation": OPERATION,
                "url": author.connection["url"], "workspaceId": author.connection["workspaceId"],
                "instanceId": author.connection["instanceId"], "operator": case.operator,
                "version": author.state()["version"], "directory": str(browser_root),
                "captureDirectory": str(attempt / "rendered"), "sourceSha256": source["sha256"],
                "servedSourceSha256": rendered_source_inventory(author.application)["sha256"],
                "controllerFD": case.guard, "controllerLock": str(case.root / "operation.lock"),
                "browser": case.inputs.get("browser", {}),
                "returnedArchive": {"id": returned["id"], "path": str(archive_path),
                                    "sha256": sha(archive_raw), "bytes": len(archive_raw)},
                "original": {**original, "revisionId": changed_original["revisionId"]},
                "colleague": {**colleague, "revisionId": changed_colleague["revisionId"],
                              "reviewId": reviewed["reviewId"]}}
    atomic(attempt / "input.json", raw_json(document))
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    need(node, "Use the existing original browser runtime for the colleague return.")
    command = [node, str(case.application / "BROWSER_COMMISSIONING.mjs"), "--return", str(attempt / "input.json")]
    run_browser_continuation(case, command, attempt, document, "colleague-return")
    applied = read_json(browser_root / "result.json")
    need(applied["operation"] == OPERATION and applied["workspaceId"] == author.connection["workspaceId"] and
         applied["status"] == "passed", "Complete the actual same-case colleague return in its original UI.")
    exported = case.mutation(author, "complete-corrected-original-application", "export.create", {
        "kind": "application", "editionId": applied["applied"]["edition"]["editionId"], "actor": case.operator,
        "note": "Complete original application after explicit colleague correction decisions, author edit preservation and source-bound review receiving."})
    full_path, full_raw = case.download(author, exported, "Complete_Corrected_Audit_Application.zip")
    _, members = package(full_raw)
    snapshot = json.loads(members["workspace.json"])
    selected_revision = applied["applied"]["sources"][0]["revisionId"]
    need(any(row["kind"] == "revision" and row["id"] == selected_revision for row in snapshot["records"]) and
         any(row["kind"] == "review" and row["id"] == applied["review"]["id"] for row in snapshot["records"]) and
         any(row["sha256"] == sha(archive_raw) for row in snapshot["objects"]),
         "The full corrected application must include the accepted source, complete review and original colleague archive.")
    result = {"format": "commons.audit-exchange.colleague-exchange-result.v1", "operation": OPERATION,
              "status": "passed", "selection": selection, "returnedArchive": returned,
              "returnedPath": str(archive_path), "browser": applied, "application": exported,
              "applicationPath": str(full_path), "applicationSha256": sha(full_raw),
              "workspaceId": author.connection["workspaceId"], "colleagueWorkspaceId": recipient.connection["workspaceId"]}
    atomic(root / "result.json", raw_json(result))
    emit({"stage": "ORIGINAL_COLLEAGUE_RETURN_COMPLETE", "path": str(root / "result.json"),
          "workspaceId": result["workspaceId"], "revisionId": selected_revision,
          "applicationPath": str(full_path), "applicationSha256": result["applicationSha256"]})
    return result



def receive_corrected_application(case, author, received, colleague):
    """Continue recipient-one with the complete corrected outgoing application."""
    root = case.root / "colleague-return" / "onward"
    root.mkdir(parents=True, exist_ok=True)
    raw = Path(colleague["applicationPath"]).read_bytes()
    need(sha(raw) == colleague["applicationSha256"], "Retain the complete corrected outgoing application.")
    _, members = package(raw)
    original_snapshot = json.loads(members["workspace.json"])
    application = case.root / "corrected-received-application"
    application_names = []
    for name, body in members.items():
        if name.startswith("application/"):
            relative = name[len("application/"):]
            atomic(application / safe_name(relative), body)
            application_names.append(relative)
    declared = read_json(application / "SOURCE_FILES.json")["files"]
    need(set(declared) <= set(application_names) and
         {"application.py", "workspace.py", "correction_return.py", "public/corrections.js"} <= set(application_names),
         "Reopen the complete actual corrected application, including its native colleague workflow.")
    saved_workspace_id = read_json(case.root / "hosts" / "recipient-one.json")["startup"]["workspaceId"]
    # The first receiving host may still be open during the original uninterrupted
    # course; deliberately close that exact host before adopting the delivered app.
    first = next((host for host in case.hosts if host.name == "recipient-one" and host.connection is not None), None)
    if first is None:
        first = Host(case, "recipient-one", case.root / "received-application")
    need(first.connection["workspaceId"] == saved_workspace_id,
         "Continue the same recipient-one workspace and its original receiving history.")
    first.close()
    recipient = Host(case, "recipient-one", application)
    need(recipient.connection["workspaceId"] == saved_workspace_id,
         "The corrected application must reopen the original recipient workspace.")
    accepted = case.mutation(recipient, "receive-complete-corrected-application", "workspace.receive", {
        "contentBase64": base64.b64encode(raw).decode("ascii"),
        "name": Path(colleague["applicationPath"]).name, "actor": case.operator,
        "note": "Receive the complete corrected application into the same first recipient, preserving its earlier audit copies and history."})
    original_source_id = colleague["selection"]["original"]["sourceId"]
    shared_id = accepted["sourceIdMap"][original_source_id]
    need(shared_id not in set(received["first"]["sourceIdMap"].values()) and
         set(received["first"]["sourceIdMap"].values()) <= {row["id"] for row in recipient.state()["sources"]},
         "The onward receiving must preserve all previous recipient sources with distinct new local identities.")
    current = recipient.read("source.get", {"sourceId": shared_id})
    applied_source = next(item for item in colleague["browser"]["applied"]["sources"]
                          if item["sourceId"] == original_source_id)
    need(current["revision"]["sha256"] == applied_source["sha256"] and
         current["source"]["originalSha256"] == FIXTURES["shared"][2],
         "The onward recipient must open the exact accepted corrected native XML.")
    forwarded = case.mutation(recipient, "retain-complete-corrected-recipient", "export.create", {
        "kind": "workspace", "actor": case.operator,
        "note": "Retain the actual corrected receiving, previous received audit copies, all original colleague-return bytes and review history."})
    forwarded_path, forwarded_raw = case.download(recipient, forwarded, "Received_Corrected_Complete_Audit.zip")
    _, final_members = package(forwarded_raw)
    snapshot = json.loads(final_members["workspace.json"])
    original_workspace = original_snapshot["workspace"]["workspaceId"]
    package_sha = sha(raw)
    def matches(payload, original_id):
        provenance = payload.get("receivedFrom", {})
        return provenance.get("workspaceId") == original_workspace and \
               provenance.get("recordId") == original_id and provenance.get("packageSha256") == package_sha
    mapped = {}
    for record in original_snapshot["records"]:
        rows = [row["payload"] for row in snapshot["records"]
                if row["kind"] == record["kind"] and matches(row["payload"], record["id"])]
        need(len(rows) == 1, "Keep each full corrected receiving record and its original package identity.")
        mapped[record["id"]] = rows[0]
    actual_revision = mapped[applied_source["revisionId"]]
    original_review = colleague["browser"]["review"]
    actual_review = mapped[original_review["id"]]
    original_edition_id = colleague["browser"]["applied"]["edition"]["editionId"]
    actual_edition = mapped[original_edition_id]
    original_export = colleague["browser"]["applied"]["archive"]
    received_exports = [row for row in snapshot["priorExports"]
                        if row.get("receivedFrom", {}).get("workspaceId") == original_workspace and
                        row["receivedFrom"].get("exportId") == original_export["id"] and
                        row["receivedFrom"].get("packageSha256") == package_sha]
    need(len(received_exports) == 1, "Retain the exact complete original colleague-return archive on onward receiving.")
    received_export = received_exports[0]
    _, archive_bytes = recipient.http(received_export["downloadUrl"], raw=True)
    need(archive_bytes == Path(colleague["returnedPath"]).read_bytes() and
         received_export["sha256"] == colleague["returnedArchive"]["sha256"],
         "The onward receiving changed the complete original colleague archive.")
    need(actual_revision["id"] == current["revision"]["id"] and actual_revision["sourceId"] == shared_id and
         actual_revision["colleagueReturn"]["exportId"] == received_export["id"] and
         actual_revision["colleagueReturn"]["packageSha256"] == original_export["sha256"],
         "Keep the corrected revision's complete archive metadata and its remapped local export.")
    need(actual_review["sourceId"] == shared_id and actual_review["revisionId"] == actual_revision["id"] and
         actual_review["original"] == original_review["original"] and
         actual_review["colleagueReturn"]["exportId"] == received_export["id"] and
         any(row["id"] == actual_review["id"] for row in actual_edition["reviews"]) and
         any(row["sourceId"] == shared_id and row["revisionId"] == actual_revision["id"] for row in actual_edition["sources"]),
         "Keep the full returned review, native source binding and saved correction edition after remapping.")
    edition = recipient.read("edition.get", {"editionId": actual_edition["id"]})
    need(edition == actual_edition, "Open the actual full received saved edition.")
    recipient.close()
    cli = [sys.executable, str(application / "application.py"), "state", "--directory", str(recipient.directory),
           "--workspace-id", saved_workspace_id]
    child = subprocess.run(cli, cwd=application, capture_output=True, timeout=120,
                           env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"), pass_fds=(case.guard,))
    atomic(root / "reopened-cli.stdout.json", child.stdout)
    atomic(root / "reopened-cli.stderr.log", child.stderr)
    atomic(root / "reopened-cli-outcome.json", raw_json({"command": cli, "returncode": child.returncode,
           "stdoutSha256": sha(child.stdout), "stderrSha256": sha(child.stderr)}))
    need(child.returncode == 0, "Reopen the complete corrected application through its original native CLI.")
    state = json.loads(child.stdout)["result"]
    need(state["workspaceId"] == saved_workspace_id and
         any(row["id"] == shared_id and row["currentRevisionId"] == actual_revision["id"] for row in state["sources"]),
         "The independently reopened recipient must keep the exact corrected source selection.")
    result = {"format": "commons.audit-exchange.corrected-receiving.v1", "operation": OPERATION,
              "workspaceId": saved_workspace_id, "applicationDirectory": str(application),
              "applicationSha256": package_sha, "received": accepted,
              "sourceId": shared_id, "revisionId": actual_revision["id"], "editionId": actual_edition["id"],
              "reviewId": actual_review["id"], "colleagueArchiveExport": received_export,
              "forwarded": forwarded, "forwardedPath": str(forwarded_path), "forwardedSha256": sha(forwarded_raw),
              "originalRecipientSourceIds": list(received["first"]["sourceIdMap"].values()),
              "sourceCount": len(state["sources"]), "status": "passed"}
    atomic(root / "result.json", raw_json(result))
    emit({"stage": "ORIGINAL_CORRECTED_APPLICATION_RECEIVED_AND_REOPENED", **result})
    return result


def rendered_receiving_continuation(case, author, received, colleague, onward):
    """Open the actual corrected outgoing application and its same accepted recipient."""
    source = read_json(case.root / "active-source.json")
    author_source = colleague["selection"]["original"]["sourceId"]
    author_revision = next(row["revisionId"] for row in colleague["browser"]["applied"]["sources"]
                           if row["sourceId"] == author_source)
    results = [render_final_host(case, author, "author", author_source, author_revision)]
    application = Path(onward["applicationDirectory"])
    need(application.is_dir(), "Retain the complete corrected application installed by the same onward receiving.")
    recipient = Host(case, "recipient-one", application)
    need(recipient.connection["workspaceId"] == onward["workspaceId"],
         "Reopen the same original recipient with the exact accepted corrected application.")
    results.append(render_final_host(case, recipient, "recipient-one", onward["sourceId"], onward["revisionId"]))
    result = {"format": "commons.audit-exchange.rendered-delivery.v1", "operation": OPERATION,
              "sourceSha256": source["sha256"], "status": "captured-awaiting-producer-view",
              "capturedAt": now(), "roles": results,
              "colleagueReturn": {"path": str(case.root / "colleague-return" / "result.json"),
                                  "captureDirectory": colleague["browser"]["captureDirectory"],
                                  "openPath": str(Path(colleague["browser"]["captureDirectory"]) / "OPEN.html")},
              "correctedReceiving": {"path": str(case.root / "colleague-return" / "onward" / "result.json"),
                                      "workspaceId": onward["workspaceId"], "sourceId": onward["sourceId"],
                                      "revisionId": onward["revisionId"], "editionId": onward["editionId"]},
              "instructions": "Open both OPEN.html indexes and their actual screens and outgoing attachments. "
              "Operate the original producer and corrected received application at desktop and narrow widths. "
              "Inspect populated, empty, loading and actual error states, downloads and reopen. "
              "Repair any broken, unstyled, cramped, clipped, overflowing or unreadable output before readiness. "
              "Capture, source review, HTTP/DOM checks or another worker's approval do not replace producer viewing."}
    target = case.root / "rendered" / source["sha256"] / ("delivery-" + sha(raw_json(result))[:20] + ".json")
    atomic(target, raw_json(result))
    atomic(case.root / "rendered" / "latest.json", raw_json({"path": str(target), **result}), replace=True)
    emit({"stage": "ORIGINAL_FINAL_RENDERING_CAPTURED", "path": str(target), **result})
    return result


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
        initial_lda_handover(case, host)
        projection = case.step("05-complete-native-turnover-handoff", lambda: projection_handoff(case, host, browser))
        analysis = case.step("06-actual-native-models", lambda: native_analysis(case, host, browser, args.resume_analysis))
        joined = case.step("07-original-consumer-source-link", lambda: consumer_join(case, host, projection, args.consumer_receipt))
        case.step("08-original-frozen-edition-review", lambda: frozen_review(case, host, browser))
        received = case.step("09-complete-receiving-and-reopen", lambda: receiving_chain(case, host, browser))
        colleague = colleague_return_continuation(case, host, browser, received)
        onward = receive_corrected_application(case, host, received, colleague)
        rendered_receiving_continuation(case, host, received, colleague, onward)
        original_result = read_json(case.root / "result.json") if (case.root / "result.json").is_file() else None
        result = {"format": FORMAT, "operation": OPERATION, "status": "passed",
                  "completedAt": original_result["completedAt"] if original_result else now(),
                  "workspaceId": host.connection["workspaceId"], "sourceSha256": read_json(case.root / "active-source.json")["sha256"],
                  "nativeAnalysis": analysis, "consumer": joined, "receiving": received,
                  "stages": [read_json(path) for path in sorted((case.root / "stages").glob("*.json"))]}
        if original_result is not None:
            need(original_result["operation"] == OPERATION and original_result["workspaceId"] == result["workspaceId"] and
                 original_result["stages"] == result["stages"],
                 "Keep the original completed business history while appending the rendered continuation.")
            result = original_result
        else:
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
