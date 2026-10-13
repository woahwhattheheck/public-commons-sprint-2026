"""Receive the published Annual NLCD national archive and clip it locally.

The source owner supplies the original complete archive and capture/transfer
receipt. This module performs no network request. It uses the existing native
domain reader and supplies the original scientific workspace's NLCD entry.
"""
from __future__ import annotations
import argparse
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import stat
import xml.etree.ElementTree as ET
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, verify_file)
from model import rasters
from .nlcd_wcs import _domain_geometry, _retain as _retain_original
from .raster_sources import _fsync_directory, _matches
from .source_transfer import received_transfer, capture_from_transfer

ARCHIVE_URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip"
METADATA_URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/metadata/Annual_NLCD_LndCov_2025_CU_C1V2.xml"
DOI = "https://doi.org/10.5066/P94UXNTS"
METADATA_NAME = "Annual_NLCD_LndCov_2025_CU_C1V2.xml"
CAPTURE_SCHEMA = "upstate.annual-nlcd-static-capture/v1"
INT_NODATA = -2147483648
MAX_METADATA_BYTES = 2 * 1024 * 1024
DEFAULT_MEMBER_BYTES = 32 * 1024 * 1024 * 1024
DEFAULT_CLIP_PIXELS = 250_000_000


def _positive_integer(value, label):
    if type(value) is not int or value <= 0:
        raise ValueError(label + " must be a positive integer")
    return value


def _owned_path(root, relative, *, directory=False):
    """Confine outputs below the selected root, retaining its explicit root alias."""
    root = Path(root).resolve(strict=True)
    relative = Path(relative)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Use an ordinary relative owned source path")
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        is_directory = directory or index < len(relative.parts) - 1
        if current.is_symlink():
            raise ValueError("An owned source descendant must not be a symbolic link")
        if is_directory:
            current.mkdir(exist_ok=True)
            if not current.is_dir():
                raise ValueError("An owned source parent is not a directory")
        elif current.exists() and not current.is_file():
            raise ValueError("An owned source output is not a regular file")
    return current


def _retain(source, destination, expected, *, root):
    """Use the retained native source helper and sync its new directory entry."""
    destination = _owned_path(root, Path(destination).relative_to(root))
    _retain_original(source, destination, expected["sha256"])
    if not _matches(destination, expected):
        raise ValueError("The retained source differs from its original byte identity")
    _fsync_directory(destination.parent)
    return destination


def _bounded(path, maximum=MAX_METADATA_BYTES):
    with Path(path).open("rb") as source:
        raw = source.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("The selected source metadata exceeds its declared intake")
    return raw


def _text(root, path):
    value = root.findtext(path)
    if value is None or not value.strip():
        raise ValueError("Original static metadata is missing " + path)
    return value.strip()


def read_contract(manifest_path):
    """Bind the exact retained publisher XML to its actual static-product row."""
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest_raw = _bounded(manifest_path)
    manifest = json.loads(manifest_raw)
    if (manifest.get("schema") != "commons.original-source/v1"
            or manifest.get("id") != "annual-nlcd-2025-c1v2-static-contract"
            or manifest.get("archive", {}).get("url") != ARCHIVE_URL):
        raise ValueError("Select the retained original 2025 Collection 1.2 static-product contract")
    candidates = [item for item in manifest.get("files", [])
                  if item.get("url") == METADATA_URL and item.get("path") == METADATA_NAME]
    if len(candidates) != 1:
        raise ValueError("The static-product contract must select its exact original metadata")
    metadata_path = verify_file(manifest_path.parent, candidates[0])
    raw = _bounded(metadata_path)
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("The retained original metadata must use its ordinary standalone XML")
    root = ET.fromstring(raw)
    rows = int(_text(root, "spdoinfo/rastinfo/rowcount"))
    columns = int(_text(root, "spdoinfo/rastinfo/colcount"))
    projected = "spref/horizsys/planar/"
    sx = _text(root, projected + "planci/coordrep/absres")
    sy = _text(root, projected + "planci/coordrep/ordres")
    parallels = [node.text.strip() for node in root.findall(projected + "mapproj/albers/stdparll")]
    parameters = {name: _text(root, projected + "mapproj/albers/" + name)
                  for name in ("longcm", "latprjo", "feast", "fnorth")}
    datum = _text(root, "spref/horizsys/geodetic/horizdn")
    semi_major = _text(root, "spref/horizsys/geodetic/semiaxis")
    inverse_flattening = _text(root, "spref/horizsys/geodetic/denflat")
    units = _text(root, projected + "planci/plandu")
    if (rows != 105000 or columns != 160000 or Decimal(sx) != 30 or Decimal(sy) != 30
            or units != "meters" or datum != "WGS_1984" or len(parallels) != 2
            or [Decimal(v) for v in parallels] != [Decimal("29.5"), Decimal("45.5")]
            or {k: Decimal(v) for k, v in parameters.items()} !=
               {"longcm": Decimal("-96"), "latprjo": Decimal("23"),
                "feast": Decimal("0"), "fnorth": Decimal("0")}
            or Decimal(semi_major) != Decimal("6378137")
            or Decimal(inverse_flattening) != Decimal("298.257223563")):
        raise ValueError("The retained metadata differs from the selected published static grid")
    attributes = [node for node in root.findall("eainfo/detailed/attr")
                  if node.findtext("attrlabl") == "Value"]
    if len(attributes) != 1:
        raise ValueError("The original metadata does not identify one land-cover Value domain")
    classes = {}
    for node in attributes[0].findall("attrdomv/edom"):
        code, label = _text(node, "edomv"), _text(node, "edomvd")
        if not code.isdigit() or not 0 <= int(code) <= 255 or code in classes:
            raise ValueError("The original class-domain values are ambiguous")
        classes[code] = label
    nils = [int(code) for code, label in classes.items() if label.casefold() == "nodata"]
    if nils != [250]:
        raise ValueError("The source's published NoData definition differs from this edition")
    pubdate = _text(root, "idinfo/citation/citeinfo/pubdate")
    links = [node.text.strip() for node in root.findall("idinfo/citation/citeinfo/onlink")]
    if pubdate != "20260630" or DOI not in links:
        raise ValueError("The original source publication identity differs")
    contract = {
        "schema": "upstate.annual-nlcd-static-contract/v1", "year": 2025,
        "collection": "Annual NLCD CONUS Collection 1 Version 2",
        "archive_url": ARCHIVE_URL, "metadata_url": METADATA_URL, "doi": DOI,
        "title": _text(root, "idinfo/citation/citeinfo/title"),
        "publication_date": "2026-06-30", "width": columns, "height": rows,
        "resolution_m": [sx, sy], "projection": "Albers Equal Area",
        "datum": datum, "standard_parallels": parallels, "parameters": parameters,
        "semi_major_axis": semi_major, "inverse_flattening": inverse_flattening,
        "class_definitions": classes, "published_nil_values": nils,
        "metadata_sha256": hashlib.sha256(raw).hexdigest(),
        "metadata_manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "catalog": manifest.get("catalog", {}),
        "raster_anchor_policy": "Use the actual TIFF affine reported by the native reader; no inferred half-cell adjustment"}
    return contract, metadata_path, manifest_path


