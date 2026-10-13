#!/usr/bin/env python3
"""Build one complete lossless questionnaire delivery ZIP."""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from reassemble_customer_project import BLOCK, SCHEMA, file_identity, publish_bytes, stream_identity, verify_complete


def entry(name, compressed=True):
    item = zipfile.ZipInfo(name, date_time=(2026, 10, 13, 0, 0, 0))
    item.create_system = 3
    item.external_attr = 0o100600 << 16
    item.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
    return item


def guide(index):
    encoding = ("The complete project is a member-preserving reencoding of the native exported\n"
                "archive: every original member path, file body and manifest stays exact. Its ZIP\n"
                "envelope has a new checksum, recorded separately from the original export in\n"
                "`TRANSPORT_MANIFEST.json`.\n") if index["memberPreservingReencoding"] else (
                "The recreated project ZIP retains the exact original exported bytes and checksum.\n"
                "Allow space for the complete ZIP and the extracted editable project.\n")
    opening_bytes = index.get("openingSpaceBytes", index["customerZip"]["bytes"] * 2)
    opening_gib = max(1, (opening_bytes + 1024**3 - 1) // 1024**3)
    return f"""# Open the complete questionnaire project

This download carries the entire saved customer project. Extract this delivery
ZIP into a new private folder, then run the following from that folder:

```sh
umask 077
python3 reassemble_customer_project.py
python3 -m zipfile -e {index['customerZip']['name']} customer-project
```

Python 3.11 or newer with its standard `lzma` module is required. Reassembly uses
about 200 MB of memory. It recreates the complete {index['customerZip']['bytes']:,}-byte
project ZIP and its SHA256 sidecar, checks the exact compressed and complete
identities, and verifies all {index['members']:,} project members. Repeating the
command checks the existing complete ZIP; a different existing file is preserved.

{encoding}

Allow at least {opening_gib:,} GiB of free space for the complete delivery,
recreated ZIP and extracted editable project. Their saved sizes total
{opening_bytes:,} bytes before filesystem overhead and further customer edits.

Open `customer-project/START_HERE.md` for the original first opening, offline
document runtime installation, operator login, English/French completion,
native workbook calculations, reports, communications, backup and restoration.
Keep the complete ZIP and its `.sha256` sidecar one directory above
`customer-project` for that guide's restore commands. The original project
contains its full application, database, private invitations, original
workbooks, source catalogue, complete calculation outputs, operating history,
reports and offline document/calculation dependencies.

The packaged `HANDOVER.json`, `MANIFEST.json` and retained source index identify
the exact saved edition. Keep this delivery separate from its editable opened
project. After editing, use the original full-project export to make another
complete customer handover.
""".encode()


def same_members(original_path, received_path):
    with zipfile.ZipFile(original_path) as original, zipfile.ZipFile(received_path) as received:
        if original.namelist() != received.namelist():
            raise ValueError("The reencoded complete project member inventory differs.")
        for name in original.namelist():
            with original.open(name) as a, received.open(name) as b:
                if stream_identity(a) != stream_identity(b):
                    raise ValueError("A reencoded complete project member differs: " + name)


class IdentityWriter:
    """Record the complete forward-only ZIP identity while XZ owns its output."""

    def __init__(self, writer):
        self.writer = writer
        self.sha256 = hashlib.sha256()
        self.bytes = 0

    def write(self, raw):
        written = self.writer.write(raw)
        if written != len(raw):
            raise IOError("The complete compressed project write was truncated.")
        self.sha256.update(raw)
        self.bytes += written
        return written

    def tell(self):
        return self.bytes

    def seek(self, *_):
        raise io.UnsupportedOperation("The complete ZIP is written as one forward stream.")

    def flush(self):
        self.writer.flush()

    def identity(self):
        return {"bytes": self.bytes, "sha256": self.sha256.hexdigest()}


def stream_stored_project(source, packed):
    """Write all original members directly into one complete ZIP/XZ stream.

    Python's ZIP writer supports unseekable output; its standard ZIP64 data
    descriptors and final central directory preserve every original member.
    https://docs.python.org/3/library/zipfile.html#zipfile.ZipFile
    """
    with zipfile.ZipFile(source) as original, lzma.LZMAFile(packed, "wb",
            format=lzma.FORMAT_XZ,
            filters=[{"id": lzma.FILTER_LZMA2, "preset": 6,
                      "dict_size": 128 * 1024 * 1024}]) as compressor:
        tracker = IdentityWriter(compressor)
        with zipfile.ZipFile(tracker, "w", compression=zipfile.ZIP_STORED,
                allowZip64=True) as outgoing:
            for item in original.infolist():
                selected = copy.copy(item)
                selected.compress_type = zipfile.ZIP_STORED
                with original.open(item) as incoming, outgoing.open(selected, "w",
                        force_zip64=True) as writer:
                    shutil.copyfileobj(incoming, writer, BLOCK)
        return tracker.identity()


def packed_project_identity(packed):
    """Apply the original receiver's single-XZ-stream contract without a copy."""
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ,
            memlimit=512 * 1024 * 1024)
    fingerprint, size = hashlib.sha256(), 0
    with Path(packed).open("rb") as incoming:
        for block in iter(lambda: incoming.read(BLOCK), b""):
            if decoder.eof:
                raise ValueError("The complete compressed delivery contains trailing data.")
            current = block
            while True:
                decoded = decoder.decompress(current, max_length=BLOCK)
                current = b""
                fingerprint.update(decoded)
                size += len(decoded)
                if decoder.eof or decoder.needs_input:
                    break
            if decoder.unused_data:
                raise ValueError("The complete compressed delivery contains trailing data.")
    if not decoder.eof:
        raise ValueError("The complete compressed delivery ended before its XZ footer.")
    return {"bytes": size, "sha256": fingerprint.hexdigest()}


