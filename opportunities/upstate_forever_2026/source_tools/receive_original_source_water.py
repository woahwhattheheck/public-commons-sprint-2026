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
        if not application.is_dir() or not source.is_file():
            raise ValueError("Choose the complete application directory and retained original domain file")
        admission.update(application=str(application), source=str(source),
                         source_bytes=source.stat().st_size, output_root=str(root))
        atomic_json(output / "admission.json", admission)
        emit("admitted", admission=admission)

        if zipfile.is_zipfile(source):
            if source.stat().st_size != ZIP_BYTES or sha256(source) != ZIP_SHA256:
                raise ValueError("Original domain ZIP differs from its retained length or SHA256")
        profile_path = application / "source/receptor-topology/20261013/utility-focus-profile.json"
        if sha256(profile_path) != PROFILE_SHA256:
            raise ValueError("Retain the original utility focus profile from the current application")
        profile = json.loads(profile_path.read_text(encoding="utf-8"))

        sys.path.insert(0, str(application))
        os.chdir(application)
        from model.workspace import Workspace
        from model.receptor_network_cli import build
        from model.receptor_scenarios import build as prepare

        if args.workspace is not None:
            workspace_root = args.workspace.resolve(strict=True)
            workspace = Workspace(workspace_root)
        else:
            workspace = Workspace(root / "source-water-workspace", create=True,
                                  title="Upper Savannah original source-water areas")
        network = build(source, profile, workspace.root / "receptor-networks",
                        expected_decoded_sha256=DECODED_SHA256)
        atomic_json(output / "network-result.json", network)
        emit("network-retained", workspace=str(workspace.root), network_id=network["id"])
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
