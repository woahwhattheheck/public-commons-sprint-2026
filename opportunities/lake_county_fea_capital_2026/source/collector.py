import sys,os,json,hashlib,urllib.request,urllib.error,urllib.parse,datetime,pathlib,subprocess,shutil,concurrent.futures,threading,re,html,zipfile,csv,io,traceback,fcntl,stat,time,select
from html.parser import HTMLParser
ROOT=pathlib.Path(os.environ.get("FEA_PUBLIC_SOURCE_DIR","/dev/fea-lake-county-public-018a-20261012"))
OP="FEA-LAKE-COUNTY-PUBLIC-SOURCE-018A-20261012-01"
SEEDS=[
("rfp_listing","https://www.lakecountyco.gov/bids.aspx?bidID=71"),
("rfp","https://www.lakecountyco.gov/DocumentCenter/View/3141"),
("funding_memo","https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_06092026-838"),
("annual_budget","https://www.lakecountyco.gov/370/Annual-Budget"),
("budget_2026_book","https://www.lakecountyco.gov/DocumentCenter/View/2489/2026-Budget-Book-PDF"),
("budget_2025_book","https://www.lakecountyco.gov/DocumentCenter/View/1689/2025-Budget-Book-PDF"),
("budget_2025_adopted","https://www.lakecountyco.gov/DocumentCenter/View/1690/2025-Adopted-Budget-PDF"),
("facilities","https://www.lakecountyco.gov/Facilities"),
("parks","https://www.lakecountyco.gov/382/Parks-and-Facilities"),
("maintenance","https://www.lakecountyco.gov/501/Maintenance"),
("parks_department","https://www.lakecountyco.gov/373/Parks-Recreation"),
("library","https://www.lakecountyco.gov/372/Library"),
("study_2024_announcement","https://www.lakecountyco.gov/m/newsflash/Home/Detail/72"),
("budget_2027_townhall","https://www.lakecountyco.gov/Calendar.aspx?EID=3494&calType=0&day=13&month=10&year=2026"),
("budget_2027_news","https://www.lakecountyco.gov/m/newsflash/home/detail/261"),
("assessor_maps","https://www.lakecountyco.gov/340/Assessor-Maps"),
("county_mapping","https://www.lakecountyco.gov/207/Mapping"),
("pubworks_public_intake","https://sr.pubworks.com/?custid=NECUWMDL")
]
LOCK=threading.Lock()
PRINT_LOCK=threading.Lock()
CHECKPOINT_NUMBER=0
LAST_CHECKPOINT=0.0
class CheckpointError(RuntimeError):pass
SOURCES={}
LIBRARY={}
SAVE_STARTED=False
CAPTURE_LOCK=None
CAPTURE_SEALED=False
ARCHIVE_NAME="Lake_County_FEA_Public_Source_20261012.zip"
SEAL_NAME="capture-complete.json"
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def put(p,b):
 p.parent.mkdir(parents=True,exist_ok=True);q=p.with_name(p.name+".tmp");q.write_bytes(b);q.replace(p)
def event(x):
 with LOCK:
  with (ROOT/"capture-journal.jsonl").open("a") as f:f.write(json.dumps({"at":utc(),"operation_id":OP,**x})+"\n")
def emit(x):
 with PRINT_LOCK:print(json.dumps(x,ensure_ascii=False),flush=True)
class Node:
 def __init__(self,tag="",attrs=None,parent=None):self.tag=tag;self.attrs=attrs or {};self.parent=parent;self.children=[]
 def text(self):
  return re.sub(r"\s+"," "," ".join(c if isinstance(c,str) else c.text() for c in self.children if isinstance(c,str) or c.tag not in ["script","style","noscript"])).strip()
 def all(self,tag=None):
  out=[]
  for c in self.children:
   if isinstance(c,Node):
    if tag is None or c.tag==tag:out.append(c)
    out.extend(c.all(tag))
  return out
