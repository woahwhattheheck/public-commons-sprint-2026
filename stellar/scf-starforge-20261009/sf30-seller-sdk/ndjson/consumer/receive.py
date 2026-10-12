#!/usr/bin/env python3
"""Receive an original SF88 dataset and restore its original NDJSON release."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
NDJSON = HERE.parent
SDK = NDJSON.parent
CHECKOUT = SDK.parents[2]
HASH = re.compile(r"[a-f0-9]{64}\Z")
OUTPUTS = ("dataset.jsonl", "dataset.csv", "review.html", "manifest.json")
SOURCE_SCHEMA = "stellar-forge.ndjson-release-source.v1"


class NdjsonReceivingError(ValueError):
    def __init__(self, code, **details):
        self.code, self.details = code, details
        super().__init__(code)


def require(condition, code, **details):
    if not condition:
        raise NdjsonReceivingError(code, **details)


def _hash(value, name):
    require(isinstance(value, str) and HASH.fullmatch(value), "NDJSON_EXPECTED_ID_REQUIRED", field=name)
    return value


def _directory(value, *, exists=True):
    path = Path(os.path.abspath(Path(value).expanduser()))
    require(not path.is_symlink(), "NDJSON_REAL_DIRECTORY_REQUIRED", path=str(path))
    if exists:
        require(path.is_dir() and path.resolve(strict=True) == path,
                "NDJSON_REAL_DIRECTORY_REQUIRED", path=str(path))
    else:
        require(path.parent.resolve(strict=True) == path.parent,
                "NDJSON_REAL_DIRECTORY_REQUIRED", path=str(path))
    return path


def _application():
    expected = {"workspace": SDK / "xml/workspace.py",
                "server": SDK / "xml/server.py",
                "ndjson_source": NDJSON / "ndjson_source.py",
                "application": NDJSON / "application.py"}
    for name, path in expected.items():
        current = sys.modules.get(name)
        require(current is None or Path(current.__file__).resolve() == path,
                "NDJSON_ORIGINAL_MODULE_CONFLICT", module=name)
    sys.path.insert(0, str(NDJSON))
    try:
        module = importlib.import_module("application")
    finally:
        sys.path.remove(str(NDJSON))
    require(Path(module.__file__).resolve() == expected["application"],
            "NDJSON_ORIGINAL_APPLICATION_REQUIRED")
    return module


def _buyer(checkout):
    checkout = _directory(checkout)
    python = checkout / "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
    expected = python / "stellar_forge_buyer/datasets.py"
    require(expected.is_file(), "NDJSON_ORIGINAL_SF88_REQUIRED")
    current = sys.modules.get("stellar_forge_buyer.datasets")
    require(current is None or Path(current.__file__).resolve() == expected,
            "NDJSON_ORIGINAL_SF88_CONFLICT")
    sys.path.insert(0, str(python))
    try:
        module = importlib.import_module("stellar_forge_buyer.datasets")
    finally:
        sys.path.remove(str(python))
    require(Path(module.__file__).resolve() == expected, "NDJSON_ORIGINAL_SF88_REQUIRED")
    return module, checkout


def inspect_release(directory, *, expected_build, expected_snapshot, node="node", timeout=360):
    """Use the native SF82 preparer and original NDJSON source association."""
    directory = _directory(directory)
    _hash(expected_build, "build"); _hash(expected_snapshot, "snapshot")
    run = subprocess.run(
        [node, str(NDJSON / "merchant.mjs"), "release-status", "--package", str(directory)],
        capture_output=True, timeout=timeout, check=False)
    require(run.returncode == 0, "NDJSON_RELEASE_INSPECTION_FAILED",
            native_error=run.stderr.decode("utf-8", "replace")[-3000:])
    require(len(run.stdout) <= 4 * 1024 * 1024, "NDJSON_RELEASE_RESULT_TOO_LARGE")
    application = _application()
    result = application.load_json(run.stdout)
    require(isinstance(result, dict) and result.get("schema") == SOURCE_SCHEMA
            and result.get("directory") == str(directory)
            and result.get("build") == expected_build and result.get("snapshot") == expected_snapshot,
            "NDJSON_RELEASE_SELECTION_CHANGED")
    return result


def _delivery_view(delivery, release):
    """Consume the existing original outputs through their exact file readers."""
    application = _application()
    report = delivery.native
    require(isinstance(report, dict) and report.get("schema") == "stellar-forge.sf88.dataset-delivery.v1"
            and report.get("nativeStatus", {}).get("finalized") is True
            and report["nativeStatus"].get("snapshot") == release["snapshot"],
            "NDJSON_ACQUISITION_SNAPSHOT_CHANGED")
    with delivery.file("manifest.json").open() as stream:
        raw = stream.read(4 * 1024 * 1024 + 1)
    require(len(raw) <= 4 * 1024 * 1024, "NDJSON_DELIVERY_MANIFEST_TOO_LARGE")
    manifest = application.load_json(raw)
    require(isinstance(manifest, dict), "NDJSON_ORIGINAL_DELIVERY_MANIFEST_CHANGED")
    dataset = manifest.get("dataset", {}) if isinstance(manifest, dict) else {}
    fields = dataset.get("projectedFields")
    require(manifest.get("schema") == "stellar-forge.buyer-delivery-manifest.v1"
            and dataset.get("snapshot") == release["snapshot"]
            and dataset.get("rows") == report["nativeStatus"].get("rows")
            and type(dataset.get("rows")) is int and dataset["rows"] >= 0
            and isinstance(fields, list) and fields and all(isinstance(field, str) for field in fields)
            and len(fields) == len(set(fields)),
            "NDJSON_ORIGINAL_DELIVERY_MANIFEST_CHANGED")
    available = {column["name"] for column in release["description"]["columns"]}
    require(set(fields) <= available, "NDJSON_DELIVERED_COLUMNS_CHANGED")
    for name in OUTPUTS:
        if name != "manifest.json":
            recorded, exported = report.get("outputs", {}).get(name), manifest.get("outputs", {}).get(name)
            require(isinstance(recorded, dict) and isinstance(exported, dict)
                    and recorded.get("sha256") == exported.get("sha256")
                    and recorded.get("bytes") == exported.get("bytes"),
                    "NDJSON_DELIVERY_OUTPUT_CHANGED", file=name)
        # The original file object checks its saved hash, size and private path.
        with delivery.file(name).open() as stream:
            while stream.read(65536):
                pass
    rows = 0
    for row in delivery.jsonl_rows():
        require(set(row) == set(fields), "NDJSON_DELIVERED_ROW_SHAPE_CHANGED")
        rows += 1
    require(rows == dataset["rows"], "NDJSON_DELIVERED_ROW_COUNT_CHANGED")
    return {"directory": str(delivery.directory), "sourceDirectory": report["sourceDirectory"],
            "sourceBindingSha256": report.get("sourceBindingSha256"), "rows": rows,
            "projectedFields": fields, "nativeStatus": report["nativeStatus"],
            "paymentStatus": report["paymentStatus"], "outputs": report["outputs"]}


def _restore(workspace, release, *, query=None, compare=None, project=None):
    application = _application()
    require(isinstance(workspace, application.Workspace), "NDJSON_ORIGINAL_WORKSPACE_REQUIRED")
    root = Path(release["directory"])
    with workspace.mutex:
        try:
            workspace.build_view(release["build"])
            reused = True
        except application.InputError:
            reused = False
        source_file = root / "source/source.ndjson"
        require(application.file_digest(source_file) == release["source"], "NDJSON_SOURCE_CHANGED")
        with source_file.open("rb") as stream:
            source = workspace.add_source(stream, "Received NDJSON edition", "source.ndjson")
        plan_bytes = (root / "source/plan.json").read_bytes()
        require(hashlib.sha256(plan_bytes).hexdigest() == release["plan"], "NDJSON_MAPPING_CHANGED")
        plan = workspace.save_plan(application.load_json(plan_bytes))
        require(source["id"] == release["source"] and plan["id"] == release["plan"],
                "NDJSON_RESTORED_SOURCE_MAPPING_CHANGED")
        build = workspace.build(source["id"], plan["id"], expected=release["lineage"])
        require(build["id"] == release["build"] and build["native"]["snapshot"] == release["snapshot"],
                "NDJSON_RESTORED_EDITION_CHANGED")
        result = {"schema": "stellar-forge.ndjson-received.v1", "workspace": str(workspace.root),
                  "releaseDirectory": str(root), "source": source["id"], "plan": plan["id"],
                  "build": build["id"], "snapshot": build["native"]["snapshot"],
                  "rowCount": build["rowCount"], "reused": reused}
        if query is not None:
            result["query"] = workspace.query(build["id"], query)
        if compare is not None:
            result["comparison"] = workspace.compare(_hash(compare, "comparison build"), build["id"])
        if project is not None:
            path = Path(os.path.abspath(Path(project).expanduser()))
            require(not path.is_symlink() and path.parent.resolve(strict=True) == path.parent,
                    "NDJSON_REAL_PROJECT_PATH_REQUIRED")
            if path.exists():
                reopened = workspace.import_packet(path)
                require(reopened["build"]["id"] == build["id"], "NDJSON_EXISTING_PROJECT_EDITION_CHANGED")
                result["project"] = {"file": str(path), "bytes": path.stat().st_size,
                                     "sha256": application.file_digest(path, 512 * 1024 * 1024),
                                     "build": build["id"], "reused": True}
            else:
                result["project"] = {**workspace.export_packet(build["id"], path), "reused": False}
        return result


def restore_into(workspace, directory, *, expected_build, expected_snapshot,
                 node="node", timeout=360, query=None, compare=None, project=None):
    """Restore while the caller keeps its original workspace/process lease."""
    release = inspect_release(directory, expected_build=expected_build,
                              expected_snapshot=expected_snapshot, node=node, timeout=timeout)
    return _restore(workspace, release, query=query, compare=compare, project=project)


def restore_release(directory, workspace_directory, *, expected_build, expected_snapshot,
                    node="node", timeout=360, query=None, compare=None, project=None):
    """Create or reopen one original retained workspace from the same SF82 source."""
    release = inspect_release(directory, expected_build=expected_build,
                              expected_snapshot=expected_snapshot, node=node, timeout=timeout)
    target = _directory(workspace_directory, exists=os.path.lexists(workspace_directory))
    application = _application()
    with application.Workspace(target, create=not target.exists()) as workspace:
        return _restore(workspace, release, query=query, compare=compare, project=project)


def receive_acquisition(acquisition, delivery_directory, release_directory, workspace_directory, *,
                        expected_build, expected_snapshot, node="node", timeout=360,
                        query=None, compare=None, project=None, checkout=CHECKOUT):
    """Original SF88 delivery plus its reviewed complete source association."""
    release = inspect_release(release_directory, expected_build=expected_build,
                              expected_snapshot=expected_snapshot, node=node, timeout=timeout)
    module, _ = _buyer(checkout)
    require(isinstance(acquisition, module.DatasetAcquisition), "NDJSON_ORIGINAL_ACQUISITION_REQUIRED")
    delivery = acquisition.deliver(delivery_directory)
    received = _delivery_view(delivery, release)
    target = _directory(workspace_directory, exists=os.path.lexists(workspace_directory))
    application = _application()
    with application.Workspace(target, create=not target.exists()) as workspace:
        restored = _restore(workspace, release, query=query, compare=compare, project=project)
    return {**restored, "acquisition": received}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("receive", "restore"))
    parser.add_argument("--release", required=True, help="The same original SF82 NDJSON package directory")
    parser.add_argument("--workspace", required=True, help="Create or reopen this original NDJSON workspace")
    parser.add_argument("--build", required=True, help="Reviewed original source build SHA256")
    parser.add_argument("--snapshot", required=True, help="Reviewed original native dataset snapshot")
    parser.add_argument("--checkout", default=str(CHECKOUT), help="Selected original SF88 source checkout")
    parser.add_argument("--session", help="Existing original SF88 acquisition session")
    parser.add_argument("--delivery", help="Original SF100 data room destination")
    parser.add_argument("--project", help="Export or verify/reopen the original six-file project ZIP")
    parser.add_argument("--compare", help="Compare this received edition to a retained build in the same mapping")
    parser.add_argument("--query", help='Native query object with string values, for example {"limit":"20"}')
    parser.add_argument("--node", default=os.environ.get("SF30_XML_NODE", "node"))
    parser.add_argument("--timeout", type=float, default=360)
    args = parser.parse_args(argv)
    try:
        application = _application()
        os.environ["SF30_XML_NODE"] = args.node
        require(args.timeout > 0, "NDJSON_TIMEOUT_MUST_BE_POSITIVE")
        options = {"expected_build": args.build, "expected_snapshot": args.snapshot,
                   "node": args.node, "timeout": args.timeout, "compare": args.compare,
                   "project": args.project,
                   "query": application.load_json(args.query) if args.query is not None else None}
        if args.command == "receive":
            require(args.session and args.delivery, "NDJSON_SESSION_AND_DELIVERY_REQUIRED")
            buyer, checkout = _buyer(args.checkout)
            acquisition = buyer.DatasetAcquisition(checkout=checkout, session=args.session,
                                                   node=args.node, timeout=args.timeout)
            result = receive_acquisition(acquisition, args.delivery, args.release, args.workspace,
                                         checkout=checkout, **options)
        else:
            require(args.session is None and args.delivery is None, "NDJSON_RESTORE_ACCEPTS_SOURCE_PACKAGE")
            result = restore_release(args.release, args.workspace, **options)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        result = {"error": getattr(error, "code", type(error).__name__), "message": str(error)}
        if hasattr(error, "details"):
            result["details"] = error.details
        if getattr(error, "native", None) is not None:
            result["native"] = error.native
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, default=str), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
