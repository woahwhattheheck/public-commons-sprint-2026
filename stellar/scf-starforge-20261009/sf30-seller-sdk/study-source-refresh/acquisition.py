"""Receive existing original SF88/SF100 deliveries through their native APIs."""
from __future__ import annotations

from collections import Counter
import importlib.util
import os
import shutil
import tempfile
from pathlib import Path
import sys

from model import SDK, digest, dump, encoded, fail, hash_id, identity, now, parse, private_directory, read, write
from workspace import file_identity, unpack
from stellar_forge_buyer.datasets import DatasetAcquisition, DatasetDelivery


def _consumer(provider):
    if provider not in ("acs", "bls"):
        fail("SOURCE_FILES_PROVIDER_REQUIRED")
    directory = SDK / ("census-acs" if provider == "acs" else "bls-labor") / "consumer"
    filename = directory / ("census_delivery.py" if provider == "acs" else "bls_delivery.py")
    name = "_study_original_" + provider + "_consumer"
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _delivery(workspace, checkout, session, node, timeout):
    selected_checkout = Path(checkout).expanduser().resolve()
    expected = SDK.parent.parent.parent
    if selected_checkout != expected:
        fail("INSTALLED_ORIGINAL_CHECKOUT_REQUIRED", expected=str(expected))
    acquisition = DatasetAcquisition(checkout=selected_checkout,
                                     session=Path(session).expanduser().resolve(),
                                     node=node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"),
                                     timeout=timeout)
    status = acquisition.inspect()
    identity_key = identity({"session": str(acquisition.directory)})
    parent = private_directory(workspace.directory / "native-deliveries")
    # Original deliver owns completion checks and reopens its own existing output.
    delivery = acquisition.deliver(parent / identity_key)
    return acquisition, status, delivery


def _retain_receipt(workspace, source_id, delivery, binding):
    with delivery.file("manifest.json").open() as stream:
        original = stream.read(4 * 1024 * 1024 + 1)
    if len(original) > 4 * 1024 * 1024:
        fail("NATIVE_DELIVERY_MANIFEST_LIMIT")
    # The native file API revalidates original bytes before each consumer read.
    outputs = {}
    for name in delivery.file_names():
        file = delivery.file(name)
        with file.open() as stream:
            import hashlib
            digest, size = hashlib.sha256(), 0
            while chunk := stream.read(65536):
                digest.update(chunk)
                size += len(chunk)
        outputs[name] = {"bytes": size, "sha256": digest.hexdigest()}
    body = {
        "schema": "stellar-forge.study-native-intake.v1",
        "native_status": delivery.status, "payment_status": delivery.payment_status,
        "native_schema": delivery.native["schema"], "binding": binding,
        "outputs": outputs, "delivery_manifest_sha256": outputs["manifest.json"]["sha256"],
        "retained_scope": "Original delivery manifest, native result and output byte identities; complete restored provider source files are retained separately.",
    }
    aid = identity({"source_id": source_id, **body})
    parent = private_directory(workspace.directory / "acquisitions")
    destination = parent / aid
    with workspace.mutation():
        if not destination.exists():
            stage = Path(tempfile.mkdtemp(prefix=".native-intake-", dir=parent))
            try:
                write(stage / "manifest.json", original, exclusive=True)
                dump(stage / "native-result.json", delivery.native, exclusive=True)
                dump(stage / "binding.json", body, exclusive=True)
                os.rename(stage, destination)
                stage = None
                from model import sync_directory
                sync_directory(parent)
            finally:
                if stage is not None:
                    shutil.rmtree(stage)
        if destination.is_symlink() or destination.resolve(strict=True) != destination:
            fail("NATIVE_INTAKE_RECEIPT_CONFLICT")
        if (read(destination / "manifest.json", 4 * 1024 * 1024) != original
                or parse(read(destination / "native-result.json", 16 * 1024 * 1024)) != delivery.native
                or parse(read(destination / "binding.json", 16 * 1024 * 1024)) != body
                or {path.name for path in destination.iterdir()} != {"manifest.json", "native-result.json", "binding.json"}):
            fail("NATIVE_INTAKE_RECEIPT_CONFLICT")
        workspace.connection.execute("INSERT OR IGNORE INTO acquisitions VALUES(?,?,?,?)",
                                     (aid, source_id, encoded(body).decode(), now()))
        workspace.event("acquisition.receive", aid, {"source_id": source_id, "native_status": delivery.status})
    return {"id": aid, "source_id": source_id, **body}


