#!/usr/bin/env python3
"""DataHub source normalization, exact readback and reviewed aspect commissioning."""
from __future__ import annotations
import argparse, contextlib, datetime, fcntl, hashlib, importlib.metadata, json, os, pathlib, sys, urllib.error, urllib.parse, urllib.request, uuid

SDK_VERSION = "1.7.0.14"
class Number(str): pass
def load_json(text):
    def pairs(items):
        out={}
        for k,v in items:
            if k in out: raise ValueError("Duplicate JSON key: "+k)
            out[k]=v
        return out
    return json.loads(text,parse_int=Number,parse_float=Number,object_pairs_hook=pairs,parse_constant=lambda x: (_ for _ in ()).throw(ValueError("Invalid number "+x)))
def exact_json(value,sort=False):
    if isinstance(value,Number): return str(value)
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value,str): return json.dumps(value,ensure_ascii=False)
    if isinstance(value,(int,float)): return json.dumps(value,allow_nan=False)
    if isinstance(value,list): return "["+",".join(exact_json(x,sort) for x in value)+"]"
    if isinstance(value,dict):
        items=sorted(value.items()) if sort else value.items()
        return "{"+",".join(exact_json(k)+":"+exact_json(v,sort) for k,v in items)+"}"
    raise TypeError(type(value).__name__)
def sha(data): return hashlib.sha256(data.encode() if isinstance(data,str) else data).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(path,value):
    text=exact_json(value)+"\n";p=pathlib.Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_name(p.name+"."+uuid.uuid4().hex+".tmp")
    with tmp.open("x",encoding="utf-8") as f: f.write(text);f.flush();os.fsync(f.fileno())
    os.chmod(tmp,0o600);os.replace(tmp,p)
    fd=os.open(p.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def read(path):return pathlib.Path(path).read_text(encoding="utf-8")
def sdk():
    version=importlib.metadata.version("acryl-datahub")
    if version!=SDK_VERSION:raise ValueError("Use acryl-datahub=="+SDK_VERSION+"; installed "+version)
    from datahub.emitter.aspect import ASPECT_MAP,TIMESERIES_ASPECT_MAP
    from datahub.metadata.schema_classes import KEY_ASPECTS
    from datahub.metadata.urns import Urn
    return ASPECT_MAP,TIMESERIES_ASPECT_MAP,KEY_ASPECTS,Urn
def observation(role,label):
    return {"schema":"tjl.datahub.observation.v1","id":str(uuid.uuid4()),"label":label,"role":role,"created_at":now(),"sdk_version":SDK_VERSION,"entries":[],"timeseries":[],"errors":[],"originals":[]}
def normalize(args):
    aspects,timeseries,_,_=sdk()
    from datahub.ingestion.source.file import read_metadata_file
    from datahub.emitter.mcp import MetadataChangeProposalWrapper
    from datahub.emitter.serialization_helper import pre_json_transform
    from datahub.metadata.schema_classes import MetadataChangeEventClass
    source=pathlib.Path(args.source);raw=source.read_bytes()
    original=load_json(raw.decode("utf-8"))
    if not isinstance(original,list):raise ValueError("Select a complete DataHub file-source JSON array.")
    if any(not isinstance(r,dict) or not ("proposedSnapshot" in r or "aspect" in r) for r in original):raise ValueError("Each retained source record must be an MCE or MCP.")
    out=observation("source",args.label);out["originals"].append({"name":source.name,"bytes":len(raw),"sha256":sha(raw),"text":raw.decode("utf-8")})
    entries={};seen=set()
    for record_index,item in enumerate(read_metadata_file(source)):
        if isinstance(item,MetadataChangeEventClass):
            records=[MetadataChangeProposalWrapper(entityUrn=item.proposedSnapshot.urn,aspect=a,systemMetadata=item.systemMetadata) for a in item.proposedSnapshot.aspects]
        else:records=[item]
        for record in records:
            obj=record.to_obj(simplified_structure=True) if isinstance(record,MetadataChangeProposalWrapper) else record.to_obj()
            urn,name=obj.get("entityUrn"),obj.get("aspectName")
            if not urn or not name:raise ValueError("Record must contain entityUrn and aspectName at "+str(record_index))
            if obj.get("changeType")!="UPSERT":raise ValueError("Reference selection must contain UPSERT aspects; retain other operations separately.")
            aspect=obj.get("aspect") or {}
            text=exact_json(aspect["json"]) if "json" in aspect else aspect.get("value")
            if not isinstance(text,str):raise ValueError("Aspect must contain complete JSON.")
            load_json(text)
            if name in timeseries:
                out["timeseries"].append({"record_index":record_index,"urn":urn,"aspect":name,"aspect_json":text,"original_mcp":obj})
                continue
            key=(urn,name)
            if key in seen:raise ValueError("Multiple selected current editions for "+str(key)+". Split the original into explicit source editions.")
            seen.add(key)
            entries.setdefault(urn,{"urn":urn,"exists":True,"aspects":{}})["aspects"][name]=text
    out["entries"]=list(entries.values())
    out["source_record_count"]=len(original)
    out["normalization"]="Actual pinned SDK file reader and MCP serialization; full original input remains retained."
    save_new(args.output,out);return out

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None
def endpoint(value):
    p=urllib.parse.urlsplit(value)
    if p.username or p.password or p.query or p.fragment or not p.hostname:raise ValueError("Use an exact GMS URL without credentials/query/fragment.")
    if p.scheme!="https" and not(p.scheme=="http" and p.hostname in ("localhost","127.0.0.1","::1")):raise ValueError("Use HTTPS or an explicit loopback reference GMS.")
    return value.rstrip("/")
def request(base,path,token,body=None):
    headers={"Accept":"application/json","X-RestLi-Protocol-Version":"2.0.0"}
    if token:headers["Authorization"]="Bearer "+token
    if body is not None:headers["Content-Type"]="application/json"
    req=urllib.request.Request(base+path,data=None if body is None else body.encode(),headers=headers,method="GET" if body is None else "POST")
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=60) as response:
            status=response.status;raw=response.read()
    except urllib.error.HTTPError as e:status=e.code;raw=e.read()
    text=raw.decode("utf-8")
    return {"status":status,"body":text,"bytes":len(raw),"sha256":sha(raw),"at":now(),"path":path}
