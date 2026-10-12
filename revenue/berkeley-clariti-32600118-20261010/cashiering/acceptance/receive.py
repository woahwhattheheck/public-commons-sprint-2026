#!/usr/bin/env python3
"""Run the existing native and browser controllers sequentially on one saved Berkeley case."""
from __future__ import annotations
import argparse,hashlib,json,os,platform,shutil,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path

OPERATION="berkeley-daily-cashiering-native-82e4-20261012"
BROWSER_OPERATION="berkeley-daily-cashiering-browser-82e4-20261012"
def digest(data):return hashlib.sha256(data).hexdigest()
def read(path):return json.loads(path.read_text(encoding="utf-8"))
def save(path,value):
    raw=(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    temp=path.with_name(path.name+".writing")
    with temp.open("wb") as handle:handle.write(raw);handle.flush();os.fsync(handle.fileno())
    os.replace(temp,path)
def executable(value):
    p=shutil.which(value)
    if p is None:raise ValueError("Use an existing executable: "+value)
    return str(Path(p).resolve())
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True)
    parser.add_argument("--node",required=True)
    parser.add_argument("--python",default=sys.executable)
    parser.add_argument("--playwright",required=True,help="Exact existing Playwright index.mjs module")
    parser.add_argument("--browser",required=True,help="Exact existing Chromium executable")
    parser.add_argument("--port",type=int,default=8798)
    opts=parser.parse_args()
    if not 1<=opts.port<=65535:raise ValueError("Select one loopback port.")
    root=Path(opts.directory).resolve(strict=True)
    selection=read(root/"receiving-source.json")
    if selection["operation_id"]!=OPERATION:raise ValueError("Wrong original receiving operation.")
    for item in selection["files"]:
        raw=(root/item["path"]).read_bytes()
        if len(raw)!=item["bytes"] or digest(raw)!=item["sha256"]:
            raise ValueError("Prepared receiving source changed: "+item["path"])
    composition_sha=digest((root/"source-composition.json").read_bytes())
    if composition_sha!=selection["source_composition_sha256"]:raise ValueError("Source composition changed.")
    node,python=executable(opts.node),executable(opts.python)
    playwright=str(Path(opts.playwright).resolve(strict=True))
    browser=executable(opts.browser)
    environment={**os.environ,"BERKELEY_NODE":node,"PYTHONDONTWRITEBYTECODE":"1"}
    host={"schema":"berkeley.cashiering.receiving-host.v1","operation_id":OPERATION,
        "observed_at":datetime.now(timezone.utc).isoformat(),"platform":platform.platform(),"machine":platform.machine(),
        "python":python,"python_version":subprocess.check_output([python,"--version"],text=True).strip(),
        "node":node,"node_version":subprocess.check_output([node,"--version"],text=True).strip(),
        "playwright":playwright,"browser":browser,"directory":str(root),"source_composition_sha256":composition_sha}
    save(root/"receiving-host.json",host)
    native_path=root/"native-run/result.json"
    if native_path.exists():
        native=read(native_path)
        if native.get("status")!="PASS" or native.get("operation_id")!=OPERATION or native.get("source_composition_sha256")!=composition_sha:
            raise ValueError("An existing native result needs its original owner's same-state continuation.")
    else:
        subprocess.run([python,"-B",str(root/"native-run/build.py")],cwd=root,env=environment,check=True)
        native=read(native_path)
    if native.get("status")!="PASS" or native.get("operation_id")!=OPERATION:
        raise ValueError("The actual native controller did not complete.")
    database=Path(native["database_path"]).resolve(strict=True)
    if database!=root/"native-run/workspace.sqlite":raise ValueError("Native result points outside this original case.")
    browser_path=root/"browser-run/result.json"
    if browser_path.exists():
        result=read(browser_path)
        if result.get("status")!="PASS" or result.get("operation")!=BROWSER_OPERATION or result.get("native_result_sha256")!=digest(native_path.read_bytes()):
            raise ValueError("An existing browser result needs its original owner's same-state continuation.")
    else:
        command=[node,str(root/"browser-continuation.mjs"),"--root",str(root),
            "--source",str(root/"source/revenue/berkeley-clariti-32600118-20261010"),
            "--native-result",str(native_path),"--output",str(root/"browser-run"),"--python",python,
            "--playwright",playwright,"--browser",browser,"--port",str(opts.port),"--operation-id",BROWSER_OPERATION]
        subprocess.run(command,cwd=root,env=environment,check=True)
        result=read(browser_path)
    if result.get("status")!="PASS" or result.get("owned_processes_closed") is not True:
        raise ValueError("The actual browser controller did not complete and close its owned listeners.")
    final={"schema":"berkeley.cashiering.complete-receiving.v1","operation_id":OPERATION,"status":"PASS",
        "completed_at":datetime.now(timezone.utc).isoformat(),"source_commit":selection["source_commit"],
        "source_composition_sha256":composition_sha,"native_result":str(native_path),
        "native_result_sha256":digest(native_path.read_bytes()),"browser_result":str(browser_path),
        "browser_result_sha256":digest(browser_path.read_bytes()),"database_path":str(database),
        "receiving_database":result["receiving_database"],"original_financial_run_id":native["run_id"],
        "operator_financial_run_id":result["run_id"],"packet":result["packet"],"backup":result["backup"],
        "owned_processes_closed":True,"external_transmissions":0,"external_postings":0,
        "basis":"Complete actual local example workflow; no City, Clariti, ACI or Munis receiving or posting claimed."}
    save(root/"receiving-result.json",final)
    print(json.dumps({"status":"PASS","result":str(root/"receiving-result.json"),"native":str(native_path),
        "browser":str(browser_path),"packet":result["packet"]}),flush=True)

if __name__=="__main__":main()
