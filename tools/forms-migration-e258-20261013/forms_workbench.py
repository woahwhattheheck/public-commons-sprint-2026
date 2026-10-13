"""Retain and reconcile a complete explicitly selected forms migration project."""
from __future__ import annotations
import argparse
import sys
sys.dont_write_bytecode = True
from collections import Counter
from contextlib import closing
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from discovery_engine import (DiscoveryError, require, parse_json_bytes, json_bytes,
                              read_json, file_digest, record_database)
from migration_reconciliation import run_migration, verify_case

CLASSES = ("definitions", "settings", "responses", "uploads", "workflow", "downstream")
SIDES = ("source", "target", "shared")
AVAILABILITY = ("PRESENT", "MISSING", "REDACTED")
CONTENT = ("COMPLETE", "PARTIAL", "REDACTED", "UNASSESSED")
IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,95}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
INTAKE = "tjlabs.forms-workbench.intake.v1"
RESULT = "tjlabs.forms-workbench.result.v1"
DELIVERY = "tjlabs.forms-workbench.delivery.v1"
ARCHIVE = "tjlabs.forms-workbench.archive.v1"
APPLICATION = (
    "discovery_engine.py", "discovery_cli.py", "README.md", "OPERATOR_GUIDE.md",
    "migration_reconciliation.py", "migration_report.py", "migration_server.py",
    "MIGRATION_RECONCILIATION.md", "MIGRATION_SELECTION_API.json", "MIGRATION_HTTP_API.json",
    "MIGRATION_RESULT_API.json", "MIGRATION_SOURCE_PROVENANCE.json", "LICENSE",
    "forms_workbench.py", "forms_server.py", "forms_report.py", "forms_capture.py",
    "FORMS_WORKBENCH.md", "FORMS_INTAKE_API.json", "FORMS_HTTP_API.json",
    "FORMS_CAPTURE.md", "FORMS_CAPTURE_API.json", "receiving_forms.py", "receiving_forms_browser.mjs",
    "FORMS_RECEIVING.md", "FORMS_EXAMPLES.json"
)

def text(value, label):
    require(isinstance(value, str) and bool(value.strip()), label+" must be nonempty text")
    return value

def ident(value, label):
    require(isinstance(value, str) and bool(IDENTIFIER.fullmatch(value)), "Invalid "+label)
    return value

def relative(value):
    require(isinstance(value,str) and value and "\\" not in value and "\x00" not in value,
            "Expected a portable relative file path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(part not in ("..",".","") for part in value.split("/")),
            "Expected a relative path without traversal")
    return Path(*path.parts)

def regular_under(root, name):
    root = Path(root).resolve()
    rel = relative(name)
    candidate = root / rel
    current = root
    for part in rel.parts:
        current = current / part
        require(not current.is_symlink(), "Symbolic links are not selected originals")
    require(candidate.is_file() and candidate.resolve().is_relative_to(root),
            "Original file is missing or outside the selected input root: "+name)
    return candidate

def write_json(path, value):
    Path(path).write_bytes(json_bytes(value))

def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()

def selected_source():
    here = Path(__file__).resolve().parent
    rows = []
    for name in APPLICATION:
        path = here/name
        require(path.is_file() and not path.is_symlink(), "Complete application member missing: "+name)
        rows.append({"path":name,"bytes":path.stat().st_size,"sha256":file_digest(path)})
    return rows

def inventory_files(root, exclude=()):
    root = Path(root)
    rows = []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(), "Project contains a symbolic link")
        if path.is_file():
            name = path.relative_to(root).as_posix()
            if name not in exclude:
                rows.append({"path":name,"bytes":path.stat().st_size,"sha256":file_digest(path)})
        elif not path.is_dir():
            raise DiscoveryError("Project contains a nonregular member")
    return rows

def csv_cell(value):
    if not isinstance(value, str):
        value = json.dumps(value,ensure_ascii=False,separators=(",",":"))
    if value.lstrip().startswith(("=","+","-","@","\t","\r")):
        value = "'"+value
    return value

