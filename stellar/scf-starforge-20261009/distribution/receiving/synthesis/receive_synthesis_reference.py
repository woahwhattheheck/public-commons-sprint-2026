"""Receive the complete original BCG Research and Analysis application.

This single operation uses the maintained Python runtime resolver/installer,
original Research publication APIs, the real browser operator, the native
Analysis database/jobs and complete archive receiving. It creates one synthesis
job, then reopens and receives that same job through the shipped SDK and CLI.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit
import zipfile

OPERATION = "D7CA-SCF-EVIDENCE-SYNTHESIS-NATIVE-20261012"
PREFIX = Path("stellar/scf-starforge-20261009")
_HASH = re.compile(r"[a-f0-9]{64}")
_CHILDREN = set()
_STOP = threading.Event()
_ACTIVE_WORKSPACE = None
_ACTIVE_JOB = None


def need(condition, code):
    if not condition:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def identity(operation, label):
    return sha((operation + "\0" + label).encode())[:32]


def emit(event, **details):
    print(json.dumps({"operation": OPERATION, "event": event, **details}, ensure_ascii=False, default=str), flush=True)


def folder(path):
    path = Path(path).absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == os.getuid(),
         "SYNTHESIS_ORIGINAL_OWNED_DIRECTORY_REQUIRED")
    return path.resolve()


def write(path, value, *, raw=False, retained=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    body = value if raw else encoded(value)
    if retained and path.exists():
        need(path.read_bytes() == body, "SYNTHESIS_RETAINED_FILE_CHANGED:" + str(path))
    else:
        part = path.with_name(path.name + ".partial-" + str(os.getpid()))
        with part.open("xb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(part, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    body = path.read_bytes()
    return {"path": str(path), "name": path.name, "bytes": len(body), "sha256": sha(body)}


def record(path):
    path = Path(path)
    body = path.read_bytes()
    return {"path": str(path), "name": path.name, "bytes": len(body), "sha256": sha(body)}


def stopped():
    if _STOP.is_set():
        raise InterruptedError("Original synthesis receiving was interrupted")


def stop(number, _frame):
    _STOP.set()
    for child in tuple(_CHILDREN):
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    if _ACTIVE_WORKSPACE is not None and _ACTIVE_JOB is not None:
        try:
            _ACTIVE_WORKSPACE.synthesis.cancel(_ACTIVE_JOB)
        except Exception:
            pass


def command(argv, directory, label, *, environment=None, expect_json=True):
    stopped()
    directory = folder(directory)
    out_path, err_path = directory / (label + ".stdout"), directory / (label + ".stderr")
    with out_path.open("wb") as output, err_path.open("wb") as errors:
        child = subprocess.Popen([str(x) for x in argv], stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=errors, env=environment,
                                 start_new_session=True)
        _CHILDREN.add(child)
        emit("original_child_started", stage=label, pid=child.pid)
        try:
            interrupt_sent = False
            while child.poll() is None:
                if _STOP.wait(0.2) and not interrupt_sent:
                    interrupt_sent = True
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            status = child.returncode
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait()
            _CHILDREN.discard(child)
    result = {"exit_code": status, "stdout": record(out_path), "stderr": record(err_path)}
    write(directory / (label + ".command.json"), {"argv": list(map(str, argv)), **result})
    if status:
        emit("original_child_failed", stage=label, **result,
             stderr_tail=err_path.read_text(errors="replace")[-16000:],
             stdout_tail=out_path.read_text(errors="replace")[-8000:])
        raise RuntimeError("ORIGINAL_COMMAND_FAILED:" + label + ":" + str(status))
    stopped()
    if not expect_json:
        return result
    lines = out_path.read_text().splitlines()
    need(bool(lines), "ORIGINAL_JSON_RESULT_MISSING:" + label)
    value = json.loads(lines[-1])
    need(isinstance(value, dict) and not value.get("error"), "ORIGINAL_JSON_RESULT_INVALID:" + label)
    emit("original_child_completed", stage=label, exit_code=status)
    return value


def environment(work):
    env = dict(os.environ)
    env.update(TMPDIR=str(folder(work / "tmp")), TMP=str(work / "tmp"), TEMP=str(work / "tmp"),
               PIP_DISABLE_PIP_VERSION_CHECK="1", MPLCONFIGDIR=str(folder(work / "matplotlib")),
               PYTHONDONTWRITEBYTECODE="1", OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1",
               MKL_NUM_THREADS="1", NUMEXPR_NUM_THREADS="1")
    return env


def native_browser_selection(node, work, env):
    selector = work / "select-original-browser.mjs"
    write(selector, b"""import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';import {join} from 'node:path';
