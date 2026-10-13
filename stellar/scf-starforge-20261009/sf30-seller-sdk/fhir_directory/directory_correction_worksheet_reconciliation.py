"""MIT. Explicit three-way reconciliation of retained customer worksheets and current editions."""
from __future__ import annotations
from collections import defaultdict
from pathlib import Path
import hashlib
import zipfile
import directory_index
from directory_runtime import InputError,ConflictError,fhir,original_workspace
from directory_source_schema import sha,jbytes,json_value,lexical_json,MAX_BYTES,MAX_INTERACTIVE
from directory_source import retained_file_descriptors
from directory_corrections_schema import typed as correction_typed,tokens
from directory_corrections import _json_change
from directory_correction_worksheets import _atom,REF_FIELDS
from directory_correction_worksheet_reconciliation_schema import (
    RECONCILIATION_SCHEMA,REVIEW_SCHEMA,PACKET_SCHEMA,KINDS,STATES,DECISIONS,
    MAX_INPUT,MAX_VALUE,MAX_ROWS,MAX_CHANGES,typed,reconciliation_catalogue)
from eltss_runtime import write_zip

def _same(actual,expected,label):
    if (actual!=expected if isinstance(actual,set)or isinstance(expected,set)else jbytes(actual)!=jbytes(expected)):
        raise InputError(label+" differs from its complete retained computation")

def _json_current_atom(value,pointer):
    parts=tokens(pointer)
    if not parts:return _atom(value),None
    parent=value;walk=[]
    for part in parts[:-1]:
        if type(parent)is not dict:return None,"JSON_PARENT_NOT_OBJECT:"+"/".join(walk)
        if part not in parent:return None,"JSON_PARENT_MISSING:"+"/".join(walk+[part])
        parent=parent[part];walk.append(part)
    if type(parent)is not dict:return None,"JSON_PARENT_NOT_OBJECT:"+"/".join(walk)
    key=parts[-1]
    return (_atom(parent[key])if key in parent else _atom(present=False)),None

def _projection(row):
    value={k:row[k]for k in ("table","memberName","pointer","rowOrdinal","nativeId")}
    value.update(ref={k:row[k]for k in REF_FIELDS},representation="csv"if"cells"in row else"json")
    if "cells"in row:
        value.update(cells=list(row["cells"]),headers=list(row["headers"]))
    else:
        value["valueJson"]=row["json"]
        parsed=json_value(row["json"],lexical=True)
        if type(parsed)is not dict:raise InputError("Bind a complete current JSON object")
        if sha(row["json"].encode("utf-8"))!=row["resourceSha256"]:
            raise InputError("The complete current JSON row differs from its retained resource identity")
    return value

