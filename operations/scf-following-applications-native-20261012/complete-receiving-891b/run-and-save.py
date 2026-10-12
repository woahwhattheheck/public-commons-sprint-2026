"""Preserve one complete original source/runtime receiving inside its native invocation."""
from pathlib import Path
import hashlib
import json
import os
import signal
import stat
import subprocess
import sys
import time
import zipfile

def digest(path):
    h=hashlib.sha256()
    with open(path,"rb") as stream:
        for body in iter(lambda:stream.read(1024*1024),b""):
            h.update(body)
    return h.hexdigest()

def atomic_json(path,value):
    path=Path(path)
    temporary=path.with_name(path.name+".pending-"+str(os.getpid()))
    with open(temporary,"x",encoding="utf-8") as stream:
        os.chmod(temporary,0o600)
        json.dump(value,stream,indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def read_json(path):
    return json.loads(Path(path).read_text())

def validate_upload_response(value,request):
    outcomes=value.get("results") if isinstance(value,dict) else None
    if not isinstance(outcomes,list) or len(outcomes)!=len(request["uploads"]):
        raise ValueError("Retained upload response is incomplete")
    for item,expected in zip(outcomes,request["uploads"]):
        if (not isinstance(item,dict) or item.get("local_path")!=expected["local_path"] or item.get("purpose")!=expected["purpose"] or item.get("status") not in ("succeeded","failed")):
            raise ValueError("Retained upload response binding differs")
        if item["status"]=="succeeded" and any(not isinstance(item.get(key),str) or not item[key] for key in ("file_id","library_file_id")):
            raise ValueError("Retained upload identity is incomplete")
    return value

def run_child(argv,**options):
    child=subprocess.Popen(argv,**options)
    previous={}
    for sig in (signal.SIGINT,signal.SIGTERM):
        previous[sig]=signal.getsignal(sig)
        signal.signal(sig,lambda received,frame:child.send_signal(received) if child.poll() is None else None)
    try: return child.wait()
    finally:
        for sig,handler in previous.items(): signal.signal(sig,handler)

def guide(native):
    archive=native["archive"]
    transfer=native["transfer"]
    install=native["installation"]
    return f"""# SCF cumulative merchant source and native runtime

This delivery carries the complete original source selection at
{native['sourceCommit']}. The native result completed the maintained full
archive build and source installation, the selected dependency profile,
READY/import/source inspection, full original runtime transfer, exact part
receiving, and same-installation reopening.

The archive contains every original source member selected by the 194
contributions and any relative-module closure the maintained builder added.
Source files retain their original Git identities, licenses and attribution.

## What is installed

The operated profile selects native Stellar support plus timescale, mcp,
graphql, schema and openapi. It carries the entire genuine transitive npm
lock and its original public package artifacts. Other optional application
runtimes remain selected through their existing installation instructions;
the complete source remains included.

Installation ID: {install['installationId']}
Profile ID: {install['profileId']}
Dependency lock SHA256: {install['lockSha256']}
Original source archive SHA256: {archive['sha256']}
Original transfer manifest SHA256: {transfer['manifestSha256']}

Use Linux, Node.js 24 (the native operation records the exact version), npm,
Python 3.11 or later, and util-linux flock. The receiving directories below
belong to the current ordinary user and require no root directory.

## Receive and install

Extract this ZIP into a private directory. Run these commands from that
directory. Keep the ZIP, source.tgz, manifest.json and every original part.

~~~sh
release_root="$(pwd -P)"
python3 "$release_root/bootstrap/runtime-unpack.py" \\
  --archive "$release_root/source.tgz" \\
  --sha256 "{archive['sha256']}" \\
  --out "$release_root/private-source"
starforge_cli="$release_root/private-source/source/stellar/scf-starforge-20261009/distribution/cli.mjs"

node "$starforge_cli" runtime-transfer receive \\
  --directory "$release_root/private-receiver" \\
  --manifest "$release_root/runtime-transfer/manifest.json" \\
  --sha256 "{transfer['manifestSha256']}" \\
  --parts "$release_root/runtime-transfer/parts"

node "$starforge_cli" runtime-transfer install \\
  --directory "$release_root/private-receiver" \\
  --runtime "$release_root/private-runtime"

node "$starforge_cli" runtime-install inspect \\
  --dir "$release_root/private-runtime" --load --source

node "$starforge_cli" runtime-install run \\
  --dir "$release_root/private-runtime" -- source
~~~

The first unpack creates private-source. On an existing unpack, use the same
unpacker with --verify and the same archive digest. Repeating receive uses
the original manifest and already verified parts. Interrupted native installs
retain their original directory and lock. Use the original install command
again; if preparation was interrupted before its plan committed, use the
documented runtime-transfer recover command with the retained --from and a
new --runtime directory. Do not erase an uncertain receiving directory.

The recorded native operation reconstructed and verified the complete
portable transfer without populating a second cache on the producer.
The customer command above also populates its private cache and the original
installer consumes that exact lock offline.

## Open the maintained product

The selected private-runtime is an actual runtime-install target. Use the
original runtime-workspace/Applications entry point and select that runtime
directory. Source, warehouse, publisher, scheduler, release and buyer workspaces
continue to belong to their existing owners.

Timescale operation and remediation instructions are in the original source:
stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md
stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/UBUNTU_NATIVE.md
stellar-forge/mcp-merchant-operator/TIMESCALE_WORKSPACE.md
stellar-forge/mcp-merchant-operator/TIMESCALE_CLIENT.md

This packaging/receiving operation did not start PostgreSQL, refresh an
aggregate, run a publisher, make a signed purchase or replay a completed
customer operation. The original Timescale database/native receiving remains
a separate explicitly owned operation. The source includes its complete
existing native and browser receivers.

## Contents and provenance

- source.tgz: exact original full source archive.
- runtime-transfer/: original immutable manifest and every declared part.
- bootstrap/runtime-unpack.py: the unchanged maintained source unpacker.
- native/: original source/installation/READY/receiving result records.
- provenance/: exact original source metadata.
- operation-source/: the orchestration over original producer/installer APIs.
- PACKAGE_MANIFEST.json: byte counts and SHA256 of all other ZIP members.

The source archive's own manifest is authoritative for its complete members.
The transfer manifest binds original source, selected profile, complete lock,
every public package artifact and every transport part. The native result
retains observed producer paths as provenance; they are not customer
installation paths or a promise that an ephemeral producer path remains live.
"""

def main():
    configuration_path=Path(sys.argv[1]).resolve(strict=True)
    config=read_json(configuration_path)
    work=Path(config["work"]).resolve(strict=True)
    original=Path(config["originalRoot"])
    result_path=work/"native-result.json"
    os.umask(0o077)
    native=None
    if result_path.exists():
        native=read_json(result_path)
        if native.get("sourceCommit")!=config["sourceCommit"] or native.get("work")!=str(work):
            raise ValueError("The retained native operation binding changed")
    code=0
    if not native or native.get("complete") is not True:
        code=run_child([config["node"],str(work/"complete-native.mjs"),str(configuration_path)],
            cwd=work,env={**os.environ,"PATH":config["nodeBin"]+os.pathsep+os.environ["PATH"],
                         "PYTHONDONTWRITEBYTECODE":"1"})
        native=read_json(result_path) if result_path.exists() else {
            "sourceCommit":config["sourceCommit"],"complete":False,"exitCode":code}
    if not (work/"native-process.json").exists():
        atomic_json(work/"native-process.json",{"exitCode":code,"sourceCommit":config["sourceCommit"],
            "complete":native.get("complete") is True,"observedAt":time.time()})
    try: atomic_json(original/"full-native-result.json",native)
    except OSError: pass
    delivery=work/"delivery"
    delivery.mkdir(mode=0o700,exist_ok=True)
    complete=native.get("complete") is True and code==0
    native_digest=digest(result_path) if result_path.exists() else hashlib.sha256(json.dumps(native,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    publication_key="final" if complete else "checkpoint-"+native_digest
    name=("SCF_Cumulative_Runtime_891b2072_20261012.zip" if complete
          else "SCF_Following_891b2072_Native_Checkpoint_"+native_digest[:16]+".zip")
    output=delivery/name
    publication=work/("delivery-publication-"+publication_key+".json")
    if publication.exists():
        retained=read_json(publication)
        artifact=retained["artifact"]
        if (artifact["sourceCommit"]!=config["sourceCommit"] or artifact["complete"]!=complete or artifact["path"]!=str(output) or artifact["nativeResultSha256"]!=native_digest):
            raise ValueError("Original delivery publication binding changed")
        temporary=Path(retained["temporary"])
        selected=output if output.exists() else temporary
        if selected.stat().st_size!=artifact["bytes"] or digest(selected)!=artifact["sha256"]:
            raise ValueError("The retained delivery publication bytes changed")
        if not output.exists(): os.link(temporary,output)
        sync_directory(delivery)
        if temporary.exists(): temporary.unlink()
        sync_directory(delivery)
        source_archive=Path(retained["sourceArchive"]) if retained.get("sourceArchive") else None
    else:
        member_inputs=[]
        def add(path,member):
            path=Path(path)
            if not stat.S_ISREG(path.lstat().st_mode):
                raise ValueError("Only original regular files are delivered: "+str(path))
            member_inputs.append((path,member))
        if result_path.exists(): add(result_path,"native/native-result.json")
        add(work/"native-process.json","native/native-process.json")
        add(config["metadata"],"provenance/source-input.json")
        for name in ("complete-native.mjs","launch-complete.py","run-and-save.py"):
            add(work/name,"operation-source/"+name)
        if (work/"prepare-existing-worker.py").exists():
            add(work/"prepare-existing-worker.py","operation-source/prepare-existing-worker.py")
        if (work/"worker-preparation.json").exists():
            add(work/"worker-preparation.json","native/worker-preparation.json")
        for name in ("installation.json","operation.json","operation-error.json"):
            path=work/"source-operation"/name
            if path.exists(): add(path,"native/source-"+name)
        for name in ("runtime-install.json","install-state.json","runtime-profile.json","package.json","package-lock.json"):
            path=work/"runtime"/name
            if path.exists(): add(path,"native/"+name)
        if (work/"installed-source-command.json").exists():
            add(work/"installed-source-command.json","native/installed-source-command.json")
        source_archive=None
        if complete:
            source_archive=Path(native["archive"]["path"])
            if source_archive.stat().st_size!=native["archive"]["bytes"] or digest(source_archive)!=native["archive"]["sha256"]:
                raise ValueError("The completed original source archive changed")
            add(source_archive,"source.tgz")
            add(Path(config["builderDirectory"])/"runtime-unpack.py","bootstrap/runtime-unpack.py")
            transfer=Path(native["transfer"]["directory"])
            manifest=read_json(transfer/"manifest.json")
            if digest(transfer/"manifest.json")!=native["transfer"]["manifestSha256"]:
                raise ValueError("The completed transfer manifest changed")
            add(transfer/"manifest.json","runtime-transfer/manifest.json")
            for part in manifest["parts"]:
                part_file=transfer/"parts"/part["name"]
                if part_file.stat().st_size!=part["bytes"] or digest(part_file)!=part["sha256"]:
                    raise ValueError("A completed original transport part changed")
                add(part_file,"runtime-transfer/parts/"+part["name"])
            (delivery/"START_HERE.md").write_text(guide(native),encoding="utf-8")
            add(delivery/"START_HERE.md","START_HERE.md")
        else:
            receipt=work/"release"/"distribution.json"
            if receipt.exists():
                archive=read_json(receipt)
                selected=Path(archive["archive"])
                if selected.stat().st_size==archive["archiveBytes"] and digest(selected)==archive["sha256"]:
                    source_archive=selected
                    add(selected,"source.tgz")
                    add(receipt,"native/source-archive-receipt.json")
            if source_archive is None and (work/"source-cache").exists():
                for path in sorted((work/"source-cache").rglob("*")):
                    if path.is_file() and not path.is_symlink():
                        add(path,"retained-source-cache/"+path.relative_to(work/"source-cache").as_posix())
            (delivery/"CHECKPOINT.md").write_text(
                "# Original 891b native continuation\n\nThe native result is incomplete. "
                "Read its exact completed stages and error before continuing the same "
                "operation. Source/cache bytes are retained; this is not a READY runtime.\n",
                encoding="utf-8")
            add(delivery/"CHECKPOINT.md","CHECKPOINT.md")
        if len({member for _,member in member_inputs})!=len(member_inputs):
            raise ValueError("Duplicate delivery member")
        manifest={"schema":"starforge.following-release-delivery.v1","sourceCommit":config["sourceCommit"],
            "sourceTree":config["sourceTree"],"complete":complete,"members":[]}
        temporary=output.with_name(output.name+".pending")
        if temporary.exists(): temporary.unlink()
        with zipfile.ZipFile(temporary,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for path,member in member_inputs:
                h=hashlib.sha256();size=0
                info=zipfile.ZipInfo.from_file(path,arcname=member)
                info.compress_type=zipfile.ZIP_STORED if member.endswith((".tgz",".part",".bin")) or "/objects/" in member else zipfile.ZIP_DEFLATED
                with open(path,"rb") as source,archive.open(info,"w",force_zip64=True) as target:
                    for body in iter(lambda:source.read(1024*1024),b""):
                        target.write(body);h.update(body);size+=len(body)
                manifest["members"].append({"path":member,"bytes":size,"sha256":h.hexdigest()})
            archive.writestr("PACKAGE_MANIFEST.json",json.dumps(manifest,indent=2)+"\n")
        with open(temporary,"rb") as stream: os.fsync(stream.fileno())
        artifact={"path":str(output),"bytes":temporary.stat().st_size,"sha256":digest(temporary),
            "complete":complete,"sourceCommit":config["sourceCommit"],"nativeResultSha256":native_digest,"members":len(member_inputs)+1}
        atomic_json(publication,{"artifact":artifact,"temporary":str(temporary),
            "sourceArchive":str(source_archive) if source_archive else None})
        if output.exists():
            if digest(output)!=artifact["sha256"]:
                raise ValueError("A retained delivery differs; preserve its original outcome")
        else:
            os.link(temporary,output)
        sync_directory(delivery)
        temporary.unlink()
        sync_directory(delivery)
    atomic_json(work/"delivery-result.json",artifact)
    print(json.dumps({"phase":"DELIVERY_READY",**artifact}),flush=True)
    if source_archive is not None and complete:
        if source_archive.stat().st_size!=native["archive"]["bytes"] or digest(source_archive)!=native["archive"]["sha256"]:
            raise ValueError("Original source bytes changed before saving")
    receiver=config.get("artifactReceiver","library")
    if receiver=="original-owner":
        delivery_result={**artifact,"available":False,"artifactReceiver":receiver,"transferState":"AWAITING_ORIGINAL_OWNER_PUBLICATION"}
        atomic_json(work/"delivery-result.json",delivery_result)
        try: atomic_json(original/"full-delivery-result.json",delivery_result)
        except OSError: pass
        print(json.dumps({"phase":"DELIVERY_AWAITING_ORIGINAL_OWNER",**delivery_result}),flush=True)
        return 0 if complete else 1
    if receiver!="library":
        raise ValueError("Unknown original artifact receiver")
    upload_request={"uploads":[{"local_path":str(output),"purpose":"create_library_file"}]}
    if source_archive is not None and complete:
        upload_request["uploads"].insert(0,{"local_path":str(source_archive),"purpose":"create_library_file"})
    request_path=work/("library-upload-request-"+publication_key+".json")
    upload_path=work/("library-upload-result-"+publication_key+".json")
    upload_output=work/("library-upload-output-"+publication_key+".json")
    upload_error=work/("library-upload-error-"+publication_key+".log")
    if request_path.exists() and read_json(request_path)!=upload_request:
        raise ValueError("The original upload request binding changed")
    if upload_path.exists():
        if not request_path.exists():
            raise ValueError("A retained upload result has no original request")
        saved=validate_upload_response(read_json(upload_path),upload_request)
    elif request_path.exists():
        try:
            saved=validate_upload_response(read_json(upload_output),upload_request)
        except (OSError,ValueError,TypeError) as error:
            raise RuntimeError("An earlier upload outcome is uncertain; reconcile its original request before another write") from error
        atomic_json(upload_path,saved)
    else:
        if upload_output.exists() or upload_error.exists():
            raise ValueError("Retained upload output has no original request")
        atomic_json(request_path,upload_request)
        with open(upload_output,"xb") as stdout,open(upload_error,"xb") as stderr:
            child=subprocess.run([config["python"],str(work/"library-helper"/"library_upload.py")],
                input=json.dumps(upload_request).encode(),stdout=stdout,stderr=stderr,cwd=work,shell=False)
            stdout.flush();os.fsync(stdout.fileno())
            stderr.flush();os.fsync(stderr.fileno())
        saved=validate_upload_response(read_json(upload_output),upload_request)
        atomic_json(upload_path,saved)
    outcomes=saved.get("results",[])
    available=(len(outcomes)==len(upload_request["uploads"]) and
        all(x.get("status")=="succeeded" and x.get("library_file_id") for x in outcomes))
    delivery_result={**artifact,"available":available,"saved":outcomes}
    atomic_json(work/"delivery-result.json",delivery_result)
    try: atomic_json(original/"full-delivery-result.json",delivery_result)
    except OSError: pass
    print(json.dumps({"phase":"DELIVERY_SAVED" if available else "DELIVERY_SAVE_RECONCILE",
        **delivery_result}),flush=True)
    return 0 if complete and available else 1

if __name__=="__main__":
    raise SystemExit(main())
