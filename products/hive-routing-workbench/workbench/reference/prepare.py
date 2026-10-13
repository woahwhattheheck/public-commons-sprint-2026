#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Prepare the original Hive four-subgraph reference and its reviewed schema edit.

This module writes source editions only. The original Hive Desk native/programme
APIs own the router. The upstream fixture selection is supplied with the complete
reference source and is checked byte for byte before it is copied.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from urllib.parse import urlsplit

UPSTREAM_COMMIT = "28eafc1bceb3dce8600d0eeea2ce2c2ec9563bb6"
UPSTREAM_REPOSITORY = "graphql-hive/router"
SUPERGRAPH_PATH = "bin/router/fixture/products-example.supergraph.graphql"
SUPERGRAPH_BYTES = 3233
SUPERGRAPH_SHA256 = "15527f714d42acd08ab1670ae2ea11f5597bfad3a86299512616f267cece52b3"
SUBGRAPHS = ("accounts", "inventory", "products", "reviews")
REMOVED_FIELD = b"  internal: String @join__field(graph: PRODUCTS)\n"
REFERENCE = Path(__file__).resolve().parent
STAMP_FIELDS = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def identity(body):
    return {"bytes": len(body), "sha256": digest(body),
            "git_blob": hashlib.sha1(b"blob " + str(len(body)).encode("ascii")
                                    + b"\0" + body).hexdigest()}