class Output:
    """All long populations remain complete JSONL/CSV plus a paged disk index."""
    def __init__(self, root):
        self.root = root
        self.db = sqlite3.connect(root/"forms.sqlite")
        self.db.executescript("""
CREATE TABLE assets(asset_id TEXT PRIMARY KEY, asset_class TEXT, side TEXT, availability TEXT, search TEXT, payload TEXT);
CREATE INDEX assets_filter ON assets(asset_class, side, availability);
CREATE TABLE attachments(entry_id TEXT PRIMARY KEY, logical_id TEXT, side TEXT, availability TEXT, search TEXT, payload TEXT);
CREATE INDEX attachments_group ON attachments(logical_id,side);
CREATE INDEX attachments_filter ON attachments(side,availability);
CREATE TABLE findings(finding_id INTEGER PRIMARY KEY, asset_class TEXT, kind TEXT, status TEXT, search TEXT, payload TEXT);
CREATE INDEX findings_filter ON findings(asset_class,kind,status);
""")
        self.streams = {}
        self.writers = {}
        self.counts = Counter()
        self.statuses = Counter()
        self.class_statuses = {name:Counter() for name in CLASSES}
        self.headers = {
            "assets":["asset_id","asset_class","side","availability","content_state","filename","media_type","actual_bytes","actual_sha256","retained_path","table_ids","provenance"],
            "attachments":["entry_id","logical_id","side","availability","asset_id","form_key","response_key","field_key","ordinal","filename","media_type","parent_status","parent","body","reference"],
            "findings":["finding_id","asset_class","kind","status","key","source_entries","target_entries","issues","reference"]
        }
        for kind, header in self.headers.items():
            js = open(root/(kind+".jsonl"),"w",encoding="utf-8",newline="")
            cs = open(root/(kind+".csv"),"w",encoding="utf-8",newline="")
            writer = csv.writer(cs)
            writer.writerow(header)
            self.streams[kind] = (js,cs)
            self.writers[kind] = writer

    def put(self, kind, row):
        payload = json.dumps(row,ensure_ascii=False,sort_keys=True,separators=(",",":"))
        self.counts[kind] += 1
        self.streams[kind][0].write(payload+"\n")
        self.writers[kind].writerow([csv_cell(row.get(k)) for k in self.headers[kind]])
        if kind=="assets":
            self.db.execute("INSERT INTO assets VALUES(?,?,?,?,?,?)",
                (row["asset_id"],row["asset_class"],row["side"],row["availability"],
                 " ".join(str(row.get(x,"")) for x in ("asset_id","filename","provenance")),payload))
        elif kind=="attachments":
            self.db.execute("INSERT INTO attachments VALUES(?,?,?,?,?,?)",
                (row["entry_id"],row["logical_id"],row["side"],row["availability"],
                 " ".join(str(row.get(x,"")) for x in ("entry_id","logical_id","filename","form_key","response_key","field_key")),payload))
        else:
            self.db.execute("INSERT INTO findings VALUES(?,?,?,?,?,?)",
                (row["finding_id"],row["asset_class"],row["kind"],row["status"],str(row["key"]),payload))
            self.statuses[row["status"]] += 1
            self.class_statuses[row["asset_class"]][row["status"]] += 1

    def finding(self, asset_class, kind, status, key, source, target, issues, reference, **extra):
        row = {"finding_id":self.counts["findings"]+1,"asset_class":asset_class,"kind":kind,
               "status":status,"key":key,"source_entries":source,"target_entries":target,
               "issues":issues,"reference":reference,**extra}
        self.put("findings",row)

    def close(self):
        self.db.commit()
        self.db.close()
        for streams in self.streams.values():
            for stream in streams:
                stream.close()

def validate_plan(plan):
    require(plan.get("schema")==INTAKE,"Unsupported forms intake schema")
    for name in ("label","edition","interpretation_reference"):
        text(plan.get(name),name)
    require(plan.get("data_class") in ("DEMONSTRATION","AUTHORIZED_CUSTOMER_EXPORT"),"Select the actual data class")
    require(set(plan.get("classes",{}))==set(CLASSES),"Explicitly select all six asset classes")
    for name,item in plan["classes"].items():
        require(item.get("disposition") in ("include","exclude","defer"),"Invalid class disposition")
        text(item.get("reference"),name+" selection reference")
    require(isinstance(plan.get("assets"),list) and plan["assets"],"Select the complete original asset inventory")
    require(isinstance(plan.get("attachments"),list),"attachments must be an explicit list")
    require(isinstance(plan.get("file_comparisons"),list),"file_comparisons must be an explicit list")
    require(isinstance(plan.get("table_assets"),dict),"table_assets must map every original selected table")
    require(isinstance(plan.get("pair_classes"),dict),"pair_classes must name every selected comparison pair")
    manifest = plan.get("discovery_manifest")
    selection = plan.get("migration_selection")
    require(isinstance(manifest,dict) and isinstance(selection,dict),"Complete source manifest and migration selection required")
    require(manifest.get("data_class")==plan["data_class"],"Source and outer project data classes differ")
    require(manifest.get("edition")==plan["edition"],"Source and outer project editions differ")
    require(manifest.get("schema")=="commons.discovery.cohort-manifest.v1","Original source engine manifest required")
    require(selection.get("schema")=="tjlabs.migration-reconciliation.selection.v1","Original migration interpretation required")
    ids = [t.get("id") for t in manifest.get("tables",[])]
    require(ids and len(ids)==len(set(ids)) and set(ids)==set(plan["table_assets"]),"Every original table requires exactly one asset binding")
    pairs = [p.get("id") for p in selection.get("pairs",[])]
    require(pairs and len(pairs)==len(set(pairs)) and set(pairs)==set(plan["pair_classes"]),"Every comparison pair requires a class")
    require(all(v in CLASSES for v in plan["pair_classes"].values()),"Unknown pair asset class")
    ac = plan.get("attachment_comparison")
    require(isinstance(ac,dict) and type(ac.get("filename")) is bool and type(ac.get("media_type")) is bool,
            "Select filename and media type attachment comparison explicitly")
    text(ac.get("reference"),"attachment comparison reference")

