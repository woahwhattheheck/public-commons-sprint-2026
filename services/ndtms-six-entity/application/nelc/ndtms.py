from __future__ import annotations
"""Source-qualified NDTMS projection inside the original NELC transaction/store."""
import csv, hashlib, html, io, json, re, tempfile, zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from .common import *
from .intake import import_edition, table_in

PROFILE_ID = "ndtms-cds-r-technical-v1.3-20261013"
PROFILE_SHA256 = "decc19db8da3ce80ed7485629b6a8de8230a8c9152ea3e9e98ea1bc039b7f4f4"
PROFILE_PATH = Path(__file__).resolve().parents[1] / "source/ndtms-cds-r-v1.3.json"
ENTITIES = ("client","episode","intervention","sir","top_ypor","cir")
KEYS = {"client":["AGNCY","CLIENTID"],"episode":["AGNCY","CLIENTID","EPISODID"],
        "intervention":["AGNCY","CLIENTID","EPISODID","MODID"],
        "sir":["AGNCY","CLIENTID","EPISODID","SUBMID"],
        "top_ypor":["AGNCY","CLIENTID","EPISODID","TOPID"],
        "cir":["AGNCY","CLIENTID","EPISODID","CIRID"]}
SCOPE_COLUMN = "NDTMS_CONSENT_SCOPE"
NO_CONSENT = {"AGNCY","CLIENTID","EPISODID","CONSENT"}
DDL = (
"""CREATE TABLE IF NOT EXISTS ndtms_entities(
analysis_id TEXT NOT NULL,entity_id TEXT NOT NULL,entity TEXT NOT NULL,
native_key TEXT NOT NULL,consent_scope TEXT NOT NULL,values_json TEXT NOT NULL,
variant_count INTEGER NOT NULL,witness_count INTEGER NOT NULL,
PRIMARY KEY(analysis_id,entity_id))""",
"""CREATE TABLE IF NOT EXISTS ndtms_variants(
analysis_id TEXT NOT NULL,entity_id TEXT NOT NULL,value_sha TEXT NOT NULL,
values_json TEXT NOT NULL,witness_count INTEGER NOT NULL,
PRIMARY KEY(analysis_id,entity_id,value_sha))""",
"""CREATE TABLE IF NOT EXISTS ndtms_witnesses(
analysis_id TEXT NOT NULL,entity_id TEXT NOT NULL,source_row_id TEXT NOT NULL,
ordinal INTEGER NOT NULL,value_sha TEXT NOT NULL,data_json TEXT NOT NULL,
PRIMARY KEY(analysis_id,entity_id,source_row_id))""",
"""CREATE INDEX IF NOT EXISTS ndtms_witness_source ON ndtms_witnesses(analysis_id,source_row_id)""",
"""CREATE INDEX IF NOT EXISTS ndtms_entity_kind ON ndtms_entities(analysis_id,entity,entity_id)""",
"""CREATE TABLE IF NOT EXISTS ndtms_id_owners(
analysis_id TEXT NOT NULL,entity TEXT NOT NULL,agency TEXT NOT NULL,native_id TEXT NOT NULL,
parent_key TEXT NOT NULL,source_row_id TEXT NOT NULL,
PRIMARY KEY(analysis_id,entity,agency,native_id,parent_key))"""
)
COVERAGE = {
 "status":"STRUCTURAL_PROJECTION_ONLY",
 "implemented":["All 290 exact unique headers","Original CSV width, encoding and dialect",
   "Exact opaque native and parent identities","Episode-specific consent and separate minimal client partition",
   "At most one populated child entity per original row","Complete repeated-entity variants and witnesses",
   "Reviewed source-cell corrections","Valid YYYYMMDD calendar dates","Declared character maximums",
   "Unambiguous N integer/decimal shape","Leading/trailing whitespace findings","Explicit extraction scope"],
 "notImplemented":["Complete reference-code lists and sentinel interpretation","Clinical mandatory/conditional rules",
   "Cohort-specific field applicability","Historic field introduction and trigger dates",
   "Clinical date sequencing and intervention-specific exceptions","Completeness of a reporting-year or changed-only extract",
   "Supplier import schema, destination clinical acceptance and statutory submission acceptance"],
 "statement":"Ready means this selected source can be structurally projected. It is not NDTMS, clinical or supplier acceptance."
}

