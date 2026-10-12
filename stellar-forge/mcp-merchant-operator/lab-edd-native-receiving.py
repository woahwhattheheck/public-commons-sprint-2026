"""Run the complete original Lab MCP customer journey in one retained native fixture.

This composes the maintained SF88 checkout fixture's private-file and PTY
lifetime helpers with the original merchant, browser approval and Lab receiver.
The fixture directory retains its keys, policy, native jobs and download
checkpoints so the same command continues the same operation.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import sqlite3
import stat
import sys
import tempfile
import time
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
OPERATION = "MCCAMPBELL-LAB-MCP-RECEIVING-9F77-20261012"
JOB = "mccampbell-lab-mcp:2026.10"
ORIGIN = "https://jobs-merchant.example"
ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
SCHEMA = "stellar-forge.lab-edd-native-fixture.v1"
KEYS = ("SF36_CONSENT_KEY_B64", "SF36_AUDIT_KEY_B64", "SF36_OPERATOR_KEY_B64")
PREFIX = "stellar/scf-starforge-20261009/"


def owned_directory(path: Path) -> Path:
    path = path.absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.getuid() or info.st_mode & 0o077
            or path.resolve(strict=True) != path):
        raise RuntimeError("ORIGINAL_CANONICAL_PRIVATE_DIRECTORY_REQUIRED:" + str(path))
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, default=HERE.parent.parent)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--timeout-seconds", type=int, default=2400)
    parser.add_argument("--heap-mib", type=int, default=768)
    args = parser.parse_args()
    if not 300 <= args.timeout_seconds <= 7200 or not 512 <= args.heap_mib <= 2048:
        parser.error("Use a 300–7200 second complete-operation deadline and 512–2048 MiB Node heap.")
    source_root = args.source_root.resolve(strict=True)
    helper_path = source_root / PREFIX / "sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py"
    spec = importlib.util.spec_from_file_location("starforge_original_checkout_fixture", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("ORIGINAL_SF88_CHECKOUT_FIXTURE_REQUIRED")
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    for name in ("require", "private_read", "encoded", "immutable", "save", "stop_group", "flush_directory"):
        if not callable(getattr(original, name, None)):
            raise RuntimeError("ORIGINAL_CHECKOUT_HELPER_ABI_REQUIRED:" + name)
    fixture = owned_directory(args.directory)
    lock = os.open(fixture / "native-owner.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        node = args.node or (Path(shutil.which("node")) if shutil.which("node") else None)
        original.require(node is not None, "EXISTING_NATIVE_NODE_REQUIRED")
        node = node.resolve(strict=True)
        original.require(node.is_file() and os.access(node, os.X_OK), "EXISTING_NATIVE_NODE_REQUIRED")
        native_script = source_root / "stellar-forge/mcp-merchant-operator/lab-edd-native-receiving.mjs"
        application = source_root / PREFIX / "sf30-seller-sdk/lab-edd/application.mjs"
        example = source_root / PREFIX / "sf30-seller-sdk/lab-edd/merchant.example.json"
        marker = {
            "schema": SCHEMA, "operation": OPERATION, "jobId": JOB, "origin": ORIGIN,
            "directory": str(fixture), "sourceRoot": str(source_root),
            "application": str(application),
            "applicationSha256": hashlib.sha256(application.read_bytes()).hexdigest(),
            "merchantExampleSha256": hashlib.sha256(example.read_bytes()).hexdigest(),
            "python": sys.executable, "node": str(node),
        }
        original.immutable(fixture / "fixture.json", original.encoded(marker))
        key_path = fixture / "fixture-keys.json"
        if not key_path.exists():
            original.require(not (fixture / "ledger.sqlite").exists(),
                             "RESTORE_ORIGINAL_FIXTURE_KEYS_FOR_EXISTING_LEDGER")
            values = {name: base64.b64encode(os.urandom(32)).decode("ascii") for name in KEYS}
            values["MCP_ACCESS_TOKEN"] = os.urandom(32).hex()
            original.immutable(key_path, original.encoded(values))
        keys = json.loads(original.private_read(key_path, 16384))
        original.require(set(keys) == set(KEYS) | {"MCP_ACCESS_TOKEN"}, "ORIGINAL_FIXTURE_KEYS_REQUIRED")
        original.require(all(len(base64.b64decode(keys[name], validate=True)) == 32 for name in KEYS),
                         "ORIGINAL_FIXTURE_KEYS_REQUIRED")
        original.require(isinstance(keys["MCP_ACCESS_TOKEN"], str) and len(keys["MCP_ACCESS_TOKEN"]) == 64
                         and all(value in "0123456789abcdef" for value in keys["MCP_ACCESS_TOKEN"]),
                         "ORIGINAL_MCP_FIXTURE_TOKEN_REQUIRED")
        policy = {"schema": "stellar-spend-governor/v1", "assets": [{
            "network": "stellar:testnet", "asset": ASSET,
            **{name: "10000" for name in ("max_single", "max_total", "max_per_utc_day",
                                          "max_per_actor_utc_day", "max_per_service_utc_day")},
        }]}
        original.immutable(fixture / "policy.json", original.encoded(policy))
        tls = fixture / "tls"
        if not tls.exists():
            openssl = shutil.which("openssl")
            original.require(openssl is not None, "EXISTING_HOST_OPENSSL_REQUIRED")
            temporary = Path(tempfile.mkdtemp(prefix=".tls-", dir=fixture))
            try:
                import subprocess
                subprocess.run([
                    openssl, "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-nodes", "-days", "30", "-subj", "/CN=jobs-merchant.example",
                    "-addext", "subjectAltName=DNS:jobs-merchant.example",
                    "-addext", "basicConstraints=critical,CA:TRUE",
                    "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
                    "-addext", "extendedKeyUsage=serverAuth",
                    "-keyout", str(temporary / "tls.key"), "-out", str(temporary / "tls.pem"),
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
                for name in ("tls.key", "tls.pem"):
                    os.chmod(temporary / name, 0o600)
                    descriptor = os.open(temporary / name, os.O_RDONLY | os.O_NOFOLLOW)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                original.flush_directory(temporary)
                os.rename(temporary, tls)
                original.flush_directory(fixture)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        original.private_read(tls / "tls.key", 16384)
        original.private_read(tls / "tls.pem", 16384)
        env = dict(os.environ)
        env.update(keys)
        env.update({
            "NODE_OPTIONS": "--max-old-space-size=" + str(args.heap_mib),
            "NODE_EXTRA_CA_CERTS": str(tls / "tls.pem"),
            "SF_LAB_NATIVE_FIXTURE_DIR": str(fixture),
            "SF_JOBS_CHECKOUT_PYTHON": sys.executable,
            "LAB_EDD_PYTHON": sys.executable,
        })
        for name in ("NODE_TLS_REJECT_UNAUTHORIZED", "SF_JOBS_CHECKOUT_PROXY",
                     "SF81_APPROVAL_SOCKET", "SF81_APPROVAL_TOKEN"):
            env.pop(name, None)
        attempt = str(time.time_ns())
        original.immutable(fixture / ("native-source-" + attempt + ".json"), original.encoded({
            "schema": SCHEMA, "operation": OPERATION, "sourceRoot": str(source_root),
            "nativeReceiverSha256": hashlib.sha256(native_script.read_bytes()).hexdigest(),
            "launcherSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "originalCheckoutHelperSha256": hashlib.sha256(helper_path.read_bytes()).hexdigest(),
        }))
        transcript = bytearray()
        status = None
        cancelled = False

        def interrupted(_signum, _frame):
            nonlocal cancelled
            cancelled = True

        previous = {kind: signal.signal(kind, interrupted) for kind in (signal.SIGINT, signal.SIGTERM)}
        pid, descriptor = pty.fork()
        if pid == 0:
            os.execve(str(node), [str(node), "--expose-gc", str(native_script)], env)
        try:
            deadline = time.monotonic() + args.timeout_seconds
            while time.monotonic() < deadline:
                original.require(not cancelled, "LAB_NATIVE_RECEIVING_INTERRUPTED")
                ready, _, _ = select.select([descriptor], [], [], 0.1)
                if ready:
                    try:
                        chunk = os.read(descriptor, 65536)
                    except OSError:
                        chunk = b""
                    if chunk:
                        transcript.extend(chunk)
                        original.require(len(transcript) <= 4 * 1024 * 1024, "ORIGINAL_NATIVE_TRANSCRIPT_LIMIT")
                        if b"To authorize ONE fresh reservation" in transcript:
                            raise RuntimeError("USE_ORIGINAL_BROWSER_APPROVAL_FOR_THIS_EXACT_FIXTURE")
                ended, value = os.waitpid(pid, os.WNOHANG)
                if ended:
                    status = value
                    break
            original.require(status is not None, "LAB_NATIVE_RECEIVING_DEADLINE")
            original.require(os.waitstatus_to_exitcode(status) == 0, "LAB_NATIVE_RECEIVING_FAILED")
        finally:
            try:
                status = original.stop_group(pid, status)
            finally:
                try:
                    os.close(descriptor)
                    original.immutable(fixture / ("native-terminal-" + attempt + ".log"), bytes(transcript))
                finally:
                    for kind, handler in previous.items():
                        signal.signal(kind, handler)
        summary = json.loads(original.private_read(fixture / "native-result.json", 4 * 1024 * 1024))
        original.require(summary.get("status") == "COMPLETE" and summary.get("operationId") == OPERATION,
                         "ORIGINAL_FULL_LAB_NATIVE_RESULT_REQUIRED")
        identity = json.dumps(["paid-job-checkout", ORIGIN + "/jobs/" + quote(JOB, safe="")],
                              separators=(",", ":")).encode("ascii")
        intent_id = "job-checkout:" + hashlib.sha256(identity).hexdigest()
        with sqlite3.connect(fixture / "ledger.sqlite") as ledger:
            reservations = ledger.execute("SELECT request_id, amount, state FROM reservations ORDER BY request_id").fetchall()
            original.require(reservations == [(intent_id, "10000", "reserved")],
                             "ORIGINAL_ONE_RESERVATION_BINDING_REQUIRED")
            original.require(ledger.execute("PRAGMA journal_mode").fetchone()[0] == "wal",
                             "ORIGINAL_SF36_WAL_REQUIRED")
        sys.path.insert(0, str(source_root / PREFIX / "sf36-spend-governor"))
        from governor import Governor
        governor = Governor(fixture / "ledger.sqlite", policy, *(base64.b64decode(keys[name]) for name in KEYS))
        try:
            audit = governor.audit()
            original.require(audit["outcome"] == "JOURNAL_CONSISTENT" and audit["rows"] == 1,
                             "ORIGINAL_SF36_JOURNAL_REQUIRED")
        finally:
            governor.close()
        final = {**summary, "operatorLedger": {"intentId": intent_id, "reservations": len(reservations),
                  "amount": "10000", "state": reservations[0][2], "audit": audit["outcome"]},
                 "terminalLog": str(fixture / ("native-terminal-" + attempt + ".log"))}
        original.save(fixture / "native-complete.json", original.encoded(final))
        print(json.dumps({"status": "COMPLETE", "operationId": OPERATION,
                          "result": str(fixture / "native-complete.json"),
                          "nativeResult": str(fixture / "receiving" / "result.json"),
                          "reservations": len(reservations)}), flush=True)
        return 0
    finally:
        os.close(lock)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "INTERRUPTED", "operationId": OPERATION,
                          "error": str(error), "errorType": type(error).__name__}), file=sys.stderr, flush=True)
        raise SystemExit(1)
