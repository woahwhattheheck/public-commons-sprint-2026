#!/usr/bin/env python3
"""Capture the exact public USGS example and retain its original source receipts."""
from __future__ import annotations
import argparse,contextlib,csv,datetime as dt,email.utils,fcntl,hashlib,html.parser,http.client,json,os,re,shutil,sys,tempfile,urllib.error,urllib.request,uuid
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
class CaptureFailure(RuntimeError):
 def __init__(self,message,record=None):super().__init__(message);self.record=record

def allowed_url(value):
 parts=urlsplit(value)
 if parts.scheme!="https" or parts.hostname not in ALLOWED or parts.username or parts.password or parts.port not in (None,443):
  raise ValueError("Unexpected public source URL: "+value)
 return value

class SourceRedirect(urllib.request.HTTPRedirectHandler):
 def __init__(self):super().__init__();self.chain=[]
 def redirect_request(self,request,fp,code,msg,headers,newurl):
  allowed_url(newurl);self.chain.append({"from":request.full_url,"to":newurl,"status":code})
  return super().redirect_request(request,fp,code,msg,headers,newurl)

CAPTURE_HEADERS={"content-type","content-length","content-encoding","etag","last-modified","retry-after","date","location"}

def response_headers(headers):
 return {str(k).lower():str(v) for k,v in headers.items() if str(k).lower() in CAPTURE_HEADERS}

def retry_at(headers):
 value=headers.get("retry-after","").strip()
 if not value:return None
 try:
  if value.isdigit():when=dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=int(value))
  else:when=email.utils.parsedate_to_datetime(value)
  if when.tzinfo is None:when=when.replace(tzinfo=dt.timezone.utc)
  return when.astimezone(dt.timezone.utc).isoformat()
 except (ValueError,TypeError,OverflowError):return None

def capture_record(item,transport,started):
 return {"schema":"commons.http.source-capture.v2","request_url":item["url"],"final_url":None,
  "status":None,"started_at":started,"completed_at":None,"headers":{},
  "bytes":0,"sha256":sha(b""),"source_page":item.get("source_page",item["url"]),
  "transport":transport,"body_complete":False,"body_truncated":False,
  "body_representation":"HTTP response entity bytes; transfer framing removed",
  "error":None,"retry_at":None}

def finish_record(record,body):
 record.update(completed_at=stamp(),bytes=len(body),sha256=sha(body),retry_at=retry_at(record["headers"]))
 return record,body

def store_capture(folder,record,body):
 folder.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 staged=Path(tempfile.mkdtemp(prefix=".capture-",dir=folder.parent))
 try:
  publish(staged/"body.bin",body);publish(staged/"response.json",raw_json(record));sync_dir(staged)
  os.rename(staged,folder);sync_dir(folder.parent)
 except BaseException:
  shutil.rmtree(staged,ignore_errors=True);raise

def store_attempt(root,item,record,body):
 attempt_id=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")+"-"+uuid.uuid4().hex[:8]
 folder=safe(root,"capture-attempts/"+item["id"]+"/"+attempt_id)
 store_capture(folder,record,body)
 print(json.dumps({"capture_attempt":item["id"],"status":record["status"],"bytes":record["bytes"],
  "sha256":record["sha256"],"error":record["error"],"retry_at":record["retry_at"],
  "response_path":str(folder/"response.json")}),flush=True)
 return folder

def active_retry(root,item):
 host=urlsplit(item["url"]).hostname;now=dt.datetime.now(dt.timezone.utc);active=[]
 for path in (root/"capture-attempts").glob("*/*/response.json"):
  record=json.loads(path.read_text("utf-8"));value=record.get("retry_at")
  if value and urlsplit(record["request_url"]).hostname==host:
   when=dt.datetime.fromisoformat(value)
   if when>now:active.append((when,record))
 return max(active,key=lambda x:x[0])[1] if active else None


PUBLISHER_TEXT_REPRESENTATION="Web open extracted text with original source-line numbering; HTTP entity bytes and response status are not supplied"

