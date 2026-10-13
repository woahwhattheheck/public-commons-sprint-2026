"""Serve one complete private migration case through a read-only localhost inspector."""
from __future__ import annotations
import argparse
import csv
from contextlib import closing
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import tempfile
from urllib.parse import urlsplit, parse_qs
import zipfile
from discovery_engine import DiscoveryError, require, json_bytes, read_json, file_digest, safe_relative
from migration_reconciliation import verify_case

def archive_identity(archive_path,root,report,result):
    if archive_path is None:
        return None
    path = Path(archive_path).resolve()
    require(path.is_file(),"Selected complete case archive is missing")
    with zipfile.ZipFile(path) as z:
        entries = z.infolist()
        names = [e.filename for e in entries]
        require(len(names)==len(set(names)) and "handover-manifest.json" in names,
                "Archive has repeated members or no original handover manifest")
        declaration = json.loads(z.read("handover-manifest.json"))
        require(declaration.get("schema")=="commons.discovery.handover.v1" and
                declaration["run_identity"]==report["run_identity"],"Archive belongs to another source case")
        members = {e["path"]:e for e in declaration["files"]}
        require(len(members)==len(declaration["files"]) and
                set(names)==set(members)|{"handover-manifest.json"},"Archive member set differs")
        complete_case = {p.relative_to(root).as_posix():p for p in root.rglob("*")
                         if p.is_file() and p.name not in ("cohort.sqlite","handover-manifest.json") and
                         not p.relative_to(root).as_posix().startswith("workbench/")}
        archive_case = {n for n in members if not n.startswith("workbench/")}
        require(archive_case==set(complete_case),"Archive does not retain this complete selected case")
        for entry in entries:
            safe_relative(entry.filename)
            require(not entry.is_dir() and (entry.external_attr>>16)&0o170000 != 0o120000,
                    "Archive contains a nonregular member")
            if entry.filename=="handover-manifest.json":
                continue
            expected = members[entry.filename]
            require(entry.file_size==expected["bytes"],"Archive member size differs")
            h,count = hashlib.sha256(),0
            with z.open(entry) as stream:
                while True:
                    block = stream.read(1024*1024)
                    if not block:
                        break
                    h.update(block)
                    count += len(block)
            require(count==expected["bytes"] and h.hexdigest()==expected["sha256"],
                    "Archive payload differs from its full member declaration")
            if entry.filename in complete_case:
                current = complete_case[entry.filename]
                require(current.stat().st_size==count and file_digest(current)==expected["sha256"],
                        "Archive contains another revision of this case")
        for selected in result["recipe_files"]:
            entry = members.get("workbench/"+selected["path"])
            require(entry is not None and entry["bytes"]==selected["bytes"] and
                    entry["sha256"]==selected["sha256"],"Archive application differs from selected calculation")
    return {"path":str(path),"bytes":path.stat().st_size,"sha256":file_digest(path)}

def atomic_new_json(path,value):
    path = Path(path).resolve()
    require(not path.exists(),"Choose a new private server receipt path")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp = tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temp,path)
    finally:
        os.unlink(temp)

def query_filter(query,kind):
    allowed = {"pair","search","offset","limit","field","status"} if kind=="totals" else {"pair","search","offset","limit","classification"}
    require(not(set(query)-allowed),"Unknown filter")
    require(all(len(v)==1 for v in query.values()),"Repeated query argument")
    clauses,params = [],[]
    for name in ("pair","field","status") if kind=="totals" else ("pair","classification"):
        value = query.get(name,[""])[0]
        require(len(value)<=1000,"Filter value is too long")
        if value:
            clauses.append(name+"=?")
            params.append(value)
    search = query.get("search",[""])[0]
    require(len(search)<=1000,"Search value is too long")
    if search:
        escaped = search.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")
        clauses.append(("dimensions" if kind=="totals" else "key_text")+" LIKE ? ESCAPE '\\'")
        params.append("%"+escaped+"%")
    return (" WHERE "+" AND ".join(clauses)) if clauses else "",params