class DOM(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n=Node(tag,dict(attrs),self.stack[-1]);self.stack[-1].children.append(n)
  if tag not in ["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]:self.stack.append(n)
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:del self.stack[i:];break
 def handle_data(self,data):self.stack[-1].children.append(data)
def parsed(data):
 p=DOM();p.feed(data.decode("utf-8",errors="replace"));return p.root
def urlok(url):
    parsed_url = urllib.parse.urlparse(url)
    host = (parsed_url.hostname or "").lower()
    hosts = {"lakecountyco.gov", "www.lakecountyco.gov", "lakecountyco.com", "www.lakecountyco.com",
             "sr.pubworks.com", "feapc.com", "myfacilityplan.feapc.com", "lccgis.maps.arcgis.com",
             "www.arcgis.com", "storymaps.arcgis.com", "lake-county-co-open-data-portal-lccgis.hub.arcgis.com"}
    service_host = bool(re.fullmatch(r"services[0-9]*\.arcgis\.com", host))
    return (parsed_url.scheme == "https" and parsed_url.username is None and parsed_url.password is None
            and parsed_url.port in (None, 443) and (host in hosts or host.endswith(".lakecountyco.gov") or service_host))

def file_digest(path):
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            count += len(chunk)
            digest.update(chunk)
    return {"bytes": count, "sha256": digest.hexdigest()}

def retained_path(relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("Invalid retained source path")
    selected = pathlib.PurePosixPath(relative)
    if selected.is_absolute() or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("Invalid retained source path: " + relative)
    current = ROOT
    for part in selected.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Retained source paths must not contain symbolic links: " + relative)
    if not current.is_file() or not stat.S_ISREG(current.stat().st_mode):
        raise ValueError("Missing retained source file: " + relative)
    return current

def verified_file(relative, expected):
    path = retained_path(relative)
    actual = file_digest(path)
    if actual != {"bytes": expected.get("bytes"), "sha256": expected.get("sha256")}:
        raise ValueError("Retained source bytes changed: " + relative)
    return path

def capture_members():
    members = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT).as_posix()
        if any(part in {"helpers", "library-state", "checkpoint-control", "text-work"} for part in path.relative_to(ROOT).parts):
            continue
        if path.name in {ARCHIVE_NAME, SEAL_NAME, ".capture.lock"} or path.name.endswith(".tmp"):
            continue
        if path.is_symlink():
            raise ValueError("Capture contains a symbolic link: " + relative)
        if path.is_file():
            retained_path(relative)
            members.append({"path": relative, **file_digest(path)})
    return members

def source_selection_digest():
    return hashlib.sha256(json.dumps(SEEDS, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

def open_retained_capture():
    global CAPTURE_LOCK, CHECKPOINT_NUMBER
    if os.environ.get("FEA_PUBLIC_SOURCE_SAVE_MODE", "standalone") not in {"standalone", "embedded"}:
        raise ValueError("FEA_PUBLIC_SOURCE_SAVE_MODE must be standalone or embedded")
    ROOT.mkdir(parents=True, exist_ok=True)
    if ROOT.is_symlink():
        raise ValueError("The source output directory must be a real directory")
    lock_path = ROOT / ".capture.lock"
    if lock_path.is_symlink():
        raise ValueError("The source lock must be a regular file")
    descriptor = os.open(str(lock_path), os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    CAPTURE_LOCK = os.fdopen(descriptor, "a+")
    try:
        fcntl.flock(CAPTURE_LOCK.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise RuntimeError("This source directory is already being captured by its current operator") from exc
    receipt_directory = ROOT / "sources"
    if receipt_directory.is_symlink():
        raise ValueError("The retained source receipt directory must be a real directory")
    for path in sorted(receipt_directory.glob("*.json")):
        relative = path.relative_to(ROOT).as_posix()
        row = json.loads(retained_path(relative).read_text(encoding="utf-8"))
        key = row.get("source_id")
        if key != path.stem or not re.fullmatch(r"[a-zA-Z0-9_.-]+", str(key)) or row.get("operation_id") != OP:
            raise ValueError("Invalid retained source receipt: " + relative)
        if not urlok(row.get("requested_url", "")):
            raise ValueError("Invalid retained source URL: " + relative)
        if row.get("status") not in {"captured", "read_failed"}:
            raise ValueError("Invalid retained source outcome: " + relative)
        if row.get("body_path"):
            verified_file(row["body_path"], row)
        elif row["status"] == "captured":
            raise ValueError("Captured source has no original body: " + relative)
        if row.get("text_path"):
            retained_path(row["text_path"])
            if row.get("text_sha256") is not None:
                verified_file(row["text_path"], {"bytes": row.get("text_bytes"), "sha256": row["text_sha256"]})
        SOURCES[key] = row
    control = ROOT / "checkpoint-control"
    for path in sorted(control.glob("*-request.json")):
        request = json.loads(path.read_text(encoding="utf-8"))
        number = request.get("number")
        if (request.get("schema") != "lake-county.source-checkpoint-request/v1"
                or request.get("operation_id") != OP or type(number) is not int or number < 1
                or path.name != str(number).zfill(4) + "-request.json"):
            raise CheckpointError("Invalid original source checkpoint request")
        answer_path = control / (str(number).zfill(4) + "-result.json")
        if not answer_path.is_file():
            raise CheckpointError("The original source checkpoint has no saved acknowledgement. Reconcile its actual current artifact first.")
        answer = json.loads(answer_path.read_text(encoding="utf-8"))
        if (answer.get("schema") != "lake-county.source-checkpoint-ack/v1"
                or answer.get("operation_id") != OP or answer.get("request_sha256") != file_digest(path)["sha256"]
                or answer.get("saved") is not True):
            raise CheckpointError("The original source checkpoint acknowledgement differs")
        CHECKPOINT_NUMBER = max(CHECKPOINT_NUMBER, number)
    for key, url in SEEDS:
        if key in SOURCES and SOURCES[key]["requested_url"] != url:
            raise ValueError("The retained source key points to a different URL: " + key)
    seal_path = ROOT / SEAL_NAME
    if not seal_path.exists():
        return False
    seal = json.loads(retained_path(SEAL_NAME).read_text(encoding="utf-8"))
    if seal.get("schema") != "tjlabs.public-source.completed-capture.v1" or seal.get("operation_id") != OP:
        raise ValueError("The completed source capture belongs to a different operation")
    if seal.get("source_selection_sha256") != source_selection_digest():
        raise ValueError("This directory retains a completed source selection; use a new edition directory for a changed selection")
    archive = seal.get("archive", {})
    if archive.get("path") != ARCHIVE_NAME:
        raise ValueError("Invalid completed source archive path")
    verified_file(ARCHIVE_NAME, archive)
    actual_members = capture_members()
    if seal.get("members") != actual_members or seal.get("sources") != len(SOURCES):
        raise ValueError("The retained completed capture has changed")
    info = {"phase": "ARCHIVE_READY", **archive, "path": str(ROOT / ARCHIVE_NAME),
            "sources": len(SOURCES), "reused_completed_capture": True}
    emit(info)
    emit({"phase": "COMPLETE", "operation_id": OP, "sources": len(SOURCES),
          "captured": sum(row["status"] == "captured" for row in SOURCES.values()),
          "reused_completed_capture": True, "archive": info,
          "save_mode": os.environ.get("FEA_PUBLIC_SOURCE_SAVE_MODE", "standalone"),
          "receiving": "The verified original archive is retained. No public request, archive replacement or new save was issued."})
    return True

def put_original(path, data):
    if path.exists() or path.is_symlink():
        relative = path.relative_to(ROOT).as_posix()
        previous = retained_path(relative)
        if file_digest(previous) != {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}:
            raise ValueError("An original source already exists with different bytes: " + relative)
        return
    put(path, data)

def source_receipt(row):
    if row.get("text_path"):
        info = file_digest(retained_path(row["text_path"]))
        row.update(text_bytes=info["bytes"], text_sha256=info["sha256"])
    SOURCES[row["source_id"]] = row
    put(ROOT / "sources" / (row["source_id"] + ".json"),
        (json.dumps(row, indent=2, ensure_ascii=False) + "\n").encode())
    return row

def extract_pdf(row):
    # The complete raw receipt is already durable in this source directory.
    # An optional derived text failure never changes that original identity.
    if row.get("status") != "captured" or row.get("source_kind") != "public_pdf":
        return row
    if row.get("text_path") or row.get("text_extraction", {}).get("state") in {"complete", "timed_out", "failed"}:
        return row
    original = verified_file(row["body_path"], row)
    work = ROOT / "text-work"
    work.mkdir(parents=True, exist_ok=True)
    target = work / (row["source_id"] + ".txt")
    error_path = work / (row["source_id"] + ".stderr.txt")
    timeout_seconds = 30
    executable = shutil.which("pdftotext")
    if executable:
        method = "pdftotext-layout"
        command = [executable, "-layout", str(original), str(target)]
    else:
        method = "pypdf-layout-subprocess"
        script = ("import pathlib,sys\nfrom pypdf import PdfReader\n"
                  "reader=PdfReader(sys.argv[1])\n"
                  "with pathlib.Path(sys.argv[2]).open('w',encoding='utf-8') as output:\n"
                  " for page in reader.pages:\n"
                  "  output.write(page.extract_text(extraction_mode='layout') or '')\n"
                  "  output.write('\\n\\f\\n')\n")
        command = [sys.executable, "-B", "-c", script, str(original), str(target)]
    row["text_extraction"] = {"state": "running", "method": method, "started_at_utc": utc(),
                              "timeout_seconds": timeout_seconds, "original_sha256": row["sha256"]}
    source_receipt(row)
    emit({"phase": "SOURCE_TEXT_START", "source_id": row["source_id"], "method": method,
          "timeout_seconds": timeout_seconds, "original_sha256": row["sha256"]})
    try:
        with error_path.open("wb") as errors:
            process = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=errors, timeout=timeout_seconds)
        row["text_extract_exit_code"] = process.returncode
        if process.returncode:
            raise RuntimeError("The optional text process exited " + str(process.returncode))
        if not target.is_file() or target.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("The optional complete text exceeds the 32 MiB source-text bound")
        text_bytes = target.read_bytes()
        text_bytes.decode("utf-8")
        destination = ROOT / "extracted" / (row["source_id"] + ".txt")
        put_original(destination, text_bytes)
        row.update(text_path=destination.relative_to(ROOT).as_posix(), pages=text_bytes.count(b"\f"))
        row["text_extraction"].update(state="complete", finished_at_utc=utc())
    except subprocess.TimeoutExpired:
        row["text_extraction"].update(state="timed_out", finished_at_utc=utc())
        row["text_extraction_error"] = "Optional text extraction exceeded the retained 30-second limit; the complete original PDF remains available."
    except Exception as error:
        row["text_extraction"].update(state="failed", finished_at_utc=utc(), error_type=type(error).__name__)
        row["text_extraction_error"] = str(error)
    if error_path.exists():
        row["text_extraction"]["stderr_tail"] = error_path.read_bytes()[-1600:].decode("utf-8", errors="replace")
    # Partial derived output stays explicitly outside the original source inventory.
    source_receipt(row)
    event({"event": "text_finished", "source_id": row["source_id"], "state": row["text_extraction"]["state"]})
    emit({"phase": "SOURCE_TEXT_FINISHED", "source_id": row["source_id"],
          "state": row["text_extraction"]["state"], "original_bytes": row["bytes"], "original_sha256": row["sha256"]})
    return row

def capture(item, defer_pdf=False):
    key, url = item
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", key):
        raise ValueError("Invalid source identifier")
    if not urlok(url):
        raise ValueError("URL outside the selected public sources")
    old = SOURCES.get(key)
    if old:
        if old["requested_url"] != url:
            raise ValueError("The retained source key points to a different URL: " + key)
        if not defer_pdf:
            extract_pdf(old)
        emit({"phase": "SOURCE_REUSED", "source_id": key, "status": old["status"], "bytes": old.get("bytes")})
        return old
    row = {"source_id": key, "requested_url": url, "acquisition_started_utc": utc(),
           "operation_id": OP, "authority": "Lake County, Colorado" if "lakecountyco" in url else "Explicitly linked public service",
           "source_date": None, "source_date_precision": "unstated"}
    event({"event": "read_start", "source_id": key, "url": url})
    emit({"phase": "SOURCE_READ_START", "source_id": key, "url": url})
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "TJLabs-Public-Source-Research/1.0",
                    "Accept": "text/html,application/pdf,application/json,*/*;q=0.5", "Accept-Encoding": "identity"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024:
                raise ValueError("The source exceeds 32 MiB; its metadata remains recorded")
            if not urlok(response.geturl()):
                raise ValueError("Redirect outside the selected public sources")
            row.update(http_status=response.status, final_url=response.geturl(), content_type=response.headers.get_content_type(),
                       headers={name: response.headers[name] for name in ["Date", "Last-Modified", "ETag", "Content-Type", "Content-Length", "Cache-Control"] if name in response.headers})
        if data.startswith(b"%PDF-"):
            extension, source_kind = ".pdf", "public_pdf"
        elif row["content_type"] == "text/html":
            extension, source_kind = ".html", "public_webpage"
        elif "json" in row["content_type"]:
            extension, source_kind = ".json", "public_json"
        elif "javascript" in row["content_type"] or urllib.parse.urlparse(url).path.endswith(".js"):
            extension, source_kind = ".js", "public_client_script"
        else:
            extension, source_kind = ".bin", "public_original"
        relative = "originals/" + key + extension
        put_original(ROOT / relative, data)
        row.update(status="captured", body_path=relative, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                   acquired_at_utc=utc(), source_kind=source_kind)
        if extension == ".pdf":
            row["text_extraction"] = {"state": "pending", "original_sha256": row["sha256"]}
        source_receipt(row)
        event({"event": "raw_saved", "source_id": key, "bytes": row["bytes"], "sha256": row["sha256"]})
        emit({"phase": "SOURCE_RAW_SAVED", "source_id": key, "http_status": row["http_status"],
              "bytes": row["bytes"], "sha256": row["sha256"], "source_kind": source_kind})
        try:
            if extension == ".pdf" and not defer_pdf:
                extract_pdf(row)
            elif extension == ".html":
                document = parsed(data)
                titles = document.all("title")
                row["title"] = titles[0].text() if titles else ""
                row["links"] = [{"text": node.text(), "url": urllib.parse.urljoin(row["final_url"], node.attrs["href"])}
                                for node in document.all("a") if node.attrs.get("href") and not node.attrs["href"].startswith(("#", "javascript:", "mailto:", "tel:"))]
                row["scripts"] = [urllib.parse.urljoin(row["final_url"], node.attrs["src"]) for node in document.all("script") if node.attrs.get("src")]
                target = ROOT / "extracted" / (key + ".txt")
                put_original(target, document.text().encode())
                row["text_path"] = target.relative_to(ROOT).as_posix()
                row["text_extraction"] = {"state": "complete", "method": "html-text", "finished_at_utc": utc()}
        except Exception as extraction_error:
            row["text_extraction_error"] = str(extraction_error)
    except Exception as error:
        if row.get("status") != "captured":
            row.update(status="read_failed", error_type=type(error).__name__, error=str(error), finished_at_utc=utc())
        else:
            row["source_processing_error"] = str(error)
        if isinstance(error, urllib.error.HTTPError):
            row.update(http_status=error.code, retry_after=error.headers.get("Retry-After"))
    source_receipt(row)
    event({"event": "read_finished", "source_id": key, "status": row["status"], "http_status": row.get("http_status"), "bytes": row.get("bytes")})
    emit({"phase": "SOURCE_READ_FINISHED", "source_id": key, "status": row["status"],
          "http_status": row.get("http_status"), "bytes": row.get("bytes")})
    return row

def batch(items, defer_pdf=False):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return list(pool.map(lambda item: capture(item, defer_pdf=defer_pdf), items))

def complete_pending_text():
    selected = [row for row in SOURCES.values() if row.get("source_kind") == "public_pdf"
                and not row.get("text_path") and row.get("text_extraction", {}).get("state") not in {"complete", "failed", "timed_out"}]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(extract_pdf, selected))

def checkpoint(stage, force=False):
    global CHECKPOINT_NUMBER, LAST_CHECKPOINT
    if os.environ.get("FEA_PUBLIC_SOURCE_CHECKPOINT_MODE") != "parent_stdio":
        return None
    if not force and time.monotonic() - LAST_CHECKPOINT < 60:
        return None
    # Called only between completed batches/layers; no source writer is active.
    value = manifest()
    CHECKPOINT_NUMBER += 1
    control = ROOT / "checkpoint-control"
    control.mkdir(parents=True, exist_ok=True)
    number = str(CHECKPOINT_NUMBER).zfill(4)
    request = {"schema": "lake-county.source-checkpoint-request/v1", "operation_id": OP,
               "number": CHECKPOINT_NUMBER, "stage": stage, "capture_complete": False,
               "source_manifest": file_digest(ROOT / "capture-manifest.json"),
               "source_count": value["source_count"], "captured": value["captured"],
               "created_at_utc": utc()}
    request_bytes = (json.dumps(request, sort_keys=True, separators=(",", ":")) + "\n").encode()
    request_sha = hashlib.sha256(request_bytes).hexdigest()
    put_original(control / (number + "-request.json"), request_bytes)
    emit({"phase": "SOURCE_CHECKPOINT_READY", "request": request, "request_sha256": request_sha})
    if not select.select([sys.stdin], [], [], 180)[0]:
        raise CheckpointError("The original source checkpoint save has no acknowledgement; retain its exact request and helper outcome.")
    line = sys.stdin.readline(131073)
    if not line or len(line) > 131072:
        raise CheckpointError("The source checkpoint returned no complete bounded acknowledgement.")
    answer = json.loads(line)
    if (answer.get("schema") != "lake-county.source-checkpoint-ack/v1" or answer.get("operation_id") != OP
            or answer.get("request_sha256") != request_sha or answer.get("saved") is not True
            or not isinstance(answer.get("library_file_id"), str) or type(answer.get("current_version_number")) is not int):
        raise CheckpointError("The original source checkpoint is not saved. Retain its exact unknown or failed helper result.")
    put_original(control / (number + "-result.json"), (json.dumps(answer, sort_keys=True) + "\n").encode())
    LAST_CHECKPOINT = time.monotonic()
    emit({"phase": "SOURCE_CHECKPOINT_ACKNOWLEDGED", "stage": stage, "source_count": value["source_count"],
          "library_file_id": answer["library_file_id"], "current_version_number": answer["current_version_number"]})
    return answer

def manifest():
 obj={"schema":"tjlabs.public-source.capture.v1","operation_id":OP,"updated_at_utc":utc(),"source_count":len(SOURCES),"captured":sum(r["status"]=="captured" for r in SOURCES.values()),"sources":list(SOURCES.values()),"scope":"Selected public primary documents and published facility observations; no complete County asset register, condition assessment, valuation, private model or procurement submission."}
 put(ROOT/"capture-manifest.json",(json.dumps(obj,indent=2,ensure_ascii=False)+"\n").encode());return obj
def save(reason, complete=False):
    global SAVE_STARTED, CAPTURE_SEALED
    manifest()
    readme = ("Lake County public-source package\n\nOperation: " + OP + "\n\n"
              "capture-manifest.json identifies the original documents, acquisition times and byte hashes. "
              "originals/ retains the complete retrieved bodies; extracted/ contains their derived text. "
              "observations/ holds the dated public asset, financial and historical accounting records. "
              "gis/ retains the complete anonymous public catalog, selected layer metadata, feature identifiers "
              "and received geometry/attributes. Each layer records its own acquisition result.\n\n" + reason + "\n")
    put(ROOT / "README.txt", readme.encode())
    archive = ROOT / ARCHIVE_NAME
    members = capture_members()
    archive_temporary = archive.with_name(archive.name + ".tmp")
    with zipfile.ZipFile(archive_temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for member in members:
            path = verified_file(member["path"], member)
            package.write(path, "Lake_County_FEA_Public_Source_20261012/" + member["path"])
    archive_temporary.replace(archive)
    archive_digest = file_digest(archive)
    archive_info = {"phase": "ARCHIVE_READY", **archive_digest,
                    "sources": len(SOURCES), "path": str(archive)}
    if complete:
        seal = {"schema": "tjlabs.public-source.completed-capture.v1", "operation_id": OP,
                "completed_at_utc": utc(), "source_selection_sha256": source_selection_digest(),
                "sources": len(SOURCES), "archive": {"path": ARCHIVE_NAME, **archive_digest}, "members": members}
        put(ROOT / SEAL_NAME, (json.dumps(seal, indent=2, ensure_ascii=False) + "\n").encode())
        CAPTURE_SEALED = True
    emit(archive_info)
    mode = os.environ.get("FEA_PUBLIC_SOURCE_SAVE_MODE", "standalone")
    if mode == "embedded":
        emit({"phase": "SOURCE_READY_FOR_APPLICATION_SAVE", "operation_id": OP, "archive": archive_info,
              "receiving": "The existing FEA application invocation includes this source package in its complete final artifact."})
        return {"archive": archive_info, "save_mode": mode}
    if mode != "standalone":
        raise ValueError("FEA_PUBLIC_SOURCE_SAVE_MODE must be standalone or embedded")
    from library_upload import LibraryUploadWorkflow, HostedAppsClient, LibraryFileMaterializer, SignedUrlUploader
    state = ROOT / "library-state"
    state.mkdir(exist_ok=True, mode=0o700)
    upload = {"local_path": str(archive), "purpose": "create_library_file", "library_artifact_type": "report"} if not LIBRARY else {
              "local_path": str(archive), "purpose": "replace_library_file", "library_file_id": LIBRARY["library_file_id"],
              "expected_current_version": LIBRARY["version"], "version_reason": reason}
    SAVE_STARTED = True
    result = LibraryUploadWorkflow(apps_client=HostedAppsClient(), materializer=LibraryFileMaterializer(),
                                   uploader=SignedUrlUploader(), state_parent=state).run({"uploads": [upload]})
    rows = result.get("results", []) if isinstance(result, dict) else []
    for row in rows:
        if row.get("status") == "succeeded" and row.get("library_file_id"):
            LIBRARY.update(library_file_id=row["library_file_id"], version=row.get("current_version_number", row.get("version_number", 0)))
    emit({"phase": "SOURCE_PACKAGE_SAVE_RESULT", "results": [
          {key: row.get(key) for key in ["status", "library_file_id", "file_id", "current_version_number", "version_number", "file_name", "error_code", "message"] if key in row}
          for row in rows], "library": LIBRARY})
    if not LIBRARY:
        raise RuntimeError("The source archive is complete locally; the Library save has not succeeded")
    return result

def public_json(key, url):
    row = capture((key, url))
    if row.get("status") != "captured":
        raise RuntimeError("Source read failed: " + key + ": " + row.get("error", "unknown"))
    try:
        value = json.loads((ROOT / row["body_path"]).read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise ValueError("Expected published JSON at " + url) from exc
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object at " + url)
    if value.get("error"):
        row["service_error"] = value["error"]
        put(ROOT / "sources" / (key + ".json"), (json.dumps(row, indent=2, ensure_ascii=False) + "\n").encode())
        raise RuntimeError("Published service returned an error: " + json.dumps(value["error"], ensure_ascii=False))
    return value, row

def public_arcgis_url(base, values):
    return base + ("&" if "?" in base else "?") + urllib.parse.urlencode({"f": "json", **values})

def public_gis_catalog():
    portal_url = "https://lccgis.maps.arcgis.com/sharing/rest"
    portal, portal_source = public_json("gis_portal_identity", public_arcgis_url(portal_url + "/portals/self", {}))
    org_id = str(portal.get("id", ""))
    if str(portal.get("urlKey", "")).lower() != "lccgis" or not re.fullmatch(r"[A-Za-z0-9]{8,64}", org_id):
        raise ValueError("The linked public GIS portal did not identify the Lake County lccgis organization")
    items = {}
    pages = []
    seen_starts = set()
    start = 1
    reported_total = None
    while start != -1:
        if start < 1 or start in seen_starts:
            raise ValueError("Public GIS catalog pagination repeated or returned an invalid nextStart")
        seen_starts.add(start)
        values = {"q": "orgid:" + org_id, "num": 100, "start": start, "sortField": "title", "sortOrder": "asc"}
        data, source = public_json("gis_catalog_page_" + str(start), public_arcgis_url(portal_url + "/search", values))
        page_items = data.get("results")
        if not isinstance(page_items, list):
            raise ValueError("Public GIS catalog omitted its results")
        reported_total = data.get("total", reported_total)
        pages.append({"source_id": source["source_id"], "start": start, "count": len(page_items), "reported_total": data.get("total")})
        for item in page_items:
            identity = str(item.get("id", ""))
            if not re.fullmatch(r"[A-Fa-f0-9]{32}", identity):
                raise ValueError("Public GIS catalog returned an invalid item identifier")
            if item.get("access") != "public":
                continue
            items[identity] = item
        next_start = data.get("nextStart")
        if not isinstance(next_start, int):
            raise ValueError("Public GIS catalog omitted its terminal pagination state")
        if not page_items and next_start != -1:
            raise ValueError("Public GIS catalog returned an empty nonterminal page")
        start = next_start
    result = {
        "schema": "tjlabs.lake-county.public-gis-catalog.v1",
        "operation_id": OP,
        "portal_url": portal_url,
        "organization_id": org_id,
        "organization_name": portal.get("name"),
        "acquired_at_utc": utc(),
        "pages": pages,
        "reported_total": reported_total,
        "public_item_count": len(items),
        "items": list(items.values()),
        "source_id": portal_source["source_id"],
    }
    put(ROOT / "gis" / "catalog.json", (json.dumps(result, indent=2, ensure_ascii=False) + "\n").encode())
    return result

def public_gis_selected(item):
    if item.get("type") not in {"Feature Service", "Map Service"}:
        return False
    terms = " ".join(str(item.get(k, "")) for k in ["title", "name", "snippet"]) + " " + " ".join(item.get("tags") or [])
    return bool(re.search(r"\b(roads?|bridges?|trails?|parks?|recreation|facilit(?:y|ies)|infrastructure|airports?|drainage|culverts?|landfill|public works|open space|capital|buildings?)\b", terms, re.I))

def public_gis_layer_service_url(item):
    value = str(item.get("url") or "").rstrip("/")
    parsed_url = urllib.parse.urlparse(value)
    if not urlok(value) or parsed_url.query or parsed_url.fragment or not re.search(r"/(?:FeatureServer|MapServer)$", parsed_url.path):
        raise ValueError("The published item does not provide a supported public feature or map service URL")
    return value

def public_gis_ids(key, layer_url):
    data, source = public_json(key, public_arcgis_url(layer_url + "/query", {"where": "1=1", "returnIdsOnly": "true"}))
    values = data.get("objectIds")
    if values is None and "objectIdFieldName" in data:
        values = []
    if not isinstance(values, list):
        raise ValueError("The published layer did not return its feature identifier set")
    normalized = []
    for identity in values:
        if isinstance(identity, bool) or not re.fullmatch(r"-?[0-9]+", str(identity)):
            raise ValueError("A public GIS feature identifier is not an integer")
        normalized.append(str(identity))
    if len(normalized) != len(set(normalized)):
        raise ValueError("The public GIS identifier response contains duplicates")
    return sorted(normalized, key=int), data.get("objectIdFieldName"), source

def public_gis_layer(item, service_url, layer_brief, source_row):
    layer_id = layer_brief.get("id")
    if isinstance(layer_id, bool) or not isinstance(layer_id, int) or layer_id < 0:
        raise ValueError("Invalid published GIS layer identifier")
    layer_url = service_url + "/" + str(layer_id)
    prefix = "gis_" + item["id"] + "_layer_" + str(layer_id)
    metadata, metadata_source = public_json(prefix + "_metadata", public_arcgis_url(layer_url, {}))
    if metadata.get("type") == "Group Layer" or not metadata.get("fields"):
        return {"item_id": item["id"], "layer_id": layer_id, "name": metadata.get("name"), "state": "metadata_only", "metadata_source_id": metadata_source["source_id"]}, []
    initial_ids, object_id_field, ids_source = public_gis_ids(prefix + "_ids_before", layer_url)
    oid = object_id_field or metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    if not oid:
        oid = next((f.get("name") for f in metadata["fields"] if f.get("type") == "esriFieldTypeOID"), None)
    if not oid or oid not in {field.get("name") for field in metadata["fields"]}:
        raise ValueError("The published layer omitted a usable object identifier field")
    published_limit = metadata.get("maxRecordCount")
    batch_size = min(200, published_limit) if isinstance(published_limit, int) and published_limit > 0 else 200
    received = {}
    feature_sources = {}
    pages = []
    returned_spatial_references = []
    pending = [initial_ids[index:index + batch_size] for index in range(0, len(initial_ids), batch_size)]
    page_index = 0
    while pending:
        identities = pending.pop(0)
        page_index += 1
        values = {"objectIds": ",".join(identities), "outFields": "*", "returnGeometry": "true", "returnZ": "true", "returnM": "true"}
        page_key = prefix + "_features_" + str(page_index)
        try:
            data, page_source = public_json(page_key, public_arcgis_url(layer_url + "/query", values))
        except Exception:
            failed = SOURCES.get(page_key, {})
            size_failure = failed.get("http_status") in (413, 414) or "exceeds 32 MiB" in failed.get("error", "")
            if size_failure and len(identities) > 1:
                middle = len(identities) // 2
                pending[0:0] = [identities[:middle], identities[middle:]]
                pages.append({"source_id": page_key, "requested_ids": identities, "state": "split_after_response_size_limit"})
                continue
            raise
        features = data.get("features")
        if data.get("spatialReference") is not None and data["spatialReference"] not in returned_spatial_references:
            returned_spatial_references.append(data["spatialReference"])
        if not isinstance(features, list):
            raise ValueError("The public GIS feature query did not return features")
        if data.get("exceededTransferLimit"):
            if len(identities) == 1:
                raise ValueError("The service cannot return one requested feature without truncation")
            middle = len(identities) // 2
            pending[0:0] = [identities[:middle], identities[middle:]]
            pages.append({"source_id": page_source["source_id"], "requested_ids": identities, "returned": len(features), "state": "split_after_service_limit"})
            continue
        requested = set(identities)
        seen_page = set()
        for feature in features:
            attributes = feature.get("attributes")
            if not isinstance(attributes, dict) or oid not in attributes:
                raise ValueError("The public GIS feature omitted its identifier attribute")
            identity = str(attributes[oid])
            if identity not in requested:
                raise ValueError("The public GIS query returned an unrequested feature")
            if identity in seen_page:
                raise ValueError("The public GIS query returned a duplicate feature")
            seen_page.add(identity)
            received[identity] = {"attributes": attributes}
            feature_sources[identity] = page_source["source_id"]
        pages.append({"source_id": page_source["source_id"], "requested_ids": identities, "returned": len(features), "missing_ids": sorted(requested - seen_page, key=int), "state": "captured"})
    final_ids, final_oid, final_source = public_gis_ids(prefix + "_ids_after", layer_url)
    ending_metadata, ending_source = public_json(prefix + "_metadata_after", public_arcgis_url(layer_url, {}))
    before_edits = metadata.get("editingInfo", {}).get("lastEditDate")
    after_edits = ending_metadata.get("editingInfo", {}).get("lastEditDate")
    same_ids = initial_ids == final_ids
    expected = set(initial_ids)
    missing = sorted(expected - set(received), key=int)
    markers_available = before_edits is not None and after_edits is not None
    stable_edits = (before_edits == after_edits) if markers_available else None
    identifier_coverage_complete = not missing and same_ids and (not final_oid or final_oid == oid)
    value_consistency = ("unchanged_published_edit_marker" if stable_edits else "changed_published_edit_marker") if markers_available else "published_edit_marker_not_reported"
    complete = identifier_coverage_complete and stable_edits is True
    ordered = [received[identity] for identity in initial_ids if identity in received]
    feature_path = "gis/layers/" + item["id"] + "_" + str(layer_id) + "/features.json"
    collection = {
        "schema": "tjlabs.lake-county.public-gis-layer.v1",
        "operation_id": OP,
        "item_id": item["id"],
        "item_title": item.get("title"),
        "layer_id": layer_id,
        "layer_name": metadata.get("name"),
        "layer_url": layer_url,
        "object_id_field": oid,
        "fields": metadata.get("fields"),
        "geometry_type": metadata.get("geometryType"),
        "requested_spatial_reference": None,
        "geometry_request": {"projection": "service_native", "returnGeometry": True, "returnZ": True, "returnM": True},
        "source_has_z": metadata.get("hasZ"),
        "source_has_m": metadata.get("hasM"),
        "returned_spatial_references": returned_spatial_references,
        "source_spatial_reference": metadata.get("extent", {}).get("spatialReference"),
        "source_item_modified_epoch_ms": item.get("modified"),
        "source_last_edit_epoch_ms_before": before_edits,
        "source_last_edit_epoch_ms_after": after_edits,
        "initial_feature_count": len(initial_ids),
        "final_feature_count": len(final_ids),
        "received_feature_count": len(ordered),
        "identifier_sets_equal": same_ids,
        "published_edit_marker_equal": stable_edits,
        "published_edit_markers_available": markers_available,
        "value_consistency": value_consistency,
        "identifier_coverage_complete": identifier_coverage_complete,
        "all_selected_features_received": not missing,
        "complete": complete,
        "missing_initial_ids": missing,
        "added_during_read": sorted(set(final_ids) - expected, key=int),
        "removed_during_read": sorted(expected - set(final_ids), key=int),
        "metadata_source_id": metadata_source["source_id"],
        "metadata_after_source_id": ending_source["source_id"],
        "initial_ids_source_id": ids_source["source_id"],
        "final_ids_source_id": final_source["source_id"],
        "pages": pages,
        "feature_storage": "Original query response bodies, referenced by source_id in pages; attributes and geometry remain in those complete separate files.",
        "acquired_at_utc": utc(),
        "interpretation": "Published County GIS features retain their original layer, identifiers, attributes and geometry. Feature rows are public observations; each record's ownership, condition and client asset identity remain separate attributes.",
    }
    put(ROOT / feature_path, (json.dumps(collection, indent=2, ensure_ascii=False) + "\n").encode())
    display = metadata.get("displayField")
    candidates = [display] if display else []
    candidates += [f["name"] for f in metadata["fields"] if re.search(r"(^|_)(name|title|facility|park|trail|road)(_|$)", f["name"], re.I)]
    observations = []
    for feature in ordered:
        attributes = feature["attributes"]
        identity = str(attributes[oid])
        title = next((str(attributes[key]) for key in candidates if attributes.get(key) not in (None, "")), None)
        source = SOURCES[feature_sources[identity]]
        observations.append({
            "observation_id": "lc-gis-" + item["id"] + "-" + str(layer_id) + "-" + identity,
            "source_id": source["source_id"],
            "source_asset_id": identity,
            "source_asset_id_namespace": "ArcGIS item " + item["id"] + ", layer " + str(layer_id) + ", field " + oid,
            "asset_name": title or str(metadata.get("name", "Published feature")) + " " + identity,
            "asset_class": "public_gis_feature",
            "record_unit": "gis_feature",
            "ownership_relation": "unknown",
            "responsible_entity": None,
            "as_of": None,
            "source_date_precision": "unstated",
            "source_relationship": layer_url,
            "source_note": "Feature from " + str(item.get("title", "")) + " / " + str(metadata.get("name", "")) + ". Original attributes and geometry: " + feature_path + ".",
            "feature_collection_path": feature_path,
            "feature_identifier_field": oid,
            "observation_basis": "Feature published through the County's official public GIS portal",
            "source_url": source["final_url"],
            "source_path": source["body_path"],
            "source_sha256": source["sha256"],
            "source_acquired_at_utc": source["acquired_at_utc"],
        })
    summary = {key: value for key, value in collection.items() if key not in {"features", "fields", "pages", "interpretation"}}
    state = "captured" if complete else ("captured_with_unverified_value_consistency" if identifier_coverage_complete and not markers_available else "captured_with_source_changes")
    summary.update(state=state, feature_collection_path=feature_path, observation_count=len(observations))
    return summary, observations

def collect_public_gis():
    outcome = {"schema": "tjlabs.lake-county.public-gis-acquisition.v1", "operation_id": OP, "started_at_utc": utc(), "layers": [], "selected_items": [], "observations": 0}
    observations = []
    try:
        catalog = public_gis_catalog()
        outcome.update(organization_id=catalog["organization_id"], public_catalog_items=catalog["public_item_count"])
        selected = [item for item in catalog["items"] if public_gis_selected(item)]
        outcome["selected_items"] = [{"id": item["id"], "title": item.get("title"), "type": item.get("type"), "url": item.get("url")} for item in selected]
        checkpoint("public_catalog_before_selected_features", force=True)
        for item in selected:
            try:
                service_url = public_gis_layer_service_url(item)
                service, source = public_json("gis_" + item["id"] + "_service", public_arcgis_url(service_url, {}))
                layer_briefs = service.get("layers", []) + service.get("tables", [])
                for brief in layer_briefs:
                    try:
                        summary, rows = public_gis_layer(item, service_url, brief, source)
                        outcome["layers"].append(summary)
                        observations.extend(rows)
                    except Exception as exc:
                        outcome["layers"].append({"item_id": item["id"], "layer_id": brief.get("id"), "name": brief.get("name"), "state": "read_failed", "error": str(exc), "error_type": type(exc).__name__})
            except Exception as exc:
                outcome["layers"].append({"item_id": item["id"], "state": "service_read_failed", "error": str(exc), "error_type": type(exc).__name__})
            put(ROOT / "gis" / "acquisition.json", (json.dumps({**outcome, "observations": len(observations), "updated_at_utc": utc()}, indent=2, ensure_ascii=False) + "\n").encode())
            checkpoint("completed_gis_item_" + item["id"])
        outcome["state"] = "completed"
    except CheckpointError:
        raise
    except Exception as exc:
        outcome.update(state="catalog_read_failed", error=str(exc), error_type=type(exc).__name__)
    outcome.update(observations=len(observations), finished_at_utc=utc(), complete=outcome.get("state") == "completed" and all(row.get("state") in {"captured", "metadata_only"} for row in outcome["layers"]))
    put(ROOT / "gis" / "acquisition.json", (json.dumps(outcome, indent=2, ensure_ascii=False) + "\n").encode())
    emit({"phase": "PUBLIC_GIS_ACQUIRED", "state": outcome["state"], "catalog_items": outcome.get("public_catalog_items"), "selected_items": len(outcome["selected_items"]), "layers": len(outcome["layers"]), "observations": len(observations), "complete": outcome["complete"]})
    return observations

SEEDS.extend([
 ("agenda_20261006","https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_10062026-889"),
 ("agenda_capital_20260922","https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_09222026-885"),
 ("study_2023_rfp","https://www.lakecountyco.gov/DocumentCenter/View/962")
])
SEEDS.extend(json.loads("[[\"harrison_park_master_rfp\",\"https://www.lakecountyco.gov/DocumentCenter/View/1561/Harrison-Park-Master-Plan-RFP?bidId=\"],[\"harrison_park_faq\",\"https://www.lakecountyco.gov/m/newsflash/Archive/Item/133?arcId=224\"],[\"harrison_park_nepa_rfp\",\"https://www.lakecountyco.gov/DocumentCenter/View/1471\"],[\"audit_2024\",\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\"],[\"public_open_data_portal\",\"https://lake-county-co-open-data-portal-lccgis.hub.arcgis.com/\"],[\"harrison_park_storymap\",\"https://storymaps.arcgis.com/stories/8f3563e398554dec82dc6ab2dfcaed4a\"],[\"harrison_park_storymap_data\",\"https://www.arcgis.com/sharing/rest/content/items/8f3563e398554dec82dc6ab2dfcaed4a/data?f=json\"]]"))
PREPARED_OBSERVATIONS=json.loads("[{\"observation_id\":\"lc-public-parks-mineral_belt_trail\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Mineral Belt Trail\",\"asset_class\":\"linear_trail\",\"record_unit\":\"trail_network\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Mineral Belt Trail\",\"as_of\":null,\"address\":null,\"source_note\":\"12-mile paved pathway; completed in 2000.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-community_park\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Community Park & Fairgrounds\",\"asset_class\":\"park\",\"record_unit\":\"site\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Community Park & Fairgrounds\",\"as_of\":null,\"address\":\"W 6th and McWethy Drive\",\"source_note\":\"W 6th Street and McWethy Drive; rodeo arena, playground, indoor restrooms and synthetic turf field.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-sixth_street_gym\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Sixth Street Gym\",\"asset_class\":\"recreation_building\",\"record_unit\":\"building\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Sixth Street Gym\",\"as_of\":null,\"address\":\"124 E Sixth Street\",\"source_note\":\"Built in the 1920s. Repairs in 2006–2008 are historical work; the source does not provide a current assessed condition or remaining service life.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-ballfields_collection\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Softball / Baseball Fields\",\"asset_class\":\"recreation_fields\",\"record_unit\":\"collection\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Softball / Baseball Fields\",\"as_of\":null,\"address\":null,\"source_note\":\"The County maintains multiple fields. The source identifies Leiter Field at the end of W 5th Street; this collection is not a single asset.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-huck_finn_ice\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Huck Finn Ice Rink\",\"asset_class\":\"recreation_facility\",\"record_unit\":\"facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Huck Finn Ice Rink\",\"as_of\":null,\"address\":\"445 Maple Street\",\"source_note\":\"Published area is 30,000 square feet, with a warming hut, rentals and snack bar. The description does not establish surveyed building area.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-dutch_henry\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Dutch Henry Sledding Hill\",\"asset_class\":\"recreation_site\",\"record_unit\":\"site\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Dutch Henry Sledding Hill\",\"as_of\":null,\"address\":\"999 S Highway 24\",\"source_note\":\"The source heading and body use both Henry and Henri; preserve the naming difference.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-hayden_meadows\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Hayden Meadows\",\"asset_class\":\"reservoir_and_paths\",\"record_unit\":\"site\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Hayden Meadows\",\"as_of\":null,\"address\":null,\"source_note\":\"Small reservoir and path network built in 2001; directions place it eight miles south of Leadville on US 24.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-parks_collection\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Community Parks\",\"asset_class\":\"parks\",\"record_unit\":\"collection\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Community Parks\",\"as_of\":null,\"address\":null,\"source_note\":\"The Public Works maintenance list names Kiddie Korral, Ice Palace Park, Huck Finn Park, Kendrick Park, Community Park and String town Park.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-leadville_junction\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Leadville Junction\",\"asset_class\":\"parking_area\",\"record_unit\":\"site\",\"ownership_relation\":\"unknown\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Leadville Junction\",\"as_of\":null,\"address\":\"Junction of County Roads 9 and 9A\",\"source_note\":\"Parking area at County Roads 9 and 9A; the section does not state the owner.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-school_activity_center\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Intermediate School Activity Center\",\"asset_class\":\"recreation_in_school\",\"record_unit\":\"room_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County School District (owner); Lake County (recreation operator)\",\"source_relationship\":\"Parks and Facilities / Intermediate School Activity Center\",\"as_of\":null,\"address\":\"1000 W 6th Street\",\"source_note\":\"The Lake County School District explicitly owns the Middle School gymnasium; the County runs recreation there. This statement does not establish maintenance responsibility.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-huck_finn_skate\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Huck Finn Skatepark\",\"asset_class\":\"skatepark\",\"record_unit\":\"site\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Huck Finn Skatepark\",\"as_of\":null,\"address\":\"505 W 5th Avenue\",\"source_note\":\"Opened in July 2014. The source gives 5th Avenue; the nearby dog park description gives 5th Street. Preserve the addresses separately.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-dog_park\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Leadville / Lake County Dog Park\",\"asset_class\":\"dog_park\",\"record_unit\":\"site\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Leadville / Lake County Dog Park\",\"as_of\":null,\"address\":\"505 W 5th Street\",\"source_note\":\"The source states that the park began through local volunteer effort. It does not state title or acquisition authority.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-parks-shooting_archery\",\"source_id\":\"parks\",\"source_asset_id\":null,\"asset_name\":\"Public Shooting & Archery Range\",\"asset_class\":\"recreation_range\",\"record_unit\":\"site\",\"ownership_relation\":\"unknown\",\"responsible_entity\":\"Lake County, relationship as described\",\"source_relationship\":\"Parks and Facilities / Public Shooting & Archery Range\",\"as_of\":null,\"address\":null,\"source_note\":\"Published 100- and 200-yard and 10-, 25- and 50-yard ranges, 12 archery targets and a vault toilet. The section does not state an address or property owner.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published public facility description; not authoritative asset register or field assessment\",\"source_url\":\"https://www.lakecountyco.gov/382/Parks-and-Facilities\"},{\"observation_id\":\"lc-public-maintenance-1\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Courthouse\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-2\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Annex\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-3\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Senior Center\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-4\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Sixth Street Gym\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-5\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Public Library\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-6\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Huck Finn Ice Rink\",\"asset_class\":\"building_or_facility\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-7\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Ball Fields\",\"asset_class\":\"recreation_collection\",\"record_unit\":\"collection\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-8\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Parks\",\"asset_class\":\"recreation_collection\",\"record_unit\":\"collection\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-maintenance-9\",\"source_id\":\"maintenance\",\"source_asset_id\":null,\"asset_name\":\"Airport\",\"asset_class\":\"airport\",\"record_unit\":\"facility\",\"ownership_relation\":\"managed\",\"responsible_entity\":\"Lake County Maintenance Department\",\"parent_source_relationship\":\"Maintenance / County-maintained property list\",\"as_of\":null,\"source_note\":\"County maintenance responsibility is stated. Individual asset identity and legal ownership are not supplied. May refer to another public observation in this bundle; no automatic entity merge.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department maintenance scope\",\"source_url\":\"https://www.lakecountyco.gov/501/Maintenance\"},{\"observation_id\":\"lc-public-library-address\",\"source_id\":\"library\",\"source_asset_id\":null,\"asset_name\":\"Lake County Public Library\",\"asset_class\":\"library\",\"record_unit\":\"building_or_facility\",\"ownership_relation\":\"unknown\",\"responsible_entity\":\"Lake County Public Library\",\"address\":\"1115 Harrison Avenue, Leadville, CO 80461\",\"as_of\":null,\"source_note\":\"Published library physical address. Legal ownership and assessed condition not stated.\",\"source_date_precision\":\"unstated\",\"observation_basis\":\"Published department physical address\",\"source_url\":\"https://www.lakecountyco.gov/372/Library\"},{\"observation_id\":\"lc-public-health-lease-20260818\",\"source_id\":\"agenda_20261006\",\"source_asset_id\":null,\"asset_name\":\"Health and Human Services Building\",\"asset_class\":\"leased_office\",\"record_unit\":\"building\",\"ownership_relation\":\"leased\",\"responsible_entity\":\"Lake County Government (lessee); Dr. Lisa Zwerdlinger (building owner as stated)\",\"address\":\"735 US Hwy 24, Leadville, CO 80461\",\"as_of\":\"2026-08-18\",\"source_date_precision\":\"day\",\"source_relationship\":\"Oct6,2026 agenda PDF page7; Public Health memo datedAug18,2026\",\"lease_end_date\":\"2027-08-31\",\"source_note\":\"The County moved in during September 2023; rent was waived until January 2024. The memo requests lease renewal on mutually agreed terms and does not establish an executed renewal or new rent.\",\"observation_basis\":\"Published lease-renewal decision memo\",\"source_url\":\"https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_10062026-889\"},{\"observation_id\":\"lc-public-harrison-site-20241202\",\"source_id\":\"harrison_park_faq\",\"source_asset_id\":null,\"asset_name\":\"Harrison Park / Harrison Ballfield Property / Neusitz Placer\",\"asset_class\":\"land_site\",\"record_unit\":\"parcel_as_described\",\"ownership_relation\":\"owned\",\"responsible_entity\":\"Lake County, as stated in the County's December 2024 property FAQ\",\"as_of\":\"2024-12-02\",\"source_date_precision\":\"day\",\"address\":\"Adjacent to Harrison Avenue, Leadville, Colorado\",\"area_acres\":12,\"acquisition_date\":\"1964-02-05\",\"source_note\":\"The County describes a 12-acre parcel known as the Neusitz Placer, purchased on February 5, 1964. The FAQ says it adjoins West Park but is outside that subdivision. These dated statements provide the property's published identity and history.\",\"source_locator\":\"Questions 1–2\",\"source_relationship\":\"County property FAQ\",\"observation_basis\":\"Dated public property description by Lake County\",\"source_url\":\"https://www.lakecountyco.gov/m/newsflash/Archive/Item/133?arcId=224\"},{\"observation_id\":\"lc-public-harrison-school-strip-20240816\",\"source_id\":\"harrison_park_nepa_rfp\",\"source_asset_id\":null,\"asset_name\":\"School District land strip near Harrison Park\",\"asset_class\":\"land_site\",\"record_unit\":\"parcel_strip_as_described\",\"ownership_relation\":\"unknown\",\"responsible_entity\":\"Lake County School District, stated owner\",\"as_of\":\"2024-08-16\",\"source_date_precision\":\"day\",\"area_acres\":2,\"source_note\":\"The County's August 2024 project description identifies a two-acre School District strip outside the Harrison Park project site. Possible inclusion in planning depended on later stakeholder discussions.\",\"source_locator\":\"PDF page 1, Project Location\",\"source_relationship\":\"Neighboring School District land\",\"observation_basis\":\"Dated public project-site description\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/1471\"},{\"observation_id\":\"lc-public-harrison-field-20240816\",\"source_id\":\"harrison_park_nepa_rfp\",\"source_asset_id\":null,\"asset_name\":\"Existing Harrison Park baseball field\",\"asset_class\":\"recreation_field\",\"record_unit\":\"field\",\"ownership_relation\":\"unknown\",\"responsible_entity\":null,\"as_of\":\"2024-08-16\",\"source_date_precision\":\"day\",\"parent_observation_id\":\"lc-public-harrison-site-20241202\",\"source_note\":\"The August 2024 RFP describes an existing field west of Harrison Avenue and north of the elementary school. At that time, the playing surface had deteriorated and the field was not programmed for recreational sports. Six acres of undeveloped space lay to the west.\",\"source_locator\":\"PDF page 1, Project Location\",\"source_relationship\":\"Field described within the Harrison Park planning site\",\"observation_basis\":\"Dated public description of the field's use and condition\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/1471\"}]")
PREPARED_FINANCE=json.loads("[{\"observation_id\":\"lc-funding-dola-20260609\",\"source_id\":\"funding_memo\",\"source_locator\":\"PDF page 6\",\"record_kind\":\"anticipated_grant\",\"amount\":160000,\"currency\":\"USD\",\"amount_precision\":\"stated\",\"status\":\"anticipated\",\"as_of\":\"2026-06-09\",\"scope\":\"Capital Asset Management Plan project\",\"source_note\":\"The memo anticipates a DOLA award. Record the anticipated funding separately from executed awards and available cash.\",\"source_url\":\"https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_06092026-838\"},{\"observation_id\":\"lc-funding-county-20260609\",\"source_id\":\"funding_memo\",\"source_locator\":\"PDF page 6\",\"record_kind\":\"requested_county_funding\",\"amount\":234109,\"currency\":\"USD\",\"amount_precision\":\"stated\",\"status\":\"requested\",\"as_of\":\"2026-06-09\",\"scope\":\"County General Fund reserves for capital-plan project\",\"source_note\":\"Requested County funding; the memo does not establish approval or an executed appropriation.\",\"source_url\":\"https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_06092026-838\"},{\"observation_id\":\"lc-project-total-20260609\",\"source_id\":\"funding_memo\",\"source_locator\":\"PDF page 6\",\"record_kind\":\"proposed_project_total\",\"amount\":394109,\"currency\":\"USD\",\"amount_precision\":\"stated\",\"status\":\"proposed\",\"as_of\":\"2026-06-09\",\"scope\":\"Capital Asset Management Plan project total\",\"source_note\":\"This project total includes the two funding components. Keep the total separate to avoid counting both the total and its components as additional funds.\",\"source_url\":\"https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_06092026-838\"},{\"observation_id\":\"lc-health-rent-20260818\",\"source_id\":\"agenda_20261006\",\"source_locator\":\"PDF page 7; memo dated August 18, 2026\",\"record_kind\":\"published_current_rent_context\",\"amount\":110000,\"currency\":\"USD\",\"amount_precision\":\"approximate\",\"status\":\"reported_current_budget_rate\",\"as_of\":\"2026-08\",\"as_of_precision\":\"month\",\"scope\":\"Per department per year for DHS and Public Health at 735 US Highway 24\",\"unit\":\"USD/department/year\",\"source_note\":\"Approximate rent per department per year. This figure describes neither a whole-building valuation nor a proposed renewal rate. The source states that a higher rent would require a budget adjustment.\",\"source_url\":\"https://www.lakecountyco.gov/AgendaCenter/ViewFile/Agenda/_10062026-889\"},{\"observation_id\":\"lc-harrison-cpf-20241202\",\"source_id\":\"harrison_park_faq\",\"source_url\":\"https://www.lakecountyco.gov/m/newsflash/Archive/Item/133?arcId=224\",\"source_locator\":\"Question 7\",\"record_kind\":\"reported_historical_grant_award\",\"amount\":850000,\"currency\":\"USD\",\"amount_precision\":\"stated\",\"status\":\"reported_awarded_in_2024\",\"as_of\":\"2024-12-02\",\"recipient\":\"Leadville Lake County Regional Housing Authority\",\"scope\":\"Harrison Park housing and community planning project\",\"source_note\":\"The County's December 2024 FAQ reports an USD 850,000 Community Project Funding grant to the Regional Housing Authority, with environmental review required. This is a separate project and recipient from the 2026 capital-plan funding request.\"}]")
SOURCE_METADATA=json.loads("{\"rfp_listing\":{\"authority\":\"Lake County, Colorado\"},\"rfp\":{\"source_date\":\"2026-09-30\",\"source_date_precision\":\"day\",\"source_kind\":\"current_solicitation\",\"authority\":\"Lake County, Colorado\"},\"funding_memo\":{\"source_date\":\"2026-06-09\",\"source_date_precision\":\"day\",\"source_kind\":\"public_funding_request_memo\",\"authority\":\"Lake County, Colorado\"},\"annual_budget\":{\"authority\":\"Lake County, Colorado\"},\"budget_2026_book\":{\"source_date\":\"2025-12-11\",\"source_date_precision\":\"day\",\"source_kind\":\"budget_book_with_mixed_adopted_and_preliminary_labels\",\"authority\":\"Lake County, Colorado\"},\"budget_2025_book\":{\"source_date\":\"2025\",\"source_date_precision\":\"year\",\"source_kind\":\"historical_budget_book\",\"authority\":\"Lake County, Colorado\"},\"budget_2025_adopted\":{\"source_date\":\"2025\",\"source_date_precision\":\"year\",\"source_kind\":\"historical_adopted_line_item_budget\",\"authority\":\"Lake County, Colorado\"},\"facilities\":{\"authority\":\"Lake County, Colorado\"},\"parks\":{\"authority\":\"Lake County, Colorado\"},\"maintenance\":{\"authority\":\"Lake County, Colorado\"},\"parks_department\":{\"authority\":\"Lake County, Colorado\"},\"library\":{\"authority\":\"Lake County, Colorado\"},\"study_2024_announcement\":{\"source_date\":\"2024-05-20\",\"source_date_precision\":\"day\",\"source_kind\":\"prior_study_announcement\",\"authority\":\"Lake County, Colorado\"},\"budget_2027_townhall\":{\"source_date\":\"2026-10-13\",\"source_date_precision\":\"day\",\"source_kind\":\"scheduled_budget_townhall\",\"authority\":\"Lake County, Colorado\"},\"budget_2027_news\":{\"source_date\":\"2026-10-12\",\"source_date_precision\":\"day\",\"source_kind\":\"preliminary_budget_townhall_announcement\",\"authority\":\"Lake County, Colorado\"},\"assessor_maps\":{\"authority\":\"Lake County, Colorado\"},\"county_mapping\":{\"authority\":\"Lake County, Colorado\"},\"pubworks_public_intake\":{\"authority\":\"Published PubWorks service, linked by Lake County Maintenance\"},\"agenda_20261006\":{\"source_date\":\"2026-10-06\",\"source_date_precision\":\"day\",\"source_kind\":\"current_public_agenda_with_earlier_lease_memo\",\"authority\":\"Lake County, Colorado\"},\"agenda_capital_20260922\":{\"source_date\":\"2026-09-22\",\"source_date_precision\":\"day\",\"source_kind\":\"capital_requests_and_preliminary_budget_agenda\",\"authority\":\"Lake County, Colorado\"},\"study_2023_rfp\":{\"source_date\":\"2023\",\"source_date_precision\":\"year\",\"source_kind\":\"historical_feasibility_study_solicitation\",\"authority\":\"Lake County, Colorado\"},\"harrison_park_master_rfp\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_date\":\"2024\",\"source_date_precision\":\"year\",\"source_kind\":\"historical_master_plan_solicitation_and_attached_site_studies\"},\"harrison_park_faq\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_date\":\"2024-12-02\",\"source_date_precision\":\"day\",\"source_kind\":\"historical_public_property_and_planning_faq\"},\"harrison_park_nepa_rfp\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_date\":\"2024-08-16\",\"source_date_precision\":\"day\",\"source_kind\":\"historical_harrison_park_environmental_review_solicitation\"},\"audit_2024\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_date\":\"2024-12-31\",\"source_date_precision\":\"day\",\"source_kind\":\"published_2024_financial_statements_and_audit\"},\"public_open_data_portal\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_kind\":\"official_public_gis_download_portal\"},\"harrison_park_storymap\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_kind\":\"officially_linked_public_master_plan_storymap\"},\"harrison_park_storymap_data\":{\"authority\":\"Lake County, Colorado, or the County's explicitly linked public GIS service\",\"source_kind\":\"public_master_plan_storymap_data\"}}")
CAPITAL_ROLLFORWARD=json.loads("[{\"record_id\":\"lc-capital-2024-land\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Land\",\"measure_basis\":\"not_depreciated\",\"opening\":5723377,\"additions\":0,\"deletions\":0,\"closing\":5723377,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-land_improvements\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Land improvements\",\"measure_basis\":\"not_depreciated\",\"opening\":3288072,\"additions\":0,\"deletions\":0,\"closing\":3288072,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-construction_in_progress\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Construction in progress\",\"measure_basis\":\"not_depreciated\",\"opening\":1325176,\"additions\":382799,\"deletions\":0,\"closing\":1707975,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-not_depreciated_total\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Capital assets not depreciated, total\",\"measure_basis\":\"not_depreciated\",\"opening\":10336625,\"additions\":382799,\"deletions\":0,\"closing\":10719424,\"is_total\":true,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-buildings_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Buildings\",\"measure_basis\":\"gross\",\"opening\":12322668,\"additions\":0,\"deletions\":0,\"closing\":12322668,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-improvements_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Improvements\",\"measure_basis\":\"gross\",\"opening\":11131670,\"additions\":0,\"deletions\":0,\"closing\":11131670,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-infrastructure_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Infrastructure\",\"measure_basis\":\"gross\",\"opening\":3804410,\"additions\":0,\"deletions\":0,\"closing\":3804410,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-machinery_equipment_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Machinery and equipment\",\"measure_basis\":\"gross\",\"opening\":10540481,\"additions\":1237521,\"deletions\":-13497,\"closing\":11764505,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-vehicles_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Vehicles\",\"measure_basis\":\"gross\",\"opening\":3742213,\"additions\":914485,\"deletions\":-1595405,\"closing\":3061293,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-lease_assets_gross\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Right-to-use lease assets\",\"measure_basis\":\"gross\",\"opening\":3275685,\"additions\":154836,\"deletions\":0,\"closing\":3430521,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-depreciated_gross_total\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Capital assets depreciated or amortized, gross total\",\"measure_basis\":\"gross\",\"opening\":44817127,\"additions\":2306842,\"deletions\":-1608902,\"closing\":45515067,\"is_total\":true,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-buildings_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Buildings\",\"measure_basis\":\"accumulated_depreciation\",\"opening\":-4583581,\"additions\":-305108,\"deletions\":0,\"closing\":-4888689,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-improvements_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Improvements\",\"measure_basis\":\"accumulated_depreciation\",\"opening\":-2792781,\"additions\":-302579,\"deletions\":0,\"closing\":-3095360,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-infrastructure_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Infrastructure\",\"measure_basis\":\"accumulated_depreciation\",\"opening\":-1091224,\"additions\":-123740,\"deletions\":0,\"closing\":-1214964,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-machinery_equipment_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Machinery and equipment\",\"measure_basis\":\"accumulated_depreciation\",\"opening\":-6977105,\"additions\":-438347,\"deletions\":11117,\"closing\":-7404335,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-vehicles_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Vehicles\",\"measure_basis\":\"accumulated_depreciation\",\"opening\":-2227065,\"additions\":-801885,\"deletions\":681502,\"closing\":-2347448,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-lease_assets_accumulated\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Right-to-use lease assets\",\"measure_basis\":\"accumulated_amortization\",\"opening\":-457251,\"additions\":-445328,\"deletions\":0,\"closing\":-902579,\"is_total\":false,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-accumulated_total\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Accumulated depreciation and amortization, total\",\"measure_basis\":\"accumulated\",\"opening\":-18129007,\"additions\":-2416987,\"deletions\":692619,\"closing\":-19853375,\"is_total\":true,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-depreciated_net_total\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Capital assets depreciated or amortized, net total\",\"measure_basis\":\"net\",\"opening\":26688120,\"additions\":-110145,\"deletions\":-916283,\"closing\":25661692,\"is_total\":true,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"},{\"record_id\":\"lc-capital-2024-governmental_capital_net_total\",\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 36; financial statement Note 5, printed page 24\",\"entity\":\"Lake County primary government\",\"activity\":\"governmental\",\"fiscal_year\":2024,\"opening_date\":\"2023-12-31\",\"closing_date\":\"2024-12-31\",\"currency\":\"USD\",\"asset_class\":\"Governmental activities capital assets, net total\",\"measure_basis\":\"net\",\"opening\":37024745,\"additions\":272654,\"deletions\":-916283,\"closing\":36381116,\"is_total\":true,\"value_basis\":\"Historical accounting balances and movements\",\"sign_convention\":\"Parenthesized amounts are negative. Opening plus additions plus deletions equals closing.\",\"source_note\":\"Preserve category, measure and entity when reconciling; subtotal and total rows summarize their components.\"}]")
ACCOUNTING_POLICY=json.loads("{\"source_id\":\"audit_2024\",\"source_url\":\"https://www.lakecountyco.gov/DocumentCenter/View/2631/2024-Financial--Audit-Report-PDF\",\"source_locator\":\"PDF page 31; Note 1, printed page 19\",\"as_of\":\"2024-12-31\",\"capitalization_minimum_initial_cost_usd\":5000,\"estimated_useful_life_more_than_years\":1,\"accounting_measure\":\"historical cost or estimated historical cost; donated assets at acquisition value on donation date\",\"depreciation_method\":\"straight line\",\"published_useful_life_year_ranges\":{\"buildings\":[3,40],\"infrastructure\":[3,40],\"improvements\":[5,10],\"equipment\":[3,5]},\"ordinary_maintenance\":\"Normal maintenance and repairs that neither add value nor materially extend asset life are expensed.\",\"interpretation\":\"The published accounting policy and class-wide depreciation ranges are retained as historical policy context; asset-specific remaining service life is a separate assessment.\"}")
if open_retained_capture():
    sys.exit(0)
try:
 batch(SEEDS, defer_pdf=True)
 listing=SOURCES.get("facilities",{})
 discovered=[]
 for n,url in enumerate(listing.get("scripts",[])):
  if "/Facilities/" in url and any(t in url for t in ["SearchSidebar","ListingResult"]):discovered.append(("facility_script_"+str(n),url))
 for n,a in enumerate(listing.get("links",[])):
  if "/Facilities/Facility/Details/" in a["url"]:discovered.append(("facility_detail_"+str(n),a["url"]))
 for n,a in enumerate(SOURCES.get("annual_budget",{}).get("links",[])):
  if a["text"] in ["2026 Preliminary Budget All Funds (PDF)","2025 Budget Adoption Presentation (PDF)"]:discovered.append(("budget_related_"+str(n),a["url"]))
 batch(discovered, defer_pdf=True)
 for key,metadata in SOURCE_METADATA.items():
  if key in SOURCES:SOURCES[key].update(metadata);put(ROOT/"sources"/(key+".json"),(json.dumps(SOURCES[key],indent=2,ensure_ascii=False)+"\n").encode())
 checkpoint("public_originals_before_text", force=True)
 complete_pending_text()
 checkpoint("complete_original_receipts_before_gis", force=True)
 observations=list(PREPARED_OBSERVATIONS)+collect_public_gis()
 if listing.get("status")=="captured":
  d=parsed((ROOT/listing["body_path"]).read_bytes())
  for n in d.all():
   if "data-facilityid" in n.attrs:
    ids=n.attrs["data-facilityid"];heads=n.all("h3")+n.all("h2");links=[a for a in n.all("a") if "/Facilities/Facility/Details/" in a.attrs.get("href","")]
    name=heads[0].text() if heads else links[0].text() if links else "Published facility "+ids
    observations.append({"observation_id":"lc-directory-facility-"+ids,"source_id":"facilities","source_asset_id":ids,"source_asset_id_namespace":"Lake County CivicEngage facility directory; not County asset-register ID","asset_name":name,"asset_class":"public_directory_entry","record_unit":"directory_entry","ownership_relation":"unknown","responsible_entity":None,"as_of":None,"source_date_precision":"unstated","source_note":n.text(),"source_relationship":urllib.parse.urljoin(listing["final_url"],links[0].attrs["href"]) if links else "Facility directory first page","observation_basis":"Original public directory entry; room,building,park or drop site must be classified explicitly."})
 for o in observations+PREPARED_FINANCE:
  s=SOURCES.get(o["source_id"],{});o.update(source_url=s.get("final_url",s.get("requested_url")),source_path=s.get("body_path"),source_bytes=s.get("bytes"),source_sha256=s.get("sha256"),source_acquired_at_utc=s.get("acquired_at_utc"))
 put(ROOT/"observations"/"asset_observations.json",(json.dumps(observations,indent=2,ensure_ascii=False)+"\n").encode())
 put(ROOT/"observations"/"financial_observations.json",(json.dumps(PREPARED_FINANCE,indent=2,ensure_ascii=False)+"\n").encode())
 for name,rows in [("asset_observations",observations),("financial_observations",PREPARED_FINANCE)]:
  fields=list(dict.fromkeys(k for r in rows for k in r));buf=io.StringIO(newline="");w=csv.DictWriter(buf,fieldnames=fields);w.writeheader();w.writerows(rows);put(ROOT/"observations"/(name+".csv"),buf.getvalue().encode("utf-8"))
 # Full layout-preserving historical account rows. Financial column mapping is not inferred from text order.
 budget=SOURCES.get("budget_2025_adopted",{})
 accounts=[]
 if budget.get("text_path"):
  for pn,page in enumerate((ROOT/budget["text_path"]).read_text(errors="replace").split("\f"),1):
   for ln,line in enumerate(page.splitlines(),1):
    m=re.match(r"^\s*(\d{4}\.\d{3}\.\d{2}\.\d{5})\s+(.+)$",line)
    if m:accounts.append({"source_id":"budget_2025_adopted","account_code":m.group(1),"original_line":line,"page_1_based":pn,"line_on_extracted_page":ln,"fiscal_year":2025,"budget_status":"2025 adopted budget","column_mapping_status":"original published order retained; review page headings before financial-model mapping","source_url":budget["final_url"],"source_sha256":budget["sha256"]})
 put(ROOT/"observations"/"budget_2025_original_account_rows.json",(json.dumps(accounts,indent=2,ensure_ascii=False)+"\n").encode())
 for row in CAPITAL_ROLLFORWARD:
  if row["opening"]+row["additions"]+row["deletions"] != row["closing"]:raise ValueError("Historical capital rollforward does not reconcile: "+row["record_id"])
  audit=SOURCES.get("audit_2024",{})
  row.update(source_sha256=audit.get("sha256"),source_path=audit.get("body_path"),source_acquired_at_utc=audit.get("acquired_at_utc"))
 put(ROOT/"observations"/"capital_rollforward_2024.json",(json.dumps(CAPITAL_ROLLFORWARD,indent=2,ensure_ascii=False)+"\n").encode())
 buf=io.StringIO(newline="");writer=csv.DictWriter(buf,fieldnames=list(CAPITAL_ROLLFORWARD[0]));writer.writeheader();writer.writerows(CAPITAL_ROLLFORWARD)
 put(ROOT/"observations"/"capital_rollforward_2024.csv",buf.getvalue().encode("utf-8"))
 put(ROOT/"observations"/"accounting_policy_2024.json",(json.dumps(ACCOUNTING_POLICY,indent=2,ensure_ascii=False)+"\n").encode())
 manifest()
 save("Public primary documents, dated facility and financial observations, 2024 audited capital rollforward and the official public GIS catalog with full selected feature collections.", complete=True)
 emit({"phase":"COMPLETE","operation_id":OP,"sources":len(SOURCES),"captured":sum(r["status"]=="captured" for r in SOURCES.values()),"asset_observations":len(observations),"financial_observations":len(PREPARED_FINANCE),"original_historical_account_rows":len(accounts),"library":LIBRARY,"durable_source_saved":bool(LIBRARY),"save_mode":os.environ.get("FEA_PUBLIC_SOURCE_SAVE_MODE","standalone")})
except BaseException as e:
 emit({"phase":"OPERATING_ERROR","error":str(e),"traceback":traceback.format_exc()})
 if not SAVE_STARTED and not CAPTURE_SEALED:
  try:save("Preserved actual source operation outcome after "+type(e).__name__)
  except Exception as final:emit({"phase":"PRESERVATION_ERROR","error":str(final)})
 else:emit({"phase":"SOURCE_ARCHIVE_RETAINED","path":str(ROOT),"completed_capture_sealed":CAPTURE_SEALED,"save_started":SAVE_STARTED,"save_state":"The original archive is retained; any existing save attempt remains identified by its retained state."})
 raise
