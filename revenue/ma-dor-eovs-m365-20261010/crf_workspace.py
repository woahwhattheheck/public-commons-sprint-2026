"""CRF reporting inside the existing immutable Store, journal and portable receiver."""
from __future__ import annotations
import csv
import hashlib
import io
import json
from collections import Counter
from migration_store import MigrationError, identity, canonical, parse_json, text, digest, identifier, page, basename
from financial_domain import unique_pairs
from property_workspace import file_refs, with_evidence_cache
import crf_domain as domain
import crf_workbook as workbook

KINDS=tuple("crf."+name for name in ("contract","dataset","edition","comparison","review","workbook_binding","workbook_output","workbook_return"))
MUTATIONS=tuple(kind+".create" for kind in KINDS)
READS=("crf.schema","crf.preview","crf.list","crf.get","crf.rows","crf.verify","crf.request_status","crf.workbook_preview")
MAX_SOURCE_BYTES=64*1024*1024
SECTIONS={"crf.contract":(),"crf.dataset":("rows",),"crf.edition":("metrics","checks","lineage"),
          "crf.comparison":("changes","metrics"),"crf.review":("decisions",),"crf.workbook_binding":("cells",),
          "crf.workbook_output":("inputs","workbook_lineage","member_manifest","numeric_precision_warnings"),
          "crf.workbook_return":("inputs","checks","unbound_cell_changes","part_changes","formula_caches","validation_evidence","member_manifest")}
DDL="""CREATE TABLE IF NOT EXISTS crf_items(
 owner_id TEXT NOT NULL,section TEXT NOT NULL,ordinal INTEGER NOT NULL,status TEXT,body_json TEXT NOT NULL,
 PRIMARY KEY(owner_id,section,ordinal));
CREATE INDEX IF NOT EXISTS crf_items_status ON crf_items(owner_id,section,status,ordinal);"""

def ensure(store):
    store.conn.executescript(DDL)

def schema():
    return {"schema":domain.SCHEMA,"kinds":list(KINDS),"mutations":list(MUTATIONS),"reads":list(READS),
            "fields":domain.FIELDS,"required":domain.REQUIRED,"categories":domain.CATEGORIES,"periods":domain.PERIODS,
            "formats":["csv","json-table"],"maximum_source_bytes":MAX_SOURCE_BYTES,
            "mapping":{"direct":"actual_column","reviewed_translation":{"column":"actual_column","values":[{"source":{"kind":"string","value":"Y"},"target":True}]}},
            "review_dispositions":["open","explained","corrected"],
            "population_contract":"An application row is an explicit awarded/refused/pending reporting unit, including non-application routes. One awarded reporting unit links to one award row; instalments and split spend belong in allocations and payment controls. This is a reviewed reporting mapping, not an assumed vendor API schema.",
            "rule_source":domain.RULES,"workbook_binding_example":workbook.binding_example(),
            "meaning":"Crisis support plus actual supplied other-strand inputs; complete workbook compliance, signatures and DWP receipt remain separate actual events."}

def payload(op,fields):
    p=op["request"]
    domain.require(not set(p)-set(fields)-{"operation_id","actor","expected_revision"},"CRF_REQUEST","Unknown CRF request fields.")
    return p

def base(op,kind,title):
    return {"schema":domain.SCHEMA,"id":kind.replace(".","-")+"-"+identity({"op":op["id"],"sha":op["request_sha256"]})[:40],
            "kind":kind,"title":text(title,"title"),"operation_id":op["id"],"created_at":op["created_at"],
            "created_revision":op["reserved_revision"],"actor":op["actor"]}

def get(store,kind,record_id):
    domain.require(kind in KINDS,"CRF_KIND","Select an advertised retained CRF record.")
    return store.get_entity(kind,record_id)

def records(store,kind,before=None):
    sql,args="SELECT body_json FROM entities WHERE kind=?",[kind]
    if before is not None:sql+=" AND created_revision<?";args.append(before)
    for row in store.conn.execute(sql+" ORDER BY created_revision,id",args):yield parse_json(row[0])

def previous(store,kind,parent_id,scope,op,unique=False):
    matching=[r for r in records(store,kind,op["reserved_revision"]) if all(r.get(k)==v for k,v in scope.items())]
    if parent_id is None:
        domain.require(not unique or not matching,"CRF_PARENT_REQUIRED","Select the current original head instead of forking this decision chain.")
        return None
    old=get(store,kind,parent_id)
    domain.require(old["created_revision"]<op["reserved_revision"] and all(old.get(k)==v for k,v in scope.items()),
                   "CRF_PARENT_SCOPE","The selected parent belongs to this original scope and predates this operation.")
    domain.require(not any(r.get("parent_id")==parent_id for r in records(store,kind,op["reserved_revision"])),
                   "CRF_HEAD","Select the current original head.")
    return old

