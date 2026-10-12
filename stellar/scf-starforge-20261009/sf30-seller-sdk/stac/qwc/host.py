# SPDX-License-Identifier: MIT
"""One retained host-file publication with native child and rollback ownership."""
from __future__ import annotations

from contextlib import ExitStack
import copy
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import threading
import time
import uuid

from contract import (need, QwcError, directory, member, measure, read_json, atomic,
                      json_bytes, keep_json, value_hash, copy_file, sync_directory, now)

HOST_MARKER = "starforge-qwc-host.json"


class NativeContext:
    def __init__(self, progress=None):
        self.first_signal = None
        self.child = None
        self.delivered = set()
        self.fds = set()
        self.guard = threading.RLock()
        self.progress = progress

    def checkpoint(self, info=None):
        if self.progress and info is not None:
            self.progress(info)
        if self.first_signal is not None:
            raise QwcError("CANCELLED", "The original publication operation was cancelled.",
                           signal=self.first_signal)

    def stop(self, signum=signal.SIGTERM):
        with self.guard:
            if self.first_signal is None:
                self.first_signal = signum
            self._forward()

    def _forward(self):
        child = self.child
        if self.first_signal is not None and child is not None and child.pid not in self.delivered:
            self.delivered.add(child.pid)
            if child.poll() is None:
                try:
                    child.send_signal(self.first_signal)
                except ProcessLookupError:
                    pass

    def run(self, argv, root, name, *, cwd=None, environment=None):
        self.checkpoint()
        root = directory(root, True)
        stem = member(root, name + ".json", False)
        record = {"schema": "starforge.stac-qwc-native-child.v1", "command": argv,
                  "cwd": str(cwd or Path.cwd()), "startedAt": now(), "phase": "STARTING"}
        atomic(stem, json_bytes(record))
        child = None
        try:
            with ExitStack() as stack:
                out = stack.enter_context(open(root / (name + ".stdout"), "ab", buffering=0))
                error = stack.enter_context(open(root / (name + ".stderr"), "ab", buffering=0))
                child = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                         stdout=out, stderr=error, close_fds=True,
                                         pass_fds=tuple(sorted(self.fds)))
                # The native child inherits the original writer lease. Registration
                # immediately forwards a cancellation recorded during process creation.
                with self.guard:
                    self.child = child
                    self._forward()
                record.update({"phase": "RUNNING", "pid": child.pid})
                atomic(stem, json_bytes(record))
                result = child.wait()
                record.update({"phase": "CLOSED", "exitCode": result, "closedAt": now()})
                atomic(stem, json_bytes(record))
            self.checkpoint()
            need(result == 0, "NATIVE_COMMAND_FAILED",
                 "The original native command returned an incomplete outcome.",
                 name=name, exitCode=result, stderr=str(root / (name + ".stderr")))
            return record
        finally:
            if child is not None:
                if child.poll() is None:
                    with self.guard:
                        if self.first_signal is None:
                            self.first_signal = signal.SIGTERM
                        self.child = child
                        self._forward()
                    # QGIS and ConfigGenerator retain their signal handlers through
                    # native cleanup. Keep the original lease until that child closes.
                    child.wait()
                with self.guard:
                    if self.child is child:
                        self.child = None


def file_state(path):
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        return None
    need(path.is_file() and not path.is_symlink(), "HOST_FILE_CHANGED",
         "The selected host target is no longer an ordinary file.", path=str(path))
    observed = path.stat()
    return {**measure(path), "mode": stat.S_IMODE(observed.st_mode), "gid": observed.st_gid}


def same_file(actual, expected):
    if actual is None or expected is None:
        return actual is expected
    return all(actual.get(k) == expected.get(k) for k in ("bytes", "sha256", "mode", "gid"))


def read_pointer(namespace):
    target = Path(namespace) / "current"
    if not target.exists() and not target.is_symlink():
        return None
    need(target.is_symlink(), "HOST_POINTER_CHANGED",
         "The managed current project must remain its original directory link.")
    value = os.readlink(target)
    need(value.startswith("releases/") and len(value.split("/")) == 2 and
         len(value.split("/")[1]) == 64 and all(c in "0123456789abcdef" for c in value.split("/")[1]),
         "HOST_POINTER_CHANGED", "The current project points outside its retained release set.")
    need((Path(namespace) / value).is_dir() and not (Path(namespace) / value).is_symlink(),
         "HOST_RELEASE_MISSING", "The current native project release is missing.")
    return value


