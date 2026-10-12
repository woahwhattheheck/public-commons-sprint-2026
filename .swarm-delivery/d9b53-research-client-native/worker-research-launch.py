"""Launch the selected Research job through the original worker's ForegroundLaunch."""
import json,os,sys
from pathlib import Path
from types import SimpleNamespace
root=Path(sys.argv[1]).resolve(strict=True)
config=json.loads((root/"case-input.json").read_text())
if config["directory"]!=str(root):raise RuntimeError("Original private job directory differs.")
shared=Path(config["sharedControl"])
os.environ["SWARM_STATE_ROOT"]=str(shared)
sys.path.insert(0,str(root/"controller/host"))
from native_foreground import load_native,ForegroundLaunch
native=load_native(root/"controller/host")
project=root/"project"
args=SimpleNamespace(peer="d9b53-research-client",operation_id=config["operationId"],
 project=str(project),java=None,node=None,
 artifact=["results/run-result.json","results/run-artifacts.json","results/native-return.tar.gz"],
 runtime_path=[str(root/"controller/host"),str(root/"inbox"),str(root/"case-input.json"),
  str(root/"setup-result.json"),str(root/"private-inputs"),config["node"],str(Path(sys.executable).resolve())],
 command=[sys.executable,"-B",str(root/"inbox/run-original-research-case.py"),str(root/"case-input.json")],
 memory_mib=768,memory_reserve_mib=256,memory_reclaim="clean-cache",
 memory_reservations_root=str(shared/"capacity/memory"),
 disk_space=[str(root)+"=512"],disk_inodes=[str(root)+"=8000"],
 disk_reserve_mib=64,disk_reserve_inodes=256,
 disk_reservations_root=str(shared/"capacity/disk"),
 records_root=str(root/"records"),worker_root=str(root/"worker"),temp_root=str(root/"tmp"))
launch=ForegroundLaunch(native)
try:
 result=native.start(args,launcher=launch)
 print(json.dumps({key:result.get(key) for key in
  ["ok","state","operation_id","record","memory","disk","process","supervisor","reused"]}),flush=True)
finally:
 if launch.root is not None:
  code=launch.handoff()
  if code is not None:raise SystemExit(code)
