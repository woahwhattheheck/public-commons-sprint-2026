"""MIT. Complete UtilityAPI blocks and Green Button Atom/ESPI receiving.

Every projected record identifies its original source and location. Decimal
tokens, unknown fields, original XML bytes and provider notes are retained.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from utility_shared import InputError, json_bytes, source_json, source_xml
from utility_time import decimal, decimal_text, scale, instant, epoch_seconds, utc, duration_text, source_local
from utility_contracts import FLOW, UOM, QUALITY, CURRENCY, reading_type_view

ATOM = "{http://www.w3.org/2005/Atom}"
ESPI = "{http://naesb.org/espi}"
XML_BASE = "{http://www.w3.org/XML/1998/namespace}base"
MAX_BYTES = 256 * 1024 * 1024
VERSION = "stellar-forge.utility-source.v1"
COLLECTIONS = ("meters", "bills", "charges", "intervals", "resources")
SHA = __import__("re").compile(r"[0-9a-f]{64}\Z")

def sha(data):
    return hashlib.sha256(data).hexdigest()

def text(value, label, maximum=512, empty=False):
    if not isinstance(value,str) or len(value)>maximum or "\0" in value or (not empty and not value.strip()):
        raise InputError(label + " must be " + ("nonempty " if not empty else "") + "text")
    return value

def exact_json(data):
    try:
        value = json.loads(data, parse_int=source_json.JsonNumber, parse_float=source_json.JsonNumber,
                           object_pairs_hook=source_json._pairs, parse_constant=source_json._constant)
        source_json._validate_tree(value)
        return value
    except (UnicodeError,json.JSONDecodeError,RecursionError) as error:
        raise InputError("Use a complete UTF-8 JSON response without comments or repeated keys") from error

def raw_json(value):
    return source_json.exact_json(value)

def value_state(value, key):
    return "missing" if key not in value else "null" if value[key] is None else "value"

def string(value):
    return "" if value is None else str(value)

def uid(value, label):
    # Provider UIDs are opaque strings, including leading zeroes.
    if not isinstance(value,str) or isinstance(value,source_json.JsonNumber):
        raise InputError(label+" must retain its original string UID")
    return text(value,label,2048)

def normalized_number(value, issues, label):
    if value is None:
        return ""
    try:
        return decimal_text(decimal(value,label))
    except InputError as error:
        issues.append({"code":"invalid-number","message":str(error),"value":string(value)})
        return ""

def normalized_period(start, end, issues):
    try:
        first,last=instant(start),instant(end)
        if last<=first:
            raise InputError("The source end must follow its start")
        return {"start_us":first,"end_us":last,"start_utc":utc(first),"end_utc":utc(last),
                "duration_seconds":duration_text(first,last)}
    except InputError as error:
        issues.append({"code":"invalid-period","message":str(error),"start":start,"end":end})
        return {"start_us":None,"end_us":None,"start_utc":"","end_utc":"","duration_seconds":""}

def entity(source_sha, provider, kind, pointer, original, **values):
    record={"record_type":kind,"provider":provider,"source_sha256":source_sha,"source_path":pointer,
            "raw_json":raw_json(original) if provider=="utilityapi" else json.dumps(original,ensure_ascii=False,separators=(",",":")),
            **values}
    record["row_id"]=sha(json_bytes([source_sha,kind,pointer]))
    return record

def _objects(document, kind):
    if isinstance(document,dict) and kind in document:
        result=document[kind]
    elif isinstance(document,list):
        result=document
    elif isinstance(document,dict) and "uid" in document:
        result=[document]
    else:
        return []
    if not isinstance(result,list) or any(not isinstance(item,dict) for item in result):
        raise InputError("The original "+kind+" response must contain complete objects")
    return result

def decode_utilityapi(data, source_sha, kind="auto"):
    if kind in BLOCK_KINDS:return decode_blocks(data,source_sha,kind)
    document=exact_json(data)
    if kind not in {"auto","meters","bills","intervals","bundle"}:
        raise InputError("Choose UtilityAPI meters, bills, intervals or a retained bundle")
    if kind=="auto":
        if not isinstance(document,dict):
            raise InputError("Choose the collection for an original top-level array")
        found=[k for k in ("meters","bills","intervals") if k in document]
        if found:
            kind="bundle" if len(found)>1 else found[0]
        elif "readings" in document:
            kind="intervals"
        elif "base" in document and isinstance(document["base"],dict) and "bill_start_date" in document["base"]:
            kind="bills"
        elif "uid" in document:
            kind="meters"
        else:
            raise InputError("Choose the collection for this original UtilityAPI object")
    output={name:[] for name in COLLECTIONS}
    metadata={"provider":"utilityapi","kind":kind,"source_sha256":source_sha,
              "collectionState":{},"issues":[],"retainedNumericTokens":True}
    selected=("meters","bills","intervals") if kind=="bundle" else (kind,)
    if isinstance(document,dict):
        metadata["collectionState"]={key:document[key] for key in ("next","is_incomplete","error") if key in document}
        if document.get("is_incomplete") is True:
            metadata["issues"].append({"code":"provider-incomplete","message":"UtilityAPI marked this response incomplete"})
        if document.get("next"):
            metadata["issues"].append({"code":"next-page","message":"This original response has a continuation","next":document["next"]})
    for collection in selected:
        objects=_objects(document,collection)
        for index,obj in enumerate(objects):
            pointer="/"+collection+"/"+str(index)
            ident=uid(obj.get("uid"),"UtilityAPI object UID")
            base=obj.get("base") or {}
            if not isinstance(base,dict):
                raise InputError("A UtilityAPI base block must be an object or null")
            meter=ident if collection=="meters" else uid(obj.get("meter_uid"),"UtilityAPI meter UID")
            common={"meter_id":meter,"provider_object_id":ident,"utility":string(obj.get("utility")),
                    "service_identifier":string(base.get("service_identifier")),
                    "service_address":string(base.get("service_address")),
                    "service_tariff":string(base.get("service_tariff")),
                    "meter_numbers":base.get("meter_numbers",[]),"notes":obj.get("notes",[]),
                    "updated":string(obj.get("updated",obj.get("created")))}
            output["resources"].append(entity(source_sha,"utilityapi","resource",pointer,obj,
                resource_type=collection[:-1],resource_id=ident,meter_id=meter))
            if collection=="meters":
                output["meters"].append(entity(source_sha,"utilityapi","meter",pointer,obj,**common,
                    billing_contact=string(base.get("billing_contact")),
                    bill_coverage=obj.get("bill_coverage",[]),interval_coverage=obj.get("interval_coverage",[]),
                    status=string(obj.get("status")),is_expanded=obj.get("is_expanded")))
            elif collection=="bills":
                issues=[]
                timing=normalized_period(base.get("bill_start_date"),base.get("bill_end_date"),issues)
                volume=base.get("bill_total_volume")
                unit=string(base.get("bill_total_unit"))
                quantity_source="bill_total_volume"
                if "bill_total_volume" not in base and base.get("bill_total_kwh") is not None:
                    volume=base["bill_total_kwh"];unit="kwh";quantity_source="bill_total_kwh"
                    issues.append({"code":"legacy-quantity","message":"Only the deprecated bill_total_kwh field was supplied"})
                record=entity(source_sha,"utilityapi","bill",pointer,obj,**common,**timing,
                    start_original=base.get("bill_start_date"),end_original=base.get("bill_end_date"),
                    volume_raw=string(volume),volume=normalized_number(volume,issues,"Bill volume"),
                    volume_state=value_state(base,quantity_source),unit=unit,quantity_source=quantity_source,
                    cost_raw=string(base.get("bill_total_cost")),cost=normalized_number(base.get("bill_total_cost"),issues,"Bill cost"),
                    cost_state=value_state(base,"bill_total_cost"),currency=string(base.get("currency")),
                    line_items_state=value_state(obj,"line_items"),issues=issues)
                record["logical_key"]=sha(json_bytes(["utilityapi",meter,"bill",ident]))
                output["bills"].append(record)
                sections=[("line_items",obj.get("line_items")),("tiers",obj.get("tiers")),
                          ("tou",obj.get("tou")),("demand",obj.get("demand")),("power",obj.get("power"))]
                for supplier_index,supplier in enumerate(obj.get("suppliers") or []):
                    if not isinstance(supplier,dict):raise InputError("Supplier blocks must be complete objects")
                    sections.append(("suppliers/"+str(supplier_index)+"/supplier_line_items",supplier.get("supplier_line_items")))
                for section,items in sections:
                    if items is None:continue
                    if not isinstance(items,list):raise InputError("Charge blocks must be arrays")
                    for position,item in enumerate(items):
                        if not isinstance(item,dict):raise InputError("Charge items must be complete objects")
                        errors=[]
                        timing=normalized_period(item.get("start"),item.get("end"),errors) if "start" in item or "end" in item else {}
                        output["charges"].append(entity(source_sha,"utilityapi","charge",
                            pointer+"/"+section+"/"+str(position),item,
                            meter_id=meter,bill_id=ident,bill_row_id=record["row_id"],section=section,**timing,
                            name=string(item.get("name")),unit=string(item.get("unit")),kind=string(item.get("kind")),
                            cost_raw=string(item.get("cost")),cost=normalized_number(item.get("cost"),errors,"Charge cost"),
                            volume_raw=string(item.get("volume")),volume=normalized_number(item.get("volume"),errors,"Charge volume"),
                            rate_raw=string(item.get("rate")),cost_state=value_state(item,"cost"),
                            volume_state=value_state(item,"volume"),rate_state=value_state(item,"rate"),issues=errors))
            else:
                readings=obj.get("readings")
                if not isinstance(readings,list):
                    raise InputError("A UtilityAPI Interval must retain its readings block")
                for position,reading in enumerate(readings):
                    if not isinstance(reading,dict):raise InputError("Interval readings must be objects")
                    errors=[]
                    timing=normalized_period(reading.get("start"),reading.get("end"),errors)
                    datapoints=reading.get("datapoints")
                    legacy=False
                    if "datapoints" not in reading and reading.get("kwh") is not None:
                        datapoints=[{"type":"net","unit":"kwh","value":reading["kwh"]}]
                        legacy=True
                    if datapoints is None:datapoints=[]
                    if not isinstance(datapoints,list):raise InputError("Reading datapoints must be an array or null")
                    if not datapoints:
                        errors.append({"code":"missing-datapoints","message":"The original reading has no usable datapoints"})
                        datapoints=[{}]
                    counts=Counter()
                    for point_index,point in enumerate(datapoints):
                        if not isinstance(point,dict):raise InputError("A datapoint must be a complete object")
                        issues=list(errors)
                        if legacy:issues.append({"code":"legacy-quantity","message":"Only the deprecated reading.kwh field was supplied"})
                        channel=string(point.get("type"))
                        unit=string(point.get("unit"))
                        measurement_meter=string(point.get("meter_number"))
                        number=normalized_number(point.get("value"),issues,"Interval value")
                        counts[(channel,measurement_meter,unit)]+=1
                        if channel not in {"fwd","rev","net","gen","max"}:
                            issues.append({"code":"unknown-channel","message":"Retained an unrecognized UtilityAPI datapoint type","type":channel})
                        energy=number if unit=="kwh" and channel in {"fwd","rev","net","gen"} else ""
                        power=number if unit=="kw" else ""
                        series=sha(json_bytes(["utilityapi",meter,channel,measurement_meter,unit]))
                        rpath=pointer+"/readings/"+str(position)+("/kwh" if legacy else "/datapoints/"+str(point_index))
                        record=entity(source_sha,"utilityapi","interval",rpath,point,
                            **common,**timing,measurement_meter=measurement_meter,series_id=series,
                            channel=channel,unit=unit,value_raw=string(point.get("value")),value=number,
                            value_state=value_state(point,"value"),power_of_ten="0",energy_kwh=energy,power_kw=power,
                            quantity_semantics="interval-energy" if energy!="" else "maximum-power" if power!="" and channel=="max" else "interval-quantity" if channel in {"fwd","rev","net","gen"} else "source-value",
                            start_original=reading.get("start"),end_original=reading.get("end"),
                            quality=base.get("qualities",[]),reading_raw_json=raw_json(reading),
                            reading_type={},local_time_parameters={},issues=issues)
                        record["logical_key"]=sha(json_bytes([series,record["start_utc"],record["end_utc"]]))
                        if channel=="net" and unit=="kwh" and reading.get("kwh") is not None and number!="":
                            if decimal(number)!=decimal(reading["kwh"]):
                                record["issues"].append({"code":"legacy-value-conflict","message":"The original net datapoint and deprecated kwh value differ"})
                        output["intervals"].append(record)
                    for balance in channel_balance(datapoints):
                        metadata["issues"].append({**balance,"source_path":pointer+"/readings/"+str(position)})
                    if any(count>1 for count in counts.values()):
                        metadata["issues"].append({"code":"duplicate-datapoint-channel","source_path":pointer+"/readings/"+str(position),
                            "message":"The original reading contains repeated type/meter datapoints"})
    metadata["counts"]={name:len(output[name]) for name in COLLECTIONS}
    return {"schema":VERSION,"metadata":metadata,**output}


def channel_balance(points):
    """Compare the provider's aggregate net with complete import/export channels."""
    totals={}
    for point in points:
        channel=string(point.get("type"));unit=string(point.get("unit"))
        if channel not in {"fwd","rev","net"} or point.get("value") is None:continue
        try:value=decimal(point["value"])
        except InputError:continue
        totals.setdefault(unit,{}).setdefault(channel,[]).append(value)
    found=[]
    for unit,channels in totals.items():
        if len(channels.get("net",[]))!=1 or not channels.get("fwd"):continue
        from decimal import localcontext
        with localcontext() as context:
            context.prec=1024
            combined=sum(channels["fwd"],Decimal(0))-sum(channels.get("rev",[]),Decimal(0))
            net=channels["net"][0]
            if combined!=net:
                found.append({"code":"channel-balance-difference","message":"Aggregate forward minus reverse differs from the original net datapoint",
                    "unit":unit,"forward_minus_reverse":decimal_text(combined),"net":decimal_text(net),
                    "difference":decimal_text(combined-net)})
    return found

