"""Closed full-history archives and same-operation receiving."""
import ctypes, errno, fcntl, html, io, os, shutil, stat, tempfile, zipfile
from pathlib import Path
from .common import *
from .workspace import Workspace, DATABASE_SCHEMA
from . import domain, dispatch
ARCHIVE_SCHEMA="geocove.highway-archive.v1"
RECEIPT_SCHEMA="geocove.highway-receiving.v1"
def manifest_identity(value):
    return digest({k:v for k,v in value.items() if k!="sha256"})
def review_html(history):
    state=history["states"][-1]["state"]; pub=history["publication"]
    def e(v):return html.escape(str(v),quote=True)
    rows=[]
    for cmd in history["commands"]:
        c=cmd["envelope"]["command"]
        rows.append("<tr><td>"+e(cmd["revision"])+"</td><td>"+e(c["kind"])+"</td><td>"+e(c["actor"]["name"])+"</td><td>"+e(c["at"])+"</td></tr>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+e(state["title"])+' — complete handover</title><style>body{font:16px/1.6 system-ui;color:#172c32;max-width:1000px;margin:30px auto;padding:0 20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #ccd8d9;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{line-height:1.2}@media(max-width:600px){th,td{font-size:12px;padding:6px}}</style><main><p>Highway field operations · retained customer workspace</p><h1>'+e(state["title"])+'</h1><p>Revision '+e(pub["revision"])+'. This package includes every original command, result, source object and saved revision through this publication. Approved proposals are candidate edits; this archive does not assert that a GIS service applied them.</p><h2>Open the complete application</h2><p>Read source/OPERATING.md. Run the included receiving command to restore an editable workspace. The original source observations and first operation results remain in history.json and blobs/.</p><h2>Recorded operations</h2><table><thead><tr><th>Revision</th><th>Action</th><th>Operator</th><th>Recorded at</th></tr></thead><tbody>'+"".join(rows)+'</tbody></table><h2>Publication identity</h2><pre>'+e(canonical({k:v for k,v in pub.items() if k not in ("blobInventory","publicationIds")}).decode())+'</pre></main></html>').encode()
def source_inventory(source_root,selection):
    root=Path(source_root).resolve(strict=True)
    require(selection.get("schema")=="geocove.highway-source.v1" and isinstance(selection.get("files"),list),"SOURCE_SELECTION","Complete installed source selection is required.")
    files=selection["files"]; seen=set()
    require(1<=len(files)<=2000,"SOURCE_SELECTION","Invalid installed source count.")
    for item in files:
        path=safe_path(item["path"]);require(path not in seen,"SOURCE_SELECTION","Repeated installed source path.");seen.add(path)
        current=root/path
        require(current.resolve(strict=True).is_relative_to(root) and not current.is_symlink(),"SOURCE_SELECTION","Installed source escapes its selection.")
        data=read_regular(current)
        require(len(data)==item["bytes"] and sha(data)==item["sha256"],"SOURCE_CHANGED","Installed source differs: "+path)
    require(selection.get("sha256")==manifest_identity(selection),"SOURCE_SELECTION","Installed source manifest identity differs.")
    return root,files
def zip_info(path):
    z=zipfile.ZipInfo(path,(1980,1,1,0,0,0));z.create_system=3;z.external_attr=0o100600<<16;z.compress_type=zipfile.ZIP_DEFLATED
    return z
def validate_archive(path,expected_sha256=None,expected_bytes=None):
    archive=Path(path);data=read_regular(archive,MAX_ARCHIVE)
    archive_sha=sha(data)
    if expected_sha256 is not None:require(archive_sha==sha_id(expected_sha256),"ARCHIVE_CHANGED","Archive identity differs.")
    if expected_bytes is not None:require(type(expected_bytes) is int and len(data)==expected_bytes,"ARCHIVE_CHANGED","Archive byte length differs.")
    try:
        z=zipfile.ZipFile(io.BytesIO(data))
        entries=z.infolist();names=[x.filename for x in entries]
        require(1<=len(entries)<=12000 and len(names)==len(set(names)),"ARCHIVE_MEMBERS","Archive has repeated or excessive members.")
        for item in entries:
            safe_path(item.filename)
            mode=item.external_attr>>16
            require(not item.is_dir() and stat.S_IFMT(mode) in (0,stat.S_IFREG) and not item.flag_bits&1,"ARCHIVE_MEMBER","Only ordinary unencrypted files are accepted.")
            require(item.file_size<=MAX_BLOB if item.filename!="history.json" else item.file_size<=MAX_HISTORY,"ARCHIVE_CAPACITY","Archive member exceeds its allowance.")
        require(sum(x.file_size for x in entries)<=MAX_ARCHIVE+2*1024*1024,"ARCHIVE_CAPACITY","Expanded archive exceeds its allowance.")
        require("manifest.json" in names,"ARCHIVE_MANIFEST","Archive manifest is missing.")
        require(z.getinfo("manifest.json").file_size<=2*1024*1024,"ARCHIVE_MANIFEST","Archive manifest exceeds its allowance.")
        name_set=set(names)
        for name in names:
            require(not any("/".join(name.split("/")[:i]) in name_set for i in range(1,len(name.split("/")))),"ARCHIVE_MEMBERS","A file also occupies an ancestor path.")
        manifest=loads(z.read("manifest.json"))
        require(manifest.get("schema")==ARCHIVE_SCHEMA and manifest.get("sha256")==manifest_identity(manifest),"ARCHIVE_MANIFEST","Archive manifest identity is invalid.")
        files=manifest.get("files");require(isinstance(files,list),"ARCHIVE_MANIFEST","Complete file inventory is required.")
        listed=[x["path"] for x in files];require(listed==sorted(set(listed)) and set(names)==set(listed)|{"manifest.json"},"ARCHIVE_MEMBERS","Archive membership differs from its manifest.")
        total=0
        for item in files:
            path=safe_path(item["path"]);require(path=="history.json" or path=="HANDOVER.html" or path.startswith("blobs/") or path.startswith("source/"),"ARCHIVE_MEMBER","Unexpected archive member.")
            raw=z.read(path);total+=len(raw)
            require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"ARCHIVE_CHANGED","Archive member identity differs.")
        require(total==manifest["bytes"] and total<=MAX_ARCHIVE,"ARCHIVE_CAPACITY","Archive total differs or exceeds its allowance.")
        history=loads(z.read("history.json"))
        require(history.get("schema")=="geocove.highway-history.v1","HISTORY_SCHEMA","Full native history is required.")
        require(history["workspaceId"]==manifest["workspaceId"] and history["publication"]["id"]==manifest["publicationId"] and history["publication"]["revision"]==manifest["revision"],"ARCHIVE_BINDING","Archive publication binding differs.")
        blob_names={"blobs/"+x["sha256"] for x in history["blobs"]}
        require(blob_names=={p for p in names if p.startswith("blobs/")},"ARCHIVE_BLOBS","Source blob inventory differs.")
        for item in history["blobs"]:
            sha_id(item["sha256"]);raw=z.read("blobs/"+item["sha256"])
            require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"ARCHIVE_BLOBS","Retained source blob differs.")
        selection=loads(z.read("source/source-selection.json"))
        require(selection.get("sha256")==manifest["sourceSha256"] and selection["sha256"]==manifest_identity(selection),"SOURCE_SELECTION","Received source selection differs.")
        require({x["path"] for x in selection["files"]}=={p[7:] for p in names if p.startswith("source/") and p!="source/source-selection.json"},"SOURCE_SELECTION","Received source closure differs.")
        for item in selection["files"]:
            raw=z.read("source/"+safe_path(item["path"]))
            require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"SOURCE_SELECTION","Received application source changed.")
        return {"schema":ARCHIVE_SCHEMA,"filename":"Highway_Field_Workspace.zip","bytes":len(data),"sha256":archive_sha,"manifestSha256":manifest["sha256"],"manifest":manifest},z,history
    except (zipfile.BadZipFile,KeyError,TypeError,RuntimeError) as ex:
        fail("ARCHIVE_INVALID","Cannot read the complete native archive: "+type(ex).__name__)