def _receive_source_delivery(workspace, provider, delivery, intake_key, status, *, node=None, expected_capture_id=None):
    consumer = _consumer(provider)
    parent = private_directory(workspace.directory / "received-sources")
    capture = consumer.restore_source_files(delivery, parent / identity({"intake": intake_key, "provider": provider}),
                                           expected_capture_id=expected_capture_id)
    source_file = capture.directory.parent / (capture.directory.name + ".source.json")
    declaration = {
        "schema": "stellar-forge.census-acs-source.v1" if provider == "acs" else "stellar-forge.bls-labor-source.v1",
        "capture": capture.directory.name + "/" + consumer.MANIFEST_PATH,
        "captureSha256": capture.capture_id,
    }
    if source_file.exists():
        if parse(read(source_file, 262144)) != declaration:
            fail("RECEIVED_SOURCE_POINTER_CONFLICT")
    else:
        dump(source_file, declaration, exclusive=True)
    source = workspace.import_source(provider, source_file, node=node)
    receipt = _retain_receipt(workspace, source["id"], delivery, {
        "projection": "source_files", "capture_id": capture.capture_id,
        "acquired_rows": capture.acquired_rows, "complete_original_inventory": True,
    })
    return {"source": source, "acquisition": receipt, "original_status": status}


def receive_source_files(workspace, provider, *, checkout, session, node=None, timeout=360, expected_capture_id=None):
    acquisition, status, delivery = _delivery(workspace, checkout, session, node, timeout)
    return _receive_source_delivery(workspace, provider, delivery, {"session": str(acquisition.directory)}, status,
                                    node=node, expected_capture_id=expected_capture_id)


def _receive_observation_delivery(workspace, source_id, projection, delivery, status):
    source = workspace.record("sources", source_id)
    chosen = next((item for item in source["descriptor"]["projections"] if item["query"] == projection), None)
    if chosen is None:
        fail("ORIGINAL_PROJECTION_REQUIRED")
    path = workspace.directory / "sources" / source_id / chosen["path"]
    if file_identity(path) != {key: chosen[key] for key in ("bytes", "sha256")}:
        fail("ORIGINAL_PROJECTION_CHANGED")
    native_rows = Counter()
    with path.open("rb") as rows:
        for raw in rows:
            native_rows[identity(parse(raw))] += 1
    delivered_rows = Counter(identity(row) for row in delivery.jsonl_rows())
    if delivered_rows != native_rows:
        fail("ACQUIRED_SELECTION_DIFFERS_FROM_RETAINED_PROJECTION",
             projected_rows=sum(native_rows.values()), acquired_rows=sum(delivered_rows.values()))
    receipt = _retain_receipt(workspace, source_id, delivery, {
        "projection": projection, "capture_id": source["capture_id"],
        "acquired_rows": sum(delivered_rows.values()), "projection_sha256": chosen["sha256"],
        "complete_original_projection": True,
    })
    return {"source_id": source_id, "acquisition": receipt, "original_status": status}


def receive_observations(workspace, source_id, projection, *, checkout, session, node=None, timeout=360):
    _, status, delivery = _delivery(workspace, checkout, session, node, timeout)
    return _receive_observation_delivery(workspace, source_id, projection, delivery, status)


def receive_scan(workspace, scan_file, *, provider=None, source_id=None, projection=None,
                 node=None, expected_capture_id=None, expected_input_sha256=None):
    """Consume the existing original SF100 scan without a new buyer session."""
    if bool(provider) == bool(source_id):
        fail("ONE_NATIVE_SCAN_RECEIVING_TARGET_REQUIRED")
    if source_id and (not projection or expected_capture_id is not None):
        fail("NATIVE_SCAN_PROJECTION_REQUIRED")
    if provider and projection is not None:
        fail("NATIVE_SCAN_SOURCE_FILES_TARGET_REQUIRED")
    path = Path(scan_file).expanduser().resolve(strict=True)
    raw = read(path, 16 * 1024 * 1024)
    if expected_input_sha256 is not None and digest(raw) != hash_id(expected_input_sha256):
        fail("SCAN_INPUT_CHANGED", expected_sha256=expected_input_sha256, actual_sha256=digest(raw))
    scan = parse(raw)
    delivery = DatasetDelivery.from_finalized_scan(scan)
    status = delivery.native["nativeStatus"]
    if provider:
        return _receive_source_delivery(workspace, provider, delivery,
            {"format": "SF100_SCAN", "source_binding_sha256": delivery.native["sourceBindingSha256"]},
            status, node=node, expected_capture_id=expected_capture_id)
    return _receive_observation_delivery(workspace, source_id, projection, delivery, status)
