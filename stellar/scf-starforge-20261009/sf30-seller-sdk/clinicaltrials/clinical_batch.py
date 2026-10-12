"""MIT. Batch receiving and exception review over the original Clinical/PRS owner."""
from __future__ import annotations

from collections import Counter
import csv
import io
import os
from pathlib import Path
import re
import shutil
import uuid
import zipfile

from clinical_shared import HERE, InputError, json_bytes, load_json, private_write, file_digest, sync_dir
from clinical_package import copy_private, info, canonical_name, MAX_PACKET
import clinical_source as registry
import clinical_prs as prs

BATCH = "stellar-forge.clinicaltrials-prs-batch.v1"
BATCH_PACKET = "stellar-forge.clinicaltrials-packet.v2"
MAX_ENTRIES = 1000
MAX_BATCH_BYTES = 256 * 1024 * 1024
MAX_METADATA = 16 * 1024 * 1024
SHA = re.compile(r"[0-9a-f]{64}\Z")
BATCH_ID = re.compile(r"batch-[0-9a-f-]{36}\Z")

def identifier(value):
    if not isinstance(value,str) or not BATCH_ID.fullmatch(value):
        raise InputError("Choose the complete retained batch ID")
    try:
        if str(uuid.UUID(value[6:])) != value[6:]:raise ValueError()
    except ValueError as error:raise InputError("Choose the original batch UUID") from error
    return value

def digest(value):
    if not isinstance(value,str) or not SHA.fullmatch(value):
        raise InputError("Use the complete retained SHA256")
    return value

def csv_bytes(headers,rows):
    out=io.StringIO(newline="")
    writer=csv.writer(out,lineterminator="\n")
    writer.writerow(headers);writer.writerows(rows)
    return out.getvalue().encode("utf-8")

def summary(batch):
    counts=Counter((e.get("review") or {}).get("decision","pending") for e in batch["entries"])
    documents=Counter(e["inputDocumentId"] for e in batch["entries"])
    return {"id":batch["id"],"name":batch["name"],"createdAt":batch["createdAt"],
            "updatedAt":batch["updatedAt"],"reviewer":batch["reviewer"],
            "entries":len(batch["entries"]),"uniqueInputs":len(documents),
            "duplicateEntries":sum(n-1 for n in documents.values()),
            "ready":counts["ready"],"followUp":counts["follow-up"],"excluded":counts["exclude"],
            "pending":counts["pending"],"findingCount":sum(len(e.get("findings",[])) for e in batch["entries"]),
            "state":"READY" if counts["ready"] and not counts["pending"] and not counts["follow-up"] else "REVIEW"}

