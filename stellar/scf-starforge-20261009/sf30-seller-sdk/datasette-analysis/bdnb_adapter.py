"""BDNB immutable source, territory, correspondence and review in Analysis.

All physical row editions use the original DatasetDatabase streaming importer.
The existing workspace lease, Datasette mutex and SQLite remain the owners.
"""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import sys

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0,str(HERE))

from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.storage import sync_directory
from bdnb_source import (FIELDS,HERE,MAX_ROW,clone,csv_rows,dictionary,encoded,file_identity,
    folder,identifier,need,normalize_descriptor,now,opened,publish,quote,retain_csv,sha,
    storage_row,text,source_dictionary)

READS={"bdnb.schema","bdnb.status","bdnb.get","bdnb.rows"}
KINDS={"edition","selection","comparison","review","publication","pack"}
CORE="batiment_groupe"
LINKS="rel_batiment_groupe_adresse"
ADDRESSES="adresse"
PASSAGE="passage_millesime_batiment_groupe_id"
META="metadonnees_bdnb_version"

def _body(value):
    need(isinstance(value,dict),"BODY_REQUIRED")
    return {k:clone(v) for k,v in value.items() if k!="resume"}

def _keys(value,required,optional=()):
    need(isinstance(value,dict) and set(required)<=set(value)<=set(required)|set(optional),"ACTION_FIELDS")

def _ref(entity):
    return {k:entity[k] for k in ("kind","id","sha256")}

def _empty_geometry():
    return {"state":"absent","crs":"EPSG:2154","encoding":None,"raw":None,"geojson":None,"findings":[]}

