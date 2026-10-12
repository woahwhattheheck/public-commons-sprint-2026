"""MIT. Retain complete NDJSON merchants in the original locked source workspace.

The original merchant compiler and validator create/accept a package once.
Repeat reads verify retained bytes; they neither compile nor start a seller.
"""
from __future__ import annotations

from contextlib import contextmanager, ExitStack
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

from workspace import InputError, json_bytes, load_json, private_write, sync_dir

SCHEMA = "stellar-forge.ndjson-retained-merchant.v1"
REQUEST = "stellar-forge.ndjson-merchant-request.v1"
HASH = re.compile(r"[0-9a-f]{64}\Z")
MAX_FILE = 256 * 1024 * 1024
MAX_PACKAGE = 4 * 1024 * 1024 * 1024
MEMBERS = (
    "data.csv", "dataset.json", "ndjson-lineage.json", "source.ndjson",
    "plan.json", "payment.json", "seller.json", "openapi.json", "OPERATING.md",
    "customer/seller-client.mjs", "customer/seller-client.d.mts",
    "customer/seller-openapi.json", "customer/package.json", "customer/README.md",
    "customer/client-export.json", "merchant.json",
)


def need(condition, message):
    if not condition:
        raise InputError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def identifier(value):
    need(isinstance(value, str) and HASH.fullmatch(value), "Select the complete retained merchant ID.")
    return value


def directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and (os.name != "posix" or
         info.st_uid == os.getuid() and not info.st_mode & 0o077),
         "Retained merchant directories must be private and operator-owned.")
    return path



def publication_prefix(path):
    # The destination name is bound into every alias we may recover.
    return ".merchant-publish-" + digest(os.fsencode(Path(path).name)) + "-"


def recover_publication_aliases(path, stream):
    """Recover only complete, same-inode stages whose publication owner ended."""
    need(os.name == "posix", "Preserve the additional links to this merchant file.")
    import fcntl
    try:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        raise InputError("This merchant file still has a publication owner.") from error
    try:
        info = os.fstat(stream.fileno())
        if info.st_nlink == 1:
            return
        path = Path(path)
        prefix = publication_prefix(path)
        aliases = []
        with os.scandir(path.parent) as entries:
            for entry in entries:
                if not entry.name.startswith(prefix) or not re.fullmatch(
                        r"[a-z0-9_]{8}", entry.name[len(prefix):]):
                    continue
                other = entry.stat(follow_symlinks=False)
                if (other.st_dev, other.st_ino) == (info.st_dev, info.st_ino):
                    need(stat.S_ISREG(other.st_mode), "Preserve the changed publication stage.")
                    aliases.append(Path(entry.path))
        need(aliases and len(aliases) == info.st_nlink - 1,
             "Preserve unrelated or unrecognized links to this merchant file.")
        def fixed(value):
            return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                    value.st_mode, value.st_uid)
        for index, alias in enumerate(aliases):
            current = os.fstat(stream.fileno())
            named = path.lstat()
            other = alias.lstat()
            need(fixed(current) == fixed(info) == fixed(named) == fixed(other)
                 and current.st_nlink == named.st_nlink == other.st_nlink == info.st_nlink - index,
                 "The retained publication changed during recovery.")
            alias.unlink()
        final = os.fstat(stream.fileno())
        need(fixed(final) == fixed(info) and final.st_nlink == 1
             and (path.lstat().st_dev, path.lstat().st_ino) == (info.st_dev, info.st_ino),
             "The retained publication changed during recovery.")
        sync_dir(path.parent)
    finally:
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


@contextmanager
def publication_stage(path):
    """Keep the stage owner alive through exclusive publication and alias removal."""
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix=publication_prefix(path), dir=path.parent)
    temporary = Path(name)
    original = os.fstat(fd)
    with os.fdopen(fd, "w+b") as stream:
        os.fchmod(stream.fileno(), 0o600)
        if os.name == "posix":
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield stream, temporary
        finally:
            try:
                current = temporary.lstat()
            except FileNotFoundError:
                pass
            else:
                need(stat.S_ISREG(current.st_mode) and
                     (current.st_dev, current.st_ino) == (original.st_dev, original.st_ino),
                     "Preserve the changed merchant publication stage.")
                temporary.unlink()
            sync_dir(path.parent)


def publish_stage(stream, temporary, destination):
    stream.flush()
    os.fsync(stream.fileno())
    if os.name == "posix":
        os.link(temporary, destination)
    else:
        # Windows rename is exclusive when the destination already exists and
        # does not leave a second link. Close its file handle before moving it.
        stream.close()
        os.rename(temporary, destination)


