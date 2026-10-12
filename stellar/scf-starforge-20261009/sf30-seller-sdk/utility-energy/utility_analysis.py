"""MIT. Interval selection, correction review, coverage and bill reconciliation."""
from __future__ import annotations

from bisect import bisect_left
from collections import defaultdict, Counter
from decimal import Decimal, localcontext
import json

from utility_shared import InputError, json_bytes
from utility_source import sha, text
from utility_time import decimal, decimal_text, instant, utc, duration_text, local, zone

SCHEMA = "stellar-forge.utility-analysis.v1"

def identifiers(value, label, maximum=500):
    if not isinstance(value,list) or len(value)>maximum or any(not isinstance(x,str) or not x or len(x)>2048 for x in value):
        raise InputError(label+" must be a list of complete identifiers")
    if len(set(value))!=len(value):raise InputError(label+" contains duplicate identifiers")
    return list(value)

def selection(raw):
    if not isinstance(raw,dict):raise InputError("Supply an interval review selection")
    allowed={"name","import_ids","series_ids","start","end","timezone","preferred_import_ids","choose_rows","exclude_rows","overlap_strategy"}
    if set(raw)-allowed:raise InputError("Unknown interval selection fields")
    result={"name":text(raw.get("name","Utility receiving"),"Review name",128),
            "import_ids":identifiers(raw.get("import_ids",[]),"Source imports"),
            "series_ids":identifiers(raw.get("series_ids",[]),"Meter channels",5000),
            "preferred_import_ids":identifiers(raw.get("preferred_import_ids",[]),"Preferred source editions"),
            "timezone":raw.get("timezone","source"),"start":raw.get("start"),"end":raw.get("end"),
            "choose_rows":raw.get("choose_rows",{}),"exclude_rows":raw.get("exclude_rows",[]),
            "overlap_strategy":raw.get("overlap_strategy","review")}
    if not result["import_ids"]:raise InputError("Select at least one retained source import")
    if set(result["preferred_import_ids"])-set(result["import_ids"]):
        raise InputError("Preferred editions must be selected source imports")
    if result["timezone"]!="source":zone(result["timezone"])
    if result["overlap_strategy"] not in {"review","prefer-shorter","prefer-longer"}:
        raise InputError("Choose review, prefer-shorter or prefer-longer for overlapping intervals")
    if result["start"] is not None:instant(result["start"])
    if result["end"] is not None:instant(result["end"])
    if result["start"] and result["end"] and instant(result["end"])<=instant(result["start"]):
        raise InputError("The selected window must end after it starts")
    chosen=result["choose_rows"]
    if not isinstance(chosen,dict) or len(chosen)>100000 or any(not isinstance(k,str) or not isinstance(v,str) for k,v in chosen.items()):
        raise InputError("Choose complete logical reading and original row identifiers")
    exclusions=result["exclude_rows"]
    if not isinstance(exclusions,list) or len(exclusions)>100000:
        raise InputError("Supply explicit excluded rows and reasons")
    ids=set()
    for item in exclusions:
        if not isinstance(item,dict) or set(item)!={"row_id","reason"} or item["row_id"] in ids:
            raise InputError("Each excluded row needs one unique original row_id and reason")
        text(item["row_id"],"Excluded row",64);text(item["reason"],"Exclusion reason",4096)
        ids.add(item["row_id"])
    return result

def issue(code,message,**detail):
    value={"code":code,"message":message,**detail}
    value["id"]=sha(json_bytes(value))
    return value

def measurement(row):
    return {k:row.get(k) for k in ["value","value_state","unit","channel","quantity_semantics",
            "quality","cost","reading_type","local_time_parameters"]}

def display(row,key,tz):
    if row.get(key+"_us") is None:return ""
    if tz!="source":return local(row[key+"_us"],tz)
    return row.get(key+"_local") or row.get(key+"_original") or row[key+"_utc"]

