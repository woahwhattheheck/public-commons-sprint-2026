"""Retain NOAA's original CONUS R-factor raster for the existing SDR input.

Capture uses standard-library HTTP/ZIP support. Preparation uses the existing
native raster runtime and preserves the original numeric GeoTIFF.
"""
from __future__ import annotations
import argparse
from decimal import Decimal
import gzip
import hashlib
from html.parser import HTMLParser
import io
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

from model.common import (atomic_json, describe_file, digest, file_digest,
                          held, now, read_json, retain_file, verify_file)
from .raster_sources import capture, _fsync_directory, _matches

ARCHIVE_URL = "https://coast.noaa.gov/data/digitalcoast/zip/R-Factor-CONUS.zip"
METADATA_URL = "https://www.fisheries.noaa.gov/inport/item/48224"
CONVERSION_REFERENCE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html"
NATIVE_UNITS = "hundreds*ft*tonf*in/(acre*h*year)"
SI_UNITS = "MJ*mm/(ha*h*year)"
R_TO_SI = Decimal("17.02")
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_RASTER_BYTES = 512 * 1024 * 1024

class _DocumentText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

def metadata_contract(path):
    original = Path(path).read_bytes()
    if original.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(original)) as archive:
            raw = archive.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError("The original NOAA metadata exceeds this source's document limit")
    else:
        raw = original
    parser = _DocumentText()
    parser.feed(raw.decode("utf-8-sig"))
    text = re.sub(r"\s+", " ", " ".join(parser.parts))
    required = ("R-Factor for the Conterminous United States",
                "(hundreds ft-tonf-in)/(ac-h-yr)", "800 meter",
                "Albers", "NAD83", "2013-12-26", "1975", "1997",
                "Agriculture Handbook")
    missing = [value for value in required if value not in text]
    if missing:
        raise ValueError("Review the original NOAA metadata before selecting this R source: "
                         + ", ".join(missing))
    return {
        "publisher": "NOAA Office for Coastal Management",
        "identifier": "gov.noaa.nmfs.inport:48224",
        "metadata_url": METADATA_URL,
        "source_period": {"start": "1975", "end": "1997"},
        "publication_date": "2013-12-26",
        "source_reference": "Renard et al. (1997), Agriculture Handbook 703, pages 47-51",
        "published_grid": "800 metre Albers Equal Area, GRS80, NAD83",
        "published_native_units": NATIVE_UNITS,
        "published_method": "Digitized original isoerodents; original NOAA interpolated raster",
        "decoded_metadata_sha256": hashlib.sha256(raw).hexdigest(),
        "metadata_encoding": "gzip" if raw is not original else "identity",
    }

def _receipt(root, item, expected_url):
    path = verify_file(root, item)
    receipt = read_json(path.with_name(path.name + ".capture.json"))
    if (receipt.get("url") != expected_url or receipt.get("status") != 200
            or receipt.get("state") not in (None, "complete") or not _matches(path, receipt)):
        raise ValueError("The retained original NOAA response does not match its receipt")
    return path, receipt