def decode_blocks(data,source_sha,kind):
    """Receive published or exported standalone blocks without adding provider UIDs."""
    document=exact_json(data)
    objects=document if isinstance(document,list) else [document]
    if any(not isinstance(item,dict) for item in objects):
        raise InputError("UtilityAPI standalone blocks must contain complete objects")
    output={name:[] for name in COLLECTIONS}
    for index,item in enumerate(objects):
        errors=[];interpreted={}
        if kind=="reading-block":
            interpreted.update(normalized_period(item.get("start"),item.get("end"),errors))
            points=item.get("datapoints",[])
            if not isinstance(points,list) or any(not isinstance(point,dict) for point in points):
                raise InputError("Reading block datapoints must be complete objects")
            interpreted["datapoints"]=[{"type":string(point.get("type")),"unit":string(point.get("unit")),
                "meter_number":string(point.get("meter_number")),"value_raw":string(point.get("value")),
                "value":normalized_number(point.get("value"),errors,"Datapoint value"),
                "value_state":value_state(point,"value")} for point in points]
            errors.extend(channel_balance(points))
            nets=[point for point in interpreted["datapoints"] if point["type"]=="net" and point["unit"]=="kwh" and point["value"]!=""]
            if item.get("kwh") is not None and len(nets)==1 and decimal(item["kwh"])!=decimal(nets[0]["value"]):
                errors.append({"code":"legacy-value-conflict","message":"Original net and deprecated kwh differ"})
        elif kind=="bill-base-block":
            interpreted.update(normalized_period(item.get("bill_start_date"),item.get("bill_end_date"),errors))
            for field in ("bill_total_volume","bill_total_kwh","bill_total_cost"):
                interpreted[field]={"state":value_state(item,field),"raw":string(item.get(field)),
                                    "number":normalized_number(item.get(field),errors,field)}
            interpreted["unit"]=string(item.get("bill_total_unit"))
        elif kind.startswith("bill-"):
            items=item.get("supplier_line_items") if kind=="bill-supplier-block" else [item]
            if items is None:items=[]
            if not isinstance(items,list) or any(not isinstance(value,dict) for value in items):
                raise InputError("Supplier line items must retain complete objects")
            interpreted["items"]=[]
            for pos,charge in enumerate(items):
                notes=[];value={"position":pos,"name":string(charge.get("name")),"unit":string(charge.get("unit"))}
                if "start" in charge or "end" in charge:
                    value.update(normalized_period(charge.get("start"),charge.get("end"),notes))
                for field in ("cost","volume","rate","demand"):
                    value[field]={"state":value_state(charge,field),"raw":string(charge.get(field)),
                                  "number":normalized_number(charge.get(field),notes,field)}
                value["issues"]=notes;interpreted["items"].append(value);errors.extend(notes)
        row=entity(source_sha,"utilityapi","resource","/"+str(index) if isinstance(document,list) else "",item,
            meter_id="",resource_type=kind,resource_id="",interpreted=interpreted,issues=errors)
        output["resources"].append(row)
    return {"schema":VERSION,"metadata":{"provider":"utilityapi","kind":kind,"source_sha256":source_sha,
        "collectionState":{},"retainedNumericTokens":True,"standalone_blocks":True,"issues":[],
        "counts":{name:len(output[name]) for name in COLLECTIONS}},**output}

