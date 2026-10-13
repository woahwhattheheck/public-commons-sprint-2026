#!/usr/bin/env python3
"""Complete private runtime transfer. Environment is rebuilt by original uv offline."""
import argparse, hashlib, json, os, pathlib, shutil, tarfile, tempfile
def digest(data): return hashlib.sha256(data).hexdigest()
def canon(v): return (json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode()
def measure(path):
    h=hashlib.sha256(); size=0
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block); size+=len(block)
    return {"bytes":size,"sha256":h.hexdigest()}
def inventory(root, selected):
    found=[]
    for selected_path in selected:
        start=root/selected_path
        if not start.exists(): raise RuntimeError("Complete runtime member missing: "+selected_path)
        values=[start]+sorted(start.rglob("*")) if start.is_dir() else [start]
        for p in values:
            rel=p.relative_to(root).as_posix()
            # uv 0.12.23 defines this bucket exclusively as temporary PEP 517
            # build directories and virtual environments, not reusable artifacts.
            if rel.startswith('uv-cache/builds-v0/'): continue
            if p.is_symlink():
                target=os.readlink(p)
                if pathlib.Path(target).is_absolute() or not p.resolve().is_relative_to(root.resolve()):
                    raise RuntimeError("Runtime link escapes its complete root: "+rel)
                found.append({"path":rel,"kind":"symlink","target":target})
            elif p.is_file(): found.append({"path":rel,"kind":"file","mode":p.stat().st_mode&0o777,**measure(p)})
            elif p.is_dir(): found.append({"path":rel,"kind":"directory","mode":p.stat().st_mode&0o777})
            else: raise RuntimeError("Unsupported runtime member: "+rel)
    return sorted(found,key=lambda x:x["path"])
def retained_build_staging(root):
    """Record untouched host-local temporary inputs without following their links."""
    base=root/"uv-cache"/"builds-v0"; rows=[]
    if base.is_symlink(): raise RuntimeError("The original build staging bucket is a link.")
    if not base.exists(): return {"path":"uv-cache/builds-v0","members":[]}
    for p in sorted(base.rglob("*")):
        rel=p.relative_to(root).as_posix()
        if p.is_symlink(): rows.append({"path":rel,"kind":"symlink","target":os.readlink(p)})
        elif p.is_file(): rows.append({"path":rel,"kind":"file",**measure(p)})
        elif p.is_dir(): rows.append({"path":rel,"kind":"directory"})
        else: raise RuntimeError("Unsupported build staging member: "+rel)
    return {"path":"uv-cache/builds-v0","reason":"uv temporary PEP 517 build environments; original host files retained",
            "uvSource":"https://github.com/astral-sh/uv/blob/0.12.23/crates/uv-cache/src/lib.rs",
            "members":rows}
SELECTION=["source","uv-cache","bin","source-manifest.json","selection.json",
           "expected-runtime.json","runtime.mjs","inspect.py","portable.py"]
def publish(path,data):
    if path.exists():
        if path.read_bytes()!=data: raise RuntimeError("Original publication differs: "+str(path))
        return
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=path.name+".",suffix=".partial",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f: f.write(data);f.flush();os.fsync(f.fileno())
        try: os.link(temp,path)
        except FileExistsError:
            if path.read_bytes()!=data: raise RuntimeError("Original publication differs: "+str(path))
        parent=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
    finally:
        if os.path.exists(temp): os.unlink(temp)
def check_archive(bundle,manifest):
    with tarfile.open(bundle,"r:gz") as tar:
        members=tar.getmembers()
        names=[m.name for m in members]
        declared={e["path"]:e for e in manifest["members"]}
        if len(names)!=len(set(names)) or set(names)!=(set(declared)|{"PORTABLE_MANIFEST.json"}):
            raise RuntimeError("Original archive member selection differs.")
        if tar.extractfile("PORTABLE_MANIFEST.json").read()!=canon(manifest):
            raise RuntimeError("Original archive manifest differs.")
        for member in members:
            if member.name=="PORTABLE_MANIFEST.json": continue
            e=declared[member.name]
            if e["kind"]=="directory":
                if not member.isdir(): raise RuntimeError("Original archive directory differs.")
            elif e["kind"]=="symlink":
                if not member.issym() or member.linkname!=e["target"]: raise RuntimeError("Original archive link differs.")
            else:
                if not(member.isfile() or member.islnk()): raise RuntimeError("Original archive file differs.")
                h=hashlib.sha256();size=0
                with tar.extractfile(member) as f:
                    for block in iter(lambda:f.read(1024*1024),b""): h.update(block);size+=len(block)
                if size!=e["bytes"] or h.hexdigest()!=e["sha256"]: raise RuntimeError("Original archive bytes differ.")
