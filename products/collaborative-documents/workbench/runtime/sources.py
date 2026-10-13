"""Receive the complete selected upstream Git trees from their original archives."""
from __future__ import annotations
import argparse, datetime, hashlib, json, os, pathlib, stat, sys, tarfile, tempfile, urllib.parse, urllib.request
from archive import atomic_json, digest_file, link_target, ordinary_parents, relative_name

ALLOWED_HOSTS = {"github.com", "api.github.com", "codeload.github.com"}

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def git_hash(body):
    return hashlib.sha1(("blob " + str(len(body)) + "\0").encode() + body).hexdigest()

class SourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        parsed = urllib.parse.urlparse(new_url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.username or parsed.password:
            raise ValueError("The source redirect leaves the selected public provider")
        return super().redirect_request(request, fp, code, message, headers, new_url)

def download_source(repository, destination):
    destination = pathlib.Path(destination)
    if destination.is_file() and not destination.is_symlink():
        return {"path": str(destination), "bytes": destination.stat().st_size,
                "sha256": digest_file(destination), "reused": True}
    if destination.exists() or destination.is_symlink():
        raise ValueError("The original source archive path is occupied")
    selected_url = repository["archive_url"]
    url = urllib.parse.urlparse(selected_url)
    if url.scheme != "https" or url.hostname not in ALLOWED_HOSTS or url.username or url.password:
        raise ValueError("Select the original public source archive")
    ceiling = max(16 * 1024 * 1024, sum(x["bytes"] for x in repository["files"]) * 3)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, partial = tempfile.mkstemp(prefix=destination.name + "-", suffix=".partial", dir=destination.parent)
    receipt = {"url": selected_url, "started_at": now(), "partial": partial}
    atomic_json(pathlib.Path(partial + ".json"), receipt)
    total = 0
    request = urllib.request.Request(selected_url, headers={"User-Agent": "TJLabs-Hocuspocus-Source-Receiver/1"})
    try:
        opener = urllib.request.build_opener(SourceRedirect)
        with os.fdopen(fd, "wb") as output, opener.open(request, timeout=60) as response:
            if response.status != 200:
                raise ValueError("The original archive request did not complete")
            length = response.headers.get("Content-Length")
            if length and int(length) > ceiling:
                raise ValueError("The provider archive exceeds its selected source allowance")
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                total += len(chunk)
                if total > ceiling:
                    raise ValueError("The provider archive exceeds its selected source allowance")
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
            if length and total != int(length):
                raise ValueError("The original archive response ended early")
            receipt.update({"status": response.status, "final_url": response.url,
                            "etag": response.headers.get("ETag"),
                            "last_modified": response.headers.get("Last-Modified")})
        os.chmod(partial, 0o600)
        receipt.update({"finished_at": now(), "bytes": total, "sha256": digest_file(partial)})
        os.link(partial, destination)
        os.unlink(partial)
        receipt["path"] = str(destination)
        atomic_json(destination.with_suffix(destination.suffix + ".json"), receipt)
        return receipt
    except BaseException as error:
        receipt.update({"finished_at": now(), "received_bytes": total, "error": str(error)})
        atomic_json(pathlib.Path(partial + ".json"), receipt)
        raise

def verify_original(archive_path, repository):
    expected = {x["path"]: x for x in repository["files"]}
    if len(expected) != len(repository["files"]):
        raise ValueError("The selected upstream source repeats a path")
    for name, row in expected.items():
        relative_name(name)
        if row["mode"] not in ("100644", "100755", "120000") or type(row["bytes"]) is not int or row["bytes"] < 0:
            raise ValueError("The selected upstream file record is invalid")
    selected = {}
    prefix = None
    with tarfile.open(archive_path, "r:gz") as archive:
        for item in archive.getmembers():
            name = item.name.rstrip("/") if item.isdir() else item.name
            parts = relative_name(name).parts
            if prefix is None:
                prefix = parts[0]
            if parts[0] != prefix:
                raise ValueError("The original source archive has multiple roots")
            if len(parts) == 1:
                if not item.isdir():
                    raise ValueError("The source archive root is not a directory")
                continue
            rel = "/".join(parts[1:])
            if item.isdir():
                continue
            row = expected.get(rel)
            if row is None or rel in selected:
                raise ValueError("The original source archive has an unexpected member: " + rel)
            if row["mode"] == "120000":
                if not item.issym():
                    raise ValueError("An original source link changed type")
                link_target(rel, item.linkname)
                body = item.linkname.encode()
            else:
                if not item.isfile() or item.islnk() or item.size != row["bytes"]:
                    raise ValueError("An original source file changed size or type")
                with archive.extractfile(item) as source:
                    body = source.read()
                if bool(item.mode & 0o111) != (row["mode"] == "100755"):
                    raise ValueError("An original source executable mode differs")
            if len(body) != row["bytes"] or git_hash(body) != row["git_blob_sha"]:
                raise ValueError("An original source Git body differs: " + rel)
            selected[rel] = item.name
    if set(selected) != set(expected):
        missing = sorted(set(expected) - set(selected))
        raise ValueError("The original archive is incomplete: " + ", ".join(missing[:8]))
    return selected

def materialize_original(archive_path, repository, destination):
    selected = verify_original(archive_path, repository)
    destination = pathlib.Path(destination)
    if destination.is_symlink():
        raise ValueError("The original source directory must be ordinary")
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(archive_path, "r:gz") as archive:
        for row in sorted(repository["files"], key=lambda x: (x["mode"] == "120000", x["path"])):
            target = ordinary_parents(destination, row["path"])
            item = archive.getmember(selected[row["path"]])
            if row["mode"] == "120000":
                if target.is_symlink():
                    if os.readlink(target) != item.linkname:
                        raise ValueError("An existing original source link differs")
                elif target.exists():
                    raise ValueError("An existing original source member differs")
                else:
                    os.symlink(item.linkname, target)
                continue
            if target.is_symlink():
                raise ValueError("An original source file has become a link")
            if target.exists():
                body = target.read_bytes()
                if len(body) != row["bytes"] or git_hash(body) != row["git_blob_sha"]:
                    raise ValueError("An existing original source file differs: " + row["path"])
                continue
            fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as output, archive.extractfile(item) as source:
                    h = hashlib.sha1(("blob " + str(row["bytes"]) + "\0").encode())
                    written = 0
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        h.update(chunk)
                        written += len(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if written != row["bytes"] or h.hexdigest() != row["git_blob_sha"]:
                    raise ValueError("The copied original source differs")
                os.chmod(temporary, 0o700 if row["mode"] == "100755" else 0o600)
                try:
                    os.link(temporary, target)
                except FileExistsError:
                    if target.is_symlink() or not target.is_file():
                        raise ValueError("A concurrently received source member changed type")
                    body = target.read_bytes()
                    if len(body) != row["bytes"] or git_hash(body) != row["git_blob_sha"]:
                        raise ValueError("A concurrently received source member differs")
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
    return {"repository": repository["repository"], "tag": repository["tag"],
            "commit": repository["commit"], "directory": str(destination.resolve()),
            "files": len(repository["files"]), "bytes": sum(x["bytes"] for x in repository["files"]),
            "archive_sha256": digest_file(archive_path)}

def collect(manifest_path, directory, mounted=None):
    manifest_path = pathlib.Path(manifest_path).resolve(strict=True)
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    if manifest.get("schema") != "hocuspocus.upstreams.v1":
        raise ValueError("Select the complete original upstream source manifest")
    directory = pathlib.Path(directory).absolute()
    if directory.is_symlink():
        raise ValueError("The source receiving directory must be ordinary")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    identity = hashlib.sha256(raw).hexdigest()
    selection = {"schema": "hocuspocus.upstream-selection.v1", "manifest_sha256": identity,
                 "operation": manifest["operation"]}
    saved = directory / "SELECTION.json"
    if saved.exists():
        if json.loads(saved.read_text()) != selection:
            raise ValueError("This directory belongs to a different original source selection")
    else:
        atomic_json(saved, selection)
    results = []
    for repository in manifest["repositories"]:
        name = repository["id"]
        if str(relative_name(name)) != name or "/" in name:
            raise ValueError("The source ID must be one path component")
        commit = repository["commit"]
        if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
            raise ValueError("The source commit is invalid")
        archive = directory / "archives" / (name + "-" + commit + ".tar.gz")
        supplied = (mounted or {}).get(name)
        if archive.exists() or archive.is_symlink():
            if archive.is_symlink() or not archive.is_file():
                raise ValueError("The retained original archive is not an ordinary file")
            try:
                verify_original(archive, repository)
            except (ValueError, tarfile.TarError, EOFError, OSError) as error:
                rejected = directory / "rejected"
                rejected.mkdir(exist_ok=True, mode=0o700)
                original_hash = digest_file(archive)
                rejected_archive = rejected / (name + "-" + original_hash + ".tar.gz")
                if rejected_archive.exists():
                    if digest_file(rejected_archive) != original_hash:
                        raise ValueError("The rejected source archive path differs")
                    archive.unlink()
                else:
                    os.rename(archive, rejected_archive)
                atomic_json(rejected / (name + "-" + original_hash + ".json"),
                            {"archive": str(rejected_archive), "sha256": original_hash,
                             "reason": str(error), "retained_at": now()})
        if supplied:
            supplied = pathlib.Path(supplied).resolve(strict=True)
            verify_original(supplied, repository)
            archive.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            supplied_hash = digest_file(supplied)
            if archive.exists() and digest_file(archive) != supplied_hash:
                # Different provider tar metadata can contain the same exact Git bodies.
                archive = archive.parent / (name + "-" + commit + "-" + supplied_hash + ".tar.gz")
            if not archive.exists():
                fd, temporary = tempfile.mkstemp(prefix=archive.name + "-", suffix=".partial", dir=archive.parent)
                with os.fdopen(fd, "wb") as output, open(supplied, "rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if digest_file(temporary) != supplied_hash:
                    raise ValueError("The mounted original changed during receiving")
                os.chmod(temporary, 0o600)
                try:
                    os.link(temporary, archive)
                except FileExistsError:
                    if archive.is_symlink() or digest_file(archive) != supplied_hash:
                        raise ValueError("The concurrently received original differs")
                os.unlink(temporary)
            if archive.is_symlink() or digest_file(archive) != supplied_hash:
                raise ValueError("The retained mounted original differs")
            receipt = {"path": str(archive), "source": str(supplied), "bytes": archive.stat().st_size,
                       "sha256": supplied_hash, "received_at": now(), "mounted": True}
        else:
            receipt = download_source(repository, archive)
        result = materialize_original(archive, repository, directory / "source" / name / commit)
        result["provider"] = receipt
        results.append(result)
        atomic_json(directory / (name + "-RECEIVED.json"), result)
    result = {"schema": "hocuspocus.upstream-receiving.v1", "operation": manifest["operation"],
              "manifest_sha256": identity, "directory": str(directory.resolve()),
              "complete": True, "received_at": now(), "repositories": results}
    atomic_json(directory / "RECEIVED.json", result)
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=str(pathlib.Path(__file__).with_name("upstreams.json")))
    parser.add_argument("--directory", required=True)
    parser.add_argument("--hocuspocus-archive")
    parser.add_argument("--tiptap-archive")
    args = parser.parse_args()
    mounted = {key: value for key, value in (("hocuspocus", args.hocuspocus_archive), ("tiptap", args.tiptap_archive)) if value}
    print(json.dumps(collect(args.manifest, args.directory, mounted), ensure_ascii=False, indent=2))