def _members(archive_path, maximum_member_bytes):
    _positive_integer(maximum_member_bytes, "Maximum native TIFF bytes")
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > 1024 or len({i.filename for i in infos}) != len(infos):
            raise ValueError("The original national archive has an ambiguous member inventory")
        members, candidates, total, normalized = [], [], 0, set()
        for item in infos:
            path = PurePosixPath(item.filename)
            mode = item.external_attr >> 16
            if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                    or "\0" in item.filename or (path.parts and ":" in path.parts[0])
                    or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or item.flag_bits & 1 or not path.parts
                    or path.as_posix() in normalized):
                raise ValueError("The original archive member is not an ordinary relative source file")
            normalized.add(path.as_posix())
            total += item.file_size
            row = {"name": item.filename, "bytes": item.file_size,
                   "compressed_bytes": item.compress_size, "compression": item.compress_type,
                   "crc32": f"{item.CRC:08x}", "directory": item.is_dir()}
            members.append(row)
            if not item.is_dir() and path.suffix.lower() in (".tif", ".tiff"):
                if item.file_size <= 0 or item.file_size > maximum_member_bytes:
                    raise ValueError("The original national TIFF exceeds its declared retained-member budget")
                candidates.append(item.filename)
        if not candidates or total > maximum_member_bytes + MAX_METADATA_BYTES * 1024:
            raise ValueError("The national archive's expanded source inventory exceeds this selection")
    return members, candidates


def _raster_assets(members, raster_member):
    """Keep all native TIFF sidecars beside their original member name."""
    primary = PurePosixPath(raster_member)
    full = primary.name.casefold()
    stem = primary.stem.casefold()
    names = {full + suffix for suffix in (".aux.xml", ".msk", ".ovr")}
    names.update(stem + suffix for suffix in (".tfw", ".tifw", ".wld", ".prj", ".aux"))
    companions = [row["name"] for row in members if not row["directory"]
                  and PurePosixPath(row["name"]).parent == primary.parent
                  and PurePosixPath(row["name"]).name.casefold() in names]
    if len({name.casefold() for name in companions}) != len(companions):
        raise ValueError("The original TIFF has ambiguous native sidecar names")
    return [raster_member, *sorted(companions)]


def _capture_identity(value):
    return digest({k: value[k] for k in (
        "schema", "archive", "archive_receipt", "metadata", "metadata_manifest",
        "source_contract", "raster_member", "raster_assets", "members", "transfer_receipt",
        "maximum_archive_bytes", "maximum_member_bytes")})


def read_capture(directory):
    directory = Path(directory).resolve(strict=True)
    value = read_json(directory / "capture.json")
    if (value.get("schema") != CAPTURE_SCHEMA or value.get("state") != "complete"
            or value.get("capture_id") != _capture_identity(value)):
        raise ValueError("Select a completed original national-source capture")
    paths = {}
    for name in ("archive", "archive_receipt", "metadata", "metadata_manifest", "transfer_receipt"):
        if value.get(name) is not None:
            paths[name] = verify_file(directory, value[name])
    contract, metadata, _ = read_contract(paths["metadata_manifest"])
    if contract != value["source_contract"] or metadata != paths["metadata"]:
        raise ValueError("The retained national source contract or its original XML changed")
    receipt = read_json(paths["archive_receipt"])
    if (receipt.get("state") != "complete" or receipt.get("status") != 200
            or receipt.get("url") != ARCHIVE_URL
            or receipt.get("sha256") != value["archive"]["sha256"]
            or receipt.get("bytes") != value["archive"]["bytes"]):
        raise ValueError("The national archive differs from its complete original source receipt")
    _positive_integer(value["maximum_archive_bytes"], "Maximum original archive bytes")
    if not 0 < value["archive"]["bytes"] <= value["maximum_archive_bytes"]:
        raise ValueError("The retained national archive exceeds its original declared budget")
    actual, candidates = _members(paths["archive"], value["maximum_member_bytes"])
    if (actual != value["members"] or value["raster_member"] not in candidates
            or _raster_assets(actual, value["raster_member"]) != value["raster_assets"]):
        raise ValueError("The original national ZIP inventory or selected member changed")
    return value, paths


