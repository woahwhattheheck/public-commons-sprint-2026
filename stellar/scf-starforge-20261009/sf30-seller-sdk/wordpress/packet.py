"""MIT. Portable WordPress source workspaces; native publishers stay with their host."""
from __future__ import annotations
import argparse
import base64
import csv
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zipfile

SCHEMA = "stellar-forge.wordpress-source-packet.v1"
WORKSPACE_SCHEMA = "stellar-forge.wordpress-workspace.v1"
MANIFEST = "wordpress-source.json"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
HASH = r"[0-9a-f]{64}"
MAX_FILE = 536_870_912
MAX_TOTAL = 4_294_967_296
MAX_FILES = 100_000
CHUNK_BYTES = 49_152

class PacketError(ValueError):
    pass

def require(value, message):
    if not value:
        raise PacketError(message)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")

def safe_name(name):
    require(isinstance(name, str) and name and len(name) <= 500 and "\\" not in name and "\0" not in name,
            "WORDPRESS_PACKET_PATH")
    require(not PurePosixPath(name).is_absolute() and all(p not in ("", ".", "..") for p in name.split("/")),
            "WORDPRESS_PACKET_PATH")
    return name

def allowed(name):
    safe_name(name)
    if name == "workspace.json":
        return True
    if re.fullmatch(r"(sources|mappings|merchants)/" + UUID + r"\.json", name):
        return True
    if re.fullmatch(r"cache/" + HASH + r"/source\.json", name):
        return True
    if re.fullmatch(r"cache/" + HASH + r"/jobs/" + UUID + r"/(intent|progress|complete)\.json", name):
        return True
    if re.fullmatch(r"cache/" + HASH + r"/jobs/" + UUID + r"/responses/[0-9]{7}\.json", name):
        return True
    if re.fullmatch(r"editions/" + UUID + r"/(intent\.json|schema\.csv|dataset\.csv|dataset\.json|source\.json|edition\.json|records\.json)", name):
        return True
    if re.fullmatch(r"exports/" + UUID + r"/(dataset\.csv|dataset\.json|source\.json|seller\.json|manifest\.json)", name):
        return True
    match = re.fullmatch(r"exports/" + UUID + r"/wordpress/(.+)", name)
    return bool(match and allowed(match.group(1)))

def private_directory(path, create=False):
    path = Path(os.path.abspath(path))
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.resolve(strict=True) == path, "WORDPRESS_PACKET_CANONICAL_DIRECTORY")
    value = path.lstat()
    require(stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode) and not value.st_mode & 0o077,
            "WORDPRESS_PACKET_PRIVATE_DIRECTORY")
    return path

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def opened(path, maximum=MAX_FILE):
    require(path.resolve(strict=True) == path, "WORDPRESS_PACKET_SOURCE_PATH")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    value = os.fstat(fd)
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or value.st_mode & 0o077 or value.st_size > maximum:
        os.close(fd)
        raise PacketError("WORDPRESS_PACKET_PRIVATE_FILE")
    return os.fdopen(fd, "rb")

def hash_file(path, maximum=MAX_FILE):
    with opened(path, maximum=maximum) as stream:
        before = os.fstat(stream.fileno())
        digest, length = hashlib.sha256(), 0
        while raw := stream.read(1_048_576):
            length += len(raw)
            digest.update(raw)
        after = os.fstat(stream.fileno())
    require(length == before.st_size and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "WORDPRESS_PACKET_SOURCE_CHANGED")
    return {"bytes": length, "sha256": digest.hexdigest()}

def atomic(path, raw):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".pending-wordpress-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def projection(workspace):
    result = json.loads(json.dumps(workspace))
    result["operations"] = []
    result["packets"] = []
    result["exports"] = [row for row in result.get("exports", []) if row.get("delivery") != "source-files"]
    result["receivedFrom"] = result.get("receivedFrom")
    return result