def export_workspace(workspace,publication_id,source_root,selection,revision=None):
    identifier(publication_id)
    root,source_files=source_inventory(source_root,selection)
    directory=workspace.directory/"exports"/publication_id
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(directory/"operation.lock",os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX)
        intent_path=directory/"intent.json"
        if intent_path.exists():
            intent=loads(read_regular(intent_path,MAX_HISTORY))
            require(intent["sourceSha256"]==selection["sha256"] and intent["history"]["publication"]["id"]==publication_id,"EXPORT_CONFLICT","Original publication source selection differs.")
            history=intent["history"]
            if revision is not None:require(history["publication"]["revision"]==revision,"EXPORT_CONFLICT","The retained export revision differs.")
        else:
            history=workspace.snapshot(publication_id,revision)
            intent={"schema":"geocove.highway-export-intent.v1","sourceSha256":selection["sha256"],"history":history}
            atomic_file(intent_path,canonical(intent),immutable=True)
        output=directory/"Highway_Field_Workspace.zip"
        if output.exists():
            descriptor,z,found=validate_archive(output);z.close()
            require(found==history and descriptor["manifest"]["sourceSha256"]==selection["sha256"],"EXPORT_CONFLICT","Existing original export differs.")
            return {**descriptor,"path":str(output),"reused":True}
        payloads=[("history.json",canonical(history),"application/json"),("HANDOVER.html",review_html(history),"text/html"),("source/source-selection.json",canonical(selection),"application/json")]
        for item in source_files:
            raw=read_regular(root/item["path"])
            require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"SOURCE_CHANGED","Installed source changed before archive publication.")
            payloads.append(("source/"+item["path"],raw,"application/octet-stream"))
        # Original blobs are read one at a time while writing; no duplicated bulk source in memory.
        inventory=[{"path":p,"bytes":len(b),"sha256":sha(b),"mediaType":m} for p,b,m in payloads]
        for item in history["blobs"]:inventory.append({"path":"blobs/"+item["sha256"],"bytes":item["bytes"],"sha256":item["sha256"],"mediaType":"application/octet-stream"})
        inventory.sort(key=lambda x:x["path"])
        manifest={"schema":ARCHIVE_SCHEMA,"workspaceId":history["workspaceId"],"publicationId":publication_id,"revision":history["publication"]["revision"],"sourceSha256":selection["sha256"],"files":inventory,"bytes":sum(x["bytes"] for x in inventory)}
        require(manifest["bytes"]<=MAX_ARCHIVE,"ARCHIVE_CAPACITY","Complete archive exceeds its allowance.")
        manifest["sha256"]=manifest_identity(manifest)
        partial=directory/"archive.partial.zip"
        with zipfile.ZipFile(partial,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            z.writestr(zip_info("manifest.json"),canonical(manifest))
            by_path={p:(b,m) for p,b,m in payloads}
            for item in inventory:
                raw=workspace.read_blob(item["sha256"]) if item["path"].startswith("blobs/") else by_path[item["path"]][0]
                require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"SOURCE_CHANGED","Export source changed.")
                z.writestr(zip_info(item["path"]),raw)
        os.chmod(partial,0o600)
        with open(partial,"rb") as stream:os.fsync(stream.fileno())
        try:os.link(partial,output)
        except FileExistsError:
            require(read_regular(partial,MAX_ARCHIVE)==read_regular(output,MAX_ARCHIVE),"EXPORT_CONFLICT","Another output occupies this original export.")
        partial.unlink();fsync_directory(directory)
        descriptor,z,found=validate_archive(output);z.close()
        require(found==history,"EXPORT_CHANGED","Original full history differs after export.")
        return {**descriptor,"path":str(output),"reused":False}
    finally:fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
