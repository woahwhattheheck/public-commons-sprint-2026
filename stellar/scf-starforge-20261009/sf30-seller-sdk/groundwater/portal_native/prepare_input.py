#!/usr/bin/env python3
"""Freeze portal preparation or bind receiving to its actual completed parent."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from common import info,publish,read,require
from prepare_portal import BASE_KEYS,configuration

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--phase",choices=("prepare","receive"),required=True)
    p.add_argument("--work-directory",required=True);p.add_argument("--output",required=True)
    for name in ("operation-id","parent-operation-id","source-capsule","python-executable","node-executable",
                 "npm-executable","playwright-directory","chromium-executable","operator-username","reader-username","slot"):
        p.add_argument("--"+name)
    p.add_argument("--port",type=int);p.add_argument("--native-result");p.add_argument("--backup")
    args=p.parse_args();work=Path(args.work_directory).resolve()
    prior=work/"bootstrap-request.json"
    if prior.exists():
        base=read(prior,2097152)
        require(base["work_directory"]==str(work),"The selected original preparation path changed.")
        for name in BASE_KEYS:
            supplied=getattr(args,name,None)
            if supplied is not None:
                actual=str(Path(supplied).resolve()) if name.endswith("_executable") or name.endswith("_directory") or name=="source_capsule" else supplied
                require(base[name]==actual,"An existing portal preparation option changed: "+name)
    else:
        require(args.phase=="prepare","Prepare the real portal first, then bind its actual original model result.")
        missing=[k for k in BASE_KEYS if k!="work_directory" and getattr(args,k,None) is None]
        require(not missing,"Supply the complete initial portal preparation: "+", ".join(missing))
        base={"schema":"groundwater.tethys-preparation-input.v1",**{k:getattr(args,k) for k in BASE_KEYS}}
        base["work_directory"]=str(work)
    base,_=configuration(base)
    if args.phase=="prepare":
        require(args.native_result is None and args.backup is None,"Preparation does not accept a model result or substitute backup.")
        value=base
    else:
        require(args.native_result is not None,"Supply the actual completed original native-result.json.")
        native_path=Path(args.native_result).resolve();native=read(native_path)
        backup=Path(args.backup or native["backup"]["path"]).resolve()
        value={**base,"schema":"groundwater.tethys-native-input.v1",
               "native_result":{"path":str(native_path),**info(native_path)},
               "backup":{"path":str(backup),**info(backup)}}
        from run_portal import input_value
        value,_=input_value(value)
    target=Path(args.output).resolve()
    publish(target,value)
    print(json.dumps({"input_file":str(target),"identity":info(target),"schema":value["schema"],
                      "operation_id":value["operation_id"],"native_model_runs_started":0}),flush=True)

if __name__=="__main__":main()
