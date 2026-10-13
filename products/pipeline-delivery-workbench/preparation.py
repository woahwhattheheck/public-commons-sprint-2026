"""Complete original Dagster/dbt source/runtime preparation and offline receiving."""
from __future__ import annotations
import argparse,base64,csv,fcntl,gzip,hashlib,importlib,importlib.metadata,io,json,os,platform,re,shutil,stat,subprocess,sys,tarfile,time,uuid,venv
from pathlib import Path
SCHEMA="stellar-forge.pipeline-delivery-preparation.v1"
RUNTIME="stellar-forge.pipeline-delivery-runtime.v1"
TRANSFER="stellar-forge.pipeline-delivery-transfer.v1"
PINS={"dagster":"1.13.26","dbt-core":"1.12.5","dbt-duckdb":"1.11.0"}
def fail(message): raise ValueError(message)
def need(value,message):
    if not value: fail(message)
def canonical(value): return (json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode()
def digest(raw): return hashlib.sha256(raw).hexdigest()
def hashfile(path):
    h=hashlib.sha256();size=0
    with open(path,"rb") as f:
        first=os.fstat(f.fileno())
        need(stat.S_ISREG(first.st_mode),"A selected input is not an ordinary file: "+str(path))
        while True:
            block=f.read(1048576)
            if not block: break
            h.update(block);size+=len(block)
        last=os.fstat(f.fileno())
    need((first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns,first.st_ctime_ns)==(last.st_dev,last.st_ino,last.st_size,last.st_mtime_ns,last.st_ctime_ns) and size==first.st_size,"Selected bytes changed while reading")
    return {"path":str(path),"bytes":size,"sha256":h.hexdigest()}
def absolute(value):
    p=Path(os.path.abspath(os.path.expanduser(str(value))))
    need(str(p)==str(value) and "\x00" not in str(p),"Use an absolute normalized selected path")
    return p
def private(path,create=False):
    path=absolute(path)
    if create:
        parent=path.parent
        if not parent.exists(): private(parent,True)
        path.mkdir(mode=0o700,exist_ok=True)
    s=path.lstat()
    need(stat.S_ISDIR(s.st_mode) and not path.is_symlink() and path.resolve()==path and s.st_uid==os.getuid() and not s.st_mode&0o077,"Use an owned private directory: "+str(path))
    return path
def parent_sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
def atomic(path,raw,replace=False):
    path=Path(path);private(path.parent,True)
    if path.exists():
        need(path.is_file() and not path.is_symlink(),"Retained path changed type")
        if not replace:
            need(path.read_bytes()==raw,"Retained complete bytes differ: "+str(path));return hashfile(path)
    temporary=path.parent/("."+path.name+"."+uuid.uuid4().hex+".part")
    with open(temporary,"xb") as f:
        os.chmod(temporary,0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    try:
        if replace: os.replace(temporary,path)
        else:
            try: os.link(temporary,path)
            except FileExistsError: need(path.read_bytes()==raw,"Concurrent retained bytes differ")
        parent_sync(path.parent)
    finally:
        if temporary.exists(): temporary.unlink();parent_sync(path.parent)
    return hashfile(path)
def save(path,value,replace=False): return atomic(path,canonical(value),replace)
def read(path): return json.loads(Path(path).read_bytes())
def verify(row):
    p=absolute(row["path"]);need(p.is_file() and not p.is_symlink(),"Missing exact retained file: "+str(p))
    actual=hashfile(p);need(actual["bytes"]==row["bytes"] and actual["sha256"]==row["sha256"],"Retained file identity differs: "+str(p))
    return actual
def now(): return time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
def clean_env():
    env=os.environ.copy()
    for k in ("PYTHONPATH","PYTHONHOME","PYTHONUSERBASE","PYTHONSTARTUP","VIRTUAL_ENV"): env.pop(k,None)
    env.update(PYTHONDONTWRITEBYTECODE="1",PIP_DISABLE_PIP_VERSION_CHECK="1",PIP_NO_INPUT="1",DBT_SEND_ANONYMOUS_USAGE_STATS="false")
    return env
def lease(path):
    private(path.parent,True)
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    s=os.fstat(fd)
    need(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and not s.st_mode&0o077,"Use the original owned preparation lock")
    try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BaseException: os.close(fd);raise
    return fd
def source_rows(authority):
    rows=authority["files"];need(len(rows)==40,"Retain all40 original source leaves")
    seen=set()
    for row in rows:
        p=row["path"]
        need(isinstance(p,str) and not p.startswith("/") and all(x not in ("",".","..") for x in p.split("/")) and p.startswith(("workbench/","original-programme/")) and p not in seen,"Invalid complete source path")
        need(re.fullmatch("[0-9a-f]{64}",row["sha256"]) and isinstance(row["bytes"],int) and row["bytes"]>=0,"Invalid complete source identity");seen.add(p)
    need(sum(p.startswith("workbench/") for p in seen)==35 and sum(p.startswith("original-programme/") for p in seen)==5,"Preserve both original application and programme")
    return sorted(rows,key=lambda x:x["path"])
def check_source(root,authority):
    root=absolute(root);rows=source_rows(authority)
    for row in rows:
        p=root/row["path"];need(p.resolve()==p and p.is_file() and not p.is_symlink(),"Selected original source missing or linked")
        a=hashfile(p);need((a["bytes"],a["sha256"])==(row["bytes"],row["sha256"]),"Original source bytes differ: "+row["path"])
    expected={r["path"] for r in rows};actual=set()
    for prefix in ("workbench","original-programme"):
        for p in (root/prefix).rglob("*"):
            need(not p.is_symlink(),"Original source contains an unexpected link")
            if p.is_file() and "__pycache__" not in p.parts and p.suffix!=".pyc": actual.add(p.relative_to(root).as_posix())
    need(actual==expected,"The complete original source inventory differs")
    return {"manifestSha256":digest(canonical(authority)),"files":40,"bytes":sum(r["bytes"] for r in rows)}
def copy_source(source,target,authority):
    private(target,True)
    for row in source_rows(authority):
        src=source/row["path"];verify({"path":str(src),**{k:row[k] for k in ("bytes","sha256")}})
        atomic(target/row["path"],src.read_bytes())
    check_source(target,authority)
def inspection():
    """Run inside the exact selected venv. Import native libraries; never create a Dagster instance."""
    import dagster,dbt.cli.main,duckdb,yaml
    prefix=Path(sys.prefix).absolute();base=Path(sys.base_prefix).absolute()
    need(prefix!=base,"Select an isolated original Python environment")
    versions={name:importlib.metadata.version(name) for name in (*PINS,"duckdb")}
    need(all(versions[k]==v for k,v in PINS.items()),"The original Dagster/dbt package pins differ")
    distributions=[];paths={};record_paths=set()
    for dist in importlib.metadata.distributions():
        name=dist.metadata.get("Name");version=dist.version
        need(name and re.fullmatch(r"[A-Za-z0-9_.-]+",name) and version,"Invalid installed package metadata")
        normalized=re.sub(r"[-_.]+","-",name).lower()
        distributions.append({"name":normalized,"version":version})
        for entry in dist.files or []:
            p=Path(os.path.abspath(str(dist.locate_file(entry))))
            need(p.is_relative_to(prefix),"An installed package points outside its original environment: "+str(p))
            if p.suffix==".pyc" or "__pycache__" in p.parts: continue
            need(p.is_file() and not p.is_symlink(),"Missing or linked installed payload: "+str(p))
            rel=p.relative_to(prefix).as_posix();paths[rel]=p
            if rel.endswith(".dist-info/RECORD"): record_paths.add(rel)
    need(len({d["name"] for d in distributions})==len(distributions),"Duplicate installed package names")
    payload=[];by_path={};actual=[]
    for rel,p in sorted(paths.items()):
        raw=p.read_bytes();actual.append({"path":rel,"bytes":len(raw),"sha256":digest(raw)})
        if rel in record_paths: continue
        normalized=raw
        if rel.startswith("bin/"):
            try: normalized=raw.decode("utf-8").replace(str(prefix),"{RUNTIME}").encode()
            except UnicodeDecodeError: pass
        if rel.endswith(".dist-info/direct_url.json"):
            data=json.loads(raw)
            need(data.get("archive_info",{}).get("hashes",{}).get("sha256") and str(data.get("url","")).startswith("file:"),"Only a retained immutable wheel origin is portable")
            normalized=canonical({"wheel":Path(data["url"]).name,"archive_info":data["archive_info"]})
        row={"path":rel,"bytes":len(normalized),"sha256":digest(normalized)};payload.append(row);by_path[rel]=row
    # RECORD is regenerated by pip for relocated entry-point shebangs. Preserve exact original
    # bytes above and compare every declared row using the actual normalized payload identities.
    for rel in sorted(record_paths):
        rows=[]
        for parts in csv.reader(io.StringIO(paths[rel].read_text("utf-8"))):
            need(len(parts)==3,"Invalid installed RECORD")
            resolved=Path(os.path.abspath(str(paths[rel].parent.parent/parts[0])))
            need(resolved.is_relative_to(prefix),"Installed RECORD escapes the environment")
            key=resolved.relative_to(prefix).as_posix()
            if resolved.suffix==".pyc" or "__pycache__" in resolved.parts: continue
            need(key==rel or key in by_path,"Installed RECORD names missing payload")
            rows.append({"path":key,"payload":by_path.get(key)})
        normalized=canonical(sorted(rows,key=lambda x:x["path"]))
        payload.append({"path":rel,"bytes":len(normalized),"sha256":digest(normalized),"normalization":"complete-record-payload-identities"})
    # Include any ordinary site-package file not enumerated in RECORD so no extra code is hidden.
    import sysconfig
    pure=Path(sysconfig.get_path("purelib")).absolute()
    need(pure.is_relative_to(prefix),"Installed purelib is outside selected environment")
    for p in pure.rglob("*"):
        if p.suffix==".pyc" or "__pycache__" in p.parts: continue
        need(not p.is_symlink(),"Installed site-packages contains a link")
        if p.is_file(): need(p.relative_to(prefix).as_posix() in paths,"Unrecorded installed payload: "+str(p))
    dbt=prefix/"bin"/"dbt";need(dbt.is_file(),"Original dbt executable missing")
    module_paths={}
    for name,module in (("dagster",dagster),("dbt.cli.main",dbt.cli.main),("duckdb",duckdb),("yaml",yaml)):
        p=Path(module.__file__).resolve();need(p.is_relative_to(prefix),"Native import escaped the selected environment")
        module_paths[name]=p.relative_to(prefix).as_posix()
    executable=Path(sys.executable).absolute();real=executable.resolve()
    return {"schema":"stellar-forge.pipeline-delivery-installed.v1",
        "python":{"path":str(executable),"resolvedPath":str(real),**{k:v for k,v in hashfile(real).items() if k!="path"},
        "version":platform.python_version(),"implementation":platform.python_implementation(),"cacheTag":sys.implementation.cache_tag,
        "platform":sys.platform,"machine":platform.machine(),"abi":sysconfig.get_config_var("SOABI")},
        "environment":str(prefix),"dbt":{"path":str(dbt),**{k:v for k,v in hashfile(dbt).items() if k!="path"}},
        "versions":versions,"distributions":sorted(distributions,key=lambda x:x["name"]),"imports":module_paths,
        "payload":sorted(payload,key=lambda x:x["path"]),"actualFiles":actual}
def stable_installed(value):
    py=value["python"]
    return {"python":{k:py[k] for k in ("bytes","sha256","version","implementation","cacheTag","platform","machine","abi")},
        "versions":value["versions"],"distributions":value["distributions"],"imports":value["imports"],"payload":value["payload"]}
class Preparation:
    def __init__(self,root,fd,args,authority):
        self.root=root;self.fd=fd;self.args=args;self.authority=authority
        self.internal=root/".runtime";private(self.internal,True)
        self.helper=Path(__file__).absolute();self.helper_id=hashfile(self.helper)
        self.manifest_id=hashfile(args.manifest)
        self.source_summary={"manifestSha256":self.manifest_id["sha256"],"files":40,"bytes":sum(r["bytes"] for r in source_rows(authority))}
    def command(self,key,argv,cwd=None):
        base=self.internal/"commands"/key;private(base,True);selected={"argv":[str(a) for a in argv],"cwd":str(cwd or self.root)}
        save(base/"request.json",selected)
        if (base/"complete.json").exists():
            old=read(base/"complete.json");need(old["selection"]==selected and old["exitCode"]==0,"Changed completed preparation command")
            verify(old["stdout"]);verify(old["stderr"]);return old
        attempts=sorted(base.glob("attempt-*.json"))
        need(not attempts or self.args.resume,"Resume the same incomplete preparation explicitly")
        ident=uuid.uuid4().hex;out=base/(ident+".stdout");err=base/(ident+".stderr");record=base/("attempt-"+ident+".json")
        started={"schema":"stellar-forge.pipeline-delivery-command.v1","id":ident,"selection":selected,"state":"prepared","startedAt":now()}
        save(record,started);child=None;failure=None;code=None
        with open(out,"xb",buffering=0) as stdout,open(err,"xb",buffering=0) as stderr:
            os.chmod(out,0o600);os.chmod(err,0o600)
            try:
                child=subprocess.Popen(selected["argv"],cwd=selected["cwd"],env=clean_env(),stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,pass_fds=(self.fd,))
                save(record,{**started,"state":"running","pid":child.pid},True)
                code=child.wait()
            except BaseException as exc:
                failure={"type":type(exc).__name__,"message":str(exc)}
                if child is not None and child.poll() is None: child.terminate()
                if child is not None: code=child.wait()
            finally:
                if child is not None and child.poll() is None: code=child.wait()
                os.fsync(stdout.fileno());os.fsync(stderr.fileno())
        result={**started,"state":"closed","exitCode":code,"failure":failure,"completedAt":now(),"stdout":hashfile(out),"stderr":hashfile(err)}
        save(record,result,True)
        need(code==0 and failure is None,"Original preparation command failed; retain its closed logs and use the same --resume: "+str(record))
        save(base/"complete.json",result);return result
    def inspect_python(self,python,key):
        result=self.command(key,[python,"-I","-B",str(self.helper),"inspect-installed"])
        value=json.loads(Path(result["stdout"]["path"]).read_bytes())
        need(value["python"]["path"]==str(python),"Preserve the original selected venv Python invocation path")
        return value
    def observe_python(self,python):
        # Fresh read-only observation is required for reopen; a successful old command is evidence,
        # not proof that installed code is still unchanged.
        output=self.internal/("inspect-"+uuid.uuid4().hex+".json")
        result=self.command("fresh-"+uuid.uuid4().hex,[python,"-I","-B",str(self.helper),"inspect-installed"])
        return json.loads(Path(result["stdout"]["path"]).read_bytes())
    def make_environment(self,path,base_python,key):
        marker=path.parent/(path.name+"-creation.json")
        request={"path":str(path),"python":str(base_python),"kind":"original-stdlib-venv"}
        save(marker,request)
        if not (path/"pyvenv.cfg").exists() or not (path/"bin"/"python").exists() or not (self.internal/"commands"/key/"complete.json").exists():
            need(not path.exists() or not any(path.iterdir()) or self.args.resume,"Resume the original partial environment explicitly")
            self.command(key,[base_python,"-I","-B","-c","import sys,venv;venv.EnvBuilder(with_pip=True,symlinks=False).create(sys.argv[1])",str(path)])
        need((path/"bin"/"python").exists(),"Original environment creation incomplete")
        return path/"bin"/"python"
    def wheel_inventory(self,directory):
        rows=[]
        for path in sorted(directory.iterdir()):
            need(path.is_file() and not path.is_symlink() and path.name.endswith(".whl"),"Portable dependencies must be complete immutable wheels")
            rows.append({"name":path.name,**{k:v for k,v in hashfile(path).items() if k!="path"}})
        need(rows,"No original dependency wheels retained");return rows
    def install(self,python,wheels,requirements,key):
        self.command(key,[python,"-I","-B","-m","pip","install","--no-index","--find-links",str(wheels),"--no-cache-dir","--no-compile","--disable-pip-version-check","-r",str(requirements)])
    def primary(self):
        root=self.root/"primary";private(root,True);source=root/"source";copy_source(absolute(self.args.source),source,self.authority)
        runtime=root/"runtime";private(runtime,True);wheels=self.root/"wheels";private(wheels,True)
        if self.args.runtime_python:
            python=absolute(self.args.runtime_python);need(python.exists(),"Original selected runtime Python is missing")
            first=self.inspect_python(python,"adopt-original-runtime")
            frozen="".join(d["name"]+"=="+d["version"]+"\n" for d in first["distributions"])
            atomic(self.internal/"dependencies.txt",frozen.encode())
            self.command("download-original-installed-wheels",[python,"-I","-B","-m","pip","download","--only-binary=:all:","--no-deps","--dest",str(wheels),"-r",str(self.internal/"dependencies.txt")])
        else:
            python=self.make_environment(runtime/"environment",absolute(self.args.python),"create-primary-environment")
            requirement=source/"workbench"/"requirements.txt"
            need(requirement.read_text()=="dagster==1.13.26\ndbt-core==1.12.5\ndbt-duckdb==1.11.0\n","Original requirements changed")
            self.command("resolve-original-requirements",[python,"-I","-B","-m","pip","download","--only-binary=:all:","--dest",str(wheels),"-r",str(requirement)])
            self.install(python,wheels,requirement,"install-original-requirements")
            first=self.inspect_python(python,"inspect-primary-installed")
            frozen="".join(d["name"]+"=="+d["version"]+"\n" for d in first["distributions"])
            atomic(self.internal/"dependencies.txt",frozen.encode())
            self.command("retain-all-installed-wheels",[python,"-I","-B","-m","pip","download","--only-binary=:all:","--no-deps","--dest",str(wheels),"-r",str(self.internal/"dependencies.txt")])
        rows=self.wheel_inventory(wheels);save(self.internal/"wheels.json",rows)
        current=self.observe_python(python)
        need(stable_installed(current)==stable_installed(first),"Original runtime changed during complete dependency retention")
        return self.publish_runtime(root,source,python,current,rows),rows
    def publish_runtime(self,root,source,python,installed,wheels):
        runtime=root/"runtime";private(runtime,True)
        identity={"schema":RUNTIME,"source":self.source_summary,"requirements":PINS,"wheels":wheels,"installed":stable_installed(installed)}
        runtime_id=digest(canonical(identity));identity_path=runtime/"identity.json";save(identity_path,identity)
        actual_path=runtime/"installed.json";save(actual_path,installed)
        ready={"schema":RUNTIME,"state":"READY","runtimeId":runtime_id,"applicationDirectory":str(source/"workbench"),
            "programmeDirectory":str(source/"original-programme"),"sourceDirectory":str(source),"runtimeDirectory":str(runtime),
            "sourceManifestSha256":self.manifest_id["sha256"],"python":str(python),"dbt":installed["dbt"]["path"],
            "identity":hashfile(identity_path),"installed":hashfile(actual_path),"sourceAuthority":hashfile(self.root/"ORIGINAL-SOURCE.json"),
            "inspectionSource":self.helper_id,"requirements":PINS}
        path=runtime/"runtime-ready.json";save(path,ready)
        return {"applicationDirectory":ready["applicationDirectory"],"programmeDirectory":ready["programmeDirectory"],"runtimeDirectory":str(runtime),
            "runtimeReadyFile":str(path),"python":str(python),"dbt":ready["dbt"],"runtimeId":runtime_id,"ready":hashfile(path),"runtime":ready}
    def secondary(self,rows,expected):
        root=self.root/"receiving";private(root,True);source=root/"source"
        copy_source(self.root/"primary"/"source",source,self.authority)
        runtime=root/"runtime";private(runtime,True)
        python=self.make_environment(runtime/"environment",absolute(self.args.python),"create-receiving-environment")
        need(self.wheel_inventory(self.root/"wheels")==rows,"The frozen original wheel inventory changed")
        self.install(python,self.root/"wheels",self.internal/"dependencies.txt","install-receiving-offline")
        installed=self.observe_python(python)
        need(stable_installed(installed)==expected,"Independent receiving runtime differs from original full installed payload")
        return self.publish_runtime(root,source,python,installed,rows)
    def verify_runtime(self,bound):
        verify(bound["ready"]);v=read(bound["runtimeReadyFile"])
        need(v==bound["runtime"] and v["python"]==bound["python"] and v["applicationDirectory"]==bound["applicationDirectory"],"Prepared runtime binding changed")
        verify(v["identity"]);verify(v["installed"]);verify(v["sourceAuthority"]);verify(v["inspectionSource"])
        need(read(v["sourceAuthority"]["path"])==self.authority,"Runtime source authority changed")
        check_source(absolute(v["sourceDirectory"]),self.authority)
        actual=self.observe_python(absolute(v["python"]));identity=read(v["identity"]["path"])
        need(stable_installed(actual)==identity["installed"] and digest(canonical(identity))==v["runtimeId"],"Original installed payload no longer matches READY")
        return v
    def transfer(self,primary,rows):
        target=self.root/"pipeline-delivery-runtime.tar.gz"
        members=[]
        for row in source_rows(self.authority):
            members.append({"path":"source/"+row["path"],"source":str(self.root/"primary"/"source"/row["path"]),"bytes":row["bytes"],"sha256":row["sha256"]})
        for row in rows: members.append({"path":"wheels/"+row["name"],"source":str(self.root/"wheels"/row["name"]),"bytes":row["bytes"],"sha256":row["sha256"]})
        for name,path in (("ORIGINAL-SOURCE.json",self.root/"ORIGINAL-SOURCE.json"),("dependencies.txt",self.internal/"dependencies.txt"),("identity.json",Path(primary["runtime"]["identity"]["path"]))):
            a=hashfile(path);members.append({"path":name,"source":str(path),"bytes":a["bytes"],"sha256":a["sha256"]})
        selection={"schema":TRANSFER,"runtimeId":primary["runtimeId"],"source":self.source_summary,"members":[{k:v for k,v in m.items() if k!="source"} for m in sorted(members,key=lambda m:m["path"])]}
        save(self.internal/"TRANSFER.json",selection)
        if target.exists():
            self.inspect_archive(target,selection);return hashfile(target)
        temporary=self.root/".pipeline-delivery-runtime.building"
        with open(temporary,"wb") as raw:
            os.chmod(temporary,0o600)
            with gzip.GzipFile(filename="",mode="wb",fileobj=raw,mtime=0) as zipped:
                with tarfile.open(fileobj=zipped,mode="w|",format=tarfile.PAX_FORMAT) as tar:
                    manifest=canonical(selection);item=tarfile.TarInfo("TRANSFER.json");item.size=len(manifest);item.mode=0o600;tar.addfile(item,io.BytesIO(manifest))
                    for row in sorted(members,key=lambda m:m["path"]):
                        verify({"path":row["source"],"bytes":row["bytes"],"sha256":row["sha256"]})
                        item=tarfile.TarInfo(row["path"]);item.size=row["bytes"];item.mode=0o600
                        with open(row["source"],"rb") as f: tar.addfile(item,f)
            raw.flush();os.fsync(raw.fileno())
        self.inspect_archive(temporary,selection);os.link(temporary,target);parent_sync(target.parent);temporary.unlink();parent_sync(target.parent)
        return hashfile(target)
    def inspect_archive(self,archive,expected=None,output=None):
        with tarfile.open(archive,"r:gz") as tar:
            first=tar.next();need(first is not None and first.name=="TRANSFER.json" and first.isfile() and first.size<=16*1024*1024,"Complete transfer manifest must be first")
            raw=tar.extractfile(first).read();selection=json.loads(raw)
            need(selection["schema"]==TRANSFER and (expected is None or selection==expected),"Transfer selection differs")
            declared=selection["members"];names=[x["path"] for x in declared]
            need(names==sorted(names) and len(names)==len(set(names)),"Duplicate or unsorted transfer members")
            by={x["path"]:x for x in declared};seen=set();metadata={}
            fixed={"ORIGINAL-SOURCE.json","dependencies.txt","identity.json"}
            source_names={"source/"+r["path"] for r in source_rows(self.authority)}
            need(set(names).issuperset(fixed|source_names) and all(n in fixed|source_names or
                n.startswith("wheels/") and re.fullmatch(r"[A-Za-z0-9_.+-]+\.whl",n[7:]) for n in names),"Unexpected portable source/dependency member")
            for row in source_rows(self.authority):
                declared_row=by["source/"+row["path"]]
                need(declared_row["bytes"]==row["bytes"] and declared_row["sha256"]==row["sha256"],"Portable original source selection differs")
            need(by["ORIGINAL-SOURCE.json"]["sha256"]==self.manifest_id["sha256"] and
                by["ORIGINAL-SOURCE.json"]["bytes"]==self.manifest_id["bytes"],"Portable source authority differs")
            while True:
                member=tar.next()
                if member is None: break
                name=member.name
                need(member.isfile() and name in by and name not in seen and not name.startswith("/") and all(x not in ("",".","..") for x in name.split("/")),"Unexpected transfer member")
                row=by[name];need(member.size==row["bytes"],"Transfer member size differs")
                source=tar.extractfile(member);h=hashlib.sha256();size=0;destination=None;temporary=None;meta_chunks=[] if name in fixed else None
                if meta_chunks is not None: need(member.size<=64*1024*1024,"Portable metadata exceeds its complete limit")
                if output is not None:
                    destination=output/name;private(destination.parent,True);temporary=destination.parent/("."+destination.name+".incoming")
                    need(not temporary.is_symlink(),"Receiving staging file cannot be a link")
                    sink=open(temporary,"wb");os.chmod(temporary,0o600)
                else: sink=None
                try:
                    while True:
                        block=source.read(1048576)
                        if not block: break
                        h.update(block);size+=len(block)
                        if meta_chunks is not None: meta_chunks.append(block)
                        if sink: sink.write(block)
                    need(size==row["bytes"] and h.hexdigest()==row["sha256"],"Complete transfer member digest differs")
                    if sink: sink.flush();os.fsync(sink.fileno());sink.close();sink=None
                    if destination is not None:
                        if destination.exists():
                            verify({"path":str(destination),"bytes":row["bytes"],"sha256":row["sha256"]});temporary.unlink()
                        else: os.rename(temporary,destination)
                        parent_sync(destination.parent)
                finally:
                    if sink: sink.close()
                if meta_chunks is not None: metadata[name]=b"".join(meta_chunks)
                seen.add(name)
            need(seen==set(names),"Transfer is missing selected original members")
            identity=json.loads(metadata["identity.json"])
            need(json.loads(metadata["ORIGINAL-SOURCE.json"])==self.authority and
                selection["source"]==self.source_summary and identity["source"]==self.source_summary and
                identity["requirements"]==PINS and digest(canonical(identity))==selection["runtimeId"],"Portable runtime/source identity differs")
            wheel_rows=identity["wheels"];wheel_names=[row["name"] for row in wheel_rows]
            need(len(wheel_names)==len(set(wheel_names)) and wheel_names==sorted(wheel_names),"Duplicate or unordered selected wheels")
            need(set(names)==fixed|source_names|{"wheels/"+n for n in wheel_names},"Portable member set differs from the complete runtime")
            for row in wheel_rows:
                selected=by["wheels/"+row["name"]]
                need(selected["bytes"]==row["bytes"] and selected["sha256"]==row["sha256"],"Portable selected wheel identity differs")
            distributions=identity["installed"]["distributions"]
            distribution_names=[r["name"] for r in distributions]
            need(distribution_names==sorted(distribution_names) and len(distribution_names)==len(set(distribution_names)) and
                all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*",r["name"]) and isinstance(r["version"],str) and
                    re.fullmatch(r"[A-Za-z0-9.!+_-]+",r["version"]) for r in distributions),"Invalid complete dependency selection")
            locked="".join(r["name"]+"=="+r["version"]+"\n" for r in distributions).encode()
            need(metadata["dependencies.txt"]==locked,"Portable dependency rows differ from selected installed versions")
            remainder=tar.fileobj.read()
            need(not remainder.strip(b"\x00"),"Unexpected bytes after the complete transfer")
        return selection
    def receive(self):
        archive=absolute(self.args.archive);selected=hashfile(archive)
        incoming=self.root/"incoming";private(incoming,True)
        selection=self.inspect_archive(archive,output=incoming)
        need(read(incoming/"ORIGINAL-SOURCE.json")==self.authority and selection["source"]==self.source_summary,"Received full source authority differs")
        check_source(incoming/"source",self.authority)
        atomic(self.internal/"dependencies.txt",(incoming/"dependencies.txt").read_bytes())
        wheels=self.root/"wheels";private(wheels,True)
        for path in sorted((incoming/"wheels").iterdir()): atomic(wheels/path.name,path.read_bytes())
        rows=self.wheel_inventory(wheels);save(self.internal/"wheels.json",rows)
        expected=read(incoming/"identity.json")
        need(expected["wheels"]==rows and expected["source"]==self.source_summary and digest(canonical(expected))==selection["runtimeId"],"Received runtime identity differs")
        source=self.root/"primary"/"source";copy_source(incoming/"source",source,self.authority)
        root=self.root/"primary";runtime=root/"runtime";private(runtime,True)
        python=self.make_environment(runtime/"environment",absolute(self.args.python),"create-primary-environment")
        self.install(python,wheels,self.internal/"dependencies.txt","install-primary-offline")
        installed=self.observe_python(python)
        need(stable_installed(installed)==expected["installed"],"Received primary does not reproduce complete selected installed payload")
        primary=self.publish_runtime(root,source,python,installed,rows)
        secondary=self.secondary(rows,expected["installed"])
        # Keep the exact original portable bytes; no recompression identity change.
        destination=self.root/"pipeline-delivery-runtime.tar.gz"
        if not destination.exists():
            temporary=self.root/".incoming-runtime.part";shutil.copyfile(archive,temporary);os.chmod(temporary,0o600)
            verify({"path":str(temporary),"bytes":selected["bytes"],"sha256":selected["sha256"]})
            with open(temporary,"rb") as f: os.fsync(f.fileno())
            os.link(temporary,destination);parent_sync(destination.parent);temporary.unlink();parent_sync(destination.parent)
        portable=verify({"path":str(destination),"bytes":selected["bytes"],"sha256":selected["sha256"]})
        return primary,secondary,portable
    def verify_complete(self,result):
        need(result["schema"]==SCHEMA and result["state"]=="READY" and result["directory"]==str(self.root),"Wrong prepared operation")
        verify(result["request"]);need(result["source"]==self.source_summary,"Selected full source changed")
        for which in ("primary","receiving"): self.verify_runtime(result[which])
        need(result["primary"]["runtimeId"]==result["receiving"]["runtimeId"],"Independent runtime identities differ")
        verify(result["portable"]);transfer=self.inspect_archive(Path(result["portable"]["path"]))
        need(transfer["runtimeId"]==result["primary"]["runtimeId"] and transfer["source"]==self.source_summary,"Portable runtime selection differs")
        return result
    def run(self):
        result_path=self.internal/"PREPARED.json";candidate=self.internal/"candidate.json"
        if result_path.exists(): return self.verify_complete(read(result_path))
        if candidate.exists():
            result=self.verify_complete(read(candidate));save(result_path,result);return result
        if self.args.mode=="receive": primary,secondary,portable=self.receive()
        else:
            primary,rows=self.primary();secondary=self.secondary(rows,read(primary["runtime"]["identity"]["path"])["installed"])
            portable=self.transfer(primary,rows)
        result={"schema":SCHEMA,"state":"READY","directory":str(self.root),"request":hashfile(self.internal/"REQUEST.json"),
            "primary":primary,"receiving":secondary,"portable":portable,"source":self.source_summary,"completedAt":now(),"resultPath":str(result_path)}
        save(candidate,result);self.verify_complete(result);save(result_path,result);return result
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode",choices=("prepare","receive","inspect","export","inspect-runtime","inspect-installed"))
    p.add_argument("--directory");p.add_argument("--python");p.add_argument("--runtime-python");p.add_argument("--source")
    p.add_argument("--manifest");p.add_argument("--archive");p.add_argument("--output");p.add_argument("--ready");p.add_argument("--application")
    p.add_argument("--resume",action="store_true")
    args=p.parse_args()
    if args.mode=="inspect-installed": print(canonical(inspection()).decode(),end="");return
    if args.mode=="inspect-runtime":
        ready=read(args.ready);verify(ready["identity"]);verify(ready["sourceAuthority"]);verify(ready["inspectionSource"])
        need(ready["schema"]==RUNTIME and ready["state"]=="READY" and (not args.application or ready["applicationDirectory"]==args.application),"Selected runtime/source differs")
        need(str(Path(sys.executable).absolute())==ready["python"],"Invoke the exact original venv Python path")
        identity=read(ready["identity"]["path"]);current=inspection()
        need(stable_installed(current)==identity["installed"] and digest(canonical(identity))==ready["runtimeId"],"Runtime no longer matches its complete installed identity")
        check_source(absolute(ready["sourceDirectory"]),read(ready["sourceAuthority"]["path"]))
        print(canonical({"schema":RUNTIME,"state":"READY","runtime":ready,"verifiedAt":now()}).decode(),end="");return
    root=absolute(args.directory)
    selected_source=absolute(args.source) if args.source else None
    manifest_path=absolute(args.manifest)
    need(not root.is_relative_to(manifest_path.parent),"Keep preparation outside the installed source")
    if selected_source: need(not root.is_relative_to(selected_source) and not selected_source.is_relative_to(root),"Keep selected source and preparation separate")
    root=private(root,True);fd=lease(root/".preparation.lock")
    try:
        args.manifest=str(absolute(args.manifest));authority=read(args.manifest);source_rows(authority)
        authority_raw=Path(args.manifest).read_bytes();atomic(root/"ORIGINAL-SOURCE.json",authority_raw)
        need(hashfile(root/"ORIGINAL-SOURCE.json")["sha256"]==hashfile(args.manifest)["sha256"],"Source authority bytes differ")
        old_path=root/".runtime"/"REQUEST.json"
        if args.mode in ("inspect","export"):
            need(old_path.exists(),"Original preparation request is missing")
            original=read(old_path)
            for name in ("python","runtime_python","source","archive"): setattr(args,name,original.get(name))
            args.resume=True
        else:
            args.python=str(absolute(args.python));args.source=str(absolute(args.source)) if args.source else None
            args.runtime_python=str(absolute(args.runtime_python)) if args.runtime_python else None
            args.archive=str(absolute(args.archive)) if args.archive else None
            request={"schema":SCHEMA,"mode":args.mode,"directory":str(root),"python":args.python,"runtime_python":args.runtime_python,
                "source":args.source,"archive":args.archive,"archiveIdentity":hashfile(args.archive) if args.archive else None,
                "sourceManifest":hashfile(args.manifest),"preparationSource":hashfile(Path(__file__).absolute())}
            if old_path.exists():
                need(read(old_path)==request,"Resume the same original preparation request")
                need(args.resume or (root/".runtime"/"PREPARED.json").exists(),"Continue incomplete preparation with --resume")
            save(old_path,request)
        operation=Preparation(root,fd,args,authority)
        if args.mode in ("inspect","export"):
            result=operation.verify_complete(read(root/".runtime"/"PREPARED.json"))
            if args.mode=="inspect": answer={"schema":SCHEMA,"state":"READY","result":result,"verifiedAt":now()}
            else:
                target=absolute(args.output);private(target.parent)
                need(not target.is_relative_to(root),"Export beside the preparation, preserving all original files")
                selected=result["portable"]
                if not target.exists():
                    temporary=target.parent/("."+target.name+"."+uuid.uuid4().hex+".part")
                    shutil.copyfile(selected["path"],temporary);os.chmod(temporary,0o600)
                    verify({"path":str(temporary),"bytes":selected["bytes"],"sha256":selected["sha256"]})
                    with open(temporary,"rb") as f: os.fsync(f.fileno())
                    os.link(temporary,target);parent_sync(target.parent);temporary.unlink();parent_sync(target.parent)
                portable=verify({"path":str(target),"bytes":selected["bytes"],"sha256":selected["sha256"]})
                answer={"schema":SCHEMA,"state":"EXPORTED","portable":portable,"source":result["source"],"runtimeId":result["primary"]["runtimeId"]}
        else: answer=operation.run()
        print(canonical(answer).decode(),end="")
    finally: os.close(fd)
if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(canonical({"state":"FAILED","error":{"type":type(exc).__name__,"message":str(exc)}}).decode(),file=sys.stderr,end="")
        raise SystemExit(2)
