#!/usr/bin/env python3
"""Run the one original merchant lifecycle receiver from its exact source map."""
import argparse, datetime, hashlib, json, os, pathlib, subprocess, sys

parser=argparse.ArgumentParser()
parser.add_argument("source_map",type=pathlib.Path)
parser.add_argument("--directory",required=True,type=pathlib.Path)
parser.add_argument("--node",default="node")
args=parser.parse_args()
raw=args.source_map.read_bytes()
blob=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
if blob!="a85b9dc0cea654ae7ae75149d2759f8c086c89a4":
    raise ValueError("The complete source-map Git identity differs")
payload=json.loads(raw);files=payload["files"];manifest=payload["manifest"]
if payload["commit"]!="6668e417044170e9c2291afe9e50e7ef14c3d97d":
    raise ValueError("The declared original source composition differs")
if set(files)!=set(manifest["files"]):
    raise ValueError("Source and manifest scopes differ")
for name,content in files.items():
    path=pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:raise ValueError("Source path escapes")
    body=content.encode("utf-8")
    actual=hashlib.sha1(b"blob "+str(len(body)).encode()+b"\0"+body).hexdigest()
    if actual!=manifest["files"][name]:raise ValueError("Source hash differs: "+name)
version=subprocess.check_output([args.node,"--version"],text=True).strip()
if int(version.lstrip("v").split(".")[0])<24:raise ValueError("Use the installed Node24 or newer runtime")
root=args.directory.resolve()
root.mkdir(mode=0o700,parents=True,exist_ok=False)
source=root/"source"
for name,content in files.items():
    target=source/name;target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(content,encoding="utf-8")
manifest_path=root/"published-source.json"
manifest_path.write_text(json.dumps(manifest),encoding="utf-8")
operation="merchant-provider-lifecycle-native-ee290-20261012"
(root/"receiving-started.json").write_text(json.dumps({
    "operation":operation,"sourceCommit":payload["commit"],"sourceMapBlob":blob,
    "node":version,"startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat()
},indent=2),encoding="utf-8")
check="""import {SourceTextModule} from 'node:vm'; import {readFileSync} from 'node:fs'; import {join} from 'node:path'; const manifest=JSON.parse(readFileSync(process.argv[2],'utf8')); const errors=[]; let files=0; for(const path of Object.keys(manifest.files)){if(!(path.endsWith('.mjs')||path.endsWith('.js')))continue;files++;try{new SourceTextModule(readFileSync(join(process.argv[1],path),'utf8'),{identifier:path});}catch(error){errors.push({path,message:error.message});}} console.log(JSON.stringify({state:errors.length?'SOURCE_PARSE_FAILED':'SOURCE_PARSE_COMPLETE',files,errors})); if(errors.length)process.exitCode=1;"""
parsed=subprocess.run([args.node,"--experimental-vm-modules","--input-type=module","-e",check,str(source),str(manifest_path)],capture_output=True,text=True,timeout=30)
(root/"source-parse.stdout").write_text(parsed.stdout,encoding="utf-8")
(root/"source-parse.stderr").write_text(parsed.stderr,encoding="utf-8")
print(parsed.stdout,flush=True)
if parsed.returncode:raise SystemExit(parsed.returncode)
report=root/"provider-lifecycle-native-run.json"
command=[args.node,str(source/"stellar-forge/mcp-merchant-operator/receiving/provider-lifecycle.mjs"),str(report),str(manifest_path)]
print(json.dumps({"state":"NATIVE_STARTED","operation":operation,"sourceCommit":payload["commit"],"command":command}),flush=True)
run=subprocess.run(command,capture_output=True,text=True,timeout=180)
(root/"native.stdout").write_text(run.stdout,encoding="utf-8")
(root/"native.stderr").write_text(run.stderr,encoding="utf-8")
result=report.read_text(encoding="utf-8") if report.is_file() else None
print(json.dumps({
    "state":"NATIVE_FINISHED","operation":operation,"sourceCommit":payload["commit"],
    "exitCode":run.returncode,"reportPath":str(report),"reportText":result,
    "reportSha256":hashlib.sha256(result.encode()).hexdigest() if result is not None else None,
    "stdout":run.stdout if result is None else None,"stderr":run.stderr
}),flush=True)
raise SystemExit(run.returncode)
