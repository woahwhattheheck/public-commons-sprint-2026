#!/usr/bin/env python3
"""Retain original NC ambient downloads and stream their unchanged CSV records."""
from __future__ import annotations

import argparse
import codecs
import csv
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile

CAPTURE_SCHEMA = "upstate.nc-ambient-original-capture/v1"
OUTPUT_SCHEMA = "upstate.nc-ambient-original-intake/v1"
TABLE_SCHEMA = "upstate.original-csv-records/v1"
EDITION = "nc-ambient-original-intake-20261013-v1"
CHUNK = 1024 * 1024


def digest_file(path):
    result = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for body in iter(lambda: source.read(CHUNK), b""):
            size += len(body)
            result.update(body)
    return {"bytes": size, "sha256": result.hexdigest()}


def relative_name(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or re.search(r"[\x00-\x1f\x7f]", value)):
        raise ValueError("Original filenames must be canonical relative paths")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in ("", ".", "..") or ":" in part for part in value.split("/"))):
        raise ValueError("Original filenames must stay inside the source directory")
    return path


def inside_file(root, name):
    relative = relative_name(name)
    candidate = root.joinpath(*relative.parts)
    resolved = candidate.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file():
        raise ValueError("Original source is not a contained regular file: " + name)
    return resolved


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2,
                  allow_nan=False)
        stream.write("\n")


def verify_identity(identity, expected, label):
    size = expected.get("expected_bytes", expected.get("bytes"))
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise ValueError("A nonnegative original byte count is required: " + label)
    if identity["bytes"] != size:
        raise ValueError("Original byte count differs: " + label)
    digest = expected.get("sha256")
    if digest is not None:
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise ValueError("Invalid declared SHA256: " + label)
        if identity["sha256"] != digest.lower():
            raise ValueError("Original SHA256 differs: " + label)


def copy_original(source, target):
    """Copy once; preserve the exact body and detect a source changed during read."""
    before = source.stat()
    target.parent.mkdir(parents=True, exist_ok=True)
    result = hashlib.sha256()
    size = 0
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        for body in iter(lambda: incoming.read(CHUNK), b""):
            outgoing.write(body)
            result.update(body)
            size += len(body)
    after = source.stat()
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns")
    if any(getattr(before, key) != getattr(after, key) for key in fields):
        raise ValueError("Original source changed while receiving: " + str(source))
    return {"bytes": size, "sha256": result.hexdigest()}


def parse_csv(source, target, source_binding, encoding):
    """Rows are arrays: repeated headers, empty cells and original text survive."""
    codecs.lookup(encoding)
    target.parent.mkdir(parents=True, exist_ok=True)
    rows = 0
    unequal_widths = 0
    with source.open("rb") as binary:
        bom = binary.read(3) == b"\xef\xbb\xbf"
        binary.seek(0)
        with io.TextIOWrapper(binary, encoding=encoding, newline="") as text:
            reader = csv.reader(text, dialect="excel", strict=True)
            try:
                columns = next(reader)
                header_lines = {"first": 1, "last": reader.line_num}
            except StopIteration:
                columns = []
                header_lines = None
            previous_line = reader.line_num
            header = {
                "schema": TABLE_SCHEMA, "edition": EDITION,
                "source": source_binding,
                "encoding": encoding, "utf8_bom_present": bom,
                "dialect": {"delimiter": ",", "quotechar": '"', "doublequote": True},
                "columns": columns, "header_physical_lines": header_lines,
                "cell_basis": "Decoded CSV cell strings without numeric, date, identifier, species or missing-value normalization. Column order and duplicate names are retained.",
            }
            with target.open("x", encoding="utf-8", newline="\n") as output:
                start = json.dumps(header, ensure_ascii=False, sort_keys=True,
                                   allow_nan=False)
                output.write(start[:-1] + ', "rows": [\n')
                for values in reader:
                    row = {
                        "record_index": rows,
                        "source_pointer": "/rows/" + str(rows),
                        "physical_lines": {"first": previous_line + 1,
                                           "last": reader.line_num},
                        "values": values,
                    }
                    if rows:
                        output.write(",\n")
                    json.dump(row, output, ensure_ascii=False, allow_nan=False)
                    previous_line = reader.line_num
                    rows += 1
                    unequal_widths += len(values) != len(columns)
                output.write('\n], "row_count": ' + str(rows)
                             + ', "rows_with_different_column_count": '
                             + str(unequal_widths) + "}\n")
    return {"row_count": rows, "column_count": len(columns),
            "columns": columns, "rows_with_different_column_count": unequal_widths,
            "encoding": encoding, "utf8_bom_present": bom, **digest_file(target)}


