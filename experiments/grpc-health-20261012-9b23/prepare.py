#!/usr/bin/env python3
"""Prepare the original gRPC service-health inputs from existing local Git objects.

Adapted from the original 6F7C source materializer; the source, driver, census
and operation constants select this complementary service-health continuation.

Python 3.10+ on POSIX, with Git 2.29+. No network, dependency installation,
native-host import, application command, queue mutation, or job registration.

First use:
  python3 -B prepare.py --checkout /existing/public-commons-sprint-2026 \
    --root /private/grpc-service-health \
    --native-checkout /existing/commons

Repeat a completed preparation to verify it. Add --resume to continue an
incomplete selection in that same root, with the same options. Failed partial
files remain under .grpc-source-staging; no source, results, or jobs are removed.
The caller still owns the original native operation and its placement.
"""
import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid

OPERATION = "SCF-GRPC-SERVICE-HEALTH-20261012-9B23"
COMMIT = "41f2254cd1ac3e9b8025bb41a63e7bbc866e762f"
DRIVER = "c86da173d75ca89085f1269c3d72c715cac9aa2e"
NATIVE_MANIFEST = "4410a170e653557bbd60c16282babf3db0ae15d4"
NATIVE_IDENTITY = "136c70426e445c3a4d03ed1ada7419383f11d4798f1c58f14a9f6aa2a96af737"
EXPECTED_FILES, EXPECTED_BYTES = 8078, 134196141
MAX_FILE, CHUNK = 32 * 1024 * 1024, 1024 * 1024
MAX_SELECTION = 4 * 1024 * 1024
MARKER = ".grpc-service-health-source-selection.json"
STAGING = ".grpc-source-staging"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
PROTECTED = ("source", "payload", "journey.mjs", "operation-source.json",
             "native-host", "native-host-selection.json", STAGING)


class PreparationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise PreparationError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def exists(path):
    try:
        path.lstat()
        return True
    except FileNotFoundError:
        return False


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def directory(path, create=False):
    """Reject links at every ancestor; only create the selected leaf."""
    path = Path(os.path.abspath(path))
    for parent in reversed(path.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode), "Directory ancestor is not an ordinary directory: " + str(parent))
    if create:
        try:
            path.mkdir(mode=0o700)
            sync_dir(path.parent)
        except FileExistsError:
            pass
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode), "Expected an ordinary directory: " + str(path))
    return path


def parents(root, key):
    current = root
    for name in PurePosixPath(key).parts[:-1]:
        current = directory(current / name, create=True)
    return current


def path_key(value):
    require(isinstance(value, str) and value and "\0" not in value,
            "The source contains an invalid path.")
    require(not value.startswith("/") and all(part not in ("", ".", "..") for part in value.split("/")),
            "The source contains an unsafe path: " + repr(value))
    require(str(PurePosixPath(value)) == value, "The source path is not canonical: " + repr(value))
    return value


def state_tuple(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_regular(path, limit=MAX_FILE, collect=True, mode=None):
    directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit,
                "Expected a bounded regular file: " + str(path))
        if mode is not None:
            require(stat.S_IMODE(before.st_mode) == mode, "The selected file mode changed: " + str(path))
        one = hashlib.sha1(b"blob " + str(before.st_size).encode("ascii") + b"\0")
        two = hashlib.sha256()
        chunks, received = [], 0
        while True:
            piece = os.read(fd, CHUNK)
            if not piece:
                break
            received += len(piece)
            require(received <= limit, "File grew beyond its selected bound: " + str(path))
            one.update(piece)
            two.update(piece)
            if collect:
                chunks.append(piece)
        after = os.fstat(fd)
        named = path.lstat()
        require(received == before.st_size and state_tuple(before) == state_tuple(after)
                and state_tuple(after) == state_tuple(named),
                "File changed during the source read: " + str(path))
        return {"bytes": received, "sha": one.hexdigest(), "sha256": two.hexdigest(),
                "content": b"".join(chunks) if collect else None}
    finally:
        os.close(fd)


def verify_file(path, selected):
    value = read_regular(path, selected["bytes"], collect=False, mode=selected["mode"])
    require(value["bytes"] == selected["bytes"] and value["sha"] == selected["sha"],
            "An existing selected file differs; it was preserved: " + str(path))
    return value


