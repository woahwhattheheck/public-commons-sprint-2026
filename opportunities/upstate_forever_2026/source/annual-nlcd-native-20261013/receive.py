#!/usr/bin/env python3
"""Materialize the completed original Annual NLCD2025 native regional GeoTIFF.

The input is the exact completed GeoTIFF in this source edition. Every serialized
strip and decoded pixel hash is checked using only Python's standard library.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
import zlib

def sha256(body):
    return hashlib.sha256(body).hexdigest()


def checked(body, expected, size_key="bytes", hash_key="sha256"):
    if len(body) != expected[size_key] or sha256(body) != expected[hash_key]:
        raise ValueError("Source length or SHA256 differs: " + str(expected.get("row", "file")))
    return body


def retain(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Existing destination has different bytes: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".partial", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            if path.read_bytes() != body:
                raise ValueError("Concurrent destination has different bytes: " + str(path))
            os.unlink(name)
        else:
            os.replace(name, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def tiff_tags(body):
    if body[:4] != b"II*\x00":
        raise ValueError("Expected the retained little-endian classic GeoTIFF")
    position = struct.unpack_from("<I", body, 4)[0]
    count = struct.unpack_from("<H", body, position)[0]
    tags = {}
    for index in range(count):
        at = position + 2 + index * 12
        tag, field_type, length, offset = struct.unpack_from("<HHII", body, at)
        format_code = {2: "B", 3: "H", 4: "I", 12: "d"}[field_type]
        item_size = struct.calcsize("<" + format_code)
        start = at + 8 if item_size * length <= 4 else offset
        tags[tag] = struct.unpack_from("<" + str(length) + format_code, body, start)
    if struct.unpack_from("<I", body, position + 2 + count * 12)[0] != 0:
        raise ValueError("Unexpected additional TIFF image directory")
    return tags


def receive(raster_path, output, package):
    specification = json.loads((package / "receiving.json").read_text("utf-8"))
    raster = checked(Path(raster_path).read_bytes(), specification["raster"])
    tags = tiff_tags(raster)
    if len(tags[273]) != len(specification["strips"]) or len(tags[279]) != len(specification["strips"]):
        raise ValueError("The complete retained TIFF strip inventory is required")
    counts = {}
    for row, expected in enumerate(specification["strips"]):
        start, length = tags[273][row], tags[279][row]
        source = checked(raster[start:start + length], expected)
        pixels = checked(zlib.decompress(source), expected, "pixel_bytes", "pixel_sha256")
        for code in set(pixels):
            if code not in specification["allowed_classes"]:
                raise ValueError("Unexpected source class: " + str(code))
            counts[str(code)] = counts.get(str(code), 0) + pixels.count(code)
    if counts != specification["class_counts"]:
        raise ValueError("Decoded TIFF class counts differ from the original source")
    checked(raster[:specification["header"]["bytes"]], specification["header"])
    width, height = specification["grid"]["window"]["width"], specification["grid"]["window"]["height"]
    if tags[256] != (width,) or tags[257] != (height,) or tags[258] != (8,) or tags[259] != (8,):
        raise ValueError("Native TIFF dimensions or encoding changed")
    if tags[278] != (1024,) or tags[273] != tuple(specification["raster"]["strip_offsets"]):
        raise ValueError("Native TIFF strip layout changed")
    transform = specification["grid"]["transform"]
    if tags[33550] != (transform[0], -transform[4], 0) or tags[33922] != (0, 0, 0, transform[2], transform[5], 0):
        raise ValueError("Native georeference changed")
    if tags[34735] != (1, 1, 0, 5, 1024, 0, 1, 1, 1025, 0, 1, 1, 2048, 0, 1, 4269,
                       3072, 0, 1, 5070, 3076, 0, 1, 9001):
        raise ValueError("Original projected CRS or pixel-area interpretation changed")
    output.mkdir(parents=True, exist_ok=True)
    for name in specification["companion_names"]:
        body = (package / "source" / name).read_bytes()
        expected = next(item for item in specification["source_entry"]["companions"] if item["path"] == name)
        checked(body, expected)
        retain(output / name, body)
    retain(output / "land-cover.tif", raster)
    for name in ("source-entry.json", "source-manifest.json"):
        retain(output / name, (package / "source" / name).read_bytes())
    return {
        "schema": "upstate.nlcd-native-receive-result/v1",
        "state": "complete", "source_id": specification["source_entry"]["id"],
        "raster": str((output / "land-cover.tif").resolve()),
        "manifest": str((output / "source-manifest.json").resolve()),
        "bytes": len(raster), "sha256": sha256(raster),
        "width": width, "height": height, "crs": "EPSG:5070",
        "transform": transform, "source_time": specification["source_time"],
        "cells": width * height, "nodata_cells": counts.get("250", 0),
        "class_counts": counts, "source_raster": str(Path(raster_path).resolve()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raster", type=Path,
                        help="Exact completed TIFF; defaults to the adjacent source/land-cover.tif")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    raster = args.raster or package / "source" / "land-cover.tif"
    result = receive(raster, args.output.resolve(), package)
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