def receive(directory, *, archive_path, metadata_manifest, maximum_archive_bytes,
            capture_path=None, transfer_path=None, raster_member=None,
            maximum_member_bytes=DEFAULT_MEMBER_BYTES):
    """Adopt one already-completed national download, without another HTTP call."""
    _positive_integer(maximum_archive_bytes, "Maximum original archive bytes")
    _positive_integer(maximum_member_bytes, "Maximum native member bytes")
    if bool(capture_path) == bool(transfer_path):
        raise ValueError("Select either the original HTTP capture receipt or completed source-transfer result")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for name in ("receive.lock", "receive-selection.json", "capture.json"):
        _owned_path(directory, name)
    with held(directory / "receive.lock"):
        archive = Path(archive_path).resolve(strict=True)
        if not archive.is_file() or not 0 < archive.stat().st_size <= maximum_archive_bytes:
            raise ValueError("The national archive does not fit its observed, declared source budget")
        contract, metadata, manifest = read_contract(metadata_manifest)
        transfer_raw = None
        if transfer_path:
            raw = _bounded(transfer_path, 16 * 1024 * 1024)
            transferred, original = received_transfer(
                transfer_path, archive, source_url=ARCHIVE_URL, maximum_bytes=maximum_archive_bytes)
            if raw != _bounded(transfer_path, 16 * 1024 * 1024):
                raise ValueError("The selected original transfer result changed during intake")
            receipt = capture_from_transfer(transferred, original,
                                            transfer_sha256=hashlib.sha256(raw).hexdigest())
            transfer_raw = raw
            receipt_raw = None
        else:
            receipt_raw = _bounded(capture_path, 16 * 1024 * 1024)
            receipt = json.loads(receipt_raw)
            if (receipt.get("url") != ARCHIVE_URL or receipt.get("status") != 200
                    or receipt.get("state") != "complete" or not _matches(archive, receipt)):
                raise ValueError("Keep the exact complete national archive and its original HTTP receipt")
        members, candidates = _members(archive, maximum_member_bytes)
        if raster_member is None:
            if len(candidates) != 1:
                raise ValueError("Select one actual TIFF member from the retained national archive")
            raster_member = candidates[0]
        if raster_member not in candidates:
            raise ValueError("The selected TIFF is absent from the original national ZIP")
        source_receipt_sha = (hashlib.sha256(transfer_raw).hexdigest() if transfer_raw is not None
                              else hashlib.sha256(receipt_raw).hexdigest())
        selection = {"archive_sha256": receipt["sha256"], "archive_bytes": receipt["bytes"],
                     "metadata_sha256": contract["metadata_sha256"],
                     "metadata_manifest_sha256": contract["metadata_manifest_sha256"],
                     "raster_member": raster_member, "original_receipt_sha256": source_receipt_sha,
                     "receipt_kind": "source-transfer" if transfer_raw is not None else "http-capture",
                     "maximum_archive_bytes": maximum_archive_bytes,
                     "maximum_member_bytes": maximum_member_bytes}
        atomic_json(directory / "receive-selection.json", selection, immutable=True)
        if (directory / "capture.json").exists():
            previous, _ = read_capture(directory)
            if (previous["archive"]["sha256"] != receipt["sha256"]
                    or previous["source_contract"] != contract
                    or previous["raster_member"] != raster_member):
                raise ValueError("The existing national capture has a different original selection")
            return previous
        original = _owned_path(directory, "original", directory=True)
        _owned_path(directory, "original/publisher", directory=True)
        for name in ("archive.capture.json", "source-transfer.json"):
            _owned_path(original, name)
        _retain(archive, original / "Annual_NLCD_LndCov_2025_CU_C1V2.zip", receipt, root=directory)
        _retain(metadata, original / "publisher" / METADATA_NAME,
                {"bytes": metadata.stat().st_size, "sha256": contract["metadata_sha256"]}, root=directory)
        _retain(manifest, original / "publisher" / "source-manifest.json",
                {"bytes": manifest.stat().st_size, "sha256": contract["metadata_manifest_sha256"]}, root=directory)
        if receipt_raw is None:
            atomic_json(original / "archive.capture.json", receipt, immutable=True)
        else:
            atomic_bytes(original / "archive.capture.json", receipt_raw, immutable=True)
        if transfer_raw is not None:
            atomic_bytes(original / "source-transfer.json", transfer_raw, immutable=True)
        value = {
            "schema": CAPTURE_SCHEMA, "state": "complete",
            "archive": describe_file(directory, original / "Annual_NLCD_LndCov_2025_CU_C1V2.zip"),
            "archive_receipt": describe_file(directory, original / "archive.capture.json"),
            "metadata": describe_file(directory, original / "publisher" / METADATA_NAME),
            "metadata_manifest": describe_file(directory, original / "publisher" / "source-manifest.json"),
            "transfer_receipt": describe_file(directory, original / "source-transfer.json")
                                if transfer_raw is not None else None,
            "source_contract": contract, "raster_member": raster_member, "members": members,
            "raster_assets": _raster_assets(members, raster_member),
            "maximum_archive_bytes": maximum_archive_bytes,
            "maximum_member_bytes": maximum_member_bytes, "received_at": now(),
            "capture_scope": "Complete untargeted national product; no model geometry sent to a provider"}
        value["capture_id"] = _capture_identity(value)
        atomic_json(directory / "capture.json", value, immutable=True)
        return value


def _expansion_selection(captured):
    return {"capture_id": captured["capture_id"],
            "archive_sha256": captured["archive"]["sha256"],
            "member": captured["raster_member"], "assets": captured["raster_assets"]}


def _member_binding(record):
    return {"selection": record["selection"],
            "assets": [{key: item[key] for key in ("name", "path", "bytes", "sha256", "member_crc32")}
                       for item in record["assets"]]}