def publish_stream(staging, target, stream, selected):
    """Verify a retained partial's exact prefix, append, then publish create-only."""
    directory(target.parent)
    prior = exists(target)
    if prior:
        verify_file(target, selected)
    # One selected partial survives a failed invocation. Explicit --resume is
    # admitted by owning_root before this function can revisit incomplete work.
    temporary = staging / (selected["sha"] + "." + format(selected["mode"], "o") +
                           "." + str(selected["bytes"]) + ".part")
    fd = None
    before = None
    retained_bytes = 0
    one = hashlib.sha1(b"blob " + str(selected["bytes"]).encode("ascii") + b"\0")
    received = 0
    try:
        if exists(temporary):
            fd = os.open(temporary, (os.O_RDONLY if prior else os.O_RDWR) |
                         os.O_NOFOLLOW | os.O_NONBLOCK)
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
                    and before.st_size <= selected["bytes"],
                    "The retained selected partial is not a bounded owned regular file: " + str(temporary))
            require(prior or before.st_nlink == 1,
                    "A selected partial has another hard link; it was preserved without mutation: " + str(temporary))
            retained_bytes = before.st_size
        elif not prior:
            fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL |
                         os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
            before = os.fstat(fd)
        while received < selected["bytes"]:
            piece = stream.read(min(CHUNK, selected["bytes"] - received))
            require(piece, "Truncated selected content for " + str(target))
            overlap = min(len(piece), max(0, retained_bytes - received))
            if overlap:
                matched = 0
                while matched < overlap:
                    old = os.read(fd, overlap - matched)
                    require(old and old == piece[matched:matched + len(old)],
                            "Retained partial differs from the exact Git prefix; it was preserved: " + str(temporary))
                    matched += len(old)
            if fd is not None and not prior and overlap < len(piece):
                # Every preexisting byte has matched before the first append.
                require(received + overlap >= retained_bytes, "Partial-prefix verification is incomplete.")
                view = memoryview(piece)[overlap:]
                while view:
                    written = os.write(fd, view)
                    require(written, "Could not append selected content: " + str(target))
                    view = view[written:]
            received += len(piece)
            one.update(piece)
        require(one.hexdigest() == selected["sha"], "Git blob mismatch for " + str(target))
        if fd is not None:
            after = os.fstat(fd)
            require(state_tuple(after) == state_tuple(temporary.lstat()),
                    "The selected partial path changed during preparation.")
            if prior:
                require(state_tuple(before) == state_tuple(after),
                        "The retained partial changed during prefix verification.")
            else:
                require(after.st_size == selected["bytes"] and after.st_nlink == 1,
                        "Selected partial size or links changed during preparation.")
                os.fchmod(fd, selected["mode"])
                os.fsync(fd)
                expected_inode = os.fstat(fd)
                try:
                    os.link(temporary, target, follow_symlinks=False)
                    named = target.lstat()
                    require((named.st_dev, named.st_ino) == (expected_inode.st_dev, expected_inode.st_ino),
                            "Create-only target does not name the selected complete bytes.")
                except FileExistsError:
                    verify_file(target, selected)
            sync_dir(target.parent)
            os.close(fd)
            fd = None
            # This exact verified partial is now obsolete. The complete source
            # and unrelated staging, runtime results and jobs remain unchanged.
            temporary.unlink()
            sync_dir(staging)
        return received
    finally:
        if fd is not None:
            os.close(fd)


def publish_bytes(staging, target, data, mode=0o600):
    require(len(data) <= MAX_FILE, "Bounded source metadata exceeded its limit.")
    return publish_stream(staging, target, io.BytesIO(data),
                          {"bytes": len(data), "sha": blob(data), "mode": mode})


def selected_marker(native):
    return {"schema": "stellar-forge.grpc-service-health-materializer-selection.v1",
            "operation": OPERATION, "source_commit": COMMIT, "driver_git_blob": DRIVER,
            "source_files": EXPECTED_FILES, "source_bytes": EXPECTED_BYTES,
            "native_manifest_git_blob": NATIVE_MANIFEST if native else None}


