#!/usr/bin/env python3
"""MIT. Assemble and receive the maintained OpenSearch deployment workspace."""
from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import selectors
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import time
from uuid import uuid4
import zipfile

PREFIX = "stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch"
SCHEMA = "stellar-forge.opensearch-managed-receiving.v1"


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def emit(value):
    print(json.dumps(value), flush=True)


def need(condition, message):
    if not condition:
        raise ValueError(message)


def relative(value):
    need(isinstance(value, str) and value, "Use a nonempty source-relative path")
    path = PurePosixPath(value)
    need(not path.is_absolute() and "\\" not in value and
         all(part not in ("", ".", "..") for part in value.split("/")),
         "Source members must remain beneath their selected directory")
    return path


def regular(path):
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and not path.is_symlink(),
         "Use a regular source file: " + str(path))
    raw = path.read_bytes()
    after = path.lstat()
    need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
         "Source changed while being read: " + str(path))
    return raw, {"bytes": len(raw), "sha256": digest(raw),
                 "mode": stat.S_IMODE(info.st_mode) & 0o777}


def atomic(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name("." + path.name + "." + uuid4().hex)
    try:
        with temporary.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def retain_file(path, raw, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        old, _ = regular(path)
        need(old == raw, "Retain the original file before choosing another edition: " + str(path))
        return
    candidate = path.with_name("." + path.name + "." + uuid4().hex)
    try:
        with candidate.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        candidate.chmod(mode)
        try:
            os.link(candidate, path)
        except FileExistsError:
            need(regular(path)[0] == raw, "The original file changed during publication: " + str(path))
    finally:
        with contextlib.suppress(FileNotFoundError):
            candidate.unlink()


def source_files(args):
    selected = {}
    if args.selection:
        value = json.loads(regular(args.selection)[0])
        need(isinstance(value, dict) and isinstance(value.get("files"), dict),
             "Use the existing complete dependency selection")
        need(not value.get("missing"), "The retained dependency selection has unresolved imports")
        selected.update({str(relative(name)): Path(path).resolve()
                         for name, path in value["files"].items()})
    else:
        need(args.source_root.is_dir(), "Select the complete portable source directory")
        manifest_path = args.source_root / "SOURCE_MANIFEST.json"
        if manifest_path.is_file():
            manifest = json.loads(regular(manifest_path)[0])
            need(manifest.get("schema") == "stellar-forge.opensearch-managed-source.v1"
                 and isinstance(manifest.get("files"), dict),
                 "Retain the original portable source manifest")
            for name, details in manifest["files"].items():
                path = args.source_root / str(relative(name))
                _, actual = regular(path)
                need(actual["bytes"] == details["bytes"] and actual["sha256"] == details["sha256"],
                     "Portable source member differs: " + name)
                selected[name] = path
        else:
            for path in sorted(args.source_root.rglob("*")):
                need(not path.is_symlink(), "Portable source directories must not contain symlinks")
                if path.is_file():
                    selected[str(path.relative_to(args.source_root).as_posix())] = path
    if args.overlay:
        need(args.overlay.is_dir(), "The selected source overlay is absent")
        for path in sorted(args.overlay.rglob("*")):
            need(not path.is_symlink(), "The source overlay must contain regular paths")
            if path.is_file():
                selected[str(path.relative_to(args.overlay).as_posix())] = path
    bridge = args.bridge_source or selected.get(PREFIX + "/receiving/playground-bridge.py")
    need(bridge is not None, "Retain the original public Playground bridge")
    selected[PREFIX + "/receiving/playground-bridge.py"] = Path(bridge)
    selected[PREFIX + "/receiving/run-deployment.py"] = Path(__file__).resolve()
    need(PREFIX + "/receiving/deployment-journey.mjs" in selected,
         "Complete the existing customer driver before starting this receiver")
    need(len(selected) <= 1000, "The portable source inventory exceeds its declared scope")
    return selected


def assemble(args, directory, runtime):
    files = source_files(args)
    target = runtime / "source"
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    members, provenance, total = {}, {}, 0
    for name, original in sorted(files.items()):
        relative(name)
        raw, details = regular(original)
        total += len(raw)
        need(total <= 32 * 1024 * 1024, "Portable source exceeds 32 MiB")
        mode = 0o755 if details["mode"] & 0o111 else 0o644
        retain_file(target / name, raw, mode)
        members[name] = {**details, "mode": mode}
        provenance[name] = str(original)
    fingerprint = digest(encoded(members))
    source_manifest = {"schema": "stellar-forge.opensearch-managed-source.v1",
                       "createdAt": now(), "sourceSha256": fingerprint,
                       "bytes": total, "files": members}
    archive = directory / "source-runtime.zip"
    if archive.exists():
        with zipfile.ZipFile(archive) as saved:
            names = saved.namelist()
            need(len(names) == len(set(names)) and
                 set(names) == set(members) | {"SOURCE_MANIFEST.json"},
                 "Retain the first complete source archive")
            prior = json.loads(saved.read("SOURCE_MANIFEST.json"))
            need(prior.get("sourceSha256") == fingerprint and prior.get("files") == members,
                 "The existing source archive belongs to another source edition")
            for name, details in members.items():
                body = saved.read(name)
                need(len(body) == details["bytes"] and digest(body) == details["sha256"],
                     "The retained source archive differs: " + name)
            source_manifest = prior
    else:
        candidate = directory / (".source-runtime-" + uuid4().hex + ".zip")
        try:
            with zipfile.ZipFile(candidate, "x", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=6) as output:
                for name, details in members.items():
                    item = zipfile.ZipInfo(name)
                    item.external_attr = (stat.S_IFREG | details["mode"]) << 16
                    item.compress_type = zipfile.ZIP_DEFLATED
                    output.writestr(item, (target / name).read_bytes())
                output.writestr("SOURCE_MANIFEST.json", encoded(source_manifest))
            with candidate.open("rb") as stream:
                os.fsync(stream.fileno())
            os.link(candidate, archive)
        finally:
            with contextlib.suppress(FileNotFoundError):
                candidate.unlink()
    raw, details = regular(archive)
    atomic(directory / "source-assembly.json", encoded({
        "schema": "stellar-forge.opensearch-source-assembly.v1",
        "sourceSha256": fingerprint, "sourceFiles": len(members), "sourceBytes": total,
        "archive": {"filename": archive.name, **details},
        "runtimeRoot": str(target), "selectedSources": provenance}))
    return target, {"files": len(members), "bytes": total, "sourceSha256": fingerprint,
                    "archive": {"filename": archive.name, **details}}


def original_context(args):
    report_raw, report_file = regular(args.original_journey)
    report = json.loads(report_raw)
    need(report.get("schema") == "stellar-forge.opensearch-native-journey.v1"
         and report.get("state") == "PASS", "Use the retained completed original merchant journey")
    captures = [s for s in report.get("stages", []) if s.get("name") == "native-capture"]
    packages = [s for s in report.get("stages", []) if s.get("name") == "original-customer-export"]
    need(len(captures) == len(packages) == 1, "The original report must select one capture and package")
    capture, package = captures[0], packages[0]
    need(capture.get("hitCount") == 7 and
         capture.get("resultSha256") == args.expected_result_sha256,
         "Use the selected original seven-hit source result")
    return report, {"report": report_file, "capture": capture, "package": package}


def verify_original_snapshot(db, original):
    meta = dict(db.execute("SELECT key,value FROM meta"))
    need(meta.get("schema") == "stellar-forge.opensearch-workspace.v1",
         "Use the original OpenSearch workspace")
    capture = original["capture"]
    edition = db.execute(
        "SELECT result_json,result_sha256,record_json FROM editions WHERE id=?",
        (capture["editionId"],)).fetchone()
    need(edition is not None and digest(edition[0].encode()) == capture["resultSha256"]
         and edition[1] == capture["resultSha256"],
         "The original captured result does not match its native report")
    need(len(json.loads(edition[0])["hits"]) == 7, "The retained result no longer has seven hits")
    packages = [json.loads(row[0]) for row in db.execute("SELECT record_json FROM packages ORDER BY id")]
    need(any(p.get("id") == original["package"]["packageId"] for p in packages),
         "The original customer package is absent from the workspace")
    return meta, packages


def inventory_source(root):
    files = {}
    for path in sorted(root.rglob("*")):
        need(not path.is_symlink(), "Original workspace source paths must remain regular")
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if name in ("workspace.sqlite3", "workspace.sqlite3-wal", "workspace.sqlite3-shm"):
            continue
        need(name.startswith(("packages/", "sources/")),
             "Retain and explicitly account for this original workspace file: " + name)
        raw, details = regular(path)
        files[name] = (raw, details)
    need(sum(item[1]["bytes"] for item in files.values()) <= 32 * 1024 * 1024,
         "Original source assets exceed the receiving declaration")
    return files


def clone_workspace(args, directory, original):
    target = directory / "workspace"
    receipt_path = directory / "source-clone.json"
    source = args.source_workspace.resolve()
    need(source != target.resolve() and source not in target.resolve().parents,
         "Select a separate receiving workspace")
    need((source / "workspace.sqlite3").is_file(), "The selected original database is absent")
    retain_file(directory / "original-merchant-journey.json", regular(args.original_journey)[0])
    recipe = {"sourceReportSha256": original["report"]["sha256"],
              "editionId": original["capture"]["editionId"],
              "resultSha256": original["capture"]["resultSha256"],
              "packageId": original["package"]["packageId"]}
    if target.exists():
        need(receipt_path.is_file(), "Retain the existing workspace and its original clone receipt")
        receipt = json.loads(regular(receipt_path)[0])
        need(receipt.get("recipe") == recipe, "This receiver belongs to a different source selection")
        with contextlib.closing(sqlite3.connect(
                (target / "workspace.sqlite3").as_uri() + "?mode=ro", uri=True)) as db:
            meta, packages = verify_original_snapshot(db, original)
        need(meta["workspace_id"] == receipt["workspaceId"], "The receiving workspace identity changed")
        for name, details in receipt["files"].items():
            _, actual = regular(target / str(relative(name)))
            need(actual["bytes"] == details["bytes"] and actual["sha256"] == details["sha256"],
                 "An original receiving asset changed: " + name)
        return target, receipt
    staging = directory / ".workspace-initial"
    staging.mkdir(mode=0o700, exist_ok=True)
    source_lock = source.parent / "receiver.lock"
    need(source_lock.is_file(), "Retain the original source receiver lock")
    with source_lock.open("rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        with contextlib.closing(sqlite3.connect(
                (source / "workspace.sqlite3").as_uri() + "?mode=ro", uri=True)) as db:
            db.execute("BEGIN")
            meta, packages = verify_original_snapshot(db, original)
            files = inventory_source(source)
            for package in packages:
                package_id = package["id"]
                need(str(relative(package_id)) == package_id and "/" not in package_id,
                     "The retained package identity is invalid")
                for item in package.get("files", []):
                    name = "packages/" + package_id + "/" + str(relative(item["name"]))
                    need(name in files, "Original package member is absent: " + name)
                    details = files[name][1]
                    need(details["bytes"] == item["bytes"] and details["sha256"] == item["sha256"],
                         "Original package member differs: " + name)
            for name, (raw, _) in files.items():
                retain_file(staging / name, raw)
            destination = staging / "workspace.sqlite3"
            with contextlib.closing(sqlite3.connect(destination)) as copied:
                db.backup(copied)
                need(copied.execute("PRAGMA quick_check").fetchone()[0] == "ok",
                     "The consistent source snapshot could not be reopened")
                copied.commit()
            db.rollback()
        fcntl.flock(lock, fcntl.LOCK_UN)
    database_raw, database = regular(staging / "workspace.sqlite3")
    receipt = {"schema": "stellar-forge.opensearch-receiving-clone.v1",
               "createdAt": now(), "recipe": recipe, "workspaceId": meta["workspace_id"],
               "sourceProfileSha256": meta["source_profile_sha256"],
               "originalDirectory": str(source), "directory": str(target),
               "databaseSnapshot": database,
               "files": {name: details for name, (_, details) in files.items()}}
    # The receipt and stable staging identity precede the first promotion.
    atomic(receipt_path, encoded(receipt))
    staging.rename(target)
    retain_file(directory / "original-merchant-journey.json", regular(args.original_journey)[0])
    return target, receipt


def wait_ready(child, maximum=180):
    deadline = time.monotonic() + maximum
    data = bytearray()
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not selector.select(timeout=max(0, min(1, deadline - time.monotonic()))):
                continue
            chunk = os.read(child.stdout.fileno(), 4096)
            need(chunk, "The original bridge ended before ready; inspect its retained stderr")
            data.extend(chunk)
            need(len(data) <= 65536, "The original bridge readiness record is too large")
            if b"\n" in data:
                ready = json.loads(bytes(data).split(b"\n", 1)[0])
                need(ready.get("index") == "opensearch_dashboards_sample_data_flights",
                     "The original public flights index is unavailable")
                return ready
    raise RuntimeError("Anonymous transport bootstrap exceeded 180 seconds")


def stop_group(child):
    if child is None:
        return
    with contextlib.suppress(ProcessLookupError):
        os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    # A child server retains its parent's process group even after the leader exits.
    with contextlib.suppress(ProcessLookupError):
        os.killpg(child.pid, signal.SIGKILL)


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--runtime-root", required=True, type=Path)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--selection", type=Path)
    group.add_argument("--source-root", type=Path)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--bridge-source", type=Path)
    parser.add_argument("--original-journey", required=True, type=Path)
    parser.add_argument("--source-workspace", required=True, type=Path)
    parser.add_argument("--expected-result-sha256", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--browser", required=True, type=Path)
    parser.add_argument("--node-modules", required=True, type=Path)
    args = parser.parse_args(argv)
    os.umask(0o077)
    directory = args.directory.expanduser().resolve()
    runtime = args.runtime_root.expanduser().resolve()
    need(directory != runtime and directory not in runtime.parents and runtime not in directory.parents,
         "Keep the declared temporary runtime separate from retained receiving output")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    node = shutil.which(args.node)
    need(node and args.browser.is_file() and (args.node_modules / "playwright").is_dir(),
         "Use the selected installed Node, browser and Playwright runtime")
    version = subprocess.run([node, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    need(int(version.lstrip("v").split(".")[0]) >= 24, "Use the original Node24+ runtime")
    with (directory / "receiver.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        attempt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
        metadata = directory / "native" / attempt
        metadata.mkdir(parents=True, mode=0o700)
        state_path = metadata / "receiver-state.json"
        state = {"schema": SCHEMA, "operation": "opensearch-managed-deployment-396c-20261012",
                 "startedAt": now(), "directory": str(directory), "metadata": str(metadata),
                 "runtimeRoot": str(runtime), "node": version, "nodeExecutable": node}
        bridge = child = errors = None
        handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
        status = 1

        def save(phase, **extra):
            state.update(phase=phase, updatedAt=now(), **extra)
            atomic(state_path, encoded(state))

        try:
            save("PREPARING")
            report, original = original_context(args)
            source_root, assembled = assemble(args, directory, runtime)
            workspace, cloned = clone_workspace(args, directory, original)
            save("SOURCE_READY", sourceAssembly=assembled, workspaceId=cloned["workspaceId"],
                 originalResultSha256=original["capture"]["resultSha256"],
                 originalPackageId=original["package"]["packageId"])
            errors = (metadata / "bridge-stderr.log").open("ab")
            bridge = subprocess.Popen(
                [sys.executable, "-u", str(source_root / PREFIX / "receiving/playground-bridge.py"),
                 str(metadata)], stdout=subprocess.PIPE, stderr=errors, start_new_session=True)
            ready = wait_ready(bridge)
            environment = os.environ.copy()
            environment.update({
                "TMPDIR": str(runtime / "tmp"),
                "OPENSEARCH_RECEIVING_DIRECTORY": str(directory),
                "OPENSEARCH_DEPLOYMENT_OUTPUT": str(directory),
                "OPENSEARCH_DEPLOYMENT_WORKSPACE": str(workspace),
                "OPENSEARCH_SOURCE_ROOT": str(source_root),
                "OPENSEARCH_ORIGINAL_JOURNEY": str(directory / "original-merchant-journey.json"),
                "OPENSEARCH_SOURCE_PACKAGE": str(workspace / "packages" / original["package"]["packageId"]),
                "OPENSEARCH_PLAYGROUND_ENDPOINT": ready["endpoint"],
                "OPENSEARCH_NATIVE_METADATA": str(metadata),
                "OPENSEARCH_BROWSER_EXECUTABLE": str(args.browser.resolve()),
                "OPENSEARCH_PLAYWRIGHT_ROOT": str((args.node_modules / "playwright").resolve()),
                "OPENSEARCH_DEPLOYMENT_SOURCE_ARCHIVE": str(directory / "source-runtime.zip"),
                "PYTHONDONTWRITEBYTECODE": "1"})
            (runtime / "tmp").mkdir(mode=0o700, exist_ok=True)
            save("BRIDGE_READY", engineVersion=ready["version"], index=ready["index"], bridgePid=bridge.pid)
            emit({"phase": "native_deployment_ready", "directory": str(directory),
                  "metadata": str(metadata), "workspaceId": cloned["workspaceId"],
                  "sourceFiles": assembled["files"], "engineVersion": ready["version"]})
            driver = source_root / PREFIX / "receiving/deployment-journey.mjs"
            child = subprocess.Popen([node, "--max-old-space-size=192", str(driver)],
                                     cwd=source_root, env=environment, start_new_session=True)
            save("RUNNING", driverPid=child.pid)
            status = child.wait()
            save("COMPLETE" if status == 0 else "FAILED", driverExitCode=status)
        except KeyboardInterrupt:
            status = 130
            with contextlib.suppress(OSError):
                save("INTERRUPTED")
        except Exception as error:
            with contextlib.suppress(OSError):
                save("FAILED", receiverError=str(error))
            emit({"phase": "native_deployment_error", "error": str(error), "metadata": str(metadata)})
            status = 1
        finally:
            stop_group(child)
            stop_group(bridge)
            if bridge is not None and bridge.stdout is not None:
                bridge.stdout.close()
            if errors is not None:
                errors.close()
            for sig, previous in handlers.items():
                signal.signal(sig, previous)
            with contextlib.suppress(OSError):
                save(state["phase"], childrenDrainedAt=now())
            fcntl.flock(lock, fcntl.LOCK_UN)
        emit({"phase": "native_deployment_finished", "driverExitCode": status,
              "directory": str(directory), "metadata": str(metadata)})
        return status


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit({"phase": "native_deployment_setup_error", "error": str(error)})
        raise SystemExit(1)

