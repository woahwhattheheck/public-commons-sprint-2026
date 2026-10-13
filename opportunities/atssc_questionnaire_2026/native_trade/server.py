#!/usr/bin/env python3
"""Loopback browser operation with scoped operator/respondent sessions."""
import argparse
import base64
import html
import json
import secrets
import time
import tempfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlparse,quote

from questionnaire_workspace import OperationError,Workspace

SOURCE = Path(__file__).resolve().parent
RESPONDENT_METHODS = {"get_respondent","workbook_answers","submit_revision","save_progress","import_workbook","inspect_workbook","outreach.respondent_contact","outreach.update_respondent_contact","calculate_workbook","language.get_preference","language.set_preference","language.get_translations"}
REPORT_MIMES = {"json":"application/json; charset=utf-8","csv":"text/csv; charset=utf-8","html":"text/html; charset=utf-8","pdf":"application/pdf","docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace",required=True)
    parser.add_argument("--port",type=int,default=0)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    sessions = {}
    failures = {}
    cookie_name = "atssc_"+workspace.op_status({})["workspace_id"].replace("-","")[:20]
    server = None

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass

        def send(self,status,data,content_type="application/json; charset=utf-8",extra=None):
            if isinstance(data,(dict,list)): data = json.dumps(data,ensure_ascii=False).encode()
            if isinstance(data,str): data = data.encode()
            self.send_response(status)
            self.send_header("Content-Type",content_type)
            self.send_header("Content-Length",str(len(data)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("X-Frame-Options","DENY")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            for key,value in (extra or {}).items(): self.send_header(key,value)
            self.end_headers()
            self.wfile.write(data)

        def session(self):
            cookie = SimpleCookie()
            try: cookie.load(self.headers.get("Cookie",""))
            except Exception: return None
            item = cookie.get(cookie_name)
            record = None if item is None else sessions.get(item.value)
            if record and record["expires"] > time.time(): return record
            return None

        def allowed_host(self):
            return self.headers.get("Host") in {"127.0.0.1:"+str(server.server_port),"localhost:"+str(server.server_port)}

        def do_GET(self):
            try:
                if not self.allowed_host(): return self.send(403,{"error":"Invalid local host"})
                parsed = urlparse(self.path)
                path = parsed.path
                if path in {"/workbook-exchange", "/workbook-exchange/"}:
                    return self.send(200,(SOURCE/"workbook_exchange.html").read_bytes(),"text/html; charset=utf-8")
                if path in {"/workbook_exchange.mjs", "/workbook_exchange.css"}:
                    return self.send(200,(SOURCE/path[1:]).read_bytes(),"text/javascript; charset=utf-8" if path.endswith(".mjs") else "text/css; charset=utf-8")
                if path == "/respondent-operations/guide":
                    return self.send(200,(SOURCE/"RESPONDENT_OPERATIONS.md").read_bytes(),"text/plain; charset=utf-8")
                if path in {"/respondent-operations","/respondent-operations/","/respondent-operations/contact"} or path.startswith("/public/entry/"):
                    return self.send(200,(SOURCE/"respondent-operations.html").read_bytes(),"text/html; charset=utf-8")
                if path in {"/respondent-operations.mjs","/respondent-operations.css","/reporting-workbench.mjs","/source_formula.mjs","/locale.mjs"}:
                    return self.send(200,(SOURCE/path[1:]).read_bytes(),"text/javascript; charset=utf-8" if path.endswith(".mjs") else "text/css; charset=utf-8")
                if path == "/api/outreach/public":
                    token=parse_qs(parsed.query).get("token",[""])[0]
                    return self.send(200,workspace.outreach.public_info(token))
                if path.startswith("/api/outreach/files/"):
                    record=self.session()
                    if not record or record["role"]!="operator":return self.send(401,{"error":"Operator session required"})
                    resource=path.removeprefix("/api/outreach/files/").split("/")
                    if resource==["project.zip"]:
                        with tempfile.TemporaryDirectory(prefix="outreach-project-",dir=workspace.directory.parent) as temporary:
                            result=workspace.outreach.op_export_project({"path":str(Path(temporary)/"ATSSC_Complete_Project.zip")})
                            raw=Path(result["path"]).read_bytes()
                        filename,mime="ATSSC_Complete_Project.zip","application/zip"
                    elif len(resource)==1 and resource[0].startswith("operating."):
                        raw,filename,mime=workspace.outreach.file_bytes("operating",format_name=resource[0].split(".",1)[1])
                    elif len(resource)==3 and resource[0] in {"source","message"}:
                        raw,filename,mime=workspace.outreach.file_bytes(resource[0],resource[1],resource[2])
                    else:return self.send(404,{"error":"Operating download not found"})
                    return self.send(200,raw,mime,{"Content-Disposition":"attachment; filename*=UTF-8''"+quote(Path(filename).name,safe=""),"X-Content-SHA256":__import__("hashlib").sha256(raw).hexdigest()})
                if path.startswith("/api/workbooks/") and path.endswith(".xlsx"):
                    record=self.session()
                    if not record: return self.send(401,{"error":"Open the native workspace before downloading its workbook"})
                    sha=path.removeprefix("/api/workbooks/").removesuffix(".xlsx")
                    if record["role"]=="respondent":
                        respondent=workspace.op_get_respondent({"respondent_id":record["respondent_id"]})
                        if sha not in record["workbooks"] and sha not in respondent["definition"].get("source_workbooks",[]):
                            return self.send(403,{"error":"Download this respondent's original template or retained workbook"})
                    workbook=workspace.workbook(sha);raw=workspace.get_workbook_bytes(sha)
                    return self.send(200,raw,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",{"Content-Disposition":"attachment; filename*=UTF-8''"+quote(Path(workbook["name"]).name,safe=""),"X-Content-SHA256":sha})
                if path in {"/","/operator"} or path.startswith("/respondent/"):
                    return self.send(200,(SOURCE/"index.html").read_bytes(),"text/html; charset=utf-8")
                if path in {"/app.mjs","/style.css"}:
                    return self.send(200,(SOURCE/path[1:]).read_bytes(),"text/javascript; charset=utf-8" if path.endswith("mjs") else "text/css; charset=utf-8")
                if path == "/ui-fr.json":
                    return self.send(200,(SOURCE/"ui-fr.json").read_bytes())
                if path == "/api/session":
                    record = self.session()
                    return self.send(200,{"authenticated":bool(record),"role":None if not record else record["role"],"respondent_id":None if not record else record.get("respondent_id")})
                if path.startswith("/public/reports/"):
                    suffix = path.removeprefix("/public/reports/")
                    key,separator,fmt = suffix.partition(".")
                    fmt = fmt if separator else "html"
                    data = workspace.report_bytes(key,"public",fmt,public=True)
                    return self.send(200,data,REPORT_MIMES[fmt])
                if path.startswith("/api/respondents/"):
                    record = self.session()
                    parts = path.removeprefix("/api/respondents/").split("/")
                    if len(parts)!=4 or parts[1]!="documents": return self.send(404,{"error":"Response document endpoint not found"})
                    key,_,edition,fmt = parts
                    if not record or record["role"]!="operator" and record.get("respondent_id")!=key:
                        return self.send(401,{"error":"Open the respondent's own session"})
                    data = workspace.response_bytes(key,edition,fmt)
                    return self.send(200,data,REPORT_MIMES[fmt],{"Content-Disposition":"attachment; filename="+edition+"-response."+fmt})
                if path.startswith("/api/reports/"):
                    record = self.session()
                    if not record or record["role"] != "operator": return self.send(401,{"error":"Operator session required"})
                    key,edition,fmt = path.removeprefix("/api/reports/").split("/")
                    data = workspace.report_bytes(key,edition,fmt)
                    return self.send(200,data,REPORT_MIMES[fmt],{"Content-Disposition":"attachment; filename="+edition+"."+fmt})
                return self.send(404,{"error":"Page not found"})
            except Exception as e: self.send(404 if getattr(e,"code","") == "NOT_FOUND" else 400,{"error":{"code":getattr(e,"code","REQUEST"),"message":str(e)}})

        def do_POST(self):
            try:
                if not self.allowed_host(): return self.send(403,{"error":"Invalid local host"})
                origin = self.headers.get("Origin")
                allowed = {"http://127.0.0.1:"+str(server.server_port),"http://localhost:"+str(server.server_port)}
                if origin not in allowed: return self.send(403,{"error":"Use the local application origin"})
                length = int(self.headers.get("Content-Length","0"))
                if not 0 < length <= 90*1024*1024: return self.send(413,{"error":"Request body exceeds the workbook limit"})
                data = json.loads(self.rfile.read(length))
                if self.path == "/api/outreach/public-entry":
                    if length>1024*1024:return self.send(413,{"error":"Registration information exceeds its form limit"})
                    bucket="public:"+self.client_address[0]
                    count,expires=failures.get(bucket,(0,0))
                    if expires<time.time():count,expires=0,time.time()+60
                    if count>=20:return self.send(429,{"error":"Please try registration again shortly"})
                    failures[bucket]=(count+1,expires)
                    return self.send(200,{"result":workspace.invoke("outreach.public_enter",{**data,"_actor":{"role":"public_registration"}})})
                if self.path == "/api/session":
                    if failures.get(self.client_address[0],(0,0))[1] > time.time(): return self.send(429,{"error":"Try the access code again shortly"})
                    role = data.get("role")
                    respondent_id = data.get("respondent_id") if role == "respondent" else None
                    if role not in {"operator","respondent"} or role == "respondent" and not respondent_id or not workspace.authorize(data.get("access_code"),respondent_id):
                        count = failures.get(self.client_address[0],(0,0))[0]+1
                        failures[self.client_address[0]] = (count,time.time()+30 if count >= 10 else 0)
                        return self.send(401,{"error":"Access code is incorrect"})
                    failures.pop(self.client_address[0],None)
                    key = secrets.token_urlsafe(36)
                    sessions[key] = {"role":role,"respondent_id":respondent_id,"expires":time.time()+12*3600,"workbooks":set()}
                    return self.send(200,{"authenticated":True,"role":role,"respondent_id":respondent_id},{"operator":"application/json; charset=utf-8","respondent":"application/json; charset=utf-8"}[role],{"Set-Cookie":cookie_name+"="+key+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"})
                record = self.session()
                if not record: return self.send(401,{"error":"Open a local session with the access code"})
                if self.path == "/api/logout":
                    record["expires"] = 0
                    return self.send(200,{"authenticated":False},extra={"Set-Cookie":cookie_name+"=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
                if self.path != "/api/invoke": return self.send(404,{"error":"Operation endpoint not found"})
                method,params = data.get("method"),data.get("params",{})
                if record["role"] == "respondent":
                    if method not in RESPONDENT_METHODS: return self.send(403,{"error":"This operation requires the operator"})
                    if method in {"get_respondent","workbook_answers","submit_revision","save_progress","outreach.respondent_contact","outreach.update_respondent_contact","language.get_translations"}:
                        if params.get("respondent_id") != record["respondent_id"]: return self.send(403,{"error":"Open this respondent's own record"})
                    if method in {"inspect_workbook","workbook_answers"} and params.get("sha256") not in record["workbooks"]: return self.send(403,{"error":"Use an original workbook uploaded in this session"})
                    if method == "submit_revision" and params.get("workbook_sha256") and params["workbook_sha256"] not in record["workbooks"]: return self.send(403,{"error":"Upload this respondent's own workbook before submitting"})
                    if method == "calculate_workbook":
                        if params.get("workbook_sha256") not in record["workbooks"]: return self.send(403,{"error":"Calculate this respondent's own uploaded workbook"})
                        if any(k in params for k in ("soffice_command","output_directory","java_command","uno_jar")): return self.send(403,{"error":"Native runtime settings belong to the operator host"})
                        if params.get("respondent_id") not in {None,record["respondent_id"]}: return self.send(403,{"error":"Use this respondent's own published questionnaire"})
                        params["respondent_id"]=record["respondent_id"]
                params["_actor"] = {"role":record["role"],"respondent_id":record.get("respondent_id")}
                result = workspace.invoke(method,params)
                if method in {"submit_revision","review_revision"}:
                    profile=workspace.outreach.op_status({}).get("profile") or {}
                    if profile.get("automatic_notifications"):
                        try:
                            trigger=(result.get("review_id") if method=="review_revision" else result.get("revision_id")) or __import__("hashlib").sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
                            notices=workspace.invoke("outreach.sync_notifications",{"request_id":"native-notices:"+method+":"+trigger,"actor":"original questionnaire response","reason":"Prepare configured notices from the committed response","automatic":True,**({"respondent_id":params["respondent_id"]} if method=="submit_revision" else {}),"expected_revision":workspace.outreach.op_status({})["revision"],"_actor":{"role":"configured_notification_worker","origin_method":method}})
                            visible_notices=notices if record["role"]=="operator" else {"state":"PREPARED","prepared_count":len(notices.get("messages",[])),"review_count":len(notices.get("skipped",[]))}
                            result={**result,"notifications":visible_notices}
                        except Exception as notice_error:
                            result={**result,"notifications":{"state":"REVIEW","code":getattr(notice_error,"code","REQUEST"),"message":str(notice_error) if record["role"]=="operator" else "Staff will review the original notification settings.","continuation":"Review the configured response notice in Companies and communications."}}
                if method == "import_workbook": record["workbooks"].add(result["sha256"])
                if method == "calculate_workbook" and result.get("calculated_sha256"): record["workbooks"].add(result["calculated_sha256"])
                if method == "get_respondent" and record["role"] == "respondent":
                    result["revisions"] = result["revisions"][-1:]
                    for revision in result["revisions"]:
                        revision["comparison"] = {"answerChanges":[],"answerChangeCount":0}
                return self.send(200,{"result":result})
            except Exception as e:
                self.send(409 if getattr(e,"code","") == "VERSION_CONFLICT" else 400,{"error":{"code":getattr(e,"code","REQUEST"),"message":str(e),"detail":getattr(e,"detail",None)}})

    server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    address = "http://127.0.0.1:"+str(server.server_port)
    keyfile = workspace.directory/"operator-key.txt"
    print(json.dumps({"url":address,"workspace_id":workspace.op_status({})["workspace_id"],"operator_key_file":str(keyfile)}),flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__": main()