def selected_files(root, workspace):
    export_ids = {row["id"] for row in workspace["exports"]}
    result = []
    for folder in ("sources", "cache", "mappings", "editions", "merchants", "exports"):
        path = root / folder
        if not path.exists():
            continue
        for current, directories, files in os.walk(path, followlinks=False):
            for name in directories:
                require(not (Path(current) / name).is_symlink(), "WORDPRESS_PACKET_SOURCE_LINK")
            for name in files:
                if name == "publisher.lock" or name.startswith(".pending-"):
                    continue
                member = (Path(current) / name).relative_to(root).as_posix()
                if folder == "exports" and member.split("/")[1] not in export_ids:
                    continue
                require(allowed(member), "WORDPRESS_PACKET_UNDECLARED_SOURCE:" + member)
                result.append(member)
    return sorted(result)

def create(root, output, request):
    root = private_directory(root)
    output = Path(os.path.abspath(output))
    private_directory(output.parent, create=True)
    require(output.parent != root or output.name != "workspace.json", "WORDPRESS_PACKET_OUTPUT")
    with opened(root / "workspace.json") as stream:
        original = stream.read()
    original_hash = hashlib.sha256(original).hexdigest()
    require(original_hash == request.get("workspaceSha256"), "WORDPRESS_PACKET_WORKSPACE_CHANGED")
    value = json.loads(original)
    require(value.get("schema") == WORKSPACE_SCHEMA and re.fullmatch(UUID, value.get("id", "")),
            "WORDPRESS_PACKET_WORKSPACE_SCHEMA")
    require(value["id"] == request.get("workspaceId") and value["revision"] == request.get("revision"),
            "WORDPRESS_PACKET_WORKSPACE_CHANGED")
    portable = projection(value)
    portable_bytes = json_bytes(portable)
    members = [{"path": "workspace.json", "bytes": len(portable_bytes),
                "sha256": hashlib.sha256(portable_bytes).hexdigest()}]
    for name in selected_files(root, portable):
        members.append({"path": name, **hash_file(root / name)})
    require(len(members) <= MAX_FILES and sum(item["bytes"] for item in members) <= MAX_TOTAL,
            "WORDPRESS_PACKET_SIZE")
    manifest = {"schema": SCHEMA, "workspaceId": value["id"], "revision": value["revision"],
                "createdAt": request["createdAt"], "operationId": request["operationId"],
                "sourceWorkspaceSha256": original_hash, "files": members}
    manifest_bytes = json_bytes(manifest)
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    if output.exists():
        previous = inspect(output)
        require(previous["manifestSha256"] == manifest_sha, "WORDPRESS_PACKET_OUTPUT_CONFLICT")
        return previous
    fd, temporary = tempfile.mkstemp(prefix=".pending-wordpress-", suffix=".zip", dir=output.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            def put(name, source, expected):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                digest, length = hashlib.sha256(), 0
                with archive.open(info, "w", force_zip64=True) as target:
                    while raw := source.read(1_048_576):
                        digest.update(raw); length += len(raw); target.write(raw)
                require(length == expected["bytes"] and digest.hexdigest() == expected["sha256"], "WORDPRESS_PACKET_SOURCE_CHANGED")
            import io
            put(MANIFEST, io.BytesIO(manifest_bytes), {"bytes": len(manifest_bytes), "sha256": manifest_sha})
            for member in members:
                if member["path"] == "workspace.json":
                    put(member["path"], io.BytesIO(portable_bytes), member)
                else:
                    with opened(root / member["path"]) as source:
                        put(member["path"], source, member)
        require(hash_file(root / "workspace.json")["sha256"] == original_hash, "WORDPRESS_PACKET_WORKSPACE_CHANGED")
        with open(temporary, "rb") as stream:
            os.fsync(stream.fileno())
        os.link(temporary, output)
        sync(output.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return inspect(output)

def read_archive(path):
    path = Path(os.path.abspath(path))
    source = opened(path, maximum=MAX_TOTAL + 67_108_864)
    try:
        archive = zipfile.ZipFile(source)
        infos = archive.infolist()
        require(1 < len(infos) <= MAX_FILES + 1, "WORDPRESS_PACKET_MEMBERS")
        names = [info.filename for info in infos]
        require(len(names) == len(set(names)) and MANIFEST in names, "WORDPRESS_PACKET_DUPLICATES")
        require(sum(info.file_size for info in infos) <= MAX_TOTAL + 67_108_864, "WORDPRESS_PACKET_SIZE")
        for info in infos:
            require(not info.is_dir() and not info.flag_bits & 1 and info.file_size <= MAX_FILE,
                    "WORDPRESS_PACKET_MEMBER_KIND")
            mode = info.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG) and (info.filename == MANIFEST or allowed(info.filename)),
                    "WORDPRESS_PACKET_MEMBER_PATH")
        raw = archive.read(MANIFEST)
        value = json.loads(raw)
        require(value.get("schema") == SCHEMA and re.fullmatch(UUID, value.get("workspaceId", "")),
                "WORDPRESS_PACKET_SCHEMA")
        require(type(value.get("revision")) is int and value["revision"] >= 0, "WORDPRESS_PACKET_REVISION")
        members = value.get("files")
        require(isinstance(members, list) and members, "WORDPRESS_PACKET_MANIFEST")
        expected = {}
        for item in members:
            require(isinstance(item, dict) and allowed(item.get("path", "")) and item["path"] not in expected,
                    "WORDPRESS_PACKET_MANIFEST_PATH")
            require(type(item.get("bytes")) is int and 0 <= item["bytes"] <= MAX_FILE and re.fullmatch(HASH, item.get("sha256", "")),
                    "WORDPRESS_PACKET_MANIFEST_METADATA")
            expected[item["path"]] = item
        require(set(names) == set(expected) | {MANIFEST} and "workspace.json" in expected, "WORDPRESS_PACKET_INVENTORY")
        for name, item in expected.items():
            digest, length = hashlib.sha256(), 0
            with archive.open(name) as stream:
                while data := stream.read(1_048_576):
                    length += len(data); digest.update(data)
            require(length == item["bytes"] and digest.hexdigest() == item["sha256"], "WORDPRESS_PACKET_MEMBER_CHANGED:" + name)
        workspace = json.loads(archive.read("workspace.json"))
        require(workspace.get("schema") == WORKSPACE_SCHEMA and workspace.get("id") == value["workspaceId"] and
                workspace.get("revision") == value["revision"] and not workspace.get("operations") and not workspace.get("packets"),
                "WORDPRESS_PACKET_WORKSPACE_BINDING")
        return source, archive, value, raw
    except BaseException:
        source.close()
        raise

