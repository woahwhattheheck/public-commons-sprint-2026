"""Complete native query/source/warehouse handoff for one immutable report."""
from __future__ import annotations

import os
from pathlib import Path
import re
import stat

from ..duckdb_agent import copy_sparse
from ..duckdb_dataset import DuckDBWorkspace, _descriptor, _hex, _json, _new_destination, _now
from ..storage import parse, private_directory, read, sync_directory, write
from .contracts import SCHEMA, fail, request_id, sha
from .model import Reconciliation

EXPORT_SCHEMA = SCHEMA + ".export"
MAX_MANIFEST = 16 * 1024 * 1024
MAX_FILE = 8 * 1024 * 1024 * 1024
_KINDS = {"rows", "groups", "decisions", "changes"}


def _path(value):
    path = Path(os.path.abspath(Path(value).expanduser()))
    if path == Path("/") or path.resolve() != path:
        fail("PRIVATE_CANONICAL_PATH_REQUIRED")
    return path


def _name(value):
    if (not isinstance(value, str) or not value or len(value) > 1024 or value.startswith("/")
            or re.search(r"[\\:\x00-\x1f\x7f]", value)
            or any(part in {"", ".", ".."} for part in value.split("/"))
            or len(value.split("/")) > 32):
        fail("FILE_NAME_INVALID")
    return value


def _file(root, name):
    name = _name(name)
    root = _path(root)
    private_directory(root, create=False)
    path = root
    for part in name.split("/")[:-1]:
        path = path / part
        private_directory(path, create=False)
        if path.resolve() != path:
            fail("PRIVATE_CANONICAL_PATH_REQUIRED")
    path = path / name.split("/")[-1]
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077
            or info.st_size > MAX_FILE):
        fail("PRIVATE_FILE_REQUIRED")
    result = _descriptor(path, name)
    after = path.lstat()
    if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        fail("FILE_CHANGED")
    return result


def _public_file(item):
    return {key: value for key, value in item.items() if key != "path"}


def _retain(path, payload):
    if path.exists():
        if read(path, max(len(payload), 1)) != payload:
            fail("ORIGINAL_PACKAGE_CHANGED")
        sync_directory(path.parent)
    else:
        write(path, payload, exclusive=True)


def _json_bytes(value):
    raw = (_json(value) + "\n").encode("utf-8")
    if len(raw) > MAX_MANIFEST:
        fail("PACKAGE_METADATA_TOO_LARGE")
    return raw


