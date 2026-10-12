"""Invoke the installed original PostgreSQL CLI with its complete process owner."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading

from stellar_forge_buyer.processes import cancellation, run_owned


def _watch_parent():
    # Node retains this dedicated write end for this invocation. EOF means the
    # original operator exited; cancellation unwinds the maintained owner.
    try:
        while os.read(3, 1):
            pass
    except OSError:
        pass
    os.kill(os.getpid(), signal.SIGTERM)


def main():
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("The native command selection exceeds 64 KiB.")
    selection = json.loads(raw.decode("utf-8"))
    if not isinstance(selection, dict) or set(selection) != {"arguments", "timeout_seconds"}:
        raise ValueError("Use the complete original command selection.")
    arguments, timeout = selection["arguments"], selection["timeout_seconds"]
    if (not isinstance(arguments, list) or not arguments or
            any(not isinstance(x, str) or "\x00" in x for x in arguments) or
            type(timeout) not in (int, float) or not 1 <= timeout <= 86400):
        raise ValueError("Use native string arguments and an explicit command timeout.")
    command = [sys.executable, "-B", "-m", "stellar_forge_buyer.postgres_cli", *arguments]
    with cancellation():
        watcher = threading.Thread(target=_watch_parent, daemon=True)
        watcher.start()
        try:
            result = run_owned(command, timeout=timeout, text=False)
        except subprocess.TimeoutExpired as error:
            sys.stdout.buffer.write(error.stdout or b"")
            sys.stderr.buffer.write(error.stderr or b"")
            sys.stderr.buffer.write(b'\n{"error":"CENTRAL_WAREHOUSE_COMMAND_TIMEOUT","recovery":"resume the same original request"}\n')
            return 124
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, UnicodeError):
        sys.stderr.write('{"error":"CENTRAL_WAREHOUSE_NATIVE_SELECTION"}\n')
        raise SystemExit(2)
    except (OSError, RuntimeError):
        sys.stderr.write('{"error":"CENTRAL_WAREHOUSE_NATIVE_RUNTIME","recovery":"reopen the installed original Python operator"}\n')
        raise SystemExit(2)
