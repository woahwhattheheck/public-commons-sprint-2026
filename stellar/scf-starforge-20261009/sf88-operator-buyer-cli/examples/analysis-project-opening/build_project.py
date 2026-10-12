#!/usr/bin/env python3
"""Build a complete offline reader and receiving package from a native Analysis archive."""
from __future__ import annotations
import argparse, base64, hashlib, json, math, mimetypes, os
from pathlib import Path, PurePosixPath
import re, sqlite3, stat, tempfile, zipfile

SCHEMA = "stellar-forge.analysis-project-reader.v1"
WRAPPER = "stellar-forge.analysis-project-reader-wrapper.v1"
DELIVERY = "stellar-forge.analysis-project-delivery.v1"
SLOT = "__ANALYSIS_PROJECT_DATA_BASE64__"
MAX_TOTAL = 256 * 1024 * 1024
MAX_ROWS = 1_000_000


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def relative(value):
    p = PurePosixPath(value)
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value or p.is_absolute() or p.as_posix() != value or any(x in {".", ".."} for x in p.parts):
        raise ValueError("Use an exact relative project member")
    return value


def original(path, maximum=MAX_TOTAL):
    path = Path(path).expanduser().absolute()
    if path.resolve() != path:
        raise ValueError("Select a regular original file without a symlink")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as f:
        before = os.fstat(f.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("The complete selected file exceeds its limit")
        raw = f.read(maximum + 1)
        after = os.fstat(f.fileno())
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(raw) != before.st_size:
            raise ValueError("The original file changed while reading")
        return raw


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private(path):
    if not os.path.lexists(path):
        private(path.parent)
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path or info.st_mode & 0o077:
        raise ValueError("Use the original private output directory")
    sync(path)
    sync(path.parent)


def publish(path, raw):
    if os.path.lexists(path):
        if original(path) != raw:
            raise ValueError("The original project output differs: " + str(path))
        with path.open("rb") as f:
            os.fsync(f.fileno())
        sync(path.parent)
        return
    temporary = path.with_name("." + path.name + ".partial")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            raise ValueError("Keep the original private project staging file")
        os.ftruncate(f.fileno(), 0)
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)
    sync(path.parent)


def cell(value):
    # Same representation as the native Analysis browser.
    if value is None:
        return {"type": "null", "text": ""}
    if isinstance(value, bytes):
        return {"type": "blob", "text": base64.b64encode(value).decode("ascii")}
    if type(value) is float and not math.isfinite(value):
        return {"type": "sqlite-real", "text": str(value)}
    return {"type": "integer" if type(value) is int else "number" if type(value) is float else "string",
            "text": str(value)}


