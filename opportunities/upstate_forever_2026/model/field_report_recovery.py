"""Recover five known field presentation editions from their exact original bytes.

The frozen, previously published renderer source and actual successor receipt
define the only acceptable output identities. All five are checked before the
existing native adoption operation can retain a report.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
from types import SimpleNamespace
import uuid

from . import field_report_adoption as adoption
from . import field_report_presentation as presentation
from .common import atomic_bytes, canonical, describe_file, digest, identifier, read_json
from .portable_fs import (native_path as _native_fs_path,
                          sync_directory as _sync_directory, publish_file as publish_new)
from .implementation import ImplementationStore, _file_lock
from .implementation_schema import ImplementationError, canonical_bytes
from .portable_implementation import report_edition

SCHEMA = "upstate.field-report-recovery/v1"
REQUEST_SCHEMA = "upstate.field-report-recovery-request/v1"
BANK_SCHEMA = "ecosystems.complete-source-successors/v1"
BANK_BYTES = 156190
BANK_SHA256 = "8d039e6ccba9852ea4325baa178d62c14226b379b555cf0eb3adfa11bb25ec03"
RENDERERS = {
    "qc": {"path": "model/implementation_qc.py", "bytes": 36026,
           "sha256": "d4fa4e0ba5216dc78dbdd5af32e10b699167944807c68f8950e2a8c3f00254f7"},
    "actions": {"path": "model/implementation_qc_actions.py", "bytes": 34075,
                "sha256": "957266556ff0ab17f7f29dc3e2654fe857bf07f7c96ba1f017cc84e7605f8b4a"},
}
RECIPE_SHA256 = "d1a460dda4a7cae62fd42e337db53c09c6a8a5d852b8f4092c5609cb8bf8729d"
PRESENTATION_SCOPE = "HTML wrapping and locally scrollable tables; retained QC/action and plan bodies unchanged"


def _ordinary(path, *, directory=False, missing=False):
    return adoption._ordinary(path, directory=directory, missing=missing)


def _same(left, right, message):
    adoption._same(left, right, message)


def _put(path, value):
    adoption._put(path, value)


def _bytes(path, body):
    atomic_bytes(_ordinary(path, missing=True), body, immutable=True)


def _identity(path):
    path = _ordinary(path)
    before = path.stat()
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(data)
    after = _ordinary(path).stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ImplementationError("An original recovery member changed while it was read.")
    return {"bytes": after.st_size, "sha256": checksum.hexdigest()}


def _path(root, relative, *, missing=False, directory=False):
    root = _ordinary(root, directory=True)
    relative = str(relative)
    name = Path(relative)
    if (not name.parts or name.is_absolute() or name.as_posix() != relative
            or any(part in ("", ".", "..") for part in name.parts)
            or "\\" in relative or ":" in relative
            or any(ord(c) < 32 for c in relative)):
        raise ImplementationError("Use an exact original relative recovery member.")
    target = _ordinary(root / name, directory=directory, missing=missing)
    if not target.is_relative_to(root):
        raise ImplementationError("A recovery member left its retained directory.")
    return target


def _output(workspace, destination, *, create=True):
    root = _ordinary(workspace.root, directory=True).resolve(strict=True)
    output = _ordinary(destination, directory=True, missing=create)
    if output == root or output.is_relative_to(root) or root.is_relative_to(output):
        raise ImplementationError("Use a separate recovery directory outside the original Workspace.")
    if create:
        output.mkdir(parents=True, exist_ok=True)
    return _ordinary(output, directory=True)


def _bank(body):
    if len(body) != BANK_BYTES or hashlib.sha256(body).hexdigest() != BANK_SHA256:
        raise ImplementationError("Use the complete unchanged original XPF source bank.")
    value = json.loads(body)
    if value.get("schema") != BANK_SCHEMA or not isinstance(value.get("files"), dict):
        raise ImplementationError("The original source-bank structure differs.")
    files = value["files"]
    for item in RENDERERS.values():
        content = files.get(item["path"])
        if not isinstance(content, str):
            raise ImplementationError("The frozen original renderer is missing.")
        actual = content.encode("utf-8")
        if len(actual) != item["bytes"] or hashlib.sha256(actual).hexdigest() != item["sha256"]:
            raise ImplementationError("A frozen renderer differs from the actual original producer.")
    recipe = files.get("render_actual_packets.py", "").encode("utf-8")
    if hashlib.sha256(recipe).hexdigest() != RECIPE_SHA256:
        raise ImplementationError("The exact original successor recipe changed.")
    receipt = files.get("handoff-receipt.json")
    if not isinstance(receipt, str):
        raise ImplementationError("The original full presentation receipt is missing.")
    return value, receipt.encode("utf-8")


def _request_identity(workspace, field_operation_id, receipt_body):
    return {
        "schema": REQUEST_SCHEMA, "project_id": workspace.project["id"],
        "field_operation_id": identifier(field_operation_id),
        "source_bank_sha256": BANK_SHA256, "source_bank_bytes": BANK_BYTES,
        "receipt_sha256": hashlib.sha256(receipt_body).hexdigest(),
        "receipt_bytes": len(receipt_body),
    }


def _receipt(workspace, field_operation_id, receipt_body, original_bank_receipt):
    campaign, expected = adoption._campaign(workspace, field_operation_id)
    supplied, native_receipt = json.loads(receipt_body), json.loads(original_bank_receipt)
    rows, selection = adoption._receipt_selection(supplied, campaign, expected)
    original_rows, original_selection = adoption._receipt_selection(native_receipt, campaign, expected)
    _same(selection, original_selection, "Keep the five already-published original presentation identities.")
    for key in expected:
        # Actual producer receipt and combined handoff may have different extra
        # recipient-use metadata, but their complete native report rows are exact.
        _same(rows[key], original_rows[key], "The selected receipt changes an original native report descriptor.")
    fields = ("relative_path", "preimage_sha256", "postimage_sha256", "bytes")
    def provenance(value):
        entries = value.get("source_postimages")
        if not isinstance(entries, list) or any(not isinstance(row, dict) for row in entries):
            raise ImplementationError("Keep the complete original renderer provenance.")
        return [{key: row.get(key) for key in fields} for row in entries]
    # The combined handoff adds Git blob locators to these same source bodies.
    # The actual producer receipt precedes those transport annotations.
    _same(provenance(supplied), provenance(native_receipt),
          "The selected receipt changes the frozen original source provenance.")
    if supplied.get("owned_field_context") != native_receipt.get("owned_field_context"):
        raise ImplementationError("Preserve the original source context as receipt metadata.")
    return supplied, campaign, expected, rows, selection


def _input_inventory(workspace, campaign, expected):
    store = ImplementationStore(workspace)
    files, originals = {}, []
    with store._locked(campaign["plan_id"]) as plan_directory:
        for kind, original_id in expected:
            inspected = presentation.KINDS[kind][0].inspect(workspace, campaign["plan_id"], original_id)
            if inspected[presentation.KINDS[kind][1]] != original_id:
                raise ImplementationError("The original field report differs from its native identity.")
            originals.append({"kind": kind, "original_report_id": original_id, "inspection": inspected})
            for item in inspected["files"]:
                relative = item["path"]
                path = _path(store.root, relative)
                identity = _identity(path)
                if identity != {key: item[key] for key in ("bytes", "sha256")}:
                    raise ImplementationError("An original report member changed during recovery admission.")
                previous = files.get(relative)
                entry = {"path": relative, **identity}
                if previous is not None and previous != entry:
                    raise ImplementationError("An original report filename has conflicting identities.")
                files[relative] = entry
        last_revision = max(item["inspection"]["revision"] for item in originals)
        revisions = []
        for path in store._revision_paths(plan_directory):
            record = store._read_record(path)
            revision = record["plan"]["revision"]
            if revision > last_revision:
                continue
            relative = path.relative_to(store.root).as_posix()
            files[relative] = {"path": relative, **_identity(path)}
            revisions.append(revision)
        if revisions != list(range(1, last_revision + 1)):
            raise ImplementationError("Keep the complete original revision history through the selected field reports.")
    return {"plan_id": campaign["plan_id"], "last_revision": last_revision,
            "original_reports": originals, "files": [files[key] for key in sorted(files)]}


def _verify_inputs(workspace, frozen):
    for item in frozen["files"]:
        if _identity(_path(workspace.root, item["path"])) != {key: item[key] for key in ("bytes", "sha256")}:
            raise ImplementationError("A retained original recovery input changed: " + item["path"])
    for item in frozen["original_reports"]:
        module = presentation.KINDS[item["kind"]][0]
        actual = module.inspect(workspace, frozen["plan_id"], item["original_report_id"])
        _same(actual, item["inspection"], "The original field review or decision history changed.")
    return frozen


def _copy(source, target, expected):
    source, target = _ordinary(source), _ordinary(target, missing=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    _ordinary(target.parent, directory=True)
    if target.exists():
        if _identity(target) != expected:
            raise ImplementationError("A retained recovery member differs; keep this edition for inspection.")
        if _identity(source) != expected:
            raise ImplementationError("The original member changed after recovery admission.")
        return
    temporary = _native_fs_path(target.with_name(".recovery-copy-" + uuid.uuid4().hex))
    try:
        before = source.stat()
        checksum, size = hashlib.sha256(), 0
        with source.open("rb") as incoming, temporary.open("xb") as outgoing:
            for data in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(data)
                size += len(data)
                checksum.update(data)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        after = _ordinary(source).stat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ImplementationError("An original report changed during recovery copying.")
        if {"bytes": size, "sha256": checksum.hexdigest()} != expected:
            raise ImplementationError("A complete copied source differs from its original inventory.")
        try:
            publish_new(temporary, target)
        except FileExistsError:
            if _identity(target) != expected:
                raise ImplementationError("A different recovery member already occupies this exact path.")
        if _identity(target) != expected:
            raise ImplementationError("The retained recovery copy changed.")
        _sync_directory(target.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _preserve_initial_staging(directory, expected_bodies):
    """Keep interrupted original atomic-write bytes without adopting them as input."""
    allowed = {".lock", "source-bank.json", "receipt.json", "original-inputs.json",
               "private-staging"}
    pending = []
    for path in directory.iterdir():
        if path.name in allowed:
            if path.name == "private-staging":
                _ordinary(path, directory=True)
            else:
                _ordinary(path)
            continue
        if not re.fullmatch(r"\.write-[a-z0-9_]{8}", path.name):
            raise ImplementationError("Use a new recovery directory or its original retained request.")
        path = _ordinary(path)
        identity = _identity(path)
        if identity["bytes"] > max(map(len, expected_bodies)):
            raise ImplementationError("An initial staging member is not an original request write.")
        body = path.read_bytes()
        if (len(body) != identity["bytes"] or hashlib.sha256(body).hexdigest() != identity["sha256"]
                or not any(expected.startswith(body) for expected in expected_bodies)):
            raise ImplementationError("An initial staging member differs from the original request bytes.")
        pending.append((path, identity))
    if not pending:
        return
    retained = _ordinary(directory / "private-staging", directory=True, missing=True)
    retained.mkdir(exist_ok=True)
    for path, identity in pending:
        # Keep the exact partial bytes; a lost unlink is recovered by the same
        # deterministic filename and full identity on the next original retry.
        destination = retained / (path.name + "-" + identity["sha256"])
        _copy(path, destination, identity)
        if _identity(path) != identity:
            raise ImplementationError("An initial staging member changed before private retention.")
        _sync_directory(retained)
        path.unlink()
    _sync_directory(directory)


def _load_renderer(directory, kind, files):
    item = RENDERERS[kind]
    path = directory / ("frozen-" + kind + ".py")
    _bytes(path, files[item["path"]].encode("utf-8"))
    if _identity(path) != {key: item[key] for key in ("bytes", "sha256")}:
        raise ImplementationError("The original executable renderer identity differs.")
    name = "model._field_recovery_" + kind + "_" + item["sha256"][:12]
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def _candidate(context, plan_id, kind, original_id, expected_id, renderer):
    store = ImplementationStore(context)
    module, _, source_name, _ = presentation.KINDS[kind]
    original = module.inspect(SimpleNamespace(root=context), plan_id, original_id)
    original_directory = _path(context, original["directory"], directory=True)
    manifest = read_json(original_directory / "manifest.json")
    candidate = context / "implementation" / "plans" / plan_id / "reports" / expected_id
    _ordinary(candidate, directory=True, missing=True).mkdir(parents=True, exist_ok=True)
    candidate = _ordinary(candidate, directory=True)
    packet_name = "qc-review.json" if kind == "qc" else "qc-action-review.json"
    values = read_json(original_directory / packet_name)
    rendered = renderer.render_html(values) if kind == "qc" else renderer._html(values)
    _bytes(candidate / "report.html", rendered.encode("utf-8"))
    html_descriptor = describe_file(candidate, candidate / "report.html")
    recipe = read_json(original_directory / "observed-report.json")
    if sum(row.get("path") == "report.html" for row in recipe.get("inputs", [])) != 1:
        raise ImplementationError("The original recipe lacks its exact unique report HTML.")
    recipe["inputs"] = [{**entry, **html_descriptor} if entry["path"] == "report.html" else entry
                        for entry in recipe["inputs"]]
    # EXACT original implementation_schema encoding: no added LF.
    _bytes(candidate / "observed-report.json", canonical_bytes(recipe))
    sources = read_json(original_directory / source_name)
    observed_descriptor = describe_file(candidate, candidate / "observed-report.json")
    for entry in sources["entries"]:
        entry.update(observed_descriptor)
        entry["companions"] = [{**member, **html_descriptor} if member["path"] == "report.html" else member
                               for member in entry["companions"]]
    _bytes(candidate / source_name, canonical_bytes(sources))
    changed = {"report.html", "observed-report.json", source_name}
    for entry in manifest["files"]:
        name = entry["name"]
        if name in changed:
            entry.update(size_bytes=(candidate / name).stat().st_size,
                         sha256=_identity(candidate / name)["sha256"])
        else:
            _copy(_path(original_directory, name), _path(candidate, name, missing=True),
                  {"bytes": entry["size_bytes"], "sha256": entry["sha256"]})
    manifest["presentation_successor"] = {
        "original_report_id": original_id, "renderer_sha256": RENDERERS[kind]["sha256"],
        "scope": PRESENTATION_SCOPE,
    }
    manifest_body = canonical_bytes(manifest)
    _bytes(candidate / "manifest.json", manifest_body)
    actual_id = hashlib.sha256(manifest_body).hexdigest()
    if actual_id != expected_id:
        _put(context / ("mismatch-" + expected_id + ".json"),
             {"expected_report_id": expected_id, "actual_report_id": actual_id,
              "kind": kind, "original_report_id": original_id,
              "reason": "Recovered bytes differ from the already-produced original edition."})
        raise ImplementationError("Retained recovery candidate differs from expected original report "
                                  + expected_id + "; actual manifest " + actual_id + ".")
    edition = report_edition(store, candidate)
    if edition["id"] != expected_id:
        raise ImplementationError("Native report inspection returned another recovered edition.")
    pair = presentation._inspect_pair(SimpleNamespace(root=context), plan_id, kind, original_id, expected_id)
    return pair


def _read(directory, workspace):
    request = read_json(_ordinary(directory / "request.json"))
    if not isinstance(request, dict) or request.get("schema") != REQUEST_SCHEMA:
        raise ImplementationError("Use the original retained field recovery directory.")
    body = _ordinary(directory / "source-bank.json").read_bytes()
    bank, default_receipt = _bank(body)
    receipt_body = _ordinary(directory / "receipt.json").read_bytes()
    identity = _request_identity(workspace, request.get("field_operation_id"), receipt_body)
    _same(request.get("identity"), identity, "Recovery belongs to another original project or source.")
    _same({key: request.get(key) for key in identity}, identity,
          "The retained recovery request fields differ from its original identity.")
    if request.get("operation_id") != digest(identity):
        raise ImplementationError("The original recovery identity changed.")
    receipt, campaign, expected, rows, selection = _receipt(
        workspace, identity["field_operation_id"], receipt_body, default_receipt)
    _same(request.get("selection"), selection, "The original five report choices changed.")
    frozen = read_json(_ordinary(directory / "original-inputs.json"))
    if digest(frozen) != request.get("original_inputs_sha256") or frozen.get("plan_id") != campaign["plan_id"]:
        raise ImplementationError("The complete original recovery input inventory changed.")
    _verify_inputs(workspace, frozen)
    return request, bank, receipt_body, receipt, campaign, expected, rows, selection, frozen


def _completed(workspace, request, campaign, expected, rows, native):
    if native.get("status") != "complete":
        raise ImplementationError("The recovered native adoption is incomplete.")
    if (native.get("project_id") != workspace.project["id"]
            or native.get("field_operation_id") != request["field_operation_id"]
            or native.get("plan_id") != campaign["plan_id"]):
        raise ImplementationError("The recovered native adoption belongs to another field operation.")
    if native.get("receipt_sha256") != request["receipt_sha256"]:
        raise ImplementationError("The completed native adoption uses another original receipt.")
    _same(native.get("presentation", {}).get("selection"), request["selection"],
          "The completed native adoption uses another five-report selection.")
    return {
        "schema": SCHEMA, "status": "complete", "operation_id": request["operation_id"],
        "project_id": workspace.project["id"], "field_operation_id": request["field_operation_id"],
        "plan_id": campaign["plan_id"], "source_bank_sha256": BANK_SHA256,
        "receipt_sha256": request["receipt_sha256"],
        "expected_report_ids": [rows[key]["new_report_id"] for key in expected],
        "adoption_operation_id": native["operation_id"],
        "presentation_id": native["presentation"]["presentation_id"],
        "adoption": native, "presentation": native["presentation"],
    }


def inspect_recovery(workspace, directory):
    """Inspect retained recovery; a completed adoption also reopens natively."""
    directory = _output(workspace, directory, create=False)
    with _file_lock(directory / ".lock"):
        request, _, _, _, campaign, expected, rows, _, _ = _read(directory, workspace)
        completed_path = _ordinary(directory / "completed.json", missing=True)
        if completed_path.exists():
            result = read_json(completed_path)
            native = adoption.inspect_adoption(workspace, result["adoption_operation_id"])
            current = _completed(workspace, request, campaign, expected, rows, native)
            _same(result, current, "The complete retained recovery result differs from its native adoption.")
            return current
        retained = []
        context = directory / "context"
        for kind, original_id in expected:
            selected_id = rows[(kind, original_id)]["new_report_id"]
            candidate = context / "implementation" / "plans" / campaign["plan_id"] / "reports" / selected_id
            if (candidate / "manifest.json").exists():
                pair = presentation._inspect_pair(SimpleNamespace(root=context), campaign["plan_id"],
                                                  kind, original_id, selected_id)
                if pair["presentation_manifest_sha256"] != selected_id:
                    raise ImplementationError("A retained recovery candidate differs from its expected identity.")
                retained.append(selected_id)
        return {"schema": SCHEMA, "status": "recovery_incomplete", "operation_id": request["operation_id"],
                "project_id": workspace.project["id"], "field_operation_id": request["field_operation_id"],
                "plan_id": campaign["plan_id"], "verified_candidate_report_ids": retained,
                "expected_report_ids": [rows[key]["new_report_id"] for key in expected]}


def recover_presentations(workspace, field_operation_id, source_bank_path, destination, *, receipt_path=None):
    """Recover the exact previously produced five editions and adopt them."""
    bank_body = _ordinary(source_bank_path).read_bytes()
    bank, default_receipt = _bank(bank_body)
    receipt_body = (_ordinary(receipt_path).read_bytes() if receipt_path is not None else default_receipt)
    receipt, campaign, expected, rows, selection = _receipt(
        workspace, field_operation_id, receipt_body, default_receipt)
    identity = _request_identity(workspace, field_operation_id, receipt_body)
    operation_id = digest(identity)
    directory = _output(workspace, destination)
    with _file_lock(directory / ".lock"):
        request_path = _ordinary(directory / "request.json", missing=True)
        if request_path.exists():
            current = _read(directory, workspace)
            request, _, retained_receipt, _, _, _, _, _, frozen = current
            _same(request["identity"], identity, "Resume the original recovery with its exact source and receipt.")
            if retained_receipt != receipt_body:
                raise ImplementationError("Retain the exact original receipt bytes on recovery retry.")
        else:
            frozen = _input_inventory(workspace, campaign, expected)
            request = {**identity, "identity": identity, "operation_id": operation_id,
                       "selection": selection, "original_inputs_sha256": digest(frozen)}
            _preserve_initial_staging(directory, (
                bank_body, receipt_body, canonical(frozen) + b"\n", canonical(request) + b"\n"))
            _bytes(directory / "source-bank.json", bank_body)
            _bytes(directory / "receipt.json", receipt_body)
            _put(directory / "original-inputs.json", frozen)
            _put(request_path, request)
        completed_path = _ordinary(directory / "completed.json", missing=True)
        if completed_path.exists():
            result = read_json(completed_path)
            native = adoption.inspect_adoption(workspace, result["adoption_operation_id"])
            current = _completed(workspace, request, campaign, expected, rows, native)
            _same(result, current, "The complete retained recovery result differs from its native adoption.")
            return current
        context = directory / "context"
        _ordinary(context, directory=True, missing=True).mkdir(exist_ok=True)
        context = _ordinary(context, directory=True)
        for item in frozen["files"]:
            _copy(_path(workspace.root, item["path"]), _path(context, item["path"], missing=True),
                  {key: item[key] for key in ("bytes", "sha256")})
        renderers = {kind: _load_renderer(directory, kind, bank["files"]) for kind in RENDERERS}
        pairs = []
        for kind, original_id in expected:
            pairs.append(_candidate(context, campaign["plan_id"], kind, original_id,
                                    rows[(kind, original_id)]["new_report_id"], renderers[kind]))
        _verify_inputs(workspace, frozen)
        checked_selection, checked_pairs, _ = adoption._preflight(
            workspace, campaign, expected, receipt, context)
        _same(checked_selection, selection, "The recovered all-five selection changed.")
        _same(checked_pairs, pairs, "The complete native recovery preflight differs.")
        _put(directory / "verified-candidates.json", {"selection": selection, "reports": pairs})
        # FIRST mutation of the original report bank occurs only after ALL five
        # expected manifests and both complete native inspections have passed.
        result = adoption.adopt_presentations(workspace, field_operation_id,
                                              directory / "receipt.json", source_context=context)
        completed = _completed(workspace, request, campaign, expected, rows, result)
        _put(directory / "completed.json", completed)
        return completed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    recover = commands.add_parser("recover")
    recover.add_argument("--workspace", required=True)
    recover.add_argument("--field-operation", required=True)
    recover.add_argument("--source-bank", required=True)
    recover.add_argument("--output", required=True)
    recover.add_argument("--receipt")
    recover.add_argument("--selection-output")
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--workspace", required=True)
    inspect.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "recover":
        result = recover_presentations(workspace, args.field_operation, args.source_bank,
                                       args.output, receipt_path=args.receipt)
        if args.selection_output:
            presentation.capture(workspace, args.field_operation, result["presentation"], args.selection_output)
    else:
        result = inspect_recovery(workspace, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