def _verify_manifest(root, manifest):
    if (not isinstance(manifest, dict) or manifest.get("schema") != EXPORT_SCHEMA
            or manifest.get("complete") is not True or manifest.get("state") != "COMPLETE"):
        fail("PACKAGE_MANIFEST_INVALID")
    _hex(manifest.get("export_id"))
    _hex(manifest.get("report_id"))
    request_id(manifest.get("request_id"))
    request_id(manifest.get("workspace_id"))
    if not isinstance(manifest.get("files"), list) or len(manifest["files"]) > 100000:
        fail("PACKAGE_MANIFEST_INVALID")
    files, names = [], set()
    for expected in manifest["files"]:
        if (not isinstance(expected, dict) or type(expected.get("bytes")) is not int
                or not 0 <= expected["bytes"] <= MAX_FILE):
            fail("PACKAGE_MANIFEST_INVALID")
        name = _name(expected.get("name"))
        if name in names or name == "manifest.json":
            fail("PACKAGE_MANIFEST_INVALID")
        _hex(expected.get("sha256"))
        actual = _file(root, name)
        if (actual["bytes"], actual["sha256"]) != (expected["bytes"], expected["sha256"]):
            fail("PACKAGE_FILE_CHANGED")
        names.add(name)
        files.append(actual)
    required = {"report.json", "reconciliation-request.json", "OPERATING.md",
                "warehouse/warehouse.duckdb", "warehouse/handoff.json", "warehouse/handoff-request.json"}
    if not required <= names:
        fail("PACKAGE_INCOMPLETE")
    report = parse(read(root / "report.json", MAX_MANIFEST))
    original = parse(read(root / "reconciliation-request.json", MAX_MANIFEST))
    if (report.get("report_id") != manifest["report_id"]
            or sha(report) != manifest.get("report_digest")
            or original.get("report") != report
            or original.get("request_id") != manifest["request_id"]
            or original.get("workspace_id") != manifest["workspace_id"]
            or original.get("export_id") != manifest["export_id"]):
        fail("ORIGINAL_REPORT_CHANGED")
    expected_queries = report.get("queries")
    if not isinstance(expected_queries, list) or {x.get("kind") for x in expected_queries} not in (
            {"rows", "groups", "decisions"}, _KINDS):
        fail("PACKAGE_QUERY_SET_INVALID")
    summaries = manifest.get("queries")
    if not isinstance(summaries, list) or len(summaries) != len(expected_queries):
        fail("PACKAGE_QUERY_SET_INVALID")
    for recipe in expected_queries:
        kind = recipe["kind"]
        query = {key: value for key, value in recipe.items() if key != "kind"}
        summary = next((x for x in summaries if x.get("kind") == kind), None)
        relative = "queries/" + kind
        if not {relative + "/" + name for name in ("manifest.json", "request.json", "execution.json",
                "result.csv", "result.parquet")} <= names:
            fail("PACKAGE_QUERY_SET_INVALID")
        native = parse(read(root / relative / "manifest.json", MAX_MANIFEST))
        if (summary is None or native.get("state") != "COMPLETE"
                or native.get("export_id") != summary.get("export_id")
                or native.get("query") != query or native.get("views") != original.get("views")
                or native.get("rows") != summary.get("rows")):
            fail("ORIGINAL_QUERY_CHANGED")
    expected_editions = {report["source_edition"], report["target_edition"]}
    sources = manifest.get("sources")
    if (not isinstance(sources, list) or len(sources) != len(expected_editions)
            or {x.get("edition_id") for x in sources} != expected_editions):
        fail("PACKAGE_SOURCES_INVALID")
    for source in sources:
        edition_id = _hex(source["edition_id"])
        prefix = "sources/" + edition_id + "/"
        declared = source.get("files")
        if not isinstance(declared, list) or not declared or not all(prefix + _name(x) in names for x in declared):
            fail("PACKAGE_SOURCES_INVALID")
    return report, files


def inspect_package(directory, *, expected_manifest_sha256=None):
    root = _path(directory)
    actual = _file(root, "manifest.json")
    if actual["bytes"] > MAX_MANIFEST:
        fail("PACKAGE_METADATA_TOO_LARGE")
    if expected_manifest_sha256 is not None and actual["sha256"] != _hex(expected_manifest_sha256):
        fail("PACKAGE_MANIFEST_CHANGED")
    manifest = parse(read(root / "manifest.json", MAX_MANIFEST))
    report, files = _verify_manifest(root, manifest)
    return {"schema": EXPORT_SCHEMA + ".inspection", "complete": True, "directory": str(root),
            "manifest_sha256": actual["sha256"], "manifest": manifest, "report": report,
            "files": files + [actual], "bytes": sum(x["bytes"] for x in files) + actual["bytes"]}


def _record(workspace, root, inspected):
    manifest = inspected["manifest"]
    record = {**manifest, "workspace": str(workspace.directory), "directory": str(root),
              "files": inspected["files"], "manifest_sha256": inspected["manifest_sha256"]}
    with workspace._guard(), workspace._connection(writeable=True) as db:
        db.execute("INSERT INTO sf_exports VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
                   [record["export_id"], _json(record)])
    return record


