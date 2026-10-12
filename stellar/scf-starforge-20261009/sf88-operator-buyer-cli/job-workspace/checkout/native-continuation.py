"""Run one retained application checkout through original Node CLI, TLS and SF62.

The controlling PTY answers only the exact disposable checkout fixture shown by
the original console. All ticket, native attempt, policy and ledger files remain
under the retained fixture directory for continuation of the same operation.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[1]
SOURCE_ROOT = HERE.parents[2]
OPERATION = "SCF-JOB-CHECKOUT-CONTINUATION-0B8D-20261012"
JOB = "checkout:2026.10"
ORIGIN = "https://jobs-merchant.example"
ASSET = "C" + "A" * 55
KEYS = ("SF36_CONSENT_KEY_B64", "SF36_AUDIT_KEY_B64", "SF36_OPERATOR_KEY_B64")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def encoded(value) -> bytes:
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")


def private_read(path: Path, limit: int = 1048576) -> bytes:
    mode = path.lstat()
    require(stat.S_ISREG(mode.st_mode) and not mode.st_mode & 0o077 and
            mode.st_uid == os.getuid() and mode.st_size <= limit,
            "PRIVATE_FIXTURE_FILE_REQUIRED:" + str(path))
    with path.open("rb") as stream:
        value = stream.read(limit + 1)
    require(len(value) <= limit, "FIXTURE_FILE_LIMIT:" + str(path))
    return value


def flush_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def immutable(path: Path, value: bytes) -> None:
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(private_read(path, max(1048576, len(value))) == value,
                "RETAINED_FIXTURE_FILE_CHANGED:" + str(path))
        return
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    flush_directory(path.parent)


def save(path: Path, value: bytes) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".checkout-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        flush_directory(path.parent)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def current_review(transcript: bytes) -> dict:
    text = transcript.decode("utf8", errors="strict").replace("\r\n", "\n")
    decoder = json.JSONDecoder()
    review = None
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        if type(value) is dict and type(value.get("review")) is dict:
            review = value
    require(review is not None, "ORIGINAL_TERMINAL_REVIEW_REQUIRED")
    return review


def answer_fixture(transcript: bytes, command: bytes, fixture: Path, expected_intent: str, job: str) -> None:
    envelope = current_review(transcript)
    review = envelope["review"]
    handoff = json.loads(private_read(fixture / "checkout.handoff.json", 65536))
    purchase = handoff["purchase"]
    require(handoff["job"]["id"] == job and purchase["orderReference"] == job,
            "FIXTURE_TICKET_ID_CHANGED")
    body = json.dumps({"jobId": job}, separators=(",", ":")).encode("ascii")
    expected = {
        "schema": "stellar-forge.sf62.operator-review.v1",
        "request_id": expected_intent,
        "actor": "fixture-job-checkout",
        "service": "fixture-application-jobs",
        "resource": ORIGIN + "/analysis?sf98_order=" + quote(job, safe=""),
        "method": "POST",
        "scheme": "exact",
        "network": "stellar:testnet",
        "asset": ASSET,
        "pay_to": "UNVERIFIED_DEMO_RECIPIENT",
        "max_atomic_units_to_reserve": "10000",
        "max_timeout_seconds": 60,
        "body_present": True,
        "body_bytes": len(body),
        "body_sha256": hashlib.sha256(body).hexdigest(),
    }
    for key, value in expected.items():
        require(review.get(key) == value, "FIXTURE_ORIGINAL_REVIEW_CHANGED:" + key)
    for key in ("scheme", "network", "asset", "payTo", "amount", "maxTimeoutSeconds"):
        require(review["complete_original_accepted_terms"].get(key) == purchase["payment"][key],
                "FIXTURE_ACCEPTED_TERMS_CHANGED:" + key)
    require(envelope["current_native_budget_estimate"].get("approved") is True,
            "ORIGINAL_FIXTURE_BUDGET_DENIED")
    require(command.decode("ascii") == "APPROVE " + review["request_sha256"][:16],
            "ORIGINAL_TERMINAL_DIGEST_CHANGED")


def stop_group(pid: int, status):
    if status is not None:
        return status
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        ended, value = os.waitpid(pid, os.WNOHANG)
        if ended:
            return value
        time.sleep(0.1)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return os.waitpid(pid, 0)[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--retained", type=Path, required=True)
    parser.add_argument("--node", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--approval", choices=("terminal", "browser"), default="terminal")
    args = parser.parse_args()
    browser_approval = args.approval == "browser"
    operation = "SCF-JOB-BROWSER-APPROVAL-0B8D-20261012" if browser_approval else OPERATION
    job = "browser-checkout:2026.10" if browser_approval else JOB
    require(args.retained.is_absolute(), "ABSOLUTE_RETAINED_DIRECTORY_REQUIRED")
    retained = args.retained.resolve(strict=True)
    original_config = private_read(retained / "merchant.json")
    config = json.loads(original_config)
    require(config.get("publicOrigin") == ORIGIN and
            config["functions"]["analyze"]["payment"]["asset"] == "UNVERIFIED_DEMO_ASSET" and
            config["functions"]["analyze"]["payment"]["payTo"] == "UNVERIFIED_DEMO_RECIPIENT",
            "ORIGINAL_DISPOSABLE_PAID_JOB_FIXTURE_REQUIRED")
    application = (retained / config["application"]).resolve(strict=True)
    application_bytes = private_read(application, 4194304)
    original_source = json.loads(private_read(retained / "merchant-state" / "source.json"))
    original = {
        "configSha256": hashlib.sha256(original_config).hexdigest(),
        "applicationSha256": hashlib.sha256(application_bytes).hexdigest(),
    }
    require(all(original_source["source"].get(key) == value for key, value in original.items()),
            "ORIGINAL_MERCHANT_SOURCE_CHANGED")
    fixture = retained / ("checkout-browser-continuation" if browser_approval else "checkout-continuation")
    fixture.mkdir(mode=0o700, exist_ok=True)
    require(fixture.is_dir() and not fixture.is_symlink() and not fixture.stat().st_mode & 0o077,
            "PRIVATE_CHECKOUT_FIXTURE_DIRECTORY_REQUIRED")
    lock = os.open(fixture / "driver.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    marker = {
        "schema": "stellar-forge.sf88.job-checkout-journey.v1",
        "operation": operation,
        "retainedDirectory": str(retained),
        "fixtureDirectory": str(fixture),
        "runtimeDirectory": str(RUNTIME),
        "application": str(application),
        "original": original,
    }
    if browser_approval:
        marker["approvalMode"] = "BROWSER"
        marker["inputMode"] = "ORIGINAL_MERCHANT_INTAKE"
    immutable(fixture / "fixture.json", encoded(marker))
    keys_path = fixture / "fixture-keys.json"
    if not keys_path.exists():
        require(not (fixture / "ledger.sqlite").exists(), "RESTORE_ORIGINAL_FIXTURE_KEYS_FOR_EXISTING_LEDGER")
        immutable(keys_path, encoded({name: base64.b64encode(os.urandom(32)).decode("ascii") for name in KEYS}))
    keys = json.loads(private_read(keys_path, 16384))
    require(set(keys) == set(KEYS) and all(len(base64.b64decode(keys[name], validate=True)) == 32 for name in KEYS),
            "FIXTURE_KEYS_INVALID")
    policy = {"schema": "stellar-spend-governor/v1", "assets": [{
        "network": "stellar:testnet", "asset": ASSET,
        **{name: "10000" for name in ("max_single", "max_total", "max_per_utc_day",
                                      "max_per_actor_utc_day", "max_per_service_utc_day")},
    }]}
    immutable(fixture / "policy.json", encoded(policy))
    tls = fixture / "tls"
    if not tls.exists():
        openssl = shutil.which("openssl")
        require(openssl is not None, "ORIGINAL_HOST_OPENSSL_REQUIRED")
        temporary = Path(tempfile.mkdtemp(prefix=".tls-", dir=fixture))
        try:
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
                descriptor = os.open(temporary / name, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            flush_directory(temporary)
            os.rename(temporary, tls)
            flush_directory(fixture)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    private_read(tls / "tls.key", 16384)
    private_read(tls / "tls.pem", 16384)
    node = args.node or (Path(shutil.which("node")) if shutil.which("node") else None)
    require(node is not None and node.is_absolute() and node.is_file(), "HOST_NODE_EXECUTABLE_REQUIRED")
    env = dict(os.environ)
    env.update(keys)
    env.update({
        "NODE_OPTIONS": "--max-old-space-size=256",
        "NODE_EXTRA_CA_CERTS": str(tls / "tls.pem"),
        "SF_JOBS_CHECKOUT_FIXTURE_DIR": str(fixture),
        "SF_JOBS_CHECKOUT_PYTHON": sys.executable,
    })
    env.pop("NODE_TLS_REJECT_UNAUTHORIZED", None)
    env.pop("SF_JOBS_CHECKOUT_PROXY", None)
    env.pop("SF81_APPROVAL_SOCKET", None)
    env.pop("SF81_APPROVAL_TOKEN", None)
    ticket_identity = json.dumps(["paid-job-checkout", ORIGIN + "/jobs/" + quote(job, safe="")],
                                 separators=(",", ":")).encode("ascii")
    expected_intent = "job-checkout:" + hashlib.sha256(ticket_identity).hexdigest()
    terminal_log = fixture / ("terminal-" + str(time.time_ns()) + ".log")
    transcript = bytearray()
    scanned = approvals = 0
    status = None
    cancelled = False

    def interrupted(signum, _frame):
        nonlocal cancelled
        cancelled = True

    previous_signals = {kind: signal.signal(kind, interrupted) for kind in (signal.SIGINT, signal.SIGTERM)}
    pid, descriptor = pty.fork()
    if pid == 0:
        os.execve(str(node), [str(node), str(HERE / "native-continuation.mjs")], env)
    prompt = re.compile(rb"To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})")
    try:
        deadline = time.monotonic() + 210
        while time.monotonic() < deadline:
            require(not cancelled, "CHECKOUT_NATIVE_JOURNEY_INTERRUPTED")
            ready, _, _ = select.select([descriptor], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(descriptor, 65536)
                except OSError:
                    chunk = b""
                if chunk:
                    transcript.extend(chunk)
                    require(len(transcript) <= 262144, "CHECKOUT_TERMINAL_OUTPUT_LIMIT")
                    for match in prompt.finditer(transcript, scanned):
                        require(not browser_approval, "BROWSER_FIXTURE_REQUIRES_ORIGINAL_BROKER")
                        require(approvals == 0, "FIXTURE_ALLOWS_ONE_ORIGINAL_APPROVAL")
                        answer_fixture(bytes(transcript[:match.start()]), match.group(1), fixture, expected_intent, job)
                        os.write(descriptor, match.group(1) + b"\n")
                        approvals += 1
                        scanned = match.end()
            ended, value = os.waitpid(pid, os.WNOHANG)
            if ended:
                status = value
                break
        require(status is not None, "CHECKOUT_NATIVE_JOURNEY_TIMEOUT")
        require(os.waitstatus_to_exitcode(status) == 0, "CHECKOUT_NATIVE_JOURNEY_FAILED")
    finally:
        try:
            status = stop_group(pid, status)
        finally:
            try:
                os.close(descriptor)
                immutable(terminal_log, bytes(transcript))
            finally:
                for kind, handler in previous_signals.items():
                    signal.signal(kind, handler)
    summary = json.loads(private_read(fixture / "native-result.json", 1048576))
    require(summary.get("result") == "PASS" and summary.get("operation") == operation,
            "ORIGINAL_CHECKOUT_RESULT_REQUIRED")
    if browser_approval:
        intake = summary.get("selfService", {})
        require(intake.get("reference") == job and intake.get("phase") == "IMPORTED" and
                intake.get("reopened") is True and intake.get("checkoutId") == summary["checkout"]["id"],
                "ORIGINAL_INTAKE_CHECKOUT_RESULT_REQUIRED")
    with sqlite3.connect(fixture / "ledger.sqlite") as ledger:
        reservations = ledger.execute("SELECT request_id, amount, state FROM reservations ORDER BY request_id").fetchall()
        require(reservations == [(expected_intent, "10000", "reserved")], "ORIGINAL_RESERVATION_BINDING_CHANGED")
        journal_rows = ledger.execute("SELECT COUNT(*) FROM journal").fetchone()[0]
        require(ledger.execute("PRAGMA journal_mode").fetchone()[0] == "wal", "ORIGINAL_LEDGER_WAL_REQUIRED")
    sys.path.insert(0, str(SOURCE_ROOT / "sf36-spend-governor"))
    from governor import Governor
    governor = Governor(fixture / "ledger.sqlite", policy, *(base64.b64decode(keys[name]) for name in KEYS))
    try:
        audit = governor.audit()
        require(audit["outcome"] == "JOURNAL_CONSISTENT" and audit["rows"] == 1,
                "ORIGINAL_FIXTURE_LEDGER_AUDIT_CHANGED")
    finally:
        governor.close()
    summary.update({
        "operatorLedger": {"path": str(fixture / "ledger.sqlite"), "reservations": len(reservations),
                           "state": reservations[0][2], "journalRows": journal_rows, "audit": audit["outcome"]},
        "terminal": {"mode": "DISPOSABLE_FIXTURE_PTY", "responsesThisRun": approvals, "log": str(terminal_log)},
        "approvalMode": "ORIGINAL_BROWSER_BROKER" if browser_approval else "ORIGINAL_TERMINAL",
    })
    save(fixture / "native-complete.json", encoded(summary))
    if args.out:
        require(args.out.is_absolute() and args.out.parent.is_dir(), "ABSOLUTE_EXISTING_OUTPUT_PARENT_REQUIRED")
        save(args.out, encoded(summary))
    print(json.dumps(summary, ensure_ascii=True), flush=True)
    os.close(lock)
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Exception as error:
        failed_operation = "SCF-JOB-BROWSER-APPROVAL-0B8D-20261012" if (
            "--approval" in sys.argv and sys.argv.index("--approval") + 1 < len(sys.argv)
            and sys.argv[sys.argv.index("--approval") + 1] == "browser") or "--approval=browser" in sys.argv else OPERATION
        print(json.dumps({"result": "FAILED", "operation": failed_operation,
                          "error": str(error), "errorType": type(error).__name__,
                          "retained": str(Path(sys.argv[sys.argv.index("--retained") + 1]).resolve())
                          if "--retained" in sys.argv else None}), file=sys.stderr, flush=True)
        raise SystemExit(1)

