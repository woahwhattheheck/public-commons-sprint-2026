"""Open a complete forms project and its original reconciliation on private localhost."""
from __future__ import annotations
import argparse
import sys
sys.dont_write_bytecode = True
from contextlib import closing
import csv
import hashlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
import zipfile
from discovery_engine import DiscoveryError, require, read_json, file_digest
from migration_server import State as MigrationState, Handler as MigrationHandler, atomic_new_json
from forms_workbench import verify_project, archive_members, regular_under

def complete_archive(path,root,result):
    if path is None:
        return None
    path = Path(path).resolve()
    require(path.is_file(),"Complete selected project archive is missing")
    with zipfile.ZipFile(path) as archive:
        members,declaration,entries = archive_members(archive,max_bytes=max(path.stat().st_size,20*1024**3))
        require(declaration["project_identity"]==result["project_identity"],"Archive belongs to another project")
        case = {x["path"]:x for x in read_json(root/"delivery.json")["files"]}
        case["delivery.json"] = {"path":"delivery.json","bytes":(root/"delivery.json").stat().st_size,
                                 "sha256":file_digest(root/"delivery.json")}
        source = {"workbench/"+x["path"]:dict(x,path="workbench/"+x["path"]) for x in result["source_files"]}
        require(entries=={**case,**source},"Archive does not retain this complete project and selected program")
        for member in members:
            if member.filename=="archive-manifest.json":
                continue
            expected = entries[member.filename]
            h,count = hashlib.sha256(),0
            with archive.open(member) as stream:
                while True:
                    block = stream.read(1024*1024)
                    if not block:
                        break
                    count += len(block)
                    h.update(block)
            require(count==expected["bytes"] and h.hexdigest()==expected["sha256"],"Archive member byte identity changed")
    return {"path":str(path),"bytes":path.stat().st_size,"sha256":file_digest(path)}

class State(MigrationState):
    def __init__(self,project,archive=None):
        outer,result = verify_project(project,check_application=True)
        super().__init__(outer/"reconciliation")
        self.project_root = outer
        self.project_result = result
        self.project_archive = complete_archive(archive,outer,result)
        self.project_intake = read_json(outer/"intake.original.json")
        self.project_received_intake = read_json(outer/"intake.receiving.json")
        for descriptor in read_json(outer/"delivery.json")["files"]:
            path = regular_under(outer,descriptor["path"])
            observed = path.stat()
            self.file_stats[path] = (observed.st_size,observed.st_mtime_ns,descriptor["sha256"])
        if self.project_archive:
            path = Path(self.project_archive["path"])
            observed = path.stat()
            self.file_stats[path] = (observed.st_size,observed.st_mtime_ns,self.project_archive["sha256"])

    def asset_connection(self):
        path = self.project_root/"forms.sqlite"
        self.unchanged(path)
        return sqlite3.connect(path.as_uri()+"?mode=ro",uri=True)

FILTERS = {
    "assets":("asset_class","side","availability"),
    "attachments":("side","availability"),
    "findings":("asset_class","kind","status")
}
IDS = {"assets":"asset_id","attachments":"entry_id","findings":"finding_id"}