def _coverage(rows,start=None,end=None):
    intervals=sorted((r["start_us"],r["end_us"],r["row_id"]) for r in rows if r["start_us"] is not None)
    if not intervals:
        return {"start":utc(start) if start is not None else None,"end":utc(end) if end is not None else None,
                "covered_seconds":"0","window_seconds":duration_text(start,end) if start is not None and end is not None else "0",
                "gaps":[{"start":utc(start),"end":utc(end),"seconds":duration_text(start,end)}] if start is not None and end is not None and end>start else [],"overlap_groups":[]}
    lower=start if start is not None else intervals[0][0]
    upper=end if end is not None else max(x[1] for x in intervals)
    gaps=[];groups=[];cursor=lower;covered=0;group=[];group_end=None;group_start=None
    for first,last,row_id in intervals:
        first,last=max(first,lower),min(last,upper)
        if last<=first:continue
        if first>cursor:gaps.append({"start":utc(cursor),"end":utc(first),"seconds":duration_text(cursor,first)})
        if last>cursor:covered+=last-max(first,cursor);cursor=last
        if group and first>=group_end:
            if len(group)>1:groups.append({"start":utc(group_start),"end":utc(group_end),"row_ids":group})
            group=[]
        if not group:group_start=first;group_end=last
        group.append(row_id);group_end=max(group_end,last)
    if len(group)>1:groups.append({"start":utc(group_start),"end":utc(group_end),"row_ids":group})
    if cursor<upper:gaps.append({"start":utc(cursor),"end":utc(upper),"seconds":duration_text(cursor,upper)})
    return {"start":utc(lower),"end":utc(upper),"covered_seconds":duration_text(0,covered),
            "window_seconds":duration_text(lower,upper),"gaps":gaps,"overlap_groups":groups}

def _sum(rows,key):
    values=[r.get(key) for r in rows]
    if not values or any(v in {None,""} for v in values):return None
    with localcontext() as context:
        context.prec=1024
        return decimal_text(sum((decimal(v) for v in values),Decimal(0)))