def retain_assets(plan, input_root, root, output):
    assets = {}
    summaries = {name:{"selection":plan["classes"][name],"assets":{side:Counter() for side in SIDES},
                       "content_states":Counter(),"pairs":[]} for name in CLASSES}
    table_ids = {}
    for table,asset_id in plan["table_assets"].items():
        table_ids.setdefault(asset_id,[]).append(table)
    for original in plan["assets"]:
        require(isinstance(original,dict),"Asset declaration must be an object")
        aid = ident(original.get("id"),"asset ID")
        require(aid not in assets,"Duplicate asset ID")
        cls,side,available = original.get("asset_class"),original.get("side"),original.get("availability")
        require(cls in CLASSES and side in SIDES and available in AVAILABILITY,"Invalid asset class, side or availability")
        text(original.get("filename"),"original filename")
        text(original.get("media_type"),"original media type")
        text(original.get("provenance"),"original provenance")
        state = original.get("content_state","UNASSESSED")
        require(state in CONTENT,"Invalid content completeness state")
        row = dict(original,asset_id=aid,content_state=state,retained_path=None,actual_bytes=None,actual_sha256=None,
                   table_ids=table_ids.get(aid,[]))
        if available=="PRESENT":
            require(type(original.get("bytes")) is int and original["bytes"]>=0 and
                    isinstance(original.get("sha256"),str) and SHA.fullmatch(original["sha256"]),
                    "Present original requires exact bytes and SHA256")
            source = regular_under(input_root,original.get("path"))
            target = root/"originals"/aid/"original"
            target.parent.mkdir(parents=True)
            h,count = hashlib.sha256(),0
            with source.open("rb") as inp, target.open("xb") as out:
                while True:
                    block = inp.read(1024*1024)
                    if not block:
                        break
                    count += len(block)
                    h.update(block)
                    out.write(block)
            require(count==original["bytes"] and h.hexdigest()==original["sha256"],
                    "Original byte identity changed: "+aid)
            row.update(retained_path=target.relative_to(root).as_posix(),actual_bytes=count,actual_sha256=h.hexdigest())
        else:
            require(not original.get("path"),"Unavailable asset cannot masquerade as a retained body")
        assets[aid]=row
        summaries[cls]["assets"][side][available] += 1
        summaries[cls]["content_states"][state] += 1
        output.put("assets",row)
    require(set(table_ids)<=set(assets),"Table refers to an unknown original asset")
    return assets,summaries


def validate_bindings(plan,assets):
    """A declared comparison class/side must belong to its actual original."""
    tables = plan["table_assets"]
    for pair in plan["migration_selection"]["pairs"]:
        cls = plan["pair_classes"][pair["id"]]
        for side in ("source","target"):
            table = pair[side]["table"]
            require(table in tables and tables[table] in assets,"Unknown comparison table asset")
            asset = assets[tables[table]]
            require(asset["side"]==side and asset["asset_class"]==cls,
                    "Comparison table asset side/class differs from its selected pair: "+pair["id"]+"/"+side)
        mapping = pair.get("key_mapping")
        if mapping is not None:
            require(mapping["table"] in tables,"Unknown original crosswalk table asset")

