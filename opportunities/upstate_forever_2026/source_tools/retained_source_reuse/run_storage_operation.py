"""Exercise the existing Upper Savannah source importer on an isolated owned workspace."""
from __future__ import annotations
import errno
import hashlib
import importlib
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import resource
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import traceback

if "BUNDLE" not in globals():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: run_storage_operation.py storage_operation.json")
    BUNDLE = json.loads(Path(sys.argv[1]).read_bytes())
if BUNDLE.get("schema") != "upstate.retained-source-storage-input/v1":
    raise ValueError("Select the complete original storage operation source")

SOURCE_FILE = Path(os.environ.get("UPSTATE_STORAGE_ORIGINAL_SOURCE",
    "/workspace/scratch/25fd9979bd5c/upper_savannah70cb_source.json"))
SOURCE_SHA = "429fca7b15d06f96fa5f1592bf6c091fb7f6ca92edcfe1523737b79c9b6bd10e"
STORAGE_BYTES = 2 * 1024 * 1024 * 1024
RESULT = {"schema": "upstate.retained-source-storage-operation/v1", "state": "RUNNING",
          "source_capsule_sha256": SOURCE_SHA, "stages": []}
root = None

def sha(data):
    return hashlib.sha256(data).hexdigest()

def file_sha(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def git_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode()

def retained(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("The operation's retained source differs: " + str(path))
        return
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())

def checkpoint():
    target = root / "Upper_Savannah_Source_Storage_Result.json"
    with tempfile.NamedTemporaryFile(dir=root, prefix=".result-", delete=False) as stream:
        name = stream.name
        stream.write(encoded(RESULT))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(name, target)

def stage(name, **details):
    RESULT["stages"].append({"name": name, **details})
    checkpoint()
    print(json.dumps({"stage": name, **details}), flush=True)

def create_root():
    candidates = list(dict.fromkeys([Path("/mnt/data"), Path.cwd(),
        Path("/workspace/scratch/25fd9979bd5c"), Path("/dev")]))
    for parent in candidates:
        try:
            if parent.is_dir() and shutil.disk_usage(parent).free >= 64 * 1024 * 1024:
                return Path(tempfile.mkdtemp(prefix="upstate-source-storage-25fd-", dir=parent))
        except OSError:
            continue
    raise OSError(errno.ENOSPC, "An owned 64 MiB volume is needed for the isolated storage operation")

def package_module(name, directory):
    spec = importlib.util.spec_from_file_location(name, directory / "__init__.py",
                                                submodule_search_locations=[str(directory)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return importlib.import_module(name + ".workspace"), importlib.import_module(name + ".common")

def concurrent_worker(common, project, source, ready, start, result_path, events):
    original = tempfile.NamedTemporaryFile
    def observed(*args, **kwargs):
        if kwargs.get("prefix") == ".intake-":
            fd = os.open(events, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
            try:
                os.write(fd, b"copy\n")
            finally:
                os.close(fd)
        return original(*args, **kwargs)
    tempfile.NamedTemporaryFile = observed
    ready.set()
    start.wait(30)
    try:
        value = common.retain_file(project, source)
        result_path.write_bytes(encoded({"state": "COMPLETE", "result": value}))
    except BaseException as error:
        result_path.write_bytes(encoded({"state": "FAILED", "error": str(error)}))
        raise
    finally:
        tempfile.NamedTemporaryFile = original

try:
    actual_source = (SOURCE_FILE.read_bytes() if SOURCE_FILE.is_file()
                     else BUNDLE["original_source"].encode("utf-8"))
    if len(actual_source) != 276619 or sha(actual_source) != SOURCE_SHA:
        raise ValueError("Keep the complete retained original fourteen-file source")
    original = json.loads(actual_source)
    if (original.get("schema") != "commons.retained-source-intake.v1"
            or original.get("originalGitBlob") != "f784b703c04b282680714b48e4f54761be0c1148"):
        raise ValueError("The original selected-model source identity changed")
    original_files = {}
    for item in original["files"]:
        name, data = item["path"], item["content"].encode()
        selected = Path(name)
        if selected.is_absolute() or ".." in selected.parts or selected.as_posix() != name:
            raise ValueError("Keep the original relative source names")
        if len(data) != item["bytes"] or sha(data) != item["sha256"] or git_sha(data) != item["gitBlob"]:
            raise ValueError("Original selected-model source differs: " + name)
        if name in original_files:
            raise ValueError("The original source repeats a path")
        original_files[name] = data
    if len(original_files) != 14:
        raise ValueError("Retain all fourteen original source files")
    for path, expected in BUNDLE["preimage_git"].items():
        if git_sha(original_files[path]) != expected:
            raise ValueError("The selected storage preimage changed: " + path)
    root = create_root()
    temporary = root / "tmp"
    temporary.mkdir()
    os.environ["TMPDIR"] = str(temporary)
    os.environ["SQLITE_TMPDIR"] = str(temporary)
    tempfile.tempdir = str(temporary)
    RESULT["root"] = str(root)
    RESULT["started_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for edition in ("original-application", "application"):
        destination = root / edition
        for name, data in original_files.items():
            retained(destination / name, data)
        retained(destination / "model" / "__init__.py", BUNDLE["package_init"].encode())
    for name, text in BUNDLE.get("unchanged_sources", {}).items():
        retained(root / "application" / name, text.encode())
    packet_path = root / "retained-source-reuse.json"
    retained(packet_path, encoded(BUNDLE["receiving_packet"]))
    receiver_path = root / "application" / "model" / "receive_selected_model_source.py"
    completed = subprocess.run([sys.executable, "-B", str(receiver_path), "--application",
                                str(root / "application"), "--packet", str(packet_path)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    retained(root / "source-receiving.stdout", completed.stdout or b"\n")
    retained(root / "source-receiving.stderr", completed.stderr or b"\n")
    if completed.returncode:
        raise RuntimeError("The original source receiver failed: " + completed.stderr.decode(errors="replace")[-4000:])
    source_result = json.loads(completed.stdout)
    for name, body in BUNDLE["postimages"].items():
        if (root / "application" / name).read_bytes() != body.encode():
            raise ValueError("The original source receiver did not publish the exact postimage")
    stage("Original source receiver", result=source_result, files=[
        {"path": name, "bytes": len(body.encode()), "git_sha": git_sha(body.encode())}
        for name, body in BUNDLE["postimages"].items()])
    frozen_workspace, frozen_common = package_module("frozen_model", root / "original-application" / "model")
    active_workspace, common = package_module("active_model", root / "application" / "model")
    inputs = root / "inputs"
    inputs.mkdir()
    source = inputs / "source.bin"
    chunk = bytes(range(256)) * 256
    with source.open("xb") as stream:
        for _ in range(64):
            stream.write(chunk)
    companion = inputs / "source-metadata.txt"
    companion.write_text("Original companion retained for the storage operation.\n")
    manifest = {"schema": "upstate.sources/v1", "title": "Retained source storage operation",
                "captured_at": "2026-10-13T00:00:00Z", "entries": [
                    {"id": "storage-input", "kind": "document", "title": "Deterministic storage input",
                     "uri": "urn:upstate:storage-operation:source", "vintage": "storage-operation",
                     "path": source.name, "sha256": file_sha(source),
                     "companions": [{"path": companion.name, "sha256": file_sha(companion)}]}]}
    manifest_path = inputs / "sources.json"
    manifest_path.write_bytes(encoded(manifest))
    project = root / "workspace"
    prior = frozen_workspace.Workspace(project, create=True)
    first = prior.import_sources(manifest_path)
    view, entry = prior.source_file(first["id"], "storage-input")
    saved_source_bytes = (project / "sources" / (first["id"] + ".json")).read_bytes()
    original_inode = source.stat().st_ino
    cas = project / entry["body"]["object"]
    if cas.stat().st_ino == original_inode:
        raise AssertionError("First intake must retain an independent copy")
    active = active_workspace.Workspace(project)
    original_temporary = tempfile.NamedTemporaryFile
    staging_attempts = []
    def unavailable(*args, **kwargs):
        staging_attempts.append(kwargs.get("prefix"))
        raise OSError(errno.ENOSPC, "No temporary intake capacity")
    tempfile.NamedTemporaryFile = unavailable
    try:
        repeated = active.import_sources(manifest_path)
    finally:
        tempfile.NamedTemporaryFile = original_temporary
    assert repeated == first and not staging_attempts
    stage("Repeat original source collection without staging", source_collection_id=first["id"],
          input_bytes=source.stat().st_size, companion_bytes=companion.stat().st_size,
          staging_attempts=len(staging_attempts), source_edition_unchanged=True,
          original_source_inode=original_inode, retained_object_inode=cas.stat().st_ino)
    with view.open("r+b") as stream:
        stream.write(b"damaged")
        stream.flush()
        os.fsync(stream.fileno())
    assert file_sha(cas) != entry["body"]["sha256"]
    recovered = active.import_sources(manifest_path)
    repaired_view, _ = active.source_file(first["id"], "storage-input")
    assert recovered == first and file_sha(repaired_view) == entry["body"]["sha256"]
    assert repaired_view.stat().st_ino == cas.stat().st_ino
    assert cas.stat().st_ino != source.stat().st_ino
    assert (project / "sources" / (first["id"] + ".json")).read_bytes() == saved_source_bytes
    stage("Restore retained object and original native view", source_collection_id=first["id"],
          sha256=file_sha(cas), original_edition_bytes_preserved=True,
          source_view_inode=repaired_view.stat().st_ino, retained_inode=cas.stat().st_ino)
    # Use a second isolated store so concurrent callers contend for one absent digest.
    concurrent_root = root / "concurrent-workspace"
    concurrent_root.mkdir()
    context = multiprocessing.get_context("fork")
    start = context.Event()
    ready = [context.Event(), context.Event()]
    children, result_paths = [], []
    events = root / "copy-events.txt"
    for index in range(2):
        output = root / ("concurrent-" + str(index) + ".json")
        child = context.Process(target=concurrent_worker,
            args=(common, concurrent_root, source, ready[index], start, output, events))
        child.start()
        children.append(child)
        result_paths.append(output)
    try:
        if not all(event.wait(20) for event in ready):
            raise RuntimeError("Both original import callers must start")
        start.set()
        for child in children:
            child.join(30)
        if any(child.exitcode != 0 for child in children):
            raise RuntimeError("A concurrent original import did not complete")
    finally:
        for child in children:
            if child.is_alive():
                child.terminate()
            child.join()
    responses = [json.loads(path.read_bytes()) for path in result_paths]
    assert all(item["state"] == "COMPLETE" for item in responses)
    assert responses[0]["result"] == responses[1]["result"]
    copies = events.read_bytes().splitlines()
    assert len(copies) == 1
    assert not [path for path in (concurrent_root / "objects").glob(".intake-*")
                if not path.name.endswith(".lock")]
    stage("Concurrent identical first intake", callers=2, independent_copies=len(copies),
          retained_sha256=responses[0]["result"]["sha256"], bytes=responses[0]["result"]["bytes"])
    large_root = root / "large-workspace"
    large = active_workspace.Workspace(large_root, create=True)
    large_source = inputs / "large-storage-input.bin"
    with large_source.open("xb") as stream:
        stream.truncate(STORAGE_BYTES)
    large_digest = file_sha(large_source)
    objects = large_root / "objects"
    objects.mkdir()
    existing = objects / large_digest
    with existing.open("xb") as stream:
        stream.truncate(STORAGE_BYTES)
        stream.flush()
        os.fsync(stream.fileno())
    assert existing.stat().st_ino != large_source.stat().st_ino
    large_manifest = {"schema": "upstate.sources/v1", "title": "Large retained storage operation",
        "captured_at": "2026-10-13T00:00:00Z", "entries": [
            {"id": "large-storage-input", "kind": "document", "title": "Two GiB sparse storage input",
             "uri": "urn:upstate:storage-operation:large", "vintage": "storage-operation",
             "path": large_source.name, "sha256": large_digest}]}
    large_manifest_path = inputs / "large-sources.json"
    large_manifest_path.write_bytes(encoded(large_manifest))
    large_first = large.import_sources(large_manifest_path)
    before = existing.stat()
    staging_attempts.clear()
    tempfile.NamedTemporaryFile = unavailable
    try:
        old_failed = False
        try:
            frozen_common.retain_file(large_root, large_source, large_digest)
        except OSError as error:
            if error.errno != errno.ENOSPC:
                raise
            old_failed = True
        baseline_attempts = len(staging_attempts)
        staging_attempts.clear()
        large_repeated = large.import_sources(large_manifest_path)
    finally:
        tempfile.NamedTemporaryFile = original_temporary
    after = existing.stat()
    assert old_failed and baseline_attempts == 1
    assert large_repeated == large_first and not staging_attempts
    assert before.st_ino == after.st_ino and before.st_blocks == after.st_blocks
    assert not (objects / (".intake-" + large_digest + ".lock")).exists()
    stage("Verify two GiB retained source with no staging capacity",
          bytes=STORAGE_BYTES, sha256=large_digest, source_collection_id=large_first["id"],
          original_staging_attempts=baseline_attempts, successor_staging_attempts=len(staging_attempts),
          retained_inode_unchanged=True, allocated_bytes_before=before.st_blocks * 512,
          allocated_bytes_after=after.st_blocks * 512, sparse=True)
    portable = importlib.import_module("active_model.portable")
    members = portable._inventory(project, include_intermediates=True, include_deliveries=True, excluded=set())
    assert all(not name.endswith(".lock") and "source-views/" not in name for name in members)
    backup = portable.backup(active, root / "Upper_Savannah_Source_Storage_Workspace.zip")
    exported = portable.inspect_archive(backup["path"], verify=True)
    assert exported["project"] == active.project
    assert exported["members"]["workspace/sources/" + first["id"] + ".json"]["sha256"] == sha(saved_source_bytes)
    assert all(not name.endswith(".lock") and "source-views/" not in name
               for name in exported["members"])
    RESULT["workspace_archive"] = backup
    stage("Original portable workspace export", files=len(members), lock_files_exported=0,
          derived_views_exported=0, original_source_edition_present=True, archive=backup)
    RESULT["state"] = "COMPLETE"
except BaseException as error:
    RESULT["state"] = "FAILED"
    RESULT["error"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
    if root is None:
        print(json.dumps(RESULT), flush=True)
        raise
finally:
    if root is not None:
        RESULT["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        RESULT["max_rss_kib"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        checkpoint()
        print(json.dumps({"result": RESULT, "result_path": str(root / "Upper_Savannah_Source_Storage_Result.json")}), flush=True)

if root is not None and BUNDLE.get("library_helpers"):
    for helper in BUNDLE["library_helpers"]:
        retained(root / "library-helpers" / helper["name"], helper["content"].encode())
    sys.path.insert(0, str(root / "library-helpers"))
    from library_upload import LibraryUploadWorkflow, HostedAppsClient, LibraryFileMaterializer, SignedUrlUploader
    state_parent = root / "upload-state"
    state_parent.mkdir(exist_ok=True)
    saved = LibraryUploadWorkflow(apps_client=HostedAppsClient(), materializer=LibraryFileMaterializer(),
        uploader=SignedUrlUploader(), state_parent=state_parent).run({"uploads": [
            {"local_path": str(root / "Upper_Savannah_Source_Storage_Result.json"),
             "purpose": "create_library_file", "library_artifact_type": "other"},
            *([{"local_path": RESULT["workspace_archive"]["path"],
                "purpose": "create_library_file", "library_artifact_type": "other"}]
              if RESULT.get("workspace_archive") else [])]})
    retained(root / "LIBRARY_SAVE.json", encoded(saved))
    def safe(value):
        if isinstance(value, dict):
            return {key: safe(item) for key, item in value.items()
                    if not any(part in key.lower() for part in ("url", "header", "token", "secret"))}
        if isinstance(value, list):
            return [safe(item) for item in value]
        return value
    print(json.dumps({"saved": safe(saved), "root": str(root)}), flush=True)
    if any(row.get("status") != "succeeded" for row in saved.get("results", [])) or not saved.get("results"):
        raise RuntimeError("Continue this original retained result save")
if RESULT["state"] != "COMPLETE":
    raise SystemExit(1)
