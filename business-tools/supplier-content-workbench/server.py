#!/usr/bin/env python3
"""Run the local supplier operator app or receive a complete original case."""
from __future__ import annotations
import argparse, collections, hashlib, json, mimetypes, os, re, signal, socket, sys, threading, time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from core import Problem, need, canonical, digest, MAX_UPLOAD
from store import Store, receive

class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False
    def __init__(self,address,store):
        self.store=store
        self.login_attempts={}
        self.login_lock=threading.Lock()
        super().__init__(address,Handler)
    def rate_login(self,email):
        key=(email or "").casefold()[:254]
        with self.login_lock:
            t=time.monotonic()
            queue=self.login_attempts.setdefault(key,collections.deque())
            while queue and queue[0]<t-60:
                queue.popleft()
            need(len(queue)<8,"LOGIN_RATE","Wait one minute before trying this account again.",429)
            queue.append(t)
            if len(self.login_attempts)>2000:
                self.login_attempts={k:v for k,v in self.login_attempts.items() if v and v[-1]>t-60}

class Handler(BaseHTTPRequestHandler):
    server_version="SupplierWorkbench/1"
    protocol_version="HTTP/1.1"
    def setup(self):
        super().setup()
        self.connection.settimeout(30)
    def log_message(self,format,*args):
        # Never log credentials, cookies, full request bodies or private source files.
        sys.stderr.write(json.dumps({"event":"http","method":self.command,
            "path":urlsplit(self.path).path,"message":format%args})+"\n")
    def token(self):
        cookie=SimpleCookie()
        try:cookie.load(self.headers.get("Cookie",""))
        except Exception:return None
        return cookie["supplier_session"].value if "supplier_session" in cookie else None
    def user(self):
        result=self.server.store.session(self.token())
        need(result["authenticated"],"AUTH_REQUIRED","Sign in to this workspace.",401)
        return result["user"]
    def response_headers(self,status,content_type,length,cookie=None,filename=None):
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(length))
        self.send_header("Connection","close")
        self.close_connection=True
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","same-origin")
        self.send_header("Cross-Origin-Resource-Policy","same-origin")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'")
        if cookie is not None:
            self.send_header("Set-Cookie","supplier_session="+cookie+"; HttpOnly; SameSite=Strict; Path=/"+("; Max-Age=0" if not cookie else "; Max-Age=28800"))
        if filename:
            filename=re.sub(r'[^A-Za-z0-9._-]','_',filename)
            self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
        self.end_headers()
    def send_json(self,value,status=200,cookie=None):
        raw=canonical({"ok":True,"data":value})
        self.response_headers(status,"application/json; charset=utf-8",len(raw),cookie)
        self.wfile.write(raw)
    def send_file(self,name,raw):
        mime=mimetypes.guess_type(name)[0] or "application/octet-stream"
        self.response_headers(200,mime,len(raw),filename=name)
        self.wfile.write(raw)
    def boundary(self):
        port=self.server.server_address[1]
        host=self.headers.get("Host","").lower()
        allowed={f"127.0.0.1:{port}",f"localhost:{port}"}
        need(host in allowed,"HOST_INVALID","Open this server using its printed loopback URL.",403)
        origin=self.headers.get("Origin")
        need(origin is None or origin in {"http://"+h for h in allowed},
             "ORIGIN_INVALID","Use the same-origin workspace page for this action.",403)
    def body(self):
        need(self.headers.get_content_type()=="application/json","JSON_REQUIRED","Send an application/json body.",415)
        value=self.headers.get("Content-Length","")
        need(value.isdigit(),"BODY_LENGTH","A complete Content-Length is required.")
        length=int(value)
        need(0<length<=MAX_UPLOAD*4//3+2*1024*1024,"BODY_LIMIT","The request exceeds the supported file size.",413)
        self.connection.settimeout(60)
        raw=self.rfile.read(length)
        need(len(raw)==length,"BODY_INCOMPLETE","The request body did not arrive completely.")
        try:
            payload=json.loads(raw,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
        except (ValueError,UnicodeDecodeError) as exc:
            raise Problem("JSON_INVALID","The request body is not valid JSON.") from exc
        need(isinstance(payload,dict),"BODY_OBJECT","The request body must be an object.")
        return payload
    def do_GET(self):
        self.dispatch("GET")
    def do_POST(self):
        self.dispatch("POST")
    def dispatch(self,method):
        try:
            self.boundary()
            parsed=urlsplit(self.path)
            path=unquote(parsed.path)
            parts=path.strip("/").split("/")
            query={k:v[-1] for k,v in parse_qs(parsed.query).items()}
            if method=="GET":
                return self.read(path,parts,query)
            return self.change(path,parts,self.body())
        except (BrokenPipeError,ConnectionResetError,TimeoutError):
            self.close_connection=True
        except Problem as exc:
            raw=canonical({"ok":False,"error":exc.record()})
            self.response_headers(exc.status,"application/json; charset=utf-8",len(raw))
            self.wfile.write(raw)
        except Exception as exc:
            sys.stderr.write(json.dumps({"event":"request_error","type":type(exc).__name__,"message":str(exc)})+"\n")
            raw=canonical({"ok":False,"error":{"code":"OPERATION_FAILED","message":"The operation did not return a complete result. Recover the retained request before retrying.","details":None}})
            self.response_headers(500,"application/json; charset=utf-8",len(raw))
            self.wfile.write(raw)
    def read(self,path,parts,query):
        store=self.server.store
        if path=="/api/session":
            return self.send_json(store.session(self.token()))
        if not path.startswith("/api/"):
            files={"/":"index.html","/index.html":"index.html","/app.js":"app.js","/style.css":"style.css"}
            need(path in files,"NOT_FOUND","The requested page was not found.",404)
            selected=store.app_root/"web"/files[path]
            need(selected.is_file() and not selected.is_symlink(),"PAGE_UNAVAILABLE","The application page is unavailable.",404)
            raw=selected.read_bytes()
            mime=mimetypes.guess_type(selected.name)[0] or "application/octet-stream"
            self.response_headers(200,mime+"; charset=utf-8",len(raw))
            return self.wfile.write(raw)
        user=self.user()
        listing={
            "/api/dashboard":lambda:store.dashboard(user),
            "/api/suppliers":lambda:store.suppliers(user),
            "/api/users":lambda:store.users(user),
            "/api/submissions":lambda:store.submissions(user,query),
            "/api/products":lambda:store.products(user,query.get("all")=="true"),
            "/api/mappings":lambda:store.mappings(user),
            "/api/releases":lambda:store.releases(user),
            "/api/audit":lambda:store.audit(user),
            "/api/notifications":lambda:store.notifications(user),
        }
        if path in listing:
            return self.send_json(listing[path]())
        if path=="/api/backup":
            return self.send_file(*store.backup(user))
        if len(parts)==3 and parts[:2]==["api","requests"]:
            return self.send_json(store.request(user,parts[2]))
        if len(parts)>=3 and parts[:2]==["api","submissions"]:
            if len(parts)==3:
                return self.send_json(store.submission(user,parts[2]))
            if len(parts)==4 and parts[3]=="download":
                return self.send_file(*store.original(user,parts[2]))
            if len(parts)==4 and parts[3]=="original":
                value=store.submission(user,parts[2])
                return self.send_json({k:value[k] for k in ("id","filename","source_sha256","source_bytes","source_label","provenance","members")})
        if len(parts)==3 and parts[:2]==["api","products"]:
            return self.send_json(store.product(user,parts[2]))
        if len(parts)>=3 and parts[:2]==["api","releases"]:
            if len(parts)==3:
                return self.send_json(store.release(user,parts[2]))
            if len(parts)==4 and parts[3]=="download":
                return self.send_file(*store.release_file(user,parts[2]))
        raise Problem("NOT_FOUND","The requested record or route was not found.",404)
    def change(self,path,parts,payload):
        store=self.server.store
        if path=="/api/setup":
            user,token=store.setup(payload)
            return self.send_json(user,201,cookie=token)
        if path=="/api/login":
            self.server.rate_login(payload.get("email") if isinstance(payload.get("email"),str) else "")
            user,token=store.login(payload)
            return self.send_json(user,cookie=token)
        if path=="/api/logout":
            return self.send_json(store.logout(self.token()),cookie="")
        user=self.user()
        if path=="/api/mappings/preview":
            return self.send_json(store.preview_mapping(user,payload))
        actions={
            "/api/suppliers":lambda:store.create_supplier(user,payload),
            "/api/users":lambda:store.create_user(user,payload),
            "/api/submissions":lambda:store.import_source(user,payload),
            "/api/submissions/manual":lambda:store.import_source(user,payload,manual=True),
            "/api/mappings":lambda:store.create_mapping(user,payload),
            "/api/releases":lambda:store.create_release(user,payload),
            "/api/mfa/enroll":lambda:store.mfa_enroll(user),
            "/api/mfa/confirm":lambda:store.mfa_confirm(user,payload),
            "/api/restore":lambda:store.restore(user,payload),
        }
        action=actions.get(path)
        if len(parts)==3 and parts[:2]==["api","users"]:
            action=lambda:store.update_user(user,parts[2],payload)
        if len(parts)==4 and parts[:2]==["api","submissions"] and parts[3]=="review":
            action=lambda:store.review(user,parts[2],payload)
        if len(parts)==4 and parts[:2]==["api","releases"] and parts[3]=="ack":
            action=lambda:store.acknowledge(user,parts[2],payload)
        if len(parts)==4 and parts[:2]==["api","notifications"] and parts[3]=="read":
            action=lambda:store.mark_read(user,parts[2])
        need(action is not None,"NOT_FOUND","The requested action was not found.",404)
        result=store.change(user,path,payload,self.headers.get("Idempotency-Key"),action)
        return self.send_json(result)

def main():
    if len(sys.argv)>1 and sys.argv[1]=="receive":
        parser=argparse.ArgumentParser(description="Receive a complete private workspace with this trusted installed code.")
        parser.add_argument("command");parser.add_argument("archive",type=Path)
        parser.add_argument("--directory",required=True,type=Path)
        parser.add_argument("--sha256",required=True)
        args=parser.parse_args()
        need(0<args.archive.stat().st_size<=MAX_UPLOAD,"PROJECT_SIZE","Choose a complete project up to 48 MiB.",413)
        raw=args.archive.read_bytes()
        need(re.fullmatch(r"[a-f0-9]{64}",args.sha256) is not None and digest(raw)==args.sha256,
             "SOURCE_HASH","The incoming archive differs from the selected exact SHA-256.")
        print(json.dumps(receive(raw,args.directory,Path(__file__).parent),indent=2))
        return
    parser=argparse.ArgumentParser(description="Open the local supplier content operations workspace.")
    parser.add_argument("--state",required=True,type=Path)
    parser.add_argument("--port",type=int,default=0)
    args=parser.parse_args()
    need(0<=args.port<=65535,"PORT","Use an available port, or zero for automatic assignment.")
    store=Store(args.state)
    try:
        server=Server(("127.0.0.1",args.port),store)
    except BaseException:
        store.close()
        raise
    def stop(signum,frame):
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    print(json.dumps({"status":"ready","url":"http://127.0.0.1:"+str(server.server_address[1]),
                      "state":str(store.root),"schema":"supplier-content-workbench.v1"}),flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        try:
            server.server_close()
        finally:
            store.close()

if __name__=="__main__":
    try:main()
    except Problem as exc:
        print(json.dumps({"ok":False,"error":exc.record()}),file=sys.stderr)
        sys.exit(2)
