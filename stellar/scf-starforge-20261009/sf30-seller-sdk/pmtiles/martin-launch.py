#!/usr/bin/env python3
"""MIT. Bind the original native Martin process to its owning operator process."""
import ctypes
import os
import signal
import sys

def main():
    if len(sys.argv) < 4 or sys.platform != "linux":
        raise SystemExit("Usage: martin-launch.py OWNER_PID EXECUTABLE ARG...")
    owner = int(sys.argv[1])
    executable = sys.argv[2]
    if owner <= 1 or not os.path.isabs(executable):
        raise SystemExit("An original process owner and absolute native executable are required.")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Unable to bind native process lifetime")
    if os.getppid() != owner:
        raise SystemExit("The original operator process has already ended.")
    os.execv(executable, sys.argv[2:])

if __name__ == "__main__":
    main()
