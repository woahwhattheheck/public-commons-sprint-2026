#!/usr/bin/env python3
"""Open one validated original loopback session in the Windows host browser."""
from pathlib import Path
import shutil
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from source_tools.workbench_session import _session_url

def main(argv=None):
    values = sys.argv[1:] if argv is None else argv
    if len(values) != 1:
        print("The browser helper requires the original local session address.", file=sys.stderr)
        return 1
    try:
        # Accept only the maintained launcher's exact loopback URL shape and token.
        parts, token = _session_url(values[0])
    except (ValueError, TypeError):
        print("The browser helper received an invalid local session address.", file=sys.stderr)
        return 1
    canonical = "http://127.0.0.1:" + str(parts.port) + "/#token=" + token
    powershell = shutil.which("powershell.exe")
    if not powershell:
        print("Windows browser integration is unavailable; use the private address printed by the launcher.", file=sys.stderr)
        return 1
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command",
             "Start-Process -FilePath '" + canonical + "'"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired):
        print("Windows browser opening failed; use the private address printed by the launcher.", file=sys.stderr)
        return 1
    return 0 if result.returncode == 0 else 1

if __name__ == "__main__":
    raise SystemExit(main())