def prepare_source(plan, assets, root):
    manifest = json.loads(json.dumps(plan["discovery_manifest"]))
    for table in manifest["tables"]:
        asset = assets[plan["table_assets"][table["id"]]]
        require(asset["availability"]=="PRESENT","Compared CSV original is unavailable: "+asset["asset_id"])
        table["path"] = asset["retained_path"]
    prepared = root/"prepared"
    prepared.mkdir()
    write_json(prepared/"manifest.json",manifest)
    write_json(prepared/"selection.json",plan["migration_selection"])
    return manifest

def parent_status(parent, tables, db, side, table_assets, assets):
    if not isinstance(parent,dict):
        return "INVALID_LINK"
    tid,record = parent.get("table"),parent.get("record")
    cols,values = parent.get("key_columns"),parent.get("key_values")
    if tid not in tables or type(record) is not int or record<1 or not isinstance(cols,list) or not cols or not isinstance(values,list) or len(cols)!=len(values):
        return "INVALID_LINK"
    original = assets[table_assets[tid]]
    if original["side"] != side:
        return "SIDE_MISMATCH"
    cls = parent.get("asset_class","responses")
    if cls not in CLASSES or (cls!="responses" and not isinstance(parent.get("reference"),str)):
        return "INVALID_LINK"
    if cls!="responses" and not parent["reference"].strip():
        return "INVALID_LINK"
    if original["asset_class"] != cls:
        return "CLASS_MISMATCH"
    ordinal,definition = tables[tid]
    names = [x["name"] for x in definition["columns"]]
    if len(cols)!=len(set(cols)) or any(x not in names for x in cols) or any(not isinstance(x,str) for x in values):
        return "INVALID_LINK"
    fields = ",".join("r"+str(names.index(x)) for x in cols)
    row = db.execute("SELECT _width_valid,"+fields+" FROM t"+str(ordinal)+" WHERE _row=?",(record,)).fetchone()
    if row is None:
        return "MISSING_RECORD"
    if not row[0] or list(row[1:])!=values:
        return "KEY_MISMATCH"
    return "MATCHED"

def index_attachments(plan, assets, root, output, manifest):
    tables = {item["id"]:(i,item) for i,item in enumerate(manifest["tables"])}
    _,report,_ = verify_case(root/"reconciliation")
    with record_database(root/"reconciliation",report) as (database,_):
        with closing(sqlite3.connect(Path(database).as_uri()+"?mode=ro",uri=True)) as db:
            seen = set()
            for original in plan["attachments"]:
                require(isinstance(original,dict),"Attachment declaration must be an object")
                eid = ident(original.get("entry_id"),"attachment entry ID")
                require(eid not in seen,"Duplicate attachment entry ID")
                seen.add(eid)
                for key in ("logical_id","form_key","response_key","field_key","ordinal","filename","media_type","reference"):
                    text(original.get(key),"attachment "+key)
                require(original.get("side") in ("source","target") and original.get("availability") in AVAILABILITY,
                        "Invalid attachment side or availability")
                aid = original.get("asset_id")
                asset = assets.get(aid) if aid is not None else None
                require(asset is not None or aid is None,"Attachment names an unknown original")
                if asset:
                    require(asset["asset_class"]=="uploads" and asset["side"]==original["side"],
                            "Attachment body must belong to the same upload side")
                    require(asset["availability"]==original["availability"],"Attachment and original body availability differ")
                else:
                    require(original["availability"]!="PRESENT","A present attachment needs its complete original body")
                body = {"availability":original["availability"],"asset_id":aid,
                        "bytes":asset["actual_bytes"] if asset else None,
                        "sha256":asset["actual_sha256"] if asset else None}
                row = dict(original,body=body,parent_status=parent_status(original.get("parent"),tables,db,original["side"],plan["table_assets"],assets))
                output.put("attachments",row)
    output.db.commit()

