"""MIT. Source-bound Directory conformance, reviewer decisions and complete receiving.

Checks use the existing Directory source/index/reference engine. Findings and
reviews are immutable original directory_records, with complete streamed files
in the original eltss/files object store. No external endpoint is contacted.
"""
from __future__ import annotations
from collections import Counter,defaultdict
from contextlib import contextmanager
from datetime import date,datetime,time
from decimal import Decimal
import hashlib
import html
import json
import os
from pathlib import Path
import sqlite3
from urllib.parse import quote
import zipfile

from directory_runtime import InputError,ConflictError,source,original_workspace,now,safe_read
import directory_schema as schema
from directory_source_schema import standards,original_sources
import directory_conformance_rules as rules

HERE=Path(__file__).resolve().parent
VERSION="stellar-forge.directory-conformance.v1"
KINDS={"conformancePlans","conformanceAssessments","conformanceReviews","conformanceComparisons"}
MAX_FILE=1073741824
MAX_ROWS=250000
MAX_FINDINGS=1000000
MAX_INTERACTIVE=4194304
ENGINE_FILES=("directory_conformance.py","directory_conformance_rules.py",
    "directory-conformance-schema.json","directory_source_schema.py","directory_index.py")
OUTCOMES=("pass","annotation","error","warning","not-evaluated")
SEVERITIES=("error","warning","not-evaluated")
MEDIA={"report":"text/html; charset=utf-8","findings":"application/x-ndjson",
    "rows":"application/x-ndjson","index":"application/vnd.sqlite3","rules":"application/json",
    "summary":"application/json","package":"application/zip"}
EXT={"report":"html","findings":"jsonl","rows":"jsonl","index":"sqlite","rules":"json","summary":"json","package":"zip"}
STYLE="body{font:14px system-ui,sans-serif;color:#25272a;background:#fff;margin:32px auto;padding:0 24px;max-width:1480px}h1{font-size:28px}h2{font-size:20px;margin-top:30px}a{color:inherit}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:12px}th,td{border:1px solid #c9ccce;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eceeef}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.meta{padding:16px;border:1px solid #b8bdc1;background:#f6f7f7}.muted{color:#5b6167}code{font-size:12px}"

def catalogue():
    return source.json_value((HERE/"directory-conformance-schema.json").read_bytes())

def typed(name,raw):
    import copy
    spec=catalogue()["inputSchemas"].get(name)
    if spec is None:raise InputError("Select an original conformance input")
    value=copy.deepcopy(schema.validate(raw,spec,name))
    for key in ("label","actor"):
        if not value[key].strip():raise InputError("Name the conformance record and actual reviewing actor")
    value.setdefault("note","")
    return value

def jbytes(value):return source.jbytes(value)
def digest(value):return source.sha(jbytes(value))
def esc(value):return html.escape(str(value if value is not None else ""),quote=True)
def title(value):return "<h1>"+esc(value)+"</h1>"
def table_head(columns):return "<table><thead><tr>"+"".join("<th>"+esc(k)+"</th>"for k in columns)+"</tr></thead><tbody>"
def table_row(values):return "<tr>"+"".join("<td>"+esc(v)+"</td>"for v in values)+"</tr>"
def page_top(label):return "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>"+esc(label)+"</title><style>"+STYLE+"</style></head><body>"+title(label)

def engine_identity():
    return {"schema":VERSION,"files":{name:{"bytes":(HERE/name).stat().st_size,
        "sha256":source.sha((HERE/name).read_bytes())}for name in ENGINE_FILES},
        "originalSourceSha256":source.sha((HERE/"directory-original-source.json").read_bytes())}

def checked_write(path,content):
    raw=content.encode()if isinstance(content,str)else content
    if len(raw)>MAX_FILE:raise InputError("Complete conformance file exceeds its 1 GiB budget")
    original_workspace.private_write(path,raw)
    return path

@contextmanager
def writer(path,binary=False):
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,"wb"if binary else"w",**({}if binary else{"encoding":"utf-8","newline":""}))as out:
        yield out
        out.flush();os.fsync(out.fileno())
    if Path(path).stat().st_size>MAX_FILE:raise InputError("Complete conformance file exceeds its 1 GiB budget")

def logical_key(value):
    """Type-preserving equality key for checked logical cells, never source values."""
    if rules.number(value):
        n=Decimal(str(value))
        # Equal decimal values share the key without expanding large exponents.
        if n.is_nan():return ["number","NaN"]
        if n.is_infinite():return ["number",str(n)]
        if n==0:return ["number","0"]
        sign,digits,exponent=n.as_tuple();digits=list(digits)
        while digits and digits[-1]==0:digits.pop();exponent+=1
        return ["number",sign,digits,exponent]
    if isinstance(value,(date,datetime,time)):return [type(value).__name__,value.isoformat()]
    if isinstance(value,dict):return ["object",[[k,logical_key(v)]for k,v in sorted(value.items())]]
    if isinstance(value,list):return ["array",[logical_key(v)for v in value]]
    return [rules.kind(value),value]

