"""Minimal native-API compatibility fixture for running the additive modules alone.

These primitives represent the earlier package API. They are not installed into
the application. The separate native_contract_support fixture exercises the
current source-edition and immutable-record contracts.
"""
import contextlib, hashlib, json, os, sys, tempfile, time, types
from pathlib import Path

class ContractError(ValueError): pass

def canonical_bytes(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
def digest(value): return hashlib.sha256(canonical_bytes(value)).hexdigest()
def utc_now(): return time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
def load_json(path):
    return json.loads(Path(path).read_text(),parse_constant=lambda v: (_ for _ in ()).throw(ContractError(f"nonfinite {v}")))
def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:f.write(canonical_bytes(value));f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
def file_sha256(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
@contextlib.contextmanager
def held(path,timeout=30):
    import fcntl
    with Path(path).open("a+b") as f:
        fcntl.flock(f.fileno(),fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(f.fileno(),fcntl.LOCK_UN)

class Workspace:
    def __init__(self,root):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)
        for kind in ("objects","tmp","sources"):(self.root/kind).mkdir(exist_ok=True)
        if not (self.root/"workspace.json").exists():atomic_json(self.root/"workspace.json",{"schema_version":1,"created_at":utc_now()})
    def _save(self,kind,value):
        record=dict(value);record.setdefault("created_at",utc_now());key=digest(record);record["id"]=key
        path=self.root/kind/f"{key}.json"
        if path.exists():
            if load_json(path)!=record:raise ContractError("immutable object collision")
        else:atomic_json(path,record)
        return record
    def _get(self,kind,key):
        if not isinstance(key,str) or len(key)!=64 or any(c not in "0123456789abcdef" for c in key):raise ContractError("record id malformed")
        record=load_json(self.root/kind/f"{key}.json");check=dict(record);check.pop("id",None)
        if record["id"]!=key or digest(check)!=key:raise ContractError("object digest mismatch")
        return record
    def source_file(self,key):
        source=self._get("sources",key);path=(self.root/source["object_path"]).resolve()
        if not path.is_relative_to(self.root):raise ContractError("path escapes workspace")
        return path


def install_namespace():
    root=Path(__file__).resolve().parents[1]/"src/opportunities/upstate_forever_2026"
    for name,path in [("eco_under_test",root),("eco_under_test.model",root/"model"),("eco_under_test.operator",root/"operator")]:
        module=types.ModuleType(name);module.__path__=[str(path)];sys.modules[name]=module
    common=types.ModuleType("eco_under_test.model.common")
    for name in ("ContractError","canonical_bytes","digest","utc_now","load_json","atomic_json","file_sha256","held"):
        setattr(common,name,globals()[name])
    sys.modules[common.__name__]=common
    workspace=types.ModuleType("eco_under_test.model.workspace");workspace.Workspace=Workspace;sys.modules[workspace.__name__]=workspace
    return "eco_under_test",Workspace,ContractError,"native-api-compatibility-fixture"


def domain_fixture(n=24):
    """Explicitly constructed algorithm fixture, never an Upper Savannah dataset."""
    features=[];stations=[]
    for i in range(n):
        key=f"F{i:05d}";x=-80+(i%16)*.04;y=34+(i//16)*.04
        ring=[[x,y],[x+.035,y],[x+.035,y+.035],[x,y+.035],[x,y]]
        downstream=f"F{(i-1)//2:05d}" if i else None
        features.append({"type":"Feature","geometry":{"type":"Polygon","coordinates":[ring]},"properties":{
            "huc12":key,"tohuc":downstream,"stratum":f"S{i%3}","priority":float((i*11)%23+1),"fixture":True}})
        stations.append({"type":"Feature","geometry":{"type":"Point","coordinates":[x+.017,y+.017]},"properties":{
            "site_no":f"TEST-{i:05d}","at_outlet":True,"fixture":True}})
    return {"type":"FeatureCollection","features":features},{"type":"FeatureCollection","features":stations}


def source_record(workspace,value,title):
    payload=canonical_bytes(value);sha=hashlib.sha256(payload).hexdigest();path=workspace.root/"objects"/f"{sha}.json";path.write_bytes(payload)
    return workspace._save("sources",{"object_path":path.relative_to(workspace.root).as_posix(),"sha256":sha,"title":title,"source_type":"authored-algorithm-fixture"})

def configuration():
    return {"coverage_mode":"local","budget":"1800.00","max_sites":7,"min_sites":2,"minimum_by_stratum":{"S0":1,"S1":1},
            "default_cost":{"setup":"40.00","per_visit":"30.00","basis":"authored test costs"},"program_overhead":"100.00",
            "calendar":{"start_date":"2026-11-02","end_date":"2027-01-04","interval_days":30,"round_window_days":7,
                        "visit_minutes":45,"travel_buffer_minutes":30,"crews":1,"crew_day_minutes":480},
            "time_limit_seconds":20,"existing_station_ids":[]}