def descends(store,kind,candidate,original):
    seen=set()
    while candidate:
        if candidate==original:return True
        domain.require(candidate not in seen,"CRF_ANCESTRY","Original ancestry contains a cycle.");seen.add(candidate)
        candidate=get(store,kind,candidate).get("parent_id")
    return False

def rows(store,record_id,section):
    for row in store.conn.execute("SELECT body_json FROM crf_items WHERE owner_id=? AND section=? ORDER BY ordinal",(record_id,section)):
        yield parse_json(row[0])

def read_bytes(store,sha,limit=MAX_SOURCE_BYTES):
    info=store.file_info(digest(sha))
    domain.require(info["bytes"]<=limit,"CRF_SOURCE_SIZE","The complete source exceeds the advertised byte allowance.")
    with store.open_file(sha) as stream:raw=stream.read(limit+1)
    domain.require(len(raw)==info["bytes"],"CRF_FILE_LENGTH","The complete retained source length differs.")
    return info,raw

def reviewed(store,value):
    domain.review(value)
    return file_refs(store,value["evidence_files"],required=True)

def original_source(store,p):
    info,raw=read_bytes(store,p.get("file_sha256"))
    columns,original=domain.original_rows(raw,p.get("format"),p.get("dialect",{}))
    return info,columns,original

def preview(store,p):
    contract=get(store,"crf.contract",p.get("contract_id"))
    domain.require(p.get("family") in domain.FIELDS,"CRF_FAMILY","Select a source family.")
    info,columns,original=original_source(store,p)
    return {"contract_id":contract["id"],"family":p["family"],"sha256":info["sha256"],"bytes":info["bytes"],
            "columns":columns,"row_count":len(original),"sample":[{"raw":r,"raw_types":{k:domain.original_kind(v) for k,v in r.items()}} for r in original[:5]],
            "preview_only":True}

def selected_sources(store,edition):
    return {family:{"dataset":get(store,"crf.dataset",record_id),"rows":list(rows(store,record_id,"rows"))}
            for family,record_id in edition["families"].items()}

def edition_value(store,edition):
    return {**edition["report"],"metrics":list(rows(store,edition["id"],"metrics")),"checks":list(rows(store,edition["id"],"checks"))}

def binding_values(store,binding,edition):
    domain.require(binding["contract_id"]==edition["contract_id"],"CRF_WORKBOOK_SCOPE","Select a workbook binding for this exact reporting contract.")
    metrics={r["id"]:r for r in rows(store,edition["id"],"metrics")}
    values={}
    for key,source in binding["value_sources"].items():
        if "literal" in source:values[key]=source["literal"]
        else:
            item=metrics.get(source["metric_id"])
            domain.require(item is not None and item["status"]=="COMPLETE","CRF_WORKBOOK_METRIC","Select complete original metrics from this exact edition.",metric_id=source["metric_id"])
            values[key]={"type":"number" if item["type"] in ("count","money") else "text","value":str(item["value"])}
    return values