def set_pointer(namespace, expected, target):
    namespace = directory(namespace)
    actual = read_pointer(namespace)
    if actual == target:
        sync_directory(namespace)
        return
    need(actual == expected, "HOST_POINTER_REVISION",
         "Another publication changed the current project.", expected=expected, actual=actual)
    path = namespace / "current"
    if target is None:
        path.unlink()
        sync_directory(namespace)
        return
    need(target.startswith("releases/") and (namespace / target / "project.qgz").is_file(),
         "HOST_RELEASE_MISSING", "Retain the complete native project before selecting it.")
    temporary = namespace / (".qwc-current-" + uuid.uuid4().hex)
    try:
        os.symlink(target, temporary, target_is_directory=True)
        need(read_pointer(namespace) == expected, "HOST_POINTER_REVISION",
             "The current project changed before publication.")
        os.replace(temporary, path)
        sync_directory(namespace)
    finally:
        temporary.unlink(missing_ok=True)


def ensure_namespace(profile, workspace_id):
    resources = directory(profile["qgisResourcesRoot"])
    namespace = resources
    for part in profile["mapPrefix"].split("/"):
        namespace /= part
        need(not namespace.is_symlink(), "HOST_NAMESPACE_SYMLINK",
             "Choose an ordinary managed project namespace.")
    if not namespace.exists():
        namespace.mkdir(parents=True, mode=0o700)
    expected = {"schema": "starforge.stac-qwc-host-owner.v1", "workspaceId": workspace_id,
                "hostId": profile["id"], "themeId": profile["themeId"], "mapPrefix": profile["mapPrefix"]}
    marker = namespace / HOST_MARKER
    if not marker.exists():
        need(not any(namespace.iterdir()), "HOST_NAMESPACE_ALREADY_USED",
             "Choose a new project namespace or reopen its existing publication workspace.")
        keep_json(marker, expected)
    else:
        actual, _ = read_json(marker)
        need(actual == expected, "HOST_NAMESPACE_OWNER_CHANGED",
             "The selected host project belongs to a different original publication workspace.")
    return namespace


def expose_release(namespace, release, profile):
    """Use the existing QGIS resource directory's native access mode/group."""
    base = Path(profile["qgisResourcesRoot"]).stat()
    directory_mode = stat.S_IMODE(base.st_mode) | 0o700
    file_mode = (directory_mode & 0o666) | 0o600
    namespace, release = directory(namespace), directory(release)
    need(release.parent == namespace / "releases", "RELEASE_LOCATION_CHANGED",
         "Keep the complete project in its original managed release directory.")
    parents = []
    current = namespace
    resources = directory(profile["qgisResourcesRoot"])
    while current != resources:
        parents.append(current)
        current = current.parent
    parents += [namespace / "releases"]
    for path in parents:
        os.chmod(path, directory_mode)
        if path.stat().st_gid != base.st_gid:
            os.chown(path, -1, base.st_gid)
    for parent, dirs, files in os.walk(release, followlinks=False):
        path = Path(parent)
        need(not path.is_symlink(), "RELEASE_SYMLINK", "Keep the release self-contained.")
        os.chmod(path, directory_mode)
        if path.stat().st_gid != base.st_gid:
            os.chown(path, -1, base.st_gid)
        for name in files:
            target = path / name
            need(not target.is_symlink(), "RELEASE_SYMLINK", "Keep the release self-contained.")
            os.chmod(target, file_mode)
            if target.stat().st_gid != base.st_gid:
                os.chown(target, -1, base.st_gid)


def target_root(profile, family):
    if family == "input":
        return directory(profile["inputRoot"])
    if family == "viewer":
        return directory(profile["viewerRoot"])
    need(family == "generated", "HOST_TARGET_FAMILY", "Use the original native deployment file family.")
    return directory(Path(profile["generatedConfigRoot"]) / profile["tenant"], True)


