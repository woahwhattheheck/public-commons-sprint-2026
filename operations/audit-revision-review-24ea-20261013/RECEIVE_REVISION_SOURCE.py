#!/usr/bin/env python3
"""Materialize the complete immutable following Audit source; no workspace operation."""
import argparse, fcntl, hashlib, json, os, stat, tempfile
from pathlib import Path, PurePosixPath

BYTES = 3242472
SHA256 = "5b5bea5df81ca590ae2104b71620b5d0fac3a5ced87d51254ad5609e666fdd5c"
SOURCE_COMMIT = "8f9de99a4afc2176c6044d8dc97505ffab52d6ce"
OPERATION = "AUDIT-EXCHANGE-NATIVE-6804-20261012"

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def original(path, raw):
    if path.is_symlink():
        raise ValueError("A selected source path is a symbolic link: " + str(path))
    if path.exists():
        if not path.is_file() or path.read_bytes() != raw:
            raise ValueError("Preserve the different existing source: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".pending", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or path.read_bytes() != raw:
                raise ValueError("The concurrently published source differs: " + str(path))
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        temporary.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, type=Path)
    parser.add_argument("--application", required=True, type=Path)
    args = parser.parse_args()
    source = args.packet.expanduser().absolute()
    if source.is_symlink() or not source.is_file():
        raise ValueError("Use the original regular source packet.")
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        raw = stream.read(BYTES + 1)
        after = os.fstat(stream.fileno())
    if not stat.S_ISREG(before.st_mode) or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError("The source packet changed during receiving.")
    if len(raw) != BYTES or digest(raw) != SHA256:
        raise ValueError("The complete selected source packet differs.")
    packet = json.loads(raw)
    if packet["schema"] != "commons.source-bundle.v1" or packet["operation"] != OPERATION or packet["sourceCommit"] != SOURCE_COMMIT:
        raise ValueError("The original source selection differs.")
    rows, names = [], set()
    for row in packet["files"]:
        name = row["path"]
        relative = PurePosixPath(name)
        if not isinstance(name, str) or not name or "\\" in name or relative.is_absolute() or any(p in ("", ".", "..") for p in name.split("/")) or name in names:
            raise ValueError("Invalid or duplicate selected source path.")
        content = row["content"].encode("utf-8")
        git = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        if git != row["gitBlobSha1"]:
            raise ValueError("An original source body differs: " + name)
        names.add(name)
        rows.append((name, content, {"path": name, "bytes": len(content), "sha256": digest(content), "gitBlobSha1": git}))
    inventory = next(content for name, content, _ in rows if name == "SOURCE_FILES.json")
    declared = json.loads(inventory)["files"]
    if len(rows) != 82 or len(declared) != len(set(declared)) or set(declared) != names:
        raise ValueError("Keep the complete original 82-file application.")
    application = args.application.expanduser().absolute()
    if application.resolve() != application:
        raise ValueError("Select an explicit application directory without symbolic-link ancestors.")
    application.parent.mkdir(parents=True, exist_ok=True)
    journal = application.parent / (application.name + ".source-receiving")
    if journal.is_symlink():
        raise ValueError("The source journal is a symbolic link.")
    journal.mkdir(exist_ok=True, mode=0o700)
    guard = os.open(journal / "operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        application.mkdir(exist_ok=True, mode=0o700)
        selection = {"schema": "commons.audit-exchange.complete-source-receiving.v1",
            "operation": OPERATION, "application": str(application), "sourceCommit": SOURCE_COMMIT,
            "packet": {"bytes": BYTES, "sha256": SHA256}, "files": [row for _, _, row in rows]}
        selected = (json.dumps(selection, sort_keys=True, indent=2) + "\n").encode()
        selection_path = journal / "SELECTION.json"
        if any(application.iterdir()) and (selection_path.is_symlink() or not selection_path.is_file() or selection_path.read_bytes() != selected):
            raise ValueError("Use an empty separate application directory, or resume this exact owned source selection.")
        original(selection_path, selected)
        for name, content, _ in rows:
            path = application
            for part in PurePosixPath(name).parts[:-1]:
                path = path / part
                if path.is_symlink():
                    raise ValueError("A source parent is a symbolic link.")
                path.mkdir(exist_ok=True, mode=0o700)
            original(application / name, content)
        for name, content, _ in rows:
            path = application / name
            if path.is_symlink() or not path.is_file() or path.read_bytes() != content:
                raise ValueError("The materialized source differs: " + name)
        original(journal / "COMPLETE.json", selected)
        print(json.dumps({"status": "complete", "operation": OPERATION, "application": str(application),
            "sourceCommit": SOURCE_COMMIT, "files": len(rows), "receipt": str(journal / "COMPLETE.json")}), flush=True)
    finally:
        os.close(guard)

if __name__ == "__main__":
    main()