class DatasetteBdnb:
    def __init__(self,model):
        self.model=model;self.analysis=model.analysis;self.database=self.analysis.database
        self.operation_id=model.operation_id
        self.directory=folder(model.directory/"bdnb")
        if not getattr(model,"_bdnb_initialized",False):
            with model._mutex:
                if not getattr(model,"_bdnb_initialized",False):
                    with self.database._connection() as db:
                        db.execute("BEGIN IMMEDIATE")
                        try:
                            db.execute("CREATE TABLE IF NOT EXISTS sf_bdnb_entities(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,UNIQUE(operation_id,id))")
                            db.execute("CREATE TABLE IF NOT EXISTS sf_bdnb_intents(operation_id TEXT NOT NULL,id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(operation_id,id))")
                            db.execute("CREATE TABLE IF NOT EXISTS sf_bdnb_collections(operation_id TEXT NOT NULL,entity_id TEXT NOT NULL,name TEXT NOT NULL,request_sha256 TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(operation_id,entity_id,name))")
                            db.commit()
                        except BaseException:db.rollback();raise
            
                    model._bdnb_initialized=True

    def _engine(self):
        names=["bdnb_source.py","bdnb_adapter.py","bdnb_dictionary.json"]
        return {name:sha((HERE/name).read_bytes()) for name in names}

    def begin(self,kind,id,body,title):
        identifier(id);need(kind in KINDS,"ENTITY_KIND");text(title,"title",300)
        body=_body(body);request_sha=sha(encoded({"kind":kind,"id":id,"body":body}))
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row=db.execute("SELECT request_sha256,record FROM sf_bdnb_entities WHERE operation_id=? AND id=?",(self.operation_id,id)).fetchone()
                if row:
                    need(row["request_sha256"]==request_sha,"REQUEST_ID_CONFLICT")
                    db.commit();return json.loads(row["record"]),None
                row=db.execute("SELECT record FROM sf_bdnb_intents WHERE operation_id=? AND id=?",(self.operation_id,id)).fetchone()
                if row:
                    intent=json.loads(row["record"])
                    need(intent["kind"]==kind and intent["request_sha256"]==request_sha,"REQUEST_ID_CONFLICT")
                    need(intent["engine"]==self._engine(),"ORIGINAL_ENGINE_CHANGED")
                else:
                    intent={"schema":"stellar-forge.bdnb-intent.v1","operation_id":self.operation_id,"id":id,"kind":kind,
                            "title":title,"input":body,"request_sha256":request_sha,"created_at":now(),"engine":self._engine()}
                    db.execute("INSERT INTO sf_bdnb_intents VALUES(?,?,?)",(self.operation_id,id,encoded(intent).decode()))
                db.commit();return None,intent
            except BaseException:db.rollback();raise

    def commit(self,kind,id,body,title,summary,collections=None,files=None,lineage=None):
        saved,intent=self.begin(kind,id,body,title)
        if saved:return saved
        entity={"schema":"stellar-forge.bdnb-entity.v1","kind":kind,"id":id,"title":title,
                "created_at":intent["created_at"],"request_sha256":intent["request_sha256"],"input":intent["input"],
                "summary":clone(summary),"collections":clone(collections or {}),"files":clone(files or []),
                "lineage":clone(lineage or []),"engine":intent["engine"]}
        entity["sha256"]=sha(encoded(entity))
        with self.database._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                old=db.execute("SELECT record FROM sf_bdnb_entities WHERE operation_id=? AND id=?",(self.operation_id,id)).fetchone()
                if old:need(json.loads(old[0])==entity,"ENTITY_CHANGED")
                else:db.execute("INSERT INTO sf_bdnb_entities(operation_id,id,kind,request_sha256,record) VALUES(?,?,?,?,?)",(self.operation_id,id,kind,intent["request_sha256"],encoded(entity).decode()))
                db.commit()
            except BaseException:db.rollback();raise
        return clone(entity)

    def get(self,entity_id):
        identifier(entity_id)
        with self.database._connection(readonly=True) as db:
            row=db.execute("SELECT record FROM sf_bdnb_entities WHERE operation_id=? AND id=?",(self.operation_id,entity_id)).fetchone()
        need(row is not None,"ENTITY_NOT_FOUND")
        entity=json.loads(row[0]);actual=entity.pop("sha256");need(sha(encoded(entity))==actual,"ENTITY_HASH_CHANGED");entity["sha256"]=actual
        return entity

    def status(self):
        with self.database._connection(readonly=True) as db:
            values=[json.loads(r[0]) for r in db.execute("SELECT record FROM sf_bdnb_entities WHERE operation_id=? ORDER BY sequence",(self.operation_id,))]
        entities=[{key:v[key] for key in ("kind","id","title","sha256","created_at","summary","lineage")} for v in values]
        return {"schema":"stellar-forge.bdnb-status.v1","operation_id":self.operation_id,"entities":entities,
                "counts":{kind:sum(v["kind"]==kind for v in values) for kind in sorted(KINDS)}}

    def collection(self,entity_id,name):
        entity=self.get(entity_id)
        need(isinstance(name,str) and name in entity["collections"],"COLLECTION_NOT_FOUND")
        selected=entity["collections"][name]
        version=self.database.version(selected["version_id"])
        need(all(version.get(k)==selected.get(k) for k in ("table","row_count","row_order_column")),"COLLECTION_VERSION_CHANGED")
        return clone(selected)

    def rows(self,entity_id,collection,offset=0,limit=100):
        need(type(offset) is int and offset>=0 and type(limit) is int and 1<=limit<=250,"PAGE_INVALID")
        entity=self.get(entity_id);selected=self.collection(entity_id,collection)
        rows=[];page_bytes=0
        with self.database._connection(readonly=True) as db:
            cursor=db.execute("SELECT body_json FROM "+quote(selected["table"])+" ORDER BY "+quote(selected["row_order_column"])+" LIMIT ? OFFSET ?",(limit,offset))
            try:
                for stored in cursor:
                    length=len(stored[0].encode("utf-8"))
                    if rows and page_bytes+length>8*1024*1024:break
                    rows.append(json.loads(stored[0]));page_bytes+=length
            finally:cursor.close()
        if entity["kind"]=="comparison" and collection=="changes":
            for row in rows:self._review_row(entity_id,row)
        return {"schema":"stellar-forge.bdnb-page.v1","entity_id":entity_id,"entity_sha256":entity["sha256"],
                "collection":collection,"offset":offset,"limit":limit,"total":selected["row_count"],
                "next_offset":offset+len(rows) if offset+len(rows)<selected["row_count"] else None,
                "rows":rows,"columns":selected["columns"],"version_id":selected["version_id"]}

    @contextmanager
    def stream_rows(self,entity_id,collection):
        selected=self.collection(entity_id,collection)
        with self.database.stream_query("SELECT body_json FROM "+quote(selected["table"])+" ORDER BY "+quote(selected["row_order_column"]),timeout=300) as rows:
            yield (json.loads(row[0]) for row in rows)

    def _import_collection(self,id,name,request,rows,metadata):
        request_sha=sha(encoded(request))
        with self.database._connection(readonly=True) as db:
            old=db.execute("SELECT request_sha256,record FROM sf_bdnb_collections WHERE operation_id=? AND entity_id=? AND name=?",(self.operation_id,id,name)).fetchone()
        if old:
            need(old["request_sha256"]==request_sha,"COLLECTION_REQUEST_CHANGED")
            selected=json.loads(old["record"]);version=self.database.version(selected["version_id"])
            need(version["row_count"]==selected["row_count"],"COLLECTION_VERSION_CHANGED");return selected
        directory=folder(self.directory/"rows"/id)
        fd,temporary=tempfile.mkstemp(prefix=".rows-",dir=directory)
        count=0;size=0;digest=hashlib.sha256();findings=0;invalid_keys=0
        try:
            with os.fdopen(fd,"wb") as output:
                for row in rows:
                    value=storage_row(row);raw=encoded(value)+b"\n"
                    need(len(raw)<=MAX_ROW,"NATIVE_ROW_CAPACITY")
                    output.write(raw);digest.update(raw);size+=len(raw);count+=1
                    findings+=bool(row.get("findings"));invalid_keys+=row.get("key") is None
                output.flush();os.fsync(output.fileno())
            source={"bytes":size,"sha256":digest.hexdigest()}
            manifest={"schema":"stellar-forge.bdnb-row-manifest.v1","operation_id":self.operation_id,"entity_id":id,"collection":name,
                      "request_sha256":request_sha,"metadata":metadata,"rows":count,"columns":FIELDS,"source":source,
                      "representation":"original-csv-strings-with-separate-exact-typed-projection-v1"}
            manifest_bytes=encoded(manifest)
            identity={"schema":"stellar-forge.python-dataset-sqlite.v1","manifestSha256":sha(manifest_bytes),
                      "sourceBindingSha256":sha(encoded({"request":request,"metadata":metadata})),"columns":[[f,f] for f in FIELDS]}
            @contextmanager
            def opener():
                with opened(Path(temporary)) as (stream,_):yield stream
            version=self.database._import_rows(manifest_bytes=manifest_bytes,identity=identity,fields=FIELDS,mapped=FIELDS,total=count,
                    source=source,opener=opener,details={"dataset":{"kind":"bdnb","name":name,"rows":count,"projectedFields":FIELDS,
                    "source":metadata},"source_pages":None,"row_representation":"bdnb-full-record-v1"})
            selected={"version_id":version["version_id"],"table":version["table"],"row_count":count,"columns":FIELDS,
                      "row_order_column":version["row_order_column"],"finding_rows":findings,"unkeyed_rows":invalid_keys}
            with self.database._connection() as db:
                db.execute("BEGIN IMMEDIATE")
                try:
                    # Indexes belong to immutable original row tables and travel
                    # with the original backup. They do not create a new row owner.
                    for columns in [("id",),("key_json",),("group_id",),("address_id",),("old_edition","old_id"),("new_edition","new_id")]:
                        index="sf_bdnb_idx_"+sha(encoded([version["version_id"],columns]))[:32]
                        db.execute("CREATE INDEX IF NOT EXISTS "+quote(index)+" ON "+quote(version["table"])+"("+",".join(map(quote,columns))+")")
                    old=db.execute("SELECT request_sha256,record FROM sf_bdnb_collections WHERE operation_id=? AND entity_id=? AND name=?",(self.operation_id,id,name)).fetchone()
                    if old:need(old[0]==request_sha and json.loads(old[1])==selected,"COLLECTION_CHANGED")
                    else:db.execute("INSERT INTO sf_bdnb_collections VALUES(?,?,?,?,?)",(self.operation_id,id,name,request_sha,encoded(selected).decode()))
                    db.commit()
                except BaseException:db.rollback();raise
            return selected
        finally:
            os.unlink(temporary);sync_directory(directory)

    def _source_sql(self,collection,where="",parameters=()):
        with self.database._connection(readonly=True) as db:
            db.execute("BEGIN")
            query="SELECT body_json FROM "+quote(collection["table"])+((" WHERE "+where) if where else "")+" ORDER BY "+quote(collection["row_order_column"])
            cursor=db.execute(query,parameters)
            try:
                for row in cursor:yield json.loads(row[0])
            finally:cursor.close()

    def import_edition(self,body):
        _keys(body,{"edition_id","descriptor"},{"resume"})
        body={"edition_id":identifier(body["edition_id"]),"descriptor":normalize_descriptor(body["descriptor"])}
        id=body["edition_id"];descriptor=body["descriptor"];title=descriptor["title"]
        saved,intent=self.begin("edition",id,body,title)
        if saved:return {"entity":saved,"replayed":True}
        collections={};originals=[]
        for table in descriptor["tables"]:
            original,retained=retain_csv(self,id,descriptor,table)
            metadata={"edition_id":id,"table":table["table"],"descriptor":descriptor,"original":retained,
                      "dictionary_sha256":sha(encoded(source_dictionary(descriptor))),"dictionary":source_dictionary(descriptor)}
            collections[table["table"]]=self._import_collection(id,table["table"],body,csv_rows(original,table,descriptor,id),metadata)
            originals.append({"table":table["table"],**retained})
        counts={key:value["row_count"] for key,value in collections.items()}
        duplicates={}
        with self.database._connection(readonly=True) as db:
            for key,value in collections.items():
                duplicates[key]=db.execute("SELECT COUNT(*) FROM (SELECT key_json FROM "+quote(value["table"])+" WHERE key_valid=1 GROUP BY key_json HAVING COUNT(*)>1)").fetchone()[0]
        summary={"millesime":descriptor["millesime"],"structure_version":descriptor["structure_version"],"scope":descriptor["scope"],
                 "table_counts":counts,"duplicate_key_groups":duplicates,"finding_rows":sum(v["finding_rows"] for v in collections.values()),
                 "missing_tables":[t["name"] for t in dictionary()[0]["tables"] if t["name"] not in collections],
                 "original_files":originals,"dictionary_sha256":sha(encoded(source_dictionary(descriptor))),"dictionary":source_dictionary(descriptor)}
        entity=self.commit("edition",id,body,title,summary,collections)
        return {"entity":entity,"replayed":False}

    def select(self,body):
        _keys(body,{"selection_id","edition_id","title","filters"},{"resume"})
        body=_body(body);id=identifier(body["selection_id"]);edition=self.get(body["edition_id"])
        need(edition["kind"]=="edition","EDITION_REQUIRED");text(body["title"],"title",300)
        filters=body["filters"];_keys(filters,{"department_codes","commune_codes","group_ids"})
        for key,values in filters.items():
            need(isinstance(values,list) and len(values)<=10000 and all(isinstance(v,str) and 0<len(v)<=200 for v in values) and len(set(values))==len(values),"SELECTION_VALUES",key)
        saved,intent=self.begin("selection",id,body,body["title"])
        if saved:return {"entity":saved,"replayed":True}
        clauses=[];parameters=[]
        for key,col in [("department_codes","department_code"),("commune_codes","commune_code"),("group_ids","group_id")]:
            if filters[key]:clauses.append(quote(col)+" IN ("+",".join("?" for _ in filters[key])+")");parameters+=filters[key]
        request={"input":body,"edition":_ref(edition)}
        collections={}
        groups=self.collection(edition["id"],CORE)
        if not clauses:collections[CORE]=groups
        else:collections[CORE]=self._import_collection(id,CORE,request,self._source_sql(groups," AND ".join(clauses),parameters),{"selection":body,"source":_ref(edition),"source_collection":groups})
        group_table=quote(collections[CORE]["table"])
        for name in [LINKS,ADDRESSES,PASSAGE,META]:
            if name not in edition["collections"]:continue
            original=self.collection(edition["id"],name)
            if name==LINKS:
                where="group_id IN (SELECT group_id FROM "+group_table+" WHERE key_valid=1)"
            elif name==ADDRESSES:
                if LINKS not in collections:
                    # No fabricated group/address mapping; actual edition
                    # addresses remain available in the original edition.
                    continue
                where="address_id IN (SELECT address_id FROM "+quote(collections[LINKS]["table"])+" WHERE address_id IS NOT NULL)"
            else:
                collections[name]=original;continue
            collections[name]=self._import_collection(id,name,request,self._source_sql(original,where),{"selection":body,"source":_ref(edition),"source_collection":original})
        summary={"millesime":edition["summary"]["millesime"],"structure_version":edition["summary"]["structure_version"],
                 "scope":edition["summary"]["scope"],"filters":filters,"table_counts":{k:v["row_count"] for k,v in collections.items()},
                 "finding_rows":sum(v.get("finding_rows",0) for v in collections.values()),
                 "missing_tables":[t["name"] for t in dictionary()[0]["tables"] if t["name"] not in collections],
                 "source_edition":_ref(edition),"dictionary_sha256":edition["summary"]["dictionary_sha256"],"dictionary":edition["summary"]["dictionary"]}
        return {"entity":self.commit("selection",id,body,body["title"],summary,collections,lineage=[_ref(edition)]),"replayed":False}

    def _reviews(self,comparison_id,item_id=None):
        with self.database._connection(readonly=True) as db:
            values=[json.loads(r[0]) for r in db.execute("SELECT record FROM sf_bdnb_entities WHERE operation_id=? AND kind='review' AND json_extract(record,'$.input.comparison_id')=? AND (? IS NULL OR json_extract(record,'$.input.item_id')=?) ORDER BY sequence",(self.operation_id,comparison_id,item_id,item_id))]
        return values

    def current_reviews(self,comparison_id):
        entity=self.get(comparison_id);need(entity["kind"]=="comparison","COMPARISON_REQUIRED")
        all_values=self._reviews(comparison_id);superseded={v["input"]["supersedes_id"] for v in all_values if v["input"]["supersedes_id"]}
        current=[v for v in all_values if v["id"] not in superseded];by_item={}
        for value in current:by_item.setdefault(value["input"]["item_id"],[]).append(value)
        result={"comparison_id":comparison_id,"reviews":current,"conflicts":[{"item_id:key,"review_ids":[v["id"] for v in vals]} for key,vals in sorted(by_item.items()) if len(vals)>1]}
        result["sha256"]=sha(encoded(result));return result

    def _review_row(self,comparison_id,row):
        reviews=self._reviews(comparison_id,row["id"]);superseded={r["input"]["supersedes_id"] for r in reviews}
        tips=[r for r in reviews if r["id"] not in superseded]
        row["review"]=({**tips[0],"history_ids":[r["id"] for r in reviews],"tip_conflicts":[]} if len(tips)==1 else None)
        row["review_ids"]=[r["id"] for r in reviews]
        row["review_conflicts"]=[r["id"] for r in tips] if len(tips)>1 else []

    def review(self,body):
        _keys(body,{"review_id","comparison_id","item_id","evidence_sha256","outcome","author","reason","supersedes_id"},{"resume"})
        body=_body(body);id=identifier(body["review_id"]);comparison=self.get(body["comparison_id"])
        need(comparison["kind"]=="comparison","COMPARISON_REQUIRED")
        need(body["outcome"] in {"accepted","needs-review","deferred","rejected"},"REVIEW_OUTCOME")
        text(body["author"],"author",300);text(body["reason"],"reason",12000)
        title="Review "+body["outcome"]+": "+body["item_id"][:12]
        saved,intent=self.begin("review",id,body,title)
        if saved:return {"entity":saved,"replayed":True}
        table=self.collection(comparison["id"],"changes")
        with self.database._connection(readonly=True) as db:
            found=db.execute("SELECT body_json FROM "+quote(table["table"])+" WHERE id=?",(body["item_id"],)).fetchall()
        need(len(found)==1,"REVIEW_ITEM_NOT_UNIQUE");item=json.loads(found[0][0])
        need(item["evidence_sha256"]==body["evidence_sha256"],"REVIEW_EVIDENCE_CHANGED")
        prior=self._reviews(comparison["id"],item["id"]);removed={r["input"]["supersedes_id"] for r in prior};tips=[r for r in prior if r["id"] not in removed]
        if tips:need(len(tips)==1 and body["supersedes_id"]==tips[0]["id"],"REVIEW_CURRENT_TIP_REQUIRED")
        else:need(body["supersedes_id"] is None,"REVIEW_PARENT_MISSING")
        # The enclosing original Datasette mutex spans this current-tip check
        # and the immutable commit; interrupted unpublished requests recheck it.
        entity=self.commit("review",id,body,title,{"comparison_id":comparison["id"],"item_id":item["id"],"outcome":body["outcome"],"evidence_sha256":item["evidence_sha256"]},
                           lineage=[_ref(comparison)]+([_ref(tips[0])] if tips else []))
        return {"entity":entity,"replayed":False}

    def _find(self,db,collection,key):
        return [json.loads(row[0]) for row in db.execute("SELECT body_json FROM "+quote(collection["table"])+" WHERE key_json=? ORDER BY "+quote(collection["row_order_column"]),(encoded(key).decode(),))]

    def compare(self,body):
        _keys(body,{"comparison_id","before_selection_id","after_selection_id","title","passage_edition_ids","correspondence_mode","fields","include_unchanged"},{"resume","edition_path"})
        body=_body(body);id=identifier(body["comparison_id"]);text(body["title"],"title",300)
        before=self.get(body["before_selection_id"]);after=self.get(body["after_selection_id"])
        need(before["kind"]==after["kind"]=="selection","SELECTION_REQUIRED")
        bm=before["summary"]["millesime"];am=after["summary"]["millesime"];need(bm!=am,"DISTINCT_EDITIONS_REQUIRED")
        need(body["correspondence_mode"] in {"direct","chain"} and type(body["include_unchanged"]) is bool,"COMPARE_OPTIONS")
        path=body.get("edition_path")
        if body["correspondence_mode"]=="chain":
            need(isinstance(path,list) and 2<=len(path)<=100 and all(isinstance(v,str) and v for v in path) and len(set(path))==len(path) and path[0]==bm and path[-1]==am,"EXPLICIT_EDITION_PATH_REQUIRED")
        else:
            need(path is None or path==[bm,am],"DIRECT_EDITION_PATH")
            path=[bm,am]
        body["edition_path"]=path
        need(body["fields"] is None or isinstance(body["fields"],list) and body["fields"] and all(isinstance(x,str) for x in body["fields"]) and len(set(body["fields"]))==len(body["fields"]),"COMPARE_FIELDS")
        need(isinstance(body["passage_edition_ids"],list) and len(body["passage_edition_ids"])<=100 and len(set(body["passage_edition_ids"]))==len(body["passage_edition_ids"]),"PASSAGE_SELECTION")
        passages=[self.get(v) for v in body["passage_edition_ids"]]
        need(all(v["kind"]=="edition" and PASSAGE in v["collections"] for v in passages),"PASSAGE_EDITION_REQUIRED")
        saved,intent=self.begin("comparison",id,body,body["title"])
        if saved:return {"entity":saved,"replayed":True}
        collections_before=before["collections"];collections_after=after["collections"]
        passage_collections=[self.collection(v["id"],PASSAGE) for v in passages]
        presence_editions={v["id"]:v for v in passages}
        for selected in (before,after):
            original=self.get(selected["input"]["edition_id"]);presence_editions[original["id"]]=original
        presence={}
        for edition in presence_editions.values():
            presence.setdefault(edition["summary"]["millesime"],[]).append(self.collection(edition["id"],CORE))
        request={"input":body,"before":_ref(before),"after":_ref(after),"passages":[_ref(p) for p in passages]}
        classification_counts={};kind_counts={}
        def records():
            with self.database._connection() as db:
                # These TEMP tables are bounded-memory, disk-backed SQLite
                # bookkeeping only; permanent rows remain native editions.
                db.execute("PRAGMA temp_store=FILE")
                db.execute("CREATE TEMP TABLE bdnb_seen(side TEXT,id TEXT,PRIMARY KEY(side,id))")
                db.execute("BEGIN")
                def seen(side,key):return db.execute("SELECT 1 FROM bdnb_seen WHERE side=? AND id=?",(side,key)).fetchone() is not None
                def mark(side,key):db.execute("INSERT OR IGNORE INTO bdnb_seen VALUES(?,?)",(side,key))
                def edge_rows(edition,key,reverse=False):
                    result={}
                    for col in passage_collections:
                        field1,field2=("new_edition","new_id") if reverse else ("old_edition","old_id")
                        for row in db.execute("SELECT body_json FROM "+quote(col["table"])+" WHERE "+field1+"=? AND "+field2+"=? ORDER BY "+quote(col["row_order_column"]),(edition,key)):
                            value=json.loads(row[0]);result[value["id"]]=value
                    return list(result.values())
                def presence_rows(edition,key):
                    found={}
                    for col in presence.get(edition,[]):
                        for value in self._find(db,col,[key]):found[value["id"]]=value
                    return list(found.values())
                def traverse(start_edition,key,target_edition,reverse=False):
                    ordered=list(reversed(path)) if reverse else path
                    need(ordered[0]==start_edition and ordered[-1]==target_edition,"EDITION_PATH_ENDPOINT")
                    nodes={key};edges={};findings=[];continuity={}
                    for e1,e2 in zip(ordered,ordered[1:]):
                        following=set()
                        for node in sorted(nodes):
                            candidates=[]
                            for edge in edge_rows(e1,node,reverse=reverse):
                                value=edge["typed"].get("ancien_millesime" if reverse else "nouveau_millesime")
                                if value and value["state"]=="value" and value["value"]==e2:candidates.append(edge)
                            if candidates:
                                for edge in candidates:
                                    edges[edge["id"]]=edge
                                    if edge["key"] is None or edge["findings"]:findings.append({"code":"PASSAGE_SOURCE_REVIEW","row_id":edge["id"]})
                                    target=edge["typed"].get("ancien_id" if reverse else "nouvel_id")
                                    if target and target["state"]=="value" and isinstance(target["value"],str) and target["value"]:
                                        following.add(target["value"])
                                    elif target and target["state"] not in {"null"}:
                                        findings.append({"code":"PASSAGE_TARGET_IDENTITY_UNAVAILABLE","row_id":edge["id"]})
                            else:
                                # The selected path may contain unchanged intervals.
                                # Original group occurrences in both complete editions
                                # prove presence; missing passage rows alone never do.
                                left=presence_rows(e1,node);right=presence_rows(e2,node)
                                if left and right:
                                    evidence={"kind":"unchanged-identity-carry","from_millesime":e1,"to_millesime":e2,
                                              "group_id":node,"before":left,"after":right,
                                              "basis":"Same original group ID is present in both explicitly selected editions; selected passage evidence contains no outgoing change for this interval."}
                                    continuity[sha(encoded(evidence))]=evidence;following.add(node)
                                elif e2!=target_edition or not left:
                                    findings.append({"code":"UNCHANGED_INTERVAL_PRESENCE_UNAVAILABLE","from_millesime":e1,"to_millesime":e2,"group_id":node,"before_present":bool(left),"after_present":bool(right)})
                        nodes=following;need(len(nodes)+len(edges)<=10000,"CORRESPONDENCE_COMPONENT_CAPACITY")
                    return nodes,edges,findings,continuity
                def emit(kind,classification,key,left,right,changes,edges=None,findings=None,continuity=None):
                    row={"kind":kind,"classification":classification,"key":key,"before":left,"after":right,"changes":changes,
                         "correspondence":{"mode":body["correspondence_mode"],"edition_path":path,"edges":list((edges or {}).values()),"continuity":list((continuity or {}).values()),"findings":findings or []},
                         "findings":findings or []}
                    row["evidence_sha256"]=sha(encoded({"request":request,"finding":row}))
                    row["id"]=sha(encoded({"comparison_id":id,"evidence_sha256":row["evidence_sha256"]}))
                    classification_counts[classification]=classification_counts.get(classification,0)+1
                    kind_counts[kind]=kind_counts.get(kind,0)+1
                    return row
                def changes(left,right,all_fields=False):
                    fields=(None if all_fields else body["fields"]) or sorted(set().union(*(r["typed"].keys() for r in left+right)))
                    result=[]
                    for field in fields:
                        a=[r["typed"].get(field,{"type":"unknown","state":"missing","value":None,"raw":None,"unit":None}) for r in left]
                        b=[r["typed"].get(field,{"type":"unknown","state":"missing","value":None,"raw":None,"unit":None}) for r in right]
                        both_missing=bool(a and b) and all(v["state"]=="missing" for v in a+b)
                        invalid=any(v["state"] in {"invalid","missing"} for v in a+b) and not both_missing
                        def value(v):return {k:v.get(k) for k in ("type","state","value","unit")}
                        state="equal" if both_missing else "unknown" if invalid or len(a)!=1 or len(b)!=1 else ("equal" if value(a[0])==value(b[0]) else "different")
                        if state!="equal" or body["include_unchanged"]:result.append({"field":field,"before":a,"after":b,"state":state,"reason":"Grouped correspondence retains all original values." if len(a)!=1 or len(b)!=1 else ("Original typed evidence is unresolved." if invalid else "Exact typed comparison.")})
                    return result
                bcol=collections_before[CORE];acol=collections_after[CORE]
                cursor=db.execute("SELECT body_json FROM "+quote(bcol["table"])+" ORDER BY "+quote(bcol["row_order_column"]))
                try:
                    for stored in cursor:
                        first=json.loads(stored[0]);key=first["key"]
                        if key is None:
                            yield emit("group","unresolved",["invalid",first["id"]],[first],[],[],findings=[{"code":"SOURCE_IDENTITY_UNAVAILABLE"}]);continue
                        group_id=key[0]
                        if seen("before",group_id):continue
                        leftkeys={group_id};rightkeys=set();edges={};findings=[];continuity={}
                        # Existing same identifiers are explicit continuity,
                        # never proof that an unmatched ID was created/deleted.
                        targets,e,f,c=traverse(bm,group_id,am);rightkeys|=targets;edges.update(e);findings+=f;continuity.update(c)
                        pending=list(rightkeys)
                        while pending:
                            target=pending.pop()
                            predecessors,e,f,c=traverse(am,target,bm,reverse=True);edges.update(e);findings+=f;continuity.update(c)
                            for predecessor in predecessors-leftkeys:
                                leftkeys.add(predecessor)
                                targets,e,f,c=traverse(bm,predecessor,am);edges.update(e);findings+=f;continuity.update(c)
                                new=targets-rightkeys;rightkeys|=targets;pending+=list(new)
                            need(len(leftkeys)+len(rightkeys)<=10000,"CORRESPONDENCE_COMPONENT_CAPACITY")
                        left=[];right=[]
                        for k in sorted(leftkeys):
                            rows=self._find(db,bcol,[k])
                            if rows:left+=rows;mark("before",k)
                            else:findings.append({"code":"PREDECESSOR_OUTSIDE_SELECTED_SCOPE","id":k})
                        for k in sorted(rightkeys):
                            rows=self._find(db,acol,[k])
                            if rows:right+=rows;mark("after",k)
                            else:findings.append({"code":"SUCCESSOR_OUTSIDE_SELECTED_SCOPE","id":k})
                        if any(len(self._find(db,bcol,[k]))>1 for k in leftkeys) or any(len(self._find(db,acol,[k]))>1 for k in rightkeys):
                            findings.append({"code":"DUPLICATE_LOGICAL_IDENTITY"})
                        delta=changes(left,right)
                        if not right:
                            deleted=any((e["typed"].get("type_modification") or {}).get("value")=="suppression" and (e["typed"].get("ancien_millesime") or {}).get("value")==bm and (e["typed"].get("nouveau_millesime") or {}).get("value")==am for e in edges.values())
                            classification="unresolved" if any(f["code"] not in {"SUCCESSOR_OUTSIDE_SELECTED_SCOPE","PREDECESSOR_OUTSIDE_SELECTED_SCOPE"} for f in findings) else ("deleted" if deleted else "scope-exit")
                            findings.append({"code":"PUBLISHER_DELETION_EVIDENCE" if deleted else "ABSENCE_WITHIN_SELECTED_SCOPE"})
                        elif findings:classification="unresolved"
                        elif len(left)>1 and len(right)>1:classification="complex"
                        elif len(left)>1:classification="merged"
                        elif len(right)>1:classification="split"
                        elif any(v["state"]=="unknown" for v in delta):classification="unresolved"
                        elif left[0]["key"]!=right[0]["key"]:classification="renamed"
                        else:classification="changed" if any(v["state"]=="different" for v in delta) else "unchanged"
                        if classification!="unchanged" or body["include_unchanged"]:
                            yield emit("group",classification,{"before":sorted(leftkeys),"after":sorted(rightkeys)},left,right,delta,edges,findings,continuity)
                finally:cursor.close()
                cursor=db.execute("SELECT body_json FROM "+quote(acol["table"])+" ORDER BY "+quote(acol["row_order_column"]))
                try:
                    for stored in cursor:
                        row=json.loads(stored[0]);key=row["key"]
                        if key is None:
                            yield emit("group","unresolved",["invalid",row["id"]],[],[row],[],findings=[{"code":"TARGET_IDENTITY_UNAVAILABLE"}]);continue
                        if seen("after",key[0]):continue
                        mark("after",key[0])
                        target_rows=self._find(db,acol,key);previous,edges,findings,continuity=traverse(am,key[0],bm,reverse=True)
                        created=any((e["typed"].get("type_modification") or {}).get("value")=="creation" and (e["typed"].get("ancien_millesime") or {}).get("value")==bm and (e["typed"].get("nouveau_millesime") or {}).get("value")==am for e in edges.values())
                        if len(target_rows)>1:findings.append({"code":"DUPLICATE_LOGICAL_IDENTITY"})
                        classification="unresolved" if findings else ("created" if created else "scope-entry")
                        findings.append({"code":"PUBLISHER_CREATION_EVIDENCE" if created else "ABSENCE_WITHIN_SELECTED_SCOPE"})
                        yield emit("group",classification,key,[],target_rows,[],edges,findings,continuity)
                finally:cursor.close()
                # Links are compared at their full original composite key.
                # Renamed groups are never silently remapped in this register.
                lbefore=collections_before.get(LINKS);lafter=collections_after.get(LINKS)
                if not lbefore or not lafter:
                    yield emit("coverage","unresolved",["address-links"],[],[],[],findings=[{"code":"ADDRESS_LINK_TABLE_UNAVAILABLE","before":bool(lbefore),"after":bool(lafter)}])
                else:
                    for side,col,other in [("link-before",lbefore,lafter),("link-after",lafter,lbefore)]:
                        cursor=db.execute("SELECT body_json FROM "+quote(col["table"])+" ORDER BY "+quote(col["row_order_column"]))
                        try:
                            for stored in cursor:
                                row=json.loads(stored[0]);key=row["key"]
                                if key is None:
                                    yield emit("address-link","unresolved",["invalid",row["id"]],[row] if side=="link-before" else [],[row] if side=="link-after" else [],[],findings=[{"code":"LINK_IDENTITY_UNAVAILABLE"}]);continue
                                token=encoded(key).decode()
                                if seen("link",token):continue
                                mark("link",token);same=self._find(db,col,key);opposite=self._find(db,other,key)
                                left,right=(same,opposite) if side=="link-before" else (opposite,same)
                                delta=changes(left,right,all_fields=True)
                                findings=[]
                                if len(left)>1 or len(right)>1:findings.append({"code":"DUPLICATE_LINK_IDENTITY"})
                                classification="unresolved" if findings or any(v["state"]=="unknown" for v in delta) and left and right else ("scope-entry" if not left else "scope-exit" if not right else "changed" if any(v["state"]=="different" for v in delta) else "unchanged")
                                if classification!="unchanged" or body["include_unchanged"]:yield emit("address-link",classification,key,left,right,delta,findings=findings)
                        finally:cursor.close()
                # Address attributes have their own original key and typed
                # comparison; link changes do not substitute for address edits.
                address_before=collections_before.get(ADDRESSES);address_after=collections_after.get(ADDRESSES)
                if not address_before or not address_after:
                    yield emit("coverage","unresolved",["addresses"],[],[],[],findings=[{"code":"ADDRESS_TABLE_UNAVAILABLE","before":bool(address_before),"after":bool(address_after)}])
                else:
                    for side,col,other in [("address-before",address_before,address_after),("address-after",address_after,address_before)]:
                        cursor=db.execute("SELECT body_json FROM "+quote(col["table"])+" ORDER BY "+quote(col["row_order_column"]))
                        try:
                            for stored in cursor:
                                row=json.loads(stored[0]);key=row["key"]
                                if key is None:
                                    yield emit("address","unresolved",["invalid",row["id"]],[row] if side=="address-before" else [],[row] if side=="address-after" else [],[],findings=[{"code":"ADDRESS_IDENTITY_UNAVAILABLE"}]);continue
                                token=encoded(key).decode()
                                if seen("address",token):continue
                                mark("address",token);same=self._find(db,col,key);opposite=self._find(db,other,key)
                                left,right=(same,opposite) if side=="address-before" else (opposite,same)
                                delta=changes(left,right,all_fields=True);findings=[]
                                if len(left)>1 or len(right)>1:findings.append({"code":"DUPLICATE_ADDRESS_IDENTITY"})
                                classification="unresolved" if findings or any(v["state"]=="unknown" for v in delta) and left and right else ("scope-entry" if not left else "scope-exit" if not right else "changed" if any(v["state"]=="different" for v in delta) else "unchanged")
                                if classification!="unchanged" or body["include_unchanged"]:yield emit("address",classification,key,left,right,delta,findings=findings)
                        finally:cursor.close()
                if before["summary"]["dictionary_sha256"]!=after["summary"]["dictionary_sha256"] or before["summary"]["structure_version"]!=after["summary"]["structure_version"]:
                    old_dictionary=before["summary"]["dictionary"];new_dictionary=after["summary"]["dictionary"]
                    old_fields={(t["name"],f["name"]):f for t in old_dictionary["tables"] for f in t["fields"]}
                    new_fields={(t["name"],f["name"]):f for t in new_dictionary["tables"] for f in t["fields"]}
                    dictionary_changes=[{"field":table+"."+name,"before":old_fields.get((table,name)),"after":new_fields.get((table,name)),
                        "state":"different","reason":"Complete selected publisher field definition changed."}
                        for table,name in sorted(set(old_fields)|set(new_fields)) if old_fields.get((table,name))!=new_fields.get((table,name))]
                    yield emit("dictionary","changed",["dictionary"],
                        [{"dictionary_sha256":before["summary"]["dictionary_sha256"],"structure_version":before["summary"]["structure_version"],"dictionary":old_dictionary}],
                        [{"dictionary_sha256":after["summary"]["dictionary_sha256"],"structure_version":after["summary"]["structure_version"],"dictionary":new_dictionary}],dictionary_changes)
                db.rollback()
        selected=self._import_collection(id,"changes",request,records(),{"comparison":request})
        # A resumed already imported collection must derive its complete
        # counts from that retained original version, not an unconsumed iterator.
        with self.database._connection(readonly=True) as db:
            classification_counts={r[0]:r[1] for r in db.execute("SELECT classification,COUNT(*) FROM "+quote(selected["table"])+" GROUP BY classification")}
        summary={"before":_ref(before),"after":_ref(after),"millesimes":{"before":bm,"after":am},"changes":selected["row_count"],
                 "classification_counts":classification_counts,"passage_editions":[_ref(p) for p in passages],
                 "include_unchanged":body["include_unchanged"],"scope_before":before["summary"]["scope"],"scope_after":after["summary"]["scope"],
                 "review_policy":"Original evidence and exact review history; acceptance is an operator observation."}
        row={"id":sha(encoded(summary)),"key":["summary"],"kind":"summary","classification":"summary","summary":summary}
        summary_collection=self._import_collection(id,"summary",request,[row],{"comparison":request})
        entity=self.commit("comparison",id,body,body["title"],summary,{"changes":selected,"summary":summary_collection},lineage=[_ref(before),_ref(after)]+[_ref(p) for p in passages])
        return {"entity":entity,"replayed":False}

    def dispatch(self,action,body=None):
        body={} if body is None else body;need(isinstance(body,dict),"BODY_REQUIRED")
        if action=="bdnb.schema":
            contract=json.loads((HERE/"bdnb_contract.json").read_bytes())
            return {"schema":"stellar-forge.bdnb-schema.v1","contract":contract,"dictionary":dictionary()[0],
                    "limits":{"page_rows":250,"page_bytes":8388608,"csv_record_bytes":MAX_ROW,"command_bytes":1048576},"read_actions":sorted(READS)}
        if action=="bdnb.status":_keys(body,set());return self.status()
        if action=="bdnb.get":_keys(body,{"entity_id"});return self.get(body["entity_id"])
        if action=="bdnb.rows":
            _keys(body,{"entity_id","collection"},{"offset","limit"})
            return self.rows(body["entity_id"],body["collection"],body.get("offset",0),body.get("limit",100))
        if action=="bdnb.import":return self.import_edition(body)
        if action=="bdnb.select":return self.select(body)
        if action=="bdnb.compare":return self.compare(body)
        if action=="bdnb.review":return self.review(body)
        if action in {"bdnb.publish","bdnb.pack"}:
            import bdnb_products
            return bdnb_products.dispatch_bdnb_product(self,action,body)
        need(False,"ACTION_UNKNOWN",action)

@contextmanager
def open_bdnb_download(model,name):
    adapter=DatasetteBdnb(model)
    candidates=[]
    for entity in adapter.status()["entities"]:
        if entity["kind"] in {"publication","pack"}:
            candidates.extend(item for item in adapter.get(entity["id"])["files"] if item.get("name")==name)
    need(len(candidates)==1,"DOWNLOAD_NOT_UNIQUE")
    import bdnb_products
    with bdnb_products.open_product_download(adapter,candidates[0]) as value:yield value
