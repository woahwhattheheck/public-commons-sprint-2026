#!/usr/bin/env python3
"""MIT. Install the complete BIM application under its original owned process lease."""
from __future__ import annotations
import argparse
import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

SCHEMA = "bim.install-input.v1"
OWNER_SHA = "506634371a87cbdc005b65d4e9c75a480bef18e0f0a762c3de463c859018903c"
OWNER_BYTES = 29581
LIMIT = 512 * 1024 * 1024
PHASES = ["01-node-version", "02-npm-version", "03-dependencies", "04-browser-build"]
GENERATED = ["BUILD_SELECTION.json", "web/wallet-entry.bundle.mjs",
             "web/wallet-entry.bundle.css", "web/wallet-entry.bundle.mjs.LEGAL.txt",
             "web/wallet-entry.bundle.css.LEGAL.txt", "build-metafile.json",
             "dependency-inputs.json", "BUILD_RECEIPT.json"]
def need(value, message):
    if not value:
        raise RuntimeError(message)

def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def strict_json(data):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, "Duplicate original JSON field")
            out[key] = value
        return out
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda unused: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))

def ordinary(path, exists=True):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "Select an absolute ordinary path")
    for parent in reversed([path, *path.parents]):
        try:
            mode = parent.lstat().st_mode
        except FileNotFoundError:
            need(not exists, "Original path is missing")
            continue
        need(not stat.S_ISLNK(mode), "Symbolic links are not selected source/runtime files")
    return path