def _members(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > 256 or len({i.filename for i in infos}) != len(infos):
            raise ValueError("The original NOAA archive has an ambiguous or unsupported member inventory")
        members, candidates = [], []
        expanded = 0
        for info in infos:
            name = PurePosixPath(info.filename)
            if (name.is_absolute() or ".." in name.parts or "\\" in info.filename
                    or (name.parts and ":" in name.parts[0])):
                raise ValueError("The original archive has an unsafe member path")
            mode = info.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError("Retain only the source archive's original regular members")
            expanded += info.file_size
            members.append({"name": info.filename, "bytes": info.file_size,
                            "compressed_bytes": info.compress_size,
                            "compression": info.compress_type,
                            "crc32": f"{info.CRC:08x}", "directory": info.is_dir()})
            if not info.is_dir() and name.suffix.lower() in (".tif", ".tiff"):
                if info.file_size > MAX_RASTER_BYTES:
                    raise ValueError("The original R-factor raster exceeds the declared native intake")
                candidates.append(info.filename)
        if expanded > 1024 * 1024 * 1024:
            raise ValueError("The original NOAA archive exceeds the declared expanded inventory")
        if not candidates:
            raise ValueError("The original NOAA archive contains no GeoTIFF member")
    return members, candidates

def _capture_manifest(directory, meta_receipt, archive_receipt, *, transferred=False):
    metadata = directory / "metadata.html"
    archive = directory / "noaa-r-factor-conus.zip"
    members, candidates = _members(archive)
    result = {
        "schema": "upstate.noaa-rainfall-erosivity-capture/v1",
        "captured_at": now(), "source_contract": metadata_contract(metadata),
        "archive": describe_file(directory, archive),
        "metadata": describe_file(directory, metadata),
        "archive_receipt": describe_file(directory, archive.with_name(archive.name + ".capture.json")),
        "metadata_receipt": describe_file(directory, metadata.with_name(metadata.name + ".capture.json")),
        "observed_interval": {"start": meta_receipt["requested_at"],
                              "end": archive_receipt["observed_at"]},
        "members": members, "raster_candidates": candidates,
    }
    if transferred:
        result["transfer_receipt"] = describe_file(directory, directory / "source-transfer.json")
    result["capture_id"] = digest(result)
    atomic_json(directory / "capture.json", result, immutable=True)
    return result

def capture_original(directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".capture.lock"):
        result_path = directory / "capture.json"
        if result_path.exists():
            return read_capture(directory)[0]
        meta_receipt = capture(METADATA_URL, directory / "metadata.html", maximum_bytes=8*1024*1024)
        metadata_contract(directory / "metadata.html")
        archive_receipt = capture(ARCHIVE_URL, directory / "noaa-r-factor-conus.zip",
                                  maximum_bytes=MAX_ARCHIVE_BYTES)
        return _capture_manifest(directory, meta_receipt, archive_receipt)

def _received_transfer(path, archive):
    from .source_transfer import received_transfer
    return received_transfer(path, archive, source_url=ARCHIVE_URL, maximum_bytes=MAX_ARCHIVE_BYTES)

def receive_original(directory, *, archive_path, transfer_path, metadata_path, metadata_receipt_path):
    """Join received original bytes to the existing capture without a provider request."""
    archive_path = Path(archive_path).resolve(strict=True)
    transfer_path = Path(transfer_path).resolve(strict=True)
    metadata_path = Path(metadata_path).resolve(strict=True)
    metadata_receipt_path = Path(metadata_receipt_path).resolve(strict=True)
    transfer, transferred = _received_transfer(transfer_path, archive_path)
    meta_receipt = read_json(metadata_receipt_path)
    if (meta_receipt.get("url") != METADATA_URL or meta_receipt.get("status") != 200
            or meta_receipt.get("state") not in (None, "complete")
            or not isinstance(meta_receipt.get("requested_at"), str)
            or not _matches(metadata_path, meta_receipt)):
        raise ValueError("Select the retained original NOAA metadata and its actual HTTP receipt")
    metadata_contract(metadata_path)
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".capture.lock"):
        if (directory / "capture.json").exists():
            captured, _, _ = read_capture(directory)
            if (captured["archive"]["sha256"] != transferred["sha256"]
                    or captured["metadata"]["sha256"] != file_digest(metadata_path)
                    or captured.get("transfer_receipt", {}).get("sha256") != file_digest(transfer_path)):
                raise ValueError("The existing source capture belongs to another received edition")
            return captured
        _retain(archive_path, directory / "noaa-r-factor-conus.zip", transferred, directory)
        _retain(metadata_path, directory / "metadata.html", meta_receipt, directory)
        for original, name in ((metadata_receipt_path, "metadata.html.capture.json"),
                               (transfer_path, "source-transfer.json")):
            expected = {"bytes": original.stat().st_size, "sha256": file_digest(original)}
            _retain(original, directory / name, expected, directory)
        source = transferred["source"]
        archive_receipt = {
            "schema": "upstate.received-public-source/v1", "state": "complete",
            "url": ARCHIVE_URL, "final_url": source["final_url"], "status": 200,
            "source_header_observed_at": source["observed_at"],
            "observed_at": transfer["body"]["streamed_at"],
            "bytes": transferred["bytes"], "sha256": transferred["sha256"],
            "headers": {name: source[key] for name, key in
                        (("Content-Type", "content_type"), ("ETag", "etag"), ("Last-Modified", "last_modified"))
                        if source.get(key) is not None},
            "capture_method": "Original SourceArtifacts HTTP-200 stream and completed file handoff",
            "transfer_operation_id": transfer["operation_id"],
            "transfer_file_id": transferred["file_id"],
            "transfer_receipt_sha256": file_digest(transfer_path),
        }
        atomic_json(directory / "noaa-r-factor-conus.zip.capture.json", archive_receipt, immutable=True)
        return _capture_manifest(directory, meta_receipt, archive_receipt, transferred=True)