def pack(root,output):
    if output.resolve().is_relative_to(root.resolve()): raise RuntimeError("Export outside the runtime root.")
    output.parent.mkdir(parents=True,exist_ok=True)
    selection_path=output.with_name(output.name+".selection.json")
    runtime_id=json.loads((root/"expected-runtime.json").read_text())["runtimeId"]
    if selection_path.exists():
        selection=json.loads(selection_path.read_text())
        if selection["runtimeId"]!=runtime_id or selection["destination"]!=str(output):
            raise RuntimeError("Another original runtime owns this export destination.")
        manifest=selection["manifest"]
    else:
        manifest={"schema":"dlt-workshare.runtime-portable.v1","members":inventory(root,SELECTION),
                  "retainedHostBuildStaging":retained_build_staging(root)}
        selection={"runtimeId":runtime_id,"destination":str(output),"manifest":manifest}
        publish(selection_path,canon(selection))
    descriptor=canon(manifest)
    candidate=output.with_name(output.name+".candidate.tar.gz")
    candidate_receipt=output.with_name(output.name+".candidate.json")
    if not candidate.exists():
        if output.exists(): raise RuntimeError("The completed path has no original selected candidate.")
        if inventory(root,SELECTION)!=manifest["members"]: raise RuntimeError("Original selected runtime changed before export.")
        fd,temp=tempfile.mkstemp(prefix=output.name+".building.",dir=output.parent);os.close(fd)
        try:
            with tarfile.open(temp,"w:gz",format=tarfile.PAX_FORMAT,dereference=False) as tar:
                import io
                item=tarfile.TarInfo("PORTABLE_MANIFEST.json");item.size=len(descriptor);item.mode=0o600
                tar.addfile(item,io.BytesIO(descriptor))
                for e in manifest["members"]: tar.add(root/e["path"],arcname=e["path"],recursive=False)
            if inventory(root,SELECTION)!=manifest["members"]: raise RuntimeError("The runtime changed during export.")
            with open(temp,"rb") as f: os.fsync(f.fileno())
            os.link(temp,candidate)
        finally:
            if os.path.exists(temp): os.unlink(temp)
    check_archive(candidate,manifest)
    identity=measure(candidate)
    publish(candidate_receipt,canon({"runtimeId":runtime_id,"manifestSha256":digest(descriptor),**identity}))
    try: os.link(candidate,output)
    except FileExistsError:
        if measure(output)!=identity: raise RuntimeError("The original accepted archive changed.")
    parent=os.open(output.parent,os.O_RDONLY)
    try: os.fsync(parent)
    finally: os.close(parent)
    return {"path":str(output),**identity,"format":"tar.gz","manifestSha256":digest(descriptor),
            "members":len(manifest["members"])}
def verify_received_immutable(bundle,destination):
    with tarfile.open(bundle,"r:gz") as tar: manifest=json.load(tar.extractfile("PORTABLE_MANIFEST.json"))
    stable=[name for name in SELECTION if name!="uv-cache"]
    expected=[e for e in manifest["members"] if any(e["path"]==name or e["path"].startswith(name+"/") for name in stable)]
    if inventory(destination,stable)!=expected:
        raise RuntimeError("Original received source, executable, helpers or identity changed.")
