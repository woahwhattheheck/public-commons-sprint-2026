#!/usr/bin/env python3
"""Receive a completed original watershed calculation into a retained Workspace."""
from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_bytes, atomic_json, describe_file, held, now, read_json, verify_file

SCHEMA = "upstate.operator-watershed-context/v1"
MODEL_SCHEMA = "upstate.watershed-context/v1"
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _member(name):
    if (not isinstance(name, str) or not name or "\\" in name or "\0" in name
            or name.startswith("/") or any(part in {"", ".", ".."} for part in name.split("/"))):
        raise ValueError("Retain an ordinary relative archive member")
    return PurePosixPath(name)


def _matches(body, descriptor, name):
    length = descriptor.get("bytes")
    digest = descriptor.get("sha256")
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
            raise ValueError("The completed watershed archive exceeds the receiving capacity")
        body = path.read_bytes()
    if len(body) > MAX_ARCHIVE_BYTES:
        raise ValueError("The completed watershed archive exceeds the receiving capacity")
    return body


def inspect_completed_archive(source, *, expected_sha256=None):
    """Read original result/source manifests and retain their actual complete bytes."""
    archive_body = _archive_bytes(source)
    archive_sha = _hash(archive_body)
    if expected_sha256 is not None and archive_sha != expected_sha256:
        raise ValueError("The original completed watershed archive changed")
    with zipfile.ZipFile(io.BytesIO(archive_body)) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(item.file_size for item in entries) > MAX_MEMBER_BYTES:
            raise ValueError("The completed watershed members exceed the receiving capacity")
        indexed = {}
        for item in entries:
            if item.is_dir():
                _member(item.filename.rstrip("/"))
                continue
            _member(item.filename)
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                raise ValueError("Receive regular original source and report files")
            if item.filename in indexed:
                raise ValueError("Repeated completed watershed archive member")
            indexed[item.filename] = item

        def read(name):
            if name not in indexed:
                raise ValueError("Retain the original completed watershed member: " + name)
            return archive.read(indexed[name])

        def document(name):
            return json.loads(read(name).decode("utf-8-sig"))

        run_body = read("run-receipt.json")
        run = json.loads(run_body.decode("utf-8-sig"))
        if run.get("returncode") != 0 or not run.get("completed_at"):
            raise ValueError("Receive the completed original watershed operation")
        source_receipt_name = run.get("source_receipt")
        _member(source_receipt_name)
        source_receipt_body = read(source_receipt_name)
        source_receipt = json.loads(source_receipt_body.decode("utf-8-sig"))
        original_sources = {}
        for item in source_receipt.get("files", []):
            name = item.get("path")
            _member(name)
            if name in original_sources:
                raise ValueError("Repeated original watershed source record")
            original_sources[name] = _matches(read("application/" + name), item, name)
        if not original_sources:
            raise ValueError("Retain the original watershed calculation sources")

        result = run.get("result") or {}
        descriptors = result.get("files") or {}
        if not isinstance(descriptors, dict) or "watershed-context.json" not in descriptors:
            raise ValueError("Retain the original complete regional report manifest")
        candidates = [name for name in indexed
                      if name.startswith("application/") and name.endswith("/watershed-context.json")]
        if len(candidates) != 1:
            raise ValueError("Choose one completed original regional report")
        report_member = candidates[0]
        report_prefix = report_member.rsplit("/", 1)[0] + "/"
        outputs = {}
        for name, item in descriptors.items():
            if _member(name).name != name or item.get("path") != name:
                raise ValueError("Retain the original report output filenames")
            outputs[name] = _matches(read(report_prefix + name), item, name)
        report = json.loads(outputs["watershed-context.json"].decode("utf-8-sig"))
        key = report.get("id")
        if (report.get("schema") != MODEL_SCHEMA or not isinstance(key, str)
                or not re.fullmatch(r"watershed-[0-9a-f]{20}", key) or result.get("id") != key
                or result.get("summary") != report.get("summary")):
            raise ValueError("The completed regional report differs from its original operation")

        def source_document(filename, required=True):
            choices = [(name, body) for name, body in original_sources.items()
                       if PurePosixPath(name).name == filename]
            if not choices and not required:
                return None
            if len(choices) != 1:
                raise ValueError("Retain one original watershed source: " + filename)
            return json.loads(choices[0][1].decode("utf-8-sig"))

        context = source_document("full-domain-water-context.json")
        coverage = source_document("scdes-domain217-source-coverage.json")
        network_names = ("native-network.json", "native-network.json.gz")
        network_members = [(name, body) for name, body in original_sources.items()
                           if PurePosixPath(name).name in network_names]
        if len(network_members) > 1:
            raise ValueError("Retain one original watershed native network")
        network = None
        if network_members:
            network_body = network_members[0][1]
            network = json.loads(
                (gzip.decompress(network_body) if network_body.startswith(b"\x1f\x8b")
                 else network_body).decode("utf-8-sig"))
        if context.get("schema") != "upstate.water-context/v1":
            raise ValueError("Retain the original watershed domain source")
        originals = {"water_context": context, "classification_coverage": coverage}
        if network is not None:
            originals["native_network"] = network
        sources = report.get("sources") or []
        if len(sources) != len(originals) or {row.get("source_id") for row in sources} != set(originals):
            raise ValueError("The completed report source set differs from its original input")
        for row in sources:
            if _hash(_canonical(originals[row["source_id"]])) != row.get("canonical_sha256"):
                raise ValueError("The completed report changed its original source binding")
        domain = context.get("model_domain_huc12s")
        rows = report.get("hucs")
        if (not isinstance(domain, list) or not domain or len(set(domain)) != len(domain)
                or not isinstance(rows, list) or len(rows) != len(domain)
                or {row.get("huc12") for row in rows} != set(domain)
                or set(report.get("model_domain_huc12s", [])) != set(domain)
                or report["summary"].get("huc_count") != len(domain)):
            raise ValueError("The completed report must retain its whole original model domain")
        selection = report.get("selection") or {}
        selected = selection.get("huc12s")
        if (not isinstance(selected, list) or sorted(set(selected)) != selected
                or set(selected) - set(domain)
                or not isinstance(selection.get("requested"), bool)):
            raise ValueError("Retain the original selected watersheds within the full report")
        identity = {
            "schema": report["schema"], "analysis_version": report["analysis_version"],
            "source_context": context, "classification_coverage": coverage, "network": network,
            "selected_huc12s": selected, "selection_requested": selection["requested"],
        }
        if "watershed-" + _hash(_canonical(identity))[:20] != key:
            raise ValueError("The completed regional report's original identity changed")
        if run.get("selection") is not None and run["selection"] != selection:
            raise ValueError("The original operation and report selections differ")
        stdout = read("stdout.json")
        if _hash(stdout) != run.get("stdout_sha256"):
            raise ValueError("The original completed operation output changed")
        if json.loads(stdout.decode("utf-8-sig")) != result:
            raise ValueError("The original operation output and result manifest differ")
        provenance = {"run-receipt.json": run_body,
                      "source-receipt.json": source_receipt_body, "stdout.json": stdout}
        if "stderr.txt" in indexed:
            provenance["stderr.txt"] = read("stderr.txt")
        return {"archive": archive_body, "archive_sha256": archive_sha,
                "run": run, "report": report, "outputs": outputs,
                "original_sources": original_sources, "provenance": provenance}


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


