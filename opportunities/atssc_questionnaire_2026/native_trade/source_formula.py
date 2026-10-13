"""Original full-family formula groups joined to retained native calculation.

The original source reader is retained unchanged. It records original shared
formulas, structural token groups and static references. Native values and
actual engine tokens come from this same workspace's existing calculation jobs.
"""
from __future__ import annotations

import fcntl
from bisect import bisect_left,bisect_right
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

from workbooks import cell_parts
from workbook_calculation import digest,encoded,timestamp,source_rows,_validate_files

ARCHIVE_SHA256="f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e"
READER_SHA256="96b40d6251c4060aeb752b2435f9f03a28333f86366b25380a8d641af1be2ae5"
SOURCE=Path(__file__).resolve().parent

def _error(code,message):
    from questionnaire_workspace import OperationError
    raise OperationError(code,message)

def _atomic(path,value):
    body=(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode()
    pending=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    pending.write_bytes(body);pending.replace(path)

def install_schema(workspace):
    with workspace.connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS formula_collections(
          id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL,
          created TEXT NOT NULL, result TEXT NOT NULL);
        """)

def _descriptor(workspace,path):
    body=path.read_bytes()
    return {"path":path.relative_to(workspace.directory).as_posix(),"bytes":len(body),"sha256":digest(body)}

def _validated(workspace,result):
    for entry in result["files"]:
        path=workspace.directory/entry["path"]
        if not path.resolve().is_relative_to(workspace.directory.resolve()):_error("FORMULA_SOURCE","Original formula attachment leaves this project")
        body=path.read_bytes()
        if len(body)!=entry["bytes"] or digest(body)!=entry["sha256"]:_error("FORMULA_SOURCE","A retained original formula attachment differs")
    return result

def _runtime(workspace):
    expected={"openpyxl-3.1.5-py2.py3-none-any.whl":"5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2",
        "et_xmlfile-2.0.0-py3-none-any.whl":"7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa"}
    for directory in (workspace.directory/"calculation-runtime"/"python",workspace.directory.parent/"calculation-runtime"/"python"):
        if not (directory/"manifest.json").is_file():continue
        inventory=json.loads((directory/"manifest.json").read_text())
        files={item["path"]:item for item in inventory["files"]}
        if set(files)!=set(expected):_error("FORMULA_RUNTIME","Use the complete original two-wheel formula runtime")
        paths=[]
        for name,sha in expected.items():
            path=directory/name;body=path.read_bytes()
            if files[name]["sha256"]!=sha or digest(body)!=sha or len(body)!=files[name]["bytes"]:_error("FORMULA_RUNTIME","The locked original formula runtime differs")
            paths.append(path.resolve())
        return paths
    _error("FORMULA_RUNTIME","Retain calculation-runtime/python with the complete customer project")

def _analyse(workspace,archive,directory):
    reader=SOURCE/"source_formula_reader.py"
    if digest(reader.read_bytes())!=READER_SHA256:_error("FORMULA_SOURCE","The original source-owner formula reader differs")
    inventory=directory/"ATSSC_Formula_Dependency_Inventory.json"
    if inventory.exists():
        result=json.loads(inventory.read_text())
        if result["original_archive_sha256"]!=ARCHIVE_SHA256:_error("FORMULA_SOURCE","The retained formula analysis belongs to another archive")
        for entry in result["files"]:
            path=directory/entry["path"]
            if not path.resolve().is_relative_to(directory.resolve()):_error("FORMULA_SOURCE","The original source inventory path differs")
            body=path.read_bytes()
            if digest(body)!=entry["sha256"] or len(body)!=entry["bytes"]:_error("FORMULA_SOURCE","A retained full original formula analysis differs")
        return result
    if directory.exists():
        previous=directory.with_name(directory.name+"-interrupted-"+uuid.uuid4().hex)
        directory.rename(previous)
    directory.mkdir(parents=True)
    wheels=_runtime(workspace)
    bootstrap="import runpy,sys;sys.path[:0]=sys.argv[1:3];sys.argv=sys.argv[3:];runpy.run_path(sys.argv[0],run_name='__main__')"
    with (directory/"reader.stdout.jsonl").open("wb") as out,(directory/"reader.stderr.txt").open("wb") as err:
        completed=subprocess.run([sys.executable,"-S","-c",bootstrap,*map(str,wheels),str(reader),str(archive.resolve()),"--output",str(directory.resolve())],
            stdout=out,stderr=err,timeout=300,env={k:v for k,v in os.environ.items() if k not in {"PYTHONPATH","PYTHONHOME"}})
    if completed.returncode:_error("FORMULA_SOURCE","The retained original reader failed; its full diagnostic output is preserved")
    return _analyse(workspace,archive,directory)

def _sources(workspace):
    with workspace.connection() as db:
        definitions=[{"questionnaire_id":r["questionnaire_id"],"version":r["version"],"definition":json.loads(r["definition"])} for r in db.execute(
            "SELECT d.* FROM definitions d JOIN questionnaires q ON q.id=d.questionnaire_id AND q.version=d.version ORDER BY d.questionnaire_id")]
        jobs=[{"id":r["id"],"source_sha256":r["source_sha"],"created":r["created"],"result":json.loads(r["result"])} for r in db.execute(
            "SELECT id,source_sha,created,result FROM calculations WHERE state='complete' ORDER BY created,id")]
    families={}
    for item in definitions:
        source=item["definition"].get("source_intake",{}).get("source_sha256")
        if source:families[source]=item
    originals={}
    for job in jobs:
        if job["source_sha256"] in families:originals.setdefault(job["source_sha256"],job)
    if len(families)!=5 or len(originals)!=5:_error("FORMULA_NATIVE","Retain all five complete original-family definitions and original native jobs first")
    return families,originals,jobs

def _bindings(definition):
    result={}
    for question in definition["questions"]:
        source=question.get("source",{})
        if not source:continue
        if question["kind"]=="table":
            for row in source_rows(source):
                for column in question["columns"]:
                    result.setdefault((source["sheet"],column["source_column"]+str(row)),[]).append({"question_id":question["id"],"column_id":column["id"],"row":row})
        else:result.setdefault((source["sheet"],source["cell"]),[]).append({"question_id":question["id"],"source_calculated":bool(question.get("source_calculated"))})
    return result

def _join(workspace,analysis,analysis_directory,directory,families,originals):
    summaries=[];total=0;all_native=0
    for workbook in analysis["workbooks"]:
        sha=workbook["source"]["sha256"];family=families[sha];job=originals[sha]
        _validate_files(workspace,job["result"])
        prefix=next(Path(x["path"]).parent for x in analysis["files"] if Path(x["path"]).name=="formula_occurrences.json" and json.loads((analysis_directory/x["path"]).read_text())["source"]["sha256"]==sha)
        source=json.loads((analysis_directory/prefix/"formula_occurrences.json").read_text())
        groups=json.loads((analysis_directory/prefix/"structural_groups.json").read_text())
        graph={(x["sheet"],x["cell"]):x for x in job["result"]["native_precedents"]["formulas"]}
        native=workspace.workbook(job["result"]["calculated_sha256"])
        sheets={s["name"]:s for s in native["sheets"]};bindings=_bindings(family["definition"])
        question_by_id={q["id"]:q for q in family["definition"]["questions"]}
        binding_rows={}
        for coordinate,fields in bindings.items():
            row,column=cell_parts(coordinate[1]);binding_rows.setdefault(coordinate[0],[]).append((row,column,coordinate[1],fields))
        for entries in binding_rows.values():entries.sort()
        row_indexes={name:[entry[0] for entry in entries] for name,entries in binding_rows.items()}
        joined=[];by_key={};by_group={};native_covered=set()
        for record in source["records"]:
            coordinate=(record["worksheet"],record["cell"]);node=graph.get(coordinate)
            if node is None:_error("FORMULA_NATIVE","An original formula lacks its retained native engine token record")
            value=sheets[coordinate[0]]["cells"][coordinate[1]]
            outputs=bindings.get(coordinate,[]);output_ids={b["question_id"] for b in outputs};direct={}
            for ref in node["ranges"]:
                candidates=binding_rows.get(ref["sheet"],[]);rows=row_indexes.get(ref["sheet"],[])
                for r,c,address,fields in candidates[bisect_left(rows,ref["start_row"]):bisect_right(rows,ref["end_row"])]:
                    if not ref["start_column"]<=c<=ref["end_column"]:continue
                    for field in fields:
                        if field["question_id"] in output_ids:continue
                        bound={**field,"sheet":ref["sheet"],"cell":address}
                        direct[encoded(bound)]=bound
            flattened=set()
            for field in outputs:flattened.update(question_by_id[field["question_id"]].get("native_dependencies",[]))
            flattened.difference_update(output_ids)
            item={**record,"native":{"calculation_id":job["id"],"calculated_sha256":job["result"]["calculated_sha256"],
                "kind":value["kind"],"value":value["value"],"error_code":node["native_error_code"],"invalid_references":node["invalid_references"],"ranges":node["ranges"]},
                "question_bindings":outputs,"native_question_references":[direct[k] for k in sorted(direct)],
                "native_dependency_question_ids":sorted(flattened|{b["question_id"] for b in direct.values()})}
            joined.append(item);by_key[item["source_key"]]=item;by_group.setdefault(item["group_key"],[]).append(item);native_covered.add(coordinate)
        group_summaries=[]
        for group in groups["groups"]:
            members=by_group[group["group_key"]]
            group_summaries.append({**group,"native_error_members":sum(bool(x["native"]["error_code"]) for x in members),
                "native_numeric_members":sum(x["native"]["kind"]=="n" for x in members),
                "output_question_ids":sorted({b["question_id"] for x in members for b in x["question_bindings"]}),
                "referenced_question_ids":sorted({qid for x in members for qid in x["native_dependency_question_ids"]}),
                "question_ids":sorted({b["question_id"] for x in members for b in x["question_bindings"]}|{qid for x in members for qid in x["native_dependency_question_ids"]}),
                "referenced_source_cells":sorted({b["sheet"]+"!"+b["cell"] for x in members for b in x["native_question_references"]}),
                "source_expression_samples":list(dict.fromkeys(x["effective_formula"] or x["original_formula"] for x in members))[:8],
                "original_workbook_sha256":sha,"native_calculation_id":job["id"]})
        destination=directory/prefix;destination.mkdir(parents=True,exist_ok=True)
        _atomic(destination/"joined_occurrences.json",{"source":workbook["source"],"records":joined})
        _atomic(destination/"joined_groups.json",{"source":workbook["source"],"groups":group_summaries})
        summaries.append({**workbook,"directory":prefix.as_posix(),"questionnaire_id":family["questionnaire_id"],"definition_version":family["version"],
            "definition_sha256":digest(encoded(family["definition"]).encode()),"native_calculation_id":job["id"],"native_calculated_sha256":job["result"]["calculated_sha256"],
            "native_formula_join_count":len(native_covered),"stable_question_count":len(family["definition"]["questions"]),
            "source_occurrences_path":(analysis_directory/prefix/"formula_occurrences.json").relative_to(workspace.directory).as_posix(),
            "joined_occurrences_path":(destination/"joined_occurrences.json").relative_to(workspace.directory).as_posix(),
            "joined_groups_path":(destination/"joined_groups.json").relative_to(workspace.directory).as_posix()})
        total+=len(joined);all_native+=len(native_covered)
    if total!=7661 or all_native!=7661:_error("FORMULA_NATIVE","The original and native whole-family formula join is incomplete")
    return summaries

def source_formula_import(workspace,params):
    root=workspace.directory/"source-evidence"/"formula-library";root.mkdir(parents=True,exist_ok=True)
    with (root/"operation.lease").open("a+") as lease:
        fcntl.flock(lease,fcntl.LOCK_EX)
        cached=workspace._cached_mutation("source_formula_import")
        if cached is not None:return _validated(workspace,cached)
        archive=workspace.directory/"source-evidence"/"ATSSC_Original_Annexes_and_Workbook_Catalogue.zip"
        if not archive.is_file() or digest(archive.read_bytes())!=ARCHIVE_SHA256:_error("FORMULA_SOURCE","Retain the complete original Annex archive in this same project")
        families,originals,jobs=_sources(workspace)
        identity=digest(encoded({"schema":2,"archive_sha256":ARCHIVE_SHA256,"reader_sha256":READER_SHA256,
            "source_module_sha256":digest(Path(__file__).read_bytes()),"definitions":{s:digest(encoded(x["definition"]).encode()) for s,x in families.items()},
            "native_originals":{s:x["id"] for s,x in originals.items()}}).encode())
        with workspace.connection() as db:
            row=db.execute("SELECT result FROM formula_collections WHERE identity=?",(identity,)).fetchone()
        if row is not None:
            result=_validated(workspace,json.loads(row["result"]))
            return workspace._write("source_formula_import",result["collection_id"],{"identity":identity},lambda db:result)
        analysis_directory=root/("source-analysis-"+digest((ARCHIVE_SHA256+READER_SHA256).encode()))
        analysis=_analyse(workspace,archive,analysis_directory)
        directory=root/identity;directory.mkdir(parents=True,exist_ok=True)
        result_path=directory/"joined-result.json"
        if result_path.exists():result=_validated(workspace,json.loads(result_path.read_text()))
        else:
            workbooks=_join(workspace,analysis,analysis_directory,directory,families,originals)
            authority={"reader_sha256":READER_SHA256,"reader_bytes":29214,"original_canvas_id":"F0C88E49SMD","original_archive_sha256":ARCHIVE_SHA256,
                "source_reader":"source_formula_reader.py","source_owner":"6CF6","source_relationship":"Complete original shared-formula/group inventory; joined to the existing maintained native calculation programme."}
            _atomic(directory/"source-authority.json",authority)
            result={"schema":"atssc.original-formula-native-library.v2","collection_id":identity,"identity":identity,"workspace_id":workspace.invoke("status",{})["workspace_id"],
                "created":timestamp(),"original_archive_sha256":ARCHIVE_SHA256,"reader_sha256":READER_SHA256,"totals":{**analysis["totals"],"native_formula_joins":7661},
                "workbooks":workbooks,"interpretation":analysis["interpretation"],"files":[]}
            for file in sorted(set(analysis_directory.rglob("*"))|set(directory.rglob("*"))):
                if file.is_file() and file!=result_path and ".pending-" not in file.name:result["files"].append(_descriptor(workspace,file))
            _atomic(result_path,result)
        def commit(db):
            db.execute("INSERT INTO formula_collections VALUES(?,?,?,?) ON CONFLICT(identity) DO NOTHING",(identity,identity,result["created"],encoded(result)))
            return result
        return workspace._write("source_formula_import",identity,{"original_archive_sha256":ARCHIVE_SHA256,"native_formula_joins":7661},commit)

def _collection(workspace,params):
    with workspace.connection() as db:
        if params.get("collection_id"):row=db.execute("SELECT result FROM formula_collections WHERE id=?",(params["collection_id"],)).fetchone()
        else:row=db.execute("SELECT result FROM formula_collections ORDER BY created DESC LIMIT 1").fetchone()
    if row is None:_error("FORMULA_NOT_FOUND","Import the complete original formula library first")
    return _validated(workspace,json.loads(row["result"]))

def _job_summary(job,source):
    result=job["result"];binding=result.get("source_binding_sha256") or job["source_sha256"]
    return {"calculation_id":job["id"],"created":job["created"],"source_sha256":job["source_sha256"],"original_source_sha256":binding,
        "calculated_sha256":result["calculated_sha256"],"original_source":job["source_sha256"]==source}

def source_formula_inspect(workspace,params):
    with workspace.connection() as db:
        rows=[json.loads(r["result"]) for r in db.execute("SELECT result FROM formula_collections ORDER BY created DESC")]
    if not rows:return {"collections":[],"ready":False}
    result=_collection(workspace,params);_,_,jobs=_sources(workspace);sources={x["source"]["sha256"] for x in result["workbooks"]}
    native_jobs=[_job_summary(j,j["result"].get("source_binding_sha256") or j["source_sha256"]) for j in jobs if (j["result"].get("source_binding_sha256") or j["source_sha256"]) in sources]
    return {**result,"ready":True,"native_jobs":native_jobs,"collections":[{k:r[k] for k in ("collection_id","created","totals")} for r in rows]}

def _workbooks(collection,params):
    selected=[w for w in collection["workbooks"] if not params.get("workbook_sha256") or w["source"]["sha256"]==params["workbook_sha256"]]
    if not selected:_error("FORMULA_SOURCE","Select an original workbook from this complete collection")
    return selected

def source_formula_groups(workspace,params):
    collection=_collection(workspace,params);groups=[];search=str(params.get("search","")).casefold().strip()
    for workbook in _workbooks(collection,params):
        for group in json.loads((workspace.directory/workbook["joined_groups_path"]).read_text())["groups"]:
            if params.get("worksheet") and params["worksheet"] not in group["worksheets"]:continue
            if search and search not in encoded(group).casefold():continue
            groups.append({k:group[k] for k in ("group_key","shape_key","workbook","role","worksheets","functions","reference_error_members","visible_members","native_error_members","native_numeric_members","question_ids","original_workbook_sha256","native_calculation_id")}|
                {k:group[k] for k in ("output_question_ids","referenced_question_ids","referenced_source_cells","source_expression_samples") if k in group}|
                {"member_count":len(group["members"]),"sample_members":group["members"][:4]})
    offset=params.get("offset",0);limit=params.get("limit",30)
    if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=100:_error("FORMULA_PAGE","Use a nonnegative offset and page size1–100")
    return {"collection_id":collection["collection_id"],"total":len(groups),"offset":offset,"limit":limit,"groups":groups[offset:offset+limit],
        "next_offset":offset+limit if offset+limit<len(groups) else None}

def source_formula_group(workspace,params):
    collection=_collection(workspace,params)
    for workbook in _workbooks(collection,params):
        group=next((g for g in json.loads((workspace.directory/workbook["joined_groups_path"]).read_text())["groups"] if g["group_key"]==params.get("group_key")),None)
        if group:
            members=[r for r in json.loads((workspace.directory/workbook["joined_occurrences_path"]).read_text())["records"] if r["group_key"]==group["group_key"]]
            return {"collection_id":collection["collection_id"],"group":group,"members":members,"workbook":workbook}
    _error("FORMULA_NOT_FOUND","Original formula group was not found")

def source_formula_cell(workspace,params):
    collection=_collection(workspace,params)
    for workbook in _workbooks(collection,params):
        record=next((r for r in json.loads((workspace.directory/workbook["joined_occurrences_path"]).read_text())["records"] if r["source_key"]==params.get("source_key")),None)
        if not record:continue
        result={"collection_id":collection["collection_id"],"workbook":workbook,"cell":record}
        if params.get("calculation_id"):
            retained=workspace.invoke("get_calculation",{"calculation_id":params["calculation_id"]})
            if retained["state"]!="complete":_error("FORMULA_NATIVE","Select a completed original native calculation")
            job=retained["result"]
            binding=job.get("source_binding_sha256") or job["source_sha256"]
            if binding!=workbook["source"]["sha256"]:_error("FORMULA_NATIVE","The retained native job belongs to another original workbook")
            native=workspace.workbook(job["calculated_sha256"]);sheet=next(s for s in native["sheets"] if s["name"]==record["worksheet"]);value=sheet["cells"][record["cell"]]
            node=next(x for x in job["native_precedents"]["formulas"] if x["sheet"]==record["worksheet"] and x["cell"]==record["cell"])
            result["selected_native_edition"]={"calculation_id":params["calculation_id"],"source_sha256":job["source_sha256"],"calculated_sha256":job["calculated_sha256"],
                "kind":value["kind"],"value":value["value"],"error_code":node["native_error_code"],"ranges":node["ranges"],"invalid_references":node["invalid_references"]}
        return result
    _error("FORMULA_NOT_FOUND","Original formula cell was not found")

OPERATIONS={"source_formula_import":source_formula_import,"source_formula_inspect":source_formula_inspect,
    "source_formula_groups":source_formula_groups,"source_formula_group":source_formula_group,"source_formula_cell":source_formula_cell}
