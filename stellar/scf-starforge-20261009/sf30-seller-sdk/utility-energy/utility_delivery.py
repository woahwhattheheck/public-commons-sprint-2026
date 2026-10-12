"""MIT. Complete utility source, review and original native customer receiving."""
from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import zipfile

from utility_shared import HERE,SourceWorkspace,InputError,json_bytes,load_json,private_write,file_digest,sync_dir
from utility_source import sha

PACKET="stellar-forge.utility-workspace-packet.v1"
DELIVERY="stellar-forge.utility-customer-delivery.v1"
SOURCE="stellar-forge.utility-source-delivery.v1"
MAX_PACKET=2*1024*1024*1024
MAX_MEMBER=512*1024*1024
RESERVED={"dataset.csv","dataset.json","seller.json","source.json","binding.json","original-seller.json"}

def member(name):
    if not isinstance(name,str) or not name or "\\" in name or "\0" in name:
        raise InputError("Use a declared portable relative file")
    path=PurePosixPath(name)
    if path.is_absolute() or str(path)!=name or any(part in {"",".",".."} for part in path.parts):
        raise InputError("Portable member path is not canonical")
    return name

def info(path):
    path=Path(path)
    if path.is_symlink() or not path.is_file():raise InputError("Use an original retained regular file")
    return {"bytes":path.stat().st_size,"sha256":file_digest(path,MAX_MEMBER)}

def copy_private(source,target):
    source,target=Path(source),Path(target)
    if source.is_symlink() or not source.is_file():raise InputError("Original delivery file is not regular")
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if target.exists():
        if info(source)!=info(target):raise InputError("Customer files share a name with different original bytes")
        return
    with source.open("rb") as inp,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
        shutil.copyfileobj(inp,out,1048576);out.flush();os.fsync(out.fileno())

def write_zip(destination,members,manifest):
    destination=Path(destination)
    if len(members)>20000 or sum(item["bytes"] for item in members.values())>MAX_PACKET:
        raise InputError("Portable receiving capacity is 20,000 files and 2 GiB")
    with os.fdopen(os.open(destination,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600),"w+b") as out:
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            archive.writestr("manifest.json",json_bytes(manifest))
            for name,item in members.items():
                member(name)
                if info(item["path"])!={key:item[key] for key in ("bytes","sha256")}:
                    raise InputError("Retained member changed while packaging: "+name)
                archive.write(item["path"],name)
        out.flush();os.fsync(out.fileno())