@contextlib.contextmanager
def owning_root(path, native, resume):
    root = directory(Path(os.path.expanduser(path)), create=True)
    info = root.lstat()
    require(info.st_uid == os.geteuid() and not (stat.S_IMODE(info.st_mode) & 0o077),
            "--root must be an existing private directory (mode 0700), or a new directory under an existing parent.")
    fd = os.open(root / ".grpc-service-health-source.lock",
                 os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "The source lock is not a regular file.")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise PreparationError("Another preparation owns this same root; let it finish before continuing.") from None
        marker = root / MARKER
        selection = encoded(selected_marker(native))
        complete = exists(root / "operation-source.json")
        if exists(marker):
            require(read_regular(marker, 16384)["content"] == selection,
                    "This root belongs to a different selection. Keep its original source and options.")
            require(complete or resume,
                    "Incomplete preparation retained here. Use the same arguments plus --resume to continue.")
        else:
            require(not any(exists(root / name) for name in PROTECTED),
                    "Selected output already exists without its ownership marker; no files were adopted or replaced.")
            # The marker precedes every source, payload, Git view and driver write.
            temp = root / (MARKER + "." + uuid.uuid4().hex + ".part")
            with open(temp, "xb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(selection)
                handle.flush()
                os.fsync(handle.fileno())
            os.link(temp, marker, follow_symlinks=False)
            sync_dir(root)
            temp.unlink()
            sync_dir(root)
        staging = directory(root / STAGING, create=True)
        yield root, staging, complete
    finally:
        os.close(fd)  # Kernel releases the advisory lock; never unlink its stable name.


class LocalGit:
    """Private read-only object view: no checkout writes or remote configuration."""
    def __init__(self, checkout, staging, label):
        self.env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_ATTR_NOSYSTEM="1", GIT_NO_LAZY_FETCH="1",
                        GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
        checkout = Path(checkout).expanduser().resolve(strict=True)
        require(checkout.is_dir(), "--checkout must name an existing local repository directory.")
        common = self.command(["git", "-C", str(checkout), "rev-parse", "--git-common-dir"]).decode("utf-8").strip()
        common = (checkout / common).resolve(strict=True) if not os.path.isabs(common) else Path(common).resolve(strict=True)
        objects = (common / "objects").resolve(strict=True)
        require(objects.is_dir() and "\n" not in str(objects) and "\r" not in str(objects),
                "The original Git object directory is unavailable or cannot be represented as an alternate.")
        # A separate bare view makes the source byte selection independent of
        # local replacement refs, filters, remotes and repository export attrs.
        self.path = staging / (label + "-objects-" + uuid.uuid4().hex)
        self.command(["git", "init", "--quiet", "--bare", "--template=", "--object-format=sha1", str(self.path)])
        (self.path / "objects/info/alternates").write_text(str(objects) + "\n", encoding="utf-8")
        (self.path / "info/attributes").write_text("* -export-ignore -export-subst\n** -export-ignore -export-subst\n", encoding="utf-8")
        self.prefix = ["git", "--no-replace-objects", "--git-dir=" + str(self.path),
                       "-c", "core.attributesFile=" + os.devnull, "-c", "tar.umask=0022"]
        # info/attributes has highest precedence. See the original Git manuals:
        # https://git-scm.com/docs/git-archive#_attributes
        # https://git-scm.com/docs/gitattributes

    def command(self, args, limit=16 * 1024 * 1024):
        value = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=self.env, timeout=180, check=False)
        require(value.returncode == 0,
                "Local Git source read failed: " + value.stderr[-16384:].decode("utf-8", "replace"))
        require(len(value.stdout) <= limit, "Local Git metadata exceeded its declared bound.")
        return value.stdout

    def git(self, *args, limit=16 * 1024 * 1024):
        return self.command(self.prefix + list(args), limit=limit)

    def object_bytes(self, sha):
        require(HEX40.fullmatch(sha), "Invalid selected Git blob.")
        require(self.git("cat-file", "-t", sha).strip() == b"blob", "Selected object is not a Git blob: " + sha)
        size = int(self.git("cat-file", "-s", sha).strip())
        require(0 <= size <= MAX_FILE, "Selected Git blob exceeds 32 MiB: " + sha)
        data = self.git("cat-file", "blob", sha, limit=MAX_FILE)
        require(len(data) == size and blob(data) == sha, "Selected Git object bytes changed: " + sha)
        return data

    def source_tree(self):
        require(self.git("rev-parse", "--verify", COMMIT + "^{commit}").strip().decode("ascii") == COMMIT,
                "The exact selected source commit is not available.")
        raw = self.git("ls-tree", "-r", "-z", "-l", "--full-tree", COMMIT)
        require(raw.endswith(b"\0"), "The selected Git tree is incomplete.")
        result = {}
        for record in raw[:-1].split(b"\0"):
            metadata, name = record.split(b"\t", 1)
            mode, kind, sha, size = metadata.split()
            key = path_key(name.decode("utf-8", "strict"))
            require(key not in result and mode in (b"100644", b"100755") and kind == b"blob",
                    "The selected tree is not unique regular source: " + key)
            text_sha, length = sha.decode("ascii"), int(size)
            require(HEX40.fullmatch(text_sha) and 0 <= length <= MAX_FILE,
                    "Invalid source identity or file larger than 32 MiB: " + key)
            result[key] = {"sha": text_sha, "bytes": length, "mode": int(mode, 8) & 0o777}
        require(len(result) == EXPECTED_FILES and sum(row["bytes"] for row in result.values()) == EXPECTED_BYTES,
                "The selected commit does not match the complete 7,800-file / 128,913,424-byte source census.")
        return dict(sorted(result.items()))

    def archive(self, source, staging, selected):
        expected_dirs = directory_keys(selected)
        seen_files, seen_dirs = set(), set()
        with tempfile.TemporaryFile(dir=staging) as error_output:
            process = subprocess.Popen(self.prefix + ["archive", "--format=tar", COMMIT],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=error_output, env=self.env)
            try:
                with tarfile.open(fileobj=process.stdout, mode="r|", encoding="utf-8", errors="strict") as archive:
                    for member in archive:
                        key = path_key(member.name.rstrip("/") if member.isdir() else member.name)
                        if member.isdir():
                            require(key in expected_dirs and key not in seen_dirs,
                                    "Unexpected or duplicate archive directory: " + key)
                            seen_dirs.add(key)
                            parents(source, key + "/leaf")
                            continue
                        require(member.isreg() and key in selected and key not in seen_files,
                                "Unexpected, duplicate or nonregular archive member: " + key)
                        row = selected[key]
                        require(member.size == row["bytes"] and (member.mode & 0o7777) == row["mode"],
                                "Archive size or mode differs from the original Git tree: " + key)
                        parents(source, key)
                        with archive.extractfile(member) as stream:
                            publish_stream(staging, source / key, stream, row)
                        seen_files.add(key)
                    require(archive.pax_headers.get("comment") == COMMIT, "Archive does not identify the selected original commit.")
                process.stdout.close()
                code = process.wait(timeout=30)
                error_output.seek(0)
                require(code == 0, "Git archive failed: " + error_output.read(16384).decode("utf-8", "replace"))
                require(seen_files == set(selected) and seen_dirs == expected_dirs,
                        "The archive omitted part of the selected original source tree.")
            finally:
                process.stdout.close()
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)