class FindingIndex:
    def __init__(self,path,header):
        self.path=Path(path)
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
        self.db=sqlite3.connect(str(path));self.db.row_factory=sqlite3.Row
        self.db.executescript("""PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;
            PRAGMA temp_store=FILE;PRAGMA cache_size=-2048;PRAGMA max_page_count=262144;
            CREATE TABLE findings(ordinal INTEGER PRIMARY KEY,id TEXT UNIQUE,source_id TEXT,
                record_id TEXT,table_name TEXT,code TEXT,severity TEXT,body TEXT);
            CREATE INDEX finding_filter ON findings(severity,table_name,code);
            CREATE INDEX finding_record ON findings(source_id,record_id);
            CREATE TABLE rows(ordinal INTEGER PRIMARY KEY,source_id TEXT,record_id TEXT,
                table_name TEXT,native_id TEXT,body TEXT,UNIQUE(source_id,record_id));
            CREATE INDEX row_table ON rows(table_name);
            CREATE TABLE unique_values(scope TEXT,value_sha TEXT,body TEXT,PRIMARY KEY(scope,value_sha));
            CREATE TABLE metadata(name TEXT PRIMARY KEY,body TEXT);""")
        self.db.execute("INSERT INTO metadata VALUES(?,?)",("header",jbytes(header).decode()))
        self.checks=Counter();self.table_checks=Counter();self.finding_count=0;self.row_count=0
        self.current=None;self.current_counts=Counter()
    def count(self,code,outcome):
        if outcome not in OUTCOMES:raise InputError("Unknown source assertion outcome")
        self.checks[code,outcome]+=1
        self.table_checks[(self.current or{}).get("table",""),code,outcome]+=1
        if self.current:self.current_counts[outcome]+=1
    def emit(self,code,severity,pointer,message,location,actual=rules.ABSENT,related=None):
        if severity not in SEVERITIES:raise InputError("Unknown retained finding severity")
        row=self.current or{}
        value={"schema":"stellar-forge.directory-conformance-finding.v1","code":code,
            "severity":severity,"table":row.get("table"),"ref":row.get("ref"),
            "pointer":pointer,"originalPointer":(row.get("pointer")or"")+pointer,
            "message":message,"requirementSource":location,"actual":rules.described(actual)}
        if related is not None:value["related"]=related
        ident=digest(value);value={"id":ident,**value};body=jbytes(value)
        if len(body)>MAX_INTERACTIVE:raise InputError("A complete finding exceeds the interactive record budget; select a smaller assessment scope")
        if self.finding_count>=MAX_FINDINGS:raise InputError("The complete conformance assessment exceeds one million findings")
        changed=self.db.execute("INSERT OR IGNORE INTO findings VALUES(NULL,?,?,?,?,?,?,?)",
            (ident,row.get("sourceId"),row.get("recordId"),row.get("table"),code,severity,body.decode())).rowcount
        self.finding_count+=changed
    def begin(self,row):
        self.current=row;self.current_counts=Counter()
    def end(self):
        row=self.current
        value={k:row.get(k)for k in ("ref","table","nativeId","sourceId","recordId","rowOrdinal",
            "resourceSha256","rowSha256","memberName","memberSha256","pointer","parentRecordId",
            "rawRange","representation","fullUrl")if k in row}
        value["checks"]={k:self.current_counts[k]for k in OUTCOMES}
        value["findings"]=self.db.execute("SELECT count(*) FROM findings WHERE source_id=? AND record_id=?",
            (row["sourceId"],row["recordId"])).fetchone()[0]
        self.db.execute("INSERT INTO rows VALUES(NULL,?,?,?,?,?)",
            (row["sourceId"],row["recordId"],row["table"],row.get("nativeId"),jbytes(value).decode()))
        self.row_count+=1
        if self.row_count>MAX_ROWS:raise InputError("The selected assessment exceeds 250,000 original rows")
        if self.row_count%100==0:self.db.commit();self.budget()
        self.current=None
    def unique(self,table,member,field,value,ref):
        key=logical_key(value)
        # Frictionless NaN is a permitted number token and does not equal itself.
        if key==["number","NaN"]:return None
        scope=jbytes([ref["sourceId"],member,table,field]).decode();sha=digest(key)
        old=self.db.execute("SELECT body FROM unique_values WHERE scope=? AND value_sha=?",(scope,sha)).fetchone()
        if old:return source.json_value(old[0])
        self.db.execute("INSERT INTO unique_values VALUES(?,?,?)",(scope,sha,jbytes(ref).decode()))
        return None
    def budget(self):
        if self.path.stat().st_size>MAX_FILE:raise InputError("Complete finding index exceeds 1 GiB")
    def finish(self,summary):
        self.db.execute("INSERT INTO metadata VALUES(?,?)",("summary",jbytes(summary).decode()))
        self.db.execute("DROP TABLE unique_values");self.db.commit()
        if self.db.execute("PRAGMA quick_check").fetchone()[0]!="ok":raise InputError("The complete assessment index failed native SQLite verification")
        self.budget()
    def close(self):self.db.close()

def counter_rows(counts):
    grouped={}
    for (code,outcome),n in sorted(counts.items()):grouped.setdefault(code,{k:0 for k in OUTCOMES})[outcome]=n
    return [{"code":code,**value}for code,value in grouped.items()]

def table_counter_rows(counts):
    grouped={}
    for (table,code,outcome),n in sorted(counts.items()):grouped.setdefault((table,code),{k:0 for k in OUTCOMES})[outcome]=n
    return [{"table":table,"code":code,**value}for(table,code),value in grouped.items()]