@contextmanager
def opened(path, limit=MAX_FILE):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= limit
             and (os.name != "posix" or info.st_uid == os.getuid() and not info.st_mode & 0o077),
             "Keep the original private bounded merchant file.")
        if info.st_nlink != 1:
            recover_publication_aliases(path, stream)
            info = os.fstat(stream.fileno())
        need(info.st_nlink == 1, "Keep the original single-link merchant file.")
        yield stream, info
        after = os.fstat(stream.fileno())
        need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
             "A retained merchant file changed while reading.")


def identity(path, limit=MAX_FILE):
    value, count = hashlib.sha256(), 0
    with opened(path, limit) as (stream, info):
        for block in iter(lambda: stream.read(1048576), b""):
            count += len(block)
            need(count <= limit, "Merchant file exceeds its declared limit.")
            value.update(block)
        need(count == info.st_size, "Merchant file ended before its complete byte count.")
    return {"bytes": count, "sha256": value.hexdigest()}


def read_json(path):
    with opened(path, 1024 * 1024) as (stream, _):
        return load_json(stream.read())


def exact_file(path, raw):
    """Exclusive, complete publication; a retry can only reuse identical bytes."""
    path = Path(path)
    if path.exists() or path.is_symlink():
        with opened(path, max(1024 * 1024, len(raw))) as (stream, _):
            need(stream.read() == raw, "A retained merchant request or result differs.")
        return
    with publication_stage(path) as (out, temporary):
        out.write(raw)
        try:
            publish_stage(out, temporary, path)
        except FileExistsError:
            with opened(path, max(1024 * 1024, len(raw))) as (stream, _):
                need(stream.read() == raw, "A concurrent retained merchant file differs.")


def copy_to(source, out, limit=MAX_FILE):
    with opened(source, limit) as (inp, before):
        count = 0
        for block in iter(lambda: inp.read(1048576), b""):
            count += len(block)
            need(count <= limit, "Merchant file exceeds its declared limit.")
            out.write(block)
        need(count == before.st_size, "Merchant source changed during copy.")
        out.flush()
        os.fsync(out.fileno())


