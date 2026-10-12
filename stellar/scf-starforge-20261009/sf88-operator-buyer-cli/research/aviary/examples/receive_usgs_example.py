#!/usr/bin/env python3
"""Capture the exact public USGS example and retain its original source receipts."""
from __future__ import annotations
import argparse,contextlib,csv,datetime as dt,fcntl,hashlib,html.parser,json,os,re,shutil,sys,tempfile,urllib.request
from pathlib import Path,PurePosixPath
from urllib.parse import urlsplit
ALLOWED={"www.usgs.gov","d9-wret.s3.us-west-2.amazonaws.com","aviaryplatform.com","www.aviaryplatform.com"}
def raw_json(v):return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def stamp():return dt.datetime.now(dt.timezone.utc).isoformat()
def safe(root,rel):
 p=PurePosixPath(rel)
 if p.is_absolute() or not p.parts or any(x in ("..",".","") for x in p.parts) or "\\" in rel:raise ValueError("Invalid member path")
 target=root.joinpath(*p.parts)
 if target.is_symlink() or any(x.is_symlink() for x in target.parents if x!=root.parent):raise ValueError("Symlink in receiving path")
 return target
def sync_dir(p):
 fd=os.open(p,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
 try:os.fsync(fd)
 finally:os.close(fd)
def publish(path,raw):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.exists():
  if path.read_bytes()!=raw:raise ValueError("Existing member differs: "+str(path))
  return
 fd,name=tempfile.mkstemp(prefix=".receive-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  try:os.link(name,path)
  except FileExistsError:
   if path.read_bytes()!=raw:raise
  sync_dir(path.parent)
 finally:
  with contextlib.suppress(FileNotFoundError):os.unlink(name)
def read_capture(root,item):
 folder=safe(root,"captures/"+item["id"])
 if folder.exists():
  record=json.loads((folder/"response.json").read_text("utf-8"));body=(folder/"body.bin").read_bytes()
  if record["request_url"]!=item["url"] or len(body)!=record["bytes"] or sha(body)!=record["sha256"]:raise ValueError("Captured source changed: "+item["id"])
  return record,body
 parts=urlsplit(item["url"])
 if parts.scheme!="https" or parts.hostname not in ALLOWED or parts.username or parts.password:raise ValueError("Only the selected original public URLs are allowed")
 request=urllib.request.Request(item["url"],headers={"User-Agent":"AviaryPublicSourceReceiving/1.0","Accept":"*/*"})
 started=stamp()
 with urllib.request.urlopen(request,timeout=45) as response:
  if response.status!=200:raise ValueError("Original source did not return 200")
  final=response.geturl()
  if urlsplit(final).scheme!="https" or urlsplit(final).hostname not in ALLOWED:raise ValueError("Unexpected source redirect")
  body=response.read(item["max_bytes"]+1)
  if len(body)>item["max_bytes"]:raise ValueError("Source exceeds declared maximum: "+item["id"])
  headers={k:v for k,v in response.headers.items() if k.lower() in {"content-type","content-length","etag","last-modified"}}
  record={"request_url":item["url"],"final_url":final,"status":response.status,"started_at":started,"completed_at":stamp(),"headers":headers,"bytes":len(body),"sha256":sha(body),"source_page":item.get("source_page",item["url"])}
 if not body:raise ValueError("Empty source: "+item["id"])
 mime=item["media_type"]
 if mime=="image/jpeg" and not body.startswith(b"\xff\xd8\xff"):raise ValueError("Source is not JPEG: "+item["id"])
 if mime=="audio/mpeg" and not (body.startswith(b"ID3") or any(body[i]==255 and body[i+1]&224==224 for i in range(min(4096,len(body)-1)))):raise ValueError("Source has no MP3 header: "+item["id"])
 if mime=="text/html" and b"<html" not in body[:8192].lower():raise ValueError("Source is not HTML: "+item["id"])
 folder.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 staged=Path(tempfile.mkdtemp(prefix=".capture-",dir=folder.parent))
 try:
  publish(staged/"body.bin",body);publish(staged/"response.json",raw_json(record));sync_dir(staged)
  os.rename(staged,folder);sync_dir(folder.parent)
 except BaseException:
  shutil.rmtree(staged,ignore_errors=True);raise
 print(json.dumps({"captured":item["id"],"bytes":len(body),"sha256":record["sha256"]}),flush=True)
 return record,body
class PageText(html.parser.HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ("script","style","noscript"):self.skip+=1
  if not self.skip and tag in ("p","div","h1","h2","h3","h4","li","br","button","section"):self.parts.append("\n")
 def handle_endtag(self,tag):
  if tag in ("script","style","noscript") and self.skip:self.skip-=1;return
  if not self.skip and tag in ("p","div","h1","h2","h3","h4","li","button","section"):self.parts.append("\n")
 def handle_data(self,value):
  if not self.skip:self.parts.append(value)
 def text(self):return "".join(self.parts)
def source_transcript(raw):
 parser=PageText();parser.feed(raw.decode("utf-8-sig"))
 match=re.search(r"(?:^|\n)\s*Transcript\s*\n(.*?)\n\s*Show\s+Transcript(?:\s*\n|$)",parser.text(),re.S)
 if not match:raise ValueError("The original transcript section was not found; inspect the retained HTML instead of substituting text.")
 text=match.group(1).strip()
 text=re.sub(r"[ \t]*\n[ \t]*","\n",text)
 text=re.sub(r"\n{3,}","\n\n",text)
 if not 100<len(text)<50000:raise ValueError("Unexpected original transcript length")
 return (text+"\n").encode("utf-8")
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--packet",required=True);ap.add_argument("--directory",required=True);ap.add_argument("--api-documentation",action="store_true");args=ap.parse_args()
 packet_raw=Path(args.packet).read_bytes();packet=json.loads(packet_raw)
 if packet["schema"]!="commons.aviary.public-source-example-input.v1":raise ValueError("Unsupported packet")
 root=Path(args.directory).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(root/".receiving.lock","a+b") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  publish(root/"receiving-input.json",packet_raw)
  source=root/"source";source.mkdir(exist_ok=True,mode=0o700)
  for item in packet["files"]:
   raw=item["content"].encode("utf-8")
   if len(raw)!=item["bytes"] or sha(raw)!=item["sha256"]:raise ValueError("Packet member hash differs: "+item["path"])
   publish(safe(source,item["path"]),raw)
  captures={};capture_bodies={}
  for item in packet["downloads"]:
   record,body=read_capture(root,item);captures[item["id"]]=record;capture_bodies[item["id"]]=body
   publish(safe(source,item["path"]),body)
  for item in packet["downloads"]:
   if item["media_type"]=="text/html":
    parsed=PageText();parsed.feed(capture_bodies[item["id"]].decode("utf-8-sig"))
    if not re.search(r"Public\s+Domain",parsed.text(),re.I):raise ValueError("Original public-domain statement is absent: "+item["id"])
  tr=packet["generated_transcript"];body=capture_bodies[tr["source_page_id"]];transcript=source_transcript(body)
  publish(safe(source,tr["path"]),transcript)
  transformation={"schema":"commons.source-text-extraction.v1","source_url":captures[tr["source_page_id"]]["request_url"],"source_sha256":sha(body),"output_path":tr["path"],"output_bytes":len(transcript),"output_sha256":sha(transcript),"method":"HTMLParser text from Transcript heading to Show Transcript; decode HTML entities; normalize paragraph whitespace; retain original wording; no timing or generated speech."}
  publish(source/"provenance/transcript-extraction.json",raw_json(transformation))
  publish(root/"mapping.json",raw_json(packet["mapping"]))
  counts={}
  for kind,expected in packet["expected_rows"].items():
   with open(source/packet["mapping"]["tables"][kind]["path"],encoding="utf-8-sig",newline="") as f:
    values=list(csv.reader(f,strict=True));width=len(values[0])
    if any(len(row)!=width for row in values):raise ValueError("Source CSV width differs: "+kind)
    counts[kind]=len(values)-1
    if counts[kind]!=expected:raise ValueError("Source CSV count differs: "+kind)
  sources={"schema":"commons.aviary.public-source-capture.v1","operation":packet["operation"],"packet_sha256":sha(packet_raw),"sources":captures,"transcript":transformation,"rights":packet["rights"],"declared_navigation":"The two VTT files are authored navigation indexes; publisher stated durations define their intervals. They are not original speech transcripts."}
  publish(source/"provenance/source-capture.json",raw_json(sources))
  api=None
  if args.api_documentation:
   item={"id":"aviary-api-documentation","path":"aviary-api-documentation.html","url":"https://aviaryplatform.com/api/v1/documentation","media_type":"text/html","max_bytes":2097152}
   record,body=read_capture(root,item);publish(root/"contract"/item["path"],body)
   text=body.decode("utf-8-sig");locators=[]
   for match in re.finditer(r"swagger|openapi|redoc|api-doc|spec-url|\.ya?ml|<iframe",text,re.I):
    locators.append(text[max(0,match.start()-160):min(len(text),match.end()+500)])
   api={"record":record,"path":str(root/"contract"/item["path"]),"locator_contexts":locators[:60]}
   publish(root/"contract/api-locators.json",raw_json(api))
  inventory=[]
  for path in sorted(source.rglob("*")):
   if path.is_file():
    raw=path.read_bytes();inventory.append({"path":path.relative_to(source).as_posix(),"bytes":len(raw),"sha256":sha(raw)})
  result={"schema":"commons.aviary.public-source-example-receiving.v1","operation":packet["operation"],"state":"COMPLETE","source_directory":str(source),"mapping_path":str(root/"mapping.json"),"packet_sha256":sha(packet_raw),"counts":counts,"files":inventory,"source_bytes":sum(x["bytes"] for x in inventory),"binary_sources":[{"id":i["id"],"path":i["path"],**captures[i["id"]]} for i in packet["downloads"] if i["media_type"]!="text/html"],"api_documentation":api}
  publish(root/"receiving-result.json",raw_json(result))
  print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=="__main__":main()