def filters(query,kind):
    allowed = {*FILTERS[kind],"search","offset","limit"}
    require(not(set(query)-allowed) and all(len(x)==1 for x in query.values()),"Unknown or repeated forms filter")
    clauses,values = [],[]
    for key in FILTERS[kind]:
        value = query.get(key,[""])[0]
        require(len(value)<=1000,"Filter text is too long")
        if value:
            clauses.append(key+"=?")
            values.append(value)
    search = query.get("search",[""])[0]
    require(len(search)<=1000,"Search is too long")
    if search:
        clauses.append("search LIKE ? ESCAPE '\\'")
        values.append("%"+search.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%")
    return (" WHERE "+" AND ".join(clauses)) if clauses else "",values

class Handler(MigrationHandler):
    server_version = "TJLabsForms/1"

    def forms_page(self,query,kind):
        where,parameters = filters(query,kind)
        a,b = query.get("offset",["0"])[0],query.get("limit",["40"])[0]
        require(a.isdecimal() and b.isdecimal(),"Offset and limit must be nonnegative integers")
        offset,limit = int(a),int(b)
        require(0<=offset<=10**12 and 1<=limit<=500,"Select a page of1 through500 records")
        with closing(self.state.asset_connection()) as db:
            count = db.execute("SELECT COUNT(*) FROM "+kind+where,parameters).fetchone()[0]
            rows = [json.loads(x[0]) for x in db.execute("SELECT payload FROM "+kind+where+
                    " ORDER BY "+IDS[kind]+" LIMIT ? OFFSET ?",[*parameters,limit,offset])]
        self.send_json({"total":count,"offset":offset,"limit":limit,"rows":rows})

    def selected(self,query,kind):
        require(set(query)=={"id"} and len(query["id"])==1,"Select one original forms record")
        value = query["id"][0]
        require(0<len(value)<=1000,"Invalid selected identity")
        if kind=="findings":
            require(value.isdecimal() and 0<int(value)<=10**12,"Select a positive finding ID")
            value = int(value)
        with closing(self.state.asset_connection()) as db:
            row = db.execute("SELECT payload FROM "+kind+" WHERE "+IDS[kind]+"=?",(value,)).fetchone()
        return json.loads(row[0]) if row else None

    def forms_single(self,query,kind):
        row = self.selected(query,kind)
        if row is None:
            self.error_json(404,"NOT_FOUND","Selected original forms record is absent.")
        else:
            self.send_json(row)

    def original(self,query):
        row = self.selected(query,"assets")
        if row is None:
            self.error_json(404,"NOT_FOUND","Selected original asset is absent.")
        elif row["availability"]!="PRESENT":
            self.error_json(409,"BODY_UNAVAILABLE","The selected asset has no complete retained body.")
        else:
            path = regular_under(self.state.project_root,row["retained_path"])
            # Keep untrusted original media inert: download instead of executing HTML/XML in the inspector.
            name = re.sub(r"[^A-Za-z0-9_.-]","_",row["filename"])[:180] or row["asset_id"]+".bin"
            self.file_response(path,"application/octet-stream",name)

    def do_GET(self):
        # Original inspector and API remain unchanged; this subclass only adds forms routes.
        prefix = self.state.prefix
        path = self.path.split("?",1)[0]
        own = any(path.startswith(prefix+x) for x in ("workspace/","api/forms/","download/forms/"))
        if not own:
            return super().do_GET()
        authorized = self.authorize()
        if authorized is None:
            return
        tail,query = authorized
        try:
            if tail=="workspace/":
                require(not query,"Workspace takes no filters")
                self.file_response(self.state.project_root/"report.html","text/html; charset=utf-8")
            elif tail=="api/forms/summary":
                require(not query,"Summary takes no filters")
                self.send_json(self.state.project_result)
            elif tail=="api/forms/capabilities":
                require(not query,"Capabilities takes no filters")
                archive = self.state.project_archive
                self.send_json({"schema":"tjlabs.forms-workbench.capabilities.v1","read_only":True,
                    "project_identity":self.state.project_result["project_identity"],
                    "archive_available":archive is not None,
                    "archive":{k:archive[k] for k in ("bytes","sha256")} if archive else None})
            elif tail in ("api/forms/intake","api/forms/intake-receiving"):
                require(not query,"Original intake takes no filters")
                self.send_json(self.state.project_intake if tail=="api/forms/intake" else self.state.project_received_intake)
            elif tail in ("api/forms/assets","api/forms/attachments","api/forms/findings"):
                self.forms_page(query,tail.rsplit("/",1)[1])
            elif tail in ("api/forms/asset","api/forms/attachment","api/forms/finding"):
                kind = {"asset":"assets","attachment":"attachments","finding":"findings"}[tail.rsplit("/",1)[1]]
                self.forms_single(query,kind)
            elif tail=="download/forms/original":
                self.original(query)
            elif tail=="download/forms/project.zip":
                require(not query,"Whole project export takes no filters")
                if self.state.project_archive is None:
                    self.error_json(409,"ARCHIVE_UNAVAILABLE","Pack this complete project and open it with its archive.")
                else:
                    self.file_response(Path(self.state.project_archive["path"]),"application/zip","Forms_Project.zip")
            elif tail.startswith("download/forms/"):
                require(not query,"Complete data exports take no filters")
                name = tail[len("download/forms/"):]
                allowed = {"assets.jsonl","assets.csv","attachments.jsonl","attachments.csv","findings.jsonl","findings.csv",
                           "result.json","intake.original.json","intake.receiving.json"}
                if name not in allowed:
                    self.error_json(404,"NOT_FOUND","Unknown forms export.")
                else:
                    mime = "text/csv; charset=utf-8" if name.endswith(".csv") else "application/x-ndjson; charset=utf-8" if name.endswith(".jsonl") else "application/json; charset=utf-8"
                    self.file_response(self.state.project_root/name,mime,name)
            else:
                self.error_json(404,"NOT_FOUND","Unknown forms workspace route.")
        except (DiscoveryError,ValueError,KeyError,TypeError) as error:
            self.error_json(400,"INVALID_REQUEST",str(error))
        except (FileNotFoundError,sqlite3.Error) as error:
            self.error_json(409,"CASE_UNAVAILABLE",str(error))
        except (BrokenPipeError,ConnectionResetError):
            pass

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project",required=True)
    parser.add_argument("--archive")
    parser.add_argument("--receipt",required=True)
    parser.add_argument("--port",type=int,default=0)
    args = parser.parse_args(argv)
    server = None
    try:
        require(0<=args.port<=65535,"Port must be0 through65535")
        root = Path(args.project).resolve()
        receipt = Path(args.receipt).resolve()
        require(not receipt.exists() and not receipt.is_relative_to(root),"Choose a new private receipt outside the immutable project")
        csv.field_size_limit(16*1024*1024)
        state = State(root,args.archive)
        server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
        server.daemon_threads = True
        server.case_state = state
        origin = "http://127.0.0.1:%d%s"%(server.server_port,state.prefix)
        value = {"schema":"tjlabs.forms-workbench.server.v1","origin":origin,"workspace_url":origin+"workspace/",
                 "project":str(root),"archive":state.project_archive,"pid":os.getpid(),
                 "project_identity":state.project_result["project_identity"],
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