def publisher_text(record,body):
 """Read the retained retrieval representation and check its original source identity."""
 if record.get("schema")!="commons.publisher.text-capture.v1" or record.get("transport")!="web-open-extraction":
  raise ValueError("Unsupported publisher text representation")
 if record.get("status") is not None or record.get("headers")!={} or record.get("final_url") is not None:
  raise ValueError("A retrieved text representation does not supply an HTTP status, headers or final redirect URL")
 if record.get("body_representation")!=PUBLISHER_TEXT_REPRESENTATION or not record.get("body_complete") or record.get("body_truncated"):
  raise ValueError("Publisher text representation is incomplete")
 if len(body)!=record.get("bytes") or sha(body)!=record.get("sha256"):raise ValueError("Publisher text bytes changed")
 original=body.decode("utf-8-sig")
 marker=re.search(r"^【([^】]+)】[^\n]*Source: open\((\{[^\n]*\})\); Total lines: (\d+)$",original,re.M)
 if marker is None:raise ValueError("Original retrieval metadata is absent")
 request=json.loads(marker.group(2));total=int(marker.group(3));retrieval=record.get("retrieval",{})
 url=allowed_url(record["request_url"])
 if request.get("ref_id")!=url or request.get("lineno") is not None or record.get("source_url")!=url:
  raise ValueError("Publisher text belongs to another source request")
 if retrieval.get("tool")!="web.open" or retrieval.get("source_ref")!=marker.group(1) or retrieval.get("source_url")!=url or retrieval.get("total_lines")!=total:
  raise ValueError("Publisher retrieval identity differs")
 rows=re.findall(r"^L(\d+): ?(.*)$",original,re.M)
 if len(rows)!=total or [int(row[0]) for row in rows]!=list(range(total)):
  raise ValueError("Publisher retrieval is missing source lines")
 # Retain the unmodified retrieval separately. Only remove its line/link/heading
 # display notation when extracting readable publisher text.
 text="\n".join(value for _,value in rows)
 text=re.sub(r"【\d+†([^†】]+)(?:†[^】]+)?】",lambda m:m.group(1),text)
 return re.sub(r"(?m)^#{1,6}[ \t]+","",text)

def publisher_text_inputs(path,packet):
 if path is None:return {},None
 raw=Path(path).read_bytes();value=json.loads(raw)
 if value.get("schema")!="commons.aviary.publisher-text-input.v1" or value.get("operation")!=packet["operation"]:
  raise ValueError("Publisher text input belongs to another receiving operation")
 declared={item["id"]:item for item in packet["downloads"] if item["media_type"]=="text/html"}
 captured={}
 for entry in value.get("captures",[]):
  identifier=entry["id"]
  if identifier in captured or identifier not in declared:raise ValueError("Unexpected or repeated publisher capture")
  item=declared[identifier];record=entry["record"];body=entry["body"].encode("utf-8")
  if record.get("request_url")!=item["url"] or record.get("source_path")!=str(PurePosixPath(item["path"]).with_suffix(".web-open.txt")):
   raise ValueError("Publisher capture source URL or representation path differs")
  problem=validate_capture(item,record,body)
  if problem:raise ValueError(identifier+": "+problem)
  captured[identifier]=(record,body)
 return captured,raw

def capture_source_path(item,record):
 if record.get("schema")=="commons.publisher.text-capture.v1":
  return str(PurePosixPath(item["path"]).with_suffix(".web-open.txt"))
 return item["path"]

def validate_capture(item,record,body):
 if record.get("schema")=="commons.publisher.text-capture.v1":
  if item["media_type"]!="text/html" or not item["id"].endswith("-page"):return "Text retrieval is only valid for the declared publisher pages"
  if not body or len(body)>item["max_bytes"]:return "Publisher text is empty or exceeds its declared maximum"
  try:text=publisher_text(record,body)
  except (ValueError,KeyError,UnicodeError,TypeError) as error:return str(error)
  if record["request_url"]!=item["url"]:return "Publisher text source differs"
  if not re.search(r"Public\s+Domain",text,re.I):return "The original publisher public-domain statement is absent"
  return None
 if record["status"]!=200:return "Original source returned HTTP "+str(record["status"])
 if record.get("error"):return record["error"]
 if not record.get("body_complete",True) or record.get("body_truncated",False):return "Original response body is incomplete"
 if not body:return "Original source is empty"
 if len(body)>item["max_bytes"]:return "Original source exceeds its declared maximum"
 mime=item["media_type"]
 if mime=="image/jpeg" and not body.startswith(b"\xff\xd8\xff"):return "Original source is not JPEG"
 if mime=="audio/mpeg" and not (body.startswith(b"ID3") or any(body[i]==255 and body[i+1]&224==224 for i in range(min(4096,len(body)-1)))):
  return "Original source has no MP3 header"
 if mime=="text/html":
  if b"<html" not in body[:8192].lower():return "Original source is not HTML"
  try:
   parser=PageText();parser.feed(body.decode("utf-8-sig"))
  except UnicodeDecodeError:return "Original publisher HTML is not UTF-8"
  if item["id"].endswith("-page") and not re.search(r"Public\s+Domain",parser.text(),re.I):
   return "The original publisher public-domain statement is absent"
 return None

