#!/usr/bin/env python3
"""Receive original regional archives through the maintained native receiver."""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import stat
import tempfile
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_bytes, atomic_json, describe_file, held, read_json, verify_file

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _member(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or name.startswith("/") or any(part in {"", ".", ".."} for part in name.split("/"))):
        raise ValueError("Retain an ordinary relative source member")
    return PurePosixPath(name)


def _matches(body, descriptor, name):
    length, digest = descriptor.get("bytes"), descriptor.get("sha256")
    if (isinstance(length, bool) or not isinstance(length, int) or length < 0
            or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or len(body) != length or _hash(body) != digest):
        raise ValueError("Completed watershed member changed: " + name)
    return body


def _archive_bytes(source):
    if isinstance(source, bytes):
        body = source
    else:
        path = Path(source)
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("The completed archive exceeds the receiving capacity")
        body = path.read_bytes()
    if len(body) > MAX_ARCHIVE_BYTES:
        raise ValueError("The completed archive exceeds the receiving capacity")
    return body


def _native_receiver():
    path = APPLICATION / "operator" / "receive_watershed_context.py"
    spec = importlib.util.spec_from_file_location("_upstate_completed_watershed_receiver", path)
    if spec is None or spec.loader is None:
        raise ValueError("Install the maintained regional native receiver")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _completed_connectivity(source_root, report, report_body):
    """Read a byte-bound completed graph analysis for this exact regional result."""
    root = Path(source_root)
    manifest_path = root / "connectivity-manifest.json"
    if not manifest_path.is_file():
        return None
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.watershed-connectivity-artifact/v1":
        raise ValueError("Choose a retained completed connectivity edition")
    if manifest.get("source_context_id") != report["id"]:
        return None
    if manifest.get("source_report_sha256") != _hash(report_body):
        raise ValueError("The completed connectivity edition belongs to different report bytes")
    expected_names = {"WATERSHED_CONNECTIVITY.md", "watershed-connectivity-217.csv",
                      "watershed-connectivity-summary.json"}
    descriptors = manifest.get("files") or {}
    if set(descriptors) != expected_names:
        raise ValueError("Retain the complete connectivity report, rows and source summary")
    bodies = {}
    for name, descriptor in descriptors.items():
        if descriptor.get("path") != name or _member(name).name != name:
            raise ValueError("Retain original connectivity filenames")
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Retain original regular connectivity files")
        bodies[name] = _matches(path.read_bytes(), descriptor, name)
    summary = json.loads(bodies["watershed-connectivity-summary.json"])
    if (summary.get("schema") != "upstate.watershed-connectivity/v1"
            or summary.get("source_context_id") != report["id"]
            or summary.get("domain_huc_count") != len(report["hucs"])
            or summary.get("sources", {}).get("original_regional_report", {}).get("sha256")
            != _hash(report_body)):
        raise ValueError("The completed connectivity summary changed its regional source")
    rows = list(csv.DictReader(io.StringIO(bodies["watershed-connectivity-217.csv"].decode("utf-8-sig"))))
    domain = {row["huc12"]: row for row in report["hucs"]}
    if len(rows) != len(domain) or {row.get("huc12") for row in rows} != set(domain):
        raise ValueError("Connectivity rows must retain the entire original watershed domain")
    for row in rows:
        focal = domain[row["huc12"]]
        if (float(row["focal_area_acres"]) != focal["area_acres"]
                or row["focal_priority"] != str(focal["priority"]).lower()
                or int(row["focal_selected_classifications"]) != focal["selected_classification_count"]):
            raise ValueError("Connectivity row changed its original watershed attributes")
    if manifest.get("native_topology") != summary.get("sources", {}).get("native_topology"):
        raise ValueError("The completed connectivity native source differs from its manifest")
    bodies["connectivity-manifest.json"] = manifest_path.read_bytes()
    return {"bodies": {"connectivity/" + name: body for name, body in bodies.items()},
            "summary": summary, "source_manifest": manifest}


def _retain_connectivity(directory, record, connectivity):
    if connectivity is None:
        return record
    files = dict(record["files"])
    for name, body in connectivity["bodies"].items():
        target = directory.joinpath(*_member(name).parts)
        if target.is_symlink() or target.parent.is_symlink():
            raise ValueError("Retain ordinary completed connectivity files")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != body:
                raise ValueError("The retained completed connectivity file differs: " + name)
        else:
            handle, temporary = tempfile.mkstemp(prefix=".connectivity-", dir=target.parent)
            try:
                with os.fdopen(handle, "wb") as output:
                    output.write(body)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        files[name] = describe_file(directory, target)
    joined = {**record, "files": files, "connectivity": connectivity["summary"],
              "connectivity_source": connectivity["source_manifest"]}
    atomic_json(directory / "operator-report.json", joined)
    return joined


