"""Atomic retained state, verified sources and create-only portable workspaces."""
from __future__ import annotations
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import urllib.parse
import urllib.request
import zipfile
from typing import Any, Iterator

class ScenarioError(ValueError):
    """A customer-resolvable configuration, input or retained-state error."""


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def atomic_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".writing-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_json(path: Path, content: Any) -> None:
    atomic_bytes(path, json.dumps(content, indent=2, ensure_ascii=False,
                                allow_nan=False).encode("utf-8") + b"\n")


def inside(root: Path, relative: str) -> Path:
    if "\\" in relative:
        raise ScenarioError(f"Use portable forward-slash paths: {relative}")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ScenarioError(f"Path leaves workspace: {relative}")
    return path


def source_family(path: Path) -> list[Path]:
    """Include shapefile and raster sidecars rather than hashing only the stem."""
    if not path.is_file() or path.is_symlink():
        raise ScenarioError(f"Missing regular input: {path}")
    siblings = [path]
    if path.suffix.lower() == ".shp":
        siblings = sorted(p for p in path.parent.glob(path.stem + ".*")
                          if p.is_file() and not p.is_symlink())
        required = {".shp", ".shx", ".dbf", ".prj"}
        if not required.issubset({p.suffix.lower() for p in siblings}):
            raise ScenarioError(f"Incomplete shapefile family: {path}")
    else:
        for suffix in (".msk", ".aux.xml", ".ovr"):
            p = Path(str(path) + suffix)
            if p.is_file():
                siblings.append(p)
    return siblings


def dataset_hash(path: Path) -> str:
    """Authenticate all members of a vector/raster dataset, including DBF values."""
    return digest({p.name: file_hash(p) for p in source_family(path)})


def snapshot(source: Path, root: Path, *, retention=None) -> tuple[str, list[dict[str, Any]]]:
    """Receive independent complete dataset files; optionally share one operation cache."""
    from .retention import RetentionSession
    session = retention or RetentionSession(root)
    if session.root != Path(root).resolve():
        raise ScenarioError("Input retention belongs to another receiving directory")
    result = session.snapshot(source)
    if retention is None:
        session.verify()
    return result


@contextlib.contextmanager
def exclusive(root: Path, name: str = ".workspace.lock") -> Iterator[None]:
    """Kernel lock releases on process death; no unsafe PID guessing."""
    import fcntl
    root.mkdir(parents=True, exist_ok=True)
    with (root / name).open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ScenarioError("Another process is writing this workspace") from exc
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ScenarioError("Source redirected away from HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def acquire(manifest_path: Path, destination: Path) -> dict[str, Any]:
    """Receive explicit public sources; exact optional expected hashes; no scraping."""
    source_manifest = read_json(manifest_path)
    records = source_manifest["sources"]
    ids: set[str] = set()
    results = []
    destination.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(HTTPSOnlyRedirect())
    with exclusive(destination):
        for record in records:
            identifier = str(record["id"])
            if not identifier or identifier in ids:
                raise ScenarioError("Source IDs must be nonempty and unique")
            ids.add(identifier)
            for field in ("url", "provider", "license", "units", "vintage"):
                if not str(record.get(field, "")).strip():
                    raise ScenarioError(f"Source {identifier} needs {field}")
            url = record["url"]
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ScenarioError(f"Source {identifier} needs a public HTTPS URL")
            credential_names = {"token", "access_token", "api_key", "apikey", "signature", "sig", "key"}
            query_names = {key.lower() for key, _ in urllib.parse.parse_qsl(parsed.query)}
            if parsed.fragment or query_names & credential_names or any(k.startswith("x-amz-") for k in query_names):
                raise ScenarioError("Use durable public source URLs without credentials or signed download parameters")
            target = inside(destination, record["filename"])
            if target.exists():
                expected = record.get("sha256")
                if not expected or file_hash(target) != expected:
                    raise ScenarioError(f"Existing source differs or has no expected hash: {target}")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                fd, temp = tempfile.mkstemp(prefix=".source-", dir=target.parent)
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "EcoScenarioLab/0.1"})
                    with opener.open(req, timeout=120) as response, os.fdopen(fd, "wb") as out:
                        media = response.headers.get("Content-Type", "").lower()
                        if "text/html" in media and target.suffix.lower() not in {".html", ".htm"}:
                            raise ScenarioError("A download returned a web page instead of the requested input")
                        total = 0
                        for chunk in iter(lambda: response.read(1024 * 1024), b""):
                            total += len(chunk)
                            if total > record.get("max_bytes", 20 * 1024**3):
                                raise ScenarioError("Source exceeds its declared size limit")
                            out.write(chunk)
                        out.flush()
                        os.fsync(out.fileno())
                    got = file_hash(Path(temp))
                    if record.get("sha256") and got != record["sha256"]:
                        raise ScenarioError(f"Source checksum mismatch: {identifier}")
                    os.replace(temp, target)
                finally:
                    if os.path.exists(temp):
                        os.unlink(temp)
            results.append({**record, "sha256": file_hash(target), "bytes": target.stat().st_size})
        output = {"schema": 1, "sources": results}
        atomic_json(destination / "received-sources.json", output)
    return output


