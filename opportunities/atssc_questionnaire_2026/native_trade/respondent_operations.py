"""Company coverage and respondent communications in the original Workspace.

All state is additive inside questionnaires.sqlite3. Original invitation rows,
answers, revisions, reviews, scoped browser sessions and project receiving stay
with questionnaire_workspace.Workspace.
"""
from __future__ import annotations
import base64
import copy
import hashlib
import io
import json
import re
import secrets
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape

from questionnaire_workspace import OperationError, encoded, now, identifier
from respondent_source import SourceError, decode_input, map_source, digest
from respondent_domain import (build_coverage, normalized_contact, validate_template,
    render_message, followup_queue, delivery_projection, table_csv, utc, DEFAULT_TEMPLATES)

ENTITY_KINDS = {"company","contact","template","coverage","public_link","profile"}
MAX_PAGE = 500

def problem(code,message,detail=None):
    raise OperationError(code,message,detail)

def text(value,field,required=True,limit=10000):
    if not isinstance(value,str) or len(value)>limit or "\x00" in value or required and not value.strip():
        problem("OUTREACH_FIELD","Provide a valid "+field)
    return value.strip()

def iso(value,field):
    return utc(value,field).isoformat()

def positive_version(value):
    return type(value) is int and value>=0

class RespondentOperations:
    def __init__(self,workspace):
        self.workspace=workspace
        with workspace.connection() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS outreach_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outreach_entities(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS outreach_sources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,sha TEXT NOT NULL,mapping_sha TEXT NOT NULL,report TEXT NOT NULL,bytes BLOB NOT NULL,supersedes_id TEXT REFERENCES outreach_sources(id),created TEXT NOT NULL,UNIQUE(kind,sha,mapping_sha));
            CREATE TABLE IF NOT EXISTS outreach_source_links(source_id TEXT NOT NULL REFERENCES outreach_sources(id),row_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(source_id,row_id,kind));
            CREATE TABLE IF NOT EXISTS outreach_assignments(id TEXT PRIMARY KEY,respondent_id TEXT NOT NULL UNIQUE REFERENCES respondents(id),company_id TEXT NOT NULL,contact_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,access_code TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outreach_messages(id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES outreach_assignments(id),version INTEGER NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outreach_delivery_events(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES outreach_messages(id),provider TEXT NOT NULL,provider_event_id TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(provider,provider_event_id));
            CREATE TABLE IF NOT EXISTS outreach_requests(id TEXT PRIMARY KEY,intent_sha TEXT NOT NULL,method TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outreach_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,identity TEXT NOT NULL,version INTEGER NOT NULL,before_value TEXT,after_value TEXT,actor TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS outreach_assignment_company ON outreach_assignments(company_id);
            CREATE INDEX IF NOT EXISTS outreach_message_assignment ON outreach_messages(assignment_id);
            """)
            db.execute("INSERT OR IGNORE INTO outreach_meta VALUES('revision','0')")
            db.commit()

    def invoke(self,method,params=None):
        function=getattr(self,"op_"+method,None)
        if not callable(function):
            problem("OUTREACH_METHOD","Unknown respondent-operations method")
        try:
            return function(params or {})
        except SourceError as error:
            problem(error.code,str(error),error.details)

    def _revision(self,db):
        return int(db.execute("SELECT value FROM outreach_meta WHERE key='revision'").fetchone()[0])

    def _entity(self,db,kind,key,optional=False):
        if kind not in ENTITY_KINDS:
            problem("OUTREACH_KIND","Unknown respondent record type")
        row=db.execute("SELECT * FROM outreach_entities WHERE kind=? AND id=?",(kind,key)).fetchone()
        if row is None:
            if optional:return None
            problem("NOT_FOUND","The original "+kind+" record was not found")
        return {**json.loads(row["data"]),"id":row["id"],"version":row["version"],"created":row["created"],"updated":row["updated"]}

    def _entities(self,db,kind):
        return [self._entity(db,kind,row[0]) for row in db.execute("SELECT id FROM outreach_entities WHERE kind=? ORDER BY created,id",(kind,))]

    def _history(self,db,kind,key,version,before,after,actor,reason):
        db.execute("INSERT INTO outreach_history(kind,identity,version,before_value,after_value,actor,reason,created) VALUES(?,?,?,?,?,?,?,?)",
                   (kind,key,version,None if before is None else encoded(before),None if after is None else encoded(after),actor,reason,now()))

    def _put(self,db,kind,key,value,expected_version,actor,reason):
        before=self._entity(db,kind,key,True)
        current=0 if before is None else before["version"]
        if expected_version!=current:
            problem("VERSION_CONFLICT","Reopen the current "+kind+" edition",{"current_version":current,"id":key})
        clean={k:v for k,v in value.items() if k not in ("id","version","created","updated")}
        stamp=now()
        version=current+1
        db.execute("INSERT INTO outreach_entities VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET version=excluded.version,data=excluded.data,updated=excluded.updated",
                   (kind,key,version,encoded(clean),stamp if before is None else before["created"],stamp))
        after=self._entity(db,kind,key)
        self._history(db,kind,key,version,before,after,actor,reason)
        return after

    def _mutate(self,method,p,action,internal=False):
        request_id=text(p.get("request_id"),"original request ID",limit=180)
        actor=text(p.get("actor"),"operator name",limit=180)
        reason=text(p.get("reason"),"reason for this operation")
        intent={key:value for key,value in p.items() if key not in ("expected_revision",)}
        intent_sha=digest({"method":method,"params":intent})
        def write(db):
            previous=db.execute("SELECT * FROM outreach_requests WHERE id=?",(request_id,)).fetchone()
            if previous:
                if previous["intent_sha"]!=intent_sha or previous["method"]!=method:
                    problem("REQUEST_REUSE","This original request ID already describes different work")
                saved=json.loads(previous["result"])
                return {**saved,"operation":{**saved["operation"],"replayed":True}}
            current=self._revision(db)
            if not internal and p.get("expected_revision")!=current:
                problem("VERSION_CONFLICT","The respondent operations changed; review the current edition",{"current_revision":current})
            output=action(db,actor,reason)
            version=current+1
            db.execute("UPDATE outreach_meta SET value=? WHERE key='revision'",(str(version),))
            result={"revision":version,"workspace_id":db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0],
                    "operation":{"id":request_id,"method":method,"actor":actor,"reason":reason,"intent_sha256":intent_sha,"replayed":False},
                    **output}
            db.execute("INSERT INTO outreach_requests VALUES(?,?,?,?,?)",(request_id,intent_sha,method,encoded(result),now()))
            return result
        return self.workspace._write("outreach."+method,request_id,{"actor":actor,"reason":reason,"intent_sha256":intent_sha},write)

    def _source(self,db,key,include_bytes=False):
        row=db.execute("SELECT * FROM outreach_sources WHERE id=?",(key,)).fetchone()
        if not row:problem("NOT_FOUND","The original respondent source is absent")
        result={"id":row["id"],"kind":row["kind"],"name":row["name"],"sha256":row["sha"],
                "mapping_sha256":row["mapping_sha"],"supersedes_id":row["supersedes_id"],"created":row["created"],
                "report":json.loads(row["report"])}
        if include_bytes:result["bytes"]=row["bytes"]
        return result

    def _profile(self,db):
        return self._entity(db,"profile","workspace",True)

    def _assignment(self,db,key,private=False):
        row=db.execute("SELECT * FROM outreach_assignments WHERE id=?",(key,)).fetchone()
        if not row:problem("NOT_FOUND","The original respondent assignment is absent")
        result={**json.loads(row["data"]),"id":row["id"],"respondent_id":row["respondent_id"],
                "company_id":row["company_id"],"contact_id":row["contact_id"],"version":row["version"],
                "created":row["created"],"updated":row["updated"]}
        respondent=self.workspace._row(db,"respondents",row["respondent_id"])
        result["respondent"]={k:v for k,v in respondent.items() if k!="key_hash"}
        result["contact"]=self._entity(db,"contact",row["contact_id"])
        result["company"]=self._entity(db,"company",row["company_id"])
        result["email"]=result["contact"].get("email","")
        result["language"]=result["contact"]["language"]
        result["active"]=result.get("active",True) and result["contact"].get("active",True)
        revision=db.execute("SELECT id,number,created FROM revisions WHERE respondent_id=? ORDER BY number DESC LIMIT 1",(row["respondent_id"],)).fetchone()
        result["latest_response"]=dict(revision) if revision else None
        review=db.execute("SELECT v.id AS revision_id,w.id,w.decision,w.note,w.created FROM reviews w JOIN revisions v ON v.id=w.revision_id WHERE v.respondent_id=? ORDER BY w.created DESC,w.rowid DESC LIMIT 1",(row["respondent_id"],)).fetchone()
        result["revision_request"]={"id":review["id"],"revision_id":review["revision_id"],"at":review["created"],"note":review["note"]} if review and review["decision"]=="changes_requested" and respondent["status"]=="changes_requested" else None
        if private:result["access_code"]=row["access_code"]
        return result

    def _assignments(self,db):
        return [self._assignment(db,r[0]) for r in db.execute("SELECT id FROM outreach_assignments ORDER BY created,id")]

    def _message(self,db,key):
        row=db.execute("SELECT * FROM outreach_messages WHERE id=?",(key,)).fetchone()
        if not row:problem("NOT_FOUND","The original communication is absent")
        value={**json.loads(row["data"]),"id":row["id"],"assignment_id":row["assignment_id"],
               "version":row["version"],"created":row["created"],"updated":row["updated"]}
        value["events"]=[{**json.loads(r["data"]),"id":r["id"],"provider":r["provider"],"provider_event_id":r["provider_event_id"],
                           "kind":r["kind"],"at":r["at"],"sequence":r["rowid"]}
            for r in db.execute("SELECT rowid,* FROM outreach_delivery_events WHERE message_id=? ORDER BY at,rowid",(key,))]
        value["delivery"]=delivery_projection(value["events"])
        return value

    def _messages(self,db):
        return [self._message(db,r[0]) for r in db.execute("SELECT id FROM outreach_messages ORDER BY created,id")]

    def op_status(self,p):
        with self.workspace.connection() as db:
            source_rows=[dict(r) for r in db.execute("SELECT id,kind,name,sha AS sha256,mapping_sha AS mapping_sha256,supersedes_id,created FROM outreach_sources ORDER BY created,id")]
            superseded={r["supersedes_id"] for r in source_rows if r["supersedes_id"]}
            for row in source_rows:row["current"]=row["id"] not in superseded
            assignments=self._assignments(db)
            messages=self._messages(db)
            return {"schema":"commons.atssc.respondent-operations.v1","workspace_id":db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0],
                    "revision":self._revision(db),"profile":self._profile(db),"sources":source_rows,
                    "companies":self._entities(db,"company"),"contacts":self._entities(db,"contact"),
                    "templates":self._entities(db,"template"),"coverage":self._entities(db,"coverage"),
                    "public_links":[{k:v for k,v in x.items() if k not in ("token","token_hash")} for x in self._entities(db,"public_link")],
                    "assignments":assignments,
                    "messages":[{k:v for k,v in x.items() if k not in ("rendered","wire_base64","claim_token")} for x in messages],
                    "history_count":db.execute("SELECT COUNT(*) FROM outreach_history").fetchone()[0]}

    def op_operation(self,p):
        with self.workspace.connection() as db:
            row=db.execute("SELECT result FROM outreach_requests WHERE id=?",(p.get("request_id"),)).fetchone()
            if not row:problem("NOT_FOUND","This original operation has not committed")
            result=json.loads(row[0])
            result["operation"]["replayed"]=True
            return result

    def op_history(self,p):
        with self.workspace.connection() as db:
            clauses,args=[],[]
            for field,column in (("kind","kind"),("id","identity")):
                if p.get(field):clauses.append(column+"=?");args.append(p[field])
            where=(" WHERE "+" AND ".join(clauses)) if clauses else ""
            count=db.execute("SELECT COUNT(*) FROM outreach_history"+where,args).fetchone()[0]
            offset=max(0,int(p.get("offset",0)));limit=min(MAX_PAGE,max(1,int(p.get("limit",100))))
            rows=[]
            for row in db.execute("SELECT * FROM outreach_history"+where+" ORDER BY sequence LIMIT ? OFFSET ?",[*args,limit,offset]):
                rows.append({**dict(row),"before_value":None if row["before_value"] is None else json.loads(row["before_value"]),
                             "after_value":None if row["after_value"] is None else json.loads(row["after_value"])})
            return {"items":rows,"total":count,"offset":offset,"limit":limit,"revision":self._revision(db)}

    def op_save_profile(self,p):
        value=p.get("profile",{})
        clean={key:text(value.get(key),key,limit=1000) for key in
               ("case_reference","case_title","organization_name","support_contact")}
        clean["notice_at"]=iso(value.get("notice_at"),"notice date")
        clean["due_at"]=iso(value.get("due_at"),"response deadline")
        if utc(clean["due_at"])<=utc(clean["notice_at"]):problem("DEADLINE","Response deadline must follow the notice")
        base=text(value.get("application_url"),"application URL",limit=2000).rstrip("/")
        parsed=urlparse(base)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("","/") or parsed.scheme not in ("http","https"):
            problem("APPLICATION_URL","Use the original application's origin without a path or private query")
        if parsed.scheme=="http" and parsed.hostname not in ("127.0.0.1","localhost","::1"):
            problem("APPLICATION_URL","The deployed application requires HTTPS")
        clean["application_url"]=base
        clean["sender_email"]=text(value.get("sender_email",""),"sender email",False,320)
        clean["staff_email"]=text(value.get("staff_email",""),"staff email",False,320)
        for key in ("sender_email","staff_email"):
            if clean[key] and not re.fullmatch(r"[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+",clean[key]):
                problem("EMAIL","Use a complete "+key)
        clean["automatic_notifications"]=value.get("automatic_notifications",False)
        if type(clean["automatic_notifications"]) is not bool:problem("AUTOMATIC_NOTIFICATIONS","Choose whether original response events should prepare confirmations")
        clean["followup_settings"]=value.get("followup_settings",{"before_due_days":2,"initial_followup_hours":24,"after_due":False})
        followup_queue([],[],now(),clean["followup_settings"])
        return self._mutate("save_profile",p,lambda db,a,r:{"profile":self._put(db,"profile","workspace",clean,p.get("expected_version",0),a,r)})

    def op_preview_source(self,p):
        original,report=decode_input(p.get("source",{}))
        if report["requires_sheet"]:
            return {"source":report,"mapping":None}
        mapped=None
        if p.get("mapping"):
            mapped=map_source(report,p.get("kind"),p["mapping"],p.get("settings"))
        return {"source":report,"mapping":mapped}

    def op_receive_source(self,p):
        preview=self.op_preview_source(p)
        mapped=preview["mapping"]
        if mapped is None or mapped["review_sha256"]!=p.get("review_sha256"):
            problem("SOURCE_REVIEW","Review the complete current source interpretation before retaining it")
        original=base64.b64decode(p["source"]["content_base64"],validate=True)
        def action(db,actor,reason):
            before_id=p.get("supersedes_id")
            if before_id:
                before=self._source(db,before_id)
                if before["kind"]!=mapped["kind"]:
                    problem("SOURCE_CORRECTION","An original correction must preserve the source kind")
                successor=db.execute("SELECT id FROM outreach_sources WHERE supersedes_id=?",(before_id,)).fetchone()
                if successor:problem("SOURCE_CORRECTION","Use the current successor source edition",{"successor_id":successor[0]})
            existing=db.execute("SELECT id FROM outreach_sources WHERE kind=? AND sha=? AND mapping_sha=?",(mapped["kind"],mapped["source_file"]["sha256"],mapped["review_sha256"])).fetchone()
            if existing:return {"source_id":existing[0],"existing":True}
            key=identifier()
            full={"parsed":preview["source"],"mapped":mapped}
            db.execute("INSERT INTO outreach_sources VALUES(?,?,?,?,?,?,?,?,?)",
                       (key,mapped["kind"],mapped["source_file"]["name"],mapped["source_file"]["sha256"],
                        mapped["review_sha256"],encoded(full),original,before_id,now()))
            self._history(db,"source",key,1,None,{"source_id":key,"file":mapped["source_file"],
                  "mapping":mapped["mapping"],"settings":mapped["settings"],"supersedes_id":before_id},actor,reason)
            return {"source_id":key,"counts":mapped["counts"],"supersedes_id":before_id}
        return self._mutate("receive_source",p,action)

    def op_get_source(self,p):
        with self.workspace.connection() as db:
            source=self._source(db,p.get("source_id"))
            source["contact_links"]=[{"row_id":row["row_id"],"contact_id":row["entity_id"]} for row in db.execute("SELECT row_id,entity_id FROM outreach_source_links WHERE source_id=? AND kind='contact'",(source["id"],))]
            if p.get("complete"):return source
            rows=source["report"]["mapped"]["rows"]
            offset=max(0,int(p.get("offset",0)));limit=min(MAX_PAGE,max(1,int(p.get("limit",100))))
            return {**{k:v for k,v in source.items() if k!="report"},
                    "parsed":{k:v for k,v in source["report"]["parsed"].items() if k!="rows"},
                    "mapped":{k:v for k,v in source["report"]["mapped"].items() if k!="rows"},
                    "rows":rows[offset:offset+limit],"total":len(rows),"offset":offset,"limit":limit}

    def op_preview_coverage(self,p):
        with self.workspace.connection() as db:
            source=self._source(db,p.get("source_id"))
        return build_coverage(source["report"]["mapped"],p.get("policy"))

    def op_save_coverage(self,p):
        def action(db,actor,reason):
            source=self._source(db,p.get("source_id"))
            report=build_coverage(source["report"]["mapped"],p.get("policy"))
            if report["review_sha256"]!=p.get("review_sha256"):
                problem("COVERAGE_REVIEW","Review the exact original coverage and selected companies")
            if not report["ready"]:problem("COVERAGE_REVIEW","Resolve the original coverage problems",report["problems"])
            key=p.get("id") or identifier()
            entry=self._put(db,"coverage",key,{"name":text(p.get("name"),"coverage name"),"source_id":source["id"],"report":report},p.get("expected_version",0),actor,reason)
            companies=[]
            for item in report["selected_companies"]:
                current=self._entity(db,"company",item["company_id"],True)
                if current is None:
                    company={"name":item["names"][0] if item["names"] else item["company_id"],
                             "aliases":item["names"],"active":True,"sources":[{"coverage_id":key,"source_id":source["id"],"selection":item}],
                             "note":(item.get("additional") or {}).get("reason","")}
                    companies.append(self._put(db,"company",item["company_id"],company,0,actor,reason))
                else:
                    companies.append(current)
            return {"coverage":entry,"companies":companies}
        return self._mutate("save_coverage",p,action)

    def op_save_company(self,p):
        value=p.get("company",{})
        key=text(value.get("id"),"company identifier",limit=160)
        clean={"name":text(value.get("name"),"company name",limit=1000),
               "aliases":value.get("aliases",[]),"active":value.get("active",True),
               "sources":value.get("sources",[]),"note":text(value.get("note",""),"company note",False)}
        if not isinstance(clean["aliases"],list) or any(not isinstance(v,str) for v in clean["aliases"]) or type(clean["active"]) is not bool or not clean["sources"]:
            problem("COMPANY","Retain the original company sources, aliases and active state")
        return self._mutate("save_company",p,lambda db,a,r:{"company":self._put(db,"company",key,clean,p.get("expected_version",0),a,r)})

    def op_save_contact(self,p):
        value=normalized_contact(p.get("contact",{}))
        key=p.get("id") or identifier()
        def action(db,actor,reason):
            company=self._entity(db,"company",value["company_id"])
            if not company.get("active",True):problem("COMPANY_INACTIVE","Choose an active original company")
            existing=self._entity(db,"contact",key,True)
            if existing and existing["company_id"]!=value["company_id"]:
                assignments=db.execute("SELECT 1 FROM outreach_assignments WHERE contact_id=? LIMIT 1",(key,)).fetchone()
                if assignments:problem("CONTACT_COMPANY","A contact attached to an original respondent cannot change company")
            return {"contact":self._put(db,"contact",key,value,p.get("expected_version",0),actor,reason)}
        return self._mutate("save_contact",p,action)

    def op_receive_contacts(self,p):
        def action(db,actor,reason):
            source=self._source(db,p.get("source_id"))
            mapped=source["report"]["mapped"]
            if mapped["kind"]!="CONTACTS":problem("CONTACT_SOURCE","Select a contact source")
            choices=p.get("rows")
            if not isinstance(choices,list) or len(choices)!=len(mapped["rows"]) or len({x.get("row_id") for x in choices})!=len(choices):
                problem("CONTACT_REVIEW","Provide one reviewed disposition for every original contact row")
            original={row["id"]:row for row in mapped["rows"]}
            if set(original)!={x.get("row_id") for x in choices}:
                problem("CONTACT_REVIEW","The contact decisions differ from the original source rows")
            results=[]
            for choice in choices:
                row=original[choice["row_id"]]
                selected=choice.get("action")
                existing_link=db.execute("SELECT entity_id FROM outreach_source_links WHERE source_id=? AND row_id=? AND kind='contact'",(source["id"],row["id"])).fetchone()
                if selected=="SKIP":
                    if not str(choice.get("reason","")).strip():problem("CONTACT_REVIEW","Every skipped original row needs a reason")
                    results.append({"source_row_id":row["id"],"action":"SKIP","reason":choice["reason"]})
                    continue
                if selected=="KEEP_EXISTING":
                    if not existing_link:problem("CONTACT_REVIEW","This source row has no already-retained contact")
                    results.append({"source_row_id":row["id"],"action":"KEEP_EXISTING","contact_id":existing_link[0]})
                    continue
                if selected not in ("CREATE","UPDATE") or not row["valid"]:
                    problem("CONTACT_REVIEW","Correct the source mapping before receiving this contact",{"row_id":row["id"],"issues":row["errors"]})
                company=self._entity(db,"company",row["company_id"],True)
                if company is None:
                    company=self._put(db,"company",row["company_id"],{"name":row["company_name"],"aliases":[],
                         "active":True,"sources":[row["source"]],"note":""},0,actor,reason)
                elif company["name"]!=row["company_name"]:
                    naming=choice.get("company_name_policy")
                    if naming not in ("KEEP_CURRENT","REPLACE"):
                        problem("COMPANY_NAME_REVIEW","Review the differing original company name",{"company_id":company["id"],"current":company["name"],"source":row["company_name"]})
                    changed=copy.deepcopy(company)
                    changed["aliases"]=sorted(set(changed.get("aliases",[]))|{company["name"],row["company_name"]})
                    changed["sources"]=[*changed.get("sources",[]),row["source"]]
                    if naming=="REPLACE":changed["name"]=row["company_name"]
                    company=self._put(db,"company",company["id"],changed,company["version"],actor,reason)
                if selected=="CREATE":
                    if existing_link:problem("CONTACT_ALREADY_RETAINED","Use the original retained contact or an explicit update",{"contact_id":existing_link[0]})
                    key=identifier()
                    expected=0
                else:
                    key=text(choice.get("contact_id"),"existing contact ID",limit=160)
                    current=self._entity(db,"contact",key)
                    if current["company_id"]!=row["company_id"]:
                        problem("CONTACT_COMPANY","Review an existing contact belonging to this original company")
                    if existing_link and existing_link[0]!=key:
                        problem("CONTACT_SOURCE_LINK","An original contact-source row is already bound to another record")
                    expected=choice.get("expected_version")
                value={k:row.get(k,"") for k in ("company_id","company_name","contact_name","email","phone","postal_address","country","role","language")}
                value.update({"kind":choice.get("kind","PERSON"),"custom":row["custom"],"source":row["source"],"note":choice.get("note",""),"active":True})
                contact=self._put(db,"contact",key,normalized_contact(value),expected,actor,reason)
                db.execute("INSERT OR IGNORE INTO outreach_source_links VALUES(?,?,?,?,?)",(source["id"],row["id"],"contact",key,now()))
                results.append({"source_row_id":row["id"],"action":selected,"contact":contact})
            self._history(db,"contact_source",source["id"],1,None,{"results":results},actor,reason)
            return {"source_id":source["id"],"results":results}
        return self._mutate("receive_contacts",p,action)

    def _create_assignment(self,db,company,contact,publication_id,profile,actor,reason,options=None):
        options=options or {}
        self.workspace._row(db,"publications",publication_id)
        if contact["company_id"]!=company["id"]:
            problem("ASSIGNMENT_COMPANY","The selected contact belongs to a different original company")
        if not company.get("active",True) or not contact.get("active",True):
            problem("ASSIGNMENT_INACTIVE","Choose active company and contact records")
        for existing in self._assignments(db):
            if existing["company_id"]==company["id"] and existing["respondent"]["publication_id"]==publication_id:
                problem("ASSIGNMENT_EXISTS","Use the company's original respondent assignment for this published questionnaire",
                        {"assignment_id":existing["id"],"respondent_id":existing["respondent_id"]})
        key=identifier()
        native_id=options.get("respondent_id")
        if native_id:
            native=self.workspace._row(db,"respondents",native_id)
            if native["publication_id"]!=publication_id:
                problem("ASSIGNMENT_PUBLICATION","The original respondent belongs to a different questionnaire publication")
            access=options.get("access_code")
            if not access:
                path=self.workspace.directory/("respondent-"+native_id+".json")
                if path.is_file():
                    access=json.loads(path.read_text())["access_code"]
            if not isinstance(access,str) or not secrets.compare_digest(native["key_hash"],hashlib.sha256(access.encode()).hexdigest()):
                problem("ASSIGNMENT_ACCESS","Use the original private access code when adopting an existing respondent")
            native_result={"respondent_id":native_id,"publication_id":publication_id,"entry_path":"/respondent/"+native_id}
        else:
            native_id,access=identifier(),secrets.token_urlsafe(30)
            native_result=self.workspace._invite_record(db,{"publication_id":publication_id,"name":company["name"]},native_id,access)
        due_at=iso(options.get("due_at",profile["due_at"]),"assignment response deadline")
        notice_at=iso(options.get("notice_at",profile["notice_at"]),"assignment notice")
        if utc(due_at)<=utc(notice_at):problem("DEADLINE","The assignment deadline must follow its notice")
        value={"publication_id":publication_id,"entry_path":native_result["entry_path"],
               "notice_at":notice_at,"due_at":due_at,"language":contact["language"],"active":True,"paused":False,
               "coverage_id":options.get("coverage_id"),"note":options.get("note",""),
               "public_link_id":options.get("public_link_id"),"registration_state":options.get("registration_state","REVIEWED_COMPANY")}
        stamp=now()
        db.execute("INSERT INTO outreach_assignments VALUES(?,?,?,?,?,?,?,?,?)",
                   (key,native_id,company["id"],contact["id"],1,encoded(value),access,stamp,stamp))
        after=self._assignment(db,key)
        self._history(db,"assignment",key,1,None,after,actor,reason)
        return after

    def op_assign(self,p):
        choices=p.get("assignments")
        if not isinstance(choices,list) or not choices:
            problem("ASSIGNMENTS","Select the complete company/contact assignments")
        def action(db,actor,reason):
            profile=self._profile(db)
            if not profile:problem("PROFILE","Save the original case and deadline first")
            results=[]
            for choice in choices:
                company=self._entity(db,"company",choice.get("company_id"))
                contact=self._entity(db,"contact",choice.get("contact_id"))
                if choice.get("coverage_id"):
                    coverage=self._entity(db,"coverage",choice["coverage_id"])
                    if company["id"] not in {c["company_id"] for c in coverage["report"]["selected_companies"]}:
                        problem("COVERAGE_COMPANY","The original coverage does not select this company")
                results.append(self._create_assignment(db,company,contact,choice.get("publication_id"),profile,actor,reason,choice))
            return {"assignments":results}
        return self._mutate("assign",p,action)

    def op_update_assignment(self,p):
        def action(db,actor,reason):
            before=self._assignment(db,p.get("id"))
            if before["version"]!=p.get("expected_version"):
                problem("VERSION_CONFLICT","Review the current respondent assignment",{"current_version":before["version"]})
            value=json.loads(db.execute("SELECT data FROM outreach_assignments WHERE id=?",(before["id"],)).fetchone()[0])
            changes=p.get("assignment",{})
            contact_id=changes.get("contact_id",before["contact_id"])
            contact=self._entity(db,"contact",contact_id)
            if contact["company_id"]!=before["company_id"]:
                problem("ASSIGNMENT_COMPANY","The replacement contact must belong to the original company")
            for field in ("active","paused"):
                if field in changes:
                    if type(changes[field]) is not bool:problem("ASSIGNMENT_STATE","Choose true or false for "+field)
                    value[field]=changes[field]
            for field in ("notice_at","due_at"):
                if field in changes:value[field]=iso(changes[field],field)
            if utc(value["due_at"])<=utc(value["notice_at"]):problem("DEADLINE","The deadline must follow the notice")
            if "note" in changes:value["note"]=text(changes["note"],"assignment note",False)
            if "registration_state" in changes:
                if changes["registration_state"] not in ("REVIEWED_COMPANY","NEW_COMPANY_CONTACT_REVIEW"):
                    problem("REGISTRATION_STATE","Choose the actual original company review state")
                value["registration_state"]=changes["registration_state"]
            value["language"]=contact["language"]
            version=before["version"]+1
            db.execute("UPDATE outreach_assignments SET contact_id=?,version=?,data=?,updated=? WHERE id=?",
                       (contact_id,version,encoded(value),now(),before["id"]))
            after=self._assignment(db,before["id"])
            self._history(db,"assignment",before["id"],version,before,after,actor,reason)
            return {"assignment":after}
        return self._mutate("update_assignment",p,action)

    def op_get_assignment(self,p):
        with self.workspace.connection() as db:
            result=self._assignment(db,p.get("id"),private=True)
            messages=[self._message(db,row[0]) for row in db.execute("SELECT id FROM outreach_messages WHERE assignment_id=? ORDER BY created,id",(result["id"],))]
            return {"assignment":result,"messages":messages,"revision":self._revision(db),
                    "original_response":self.workspace.op_get_respondent({"respondent_id":result["respondent_id"]})}

    def op_save_template(self,p):
        value=validate_template(p.get("template",{}))
        key=p.get("id") or identifier()
        return self._mutate("save_template",p,lambda db,a,r:{"template":self._put(db,"template",key,value,p.get("expected_version",0),a,r)})

    def op_install_templates(self,p):
        def action(db,actor,reason):
            results=[]
            for template in DEFAULT_TEMPLATES:
                key="standard-"+template["kind"].lower()+"-"+template["language"].lower()
                existing=self._entity(db,"template",key,True)
                if existing:
                    results.append(existing)
                else:
                    results.append(self._put(db,"template",key,validate_template(template),0,actor,reason))
            return {"templates":results}
        return self._mutate("install_templates",p,action)

    def _preview_message(self,db,p):
        assignment=self._assignment(db,p.get("assignment_id"),private=True)
        profile=self._profile(db)
        if not profile:problem("PROFILE","Save the original case and email settings first")
        template=self._entity(db,"template",p.get("template_id"))
        if template["language"]!=assignment["language"]:
            problem("MESSAGE_LANGUAGE","Choose the original contact's selected language")
        if not assignment["active"] or assignment.get("paused"):
            problem("ASSIGNMENT_INACTIVE","Activate this original assignment before communicating")
        _,definition=self.workspace._definition(db,assignment["respondent"]["publication_id"])
        kind=template["kind"]
        if kind=="REMINDER" and assignment["respondent"]["status"] in ("received","accepted","submitted","withdrawn"):
            problem("RESPONSE_RECEIVED","This original assignment already has a received response")
        if kind=="INVITATION" and assignment["respondent"]["status"]!="invited":
            problem("RESPONSE_RECEIVED","Use the existing respondent communication history for this active response")
        latest=assignment["latest_response"]
        requested_revision=p.get("response_revision_id")
        if requested_revision:
            original_revision=self.workspace._row(db,"revisions",requested_revision)
            if original_revision["respondent_id"]!=assignment["respondent_id"]:
                problem("RESPONSE_SCOPE","The confirmation must name this original respondent's revision")
            latest={"id":original_revision["id"],"number":original_revision["number"],"created":original_revision["created"]}
        revision_request=assignment["revision_request"]
        if kind in ("SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION") and not latest:
            problem("RESPONSE_REQUIRED","A confirmation must refer to an actual original received revision")
        if kind=="REVISION_REQUEST" and not revision_request:
            problem("REVISION_REQUEST_REQUIRED","Record the correction request on the original revision first")
        recipient=profile.get("staff_email") if kind=="STAFF_NOTIFICATION" else assignment["contact"].get("email")
        if not recipient:problem("MESSAGE_RECIPIENT","The original contact or staff notification address is missing")
        context={"case_reference":profile["case_reference"],"case_title":profile["case_title"],
                 "organization_name":profile["organization_name"],"support_contact":profile["support_contact"],
                 "company_name":assignment["company"]["name"],"contact_name":assignment["contact"].get("contact_name") or assignment["company"]["name"],
                 "questionnaire_title":definition.get("title") or "Questionnaire",
                 "questionnaire_url":profile["application_url"]+assignment["entry_path"],"access_code":assignment["access_code"],
                 "due_date":assignment["due_at"],"revision_reason":"" if revision_request is None else revision_request["note"],
                 "submission_reference":"" if latest is None else latest["id"],"respondent_id":assignment["respondent_id"],
                 "sent_date":iso(p.get("at",now()),"message context time")}
        rendered=render_message(template,context)
        followup=None
        if kind=="REMINDER":
            queue=followup_queue([assignment],self._messages(db),p.get("at",now()),profile.get("followup_settings"))
            choices=[item for item in queue["items"] if item["key"]==p.get("followup_key")]
            if len(choices)!=1 or not choices[0]["eligible"]:
                problem("FOLLOWUP_REVIEW","Use one currently due original follow-up",queue["items"])
            followup=choices[0]
        trigger_id=latest["id"] if kind in ("SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION") else revision_request["id"] if kind=="REVISION_REQUEST" else None
        for row in db.execute("SELECT id FROM outreach_messages WHERE assignment_id=? ORDER BY created,id",(assignment["id"],)):
            existing=self._message(db,row[0])
            if existing.get("kind")!=kind:
                continue
            same_trigger=trigger_id and existing.get("trigger_id")==trigger_id
            same_invitation=kind=="INVITATION" and existing.get("assignment_version")==assignment["version"]
            if (same_trigger or same_invitation) and existing["delivery"]["state"] not in ("REJECTED","BOUNCED","CANCELLED"):
                problem("MESSAGE_ALREADY_RETAINED","The original communication is already retained; recover its outcome",{"message_id":existing["id"]})
        result={"schema":"commons.atssc.message-review.v1","assignment_id":assignment["id"],"assignment_version":assignment["version"],
                "contact_id":assignment["contact_id"],"contact_version":assignment["contact"]["version"],
                "profile_version":profile["version"],"respondent_id":assignment["respondent_id"],
                "respondent_version":assignment["respondent"]["version"],"respondent_status":assignment["respondent"]["status"],
                "kind":kind,"recipient":recipient,"sender":profile.get("sender_email",""),"reply_to":profile["support_contact"],
                "rendered":rendered,"trigger_id":trigger_id,"followup_key":None if followup is None else followup["key"],
                "followup":followup,"at":context["sent_date"]}
        result["review_sha256"]=digest(result)
        return result

    def op_preview_message(self,p):
        with self.workspace.connection() as db:return self._preview_message(db,p)

    def _event(self,db,message_id,provider,provider_event_id,kind,at,data):
        if kind not in ("QUEUED","SENDING","ACCEPTED","DELIVERED","BOUNCED","REJECTED","DEFERRED","UNKNOWN","CANCELLED"):
            problem("DELIVERY_EVENT","Unsupported original delivery state")
        provider=text(provider,"provider identity",limit=200)
        provider_event_id=text(provider_event_id,"provider event identity",limit=300)
        original={**data,"message_id":message_id}
        existing=db.execute("SELECT * FROM outreach_delivery_events WHERE provider=? AND provider_event_id=?",(provider,provider_event_id)).fetchone()
        if existing:
            if existing["message_id"]!=message_id or existing["kind"]!=kind or existing["at"]!=at or json.loads(existing["data"])!=original:
                problem("DELIVERY_ID_CONFLICT","The same provider event identity has different original data")
            return {"event_id":existing["id"],"existing":True}
        key=identifier()
        db.execute("INSERT INTO outreach_delivery_events VALUES(?,?,?,?,?,?,?,?)",(key,message_id,provider,provider_event_id,kind,at,encoded(original),now()))
        return {"event_id":key,"existing":False}

    def op_retain_message(self,p):
        def action(db,actor,reason):
            review=self._preview_message(db,p)
            if review["review_sha256"]!=p.get("review_sha256"):
                problem("MESSAGE_REVIEW","Review the exact current recipient, body and original response state")
            return {"message":self._queue_review(db,review,actor,reason)}
        return self._mutate("retain_message",p,action)


    def _queue_review(self,db,review,actor,reason):
        key=identifier()
        value={**review,"id":key,"actor":actor,"reason":reason,"claim_token":None}
        db.execute("INSERT INTO outreach_messages VALUES(?,?,1,?,?,?)",(key,review["assignment_id"],encoded(value),now(),now()))
        self._event(db,key,"workspace","queued:"+key,"QUEUED",now(),{"actor":actor,"review_sha256":review["review_sha256"]})
        self._history(db,"message",key,1,None,{k:v for k,v in value.items() if k!="claim_token"},actor,reason)
        return self._message(db,key)

    def op_sync_notifications(self,p):
        """Prepare each original received-revision/review notice once.

        The native revision remains the authority. Queuing and any subsequent
        SMTP submission are distinct retained operations.
        """
        def action(db,actor,reason):
            profile=self._profile(db)
            if not profile:problem("PROFILE","Save the original case and notification settings")
            if p.get("automatic") and not profile.get("automatic_notifications"):
                return {"messages":[],"skipped":[],"automatic_enabled":False}
            chosen=p.get("kinds",["SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION","REVISION_REQUEST"])
            if not isinstance(chosen,list) or set(chosen)-{"SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION","REVISION_REQUEST"}:
                problem("NOTIFICATION_KIND","Select original response confirmation, staff notice or revision request")
            at=iso(p.get("at",now()),"notification context time")
            templates=self._entities(db,"template")
            messages=[];skipped=[]
            for assignment in self._assignments(db):
                if p.get("respondent_id") and assignment["respondent_id"]!=p["respondent_id"]:
                    continue
                if not assignment["active"] or assignment.get("paused"):
                    continue
                existing=[self._message(db,row[0]) for row in db.execute("SELECT id FROM outreach_messages WHERE assignment_id=?",(assignment["id"],))]
                known={(m["kind"],m.get("trigger_id")) for m in existing}
                revisions=[dict(row) for row in db.execute("SELECT id,number,created FROM revisions WHERE respondent_id=? ORDER BY number",(assignment["respondent_id"],))]
                desired=[]
                for revision in revisions:
                    desired.extend((kind,revision["id"],revision["id"]) for kind in chosen if kind in ("SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION"))
                if "REVISION_REQUEST" in chosen and assignment["revision_request"]:
                    desired.append(("REVISION_REQUEST",assignment["revision_request"]["id"],None))
                for kind,trigger,revision_id in desired:
                    if (kind,trigger) in known:
                        continue
                    template=next((t for t in templates if t["kind"]==kind and t["language"]==assignment["language"] and t["id"]=="standard-"+kind.lower()+"-"+assignment["language"].lower()),None)
                    if template is None:
                        candidates=[t for t in templates if t["kind"]==kind and t["language"]==assignment["language"]]
                        template=candidates[0] if len(candidates)==1 else None
                    if template is None:
                        skipped.append({"assignment_id":assignment["id"],"kind":kind,"trigger_id":trigger,"reason":"Choose one matching original-language template"})
                        continue
                    try:
                        review=self._preview_message(db,{"assignment_id":assignment["id"],"template_id":template["id"],"at":at,"response_revision_id":revision_id})
                    except OperationError as error:
                        skipped.append({"assignment_id":assignment["id"],"kind":kind,"trigger_id":trigger,"code":error.code,"reason":str(error)})
                        continue
                    message=self._queue_review(db,review,actor,reason)
                    messages.append({"id":message["id"],"assignment_id":assignment["id"],"kind":kind,"trigger_id":trigger,"recipient":message["recipient"]})
                    known.add((kind,trigger))
            return {"messages":messages,"skipped":skipped,"automatic_enabled":profile.get("automatic_notifications",False)}
        return self._mutate("sync_notifications",p,action)

    def op_get_message(self,p):
        with self.workspace.connection() as db:return {"message":self._message(db,p.get("id")),"revision":self._revision(db)}

    def op_cancel_message(self,p):
        def action(db,actor,reason):
            before=self._message(db,p.get("id"))
            if before["version"]!=p.get("expected_version"):
                problem("VERSION_CONFLICT","Reopen the current communication")
            if before["delivery"]["state"] not in ("QUEUED","REJECTED","BOUNCED"):
                problem("DELIVERY_OUTCOME","Recover the original delivery outcome before cancelling this operation")
            self._event(db,before["id"],"workspace","cancel:"+p["request_id"],"CANCELLED",now(),{"actor":actor,"reason":reason})
            db.execute("UPDATE outreach_messages SET version=version+1,updated=? WHERE id=?",(now(),before["id"]))
            after=self._message(db,before["id"])
            self._history(db,"message",before["id"],after["version"],before,after,actor,reason)
            return {"message":after}
        return self._mutate("cancel_message",p,action)

    def op_followups(self,p):
        with self.workspace.connection() as db:
            profile=self._profile(db) or {}
            return followup_queue(self._assignments(db),self._messages(db),p.get("at",now()),profile.get("followup_settings"))

    def _still_current(self,db,message,at):
        assignment=self._assignment(db,message["assignment_id"])
        profile=self._profile(db)
        if not assignment["active"] or assignment.get("paused"):
            problem("ASSIGNMENT_INACTIVE","This original assignment is paused or inactive")
        if assignment["version"]!=message["assignment_version"] or assignment["contact"]["version"]!=message["contact_version"] or profile["version"]!=message["profile_version"]:
            problem("MESSAGE_STALE","Original assignment, contact or case settings changed; review a current message")
        kind=message["kind"]
        if kind in ("INVITATION","REMINDER") and assignment["respondent"]["status"] in ("received","accepted","submitted","withdrawn"):
            problem("RESPONSE_RECEIVED","An original response now suppresses this communication")
        if kind=="INVITATION" and assignment["respondent"]["status"]!="invited":
            problem("MESSAGE_STALE","The original respondent is already in its response workflow")
        if kind=="REVISION_REQUEST" and (assignment["revision_request"] or {}).get("id")!=message.get("trigger_id"):
            problem("MESSAGE_STALE","The original correction request changed")
        if kind=="REMINDER":
            other=[x for x in self._messages(db) if x["id"]!=message["id"]]
            queue=followup_queue([assignment],other,at,profile.get("followup_settings"))
            current=next((item for item in queue["items"] if item["key"]==message.get("followup_key")),None)
            if current is None or not current["eligible"]:
                problem("FOLLOWUP_STALE","The original follow-up is no longer due",None if current is None else current["reasons"])
        return assignment

    def op_begin_dispatch(self,p):
        from respondent_mail import compose_wire
        def action(db,actor,reason):
            before=self._message(db,p.get("id"))
            if before["version"]!=p.get("expected_version"):
                problem("VERSION_CONFLICT","Reopen the current communication")
            if before["delivery"]["state"]!="QUEUED":
                problem("DELIVERY_OUTCOME","Continue the original provider outcome; this message cannot be sent again",before["delivery"]["state"])
            self._still_current(db,before,now())
            token=secrets.token_urlsafe(32)
            wire,wire_meta=compose_wire(before)
            stored=json.loads(db.execute("SELECT data FROM outreach_messages WHERE id=?",(before["id"],)).fetchone()[0])
            stored.update({"claim_token":token,"wire_base64":base64.b64encode(wire).decode(),"wire":wire_meta,
                           "claimed_at":now(),"transport":text(p.get("transport"),"mail transport",limit=200)})
            db.execute("UPDATE outreach_messages SET data=?,version=version+1,updated=? WHERE id=?",(encoded(stored),now(),before["id"]))
            self._event(db,before["id"],"workspace","sending:"+before["id"],"SENDING",now(),{"actor":actor,"transport":stored["transport"],"wire":wire_meta})
            after=self._message(db,before["id"])
            self._history(db,"message",before["id"],after["version"],before,{k:v for k,v in after.items() if k!="claim_token"},actor,reason)
            return {"message_id":before["id"],"claim_token":token,"wire_base64":stored["wire_base64"],
                    "sender":before["sender"],"recipient":before["recipient"],"wire":wire_meta}
        return self._mutate("begin_dispatch",p,action)

    def op_finish_dispatch(self,p):
        def action(db,actor,reason):
            before=self._message(db,p.get("id"))
            token=before.get("claim_token")
            if not isinstance(token,str) or not secrets.compare_digest(token,str(p.get("claim_token",""))):
                problem("DISPATCH_CLAIM","Use the original native dispatch claim")
            outcome=p.get("outcome",{})
            kind=outcome.get("kind")
            if kind not in ("ACCEPTED","REJECTED","DEFERRED","UNKNOWN","CANCELLED"):
                problem("SMTP_OUTCOME","Retain the actual native SMTP outcome")
            if before["delivery"]["state"] not in ("SENDING","UNKNOWN"):
                problem("DELIVERY_OUTCOME","The original dispatch result has already been retained")
            self._event(db,before["id"],text(outcome.get("provider"),"provider",limit=200),
                text(outcome.get("event_id"),"provider result ID",limit=300),kind,
                iso(outcome.get("at"),"provider result time"),outcome)
            stored=json.loads(db.execute("SELECT data FROM outreach_messages WHERE id=?",(before["id"],)).fetchone()[0])
            stored["claim_token"]=None
            db.execute("UPDATE outreach_messages SET data=?,version=version+1,updated=? WHERE id=?",(encoded(stored),now(),before["id"]))
            after=self._message(db,before["id"])
            self._history(db,"message",before["id"],after["version"],before,after,actor,reason)
            return {"message":after}
        return self._mutate("finish_dispatch",p,action,internal=True)

    def op_record_unknown(self,p):
        def action(db,actor,reason):
            before=self._message(db,p.get("id"))
            if before["delivery"]["state"]!="SENDING":
                problem("DELIVERY_OUTCOME","This original dispatch is not awaiting its provider result")
            self._event(db,before["id"],"workspace","unknown:"+p["request_id"],"UNKNOWN",now(),{"actor":actor,"reason":reason})
            db.execute("UPDATE outreach_messages SET version=version+1,updated=? WHERE id=?",(now(),before["id"]))
            return {"message":self._message(db,before["id"])}
        return self._mutate("record_unknown",p,action)

    def op_preview_delivery(self,p):
        from respondent_mail import read_delivery
        try:raw=base64.b64decode(p.get("content_base64",""),validate=True)
        except ValueError:problem("DELIVERY_SOURCE","Provide the complete original provider result")
        with self.workspace.connection() as db:
            messages=self._messages(db)
        return read_delivery(raw,p.get("name","delivery.eml"),messages,p.get("format","DSN"),p.get("mapping"))

    def op_receive_delivery(self,p):
        def action(db,actor,reason):
            from respondent_mail import read_delivery
            try:raw=base64.b64decode(p.get("content_base64",""),validate=True)
            except ValueError:problem("DELIVERY_SOURCE","Provide the complete original provider result")
            review=read_delivery(raw,p.get("name","delivery.eml"),self._messages(db),p.get("format","DSN"),p.get("mapping"))
            if review["review_sha256"]!=p.get("review_sha256"):
                problem("DELIVERY_REVIEW","Review the exact original provider result")
            if review["problems"]:problem("DELIVERY_REVIEW","Resolve unmatched provider message identities",review["problems"])
            events=[]
            for item in review["events"]:
                message=self._message(db,item["message_id"])
                if not message.get("wire"):
                    problem("DELIVERY_SOURCE","This message has no original dispatched MIME identity")
                events.append(self._event(db,item["message_id"],item["provider"],item["provider_event_id"],item["kind"],item["at"],
                    {**item,"source_name":review["file"]["name"],"source_sha256":review["file"]["sha256"],
                     "original_base64":base64.b64encode(raw).decode(),"source_pointer":item.get("pointer")}))
                db.execute("UPDATE outreach_messages SET version=version+1,updated=? WHERE id=?",(now(),item["message_id"]))
            self._history(db,"delivery_source",review["file"]["sha256"],1,None,review,actor,reason)
            return {"review":review,"events":events}
        return self._mutate("receive_delivery",p,action)


    def op_dispatch(self,p):
        from respondent_mail import dispatch_message
        return dispatch_message(self.workspace,p.get("id"),text(p.get("actor"),"operator name"),
                                text(p.get("reason"),"dispatch reason"),request_id=p.get("request_id"))

    def op_process_due(self,p):
        from respondent_mail import process_due
        original_id=text(p.get("request_id"),"original scheduled request ID",limit=180)
        try:
            prior=self.op_operation({"request_id":original_id})
        except OperationError as error:
            if error.code!="NOT_FOUND":raise
            prior=None
        if prior:return prior
        result=process_due(self.workspace,text(p.get("actor"),"operator name"),text(p.get("reason"),"scheduled operation reason"),
                           send=bool(p.get("send",False)))
        return self._mutate("process_due",p,lambda db,a,r:{"job":result},internal=True)

    def op_save_public_link(self,p):
        def action(db,actor,reason):
            publication=self.workspace._row(db,"publications",p.get("publication_id"))
            key=p.get("id") or identifier()
            before=self._entity(db,"public_link",key,True)
            profile=self._profile(db)
            if not profile:problem("PROFILE","Save the original case settings first")
            token=before["token"] if before else secrets.token_urlsafe(36)
            expires=iso(p.get("expires_at",profile["due_at"]),"public registration expiry")
            active=p.get("active",True)
            if type(active) is not bool:problem("PUBLIC_LINK","Choose whether this public link is active")
            if before and before["publication_id"]!=publication["id"]:
                problem("PUBLIC_LINK","A retained public link keeps its original questionnaire publication")
            value={"publication_id":publication["id"],"name":text(p.get("name"),"public link name",limit=300),
                   "token":token,"token_hash":hashlib.sha256(token.encode()).hexdigest(),"expires_at":expires,
                   "active":active,"language":p.get("language","EN"),"entry_path":"/public/entry/"+token}
            if value["language"] not in ("EN","FR"):problem("PUBLIC_LANGUAGE","Choose English or French")
            entry=self._put(db,"public_link",key,value,p.get("expected_version",0),actor,reason)
            return {"link":entry,"url":profile["application_url"]+entry["entry_path"]}
        return self._mutate("save_public_link",p,action)

    def op_get_public_link(self,p):
        with self.workspace.connection() as db:
            link=self._entity(db,"public_link",p.get("id"))
            profile=self._profile(db)
            return {"link":link,"url":profile["application_url"]+link["entry_path"],"revision":self._revision(db)}

    def _public_link(self,db,token):
        if not isinstance(token,str) or not 30<=len(token)<=200:
            problem("NOT_FOUND","This questionnaire registration link is unavailable")
        wanted=hashlib.sha256(token.encode()).hexdigest()
        found=None
        for link in self._entities(db,"public_link"):
            if secrets.compare_digest(link["token_hash"],wanted):found=link
        if not found or not found["active"] or utc(found["expires_at"])<utc(now()):
            problem("NOT_FOUND","This questionnaire registration link is unavailable")
        return found

    def public_info(self,token):
        with self.workspace.connection() as db:
            link=self._public_link(db,token)
            _,definition=self.workspace._definition(db,link["publication_id"])
            profile=self._profile(db)
            return {"case_reference":profile["case_reference"],"case_title":profile["case_title"],
                    "organization_name":profile["organization_name"],"support_contact":profile["support_contact"],
                    "questionnaire_title":definition.get("title","Questionnaire"),"language":link["language"],
                    "due_at":profile["due_at"]}

    def public_enter(self,p):
        # A public entry always creates a distinct, explicitly self-reported
        # company. It never attaches an anonymous claimant to an existing firm.
        incoming=copy.deepcopy(p)
        incoming["actor"]="public questionnaire registration"
        incoming["reason"]="Respondent entered company contact information through the original published link"
        def action(db,actor,reason):
            link=self._public_link(db,p.get("token"))
            profile=self._profile(db)
            contact_data=p.get("contact",{})
            company_id="public-"+identifier()
            name=text(contact_data.get("company_name"),"company name",limit=1000)
            company=self._put(db,"company",company_id,{"name":name,"aliases":[],"active":True,
                "sources":[{"kind":"PUBLIC_REGISTRATION","public_link_id":link["id"],"at":now()}],
                "note":"Self-reported company; original operator review required before consolidation."},0,actor,reason)
            value={**contact_data,"company_id":company_id,"company_name":name,"kind":"PUBLIC_ENTRY",
                   "language":contact_data.get("language",link["language"]),
                   "source":{"kind":"PUBLIC_REGISTRATION","public_link_id":link["id"],"at":now()},"active":True}
            contact=self._put(db,"contact",identifier(),normalized_contact(value),0,actor,reason)
            assignment=self._create_assignment(db,company,contact,link["publication_id"],profile,actor,reason,
                {"public_link_id":link["id"],"registration_state":"NEW_COMPANY_CONTACT_REVIEW"})
            private=self._assignment(db,assignment["id"],private=True)
            return {"respondent_id":private["respondent_id"],"entry_path":private["entry_path"],"access_code":private["access_code"],
                    "company_name":name,"questionnaire_id":self.workspace._row(db,"publications",link["publication_id"])["questionnaire_id"]}
        return self._mutate("public_enter",incoming,action,internal=True)

    def op_respondent_contact(self,p):
        with self.workspace.connection() as db:
            row=db.execute("SELECT id FROM outreach_assignments WHERE respondent_id=?",(p.get("respondent_id"),)).fetchone()
            if not row:problem("NOT_FOUND","This respondent has no linked contact record")
            assignment=self._assignment(db,row[0])
            contact=assignment["contact"]
            return {"respondent_id":assignment["respondent_id"],"contact_id":contact["id"],"version":contact["version"],
                    "contact":{k:contact.get(k,"") for k in ("company_name","contact_name","email","phone","postal_address","country","language")},
                    "due_at":assignment["due_at"]}

    def op_update_respondent_contact(self,p):
        return self.update_respondent_contact(p)

    def update_respondent_contact(self,p):
        incoming=copy.deepcopy(p)
        incoming["actor"]="respondent:"+str(p.get("respondent_id"))
        incoming["reason"]="Respondent updated the contact information on their original questionnaire assignment"
        def action(db,actor,reason):
            row=db.execute("SELECT id FROM outreach_assignments WHERE respondent_id=?",(p.get("respondent_id"),)).fetchone()
            if not row:problem("NOT_FOUND","This respondent has no linked contact record")
            assignment=self._assignment(db,row[0])
            current=assignment["contact"]
            proposed=p.get("contact",{})
            allowed={"contact_name","email","phone","postal_address","country","language"}
            if set(proposed)-allowed:problem("RESPONDENT_CONTACT","Only this respondent's contact fields can be updated")
            value={**current,**proposed,"source":{"kind":"RESPONDENT_CONTACT_UPDATE","respondent_id":assignment["respondent_id"],
                     "previous_source":current["source"],"at":now()}}
            saved=self._put(db,"contact",current["id"],normalized_contact(value),p.get("expected_version"),actor,reason)
            return {"contact_id":saved["id"],"version":saved["version"],"respondent_id":assignment["respondent_id"]}
        return self._mutate("update_respondent_contact",incoming,action,internal=True)

    def op_log_followup(self,p):
        def action(db,actor,reason):
            assignment=self._assignment(db,p.get("assignment_id"))
            outcome=p.get("outcome")
            if outcome not in ("CONTACTED","NO_ANSWER","ASSISTANCE","CONTACT_CORRECTION","EXPECTED_RESPONSE","POSTAL_SENT","REFERRED","DECLINED"):
                problem("FOLLOWUP_OUTCOME","Select the actual contact outcome")
            record={"assignment_id":assignment["id"],"respondent_id":assignment["respondent_id"],"outcome":outcome,
                    "channel":p.get("channel"),"at":iso(p.get("at"),"original contact time"),
                    "note":text(p.get("note"),"contact outcome"),"original_source":p.get("original_source")}
            if record["channel"] not in ("EMAIL","PHONE","POSTAL","IN_PERSON","REFERRAL"):
                problem("FOLLOWUP_CHANNEL","Select the original contact route")
            if p.get("expected_response_at"):record["expected_response_at"]=iso(p["expected_response_at"],"expected response")
            if not record["original_source"]:problem("FOLLOWUP_SOURCE","Retain the original correspondence or staff contact record")
            self._history(db,"followup",assignment["id"],assignment["version"],None,record,actor,reason)
            return {"followup":record}
        return self._mutate("log_followup",p,action)

    def verify_sources(self):
        verified=[]
        with self.workspace.connection() as db:
            for row in db.execute("SELECT id,sha,bytes,report FROM outreach_sources"):
                if hashlib.sha256(row["bytes"]).hexdigest()!=row["sha"]:
                    problem("SOURCE_HASH","A retained original respondent source has changed",{"source_id":row["id"]})
                report=json.loads(row["report"])
                if report["parsed"]["file"]["sha256"]!=row["sha"] or report["mapped"]["source_file"]["sha256"]!=row["sha"]:
                    problem("SOURCE_HASH","The retained mapping no longer names the original bytes",{"source_id":row["id"]})
                for key in ("parsed","mapped"):
                    data=copy.deepcopy(report[key])
                    seal=data.pop("review_sha256")
                    if digest(data)!=seal:problem("SOURCE_REVIEW_HASH","A retained source interpretation has changed",{"source_id":row["id"],"part":key})
                verified.append({"source_id":row["id"],"sha256":row["sha"],"bytes":len(row["bytes"])})
        return {"verified_originals":verified}

    def _operating_snapshot(self,db):
        sources=[]
        for row in db.execute("SELECT id FROM outreach_sources ORDER BY created,id"):
            source=self._source(db,row[0],include_bytes=True)
            source["original_base64"]=base64.b64encode(source.pop("bytes")).decode()
            sources.append(source)
        history=[]
        for row in db.execute("SELECT * FROM outreach_history ORDER BY sequence"):
            history.append({**dict(row),"before_value":None if row["before_value"] is None else json.loads(row["before_value"]),
                            "after_value":None if row["after_value"] is None else json.loads(row["after_value"])})
        return {"schema":"commons.atssc.respondent-operating-export.v1",
                "workspace_id":db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()[0],
                "revision":self._revision(db),"profile":self._profile(db),"sources":sources,
                "companies":self._entities(db,"company"),"contacts":self._entities(db,"contact"),
                "coverage":self._entities(db,"coverage"),"templates":self._entities(db,"template"),
                "assignments":[self._assignment(db,row[0],private=True) for row in db.execute("SELECT id FROM outreach_assignments ORDER BY created,id")],
                "messages":self._messages(db),"public_links":self._entities(db,"public_link"),"history":history,
                "original_journal":[dict(row) for row in db.execute("SELECT * FROM journal ORDER BY sequence")],
                "receiving":"Receive the complete original project ZIP to preserve the original authenticated questionnaire workspace."}

    def op_export_operating(self,p):
        self.verify_sources()
        with self.workspace.connection() as db:
            db.execute("BEGIN")
            value=self._operating_snapshot(db)
        return value

    def op_export_project(self,p):
        originals=self.verify_sources()
        result=self.workspace.op_export_project(p)
        return {**result,"respondent_sources":originals}

    def file_bytes(self,kind,key=None,format_name="json"):
        if kind=="source":
            with self.workspace.connection() as db:source=self._source(db,key,include_bytes=True)
            if format_name=="original":return source["bytes"],source["name"],"application/octet-stream"
            return (json.dumps({k:v for k,v in source.items() if k!="bytes"},ensure_ascii=False,indent=2)+"\n").encode(),"source-"+key+".json","application/json"
        if kind=="message":
            with self.workspace.connection() as db:value=self._message(db,key)
            if format_name=="eml":
                if not value.get("wire_base64"):problem("NOT_FOUND","The original message has not entered dispatch")
                return base64.b64decode(value["wire_base64"]),"message-"+key+".eml","message/rfc822"
            return (json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode(),"message-"+key+".json","application/json"
        if kind=="operating":
            value=self.op_export_operating({})
            if format_name=="json":
                return (json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode(),"ATSSC_Respondent_Operations.json","application/json"
            sheets=operating_tables(value)
            if format_name=="xlsx":
                return make_xlsx(sheets),"ATSSC_Respondent_Operations.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if format_name=="csv":
                table=sheets["Contacts"]
                return table_csv(table["headers"],table["rows"]),"ATSSC_Contacts.csv","text/csv; charset=utf-8"
            if format_name=="zip":
                output=io.BytesIO()
                with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as archive:
                    files={"ATSSC_Respondent_Operations.json":(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode(),
                           "ATSSC_Respondent_Operations.xlsx":make_xlsx(sheets)}
                    for name,table in sheets.items():files[name.replace(" ","_")+".csv"]=table_csv(table["headers"],table["rows"])
                    for source in value["sources"]:
                        files["originals/"+source["id"]+"/"+Path(source["name"]).name]=base64.b64decode(source["original_base64"])
                    manifest={"schema":"commons.atssc.respondent-export-files.v1","workspace_id":value["workspace_id"],"revision":value["revision"],
                              "files":[{"path":name,"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()} for name,raw in files.items()]}
                    files["MANIFEST.json"]=(json.dumps(manifest,indent=2)+"\n").encode()
                    for name,raw in files.items():archive.writestr(name,raw)
                return output.getvalue(),"ATSSC_Respondent_Operations.zip","application/zip"
        problem("NOT_FOUND","The selected complete operating download is unavailable")

def operating_tables(value):
    companies=value["companies"];contacts=value["contacts"];assignments=value["assignments"];messages=value["messages"]
    tables={
      "Companies":{"headers":["company_id","company_name","active","aliases","note","source_count","version"],
                   "rows":[[x["id"],x["name"],x.get("active",True),"; ".join(x.get("aliases",[])),x.get("note",""),len(x.get("sources",[])),x["version"]] for x in companies]},
      "Contacts":{"headers":["contact_id","company_id","company_name","contact_name","email","phone","postal_address","country","language","role","kind","active","version","source","custom_fields"],
                  "rows":[[x["id"],*[x.get(k,"") for k in ("company_id","company_name","contact_name","email","phone","postal_address","country","language","role","kind","active")],x["version"],x["source"],x.get("custom",{})] for x in contacts]},
      "Assignments":{"headers":["assignment_id","respondent_id","company_id","contact_id","publication_id","status","notice_at","due_at","latest_revision_id","latest_revision_number","accepted_revision_id","active","paused","registration_state","version"],
                     "rows":[[x["id"],x["respondent_id"],x["company_id"],x["contact_id"],x["respondent"]["publication_id"],x["respondent"]["status"],x["notice_at"],x["due_at"],(x["latest_response"] or {}).get("id"),(x["latest_response"] or {}).get("number"),x["respondent"].get("accepted_revision"),x["active"],x.get("paused"),x.get("registration_state"),x["version"]] for x in assignments]},
      "Delivery":{"headers":["message_id","assignment_id","kind","recipient","subject","delivery_state","provider_events","original_message_id","trigger_id","followup_key","created"],
                  "rows":[[x["id"],x["assignment_id"],x["kind"],x["recipient"],x["rendered"]["subject"],x["delivery"]["state"],len(x["events"]),(x.get("wire") or {}).get("message_id"),x.get("trigger_id"),x.get("followup_key"),x["created"]] for x in messages]},
      "Sources":{"headers":["source_id","kind","original_filename","sha256","source_bytes","supersedes_id","mapped_rows","invalid_rows","created"],
                 "rows":[[x["id"],x["kind"],x["name"],x["sha256"],x["report"]["parsed"]["file"]["bytes"],x["supersedes_id"],x["report"]["mapped"]["counts"]["rows"],x["report"]["mapped"]["counts"]["invalid"],x["created"]] for x in value["sources"]]},
      "Coverage":{"headers":["coverage_id","coverage_name","group_key","hs_code","country","currency","value_basis","original_net_value","original_negative_value","coverage_basis","selected_value","target_percent","achieved_percent","meets_target","selected_companies"],
                  "rows":[]},
      "Followup history":{"headers":["sequence","assignment_id","actor","recorded_at","channel","outcome","contact_at","note","expected_response_at","original_source"],
                          "rows":[]}
    }
    for plan in value["coverage"]:
        for group in plan["report"]["groups"]:
            fields=group["fields"]
            tables["Coverage"]["rows"].append([plan["id"],plan["name"],group["key"],fields.get("hs_code",""),fields.get("country",""),fields["currency"],
                plan["report"]["policy"].get("value_basis","NET_COMPANY"),group["net_value"],group["negative_value"],group["coverage_basis"],group["selected_value"],
                group["target_percent"],group["achieved_percent"],group["meets_target"],"; ".join(x["company_id"] for x in group["companies"] if x["selected"])])
    for entry in value["history"]:
        if entry["kind"]=="followup":
            event=entry["after_value"]
            tables["Followup history"]["rows"].append([entry["sequence"],entry["identity"],entry["actor"],entry["created"],
                event["channel"],event["outcome"],event["at"],event["note"],event.get("expected_response_at"),event["original_source"]])
    custom=sorted({k for c in contacts for k in c.get("custom",{})})
    for key in custom:tables["Contacts"]["headers"].append("custom."+key)
    for row,contact in zip(tables["Contacts"]["rows"],contacts):
        row.extend(contact.get("custom",{}).get(key,"") for key in custom)
    return tables

def make_xlsx(tables):
    """Editable whole-register workbook; exact original files travel separately."""
    def xml_text(value):
        value="" if value is None else encoded(value) if isinstance(value,(dict,list)) else str(value)
        if len(value)>32767:
            problem("EXCEL_CELL_LENGTH","An operating value exceeds Excel's cell length; retain the full JSON export")
        if any(ord(c)<32 and c not in "\t\n\r" for c in value):
            problem("EXCEL_CELL_CHARACTER","An operating value contains an XML-incompatible control character")
        return escape(value)
    def column(n):
        out=""
        while n:n,r=divmod(n-1,26);out=chr(65+r)+out
        return out
    namespace="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    files={}
    sheet_elements=[];relations=[];content_types=[]
    for index,(name,table) in enumerate(tables.items(),1):
        if len(name)>31 or re.search(r"[\[\]:*?/\\]",name):problem("EXCEL_SHEET","Invalid operating sheet name")
        values=[table["headers"],*table["rows"]]
        rows=[]
        for row_number,row in enumerate(values,1):
            cells=[]
            for col,value in enumerate(row,1):
                cells.append('<c r="'+column(col)+str(row_number)+'" t="inlineStr"><is><t xml:space="preserve">'+xml_text(value)+'</t></is></c>')
            rows.append('<row r="'+str(row_number)+'">'+"".join(cells)+'</row>')
        dimension="A1:"+column(max(1,len(table["headers"])))+str(len(values))
        files["xl/worksheets/sheet"+str(index)+".xml"]=('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="'+namespace+'"><dimension ref="'+dimension+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+"".join(rows)+'</sheetData><autoFilter ref="'+dimension+'"/></worksheet>').encode()
        sheet_elements.append('<sheet name="'+xml_text(name)+'" sheetId="'+str(index)+'" r:id="rId'+str(index)+'"/>')
        relations.append('<Relationship Id="rId'+str(index)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+str(index)+'.xml"/>')
        content_types.append('<Override PartName="/xl/worksheets/sheet'+str(index)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    files["xl/workbook.xml"]=('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="'+namespace+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+"".join(sheet_elements)+'</sheets></workbook>').encode()
    files["xl/_rels/workbook.xml.rels"]=('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+"".join(relations)+'</Relationships>').encode()
    files["_rels/.rels"]=b'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    files["[Content_Types].xml"]=('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+"".join(content_types)+'</Types>').encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as archive:
        for name,raw in sorted(files.items()):
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,raw)
    return output.getvalue()
