"""MIT. Resumable UtilityAPI source collection with exact returned continuations."""
from __future__ import annotations

from datetime import datetime,timedelta,timezone
from email.utils import parsedate_to_datetime
import os
import re
from urllib.error import HTTPError,URLError
from urllib.parse import urlencode,urlsplit,parse_qs,quote
from urllib.request import Request,build_opener,HTTPRedirectHandler

from utility_shared import InputError,json_bytes
from utility_source import sha,text,decode,MAX_BYTES
from utility_time import instant

BASE="https://utilityapi.com/api/v2"
ENV=re.compile(r"[A-Z][A-Z0-9_]{0,127}\Z")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*_):return None

def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")

def configuration(p):
    if not isinstance(p,dict) or set(p)-{"name","token_env","meter_ids","collections","start","end"}:
        raise InputError("Use an explicit UtilityAPI meter collection configuration")
    from utility_analysis import identifiers
    token_env=p.get("token_env","UTILITYAPI_TOKEN")
    if not isinstance(token_env,str) or not ENV.fullmatch(token_env):
        raise InputError("Choose the environment variable holding the existing UtilityAPI token")
    meters=identifiers(p.get("meter_ids",[]),"UtilityAPI meter UIDs",1000)
    if not meters or any(any(c in x for c in ",/?#\r\n") for x in meters):
        raise InputError("Choose complete individual UtilityAPI meter string UIDs")
    collections=p.get("collections",["meters","bills","intervals"])
    if not isinstance(collections,list) or not collections or len(set(collections))!=len(collections) or set(collections)-{"meters","bills","intervals"}:
        raise InputError("Select meters, bills and/or intervals")
    start=p.get("start");end=p.get("end")
    for value in (start,end):
        if value is not None:
            # Full instants avoid applying one implicit date zone across meters.
            instant(value)
    if start and end and instant(end)<=instant(start):raise InputError("The collection window must end after it starts")
    return {"name":text(p.get("name","UtilityAPI collection"),"Collection name",160),"token_env":token_env,
            "meter_ids":meters,"collections":collections,"start":start,"end":end}

def initial_urls(config):
    tasks=[]
    for meter in config["meter_ids"]:
        if "meters" in config["collections"]:
            tasks.append({"kind":"meters","meter":meter,"url":BASE+"/meters/"+quote(meter,safe="")})
        for kind in ("bills","intervals"):
            if kind not in config["collections"]:continue
            query={"meters":meter,"limit":"1000","order":"earliest_first"}
            for key in ("start","end"):
                if config[key] is not None:query[key]=config[key]
            if kind=="intervals":query["allow_mixed"]="true"
            tasks.append({"kind":kind,"meter":meter,"url":BASE+"/"+kind+"?"+urlencode(query)})
    return tasks

def continuation(value,current):
    if not isinstance(value,str) or len(value)>16384:raise InputError("Invalid provider continuation URL")
    target=urlsplit(value)
    if target.scheme!="https" or target.netloc!="utilityapi.com" or target.fragment or target.username or target.password:
        raise InputError("The returned UtilityAPI continuation changed its origin")
    if target.path!=urlsplit(current["url"]).path:
        raise InputError("The returned UtilityAPI continuation changed its collection")
    query=parse_qs(target.query,keep_blank_values=True)
    if any(key.lower() in {"token","access_token","authorization","api_key","apikey"} for key in query):
        raise InputError("Provider continuations must keep credentials in the Authorization header")
    if any(len(v)!=1 for v in query.values()) or query.get("meters")!=[current["meter"]]:
        raise InputError("The returned UtilityAPI continuation changed its selected meter")
    if current["kind"]=="intervals" and query.get("allow_mixed")!=["true"]:
        # Provider continuations may omit defaults. Retain the actual URL, and
        # explicitly preserve the documented mixed-duration intake parameter.
        if "allow_mixed" in query:raise InputError("The continuation disabled mixed-duration data")
        value+=("&" if target.query else "?")+"allow_mixed=true"
    return value


def task_url(task,config):
    if not isinstance(task,dict) or set(task)!={"kind","meter","url"}:
        raise InputError("Use the original retained provider task")
    if task["meter"] not in config["meter_ids"] or task["kind"] not in config["collections"]:
        raise InputError("The pending provider task differs from the selected meters or collections")
    target=urlsplit(task["url"])
    if target.scheme!="https" or target.netloc!="utilityapi.com" or target.username or target.password or target.fragment:
        raise InputError("The provider task must use the original UtilityAPI origin")
    expected="/api/v2/"+task["kind"]+("/"+quote(task["meter"],safe="") if task["kind"]=="meters" else "")
    if target.path!=expected:raise InputError("The provider task changed its original resource path")
    query=parse_qs(target.query,keep_blank_values=True)
    if any(key.lower() in {"token","access_token","authorization","api_key","apikey"} for key in query):
        raise InputError("Keep provider credentials in the original Authorization header")
    if task["kind"]=="meters":
        if query:raise InputError("A single original meter request has no query parameters")
    elif any(len(v)!=1 for v in query.values()) or query.get("meters")!=[task["meter"]]:
        raise InputError("The provider task changed the selected meter")
    if task["kind"]=="intervals" and query.get("allow_mixed")!=["true"]:
        raise InputError("The retained interval task must include mixed-duration readings")
    return task["url"]