def restore_history(history,read_blob,directory):
    states=history["states"];commands=history["commands"]
    require(isinstance(states,list) and 1<=len(states)<=10001 and len(commands)==len(states)-1,"HISTORY_CHAIN","History must contain every consecutive original state.")
    require([x["revision"] for x in states]==list(range(len(states))),"HISTORY_CHAIN","Revision sequence is incomplete.")
    for item in states:require(digest(item["state"])==item["sha256"],"HISTORY_CHAIN","Saved state identity differs.")
    blob_inventory=history["blobs"];publication_inventory=history["publications"]
    require([x["sha256"] for x in blob_inventory]==sorted({x["sha256"] for x in blob_inventory}),"PUBLICATION_BINDING","Source inventory must be sorted and unique.")
    require([x["id"] for x in publication_inventory]==sorted({x["id"] for x in publication_inventory}),"PUBLICATION_BINDING","Publication inventory must be sorted and unique.")
    blobs_by_id={x["sha256"]:x for x in blob_inventory};pubs_by_id={x["id"]:x for x in publication_inventory}
    for pub in publication_inventory:
        ids=pub.get("publicationIds");blobs=pub.get("blobInventory")
        require(isinstance(ids,list) and ids==sorted(set(ids)) and pub["id"] in ids and all(x in pubs_by_id and pubs_by_id[x]["revision"]<=pub["revision"] for x in ids),"PUBLICATION_BINDING","Publication references missing original history.")
        require(isinstance(blobs,list) and [x["sha256"] for x in blobs]==sorted({x["sha256"] for x in blobs}) and all(blobs_by_id.get(x["sha256"])==x for x in blobs),"PUBLICATION_BINDING","Publication references missing or changed source bytes.")
    require(history["publication"].get("blobInventory")==blob_inventory and history["publication"].get("publicationIds")==sorted(pubs_by_id),"PUBLICATION_BINDING","Selected publication does not bind the complete carried history.")
    first=states[0]["state"]
    require(domain.new_state(first["id"],first["title"],first["createdAt"])==first,"HISTORY_GENESIS","Initial workspace state differs.")
    with Workspace(directory,create=True,workspace_id=first["id"],title=first["title"],created_at=first["createdAt"]) as w:
        current=w.current()
        require(current["revision"]<=len(commands),"RECEIVING_CONFLICT","Receiving stage contains later unrelated work.")
        for item in history["blobs"]:
            raw=read_blob(item["sha256"]);require(len(raw)==item["bytes"],"SOURCE_CHANGED","Source byte count differs.")
            w.put_blob(raw,item["sha256"])
        for i,item in enumerate(commands,1):
            env=item["envelope"]
            require(item["revision"]==i and env["expectedRevision"]==i-1 and digest(env)==item["requestSha256"],"HISTORY_COMMAND","Original command identity or order differs.")
            expected_event=digest({"requestSha256":item["requestSha256"],"previousSha256":states[i-1]["sha256"],"stateSha256":states[i]["sha256"],"result":item["result"]})
            require(item["previousSha256"]==states[i-1]["sha256"] and item["sha256"]==expected_event,"HISTORY_CHAIN","Original event chain differs.")
            returned=w.execute(env["command"],env["expectedRevision"])
            returned.pop("reused")
            require(returned==item["result"],"RECEIVING_RESULT","Original first outcome did not reproduce.")
            actual=w.db.execute("SELECT body FROM states WHERE revision=?",(i,)).fetchone()
            require(loads(actual["body"])==states[i]["state"],"RECEIVING_STATE","Original business state did not reproduce.")
        domain.validate_state(w.current()["state"],w.read_blob)
        for pub in history["publications"]:
            identifier(pub["id"])
            require(pub["workspaceId"]==first["id"] and 0<=pub["revision"]<len(states) and pub["stateSha256"]==states[pub["revision"]]["sha256"],"PUBLICATION_BINDING","Publication refers to another state.")
            old=w.db.execute("SELECT body FROM publications WHERE id=?",(pub["id"],)).fetchone()
            if old:require(loads(old["body"])==pub,"PUBLICATION_CONFLICT","Receiving publication differs.")
            else:w.db.execute("INSERT INTO publications VALUES(?,?,?,?)",(pub["id"],pub["revision"],digest({"id":pub["id"],"revision":pub["revision"]}),canonical(pub)))
        require(history["publication"] in history["publications"],"PUBLICATION_MISSING","Selected original publication is absent.")
        return w.current()