def _file_identity(path: Path) -> tuple[int, int, int, int, int]:
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ScenarioError(f"Portable workspaces need regular files: {path}")
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _portable_inventory(root: Path) -> dict[str, tuple[int, int, int, int, int]]:
    """Capture the complete membership while the original workspace is locked."""
    selected = {}
    def unreadable(error):
        raise ScenarioError(
            f"Workspace inventory could not read {error.filename or root}: {error}"
        ) from error
    for directory, directories, filenames in os.walk(
            root, followlinks=False, onerror=unreadable):
        current = Path(directory)
        directories.sort()
        for name in directories:
            if (current / name).is_symlink():
                raise ScenarioError("Workspace export refuses directory symlinks")
        for name in sorted(filenames):
            path = current / name
            if path == root / ".workspace.lock":
                continue
            relative = path.relative_to(root).as_posix()
            if relative == "PORTABLE-MANIFEST.json":
                raise ScenarioError("The workspace contains the reserved portable manifest name")
            selected[relative] = _file_identity(path)
    return dict(sorted(selected.items()))


def _sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def export_workspace(root: Path, target: Path) -> dict[str, Any]:
    root, target = Path(root).resolve(), Path(target).absolute()
    if os.path.lexists(target) or target.resolve().is_relative_to(root):
        raise ScenarioError("Export needs a new filename outside the workspace")
    target.parent.mkdir(parents=True, exist_ok=True)
    with exclusive(root):
        original = _portable_inventory(root)
        descriptor, name = tempfile.mkstemp(prefix=".eco13-export-", dir=target.parent)
        temporary = Path(name)
        try:
            inventory = []
            with os.fdopen(descriptor, "w+b") as output:
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=3, allowZip64=True) as archive:
                    for relative, expected in original.items():
                        source = root / relative
                        opened = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(opened, "rb") as retained:
                            before = os.fstat(retained.fileno())
                            identity = (before.st_dev, before.st_ino, before.st_size,
                                        before.st_mtime_ns, before.st_ctime_ns)
                            if identity != expected:
                                raise ScenarioError(f"Original file changed before export: {relative}")
                            digestor, size = hashlib.sha256(), 0
                            with archive.open(relative, "w", force_zip64=True) as member:
                                for block in iter(lambda: retained.read(1024 * 1024), b""):
                                    member.write(block)
                                    digestor.update(block)
                                    size += len(block)
                            after = os.fstat(retained.fileno())
                            observed = (after.st_dev, after.st_ino, after.st_size,
                                        after.st_mtime_ns, after.st_ctime_ns)
                            if observed != expected or size != expected[2]:
                                raise ScenarioError(f"Original file changed during export: {relative}")
                        if _file_identity(source) != expected:
                            raise ScenarioError(f"Original file was replaced during export: {relative}")
                        inventory.append({"path": relative, "bytes": size,
                                          "sha256": digestor.hexdigest()})
                    if _portable_inventory(root) != original:
                        raise ScenarioError("Workspace membership changed during export")
                    archive.writestr("PORTABLE-MANIFEST.json",
                                     canonical({"schema": 1, "files": inventory}))
                output.flush()
                os.fsync(output.fileno())
            # Link is an atomic create-only publication on the staging volume.
            # A concurrent completed archive or dangling alias is preserved.
            try:
                os.link(temporary, target)
            except FileExistsError as error:
                raise ScenarioError("The export destination was created by another operation") from error
            temporary.unlink()
            _sync_directory(target.parent)
        finally:
            temporary.unlink(missing_ok=True)
    return {"file": str(target), "sha256": file_hash(target), "files": len(inventory)}