class DirectoryConformance:
    def _conformance_definition(self,ref):
        row=self.directory_source_row(ref["sourceId"],ref["recordId"])
        resource=source.json_value(row["json"])
        kind=resource.get("type")
        if resource.get("resourceType")!="StructureDefinition"or kind not in {"Organization","Location","HealthcareService"}:
            raise InputError("Select an original Organization, Location or HealthcareService StructureDefinition")
        expected="http://hl7.org/fhir/us/hsds/StructureDefinition/hsds-"+kind
        if resource.get("url")!=expected or resource.get("version")!="1.0.0":
            raise InputError("The selected definition must be the retained published HSD 1.0.0 canonical profile")
        elements=resource.get("snapshot",{}).get("element")
        if not isinstance(elements,list)or not elements or len(elements)>10000:
            raise InputError("Select the full original published profile snapshot")
        return {"ref":row["ref"],"resource":resource}

    def save_directory_conformance_plan(self,raw):
        value=typed("conformance_plan",raw)
        value.setdefault("tables",[]);value.setdefault("formatPolicy","annotation")
        value.setdefault("definitionRefs",[]);value.setdefault("publisherProfile","")
        if not value["scope"].strip():raise InputError("The assessed publication and receiving scope must be explicit")
        with self.mutex:
            subject=self.directory_record(value["subjectKind"],value["subjectId"])
            self._directory_file_path(subject["indexFile"])
            with self.directory_open_index(value["subjectKind"],subject["id"])as db:
                population={r[0]:r[1]for r in db.execute("SELECT table_name,count(*) FROM records GROUP BY table_name")}
                protocols={r[0]for r in db.execute("SELECT DISTINCT protocol FROM records")}
            selected=sorted(value["tables"]or population)
            if set(selected)-set(population):raise InputError("A selected conformance table has no original rows in this subject")
            definitions=[]
            if value["family"]=="hsds-3.3.1":
                if value["definitionRefs"]:raise InputError("HSDS checks use the exact retained canonical source; leave FHIR definitionRefs empty")
                if "hsds"not in protocols:raise InputError("Choose a subject with original HSDS rows")
            else:
                if not value["definitionRefs"]:raise InputError("Select the original published HSD snapshots by their retained source/record IDs")
                definitions=[self._conformance_definition(r)for r in value["definitionRefs"]]
                types=[d["resource"]["type"]for d in definitions]
                if len(set(types))!=len(types):raise InputError("Select one exact published snapshot for each resource type")
                if not value["tables"]:selected=sorted(set(population)&set(types))
                if not selected:raise InputError("The selected HSD profiles have no original resource rows in this subject")
                if "fhir-hsd"not in protocols:raise InputError("Choose a subject with retained original FHIR directory resources")
            sources=[subject["id"]]if value["subjectKind"]=="sources"else subject["sourceIds"]
            frozen=[{"sourceId":ident,"originalSha256":self.directory_source(ident)["originalSha256"],
                "indexFile":self.directory_source(ident)["indexFile"]}for ident in sources]
            return self._directory_store("conformancePlans",{"schema":VERSION,**value,"tables":selected,
                "population":population,"sourceRefs":frozen,"subjectIndex":subject["indexFile"],
                "definitions":[{"ref":d["ref"],"canonical":d["resource"]["url"],"version":d["resource"]["version"],
                    "resourceType":d["resource"]["type"],"elements":len(d["resource"]["snapshot"]["element"])}for d in definitions],
                "engine":engine_identity(),"evaluation":"Selected assertions and complete coverage; no blanket certification"})

    def _conformance_plan(self,ident):
        plan=self.directory_record("conformancePlans",ident)
        subject=self.directory_record(plan["subjectKind"],plan["subjectId"])
        if subject["indexFile"]!=plan["subjectIndex"]:raise InputError("The original conformance subject index changed")
        self._directory_file_path(plan["subjectIndex"])
        for d in plan["sourceRefs"]:
            original=self.directory_source(d["sourceId"])
            if original["originalSha256"]!=d["originalSha256"]or original["indexFile"]!=d["indexFile"]:
                raise InputError("The reviewed original conformance source changed")
        for selected in plan["definitions"]:
            actual=self._conformance_definition({"sourceId":selected["ref"]["sourceId"],"recordId":selected["ref"]["recordId"]})
            if actual["ref"]!=selected["ref"]or actual["resource"]["url"]!=selected["canonical"]or actual["resource"]["version"]!=selected["version"]:
                raise InputError("The exact selected original profile definition changed")
        return plan

    def _conformance_native_observations(self,db,plan,row,sink):
        source_id=""if plan["subjectKind"]=="sources"else row["sourceId"]
        for observation in row.get("observations",[]):
            code="native-observation:"+observation["kind"]
            sink.count(code,"warning")
            sink.emit(code,"warning",observation.get("pointer",""),
                "The original source index retained this observation; it is not silently promoted to a standards assertion.",
                {"engine":"directory_index.py","subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"]},observation)
        if row.get("identityKey"):
            count=db.execute("SELECT count(*) FROM records WHERE identity_key=?",(row["identityKey"],)).fetchone()[0]
            sink.count("native-identity","warning"if count>1 else"pass")
            if count>1:sink.emit("native-identity","warning","/id",
                "The exact native identity occurs more than once in this selected source/index. All original candidates remain available.",
                {"subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"],"identityKey":row["identityKey"]},count)
        for link in db.execute("""SELECT l.link_id,l.body,r.state,r.candidates FROM links l
            JOIN resolutions r ON r.source_id=l.source_id AND r.link_id=l.link_id
            WHERE l.source_id=? AND l.record_id=? ORDER BY l.link_id""",(source_id,row["recordId"])):
            body=source.json_value(link["body"]);state=link["state"]
            outcome="pass"if state=="resolved"else"not-evaluated"if state=="not-resolvable"else"warning"
            code="native-reference:"+body["kind"];sink.count(code,outcome)
            if outcome!="pass":
                sink.emit(code,outcome,body.get("pointer",""),
                    "The original reference index reports "+state+". This is a selected-population observation; no target identity or remote completeness is inferred.",
                    {"subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"],
                        "linkId":link["link_id"],"sourceId":row["sourceId"],"nativeState":state,
                        "candidateCount":link["candidates"],"nativeLink":body},body.get("nativeValue",body))

    def _conformance_source_members(self,plan):
        selected={r["sourceId"]for r in plan["sourceRefs"]}|{r["ref"]["sourceId"]for r in plan["definitions"]}
        members={}
        for ident in sorted(selected):
            record=self.directory_source(ident)
            members["originals/"+ident+"/source.json"]=jbytes(record)
            members["originals/"+ident+"/original-input"]=self._directory_file_path(record["originalFile"])
            members["originals/"+ident+"/index.sqlite"]=self._directory_file_path(record["indexFile"])
            for member in record["members"]:
                d=member["file"];members["original-files/"+d["sha256"]+".bin"]=self._directory_file_path(d)
        members["subject-index.sqlite"]=self._directory_file_path(plan["subjectIndex"])
        members["original-standard-source.json"]=HERE/"directory-original-source.json"
        for name in ENGINE_FILES:members["implementation/"+name]=HERE/name
        return members

    def _conformance_package(self,path,members):
        manifest={};total=0
        for name,value in members.items():
            source.member_name(name)
            if isinstance(value,bytes):size=len(value);sha=source.sha(value)
            else:
                original_workspace.regular(value,MAX_FILE);size=Path(value).stat().st_size
                sha=original_workspace.file_digest(value,MAX_FILE)
            total+=size
            if total>MAX_FILE or len(manifest)>40000:raise InputError("The complete selected conformance package exceeds 1 GiB or 40,000 original members; select a smaller source scope")
            manifest[name]={"bytes":size,"sha256":sha}
        manifest_bytes=jbytes({"schema":"stellar-forge.directory-conformance-file-package.v1","files":manifest,
            "totalOriginalBytes":total,"meaning":"Complete assessment files, exact selected original sources/indices and selected implementation. Import the whole editable Directory workspace to continue reviews."})
        with writer(path,True)as out:
            with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,allowZip64=True)as archive:
                for name,value in {**members,"manifest.json":manifest_bytes}.items():
                    info=zipfile.ZipInfo(name);info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED
                    with archive.open(info,"w",force_zip64=True)as target:
                        if isinstance(value,bytes):target.write(value)
                        else:
                            with Path(value).open("rb")as inp:
                                while block:=inp.read(65536):target.write(block)
        return path

    def _conformance_report(self,path,label,plan,summary,db,extra=None):
        with writer(path)as out:
            out.write(page_top(label)+"<div class='meta'><p>"+esc(plan["scope"])+"</p><p>Family: "+esc(plan["family"])+
                " · Publisher declaration: "+esc(plan["publisherProfile"]or"Not declared")+
                " · Selection: "+esc(plan["profileDisposition"])+"</p><p>Subject: "+esc(plan["subjectKind"])+"/"+
                esc(plan["subjectId"])+"</p></div>")
            out.write("<h2>Scope and coverage</h2><p>These are the selected source assertions and reference observations. A pass is not a blanket conformance certification. Unsupported profile slices, terminology, invariants, target-profile checks and external definitions remain explicit coverage findings. Must Support does not create a missing-field cardinality.</p>")
            out.write("<p>"+esc(str(summary["selectedRows"])+" selected indexed rows; "+str(summary["findings"])+" distinct findings.")+"</p>")
            out.write(table_head(["Table","Original rows","Selected rows"]))
            for table,n in sorted(plan["population"].items()):out.write(table_row([table,n,summary["populations"].get(table,0)]))
            out.write("</tbody></table><h2>Evaluated outcomes</h2>"+table_head(["Code",*OUTCOMES]))
            for row in summary["checks"]:out.write(table_row([row["code"],*[row[k]for k in OUTCOMES]]))
            out.write("</tbody></table>")
            if extra:out.write("<h2>Recorded review</h2><pre>"+esc(source.lexical_json(extra))+"</pre>")
            out.write("<h2>Every retained finding</h2><p>Original JSON pointers refer to unchanged source records. Value previews are explicitly bounded; their hashes and the complete original source and rule files preserve the full values.</p>")
            out.write(table_head(["Severity","Code","Original source / record","Pointer","Finding","Requirement source","Original value"]))
            for r in db.execute("SELECT body FROM findings ORDER BY ordinal"):
                value=source.json_value(r[0]);ref=value.get("ref")or{}
                out.write(table_row([value["severity"],value["code"],ref.get("sourceId","")+" / "+ref.get("recordId",""),
                    value["originalPointer"],value["message"],source.lexical_json(value["requirementSource"]),source.lexical_json(value["actual"])]))
                if out.tell()>MAX_FILE:raise InputError("The complete HTML report exceeds its original file budget")
            if extra:
                out.write("</tbody></table><h2>Complete files</h2><p><a href='findings.jsonl'>Every frozen finding decision</a> · <a href='summary.json'>Complete review summary</a> · <a href='assessment-complete-originals.zip'>Original assessment, complete rule/index files and source bytes</a></p>")
            else:
                out.write("</tbody></table><h2>Complete files</h2><p><a href='findings.jsonl'>Findings</a> · <a href='rows.jsonl'>Indexed row outcomes</a> · <a href='rules.json'>Original rules and coverage</a> · <a href='summary.json'>Complete summary</a> · <a href='index.sqlite'>Queryable assessment index</a></p>")
            out.write("<p class='muted'>Counts describe checks over indexed objects. Nested original objects may be checked both within a selected parent and as their own indexed row; source pointers identify these occurrences. No entity matching across editions is implied.</p></body></html>")

    def assess_directory_conformance(self,raw):
        request=typed("conformance_assess",raw)
        with self.mutex:
            plan=self._conformance_plan(request["planId"])
            request_sha=digest({"request":request,"planId":plan["id"],"engine":plan["engine"]})
            for old in self.directory_records("conformanceAssessments"):
                if old["requestSha256"]==request_sha:
                    self._verify_conformance_assessment(old);return old
            if plan["engine"]!=engine_identity():
                raise ConflictError("This plan selected another implementation edition. Preserve its assessment, or save a new plan for the current complete engine.")
            definitions=[self._conformance_definition(r)for r in plan["definitionRefs"]]
            evaluator=rules.HsdsRules(plan["formatPolicy"])if plan["family"]=="hsds-3.3.1"else rules.HsdRules(definitions)
            rule_list=[r for r in evaluator.catalogue()if r["table"]in plan["tables"]]
            header={"schema":VERSION,"workspaceId":self.workspace_id,"planId":plan["id"],"requestSha256":request_sha,
                "subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"],"engine":plan["engine"]}
            with self.scratch()as temp:
                temp=Path(temp);index_path=temp/"index.sqlite";sink=FindingIndex(index_path,header)
                try:
                    coverage=Counter(r["mode"]for r in rule_list)
                    for rule in rule_list:
                        sink.current={"table":rule["table"]}
                        if rule["mode"]=="unevaluated":
                            sink.count("coverage:"+rule["keyword"],"not-evaluated")
                            sink.emit("coverage:"+rule["keyword"],"not-evaluated","",
                                "This original requirement is retained for explicit review or a full standards validator; the selected assertion engine does not evaluate it.",
                                {**rule["source"],"ruleId":rule["id"],"table":rule["table"]},rule["requirement"])
                        elif rule["mode"]=="annotation":sink.count("coverage:"+rule["keyword"],"annotation")
                    sink.current=None
                    populations=Counter()
                    with self.directory_open_index(plan["subjectKind"],plan["subjectId"])as native:
                        for row in self.directory_iter_rows(plan["subjectKind"],plan["subjectId"]):
                            if row["table"]not in plan["tables"]:continue
                            sink.begin(row);populations[row["table"]]+=1
                            if plan["family"]=="hsds-3.3.1":
                                if row["protocol"]!="hsds"or row["table"]not in evaluator.schemas:
                                    sink.count("source-schema-unselected","not-evaluated");sink.emit("source-schema-unselected","not-evaluated","",
                                        "No exact selected HSDS canonical schema applies to this original indexed row.",{"family":plan["family"]},row["table"])
                                elif "headers"in row:evaluator.check_tabular(row,sink.emit,sink.count,sink.unique)
                                else:evaluator.check_json(row["data"],row["table"],sink.emit,sink.count)
                            elif row["protocol"]=="fhir-hsd":evaluator.check(row,sink.emit,sink.count)
                            else:
                                sink.count("source-protocol-unselected","not-evaluated");sink.emit("source-protocol-unselected","not-evaluated","",
                                    "The original indexed row uses another protocol.",{"family":plan["family"]},row["protocol"])
                            self._conformance_native_observations(native,plan,row,sink);sink.end()
                    severities={s:sink.db.execute("SELECT count(*) FROM findings WHERE severity=?",(s,)).fetchone()[0]for s in SEVERITIES}
                    summary={"schema":VERSION,"planId":plan["id"],"requestSha256":request_sha,
                        "selectedRows":sink.row_count,"originalRows":sum(plan["population"].values()),
                        "populations":dict(populations),"findings":sink.finding_count,"severityCounts":severities,
                        "checks":counter_rows(sink.checks),"tableChecks":table_counter_rows(sink.table_checks),
                        "ruleCoverage":dict(coverage),"rules":len(rule_list),"formatPolicy":plan["formatPolicy"],
                        "meaning":"Selected checked assertions and retained unevaluated requirements; no blanket certification or remote completeness claim"}
                    sink.finish(summary)
                    paths={"index":index_path}
                    for kind,sql in (("findings","SELECT body FROM findings ORDER BY ordinal"),("rows","SELECT body FROM rows ORDER BY ordinal")):
                        path=temp/(kind+".jsonl")
                        with writer(path)as out:
                            for row in sink.db.execute(sql):
                                out.write(row[0]+"\n")
                                if out.tell()>MAX_FILE:raise InputError("Complete assessment rows exceed the original file budget")
                        paths[kind]=path
                    paths["rules"]=checked_write(temp/"rules.json",jbytes({"schema":VERSION,"plan":plan,"rules":rule_list}))
                    paths["summary"]=checked_write(temp/"summary.json",jbytes(summary))
                    paths["report"]=temp/"report.html";self._conformance_report(paths["report"],request["label"],plan,summary,sink.db)
                finally:sink.close()
                files={kind:self._directory_retain_file(path,"directory-conformance-"+kind)for kind,path in paths.items()}
                members={kind+"."+EXT[kind]:path for kind,path in paths.items()}
                members["plan.json"]=jbytes(plan)
                members["assessment-request.json"]=jbytes({**header,"request":request,"summary":summary,"files":files})
                if engine_identity()!=plan["engine"]:raise ConflictError("Selected conformance source changed during assessment; preserve the original plan and reopen its exact implementation")
                members.update(self._conformance_source_members(plan))
                package=self._conformance_package(temp/"Conformance_Complete_Originals.zip",members)
                files["package"]=self._directory_retain_file(package,"directory-conformance-complete-package")
                return self._directory_store("conformanceAssessments",{"schema":VERSION,**request,"requestSha256":request_sha,
                    "subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"],"family":plan["family"],
                    "engine":plan["engine"],"summary":summary,"files":files})

    @contextmanager
    def _conformance_index(self,record):
        path=self._directory_file_path(record["files"]["index"])
        db=sqlite3.connect("file:"+quote(str(path),safe="/")+"?mode=ro",uri=True);db.row_factory=sqlite3.Row
        try:
            db.execute("PRAGMA query_only=ON");db.execute("PRAGMA cache_size=-2048")
            header=source.json_value(db.execute("SELECT body FROM metadata WHERE name='header'").fetchone()[0])
            if header["requestSha256"]!=record["requestSha256"]or header["planId"]!=record["planId"]:
                raise InputError("The complete assessment index belongs to another original request")
            yield db
        finally:db.close()

    def _verify_conformance_assessment(self,record):
        self._conformance_plan(record["planId"])
        if set(record["files"])!=set(MEDIA):raise InputError("Receive every complete conformance assessment file")
        for d in record["files"].values():self._directory_file_path(d)
        with self._conformance_index(record)as db:
            if db.execute("PRAGMA quick_check").fetchone()[0]!="ok":raise InputError("The received assessment index is not readable")
            summary=source.json_value(db.execute("SELECT body FROM metadata WHERE name='summary'").fetchone()[0])
            if summary!=record["summary"]:raise InputError("The original complete conformance summary differs from its index")
            if db.execute("SELECT count(*) FROM findings").fetchone()[0]!=summary["findings"]or db.execute("SELECT count(*) FROM rows").fetchone()[0]!=summary["selectedRows"]:
                raise InputError("The complete assessment index counts differ from the original record")
        return record

    def directory_conformance_findings(self,ident,offset=0,limit=50,severity=None,table=None,code=None,source_id=None,record_id=None):
        record=self.directory_record("conformanceAssessments",ident)
        clauses=[];params=[]
        for key,value in (("severity",severity),("table_name",table),("code",code),("source_id",source_id),("record_id",record_id)):
            if value is not None:
                if not isinstance(value,str)or len(value)>1024:raise InputError("Choose exact bounded finding filters")
                if key=="severity"and value not in SEVERITIES:raise InputError("Choose an original finding severity")
                clauses.append(key+"=?");params.append(value)
        return self._conformance_page(record,"findings",clauses,params,offset,limit)

    def directory_conformance_rows(self,ident,offset=0,limit=50,table=None):
        record=self.directory_record("conformanceAssessments",ident)
        if table is not None and(not isinstance(table,str)or len(table)>128):raise InputError("Choose an exact original table")
        return self._conformance_page(record,"rows",["table_name=?"]if table else[],[table]if table else[],offset,limit)

    def _conformance_page(self,record,table,clauses,params,offset,limit):
        source.integer(offset,0,10000000,"Original page offset");source.integer(limit,1,250,"Original page size")
        where=" WHERE "+" AND ".join(clauses)if clauses else""
        with self._conformance_index(record)as db:
            total=db.execute("SELECT count(*) FROM "+table+where,params).fetchone()[0];rows=[];used=0
            for row in db.execute("SELECT body FROM "+table+where+" ORDER BY ordinal LIMIT ? OFFSET ?",params+[limit,offset]):
                size=len(row[0].encode())
                if size>MAX_INTERACTIVE:raise InputError("Open the complete original finding file for this row")
                if used+size>MAX_INTERACTIVE:break
                rows.append(source.json_value(row[0]));used+=size
            nxt=offset+len(rows)
            return {"assessmentId":record["id"],"rows":rows,"total":total,"offset":offset,"limit":limit,
                "nextOffset":nxt if nxt<total else None,"bytes":used,"byteBudget":MAX_INTERACTIVE}

    def directory_conformance_finding(self,ident,finding_id):
        record=self.directory_record("conformanceAssessments",ident);source.identity(finding_id)
        with self._conformance_index(record)as db:
            row=db.execute("SELECT body FROM findings WHERE id=?",(finding_id,)).fetchone()
            if row is None:raise InputError("Choose an exact retained finding from this assessment")
            return source.json_value(row[0])

    def directory_conformance_file(self,kind,ident,file_kind):
        if kind not in {"conformanceAssessments","conformanceReviews","conformanceComparisons"}:
            raise InputError("Select an original conformance assessment, review or comparison")
        record=self.directory_record(kind,ident)
        if file_kind not in record["files"]:raise InputError("Choose a complete declared conformance file")
        d=record["files"][file_kind];path=self._directory_file_path(d)
        return path,{**d,"name":"Directory_"+kind+"_"+ident[:12]+"_"+file_kind+"."+EXT[file_kind],
            "contentType":MEDIA[file_kind]}

    def review_directory_conformance(self,raw):
        request=typed("conformance_review",raw);request.setdefault("decisions",[]);request.setdefault("groups",[]);request.setdefault("predecessorId",None)
        if not request["declaration"].strip():raise InputError("Retain the actual reviewer's coverage and receiving declaration")
        for value in request["decisions"]+request["groups"]:
            if not value["reason"].strip():raise InputError("Every finding disposition requires its original reason")
        individual={d["findingId"]:d for d in request["decisions"]}
        if len(individual)!=len(request["decisions"]):raise InputError("A review repeats a finding ID")
        request_sha=digest(request)
        with self.mutex,self.scratch()as temp:
            assessment=self._verify_conformance_assessment(self.directory_record("conformanceAssessments",request["assessmentId"]))
            for old in self.directory_records("conformanceReviews"):
                if old["requestSha256"]==request_sha:
                    for d in old["files"].values():self._directory_file_path(d)
                    return old
            if request["predecessorId"]:
                predecessor=self.directory_record("conformanceReviews",request["predecessorId"])
                if predecessor["assessmentId"]!=assessment["id"]:raise InputError("A review predecessor must preserve this original assessment")
            plan=self._conformance_plan(assessment["planId"]);temp=Path(temp);path=temp/"findings.jsonl"
            counts=Counter();group_matches=Counter();seen=set()
            with self._conformance_index(assessment)as db,writer(path)as out:
                for row in db.execute("SELECT body FROM findings ORDER BY ordinal"):
                    finding=source.json_value(row[0]);ident=finding["id"];explicit=individual.get(ident)
                    matches=[(i,g)for i,g in enumerate(request["groups"])if finding["code"]==g["code"]
                        and("severity"not in g or g["severity"]==finding["severity"])
                        and("table"not in g or g["table"]==finding["table"])]
                    if explicit:chosen=explicit;chosen_id={"findingId":ident};seen.add(ident)
                    else:
                        if len(matches)>1:raise InputError("Review groups overlap on original finding "+ident+"; select nonoverlapping groups or an explicit finding decision")
                        chosen=matches[0][1]if matches else None;chosen_id={"group":matches[0][0]}if matches else None
                        if matches:group_matches[matches[0][0]]+=1
                    disposition=chosen["disposition"]if chosen else"unreviewed"
                    counts[finding["severity"],disposition]+=1
                    if request["disposition"]=="accept-for-receiving"and finding["severity"]=="error"and disposition not in {"accepted-deviation","not-applicable"}:
                        raise InputError("Accept-for-receiving requires an explicit accepted-deviation or not-applicable decision for every retained error")
                    out.write(source.lexical_json({"findingId":ident,"severity":finding["severity"],"code":finding["code"],
                        "ref":finding["ref"],"decision":chosen,"selection":chosen_id,"disposition":disposition})+"\n")
                    if out.tell()>MAX_FILE:raise InputError("Complete review decisions exceed 1 GiB")
                if seen!=set(individual):raise InputError("A review decision cites a finding outside this immutable assessment")
                if any(i not in group_matches for i in range(len(request["groups"]))):
                    raise InputError("Every review group must match an original finding not already covered by an explicit decision")
            summary={"schema":VERSION,"assessmentId":assessment["id"],"disposition":request["disposition"],
                "counts":[{"severity":s,"disposition":d,"count":n}for(s,d),n in sorted(counts.items())],
                "groupMatches":[{"group":i,"findings":group_matches[i]}for i in range(len(request["groups"]))],
                "originalFindings":assessment["summary"]["findings"],"coverage":assessment["summary"]["ruleCoverage"],
                "declaration":request["declaration"],"meaning":"Reviewer dispositions preserve all original findings and unevaluated requirements"}
            summary_path=checked_write(temp/"summary.json",jbytes(summary));report=temp/"report.html"
            with self._conformance_index(assessment)as db:self._conformance_report(report,request["label"],plan,assessment["summary"],db,{**request,"summary":summary})
            files={k:self._directory_retain_file(p,"directory-conformance-review-"+k)for k,p in {"findings":path,"summary":summary_path,"report":report}.items()}
            package=self._conformance_package(temp/"review.zip",{"report.html":report,"findings.jsonl":path,"summary.json":summary_path,
                "review-request.json":jbytes(request),"assessment.json":jbytes(assessment),
                "assessment-complete-originals.zip":self._directory_file_path(assessment["files"]["package"])})
            files["package"]=self._directory_retain_file(package,"directory-conformance-complete-review")
            return self._directory_store("conformanceReviews",{"schema":VERSION,**request,"requestSha256":request_sha,
                "planId":plan["id"],"subjectKind":plan["subjectKind"],"subjectId":plan["subjectId"],"summary":summary,"files":files})

    def compare_directory_conformance(self,raw):
        request=typed("conformance_compare",raw)
        if not request["scopeNote"].strip():raise InputError("Explain both complete assessment populations")
        request_sha=digest(request)
        with self.mutex,self.scratch()as temp:
            for old in self.directory_records("conformanceComparisons"):
                if old["requestSha256"]==request_sha:
                    for d in old["files"].values():self._directory_file_path(d)
                    return old
            before=self._verify_conformance_assessment(self.directory_record("conformanceAssessments",request["beforeAssessmentId"]))
            after=self._verify_conformance_assessment(self.directory_record("conformanceAssessments",request["afterAssessmentId"]))
            plan_before=self._conformance_plan(before["planId"]);plan_after=self._conformance_plan(after["planId"])
            old={(r["table"],r["code"]):r for r in before["summary"]["tableChecks"]}
            new={(r["table"],r["code"]):r for r in after["summary"]["tableChecks"]}
            rows=[]
            for key in sorted(set(old)|set(new)):
                b={k:old.get(key,{}).get(k,0)for k in OUTCOMES};a={k:new.get(key,{}).get(k,0)for k in OUTCOMES}
                rows.append({"table":key[0],"code":key[1],"before":b,"after":a,"delta":{k:a[k]-b[k]for k in OUTCOMES}})
            summary={"schema":VERSION,"beforeAssessmentId":before["id"],"afterAssessmentId":after["id"],
                "beforePopulation":before["summary"]["populations"],"afterPopulation":after["summary"]["populations"],
                "beforeFamily":before["family"],"afterFamily":after["family"],
                "sameSelectedEngine":before["engine"]==after["engine"],
                "sameProfileAndFormats":plan_before["family"]==plan_after["family"]and plan_before["formatPolicy"]==plan_after["formatPolicy"]and plan_before["definitions"]==plan_after["definitions"],
                "ruleGroups":len(rows),"changedRuleGroups":sum(any(v for v in r["delta"].values())for r in rows),
                "scopeNote":request["scopeNote"],"meaning":"Aggregate rule-outcome comparison over explicitly selected original populations. No entity identity or provider addition/deletion is inferred."}
            temp=Path(temp);row_path=temp/"rows.jsonl"
            with writer(row_path)as out:
                for row in rows:out.write(source.lexical_json(row)+"\n")
            summary_path=checked_write(temp/"summary.json",jbytes(summary));report=temp/"report.html"
            with writer(report)as out:
                out.write(page_top(request["label"])+"<p class='meta'>"+esc(request["scopeNote"])+"</p><pre>"+esc(source.lexical_json(summary))+"</pre>")
                out.write(table_head(["Table","Code","Before","After","Delta"]))
                for row in rows:out.write(table_row([row["table"],row["code"],source.lexical_json(row["before"]),source.lexical_json(row["after"]),source.lexical_json(row["delta"])]))
                out.write("</tbody></table><p><a href='rows.jsonl'>Complete comparison rows</a> · <a href='summary.json'>Original population and scope</a></p></body></html>")
            paths={"rows":row_path,"summary":summary_path,"report":report}
            files={k:self._directory_retain_file(p,"directory-conformance-comparison-"+k)for k,p in paths.items()}
            package=self._conformance_package(temp/"comparison.zip",{
                **{k+"."+EXT[k]:p for k,p in paths.items()},"comparison-request.json":jbytes(request),
                "before-assessment.json":jbytes(before),"after-assessment.json":jbytes(after),
                "before-complete-originals.zip":self._directory_file_path(before["files"]["package"]),
                "after-complete-originals.zip":self._directory_file_path(after["files"]["package"])})
            files["package"]=self._directory_retain_file(package,"directory-conformance-complete-comparison")
            return self._directory_store("conformanceComparisons",{"schema":VERSION,**request,
                "requestSha256":request_sha,"summary":summary,"files":files})

    def _verify_conformance_received(self,registry):
        records=registry["records"]
        for record in records.get("conformancePlans",[]):self._conformance_plan(record["id"])
        for record in records.get("conformanceAssessments",[]):self._verify_conformance_assessment(record)
        for record in records.get("conformanceReviews",[]):
            assessment=self.directory_record("conformanceAssessments",record["assessmentId"])
            if assessment["planId"]!=record["planId"]:raise InputError("The received review belongs to another original plan")
            if record.get("predecessorId"):
                old=self.directory_record("conformanceReviews",record["predecessorId"])
                if old["assessmentId"]!=record["assessmentId"]:raise InputError("The original review predecessor changed")
            for d in record["files"].values():self._directory_file_path(d)
        for record in records.get("conformanceComparisons",[]):
            self.directory_record("conformanceAssessments",record["beforeAssessmentId"])
            self.directory_record("conformanceAssessments",record["afterAssessmentId"])
            for d in record["files"].values():self._directory_file_path(d)
