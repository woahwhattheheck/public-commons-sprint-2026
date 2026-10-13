#!/usr/bin/env python3
"""Run the original currency receiving in one owned execution namespace."""
from __future__ import annotations
import argparse, ast, base64, fcntl, hashlib, json, os, shutil, signal, stat, subprocess, sys, tempfile, termios, time, traceback, zipfile
from datetime import datetime, timezone
from pathlib import Path

def require(ok, message):
    if not ok:
        raise RuntimeError(message)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()

def emit(value):
    print(json.dumps(value, ensure_ascii=False, sort_keys=True), flush=True)

def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and path.read_bytes() == raw, "Retained bytes differ: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw); out.flush(); os.fsync(out.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            require(path.read_bytes() == raw, "Concurrent retained bytes differ: " + str(path))
    finally:
        Path(name).unlink(missing_ok=True)

def write_json(path, value):
    atomic(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode())

def relative(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute() and ".." not in Path(name).parts,
            "Use a relative retained source path.")
    path = (root / name).resolve()
    require(path.is_relative_to(root), "Retained path escapes the operation.")
    return path

def source_bytes(item):
    raw = item["content"].encode("utf-8")
    require(len(raw) == item["bytes"] and digest(raw) == item["sha256"], "Intake byte identity differs: " + item["path"])
    if item.get("gitBlob"):
        require(git_blob(raw) == item["gitBlob"], "Intake Git identity differs: " + item["path"])
    return raw

def choose_file(explicit, candidates, label, executable=False):
    for name in ([explicit] if explicit else []) + candidates:
        if not name:
            continue
        path = Path(name).expanduser()
        if path.is_file() and (not executable or os.access(path, os.X_OK)):
            return str(path.absolute())
    raise RuntimeError("Existing " + label + " is unavailable; supply its actual installed path.")

