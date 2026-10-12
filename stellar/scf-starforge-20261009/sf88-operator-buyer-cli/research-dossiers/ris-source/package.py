#!/usr/bin/env python3
"""Package and independently read back the complete original RIS operation."""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import uuid
import zipfile
from pathlib import Path, PurePosixPath

SCHEMA = "sf88-research-ris-delivery-v1"
MANIFEST = "DELIVERY_MANIFEST.json"
CHUNK = 1024 * 1024


def need(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def digest(body):
    return hashlib.sha256(body).hexdigest()


def relative(value):
    need(isinstance(value, str) and value and "\\" not in value and "\x00" not in value,
         "A complete relative member path is required")
    parts = value.split("/")
    need(not value.startswith("/") and all(p not in ("", ".", "..") for p in parts)
         and ":" not in parts[0], "Invalid member path: " + value)
    return PurePosixPath(value)


def root_path(value, private=False):
    path = Path(value)
    need(path.is_absolute() and str(path) == str(path.resolve(strict=True)),
         "Use an existing absolute directory without symbolic links")
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode), "Directory required: " + str(path))
    if private:
        need(info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
             "Use the original owned private operation directory")
    return path


def beneath(root, value):
    parts = relative(value).parts
    path = root
    for part in parts:
        path = path / part
        need(not path.is_symlink(), "Symbolic-link member rejected: " + value)
    need(path.parent.resolve(strict=True).is_relative_to(root),
         "Member leaves the selected source root")
    return path


def open_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    stream = os.fdopen(fd, "rb")
    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
        stream.close()
        raise ValueError("Ordinary file required: " + str(path))
    return stream


def read_regular(path):
    with open_regular(path) as stream:
        return stream.read()


def stream_identity(stream):
    count, hasher = 0, hashlib.sha256()
    while True:
        chunk = stream.read(CHUNK)
        if not chunk:
            break
        count += len(chunk)
        hasher.update(chunk)
    return {"bytes": count, "sha256": hasher.hexdigest()}


def file_identity(path):
    with open_regular(path) as stream:
        return stream_identity(stream)


def descriptor(value):
    need(isinstance(value, dict) and type(value.get("bytes")) is int
         and value["bytes"] >= 0 and re.fullmatch(r"[0-9a-f]{64}", value.get("sha256", "")),
         "Complete file byte count and SHA256 are required")
    return {"bytes": value["bytes"], "sha256": value["sha256"]}


def absolute_input(row):
    path = Path(row["file"])
    need(path.is_absolute() and str(path) == str(path.resolve(strict=True)),
         "Use the original absolute input file")
    body = read_regular(path)
    need({"bytes": len(body), "sha256": digest(body)} == descriptor(row),
         "Original input descriptor changed: " + str(path))
    return path, body


def source_mode(value):
    modes = {"100644": "0644", "100755": "0755", "0644": "0644", "0755": "0755"}
    need(str(value) in modes, "A regular original Git source mode is required")
    return modes[str(value)]


def verify_archive(path, expected_manifest=None):
    with open_regular(path) as stream, zipfile.ZipFile(stream) as archive:
        manifest_bytes = archive.read(MANIFEST)
        manifest = json.loads(manifest_bytes)
        need(manifest.get("schema") == SCHEMA and manifest.get("state") == "COMPLETE",
             "Complete RIS delivery manifest required")
        if expected_manifest is not None:
            need(manifest_bytes == encoded(expected_manifest), "Existing package belongs to another selection")
        members = manifest.get("members")
        need(isinstance(members, list) and members, "Complete delivery members required")
        names = []
        for row in members:
            name = str(relative(row["file"]))
            need(name != MANIFEST, "The manifest cannot describe itself")
            descriptor(row)
            need(row.get("mode") in ("0644", "0755"), "Regular archive mode required")
            names.append(name)
        infos = archive.infolist()
        need(len(names) == len(set(names)) and len(infos) == len(names) + 1
             and {item.filename for item in infos} == set(names) | {MANIFEST},
             "Complete package membership differs")
        for row in members:
            info = archive.getinfo(row["file"])
            need(not info.is_dir() and info.file_size == row["bytes"]
                 and stat.S_IFMT(info.external_attr >> 16) == stat.S_IFREG
                 and stat.S_IMODE(info.external_attr >> 16) == int(row["mode"], 8),
                 "Archive member type, size or source mode differs: " + row["file"])
            with archive.open(info) as member:
                need(stream_identity(member) == descriptor(row),
                     "Complete archive bytes differ: " + row["file"])
    return manifest