class MerchantPackages:
    """Mixin: all writes share the original Workspace.mutex and lifetime lease."""

    def _merchant_roots(self):
        return (directory(self.root / "merchants"), directory(self.root / "merchant-requests"))

    def _merchant_native_status(self, prepared):
        tool = Path(__file__).resolve().parent / "merchant.mjs"
        result = subprocess.run([os.environ.get("SF30_XML_NODE", "node"), str(tool),
                                 "status", "--prepared", str(prepared)],
                                capture_output=True, timeout=180, check=False,
                                pass_fds=(self.lease.fileno(),) if os.name == "posix" else ())
        if result.returncode:
            raise InputError(result.stderr.decode("utf-8", errors="replace")[-4000:] or
                             "The original merchant validator refused this package.")
        return load_json(result.stdout)

    def _merchant_sync(self, prepared):
        for name in MEMBERS:
            with opened(prepared / name) as (stream, _):
                os.fsync(stream.fileno())
        sync_dir(prepared / "customer")
        sync_dir(prepared)

    def _merchant_incomplete(self, prepared):
        """Discard only this request's incomplete generated stage after owner exit.

        The original workspace lease is inherited by its compiler subprocess;
        reopening the workspace therefore cannot race that still-running child.
        """
        if not prepared.exists():
            return
        need(prepared.is_dir() and not prepared.is_symlink(), "Invalid original preparation stage.")
        def failed(error):
            raise error
        for parent, dirs, names in os.walk(prepared, followlinks=False, onerror=failed):
            for name in dirs:
                child = Path(parent) / name
                need(not child.is_symlink() and child.relative_to(prepared).as_posix() == "customer",
                     "Preserve the unknown directory in this interrupted preparation.")
            for name in names:
                path = Path(parent) / name
                need(path.relative_to(prepared).as_posix() in MEMBERS,
                     "Preserve the unknown file in this interrupted preparation.")
                with opened(path):
                    pass
        shutil.rmtree(prepared)

    def _merchant_files(self, prepared):
        """Check the complete original roster, including unlisted files/directories."""
        need(prepared.is_dir() and not prepared.is_symlink(), "The prepared merchant directory is absent.")
        found = set()
        def failed(error):
            raise error
        for parent, dirs, names in os.walk(prepared, followlinks=False, onerror=failed):
            for name in dirs:
                child = Path(parent) / name
                need(not child.is_symlink() and child.relative_to(prepared).as_posix() == "customer",
                     "A prepared merchant contains an unexpected directory.")
            for name in names:
                relative = (Path(parent) / name).relative_to(prepared).as_posix()
                need(relative in MEMBERS, "A prepared merchant contains an unlisted file.")
                found.add(relative)
        need(found == set(MEMBERS), "The complete original sixteen-file merchant is required.")
        manifest = read_json(prepared / "merchant.json")
        need(isinstance(manifest, dict) and manifest.get("schema") == "stellar-forge.ndjson-merchant.v1"
             and manifest.get("state") == "PREPARED" and
             isinstance(manifest.get("files"), dict) and set(manifest["files"]) == set(MEMBERS) - {"merchant.json"},
             "The original merchant manifest is incomplete.")
        for name in MEMBERS:
            actual = identity(prepared / name, 1024 * 1024 if name == "merchant.json" else MAX_FILE)
            if name != "merchant.json":
                need(actual == manifest["files"][name], "A prepared merchant member differs: " + name)
        return manifest

    def _merchant_archive_matches(self, archive, manifest, manifest_identity):
        expected = {**manifest["files"], "merchant.json": manifest_identity}
        with zipfile.ZipFile(archive) as packet:
            infos = packet.infolist()
            need(len(infos) == len(MEMBERS) and {entry.filename for entry in infos} == set(MEMBERS),
                 "The retained ZIP does not contain the complete original merchant.")
            for entry in infos:
                item = expected[entry.filename]
                need(not entry.is_dir() and not entry.flag_bits & 1 and
                     entry.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} and
                     stat.S_IFMT(entry.external_attr >> 16) in {0, stat.S_IFREG} and
                     entry.file_size == item["bytes"],
                     "The retained ZIP member differs from its original manifest.")
                total, value = 0, hashlib.sha256()
                with packet.open(entry) as stream:
                    for block in iter(lambda: stream.read(1048576), b""):
                        total += len(block)
                        need(total <= item["bytes"], "The retained ZIP member exceeds its original bytes.")
                        value.update(block)
                need(total == item["bytes"] and value.hexdigest() == item["sha256"],
                     "The retained ZIP member failed original byte verification.")

    def _merchant_verified_record(self, folder, package_id):
        need(folder.is_dir() and not folder.is_symlink(), "Unknown retained merchant.")
        record = read_json(folder / "package.json")
        need(isinstance(record, dict) and set(record) ==
             {"schema", "id", "archive", "manifest", "merchant"} and record["schema"] == SCHEMA
             and record["id"] == package_id and record["archive"]["sha256"] == package_id,
             "The retained merchant record changed.")
        manifest = self._merchant_files(folder / "prepared")
        need(manifest == record["merchant"] and identity(folder / "prepared" / "merchant.json", 1024 * 1024) ==
             record["manifest"] and identity(folder / "merchant.zip", MAX_PACKAGE) == record["archive"],
             "The retained merchant archive or original manifest changed.")
        return record

    def _merchant_verify(self, package_id):
        root, _ = self._merchant_roots()
        folder = root / identifier(package_id)
        return self._merchant_verified_record(folder, package_id)

    def merchant_package(self, package_id):
        with self.mutex:
            record = self._merchant_verify(package_id)
            return {**record, "directory": str(self.root / "merchants" / package_id / "prepared"),
                    "download": "/api/merchants/download?id=" + package_id}

    def merchant_packages(self):
        with self.mutex:
            root, _ = self._merchant_roots()
            result = []
            for path in sorted(root.iterdir()):
                need(path.is_dir() and not path.is_symlink() and HASH.fullmatch(path.name),
                     "An unexpected retained merchant entry requires inspection.")
                record = read_json(path / "package.json")
                need(record.get("schema") == SCHEMA and record.get("id") == path.name,
                     "The retained merchant catalog changed.")
                merchant = record["merchant"]
                result.append({"id": record["id"], "build": merchant["build"],
                               "source": merchant["source"], "plan": merchant["plan"],
                               "snapshot": merchant["snapshot"], "resource": merchant["resource"],
                               "bytes": record["archive"]["bytes"]})
            return result

    def _merchant_request(self, kind, selection, request_id=None):
        root, requests = self._merchant_roots()
        if request_id is not None:
            need(isinstance(request_id, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", request_id),
                 "Use one stable merchant request ID of at most 128 letters, digits, dots, underscores or hyphens.")
        body = {"schema": REQUEST, "kind": kind, "selection": selection, "request_id": request_id}
        key = digest(json_bytes([kind, request_id])) if request_id is not None else digest(json_bytes(body))
        original = directory(requests / key)
        exact_file(original / "request.json", json_bytes(body))
        if (original / "result.json").exists():
            result = read_json(original / "result.json")
            need(result.get("request") == key and result.get("schema") == REQUEST,
                 "The original merchant result changed.")
            return root, original, key, self.merchant_package(result["package"])
        return root, original, key, None

    def _merchant_finish(self, root, request, key, work):
        # The complete archive and record are frozen before directory publication.
        # A crash after publication recovers that exact directory via this pointer.
        pointer = request / "prepared.json"
        if pointer.exists():
            selected = read_json(pointer)
            need(set(selected) == {"package"} and HASH.fullmatch(selected["package"]),
                 "The original completed package pointer changed.")
            package_id = selected["package"]
        else:
            manifest = self._merchant_files(work / "prepared")
            archive = work / "merchant.zip"
            if not archive.exists():
                with publication_stage(archive) as (out, temporary):
                    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as packet:
                        for member in sorted(MEMBERS):
                            info = zipfile.ZipInfo(member, (1980, 1, 1, 0, 0, 0))
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = 0o100600 << 16
                            with opened(work / "prepared" / member) as (inp, _), packet.open(info, "w") as target:
                                shutil.copyfileobj(inp, target, 1048576)
                    publish_stage(out, temporary, archive)
            self._merchant_archive_matches(archive, manifest, identity(work / "prepared" / "merchant.json", 1024 * 1024))
            archive_id = identity(archive, MAX_PACKAGE)
            package_id = archive_id["sha256"]
            record = {"schema": SCHEMA, "id": package_id, "archive": archive_id,
                      "manifest": identity(work / "prepared" / "merchant.json", 1024 * 1024),
                      "merchant": manifest}
            exact_file(work / "package.json", json_bytes(record))
            exact_file(pointer, json_bytes({"package": package_id}))
        destination = root / package_id
        if destination.exists() or destination.is_symlink():
            self._merchant_verify(package_id)
            if work.exists():
                # This is this exact request's redundant completed stage only.
                need(read_json(work / "package.json") == read_json(destination / "package.json"),
                     "The completed stage differs from its retained package.")
                shutil.rmtree(work)
        else:
            need(work.is_dir() and not work.is_symlink(), "The completed merchant stage is absent.")
            self._merchant_verified_record(work, package_id)
            os.rename(work, destination)
            sync_dir(root)
        record = self.merchant_package(package_id)
        exact_file(request / "result.json", json_bytes({"schema": REQUEST, "request": key, "package": package_id}))
        return record

    def save_merchant(self, build, payment, origin, route, request_id=None):
        with self.mutex:
            need(isinstance(payment, dict) and isinstance(origin, str) and isinstance(route, str),
                 "Supply the original public payment object, HTTPS origin and route.")
            selection = {"build": identifier(build), "payment": payment, "origin": origin, "path": route}
            need(len(json_bytes(selection)) <= 131072, "Merchant selection exceeds 128 KiB.")
            root, request, key, result = self._merchant_request("prepare", selection, request_id)
            if result is not None:
                return result
            work = request / "work"
            if not (request / "prepared.json").exists():
                directory(work)
                prepared = work / "prepared"
                if prepared.exists():
                    try:
                        self._merchant_files(prepared)
                    except (InputError, FileNotFoundError, ValueError):
                        self._merchant_incomplete(prepared)
                if not prepared.exists():
                    self.prepare_merchant(build, payment, origin, route, prepared)
                native = self._merchant_native_status(prepared)
                need(native["build"] == build and native["source"] == self.build_view(build)["source"]
                     and native["plan"] == self.build_view(build)["plan"],
                     "The original compiler returned a different selected build.")
                need(read_json(prepared / "payment.json") == payment,
                     "The original prepared payment terms differ from this request.")
                self._merchant_sync(prepared)
            return self._merchant_finish(root, request, key, work)

    def receive_merchant(self, archive):
        archive = Path(archive).expanduser().absolute()
        with self.mutex:
            original = identity(archive, MAX_PACKAGE)
            root, request, key, result = self._merchant_request("receive", original)
            if result is not None:
                return result
            work = request / "work"
            if not (request / "prepared.json").exists():
                directory(work)
                retained = work / "merchant.zip"
                if not retained.exists():
                    with publication_stage(retained) as (out, temporary):
                        copy_to(archive, out, MAX_PACKAGE)
                        need(identity(temporary, MAX_PACKAGE) == original, "The complete merchant upload changed.")
                        publish_stage(out, temporary, retained)
                need(identity(retained, MAX_PACKAGE) == original, "The retained upload differs from the selected complete ZIP.")
                prepared = work / "prepared"
                if not prepared.exists():
                    temporary = Path(tempfile.mkdtemp(prefix=".receive-", dir=work))
                    try:
                        with zipfile.ZipFile(retained) as packet:
                            infos = packet.infolist()
                            need(len(infos) == len(MEMBERS) and {entry.filename for entry in infos} == set(MEMBERS),
                                 "Receive the complete original sixteen-file NDJSON merchant ZIP.")
                            need(sum(entry.file_size for entry in infos) <= MAX_PACKAGE,
                                 "The expanded merchant exceeds 4 GiB.")
                            directory(temporary / "customer")
                            for entry in infos:
                                need(not entry.is_dir() and not entry.flag_bits & 1 and
                                     entry.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} and
                                     stat.S_IFMT(entry.external_attr >> 16) in {0, stat.S_IFREG} and
                                     0 <= entry.file_size <= (1024 * 1024 if entry.filename == "merchant.json" else MAX_FILE),
                                     "A merchant archive member has an unsupported type or size.")
                                with packet.open(entry) as inp, os.fdopen(os.open(temporary / entry.filename,
                                        os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                                    count = 0
                                    for block in iter(lambda: inp.read(1048576), b""):
                                        count += len(block)
                                        need(count <= entry.file_size, "Merchant member exceeds its declared bytes.")
                                        out.write(block)
                                    need(count == entry.file_size, "Merchant member is incomplete.")
                                    out.flush()
                                    os.fsync(out.fileno())
                        self._merchant_files(temporary)
                        self._merchant_native_status(temporary)
                        sync_dir(temporary / "customer")
                        sync_dir(temporary)
                        os.rename(temporary, prepared)
                        sync_dir(work)
                    finally:
                        if temporary.exists():
                            shutil.rmtree(temporary)
                manifest = self._merchant_files(prepared)
                expected = read_json(prepared / "ndjson-lineage.json")
                need(expected.get("schema") == self.build_schema and expected.get("id") == manifest["build"]
                     and expected.get("source") == manifest["source"] and expected.get("plan") == manifest["plan"]
                     and expected["files"]["data.csv"] == manifest["files"]["data.csv"]
                     and expected["files"]["dataset.json"] == manifest["files"]["dataset.json"]
                     and expected["native"]["snapshot"] == manifest["snapshot"],
                     "The merchant source, projection and native lineage are not one build.")
                with opened(prepared / "source.ndjson") as (stream, _):
                    source = self.add_source(stream, "Received merchant source", "source.ndjson")
                plan = self.save_plan(read_json(prepared / "plan.json"))
                need(source["id"] == manifest["source"] and plan["id"] == manifest["plan"],
                     "The received merchant source or normalized mapping differs.")
                rebuilt = self.build(source["id"], plan["id"], expected=expected)
                need(rebuilt["id"] == manifest["build"], "The received merchant build identity differs.")
            return self._merchant_finish(root, request, key, work)

    @contextmanager
    def merchant_download(self, package_id):
        """Keep the original read handle open while releasing the writer mutex."""
        with ExitStack() as resources:
            with self.mutex:
                self._merchant_verify(package_id)
                stream, info = resources.enter_context(opened(
                    self.root / "merchants" / package_id / "merchant.zip", MAX_PACKAGE))
            yield stream, info

    def merchant_archive(self, package_id):
        # Return an immutable path after the original lock is released. HTTP
        # download opens the same verified inode and does not retain the mutex.
        with self.mutex:
            self._merchant_verify(package_id)
            return self.root / "merchants" / package_id / "merchant.zip"

    def export_merchant(self, package_id, output):
        # The CLI shares the same original writer lease/mutex. HTTP downloads
        # use merchant_download and release the mutex before streaming.
        with self.mutex:
            source = self.merchant_archive(package_id)
            expected = identity(source, MAX_PACKAGE)
            output = Path(output).expanduser().absolute()
            if output.exists() or output.is_symlink():
                need(identity(output, MAX_PACKAGE) == expected, "The output already contains a different merchant.")
                return {"file": str(output), **expected, "package": package_id}
            with publication_stage(output) as (out, temporary):
                copy_to(source, out, MAX_PACKAGE)
                need(identity(temporary, MAX_PACKAGE) == expected, "The merchant changed during export.")
                try:
                    publish_stage(out, temporary, output)
                except FileExistsError:
                    need(identity(output, MAX_PACKAGE) == expected, "A concurrent output contains different bytes.")
            return {"file": str(output), **expected, "package": package_id}
