"""Package the complete batched portfolio and its original public donor bank."""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import stat
import tempfile
import zipfile

from warmstart import _read_bank


def inspect_archive(path: Path, payloads: dict) -> dict:
    """Reuse only a complete original archive with the exact selected members."""
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Use an original regular candidate archive")
        if before.st_size > sum(map(len, payloads.values())) + 1024 * 1024:
            raise ValueError("Existing candidate archive exceeds its complete source allowance")
        with zipfile.ZipFile(stream, "r") as archive:
            members = archive.infolist()
            if (len(members) != len(payloads) or
                    {item.filename for item in members} != set(payloads)):
                raise ValueError("Existing archive has different original members")
            for item in members:
                expected = payloads[item.filename]
                mode = item.external_attr >> 16
                if (item.is_dir() or item.flag_bits & 1 or
                        stat.S_ISLNK(mode) or item.file_size != len(expected) or
                        archive.read(item) != expected):
                    raise ValueError("Existing archive contains a different source: " + item.filename)
        stream.seek(0)
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
        selected = path.lstat()
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or
                (selected.st_dev, selected.st_ino) != (before.st_dev, before.st_ino) or
                not stat.S_ISREG(selected.st_mode)):
            raise ValueError("Candidate archive changed during original receiving")
        return {"bytes": after.st_size, "sha256": digest.hexdigest()}


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish_archive(target: Path, payloads: dict) -> dict:
    """Publish a completed file exclusively; interrupted copies have no final name."""
    try:
        existing = inspect_archive(target, payloads)
    except FileNotFoundError:
        pass
    else:
        sync_directory(target.parent)
        return {**existing, "reused": True}
    reused = False
    # Only this invocation owns this private directory and its unpublished file.
    with tempfile.TemporaryDirectory(prefix=".candidate-package-", dir=target.parent) as directory:
        temporary = Path(directory) / "candidate.zip"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=9) as archive:
                for name, content in payloads.items():
                    info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, content)
            stream.flush()
            os.fsync(stream.fileno())
        inspect_archive(temporary, payloads)
        try:
            os.link(temporary, target)
        except FileExistsError:
            reused = True
        result = inspect_archive(target, payloads)
        sync_directory(target.parent)
    sync_directory(target.parent)
    return {**result, "reused": reused}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--bank", type=Path, default=Path(__file__).with_name("warmstart_bank.npz"))
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    raw_bank = args.bank.read_bytes()
    if (len(raw_bank) != 2170687 or hashlib.sha256(raw_bank).hexdigest() !=
            "609a69e08ef1c9ec3460e3f012e7f1b52bb6a29c232c198a63415409d2ab7d39"):
        raise ValueError("Use the original compiled public-corpus donor bank")
    # Validate and package this same retained bank, without a second path read.
    bank = _read_bank(BytesIO(raw_bank))
    members = {
        "submission.py": source / "submission.py",
        "batched_update.py": source / "batched_update.py",
        "elite_archive.py": source / "elite_archive.py",
        "warmstart.py": source / "warmstart.py",
        "requirements.txt": source / "requirements.txt",
        "THIRD_PARTY_LICENSE.txt": source.parent / "official" / "LICENSE",
    }
    payloads = {name: path.read_bytes() for name, path in members.items()}
    payloads["warmstart_bank.npz"] = raw_bank
    target = args.output.expanduser().absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    receipt = publish_archive(target, payloads)
    print(json.dumps({
        "archive": str(target), **receipt,
        "source_dataset_sha256": bank["metadata"]["source"]["sha256"],
        "members": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                    for name, content in payloads.items()},
    }, indent=2))


if __name__ == "__main__":
    main()
