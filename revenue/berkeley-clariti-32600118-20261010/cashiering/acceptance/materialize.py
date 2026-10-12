#!/usr/bin/env python3
"""Materialize the complete declared Berkeley source in one owned receiving directory."""
from __future__ import annotations
import argparse,hashlib,json,os,sys,tempfile,urllib.request
from datetime import datetime,timezone
from pathlib import Path,PurePosixPath

COMPOSITION_TEXT="{\n  \"schema\": \"berkeley.cashiering.source-composition.v1\",\n  \"repository\": \"woahwhattheheck/public-commons-sprint-2026\",\n  \"source_commit\": \"e4aa15b44fe44ed38f90849605ec0cd26c60c684\",\n  \"component_prefix\": \"revenue/berkeley-clariti-32600118-20261010\",\n  \"operation_id\": \"berkeley-daily-cashiering-native-82e4-20261012\",\n  \"files\": [\n    {\n      \"path\": \"audit.mjs\",\n      \"bytes\": 9290,\n      \"sha256\": \"157b1350d0ac1875d688b1c5dfd1952f132bb245ef1364227650d563ba2c6765\"\n    },\n    {\n      \"path\": \"cashiering/__init__.py\",\n      \"bytes\": 79,\n      \"sha256\": \"9ab17f190eeda620253ba41210e52d31bbf1f5f2421000b64852f8cb0fd75f9c\"\n    },\n    {\n      \"path\": \"cashiering/API.md\",\n      \"bytes\": 17981,\n      \"sha256\": \"3552032948e23a992fec41c71a665e463f0a25ddc43714a81cc4a83e2185ef75\"\n    },\n    {\n      \"path\": \"cashiering/engine.py\",\n      \"bytes\": 48351,\n      \"sha256\": \"e8b08fe1d0d89ae65e2913a727ea607dd161fbf449d67444fa14e53d6a399b45\"\n    },\n    {\n      \"path\": \"cashiering/model.py\",\n      \"bytes\": 35506,\n      \"sha256\": \"06b1ab5fe801d66d05260e4cac43273e2e279a49276d6ca75e76cc483a34729f\"\n    },\n    {\n      \"path\": \"cashiering/public/app.mjs\",\n      \"bytes\": 107691,\n      \"sha256\": \"20a77accf91e3885ede5f447c7764b72189de7c4fdc49307db2d29c2be7d605a\"\n    },\n    {\n      \"path\": \"cashiering/public/index.html\",\n      \"bytes\": 818,\n      \"sha256\": \"9f6a83825f09039c4386b0c20085192a8a6056c43e5ed1b1ed70d4e75b6a6a0d\"\n    },\n    {\n      \"path\": \"cashiering/public/style.css\",\n      \"bytes\": 12743,\n      \"sha256\": \"b39e4aed1f025e89ab46dc4504d2b45eb36e81483853b9e9a47da1b464d4d72c\"\n    },\n    {\n      \"path\": \"cashiering/reporting.py\",\n      \"bytes\": 31912,\n      \"sha256\": \"39f367f6537a5b7e2950fd5801fd3a69e8d0e8d8ca61f839201e8c9fe76eee09\"\n    },\n    {\n      \"path\": \"cashiering/requirements-catalog.json\",\n      \"bytes\": 13358,\n      \"sha256\": \"8c16ef7d22d3e97be323337531dfd129d543b954ee655315ac232b6e9620f947\"\n    },\n    {\n      \"path\": \"cashiering/SOURCE_CONTRACT.md\",\n      \"bytes\": 14862,\n      \"sha256\": \"f359eb89b6c267caa1100d69df652b35cadd5c919fd255501863cdf884cf8e87\"\n    },\n    {\n      \"path\": \"cashiering/source-manifest.json\",\n      \"bytes\": 6612,\n      \"sha256\": \"659e78d89679aefc665e86b7b9bfe9414c33347f00bdf44f9d0dc7f554c209e0\"\n    },\n    {\n      \"path\": \"cashiering/WORKFLOW.md\",\n      \"bytes\": 11383,\n      \"sha256\": \"572f1cf5ec8c0ef0ffa9fc528393ed182d81da629606eeb12db34c994ab30a65\"\n    },\n    {\n      \"path\": \"README.md\",\n      \"bytes\": 12099,\n      \"sha256\": \"74a2898aaa12c26794350809850ea34dfc82e893fbacdff47eea67d93174c27f\"\n    },\n    {\n      \"path\": \"workspace/API.md\",\n      \"bytes\": 15572,\n      \"sha256\": \"c7e841a31161777fc8ac60a475e5dac1f4776f12a1db6687e6c1bc8358a22c9c\"\n    },\n    {\n      \"path\": \"workspace/app.py\",\n      \"bytes\": 40237,\n      \"sha256\": \"7f1c9b716b7bb645d2c2c2ee76542c0552a0150f30b56a6f68edb8b6ebe48665\"\n    },\n    {\n      \"path\": \"workspace/audit-bridge.mjs\",\n      \"bytes\": 411,\n      \"sha256\": \"6c51dc56641cd36fe80bbf81c17263f552d54ee28060b5d07fef9f2284d24297\"\n    },\n    {\n      \"path\": \"workspace/intake.py\",\n      \"bytes\": 15408,\n      \"sha256\": \"b9822436a09e1eef50b114bcf78c785b463805d3ac3edbefea43ca9adf8eb95a\"\n    },\n    {\n      \"path\": \"workspace/public/app.mjs\",\n      \"bytes\": 51842,\n      \"sha256\": \"c71cf0c578d49f146332d21fc399d566cc4d7d1de2e9c11f56795a962f5c89f7\"\n    },\n    {\n      \"path\": \"workspace/public/index.html\",\n      \"bytes\": 1586,\n      \"sha256\": \"6233697cf743520f926a22f3f255c4e7331c97274fc139b15893d8ff0ebef261\"\n    },\n    {\n      \"path\": \"workspace/public/style.css\",\n      \"bytes\": 7596,\n      \"sha256\": \"4bad99effc8a4096a195d33cbd963db9daa0fc1b50a15921c9c20a7248ade52f\"\n    },\n    {\n      \"path\": \"workspace/scenarios.py\",\n      \"bytes\": 5113,\n      \"sha256\": \"25b0503ad79ee8aa9259727198bcc86b96586e4381c4d44fca5f5880f6650b17\"\n    }\n  ]\n}\n"
CONTROLLERS=json.loads("[{\"path\":\"native-run/build.py\",\"commit\":\"ea44ac52d4cd1d454db4eb3873c34f25a2044e11\",\"source_path\":\"revenue/berkeley-clariti-32600118-20261010/cashiering/acceptance/native-run/build.py\",\"bytes\":27414,\"sha256\":\"f96ec398e56e1a215fb31ebc9d07d3fe5572a410d2b66b8bc60e3f3fba21d2d1\"},{\"path\":\"browser-continuation.mjs\",\"commit\":\"f797f1e33e8847ec54131f5eb4bd9163a86a26bb\",\"source_path\":\"revenue/berkeley-clariti-32600118-20261010/cashiering/acceptance/browser-continuation.mjs\",\"bytes\":69726,\"sha256\":\"f6b27b7b6c23b9b339065b6258b2b1a667ddda4f41133e52fe809e8ed75e43ca\"}]")
REPO="woahwhattheheck/public-commons-sprint-2026"
OPERATION="berkeley-daily-cashiering-native-82e4-20261012"
PREVIOUS_BROWSER="4b8f92f97404beece2a1a56f87c70d8d81c01ff0a210eeb569480b83c0108088"
PREVIOUS_BROWSER_COMMIT="4ce8750f054b2447792a0c972bef90fd0061b585"