def _extract_asset(archive, captured, work, name, index):
    relative = (PurePosixPath("files") / PurePosixPath(name)).as_posix()
    target = _owned_path(work, relative)
    pending = _owned_path(work, relative + ".partial")
    receipt_path = _owned_path(work, "native-asset-" + str(index) + ".json")
    selection = {"capture_id": captured["capture_id"], "name": name}
    if receipt_path.exists():
        record = read_json(receipt_path)
        if record.get("selection") != selection or record.get("state") not in ("received", "complete"):
            raise ValueError("The retained native asset belongs to another original member")
        selected = target if target.exists() else pending
        if not _matches(selected, record):
            raise ValueError("The retained expanded source differs from its original member receipt")
        if selected == pending:
            os.replace(pending, target)
            _fsync_directory(target.parent)
        if record["state"] != "complete":
            record["state"] = "complete"
            atomic_json(receipt_path, record)
        return target, record
    if target.exists():
        raise ValueError("Reconcile the expanded original member that lacks its byte receipt")
    h, count = hashlib.sha256(), 0
    with zipfile.ZipFile(archive) as source:
        member = source.getinfo(name)
        # A noncommitted partial expansion belongs to this same held selection.
        # Rebuild only that local derived member from the retained original ZIP.
        with source.open(member) as reader, pending.open("wb") as writer:
            for block in iter(lambda: reader.read(1024 * 1024), b""):
                count += len(block)
                if count > member.file_size:
                    raise ValueError("The expanded source exceeds its original ZIP member length")
                h.update(block)
                writer.write(block)
            if count != member.file_size:
                raise ValueError("The original ZIP member is incomplete")
            writer.flush()
            os.fsync(writer.fileno())
        record = {"schema": "upstate.original-raster-asset/v1", "state": "received",
                  "selection": selection, "name": name, "path": relative,
                  "member_crc32": f"{member.CRC:08x}", "bytes": count,
                  "sha256": h.hexdigest(), "received_at": now()}
    atomic_json(receipt_path, record)
    os.replace(pending, target)
    _fsync_directory(target.parent)
    record["state"] = "complete"
    atomic_json(receipt_path, record)
    return target, record


def _extract_member(archive, captured, work):
    """Expand the same TIFF and its native sidecars with per-member receipts."""
    selection = _expansion_selection(captured)
    atomic_json(_owned_path(work, "selection.json"), selection, immutable=True)
    assets, native = [], None
    for index, name in enumerate(captured["raster_assets"]):
        path, record = _extract_asset(archive, captured, work, name, index)
        assets.append(record)
        if name == captured["raster_member"]:
            native = path
    record = {"schema": "upstate.original-raster-member/v1", "state": "complete",
              "selection": selection, "member_crc32": assets[0]["member_crc32"],
              "bytes": assets[0]["bytes"], "sha256": assets[0]["sha256"],
              "assets": assets, "received_at": assets[0]["received_at"],
              "integrity": "Every original member read completely, including native ZIP CRC verification"}
    atomic_json(_owned_path(work, "native-member.json"), record, immutable=True)
    return native, record



def _archive_uri(archive, member):
    path = str(Path(archive).resolve(strict=True))
    if "{" in path or "}" in path:
        raise ValueError("Choose an archive path without braces for the native ZIP reader")
    # GDAL's explicit archive syntax keeps the member boundary unambiguous.
    return "/vsizip/{" + path + "}/" + member


def _archive_member(archive, captured, work):
    """Hash complete native members while retaining only the original ZIP."""
    selection = {**_expansion_selection(captured), "read_mode": "archive"}
    atomic_json(_owned_path(work, "archive-selection.json"), selection, immutable=True)
    assets = []
    inventory = {item["name"]: item for item in captured["members"]}
    for index, name in enumerate(captured["raster_assets"]):
        receipt_path = _owned_path(work, "archive-asset-" + str(index) + ".json")
        expected = inventory[name]
        binding = {"capture_id": captured["capture_id"], "name": name}
        if receipt_path.exists():
            record = read_json(receipt_path)
            if (record.get("state") != "complete" or record.get("selection") != binding
                    or record.get("bytes") != expected["bytes"]
                    or record.get("member_crc32") != expected["crc32"]
                    or not isinstance(record.get("sha256"), str)
                    or len(record["sha256"]) != 64):
                raise ValueError("The original archive-member identity differs")
        else:
            h, count = hashlib.sha256(), 0
            with zipfile.ZipFile(archive) as source:
                item = source.getinfo(name)
                with source.open(item) as reader:
                    for block in iter(lambda: reader.read(1024 * 1024), b""):
                        count += len(block)
                        if count > item.file_size:
                            raise ValueError("Original archive member exceeds its native byte count")
                        h.update(block)
                    if count != item.file_size:
                        raise ValueError("The original archive member is incomplete")
                # Reading to EOF also performs zipfile's native CRC check.
                record = {"schema": "upstate.original-raster-asset/v1",
                          "state": "complete", "selection": binding, "name": name,
                          "path": (PurePosixPath("files") / PurePosixPath(name)).as_posix(),
                          "member_crc32": f"{item.CRC:08x}", "bytes": count,
                          "sha256": h.hexdigest(), "received_at": now(),
                          "storage": "Original member inside the retained national ZIP"}
            atomic_json(receipt_path, record, immutable=True)
        assets.append(record)
    if not assets or assets[0]["name"] != captured["raster_member"]:
        raise ValueError("The archive selection must retain the original TIFF first")
    record = {"schema": "upstate.original-raster-member/v1", "state": "complete",
              "selection": _expansion_selection(captured),
              "member_crc32": assets[0]["member_crc32"],
              "bytes": assets[0]["bytes"], "sha256": assets[0]["sha256"],
              "assets": assets, "received_at": assets[0]["received_at"],
              "read_mode": "archive",
              "integrity": "Every selected original member streamed completely through "
                           "SHA256 and native ZIP CRC verification; no expanded copy"}
    atomic_json(_owned_path(work, "archive-member.json"), record, immutable=True)
    return _archive_uri(archive, captured["raster_member"]), record


