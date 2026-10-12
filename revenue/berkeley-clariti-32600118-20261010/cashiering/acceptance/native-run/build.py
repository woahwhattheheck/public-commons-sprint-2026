#!/usr/bin/env python3
"""One retained native Berkeley workflow. All transaction records are explicit local examples."""
from __future__ import annotations
import base64, csv, hashlib, io, json, os, sqlite3, sys, tempfile, traceback, uuid, zipfile
from datetime import datetime, timezone
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1]
SOURCE=PROJECT/"source/revenue/berkeley-clariti-32600118-20261010"
RUN=PROJECT/"native-run"
RUN.mkdir(parents=True,exist_ok=True)
(RUN/"tmp").mkdir(exist_ok=True)
tempfile.tempdir=str(RUN/"tmp")
sys.path[:0]=[str(SOURCE/"workspace"),str(SOURCE)]
from app import Workspace, Conflict, restore
from cashiering.engine import Cashiering
from cashiering import model
OPERATION="berkeley-daily-cashiering-native-82e4-20261012"
DB=RUN/"workspace.sqlite"
CHECKPOINT=RUN/"build.json"
REQUESTS=RUN/"requests.json"
def save(path,value):
    data=json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False).encode()
    tmp=path.with_name(path.name+".writing")
    with open(tmp,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
def clock():return datetime.now(timezone.utc).isoformat()
state=json.loads(CHECKPOINT.read_text()) if CHECKPOINT.exists() else {
    "schema":"berkeley.cashiering.native-build.v1","operation_id":OPERATION,"created_at":clock(),
    "basis":"Explicit local worked example; no City/Clariti/Munis/ACI data, login, transmission or posting.",
    "database_path":str(DB),"source_root":str(SOURCE),"steps":{}}
requests=json.loads(REQUESTS.read_text()) if REQUESTS.exists() else {}
composition_path=PROJECT/"source-composition.json"
if not composition_path.is_file():
    raise RuntimeError("The complete installed source composition must be retained before native execution.")
composition=json.loads(composition_path.read_text())
for entry in composition["files"]:
    actual=(SOURCE/entry["path"]).read_bytes()
    if len(actual)!=entry["bytes"] or hashlib.sha256(actual).hexdigest()!=entry["sha256"]:
        raise RuntimeError("Installed source changed before native execution: "+entry["path"])
composition_sha=hashlib.sha256(composition_path.read_bytes()).hexdigest()
if not state.get("source_editions") or state["source_editions"][-1]["sha256"]!=composition_sha:
    state.setdefault("source_editions",[]).append({"sha256":composition_sha,"recorded_at":clock(),"source_commit":composition.get("source_commit")})
    save(CHECKPOINT,state)
workspace=Workspace(DB)
cash=Cashiering(workspace,Conflict)
def phase(name,fn):
    if name in state["steps"]:
        return state["steps"][name]["value"]
    value=fn()
    state["steps"][name]={"completed_at":clock(),"value":value}
    state["last_completed_phase"]=name
    save(CHECKPOINT,state)
    print(json.dumps({"phase":name,"revision":cash.state()["revision"]}),flush=True)
    return value
def call(label,action,payload):
    ident=str(uuid.uuid5(uuid.NAMESPACE_URL,OPERATION+"/"+label))
    old=cash.read("/api/cashiering/requests/"+ident,{})[0]
    if old["found"]:
        return old["response"]
    if label not in requests:
        requests[label]={"revision":cash.state()["revision"],"request_id":ident,**payload}
        save(REQUESTS,requests)
    return cash.write(action,requests[label])
def encode(value):return base64.b64encode(value).decode()
def csvbytes(rows,headers=None):
    headers=headers or list(rows[0])
    out=io.StringIO(newline=""); writer=csv.DictWriter(out,fieldnames=headers,lineterminator="\r\n")
    writer.writeheader();writer.writerows(rows);return out.getvalue().encode()
def map_for(headers):
    value=json.loads(json.dumps(model.DEFAULT_MAPPING))
    value["fields"]={k:{"column":k} for k in model.FIELD_NAMES if k in headers}
    value["note"]="Explicit local example fields; decimal major-unit signed originals, no assumed vendor layout."
    return value
COVERAGE={"start_date":"2026-10-11","end_date":"2026-10-11","session_ids":[],
          "payment_types":["card"],"currencies":["USD","EUR"],"complete":True,
          "note":"This local example file contains its complete declared one-day card report for the two example sessions.",
          "data_mode":"event_stream","source_system":"LOCAL-EXAMPLE","report_family":"example-day"}
def upload_lane(label,lane,raw,filename,captured="2026-10-12T00:00:00Z"):
    r=call(label+"-upload","upload",{"kind":lane,"filename":filename,"content_base64":encode(raw),
                                    "captured_at":captured,"coverage":COVERAGE,"owner":"Example operator"})
    cap=r["result"].get("capture",r["result"])
    mapped=call(label+"-mapping","mapping",{"capture_id":cap["id"],"mapping":map_for(cap["headers"]),
                                            "confirmed":True,"owner":"Example operator"})
    return mapped["result"]["id"]

def original_case():
    settings={"cohort":"berkeley-local-preserved-case","currency":"USD","currency_scale":2,
              "scope_note":"Local source-native fixture proving the existing permit comparator remains separate from daily finance.",
              "scenarios":[]}
    if workspace.state()["settings"]!=settings:
        workspace.settings({"revision":workspace.state()["revision"],"settings":settings})
    row={"id":"PERMIT-EXAMPLE-1","type":"permit","department":"Building","status":"Issued",
         "relatedIds":[],"reviewStates":{},"attachments":0,"paymentMinor":"10000"}
    raw=json.dumps({"cohort":settings["cohort"],"records":[row]}).encode()
    from intake import default_mapping
    for side in ("source","target"):
        existing=next((x for x in workspace.state()["datasets"] if x["side"]==side and x["sha256"]==hashlib.sha256(raw).hexdigest()),None)
        if existing is None:
            result=workspace.upload({"revision":workspace.state()["revision"],"side":side,"filename":"local-"+side+".json",
                                     "base64":encode(raw),"captured_at":"2026-10-12T00:00:00Z"})
            existing=next(x for x in workspace.state()["datasets"] if x["id"]==result["dataset_id"])
        if not existing["confirmed"]:
            workspace.mapping({"revision":workspace.state()["revision"],"dataset_id":existing["id"],
                               "mapping":default_mapping(existing["headers"])})
    label="Original permitting comparator — retained local example"
    existing=next((x for x in workspace.state()["runs"] if x["label"]==label),None)
    result={"run_id":existing["id"]} if existing else workspace.run({"revision":workspace.state()["revision"],"label":label})
    detail=workspace.detail(result["run_id"])
    assert not detail["input_errors"],detail["input_errors"]
    with workspace.db() as conn:
        case=conn.execute("SELECT * FROM cases WHERE run_id=?",(result["run_id"],)).fetchall()
    assert len(case)==1
    return {"run_id":result["run_id"],"case_count":len(case),"paymentMinor":"10000",
            "audit_sha256":hashlib.sha256((SOURCE/"audit.mjs").read_bytes()).hexdigest()}

def settings():
    value={**json.loads(json.dumps(model.DEFAULT_SETTINGS)),"scales":{"USD":2,"EUR":2},
           "balance_tolerance_minor":{"USD":"0","EUR":"0"},
           "required_lanes":["permits","receivables","processor","cashier"],
           "balance_payment_types":{"cashier":["card"],"processor":["card"]},
           "scope_note":"Explicit two-currency, one-day local example. These are not City financial observations."}
    call("financial-settings","settings",{"settings":value,"owner":"Example operator"})
    return value

HEADERS=["transaction_id","permit_id","invoice_id","fee_code","session_id","business_date","currency","event","status",
         "amount_minor","requested_minor","paid_minor","net_minor","related_transaction_id","denial_reason","payment_type"]
def row(tx,amount,currency="USD",session="EXAMPLE-CARD",event="payment",related="",status="included",permit="",invoice="",fee=""):
    result={k:"" for k in HEADERS}
    result.update(transaction_id=tx,permit_id=permit,invoice_id=invoice,fee_code=fee,session_id=session,
                  business_date="2026-10-11",currency=currency,event=event,status=status,amount_minor=amount,
                  related_transaction_id=related,payment_type="card")
    return result
P="9007199254740993123456789"
def source_inputs():
    permits=[row(P,"100.00",permit="P-1",invoice="I-1",fee="F-1"),
             row("P-REFUND","-10.00",event="refund",related=P,permit="P-1",invoice="I-1",fee="F-1"),
             row("P-VOID","-5.00",event="void",related=P,permit="P-1",invoice="I-1",fee="F-2"),
             row("P-EUR","3.10","EUR","EXAMPLE-EUR",permit="P-E",invoice="I-E",fee="F-E"),
             row("P-DENIAL","0.00",event="denial",status="denied",permit="P-D")]
    permits[-1].update(requested_minor="25.00",paid_minor="0.00",denial_reason="Local example decline; no payment moved.")
    receivables=[row("AR-1","60.00",invoice="I-1",fee="F-1"),row("AR-2","40.00",invoice="I-1",fee="F-1"),
                 row("AR-REFUND","-10.00",event="refund",related="AR-1",invoice="I-1"),
                 row("AR-VOID","-5.00",event="void",related="AR-1",invoice="I-1"),
                 row("AR-EUR","3.10","EUR","EXAMPLE-EUR",invoice="I-E")]
    processor=[row("SETTLEMENT-USD","85.00",event="settlement"),row("SETTLEMENT-EUR","3.10","EUR","EXAMPLE-EUR",event="settlement")]
    cashier=[row("CASHIER-USD","85.00",event="balance"),row("CASHIER-EUR","3.09","EUR","EXAMPLE-EUR",event="balance")]
    captures={}
    for lane,rows in (("permits",permits),("receivables",receivables),("processor",processor),("cashier",cashier)):
        raw=csvbytes(rows,HEADERS)
        (RUN/(lane+"-original.csv")).write_bytes(raw)
        captures[lane]=upload_lane(lane,lane,raw,lane+"-local-example.csv")
    # An identical source reacquired later must recover the original capture.
    duplicate=call("same-source-reacquisition","upload",{"kind":"permits","filename":"same-example-reacquired.csv",
        "content_base64":encode(csvbytes(permits,HEADERS)),"captured_at":"2026-10-12T01:00:00Z",
        "coverage":COVERAGE,"owner":"Example operator"})
    assert duplicate["result"]["duplicate"] and duplicate["result"]["capture"]["id"]==captures["permits"]
    return captures

def create_run():
    captures=state["steps"]["original-financial-sources"]["value"]
    out=call("create-financial-run","run",{"label":"ILLUSTRATIVE Berkeley daily close — local original files only",
              "start_date":"2026-10-11","end_date":"2026-10-11","capture_ids":list(captures.values()),
              "owner":"Example operator","note":"Worked local inputs; no City data or external posting."})
    detail=out["detail"]
    assert next(x for x in detail["rows"]["permits"] if x["transaction_id"]==P)["amount_minor"]=="10000"
    assert any(x["code"]=="daily_difference" and x["details"]["difference_minor"]=="-1" for x in detail["findings"])
    return {"run_id":detail["run"]["id"],"first_edit_revision":detail["run"]["edit_revision"],
            "first_edition_id":cash.read("/api/cashiering/runs/"+detail["run"]["id"]+"/editions",{})[0]["rows"][0]["id"]}

def correct_and_allocate():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    detail=cash.detail(run)
    eur=next(x for x in detail["rows"]["cashier"] if x["transaction_id"]=="CASHIER-EUR")
    corrected=call("correct-example-cashier-cent","correct",{"run_id":run,"record_key":eur["record_key"],
                   "changes":{"amount_minor":"310"},"owner":"Example operator",
                   "note":"Illustrative working correction to the source's reported3.09; raw original retained. A later corrected original will replace this proposal."})
    correction=corrected["result"]["id"]
    pairs=[(P,"AR-1","6000"),(P,"AR-2","4000"),("P-REFUND","AR-REFUND","-1000"),
           ("P-VOID","AR-VOID","-500"),("P-EUR","AR-EUR","310")]
    for index,(a,b,amount) in enumerate(pairs):
        detail=cash.detail(run)
        left=next(x for x in detail["groups"] if x["kind"]=="permits" and x["transaction_id"]==a)
        right=next(x for x in detail["groups"] if x["kind"]=="receivables" and x["transaction_id"]==b)
        call("allocation-"+str(index),"allocate",{"run_id":run,"source_group_id":left["id"],"target_group_id":right["id"],
             "amount_minor":amount,"owner":"Example operator","note":"Explicit local source-to-receivables allocation using the declared original transaction references."})
    detail=cash.detail(run)
    assert {x["currency"]:x["permit_minor"] for x in detail["totals"]}=={"USD":"8500","EUR":"310"}
    assert all(x["permit_remaining_minor"]=="0" and x["receivables_remaining_minor"]=="0" for x in detail["totals"])
    assert len(detail["findings"])==1 and detail["findings"][0]["code"]=="denied_observation"
    denial=detail["findings"][0]["id"]
    call("review-actual-example-decline","review",{"run_id":run,"finding_id":denial,"status":"accepted_exception",
         "owner":"Example supervisor","note":"This retained local decline moved zero paid amount; its requested25.00 remains distinct from paid0.00 and the follow-up disposition is retained."})
    return {"correction_id":correction,"denial_finding_id":denial,"allocation_count":5}

def signer(label,identity):
    run=state["steps"]["financial-run"]["value"]["run_id"]
    return call(label,"signoff",{"run_id":run,"reviewer_id":identity,"name":identity,"role":"Illustrative deposit reviewer",
                "statement":"I reviewed this exact retained local-example financial edition.",
                "note":"Local worked example signature only; no City staff identity is asserted."})
def source_bound_close():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    denial=state["steps"]["correction-and-many-to-many-allocation"]["value"]["denial_finding_id"]
    signer("reviewer-a-original","Example reviewer A")
    # A substantive review revision must not inherit the old signature.
    call("review-decline-rechecked","review",{"run_id":run,"finding_id":denial,"status":"accepted_exception",
         "owner":"Example supervisor","note":"Second review of the unchanged actual local decline evidence; disposition retained on this new review edition."})
    signer("reviewer-b-current","Example reviewer B")
    if not state.get("stale_close_observed"):
        before=cash.state()["revision"]
        try:
            cash.write("close",{"revision":before,"run_id":run,"owner":"Example supervisor","note":"This attempt should reject the earlier-edition signature.","deposit_document_ids":[]})
        except ValueError as exc:
            assert "reviewers" in str(exc)
            assert cash.state()["revision"]==before
            state["stale_close_observed"]=str(exc);save(CHECKPOINT,state)
        else:raise AssertionError("Stale earlier-edition signoff approved a later financial state.")
    signer("reviewer-a-renewed","Example reviewer A")
    close=call("close-reviewed-example","close",{"run_id":run,"owner":"Example supervisor",
                "note":"Close the explicitly labeled local example after two distinct current reviewers and the retained decline disposition.",
                "deposit_document_ids":[state["steps"]["original-financial-sources"]["value"]["cashier"]]})
    assert close["detail"]["run"]["status"]=="closed"
    return {"closing_id":close["result"]["id"],"snapshot_hash":close["detail"]["snapshot_hash"],"edit_revision":close["detail"]["run"]["edit_revision"]}

def prepared_exchange():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    profile=call("neutral-partner-layout","profile",{"name":"Local example receiving layout — not a Munis schema",
       "scope":"balances","lane":"permits","columns":[{"header":name,"field":field,"format":fmt} for name,field,fmt in [
        ("date","business_date","text"),("session","session_id","text"),("currency","currency","text"),
        ("permit_amount","expected_minor","major"),("cashier_amount","cashier_minor","major"),
        ("processor_amount","processor_minor","major")]],"delimiter":",","include_header":True,"line_ending":"CRLF",
       "owner":"Example operator","note":"Explicit local receiving layout for this worked source example; no vendor schema or external API is implied."})["result"]
    out=call("prepare-neutral-exchange","interface-prepare",{"run_id":run,"profile_id":profile["id"],"profile_version":profile["version"],
         "label":"Prepared local receiving example","owner":"Example operator","note":"Prepare only; no external transmission or posting."})
    export=out["result"]
    assert out["detail"]["interface_exports"][-1]["status"]=="prepared"
    raw=cash.read("/api/cashiering/artifacts/"+export["artifact_id"],{})[0]
    parsed=list(csv.DictReader(io.StringIO(raw.decode())))
    assert {x["currency"]:x["permit_amount"] for x in parsed}=={"USD":"85.00","EUR":"3.10"}
    sha=hashlib.sha256(raw).hexdigest();assert sha==export["sha256"]
    (RUN/"prepared-exchange.csv").write_bytes(raw)
    # This is an ACTUAL local parser/readback receipt, explicitly not a Munis/City receipt.
    receipt_path=RUN/"actual-local-receiving-readback.json"
    if not receipt_path.exists():
        save(receipt_path,{"system":"LOCAL-EXAMPLE-CSV-RECEIVER","observed_at":clock(),"status":"accepted",
            "sha256":sha,"bytes":len(raw),"parsed_rows":len(parsed),"headers":list(parsed[0]),
            "external_transmission":False,"external_posting":False,
            "meaning":"Actual local file readback only; this does not claim any City, Clariti, ACI or Munis acceptance."})
    receipt=json.loads(receipt_path.read_text())
    doc=call("retain-local-receiving-receipt","upload",{"kind":"document","filename":receipt_path.name,
        "content_base64":encode(receipt_path.read_bytes()),"captured_at":receipt["observed_at"],
        "coverage":{"note":receipt["meaning"]},"owner":"Example operator"})["result"]["capture"]
    observed=call("record-actual-local-receiver","interface-receipt",{"run_id":run,"export_id":export["id"],"status":"accepted",
         "observed_at":receipt["observed_at"],"reference":"LOCAL-EXAMPLE-CSV-RECEIVER:"+sha[:16],
         "document_id":doc["id"],"owner":"Example operator","note":receipt["meaning"]})
    assert observed["detail"]["closing"]["id"]==state["steps"]["same-edition-supervisor-close"]["value"]["closing_id"]
    assert observed["detail"]["snapshot_hash"]==state["steps"]["same-edition-supervisor-close"]["value"]["snapshot_hash"]
    return {"export_id":export["id"],"artifact_id":export["artifact_id"],"receipt_document_id":doc["id"],"row_count":len(parsed),"sha256":sha}

def original_precision():
    raw=('{"records":[{"transaction_id":9007199254740993123456789,"business_date":"2026-10-11",'
         '"currency":"USD","event":"balance","status":"included","amount_minor":0.00}]}').encode()
    cap=call("retain-unselected-lossless-json","upload",{"kind":"permits","filename":"unselected-native-number-example.json",
         "content_base64":encode(raw),"captured_at":"2026-10-12T00:00:00Z","coverage":COVERAGE,"owner":"Example operator"})["result"]["capture"]
    assert cap["preview"][0]["values"]["transaction_id"]==P
    assert cap["preview"][0]["types"]["transaction_id"]=="number"
    assert cap["preview"][0]["values"]["amount_minor"]=="0.00"
    call("confirm-unselected-lossless-json","mapping",{"capture_id":cap["id"],"mapping":map_for(cap["headers"]),
        "confirmed":True,"owner":"Example operator"})
    return {"capture_id":cap["id"],"original_sha256":cap["sha256"],"transaction_id":P,"amount_lexeme":"0.00"}

def packet_and_recovery():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    packet=call("prepare-complete-financial-packet","packet",{"run_id":run,"label":"Complete reviewed local example handoff",
        "owner":"Example supervisor","note":"Source-native local worked example. Original unselected captures stay outside this financial packet."})["result"]
    raw=cash.read("/api/cashiering/artifacts/"+packet["artifact_id"],{})[0]
    destination=RUN/"financial-handoff.zip";destination.write_bytes(raw)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest=json.loads(archive.read("manifest.json"))
        for member in manifest["members"]:
            value=archive.read(member["path"])
            assert len(value)==member["bytes"]
            assert hashlib.sha256(value).hexdigest()==member["sha256"]
        saved=json.loads(archive.read("run.json"))
        unselected=state["steps"]["lossless-unselected-original"]["value"]["capture_id"]
        assert unselected not in json.dumps(saved["manifest"])
        assert saved["closing"]["id"]==state["steps"]["same-edition-supervisor-close"]["value"]["closing_id"]
        assert saved["interface_exports"][-1]["status"]=="accepted"
        assert b"LOCAL-EXAMPLE-CSV-RECEIVER" in raw or "LOCAL-EXAMPLE-CSV-RECEIVER" in json.dumps(saved)
    backup=RUN/"complete-permitting-and-finance.sqlite"
    if not backup.exists():backup.write_bytes(workspace.backup())
    receiving=RUN/"receiving.sqlite"
    if not receiving.exists():restore(backup,receiving)
    received_workspace=Workspace(receiving)
    received_cash=Cashiering(received_workspace,Conflict)
    detail=received_cash.detail(run)
    assert detail["closing"]["id"]==state["steps"]["same-edition-supervisor-close"]["value"]["closing_id"]
    prior=state["steps"]["original-case-preservation"]["value"]
    assert received_workspace.detail(prior["run_id"])["public_report"]["sourceRecords"]==1
    assert received_cash.read("/api/cashiering/artifacts/"+packet["artifact_id"],{})[0]==raw
    # Original same-ID outcome recovery returns the original saved envelope.
    request_id=requests["prepare-complete-financial-packet"]["request_id"]
    recovered=received_cash.read("/api/cashiering/requests/"+request_id,{})[0]
    assert recovered["found"] and recovered["response"]["result"]["artifact_id"]==packet["artifact_id"]
    return {"packet_id":packet["id"],"artifact_id":packet["artifact_id"],"bytes":len(raw),
            "sha256":hashlib.sha256(raw).hexdigest(),"members":len(manifest["members"])+1,
            "backup_path":str(backup),"receiving_database":str(receiving),"source_run_id":run,
            "original_case_run_id":prior["run_id"]}

def corrected_original_refresh():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    captures=state["steps"]["original-financial-sources"]["value"]
    newrows=[row("CASHIER-USD","85.00",event="balance"),row("CASHIER-EUR","3.10","EUR","EXAMPLE-EUR",event="balance")]
    new_id=upload_lane("corrected-cashier","cashier",csvbytes(newrows,HEADERS),"corrected-cashier-local-example.csv","2026-10-12T02:00:00Z")
    out=call("receive-corrected-original","refresh",{"run_id":run,
         "capture_ids":[captures["permits"],captures["receivables"],captures["processor"],new_id],
         "owner":"Example operator","note":"Receive the actual newly authored corrected local original. Old original/correction/close remain retained."})
    assert out["detail"]["closing"] is None
    old_correction=state["steps"]["correction-and-many-to-many-allocation"]["value"]["correction_id"]
    assert any(x["code"]=="stale_correction" for x in out["detail"]["findings"])
    out=call("retire-now-replaced-working-correction","correction-retire",{"run_id":run,"correction_id":old_correction,
          "owner":"Example operator","note":"The corrected original now supplies3.10; retire only the prior working correction, preserving its full history."})
    # Unchanged denial-source evidence should retain its exact earlier disposition.
    current=out["detail"]
    assert current["counts"]["unaccepted_findings"]==0
    assert current["counts"]["active_allocations"]==5
    signer("reviewer-a-corrected-source","Example reviewer A")
    signer("reviewer-b-corrected-source","Example reviewer B")
    out=call("close-corrected-original-edition","close",{"run_id":run,"owner":"Example supervisor",
        "note":"Reviewed the actual corrected local source; prior close and immutable packet remain available.",
        "deposit_document_ids":[new_id]})
    assert out["detail"]["run"]["status"]=="closed"
    return {"capture_id":new_id,"closing_id":out["result"]["id"],"edit_revision":out["detail"]["run"]["edit_revision"],
            "snapshot_hash":out["detail"]["snapshot_hash"]}

def finish():
    run=state["steps"]["financial-run"]["value"]["run_id"]
    current=cash.detail(run)
    # Historical source selection and exact history cutoff remain inspectable.
    first=state["steps"]["financial-run"]["value"]["first_edition_id"]
    historical=cash.read("/api/cashiering/editions/"+first,{})[0]
    assert historical["historical"] and historical["run"]["edit_revision"]==1
    assert len(historical["allocations"])==0 and historical["closing"] is None
    assert not any(x["action"] in {"allocate","correct","close","packet","interface-prepare"} for x in historical["history"])
    prior=state["steps"]["original-case-preservation"]["value"]
    assert workspace.detail(prior["run_id"])["public_report"]["sourceRecords"]==1
    # Preserve same named daily case and original parent comparator for the one later UI continuation.
    result={"schema":"berkeley.cashiering.native-result.v1","status":"PASS","operation_id":OPERATION,
        "completed_at":clock(),"revision":cash.state()["revision"],"database_path":str(DB),
        "run_id":run,"original_case_run_id":prior["run_id"],"financial_edit_revision":current["run"]["edit_revision"],
        "snapshot_hash":current["snapshot_hash"],"totals":current["totals"],
        "counts":current["counts"],"source_ids":state["steps"]["original-financial-sources"]["value"],
        "corrected_source_id":state["steps"]["corrected-original-refresh"]["value"]["capture_id"],
        "prepared_exchange":state["steps"]["prepared-file-and-actual-local-receipt"]["value"],
        "handoff":state["steps"]["complete-packet-and-original-backup"]["value"],
        "source_root":str(SOURCE),"site_url":"http://127.0.0.1:8798","operator_path":"/cashiering/",
        "server_command":[sys.executable,"-B",str(SOURCE/"workspace/app.py"),"--db",str(DB),"--port","8798"],
        "example_basis":state["basis"],"external_transmissions":0,"external_postings":0,
        "browser_operation_started":False,"source_composition_sha256":composition_sha,"source_editions":state["source_editions"]}
    save(RUN/"result.json",result)
    return result

try:
    phase("original-case-preservation",original_case)
    phase("explicit-financial-settings",settings)
    phase("original-financial-sources",source_inputs)
    phase("financial-run",create_run)
    phase("correction-and-many-to-many-allocation",correct_and_allocate)
    phase("same-edition-supervisor-close",source_bound_close)
    phase("prepared-file-and-actual-local-receipt",prepared_exchange)
    phase("lossless-unselected-original",original_precision)
    phase("complete-packet-and-original-backup",packet_and_recovery)
    phase("corrected-original-refresh",corrected_original_refresh)
    phase("closed-example-and-history",finish)
    state["status"]="PASS";state["completed_at"]=clock();save(CHECKPOINT,state)
    print(json.dumps({"status":"PASS","result":str(RUN/"result.json")}),flush=True)
except Exception as exc:
    state["status"]="needs_continuation";state["error"]={"type":type(exc).__name__,"message":str(exc),"at":clock()}
    save(CHECKPOINT,state);traceback.print_exc();raise
