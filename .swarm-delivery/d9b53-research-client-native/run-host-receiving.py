#!/usr/bin/env python3
"""Run the two original NCC receiving stages on one selected native host."""
from __future__ import annotations
import argparse, hashlib, json, os, stat, subprocess, sys, uuid
from pathlib import Path
os.umask(0o077)
BUSINESS="SCF-RESEARCH-CLIENT-NCC-D9B53-20261012"
ORIGINAL_ROOT=Path("/dev/research-original-d9b53-20261012")
def need(value,message):
    if not value:raise RuntimeError(message)
def read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,"rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode),"Use an ordinary selected input")
        return stream.read()
def identity(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256()
    with os.fdopen(fd,"rb") as stream:
        before=os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode),"Use an ordinary selected file")
        for block in iter(lambda:stream.read(1048576),b""):h.update(block)
        after=os.fstat(stream.fileno())
    need(all(getattr(before,k)==getattr(after,k) for k in ("st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")),
         "The selected file changed")
    return {"bytes":after.st_size,"sha256":h.hexdigest()}
def write_selected(path,value):
    body=(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temporary=path.with_name(path.name+"."+uuid.uuid4().hex+".pending")
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
    try:os.link(temporary,path)
    except FileExistsError:need(read(path)==body,"Preserve the existing original host selection")
    finally:temporary.unlink()
def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--checkpoint",required=True,type=Path)
parser.add_argument("--bundle",required=True,type=Path)
parser.add_argument("--case-directory",type=Path,default=Path("/mnt/data/research-original-d9b53-20261012"))
parser.add_argument("--node",type=Path,default=Path("/opt/nvm/versions/node/v22.16.0/bin/node"))
parser.add_argument("--control-root",required=True,type=Path)
parser.add_argument("--initialize-control",action="store_true")
parser.add_argument("--helper-directory",type=Path)
parser.add_argument("--observation-directory",type=Path)
parser.add_argument("--host-reference",default="https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791821651290859?thread_ts=1791820556.755929")
args=parser.parse_args()
kit=Path(__file__).resolve(strict=True).parent
manifest=json.loads(read(kit/"manifest.json"))
need(manifest["schema"]=="sf88.research-client.complete-host-receiving-kit.v1"
     and manifest["operationId"]==BUSINESS,"Use the complete original receiving packet")
for row in manifest["files"]:
    path=Path(row["path"])
    need(not path.is_absolute() and ".." not in path.parts and str(path)==row["path"],"Unsafe receiving source member")
    need(identity(kit/path)=={key:row[key] for key in ("bytes","sha256")},"The selected receiving source changed: "+str(path))
checkpoint=args.checkpoint.resolve(strict=True);bundle=args.bundle.resolve(strict=True)
need(identity(checkpoint)==manifest["checkpoint"]["identity"],"The complete original checkpoint differs")
need(identity(bundle)==manifest["bundle"]["identity"],"The complete original Ottawa bundle differs")
case=args.case_directory
need(case.is_absolute() and case.parent.resolve(strict=True)==case.parent,"Use an actual ordinary receiving parent")
control=args.control_root
need(control.is_absolute(),"Select the host's actual shared native control root")
helper=(args.helper_directory or kit/"library-helper").resolve(strict=True)
need(all((helper/name).is_file() for name in ("library_upload.py","library_file_transfer.py","library_hosted_apps.py")),
     "Use the complete original Library helper directory")
node=args.node.resolve(strict=True)
need(node.is_file() and os.access(node,os.X_OK),"Use the actual compatible Node executable")
version=subprocess.check_output([str(node),"--version"],text=True,timeout=10).strip()
need(version.startswith("v") and int(version[1:].split(".")[0])>=22,"The original source requires Node 22 or newer")
observation=args.observation_directory or case.with_name(case.name+"-observations")
need(observation.is_absolute() and observation.parent.resolve(strict=True)==observation.parent,
     "Use the actual ordinary observation parent")
selection=json.loads(read(kit/"linked-native-input-template.json"))
selection["checkpointFile"]=str(checkpoint)
selection["hostBinding"]={"schema":"sf88.research-client.native-host-binding.v1",
    "caseDirectory":str(case),"node":str(node),"sharedControl":str(control),
    "controlMode":"initialize" if args.initialize_control else "existing",
    "helperDirectory":str(helper),"observationDirectory":str(observation),
    "hostReference":args.host_reference}
selected_native=kit/"linked-native-input.json"
write_selected(selected_native,selection)
emit({"state":"original-host-selected","operationId":BUSINESS,"caseDirectory":str(case),
      "node":str(node),"nodeVersion":version,"python":sys.executable,"sharedControl":str(control),
      "checkpoint":manifest["checkpoint"]["identity"],"bundle":manifest["bundle"]["identity"]})
def run_stage(program,input_file,label):
    log_directory=kit/"native-outputs";log_directory.mkdir(mode=0o700,exist_ok=True)
    name=label+"-"+uuid.uuid4().hex
    command=[sys.executable,"-B",str(kit/program),"--input-file",str(input_file)]
    with (log_directory/(name+".stdout")).open("xb") as log:
        child=subprocess.Popen(command,stdin=sys.stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        emit({"state":"original-stage-started","stage":label,"operationId":BUSINESS,
              "pid":child.pid,"command":command})
        for line in iter(child.stdout.readline,b""):
            log.write(line);log.flush()
            sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
        status=child.wait();log.flush();os.fsync(log.fileno())
    write_selected(log_directory/(name+".wait.json"),{"operationId":BUSINESS,"stage":label,
                   "exitCode":status,"exitObserved":True,"command":command})
    emit({"state":"original-stage-returned","operationId":BUSINESS,"stage":label,"exitCode":status})
    return status
status=run_stage("hosted-linked-native-continuation.py",selected_native,"original-research")
if status:raise SystemExit(status)
report=json.loads(read(case/"project/results/native-report.json"))
need(report["state"]=="complete" and report["operationId"]==BUSINESS,
     "The preceding original native report is incomplete")
original_text=read(kit/"ottawa-receiving-input-original.json").decode("utf-8")
selected=json.loads(original_text)
for key in ("directory","sourceDirectory","outputDirectory","originalNativeReport","sourceEnvelopeFile"):
    selected[key]=str(case/Path(selected[key]).relative_to(ORIGINAL_ROOT))
selected["bundle"]={**selected["bundle"],
    "file":str(case/Path(selected["bundle"]["file"]).relative_to(ORIGINAL_ROOT))}
write_selected(kit/"ottawa-receiving-input-host.json",selected)
following=json.loads(read(kit/"ottawa-owner-input-template.json"))
following["bundleFile"]=str(bundle);following["helperDirectory"]=str(helper)
write_selected(kit/"ottawa-owner-input.json",following)
status=run_stage("hosted-ottawa-receiving.py",kit/"ottawa-owner-input.json","original-ottawa")
emit({"state":"original-host-receiving-return","operationId":BUSINESS,"exitCode":status,
      "caseDirectory":str(case),"researchReport":str(case/"project/results/native-report.json"),
      "ottawaReport":str(case/"continuations/ottawa-source-bundle/output/receiving-state.json")})
raise SystemExit(status)
