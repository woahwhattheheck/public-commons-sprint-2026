"""MIT. Original-byte HSDS correction workbench, derived editions and full receiving."""
from __future__ import annotations
from collections import defaultdict
import csv
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import hashlib
import zipfile
from directory_runtime import InputError, ConflictError, fhir, original_workspace
from directory_source_schema import (MAX_BYTES,MAX_RECORD,MAX_INTERACTIVE,CAPTURE_SCHEMA,
    sha,jbytes,json_value,lexical_json,descriptor_ref)
from directory_source import retained_file_descriptors
from directory_corrections_schema import (PLAN_SCHEMA,PREVIEW_SCHEMA,CORRECTION_SCHEMA,
    PACKET_SCHEMA,KINDS,typed,tokens,path_at,correction_catalogue)
from eltss_runtime import write_zip

def _copy(value):
    return json_value(lexical_json(value),lexical=True)

def _plain(value):
    return json_value(jbytes(value))

def _present(value):
    return {"present":True,"valueJson":lexical_json(value)}

def _json_change(value,pointer,action,replacement=None):
    parts=tokens(pointer)
    if not parts:
        if action!="json-set":raise InputError("Keep the selected complete original row")
        return replacement,_present(value),_present(replacement)
    parent=path_at(value,parts[:-1]);key=parts[-1]
    if isinstance(parent,dict):
        before=_present(parent[key])if key in parent else {"present":False}
        if action=="json-remove":
            if key not in parent:raise InputError("The reviewed JSON field to remove is already absent")
            del parent[key];after={"present":False}
        else:parent[key]=replacement;after=_present(replacement)
    elif isinstance(parent,list):
        if key=="-"and action=="json-set":position=len(parent)
        elif re.fullmatch(r"0|[1-9][0-9]*",key):position=int(key)
        else:raise InputError("Use an exact existing array index or '-' to append explicitly")
        if position>len(parent)or action=="json-remove"and position>=len(parent):
            raise InputError("The reviewed array position is absent")
        before=_present(parent[position])if position<len(parent)else {"present":False}
        if action=="json-remove":del parent[position];after={"present":False}
        elif position==len(parent):parent.append(replacement);after=_present(replacement)
        else:parent[position]=replacement;after=_present(replacement)
    else:raise InputError("A correction pointer crosses a scalar value")
    return value,before,after

def _write(path,raw):
    if len(raw)>MAX_BYTES:raise InputError("Complete authored file exceeds256MiB")
    original_workspace.private_write(path,raw)
    return path