def unpack(bundle,destination,expected):
    identity=measure(bundle)
    if identity["sha256"]!=expected: raise RuntimeError("The selected complete runtime archive differs.")
    marker=destination/"received-portable.json"
    if destination.exists():
        if not marker.is_file() or json.loads(marker.read_text())["sha256"]!=expected:
            raise RuntimeError("Receiving destination belongs to another or incomplete operation.")
        verify_received_immutable(bundle,destination)
        with tarfile.open(bundle,"r:gz") as tar: manifest=json.load(tar.extractfile("PORTABLE_MANIFEST.json"))
        return {"path":str(destination),**identity,"reused":True,
                "manifestSha256":digest(canon(manifest)),"members":len(manifest["members"])}
    destination.parent.mkdir(parents=True,exist_ok=True)
    stage=destination.with_name(destination.name+".receiving")
    # A prior interrupted extraction is private to this exact archive.
    selection=stage.with_name(stage.name+".json")
    if selection.exists() and json.loads(selection.read_text())["sha256"]!=expected:
        raise RuntimeError("Another archive owns this unfinished receiving directory.")
    if not selection.exists(): publish(selection,canon({"sha256":expected}))
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(mode=0o700)
    try:
        with tarfile.open(bundle,"r:gz") as tar:
            all_members=tar.getmembers()
            if len(all_members)>250000: raise RuntimeError("Oversized runtime inventory.")
            names=[m.name for m in all_members]
            if len(names)!=len(set(names)) or "PORTABLE_MANIFEST.json" not in names:
                raise RuntimeError("Repeated or missing runtime archive member.")
            if sum(m.size for m in all_members)>20*1024**3: raise RuntimeError("Oversized runtime transfer.")
            m=tar.getmember("PORTABLE_MANIFEST.json")
            if not m.isfile() or m.size>64*1024**2: raise RuntimeError("Invalid complete runtime manifest.")
            manifest=json.load(tar.extractfile(m))
            if manifest.get("schema")!="dlt-workshare.runtime-portable.v1": raise RuntimeError("Runtime manifest schema.")
            declared={e["path"]:e for e in manifest["members"]}
            if len(declared)!=len(manifest["members"]) or set(names)!=(set(declared)|{"PORTABLE_MANIFEST.json"}):
                raise RuntimeError("The archive and complete manifest disagree.")
            for member in all_members:
                p=pathlib.PurePosixPath(member.name)
                if p.is_absolute() or ".." in p.parts or "\\" in member.name or not member.name:
                    raise RuntimeError("Invalid runtime path.")
                if not(member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise RuntimeError("Special runtime member rejected.")
            tar.extractall(stage,filter="data")
        received=inventory(stage,SELECTION)
        strip_mode=lambda rows:[{k:v for k,v in e.items() if k!="mode"} for e in rows]
        if strip_mode(received)!=strip_mode(manifest["members"]):
            raise RuntimeError("Complete received runtime byte inventory differs.")
        # tar's data filter intentionally restricts modes; restore the manifest's
        # ordinary permissions only after every original byte/link is checked.
        for e in reversed(manifest["members"]):
            if e["kind"]!="symlink": os.chmod(stage/e["path"],e["mode"]&0o777)
        if inventory(stage,SELECTION)!=manifest["members"]:
            raise RuntimeError("Complete received runtime permissions differ.")
        publish(stage/"received-portable.json",canon({"sha256":expected,"manifestSha256":digest(canon(manifest))}))
        os.rename(stage,destination)
        parent=os.open(destination.parent,os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
        return {"path":str(destination),**identity,"manifestSha256":digest(canon(manifest)),"members":len(manifest["members"])}
    except Exception:
        # Preserve the selected partial transfer for its original caller.
        raise
p=argparse.ArgumentParser();sub=p.add_subparsers(dest="action",required=True)
a=sub.add_parser("pack");a.add_argument("--root",required=True);a.add_argument("--output",required=True)
a=sub.add_parser("unpack");a.add_argument("--bundle",required=True);a.add_argument("--directory",required=True);a.add_argument("--sha256",required=True)
args=p.parse_args()
result=pack(pathlib.Path(args.root).absolute(),pathlib.Path(args.output).absolute()) if args.action=="pack" else unpack(pathlib.Path(args.bundle).absolute(),pathlib.Path(args.directory).absolute(),args.sha256)
print(json.dumps(result,sort_keys=True))
