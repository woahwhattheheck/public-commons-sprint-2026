"""Complete ordinary-file and internal-link runtime archives."""
from __future__ import annotations
import gzip, hashlib, io, json, os, pathlib, posixpath, stat, tarfile, tempfile

SCHEMA = "hocuspocus.runtime.archive.v1"
MANIFEST = "RUNTIME_FILES.json"

def digest_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for body in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(body)
    return h.hexdigest()

def relative_name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("An ordinary relative path is required")
    if value.startswith("/") or any(x in ("", ".", "..") for x in value.split("/")):
        raise ValueError("The selected path leaves the package")
    return pathlib.PurePosixPath(value)

def link_target(relative, target):
    relative_name(relative)
    if not isinstance(target, str) or not target or "\\" in target or "\0" in target or target.startswith("/"):
        raise ValueError("A package link must remain relative")
    joined = posixpath.normpath(posixpath.join(posixpath.dirname(relative), target))
    if joined == ".." or joined.startswith("../") or joined.startswith("/"):
        raise ValueError("A package link leaves its original root")
    return joined

def ordinary_parents(root, relative):
    root = pathlib.Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("The receiving root must be an ordinary directory")
    parts = relative_name(relative).parts
    current = root
    for part in parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise ValueError("An archive member has a linked parent")
        if current.exists():
            if not current.is_dir():
                raise ValueError("An archive member has a non-directory parent")
        else:
            current.mkdir(mode=0o700)
    return root.joinpath(*parts)