def rename_noreplace(source,target):
    libc=ctypes.CDLL(None,use_errno=True)
    fn=getattr(libc,"renameat2",None)
    require(fn is not None,"RECEIVE_PLATFORM","Receiving requires Linux renameat2.")
    if fn(-100,os.fsencode(source),-100,os.fsencode(target),1)!=0:
        code=ctypes.get_errno()
        if code==errno.EEXIST:fail("TARGET_EXISTS","A different destination already exists.")
        raise OSError(code,os.strerror(code))
def receive_archive(archive,directory,operation_id,expected_sha256,expected_bytes):
    identifier(operation_id);sha_id(expected_sha256)
    path=Path(directory).absolute();parent=path.parent.resolve(strict=True);target=parent/path.name
    require(not target.is_symlink() and path.name not in ("",".",".."),"RECEIVE_DIRECTORY","Use a named target in its real parent.")
    key=digest({"directory":str(target)})
    guard=parent/(".highway-receive-"+key+".lock")
    fd=os.open(guard,os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    z=None
    try:
        fcntl.flock(fd,fcntl.LOCK_EX)
        descriptor,z,history=validate_archive(archive,expected_sha256,expected_bytes)
        binding={"schema":RECEIPT_SCHEMA,"operationId":operation_id,"directory":str(target),"archiveSha256":descriptor["sha256"],"archiveBytes":descriptor["bytes"],"manifestSha256":descriptor["manifestSha256"],"workspaceId":history["workspaceId"],"publicationId":history["publication"]["id"]}
        receipt=target/"receiving.json"
        if target.exists():
            require(receipt.is_file() and loads(read_regular(receipt))==binding,"RECEIVING_CONFLICT","Existing destination belongs to another receiving operation.")
            # Later legitimate edits are intentionally preserved.
            with Workspace(target) as w:
                require(w.current()["state"]["id"]==history["workspaceId"],"WORKSPACE_CHANGED","Received workspace identity changed.")
                for state in history["states"]:
                    row=w.db.execute("SELECT sha256,body FROM states WHERE revision=?",(state["revision"],)).fetchone()
                    require(row is not None and row["sha256"]==state["sha256"] and sha(bytes(row["body"]))==state["sha256"],"HISTORY_MISSING","Original received history is no longer readable.")
                for blob in history["blobs"]:require(len(w.read_blob(blob["sha256"]))==blob["bytes"],"SOURCE_CHANGED","Original received source is no longer readable.")
                for command in history["commands"]:
                    row=w.db.execute("SELECT * FROM commands WHERE request_id=?",(command["envelope"]["command"]["requestId"],)).fetchone()
                    require(row is not None and row["revision"]==command["revision"] and row["request_sha256"]==command["requestSha256"] and loads(row["envelope"])==command["envelope"] and loads(row["result"])==command["result"] and row["previous_sha256"]==command["previousSha256"] and row["sha256"]==command["sha256"],"HISTORY_MISSING","Original received command or first result changed.")
                for pub in history["publications"]:
                    row=w.db.execute("SELECT body FROM publications WHERE id=?",(pub["id"],)).fetchone()
                    require(row is not None and loads(row["body"])==pub,"PUBLICATION_MISSING","Original received publication changed.")
                for item in descriptor["manifest"]["files"]:
                    if not item["path"].startswith("source/"):continue
                    actual=read_regular(target/item["path"])
                    require(len(actual)==item["bytes"] and sha(actual)==item["sha256"],"SOURCE_CHANGED","Original received application source changed.")
                current=w.current()
            return {**descriptor,"directory":str(target),"received":True,"reused":True,"current":current,"receipt":binding}
        intent=parent/(".highway-receive-"+key+".json")
        atomic_file(intent,canonical(binding),immutable=True)
        stage=parent/(".highway-receive-"+key+".stage")
        require(not stage.is_symlink(),"RECEIVE_DIRECTORY","Receiving stage cannot be a link.")
        stage.mkdir(mode=0o700,exist_ok=True)
        atomic_file(stage/"receiving-intent.json",canonical(binding),immutable=True)
        def read_blob(k):return z.read("blobs/"+sha_id(k))
        current=restore_history(history,read_blob,stage)
        for item in descriptor["manifest"]["files"]:
            if not item["path"].startswith("source/"):continue
            output=stage/item["path"]
            ancestor=output.parent
            while ancestor!=stage:
                require(not ancestor.is_symlink(),"RECEIVE_DIRECTORY","Receiving source path contains a link.")
                ancestor=ancestor.parent
            require(not output.is_symlink(),"RECEIVE_DIRECTORY","Receiving source file contains a link.")
            atomic_file(output,z.read(item["path"]),immutable=True)
        atomic_file(stage/"source-manifest.json",z.read("manifest.json"),immutable=True)
        atomic_file(stage/"receiving.json",canonical(binding),immutable=True)
        allowed={"workspace.sqlite3","creation.json","receiving-intent.json","source-manifest.json","receiving.json"}|{item["path"] for item in descriptor["manifest"]["files"] if item["path"].startswith("source/")}
        actual=set()
        for found in stage.rglob("*"):
            require(not found.is_symlink(),"RECEIVE_DIRECTORY","Receiving tree contains a link.")
            if found.is_file():actual.add(found.relative_to(stage).as_posix())
            else:require(found.is_dir(),"RECEIVE_DIRECTORY","Receiving tree contains a special member.")
        require(actual==allowed,"RECEIVING_CONFLICT","Receiving stage has unexpected members.")
        fsync_directory(stage)
        rename_noreplace(stage,target);fsync_directory(parent)
        return {**descriptor,"directory":str(target),"received":True,"reused":False,"current":current,"receipt":binding}
    finally:
        if z:z.close()
        fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
