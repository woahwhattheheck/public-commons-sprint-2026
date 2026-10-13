#!/usr/bin/env python3
"""Resume the original installed Audit operation with persistent, complete custody.
MIT. Original customer sources are supplied separately in their existing private packet.
"""
from __future__ import annotations
import argparse
import ast
import base64
import ctypes
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import contextlib
import stat
import subprocess
import sys
import time
import traceback
import uuid
import zipfile

OPERATION = "AUDIT-EXCHANGE-INSTALLED-70D2-20261013"
REPOSITORY = "woahwhattheheck/tjlabs-stellar-merchant-workspace"
DEFAULT_COMMIT = "a21b71414113a1e9dc3e14335f166a85ef8a0950"
ORIGINAL_GIT = "823b50825803cae21da8e0896b21229a19fa547f"
PAYLOAD_SHA = "2750323908a22b1190b94a167c1d5f4ee28d0d0201647fa9f07d33205d291aac"
PREFIX = "stellar/scf-starforge-20261009"
SCHEMA = "commons.audit-installed-persistent.v1"


def need(value, message):
    if not value:
        raise RuntimeError(message)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def ordinary(path):
    path = Path(path)
    need(path.absolute() == path.resolve(), "Keep original paths and every ancestor ordinary: " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "Select a complete ordinary file.")
        with os.fdopen(os.dup(fd), "rb") as source:
            return source.read()
    finally:
        os.close(fd)


def executable(value, label):
    selected=str(value)
    found=selected if os.path.isabs(selected) else shutil.which(selected)
    need(found is not None, "Select the existing "+label+" executable.")
    path=Path(found).resolve()
    need(path.is_file() and os.access(path,os.X_OK), "Select the actual executable "+label+".")
    return str(path)


def file_identity(path):
    path=Path(path)
    digest=hashlib.sha256()
    total=0
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):
            digest.update(chunk);total+=len(chunk)
    return {"bytes":total,"sha256":digest.hexdigest()}


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def directory(path):
    path = Path(path).absolute()
    need(path == path.resolve(), "Choose a private ordinary directory without symlink ancestors.")
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    need(path.is_dir() and not path.is_symlink(), "Choose an ordinary directory.")
    return path


def retain(path, raw):
    path = Path(path)
    raw = raw if isinstance(raw, bytes) else encoded(raw)
    directory(path.parent)
    if path.exists():
        need(ordinary(path) == raw, "Preserve the original immutable file: " + str(path))
        sync_directory(path.parent)
        return
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".pending")
    try:
        with temp.open("xb") as out:
            os.chmod(temp, 0o600)
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(temp, path, follow_symlinks=False)
        except FileExistsError:
            need(ordinary(path) == raw, "The original retained file differs.")
        sync_directory(path.parent)
    finally:
        if temp.exists():
            temp.unlink()
            sync_directory(path.parent)


def load(path):
    return json.loads(ordinary(path))


def original_payload(packet_path):
    raw = ordinary(packet_path)
    if len(raw)==153315 and sha(raw)==PAYLOAD_SHA:
        payload=json.loads(raw)
        need(payload["repository"]==REPOSITORY,"Keep the original public product repository.")
        return raw, raw, payload
    need(git(raw) == ORIGINAL_GIT, "Use the complete unchanged original 823b5082 packet or exact 153315-byte Canvas payload.")
    packet = json.loads(raw)
    body = next(item["content"] for item in packet["files"] if item["path"] == "RUN_INSTALLED_AUDIT.py")
    tree = ast.parse(body)
    selected = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "b64decode":
            if len(node.args) == 1 and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                selected = base64.b64decode(node.args[0].value, validate=True)
                break
    need(selected is not None, "The full original payload is absent.")
    full = gzip.decompress(selected)
    need(len(full) == 153315 and sha(full) == PAYLOAD_SHA, "The complete original payload differs.")
    payload = json.loads(full)
    need(payload["repository"] == REPOSITORY, "Keep the original public product repository.")
    return raw, full, payload


def replace_once(body, before, after):
    need(body.count(before) == 1, "The exact original controller correction no longer matches.")
    return body.replace(before, after, 1)