class ReadFailure(Exception):
    def __init__(self,message,responses):
        super().__init__(message);self.responses=responses

def read_entity(base,urn,token):
    _,_,keys,Urn=sdk();parsed=Urn.from_string(urn);key=keys.get(parsed.entity_type)
    if key is None:raise ValueError("SDK has no key aspect for "+parsed.entity_type)
    encoded=Urn.url_encode(urn)
    existence=request(base,"/aspects/"+encoded+"?aspect="+key.ASPECT_NAME+"&version=0",token)
    if existence["status"] not in (200,404):raise ReadFailure("Key read returned HTTP "+str(existence["status"]),[existence])
    full=request(base,"/entitiesV2/"+encoded,token)
    if full["status"]==404:raw={"aspects":{}}
    elif full["status"]==200:
        try:raw=load_json(full["body"])
        except Exception as e:raise ReadFailure("Invalid complete entity JSON: "+str(e),[existence,full]) from e
    else:raise ReadFailure("Entity read returned HTTP "+str(full["status"]),[existence,full])
    values={}
    for name,item in raw.get("aspects",{}).items():
        if "value" not in item:raise ReadFailure("Missing returned aspect value: "+name,[existence,full])
        values[name]=exact_json(item["value"])
    return {"urn":urn,"exists":existence["status"]==200,"aspects":values,"responses":[existence,full]}
def collect(args):
    sdk();raw=read(args.selection);selection=load_json(raw);base=endpoint(args.server);token=os.environ.get(args.token_env,"")
    if selection.get("schema")=="tjl.datahub.observation.v1":urns=[e["urn"] for e in selection["entries"]]
    elif selection.get("schema")=="tjl.datahub.change-plan.v1":urns=[e["urn"] for e in selection["changes"]]
    else:raise ValueError("Use a complete source observation or reviewed change plan.")
    urns=list(dict.fromkeys(urns))
    if not urns:raise ValueError("Select the complete nonempty entity population.")
    out=observation("target",args.label);out["target_url"]=base;out["originals"]=[{"name":pathlib.Path(args.selection).name,"text":raw,"sha256":sha(raw)}]
    for urn in urns:
        try:out["entries"].append(read_entity(base,urn,token))
        except Exception as e:out["errors"].append({"urn":urn,"error":type(e).__name__+": "+str(e),"responses":getattr(e,"responses",[])})
    save_new(args.output,out)
    return out
def save_new(path,value):
    p=pathlib.Path(path)
    if p.exists():raise ValueError("Choose a new output path; earlier observations remain.")
    # The exclusive reservation prevents an existing destination being overwritten.
    with p.open("x",encoding="utf-8") as f:f.write(exact_json(value)+"\n");f.flush();os.fsync(f.fileno())
    os.chmod(p,0o600)
def verify_plan(text):
    plan=load_json(text)
    if plan.get("schema")!="tjl.datahub.change-plan.v1":raise ValueError("Select a complete change plan.")
    expected=plan.pop("plan_sha256",None)
    if sha(exact_json(plan))!=expected:raise ValueError("Changed plan content.")
    plan["plan_sha256"]=expected;endpoint(plan["target_url"])
    if not plan.get("reviewer") or not plan.get("changes"):raise ValueError("Plan needs a named reviewer and changes.")
    seen=set();aspects,timeseries,_,_=sdk()
    from datahub.emitter.serialization_helper import post_json_transform
    for change in plan["changes"]:
        key=(change["urn"],change["aspect"])
        if key in seen:raise ValueError("Duplicate aspect in plan.")
        seen.add(key)
        if change["aspect"] in timeseries:raise ValueError("Use a dedicated original time-series operation.")
        typ=aspects.get(change["aspect"])
        if typ is None:raise ValueError("Aspect is absent from selected SDK.")
        for field in ("before","after"):
            raw=change[field+"_json"]
            if sha(raw)!=change[field+"_sha256"]:raise ValueError("Changed "+field+" aspect.")
            # Validate using SDK without replacing the original exact JSON body.
            parsed=json.loads(raw);instance=typ.from_obj(post_json_transform(parsed))
            if not instance.validate():raise ValueError("SDK rejected "+field+" aspect.")
        if not change.get("reviewer") or not change.get("reason"):raise ValueError("Each change needs owner/reason.")
    return plan
