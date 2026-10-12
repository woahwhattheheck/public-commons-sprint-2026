#!/usr/bin/env python3
"""MIT. Build one selected original runtime and receive Utility, then Leap."""
from __future__ import annotations
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
BASE = "stellar/scf-starforge-20261009"
UTILITY_OP = "UTILITY-DATA-ENERGYTOOLBASE-20261012-1FB3"
LEAP_OP = "LEAP-DEVICE-INTERVAL-DELIVERY-20261012"
REPORT = {"bytes": 56586, "sha256": "08ae13edf0ce8c7f5e23ae3c214cc00be104486ec41982dd60ccd9ba5eb9b966"}

spec = importlib.util.spec_from_file_location("leap_receiving", HERE / "run-receiving.py")
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)
need, identity, verify = support.need, support.identity, support.verify
atomic_json, read_json, private_directory = support.atomic_json, support.read_json, support.private_directory


class Sequence:
    def __init__(self, config):
        self.config = config
        self.output = private_directory(config["outputDirectory"])
        self.journal_path = self.output / "sequence.json"
        self.complete_path = self.output / "completed-sequence.json"
        self.source = Path(config["repository"]).absolute()
        self.ref = config["sourceCommit"]
        need(isinstance(self.ref, str) and len(self.ref) == 40 and all(c in "0123456789abcdef" for c in self.ref),
             "Select the complete immutable original source commit.")
        self.node = str(Path(config["nodeExecutable"]).absolute())
        self.python = str(Path(config["pythonExecutable"]).absolute())
        self.release = Path(config.get("buildDirectory", self.output / "release")).absolute()
        self.runtime = Path(config.get("runtimeDirectory", self.output / "runtime")).absolute()
        self.state = read_json(self.journal_path) if self.journal_path.exists() else {
            "schema": "stellar-forge.utility-leap-sequential-receiving.v1",
            "operations": [UTILITY_OP, LEAP_OP], "sourceCommit": self.ref, "selection": "leap-intervals",
            "createdAt": support.stamp(), "phases": {}, "transfers": {}
        }
        need(self.state["sourceCommit"] == self.ref, "Continue the same selected source and original sequence journal.")
        self.env = {**os.environ, "CODEX_PRIMARY_RUNTIME_PYTHON": self.python, "STARFORGE_PYTHON": self.python,
                    "SF30_XML_NODE": self.node, "PYTHONDONTWRITEBYTECODE": "1", "GIT_TERMINAL_PROMPT": "0"}
        self.save()

    def save(self):
        self.state["updatedAt"] = support.stamp()
        atomic_json(self.journal_path, self.state)

    def command(self, args, label, *, json_result=True, timeout=14400):
        logs = private_directory(self.output / "private-process")
        stdout, stderr = logs / (label + ".stdout"), logs / (label + ".stderr")
        with open(stdout, "wb") as out, open(stderr, "wb") as err:
            os.chmod(stdout, 0o600)
            os.chmod(stderr, 0o600)
            process = subprocess.Popen(args, cwd=self.source, env=self.env, stdout=out, stderr=err)
            self.state["active"] = {"phase": label, "pid": process.pid, "startedAt": support.stamp(),
                                    "stdout": str(stdout), "stderr": str(stderr)}
            self.save()
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                # Retain this actual original child; never open another owner after an uncertain wait.
                self.state["active"]["status"] = "WAIT_EXPIRED"
                self.save()
                raise RuntimeError("The original " + label + " is still unresolved; inspect its retained PID and logs.") from None
        self.state["active"].update(status="EXITED", exitCode=code, completedAt=support.stamp())
        self.save()
        need(code == 0, "The original " + label + " returned " + str(code) + "; inspect " + str(stderr))
        text = stdout.read_text(encoding="utf-8")
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
            raise RuntimeError("The original " + label + " did not return a complete JSON result.")

    def native(self, method, options, label):
        original = self.source / BASE / "distribution/runtime-install.mjs"
        source = (
            "import{pathToFileURL}from'node:url';"
            "const original=await import(pathToFileURL(process.argv[1]).href);"
            "const result=await original[process.argv[2]](JSON.parse(process.argv[3]));"
            "console.log(JSON.stringify(result));"
        )
        return self.command([self.node, "--input-type=module", "-e", source, str(original), method,
                             json.dumps(options, separators=(",", ":"))], label)

    def verify_checkout(self):
        observed = self.command(["git", "--no-replace-objects", "-C", str(self.source), "rev-parse", "HEAD"], "source-head", json_result=False).strip()
        need(observed == self.ref, "Use the exact complete original checkout at the selected source commit.")
        self.command(["git", "--no-replace-objects", "-C", str(self.source), "diff", "--quiet", self.ref, "--"],
                     "tracked-source-read", json_result=False)
        selected = read_json(self.source / BASE / "distribution/selections/leap-intervals.json")
        need(selected["id"] == "leap-intervals" and "utility-energy" in selected["contributions"],
             "Keep the original complete combined product recipe.")
        manifest = read_json(self.source / "operations/scf-leap-interval-receiving-20261012/source-manifest.json")
        members = [{"path": row["path"], **verify(self.source / row["path"], row)} for row in manifest["files"]]
        self.state["source"] = {"commit": self.ref, "selection": identity(self.source / BASE / "distribution/selections/leap-intervals.json"),
                                "verifiedMembers": members, "verifiedAt": support.stamp()}
        self.save()

    def preserve_build(self, artifacts):
        # These are the original prepared single-file upload targets; no account or upload session is created here.
        for item in self.config.get("buildUploadTargets", []):
            kind, target = item["artifact"], item["target"]
            need(kind in {"archive", "receipt"}, "Select the complete original archive or build receipt.")
            original = artifacts[kind]
            verify(original["path"], original)
            target_id = target.get("file_id") or target.get("upload_session_id") or target.get("id")
            need(isinstance(target_id, str) and target_id, "Retain the actual prepared upload target ID.")
            key = kind + ":" + target_id
            old = self.state["transfers"].get(key)
            if old and old.get("status") == "UPLOADED":
                need((old["sha256"], old["bytes"]) == (original["sha256"], original["bytes"]),
                     "This completed target belongs to different original bytes.")
                continue
            need(old is None, "Reconcile the original uncertain prepared upload " + target_id + " before another transfer.")
            url = urlsplit(target.get("upload_url") or target.get("url") or "")
            method = target.get("method") or target.get("upload_method") or "PUT"
            need(url.scheme == "https" and url.hostname and not url.username and not url.password and not url.fragment
                 and method == "PUT", "Use the original signed HTTPS single-file PUT target.")
            record = {"artifact": kind, "targetId": target_id, "sha256": original["sha256"], "bytes": original["bytes"],
                      "status": "UPLOADING", "startedAt": support.stamp()}
            self.state["transfers"][key] = record
            self.save()
            client = http.client.HTTPSConnection(url.hostname, url.port or 443, timeout=180)
            try:
                headers = dict(target.get("required_headers") or target.get("headers") or target.get("upload_headers") or {})
                headers["Content-Length"] = str(original["bytes"])
                client.putrequest(method, url.path + ("?" + url.query if url.query else ""))
                for name, value in headers.items():
                    client.putheader(name, str(value))
                client.endheaders()
                with open(original["path"], "rb") as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        client.send(block)
                response = client.getresponse()
                response.read(65536)
                need(200 <= response.status < 300, "The original archive target returned HTTP " + str(response.status))
                record.update(status="UPLOADED", httpStatus=response.status, etag=response.getheader("ETag"),
                              completedAt=support.stamp())
                self.save()
            except Exception as error:
                record.update(status="UNCONFIRMED", errorType=type(error).__name__, failedAt=support.stamp())
                self.save()
                raise RuntimeError("The complete original " + kind + " transfer is unconfirmed; retain its target and bytes.") from None
            finally:
                client.close()

    def build(self):
        previous = self.state["phases"].get("build")
        if previous:
            for kind in ("archive", "receipt"):
                verify(previous[kind]["path"], previous[kind])
            self.preserve_build(previous)
            return previous
        args = [self.node, "--max-old-space-size=192", str(self.source / BASE / "distribution/build.mjs"),
                "--repo", str(self.source), "--ref", self.ref, "--selection", "leap-intervals",
                "--out", str(self.release), "--python", self.python]
        if self.release.exists():
            args.append("--resume")
        if self.config.get("offlineSource"):
            args.append("--offline")
        receipt = self.command(args, "original-selected-build")
        need(receipt.get("status") == "PACKAGED" and receipt.get("sourceCommit") == self.ref
             and receipt.get("sourceSelection", {}).get("id") == "leap-intervals",
             "The original builder returned a different selected source.")
        candidates = [path for path in self.release.rglob("*.tgz") if path.is_file() and not path.is_symlink()]
        archive = next((path for path in candidates if identity(path)["sha256"] == receipt.get("sha256")), None)
        need(archive is not None, "The complete original returned archive is not retained.")
        path = self.output / "Starforge_Leap_Utility_Build.json"
        atomic_json(path, receipt)
        result = {"status": "COMPLETE", "archive": {"path": str(archive), **identity(archive)},
                  "receipt": {"path": str(path), **identity(path)}, "original": receipt}
        self.state["phases"]["build"] = result
        self.save()
        # Preserve the complete built source before dependency installation or either customer owner opens.
        self.preserve_build(result)
        return result

    def install(self, built):
        if not self.runtime.exists():
            prepared = self.native("prepareRuntimeInstall", {
                "directory": str(self.runtime), "archive": built["archive"]["path"], "sha256": built["archive"]["sha256"],
                "native": True, "features": ["schema", "openapi", "mcp"], "operator": True, "python": self.python
            }, "original-runtime-prepare")
            self.state["phases"]["runtimePrepare"] = {"status": "COMPLETE", "result": prepared}
            self.save()
        else:
            # The maintained installer/inspection owns any existing preparation and its recovery.
            self.native("inspectRuntimeInstall", {"directory": str(self.runtime)}, "original-runtime-before-resume")
        options = {"directory": str(self.runtime), **self.config.get("installOptions", {})}
        need(options["directory"] == str(self.runtime)
             and set(options) <= {"directory", "offline", "cache", "npm", "nodeHeaders", "adoptExisting"},
             "Use only the original retained installer options and selected directory.")
        result = self.native("installRuntime", options, "original-runtime-install")
        need(result.get("status") == "READY", "The original selected runtime is not READY.")
        observed = self.native("inspectRuntimeInstall", {
            "directory": str(self.runtime), "load": True, "source": True, "python": self.python
        }, "original-runtime-inspect")
        need(observed.get("ready") is True and observed.get("sourceVerified") is True
             and observed.get("sourceCommit") == self.ref, "The original runtime/source inspection is incomplete.")
        source = Path(observed["sourceRoot"]).absolute()
        need(source.resolve() == (self.runtime / "package/source").resolve(),
             "Use the original installer-owned source directory.")
        manifest = read_json(source / "operations/scf-leap-interval-receiving-20261012/source-manifest.json")
        for row in manifest["files"]:
            verify(source / row["path"], row)
        self.state["phases"]["runtime"] = {"status": "COMPLETE", "result": observed}
        self.save()
        return source

    def child_configuration(self, source, kind):
        common = {"sourceRoot": str(source), "runtimeDirectory": str(self.runtime),
                  "nodeExecutable": self.node, "pythonExecutable": self.python,
                  "chromium": str(Path(self.config["chromium"]).absolute()),
                  "playwright": str(Path(self.config["playwright"]).absolute())}
        selected = dict(self.config[kind])
        selected.update(common)
        if kind == "utility":
            verify(selected["originalReport"], REPORT)
            selected["sourceManifest"] = str(source / "operations/scf-utility-energy-receiving-20261012/source-manifest-891b.json")
        else:
            selected["operationId"] = LEAP_OP
            selected["sourceManifest"] = str(source / "operations/scf-leap-interval-receiving-20261012/source-manifest.json")
        selected.setdefault("outputDirectory", str(self.output / (kind + "-receiving")))
        selected.setdefault("artifactDirectory", str(self.output / (kind + "-delivery")))
        path = self.output / "private-process" / (kind + "-receiving.json")
        atomic_json(path, selected)
        return path, selected

    def receive(self, source, kind):
        # Each original receiver implements its own completed-delivery fast path. This call preserves it on resume.
        path, selected = self.child_configuration(source, kind)
        previous = self.state["phases"].get(kind)
        intent = hashlib.sha256(support.json_bytes({key: value for key, value in selected.items() if key not in {"uploadTargets", "uploads"}})).hexdigest()
        need(not previous or previous.get("intentSha256") == intent, "Keep the same original " + kind + " receiving configuration.")
        self.state["phases"][kind] = {**(previous or {}), "status": "RUNNING", "intentSha256": intent, "configuration": str(path)}
        self.save()
        entry = source / ("operations/scf-utility-energy-receiving-20261012/run-receiving.py" if kind == "utility"
                          else "operations/scf-leap-interval-receiving-20261012/run-receiving.py")
        result = self.command([self.python, str(entry), str(path)], "original-" + kind + "-receiving", timeout=28800)
        complete = (result.get("status") == "COMPLETE" and result.get("passed") is True) if kind == "utility" else (
            result.get("status") == "PASS" and result.get("productPassed") is True)
        need(complete, "The original " + kind + " customer did not finish its complete receiving.")
        self.state["phases"][kind].update(status="COMPLETE", result=result, completedAt=support.stamp())
        self.save()
        return result

    def run(self):
        if self.complete_path.exists():
            completed = read_json(self.complete_path)
            need(completed["sourceCommit"] == self.ref, "Keep the original completed sequence source.")
            verify(completed["utility"]["artifact"]["path"], completed["utility"]["artifact"])
            for kind in ("report", "workspace", "delivery"):
                verify(completed["leap"][kind]["path"], completed["leap"][kind])
            # The original per-product completion files remain the transfer/reopen authority.
            return completed
        previous = self.state.get("active")
        need(not previous or previous.get("status") in {"EXITED"},
             "Reconcile the recorded original child PID before continuing this sequence.")
        self.verify_checkout()
        built = self.build()
        source = self.install(built)
        utility = self.receive(source, "utility")
        leap = self.receive(source, "leap")
        completed = {"schema": self.state["schema"], "status": "PASS", "sourceCommit": self.ref, "selection": "leap-intervals",
                     "operations": [UTILITY_OP, LEAP_OP], "runtime": self.state["phases"]["runtime"]["result"],
                     "build": built, "utility": utility, "leap": leap, "completedAt": support.stamp()}
        atomic_json(self.complete_path, completed)
        self.state["status"] = "COMPLETE"
        self.save()
        return completed


def main():
    need(len(sys.argv) == 2, "Use run-sequence.py /private/utility-leap-sequence.json")
    sequence = Sequence(read_json(sys.argv[1]))
    try:
        result = sequence.run()
        print(json.dumps({"status": "PASS", "sourceCommit": result["sourceCommit"], "selection": "leap-intervals",
                          "operations": result["operations"], "result": str(sequence.complete_path),
                          "utility": result["utility"], "leap": result["leap"]}), flush=True)
        return 0
    except BaseException as error:
        sequence.state["error"] = {"type": type(error).__name__, "message": str(error), "at": support.stamp()}
        sequence.save()
        print(json.dumps({"status": "INCOMPLETE", "journal": str(sequence.journal_path), "error": sequence.state["error"]}),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