def compute(store,op,emit,*,stage=False):
    kind=op["operation"].removesuffix(".create")
    p=op["request"];body=base(op,kind,p.get("title"))
    if kind=="crf.contract":
        p=payload(op,("title","contract","parent_id"))
        contract=domain.validate_contract(p.get("contract"));evidence=reviewed(store,contract["review"])
        old=previous(store,kind,p.get("parent_id"),{"scope_id":contract["scope_id"]},op,unique=True)
        body.update(contract=contract,contract_sha256=identity(contract),scope_id=contract["scope_id"],
                    parent_id=old["id"] if old else None,evidence_files=evidence)
    elif kind=="crf.dataset":
        p=payload(op,("title","contract_id","family","file_sha256","filename","format","dialect","mapping","context","parent_id"))
        contract=get(store,"crf.contract",p.get("contract_id"));family=p.get("family")
        domain.require(family in domain.FIELDS,"CRF_FAMILY","Select a source family.")
        context=domain.validate_context(p.get("context"));evidence=reviewed(store,context["review"])
        info,columns,original=original_source(store,p)
        mapping=domain.validate_mapping(p.get("mapping"),columns,family)
        normalized=domain.normalize(original,mapping,family)
        old=previous(store,kind,p.get("parent_id"),{"contract_id":contract["id"],"family":family},op)
        for row in normalized:emit("rows",row)
        body.update(contract_id=contract["id"],scope_id=contract["scope_id"],family=family,
                    file_sha256=info["sha256"],bytes=info["bytes"],filename=basename(p.get("filename")),
                    format=p["format"],dialect=p.get("dialect",{}),columns=columns,mapping=mapping,context=context,
                    row_count=len(normalized),issue_count=sum(bool(r["issues"]) for r in normalized),evidence_files=evidence,
                    parent_id=old["id"] if old else None)
    elif kind=="crf.edition":
        p=payload(op,("title","contract_id","period","dataset_ids","note","parent_id"))
        contract=get(store,"crf.contract",p.get("contract_id"));period=p.get("period")
        domain.require(period in domain.PERIODS,"CRF_PERIOD","Select the interim or cumulative annual reporting period.")
        ids=p.get("dataset_ids")
        domain.require(isinstance(ids,list) and len(ids)==len(set(ids)) and len(ids)==len(domain.FIELDS),
                       "CRF_DATASETS","Select exactly one complete retained dataset per source family.")
        selected={}
        for record_id in ids:
            dataset=get(store,"crf.dataset",record_id)
            domain.require(dataset["contract_id"]==contract["id"] and dataset["family"] not in selected,
                           "CRF_DATASET_SCOPE","Select each family once from this exact contract.")
            selected[dataset["family"]]={"dataset":dataset,"rows":list(rows(store,record_id,"rows"))}
        old=previous(store,kind,p.get("parent_id"),{"contract_id":contract["id"],"period":period},op)
        if old:
            for family,item in selected.items():
                domain.require(descends(store,"crf.dataset",item["dataset"]["id"],old["families"][family]),
                               "CRF_DATASET_ANCESTRY","A corrected edition retains each earlier source or its explicit descendant.")
        report=domain.calculate(contract["contract"],period,selected,emit)
        for section in ("metrics","checks"):
            for row in report[section]:emit(section,row)
        report={k:v for k,v in report.items() if k not in ("metrics","checks","lineage")}
        body.update(contract_id=contract["id"],scope_id=contract["scope_id"],period=period,
                    families={family:item["dataset"]["id"] for family,item in selected.items()},dataset_ids=ids,
                    note=text(p.get("note"),"edition note"),parent_id=old["id"] if old else None,report=report)
    elif kind=="crf.comparison":
        p=payload(op,("title","earlier_id","later_id","note"))
        earlier=get(store,"crf.edition",p.get("earlier_id"));later=get(store,"crf.edition",p.get("later_id"))
        domain.require(earlier["contract_id"]==later["contract_id"],"CRF_COMPARISON_SCOPE","Compare editions of the same original reporting contract.")
        result=domain.compare(edition_value(store,earlier),edition_value(store,later),selected_sources(store,earlier),selected_sources(store,later))
        for section in ("changes","metrics"):
            for row in result[section]:emit(section,row)
        body.update(contract_id=earlier["contract_id"],earlier_id=earlier["id"],later_id=later["id"],
                    earlier_period=earlier["period"],later_period=later["period"],same_reporting_period=earlier["period"]==later["period"],
                    note=text(p.get("note"),"comparison note"),counts=result["counts"],
                    meaning="Full retained source and metric differences. A later annual period is cumulative, not added to the interim totals.")
    elif kind=="crf.review":
        p=payload(op,("title","edition_id","parent_id","decisions_file","review"))
        edition=get(store,"crf.edition",p.get("edition_id"));evidence=reviewed(store,p.get("review"))
        old=previous(store,kind,p.get("parent_id"),{"edition_id":edition["id"]},op,unique=True)
        decision_file=p.get("decisions_file");domain.obj(decision_file,("sha256","filename"))
        decision_info,raw=read_bytes(store,decision_file["sha256"])
        try:
            decisions=json.loads(raw.decode("utf-8-sig"),object_pairs_hook=unique_pairs,
                                 parse_constant=lambda value:(_ for _ in ()).throw(ValueError(value)))
        except (ValueError,UnicodeError) as exc:raise MigrationError("CRF_DECISION_JSON","Use a complete strict JSON decision array.") from exc
        original_checks=list(rows(store,edition["id"],"checks"))
        checks={r["id"]:r for r in original_checks}
        domain.require(len(checks)==len(original_checks),"CRF_FINDING_IDENTITY","The original finding population contains repeated identities; preserve and correct the source edition.")
        seen=set();statuses=Counter();corrections={}
        domain.require(isinstance(decisions,list),"CRF_DECISIONS","Retain the complete decision array.")
        for decision in decisions:
            domain.obj(decision,("check_id","status","note","evidence_files"),("correction_edition_id",))
            key=decision["check_id"]
            domain.require(key in checks and key not in seen,"CRF_DECISION_POPULATION","Each original finding has one explicit decision.");seen.add(key)
            domain.require(decision["status"] in ("open","explained","corrected"),"CRF_DISPOSITION","Select open, explained or corrected.")
            text(decision["note"],"decision note")
            file_refs(store,decision["evidence_files"],required=decision["status"]!="open")
            if decision["status"]=="corrected":
                correction_id=decision.get("correction_edition_id")
                if correction_id not in corrections:
                    corrected=get(store,"crf.edition",correction_id)
                    domain.require(corrected["contract_id"]==edition["contract_id"] and corrected["period"]==edition["period"]
                                   and corrected["id"]!=edition["id"] and descends(store,"crf.edition",corrected["id"],edition["id"]),
                                   "CRF_CORRECTION","Select a complete corrected descendant of this exact period.")
                    corrections[correction_id]={r["id"] for r in rows(store,correction_id,"checks")}
                domain.require(key not in corrections[correction_id],"CRF_CORRECTION_REMAINS","This finding remains in the selected corrected edition.")
            else:domain.require(not decision.get("correction_edition_id"),"CRF_CORRECTION_STATUS","Only corrected findings select a correction edition.")
            statuses[decision["status"]]+=1;emit("decisions",decision)
        domain.require(seen==set(checks),"CRF_REVIEW_POPULATION","Retain one decision for every original finding, including an explicit empty array for no findings.")
        body.update(edition_id=edition["id"],contract_id=edition["contract_id"],parent_id=old["id"] if old else None,
                    review=p["review"],evidence_files=evidence,decisions_file={**decision_file,"bytes":decision_info["bytes"]},
                    decision_count=len(decisions),statuses=dict(statuses),
                    meaning="Explained findings remain unresolved facts. Reviews never convert an incomplete edition into complete workbook inputs.")
    elif kind=="crf.workbook_binding":
        p=payload(op,("title","contract_id","file_sha256","filename","bindings","value_sources","review","parent_id"))
        contract=get(store,"crf.contract",p.get("contract_id"));evidence=reviewed(store,p.get("review"))
        info,raw=read_bytes(store,p.get("file_sha256"))
        bindings=p.get("bindings");sources=p.get("value_sources")
        domain.require(isinstance(bindings,dict) and isinstance(bindings.get("inputs"),list),"CRF_WORKBOOK_BINDING","Use the advertised complete workbook binding.")
        keys=[item.get("key") for item in bindings["inputs"]]
        domain.require(isinstance(sources,dict) and len(keys)==len(set(keys)) and set(sources)==set(keys),
                       "CRF_WORKBOOK_SOURCES","Bind every actual workbook input to one original metric or explicitly reviewed literal.")
        for key,source in sources.items():
            domain.obj(source,(),("metric_id","literal"))
            domain.require(len(source)==1,"CRF_WORKBOOK_SOURCE","Select one original metric or reviewed literal.")
            if "metric_id" in source:text(source["metric_id"],"metric identity")
            else:
                domain.obj(source["literal"],("type",),("value",))
                domain.require(source["literal"]["type"] in ("number","text","boolean","blank"),"CRF_WORKBOOK_LITERAL","Use an explicit typed literal.")
        inspection=workbook.validate_bindings(raw,bindings)["inspection"]
        # Validate typed literal/source contracts without generating a temporary
        # workbook or pretending unresolved metrics have observed numeric values.
        validation_values={}
        for item in bindings["inputs"]:
            source=sources[item["key"]];kind_value=item.get("value_type")
            if "literal" in source:validation_values[item["key"]]=source["literal"]
            else:validation_values[item["key"]]={"type":kind_value,**({} if kind_value=="blank" else {"value":"0" if kind_value=="number" else False if kind_value=="boolean" else ""})}
        workbook.validate_input_values(bindings,validation_values)
        old=previous(store,kind,p.get("parent_id"),{"contract_id":contract["id"]},op)
        cells=inspection.pop("cells",[])
        for cell in cells:emit("cells",cell)
        body.update(contract_id=contract["id"],file_sha256=info["sha256"],bytes=info["bytes"],filename=basename(p.get("filename")),
                    bindings=bindings,value_sources=sources,inspection=inspection,review=p["review"],evidence_files=evidence,
                    parent_id=old["id"] if old else None)
    elif kind=="crf.workbook_output":
        p=payload(op,("title","binding_id","edition_id"))
        binding=get(store,"crf.workbook_binding",p.get("binding_id"));edition=get(store,"crf.edition",p.get("edition_id"))
        domain.require(edition["report"]["status"]=="READY_FOR_WORKBOOK_MAPPING","CRF_EDITION_FINDINGS","Resolve reporting findings through a complete corrected edition before creating workbook inputs.")
        values=binding_values(store,binding,edition)
        _,raw=read_bytes(store,binding["file_sha256"])
        filename="crf-"+edition["period"]+"-"+body["id"][-12:]+"."+binding["bindings"]["format"]
        saved_output=store.get_entity(kind,body["id"],required=False)
        if saved_output is not None:
            # Preserve the actual original ZIP container across supported Python
            # and zlib versions. Verify every expected decompressed member byte
            # without replacing the held file with a freshly compressed archive.
            info,held=read_bytes(store,saved_output["file_sha256"])
            domain.require(info["bytes"]==saved_output["bytes"],"CRF_WORKBOOK_OUTPUT_CHANGED","The original outgoing container length differs.")
            inspection=workbook.verify_population(raw,held,binding["bindings"],values)
            sha,output_bytes=info["sha256"],info["bytes"]
        else:
            domain.require(stage,"CRF_WORKBOOK_OUTPUT_MISSING","The original workbook output record is missing.")
            output,inspection=workbook.populate_template(raw,binding["bindings"],values)
            sha=hashlib.sha256(output).hexdigest();output_bytes=len(output)
            store.stage_file(io.BytesIO(output),filename,expected_sha256=sha,expected_bytes=output_bytes)
        for key,value in values.items():emit("inputs",{"key":key,"value":value,"source":binding["value_sources"][key]})
        for field,section in (("lineage","workbook_lineage"),("member_manifest","member_manifest"),("native_numeric_precision_warnings","numeric_precision_warnings")):
            for item in inspection.pop(field,[]):emit(section,item)
        body.update(contract_id=edition["contract_id"],binding_id=binding["id"],edition_id=edition["id"],
                    file_sha256=sha,bytes=output_bytes,filename=filename,inspection=inspection,values=values,
                    meaning="Actual template-derived inputs. Formula caches have not been recalculated by this application; open in the authorized native spreadsheet operator and return that exact file.")
    elif kind=="crf.workbook_return":
        p=payload(op,("title","output_id","file_sha256","filename","review","observations"))
        output=get(store,"crf.workbook_output",p.get("output_id"));binding=get(store,"crf.workbook_binding",output["binding_id"])
        evidence=reviewed(store,p.get("review"));info,actual=read_bytes(store,p.get("file_sha256"))
        _,original=read_bytes(store,binding["file_sha256"])
        domain.require(isinstance(p.get("observations"),dict),"CRF_RETURN_OBSERVATIONS","Retain actual native operator observations, including actual controls and opened file.")
        inspection=workbook.inspect_return(original,actual,binding["bindings"],output["values"])
        for section in SECTIONS[kind]:
            for item in inspection.pop(section,[]):emit(section,item)
        body.update(contract_id=output["contract_id"],output_id=output["id"],file_sha256=info["sha256"],bytes=info["bytes"],
                    filename=basename(p.get("filename")),inspection=inspection,review=p["review"],evidence_files=evidence,
                    observations=p["observations"],meaning="Actual returned workbook and observed checks; no inferred Section 151 authority, copied submission email, or DWP acceptance.")
    else:raise MigrationError("CRF_OPERATION","Unknown CRF operation.")
    return body

