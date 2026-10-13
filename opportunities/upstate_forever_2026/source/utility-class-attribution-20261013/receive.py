#!/usr/bin/env python3
"""Materialize the complete original utility class-attribution delivery."""
import argparse,base64,gzip,hashlib,json,pathlib
p=argparse.ArgumentParser(description=__doc__)
p.add_argument("--part",type=pathlib.Path,action="append",required=True)
p.add_argument("--destination",type=pathlib.Path,required=True)
a=p.parse_args()
sha=lambda b:hashlib.sha256(b).hexdigest()
parts=[json.loads(f.read_text(encoding="utf-8-sig")) for f in a.part]
if len(parts)!=2 or sorted(x["index"] for x in parts)!=[0,1]:raise ValueError("Supply the two different original parts")
parts.sort(key=lambda x:x["index"])
for x in parts:
    if x["schema"]!="upstate.original-source-part/v1" or x["source_id"]!="utility-class-attribution-20261013" or x["total"]!=2:raise ValueError("Source-part identity differs")
data=base64.b64decode("".join(x["content_base64"] for x in parts),validate=True)
if len(data)!=621467 or sha(data)!="b4d9b11ae06eb59d45b32b77551f29c136806fcafda68b74be3b66c55b458204":raise ValueError("Original compressed body differs")
raw=gzip.decompress(data)
if len(raw)!=5993646 or sha(raw)!="577822f2c7cc1ecf07851cc26c362b1b1d19cef65b5af74167a5e02d713441a4":raise ValueError("Original complete bank differs")
bank=json.loads(raw)
if bank["schema"]!="commons.source-bank/v1" or len(bank["files"])!=20:raise ValueError("Complete original20-member bank is required")
files={}
for f in bank["files"]:
    name=f["path"];rel=pathlib.PurePosixPath(name);body=f["content"].encode("utf-8")
    if rel.is_absolute() or ".." in rel.parts or "\\" in name or name in files or not name:raise ValueError("Invalid original member path")
    if len(body)!=f["bytes"] or sha(body)!=f["sha256"]:raise ValueError("Original member differs: "+name)
    files[name]=body
root=a.destination.resolve()
root.mkdir(parents=True,exist_ok=False)
for name,body in files.items():
    target=root.joinpath(*pathlib.PurePosixPath(name).parts)
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open("xb") as f:f.write(body)
print(json.dumps({"directory":str(root),"files":len(files),"bytes":sum(map(len,files.values())),"open":str(root/"OPEN_FIRST.html"),"native_sources":str(root/"native-sources.json")}))