def directory_keys(selected):
    result = set()
    for key in selected:
        parts = key.split("/")
        result.update("/".join(parts[:index]) for index in range(1, len(parts)))
    require(not result.intersection(selected), "The selected source contains a file/directory collision.")
    return result


def verify_tree(root, selected, complete):
    expected_dirs, found = directory_keys(selected), set()
    directory(root)
    def visit(current):
        for entry in sorted(os.scandir(current), key=lambda item: item.name):
            key = (Path(entry.path).relative_to(root)).as_posix()
            info = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                require(key in expected_dirs, "Unexpected source directory was preserved: " + key)
                visit(Path(entry.path))
            else:
                require(stat.S_ISREG(info.st_mode) and key in selected,
                        "Unexpected or nonregular source entry was preserved: " + key)
                verify_file(Path(entry.path), selected[key])
                found.add(key)
    visit(root)
    if complete:
        require(found == set(selected), "Completed source is missing selected files; no output was repaired or replaced.")
    return len(found)


def native_selection(git):
    data = git.object_bytes(NATIVE_MANIFEST)
    value = json.loads(data)
    require(value.get("schema") == "commons.native-runtime-source-selection.v1"
            and value.get("repository") == "woahwhattheheck/commons"
            and value.get("file_count") == 71
            and value.get("expected_native_identity") == {"sha256": NATIVE_IDENTITY, "module_count": 34}
            and isinstance(value.get("files"), list) and len(value["files"]) == 71,
            "The original native source manifest contract differs.")
    rows = {}
    for item in value["files"]:
        key = path_key(item["path"])
        require(key not in rows and HEX40.fullmatch(item["sha"])
                and item["mode"] in ("0o644", "0o755"), "Invalid original native source selection: " + key)
        require(git.git("cat-file", "-t", item["sha"]).strip() == b"blob",
                "Native source is not an available local blob: " + key)
        length = int(git.git("cat-file", "-s", item["sha"]).strip())
        require(0 <= length <= MAX_FILE, "Native source file exceeds its bound: " + key)
        rows[key] = {"sha": item["sha"], "bytes": length, "mode": int(item["mode"], 8)}
    directory_keys(rows)
    return data, value, dict(sorted(rows.items()))


