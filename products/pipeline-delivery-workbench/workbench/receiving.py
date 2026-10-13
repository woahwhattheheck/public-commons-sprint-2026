"""Complete, scoped delivery archives and stable receiving without native execution."""
from __future__ import annotations
import contextlib, hashlib, html, json, os, shutil, sqlite3, stat, tempfile, uuid, zipfile
from pathlib import Path, PurePosixPath
from common import (SCHEMA, MAX_ARCHIVE, FileLease, Problem, clone, durable_write,
                    identifier, packed, path_name, read_json, sha, utc)

ARCHIVE_SCHEMA = "tjlabs.dagster-client-archive/v1"
RECEIPT_SCHEMA = "tjlabs.dagster-client-receiving/v1"
REQUIRED_SOURCE = ("common.py", "artifacts.py", "workspace.py", "native.py", "runner.py",
                   "receiving.py", "cli.py", "server.py", "index.html", "app.js", "style.css",
                   "requirements.txt", "README.md", "HTTP_API.md", "STAFF_BROWSER.md", "NATIVE_OPERATION.md")
OPTIONAL_SOURCE = ("LICENSE", "NOTICE.md", "SOURCE_PROVENANCE.json", "DELIVERY_SCOPE.md", "install.py")
RECEIPT_NAME, MANIFEST_NAME = "delivery-receipt.json", "delivery-manifest.json"
MAX_MEMBERS = 25000

def file_identity(path):
    digest, length = hashlib.sha256(), 0
    with open(path, "rb") as f:
        while True:
            data = f.read(1024 * 1024)
            if not data: break
            length += len(data); digest.update(data)
    return {"sha256": digest.hexdigest(), "bytes": length}

def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try: os.fsync(fd)
    finally: os.close(fd)

def _readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=15)

def _meta(path):
    with _readonly(path) as db:
        row = db.execute("SELECT workspace_id,schema,revision,created_at FROM state WHERE id=1").fetchone()
    if not row or row[1] != SCHEMA:
        raise Problem("invalid_database", "The received database is not this application schema", 409)
    return {"workspace_id": row[0], "schema": row[1], "revision": row[2], "created_at": row[3]}

def _source_files(root):
    root = Path(root).resolve()
    out = []
    for name in REQUIRED_SOURCE:
        file = root / name
        if not file.is_file() or file.is_symlink():
            raise Problem("source_incomplete", "A complete application source file is unavailable", 409, {"path": name})
        out.append((name, file))
    for name in OPTIONAL_SOURCE:
        file = root / name
        if file.exists():
            if not file.is_file() or file.is_symlink():
                raise Problem("invalid_source", "A source member must be a regular file", 409, {"path": name})
            out.append((name, file))
    example = root / "examples"
    if example.is_dir():
        for file in sorted(example.rglob("*")):
            if file.is_symlink():
                raise Problem("invalid_source", "The supplied example must retain ordinary original source files", 409)
            if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc":
                out.append((file.relative_to(root).as_posix(), file))
    return sorted(out)

