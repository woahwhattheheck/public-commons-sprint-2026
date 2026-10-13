#!/usr/bin/env python3
"""Materialize the completed original Annual NLCD2025 native regional GeoTIFF.

The input files are full Page Markdown or JSON tool responses from the exact
source volume URLs listed in receiving.json. This uses only Python's stdlib.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import zlib

PART_SCHEMA = "upstate.nlcd-native-raster-strip-part/v1"


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def checked(body, expected, size_key="bytes", hash_key="sha256"):
    if len(body) != expected[size_key] or sha256(body) != expected[hash_key]:
        raise ValueError("Source length or SHA256 differs: " + str(expected.get("row", "file")))
    return body


def records(value):
    if isinstance(value, dict):
        if value.get("schema") == PART_SCHEMA:
            yield value
        else:
            for child in value.values():
                yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)
    elif isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                nested = json.loads(stripped)
            except ValueError:
                nested = None
            if isinstance(nested, (dict, list)):
                yield from records(nested)
                return
        for match in re.finditer(r"```json\s*([\s\S]*?)```", value):
            yield from records(json.loads(match.group(1)))


def source_files(paths):
    found = set()
    for value in paths:
        path = Path(value)
        members = path.rglob("*") if path.is_dir() else [path]
        for member in members:
            if member.is_file() and member.suffix.lower() in {".md", ".json", ".txt"}:
                identity = member.resolve()
                if identity not in found:
                    found.add(identity)
                    yield identity


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


def receive(paths, output, package):
    specification = json.loads((package / "receiving.json").read_text("utf-8"))
    parts = {}
    used_paths = []
    for path in source_files(paths):
        body = path.read_text("utf-8-sig")
        any_parts = False
        for record in records(body):
            key = (int(record["row"]), int(record["part"]))
            previous = parts.get(key)
            if previous is not None and previous != record:
                raise ValueError("Conflicting source part: " + str(key))
            parts[key] = record
            any_parts = True
        if any_parts:
            used_paths.append(str(path))
    compressed = []
    counts = {}
    for row, expected in enumerate(specification["strips"]):
        chosen = []
        for part in range(1, expected["parts"] + 1):
            record = parts.get((row, part))
            if record is None or record["parts"] != expected["parts"]:
                raise ValueError("Missing complete source strip part " + str((row, part)))
            chosen.append(record["base64"])
        source = checked(base64.b64decode("".join(chosen), validate=True), expected)
        pixels = checked(zlib.decompress(source), expected, "pixel_bytes", "pixel_sha256")
        for code in set(pixels):
            if code not in specification["allowed_classes"]:
                raise ValueError("Unexpected source class: " + str(code))
            counts[str(code)] = counts.get(str(code), 0) + pixels.count(code)
        compressed.append(source)
    if counts != specification["class_counts"]:
        raise ValueError("Native source class counts changed")
    header = checked(base64.b64decode(specification["header"]["base64"], validate=True),
                     specification["header"])
    raster = checked(header + b"".join(compressed), specification["raster"])
    tags = tiff_tags(raster)
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
        "class_counts": counts, "source_pages": used_paths,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parts", nargs="+", required=True,
                        help="The retained eighteen full source-volume Page responses or their directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = receive(args.parts, args.output.resolve(), Path(__file__).resolve().parent)
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
