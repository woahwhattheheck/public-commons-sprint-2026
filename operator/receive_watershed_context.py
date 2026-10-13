#!/usr/bin/env python3
"""Receive a completed native watershed report into an existing scientific Workspace."""
from __future__ import annotations

import argparse
import base64
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import zipfile

OPERATION = "ECO-WATERSHED13-20261013"
OUTPUT_NAMES = frozenset({
    "watershed-context.json", "watershed-hucs.csv", "watershed-huc8s.csv",
    "watershed-states.csv", "watershed-report.md",
    "selected-watersheds.json", "selected-watersheds.csv",
})
OPERATOR_SCHEMA = "upstate.operator-watershed-context/v1"


def digest(body):
    return hashlib.sha256(body).hexdigest()


def member_name(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Archive members must be relative POSIX file paths.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError("Archive members must stay inside their retained directory.")
    return value


def decode_json(body, name):
    try:
        return json.loads(body)
    except (UnicodeError, ValueError) as error:
        raise ValueError("Cannot read retained JSON member: " + name) from error


def check_bytes(body, descriptor, name):
    if len(body) != descriptor.get("bytes") or digest(body) != descriptor.get("sha256"):
        raise ValueError("Retained member differs from its native receipt: " + name)



def _canonical_digest(value):
    return digest(json.dumps(value, ensure_ascii=False, allow_nan=False,
                             sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _verify_model_identity(argv, bank_files, report, selected):
    """Bind the original invocation's inputs and selection without rerunning it."""
    if not isinstance(argv, list) or any(not isinstance(value, str) for value in argv):
        raise ValueError("The original invocation must retain its complete argument list.")
    values = {}
    for option, field in (
            ("--source-context", "source_context"),
            ("--classification-coverage", "classification_coverage"),
            ("--network", "network")):
        if option not in argv:
            values[field] = None
            continue
        if argv.count(option) != 1:
            raise ValueError("The original invocation repeats a model input: " + option)
        try:
            path = member_name(argv[argv.index(option) + 1])
            body = bank_files[path]
        except (IndexError, KeyError, TypeError) as error:
            raise ValueError("The original source bank must retain " + option) from error
        if option == "--network" and body.startswith(b"\x1f\x8b"):
            body = gzip.decompress(body)
        values[field] = decode_json(body, path)
    selection = report.get("selection") or {}
    payload = {
        "schema": report["schema"], "analysis_version": report["analysis_version"],
        **values, "selected_huc12s": selection.get("huc12s"),
        "selection_requested": selection.get("requested"),
    }
    if "watershed-" + _canonical_digest(payload)[:20] != report["id"]:
        raise ValueError("The original model inputs and selection differ from the native report identity.")
    if selected.get("context_canonical_sha256") != _canonical_digest(report):
        raise ValueError("The retained selection differs from its original complete report.")


def _source_fingerprint(rows):
    return _canonical_digest([
        {"id": row["id"], "sha256": row["sha256"]}
        for row in sorted(rows, key=lambda row: row["id"])
    ])


def receive_bundle(archive, expected_sha256, operation_id):
    archive_body = Path(archive).read_bytes()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256) or digest(archive_body) != expected_sha256:
        raise ValueError("The archive differs from the published complete-result SHA-256.")
    members = {}
    with zipfile.ZipFile(io.BytesIO(archive_body)) as package:
        for entry in package.infolist():
            if entry.is_dir():
                continue
            name = member_name(entry.filename)
            if name in members:
                raise ValueError("Repeated archive member: " + name)
            members[name] = package.read(entry)
    required = {
        "run-receipt.json", "source-receipt.json", "stdout.json", "stderr.txt",
        "watershed-context-source-bank.json",
    }
    if not required.issubset(members):
        raise ValueError("Receive the complete native archive with its original invocation and source bank.")
    run = decode_json(members["run-receipt.json"], "run-receipt.json")
    source = decode_json(members["source-receipt.json"], "source-receipt.json")
    stdout = decode_json(members["stdout.json"], "stdout.json")
    if run.get("operation_id") != operation_id or source.get("operation_id") != operation_id:
        raise ValueError("The native archive belongs to a different operation.")
    if run.get("returncode") != 0:
        raise ValueError("The native invocation did not complete successfully.")
    result = run.get("result") or {}
    key = result.get("id")
    if not isinstance(key, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", key):
        raise ValueError("The native result has no valid regional report identity.")
    if stdout != result or digest(members["stdout.json"]) != run.get("stdout_sha256"):
        raise ValueError("The invocation's retained stdout and result differ.")
    if members["stderr.txt"].decode("utf-8") != run.get("stderr"):
        raise ValueError("The invocation's retained stderr differs from its receipt.")
    descriptors = result.get("files") or {}
    if set(descriptors) != OUTPUT_NAMES:
        raise ValueError("Receive all seven original watershed reports.")
    # The invocation is authoritative for its original output directory.
    argv = run.get("command_argv") or []
    try:
        output_directory = member_name(argv[argv.index("--output-dir") + 1])
    except (ValueError, IndexError, TypeError) as error:
        raise ValueError("The original invocation must retain its relative output directory.") from error
    output_prefix = "application/" + output_directory.rstrip("/") + "/"
    retained = {}
    for name, descriptor in descriptors.items():
        if descriptor.get("path") != name:
            raise ValueError("Native report descriptors must be relative to their report directory.")
        member = output_prefix + name
        if member not in members:
            raise ValueError("Missing original native output: " + member)
        check_bytes(members[member], descriptor, member)
        retained[name] = members[member]
    report = decode_json(retained["watershed-context.json"], "watershed-context.json")
    selected = decode_json(retained["selected-watersheds.json"], "selected-watersheds.json")
    if report.get("schema") != "upstate.watershed-context/v1" or report.get("id") != key:
        raise ValueError("The native report identity differs from its completed invocation.")
    if report.get("summary") != result.get("summary"):
        raise ValueError("The native report and invocation summaries differ.")
    if selected.get("schema") != "upstate.selected-watersheds/v1" or selected.get("context_id") != key:
        raise ValueError("The retained watershed selection belongs to another report.")
    if selected.get("selected_huc12s") != report.get("selection", {}).get("huc12s"):
        raise ValueError("The completed report's original selection differs from its selected export.")
    source_bank_body = members["watershed-context-source-bank.json"]
    source_bank_hash = source.get("source_bank_sha256")
    source_bank_payload = source_bank_body[:-1] if source_bank_body.endswith(b"\n") else source_bank_body
    if source_bank_hash not in {digest(source_bank_body), digest(source_bank_payload)}:
        raise ValueError("The original source bank differs from its source receipt.")
    bank = decode_json(source_bank_body, "watershed-context-source-bank.json")
    if bank.get("schema") != "upstate.source-files/v1" or bank.get("operation_id") != operation_id:
        raise ValueError("The retained source bank belongs to another source operation.")
    bank_files = {}
    for row in bank.get("files", []):
        path = member_name(row.get("path"))
        if path in bank_files:
            raise ValueError("Repeated file in original source bank: " + path)
        body = base64.b64decode(row.get("content_base64", ""), validate=True)
        check_bytes(body, row, path)
        bank_files[path] = body
    source_inputs = []
    seen = set()
    for row in source.get("files", []):
        path = member_name(row.get("path"))
        if path in seen or path not in bank_files:
            raise ValueError("Original source receipt and bank membership differ: " + path)
        seen.add(path)
        member = "application/" + path
        if member not in members:
            raise ValueError("Missing original source/input: " + member)
        body = members[member]
        check_bytes(body, row, member)
        if body != bank_files[path]:
            raise ValueError("Original source bank bytes differ from the received source: " + path)
        retained["source/" + path] = body
        source_inputs.append({
            "id": path, "member_path": path, "retained_path": "source/" + path,
            "bytes": len(body), "sha256": digest(body), "hash_basis": "exact source bytes",
        })
    if not seen or seen != set(bank_files):
        raise ValueError("Receive every original source/input file from the native source bank.")
    source_files = sorted(source_inputs, key=lambda row: row["id"])
    source_inputs = []
    # Match the source-edition loader: program snapshots remain original native
    # evidence; only exact model input bytes determine the operator source identity.
    for option, canonical_name in (
            ("--source-context", "full-domain-water-context.json"),
            ("--classification-coverage", "scdes-domain217-source-coverage.json"),
            ("--network", "native-network.json")):
        if option not in argv:
            if option == "--source-context":
                raise ValueError("The native invocation must identify its original source context.")
            continue
        if argv.count(option) != 1:
            raise ValueError("The native invocation repeats a model input: " + option)
        try:
            original_path = member_name(argv[argv.index(option) + 1])
        except (IndexError, TypeError) as error:
            raise ValueError("The native invocation has an incomplete model input: " + option) from error
        if original_path not in bank_files:
            raise ValueError("The original source bank must retain the executed model input: " + original_path)
        body = bank_files[original_path]
        if option == "--network" and body.startswith(b"\x1f\x8b"):
            canonical_name += ".gz"
        retained_path = "source/" + canonical_name
        if retained_path in retained and retained[retained_path] != body:
            raise ValueError("Canonical model input conflicts with an original source member: " + canonical_name)
        retained[retained_path] = body
        source_inputs.append({
            "id": canonical_name, "member_path": canonical_name,
            "bytes": len(body), "sha256": digest(body), "hash_basis": "exact source bytes",
        })
    source_inputs.sort(key=lambda row: row["id"])
    fingerprint = digest(json.dumps(
        [{"id": row["id"], "sha256": row["sha256"]} for row in source_inputs],
        sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))
    _verify_model_identity(argv, bank_files, report, selected)
    for name in sorted(required):
        retained["receiving/" + name] = members[name]
    retained["receiving/original-native-result.zip"] = archive_body
    return {
        "id": key, "report": report, "run": run, "source": source,
        "archive_sha256": expected_sha256, "archive_bytes": len(archive_body),
        "source_bank_archive_sha256": digest(source_bank_body),
        "source_inputs": source_inputs, "source_files": source_files, "source_fingerprint": fingerprint,
        "native_source_fingerprint": _source_fingerprint(source_files),
        "files": retained,
    }


def adopt(application, workspace, archive, expected_sha256, *, operation_id=OPERATION,
          carrier_file_id=None, expected_report_id=None):
    application = Path(application).expanduser().resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.common import atomic_json, describe_file, held, now, read_json
    from model.workspace import Workspace

    bundle = receive_bundle(archive, expected_sha256, operation_id)
    key = bundle["id"]
    if expected_report_id is not None and key != expected_report_id:
        raise ValueError("The received report differs from the requested native result.")
    ws = Workspace(Path(workspace).expanduser().resolve(strict=True))
    root = ws.root / "watershed-context"
    destination = root / key
    with held(ws.root / ".workspace.lock"):
        root.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            record = read_json(destination / "operator-report.json")
            legacy_fingerprint = bundle["native_source_fingerprint"]
            old_fingerprint = record.get("source_fingerprint")
            legacy = old_fingerprint == legacy_fingerprint and old_fingerprint != bundle["source_fingerprint"]
            if (record.get("schema") != OPERATOR_SCHEMA or record.get("id") != key
                    or old_fingerprint not in {bundle["source_fingerprint"], legacy_fingerprint}):
                raise ValueError("This report identity already has a different operator/source record.")
            if _source_fingerprint(record.get("source_inputs") or []) != old_fingerprint:
                raise ValueError("The saved native source identity differs from its input records.")
            aliases = {"source/" + row["id"] for row in bundle["source_inputs"]}
            additions = {}
            for name, body in bundle["files"].items():
                path = destination / name
                if not path.is_file():
                    if legacy and name in aliases and not path.exists() and not path.is_symlink():
                        additions[name] = body
                        continue
                    raise ValueError("The saved native report member differs: " + name)
                if path.read_bytes() != body:
                    raise ValueError("The saved native report member differs: " + name)
                descriptor = record.get("files", {}).get(name)
                if not descriptor:
                    if legacy and name in aliases:
                        additions[name] = body
                        continue
                    raise ValueError("The saved native report descriptor differs: " + name)
                if describe_file(destination, path) != descriptor:
                    raise ValueError("The saved native report descriptor differs: " + name)
            if legacy:
                # Upgrade only a byte-verified predecessor of this exact archive.
                # Existing native outputs and earlier selection exports stay intact.
                files = dict(record["files"])
                for name, body in additions.items():
                    path = destination / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    if not path.exists():
                        pending = None
                        try:
                            with tempfile.NamedTemporaryFile(
                                    dir=path.parent, prefix="." + path.name + ".receiving-",
                                    delete=False) as stream:
                                pending = Path(stream.name)
                                stream.write(body)
                                stream.flush()
                                os.fsync(stream.fileno())
                            try:
                                os.link(pending, path)
                            except FileExistsError:
                                if path.is_symlink() or not path.is_file() or path.read_bytes() != body:
                                    raise ValueError("The source alias changed during receiving: " + name)
                            directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                            try:
                                os.fsync(directory_fd)
                            finally:
                                os.close(directory_fd)
                        finally:
                            if pending is not None:
                                pending.unlink(missing_ok=True)
                    files[name] = describe_file(destination, path)
                history = list(record.get("source_identity_history") or [])
                history.append({
                    "source_inputs": record["source_inputs"],
                    "source_fingerprint": old_fingerprint, "upgraded_at": now(),
                })
                record.update(
                    source_inputs=bundle["source_inputs"],
                    native_source_files=bundle["source_files"],
                    source_fingerprint=bundle["source_fingerprint"],
                    native_source_fingerprint=legacy_fingerprint,
                    source_identity_history=history, files=files,
                )
                atomic_json(destination / "operator-report.json", record)
            return {
                "schema": "upstate.received-watershed-result/v1",
                "id": key, "state": "already_received", "workspace": str(ws.root),
                "directory": str(destination), "archive_sha256": expected_sha256,
                "selected_huc12s": bundle["report"]["selection"]["huc12s"],
            }
        stage = Path(tempfile.mkdtemp(prefix="." + key + ".receiving-", dir=root))
        try:
            files = {}
            for name, body in sorted(bundle["files"].items()):
                path = stage / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
                files[name] = describe_file(stage, path)
            record = {
                "schema": OPERATOR_SCHEMA, "id": key,
                "title": bundle["report"].get("title") or "Upper Savannah regional watershed context",
                "state": "complete", "created_at": now(),
                "completed_at": bundle["run"]["completed_at"],
                "summary": bundle["report"]["summary"],
                "selection": bundle["report"]["selection"],
                "source_inputs": bundle["source_inputs"],
                "native_source_files": bundle["source_files"],
                "native_source_fingerprint": bundle["native_source_fingerprint"],
                "source_fingerprint": bundle["source_fingerprint"],
                "source_validation": {
                    "state": "complete", "method": "original native archive and exact source bank",
                    "operation_id": operation_id,
                    "source_bank_sha256": bundle["source"]["source_bank_sha256"],
                    "source_bank_archive_sha256": bundle["source_bank_archive_sha256"],
                    "source_file_count": len(bundle["source_files"]),
                    "native_output_count": len(OUTPUT_NAMES),
                },
                "native_receiving": {
                    "operation_id": operation_id, "carrier_file_id": carrier_file_id,
                    "archive_sha256": expected_sha256, "archive_bytes": bundle["archive_bytes"],
                    "run_receipt": "receiving/run-receipt.json",
                    "source_receipt": "receiving/source-receipt.json",
                    "original_archive": "receiving/original-native-result.zip",
                    "source_carrier_file_id": bundle["source"].get("carrier_file_id"),
                    "model_carrier_file_id": bundle["source"].get("model_carrier_file_id"),
                },
                "files": files,
            }
            atomic_json(stage / "operator-report.json", record, immutable=True)
            os.replace(stage, destination)
            stage = None
        finally:
            if stage is not None:
                shutil.rmtree(stage)
    return {
        "schema": "upstate.received-watershed-result/v1",
        "id": key, "state": "received", "workspace": str(ws.root),
        "directory": str(destination), "archive_sha256": expected_sha256,
        "source_file_count": len(bundle["source_files"]), "native_output_count": len(OUTPUT_NAMES),
        "selected_huc12s": bundle["report"]["selection"]["huc12s"],
        "summary": bundle["report"]["summary"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--operation-id", default=OPERATION)
    parser.add_argument("--carrier-file-id")
    parser.add_argument("--expect-report-id")
    args = parser.parse_args()
    result = adopt(
        args.application, args.workspace, args.archive, args.archive_sha256,
        operation_id=args.operation_id, carrier_file_id=args.carrier_file_id,
        expected_report_id=args.expect_report_id,
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
