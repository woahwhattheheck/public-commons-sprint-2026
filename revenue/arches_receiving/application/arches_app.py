#!/usr/bin/env python3
"""Local staff application for an original Arches review workspace."""
import argparse, csv, hashlib, http.server, json, os, pathlib, secrets, sys, threading, urllib.parse, uuid
from arches_workspace import Workspace, Conflict, canonical, file_hash
from arches_review_exchange import export_review, preview_review, apply_review
APP=pathlib.Path(__file__).resolve().parent
def serve(workspace,host="127.0.0.1",port=8768,token_file=None):
    root=pathlib.Path(workspace).resolve();store=Workspace(root)
    private=root/"private";private.mkdir(exist_ok=True,mode=0o700)
    token_file=pathlib.Path(token_file) if token_file else private/"staff-token"
    if token_file.exists():token=token_file.read_text().strip()
    else:
        token=secrets.token_urlsafe(36)
        fd=os.open(token_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"w") as f:f.write(token+"\n")
    if len(token)<32:raise ValueError("Staff credential must contain at least 32 characters")
    uploads=private/"uploads";uploads.mkdir(exist_ok=True)
    downloads=private/"downloads";downloads.mkdir(exist_ok=True)
    def application():return [APP/p for p in ("arches_source.py","arches_workspace.py","arches_review_exchange.py","arches_app.py","index.html","OPERATING_GUIDE.md","ARCHES_SOURCE.md","operate.py","browser-receiving.mjs","BROWSER_RECEIVING.md","receive_public_starches.py","PUBLIC_SOURCE_RECEIVING.md","arches_native_skos.py","NATIVE_SKOS_RECEIVING.md","native_skos_receiving.py","LICENSE.txt","NOTICE.md")]
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version="ArchesReview/1"
        def log_message(self,fmt,*args):pass
        def _url(self):return urllib.parse.urlsplit(self.path)
        def _query(self):return urllib.parse.parse_qs(self._url().query)
        def _check(self):
            origin=self.headers.get("Origin")
            if origin and origin not in ("http://"+self.headers.get("Host",""),"https://"+self.headers.get("Host","")):raise PermissionError("Origin does not match the staff service")
            supplied=self.headers.get("Authorization","")
            if not secrets.compare_digest(supplied,"Bearer "+token):raise PermissionError("Enter the staff access token")
        def _json(self,value,status=200):
            data=(canonical(value)+"\n").encode()
            self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(data)));self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.end_headers();self.wfile.write(data)
        def _body(self):
            n=int(self.headers.get("Content-Length","0"))
            if n<1 or n>4*1024*1024:raise ValueError("Request must contain at most 4 MiB of JSON")
            raw=self.rfile.read(n)
            if len(raw)!=n:raise ValueError("Incomplete request")
            result=json.loads(raw)
            if not isinstance(result,dict):raise ValueError("JSON request must be an object")
            return result
        def _error(self,e):
            status=403 if isinstance(e,PermissionError) else 409 if isinstance(e,Conflict) else 404 if isinstance(e,KeyError) else 400
            self._json({"error":str(e),"type":type(e).__name__},status)
        def _file(self,path,filename,content_type="application/zip"):
            self.send_response(200);self.send_header("Content-Type",content_type);self.send_header("Content-Length",str(path.stat().st_size));self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.send_header("Content-Disposition",'attachment; filename="'+filename+'"');self.end_headers()
            with path.open("rb") as f:
                for block in iter(lambda:f.read(1024*1024),b""):self.wfile.write(block)
        def do_GET(self):
            try:
                path=self._url().path
                if path=="/":
                    data=(APP/"index.html").read_bytes()
                    self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8");self.send_header("Content-Length",str(len(data)));self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.end_headers();self.wfile.write(data);return
                self._check();q=self._query()
                if path=="/api/status":return self._json(store.status())
                if path=="/api/edition":return self._json(store.edition(q["snapshot"][0]))
                if path=="/api/changes":return self._json(store.changes(q["snapshot"][0],q.get("offset",[0])[0],q.get("limit",[100])[0],q.get("kind",[None])[0]))
                if path=="/api/resource":return self._json(store.resource(q["snapshot"][0],q["graph_id"][0],q["resource_id"][0]))
                if path.startswith("/downloads/"):
                    name=path.removeprefix("/downloads/")
                    if pathlib.PurePosixPath(name).name!=name or not name.endswith((".zip",".csv")):raise KeyError("Unknown download")
                    item=downloads/name
                    if not item.is_file():raise KeyError("Unknown download")
                    return self._file(item,name,"text/csv; charset=utf-8" if name.endswith(".csv") else "application/zip")
                if path.startswith("/source/"):
                    sha=path.removeprefix("/source/")
                    if len(sha)!=64 or any(x not in "0123456789abcdef" for x in sha):raise KeyError("Unknown source")
                    item=store.sources/(sha+".json")
                    if not item.is_file() or file_hash(item)[0]!=sha:raise KeyError("Unknown original source")
                    return self._file(item,sha+".json","application/octet-stream")
                raise KeyError("Unknown route")
            except (ValueError,KeyError,PermissionError,OSError,csv.Error) as e:self._error(e)
        def do_PUT(self):
            temp=None
            try:
                self._check()
                if self._url().path!="/api/uploads":raise KeyError("Unknown route")
                q=self._query();kind=q.get("kind",[""])[0]
                if kind not in ("resource","graph","collection","license","review"):raise ValueError("Choose the source role")
                name=pathlib.PurePosixPath(q.get("name",["source.json"])[0]).name
                if not name or len(name)>240:raise ValueError("Invalid source filename")
                n=int(self.headers.get("Content-Length","0"))
                if n<1 or n>2*1024**3:raise ValueError("A source file must contain 1 byte to 2 GiB")
                identity=uuid.uuid4().hex;temp=uploads/(identity+".part");h=hashlib.sha256();remaining=n
                with temp.open("xb") as out:
                    while remaining:
                        block=self.rfile.read(min(1024*1024,remaining))
                        if not block:raise ValueError("Source upload ended early")
                        out.write(block);h.update(block);remaining-=len(block)
                    out.flush();os.fsync(out.fileno())
                folder=uploads/identity;folder.mkdir(mode=0o700)
                target=folder/name;os.replace(temp,target);temp=None
                meta={"upload_id":identity,"role":kind,"name":name,"bytes":n,"sha256":h.hexdigest()}
                (uploads/(identity+".json")).write_text(canonical(meta)+"\n")
                self._json(meta,201)
            except (ValueError,KeyError,PermissionError,OSError,csv.Error) as e:self._error(e)
            finally:
                if temp and temp.exists():temp.unlink()
        def do_POST(self):
            try:
                self._check();body=self._body();path=self._url().path
                if path=="/api/import":
                    paths={k:[] for k in ("resource","graph","collection","license")}
                    for item in body.get("uploads",[]):
                        if not isinstance(item,str) or len(item)!=32 or any(c not in "0123456789abcdef" for c in item):raise ValueError("Unknown upload")
                        meta=json.loads((uploads/(item+".json")).read_text());source=uploads/item/meta["name"]
                        if file_hash(source)!=(meta["sha256"],meta["bytes"]):raise ValueError("Uploaded source changed")
                        paths[meta["role"]].append(source)
                    result=store.import_candidate(source_paths=paths["resource"],graph_paths=paths["graph"],collection_paths=paths["collection"],license_paths=paths["license"],source_format=body["source_format"],scope_id=body["scope_id"],coverage=body["coverage"],parent_release=body.get("parent_release"),actor=body["actor"],operation_id=body["operation_id"],expected_revision=body["expected_revision"])
                    return self._json(result,201)
                if path=="/api/review/export":
                    filename="Arches_Review_"+uuid.uuid4().hex+".csv"
                    result=export_review(store,body["snapshot"],downloads/filename,kind=body.get("kind"),only_open=body.get("only_open",True))
                    result.pop("path",None);result["download"]="/downloads/"+filename
                    return self._json(result,201)
                if path in ("/api/review/preview","/api/review/apply"):
                    upload=body["upload_id"]
                    if not isinstance(upload,str) or len(upload)!=32 or any(x not in "0123456789abcdef" for x in upload):raise ValueError("Unknown review upload")
                    meta=json.loads((uploads/(upload+".json")).read_text())
                    if meta["role"]!="review":raise ValueError("Choose the received staff review file")
                    source=uploads/upload/meta["name"]
                    if file_hash(source)!=(meta["sha256"],meta["bytes"]):raise ValueError("Received review file changed")
                    if path.endswith("preview"):return self._json(preview_review(store,source,snapshot=body["snapshot"],expected_revision=body["expected_revision"]))
                    return self._json(apply_review(store,source,snapshot=body["snapshot"],preview_sha256=body["preview_sha256"],actor=body["actor"],operation_id=body["operation_id"],expected_revision=body["expected_revision"]))
                if path=="/api/decisions":return self._json(store.decide(**body))
                if path=="/api/release":return self._json(store.release(**body),201)
                if path in ("/api/export/workspace","/api/export/release"):
                    filename=("Arches_Workspace_" if path.endswith("workspace") else "Arches_Release_")+uuid.uuid4().hex+".zip"
                    target=downloads/filename
                    result=store.export_workspace(target,application()) if path.endswith("workspace") else store.export_release(body["release"],target)
                    result.pop("path",None);result["download"]="/downloads/"+filename
                    return self._json(result,201)
                raise KeyError("Unknown route")
            except (ValueError,KeyError,PermissionError,OSError,csv.Error) as e:self._error(e)
    httpd=http.server.ThreadingHTTPServer((host,port),Handler)
    print(canonical({"event":"ready","url":"http://"+host+":"+str(httpd.server_port),"token_file":str(token_file),"workspace":store.status()["workspace_id"]}),flush=True)
    try:httpd.serve_forever()
    finally:httpd.server_close()