def atomic_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ValueError("A runtime record cannot replace a link")
    body = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def inventory(root, exclude_root=()):
    root = pathlib.Path(root).resolve(strict=True)
    excluded = set(exclude_root)
    rows = []
    def visit(directory):
        for item in sorted(os.scandir(directory), key=lambda x: x.name):
            path = pathlib.Path(item.path)
            rel = path.relative_to(root).as_posix()
            relative_name(rel)
            if path.parent == root and item.name in excluded:
                continue
            mode = item.stat(follow_symlinks=False).st_mode
            if stat.S_ISLNK(mode):
                target = os.readlink(path)
                link_target(rel, target)
                body = target.encode()
                rows.append({"path": rel, "kind": "symlink", "target": target,
                             "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                             "mode": 0o777})
            elif stat.S_ISDIR(mode):
                rows.append({"path": rel, "kind": "directory", "mode": 0o700})
                visit(path)
            elif stat.S_ISREG(mode):
                before = item.stat(follow_symlinks=False)
                checksum = digest_file(path)
                after = path.stat()
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
                ):
                    raise ValueError("A runtime file changed during export: " + rel)
                rows.append({"path": rel, "kind": "file", "bytes": before.st_size,
                             "sha256": checksum, "mode": 0o700 if mode & 0o111 else 0o600})
            else:
                raise ValueError("A runtime contains an unsupported special file: " + rel)
    visit(root)
    return rows

def write_bundle(root, output, metadata, exclude_root=()):
    root = pathlib.Path(root).resolve(strict=True)
    output = pathlib.Path(output).absolute()
    if output == root or root in output.parents:
        raise ValueError("Write the runtime export outside its source directory")
    if output.exists() or output.is_symlink():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = inventory(root, exclude_root)
    if any(x["path"] == MANIFEST for x in rows):
        raise ValueError("The runtime uses the reserved archive manifest name")
    manifest = {"schema": SCHEMA, "metadata": metadata, "files": rows}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    temporary_fd, temporary_name = tempfile.mkstemp(prefix="." + output.name + "-", suffix=".partial", dir=output.parent)
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(temporary_fd, "wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                    for row in rows:
                        path = root.joinpath(*relative_name(row["path"]).parts)
                        info = tarfile.TarInfo(row["path"])
                        info.mode = row["mode"]
                        info.mtime = 0
                        if row["kind"] == "directory":
                            info.type = tarfile.DIRTYPE
                            archive.addfile(info)
                        elif row["kind"] == "symlink":
                            if not path.is_symlink() or os.readlink(path) != row["target"]:
                                raise ValueError("A runtime link changed during export")
                            info.type = tarfile.SYMTYPE
                            info.linkname = row["target"]
                            archive.addfile(info)
                        else:
                            if path.is_symlink() or path.stat().st_size != row["bytes"]:
                                raise ValueError("A runtime file changed during export")
                            info.size = row["bytes"]
                            class HashingReader:
                                def __init__(self, stream):
                                    self.stream = stream
                                    self.hash = hashlib.sha256()
                                def read(self, size=-1):
                                    part = self.stream.read(size)
                                    self.hash.update(part)
                                    return part
                            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                            with os.fdopen(fd, "rb") as stream:
                                body = HashingReader(stream)
                                archive.addfile(info, body)
                            if body.hash.hexdigest() != row["sha256"]:
                                raise ValueError("A runtime file changed during export")
                    info = tarfile.TarInfo(MANIFEST)
                    info.mode = 0o600
                    info.size = len(manifest_bytes)
                    archive.addfile(info, io.BytesIO(manifest_bytes))
            raw.flush()
            os.fsync(raw.fileno())
        os.chmod(temporary, 0o600)
        os.link(temporary, output)
        os.unlink(temporary)
        directory_fd = os.open(output.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        # A partial export is retained for its original operation to inspect.
        raise
    return {"schema": SCHEMA, "path": str(output), "bytes": output.stat().st_size,
            "sha256": digest_file(output), "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "files": sum(x["kind"] != "directory" for x in rows),
            "uncompressed_bytes": sum(x.get("bytes", 0) for x in rows)}

def checked_manifest(archive):
    members = archive.getmembers()
    by_name = {}
    for item in members:
        name = item.name.rstrip("/") if item.isdir() else item.name
        relative_name(name)
        if name in by_name:
            raise ValueError("The archive repeats an original member: " + name)
        if not (item.isfile() or item.isdir() or item.issym()) or item.islnk():
            raise ValueError("The archive contains an unsupported special member")
        by_name[name] = item
    selected = by_name.get(MANIFEST)
    if not selected or not selected.isfile() or selected.size > 64 * 1024 * 1024:
        raise ValueError("The complete runtime file manifest is missing")
    raw = archive.extractfile(selected).read()
    manifest = json.loads(raw)
    if manifest.get("schema") != SCHEMA or not isinstance(manifest.get("files"), list):
        raise ValueError("The selected archive is not a complete runtime")
    rows = {}
    for row in manifest["files"]:
        name = str(relative_name(row["path"]))
        if name == MANIFEST or name in rows:
            raise ValueError("The runtime file manifest repeats a member")
        if row.get("kind") not in ("file", "directory", "symlink"):
            raise ValueError("The runtime file manifest has an unknown member type")
        if row.get("kind") == "directory":
            if row.get("mode") != 0o700:
                raise ValueError("An archived directory mode differs")
        else:
            if type(row.get("bytes")) is not int or row["bytes"] < 0:
                raise ValueError("An archived member has an invalid byte length")
            checksum = row.get("sha256", "")
            if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
                raise ValueError("An archived member has an invalid content identity")
            if row.get("mode") not in ((0o777,) if row["kind"] == "symlink" else (0o600, 0o700)):
                raise ValueError("An archived member mode differs")
        rows[name] = row
    if set(by_name) != set(rows) | {MANIFEST}:
        raise ValueError("The runtime archive and its original manifest differ")
    for name, row in rows.items():
        item = by_name[name]
        kind = row["kind"]
        if kind == "directory":
            if not item.isdir():
                raise ValueError("A runtime directory has changed type")
        elif kind == "symlink":
            if not item.issym() or item.linkname != row["target"]:
                raise ValueError("A runtime link has changed")
            link_target(name, item.linkname)
            body = item.linkname.encode()
            if len(body) != row["bytes"] or hashlib.sha256(body).hexdigest() != row["sha256"]:
                raise ValueError("The original runtime link bytes differ")
        else:
            if not item.isfile() or item.size != row["bytes"]:
                raise ValueError("An original runtime file has changed size or type")
            h = hashlib.sha256()
            with archive.extractfile(item) as body:
                for part in iter(lambda: body.read(1024 * 1024), b""):
                    h.update(part)
            if h.hexdigest() != row["sha256"]:
                raise ValueError("An original runtime file differs: " + name)
        parent = pathlib.PurePosixPath(name).parent
        while str(parent) != ".":
            if str(parent) in rows and rows[str(parent)]["kind"] != "directory":
                raise ValueError("An archive member has a non-directory parent")
            parent = parent.parent
    return manifest, raw, by_name

def receive_bundle(archive_path, destination, temporary_directory=None):
    archive_path = pathlib.Path(archive_path).resolve(strict=True)
    destination = pathlib.Path(destination).absolute()
    if destination.is_symlink():
        raise ValueError("The receiving directory must be ordinary")
    if temporary_directory is not None:
        temporary_directory = pathlib.Path(temporary_directory).absolute()
        if temporary_directory.is_symlink():
            raise ValueError("The receiving temporary directory must be ordinary")
        temporary_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(archive_path, "r:gz") as archive:
        manifest, manifest_raw, by_name = checked_manifest(archive)
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        rows = sorted(manifest["files"], key=lambda x: (x["kind"] == "symlink", x["path"]))
        for row in rows:
            target = ordinary_parents(destination, row["path"])
            if row["kind"] == "directory":
                if target.is_symlink() or (target.exists() and not target.is_dir()):
                    raise ValueError("An existing receiving directory differs")
                target.mkdir(exist_ok=True, mode=0o700)
            elif row["kind"] == "symlink":
                if target.is_symlink():
                    if os.readlink(target) != row["target"]:
                        raise ValueError("An existing receiving link differs")
                elif target.exists():
                    raise ValueError("An existing receiving file differs")
                else:
                    os.symlink(row["target"], target)
            else:
                if target.is_symlink():
                    raise ValueError("An existing receiving file is a link")
                if target.exists():
                    if not target.is_file() or target.stat().st_size != row["bytes"] or digest_file(target) != row["sha256"]:
                        raise ValueError("An existing receiving file differs: " + row["path"])
                    continue
                fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=temporary_directory or target.parent)
                try:
                    with os.fdopen(fd, "wb") as output, archive.extractfile(by_name[row["path"]]) as source:
                        for part in iter(lambda: source.read(1024 * 1024), b""):
                            output.write(part)
                        output.flush()
                        os.fsync(output.fileno())
                    os.chmod(temporary, row["mode"])
                    if digest_file(temporary) != row["sha256"]:
                        raise ValueError("A copied runtime member differs")
                    try:
                        os.link(temporary, target)
                    except FileExistsError:
                        if target.is_symlink() or not target.is_file() or target.stat().st_size != row["bytes"] or digest_file(target) != row["sha256"]:
                            raise ValueError("A concurrently received file differs")
                    directory_fd = os.open(target.parent, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
    return {"schema": SCHEMA, "directory": str(destination.resolve()), "manifest": manifest,
            "manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
            "archive": {"path": str(archive_path), "bytes": archive_path.stat().st_size,
                        "sha256": digest_file(archive_path)}}