def snapshot_database(raw, parent):
    tables = []
    with tempfile.TemporaryDirectory(prefix=".analysis-reader-", dir=parent) as work:
        path = Path(work) / "datasets.sqlite3"
        path.write_bytes(raw)
        db = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            db.execute("PRAGMA query_only=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            selected = db.execute("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type='table' ORDER BY name").fetchall()
            total = 0
            for name, kind, sql in selected:
                quoted = '"' + name.replace('"', '""') + '"'
                count = db.execute("SELECT count(*) FROM " + quoted).fetchone()[0]
                total += count
                if total > MAX_ROWS:
                    raise ValueError("Use a larger explicit reader population limit for this complete project")
                columns = [{"name":r[1], "declaredType":r[2], "notNull":bool(r[3]),
                            "default":r[4], "primaryKeyOrdinal":r[5]}
                           for r in db.execute("PRAGMA table_info(" + quoted + ")")]
                rows = [{c["name"]:cell(v) for c,v in zip(columns,row)}
                        for row in db.execute("SELECT * FROM " + quoted)]
                tables.append({"name":name,"kind":kind,"sql":sql,"columns":columns,"rowCount":count,"rows":rows})
            # The native view registry maps a view to one immutable dataset
            # table. Copy those exact rows; never execute a saved SQL recipe.
            by_name = {x["name"]:x for x in tables}
            for name, version, revision in db.execute("SELECT name,version_id,revision FROM sf_dataset_views ORDER BY name"):
                table_name = "sf_dataset_rows_" + version
                if not re.fullmatch(r"[a-f0-9]{64}", version) or table_name not in by_name:
                    raise ValueError("The original dataset view binding differs")
                row = db.execute("SELECT sql FROM sqlite_master WHERE type='view' AND name=?", (name,)).fetchone()
                if row is None:
                    raise ValueError("The original dataset view is absent")
                expected_sql='CREATE VIEW "'+name.replace('"','""')+'" AS SELECT * FROM "'+table_name+'"'
                if row[0]!=expected_sql:
                    raise ValueError("The registered dataset view differs from its original table binding")
                base = by_name[table_name]
                tables.append({**base, "name":name, "kind":"view", "sql":row[0],
                               "versionId":version, "viewRevision":revision})
        finally:
            db.close()
    return sorted(tables, key=lambda x:x["name"])


def build(archive, output, viewer, *, archive_sha256, extra_files=None, title="Retained API analysis workspace"):
    from stellar_forge_buyer.workspace_archive import inspect_archive
    from stellar_forge_buyer.storage import lock
    output = Path(output).expanduser().absolute()
    private(output)
    with lock(output):
        inspection = inspect_archive(archive, expected_sha256=archive_sha256)
        archive_raw = original(archive)
        if identity(archive_raw) != {k:inspection["archive"][k] for k in ("bytes","sha256")}:
            raise ValueError("The original inspected archive changed")
        template = original(viewer, 2 * 1024 * 1024)
        text = template.decode("utf-8")
        if text.count(SLOT) != 1:
            raise ValueError("The complete viewer must have one exact data slot")
        files, total, inputs = {}, 0, []
        def add(name, raw, media=None):
            nonlocal total
            name = relative(name)
            if name in {"project.html", "project-data.json", "project-manifest.json"}:
                raise ValueError("The selected file uses a reserved project output name")
            if name in files:
                raise ValueError("Duplicate selected project member: " + name)
            total += len(raw)
            if total > MAX_TOTAL:
                raise ValueError("The complete selected project exceeds its byte limit")
            files[name] = {"path":name, **identity(raw),
                           "mediaType":media or mimetypes.guess_type(name)[0] or "application/octet-stream",
                           "encoding":"base64", "data":base64.b64encode(raw).decode("ascii")}
        add("archives/analysis-workspace.zip", archive_raw, "application/zip")
        import io
        with zipfile.ZipFile(io.BytesIO(archive_raw)) as z:
            manifest_raw = z.read("archive-manifest.json")
            manifest = json.loads(manifest_raw)
            add("archives/archive-manifest.json", manifest_raw, "application/json")
            for item in manifest["files"]:
                raw = z.read("workspace/" + item["path"])
                if identity(raw) != {k:item[k] for k in ("bytes","sha256")}:
                    raise ValueError("The native archived member changed")
                add("workspace/" + item["path"], raw)
            database = z.read("workspace/datasets.sqlite3")
            for item in manifest["files"]:
                if item["path"].startswith("analysis-response-sources/") and item["path"].endswith("/capsule.json"):
                    capsule = json.loads(z.read("workspace/" + item["path"]))
                    parent = "workspace/" + item["path"].rsplit("/",1)[0] + "/"
                    for row in capsule["files"]:
                        inputs.append({"sourceSha256":capsule["source_sha256"],"role":row["role"],
                                       "file":parent+row["path"],"originalPath":capsule["original_paths"][row["role"]],
                                       **{k:row[k] for k in ("bytes","sha256")}})
        for row in extra_files or []:
            raw = original(row["source"])
            if identity(raw) != {k:row[k] for k in ("bytes","sha256")}:
                raise ValueError("A selected receiving/runtime file changed")
            add(row["path"], raw, row.get("mediaType"))
        tables = snapshot_database(database, output)
        sources = next((x for x in tables if x["name"] == "sf_analysis_response_sources"), None)
        names = {}
        for row in sources["rows"] if sources else []:
            record = json.loads(row["record"]["text"])
            names.setdefault(record["source_sha256"], []).append(record["name"])
        for row in inputs:
            row["source"] = ", ".join(sorted(set(names.get(row["sourceSha256"], []))))
        snapshot = {"schema":SCHEMA,"title":title,"workspaceId":manifest["workspace_id"],
                    "archive":{"file":"archives/analysis-workspace.zip",**identity(archive_raw),"id":manifest["id"],
                               "manifestFile":"archives/archive-manifest.json"},
                    "tables":tables,"sourceInputs":inputs,"files":[files[k] for k in sorted(files)],
                    "receiving":{"guideFile":"RECEIVING.md" if "RECEIVING.md" in files else None,
                      "nativeSourceDirectory":"runtime/python",
                      "commands":[
                        "python -m stellar_forge_buyer.workspace_archive_receive inspect ARCHIVE --sha256 SHA256",
                        "python -m stellar_forge_buyer.workspace_archive_receive receive ARCHIVE NEW_PRIVATE_DIRECTORY --operation ORIGINAL_RECEIVING_ID --sha256 SHA256",
                        "python -m stellar_forge_buyer.analysis_workspace --database NEW_PRIVATE_DIRECTORY status",
                        "python -m stellar_forge_buyer.analysis_workspace --database NEW_PRIVATE_DIRECTORY --checkout NATIVE_CHECKOUT --node NODE serve --open"]}}
        data = encoded(snapshot)
        wrapper = encoded({"schema":WRAPPER,"snapshot":snapshot,"sha256":identity(data)["sha256"]})
        html = text.replace(SLOT, base64.b64encode(wrapper).decode("ascii")).encode()
        items = {k:base64.b64decode(v["data"]) for k,v in files.items()}
        items.update({"project-data.json":data,"project.html":html})
        package_manifest = {"schema":DELIVERY,"workspace_id":manifest["workspace_id"],
                            "archive":snapshot["archive"],"snapshot":identity(data),
                            "viewer_template":identity(template),
                            "files":[{"path":k,**identity(items[k])} for k in sorted(items)]}
        package_raw = encoded(package_manifest)
        items["project-manifest.json"] = package_raw
        selection = {"schema":DELIVERY+"/input","archive":identity(archive_raw),
                     "viewer_template":identity(template),
                     "files":[{k:r[k] for k in ("path","bytes","sha256")} for r in snapshot["files"]]}
        publish(output/"input.json", encoded(selection))
        published = output/"Analysis_Project.zip"
        if os.path.lexists(published):
            published_raw = original(published)
            with zipfile.ZipFile(io.BytesIO(published_raw)) as z:
                if sorted(z.namelist()) != sorted(items) or len(z.namelist()) != len(items):
                    raise ValueError("The complete original project ZIP differs")
                for name, raw in items.items():
                    if z.read(name) != raw:
                        raise ValueError("The complete original project member differs: " + name)
        else:
            temporary = output/".Analysis_Project.zip.partial"
            fd = os.open(temporary, os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd,"w+b") as f:
                info=os.fstat(f.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
                    raise ValueError("Keep the original private ZIP staging file")
                os.ftruncate(f.fileno(),0)
                with zipfile.ZipFile(f,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
                    for name, raw in sorted(items.items()):
                        entry=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0))
                        entry.compress_type=zipfile.ZIP_DEFLATED
                        entry.external_attr=(stat.S_IFREG|0o600)<<16
                        z.writestr(entry,raw)
                f.flush()
                os.fsync(f.fileno())
            os.replace(temporary,published)
            sync(output)
        publish(output/"project-data.json",data)
        publish(output/"project.html",html)
        publish(output/"project-manifest.json",package_raw)
        result={"schema":DELIVERY,"state":"COMPLETE","workspace_id":manifest["workspace_id"],
                "archive":{"path":str(published),**identity(original(published))},
                "project":{"path":str(output/"project.html"),**identity(html)},
                "snapshot":identity(data),"members":len(items),
                "native_archive":snapshot["archive"],"retained_source_files":len(inputs)}
        publish(output/"result.json",encoded(result))
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive",required=True)
    parser.add_argument("--archive-sha256",required=True)
    parser.add_argument("--viewer-template",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--extra-files",help="Exact selected files [{path,source,bytes,sha256,mediaType?}]")
    parser.add_argument("--title",default="Retained API analysis workspace")
    args=parser.parse_args()
    extra=json.loads(original(args.extra_files)) if args.extra_files else []
    print(encoded(build(args.archive,args.output,args.viewer_template,
                        archive_sha256=args.archive_sha256,extra_files=extra,title=args.title)).decode(),end="")


if __name__=="__main__":
    main()