class DirectoryWorksheetReconciliation:
    def directory_correction_worksheet_reconciliation_catalogue(self):
        return reconciliation_catalogue()

    def _reconciliation_write_rows(self,scratch,name,rows,role):
        path=Path(scratch)/name;size=0
        with path.open("xb")as output:
            path.chmod(0o600)
            for row in rows:
                raw=jbytes(row);size+=len(raw)
                if size>MAX_BYTES:raise InputError("The complete reconciliation file exceeds256MiB")
                output.write(raw)
        return self._directory_retain_file(path,role)

    def _reconciliation_read_rows(self,record,key):
        rows=[]
        with self._directory_file_path(record["files"][key]).open("rb")as source:
            for raw in source:
                if not raw.endswith(b"\n"):raise InputError("A complete reconciliation row ended before its original boundary")
                rows.append(json_value(raw))
                if len(rows)>MAX_CHANGES:raise InputError("The complete reconciliation row count exceeds10,000")
        return rows

    def _reconciliation_check_rows(self,descriptor,rows,label):
        with self._directory_file_path(descriptor).open("rb")as original:
            for row in rows:
                if original.readline()!=jbytes(row):raise InputError(label+" differs from complete recomputation")
            if original.read(1):raise InputError(label+" contains undeclared extra rows")

    def _reconciliation_return(self,return_id):
        returned=self.directory_record("correctionWorksheetReturns",return_id)
        worksheet=self.directory_record("correctionWorksheets",returned["worksheetId"])
        intake=self.directory_record("correctionWorksheetImports",returned["importId"])
        _same(intake["worksheetId"],worksheet["id"],"Original returned-file intake")
        original=returned["files"]["original"]
        for field,key in (("expectedSha256","sha256"),("expectedBytes","bytes")):
            if intake.get(field)is not None:_same(intake[field],original[key],"Original return "+field)
        candidate,changes,summary=self._worksheet_compare(worksheet,self._directory_file_path(original).read_bytes())
        for key,expected in {"editionId":worksheet["editionId"],"actor":intake["actor"],
                "returnedBy":candidate["returnedBy"],"returnedAt":candidate["returnedAt"],
                "note":candidate["note"],"summary":summary}.items():
            _same(returned.get(key),expected,"Original returned-file "+key)
        self._reconciliation_check_rows(returned["files"]["changes"],changes,"Original returned changes")
        return returned,worksheet,candidate,changes

    def _reconciliation_current_rows(self,value,originals):
        edition=self.directory_record("editions",value["currentEditionId"])
        if value["predecessorId"]is not None:
            predecessor=self.directory_record("corrections",value["predecessorId"])
            if predecessor["editionId"]!=edition["id"]:raise ConflictError("Select the actual accepted predecessor of the current edition")
        bindings={item["rowKey"]:item for item in value["bindings"]}
        if set(bindings)!={row["rowKey"]for row in originals}:
            raise InputError("Explicitly bind every original worksheet row, including omitted and unchanged rows")
        current={};edits=[];current_bytes=0
        with self.directory_open_index("editions",edition["id"])as database:
            for original in originals:
                binding=bindings[original["rowKey"]]
                if binding["original"]!=original["ref"]:
                    raise ConflictError("The exact five-field original binding differs from the selected worksheet row")
                ref=binding["current"]
                if ref is None:
                    current[original["rowKey"]]=None;continue
                if ref["sourceId"]not in edition["sourceIds"]:raise InputError("Bind a current source from this explicitly selected edition")
                row=directory_index.one(database,ref["recordId"],ref["sourceId"])
                if row["protocol"]!="hsds":raise InputError("Bind an actual HSDS current row")
                if {k:row[k]for k in REF_FIELDS}!=ref:
                    raise ConflictError("The exact current row, resource or member identity differs")
                projected=_projection(row);current_bytes+=len(jbytes(projected))
                if current_bytes>MAX_BYTES:raise InputError("The complete explicitly selected current rows exceed256MiB")
                current[original["rowKey"]]=projected
                if projected["representation"]=="json":
                    edit={**ref,"action":"json-set","pointer":"","valueJson":projected["valueJson"]}
                else:edit={**ref,"action":"csv-row","cells":projected["cells"]}
                edits.append({**edit,"reason":"Verify the complete explicit current row binding"})
        # The original correction engine verifies byte-range ancestry and rejects
        # duplicate/ancestor targets before any plan can be created.
        targets=[]
        if edits:
            _,targets=self._correction_targets({"editionId":edition["id"],"predecessorId":value["predecessorId"],"edits":edits})
        return bindings,current,targets

    def _reconciliation_comparison(self,change,original,current,binding,current_json=None):
        value={key:change[key]for key in ("changeId","ordinal","rowKey","representation","action")}
        for key in ("pointer","column"):
            if key in change:value[key]=change[key]
        value.update(originalChange=change,originalRef=original["ref"],
            currentRef=current["ref"]if current is not None else None,
            base=change["before"],proposed=change["after"],current=None,state="unbound",
            blocker="CURRENT_ROW_UNBOUND",bindingReason=binding["reason"],customerReason=change["reason"])
        if current is None:return value
        blocker=None;atom=None
        if current["representation"]!=original["representation"]:
            blocker="ROW_REPRESENTATION_CHANGED"
        elif change["representation"]=="json":
            atom,blocker=_json_current_atom(current_json,change["pointer"])
        else:
            value.update(originalHeaders=original["headers"],currentHeaders=current["headers"],
                originalCellCount=len(original["cells"]),currentCellCount=len(current["cells"]))
            # Full-row proposals are atomic. A current row that already equals
            # their complete proposed cells is a safe no-op, with matching headers.
            if current["headers"]!=original["headers"]:
                blocker="CSV_HEADERS_CHANGED"
            elif change["action"]=="csv-row":
                atom=_atom(current["cells"])
                if atom!=change["after"]and len(current["cells"])!=len(original["cells"]):
                    blocker="CSV_CELL_COUNT_CHANGED"
            elif len(current["cells"])!=len(original["cells"]):
                blocker="CSV_CELL_COUNT_CHANGED"
            else:
                column=change["column"]
                atom=_atom(current["cells"][column])if column<len(current["cells"])else _atom(present=False)
        value["current"]=atom
        value["blocker"]=blocker
        if blocker:value["state"]="structure-conflict"
        elif atom==change["after"]:value["state"]="already-applied"
        elif atom==change["before"]:value["state"]="proposable"
        else:value["state"]="conflict"
        return value

    def _reconciliation_compute(self,value):
        returned,worksheet,candidate,changes=self._reconciliation_return(value["returnId"])
        originals=self._worksheet_file_rows(worksheet,"rows")
        bindings,current,targets=self._reconciliation_current_rows(value,originals)
        proposed={row["rowKey"]:row for row in candidate["candidates"]}
        original_map={row["rowKey"]:row for row in originals}
        by_row=defaultdict(list);comparisons=[];current_json={}
        for change in changes:
            key=change["rowKey"];by_row[key].append(change["changeId"])
            if current[key]is not None and current[key]["representation"]=="json"and key not in current_json:
                current_json[key]=json_value(current[key]["valueJson"],lexical=True)
            comparisons.append(self._reconciliation_comparison(change,original_map[key],current[key],bindings[key],current_json.get(key)))
        rows=[{"rowKey":row["rowKey"],"binding":bindings[row["rowKey"]],"original":row,
            "proposed":proposed.get(row["rowKey"]),"current":current[row["rowKey"]],
            "changeIds":by_row[row["rowKey"]],"state":"bound"if current[row["rowKey"]]is not None else"unbound"}for row in originals]
        counts={state:sum(change["state"]==state for change in comparisons)for state in STATES}
        summary={"rows":len(rows),"boundRows":sum(row["current"]is not None for row in rows),
            "unboundRows":sum(row["current"]is None for row in rows),"changes":len(comparisons),
            "proposable":counts["proposable"],"alreadyApplied":counts["already-applied"],
            "conflicts":counts["conflict"],"structureConflicts":counts["structure-conflict"],
            "unboundChanges":counts["unbound"]}
        return returned,worksheet,targets,rows,comparisons,summary

    def prepare_directory_correction_worksheet_reconciliation(self,raw):
        value=typed("prepare",raw)
        with self.mutex,self.scratch()as scratch:
            returned,worksheet,targets,rows,comparison,summary=self._reconciliation_compute(value)
            files={"input":self._worksheet_write(scratch,"input.json",jbytes(value),"directory-worksheet-reconciliation-input",MAX_INPUT),
                "rows":self._reconciliation_write_rows(scratch,"rows.jsonl",rows,"directory-worksheet-reconciliation-bound-rows"),
                "comparison":self._reconciliation_write_rows(scratch,"comparison.jsonl",comparison,"directory-worksheet-three-way-comparison")}
            return self._directory_store(KINDS[0],{"schema":RECONCILIATION_SCHEMA,"workspaceId":self.workspace_id,
                **value,"worksheetId":worksheet["id"],"baseEditionId":worksheet["editionId"],
                "targets":targets,"summary":summary,"files":files})

    def _reconciliation_decisions(self,record,value):
        changes=self._reconciliation_read_rows(record,"comparison")
        rows={row["rowKey"]:row for row in self._reconciliation_read_rows(record,"rows")}
        choices={choice["changeId"]:choice for choice in value["choices"]}
        if set(choices)!={change["changeId"]for change in changes}or len(choices)!=len(changes):
            raise InputError("Explicitly choose every original three-way change exactly once")
        resolutions={row["rowKey"]:row for row in value["rowResolutions"]}
        grouped=defaultdict(list)
        for change in changes:grouped[change["rowKey"]].append(change)
        for key,resolution in resolutions.items():
            if key not in grouped or rows[key]["current"]is None:
                raise InputError("A complete-row resolution requires actual proposed changes and a bound current row")
            if resolution["representation"]!=rows[key]["current"]["representation"]:
                raise InputError("Resolve the actual current row representation")
            if any(choices[change["changeId"]]["decision"]!="resolve-row"for change in grouped[key]):
                raise InputError("Choose complete-row resolution for every change of that row without mixed granular edits")
        for change in changes:
            decision=choices[change["changeId"]]["decision"]
            if decision=="resolve-row"and change["rowKey"]not in resolutions:
                raise InputError("Supply the complete explicitly authored row resolution")
            if change["state"]=="unbound"and decision!="keep-current":
                raise InputError("An unbound row permits only keeping current; prepare an explicit current binding before edits")
            if change["state"]=="structure-conflict"and decision=="accept-proposed":
                raise InputError("A changed JSON ancestor or CSV physical layout requires keep-current or a complete-row resolution")
        decisions=[];edits=[];resolved=set();working={}
        for change in changes:
            choice=choices[change["changeId"]];key=change["rowKey"];current=rows[key]["current"]
            item={**change,"decision":choice["decision"],"reviewerReason":choice["reason"],"emitsEdit":False}
            if choice["decision"]=="resolve-row":
                resolution=resolutions[key]
                item["resolutionRowKey"]=key
                if key not in resolved:
                    resolved.add(key);item["resolution"]=resolution
                    if current["representation"]=="json":
                        parsed=json_value(resolution["valueJson"],lexical=True)
                        differs=lexical_json(parsed)!=lexical_json(json_value(current["valueJson"],lexical=True))
                        edit={**current["ref"],"action":"json-set","pointer":"","valueJson":resolution["valueJson"],"reason":resolution["reason"]}
                    else:
                        differs=resolution["cells"]!=current["cells"]
                        edit={**current["ref"],"action":"csv-row","cells":resolution["cells"],"reason":resolution["reason"]}
                    if differs:edits.append(edit);item["emitsEdit"]=True
            elif choice["decision"]=="accept-proposed"and change["state"]!="already-applied":
                if current is None or change["state"]not in {"proposable","conflict"}:
                    raise InputError("Accept only an exact applicable current-row proposal")
                edit={**change["originalChange"]["edit"],**current["ref"],"reason":choice["reason"]}
                if current["representation"]=="json":
                    if key not in working:working[key]=json_value(current["valueJson"],lexical=True)
                    replacement=json_value(edit["valueJson"],lexical=True)if edit["action"]=="json-set"else None
                    updated,_,_=_json_change(working[key],edit["pointer"],edit["action"],replacement)
                    working[key]=updated
                edits.append(edit);item["emitsEdit"]=True
            decisions.append(item)
        for content in working.values():
            if len(lexical_json(content).encode("utf-8"))>MAX_VALUE:raise InputError("The complete accepted current JSON row exceeds16MiB")
        plan=None
        if edits:
            plan=correction_typed("prepare",{"label":value["label"],"actor":value["actor"],"note":value["note"],
                "editionId":record["currentEditionId"],"predecessorId":record["predecessorId"],"edits":edits})
            self._correction_targets(plan)
        summary={"changes":len(changes),"acceptedProposals":sum(choice["decision"]=="accept-proposed"for choice in value["choices"]),
            "keptCurrent":sum(choice["decision"]=="keep-current"for choice in value["choices"]),
            "resolvedChanges":sum(choice["decision"]=="resolve-row"for choice in value["choices"]),
            "rowResolutions":len(resolutions),"edits":len(edits)}
        return plan,decisions,summary

    def review_directory_correction_worksheet_reconciliation(self,raw):
        value=typed("review",raw)
        with self.mutex,self.scratch()as scratch:
            record=self.directory_record(KINDS[0],value["reconciliationId"])
            plan_input,decisions,summary=self._reconciliation_decisions(record,value)
            files={"input":self._worksheet_write(scratch,"input.json",jbytes(value),"directory-worksheet-reconciliation-review-input",MAX_INPUT),
                "decisions":self._reconciliation_write_rows(scratch,"decisions.jsonl",decisions,"directory-worksheet-reconciliation-decisions")}
            # Both the existing plan and this review are immutable/content-bound.
            # An interrupted save reuses the original plan on the same input.
            plan=self.prepare_directory_correction(plan_input)if plan_input is not None else None
            return self._directory_store(KINDS[1],{"schema":REVIEW_SCHEMA,"workspaceId":self.workspace_id,
                "label":value["label"],"actor":value["actor"],"note":value["note"],"reconciliationId":record["id"],
                **{key:record[key]for key in ("returnId","worksheetId","baseEditionId","currentEditionId","predecessorId")},
                "planId":plan["id"]if plan else None,"outcome":"plan-prepared"if plan else"no-edits-selected",
                "summary":summary,"files":files})

    def directory_correction_worksheet_reconciliation_rows(self,kind,ident,offset=0,limit=50,row_key=None,state=None):
        if kind not in KINDS:raise InputError("Select a complete retained reconciliation collection")
        fhir.integer(offset,0,10000000,"Reconciliation row offset");fhir.integer(limit,1,250,"Reconciliation page size")
        if row_key is not None:fhir.identity(row_key)
        if state is not None and state not in set(STATES)|set(DECISIONS):raise InputError("Select an exact comparison state or review decision")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident));key="comparison"if kind==KINDS[0]else"decisions"
            selected=[];total=0;used=0;full=False
            with self._directory_file_path(record["files"][key]).open("rb")as stream:
                for raw in stream:
                    if not raw.endswith(b"\n"):raise InputError("Complete reconciliation row boundary differs")
                    row=json_value(raw)
                    if row_key is not None and row["rowKey"]!=row_key:continue
                    if state is not None and state not in {row["state"],row.get("decision")}:continue
                    position=total;total+=1
                    if position<offset or full:continue
                    if len(raw)>MAX_INTERACTIVE:
                        if selected:full=True;continue
                        raise InputError("Read the complete "+key+" file for this row larger than4MiB")
                    if len(selected)>=limit or used+len(raw)>MAX_INTERACTIVE:full=True;continue
                    selected.append(row);used+=len(raw)
            return {"kind":kind,"recordId":ident,"rows":selected,"total":total,"offset":offset,"limit":limit,
                "nextOffset":offset+len(selected)if offset+len(selected)<total else None,"bytes":used,"byteBudget":MAX_INTERACTIVE}

    def directory_correction_worksheet_reconciliation_file(self,kind,ident,file_kind="comparison"):
        if kind not in KINDS:raise InputError("Select a complete retained reconciliation collection")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident))
            if file_kind not in record["files"]:raise InputError("Select an exact complete reconciliation file")
            file=record["files"][file_kind];suffix=".json"if file_kind=="input"else".jsonl"
            return self._directory_file_path(file),{**file,"name":"Directory_Worksheet_Reconciliation_"+ident+"_"+file_kind+suffix,
                "contentType":"application/json"if suffix==".json"else"application/x-ndjson"}

    def _reconciliation_graph(self,record,review=None):
        kinds=("correctionWorksheetReconciliations","correctionWorksheetReconciliationReviews",
            "correctionWorksheets","correctionWorksheetImports","correctionWorksheetReturns",
            "correctionPlans","correctionPreviews","corrections","editions","sources","comparisons")
        records={kind:{}for kind in kinds}
        def put(kind,value):records[kind][value["id"]]=value
        put(KINDS[0],record)
        returned=self.directory_record("correctionWorksheetReturns",record["returnId"])
        worksheet=self.directory_record("correctionWorksheets",record["worksheetId"])
        put("correctionWorksheetReturns",returned);put("correctionWorksheets",worksheet)
        put("correctionWorksheetImports",self.directory_record("correctionWorksheetImports",returned["importId"]))
        if review is not None:
            if review["reconciliationId"]!=record["id"]:raise ConflictError("Export the review of this exact reconciliation")
            put(KINDS[1],review)
            if review["planId"]is not None:put("correctionPlans",self.directory_record("correctionPlans",review["planId"]))
        for predecessor in (record["predecessorId"],worksheet["predecessorId"]):
            if predecessor is not None:
                for kind,values in self._correction_graph(self.directory_record("corrections",predecessor)).items():
                    for value in values:put(kind,value)
        pending=[record["baseEditionId"],record["currentEditionId"]]
        pending.extend(plan["editionId"]for plan in records["correctionPlans"].values())
        visited=set()
        while pending:
            ident=pending.pop()
            if ident in visited:continue
            visited.add(ident)
            edition=self.directory_record("editions",ident);put("editions",edition)
            for source_id in edition["sourceIds"]:put("sources",self.directory_source(source_id))
            if edition.get("predecessorId"):pending.append(edition["predecessorId"])
        for edition in list(records["editions"].values()):
            for source_id in edition["sourceIds"]:put("sources",self.directory_source(source_id))
        return {kind:[values[key]for key in sorted(values)]for kind,values in records.items()}

    def _reconciliation_export_members(self,record,review):
        records=self._reconciliation_graph(record,review)
        data={"workspaceId":self.workspace_id,"reconciliationId":record["id"],
            "reviewId":review["id"]if review else None,"records":records}
        members={"records.json":jbytes(data),"README.md":(
            "Directory returned worksheet reconciliation\n\n"
            "records.json preserves the complete original worksheet, returned file, explicit current-edition "
            "row bindings, typed three-way comparison and selected review. Every original retained source "
            "and comparison/review file is present under files/<sha256>.bin. An unresolved binding is not "
            "an absent value. Structural JSON/CSV conflicts require keeping current or an explicitly authored "
            "complete current-row resolution. Customer reasons and operator reasons remain separate.\n\n"
            "A review may prepare an ordinary correction plan against the explicitly selected current edition. "
            "Preview and acceptance remain separate original operations; this package does not claim that "
            "a prepared plan was accepted. The complete editable workspace is a separate native export.\n").encode("utf-8")}
        files=retained_file_descriptors(records)
        for file in files:members["files/"+file["sha256"]+".bin"]=self._directory_file_path(file)
        declarations=[]
        for name,item in sorted(members.items()):
            size=len(item)if isinstance(item,bytes)else item.stat().st_size
            digest=sha(item)if isinstance(item,bytes)else original_workspace.file_digest(item,MAX_BYTES)
            declarations.append({"name":name,"bytes":size,"sha256":digest})
        return records,files,members,declarations

    def export_directory_correction_worksheet_reconciliation(self,raw):
        value=typed("export",raw)
        with self.mutex,self.scratch()as scratch:
            record=self.directory_record(KINDS[0],value["reconciliationId"])
            review=self.directory_record(KINDS[1],value["reviewId"])if value["reviewId"]is not None else None
            records,files,members,declarations=self._reconciliation_export_members(record,review)
            label=value.get("label")or record["label"]
            manifest={"schema":PACKET_SCHEMA,"workspaceId":self.workspace_id,"reconciliationId":record["id"],
                "reviewId":value["reviewId"],"baseEditionId":record["baseEditionId"],"currentEditionId":record["currentEditionId"],
                "label":label,"actor":value["actor"],"note":value["note"],"exportInput":value,
                "files":files,"members":declarations,"recordCounts":{kind:len(rows)for kind,rows in records.items()},
                "recordsSha256":sha(members["records.json"])}
            members["manifest.json"]=jbytes(manifest)
            if sum(row["bytes"]for row in declarations)+len(members["manifest.json"])>MAX_BYTES:
                raise InputError("The complete original reconciliation package exceeds256MiB")
            path=Path(scratch)/"reconciliation.zip";write_zip(path,members)
            file=self._directory_retain_file(path,"directory-complete-worksheet-reconciliation")
            return self._directory_store("exports",{"label":label,"kind":"correction-worksheet-reconciliation",
                "recordId":record["id"],"reviewId":value["reviewId"],
                "name":"Directory_Worksheet_Reconciliation_"+record["id"]+".zip",
                "contentType":"application/zip","file":file,"actor":value["actor"],"note":value["note"],"exportInput":value})

    def _verify_worksheet_reconciliation_packet(self,exported):
        value=typed("export",exported["exportInput"])
        _same(value,exported["exportInput"],"Complete reconciliation export input")
        record=self.directory_record(KINDS[0],value["reconciliationId"])
        review=self.directory_record(KINDS[1],value["reviewId"])if value["reviewId"]is not None else None
        records,files,members,declarations=self._reconciliation_export_members(record,review)
        label=value.get("label")or record["label"]
        expected={"label":label,"kind":"correction-worksheet-reconciliation","recordId":record["id"],
            "reviewId":value["reviewId"],"name":"Directory_Worksheet_Reconciliation_"+record["id"]+".zip",
            "contentType":"application/zip","actor":value["actor"],"note":value["note"],"exportInput":value}
        _same({k:v for k,v in exported.items()if k not in {"id","createdAt","file"}},expected,"Complete reconciliation export record")
        manifest={"schema":PACKET_SCHEMA,"workspaceId":self.workspace_id,"reconciliationId":record["id"],
            "reviewId":value["reviewId"],"baseEditionId":record["baseEditionId"],"currentEditionId":record["currentEditionId"],
            "label":label,"actor":value["actor"],"note":value["note"],"exportInput":value,
            "files":files,"members":declarations,"recordCounts":{kind:len(rows)for kind,rows in records.items()},
            "recordsSha256":sha(members["records.json"])}
        members["manifest.json"]=jbytes(manifest)
        with zipfile.ZipFile(self._directory_file_path(exported["file"]))as archive:
            entries=archive.infolist()
            if len(entries)!=len(members)or {entry.filename for entry in entries}!=set(members):
                raise InputError("The reconciliation package has missing, duplicate or additional members")
            if sum(entry.file_size for entry in entries)>MAX_BYTES:
                raise InputError("The complete reconciliation package exceeds its supported extent")
            for name,expected_file in members.items():
                size=len(expected_file)if isinstance(expected_file,bytes)else expected_file.stat().st_size
                digest=sha(expected_file)if isinstance(expected_file,bytes)else original_workspace.file_digest(expected_file,MAX_BYTES)
                if archive.getinfo(name).file_size!=size:raise InputError("A complete reconciliation member length differs")
                actual=hashlib.sha256();count=0
                with archive.open(name)as stream:
                    while block:=stream.read(65536):
                        count+=len(block)
                        if count>size:raise InputError("A reconciliation member exceeds its original byte extent")
                        actual.update(block)
                if count!=size or actual.hexdigest()!=digest:
                    raise InputError("A complete reconciliation member differs from its original retained source graph")
        return {"workspaceId":self.workspace_id,"reconciliationId":record["id"],"reviewId":value["reviewId"],
            "members":len(members),"verified":True}

    def _verify_directory_correction_worksheet_reconciliations(self):
        with self.mutex:
            for kind in KINDS:
                for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind=? ORDER BY created,id",(kind,)):
                    record=self.directory_record(kind,ident)
                    expected_schema=RECONCILIATION_SCHEMA if kind==KINDS[0]else REVIEW_SCHEMA
                    if record.get("schema")!=expected_schema or record.get("workspaceId")!=self.workspace_id:
                        raise InputError("The received reconciliation names another schema or workspace")
                    for file in retained_file_descriptors(record):self._directory_file_path(file)
                    action="prepare"if kind==KINDS[0]else"review"
                    value=typed(action,json_value(self._directory_file_path(record["files"]["input"]).read_bytes()))
                    if kind==KINDS[0]:
                        returned,worksheet,targets,rows,comparison,summary=self._reconciliation_compute(value)
                        expected={"schema":RECONCILIATION_SCHEMA,"workspaceId":self.workspace_id,**value,
                            "worksheetId":worksheet["id"],"baseEditionId":worksheet["editionId"],"targets":targets,"summary":summary}
                        _same(set(record["files"]),{"input","rows","comparison"},"Complete reconciliation file kinds")
                        self._reconciliation_check_rows(record["files"]["rows"],rows,"Complete original/current binding rows")
                        self._reconciliation_check_rows(record["files"]["comparison"],comparison,"Complete three-way comparison")
                    else:
                        prepared=self.directory_record(KINDS[0],value["reconciliationId"])
                        plan_input,decisions,summary=self._reconciliation_decisions(prepared,value)
                        expected={"schema":REVIEW_SCHEMA,"workspaceId":self.workspace_id,"label":value["label"],
                            "actor":value["actor"],"note":value["note"],"reconciliationId":prepared["id"],
                            **{key:prepared[key]for key in ("returnId","worksheetId","baseEditionId","currentEditionId","predecessorId")},
                            "planId":record["planId"],"outcome":"plan-prepared"if plan_input is not None else"no-edits-selected",
                            "summary":summary}
                        _same(set(record["files"]),{"input","decisions"},"Complete reconciliation review file kinds")
                        self._reconciliation_check_rows(record["files"]["decisions"],decisions,"Complete explicit reconciliation decisions")
                        if plan_input is None:
                            if record["planId"]is not None:raise InputError("A review with no current-row edits cannot create a plan")
                        else:
                            plan=self.directory_record("correctionPlans",record["planId"])
                            actual=json_value(self._directory_file_path(plan["files"]["input"]).read_bytes())
                            _same(actual,plan_input,"Original current-edition correction plan input")
                            _same({key:plan[key]for key in plan_input},plan_input,"Original current-edition correction plan fields")
                    _same({key:item for key,item in record.items()if key not in {"id","createdAt","files"}},expected,
                        "Complete received reconciliation record")
            for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind='exports' ORDER BY created,id"):
                record=self.directory_record("exports",ident)
                if record.get("kind")=="correction-worksheet-reconciliation":self._verify_worksheet_reconciliation_packet(record)
            return {"workspaceId":self.workspace_id,"collections":list(KINDS),"verified":True}