def plan_changes(operation, profile, baseline, generation):
    operation = directory(operation)
    result = []
    before_maps = {family: {x["path"]: x for x in baseline[family]} for family in ("input", "viewer", "generated")}
    source_rows = [
        ("input", profile["themeInput"], "planned-theme.json", measure(operation / "planned-theme.json"))
    ]
    for row in generation["deploymentFiles"]:
        source_rows.append(("generated", row["path"], "generation/deployment/" + row["path"], row))
    for row in generation["viewerFiles"]:
        prior = before_maps["viewer"].get(row["path"])
        if prior is None or prior["sha256"] != row["sha256"] or prior["bytes"] != row["bytes"]:
            source_rows.append(("viewer", row["path"], "candidate/viewer/" + row["path"], row))
    for family, path, source, row in source_rows:
        before = copy.deepcopy(before_maps[family].get(path))
        root = target_root(profile, family)
        mode = before["mode"] if before else ((stat.S_IMODE(root.stat().st_mode) & 0o666) | 0o600)
        after = {"bytes": row["bytes"], "sha256": row["sha256"], "mode": mode,
                 "gid": before["gid"] if before else root.stat().st_gid}
        if before and same_file(before, after):
            continue
        result.append({"family": family, "path": path, "before": before, "after": after,
                       "source": source, "backup": "baseline/" + family + "/" + path if before else None})
    need(len({(x["family"], x["path"]) for x in result}) == len(result),
         "DEPLOYMENT_FILE_COLLISION", "A native output collides with another selected host file.")
    return result


def apply_change(operation, profile, change, *, rollback=False):
    root = target_root(profile, change["family"])
    target = member(root, change["path"], False)
    before = change["after"] if rollback else change["before"]
    after = change["before"] if rollback else change["after"]
    current = file_state(target)
    if same_file(current, after):
        parent = target.parent
        while not parent.exists() and parent != root:
            parent = parent.parent
        sync_directory(parent)
        return
    need(same_file(current, before), "HOST_FILE_REVISION",
         "A selected host file changed outside this publication operation.",
         family=change["family"], path=change["path"], expected=before, actual=current)
    if after is None:
        target.unlink()
        sync_directory(target.parent)
        return
    source_name = change["backup"] if rollback else change["source"]
    source = member(operation, source_name)
    selected_root = root.stat()
    missing = []
    parent = target.parent
    while parent != root and not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for parent in reversed(missing):
        temporary = parent.parent / (".qwc-directory-" + uuid.uuid4().hex)
        try:
            temporary.mkdir(mode=0o700)
            if temporary.stat().st_gid != selected_root.st_gid:
                os.chown(temporary, -1, selected_root.st_gid)
            os.chmod(temporary, stat.S_IMODE(selected_root.st_mode) | 0o700)
            sync_directory(temporary)
            need(not parent.exists() and not parent.is_symlink(), "HOST_DIRECTORY_CHANGED",
                 "The selected native target directory changed before publication.", path=str(parent))
            os.rename(temporary, parent)
            sync_directory(parent.parent)
        finally:
            if temporary.exists():
                temporary.rmdir()
    need(same_file(file_state(target), before), "HOST_FILE_REVISION",
         "The reviewed host file changed before its atomic publication.",
         family=change["family"], path=change["path"])
    # Publish the complete mode/group/byte postimage in one atomic link or rename.
    copy_file(source, target, after, replace=target.exists(), mode=after["mode"], gid=after["gid"])
    need(same_file(file_state(target), after), "HOST_FILE_REOPEN",
         "The published native file did not reopen to its original postimage.",
         family=change["family"], path=change["path"])


def verify_changes(profile, changes, rollback=False):
    for change in changes:
        expected = change["before"] if rollback else change["after"]
        actual = file_state(member(target_root(profile, change["family"]), change["path"], False))
        need(same_file(actual, expected), "HOST_DELIVERY_CHANGED",
             "The selected host file differs from this completed publication.",
             family=change["family"], path=change["path"])


def check_baseline(profile, baseline, *, files_only=False):
    for family in ("input", "viewer", "generated"):
        root = target_root(profile, family)
        for row in baseline[family]:
            actual = file_state(member(root, row["path"], False))
            need(same_file(actual, row), "HOST_REVIEW_CHANGED",
                 "The selected native host changed since this publication was prepared.",
                 family=family, path=row["path"])
        if not files_only:
            actual_names = set()
            for parent, dirs, files in os.walk(root, followlinks=False):
                for name in dirs:
                    need(not (Path(parent) / name).is_symlink(), "HOST_REVIEW_CHANGED",
                         "The selected native host acquired a linked directory.")
                actual_names.update((Path(parent) / name).relative_to(root).as_posix() for name in files)
            need(actual_names == {x["path"] for x in baseline[family]},
                 "HOST_REVIEW_FILE_SET_CHANGED", "The selected native host file set changed since review.",
                 family=family)