class SectionSink:
    def __init__(self,store,record_id,kind,mode):
        self.store,self.record_id,self.mode=store,record_id,mode
        self.counts=Counter({section:0 for section in SECTIONS[kind]})
        self.hashes={section:hashlib.sha256() for section in SECTIONS[kind]}
    def __call__(self,section,row):
        domain.require(section in self.hashes,"CRF_SECTION_CONTRACT","The computation emitted an undeclared section.")
        index=self.counts[section];encoded=canonical(row)
        self.counts[section]+=1
        self.hashes.setdefault(section,hashlib.sha256()).update((encoded+"\n").encode("utf-8"))
        if self.mode=="write":
            self.store.conn.execute("INSERT OR IGNORE INTO crf_items VALUES(?,?,?,?,?)",
                                    (self.record_id,section,index,row.get("status"),encoded))
        actual=self.store.conn.execute("SELECT body_json FROM crf_items WHERE owner_id=? AND section=? AND ordinal=?",
                                       (self.record_id,section,index)).fetchone()
        domain.require(actual is not None and actual[0]==encoded,"CRF_RESULT_CONFLICT","The original complete row differs on continuation or verification.",section=section,ordinal=index)
    def finish(self):
        saved={row["section"]:row["total"] for row in self.store.conn.execute(
            "SELECT section,count(*) AS total FROM crf_items WHERE owner_id=? GROUP BY section",(self.record_id,))}
        domain.require(saved=={section:count for section,count in self.counts.items() if count},"CRF_RESULT_POPULATION","The retained complete section population differs.")
        return {section:{"rows":self.counts[section],"sha256":self.hashes[section].hexdigest()} for section in self.counts}

