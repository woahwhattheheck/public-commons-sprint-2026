"""MIT. Reviewed OAI record editions, original XML projection, complete portable handoff."""
from __future__ import annotations
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile
import zipfile
from bridge import xml, storage, InputError
from protocol import Q, unpacked
from harvest import HarvestWorkspace, plain, page_values, jbytes, decode, sha, stamp

def member(name):
    p=PurePosixPath(name) if isinstance(name,str) else None
    if p is None or not name or len(name)>1024 or "\\" in name or "\x00" in name or p.is_absolute() or \
            str(p)!=name or any(x in {"",".",".."} for x in p.parts):
        raise InputError("Invalid retained package member")
    return name

class Workspace(HarvestWorkspace):
    def observation(self,identity):
        with self.mutex:
            row=self.db.execute("SELECT body FROM oai_observations WHERE id=?", (identity,)).fetchone()
            if not row: raise InputError("Record observation was not found")
            return decode(row[0])

    def edition(self,identity):
        with self.mutex: return self._get("oai_editions",identity)

    def preview(self,operation_id,choices=None):
        choices=choices or {}
        if not isinstance(choices,dict): raise InputError("Conflict choices must map exact identifiers to observations and review notes")
        with self.mutex,self.db:
            op=self.operation(operation_id)
            if op["verb"]!="ListRecords" or op["status"]!="COMPLETE":
                raise InputError("Complete every ListRecords continuation before reviewing its edition")
            baseline=self.edition(op["baseline"]) if op.get("baseline") else None
            if baseline and (baseline["repository"]["id"]!=op["repositoryId"] or
                             baseline["selection"].get("metadataPrefix")!=op["selection"].get("metadataPrefix") or
                             baseline["selection"].get("set")!=op["selection"].get("set")):
                raise InputError("The baseline must use this exact repository, metadata format and set selection")
            temp=sha(os.urandom(32))
            binding={"operationId":operation_id,"attempt":op["attempt"],"operationRevision":op["revision"],
                     "baseline":op.get("baseline"),"choices":choices}
            h=hashlib.sha256(jbytes(binding))
            counts={x:0 for x in ("added","updated","deleted","reinstated","unchanged","retained","older","conflict")}
            seen_choices=set()
            sql="""SELECT identifier FROM oai_observations WHERE operation_id=? AND attempt=?
                   UNION SELECT identifier FROM oai_edition_records WHERE edition_id=? ORDER BY identifier"""
            for ident_row in self.db.execute(sql,(operation_id,op["attempt"],op.get("baseline",""))):
                identifier=ident_row[0]
                old=self.db.execute("""SELECT o.id,o.datestamp,o.status,o.semantic_hash FROM oai_edition_records e
                    JOIN oai_observations o ON o.id=e.observation_id WHERE e.edition_id=? AND e.identifier=?""",
                    (op.get("baseline",""),identifier)).fetchone()
                newest=self.db.execute("SELECT MAX(datestamp) FROM oai_observations WHERE operation_id=? AND attempt=? AND identifier=?",
                                       (operation_id,op["attempt"],identifier)).fetchone()[0]
                incoming=[]
                if newest:
                    incoming=self.db.execute("""SELECT id,datestamp,status,semantic_hash FROM oai_observations
                        WHERE operation_id=? AND attempt=? AND identifier=? AND datestamp=? ORDER BY id""",
                        (operation_id,op["attempt"],identifier,newest)).fetchall()
                options=list(incoming)
                if old and (newest is None or old["datestamp"]>=newest):
                    options=([old]+incoming) if old["datestamp"]==newest else [old]
                unique={}
                for option in options: unique.setdefault(option["semantic_hash"],option)
                conflicting=len(unique)>1
                selected=next(iter(unique.values())) if len(unique)==1 else None
                if identifier in choices:
                    choice=choices[identifier]
                    if not conflicting or not isinstance(choice,dict):
                        raise InputError("A supplied conflict choice no longer belongs to a conflicting record")
                    plain(choice.get("note"),"the reason for selecting this record observation",4096)
                    selected=next((x for x in options if x["id"]==choice.get("observationId")),None)
                    if selected is None: raise InputError("The chosen observation is outside this conflict")
                    seen_choices.add(identifier)
                if selected is None: kind="conflict"
                elif old is None: kind="deleted" if selected["status"]=="deleted" else "added"
                elif newest is None: kind="retained"
                elif old["datestamp"]>newest: kind="older"
                elif old["semantic_hash"]==selected["semantic_hash"]: kind="unchanged"
                elif selected["status"]=="deleted": kind="deleted"
                elif old["status"]=="deleted": kind="reinstated"
                else: kind="updated"
                counts[kind]+=1
                candidate={"identifier":identifier,"before":old["id"] if old else None,
                           "after":selected["id"] if selected else None,"kind":kind,
                           "conflicts":[dict(x) for x in options] if conflicting else []}
                h.update(jbytes(candidate))
                self.db.execute("INSERT INTO oai_candidates VALUES(?,?,?,?,?,?)",
                    (temp,identifier,candidate["before"],candidate["after"],kind,jbytes(candidate["conflicts"]).decode()))
            if seen_choices!=set(choices):
                self.db.execute("DELETE FROM oai_candidates WHERE preview_id=?", (temp,))
                raise InputError("A choice names an identifier outside the current conflict set")
            identity=h.hexdigest()
            previous=self.db.execute("SELECT body FROM oai_previews WHERE id=?", (identity,)).fetchone()
            if previous:
                self.db.execute("DELETE FROM oai_candidates WHERE preview_id=?", (temp,))
                return decode(previous[0])
            self.db.execute("UPDATE oai_candidates SET preview_id=? WHERE preview_id=?", (identity,temp))
            active=self.db.execute("""SELECT COUNT(*) FROM oai_candidates c JOIN oai_observations o ON o.id=c.after_id
                WHERE c.preview_id=? AND o.status='active'""", (identity,)).fetchone()[0]
            deleted=self.db.execute("""SELECT COUNT(*) FROM oai_candidates c JOIN oai_observations o ON o.id=c.after_id
                WHERE c.preview_id=? AND o.status='deleted'""", (identity,)).fetchone()[0]
            value={"schema":"stellar-forge.oai-pmh-review-preview.v1","id":identity,**binding,
                "createdAt":stamp(),"counts":counts,"activeRecords":active,"deletedRecords":deleted,
                "ready":counts["conflict"]==0,
                "semantics":"Newest repository datestamp per exact identifier; same-datestamp conflicts need explicit selection; missing records retain the selected baseline; only explicit OAI deletion headers remove records"}
            return self._put("oai_previews",value)

    def changes(self,preview_id,kind=None,offset=0,limit=100):
        page_values(offset,limit)
        with self.mutex:
            self._get("oai_previews",preview_id)
            clause="preview_id=?";args=[preview_id]
            if kind: clause+=" AND kind=?";args.append(kind)
            total=self.db.execute("SELECT COUNT(*) FROM oai_candidates WHERE "+clause,args).fetchone()[0]
            rows=self.db.execute("SELECT * FROM oai_candidates WHERE "+clause+" ORDER BY identifier LIMIT ? OFFSET ?",
                                 args+[limit,offset]).fetchall()
            return {"items":[{"identifier":r["identifier"],"before":r["before_id"],"after":r["after_id"],
                              "kind":r["kind"],"conflicts":decode(r["conflicts"])} for r in rows],
                    "total":total,"offset":offset,"next":offset+len(rows) if offset+len(rows)<total else None}

    def review(self,preview_id,expected_digest,reviewer,note):
        plain(reviewer,"the reviewer name",128);plain(note,"the edition review note",8192)
        with self.mutex,self.db:
            preview=self._get("oai_previews",preview_id)
            op=self.operation(preview["operationId"])
            if expected_digest!=preview_id or not preview["ready"] or op["revision"]!=preview["operationRevision"]:
                raise InputError("Review the complete current edition and resolve its record conflicts")
            ident=sha(jbytes(["stellar-forge.oai-pmh-edition.v1",preview_id]))
            existing=self.db.execute("SELECT body FROM oai_editions WHERE id=?", (ident,)).fetchone()
            if existing: return decode(existing[0])
            self.db.execute("INSERT INTO oai_edition_records SELECT ?,identifier,after_id FROM oai_candidates WHERE preview_id=? AND after_id IS NOT NULL",
                            (ident,preview_id))
            value={"schema":"stellar-forge.oai-pmh-edition.v1","id":ident,"previewId":preview_id,
                "repository":op.get("repositorySnapshot") or self.repository(op["repositoryId"]),
                "selection":op["selection"],"operationId":op["id"],"attempt":op["attempt"],
                "baseline":preview["baseline"],"activeRecords":preview["activeRecords"],"deletedRecords":preview["deletedRecords"],
                "counts":preview["counts"],"review":{"reviewer":reviewer,"note":note,"recordedAt":stamp(),"digest":preview_id}}
            return self._put("oai_editions",value)

    def records(self,edition_id,offset=0,limit=100,query=""):
        page_values(offset,limit)
        if not isinstance(query,str) or len(query)>4096: raise InputError("Record search is too long")
        with self.mutex:
            self.edition(edition_id)
            clause="e.edition_id=?";args=[edition_id]
            if query:
                clause+=" AND instr(e.identifier,?)>0";args.append(query)
            total=self.db.execute("SELECT COUNT(*) FROM oai_edition_records e WHERE "+clause,args).fetchone()[0]
            rows=self.db.execute("""SELECT e.identifier,o.id,o.datestamp,o.status,o.semantic_hash,o.request_id,o.ordinal
                FROM oai_edition_records e JOIN oai_observations o ON o.id=e.observation_id WHERE """+
                clause+" ORDER BY e.identifier LIMIT ? OFFSET ?",args+[limit,offset]).fetchall()
            return {"items":[dict(r) for r in rows],"total":total,"offset":offset,
                    "next":offset+len(rows) if offset+len(rows)<total else None}

    def save_mapping(self,plan):
        normalized=xml.validate_plan(plan)
        if normalized["recordPath"]!=[Q("OAI-PMH"),Q("ListRecords"),Q("record")]:
            raise InputError("OAI mappings select the original OAI-PMH/ListRecords/record element")
        return self.xml.save_plan(normalized)

    def default_mapping(self,name="repository_records"):
        return {"schema":"stellar-forge.xml-mapping.v1","name":name,
            "recordPath":[Q("OAI-PMH"),Q("ListRecords"),Q("record")],
            "columns":[{"name":"identifier","path":[Q("header"),Q("identifier")],"type":"string"},
                       {"name":"datestamp","path":[Q("header"),Q("datestamp")],"type":"string"},
                       {"name":"set_specs","path":[Q("header"),Q("setSpec")],"type":"string",
                        "mode":"json","missing":"default","default":"[]"}],
            "keys":["identifier"],"filters":["identifier","datestamp"],"sorts":["identifier","datestamp"],
            "allowEmpty":False,"maxRows":250000,"maxBytes":67108864,"maxCellChars":65536,
            "maxLimit":250,"defaultLimit":50}

    def metadata_mapping(self,edition_id,name="repository_metadata"):
        """Offer an explicit editable mapping from this edition's actual metadata namespace."""
        with self.mutex:
            self.edition(edition_id)
            row=self.db.execute("""SELECT o.body FROM oai_edition_records e JOIN oai_observations o
                ON o.id=e.observation_id WHERE e.edition_id=? AND o.status='active'
                ORDER BY e.identifier LIMIT 1""",(edition_id,)).fetchone()
            if row is None: raise InputError("Inspect an active metadata record before choosing a metadata preset")
            record=unpacked(decode(row[0])["node"])
            metadata=next((n for n in record.children if n.name==Q("metadata")),None)
            if metadata is None or len(metadata.children)!=1: raise InputError("This record has no single original metadata payload")
            payload=metadata.children[0]
            plan=self.default_mapping(name)
            def array(column,path,attribute=None):
                value={"name":column,"path":path,"type":"string","mode":"json",
                       "missing":"default","default":"[]","text":"descendant"}
                if attribute is not None: value["attribute"]=attribute
                plan["columns"].append(value)
            def scalar(column,path,kind="string",attribute=None):
                value={"name":column,"path":path,"type":kind,"nullable":True,
                       "missing":"empty","text":"descendant"}
                if attribute is not None: value["attribute"]=attribute
                plan["columns"].append(value)
            dc="{http://www.openarchives.org/OAI/2.0/oai_dc/}dc"
            kernel="{http://datacite.org/schema/kernel-4}"
            wrapper="{http://schema.datacite.org/oai/oai-1.1/}"
            if payload.name==dc:
                for key in ("title","creator","subject","description","publisher","contributor","date",
                            "type","format","identifier","source","language","relation","coverage","rights"):
                    array("dc_"+key,[Q("metadata"),dc,"{http://purl.org/dc/elements/1.1/}"+key])
            else:
                if payload.name==wrapper+"oai_datacite":
                    parent=next((n for n in payload.children if n.name==wrapper+"payload"),None)
                    if parent is None or len(parent.children)!=1 or parent.children[0].name!=kernel+"resource":
                        raise InputError("Choose an explicit mapping for this DataCite payload namespace")
                    base=[Q("metadata"),payload.name,wrapper+"payload",kernel+"resource"]
                elif payload.name==kernel+"resource":
                    base=[Q("metadata"),kernel+"resource"]
                else: raise InputError("Inspect this metadata format and define its original expanded-name paths")
                path=lambda *names:base+[kernel+n for n in names]
                scalar("metadata_identifier",path("identifier"))
                scalar("metadata_identifier_type",path("identifier"),attribute="identifierType")
                array("titles",path("titles","title"))
                array("creator_names",path("creators","creator","creatorName"))
                scalar("publication_year",path("publicationYear"),"integer")
                scalar("publisher",path("publisher"))
                scalar("resource_type",path("resourceType"),attribute="resourceTypeGeneral")
                scalar("resource_type_label",path("resourceType"))
                scalar("language",path("language"))
                scalar("version",path("version"))
                array("subjects",path("subjects","subject"))
                array("related_identifiers",path("relatedIdentifiers","relatedIdentifier"))
                array("rights",path("rightsList","rights"))
                array("rights_uris",path("rightsList","rights"),attribute="rightsURI")
                array("descriptions",path("descriptions","description"))
                plan["filters"]=["identifier","datestamp","metadata_identifier","publication_year","publisher","resource_type","language"]
                plan["ranges"]=["publication_year"]
                plan["sorts"]=["identifier","datestamp","metadata_identifier","publication_year","publisher","resource_type","language"]
            plan["maxCellChars"]=1048576
            return xml.validate_plan(plan)

    def _build_file(self,build,name):
        if name not in build["files"]: raise InputError("Unknown build member")
        path=self.area/"builds"/build["id"]/name
        value=build["files"][name]
        if storage.file_digest(path,4*xml.MAX_SOURCE)!=value["sha256"] or path.stat().st_size!=value["bytes"]:
            raise InputError("Retained OAI projection bytes changed")
        return path

    def build(self,edition_id,plan_id):
        with self.mutex:
            edition=self.edition(edition_id)
            plan=self.xml.plan(plan_id)
            if plan["recordPath"]!=[Q("OAI-PMH"),Q("ListRecords"),Q("record")]:
                raise InputError("Select an OAI record mapping")
            ident=sha(jbytes(["stellar-forge.oai-pmh-build.v1",edition_id,plan_id]))
            old=self.db.execute("SELECT body FROM oai_builds WHERE id=?", (ident,)).fetchone()
            if old:
                result=decode(old[0])
                for name in result["files"]: self._build_file(result,name)
                return result
            with tempfile.TemporaryDirectory(dir=self.area/"tmp") as directory:
                temp=Path(directory);os.chmod(temp,0o700)
                storage.private_write(temp/"keys.sqlite",b"")
                keys=sqlite3.connect(temp/"keys.sqlite")
                keys.execute("CREATE TABLE keys(k TEXT PRIMARY KEY)")
                names=[c["name"] for c in plan["columns"]]
                indexes=[names.index(k) for k in plan["keys"]]
                count=0
                try:
                    with os.fdopen(os.open(temp/"data.csv",os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"w",encoding="utf-8",newline="") as out:
                        writer=csv.writer(out,lineterminator="\n");writer.writerow(names)
                        rows=self.db.execute("""SELECT o.body FROM oai_edition_records e JOIN oai_observations o
                            ON o.id=e.observation_id WHERE e.edition_id=? AND o.status='active' ORDER BY e.identifier""",(edition_id,))
                        for row in rows:
                            count+=1
                            if count>plan["maxRows"]: raise InputError("The complete edition exceeds the selected mapping's maxRows")
                            node=unpacked(decode(row[0])["node"])
                            projected=[xml.project(node,c,count,plan["maxCellChars"]) for c in plan["columns"]]
                            cells=[x[0] for x in projected];values=[x[1] for x in projected]
                            if indexes:
                                key=[values[i] for i in indexes]
                                if any(v is None or v=="" for v in key): raise InputError("A projected edition key is empty")
                                try: keys.execute("INSERT INTO keys VALUES(?)",(jbytes(key).decode(),))
                                except sqlite3.IntegrityError as e: raise InputError("Projected edition keys are not unique") from e
                            writer.writerow(cells)
                            if out.tell()>plan["maxBytes"]: raise InputError("The complete projection exceeds maxBytes")
                        out.flush();os.fsync(out.fileno())
                    if count!=edition["activeRecords"]: raise InputError("Edition membership changed during projection")
                    if count==0 and not plan["allowEmpty"]: raise InputError("This edition has no active records; explicitly allow an empty mapping to publish it")
                finally: keys.close()
                (temp/"keys.sqlite").unlink()
                storage.private_write(temp/"dataset.json",jbytes(xml.dataset_spec(plan)))
                native=self.xml.native.query(temp/"dataset.json",{"limit":"1"})
                if native["response"]["status"]!=200 or native["dataset"]["rowCount"]!=count:
                    raise InputError("The original SF30 engine did not accept the complete OAI projection")
                files={name:{"bytes":(temp/name).stat().st_size,"sha256":storage.file_digest(temp/name,4*xml.MAX_SOURCE)}
                       for name in ("data.csv","dataset.json")}
                result={"schema":"stellar-forge.oai-pmh-build.v1","id":ident,"editionId":edition_id,
                        "planId":plan_id,"rowCount":count,"datasetSnapshot":native["dataset"]["snapshot"],
                        "dataset":native["dataset"],"engineBlob":native["engineBlob"],"files":files}
                storage.private_write(temp/"review.json",jbytes(result))
                destination=self.area/"builds"/ident
                if destination.exists():
                    if any((destination/n).read_bytes()!=(temp/n).read_bytes() for n in ("data.csv","dataset.json","review.json")):
                        raise InputError("An interrupted projection conflicts with its retained inputs")
                else:
                    os.replace(temp,destination)
                    storage.sync_dir(destination);storage.sync_dir(destination.parent)
                with self.db: self._put("oai_builds",result)
                return result

    def query(self,build_id,params):
        if not isinstance(params,dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in params.items()):
            raise InputError("Native dataset query values must be strings")
        with self.mutex:
            build=self._get("oai_builds",build_id)
            self._build_file(build,"data.csv")
            return self.xml.native.query(self._build_file(build,"dataset.json"),params)

    def _lineage(self,edition_id):
        editions=[];seen=set();current=edition_id
        while current:
            if current in seen: raise InputError("The retained edition lineage contains a cycle")
            seen.add(current);edition=self.edition(current);editions.append(edition);current=edition.get("baseline")
        return editions

    def export_source(self,build_id,destination):
        with self.mutex:
            build=self._get("oai_builds",build_id)
            edition=self.edition(build["editionId"])
            lineage=self._lineage(edition["id"])
            destination=Path(destination).absolute()
            destination.mkdir(mode=0o700,parents=False,exist_ok=False)
            capture=destination/"capture";capture.mkdir(mode=0o700)
            files=[]
            def write(name,content):
                member(name);path=capture/name
                path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                storage.private_write(path,content)
                files.append({"file":name,"bytes":len(content),"sha256":sha(content)})
            try:
                for name in ("data.csv","dataset.json"): write(name,self._build_file(build,name).read_bytes())
                write("mapping.json",jbytes(self.xml.plan(build["planId"])))
                write("lineage.json",jbytes({"schema":"stellar-forge.oai-pmh-lineage.v1","build":build,
                    "editions":lineage,"deletionRule":"Only explicit OAI deleted headers remove an existing record",
                    "recordOrdering":"Exact repository identifier in SQLite binary order",
                    "projection":"Original XML project/typed/dataset_spec functions and immutable SF30 dataset engine"}))
                rows_path=capture/"records.jsonl"
                with os.fdopen(os.open(rows_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                    for row in self.db.execute("""SELECT o.body FROM oai_edition_records e JOIN oai_observations o
                        ON o.id=e.observation_id WHERE e.edition_id=? ORDER BY e.identifier""",(edition["id"],)):
                        value=decode(row[0]);value.pop("node",None);out.write(jbytes(value))
                    out.flush();os.fsync(out.fileno())
                files.append({"file":"records.jsonl","bytes":rows_path.stat().st_size,"sha256":storage.file_digest(rows_path,4*xml.MAX_SOURCE)})
                requests={}
                for item in lineage:
                    for row in self.db.execute("SELECT body FROM oai_requests WHERE operation_id=? ORDER BY attempt,ordinal",(item["operationId"],)):
                        req=decode(row[0]);requests[req["id"]]=req
                    repo=item["repository"]
                    if repo.get("identifyRequestId"):
                        req=self._get("oai_requests",repo["identifyRequestId"]);requests[req["id"]]=req
                    for request_id in repo.get("formatsRequestIds",[])+repo.get("setsRequestIds",[]):
                        req=self._get("oai_requests",request_id);requests[req["id"]]=req
                exchanges=[]
                retained=set()
                for request in requests.values():
                    attempts=self.db.execute("SELECT body FROM oai_http_exchanges WHERE request_id=? ORDER BY rowid",(request["id"],)).fetchall()
                    for row in attempts or [(jbytes(request),)]:
                        req=decode(row[0])
                        req["retainedExchangeSha256"]=sha(jbytes(req))
                        http=dict(req.get("http",{}))
                        sensitive={"set-cookie","set-cookie2","authorization","proxy-authorization","cookie"}
                        withheld=[key for key,value in http.get("headers",[]) if key.lower() in sensitive]
                        http["headers"]=[[key,value] for key,value in http.get("headers",[]) if key.lower() not in sensitive]
                        if withheld: http["withheldHeaderNames"]=withheld
                        if http: req["http"]=http
                        response=req.get("response")
                        if response:
                            suffix=".xml" if response.get("xmlSourceId") else ".bin"
                            name=("pages/" if suffix==".xml" else "http/")+response["sha256"]+suffix
                            source=self.root/member(response["path"])
                            if storage.file_digest(source)!=response["sha256"] or source.stat().st_size!=response["bytes"]:
                                raise InputError("A retained HTTP response changed before source export")
                            if name not in retained: write(name,source.read_bytes());retained.add(name)
                            req["response"]={**response,"path":name}
                        exchanges.append(req)
                write("requests.jsonl",b"".join(jbytes(x) for x in exchanges))
                manifest={"schema":"stellar-forge.oai-pmh-capture.v1","provider":"oai-pmh","readOnly":True,"state":"COMPLETE",
                    "repository":edition["repository"],"selection":edition["selection"],
                    "operationId":edition["operationId"],"attempt":edition["attempt"],
                    "edition":{k:edition[k] for k in ("id","review","activeRecords","deletedRecords")},
                    "build":{k:build[k] for k in ("id","planId","datasetSnapshot","rowCount")},
                    "dataFile":"data.csv","datasetFile":"dataset.json","mappingFile":"mapping.json","lineageFile":"lineage.json",
                    "recordsFile":"records.jsonl","requestsFile":"requests.jsonl",
                    "transportDisclosure":{"omittedHeaders":["authorization","proxy-authorization","cookie","set-cookie","set-cookie2"],
                        "originals":"Complete transport remains in the private workspace and its full backup",
                        "digest":"retainedExchangeSha256 binds original canonical exchange JSON before package path relocation"},
                    "files":sorted(files,key=lambda x:x["file"])}
                manifest_bytes=jbytes(manifest)
                storage.private_write(capture/"capture.json",manifest_bytes)
                source={"schema":"stellar-forge.oai-pmh-source.v1",
                    "connection":{"kind":"capture","file":"capture/capture.json","sha256":sha(manifest_bytes)},
                    "queries":{"records":{}}}
                storage.private_write(destination/"source.json",jbytes(source))
                storage.sync_dir(capture);storage.sync_dir(destination)
                return {"directory":str(destination),"source":str(destination/"source.json"),
                    "manifestSha256":sha(manifest_bytes),"rows":build["rowCount"],"files":len(files)+2}
            except Exception:
                # Keep the incomplete destination for the operator; never present it as an export.
                raise

    def backup(self,destination):
        destination=Path(destination).absolute()
        with self.mutex,tempfile.TemporaryDirectory(dir=self.area/"tmp") as temp_dir:
            temp=Path(temp_dir);dbpath=temp/"workspace.sqlite"
            storage.private_write(dbpath,b"")
            copied=sqlite3.connect(dbpath)
            try: self.db.backup(copied)
            finally: copied.close()
            members={"workspace.sqlite":dbpath,"workspace.json":self.root/"workspace.json"}
            for directory in ("sources","plans","builds","comparisons","oai"):
                for path in (self.root/directory).rglob("*"):
                    relative=path.relative_to(self.root).as_posix()
                    if relative.startswith("oai/tmp/"): continue
                    if path.is_symlink(): raise InputError("Workspace backup cannot include symbolic links")
                    if path.is_file(): members[relative]=path
            manifest={"schema":"stellar-forge.oai-pmh-workspace-backup.v1","createdAt":stamp(),"files":[]}
            with destination.open("xb") as raw:
                os.chmod(destination,0o600)
                with zipfile.ZipFile(raw,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    for name,path in sorted(members.items()):
                        digest=storage.file_digest(path,16*xml.MAX_SOURCE)
                        manifest["files"].append({"file":name,"bytes":path.stat().st_size,"sha256":digest})
                        archive.write(path,name)
                    archive.writestr("backup.json",jbytes(manifest))
                raw.flush();os.fsync(raw.fileno())
            return {"path":str(destination),"bytes":destination.stat().st_size,"sha256":storage.file_digest(destination,64*xml.MAX_SOURCE),
                    "files":len(manifest["files"])}

    @classmethod
    def restore(cls,archive_path,destination):
        destination=Path(destination).absolute()
        if destination.exists(): raise InputError("Restore into a new workspace directory")
        with zipfile.ZipFile(archive_path) as archive:
            names=archive.namelist()
            if len(names)!=len(set(names)) or "backup.json" not in names:
                raise InputError("Backup contains duplicate members or no manifest")
            manifest=decode(archive.read("backup.json"))
            if manifest.get("schema")!="stellar-forge.oai-pmh-workspace-backup.v1":
                raise InputError("Unsupported OAI workspace backup")
            expected={member(x["file"]):x for x in manifest["files"]}
            if set(names)!={"backup.json",*expected} or len(expected)!=len(manifest["files"]):
                raise InputError("Backup members differ from its manifest")
            destination.mkdir(mode=0o700)
            for directory in ("sources","plans","builds","comparisons","tmp","oai/http","oai/builds","oai/tmp"):
                (destination/directory).mkdir(mode=0o700,parents=True,exist_ok=True)
            for name,entry in expected.items():
                path=destination/name
                path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                h=hashlib.sha256();size=0
                with archive.open(name) as source,os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                    while chunk:=source.read(65536):
                        size+=len(chunk)
                        if size>entry["bytes"]: raise InputError("Backup member exceeds its declared size")
                        h.update(chunk);out.write(chunk)
                    out.flush();os.fsync(out.fileno())
                if size!=entry["bytes"] or h.hexdigest()!=entry["sha256"]:
                    raise InputError("Backup member bytes differ from the saved original")
            restored=cls(destination)
            try:
                if restored.db.execute("PRAGMA quick_check").fetchone()[0]!="ok":
                    raise InputError("Restored workspace database failed its native consistency check")
                return {"directory":str(destination),"state":restored.state()}
            finally: restored.close()
