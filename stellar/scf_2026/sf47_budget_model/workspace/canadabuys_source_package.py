"""Complete prepared CanadaBuys source packages for the original Installation desk.

These files already carry the native package, explicit operator mapping and all
selected Workshare editions. Validation reuses the maintained native intake and
its exact five-file preparation. No case, customer, payer or payment is created.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import zipfile

import canadabuys_workshare_intake as intake

SCHEMA = "stellar-forge.canadabuys-source-package.v1"
MANIFEST = "CANADABUYS_SOURCE_PACKAGE.json"
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
FIXED = ("SOURCE_SELECTION.json", "CANADABUYS_NATIVE_WORKSHARES.json",
         "SUPPLIER_RECEIVING.json", "SOURCE_PREPARATION.json")
RESERVED = {*FIXED, MANIFEST, "INSTALLATION_SOURCE_DESK_PREPARATION.json",
            "selection-template.json"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def filename(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,199}", value),
            "Keep each complete original file under its declared flat receiving filename.")
    return value


def descriptor(name, raw):
    return {"filename": filename(name), "bytes": len(raw), "sha256": intake.sha(raw)}


def original_names(commissioning):
    source = intake.object_bytes(commissioning, "Complete native commissioning")
    require(source.get("schema") == intake.SCHEMA, "Select the complete native CanadaBuys preparation.")
    original = source.get("originalPackage")
    require(isinstance(original, dict), "Keep the complete original native package descriptor.")
    name = filename(original.get("filename"))
    require(name not in RESERVED, "The original native package collides with a preparation output.")
    return source, (*FIXED, name)


def validate_files(files):
    """Reproduce exactly the existing five source outputs using their native reader."""
    require(isinstance(files, dict) and "CANADABUYS_NATIVE_WORKSHARES.json" in files,
            "Keep every complete native preparation file.")
    for name, raw in files.items():
        filename(name)
        require(isinstance(raw, bytes) and 0 < len(raw) <= intake.MAX_FILE,
                "Each complete original source must fit the native 8 MiB limit.")
    source, names = original_names(files["CANADABUYS_NATIVE_WORKSHARES.json"])
    require(set(files) == set(names) and sum(map(len, files.values())) <= MAX_UNPACKED,
            "Keep exactly the complete five-file native preparation within its original bounds.")
    packet_name = source["originalPackage"]["filename"]
    packet_raw = files[packet_name]
    packet = intake.object_bytes(packet_raw, "Original complete CanadaBuys package")
    rows = intake.load_native_workshares(source, packet, packet_bytes=packet_raw)
    # The existing preparation is deterministic and already used by the original
    # installed command. Reopen all five outputs against that exact implementation.
    with tempfile.TemporaryDirectory(prefix="sf47-canadabuys-source-validation-") as temporary:
        root = Path(temporary)
        (root / "CANADABUYS_NATIVE_WORKSHARES.json").write_bytes(files["CANADABUYS_NATIVE_WORKSHARES.json"])
        (root / packet_name).write_bytes(packet_raw)
        result = intake.prepare(root / "CANADABUYS_NATIVE_WORKSHARES.json", root / packet_name, root)
        for name in names:
            require(intake.stable_file(root / name) == files[name],
                    "The received native preparation differs from its original output: " + name)
    return {"source": source, "packet": packet, "workshares": rows,
            "preparation": intake.object_bytes(files["SOURCE_PREPARATION.json"], "Original preparation result"),
            "receiving": intake.object_bytes(files["SUPPLIER_RECEIVING.json"], "Original receiving input"),
            "selection": intake.object_bytes(files["SOURCE_SELECTION.json"], "Original source selection"),
            "files": {name: files[name] for name in sorted(names)}}


def manifest_for(verified):
    return {"schema": SCHEMA, "sourceKind": "canadabuys-native-workshare",
            "operationId": verified["source"]["operationId"],
            "nativePackageId": verified["packet"]["packageId"],
            "workshares": [{"workshareId": row["caseId"], "planSha256": row["planSha256"],
                            "revision": row["source"]["workshareRevision"],
                            "workshareSha256": row["source"]["workshareSha256"]}
                           for row in verified["workshares"]],
            "files": [descriptor(name, raw) for name, raw in verified["files"].items()]}


def pack_files(files):
    verified = validate_files(files)
    manifest = manifest_for(verified)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in [(MANIFEST, json_bytes(manifest)), *verified["files"].items()]:
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100600 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, raw)
    raw = output.getvalue()
    require(len(raw) <= MAX_ARCHIVE, "The complete source ZIP exceeds the desk's original 8 MiB upload limit.")
    return raw, verified, manifest


def receive_archive(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_ARCHIVE,
            "Receive one complete native source ZIP within the original upload limit.")
    files = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(len(entries) == 6, "Keep the exact source-package manifest and five complete native files.")
        total = 0
        for entry in entries:
            name = filename(entry.filename)
            mode = entry.external_attr >> 16
            require(name not in files and not entry.is_dir() and
                    (not stat.S_IFMT(mode) or stat.S_ISREG(mode)) and not entry.flag_bits & 1 and
                    entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                    "Keep unique ordinary unencrypted native source-package files.")
            require(0 < entry.file_size <= intake.MAX_FILE, "An original source member exceeds its complete bound.")
            total += entry.file_size
            require(total <= MAX_UNPACKED, "The complete source package exceeds its unpacked bound.")
            with archive.open(entry, "r") as member:
                body = member.read(intake.MAX_FILE + 1)
            require(len(body) == entry.file_size, "An original source package member is incomplete.")
            files[name] = body
    require(MANIFEST in files, "Keep the original complete source-package manifest.")
    observed = intake.object_bytes(files.pop(MANIFEST), "Native source-package manifest")
    verified = validate_files(files)
    expected = manifest_for(verified)
    require(intake.same(observed, expected), "The original source-package manifest differs from its complete native files.")
    return {**verified, "manifest": expected,
            "archive": {"bytes": len(raw), "sha256": intake.sha(raw)}}


def review(verified):
    """Complete operator review backed by the already validated original records."""
    source = verified["source"]
    return {"schema": SCHEMA, "sourceKind": "canadabuys-native-workshare",
            "operationId": source["operationId"], "nativePackage": deepcopy(source["originalPackage"]),
            "selection": deepcopy(verified["selection"]),
            "originalPreparation": deepcopy(verified["preparation"]),
            "workshares": [{"id": row["caseId"], "planSha256": row["planSha256"],
                            "source": deepcopy(row["source"]), "plan": deepcopy(row["plan"]),
                            "effort": deepcopy(row["effort"]), "hours": row["hours"],
                            "original": deepcopy(row["originalCase"])}
                           for row in verified["workshares"]],
            "files": [descriptor(name, raw) for name, raw in verified["files"].items()],
            "commercialAcceptanceInferred": False, "paymentAction": False}


def package_directory(source_directory, archive_path):
    source_root = Path(source_directory).expanduser().absolute()
    status = source_root.lstat()
    require(stat.S_ISDIR(status.st_mode) and source_root.resolve() == source_root,
            "Read the original canonical complete preparation directory.")
    commissioning = intake.stable_file(source_root / "CANADABUYS_NATIVE_WORKSHARES.json")
    _, names = original_names(commissioning)
    files = {name: intake.stable_file(source_root / name) for name in names}
    raw, verified, manifest = pack_files(files)
    output = Path(archive_path).expanduser().absolute()
    parent = output.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077 and
            info.st_uid == os.getuid() and parent.resolve() == parent,
            "Choose a private canonical source-package output directory.")
    filename(output.name)
    require(output.name.lower().endswith(".zip"), "Use the explicit original source-package ZIP filename.")
    result = intake.retain(output, raw)
    # Independently reopen the emitted whole archive through its receiving entry.
    reopened = receive_archive(intake.stable_file(output))
    require(reopened["manifest"] == manifest, "The complete source package did not reopen unchanged.")
    return {"schema": SCHEMA, "state": "PACKAGED_SOURCE", "operationId": manifest["operationId"],
            "output": {**result, "path": str(output)}, "manifest": manifest,
            "commercialAcceptanceInferred": False, "paymentAction": False,
            "nativeCaseMutation": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(package_directory(args.source, args.out), ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