def export_report(workspace, body, directory):
    """Called by the original retained HTTP/CLI export request under its owner."""
    if not isinstance(body, dict) or set(body) != {"request_id", "report_id"}:
        fail("EXPORT_FIELDS_INVALID")
    request_id(body["request_id"])
    report_id = _hex(body["report_id"])
    root = _new_destination(directory, workspace.directory)
    if _path(root) != root:
        fail("PRIVATE_CANONICAL_PATH_REQUIRED")
    control = root / "reconciliation-request.json"
    complete = root / "manifest.json"
    if complete.exists():
        inspected = inspect_package(root)
        manifest = inspected["manifest"]
        original = parse(read(control, MAX_MANIFEST))
        if (manifest["request_id"] != body["request_id"] or manifest["report_id"] != report_id
                or original.get("directory") != str(root)
                or original.get("workspace") != str(workspace.directory)
                or manifest["workspace_id"] != workspace.identity()["workspace_id"]):
            fail("PACKAGE_DESTINATION_CONFLICT")
        return _record(workspace, root, inspected)
    if control.exists():
        original = parse(read(control, MAX_MANIFEST))
        if (original.get("schema") != EXPORT_SCHEMA + ".request"
                or original.get("request_id") != body["request_id"]
                or original.get("report", {}).get("report_id") != report_id
                or original.get("directory") != str(root)
                or original.get("workspace") != str(workspace.directory)
                or original.get("workspace_id") != workspace.identity()["workspace_id"]):
            fail("PACKAGE_DESTINATION_CONFLICT")
        report = Reconciliation(workspace).report(report_id)
        if original["report"] != report:
            fail("ORIGINAL_REPORT_CHANGED")
    else:
        if any(root.iterdir()):
            fail("PACKAGE_DESTINATION_NOT_EMPTY")
        model = Reconciliation(workspace)
        report = model.report(report_id)
        guide = read(Path(__file__).with_name("OPERATING.md"), MAX_MANIFEST).decode("utf-8")
        original = {"schema": EXPORT_SCHEMA + ".request", "request_id": body["request_id"],
                    "report": report, "workspace_id": workspace.identity()["workspace_id"],
                    "workspace": str(workspace.directory), "directory": str(root),
                    "views": workspace.views(), "guide": guide, "created_at": _now()}
        original["export_id"] = sha(original)
        _retain(control, _json_bytes(original))
    _retain(root / "report.json", _json_bytes(original["report"]))
    _retain(root / "OPERATING.md", original["guide"].encode("utf-8"))
    files = [_file(root, name) for name in ("reconciliation-request.json", "report.json", "OPERATING.md")]
    queries, sources = [], []
    private_directory(root / "queries")
    private_directory(root / "sources")

    def include(prefix, native):
        for item in native["files"]:
            name = prefix + "/" + _name(item["name"])
            actual = _file(root, name)
            if (actual["bytes"], actual["sha256"]) != (item["bytes"], item["sha256"]):
                fail("ORIGINAL_EXPORT_CHANGED")
            files.append(actual)

    for recipe in original["report"]["queries"]:
        kind = recipe["kind"]
        if kind not in _KINDS:
            fail("PACKAGE_QUERY_SET_INVALID")
        query = {key: value for key, value in recipe.items() if key != "kind"}
        prefix = "queries/" + kind
        native = workspace.export_query(query["query_id"], root / prefix,
                    expected_revision=query["revision"], expected_views=original["views"], retained_query=query)
        include(prefix, native)
        queries.append({"kind": kind, "query_id": query["query_id"], "revision": query["revision"],
                        "export_id": native["export_id"], "rows": native["rows"], "directory": prefix})
    for edition_id in sorted({report["source_edition"], report["target_edition"]}):
        prefix = "sources/" + edition_id
        native = workspace.export_source(edition_id, root / prefix)
        include(prefix, native)
        sources.append({"edition_id": edition_id, "directory": prefix,
                        "files": [item["name"] for item in native["files"]]})
    # Original CHECKPOINT + copy_sparse + handoff request/manifest, without any
    # new archive, SQL engine, view mutation or source acquisition.
    native = workspace.backup(root / "warehouse")
    include("warehouse", native)
    names = [x["name"] for x in files]
    if len(names) != len(set(names)):
        fail("PACKAGE_FILE_DUPLICATED")
    manifest = {"schema": EXPORT_SCHEMA, "state": "COMPLETE", "complete": True,
                "export_id": original["export_id"], "request_id": body["request_id"],
                "report_id": report_id, "report_digest": sha(original["report"]),
                "workspace_id": original["workspace_id"], "created_at": original["created_at"],
                "completed_at": _now(), "queries": queries, "sources": sources,
                "files": [_public_file(item) for item in files],
                "reopen": {"guide": "OPERATING.md", "report": "report.json",
                           "immutable_warehouse": "warehouse/warehouse.duckdb",
                           "command": "python -m stellar_forge_buyer.reconciliation.package receive --directory PACKAGE --destination NEW_PRIVATE_WORKSPACE --manifest-sha256 EXACT_SHA256"},
                "limits": {"file_bytes": MAX_FILE, "manifest_bytes": MAX_MANIFEST}}
    _retain(complete, _json_bytes(manifest))
    return _record(workspace, root, inspect_package(root))


