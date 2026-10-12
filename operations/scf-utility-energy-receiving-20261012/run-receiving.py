#!/usr/bin/env python3
"""MIT. One retained Utility source, browser, MCP, CLI and managed receiving."""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import sys
import threading
import traceback
import uuid
from urllib.parse import urlsplit
import zipfile

HERE = Path(__file__).resolve().parent
SDK = Path("stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy")
SCHEMA = "stellar-forge.utility-complete-receiving.v1"

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def need(value, message):
    if not value:
        raise ValueError(message)

def read_json(path):
    return json.loads(Path(path).read_bytes())

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False,
                      separators=(",", ":")).encode()

def regular(path):
    path = Path(path)
    mode = path.lstat().st_mode
    need(stat.S_ISREG(mode) and not stat.S_ISLNK(mode), "Receive a regular original file: " + str(path))
    return path

def identity(path):
    path = regular(path)
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as inp:
        for block in iter(lambda: inp.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return {"bytes": size, "sha256": digest.hexdigest()}

def save(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    with temporary.open("xb") as out:
        os.chmod(temporary, 0o600)
        out.write(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2).encode() + b"\n")
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def copy_original(source, target):
    source, target = regular(source), Path(target)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    expected = identity(source)
    if target.exists():
        need(expected == identity(target), "The retained original copy changed: " + str(target))
        return expected
    temporary = target.with_name("." + target.name + "." + uuid.uuid4().hex + ".copy")
    try:
        with source.open("rb") as inp, temporary.open("xb") as out:
            os.chmod(temporary, 0o600)
            shutil.copyfileobj(inp, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        need(identity(temporary) == expected, "The original source changed while copying: " + str(source))
        if target.exists():
            need(identity(target) == expected, "The retained original copy changed: " + str(target))
        else:
            os.replace(temporary, target)
            descriptor = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return expected
    finally:
        if temporary.exists():
            temporary.unlink()

def absolute(value, label):
    need(isinstance(value, str) and Path(value).is_absolute(), "Choose an absolute " + label + ".")
    return Path(value).resolve()

def module_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def source_identity(state):
    return {
        "imports": sorted((row["id"], row["source_sha256"], row["bytes"]) for row in state["imports"]),
        "reviews": sorted(row["id"] for row in state["reviews"]),
        "builds": sorted(row["id"] for row in state["builds"]),
        "comparisons": sorted(row["id"] for row in state["comparisons"]),
        "reconciliations": sorted(row["id"] for row in state["reconciliations"]),
        "active_review": state["active_review"],
        "active_build": state["active_build"],
    }

def original_result(report):
    need(report.get("schema") == "stellar-forge.utility-original-operation.v1" and
         report.get("status") == "COMPLETE", "Use the original completed Utility operation report.")
    rows = {row["name"]: row["result"] for row in report["steps"]}
    for key in ("complete-original-intake", "all-native-query-pages", "cold-customer-receiving",
                "complete-overlapping-source-edition", "complete-customer-delivery"):
        need(key in rows, "The complete original operation is missing " + key + ".")
    intake, pages, cold = rows["complete-original-intake"], rows["all-native-query-pages"], rows["cold-customer-receiving"]
    need(pages["rows"] == 1340 and len(pages["pages"]) == 14 and cold["imports"] == 20,
         "Use the complete original 20-input, 1,340-row operation.")
    return {
        "inputs": {
            "full": {key: intake["full"][key] for key in ("id", "source_sha256", "bytes", "counts")},
            "day": {key: intake["day"][key] for key in ("id", "source_sha256", "bytes", "counts")},
            "published_examples": intake["published_examples"],
        },
        "rows": pages["rows"],
        "snapshots": sorted({page["snapshot"] for page in pages["pages"]}),
        "native_snapshot": cold["snapshot"],
        "receiving": {key: cold[key] for key in ("imports", "reviews", "builds", "comparisons", "reconciliations")},
        "equivalent_intervals": rows["complete-overlapping-source-edition"]["equivalent_intervals"],
    }

def main():
    need(len(sys.argv) == 2, "Run run-receiving.py with one private JSON configuration file.")
    config = read_json(sys.argv[1])
    source = absolute(config.get("sourceRoot"), "complete sourceRoot")
    output = absolute(config.get("outputDirectory"), "receiving outputDirectory")
    artifacts = absolute(config.get("artifactDirectory"), "retained artifactDirectory")
    node = absolute(config.get("nodeExecutable"), "existing Node executable")
    python = absolute(config.get("pythonExecutable", sys.executable), "existing Python executable")
    need(python == Path(sys.executable).resolve(), "Invoke this receiver with its selected original Python executable.")
    declaration_path = absolute(config.get("sourceManifest", str(HERE / "source-manifest.json")), "source declaration")
    declaration = read_json(declaration_path)
    need(declaration.get("schema") == "stellar-forge.utility-receiving-source.v1",
         "Use the complete Utility receiving declaration.")
    original_report = absolute(config.get("originalReport"), "original completed operation report")
    original_expected = declaration["originalOperation"]
    need(identity(original_report) == {"bytes": original_expected["bytes"], "sha256": original_expected["sha256"]},
         "The selected original operation report changed.")
    original = read_json(original_report)
    original_projection = original_result(original)
    need(config.get("coreDirectory") or config.get("portable") or config.get("reconstructOriginal") is True,
         "Select the original closed core directory, its complete portable file, or explicit original-source reconstruction.")
    need(sum(bool(config.get(key)) for key in ("coreDirectory", "portable", "reconstructOriginal")) == 1,
         "Select one original receiving mode.")
    chromium = absolute(config.get("chromium"), "existing Chromium executable")
    playwright = absolute(config.get("playwright"), "existing Playwright module")
    sdk = source / SDK
    for record in declaration["files"]:
        rel = PurePosixPath(record["path"])
        need(not rel.is_absolute() and ".." not in rel.parts and "\\" not in record["path"],
             "The original source declaration contains a noncanonical path.")
        data = (source / rel).read_bytes()
        blob = hashlib.sha1(("blob " + str(len(data)) + "\0").encode() + data).hexdigest()
        need(len(data) == record["bytes"] and hashlib.sha256(data).hexdigest() == record["sha256"] and
             blob == record["gitBlob"], "The selected full source differs: " + record["path"])
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not output.is_symlink(), "Keep the original receiving output in its owned real directory.")
    lock = os.open(output / "receiving.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    journal_path = output / "receiving.json"
    selection = {
        "sourceRoot": str(source), "sourceDeclaration": identity(declaration_path),
        "originalReport": identity(original_report), "coreDirectory": config.get("coreDirectory"),
        "portable": config.get("portable"), "portableSha256": config.get("portableSha256"),
        "reconstructOriginal": config.get("reconstructOriginal") is True,
        "merchantTerms": identity(absolute(config["merchantTerms"], "original merchant terms")) if config.get("merchantTerms") else None,
        "nodeExecutable": str(node),
        "pythonExecutable": str(python), "chromium": str(chromium), "playwright": str(playwright),
    }
    journal = read_json(journal_path) if journal_path.exists() else {
        "schema": SCHEMA, "id": uuid.uuid4().hex, "startedAt": now(), "selection": selection, "steps": [],
    }
    need(journal.get("schema") == SCHEMA and journal.get("selection") == selection,
         "Resume the same receiving journal with its original source, inputs and runtime.")
    logs = output / "logs"
    logs.mkdir(mode=0o700, exist_ok=True)
    (output / "tmp").mkdir(mode=0o700, exist_ok=True)
    environment = {**os.environ, "SF30_UTILITY_PYTHON": str(python), "SF30_XML_PYTHON": str(python),
                   "SF30_XML_NODE": str(node), "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(output / "tmp"),
                   "TMP": str(output / "tmp"), "TEMP": str(output / "tmp")}
    os.environ.update({key: environment[key] for key in ("SF30_XML_NODE", "SF30_XML_PYTHON",
                      "SF30_UTILITY_PYTHON", "PYTHONDONTWRITEBYTECODE", "TMPDIR", "TMP", "TEMP")})
    children = set()
    selected = None
    stage = "SOURCE"
    def ended(signum, _frame):
        raise KeyboardInterrupt("The original receiving process was interrupted by signal " + str(signum))
    signal.signal(signal.SIGTERM, ended)
    def checkpoint(name, result=None):
        journal["phase"], journal["updatedAt"] = name, now()
        if result is not None:
            old = next((row for row in journal["steps"] if row["name"] == name), None)
            if old is None:
                journal["steps"].append({"name": name, "at": now(), "result": result})
            else:
                need(old["result"] == result, "The retained completed phase changed: " + name)
        save(journal_path, journal)
        print(json.dumps({"phase": name, "operation": journal["id"], "at": now()}, separators=(",", ":")), flush=True)

    def completed(name):
        return next((row["result"] for row in journal["steps"] if row["name"] == name), None)

    def command(command, args, label, json_reply=False):
        destination = logs / (label + "-" + uuid.uuid4().hex)
        with destination.with_suffix(".stdout").open("xb") as stdout, destination.with_suffix(".stderr").open("xb") as stderr:
            os.chmod(stdout.name, 0o600)
            os.chmod(stderr.name, 0o600)
            child = subprocess.Popen([str(command), *map(str, args)], cwd=sdk, env=environment,
                                     stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            children.add(child)
            try:
                code = child.wait()
            finally:
                children.discard(child)
        if code != 0:
            journal["failedChild"] = {"phase": stage, "exitCode": code, "stdout": stdout.name, "stderr": stderr.name}
            save(journal_path, journal)
            raise RuntimeError("The original " + label + " stopped with exit " + str(code) +
                               "; inspect its retained stdout/stderr and same operation before continuing.")
        return read_json(stdout.name) if json_reply else {"exitCode": code, "stdout": stdout.name, "stderr": stderr.name}

    def cli(workspace, arguments, label):
        return command(node, [sdk / "cli.mjs", "--workspace", workspace, *arguments], label, True)

    def package():
        """Includes declared customer/source outputs, excluding live connection/config/log files."""
        members = {}
        def add(name, path):
            path = Path(path)
            if not path.exists():
                return
            regular(path)
            rel = PurePosixPath(name)
            need(not rel.is_absolute() and ".." not in rel.parts and "\\" not in name,
                 "The receiving artifact name is not canonical.")
            meta = identity(path)
            if name in members:
                need(members[name]["identity"] == meta, "Two receiving files share one name.")
            members[name] = {"path": path, "identity": meta}

        add("receiving.json", journal_path)
        add("source-manifest.json", declaration_path)
        add("original-operation.json", original_report)
        if journal.get("core"):
            core = Path(journal["core"]["directory"])
            add("core/operation.json", core / "operation.json")
            for name in ("utility-customer-delivery.zip", "utility-workspace.zip",
                         "utility-customer-reopened-delivery.zip"):
                add("core/" + name, core / name)
        browser_dir = output / "browser"
        add("browser/operation.json", browser_dir / "operation.json")
        for folder in ("screens", "downloads"):
            if (browser_dir / folder).exists():
                for path in sorted((browser_dir / folder).iterdir()):
                    if path.is_file() and not path.is_symlink():
                        add("browser/" + folder + "/" + path.name, path)
        for name in ("final-utility-workspace.zip", "final-customer-delivery.zip", "cold-cli.json",
                     "customer-before-managed.json", "customer-after-managed.json"):
            add(name, output / name)
        for relative in ("mcp", "managed/mcp"):
            directory = output / relative
            report_path = directory / "journey.json"
            add(relative + "/journey.json", report_path)
            if report_path.exists():
                report = read_json(report_path)
                for record in report.get("downloads", []):
                    if record.get("state") == "COMPLETE":
                        path = Path(record["directory"]) / record["originalFile"]["name"]
                        path.relative_to(directory)
                        add(relative + "/files/" + record["exportId"] + "/" + record["originalFile"]["name"], path)
                for path in directory.glob("*.json"):
                    if path.name not in {"connection.json", "journey.json"}:
                        add(relative + "/" + path.name, path)
        add("managed/receiving.json", output / "managed" / "receiving.json")
        for name in ("first-open", "reopen"):
            for member in ("original-state.json", "mcp-receiving.json"):
                add("managed/" + name + "/" + member, output / "managed" / name / member)
        manifest = {"schema": "stellar-forge.utility-receiving-artifacts.v1", "operation": journal["id"],
                    "status": journal.get("status", "RUNNING"), "createdAt": now(),
                    "sourceDeclaration": identity(declaration_path),
                    "files": {name: item["identity"] for name, item in sorted(members.items())}}
        artifacts.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = artifacts / (".utility-" + journal["id"] + "-" + uuid.uuid4().hex + ".zip")
        with temporary.open("xb") as file:
            os.chmod(temporary, 0o600)
            with zipfile.ZipFile(file, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b"\n")
                for name, item in sorted(members.items()):
                    need(identity(item["path"]) == item["identity"], "Original receiving file changed while packaging.")
                    archive.write(item["path"], name)
            file.flush()
            os.fsync(file.fileno())
        with zipfile.ZipFile(temporary) as archive:
            need(set(archive.namelist()) == {"manifest.json", *members}, "The receiving artifact member set changed.")
            for name, item in members.items():
                digest = hashlib.sha256()
                length = 0
                with archive.open(name) as inp:
                    for block in iter(lambda: inp.read(1024 * 1024), b""):
                        length += len(block)
                        digest.update(block)
                need({"bytes": length, "sha256": digest.hexdigest()} == item["identity"],
                     "The complete receiving artifact differs: " + name)
        meta = identity(temporary)
        target = artifacts / ("Utility_Customer_Receiving_" + journal["id"] + "_" + meta["sha256"][:16] + ".zip")
        os.rename(temporary, target)
        receipt = {"path": str(target), **meta, "files": len(members), "status": manifest["status"]}
        save(artifacts / ("Utility_Receiving_" + journal["id"] + ".json"), receipt)
        return receipt

    def transfer_artifacts(bundle):
        """Streams to existing provider-prepared HTTPS PUT targets before this invocation ends."""
        targets = config.get("uploads", [])
        need(isinstance(targets, list) and len(targets) <= 4, "Use up to four existing prepared upload targets.")
        if not targets:
            return []
        frozen_report = output / "upload-report.json"
        if not frozen_report.exists():
            copy_original(journal_path, frozen_report)
        frozen_identity = {"path": str(frozen_report), **identity(frozen_report)}
        completion = journal.get("completion")
        need(completion, "Retain the completed original product bundle before transferring files.")
        if completion.get("report"):
            need(completion["report"] == frozen_identity, "The frozen original upload report changed.")
        else:
            completion["report"] = frozen_identity
            save(journal_path, journal)
        sources = {
            "bundle": Path(bundle["path"]), "report": frozen_report,
            "portable": output / "final-utility-workspace.zip",
            "customer": output / "final-customer-delivery.zip",
        }
        receipt_path = output / "transfers.json"
        receipts = read_json(receipt_path) if receipt_path.exists() else {}
        result = []
        for item in targets:
            kind = item.get("kind")
            need(kind in sources and sources[kind].is_file(), "The requested complete artifact is not available: " + str(kind))
            ident = item.get("id")
            need(isinstance(ident, str) and ident and len(ident) <= 200,
                 "Keep the original prepared upload's exact provider ID.")
            target = urlsplit(item.get("url", ""))
            need(target.scheme == "https" and target.hostname and not target.username and not target.password and
                 not target.fragment, "Use the existing provider-prepared HTTPS upload URL.")
            selected = {"id": ident, "kind": kind, "urlSha256": hashlib.sha256(item["url"].encode()).hexdigest(),
                        "file": str(sources[kind]), **identity(sources[kind])}
            prior = receipts.get(ident)
            if prior:
                need(prior["selection"] == selected, "A prepared upload already belongs to different original bytes.")
                if prior["status"] == "UPLOADED":
                    result.append(prior)
                    continue
                raise RuntimeError("Reconcile the original uncertain provider upload " + ident + " before another transfer.")
            record = {"selection": selected, "status": "DISPATCHED", "startedAt": now()}
            receipts[ident] = record
            save(receipt_path, receipts)
            connection = http.client.HTTPSConnection(target.hostname, target.port or 443, timeout=180)
            try:
                connection.putrequest("PUT", (target.path or "/") + ("?" + target.query if target.query else ""))
                headers = item.get("headers", {})
                need(isinstance(headers, dict), "Use the original prepared upload headers.")
                for key, value in headers.items():
                    need(isinstance(key, str) and isinstance(value, str) and
                         not any(c in key + value for c in "\r\n"), "Prepared upload headers changed.")
                    if key.lower() not in {"content-length", "host", "transfer-encoding"}:
                        connection.putheader(key, value)
                connection.putheader("Content-Length", str(selected["bytes"]))
                if not any(key.lower() == "content-type" for key in headers):
                    connection.putheader("Content-Type", "application/json" if kind == "report" else "application/zip")
                connection.endheaders()
                with sources[kind].open("rb") as inp:
                    for block in iter(lambda: inp.read(1024 * 1024), b""):
                        connection.send(block)
                response = connection.getresponse()
                response.read(65536)
                record.update(httpStatus=response.status,
                              etag=response.getheader("etag"),
                              providerRequestId=response.getheader("x-ms-request-id") or response.getheader("x-amz-request-id"))
                need(200 <= response.status < 300, "The original prepared upload returned HTTP " + str(response.status))
                record.update(status="UPLOADED", completedAt=now())
            except BaseException as error:
                record.update(status="OUTCOME_REQUIRES_PROVIDER_READBACK", errorType=type(error).__name__, endedAt=now())
                save(receipt_path, receipts)
                raise RuntimeError("Read back the existing provider upload " + ident + " to reconcile its transfer outcome.") from error
            finally:
                connection.close()
            save(receipt_path, receipts)
            result.append(record)
        return result

    try:
        if journal.get("completion"):
            stage = "ARTIFACT_DELIVERY"
            result = journal["completion"]["artifact"]
            need(result.get("status") == "COMPLETE" and
                 identity(result["path"]) == {key: result[key] for key in ("bytes", "sha256")},
                 "The retained completed product artifact changed; recover its exact original bytes.")
            transfers = transfer_artifacts(result)
            journal.update(status="COMPLETE", passed=True, productPassed=True, transfersCompletedAt=now())
            journal.pop("error", None)
            journal.pop("failedChild", None)
            save(journal_path, journal)
            print(json.dumps({"status": "COMPLETE", "passed": True, "operation": str(journal_path),
                              "artifact": result, "transfers": transfers, "reusedProduct": True},
                             separators=(",", ":")), flush=True)
            return
        checkpoint("SOURCE_VERIFIED", {"commit": declaration["sourceCommit"], "files": len(declaration["files"]),
                                      "originalOperation": identity(original_report)})
        copy_original(original_report, output / "original-operation.json")
        # Resolve the actual configured merchant entry and original publisher
        # before opening any native customer writer.
        if completed("ORIGINAL_COMPONENTS_IMPORTED") is None:
            preflight = """
import {pathToFileURL} from 'node:url';import {join} from 'node:path';
const root=process.argv[1];
for(const relative of [
 'stellar-forge/mcp-merchant-operator/config.mjs',
 'stellar-forge/mcp-merchant-operator/operator.mjs',
 'stellar-forge/mcp-merchant-operator/serve.mjs',
 'stellar-forge/mcp-merchant-operator/utility-energy-workspace.mjs',
 'stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/utility-client.mjs',
 'stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/publisher.mjs'])
 await import(pathToFileURL(join(root,relative)).href);
console.log(JSON.stringify({status:'ORIGINAL_COMPONENTS_IMPORTED',modules:6}));
"""
            result = command(node, ["--input-type=module", "-e", preflight, source], "original-component-import", True)
            checkpoint("ORIGINAL_COMPONENTS_IMPORTED", result)
        stage = "CORE_RECEIVING"
        core = absolute(config["coreDirectory"], "closed coreDirectory") if config.get("coreDirectory") else output / "core"
        if not journal.get("core"):
            journal["core"] = {"directory": str(core), "mode": "EXISTING" if config.get("coreDirectory") else
                               "PORTABLE_RESTORED" if config.get("portable") else "ORIGINAL_SOURCE_RECONSTRUCTION"}
            checkpoint("ORIGINAL_CORE_SELECTED")
        need(journal["core"]["directory"] == str(core), "The selected original core directory changed.")
        if completed("ORIGINAL_CORE_RECEIVED") is None:
            if config.get("coreDirectory"):
                need((core / "seller").is_dir(), "The selected original seller workspace is absent.")
                need(original_result(read_json(core / "operation.json")) == original_projection,
                     "The selected original core has different retained sources or native outcomes.")
            elif config.get("portable"):
                packet = absolute(config["portable"], "complete original portable")
                need(isinstance(config.get("portableSha256"), str) and
                     identity(packet)["sha256"] == config["portableSha256"], "The complete original portable changed.")
                core.mkdir(mode=0o700, exist_ok=True)
                if not (core / "seller").exists():
                    cli(core / "seller", ["init"], "original-portable-init")
                state = cli(core / "seller", ["status"], "original-portable-state")
                expected_ids = {original_projection["inputs"]["full"]["id"], original_projection["inputs"]["day"]["id"],
                                *(row["id"] for row in original_projection["inputs"]["published_examples"])}
                if not state["imports"]:
                    cli(core / "seller", ["restore", "--file", packet, "--sha256", config["portableSha256"]],
                        "original-portable-restore")
                    state = cli(core / "seller", ["status"], "original-portable-receiving")
                need({row["id"] for row in state["imports"]} == expected_ids and len(state["reviews"]) >= 2,
                     "Continue the original partially restored packet through its saved native operation.")
                copy_original(original_report, core / "operation.json")
                copy_original(packet, core / "utility-workspace.zip")
            else:
                if not core.exists():
                    checkpoint("ORIGINAL_RECONSTRUCTION_DISPATCHED")
                    original_arguments = [sdk / "operate-example.py", "--out", core]
                    if config.get("merchantTerms"):
                        original_arguments.extend(["--merchant-terms", absolute(config["merchantTerms"], "original merchant terms")])
                    command(python, original_arguments, "original-source-reconstruction")
                need((core / "operation.json").exists(), "The original reconstruction has no completed report; retain its log.")
                reconstructed = read_json(core / "operation.json")
                need(original_result(reconstructed) == original_projection,
                     "The reconstructed original source or native outcome differs; inspect the retained full reports.")
            checkpoint("ORIGINAL_CORE_RECEIVED", {"directory": str(core), "mode": journal["core"]["mode"],
                                                  "projection": original_projection})
        stage = "BROWSER_AND_CLIENT"
        browser_output = output / "browser"
        if completed("BROWSER_AND_CLIENT_COMPLETE") is None:
            browser_report_path = browser_output / "operation.json"
            if not browser_output.exists():
                checkpoint("ORIGINAL_BROWSER_DISPATCHED")
                command(node, [sdk / "operate-browser-client.mjs", "--operation-dir", core, "--out", browser_output,
                               "--chromium", chromium, "--playwright", playwright], "original-browser-client")
            need(browser_report_path.exists(), "The original browser has no report; retain its original startup logs.")
            browser_report = read_json(browser_report_path)
            need(browser_report.get("status") == "COMPLETE",
                 "Continue the retained browser phase in its same customer workspace; its saved reviews remain original.")
            checkpoint("BROWSER_AND_CLIENT_COMPLETE", {"report": identity(browser_report_path),
                                                       "steps": [row["name"] for row in browser_report["steps"]]})
        selected = browser_output / "customer"
        before = cli(selected, ["status"], "customer-before-mcp")
        need(len(before["imports"]) == 20 and len(before["reviews"]) >= 3 and before["active_build"],
             "The complete original browser customer did not reopen.")
        sys.path.insert(0, str(sdk))
        from utility_workspace import Workspace
        from utility_server import OperatorServer
        managed = module_file("utility_receiving_binding", sdk / "managed.py")
        native_cli = module_file("utility_receiving_cli", sdk / "cli.py")
        stage = "MCP_RECEIVING"
        mcp_output = output / "mcp"
        if completed("MCP_COMPLETE") is None:
            connection = output / ("console-" + uuid.uuid4().hex + ".url")
            with Workspace(selected) as owner:
                binding = managed.require_binding(owner.root)
                server = OperatorServer(owner, 0, binding=binding, connection_file=str(connection))
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=False)
                try:
                    with native_cli.connection_file(str(connection), server.url):
                        thread.start()
                        current = owner.state()
                        exported = next((item for item in reversed(current["exports"])
                                         if item["review_id"] == current["active_review"]), None)
                        need(exported, "Use the completed original browser customer export.")
                        mcp_config = {"sourceRoot": str(source), "workspaceDirectory": str(selected),
                                      "consoleUrlFile": str(connection), "outputDirectory": str(mcp_output),
                                      "sourceManifest": str(declaration_path), "reviewId": current["active_review"],
                                      "exportId": exported["id"], "finalExport": False}
                        save(output / "mcp-input.json", mcp_config)
                        command(node, [HERE / "receive-mcp.mjs", output / "mcp-input.json"], "original-configured-mcp")
                finally:
                    server.launch_available = False
                    if thread.is_alive():
                        server.shutdown()
                        thread.join()
                    server.server_close()
            mcp_report = read_json(mcp_output / "journey.json")
            need(mcp_report.get("passed") is True and mcp_report.get("toolCount") == 22,
                 "Complete all 22 original Utility tools and retained files in the same MCP receiving.")
            checkpoint("MCP_COMPLETE", {"report": identity(mcp_output / "journey.json"),
                                         "tools": mcp_report["toolNames"], "nativeExportId": mcp_report["nativeExportId"]})
        mcp_report = read_json(mcp_output / "journey.json")
        stage = "CLI_COLD_RECEIVING"
        if completed("CLI_COLD_RECEIVING_COMPLETE") is None:
            portable = output / "final-utility-workspace.zip"
            if not portable.exists():
                cli(selected, ["portable", "--out", portable], "final-original-cli-portable")
            portable_identity = identity(portable)
            delivery = next(row for row in mcp_report["downloads"] if row["selection"]["kind"] == "delivery")
            copy_original(Path(delivery["directory"]) / delivery["originalFile"]["name"],
                          output / "final-customer-delivery.zip")
            cold = output / "cold-cli"
            if not cold.exists():
                cli(cold, ["init"], "cold-original-cli-init")
            receiving = cli(cold, ["status"], "cold-original-cli-status")
            if not receiving["imports"]:
                cli(cold, ["restore", "--file", portable, "--sha256", portable_identity["sha256"]],
                    "cold-original-cli-restore")
                receiving = cli(cold, ["status"], "cold-original-cli-receiving")
            current = cli(selected, ["status"], "current-original-cli-status")
            need(source_identity(receiving) == source_identity(current),
                 "The original cold CLI receiver changed source, reviewed selection or native edition.")
            query = cli(cold, ["query", "--build", receiving["active_build"], "--params",
                              '{"limit":"100","sort":"start_utc"}'], "cold-original-cli-query")
            body = query["response"]["body"]
            need(body["page"]["total"] == 1340 and body["dataset"]["snapshot"] == original_projection["native_snapshot"],
                 "The cold CLI query did not retain the complete original native snapshot.")
            summary = {"source": source_identity(receiving), "snapshot": body["dataset"]["snapshot"],
                       "page": body["page"], "portable": portable_identity}
            save(output / "cold-cli.json", summary)
            checkpoint("CLI_COLD_RECEIVING_COMPLETE", summary)
        before_managed = cli(selected, ["status"], "customer-before-managed")
        save(output / "customer-before-managed.json", before_managed)
        stage = "MANAGED_APPLICATIONS"
        need(config.get("runtimeDirectory"),
             "The source, browser, client, MCP and CLI outputs are retained. Supply this same operation's completed original runtimeDirectory for managed receiving.")
        selected_runtime = {key: config.get(key) for key in
                            ("runtimeDirectory", "expectedSourceCommit", "environmentFile", "homeId", "applicationWorkspace")}
        if journal.get("runtimeSelection"):
            need(journal["runtimeSelection"] == selected_runtime,
                 "Continue managed receiving with its same completed runtime and host settings.")
        else:
            journal["runtimeSelection"] = selected_runtime
            checkpoint("ORIGINAL_RUNTIME_SELECTED")
        if completed("MANAGED_APPLICATIONS_COMPLETE") is None:
            managed_config = {
                "runtimeDirectory": str(absolute(config["runtimeDirectory"], "completed original runtimeDirectory")),
                "workspaceDirectory": str(selected), "pythonExecutable": str(python),
                "receivingDirectory": str(output / "managed"), "bootstrapSourceRoot": str(source),
                "sourceManifest": str(declaration_path),
                "reviewId": before_managed["active_review"], "exportId": mcp_report["nativeExportId"],
                "finalExport": False,
                "expected": {
                    "importIds": [row["id"] for row in before_managed["imports"]],
                    "reviewIds": [row["id"] for row in before_managed["reviews"]],
                    "buildId": before_managed["active_build"], "snapshot": original_projection["native_snapshot"],
                },
            }
            for key in ("expectedSourceCommit", "environmentFile", "homeId", "applicationWorkspace"):
                if key in config:
                    managed_config[key] = config[key]
            save(output / "managed-input.json", managed_config)
            command(node, [HERE / "receive-managed.mjs", output / "managed-input.json"],
                    "original-managed-application")
            managed_report = read_json(output / "managed" / "receiving.json")
            need(managed_report.get("passed") is True and len(managed_report.get("passes", [])) == 2 and
                 all(row.get("closed", {}).get("listenerClosed") for row in managed_report["passes"]),
                 "Complete the original managed application start, stop and reopened customer.")
            checkpoint("MANAGED_APPLICATIONS_COMPLETE", {
                "applicationId": managed_report["applicationId"], "source": managed_report["selection"],
                "passes": [{"name": row["name"], "opened": row["opened"], "closed": row["closed"]}
                           for row in managed_report["passes"]],
            })
        after_managed = cli(selected, ["status"], "customer-after-managed")
        save(output / "customer-after-managed.json", after_managed)
        need(source_identity(before_managed) == source_identity(after_managed),
             "Managed receiving changed the original reviewed customer.")
        journal.update(status="COMPLETE", passed=True, productPassed=True, completedAt=now())
        journal.pop("error", None)
        journal.pop("failedChild", None)
        checkpoint("COMPLETE")
        stage = "ARTIFACT_DELIVERY"
        result = package()
        journal["completion"] = {"artifact": result, "completedAt": journal["completedAt"]}
        save(journal_path, journal)
        transfers = transfer_artifacts(result)
        journal["transfersCompletedAt"] = now()
        save(journal_path, journal)
        print(json.dumps({"status": "COMPLETE", "passed": True, "operation": str(journal_path),
                          "artifact": result, "transfers": transfers}, separators=(",", ":")), flush=True)
    except BaseException as error:
        journal.update(status="DELIVERY_REQUIRES_CONTINUATION" if journal.get("completion") else
                       "RETAINED_CONTINUATION_REQUIRED", passed=False, failedAt=now(),
                       error={"phase": stage, "message": str(error), "type": type(error).__name__,
                              "traceback": traceback.format_exc()})
        save(journal_path, journal)
        for child in list(children):
            child.terminate()
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        try:
            result = journal["completion"]["artifact"] if journal.get("completion") else package()
            print(json.dumps({"status": journal["status"], "phase": stage, "artifact": result,
                              "productPassed": journal.get("productPassed", False)}, separators=(",", ":")),
                  flush=True)
        except BaseException as save_error:
            print(json.dumps({"status": journal["status"], "phase": stage, "outputDirectory": str(output),
                              "artifactError": str(save_error)}, separators=(",", ":")), flush=True)
        raise
    finally:
        os.close(lock)

if __name__ == "__main__":
    main()
