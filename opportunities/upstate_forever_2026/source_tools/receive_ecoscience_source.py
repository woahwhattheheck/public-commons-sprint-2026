#!/usr/bin/env python3
"""Assemble a complete pinned Upper Savannah application and authorized overlays.

The supplied bundle is byte-verified before use. Git source is read from an
existing checkout or fetched into this operation's own repository. Preparation
does not execute application code. --install invokes the maintained cumulative
installer with the untouched canonical scientific source.
"""
from __future__ import annotations

import argparse
import hashlib
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import time

SCHEMA = "upstate.ecoscience-receiving-source/v1"
RECEIPT = "upstate.ecoscience-source-assembly/v1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
GITHEX = re.compile(r"[0-9a-f]{40}\Z")
REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
PROJECT_PREFIX = "opportunities/upstate_forever_2026"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def write_all(stream, data):
    view = memoryview(data)
    while view:
        count = stream.write(view)
        if not isinstance(count, int) or count <= 0 or count > len(view):
            raise OSError("Source write did not retain the complete supplied bytes")
        view = view[count:]


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".pending")
    data = canonical(value) + b"\n"
    with temporary.open("wb") as stream:
        write_all(stream, data)
        stream.flush()
        os.fsync(stream.fileno())
    if regular(temporary).read_bytes() != data:
        raise OSError("Retained JSON differs from the complete supplied bytes: " + str(path))
    os.replace(temporary, path)
    sync_directory(path.parent)


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Source paths must be canonical relative POSIX names")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or str(path) != value:
        raise ValueError("Source path escapes its application: " + value)
    return path


def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected a retained regular file: " + str(path))
    return path