BLOCK_KINDS={"reading-block","meter-base-block","meters-blocks","bill-base-block","bill-line-item",
             "bill-supplier-block","bill-tier-block","bill-tou-block","bill-demand-block","bill-power-block","resource-block"}

def _tree(data):
    """Use the original source engine's DTD-free Expat configuration."""
    parser=source_xml.parser()
    stack=[];root=[];count=0
    def start(raw,attrs):
        nonlocal count
        count+=1
        if count>2000000 or len(stack)>=128 or len(attrs)>256:
            raise InputError("Green Button XML exceeds the supported element/depth/attribute capacity")
        node={"tag":source_xml.expanded(raw),
              "attributes":{source_xml.expanded(k):v for k,v in attrs.items()},"text":"","children":[]}
        if stack:stack[-1]["children"].append(node)
        else:root.append(node)
        stack.append(node)
    def chars(value):
        if stack:
            if len(stack[-1]["text"])+len(value)>1048576:
                raise InputError("An XML text value exceeds one MiB")
            stack[-1]["text"]+=value
    parser.StartElementHandler=start;parser.CharacterDataHandler=chars
    parser.EndElementHandler=lambda _:stack.pop()
    source_xml.parse_stream(parser,io.BytesIO(data))
    if len(root)!=1:raise InputError("Use a complete Green Button Atom document")
    return root[0]