def _portable_member(value: Any) -> str:
    if (not isinstance(value, str) or not value or "\\" in value or "\0" in value
            or value.startswith("/") or
            any(part in ("", ".", "..") for part in value.split("/"))):
        raise ScenarioError("Archive members need canonical relative file paths")
    return value


def receive_workspace(archive: Path, destination: Path,
                      max_bytes: int = 100 * 1024**3) -> dict[str, Any]:
    archive, destination = Path(archive), Path(destination).absolute()
    if type(max_bytes) is not int or max_bytes < 0:
        raise ScenarioError("Receiving byte limit must be a nonnegative integer")
    if os.path.lexists(destination):
        raise ScenarioError("Receiving is create-only; choose a new workspace directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".receiving-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as source:
            infos = source.infolist()
            names = [item.filename for item in infos]
            if len(names) != len(set(names)) or len(names) > 1000000:
                raise ScenarioError("Duplicate archive members or excessive file count")
            if sum(info.file_size for info in infos) > max_bytes:
                raise ScenarioError("Archive exceeds receive limit")
            for info in infos:
                _portable_member(info.filename)
                mode = stat.S_IFMT(info.external_attr >> 16)
                if info.is_dir() or mode not in (0, stat.S_IFREG) or info.flag_bits & 1:
                    raise ScenarioError("Archive members must be unencrypted regular files")
            if "PORTABLE-MANIFEST.json" not in names:
                raise ScenarioError("Archive lacks its portable manifest")
            manifest = json.loads(source.read("PORTABLE-MANIFEST.json"))
            if (not isinstance(manifest, dict) or type(manifest.get("schema")) is not int
                    or manifest["schema"] != 1
                    or not isinstance(manifest.get("files"), list)):
                raise ScenarioError("Choose a supported schema1 portable workspace")
            entries = {}
            for value in manifest["files"]:
                if not isinstance(value, dict):
                    raise ScenarioError("Archive file descriptor must be an object")
                relative = _portable_member(value.get("path"))
                if relative in entries or relative == "PORTABLE-MANIFEST.json":
                    raise ScenarioError("Archive manifest repeats a reserved or original member")
                sha256 = value.get("sha256")
                if (type(value.get("bytes")) is not int or value["bytes"] < 0
                        or not isinstance(sha256, str) or len(sha256) != 64
                        or any(char not in "0123456789abcdef" for char in sha256)):
                    raise ScenarioError(f"Archive member descriptor is invalid: {relative}")
                entries[relative] = value
            if set(names) != set(entries) | {"PORTABLE-MANIFEST.json"}:
                raise ScenarioError("Archive membership differs from its manifest")
            for relative, expected in entries.items():
                info = source.getinfo(relative)
                if info.file_size != expected["bytes"]:
                    raise ScenarioError(f"Archive member length differs: {relative}")
                target = staging.joinpath(*relative.split("/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                digestor, size = hashlib.sha256(), 0
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "wb") as output, source.open(info) as retained:
                    for block in iter(lambda: retained.read(1024 * 1024), b""):
                        output.write(block)
                        digestor.update(block)
                        size += len(block)
                    output.flush()
                    os.fsync(output.fileno())
                if size != expected["bytes"] or digestor.hexdigest() != expected["sha256"]:
                    raise ScenarioError(f"Archive member failed verification: {relative}")
        # Serialize publishers targeting this exact destination. The complete
        # extracted edition remains private until its final directory rename.
        lock_name = ".eco13-receive-" + hashlib.sha256(
            str(destination.resolve()).encode("utf-8")).hexdigest() + ".lock"
        with exclusive(destination.parent, name=lock_name):
            if os.path.lexists(destination):
                raise ScenarioError("Receiving destination was created by another operation")
            staging.rename(destination)
            _sync_directory(destination.parent)
        return {"workspace": str(destination), "files": len(entries)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