def read_capture(directory):
    directory = Path(directory).resolve(strict=True)
    result = read_json(directory / "capture.json")
    if result.get("schema") != "upstate.noaa-rainfall-erosivity-capture/v1":
        raise ValueError("Select the retained original NOAA source capture")
    identity = dict(result)
    selected_id = identity.pop("capture_id", None)
    if digest(identity) != selected_id:
        raise ValueError("The retained NOAA capture identity changed")
    for field in ("archive_receipt", "metadata_receipt", "transfer_receipt"):
        if field in result:
            verify_file(directory, result[field])
    archive, _ = _receipt(directory, result["archive"], ARCHIVE_URL)
    metadata, _ = _receipt(directory, result["metadata"], METADATA_URL)
    if "transfer_receipt" in result:
        _received_transfer(verify_file(directory, result["transfer_receipt"]), archive)
    if metadata_contract(metadata) != result["source_contract"]:
        raise ValueError("The original NOAA source contract differs")
    members, candidates = _members(archive)
    if members != result["members"] or candidates != result["raster_candidates"]:
        raise ValueError("The original NOAA archive inventory differs")
    return result, archive, metadata

def _retain(source, destination, expected, root):
    source, destination, root = Path(source).resolve(strict=True), Path(destination), Path(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if not _matches(destination, expected):
            raise ValueError("The retained NOAA source member differs: " + str(destination))
        return destination
    if source == destination.resolve():
        raise ValueError("Original source member unexpectedly disappeared")
    try:
        os.link(source, destination)
    except OSError as error:
        import errno
        if error.errno != errno.EXDEV:
            raise
        saved = retain_file(root, source, expected["sha256"])
        os.link(root / saved["object"], destination)
    if not _matches(destination, expected):
        raise ValueError("Original source bytes changed during handoff")
    _fsync_directory(destination.parent)
    return destination

def _extract_original(archive_path, member_name, directory, plan):
    destination = directory / "rainfall-erosivity-native.tif"
    pending = directory / "rainfall-erosivity-native.tif.partial"
    receipt_path = directory / "native-member.json"
    plan_sha = digest(plan)
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("plan_sha256") != plan_sha or receipt.get("state") not in ("received", "complete"):
            raise ValueError("The retained original-raster extraction belongs to another selection")
        selected = destination if destination.exists() else pending
        if not _matches(selected, receipt):
            raise ValueError("The retained original R-factor member differs")
        if selected == pending:
            os.replace(pending, destination)
            _fsync_directory(directory)
        if receipt["state"] != "complete":
            receipt["state"] = "complete"
            atomic_json(receipt_path, receipt)
        return destination
    if destination.exists():
        raise ValueError("Reconcile the original R raster that has no extraction receipt")
    h, size = hashlib.sha256(), 0
    with zipfile.ZipFile(archive_path) as archive:
        info = archive.getinfo(member_name)
        with archive.open(info) as source, pending.open("wb") as output:
            for block in iter(lambda: source.read(1024*1024), b""):
                size += len(block)
                if size > info.file_size or size > MAX_RASTER_BYTES:
                    raise ValueError("Original R-factor member exceeds its declared length")
                h.update(block)
                output.write(block)
            if size != info.file_size:
                raise ValueError("Original R-factor member is incomplete")
            output.flush()
            os.fsync(output.fileno())
        receipt = {"schema": "upstate.original-raster-member/v1",
                   "state": "received", "plan_sha256": plan_sha,
                   "archive_sha256": plan["archive_sha256"],
                   "member": info.filename, "member_crc32": f"{info.CRC:08x}",
                   "bytes": size, "sha256": h.hexdigest(), "received_at": now()}
    atomic_json(receipt_path, receipt)
    os.replace(pending, destination)
    _fsync_directory(directory)
    receipt["state"] = "complete"
    atomic_json(receipt_path, receipt)
    return destination

def _native_grid(path):
    import numpy as np
    import rasterio
    from pyproj import CRS
    with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), rasterio.open(path) as source:
        if source.driver != "GTiff" or source.count != 1 or not source.crs:
            raise ValueError("Select the original NOAA single-band numeric GeoTIFF")
        crs = CRS.from_user_input(source.crs)
        units = [a.unit_conversion_factor for a in crs.axis_info[:2]]
        method = crs.coordinate_operation.method_name if crs.coordinate_operation else ""
        datum = crs.datum.name if crs.datum else ""
        if (not crs.is_projected or len(units) != 2 or any(abs(v-1) > 1e-10 for v in units)
                or "albers" not in method.lower()
                or not ("north american" in datum.lower().replace("_", " ") and "1983" in datum)):
            raise ValueError("The original R-factor CRS differs from NOAA's published Albers/NAD83 grid")
        t = source.transform
        if (t.b or t.d or not math.isclose(t.a, 800, abs_tol=1e-7)
                or not math.isclose(t.e, -800, abs_tol=1e-7)):
            raise ValueError("The original NOAA raster differs from its published 800 metre grid")
        scale, offset = float(source.scales[0]), float(source.offsets[0])
        if not math.isfinite(scale) or scale <= 0 or offset != 0:
            raise ValueError("The original raster needs a different explicit physical conversion")
        low, high, valid, missing = None, None, 0, 0
        for _, window in source.block_windows(1):
            values = source.read(1, window=window, masked=True)
            raw = np.ma.getdata(values)
            masked = np.ma.getmaskarray(values)
            if np.any(~masked & ~np.isfinite(raw)):
                raise ValueError("Original R-factor contains unmasked nonfinite values")
            good = raw[~masked]
            if np.any(good < 0):
                raise ValueError("Original R-factor contains negative physical values")
            valid += int(good.size)
            missing += int(masked.sum())
            if good.size:
                low = float(good.min()) if low is None else min(low, float(good.min()))
                high = float(good.max()) if high is None else max(high, float(good.max()))
        if not valid or high <= 0:
            raise ValueError("Original NOAA raster has no positive rainfall-erosivity values")
        nodata = source.nodata
        if nodata is not None and not math.isfinite(nodata):
            nodata = str(nodata)
        return {"crs": crs.to_wkt(), "crs_name": crs.to_string(), "datum": datum,
                "transform": list(t)[:6], "resolution_m": [float(x) for x in source.res],
                "width": source.width, "height": source.height, "dtype": source.dtypes[0],
                "nodata": nodata, "band_scale": str(scale), "band_offset": str(offset),
                "native_tags": source.tags(), "native_band_tags": source.tags(1),
                "image_structure": source.tags(ns="IMAGE_STRUCTURE"),
                "valid_cells": valid, "nodata_cells": missing,
                "minimum_stored_value": low, "maximum_stored_value": high}

