#!/usr/bin/env python3
"""Own the unchanged mixed collector and its original parser children."""
from __future__ import annotations
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import application_source_closure as original

def main():
    if len(sys.argv) < 4 or sys.argv[2] != "--":
        raise ValueError("Supply the private attempt directory, --, and original collector arguments")
    directory = Path(sys.argv[1]).resolve(strict=True)
    children = []
    cancelled = None
    spawning = False
    def cancel(number, frame):
        nonlocal cancelled
        if cancelled is None:
            cancelled = number
            if not spawning:
                raise KeyboardInterrupt("Original source parser cancellation")
    class ParserProcesses:
        # Original bridge arguments, process sessions and wait semantics remain intact.
        def __getattr__(self, name):
            return getattr(subprocess, name)
        def Popen(self, *args, **kwargs):
            # Defer cancellation across spawn-to-registration so ownership cannot be lost.
            nonlocal spawning
            spawning = True
            try:
                child = subprocess.Popen(*args, **kwargs)
                children.append(child)
            finally:
                spawning = False
            if cancelled is not None:
                raise KeyboardInterrupt("Original source parser cancellation")
            return child
    def stop(child, number):
        if child.poll() is not None:
            return
        try:
            os.killpg(child.pid, number)
        except ProcessLookupError:
            pass
    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, cancel)
    code = 1
    try:
        # Audit only the original bridge's process factory; no selected application loads.
        original.subprocess = ParserProcesses()
        code = original.main(sys.argv[3:])
    except KeyboardInterrupt:
        code = 130
    finally:
        # Cancellation must not interrupt the final drain, even if it arrived while
        # the original bridge was already unwinding its own finally block.
        for number in (signal.SIGTERM, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        records = []
        for child in children:
            stop(child, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=6)
            except subprocess.TimeoutExpired:
                stop(child, signal.SIGKILL)
                child.wait()
            records.append({"pid": child.pid, "returncode": child.returncode})
        value = {"schema": "commons.application-archive-parser-close.v1",
                 "state": "CLOSED", "pid": os.getpid(), "cancelSignal": cancelled,
                 "children": records, "applicationExecution": False}
        raw = (json.dumps(value, sort_keys=True) + "\n").encode("utf-8")
        pending = directory / "parser-close.pending"
        with pending.open("xb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.link(pending, directory / "parser-close.json")
        os.unlink(pending)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return code

if __name__ == "__main__":
    raise SystemExit(main())