const require=createRequire(import.meta.url),root=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const module=require.resolve(root?join(root,'playwright'):'playwright');
const p=require(module),candidates=[process.env.CHROME_BIN,process.env.CHROMIUM_EXECUTABLE_PATH,
 '/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
 '/workspace/scratch/7573d13065d5/aurora_ops/browser-runtime/tmp/chromium',p.chromium.executablePath()].filter(Boolean);
const executable=candidates.find(x=>existsSync(x));if(!executable)throw Error('ORIGINAL_CHROMIUM_REQUIRED');
process.stdout.write(JSON.stringify({playwrightModule:module,chromiumExecutable:executable})+'\\n');
""", raw=True)
    selected = command([node, selector], work / "logs", "select-browser", environment=env)
    env["LD_LIBRARY_PATH"] = str(Path(selected["chromiumExecutable"]).parent) + (
        ":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    version = command([selected["chromiumExecutable"], "--version"], work / "logs",
                      "original-chromium-version", environment=env, expect_json=False)
    return {**selected, "version": version}


def prepare(config):
    source = folder(config["source_root"])
    work = folder(config["work_directory"])
    env = environment(work)
    python = str(Path(config.get("python", sys.executable)).absolute())
    node = config.get("node") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    need(node and Path(node).is_file(), "ORIGINAL_NODE_REQUIRED")
    browser = native_browser_selection(node, work, env)
    runtime = folder(work / "python-runtime")
    engine = source / PREFIX / "distribution/python-runtime/engine.py"
    project = source / PREFIX / "sf88-operator-buyer-cli/python"
    need(engine.is_file() and project.is_dir(), "ORIGINAL_PYTHON_RUNTIME_SOURCE_REQUIRED")
    selected = command([python, engine, "--root", runtime, "resolve",
                        "--python", python, "--source", project, "--extras", "synthesis",
                        "--release-id", config["operation_id"],
                        "--release-digest", config["source_sha256"]],
                       work / "logs", "resolve-original-synthesis-runtime", environment=env)
    installation = command([python, engine, "--root", runtime, "install",
                            "--candidate", selected["id"], "--python", python],
                           work / "logs", "install-original-synthesis-runtime", environment=env)
    need(installation["extras"] == ["synthesis"] and installation["capabilities"]["synthesis"],
         "ORIGINAL_SYNTHESIS_RUNTIME_SELECTION_CHANGED")
    packages = {x["name"]: x["version"] for x in installation["packages"]}
    need(packages["statsmodels"] == "0.15.0" and packages["matplotlib"] == "3.10.8",
         "ORIGINAL_PINNED_ENGINE_REQUIRED")
    need(installation["modules"]["synthesis"] == "stellar_forge_buyer.synthesis_cli" and
         "stellar-forge-synthesis" in installation["entrypoints"],
         "ORIGINAL_SYNTHESIS_ENTRYPOINT_REQUIRED")
    install_file = work / "runtime-installation.json"
    write(install_file, installation, retained=True)
    write(work / "runtime-candidate.json", selected, retained=True)
    env["LD_LIBRARY_PATH"] = str(Path(browser["chromiumExecutable"]).parent) + (
        ":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    updated = {**config, "node": str(node), "python": installation["python"],
               "installation_file": str(install_file), "browser": browser}
    config_path = work / "application-input.json"
    write(config_path, updated, retained=True)
    emit("original_runtime_ready", installation=installation["id"], candidate=selected["id"],
         python=installation["python"], versions=packages, browser=browser)
    return command([installation["python"], "-I", Path(__file__).resolve(), "--phase", "application",
                    "--config", config_path], work / "logs", "original-synthesis-application",
                   environment=env)


def wait_job(workspace, job):
    while job["status"] == "RUNNING":
        if _STOP.is_set():
            workspace.synthesis.cancel(job["id"]) if job["kind"] == "synthesis" else workspace.archives.cancel(job["id"])
        threading.Event().wait(0.1)
        job = workspace.job(job["id"])
    need(job["status"] == "COMPLETE", "ORIGINAL_JOB_FAILED:" + json.dumps(job))
    return job


def native_numeric_reference(result, projection):
    import numpy as np
    from statsmodels.stats.meta_analysis import effectsize_2proportions, combine_effects
    rows = projection["rows"]
    values = {key: np.asarray([int(row["reported"][key]) for row in rows], dtype=float)
              for key in ("tpos", "tneg", "cpos", "cneg")}
    effect, variance = effectsize_2proportions(values["tpos"], values["tpos"] + values["tneg"],
                                            values["cpos"], values["cpos"] + values["cneg"],
                                            statistic="rr", zero_correction=None)
    direct = combine_effects(effect, variance, method_re="pm", use_t=True,
                             alpha=0.05, atol=1e-8, maxiter=500)
    primary = result["primary"]
    np.testing.assert_allclose(primary["estimate"], direct.mean_effect_re, rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(primary["tau_squared"], max(0.0, direct.tau2), rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(primary["standard_error"], math.sqrt(direct.var_hksj_re), rtol=1e-12, atol=1e-12)
    need(primary["k"] == 13 and primary["degrees_of_freedom"] == 12 and
         result["review"]["counts"]["estimable_results"] == 13 and len(result["leave_one_out"]) == 13,
         "ORIGINAL_THIRTEEN_STUDY_RESULT_CHANGED")
    sensitivity = next(x for x in result["sensitivity_sets"] if x["definition"]["id"] == "random-allocation")
    need(sensitivity["result"]["k"] == 7, "ORIGINAL_SEVEN_STUDY_SENSITIVITY_CHANGED")
    return {"schema": "commons.synthesis-native-reference-comparison.v1", "studies": 13,
            "random_allocation_studies": 7, "source_cells": 117,
            "native_engine": "statsmodels.stats.meta_analysis 0.15.0",
            "native_log_rr": float(direct.mean_effect_re), "native_tau_squared": float(direct.tau2),
            "native_hksj_standard_error": math.sqrt(float(direct.var_hksj_re)),
            "comparison": "Same original thirteen source rows through the direct installed native engine.",
            "primary": primary}


def verify_database_files(workspace, run, expected):
    actual = workspace.synthesis.result(run)
    need(actual == expected, "ORIGINAL_REOPENED_RUN_CHANGED")
    for item in expected["files"]:
        with workspace.synthesis.download(run, item["name"]) as (stream, metadata):
            body = stream.read()
        need(len(body) == item["bytes"] and sha(body) == item["sha256"] and
             metadata["sha256"] == item["sha256"], "ORIGINAL_REOPENED_BLOB_CHANGED")
    return {"workspace_id": workspace.identity, "run_id": run,
            "files": len(expected["files"]), "bytes": sum(x["bytes"] for x in expected["files"])}



def complete_zip(destination, sources, work):
    """Publish and reopen the exact selected artifact members atomically."""
    selected = []
    for path in sources:
        path = Path(path)
        item = record(path)
        name = "analysis/" + path.name if path.parent.name == "analysis-files" else path.name
        selected.append({"name": name, **{key: item[key] for key in ("path", "bytes", "sha256")}})
    need(len({item["name"] for item in selected}) == len(selected), "ORIGINAL_DELIVERY_MEMBERS_REPEAT")
    write(work / "delivery-members.json", selected, retained=True)

    def matches(path):
        try:
            with zipfile.ZipFile(path) as archive:
                need(archive.namelist() == [item["name"] for item in selected],
                     "ORIGINAL_DELIVERY_MEMBERS_CHANGED")
                for item in selected:
                    info = archive.getinfo(item["name"])
                    need(info.file_size == item["bytes"] and sha(archive.read(item["name"])) == item["sha256"],
                         "ORIGINAL_DELIVERY_MEMBER_CHANGED")
            return True
        except (OSError, zipfile.BadZipFile, KeyError, RuntimeError):
            return False

    if destination.exists() and matches(destination):
        return record(destination)
    pending = destination.with_name("." + destination.name + ".building")
    if pending.exists():
        info = pending.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
             "ORIGINAL_DELIVERY_TEMPORARY_CHANGED")
        pending.unlink()
    with zipfile.ZipFile(pending, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        os.chmod(pending, 0o600)
        for item in selected:
            archive.write(item["path"], item["name"])
    need(matches(pending), "ORIGINAL_COMPLETE_DELIVERY_ZIP_CHANGED")
    with pending.open("rb") as stream:
        os.fsync(stream.fileno())
    os.replace(pending, destination)
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    need(matches(destination), "ORIGINAL_PUBLISHED_DELIVERY_CHANGED")
    return record(destination)


def retained_library_clients(state, requests, paths):
    """Retain original host calls and transfer identities around the existing helper."""
    from library_upload import HostedAppsClient, SignedUrlUploader
    selected = [record(path) for path in paths]
    write(state / "selection.json", {"request": requests, "files": selected}, retained=True)
    calls = folder(state / "calls")

    class OriginalLibraryClient(HostedAppsClient):
        def call_tool(self, connector_id, tool_name, arguments):
            body = {"connector_id": connector_id, "tool_name": tool_name, "arguments": arguments}
            path = calls / (sha(encoded(body)) + ".json")
            if path.exists():
                saved = json.loads(path.read_bytes())
                need(saved["request"] == body, "ORIGINAL_LIBRARY_REQUEST_CHANGED")
                need(saved["state"] == "COMPLETE" and isinstance(saved.get("response"), dict),
                     "ORIGINAL_LIBRARY_CALL_RECONCILE:" + str(path))
                return saved["response"]
            write(path, {"request": body, "state": "DISPATCHING"}, retained=True)
            try:
                response = super().call_tool(connector_id, tool_name, arguments)
            except BaseException as error:
                write(path, {"request": body, "state": "RECONCILE",
                             "error": type(error).__name__, "message": str(error),
                             "provider_result": getattr(error, "result", None)})
                raise
            write(path, {"request": body, "state": "COMPLETE", "response": response})
            return response

    class OriginalUploader(SignedUrlUploader):
        def upload(self, uploads, state_directory):
            done, pending = set(), []
            for upload in uploads:
                item = {"file_id": upload.payload["file_id"],
                        "upload_session_id": upload.payload["upload_session_id"],
                        "source": selected[upload.request.index]}
                path = state / ("transfer-" + sha(encoded(item)) + ".json")
                if path.exists():
                    need(json.loads(path.read_bytes()) == item, "ORIGINAL_LIBRARY_TRANSFER_CHANGED")
                    done.add(upload.request.index)
                else:
                    pending.append(upload)
            transferred = super().upload(tuple(pending), state_directory) if pending else set()
            for upload in pending:
                if upload.request.index in transferred:
                    item = {"file_id": upload.payload["file_id"],
                            "upload_session_id": upload.payload["upload_session_id"],
                            "source": selected[upload.request.index]}
                    write(state / ("transfer-" + sha(encoded(item)) + ".json"), item, retained=True)
            return done | transferred

    return OriginalLibraryClient(), OriginalUploader()


def upload_deliverables(config, paths, work):
    helpers = config.get("library_helpers")
    if not helpers:
        return {"status": "retained_local", "files": [record(x) for x in paths]}
    sys.path.insert(0, helpers)
    from library_upload import LibraryUploadWorkflow, HostedAppsClient, LibraryFileMaterializer, SignedUrlUploader
    state = folder(work / "library-state")
    output = work / "library-result.json"
    if output.exists():
        result = json.loads(output.read_bytes())
        need(result["selection"] == [record(x) for x in paths], "ORIGINAL_LIBRARY_SELECTION_CHANGED")
        result = result["result"]
        need(isinstance(result.get("results"), list) and len(result["results"]) == len(paths) and
             all(item.get("status") == "succeeded" for item in result["results"]),
             "ORIGINAL_LIBRARY_DELIVERY_REQUIRES_RECONCILIATION")
        return result
    requests = {"uploads": [{"local_path": str(path), "purpose": "create_library_file",
                            "library_artifact_type": "image" if Path(path).suffix == ".png" else "other"}
                           for path in paths]}
    write(work / "library-input.json", requests, retained=True)
    retained_client, retained_uploader = retained_library_clients(state, requests, paths)
    result = LibraryUploadWorkflow(apps_client=retained_client,
              materializer=LibraryFileMaterializer(), uploader=retained_uploader,
              state_parent=state).run(requests)
    write(output, {"selection": [record(x) for x in paths], "result": result}, retained=True)
    emit("original_deliverables_uploaded", result=result)
    need(isinstance(result.get("results"), list) and len(result["results"]) == len(paths) and
         all(item.get("status") == "succeeded" for item in result["results"]),
         "ORIGINAL_LIBRARY_DELIVERY_REQUIRES_RECONCILIATION")
    return result


def application(config):
    global _ACTIVE_WORKSPACE, _ACTIVE_JOB
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace, serve
    from stellar_forge_buyer.synthesis_client import WorkspaceSynthesisClient, receive_synthesis_file
    from stellar_forge_buyer.workspace_archive import inspect_archive
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.evidence_synthesis import engine_information

    source, work = Path(config["source_root"]), folder(config["work_directory"])
    operation = config["operation_id"]
    env = environment(work)
    original = source / PREFIX / "sf88-operator-buyer-cli"
    reference = original / "python/examples/synthesis-bcg-reference"
    publication_dir = folder(work / "research-publication")
    publication = command([config["node"], reference / "publish-bcg-reference.mjs",
                           "--source-root", source, "--reference-directory", reference,
                           "--dossier-directory", work / "research-dossier",
                           "--output-directory", publication_dir,
                           "--operation-id", operation + "-BCG",
                           "--python", sys.executable],
                          work / "logs", "original-bcg-publication", environment=env)
    need(publication["state"] == "COMPLETE" and publication["sourceRows"] == 13 and publication["sourceCells"] == 117,
         "ORIGINAL_BCG_PUBLICATION_INCOMPLETE")
    write(work / "bcg-publication.json", publication, retained=True)
    emit("original_bcg_publication_ready", dossier=publication["dossierId"], publication=publication["publicationId"],
         sha256=publication["publicationFile"]["sha256"], studies=13, source_cells=117)
    db = folder(work / "analysis-database")
    browser_out = folder(work / "browser")
    browser_record = browser_out / "synthesis-browser-operation.json"
    port = 0
    if browser_record.exists():
        port = urlsplit(json.loads(browser_record.read_bytes())["binding"]["origin"]).port
    workspace = AnalysisWorkspace(db, checkout=source, node=config["node"])
    _ACTIVE_WORKSPACE = workspace
    server = thread = None
    result = None
    try:
        ready = engine_information(required=True)
        need(ready["packages"]["statsmodels"] == "0.15.0", "ORIGINAL_NATIVE_ENGINE_CHANGED")
        server, launch_file, url = serve(workspace, port=port)
        thread = threading.Thread(target=server.serve_forever, name="original-analysis-owner")
        thread.start()
        browser_config = {"url": url, "publicationFile": publication["publicationFile"]["path"],
                          "publicationSha256": publication["publicationFile"]["sha256"],
                          "protocolFile": str(reference / "reference-protocol.json"),
                          "outputDirectory": str(browser_out),
                          "browserProfileDirectory": str(folder(work / "browser-profile")),
                          "operationId": operation, "playwrightModule": config["browser"]["playwrightModule"],
                          "chromiumExecutable": config["browser"]["chromiumExecutable"], "timeoutMs": 300000}
        private_config = work / "browser-input.json"
        write(private_config, browser_config)
        wrapper = work / "original-browser-operator.mjs"
        helper = source / PREFIX / "distribution/receiving/synthesis/receive_synthesis_operator.mjs"
        wrapper_text = """import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
