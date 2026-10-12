"""Receive the original complete 891b release through its maintained foreground owner."""
from pathlib import Path
from types import SimpleNamespace
import argparse
import hashlib
import json
import os
import sys

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--configuration",required=True)
    parser.add_argument("--memory-mib",type=int,default=1024)
    parser.add_argument("--work-mib",type=int,default=1536)
    args=parser.parse_args()
    config_path=Path(args.configuration).resolve(strict=True)
    selected=json.loads(config_path.read_text())
    source=selected["sourceCommit"]
    if source != "891b207201025a152ba284b622c0b93dde70b906":
        raise ValueError("The original source selection changed")
    root=Path("/workspace/scratch/d1ccf784531e/scf-following-release")
    host=Path("/workspace/scratch/d1ccf784531e/native-prelaunch-recovery/runtime-joint/host")
    work=Path(selected["work"]).resolve(strict=True)
    if not work.is_dir() or work.is_symlink():
        raise ValueError("An existing private native work directory is required")
    for name,expected in selected["hostFiles"].items():
        body=(host/name).read_bytes()
        if hashlib.sha256(body).hexdigest()!=expected:
            raise ValueError("The original foreground host changed: "+name)
    sys.path.insert(0,str(host))
    os.environ["SWARM_NODE24_BIN"]=selected["nodeBin"]
    os.environ["PATH"]=selected["nodeBin"]+os.pathsep+os.environ["PATH"]
    os.environ["PYTHONDONTWRITEBYTECODE"]="1"
    import swarm_cloud_job as native
    from native_foreground import ForegroundLaunch
    original_record="scf-following-source-release-"+source[:8]+"-d1cc-20261011"
    request=SimpleNamespace(
        operation_id=original_record,peer="d1cc-scf-distribution",project=str(root),
        command=[selected["python"],str(work/"run-and-save.py"),str(config_path)],
        java=None,node="24",
        artifact=[str(Path(selected["originalRoot"]).relative_to(root)/"full-native-result.json")],
        runtime_path=[selected["builderDirectory"],str(work),*selected["donorRepositories"]],
        runtime_consumers_root="/workspace/shared/swarm/jobs/runtime-consumers",
        memory_mib=args.memory_mib,memory_reserve_mib=128,memory_reclaim="clean-cache",
        memory_reservations_root="/workspace/shared/swarm/capacity/memory",
        disk_space=[str(work)+"="+str(args.work_mib),str(root)+"=4"],
        disk_inodes=[str(work)+"=32768",str(root)+"=256"],
        disk_reserve_mib=64,disk_reserve_inodes=128,
        disk_reservations_root="/workspace/shared/swarm/capacity/disk",
        records_root=str(root/"records"),worker_root=str(root/"worker"),temp_root=str(root/"temporary"))
    launch=ForegroundLaunch(native)
    code=None
    try:
        report=native.start(request,launcher=launch)
        print(json.dumps({key:report.get(key) for key in ["operation_id","record","state","supervisor_alive","process_alive","reused"]}),flush=True)
    finally:
        if launch.root is not None:
            code=launch.handoff()
    return code or 0

if __name__=="__main__":
    raise SystemExit(main())