class BatchOperations:
    def batch_index(self):
        return [summary(b) for b in self._all("registry_batches")]

    def _batch(self,ident):
        ident=identifier(ident)
        row=self.db.execute("SELECT body FROM registry_batches WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained receiving batch")
        return load_json(row[0])

    def batch(self,ident):
        with self.mutex:
            value=self._batch(ident)
            return {**value,"summary":summary(value),
                    "exports":[e for e in self._all("registry_batch_exports") if e["batchId"]==ident]}

    def _batch_entry(self,batch,entry_id,expected_document=None):
        row=next((e for e in batch["entries"] if e["id"]==entry_id),None)
        if row is None:raise InputError("Choose an entry in the selected batch")
        if expected_document is not None and row["documentId"]!=expected_document:
            raise InputError("This entry has a different current document; refresh its retained review")
        return row

    def batch_entry(self,batch_id,entry_id):
        with self.mutex:
            batch=self._batch(batch_id);entry=self._batch_entry(batch,entry_id)
            current=self.prs_document(entry["documentId"])["record"]
            original=self.prs_document(entry["inputDocumentId"])["record"]
            return {"batchId":batch_id,"batchName":batch["name"],"entry":entry,
                    "document":current,"original":original,
                    "plan":self.prs_plan(entry["planId"]) if entry.get("planId") else None,
                    "preview":self.prs_preview(entry["previewId"]) if entry.get("previewId") else None,
                    "reconciliation":self.prs_reconciliation(entry["reconciliationId"]) if entry.get("reconciliationId") else None}

    def _save_batch(self,batch):
        batch["updatedAt"]=registry.now()
        encoded=json_bytes(batch)
        if len(encoded)>MAX_METADATA:
            raise InputError("Batch review metadata exceeds 16 MiB; split the receiving scope into separate batches")
        with self.db:self.db.execute("INSERT OR REPLACE INTO registry_batches VALUES(?,?)",(batch["id"],encoded.decode()))
        return self.batch(batch["id"])

    def _batch_links(self,links):
        if not isinstance(links,list) or len(links)>MAX_ENTRIES:
            raise InputError("Supply a list of explicitly reviewed captured study links")
        out=[];seen=set()
        for row in links:
            if not isinstance(row,dict):raise InputError("Each source link must be an object")
            study=self.study(row.get("captureId"),row.get("nctId"))
            key=(study["captureId"],study["nctId"])
            if key in seen:raise InputError("This batch entry repeats the same captured study link")
            seen.add(key)
            if row.get("sourceSha256") is not None and row["sourceSha256"]!=study["sourceSha256"]:
                raise InputError("The selected captured study bytes differ from this source link")
            out.append({"captureId":study["captureId"],"nctId":study["nctId"],
                        "sourceSha256":study["sourceSha256"],
                        "reason":registry.text(row.get("reason"),"Source-link reason",8192)})
        return out

    def _batch_refresh(self,entry):
        document=self.prs_document(entry["documentId"])["record"];report=document["report"]
        findings=[]
        def add(kind,status,message,detail,blocking=False):
            value={"kind":kind,"status":status,"message":message,"detail":detail,"blocking":blocking}
            value["id"]=registry.sha(json_bytes({"documentId":entry["documentId"],**value}))
            findings.append(value)
        for row in report.get("schemaErrors",[]):
            add("schema","error",row.get("message") or "Original XSD validation finding",row,True)
        if not report.get("schemaValid") and not report.get("schemaErrors"):
            add("schema","error","This original XML is not valid against the selected complete PRS schema",{},True)
        for row in (report.get("references") or {}).get("errors",[]):
            add("reference","error",row.get("message") or row.get("code") or "Original results reference finding",row,True)
        for row in report.get("sourceIssues",[]):
            add("source","review",row.get("detail") or row.get("code") or "Original source interpretation",row)
        for row in report.get("legacyElements",[]):
            add("legacy","review",row["ruleId"]+": "+row.get("currentTreatment","Review original deprecated element"),row)
        if entry.get("previewId"):
            retained=self.prs_preview(entry["previewId"])
            native=retained["report"]["report"]
            if not native.get("complete",False):
                add("upload","unresolved","The retained upload composition has unresolved source units",native.get("unresolved",[]),True)
        reconciliation=None
        if entry.get("reconciliationId"):
            retained=self.prs_reconciliation(entry["reconciliationId"])
            if retained["documentId"]!=entry["documentId"]:
                raise InputError("The retained reconciliation belongs to another document")
            reconciliation=retained["report"]["report"]
            for row in reconciliation.get("findings",[]):
                if row.get("equal") is not True:
                    add("reconciliation",row.get("status","review"),
                        row.get("label") or row.get("fieldId") or "Original source field comparison",row)
            for row in reconciliation.get("unlinkedXml",[]):
                add("reconciliation","unlinked","The original PRS study remains unlinked",row)
        entry["inspection"]={"schemaKind":report["schemaKind"],"schemaValid":bool(report.get("schemaValid")),
                            "wellFormed":bool(report.get("wellFormed")),"bytes":report["bytes"],
                            "schemaSetSha256":report["schemaSetSha256"],"studies":len(report.get("studies",[])),
                            "legacyElements":len(report.get("legacyElements",[])),
                            "referencesValid":(report.get("references") or {}).get("valid")}
        entry["findings"]=findings
        entry["contextSha256"]=registry.sha(json_bytes({"documentId":entry["documentId"],
            "inspectionSha256":registry.sha(json_bytes(report)),"sourceLinks":entry["sourceLinks"],
            "planId":entry.get("planId"),"previewId":entry.get("previewId"),
            "reconciliationId":entry.get("reconciliationId")}))
        return entry

    def _batch_reference(self,entry,kind,ident):
        digest(ident)
        ref={"kind":kind,"id":ident}
        if ref not in entry["artifacts"]:entry["artifacts"].append(ref)

    def _batch_record(self,batch,entry,action,request_id,payload,references=None):
        event={"id":request_id,"action":action,"createdAt":registry.now(),
               "reviewer":payload.get("reviewer") or payload.get("reviewedBy") or batch["reviewer"],
               "payload":payload,"references":references or {}}
        entry["history"].append(event)
        return event

    def _create_batch(self,p,request_id):
        entries=p.get("entries")
        if not isinstance(entries,list) or not 1<=len(entries)<=MAX_ENTRIES:
            raise InputError("Receive between 1 and 1,000 explicitly selected XML entries")
        reviewer=registry.text(p.get("reviewer"),"Receiving reviewer",160)
        ident="batch-"+request_id
        batch={"schema":BATCH,"id":ident,"name":registry.text(p.get("name"),"Batch name",160),
               "reviewer":reviewer,"note":registry.text(p.get("note",""),"Receiving note",8192,empty=True),
               "createdAt":registry.now(),"updatedAt":registry.now(),"entries":[]}
        keys=set();unique={}
        for index,value in enumerate(entries):
            if not isinstance(value,dict):raise InputError("Each receiving entry must be an object")
            key=registry.text(value.get("key"),"Client entry reference",160)
            if key in keys:raise InputError("Client entry references must be unique inside this batch")
            keys.add(key)
            document=self.prs_document(digest(value.get("documentId")))["record"]
            unique[document["id"]]=document["report"]["bytes"]
            if sum(unique.values())>MAX_BATCH_BYTES:
                raise InputError("The distinct original XML inputs exceed this batch's 256 MiB capacity")
            entry={"id":registry.sha(json_bytes({"batchId":ident,"key":key,"ordinal":index})),
                   "key":key,"label":registry.text(value.get("label") or document["name"],"Entry label",200),
                   "inputDocumentId":document["id"],"documentId":document["id"],
                   "sourceLinks":self._batch_links(value.get("sourceLinks",[])),
                   "artifacts":[{"kind":"document","id":document["id"]}],"history":[],
                   "planId":None,"previewId":None,"reconciliationId":None,"review":None}
            self._batch_refresh(entry);batch["entries"].append(entry)
        return self._save_batch(batch)

    def batch_action(self,action,p,request_id):
        if action=="batch.create":return self._create_batch(p,request_id)
        if action=="batch.export":return self.export_batch(p["batchId"],request_id)
        batch=self._batch(p["batchId"])
        entry=self._batch_entry(batch,p["entryId"],p.get("expectedDocumentId"))
        if p.get("expectedDocumentId") is None:
            raise InputError("Bind the row action to its currently reviewed document ID")
        references={};output=None
        if action=="batch.links":
            entry["sourceLinks"]=self._batch_links(p.get("sourceLinks",[]))
            entry["reconciliationId"]=None;entry["review"]=None
        elif action=="batch.plan":
            output=self.prepare_prs({"documentId":entry["documentId"],"decisions":p["decisions"],
                                     "reviewer":p["reviewer"],"rationale":p.get("rationale","")})
            entry["planId"]=output["id"];self._batch_reference(entry,"plan",output["id"])
            references={"planId":output["id"]};entry["review"]=None
        elif action=="batch.apply":
            plan_id=digest(p["planId"])
            output=self.apply_prs({"documentId":entry["documentId"],"planId":plan_id})
            entry["documentId"]=output["document"]["id"];entry["planId"]=plan_id
            self._batch_reference(entry,"plan",plan_id);self._batch_reference(entry,"document",entry["documentId"])
            entry["previewId"]=None;entry["reconciliationId"]=None;entry["review"]=None
            references={"planId":plan_id,"documentId":entry["documentId"]}
        elif action=="batch.preview":
            output=self.preview_prs({"baseDocumentId":p["baseDocumentId"],"incomingDocumentId":entry["documentId"],
                                    "rules":p.get("rules"),"reviewer":p["reviewer"]})
            self._batch_reference(entry,"preview",output["previewId"])
            self._batch_reference(entry,"document",output["document"]["id"])
            references={"previewId":output["previewId"],"candidateId":output["document"]["id"]}
        elif action=="batch.select":
            candidate=self.prs_document(digest(p["documentId"]))["record"]
            current=self.prs_document(entry["documentId"])["record"]
            if candidate["report"]["schemaKind"]!=current["report"]["schemaKind"]:
                raise InputError("The selected candidate must use this entry's original PRS schema")
            registry.text(p.get("reviewer"),"Candidate reviewer",160)
            registry.text(p.get("note"),"Candidate selection reason",8192)
            preview_id=p.get("previewId")
            if preview_id and self.prs_preview(preview_id)["candidateId"]!=candidate["id"]:
                raise InputError("The selected preview does not contain this candidate")
            entry["documentId"]=candidate["id"];entry["previewId"]=preview_id
            entry["planId"]=None;entry["reconciliationId"]=None;entry["review"]=None
            self._batch_reference(entry,"document",candidate["id"])
            if preview_id:self._batch_reference(entry,"preview",preview_id)
            references={"documentId":candidate["id"],"previewId":preview_id}
        elif action=="batch.reconcile":
            capture_id=p["captureId"];plan=p["plan"]
            if not isinstance(plan,dict) or not isinstance(plan.get("studyLinks"),list):
                raise InputError("Supply the complete original typed reconciliation plan")
            declared={(x["captureId"],x["nctId"]) for x in entry["sourceLinks"]}
            if any((capture_id,x.get("nctId")) not in declared for x in plan["studyLinks"]):
                raise InputError("Link these exact captured studies to the batch entry before reconciliation")
            output=self.reconcile_prs({"documentId":entry["documentId"],"captureId":capture_id,"plan":plan})
            entry["reconciliationId"]=output["id"];entry["review"]=None
            self._batch_reference(entry,"reconciliation",output["id"])
            references={"reconciliationId":output["id"]}
        elif action=="batch.review":
            self._batch_refresh(entry)
            if p.get("expectedContextSha256")!=entry["contextSha256"]:
                raise InputError("The document or source review context changed; read this entry again")
            if p.get("decision") not in {"ready","follow-up","exclude"}:
                raise InputError("Choose ready, follow-up or exclude")
            if p["decision"]=="ready" and any(x["blocking"] for x in entry["findings"]):
                raise InputError("Resolve the original XML, reference or upload-composition errors before marking this entry ready")
            entry["review"]={"id":request_id,"decision":p["decision"],
                             "reviewer":registry.text(p.get("reviewer"),"Disposition reviewer",160),
                             "note":registry.text(p.get("note"),"Disposition note",8192),
                             "documentId":entry["documentId"],"contextSha256":entry["contextSha256"],
                             "createdAt":registry.now()}
            references={"reviewId":request_id,"documentId":entry["documentId"]}
        else:raise InputError("Unknown batch receiving action")
        self._batch_refresh(entry)
        self._batch_record(batch,entry,action,request_id,p,references)
        return {"batch":self._save_batch(batch),"entry":entry,"operation":output,"references":references}

    def restore_batches(self,values):
        if not isinstance(values,list):raise InputError("Portable batches must be a list")
        for batch in values:
            if not isinstance(batch,dict) or batch.get("schema")!=BATCH:
                raise InputError("Unsupported original receiving-batch schema")
            identifier(batch.get("id"));entries=batch.get("entries")
            if not isinstance(entries,list) or not 1<=len(entries)<=MAX_ENTRIES:
                raise InputError("Portable batch entry count is invalid")
            seen=set()
            for entry in entries:
                digest(entry["id"])
                if entry["id"] in seen:raise InputError("Portable batch repeats a row identity")
                seen.add(entry["id"])
                for kind in ["inputDocumentId","documentId"]:self.prs_document(digest(entry[kind]))
                if self._batch_links(entry["sourceLinks"])!=entry["sourceLinks"]:
                    raise InputError("Portable batch study links changed")
                for artifact in entry["artifacts"]:
                    methods={"document":self.prs_document,"plan":self.prs_plan,
                             "preview":self.prs_preview,"reconciliation":self.prs_reconciliation}
                    if artifact.get("kind") not in methods:raise InputError("Unknown portable PRS artifact kind")
                    methods[artifact["kind"]](digest(artifact["id"]))
                prior_context=entry["contextSha256"];prior_findings=entry["findings"]
                self._batch_refresh(entry)
                if entry["contextSha256"]!=prior_context or entry["findings"]!=prior_findings:
                    raise InputError("Original batch inspection or reconciliation changed during receiving")
                review=entry.get("review")
                if review and (review["documentId"]!=entry["documentId"] or review["contextSha256"]!=prior_context):
                    raise InputError("Portable disposition belongs to a different review context")
            encoded=json_bytes(batch)
            if len(encoded)>MAX_METADATA:raise InputError("Portable batch metadata exceeds 16 MiB")
            prior=self.db.execute("SELECT body FROM registry_batches WHERE id=?",(batch["id"],)).fetchone()
            if prior and load_json(prior[0])!=batch:raise InputError("The retained batch differs from this portable copy")
            with self.db:self.db.execute("INSERT OR IGNORE INTO registry_batches VALUES(?,?)",(batch["id"],encoded.decode()))

    def export_batch(self,batch_id,request_id):
        batch=self._batch(batch_id);ident="export-"+request_id
        prior=self.db.execute("SELECT body FROM registry_batch_exports WHERE id=?",(ident,)).fetchone()
        if prior:return self.verify_batch_export(ident)
        root=self.root/"batch-exports";root.mkdir(mode=0o700,exist_ok=True)
        if root.is_symlink() or not root.is_dir():raise InputError("Use the original private batch export directory")
        destination=root/ident;destination.mkdir(mode=0o700,exist_ok=False)
        try:
            original=json_bytes(batch)
            private_write(destination/"batch.json",original)
            rows=[];exceptions=[];members=set()
            def copy(name,path):
                if name in members:return
                members.add(name);copy_private(path,destination/name)
            methods={"plan":"plan-","preview":"preview-","reconciliation":"reconciliation-"}
            for entry in batch["entries"]:
                current=self.prs_document(entry["documentId"])["record"]
                review=entry.get("review") or {}
                rows.append([entry["key"],entry["label"],entry["inputDocumentId"],entry["documentId"],
                    current["report"]["schemaKind"],current["report"]["schemaValid"],len(current["report"].get("studies",[])),
                    review.get("decision","pending"),review.get("reviewer",""),review.get("note",""),
                    "; ".join(x["nctId"] for x in entry["sourceLinks"]),len(entry["findings"])])
                for finding in entry["findings"]:
                    exceptions.append([entry["key"],entry["label"],finding["id"],finding["kind"],finding["status"],
                        finding["blocking"],finding["message"],review.get("decision","pending"),review.get("note",""),
                        json_bytes(finding["detail"]).decode().strip()])
                for artifact in entry["artifacts"]:
                    aid=digest(artifact["id"]);kind=artifact["kind"]
                    if kind=="document":
                        self.prs_document(aid)
                        for suffix in [".xml",".json"]:copy("prs/"+aid+suffix,self._verified("prs/"+aid+suffix,aid if suffix==".xml" else None,prs.MAX_XML))
                    else:
                        name="prs/"+methods[kind]+aid+".json"
                        copy(name,self._verified(name,aid,prs.MAX_XML))
                for linked in entry["sourceLinks"]:
                    study=self.study(linked["captureId"],linked["nctId"])
                    name="studies/"+linked["captureId"]+"/"+linked["nctId"]+".json"
                    if name not in members:
                        raw=study["json"].encode("utf-8")
                        if registry.sha(raw)!=linked["sourceSha256"]:raise InputError("Original linked study bytes changed")
                        (destination/Path(name).parent).mkdir(mode=0o700,parents=True,exist_ok=True)
                        private_write(destination/name,raw);members.add(name)
                    capname="studies/"+linked["captureId"]+"/capture.json"
                    if capname not in members:
                        private_write(destination/capname,json_bytes(self._capture(linked["captureId"])));members.add(capname)
            private_write(destination/"batch-register.csv",csv_bytes(
                ["client_reference","label","input_sha256","current_sha256","schema","schema_valid","study_count",
                 "disposition","reviewer","review_note","linked_nct_ids","finding_count"],rows))
            private_write(destination/"exceptions.csv",csv_bytes(
                ["client_reference","label","finding_id","kind","status","blocking","message","disposition","review_note","original_detail_json"],exceptions))
            for path in sorted((HERE/"contracts").iterdir()):
                if path.is_file() and not path.is_symlink():copy("contracts/"+path.name,path)
            self._portable(destination/"clinicaltrials-workspace.zip")
            guide="\n".join(["# Disclosure batch receiving","",
                "Batch: "+batch["name"],"Disposition: "+summary(batch)["state"],"",
                "Open batch-register.csv for the retained client references, selected source documents and reviewer decisions.",
                "exceptions.csv preserves original XSD, reference, legacy-field, partial-upload and source-reconciliation findings.",
                "prs/ contains each exact original and candidate XML, inspection, reviewed plan, composition and reconciliation used by this batch.",
                "studies/ contains the explicitly linked captured study bytes and original cohort metadata. contracts/ retains the selected official source edition.","",
                "## Reopen the complete operator","",
                "Use the current installed ClinicalTrials contribution. Initialize a new private workspace, then restore clinicaltrials-workspace.zip.",
                "starforge clinicaltrials --workspace NEW_DIRECTORY init",
                "starforge clinicaltrials --workspace NEW_DIRECTORY restore --file clinicaltrials-workspace.zip",
                "starforge clinicaltrials --workspace NEW_DIRECTORY serve",
                "Open Batch receiving to inspect the same batch ID, original input hashes, row history, source links and selected dispositions.",
                "This v2 portable packet requires the batch-capable ClinicalTrials contribution so receiving preserves every saved row review.","",
                "Ready rows identify the reviewer-selected preparation scope. Follow-up and excluded rows retain their sources and explanations in this same delivery.",""])
            private_write(destination/"HANDOVER.md",guide.encode())
            files=[{"name":p.relative_to(destination).as_posix(),**info(p)} for p in sorted(destination.rglob("*")) if p.is_file()]
            manifest={"schema":"stellar-forge.clinicaltrials-prs-batch-delivery.v1","batchId":batch_id,
                      "batchSha256":registry.sha(original),"createdAt":registry.now(),"summary":summary(batch),"files":files}
            private_write(destination/"manifest.json",json_bytes(manifest))
            archive=destination/"disclosure-batch.zip"
            with os.fdopen(os.open(archive,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600),"w+b") as out:
                with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
                    for path in sorted(destination.rglob("*")):
                        if path.is_file() and path!=archive:z.write(path,path.relative_to(destination).as_posix())
                out.flush();os.fsync(out.fileno())
            result={"id":ident,"kind":"prs-batch","batchId":batch_id,"name":batch["name"],
                    "createdAt":registry.now(),"summary":summary(batch),
                    "files":[{"name":p.relative_to(destination).as_posix(),**info(p)} for p in sorted(destination.rglob("*")) if p.is_file()]}
            sync_dir(destination)
            with self.db:self.db.execute("INSERT INTO registry_batch_exports VALUES(?,?)",(ident,json_bytes(result).decode()))
            return result
        except BaseException:
            shutil.rmtree(destination,ignore_errors=True);raise

    def verify_batch_export(self,ident):
        if not isinstance(ident,str) or not re.fullmatch(r"export-[0-9a-f-]{36}",ident):
            raise InputError("Choose the original retained batch export")
        row=self.db.execute("SELECT body FROM registry_batch_exports WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown batch export")
        value=load_json(row[0]);directory=self.root/"batch-exports"/ident
        if directory.is_symlink() or not directory.is_dir():raise InputError("Original batch export directory changed")
        for item in value["files"]:
            path=directory/canonical_name(item["name"])
            if path.is_symlink() or directory.resolve() not in path.resolve(strict=True).parents:
                raise InputError("Batch export file escaped its retained directory")
            if info(path)!={k:item[k] for k in ["bytes","sha256"]}:raise InputError("Original batch export bytes changed")
        return value

    def read_batch_export(self,ident,name):
        with self.mutex:
            value=self.verify_batch_export(ident)
            selected=next((f for f in value["files"] if f["name"]==name),None)
            if not selected:raise InputError("Choose a file declared by this original batch export")
            return {"path":self.root/"batch-exports"/ident/name,"filename":Path(name).name,**selected}
