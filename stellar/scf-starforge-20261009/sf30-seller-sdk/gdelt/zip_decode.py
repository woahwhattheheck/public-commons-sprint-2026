"""MIT. Decode one GDELT archive with Python's standard ZIP/CRC implementation."""
from __future__ import annotations
import base64
import binascii
import hashlib
import io
import json
import re
import stat
import sys
import zipfile

MAX_ZIP = 24 * 1024 * 1024
MAX_TABLE = 64 * 1024 * 1024


def decode(value):
    if not isinstance(value, dict) or set(value) != {"member", "zip_base64"}:
        raise ValueError("Select one original GDELT ZIP and its expected member")
    member = value["member"]
    if not isinstance(member, str) or not re.fullmatch(r"\d{14}\.(?:(?:export|mentions)\.CSV|gkg\.csv)", member):
        raise ValueError("The selected GDELT member is not an Events, Mentions or GKG table")
    encoded = value["zip_base64"]
    if not isinstance(encoded, str) or len(encoded) > ((MAX_ZIP + 2) // 3) * 4:
        raise ValueError("GDELT ZIP exceeds 24 MiB")
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > MAX_ZIP or base64.b64encode(raw).decode("ascii") != encoded:
        raise ValueError("GDELT archive encoding is not canonical")
    with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].filename != member:
            raise ValueError("GDELT ZIP must contain exactly its advertised flat table")
        item = members[0]
        mode = item.external_attr >> 16
        if (item.is_dir() or item.flag_bits & 1
                or item.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                or stat.S_IFMT(mode) not in {0, stat.S_IFREG}
                or not 0 <= item.file_size <= MAX_TABLE):
            raise ValueError("Unsupported GDELT ZIP member")
        chunks, size, digest = [], 0, hashlib.sha256()
        with archive.open(item, "r") as stream:
            while chunk := stream.read(262144):
                size += len(chunk)
                if size > MAX_TABLE:
                    raise ValueError("GDELT table exceeds 64 MiB")
                digest.update(chunk)
                chunks.append(chunk)
        if size != item.file_size:
            raise ValueError("GDELT table length changed")
    table = b"".join(chunks).decode("utf-8", errors="strict")
    return {"member": member, "bytes": size, "sha256": digest.hexdigest(),
            "crc32": format(item.CRC, "08x"), "text": table}


def main():
    raw = sys.stdin.buffer.read(((MAX_ZIP + 2) // 3) * 4 + 4097)
    if len(raw) > ((MAX_ZIP + 2) // 3) * 4 + 4096:
        raise ValueError("GDELT archive request exceeds its capacity")
    value = json.loads(raw)
    json.dump(decode(value), sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, OSError, zipfile.BadZipFile, RuntimeError, binascii.Error) as error:
        print(json.dumps({"code": "GDELT_ARCHIVE_INVALID", "message": str(error)}), file=sys.stderr)
        raise SystemExit(2)
