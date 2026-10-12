"""Run the original catalog and its UI packet receiver in one owning process.

The original native core operation must close its Catalog before this owner
opens it. One Node child owns one Chromium lifecycle and the two supplied pages
are the same page navigated sequentially between the original local services.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent


def write_json(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    staged = path.with_name(path.name + ".next")
    fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def file_info(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(65536):
            value.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": value.hexdigest()}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--source-root", default=str(HERE.parent))
    result.add_argument("--operation-root", required=True)
    result.add_argument("--catalog", required=True, help="The original completed native catalog directory")
    result.add_argument("--receiver-catalog", help="The same receiving directory on resume; otherwise created below operation-root")
    result.add_argument("--project-packet", help="The exact original ECB SDMX project packet")
    result.add_argument("--provider-username-env")
    result.add_argument("--provider-password-env")
    result.add_argument("--temporary-root", help="Existing volume for one private, disposable browser/service scratch directory")
    result.add_argument("--screenshots", action="store_true", help="Keep local layout images for operator inspection")
    result.add_argument("--timeout", type=int, default=1800)
    return result


def main():
    args = parser().parse_args()
    source = Path(args.source_root).expanduser().resolve(strict=True)
    operation = Path(args.operation_root).expanduser().absolute()
    operation.mkdir(parents=True, exist_ok=True, mode=0o700)
    if operation.is_symlink():
        raise ValueError("Use a real private native operation directory")
    operation = operation.resolve(strict=True)
    if os.name == "posix" and (operation.stat().st_uid != os.getuid() or operation.stat().st_mode & 0o077):
        raise ValueError("The native operation directory must be operator-owned and mode0700")
    original = Path(args.catalog).expanduser().resolve(strict=True)
    receiver = Path(args.receiver_catalog).expanduser().absolute() if args.receiver_catalog else operation / "browser-receiving-catalog"
    if receiver == original:
        raise ValueError("Receive the exported packet into its own catalog directory")
    packet = Path(args.project_packet).expanduser().resolve(strict=True) if args.project_packet else (
        source.parent / "examples" / "ecb-reference-rates.sdmx.zip").resolve(strict=True)
    if packet.is_symlink() or not packet.is_file():
        raise ValueError("Use the original regular SDMX project packet")
    if bool(args.provider_username_env) != bool(args.provider_password_env):
        raise ValueError("Select both provider credential environment names together")
    if args.provider_username_env:
        username = os.environ.get(args.provider_username_env)
        password = os.environ.get(args.provider_password_env)
        if not username or not password:
            raise ValueError("The selected provider credential environment is incomplete")
    else:
        username = "native-catalog-reader"
        password = secrets.token_urlsafe(32)
    output = operation / "browser"
    output.mkdir(exist_ok=True, mode=0o700)
    private_temporary = None
    if args.temporary_root:
        temporary_volume = Path(args.temporary_root).expanduser().resolve(strict=True)
        if not temporary_volume.is_dir():
            raise ValueError("The selected temporary root must be an existing directory")
        private_temporary = Path(tempfile.mkdtemp(prefix="macrobond-browser-", dir=temporary_volume))
    service_tmp = (private_temporary / "service") if private_temporary else operation / "browser-service-tmp"
    browser_tmp = (private_temporary / "browser") if private_temporary else operation / "browser-tmp"
    for target in (service_tmp, browser_tmp):
        target.mkdir(exist_ok=True, mode=0o700)
    for name in ("TMPDIR", "TEMP", "TMP", "SQLITE_TMPDIR"):
        os.environ[name] = str(service_tmp)
    tempfile.tempdir = str(service_tmp)
    # The maintained native dataset child and this browser share the installed
    # runtime selected by the existing owner; no dependency install is performed.
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node")
    os.environ.setdefault("SF30_XML_NODE", node)
    sys.path.insert(0, str(source))
    catalog_module = load_module("catalog", source / "catalog.py")
    server_module = load_module("macrobond_browser_operator_server", source / "server.py")
    Catalog, OperatorServer = catalog_module.Catalog, server_module.OperatorServer
    ready_file = output / "ready.private.json"
    result_file = output / "owner-result.json"
    lock = (operation / "browser-owner.lock").open("a+")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    stopped = threading.Event()
    child = None
    services = []
    result = {"schema": "stellar-forge.macrobond-browser-owner.v1", "status": "RUNNING",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_root": str(source), "original_catalog": str(original),
        "receiver_catalog": str(receiver), "project_packet": file_info(packet),
        "sources": {name: file_info(source / name) for name in (
            "catalog.py", "server.py", "connection.py", "public/app.js", "public/style.css",
            "public/index.html", "delivery/browser-phase.cjs", "delivery/browser-owner.py")}}
    write_json(result_file, result)

    def stop(_number, _frame):
        stopped.set()

    def close_service(server, thread):
        record = (server, thread)
        if record not in services:
            return
        try:
            if thread.is_alive():
                server.shutdown()
                thread.join(timeout=70)
            server.server_close()
        finally:
            services.remove(record)

    previous_signals = {number: signal.signal(number, stop) for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        with ExitStack() as resources:
            for directory, create in ((original, False), (receiver, not receiver.exists())):
                catalog = resources.enter_context(Catalog(directory, create=create))
                server = OperatorServer(catalog, port=0, provider_username=username, provider_password=password)
                thread = threading.Thread(target=server.serve_forever, name="macrobond-native-operator", daemon=False)
                services.append((server, thread))
                resources.callback(close_service, server, thread)
                thread.start()
            ready = {"schema": "stellar-forge.macrobond-browser-ready.v1",
                "source_root": str(source), "project_packet": str(packet), "output_root": str(output),
                "primary": {"url": services[0][0].url, "origin": services[0][0].origin, "catalog": str(original)},
                "receiver": {"url": services[1][0].url, "origin": services[1][0].origin, "catalog": str(receiver)},
                "screenshots": args.screenshots}
            write_json(ready_file, ready)
            result["origins"] = {"primary": services[0][0].origin, "receiver": services[1][0].origin}
            write_json(result_file, result)
            environment = dict(os.environ)
            for name in ("TMPDIR", "TEMP", "TMP"):
                environment[name] = str(browser_tmp)
            child = subprocess.Popen([node, str(source / "delivery" / "browser-phase.cjs"), str(ready_file)],
                env=environment, cwd=source, start_new_session=True)
            print(json.dumps({"event": "macrobond_native_browser_started", "pid": child.pid,
                "result": str(result_file), "original": str(original), "receiver": str(receiver)}), flush=True)
            deadline = time.monotonic() + args.timeout
            try:
                while child.poll() is None:
                    if stopped.is_set() or time.monotonic() >= deadline:
                        result["interrupted"] = stopped.is_set()
                        result["timed_out"] = not stopped.is_set()
                        break
                    stopped.wait(0.5)
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=10)
                result["child_exit"] = child.returncode
                for name, filename in (("browser", "browser-result.json"), ("receiver", "receiving-browser-result.json")):
                    path = output / filename
                    if path.exists():
                        saved = json.loads(path.read_bytes())
                        result[name] = {"status": saved.get("status"), "current_phase": saved.get("current_phase"),
                            "completed": saved.get("completed", []), "error": saved.get("error"), "result": file_info(path)}
                result["status"] = "PASS" if (child.returncode == 0 and
                    result.get("browser", {}).get("status") == "PASS" and
                    result.get("receiver", {}).get("status") == "PASS") else "FAIL"
            finally:
                # Close the exact owned client group before releasing either
                # catalog's native source lock. Preserve all saved data/results.
                if child:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=10)
                for server, thread in reversed(list(services)):
                    close_service(server, thread)
    except Exception as error:
        result["status"] = "FAIL"
        result["error"] = type(error).__name__ + ": " + str(error)
        for server, thread in reversed(list(services)):
            close_service(server, thread)
    finally:
        if private_temporary is not None:
            shutil.rmtree(private_temporary)
        elif browser_tmp.exists():
            shutil.rmtree(browser_tmp)
            browser_tmp.mkdir(mode=0o700)
        for number, previous in previous_signals.items():
            signal.signal(number, previous)
        result["closed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        result["services_closed"] = not services
        write_json(result_file, result)
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()
    print(json.dumps({"event": "macrobond_native_browser_closed", "status": result["status"],
        "result": str(result_file), "child_exit": result.get("child_exit")}), flush=True)
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