def _opened_archive_members(archive, opened, assets):
    """Map every GDAL-opened file to its exact already-retained ZIP member."""
    archive = str(Path(archive).resolve(strict=True))
    accepted = {}
    for item in assets:
        name = item["name"]
        accepted["/vsizip/{" + archive + "}/" + name] = name
        accepted["/vsizip/" + archive + "/" + name] = name
    result = []
    for name in opened:
        if name not in accepted:
            raise ValueError("The native ZIP reader used an unretained external source file")
        result.append(accepted[name])
    if not result:
        raise ValueError("The native ZIP reader did not identify its original source member")
    return sorted(set(result))

def _retain_member_receipt(directory, record):
    path = _owned_path(directory, "original/native-member.json")
    if path.exists():
        retained = read_json(path)
        if retained.get("state") != "complete" or _member_binding(retained) != _member_binding(record):
            raise ValueError("The expanded source differs from its retained original TIFF receipt")
        # Re-expanding a lost command-private directory must preserve the first
        # observed original-member receipt and its acquisition times.
        return retained
    atomic_json(path, record, immutable=True)
    return record


def _cleanup_expansion(work, captured, retained):
    """Run under the same work lock after the complete source entry is verified."""
    if not work.exists():
        return
    selection_path = _owned_path(work, "selection.json")
    if not selection_path.exists():
        return
    if read_json(selection_path) != _expansion_selection(captured):
        raise ValueError("The selected expansion directory belongs to another source")
    aggregate = _owned_path(work, "native-member.json")
    if aggregate.exists() and _member_binding(read_json(aggregate)) != _member_binding(retained):
        raise ValueError("The owned expansion receipt differs from the retained source")
    # Validate all remaining members before removing any. A previous completed
    # cleanup may already have removed some files or their per-member receipts.
    removals = []
    for index, item in enumerate(retained["assets"]):
        target = _owned_path(work, item["path"])
        partial = _owned_path(work, item["path"] + ".partial")
        receipt_path = _owned_path(work, "native-asset-" + str(index) + ".json")
        if partial.exists():
            raise ValueError("Reconcile the selected member's unfinished local expansion before cleanup")
        if target.exists():
            if not _matches(target, item):
                raise ValueError("An expanded source changed before its owned cleanup")
            removals.append(target)
        if receipt_path.exists():
            actual = read_json(receipt_path)
            if any(actual.get(key) != item.get(key) for key in
                   ("selection", "name", "path", "bytes", "sha256", "member_crc32")):
                raise ValueError("An owned per-member receipt changed before cleanup")
            removals.append(receipt_path)
    if aggregate.exists():
        removals.append(aggregate)
    parents = {path.parent for path in removals}
    for path in removals:
        path.unlink()
    for parent in sorted(parents):
        _fsync_directory(parent)


