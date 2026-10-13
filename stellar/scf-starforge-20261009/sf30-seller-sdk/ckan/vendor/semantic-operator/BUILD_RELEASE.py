#!/usr/bin/env python3
"""Build the complete portable source package with an exact file manifest."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT=Path(__file__).resolve().parent
EXCLUDED={".git",".venv","node_modules","__pycache__","workspaces","delivery","output",".pytest_cache"}

def build(output,source_commit,dataset_result=None):
    if not re.fullmatch(r"[a-f0-9]{40}",source_commit):
        raise ValueError("Keep the complete original Git source commit.")
    output=Path(output).absolute()
    if ROOT==output or ROOT in output.parents:
        raise ValueError("Write the portable archive outside the source directory.")
    files=[]
    for path in sorted(ROOT.rglob("*")):
        relative=path.relative_to(ROOT)
        if any(part in EXCLUDED or part.startswith(".write-") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError("A portable source package cannot contain symbolic links: "+str(relative))
        if not path.is_file():
            continue
        if path.suffix in (".pyc",".csw",".sqlite3") or path.name.endswith(("-wal","-shm",".log")):
            raise ValueError("Move local runtime or workspace output outside the source tree: "+str(relative))
        body=path.read_bytes()
        files.append((str(relative),body))
    required={"run.py","semantic_operator/application.py","semantic_operator/rdf_engine.py",
              "ui/index.html","ui/app.js","ui/datasets.js","ui/style.css","reference/SOURCE-MANIFEST.json",
              "semantic_operator/dataset_engine.py","semantic_operator/dataset_application.py","DATASETS.md","DATASET_ENGINE.md",
              "README.md","OPERATING_GUIDE.md","NATIVE_ENGINE.md","RECEIVING.md","requirements.txt","examples/DATASET_RECEIVING.mjs"}
    if not required.issubset({name for name,_ in files}):
        raise ValueError("The complete operator source and guides are required.")
    source_map=dict(files)
    input_manifest_path="examples/dataset-inputs/receiving-inputs.json"
    if input_manifest_path not in source_map:
        raise ValueError("Include the complete original dataset receiving input manifest.")
    input_manifest=json.loads(source_map[input_manifest_path])
    if input_manifest.get("schema")!="commons-semantic-dataset-receiving-inputs/1":
        raise ValueError("The original dataset receiving manifest schema is required.")
    for item in input_manifest["files"]:
        target=(ROOT/"examples"/"dataset-inputs"/item["path"]).resolve()
        try:
            name=str(target.relative_to(ROOT))
        except ValueError:
            raise ValueError("A receiving input lies outside the portable source closure.") from None
        body=source_map.get(name)
        if body is None or len(body)!=item["bytes"] or hashlib.sha256(body).hexdigest()!=item["sha256"]:
            raise ValueError("A complete original receiving input is missing or changed: "+name)
    source_files=len(files)
    dataset_handoff=None
    if dataset_result:
        result_raw=Path(dataset_result).read_bytes()
        result=json.loads(result_raw)
        if (result.get("schema")!="commons-semantic-dataset-ui-receiving-result/1" or
                result.get("status")!="PASS" or result.get("closed") is not True):
            raise ValueError("Include only a completed, closed dataset receiving result.")
        handoff=result["final_handoff"]
        body=Path(handoff["path"]).read_bytes()
        if len(body)!=handoff["bytes"] or hashlib.sha256(body).hexdigest()!=handoff["sha256"]:
            raise ValueError("The completed dataset handoff differs from its retained result.")
        from semantic_operator.security import unpack_files
        _,retained=unpack_files(body)
        if retained["metadata"].get("workspace_id")!=result["workspace_id"]:
            raise ValueError("The handoff belongs to a different received workspace.")
        files.extend([("receiving/Dataset-Workspace.zip",body),
                      ("receiving/DATASET-RESULT.json",result_raw)])
        guide=("Open the complete received dataset workspace\n"
               "============================================\n\n"
               "Start this package's original operator using README.md.\n"
               "In Receiving, import receiving/Dataset-Workspace.zip, then choose\n"
               "Open received operator. The complete source revisions, datasets,\n"
               "graph catalogues, native jobs, reports and decisions are retained.\n\n"
               "DATASET-RESULT.json records the completed internal public-reference\n"
               "operation. The authored development inputs are not customer data\n"
               "or a customer acceptance. See DATASETS.md for the operating flow.\n").encode()
        files.append(("receiving/START.txt",guide))
        dataset_handoff={"path":"receiving/Dataset-Workspace.zip",
                         "bytes":len(body),"sha256":handoff["sha256"],
                         "workspace_id":result["workspace_id"]}
    manifest={"schema":"commons-semantic-source-release/1","product":"Commons Semantic Interoperability Operator",
              "source_commit":source_commit,"files":[{"path":name,"bytes":len(body),
                "sha256":hashlib.sha256(body).hexdigest()} for name,body in files]}
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_name(output.name+".building")
    with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,body in files+[("SOURCE-RELEASE.json",json.dumps(manifest,sort_keys=True,indent=2).encode()+b"\n")]:
            info=zipfile.ZipInfo("Commons-Semantic-Operator/"+name,(2026,10,12,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=(0o100644<<16)
            archive.writestr(info,body)
    with zipfile.ZipFile(temporary) as archive:
        for item in manifest["files"]:
            body=archive.read("Commons-Semantic-Operator/"+item["path"])
            if len(body)!=item["bytes"] or hashlib.sha256(body).hexdigest()!=item["sha256"]:
                raise ValueError("The packaged source differs from its complete manifest.")
    temporary.replace(output)
    body=output.read_bytes()
    return {"path":str(output),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),
            "source_commit":source_commit,"source_files":source_files,"included_files":len(files),
            "dataset_handoff":dataset_handoff}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",required=True)
    parser.add_argument("--source-commit",required=True)
    parser.add_argument("--dataset-result",help="Optional completed DATASET-RESULT.json; include its exact final handoff.")
    args=parser.parse_args()
    print(json.dumps(build(args.output,args.source_commit,args.dataset_result),indent=2))
