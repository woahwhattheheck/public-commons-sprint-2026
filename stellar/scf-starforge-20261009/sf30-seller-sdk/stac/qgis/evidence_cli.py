#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original parcel evidence operations through the maintained analyst journal."""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CORE_ROOT=ROOT/"starforge_stac" if (ROOT/"starforge_stac").is_dir() else ROOT
sys.path[:0]=[str(ROOT),str(CORE_ROOT.parent)]
from starforge_stac.model import QgisWorkspace,require,read_json
from starforge_stac.analyst_state import AnalystJournal
from analyst.actions import normalize_payload,native_runtime,NATIVE_ACTIONS

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",required=True)
    parser.add_argument("--create",action="store_true")
    parser.add_argument("--title",default="Parcel evidence review")
    parser.add_argument("--request")
    parser.add_argument("--request-id")
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--case-id")
    args=parser.parse_args(argv)
    workspace=QgisWorkspace(args.workspace,create=args.create,title=args.title)
    journal=AnalystJournal(workspace)
    if not args.request and not args.request_id:
        from starforge_stac.parcel_evidence_operator import read_route
        value=read_route(workspace,"/api/evidence",{}) if not args.case_id else read_route(
            workspace,"/api/evidence/cases/"+args.case_id+"/snapshot",{})
        print(json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2))
        return 0
    require(not (args.request and args.request_id),"EVIDENCE_CLI","Choose a new complete request file or an original saved request ID.")
    if args.request:
        value,_=read_json(Path(args.request),limit=32*1024*1024)
        require(isinstance(value,dict) and set(value)=={"requestId","action","payload","revision","actor"},
                "EVIDENCE_CLI","Use the full original analyst request shape.")
        require(value["action"] in ("evidence.command","evidence.spatial","project.export","project.receive"),
                "EVIDENCE_CLI","Choose evidence or original complete-project receiving.")
        runtime={}
        if value["action"] in NATIVE_ACTIONS:
            require(args.native_runtime_file,"EVIDENCE_NATIVE_RUNTIME","Select the existing native QGIS runtime.")
            runtime=native_runtime(read_json(Path(args.native_runtime_file))[0])
        payload=normalize_payload(value["action"],value["payload"],workspace)
        record=journal.create(request_id=value["requestId"],action=value["action"],payload=payload,
                              revision=value["revision"],actor=value["actor"],native_runtime=runtime)
    else:
        record=journal.get(args.request_id)
    if record["status"]!="COMPLETED":
        original=record["input"]
        require(original["workspaceDirectory"]==str(workspace.root),"EVIDENCE_ORIGINAL_HOST",
                "This unfinished request retains its original host; use its complete received inputs to review a new invocation here.")
        command=original["nativeRuntime"].get("native_command") if original["action"] in NATIVE_ACTIONS else [sys.executable]
        require(command,"EVIDENCE_NATIVE_RUNTIME","Keep the selected existing native executable.")
        result=subprocess.run([*command,"-B",str(ROOT/"analyst"/"worker.py"),"--workspace",str(workspace.root),
                               "--request-id",record["requestId"],"--instance-id","evidence-cli-"+uuid.uuid4().hex],
                              check=False,stdout=subprocess.PIPE,text=True)
        # Emit the complete original journal, including the retained native failure when present.
        record=journal.get(record["requestId"])
        if record["status"]!="COMPLETED":
            print(json.dumps(record,ensure_ascii=False,allow_nan=False,indent=2))
            return result.returncode or 2
    print(json.dumps(record,ensure_ascii=False,allow_nan=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
