"""MIT. Complete original directory, clinical and operator receiving in one workspace."""
from __future__ import annotations
import copy
import csv
import hashlib
import html
import io
import os
from pathlib import Path
import shutil
import stat
import uuid
import zipfile
from directory_runtime import (BaseWorkspace,InputError,ConflictError,source,private_directory,
    original_workspace,safe_read,now,atomic_json,write_zip)
from directory_source import retained_file_descriptors
import directory_schema as schema
from directory_conformance import KINDS as CONFORMANCE_KINDS
from directory_corrections_schema import KINDS as CORRECTION_KINDS
from directory_correction_worksheets_schema import KINDS as WORKSHEET_KINDS
from directory_correction_worksheet_reconciliation_schema import KINDS as RECONCILIATION_KINDS

WORKSPACE_PACKET="stellar-forge.human-services-directory-workspace-packet.v1"
HANDOFF_PACKET="stellar-forge.human-services-directory-handoff-packet.v1"
REGISTRY_SCHEMA="stellar-forge.human-services-directory-registry.v1"
MAX_PACKET=2147483648
MAX_MEMBERS=40000
SOURCE_KINDS={"connections","discoveries","requests","sources","editions","comparisons","acquisitions"}
STYLE="body{font:14px system-ui,sans-serif;color:#24272b;background:#fff;max-width:1280px;margin:auto;padding:32px}a{color:inherit}h1{font-size:26px}h2{font-size:19px;margin-top:28px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #c4c8cc;padding:8px;text-align:left;vertical-align:top}th{background:#f1f3f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.meta{padding:16px;border:1px solid #c4c8cc}small{color:#58616a}"

def filename(name):
    source.member_name(name)
    if not isinstance(name,str)or any(c in name for c in ["\\",":"]):raise InputError("Receiving members require exact safe relative paths")
    return name

def file_info(path):
    path=Path(path).expanduser().absolute();info=path.lstat()
    if path.is_symlink()or not stat.S_ISREG(info.st_mode)or info.st_size>MAX_PACKET:raise InputError("Choose a complete regular directory receiving file within2GiB")
    return path,info.st_size,original_workspace.file_digest(path,MAX_PACKET)

def esc(value):return html.escape(str(value if value is not None else ""),quote=True)
def table(columns,rows):
    return "<table><thead><tr>"+"".join("<th>"+esc(c)+"</th>"for c in columns)+"</tr></thead><tbody>"+"".join(
        "<tr>"+"".join("<td>"+esc(v)+"</td>"for v in row)+"</tr>"for row in rows)+"</tbody></table>"
def csv_bytes(columns,rows):
    out=io.StringIO(newline="");writer=csv.writer(out,lineterminator="\r\n");writer.writerow(columns)
    for row in rows:
        vals=[]
        for v in row:
            s=""if v is None else str(v);vals.append("'"+s if s[:1]in{"=","+","-","@","\t","\r"}else s)
        writer.writerow(vals)
    return out.getvalue().encode()

