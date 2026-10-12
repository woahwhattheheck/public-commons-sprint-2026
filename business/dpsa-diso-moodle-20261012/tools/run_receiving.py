#!/usr/bin/env python3
"""Build, install, receive and deliver the complete DISO course as one retained operation."""
from __future__ import annotations
import argparse, ast, fcntl, hashlib, json, os, shutil, subprocess, sys, tempfile, time, zipfile
from pathlib import Path

OPERATION = "f47a-dpsa-diso-native-20261012"
SOURCE = Path(__file__).resolve().parents[1]
def need(ok, message):
    if not ok: raise RuntimeError(message)
def sha(file):
    with file.open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest()
def read(file):
    return json.loads(file.read_text(encoding="utf-8"))
def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + ".pending")
    data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    with temporary.open("wb") as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    temporary.chmod(0o600); temporary.replace(file)
def event(phase, **values):
    print(json.dumps({"operationId": OPERATION, "phase": phase, **values}), flush=True)
def exact(file, metadata):
    return file.is_file() and file.stat().st_size == metadata["bytes"] and sha(file) == metadata["sha256"]
def metadata(file, root):
    return {"path": file.relative_to(root).as_posix(), "bytes": file.stat().st_size, "sha256": sha(file)}
def run(phase, argv, work, environment, state, statefile):
    state["phase"] = phase; state["phaseStartedAt"] = time.time()
    state["state"] = "RUNNING"; save(statefile, state); event(phase, state="RUNNING")
    # Command arguments may contain installation credentials. Retain phase logs,
    # never an expanded command or environment dump.
    log = work / "logs" / (phase + ".log")
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as stream:
        process = subprocess.run([str(v) for v in argv], cwd=SOURCE, env=environment, stdout=stream, stderr=subprocess.STDOUT)
    state["phases"][phase] = {"exitCode": process.returncode, "log": log.relative_to(work).as_posix(), "completedAt": time.time()}
    save(statefile, state)
    if process.returncode:
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-35:]
        raise RuntimeError(phase + " returned " + str(process.returncode) + "\n" + "\n".join(tail))
    event(phase, state="COMPLETE")
def build(config, work, state, statefile, environment):
    source = SOURCE / "curriculum"
    media, compiled = work / "media", work / "compiled"
    # Use the retained original render when every byte still belongs to these
    # editable scripts. This avoids repeating completed audio/video work.
    manifestfile = media / "media.json"
    existing = read(manifestfile) if manifestfile.is_file() else None
    scriptsha = sha(source / "media/scripts.json")
    requestedmode = config.get("speechMode", "require")
    if existing:
        need(existing["scriptSha256"] == scriptsha, "Continue this operation with its original module scripts")
        need(len(existing["videos"]) == 13, "The retained media contains all13 presentations")
        settings = existing.get("renderSettings", {})
        need(settings.get("sourcesSha256") == sha(source / "sources.json"), "Retain the original presentation source catalogue")
        need(settings.get("voice") == (config.get("voice") if existing.get("speechExecutable") else None),
             "Continue this render with its original selected narration voice")
        need(requestedmode != "require" or all(v["mode"] == "narrated-captioned" for v in existing["videos"]),
             "Use the original narrated media for a narrated receiving operation")
        need(all(exact(media / item["path"], item) for item in existing["files"]), "The original rendered media files are complete")
        event("render-media", state="REUSED", videos=13)
    else:
        run("render-diagrams", [sys.executable, source / "render_diagrams.py", "--curriculum", source],
            work, environment, state, statefile)
        command = [sys.executable, SOURCE / "tools/build_media.py", "--source", source, "--output", media,
                   "--speech-mode", requestedmode]
        for key, option in [("ffmpegExecutable", "--ffmpeg"), ("speechExecutable", "--speech-executable"), ("voice", "--voice")]:
            if config.get(key): command += [option, config[key]]
        run("render-media", command, work, environment, state, statefile)
    for relative in ["images/M01-U02-Q06.png", "images/M08-U02-Q12.png"]:
        need((source / relative).is_file(), "Retain both original rendered assessment diagrams")
    if (compiled / "SOURCE_MANIFEST.json").is_file() and (compiled / "package.json").is_file():
        manifest = read(compiled / "SOURCE_MANIFEST.json")
        need(all(exact(compiled / item["path"], item) for item in manifest["outputs"]), "The complete compiled course is retained")
        for item in manifest["sourceFiles"]:
            need(exact(source / item["path"], item), "Continue the original compiled curriculum edition")
        need(sha(compiled / "media/media.json") == sha(media / "media.json"), "The same rendered presentations belong to this course")
        event("compile-course", state="REUSED", sourceSha256=manifest["sourceSha256"])
    else:
        run("compile-course", [sys.executable, SOURCE / "tools/compile_course.py", "--source", source,
            "--media", media, "--output", compiled], work, environment, state, statefile)
    package = read(compiled / "package.json")
    need(package["counts"]["questions"] == 312 and package["counts"]["videos"] == 13, "Deliver the entire course")
    if state.get("sourceSha256"): need(state["sourceSha256"] == package["sourceSha256"], "Reuse the original whole-course operation")
    state["sourceSha256"] = package["sourceSha256"]; state["counts"] = package["counts"]
    save(statefile, state); return compiled, package