def http_capture(item):
 allowed_url(item["url"]);record=capture_record(item,"urllib",stamp());body=bytearray()
 redirect=SourceRedirect();opener=urllib.request.build_opener(redirect)
 request=urllib.request.Request(item["url"],headers={"User-Agent":"AviaryPublicSourceReceiving/1.1",
  "Accept":"text/html,application/xhtml+xml" if item["media_type"]=="text/html" else "*/*","Accept-Encoding":"identity"})
 response=None
 try:
  try:response=opener.open(request,timeout=45)
  except urllib.error.HTTPError as error:response=error
  with contextlib.closing(response):
   record.update(status=response.status,final_url=allowed_url(response.geturl()),headers=response_headers(response.headers))
   while len(body)<=item["max_bytes"]:
    try:chunk=response.read(min(65536,item["max_bytes"]+1-len(body)))
    except http.client.IncompleteRead as error:
     body.extend(error.partial[:item["max_bytes"]+1-len(body)]);record["error"]="IncompleteRead: "+str(error);break
    if not chunk:record["body_complete"]=True;break
    body.extend(chunk)
    if len(body)>item["max_bytes"]:
     record.update(body_truncated=True,error="Response exceeds declared maximum");break
   length=record["headers"].get("content-length","")
   if record["body_complete"] and length.isdigit() and int(length)!=len(body):
    record.update(body_complete=False,error="Content-Length differs from received response entity")
 except Exception as error:record["error"]=type(error).__name__+": "+str(error)
 record["redirects"]=redirect.chain
 return finish_record(record,bytes(body))

class PublisherBrowser:
 """Optional ordinary Chromium navigation; preserve network bodies, never generated page text."""
 def __init__(self,executable=None):
  self.executable=executable;self.playwright=None;self.browser=None;self.context=None;self.cleanup_errors=[]
 def close(self):
  for name,method in (("context","close"),("browser","close"),("playwright","stop")):
   value=getattr(self,name)
   try:
    if value:getattr(value,method)()
   except Exception as error:self.cleanup_errors.append({"stage":name,"error":type(error).__name__+": "+str(error)})
   finally:setattr(self,name,None)
  return self.cleanup_errors
 def start(self):
  if self.context:return
  from playwright.sync_api import sync_playwright
  self.playwright=sync_playwright().start()
  options={"headless":True,"args":["--disable-dev-shm-usage"]}
  if self.executable:options["executable_path"]=self.executable
  self.browser=self.playwright.chromium.launch(**options)
  self.context=self.browser.new_context(accept_downloads=False)
 def capture(self,root,item):
  started=stamp();seen=[];page=None;navigation_error=None
  try:
   self.start();page=self.context.new_page()
   def observe(response):
    if response.request.is_navigation_request() and response.frame==page.main_frame:seen.append(response)
   page.on("response",observe)
   try:
    page.goto(allowed_url(item["url"]),wait_until="domcontentloaded",timeout=45000)
    if item["id"].endswith("-page"):
     page.get_by_text(re.compile(r"Public\s+Domain",re.I)).first.wait_for(state="attached",timeout=15000)
   except Exception as error:navigation_error=type(error).__name__+": "+str(error)
   final=allowed_url(page.url)
   for response in seen:
    record=capture_record(item,"playwright-chromium",started);body=b""
    record["body_representation"]="Browser-decoded HTTP response entity; Content-Length may describe encoded bytes"
    record["navigation_error"]=navigation_error
    try:
     record.update(status=response.status,final_url=allowed_url(response.url),headers=response_headers(response.headers))
     complete=response.body();body=complete[:item["max_bytes"]+1]
     record.update(body_complete=len(complete)<=item["max_bytes"],body_truncated=len(complete)>item["max_bytes"])
     if record["body_truncated"]:record["error"]="Response exceeds declared maximum"
    except Exception as error:record["error"]=type(error).__name__+": "+str(error)
    finish_record(record,body);problem=validate_capture(item,record,body)
    if not problem and urlsplit(record["final_url"])._replace(fragment="")==urlsplit(final)._replace(fragment=""):
     return record,body
    record["error"]=problem or "Earlier browser navigation response; final document differs"
    store_attempt(root,item,record,body)
   raise CaptureFailure(navigation_error or "Browser did not return the original publisher document")
  except CaptureFailure:raise
  except Exception as error:
   record=capture_record(item,"playwright-chromium",started)
   record["error"]=type(error).__name__+": "+str(error);finish_record(record,b"")
   store_attempt(root,item,record,b"");raise CaptureFailure(record["error"],record) from error
  finally:
   if page:
    try:page.close()
    except Exception as error:self.cleanup_errors.append({"stage":"page","error":type(error).__name__+": "+str(error)})