def _domain_members(domain):
    """Retain the original native collection, including required shapefile parts."""
    paths = [domain]
    if domain.suffix.casefold() == ".shp":
        suffixes = {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qpj"}
        paths = sorted(path for path in domain.parent.iterdir()
                       if path.stem.casefold() == domain.stem.casefold()
                       and path.suffix.casefold() in suffixes)
        found = [path.suffix.casefold() for path in paths]
        if len(set(found)) != len(found) or not {".shp", ".shx", ".dbf", ".prj"} <= set(found):
            raise ValueError("Retain one complete original shapefile with SHP, SHX, DBF and PRJ")
    if not paths or any(not path.is_file() for path in paths):
        raise ValueError("Every selected original domain member must be a complete regular file")
    return [{"name": path.name, "bytes": path.stat().st_size, "sha256": file_digest(path)}
            for path in paths]

def _inspect_grid(dataset, contract):
    from pyproj import CRS
    if dataset.driver != "GTiff" or dataset.count != 1 or dataset.dtypes[0] != "uint8" or not dataset.crs:
        raise ValueError("The static national source must be its original single-band uint8 GeoTIFF")
    crs = CRS.from_user_input(dataset.crs)
    p = contract["parameters"]
    expected = CRS.from_proj4(
        "+proj=aea +lat_1=" + contract["standard_parallels"][0]
        + " +lat_2=" + contract["standard_parallels"][1]
        + " +lat_0=" + p["latprjo"] + " +lon_0=" + p["longcm"]
        + " +x_0=" + p["feast"] + " +y_0=" + p["fnorth"]
        + " +datum=WGS84 +units=m +no_defs")
    if not crs.equals(expected, ignore_axis_order=True):
        raise ValueError("The actual TIFF CRS differs from the original static WGS84 Albers contract")
    t = dataset.transform
    if (not all(math.isfinite(v) for v in list(t)[:6]) or t.b or t.d
            or not math.isclose(t.a, 30, rel_tol=0, abs_tol=1e-5)
            or not math.isclose(t.e, -30, rel_tol=0, abs_tol=1e-5)
            or dataset.width != contract["width"] or dataset.height != contract["height"]
            or dataset.scales[0] != 1 or dataset.offsets[0] != 0):
        raise ValueError("The static national TIFF differs from its declared dimensions or unscaled class grid")
    observed = {
        "crs": crs.to_wkt(), "crs_name": crs.to_string(), "transform": list(t)[:6],
        "width": dataset.width, "height": dataset.height, "bounds": list(dataset.bounds),
        "dtype": dataset.dtypes[0], "count": dataset.count, "nodata": dataset.nodata,
        "band_scale": dataset.scales[0], "band_offset": dataset.offsets[0],
        "native_tags": dataset.tags(), "native_band_tags": dataset.tags(1),
        "image_structure": dataset.tags(ns="IMAGE_STRUCTURE"),
        "mask_flags": [[str(v) for v in row] for row in dataset.mask_flag_enums],
        "published_nil_values": contract["published_nil_values"],
        "anchor_policy": contract["raster_anchor_policy"]}
    try:
        observed["colormap"] = {str(k): list(v) for k, v in dataset.colormap(1).items()}
    except ValueError:
        observed["colormap"] = None
    return crs, observed


def _window(dataset, geometry, maximum_clip_pixels):
    from rasterio.windows import Window
    left, bottom, right, top = geometry.bounds
    limits = dataset.bounds
    if (left < limits.left or bottom < limits.bottom
            or right > limits.right or top > limits.top):
        raise ValueError("The complete buffered model domain is outside the retained national raster")
    t = dataset.transform
    # Floor/ceil use actual native corner coordinates. One context cell remains
    # around the buffered domain for the existing downstream model alignment.
    c0 = max(0, math.floor((left - t.c) / t.a) - 1)
    c1 = min(dataset.width, math.ceil((right - t.c) / t.a) + 1)
    r0 = max(0, math.floor((top - t.f) / t.e) - 1)
    r1 = min(dataset.height, math.ceil((bottom - t.f) / t.e) + 1)
    if c1 <= c0 or r1 <= r0 or (c1-c0)*(r1-r0) > maximum_clip_pixels:
        raise ValueError("The exact local clip does not fit the declared pixel selection")
    return Window(c0, r0, c1-c0, r1-r0)


def _clip(dataset, window, directory, plan, *, source_tags=None):
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    target, pending = directory / "land-cover.tif", directory / "land-cover.tif.partial"
    receipt_path = directory / "clip.json"
    plan_sha = digest(plan)
    for path in (target, pending, receipt_path):
        _owned_path(directory, path.relative_to(directory))
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("plan_sha256") != plan_sha or receipt.get("state") not in ("received", "complete"):
            raise ValueError("The retained local clip belongs to a different source or domain")
        selected = target if target.exists() else pending
        if not _matches(selected, receipt):
            raise ValueError("The local categorical clip differs from its completed original result")
        if selected == pending:
            os.replace(pending, target)
            _fsync_directory(directory)
        if receipt["state"] != "complete":
            receipt["state"] = "complete"
            atomic_json(receipt_path, receipt)
        return receipt
    if target.exists() or target.is_symlink() or pending.is_symlink():
        raise ValueError("Reconcile the local clip that lacks its native output receipt")
    profile = {"driver": "GTiff", "dtype": "int32", "nodata": INT_NODATA, "count": 1,
               "crs": dataset.crs, "transform": dataset.window_transform(window),
               "width": int(window.width), "height": int(window.height),
               "tiled": True, "blockxsize": 256, "blockysize": 256,
               "compress": "deflate", "predictor": 2, "BIGTIFF": "IF_SAFER"}
    valid, masked_native, extra_nil, counts = 0, 0, 0, {}
    published = plan["source_contract"]["class_definitions"]
    with rasterio.open(pending, "w", **profile) as output:
        for _, block in output.block_windows(1):
            source_window = Window(window.col_off + block.col_off, window.row_off + block.row_off,
                                   block.width, block.height)
            data = dataset.read(1, window=source_window, masked=True)
            raw, native_mask = np.ma.getdata(data), np.ma.getmaskarray(data)
            nil = np.isin(raw, plan["source_contract"]["published_nil_values"])
            mask = native_mask | nil
            codes, amounts = np.unique(raw[~mask], return_counts=True)
            for code, amount in zip(codes, amounts):
                key = str(int(code))
                if key not in published:
                    raise ValueError("The original TIFF contains an undeclared class in the selected local domain: " + key)
                counts[key] = counts.get(key, 0) + int(amount)
            values = raw.astype("int32")
            values[mask] = INT_NODATA
            output.write(values, 1, window=block)
            valid += int((~mask).sum())
            masked_native += int(native_mask.sum())
            extra_nil += int((nil & ~native_mask).sum())
        tags = {
            "units": "class", "source": ARCHIVE_URL, "source_year": "2025",
            "preparation": "Local native-grid window; original class values and native affine retained",
            "source_metadata_sha256": plan["source_contract"]["metadata_sha256"],
            "model_domain_sha256": plan["domain_sha256"],
            "nil_policy": "Original TIFF mask and published 250 NoData normalized to int32 NoData",
        }
        if source_tags is None:
            tags["source_member_sha256"] = plan["native_member_sha256"]
        else:
            allowed = {"source_entity_url", "source_entity_etag", "source_entity_bytes",
                       "source_member_crc32", "source_member_compressed_bytes", "source_access"}
            if not isinstance(source_tags, dict) or set(source_tags) - allowed:
                raise ValueError("Use the original source-entity identity tags for this native window")
            tags.update({key: str(value) for key, value in source_tags.items()})
        output.update_tags(**tags)
    if not valid:
        raise ValueError("The retained national source has no valid land-cover cells in this domain")
    with pending.open("rb") as reader:
        os.fsync(reader.fileno())
    record = {"schema": "upstate.annual-nlcd-local-clip/v1", "state": "received",
              "plan_sha256": plan_sha, "bytes": pending.stat().st_size, "sha256": file_digest(pending),
              "received_at": now(), "transform": list(profile["transform"])[:6],
              "width": profile["width"], "height": profile["height"],
              "valid_cells": valid, "native_masked_cells": masked_native,
              "extra_published_nil_cells": extra_nil,
              "nodata_cells": masked_native + extra_nil, "class_counts": counts,
              "prepared_dtype": "int32", "prepared_nodata": INT_NODATA}
    atomic_json(receipt_path, record)
    os.replace(pending, target)
    _fsync_directory(directory)
    record["state"] = "complete"
    atomic_json(receipt_path, record)
    return record


def _verify_entry(directory, entry):
    verify_file(directory, entry)
    for item in entry["companions"]:
        verify_file(directory, item)
    manifest = {"schema": "upstate.sources/v1", "title": entry["title"], "entries": [entry]}
    atomic_json(directory / "sources.json", manifest, immutable=True)
    return entry


def prepare(directory, *, capture_directory, domain, buffer_m=1000, layer=None, where=None,
            expected_features=None, maximum_clip_pixels=DEFAULT_CLIP_PIXELS, work_directory=None,
            read_mode="expanded"):
    """Create a native-grid local clip and the existing NLCD source manifest."""
    import rasterio
    if read_mode not in ("expanded", "archive"):
        raise ValueError("Choose expanded or archive native source reading")
    _positive_integer(maximum_clip_pixels, "Maximum local clip pixels")
    if expected_features is not None:
        _positive_integer(expected_features, "Expected native-domain feature count")
    if not math.isfinite(buffer_m) or buffer_m <= 0:
        raise ValueError("Use a positive model-domain buffer in metres")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    capture_directory = Path(capture_directory).resolve(strict=True)
    domain = Path(domain).resolve(strict=True)
    for name in ("prepare.lock", "selection.json", "plan.json", "clip.json",
                 "source-entry.json", "sources.json", "original/native-member.json",
                 "original/native-grid.json"):
        _owned_path(directory, name)
    with held(directory / "prepare.lock"):
        captured, paths = read_capture(capture_directory)
        domain_sha = file_digest(domain)
        domain_members = _domain_members(domain)
        selection = {
            "schema": "upstate.annual-nlcd-static-selection/v1",
            "capture_id": captured["capture_id"], "domain_sha256": domain_sha,
            "domain_bytes": domain.stat().st_size, "domain_members": domain_members,
            "layer": layer, "where": where,
            "buffer_m": float(buffer_m), "expected_features": expected_features,
            "maximum_clip_pixels": maximum_clip_pixels}
        if read_mode == "archive":
            selection["native_read_mode"] = "archive"
        atomic_json(directory / "selection.json", selection, immutable=True)
        work = Path(work_directory).resolve() if work_directory else directory / "working"
        if work == directory or work.is_relative_to(directory / "original"):
            raise ValueError("Use a distinct owned expansion directory outside the retained originals")
        if (directory / "source-entry.json").exists():
            entry = read_json(directory / "source-entry.json")
            if entry.get("selection_sha256") != digest(selection):
                raise ValueError("The existing source entry selects another national edition or domain")
            result = _verify_entry(directory, entry)
            if read_mode == "expanded" and work.exists():
                with held(_owned_path(work, "native-member.lock"), blocking=False):
                    retained_member = read_json(directory / "original/native-member.json")
                    _cleanup_expansion(work, captured, retained_member)
            return result
        retained = []
        for name, source in paths.items():
            item = captured[name]
            target = directory / "original" / item["path"]
            _retain(source, target, item, root=directory)
            retained.append(target)
        capture_target = directory / "original" / "capture.json"
        _retain(capture_directory / "capture.json", capture_target,
                describe_file(capture_directory, capture_directory / "capture.json"), root=directory)
        retained.append(capture_target)
        original_domain = directory / "original" / "domain" / domain.name
        for item in domain_members:
            target = directory / "original" / "domain" / item["name"]
            _retain(domain.parent / item["name"], target, item, root=directory)
            retained.append(target)
        # The caller may put the sole expanded original member in its declared
        # command-private area; the complete ZIP and final clip remain retained.
        work.mkdir(parents=True, exist_ok=True)
        with held(_owned_path(work, "native-member.lock"), blocking=False):
            native, member_receipt = (_archive_member(paths["archive"], captured, work)
                                      if read_mode == "archive" else
                                      _extract_member(paths["archive"], captured, work))
            member_receipt = _retain_member_receipt(directory, member_receipt)
            with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(native) as dataset:
                native_crs, native_grid = _inspect_grid(dataset, captured["source_contract"])
                if read_mode == "archive":
                    native_grid["opened_source_members"] = _opened_archive_members(
                        paths["archive"], dataset.files, member_receipt["assets"])
                else:
                    available_assets = {(work / item["path"]).resolve(strict=True): item
                                        for item in member_receipt["assets"]}
                    opened = [Path(name).resolve(strict=True) for name in dataset.files]
                    if any(path not in available_assets for path in opened):
                        raise ValueError("The native TIFF reader used an unretained external source file")
                    native_grid["opened_source_members"] = sorted(available_assets[path]["name"] for path in opened)
                rows, reader = _domain_geometry(original_domain, layer=layer, where=where,
                                                target_crs=native_crs)
                if expected_features is not None and len(rows) != expected_features:
                    raise ValueError("The retained domain has a different selected feature count")
                for item in domain_members:
                    target = directory / "original" / "domain" / item["name"]
                    if not _matches(target, item):
                        raise ValueError("The selected native domain changed during geometry reading")
                union = rasters.polygon_union(rows)
                geometry = union.buffer(buffer_m)
                if geometry.is_empty or not geometry.is_valid:
                    raise ValueError("The complete projected buffered domain needs an explicit source correction")
                window = _window(dataset, geometry, maximum_clip_pixels)
                plan = {
                    **selection, "schema": "upstate.annual-nlcd-static-local-plan/v1",
                    "source_contract": captured["source_contract"],
                    "archive_sha256": captured["archive"]["sha256"],
                    "raster_member": captured["raster_member"],
                    "native_member_sha256": member_receipt["sha256"], "native_grid": native_grid,
                    "domain_reader": reader, "domain_feature_count": len(rows),
                    "domain_bounds": list(union.bounds), "buffered_domain_bounds": list(geometry.bounds),
                    "native_window": [int(window.col_off), int(window.row_off),
                                      int(window.width), int(window.height)],
                    "local_clip_bounds": list(rasterio.windows.bounds(window, dataset.transform)),
                    "processing": "Integer native pixel window; no remote AOI and no spatial resampling",
                    "domain_mask": "The original scientific model applies its retained buffered-domain mask after alignment",
                    "expanded_member_bytes": sum(item["bytes"] for item in member_receipt["assets"]),
                    "uncompressed_prepared_pixel_bytes": int(window.width * window.height) * 4}
                if read_mode == "archive":
                    plan["native_access"] = "GDAL /vsizip/ over the complete verified local national archive"
                    plan["scratch_expansion_bytes"] = 0
                atomic_json(directory / "plan.json", plan, immutable=True)
                clip = _clip(dataset, window, directory, plan)
            atomic_json(directory / "original" / "native-grid.json", native_grid, immutable=True)
            companion_paths = retained + [directory / name for name in (
                "selection.json", "plan.json", "clip.json", "original/native-member.json", "original/native-grid.json")]
            entry = {
                "id": "annual-nlcd-2025-c1v2-static-" + digest(plan)[:16],
                "title": "Annual NLCD 2025 Collection 1.2 original classes, local upstream-domain clip",
                "kind": "raster", "role": "NLCD", "units": "class", "resampling": "nearest",
                "uri": ARCHIVE_URL, "vintage": "2025 land cover; Collection 1 Version 2; published 2026-06-30",
                "citation": {"publisher": "U.S. Geological Survey", "url": DOI, "metadata": METADATA_URL},
                **describe_file(directory, directory / "land-cover.tif"),
                "selection_sha256": digest(selection), "preparation_sha256": digest(plan),
                "source_capture_id": captured["capture_id"], "original_archive_sha256": captured["archive"]["sha256"],
                "original_member_sha256": member_receipt["sha256"],
                "source_metadata_sha256": captured["source_contract"]["metadata_sha256"],
                "model_domain_sha256": domain_sha, "domain_feature_count": len(rows),
                "source_resolution": "Original static 30 m WGS84 Albers pixel grid",
                "source_time": "2025", "buffer_m": buffer_m, "native_grid": native_grid,
                "prepared_grid": {k: clip[k] for k in ("transform", "width", "height", "prepared_dtype",
                                  "prepared_nodata", "class_counts", "valid_cells", "nodata_cells")},
                "derivation": plan["processing"], "companions": [
                    describe_file(directory, p) for p in sorted(set(companion_paths))]}
            atomic_json(directory / "source-entry.json", entry, immutable=True)
            result = _verify_entry(directory, entry)
            if read_mode == "expanded":
                _cleanup_expansion(work, captured, member_receipt)
            return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Read the completed original capture and actual ZIP member sizes")
    inspect.add_argument("--capture-directory", required=True)
    receive_parser = commands.add_parser("receive", help="Adopt a retained complete national archive and source receipt")
    receive_parser.add_argument("--archive", required=True)
    receive_parser.add_argument("--metadata-manifest", required=True)
    receipt = receive_parser.add_mutually_exclusive_group(required=True)
    receipt.add_argument("--capture", help="The original complete HTTP source receipt")
    receipt.add_argument("--transfer", help="The original complete SourceArtifacts result")
    receive_parser.add_argument("--maximum-archive-bytes", type=int, required=True)
    receive_parser.add_argument("--maximum-member-bytes", type=int, default=DEFAULT_MEMBER_BYTES)
    receive_parser.add_argument("--raster-member")
    receive_parser.add_argument("--output", required=True)
    prepare_parser = commands.add_parser("prepare", help="Clip all selected native-domain features entirely locally")
    prepare_parser.add_argument("--capture-directory", required=True)
    prepare_parser.add_argument("--domain", required=True)
    prepare_parser.add_argument("--layer")
    prepare_parser.add_argument("--where-json")
    prepare_parser.add_argument("--expected-features", type=int)
    prepare_parser.add_argument("--buffer-m", type=float, default=1000)
    prepare_parser.add_argument("--maximum-clip-pixels", type=int, default=DEFAULT_CLIP_PIXELS)
    prepare_parser.add_argument("--work-directory", help="Declared owned scratch for the sole original TIFF expansion")
    prepare_parser.add_argument("--read-mode", choices=("expanded", "archive"), default="expanded",
                                help="Read the verified national ZIP directly or expand its original TIFF")
    prepare_parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "receive":
        value = receive(args.output, archive_path=args.archive, metadata_manifest=args.metadata_manifest,
                        maximum_archive_bytes=args.maximum_archive_bytes, capture_path=args.capture,
                        transfer_path=args.transfer, raster_member=args.raster_member,
                        maximum_member_bytes=args.maximum_member_bytes)
    elif args.command == "inspect":
        captured, _ = read_capture(args.capture_directory)
        selected = next(row for row in captured["members"] if row["name"] == captured["raster_member"])
        value = {"capture_id": captured["capture_id"], "archive": captured["archive"],
                 "native_member": selected, "source_contract": captured["source_contract"],
                 "native_assets": captured["raster_assets"],
                 "additional_expanded_member_bytes": sum(row["bytes"] for row in captured["members"]
                                                         if row["name"] in captured["raster_assets"]),
                 "members": captured["members"]}
    else:
        value = prepare(args.output, capture_directory=args.capture_directory, domain=args.domain,
                        layer=args.layer, where=json.loads(args.where_json) if args.where_json else None,
                        expected_features=args.expected_features, buffer_m=args.buffer_m,
                        maximum_clip_pixels=args.maximum_clip_pixels, work_directory=args.work_directory,
                        read_mode=args.read_mode)
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