class State:
    def __init__(self,case,archive=None):
        self.root,self.report,self.result = verify_case(case)
        here = Path(__file__).resolve().parent
        for selected in self.result["recipe_files"]:
            require((here/selected["path"]).is_file() and
                    file_digest(here/selected["path"])==selected["sha256"],
                    "Restore the actual selected application source before opening this case")
        self.manifest = read_json(self.root/"manifest.json")
        self.migration = self.root/"migration"
        self.archive = archive_identity(archive,self.root,self.report,self.result)
        self.token = secrets.token_urlsafe(32)
        self.prefix = "/"+self.token+"/"
        self.snapshots = {s["table"]:s for s in self.report["lineage"]["inputs"]}
        self.tables = {t["id"]:t for t in self.manifest["tables"]}
        self.file_stats = {}
        for descriptor in read_json(self.migration/"delivery.json")["files"]:
            path = self.migration/safe_relative(descriptor["path"])
            self.file_stats[path] = (path.stat().st_size,path.stat().st_mtime_ns,descriptor["sha256"])
        for descriptor in self.snapshots.values():
            path = self.root/safe_relative(descriptor["retained_path"])
            self.file_stats[path] = (path.stat().st_size,path.stat().st_mtime_ns,descriptor["sha256"])
        for path in (self.root/"report.json",self.root/"manifest.original.json"):
            self.file_stats[path] = (path.stat().st_size,path.stat().st_mtime_ns,file_digest(path))
        if self.archive:
            path = Path(self.archive["path"])
            self.file_stats[path] = (path.stat().st_size,path.stat().st_mtime_ns,self.archive["sha256"])
    def unchanged(self,path):
        expected = self.file_stats.get(path)
        require(expected is not None and path.is_file() and not path.is_symlink(),
                "Original selected case file is unavailable")
        observed = path.stat()
        require(observed.st_size==expected[0] and observed.st_mtime_ns==expected[1],
                "Selected immutable case changed while the inspector was open; reopen a complete verified edition")
    def connection(self):
        path = self.migration/"comparisons.sqlite"
        self.unchanged(path)
        return sqlite3.connect(path.as_uri()+"?mode=ro",uri=True)

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    server_version = "TJLabsMigration/1"
    def log_message(self,*args):
        # Do not put original business keys or the private access token in console logs.
        pass
    @property
    def state(self):
        return self.server.case_state
    def header(self,status,content_type,length=None,filename=None):
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Cross-Origin-Resource-Policy","same-origin")
        if length is not None:
            self.send_header("Content-Length",str(length))
        if filename:
            self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
        self.end_headers()
    def send_json(self,value,status=200):
        body = json_bytes(value)
        self.header(status,"application/json; charset=utf-8",len(body))
        self.wfile.write(body)
    def error_json(self,status,code,message):
        self.send_json({"status":"ERROR","code":code,"message":message},status)
    def authorize(self):
        expected = "127.0.0.1:"+str(self.server.server_port)
        if self.headers.get("Host")!=expected:
            self.error_json(403,"HOST","Use the exact private localhost URL.")
            return None
        origin = self.headers.get("Origin")
        if origin is not None and origin!="http://"+expected:
            self.error_json(403,"ORIGIN","This private inspector accepts its own origin.")
            return None
        if self.headers.get("Sec-Fetch-Site")=="cross-site":
            self.error_json(403,"ORIGIN","Open the original private inspector URL directly.")
            return None
        parsed = urlsplit(self.path)
        if not parsed.path.startswith(self.state.prefix):
            self.error_json(404,"NOT_FOUND","Unknown inspector path.")
            return None
        tail = parsed.path[len(self.state.prefix):]
        return tail,parse_qs(parsed.query,keep_blank_values=True)
    def file_response(self,path,kind,filename=None):
        self.state.unchanged(path)
        self.header(200,kind,path.stat().st_size,filename)
        with open(path,"rb") as stream:
            shutil.copyfileobj(stream,self.wfile,1024*1024)
    def page(self,query,kind):
        where,params = query_filter(query,kind)
        offset_text,limit_text = query.get("offset",["0"])[0],query.get("limit",["40"])[0]
        require(offset_text.isdecimal() and limit_text.isdecimal(),"Page offset/limit must be nonnegative integers")
        offset,limit = int(offset_text),int(limit_text)
        require(0<=offset<=10**12 and 1<=limit<=500,"Page size must be1 through500")
        table,id_column = ("totals","total_id") if kind=="totals" else ("comparisons","row_id")
        with closing(self.state.connection()) as db:
            total = db.execute("SELECT COUNT(*) FROM "+table+where,params).fetchone()[0]
            rows = [json.loads(row[0]) for row in db.execute(
                "SELECT payload FROM "+table+where+" ORDER BY "+id_column+" LIMIT ? OFFSET ?",
                [*params,limit,offset])]
        self.send_json({"total":total,"offset":offset,"limit":limit,"rows":rows})
    def single(self,query,kind):
        require(set(query)=={"id"} and len(query["id"])==1 and query["id"][0].isdecimal(),
                "Select one positive record ID")
        identity = int(query["id"][0])
        require(0<identity<=10**12,"Record ID is outside the supported range")
        table,id_column = ("totals","total_id") if kind=="totals" else ("comparisons","row_id")
        with closing(self.state.connection()) as db:
            row = db.execute("SELECT payload FROM "+table+" WHERE "+id_column+"=?",(identity,)).fetchone()
        if row is None:
            self.error_json(404,"NOT_FOUND","The selected result record does not exist.")
        else:
            self.send_json(json.loads(row[0]))
    def source(self,query):
        require(set(query)=={"table","record"} and all(len(v)==1 for v in query.values()),
                "Select one original table and positive source record")
        table_id,ordinal = query["table"][0],query["record"][0]
        require(table_id in self.state.tables and ordinal.isdecimal() and 0<int(ordinal)<=10**12,
                "Unknown original table or source record")
        record = int(ordinal)
        table,snapshot = self.state.tables[table_id],self.state.snapshots[table_id]
        path = self.state.root/safe_relative(snapshot["retained_path"])
        self.state.unchanged(path)
        with open(path,encoding=table.get("encoding","utf-8-sig"),newline="") as stream:
            reader = csv.reader(stream,delimiter=table.get("delimiter",","),quotechar=table.get("quotechar",'"'),strict=True)
            headers = next(reader)
            for current,values in enumerate(reader,1):
                if current==record:
                    self.send_json({"table":table_id,"record":record,"headers":headers,"values":values,"source":snapshot})
                    return
        self.error_json(404,"NOT_FOUND","That record is absent from the complete original source.")
    def stream_filtered(self,query,kind,format):
        where,params = query_filter(query,kind)
        # Paging never narrows a complete requested export.
        require(not(set(query)&{"offset","limit"}),"Complete exports take filters, not page limits")
        table,id_column = ("totals","total_id") if kind=="totals" else ("comparisons","row_id")
        filename = kind+"-selected."+format
        self.header(200,"application/x-ndjson; charset=utf-8" if format=="jsonl" else "text/csv; charset=utf-8",filename=filename)
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        header = ["total_id","pair","field","dimensions","status","source","target","difference"] if kind=="totals" else ["row_id","pair","classification","key_json","source_records","target_records","fields_json","issues_json"]
        if format=="csv":
            writer.writerow(header)
            self.wfile.write(buffer.getvalue().encode("utf-8"))
            buffer.seek(0)
            buffer.truncate(0)
        with closing(self.state.connection()) as db:
            for (payload,) in db.execute("SELECT payload FROM "+table+where+" ORDER BY "+id_column,params):
                if format=="jsonl":
                    self.wfile.write(payload.encode("utf-8")+b"\n")
                else:
                    row = json.loads(payload)
                    if kind=="totals":
                        values = [str(row["total_id"]),row["pair"],row["field"],json.dumps(row["dimensions"],ensure_ascii=False),row["status"]]+[
                            json.dumps(row[x],ensure_ascii=False,separators=(",",":")) for x in ("source","target","difference")]
                    else:
                        values = [str(row["row_id"]),row["pair"],row["classification"],json.dumps(row["key"],ensure_ascii=False)]+[
                            json.dumps(row[x],ensure_ascii=False,separators=(",",":")) for x in ("source_records","target_records","fields","issues")]
                    writer.writerow(["'"+v if v.lstrip().startswith(("=","+","-","@")) else v for v in values])
                    self.wfile.write(buffer.getvalue().encode("utf-8"))
                    buffer.seek(0)
                    buffer.truncate(0)
    def do_GET(self):
        authorized = self.authorize()
        if authorized is None:
            return
        tail,query = authorized
        try:
            if tail=="":
                require(not query,"Inspector home takes no query arguments")
                self.file_response(self.state.migration/"report.html","text/html; charset=utf-8")
            elif tail=="api/summary":
                require(not query,"Summary takes no filters")
                self.send_json(self.state.result)
            elif tail=="api/capabilities":
                require(not query,"Capabilities takes no filters")
                self.send_json({"schema":"tjlabs.migration-reconciliation.capabilities.v1",
                                "read_only":True,"archive_available":self.state.archive is not None,
                                "archive":None if self.state.archive is None else
                                {k:self.state.archive[k] for k in ("bytes","sha256")}})
            elif tail=="api/rows":
                self.page(query,"rows")
            elif tail=="api/row":
                self.single(query,"rows")
            elif tail=="api/totals":
                self.page(query,"totals")
            elif tail=="api/total":
                self.single(query,"totals")
            elif tail=="api/source":
                self.source(query)
            elif tail in ("api/manifest","api/source-report"):
                require(not query,"Original source metadata takes no filters")
                self.send_json(self.state.manifest if tail=="api/manifest" else self.state.report)
            elif tail in ("download/rows.jsonl","download/rows.csv","download/totals.jsonl","download/totals.csv"):
                filename = tail.split("/",1)[1]
                kind,format = filename.split(".")
                if query:
                    self.stream_filtered(query,kind,format)
                else:
                    self.file_response(self.state.migration/filename,"application/x-ndjson; charset=utf-8" if format=="jsonl" else "text/csv; charset=utf-8",filename)
            elif tail=="download/case.zip":
                require(not query,"Complete case export takes no filters")
                if self.state.archive is None:
                    self.error_json(409,"ARCHIVE_UNAVAILABLE","Pack this complete case and reopen the inspector with --archive.")
                else:
                    self.file_response(Path(self.state.archive["path"]),"application/zip","Migration_Case.zip")
            elif tail in ("download/result.json","download/source-report.json","download/manifest.original.json"):
                require(not query,"Original JSON downloads take no filters")
                filename = tail.split("/",1)[1]
                path = self.state.migration/"result.json" if filename=="result.json" else self.state.root/("report.json" if filename=="source-report.json" else filename)
                self.file_response(path,"application/json; charset=utf-8",filename)
            else:
                self.error_json(404,"NOT_FOUND","Unknown inspector route.")
        except (DiscoveryError,ValueError,KeyError,TypeError) as error:
            self.error_json(400,"INVALID_REQUEST",str(error))
        except (FileNotFoundError,sqlite3.Error) as error:
            self.error_json(409,"CASE_UNAVAILABLE",str(error))
        except (BrokenPipeError,ConnectionResetError):
            pass
    def do_POST(self):
        self.error_json(405,"READ_ONLY","This inspector exposes read-only GET operations.")
    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case",required=True)
    parser.add_argument("--archive")
    parser.add_argument("--receipt",required=True)
    parser.add_argument("--port",type=int,default=0)
    args = parser.parse_args(argv)
    server = None
    try:
        require(0<=args.port<=65535,"Port must be0 through65535")
        receipt = Path(args.receipt).resolve()
        require(not receipt.exists(),"Choose a new server receipt path")
        root = Path(args.case).resolve()
        require(not receipt.is_relative_to(root),"Server receipt must be outside the immutable case")
        csv.field_size_limit(16*1024*1024)
        state = State(root,args.archive)
        server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
        server.daemon_threads = True
        server.case_state = state
        origin = "http://127.0.0.1:%d%s"%(server.server_port,state.prefix)
        value = {"schema":"tjlabs.migration-reconciliation.server.v1","origin":origin,
                 "case":str(root),"archive":state.archive,"pid":os.getpid(),
                 "source_run_identity":state.report["run_identity"],"read_only":True}
        atomic_new_json(receipt,value)
        print(json.dumps({"status":"LISTENING",**value},ensure_ascii=False),flush=True)
        server.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    except (DiscoveryError,ValueError,OSError,sqlite3.Error,KeyError,TypeError,zipfile.BadZipFile) as error:
        print(json.dumps({"status":"ERROR","type":type(error).__name__,"message":str(error)},ensure_ascii=False),flush=True)
        return 2
    finally:
        if server is not None:
            server.server_close()

if __name__=="__main__":
    raise SystemExit(main())