@with_evidence_cache
def invoke(store,op):
    kind=op["operation"].removesuffix(".create");record_id=kind.replace(".","-")+"-"+identity({"op":op["id"],"sha":op["request_sha256"]})[:40]
    with store.transaction():
        sink=SectionSink(store,record_id,kind,"write")
        body=compute(store,op,sink,stage=True);body["sections"]=sink.finish()
        body["request_sha256"]=op["request_sha256"]
        return store.put_entity(kind,record_id,body,op["reserved_revision"])

HANDLERS={operation:invoke for operation in MUTATIONS}

@with_evidence_cache
def verify(store,record_id=None):
    selected=[get(store,kind,record_id) for kind in KINDS if store.get_entity(kind,record_id,required=False)] if record_id else [
        record for kind in KINDS for record in records(store,kind)]
    domain.require(record_id is None or len(selected)==1,"CRF_VERIFY_RECORD","Select one existing CRF record.")
    # Verify the full retained dependency closure in historical order. A selected
    # derived record must not borrow unchecked metadata from an altered ancestor.
    closure={};visiting=set()
    def visit(saved):
        if saved["id"] in closure:return
        domain.require(saved["id"] not in visiting,"CRF_DEPENDENCY_CYCLE","Original record dependencies contain a cycle.")
        visiting.add(saved["id"])
        dependencies=[]
        if saved.get("parent_id"):dependencies.append((saved["kind"],saved["parent_id"]))
        if saved.get("contract_id"):dependencies.append(("crf.contract",saved["contract_id"]))
        if saved["kind"]=="crf.edition":dependencies.extend(("crf.dataset",record_id) for record_id in saved["dataset_ids"])
        if saved["kind"]=="crf.comparison":dependencies.extend(("crf.edition",saved[key]) for key in ("earlier_id","later_id"))
        if saved["kind"]=="crf.review":
            dependencies.append(("crf.edition",saved["edition_id"]))
            dependencies.extend(("crf.edition",row["correction_edition_id"]) for row in rows(store,saved["id"],"decisions") if row.get("correction_edition_id"))
        if saved["kind"]=="crf.workbook_output":
            dependencies.extend((("crf.workbook_binding",saved["binding_id"]),("crf.edition",saved["edition_id"])))
        if saved["kind"]=="crf.workbook_return":dependencies.append(("crf.workbook_output",saved["output_id"]))
        for kind,record_id in dependencies:visit(get(store,kind,record_id))
        visiting.remove(saved["id"]);closure[saved["id"]]=saved
    results=[]
    with store.transaction():
        for saved in selected:visit(saved)
        for saved in closure.values():
            op=store._operation(saved["operation_id"])
            domain.require(op["operation"]==saved["kind"]+".create","CRF_OPERATION_BINDING","The original operation kind differs.")
            sink=SectionSink(store,saved["id"],saved["kind"],"read")
            rebuilt=compute(store,op,sink);rebuilt["sections"]=sink.finish();rebuilt["request_sha256"]=op["request_sha256"]
            domain.require(rebuilt==saved,"CRF_RECORD_CHANGED","The complete record differs from its original request, retained sources and computation.",id=saved["id"])
            if op["status"]=="SUCCEEDED":
                domain.require(op["result"]["result"]==saved,"CRF_RESULT_BINDING","The original successful operation result differs.")
            results.append({"id":saved["id"],"kind":saved["kind"],"sections":saved["sections"],"status":"VERIFIED"})
    return {"schema":"commons.crf-verification/v1","workspace_id":store.project["id"],"records":results,"record_count":len(results)}

