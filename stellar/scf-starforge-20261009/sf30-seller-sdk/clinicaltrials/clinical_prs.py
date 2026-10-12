"""MIT. Thin host adapter for the shared, original PRS implementation."""
from clinical_shared import HERE, InputError

MAX_XML = 64 * 1024 * 1024

def _engine():
    try:
        import prs
        return prs
    except ImportError as error:
        raise InputError("The installed ClinicalTrials package needs its original prs/ module") from error

def _call(name,*args,**kwargs):
    if args and isinstance(args[0],bytes) and len(args[0])>MAX_XML:
        raise InputError("PRS input exceeds this operator's 64 MiB capacity")
    kwargs["schema_dir"]=HERE/"contracts"
    try:
        return getattr(_engine(),name)(*args,**kwargs)
    except InputError:
        raise
    except (ValueError,TypeError) as error:
        raise InputError(str(error)) from error

def doctor():
    try:return _call("doctor")
    except InputError as error:return {"available":False,"error":str(error)}

def inspect(data,schema="protocol"):
    return _call("inspect",data,schema=schema)

def compare(before,after,schema="protocol"):
    return _call("compare",before,after,schema=schema)

def prepare(data,decisions,reviewer,rationale=""):
    return _call("prepare",data,decisions,reviewer,rationale=rationale)

def apply(data,plan):
    return _call("apply",data,plan)

def reconcile(data,records,plan):
    return _call("reconcile",data,records,plan)