class NodePublisherBrowser:
 """Use the installed Node Playwright runtime with the same original capture contract."""
 def __init__(self,executable=None,node_executable=None,playwright_module=None):
  self.executable=executable;self.node=node_executable or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
  self.module=playwright_module;self.cleanup_errors=[]
 def close(self):return self.cleanup_errors
 def capture(self,root,item):
  import signal,subprocess
  started=stamp();directory=Path(tempfile.mkdtemp(prefix="publisher-node-",dir=root))
  record=None;body=b""
  try:
   helper=Path(__file__).resolve().with_name("capture-publisher-page.mjs")
   if not self.node or not helper.is_file():raise RuntimeError("Node publisher browser or its companion source is unavailable")
   request={"item":item,"directory":str(directory),"executable":self.executable,"playwright_module":self.module}
   process=subprocess.Popen([self.node,str(helper)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
   try:stdout,stderr=process.communicate(raw_json(request),timeout=120)
   except subprocess.TimeoutExpired:
    os.killpg(process.pid,signal.SIGTERM)
    try:stdout,stderr=process.communicate(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);stdout,stderr=process.communicate()
    raise RuntimeError("Publisher browser exceeded its capture timeout; child group drained")
   result_path=directory/"result.json"
   if not result_path.is_file():raise RuntimeError("Publisher browser returned no capture result: "+stderr.decode("utf-8","replace")[-3000:])
   result=json.loads(result_path.read_text("utf-8"))
   if result.get("schema")!="commons.browser.publisher-capture.v1" or result.get("request_url")!=item["url"]:
    raise ValueError("Publisher browser result belongs to another request")
   self.cleanup_errors.extend(result.get("cleanup",[]))
   for entry in result["records"]:
    record=json.loads(safe(directory,entry["record"]).read_text("utf-8"));body=safe(directory,entry["body"]).read_bytes()
    if record.get("request_url")!=item["url"] or len(body)!=record["bytes"] or sha(body)!=record["sha256"]:
     raise ValueError("Publisher browser original response changed")
    allowed_url(record["final_url"])
    problem=validate_capture(item,record,body)
    if not problem and entry["finalDocument"]:return record,body
    record["error"]=problem or "Earlier browser navigation response; final document differs"
    store_attempt(root,item,record,body)
   raise CaptureFailure(result.get("navigation_error") or "Browser did not return the original publisher document",record)
  except CaptureFailure:raise
  except Exception as error:
   record=capture_record(item,"node-playwright-chromium",started)
   record["error"]=type(error).__name__+": "+str(error);finish_record(record,b"")
   store_attempt(root,item,record,b"");raise CaptureFailure(record["error"],record) from error
  finally:
   try:shutil.rmtree(directory)
   except Exception as error:self.cleanup_errors.append({"stage":"node-capture-directory","error":type(error).__name__+": "+str(error)})

def publish_captured(path,original,record):
 """Link immutable captured bytes into the source tree; copy only across filesystems."""
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.exists():
  raw=path.read_bytes()
  if len(raw)!=record["bytes"] or sha(raw)!=record["sha256"]:raise ValueError("Existing source member differs: "+str(path))
  return
 try:os.link(original,path);sync_dir(path.parent)
 except FileExistsError:
  raw=path.read_bytes()
  if len(raw)!=record["bytes"] or sha(raw)!=record["sha256"]:raise
 except OSError as error:
  import errno
  if error.errno!=errno.EXDEV:raise
  publish(path,original.read_bytes())

def read_capture(root,item,browser=None,publisher_texts=None):
 folder=safe(root,"captures/"+item["id"])
 if folder.exists():
  record=json.loads((folder/"response.json").read_text("utf-8"));body=(folder/"body.bin").read_bytes()
  if record["request_url"]!=item["url"] or len(body)!=record["bytes"] or sha(body)!=record["sha256"]:
   raise ValueError("Captured source changed: "+item["id"])
  problem=validate_capture(item,record,body)
  if problem:raise ValueError("Retained capture is invalid: "+item["id"]+": "+problem)
  return record,body
 if publisher_texts and item["id"] in publisher_texts:
  record,body=publisher_texts[item["id"]]
  problem=validate_capture(item,record,body)
  if problem:raise ValueError(problem)
  store_capture(folder,record,body)
  print(json.dumps({"captured":item["id"],"bytes":len(body),"sha256":record["sha256"],"transport":record["transport"],"source_ref":record["retrieval"]["source_ref"]}),flush=True)
  return record,body
 waiting=active_retry(root,item)
 if waiting:raise CaptureFailure("Original host Retry-After remains active until "+waiting["retry_at"],waiting)
 record,body=http_capture(item);problem=validate_capture(item,record,body)
 if problem:
  record["error"]=problem;store_attempt(root,item,record,body)
  if browser and item["media_type"]=="text/html" and not active_retry(root,item):
   record,body=browser.capture(root,item);problem=validate_capture(item,record,body)
  if problem:raise CaptureFailure(item["id"]+": "+problem,record)
 store_capture(folder,record,body)
 print(json.dumps({"captured":item["id"],"bytes":len(body),"sha256":record["sha256"],"transport":record.get("transport","retained-original")}),flush=True)
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
def source_transcript(raw,record=None):
 if record and record.get("schema")=="commons.publisher.text-capture.v1":text=publisher_text(record,raw)
 else:
  parser=PageText();parser.feed(raw.decode("utf-8-sig"));text=parser.text()
 match=re.search(r"(?:^|\n)\s*Transcript\s*\n(.*?)\n\s*Show\s+Transcript(?:\s*\n|$)",text,re.S)
 if not match:raise ValueError("The original transcript section was not found in the retained publisher representation.")
 text=match.group(1).strip()
 text=re.sub(r"[ \t]*\n[ \t]*","\n",text)
 text=re.sub(r"\n{3,}","\n\n",text)
 if not 100<len(text)<50000:raise ValueError("Unexpected original transcript length")
 return (text+"\n").encode("utf-8")
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--packet",required=True);ap.add_argument("--directory",required=True);ap.add_argument("--api-documentation",action="store_true");ap.add_argument("--publisher-browser",action="store_true",help="Use installed Playwright/Chromium for publisher pages after a failed direct response");ap.add_argument("--browser-executable",help="Optional existing Chromium executable");ap.add_argument("--publisher-browser-runtime",choices=("python","node"),default="python",help="Use the installed Python or Node Playwright runtime");ap.add_argument("--node-executable",help="Existing Node executable for publisher browser capture");ap.add_argument("--playwright-module",help="Existing Node Playwright module entrypoint");ap.add_argument("--publisher-text-manifest",help="Retained original web.open page representations and source identities; media still use their original HTTP captures");args=ap.parse_args()
 packet_raw=Path(args.packet).read_bytes();packet=json.loads(packet_raw)
 if packet["schema"]!="commons.aviary.public-source-example-input.v1":raise ValueError("Unsupported packet")
 root=Path(args.directory).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(root/".receiving.lock","a+b") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  publish(root/"receiving-input.json",packet_raw)
  publisher_texts,publisher_input=publisher_text_inputs(args.publisher_text_manifest,packet)
  if publisher_input is not None:publish(root/"publisher-text-input.json",publisher_input)
  source=root/"source";source.mkdir(exist_ok=True,mode=0o700)
  for item in packet["files"]:
   raw=item["content"].encode("utf-8")
   if len(raw)!=item["bytes"] or sha(raw)!=item["sha256"]:raise ValueError("Packet member hash differs: "+item["path"])
   publish(safe(source,item["path"]),raw)
  captures={};capture_bodies={};failures=[]
  browser=(NodePublisherBrowser(args.browser_executable,args.node_executable,args.playwright_module) if args.publisher_browser_runtime=="node" else PublisherBrowser(args.browser_executable)) if args.publisher_browser else None
  try:
   for item in packet["downloads"]:
    try:record,body=read_capture(root,item,browser,publisher_texts)
    except CaptureFailure as error:
     failures.append({"id":item["id"],"url":item["url"],"error":str(error),"response":error.record})
     continue
    captures[item["id"]]=record
    if item["media_type"]=="text/html":capture_bodies[item["id"]]=body
    publish_captured(safe(source,capture_source_path(item,record)),safe(root,"captures/"+item["id"]+"/body.bin"),record)
  finally:
   if browser:
    cleanup=browser.close()
    if cleanup:
     cleanup_record={"schema":"commons.browser.capture-cleanup.v1","completed_at":stamp(),"errors":cleanup}
     publish(root/"capture-attempts"/("browser-cleanup-"+uuid.uuid4().hex+".json"),raw_json(cleanup_record))
     print(json.dumps(cleanup_record),flush=True)
  if failures:
   result={"schema":"commons.aviary.public-source-example-progress.v1","operation":packet["operation"],
    "state":"INCOMPLETE","packet_sha256":sha(packet_raw),"completed_at":stamp(),
    "captured_ids":list(captures),"failures":failures,"resume_directory":str(root)}
   progress=root/"capture-attempts"/("run-"+uuid.uuid4().hex+".json")
   publish(progress,raw_json(result));print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
   raise SystemExit(2)
  for item in packet["downloads"]:
   if item["media_type"]=="text/html":
    record=captures[item["id"]]
    if record.get("schema")=="commons.publisher.text-capture.v1":page_text=publisher_text(record,capture_bodies[item["id"]])
    else:
     parsed=PageText();parsed.feed(capture_bodies[item["id"]].decode("utf-8-sig"));page_text=parsed.text()
    if not re.search(r"Public\s+Domain",page_text,re.I):raise ValueError("Original public-domain statement is absent: "+item["id"])
  tr=packet["generated_transcript"];body=capture_bodies[tr["source_page_id"]];transcript_record=captures[tr["source_page_id"]];transcript=source_transcript(body,transcript_record)
  publish(safe(source,tr["path"]),transcript)
  transformation={"schema":"commons.source-text-extraction.v1","source_url":captures[tr["source_page_id"]]["request_url"],"source_sha256":sha(body),"output_path":tr["path"],"output_bytes":len(transcript),"output_sha256":sha(transcript),"source_representation":transcript_record.get("body_representation"),"source_ref":transcript_record.get("retrieval",{}).get("source_ref"),"method":("Retained web.open source lines from Transcript heading to Show Transcript; remove retrieval line numbers, link-reference labels and Markdown heading display markers; normalize paragraph whitespace; retain original wording." if transcript_record.get("schema")=="commons.publisher.text-capture.v1" else "HTMLParser text from Transcript heading to Show Transcript; decode HTML entities; normalize paragraph whitespace; retain original wording.")}
  publish(source/"provenance/transcript-extraction.json",raw_json(transformation))
  publish(root/"mapping.json",raw_json(packet["mapping"]))
  counts={}
  for kind,expected in packet["expected_rows"].items():
   with open(source/packet["mapping"]["tables"][kind]["path"],encoding="utf-8-sig",newline="") as f:
    values=list(csv.reader(f,strict=True));width=len(values[0])
    if any(len(row)!=width for row in values):raise ValueError("Source CSV width differs: "+kind)
    counts[kind]=len(values)-1
    if counts[kind]!=expected:raise ValueError("Source CSV count differs: "+kind)
  sources={"schema":"commons.aviary.public-source-capture.v1","operation":packet["operation"],"packet_sha256":sha(packet_raw),"sources":captures,"transcript":transformation,"rights":packet["rights"],"publisher_text_input":({"bytes":len(publisher_input),"sha256":sha(publisher_input),"schema":"commons.aviary.publisher-text-input.v1"} if publisher_input is not None else None),"source_paths":{item["id"]:capture_source_path(item,captures[item["id"]]) for item in packet["downloads"]},"declared_navigation":"The two VTT files are authored navigation indexes; publisher stated durations define their intervals. They are not original speech transcripts."}
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