def package(selection_path, target):
    selection_path = Path(selection_path)
    need(selection_path.is_absolute() and str(selection_path) == str(selection_path.resolve(strict=True)),
         "Use the original absolute selection file")
    selection_bytes = read_regular(selection_path)
    selection = json.loads(selection_bytes)
    need(selection.get("schema") == "sf88-research-ris-native-selection-v1",
         "Original native selection required")
    root = root_path(selection["runDirectory"], private=True)
    engine_root = root_path(selection["engine"]["root"])
    engine_manifest_path, engine_manifest_bytes = absolute_input(selection["engine"]["manifest"])
    original_responses_path, original_responses_bytes = absolute_input(selection["originalResponses"])
    engine_manifest = json.loads(engine_manifest_bytes)
    engine_files = engine_manifest if isinstance(engine_manifest, list) else engine_manifest.get("files")
    need(isinstance(engine_files, list) and engine_files, "Complete engine source manifest required")
    need(len({row["path"] for row in engine_files}) == len(engine_files),
         "Repeated engine source path")
    native_path = root / "RIS_NATIVE_COMPLETE.json"
    native_bytes = read_regular(native_path)
    native = json.loads(native_bytes)
    need(native.get("schema") == "sf88-research-ris-native-complete-v1"
         and native.get("operationId") == selection.get("operationId"),
         "Complete original native operation required")
    need(all(native.get(key) for key in ("workspaceId", "dossierId", "questionId",
         "baselineReceipt", "receipt", "browser", "merchant", "cold")),
         "The native, browser, Merchant and cold receiving results are required")
    need(native["engine"]["manifestSHA"] == digest(engine_manifest_bytes)
         and native["engine"]["files"] == len(engine_files)
         and native["engine"]["bytes"] == sum(descriptor(row)["bytes"] for row in engine_files),
         "The native result uses a different complete engine selection")
    native_files = native.get("files")
    need(isinstance(native_files, list) and native_files, "Complete native delivery file selection required")
    target = Path(target)
    need(target.is_absolute() and target.suffix.lower() == ".zip", "Absolute ZIP output required")
    root_path(str(target.parent), private=True)
    need(not target.is_symlink(), "Ordinary ZIP destination required")
    rows, inputs = {}, {}

    def add_file(name, path, expected=None, kind="operation", mode="0644", extra=None):
        name = str(relative(name))
        need(name != MANIFEST and name not in rows, "Repeated delivery member: " + name)
        need(path != target, "The output cannot overwrite an original member")
        actual = file_identity(path)
        if expected is not None:
            need(actual == descriptor(expected), "Selected complete file changed: " + name)
        rows[name] = {"file": name, **actual, "mode": mode, "kind": kind, **(extra or {})}
        inputs[name] = path

    def add_bytes(name, body, kind="receiving"):
        name = str(relative(name))
        need(name != MANIFEST and name not in rows, "Repeated delivery member: " + name)
        rows[name] = {"file": name, "bytes": len(body), "sha256": digest(body), "mode": "0644", "kind": kind}
        inputs[name] = body

    for row in native_files:
        rel = relative(row["file"])
        need("private" not in rel.parts and ".git" not in rel.parts,
             "The selected native delivery must exclude private working directories")
        need(isinstance(row.get("kind"), str) and row["kind"], "Native delivery kind required")
        add_file("run/" + str(rel), beneath(root, str(rel)), row, kind=row["kind"])
    if "run/RIS_NATIVE_COMPLETE.json" not in rows:
        add_file("run/RIS_NATIVE_COMPLETE.json", native_path,
                 {"bytes": len(native_bytes), "sha256": digest(native_bytes)}, kind="native-completion")
    for row in engine_files:
        path = str(relative(row["path"]))
        need(".git" not in relative(path).parts, "Source selection must contain source files, not Git internals")
        extra = {"sourceMode": row["mode"]}
        if row.get("gitBlobSha") is not None:
            need(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", row["gitBlobSha"]), "Invalid source Git blob")
            extra["gitBlobSha"] = row["gitBlobSha"]
        add_file("engine-source/" + path, beneath(engine_root, path), row,
                 kind="engine-source", mode=source_mode(row["mode"]), extra=extra)
    need(any(PurePosixPath(row["path"]).name.lower() in ("license", "license.md", "license.txt")
             for row in engine_files), "The complete engine must include its original license")
    native_entries = [row["path"] for row in engine_files if row["path"].endswith("ris-source/native.mjs")]
    need(len(native_entries) == 1, "One original RIS native entrypoint required")
    research = PurePosixPath(native_entries[0]).parent.parent
    source_files = {row["path"]: row for row in engine_files}
    entries = {}
    for label, name in (("native", "ris-source/native.mjs"), ("reopen", "ris-source/reopen.mjs"),
                        ("packager", "ris-source/package.py"), ("workspaceCLI", "workspace-cli.mjs"),
                        ("operatingGuide", "ris-source/OPERATING_GUIDE.md"),
                        ("receivingGuide", "ris-source/RECEIVING_GUIDE.md")):
        path = str(research / name)
        need(path in source_files, "Complete receiving entrypoint missing: " + path)
        entries[label] = "engine-source/" + path
    for name, label in (("OPERATING_GUIDE.md", "operatingGuide"), ("RECEIVING_GUIDE.md", "receivingGuide")):
        path = entries[label][len("engine-source/"):]
        add_file(name, beneath(engine_root, path), source_files[path], kind="receiving-guide")
    add_file("operation/ORIGINAL_SELECTION.json", selection_path,
             {"bytes": len(selection_bytes), "sha256": digest(selection_bytes)}, kind="original-selection")
    add_file("operation/ENGINE_SOURCE_MANIFEST.json", engine_manifest_path,
             selection["engine"]["manifest"], kind="source-selection")
    add_file("operation/ORIGINAL_PROVIDER_RESPONSES.json", original_responses_path,
             selection["originalResponses"], kind="original-provider-responses")
    example = {
        "schema": "sf88-research-ris-native-selection-v1",
        "operationId": "REPLACE_WITH_A_NEW_RECEIVING_OPERATION_ID",
        "runDirectory": "/ABSOLUTE/PRIVATE/NEW_RIS_OPERATION",
        "originalResponses": {
            "file": "/ABSOLUTE/EXTRACTED/operation/ORIGINAL_PROVIDER_RESPONSES.json",
            "bytes": len(original_responses_bytes), "sha256": digest(original_responses_bytes)},
        "engine": {
            "root": "/ABSOLUTE/EXTRACTED/engine-source",
            "manifest": {"file": "/ABSOLUTE/EXTRACTED/operation/ENGINE_SOURCE_MANIFEST.json",
                         "bytes": len(engine_manifest_bytes), "sha256": digest(engine_manifest_bytes)}},
        "runtime": {"node": "/ABSOLUTE/NODE_24_OR_LATER", "python": "/ABSOLUTE/PYTHON3",
                    "playwrightModule": "/ABSOLUTE/INSTALLED/PLAYWRIGHT",
                    "chromiumExecutable": "/ABSOLUTE/INSTALLED/CHROMIUM"},
        "port": 0}
    add_bytes("RECEIVING_SELECTION.example.json", encoded(example))
    readme = (
        "# Research RIS operations\n\n"
        "This delivery contains the complete original RIS operation, retained inputs, "
        "editable portable exports, source, and receiving instructions.\n\n"
        "Read OPERATING_GUIDE.md for the product workflow and RECEIVING_GUIDE.md for "
        "the original results, package verification and a fresh installation.\n\n"
        "The complete original result is run/RIS_NATIVE_COMPLETE.json. "
        "DELIVERY_MANIFEST.json identifies every member by its full byte count, SHA256 "
        "and installation mode. operation/ENGINE_SOURCE_MANIFEST.json retains the source authority.\n\n"
        "Entrypoints:\n\n" + "".join("- " + label + ": " + path + "\n" for label, path in entries.items()) +
        "\nRECEIVING_SELECTION.example.json is an editable example for a new receiving operation. "
        "The original operation and its saved request IDs are retained in operation/ORIGINAL_SELECTION.json "
        "and run/RIS_NATIVE_COMPLETE.json.\n")
    add_bytes("README.md", readme.encode("utf-8"))
    manifest = {
        "schema": SCHEMA, "state": "COMPLETE", "operationId": native["operationId"],
        **{key: native[key] for key in ("workspaceId", "dossierId", "questionId",
          "beforeRevision", "reviewedRevision", "currentRevision")},
        "sourceManifestSHA256": digest(engine_manifest_bytes),
        "nativeResultSHA256": digest(native_bytes),
        "originalSelectionSHA256": digest(selection_bytes),
        "entrypoints": entries,
        "engine": native["engine"],
        "members": [rows[name] for name in sorted(rows)]}
    if os.path.lexists(target):
        verify_archive(target, manifest)
    else:
        candidate = target.with_name(".ris-delivery-" + uuid.uuid4().hex + ".zip")
        try:
            with zipfile.ZipFile(candidate, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name in sorted(inputs):
                    row, selected = rows[name], inputs[name]
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | int(row["mode"], 8)) << 16
                    hasher, count = hashlib.sha256(), 0
                    with archive.open(info, "w", force_zip64=True) as member:
                        if isinstance(selected, bytes):
                            member.write(selected); hasher.update(selected); count = len(selected)
                        else:
                            with open_regular(selected) as original:
                                while True:
                                    chunk = original.read(CHUNK)
                                    if not chunk:
                                        break
                                    member.write(chunk); hasher.update(chunk); count += len(chunk)
                    need({"bytes": count, "sha256": hasher.hexdigest()} == descriptor(row),
                         "Original member changed during packaging: " + name)
                info = zipfile.ZipInfo(MANIFEST, (1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, encoded(manifest))
            candidate.chmod(0o600)
            with open_regular(candidate) as stream:
                os.fsync(stream.fileno())
            verify_archive(candidate, manifest)
            try:
                os.link(candidate, target, follow_symlinks=False)
            except FileExistsError:
                verify_archive(target, manifest)
            descriptor_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor_fd)
            finally:
                os.close(descriptor_fd)
            verify_archive(target, manifest)
        finally:
            candidate.unlink(missing_ok=True)
    return {"state": "COMPLETE", "file": str(target), **file_identity(target),
            "entries": len(rows) + 1, "operationId": native["operationId"],
            "workspaceId": native["workspaceId"], "dossierId": native["dossierId"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--verify", type=Path)
    args = parser.parse_args(argv)
    if args.verify is not None:
        need(args.selection is None and args.output is None, "Use --verify on its own")
        manifest = verify_archive(args.verify)
        result = {"state": "VERIFIED", "file": str(args.verify), **file_identity(args.verify),
                  "entries": len(manifest["members"]) + 1, "operationId": manifest["operationId"]}
    else:
        need(args.selection is not None and args.output is not None, "--selection and --output are required")
        result = package(args.selection, args.output)
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": "RIS_PACKAGE_FAILED", "message": str(error)}), file=sys.stderr)
        sys.exit(1)
