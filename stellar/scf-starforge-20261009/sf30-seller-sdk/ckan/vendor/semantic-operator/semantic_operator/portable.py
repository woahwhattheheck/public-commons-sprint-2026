"""Complete workspace transfer with original histories and independent received branches."""
from __future__ import annotations
import contextlib
import ctypes
import errno
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
from .security import atomic_write, canonical, digest, private_directory, private_read, read_json, MAX_BUNDLE
from .store import ApplicationStore, identifier, standalone_database, now
from .worker import job_schema, JOB_SCHEMA, DATASET_JOB_SCHEMA

TABLES={"metadata","documents","history","artifacts","operations"}
KINDS={"source","mapping","snapshot","validation","query","comparison","decision","job","receiving","recovery"}

def validate_workspace(files,manifest):
    metadata=manifest.get("metadata",{})
    if metadata.get("schema")!="commons-semantic-workspace/1":
        raise ValueError("Choose a complete semantic operator workspace.")
    raw=files.get("application.sqlite3")
    if raw is None:
        raise ValueError("The original workspace database is missing.")
    db=sqlite3.connect(":memory:")
    db.row_factory=sqlite3.Row
    try:
        db.deserialize(standalone_database(raw))
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA query_only=ON")
        structures=db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master").fetchall()
        tables={r["name"] for r in structures if r["type"]=="table"}
        if tables!=TABLES or any(r["type"] not in ("table","index") or
           (r["type"]=="index" and not r["name"].startswith("sqlite_autoindex_")) or
           (r["sql"] and "VIRTUAL" in r["sql"].upper()) for r in structures):
            raise ValueError("The original workspace has an unsupported database schema.")
        if db.execute("PRAGMA quick_check").fetchone()[0]!="ok":
            raise ValueError("The original workspace database is incomplete.")
        saved=dict(db.execute("SELECT key,value FROM metadata"))
        if saved.get("workspace_id")!=metadata.get("workspace_id"):
            raise ValueError("The workspace identity differs from the transfer manifest.")
        identifier(saved["workspace_id"],"Original workspace ID")
        artifacts={}
        for row in db.execute("SELECT * FROM artifacts"):
            identifier(row["id"],"Artifact ID")
            if not re.fullmatch(r"[a-f0-9]{64}",row["sha256"]) or row["backup"]!=1:
                raise ValueError("A transferred source identity is invalid.")
            name="sources/"+row["sha256"]+".bin"
            body=files.get(name)
            if body is None or len(body)!=row["bytes"] or digest(body)!=row["sha256"]:
                raise ValueError("The transfer omits or changes an original source.")
            artifacts[row["id"]]=dict(row)
        histories={}
        for row in db.execute("SELECT * FROM history ORDER BY kind,id,revision"):
            if row["kind"] not in KINDS:
                raise ValueError("The transfer contains an unsupported record kind.")
            identifier(row["id"],"Record ID")
            value=read_json(row["payload"])
            if not isinstance(value,dict) or digest(row["payload"].encode())!=row["sha256"]:
                raise ValueError("An original revision payload no longer matches its identity.")
            key=(row["kind"],row["id"])
            previous=histories.get(key)
            if row["revision"]!=(previous["revision"]+1 if previous else 1):
                raise ValueError("The transfer has incomplete original revision history.")
            histories[key]=dict(row)
        heads=[]
        for row in db.execute("SELECT * FROM documents ORDER BY kind,id"):
            final=histories.get((row["kind"],row["id"]))
            if not final or any(final[k]!=row[k] for k in ("revision","payload","sha256")):
                raise ValueError("A transferred record head differs from its complete original history.")
            value=read_json(row["payload"])
            if row["kind"]=="source":
                item=artifacts.get(value.get("artifact_id"))
                if not item or item["sha256"]!=value.get("sha256") or item["bytes"]!=value.get("bytes"):
                    raise ValueError("An original source record has lost its bytes.")
                catalogue=value.get("dataset_catalog")
                if catalogue:
                    companion=artifacts.get(catalogue.get("id"))
                    if not companion or companion["sha256"]!=catalogue.get("sha256") or companion["bytes"]!=catalogue.get("bytes"):
                        raise ValueError("An N-Quads source has lost its original graph catalogue.")
            if row["kind"]=="job":
                original=files.get("native-jobs/"+row["id"]+"/job.json")
                if original is None or digest(original)!=value.get("job_sha256"):
                    raise ValueError("An original native job has lost its pinned inputs.")
                job=read_json(original)
                if job_schema(job) not in (JOB_SCHEMA,DATASET_JOB_SCHEMA) or job.get("job_id")!=row["id"] or job.get("workspace_id")!=saved["workspace_id"]:
                    raise ValueError("A native job belongs to a different original workspace.")
                for item in job["inputs"]:
                    pinned=artifacts.get(item["artifact_id"])
                    if not pinned or pinned["sha256"]!=item["sha256"] or pinned["bytes"]!=item["bytes"]:
                        raise ValueError("A native job input is missing from the complete source set.")
            for item in value.get("files",[]) if row["kind"] in ("snapshot","validation","query","comparison") else []:
                retained=artifacts.get(item.get("artifact_id"))
                if not retained or retained["sha256"]!=item["sha256"] or retained["bytes"]!=item["bytes"]:
                    raise ValueError("An engineering result is missing a complete native output.")
            if row["kind"]=="snapshot" and value.get("parameters",{}).get("data_model")=="dataset":
                roles={v["role"] for v in value.get("files",[])}
                if not {"dataset","graph_catalog","provenance"}.issubset(roles):
                    raise ValueError("A dataset snapshot requires its quad bytes, graph catalogue and provenance.")
            heads.append({"kind":row["kind"],"id":row["id"],"revision":row["revision"],"sha256":row["sha256"],
                          "title":value.get("title",row["id"])})
        if len(heads)!=len(histories):
            raise ValueError("The transfer contains history without its original record head.")
        expected_sources={"sources/"+v["sha256"]+".bin" for v in artifacts.values()}
        if {n for n in files if n.startswith("sources/")}!=expected_sources:
            raise ValueError("The transfer contains unlisted source files.")
        for name in files:
            if name=="application.sqlite3" or name in expected_sources:
                continue
            parts=name.split("/")
            if (len(parts)<3 or parts[0]!="native-jobs" or (parts[1] not in {r["id"] for r in heads if r["kind"]=="job"})
                or parts[2] not in ("job.json","state.json","result.json","cancel.json","attempts","logs")):
                raise ValueError("The transfer includes a file outside its original native jobs.")
        counts={kind:sum(r["kind"]==kind for r in heads) for kind in KINDS}
        return {"workspace_id":saved["workspace_id"],"heads":heads,"records":len(heads),
                "revisions":db.execute("SELECT COUNT(*) FROM history").fetchone()[0],
                "artifacts":len(artifacts),"bytes":sum(len(v) for v in files.values()),"counts":counts}
    except sqlite3.Error as exc:
        raise ValueError("The transferred workspace schema or records cannot be read.") from exc
    finally:
        db.close()