def compare_attachments(plan, output):
    reference = plan["attachment_comparison"]["reference"]
    groups = output.db.execute("SELECT logical_id,SUM(side='source'),SUM(side='target') FROM attachments GROUP BY logical_id ORDER BY logical_id")
    for logical_id,source_count,target_count in groups:
        counts = {"source":source_count,"target":target_count}
        if source_count>1 or target_count>1:
            for payload, in output.db.execute("SELECT payload FROM attachments WHERE logical_id=? ORDER BY entry_id",(logical_id,)):
                row = json.loads(payload)
                output.finding("uploads","attachment","AMBIGUOUS",logical_id,
                    [row["entry_id"]] if row["side"]=="source" else [],
                    [row["entry_id"]] if row["side"]=="target" else [],
                    ["The selected logical attachment identity is not one-to-one."],reference,group_counts=counts)
            continue
        rows = {json.loads(p)["side"]:json.loads(p) for p, in output.db.execute(
            "SELECT payload FROM attachments WHERE logical_id=? ORDER BY side",(logical_id,))}
        source,target = rows.get("source"),rows.get("target")
        issues = []
        if source is None or target is None:
            status = "TARGET_ONLY" if source is None else "SOURCE_ONLY"
            issues.append("The selected logical attachment has no counterpart.")
        elif source["parent_status"]!="MATCHED" or target["parent_status"]!="MATCHED":
            status = "PARENT_MISMATCH"
            issues.append("An explicit original parent record or raw identity does not match.")
        elif source["availability"]!="PRESENT" or target["availability"]!="PRESENT":
            status = "UNAVAILABLE"
            issues.append("Complete selected attachment bytes are unavailable or redacted.")
        else:
            for key in ("form_key","response_key","field_key","ordinal"):
                if source[key]!=target[key]:
                    issues.append("Canonical parent relationship differs: "+key)
            for key in ("filename","media_type"):
                if plan["attachment_comparison"][key] and source[key]!=target[key]:
                    issues.append("Selected attachment metadata differs: "+key)
            if source["body"]["bytes"]!=target["body"]["bytes"] or source["body"]["sha256"]!=target["body"]["sha256"]:
                issues.append("Complete attachment byte identity differs.")
            status = "DIFFERENCE" if issues else "MATCHED"
        output.finding("uploads","attachment",status,logical_id,
                       [source["entry_id"]] if source else [],[target["entry_id"]] if target else [],
                       issues,reference)

def compare_files(plan,assets,output):
    seen = set()
    for selected in plan["file_comparisons"]:
        fid = ident(selected.get("id"),"file comparison ID")
        require(fid not in seen,"Duplicate file comparison ID")
        seen.add(fid)
        cls = selected.get("asset_class")
        require(cls in CLASSES,"Unknown file comparison class")
        text(selected.get("reference"),"file comparison interpretation")
        source,target = assets.get(selected.get("source_asset")),assets.get(selected.get("target_asset"))
        require(source is not None and target is not None,"Both compared file declarations are required")
        require(source["asset_class"]==target["asset_class"]==cls and source["side"]=="source" and target["side"]=="target",
                "File comparison selects incorrect classes or sides")
        if source["availability"]!="PRESENT" or target["availability"]!="PRESENT":
            status,issues = "UNAVAILABLE",["Complete original byte bodies are unavailable."]
        elif source["actual_bytes"]==target["actual_bytes"] and source["actual_sha256"]==target["actual_sha256"]:
            status,issues = "MATCHED",[]
        else:
            status,issues = "DIFFERENCE",["The selected whole originals differ byte-for-byte."]
        output.finding(cls,"file",status,fid,[source["asset_id"]],[target["asset_id"]],issues,selected["reference"])

def class_coverage(plan,assets,summaries,migration,output):
    examined_assets = set()
    for pair in migration["pairs"]:
        cls = plan["pair_classes"][pair["id"]]
        summaries[cls]["pairs"].append({"id":pair["id"],"label":pair["label"],
            "status_counts":pair["summary"]["status_counts"],"summary":pair["summary"],"totals":pair.get("totals"),
            "crosswalk_issue_counts":pair.get("crosswalk_issue_counts",{})})
        examined_assets.update(plan["table_assets"][pair[side+"_table"]] for side in ("source","target"))
        if pair.get("key_mapping"):
            examined_assets.add(plan["table_assets"][pair["key_mapping"]["table"]])
    for selected in plan["file_comparisons"]:
        examined_assets.update((selected["source_asset"],selected["target_asset"]))
    linked_uploads = {json.loads(p)["asset_id"] for p, in output.db.execute("SELECT payload FROM attachments")}
    examined_assets.update(x for x in linked_uploads if x is not None)
    for cls in CLASSES:
        summary = summaries[cls]
        disposition = plan["classes"][cls]["disposition"]
        assets_in = [a for a in assets.values() if a["asset_class"]==cls]
        unexamined = [a for a in assets_in if a["asset_id"] not in examined_assets]
        summary["examined_asset_count"] = len(assets_in)-len(unexamined)
        summary["unexamined_asset_count"] = len(unexamined)
        summary["unexamined_assets_route"] = "api/forms/findings?asset_class="+cls+"&kind=asset_coverage"
        issues = []
        if disposition!="include":
            status = "EXCLUDED" if disposition=="exclude" else "DEFERRED"
            issues.append("This class has the explicitly selected disposition: "+disposition)
        else:
            for side in ("source","target"):
                if not any(a["side"]==side for a in assets_in):
                    issues.append("No "+side+" originals are declared for this included class.")
            if any(a["availability"]!="PRESENT" for a in assets_in):
                issues.append("Some selected originals are unavailable or redacted.")
            if any(a["content_state"]!="COMPLETE" for a in assets_in):
                issues.append("Some original contents are partial, redacted or not assessed for coverage.")
            if unexamined:
                issues.append(str(len(unexamined))+" selected originals have no field, whole-file or attachment comparison.")
                for asset in unexamined:
                    output.finding(cls,"asset_coverage","UNEXAMINED",asset["asset_id"],
                        [asset["asset_id"]] if asset["side"]=="source" else [],
                        [asset["asset_id"]] if asset["side"]=="target" else [],
                        ["This original has no selected comparison; another comparison in the class cannot cover it."],
                        plan["classes"][cls]["reference"],asset_id=asset["asset_id"],asset_side=asset["side"])
            if cls=="uploads" and any(a["asset_id"] not in linked_uploads for a in assets_in):
                issues.append("Some selected upload originals have no explicit attachment parent link.")
            if not assets_in:
                issues.append("No original assets are declared for this included class.")
            status = "UNEXAMINED" if issues else "MATCHED"
        summary["scope_state"] = status
        summary["coverage_issues"] = issues
        summary["finding_status_counts"] = dict(output.class_statuses[cls])
        summary["meaning"] = "Selected coverage and computed comparisons are separate; neither records a human acceptance or vendor migration."
        output.finding(cls,"coverage",status,cls,[],[],issues,plan["classes"][cls]["reference"])
    return summaries