def _snapshot_sqlite(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(source, sqlite3.Connection):
        destination_db = sqlite3.connect(destination)
        try: source.backup(destination_db); destination_db.commit()
        finally: destination_db.close()
    else:
        with _readonly(source) as origin:
            destination_db = sqlite3.connect(destination)
            try: origin.backup(destination_db); destination_db.commit()
            finally: destination_db.close()
    with open(destination, "rb") as f: os.fsync(f.fileno())
    return destination

def _sqlite_file(path):
    with open(path, "rb") as f:
        return f.read(16) == b"SQLite format 3\x00"

def _scope_database(path, project_id):
    """Retain the selected client's entire original entity/request/source history."""
    with sqlite3.connect(path) as db:
        records = db.execute("SELECT id,project_id,body FROM entities").fetchall()
        selected = {row[0] for row in records if row[1] == project_id or row[0] == project_id}
        if project_id not in selected:
            raise Problem("release_project_missing", "The selected release project is absent", 409)
        for record_id, _, _ in records:
            if record_id not in selected:
                db.execute("DELETE FROM entities WHERE id=?", (record_id,))
        referenced = set()
        for row in db.execute("SELECT body FROM entities WHERE kind='edition'"):
            referenced.update(item["sha256"] for item in json.loads(row[0])["files"])
        for (digest,) in db.execute("SELECT sha256 FROM blobs").fetchall():
            if digest not in referenced: db.execute("DELETE FROM blobs WHERE sha256=?", (digest,))
        for request_id, raw in db.execute("SELECT request_id,answer FROM requests").fetchall():
            result = json.loads(raw).get("result")
            if not isinstance(result, dict) or (result.get("id") not in selected and result.get("project_id") != project_id):
                db.execute("DELETE FROM requests WHERE request_id=?", (request_id,))
        for sequence, record_id in db.execute("SELECT seq,record_id FROM audit").fetchall():
            if record_id not in selected:
                db.execute("DELETE FROM audit WHERE seq=?", (sequence,))
        db.commit()
        db.execute("VACUUM")
    return selected

def _delivery_files(workspace, staging, release):
    snapshot = _snapshot_sqlite(workspace.db, staging / "database" / "workspace.sqlite")
    selected_runs = None
    if release:
        _scope_database(snapshot, release["project_id"])
        selected_runs = {row[0] for row in workspace.db.execute(
            "SELECT id FROM entities WHERE kind='run' AND project_id=?", (release["project_id"],))}
    out = [("data/workspace.sqlite", snapshot)]
    for prefix in ("native-runs", "dagster"):
        if prefix == "dagster" and release:
            # A shared Dagster instance contains other clients. Scoped delivery retains selected
            # run records/artifacts; new native work receives its own regular persistent instance.
            continue
        directory = workspace.root / prefix
        if not directory.exists(): continue
        for file in sorted(directory.rglob("*")):
            relative = file.relative_to(workspace.root)
            if file.is_symlink():
                raise Problem("unsafe_native_file", "A native delivery member is not an ordinary retained file", 409,
                              {"path": relative.as_posix()})
            if not file.is_file(): continue
            if prefix == "native-runs" and selected_runs is not None and relative.parts[1] not in selected_runs:
                continue
            if file.name.endswith(("-wal", "-shm", "-journal", ".pyc")) or "__pycache__" in relative.parts:
                continue
            if len(relative.parts) >= 4 and relative.parts[0] == "native-runs" and relative.parts[2] == "profiles":
                continue
            if file.name.endswith(".lock") and not (prefix == "native-runs" and len(relative.parts) > 2 and relative.parts[2] == "project"):
                continue
            original = file
            if _sqlite_file(file):
                original = _snapshot_sqlite(file, staging / "database" / relative)
            out.append(("data/" + relative.as_posix(), original))
    old_receipt = workspace.root / RECEIPT_NAME
    if old_receipt.is_file():
        out.append(("data/receiving-history/" + sha(old_receipt.read_bytes()) + ".json", old_receipt))
    history = workspace.root / "receiving-history"
    if history.is_dir():
        for file in sorted(history.glob("*.json")):
            if file.is_symlink(): raise Problem("invalid_receiving_history", "A receiving history file is not regular", 409)
            out.append(("data/receiving-history/" + file.name, file))
    return out

def _handover(workspace, release):
    run = workspace._body("run", release["run_id"])
    review = workspace._body("review", release["review_id"])
    edition = workspace._body("edition", release["edition_id"])
    contract = workspace._body("contract", release["contract_id"])
    project = workspace._body("project", release["project_id"])
    if run.get("outcome_sha256") != release["outcome_sha256"] or review.get("outcome_sha256") != release["outcome_sha256"]:
        raise Problem("release_changed", "The selected review/outcome binding changed", 409)
    outcome_file = workspace.root / "native-runs" / run["id"] / "outcome.json"
    if not outcome_file.is_file() or sha(outcome_file.read_bytes()) != run["outcome_sha256"]:
        raise Problem("release_outcome_missing", "The actual reviewed native outcome is unavailable", 409)
    values = {"project": project, "release": release, "review": review, "run": run,
              "edition": edition, "contract": contract}
    files = [("handover/records.json", packed(values).encode())]
    for entry in edition["files"]:
        files.append(("handover/project/" + entry["path"], workspace.blob(entry["sha256"])))
    selected = run["outcome"]["evaluation"]
    esc = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    rows = "".join("<tr><td>" + esc(row.get("unique_id")) + "</td><td>" + esc(row.get("status")) +
                   "</td><td>" + esc(row.get("message")) + "</td></tr>" for row in selected.get("results", []))
    criteria = "".join("<tr><td>" + esc(row.get("unique_id")) + "</td><td>" +
                       esc(row.get("observed_status")) + "</td><td>" + esc(row.get("passed")) + "</td></tr>"
                       for row in selected.get("criteria", []))
    report = "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + esc(release["label"]) + "</title><link rel=stylesheet href=report.css><main><h1>" + esc(release["label"]) + "</h1><p>" + esc(project["label"]) + "</p><dl><dt>Original run</dt><dd>" + esc(run["id"]) + "</dd><dt>Dagster run</dt><dd>" + esc(run["dagster_run_id"]) + "</dd><dt>Native state</dt><dd>" + esc(run["state"]) + "</dd><dt>Source edition</dt><dd>" + esc(edition["id"]) + "</dd><dt>Reviewed by</dt><dd>" + esc(review["reviewer"]) + "</dd><dt>Outcome SHA-256</dt><dd>" + esc(run["outcome_sha256"]) + "</dd></dl><h2>Operating handover</h2><pre>" + esc(release["operator_notes"]) + "</pre><h2>Native results</h2><table><thead><tr><th>Native node</th><th>Status</th><th>Message</th></tr></thead><tbody>" + rows + "</tbody></table><h2>Selected acceptance criteria</h2><table><thead><tr><th>Native node</th><th>Observed status</th><th>Passed</th></tr></thead><tbody>" + criteria + "</tbody></table><p><a href=records.json>Complete selected records</a> · <a href=OPERATE.md>Installation and reopening guide</a></p></main></html>"
    files.extend([("handover/index.html", report.encode()),
                  ("handover/report.css", b"body{font:15px system-ui,sans-serif;color:#171717;background:#fff;margin:0}main{max-width:1100px;margin:40px auto;padding:0 24px}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;padding:16px}dd{overflow-wrap:anywhere;margin-bottom:12px}a{color:#222}"),
                  ("handover/OPERATE.md", (
                      "# " + release["label"] + "\n\n" + release["operator_notes"] +
                      "\n\nThis delivery retains the selected client's complete project history, original SQL/YAML/seed files, operating contracts, native outcomes and reviewed release. The original all-client Dagster instance is excluded from a client release. Native IDs and source receipts remain unchanged as history; a newly selected local operation creates its own regular persistent Dagster instance.\n\n"
                      "Receive with the included application: python app/cli.py receive DELIVERY.zip --destination RECEIVED. Start from the received application/README.md; install its pinned requirements for native Dagster/dbt execution, then open the same received workspace. Import, review and history require only Python's standard library. Configure an explicit installed binding for new local work. Existing external profiles and credentials remain on the operator's machine and are never included.\n\n"
                      "The handover/project folder is the exact reviewed edition, while the database preserves every selected-client edition and original request/review. Later edits in an already-received workspace are preserved when the same archive is opened again.\n").encode())])
    return files

def _zip_info(name):
    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    return info

def _write_member(z, name, source):
    path_name(name)
    digest, total = hashlib.sha256(), 0
    if isinstance(source, bytes):
        reader = contextlib.closing(__import__("io").BytesIO(source))
    else:
        reader = open(source, "rb")
    with reader as f, z.open(_zip_info(name), "w", force_zip64=True) as dest:
        while True:
            block = f.read(1024 * 1024)
            if not block: break
            total += len(block); digest.update(block); dest.write(block)
            if total > MAX_ARCHIVE: raise Problem("archive_too_large", "The native delivery exceeds 512 MiB", 413)
    return {"path": name, "bytes": total, "sha256": digest.hexdigest()}

def _create(workspace, output_directory, kind, release_id=None, request_id=None):
    request_id = request_id or str(uuid.uuid4())
    identifier(request_id, "export request_id")
    output = Path(output_directory).resolve()
    for traversed in (workspace.root / "native-runs", workspace.root / "dagster", workspace.root / "receiving-history", workspace.source_root / "examples"):
        if output == traversed or output.is_relative_to(traversed):
            raise Problem("invalid_export_placement", "Choose an export directory outside native data, receiving history, and bundled source examples", 409)
    output.mkdir(parents=True, exist_ok=True)
    with workspace.runtime().idle_guard():
        meta = workspace.meta()
        release = clone(workspace._body("release", release_id)) if kind == "release" else None
        key = sha(packed({"workspace_id": meta["workspace_id"], "kind": kind, "release_id": release_id, "request_id": request_id}))
        final = output / ("delivery-" + key + ".zip")
        receipt_file = output / ("delivery-" + key + ".json")
        if final.is_file():
            inspection = inspect_archive(final)
            manifest = inspection["manifest"]
            if (manifest["workspace_id"], manifest["kind"], manifest.get("release_id"), manifest["export_request_id"]) != (meta["workspace_id"], kind, release_id, request_id):
                raise Problem("export_request_conflict", "That export request already names a different original delivery", 409)
            result = {k: inspection[k] for k in ("workspace_id", "revision", "kind", "receiving_id")}
            result.update(path=str(final), **file_identity(final))
            if release_id: result["release_id"] = release_id
            durable_write(receipt_file, packed(result))
            return result
        if receipt_file.exists():
            raise Problem("export_archive_missing", "The retained export receipt exists but its archive is unavailable", 409)
        with tempfile.TemporaryDirectory(prefix="client-delivery-", dir=output) as temporary:
            staging = Path(temporary)
            source_files = _source_files(workspace.source_root)
            files = [("app/" + name, file) for name, file in source_files]
            files += _delivery_files(workspace, staging, release)
            if release: files += _handover(workspace, release)
            names = [name for name, _ in files]
            if len(files) > MAX_MEMBERS or len(names) != len(set(names)):
                raise Problem("invalid_delivery_inventory", "The delivery contains duplicate or excessive members", 409)
            archive = staging / "complete.zip"
            manifest = {"schema": ARCHIVE_SCHEMA, "workspace_schema": SCHEMA, "kind": kind,
                        "workspace_id": meta["workspace_id"], "revision": meta["revision"],
                        "release_id": release_id, "project_id": release["project_id"] if release else None,
                        "export_request_id": request_id, "created_at": utc(),
                        "native_restore": "selected_client_artifacts" if release else "complete_original_instance",
                        "summary": {"projects": 1 if release else workspace._list("project", limit=1)["total"],
                                    "source_files": len(source_files)}}
            entries, total = [], 0
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
                for name, original in sorted(files, key=lambda x: x[0]):
                    entry = _write_member(z, name, original)
                    entries.append(entry); total += entry["bytes"]
                    if total > MAX_ARCHIVE: raise Problem("archive_too_large", "The complete expanded delivery exceeds 512 MiB", 413)
                manifest["files"] = entries
                manifest["receiving_id"] = "delivery-" + sha(packed(manifest))[:40]
                z.writestr(_zip_info("MANIFEST.json"), packed(manifest))
            if archive.stat().st_size > MAX_ARCHIVE:
                raise Problem("archive_too_large", "The compressed delivery exceeds 512 MiB", 413)
            with open(archive, "rb") as f: os.fsync(f.fileno())
            os.link(archive, final)
            _sync_directory(output)
        inspection = inspect_archive(final)
        result = {k: inspection[k] for k in ("workspace_id", "revision", "kind", "receiving_id")}
        result.update(path=str(final), **file_identity(final))
        if release_id: result["release_id"] = release_id
        durable_write(receipt_file, packed(result))
        return result

def create_backup(workspace, output_directory, *, request_id=None):
    return _create(workspace, output_directory, "workspace", request_id=request_id)

def create_release_archive(workspace, release_id, output_directory, *, request_id=None):
    return _create(workspace, output_directory, "release", release_id, request_id)

def _validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("schema") != ARCHIVE_SCHEMA or manifest.get("workspace_schema") != SCHEMA:
        raise Problem("unsupported_archive", "Select an original pipeline workspace or client release", 409)
    if manifest.get("kind") not in {"workspace", "release"} or type(manifest.get("revision")) is not int:
        raise Problem("invalid_manifest", "The delivery identity is incomplete", 409)
    identity = {k: v for k, v in manifest.items() if k != "receiving_id"}
    if manifest.get("receiving_id") != "delivery-" + sha(packed(identity))[:40]:
        raise Problem("manifest_changed", "The receiving identity does not match the retained manifest", 409)
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries or len(entries) > MAX_MEMBERS:
        raise Problem("invalid_manifest", "The original delivery inventory is unavailable", 409)
    seen, total = set(), 0
    for entry in entries:
        if not isinstance(entry, dict): raise Problem("invalid_manifest", "Invalid delivery member")
        name = path_name(entry.get("path"))
        parts = PurePosixPath(name).parts
        if parts[0] not in {"app", "data", "handover"} or len(parts) < 2:
            raise Problem("invalid_manifest", "Unexpected delivery member scope", 409)
        if parts[0] == "data" and not (parts[1] in {"native-runs", "dagster", "receiving-history"} or name == "data/workspace.sqlite"):
            raise Problem("invalid_manifest", "Unexpected mutable workspace member", 409)
        if name in seen or type(entry.get("bytes")) is not int or entry["bytes"] < 0:
            raise Problem("invalid_manifest", "Duplicate or invalid delivery member", 409)
        digest = entry.get("sha256")
        if not isinstance(digest, str) or len(digest) != 64 or any(x not in "0123456789abcdef" for x in digest):
            raise Problem("invalid_manifest", "The delivery member hash is invalid", 409)
        total += entry["bytes"]; seen.add(name)
    if total > MAX_ARCHIVE or "data/workspace.sqlite" not in seen:
        raise Problem("invalid_manifest", "The complete received database is absent or exceeds the supported size", 409)
    for name in REQUIRED_SOURCE:
        if "app/" + name not in seen:
            raise Problem("source_incomplete", "The delivery omits a complete application source file", 409, {"path": name})
    return entries

def _inspect_open(z, archive_sha):
    infos = z.infolist()
    if len(infos) > MAX_MEMBERS + 1 or len({x.filename for x in infos}) != len(infos):
        raise Problem("invalid_zip", "The archive contains duplicate or excessive members", 409)
    by_name = {}
    for info in infos:
        path_name(info.filename)
        mode = stat.S_IFMT(info.external_attr >> 16)
        if info.is_dir() or mode not in {0, stat.S_IFREG} or info.flag_bits & 1:
            raise Problem("invalid_zip", "The delivery must contain unencrypted ordinary files", 409)
        if info.file_size > MAX_ARCHIVE:
            raise Problem("archive_too_large", "An expanded delivery member exceeds its limit", 413)
        by_name[info.filename] = info
    if "MANIFEST.json" not in by_name or by_name["MANIFEST.json"].file_size > 16 * 1024 * 1024:
        raise Problem("manifest_missing", "The original bounded delivery manifest is unavailable", 409)
    try: manifest = json.loads(z.read("MANIFEST.json"))
    except (ValueError, UnicodeError) as exc: raise Problem("invalid_manifest", "The original manifest is not valid JSON", 409) from exc
    entries = _validate_manifest(manifest)
    if set(by_name) != {"MANIFEST.json"} | {x["path"] for x in entries}:
        raise Problem("inventory_mismatch", "The archive and original member inventory differ", 409)
    for entry in entries:
        if by_name[entry["path"]].file_size != entry["bytes"]:
            raise Problem("member_size_changed", "A delivery member has changed size", 409, {"path": entry["path"]})
        digest = hashlib.sha256()
        with z.open(entry["path"]) as f:
            while True:
                block = f.read(1024 * 1024)
                if not block: break
                digest.update(block)
        if digest.hexdigest() != entry["sha256"]:
            raise Problem("member_changed", "A delivery member differs from its original SHA-256", 409, {"path": entry["path"]})
    return {"schema": manifest["schema"], "kind": manifest["kind"], "workspace_id": manifest["workspace_id"],
            "revision": manifest["revision"], "receiving_id": manifest["receiving_id"],
            "archive_sha256": archive_sha, "files": entries, "release_id": manifest.get("release_id"),
            "summary": manifest.get("summary", {}), "manifest": manifest}

def inspect_archive(archive_path):
    file = Path(archive_path).resolve()
    if not file.is_file() or file.stat().st_size > MAX_ARCHIVE:
        raise Problem("archive_unavailable", "Select a complete delivery ZIP within the 512 MiB limit", 413)
    with open(file, "rb") as stream:
        initial = os.fstat(stream.fileno())
        digest = hashlib.sha256()
        while True:
            block = stream.read(1024 * 1024)
            if not block: break
            digest.update(block)
        stream.seek(0)
        try:
            with zipfile.ZipFile(stream) as z: result = _inspect_open(z, digest.hexdigest())
        except zipfile.BadZipFile as exc: raise Problem("invalid_zip", "The original delivery ZIP is invalid", 409) from exc
        final = os.fstat(stream.fileno())
        if (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns) != (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns):
            raise Problem("archive_changed", "The selected archive changed while it was read", 409)
        return result

def inspect_received(destination):
    root = Path(destination).resolve()
    receipt_file, manifest_file = root / RECEIPT_NAME, root / MANIFEST_NAME
    if not receipt_file.is_file() or not manifest_file.is_file():
        raise Problem("receiving_missing", "This directory has no original receiving receipt", 404)
    receipt, raw = read_json(receipt_file), manifest_file.read_bytes()
    if receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("manifest_sha256") != sha(raw):
        raise Problem("receiving_changed", "The original receiving receipt/manifest identity changed", 409)
    manifest = json.loads(raw); _validate_manifest(manifest)
    if receipt.get("receiving_id") != manifest["receiving_id"] or receipt.get("workspace_id") != manifest["workspace_id"]:
        raise Problem("receiving_changed", "The receiving receipt names a different original workspace", 409)
    meta = _meta(root / "workspace.sqlite")
    if meta["workspace_id"] != manifest["workspace_id"] or meta["revision"] < manifest["revision"]:
        raise Problem("workspace_identity_changed", "The current received writer differs from its original identity", 409)
    if not (root / "application" / "workspace.py").is_file():
        raise Problem("source_incomplete", "The received application source is unavailable", 409)
    return {"root": str(root), "receipt": receipt, **meta, "receiving_id": manifest["receiving_id"],
            "origin_revision": manifest["revision"], "kind": manifest["kind"], "release_id": manifest.get("release_id"),
            "source_root": str(root / "application")}

def receive_workspace(archive_path, destination, *, source_root=None):
    archive = Path(archive_path).resolve()
    inspection = inspect_archive(archive)
    root = Path(destination).resolve()
    root.parent.mkdir(parents=True, exist_ok=True)
    try: lease = FileLease(root.parent / (".receiving-" + sha(str(root)) + ".lock"))
    except BlockingIOError as exc: raise Problem("receiving_in_use", "This destination already has a receiving operation", 409) from exc
    with lease:
        if root.exists():
            current = inspect_received(root)
            if current["receiving_id"] != inspection["receiving_id"] or current["receipt"]["archive_sha256"] != inspection["archive_sha256"]:
                raise Problem("destination_conflict", "This receiving directory already contains a different original delivery", 409)
            return {**current, "reused": True}
        stage = Path(tempfile.mkdtemp(prefix="." + root.name + "-receive-", dir=root.parent))
        published = False
        try:
            with open(archive, "rb") as stream:
                digest = hashlib.sha256()
                while True:
                    block = stream.read(1024 * 1024)
                    if not block: break
                    digest.update(block)
                if digest.hexdigest() != inspection["archive_sha256"]:
                    raise Problem("archive_changed", "The selected delivery changed before receiving", 409)
                stream.seek(0)
                with zipfile.ZipFile(stream) as z:
                    for entry in inspection["files"]:
                        name = entry["path"]
                        prefix, relative = name.split("/", 1)
                        target = stage / ("application/" + relative if prefix == "app" else relative if prefix == "data" else "handover/" + relative)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        observed = hashlib.sha256(); total = 0
                        with z.open(name) as origin, open(target, "xb") as f:
                            while True:
                                block = origin.read(1024 * 1024)
                                if not block: break
                                total += len(block); observed.update(block); f.write(block)
                                if total > entry["bytes"]: raise Problem("member_changed", "A delivery member grew during receiving", 409)
                            f.flush(); os.fsync(f.fileno())
                        if total != entry["bytes"] or observed.hexdigest() != entry["sha256"]:
                            raise Problem("member_changed", "A delivery member changed during receiving", 409)
            meta = _meta(stage / "workspace.sqlite")
            if meta["workspace_id"] != inspection["workspace_id"] or meta["revision"] != inspection["revision"]:
                raise Problem("database_identity_mismatch", "The received database differs from the original manifest", 409)
            manifest_raw = packed(inspection["manifest"]).encode()
            receipt = {"schema": RECEIPT_SCHEMA, "workspace_id": meta["workspace_id"],
                       "revision": meta["revision"], "receiving_id": inspection["receiving_id"],
                       "archive_sha256": inspection["archive_sha256"], "manifest_sha256": sha(manifest_raw),
                       "kind": inspection["kind"], "release_id": inspection.get("release_id"), "received_at": utc()}
            durable_write(stage / MANIFEST_NAME, manifest_raw)
            durable_write(stage / RECEIPT_NAME, packed(receipt))
            for directory in sorted((p for p in stage.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
                _sync_directory(directory)
            _sync_directory(stage)
            os.rename(stage, root); published = True; _sync_directory(root.parent)
            return {**inspect_received(root), "reused": False}
        finally:
            if not published and stage.exists():
                shutil.rmtree(stage)

def received_catalog(parent_directory):
    parent = Path(parent_directory).resolve()
    if not parent.is_dir(): return []
    out = []
    for directory in sorted(parent.iterdir(), key=lambda p: p.name):
        if not directory.is_dir() or directory.is_symlink() or not (directory / RECEIPT_NAME).is_file():
            continue
        try: out.append(inspect_received(directory))
        except Problem as exc:
            out.append({"root": str(directory), "available": False, "error": exc.as_dict()})
    return out
