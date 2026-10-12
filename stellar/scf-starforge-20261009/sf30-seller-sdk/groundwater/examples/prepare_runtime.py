#!/usr/bin/env python3
"""Explicit administrator acquisition through the unchanged original FloPy helper."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys
sys.dont_write_bytecode=True
APPLICATION=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APPLICATION))
from groundwater_workspace.common import Problem,Lock,digest,file_info,json_text,read_json,write_json
from groundwater_workspace.native import inspect_runtime,runtime_matches
from groundwater_workspace.sources import publisher_source

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,help="One new or retained private runtime preparation directory")
    args=parser.parse_args()
    directory=Path(args.directory)
    if not directory.is_absolute():
        raise Problem("runtime_directory","Use an absolute private runtime preparation directory.")
    directory=directory.resolve()
    originals=publisher_source(APPLICATION)
    helper=APPLICATION/"publisher"/"flopy"/"get_modflow.py"
    expected=next(row for row in originals if row[0]=="publisher/flopy/get_modflow.py")
    if digest(helper.read_bytes())!=expected[2]["sha256"]:
        raise Problem("helper_identity","The retained original acquisition helper changed.")
    wanted={"schema":"starforge.groundwater-runtime-preparation.v1","python":str(Path(sys.executable).resolve()),"helper":file_info(helper),"selections":[{"owner":"MODFLOW-ORG","repo":"modflow6","release_id":"6.8.1","subset":["mf6"]},{"owner":"MODFLOW-ORG","repo":"executables","release_id":"29.0","subset":["mf2005dbl"]}]}
    if directory.exists() and any(directory.iterdir()) and not (directory/"runtime-request.json").is_file():
        raise Problem("runtime_directory","The selected runtime directory contains unbound originals; nothing was replaced.")
    directory.mkdir(parents=True,exist_ok=True)
    with Lock(directory/"runtime-prepare.lock",blocking=False):
        write_json(directory/"runtime-request.json",wanted,create_only=True)
        binaries=directory/"bin";downloads=directory/"downloads"
        binaries.mkdir(exist_ok=True);downloads.mkdir(exist_ok=True)
        spec=importlib.util.spec_from_file_location("retained_original_get_modflow",helper)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for selection in wanted["selections"]:
            executable=binaries/(selection["subset"][0]+(".exe" if os.name=="nt" else ""))
            if not executable.exists():
                module.run_main(str(binaries),downloads_dir=str(downloads),**selection)
        runtime=inspect_runtime({"python_executable":wanted["python"],"mf6_executable":str(binaries/("mf6.exe" if os.name=="nt" else "mf6")),"mf2005_executable":str(binaries/("mf2005dbl.exe" if os.name=="nt" else "mf2005dbl"))},temp_root=directory)
        path=directory/"runtime.json"
        if path.exists():
            prior=read_json(path)
            if not runtime_matches(prior,runtime) or prior["paths"]!=runtime["paths"]:
                raise Problem("runtime_changed","The retained prepared runtime differs from its original actual fingerprint.")
            runtime=prior
        else:
            write_json(path,runtime,create_only=True)
    print(json_text({"runtime_file":str(path),"runtime":runtime}),flush=True)
    return 0
if __name__=="__main__":
    try:
        sys.exit(main())
    except Problem as exc:
        print(json_text({"error":exc.as_dict()}),file=sys.stderr,flush=True)
        sys.exit(2)