def build(archive_path, output, compressed_path=None, solid=False):
    source = Path(archive_path).resolve(strict=True)
    output = Path(output).absolute()
    if output.exists():
        raise ValueError("Choose a new complete delivery directory.")
    original_identity = file_identity(source)
    with zipfile.ZipFile(source) as original:
        members = len(original.namelist())
        extracted_bytes = sum(item.file_size for item in original.infolist())
        source_index = json.loads(original.read("workspace/source-evidence/final-source.json"))
        license_body = original.read("application/LICENSE")
    workspace_id = verify_complete(source, original_identity, members)
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = Path(tempfile.mkdtemp(prefix=".atssc-transport-", dir=output.parent))
    try:
        packed = pending / "complete-customer.zip.xz"
        if compressed_path:
            shutil.copyfile(Path(compressed_path).resolve(strict=True), packed)
            if solid:
                expected = packed_project_identity(packed)
            else:
                expected = original_identity
        elif solid:
            expected = stream_stored_project(source, packed)
        else:
            expected = original_identity
            with lzma.LZMAFile(packed, "wb", format=lzma.FORMAT_XZ,
                    filters=[{"id": lzma.FILTER_LZMA2, "preset": 6, "dict_size": 128 * 1024 * 1024}]) as writer:
                with source.open("rb") as reader:
                    shutil.copyfileobj(reader, writer, BLOCK)
        if packed_project_identity(packed) != expected:
            raise ValueError("The compressed input must recreate the entire original project.")
        if solid:
            with lzma.LZMAFile(packed, "rb") as reader:
                same_members(source, reader)
        packed_identity = file_identity(packed)
        if packed_identity["bytes"] >= 48 * 1024 * 1024:
            raise ValueError("The complete compressed project exceeds this single-file delivery capacity.")
        reassembler = Path(__file__).with_name("reassemble_customer_project.py")
        index = {"schema": SCHEMA, "customerZip": {"name": source.name, **expected},
                 "compressed": {"name": packed.name, **packed_identity}, "members": members,
                 "workspace_id": workspace_id, "project_source": source_index,
                 "originalExport": {"name": source.name, **original_identity},
                 "memberPreservingReencoding": solid,
                 "openingSpaceBytes": expected["bytes"] + extracted_bytes + 2 * packed_identity["bytes"],
                 "streamedReencoding": solid and not compressed_path,
                 "reassembler": file_identity(reassembler)}
        contents = {"TRANSPORT_MANIFEST.json": (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode(),
                    "START_HERE.md": guide(index), "reassemble_customer_project.py": reassembler.read_bytes(),
                    "LICENSE": license_body}
        target = pending / source.name
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as outgoing:
            for name, raw in contents.items():
                outgoing.writestr(entry(name), raw)
            with packed.open("rb") as incoming, outgoing.open(entry(packed.name, False), "w", force_zip64=True) as destination:
                shutil.copyfileobj(incoming, destination, BLOCK)
        if target.stat().st_size >= 48 * 1024 * 1024:
            raise ValueError("The complete delivery ZIP exceeds this single-file capacity.")
        with zipfile.ZipFile(target) as retained:
            if set(retained.namelist()) != set(contents) | {packed.name}:
                raise ValueError("The complete delivery inventory differs.")
            for name, raw in contents.items():
                if retained.read(name) != raw:
                    raise ValueError("A complete opening file changed.")
            with retained.open(packed.name) as stream:
                if stream_identity(stream) != packed_identity:
                    raise ValueError("The complete compressed delivery changed.")
        for name, raw in contents.items():
            publish_bytes(pending / name, raw)
        result = {"schema": "atssc.complete-customer-transport.v1", "status": "COMPLETE",
                  "customer_zip": index["customerZip"], "compressed": index["compressed"],
                  "original_export": index["originalExport"], "member_preserving_reencoding": solid,
                  "members": members, "delivery": {"name": source.name, **file_identity(target)}}
        publish_bytes(pending / "TRANSPORT_RESULT.json", (json.dumps(result, indent=2) + "\n").encode())
        if output.exists():
            raise ValueError("An existing output directory is preserved.")
        os.rename(pending, output)
        return {**result, "path": str(output / source.name)}
    finally:
        if pending.exists():
            shutil.rmtree(pending)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--compressed")
    parser.add_argument("--solid", action="store_true", help="Preserve every complete project member and manifest while reencoding its ZIP envelope for solid compression")
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(build(args.archive, args.output, args.compressed, args.solid)), flush=True)


if __name__ == "__main__":
    main()