def publish_directory(staging, output):
    """Publish a complete directory atomically without replacing an existing one."""
    if sys.platform.startswith("linux"):
        library = ctypes.CDLL(None, use_errno=True)
        rename = getattr(library, "renameat2", None)
        if rename is None:
            raise RuntimeError("This Linux runtime needs renameat2 for atomic create-only publication")
        rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                           ctypes.c_char_p, ctypes.c_uint)
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(staging), -100, os.fsencode(output), 1) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), str(output))
    elif os.name == "nt":
        os.rename(staging, output)  # Windows refuses an existing destination.
    else:
        raise RuntimeError("Use the existing Linux receiving host for atomic create-only publication")


def receive(source_root, capture_path, output, default_encoding):
    source_root = source_root.resolve(strict=True)
    if not source_root.is_dir():
        raise ValueError("Source directory is not a directory")
    capture_path = capture_path.resolve(strict=True)
    capture_bytes = capture_path.read_bytes()
    capture = json.loads(capture_bytes.decode("utf-8-sig"))
    if not isinstance(capture, dict) or capture.get("schema") != CAPTURE_SCHEMA:
        raise ValueError("Use the original NC ambient capture manifest")
    entries = capture.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError("The original capture needs its complete entries")
    output = output.absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    output = output.parent.resolve(strict=True) / output.name
    if output.exists() or output.is_symlink():
        raise FileExistsError("Choose a new original-source output directory: " + str(output))
    if output == source_root or source_root in output.parents or output in source_root.parents:
        raise ValueError("Keep source and received output directories separate")
    seen_ids, seen_paths = set(), set()
    prepared = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Every capture entry must be an object")
        identifier = entry.get("id")
        if (not isinstance(identifier, str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", identifier)
                or identifier in seen_ids):
            raise ValueError("Original source IDs must be unique path-safe identifiers")
        filename = relative_name(entry.get("filename")).as_posix()
        if filename in seen_paths:
            raise ValueError("Each capture entry must name a distinct original file")
        if not isinstance(entry.get("profile"), str) or not isinstance(entry.get("site"), str):
            raise ValueError("Retain each original profile and site string")
        encoding = entry.get("encoding", default_encoding)
        if not isinstance(encoding, str):
            raise ValueError("Declared CSV encoding must be text")
        codecs.lookup(encoding)
        source = inside_file(source_root, filename)
        verify_identity({"bytes": source.stat().st_size,
                         "sha256": entry.get("sha256", "not-yet-hashed")},
                        {"expected_bytes": entry.get("expected_bytes")}, identifier)
        seen_ids.add(identifier)
        seen_paths.add(filename)
        prepared.append((entry, source, encoding))
    staging = Path(tempfile.mkdtemp(prefix="." + output.name + ".receiving-",
                                    dir=output.parent))
    try:
        capture_target = staging / "capture.json"
        with capture_target.open("xb") as handle:
            handle.write(capture_bytes)
        inventory = {
            "schema": OUTPUT_SCHEMA, "edition": EDITION,
            "receiver": {"python": sys.version, "source_sha256": digest_file(Path(__file__))["sha256"]},
            "source_directory": str(source_root),
            "capture": {"path": "capture.json", "bytes": len(capture_bytes),
                        "sha256": hashlib.sha256(capture_bytes).hexdigest()},
            "interpretation": "Original source intake only. Modern WQX3 profiles and legacy WQX2.2 limits remain separate. Every CSV field remains text; no scientific or cross-profile join is inferred.",
            "entries": [],
        }
        for entry, source, encoding in prepared:
            identifier = entry["id"]
            root = Path("originals") / identifier
            original_path = root / relative_name(entry["filename"])
            original = staging / original_path
            identity = copy_original(source, original)
            verify_identity(identity, entry, identifier)
            record = {"capture_entry": entry,
                      "original": {"path": original_path.as_posix(), **identity},
                      "members": [], "tables": []}
            def table_for(body, binding, table_number):
                table_path = Path("profiles") / identifier / ("%04d.json" % table_number)
                description = parse_csv(body, staging / table_path, binding, encoding)
                record["tables"].append({"path": table_path.as_posix(),
                                         "source": binding, **description})
            binding = {
                "entry_id": identifier, "profile": entry["profile"], "site": entry["site"],
                "public_uri": entry.get("public_uri"),
                "original_path": original_path.as_posix(), **identity,
            }
            zipped = zipfile.is_zipfile(original)
            declared_zip = "zip" in str(entry.get("source_format", "")).lower() or "zip" in str(entry.get("content_type", "")).lower() or source.suffix.lower() == ".zip"
            if declared_zip and not zipped:
                raise ValueError("Declared original ZIP is not a readable ZIP: " + identifier)
            if zipped:
                record["container"] = "zip"
                with zipfile.ZipFile(original) as archive:
                    used = set()
                    for index, info in enumerate(archive.infolist()):
                        name = info.filename
                        relative = relative_name(name.rstrip("/") if info.is_dir() else name)
                        if info.is_dir():
                            record["members"].append({"index": index, "name": name,
                                                      "kind": "directory"})
                            continue
                        if relative.as_posix() in used:
                            raise ValueError("Original ZIP has duplicate member paths: " + name)
                        used.add(relative.as_posix())
                        mode = (info.external_attr >> 16) & 0xFFFF
                        if mode and stat.S_ISLNK(mode):
                            raise ValueError("Original ZIP symlinks are not CSV source members")
                        if info.flag_bits & 1:
                            raise ValueError("Original ZIP member is encrypted: " + name)
                        member_path = root / "members" / relative
                        target = staging / member_path
                        target.parent.mkdir(parents=True, exist_ok=True)
                        h, size = hashlib.sha256(), 0
                        with archive.open(info) as incoming, target.open("xb") as outgoing:
                            for body in iter(lambda: incoming.read(CHUNK), b""):
                                outgoing.write(body)
                                h.update(body)
                                size += len(body)
                        if size != info.file_size:
                            raise ValueError("Original ZIP member size differs: " + name)
                        member = {"index": index, "name": name, "kind": "file",
                                  "path": member_path.as_posix(), "bytes": size,
                                  "sha256": h.hexdigest(), "zip_crc32": "%08x" % info.CRC,
                                  "compressed_bytes": info.compress_size,
                                  "compression_method": info.compress_type}
                        record["members"].append(member)
                        if relative.suffix.lower() == ".csv":
                            table_for(target, {**binding, "zip_member": member}, len(record["tables"]))
                if not record["tables"]:
                    raise ValueError("Original ZIP has no CSV members: " + identifier)
            else:
                record["container"] = "file"
                if source.suffix.lower() != ".csv":
                    raise ValueError("Expected an original CSV or ZIP capture: " + identifier)
                table_for(original, binding, 0)
            inventory["entries"].append(record)
        inventory["source_file_count"] = len(inventory["entries"])
        inventory["original_bytes"] = sum(row["original"]["bytes"] for row in inventory["entries"])
        inventory["table_count"] = sum(len(row["tables"]) for row in inventory["entries"])
        inventory["row_count"] = sum(t["row_count"] for row in inventory["entries"] for t in row["tables"])
        write_json(staging / "inventory.json", inventory)
        publish_directory(staging, output)
        return {"schema": OUTPUT_SCHEMA, "state": "complete", "output": str(output),
                "inventory": str(output / "inventory.json"),
                **{key: inventory[key] for key in
                   ("source_file_count", "original_bytes", "table_count", "row_count")}}
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--encoding", default="utf-8-sig",
                        help="Declared CSV text codec; original bytes are always retained")
    args = parser.parse_args(argv)
    csv.field_size_limit(sys.maxsize)
    result = receive(args.source_directory, args.capture, args.output, args.encoding)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