def request_status(store,operation_id):
    identifier(operation_id,"operation_id")
    with store.transaction():
        op=store._operation(operation_id,required=False)
        result={"schema":"commons.crf-request-status/v1","operation_id":operation_id,"workspace_id":store.project["id"],
                "revision":store.project["revision"],"found":op is not None,"can_return_to_draft":False}
        if op is None:return {**result,"status":None,"reason":"The original request is not admitted."}
        result.update(operation=op["operation"],status=op["status"],request_sha256=op["request_sha256"],error=op["error"],original_request=op["request"])
        if op["operation"] not in MUTATIONS:return {**result,"reason":"This is not an original local CRF mutation."}
        kind=op["operation"].removesuffix(".create");record_id=kind.replace(".","-")+"-"+identity({"op":op["id"],"sha":op["request_sha256"]})[:40]
        effects={"record":store.get_entity(kind,record_id,required=False) is not None,
                 "items":store.conn.execute("SELECT count(*) FROM crf_items WHERE owner_id=?",(record_id,)).fetchone()[0],
                 "result":op["result"] is not None,"checkpoint":op["checkpoint"] is not None}
        code=op["error"].get("code") if isinstance(op["error"],dict) else None
        # Only explicit user-input validation codes are eligible. All generated
        # workbook operations retain original-request recovery because a complete
        # output object may have been published before a later interruption.
        validation=code in DRAFT_VALIDATION_CODES and kind!="crf.workbook_output"
        allowed=op["status"]=="INTERRUPTED" and validation and not any(effects.values())
        return {**result,"record_id":record_id,"effects":effects,"known_validation_failure":validation,
                "can_return_to_draft":allowed,"reason":"Retain the original rejection and edit a new draft." if allowed else "Keep the exact original request and its recovery."}

