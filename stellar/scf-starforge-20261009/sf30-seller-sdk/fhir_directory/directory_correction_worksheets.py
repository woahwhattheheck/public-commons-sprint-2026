"""MIT. Original HSDS customer worksheets, lexical return comparison and explicit review."""
from __future__ import annotations
import json
import re
from pathlib import Path
import zipfile
import directory_index as directory_index
from directory_runtime import InputError,ConflictError,fhir,original_workspace
from directory_source_schema import sha,jbytes,json_value,lexical_json,MAX_BYTES,MAX_INTERACTIVE
from directory_source import retained_file_descriptors
from directory_corrections_schema import typed as correction_typed
from directory_correction_worksheets_schema import (WORKSHEET_SCHEMA,IMPORT_SCHEMA,RETURN_SCHEMA,
    REVIEW_SCHEMA,PACKET_SCHEMA,KINDS,MAX_INPUT,MAX_DOCUMENT,MAX_CHANGES,typed,returned_document,worksheet_catalogue)
from eltss_runtime import write_zip

REF_FIELDS=("sourceId","recordId","rowSha256","resourceSha256","memberSha256")
HERE=Path(__file__).resolve().parent
ASSETS=HERE/"public"

def _atom(value=None,present=True):
    if not present:return {"present":False}
    kind="number"if isinstance(value,fhir.Number)else"null"if value is None else"boolean"if type(value)is bool else \
        "object"if isinstance(value,dict)else"array"if isinstance(value,list)else"string"
    return {"present":True,"type":kind,"valueJson":lexical_json(value)}

def _pointer(path,key):
    result=path+"/"+key.replace("~","~0").replace("/","~1")
    if len(result)>16384:raise InputError("The proposed JSON field exceeds the native correction pointer limit")
    return result

def _json_differences(before,after,path="",depth=0):
    if depth>128:raise InputError("The complete JSON proposal exceeds128 nested objects")
    if type(before)is dict and type(after)is dict:
        for key in sorted(set(before)|set(after)):
            pointer=_pointer(path,key)
            if key not in before:yield pointer,"json-set",_atom(present=False),_atom(after[key]),after[key]
            elif key not in after:yield pointer,"json-remove",_atom(before[key]),_atom(present=False),None
            else:yield from _json_differences(before[key],after[key],pointer,depth+1)
    elif lexical_json(before)!=lexical_json(after):
        yield path,"json-set",_atom(before),_atom(after),after

def _same_file(path,raw,label):
    if Path(path).read_bytes()!=raw:raise InputError(label+" differs from the complete original computation")

