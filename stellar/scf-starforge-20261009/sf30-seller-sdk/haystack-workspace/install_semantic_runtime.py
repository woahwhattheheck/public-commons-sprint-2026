#!/usr/bin/env python3
"""Receive the selected semantic wheel archive and install it without network access."""
from __future__ import annotations
import argparse, contextlib, fcntl, hashlib, json, os, platform, signal, stat, subprocess, sys, tempfile, time, zipfile
from pathlib import Path, PurePosixPath
import venv, uuid

SCHEMA="commons.haystack.semantic-runtime-receipt.v1"
MANIFEST_SCHEMA="commons.haystack.semantic-dependencies.v1"
ARCHIVE_SCHEMA="commons.haystack.semantic-offline-archive.v1"

def digest_file(path):
    digest=hashlib.sha256();size=0
    with Path(path).open("rb") as stream:
        before=os.fstat(stream.fileno())
        for block in iter(lambda:stream.read(1024*1024),b""):digest.update(block);size+=len(block)
        after=os.fstat(stream.fileno())
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
        raise ValueError("A retained input changed while being read")
    return {"bytes":size,"sha256":digest.hexdigest()}

def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode("utf-8")

def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:os.fchmod(out.fileno(),0o600);out.write(canonical(value)+b"\n");out.flush();os.fsync(out.fileno())
        os.replace(temporary,path)
    finally:Path(temporary).unlink(missing_ok=True)

def safe_member(name):
    if not isinstance(name,str) or not name or "\\" in name or "\0" in name or name.endswith("/"):raise ValueError("The offline archive contains an invalid file path")
    path=PurePosixPath(name)
    if path.is_absolute() or any(part in ("",".","..") for part in name.split("/")):raise ValueError("The offline archive contains an unsafe path")
    return path

def ensure_directory(path):
    path=Path(path)
    if not path.is_absolute() or ".." in path.parts:raise ValueError("Use an absolute directory without parent traversal")
    cursor=Path(path.anchor)
    for part in path.parts[1:]:
        cursor=cursor/part
        if cursor.is_symlink():raise ValueError("An original receiving directory is linked: "+str(cursor))
        if cursor.exists():
            if not cursor.is_dir():raise ValueError("An original receiving directory is not a directory: "+str(cursor))
        else:cursor.mkdir(mode=0o700)
    return path

def regular(path):
    path=Path(path)
    if path.is_symlink() or not path.is_file():raise ValueError("A selected archive or source must be a regular file: "+str(path))
    return path

def announce(event,**values):
    print(json.dumps({"event":event,**values},separators=(",",":")),file=sys.stderr,flush=True)

def command(argv,log_path):
    child=None
    try:
        with log_path.open("ab") as log:
            child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            last=0
            while child.poll() is None:
                try:child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    if time.monotonic()-last>=5:last=time.monotonic();announce("INSTALL_PROGRESS",pid=child.pid,log_bytes=log_path.stat().st_size)
        if child.returncode:raise RuntimeError("The original offline install command exited "+str(child.returncode)+": "+log_path.read_text(errors="replace")[-8000:])
    finally:
        if child is not None and child.poll() is None:
            with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGTERM)
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGKILL)
                child.wait(timeout=10)

