#!/usr/bin/env python3
"""Receive the original 217-HUC source-water graph and prepared utility areas."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
import traceback
import zipfile

OPERATION = "ECO-SOURCE-WATER-ORIGINAL-217"
ZIP_BYTES = 8800689
ZIP_SHA256 = "1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04"
DECODED_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
PROFILE_SHA256 = "93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7"
AREA_COUNTS = {"arjws-six-and-twenty": 4, "prwd-tugaloo-choestoea": 32}


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1],
                       help="Current complete application; defaults to this receiver's application")
    value.add_argument("--domain", type=Path, required=True,
                       help="Retained original domain ZIP, model-domain.esri.json.gz or decoded JSON")
    value.add_argument("--operation-root", type=Path, required=True,
                       help="Existing owned operation directory for receipts and complete archives")
    value.add_argument("--workspace", type=Path,
                       help="Existing scientific Workspace to receive into; otherwise create/reuse the operation's source-water-workspace")
    return value


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name("." + path.name + "." + str(os.getpid()) + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def emit(stage, **values):
    print(json.dumps({"operation": OPERATION, "stage": stage, **values}), flush=True)


def retain_domain_source(workspace, network, output):
    """Register the original domain and complete graph context as a native vector source."""
    import shutil
    from model.common import describe_file, read_json, verify_file

    original = Path(network["directory"]).resolve(strict=True)
    if (network["network_huc12_count"] != 217
            or network["source_binding"]["decoded_sha256"] != DECODED_SHA256):
        raise ValueError("Register the complete original 217-HUC model domain")
    descriptors = list(network["files"].values())
    descriptors.append(describe_file(original, original / "result.json"))
    by_path = {}
    directory = output / "original-domain-source" / network["id"]
    directory.mkdir(parents=True, exist_ok=True)
    for descriptor in descriptors:
        source = verify_file(original, descriptor)
        path = descriptor["path"]
        previous = by_path.get(path)
        if previous is not None:
            if previous["sha256"] != descriptor["sha256"] or previous["bytes"] != descriptor["bytes"]:
                raise ValueError("Original graph companions repeat a conflicting path")
            continue
        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.stat().st_size != descriptor["bytes"] or sha256(target) != descriptor["sha256"]:
                raise ValueError("An existing original-domain companion differs: " + path)
        else:
            pending = target.with_name("." + target.name + "." + str(os.getpid()) + ".tmp")
            try:
                shutil.copyfile(source, pending)
                if pending.stat().st_size != descriptor["bytes"] or sha256(pending) != descriptor["sha256"]:
                    raise ValueError("Original-domain companion copy differs: " + path)
                os.replace(pending, target)
            finally:
                pending.unlink(missing_ok=True)
        by_path[path] = descriptor

    body = network["files"]["source_body"]
    graph = read_json(verify_file(original, network["files"]["network"]))
    reference = network["identity"]["receptor_spec"].get("source_reference") or {}
    entry = {
        "id": "original-model-domain", "kind": "vector",
        "title": "Original model domain — complete 217 HUC12 watersheds",
        "role": "MODEL_DOMAIN", "format": "esri-json",
        "path": body["path"], "sha256": body["sha256"],
        "uri": reference.get("uri") or "urn:sha256:" + DECODED_SHA256,
        "vintage": reference.get("vintage") or network["created_at"][:10],
        "id_field": graph["source_fields"]["huc12"],
        "network_result_id": network["id"],
        "original_decoded_sha256": DECODED_SHA256,
        "companions": [{"path": path, "sha256": descriptor["sha256"]}
                       for path, descriptor in sorted(by_path.items()) if path != body["path"]],
    }
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Original 217-HUC model domain and source-water graph",
        "captured_at": network["created_at"], "entries": [entry],
        "scope": {"network_result_id": network["id"], "network_huc12_count": 217,
                  "source_binding": network["source_binding"],
                  "source_reference": reference},
        "notes": ["Original polygon body retained byte for byte.",
                  "Complete original profile, link/membership tables, result and map/report context are companions."],
    }
    manifest_path = directory / "source-manifest.json"
    if manifest_path.exists():
        if read_json(manifest_path) != manifest:
            raise ValueError("The retained original-domain source manifest differs")
    else:
        atomic_json(manifest_path, manifest)
    collection = workspace.import_sources(manifest_path)
    retained, saved_entry = workspace.source_file(collection["id"], entry["id"])
    if saved_entry["body"]["sha256"] != body["sha256"]:
        raise ValueError("The imported original model domain changed its source body")
    return {
        "source_collection_id": collection["id"], "source_id": entry["id"],
        "source_sha256": body["sha256"], "decoded_sha256": DECODED_SHA256,
        "huc12_count": 217, "id_field": entry["id_field"],
        "manifest": str(manifest_path), "manifest_sha256": sha256(manifest_path),
        "retained_source": str(retained),
    }


def main(argv=None):
    args = parser().parse_args(argv)
    output = None
    admission = {"operation": OPERATION, "host": socket.gethostname(),
                 "python": sys.executable, "started_at": time.time(),
                 "request": {key: str(value) if isinstance(value, Path) else value
                             for key, value in vars(args).items()}}
    lock = None
    owns_lock = False
    try:
        root = args.operation_root.resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Choose an existing owned operation directory")
        output = root / "source-water-receiving"
        output.mkdir(parents=True, exist_ok=True)
        lock = (output / ".receiving.lock").open("a+b")
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        owns_lock = True
        application = args.application.resolve(strict=True)
        source = args.domain.resolve(strict=True)
        workspace_root = args.workspace.resolve(strict=True) if args.workspace is not None else None
        if not application.is_dir() or not source.is_file():
            raise ValueError("Choose the complete application directory and retained original domain file")
        admission.update(application=str(application), source=str(source),
                         source_bytes=source.stat().st_size, output_root=str(root))
        atomic_json(output / "admission.json", admission)
        emit("admitted", admission=admission)

        if zipfile.is_zipfile(source):
            if source.stat().st_size != ZIP_BYTES or sha256(source) != ZIP_SHA256:
                raise ValueError("Original domain ZIP differs from its retained length or SHA256")
        profile_path = application / "source/receptor-profiles/utility-focus-20261012.json"
        if sha256(profile_path) != PROFILE_SHA256:
            raise ValueError("Retain the original utility focus profile from the current application")
        profile = json.loads(profile_path.read_text(encoding="utf-8"))

        sys.path.insert(0, str(application))
        os.chdir(application)
        from model.workspace import Workspace
        from model.receptor_network_cli import build
        from model.receptor_scenarios import build as prepare

        if workspace_root is not None:
            workspace = Workspace(workspace_root)
        else:
            workspace = Workspace(root / "source-water-workspace", create=True,
                                  title="Upper Savannah original source-water areas")
        if output == workspace.root or workspace.root in output.parents:
            raise ValueError("Choose an operation root whose receiving outputs are outside the scientific Workspace")
        network = build(source, profile, workspace.root / "receptor-networks",
                        expected_decoded_sha256=DECODED_SHA256)
        atomic_json(output / "network-result.json", network)
        emit("network-retained", workspace=str(workspace.root), network_id=network["id"])
        domain_source = retain_domain_source(workspace, network, output)
        atomic_json(output / "original-domain-source.json", domain_source)
        emit("original-domain-imported", **domain_source)
        prepared = prepare(workspace, {"network_result_id": network["id"]})
        atomic_json(output / "prepared-areas-result.json", prepared)
        actual_counts = {area["id"]: area["huc12_count"] for area in prepared["areas"]}
        if actual_counts != AREA_COUNTS or len(prepared["areas"]) != len(AREA_COUNTS):
            raise ValueError("Prepared original utility membership differs from the retained 4/32 areas")

        product_dir = Path(network["directory"]).resolve(strict=True)
        expected_dir = (workspace.root / "receptor-networks" / network["id"]).resolve(strict=True)
        if product_dir != expected_dir:
            raise ValueError("Original graph product must remain in its receiving Workspace")
        attempt = str(time.time_ns())
        archive = output / ("source-water-original-product-" + attempt + ".zip")
        temporary = archive.with_name("." + archive.name + ".tmp")
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as package:
                for path in sorted(product_dir.rglob("*")):
                    if path.is_file() and not path.name.endswith(".lock"):
                        package.write(path, path.relative_to(product_dir.parent).as_posix())
            os.replace(temporary, archive)
        finally:
            temporary.unlink(missing_ok=True)
        receipt = {
            "operation": OPERATION, "application": str(application), "python": sys.executable,
            "workspace": str(workspace.root), "workspace_id": workspace.project["id"],
            "network_id": network["id"], "network_directory": str(product_dir),
            "prepared_id": prepared["id"],
            "prepared_directory": str(workspace.root / "receptor-scenario-areas" / prepared["id"]),
            "source_collection_id": prepared["source_collection_id"],
            "original_domain_source": domain_source,
            "areas": [{"id": area["id"], "huc12_count": area["huc12_count"]}
                      for area in prepared["areas"]],
            "original_source": network["source_binding"],
            "product_archive": str(archive), "product_archive_bytes": archive.stat().st_size,
            "product_archive_sha256": sha256(archive),
        }
        atomic_json(output / "receiving.json", receipt)
        emit("areas-retained", **receipt)
        backup_path = output / ("source-water-workspace-" + attempt + ".zip")
        backup = workspace.backup(backup_path)
        backup_receipt = {"operation": OPERATION, "archive": str(backup_path),
                          "bytes": backup_path.stat().st_size, "sha256": sha256(backup_path),
                          "workspace_backup": backup}
        atomic_json(output / "workspace-backup.json", backup_receipt)
        atomic_json(output / ("completed-" + attempt + ".json"),
                    {"admission": admission, "receiving": receipt, "backup": backup_receipt})
        (output / "exception.json").unlink(missing_ok=True)
        emit("complete", receiving=receipt, workspace_backup=backup_receipt)
        return 0
    except Exception as error:
        failure = {**admission, "exception": type(error).__name__,
                   "message": str(error), "traceback": traceback.format_exc()}
        # A competing invocation must not alter the active receiver's receipts.
        if output is not None and owns_lock:
            try:
                atomic_json(output / "exception.json", failure)
            except OSError:
                pass
        emit("failed", failure=failure)
        traceback.print_exc()
        return 1
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