def validated_base(value):
    fields = {"repository", "commit", "prefix", "git_subtree", "files", "declared_bytes"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("Select the complete immutable Git source tuple")
    if value["repository"] != REPOSITORY or value["prefix"] != PROJECT_PREFIX:
        raise ValueError("The receiving source must use the original repository and project prefix")
    for field in ("commit", "git_subtree"):
        if not isinstance(value[field], str) or not GITHEX.fullmatch(value[field]):
            raise ValueError("Supply a full lowercase 40-character Git identity: " + field)
    for field in ("files", "declared_bytes"):
        if type(value[field]) is not int or value[field] <= 0:
            raise ValueError("Supply a positive original Git inventory total: " + field)
    return dict(value)


def load_bundle(path, expected):
    if not HEX.fullmatch(expected):
        raise ValueError("Supply the full lowercase SHA256 of the published source bundle")
    data = regular(Path(path)).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Bundle bytes differ from the published SHA256")
    bundle = json.loads(data)
    if bundle.get("schema") != SCHEMA:
        raise ValueError("Select an " + SCHEMA + " bundle")
    validated_base(bundle.get("base"))
    if not isinstance(bundle.get("components"), list):
        raise ValueError("Retain the ordered component list; use [] for the complete integrated Git edition")
    seen_names = set()
    for component in bundle["components"]:
        name = component.get("name")
        if not isinstance(name, str) or not name or name in seen_names:
            raise ValueError("Component names must be unique nonempty text")
        seen_names.add(name)
        files, metadata = component.get("files"), component.get("file_metadata")
        if not isinstance(files, dict) or not files or not isinstance(metadata, dict) or set(files) != set(metadata):
            raise ValueError("Every component source needs its exact file metadata: " + name)
        for filename, source in files.items():
            relative(filename)
            if not isinstance(source, str):
                raise ValueError("Component source must be complete UTF-8 text: " + filename)
            data = source.encode("utf-8")
            item = metadata[filename]
            if not isinstance(item, dict):
                raise ValueError("Component source metadata must be an object: " + filename)
            if item.get("git_mode", "100644") not in ("100644", "100755"):
                raise ValueError("Component source needs a regular Git file mode: " + filename)
            if item.get("bytes") != len(data) or item.get("sha256") != hashlib.sha256(data).hexdigest():
                raise ValueError("Component source bytes differ: " + name + "/" + filename)
    return bundle


class Operation:
    def __init__(self, output, bundle, bundle_sha256):
        output = Path(output).absolute()
        if output.is_symlink():
            raise ValueError("Use an original operation directory, not a symlink")
        output.parent.mkdir(parents=True, exist_ok=True)
        self.root = output
        self.path = output / "ASSEMBLY.json"
        self.selection = {"schema": SCHEMA, "bundle_sha256": bundle_sha256,
                          "base": bundle["base"]}
        self.identity = digest(self.selection)
        if output.exists():
            if not output.is_dir() or not self.path.is_file() or self.path.is_symlink():
                raise ValueError("Existing output needs its original ASSEMBLY.json receipt")
            self.value = json.loads(self.path.read_text("utf-8"))
            if (self.value.get("schema") != RECEIPT or self.value.get("id") != self.identity
                    or self.value.get("selection") != self.selection):
                raise ValueError("Output is owned by a different retained source operation")
        else:
            output.mkdir()
            self.value = {"schema": RECEIPT, "id": self.identity, "selection": self.selection,
                          "created_at": time.time(), "state": "preparing", "phase": "source",
                          "attempts": []}
            atomic_json(self.path, self.value)
        lock = self.owned(".assembly.lock")
        self.lock_fd = os.open(lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            current = json.loads(self.path.read_text("utf-8"))
            if (current.get("schema") != RECEIPT or current.get("id") != self.identity
                    or current.get("selection") != self.selection):
                raise ValueError("Operation identity changed while acquiring its original lock")
            self.value = current
        except BaseException:
            os.close(self.lock_fd)
            raise
        self.bundle = bundle
        self.base = validated_base(bundle["base"])

    def close(self):
        # Inherited children share this open-file description and retain its flock.
        # Closing only our descriptor releases the lock after the last child exits.
        os.close(self.lock_fd)

    def update(self, **changes):
        if changes.get("state") == "complete":
            self.value.pop("error", None)
        self.value.update(changes, updated_at=time.time())
        atomic_json(self.path, self.value)

    def owned(self, name):
        target = self.root.joinpath(*relative(name).parts)
        if target.is_symlink():
            raise ValueError("Owned operation path became a symlink: " + name)
        return target

    def discard_staging(self, name):
        target = self.owned(name)
        if target.exists():
            if not target.is_dir():
                raise ValueError("Expected an owned staging directory: " + name)
            shutil.rmtree(target)

    def run(self, args, name, *, cwd=None):
        log = self.owned(name)
        with log.open("ab") as stream:
            result = subprocess.run(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                    pass_fds=(self.lock_fd,),
                                    env={**os.environ, "GIT_TERMINAL_PROMPT": "0",
                                         "PYTHONDONTWRITEBYTECODE": "1"})
        if result.returncode:
            raise RuntimeError("Command failed with exit " + str(result.returncode) +
                               "; inspect " + str(log))
        return log


def git_output(repo, arguments):
    process = subprocess.run(["git", "-C", str(repo), *arguments], stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env={**os.environ, "GIT_TERMINAL_PROMPT": "0",
                                         "PYTHONDONTWRITEBYTECODE": "1"})
    if process.returncode:
        raise RuntimeError("Cannot read the pinned Git object: " +
                           process.stderr.decode("utf-8", "replace").strip()[-3000:])
    return process.stdout


def repository(operation, checkout):
    base = operation.base
    if checkout is not None:
        root = Path(checkout).resolve()
        if not root.is_dir():
            raise ValueError("The read-only checkout does not exist")
    else:
        root = operation.owned("git-source")
        if not root.exists():
            operation.run(["git", "init", "--quiet", str(root)], "git-source.log")
            operation.run(["git", "-C", str(root), "remote", "add", "origin",
                           "https://github.com/" + REPOSITORY + ".git"], "git-source.log")
        try:
            known = git_output(root, ["rev-parse", "--verify", base["commit"] + "^{commit}"]).decode().strip()
        except RuntimeError:
            known = None
        if known != base["commit"]:
            operation.run(["git", "-C", str(root), "fetch", "--no-tags", "--depth=1",
                           "--filter=blob:none", "origin", base["commit"]], "git-source.log")
        # Hydrate the project in one sparse-checkout transfer before archive.
        # Only this operation-owned repository is changed; a supplied checkout
        # remains an original read-only source.
        operation.run(["git", "-C", str(root), "sparse-checkout", "init", "--cone"], "git-source.log")
        operation.run(["git", "-C", str(root), "sparse-checkout", "set", base["prefix"]], "git-source.log")
        operation.run(["git", "-C", str(root), "checkout", "--detach", base["commit"]], "git-source.log")
    actual = git_output(root, ["rev-parse", "--verify", base["commit"] + "^{commit}"]).decode().strip()
    tree = git_output(root, ["rev-parse", base["commit"] + ":" + base["prefix"]]).decode().strip()
    if actual != base["commit"] or tree != base["git_subtree"]:
        raise ValueError("Checkout does not contain the exact retained commit and project subtree")
    return root


def git_inventory(repo, base):
    raw = git_output(repo, ["ls-tree", "-r", "-z", "-l", base["commit"] + ":" + base["prefix"]])
    inventory = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        header, filename = record.split(b"\t", 1)
        mode, kind, object_id, size = header.decode("ascii").split()
        name = filename.decode("utf-8")
        relative(name)
        if kind != "blob" or mode not in ("100644", "100755") or not GITHEX.fullmatch(object_id):
            raise ValueError("Unsupported Git member mode in exact source: " + mode + "/" + name)
        if name in inventory:
            raise ValueError("Duplicate Git source path")
        inventory[name] = {"git_blob": object_id, "git_mode": mode, "bytes": int(size)}
    if len(inventory) != base["files"] or sum(row["bytes"] for row in inventory.values()) != base["declared_bytes"]:
        raise ValueError("Git source inventory differs from the complete retained project tree")
    return inventory


def verify_directory(root, inventory, *, ignore_runtime=False):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Missing original source directory: " + str(root))
    seen = set()
    for folder, directories, files in os.walk(root, followlinks=False):
        parent = Path(folder)
        if ignore_runtime:
            directories[:] = [name for name in directories if name not in (".git", "__pycache__")]
        for name in directories:
            if (parent / name).is_symlink():
                raise ValueError("Source contains a directory alias")
        for name in files:
            if ignore_runtime and name.endswith((".pyc", ".pyo")):
                continue
            target = regular(parent / name)
            key = target.relative_to(root).as_posix()
            expected = inventory.get(key)
            if expected is None:
                raise ValueError("Unexpected source file: " + key)
            info = target.stat()
            if info.st_size != expected["bytes"] or file_hash(target) != expected["sha256"]:
                raise ValueError("Retained source changed: " + key)
            mode = "100755" if info.st_mode & 0o111 else "100644"
            if "git_mode" in expected and mode != expected["git_mode"]:
                raise ValueError("Retained source executable status changed: " + key)
            seen.add(key)
    if seen != set(inventory):
        raise ValueError("Source directory lacks retained files")


def canonical_source(operation, checkout):
    base = operation.base
    target = operation.owned("canonical-source")
    manifest_path = operation.owned("canonical-source.inventory.json")
    if target.exists():
        metadata = json.loads(regular(manifest_path).read_text("utf-8"))
        if (metadata.get("commit") != base["commit"] or metadata.get("git_subtree") != base["git_subtree"]
                or metadata.get("files") != base["files"]
                or metadata.get("bytes") != base["declared_bytes"]
                or digest(metadata.get("members")) != metadata.get("inventory_sha256")):
            raise ValueError("Canonical source inventory changed")
        if (operation.value.get("canonical_inventory") is not None
                and operation.value["canonical_inventory"] != metadata["inventory_sha256"]):
            raise ValueError("Canonical manifest differs from the retained operation receipt")
        verify_directory(target, metadata["members"])
        operation.update(phase="canonical", canonical_inventory=metadata["inventory_sha256"])
        return target, metadata["members"]
    repo = repository(operation, checkout)
    expected = git_inventory(repo, base)
    operation.discard_staging("canonical-source.pending")
    staging = operation.owned("canonical-source.pending")
    staging.mkdir()
    actual = {}
    error_log = operation.owned("git-archive.log")
    with error_log.open("ab") as errors:
        process = subprocess.Popen(
            ["git", "-C", str(repo), "archive", "--format=tar", base["commit"] + ":" + base["prefix"]],
            stdout=subprocess.PIPE, stderr=errors, pass_fds=(operation.lock_fd,),
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0",
                                         "PYTHONDONTWRITEBYTECODE": "1"})
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                for member in archive:
                    name = member.name.rstrip("/") if member.isdir() else member.name
                    parts = relative(name).parts
                    destination = staging.joinpath(*parts)
                    if member.isdir():
                        destination.mkdir(parents=True, exist_ok=True)
                        continue
                    record = expected.get(name)
                    if not member.isfile() or record is None or name in actual or member.size != record["bytes"]:
                        raise ValueError("Archive member differs from its original Git blob: " + name)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    sha256 = hashlib.sha256()
                    git_sha = hashlib.sha1(("blob " + str(member.size) + "\0").encode("ascii"))
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError("Missing Git archive member")
                    size = 0
                    with source, destination.open("xb") as output:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            size += len(chunk)
                            write_all(output, chunk)
                            sha256.update(chunk)
                            git_sha.update(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if size != member.size or git_sha.hexdigest() != record["git_blob"]:
                        raise ValueError("Extracted content differs from the pinned Git object: " + name)
                    destination.chmod(0o755 if record["git_mode"] == "100755" else 0o644)
                    actual[name] = {**record, "sha256": sha256.hexdigest()}
            if process.wait() != 0:
                raise RuntimeError("Pinned Git archive failed; inspect " + str(error_log))
        except BaseException:
            process.kill()
            process.wait()
            raise
        finally:
            if process.stdout is not None:
                process.stdout.close()
    if set(actual) != set(expected):
        raise ValueError("Git archive did not supply the entire original project")
    # Verify the bytes actually retained on disk before promoting canonical source.
    verify_directory(staging, actual)
    metadata = {"commit": base["commit"], "git_subtree": base["git_subtree"], "files": len(actual),
                "bytes": sum(item["bytes"] for item in actual.values()),
                "inventory_sha256": digest(actual), "members": actual}
    atomic_json(manifest_path, metadata)
    os.rename(staging, target)
    sync_directory(operation.root)
    operation.update(phase="canonical", canonical_inventory=metadata["inventory_sha256"])
    return target, actual


def prepared_source(operation, canonical_root, canonical_inventory):
    selected = {key: dict(value) for key, value in canonical_inventory.items()}
    overlay, history = {}, []
    for component in operation.bundle["components"]:
        for name, source in component["files"].items():
            encoded = source.encode("utf-8")
            before = selected.get(name)
            mode = component["file_metadata"][name].get(
                "git_mode", before.get("git_mode", "100644") if before else "100644")
            after = {"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest(),
                     "git_mode": mode, "component": component["name"]}
            history.append({"path": name, "component": component["name"],
                            "before_sha256": before.get("sha256") if before else None,
                            "after_sha256": after["sha256"]})
            selected[name] = after
            overlay[name] = encoded
    target = operation.owned("prepared-source")
    manifest_path = operation.owned("prepared-source.inventory.json")
    if target.exists():
        metadata = json.loads(regular(manifest_path).read_text("utf-8"))
        if metadata.get("members") != selected or metadata.get("history") != history:
            raise ValueError("Prepared source belongs to another component order or edition")
        verify_directory(target, selected, ignore_runtime=True)
        operation.update(phase="prepared", prepared_inventory=digest(selected), overlay_files=len(overlay))
        return target, selected
    operation.discard_staging("prepared-source.pending")
    staging = operation.owned("prepared-source.pending")
    shutil.copytree(canonical_root, staging, symlinks=False)
    for name, data in overlay.items():
        path = staging.joinpath(*relative(name).parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and not path.is_file():
            raise ValueError("Overlay file collides with an original source directory: " + name)
        with path.open("wb") as stream:
            write_all(stream, data)
            stream.flush()
            os.fsync(stream.fileno())
        path.chmod(0o755 if selected[name]["git_mode"] == "100755" else 0o644)
    verify_directory(staging, selected)
    atomic_json(manifest_path, {"schema": "upstate.ecoscience-prepared-source/v1",
                "bundle_sha256": operation.selection["bundle_sha256"], "members": selected,
                "inventory_sha256": digest(selected), "history": history})
    os.rename(staging, target)
    sync_directory(operation.root)
    operation.update(phase="prepared", prepared_inventory=digest(selected), overlay_files=len(overlay))
    return target, selected


def scientific_inventory(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError("Scientific source override must be a complete existing directory")
    files = {}
    for directory, folders, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        folders[:] = [name for name in folders if name not in (".git", "__pycache__")]
        if any((parent / name).is_symlink() for name in folders):
            raise ValueError("Scientific source contains a directory alias")
        for name in names:
            if name.endswith((".pyc", ".pyo")):
                continue
            path = regular(parent / name)
            info = path.stat()
            files[path.relative_to(root).as_posix()] = {
                "bytes": info.st_size, "sha256": file_hash(path),
                "git_mode": "100755" if info.st_mode & 0o111 else "100644"}
    if not all(name in files for name in ("model/workspace.py", "model/native.py", "model/common.py")):
        raise ValueError("Scientific source lacks the original native application")
    return root, files


def install(operation, prepared, canonical_root, canonical_inventory, scientific_override):
    if scientific_override is None:
        scientific, inventory = canonical_root, canonical_inventory
    else:
        scientific, inventory = scientific_inventory(scientific_override)
    source_choice = {"path": str(scientific), "inventory_sha256": digest(inventory)}
    saved = operation.value.get("scientific_source")
    if saved is not None and saved != source_choice:
        raise ValueError("The operation's retained scientific source changed")
    operation.update(scientific_source=source_choice)
    application = operation.owned("application")
    archive = operation.owned("application.zip")
    completed = operation.value.get("installed")
    if completed:
        if (not application.is_dir() or file_hash(regular(archive)) != completed["archive_sha256"]):
            raise ValueError("Previously installed application archive changed")
        verify_directory(application, completed["application_inventory"], ignore_runtime=True)
        return completed
    installer = regular(prepared / "source_tools" / "install_cumulative_application.py")
    attempt = len(operation.value["attempts"]) + 1
    failed = operation.owned("previous-attempts")
    # Preserve partial outputs from this exact owned operation before retry.
    for path in (application, archive):
        if path.exists():
            failed.mkdir(exist_ok=True)
            destination = failed / (str(attempt) + "-" + path.name)
            if destination.exists():
                raise ValueError("Prior failed-output preservation path already exists")
            os.rename(path, destination)
    operation.value["attempts"].append({"number": attempt, "state": "running", "started_at": time.time()})
    operation.update(state="installing", phase="native-installer")
    try:
        operation.run(
            [sys.executable, "-B", str(installer), "--source", str(prepared), "--output", str(application),
             "--archive", str(archive), "--scientific-source", str(scientific)],
            "native-installer-" + str(attempt) + ".log", cwd=prepared)
        verify_directory(canonical_root, canonical_inventory)
        if scientific_override is not None:
            _, after_inventory = scientific_inventory(scientific)
            if after_inventory != inventory:
                raise ValueError("Scientific source changed during native installation")
        actual_root, application_inventory = scientific_inventory(application)
        installed = {
            "application": str(actual_root), "archive": str(regular(archive)),
            "archive_bytes": archive.stat().st_size, "archive_sha256": file_hash(archive),
            "application_inventory": application_inventory,
            "application_inventory_sha256": digest(application_inventory),
            "completed_at": time.time(),
        }
        operation.value["attempts"][-1].update(state="complete", completed_at=time.time())
        operation.update(state="complete", phase="done", installed=installed)
        return installed
    except BaseException as exc:
        operation.value["attempts"][-1].update(
            state="interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed",
            error={"type": type(exc).__name__, "message": str(exc)}, completed_at=time.time())
        operation.update(state=operation.value["attempts"][-1]["state"], phase="native-installer")
        raise


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--bundle", type=Path, required=True)
    value.add_argument("--bundle-sha256", required=True)
    value.add_argument("--checkout", type=Path,
                       help="Read an existing Git checkout without changing its files, index or refs")
    value.add_argument("--output", type=Path, required=True, help="New or exact original owned operation directory")
    mode = value.add_mutually_exclusive_group()
    mode.add_argument("--install", action="store_true", help="Invoke the original cumulative application installer")
    mode.add_argument("--prepare-only", action="store_true", help="Prepare source only; this is the default")
    value.add_argument("--scientific-source", type=Path,
                       help="Explicit scientific source override; default is untouched canonical source")
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    operation = None
    try:
        bundle = load_bundle(args.bundle, args.bundle_sha256)
        operation = Operation(args.output, bundle, args.bundle_sha256)
        base = operation.base
        canonical_root, canonical_inventory = canonical_source(operation, args.checkout)
        prepared, prepared_inventory = prepared_source(operation, canonical_root, canonical_inventory)
        result = {"schema": RECEIPT, "id": operation.identity, "output": str(operation.root),
                  "base_commit": base["commit"], "git_subtree": base["git_subtree"],
                  "canonical_source": str(canonical_root), "canonical_files": len(canonical_inventory),
                  "canonical_bytes": sum(row["bytes"] for row in canonical_inventory.values()),
                  "prepared_source": str(prepared), "prepared_files": len(prepared_inventory),
                  "overlay_files": operation.value["overlay_files"], "receipt": str(operation.path)}
        if args.install:
            completed = install(operation, prepared, canonical_root, canonical_inventory, args.scientific_source)
            result.update(state="complete", application=completed["application"], archive=completed["archive"],
                          archive_bytes=completed["archive_bytes"], archive_sha256=completed["archive_sha256"])
        else:
            if not operation.value.get("installed"):
                operation.update(state="prepared", phase="prepared")
            result["state"] = "prepared"
            result["installation_requested"] = False
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except BaseException as exc:
        if operation is not None and operation.value.get("state") not in ("failed", "interrupted"):
            operation.update(state="interrupted" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "failed",
                             error={"type": type(exc).__name__, "message": str(exc)})
        print(json.dumps({"state": "failed", "error": type(exc).__name__, "message": str(exc)}, sort_keys=True),
              file=sys.stderr, flush=True)
        return 130 if isinstance(exc, KeyboardInterrupt) else 1
    finally:
        if operation is not None:
            operation.close()


if __name__ == "__main__":
    raise SystemExit(main())
