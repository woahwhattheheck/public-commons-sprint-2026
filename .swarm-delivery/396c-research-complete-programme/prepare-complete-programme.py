#!/usr/bin/env python3
"""Receive the complete original Research programme and optionally operate it."""
import argparse,hashlib,json,os,stat,subprocess,sys,urllib.request,uuid
from pathlib import Path
REPOSITORY="https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/"
ASSET_BASE="42c9d8bba273a117a53d3baf3a7d2e11341f41d8/.swarm-delivery/396c-research-runtime-assets/"
SOURCES=[
("citation-source-envelope.json","3f9251671b6816fa4af94699f39d5c70fafe4277/.swarm-delivery/396c-citation-review-native/source-envelope.json",3670230,"4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa"),
("materialize-source.py","3f9251671b6816fa4af94699f39d5c70fafe4277/.swarm-delivery/396c-citation-review-native/materialize-source.py",7101,"217506524e606c658baf94707d3153b926d6f5c0bda67857ffcdbd9a984399f9"),
("python-source-envelope.json","edb9e042733034c1ee0e6afb79740c9a46e30aa3/.swarm-delivery/396c-citation-python-native/source-envelope.json",6690329,"4699d7bef9afae7e7b83246600e7add0904403fe829943c32553a3eb63c113ff"),
("materialize-python-source.py","edb9e042733034c1ee0e6afb79740c9a46e30aa3/.swarm-delivery/396c-citation-python-native/materialize-python-source.py",8026,"cdc5c12bc8da875a22b4a98b9450909b6c39b653bf1d690804f88ad929502269"),
("epmc-source-envelope.json","ed3b5da70df807258cceefa75ce577d0bbe8cd9d/.swarm-delivery/396c-europe-pmc-native/source-envelope.json",7138459,"400aebafd847d21bad61cfce6afd40b29c5d005b65213abba0fe9390f61ffa31"),
("materialize-europe-pmc-source.py","ed3b5da70df807258cceefa75ce577d0bbe8cd9d/.swarm-delivery/396c-europe-pmc-native/materialize-europe-pmc-source.py",8419,"90d60e55d1838215c7252cc2a79db5ad8509bf01b44bbbbe79af1dc98fa3635f"),
("compose-developer-assets.py",ASSET_BASE+"compose-developer-assets.py",16710,"b6a9f93e8e9556ab6deacfac8100a526d4e04738f6827e4004ce1a17d022edd9"),
("developer-assets.json",ASSET_BASE+"Developer_Portal_Source_Additions.json",46410,"f1890ee59c679d9322dc5e2edaf97eda606c34c7c1921a797215395b5d02e45e"),
]
LOCAL=[
("run-complete-research.py",11573,"350671311e655b9076add760caa9edbf36365d3faf097930c1a190df3e689f60"),
("RESEARCH_PROGRAMME_README.md",4820,"e55ba2a2c9429c219dd81656af6597fceeb4827d266b2d36bfd80b0c5169aab4"),
]
def need(value,message):
    if not value:raise ValueError(message)
def digest(b):return hashlib.sha256(b).hexdigest()
def ordinary(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode),"Ordinary source required: "+str(path))
        return stream.read()
def check(body,size,sha,label):
    need(len(body)==size and digest(body)==sha,"Pinned source identity differs: "+label)
def retain(path,body):
    if os.path.lexists(path):
        need(ordinary(path)==body,"Existing source differs: "+str(path));return "reused"
    temporary=path.with_name(".receiving-"+uuid.uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,"wb") as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
        try:os.link(temporary,path)
        except FileExistsError:need(ordinary(path)==body,"Concurrent source differs: "+str(path))
    finally:temporary.unlink(missing_ok=True)
    need(ordinary(path)==body,"Source readback differs: "+str(path))
    return "written"
def receive(path,url,size,sha):
    if os.path.lexists(path):
        body=ordinary(path);check(body,size,sha,str(path));return "reused"
    request=urllib.request.Request(url,headers={"User-Agent":"Commons-Research-Programme/1","Accept":"application/octet-stream"})
    with urllib.request.urlopen(request,timeout=60) as response:
        need(response.status==200,"Original source retrieval failed: "+str(response.status))
        body=response.read(size+1)
    check(body,size,sha,url);return retain(path,body)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,type=Path)
    parser.add_argument("--run",action="store_true",help="Execute the original complete programme and package its completed delivery.")
    args=parser.parse_args();root=args.directory
    need(root.is_absolute(),"Use an absolute receiving directory")
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    need(not root.is_symlink() and root.is_dir() and root.stat().st_uid==os.getuid() and root.stat().st_mode&0o077==0,"Use an owned private receiving directory")
    inbox=root/"inbox";inbox.mkdir(mode=0o700,exist_ok=True);need(not inbox.is_symlink(),"Ordinary inbox required")
    rows=[]
    for name,ref,size,sha in SOURCES:
        state=receive(inbox/name,REPOSITORY+ref,size,sha)
        rows.append({"file":"inbox/"+name,"bytes":size,"sha256":sha,"state":state,"url":REPOSITORY+ref})
    here=Path(__file__).resolve().parent
    for name,size,sha in LOCAL:
        body=ordinary(here/name);check(body,size,sha,name);state=retain(root/name,body)
        rows.append({"file":name,"bytes":size,"sha256":sha,"state":state})
    body=ordinary(here/"package-complete-programme.py")
    compile(body,"package-complete-programme.py","exec")
    retain(root/"package-complete-programme.py",body)
    compile(ordinary(root/"run-complete-research.py"),"run-complete-research.py","exec")
    print(json.dumps({"schema":"stellar-forge.complete-research-programme-source.v1","state":"PREPARED","directory":str(root),"files":rows,"operationId":"SCF-RESEARCH-CITATION-REVIEW-396C-20261012","next":[sys.executable,"-B",str(root/"run-complete-research.py")]}),flush=True)
    if args.run:
        subprocess.run([sys.executable,"-B",str(root/"run-complete-research.py")],cwd=root,check=True)
        subprocess.run([sys.executable,"-B",str(root/"package-complete-programme.py"),"--directory",str(root)],cwd=root,check=True)
if __name__=="__main__":
    try:main()
    except Exception as error:
        print(json.dumps({"state":"FAILED","error":str(error),"type":type(error).__name__}),file=sys.stderr)
        sys.exit(1)