def corrected_controller(body):
    """Changes process lifetime and retention durability; all business requests stay original."""
    body = replace_once(body,
        ' if(fs.existsSync(file)){need(!fs.lstatSync(file).isSymbolicLink()&&fs.readFileSync(file).equals(raw),"Retained original differs: "+file);return;}',
        ' if(fs.existsSync(file)){need(!fs.lstatSync(file).isSymbolicLink()&&fs.readFileSync(file).equals(raw),"Retained original differs: "+file);syncParent(file);return;}')
    body = replace_once(body, ' finally{fs.unlinkSync(temp);}\n}\nfunction selected',
        ' finally{fs.unlinkSync(temp);}\n syncParent(file);\n}\nfunction syncParent(file){const fd=fs.openSync(path.dirname(file),"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}\nfunction selected')
    start = body.index("async function command(")
    end = body.index("async function unusedPort()", start)
    body = body[:start] + r'''async function command(name,argv,{env=process.env,timeout=600000}={}){
 const logs=path.join(root,"logs");fs.mkdirSync(logs,{recursive:true,mode:0o700});
 const out=fs.openSync(path.join(logs,name+".stdout"),"a",0o600);
 const err=fs.openSync(path.join(logs,name+".stderr"),"a",0o600);
 let child,timer,escalation,timedOut=false;
 try{
  child=spawn(argv[0],argv.slice(1),{cwd:root,env,stdio:["ignore",out,err],shell:false});
  const exit=await new Promise((resolve,reject)=>{
   let launchError;
   child.once("error",error=>{launchError=error;});
   child.once("close",(code,signal)=>resolve({code,signal,error:launchError}));
   timer=setTimeout(()=>{timedOut=true;child.kill("SIGTERM");
    escalation=setTimeout(()=>child.kill("SIGKILL"),10000);},timeout);
  });
  need(!exit.error,name+" could not launch; retain its original error and log.");
  need(!timedOut,name+" closed after its timeout; retain the original complete logs and request.");
  need(exit.code===0,name+" failed; retain the complete original log.");
  return fs.readFileSync(path.join(logs,name+".stdout"),"utf8");
 }finally{clearTimeout(timer);clearTimeout(escalation);fs.closeSync(out);fs.closeSync(err);}
}
''' + body[end:]
    body = replace_once(body,
        'need(inspection.ready,"The selected original Runtime must be READY.");retain(path.join(root,"runtime-inspection.json"),inspection);',
        'need(inspection.ready,"The selected original Runtime must be READY.");retain(path.join(root,"runtime-inspections",sha(bytes(inspection))+".json"),inspection);')
    body = replace_once(body, ' report.finishedAt=new Date().toISOString();',
        ' if(report.closeError||report.stopErrors?.length){report.state="INTERRUPTED";report.failedPhase="owned-process-drain";}\n report.finishedAt=new Date().toISOString();')
    return body


def original_child_table():
    """Read only this producing process's descendants, including reparented children."""
    result = {}
    pending = ["self"]
    seen = set()
    while pending:
        parent = pending.pop()
        if parent in seen:
            continue
        seen.add(parent)
        task = Path("/proc") / parent / "task"
        try:
            tids = list(task.iterdir())
        except FileNotFoundError:
            continue
        for tid in tids:
            try:
                children = (tid / "children").read_text().split()
            except FileNotFoundError:
                continue
            for child in children:
                proc = Path("/proc") / child
                try:
                    text = (proc / "stat").read_text()
                    fields = text[text.rfind(")") + 2:].split()
                    status = (proc / "status").read_text()
                    ns = next(line.split()[1:] for line in status.splitlines() if line.startswith("NSpid:"))
                    row = {"procPid": child, "pid": int(ns[-1]), "start": fields[19], "state": fields[0]}
                except (FileNotFoundError, ProcessLookupError):
                    continue
                result[child] = row
                pending.append(child)
    return result


def signal_original(row, sig):
    descriptor=None
    try:
        # Pin the namespace process before rechecking its original proc/start
        # identity; PID reuse cannot redirect a signal to a later process.
        descriptor=os.pidfd_open(row["pid"],0)
        text=(Path("/proc")/row["procPid"]/"stat").read_text()
        fields=text[text.rfind(")")+2:].split()
        if fields[19]!=row["start"]:
            return
        signal.pidfd_send_signal(descriptor,sig,None,0)
    except (FileNotFoundError, ProcessLookupError):
        pass
    finally:
        if descriptor is not None:
            os.close(descriptor)


def reap():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
            if pid == 0:
                return
        except ChildProcessError:
            return


