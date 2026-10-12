#!/usr/bin/env python3
"""Package the original completed Research programme with all three source kits."""
import argparse,hashlib,json,os,stat,zipfile
from pathlib import Path
def need(v,m):
    if not v:raise ValueError(m)
def digest(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def ordinary(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        need(stat.S_ISREG(os.fstat(f.fileno()).st_mode),"Ordinary member required")
        return f.read()
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument("--directory",required=True,type=Path);a=ap.parse_args();root=a.directory
    need(root.is_absolute() and not root.is_symlink(),"Use the original absolute programme directory")
    native=json.loads(ordinary(root/"complete-delivery"/"COMPLETE_RESEARCH_PROGRAMME.json"))
    need(native.get("state")=="COMPLETE","Original programme is incomplete")
    rows={}
    def add(name,path):
        need(name not in rows and not name.startswith("/") and ".." not in Path(name).parts,"Invalid member")
        body=ordinary(path);rows[name]=(path,len(body),digest(body))
    for p in sorted((root/"complete-delivery").iterdir()):
        if p.is_file():add(p.name,p)
    for p in sorted((root/"kits").rglob("*")):
        if p.is_file():add(str(p.relative_to(root)),p)
    add("run-complete-research.py",root/"run-complete-research.py")
    add("package-complete-programme.py",root/"package-complete-programme.py")
    add("README.md",root/"RESEARCH_PROGRAMME_README.md")
    add("source-maintenance/compose-developer-assets.py",root/"inbox"/"compose-developer-assets.py")
    add("source-maintenance/developer-assets.json",root/"inbox"/"developer-assets.json")
    manifest={"schema":"stellar-forge.research-programme-package.v1","state":"COMPLETE","members":[{"path":n,"bytes":v[1],"sha256":v[2]} for n,v in sorted(rows.items())]}
    target=root/"Research_Complete_Programme_20261012.zip"
    if not target.exists():
        with zipfile.ZipFile(target,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for name,(path,size,sha) in sorted(rows.items()):z.write(path,name)
            z.writestr("PACKAGE_MANIFEST.json",encoded(manifest))
        target.chmod(0o600)
    with zipfile.ZipFile(target) as z:
        need(len(z.namelist())==len(rows)+1 and set(z.namelist())==set(rows)|{"PACKAGE_MANIFEST.json"},"Package membership differs")
        need(z.read("PACKAGE_MANIFEST.json")==encoded(manifest),"Existing package selection differs")
        for name,(_,size,sha) in rows.items():
            b=z.read(name);need(len(b)==size and digest(b)==sha,"Package member differs: "+name)
    b=ordinary(target)
    print(json.dumps({"state":"COMPLETE","file":str(target),"bytes":len(b),"sha256":digest(b),"entries":len(rows)+1,"workspaceId":native["workspaceId"],"dossierId":native["dossierId"]}),flush=True)
if __name__=="__main__":main()