def run_project(intake_path,output_directory,input_root=None):
    original_bytes = Path(intake_path).read_bytes()
    plan = parse_json_bytes(original_bytes)
    validate_plan(plan)
    input_root = Path(input_root).resolve() if input_root else Path(intake_path).resolve().parent
    destination = Path(output_directory).resolve()
    require(not destination.exists(),"Choose a new immutable complete project directory")
    destination.parent.mkdir(parents=True,exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="."+destination.name+"-",dir=destination.parent))
    root = staging/"project"
    root.mkdir()
    output = None
    try:
        (root/"intake.original.json").write_bytes(original_bytes)
        app = selected_source()
        output = Output(root)
        assets,classes = retain_assets(plan,input_root,root,output)
        validate_bindings(plan,assets)
        manifest = prepare_source(plan,assets,root)
        run_migration(root/"prepared/manifest.json",root/"prepared/selection.json",root/"reconciliation",root)
        _,_,migration = verify_case(root/"reconciliation")
        index_attachments(plan,assets,root,output,manifest)
        compare_attachments(plan,output)
        compare_files(plan,assets,output)
        classes = class_coverage(plan,assets,classes,migration,output)
        counts,statuses = dict(output.counts),dict(output.statuses)
        output.close()
        output = None
        received = json.loads(json.dumps(plan))
        for asset in received["assets"]:
            if asset["availability"]=="PRESENT":
                asset["path"] = assets[asset["id"]]["retained_path"]
        write_json(root/"intake.receiving.json",received)
        result = {"schema":RESULT,"project_identity":digest_bytes(original_bytes),
            "label":plan["label"],"edition":plan["edition"],"data_class":plan["data_class"],
            "interpretation_reference":plan["interpretation_reference"],"classes":classes,
            "assets":{"count":counts.get("assets",0),"jsonl":"assets.jsonl","csv":"assets.csv"},
            "attachments":{"count":counts.get("attachments",0),"jsonl":"attachments.jsonl","csv":"attachments.csv"},
            "findings":{"count":counts.get("findings",0),"jsonl":"findings.jsonl","csv":"findings.csv","status_counts":statuses},
            "migration":{"source_run_identity":migration["source_run_identity"],"pairs":len(migration["pairs"]),
                         "comparison_records":migration["comparison_records"],"selection_sha256":migration["selection_sha256"]},
            "source_files":app,
            "meaning":"Whole selected originals are retained. Explicit CSV field/key comparisons, whole-file byte comparisons, attachment parent/body comparisons and class coverage retain their separate meanings. Vendor mutation and human acceptance are external decisions."}
        write_json(root/"result.json",result)
        from forms_report import render_html
        (root/"report.html").write_text(render_html(result),encoding="utf-8")
        write_json(root/"delivery.json",{"schema":DELIVERY,"project_identity":result["project_identity"],
                   "files":inventory_files(root)})
        os.rename(root,destination)
        return {"output":str(destination),"project_identity":result["project_identity"],
                "assets":result["assets"]["count"],"findings":result["findings"]["count"],
                "source_run_identity":migration["source_run_identity"]}
    finally:
        if output is not None:
            output.close()
        shutil.rmtree(staging,ignore_errors=True)

