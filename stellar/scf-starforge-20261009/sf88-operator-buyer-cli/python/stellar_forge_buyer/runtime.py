"""Bounded subprocess calls to the existing SF88 CLI, with native cancellation."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import time

from .errors import NativeError, StateError
from .storage import parse

CLI = Path("stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs")
BRIDGE = CLI.parent / "python" / "bridge.mjs"
DATASET_BRIDGE = CLI.parent / "python" / "dataset-bridge.mjs"
APPLICATIONS = {
    "application": BRIDGE,
    "dataset": DATASET_BRIDGE,
    "object": CLI.parent / "python" / "object-bridge.mjs",
}


@dataclass(frozen=True)
class Run:
    returncode: int
    output: dict | None
    error: str | None
    interrupted: bool = False


class Runtime:
    def __init__(self, checkout, *, node="node", environment=None, timeout=360, output_limit=2_097_152):
        self.checkout = Path(checkout).expanduser().resolve()
        self.cli = self.checkout / CLI
        self.node = shutil.which(os.fspath(node))
        if not self.node or not self.cli.is_file():
            raise StateError("ORIGINAL_NODE_RUNTIME_REQUIRED")
        if not 1 <= timeout <= 3600 or not 8192 <= output_limit <= 16_777_216:
            raise StateError("RUNTIME_LIMIT_INVALID")
        self.environment = None if environment is None else dict(environment)
        self.timeout = timeout
        self.output_limit = output_limit

    def run(self, arguments, *, logs: Path | None = None, started=None, target="buyer") -> Run:
        if target != "buyer" and target not in APPLICATIONS:
            raise StateError("ORIGINAL_RUNTIME_TARGET_INVALID")
        entry = self.cli if target == "buyer" else self.checkout / APPLICATIONS[target]
        if not entry.is_file():
            raise StateError("ORIGINAL_APPLICATION_RUNTIME_REQUIRED")
        # Keep the controlling terminal. SF81/SF62 opens /dev/tty itself; this
        # wrapper never synthesizes answers or replaces the native approval.
        stdout = bytearray()
        stderr = bytearray()
        process = None
        selector = selectors.DefaultSelector()
        log_files = {}
        interruption = None
        deadline = time.monotonic() + self.timeout
        kill_at = None
        try:
            if logs:
                for name in ("stdout", "stderr"):
                    fd = os.open(logs / (name + ".json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    log_files[name] = os.fdopen(fd, "wb", buffering=0)
            try:
                process = subprocess.Popen([self.node, str(entry), *map(str, arguments)],
                    cwd=self.checkout, env=self.environment, shell=False,
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except OSError:
                raise NativeError("NATIVE_PROCESS_START_FAILED") from None
            if started:
                started(process.pid)
            for stream, name in ((process.stdout, "stdout"), (process.stderr, "stderr")):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map() or process.poll() is None:
                try:
                    now = time.monotonic()
                    if now >= deadline and interruption is None:
                        interruption = "NATIVE_TIMEOUT"
                    if interruption and kill_at is None:
                        if process.poll() is None:
                            process.send_signal(signal.SIGTERM)
                        kill_at = now + 15
                    if kill_at is not None and now >= kill_at:
                        if process.poll() is None:
                            process.kill()
                        # Descendants cannot keep an abandoned output pipe open.
                        for key in list(selector.get_map().values()):
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                        break
                    for key, _ in selector.select(0.1):
                        chunk = os.read(key.fd, 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            key.fileobj.close()
                            continue
                        target = stdout if key.data == "stdout" else stderr
                        left = self.output_limit - len(target)
                        target.extend(chunk[:max(0, left)])
                        if logs and left > 0:
                            log_files[key.data].write(chunk[:left])
                        if len(chunk) > left:
                            interruption = "NATIVE_OUTPUT_LIMIT"
                except KeyboardInterrupt:
                    interruption = "NATIVE_INTERRUPTED"
            code = process.wait(timeout=5)
            output = self._object(stdout)
            error_record = self._object(stderr)
            error = error_record.get("error") if error_record else None
            if not isinstance(error, str) or not re.fullmatch(r"[A-Z0-9_]{1,120}", error):
                error = None
            if output is None and not error:
                error = "NATIVE_RESULT_INVALID"
            return Run(code, output, interruption or error, interruption is not None)
        finally:
            selector.close()
            if process:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                for stream in (process.stdout, process.stderr):
                    if stream and not stream.closed:
                        stream.close()
            for stream in log_files.values():
                os.fsync(stream.fileno())
                stream.close()

    @staticmethod
    def _object(raw):
        try:
            value = parse(bytes(raw))
            return value if isinstance(value, dict) else None
        except StateError:
            return None

    def checked(self, arguments, *, mode: str, target="buyer") -> dict:
        result = self.run(arguments, target=target)
        if result.returncode or result.error or result.output is None or result.output.get("mode") != mode:
            raise NativeError(result.error or "NATIVE_COMMAND_FAILED", returncode=result.returncode)
        return result.output