def analyze(all_rows,raw_selection,imports):
    chosen=selection(raw_selection)
    selected_imports={x["id"]:x for x in imports if x["id"] in chosen["import_ids"]}
    if set(selected_imports)!=set(chosen["import_ids"]):raise InputError("A selected source import is missing")
    rows=[r for r in all_rows if r["import_id"] in selected_imports]
    if chosen["series_ids"]:
        rows=[r for r in rows if r["series_id"] in chosen["series_ids"]]
    by_id={r["row_id"]:r for r in rows}
    exclusions={x["row_id"]:x["reason"] for x in chosen["exclude_rows"]}
    if set(exclusions)-set(by_id):raise InputError("An excluded row is outside the selected source/channel set")
    lower=instant(chosen["start"]) if chosen["start"] else None
    upper=instant(chosen["end"]) if chosen["end"] else None
    notes=[];removed=[];equivalent=[];groups=defaultdict(list)
    for item in selected_imports.values():
        for original in item["metadata"].get("issues",[]):
            notes.append(issue("source-"+original["code"],original["message"],import_id=item["id"],source_issue=original))
    for row in rows:
        ident=row["row_id"]
        if ident in exclusions:
            removed.append({"row_id":ident,"reason":exclusions[ident],"method":"explicit"})
            continue
        if row["start_us"] is not None and ((lower is not None and row["end_us"]<=lower) or (upper is not None and row["start_us"]>=upper)):
            removed.append({"row_id":ident,"reason":"Outside the selected window","method":"window"})
            continue
        for original in row.get("issues",[]):
            notes.append(issue(original["code"],original["message"],row_id=ident,source_issue=original))
        if row["start_us"] is None:
            notes.append(issue("invalid-reading-time","This original reading cannot be placed on the time axis",row_ids=[ident]))
        groups[row["logical_key"]].append(row)
    priority={ident:position for position,ident in enumerate(chosen["preferred_import_ids"])}
    accepted=[];conflicts=[]
    for logical,items in groups.items():
        selected=None
        explicit=chosen["choose_rows"].get(logical)
        if explicit is not None:
            selected=next((r for r in items if r["row_id"]==explicit),None)
            if selected is None:raise InputError("A correction choice is outside its original logical reading")
        signatures={sha(json_bytes(measurement(r))) for r in items}
        if selected is None and len(signatures)==1:
            selected=min(items,key=lambda r:(priority.get(r["import_id"],len(priority)),r["row_id"]))
        if selected is None and priority:
            ranked=sorted(items,key=lambda r:priority.get(r["import_id"],len(priority)))
            if ranked[0]["import_id"] in priority and (len(ranked)==1 or
                    priority.get(ranked[0]["import_id"])<priority.get(ranked[1]["import_id"],len(priority))):
                selected=ranked[0]
        if selected is None:
            conflict={"logical_key":logical,"candidates":[{"row_id":r["row_id"],"import_id":r["import_id"],"value":r["value"],
                "value_raw":r["value_raw"],"unit":r["unit"],"quality":r["quality"],"start":r["start_utc"],"end":r["end_utc"],
                "source_path":r["source_path"]} for r in items]}
            conflicts.append(conflict)
            notes.append(issue("correction-choice","Choose the source reading for this corrected interval",**conflict))
            continue
        accepted.append(selected)
        if len(items)>1:
            equivalent.append({"logical_key":logical,"selected_row_id":selected["row_id"],"row_ids":[r["row_id"] for r in items],
                               "equal_measurements":len(signatures)==1,
                               "method":"explicit" if explicit else "equivalent" if len(signatures)==1 else "source-preference"})
    unknown_choices=set(chosen["choose_rows"])-set(groups)
    if unknown_choices:raise InputError("A correction choice does not belong to this selected source/window")
    if chosen["overlap_strategy"]!="review":
        original=defaultdict(list)
        for row in accepted:original[row["series_id"]].append(row)
        accepted=[]
        for values in original.values():
            timed=[r for r in values if r["start_us"] is not None]
            invalid=[r for r in values if r["start_us"] is None]
            direction=1 if chosen["overlap_strategy"]=="prefer-shorter" else -1
            timed.sort(key=lambda r:(direction*(r["end_us"]-r["start_us"]),
                priority.get(r["import_id"],len(priority)),r["start_us"],r["row_id"]))
            starts=[];kept=[]
            for row in timed:
                index=bisect_left(starts,row["start_us"])
                overlaps=(index>0 and kept[index-1]["end_us"]>row["start_us"]) or (index<len(kept) and kept[index]["start_us"]<row["end_us"])
                if overlaps:
                    removed.append({"row_id":row["row_id"],"reason":"Overlaps a whole interval selected by "+chosen["overlap_strategy"],
                                    "method":chosen["overlap_strategy"]})
                else:
                    starts.insert(index,row["start_us"]);kept.insert(index,row)
            accepted.extend(kept+invalid)
    accepted.sort(key=lambda r:(r["series_id"],r["start_us"] if r["start_us"] is not None else -1,r["row_id"]))
    series=defaultdict(list)
    for row in accepted:series[row["series_id"]].append(row)
    summaries=[]
    for ident,items in series.items():
        valid=[r for r in items if r["start_us"] is not None]
        coverage=_coverage(valid,lower,upper)
        for gap in coverage["gaps"]:
            notes.append(issue("coverage-gap","No selected original reading covers this period",series_id=ident,**gap))
        for overlap in coverage["overlap_groups"]:
            notes.append(issue("overlapping-readings","Selected original intervals overlap in this meter channel",series_id=ident,**overlap))
        boundaries=[r["row_id"] for r in valid if (lower is not None and r["start_us"]<lower) or (upper is not None and r["end_us"]>upper)]
        if boundaries:notes.append(issue("window-boundary","Whole original intervals cross the selected window boundary",series_id=ident,row_ids=boundaries))
        daily=defaultdict(list);spanning=[]
        for row in valid:
            first=display(row,"start",chosen["timezone"]);last=display(row,"end",chosen["timezone"])
            try:
                # Inclusive start and exclusive end: midnight belongs to the preceding bucket.
                last_instant=dict(row);last_instant["end_us"]=row["end_us"]-1
                last_instant["end_utc"]=utc(last_instant["end_us"])
                if chosen["timezone"]=="source":
                    from datetime import datetime,timedelta
                    end_date=(datetime.fromisoformat(last.replace("Z","+00:00"))-timedelta(microseconds=1)).date().isoformat()
                else:end_date=local(last_instant["end_us"],chosen["timezone"])[:10]
                if first[:10]!=end_date:spanning.append(row["row_id"])
                else:daily[first[:10]].append(row)
            except (ValueError,TypeError):spanning.append(row["row_id"])
        first=items[0]
        summaries.append({"series_id":ident,"meter_id":first["meter_id"],"channel":first["channel"],"unit":first["unit"],
            "measurement_meter":first.get("measurement_meter",""),"reading_type":first.get("reading_type_view",first.get("reading_type",{})),
            "rows":len(items),"valid_timed_rows":len(valid),"durations":dict(Counter(r["duration_seconds"] for r in valid)),
            "qualities":dict(Counter(q for r in items for q in r.get("quality_names",r.get("quality",[])))),
            "coverage":coverage,"observed_energy_kwh":_sum(valid,"energy_kwh") if not coverage["overlap_groups"] and not boundaries else None,
            "observed_value_sum":_sum(valid,"value") if not coverage["overlap_groups"] and not boundaries and all(r["quantity_semantics"] in {"interval-energy","interval-quantity"} for r in valid) else None,
            "maximum_source_power_kw":decimal_text(max(decimal(r["power_kw"]) for r in valid if r.get("power_kw"))) if any(r.get("power_kw") for r in valid) else None,
            "daily":[{"date":day,"rows":len(items),"energy_kwh":_sum(items,"energy_kwh")} for day,items in sorted(daily.items())]
                    if not coverage["overlap_groups"] else [],
            "crosses_local_day":spanning,"partial_window_rows":boundaries,
            "first_local":display(valid[0],"start",chosen["timezone"]) if valid else "",
            "last_local":display(valid[-1],"end",chosen["timezone"]) if valid else ""})
    report={"schema":SCHEMA,"selection":chosen,"sources":[{"id":x["id"],"source_sha256":x["source_sha256"],"metadata_sha256":x["metadata_sha256"]}
              for x in selected_imports.values()],"input_rows":len(rows),"selected_rows":len(accepted),
            "selected_row_ids":[r["row_id"] for r in accepted],"equivalent_and_corrected":equivalent,
            "excluded":removed,"conflicts":conflicts,"series":summaries,"issues":notes,
            "can_build":not conflicts and all(r["start_us"] is not None for r in accepted) and bool(accepted),
            "can_export_load":not conflicts and bool(accepted) and all(not s["coverage"]["overlap_groups"] and not s["partial_window_rows"] for s in summaries)
                             and all(r["start_us"] is not None and r["energy_kwh"]!="" for r in accepted)}
    report["sha256"]=sha(json_bytes(report))
    return report,accepted