def publish_directory(stage, target):
    """Atomically publish the complete owned stage without reserving an empty target.

    Linux renameat2(RENAME_NOREPLACE) leaves both sides intact if the destination
    already exists. There is no mkdir-to-receipt crash window and no replacement
    of another operation's empty directory.
    """
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, "renameat2", None)
    if rename is None:
        raise RuntimeError("Atomic workspace receiving requires Linux renameat2 support.")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(target), 1) != 0:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            raise ValueError("The destination was created by another operation; its workspace was preserved.")
        raise OSError(code, os.strerror(code), str(target))


def receive_workspace(files,manifest,destination,*,archive_sha256,operation_id):
    summary=validate_workspace(files,manifest)
    target=Path(destination).expanduser().absolute()
    private_directory(target.parent)
    marker={"schema":"commons-semantic-receiving-origin/1","operation_id":operation_id,
            "archive_sha256":archive_sha256,"workspace_id":summary["workspace_id"],"destination":str(target)}
    if target.exists():
        private_directory(target,create=False)
        retained=target/"RECEIVED.json"
        if not retained.exists() or read_json(private_read(retained))!=marker:
            raise ValueError("The destination already belongs to another workspace or receiving operation.")
        return summary
    stage=target.parent/(".semantic-receiving-"+digest(canonical(marker))[:24])
    if stage.exists():
        private_directory(stage,create=False)
        if read_json(private_read(stage/"RECEIVED.json"))!=marker:
            raise ValueError("The receiving staging directory belongs to another operation.")
        # Only this operation's unpublished, fully reproducible staging is replaced.
        shutil.rmtree(stage)
    # Publish a named stage only after its durable ownership marker exists.
    # An interruption before that point cannot poison the operation's stage name.
    prepared=Path(tempfile.mkdtemp(prefix=".semantic-building-",dir=target.parent))
    prepared.chmod(0o700)
    try:
        atomic_write(prepared/"RECEIVED.json",canonical(marker),replace=False)
        publish_directory(prepared,stage)
    finally:
        if prepared.exists():
            shutil.rmtree(prepared)
    store=None
    try:
        for name,body in sorted(files.items()):
            path=stage/name
            private_directory(path.parent)
            atomic_write(path,body,replace=False)
        store=ApplicationStore(stage)
        # Preserve every original revision; add one explicit lifecycle transition
        # for work whose former process cannot survive transfer.
        for row in store.documents("job"):
            if row["payload"]["status"] in ("queued","running","cancelling"):
                store.save("job",row["id"],{**row["payload"],"status":"interrupted",
                    "error":{"type":"WorkspaceReceived","message":"Continue this original job from its retained inputs."}},
                    actor="workspace receiving",expected_revision=row["revision"])
        # Received child locations belong to the previous host. Preserve their
        # history, while making their new local lifecycle explicit. A retained
        # handoff can be opened again from its complete incoming edition; an
        # encrypted recovery requires its separately held original archive.
        for kind in ("receiving", "recovery"):
            for row in store.documents(kind):
                value = row["payload"]
                origin_operation = value.get("receiving_operation_id") or value.get("restoring_operation_id")
                if not origin_operation:
                    origin_operation = store.history(kind, row["id"])[0]["payload"].get("_operation_id")
                store.save(kind, row["id"], {
                    **value,
                    "original_workspace_path": value.get("workspace_path") or value.get("original_workspace_path"),
                    "workspace_path": None, "local_workspace_root": None,
                    "location_status": "retained_archive_available" if kind == "receiving" else "original_archive_required",
                    "receiving_operation_id" if kind == "receiving" else "restoring_operation_id": origin_operation,
                    "relocated_at": now(),
                    "location_note": ("Open reconstructs the retained incoming edition in this operator's receiving directory. "
                        "Later edits in the former independent child workspace require that child's own export."
                        if kind == "receiving" else
                        "This history retains the recovery identity. Restore the separately held encrypted archive into a new local directory.")
                }, actor="workspace receiving", expected_revision=row["revision"])
        with store.lock:
            store.db.execute("INSERT OR REPLACE INTO metadata VALUES('received_from',?)",(canonical(marker).decode(),))
        store.close();store=None
        publish_directory(stage, target)
        fd=os.open(target.parent,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
        return summary
    finally:
        if store is not None:
            store.close()