def _retain_native_bundle(directory, record, bundle):
    """Enrich a matching report with canonical inputs and complete native sources."""
    edition = record.get("source_edition")
    if edition is not None:
        if (edition.get("model_input_fingerprint") != bundle["source_fingerprint"]
                or record.get("source_fingerprint") != bundle["source_fingerprint"]):
            raise ValueError("The completed native inputs differ from the bound source edition")
    files = dict(record["files"])
    for name, body in bundle["files"].items():
        target = directory.joinpath(*_member(name).parts)
        if target.is_symlink() or target.parent.is_symlink():
            raise ValueError("Retain original regular native watershed files")
        if target.exists() and target.read_bytes() != body:
            raise ValueError("The saved original native member differs: " + name)
        expected = files.get(name)
        if expected and (expected.get("path") != name or expected.get("sha256") != _hash(body)
                         or expected.get("bytes") != len(body)):
            raise ValueError("The saved native member descriptor differs: " + name)
        atomic_bytes(target, body, immutable=True)
        files[name] = describe_file(directory, target)
    joined = {
        **record, "files": files,
        "source_inputs": bundle["source_inputs"],
        "source_fingerprint": bundle["source_fingerprint"],
        "native_source_files": bundle["source_files"],
        "source_validation": {
            **record.get("source_validation", {}),
            "native_source_bank_sha256": bundle["source"]["source_bank_sha256"],
            "native_source_bank_archive_sha256": bundle["source_bank_archive_sha256"],
        },
    }
    if joined != record:
        atomic_json(directory / "operator-report.json", joined)
    return joined


def receive_completed(workspace, source, *, expected_sha256=None, title=None,
                      connectivity_root=None):
    """Use the existing adoption engine, then retain its source-bound graph edition."""
    body = _archive_bytes(source)
    digest = _hash(body)
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("The original completed watershed archive changed")
    with zipfile.ZipFile(io.BytesIO(body)) as package:
        entries = package.infolist()
        if len(entries) > 5000 or sum(entry.file_size for entry in entries) > MAX_MEMBER_BYTES:
            raise ValueError("The completed members exceed the receiving capacity")
        seen = set()
        for entry in entries:
            _member(entry.filename.rstrip("/") if entry.is_dir() else entry.filename)
            if entry.filename in seen:
                raise ValueError("Repeated completed watershed archive member")
            seen.add(entry.filename)
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (not entry.is_dir() and stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("Receive original regular watershed source and report files")
        run = json.loads(package.read("run-receipt.json"))
    operation_id = run.get("operation_id")
    if not isinstance(operation_id, str) or not operation_id:
        raise ValueError("Retain the original regional operation identifier")
    receiver = _native_receiver()
    with tempfile.TemporaryDirectory(prefix="upstate-completed-watershed-") as temporary:
        archive = Path(temporary) / "original-native-result.zip"
        archive.write_bytes(body)
        bundle = receiver.receive_bundle(archive, digest, operation_id)
        directory = workspace.root / "watershed-context" / bundle["id"]
        with held(workspace.root / ".workspace.lock"):
            record_path = directory / "operator-report.json"
            if record_path.is_file():
                record = read_json(record_path)
                if (record.get("id") != bundle["id"]
                        or record.get("schema") != receiver.OPERATOR_SCHEMA
                        or record.get("files", {}).get("watershed-context.json", {}).get("sha256")
                        != _hash(bundle["files"]["watershed-context.json"])):
                    raise ValueError("The completed native report differs from the saved result")
                for descriptor in record["files"].values():
                    verify_file(directory, descriptor)
                _retain_native_bundle(directory, record, bundle)
        result = receiver.adopt(
            APPLICATION, workspace.root, archive, digest, operation_id=operation_id,
            expected_report_id=(run.get("result") or {}).get("id"))
    directory = workspace.root / "watershed-context" / result["id"]
    with held(workspace.root / ".workspace.lock"):
        record = read_json(directory / "operator-report.json")
        report_body = (directory / "watershed-context.json").read_bytes()
        report = json.loads(report_body)
        connectivity = _completed_connectivity(
            connectivity_root or APPLICATION / "outputs/watershed-connectivity-20261013",
            report, report_body)
        if title is not None:
            record = {**record, "title": str(title)}
            atomic_json(directory / "operator-report.json", record)
        return _retain_connectivity(directory, record, connectivity)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--archive", type=Path)
    inputs.add_argument("--source-package", type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--title")
    parser.add_argument("--connectivity-root", type=Path,
                        help="Completed graph edition bound to this original regional result")
    args = parser.parse_args(argv)
    source, expected = args.archive, args.expected_sha256
    if args.source_package:
        package = json.loads(args.source_package.read_text(encoding="utf-8-sig"))
        if package.get("schema") != "commons.artifact-base64/v1":
            raise ValueError("Receive the original complete artifact package")
        source = base64.b64decode(package["content_base64"], validate=True)
        _matches(source, package, package.get("filename", "archive"))
        if expected is not None and expected != package["sha256"]:
            raise ValueError("The selected original archive identity differs")
        expected = package["sha256"]
    from model.workspace import Workspace
    record = receive_completed(Workspace(args.workspace), source,
                               expected_sha256=expected, title=args.title,
                               connectivity_root=args.connectivity_root)
    print(json.dumps({"id": record["id"], "state": record["state"],
                      "summary": record["summary"], "selection": record.get("selection"),
                      "record_path": str(args.workspace / "watershed-context" /
                                         record["id"] / "operator-report.json")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