BROWSER_DRIVER = r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [playwrightFile, executablePath, callbackFile, readyFile, outputDirectory, pythonExecutable] = process.argv.slice(2);
const pw = await import(pathToFileURL(playwrightFile).href);
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error('The original installed Playwright module has no chromium export.');
const {receiveNativeCurrency} = await import(pathToFileURL(callbackFile).href);
const browser = await chromium.launch({
  headless: true, executablePath,
  args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=1'],
});
try {
  const result = await receiveNativeCurrency({readyFile, outputDirectory, browser, pythonExecutable});
  console.log(JSON.stringify({state:result.state, caseId:result.caseId, nativeReadySha256:result.nativeReadySha256}));
} finally {
  await browser.close();
}
"""


def restore_prepared_archive(base, resume, operation):
    """Restore the exact closed operation; never create a replacement case."""
    require(isinstance(resume, dict), "A prepared continuation needs its original archive binding.")
    archive = Path(resume["archivePath"]).resolve()
    require(archive.is_file() and not archive.is_relative_to(base), "Keep the original archive outside its restored operation.")
    raw = archive.read_bytes()
    require(len(raw) == resume["archiveBytes"] and digest(raw) == resume["archiveSha256"],
            "The closed original operation archive differs.")
    with zipfile.ZipFile(archive) as saved:
        members = saved.infolist()
        require(len(members) <= 20000 and sum(x.file_size for x in members) <= 256 * 1024 * 1024,
                "The selected original operation archive is outside the receiving bound.")
        names = set()
        for member in members:
            require(member.filename not in names and "\\" not in member.filename,
                    "Duplicate or ambiguous original archive member.")
            names.add(member.filename)
            mode = member.external_attr >> 16
            require(not stat.S_ISLNK(mode) and (member.is_dir() or stat.S_IFMT(mode) in (0, stat.S_IFREG)),
                    "Restore only regular original operation files.")
            target = relative(base, member.filename)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                atomic(target, saved.read(member))
    ready_path = base / "receiving" / "NATIVE_READY.json"
    ready_raw = ready_path.read_bytes()
    require(digest(ready_raw) == resume["readySha256"], "The prepared original case binding differs.")
    ready = json.loads(ready_raw)
    require(ready.get("state") == "READY_FOR_BROWSER" and ready.get("operationId") == operation,
            "Continue only this original prepared case.")
    return {"archivePath": str(archive), "archiveBytes": len(raw), "archiveSha256": digest(raw),
            "readySha256": digest(ready_raw), "caseId": ready["caseId"], "planId": ready["planId"],
            "version": ready["version"], "priorExecution": resume.get("priorExecution")}

def replace_receiving_source(base, target, item, raw, correction):
    """Retain a source-checked receiving fix beside its complete before-image."""
    before = target.read_bytes()
    require(len(before) == correction["beforeBytes"] and digest(before) == correction["beforeSha256"]
            and git_blob(before) == correction["beforeGitBlob"], "The receiving correction preimage differs.")
    require(isinstance(correction.get("reason"), str) and correction["reason"].strip(),
            "Retain the concrete receiving finding.")
    retained = relative(base / "receiving" / "source-corrections" / digest(before), item["path"])
    atomic(retained, before)
    receipt = {"path": item["path"], "reason": correction["reason"],
               "before": {"path": str(retained), "bytes": len(before), "sha256": digest(before), "gitBlob": git_blob(before)},
               "after": {"bytes": len(raw), "sha256": digest(raw), "gitBlob": git_blob(raw)}}
    write_json(retained.with_name(retained.name + ".correction.json"), receipt)
    fd, name = tempfile.mkstemp(prefix="." + target.name + ".correction.", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw); out.flush(); os.fsync(out.fileno())
        require(target.read_bytes() == before, "Receiving source changed during its correction.")
        os.replace(name, target)
        directory = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(name).unlink(missing_ok=True)
    return receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--archive-directory", required=True)
    parser.add_argument("--intake")
    parser.add_argument("--case-file")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    parser.add_argument("--chromium")
    parser.add_argument("--library-helper")
    parser.add_argument("--hold-result", action="store_true")
    args = parser.parse_args()
    base = Path(args.base).resolve()
    sink = Path(args.archive_directory).resolve()
    require(base != sink and not sink.is_relative_to(base), "Keep the durable archive outside temporary execution state.")
    base.mkdir(parents=True, exist_ok=True)
    requested_sink = sink
    try:
        sink.mkdir(parents=True, exist_ok=True)
        lock_file = (sink / "native-currency-operation.lock").open("a+b")
    except OSError as exc:
        emit({"state":"SHARED_SINK_UNAVAILABLE","error":str(exc),"path":str(sink)})
        sink = base / "publication-fallback"
        sink.mkdir(exist_ok=True)
        lock_file = (base / "native-currency-operation.lock").open("a+b")
    with lock_file as guard:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.intake:
            intake_raw = Path(args.intake).read_bytes()
        else:
            if sys.stdin.isatty():
                terminal = termios.tcgetattr(sys.stdin.fileno())
                terminal[3] &= ~(termios.ECHO | termios.ICANON)
                terminal[6][termios.VMIN] = 1
                terminal[6][termios.VTIME] = 0
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, terminal)
            emit({"state":"INPUT_READY","pid":os.getpid(),"base":str(base)})
            intake_raw = sys.stdin.buffer.readline(16 * 1024 * 1024 + 1)
        require(0 < len(intake_raw) <= 16 * 1024 * 1024, "Use one complete bounded receiving intake.")
        intake = json.loads(intake_raw)
        require(intake.get("schema") == "stellar-forge.sf47-currency-held-intake.v1", "Unknown receiving intake schema.")
        operation = intake["operationId"]
        private = intake["privatePacket"]
        require(operation == private["operationId"], "Original operation differs.")
        raw_files = [(item, source_bytes(item)) for item in intake["sourceFiles"] + intake["companions"]]
        raw_private = []
        for item in private["files"]:
            raw = item["content_utf8"].encode()
            require(len(raw) == item["bytes"] and digest(raw) == item["sha256"], "Private original source differs: " + item["path"])
            if item.get("gitBlob"):
                require(git_blob(raw) == item["gitBlob"], "Private Git source differs: " + item["path"])
            raw_private.append((item, raw))
        require(len({x["path"] for x, _ in raw_files}) == len(raw_files), "Duplicate product source intake.")
        resume = intake.get("resumePrepared")
        resumed = restore_prepared_archive(base, resume, operation) if resume is not None else None
        source_corrections = resume.get("sourceCorrections", []) if resume is not None else []
        require(isinstance(source_corrections, list), "Use a list of exact receiving source corrections.")
        correction_by_path = {x["path"]: x for x in source_corrections}
        require(len(correction_by_path) == len(source_corrections), "Duplicate receiving source correction.")
        companion_paths = {x["path"] for x in intake["companions"]}
        require(set(correction_by_path) <= companion_paths, "A receiving continuation cannot replace product source.")
        correction_receipts = []
        cfg = json.loads(next(raw for item, raw in raw_private if item["path"] == "CONFIG.json"))
        original_base = Path(private["baseDirectory"])
        require(Path(cfg["repositoryRoot"]) == original_base / "source", "Original repository root differs.")
        require(cfg["operationId"] == operation, "Configuration operation differs.")
        # Relocation occurs only before first preparation. The retained configuration
        # still preserves original source, file and business identities.
        if base != original_base:
            cfg["repositoryRoot"] = str(base / "source")
            cfg["sourceRoot"] = str(base / "source" / Path(cfg["sourceRoot"]).relative_to(original_base / "source"))
            for value in cfg["inputs"].values():
                prior = Path(value["path"])
                if prior.is_relative_to(original_base):
                    value["path"] = str(base / prior.relative_to(original_base))
            cfg["executionRelocation"] = {"originalBaseDirectory":str(original_base),"executionBaseDirectory":str(base)}
        if args.case_file:
            cfg["inputs"]["case"]["path"] = str(Path(args.case_file).resolve())
        case_file = base / "ORIGINAL_CASE.zip"
        if not case_file.is_file():
            case_file = Path(cfg["inputs"]["case"]["path"])
        case_raw = case_file.read_bytes()
        require(len(case_raw) == cfg["inputs"]["case"]["bytes"] and digest(case_raw) == cfg["inputs"]["case"]["sha256"],
                "The original complete case archive differs.")
        for item, raw in raw_files:
            target = relative(base / "source", item["path"])
            correction = correction_by_path.get(item["path"])
            if correction is not None:
                require(target.is_file() and target.read_bytes() != raw, "The selected receiving correction is not applicable.")
                correction_receipts.append(replace_receiving_source(base, target, item, raw, correction))
            else:
                atomic(target, raw)
        if resumed is not None:
            resumed["sourceCorrections"] = correction_receipts
            write_json(base / "receiving" / "continuations" / (resumed["archiveSha256"] + ".json"), resumed)
        for item, raw in raw_private:
            if item["path"] != "CONFIG.json":
                atomic(relative(base, item["path"]), raw)
        write_json(base / "CONFIG.json", cfg)
        atomic(base / "ORIGINAL_PRIVATE_PACKET.json", (json.dumps(private,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n").encode())
        atomic(base / "ORIGINAL_CASE.zip", case_raw)
        # The original caller prefers its own retained input before an external
        # source path. Stage the already verified bytes so reentry also works if
        # a previous host's original archive location is no longer mounted.
        case_name = cfg["inputs"]["case"]["filename"]
        require(isinstance(case_name, str) and Path(case_name).name == case_name
                and case_name not in ("", ".", "..") and "\\" not in case_name,
                "Use one plain original case filename.")
        atomic(base / "receiving" / "inputs" / case_name, case_raw)
        pins = {p["path"]:p for p in cfg["sourcePins"]}
        selected = {item["path"]:raw for item,raw in raw_files if item["path"] in pins}
        require(set(selected) == set(pins), "The complete selected operating source is required.")
        for name, raw in selected.items():
            require(git_blob(raw) == pins[name]["gitBlob"] and len(raw) == pins[name]["bytes"], "Selected source differs: " + name)
        source = Path(cfg["sourceRoot"])
        caller = source / "examples" / "native_currency_receiving.py"
        callback = source / "examples" / "native_currency_browser_receiving.mjs"
        ast.parse(caller.read_text(), str(caller))
        atomic(base / "run-browser.mjs", BROWSER_DRIVER.encode())
        temp = base / "tmp"
        temp.mkdir(exist_ok=True)
        env = {**os.environ, "TMPDIR":str(temp), "PYTHONDONTWRITEBYTECODE":"1"}
        runtime_modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", "")
        node = choose_file(args.node, [os.environ.get("CODEX_PRIMARY_RUNTIME_NODE"),
            "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node", shutil.which("node")], "Node", True)
        python = choose_file(args.python, [sys.executable], "Python", True)
        playwright = choose_file(args.playwright, [
            str(Path(runtime_modules) / "playwright" / "index.mjs") if runtime_modules else None,
            str(Path(runtime_modules) / "playwright" / "index.js") if runtime_modules else None,
            str(Path(runtime_modules) / "playwright-core" / "index.mjs") if runtime_modules else None,
            "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
            "/opt/codex/runtimes/codex-primary-runtime/dependencies/node_modules/playwright/index.mjs",
            "/opt/codex/runtimes/codex-primary-runtime/dependencies/node_modules/playwright/index.js",
            "/opt/codex/runtimes/codex-primary-runtime/dependencies/node_modules/playwright-core/index.mjs",
        ], "Playwright module")
        chromium = choose_file(args.chromium, [
            "/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell",
        ], "Chromium", True)
        env["PATH"] = str(Path(node).parent) + os.pathsep + env.get("PATH", "")
        for key in ("SF47_SUPPORT_NODE","SF47_BUYER_NODE"):
            env[key] = node
        subprocess.run([node,"--check",str(callback)],check=True,env=env,cwd=base)
        attempt = str(time.time_ns())
        write_json(base / ("RUNTIME-" + attempt + ".json"), {"operationId":operation,"pid":os.getpid(),"python":python,
            "node":node,"playwright":playwright,"chromium":chromium,"sourceCommit":cfg["sourceCommit"],
            "sourceFiles":len(pins),"sourceBytes":sum(x["bytes"] for x in pins.values())})
        # A persistent receiving host does not require this ChatGPT-specific
        # publication helper. An explicitly selected missing helper is an error;
        # otherwise use an actually installed bundle when it is available.
        library_helper = None
        if args.library_helper:
            library_helper = choose_file(args.library_helper, [], "selected bundled Library upload helper")
        else:
            default_helper = Path("/root/.codex/plugins/cache/openai-curated-remote/openai-library/0.1.62/skills/library/scripts/library_upload.py")
            if default_helper.is_file():
                library_helper = str(default_helper.absolute())
        if library_helper is None:
            emit({"state":"LIBRARY_HELPER_UNAVAILABLE","archiveDirectory":str(requested_sink)})
        reservation = sink / (operation + ".publication.part")
        try:
            if not reservation.exists():
                with reservation.open("x+b") as handle:
                    try:
                        os.posix_fallocate(handle.fileno(), 0, 16 * 1024 * 1024)
                    except OSError:
                        handle.truncate(0)
                    handle.flush(); os.fsync(handle.fileno())
        except OSError as exc:
            emit({"state":"SHARED_CHECKPOINT_UNAVAILABLE","error":str(exc)})
        child = None
        outcome = {"operationId":operation,"attempt":attempt,"state":"RUNNING","sourceCommit":cfg["sourceCommit"]}
        receiving = base / "receiving"
        receiving.mkdir(exist_ok=True)
        archives = []
        def publish(label):
            archive = base / ("archive-" + label + "-" + attempt + ".zip")
            paths = [p for p in sorted(base.rglob("*")) if p.is_file()
                and not p.is_relative_to(temp) and not p.name.startswith("archive-")
                and not p.is_relative_to(base/"publication-fallback")
                and not (p.is_relative_to(receiving/"browser") and p.suffix.lower()==".png")
                and not p.name.endswith(".part")]
            with zipfile.ZipFile(archive,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as zipped:
                for path in paths:
                    zipped.write(path,path.relative_to(base).as_posix())
            raw_hash = hashlib.sha256()
            size = archive.stat().st_size
            with archive.open("rb") as inp:
                for chunk in iter(lambda:inp.read(1024*1024),b""):
                    raw_hash.update(chunk)
            receipt = {"localPath":str(archive),"bytes":size,"sha256":raw_hash.hexdigest(),"stage":label,
                       "sharedPath":None}
            target = requested_sink / ("SF47_Native_Currency_" + label + "_" + attempt + ".zip")
            try:
                requested_sink.mkdir(parents=True,exist_ok=True)
                # Stage on the destination filesystem, including when the sink
                # was unavailable at startup and the reservation is local.
                staging = reservation if reservation.parent == requested_sink else target.with_name("." + target.name + ".part")
                with staging.open("r+b" if staging.exists() else "w+b") as out, archive.open("rb") as inp:
                    out.seek(0)
                    for chunk in iter(lambda:inp.read(1024*1024),b""):
                        out.write(chunk)
                    out.truncate(size); out.flush(); os.fsync(out.fileno())
                if not target.exists():
                    os.link(staging,target)
                require(target.stat().st_size==size and digest(target.read_bytes())==receipt["sha256"],
                        "Retained shared archive differs.")
                staging.unlink()
                receipt["sharedPath"]=str(target)
                write_json(requested_sink/(target.name+".receipt.json"),receipt)
            except OSError as exc:
                receipt["sharedPublicationError"]=str(exc)
                emit({"state":"SHARED_CHECKPOINT_UNAVAILABLE","stage":label,"error":str(exc)})
            archives.append(receipt)
            emit({"state":"ARCHIVE_READY",**receipt})
            return receipt
        def library_upload(archive_receipt):
            nonlocal child
            require(library_helper is not None, "No bundled Library helper is installed on this receiving host.")
            request={"uploads":[{"local_path":archive_receipt["localPath"],"purpose":"create_library_file"}]}
            write_json(base/("LIBRARY_REQUEST-"+attempt+".json"),request)
            emit({"state":"LIBRARY_UPLOAD_STARTED","bytes":archive_receipt["bytes"],"sha256":archive_receipt["sha256"]})
            with (base/("library-"+attempt+".stdout")).open("wb") as stdout, (base/("library-"+attempt+".stderr")).open("wb") as stderr:
                child=subprocess.Popen([python,library_helper],cwd=base,env=env,stdin=subprocess.PIPE,
                    stdout=stdout,stderr=stderr,start_new_session=True)
                child.communicate(json.dumps(request).encode())
                code=child.returncode
                child=None
            raw=(base/("library-"+attempt+".stdout")).read_bytes()
            value=json.loads(raw)
            result_path=base/("LIBRARY_RESULT-"+attempt+".json")
            write_json(result_path,value)
            require(code==0,"Bundled Library helper returned exit "+str(code)+"; retain its original stdout and stderr.")
            # The maintained native Library consumer calls the unchanged
            # library_upload.LibraryUploadWorkflow.run and consumes ordered
            # results with local_path/status. Require a matching successful item
            # and its original file identities; keep every other shape unresolved.
            require(isinstance(value,dict) and isinstance(value.get("results"),list)
                    and len(value["results"])==1,"The original Library response does not identify one completed upload.")
            row=value["results"][0]
            require(isinstance(row,dict) and row.get("local_path")==archive_receipt["localPath"]
                    and row.get("status")=="succeeded","The original Library upload item is not a matching success.")
            require(row.get("purpose","create_library_file")=="create_library_file",
                    "The original Library result has a different publication purpose.")
            require(all(isinstance(row.get(key),str) and row[key].strip() for key in ("file_id","library_file_id")),
                    "The original Library item lacks its complete native file identities.")
            require(Path(archive_receipt["localPath"]).stat().st_size==archive_receipt["bytes"]
                    and digest(Path(archive_receipt["localPath"]).read_bytes())==archive_receipt["sha256"],
                    "The published archive changed during the original Library upload.")
            receipt={"status":"succeeded","local_path":row["local_path"],"file_id":row["file_id"],
                "library_file_id":row["library_file_id"],"bytes":archive_receipt["bytes"],
                "sha256":archive_receipt["sha256"],"resultFile":str(result_path),"resultSha256":digest(result_path.read_bytes())}
            emit({"state":"LIBRARY_UPLOAD_SUCCEEDED",**receipt})
            return receipt
        def run_phase(phase, argv):
            nonlocal child
            emit({"state":"PHASE_STARTED","phase":phase,"operationId":operation})
            with (base / (phase + ".stdout")).open("ab") as stdout, (base / (phase + ".stderr")).open("ab") as stderr:
                child = subprocess.Popen(argv,cwd=source,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,start_new_session=True)
                pid = child.pid
                code = child.wait()
                child = None
            emit({"state":"PHASE_RETURNED","phase":phase,"pid":pid,"exitCode":code})
            if code:
                tail=(base/(phase+".stderr")).read_text(errors="replace")[-12000:]
                raise RuntimeError(phase + " exited " + str(code) + "\n" + tail)
        try:
            if resumed is None:
                run_phase("prepare",[python,"-B",str(caller),"--config",str(base/"CONFIG.json"),"--output",str(receiving),"--phase","prepare"])
            else:
                require(digest((receiving/"NATIVE_READY.json").read_bytes()) == resumed["readySha256"],
                        "The original prepared case changed before browser continuation.")
                outcome["preparedContinuation"] = resumed
                emit({"state":"PHASE_REUSED","phase":"prepare","operationId":operation,**resumed})
            ready = json.loads((receiving/"NATIVE_READY.json").read_bytes())
            emit({"state":"NATIVE_READY","caseId":ready["caseId"],"legacyForecasts":len(ready["legacy"]["forecasts"]),
                "legacyPortfolios":len(ready["legacy"]["portfolios"]),"readySha256":digest((receiving/"NATIVE_READY.json").read_bytes())})
            if resumed is None:
                publish("PREPARED")
            run_phase("browser",[node,"--max-old-space-size=256",str(base/"run-browser.mjs"),playwright,chromium,
                str(callback),str(receiving/"NATIVE_READY.json"),str(receiving/"browser"),python])
            run_phase("verify",[python,"-B",str(caller),"--config",str(base/"CONFIG.json"),"--output",str(receiving),
                "--phase","verify","--browser-result",str(receiving/"browser"/"RESULT.json")])
            result=json.loads((receiving/"RESULT.json").read_bytes())
            require(result.get("state")=="PASS","Original final receiving did not pass.")
            outcome.update(state="PASS",result=str(receiving/"RESULT.json"),caseId=result["preparedCaseId"],
                phases=result["phases"],forecasts=result["forecasts"],portfolios=result["portfolios"])
        except BaseException as exc:
            outcome.update(state="FAILED",error=str(exc),errorType=type(exc).__name__)
            traceback.print_exc()
        finally:
            if child is not None and child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL); child.wait()
            outcome["finishedAt"]=datetime.now(timezone.utc).isoformat()
            write_json(base/("OUTCOME-"+attempt+".json"),outcome)
            try:
                final=publish("COMPLETE" if outcome["state"]=="PASS" else "INTERRUPTED")
                outcome["archive"]=final
                outcome["deliveryState"]="SHARED_ARCHIVE_READY" if final.get("sharedPath") else "PRESERVATION_PENDING"
                if library_helper is not None:
                    try:
                        outcome["library"]=library_upload(final)
                        outcome["deliveryState"]="LIBRARY_SAVED"
                    except BaseException as exc:
                        outcome["libraryError"]=str(exc)
                        emit({"state":"LIBRARY_UPLOAD_FAILED","error":str(exc)})
                else:
                    outcome["libraryUnavailable"]=True
            except BaseException as exc:
                outcome["deliveryState"]="PRESERVATION_PENDING"
                outcome["archiveError"]=str(exc)
                emit({"state":"ARCHIVE_PUBLICATION_FAILED","error":str(exc),"base":str(base)})
            finally:
                try:
                    reservation.unlink(missing_ok=True)
                except OSError as exc:
                    outcome["reservationCleanupError"]=str(exc)
            try:
                write_json(requested_sink/("OUTCOME-"+attempt+".json"),outcome)
            except OSError:
                pass
            # Retain the two visual-inspection files beside the full archive.
            for name in ("forecast-mobile.png","forecast-desktop.png"):
                picture=receiving/"browser"/name
                if picture.is_file():
                    try:
                        atomic(requested_sink/(attempt+"-"+name),picture.read_bytes())
                    except OSError:
                        pass
            emit(outcome)
        if args.hold_result or (outcome.get("deliveryState")=="PRESERVATION_PENDING" and sys.stdin.isatty()):
            emit({"state":"RESULT_HELD","pid":os.getpid(),"base":str(base),"deliveryState":outcome.get("deliveryState")})
            while True:
                raw=sys.stdin.buffer.readline(256*1024)
                if not raw:
                    break
                command=json.loads(raw)
                if command.get("action")=="finish":
                    break
                if command.get("action")=="status":
                    emit(outcome)
                elif command.get("action")=="inspect-image":
                    name=command.get("name")
                    require(name in ("forecast-mobile.png","forecast-desktop.png"),"Select an original receiving screenshot.")
                    raw=(receiving/"browser"/name).read_bytes()
                    offset=int(command.get("offset",0))
                    require(offset>=0,"Use a nonnegative original-file offset.")
                    part=raw[offset:offset+32768]
                    emit({"name":name,"offset":offset,"bytes":len(raw),"sha256":digest(raw),
                        "content_base64":base64.b64encode(part).decode(),"nextOffset":offset+len(part)})
        return 0 if outcome["state"]=="PASS" and outcome.get("deliveryState")!="PRESERVATION_PENDING" else 1

if __name__ == "__main__":
    raise SystemExit(main())
