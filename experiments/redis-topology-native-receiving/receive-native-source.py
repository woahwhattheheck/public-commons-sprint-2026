#!/usr/bin/env python3
"""Materialize the published Redis native journey with the maintained Git receiver."""
import argparse,base64,gzip,hashlib,json,os,pathlib,subprocess,sys
P=pathlib.Path
COMMIT="9c70294811b07f8cdba78479763ae55baf2e2f21"
PACKET_SHA="887146cbbda1e7c2887063da8af0865e3b5ae552a5acbca494eb0bd061da294b"
PACKET_BYTES=4315156
RECEIVER_BLOB="b4cfcbad88e1d076625e8f59badf315f08f9c23f"
def oid(body,kind="blob"):
 return hashlib.sha1((kind+" "+str(len(body))+"\0").encode()+body).hexdigest()
def original(path,body):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.exists():
  if path.is_symlink() or path.read_bytes()!=body:raise ValueError("Different retained input: "+str(path))
  return
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,"wb") as out:out.write(body);out.flush();os.fsync(out.fileno())
parser=argparse.ArgumentParser()
parser.add_argument("--packet",required=True)
parser.add_argument("--directory",required=True)
parser.add_argument("--git",default="git")
parser.add_argument("--dependency-root",required=True,help="Existing installed node_modules directory")
args=parser.parse_args()
raw=P(args.packet).read_bytes()
if hashlib.sha256(raw).hexdigest()!=PACKET_SHA:
 wrapper=json.loads(raw)
 if wrapper.get("encoding")=="base64":raw=base64.b64decode(wrapper["content"],validate=False)
 elif set(wrapper)=={"content"} and isinstance(wrapper["content"],str):raw=wrapper["content"].encode("utf-8")
assert len(raw)==PACKET_BYTES and hashlib.sha256(raw).hexdigest()==PACKET_SHA,"Original packet bytes differ"
packet=json.loads(raw)
assert packet["schema"]=="stellar-forge.native-source-capture.v1"
meta=packet["metadata"]
assert meta["source"]["commit"]==COMMIT and oid(meta["commitText"].encode(),"commit")==COMMIT
assert meta["tree"]["truncated"] is False
by_path={row["path"]:row for row in meta["tree"]["tree"] if row["type"]=="blob"}
bodies={}
for row in packet["blobs"]:
 assert row["encoding"]=="utf-8"
 body=row["content"].encode("utf-8")
 assert oid(body)==row["sha"],"Captured original blob differs"
 assert row["sha"] not in bodies
 bodies[row["sha"]]=body
assert len(meta["requiredPaths"])==281 and len(bodies)==281
for name in meta["requiredPaths"]:
 row=by_path[name];assert row["sha"] in bodies and len(bodies[row["sha"]])==row["size"]
receiver=packet["receiver"]["content"].encode("utf-8")
assert oid(receiver)==RECEIVER_BLOB
root=P(args.directory).absolute()
root.mkdir(parents=True,exist_ok=True,mode=0o700)
assert root.resolve()==root,"Receiving directory must retain its original canonical path"
dependencies=P(args.dependency_root).resolve(strict=True)
assert dependencies.is_dir()
redis=json.loads((dependencies/"@redis/client/package.json").read_text())
assert redis["version"]=="6.2.1","Use the original installed Redis client6.2.1"
metadata=root/"metadata.json";incoming=root/"incoming";source=root/"source";cache=root/"source-cache"
original(metadata,(json.dumps(meta,ensure_ascii=False,separators=(",",":"))+"\n").encode("utf-8"))
original(root/"git-object-receiving.py",receiver)
for sha,body in bodies.items():original(incoming/(sha+".blob.gz"),gzip.compress(body,mtime=0))
command=[sys.executable,str(root/"git-object-receiving.py"),"--metadata",str(metadata),
 "--commit",COMMIT,"--directory",str(cache),"--incoming",str(incoming),"--materialize",str(source),"--git",args.git]
result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
attempt=hashlib.sha256(result.stdout+b"\0"+result.stderr).hexdigest()[:20]
original(root/("source-receiver-"+attempt+".stdout"),result.stdout)
original(root/("source-receiver-"+attempt+".stderr"),result.stderr)
if result.returncode:
 sys.stdout.buffer.write(result.stdout);sys.stderr.buffer.write(result.stderr);raise SystemExit(result.returncode)
link=source/"node_modules"
if link.is_symlink():assert link.resolve()==dependencies
elif link.exists():assert link.resolve()==dependencies
else:link.symlink_to(dependencies,target_is_directory=True)
receipt={"schema":"stellar-forge.native-source-received.v1","state":"SOURCE_AVAILABLE",
 "sourceCommit":COMMIT,"sourceRoot":str(source),"dependencyRoot":str(dependencies),
 "files":len(meta["requiredPaths"]),"bytes":sum(by_path[p]["size"] for p in meta["requiredPaths"]),
 "packetSha256":PACKET_SHA,"metadata":str(metadata),"cache":str(cache),
 "entrypoint":str(source/packet["sourceJourney"]["entrypoint"])}
original(root/"source-received.json",(json.dumps(receipt,indent=2)+"\n").encode())
print(json.dumps(receipt),flush=True)
