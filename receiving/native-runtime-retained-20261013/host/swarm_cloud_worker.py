#!/usr/bin/env python3
"""Print a shell profile with this cloud worker's writable build directories.

Source activate-swarm.sh first, then eval the returned exports. Source work and
claims still use the existing swarm-current and swarmctl operations.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import sys


def python_cache_environment():
    """Keep imports and pip installs from duplicating disposable bytecode."""
    values = {"PYTHONDONTWRITEBYTECODE": os.environ.get("PYTHONDONTWRITEBYTECODE", "1")}
    # pip compiles installed sources explicitly, independently of Python's import
    # cache setting. Preserve either explicit pip switch, including empty/false
    # values, rather than imposing a conflicting default on the same option.
    pip_values = {key: os.environ[key] for key in ("PIP_COMPILE", "PIP_NO_COMPILE")
                  if key in os.environ}
    if not pip_values:
        pip_values["PIP_NO_COMPILE"] = "1"
    return {**values, **pip_values}


def profile_values(args, *, create=True):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", args.peer):
        raise ValueError("Use a worker directory name of 1–80 letters, digits, dots, underscores or hyphens.")
    state = Path(os.environ.get("SWARM_STATE_ROOT", "/workspace/shared/swarm")).resolve()
    activated = os.environ.get("COMMONS_PEER") == args.peer
    selected_root = (getattr(args, "worker_root", None)
                     or (os.environ.get("SWARM_WORKER_ROOT") if activated else None))
    root = (Path(selected_root).expanduser().resolve() if selected_root
            else state / "cache" / "workers" / args.peer)
    selected_temp = (getattr(args, "temp_root", None)
                     or (os.environ.get("SWARM_WORKER_TMP_ROOT")
                         if activated and not getattr(args, "worker_root", None) else None))
    temporary = (Path(selected_temp).expanduser().resolve() if selected_temp
                 else root / "tmp")
    # Mutable build state is outside source worktrees. Profiles are shell
    # environment, not a second coordination store.
    values = {"COMMONS_PEER": args.peer, "SWARM_WORKER_ROOT": str(root),
              "SWARM_WORKER_TMP_ROOT": str(temporary)}
    values.update(python_cache_environment())
    for name, relative in (("GRADLE_USER_HOME", "gradle"), ("CARGO_HOME", "cargo"),
                           ("GOPATH", "go"), ("GOCACHE", "cache/go-build"),
                           ("GOMODCACHE", "cache/go-mod"), ("npm_config_cache", "cache/npm"),
                           ("UV_CACHE_DIR", "cache/uv"), ("TMPDIR", "tmp"),
                           ("ANDROID_USER_HOME", "android"), ("XDG_CACHE_HOME", "cache")):
        directory = temporary if name == "TMPDIR" else root / relative
        if create:
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        values[name] = str(directory)
    records = getattr(args, "records_root", None)
    if records:
        values["SWARM_NATIVE_JOBS_ROOT"] = str(Path(records).expanduser().resolve())
    prefixes = []
    if args.java:
        home = os.environ.get("JAVA" + args.java + "_HOME")
        if not home or not (Path(home) / "bin/javac").is_file():
            raise ValueError("JDK " + args.java + " is not installed; run the Android toolchain provisioner.")
        values["JAVA_HOME"] = home
        prefixes.append(str(Path(home) / "bin"))
    if args.node == "18":
        home = os.environ.get("SWARM_NODE18_ROOT")
        if not home or not (Path(home) / "bin/node").is_file():
            raise ValueError("Node 18 is not installed; run the language toolchain provisioner.")
        prefixes.append(str(Path(home) / "bin"))
    elif args.node == "24":
        home = os.environ.get("SWARM_NODE24_BIN")
        if not home or not (Path(home) / "node").is_file():
            raise ValueError("The activation script has no installed Node 24 path.")
        prefixes.append(home)
    # Cargo executables may be shared; target output and mutable cache are owned
    # by this worker. RUSTUP_HOME continues selecting the shared compiler bytes.
    values["CARGO_TARGET_DIR"] = str(root / "cargo-target")
    if create:
        Path(values["CARGO_TARGET_DIR"]).mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.environ.get("SWARM_CARGO_HOME"):
        prefixes.append(str(Path(os.environ["SWARM_CARGO_HOME"]) / "bin"))
    if os.environ.get("GOROOT"):
        prefixes.append(str(Path(os.environ["GOROOT"]) / "bin"))
    return values, prefixes


STORAGE_ROLES = ("source", "installation", "archive", "cache", "case", "logs")


def storage_path_options(parser):
    parser.add_argument("--storage-path", action="append", default=[], metavar="ROLE=PATH",
                        help="name this job's source, installation, archive, cache, case or logs directories")


def storage_paths(values, project):
    """Retain exact caller paths; filesystem and consumer inspection stay native."""
    from runtime_consumers import lexical_path
    rows = set()
    for value in values or ():
        role, separator, path = value.partition("=")
        if not separator or role not in STORAGE_ROLES or not path:
            raise ValueError("Storage paths use source|installation|archive|cache|case|logs=PATH")
        rows.add((role, str(lexical_path(path, project))))
    return [{"role": role, "path": path} for role, path in sorted(rows)]


def placement(values, records_root=None):
    from swarm_cloud_job import runs_root
    return {"worker_root": values["SWARM_WORKER_ROOT"], "temporary_root": values["TMPDIR"],
            "records_root": str(runs_root(records_root or values.get("SWARM_NATIVE_JOBS_ROOT")))}


def storage_report(args, *, values=None):
    from worker_capacity import snapshot
    if values is None:
        values, _ = profile_values(args, create=False)
    locations = placement(values, getattr(args, "records_root", None))
    paths = list(dict.fromkeys(locations.values()))
    return {"schema": "commons.worker_storage/v1", "peer": args.peer,
            "placement": locations,
            "capacity": snapshot(paths, nearest_existing=True,
                                 **storage_diagnostic_values(args, paths))}


def storage_diagnostic_options(parser):
    parser.add_argument("--storage-consumers", action="store_true",
                        help="inspect allocated storage beneath this worker's selected directories")
    parser.add_argument("--process-storage", action="store_true",
                        help="include live process cwd/open-file holders for those directories")
    parser.add_argument("--storage-sample-seconds", type=float, default=0,
                        help="sample matching writes and filesystem changes for 0..30 seconds")


def storage_diagnostic_values(args, paths):
    processes = getattr(args, "process_storage", False)
    seconds = getattr(args, "storage_sample_seconds", 0)
    if not (getattr(args, "storage_consumers", False) or processes or seconds):
        return {}
    return {"storage_roots": list(dict.fromkeys(paths)), "process_storage": processes,
            "storage_sample_seconds": seconds}


def storage_options(parser, *, records=True):
    parser.add_argument("--worker-root", help="explicit private mutable-cache directory for this worker")
    parser.add_argument("--temp-root", help="explicit private temporary directory (default: worker root/tmp)")
    if records:
        parser.add_argument("--records-root", help="native execution records directory; keep it for reconnects")


def profile(args):
    values, prefixes = profile_values(args)
    if args.format == "json":
        print(json.dumps({**storage_report(args, values=values), "environment": values,
                          "path_prefixes": prefixes}, indent=2))
        return
    for name, value in values.items():
        print("export " + name + "=" + shlex.quote(value))
    if prefixes:
        print("export PATH=" + shlex.quote(":".join(prefixes)) + ':"$PATH"')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "placement":
        from native_placement import main as placement_main
        return placement_main(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "browser":
        from swarm_cloud_browser import main as browser_main
        return browser_main(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "stellar-deps":
        from stellar_runtime_dependencies import main as stellar_dependencies_main
        return stellar_dependencies_main(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "node-deps":
        from swarm_cloud_dependencies import main as dependencies_main
        return dependencies_main(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] in ("run", "start", "status", "logs", "stop", "resume-memory", "resume-capacity", "finalize", "list",
                                                          "checkpoint", "checkpoints", "checkpoint-info", "recover-checkpoint",
                                                          "prepare-delivery", "deliver", "deliveries", "delivery-info", "recover-delivery", "download-delivery"):
        from swarm_cloud_job import main as job_main
        return job_main(sys.argv[1:])
    storage_only = len(sys.argv) > 1 and sys.argv[1] == "storage"
    parser = argparse.ArgumentParser(description=("Inspect this worker's selected storage without creating it."
                                                 if storage_only else __doc__))
    parser.add_argument("peer")
    parser.add_argument("--java", choices=("17", "21"))
    parser.add_argument("--node", choices=("18", "24"))
    storage_options(parser)
    if storage_only:
        storage_diagnostic_options(parser)
    else:
        parser.add_argument("--format", choices=("shell", "json"), default="shell")
    args = parser.parse_args(sys.argv[2:] if storage_only else None)
    try:
        if storage_only:
            report = storage_report(args)
            print(json.dumps(report, indent=2))
            return 2 if (any(row["status"] == "error" for row in report["capacity"]["filesystems"])
                         or report["capacity"].get("storage_consumers", {}).get("status") == "error") else 0
        else:
            profile(args)
        return 0
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

