#!/usr/bin/env python3
import argparse, base64, gzip, hashlib, json, os
from pathlib import Path, PurePosixPath
p=argparse.ArgumentParser()
p.add_argument("archive", type=Path)
p.add_argument("destination", type=Path)
a=p.parse_args()
compressed=a.archive.read_bytes()
if len(compressed)!=1035190 or hashlib.sha256(compressed).hexdigest()!="b913101e7558759d55067a44d16f8dcd35a19bcb36e7919cd4e10ee231b11739":
    raise SystemExit("Wrong original gzip source")
raw=gzip.decompress(compressed)
if len(raw)!=6490849 or hashlib.sha256(raw).hexdigest()!="cae5fb8b1df095b45d3524cfbd02332f3fb009793a9bb1b2d7174f3ca3e635ae":
    raise SystemExit("Wrong original decoded source")
packet=json.loads(raw)
if packet.get("schema")!="commons.source-bank/v1" or len(packet["files"])!=39:
    raise SystemExit("Incomplete original source bank")
planned={}
for item in packet["files"]:
    name=item["path"]; part=PurePosixPath(name)
    if part.is_absolute() or "\\" in name or str(part)!=name or any(x in ("",".","..") for x in part.parts) or name in planned:
        raise ValueError("Noncanonical or duplicate original member")
    body=item["content"].encode("utf-8")
    if len(body)!=item["bytes"] or hashlib.sha256(body).hexdigest()!=item["sha256"]:
        raise ValueError("Original source hash differs: "+name)
    planned[name]=body
if a.destination.exists():
    raise SystemExit("Choose a new private source directory; original application remains separate")
a.destination.mkdir(parents=True,exist_ok=False)
root=a.destination.resolve()
for name,body in planned.items():
    path=root.joinpath(*PurePosixPath(name).parts)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(body)
print(json.dumps({"schema":"upstate.profile-report-source-received/v1","source_commit":packet["source_commit"],"files":len(planned),"source_root":str(root),"manifest":str(root/"landcover_observation_profiles.report.sources.json")},indent=2))
