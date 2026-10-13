"""Admit one original client-delivery operation through the maintained native host."""
from __future__ import annotations
import argparse,json,os,sys
from pathlib import Path
from types import SimpleNamespace

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host-root",required=True)
    p.add_argument("--project",required=True)
    p.add_argument("--node-executable",required=True)
    p.add_argument("--playwright-module",required=True)
    p.add_argument("--chromium",required=True)
    p.add_argument("--private-root",required=True)
    p.add_argument("--operation-id",default="snowpack3459-original-dagster-dbt-delivery-20261012")
    args=p.parse_args(argv)
    project=Path(args.project).resolve(strict=True)
    host=Path(args.host_root).resolve(strict=True)
    private=Path(args.private_root).resolve()
    sys.path.insert(0,str(host))
    import native_foreground
    native=native_foreground.load_native(str(host))
    launcher=native_foreground.ForegroundLaunch(native)
    original_source=project/"source"
    required=[project/"operate.py",project/"browser-entry.mjs",project/"browser-workflow.mjs",
              original_source/"workspace.py",original_source/"requirements.txt",
              Path(args.node_executable),Path(args.playwright_module),Path(args.chromium)]
    for path in required:
        if not path.exists():raise ValueError("The original selected source/runtime is missing: "+str(path))
    command=[sys.executable,"-B",str(project/"operate.py"),
             "--source-root",str(original_source),"--workspace",str(project/"workspace"),
             "--operation-root",str(project/"operation"),"--private-root",str(private),
             "--browser-driver",str(project/"browser-entry.mjs"),"--node",args.node_executable,
             "--playwright-module",args.playwright_module,"--chromium",args.chromium]
    native_args=SimpleNamespace(
        peer="snowpack-client-delivery",operation_id=args.operation_id,project=str(project),
        command=command,java=None,node=None,artifact=[],artifact_on_success=["operation/complete.json"],
        artifact_on_failure=[],retain_artifacts=False,records_root=str(project/"jobs"),
        runtime_path=[str(original_source),str(project/"operate.py"),str(project/"browser-entry.mjs"),
                      str(project/"browser-workflow.mjs"),args.node_executable,args.playwright_module,
                      str(Path(args.chromium).resolve().parent)],
        memory_mib=1536,memory_reserve_mib=256,memory_reclaim="clean-cache",memory_storage="included",
        disk_space=[str(project/"workspace")+"=64",str(project/"operation")+"=16",
                    str(project/"jobs")+"=8",str(private)+"=896"],
        disk_inodes=[],disk_reserve_mib=64,disk_reserve_inodes=128)
    result=native.start(native_args,launcher=launcher)
    from native_result_view import select
    print(json.dumps(select(result,"summary")),flush=True)
    code=launcher.handoff()
    return code if code is not None else 0

if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,OSError,ImportError,KeyError) as exc:
        print(json.dumps({"state":"not_dispatched","error":type(exc).__name__,"message":str(exc)}),file=sys.stderr)
        raise SystemExit(2)
