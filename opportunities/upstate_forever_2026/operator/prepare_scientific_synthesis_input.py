#!/usr/bin/env python3
"""Resolve authored source selectors against the actual existing scientific Workspace."""
from __future__ import annotations
import argparse
import copy
import json
from pathlib import Path
import sys

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application",type=Path,required=True)
    parser.add_argument("--workspace",type=Path,required=True)
    parser.add_argument("--recipe",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--source-revision",required=True)
    parser.add_argument("--source-collection",action="append",default=[])
    parser.add_argument("--import-included",action="store_true",
                        help="Import an absent exact included source through the original Workspace writer.")
    args=parser.parse_args()
    app=args.application.expanduser().resolve(strict=True)
    sys.path.insert(0,str(app))
    from model.workspace import Workspace
    from model.common import atomic_json,digest,file_digest,held,read_json,relative_file
    from model.scientific_synthesis import document
    from model.scientific_synthesis_catalog import catalog,bind_references
    ws=Workspace(args.workspace.expanduser().resolve(strict=True))
    recipe=read_json(args.recipe.expanduser().resolve(strict=True))
    if recipe.get("schema")!="upstate.scientific-synthesis-authored-recipe/v1":
        raise ValueError("Select the complete authored scientific synthesis recipe")
    if not isinstance(recipe.get("source_requirements"),list) or not recipe["source_requirements"]:
        raise ValueError("The authored recipe needs original source requirements")
    selected,receipts=[],[]
    with held(ws.root/".workspace.lock",blocking=False):
        for requirement in recipe["source_requirements"]:
            def candidates():
                result=[]
                for collection in ws.sources():
                    if args.source_collection and collection["id"] not in args.source_collection:
                        continue
                    for entry in collection["entries"]:
                        if (entry["id"]==requirement["source_id"]
                                and entry["body"]["sha256"]==requirement["body_sha256"]
                                and entry["body"]["bytes"]==requirement["body_bytes"]
                                and entry.get("kind")=="document" and entry.get("role")=="OBSERVED_CONTEXT"):
                            result.append({"source_collection_id":collection["id"],"source_id":entry["id"]})
                return result
            matches=candidates()
            if not matches and args.import_included:
                if args.source_collection:
                    raise ValueError("The explicitly selected collection lacks the complete original source")
                manifest=relative_file(app,requirement["installed_manifest"])
                original=read_json(manifest)
                rows=[row for row in original["entries"] if row["id"]==requirement["source_id"]]
                if len(rows)!=1 or rows[0].get("sha256")!=requirement["body_sha256"]:
                    raise ValueError("The installed source manifest selects another original recipe")
                body=relative_file(manifest.parent,rows[0]["path"])
                if body.stat().st_size!=requirement["body_bytes"] or file_digest(body)!=requirement["body_sha256"]:
                    raise ValueError("The installed original recipe bytes changed")
                receipt=ws.import_sources(manifest)
                matches=candidates()
            if len(matches)!=1:
                raise ValueError("Select exactly one actual registered source collection for "+requirement["source_id"]+
                                 "; use --source-collection for duplicate complete editions, or --import-included for the exact installed source")
            selected.append(matches[0])
            retained=ws.retained_item("sources",matches[0]["source_collection_id"])
            receipts.append({"collection_id":retained["id"],"source_id":matches[0]["source_id"],
                             "original_manifest":retained["original_manifest"],
                             "status":"retained-native-source"})
        native_catalog=catalog(ws,selected)
    documents=[]
    for authored in recipe["documents"]:
        current=copy.deepcopy(authored);current["sources"]=copy.deepcopy(selected)
        for section in current["sections"]:
            selectors=section.pop("reference_selectors",None)
            if not isinstance(selectors,list):
                raise ValueError("Each authored section needs its complete explicit reference selectors")
            references=[]
            for selector in selectors:
                matching=[row for row in native_catalog["references"]
                          if all(row.get(key)==value for key,value in selector.items())]
                if len(matching)!=1:
                    raise ValueError("An authored reference does not uniquely select the original retained value: "+json.dumps(selector))
                if matching[0]["id"] not in references:
                    references.append(matching[0]["id"])
            section["reference_ids"]=references
        current=document(current)
        bind_references(native_catalog,list(dict.fromkeys(
            ref for row in current["sections"] for ref in row["reference_ids"])))
        documents.append(current)
    if len(documents)!=2 or documents[0]["series_id"]!=documents[1]["series_id"] or not documents[1]["change_note"].strip():
        raise ValueError("The complete receiving course needs two attributed editions of the same series")
    output={"schema":"upstate.scientific-synthesis-receiving-input/v1",
            "operation_id":recipe["operation_id"],"project_id":ws.project["id"],
            "catalog_sha256":native_catalog["catalog_sha256"],"documents":documents,
            "report":recipe["report"],"source_revision":args.source_revision}
    directory=args.output.expanduser().resolve()
    directory.mkdir(parents=True,exist_ok=True)
    for name,value in (("authored-recipe.json",recipe),("source-catalog.json",native_catalog),
                       ("source-import-receipts.json",receipts),("receiving-input.json",output)):
        atomic_json(directory/name,value,immutable=True)
    print(json.dumps({"operation_id":recipe["operation_id"],"project_id":ws.project["id"],
                      "sources":selected,"catalog_sha256":native_catalog["catalog_sha256"],
                      "input":str(directory/"receiving-input.json"),"input_sha256":file_digest(directory/"receiving-input.json")},indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
