"""Prepare the existing original 891b receiving program on an equipped worker.

This selects paths and exact public source. The existing native owner launches
the printed command; this helper does not start a worker, build or installer.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

SOURCE="891b207201025a152ba284b622c0b93dde70b906"
TREE="30c92f113b0e486f8099fb39d31f5ad61c268393"
METADATA_SHA256="cf96f46b1e5100c61a9854a6defe88b6e6f7caea852d8637d63b38983e7cea40"
OPERATION="scf-following-source-release-891b2072-d1cc-20261011"
REMOTE="https://github.com/woahwhattheheck/public-commons-sprint-2026.git"

def sha256(body):
    return hashlib.sha256(body).hexdigest()

def git_blob(body):
    return hashlib.sha1(b"blob "+str(len(body)).encode()+b"\0"+body).hexdigest()

def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def private_directory(path):
    if path.is_symlink():
        raise ValueError("An original private directory cannot be a symlink: "+str(path))
    path.mkdir(mode=0o700,parents=True,exist_ok=True)
    if not path.is_dir():
        raise ValueError("Expected original directory: "+str(path))

def retain_file(path,body):
    if path.exists():
        if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes()!=body:
            raise ValueError("A different retained original input exists: "+str(path))
        return
    descriptor,name=tempfile.mkstemp(prefix="."+path.name+".receiving-",dir=path.parent)
    temporary=Path(name)
    try:
        with os.fdopen(descriptor,"wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary,path)
        except FileExistsError:
            if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes()!=body:
                raise ValueError("A different original input was published: "+str(path))
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
        sync_directory(path.parent)

def json_bytes(value):
    return (json.dumps(value,indent=2)+"\n").encode()

def execute(argv,env=None):
    result=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,check=True,env=env)
    return result.stdout.decode().strip()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository",required=True,help="Existing original public Git worktree or bare cache")
    parser.add_argument("--directory",required=True,help="One retained private directory for this original operation")
    parser.add_argument("--node",required=True,help="Existing Node.js 24 executable")
    parser.add_argument("--npm",default="npm")
    parser.add_argument("--python",default=sys.executable)
    args=parser.parse_args()
    os.umask(0o077)
    if not sys.platform.startswith("linux") or sys.version_info<(3,11):
        raise ValueError("The original operator receiving requires Linux and Python 3.11 or later")
    packet=Path(__file__).resolve().parent
    repository=Path(args.repository).resolve(strict=True)
    git=["git","--no-replace-objects","--no-lazy-fetch","-C",str(repository)]
    if execute(git+["config","--get","remote.origin.url"])!=REMOTE:
        raise ValueError("Use the existing exact HTTPS public source origin; do not rewrite another owner's remote")
    node=Path(args.node).resolve(strict=True)
    node_version=execute([str(node),"--version"])
    if not re.fullmatch(r"v24\.\d+\.\d+",node_version):
        raise ValueError("Select the original Node.js 24 runtime")
    environment={**os.environ,"PATH":str(node.parent)+os.pathsep+os.environ.get("PATH","")}
    npm=shutil.which(args.npm,path=environment["PATH"])
    python=shutil.which(args.python,path=environment["PATH"])
    if npm is None or python is None:
        raise ValueError("Select the existing npm and Python executables")
    python=Path(python).resolve(strict=True)
    python_version=execute([str(python),"-c","import sys;print('.'.join(map(str,sys.version_info[:3])))"])
    if tuple(int(x) for x in python_version.split(".")[:2])<(3,11):
        raise ValueError("The selected original Python is older than 3.11")
    npm_version=execute([npm,"--version"],env=environment)
    metadata=(packet/"source-input.json").read_bytes()
    if sha256(metadata)!=METADATA_SHA256:
        raise ValueError("The original complete source metadata changed")
    selection=json.loads(metadata)
    if selection["source"]!={"commit":SOURCE,"tree":TREE} or len(selection["requiredPaths"])!=5420:
        raise ValueError("The complete original 891b source selection changed")
    builder=json.loads((packet/"builder-input.json").read_bytes())
    if builder["sourceCommit"]!=SOURCE:
        raise ValueError("The original builder source changed")
    for item in builder["files"]:
        body=item["content"].encode()
        if git_blob(body)!=item["sha"] or Path(item["name"]).name!=item["name"]:
            raise ValueError("An original builder input differs")
        if item["name"].endswith(".py"):
            ast.parse(body,filename=item["name"])
    producer=builder["originalProducer"]["content"].encode()
    if git_blob(producer)!=builder["originalProducer"]["sha"]:
        raise ValueError("The original run-release body differs")
    bodies={}
    for name in ("complete-native.mjs","launch-complete.py","run-and-save.py","prepare-existing-worker.py"):
        body=(packet/name).read_bytes()
        if name.endswith(".py"):
            ast.parse(body,filename=name)
        bodies[name]=body
    directory=Path(args.directory).expanduser().absolute()
    private_directory(directory)
    directory=directory.resolve(strict=True)
    original=directory/"inputs"
    work=directory/"work"
    builder_directory=original/"builder"
    for path in (original,work,builder_directory,work/"incoming"):
        private_directory(path)
    retain_file(original/"source-input.json",metadata)
    for item in builder["files"]:
        retain_file(builder_directory/item["name"],item["content"].encode())
    retain_file(original/"run-release.mjs",producer)
    builder["originalProducer"]["path"]=str(original/"run-release.mjs")
    retain_file(original/"builder-input.json",json_bytes(builder))
    for name,body in bodies.items():
        retain_file(work/name,body)
    configuration={
        "work":str(work),"sourceCommit":SOURCE,"sourceTree":TREE,"originalRoot":str(original),
        "metadata":str(original/"source-input.json"),"metadataSha256":METADATA_SHA256,
        "expectedSourceFiles":5420,"builderDirectory":str(builder_directory),
        "donorRepositories":[str(repository)],"incomingDirectory":str(work/"incoming"),
        "node":str(node),"nodeBin":str(node.parent),"python":str(python),"npm":npm,
        "artifactReceiver":"original-owner"
    }
    config_path=work/"configuration.json"
    retain_file(config_path,json_bytes(configuration))
    record={
        "schema":"starforge.following-source-worker-preparation.v1",
        "operationId":OPERATION,"state":"PREPARED","sourceCommit":SOURCE,"sourceTree":TREE,
        "configuration":str(config_path),"configurationSha256":sha256(json_bytes(configuration)),
        "directory":str(directory),"repository":str(repository),
        "node":{"path":str(node),"version":node_version},
        "npm":{"path":npm,"version":npm_version},
        "python":{"path":str(python),"version":python_version},
        "command":[str(python),str(work/"run-and-save.py"),str(config_path)],
        "sourceInputs":{"files":5420,"bytes":73257577,"metadataSha256":METADATA_SHA256},
        "budget":{"memoryMiB":1024,"memoryReserveMiB":128,"privateDiskMiB":1536,
                  "diskReserveMiB":64,"privateInodes":32768},
        "artifacts":[str(work/"native-result.json"),str(work/"delivery-result.json"),
                     str(work/"delivery"/"SCF_Cumulative_Runtime_891b2072_20261012.zip")],
        "artifactReceiver":"original-owner","nativeStarted":False
    }
    retain_file(work/"worker-preparation.json",json_bytes(record))
    print(json.dumps(record),flush=True)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