def retry_time(header):
    if not header:return None
    try:
        if header.isdecimal():
            return (datetime.now(timezone.utc)+timedelta(seconds=int(header))).isoformat(timespec="milliseconds").replace("+00:00","Z")
        return parsedate_to_datetime(header).astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")
    except (ValueError,TypeError,OverflowError):return None

def fetch(url,token):
    request=Request(url,headers={"Authorization":"Bearer "+token,"Accept":"application/json","User-Agent":"Starforge-Utility-Receiving/1"})
    observed={"url":url,"requested_at":timestamp()}
    try:
        response=build_opener(NoRedirect()).open(request,timeout=60)
    except HTTPError as error:
        response=error
    except URLError as error:
        return None,{**observed,"received_at":timestamp(),"status":None,"error":str(error.reason)}
    with response:
        length=response.headers.get("Content-Length")
        if length and length.isdecimal() and int(length)>MAX_BYTES:
            raise InputError("The provider response exceeds 256 MiB")
        data=response.read(MAX_BYTES+1)
        if len(data)>MAX_BYTES:raise InputError("The provider response exceeds 256 MiB")
        return data,{**observed,"received_at":timestamp(),"status":response.status,
            "content_type":response.headers.get("Content-Type"),"retry_after":response.headers.get("Retry-After"),
            "retry_at":retry_time(response.headers.get("Retry-After")),"bytes":len(data),"sha256":sha(data)}

class ApiOperations:
    def capture_start(self,p,request_id):
        config=configuration(p)
        ident=sha(json_bytes({"request_id":request_id,"configuration":config}))
        result={"id":ident,"name":config["name"],"configuration":config,"status":"running","created_at":timestamp(),
                "updated_at":timestamp(),"pending":initial_urls(config),"pages":[],"imports":[],"seen_urls":[],"error":None}
        self.save("captures",result);return result

    def capture_pause(self,ident):
        value=self.saved("captures",ident)
        if value["status"] in {"running","waiting"}:value["status"]="paused";value["updated_at"]=timestamp();self.save("captures",value)
        return value

    def capture_resume(self,ident):
        value=self.saved("captures",ident)
        if value["status"]!="complete":
            if value.get("retry_at") and instant(value["retry_at"])>instant(timestamp()):
                raise InputError("Resume after the provider Retry-After time: "+value["retry_at"])
            value.update(status="running",error=None,retry_at=None,updated_at=timestamp())
            self.save("captures",value)
        return value

    def capture_advance(self,ident):
        from utility_workspace import immutable
        value=self.saved("captures",ident)
        if value["status"]=="waiting" and (not value.get("retry_at") or instant(value["retry_at"])<=instant(timestamp())):
            value.update(status="running",retry_at=None,error=None)
        if value["status"]!="running":return value
        if not value["pending"]:
            value.update(status="complete",updated_at=timestamp(),completed_at=timestamp())
            self.save("captures",value);return value
        token=os.environ.get(value["configuration"]["token_env"])
        if not token or "\r" in token or "\n" in token:
            raise InputError("Set the selected UtilityAPI token environment variable on the operating host")
        current=value["pending"][0]
        verified_url=task_url(current,configuration(value["configuration"]))
        data,receipt=fetch(verified_url,token)
        folder=self.root/"utility"/"captures"/ident;folder.mkdir(mode=0o700,exist_ok=True)
        if data is not None:
            name=sha(data)+".json";immutable(folder/name,data);receipt["body_path"]="utility/captures/"+ident+"/"+name
        receipt_id=sha(json_bytes(receipt));immutable(folder/(receipt_id+".receipt.json"),json_bytes(receipt))
        value["pages"].append(receipt)
        if receipt["status"]!=200:
            value.update(status="waiting" if receipt["status"] in {202,429,500,502,503,504,None} else "attention",
                         retry_at=receipt.get("retry_at") or (datetime.now(timezone.utc)+timedelta(seconds=30)).isoformat(timespec="milliseconds").replace("+00:00","Z"),error="UtilityAPI response "+str(receipt["status"]),updated_at=timestamp())
            self.save("captures",value);return value
        try:
            parsed=decode(data,"utilityapi",current["kind"])
            state=parsed["metadata"]["collectionState"]
            if state.get("is_incomplete") is True:
                value.update(status="attention",error="UtilityAPI returned an incomplete streamed response",updated_at=timestamp())
                self.save("captures",value);return value
            imported=self.import_source(data,value["name"]+" "+current["kind"],"utilityapi",current["kind"],
                {"url":current["url"],"receipt_sha256":receipt_id,"requested_at":receipt["requested_at"],"complete_response":True},ident)
            if imported["id"] not in value["imports"]:value["imports"].append(imported["id"])
            next_url=state.get("next")
            if next_url:
                next_url=continuation(next_url,current)
                if next_url in value["seen_urls"] or next_url==current["url"]:
                    raise InputError("The provider repeated its continuation; original pages remain retained")
                value["pending"][0]={**current,"url":next_url}
            else:value["pending"].pop(0)
            value["seen_urls"].append(current["url"])
            value.update(updated_at=timestamp(),error=None)
            if not value["pending"]:value.update(status="complete",completed_at=timestamp())
            self.save("captures",value);return value
        except InputError as error:
            value.update(status="attention",error=str(error),updated_at=timestamp());self.save("captures",value);raise