def bill_reconciliation(bills,charges,rows,*,bill_series=None):
    links=bill_series or {}
    if not isinstance(links,dict):raise InputError("Bill-to-channel links must be an object of bill row IDs to series IDs")
    series=defaultdict(list)
    for row in rows:series[row["series_id"]].append(row)
    result=[]
    for bill in bills:
        meter_channels={ident:items for ident,items in series.items() if items[0]["meter_id"]==bill["meter_id"]}
        selected=links.get(bill["row_id"])
        candidates=[ident for ident,items in meter_channels.items()
                    if items[0]["channel"] in {"net","espi:net:12","espi:forward:12"} and any(r["energy_kwh"]!="" for r in items)]
        if selected is None and len(candidates)==1:selected=candidates[0]
        if selected is not None and selected not in meter_channels:
            raise InputError("The selected bill channel belongs to a different original meter")
        value={"bill_row_id":bill["row_id"],"bill_id":bill["provider_object_id"],"meter_id":bill["meter_id"],
               "start":bill["start_utc"],"end":bill["end_utc"],"bill_volume":bill["volume"],
               "bill_volume_raw":bill["volume_raw"],"bill_unit":bill["unit"],"bill_cost":bill["cost"],
               "currency":bill["currency"],"series_id":selected,"candidate_series":candidates,
               "line_item_sum":None,"line_item_difference":None,"observed_energy_kwh":None,
               "billed_energy_kwh":None,"energy_difference_kwh":None,"status":"choose-channel","notes":[]}
        own=[c for c in charges if c["bill_row_id"]==bill["row_id"] and c["section"]=="line_items"]
        if own and all(c["cost_state"]=="value" and c["cost"]!="" for c in own):
            with localcontext() as context:
                context.prec=1024
                value["line_item_sum"]=decimal_text(sum((decimal(c["cost"]) for c in own if c["cost"]!=""),Decimal(0)))
                if bill["cost"]!="":value["line_item_difference"]=decimal_text(decimal(value["line_item_sum"])-decimal(bill["cost"]))
            value["notes"].append("Line items and total bill charges can differ in the provider contract; supplier, TOU, tier and demand blocks remain separate.")
        if bill["start_us"] is None:
            value["status"]="invalid-billing-period";result.append(value);continue
        if selected is None:
            result.append(value);continue
        first,last=bill["start_us"],bill["end_us"]
        overlapping=[r for r in meter_channels[selected] if r["start_us"] is not None and r["start_us"]<last and r["end_us"]>first]
        complete=[r for r in overlapping if r["start_us"]>=first and r["end_us"]<=last]
        complete_ids={r["row_id"] for r in complete}
        partial=[r["row_id"] for r in overlapping if r["row_id"] not in complete_ids]
        coverage=_coverage(complete,first,last)
        value.update(coverage=coverage,contained_rows=len(complete),boundary_rows=partial,
                     status="complete-coverage" if not coverage["gaps"] and not coverage["overlap_groups"] and not partial else "coverage-difference")
        if not coverage["overlap_groups"] and not partial:
            value["observed_energy_kwh"]=_sum(complete,"energy_kwh")
        if bill["unit"]=="kwh" and bill["volume"]!="":value["billed_energy_kwh"]=bill["volume"]
        elif bill.get("energy_kwh"):value["billed_energy_kwh"]=bill["energy_kwh"]
        elif bill["unit"]=="espi:72" and bill["volume"]!="":
            from utility_time import scale
            value["billed_energy_kwh"]=scale(bill["volume"],-3)
        if value["billed_energy_kwh"] is not None and value["observed_energy_kwh"] is not None:
            with localcontext() as context:
                context.prec=1024
                value["energy_difference_kwh"]=decimal_text(decimal(value["observed_energy_kwh"])-decimal(value["billed_energy_kwh"]))
        result.append(value)
    return {"schema":"stellar-forge.utility-bill-reconciliation.v1","bills":result,"links":links}