const {receiveSynthesisOperator}=await import(pathToFileURL(process.argv[3]).href);
const controller=new AbortController(),stop=()=>controller.abort(new Error('Original receiving interrupted'));
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{process.stdout.write(JSON.stringify(await receiveSynthesisOperator({...input,signal:controller.signal}))+'\\n');}
finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
"""
        write(wrapper, wrapper_text.encode(), raw=True, retained=True)
        browser = command([config["node"], wrapper, private_config, helper],
                          work / "logs", "original-browser-operator", environment=env)
        need(browser["state"] == "COMPLETE" and browser["workspaceId"] == workspace.identity,
             "ORIGINAL_BROWSER_RECEIVING_INCOMPLETE")
        _ACTIVE_JOB = browser["jobId"]
        run = workspace.job(_ACTIVE_JOB)
        need(run["kind"] == "synthesis" and run["status"] == "COMPLETE", "ORIGINAL_SYNTHESIS_JOB_INCOMPLETE")
        summary = workspace.synthesis.result(_ACTIVE_JOB)
        client = WorkspaceSynthesisClient(db, workspace_id=workspace.identity)
        entries = list(client.iter_results(browser["publication"]["name"], revision=browser["publication"]["revision"], limit=5))
        need(len(entries) == 13 and len({x["descriptor"]["studyId"] for x in entries}) == 13,
             "ORIGINAL_PAGED_SOURCE_CHANGED")
        # Reconcile the already-completed browser request through the SDK, preserving its ID.
        replay = client.start(protocol_name=browser["protocol"]["name"],
                              protocol_revision=browser["protocol"]["revision"],
                              protocol_sha256=browser["protocol"]["sha256"],
                              operation=work / "sdk-original-run", request_id=_ACTIVE_JOB)
        replay_again = client.resume(work / "sdk-original-run")
        need(replay["id"] == replay_again["id"] == _ACTIVE_JOB and replay_again["status"] == "COMPLETE",
             "ORIGINAL_SDK_REPLAY_CHANGED")
        with workspace.database._connection(readonly=True) as connection:
            count = connection.execute("SELECT COUNT(*) FROM sf_analysis_jobs WHERE kind='synthesis'").fetchone()[0]
        need(count == 1, "ORIGINAL_SYNTHESIS_JOB_DUPLICATED")
        received = client.receive_run(_ACTIVE_JOB, work / "analysis-files")
        source_received = client.receive_publication(browser["publication"]["name"],
            browser["publication"]["revision"], work / "received-original-publication.json")
        need(source_received["sha256"] == publication["publicationFile"]["sha256"],
             "ORIGINAL_SOURCE_RECEIVING_CHANGED")
        with workspace.synthesis.download(_ACTIVE_JOB, "result.json") as (stream, _):
            complete = json.load(stream)
        projection = json.loads((reference / "bcg-source-rows.json").read_bytes())
        numeric = native_numeric_reference(complete, projection)
        write(work / "native-reference-comparison.json", numeric, retained=True)
        # One real HTTP file transfer is interrupted after retained bytes, then uses Range.
        archive_record = next(x for x in summary["files"] if x["name"] == "synthesis.zip")
        path = "/api/synthesis-runs/" + _ACTIVE_JOB + "/files/synthesis.zip"
        cutoff = min(32768, max(1, archive_record["bytes"] // 3))
        interrupted = [False]
        @contextmanager
        def fail_once(offset):
            with client._open_download(path, archive_record, offset) as (stream, metadata):
                class OriginalInterruptedStream:
                    read_count = 0
                    def read(self, size=-1):
                        if self.read_count >= cutoff:
                            interrupted[0] = True
                            raise ConnectionResetError("Selected original receiving interruption")
                        chunk = stream.read(min(size if size >= 0 else cutoff, cutoff - self.read_count))
                        self.read_count += len(chunk)
                        return chunk
                yield OriginalInterruptedStream(), metadata
        partial_target = work / "resumed-synthesis.zip"
        range_stage_path = work / "original-range-stage.json"
        range_identity = {"workspace_id": workspace.identity, "run_id": _ACTIVE_JOB, "file": archive_record}
        partial = partial_target.with_name("." + partial_target.name + ".synthesis-part")
        if range_stage_path.exists():
            range_stage = json.loads(range_stage_path.read_bytes())
            need(range_stage["identity"] == range_identity, "ORIGINAL_RANGE_SELECTION_CHANGED")
        else:
            range_stage = {"identity": range_identity, "state": "DISPATCHING"}
            write(range_stage_path, range_stage, retained=True)
        partial_size = partial.stat().st_size if partial.exists() else 0
        if range_stage["state"] == "DISPATCHING" and not partial_target.exists() and partial_size == 0:
            try:
                receive_synthesis_file(archive_record, partial_target, fail_once,
                    binding={"workspace_id": workspace.identity, "run_id": _ACTIVE_JOB})
            except ConnectionResetError:
                pass
            need(interrupted[0], "ORIGINAL_RECEIVING_INTERRUPTION_NOT_REACHED")
            partial_size = partial.stat().st_size
        if range_stage["state"] == "DISPATCHING":
            need(0 < partial_size < archive_record["bytes"], "ORIGINAL_RETAINED_RANGE_OFFSET_REQUIRED")
            range_stage = {"identity": range_identity, "state": "INTERRUPTED",
                           "retained_partial_bytes": partial_size}
            write(range_stage_path, range_stage)
        @contextmanager
        def original_range(offset):
            need(0 < offset < archive_record["bytes"], "ORIGINAL_POSITIVE_RANGE_OFFSET_REQUIRED")
            with client._open_download(path, archive_record, offset) as (stream, metadata):
                need(metadata["status"] == 206 and metadata["offset"] == offset,
                     "ORIGINAL_NATIVE_RANGE_RESPONSE_REQUIRED")
                write(range_stage_path, {"identity": range_identity, "state": "RESUMING",
                                        "retained_partial_bytes": offset, "response": metadata})
                yield stream, metadata
        range_receipt = receive_synthesis_file(archive_record, partial_target, original_range,
            binding={"workspace_id": workspace.identity, "run_id": _ACTIVE_JOB})
        range_stage = json.loads(range_stage_path.read_bytes())
        actual_range = range_stage.get("response", {})
        need(range_receipt["sha256"] == archive_record["sha256"] and
             actual_range.get("status") == 206 and
             0 < actual_range.get("offset", 0) < archive_record["bytes"] and
             actual_range.get("sha256") == archive_record["sha256"],
             "ORIGINAL_RANGE_RECEIVING_CHANGED")
        range_receipt["native_range"] = actual_range
        range_result_path = work / "original-range-result.json"
        if range_result_path.exists():
            original_range_receipt = json.loads(range_result_path.read_bytes())
            need(all(original_range_receipt.get(key) == range_receipt.get(key) for key in
                     ("path", "name", "bytes", "sha256", "mime_type", "native_range")),
                 "ORIGINAL_RANGE_RESULT_CHANGED")
            range_receipt = original_range_receipt
        else:
            write(range_result_path, range_receipt, retained=True)
        # The installed console reads that same completed result through its live owner.
        installation = json.loads(Path(config["installation_file"]).read_bytes())
        console = installation["entrypoints"]["stellar-forge-synthesis"]["path"]
        cli_result = command([console, "--database", db, "--live", "--workspace-id", workspace.identity,
                              "result", "--id", _ACTIVE_JOB], work / "logs",
                             "original-installed-synthesis-console", environment=env)
        need(cli_result == summary, "ORIGINAL_INSTALLED_CLI_RESULT_CHANGED")
        archive_review = workspace.archives.review()
        need(archive_review["ready"] and archive_review["payload_files"] == 1,
             "ORIGINAL_DATABASE_ONLY_ARCHIVE_REQUIRED")
        archive_job = wait_job(workspace, workspace.start("workspace-export", {
            "id": identity(operation, "workspace-archive"), "include_previous_backups": False}))
        archived = {}
        for name in ("workspace.zip", "archive-manifest.json"):
            with workspace.archives.download(archive_job["id"], name) as (stream, item):
                body = stream.read()
            need(len(body) == item["bytes"] and sha(body) == item["sha256"], "ORIGINAL_ARCHIVE_DOWNLOAD_CHANGED")
            archived[name] = write(work / name, body, raw=True, retained=True)
        inspection = inspect_archive(work / "workspace.zip", expected_sha256=archived["workspace.zip"]["sha256"])
        need([x["path"] for x in inspection["manifest"]["files"]] == ["datasets.sqlite3"],
             "SYNTHESIS_OUTPUTS_MUST_TRAVEL_IN_ORIGINAL_DATABASE")
        received_database = work / "received-analysis"
        restored = restore_archive(work / "workspace.zip", received_database,
            operation=identity(operation, "workspace-receiving"), expected_sha256=archived["workspace.zip"]["sha256"])
        restored_again = restore_archive(work / "workspace.zip", received_database,
            operation=identity(operation, "workspace-receiving"), expected_sha256=archived["workspace.zip"]["sha256"])
        need(restored_again["workspace_id"] == workspace.identity, "ORIGINAL_RESTORED_WORKSPACE_ID_CHANGED")
        result = {"schema": "commons.synthesis-reference-receiving.v1", "operation": operation,
                  "source_sha256": config["source_sha256"], "state": "NATIVE_RECEIVED",
                  "engine": ready, "runtime": {"id": installation["id"], "candidate": installation["candidate"],
                    "packages": installation["packages"], "entrypoint": installation["entrypoints"]["stellar-forge-synthesis"]},
                  "research": publication, "browser": browser, "summary": summary,
                  "numeric_reference": numeric, "sdk_receiving": received, "source_receiving": source_received,
                  "range_receiving": range_receipt, "original_job_count": count,
                  "archive": archived, "archive_review": archive_review,
                  "archive_inspection": inspection, "restored": restored,
                  "restored_replay": restored_again}
        write(work / "native-receiving-progress.json", result)
    finally:
        _ACTIVE_JOB = None
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join()
        workspace.close()
        _ACTIVE_WORKSPACE = None
    stopped()
    original_reopened = AnalysisWorkspace(db, checkout=source, node=config["node"])
    try:
        reopened = verify_database_files(original_reopened, browser["jobId"], summary)
    finally:
        original_reopened.close()
    restored_workspace = AnalysisWorkspace(work / "received-analysis", checkout=source, node=config["node"])
    try:
        restored_check = verify_database_files(restored_workspace, browser["jobId"], summary)
        need(restored_check["workspace_id"] == browser["workspaceId"], "ORIGINAL_RESTORED_IDENTITY_CHANGED")
        publication_check = restored_workspace.synthesis.publication(browser["publication"]["name"],
            revision=browser["publication"]["revision"], limit=50)
        need(publication_check["publication"]["sha256"] == publication["publicationFile"]["sha256"] and
             publication_check["total"] == 13, "ORIGINAL_RESTORED_PUBLICATION_CHANGED")
        protocol_check = restored_workspace.synthesis.protocol(browser["protocol"]["name"], revision=1)
        need(protocol_check["sha256"] == browser["protocol"]["sha256"], "ORIGINAL_RESTORED_PROTOCOL_CHANGED")
    finally:
        restored_workspace.close()
    result.update(state="COMPLETE", original_reopen=reopened, restored_reopen=restored_check)
    receipt = work / "Synthesis_Reference_Receiving.json"
    if receipt.exists():
        saved = json.loads(receipt.read_bytes())
        need(all(saved.get(key) == result.get(key) for key in
                 ("schema", "operation", "source_sha256", "state", "engine", "runtime", "summary",
                  "numeric_reference", "original_job_count", "original_reopen", "restored_reopen")),
             "ORIGINAL_COMPLETED_RECEIVING_CHANGED")
        need(saved["browser"]["workspaceId"] == browser["workspaceId"] and
             saved["browser"]["jobId"] == browser["jobId"] and
             saved["browser"]["protocol"] == browser["protocol"] and
             saved["browser"]["publication"] == browser["publication"] and
             saved["research"]["publicationId"] == publication["publicationId"] and
             saved["research"]["publicationFile"]["sha256"] == publication["publicationFile"]["sha256"] and
             all(saved["archive"][name] == result["archive"][name] for name in archived) and
             saved["source_receiving"]["sha256"] == source_received["sha256"],
             "ORIGINAL_COMPLETED_SOURCE_CHANGED")
        result = saved
    else:
        result["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write(receipt, result, retained=True)
    package = work / "SCF_Evidence_Synthesis_Reference_20261012.zip"
    sources = [receipt, work / "native-reference-comparison.json", work / "workspace.zip",
               work / "archive-manifest.json", work / "received-original-publication.json"]
    sources += [work / "analysis-files" / x["name"] for x in summary["files"]]
    sources += [Path(x["path"]) for x in browser["screenshots"]]
    sources += [Path(publication["editableDossier"]["path"])]
    sources += [reference / "reference-protocol.json", reference / "README.md", reference / "sources.json"]
    complete_zip(package, sources, work)
    selected = [package, work / "analysis-files/report.html", work / "workspace.zip", receipt,
                work / "analysis-files/result.json", *[Path(x["path"]) for x in browser["screenshots"]]]
    library = upload_deliverables(config, selected, work)
    final = {"schema": "commons.synthesis-reference-completion.v1", "state": "COMPLETE",
             "operation": operation, "workspace_id": browser["workspaceId"], "run_id": browser["jobId"],
             "publication_id": publication["publicationId"], "studies": 13, "source_cells": 117,
             "primary": summary["primary"], "engine": ready, "files": [record(x) for x in selected],
             "library": library, "receipt": record(receipt)}
    write(work / "completion.json", final, retained=True)
    emit("original_synthesis_complete", **final)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("prepare", "application"), default="prepare")
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_bytes())
    need(config.get("operation_id") == OPERATION and _HASH.fullmatch(config.get("source_sha256", "")),
         "ORIGINAL_SYNTHESIS_OPERATION_REQUIRED")
    work = folder(config["work_directory"])
    lease_path = work / ("prepare-owner.lock" if args.phase == "prepare" else "application-owner.lock")
    lease = os.open(lease_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(lease)
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "ORIGINAL_NATIVE_LEASE_REQUIRED")
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    prior = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
    for number in prior:
        signal.signal(number, stop)
    try:
        result = prepare(config) if args.phase == "prepare" else application(config)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except BaseException as error:
        failure = {"operation": OPERATION, "phase": args.phase, "state": "FAILED",
                   "error": getattr(error, "code", type(error).__name__), "message": str(error),
                   "traceback": traceback.format_exc(),
                   "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        write(work / ("failure-" + args.phase + ".json"), failure)
        emit("original_synthesis_failed", **failure)
        return 1
    finally:
        for number, handler in prior.items():
            signal.signal(number, handler)
        os.close(lease)


if __name__ == "__main__":
    raise SystemExit(main())
