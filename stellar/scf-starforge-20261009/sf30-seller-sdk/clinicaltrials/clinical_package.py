"""MIT. Complete registry/source receiving over original native packet reconstruction."""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import zipfile

from clinical_shared import HERE, SourceWorkspace, InputError, json_bytes, load_json, private_write, file_digest, sync_dir
import clinical_source as registry

PACKET = "stellar-forge.clinicaltrials-packet.v1"
SOURCE = "stellar-forge.clinicaltrials-source.v1"
MAX_PACKET = 2 * 1024 * 1024 * 1024
MAX_MEMBER = 512 * 1024 * 1024
RESERVED = {"dataset.csv","dataset.json","seller.json","source.json","binding.json","original-seller.json"}

def copy_private(source,target):
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with source.open("rb") as inp,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
        shutil.copyfileobj(inp,out,1048576);out.flush();os.fsync(out.fileno())

def info(path):
    return {"bytes":path.stat().st_size,"sha256":file_digest(path,MAX_MEMBER)}

def canonical_name(name):
    if not isinstance(name,str) or not name or "\\" in name or "\0" in name:
        raise InputError("Portable members require canonical relative paths")
    path=PurePosixPath(name)
    if path.is_absolute() or str(path)!=name or any(p in {".",".."} for p in path.parts):
        raise InputError("Portable member path is not canonical")
    return name

