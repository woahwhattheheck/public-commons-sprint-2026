#!/usr/bin/env python3
"""Receive the exact upstream Chinook cohort and produce its complete migration source contract."""
import argparse, collections, csv, datetime, decimal, hashlib, json, pathlib, platform, sqlite3, sys, urllib.request, uuid
D=decimal.Decimal
decimal.getcontext().prec=50

def sha(b): return hashlib.sha256(b).hexdigest()
def js(v): return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)
def put_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")
def q(name): return '"'+name.replace('"','""')+'"'
def is_money(col): return col["declaredType"].upper().startswith("NUMERIC")
def canon(value,col):
    if value is None: return None
    if is_money(col):
        value=D(str(value))
        if not value.is_finite() or value!=value.quantize(D("0.01")): raise ValueError("Non-cent decimal: "+col["name"])
        return format(value,".2f")
    if "INT" in col["declaredType"].upper():
        if type(value) is not int: raise TypeError("Non-integer value: "+col["name"])
    elif not isinstance(value,str): raise TypeError("Non-text value: "+col["name"])
    return value
def csv_cell(value):
    if value is None: return r"\N"
    if isinstance(value,str): return value.replace("\\","\\\\")
    return str(value)

def receive(manifest,output,inputs=None):
    output=pathlib.Path(output)
    output.mkdir(parents=True,exist_ok=False)
    operation={"schema":"commons.migration.original-reference-operation.v1","operationId":str(uuid.uuid4()),"startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"sourceCommit":manifest["commit"],"pythonVersion":platform.python_version(),"sqliteVersion":sqlite3.sqlite_version}
    put_json(output/"OPERATION.json",operation)
    received=[]
    for source in manifest["files"]:
        rel=source["path"]
        dst=output/"upstream"/rel
        dst.parent.mkdir(parents=True,exist_ok=True)
        if inputs is not None:
            raw=(pathlib.Path(inputs)/rel).read_bytes()
            custody={"method":"original-local-file","relativePath":rel}
        else:
            url=manifest["rawRoot"]+rel
            request=urllib.request.Request(url,headers={"User-Agent":"Commons-source-receiving/1.0","Accept":"text/plain,application/octet-stream"})
            with urllib.request.urlopen(request,timeout=40) as response:
                if response.status!=200: raise RuntimeError("Source status "+str(response.status))
                raw=response.read(source["bytes"]+1)
                custody={"method":"ordinary-public-https","url":url,"returnedUrl":response.geturl(),"status":response.status,"contentType":response.headers.get("Content-Type"),"etag":response.headers.get("ETag")}
        if len(raw)!=source["bytes"] or sha(raw)!=source["sha256"]: raise ValueError("Original source hash mismatch: "+rel)
        dst.write_bytes(raw)
        received.append(dict(source,receipt=custody))
        print(js({"sourceReceived":rel,"bytes":len(raw)}),flush=True)
    put_json(output/"SOURCE_MANIFEST.json",dict(manifest,files=received))
    sql=(output/"upstream/ChinookDatabase/DataSources/Chinook_Sqlite.sql").read_text(encoding="utf-8")
    source_json=(output/"upstream/ChinookDatabase/DataSources/ChinookData.json").read_text(encoding="utf-8")
    original=json.loads(source_json,parse_float=D)
    dbpath=output/"Chinook.sqlite"
    db=sqlite3.connect(dbpath)
    db.executescript(sql)
    db.commit()
    db.execute("PRAGMA foreign_keys=ON")
    fk_mode=db.execute("PRAGMA foreign_keys").fetchone()[0]
    fk_errors=[list(r) for r in db.execute("PRAGMA foreign_key_check")]
    integrity=[r[0] for r in db.execute("PRAGMA integrity_check")]
    tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    if set(tables)!=set(original): raise ValueError("Original JSON/SQL table set differs")
    schemas=[]; populations={}; raw_populations={}; table_summaries=[]; differences=[]; unexpected=[]; lineages=[]
    for table in tables:
        cols=[{"ordinal":r[0],"name":r[1],"declaredType":r[2],"nullable":not bool(r[3]),"default":r[4],"primaryKeyOrder":r[5]} for r in db.execute("PRAGMA table_info("+q(table)+")")]
        pk=[c["name"] for c in sorted(cols,key=lambda c:c["primaryKeyOrder"]) if c["primaryKeyOrder"]]
        if not pk: raise ValueError("Reference table lacks primary key: "+table)
        relations={}
        for r in db.execute("PRAGMA foreign_key_list("+q(table)+")"):
            rel=relations.setdefault(r[0],{"id":table+".fk."+str(r[0]),"childTable":table,"parentTable":r[2],"columns":[],"onUpdate":r[5],"onDelete":r[6],"match":r[7]})
            rel["columns"].append({"sequence":r[1],"child":r[3],"parent":r[4]})
        for rel in relations.values(): rel["columns"].sort(key=lambda x:x["sequence"])
        expressions=[("CAST("+q(c["name"])+" AS TEXT)" if is_money(c) else q(c["name"])) for c in cols]
        ordered=",".join(q(k) for k in pk)
        query="SELECT "+",".join(expressions)+" FROM "+q(table)+" ORDER BY "+ordered
        native=[{c["name"]:canon(v,c) for c,v in zip(cols,r)} for r in db.execute(query)]
        originals=[{c["name"]:canon(r[c["name"]],c) for c in cols} for r in original[table]]
        source_by_key={tuple(r[k] for k in pk):(i,r) for i,r in enumerate(originals)}
        if len(source_by_key)!=len(originals): raise ValueError("Duplicate original JSON primary key: "+table)
        native_by_key={tuple(r[k] for k in pk):r for r in native}
        if len(native_by_key)!=len(native): raise ValueError("Duplicate native primary key: "+table)
        missing=sorted(set(source_by_key)-set(native_by_key)); extra=sorted(set(native_by_key)-set(source_by_key))
        if missing or extra: unexpected.append({"table":table,"missingNativeKeys":missing,"extraNativeKeys":extra})
        for row in native:
            key=tuple(row[k] for k in pk)
            if key not in source_by_key: continue
            ordinal,raw=source_by_key[key]; changes=[]
            for col in cols:
                name=col["name"]; before=raw[name]; after=row[name]
                if before==after: continue
                reason=None
                if before=="" and after is None and col["nullable"]: reason="upstream-generator-empty-nullable-string-to-sql-null"
                elif col["declaredType"].upper()=="DATETIME" and isinstance(before,str) and isinstance(after,str):
                    a=datetime.datetime.fromisoformat(before); b=datetime.datetime.fromisoformat(after)
                    if a.tzinfo is None and b.tzinfo is None and a==b: reason="upstream-sqlite-date-format-no-timezone-change"
                change={"column":name,"original":before,"native":after,"rule":reason or "UNEXPLAINED"}
                changes.append(change)
                differences.append({"table":table,"primaryKey":dict(zip(pk,key)),"sourceJsonPointer":"/"+table+"/"+str(ordinal)+"/"+name,**change})
                if reason is None: unexpected.append({"table":table,"primaryKey":dict(zip(pk,key)),**change})
            lineages.append({"table":table,"primaryKey":dict(zip(pk,key)),"sourceJsonPointer":"/"+table+"/"+str(ordinal),"sourceRowSha256":sha(js(raw).encode()),"nativeRowSha256":sha(js(row).encode()),"transformationRules":sorted({c["rule"] for c in changes})})
        nullable_counts={c["name"]:sum(r[c["name"]] is None for r in native) for c in cols}
        empty_counts={c["name"]:sum(r[c["name"]]=="" for r in native) for c in cols}
        storage={c["name"]:dict(db.execute("SELECT typeof("+q(c["name"])+"),COUNT(*) FROM "+q(table)+" GROUP BY typeof("+q(c["name"])+")")) for c in cols}
        schema={"table":table,"columns":cols,"primaryKey":pk,"foreignKeys":list(relations.values()),"nativeExtractionSql":query,"comparisonOrder":pk,"decimalEncoding":"base10 string at declared scale2","timestampEncoding":"source-local text, no inferred timezone","nullEncoding":"JSON null; CSV backslash-N with doubled literal backslashes"}
        schemas.append(schema)
        for cohort,rows in [("native",native),("original-json",originals)]:
            directory=output/"tables"/cohort;directory.mkdir(parents=True,exist_ok=True)
            with (directory/(table+".jsonl")).open("w",encoding="utf-8",newline="\n") as f:
                for row in rows: f.write(js(row)+"\n")
            with (directory/(table+".csv")).open("w",encoding="utf-8",newline="") as f:
                w=csv.writer(f,quoting=csv.QUOTE_ALL);w.writerow([c["name"] for c in cols])
                for row in rows:w.writerow([csv_cell(row[c["name"]]) for c in cols])
        raw_populations[table]=originals;populations[table]=native
        table_summaries.append({"table":table,"rows":len(native),"originalRows":len(originals),"primaryKey":pk,"nulls":nullable_counts,"emptyStrings":empty_counts,"storageClasses":storage,"nativeJsonlSha256":sha((output/"tables/native"/(table+".jsonl")).read_bytes()),"originalJsonlSha256":sha((output/"tables/original-json"/(table+".jsonl")).read_bytes())})
    def jsonlines(name,rows):
        p=output/name;p.parent.mkdir(parents=True,exist_ok=True)
        with p.open("w",encoding="utf-8",newline="\n") as f:
            for row in rows:f.write(js(row)+"\n")
    jsonlines("SOURCE_TO_NATIVE_LINEAGE.jsonl",lineages)
    jsonlines("GENERATOR_TRANSFORMATIONS.jsonl",differences)
    put_json(output/"UNEXPLAINED_DIFFERENCES.json",unexpected)
    put_json(output/"SCHEMA.json",{"schema":"commons.original-relational-schema.v1","sourceCommit":manifest["commit"],"tables":schemas})
    lines=collections.defaultdict(list)
    for row in populations["InvoiceLine"]:lines[row["InvoiceId"]].append(row)
    invoice_controls=[];grouped=collections.defaultdict(lambda:{"invoiceCount":0,"lineCount":0,"quantity":0,"headerTotal":D(0),"extendedLineTotal":D(0)})
    for invoice in populations["Invoice"]:
        details=lines[invoice["InvoiceId"]]
        extended=sum((D(x["UnitPrice"])*x["Quantity"] for x in details),D(0))
        header=D(invoice["Total"]);quantity=sum(x["Quantity"] for x in details)
        record={"InvoiceId":invoice["InvoiceId"],"CustomerId":invoice["CustomerId"],"InvoiceDate":invoice["InvoiceDate"],"BillingCountry":invoice["BillingCountry"],"lineCount":len(details),"quantity":quantity,"headerTotal":format(header,".2f"),"extendedLineTotal":format(extended,".2f"),"difference":format(header-extended,".2f"),"balanced":header==extended,"unit":"UNSPECIFIED_REFERENCE_AMOUNT"}
        invoice_controls.append(record)
        for group_name,group_key in [("all",[]),("customer",[invoice["CustomerId"]]),("billing-country",[invoice["BillingCountry"]]),("calendar-year",[invoice["InvoiceDate"][:4]])]:
            group=grouped[(group_name,js(group_key))];group["invoiceCount"]+=1;group["lineCount"]+=len(details);group["quantity"]+=quantity;group["headerTotal"]+=header;group["extendedLineTotal"]+=extended
    groups=[]
    for (name,key),values in sorted(grouped.items()):
        groups.append({"group":name,"key":json.loads(key),**{k:format(v,".2f") if isinstance(v,D) else v for k,v in values.items()},"difference":format(values["headerTotal"]-values["extendedLineTotal"],".2f"),"unit":"UNSPECIFIED_REFERENCE_AMOUNT"})
    put_json(output/"controls/INVOICE_CONTROL_POPULATION.json",invoice_controls)
    put_json(output/"controls/GROUPED_EXACT_CONTROLS.json",groups)
    put_json(output/"controls/KEY_AND_RELATION_RESULTS.json",{"foreignKeysEnabledAfterLoad":fk_mode,"foreignKeyViolations":fk_errors,"integrityCheck":integrity,"sourceDuplicatePrimaryKeys":0,"nativeDuplicatePrimaryKeys":0,"primaryKeyTables":len(schemas),"foreignKeyRelations":sum(len(s["foreignKeys"]) for s in schemas)})
    db.close()
    contract={
      "schema":"commons.migration.reference-acceptance-contract.v1","sourceCommit":manifest["commit"],"sourceBasis":"published-upstream-SQLite-edition","upstreamJsonBasis":"separately-retained-generator-input","tables":schemas,
      "selection":{"mode":"complete-population","tableNames":tables,"rowCounts":{x["table"]:x["rows"] for x in table_summaries}},
      "normalization":{"default":"identity-preserving","approvedReferenceRules":[{"id":"upstream-generator-empty-nullable-string-to-sql-null","authority":"ChinookDatabase/DataSources/ChinookDatabase.tt lines294-298","scope":"original JSON to published SQL; preserve native nulls downstream"},{"id":"upstream-sqlite-date-format-no-timezone-change","authority":"ChinookDatabase/DdlStrategies/SqliteStrategy.cs FormatDateValue","scope":"original JSON T separator to original SQLite space separator; no timezone inference"}],"prohibitedImplicitChanges":["deduplicate","trim","case-fold","Unicode-normalize","empty-string-to-null beyond declared original generator boundary","floating-point amount sum","infer currency from country","infer timezone","remap identifiers"]},
      "nativeInput":{"path":"tables/native","format":"UTF8 JSONL","authority":"full canonical column names in SCHEMA.json","decimalColumns":"decode exact decimal strings to declared DECIMAL(10,2) in target","rawCopy":"Chinook.sqlite","upstreamOriginals":"upstream/"},
      "lineage":{"wholePopulation":"SOURCE_TO_NATIVE_LINEAGE.jsonl","fieldTransformations":"GENERATOR_TRANSFORMATIONS.jsonl","generatorJsonPreserved":"upstream/ChinookDatabase/DataSources/ChinookData.json"},
      "controls":{"primaryKey":"no missing/null/duplicate complete key; retain full composite key order","foreignKey":"retain every non-null child-parent tuple; nullable absence remains distinct from unresolved parent","counts":"compare selected source rows, intentionally transformed/filtered rows, native loaded rows and target rows with explicit one-to-many mapping where applicable","multiset":"compare full row multiplicities; row count and hash totals alone do not authorize acceptance","exactAmounts":"integer quantity times exact declared-scale decimal UnitPrice, grouped by original invoice/customer/country/year; use full control populations","currency":"upstream declares none; reference totals have no currency; real customer acceptance groups by declared currency and entity and records rate/date/rule for conversions","cataloguePrice":"Track.UnitPrice is not a substitute for original InvoiceLine.UnitPrice","dates":"preserve source-local timestamps and distinguish original text from target-native representation"},
      "customerAcceptance":{"sourceIdentity":["original artifact hashes","actual source snapshot/edition","selection and field/key mapping version"],"nativeIdentity":["actual invocation/request ID","actual target connection/workspace identity","actual target returned IDs","original load completion and observed reconciliation"],"exceptionDecision":["stable exception ID","complete source/target locators","original and observed values","owner","reason","disposition","approved rule/version","resolution or accepted business deviation"],"stateModel":["prepared","operated","reconciled","accepted-with-recorded-deviations-or-accepted","delivered-and-independently-received"],"resumption":"reconcile an unknown invocation against its actual target identity before any repeat load","sourceChange":"new source edition creates a new comparison bound to original baseline, mapping and previous acceptance; do not overwrite history","rollback":"retain original target/source preimage, record authorized actual restore or reversal and reconcile the resulting target before acceptance","receiving":["open complete source and schema","open original native operation/results","recompute full control populations","reopen target through maintained native receiver","retain approvals/exceptions and exact prior source version","return editable operator/customer report"]}
    }
    put_json(output/"MIGRATION_ACCEPTANCE_CONTRACT.json",contract)
    summary=dict(operation,completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),status="SOURCE_RECEIVED",tables=table_summaries,totalRows=sum(x["rows"] for x in table_summaries),lineageRows=len(lineages),observedGeneratorChanges=len(differences),changesByRule=dict(collections.Counter(x["rule"] for x in differences)),unexpectedDifferenceCount=len(unexpected),foreignKeyViolationCount=len(fk_errors),unbalancedInvoiceCount=sum(not x["balanced"] for x in invoice_controls),groupedControls=groups,integrityCheck=integrity,nativeDatabaseSha256=sha(dbpath.read_bytes()))
    if unexpected or fk_errors or integrity!=["ok"] or any(not x["balanced"] for x in invoice_controls):summary["status"]="SOURCE_REVIEW_REQUIRED"
    put_json(output/"SOURCE_RECEIVING_RESULT.json",summary)
    inventory=[]
    for path in sorted(output.rglob("*")):
        if path.is_file():
            raw=path.read_bytes();inventory.append({"path":str(path.relative_to(output)),"bytes":len(raw),"sha256":sha(raw)})
    put_json(output/"DELIVERY_MANIFEST.json",{"schema":"commons.complete-original-source-delivery.v1","operationId":operation["operationId"],"sourceCommit":manifest["commit"],"files":inventory})
    print(js({"completed":True,"status":summary["status"],"operationId":operation["operationId"],"tables":len(tables),"rows":summary["totalRows"],"lineageRows":len(lineages),"changes":summary["changesByRule"],"unexpected":len(unexpected),"foreignKeyViolations":len(fk_errors),"unbalancedInvoices":summary["unbalancedInvoiceCount"]}),flush=True)
    return summary

def main():
    a=argparse.ArgumentParser(description=__doc__);a.add_argument("--manifest",required=True);a.add_argument("--output",required=True);a.add_argument("--inputs")
    n=a.parse_args();return receive(json.loads(pathlib.Path(n.manifest).read_text(encoding="utf-8")),n.output,n.inputs)
if __name__=="__main__":main()