class DeliveryOperations:
    def portable(self,destination):
        from utility_workspace import now
        with self.mutex,self.scratch() as temp:
            native=SourceWorkspace.state(self)
            metadata={key:self.all(key) for key in ("imports","previews","reviews","reconciliations","captures")}
            metadata["received_export_manifests"]=self.all("exports")+self.meta("received_export_manifests",[])
            metadata["actions"]=[{**load_json(row["body"]),"fingerprint":row["fingerprint"]}
                for row in self.db.execute("SELECT fingerprint,body FROM utility_actions ORDER BY rowid")
                if load_json(row["body"])["status"] in {"COMPLETE","FAILED"}]
            metadata["metadata"]={row["k"]:load_json(row["body"])
                for row in self.db.execute("SELECT k,body FROM utility_meta")
                if row["k"] not in {"restore_in_progress","restored_from"}}
            members={}
            def add(name,path):
                if name in members:raise InputError("A portable file was declared twice")
                members[member(name)]={"path":Path(path),**info(path)}
            for source in native["sources"]:
                path=self.root/"sources"/(source["id"]+".ndjson")
                if file_digest(path)!=source["id"]:raise InputError("Original normalized source changed")
                add("native/sources/"+source["id"]+".ndjson",path)
            for plan in native["plans"]:
                path=self.root/"plans"/(plan["id"]+".json")
                if file_digest(path,65536)!=plan["id"]:raise InputError("Original native mapping changed")
                add("native/plans/"+plan["id"]+".json",path)
            for build in native["builds"]:
                path=temp/(build["id"]+".zip")
                SourceWorkspace.export_packet(self,build["id"],path)
                add("native/builds/"+build["id"]+".zip",path)
            for path in sorted((self.root/"utility").rglob("*")):
                if path.is_file() and not any(part.startswith(".stage-") for part in path.relative_to(self.root/"utility").parts):
                    add(path.relative_to(self.root).as_posix(),path)
            manifest={"schema":PACKET,"application":"stellar-forge.utility-workspace.v1","created_at":now(),
                "native":native,**metadata,
                "files":{name:{key:value[key] for key in ("bytes","sha256")} for name,value in members.items()}}
            write_zip(destination,members,manifest)
            return manifest

    def export_customer(self,review_id,request_id):
        from utility_workspace import now
        with self.mutex:
            reviewed,preview,rows=self.review_rows(review_id)
            binding=self.meta("build:"+review_id)
            if not binding:raise InputError("Build the selected original interval review before export")
            build=self.build_view(binding["build_id"])
            ident=sha(json_bytes({"review_id":review_id,"request_id":request_id}))
            existing=self.db.execute("SELECT 1 FROM utility_exports WHERE id=?",(ident,)).fetchone()
            if existing:return self.verify_export(ident)
            destination=self.root/"exports"/ident
            destination.mkdir(mode=0o700,exist_ok=False)
            try:
                copy_private(self._build_path(build["id"],"data.csv"),destination/"dataset.csv")
                config=load_json(self._build_path(build["id"],"dataset.json").read_bytes())
                config["file"]="dataset.csv"
                private_write(destination/"dataset.json",(json.dumps(config,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n").encode())
                SourceWorkspace.export_packet(self,build["id"],destination/"native-project.zip")
                self.portable(destination/"utility-workspace.zip")
                source_dir=destination/"source";source_dir.mkdir(mode=0o700)
                copy_private(self.root/"sources"/(build["source"]+".ndjson"),source_dir/"reviewed-intervals.ndjson")
                copy_private(self.root/"plans"/(build["plan"]+".json"),source_dir/"mapping.json")
                private_write(source_dir/"native-build.json",json_bytes(build))
                private_write(source_dir/"interval-selection.json",json_bytes(preview))
                private_write(source_dir/"review.json",json_bytes(reviewed))
                selected=[]
                for item in preview["report"]["sources"]:
                    imported=self.saved("imports",item["id"]);selected.append(imported)
                    copy_private(self.original(imported["id"]),source_dir/"originals"/imported["original_name"])
                    for collection,source_id in imported["native_sources"].items():
                        name=imported["id"]+"-"+collection+".ndjson"
                        copy_private(self.root/"sources"/(source_id+".ndjson"),source_dir/"normalized"/name)
                private_write(source_dir/"imports.json",json_bytes(selected))
                reconciliations=[r for r in self.all("reconciliations") if r["review_id"]==review_id]
                private_write(source_dir/"bill-reconciliations.json",json_bytes(reconciliations))
                for path in sorted((HERE/"contracts").rglob("*")):
                    if path.is_file():
                        copy_private(path,destination/"contracts"/path.relative_to(HERE/"contracts"))
                if preview["report"]["can_export_load"]:
                    with os.fdopen(os.open(destination/"reviewed-energy-profile.csv",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"w",encoding="utf-8",newline="") as out:
                        writer=csv.writer(out,lineterminator="\n")
                        writer.writerow(["meter_id","series_id","channel","start_utc","end_utc","duration_seconds","energy_kwh","source_row_id"])
                        for row in rows:
                            writer.writerow([row["meter_id"],row["series_id"],row["channel"],row["start_utc"],row["end_utc"],
                                             row["duration_seconds"],row["energy_kwh"],row["row_id"]])
                        out.flush();os.fsync(out.fileno())
                private_write(destination/"profile-contract.json",json_bytes({
                    "schema":"stellar-forge.utility-energy-profile.v1",
                    "included":preview["report"]["can_export_load"],"time_basis":"UTC",
                    "period":"start inclusive, end exclusive","quantity":"kWh for each complete original interval",
                    "series_are_separate":True,"resampling":"none",
                    "selection_sha256":preview["report"]["sha256"],"series":preview["report"]["series"],
                    "consumer_mapping":{"start":"start_utc","end":"end_utc","interval_seconds":"duration_seconds",
                                        "energy_kwh":"energy_kwh","meter":"meter_id","series":"series_id"},
                    "receiving":"Choose the intended meter and channel, retain the reported interval durations, and map these columns in the receiving product."}))
                query=self.meta("last_query")
                if not query or query.get("build_id")!=build["id"]:
                    query={"build_id":build["id"],"query":{"limit":"100"},"snapshot":build["native"]["snapshot"]}
                private_write(destination/"query.json",json_bytes(query))
                merchant=self.meta("merchant")
                native=self.publisher.call("dataset.prepare" if merchant else "dataset.inspect",
                    {"directory":str(destination),"expectedSnapshot":build["native"]["snapshot"],**(merchant or {})})
                readme="\n".join([
                    "# Utility data customer receiving","",
                    "This package contains the reviewed original utility readings, provider source bytes, full normalized resources, correction decisions, bill reconciliation, native dataset, and a portable source workspace.",
                    "Review: "+reviewed["name"],"Reviewer: "+reviewed["reviewer"],
                    "Selected original readings: "+str(len(rows)),
                    "Native snapshot: "+build["native"]["snapshot"],"",
                    "## Open the complete original workspace","",
                    "Run starforge utility-energy --workspace NEW_DIRECTORY init.",
                    "Then run starforge utility-energy --workspace NEW_DIRECTORY restore --file utility-workspace.zip.",
                    "Run starforge utility-energy --workspace NEW_DIRECTORY serve and open its private local URL.",
                    "The original NDJSON/XML application rebuilds its normalized source inventory, reviewed mappings, exact native CSV/config/snapshots and edition comparisons. Original utility responses, raw XML, interval choices, review notes, billing reconciliations, capture receipts and completed operation history reopen with it.",
                    "UtilityAPI collection resumes only when the receiving process has the named token environment variable. Source metadata retains the original next URLs and Retry-After state.",
                    "",
                    "## Dataset and energy profile","",
                    "dataset.csv and dataset.json use the original native SF30 query engine. query.json retains the last accepted query and its snapshot. native-project.zip also opens through the original NDJSON application.",
                    "reviewed-energy-profile.csv is included when the review selects energy intervals with valid periods and no overlaps or partial boundary rows. Meter/channel series remain separate. Gaps and mixed durations are listed in profile-contract.json.",
                    "The profile contains whole original interval energy in kWh. Start is inclusive and end is exclusive in UTC. Choose the intended channel and map the declared timestamp, duration and energy columns in the receiving analysis product.",
                    "Green Button quantities follow the original ReadingType unit, multiplier, accumulation and kind. Source LocalTimeParameters retain the original daylight saving rules. UtilityAPI fwd/rev/net/gen/max remain separate; bills, supplier charges, TOU, demand and power blocks remain available in their original resources.",
                    "",
                    "## Publishing and customer integration","",
                    "source.json binds the original inputs, review, native contract and every supporting file through the existing SF82 sourceFiles contract. Configure merchant terms to include seller.json, OpenAPI and the generated customer client.",
                    "Publisher prepares this exact package in the existing version, draft, release and customer engine. Its live releases remain owned by that publisher process. The portable source workspace carries source/review history and merchant configuration.",
                    "",
                    "## Retained source contracts","",
                    "UtilityAPI intervals: https://utilityapi.com/docs/api/intervals",
                    "UtilityAPI blocks: https://utilityapi.com/docs/api/intervals/blocks",
                    "UtilityAPI bills: https://utilityapi.com/docs/api/bills/blocks",
                    "Green Button developer resources: https://dev.greenbuttonalliance.org/",
                    "Exact schema and published example provenance is included under contracts/.",
                    ""])
                private_write(destination/"RECEIVING.md",readme.encode())
                source_files=[{"path":path.relative_to(destination).as_posix(),**info(path)}
                    for path in sorted(destination.rglob("*")) if path.is_file() and path.relative_to(destination).as_posix() not in RESERVED]
                descriptor={"schema":SOURCE,"provider":"UtilityAPI / Green Button",
                    "review_id":review_id,"preview_sha256":preview["report"]["sha256"],
                    "sources":[{"id":item["id"],"provider":item["provider"],"source_sha256":item["source_sha256"],
                                "bytes":item["bytes"],"metadata_sha256":item["metadata_sha256"]} for item in selected],
                    "nativeBuildId":build["id"],"nativeSnapshot":build["native"]["snapshot"],
                    "rowCount":len(rows),"nativeContract":native,"sourceFiles":source_files}
                private_write(destination/"source.json",json_bytes(descriptor))
                files=[{"name":path.relative_to(destination).as_posix(),**info(path)}
                    for path in sorted(destination.rglob("*")) if path.is_file()]
                result={"schema":DELIVERY,"id":ident,"created_at":now(),"review_id":review_id,
                    "build_id":build["id"],"snapshot":build["native"]["snapshot"],
                    "row_count":len(rows),"files":files,"bytes":sum(item["bytes"] for item in files)}
                private_write(destination/"delivery.json",json_bytes(result));sync_dir(destination)
                self.save("exports",result)
                return result
            except BaseException:
                shutil.rmtree(destination,ignore_errors=True);raise

    def verify_export(self,ident):
        value=self.saved("exports",ident);directory=self.root/"exports"/ident
        if directory.is_symlink() or not directory.is_dir():raise InputError("Original export directory changed")
        if (directory/"delivery.json").is_symlink() or (directory/"delivery.json").read_bytes()!=json_bytes(value):
            raise InputError("Original delivery manifest changed")
        for item in value["files"]:
            path=directory/member(item["name"])
            if info(path)!={key:item[key] for key in ("bytes","sha256")}:
                raise InputError("Original delivery member changed: "+item["name"])
        return value

    def export_file(self,ident,name):
        value=self.verify_export(ident)
        item=next((x for x in value["files"] if x["name"]==name),None)
        if name=="delivery.json":item={"name":name,**info(self.root/"exports"/ident/name)}
        if item is None:raise InputError("Choose a declared customer delivery file")
        return {"path":self.root/"exports"/ident/member(name),"filename":Path(name).name,**item}

    def export_zip(self,ident,destination):
        value=self.verify_export(ident)
        members={item["name"]:{"path":self.root/"exports"/ident/item["name"],"bytes":item["bytes"],"sha256":item["sha256"]}
                 for item in value["files"]}
        members["delivery.json"]={"path":self.root/"exports"/ident/"delivery.json",**info(self.root/"exports"/ident/"delivery.json")}
        write_zip(destination,members,{"schema":DELIVERY,"delivery":value,
            "files":{name:{key:item[key] for key in ("bytes","sha256")} for name,item in members.items()}})
        return {"path":Path(destination),"filename":"utility-customer-delivery.zip",**info(destination)}

    def restore_customer(self,path,expected_sha256=None):
        from utility_workspace import immutable
        path=Path(path)
        with self.mutex,self.scratch() as temp:
            actual=file_digest(path,MAX_PACKET)
            if expected_sha256 and expected_sha256!=actual:raise InputError("Portable source differs from its supplied SHA256")
            prior=self.meta("restore_in_progress")
            populated=bool(SourceWorkspace.state(self)["sources"] or any(self.all(name) for name in ("imports","previews","reviews","reconciliations","captures","exports")))
            if populated and prior!=actual:
                if self.meta("restored_from")==actual:
                    return {"restored":True,"already_restored":True,"source_sha256":actual}
                raise InputError("Receive this complete source into an empty original utility workspace")
            with zipfile.ZipFile(path) as archive:
                infos=archive.infolist();names=[item.filename for item in infos]
                if len(names)!=len(set(names)) or len(names)>20001 or "manifest.json" not in names:
                    raise InputError("Portable package has duplicate or excessive files")
                manifest_info=archive.getinfo("manifest.json")
                if manifest_info.file_size>32*1024*1024:raise InputError("Portable manifest exceeds 32 MiB")
                manifest=load_json(archive.read(manifest_info))
                if manifest.get("schema")!=PACKET or manifest.get("application")!="stellar-forge.utility-workspace.v1":
                    raise InputError("Use an original Utility workspace packet")
                entries=manifest.get("files")
                if not isinstance(entries,dict) or set(names)!=set(entries)|{"manifest.json"}:
                    raise InputError("Portable files differ from the original manifest")
                if sum(item.file_size for item in infos)>MAX_PACKET:
                    raise InputError("Portable input exceeds 2 GiB")
                for item in infos:
                    if item.filename=="manifest.json":continue
                    name=member(item.filename);mode=item.external_attr>>16
                    if item.flag_bits&1 or item.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0,stat.S_IFREG}) or item.file_size>MAX_MEMBER or item.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}:
                        raise InputError("Unsupported portable file or compression")
                    target=temp/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                    with archive.open(item) as inp,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                        total=0
                        while block:=inp.read(1048576):
                            total+=len(block)
                            if total>item.file_size or total>MAX_MEMBER:raise InputError("Portable file grew beyond its declared size")
                            out.write(block)
                    if info(target)!=entries[name]:raise InputError("Portable source identity differs: "+name)
            self.set_meta("restore_in_progress",actual)
            native=manifest["native"]
            from utility_workspace import checked_id
            for table in ("sources","plans","builds"):
                for retained in native[table]:checked_id(retained["id"])
            for comparison in native["comparisons"]:
                checked_id(comparison["id"]);checked_id(comparison["before"]);checked_id(comparison["after"])
            for original in manifest["imports"]:
                data=(temp/"utility"/"originals"/member(original["original_name"])).read_bytes()
                self.import_source(data,original["name"],original["provider"],original["kind"],
                    original.get("context"),original.get("capture_id"),retained=original)
            for retained in native["sources"]:
                source_path=temp/"native"/"sources"/(retained["id"]+".ndjson")
                with source_path.open("rb") as stream:
                    received=SourceWorkspace.add_source(self,stream,retained["label"],retained["name"])
                if received["id"]!=retained["id"]:raise InputError("Original native source differs after receiving")
            for retained in native["plans"]:
                result=SourceWorkspace.save_plan(self,load_json((temp/"native"/"plans"/(retained["id"]+".json")).read_bytes()))
                if result["id"]!=retained["id"]:raise InputError("Original native mapping differs after receiving")
            for retained in native["builds"]:
                result=SourceWorkspace.import_packet(self,temp/"native"/"builds"/(retained["id"]+".zip"))
                received=self.build_view(retained["id"])
                if received["native"]["snapshot"]!=retained["native"]["snapshot"]:
                    raise InputError("Original native snapshot differs after receiving")
            for comparison in native["comparisons"]:
                result=SourceWorkspace.compare(self,comparison["before"],comparison["after"])
                if result!=comparison:raise InputError("Original native edition changes differ after receiving")
            for name in entries:
                if not name.startswith("utility/"):continue
                target=self.root/name
                target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                immutable(target,(temp/name).read_bytes())
            for table in ("previews","reviews","reconciliations","captures"):
                for record in manifest[table]:self.save(table,record)
            with self.db:
                for record in manifest.get("actions",[]):
                    request=record["request_id"];fingerprint=record["fingerprint"]
                    if record.get("status") not in {"COMPLETE","FAILED"}:raise InputError("Portable history includes an unfinished operation")
                    existing=self.db.execute("SELECT fingerprint,body FROM utility_actions WHERE id=?",(request,)).fetchone()
                    if existing is not None and (existing["fingerprint"]!=fingerprint or load_json(existing["body"])!=record):
                        raise InputError("Portable operation history conflicts with the receiving workspace")
                    self.db.execute("INSERT OR IGNORE INTO utility_actions VALUES(?,?,?)",(request,fingerprint,json_bytes(record).decode()))
            for key,value in manifest["metadata"].items():
                if key not in {"revision","application","restore_in_progress","restored_from"}:self.set_meta(key,value)
            self.set_meta("received_source_revision",manifest["metadata"].get("revision",0))
            self.set_meta("received_export_manifests",manifest.get("received_export_manifests",[]))
            self.set_meta("received_action_ids",[row["request_id"] for row in manifest.get("actions",[])])
            for record in manifest["reviews"]:
                self.review_rows(record["id"])
                binding=self.meta("build:"+record["id"])
                if binding:self.build_view(binding["build_id"])
            self.set_meta("restored_from",actual);self.set_meta("restore_in_progress",None)
            return {"restored":True,"source_sha256":actual,
                "imports":len(manifest["imports"]),"reviews":len(manifest["reviews"]),
                "reconciliations":len(manifest["reconciliations"]),"captures":len(manifest["captures"]),
                "native_builds":len(native["builds"]),"comparisons":len(native["comparisons"])}