class DirectoryReceiving:
    def _directory_registry(self):
        self.directory_sync_sources()
        count,body_bytes=self.db.execute("SELECT count(*),COALESCE(sum(length(CAST(body AS BLOB))),0) FROM directory_records WHERE kind!=?",("receives",)).fetchone()
        if body_bytes+count*2+65536>schema.MAX_RECORD:raise InputError("The complete directory registry exceeds64MiB before export; retain selected handoffs or original per-record files")
        return {"schema":REGISTRY_SCHEMA,"workspaceId":self.workspace_id,
            "records":{k:self.directory_records(k)for k in sorted(schema.KINDS-{"receives"})},
            "implementation":{"directorySchema":schema.SCHEMA,"workspaceSchema":self.version,
                "sourceSchema":source.SOURCE_SCHEMA,"catalogueSha256":source.sha((Path(__file__).parent/"directory-schema.json").read_bytes()),
                "originalSourceSha256":source.sha((Path(__file__).parent/"directory-original-source.json").read_bytes())}}

    @staticmethod
    def _directory_files(registry):
        result={}
        def add(d):
            if not isinstance(d,dict):raise InputError("A retained directory file descriptor is missing")
            ident=source.identity(d.get("sha256"));size=source.integer(d.get("bytes"),0,MAX_PACKET,"Directory original file size")
            if not isinstance(d.get("role"),str)or not d["role"]:raise InputError("Retained directory file needs its original role")
            if ident in result and result[ident]["bytes"]!=size:raise InputError("One original file has conflicting byte declarations")
            result[ident]=d
        records=registry["records"]
        for kind in SOURCE_KINDS:
            for d in retained_file_descriptors(records[kind]):add(d)
        for r in records["mappingPreviews"]:
            for key in ["reportFile","bundleFile","fieldMapFile"]:add(r[key])
        for r in records["sourceConversions"]:
            for key in ["resourceMapFile","bundleFile","fieldMapFile","nativePacket"]:add(r[key])
        for r in records["selections"]:add(r["reportFile"])
        for r in records["referralJoins"]:
            for key in ["reportFile","changesFile","nativePacket"]:add(r[key])
        for r in records["handoffs"]:
            add(r["nativeSnapshot"]);add(r["directorySnapshot"])
            for d in r["files"].values():add(d)
        for r in records["exports"]:add(r["file"])
        for kind in CONFORMANCE_KINDS:
            for r in records.get(kind,[]):
                for d in r.get("files",{}).values():add(d)
        from directory_operating_plans import retained_operating_files
        for record in records.get("operatingPlans",[]):
            for descriptor in retained_operating_files(record):add(descriptor)
        from directory_operating_returns import retained_return_files
        for record in records.get("operatingPlanReturns",[]):
            for descriptor in retained_return_files(record):add(descriptor)
        for kind in set(WORKSHEET_KINDS)|set(RECONCILIATION_KINDS):
            for record in records.get(kind,[]):
                for descriptor in record.get("files",{}).values():add(descriptor)
        for kind in CORRECTION_KINDS:
            for record in records.get(kind,[]):
                for descriptor in record.get("files",{}).values():add(descriptor)
                for selected in record.get("sources",[]):
                    for key in ("originalFile","derivedFile","indexFile"):add(selected[key])
                    for member in selected.get("changedMembers",[]):
                        add(member["originalFile"]);add(member["derivedFile"])
        return result

    def _directory_write_packet(self,output,registry,members,packet_schema,handoff_id=None):
        path=Path(output).expanduser().absolute()
        if path.exists():raise ConflictError("Choose a new complete directory receiving file")
        files={**members,"directory-registry.json":source.jbytes(registry)}
        if len(files["directory-registry.json"])>schema.MAX_RECORD:raise InputError("The full directory registry exceeds64MiB")
        descriptors={};total=0
        for name,val in files.items():
            filename(name)
            size,digest=(len(val),source.sha(val))if isinstance(val,bytes)else file_info(val)[1:]
            total+=size
            if total>MAX_PACKET or len(descriptors)>=MAX_MEMBERS:raise InputError("The complete selected receiving exceeds2GiB or40,000 original members")
            descriptors[name]={"bytes":size,"sha256":digest}
        manifest={"schema":packet_schema,"workspaceId":registry["workspaceId"],"files":descriptors,"fileCount":len(descriptors),
            "totalBytes":total,"registrySha256":descriptors["directory-registry.json"]["sha256"],
            "nativeSchema":"stellar-forge.gravity-referral-workspace-packet.v1","handoffId":handoff_id}
        write_zip(path,{**files,"manifest.json":source.jbytes(manifest)})
        _,size,digest=file_info(path)
        return {"schema":packet_schema,"workspaceId":registry["workspaceId"],"file":str(path),"bytes":size,"sha256":digest,
            "fileCount":len(descriptors),"originalBytes":total,"handoffId":handoff_id}

    def export_workspace(self,output):
        with self.mutex,self.scratch()as temp:
            registry=self._directory_registry();native=Path(temp)/"gravity-workspace.zip"
            BaseWorkspace.export_workspace(self,native)
            members={"gravity-workspace.zip":native}
            for ident,d in self._directory_files(registry).items():members["files/"+ident+".bin"]=self._directory_file_path(d)
            return self._directory_write_packet(output,registry,members,WORKSPACE_PACKET)

    def _directory_human_files(self,request,selection,conversion,join):
        report=self.directory_selection(selection["id"]);mapping=self.directory_preview(conversion["previewId"])
        chosen=[c for c in report["candidates"]if c["chosen"]]
        criteria_rows=[];contacts=[];decisions=[]
        for c in report["candidates"]:
            ref=c["ref"]
            for item in c["checks"]:criteria_rows.append([c["name"],ref["sourceId"],ref["recordId"],item["criterion"],item["state"],item["reason"],source.lexical_json(item["values"])])
            for p in c["contacts"]:contacts.append([c["name"],p["system"],p["value"],p["ref"]["sourceId"],p["ref"]["recordId"],p["pointer"]])
            if c["disposition"]:decisions.append([c["name"],c["disposition"]["decision"],c["disposition"]["reason"],c["disposition"].get("owner","")])
        title="Human Services Directory — "+request["label"]
        body="<html><head><meta charset='utf-8'><title>"+esc(title)+"</title><style>"+STYLE+"</style></head><body><h1>"+esc(title)+"</h1>"
        body+="<p class='meta'>"+esc(request["scope"])+"</p>"+table(["Owner","Recipient","Directory edition","Conversion"],
            [[request["owner"],request["recipient"],selection["editionId"],conversion["id"]]])
        body+="<h2>Selected services</h2>"+table(["Service","Original status","Decision","Reason","Source row"],
            [[c["name"],c["status"],(c["disposition"]or{}).get("decision"),(c["disposition"]or{}).get("reason"),c["ref"]["recordId"]]for c in chosen])
        body+="<h2>Operating checks</h2>"+table(["Service","Criterion","Outcome","Basis"],[[r[0],r[3],r[4],r[5]]for r in criteria_rows])
        body+="<h2>Contact and follow-through</h2>"+table(["Service","Channel","Original address"],[[r[0],r[1],r[2]]for r in contacts])+table(["Service","Disposition","Reason","Owner"],decisions)
        body+="<h2>Reviewed mapping</h2><p>"+esc(str(mapping["summary"]["resources"])+" mapped resources; "+str(mapping["summary"]["mappedFields"])+" original field bindings.")+"</p>"
        body+="<p>The mapping review retains all original identities, selected source editions and migration dispositions. Capacity observations describe their source time and unit; they do not reserve a place.</p>"
        if join:
            body+="<h2>Original referral integration</h2>"+table(["Task","Selected provider","Explicit field","Reason"],
                [[b["taskId"],b["recipientFullUrl"],b["destinationField"],b["reason"]]for b in join["bindings"]])
            body+="<p>The native join retains the original Task status, consent resources and outcomes. The selected directory endpoint remains separate from the explicit clinical receiver configuration.</p>"
        body+="<h2>Editable receiving</h2><p>Receive this complete private package into an empty Human Services Directory workspace. It carries the original Gravity workspace, directory sources and indices, reviewed choices, partial GET journals and all recorded file bytes. Continue the saved request identities when a remote operation is incomplete.</p>"
        body+="<h2>Files</h2><p>Selection.json, Mapping_Preview.json, Original_Field_Map.json and Directory_FHIR_Collection.json carry the complete detailed records. The CSV files provide receiving worksheets. Original input archives and each saved source/index are in the same packet's complete registry and file map.</p></body></html>"
        files={"START_HERE.html":body.encode(),"Selection.json":source.lexical_json(report).encode()+b"\n",
            "Mapping_Preview.json":self._directory_file_path(conversion["resourceMapFile"]),
            "Original_Field_Map.json":self._directory_file_path(conversion["fieldMapFile"]),
            "Directory_FHIR_Collection.json":self._directory_file_path(conversion["bundleFile"]),
            "Service_Checks.csv":csv_bytes(["service","source_id","record_id","criterion","state","reason","original_values_json"],criteria_rows),
            "Service_Contacts.csv":csv_bytes(["service","system","value","source_id","record_id","pointer"],contacts),
            "Owner_Decisions.csv":csv_bytes(["service","disposition","reason","owner"],decisions)}
        if join:
            files["Directory_Referral_Join.json"]=self._directory_file_path(join["reportFile"])
            files["Original_Referral_Changes.jsonl"]=self._directory_file_path(join["changesFile"])
        return files

    def prepare_directory_handoff(self,raw):
        request=schema.input_value("handoff",raw);request.setdefault("referralJoinId",None);request.setdefault("sourceRefs",[])
        request_sha=source.sha(source.jbytes(request))
        with self.mutex,self.scratch()as temp:
            for old in self.directory_records("handoffs"):
                if old["requestSha256"]==request_sha:return old
            selection=self.directory_record("selections",request["selectionId"]);conversion=self.directory_conversion(request["conversionId"])
            if selection["editionId"]!=conversion["editionId"]:raise InputError("The handoff retains one exact selection/conversion edition")
            if not selection["chosenRefs"]:raise InputError("The receiving handoff requires a saved service choice")
            join=self.directory_record("referralJoins",request["referralJoinId"])if request["referralJoinId"]else None
            if join and(join["selectionId"]!=selection["id"]or join["conversionId"]!=conversion["id"]):
                raise InputError("The selected referral join belongs to another directory decision")
            for k in ["owner","recipient","scope"]:
                if not request[k].strip():raise InputError("The receiving "+k+" must be explicit")
            directory=Path(temp);registry=self._directory_registry()
            native=directory/"gravity-workspace.zip";BaseWorkspace.export_workspace(self,native)
            snapshot=directory/"directory-registry.json";original_workspace.private_write(snapshot,source.jbytes(registry))
            retained={}
            for n,(name,value)in enumerate(self._directory_human_files(request,selection,conversion,join).items()):
                if isinstance(value,bytes):
                    path=directory/("human-"+str(n));original_workspace.private_write(path,value)
                else:path=value
                retained[name]=self._directory_retain_file(path,"directory-human-receiving")
            return self._directory_store("handoffs",{**request,"requestSha256":request_sha,
                "nativeSnapshot":self._directory_retain_file(native,"complete-frozen-gravity-workspace"),
                "directorySnapshot":self._directory_retain_file(snapshot,"complete-frozen-directory-registry"),"files":retained})

    def export_directory_handoff(self,ident,output):
        with self.mutex:
            handoff=self.directory_record("handoffs",ident)
            registry=source.json_value(safe_read(self._directory_file_path(handoff["directorySnapshot"]),schema.MAX_RECORD))
            if registry["workspaceId"]!=self.workspace_id:raise InputError("Frozen directory handoff belongs to another workspace")
            if not any(r["id"]==ident for r in registry["records"]["handoffs"]):registry["records"]["handoffs"].append(handoff)
            members={"gravity-workspace.zip":self._directory_file_path(handoff["nativeSnapshot"]),"handoff.json":source.jbytes(handoff)}
            for name,d in handoff["files"].items():members["readable/"+filename(name)]=self._directory_file_path(d)
            for sha,d in self._directory_files(registry).items():members["files/"+sha+".bin"]=self._directory_file_path(d)
            return self._directory_write_packet(output,registry,members,HANDOFF_PACKET,ident)

    def save_directory_receiving(self,raw):
        value=schema.input_value("receiving",raw);value.setdefault("handoffId",None);value.setdefault("findings","")
        if value["handoffId"]:self.directory_record("handoffs",value["handoffId"])
        if not value["owner"].strip():raise InputError("The receiving observation requires its actual owner")
        return self._directory_store("receivingReviews",value)

    def prepare_directory_export(self,raw):
        value=schema.input_value("export",raw);value.setdefault("recordId",None)
        request_sha=source.sha(source.jbytes(value))
        with self.mutex,self.scratch()as temp:
            for previous in self.directory_records("exports"):
                if previous.get("requestSha256")==request_sha:
                    self._directory_file_path(previous["file"]);return previous
            directory=Path(temp);kind=value["kind"];ident=value["recordId"]
            if kind not in {"workspace","guidance"}and not ident:raise InputError("Choose the original record for this complete export")
            media="application/zip";name="Directory_"+kind.replace("-","_")+".zip";path=directory/name
            if kind=="workspace":result=self.export_workspace(path)
            elif kind=="handoff":result=self.export_directory_handoff(ident,path)
            elif kind=="source":
                record=self.directory_source(ident);original,d=self.directory_source_file(ident)
                members={"source.json":source.jbytes(record),"original-input":original}
                for n,member in enumerate(record["members"]):
                    members["members/"+str(n)+"/original"]=self._directory_file_path(member["file"])
                members["index.sqlite"]=self._directory_file_path(record["indexFile"])
                write_zip(path,members);result={"sourceId":ident}
            elif kind=="guidance":
                root=Path(__file__).parent
                write_zip(path,{n:root/n for n in ["directory-guidance.json","directory-original-source.json","directory-mapping-profiles.json",
                    "directory-schema.json","directory-source-schema.json"]});result={"originalSourceSha256":source.sha((root/"directory-original-source.json").read_bytes())}
            else:
                record=self.directory_record({"mapping-preview":"mappingPreviews","selection":"selections","referral-join":"referralJoins"}[kind],ident)
                path=self._directory_file_path(record["reportFile"]);name="Directory_"+kind.replace("-","_")+".json";media="application/json";result={"recordId":ident}
            descriptor=self._directory_retain_file(path,"complete-directory-export")
            return self._directory_store("exports",{**value,"requestSha256":request_sha,"name":name,"contentType":media,"file":descriptor,"result":result})

    def _read_directory_packet(self,path,temp,packet_schema):
        with zipfile.ZipFile(path)as archive:
            infos=archive.infolist();names=[i.filename for i in infos]
            if len(names)!=len(set(names))or len(names)>MAX_MEMBERS+1:raise InputError("Directory receiving repeats a member or exceeds40,000 files")
            for info in infos:
                filename(info.filename)
                if info.is_dir()or stat.S_ISLNK(info.external_attr>>16)or info.flag_bits&1:
                    raise InputError("Complete receiving supports original regular unencrypted members")
            if "manifest.json"not in names or archive.getinfo("manifest.json").file_size>schema.MAX_RECORD:
                raise InputError("Complete directory receiving manifest is absent or too large")
            manifest=source.json_value(archive.read("manifest.json"))
            if manifest.get("schema")!=packet_schema or not isinstance(manifest.get("files"),dict):raise InputError("Select the complete original directory receiving schema")
            if set(names)!=set(manifest["files"])|{"manifest.json"}or manifest.get("fileCount")!=len(manifest["files"]):
                raise InputError("Complete receiving members differ from the original manifest")
            if str(uuid.UUID(manifest.get("workspaceId")))!=manifest["workspaceId"]:raise InputError("Receiving needs the original canonical workspace UUID")
            staged={};total=0
            for name,d in manifest["files"].items():
                filename(name)
                if not isinstance(d,dict)or set(d)!={"bytes","sha256"}:raise InputError("A receiving member requires its exact original byte binding")
                size=source.integer(d["bytes"],0,MAX_PACKET,"Original member size");source.identity(d["sha256"])
                total+=size
                if total>MAX_PACKET or archive.getinfo(name).file_size!=size:raise InputError("Complete original receiving bytes exceed their declaration or2GiB")
                target=Path(temp)/name;target.parent.mkdir(parents=True,exist_ok=True)
                digest=hashlib.sha256();remaining=size
                with archive.open(name)as inp,os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"wb")as out:
                    while block:=inp.read(min(65536,remaining+1)):
                        remaining-=len(block)
                        if remaining<0:raise InputError("Original receiving member exceeds its complete declared bytes")
                        digest.update(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                if remaining or digest.hexdigest()!=d["sha256"]:raise InputError("Complete original receiving member failed its byte/hash check")
                staged[name]=target
            if total!=manifest.get("totalBytes"):raise InputError("Receiving original byte total differs")
        if not {"gravity-workspace.zip","directory-registry.json"}<=set(staged):raise InputError("Receiving lacks the original complete native workspace or directory registry")
        if manifest["registrySha256"]!=manifest["files"]["directory-registry.json"]["sha256"]:raise InputError("Original registry identity differs")
        registry=source.json_value(safe_read(staged["directory-registry.json"],schema.MAX_RECORD))
        if registry.get("schema")!=REGISTRY_SCHEMA or registry.get("workspaceId")!=manifest["workspaceId"]:raise InputError("Directory registry belongs to another original schema or workspace")
        present=set(registry.get("records",{}));current=schema.KINDS-{"receives"}
        # Preserve exact historical registry bytes. The previous complete product
        # did not yet have the four additive conformance collections.
        reconciliation_previous=current-set(RECONCILIATION_KINDS)
        worksheet_previous=reconciliation_previous-set(WORKSHEET_KINDS)
        previous=worksheet_previous-set(CORRECTION_KINDS)
        prior=previous-{"operatingPlanReturns"}
        if present not in (current,reconciliation_previous,worksheet_previous,previous,prior,prior-{"operatingPlans"},prior-{"operatingPlans"}-CONFORMANCE_KINDS):
            raise InputError("Complete receiving must retain every original directory collection")
        from directory_workspace import clean_record
        for kind,rows in registry["records"].items():
            if not isinstance(rows,list)or len(rows)>100000:raise InputError("Original directory collection is not a supported complete array")
            seen=set()
            for r in rows:
                clean_record(kind,r)
                if r["id"]in seen:raise InputError("Receiving repeats an original record identity")
                seen.add(r["id"])
        required={"gravity-workspace.zip","directory-registry.json"}
        for sha,d in self._directory_files(registry).items():
            name="files/"+sha+".bin";required.add(name)
            if manifest["files"].get(name)!={"sha256":sha,"bytes":d["bytes"]}:raise InputError("Receiving omitted or changed an original directory file/index")
        if packet_schema==HANDOFF_PACKET:
            ident=source.identity(manifest.get("handoffId"));record=next((r for r in registry["records"]["handoffs"]if r["id"]==ident),None)
            if not record or "handoff.json"not in staged or source.json_value(safe_read(staged["handoff.json"],schema.MAX_RECORD))!=record:
                raise InputError("Receiving handoff differs from its frozen original selection")
            required.add("handoff.json")
            for name,d in record["files"].items():
                name="readable/"+filename(name);required.add(name)
                if manifest["files"].get(name)!={"sha256":d["sha256"],"bytes":d["bytes"]}:raise InputError("Complete readable handoff was changed")
        if set(staged)!=required:raise InputError("Receiving includes an undeclared original or private file")
        return manifest,registry,staged

    def _verify_directory_received(self,registry):
        for r in registry["records"]["sources"]:self.directory_source(r["id"])
        for r in registry["records"]["editions"]:
            for ident in r["sourceIds"]:self.directory_source(ident)
            if r.get("predecessorId"):self.directory_record("editions",r["predecessorId"])
            with self.directory_open_index("editions",r["id"])as db:
                if db.execute("PRAGMA quick_check").fetchone()[0]!="ok":raise InputError("Received original edition index is not readable")
        for r in registry["records"]["comparisons"]:
            self.directory_record("editions",r["beforeEditionId"]);self.directory_record("editions",r["afterEditionId"])
        for r in registry["records"]["requests"]:
            self.directory_record("connections",r["connectionId"])
            if r.get("discoveryId"):self.directory_record("discoveries",r["discoveryId"])
        for r in registry["records"]["acquisitions"]:
            self.directory_record("requests",r["requestId"])
            self.directory_operation(r["id"])
        for r in registry["records"]["mappings"]:
            self.directory_record("editions",r["editionId"])
            if r.get("predecessorId"):self.directory_record("mappings",r["predecessorId"])
        for r in registry["records"]["mappingPreviews"]:self.directory_record("mappings",r["mappingId"])
        for r in registry["records"]["sourceConversions"]:
            self.directory_record("mappingPreviews",r["previewId"]);self.source(r["sourceId"])
        for r in registry["records"]["selections"]:
            self.directory_record("editions",r["editionId"])
            if r.get("conversionId"):self.directory_conversion(r["conversionId"])
            self.directory_selection(r["id"])
        for r in registry["records"]["referralJoins"]:
            self.directory_record("selections",r["selectionId"]);self.directory_conversion(r["conversionId"])
            self.referral_record("editions",r["sourceEditionId"]);self.referral_record("editions",r["successorEditionId"])
            self.source(r["sourceId"])
        for r in registry["records"]["handoffs"]:
            self.directory_record("selections",r["selectionId"]);self.directory_conversion(r["conversionId"])
            if r.get("referralJoinId"):self.directory_record("referralJoins",r["referralJoinId"])

        self._verify_conformance_received(registry)
        self._verify_operating_plans_received(registry)
        self._verify_operating_returns_received(registry)
        self._verify_directory_corrections()
        self._verify_directory_correction_worksheets()
        self._verify_directory_correction_worksheet_reconciliations()

    def _receive_directory(self,packet_path,packet_schema):
        path,_,archive_id=file_info(packet_path)
        with self.mutex:
            previous=self.directory_record("receives",archive_id,required=False)
            if previous and previous["state"]=="complete":
                return {"workspaceId":self.workspace_id,"archiveSha256":archive_id,"reconstructed":True,"recovered":True,"state":self.state()}
            for other in self.directory_records("receives"):
                if other["state"]!="complete"and other["id"]!=archive_id:raise ConflictError("Resume the same original directory receiving archive before another one")
            if previous is None:
                base=BaseWorkspace.state(self)
                if any(base[k]for k in ["sources","plans","builds","comparisons"])or any(self.directory_records(k)for k in schema.KINDS-{"receives"}):
                    raise ConflictError("Receive the complete editable directory into a fresh empty workspace")
            with self.scratch()as temp:
                manifest,registry,staged=self._read_directory_packet(path,temp,packet_schema)
                if previous is None:
                    previous={"id":archive_id,"archiveSha256":archive_id,"state":"receiving","workspaceId":registry["workspaceId"],
                        "kind":"handoff"if packet_schema==HANDOFF_PACKET else "workspace","handoffId":manifest.get("handoffId"),
                        "completed":[],"createdAt":now(),"updatedAt":now(),"error":None}
                    self._directory_save("receives",previous)
                def checkpoint(step):
                    if step not in previous["completed"]:previous["completed"].append(step)
                    previous["updatedAt"]=now();previous["error"]=None;self._directory_save("receives",previous)
                try:
                    BaseWorkspace.import_workspace(self,staged["gravity-workspace.zip"])
                    if self.workspace_id!=registry["workspaceId"]:raise InputError("The native receiving changed its original workspace UUID")
                    checkpoint("complete-original-gravity-workspace")
                    for sha,d in self._directory_files(registry).items():
                        retained=self._directory_retain_file(staged["files/"+sha+".bin"],d["role"])
                        if retained["sha256"]!=sha or retained["bytes"]!=d["bytes"]:raise InputError("The original directory file changed during native receiving")
                        checkpoint("file:"+sha)
                    for kind,rows in registry["records"].items():
                        for row in rows:self._directory_save(kind,row)
                        checkpoint("records:"+kind)
                    for row in registry["records"]["acquisitions"]:
                        directory=self._directory_operation_path(row["id"])
                        journal=directory/"operation.json"
                        if journal.exists()and source.json_value(safe_read(journal,schema.MAX_RECORD))!=row:
                            raise ConflictError("An original acquisition journal has a different complete receiving body")
                        atomic_json(journal,row);self.directory_operation(row["id"])
                    self._verify_directory_received(registry)
                    previous["state"]="complete";previous["updatedAt"]=now();self._directory_save("receives",previous)
                    return {"workspaceId":self.workspace_id,"archiveSha256":archive_id,"handoffId":manifest.get("handoffId"),
                        "reconstructed":True,"state":self.state()}
                except Exception as error:
                    previous["error"]=str(error);previous["updatedAt"]=now();self._directory_save("receives",previous);raise

    def import_workspace(self,path):
        return self._receive_directory(path,WORKSPACE_PACKET)
    def import_directory_handoff(self,path):
        return self._receive_directory(path,HANDOFF_PACKET)
