#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build the unchanged original Hive Rust fixture once in its selected checkout."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from .prepare import (UPSTREAM_COMMIT, UPSTREAM_REPOSITORY, REFERENCE,
                      encoded, identity, no_symlinks, publish, read_stable,
                      selected_fixture, sync_directory)

SCHEMA = "hive-desk-original-fixture-build/v1"


def absolute_program(value):
    selected = shutil.which(str(value)) if not os.path.isabs(str(value)) else str(value)
    if not selected or not os.path.isfile(selected):
        raise ValueError("Select an existing original runtime executable: " + str(value))
    return os.path.abspath(selected)


def write_json(path, value):
    import tempfile
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encoded(value)); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path); sync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def source_state(upstream, git):
    def read(*args):
        return subprocess.check_output([git, "--no-replace-objects", *args],
            cwd=upstream, env={**os.environ, "GIT_NO_LAZY_FETCH": "1"},
            text=True, stderr=subprocess.STDOUT)
    head = read("rev-parse", "HEAD").strip()
    if head != UPSTREAM_COMMIT:
        raise ValueError("Build requires the complete original pinned Hive checkout")
    status = read("status", "--porcelain", "--untracked-files=no")
    if status:
        raise ValueError("Original tracked Hive source has local changes")
    tree = read("rev-parse", "HEAD^{tree}").strip()
    return {"commit": head, "tree": tree, "tracked_status": status}


def build(upstream, output, *, cargo="cargo", rustc="rustc", git="git"):
    upstream, output = Path(upstream).absolute(), Path(output).absolute()
    no_symlinks(upstream); no_symlinks(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    cargo, rustc, git = map(absolute_program, (cargo, rustc, git))
    selected, manifest_raw, _ = selected_fixture(upstream, REFERENCE / "FIXTURE-SOURCE.json")
    initial_source = source_state(upstream, git)
    source_binding = identity(manifest_raw)
    env = dict(os.environ)
    # These optional wrappers/flags would alter the selected original build.
    # Original checked-in Cargo settings and its unchanged lock remain active.
    for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTC_WRAPPER",
                "RUSTC_WORKSPACE_WRAPPER"):
        env.pop(key, None)
    env.update({"CARGO_TARGET_DIR": str(output / "target"), "CARGO_INCREMENTAL": "0",
                "RUSTC": rustc})
    rust = subprocess.check_output([rustc, "--version", "--verbose"], cwd=upstream,
                                   env=env, text=True, stderr=subprocess.STDOUT)
    if "release: 1.98.1" not in rust.splitlines():
        raise ValueError("Select the original rust-toolchain.toml release 1.98.1")
    cargo_version = subprocess.check_output([cargo, "--version", "--verbose"],
        cwd=upstream, env=env, text=True, stderr=subprocess.STDOUT)
    argv = [cargo, "build", "--locked", "--release", "-p", "subgraphs"]
    binding = {"repository": UPSTREAM_REPOSITORY, "commit": UPSTREAM_COMMIT,
        "source_manifest": source_binding, "checkout": str(upstream),
        "source_state": initial_source, "argv": argv, "cwd": str(upstream),
        "target_directory": env["CARGO_TARGET_DIR"], "rustc": rustc,
        "rustc_version": rust, "cargo_version": cargo_version}
    lock = os.open(output / "build.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        publish(output / "selection.json", encoded(binding))
        ready = output / "fixture-ready.json"
        if ready.exists():
            result = json.loads(read_stable(ready, 1024 * 1024))
            if result.get("schema") != SCHEMA or result.get("selection") != binding:
                raise ValueError("Saved fixture build selection differs")
            binary = Path(result["binary"]["path"])
            observed = identity(read_stable(binary, result["binary"]["bytes"]))
            if any(result["binary"].get(k) != observed[k] for k in observed):
                raise ValueError("Saved original fixture binary changed")
            return result
        # A surviving Cargo/compiler child retains this exact lock after
        # controller loss; reacquisition proves that its lifetime has ended.
        attempts_path = output / "attempts.json"
        attempts = json.loads(read_stable(attempts_path, 4 * 1024 * 1024)) if attempts_path.exists() else []
        attempt = {"attempt": len(attempts) + 1, "argv": argv, "started_at": time.time(),
                   "state": "prepared", "log": "cargo-%04d.log" % (len(attempts) + 1)}
        attempts.append(attempt); write_json(attempts_path, attempts)
        process = None
        with (output / attempt["log"]).open("ab") as log:
            try:
                process = subprocess.Popen(argv, cwd=upstream, env=env, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT, pass_fds=(lock,))
                attempt.update({"pid": process.pid, "state": "running"})
                # Always drain/reap the original process even if this optional
                # post-Popen journal publication fails.
                publication_error = None
                try:
                    write_json(attempts_path, attempts)
                except Exception as error:
                    publication_error = error
                code = process.wait()
                log.flush(); os.fsync(log.fileno())
                attempt.update({"exit_code": code, "ended_at": time.time(),
                                "state": "complete" if code == 0 else "failed"})
                write_json(attempts_path, attempts)
                if publication_error is not None:
                    raise publication_error
                if code != 0:
                    raise RuntimeError("Original Cargo build failed; retain " + str(output / attempt["log"]))
            finally:
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
                log.flush(); os.fsync(log.fileno())
        if source_state(upstream, git) != initial_source:
            raise ValueError("Original source changed during Cargo build")
        selected_fixture(upstream, REFERENCE / "FIXTURE-SOURCE.json")
        binary = output / "target" / "release" / "subgraphs"
        body = read_stable(binary, 1024 * 1024 * 1024)
        result = {"schema": SCHEMA, "selection": binding,
                  "binary": {"path": str(binary), **identity(body)},
                  "completed_at": time.time(), "build_attempt": attempt,
                  "source_manifest": source_binding, "subgraphs": selected["subgraphs"]}
        publish(ready, encoded(result))
        return result
    finally:
        os.close(lock)


def validate_ready(path, upstream):
    result = json.loads(read_stable(Path(path).absolute(), 1024 * 1024))
    selected, raw, _ = selected_fixture(Path(upstream).absolute(), REFERENCE / "FIXTURE-SOURCE.json")
    selection = result.get("selection", {})
    if (result.get("schema") != SCHEMA or selection.get("repository") != UPSTREAM_REPOSITORY
            or selection.get("commit") != UPSTREAM_COMMIT
            or result.get("source_manifest") != identity(raw)
            or selection.get("source_manifest") != identity(raw)
            or result.get("subgraphs") != selected["subgraphs"]
            or selection.get("argv", [])[1:] != ["build", "--locked", "--release", "-p", "subgraphs"]
            or "release: 1.98.1" not in selection.get("rustc_version", "").splitlines()
            or result.get("build_attempt", {}).get("exit_code") != 0):
        raise ValueError("Select the completed unchanged original fixture build receipt")
    binary = Path(result["binary"]["path"]).absolute()
    observed = identity(read_stable(binary, result["binary"]["bytes"]))
    if any(result["binary"].get(k) != observed[k] for k in observed) or not os.access(binary, os.X_OK):
        raise ValueError("Original fixture executable differs from its build receipt")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cargo", default="cargo")
    parser.add_argument("--rustc", default="rustc")
    parser.add_argument("--git", default="git")
    args = parser.parse_args()
    os.umask(0o077)
    value = build(args.upstream, args.output, cargo=args.cargo, rustc=args.rustc, git=args.git)
    print(json.dumps({"fixture_ready": str(args.output.absolute() / "fixture-ready.json"),
                      "binary": value["binary"], "subgraphs": value["subgraphs"]},
                     separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
