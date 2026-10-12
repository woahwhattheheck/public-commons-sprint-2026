import contextlib,hashlib,json,os,stat,tempfile,urllib.request
from pathlib import Path

def preserve_official_aviary_runtime(value,bridge_namespace):
 root=Path("/dev/aviary-newhost-runtime-6ba15");root.mkdir(parents=True,exist_ok=True,mode=0o700)
 path=root/"chrome-headless-shell-linux64-155.0.8059.39.zip"
 expected={"bytes":124203329,"sha256":"39dcb8c46550632a3d911850ab3b8af840b4e3f6d8622faa2018eb8756278786"}
 url="https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/linux64/chrome-headless-shell-linux64.zip"
 def need(ok,message):
  if not ok:raise RuntimeError(message)
 def emit(name,**data):print(json.dumps({"event":name,"operation":"AVIARY-COMPLETE-DELIVERY-6BA15-20261012",**data}),flush=True)
 def identity(source):
  with open(source,"rb") as held:
   before=os.fstat(held.fileno());need(stat.S_ISREG(before.st_mode),"Official runtime source is not regular")
   digest=hashlib.sha256();count=0
   for block in iter(lambda:held.read(262144),b""):digest.update(block);count+=len(block)
   after=os.fstat(held.fileno())
  need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),
       "Official runtime source changed")
  return {"bytes":count,"sha256":digest.hexdigest()}
 receipt={"schema":"commons.aviary.official-runtime-preservation.v1","version":"155.0.8059.39",
          "url":url,"archive":expected,"applicationArtifactsAlreadySaved":True}
 if path.exists():
  need(not path.is_symlink() and identity(path)==expected,"The retained official runtime archive differs")
  receipt["acquisition"]="Existing exact official release bytes"
 else:
  descriptor,temporary=tempfile.mkstemp(prefix=".official-shell-save-",dir=root)
  try:
   with os.fdopen(descriptor,"wb") as output:
    with urllib.request.urlopen(urllib.request.Request(url,headers={"Accept":"application/zip"},method="GET"),timeout=90) as response:
     need(response.status==200,"Official runtime source did not return success")
     size=response.headers.get("Content-Length")
     need(size is None or int(size)==expected["bytes"],"Official runtime response size differs")
     digest=hashlib.sha256();count=0;next_report=8388608
     receipt["response"]={key:response.headers.get(key) for key in ("Content-Length","Content-Type","ETag","Last-Modified")}
     for block in iter(lambda:response.read(262144),b""):
      count+=len(block);need(count<=expected["bytes"],"Official runtime response exceeded its exact release size")
      digest.update(block);output.write(block)
      if count>=next_report:emit("OFFICIAL_RUNTIME_SAVE_DOWNLOAD_PROGRESS",received=count,total=expected["bytes"]);next_report+=8388608
     need(count==expected["bytes"] and digest.hexdigest()==expected["sha256"],"Official runtime source bytes differ")
    output.flush();os.fsync(output.fileno())
   os.link(temporary,path)
   receipt["acquisition"]="Official public release GET after the completed application saves"
  finally:
   with contextlib.suppress(FileNotFoundError):os.unlink(temporary)
 namespace={"__name__":"aviary_runtime_preservation","__file__":"complete_aviary_delivery.py","PAYLOAD":json.loads(value["inputText"])}
 source=namespace["PAYLOAD"]["program"]
 exec(compile(source,"complete_aviary_delivery.py","exec"),namespace)
 bridge_namespace["install_aviary_library_tool_bridge"](namespace)
 raw=(json.dumps(receipt,sort_keys=True,indent=2)+"\n").encode()
 namespace["publish"](namespace["ROOT"]/"producer-source"/"history-86320"/("official-runtime-save-"+hashlib.sha256(raw).hexdigest()+".json"),raw)
 saved=namespace["save_artifact"](path)
 emit("OFFICIAL_BROWSER_RUNTIME_SAVED",source=saved["source"],result=saved["result"],receipt=receipt)
 return saved