def projection(row,provenance):
    return {"logical_key":row["logical_key"],"row_id":row["row_id"],"meter_id":row["meter_id"],
            "series_id":row["series_id"],"channel":row["channel"],"measurement_meter":row.get("measurement_meter",""),
            "start_utc":row["start_utc"],"end_utc":row["end_utc"],"duration_seconds":row["duration_seconds"],
            "start_local":row.get("start_local") or row.get("start_original") or row["start_utc"],
            "end_local":row.get("end_local") or row.get("end_original") or row["end_utc"],
            "source_value":row["value_raw"],"scaled_value":row["value"],"source_unit":row["unit"],
            "power_of_ten":row["power_of_ten"],"energy_kwh":row["energy_kwh"],"power_kw":row["power_kw"],
            "quantity_semantics":row["quantity_semantics"],"quality_json":json.dumps(row.get("quality_names",row["quality"]),ensure_ascii=False),
            "source_sha256":row["source_sha256"],"source_path":row["source_path"],
            "provenance_json":json.dumps(provenance,ensure_ascii=False,separators=(",",":"))}

def mapping(name="Reviewed utility intervals"):
    names=["logical_key","row_id","meter_id","series_id","channel","measurement_meter","start_utc","end_utc",
           "duration_seconds","start_local","end_local","source_value","scaled_value","source_unit","power_of_ten",
           "energy_kwh","power_kw","quantity_semantics","quality_json","source_sha256","source_path","provenance_json"]
    return {"schema":"stellar-forge.ndjson-mapping.v1","name":name,"recordPath":[],
            "columns":[{"name":key,"path":[key],"type":"string","nullable":False,"mode":"scalar","missing":"error"} for key in names],
            "keys":["logical_key"],"filters":["meter_id","series_id","channel","source_unit"],"ranges":["start_utc","end_utc"],
            "sorts":["start_utc","end_utc","meter_id"],"defaultLimit":100,"maxLimit":1000,"maxRows":1000000,"maxCellChars":1048576}