DRAFT_VALIDATION_CODES=frozenset({
 "INVALID_FIELD","INVALID_FILENAME","INVALID_ID","INVALID_SHA256","INVALID_INTEGER","ENTITY_NOT_FOUND","FILE_NOT_FOUND",
 "CRF_OBJECT","CRF_FIELDS","CRF_REVIEW","CRF_AUTHORITY","CRF_RULE_VERSION","CRF_COVERAGE","CRF_WINDOW","CRF_MAPPING","CRF_FAMILY",
 "CRF_VALUE_MAPPING","CRF_VALUE_KIND","CRF_VALUE_DUPLICATE","CRF_VALUE_TARGET","CRF_COLUMN","CRF_PERIOD","CRF_POPULATION",
 "CRF_REQUEST","CRF_KIND","CRF_PARENT_REQUIRED","CRF_PARENT_SCOPE","CRF_HEAD","CRF_SOURCE_SIZE","CRF_DATASETS","CRF_DATASET_SCOPE",
 "CRF_DATASET_ANCESTRY","CRF_COMPARISON_SCOPE","CRF_DECISION_JSON","CRF_DECISIONS","CRF_DECISION_POPULATION","CRF_DISPOSITION",
 "CRF_CORRECTION","CRF_CORRECTION_REMAINS","CRF_CORRECTION_STATUS","CRF_REVIEW_POPULATION","CRF_WORKBOOK_BINDING","CRF_WORKBOOK_SOURCES",
 "CRF_WORKBOOK_SOURCE","CRF_WORKBOOK_LITERAL","CRF_RETURN_OBSERVATIONS","CRF_WORKBOOK_SCOPE","CRF_WORKBOOK_METRIC","CRF_EDITION_FINDINGS",
 "FINANCE_COLUMN","FINANCE_COLUMNS","FINANCE_DELIMITER","FINANCE_DIALECT","FINANCE_DUPLICATE_KEY","FINANCE_ENCODING","FINANCE_FIELDS",
 "FINANCE_FORMAT","FINANCE_HEADER","FINANCE_JSON","FINANCE_NESTING","FINANCE_OBJECT","FINANCE_ROW_LIMIT","FINANCE_ROW_WIDTH",
 "PROPERTY_INSTANT","PROPERTY_FILES","PROPERTY_OBJECT","PROPERTY_FIELDS","FINANCE_FILES"})