def inspect(path):
    source, archive, value, raw = read_archive(path)
    try:
        actual = hash_file(Path(os.path.abspath(path)), maximum=MAX_TOTAL + 67_108_864)
        return {"schema": SCHEMA, "path": str(Path(path).absolute()), **actual,
                "manifestSha256": hashlib.sha256(raw).hexdigest(), "manifestBytes": len(raw),
                "workspaceId": value["workspaceId"], "revision": value["revision"],
                "files": len(value["files"]), "sourceBytes": sum(item["bytes"] for item in value["files"]),
                "manifest": value}
    finally:
        archive.close(); source.close()

def restore(path, destination):
    source, archive, manifest, raw = read_archive(path)
    target = Path(os.path.abspath(destination))
    require(str(target) != "/", "WORDPRESS_PACKET_DESTINATION")
    target = private_directory(target, create=True)
    lock = os.open(target / "publisher.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    import fcntl
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = target / ".wordpress-receive.json"
        identity = hashlib.sha256(raw).hexdigest()
        expected_names = {item["path"] for item in manifest["files"]}
        if marker.exists():
            previous = json.loads(marker.read_bytes())
            require(previous.get("manifestSha256") == identity, "WORDPRESS_PACKET_RECEIVE_CONFLICT")
        else:
            require(set(p.name for p in target.iterdir()) <= {"publisher.lock"}, "WORDPRESS_PACKET_DESTINATION_NOT_EMPTY")
            atomic(marker, json_bytes({"schema": SCHEMA, "manifestSha256": identity, "complete": False}))
        reused = 0
        for item in manifest["files"]:
            member = target / item["path"]
            private_directory(member.parent, create=True)
            if member.exists() or member.is_symlink():
                require(hash_file(member) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                        "WORDPRESS_PACKET_RECEIVED_FILE_CHANGED:" + item["path"])
                reused += 1
                continue
            fd, temporary = tempfile.mkstemp(prefix=".pending-wordpress-", dir=member.parent)
            try:
                with os.fdopen(fd, "wb") as output, archive.open(item["path"]) as incoming:
                    while block := incoming.read(1_048_576):
                        output.write(block)
                    output.flush(); os.fsync(output.fileno())
                require(hash_file(Path(temporary)) == {"bytes": item["bytes"], "sha256": item["sha256"]},
                        "WORDPRESS_PACKET_RECEIVED_FILE_CHANGED")
                os.link(temporary, member); sync(member.parent)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        atomic(marker, json_bytes({"schema": SCHEMA, "manifestSha256": identity, "complete": True,
                                   "workspaceId": manifest["workspaceId"], "revision": manifest["revision"]}))
        return {"schema": SCHEMA, "directory": str(target), "workspaceId": manifest["workspaceId"],
                "revision": manifest["revision"], "manifestSha256": identity, "files": len(expected_names),
                "reusedFiles": reused, "complete": True}
    finally:
        os.close(lock); archive.close(); source.close()

def file_projection(path, output_directory):
    source, archive, manifest, raw = read_archive(path)
    output = private_directory(output_directory, create=True)
    manifest_sha = hashlib.sha256(raw).hexdigest()
    intent = {"schema": SCHEMA, "manifestSha256": manifest_sha}
    control = output / "source-file-intent.json"
    if control.exists():
        require(json.loads(control.read_bytes()) == intent, "WORDPRESS_PACKET_PROJECTION_CONFLICT")
    else:
        atomic(control, json_bytes(intent))
    fd, temporary = tempfile.mkstemp(prefix=".pending-wordpress-", suffix=".csv", dir=output)
    columns = ["capture_id","workspace_id","path","file_sha256","file_bytes","chunk_index","chunk_count","chunk_sha256","content_base64"]
    count = 0
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as target:
            writer = csv.writer(target, lineterminator="\n", quoting=csv.QUOTE_ALL)
            writer.writerow(columns)
            members = [{"path": MANIFEST, "bytes": len(raw), "sha256": manifest_sha}] + manifest["files"]
            for item in members:
                chunks = max(1, (item["bytes"] + CHUNK_BYTES - 1) // CHUNK_BYTES)
                with archive.open(item["path"]) as stream:
                    for index in range(chunks):
                        body = stream.read(CHUNK_BYTES)
                        writer.writerow([manifest_sha,manifest["workspaceId"],item["path"],item["sha256"],item["bytes"],
                                         index,chunks,hashlib.sha256(body).hexdigest(),base64.b64encode(body).decode("ascii")])
                        count += 1
                        require(target.tell() <= 268_435_456 and count <= 1_000_000, "WORDPRESS_PACKET_ORIGINAL_DATASET_LIMIT")
            target.flush(); os.fsync(target.fileno())
        if (output / "dataset.csv").exists():
            require(hash_file(Path(temporary)) == hash_file(output / "dataset.csv"), "WORDPRESS_PACKET_PROJECTION_CHANGED")
        else:
            os.link(temporary, output / "dataset.csv"); sync(output)
        return {"captureId": manifest_sha, "workspaceId": manifest["workspaceId"], "rows": count,
                "columns": columns, "csv": hash_file(output / "dataset.csv"), "manifest": manifest, "manifestBytes": len(raw)}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
        archive.close(); source.close()

def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("create"); make.add_argument("--directory", required=True); make.add_argument("--output", required=True)
    check = commands.add_parser("inspect"); check.add_argument("--input", required=True)
    receive = commands.add_parser("restore"); receive.add_argument("--input", required=True); receive.add_argument("--directory", required=True)
    project = commands.add_parser("project"); project.add_argument("--input", required=True); project.add_argument("--directory", required=True)
    args = parser.parse_args()
    if args.command == "create":
        result = create(args.directory, args.output, json.load(sys.stdin))
    elif args.command == "inspect":
        result = inspect(args.input)
    elif args.command == "restore":
        result = restore(args.input, args.directory)
    else:
        result = file_projection(args.input, args.directory)
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
if __name__ == "__main__":
    try:
        main()
    except (PacketError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(json.dumps({"ok": False, "error": {"code": "WORDPRESS_SOURCE_PACKET", "message": str(error)}}))
        sys.exit(1)