def observe(directory,manifest):
    packages={row["name"]:row["version"] for row in manifest["packages"]}
    code="import contextlib,hashlib,importlib,importlib.metadata,io,json,platform,sys; held=io.StringIO()\nwith contextlib.redirect_stdout(held):\n import brickschema,rdflib,pyshacl\n"
    code+="versions={name:importlib.metadata.version(name) for name in "+repr(list(packages))+"}\n"
    code+="sources=[]\n"
    code+="for item in "+repr(manifest["engineSources"])+":\n module=importlib.import_module(item['module']);body=open(module.__file__,'rb').read();sources.append({'module':item['module'],'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})\n"
    code+="print(json.dumps({'python':platform.python_version(),'executable':sys.executable,'platform':sys.platform,'machine':platform.machine(),'versions':versions,'engineSources':sources,'importMessages':held.getvalue()}))\n"
    result=subprocess.run([str(directory/"bin"/"python"),"-I","-c",code],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
    if result.returncode:raise RuntimeError("The selected installed engine could not be imported: "+result.stderr.decode("utf-8","replace")[-8000:])
    actual=json.loads(result.stdout)
    if actual["versions"]!=packages:raise ValueError("Installed dependency versions differ from the selected archive")
    expected={row["module"]:(row["bytes"],row["sha256"]) for row in manifest["engineSources"]}
    if {row["module"]:(row["bytes"],row["sha256"]) for row in actual["engineSources"]}!=expected:raise ValueError("The installed engine source differs from its original wheel")
    if actual["platform"]!="linux" or actual["machine"] not in ("x86_64","AMD64") or not actual["python"].startswith("3.12."):raise ValueError("This original offline wheel archive targets CPython 3.12 on Linux x86_64")
    return actual

def installed_inventory(directory):
    rows=[]
    for path in sorted(directory.rglob("*")):
        name=path.relative_to(directory).as_posix()
        if name=="semantic-runtime-receipt.json" or "__pycache__" in path.parts or path.suffix==".pyc":continue
        metadata=path.lstat()
        if stat.S_ISDIR(metadata.st_mode):continue
        if stat.S_ISLNK(metadata.st_mode):
            rows.append({"path":name,"kind":"symlink","target":os.readlink(path)})
        elif stat.S_ISREG(metadata.st_mode):
            rows.append({"path":name,"kind":"file","mode":stat.S_IMODE(metadata.st_mode),**digest_file(path)})
        else:raise ValueError("The installed environment contains an unsupported file type")
    return rows

def reconcile_archive_staging(source_root,record,record_path,expected):
    # Only the exact temporary paths reserved by this original install are owned here.
    rows=record.setdefault("archiveStaging",[])
    for row in rows:
        relative=safe_member(row["path"]);destination=row["destination"]
        if destination not in expected or relative.parent!=safe_member(destination).parent or not re_member_name(relative.name):
            raise ValueError("The original archive temporary identity differs")
        if row.get("state") in ("CLEARED","NOT_CREATED"):continue
        path=source_root/relative;ensure_directory(path.parent)
        if path.is_symlink() or (path.exists() and not path.is_file()):raise ValueError("An owned archive temporary has an unsupported type")
        if path.exists():
            observed=path.stat()
            if row.get("identity") and [observed.st_dev,observed.st_ino]!=row["identity"]:
                raise ValueError("An owned archive temporary was replaced")
            path.unlink()
        row["state"]="CLEARED";row["reconciled"]=True;write_json(record_path,record)

def re_member_name(name):
    if not name.startswith(".member-"):return False
    try:return uuid.UUID(hex=name[8:]).hex==name[8:]
    except (ValueError,AttributeError):return False

def receive_archive(archive,manifest,source_root,record,record_path):
    selected=manifest["archive"];actual=digest_file(archive)
    if actual!={"bytes":selected["bytes"],"sha256":selected["sha256"]}:raise ValueError("The complete selected offline archive size or SHA-256 differs")
    with zipfile.ZipFile(archive) as z:
        infos=z.infolist()
        if len(infos)>10000 or len({info.filename for info in infos})!=len(infos):raise ValueError("The offline archive inventory is repeated or excessive")
        if sum(info.file_size for info in infos)>256*1024*1024:raise ValueError("The offline archive expansion exceeds the retained bound")
        by_name={info.filename:info for info in infos}
        for info in infos:
            safe_member(info.filename)
            kind=(info.external_attr>>16)&0o170000
            if kind not in (0,stat.S_IFREG) or info.flag_bits&1:raise ValueError("The offline archive contains an unsupported member")
        if "DEPENDENCY_MANIFEST.json" not in by_name:raise ValueError("The original archive member manifest is missing")
        raw=z.read("DEPENDENCY_MANIFEST.json")
        if {"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}!=manifest["memberManifest"]:raise ValueError("The original archive member manifest differs")
        retained=json.loads(raw)
        if retained.get("schema")!=ARCHIVE_SCHEMA:raise ValueError("The original archive member manifest schema differs")
        members=retained["files"];expected={row["path"]:row for row in members}
        if len(expected)!=len(members) or set(by_name)!=(set(expected)|{"DEPENDENCY_MANIFEST.json"}):raise ValueError("The complete original offline archive inventory differs")
        ensure_directory(source_root)
        reconcile_archive_staging(source_root,record,record_path,expected)
        for name,row in expected.items():
            info=by_name[name]
            if info.file_size!=row["bytes"] or info.file_size>32*1024*1024:raise ValueError("An original member size differs")
            destination=source_root/safe_member(name);ensure_directory(destination.parent)
            if destination.is_symlink():raise ValueError("A retained original offline input is linked")
            if destination.exists():
                if destination.is_symlink() or digest_file(destination)!={"bytes":row["bytes"],"sha256":row["sha256"]}:raise ValueError("A retained original offline input differs")
                continue
            temporary=destination.parent/(".member-"+uuid.uuid4().hex)
            staging={"path":temporary.relative_to(source_root).as_posix(),"destination":name,"state":"RESERVED"}
            record["archiveStaging"].append(staging);write_json(record_path,record)
            fd=None;created=False;digest=hashlib.sha256();count=0
            try:
                try:fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
                except FileExistsError:
                    staging["state"]="NOT_CREATED";write_json(record_path,record);raise
                created=True
                metadata=os.fstat(fd);staging.update({"state":"WRITING","identity":[metadata.st_dev,metadata.st_ino]});write_json(record_path,record)
                with os.fdopen(fd,"wb") as out:
                    fd=None
                    with z.open(info) as incoming:
                        for block in iter(lambda:incoming.read(1024*1024),b""):digest.update(block);count+=len(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                if count!=row["bytes"] or digest.hexdigest()!=row["sha256"]:raise ValueError("An original offline member hash differs")
                os.link(temporary,destination)
            finally:
                if fd is not None:os.close(fd)
                if created and temporary.exists():
                    observed=temporary.lstat()
                    if not stat.S_ISREG(observed.st_mode) or (staging.get("identity") and [observed.st_dev,observed.st_ino]!=staging["identity"]):
                        raise ValueError("Preserve a replaced archive temporary")
                    temporary.unlink()
                if created:staging["state"]="CLEARED";write_json(record_path,record)
        if {path.relative_to(source_root).as_posix() for path in source_root.rglob("*") if path.is_file()}!=set(expected):raise ValueError("The retained offline inputs contain unrelated files")
    return retained

def install(args):
    if sys.implementation.name!="cpython" or sys.version_info[:2]!=(3,12) or sys.platform!="linux" or platform.machine() not in ("x86_64","AMD64"):
        raise ValueError("This exact offline archive requires CPython 3.12 on Linux x86_64; select a matching receiving interpreter")
    manifest_path=regular(args.manifest);archive=regular(args.archive);directory=args.directory
    if not manifest_path.is_absolute() or not archive.is_absolute() or not directory.is_absolute():raise ValueError("Use absolute manifest, archive and directory paths")
    if directory.is_symlink():raise ValueError("The selected environment directory is linked")
    manifest_bytes=manifest_path.read_bytes();manifest=json.loads(manifest_bytes)
    if manifest.get("schema")!=MANIFEST_SCHEMA:raise ValueError("The semantic dependency manifest schema differs")
    ensure_directory(directory.parent)
    record_path=directory.parent/("."+directory.name+".semantic-install.json")
    source_root=directory.parent/("."+directory.name+".semantic-inputs")
    lock_path=directory.parent/("."+directory.name+".semantic-install.lock")
    binding={"directory":str(directory),"archiveSha256":manifest["archive"]["sha256"],"manifestSha256":hashlib.sha256(manifest_bytes).hexdigest(),"installerSha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    for retained in (record_path,lock_path):
        if retained.is_symlink() or (retained.exists() and not retained.is_file()):raise ValueError("An original installation record or lock differs")
    with os.fdopen(os.open(lock_path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a+b") as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
        prior=json.loads(record_path.read_text()) if record_path.is_file() else None
        if prior is not None and prior.get("binding")!=binding:raise ValueError("The original installation record is bound to another source or destination")
        if directory.exists() and prior is None:raise ValueError("An existing environment has no matching original installation record")
        receipt_path=directory/"semantic-runtime-receipt.json"
        if receipt_path.is_file():
            receipt=json.loads(receipt_path.read_text())
            if receipt.get("binding")!=binding or receipt.get("state")!="COMPLETE":raise ValueError("The existing environment receipt differs")
            observed=observe(directory,manifest)
            if installed_inventory(directory)!=receipt["files"]:raise ValueError("The original installed source inventory changed")
            return {**receipt,"reopened":True,"observed":observed}
        record=prior or {"schema":"commons.haystack.semantic-install-operation.v1","binding":binding,"state":"PREPARED"}
        write_json(record_path,record)
        try:
            retained=receive_archive(archive,manifest,source_root,record,record_path)
            requirements=regular(source_root/"requirements-semantic.txt")
            if digest_file(requirements)!=manifest["requirements"]:raise ValueError("The original complete requirements selection differs")
            selected_wheels={row["filename"]:(row["bytes"],row["sha256"]) for row in manifest["packages"]}
            actual_wheels={}
            for path in (source_root/"wheels").glob("*.whl"):
                observed_wheel=digest_file(regular(path));actual_wheels[path.name]=(observed_wheel["bytes"],observed_wheel["sha256"])
            if actual_wheels!=selected_wheels:raise ValueError("The complete selected wheel set differs")
            record.update({"state":"INSTALLING","sourceDirectory":str(source_root)});write_json(record_path,record)
            # A venv remains at its final path: moving it would break script shebangs.
            venv.EnvBuilder(with_pip=True,clear=False,symlinks=False,upgrade_deps=False).create(directory)
            python=directory/"bin"/"python"
            log=directory.parent/("."+directory.name+".semantic-install.log")
            command([str(python),"-m","pip","--isolated","install","--no-index","--find-links",str(source_root/"wheels"),
                     "--require-hashes","--force-reinstall","--no-cache-dir","--disable-pip-version-check","-r",str(requirements)],log)
            observed=observe(directory,manifest)
            receipt={"schema":SCHEMA,"state":"COMPLETE","binding":binding,"python":str(python),"observed":observed,
                     "files":installed_inventory(directory),"archive":manifest["archive"],"memberManifest":manifest["memberManifest"],
                     "networkUsed":False,"sourceDirectory":str(source_root),"reopened":False}
            write_json(receipt_path,receipt);record.update({"state":"COMPLETE","receipt":str(receipt_path)});write_json(record_path,record)
            return receipt
        except BaseException as error:
            record.update({"state":"INTERRUPTED" if isinstance(error,(InterruptedError,KeyboardInterrupt)) else "FAILED","error":{"type":type(error).__name__,"message":str(error)}})
            with contextlib.suppress(Exception):write_json(record_path,record)
            raise

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive",type=Path,required=True)
    parser.add_argument("--directory",type=Path,required=True)
    parser.add_argument("--manifest",type=Path,default=Path(__file__).resolve().with_name("semantic-dependencies.json"))
    args=parser.parse_args()
    def interrupted(signum,frame):raise InterruptedError("Semantic runtime installation interrupted by signal "+str(signum))
    for number in (signal.SIGINT,signal.SIGTERM):signal.signal(number,interrupted)
    try:
        result=install(args);print(json.dumps(result,separators=(",",":")),flush=True);return 0
    except BaseException as error:
        print(json.dumps({"schema":SCHEMA,"state":"FAILED","error":{"type":type(error).__name__,"message":str(error)}},separators=(",",":")),flush=True)
        return 130 if isinstance(error,(InterruptedError,KeyboardInterrupt)) else 1

if __name__=="__main__":raise SystemExit(main())