def children(node,tag):
    return [child for child in node["children"] if child["tag"]==tag]

def child(node,tag):
    found=children(node,tag)
    if len(found)>1:raise InputError("Repeated singleton Green Button element: "+tag)
    return found[0] if found else None

def leaf(node,tag,default=""):
    item=child(node,tag)
    return item["text"].strip() if item is not None else default

def simple(node):
    result={}
    for item in node["children"]:
        key=item["tag"]
        value=simple(item) if item["children"] else item["text"].strip()
        if item["attributes"]:value={"value":value,"attributes":item["attributes"]}
        if key in result:
            old=result[key]
            result[key]=old+[value] if isinstance(old,list) else [old,value]
        else:result[key]=value
    return result

def espi_fields(node):
    return {item["tag"][len(ESPI):]:simple(item) if item["children"] else item["text"].strip()
            for item in node["children"] if item["tag"].startswith(ESPI)}

def decode_greenbutton(data,source_sha):
    root=_tree(data)
    if root["tag"]==ATOM+"feed":
        entries=children(root,ATOM+"entry")
    elif root["tag"]==ATOM+"entry":
        entries=[root]
    else:
        raise InputError("Green Button input must use the Atom feed or entry namespace")
    if not entries:raise InputError("The Green Button document has no Atom entries")
    base=root["attributes"].get(XML_BASE,"")
    resources=[];lookup={}
    for position,entry in enumerate(entries):
        content=child(entry,ATOM+"content")
        if content is None:continue
        payloads=[x for x in content["children"] if x["tag"].startswith(ESPI)]
        if len(payloads)!=1:
            raise InputError("Each Green Button Atom entry must retain exactly one ESPI resource")
        links=[{"rel":x["attributes"].get("rel",""),"href":urljoin(entry["attributes"].get(XML_BASE,base),x["attributes"].get("href","")),
                **{k:v for k,v in x["attributes"].items() if k not in {"rel","href"}}}
               for x in children(entry,ATOM+"link")]
        self_links=[x["href"] for x in links if x["rel"]=="self"]
        if len(self_links)>1:raise InputError("A Green Button entry has multiple self links")
        ident=self_links[0] if self_links else leaf(entry,ATOM+"id")
        if not ident:raise InputError("Each Green Button entry must have its original resource identity")
        resource={"identity":ident,"atom_id":leaf(entry,ATOM+"id"),"type":payloads[0]["tag"][len(ESPI):],
                  "node":payloads[0],"entry":entry,"links":links,"position":position,
                  "title":leaf(entry,ATOM+"title"),"updated":leaf(entry,ATOM+"updated")}
        resources.append(resource)
        for key in {ident,resource["atom_id"]}:
            if not key:continue
            if key in lookup and lookup[key] is not resource:raise InputError("The Atom document has duplicate resource identities")
            lookup[key]=resource
    def parent_resource(resource,kind):
        # Resolve declared related/up links first, then the exact resource URI hierarchy.
        candidates=[]
        for link in resource["links"]:
            target=lookup.get(link["href"])
            if target and target["type"]==kind and link["rel"] in {"related","up"}:
                candidates.append(target)
        if not candidates:
            current=resource["identity"]
            for other in resources:
                if other["type"]==kind and current.startswith(other["identity"].rstrip("/")+"/"):
                    candidates.append(other)
        unique={c["identity"]:c for c in candidates}
        if len(unique)>1:
            longest=max(len(k) for k in unique)
            unique={k:v for k,v in unique.items() if len(k)==longest}
        return next(iter(unique.values())) if len(unique)==1 else None
    def linked_resource(resource,kind):
        matches=[lookup[l["href"]] for l in resource["links"] if l["href"] in lookup and lookup[l["href"]]["type"]==kind]
        unique={x["identity"]:x for x in matches}
        return next(iter(unique.values())) if len(unique)==1 else None
    output={name:[] for name in COLLECTIONS}
    metadata={"provider":"greenbutton","source_sha256":source_sha,"atomEntryCount":len(entries),
              "resourceCount":len(resources),"issues":[],"namespace":ESPI[1:-1]}
    for resource in resources:
        kind=resource["type"];node=resource["node"];pointer="/feed/entry/"+str(resource["position"])+"/"+kind
        usage=resource if kind=="UsagePoint" else parent_resource(resource,"UsagePoint")
        meter=usage["identity"] if usage else ""
        fields=espi_fields(node)
        resource_body=resource["entry"]
        if kind=="IntervalBlock":
            fields.pop("IntervalReading",None)
            fields["intervalReadingCount"]=len(children(node,ESPI+"IntervalReading"))
            resource_body={"atom_id":resource["atom_id"],"identity":resource["identity"],"links":resource["links"],
                "resource_type":kind,"fields":fields,"projection":"Resource metadata; every IntervalReading is retained individually and in the original XML source"}
        output["resources"].append(entity(source_sha,"greenbutton","resource",pointer,resource_body,
            resource_type=kind,resource_id=resource["identity"],meter_id=meter,
            links=resource["links"],fields=fields,updated=resource["updated"]))
        if kind=="UsagePoint":
            time_resource=linked_resource(resource,"LocalTimeParameters")
            output["meters"].append(entity(source_sha,"greenbutton","meter",pointer,node,
                meter_id=meter,provider_object_id=resource["identity"],title=resource["title"],
                usage_point=fields,local_time_parameters=espi_fields(time_resource["node"]) if time_resource else {},
                service_identifier=leaf(node,ESPI+"mRID"),service_address="",meter_numbers=[],
                notes=[],updated=resource["updated"]))
        elif kind=="IntervalBlock":
            reading=parent_resource(resource,"MeterReading")
            reading_type=linked_resource(reading,"ReadingType") if reading else linked_resource(resource,"ReadingType")
            parameters=linked_resource(usage,"LocalTimeParameters") if usage else None
            if not parameters and reading:parameters=linked_resource(reading,"LocalTimeParameters")
            rt=espi_fields(reading_type["node"]) if reading_type else {}
            time_parameters=espi_fields(parameters["node"]) if parameters else {}
            channel="espi:"+FLOW.get(string(rt.get("flowDirection")),string(rt.get("flowDirection")))+":"+string(rt.get("kind"))
            series=sha(json_bytes(["greenbutton",meter,reading["identity"] if reading else "",rt]))
            block_period=child(node,ESPI+"interval")
            block_start=leaf(block_period,ESPI+"start") if block_period else ""
            block_duration=leaf(block_period,ESPI+"duration") if block_period else ""
            for number,item in enumerate(children(node,ESPI+"IntervalReading")):
                issues=[]
                if not meter:issues.append({"code":"missing-usage-point","message":"No unique original UsagePoint relation resolved"})
                if not reading_type:issues.append({"code":"missing-reading-type","message":"No unique original ReadingType relation resolved"})
                timing=child(item,ESPI+"timePeriod")
                start=leaf(timing,ESPI+"start") if timing else ""
                duration=leaf(timing,ESPI+"duration") if timing else ""
                # ReadingType intervalLength is an explicit duration default in ESPI.
                if not duration:duration=string(rt.get("intervalLength"))
                period={"start_us":None,"end_us":None,"start_utc":"","end_utc":"","duration_seconds":""}
                try:
                    first=epoch_seconds(start);length=decimal(duration,"Interval duration")
                    if length!=length.to_integral_value() or length<=0:raise InputError("Interval duration must be positive integral seconds")
                    last=first+int(length)*1000000
                    period={"start_us":first,"end_us":last,"start_utc":utc(first),"end_utc":utc(last),"duration_seconds":str(int(length))}
                    if block_start and block_duration:
                        bfirst=epoch_seconds(block_start);blast=bfirst+int(decimal(block_duration))*1000000
                        if first<bfirst or last>blast:issues.append({"code":"outside-block-period","message":"The reading extends beyond its declared IntervalBlock"})
                except (InputError,ValueError,OverflowError) as error:
                    issues.append({"code":"invalid-period","message":str(error),"start":start,"duration":duration})
                raw_value=leaf(item,ESPI+"value")
                multiplier=string(rt.get("powerOfTenMultiplier"))
                unit="espi:"+string(rt.get("uom"))
                scaled=""
                try:
                    if multiplier=="":raise InputError("ReadingType powerOfTenMultiplier is missing")
                    scaled=scale(raw_value,multiplier)
                except (InputError,ValueError) as error:
                    issues.append({"code":"invalid-number","message":str(error)})
                energy="";power="";semantics="source-value"
                # ESPI 4 accumulationBehaviour=4 is deltaData. Every other
                # behaviour remains an exact source value until reviewed.
                if rt.get("uom")=="72" and rt.get("accumulationBehaviour")=="4" and rt.get("kind")=="12" and scaled!="":
                    energy=scale(scaled,-3);semantics="interval-energy"
                elif rt.get("uom")=="38" and scaled!="":
                    power=scale(scaled,-3);semantics="source-power"
                elif rt.get("uom")=="72" and scaled!="":
                    issues.append({"code":"non-delta-energy","message":"Energy-valued readings use a non-delta accumulation behaviour; interval energy is not inferred"})
                quality=[leaf(q,ESPI+"quality") for q in children(item,ESPI+"ReadingQuality")]
                quality_source="reading"
                if not quality:
                    quality=[string(rt.get("defaultQuality","0"))]
                    quality_source="reading-type" if "defaultQuality" in rt else "espi-default"
                local_start="";local_end=""
                if period["start_us"] is not None and time_parameters:
                    try:
                        local_start=source_local(period["start_us"],time_parameters)
                        local_end=source_local(period["end_us"],time_parameters)
                    except InputError as error:
                        issues.append({"code":"source-local-time","message":str(error)})
                interval_cost_raw=leaf(item,ESPI+"cost")
                interval_cost=""
                if interval_cost_raw:
                    try:interval_cost=scale(interval_cost_raw,-5)
                    except InputError as error:issues.append({"code":"invalid-cost","message":str(error)})
                record=entity(source_sha,"greenbutton","interval",pointer+"/IntervalReading/"+str(number),item,
                    meter_id=meter,provider_object_id=resource["identity"],measurement_meter=reading["identity"] if reading else "",
                    series_id=series,channel=channel,unit=unit,value_raw=raw_value,value=scaled,value_state="value" if raw_value else "missing",
                    power_of_ten=multiplier,energy_kwh=energy,power_kw=power,quantity_semantics=semantics,
                    start_original=start,end_original="",duration_original=duration,quality=quality,
                    reading_type=rt,reading_type_view=reading_type_view(rt),local_time_parameters=time_parameters,
                    start_local=local_start,end_local=local_end,quality_source=quality_source,
                    quality_names=[QUALITY.get(q,"unknown:"+q) for q in quality],
                    cost_raw=interval_cost_raw,cost=interval_cost,unit_name=UOM.get(str(rt.get("uom")),"unknown"),
                    notes=[],updated=resource["updated"],
                    issues=issues,**period)
                record["logical_key"]=sha(json_bytes([series,period["start_utc"],period["end_utc"]]))
                output["intervals"].append(record)
        elif kind=="ElectricPowerUsageSummary":
            issues=[];billing=child(node,ESPI+"billingPeriod")
            start=leaf(billing,ESPI+"start") if billing else ""
            duration=leaf(billing,ESPI+"duration") if billing else ""
            period={"start_us":None,"end_us":None,"start_utc":"","end_utc":"","duration_seconds":""}
            try:
                first=epoch_seconds(start);length=decimal(duration)
                if length!=length.to_integral_value() or length<=0:raise InputError("Billing duration must be positive integral seconds")
                last=first+int(length)*1000000
                period={"start_us":first,"end_us":last,"start_utc":utc(first),"end_utc":utc(last),"duration_seconds":str(int(length))}
            except InputError as error:issues.append({"code":"invalid-period","message":str(error)})
            cost=leaf(node,ESPI+"billLastPeriod")
            bill_to_date=leaf(node,ESPI+"billToDate")
            additional=leaf(node,ESPI+"costAdditionalLastPeriod")
            energy_node=child(node,ESPI+"overallConsumptionLastPeriod")
            summary_energy=espi_fields(energy_node) if energy_node else {}
            volume="";volume_raw=string(summary_energy.get("value"));unit=string(summary_energy.get("uom"))
            if volume_raw and "powerOfTenMultiplier" in summary_energy:
                try:volume=scale(volume_raw,summary_energy["powerOfTenMultiplier"])
                except InputError as error:issues.append({"code":"invalid-bill-volume","message":str(error)})
            money={}
            for money_name,money_value in [("billLastPeriod",cost),("billToDate",bill_to_date),("costAdditionalLastPeriod",additional)]:
                if money_value:
                    try:money[money_name]=scale(money_value,-5)
                    except InputError as error:issues.append({"code":"invalid-bill-cost","message":str(error)})
            currency_code=leaf(node,ESPI+"currency")
            summary=entity(source_sha,"greenbutton","bill",pointer,node,
                meter_id=meter,provider_object_id=resource["identity"],**period,
                start_original=start,end_original="",volume_raw=volume_raw,volume=volume,volume_state="value" if volume_raw else "missing",
                unit="espi:"+unit if unit else "",summary_measurement=summary_energy,energy_kwh=scale(volume,-3) if unit=="72" and volume else "",
                cost_raw=cost,cost=money.get("billLastPeriod",""),cost_state="value" if cost else "missing",
                currency=CURRENCY.get(currency_code,currency_code),currency_code=currency_code,
                money=money,fields=fields,issues=issues,notes=[],
                updated=resource["updated"],line_items_state="missing")
            summary["logical_key"]=sha(json_bytes(["greenbutton",meter,"billing-summary",resource["identity"]]))
            output["bills"].append(summary)
    metadata["counts"]={name:len(output[name]) for name in COLLECTIONS}
    return {"schema":VERSION,"metadata":metadata,**output}

def decode(data,provider="auto",kind="auto"):
    if not isinstance(data,bytes) or not data or len(data)>MAX_BYTES:
        raise InputError("Receive a nonempty original source file up to 256 MiB")
    if provider=="auto":
        provider="greenbutton" if data.removeprefix(b"\xef\xbb\xbf").lstrip().startswith(b"<") or data[:2] in {b"\xff\xfe",b"\xfe\xff"} else "utilityapi"
    if provider not in {"utilityapi","greenbutton"}:
        raise InputError("Choose UtilityAPI JSON or Green Button XML")
    source_sha=sha(data)
    return decode_greenbutton(data,source_sha) if provider=="greenbutton" else decode_utilityapi(data,source_sha,kind)
