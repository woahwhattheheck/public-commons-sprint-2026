"""Atomic retained state, verified sources and create-only portable workspaces."""
from __future__ import annotations
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.parse
import urllib.request
import uuid
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


def snapshot(source: Path, root: Path) -> tuple[str, list[dict[str, Any]]]:
    family = source_family(source)
    before = {p.name: file_hash(p) for p in family}
    family_key = digest(before)
    folder = root / "inputs" / family_key
    folder.mkdir(parents=True, exist_ok=True)
    inventory = []
    for src in family:
        dst = folder / src.name
        if not dst.exists():
            temporary = folder / (".copy-" + uuid.uuid4().hex)
            shutil.copyfile(src, temporary)
            if file_hash(temporary) != before[src.name]:
                temporary.unlink()
                raise ScenarioError(f"Input changed during copy: {src}")
            os.replace(temporary, dst)
        if file_hash(dst) != before[src.name]:
            raise ScenarioError(f"Retained input changed: {dst}")
        inventory.append({"path": dst.relative_to(root).as_posix(),
                          "sha256": before[src.name], "bytes": dst.stat().st_size})
    return (folder / source.name).relative_to(root).as_posix(), inventory


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


def export_workspace(root: Path, target: Path) -> dict[str, Any]:
    if target.exists() or target.resolve().is_relative_to(root.resolve()):
        raise ScenarioError("Export needs a new filename outside the workspace")
    target.parent.mkdir(parents=True, exist_ok=True)
    with exclusive(root):
        files = sorted(p for p in root.rglob("*") if p.is_file() and
                       p != root / ".workspace.lock")
        if any(p.is_symlink() for p in files):
            raise ScenarioError("Workspace export refuses symlinks")
        inventory = [{"path": p.relative_to(root).as_posix(), "sha256": file_hash(p),
                      "bytes": p.stat().st_size} for p in files]
        temp = target.with_name("." + target.name + ".writing")
        try:
            with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
                for p, meta in zip(files, inventory):
                    z.write(p, meta["path"])
                    if file_hash(p) != meta["sha256"]:
                        raise ScenarioError("Workspace changed during export")
                z.writestr("PORTABLE-MANIFEST.json", canonical({"schema": 1, "files": inventory}))
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)
    return {"file": str(target), "sha256": file_hash(target), "files": len(inventory)}


def receive_workspace(archive: Path, destination: Path, max_bytes: int = 100 * 1024**3) -> dict[str, Any]:
    if destination.exists():
        raise ScenarioError("Receiving is create-only; choose a new workspace directory")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".receiving-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as z:
            names = z.namelist()
            if len(names) != len(set(names)) or len(names) > 1000000:
                raise ScenarioError("Duplicate archive members or excessive file count")
            if sum(info.file_size for info in z.infolist()) > max_bytes:
                raise ScenarioError("Archive exceeds receive limit")
            manifest = json.loads(z.read("PORTABLE-MANIFEST.json"))
            entries = {v["path"]: v for v in manifest["files"]}
            if len(entries) != len(manifest["files"]) or set(names) != set(entries) | {"PORTABLE-MANIFEST.json"}:
                raise ScenarioError("Archive membership differs from its manifest")
            for relative, meta in entries.items():
                info = z.getinfo(relative)
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ScenarioError("Archive contains a symbolic link")
                target = inside(staging, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(relative) as src, target.open("xb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                if target.stat().st_size != meta["bytes"] or file_hash(target) != meta["sha256"]:
                    raise ScenarioError(f"Archive member failed verification: {relative}")
        staging.rename(destination)
        return {"workspace": str(destination), "files": len(entries)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