def no_symlinks(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError("Reference path contains a symlink: " + str(item))


def relative(root, name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or name.startswith("/") or any(p in ("", ".", "..") for p in name.split("/"))):
        raise ValueError("Reference source path must be a safe relative path")
    path = root.joinpath(*name.split("/"))
    no_symlinks(path)
    return path


def read_stable(path, maximum):
    no_symlinks(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Reference input must be a regular file")
        body = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        current = path.stat(follow_symlinks=False)
    if (len(body) > maximum or any(getattr(before, k) != getattr(after, k)
            or getattr(after, k) != getattr(current, k) for k in STAMP_FIELDS)):
        raise ValueError("Reference input changed or exceeded its selected size")
    return body


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish(path, body):
    no_symlinks(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    no_symlinks(path.parent)
    if path.exists():
        if read_stable(path, len(body)) != body:
            raise ValueError("An existing reference edition has different bytes: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix=".reference-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            if read_stable(path, len(body)) != body:
                raise ValueError("Concurrent reference publication differs")
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
        sync_directory(path.parent)


def selected_fixture(upstream, selection_path):
    raw = read_stable(selection_path, 16 * 1024 * 1024)
    original_selection = read_stable(REFERENCE / "FIXTURE-SOURCE.json", 16 * 1024 * 1024)
    if raw != original_selection:
        raise ValueError("The selected manifest differs from the retained original fixture source")
    selection = json.loads(raw)
    if (selection.get("schema") != "hive-desk-reference-source/v1"
            or selection.get("repository") != UPSTREAM_REPOSITORY
            or selection.get("commit") != UPSTREAM_COMMIT
            or selection.get("subgraphs") != list(SUBGRAPHS)):
        raise ValueError("Select the original complete four-subgraph source manifest")
    rows = selection.get("files")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The original executable fixture source selection is required")
    names, files = set(), []
    for row in rows:
        name = row.get("path")
        if name in names:
            raise ValueError("Duplicate original source path")
        names.add(name)
        length = row.get("bytes")
        if isinstance(length, bool) or not isinstance(length, int) or not 0 <= length <= 64 * 1024 * 1024:
            raise ValueError("Invalid selected original source size")
        body = read_stable(relative(upstream, name), length)
        observed = identity(body)
        if any(row.get(k) != observed[k] for k in ("bytes", "sha256", "git_blob")):
            raise ValueError("Original fixture bytes differ: " + str(name))
        files.append((name, body, observed))
    for required in selection.get("required_paths", []):
        if required not in names:
            raise ValueError("Original executable fixture closure is incomplete: " + required)
    if not selection.get("command") or not isinstance(selection.get("command"), list):
        raise ValueError("The observed original fixture command is required")
    if not all(isinstance(x, str) and x and "\0" not in x for x in selection["command"]):
        raise ValueError("Original fixture command arguments are invalid")
    cwd = selection.get("cwd")
    if cwd != ".":
        relative(upstream, cwd)
    return selection, raw, files


def router_config(port):
    if isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("Select an explicit unprivileged router port")
    return {"supergraph": {"source": "file", "path": "supergraph.graphql"},
            "http": {"host": "127.0.0.1", "port": port, "workers": 1,
                     "graphql_endpoint": "/graphql", "shutdown_timeout": "30s"}}


def bind_endpoints(original, endpoints):
    if set(endpoints) != set(SUBGRAPHS):
        raise ValueError("The reference requires all four original subgraphs")
    body, changes = original, []
    for name in SUBGRAPHS:
        url = endpoints[name]
        if not isinstance(url, str):
            raise ValueError("Subgraph endpoint must be a URL")
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "::1")
                or parsed.username or parsed.password or parsed.fragment or parsed.query
                or parsed.path != "/" + name or parsed.port is None):
            raise ValueError("The original fixture must use an explicit loopback endpoint")
        old = ("http://0.0.0.0:4200/" + name).encode("ascii")
        new = url.encode("ascii")
        if body.count(old) != 1:
            raise ValueError("Original subgraph URL occurrence differs")
        body = body.replace(old, new, 1)
        changes.append({"subgraph": name, "original": old.decode("ascii"), "receiving": url})
    return body, changes


def prepare(upstream, output, *, initial_port, changed_port, endpoints,
            selection_path=None):
    upstream, output = Path(upstream).absolute(), Path(output).absolute()
    no_symlinks(upstream)
    no_symlinks(output)
    if initial_port == changed_port:
        raise ValueError("Initial and changed router editions require distinct ports")
    config_initial, config_changed = router_config(initial_port), router_config(changed_port)
    selected = Path(selection_path).absolute() if selection_path else REFERENCE / "FIXTURE-SOURCE.json"
    selection, selection_raw, fixture_files = selected_fixture(upstream, selected)
    original = read_stable(REFERENCE.parent / "upstream" / "router" / SUPERGRAPH_PATH,
                           SUPERGRAPH_BYTES)
    if len(original) != SUPERGRAPH_BYTES or digest(original) != SUPERGRAPH_SHA256:
        raise ValueError("The unchanged original Hive supergraph differs")
    operations_raw = read_stable(REFERENCE / "operations.json", 1024 * 1024)
    operations = json.loads(operations_raw)
    rows = operations.get("operations", [])
    if (operations.get("schema") != "hive-desk-operations/v1" or len(rows) != 20
            or len({row["id"] for row in rows}) != 20
            or rows[-1]["id"] != "reviewed-schema-surface"):
        raise ValueError("Select the complete twenty-operation reference programme")
    bound, endpoint_changes = bind_endpoints(original, endpoints)
    if bound.count(REMOVED_FIELD) != 1:
        raise ValueError("The reviewed Product.internal source line differs")
    changed = bound.replace(REMOVED_FIELD, b"", 1)
    input_binding = {"schema": "hive-desk-reference-input/v1",
                     "repository": UPSTREAM_REPOSITORY, "commit": UPSTREAM_COMMIT,
                     "fixture_manifest": identity(selection_raw),
                     "original_supergraph": identity(original),
                     "operations": identity(operations_raw), "endpoints": endpoints,
                     "initial_config": config_initial, "changed_config": config_changed}
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    no_symlinks(output)
    lock_path = output / "prepare.lock"
    no_symlinks(lock_path)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    with os.fdopen(fd, "a+b") as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        publish(output / "input.json", encoded(input_binding))
        prepared = []
        for label, graph, config in (("initial", bound, config_initial),
                                     ("changed", changed, config_changed)):
            directory = output / label
            derivation = {"schema": "hive-desk-reference-derivation/v1",
                          "purpose": "Original public developer fixture; no customer data",
                          "upstream": {"repository": UPSTREAM_REPOSITORY,
                                       "commit": UPSTREAM_COMMIT, "path": SUPERGRAPH_PATH,
                                       **identity(original)},
                          "subgraph_endpoint_realization": endpoint_changes,
                          "router_listener_realization": config["http"],
                          "schema_changes": [] if label == "initial" else [
                              {"type": "remove-field", "coordinate": "Product.internal",
                               "original_line": REMOVED_FIELD.decode("utf-8"),
                               "reason": "Explicit reference migration review",
                               "result": "Native validation for the unchanged selected query"}],
                          "supergraph": identity(graph), "operations": identity(operations_raw)}
            content = {
                "edition.json": encoded({"schema": "hive-desk-edition/v1",
                    "name": "Original Hive four-subgraph reference" if label == "initial"
                            else "Reviewed reference: Product.internal removed",
                    "config_file": "router.config.json",
                    "supergraph_file": "supergraph.graphql", "operations_file": "operations.json"}),
                "router.config.json": encoded(config), "supergraph.graphql": graph,
                "operations.json": operations_raw, "derivation.json": encoded(derivation),
                "source/FIXTURE-SOURCE.json": selection_raw,
                "source/original-supergraph.graphql": original}
            for name, body, _ in fixture_files:
                content["source/upstream/" + name] = body
            inventory = []
            for name, body in sorted(content.items()):
                publish(relative(directory, name), body)
                inventory.append({"path": name, **identity(body)})
            # Reopen the complete original edition before its completion record.
            for row in inventory:
                observed = read_stable(relative(directory, row["path"]), row["bytes"])
                if identity(observed) != {k: row[k] for k in ("bytes", "sha256", "git_blob")}:
                    raise ValueError("Prepared reference changed before completion")
            prepared.append({"name": label, "directory": str(directory),
                             "files": inventory, "supergraph_sha256": digest(graph)})
        result = {"schema": "hive-desk-reference-prepared/v1", "input": input_binding,
                  "editions": prepared, "subgraphs": list(SUBGRAPHS),
                  "operations_per_phase": 20, "planned_phases": ["initial", "changed", "rollback"],
                  "application_executed": False}
        publish(output / "prepared.json", encoded(result))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--fixture-selection", type=Path)
    parser.add_argument("--initial-port", required=True, type=int)
    parser.add_argument("--changed-port", required=True, type=int)
    parser.add_argument("--subgraph-origin", required=True,
                        help="Actual original fixture origin, for example http://127.0.0.1:4200")
    args = parser.parse_args()
    origin = args.subgraph_origin.rstrip("/")
    result = prepare(args.upstream, args.output, initial_port=args.initial_port,
                     changed_port=args.changed_port,
                     endpoints={name: origin + "/" + name for name in SUBGRAPHS},
                     selection_path=args.fixture_selection)
    print(json.dumps({"prepared": str(args.output.absolute() / "prepared.json"),
                      "subgraphs": result["subgraphs"], "operations_per_phase": 20,
                      "application_executed": False}, separators=(",", ":")))


if __name__ == "__main__":
    main()
