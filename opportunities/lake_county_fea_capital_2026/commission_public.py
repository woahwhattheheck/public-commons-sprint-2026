"""Bind the complete original public capture to the existing FEA operating API.

No network calls or guessed asset/model data are made here. The explicit
projection retains its full source records and file identities. Public
observations never become the authoritative client asset register.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from domain import TABLES, require, stable, decimal, identifier
from workspace import atomic, file_identity, safe_relative, MAX_FILE, RUNTIME_FILES
from operate import Programme

CASE = "fea-lake-county-capital-asset-workshare-20261012-018a"
SOURCE_OPERATION = "FEA-LAKE-COUNTY-PUBLIC-SOURCE-018A-20261012-01"

def exact(path, pin=None):
    path=Path(path).resolve()
    value=file_identity(path)
    require(value["bytes"]<=MAX_FILE,"public_file_limit",
            "A selected public input exceeds the complete per-file limit; retain it and partition its derived records explicitly.",
            {"path":str(path),"bytes":value["bytes"]})
    if pin:
        require(value=={"bytes":pin["bytes"],"sha256":pin["sha256"]},
                "public_source_identity","The selected complete original public file differs.",{"path":str(path)})
    return path,value

def selected_json(path, pin=None):
    path=Path(path)
    require(path.is_file() and not path.is_symlink(),"public_json_file","Select a regular retained JSON file.")
    with path.open("rb") as file:
        raw=file.read(MAX_FILE+1)
    require(len(raw)<=MAX_FILE,"public_file_limit","Retain the complete bounded selected JSON file.")
    measured={"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}
    if pin:
        require(measured=={key:pin[key] for key in ("bytes","sha256")},
                "public_json_identity","The decoded JSON differs from its original selected bytes.",{"path":str(path)},409)
    return json.loads(raw.decode("utf-8-sig"))

def decimal_text(value):
    if value is None or value=="": return value
    require(isinstance(value,(str,int)) and not isinstance(value,bool),
            "public_decimal","A public numeric projection requires an original integer or exact decimal string.")
    text=str(value)
    decimal(text)
    return text

def project(table, original):
    result={field:original.get(field) for field in TABLES[table]["fields"]}
    for field in TABLES[table]["decimal"]:
        result[field]=decimal_text(result.get(field))
    result["_original_source_record"]=original
    return result


def complete_capture(source_root, packet):
    """Verify the original collector's sealed files before deriving any input."""
    seal_path,seal_pin=exact(source_root/"capture-complete.json")
    seal=selected_json(seal_path,seal_pin)
    require(seal.get("schema")=="tjlabs.public-source.completed-capture.v1"
            and seal.get("operation_id")==SOURCE_OPERATION,
            "capture_complete","Retain the original completed source capture before commissioning.")
    seeds=[[row["source_id"],row["url"]] for row in packet["sources"]]
    expected=hashlib.sha256(json.dumps(seeds,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
    require(seal.get("source_selection_sha256")==expected,
            "capture_source_selection","The original capture selects different public sources.",status=409)
    archive=seal.get("archive",{})
    require(archive.get("path")=="Lake_County_FEA_Public_Source_20261012.zip",
            "capture_archive","Retain the original complete source archive.")
    archive_path=source_root/archive["path"]
    require(file_identity(archive_path)=={key:archive[key] for key in ("bytes","sha256")},
            "capture_archive_identity","The sealed complete source archive differs.",status=409)
    declared={}
    for row in seal.get("members",[]):
        relative=str(safe_relative(row["path"]))
        require(relative not in declared,"capture_members","The original capture repeats a member.")
        path=(source_root/relative).resolve()
        require(path.is_relative_to(source_root),"capture_member_path","A source member leaves its selected directory.")
        exact(path,row)
        declared[relative]={key:row[key] for key in ("bytes","sha256")}
    actual=[]
    for path in sorted(source_root.rglob("*")):
        relative=path.relative_to(source_root)
        if any(part in {"helpers","library-state"} for part in relative.parts):continue
        if path.name in {archive["path"],"capture-complete.json",".capture.lock"} or path.name.endswith(".tmp"):continue
        require(not path.is_symlink(),"capture_member_path","A captured source member is a symlink.")
        if path.is_file():actual.append(relative.as_posix())
    require(actual==list(declared),"capture_members","The complete captured source inventory differs.",status=409)
    require("capture-manifest.json" in declared,"capture_manifest","The complete capture has no manifest.")
    return {"path":str(seal_path),**seal_pin},{"path":str(archive_path),**{key:archive[key] for key in ("bytes","sha256")}},declared

def invocation_selection(args, packet_path, packet_pin, workshare_path, workshare_pin):
    browser_values=(args.node,args.playwright_module,args.browser_executable)
    require(all(browser_values) or not any(browser_values),"browser_selection","Select all three existing browser-runtime paths together.")
    application=Path(__file__).parent.resolve()
    return {
        "schema":"lake-county.public-intake-request/v1",
        "case_id":CASE,"operation_id":identifier(args.operation,"Original programme operation"),
        "actor":identifier(args.actor,"Actual local operator"),
        "source_root":str(Path(args.source_root).resolve()),
        "source_packet":{"path":str(packet_path),**packet_pin},
        "workshare_source":{"path":str(workshare_path),**workshare_pin},
        "workspace_root":str(Path(args.workspace).resolve()),"output_root":str(Path(args.output).resolve()),
        "receiving_root":str(Path(args.receiving).resolve()),"application_root":str(application),
        "application_files":[{"path":name,**exact(application/name)[1]} for name in RUNTIME_FILES],
        "browser":{key:str(Path(value).resolve()) for key,value in zip(
            ("node","playwright_module","browser_executable"),browser_values)} if all(browser_values) else None
    }

def build_selection(args):
    source_root=Path(args.source_root).resolve()
    output=Path(args.output).resolve()
    require(source_root.is_dir() and source_root!=output and not output.is_relative_to(source_root),
            "public_directory","Keep the operating output separate from its complete original source directory.")
    packet_path,packet_pin=exact(args.source_packet,{"bytes":args.source_packet_bytes,"sha256":args.source_packet_sha256})
    packet=selected_json(packet_path,packet_pin)
    require(packet.get("schema")=="tjlabs.fea-lake-county.public-input.v1"
            and packet.get("case_id")==CASE and packet.get("operation_id")==SOURCE_OPERATION,
            "public_packet","Select the original case's complete prepared public-source packet.")
    workshare_path,workshare_pin=exact(args.workshare_source,{"bytes":args.workshare_bytes,"sha256":args.workshare_sha256})
    request=invocation_selection(args,packet_path,packet_pin,workshare_path,workshare_pin)
    source_seal,source_archive,sealed_members=complete_capture(source_root,packet)
    selected=output/"public-operating-selection.json"
    selection_receipt=output/"public-operating-selection-receipt.json"
    if selected.exists() and selection_receipt.exists():
        receipt=selected_json(selection_receipt)
        require(receipt.get("schema")=="lake-county.public-intake-selection-receipt/v1"
                and receipt.get("operation_id")==args.operation,"public_selection_receipt","Retain the original intake selection receipt.",status=409)
        config=selected_json(selected,receipt["selection"])
        require(config.get("schema")=="lake-county.operating-selection/v1"
                and config.get("public_intake_request")==request,
                "public_intake_replay","Retain this operation's original source, actor, runtime and directory selection.",status=409)
        require(config.get("source_seal")==source_seal and config.get("source_archive")==source_archive,
                "public_capture_replay","Retain the exact original completed public capture.",status=409)
        exact(config["source_capture"]["path"],config["source_capture"])
        exact(config["workshare_source"]["path"],config["workshare_source"])
        for item in config["files"]:exact(item["path"],item)
        return selected,config
    capture_path=source_root/"capture-manifest.json"
    capture_pin=sealed_members["capture-manifest.json"]
    capture=selected_json(capture_path,capture_pin)
    require(capture.get("schema")=="tjlabs.public-source.capture.v1"
            and capture.get("operation_id")==SOURCE_OPERATION,
            "capture_selection","Retain the same original public-source capture operation.")
    originals={}
    for row in capture.get("sources",[]):
        key=identifier(row["source_id"],"Original public source")
        require(key not in originals,"public_sources","Original source identifiers must be unique.")
        if row.get("status")=="captured":
            safe_relative(row["body_path"])
            path=(source_root/row["body_path"]).resolve()
            require(path.is_relative_to(source_root),"public_source_path","The original source path leaves its selected directory.")
            exact(path,row)
        originals[key]=row
    prepared_sources={row["source_id"]:row for row in packet["sources"]}
    collections={}
    preparation=output/"public-intake"
    preparation.mkdir(parents=True,exist_ok=True,mode=0o700)
    def with_source(row,prepared=False):
        value=dict(row)
        source=originals.get(value.get("source_id"),{})
        if prepared:
            value["source_capture_status"]="prepared_reference_only"
            value["source_sha256"]=None
        elif source.get("status")=="captured":
            value["source_capture_status"]="verified_complete_original"
            value["source_sha256"]=source["sha256"]
            value["source_url"]=source.get("final_url") or source.get("requested_url") or value.get("source_url")
        else:
            value["source_capture_status"]="unavailable_selected_original"
            value["source_sha256"]=None
        if not value.get("source_url"):
            value["source_url"]=source.get("requested_url") or prepared_sources.get(value.get("source_id"),{}).get("url")
        if not value.get("source_locator"):
            value["source_locator"]=value.get("source_relationship") or value.get("parent_source_relationship")
        collection_path=value.get("feature_collection_path")
        if collection_path and not prepared:
            relative=str(safe_relative(collection_path))
            path=(source_root/relative).resolve()
            require(path.is_relative_to(source_root),"gis_source_path","The original GIS manifest leaves its selected capture.")
            require(relative in sealed_members,"gis_source_pin","The selected GIS manifest is absent from the original sealed capture.")
            if relative not in collections:
                collections[relative]=selected_json(path,sealed_members[relative])
            collection=collections[relative]
            value["source_note"]=(value.get("source_note") or "")+" Identifier coverage: "+str(
                collection.get("identifier_coverage_complete"))+"; value consistency: "+str(
                collection.get("value_consistency"))+". Complete raw geometry/attribute responses remain in the manifest's original page sources."
        
        return value
    def asset(row,prepared=False):
        value=with_source(row,prepared)
        if value.get("area") is None and value.get("area_acres") is not None:
            value["area"]=decimal_text(value["area_acres"])
            value["area_unit"]="acre"
            value["source_note"]=(value.get("source_note") or "")+" Source area_acres is retained as acres; no surveyed area is inferred."
        return project("asset_observations",value)
    def financial(row,prepared=False):
        return project("financial_observations",with_source(row,prepared))
    def capital(row,prepared=False):
        value=with_source(row,prepared)
        value["row_role"]="summary" if value.get("is_total") is True else "component" if value.get("is_total") is False else "unknown"
        return project("capital_rollforward",value)
    def proposed_funding(rows,prepared=False):
        result=[]
        selected={"anticipated_grant":("anticipated","component"),
                  "requested_county_funding":("requested","component"),
                  "proposed_project_total":("proposed","stated_total")}
        for row in rows:
            if row.get("record_kind") not in selected: continue
            source=with_source(row,prepared);status,role=selected[row["record_kind"]]
            value={"funding_id":row["observation_id"],"programme":row["scope"],"amount":decimal_text(row["amount"]),
                   "currency":row.get("currency"),"fiscal_year":None,"status":status,"amount_role":role,
                   "programme_scope":"study_programme","eligible_actions":None,
                   "conditions":"Retain the original memo and its proposed status. The memo date is not assumed to be an authorization or receipt year.",
                   "receipt_year":None,"receipt_status":"unknown",
                   "source_note":(row.get("source_note") or "")+" Source: "+str(source.get("source_url"))+
                       "; capture status: "+source["source_capture_status"]+
                       ". This study-project amount is not selected asset-capital cash."}
            result.append(project("funding",{**value,"_source_observation":source}))
        return result
    prepared_finance=packet["financial_observations"]
    baseline={"asset_observations":[asset(row,True) for row in packet["asset_observations"]],
              "financial_observations":[financial(row,True) for row in prepared_finance],
              "capital_rollforward":[capital(row,True) for row in packet.get("capital_rollforward",[])],
              "funding":proposed_funding(prepared_finance,True)}
    acquired_assets=selected_json(source_root/"observations"/"asset_observations.json",sealed_members["observations/asset_observations.json"])
    acquired_finance=selected_json(source_root/"observations"/"financial_observations.json",sealed_members["observations/financial_observations.json"])
    acquired_capital=selected_json(source_root/"observations"/"capital_rollforward_2024.json",sealed_members["observations/capital_rollforward_2024.json"])
    candidate={"asset_observations":[asset(row) for row in acquired_assets],
               "financial_observations":[financial(row) for row in acquired_finance],
               "capital_rollforward":[capital(row) for row in acquired_capital],
               "funding":proposed_funding(acquired_finance)}
    account_path=source_root/"observations"/"budget_2025_original_account_rows.json"
    if account_path.exists():
        accounts=selected_json(account_path,sealed_members["observations/budget_2025_original_account_rows.json"])
        candidate["budgets"]=[]
        for original in accounts:
            source=with_source(original)
            key="public-budget-"+hashlib.sha256(stable([original["source_id"],original["page_1_based"],
                original["line_on_extracted_page"],original["original_line"]]).encode()).hexdigest()[:28]
            candidate["budgets"].append(project("budgets",{
                "budget_observation_id":key,"fund":None,"account":original["account_code"],
                "fiscal_year":original["fiscal_year"],"column_label":"Complete original line; financial columns unreviewed",
                "basis":original.get("budget_status"),"amount":None,"currency":None,
                "source_note":original["original_line"]+" | "+original["column_mapping_status"],
                "_source_observation":source}))
    baseline_path=preparation/"prepared-public-registers.json"
    candidate_path=preparation/"captured-public-registers.json"
    def authored_json(path,value):
        data=(stable(value)+"\n").encode()
        atomic(path,data)
        return {"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
    baseline_pin=authored_json(baseline_path,baseline)
    candidate_pin=authored_json(candidate_path,candidate)
    projection={"schema":"lake-county.public-intake-projection/v1","case_id":CASE,"source_operation":SOURCE_OPERATION,
                "source_packet":{"path":str(packet_path),**packet_pin},
                "capture_manifest":{"path":str(capture_path),**capture_pin},
                "baseline_counts":{key:len(rows) for key,rows in baseline.items()},
                "candidate_counts":{key:len(rows) for key,rows in candidate.items()},
                "rules":[
                    "Each original record is retained in _original_source_record and the complete selected source file.",
                    "Exact JSON integers become decimal strings without arithmetic or exchange-rate conversion.",
                    "area_acres maps explicitly to area with unit acre; no dimension or valuation is inferred.",
                    "The source is_total flag maps to summary/component; all accounting rows stay separate.",
                    "Study funding components and their stated total keep separate roles; no memo date becomes funding or receipt timing.",
                    "Public observations are not the client asset register. A prepared reference does not become a verified captured original.",
                    "Historical account lines retain their source order and unknown financial columns. No budget amount is guessed.",
                    "No private model, appraisal, condition assessment, professional remaining life or capital forecast is generated."],
                "client_inputs_missing":["Original FEA/County asset register","Professional assessment and valuation inputs",
                    "Selected existing financial model/export and actual calculation environment",
                    "Confirmed model-period, currency and price basis","Actual owner review and approved commissioning dates"]}
    projection_pin=authored_json(preparation/"projection.json",projection)
    files=[];keys=set();documents=[];selected_paths={}
    def add(path,metadata,mime=None,expected=None):
        path,pin=exact(path,expected)
        if str(path) in selected_paths:
            previous=selected_paths[str(path)]
            require({name:previous[name] for name in ("bytes","sha256")}==pin,
                    "public_file_identity","A repeated selected source path changed.")
            return previous["key"]
        key="file-"+hashlib.sha256(str(path).encode()).hexdigest()[:24]
        require(key not in keys,"public_file_key","Retain each selected local file once.")
        keys.add(key)
        extension=path.suffix.lower()
        mime=mime or {".json":"application/json",".jsonl":"application/x-ndjson",".pdf":"application/pdf",
                      ".html":"text/html",".csv":"text/csv",".txt":"text/plain",".py":"text/x-python",
                      ".js":"text/javascript"}.get(extension,"application/octet-stream")
        item={"key":key,"path":str(path),**pin,"mime":mime,"metadata":metadata}
        files.append(item);selected_paths[str(path)]=item
        documents.append({"file_key":key,"table":"document","format":"document"})
        return key
    add(packet_path,{"source_kind":"prepared_public_source_packet","authority":"Original FEA public-source preparation",
                     "source_operation":SOURCE_OPERATION,"client_acceptance":False},expected=packet_pin)
    for path in sorted(source_root.rglob("*")):
        if not path.is_file():continue
        relative=path.relative_to(source_root)
        if path.suffix.lower()==".zip" or path.name==".capture.lock" or path.name.endswith(".tmp") or any(part in {"helpers","library-state"} for part in relative.parts):continue
        require(not path.is_symlink(),"public_source_path","Do not import source symlinks.")
        record=next((row for row in originals.values() if row.get("body_path")==relative.as_posix()),None)
        metadata={"source_kind":"public_original" if record else "public_capture_evidence",
                  "authority":record.get("authority","Lake County public-source capture") if record else "Original source collector",
                  "source_operation":SOURCE_OPERATION,"original_relative_path":relative.as_posix()}
        if record:
            metadata.update(source_url=record.get("final_url") or record.get("requested_url"),
                acquired_at_utc=record.get("acquired_at_utc"),source_date=record.get("source_date"),
                source_date_precision=record.get("source_date_precision"),source_id=record["source_id"])
        expected=source_seal if relative.as_posix()=="capture-complete.json" else sealed_members.get(relative.as_posix())
        require(expected is not None,"public_source_pin","Every imported captured source must belong to the original seal.")
        add(path,metadata,record.get("content_type") if record else None,expected=expected)
    first_key=add(baseline_path,{"source_kind":"prepared_public_observations","authority":"Explicit source-packet projection",
                               "projection":"public-intake/projection.json"},expected=baseline_pin)
    second_key=add(candidate_path,{"source_kind":"derived_public_observations","authority":"Explicit verified-capture projection",
                                  "projection":"public-intake/projection.json"},expected=candidate_pin)
    add(preparation/"projection.json",{"source_kind":"public_input_mapping","authority":"Original FEA operating selection"},expected=projection_pin)
    def register_selections(key,records):
        return [{"file_key":key,"table":table,"format":"json",
                 "mapping":{"columns":{field:field for field in TABLES[table]["fields"]},"json_pointer":"/"+table}}
                for table in records]
    config={"schema":"lake-county.operating-selection/v1","operation_id":args.operation,
            "actor":args.actor,"case_id":CASE,"workspace_root":str(Path(args.workspace).resolve()),
            "application_root":str(Path(__file__).parent.resolve()),"output_root":str(output),
            "receiving_root":str(Path(args.receiving).resolve()),
            "workshare_source":{"path":str(workshare_path),**workshare_pin},
            "source_capture":projection["capture_manifest"],"source_projection":projection,
            "source_seal":source_seal,"source_archive":source_archive,"public_intake_request":request,
            "files":files,
            "editions":[
                {"key":"prepared-public","name":"Prepared public source observations","selections":register_selections(first_key,baseline)},
                {"key":"captured-public","name":"Complete selected public source capture and dated registers",
                 "predecessor_key":"prepared-public","selections":documents+register_selections(second_key,candidate)}],
            "comparisons":[{"key":"prepared-to-captured","baseline_key":"prepared-public","candidate_key":"captured-public",
                            "tables":list(candidate)}],
            "exchanges":[],"scenarios":[],
            "reviews":[{"kind":"edition","key":"captured-public","status":"follow_up","capacity":"internal_operator",
                "note":"Internal source intake completed. Public reference, capture-status, ownership, accounting and funding distinctions remain explicit. FEA/County source register, professional findings, selected model and client approval remain required."}],
            "publication":{"name":"Lake County / FEA — public source and capital-program commissioning",
                           "edition_key":"captured-public","kind":"internal_working","scenario_keys":[]}}
    if request["browser"]:
        config["browser"]=request["browser"]
    selected_pin=authored_json(selected,config)
    atomic(selection_receipt,(stable({"schema":"lake-county.public-intake-selection-receipt/v1",
        "operation_id":args.operation,"selection":{"path":str(selected),**selected_pin}})+"\n").encode())
    return selected,config

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("source-root","source-packet","source-packet-sha256","workshare-source","workshare-sha256",
                 "workspace","output","receiving","actor","operation"):
        parser.add_argument("--"+name,required=True)
    parser.add_argument("--source-packet-bytes",required=True,type=int)
    parser.add_argument("--workshare-bytes",required=True,type=int)
    parser.add_argument("--node")
    parser.add_argument("--playwright-module")
    parser.add_argument("--browser-executable")
    parser.add_argument("--prepare-only",action="store_true")
    args=parser.parse_args()
    selected,config=build_selection(args)
    if args.prepare_only:
        print(stable({"selection":str(selected),**file_identity(selected),
                      "source_projection":config["source_projection"]}),flush=True)
    else:
        print(stable(Programme(config).finish()),flush=True)

if __name__=="__main__":
    main()