DRAFT_VALIDATION_CODES=DRAFT_VALIDATION_CODES | frozenset(["CRF_WORKBOOK_ACTIVE_POLICY","CRF_WORKBOOK_BINDING_CELL","CRF_WORKBOOK_BINDING_COUNT","CRF_WORKBOOK_BINDING_DUPLICATE","CRF_WORKBOOK_BOOLEAN","CRF_WORKBOOK_CELL","CRF_WORKBOOK_CELL_BINDING","CRF_WORKBOOK_CELL_DUPLICATE","CRF_WORKBOOK_CELL_LIMIT","CRF_WORKBOOK_CELL_PREFIX","CRF_WORKBOOK_CELL_SCOPE","CRF_WORKBOOK_DUPLICATE_PART","CRF_WORKBOOK_EMBEDDED_ACTIVE","CRF_WORKBOOK_ENCODING","CRF_WORKBOOK_ENCRYPTED","CRF_WORKBOOK_EXPANDED_SIZE","CRF_WORKBOOK_EXTERNAL_POLICY","CRF_WORKBOOK_FORMAT","CRF_WORKBOOK_INPUT_BOOLEAN","CRF_WORKBOOK_INPUT_NUMBER","CRF_WORKBOOK_INPUT_PROTECTED","CRF_WORKBOOK_INPUT_STRUCTURE","CRF_WORKBOOK_INPUT_TEXT","CRF_WORKBOOK_INPUT_TYPE","CRF_WORKBOOK_MACRO_POLICY","CRF_WORKBOOK_MAIN","CRF_WORKBOOK_MEMBERS","CRF_WORKBOOK_MERGE","CRF_WORKBOOK_MISSING_PART","CRF_WORKBOOK_NUMBER","CRF_WORKBOOK_OUTPUT_PARTS","CRF_WORKBOOK_OUTPUT_PRESERVATION","CRF_WORKBOOK_OUTPUT_VALUE","CRF_WORKBOOK_PACKAGE","CRF_WORKBOOK_PART_PATH","CRF_WORKBOOK_PART_SIZE","CRF_WORKBOOK_RANGE","CRF_WORKBOOK_RELATIONSHIP","CRF_WORKBOOK_SHAPE","CRF_WORKBOOK_SHEET","CRF_WORKBOOK_SHEETS","CRF_WORKBOOK_SHEET_DATA","CRF_WORKBOOK_SIGNED_PACKAGE","CRF_WORKBOOK_SIZE","CRF_WORKBOOK_STRING","CRF_WORKBOOK_STRINGS","CRF_WORKBOOK_STRING_INDEX","CRF_WORKBOOK_STYLE","CRF_WORKBOOK_STYLES","CRF_WORKBOOK_TEMPLATE_BINDING","CRF_WORKBOOK_TEXT","CRF_WORKBOOK_VALUES","CRF_WORKBOOK_VALUE_TYPE","CRF_WORKBOOK_XML","CRF_WORKBOOK_XML_DECLARATION","CRF_WORKBOOK_XML_SPAN","CRF_WORKBOOK_ZIP","CRF_WORKBOOK_ZIP_MEMBER"])

def read(store,operation,p):
    if operation=="crf.schema":return schema()
    if operation=="crf.preview":return preview(store,p)
    if operation=="crf.request_status":return request_status(store,p.get("operation_id"))
    if operation=="crf.verify":return verify(store,p.get("id"))
    if operation=="crf.get":return get(store,p.get("kind"),p.get("id"))
    if operation=="crf.workbook_preview":
        info,raw=read_bytes(store,p.get("file_sha256"));result=workbook.inspect_template(raw)
        offset,limit=page(p);cells=result.pop("cells",[])
        return {**result,"sha256":info["sha256"],"bytes":info["bytes"],"rows":cells[offset:offset+limit],"total":len(cells),"offset":offset,"limit":limit}
    if operation=="crf.list":
        kind=p.get("kind");domain.require(kind in KINDS,"CRF_KIND","Select an advertised CRF kind.")
        offset,limit=page(p);return store.list_entities(kind,offset=offset,limit=limit)
    if operation=="crf.rows":
        saved=get(store,p.get("kind"),p.get("id"));section=p.get("section","rows" if saved["kind"]=="crf.dataset" else "metrics")
        domain.require(section in saved["sections"],"CRF_SECTION","Select an actual retained record section.")
        offset,limit=page(p);where,args="owner_id=? AND section=?",[saved["id"],section]
        if p.get("status"):where+=" AND status=?";args.append(text(p["status"],"status"))
        if p.get("query"):where+=" AND instr(lower(body_json),lower(?))>0";args.append(text(p["query"],"query",max_length=2000))
        count=store.conn.execute("SELECT count(*) FROM crf_items WHERE "+where,args).fetchone()[0]
        data=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM crf_items WHERE "+where+" ORDER BY ordinal LIMIT ? OFFSET ?",(*args,limit,offset))]
        return {"rows":data,"total":count,"offset":offset,"limit":limit}
    raise MigrationError("CRF_READ","Unknown CRF read.")

def iter_export(store,kind,record_id,format_name="ndjson"):
    saved=get(store,kind,record_id)
    def entries():
        yield {"section":"record","ordinal":0,"value":saved}
        for section in saved["sections"]:
            for ordinal,row in enumerate(rows(store,record_id,section),1):
                yield {"section":section,"ordinal":ordinal,"value":row}
    if format_name=="ndjson":
        for entry in entries():yield (canonical(entry)+"\n").encode("utf-8")
    else:
        domain.require(format_name=="csv","CRF_EXPORT","Use complete NDJSON or CSV.")
        buffer=io.StringIO(newline="");writer=csv.writer(buffer);writer.writerow(["original_record","section","ordinal","complete_json"])
        yield buffer.getvalue().encode("utf-8");buffer.seek(0);buffer.truncate()
        for entry in entries():
            writer.writerow([record_id,entry["section"],entry["ordinal"],canonical(entry["value"])])
            yield buffer.getvalue().encode("utf-8");buffer.seek(0);buffer.truncate()
