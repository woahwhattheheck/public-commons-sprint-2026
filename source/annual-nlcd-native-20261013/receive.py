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


def tile_rows(plan, specification):
    """Require complete native tile coverage, independent of declared hashes."""
    grid = specification["grid"]
    if plan["grid"] != grid or plan["time"] != specification["source_time"]:
        raise ValueError("Original tile plan differs from the selected native grid or time")
    width, height = grid["window"]["width"], grid["window"]["height"]
    size = grid["tile_size"]
    if (type(width) is not int or type(height) is not int or min(width, height) < 1
            or size != 1024):
        raise ValueError("Invalid original native raster dimensions")
    tiles = sorted(plan["tiles"], key=lambda item: (item["row"], item["col"]))
    expected_count = ((width + size - 1) // size) * ((height + size - 1) // size)
    if len(tiles) != expected_count or len(tiles) != grid["tiles"]:
        raise ValueError("The original tile plan does not cover its complete grid")
    allowed = set(specification["allowed_classes"]) - {250}
    groups, identities, counts, index = [], set(), {}, 0
    for row in range(0, height, size):
        group = []
        tile_height = min(size, height - row)
        for col in range(0, width, size):
            tile = tiles[index]
            index += 1
            tile_width = min(size, width - col)
            cells = tile_width * tile_height
            if (type(tile["tile"]) is not int or tile["tile"] in identities
                    or tile["row"] != row or tile["col"] != col
                    or tile["width"] != tile_width or tile["height"] != tile_height
                    or tile["native_column"] != grid["window"]["col"] + col
                    or tile["native_row"] != grid["window"]["row"] + row):
                raise ValueError("An original tile has duplicate, missing or different native support")
            identities.add(tile["tile"])
            if (tile["pixel_bytes"] != cells or type(tile["png_bytes"]) is not int
                    or tile["png_bytes"] <= 0):
                raise ValueError("An original tile has an empty or incomplete declared payload")
            for name in ("png_sha256", "pixel_sha256"):
                value = tile[name]
                if (not isinstance(value, str) or len(value) != 64
                        or any(char not in "0123456789abcdef" for char in value)):
                    raise ValueError("An original tile is missing its source or decoded hash")
            total = 0
            for key, count in tile["class_counts"].items():
                if str(int(key)) != key or int(key) not in allowed or type(count) is not int or count <= 0:
                    raise ValueError("The original tile class inventory is invalid")
                counts[key] = counts.get(key, 0) + count
                total += count
            nodata = tile["nodata_cells"]
            if type(nodata) is not int or nodata < 0 or total + nodata != cells:
                raise ValueError("The original tile class inventory does not fill every cell")
            if nodata:
                counts["250"] = counts.get("250", 0) + nodata
            group.append(tile)
        groups.append(group)
    if counts != plan["class_counts"] or counts != specification["class_counts"]:
        raise ValueError("Original tile totals differ from the complete native source")
    if sum(counts.values()) != width * height:
        raise ValueError("The original tiles leave missing raster cells")
    return groups


def receive(raster_path, output, package):
    specification = json.loads((package / "receiving.json").read_text("utf-8"))
    companions = {}
    for name in specification["companion_names"]:
        body = (package / "source" / name).read_bytes()
        expected = next(item for item in specification["source_entry"]["companions"] if item["path"] == name)
        companions[name] = checked(body, expected)
    groups = tile_rows(json.loads(companions["plan.json"]), specification)
    width, height = specification["grid"]["window"]["width"], specification["grid"]["window"]["height"]
    raster = checked(Path(raster_path).read_bytes(), specification["raster"])
    tags = tiff_tags(raster)
    if len(tags[273]) != len(specification["strips"]) or len(tags[279]) != len(specification["strips"]):
        raise ValueError("The complete retained TIFF strip inventory is required")
    counts = {}
    for row, expected in enumerate(specification["strips"]):
        start, length = tags[273][row], tags[279][row]
        source = checked(raster[start:start + length], expected)
        pixels = checked(zlib.decompress(source), expected, "pixel_bytes", "pixel_sha256")
        strip_height = min(1024, height - row * 1024)
        if (expected["row"] != row or expected["height"] != strip_height
                or len(pixels) != width * strip_height):
            raise ValueError("Decoded strip does not cover its original native cells")
        for tile in groups[row]:
            col, tile_width = tile["col"], tile["width"]
            original_window = b"".join(
                pixels[y * width + col:y * width + col + tile_width]
                for y in range(strip_height))
            checked(original_window, tile, "pixel_bytes", "pixel_sha256")
        for code in set(pixels):
            if code not in specification["allowed_classes"]:
                raise ValueError("Unexpected source class: " + str(code))
            counts[str(code)] = counts.get(str(code), 0) + pixels.count(code)
    if counts != specification["class_counts"]:
        raise ValueError("Decoded TIFF class counts differ from the original source")
    checked(raster[:specification["header"]["bytes"]], specification["header"])
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
    for name, body in companions.items():
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
        "cells": width * height, "source_tiles_verified": sum(len(group) for group in groups),
        "original_pixel_cells": width * height, "nodata_cells": counts.get("250", 0),
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
