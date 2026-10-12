#!/usr/bin/env python3
"""Run the released Central fixture, original receiver and two-period commissioner."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys

OPERATION = "SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012"

def read_json(path, private=False):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > 1024 * 1024:
        raise ValueError("Use the original regular host configuration or connection file.")
    if private and info.st_mode & 0o077:
        raise ValueError("Keep the original connection-secret file private.")
    return json.loads(path.read_text(encoding="utf-8"))

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host-config", required=True)
    parser.add_argument("--work-directory", required=True)
    parser.add_argument("--node", default="node", help="Existing Node runtime with the installed StarForge dependencies.")
    parser.add_argument("--operation", default=OPERATION)
    parser.add_argument("--project", help="Explicit existing native project ID; omitted creates the retained operation's project.")
    args = parser.parse_args(argv)
    configuration = read_json(args.host_config, private=True)
    if configuration.get("schema") != "stellar-forge.odk-central-host.v1" or configuration.get("operation_id") != args.operation:
        raise ValueError("Use the original selected Central host and receiving operation.")
    host = Path(configuration["directory"]).resolve()
    connection_path = host / "connection.json"
    connection = read_json(connection_path)
    reference = configuration["auth_env"]
    if connection.get("authEnv") != reference or connection.get("id") != configuration["compose_project"]:
        raise ValueError("The original host connection binding differs.")
    credentials = read_json(host / "connection-secret.json", private=True)
    if set(credentials) != {reference} or not isinstance(credentials[reference], str) or not credentials[reference]:
        raise ValueError("Keep the original complete Authorization header in its private host custody.")
    if "\r" in credentials[reference] or "\n" in credentials[reference]:
        raise ValueError("The original Authorization header contains a line break.")
    environment = dict(os.environ)
    environment[reference] = credentials[reference]
    ca = host / "tls" / "ca.pem" if configuration["mode"] == "local" else configuration.get("tls", {}).get("ca")
    if ca:
        ca = Path(ca).resolve()
        if not ca.is_file():
            raise ValueError("The original selected Central CA file is missing.")
        # Node reads this variable at process startup, before the receiver imports HTTP clients.
        environment["NODE_EXTRA_CA_CERTS"] = str(ca)
    work = Path(args.work_directory).resolve()
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = work.lstat()
    if not stat.S_ISDIR(info.st_mode) or work.is_symlink() or info.st_mode & 0o077:
        raise ValueError("Use one private retained fixture/receiving directory.")
    runtime = shutil.which(args.node)
    if runtime is None:
        raise ValueError("Select the existing installed Node/StarForge runtime for this host.")
    entry = Path(__file__).resolve().with_name("run-released-fixtures.mjs")
    if not entry.is_file():
        raise ValueError("Keep the complete published receiving source beside this launcher.")
    command = [runtime, str(entry), "--connection", str(connection_path),
               "--directory", str(work / "provider"),
               "--workspace", str(work / "workspace"),
               "--output", str(work / "receiving"),
               "--restore", str(work / "restored-workspace"),
               "--operation", args.operation]
    if args.project:
        command.extend(["--project", args.project])
    print(json.dumps({"operation_id": args.operation, "phase": "ORIGINAL_RECEIVING",
                      "connection": str(connection_path), "directory": str(work / "provider"),
                      "receiving_request": str(work / "provider" / "receiving-request.json")}), flush=True)
    child = None
    previous_handlers = {}

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    try:
        for signum in (signal.SIGTERM, signal.SIGHUP):
            previous_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, interrupted)
        child = subprocess.Popen(command, env=environment, start_new_session=True)
        return child.wait()
    except BaseException:
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
        raise
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)

if __name__ == "__main__":
    try:
        result = main()
        raise SystemExit(result if result >= 0 else 128 - result)
    except (OSError, ValueError) as error:
        print(json.dumps({"error": str(error), "phase": "ORIGINAL_RECEIVING_SETUP"}), file=sys.stderr)
        raise SystemExit(1)