def drain():
    """Subreaper makes detached descendants children before the saved case is archived."""
    observed = []
    for sig, duration in ((signal.SIGTERM, 20), (signal.SIGKILL, 10)):
        deadline = time.monotonic() + duration
        while True:
            reap()
            children = original_child_table()
            if not children:
                return observed
            for row in children.values():
                observed.append({**row, "signal": sig.name})
                signal_original(row, sig)
            if time.monotonic() >= deadline:
                break
            time.sleep(.1)
    raise RuntimeError("Original descendants remain after drain; retain the lease and logs, do not archive live state.")


class Course:
    def __init__(self, args, guard, root, payload):
        self.args, self.guard, self.root, self.payload = args, guard, root, payload
        self.attempt = directory(root / "attempts" / (time.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:12]))
        self.events = []
        self.env = dict(os.environ)
        temporary = directory(root / "temporary")
        self.env.update(TMPDIR=str(temporary), TEMP=str(temporary), TMP=str(temporary))
        self.env["AUDIT_PYTHON"] = executable(args.python,"Python")
        self.node = executable(args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node","Node")
        held = os.fstat(guard)
        self.env["AUDIT_INSTALLED_LEASE_FD"] = str(guard)
        self.env["AUDIT_INSTALLED_LEASE_ID"] = json.dumps({"path":str(root / "operation.lock"),"dev":str(held.st_dev),"ino":str(held.st_ino)})
        preload = root / "controller-source" / "inherited-lease.mjs"
        self.env["NODE_OPTIONS"] = self.env.get("NODE_OPTIONS", "") + " --import=" + json.dumps(preload.as_uri())

    def event(self, stage, **data):
        row = {"operation": OPERATION, "at": now(), "stage": stage, **data}
        self.events.append(row)
        retain(self.attempt / "events" / (str(len(self.events)).zfill(4) + ".json"), row)
        print(json.dumps(row), flush=True)
        return row

    def run(self, label, args, timeout=900, cwd=None):
        out = self.attempt / (label + ".stdout")
        err = self.attempt / (label + ".stderr")
        with out.open("xb") as stdout, err.open("xb") as stderr:
            child = subprocess.Popen([str(x) for x in args], cwd=cwd or self.root,
                env=self.env, stdout=stdout, stderr=stderr, pass_fds=(self.guard,), start_new_session=True)
            self.event(label + "-started", pid=child.pid, stdout=str(out), stderr=str(err))
            try:
                code = child.wait(timeout=timeout)
            except BaseException:
                with contextlib.suppress(ProcessLookupError):
                    child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        child.kill()
                    child.wait()
                drain()
                raise
            stdout.flush(); stderr.flush()
            os.fsync(stdout.fileno()); os.fsync(stderr.fileno())
        self.event(label + "-returned", exitCode=code)
        need(code == 0, label + " returned " + str(code) + "; reopen its complete original log.")
        return ordinary(out)

    def generation(self, commit):
        need(re.fullmatch(r"[a-f0-9]{40}", commit), "Select one complete exact public source commit.")
        gen = directory(self.root / "generations" / commit)
        retain(gen / "selection.json", {"repository": REPOSITORY, "commit": commit, "selection": "audit-exchange"})
        source = gen / "source"
        if self.args.checkout:
            checkout = Path(self.args.checkout).absolute()
            need(checkout == checkout.resolve(), "Use the ordinary complete original source checkout.")
            actual = self.run("provided-source-head", ["git","-C",checkout,"rev-parse","HEAD"],30).decode().strip()
            need(actual == commit, "The supplied complete source is not the selected commit.")
            self.run("provided-source-clean", ["git","-C",checkout,"diff","--no-ext-diff","--quiet","HEAD","--"],30)
            # Keep an independent complete Git object/ref copy in this generation.
            if not (source / ".git").exists():
                directory(source)
                self.run("source-init", ["git","init","--quiet",source],30)
            if not (gen / "source-complete.json").exists():
                self.run("source-receive",["git","-C",source,"fetch","--depth=1",checkout,commit],900)
        else:
            if not (source / ".git").exists():
                directory(source)
                self.run("source-init",["git","init","--quiet",source],30)
            if not (gen / "source-complete.json").exists():
                self.run("source-fetch",["git","-C",source,"fetch","--depth=1","https://github.com/"+REPOSITORY+".git",commit],900)
        if (gen / "source-complete.json").exists():
            need(self.run("retained-source-head",["git","-C",source,"rev-parse","HEAD"],30).decode().strip()==commit, "Preserve the retained source head.")
            self.run("retained-source-clean",["git","-C",source,"diff","--no-ext-diff","--quiet","HEAD","--"],30)
        self.run("source-checkout",["git","-C",source,"checkout","--quiet","--detach",commit],600)
        need(self.run("source-head",["git","-C",source,"rev-parse","HEAD"],30).decode().strip()==commit, "The retained source commit differs.")
        self.run("source-clean",["git","-C",source,"diff","--no-ext-diff","--quiet","HEAD","--"],30)
        retain(gen / "source-complete.json",{"repository":REPOSITORY,"commit":commit})
        dist = source / PREFIX / "distribution"
        release = gen / "release"
        build_args = [self.node,dist/"build.mjs","--repo",source,"--ref",commit,"--selection","audit-exchange","--python",self.args.python,"--out",release]
        if release.exists():
            build_args.append("--resume")
        build = json.loads(self.run("selected-source-build",build_args,1800))
        need(build.get("status")=="PACKAGED" and build.get("sourceCommit")==commit, "The selected original build did not complete.")
        retain(gen/"build-observations"/(sha(encoded(build))+".json"),build)
        # Original Runtime recovery retains each incomplete preparation. A failed
        # extraction is recovered through its native API into the next directory.
        installs = directory(gen / "installations")
        candidates = sorted(p for p in installs.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}",p.name))
        runtime = candidates[-1] if candidates else installs / "0001"
        if runtime.exists() and not (runtime / "runtime-install.json").exists():
            previous = runtime
            runtime = installs / str(int(previous.name)+1).zfill(4)
            if (previous / "preparation.json").exists():
                recovered = json.loads(self.run("runtime-recover",[self.node,dist/"runtime-install-cli.mjs","recover","--from",previous,"--dir",runtime,"--offline","--prepare-only"],1800))
                retain(gen/"recovery-observations"/(sha(encoded(recovered))+".json"),recovered)
            # A directory created before preparation intent is kept intact. The
            # exact retained source archive selects the next native preparation.
        if not (runtime / "runtime-install.json").exists():
            prepared = json.loads(self.run("runtime-prepare",[self.node,dist/"runtime-install-cli.mjs","prepare","--dir",runtime,"--archive",build["archive"],"--sha256",build["sha256"],"--operator"],900))
            retain(gen/"prepare-result.json",prepared)
        installed = json.loads(self.run("runtime-install",[self.node,dist/"runtime-install-cli.mjs","install","--dir",runtime,"--offline"],1800))
        retain(gen/"installation-observations"/(sha(encoded(installed))+".json"),installed)
        inspection = json.loads(self.run("runtime-inspect",[self.node,dist/"runtime-install-cli.mjs","inspect","--dir",runtime,"--load","--source"],900))
        need(inspection.get("ready"),"The selected retained Runtime is not READY.")
        manifest = load(runtime/"package"/"manifest.json")
        need(manifest["sourceCommit"]==commit and manifest["sourceSelection"]["id"]=="audit-exchange","Keep the selected exact Runtime generation.")
        retain(gen/"inspections"/(sha(encoded(inspection))+".json"),inspection)
        ready = {"commit":commit,"runtimeDirectory":str(runtime),"sourceRoot":str(runtime/"package/source"),"manifestSha256":sha(ordinary(runtime/"package/manifest.json"))}
        retain(gen/"ready-observations"/(sha(encoded(ready))+".json"),ready)
        return ready

    def capture(self, state, error=None):
        closed = drain()
        self.event("original-children-drained", children=closed)
        report = {"schema":SCHEMA,"operation":OPERATION,"state":state,"attempt":str(self.attempt),"finishedAt":now(),"error":error,"events":self.events}
        retain(self.attempt/"report.json",report)
        archives = directory(self.root / "archives")
        name = self.attempt.name + ".zip"
        pending, target = archives/(name+".pending"), archives/name
        members=[]
        # Complete private source, all generations, installs, customer projects,
        # original requests and full logs travel together. Previous ZIPs alone are
        # omitted; their complete underlying case and archive receipts remain.
        with zipfile.ZipFile(pending,"x",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for path in sorted(self.root.rglob("*")):
                relative=path.relative_to(self.root)
                if relative.parts[0] in {"archives","temporary"} or relative == Path("operation.lock"):
                    continue
                if path.is_symlink():
                    link=os.readlink(path)
                    resolved=path.resolve()
                    need(resolved.is_relative_to(self.root),"An installed symlink escapes complete owned custody.")
                    info=zipfile.ZipInfo(relative.as_posix())
                    info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16
                    archive.writestr(info,link.encode())
                    members.append({"path":relative.as_posix(),"kind":"symlink","target":link})
                elif path.is_file():
                    need(path.resolve()==path.absolute(),"Keep complete ordinary case files.")
                    identity=file_identity(path)
                    archive.write(path,relative.as_posix())
                    members.append({"path":relative.as_posix(),**identity})
            archive.writestr("COMPLETE_CASE_MANIFEST.json",encoded({"operation":OPERATION,"members":members}))
        with zipfile.ZipFile(pending) as archive:
            for item in members:
                if item.get("kind")=="symlink":
                    need(archive.read(item["path"]).decode()==item["target"],"Complete archive link differs.")
                else:
                    digest=hashlib.sha256();total=0
                    with archive.open(item["path"]) as source:
                        for chunk in iter(lambda:source.read(1024*1024),b""):
                            digest.update(chunk);total+=len(chunk)
                    need(total==item["bytes"] and digest.hexdigest()==item["sha256"],"Complete archive member differs.")
        with pending.open("rb") as saved:
            os.fsync(saved.fileno())
        os.link(pending,target);sync_directory(archives);pending.unlink();sync_directory(archives)
        pointer={"operation":OPERATION,"state":state,"path":str(target),**file_identity(target),"members":len(members),"report":str(self.attempt/"report.json")}
        retain(archives/(name+".json"),pointer)
        print(json.dumps({"completeCase":pointer}),flush=True)
        return pointer


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",required=True,help="The one persistent owned root, reused unchanged.")
    parser.add_argument("--original-packet",required=True,help="Original private823b JSON source carrier.")
    parser.add_argument("--commit",default=DEFAULT_COMMIT)
    parser.add_argument("--checkout",help="Optional exact existing complete Git checkout; no network needed.")
    parser.add_argument("--node")
    parser.add_argument("--python",default=None)
    parser.add_argument("--operator",default="Installed product operator")
    parser.add_argument("--browser-module")
    parser.add_argument("--browser-executable")
    parser.add_argument("--prepare-only",action="store_true",help="Prepare a later generation without changing the original customer input.")
    parser.add_argument("--original-input",help="Adopt the existing complete original input at its existing paths.")
    args=parser.parse_args()
    def interrupted(signum, frame):
        raise KeyboardInterrupt("Original operation received signal "+str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    root=directory(Path(args.root).absolute())
    marker=root/"persistent-operation.json"
    if marker.exists():
        need(load(marker)=={"schema":SCHEMA,"operation":OPERATION,"root":str(root)}, "Select the existing original persistent root.")
    else:
        existing=[p.name for p in root.iterdir()]
        need(not existing or args.original_input, "A new persistent root must be empty; adopt only the explicit original input.")
    lock=root/"operation.lock"
    guard=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    course=None
    try:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(stat.S_ISREG(os.fstat(guard).st_mode),"Use the original regular operation lease.")
        retain(marker,{"schema":SCHEMA,"operation":OPERATION,"root":str(root)})
        need(sys.platform=="linux","The inherited process and subreaper operation requires Linux.")
        need(hasattr(os,"pidfd_open") and hasattr(signal,"pidfd_send_signal"),"The original Linux runtime must support identity-pinned child signals.")
        libc=ctypes.CDLL(None,use_errno=True)
        need(libc.prctl(36,1,0,0,0)==0,"The original producing lifetime must own orphaned descendants.")
        raw,full,payload=original_payload(args.original_packet)
        retain(root/"original-source"/"source-packet.json",raw)
        retain(root/"original-source"/"payload.json",full)
        controller=corrected_controller(payload["operationSource"]).encode()
        for filename,body in (("INSTALLED_OPERATION.mjs",controller),("INSTALLED_BROWSER.mjs",payload["browser"].encode()),
                              ("ORIGINAL_OPERATING.md",payload["guide"].encode())):
            retain(root/"controller-source"/filename,body)
        own=ordinary(Path(__file__).absolute())
        retain(root/"controller-source"/"RUN_PERSISTENT.py",own)
        lease=ordinary(Path(__file__).absolute().with_name("inherited-lease.mjs"))
        retain(root/"controller-source"/"inherited-lease.mjs",lease)
        selected_original = load(args.original_input) if args.original_input else (
            load(root/"installed-operation-input.json") if (root/"installed-operation-input.json").exists() else None)
        selected_python = selected_original["pythonExecutable"] if selected_original and not args.prepare_only else os.environ.get("AUDIT_PYTHON",sys.executable)
        if args.python and selected_original and not args.prepare_only:
            need(executable(args.python,"Python")==executable(selected_python,"Python"),"Preserve the original customer Python selection.")
        args.python = executable(args.python or selected_python,"Python")
        course=Course(args,guard,root,payload)
        course.event("original-operation-admitted",root=str(root),commit=args.commit,originalPayloadSha256=PAYLOAD_SHA)
        version=course.run("node-version",[course.node,"--version"],30).decode().strip()
        need(tuple(map(int,version.lstrip("v").split(".")[:2]))>=(22,16),"Original Runtime requires Node22.16+.")
        course.run("python-dependency",[args.python,"-c","import lxml.etree; print(lxml.etree.LXML_VERSION)"],30)
        input_path=root/"installed-operation-input.json"
        if args.original_input:
            original=load(args.original_input)
            need(original["operation"]==OPERATION,"Select the same original installed operation.")
            # External original paths remain fixed. Full archival requires custody
            # rooted here; choose the actual existing original root as --root.
            for key in ("directory","sourceRoot","runtimeDirectory","browserDriver"):
                need(Path(original[key]).resolve().is_relative_to(root),"The complete original case must be inside the selected persistent custody root.")
            retain(input_path,ordinary(args.original_input))
        if input_path.exists() and not args.prepare_only:
            original=load(input_path)
            need(original["sourceCommit"]==args.commit,"Continue the exact original input commit; use --prepare-only for a separate later generation.")
            course.run("original-runtime-inspect",[course.node,Path(original["sourceRoot"])/PREFIX/"distribution/runtime-install-cli.mjs","inspect","--dir",original["runtimeDirectory"],"--load","--source"],900)
            # Preserve the original browser path/body and requests. The corrected
            # controller supplies only operation lifetime/durability repairs.
            need(ordinary(original["browserDriver"])==payload["browser"].encode(),"Preserve the complete original browser controller.")
        else:
            ready=course.generation(args.commit)
            if args.prepare_only:
                course.capture("GENERATION_READY")
                return 0
            original={"operation":OPERATION,"sourceCommit":args.commit,"directory":str(root/"complete-installed-case"),
                "sourceRoot":ready["sourceRoot"],"runtimeDirectory":ready["runtimeDirectory"],
                "pythonExecutable":str(Path(args.python).resolve()),"operator":args.operator,
                "browserDriver":str(root/"controller-source/INSTALLED_BROWSER.mjs")}
            browser={}
            if args.browser_module:browser["module"]=str(Path(args.browser_module).resolve())
            if args.browser_executable:browser["executablePath"]=str(Path(args.browser_executable).resolve())
            if browser:original["browser"]=browser
            retain(input_path,original)
        course.run("controller-syntax",[course.node,"--check",root/"controller-source/INSTALLED_OPERATION.mjs"],30)
        course.run("original-browser-syntax",[course.node,"--check",original["browserDriver"]],30)
        course.run("complete-installed-operation",[course.node,root/"controller-source/INSTALLED_OPERATION.mjs","--input",input_path],2400)
        result=load(Path(original["directory"])/"result.json")
        need(result.get("state")=="COMPLETE" and result.get("operation")==OPERATION,"Complete the original installed customer course.")
        course.capture("COMPLETE")
        return 0
    except BaseException as error:
        if course:
            course.event("original-operation-interrupted",error={"type":type(error).__name__,"message":str(error)})
            try:
                course.capture("INTERRUPTED",{"type":type(error).__name__,"message":str(error)})
            except BaseException as saving:
                print(json.dumps({"operation":OPERATION,"state":"INTERRUPTED","completeCaseSaved":False,
                    "root":str(root),"error":str(error),"captureError":str(saving)}),flush=True)
        else:
            print(json.dumps({"operation":OPERATION,"state":"NOT_STARTED","error":str(error)}),flush=True)
        return 1
    finally:
        os.close(guard)


if __name__=="__main__":
    raise SystemExit(main())