def digest(data):return hashlib.sha256(data).hexdigest()
def relative(text):
    p=PurePosixPath(text)
    if p.is_absolute() or not p.parts or any(x in {"",".",".."} for x in p.parts):
        raise ValueError("A fixed relative source path is required.")
    return Path(*p.parts)
def retain(path,data,expected=None):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    replacing=False
    if path.exists() or path.is_symlink():
        if not path.is_file() or path.is_symlink():
            raise ValueError("Original source path must remain a regular file: "+str(path))
        current=path.read_bytes()
        if current==data:return
        if expected is None or current!=expected:
            raise ValueError("Existing source differs; preserve and reconcile it before replacement: "+str(path))
        replacing=True
    fd,name=tempfile.mkstemp(prefix="."+path.name+".receiving-",dir=path.parent)
    temporary=Path(name)
    try:
        with os.fdopen(fd,"wb") as handle:
            handle.write(data);handle.flush();os.fsync(handle.fileno())
        if replacing:
            if path.is_symlink() or path.read_bytes()!=expected:
                raise ValueError("Original source changed during explicit adoption: "+str(path))
            os.replace(temporary,path)
        else:
            try:os.link(temporary,path)
            except FileExistsError:
                if path.is_symlink() or not path.is_file() or path.read_bytes()!=data:
                    raise ValueError("Concurrent source differs: "+str(path))
    finally:
        try:temporary.unlink()
        except FileNotFoundError:pass