def _native_bundle(source, received):
    """Use the maintained original-invocation and source-bank receiver contract."""
    path = APPLICATION / "operator" / "receive_watershed_context.py"
    spec = importlib.util.spec_from_file_location("upstate_native_watershed_receiver", path)
    if spec is None or spec.loader is None:
        raise ValueError("Install the maintained native watershed receiver.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    operation_id = received["run"].get("operation_id")
    if not isinstance(operation_id, str) or not operation_id:
        raise ValueError("Retain the original native watershed operation identity.")
    if isinstance(source, bytes):
        with tempfile.TemporaryDirectory(prefix="upstate-regional-receive-") as temporary:
            archive = Path(temporary) / "original-native-result.zip"
            archive.write_bytes(source)
            return module.receive_bundle(archive, received["archive_sha256"], operation_id)
    return module.receive_bundle(Path(source), received["archive_sha256"], operation_id)


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
    """Publish an already completed report through the original operator representation."""
    received = inspect_completed_archive(source, expected_sha256=expected_sha256)
    bundle = _native_bundle(source, received)
    report, run = received["report"], received["run"]
    if bundle["id"] != report["id"] or bundle["report"] != report:
        raise ValueError("The completed report differs between its retained native records")
    key = report["id"]
    connectivity = _completed_connectivity(
        connectivity_root or APPLICATION / "outputs/watershed-connectivity-20261013",
        report, received["outputs"]["watershed-context.json"])
    directory = workspace.root / "watershed-context" / key
    record_path = directory / "operator-report.json"
    with held(workspace.root / ".workspace.lock"):
        if directory.parent.is_symlink() or directory.is_symlink():
            raise ValueError("Receive into the original workspace report directory")
        if record_path.is_file():
            existing = read_json(record_path)
            if (existing.get("schema") != SCHEMA or existing.get("id") != key
                    or existing.get("files", {}).get("watershed-context.json", {}).get("sha256")
                    != _hash(received["outputs"]["watershed-context.json"])):
                raise ValueError("The saved watershed identity belongs to another retained result")
            for descriptor in existing["files"].values():
                verify_file(directory, descriptor)
            existing = _retain_native_bundle(directory, existing, bundle)
            return _retain_connectivity(directory, existing, connectivity)
        directory.parent.mkdir(parents=True, exist_ok=True)
        pending = Path(tempfile.mkdtemp(prefix=".receive-watershed-", dir=directory.parent))
        try:
            bodies = dict(bundle["files"])
            bodies.update({"source/" + name: body
                           for name, body in received["original_sources"].items()})
            bodies.update({"receiving/" + name: body
                           for name, body in received["provenance"].items()})
            bodies["receiving/source-archive.zip"] = received["archive"]
            files = {}
            for name, body in sorted(bodies.items()):
                path = pending.joinpath(*_member(name).parts)
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("xb") as output:
                    output.write(body)
                    output.flush()
                    os.fsync(output.fileno())
                files[name] = describe_file(pending, path)
            source_inputs = bundle["source_inputs"]
            fingerprint = bundle["source_fingerprint"]
            record = {
                "schema": SCHEMA, "id": key,
                "title": str(title or report.get("title") or "Regional watershed context"),
                "state": "complete", "created_at": run.get("started_at") or run["completed_at"],
                "completed_at": run["completed_at"], "received_at": now(),
                "summary": report["summary"], "selection": report["selection"],
                "source_fingerprint": fingerprint, "source_inputs": source_inputs,
                "native_source_files": bundle["source_files"],
                "source_validation": {
                    "state": "received_completed_original",
                    "whole_domain_huc_count": len(report["hucs"]),
                    "native_source_bank_sha256": bundle["source"]["source_bank_sha256"],
                    "native_source_bank_archive_sha256": bundle["source_bank_archive_sha256"],
                },
                "receiving": {"operation_id": run.get("operation_id"),
                              "archive_bytes": len(received["archive"]),
                              "archive_sha256": received["archive_sha256"],
                              "original_result_id": key},
                "files": files,
            }
            atomic_json(pending / "operator-report.json", record)
            if directory.exists():
                # Resume only matching original bodies from an interrupted receive.
                for path in directory.rglob("*"):
                    if path.is_symlink():
                        raise ValueError("Receive original regular report members")
                    if path.is_dir():
                        continue
                    name = path.relative_to(directory).as_posix()
                    if path.is_symlink() or name not in files:
                        raise ValueError("Retain the unfinished regional report source before receiving")
                    verify_file(directory, files[name])
                for name in files:
                    target = directory.joinpath(*_member(name).parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(pending.joinpath(*_member(name).parts), target)
                os.replace(pending / "operator-report.json", record_path)
            else:
                os.replace(pending, directory)
            return _retain_connectivity(directory, record, connectivity)
        finally:
            if pending.exists():
                shutil.rmtree(pending)


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