def read(path, maximum=LIMIT, durable=False):
    path = ordinary(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Complete ordinary file required")
        data = stream.read(maximum + 1)
        if durable:
            os.fsync(stream.fileno())
        after = os.fstat(stream.fileno())
        need(len(data) <= maximum and
             (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
             "Original file changed during read")
        if durable:
            sync_dir(path.parent)
        return data

def sync_dir(path):
    fd = os.open(ordinary(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def mkdir(path):
    path = ordinary(path, False)
    if not path.exists():
        mkdir(path.parent)
        path.mkdir(mode=0o700)
        sync_dir(path.parent)
    need(path.is_dir(), "Select an ordinary directory")
    # Adoption retries any earlier directory publication whose parent sync failed.
    for ancestor in [path, *path.parents]:
        sync_dir(ancestor.parent)
    return path

def put(path, data, mode=0o600):
    path = ordinary(path, False)
    mkdir(path.parent)
    if path.exists():
        need(read(path) == data, "The original immutable artifact differs")
        sync_dir(path.parent)
        return
    temporary = path.with_name(path.name + ".pending-" + str(os.getpid()) + "-" + str(time.time_ns()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.link(temporary, path)
    except FileExistsError:
        need(read(path) == data, "The original immutable artifact differs")
    finally:
        temporary.unlink()
    sync_dir(path.parent)

@contextlib.contextmanager
def lease(root):
    import fcntl
    file = ordinary(root / "installation.lock", False)
    fd = os.open(file, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "Original regular lease required")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(fd)
        raise
    try:
        yield fd
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def describe(root, path):
    data = read(path, durable=True)
    return {"path": str(path.relative_to(root)), "bytes": len(data), "sha256": sha(data)}

def verify(root, item):
    relative = Path(item["path"])
    need(not relative.is_absolute() and ".." not in relative.parts, "Original relative artifact required")
    data = read(root / relative, durable=True)
    actual = {"path":str(relative),"bytes":len(data),"sha256":sha(data)}
    need(actual == item, "Retained artifact identity changed")
    return data


def relative(value):
    need(isinstance(value,str) and value and "\\" not in value and
         not Path(value).is_absolute() and ".." not in Path(value).parts and
         str(Path(value))==value and "\x00" not in value, "Complete relative source path required")
    return value

def validate_input(spec):
    required={"schema","operationId","directory","sourceRoot","sourceManifestSha256",
              "node","npm","searchPath","timeoutSeconds"}
    need(isinstance(spec,dict) and required<=set(spec)<=required|{"lockFile"} and
         spec["schema"]==SCHEMA, "Complete installation input required")
    need(isinstance(spec["operationId"],str) and 0<len(spec["operationId"])<=200,
         "Original installation operation ID required")
    source=ordinary(spec["sourceRoot"]); destination=ordinary(spec["directory"],False)
    need(source.is_dir() and source!=destination and source not in destination.parents and
         destination not in source.parents, "Keep authored source and installation in separate trees")
    need(isinstance(spec["timeoutSeconds"],int) and not isinstance(spec["timeoutSeconds"],bool) and
         1<=spec["timeoutSeconds"]<=7200,"Select a phase timeout between 1 and 7200 seconds")
    need(isinstance(spec["searchPath"],str) and spec["searchPath"] and
         "\x00" not in spec["searchPath"],"Select the actual executable search path")
    need(isinstance(spec["sourceManifestSha256"],str) and
         re.fullmatch("[0-9a-f]{64}",spec["sourceManifestSha256"]),"Select the complete source manifest SHA-256")
    for kind in ("node","npm"):
        value=spec[kind]
        need(isinstance(value,dict) and set(value)=={"path","sha256","version"},
             "Select complete Node and npm-cli.js file identities")
        ordinary(value["path"])
        need(isinstance(value["sha256"],str) and re.fullmatch("[0-9a-f]{64}",value["sha256"]) and
             isinstance(value["version"],str) and 0<len(value["version"])<200,
             "Exact runtime hash and original version output required")
    v=re.fullmatch(r"v([0-9]+)\.([0-9]+)\.([0-9]+)",spec["node"]["version"])
    need(v and (int(v[1])>22 or int(v[1])==22 and int(v[2])>=16),"Node 22.16 or later required")
    need(Path(spec["npm"]["path"]).name=="npm-cli.js","Select the actual regular npm-cli.js; no shell or launcher")
    if "lockFile" in spec:
        ordinary(spec["lockFile"])
    return spec

def selected_source(spec):
    root=Path(spec["sourceRoot"])
    raw=read(root/"source-inputs.json")
    need(sha(raw)==spec["sourceManifestSha256"],"Authored source manifest differs")
    manifest=strict_json(raw)
    need(isinstance(manifest,dict) and manifest.get("schema")=="bim.authored-source.v1" and
         isinstance(manifest.get("files"),list) and len(manifest["files"])>=25,
         "Whole authored source manifest required")
    files=[]; names=set()
    for item in manifest["files"]:
        need(isinstance(item,dict) and set(item)=={"path","bytes","sha256"},"Exact original file descriptor required")
        name=relative(item["path"])
        need(name not in names and name not in GENERATED+["source-inputs.json","source-files.json","package-lock.json"]
             and not name.startswith("node_modules/"),"Duplicate or generated authored source path")
        names.add(name); data=read(root/name)
        need(len(data)==item["bytes"] and sha(data)==item["sha256"],"Authored member changed: "+name)
        files.append({**item,"contentBase64":base64.b64encode(data).decode("ascii")})
    for name in ("native/install.py","native/watershed_process.py","tools/build.mjs","package.json",
                 "providers/index.mjs","cli.mjs","lib/workspace.mjs","web/wallet-entry.mjs"):
        need(name in names,"Whole application source is missing "+name)
    adopted=None
    installed_path=root/"source-files.json"
    if installed_path.exists():
        installed_raw=read(installed_path)
        installed=strict_json(installed_raw)
        need(installed.get("schema")=="bim.installed-source.v1" and
             installed.get("edition")==manifest.get("edition") and isinstance(installed.get("files"),list),
             "Select the original complete installed edition")
        rows=installed["files"]; installed_names=[relative(f["path"]) for f in rows]
        need(len(installed_names)==len(set(installed_names)) and
             set(installed_names)==names|{"source-inputs.json","package-lock.json"}|set(GENERATED),
             "Original installed roster differs")
        retained=[]
        for row in rows:
            data=verify(root,row)
            if row["path"] in names:
                need(any(m["path"]==row["path"] and m["bytes"]==row["bytes"] and
                         m["sha256"]==row["sha256"] for m in files),"Installed authored source differs")
            if row["path"]=="source-inputs.json":
                need(data==raw,"Installed authored roster differs")
            if row["path"] not in names and row["path"]!="source-inputs.json":
                retained.append({**row,"contentBase64":base64.b64encode(data).decode("ascii")})
        adopted={"schema":"bim.adopted-installed-source.v1","files":retained,
                 "manifest":{"path":"source-files.json","bytes":len(installed_raw),
                             "sha256":sha(installed_raw),"contentBase64":base64.b64encode(installed_raw).decode("ascii")}}
    return manifest,raw,files,adopted

def runtime_bytes(spec):
    result={}
    for kind in ("node","npm"):
        value=spec[kind]; data=read(value["path"],256*1024*1024)
        need(sha(data)==value["sha256"],"Selected "+kind+" runtime file changed")
        result[kind]={"path":value["path"],"bytes":len(data),"sha256":sha(data),"version":value["version"]}
    need(os.access(spec["node"]["path"],os.X_OK),"Selected Node is not executable")
    # Child tools resolve the same selected Node, never an unrelated PATH entry.
    found=None
    for folder in spec["searchPath"].split(os.pathsep):
        need(folder and Path(folder).is_absolute(),"Use only absolute runtime PATH entries")
        candidate=Path(folder)/"node"
        if candidate.exists() and os.access(candidate,os.X_OK):
            found=str(candidate); break
    need(found==spec["node"]["path"],"The selected PATH must resolve the exact ordinary Node executable")
    return result

def lock_data(path,package):
    data=read(path,durable=True); lock=strict_json(data)
    need(isinstance(lock,dict) and lock.get("lockfileVersion",0)>=2 and
         isinstance(lock.get("packages"),dict) and "" in lock["packages"],
         "Complete npm lock version 2 or later required")
    original=lock["packages"][""]
    for name in ("dependencies","devDependencies","optionalDependencies","peerDependencies","peerDependenciesMeta"):
        need(original.get(name,{})==package.get(name,{}),"Original npm root dependency declarations changed: "+name)
    for name,version in {**package.get("dependencies",{}),**package.get("devDependencies",{})}.items():
        need(lock["packages"].get("node_modules/"+name,{}).get("version")==version,
             "Direct installed version differs: "+name)
    return data

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True)
    args=parser.parse_args(argv)
    need(sys.platform.startswith("linux"),"The maintained process owner requires the selected Linux lease")
    spec=validate_input(strict_json(read(Path(args.input).absolute(),4*1024*1024)))
    root=Path(spec["directory"]); existed=root.exists()
    if existed:
        ordinary(root); need(root.is_dir(),"Installation directory required")
        need((root/"input.json").exists() or {p.name for p in root.iterdir()} <= {"installation.lock"},
             "Select a NEW directory or an exact original installation")
    root=mkdir(root)
    here=ordinary(Path(__file__).absolute()); driver=read(here)
    helper_path=ordinary(here.parent/"watershed_process.py"); helper=read(helper_path)
    need(len(helper)==OWNER_BYTES and sha(helper)==OWNER_SHA,"Original complete native process owner required")
    binding=sha(encode(spec))
    with lease(root) as lease_fd:
        put(root/"input.json",encode(spec))
        put(root/"executing-driver.py",driver); put(root/"executing-owner.py",helper)
        manifest,source_raw,selected,adopted_source=selected_source(spec)
        need(next(m["sha256"] for m in selected if m["path"]=="native/install.py")==sha(driver) and
             next(m["sha256"] for m in selected if m["path"]=="native/watershed_process.py")==sha(helper),
             "Executing driver and owner must be the selected authored source")
        put(root/"authored-source.json",source_raw)
        put(root/"source-selection.json",encode({"schema":"bim.install-source.v1","files":selected,"installed":adopted_source}))
        runtime=runtime_bytes(spec); put(root/"runtime-selection.json",encode(runtime))
        app=mkdir(root/"application")
        for member in selected:
            put(app/member["path"],base64.b64decode(member["contentBase64"],validate=True),0o644)
        put(app/"source-inputs.json",source_raw,0o644)
        if adopted_source is not None:
            put(root/"adopted-installed-source.json",encode(adopted_source))
            for member in [*adopted_source["files"],adopted_source["manifest"]]:
                put(app/member["path"],base64.b64decode(member["contentBase64"],validate=True),0o644)
        package=strict_json(read(app/"package.json"))
        configs=mkdir(root/"npm-config")
        put(configs/"user.npmrc",b""); put(configs/"global.npmrc",b"")
        cache=mkdir(root/"npm-cache")
        env={"PATH":spec["searchPath"],"LANG":"C.UTF-8","CI":"true",
             "npm_config_cache":str(cache),"npm_config_userconfig":str(configs/"user.npmrc"),
             "npm_config_globalconfig":str(configs/"global.npmrc")}
        put(root/"environment.json",encode(env))
        fixed_lock=root/"package-lock.json"
        if adopted_source is not None:
            put(fixed_lock,lock_data(app/"package-lock.json",package))
        if "lockFile" in spec:
            supplied=lock_data(Path(spec["lockFile"]),package)
            put(root/"supplied-package-lock.json",supplied)
            put(fixed_lock,supplied)
        if fixed_lock.exists():
            put(app/"package-lock.json",lock_data(fixed_lock,package),0o644)
        namespace={"__name__":"bim_original_process_owner","__file__":str(helper_path)}
        exec(compile(helper,str(helper_path),"exec"),namespace)
        run_owned=namespace["run_owned"]

        def originals():
            need(runtime_bytes(spec)==runtime,"Runtime selection changed")
            need(read(app/"source-inputs.json")==source_raw,"Selected authored roster changed")
            for m in selected:
                need(read(app/m["path"])==base64.b64decode(m["contentBase64"],validate=True),
                     "Selected authored source changed: "+m["path"])
            need(not (app/"bim.sqlite").exists(),"A live workspace must never occupy the installation")
        def freeze_lock():
            data=lock_data(app/"package-lock.json",package); put(fixed_lock,data)
            return data
        def build_basis():
            raw=read(app/"source-files.json",durable=True); installed=strict_json(raw)
            need(installed.get("schema")=="bim.installed-source.v1" and
                 installed.get("edition")==manifest.get("edition") and isinstance(installed.get("files"),list),
                 "Original installed source edition required")
            items=installed["files"]; names=[relative(f["path"]) for f in items]
            expected={m["path"] for m in selected}|{"source-inputs.json","package-lock.json"}|set(GENERATED)
            need(len(names)==len(set(names)) and set(names)==expected,"Complete installed member set differs")
            bodies={f["path"]:verify(app,f) for f in items}
            for m in selected:
                need(bodies[m["path"]]==base64.b64decode(m["contentBase64"],validate=True),"Installed authored source differs")
            need(bodies["source-inputs.json"]==source_raw and bodies["package-lock.json"]==freeze_lock(),
                 "Original source/lock binding differs")
            receipt=strict_json(bodies["BUILD_RECEIPT.json"])
            selection=strict_json(bodies["BUILD_SELECTION.json"])
            need(receipt.get("schema")=="bim.browser-build.v1" and receipt.get("status")=="COMPLETE" and
                 receipt.get("providerExecution") is False and
                 receipt.get("selection")==selection and
                 receipt["authoredSource"]=={"path":"source-inputs.json","bytes":len(source_raw),"sha256":sha(source_raw)} and
                 receipt["packageLock"]=={"path":"package-lock.json","bytes":len(bodies["package-lock.json"]),"sha256":sha(bodies["package-lock.json"])},
                 "Complete source-bound browser build receipt required")
            declared={f["path"]:f for f in items}; outputs=receipt.get("outputs")
            need(isinstance(outputs,list) and len(outputs)==len({f["path"] for f in outputs}) and
                 {f["path"] for f in outputs}==set(GENERATED)-{"BUILD_RECEIPT.json"},
                 "Whole original bundle output set required")
            for f in outputs:
                need(declared.get(f["path"])==f,"Original bundle output identity differs")
            dependencies=strict_json(bodies["dependency-inputs.json"])
            need(dependencies.get("schema")=="bim.bundle-inputs.v1" and
                 isinstance(dependencies.get("files"),list) and
                 len({f["path"] for f in dependencies["files"]})==len(dependencies["files"])==receipt["dependencyInputs"],
                 "Complete installed dependency input set required")
            for f in dependencies["files"]:
                relative(f["path"]); verify(app,f)
            originals()
            return {"manifest":describe(root,app/"source-files.json"),
                    "files":[describe(root,app/f["path"]) for f in items],
                    "dependencyInputs":[describe(root,app/f["path"]) for f in dependencies["files"]]}

        def command_argv(kind,mode=None):
            if kind=="node":return [spec["node"]["path"],"--version"]
            if kind=="npm":return [spec["node"]["path"],spec["npm"]["path"],"--version"]
            if kind=="dependencies":
                need(mode in ("install","ci"),"Original npm mode required")
                return [spec["node"]["path"],spec["npm"]["path"],mode,"--ignore-scripts","--no-audit","--no-fund"]
            return [spec["node"]["path"],str(app/"tools/build.mjs")]
        def signature(label):
            return {"operationId":spec["operationId"],"inputSha256":binding,"name":label,
                    "sourceManifestSha256":spec["sourceManifestSha256"],"runtimeSha256":sha(encode(runtime))}
        def validate_phase(record,label,kind):
            need(record.get("schema")=="bim.install-phase.v1" and record.get("signature")==signature(label) and
                 record.get("state")=="COMPLETE" and record.get("failure") is None and
                 record.get("outcome",{}).get("lifetimes")=="CLOSED" and
                 record["outcome"]["returncode"]==0,"Complete original installation phase required")
            items=record["artifacts"]
            need(len(items)==len({i["path"] for i in items}),"Duplicate phase artifact")
            bodies={i["path"]:verify(root,i) for i in items}
            paths=[n for n in bodies if n.endswith("/request.json")]
            need(len(paths)==1,"One original phase request required")
            attempt=Path(paths[0]).parent
            need(attempt.parent==Path("phases")/label/"attempts" and re.fullmatch("[0-9]{6}",attempt.name),
                 "Original attempt path required")
            req=strict_json(bodies[str(attempt/"request.json")])
            need(req["signature"]==signature(label) and req["kind"]==kind and
                 req["environment"]==env and req["cwd"]==str(app) and
                 req["argv"]==command_argv(kind,req.get("npmMode")),"Original phase command changed")
            required={str(attempt/n) for n in ("request.json","process.json","stdout","stderr","result.json")}
            if kind=="dependencies":required.add(str(attempt/"package-lock.json"))
            if kind=="build":required.update(str(attempt/n) for n in ("source-files.json","BUILD_RECEIPT.json"))
            if req.get("lockBefore") is not None:
                need(kind=="dependencies" and req["npmMode"]=="ci","Original dependency lock mode differs")
                required.add(str(attempt/"lock-before.json"))
                need(req["lockBefore"]=={"bytes":len(bodies[str(attempt/"lock-before.json")]),
                     "sha256":sha(bodies[str(attempt/"lock-before.json")])},"Original lock input differs")
            elif kind=="dependencies":need(req["npmMode"]=="install","Initial resolution must use install")
            need(set(bodies)==required,"Complete original phase artifact set differs")
            need(strict_json(bodies[str(attempt/"process.json")])==record["outcome"]["process"],"Original process identity differs")
            result=strict_json(bodies[str(attempt/"result.json")])
            need(result=={**record,"artifacts":[i for i in items if i["path"]!=str(attempt/"result.json")]},
                 "Original closed result differs")
            if kind in ("node","npm"):
                need(bodies[str(attempt/"stdout")].decode("utf-8","strict").strip()==spec[kind]["version"],
                     "Actual native version differs")
            elif kind=="dependencies":
                need(bodies[str(attempt/"package-lock.json")]==freeze_lock(),"Accepted dependency lock changed")
            else:
                build_basis()
                need(bodies[str(attempt/"source-files.json")]==read(app/"source-files.json") and
                     bodies[str(attempt/"BUILD_RECEIPT.json")]==read(app/"BUILD_RECEIPT.json"),"Accepted build output changed")
            return record

        def command(label,kind):
            folder=mkdir(root/"phases"/label); accepted=folder/"accepted.json"
            if accepted.exists():
                value=validate_phase(strict_json(read(accepted,durable=True)),label,kind)
                return value
            attempts=mkdir(folder/"attempts"); indices=[]
            for child in attempts.iterdir():
                ordinary(child); need(child.is_dir() and re.fullmatch("[0-9]{6}",child.name),"Original attempt folder differs")
                indices.append(int(child.name))
            for index in sorted(indices):
                result=attempts/("%06d"%index)/"result.json"
                if result.exists():
                    original=strict_json(read(result,durable=True))
                    if original.get("state")=="COMPLETE":
                        adopted={**original,"artifacts":[*original["artifacts"],describe(root,result)]}
                        validate_phase(adopted,label,kind); put(accepted,encode(adopted)); return adopted
            originals()
            # Freeze a generated lock left by any interrupted original npm before another invocation.
            if kind=="dependencies" and (app/"package-lock.json").exists():
                freeze_lock()
            index=max(indices,default=0)+1; need(index<1000000,"Original attempt capacity exhausted")
            attempt=mkdir(attempts/("%06d"%index))
            before=read(fixed_lock) if kind=="dependencies" and fixed_lock.exists() else None
            mode=("ci" if before is not None else "install") if kind=="dependencies" else None
            request={"signature":signature(label),"kind":kind,"argv":command_argv(kind,mode),
                     "cwd":str(app),"environment":env,"npmMode":mode,
                     "lockBefore":{"bytes":len(before),"sha256":sha(before)} if before is not None else None}
            if before is not None:
                put(attempt/"lock-before.json",before); put(app/"package-lock.json",before,0o644)
            put(attempt/"request.json",encode(request))
            outcome=None; error=None
            try:
                with open(attempt/"stdout","xb",buffering=0) as stdout, open(attempt/"stderr","xb",buffering=0) as stderr:
                    outcome=run_owned(request["argv"],stdout,stderr_stream=stderr,cwd=str(app),env=env,
                                      lease_fd=lease_fd,timeout=spec["timeoutSeconds"],
                                      on_started=lambda value:put(attempt/"process.json",encode(value)))
                need(outcome["lifetimes"]=="CLOSED" and outcome["returncode"]==0,"Original native phase did not complete")
                originals()
                if kind in ("node","npm"):
                    need(read(attempt/"stdout").decode("utf-8","strict").strip()==spec[kind]["version"],
                         "Observed runtime version differs")
                elif kind=="dependencies":
                    put(attempt/"package-lock.json",freeze_lock())
                else:
                    build_basis()
                    put(attempt/"source-files.json",read(app/"source-files.json"))
                    put(attempt/"BUILD_RECEIPT.json",read(app/"BUILD_RECEIPT.json"))
            except BaseException as failure:
                error={"type":type(failure).__name__,"message":str(failure)}
            artifacts=[describe(root,f) for f in sorted(attempt.iterdir()) if f.is_file()]
            result={"schema":"bim.install-phase.v1","signature":signature(label),
                    "state":"FAILED" if error else "COMPLETE","outcome":outcome,
                    "failure":error,"artifacts":artifacts,"completedAt":time.time()}
            put(attempt/"result.json",encode(result))
            if error:raise RuntimeError("Original installation attempt retained at "+str(attempt)+": "+error["message"])
            accepted_value={**result,"artifacts":[*artifacts,describe(root,attempt/"result.json")]}
            validate_phase(accepted_value,label,kind); put(accepted,encode(accepted_value)); return accepted_value

        definitions=list(zip(PHASES,("node","npm","dependencies","build")))
        def complete_basis():
            phases=[]
            for label,kind in definitions:
                path=root/"phases"/label/"accepted.json"
                validate_phase(strict_json(read(path,durable=True)),label,kind)
                phases.append(describe(root,path))
            files=[describe(root,root/n) for n in ("input.json","executing-driver.py","executing-owner.py",
                "authored-source.json","source-selection.json","runtime-selection.json","environment.json","package-lock.json")]
            if "lockFile" in spec:files.append(describe(root,root/"supplied-package-lock.json"))
            if adopted_source is not None:files.append(describe(root,root/"adopted-installed-source.json"))
            return {"schema":"bim.install-result.v1","state":"COMPLETE","lifetimes":"CLOSED",
                    "operationId":spec["operationId"],"inputSha256":binding,
                    "application":str(app),"phases":phases,"files":files,"installed":build_basis(),
                    "providerExecution":False}
        complete=root/"complete.json"
        if complete.exists():
            value=strict_json(read(complete,durable=True)); need(value==complete_basis(),"Original completed installation differs")
            print(json.dumps(value)); return 0
        for label,kind in definitions:command(label,kind)
        result=complete_basis(); put(complete,encode(result)); print(json.dumps(result)); return 0

if __name__=="__main__":
    raise SystemExit(main())
