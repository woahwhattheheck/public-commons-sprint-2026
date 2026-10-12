"""Run this owner's PHP child; Linux also ends it if the Node owner is killed."""
import ctypes
import os
import signal
import sys

if sys.platform.startswith("linux"):
    parent = os.getppid()
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0):
        raise OSError(ctypes.get_errno(), "Could not bind the PHP child to its owner")
    if parent == 1 or os.getppid() != parent:
        raise SystemExit("The native workspace owner ended before PHP started")
os.execvp(sys.argv[1], sys.argv[1:])
