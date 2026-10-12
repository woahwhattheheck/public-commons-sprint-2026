#!/usr/bin/env python3
"""Run the original self-hosted document purchase and receiving operation.

An equipped host supplies Python 3.12 with the locked Unstructured API runtime,
Node 22+, the original SCF checkout, Playwright and Chromium. Source and real
document inputs are pinned and checked here. This coordinator creates no managed
Unstructured job, commercial message, or funded blockchain transaction.
"""
import argparse
import base64
import hashlib
import fcntl
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

API_COMMIT = "448352104eefd2e5b8fa2dc32282fc1cd3db31ae"
OPERATION = "SCF-UNSTRUCTURED-DOCUMENT-RECEIVING-20261012-B9D2"
HERE = Path(__file__).resolve().parent

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    raw = (json.dumps(value, indent=2) + "\n").encode()
    temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(8))
    with temporary.open("xb") as stream:
        os.chmod(temporary, 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)

def source_manifest(source):
    expected = json.loads((HERE / "provider-source.json").read_text())
    assert expected["repository"] == "Unstructured-IO/unstructured-api"
    assert expected["commit"] == API_COMMIT
    verified = []
    for item in expected["files"]:
        relative = PurePosixPath(item["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        path = source.joinpath(*relative.parts)
        assert path.is_file() and not path.is_symlink(), item["path"]
        raw = path.read_bytes()
        assert hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == item["gitBlob"], item["path"]
        verified.append({"path": item["path"], "bytes": len(raw), "gitBlob": item["gitBlob"],
                         "sha256": hashlib.sha256(raw).hexdigest()})
    return verified

def run_checked(argv, **kwargs):
    print(json.dumps({"phase": "runtime-command", "executable": str(argv[0]), "arguments": list(map(str, argv[1:]))}), flush=True)
    subprocess.run(list(map(str, argv)), check=True, **kwargs)

def terminate_owned(process):
    if process is None or process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Complete original SCF source at the published composition")
    parser.add_argument("--provider-source", type=Path, required=True, help="Exact pinned unstructured-api checkout")
    parser.add_argument("--provider-python", type=Path, required=True, help="Existing original locked Python 3.12 runtime")
    parser.add_argument("--python", type=Path, default=Path(sys.executable), help="Original native operator Python")
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--playwright", type=Path, required=True)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--node-modules", type=Path, required=True, help="Existing shared native SDK dependency directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--temporary-parent", type=Path, default=Path(tempfile.gettempdir()))
    parser.add_argument("--warm-models", action="store_true", help="Use the original image's model initialization before opening the merchant")
    parser.add_argument("--receive-only", action="store_true", help="Continue original three saved purchases without provider/payment execution")
    args = parser.parse_args()
    for name in ("source", "provider_source", "provider_python", "python", "node", "playwright", "browser", "node_modules", "output", "temporary_parent"):
        value = getattr(args, name)
        assert value.is_absolute(), name
    assert args.source.is_dir() and args.provider_source.is_dir()
    assert args.provider_python.is_file() and args.python.is_file() and args.node.is_file()
    assert args.playwright.is_file() and args.browser.is_file()
    assert args.node_modules.is_dir()
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.output, 0o700)
    lease_stream = (args.output / "coordinator.lock").open("a+b")
    os.chmod(args.output / "coordinator.lock", 0o600)
    fcntl.flock(lease_stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    result_path = args.output / "coordinator-result.json"
    journal = {"schema": "stellar-forge.unstructured-native-coordinator.v1",
               "operationId": OPERATION, "state": "PREPARING", "startedAt": time.time(),
               "source": str(args.source), "providerSource": str(args.provider_source),
               "output": str(args.output), "receiveOnly": args.receive_only}
    previous = json.loads(result_path.read_text()) if result_path.exists() else None
    if previous and previous.get("state") == "COMPLETED":
        print(json.dumps({"state": "REOPENED_COMPLETE", "result": str(result_path)}), flush=True)
        return
    native_result = args.output / "native-receiving-result.json"
    if native_result.exists():
        prior_native = json.loads(native_result.read_text())
        assert not prior_native.get("purchases") or args.receive_only, "Use the original receiving-only continuation after saved purchases."
    native_selection = json.loads((HERE / "native-source.json").read_text())
    for item in native_selection["files"]:
        raw = (args.source / item["path"]).read_bytes()
        assert hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == item["gitBlob"], item["path"]
    journal["selectedNativeSource"] = native_selection["commit"]
    identity_path = args.output / "private-native-environment.json"
    if identity_path.exists():
        retained_environment = json.loads(identity_path.read_text())
    else:
        assert not native_result.exists(), "The original private environment must be recovered with its existing state"
        retained_environment = {"UNSTRUCTURED_API_KEY": secrets.token_hex(24)}
        for name in ("SF36_CONSENT_KEY_B64", "SF36_AUDIT_KEY_B64", "SF36_OPERATOR_KEY_B64"):
            retained_environment[name] = base64.b64encode(secrets.token_bytes(32)).decode()
        write_json(identity_path, retained_environment)
    assert set(retained_environment) == {"UNSTRUCTURED_API_KEY", "SF36_CONSENT_KEY_B64", "SF36_AUDIT_KEY_B64", "SF36_OPERATOR_KEY_B64"}
    assert all(isinstance(value, str) and value for value in retained_environment.values())
    write_json(result_path, journal)
    provider = native = None
    provider_log = native_log = None
    with tempfile.TemporaryDirectory(prefix="linkup-native-unstructured-", dir=args.temporary_parent) as temporary:
        scratch = Path(temporary)
        os.chmod(scratch, 0o700)
        receiver = scratch / 'receiver'
        receiver.mkdir(mode=0o700)
        for name in ('native-journey.mjs', 'linkup-native-fixture.mjs'):
            (receiver / name).write_bytes((HERE / name).read_bytes())
        (receiver / 'node_modules').symlink_to(args.node_modules, target_is_directory=True)
        environment = dict(os.environ)
        environment["TMPDIR"] = str(scratch)
        environment["PYTHONPYCACHEPREFIX"] = str(scratch / "pycache")
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["PYTHONPATH"] = str(args.provider_source)
        environment.update(retained_environment)
        # Do not lower the original server's default 2 GiB free-memory threshold.
        environment.pop("UNSTRUCTURED_MEMORY_FREE_MINIMUM_MB", None)
        environment.pop("UNSTRUCTURED_PARALLEL_MODE_URL", None)
        environment["OMP_NUM_THREADS"] = "2"
        environment["TOKENIZERS_PARALLELISM"] = "false"
        try:
            if not args.receive_only:
                files = source_manifest(args.provider_source)
                identity_script = (
                    "import importlib.metadata as m,json,sys,platform; "
                    "assert sys.version_info[:2]==(3,12); "
                    "packages={d.metadata['Name']:d.version for d in m.distributions()}; "
                    "assert m.version('unstructured')=='0.22.18'; "
                    "assert m.version('unstructured-inference')=='1.6.11'; "
                    "import prepline_general.api.app; "
                    "print(json.dumps({'python':sys.version,'platform':platform.platform(),'packages':packages}))"
                )
                identity = json.loads(subprocess.check_output([str(args.provider_python), "-B", "-c", identity_script],
                                         cwd=args.provider_source, env=environment, text=True))
                identity.update({"apiCommit": API_COMMIT, "sourceFiles": files,
                                 "sourceLockSha256": hashlib.sha256((args.provider_source / "uv.lock").read_bytes()).hexdigest(),
                                 "freeMemoryMinimumMiB": 2048})
                write_json(args.output / "provider-runtime.json", identity)
                if args.warm_models:
                    # This is the published Dockerfile's original initialization.
                    warm = (
                        "from unstructured.nlp.tokenize import _load_spacy_model; _load_spacy_model(); "
                        "from unstructured.partition.model_init import initialize; initialize(); "
                        "from unstructured_inference.models.tables import UnstructuredTableTransformerModel; "
                        "model=UnstructuredTableTransformerModel(); "
                        "model.initialize('microsoft/table-transformer-structure-recognition')"
                    )
                    with (args.output / "provider-model-initialization.log").open("ab") as log:
                        run_checked([args.provider_python, "-B", "-c", warm], cwd=args.provider_source,
                                    env=environment, stdout=log, stderr=subprocess.STDOUT)
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    port = listener.getsockname()[1]
                provider_log = (args.output / "provider-server.log").open("ab")
                provider = subprocess.Popen([str(args.provider_python), "-B", "-m", "uvicorn",
                    "prepline_general.api.app:app", "--host", "127.0.0.1", "--port", str(port),
                    "--workers", "1", "--log-config", str(args.provider_source / "logger_config.yaml")],
                    cwd=args.provider_source, env=environment, stdout=provider_log,
                    stderr=subprocess.STDOUT, start_new_session=True)
                journal.update({"state": "PROVIDER_STARTING", "providerPid": provider.pid})
                write_json(result_path, journal)
                origin = "http://127.0.0.1:" + str(port)
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    assert provider.poll() is None, "Original API exited; inspect provider-server.log"
                    try:
                        with urllib.request.urlopen(origin + "/healthcheck", timeout=2) as response:
                            assert response.status == 200
                            health = json.load(response)
                            break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Original API health check did not become ready")
                journal.update({"state": "PROVIDER_READY", "providerOrigin": origin, "health": health})
                write_json(result_path, journal)
            else:
                assert (args.output / "provider-runtime.json").is_file()
                origin = "http://127.0.0.1:1"
            run_checked(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-noenc",
                "-keyout", scratch / "test.key", "-out", scratch / "test.crt", "-days", "1",
                "-subj", "/CN=merchant.example", "-addext",
                "subjectAltName=DNS:merchant.example,DNS:soroban-testnet.stellar.org"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.chmod(scratch / "test.key", 0o600)
            environment.update({
                "LINKUP_FIXTURE_ROOT": str(scratch),
                "NODE_EXTRA_CA_CERTS": str(scratch / "test.crt"),
                "UNSTRUCTURED_NATIVE_SOURCE": str(args.source),
                "UNSTRUCTURED_NATIVE_SOURCE_COMMIT": native_selection["commit"],
                "UNSTRUCTURED_NATIVE_OUTPUT": str(args.output),
                "UNSTRUCTURED_NATIVE_PROVIDER_ORIGIN": origin,
                "UNSTRUCTURED_NATIVE_PROVIDER_IDENTITY": str(args.output / "provider-runtime.json"),
                "UNSTRUCTURED_NATIVE_CORPUS": str(args.provider_source / "sample-docs"),
                "UNSTRUCTURED_NATIVE_PYTHON": str(args.python),
                "UNSTRUCTURED_NATIVE_PLAYWRIGHT": str(args.playwright),
                "UNSTRUCTURED_NATIVE_BROWSER": str(args.browser),
            })
            environment["NODE_OPTIONS"] = (environment.get("NODE_OPTIONS", "") +
                " --import=" + str(receiver / "linkup-native-fixture.mjs")).strip()
            native_log = (args.output / "native-console.log").open("ab")
            argv = [str(args.node), str(receiver / "native-journey.mjs")]
            if args.receive_only:
                argv.append("--receive-only")
            native = subprocess.Popen(argv, cwd=args.source, env=environment,
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            journal.update({"state": "NATIVE_RUNNING", "nativePid": native.pid})
            write_json(result_path, journal)
            # The attached foreground stays with the original process and emits its stages.
            for line in iter(native.stdout.readline, b""):
                native_log.write(line)
                native_log.flush()
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
            code = native.wait()
            journal["exitCode"] = code
            assert code == 0, "Original native operation stopped; retain its current workspace and inspect the result"
            result = json.loads(native_result.read_text())
            assert result["status"] == "PASS"
            journal.update({"state": "COMPLETED", "completedAt": time.time(),
                            "nativeResultSha256": hashlib.sha256(native_result.read_bytes()).hexdigest()})
            write_json(result_path, journal)
            print(json.dumps({"state": journal["state"], "result": str(result_path)}), flush=True)
        except BaseException as error:
            journal.update({"state": "INTERRUPTED", "error": type(error).__name__ + ": " + str(error),
                            "interruptedAt": time.time()})
            write_json(result_path, journal)
            raise
        finally:
            terminate_owned(native)
            terminate_owned(provider)
            if provider_log:
                provider_log.close()
            if native_log:
                native_log.close()

if __name__ == "__main__":
    main()
