import argparse, csv, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent
APP = ROOT / "application"
OUT = ROOT / "receptor-network-receiving"
RECEIVING = ROOT / "receptor-native-operation"
SOURCE = ROOT / "inputs/dbc61-upstate-model-domain-20261012.zip"
PROFILE = APP / "source/receptor-profiles/utility-focus-20261012.json"
ORIGINAL = {"bytes":8800689,"sha256":"1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04","decoded_sha256":"2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"}
OPERATION = "UPSTATE-RECEPTOR-RECEIVING-20261012"
def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()
def save(name, value):
    RECEIVING.mkdir(parents=True,exist_ok=True)
    target=RECEIVING/name
    temp=target.with_name(target.name+".tmp")
    with temp.open("w",encoding="utf-8") as stream:
        json.dump(value,stream,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)
        stream.write("\n");stream.flush();os.fsync(stream.fileno())
    os.replace(temp,target)
def capacity():
    data={"root_disk_free":shutil.disk_usage(ROOT).free,"time":time.time()}
    try:
        data["memory_current"]=int(Path("/sys/fs/cgroup/memory.current").read_text())
        raw=Path("/sys/fs/cgroup/memory.max").read_text().strip()
        data["memory_max"]=int(raw) if raw!="max" else None
    except (OSError,ValueError): pass
    return data
def run():
    import fcntl
    RECEIVING.mkdir(parents=True,exist_ok=True)
    with (RECEIVING/"operation.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        current=capacity()
        save("capacity.json",current)
        if current.get("memory_max") is not None and current["memory_max"]-current["memory_current"] < 384*1024*1024:
            print(json.dumps({"operation":OPERATION,"state":"CAPACITY","capacity":current}),flush=True)
            return 75
        if current["root_disk_free"]<96*1024*1024:
            print(json.dumps({"operation":OPERATION,"state":"CAPACITY","capacity":current}),flush=True)
            return 75
        if SOURCE.stat().st_size!=ORIGINAL["bytes"] or digest(SOURCE)!=ORIGINAL["sha256"]:
            raise ValueError("The original selected 217-feature domain archive has changed.")
        sys.path.insert(0,str(APP))
        from model.common import verify_file
        args=[sys.executable,"-B","-m","model.receptor_network_cli","--source",str(SOURCE),"--profile",str(PROFILE),"--output",str(OUT),"--expected-decoded-sha256",ORIGINAL["decoded_sha256"]]
        env=dict(os.environ,PYTHONDONTWRITEBYTECODE="1",PYTHONUNBUFFERED="1")
        current["operation"]=OPERATION
        selected_paths=("model/common.py","model/receptor_network.py","model/receptor_network_cli.py",
            "model/receptors.py","model/receptor_cli.py","model/RECEPTORS.md","model/RECEPTOR_NETWORK.md")
        source_snapshot=[]
        for name in selected_paths:
            path=APP/name
            if not path.is_file(): raise ValueError("The original complete application source is missing: "+name)
            source_snapshot.append({"path":name,"bytes":path.stat().st_size,"sha256":digest(path)})
        source_snapshot.append({"path":str(PROFILE),"bytes":PROFILE.stat().st_size,"sha256":digest(PROFILE)})
        save("selected-source.json",{"operation":OPERATION,"app_root":str(APP),"files":source_snapshot})
        save("started.json",{"operation":OPERATION,"source":ORIGINAL,"argv":args,"capacity":current})
        results=[]
        for phase in ("receive","cold-reopen"):
            completed=subprocess.run(args,cwd=APP,env=env,capture_output=True,text=True,timeout=180)
            (RECEIVING/(phase+".stdout.json")).write_text(completed.stdout,encoding="utf-8")
            (RECEIVING/(phase+".stderr.txt")).write_text(completed.stderr,encoding="utf-8")
            if completed.returncode:
                raise RuntimeError(phase+" failed: "+completed.stderr[-4000:])
            result=json.loads(completed.stdout)
            if result["network_huc12_count"]!=217 or result["source_binding"]["decoded_sha256"]!=ORIGINAL["decoded_sha256"]:
                raise ValueError("The returned network differs from the original selected domain.")
            if phase=="cold-reopen" and (not result["reused"] or result["id"]!=results[0]["id"]):
                raise ValueError("Cold reopen did not retain the original product.")
            directory=Path(result["directory"])
            for descriptor in result["files"].values(): verify_file(directory,descriptor)
            with (directory/"memberships.csv").open(newline="",encoding="utf-8") as stream: members=list(csv.DictReader(stream))
            with (directory/"network.csv").open(newline="",encoding="utf-8") as stream: network=list(csv.DictReader(stream))
            if len(members)!=result["membership_rows"] or len(network)!=217:
                raise ValueError("The complete exported rows do not match the returned network.")
            if any(len(row["huc12"])!=12 or not row["huc12"].isdigit() for row in members+network):
                raise ValueError("An original HUC12 identifier lost its exact formatting.")
            for area in result["areas"]:
                area_members=[row for row in members if row["receptor_id"]==area["id"]]
                if len(area_members)!=area["huc12_count"] or set(row["huc12"] for row in area_members)!=set(area["huc12s"]):
                    raise ValueError("An exported selected area's complete membership differs.")
            results.append(result)
            save(phase+".json",{"operation":OPERATION,"phase":phase,"result":result,"returncode":completed.returncode,"capacity":capacity()})
            print(json.dumps({"operation":OPERATION,"phase":phase,"id":result["id"],"network_huc12_count":result["network_huc12_count"],"membership_rows":result["membership_rows"],"areas":[{"id":x["id"],"count":x["huc12_count"]} for x in result["areas"]],"reused":result["reused"],"directory":result["directory"]}),flush=True)
        save("result.json",{"operation":OPERATION,"state":"SOURCE_PRODUCT_COMPLETE","source":ORIGINAL,"result":results[-1],"phases":["receive","cold-reopen"],"completed_at":time.time(),"selected_source":json.loads((RECEIVING/"selected-source.json").read_text())})
        return 0
if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Receive and cold-reopen the original selected 217-watershed receptor product.")
    parser.add_argument("--app-root",type=Path,default=APP)
    parser.add_argument("--source",type=Path,default=SOURCE)
    parser.add_argument("--profile",type=Path)
    parser.add_argument("--output",type=Path,default=OUT)
    parser.add_argument("--operation-directory",type=Path,default=RECEIVING)
    args=parser.parse_args()
    APP=args.app_root.resolve();SOURCE=args.source.resolve();OUT=args.output.resolve()
    RECEIVING=args.operation_directory.resolve();PROFILE=(args.profile or APP/"source/receptor-profiles/utility-focus-20261012.json").resolve()
    ROOT=RECEIVING
    try: raise SystemExit(run())
    except Exception as error:
        save("last-error.json",{"operation":OPERATION,"type":type(error).__name__,"message":str(error),"time":time.time()})
        print(json.dumps({"operation":OPERATION,"error":type(error).__name__,"message":str(error)}),file=sys.stderr,flush=True)
        raise SystemExit(1)
