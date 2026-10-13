#!/usr/bin/env python3
"""Inspect the installed original dlt runtime; does not construct or run a pipeline."""
import hashlib, importlib.metadata as md, json, os, pathlib, platform, sys, sysconfig
root=pathlib.Path(sys.argv[1]).absolute()
source=root/"source"
envroot=root/"environment"
def sha(data): return hashlib.sha256(data).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
if sys.version_info[:2] != (3,12) or platform.python_implementation() != "CPython":
    raise RuntimeError("Select the original CPython3.12 runtime.")
import dlt, duckdb
if md.version("dlt") != "1.31.0":
    raise RuntimeError("The installed dlt version differs from the original source.")
if pathlib.Path(dlt.__file__).resolve().is_relative_to(source.resolve()) is False:
    raise RuntimeError("dlt must import from the complete selected original checkout.")
records=[]
for dist in md.distributions():
    name=dist.metadata["Name"]
    if not name or not dist.files: raise RuntimeError("An installed distribution lacks its complete file inventory.")
    files=[]
    for item in sorted(dist.files,key=str):
        rel=str(item)
        if rel.endswith((".pyc",".pyo")) or "__pycache__" in pathlib.PurePosixPath(rel).parts: continue
        path=pathlib.Path(dist.locate_file(item))
        resolved=path.resolve()
        if not resolved.is_relative_to(envroot.resolve()):
            raise RuntimeError("An installed distribution member escapes the selected environment: "+rel)
        if not path.is_file(): raise RuntimeError("A declared installed member is missing: "+rel)
        raw=path.read_bytes()
        # RECORD contains generated local paths/digests and is checked locally,
        # while its complete listed payload is independently measured below.
        normalized=raw
        if rel.endswith((".pth","direct_url.json","RECORD")) or "/bin/" in str(path):
            normalized=normalized.replace(str(root).encode(),b"<RUNTIME_ROOT>")
        files.append({"path":rel,"bytes":len(raw),"sha256":sha(raw),
                      "identityBytes":len(normalized),"identitySha256":sha(normalized)})
    records.append({"name":name.lower().replace("_","-"),"version":dist.version,"files":files})
records.sort(key=lambda d:(d["name"],d["version"]))
if len({d["name"] for d in records}) != len(records): raise RuntimeError("Duplicate installed distribution.")
# RECORD hashes include location-specific editable files. The independently
# measured payload and metadata are the path-independent selected identity.
identity_distributions=[{"name":d["name"],"version":d["version"],"files":[
    {"path":f["path"],"bytes":f["identityBytes"],"sha256":f["identitySha256"]}
    for f in d["files"] if not f["path"].endswith("/RECORD")]} for d in records]
python={"executable":sys.executable,"version":platform.python_version(),
        "implementation":platform.python_implementation(),"cacheTag":sys.implementation.cache_tag,
        "binarySha256":sha(pathlib.Path(sys.executable).read_bytes()),
        "soabi":sysconfig.get_config_var("SOABI"),"system":platform.system(),
        "machine":platform.machine(),"libc":list(platform.libc_ver())}
print(json.dumps({"python":python,"dlt":{"version":md.version("dlt"),"file":str(pathlib.Path(dlt.__file__).absolute())},
                  "duckdb":{"version":md.version("duckdb"),"engineVersion":duckdb.__version__},
                  "distributions":records,"identityDistributions":identity_distributions},
                 sort_keys=True,separators=(",",":"),ensure_ascii=False))