def prepare(directory, *, capture_directory=None, raster_member=None):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock"):
        if capture_directory is None:
            capture_directory = directory / "original"
            capture_original(capture_directory)
        capture_directory = Path(capture_directory).resolve(strict=True)
        captured, original_archive, metadata = read_capture(capture_directory)
        candidates = captured["raster_candidates"]
        if raster_member is None:
            if len(candidates) != 1:
                raise ValueError("Select one actual original GeoTIFF from the retained raster_candidates")
            raster_member = candidates[0]
        if raster_member not in candidates:
            raise ValueError("Selected raster member is absent from the original capture")
        plan = {"schema": "upstate.noaa-rainfall-erosivity-source/v1",
                "capture_id": captured["capture_id"],
                "capture_sha256": file_digest(capture_directory / "capture.json"),
                "archive_sha256": captured["archive"]["sha256"],
                "metadata_sha256": captured["metadata"]["sha256"],
                "raster_member": raster_member, "source_contract": captured["source_contract"],
                "unit_conversion_factor": str(R_TO_SI), "target_units": SI_UNITS,
                "unit_conversion_reference": CONVERSION_REFERENCE,
                "resampling": "bilinear"}
        atomic_json(directory / "plan.json", plan, immutable=True)
        result_path = directory / "source-entry.json"
        if result_path.exists():
            entry = read_json(result_path)
            if entry["preparation_sha256"] != digest(plan):
                raise ValueError("The original R-factor preparation selection changed")
            verify_file(directory, entry)
            for item in entry["companions"]:
                verify_file(directory, item)
            atomic_json(directory / "source-manifest.json",
                        {"schema": "upstate.sources/v1", "title": entry["title"], "entries": [entry]},
                        immutable=True)
            return entry
        retained = []
        for field in ("archive", "metadata", "archive_receipt", "metadata_receipt", "transfer_receipt"):
            if field not in captured:
                continue
            item = captured[field]
            source = verify_file(capture_directory, item)
            target = directory / "original" / item["path"]
            retained.append(_retain(source, target, item, directory))
        capture_file = capture_directory / "capture.json"
        captured_item = describe_file(capture_directory, capture_file)
        retained.append(_retain(capture_file, directory / "original/capture.json",
                                captured_item, directory))
        destination = _extract_original(directory / "original" / captured["archive"]["path"],
                                        raster_member, directory, plan)
        native = _native_grid(destination)
        factor = R_TO_SI * Decimal(native["band_scale"])
        companions = [describe_file(directory, p) for p in retained]
        companions.extend(describe_file(directory, directory / name)
                          for name in ("plan.json", "native-member.json"))
        entry = {
            "id": "noaa-r-factor-conus-2013-" + captured["archive"]["sha256"][:16],
            "title": "NOAA CONUS original rainfall-runoff erosivity",
            "kind": "raster", "role": "R_FACTOR", "uri": ARCHIVE_URL,
            "vintage": "2013 publication of 1975-1997/AH703 source isoerodents",
            "units": NATIVE_UNITS, "resampling": "bilinear",
            **describe_file(directory, destination), "native_grid": native,
            "preparation_sha256": digest(plan), "companions": companions,
            "conversion": {"factor": str(factor), "target_units": SI_UNITS,
                           "reference": CONVERSION_REFERENCE,
                           "native_unit_reference": METADATA_URL,
                           "unit_factor": str(R_TO_SI),
                           "source_band_scale": native["band_scale"],
                           "application": "Once during the existing model grid preparation"},
            "source_contract": captured["source_contract"],
            "source_capture_id": captured["capture_id"],
            "source_resolution": "Original 800 metre grid, retained unchanged",
            "selection_note": "A named historical R reference. Source resolution and original "
                              "isoerodent lineage remain visible when aligned to the model's 30m grid.",
        }
        atomic_json(result_path, entry, immutable=True)
        atomic_json(directory / "source-manifest.json",
                    {"schema": "upstate.sources/v1", "title": entry["title"], "entries": [entry]},
                    immutable=True)
        return entry

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("capture", help="Retain the original NOAA archive, metadata and HTTP receipts")
    c.add_argument("--output", required=True)
    receive = sub.add_parser("receive", help="Open a completed original archive transfer without another HTTP capture")
    receive.add_argument("--output", required=True)
    receive.add_argument("--archive", required=True)
    receive.add_argument("--transfer", required=True)
    receive.add_argument("--metadata", required=True)
    receive.add_argument("--metadata-receipt", required=True)
    p = sub.add_parser("prepare", help="Prepare the original numeric R raster for the model source composer")
    p.add_argument("--output", required=True)
    p.add_argument("--capture-directory", help="Reuse a complete original capture without HTTP requests")
    p.add_argument("--raster-member", help="Select an actual member from the original archive inventory")
    args = parser.parse_args(argv)
    if args.command == "capture":
        result = capture_original(args.output)
    elif args.command == "receive":
        result = receive_original(args.output, archive_path=args.archive,
                                  transfer_path=args.transfer, metadata_path=args.metadata,
                                  metadata_receipt_path=args.metadata_receipt)
    else:
        result = prepare(args.output, capture_directory=args.capture_directory,
                         raster_member=args.raster_member)
    import json
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))

if __name__ == "__main__":
    main()
