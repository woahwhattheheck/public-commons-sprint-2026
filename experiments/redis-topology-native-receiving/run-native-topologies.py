#!/usr/bin/env python3
"""Run both complete Redis topology journeys through the existing native controller."""
import argparse,hashlib,json,os,pathlib,subprocess,sys,time
from types import SimpleNamespace

P=pathlib.Path
OPERATION="SCF-REDIS-TOPOLOGY-F8256-20261012"
COMMIT="9c70294811b07f8cdba78479763ae55baf2e2f21"
RECEIVER_SHA="8ae417ff02eb1b30a0f718574d47cba86df90692f9ce50b3c023bff9c044945b"
PACKET_SHA="887146cbbda1e7c2887063da8af0865e3b5ae552a5acbca494eb0bd061da294b"
parser=argparse.ArgumentParser(description=__doc__)
for name in ("directory","packet","receiver","dependency-root","node","git","redis-server","openssl",
             "playwright-module","chromium-executable","native-host","shared-state-root"):
    parser.add_argument("--"+name,required=True)
parser.add_argument("--library-path",help="Existing Redis shared-library directory, when required")
parser.add_argument("--execute",action="store_true",help=argparse.SUPPRESS)
args=parser.parse_args()
root=P(args.directory).absolute()
root.mkdir(mode=0o700,parents=True,exist_ok=True)
if root.resolve()!=root:raise ValueError("Use the original canonical receiving directory")
for name in ("packet","receiver","dependency_root","node","git","redis_server","openssl",
             "playwright_module","chromium_executable","native_host","shared_state_root"):
    path=P(getattr(args,name))
    if not path.is_absolute() or not path.exists():raise ValueError("Select existing absolute "+name)
for name,expected in (("packet",PACKET_SHA),("receiver",RECEIVER_SHA)):
    if hashlib.sha256(P(getattr(args,name)).read_bytes()).hexdigest()!=expected:
        raise ValueError("Original "+name+" differs")
if not args.execute:
    shared=P(args.shared_state_root)
    os.environ["SWARM_STATE_ROOT"]=str(shared)
    sys.path.insert(0,args.native_host)
    from native_foreground import load_native,ForegroundLaunch
    native=load_native(args.native_host)
    command=[sys.executable,"-B",str(P(__file__).resolve()),*sys.argv[1:],"--execute"]
    native_args=SimpleNamespace(
        peer="f8256-redis-topology",operation_id=OPERATION,project=str(root),java=None,node=None,
        artifact=["results/receiving-result.json","results/cluster/native-result.json",
                  "results/cluster/workspace.png","results/sentinel-tls/native-result.json",
                  "results/sentinel-tls/workspace.png"],
        runtime_path=[args.native_host,str(P(__file__).resolve()),args.packet,args.receiver,
                      args.dependency_root,args.node,args.git,args.redis_server,args.openssl,
                      args.playwright_module,args.chromium_executable],
        command=command,memory_mib=768,memory_reserve_mib=128,memory_reclaim="clean-cache",
        memory_reservations_root=str(shared/"capacity/memory"),
        disk_space=[str(root)+"=128"],disk_inodes=[str(root)+"=4096"],
        disk_reserve_mib=64,disk_reserve_inodes=512,
        disk_reservations_root=str(shared/"capacity/disk"),
        records_root=str(root/"control/records"),worker_root=str(shared/"worker"),
        temp_root=str(root/"control/tmp"))
    launch=ForegroundLaunch(native)
    try:
        result=native.start(native_args,launcher=launch)
        print(json.dumps({key:result.get(key) for key in
            ("ok","state","operation_id","record","memory","disk","process","supervisor","reused")}),flush=True)
    finally:
        if launch.root is not None:
            code=launch.handoff()
            if code is not None:raise SystemExit(code)
    raise SystemExit(0)

os.umask(0o077)
results=root/"results";results.mkdir(mode=0o700,exist_ok=True)
started=time.time()
receiving=root/"source-receiving"
prepare=[sys.executable,"-B",args.receiver,"--packet",args.packet,"--directory",str(receiving),
         "--dependency-root",args.dependency_root,"--git",args.git]