def _replace_ranges(original,destination,patches):
    position=0;written=0
    with Path(original).open("rb")as inp,os.fdopen(os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb")as out:
        for start,end,expected,replacement in sorted(patches):
            if start<position or end<start:raise InputError("Authored original byte ranges overlap")
            remaining=start-position
            while remaining:
                block=inp.read(min(65536,remaining))
                if not block:raise InputError("Original member ended before its retained row")
                out.write(block);written+=len(block);remaining-=len(block)
            raw=inp.read(end-start)
            if len(raw)!=end-start or sha(raw)!=expected:raise InputError("Original row bytes differ from the selected predecessor")
            with Path(replacement).open("rb")as revised:
                while block:=revised.read(65536):
                    written+=len(block)
                    if written>MAX_BYTES:raise InputError("Derived complete member exceeds256MiB")
                    out.write(block)
            position=end
        while block:=inp.read(65536):
            written+=len(block)
            if written>MAX_BYTES:raise InputError("Derived complete member exceeds256MiB")
            out.write(block)
        out.flush();os.fsync(out.fileno())

class DirectoryCorrections:
    def directory_correction_catalogue(self):
        return correction_catalogue()

    def _correction_json_file(self,scratch,name,value,role):
        path=Path(scratch)/name
        _write(path,jbytes(value))
        return self._directory_retain_file(path,role)

    def _correction_targets(self,value):
        edition=self.directory_record("editions",value["editionId"])
        if value.get("predecessorId"):
            earlier=self.directory_record("corrections",value["predecessorId"])
            if earlier["editionId"]!=edition["id"]:
                raise ConflictError("The correction successor must start from its exact accepted predecessor edition")
        unique={};paths=defaultdict(list)
        for edit in value["edits"]:
            key=(edit["sourceId"],edit["recordId"])
            if edit["sourceId"]not in edition["sourceIds"]:raise InputError("Select a row from this exact frozen edition")
            row=self.directory_edition_row(edition["id"],*key)
            if row["protocol"]!="hsds":raise InputError("This workbench corrects explicitly selected HSDS rows")
            for name in ("rowSha256","resourceSha256","memberSha256"):
                if row[name]!=edit[name]:raise ConflictError("The selected original "+name+" differs")
            is_csv="cells"in row
            if is_csv!=(edit["action"].startswith("csv-")):
                raise InputError("Use physical cell edits for CSV and lexical JSON edits for JSON rows")
            if edit["action"]=="csv-cell"and edit["column"]>=max(len(row["headers"]),len(row["cells"])):
                raise InputError("Choose an original physical column; use complete row replacement for explicit new cells")
            if key in unique:continue
            root=row;seen=set()
            while root.get("rawRange")is None:
                if not root.get("parentRecordId")or root["recordId"]in seen or len(seen)>128:
                    raise InputError("The selected JSON row lacks an original complete byte-range ancestor")
                seen.add(root["recordId"])
                root=self.directory_source_row(key[0],root["parentRecordId"])
            span=root["rawRange"]
            if not isinstance(span,list)or len(span)!=2 or any(type(n)is not int for n in span)or not 0<=span[0]<span[1]<=MAX_BYTES:
                raise InputError("The original selected row byte range is invalid")
            if span[1]-span[0]>MAX_RECORD:raise InputError("One original complete correction row exceeds16MiB")
            root_path=tokens(root["pointer"]);row_path=tokens(row["pointer"])
            if row_path[:len(root_path)]!=root_path:raise InputError("The selected descendant has another original parent")
            target={"sourceId":key[0],"recordId":key[1],"originalRow":descriptor_ref(row,key[0]),
                "memberName":row["memberName"],"pointer":row["pointer"],"table":row["table"],
                "rootRecordId":root["recordId"],"rootPointer":root["pointer"],"rawRange":span,
                "rootRowSha256":root["rowSha256"],"rootResourceSha256":root["resourceSha256"],
                "representation":"csv"if is_csv else"json"}
            unique[key]=target;paths[(key[0],row["memberName"])].append((tuple(row_path),key[1]))
        for group in paths.values():
            ordered=sorted(group)
            for (before,bid),(after,aid)in zip(ordered,ordered[1:]):
                if bid!=aid and after[:len(before)]==before:
                    raise InputError("Review an ancestor and its descendants in separate correction editions")
        return edition,[unique[key]for key in sorted(unique)]

    def prepare_directory_correction(self,raw):
        value=typed("prepare",raw)
        with self.mutex:
            edition,targets=self._correction_targets(value)
            with self.scratch()as scratch:
                file=self._correction_json_file(scratch,"input.json",value,"directory-correction-input")
            return self._directory_store("correctionPlans",{"schema":PLAN_SCHEMA,"workspaceId":self.workspace_id,
                **value,"targets":targets,"files":{"input":file},"summary":{"edits":len(value["edits"]),
                "rows":len(targets),"sources":len({r["sourceId"]for r in targets})}})

    def _correction_root(self,plan,source_id,root_id,selected,scratch,changes,serial):
        source=self.directory_source(source_id)
        root=self.directory_source_row(source_id,root_id)
        member_path,member=self.directory_source_file(source_id,root["memberName"])
        start,end=root["rawRange"]
        with member_path.open("rb")as stream:stream.seek(start);original=stream.read(end-start)
        if len(original)!=end-start or sha(original)!=root["rowSha256"]:
            raise ConflictError("The complete original row no longer matches its retained hash")
        csv_input="cells"in root
        if csv_input:working=list(root["cells"])
        else:
            working=json_value(original,lexical=True)
            if sha(lexical_json(working).encode())!=root["resourceSha256"]:
                raise InputError("Original JSON range and complete indexed value disagree")
        root_tokens=tokens(root["pointer"])
        for ordinal,edit,target in selected:
            context={"ordinal":ordinal,"edit":edit,"originalRow":target["originalRow"],
                "memberName":target["memberName"],"rootRecordId":root_id}
            if csv_input:
                if edit["action"]=="csv-row":
                    before=_present(working);working=list(edit["cells"]);after=_present(working)
                else:
                    column=edit["column"];before=_present(working[column])if column<len(working)else{"present":False}
                    while len(working)<=column:working.append("")
                    working[column]=edit["value"];after=_present(working[column])
                context.update(headers=root["headers"],before=before,after=after)
            else:
                relative=tokens(target["pointer"])[len(root_tokens):]
                subject=path_at(working,relative)
                replacement=json_value(edit["valueJson"],lexical=True)if edit["action"]=="json-set"else None
                revised,before,after=_json_change(subject,edit["pointer"],edit["action"],replacement)
                if relative:
                    parent=path_at(working,relative[:-1]);last=relative[-1]
                    if isinstance(parent,list):parent[int(last)]=revised
                    else:parent[last]=revised
                else:working=revised
                context.update(before=before,after=after)
            body=jbytes(context)
            changes.execute("INSERT INTO changes VALUES(?,?)",(ordinal,body.decode()))
        if csv_input:
            document=next((d for d in source["documents"]if d["name"]==root["memberName"]),None)
            if not document or document["selection"]["format"]!="hsds-csv":
                raise InputError("Keep the complete original CSV interpretation")
            selection=document["selection"];encoding=selection.get("encoding","utf-8-sig")
            newline="\r\n"if original.endswith(b"\r\n")else"\n"if original.endswith(b"\n")else"\r"if original.endswith(b"\r")else""
            buffer=io.StringIO(newline="");writer=csv.writer(buffer,delimiter=selection.get("delimiter",","),lineterminator="\r\n")
            writer.writerow(working);text=buffer.getvalue()[:-2]+newline
            try:revised=text.encode("utf-8"if encoding=="utf-8-sig"else encoding)
            except UnicodeError as error:raise InputError("The authored cells do not fit the selected original CSV encoding")from error
        else:revised=lexical_json(working).encode("utf-8")
        if len(revised)>MAX_RECORD:raise InputError("One complete corrected row exceeds16MiB")
        path=Path(scratch)/("row-"+str(serial)+".bin");_write(path,revised)
        return root["memberName"],(start,end,root["rowSha256"],path)

    def _correction_source(self,plan,source_id,groups,scratch,changes,serial,verify_pair=None):
        source=self.directory_source(source_id);patches=defaultdict(list)
        for root_id,selected in groups.items():
            serial+=1
            name,patch=self._correction_root(plan,source_id,root_id,selected,scratch,changes,serial)
            patches[name].append(patch)
        files={};declarations=[];changed=[]
        for member in source["members"]:
            path=self._file_path(member["file"]);old_file=member["file"]
            if member["name"]in patches:
                serial+=1;derived=Path(scratch)/("member-"+str(serial)+".bin")
                _replace_ranges(path,derived,patches[member["name"]])
                new_file={"sha256":original_workspace.file_digest(derived,MAX_BYTES),"bytes":derived.stat().st_size,"role":"directory-corrected-member"}
                changed.append({"name":member["name"],"originalFile":old_file,"derivedFile":new_file,
                    "ranges":[{"start":p[0],"end":p[1],"originalSha256":p[2]}for p in sorted(patches[member["name"]])]})
                path=derived
            else:new_file=old_file
            name="source/"+member["name"];files[name]=path
            declarations.append({"name":name,**{k:new_file[k]for k in ("bytes","sha256","role")}})
        files["correction/input.json"]=self._directory_file_path(plan["files"]["input"])
        declarations.append({"name":"correction/input.json",**plan["files"]["input"]})
        documents=[{"name":"source/"+d["name"],"selection":d["selection"]}for d in source["documents"]]
        manifest={"schema":CAPTURE_SCHEMA,"workspaceId":self.workspace_id,"operationId":"correction-"+plan["id"],
            "requestId":plan["id"],"requestSha256":plan["files"]["input"]["sha256"],
            "state":"complete","complete":True,"scope":source["scope"],"pageCount":len(documents),
            "documents":documents,"files":declarations,"authoredCorrection":{"planId":plan["id"],"actor":plan["actor"],
            "originalSourceId":source_id,"originalFile":source["originalFile"],"changedMembers":changed}}
        files["manifest.json"]=jbytes(manifest)
        expanded=sum(len(v)if isinstance(v,bytes)else Path(v).stat().st_size for v in files.values())
        if expanded>MAX_BYTES:raise InputError("Complete corrected source exceeds the original256MiB intake budget")
        if verify_pair is not None:
            derived=self.directory_source(verify_pair["derivedSourceId"])
            if verify_pair["originalFile"]!=source["originalFile"]or verify_pair["changedMembers"]!=changed:
                raise InputError("The received authored member changes differ from the original ordered edits")
            expected_names=set(files)
            actual_path=self._directory_file_path(derived["originalFile"])
            with zipfile.ZipFile(actual_path)as archive:
                names=archive.namelist()
                if len(names)!=len(expected_names)or set(names)!=expected_names:
                    raise InputError("The complete corrected source member selection changed")
                for name,expected in files.items():
                    expected_bytes=len(expected)if isinstance(expected,bytes)else Path(expected).stat().st_size
                    expected_sha=sha(expected)if isinstance(expected,bytes)else original_workspace.file_digest(expected,MAX_BYTES)
                    if archive.getinfo(name).file_size!=expected_bytes:raise InputError("Corrected source member byte count differs")
                    digest=hashlib.sha256();count=0
                    with archive.open(name)as stream:
                        while block:=stream.read(65536):
                            count+=len(block)
                            if count>expected_bytes:raise InputError("Corrected source member exceeds its exact original extent")
                            digest.update(block)
                    if count!=expected_bytes or digest.hexdigest()!=expected_sha:
                        raise InputError("The received corrected source differs from replaying its actual original edits")
            if [(d["name"],d["selection"])for d in derived["documents"]]!=[(d["name"],d["selection"])for d in documents]:
                raise InputError("The complete corrected source interpretation changed")
            return verify_pair,serial
        serial+=1;packet=Path(scratch)/("corrected-source-"+str(serial)+".zip");write_zip(packet,files)
        derived=self.directory_import(packet,{"label":plan["label"][:400]+" — corrected source","format":"directory-capture",
            "origin":"operator_source","scope":source["scope"],"referenceBase":source.get("referenceBase"),
            "publisher":source["publisher"],"note":"Authored correction "+plan["id"]+" of original source "+source_id+"; original bytes retained."})
        return {"sourceId":source_id,"derivedSourceId":derived["id"],"originalFile":source["originalFile"],
            "derivedFile":derived["originalFile"],"indexFile":derived["indexFile"],"changedMembers":changed},serial

    def preview_directory_correction(self,raw):
        value=typed("preview",raw)
        with self.mutex:
            plan=self.directory_record("correctionPlans",value["planId"])
            edition,targets=self._correction_targets(plan)
            if targets!=plan["targets"]:raise ConflictError("The correction plan's original source binding changed")
            # One immutable preview per complete plan. Reuse it after interrupted delivery.
            for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind='correctionPreviews' ORDER BY created,id"):
                previous=self.directory_record("correctionPreviews",ident)
                if previous["planId"]==plan["id"]:return previous
            selected={(t["sourceId"],t["recordId"]):t for t in targets};groups=defaultdict(lambda:defaultdict(list))
            for ordinal,edit in enumerate(plan["edits"],1):
                target=selected[(edit["sourceId"],edit["recordId"])]
                groups[edit["sourceId"]][target["rootRecordId"]].append((ordinal,edit,target))
            with self.scratch()as scratch:
                scratch=Path(scratch);database=scratch/"changes.sqlite"
                changes=sqlite3.connect(database);database.chmod(0o600)
                changes.execute("PRAGMA journal_mode=OFF");changes.execute("PRAGMA temp_store=FILE")
                changes.execute("CREATE TABLE changes(ordinal INTEGER PRIMARY KEY,body TEXT NOT NULL)")
                sources=[];serial=0
                try:
                    for source_id in edition["sourceIds"]:
                        if source_id in groups:
                            result,serial=self._correction_source(plan,source_id,groups[source_id],scratch,changes,serial)
                            sources.append(result)
                    changes.commit();change_path=scratch/"changes.jsonl";size=0
                    with os.fdopen(os.open(change_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb")as out:
                        for(body,)in changes.execute("SELECT body FROM changes ORDER BY ordinal"):
                            encoded=body.encode();size+=len(encoded)
                            if size>MAX_BYTES:raise InputError("Complete ordered correction history exceeds256MiB")
                            out.write(encoded)
                        out.flush();os.fsync(out.fileno())
                finally:changes.close()
                replacements={r["sourceId"]:r["derivedSourceId"]for r in sources}
                candidate=self.directory_edition({"label":plan["label"][:450],"sourceIds":[replacements.get(i,i)for i in edition["sourceIds"]],
                    "predecessorId":edition["id"],"tables":edition["tables"],"scope":edition["scope"],
                    "actor":plan["actor"],"note":"Authored correction plan "+plan["id"]})
                comparison=self.directory_compare({"label":plan["label"][:450]+" comparison","beforeEditionId":edition["id"],
                    "afterEditionId":candidate["id"],"actor":plan["actor"],"note":"Complete source-preserving correction preview "+plan["id"]})
                change_file=self._directory_retain_file(change_path,"directory-correction-changes")
                review={"schema":PREVIEW_SCHEMA,"workspaceId":self.workspace_id,"plan":plan,"beforeEdition":edition,
                    "candidateEdition":candidate,"comparison":comparison,"sources":sources,"changesFile":change_file}
                review_file=self._correction_json_file(scratch,"review.json",review,"directory-correction-preview-review")
            return self._directory_store("correctionPreviews",{"schema":PREVIEW_SCHEMA,"workspaceId":self.workspace_id,
                "planId":plan["id"],"editionId":edition["id"],"candidateEditionId":candidate["id"],
                "comparisonId":comparison["id"],"label":plan["label"],"actor":plan["actor"],"sources":sources,
                "files":{"changes":change_file,"review":review_file},"summary":{**plan["summary"],
                "beforeInventory":edition["inventory"],"candidateInventory":candidate["inventory"],
                "comparison":comparison["summary"]}})

    def apply_directory_correction(self,raw):
        value=typed("apply",raw)
        with self.mutex:
            preview=self.directory_record("correctionPreviews",value["previewId"])
            plan=self.directory_record("correctionPlans",preview["planId"])
            if value["expectedEditionId"]!=preview["editionId"]or plan["editionId"]!=preview["editionId"]:
                raise ConflictError("Explicitly accept the preview from the selected original edition")
            candidate=self.directory_record("editions",preview["candidateEditionId"])
            if candidate["predecessorId"]!=value["expectedEditionId"]:
                raise ConflictError("The corrected candidate changed its original edition predecessor")
            result={"schema":CORRECTION_SCHEMA,"workspaceId":self.workspace_id,"stage":"accepted",
                **value,"label":plan["label"],"planId":plan["id"],"editionId":candidate["id"],
                "beforeEditionId":preview["editionId"],"comparisonId":preview["comparisonId"],
                "predecessorId":plan.get("predecessorId"),"sources":preview["sources"],"summary":preview["summary"]}
            with self.scratch()as scratch:
                file=self._correction_json_file(scratch,"accepted-review.json",{"acceptance":result,"plan":plan,"preview":preview,
                    "acceptedEdition":candidate,"comparison":self.directory_record("comparisons",preview["comparisonId"])},
                    "directory-correction-accepted-review")
            result["files"]={"changes":preview["files"]["changes"],"review":file}
            return self._directory_store("corrections",result)

    def directory_correction_rows(self,kind,ident,offset=0,limit=50):
        if kind not in KINDS:raise InputError("Select a retained correction collection")
        fhir.integer(offset,0,10000000,"Correction row offset");fhir.integer(limit,1,250,"Correction page size")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident))
            if kind=="correctionPlans":
                rows=[{"ordinal":i+1,"edit":edit}for i,edit in enumerate(record["edits"])]
                page=self._directory_rows_page(rows,offset,limit)
            else:
                path=self._directory_file_path(record["files"]["changes"]);selected=[];used=0;total=0;full=False
                with path.open("rb")as stream:
                    for raw in stream:
                        total+=1
                        if total<=offset or full:continue
                        if len(raw)>MAX_INTERACTIVE:
                            if selected:full=True;continue
                            raise InputError("Receive the complete changes file for this original row larger than4MiB")
                        if len(selected)>=limit or used+len(raw)>MAX_INTERACTIVE:full=True;continue
                        row=json_value(raw)
                        if row.get("ordinal")!=total:raise InputError("The complete ordered correction history has a missing row")
                        selected.append(row);used+=len(raw)
                page={"rows":selected,"total":total,"offset":offset,"limit":limit,
                    "nextOffset":offset+len(selected)if offset+len(selected)<total else None,"bytes":used,"byteBudget":MAX_INTERACTIVE}
            return {"kind":kind,"recordId":ident,**page}

    def directory_correction_file(self,kind,ident,file_kind="changes"):
        if kind not in KINDS:raise InputError("Select a retained correction collection")
        with self.mutex:
            record=self.directory_record(kind,fhir.identity(ident))
            if file_kind not in record["files"]:raise InputError("Select an exact complete correction file")
            file=record["files"][file_kind];suffix=".jsonl"if file_kind=="changes"else".json"
            return self._directory_file_path(file),{**file,"name":"directory-correction-"+ident+"-"+file_kind+suffix,
                "contentType":"application/x-ndjson"if file_kind=="changes"else"application/json"}

    def _correction_graph(self,correction):
        records={kind:{}for kind in ("correctionPlans","correctionPreviews","corrections","editions","sources","comparisons")}
        pending=[("corrections",correction["id"])]
        while pending:
            kind,ident=pending.pop()
            if ident in records[kind]:continue
            value=self.directory_record(kind,ident);records[kind][ident]=value
            if kind=="corrections":
                pending.extend([("correctionPlans",value["planId"]),("correctionPreviews",value["previewId"])])
                if value.get("predecessorId"):pending.append(("corrections",value["predecessorId"]))
            elif kind=="correctionPreviews":
                pending.extend([("correctionPlans",value["planId"]),("editions",value["editionId"]),
                    ("editions",value["candidateEditionId"]),("comparisons",value["comparisonId"])])
            elif kind=="correctionPlans":pending.append(("editions",value["editionId"]))
            elif kind=="editions":
                pending.extend(("sources",ident)for ident in value["sourceIds"])
                if value.get("predecessorId"):pending.append(("editions",value["predecessorId"]))
            elif kind=="comparisons":
                pending.extend([("editions",value["beforeEditionId"]),("editions",value["afterEditionId"])])
        return {kind:[values[key]for key in sorted(values)]for kind,values in records.items()}

    def export_directory_correction(self,raw):
        value=typed("export",raw)
        with self.mutex,self.scratch()as scratch:
            correction=self.directory_record("corrections",value["correctionId"])
            records=self._correction_graph(correction)
            members={"records.json":jbytes({"workspaceId":self.workspace_id,"records":records})}
            files=retained_file_descriptors(records)
            for file in files:members["files/"+file["sha256"]+".bin"]=self._directory_file_path(file)
            manifest={"schema":PACKET_SCHEMA,"workspaceId":self.workspace_id,"correctionId":correction["id"],
                "editionId":correction["editionId"],"beforeEditionId":correction["beforeEditionId"],
                "actor":value["actor"],"note":value["note"],"files":files,"recordCounts":{k:len(v)for k,v in records.items()},
                "recordsSha256":sha(members["records.json"])}
            members["manifest.json"]=jbytes(manifest)
            path=Path(scratch)/"directory-correction.zip";write_zip(path,members)
            file=self._directory_retain_file(path,"directory-complete-correction")
            return self._directory_store("exports",{"label":value.get("label")or correction["label"],"kind":"correction",
                "recordId":correction["id"],"name":"Directory_Correction_"+correction["id"]+".zip","contentType":"application/zip",
                "file":file,"actor":value["actor"],"note":value["note"]})

    def _verify_correction_preview(self,record,plan):
        basis=self.directory_record("editions",record["editionId"])
        candidate=self.directory_record("editions",record["candidateEditionId"])
        comparison=self.directory_record("comparisons",record["comparisonId"])
        expected_review={"schema":PREVIEW_SCHEMA,"workspaceId":self.workspace_id,"plan":plan,"beforeEdition":basis,
            "candidateEdition":candidate,"comparison":comparison,"sources":record["sources"],"changesFile":record["files"]["changes"]}
        review=json_value(self._directory_file_path(record["files"]["review"]).read_bytes())
        if review!=expected_review:raise InputError("The full preview review does not describe its exact retained source graph")
        expected_summary={**plan["summary"],"beforeInventory":basis["inventory"],"candidateInventory":candidate["inventory"],
            "comparison":comparison["summary"]}
        if record["summary"]!=expected_summary:raise InputError("The correction preview summary differs from its complete original records")
        targets={(t["sourceId"],t["recordId"]):t for t in plan["targets"]}
        groups=defaultdict(lambda:defaultdict(list))
        for ordinal,edit in enumerate(plan["edits"],1):
            target=targets[(edit["sourceId"],edit["recordId"])]
            groups[edit["sourceId"]][target["rootRecordId"]].append((ordinal,edit,target))
        pairs={pair["sourceId"]:pair for pair in record["sources"]}
        if set(pairs)!=set(groups):raise InputError("Every edited original source must have exactly one corrected edition source")
        with self.scratch()as scratch:
            scratch=Path(scratch);database=scratch/"replayed-changes.sqlite"
            db=sqlite3.connect(database);database.chmod(0o600)
            db.execute("PRAGMA journal_mode=OFF");db.execute("PRAGMA temp_store=FILE")
            db.execute("CREATE TABLE changes(ordinal INTEGER PRIMARY KEY,body TEXT NOT NULL)")
            try:
                serial=0
                for source_id in basis["sourceIds"]:
                    if source_id in groups:
                        _,serial=self._correction_source(plan,source_id,groups[source_id],scratch,db,serial,verify_pair=pairs[source_id])
                digest=hashlib.sha256();count=0;size=0
                with self._directory_file_path(record["files"]["changes"]).open("rb")as actual:
                    for ordinal,body in db.execute("SELECT ordinal,body FROM changes ORDER BY ordinal"):
                        raw=body.encode();count+=1;size+=len(raw);digest.update(raw)
                        if ordinal!=count or actual.readline()!=raw:
                            raise InputError("Received before/after history differs from replaying the ordered original edits")
                    if actual.read(1):raise InputError("The complete correction history has additional undeclared edits")
                if count!=len(plan["edits"])or size!=record["files"]["changes"]["bytes"]or digest.hexdigest()!=record["files"]["changes"]["sha256"]:
                    raise InputError("The complete ordered correction history does not match its original reviewed input")
            finally:db.close()

    def _verify_directory_corrections(self):
        with self.mutex:
            for kind in KINDS:
                for(ident,)in self.db.execute("SELECT id FROM directory_records WHERE kind=? ORDER BY created,id",(kind,)):
                    record=self.directory_record(kind,ident)
                    expected={"correctionPlans":PLAN_SCHEMA,"correctionPreviews":PREVIEW_SCHEMA,"corrections":CORRECTION_SCHEMA}[kind]
                    if record.get("schema")!=expected or record.get("workspaceId")!=self.workspace_id:
                        raise InputError("The complete correction record belongs to another schema or workspace")
                    for file in retained_file_descriptors(record):self._directory_file_path(file)
                    if kind=="correctionPlans":
                        original=json_value(self._directory_file_path(record["files"]["input"]).read_bytes())
                        if typed("prepare",original)!={k:record[k]for k in original}:
                            raise InputError("Complete correction input differs from its original plan")
                        _,targets=self._correction_targets(record)
                        if targets!=record["targets"]:raise InputError("Original correction row bindings differ")
                        if record["summary"]!={"edits":len(original["edits"]),"rows":len(targets),"sources":len({t["sourceId"]for t in targets})}:
                            raise InputError("The correction plan counts differ from its complete original input")
                    elif kind=="correctionPreviews":
                        plan=self.directory_record("correctionPlans",record["planId"])
                        candidate=self.directory_record("editions",record["candidateEditionId"])
                        comparison=self.directory_record("comparisons",record["comparisonId"])
                        if plan["editionId"]!=record["editionId"]or candidate["predecessorId"]!=record["editionId"]or comparison["afterEditionId"]!=candidate["id"]or comparison["beforeEditionId"]!=record["editionId"]:
                            raise InputError("The preview does not retain its original edition lineage")
                        basis=self.directory_record("editions",record["editionId"])
                        if record["label"]!=plan["label"]or record["actor"]!=plan["actor"]or candidate["scope"]!=basis["scope"]:
                            raise InputError("The correction preview identity or candidate scope differs from its original plan")
                        replacements={r["sourceId"]:r["derivedSourceId"]for r in record["sources"]}
                        if len(replacements)!=len(record["sources"])or not set(replacements).issubset(basis["sourceIds"])or candidate["sourceIds"]!=[replacements.get(i,i)for i in basis["sourceIds"]]or candidate["tables"]!=basis["tables"]:
                            raise InputError("The corrected edition must preserve the entire original source selection")
                        for pair in record["sources"]:
                            old=self.directory_source(pair["sourceId"]);new=self.directory_source(pair["derivedSourceId"])
                            if old["originalFile"]!=pair["originalFile"]or new["originalFile"]!=pair["derivedFile"]or new["indexFile"]!=pair["indexFile"]:
                                raise InputError("The complete derived source differs from its correction binding")
                        self._verify_correction_preview(record,plan)
                    else:
                        preview=self.directory_record("correctionPreviews",record["previewId"])
                        if record["planId"]!=preview["planId"]or record["editionId"]!=preview["candidateEditionId"]or record["beforeEditionId"]!=preview["editionId"]:
                            raise InputError("Accepted correction differs from its complete original preview")
                        plan=self.directory_record("correctionPlans",record["planId"])
                        if record["stage"]!="accepted"or record["expectedEditionId"]!=preview["editionId"]or record["predecessorId"]!=plan.get("predecessorId")or record["comparisonId"]!=preview["comparisonId"]or record["sources"]!=preview["sources"]or record["summary"]!=preview["summary"]or record["files"]["changes"]!=preview["files"]["changes"]:
                            raise InputError("The accepted correction's complete result differs from its exact preview")
                        acceptance={k:v for k,v in record.items()if k not in {"id","createdAt","files"}}
                        expected={"acceptance":acceptance,"plan":plan,"preview":preview,
                            "acceptedEdition":self.directory_record("editions",record["editionId"]),
                            "comparison":self.directory_record("comparisons",record["comparisonId"])}
                        if json_value(self._directory_file_path(record["files"]["review"]).read_bytes())!=expected:
                            raise InputError("The complete accepted review does not describe the retained acceptance and source graph")
            return {"workspaceId":self.workspace_id,"collections":list(KINDS),"verified":True}