def verify_project(directory,check_application=False):
    root = Path(directory).resolve()
    require(root.is_dir() and not root.is_symlink(),"Complete forms project is missing")
    declaration = read_json(root/"delivery.json")
    require(declaration.get("schema")==DELIVERY,"Unsupported forms delivery")
    entries = declaration.get("files")
    require(isinstance(entries,list),"Complete member declaration is missing")
    expected = {x["path"]:x for x in entries}
    require(len(expected)==len(entries),"Repeated declared project member")
    actual = inventory_files(root,exclude=("delivery.json","archive-manifest.json"))
    actual = [x for x in actual if not x["path"].startswith("workbench/")]
    require({x["path"] for x in actual}==set(expected),"Complete project member set changed")
    for entry in actual:
        require(entry==expected[entry["path"]],"Project member changed: "+entry["path"])
        regular_under(root,entry["path"])
    result = read_json(root/"result.json")
    original = (root/"intake.original.json").read_bytes()
    require(result.get("schema")==RESULT and digest_bytes(original)==result["project_identity"]==declaration["project_identity"],
            "Original project selection identity differs")
    source_files = result.get("source_files")
    require(isinstance(source_files,list) and len(source_files)==len(APPLICATION),
            "Complete selected application declaration is required")
    names = [x.get("path") for x in source_files if isinstance(x,dict)]
    require(len(names)==len(APPLICATION) and len(set(names))==len(names) and set(names)==set(APPLICATION),
            "Selected application must contain every required member exactly once")
    for selected in source_files:
        require(type(selected.get("bytes")) is int and selected["bytes"]>=0 and
                isinstance(selected.get("sha256"),str) and SHA.fullmatch(selected["sha256"]),
                "Invalid selected application byte identity")
    plan = parse_json_bytes(original)
    validate_plan(plan)
    # A received project's selected program remains part of its complete identity.
    workbench = root/"workbench"
    if workbench.exists():
        require(workbench.is_dir() and not workbench.is_symlink(),"Invalid received program directory")
        source_members = {x["path"]:x for x in result["source_files"]}
        present = {p.relative_to(workbench).as_posix() for p in workbench.rglob("*")
                   if p.is_file() and not p.relative_to(workbench).as_posix().startswith("__pycache__/")}
        require(present==set(source_members),"Received selected program member set changed")
        for name,entry in source_members.items():
            path = regular_under(workbench,name)
            require(path.stat().st_size==entry["bytes"] and file_digest(path)==entry["sha256"],
                    "Received selected program changed: "+name)
    _,_,migration = verify_case(root/"reconciliation")
    require(migration["source_run_identity"]==result["migration"]["source_run_identity"],
            "Selected reconciliation source identity differs")
    if check_application:
        require(selected_source()==result["source_files"],"Restore complete selected application before continuing this project")
    return root,result