class PackageOperations:
    def _portable(self,destination):
        base=SourceWorkspace.state(self)
        captures=self._all("registry_captures")
        metadata={"schema":PACKET,"application":"stellar-forge.clinicaltrials-workspace.v1",
            "createdAt":registry.now(),"native":base,"captures":captures,
            "reviews":self._all("registry_reviews"),"prs":self._all("registry_prs"),
            "prsPlans":self._all("registry_prs_plans"),"prsReconciliations":self._all("registry_prs_reconciliations"),
            "metadata":{k:self._meta(k) for k in ["configuration","currentCapture","activeBuild","activePlan","lastQuery","merchant"]}}
        with self.scratch() as temp:
            members={}
            def add(name,path):
                canonical_name(name);members[name]={"path":path,**info(path)}
            for source in base["sources"]:
                path=self.root/"sources"/(source["id"]+".ndjson")
                if file_digest(path)!=source["id"]:raise InputError("Original source changed before export")
                add("native/sources/"+source["id"]+".ndjson",path)
            for plan in base["plans"]:
                path=self.root/"plans"/(plan["id"]+".json")
                if file_digest(path,65536)!=plan["id"]:raise InputError("Original mapping changed before export")
                add("native/plans/"+plan["id"]+".json",path)
            for build in base["builds"]:
                path=temp/(build["id"]+".zip")
                SourceWorkspace.export_packet(self,build["id"],path)
                add("native/builds/"+build["id"]+".zip",path)
            for capture in captures:
                folder=self.root/"registry"/capture["id"]
                if folder.exists():
                    for path in sorted(folder.iterdir()):
                        if not path.name.startswith(".stage-"):add("registry/"+capture["id"]+"/"+path.name,path)
            for path in sorted((self.root/"prs").iterdir()):
                if not path.name.startswith(".stage-"):add("prs/"+path.name,path)
            manifest={**metadata,"files":{name:{k:v for k,v in value.items() if k!="path"} for name,value in members.items()}}
            if len(members)>20000 or sum(v["bytes"] for v in members.values())>MAX_PACKET:
                raise InputError("Portable source exceeds the 20,000-member / 2 GiB receiving capacity")
            with os.fdopen(os.open(destination,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600),"w+b") as out:
                with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    archive.writestr("manifest.json",json_bytes(manifest))
                    for name,value in members.items():archive.write(value["path"],name)
                out.flush();os.fsync(out.fileno())
            return manifest

    def export_customer(self,build_id,request_id):
        with self.mutex:
            build=self.build_view(build_id)
            capture=next((c for c in reversed(self._all("registry_captures"))
                if c.get("source")==build["source"] and c["status"]=="completed"),None)
            if capture is None:raise InputError("This native build is not bound to a completed registry cohort")
            ident="export-"+request_id
            prior=self.db.execute("SELECT body FROM registry_exports WHERE id=?",(ident,)).fetchone()
            if prior:return self.verify_export(ident)
            destination=self.root/"exports"/ident;destination.mkdir(mode=0o700,exist_ok=False)
            try:
                copy_private(self._build_path(build_id,"data.csv"),destination/"dataset.csv")
                config=load_json(self._build_path(build_id,"dataset.json").read_bytes());config["file"]="dataset.csv"
                private_write(destination/"dataset.json",json_bytes(config))
                SourceWorkspace.export_packet(self,build_id,destination/"native-project.zip")
                self._portable(destination/"clinicaltrials-workspace.zip")
                source_folder=destination/"source";source_folder.mkdir(mode=0o700)
                copy_private(self.root/"sources"/(build["source"]+".ndjson"),source_folder/"whole-studies.ndjson")
                copy_private(self.root/"plans"/(build["plan"]+".json"),source_folder/"mapping.json")
                private_write(source_folder/"native-build.json",json_bytes(build))
                private_write(source_folder/"capture.json",json_bytes(capture))
                reviews=[r for r in self._all("registry_reviews") if r["captureId"]==capture["id"]]
                private_write(source_folder/"study-reviews.json",json_bytes(reviews))
                for path in sorted((self.root/"registry"/capture["id"]).iterdir()):
                    if not path.name.startswith(".stage-"):copy_private(path,source_folder/"responses"/path.name)
                for path in sorted((HERE/"contracts").iterdir()):
                    if path.is_file() and not path.is_symlink():copy_private(path,destination/"contracts"/path.name)
                for path in sorted((self.root/"prs").iterdir()):
                    if not path.name.startswith(".stage-"):copy_private(path,source_folder/"prs"/path.name)
                query=self._meta("lastQuery")
                if not query or query.get("buildId")!=build_id:
                    query={"buildId":build_id,"initialQuery":{"limit":"50"},"query":{"limit":"50"},
                           "snapshot":build["native"]["snapshot"],"nextCursor":None}
                private_write(destination/"query.json",json_bytes({"schema":"stellar-forge.dataset-query.v1",
                    "snapshot":build["native"]["snapshot"],"query":query["initialQuery"],
                    "lastQuery":query["query"],"nextCursor":query["nextCursor"]}))
                merchant=self._meta("merchant")
                native=self.publisher.call("dataset.prepare" if merchant else "dataset.inspect",
                    {"directory":str(destination),"expectedSnapshot":build["native"]["snapshot"],**(merchant or {})})
                readme="\n".join([
                    "# ClinicalTrials registry customer package","",
                    "This delivery retains the complete selected public registry cohort, original provider pages and version requests, reviewed mapping, study decisions, native dataset and a portable source workspace.",
                    "Cohort: "+capture["configuration"]["name"],
                    "Provider data timestamp (UTC): "+capture["version"]["dataTimestamp"],
                    "Captured studies: "+str(capture["rowCount"]),
                    "Native snapshot: "+build["native"]["snapshot"],"",
                    "## Receive the original workspace","",
                    "Run starforge clinicaltrials --workspace NEW_DIRECTORY init, then starforge clinicaltrials --workspace NEW_DIRECTORY restore --file clinicaltrials-workspace.zip.",
                    "The original NDJSON engine re-inventories the source, checks each mapping, reconstructs native builds and verifies exported CSV/config/snapshots. Registry raw pages, reviewed decisions and PRS source/candidate records reopen with it.",
                    "Run serve to open the same operator. query.json keeps its initial replay separately from the last accepted page and original continuation cursor.","",
                    "## Review and publish","",
                    "dataset.csv and dataset.json use the original SF30 engine. source.json binds every raw input and review file through the original SF82 sourceFiles contract.",
                    "When seller.json is present, Publisher prepares this exact export in the original dataset/release engine. Review its version, source and merchant terms before activating a release or a customer request.",
                    "customer/ contains the generated original seller client when merchant terms were configured.","",
                    "## Registry interpretation","",
                    "Whole protocol/results/annotation/document/derived records remain in source/whole-studies.ndjson and exact provider responses. A projected blank is interpreted together with its explicit state column.",
                    "Full or partial dates remain source strings. Numeric conversion is applied only to explicitly typed mapped columns. Cohort membership and study-review decisions remain separate from registry field values.",
                    "Public API: https://clinicaltrials.gov/data-api/api",
                    "PRS notice: https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html",
                    "Current schemas and every original provider request are included.",""])
                private_write(destination/"RECEIVING.md",readme.encode())
                source_files=[{"path":path.relative_to(destination).as_posix(),**info(path)}
                    for path in sorted(destination.rglob("*")) if path.is_file() and path.relative_to(destination).as_posix() not in RESERVED]
                descriptor={"schema":SOURCE,"provider":"ClinicalTrials.gov","base":registry.BASE,
                    "captureId":capture["id"],"configuration":capture["configuration"],"version":capture["version"],
                    "captureCompletedAt":capture["completedAt"],"rowCount":capture["rowCount"],
                    "wholeStudySourceSha256":build["source"],"mappingSha256":build["plan"],
                    "nativeBuildId":build_id,"nativeSnapshot":build["native"]["snapshot"],
                    "nativeContract":native,"reviewCount":len(reviews),"sourceFiles":source_files}
                private_write(destination/"source.json",json_bytes(descriptor))
                files=[{"name":p.relative_to(destination).as_posix(),**info(p)}
                       for p in sorted(destination.rglob("*")) if p.is_file()]
                result={"id":ident,"directory":str(destination),"createdAt":registry.now(),"buildId":build_id,
                    "captureId":capture["id"],"snapshot":build["native"]["snapshot"],"rowCount":build["rowCount"],"files":files}
                sync_dir(destination)
                with self.db:self.db.execute("INSERT INTO registry_exports VALUES(?,?)",(ident,json_bytes(result).decode()))
                return result
            except BaseException:
                shutil.rmtree(destination,ignore_errors=True);raise

    def verify_export(self,ident):
        row=self.db.execute("SELECT body FROM registry_exports WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained registry export")
        value=load_json(row[0]);directory=self.root/"exports"/value["id"]
        if directory.is_symlink() or not directory.is_dir():raise InputError("Retained export directory changed")
        for item in value["files"]:
            path=directory/canonical_name(item["name"])
            if info(path)!={k:item[k] for k in ["bytes","sha256"]}:
                raise InputError("Retained export file changed: "+item["name"])
        return value

    def read_export(self,ident,name):
        with self.mutex:
            value=self.verify_export(ident)
            selected=next((f for f in value["files"] if f["name"]==name),None)
            if not selected:raise InputError("Select a file from this retained export")
            return {"path":self.root/"exports"/ident/name,"filename":Path(name).name,**selected}

    def restore_customer(self,path):
        with self.mutex,self.scratch() as temp:
            actual=file_digest(path,MAX_PACKET);previous=self._meta("importing")
            has_data=bool(SourceWorkspace.state(self)["sources"] or self._all("registry_captures"))
            if has_data and previous!=actual:
                if self._meta("restoredFrom")==actual:return {"restored":True,"sourceSha256":actual,"alreadyRestored":True}
                raise InputError("Receive the portable workspace into an empty original workspace")
            with zipfile.ZipFile(path) as archive:
                infos=archive.infolist();names=[i.filename for i in infos]
                if len(names)!=len(set(names)) or len(names)>20001 or "manifest.json" not in names:
                    raise InputError("Portable package has duplicate or excessive members")
                manifest_info=archive.getinfo("manifest.json")
                if manifest_info.file_size>16*1024*1024:raise InputError("Portable manifest is too large")
                manifest=load_json(archive.read(manifest_info))
                if manifest.get("schema")!=PACKET or manifest.get("application")!="stellar-forge.clinicaltrials-workspace.v1":
                    raise InputError("Use an original ClinicalTrials portable workspace")
                entries=manifest.get("files")
                if not isinstance(entries,dict) or set(names)!=set(entries)|{"manifest.json"}:
                    raise InputError("Portable member list differs from its manifest")
                if sum(i.file_size for i in infos)>MAX_PACKET:raise InputError("Portable input exceeds 2 GiB")
                for item in infos:
                    if item.filename=="manifest.json":continue
                    name=canonical_name(item.filename);mode=item.external_attr>>16
                    if item.flag_bits&1 or item.is_dir() or stat.S_ISLNK(mode) or item.file_size>MAX_MEMBER or item.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}:
                        raise InputError("Unsupported portable member")
                    target=temp/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                    with archive.open(item) as inp,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                        size=0
                        while block:=inp.read(1048576):
                            size+=len(block)
                            if size>item.file_size or size>MAX_MEMBER:raise InputError("Portable member grew beyond its declared size")
                            out.write(block)
                    if info(target)!=entries[name]:raise InputError("Portable member bytes differ from their original SHA256")
            self._set("importing",actual);native=manifest["native"]
            for source in native["sources"]:
                original=temp/"native"/"sources"/(source["id"]+".ndjson")
                with original.open("rb") as inp:received=self.add_source(inp,source["label"],source["name"])
                if received["id"]!=source["id"]:raise InputError("Original source identity changed during receiving")
            for plan in native["plans"]:
                mapped=self.save_plan(load_json((temp/"native"/"plans"/(plan["id"]+".json")).read_bytes()))
                if mapped["id"]!=plan["id"]:raise InputError("Original mapping identity changed during receiving")
            for build in native["builds"]:
                received=SourceWorkspace.import_packet(self,temp/"native"/"builds"/(build["id"]+".zip"))
                if received["build"]["native"]["snapshot"]!=build["native"]["snapshot"]:
                    raise InputError("Original native snapshot changed during receiving")
            for capture in manifest["captures"]:
                ident=capture["id"]
                if not isinstance(ident,str) or not ident.startswith("capture-") or "/" in ident or "\\" in ident:
                    raise InputError("Invalid retained capture identity")
                original=temp/"registry"/ident;target=self.root/"registry"/ident
                target.mkdir(mode=0o700,exist_ok=True)
                if original.exists():
                    for source in original.iterdir():
                        dest=target/source.name
                        if dest.exists():
                            if info(dest)!=info(source):raise InputError("Resumed registry capture files differ")
                        else:copy_private(source,dest)
                expected=0;seen=set()
                with self.db:
                    self.db.execute("DELETE FROM registry_studies WHERE capture=?",(ident,))
                    for index,page in enumerate(capture["pages"]):
                        raw=self._verified(page["bodyPath"],page["sha256"]).read_bytes()
                        studies,token,total=registry.page(raw)
                        expected_url=registry.study_url(capture["configuration"],page.get("tokenUsed"),index==0)
                        if page.get("url")!=expected_url:raise InputError("Retained request differs from the selected original cohort")
                        if index==0 and (page.get("tokenUsed") is not None or total!=capture["expectedRows"]):
                            raise InputError("Original first-page count or request changed")
                        if page["index"]!=index or page["nextPageToken"]!=token:
                            raise InputError("Retained registry token chain changed")
                        if index and page["tokenUsed"]!=capture["pages"][index-1]["nextPageToken"]:
                            raise InputError("Retained registry page chain is discontinuous")
                        combined=b"".join(b for _,b in studies)
                        if registry.sha(combined)!=page["ndjsonSha256"]:
                            raise InputError("Whole study projection differs from the original raw response")
                        self._verified(page["ndjsonPath"],page["ndjsonSha256"],256*1024*1024)
                        offset=0
                        for brief,raw_study in studies:
                            if brief["nctId"] in seen:raise InputError("Portable cohort repeats an original NCT study")
                            seen.add(brief["nctId"])
                            self.db.execute("INSERT INTO registry_studies VALUES(?,?,?,?,?,?,?)",
                                (ident,brief["nctId"],index,offset,len(raw_study),registry.sha(raw_study),json_bytes(brief).decode()))
                            offset+=len(raw_study);expected+=1
                    if expected!=capture["rowCount"]:raise InputError("Received cohort has a different study count")
                    if capture["status"]=="completed" and capture["expectedRows"] is not None and expected!=capture["expectedRows"]:
                        raise InputError("Completed original totalCount differs from the received cohort")
                    versions=[]
                    for request in capture.get("versionRequests",[]):
                        body=self._verified(request["bodyPath"],request["sha256"]).read_bytes()
                        versions.append(registry.version(body))
                    if capture["status"]=="completed" and (len(versions)<2 or any(v!=capture["version"] for v in versions)):
                        raise InputError("Original complete capture lacks a consistent before/after provider version")
                    if capture["status"]=="completed" and (not capture["pages"] or capture["pages"][-1]["nextPageToken"] is not None):
                        raise InputError("Completed cohort is missing the final original page")
                    self.db.execute("INSERT OR REPLACE INTO registry_captures VALUES(?,?)",(ident,json_bytes(capture).decode()))
            for record in manifest["prs"]:
                for suffix in [".xml",".json"]:
                    original=temp/"prs"/(record["id"]+suffix);target=self.root/"prs"/original.name
                    if target.exists():
                        if info(original)!=info(target):raise InputError("Received PRS source differs from retained bytes")
                    else:copy_private(original,target)
                with self.db:self.db.execute("INSERT OR REPLACE INTO registry_prs VALUES(?,?)",(record["id"],json_bytes(record).decode()))
            for key,table,prefix in [("prsPlans","registry_prs_plans","plan-"),
                                     ("prsReconciliations","registry_prs_reconciliations","reconciliation-")]:
                for record in manifest.get(key,[]):
                    original=temp/"prs"/(prefix+record["id"]+".json")
                    if file_digest(original,64*1024*1024)!=record["id"]:
                        raise InputError("Retained PRS plan or reconciliation identity changed")
                    target=self.root/"prs"/original.name
                    if target.exists():
                        if info(target)!=info(original):raise InputError("Retained PRS review conflicts during receiving")
                    else:copy_private(original,target)
                    with self.db:self.db.execute("INSERT OR REPLACE INTO "+table+" VALUES(?,?)",
                                                (record["id"],json_bytes(record).decode()))
            for record in manifest["reviews"]:
                with self.db:self.db.execute("INSERT OR IGNORE INTO registry_reviews VALUES(?,?)",(record["id"],json_bytes(record).decode()))
            for key,value in manifest["metadata"].items():
                if key not in {"configuration","currentCapture","activeBuild","activePlan","lastQuery","merchant"}:
                    raise InputError("Unexpected portable workspace selection")
                self._set(key,value)
            for comparison in native.get("comparisons",[]):
                self.compare(comparison["before"],comparison["after"])
            self._set("restoredFrom",actual);self._set("importing",None)
            return {"restored":True,"sourceSha256":actual,"captures":len(manifest["captures"]),
                    "studies":sum(c["rowCount"] for c in manifest["captures"]),
                    "builds":[{"id":b["id"],"snapshot":b["native"]["snapshot"],"rowCount":b["rowCount"]} for b in native["builds"]]}