def receive_package(directory, destination, *, expected_manifest_sha256, expected_workspace_id=None):
    """Verify the complete package, then borrow the original sparse copy/reopen.

    The received package is immutable. The distinct working warehouse can
    subsequently change; its completed receipt binds persistent native identity
    and the original report rather than claiming unchanged working-copy bytes.
    """
    expected_manifest_sha256 = _hex(expected_manifest_sha256)
    root = _path(destination)
    private_directory(root.parent)
    private_directory(root)
    receipt = root / "reconciliation-receive.json"
    control = root / "reconciliation-receive-request.json"

    def reopen(record):
        if (record.get("schema") != EXPORT_SCHEMA + ".receiving"
                or record.get("directory") != str(root)
                or record.get("manifest_sha256") != expected_manifest_sha256):
            fail("RECEIVING_BINDING_CHANGED")
        if expected_workspace_id is not None and request_id(expected_workspace_id) != record["workspace_id"]:
            fail("WORKSPACE_CHANGED")
        with DuckDBWorkspace(root) as workspace:
            if workspace.identity()["workspace_id"] != record["workspace_id"]:
                fail("WORKSPACE_CHANGED")
            if sha(Reconciliation(workspace).report(record["report_id"])) != record["report_digest"]:
                fail("ORIGINAL_REPORT_CHANGED")

    if receipt.exists():
        saved = parse(read(receipt, MAX_MANIFEST))
        if saved.get("complete") is not True:
            fail("RECEIVING_BINDING_CHANGED")
        reopen(saved)
        sync_directory(root)
        sync_directory(root.parent)
        return {**saved, "reused": True}
    # A complete copy was verified and durably published before the first native
    # reopen. Resume that same validation even if its original package moved.
    if control.exists():
        saved = parse(read(control, MAX_MANIFEST))
        if saved.get("phase") == "COPY_PUBLISHED":
            reopen(saved)
            result = {key: value for key, value in saved.items() if key != "phase"}
            result.update(complete=True, received_at=_now(), reused=True)
            _retain(receipt, _json_bytes(result))
            sync_directory(root.parent)
            return result
    inspected = inspect_package(directory, expected_manifest_sha256=expected_manifest_sha256)
    manifest, original_root = inspected["manifest"], _path(directory)
    if root == original_root or original_root in root.parents or root in original_root.parents:
        fail("RECEIVING_DIRECTORY_SEPARATE_REQUIRED")
    if expected_workspace_id is not None and request_id(expected_workspace_id) != manifest["workspace_id"]:
        fail("WORKSPACE_CHANGED")
    snapshot = next(x for x in inspected["files"] if x["name"] == "warehouse/warehouse.duckdb")
    binding = {"schema": EXPORT_SCHEMA + ".receiving", "manifest_sha256": inspected["manifest_sha256"],
               "export_id": manifest["export_id"], "report_id": manifest["report_id"],
               "report_digest": manifest["report_digest"], "workspace_id": manifest["workspace_id"],
               "directory": str(root), "warehouse_sha256": snapshot["sha256"],
               "warehouse_bytes": snapshot["bytes"]}
    from ..storage import lock
    with lock(root):
        if control.exists():
            original = parse(read(control, MAX_MANIFEST))
            if any(original.get(key) != value for key, value in binding.items()):
                fail("RECEIVING_BINDING_CHANGED")
        else:
            if any(path.name != "operation.lock" for path in root.iterdir()):
                fail("RECEIVING_DIRECTORY_IN_USE")
            original = {**binding, "phase": "COPY_PREPARED", "original_package": str(original_root),
                        "created_at": _now()}
            _retain(control, _json_bytes(original))
        output = root / "warehouse.duckdb"
        partial = root / "reconciliation-warehouse.partial"
        allowed = {"operation.lock", control.name, output.name, partial.name}
        if any(path.name not in allowed for path in root.iterdir()):
            fail("RECEIVING_DIRECTORY_IN_USE")
        if output.exists() and partial.exists():
            left, right = output.lstat(), partial.lstat()
            if (left.st_dev, left.st_ino) != (right.st_dev, right.st_ino) or left.st_nlink != 2:
                fail("RECEIVING_PUBLICATION_CONFLICT")
            # Only our exact no-replace link's temporary name is retired.
            sync_directory(root)
            os.unlink(partial)
            sync_directory(root)
        if output.exists():
            actual = _file(root, output.name)
            if (actual["bytes"], actual["sha256"]) != (snapshot["bytes"], snapshot["sha256"]):
                fail("RECEIVING_WAREHOUSE_CHANGED")
        else:
            complete_partial = False
            if partial.exists():
                actual = _file(root, partial.name)
                complete_partial = (actual["bytes"], actual["sha256"]) == (snapshot["bytes"], snapshot["sha256"])
            if not complete_partial:
                # The durable exact binding above owns this temporary working
                # copy. Restart its incomplete local copy from the same verified
                # immutable snapshot; no input, query or export is rerun.
                source_fd = os.open(original_root / snapshot["name"], os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(source_fd, "rb") as source:
                    flags = os.O_RDWR | os.O_NOFOLLOW | (os.O_TRUNC if partial.exists() else os.O_CREAT | os.O_EXCL)
                    target_fd = os.open(partial, flags, 0o600)
                    with os.fdopen(target_fd, "wb") as target:
                        copy_sparse(source, target)
                        target.flush()
                        os.fsync(target.fileno())
                actual = _file(root, partial.name)
                if (actual["bytes"], actual["sha256"]) != (snapshot["bytes"], snapshot["sha256"]):
                    fail("RECEIVING_WAREHOUSE_CHANGED")
            os.link(partial, output)
            sync_directory(root)
            os.unlink(partial)
            sync_directory(root)
        original["phase"] = "COPY_PUBLISHED"
        write(control, _json_bytes(original))
    reopen(original)
    result = {key: value for key, value in original.items() if key != "phase"}
    result.update(complete=True, received_at=_now(), reused=False)
    _retain(receipt, _json_bytes(result))
    sync_directory(root.parent)
    return result


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--directory", required=True)
    inspect.add_argument("--manifest-sha256")
    receive = commands.add_parser("receive")
    receive.add_argument("--directory", required=True)
    receive.add_argument("--destination", required=True)
    receive.add_argument("--manifest-sha256", required=True)
    receive.add_argument("--workspace-id")
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = inspect_package(args.directory, expected_manifest_sha256=args.manifest_sha256)
    else:
        result = receive_package(args.directory, args.destination,
                    expected_manifest_sha256=args.manifest_sha256, expected_workspace_id=args.workspace_id)
    print(_json(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