def current_aspect(base,change,token):
    entity=read_entity(base,change["urn"],token)
    if not entity["exists"]:raise ReadFailure("Target entity no longer exists.",entity["responses"])
    return entity,entity["aspects"].get(change["aspect"])
def equal(a,b):return a is not None and b is not None and exact_json(load_json(a),True)==exact_json(load_json(b),True)
@contextlib.contextmanager
def run_lock(root):
    root=pathlib.Path(root);root.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (root/".lock").open("a+") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);yield root
def operate(args):
    plan_text=read(args.plan);plan=verify_plan(plan_text);base=endpoint(plan["target_url"]);token=os.environ.get(args.token_env,"")
    with run_lock(args.run_directory) as root:
        path=root/"run.json"
        if path.exists():
            run=load_json(read(path))
            if run["plan_sha256"]!=plan["plan_sha256"]:raise ValueError("This directory belongs to another original plan.")
        else:
            run={"schema":"tjl.datahub.run.v1","id":str(uuid.uuid4()),"plan_id":plan["id"],"plan_sha256":plan["plan_sha256"],"plan_original":plan_text,"target_url":base,"created_at":now(),"events":[],"states":{}}
            save(path,run)
        for change in plan["changes"]:
            cid=change["id"];state=run["states"].get(cid,"unstarted")
            try:
                entity,current=current_aspect(base,change,token)
                run["events"].append({"at":now(),"change_id":cid,"kind":"readback","entity":entity})
                if equal(current,change["after_json"]):
                    run["states"][cid]="observed-after";save(path,run);continue
                if args.command=="recover":
                    run["states"][cid]="observed-before" if equal(current,change["before_json"]) else "different"
                    save(path,run);continue
                if state!="unstarted":
                    run["events"].append({"at":now(),"change_id":cid,"kind":"resume-needs-new-reviewed-plan","previous_state":state})
                    save(path,run);continue
                if not equal(current,change["before_json"]):
                    run["states"][cid]="different";save(path,run);continue
                proposal={"entityType":change["urn"].split(":")[2],"entityUrn":change["urn"],"changeType":"UPSERT","aspectName":change["aspect"],"aspect":{"contentType":"application/json","value":change["after_json"]}}
                body=exact_json({"proposal":proposal,"async":"false"})
                run["states"][cid]="dispatching"
                run["events"].append({"at":now(),"change_id":cid,"kind":"request","path":"/aspects?action=ingestProposal","body":body,"sha256":sha(body)})
                save(path,run)
                response=request(base,"/aspects?action=ingestProposal",token,body)
                run["events"].append({"at":now(),"change_id":cid,"kind":"response","response":response})
                run["states"][cid]="accepted-response" if 200<=response["status"]<300 else "returned-error"
                save(path,run)
                entity,current=current_aspect(base,change,token)
                run["events"].append({"at":now(),"change_id":cid,"kind":"readback","entity":entity})
                if equal(current,change["after_json"]):run["states"][cid]="observed-after"
                save(path,run)
            except Exception as e:
                run["events"].append({"at":now(),"change_id":cid,"kind":"error","error":type(e).__name__+": "+str(e),"previous_state":run["states"].get(cid,"unstarted"),"responses":getattr(e,"responses",[])})
                if run["states"].get(cid)=="dispatching":run["states"][cid]="uncertain"
                else:run["states"][cid]="read-error"
                save(path,run)
        run["finished_at"]=now();run["complete"]=all(run["states"].get(c["id"])=="observed-after" for c in plan["changes"]);save(path,run)
        return run
def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest="command",required=True)
    n=sub.add_parser("normalize");n.add_argument("--source",required=True);n.add_argument("--output",required=True);n.add_argument("--label",required=True)
    c=sub.add_parser("collect");c.add_argument("--selection",required=True);c.add_argument("--server",required=True);c.add_argument("--output",required=True);c.add_argument("--label",required=True);c.add_argument("--token-env",default="DATAHUB_HANDOVER_TOKEN")
    for name in ("apply","recover"):
        a=sub.add_parser(name);a.add_argument("--plan",required=True);a.add_argument("--run-directory",required=True);a.add_argument("--token-env",default="DATAHUB_HANDOVER_TOKEN")
    a=p.parse_args()
    result=normalize(a) if a.command=="normalize" else collect(a) if a.command=="collect" else operate(a)
    print(exact_json({"schema":result["schema"],"id":result.get("id"),"entries":len(result.get("entries",[])),"errors":len(result.get("errors",[])),"complete":result.get("complete")}))
    return 2 if result.get("errors") or result.get("complete") is False else 0
if __name__=="__main__":
    try:sys.exit(main())
    except Exception as e:print(type(e).__name__+": "+str(e),file=sys.stderr);sys.exit(1)