def profile_document():
    require(PROFILE_PATH.is_file() and not PROFILE_PATH.is_symlink(),"NDTMS_PROFILE","The installed complete catalogue is missing.")
    raw=PROFILE_PATH.read_bytes()
    require(hashlib.sha256(raw).hexdigest()==PROFILE_SHA256,"NDTMS_PROFILE_CHANGED","Retain the exact installed primary-source catalogue.")
    profile=json.loads(raw)
    require(profile.get("id")==PROFILE_ID and len(profile.get("fields",[]))==290,
            "NDTMS_PROFILE","The installed catalogue identifies another edition.")
    fields=profile["fields"]
    require([f["ordinal"] for f in fields]==list(range(1,291)) and len({f["header"] for f in fields})==290,
            "NDTMS_PROFILE","Keep all original unique header ordinals.")
    require([r["id"] for r in profile["entity_ranges"]]==list(ENTITIES),"NDTMS_PROFILE","Retain the six original entity ranges.")
    return profile,raw

def _scope(store,db,data):
    require(set(data)=={"editionId","tableId","profileId","cohort","scope"},
            "NDTMS_INPUT","Choose the exact edition, table, profile, cohort and extraction scope.")
    require(data["profileId"]==PROFILE_ID,"NDTMS_PROFILE","Choose the installed current source profile explicitly.")
    cohort=text(data["cohort"],"declared cohort",maximum=100)
    require(cohort in ("adult","young-person","mixed","secure-setting","other-declared"),
            "NDTMS_COHORT","Select adult, young-person, mixed, secure-setting or other-declared.")
    scope=data["scope"]
    require(isinstance(scope,dict) and {"kind","from","to","agency","note"}<=set(scope) and
            set(scope)<={"kind","from","to","agency","note","priorSubmission"},
        "NDTMS_SCOPE","Retain kind, from, to, agency, note and optional original priorSubmission.")
    scope=json.loads(canonical(scope))
    require(scope["kind"] in ("full","reporting","changed-since-prior-submission"),"NDTMS_SCOPE","Select the actual extraction kind.")
    for name in ("from","to"):
        if scope[name] is not None:
            require(isinstance(scope[name],str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",scope[name]),
                    "NDTMS_SCOPE_DATE","Use an exact calendar extraction date or null.")
            try: date.fromisoformat(scope[name])
            except ValueError: raise Problem("NDTMS_SCOPE_DATE","The declared extraction date is not a calendar date.")
    require(scope["from"] is None or scope["to"] is None or scope["from"]<=scope["to"],
            "NDTMS_SCOPE_DATE","The extraction interval is reversed.")
    text(scope["agency"],"agency scope",nonempty=False,maximum=200)
    text(scope["note"],"actual population and scope declaration",maximum=8000)
    if scope["kind"]!="full":
        require(scope["from"] is not None and scope["to"] is not None,"NDTMS_SCOPE_DATE","Declare both actual dates for a partial/changed extraction.")
    prior=scope.get("priorSubmission")
    if scope["kind"]=="changed-since-prior-submission":
        require(prior is not None,"NDTMS_PRIOR_SUBMISSION","Retain the actual prior submission source edition and your explicit source reference; a vendor-return baseline is not submission evidence.")
    if prior is not None:
        require(isinstance(prior,dict) and set(prior)=={"editionId","reference","note"},
                "NDTMS_PRIOR_SUBMISSION","Retain priorSubmission editionId, reference and note.")
        text(prior["reference"],"original prior submission source reference",maximum=4000)
        text(prior["note"],"actual prior submission relationship and limits",maximum=8000)
        require(prior["editionId"]!=data["editionId"],"NDTMS_PRIOR_SUBMISSION","Select the separate retained prior source edition.")
        original=store.get(db,"edition",prior["editionId"])
        store.object(db,original["original"])
        scope["priorSubmission"]={**prior,"original":original["original"],
            "acceptance":"UNCONFIRMED_OPERATOR_SOURCE_REFERENCE"}
    return cohort,scope

def _selection(store,db,edition_id,table_id,signal=None):
    edition=store.get(db,"edition",edition_id);table=table_in(edition,table_id)
    store.object(db,edition["original"],signal);store.object(db,table["object"],signal)
    corrections=store.corrections(db,edition_id,table_id)
    chosen=sorted(corrections.values(),key=lambda c:(c["sourceRow"],c["column"],c["id"]))
    basis={"editionId":edition_id,"tableId":table_id,"original":edition["original"],"tableObject":table["object"],
           "headers":table["headers"],"encoding":table["encoding"],"dialect":table["dialect"],
           "rows":table["rows"],"corrections":chosen}
    return edition,table,corrections,basis,digest(basis)

def _entity_row(row):
    return {"id":row["entity_id"],"entity":row["entity"],"key":json.loads(row["native_key"]),
            "consentScope":row["consent_scope"],"values":json.loads(row["values_json"]) if row["variant_count"]==1 else None,
            "conflicted":row["variant_count"]>1,"variantCount":row["variant_count"],"witnessCount":row["witness_count"]}

def _finding_row(db,row,edition_id,table_id):
    ids=json.loads(row["row_ids_json"]);sources=[]
    for rid in ids:
        original=db.execute("SELECT row_id,ordinal FROM rows WHERE edition_id=? AND table_id=? AND row_id=?",
                            (edition_id,table_id,rid)).fetchone()
        require(original is not None,"NDTMS_FINDING_SOURCE","A finding no longer identifies its original source row.",rid)
        sources.append({"sourceRowId":original["row_id"],"sourceRow":original["ordinal"]})
    return {"id":row["assessment_id"]+"-finding-"+str(row["seq"]),"severity":row["severity"],"code":row["code"],
            "entity":row["mapping_id"],"rowIds":ids,"sourceRows":sources,"details":json.loads(row["details_json"])}

def _findings(db,analysis_id,edition_id=None,table_id=None):
    if edition_id is None:
        saved=db.execute("SELECT data_json FROM records WHERE kind='ndtms-analysis' AND id=?",(analysis_id,)).fetchone()
        require(saved is not None,"NDTMS_FINDING_SOURCE","Retain the original analysis source binding.")
        source=json.loads(saved[0]);edition_id=source["editionId"];table_id=source["tableId"]
    for row in db.execute("SELECT * FROM findings WHERE assessment_id=? ORDER BY seq",(analysis_id,)):
        yield _finding_row(db,row,edition_id,table_id)

def _lineage(db,analysis_id):
    for r in db.execute("SELECT data_json FROM ndtms_witnesses WHERE analysis_id=? ORDER BY entity_id,ordinal,source_row_id",(analysis_id,)):
        yield json.loads(r[0])

def _entities(db,analysis_id):
    for r in db.execute("SELECT * FROM ndtms_entities WHERE analysis_id=? ORDER BY entity,entity_id",(analysis_id,)):
        yield _entity_row(r)

def _retain_lines(store,db,name,rows,signal=None):
    with tempfile.TemporaryFile(dir=store.root) as stream:
        for row in rows:
            check_stop(signal);stream.write((canonical(row)+"\n").encode("utf-8"))
        stream.seek(0)
        return store.put_stream(stream,name,MAX_INPUT_BYTES,signal,db=db)

def _html_report(store,db,analysis_id,summary,signal=None):
    esc=lambda x:html.escape(str(x),quote=True)
    with tempfile.TemporaryFile(dir=store.root) as stream:
        def write(x): stream.write(x.encode("utf-8"))
        write('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NDTMS structural source analysis</title><style>body{font:16px/1.5 system-ui;color:#222;background:#fff;margin:24px}main{max-width:1200px;margin:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{line-height:1.2}@media(max-width:600px){body{margin:12px}table{font-size:13px}}@media print{.scroll{overflow:visible}tr{break-inside:avoid}table{font-size:10px}}</style><main><h1>NDTMS structural source analysis</h1>')
        write("<p>"+esc(COVERAGE["statement"])+"</p><h2>Frozen source and population</h2><pre>"+esc(json.dumps(summary,ensure_ascii=False,indent=2))+"</pre>")
        write("<h2>Coverage</h2><pre>"+esc(json.dumps(COVERAGE,ensure_ascii=False,indent=2))+"</pre>")
        write('<h2>Complete findings</h2><div class="scroll"><table><thead><tr><th>Severity / code</th><th>Source rows</th><th>Details</th></tr></thead><tbody>')
        for row in _findings(db,analysis_id,summary["editionId"],summary["tableId"]):
            check_stop(signal)
            write("<tr><td>"+esc(row["severity"]+" / "+row["code"])+"</td><td>"+esc(", ".join(row["rowIds"]))+"</td><td><pre>"+esc(json.dumps(row["details"],ensure_ascii=False,indent=2))+"</pre></td></tr>")
        write("</tbody></table></div><h2>Preserved source</h2><p>Full original bytes, every original row witness, every conflicting variant, effective corrected values, all correction identities and the exact catalogue are retained in the analysis artifacts. The six-table edition is an explicitly declared adapter schema. It does not claim to be a vendor import template.</p></main></html>")
        stream.seek(0);return store.put_stream(stream,"NDTMS_Analysis.html",MAX_INPUT_BYTES,signal,db=db)

def analyse_ndtms(store,db,data,ctx):
    cohort,scope=_scope(store,db,data)
    profile,profile_raw=profile_document()
    edition,table,corrections,basis,selection_sha=_selection(store,db,data["editionId"],data["tableId"],ctx["signal"])
    analysis_id="ndtms-analysis-"+digest({"requestId":ctx["requestId"],"selection":selection_sha,"profile":PROFILE_SHA256,"cohort":cohort,"scope":scope})[:28]
    for sql in DDL: db.execute(sql)
    fields=profile["fields"];expected=[f["header"] for f in fields];headers=table["headers"]
    expected_set=set(expected)
    header_counts=Counter(headers);indices={h:headers.index(h) for h in expected if header_counts[h]==1}
    group_headers={entity:[f["header"] for f in fields if f["entity"]==entity] for entity in ENTITIES}
    by_row={}
    for (tid,rid,index),correction in corrections.items(): by_row.setdefault(rid,[]).append(correction["id"])
    count=Counter();finding_counts=Counter();seq=0
    def finding(code,details,row_ids=(),entity=None,severity="error"):
        nonlocal seq
        seq+=1;finding_counts[severity]+=1
        db.execute("INSERT INTO findings VALUES(?,?,?,?,?,?,?)",
                   (analysis_id,seq,severity,code,entity,canonical(list(row_ids)),canonical(details)))
    missing=[h for h in expected if not header_counts[h]]
    duplicate=[h for h,n in header_counts.items() if n>1]
    extensions=[h for h in headers if h not in expected_set]
    if missing: finding("MISSING_HEADERS",{"headers":missing})
    if duplicate: finding("DUPLICATE_HEADERS",{"headers":duplicate})
    if extensions: finding("EXTENSION_HEADERS",{"headers":extensions,"meaning":"Preserved in the original input and witnesses; not silently assigned to a native entity."},severity="warning")
    if headers[:290]!=expected and not missing and not duplicate:
        finding("HEADER_ORDER",{"meaning":"Header-name binding is explicit; original physical order remains retained."},severity="warning")
    finding("CLINICAL_RULES_UNCONFIRMED",{"coverage":COVERAGE["notImplemented"]},severity="warning")
    if scope["kind"]!="full":
        finding("POPULATION_COMPLETENESS_UNCONFIRMED",{"scope":scope,"meaning":"No completeness or deletion inference from this selected slice."},severity="warning")
    def claim_id(entity,native,source_id):
        if entity=="client": return
        own_key=canonical(native[:-1]);agency=native[0];native_id=native[-1]
        owners=db.execute("SELECT parent_key,source_row_id FROM ndtms_id_owners WHERE analysis_id=? AND entity=? AND agency=? AND native_id=?",
                          (analysis_id,entity,agency,native_id)).fetchall()
        for owner in owners:
            if owner["parent_key"]!=own_key:
                finding("NATIVE_ID_REUSED_ACROSS_PARENTS",{"nativeId":native_id,"originalParent":json.loads(owner["parent_key"]),"otherParent":native[:-1]},[owner["source_row_id"],source_id],entity)
        db.execute("INSERT OR IGNORE INTO ndtms_id_owners VALUES(?,?,?,?,?,?)",(analysis_id,entity,agency,native_id,own_key,source_id))
    for row in db.execute("SELECT * FROM rows WHERE edition_id=? AND table_id=? ORDER BY ordinal",(edition["id"],table["id"])):
        check_stop(ctx["signal"]);count["sourceRows"]+=1
        raw=json.loads(row["cells_json"]);effective=store.effective_cells(row,corrections);rid=row["row_id"]
        original_proof=digest({"sourceSha256":table["object"]["sha256"],"sourceRow":row["ordinal"],"values":raw})
        require(original_proof==row["sha256"],"SOURCE_ROW_HASH","The selected original row no longer matches its source proof.",rid)
        if len(raw)!=len(headers):
            finding("ROW_WIDTH",{"record":row["ordinal"],"columns":len(raw),"headers":len(headers)},[rid])
            continue
        if missing or duplicate: continue
        values={h:effective[i] for h,i in indices.items()}
        consent=values["CONSENT"]
        if consent not in ("Y","N"):
            finding("CONSENT_VALUE",{"value":consent,"meaning":"Select an actual Y/N source value through the existing reviewed correction workflow."},[rid],"episode")
            continue
        if scope["agency"] and values["AGNCY"]!=scope["agency"]:
            finding("AGENCY_SCOPE_MISMATCH",{"declared":scope["agency"],"actual":values["AGNCY"]},[rid])
        missing_keys=[h for h in KEYS["episode"] if not values[h]]
        if missing_keys:
            finding("REQUIRED_NATIVE_ID",{"fields":missing_keys},[rid]);continue
        child_groups=[e for e in ENTITIES[2:] if any(values[h] for h in group_headers[e])]
        if len(child_groups)>1:
            finding("MULTIPLE_CHILD_GROUPS",{"entities":child_groups},[rid])
        if consent=="N":
            count["noConsentRows"]+=1
            forbidden=[h for h in headers if h not in NO_CONSENT and effective[headers.index(h)]!=""]
            if forbidden:
                finding("NO_CONSENT_PROTECTED_VALUES",{"fields":forbidden,"meaning":"Retained original only; protected values cannot enter the minimal projection."},[rid],"episode")
        else: count["consentedRows"]+=1
        for field in fields:
            h=field["header"];value=values[h]
            if not value: continue
            if value!=value.strip(): finding("CELL_WHITESPACE",{"field":h,"value":value},[rid],field["entity"])
            layout=field["layout"]
            width=re.fullmatch(r"[AC]\((?:max)?([0-9]+)\)",layout)
            if width and len(value)>int(width.group(1)):
                finding("CHARACTER_MAXIMUM",{"field":h,"layout":layout,"characters":len(value)},[rid],field["entity"])
            if layout=="YYYYMMDD":
                try:
                    require(bool(re.fullmatch(r"[0-9]{8}",value)),"DATE_VALUE","Invalid date")
                    date(int(value[:4]),int(value[4:6]),int(value[6:]))
                except (ValueError,Problem):
                    finding("CALENDAR_DATE",{"field":h,"value":value},[rid],field["entity"])
            numeric=re.fullmatch(r"N\(([0-9]+)(?:,([0-9]+))?\)",layout)
            if numeric:
                # Validate lexical numeric shape; reference-code meanings and clinical ranges remain unconfirmed.
                digits,fraction=numeric.groups()
                pattern=r"[0-9]+" if fraction is None else r"[0-9]+(?:\.[0-9]{1,"+fraction+r"})?"
                if not re.fullmatch(pattern,value):
                    finding("NUMERIC_SHAPE",{"field":h,"layout":layout,"value":value},[rid],field["entity"])
        entity_list=["client","episode"]+(child_groups if consent=="Y" else [])
        for entity in entity_list:
            native=[values[h] for h in KEYS[entity]]
            if any(v=="" for v in native):
                finding("CHILD_ID_REQUIRED",{"entity":entity,"identityFields":KEYS[entity]},[rid],entity);continue
            claim_id(entity,native,rid)
            selected={h:values[h] for h in dict.fromkeys(KEYS[entity]+group_headers[entity])}
            if consent=="N": selected={h:(v if h in NO_CONSENT else "") for h,v in selected.items()}
            selected[SCOPE_COLUMN]=consent
            entity_id="ndtms-row-"+digest({"entity":entity,"key":native,"consentScope":consent if entity=="client" else None})[:28]
            value_sha=digest(selected)
            current=db.execute("SELECT * FROM ndtms_entities WHERE analysis_id=? AND entity_id=?",(analysis_id,entity_id)).fetchone()
            variant=db.execute("SELECT * FROM ndtms_variants WHERE analysis_id=? AND entity_id=? AND value_sha=?",(analysis_id,entity_id,value_sha)).fetchone()
            if not current:
                db.execute("INSERT INTO ndtms_entities VALUES(?,?,?,?,?,?,?,?)",
                           (analysis_id,entity_id,entity,canonical(native),consent,canonical(selected),1,1))
            else:
                db.execute("UPDATE ndtms_entities SET witness_count=witness_count+1,variant_count=variant_count+? WHERE analysis_id=? AND entity_id=?",
                           (0 if variant else 1,analysis_id,entity_id))
                if not variant:
                    first=db.execute("SELECT source_row_id FROM ndtms_witnesses WHERE analysis_id=? AND entity_id=? ORDER BY ordinal LIMIT 1",(analysis_id,entity_id)).fetchone()
                    finding("REPEATED_ENTITY_CONFLICT",{"entityRowId":entity_id,"key":native,"previousVariants":current["variant_count"],"incomingValueSha256":value_sha},[first[0],rid],entity)
                else: count["repeatedEqualWitnesses"]+=1
            if variant:
                db.execute("UPDATE ndtms_variants SET witness_count=witness_count+1 WHERE analysis_id=? AND entity_id=? AND value_sha=?",(analysis_id,entity_id,value_sha))
            else:
                db.execute("INSERT INTO ndtms_variants VALUES(?,?,?,?,?)",(analysis_id,entity_id,value_sha,canonical(selected),1))
            applied=by_row.get(rid,[])
            witness={"entityRowId":entity_id,"entity":entity,"key":native,"consentScope":consent,
                     "sourceRowId":rid,"sourceRow":row["ordinal"],"rawSha256":row["sha256"],
                     "sourceSha256":table["object"]["sha256"],"effectiveSha256":digest(effective),
                     "correctionIds":sorted(applied),"variantSha256":value_sha,"projectedValues":selected,
                     "extensionValues":{h:effective[i] for i,h in enumerate(headers) if h not in expected_set}}
            db.execute("INSERT INTO ndtms_witnesses VALUES(?,?,?,?,?,?)",(analysis_id,entity_id,rid,row["ordinal"],value_sha,canonical(witness)))
    totals={e:db.execute("SELECT count(*) FROM ndtms_entities WHERE analysis_id=? AND entity=?",(analysis_id,e)).fetchone()[0] for e in ENTITIES}
    count["nativeClients"]=db.execute("SELECT count(DISTINCT native_key) FROM ndtms_entities WHERE analysis_id=? AND entity='client'",(analysis_id,)).fetchone()[0]
    count["clientPartitionRows"]=totals["client"]
    count["conflictedEntities"]=db.execute("SELECT count(*) FROM ndtms_entities WHERE analysis_id=? AND variant_count>1",(analysis_id,)).fetchone()[0]
    count["witnesses"]=db.execute("SELECT count(*) FROM ndtms_witnesses WHERE analysis_id=?",(analysis_id,)).fetchone()[0]
    if sum(totals.values())>MAX_ROWS:
        finding("PROJECTED_ROW_LIMIT",{"rows":sum(totals.values()),"limit":MAX_ROWS,"meaning":"The original edition importer accepts at most this many rows across all six tables."})
    if not count["sourceRows"]: finding("EMPTY_POPULATION",{"meaning":"A header-only extract has no selected operational population."},severity="warning")
    counts={**{k:count[k] for k in ("sourceRows","nativeClients","clientPartitionRows","consentedRows","noConsentRows","repeatedEqualWitnesses","conflictedEntities","witnesses")},"entities":totals}
    ready=finding_counts["error"]==0
    profile_ref=store.put_bytes(profile_raw,"NDTMS_CDS_R_Profile.json",db=db,signal=ctx["signal"])
    def original_rows():
        for original_row in db.execute("SELECT * FROM rows WHERE edition_id=? AND table_id=? ORDER BY ordinal",(edition["id"],table["id"])):
            check_stop(ctx["signal"])
            yield {"sourceRowId":original_row["row_id"],"sourceRow":original_row["ordinal"],
                   "rawSha256":original_row["sha256"],"values":json.loads(original_row["cells_json"]),
                   "effectiveValues":store.effective_cells(original_row,corrections),
                   "correctionIds":sorted(by_row.get(original_row["row_id"],[]))}
    artifacts={"sourceRows":_retain_lines(store,db,"NDTMS_Original_And_Corrected_Rows.jsonl",original_rows(),ctx["signal"]),
       "profile":profile_ref,"original":edition["original"],"tableOriginal":table["object"],
       "entities":_retain_lines(store,db,"NDTMS_Entities.jsonl",_entities(db,analysis_id),ctx["signal"]),
       "lineage":_retain_lines(store,db,"NDTMS_Lineage.jsonl",_lineage(db,analysis_id),ctx["signal"]),
       "findings":_retain_lines(store,db,"NDTMS_Findings.jsonl",_findings(db,analysis_id,edition["id"],table["id"]),ctx["signal"])}
    summary={"analysisId":analysis_id,"editionId":edition["id"],"tableId":table["id"],"profileId":PROFILE_ID,
             "profileSha256":PROFILE_SHA256,"selectionSha256":selection_sha,"cohort":cohort,"scope":scope,"ready":ready,"counts":counts,"findingCounts":dict(finding_counts)}
    manifest={"schema":"nelc.ndtms-projection-manifest/v1",**summary,"selection":basis,"coverage":COVERAGE,
              "generatedFields":[{"name":SCOPE_COLUMN,"meaning":"Adapter privacy partition, not an issued NDTMS or vendor field.","values":["Y","N"]}],
              "nativeKeys":KEYS,"clientProjectionKey":["AGNCY","CLIENTID",SCOPE_COLUMN],
              "episodeClientReference":["AGNCY","CLIENTID",SCOPE_COLUMN],
              "entityColumns":{e:list(dict.fromkeys(KEYS[e]+group_headers[e]+[SCOPE_COLUMN])) for e in ENTITIES},
              "artifacts":artifacts}
    artifacts["manifest"]=store.put_bytes((canonical(manifest)+"\n").encode("utf-8"),"NDTMS_Manifest.json",db=db,signal=ctx["signal"])
    artifacts["report"]=_html_report(store,db,analysis_id,summary,ctx["signal"])
    record={"schema":"nelc.ndtms-analysis/v1","name":"NDTMS structural projection — "+edition["name"],**summary,
            "sourceSelection":basis,"coverage":COVERAGE,"artifacts":artifacts,"createdAt":ctx["at"],"actor":ctx["actor"]}
    db.execute("INSERT INTO records VALUES(?,?,?,?)",("ndtms-analysis",analysis_id,canonical(record),ctx["revision"]))
    return {**record,"id":analysis_id}

def ndtms_page(store,db,kind,selection,offset,limit):
    analysis=store.get(db,"ndtms-analysis",selection.get("analysisId"));aid=analysis["id"]
    if kind=="ndtms-findings":
        clauses=["assessment_id=?"];args=[aid]
        for name in ("severity","code"):
            if selection.get(name) is not None: clauses.append(name+"=?");args.append(text(selection[name],name,maximum=100))
        where=" AND ".join(clauses)
        total=db.execute("SELECT count(*) FROM findings WHERE "+where,args).fetchone()[0]
        rows=db.execute("SELECT * FROM findings WHERE "+where+" ORDER BY seq LIMIT ? OFFSET ?",args+[limit,offset]).fetchall()
        items=[_finding_row(db,r,analysis["editionId"],analysis["tableId"]) for r in rows]
    elif kind=="ndtms-rows":
        clauses=["analysis_id=?"];args=[aid]
        if selection.get("entity") is not None:
            require(selection["entity"] in ENTITIES,"NDTMS_ENTITY","Choose an original entity.");clauses.append("entity=?");args.append(selection["entity"])
        where=" AND ".join(clauses);total=db.execute("SELECT count(*) FROM ndtms_entities WHERE "+where,args).fetchone()[0]
        rows=db.execute("SELECT * FROM ndtms_entities WHERE "+where+" ORDER BY entity,entity_id LIMIT ? OFFSET ?",args+[limit,offset]).fetchall()
        items=[_entity_row(r) for r in rows]
    else:
        clauses=["w.analysis_id=?"];args=[aid]
        for name,column_name in (("entityRowId","w.entity_id"),("sourceRowId","w.source_row_id"),("entity","e.entity")):
            if selection.get(name) is not None: clauses.append(column_name+"=?");args.append(text(selection[name],name,maximum=160))
        where=" AND ".join(clauses)
        join=" FROM ndtms_witnesses w JOIN ndtms_entities e ON e.analysis_id=w.analysis_id AND e.entity_id=w.entity_id WHERE "+where
        total=db.execute("SELECT count(*)"+join,args).fetchone()[0]
        items=[json.loads(r[0]) for r in db.execute("SELECT w.data_json"+join+" ORDER BY w.entity_id,w.ordinal,w.source_row_id LIMIT ? OFFSET ?",args+[limit,offset])]
    return {"analysisId":aid,"items":items,"total":total,"offset":offset,"nextOffset":offset+len(items) if offset+len(items)<total else None}

def verify_ndtms(store,db,signal=None):
    total=0
    for row in db.execute("SELECT id,data_json FROM records WHERE kind='ndtms-analysis' ORDER BY id"):
        value=json.loads(row["data_json"]);aid=row["id"]
        for name,rows in (("entities",_entities(db,aid)),("lineage",_lineage(db,aid)),("findings",_findings(db,aid))):
            h=hashlib.sha256();size=0
            for item in rows:
                check_stop(signal);body=(canonical(item)+"\n").encode("utf-8");h.update(body);size+=len(body)
            expected=value["artifacts"][name]
            require((h.hexdigest(),size)==(expected["sha256"],expected["bytes"]),
                    "NDTMS_INDEX_CHANGED","A retained projection index differs from its complete immutable artifact.",{"analysisId":aid,"index":name})
        total+=1
    return total

def publish_ndtms(store,db,data,ctx):
    require(set(data)=={"analysisId"},"NDTMS_PUBLISH","Select the original analysis only.")
    analysis=store.get(db,"ndtms-analysis",data["analysisId"])
    require(analysis["ready"],"NDTMS_NOT_READY","Resolve structural findings through original source corrections, then analyse the new selection.")
    edition,table,corrections,basis,current=_selection(store,db,analysis["editionId"],analysis["tableId"],ctx["signal"])
    require(current==analysis["selectionSha256"],"NDTMS_SOURCE_STALE","The selected source corrections changed after this analysis; keep the original analysis and create its successor.")
    verify_ndtms(store,db,ctx["signal"])
    manifest_ref=analysis["artifacts"]["manifest"]
    manifest=json.loads(store.object(db,manifest_ref,ctx["signal"]).read_text("utf-8"))
    require(manifest["analysisId"]==analysis["id"] and manifest["selectionSha256"]==current,"NDTMS_MANIFEST","The retained complete projection manifest differs.")
    # The complete archive is streamed to a private temporary file; only the original
    # immutable object and import_edition transaction publish it.
    with tempfile.TemporaryFile(dir=store.root) as stream:
        with zipfile.ZipFile(stream,"w",compression=zipfile.ZIP_DEFLATED) as archive:
            for entity in ENTITIES:
                headers=manifest["entityColumns"][entity]
                info=zipfile.ZipInfo("tables/"+entity+".csv",(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100600<<16
                with archive.open(info,"w") as binary:
                    wrapper=io.TextIOWrapper(binary,encoding="utf-8-sig",newline="",write_through=True)
                    writer=csv.writer(wrapper,lineterminator="\r\n");writer.writerow(headers)
                    for row in db.execute("SELECT values_json FROM ndtms_entities WHERE analysis_id=? AND entity=? ORDER BY entity_id",(analysis["id"],entity)):
                        check_stop(ctx["signal"]);values=json.loads(row[0]);writer.writerow([values[h] for h in headers])
                    wrapper.flush();wrapper.detach()
            for name,ref in analysis["artifacts"].items():
                # Original CSV/ZIP bytes retain their exact identity in object custody.
                # .bin avoids re-importing the denormalized originals as a seventh table.
                member="originals/"+name+".bin" if name in ("original","tableOriginal") else "analysis/"+ref["name"]
                info=zipfile.ZipInfo(member,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100600<<16
                with store.object(db,ref,ctx["signal"]).open("rb") as source,archive.open(info,"w") as target:
                    while True:
                        check_stop(ctx["signal"]);chunk=source.read(1024*1024)
                        if not chunk:break
                        target.write(chunk)
        stream.seek(0);archive_ref=store.put_stream(stream,"NDTMS_Six_Entity_Source.zip",MAX_INPUT_BYTES,ctx["signal"],db=db)
    received=import_edition(store,db,{"name":"NDTMS six-entity projection — "+edition["name"],"object":archive_ref,
        "csv":{"default":{"encoding":"utf-8-sig","delimiter":",","quotechar":'"'}},
        "source":{"kind":"ndtms-reviewed-structural-projection","analysisId":analysis["id"],"sourceEditionId":edition["id"],
                  "sourceTableId":table["id"],"selectionSha256":current,"profileSha256":PROFILE_SHA256,
                  "scope":analysis["scope"],"cohort":analysis["cohort"],"nativeAcceptance":"UNCONFIRMED",
                  "consentPartition":"Generated NDTMS_CONSENT_SCOPE joins limited and consented client projections separately."}},ctx)
    return {"analysisId":analysis["id"],"edition":received,"manifest":manifest_ref,"archive":archive_ref,
            "next":"Use the existing explicit reviewed target contract. This projection does not approve a supplier or clinical submission."}
