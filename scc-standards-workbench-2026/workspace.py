"""Atomic local standards projects and original-byte intake.

SQLite compare-and-swap, durable request identities and hash-linked events reuse
the PLAN/NEKCV transaction envelope. A complete backup includes all retained
originals and development history. No organization is contacted by this module.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sqlite3
import uuid
import zipfile
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree

if __package__:
    from . import engine, source_intake
else:
    import engine
    import source_intake

SCHEMA="standards-workspace/v1"
MAX_SOURCE_BYTES=32*1024*1024
MAX_ORIGINAL_BYTES=192*1024*1024
MAX_STATE_BYTES=64*1024*1024
canonical,digest=engine.canonical,engine.digest

class Conflict(ValueError):
    def __init__(self,message,current_revision=None):
        super().__init__(message);self.current_revision=current_revision

def json_read(raw):
    return json.loads(raw,parse_constant=lambda x:(_ for _ in ()).throw(ValueError("Non-finite JSON numbers are not supported.")))

def filename(value):
    value=engine.text(value,"Filename",True,240)
    if Path(value).name!=value or "\\" in value or any(ord(c)<32 for c in value):
        raise ValueError("Use a plain filename with no path or control characters.")
    return value

def file_identity(name,raw):
    sha=hashlib.sha256(raw).hexdigest()
    return {"id":"file-"+digest({"filename":name,"sha256":sha})[:32],"filename":name,"sha256":sha,"bytes":len(raw)}

def parse_original(raw,name,options=None):
    """Expose exact tabular cells, or DOCX paragraphs/tables with source locators.

    DOCX is retained unchanged. Its structured preview is an explicit import
    aid, not a round-trip editor for tracked changes, equations or layout.
    """
    opts=deepcopy(options or {})
    suffix=Path(name).suffix.lower()
    if suffix in (".csv",".tsv",".json",".geojson",".xlsx",".xlsm") or opts.get("format") in ("csv","json","xlsx"):
        return source_intake.parse_source(raw,name,opts)
    if suffix==".docx":
        if opts:raise ValueError("DOCX paragraph/table preview has no inferred parsing options.")
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                if len(z.infolist())>4096 or sum(i.file_size for i in z.infolist())>96*1024*1024:
                    raise ValueError("DOCX expanded contents exceed the source limit.")
                xml=z.read("word/document.xml")
        except (zipfile.BadZipFile,KeyError) as exc:
            raise ValueError("The retained source is not a readable WordprocessingML document.") from exc
        if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
            raise ValueError("Document XML entities are unsupported.")
        root=ElementTree.fromstring(xml)
        ns={"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        body=root.find("w:body",ns)
        rows=[];origins=[]
        if body is not None:
            for index,element in enumerate(body):
                tag=element.tag.rsplit("}",1)[-1]
                if tag=="p":
                    val="".join(e.text or "" for e in element.findall(".//w:t",ns))
                    style=element.find("w:pPr/w:pStyle",ns)
                    style_name=style.attrib.get("{"+ns["w"]+"}val","") if style is not None else ""
                    rows.append({"c0001":"paragraph","c0002":val,"c0003":style_name,"c0004":""})
                    origins.append({"body_index":index,"kind":"paragraph"})
                elif tag=="tbl":
                    values=[["".join(e.text or "" for e in cell.findall(".//w:t",ns)) for cell in tr.findall("w:tc",ns)] for tr in element.findall("w:tr",ns)]
                    rows.append({"c0001":"table","c0002":"","c0003":"","c0004":canonical(values)})
                    origins.append({"body_index":index,"kind":"table"})
        sid="doc-"+hashlib.sha256(raw).hexdigest()
        return {"id":sid,"sha256":hashlib.sha256(raw).hexdigest(),"filename":name,"format":"docx",
                "options":{},"resolved_options":{},"tables":[{"id":sid+":t1","source_id":sid,"name":"Document blocks",
                "columns":[{"key":"c0001","name":"kind"},{"key":"c0002","name":"text"},{"key":"c0003","name":"paragraph_style"},{"key":"c0004","name":"table_json"}],
                "rows":rows,"row_origins":origins,"cell_annotations":[],"warnings":[]}],
                "warnings":[{"code":"docx_structural_preview","message":"Original Word bytes are retained. Preview exposes paragraphs and tables; numbering definitions, tracked changes, equations, embedded objects and layout require operator interpretation."}],
                "completeness":"all_main_document_blocks"}
    if suffix in (".md",".txt",".text"):
        encoding=opts.get("encoding","utf-8-sig")
        if set(opts)-{"encoding"}:raise ValueError("Text preview supports only an explicit encoding.")
        try:content=raw.decode(encoding)
        except (UnicodeError,LookupError) as exc:raise ValueError("Select the actual source text encoding.") from exc
        sid="text-"+hashlib.sha256(raw).hexdigest()
        lines=content.splitlines()
        return {"id":sid,"sha256":hashlib.sha256(raw).hexdigest(),"filename":name,"format":"text","options":opts,
                "resolved_options":{"encoding":encoding},"tables":[{"id":sid+":t1","source_id":sid,"name":"Original lines",
                "columns":[{"key":"c0001","name":"line"}],"rows":[{"c0001":s} for s in lines],
                "row_origins":[{"line":i+1} for i in range(len(lines))],"cell_annotations":[],"warnings":[]}],
                "warnings":[],"completeness":"all_source_lines"}
    return {"id":"file-"+hashlib.sha256(raw).hexdigest(),"sha256":hashlib.sha256(raw).hexdigest(),"filename":name,
            "format":"retained_original","options":{},"tables":[],
            "warnings":[{"code":"retained_without_text_decoder","message":"Original bytes are retained and downloadable. This format has no built-in structured decoder; import an explicit text/CSV/JSON companion and cite this original."}],
            "completeness":"original_bytes_retained"}

def map_records(parsed,specification,collection,state):
    if collection not in engine.FIELDS or collection in engine.IMMUTABLE or collection=="sources":
        raise ValueError("Import a mutable working collection; frozen decisions use their explicit operations.")
    table_id=specification.get("table_id")
    table=next((t for t in parsed["tables"] if t["id"]==table_id),None)
    if table is None:raise ValueError("Select an exact parsed table.")
    mapping=specification.get("field_map",{})
    constants=specification.get("constants",{})
    if not isinstance(mapping,dict) or not isinstance(constants,dict) or set(mapping)&set(constants):
        raise ValueError("Map each field once, using an explicit source column or constant.")
    fields=engine.FIELDS[collection]
    if (set(mapping)|set(constants))-set(fields):
        unknown=(set(mapping)|set(constants))-set(fields)
        if unknown:raise ValueError("Unsupported mapped fields: "+", ".join(sorted(unknown)))
    columns={c["key"] for c in table["columns"]}
    if any(v not in columns for v in mapping.values()):raise ValueError("Map actual unique source column keys.")
    selected=specification.get("row_indices")
    indices=list(range(len(table["rows"]))) if selected is None else selected
    if not isinstance(indices,list) or len(indices)>20000 or len(set(indices))!=len(indices) or any(type(i)is not int or i<0 or i>=len(table["rows"]) for i in indices):
        raise ValueError("Choose unique actual source row indices (at most 20,000).")
    rows=[];errors=[]
    for index in indices:
        rawrow=table["rows"][index]
        value=engine.template(collection);value.update(deepcopy(constants))
        try:
            for field,column in mapping.items():
                cell=rawrow[column];kind=fields[field]["kind"]
                if cell in ("",None):
                    value[field]=deepcopy(fields[field]["default"]);continue
                if kind in ("list","json"):cell=json_read(cell)
                elif kind=="boolean":
                    if cell not in ("true","false"):raise ValueError("Boolean source fields must explicitly contain true or false.")
                    cell=cell=="true"
                elif kind=="integer":
                    if not str(cell).isdigit():raise ValueError("Integer source cell is not a nonnegative integer.")
                    cell=int(cell)
                value[field]=cell
            locator={"source_id":specification["source_id"],"sha256":parsed["sha256"],"table_id":table_id,
                     "row_index":index,"row_origin":table["row_origins"][index]}
            sourcekey=specification.get("identity_column")
            source_identity=rawrow[sourcekey] if sourcekey in columns else index
            value["id"]="import-"+digest({"collection":collection,"source":specification["source_id"],"table":table_id,
                                          "mapping":mapping,"constants":constants,"identity":source_identity})[:32]
            value["revision"]=1
            if "source_ids" in fields:value["source_ids"]=list(dict.fromkeys(value.get("source_ids",[])+[specification["source_id"]]))
            if collection=="comments":
                value["source_id"]=specification["source_id"]
                value["source_comment_id"]=str(source_identity)
                value["source_locator"]=canonical(locator)
            if "notes" in fields:
                value["notes"]=(value.get("notes","")+"\nOriginal row: "+canonical(locator)).strip()
            candidate=engine.validate_record(collection,value,state)
            rows.append({"record":candidate,"source_locator":locator,"existing":next((r for r in state.get(collection,[]) if r["id"]==candidate["id"]),None)})
        except (ValueError,TypeError,json.JSONDecodeError) as exc:
            errors.append({"row_index":index,"source_locator":table["row_origins"][index],"error":str(exc)})
    ids=[r["record"]["id"] for r in rows]
    if len(ids)!=len(set(ids)):
        errors.append({"row_index":None,"error":"The selected identity column repeats; choose the row index or a unique source key. No rows were adopted."})
    return {"collection":collection,"rows":rows,"errors":errors,"total_selected":len(indices),
            "source_sha256":parsed["sha256"],"mapping":deepcopy(specification)}

class Workspace:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        created=not self.path.exists()
        with self.connect() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS originals(sha256 TEXT PRIMARY KEY,data BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS events(project_id TEXT NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(project_id,revision));
            CREATE TABLE IF NOT EXISTS requests(project_id TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(project_id,request_id));
            """)
        if created:os.chmod(self.path,0o600)

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=20,isolation_level=None);db.row_factory=sqlite3.Row
        db.execute("PRAGMA busy_timeout=20000")
        try:yield db
        finally:db.close()

    def _state(self,db,project_id):
        row=db.execute("SELECT state FROM projects WHERE id=?",(project_id,)).fetchone()
        if row is None:raise KeyError("Project not found.")
        return json_read(row[0])

    def _event(self,state,actor,operation,details,previous_hash,request_id=None,request_digest=None):
        event={"project_id":state["id"],"revision":state["revision"],"at":state["updated_at"],"actor":actor,
               "operation":operation,"details":details,"previous_hash":previous_hash,"state_sha256":digest(state),
               "request_id":request_id,"request_digest":request_digest}
        event["sha256"]=digest(event);return event

    def create(self,title,actor="Operator",project_id=None,mode="working"):
        state=engine.initial_state(title,project_id or "project-"+uuid.uuid4().hex,mode)
        state.update({"workspace_schema":SCHEMA,"revision":1,"created_at":engine.now(),"updated_at":engine.now(),
                      "files":[],"imports":[],"seed_sha256":None})
        self.validate(state)
        actor=engine.text(actor,"Operator",True,300)
        event=self._event(state,actor,"project.created",{"title":title,"mode":mode},"")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                if db.execute("SELECT 1 FROM projects WHERE id=?",(state["id"],)).fetchone():
                    raise Conflict("That project already exists; open it rather than duplicating its work.")
                db.execute("INSERT INTO projects VALUES(?,?,?)",(state["id"],1,canonical(state)))
                db.execute("INSERT INTO events VALUES(?,?,?)",(state["id"],1,canonical(event)));db.commit()
            except Exception:db.rollback();raise
        return self._preview(state)

    def list_projects(self):
        with self.connect() as db:states=[json_read(r[0]) for r in db.execute("SELECT state FROM projects")]
        return [{"id":s["id"],"title":s["title"],"mode":s["mode"],"revision":s["revision"],"updated_at":s["updated_at"],
                 "clauses":len(s["clauses"]),"editions":len(s["editions"]),"originals":len(s["files"])} for s in sorted(states,key=lambda s:s["updated_at"],reverse=True)]

    def _preview(self,state):
        result=deepcopy(state);result["analysis"]=engine.analyze(state)
        result["collection_counts"]={name:len(state.get(name,[])) for name in engine.COLLECTIONS}
        result["preview_limit"]=200
        for name in engine.COLLECTIONS:
            result[name]=result.get(name,[])[:200]
            if name in ("editions","ballots","ballot_closures","technical_decisions","phase_reports","invoices","procedural_reviews"):
                for r in result[name]:
                    for field in ("snapshot","input_snapshot","independence_snapshot","roster"):
                        if field in r:
                            r[field+"_available"]=True
                            del r[field]
        result["imports"]=result["imports"][-50:]
        return result

    def get(self,project_id):
        with self.connect() as db:return self._preview(self._state(db,project_id))

    def full_state(self,project_id):
        with self.connect() as db:return deepcopy(self._state(db,project_id))

    def record(self,project_id,collection,record_id):
        if collection not in engine.COLLECTIONS:raise ValueError("Unknown collection.")
        with self.connect() as db:return deepcopy(engine.record(self._state(db,project_id),collection,record_id))

    def records(self,project_id,collection,offset=0,limit=100):
        if collection not in engine.COLLECTIONS:raise ValueError("Unknown collection.")
        offset=max(0,int(offset));limit=max(1,min(500,int(limit)))
        with self.connect() as db:state=self._state(db,project_id)
        return {"revision":state["revision"],"collection":collection,"offset":offset,"total":len(state.get(collection,[])),
                "rows":deepcopy(state.get(collection,[])[offset:offset+limit])}

    def history(self,project_id,offset=0,limit=100):
        offset=max(0,int(offset));limit=max(1,min(200,int(limit)))
        with self.connect() as db:
            state=self._state(db,project_id)
            rows=[json_read(r[0]) for r in db.execute("SELECT record FROM events WHERE project_id=? ORDER BY revision LIMIT ? OFFSET ?",(project_id,limit,offset))]
        return {"revision":state["revision"],"total":state["revision"],"offset":offset,"rows":rows}

    def original(self,project_id,file_id):
        with self.connect() as db:
            state=self._state(db,project_id)
            meta=next((r for r in state["files"] if r["id"]==file_id),None)
            if meta is None:raise KeyError("Original file is outside this project.")
            row=db.execute("SELECT data FROM originals WHERE sha256=?",(meta["sha256"],)).fetchone()
            if row is None:raise ValueError("Retained original bytes are missing.")
            return bytes(row[0]),deepcopy(meta)

    def _source_bytes(self,db,state,source_id):
        source=engine.record(state,"sources",source_id)
        original=next((r for r in state["files"] if r["id"]==source["source_file_id"]),None)
        if original is None:raise ValueError("Select a source with retained original bytes.")
        row=db.execute("SELECT data FROM originals WHERE sha256=?",(original["sha256"],)).fetchone()
        if row is None:raise ValueError("Original source bytes are unavailable.")
        return bytes(row[0]),original

    def intake_preview(self,project_id,specification,offset=0,limit=100):
        if not isinstance(specification,dict):raise ValueError("Intake needs a source specification.")
        with self.connect() as db:
            state=self._state(db,project_id)
            raw,meta=self._source_bytes(db,state,specification.get("source_id"))
        parsed=parse_original(raw,meta["filename"],specification.get("parse_options"))
        offset=max(0,int(offset));limit=max(1,min(500,int(limit)))
        result=deepcopy(parsed)
        for table in result["tables"]:
            table["total_rows"]=len(table["rows"]);table["offset"]=offset
            table["rows"]=table["rows"][offset:offset+limit];table["row_origins"]=table["row_origins"][offset:offset+limit]
        if specification.get("collection"):
            mapped=map_records(parsed,specification,specification["collection"],state)
            result["mapped"]={**mapped,"rows":mapped["rows"][offset:offset+limit],"errors":mapped["errors"][:100],"error_count":len(mapped["errors"])}
        return {"revision":state["revision"],"source_id":specification.get("source_id"),"parsed":result}

    def _put(self,state,collection,value):
        previous=next((r for r in state[collection] if r["id"]==value["id"]),None)
        value=deepcopy(value);value["revision"]=previous["revision"]+1 if previous else 1
        candidate=deepcopy(state)
        candidate[collection]=[r for r in candidate[collection] if r["id"]!=value["id"]]+[value]
        normalized=engine.validate_record(collection,value,candidate)
        state[collection]=[r for r in state[collection] if r["id"]!=value["id"]]+[normalized]
        return {"collection":collection,"record_id":value["id"],"before":deepcopy(previous),"after":deepcopy(normalized)}

    def validate(self,state):
        if state.get("workspace_schema")!=SCHEMA:raise ValueError("Unsupported persistence envelope.")
        engine.identity(state.get("id"));engine.text(state.get("title"),"Project title",True,300)
        if type(state.get("revision"))is not int or state["revision"]<1:raise ValueError("Invalid project revision.")
        engine.instant(state.get("created_at"),"Created timestamp",True);engine.instant(state.get("updated_at"),"Updated timestamp",True)
        engine.validate_state(state)
        files=state.get("files")
        if not isinstance(files,list) or len(files)>4096 or len({r.get("id") for r in files})!=len(files):raise ValueError("Malformed original file register.")
        byid={r["id"]:r for r in files}
        for meta in files:
            name=filename(meta["filename"])
            if meta["id"]!="file-"+digest({"filename":name,"sha256":meta["sha256"]})[:32] or not isinstance(meta["sha256"],str) or len(meta["sha256"])!=64:
                raise ValueError("Original file identity differs from its filename and digest.")
            if type(meta["bytes"])is not int or not 0<meta["bytes"]<=MAX_SOURCE_BYTES:raise ValueError("Original file size is outside the source bound.")
        if sum(r["bytes"] for r in files)>MAX_ORIGINAL_BYTES:raise ValueError("Original files exceed the project source capacity.")
        for source in state["sources"]:
            if source["source_file_id"]:
                meta=byid.get(source["source_file_id"])
                if meta is None or meta["sha256"]!=source["sha256"]:raise ValueError("Source metadata no longer matches its retained original.")
            elif source["sha256"]:raise ValueError("A source SHA-256 must bind a retained original file.")
        if len(canonical(state).encode())>MAX_STATE_BYTES:raise ValueError("Project state exceeds 64 MiB.")
        return state

    def _past_development(self,db,project_id,person_id):
        """Retain earlier involvement even after a working membership/comment is removed."""
        found=[]
        for item in db.execute("SELECT record FROM events WHERE project_id=? ORDER BY revision",(project_id,)):
            event=json_read(item[0])
            details=event.get("details")
            if not isinstance(details,list):continue
            for change in details:
                collection=change.get("collection")
                if collection not in ("people","memberships","comments","language_reviews","editions"):continue
                for version in ("before","after"):
                    row=change.get(version)
                    if not isinstance(row,dict):continue
                    involved=(collection=="people" and row.get("id")==person_id and bool(row.get("development_roles"))) or (
                        collection=="memberships" and row.get("person_id")==person_id) or (
                        collection=="comments" and row.get("author_id")==person_id) or (
                        collection=="language_reviews" and row.get("reviewer_id")==person_id) or (
                        collection=="editions" and person_id in row.get("contributor_ids",[]))
                    if involved:
                        fact={"project_revision":event["revision"],"collection":collection,"record_id":row["id"]}
                        if fact not in found:found.append(fact)
        return found

    def apply(self,project_id,operation,payload,expected_revision,request_id,actor="Operator"):
        if not isinstance(payload,dict):raise ValueError("Operation payload must be an object.")
        if type(expected_revision)is not int or expected_revision<1:raise ValueError("An exact current project revision is required.")
        request_id=engine.identity(request_id,"Request ID");actor=engine.text(actor,"Operator",True,300)
        request_digest=digest({"operation":operation,"payload":payload,"expected_revision":expected_revision,"actor":actor})
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                state=self._state(db,project_id)
                prior=db.execute("SELECT digest,result FROM requests WHERE project_id=? AND request_id=?",(project_id,request_id)).fetchone()
                if prior:
                    if prior["digest"]!=request_digest:raise Conflict("Request ID was already used with different input.",state["revision"])
                    result=json_read(prior["result"]);result["replayed"]=True;db.rollback();return result
                if state["revision"]!=expected_revision:
                    raise Conflict("This project changed while you were editing. Your input is retained; inspect the current record and reapply the intended fields.",state["revision"])
                changes=[]
                for collection in sorted(engine.OPTIONAL_COLLECTIONS):
                    if collection not in state:
                        state[collection]=[]
                        changes.append({"field":collection,"before":None,"after":[],"reason":"Add the explicit contract-delivery record collection without rewriting existing records."})
                if operation=="project.rename":
                    old=state["title"];state["title"]=engine.text(payload.get("title"),"Project title",True,300)
                    changes.append({"field":"title","before":old,"after":state["title"]})
                elif operation in ("record.save","record.remove"):
                    collection=payload.get("collection")
                    if collection not in engine.COLLECTIONS or collection in engine.IMMUTABLE:
                        raise ValueError("Use the corresponding explicit operation for a frozen edition, decision or financial receipt.")
                    if operation=="record.remove":
                        previous=engine.record(state,collection,payload.get("record_id"))
                        if collection=="votes" and any(r["ballot_id"]==previous["ballot_id"] for r in state["ballot_closures"]):
                            raise ValueError("A closed ballot retains its votes; create an explicit successor ballot.")
                        state[collection]=[r for r in state[collection] if r["id"]!=previous["id"]]
                        changes.append({"collection":collection,"record_id":previous["id"],"before":deepcopy(previous),"after":None})
                    else:
                        value=deepcopy(payload.get("record"))
                        if not isinstance(value,dict):raise ValueError("Supply a complete record object.")
                        value["id"]=value.get("id") or collection[:-1]+"-"+uuid.uuid4().hex
                        if collection=="votes" and any(r["ballot_id"]==value.get("ballot_id") for r in state["ballot_closures"]):
                            raise ValueError("Votes on a closed ballot are retained; open a successor ballot for a new vote.")
                        changes.append(self._put(state,collection,value))
                elif operation=="source.add":
                    name=filename(payload.get("filename"))
                    encoded=payload.get("content_base64")
                    if not isinstance(encoded,str) or len(encoded)>MAX_SOURCE_BYTES*4//3+16:raise ValueError("Source upload exceeds 32 MiB.")
                    raw=base64.b64decode(encoded,validate=True)
                    if not raw or len(raw)>MAX_SOURCE_BYTES:raise ValueError("Supply 1 byte through 32 MiB of actual source bytes.")
                    meta=file_identity(name,raw)
                    if not any(r["id"]==meta["id"] for r in state["files"]):state["files"].append(meta)
                    db.execute("INSERT OR IGNORE INTO originals VALUES(?,?)",(meta["sha256"],raw))
                    metadata=deepcopy(payload.get("metadata",{}))
                    metadata.update({"id":payload.get("source_id") or "source-"+meta["id"][5:],
                                     "source_file_id":meta["id"],"sha256":meta["sha256"]})
                    metadata.setdefault("title",name);metadata.setdefault("representation","original_bytes")
                    existing=next((r for r in state["sources"] if r["id"]==metadata["id"]),None)
                    if existing and (existing["source_file_id"]!=meta["id"] or existing["sha256"]!=meta["sha256"]):
                        raise ValueError("An existing source identity cannot be replaced with different original bytes; add a new version/source record.")
                    changes.append(self._put(state,"sources",metadata))
                elif operation=="records.import":
                    spec=deepcopy(payload.get("specification",{}));collection=spec.get("collection")
                    raw,meta=self._source_bytes(db,state,spec.get("source_id"))
                    parsed=parse_original(raw,meta["filename"],spec.get("parse_options"))
                    result=map_records(parsed,spec,collection,state)
                    if result["errors"]:raise ValueError("Import has unresolved source rows: "+canonical(result["errors"][:8]))
                    for mapped in result["rows"]:
                        if mapped["existing"]:
                            old={k:v for k,v in mapped["existing"].items() if k!="revision"}
                            new={k:v for k,v in mapped["record"].items() if k!="revision"}
                            if canonical(old)!=canonical(new):
                                raise ValueError("A previously imported identity has local edits; preserve them and explicitly map a successor import.")
                            continue
                        changes.append(self._put(state,collection,mapped["record"]))
                    import_record={"id":"import-"+digest({"source":spec.get("source_id"),"mapping":spec})[:32],"at":engine.now(),
                                   "source_id":spec["source_id"],"source_sha256":parsed["sha256"],"specification":spec,
                                   "record_ids":[r["record"]["id"] for r in result["rows"]]}
                    if not any(r["id"]==import_record["id"] for r in state["imports"]):state["imports"].append(import_record)
                else:
                    record_id=payload.get("id") or operation.split(".")[0]+"-"+uuid.uuid4().hex
                    engine.identity(record_id)
                    if operation=="edition.freeze":
                        collection="editions";value=engine.freeze_edition(state,payload,record_id)
                    elif operation=="language.record":
                        collection="language_reviews";clause=engine.record(state,"clauses",payload.get("clause_id"))
                        value=engine.validate_record(collection,{**{k:v for k,v in payload.items() if k!="id"},"id":record_id,
                            "recorded_at":engine.now(),"en_sha256":digest(engine.language_part(clause,"en")),
                            "fr_sha256":digest(engine.language_part(clause,"fr"))},state)
                    elif operation=="ballot.open":
                        collection="ballots";value=engine.freeze_ballot(state,payload,record_id)
                    elif operation=="ballot.close":
                        collection="ballot_closures";value=engine.close_ballot(state,payload,record_id)
                    elif operation=="decision.record":
                        collection="technical_decisions";value=engine.record_technical_decision(state,payload,record_id)
                    elif operation=="procedure.review":
                        collection="procedural_reviews";value=engine.record_procedural_review(state,payload,record_id)
                        past=self._past_development(db,project_id,value["reviewer_id"])
                        value["independence_snapshot"]["retained_development_history"]=past
                        if past:
                            value["independence_snapshot"]["known_development_involvement"].append("Earlier development involvement remains in the retained project history.")
                            value["independence_snapshot"]["no_known_involvement"]=False
                    elif operation=="delivery.register":
                        collection="delivery_registers";value=engine.record_delivery_register(state,payload,record_id)
                    elif operation=="phase.freeze":
                        collection="phase_reports";value=engine.freeze_phase_report(state,payload,record_id)
                    elif operation=="phase.response":
                        collection="report_responses";report=engine.record(state,"phase_reports",payload.get("report_id"))
                        value=engine.validate_record(collection,{**payload,"id":record_id,"report_sha256":report["input_sha256"],"recorded_at":engine.now()},state)
                    elif operation=="invoice.prepare":
                        collection="invoices";value=engine.prepare_invoice(state,payload,record_id)
                    elif operation=="invoice.response":
                        collection="invoice_responses";value=engine.validate_record(collection,{**payload,"id":record_id,"recorded_at":engine.now()},state)
                        if value["status"]=="void" and any(r["invoice_id"]==value["invoice_id"] for r in state["payments"]):
                            raise ValueError("An invoice with receipts/refunds cannot be voided; retain it and record the actual adjustment.")
                    elif operation=="payment.record":
                        collection="payments";value=engine.validate_record(collection,{**payload,"id":record_id,"recorded_at":engine.now()},state)
                        if engine.invoice_status(state,engine.record(state,"invoices",value["invoice_id"]))=="void":
                            raise ValueError("A void invoice cannot receive a new payment allocation.")
                    elif operation=="comment.carry":
                        collection="comments";previous=engine.record(state,"comments",payload.get("comment_id"))
                        value=deepcopy(previous);value.update({"id":record_id,"edition_id":payload.get("edition_id"),
                            "clause_id":payload.get("clause_id",previous["clause_id"]),"consultation_id":payload.get("consultation_id",""),
                            "disposition":"open","rationale":"","resolution_edition_id":"","resolution_clause_id":"",
                            "notification_at":"","notification_evidence":"","carried_from_id":previous["id"]})
                        value=engine.validate_record(collection,value,state)
                    else:raise ValueError("Unknown workspace operation: "+str(operation))
                    if any(r["id"]==record_id for r in state[collection]):
                        raise ValueError("That immutable/workflow record ID already exists; retry with the same request ID or create a distinct successor.")
                    changes.append(self._put(state,collection,value))
                state["revision"]+=1;state["updated_at"]=engine.now()
                self.validate(state)
                previous=json_read(db.execute("SELECT record FROM events WHERE project_id=? ORDER BY revision DESC LIMIT 1",(project_id,)).fetchone()[0])
                event=self._event(state,actor,operation,changes,previous["sha256"],request_id,request_digest)
                result={"id":project_id,"revision":state["revision"],"operation":operation,
                        "record_ids":[c["record_id"] for c in changes if "record_id" in c],"state_sha256":digest(state),"replayed":False}
                db.execute("UPDATE projects SET revision=?,state=? WHERE id=?",(state["revision"],canonical(state),project_id))
                db.execute("INSERT INTO events VALUES(?,?,?)",(project_id,state["revision"],canonical(event)))
                db.execute("INSERT INTO requests VALUES(?,?,?,?)",(project_id,request_id,request_digest,canonical(result)));db.commit()
                return result
            except Exception:db.rollback();raise

    def snapshot(self,project_id):
        """Read document, hash-linked history, request ledger and bytes together."""
        with self.connect() as db:
            db.execute("BEGIN")
            try:
                state=self._state(db,project_id)
                events=[json_read(r[0]) for r in db.execute("SELECT record FROM events WHERE project_id=? ORDER BY revision",(project_id,))]
                requests=[{"request_id":r["request_id"],"digest":r["digest"],"result":json_read(r["result"])}
                          for r in db.execute("SELECT request_id,digest,result FROM requests WHERE project_id=? ORDER BY request_id",(project_id,))]
                originals={}
                for meta in state["files"]:
                    row=db.execute("SELECT data FROM originals WHERE sha256=?",(meta["sha256"],)).fetchone()
                    if row is None:raise ValueError("Snapshot lacks a retained source original.")
                    originals[meta["id"]]=bytes(row[0])
                db.commit()
            except Exception:db.rollback();raise
        return state,events,requests,originals

    def restore(self,state,events,requests,originals):
        self.validate(state)
        if len(events)!=state["revision"]:raise ValueError("Archive history must contain every project revision.")
        previous=""
        request_events={}
        for index,event in enumerate(events,1):
            check=deepcopy(event);sha=check.pop("sha256",None)
            if event.get("project_id")!=state["id"] or event.get("revision")!=index or event.get("previous_hash")!=previous or digest(check)!=sha:
                raise ValueError("Development history has an inconsistent revision or hash link.")
            previous=sha
            if event.get("request_id"):
                if event["request_id"] in request_events:raise ValueError("History repeats an operation request.")
                request_events[event["request_id"]]=event
        if events[-1]["state_sha256"]!=digest(state):raise ValueError("Final development event differs from the archived project.")
        if {r["request_id"] for r in requests}!=set(request_events):raise ValueError("Request ledger differs from retained operation history.")
        for req in requests:
            event=request_events[req["request_id"]]
            if req["digest"]!=event["request_digest"] or req["result"]["revision"]!=event["revision"] or req["result"]["state_sha256"]!=event["state_sha256"]:
                raise ValueError("Archived request identity does not reconcile with its event.")
        if set(originals)!={r["id"] for r in state["files"]}:raise ValueError("Archive original-file inventory is incomplete or contains extra bytes.")
        for meta in state["files"]:
            raw=originals[meta["id"]]
            if file_identity(meta["filename"],raw)!=meta:raise ValueError("Original file differs from its source identity.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                existing=db.execute("SELECT state FROM projects WHERE id=?",(state["id"],)).fetchone()
                if existing:
                    if canonical(json_read(existing[0]))!=canonical(state):raise Conflict("A different revision of this project exists. Restore into a fresh workspace or retain the current project.")
                    current_events=[json_read(r[0]) for r in db.execute("SELECT record FROM events WHERE project_id=? ORDER BY revision",(state["id"],))]
                    if canonical(current_events)!=canonical(events):raise Conflict("Existing project history differs from this archive.")
                    db.rollback();return {"id":state["id"],"revision":state["revision"],"already_present":True}
                for meta in state["files"]:db.execute("INSERT OR IGNORE INTO originals VALUES(?,?)",(meta["sha256"],originals[meta["id"]]))
                db.execute("INSERT INTO projects VALUES(?,?,?)",(state["id"],state["revision"],canonical(state)))
                db.executemany("INSERT INTO events VALUES(?,?,?)",[(state["id"],e["revision"],canonical(e)) for e in events])
                db.executemany("INSERT INTO requests VALUES(?,?,?,?)",[(state["id"],r["request_id"],r["digest"],canonical(r["result"])) for r in requests]);db.commit()
            except Exception:db.rollback();raise
        return {"id":state["id"],"revision":state["revision"],"restored_originals":len(originals),"already_present":False}

    def adopt_seed(self,seed,source_files,seed_sha256):
        existing=next((r for r in self.list_projects() if r["id"]==seed["id"]),None)
        if existing:
            current=self.full_state(seed["id"])
            if current.get("seed_sha256")!=seed_sha256:raise Conflict("This example ID contains another source edition; preserve it or use a fresh workspace.")
            return {"id":seed["id"],"revision":current["revision"],"already_present":True}
        state=deepcopy(seed)
        state.update({"workspace_schema":SCHEMA,"revision":1,"created_at":engine.now(),"updated_at":engine.now(),
                      "files":[],"imports":[],"seed_sha256":seed_sha256})
        originals={}
        for source_id,(name,raw) in source_files.items():
            meta=file_identity(filename(name),raw)
            if not any(r["id"]==meta["id"] for r in state["files"]):state["files"].append(meta)
            originals[meta["id"]]=raw
            source=engine.record(state,"sources",source_id)
            source["source_file_id"]=meta["id"];source["sha256"]=meta["sha256"]
        self.validate(state)
        event=self._event(state,"Public source example","example.adopted",{"seed_sha256":seed_sha256,"originals":len(originals)},"")
        return self.restore(state,[event],[],originals)
