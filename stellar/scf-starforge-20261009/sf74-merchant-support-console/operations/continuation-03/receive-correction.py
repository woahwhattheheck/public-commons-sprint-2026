#!/usr/bin/env python3
"""Receive all 156 original SF74 sources with corrected helper imports and part bindings."""
from __future__ import annotations
import argparse, ast, hashlib, importlib.util, io, json, os, stat, sys, uuid, zipfile
from pathlib import Path

def digest(data): return hashlib.sha256(data).hexdigest()
def blob(data): return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
def encoded(value): return (json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
def regular(path, maximum=8*1024*1024):
 fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
 with os.fdopen(fd,"rb") as f:
  before=os.fstat(f.fileno())
  if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:raise ValueError("Expected bounded original file")
  data=f.read(maximum+1);after=os.fstat(f.fileno())
  if len(data)>maximum or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
   raise ValueError("Source changed while reading")
  return data
def check(data,row):
 if len(data)!=row["bytes"] or digest(data)!=row["sha256"] or row.get("blob",blob(data))!=blob(data):
  raise ValueError("Source identity differs: "+str(row.get("name",row.get("path","input"))))
def private(path):
 if not path.is_absolute() or str(path)!=os.path.normpath(str(path)):raise ValueError("Use normalized absolute paths")
 path.mkdir(parents=True,exist_ok=True,mode=0o700)
 s=path.lstat()
 if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077:
  raise ValueError("Use an owned private target directory")
def retain(path,data):
 if path.exists() or path.is_symlink():
  if regular(path,max(len(data),1))!=data:raise ValueError("Preserve divergent source at "+str(path))
  return
 temporary=path.with_name(path.name+".writing-"+uuid.uuid4().hex)
 try:
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  try:os.link(temporary,path)
  except FileExistsError:
   if regular(path,max(len(data),1))!=data:raise ValueError("Concurrent source differs")
  d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  try:temporary.unlink()
  except FileNotFoundError:pass
def receive(args):
 companion=Path(__file__).resolve().parent
 declaration_bytes=regular(companion/"source-correction.json")
 declaration=json.loads(declaration_bytes)
 if declaration.get("schema")!="stellar-forge.native06-source-correction.v1":raise ValueError("Use the original source correction")
 original=declaration["original"];rows=original["files"];source={}
 if args.original_carrier_zip:
  raw=regular(Path(args.original_carrier_zip));check(raw,original["archive"])
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   names=z.namelist()
   if len(names)!=len(set(names)) or len(names)!=len(rows):raise ValueError("Original carrier inventory differs")
   selected=set()
   for row in rows:
    candidates=[p for p in (row["name"],original["prefix"]+row["name"]) if p in names]
    if len(candidates)!=1:raise ValueError("Original carrier file missing or duplicated")
    name=candidates[0];selected.add(name);info=z.getinfo(name)
    if info.is_dir() or stat.S_ISLNK(info.external_attr>>16):raise ValueError("Original carrier is not a regular source file")
    data=z.read(info);check(data,row);source[row["name"]]=data
   if selected!=set(names):raise ValueError("Unselected original carrier member")
 else:
  root=Path(args.original_carrier_directory)
  for row in rows:
   data=regular(root/row["name"]);check(data,row);source[row["name"]]=data
 index=json.loads(source["native06-source.json"])
 if digest(source["native06-source.json"])!=original["indexSha256"]:raise ValueError("Original source index differs")
 manifest=json.loads(index["manifest"]["text"])
 if digest(index["manifest"]["text"].encode())!=original["sourceManifestSha256"]:raise ValueError("Original source manifest differs")
 by_path={r["path"]:r for r in manifest["files"]}
 if len(by_path)!=len(manifest["files"]) or len(by_path)!=156:raise ValueError("Original selected source set differs")
 amendments={r["path"]:r for r in declaration["amendments"]}
 seen=set();changed=set();parts={}
 for part_row in index["parts"]:
  name=part_row["path"];body=source[name];check(body,part_row);part=json.loads(body)
  if (part.get("schema")!="stellar-forge.native06-commercial-source-part.v1" or
      part.get("sourceManifestSha256")!=original["sourceManifestSha256"]):
   raise ValueError("Original source part binding differs")
  parts[name]=part
  for row in part["files"]:
   path=row["path"]
   if path in seen or path not in by_path:raise ValueError("Original source path differs")
   seen.add(path);data=row["content"].encode();check(data,by_path[path])
   if path in amendments:
    change=amendments[path]
    if blob(data)!=change["preimage"] or row["content"].count(change["oldImport"])!=1:
     raise ValueError("Original helper-import preimage differs")
    text=row["content"].replace(change["oldImport"],change["newImport"]);post=text.encode()
    check(post,change);row["content"]=text;changed.add(path)
    for field in ("bytes","sha256","blob"):by_path[path][field]=change[field]
 if seen!=set(by_path) or changed!=set(amendments):raise ValueError("Incomplete original source correction")
 manifest["interpretation"]+=declaration["manifestInterpretationSuffix"]
 manifest["amendments"].extend({k:v for k,v in row.items() if k not in ("oldImport","newImport")} for row in declaration["amendments"])
 manifest_bytes=encoded(manifest)
 # Freeze the corrected manifest before binding every complete part to it.
 for part_row in index["parts"]:
  name=part_row["path"];part=parts[name]
  part["sourceManifestSha256"]=digest(manifest_bytes)
  source[name]=encoded(part)
  part_row.update(bytes=len(source[name]),sha256=digest(source[name]),blob=blob(source[name]))
 index["manifest"].update(text=manifest_bytes.decode(),bytes=len(manifest_bytes),sha256=digest(manifest_bytes))
 source["native06-source.json"]=encoded(index)
 source.pop("native06-native-host.py");source.pop("NATIVE06_NATIVE_HOST.md")
 source["native06-native-host-03.py"]=regular(companion/"native06-native-host-03.py")
 expected=declaration["corrected"]
 if digest(manifest_bytes)!=expected["sourceManifestSha256"] or digest(source["native06-source.json"])!=expected["indexSha256"]:
  raise ValueError("Corrected source manifest differs")
 if set(source)!={r["name"] for r in expected["files"]}:raise ValueError("Corrected carrier is incomplete")
 for row in expected["files"]:check(source[row["name"]],row)
 ast.parse(source["native06-native-host-03.py"],filename="native06-native-host-03.py")
 ast.parse(source["native06-source-receive.py"],filename="native06-source-receive.py")
 target=Path(args.carrier);private(target)
 # Check every prior file before retaining the first new source file.
 for name,data in source.items():
  p=target/name
  if (p.exists() or p.is_symlink()) and regular(p,max(len(data),1))!=data:raise ValueError("Preserve divergent carrier")
 for name,data in source.items():retain(target/name,data)
 for name in ("source-correction.json","receive-correction.py"):
  retain(target/name,regular(companion/name))
 receipt={"schema":"stellar-forge.native06-corrected-source-receipt.v1","nativeOperation":declaration["nativeOperation"],
          "businessOperation":declaration["businessOperation"],"original":original["archive"],
          "sourceManifestSha256":expected["sourceManifestSha256"],"indexSha256":expected["indexSha256"],
          "sourceFiles":156,"sourceBytes":sum(r["bytes"] for r in manifest["files"]),
          "sourceAmendments":declaration["amendments"],"files":expected["files"]}
 retain(target/"SOURCE-RECEIVING.json",encoded(receipt))
 print(json.dumps({"event":"SF74_CORRECTED_SOURCE_READY","carrier":str(target),"files":156,
                   "sourceManifestSha256":expected["sourceManifestSha256"],"nativeOperation":declaration["nativeOperation"]}),flush=True)
 return declaration,target
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 original=parser.add_mutually_exclusive_group(required=True)
 original.add_argument("--original-carrier-zip")
 original.add_argument("--original-carrier-directory")
 parser.add_argument("--carrier",required=True)
 args=parser.parse_args();declaration,target=receive(args)
 return 0
if __name__=="__main__":
 try:raise SystemExit(main())
 except Exception as error:
  print(json.dumps({"event":"SF74_SOURCE_CORRECTION_STOPPED","code":type(error).__name__,"message":str(error)}),file=sys.stderr,flush=True)
  raise SystemExit(1)
