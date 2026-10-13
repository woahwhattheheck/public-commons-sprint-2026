#!/usr/bin/env python3
"""Reuse explicitly requested source blobs through the original source importer."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile

try:
    from host import connected_github_source as importer
except ModuleNotFoundError:
    import connected_github_source as importer

SCHEMA = "commons.source-reuse.v1"
SELECTION_SCHEMA = "commons.github-source-selection.v1"
REQUEST_SCHEMA = "commons.source-request.v1"
ACQUISITION_SCHEMA = "commons.source-acquisition.v1"
CHUNK = 256 * 1024
HEX40 = re.compile(r"^[0-9a-fA-F]{40}$")


class ReuseError(ValueError):
    def __init__(self, code, detail, path=None):
        self.code, self.detail, self.path = code, detail, path
        super().__init__(detail)


def _path(value):
    if (not isinstance(value, str) or not value or value.startswith("/")
            or "\\" in value or "\0" in value
            or any(part in ("", ".", "..") for part in value.split("/"))
            or ":" in value.split("/")[0]):
        raise ReuseError("SOURCE_PATH", "Use a relative repository file path without traversal.")
    return value


def _sha(value, label):
    if not isinstance(value, str) or not HEX40.fullmatch(value):
        raise ReuseError("SOURCE_SHA", label + " must be a complete Git object SHA.")
    return value.lower()


def _repository(value):
    if (not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value)
            or any(part in (".", "..") for part in value.split("/"))):
        raise ReuseError("SOURCE_REPOSITORY", "Use an explicit owner/repository name.")
    return value


def _metadata_payload(response, kind):
    """Read captured native or REST metadata envelopes without guessing source text."""
    pending = [response]
    for _ in range(64):
        if not pending:
            break
        value = pending.pop(0)
        if not isinstance(value, dict):
            continue
        if value.get("isError") is True or value.get("ok") is False:
            raise ReuseError("SOURCE_TOOL_ERROR", "The captured metadata operation failed.")
        nested_commit = value.get("commit") if isinstance(value.get("commit"), dict) else {}
        if isinstance(value.get("sha"), str) and (
                kind == "tree" and isinstance(value.get("tree"), list)
                or kind == "commit" and (isinstance(value.get("tree"), dict)
                                        or isinstance(nested_commit.get("tree"), dict))):
            return value
        for key in ("structuredContent", "data", "result", "commit"):
            if isinstance(value.get(key), dict):
                pending.append(value[key])
        content = value.get("content")
        texts = [content] if isinstance(content, str) else []
        if isinstance(content, list):
            texts.extend(block["text"] for block in content if isinstance(block, dict)
                         and block.get("type") == "text" and isinstance(block.get("text"), str))
        for text in texts:
            try:
                decoded = json.loads(text)
            except (ValueError, RecursionError):
                continue
            if isinstance(decoded, dict):
                pending.append(decoded)
    raise ReuseError("SOURCE_METADATA_SHAPE", "No captured Git " + kind + " object was found.")


def select_tree_sources(selection):
    """Bind explicit file/subtree selection to captured original commit/tree identities."""
    if not isinstance(selection, dict) or selection.get("schema") != SELECTION_SCHEMA:
        raise ReuseError("SOURCE_SELECTION", "Use a commons.github-source-selection.v1 object.")
    repository = _repository(selection.get("repository"))
    commit = _sha(selection.get("commit"), "commit")
    paths = selection.get("paths")
    if not isinstance(paths, list) or not paths:
        raise ReuseError("SOURCE_SELECTION", "Select at least one exact file or subtree path.")
    selected = sorted(set("." if value == "." else _path(value.rstrip("/") if isinstance(value, str) else value)
                          for value in paths))
    original_commit = _metadata_payload(selection.get("commit_response"), "commit")
    if _sha(original_commit["sha"], "returned commit") != commit:
        raise ReuseError("SOURCE_COMMIT_MISMATCH", "The captured commit differs from the requested commit.")
    commit_tree = original_commit.get("tree") or original_commit.get("commit", {}).get("tree")
    expected_tree = _sha(commit_tree.get("sha"), "commit tree")
    tree = _metadata_payload(selection.get("tree_response"), "tree")
    if _sha(tree["sha"], "returned tree") != expected_tree:
        raise ReuseError("SOURCE_TREE_MISMATCH", "The tree is not the requested commit's root tree.")
    if tree.get("truncated") is not False:
        raise ReuseError("SOURCE_TREE_INCOMPLETE", "Retain a complete tree response with truncated:false.")
    rows, children = {}, {}
    for entry in tree["tree"]:
        if not isinstance(entry, dict):
            raise ReuseError("SOURCE_TREE_ENTRY", "A tree entry is not an object.")
        name = _path(entry.get("path"))
        mode, kind = entry.get("mode"), entry.get("type")
        valid = {"040000": "tree", "40000": "tree", "100644": "blob", "100755": "blob",
                 "120000": "blob", "160000": "commit"}
        if mode not in valid or valid[mode] != kind or name in rows:
            raise ReuseError("SOURCE_TREE_ENTRY", "Tree mode/type or duplicate path is invalid.", name)
        row = {"path": name, "sha": _sha(entry.get("sha"), "tree entry"), "mode": mode, "type": kind}
        if "size" in entry:
            if type(entry["size"]) is not int or entry["size"] < 0:
                raise ReuseError("SOURCE_SIZE", "Tree size must be a nonnegative byte count.", name)
            row["size"] = entry["size"]
        rows[name] = row
        parent = str(PurePosixPath(name).parent)
        children.setdefault(parent, []).append(row)
    verified = set()

    def verify_directory(name):
        if name in verified:
            return
        if name != ".":
            row = rows.get(name)
            if row is None or row["type"] != "tree":
                raise ReuseError("SOURCE_TREE_INCOMPLETE", "The selected path lacks its original parent tree.", name)
            verify_directory(str(PurePosixPath(name).parent))
        expected = expected_tree if name == "." else rows[name]["sha"]
        try:
            direct = sorted(children.get(name, []), key=lambda row:
                            (PurePosixPath(row["path"]).name + ("/" if row["type"] == "tree" else "")).encode("utf-8"))
            data = b"".join(row["mode"].lstrip("0").encode("ascii") + b" "
                            + PurePosixPath(row["path"]).name.encode("utf-8") + b"\0"
                            + bytes.fromhex(row["sha"]) for row in direct)
        except UnicodeError:
            raise ReuseError("SOURCE_TREE_ENCODING", "Tree paths must retain valid UTF-8 bytes.", name) from None
        actual = hashlib.sha1(b"tree " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        if actual != expected:
            raise ReuseError("SOURCE_TREE_INCOMPLETE", "Captured children do not reproduce the original Git tree; acquire its complete rows.", name)
        verified.add(name)

    verify_directory(".")
    files = {}
    for name in selected:
        if name != "." and name not in rows:
            raise ReuseError("SOURCE_SELECTION_MISSING", "The selected path is absent from the captured tree.", name)
        candidates = ([rows[name]] if name != "." and rows[name]["type"] != "tree"
                      else [row for path, row in rows.items() if name == "." or path.startswith(name + "/")])
        if name == "." or rows[name]["type"] == "tree":
            verify_directory(name)
        for row in candidates:
            if row["type"] == "tree":
                verify_directory(row["path"])
                continue
            verify_directory(str(PurePosixPath(row["path"]).parent))
            if row["mode"] not in ("100644", "100755"):
                raise ReuseError("SOURCE_MODE", "Select ordinary source files; a symlink or submodule requires its own source workflow.", row["path"])
            files[row["path"]] = {"path": row["path"], "blob_sha": row["sha"], "mode": row["mode"],
                                  **({"size": row["size"]} if "size" in row else {})}
    if not files:
        raise ReuseError("SOURCE_SELECTION_EMPTY", "The selected trees contain no ordinary files.")
    return {"schema": REQUEST_SCHEMA, "repository": repository, "ref": commit,
            "tree_sha": expected_tree, "selected_paths": selected,
            "files": [files[name] for name in sorted(files)]}


def source_request(value):
    if isinstance(value, dict) and value.get("schema") == SELECTION_SCHEMA:
        return select_tree_sources(value)
    if isinstance(value, dict) and value.get("schema") == ACQUISITION_SCHEMA:
        request = value.get("request")
        if not isinstance(request, dict) or value.get("selection_id") != selection_identity(request):
            raise ReuseError("SOURCE_PLAN_MISMATCH", "The saved acquisition plan's request identity changed.")
        return request
    return value


def selection_identity(manifest):
    files = [{key: row[key] for key in ("path", "blob_sha", "mode", "size") if row[key] is not None}
             for row in _requests(manifest)]
    source = {key: manifest[key] for key in ("repository", "ref", "tree_sha") if key in manifest}
    source["files"] = sorted(files, key=lambda row: row["path"])
    return hashlib.sha256(json.dumps(source, ensure_ascii=True, sort_keys=True,
                                     separators=(",", ":")).encode("ascii")).hexdigest()


def merge_source_captures(manifest, captures=()):
    """Associate retained request/result pairs by original path and verified blob bytes."""
    manifest = source_request(manifest)
    requested = _requests(manifest)
    repository = _repository(manifest.get("repository")) if captures else manifest.get("repository")
    by_path = {row["path"]: row for row in requested}
    by_blob = {}
    for row in requested:
        by_blob.setdefault(row["blob_sha"], []).append(row)
    attached, receipts = {}, []
    for capture_set in captures:
        pairs = capture_set.get("captures") if isinstance(capture_set, dict) else capture_set
        if not isinstance(pairs, list):
            raise ReuseError("SOURCE_CAPTURE_SHAPE", "Capture input needs a captures array of request/response pairs.")
        for pair in pairs:
            if not isinstance(pair, dict) or not isinstance(pair.get("request"), dict) or "response" not in pair:
                raise ReuseError("SOURCE_CAPTURE_SHAPE", "Each capture needs its original request and response.")
            request = pair["request"]
            original_repository = _repository(request.get("repository_full_name"))
            if original_repository.lower() != repository.lower():
                receipts.append({"repository": original_repository, "status": "different_repository"})
                continue
            if "path" in request:
                name = _path(request["path"])
                original_ref = _sha(request.get("ref"), "captured file ref")
                selected = by_path.get(name)
                receipt = {"kind": "fetch_file", "path": name, "repository": original_repository,
                           "ref": original_ref}
                if selected is None:
                    receipts.append({**receipt, "status": "unrequested"})
                    continue
                expected = selected["blob_sha"]
                if request.get("encoding", "utf-8") not in ("utf-8", "base64"):
                    raise ReuseError("SOURCE_ENCODING", "Capture the original full UTF-8 or base64 file.", name)
                if request.get("start_line") is not None or request.get("end_line") is not None:
                    receipts.append({**receipt, "status": "partial_capture", "blob_sha": expected})
                    continue
                # A previous immutable ref may have changed source. First verify
                # its own returned bytes, then compare with today's selected blob.
                entry = {"path": name, "response": pair["response"]}
                receipt["blob_sha"] = expected
            else:
                expected = _sha(request.get("blob_sha"), "captured blob")
                matches = by_blob.get(expected)
                if not matches:
                    receipts.append({"kind": "fetch_blob", "repository": original_repository,
                                     "blob_sha": expected, "status": "unrequested"})
                    continue
                name = matches[0]["path"]
                entry = {"path": name, "blob_sha": expected, "encoding": "utf-8", "response": pair["response"]}
                receipt = {"kind": "fetch_blob", "repository": original_repository, "blob_sha": expected}
            try:
                item = importer._source(entry)
            except importer.SourceImportError as exc:
                if exc.code != "SOURCE_TOOL_ERROR":
                    raise
                receipts.append({**receipt, "status": "provider_error", "error": exc.code})
                continue
            if item["blob_sha"] != expected:
                receipts.append({**receipt, "status": "blob_mismatch", "observed_blob_sha": item["blob_sha"],
                                 "bytes": len(item["data"])})
                continue
            # Keep captured request provenance separate from the original byte
            # payload, so one exact fetched blob can satisfy all selected aliases.
            encoded = {"sha": expected, "encoding": "base64", "content": base64.b64encode(item["data"]).decode("ascii")}
            attached[expected] = encoded
            receipts.append({**receipt, "status": "captured", "bytes": len(item["data"]),
                             "selected_paths": [row["path"] for row in by_blob[expected]]})
    files = []
    for row in requested:
        entry = row["provided"] or {key: row[key] for key in ("path", "blob_sha", "mode", "size") if row[key] is not None}
        if row["blob_sha"] in attached and row["provided"] is None:
            entry = {**entry, "response": attached[row["blob_sha"]]}
        files.append(entry)
    return {**manifest, "files": files}, receipts


def acquisition_plan(manifest, source_roots=(), git_roots=(), *, captures=()):
    """Emit deduplicated exact native fetch arguments; caller owns provider execution."""
    selected = source_request(manifest)
    repository = _repository(selected.get("repository"))
    commit = _sha(selected.get("ref"), "source ref")
    hydrated, receipts = merge_source_captures(selected, captures)
    report = resolve_sources(hydrated, source_roots, git_roots)
    requested = {row["path"]: row for row in _requests(selected)}
    files = [{key: row[key] for key in ("path", "blob_sha", "mode", "size") if row[key] is not None}
             for row in requested.values()]
    request = {key: selected[key] for key in ("schema", "repository", "ref", "tree_sha", "selected_paths") if key in selected}
    request.update(schema=REQUEST_SCHEMA, files=files)
    missing = {}
    for row in report["missing"]:
        missing.setdefault(row["blob_sha"], []).append(row["path"])
    fetches = []
    for sha, paths in sorted(missing.items()):
        fetches.append({"request_id": hashlib.sha256((repository.lower() + ":" + sha).encode("utf-8")).hexdigest(),
                        "blob_sha": sha, "paths": sorted(paths),
                        "fetch_blob": {"repository_full_name": repository, "blob_sha": sha},
                        "fetch_file": {"repository_full_name": repository, "path": sorted(paths)[0],
                                       "ref": commit, "encoding": "base64"}})
    return {"schema": ACQUISITION_SCHEMA, "ok": True, "complete": report["complete"],
            "selection_id": selection_identity(request), "request": request, "reuse": report,
            "captures": receipts, "fetches": fetches, "unique_missing_blobs": len(fetches),
            "provider_requests": 0}


def _requests(manifest):
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list) or not manifest["files"]:
        raise ReuseError("SOURCE_MANIFEST", "Input needs a nonempty files array.")
    requests = {}
    for entry in manifest["files"]:
        if not isinstance(entry, dict):
            raise ReuseError("SOURCE_ENTRY_SHAPE", "Each requested source must be an object.")
        name = _path(entry.get("path"))
        mode = entry.get("mode")
        if mode is not None and mode not in ("100644", "100755"):
            raise ReuseError("SOURCE_MODE", "Use mode 100644 or 100755 when supplied.", name)
        provided = "response" in entry or "source_file" in entry
        if provided:
            item = importer.inspect_source(entry)
            expected, size = item["blob_sha"], item["bytes"]
            if "size" in entry and (type(entry["size"]) is not int or entry["size"] != size):
                raise ReuseError("SOURCE_SIZE_MISMATCH", "Supplied bytes differ from the requested tree size.", name)
        else:
            expected, size = entry.get("blob_sha", entry.get("sha")), entry.get("size")
            if not isinstance(expected, str) or not HEX40.fullmatch(expected):
                raise ReuseError("SOURCE_SHA", "Each requested file needs its exact Git blob SHA.", name)
            expected = expected.lower()
            if "sha" in entry and str(entry["sha"]).lower() != expected:
                raise ReuseError("SOURCE_SHA_MISMATCH", "sha and blob_sha disagree.", name)
            if entry.get("type", "blob") != "blob":
                raise ReuseError("SOURCE_TYPE", "Only explicitly requested blob files can be reused.", name)
            if size is not None and (type(size) is not int or size < 0):
                raise ReuseError("SOURCE_SIZE", "size must be a nonnegative byte count.", name)
        normalized = {"path": name, "blob_sha": expected, "mode": mode, "size": size,
                      "provided": entry if provided else None}
        if name in requests:
            old = requests[name]
            if any(old[k] != normalized[k] for k in ("blob_sha", "mode", "size")):
                raise ReuseError("SOURCE_DUPLICATE_CONFLICT", "Duplicate requested paths disagree.", name)
            continue
        requests[name] = normalized
    names = set(requests)
    for name in names:
        if any(str(parent) in names for parent in PurePosixPath(name).parents if str(parent) != "."):
            raise ReuseError("SOURCE_PATH_CONFLICT", "A requested file is another requested file's parent.", name)
    return list(requests.values())


def _roots(values):
    roots, issues = [], []
    for value in values:
        try:
            root = Path(value).expanduser().resolve(strict=True)
            if not root.is_dir():
                raise NotADirectoryError()
        except (OSError, RuntimeError):
            issues.append({"root": str(value), "status": "unavailable"})
            continue
        if root not in roots:
            roots.append(root)
    return roots, issues


def _file_identity(root, name):
    candidate = root.joinpath(*PurePosixPath(name).parts)
    try:
        source = candidate.resolve(strict=True)
        if not source.is_relative_to(root):
            return {"status": "outside_root"}
        descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                return {"status": "not_regular"}
            digest = hashlib.sha1(b"blob " + str(before.st_size).encode("ascii") + b"\0")
            count = 0
            while count <= before.st_size:
                chunk = stream.read(min(CHUNK, before.st_size - count + 1))
                if not chunk:
                    break
                digest.update(chunk)
                count += len(chunk)
            after = os.fstat(stream.fileno())
        if (count != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            return {"status": "changed_during_read"}
        return {"status": "observed", "source_file": str(source), "blob_sha": digest.hexdigest(), "bytes": count}
    except FileNotFoundError:
        return {"status": "absent"}
    except (OSError, RuntimeError):
        return {"status": "unavailable"}


def _git_command(root, *arguments):
    executable = shutil.which("git")
    if executable is None:
        raise ReuseError("GIT_UNAVAILABLE", "git is unavailable; working-file reuse remains available.")
    # No checkout, filters, hooks, remotes, or implicit promisor fetches. Keep
    # the transport prohibition even on Git versions without NO_LAZY_FETCH.
    return [executable, "--no-replace-objects", "-c", "protocol.allow=never",
            "-c", "core.fsmonitor=false", "-C", str(root), *arguments]


def _git_environment():
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environment.update({"GIT_NO_LAZY_FETCH": "1", "GIT_TERMINAL_PROMPT": "0",
                        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                        "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"})
    return environment


def _git_objects(root, requested):
    try:
        result = subprocess.run(_git_command(root, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"),
                                input=("\n".join(requested) + "\n").encode("ascii"),
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                env=_git_environment(), timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired, ReuseError):
        return {}, "unavailable"
    if result.returncode:
        return {}, "unavailable"
    lines = result.stdout.decode("ascii", errors="replace").splitlines()
    if len(lines) != len(requested):
        return {}, "invalid_object_response"
    found = {}
    for sha, line in zip(requested, lines):
        fields = line.split(" ")
        if len(fields) == 3 and fields[0] == sha and fields[1] == "blob" and fields[2].isdigit():
            found[sha] = int(fields[2])
    return found, "inspected"


def resolve_sources(manifest, source_roots=(), git_roots=(), *, captures=()):
    """Select exact local bytes; return all unresolved paths without fetching."""
    manifest, capture_receipts = merge_source_captures(manifest, captures)
    requests = _requests(manifest)
    roots, root_issues = _roots(source_roots)
    objects, git_issues = _roots([*roots, *git_roots])
    rows = []
    for request in requests:
        row = {key: request[key] for key in ("path", "blob_sha", "mode") if request[key] is not None}
        row["attempts"] = []
        if request["provided"] is not None:
            row.update(status="provided", bytes=request["size"])
        else:
            row["status"] = "missing"
            for root in roots:
                observed = _file_identity(root, request["path"])
                actual = observed.get("blob_sha")
                if actual == request["blob_sha"] and (request["size"] is None or observed["bytes"] == request["size"]):
                    row.update(status="local_file", root=str(root), source_file=observed["source_file"], bytes=observed["bytes"])
                    break
                attempt = {"root": str(root), "kind": "working_file", "status": observed["status"]}
                if actual is not None:
                    attempt.update(status="blob_mismatch", observed_blob_sha=actual, bytes=observed["bytes"])
                    if actual == request["blob_sha"]:
                        attempt["status"] = "size_mismatch"
                row["attempts"].append(attempt)
        rows.append(row)
    git_inspections = []
    for root in objects:
        pending = sorted({row["blob_sha"] for row in rows if row["status"] == "missing"})
        if not pending:
            break
        found, status = _git_objects(root, pending)
        git_inspections.append({"root": str(root), "status": status, "requested_objects": len(pending), "found_objects": len(found)})
        for request, row in zip(requests, rows):
            if row["status"] != "missing":
                continue
            size = found.get(row["blob_sha"])
            if size is not None and (request["size"] is None or request["size"] == size):
                row.update(status="git_object", git_root=str(root), bytes=size)
    missing = [{key: row[key] for key in ("path", "blob_sha", "mode") if key in row}
               for row in rows if row["status"] == "missing"]
    return {"schema": SCHEMA, "ok": not missing, "complete": not missing,
            "requested": len(rows), "resolved": len(rows) - len(missing),
            "counts": {kind: sum(row["status"] == kind for row in rows)
                       for kind in ("provided", "local_file", "git_object", "missing")},
            "files": rows, "missing": missing, "source_root_issues": root_issues,
            "git_root_issues": git_issues, "git_inspections": git_inspections,
            **({"captures": capture_receipts} if captures else {}),
            "provider_requests": 0, "source_files_modified": 0}


def _extract_objects(rows, stage):
    grouped, staged = {}, {}
    for row in rows:
        if row["status"] == "git_object":
            grouped.setdefault(row["git_root"], {})[row["blob_sha"]] = row
    for root, objects in grouped.items():
        process = subprocess.Popen(_git_command(root, "cat-file", "--batch"),
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env=_git_environment())
        try:
            for sha, row in objects.items():
                destination = stage / sha
                if sha in staged:
                    continue
                process.stdin.write((sha + "\n").encode("ascii"))
                process.stdin.flush()
                header = process.stdout.readline().decode("ascii", errors="replace").rstrip("\n")
                if header != f"{sha} blob {row['bytes']}":
                    raise ReuseError("SOURCE_OBJECT_CHANGED", "The selected local Git blob is no longer available.", row["path"])
                digest = hashlib.sha1(b"blob " + str(row["bytes"]).encode("ascii") + b"\0")
                remaining = row["bytes"]
                with destination.open("xb") as output:
                    os.chmod(destination, 0o600)
                    while remaining:
                        chunk = process.stdout.read(min(CHUNK, remaining))
                        if not chunk:
                            raise ReuseError("SOURCE_OBJECT_INCOMPLETE", "Local Git returned an incomplete blob.", row["path"])
                        output.write(chunk)
                        digest.update(chunk)
                        remaining -= len(chunk)
                if process.stdout.read(1) != b"\n" or digest.hexdigest() != sha:
                    raise ReuseError("SOURCE_BLOB_MISMATCH", "Local Git bytes differ from the requested blob.", row["path"])
                staged[sha] = str(destination)
            process.stdin.close()
            if process.wait(timeout=30):
                raise ReuseError("SOURCE_GIT_READ", "Local Git object extraction did not complete.")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            if not process.stdin.closed:
                process.stdin.close()
            process.stdout.close()
    return staged


def _import_manifest(manifest, report, staged):
    requests = {}
    for entry in manifest["files"]:
        requests.setdefault(entry["path"], entry)
    files = []
    for row in report["files"]:
        request = requests[row["path"]]
        if "response" in request or "source_file" in request:
            files.append(request)
            continue
        entry = {key: row[key] for key in ("path", "blob_sha", "mode") if key in row}
        entry["source_file"] = (row["source_file"] if row["status"] == "local_file"
                                else staged[row["blob_sha"]])
        files.append(entry)
    return {"files": files}


def materialize_reused(manifest, output_directory, source_roots=(), git_roots=(), *, staging_directory=None,
                       captures=(), immutable_links=False, link_fallback="copy", link_anchors=()):
    """Resolve the complete request, then call the original create-only importer."""
    manifest, capture_receipts = merge_source_captures(manifest, captures)
    report = resolve_sources(manifest, source_roots, git_roots)
    if captures:
        report["captures"] = capture_receipts
    if not report["complete"]:
        return {**report, "error": "SOURCE_REUSE_MISSING", "imported": False}
    options = importer.materialization_options({"immutable_links": immutable_links,
                                               "link_fallback": link_fallback, "link_anchors": link_anchors})
    if any(row["status"] == "git_object" for row in report["files"]):
        with tempfile.TemporaryDirectory(prefix="commons-source-reuse-", dir=staging_directory) as directory:
            staged = _extract_objects(report["files"], Path(directory))
            selected = _import_manifest(manifest, report, staged)
            # Extracted private mode-0600 blobs are copied to their selected
            # source mode; a cross-device reference must not outlive this stage.
            result = importer.materialize(selected, output_directory, staging_directory=staging_directory,
                                          **options)
    else:
        selected = _import_manifest(manifest, report, {})
        result = importer.materialize(selected, output_directory, staging_directory=staging_directory,
                                      **options)
    return {**report, "imported": True, "import_result": result}


def export_reused(manifest, output_directory, source_roots=(), git_roots=(), *, captures=()):
    """Export a reusable original-importer manifest and selected local Git blobs."""
    manifest, capture_receipts = merge_source_captures(manifest, captures)
    report = resolve_sources(manifest, source_roots, git_roots)
    if captures:
        report["captures"] = capture_receipts
    if not report["complete"]:
        return {**report, "error": "SOURCE_REUSE_MISSING", "exported": False}
    output = Path(output_directory).expanduser().absolute()
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    stage = output / "blobs"
    stage.mkdir(mode=0o700)
    staged = _extract_objects(report["files"], stage)
    selected = _import_manifest(manifest, report, staged)
    manifest_path = output / "manifest.json"
    descriptor = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(selected, stream, ensure_ascii=True, sort_keys=True)
        stream.write("\n")
    return {**report, "exported": True, "manifest_file": str(manifest_path),
            "reused_working_files_referenced": report["counts"]["local_file"],
            "git_blobs_saved": len(staged)}


def read_manifest(path, manifest_format="json"):
    with importer._open_regular_file(Path(path).expanduser(), encoding="utf-8") as stream:
        if manifest_format == "json":
            return json.load(stream)
        return {"files": [json.loads(line) for line in stream if line.strip()]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("select", "plan", "inspect", "copy", "export"))
    parser.add_argument("manifest", help="Original files manifest, captured commit/tree selection, or saved acquisition plan")
    parser.add_argument("output_directory", nargs="?", help="Destination for copy or new export directory")
    parser.add_argument("--source-root", action="append", default=[], help="Existing root containing requested relative paths; repeat in preference order")
    parser.add_argument("--git-root", action="append", default=[], help="Additional existing Git object store or worktree; never fetches")
    parser.add_argument("--manifest-format", choices=("json", "ndjson"), default="json")
    parser.add_argument("--capture", action="append", default=[], help="Saved native request/response pairs; repeatable, no provider call")
    parser.add_argument("--staging-directory", help="Existing temporary-file parent for copy")
    importer.materialization_arguments(parser)
    args = parser.parse_args(argv)
    if (args.command in ("select", "plan", "inspect")) != (args.output_directory is None):
        parser.error("select, plan and inspect have no destination; copy and export require output_directory")
    if args.command == "select" and (args.capture or args.source_root or args.git_root):
        parser.error("select reads metadata only; use plan, inspect or copy to reuse source/captures")
    try:
        options = importer.materialization_from_args(args)
        if options and args.command != "copy":
            parser.error("immutable materialization options apply to copy")
        manifest = read_manifest(args.manifest, args.manifest_format)
        captures = [read_manifest(path) for path in args.capture]
        if args.command == "select":
            result = select_tree_sources(manifest)
        elif args.command == "plan":
            result = acquisition_plan(manifest, args.source_root, args.git_root, captures=captures)
        elif args.command == "inspect":
            result = resolve_sources(manifest, args.source_root, args.git_root, captures=captures)
        elif args.command == "copy":
            result = materialize_reused(manifest, args.output_directory, args.source_root, args.git_root,
                                        staging_directory=args.staging_directory, captures=captures, **options)
        else:
            result = export_reused(manifest, args.output_directory, args.source_root, args.git_root, captures=captures)
    except (ReuseError, importer.SourceImportError) as exc:
        result = {"ok": False, "error": exc.code, "detail": exc.detail}
        if exc.path is not None:
            result["path"] = exc.path
    except importer.SourceImportIOError as exc:
        result = importer._io_error_result(exc, operation=exc.operation, path=exc.source_path,
                                          completed_files=exc.completed_files)
    except (OSError, subprocess.SubprocessError, ValueError, RecursionError) as exc:
        result = {"ok": False, "error": "SOURCE_REUSE_IO" if isinstance(exc, OSError) else "SOURCE_REUSE_INPUT",
                  "detail": type(exc).__name__ + ": source reuse did not complete; existing source is preserved."}
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0 if result.get("ok", args.command == "select") else 1


if __name__ == "__main__":
    sys.exit(main())