class DirectoryCorrectionWorksheets:
    def directory_correction_worksheet_catalogue(self):
        return worksheet_catalogue()

    def _worksheet_write(self,scratch,name,raw,role,maximum=MAX_BYTES):
        if len(raw)>maximum:raise InputError("The complete worksheet file exceeds its supported byte budget")
        path=Path(scratch)/name
        original_workspace.private_write(path,raw)
        return self._directory_retain_file(path,role)

    def _worksheet_original_rows(self,value):
        edition=self.directory_record("editions",value["editionId"])
        edits=[];rows=[]
        with self.directory_open_index("editions",edition["id"])as edition_db:
            for ref in value["rows"]:
                row=directory_index.one(edition_db,ref["recordId"],ref["sourceId"])
                original={k:row[k]for k in ("table","memberName","pointer","rowOrdinal","nativeId")}
                original.update(rowKey=sha(jbytes({"workspaceId":self.workspace_id,"editionId":edition["id"],"ref":ref})),
                    ref=dict(ref),representation="csv"if"cells"in row else"json")
                if "cells"in row:
                    original.update(cells=list(row["cells"]),headers=list(row["headers"]))
                    edit={**ref,"action":"csv-row","cells":row["cells"],"reason":"Retain the complete original worksheet row"}
                else:
                    original["valueJson"]=row["json"]
                    if type(json_value(row["json"],lexical=True))is not dict:
                        raise InputError("Select a complete original JSON object for the customer worksheet")
                    if sha(row["json"].encode("utf-8"))!=row["resourceSha256"]:
                        raise InputError("The complete original JSON worksheet row differs from its retained value")
                    edit={**ref,"action":"json-set","pointer":"","valueJson":row["json"],"reason":"Retain the complete original worksheet row"}
                edits.append(edit);rows.append(original)
        _,targets=self._correction_targets({"editionId":edition["id"],"predecessorId":value.get("predecessorId"),"edits":edits})
        summary={"rows":len(rows),"jsonRows":sum(r["representation"]=="json"for r in rows),
            "csvRows":sum(r["representation"]=="csv"for r in rows),"sources":len({r["ref"]["sourceId"]for r in rows})}
        self._worksheet_envelope({**value,"id":"0"*64},rows)
        return targets,rows,summary

    def _worksheet_envelope(self,record,rows):
        value={"schema":WORKSHEET_SCHEMA,"workspaceId":self.workspace_id,"worksheetId":record["id"],
            **{k:record[k]for k in ("editionId","label","actor","note")},"rows":rows}
        if len(jbytes(value))>MAX_DOCUMENT:raise InputError("The complete customer worksheet exceeds64MiB")
        return value

    def prepare_directory_correction_worksheet(self,raw):
        value=typed("prepare",raw)
        with self.mutex,self.scratch()as scratch:
            targets,rows,summary=self._worksheet_original_rows(value)
            files={"input":self._worksheet_write(scratch,"input.json",jbytes(value),"directory-worksheet-input",MAX_INPUT),
                "rows":self._worksheet_write(scratch,"rows.jsonl",b"".join(jbytes(r)for r in rows),"directory-worksheet-original-rows",MAX_DOCUMENT)}
            return self._directory_store("correctionWorksheets",{"schema":WORKSHEET_SCHEMA,"workspaceId":self.workspace_id,
                **value,"targets":targets,"summary":summary,"files":files})

    def _worksheet_file_rows(self,record,key):
        rows=[]
        with self._directory_file_path(record["files"][key]).open("rb")as stream:
            for raw in stream:
                if not raw.endswith(b"\n"):raise InputError("The complete worksheet row file ended before its original line boundary")
                rows.append(json_value(raw))
                if len(rows)>10000:raise InputError("The complete worksheet row file exceeds its native row bound")
        return rows

    def directory_correction_worksheet_document(self,ident):
        with self.mutex:
            record=self.directory_record("correctionWorksheets",fhir.identity(ident))
            return self._worksheet_envelope(record,self._worksheet_file_rows(record,"rows"))

    def save_directory_correction_worksheet_import(self,raw):
        value=typed("import",raw)
        with self.mutex,self.scratch()as scratch:
            worksheet=self.directory_record("correctionWorksheets",value["worksheetId"])
            file=self._worksheet_write(scratch,"input.json",jbytes(value),"directory-worksheet-import-input",MAX_INPUT)
            return self._directory_store("correctionWorksheetImports",{"schema":IMPORT_SCHEMA,"workspaceId":self.workspace_id,
                **value,"editionId":worksheet["editionId"],"files":{"input":file}})

    def _worksheet_compare(self,worksheet,raw):
        value=returned_document(raw)
        if (value["workspaceId"],value["worksheetId"],value["editionId"])!=(self.workspace_id,worksheet["id"],worksheet["editionId"]):
            raise ConflictError("The complete returned file names another original worksheet, workspace or edition")
        originals=self._worksheet_file_rows(worksheet,"rows")
        candidates={row["rowKey"]:row for row in value["candidates"]}
        if set(candidates)-{r["rowKey"]for r in originals}:raise InputError("A returned candidate is absent from this original worksheet")
        changes=[];changed_rows=set()
        def append(row,candidate,action,before,after,extra):
            if len(changes)>=MAX_CHANGES:raise InputError("The complete return exceeds10,000 native correction changes")
            edit={**row["ref"],"action":action,**extra,"reason":candidate["reason"]}
            body={"ordinal":len(changes)+1,"rowKey":row["rowKey"],"ref":row["ref"],
                "table":row["table"],"memberName":row["memberName"],"rowPointer":row["pointer"],
                "representation":row["representation"],"action":action,"before":before,"after":after,
                "reason":candidate["reason"],"edit":edit,"state":"proposed"}
            if "pointer"in extra:body["pointer"]=extra["pointer"]
            if "column"in extra:body["column"]=extra["column"]
            changes.append({"changeId":sha(jbytes(body)),**body});changed_rows.add(row["rowKey"])
        try:
            for row in originals:
                candidate=candidates.get(row["rowKey"])
                if candidate is None:continue
                if row["representation"]!=candidate["representation"]:raise InputError("Keep the original worksheet row representation")
                if row["representation"]=="json":
                    before=json_value(row["valueJson"],lexical=True);after=json_value(candidate["valueJson"],lexical=True)
                    for pointer,action,old,new,replacement in _json_differences(before,after):
                        extra={"pointer":pointer}
                        if action=="json-set":extra["valueJson"]=lexical_json(replacement)
                        append(row,candidate,action,old,new,extra)
                else:
                    before=row["cells"];after=candidate["cells"]
                    if len(before)!=len(after):
                        append(row,candidate,"csv-row",_atom(before),_atom(after),{"cells":after})
                    else:
                        for column,(old,new)in enumerate(zip(before,after)):
                            if old!=new:append(row,candidate,"csv-cell",_atom(old),_atom(new),{"column":column,"value":new})
        except RecursionError as error:raise InputError("The complete returned JSON exceeds supported nesting")from error
        summary={"rows":len(originals),"proposedRows":len(candidates),"omittedRows":len(originals)-len(candidates),
            "unchangedRows":len(candidates)-len(changed_rows),"changedRows":len(changed_rows),"changes":len(changes),
            "jsonChanges":sum(r["representation"]=="json"for r in changes),"csvChanges":sum(r["representation"]=="csv"for r in changes)}
        return value,changes,summary

    def import_directory_correction_worksheet_return(self,import_id,path):
        with self.mutex:
            intake=self.directory_record("correctionWorksheetImports",fhir.identity(import_id))
            worksheet=self.directory_record("correctionWorksheets",intake["worksheetId"])
            original_workspace.regular(Path(path),MAX_INPUT)
            original=self._directory_retain_file(path,"directory-worksheet-original-return")
            if intake.get("expectedSha256")is not None and original["sha256"]!=intake["expectedSha256"]:
                raise ConflictError("The complete returned file differs from the selected expected SHA256")
            if intake.get("expectedBytes")is not None and original["bytes"]!=intake["expectedBytes"]:
                raise ConflictError("The complete returned file differs from the selected expected byte count")
            raw=self._directory_file_path(original).read_bytes()
            value,changes,summary=self._worksheet_compare(worksheet,raw)
            with self.scratch()as scratch:
                file=self._worksheet_write(scratch,"changes.jsonl",b"".join(jbytes(c)for c in changes),"directory-worksheet-compared-changes")
            return self._directory_store("correctionWorksheetReturns",{"schema":RETURN_SCHEMA,"workspaceId":self.workspace_id,
                "importId":intake["id"],"worksheetId":worksheet["id"],"editionId":worksheet["editionId"],"actor":intake["actor"],
                "returnedBy":value["returnedBy"],"returnedAt":value["returnedAt"],"note":value["note"],
                "files":{"original":original,"changes":file},"summary":summary})

    def _worksheet_decisions(self,record,value):
        changes=self._worksheet_file_rows(record,"changes")
        by_id={choice["changeId"]:choice for choice in value["choices"]}
        if len(by_id)!=len(changes)or set(by_id)!={c["changeId"]for c in changes}:
            raise InputError("Explicitly accept or keep original for every returned change exactly once")
        decisions=[];edits=[]
        for change in changes:
            choice=by_id[change["changeId"]]
            decisions.append({**change,"customerReason":change["reason"],"reason":choice["reason"],
                "decision":choice["decision"],"state":choice["decision"]})
            if choice["decision"]=="accept":edits.append({**change["edit"],"reason":choice["reason"]})
        worksheet=self.directory_record("correctionWorksheets",record["worksheetId"])
        plan_input=None
        if edits:
            plan_input=correction_typed("prepare",{"label":value["label"],"editionId":worksheet["editionId"],
                "predecessorId":worksheet["predecessorId"],"actor":value["actor"],"note":value["note"],"edits":edits})
            self._correction_targets(plan_input)
        summary={"changes":len(changes),"accepted":len(edits),"keptOriginal":len(changes)-len(edits)}
        return plan_input,decisions,summary

    def review_directory_correction_worksheet_return(self,raw):
        value=typed("review",raw)
        with self.mutex,self.scratch()as scratch:
            record=self.directory_record("correctionWorksheetReturns",value["returnId"])
            plan_input,decisions,summary=self._worksheet_decisions(record,value)
            files={"input":self._worksheet_write(scratch,"input.json",jbytes(value),"directory-worksheet-review-input",MAX_INPUT),
                "decisions":self._worksheet_write(scratch,"decisions.jsonl",b"".join(jbytes(c)for c in decisions),"directory-worksheet-reviewed-changes")}
            plan=self.prepare_directory_correction(plan_input)if plan_input is not None else None
            return self._directory_store("correctionWorksheetReviews",{"schema":REVIEW_SCHEMA,"workspaceId":self.workspace_id,
                "label":value["label"],"actor":value["actor"],"note":value["note"],"returnId":record["id"],
                "worksheetId":record["worksheetId"],"editionId":record["editionId"],"planId":plan["id"]if plan else None,
                "outcome":"plan-prepared"if plan else"no-edits-selected","summary":summary,"files":files})

    def directory_correction_worksheet_rows(self,kind,ident,offset=0,limit=50,row_key=None,state=None):
        if kind not in KINDS:raise InputError("Select a complete retained worksheet collection")
        fhir.integer(offset,0,10000000,"Worksheet row offset");fhir.integer(limit,1,250,"Worksheet page size")
        if row_key is not None:fhir.identity(row_key)
        if state is not None and state not in {"original","proposed","accept","keep-original"}:
            raise InputError("Select an original worksheet row or an exact reviewed change state")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident))
            key={"correctionWorksheets":"rows","correctionWorksheetImports":None,
                "correctionWorksheetReturns":"changes","correctionWorksheetReviews":"decisions"}[kind]
            selected=[];total=0;used=0;full=False
            if key is not None:
                with self._directory_file_path(record["files"][key]).open("rb")as stream:
                    for raw in stream:
                        row=json_value(raw)
                        if row_key is not None and row.get("rowKey")!=row_key:continue
                        if state is not None and row.get("state","original")!=state:continue
                        position=total;total+=1
                        if position<offset or full:continue
                        if len(raw)>MAX_INTERACTIVE:
                            if selected:full=True;continue
                            raise InputError("Read the complete worksheet "+key+" file for this row larger than4MiB")
                        if len(selected)>=limit or used+len(raw)>MAX_INTERACTIVE:full=True;continue
                        selected.append(row);used+=len(raw)
            return {"kind":kind,"recordId":ident,"rows":selected,"total":total,"offset":offset,"limit":limit,
                "nextOffset":offset+len(selected)if offset+len(selected)<total else None,
                "bytes":used,"byteBudget":MAX_INTERACTIVE}

    def directory_correction_worksheet_file(self,kind,ident,file_kind="worksheet"):
        if kind not in KINDS:raise InputError("Select a complete retained worksheet collection")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident))
            if kind=="correctionWorksheets"and file_kind=="worksheet":
                with self.scratch()as scratch:
                    file=self._worksheet_write(scratch,"worksheet.json",jbytes(self.directory_correction_worksheet_document(ident)),
                        "directory-customer-worksheet",MAX_DOCUMENT)
            elif file_kind in record["files"]:file=record["files"][file_kind]
            else:raise InputError("Select an exact complete worksheet file")
            suffix=".jsonl"if file_kind in {"rows","changes","decisions"}else".json"
            return self._directory_file_path(file),{**file,"name":"Directory_Worksheet_"+ident+"_"+file_kind+suffix,
                "contentType":"application/x-ndjson"if suffix==".jsonl"else"application/json"}

    def _worksheet_customer_html(self,document,bodies=None):
        names={"template":"directory-correction-worksheet-customer.html","css":"directory-correction-worksheet-customer.css",
            "js":"directory-correction-worksheet-customer.js"}
        if bodies is None:
            bodies={}
            for name,filename in names.items():
                path=ASSETS/filename
                original_workspace.regular(path,4*1024*1024)
                bodies[name]=path.read_bytes().decode("utf-8")
        if set(bodies)!=set(names)or any(type(body)is not str or len(body.encode("utf-8"))>4*1024*1024 for body in bodies.values()):
            raise InputError("Retain every complete original customer editor asset")
        html=bodies["template"]
        substitutions={"{{WORKSHEET_JSON}}":json.dumps(document,ensure_ascii=False,separators=(",",":")).replace("<","\\u003c"),
            "{{CUSTOMER_CSS}}":bodies["css"],"{{CUSTOMER_JS}}":bodies["js"]}
        if "</script"in bodies["js"].lower()or"</style"in bodies["css"].lower():
            raise InputError("The retained customer assets contain an unexpected embedded element terminator")
        for marker in substitutions:
            if html.count(marker)!=1:raise InputError("The complete customer template requires one exact "+marker+" marker")
        # One pass over the template: original data containing another marker stays literal.
        html=re.sub("|".join(re.escape(marker)for marker in substitutions),lambda match:substitutions[match.group(0)],html)
        assets={name:{"name":"assets/"+filename,"bytes":len(bodies[name].encode("utf-8")),
            "sha256":sha(bodies[name].encode("utf-8"))}for name,filename in names.items()}
        return html.encode("utf-8"),assets,bodies

    def export_directory_correction_worksheet(self,raw):
        value=typed("export",raw)
        with self.mutex,self.scratch()as scratch:
            worksheet=self.directory_record("correctionWorksheets",value["worksheetId"])
            document=self.directory_correction_worksheet_document(worksheet["id"])
            html,assets,bodies=self._worksheet_customer_html(document)
            sources=[self.directory_source(ident)for ident in sorted({r["sourceId"]for r in worksheet["rows"]})]
            records={"workspaceId":self.workspace_id,"worksheet":worksheet,"sources":sources}
            files=retained_file_descriptors(records)
            members={"worksheet.json":jbytes(document),"customer.html":html,"records.json":jbytes(records),
                "README.md":("Directory customer correction worksheet\n\nOpen customer.html in a browser to review the complete selected originals and author proposals. "
                    "The editor works offline. Download the returned JSON and give it to the worksheet owner. "
                    "The owner explicitly chooses each change before preparing a correction plan, previewing its derived edition and accepting it. "
                    "Rows absent from the return remain original. Arrays and CSV row-size changes are reviewed as complete values. "
                    "worksheet.json and the complete original source files are included for independent use.\n").encode("utf-8")}
            for file in files:members["files/"+file["sha256"]+".bin"]=self._directory_file_path(file)
            for name,asset in assets.items():members[asset["name"]]=bodies[name].encode("utf-8")
            declarations=[]
            for name,item in sorted(members.items()):
                size=len(item)if isinstance(item,bytes)else item.stat().st_size
                digest=sha(item)if isinstance(item,bytes)else original_workspace.file_digest(item,MAX_BYTES)
                declarations.append({"name":name,"bytes":size,"sha256":digest})
            manifest={"schema":PACKET_SCHEMA,"workspaceId":self.workspace_id,"worksheetId":worksheet["id"],
                "editionId":worksheet["editionId"],"actor":value["actor"],"note":value["note"],
                "label":value.get("label")or worksheet["label"],"files":files,"members":declarations,"customerAssets":assets}
            members["manifest.json"]=jbytes(manifest)
            if sum(d["bytes"]for d in declarations)+len(members["manifest.json"])>MAX_BYTES:
                raise InputError("The complete worksheet package exceeds256MiB; prepare separate complete worksheets")
            path=Path(scratch)/"worksheet.zip";write_zip(path,members)
            file=self._directory_retain_file(path,"directory-complete-customer-worksheet")
            return self._directory_store("exports",{"label":manifest["label"],"kind":"correction-worksheet",
                "recordId":worksheet["id"],"name":"Directory_Worksheet_"+worksheet["id"]+".zip",
                "contentType":"application/zip","file":file,"actor":value["actor"],"note":value["note"]})

    def _verify_worksheet_packet(self,record):
        worksheet=self.directory_record("correctionWorksheets",record["recordId"])
        if record.get("name")!="Directory_Worksheet_"+worksheet["id"]+".zip"or record.get("contentType")!="application/zip":
            raise InputError("The complete worksheet download name or content type differs")
        with zipfile.ZipFile(self._directory_file_path(record["file"]))as archive:
            names=archive.namelist()
            if len(names)!=len(set(names))or"manifest.json"not in names:raise InputError("The complete worksheet package member list differs")
            if sum(item.file_size for item in archive.infolist())>MAX_BYTES:raise InputError("The worksheet package exceeds its complete extent")
            if archive.getinfo("manifest.json").file_size>MAX_DOCUMENT:raise InputError("The worksheet package manifest exceeds64MiB")
            manifest=json_value(archive.read("manifest.json"))
            expected={"schema":PACKET_SCHEMA,"workspaceId":self.workspace_id,"worksheetId":worksheet["id"],
                "editionId":worksheet["editionId"],"actor":record["actor"],"note":record["note"],"label":record["label"]}
            if any(manifest.get(k)!=v for k,v in expected.items()):raise InputError("The worksheet package names another original worksheet")
            declared=manifest.get("members",[])
            if len({d["name"]for d in declared})!=len(declared)or set(names)!={d["name"]for d in declared}|{"manifest.json"}:
                raise InputError("The complete worksheet package has missing, duplicate or additional members")
            for item in declared:
                raw=archive.read(item["name"])
                if len(raw)!=item["bytes"]or sha(raw)!=item["sha256"]:raise InputError("A complete worksheet package member differs")
            if archive.read("worksheet.json")!=jbytes(self.directory_correction_worksheet_document(worksheet["id"])):
                raise InputError("The portable worksheet differs from its complete selected original rows")
            sources=[self.directory_source(ident)for ident in sorted({r["sourceId"]for r in worksheet["rows"]})]
            records={"workspaceId":self.workspace_id,"worksheet":worksheet,"sources":sources}
            if archive.read("records.json")!=jbytes(records):raise InputError("The worksheet package original records differ")
            files=retained_file_descriptors(records)
            if manifest["files"]!=files:raise InputError("The worksheet package omits an original retained source file")
            assets=manifest.get("customerAssets",{})
            if set(assets)!={"template","css","js"}:raise InputError("The worksheet package omits original customer editor source")
            bodies={name:archive.read(asset["name"]).decode("utf-8")for name,asset in assets.items()}
            expected_html,expected_assets,_=self._worksheet_customer_html(self.directory_correction_worksheet_document(worksheet["id"]),bodies)
            if assets!=expected_assets or archive.read("customer.html")!=expected_html:
                raise InputError("The standalone customer editor differs from its complete original worksheet and retained source")
            expected_names={"worksheet.json","customer.html","records.json","README.md","manifest.json"}|{"files/"+f["sha256"]+".bin"for f in files}|{a["name"]for a in expected_assets.values()}
            if set(names)!=expected_names:raise InputError("The customer package does not contain exactly its complete original sources")
            for file in files:
                raw=archive.read("files/"+file["sha256"]+".bin")
                if len(raw)!=file["bytes"]or sha(raw)!=file["sha256"]:raise InputError("The package's complete original source bytes differ")

    def _verify_directory_correction_worksheets(self):
        expected_schemas=dict(zip(KINDS,(WORKSHEET_SCHEMA,IMPORT_SCHEMA,RETURN_SCHEMA,REVIEW_SCHEMA)))
        with self.mutex:
            for kind in KINDS:
                for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind=? ORDER BY created,id",(kind,)):
                    record=self.directory_record(kind,ident)
                    if record.get("schema")!=expected_schemas[kind]or record.get("workspaceId")!=self.workspace_id:
                        raise InputError("The received worksheet record names another schema or workspace")
                    for file in retained_file_descriptors(record):self._directory_file_path(file)
                    if kind=="correctionWorksheets":
                        value=typed("prepare",json_value(self._directory_file_path(record["files"]["input"]).read_bytes()))
                        if any(record.get(k)!=v for k,v in value.items()):raise InputError("The original worksheet preparation input differs")
                        targets,rows,summary=self._worksheet_original_rows(value)
                        if targets!=record["targets"]or summary!=record["summary"]:raise InputError("The complete worksheet original bindings differ")
                        _same_file(self._directory_file_path(record["files"]["rows"]),b"".join(jbytes(r)for r in rows),"Original worksheet rows")
                        self._worksheet_envelope(record,rows)
                    elif kind=="correctionWorksheetImports":
                        value=typed("import",json_value(self._directory_file_path(record["files"]["input"]).read_bytes()))
                        worksheet=self.directory_record("correctionWorksheets",value["worksheetId"])
                        if any(record.get(k)!=v for k,v in value.items())or record["editionId"]!=worksheet["editionId"]:
                            raise InputError("The complete worksheet import metadata differs")
                    elif kind=="correctionWorksheetReturns":
                        intake=self.directory_record("correctionWorksheetImports",record["importId"])
                        worksheet=self.directory_record("correctionWorksheets",intake["worksheetId"])
                        original=record["files"]["original"]
                        if intake.get("expectedSha256")is not None and original["sha256"]!=intake["expectedSha256"]:
                            raise InputError("The original returned file differs from its intake digest")
                        if intake.get("expectedBytes")is not None and original["bytes"]!=intake["expectedBytes"]:
                            raise InputError("The original returned file differs from its intake length")
                        value,changes,summary=self._worksheet_compare(worksheet,self._directory_file_path(original).read_bytes())
                        expected={"worksheetId":worksheet["id"],"editionId":worksheet["editionId"],"actor":intake["actor"],
                            "returnedBy":value["returnedBy"],"returnedAt":value["returnedAt"],"note":value["note"],"summary":summary}
                        if any(record.get(k)!=v for k,v in expected.items()):raise InputError("The complete worksheet return description differs")
                        _same_file(self._directory_file_path(record["files"]["changes"]),b"".join(jbytes(c)for c in changes),"Compared customer changes")
                    else:
                        value=typed("review",json_value(self._directory_file_path(record["files"]["input"]).read_bytes()))
                        returned=self.directory_record("correctionWorksheetReturns",value["returnId"])
                        plan_input,decisions,summary=self._worksheet_decisions(returned,value)
                        expected={"label":value["label"],"actor":value["actor"],"note":value["note"],"returnId":returned["id"],
                            "worksheetId":returned["worksheetId"],"editionId":returned["editionId"],"summary":summary,
                            "outcome":"plan-prepared"if plan_input is not None else"no-edits-selected"}
                        if any(record.get(k)!=v for k,v in expected.items()):raise InputError("The full worksheet review differs from its exact chosen changes")
                        _same_file(self._directory_file_path(record["files"]["decisions"]),b"".join(jbytes(c)for c in decisions),"Explicit reviewed changes")
                        if plan_input is None:
                            if record["planId"]is not None:raise InputError("A review accepting no edits cannot create a correction plan")
                        else:
                            plan=self.directory_record("correctionPlans",record["planId"])
                            actual=json_value(self._directory_file_path(plan["files"]["input"]).read_bytes())
                            if actual!=plan_input or any(plan.get(k)!=v for k,v in plan_input.items()):
                                raise InputError("The generated correction plan differs from the explicit customer-change decisions")
            for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind='exports' ORDER BY created,id"):
                record=self.directory_record("exports",ident)
                if record.get("kind")=="correction-worksheet":self._verify_worksheet_packet(record)
            return {"workspaceId":self.workspace_id,"collections":list(KINDS),"verified":True}