def prepare(args):
    with owning_root(args.root, bool(args.native_checkout), args.resume) as (root, staging, complete):
        git = LocalGit(args.checkout, staging, "product")
        selected = git.source_tree()
        driver = git.object_bytes(DRIVER)
        require(len(driver) == 47708, "The reviewed original journey has an unexpected byte length.")
        selection = encoded({"operation": OPERATION, "commit": COMMIT,
                             "files": {key: row["sha"] for key, row in selected.items()}, "patches": []})
        require(len(selection) <= MAX_SELECTION, "The full source selection does not fit the original driver.")
        native_git = native_manifest = native_manifest_value = native_rows = None
        if args.native_checkout:
            native_git = LocalGit(args.native_checkout, staging, "native")
            native_manifest, native_manifest_value, native_rows = native_selection(native_git)

        receipt = {"schema": "stellar-forge.grpc-service-health-operation-source.v1", "state": "COMPLETE",
                   "operation": OPERATION, "source_commit": COMMIT, "driver_git_blob": DRIVER,
                   "driver_bytes": len(driver), "driver_sha256": sha256(driver),
                   "selection_sha256": sha256(selection), "source_files": len(selected),
                   "source_bytes": sum(item["bytes"] for item in selected.values()),
                   "source_tree_sha256": sha256(encoded(selected)),
                   "source": "source", "payload": "payload", "driver": "journey.mjs",
                   "native_host": None}
        if native_rows is not None:
            receipt["native_host"] = {"directory": "native-host", "manifest_git_blob": NATIVE_MANIFEST,
                                     "manifest_sha256": sha256(native_manifest), "files": len(native_rows),
                                     "bytes": sum(row["bytes"] for row in native_rows.values()),
                                     "tree_sha256": sha256(encoded(native_rows)),
                                     "expected_native_identity": native_manifest_value["expected_native_identity"],
                                     "runtime_imported": False}
        receipt_bytes = encoded(receipt)

        if complete:
            require(read_regular(root / "operation-source.json", MAX_SELECTION)["content"] == receipt_bytes,
                    "The completed source receipt differs from this exact selection.")
            verify_tree(root / "source", selected, True)
            require(read_regular(root / "payload/selection.json", MAX_SELECTION)["content"] == selection,
                    "The completed application selection changed.")
            require(read_regular(root / "journey.mjs", MAX_FILE, mode=0o755)["content"] == driver,
                    "The completed original driver changed.")
            if native_rows is not None:
                verify_tree(root / "native-host", native_rows, True)
                require(read_regular(root / "native-host-selection.json", MAX_FILE)["content"] == native_manifest,
                        "The selected original native manifest changed.")
            return receipt, True

        source = directory(root / "source", create=True)
        verify_tree(source, selected, False)
        git.archive(source, staging, selected)
        verify_tree(source, selected, True)
        if native_rows is not None:
            host = directory(root / "native-host", create=True)
            verify_tree(host, native_rows, False)
            for key, row in native_rows.items():
                parents(host, key)
                data = native_git.object_bytes(row["sha"])
                require(len(data) == row["bytes"], "Native source size changed: " + key)
                publish_stream(staging, host / key, io.BytesIO(data), row)
            verify_tree(host, native_rows, True)
            publish_bytes(staging, root / "native-host-selection.json", native_manifest)
        payload = directory(root / "payload", create=True)
        require(all(entry.name == "selection.json" for entry in os.scandir(payload)),
                "Payload contains another retained selection; nothing was replaced.")
        publish_bytes(staging, payload / "selection.json", selection)
        publish_bytes(staging, root / "journey.mjs", driver, 0o755)
        # Final create-only publication follows all source/metadata verification.
        # The stable receipt has no regenerated timestamp or machine-specific path.
        publish_bytes(staging, root / "operation-source.json", receipt_bytes)
        sync_dir(root)
        return receipt, False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkout", required=True, help="Existing public-commons-sprint-2026 Git objects.")
    parser.add_argument("--root", required=True, help="Private retained task root; its parent must already exist.")
    parser.add_argument("--native-checkout", help="Optional existing Commons objects for the exact original 71-file native source.")
    parser.add_argument("--resume", action="store_true", help="Continue this same incomplete owned source selection.")
    args = parser.parse_args()
    try:
        receipt, reused = prepare(args)
        print(json.dumps({"state": "COMPLETE", "reused": reused,
                          "root": str(Path(args.root).expanduser().absolute()), "receipt": receipt}, sort_keys=True))
    except (PreparationError, OSError, ValueError, tarfile.TarError,
            subprocess.SubprocessError, KeyboardInterrupt) as issue:
        print(json.dumps({"state": "INCOMPLETE", "operation": OPERATION,
                          "message": str(issue) or type(issue).__name__,
                          "continuation": "Keep this root and its partials; repeat the same arguments with --resume.",
                          "application_started": False}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
