#!/usr/bin/env python3
"""Prepare and retain the original complete SCF receiving operation. Python stdlib only."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.request
import zipfile

MANIFEST_SHA256 = "f8bbc9c3acf7e321800579f4c1c6423e065b31cefd815f610a63e89a1deffa4b"
KIT_SHA256 = "dd547ddde2bcab285a8b44990bdd184d69665702aae287d7c8289e9df89ff8de"
KIT_BYTES = 4653289
KIT_PREFIX = "reference/buyer-handoff/"
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
COMMIT = "0d58eaa67daef611146944ebc35613d78d206cb5"
ENTRYPOINT = "stellar/scf-starforge-20261009/partners/cheesecake-stellar-agent/operations/governed_receiving.mjs"
SDK_VERSION = "1.32.1"


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def safe_relative(value):
    if not isinstance(value, str) or "\\" in value or "\x00" in value:
        raise ValueError("Invalid relative source path")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Invalid relative source path: " + value)
    return Path(*path.parts)


def load_manifest(path):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256:
        raise ValueError("The source manifest is not the retained current receiving manifest")
    value = json.loads(raw)
    if (value.get("schema") != "commons.scf-native-source-closure.v1"
            or value.get("repository") != REPOSITORY or value.get("commit") != COMMIT
            or value.get("entrypoint") != ENTRYPOINT):
        raise ValueError("Unexpected source operation")
    names = set()
    total = 0
    for item in value["files"]:
        safe_relative(item["path"])
        if item["path"] in names or not isinstance(item["bytes"], int) or item["bytes"] < 0:
            raise ValueError("Invalid source file descriptor")
        if len(item["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in item["sha256"]):
            raise ValueError("Invalid source file hash")
        names.add(item["path"])
        total += item["bytes"]
    if len(names) != 110 or total != value["source_bytes"] or ENTRYPOINT not in names:
        raise ValueError("Incomplete original source closure")
    return value


def prepare_source(manifest, destination, retained_source):
    def receive(item):
        relative = safe_relative(item["path"])
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        if retained_source is not None:
            candidate = retained_source / relative
            if not candidate.is_file():
                raise ValueError("Missing retained source: " + item["path"])
            raw = candidate.read_bytes()
        else:
            url = "https://raw.githubusercontent.com/" + REPOSITORY + "/" + COMMIT + "/" + item["path"]
            request = urllib.request.Request(url, headers={"User-Agent": "Commons-SCF-Receiving/1"})
            with urllib.request.urlopen(request, timeout=45) as response:
                raw = response.read(item["bytes"] + 1)
        if len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise ValueError("Source differs from manifest: " + item["path"])
        temporary = output.with_name(output.name + ".receiving")
        with temporary.open("xb") as stream:
            stream.write(raw)
        os.replace(temporary, output)
        return len(raw)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(receive, item) for item in manifest["files"]]
        try:
            received = [future.result() for future in concurrent.futures.as_completed(futures)]
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    return {"files": len(received), "bytes": sum(received), "commit": COMMIT}


def receive_kit(kit, destination):
    if kit.stat().st_size != KIT_BYTES or digest(kit) != KIT_SHA256:
        raise ValueError("Kit differs from the original Cheesecake integration kit")
    handoff = destination / "buyer-handoff"
    handoff.mkdir(mode=0o700)
    names = set()
    count = 0
    with zipfile.ZipFile(kit) as archive:
        for member in archive.infolist():
            if not member.filename.startswith(KIT_PREFIX) or member.is_dir():
                continue
            relative = safe_relative(member.filename[len(KIT_PREFIX):])
            if relative.as_posix() in names:
                raise ValueError("Duplicate original handoff member")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("Unsupported handoff ZIP entry")
            if member.file_size > KIT_BYTES:
                raise ValueError("Unexpected handoff member size")
            names.add(relative.as_posix())
            output = handoff / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, output.open("xb") as target:
                shutil.copyfileobj(source, target)
            count += 1
    if count == 0 or not (handoff / "handoff.json").is_file():
        raise ValueError("Original handoff manifest is missing")
    shutil.copyfile(kit, destination / kit.name)
    return handoff


def sdk_directory(path):
    package = path / "@modelcontextprotocol" / "sdk" / "package.json"
    value = json.loads(package.read_text(encoding="utf-8"))
    if value.get("name") != "@modelcontextprotocol/sdk" or value.get("version") != SDK_VERSION:
        raise ValueError("The existing MCP SDK must be exactly " + SDK_VERSION)
    return path.resolve(strict=True)


def stream_command(command, cwd, log_path, state_path, state, node):
    state.update({"phase": "running", "command": command, "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    state.pop("pid", None)
    atomic_json(state_path, state)
    with log_path.open("ab", buffering=0) as log:
        process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                                   PATH=str(node.parent) + os.pathsep + os.environ.get("PATH", "")),
                                   start_new_session=True)
        prior = {}
        def forward(signum, frame):
            try:
                os.killpg(process.pid, signum)
            except ProcessLookupError:
                pass
        try:
            state["pid"] = process.pid
            atomic_json(state_path, state)
            prior = {number: signal.signal(number, forward) for number in (signal.SIGINT, signal.SIGTERM)}
            for chunk in iter(lambda: process.stdout.read1(65536), b""):
                log.write(chunk)
                os.fsync(log.fileno())
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            return process.wait()
        except BaseException:
            if process.poll() is None:
                forward(signal.SIGTERM, None)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    forward(signal.SIGKILL, None)
                    process.wait()
            state["interrupted_process_exit_code"] = process.returncode
            raise
        finally:
            for number, handler in prior.items():
                signal.signal(number, handler)
            if process.stdout is not None:
                process.stdout.close()


def archive_result(destination, manifest):
    output = destination.with_name(destination.name + ".zip")
    if output.exists():
        raise ValueError("Receiving archive already exists")
    files = []
    for base in ("case", "delivery", "original-input"):
        root = destination / base
        if root.exists():
            for path in sorted(root.rglob("*")):
                if path.is_symlink():
                    continue
                if path.is_file():
                    files.append(path)
    for item in manifest["files"]:
        path = destination / "source" / safe_relative(item["path"])
        if path.is_file() and not path.is_symlink():
            files.append(path)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(destination).as_posix())
    os.chmod(output, 0o600)
    result = {"path": str(output), "bytes": output.stat().st_size, "sha256": digest(output), "files": len(files)}
    output.with_name(output.name + ".sha256").write_text(result["sha256"] + "  " + output.name + "\n", encoding="ascii")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True, help="New durable private directory; retained before any native process starts")
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--handoff", help="Original existing private buyer-handoff directory")
    inputs.add_argument("--kit", help="Original Cheesecake_Stellar_Agent_Integration_Kit_20261012.zip")
    parser.add_argument("--manifest", default=str(Path(__file__).with_name("governed_source_closure.json")))
    parser.add_argument("--source", help="Optional already retrieved exact source root; every byte is checked")
    parser.add_argument("--node-modules", help="Optional existing node_modules containing MCP SDK1.32.1")
    parser.add_argument("--node", default=shutil.which("node"), help="Node24 executable")
    parser.add_argument("--python", default=sys.executable, help="Canonical Python executable for the native application")
    args = parser.parse_args()
    os.umask(0o077)
    manifest_path = Path(args.manifest).resolve(strict=True)
    manifest = load_manifest(manifest_path)
    if not args.node:
        parser.error("Node24 is required")
    node = Path(args.node).resolve(strict=True)
    python = Path(args.python).resolve(strict=True)
    version = subprocess.check_output([str(node), "--version"], text=True, timeout=30).strip()
    if not version.startswith("v24."):
        parser.error("This retained receiving operation is prepared for Node24")
    destination = Path(args.destination).expanduser().absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.mkdir(mode=0o700)
    destination = destination.resolve(strict=True)
    source = destination / "source"
    delivery = destination / "delivery"
    original = destination / "original-input"
    for directory in (source, delivery, original):
        directory.mkdir(mode=0o700)
    shutil.copyfile(manifest_path, delivery / "source-closure.json")
    shutil.copyfile(Path(__file__).resolve(), delivery / "receive_governed.py")
    state_path = delivery / "run-state.json"
    state = {"schema": "commons.scf-native-receiving-run.v1", "operation": manifest["operation"],
             "source_commit": COMMIT, "destination": str(destination), "node": version,
             "python": str(python), "phase": "preparing", "manifest_sha256": MANIFEST_SHA256}
    atomic_json(state_path, state)
    code = 1
    try:
        state["source"] = prepare_source(manifest, source, Path(args.source).resolve(strict=True) if args.source else None)
        atomic_json(state_path, state)
        if args.kit:
            handoff = receive_kit(Path(args.kit).resolve(strict=True), original)
        else:
            supplied = Path(args.handoff).resolve(strict=True)
            if not supplied.is_dir():
                raise ValueError("Original handoff must be a directory")
            handoff = original / "buyer-handoff"
            shutil.copytree(supplied, handoff, symlinks=False)
        received_manifest = json.loads((handoff / "handoff.json").read_text(encoding="utf-8"))
        if received_manifest.get("handoffId") != manifest["original_handoff_id"]:
            raise ValueError("The input is not the selected original buyer handoff")
        if args.node_modules:
            modules = sdk_directory(Path(args.node_modules).resolve(strict=True))
            (source / "node_modules").symlink_to(modules, target_is_directory=True)
            state["sdk"] = {"version": SDK_VERSION, "directory": str(modules), "reused": True}
        else:
            package = {"name": "commons-scf-receiving-runtime", "private": True, "version": "1.0.0",
                       "type": "module", "dependencies": {"@modelcontextprotocol/sdk": SDK_VERSION}}
            atomic_json(source / "package.json", package)
            npm = shutil.which("npm")
            if not npm:
                raise ValueError("npm or --node-modules is required")
            state["active_step"] = "sdk-install"
            install = [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"]
            code = stream_command(install, source, delivery / "sdk-install.log", state_path, state, node)
            if code != 0:
                raise RuntimeError("MCP SDK installation exited with " + str(code))
            modules = sdk_directory(source / "node_modules")
            shutil.copyfile(source / "package.json", delivery / "package.json")
            shutil.copyfile(source / "package-lock.json", delivery / "package-lock.json")
            state["sdk"] = {"version": SDK_VERSION, "directory": str(modules), "reused": False}
        state["active_step"] = "native-receiving"
        command = [str(node), str(source / ENTRYPOINT), "--handoff", str(handoff),
                   "--work", str(destination / "case"), "--python", str(python)]
        code = stream_command(command, source, delivery / "native-receiving.log", state_path, state, node)
        state["native_exit_code"] = code
        if code != 0:
            raise RuntimeError("Native receiving exited with " + str(code))
        report = destination / "case" / "receiving.json"
        received = json.loads(report.read_text(encoding="utf-8"))
        if (received.get("outcome") != "PASS" or received.get("operation") != manifest["operation"]
                or received.get("originalHandoffId") != manifest["original_handoff_id"]):
            raise ValueError("Native result differs from the original complete receiving operation")
        state["receiving"] = {"path": str(report), "bytes": report.stat().st_size, "sha256": digest(report)}
        state["phase"] = "completed"
    except BaseException as error:
        code = code if code != 0 else 1
        state["phase"] = "failed"
        state["error"] = type(error).__name__ + ": " + str(error)
        print(state["error"], file=sys.stderr, flush=True)
    finally:
        state["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        atomic_json(state_path, state)
        try:
            archive = archive_result(destination, manifest)
            atomic_json(delivery / "archive.json", archive)
            state["archive"] = archive
            atomic_json(state_path, state)
        except Exception as error:
            state["archive_error"] = type(error).__name__ + ": " + str(error)
            atomic_json(state_path, state)
            if code == 0:
                code = 1
        print(json.dumps(state, ensure_ascii=False), flush=True)
    return code if 0 <= code < 256 else 1


if __name__ == "__main__":
    raise SystemExit(main())