def pack_project(directory,destination):
    root,result = verify_project(directory,check_application=True)
    target = Path(destination).resolve()
    require(not target.exists() and not target.is_relative_to(root),"Choose a new archive outside the immutable project")
    target.parent.mkdir(parents=True,exist_ok=True)
    here = Path(__file__).resolve().parent
    entries = [(x["path"],regular_under(root,x["path"]),x) for x in inventory_files(root,exclude=("archive-manifest.json",))
               if not x["path"].startswith("workbench/")]
    for source in result["source_files"]:
        entries.append(("workbench/"+source["path"],here/source["path"],
                        dict(source,path="workbench/"+source["path"])))
    declaration = {"schema":ARCHIVE,"project_identity":result["project_identity"],"files":[x[2] for x in entries]}
    fd,temp = tempfile.mkstemp(prefix="."+target.name+"-",dir=target.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
            for name,path,descriptor in entries:
                info = zipfile.ZipInfo(name,(1980,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                info.create_system = 3
                h,count = hashlib.sha256(),0
                with path.open("rb") as inp, archive.open(info,"w",force_zip64=True) as out:
                    while True:
                        block = inp.read(1024*1024)
                        if not block:
                            break
                        count += len(block)
                        h.update(block)
                        out.write(block)
                require(count==descriptor["bytes"] and h.hexdigest()==descriptor["sha256"],"Project changed while packing")
            info = zipfile.ZipInfo("archive-manifest.json",(1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            info.create_system = 3
            archive.writestr(info,json_bytes(declaration))
        os.link(temp,target)
        return {"archive":str(target),"bytes":target.stat().st_size,"sha256":file_digest(target),
                "files":len(entries)+1,"project_identity":result["project_identity"]}
    finally:
        os.unlink(temp)

def archive_members(archive, max_bytes=20*1024**3):
    members = archive.infolist()
    names = [x.filename for x in members]
    require(len(names)==len(set(names)) and "archive-manifest.json" in names,"Complete archive manifest or unique members missing")
    require(sum(x.file_size for x in members)<=max_bytes,"Expanded archive exceeds the explicitly selected receiving byte limit")
    for member in members:
        relative(member.filename)
        mode = member.external_attr >> 16
        require(not member.is_dir() and stat.S_ISREG(mode),"Archive contains a nonregular member")
    require(archive.getinfo("archive-manifest.json").file_size<=64*1024**2,"Archive member declaration is excessively large")
    declaration = parse_json_bytes(archive.read("archive-manifest.json"))
    require(declaration.get("schema")==ARCHIVE,"Unsupported complete forms archive")
    entries = {x["path"]:x for x in declaration["files"]}
    require(len(entries)==len(declaration["files"]) and set(names)==set(entries)|{"archive-manifest.json"},
            "Archive differs from its complete member declaration")
    return members,declaration,entries

def receive_project(archive_path,destination,max_bytes=20*1024**3):
    target = Path(destination).resolve()
    require(not target.exists(),"Receive into a new directory")
    target.parent.mkdir(parents=True,exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="."+target.name+"-",dir=target.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members,declaration,entries = archive_members(archive,max_bytes)
            for member in members:
                path = stage/relative(member.filename)
                path.parent.mkdir(parents=True,exist_ok=True)
                h,count = hashlib.sha256(),0
                with archive.open(member) as inp,path.open("xb") as out:
                    while True:
                        block = inp.read(1024*1024)
                        if not block:
                            break
                        count += len(block)
                        require(count<=member.file_size,"Expanded member exceeds its ZIP declaration")
                        h.update(block)
                        out.write(block)
                if member.filename in entries:
                    expected = entries[member.filename]
                    require(count==expected["bytes"] and h.hexdigest()==expected["sha256"],"Received member identity differs")
        _,result = verify_project(stage)
        require(result["project_identity"]==declaration["project_identity"],"Received project identity differs")
        expected_source = {x["path"]:x for x in result["source_files"]}
        require({p.relative_to(stage/"workbench").as_posix() for p in (stage/"workbench").rglob("*") if p.is_file()}==set(expected_source),
                "Complete selected program was not received")
        for name,entry in expected_source.items():
            path = regular_under(stage/"workbench",name)
            require(path.stat().st_size==entry["bytes"] and file_digest(path)==entry["sha256"],
                    "Received selected program differs: "+name)
        os.rename(stage,target)
        return {"destination":str(target),"files":len(members),"project_identity":result["project_identity"]}
    except BaseException:
        shutil.rmtree(stage,ignore_errors=True)
        raise

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command",required=True)
    run = commands.add_parser("run")
    run.add_argument("--intake",required=True)
    run.add_argument("--input-root")
    run.add_argument("--output",required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--project",required=True)
    pack = commands.add_parser("pack")
    pack.add_argument("--project",required=True)
    pack.add_argument("--output",required=True)
    receive = commands.add_parser("receive")
    receive.add_argument("--archive",required=True)
    receive.add_argument("--output",required=True)
    receive.add_argument("--max-bytes",type=int,default=20*1024**3)
    args = parser.parse_args(argv)
    try:
        if args.command=="run":
            result = run_project(args.intake,args.output,args.input_root)
        elif args.command=="verify":
            _,saved = verify_project(args.project)
            result = {"project_identity":saved["project_identity"],"assets":saved["assets"]["count"]}
        elif args.command=="pack":
            result = pack_project(args.project,args.output)
        else:
            require(args.max_bytes>0,"Receiving byte limit must be positive")
            result = receive_project(args.archive,args.output,args.max_bytes)
        print(json.dumps({"status":"COMPLETE",**result},ensure_ascii=False))
        return 0
    except (DiscoveryError,ValueError,OSError,sqlite3.Error,KeyError,TypeError,zipfile.BadZipFile) as error:
        print(json.dumps({"status":"ERROR","type":type(error).__name__,"message":str(error)},ensure_ascii=False))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