def fetch(item):
    request=urllib.request.Request(item["url"],headers={"User-Agent":"Commons-Berkeley-82E4-source-receiver","Accept":"application/octet-stream"})
    with urllib.request.urlopen(request,timeout=45) as response:
        raw=response.read(item["bytes"]+1)
    if len(raw)!=item["bytes"] or digest(raw)!=item["sha256"]:
        raise ValueError("Original source length/hash differs: "+item["path"])
    return raw
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True)
    parser.add_argument("--adopt-browser-from",choices=[PREVIOUS_BROWSER],help="Adopt this exact corrected controller after the original process is closed; preserves the same saved case.")
    opts=parser.parse_args()
    root=Path(opts.directory).expanduser().resolve()
    if root==Path(root.anchor):raise ValueError("Select an owned operation directory.")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    composition=json.loads(COMPOSITION_TEXT)
    entries=[]
    for row in composition["files"]:
        source_path=composition["component_prefix"]+"/"+row["path"]
        entries.append({**row,"path":"source/"+source_path,"url":"https://raw.githubusercontent.com/"+REPO+"/"+composition["source_commit"]+"/"+source_path})
    for row in CONTROLLERS:
        entries.append({**row,"url":"https://raw.githubusercontent.com/"+REPO+"/"+row["commit"]+"/"+row["source_path"]})
    actual=[]
    for row in entries:
        target=root/relative(row["path"])
        if target.is_file() and not target.is_symlink():
            raw=target.read_bytes()
            if len(raw)!=row["bytes"] or digest(raw)!=row["sha256"]:
                if row["path"]!="browser-continuation.mjs" or opts.adopt_browser_from is None or digest(raw)!=opts.adopt_browser_from:
                    raise ValueError("Existing owned file differs: "+str(target))
                completed=root/"browser-run/result.json"
                if completed.exists() and json.loads(completed.read_text(encoding="utf-8")).get("status")=="PASS":
                    raise ValueError("Preserve the already completed original browser result and controller.")
                original=raw;raw=fetch(row);retain(target,raw,expected=original)
        else:
            raw=fetch(row);retain(target,raw)
        actual.append({"path":row["path"],"bytes":len(raw),"sha256":digest(raw),"source_url":row["url"]})
        print(json.dumps({"retained":row["path"],"bytes":len(raw)}),flush=True)
    retain(root/"source-composition.json",COMPOSITION_TEXT.encode("utf-8"))
    selection={"schema":"berkeley.cashiering.receiving-source.v1","operation_id":OPERATION,"repository":REPO,
        "source_commit":composition["source_commit"],"source_composition_sha256":digest(COMPOSITION_TEXT.encode("utf-8")),
        "files":actual,"controller_operations":{"native":OPERATION,"browser":"berkeley-daily-cashiering-browser-82e4-20261012"}}
    previous=None
    if opts.adopt_browser_from is not None:
        previous=json.loads(json.dumps(selection))
        for row in previous["files"]:
            if row["path"]=="browser-continuation.mjs":
                row["bytes"]=66737;row["sha256"]=PREVIOUS_BROWSER
                row["source_url"]="https://raw.githubusercontent.com/"+REPO+"/"+PREVIOUS_BROWSER_COMMIT+"/"+composition["component_prefix"]+"/cashiering/acceptance/browser-continuation.mjs"
        previous=(json.dumps(previous,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    retain(root/"receiving-source.json",(json.dumps(selection,ensure_ascii=False,indent=2)+"\n").encode("utf-8"),expected=previous)
    print(json.dumps({"status":"SOURCE_READY","directory":str(root),"files":len(actual),
        "bytes":sum(row["bytes"] for row in actual),"source_commit":composition["source_commit"],
        "source_composition_sha256":selection["source_composition_sha256"],"operation_registered":False}),flush=True)

if __name__=="__main__":main()