def main():
    p=argparse.ArgumentParser(description="Original Arches receiving and staff review")
    sub=p.add_subparsers(dest="command",required=True)
    run=sub.add_parser("serve");run.add_argument("--workspace",required=True);run.add_argument("--host",default="127.0.0.1");run.add_argument("--port",type=int,default=8768);run.add_argument("--token-file")
    restore=sub.add_parser("restore");restore.add_argument("archive");restore.add_argument("destination")
    export=sub.add_parser("export");export.add_argument("--workspace",required=True);export.add_argument("--output",required=True)
    args=p.parse_args()
    if args.command=="serve":serve(args.workspace,args.host,args.port,args.token_file)
    elif args.command=="restore":print(canonical(Workspace.restore(args.archive,args.destination)))
    else:print(canonical(Workspace(args.workspace).export_workspace(args.output,[p for p in APP.iterdir() if p.name in ("arches_source.py","arches_workspace.py","arches_review_exchange.py","arches_app.py","index.html","OPERATING_GUIDE.md","ARCHES_SOURCE.md","operate.py","browser-receiving.mjs","BROWSER_RECEIVING.md","receive_public_starches.py","PUBLIC_SOURCE_RECEIVING.md","arches_native_skos.py","NATIVE_SKOS_RECEIVING.md","native_skos_receiving.py","LICENSE.txt","NOTICE.md")])))
if __name__=="__main__":main()