with (results/"source.stdout").open("ab") as stdout,(results/"source.stderr").open("ab") as stderr:
    result=subprocess.run(prepare,stdout=stdout,stderr=stderr)
if result.returncode:raise SystemExit(result.returncode)
selected=json.loads((receiving/"source-received.json").read_text())
if selected["sourceCommit"]!=COMMIT:raise ValueError("Original source commit differs")
source=P(selected["sourceRoot"])
entry=P(selected["entrypoint"])
if not entry.is_file() or not entry.is_relative_to(source):raise ValueError("Original entrypoint differs")
environment=os.environ.copy()
environment.pop("SF30_REDIS_JOURNEY_PROVIDER",None)
environment.pop("SF30_REDIS_JOURNEY_TLS",None)
environment.update(REDIS_SERVER=args.redis_server,OPENSSL=args.openssl,
    SF30_REDIS_JOURNEY_WORKSPACE="1",SF30_REDIS_WORKSPACE_BROWSER="1",
    SF30_PLAYWRIGHT_MODULE=args.playwright_module,SF30_CHROMIUM_EXECUTABLE=args.chromium_executable)
options=environment.get("NODE_OPTIONS","")
for option in ("--preserve-symlinks","--preserve-symlinks-main"):
    if option not in options.split():options=(options+" "+option).strip()
environment["NODE_OPTIONS"]=options
if args.library_path:
    library=P(args.library_path)
    if not library.is_absolute() or not library.is_dir():raise ValueError("Select the existing library directory")
    environment["LD_LIBRARY_PATH"]=str(library)+(":"+environment["LD_LIBRARY_PATH"] if environment.get("LD_LIBRARY_PATH") else "")
phases=[]
for name,topology,tls in (("cluster","cluster",False),("sentinel-tls","sentinel",True)):
    directory=results/name;directory.mkdir(mode=0o700,exist_ok=True)
    temporary=root/("temporary-"+name);temporary.mkdir(mode=0o700,exist_ok=True)
    result_file=directory/"native-result.json"
    phase_environment={**environment,"TMPDIR":str(temporary),"SF30_REDIS_JOURNEY_TOPOLOGY":topology,
        "SF30_REDIS_JOURNEY_OUTPUT":str(result_file),
        "SF30_REDIS_WORKSPACE_SCREENSHOT":str(directory/"workspace.png"),
        "SF30_REDIS_WORKSPACE_DIAGNOSTICS":str(directory/"workspace-diagnostics.json")}
    if tls:phase_environment["SF30_REDIS_JOURNEY_TLS"]="1"
    print(json.dumps({"phase":name,"state":"RUNNING","sourceCommit":COMMIT}),flush=True)
    with (directory/"stdout.log").open("ab") as stdout,(directory/"stderr.log").open("ab") as stderr:
        completed=subprocess.run([args.node,str(entry)],cwd=source,env=phase_environment,stdout=stdout,stderr=stderr)
    outcome=json.loads(result_file.read_text()) if result_file.is_file() else None
    passed=(completed.returncode==0 and outcome is not None and outcome.get("result")=="PASS"
            and outcome.get("workspace",{}).get("result")=="PASS" and len(outcome.get("deliveries",[]))==6)
    phase={"phase":name,"exitCode":completed.returncode,"state":"PASS" if passed else "FAILED",
           "resultFile":str(result_file),"result":outcome}
    phases.append(phase)
    summary={"schema":"stellar-forge.redis-native-topology-receiving.v1","operation":OPERATION,
        "sourceCommit":COMMIT,"source":selected,"startedAt":started,"observedAt":time.time(),
        "state":"PASS" if len(phases)==2 and all(p["state"]=="PASS" for p in phases) else
                "FAILED" if not passed else "RUNNING","phases":phases}
    (results/"receiving-result.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps({"phase":name,"state":phase["state"],"exitCode":completed.returncode,
                      "resultFile":str(result_file)}),flush=True)
    if not passed:raise SystemExit(completed.returncode or 1)
print(json.dumps({"state":"PASS","operation":OPERATION,"sourceCommit":COMMIT,
                  "result":str(results/"receiving-result.json")}),flush=True)