def archive(work, compiled, state, native, browser):
    output = work / "delivery"; output.mkdir(parents=True, exist_ok=True)
    archive = output / "DPSA_DISO_Complete_Editable_Course_20261012.zip"
    files = {}
    for folder, prefix in [(SOURCE / "curriculum", "editable/curriculum"), (SOURCE / "tools", "editable/tools"),
                           (compiled, "course")]:
        for file in sorted(folder.rglob("*")):
            if file.is_file() and not file.is_symlink() and "__pycache__" not in file.parts:
                files[prefix + "/" + file.relative_to(folder).as_posix()] = file
    for name in ["README.md", "RECEIVING.example.json", "SOURCE_PIN.json"]:
        if (SOURCE / name).is_file(): files["editable/" + name] = SOURCE / name
    if native:
        backup = work / "native" / "DPSA_DISO_Complete.mbz"
        need(exact(backup, native["backup"]), "Deliver the retained original Moodle backup")
        files["moodle/DPSA_DISO_Complete.mbz"] = backup
        for name in ["import.json", "native-receiving.json"]:
            files["receiving/" + name] = work / "native" / name
        for file in sorted((work / "browser").glob("*")):
            if file.is_file() and file.suffix in {".json", ".png"}:
                files["receiving/browser/" + file.name] = file
    manifest = {"schema": "dpsa.diso.complete-delivery.v1", "operationId": OPERATION,
                "sourceSha256": state["sourceSha256"], "counts": state["counts"],
                "state": "COMPLETE" if native and browser else "BUILT",
                "moodleBackup": native["backup"] if native else None,
                "nativeState": "PASS" if native and browser else None,
                "browserState": browser["state"] if browser else None,
                "files": [{"path": name, "bytes": file.stat().st_size, "sha256": sha(file)} for name, file in sorted(files.items())]}
    # Deliver course material and receiving results. Private site configuration,
    # account passwords, database state and worker logs stay in the operation.
    temporary = archive.with_suffix(".receiving")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for name, file in sorted(files.items()): bundle.write(file, name)
        bundle.writestr("DELIVERY.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    with zipfile.ZipFile(temporary) as bundle:
        need(bundle.testzip() is None, "Read every complete delivered archive member")
    temporary.replace(archive)
    result = {"file": str(archive), "bytes": archive.stat().st_size, "sha256": sha(archive),
              "entries": len(files) + 1, "state": manifest["state"]}
    save(output / "DELIVERY.json", {**manifest, "archive": result})
    return result
def main(config, build_only):
    os.umask(0o077)
    work = Path(config["directory"]).resolve()
    need(work.is_absolute() and not SOURCE.is_relative_to(work) and not work.is_relative_to(SOURCE),
         "Keep the native operation separate from the complete editable source")
    work.mkdir(parents=True, exist_ok=True)
    lock = (work / "operation.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    statefile = work / "operation.json"
    state = read(statefile) if statefile.is_file() else {"schema": "dpsa.diso.complete-operation.v1",
             "operationId": OPERATION, "state": "PREPARING", "phases": {}, "createdAt": time.time()}
    need(state["operationId"] == OPERATION, "Resume the same original native course operation")
    environment = dict(os.environ)
    environment.update({str(k): str(v) for k, v in config.get("environment", {}).items()})
    # Media PCM, FFmpeg scratch and Playwright profiles belong to this selected
    # operation's storage allocation, including when the shared /tmp is full.
    temporary = work / "temporary"; temporary.mkdir(parents=True, exist_ok=True)
    environment.update({name: str(temporary) for name in ("TMPDIR", "TMP", "TEMP")})
    state["buildOnly"] = build_only
    try:
        compiled, package = build(config, work, state, statefile, environment)
        if build_only:
            result = archive(work, compiled, state, None, None)
            state.update(state="BUILT", delivery=result); save(statefile, state); event("complete-build", **result); return result
        from native_moodle import OwnedMoodle
        with OwnedMoodle(config, work, environment, lambda phase, argv: run(phase, argv, work, environment, state, statefile)) as moodle:
            php = [config["phpExecutable"], *config.get("phpArguments", [])]
            native = work / "native"; native.mkdir(parents=True, exist_ok=True)
            private = work / "private"; private.mkdir(parents=True, exist_ok=True)
            importfile, nativefile = native / "import.json", native / "native-receiving.json"
            backup = native / "DPSA_DISO_Complete.mbz"; credentials = private / "receiving-accounts.json"
            run("import-complete-course", [*php, SOURCE / "tools/import_course.php", "--moodle-root=" + str(moodle.root),
                "--package=" + str(compiled / "package.json"), "--receipt=" + str(importfile), "--backup=" + str(backup)],
                work, environment, state, statefile)
            imported = read(importfile)
            need(imported["state"] == "COMPLETE" and imported["sourceSha256"] == package["sourceSha256"], "Complete original Moodle course import")
            run("receive-original-and-restored-course", [*php, SOURCE / "tools/receive_course.php", "--moodle-root=" + str(moodle.root),
                "--package=" + str(compiled / "package.json"), "--import-receipt=" + str(importfile), "--receipt=" + str(nativefile),
                "--credentials=" + str(credentials), "--action=native"], work, environment, state, statefile)
            received = read(nativefile)
            need(received["nativeState"] == "PASS" and received["nativeGradedQuestions"] == 624, "All original and received course questions use the native engine")
            browserconfig = {"directory": str(work / "browser"), "origin": moodle.origin,
                "phpExecutable": config["phpExecutable"], "phpArguments": config.get("phpArguments", []),
                "nativeReceiver": str(SOURCE / "tools/receive_course.php"), "moodleRoot": str(moodle.root),
                "packageFile": str(compiled / "package.json"), "importReceipt": str(importfile),
                "nativeReceipt": str(nativefile), "credentialsFile": str(credentials),
                "playwrightModule": config["playwrightModule"], "browserExecutable": config["browserExecutable"]}
            configfile = private / "browser-config.json"; save(configfile, browserconfig)
            run("receive-learner-browser", [config["nodeExecutable"], SOURCE / "tools/receive_browser.mjs", configfile],
                work, environment, state, statefile)
            browser = read(work / "browser/browser-receiving.json")
            need(browser["state"] == "PASS", "Receive the whole original learner journey")
            result = archive(work, compiled, state, imported, browser)
            state.update(state="COMPLETE", completedAt=time.time(), delivery=result,
                         nativePassedQuizzes=received["nativePassedQuizzes"], nativeGradedQuestions=received["nativeGradedQuestions"])
            save(statefile, state); event("complete-course", **result); return result
    except Exception as error:
        state.update(state="FAILED", error={"type": type(error).__name__, "message": str(error), "at": time.time()})
        save(statefile, state); event(state.get("phase", "prepare"), state="FAILED", error=str(error)); raise
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close()
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path); parser.add_argument("--build-only", action="store_true")
    args = parser.parse_args()
    main(read(args.config.resolve()), args.build_only)
