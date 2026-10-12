"""MIT. Original private local operator for complete utility data receiving."""
from __future__ import annotations
from pathlib import Path
import os
import shutil
import uuid
from urllib.parse import parse_qs,unquote

from utility_shared import HERE,RetainedHandler,RetainedServer,InputError,load_json,file_digest
from utility_source import MAX_BYTES,sha
from utility_delivery import MAX_PACKET

class Handler(RetainedHandler):
    server_version="Starforge-Utility"

    def _get(self):
        target=self._gate(api=False)
        assets={"/":("index.html","text/html; charset=utf-8"),
            "/app.js":("app.js","text/javascript; charset=utf-8"),
            "/style.css":("style.css","text/css; charset=utf-8")}
        if target.path in assets:
            name,media=assets[target.path]
            data=(self.server.assets_directory/name).read_bytes()
            self._headers(200,media,len(data));self.wfile.write(data);return
        self._gate()
        query=parse_qs(target.query,keep_blank_values=True)
        if any(len(value)!=1 for value in query.values()):raise InputError("Use one value for each query parameter")
        q={key:value[0] for key,value in query.items()};ws=self.server.workspace
        route=target.path
        if route=="/api/state":self._json(ws.state())
        elif route=="/api/import":self._json(ws.saved("imports",q["id"]))
        elif route=="/api/record":self._json(ws.record(q["id"]))
        elif route=="/api/series":self._json(ws.series(q["imports"].split(",") if q.get("imports") else None))
        elif route=="/api/records":
            self._json(ws.records(q.get("kind","interval"),import_ids=q["imports"].split(",") if q.get("imports") else None,
                meter=q.get("meter"),series=q.get("series"),offset=int(q.get("offset","0")),
                limit=int(q.get("limit","100")),full=q.get("full")=="true"))
        elif route=="/api/original":
            imported=ws.saved("imports",q["id"]);path=ws.original(q["id"])
            self._download(path,imported["original_name"],"application/xml" if imported["provider"]=="greenbutton" else "application/json")
        elif route in {"/api/preview","/api/review","/api/reconciliation","/api/capture"}:
            table={"/api/preview":"previews","/api/review":"reviews","/api/reconciliation":"reconciliations","/api/capture":"captures"}[route]
            self._json(ws.saved(table,q["id"]))
        elif route=="/api/build":self._json(ws.build_view(q["id"]))
        elif route=="/api/operation":self._json(ws.operation(q["id"]))
        elif route=="/api/operations":self._json({"operations":ws.all("actions")})
        elif route=="/api/changes":
            self._json(ws.comparison_page(q["id"],int(q.get("offset","0")),int(q.get("limit","100"))))
        elif route=="/api/changes/download":
            self._download(ws.comparison_file(q["id"]),"utility-edition-changes.ndjson","application/x-ndjson")
        elif route=="/api/export":self._json(ws.verify_export(q["id"]))
        elif route=="/api/export-file":
            selected=ws.export_file(q["id"],q["name"]);self._download(selected["path"],selected["filename"])
        elif route in {"/api/export-zip","/api/portable","/api/native-project"}:
            with ws.mutex,ws.scratch() as temp:
                path=temp/"output.zip"
                if route=="/api/export-zip":
                    ws.export_zip(q["id"],path);name="utility-customer-delivery.zip"
                elif route=="/api/portable":
                    ws.portable(path);name="utility-workspace.zip"
                else:
                    ws.export_packet(q["id"],path);name="native-project.zip"
                self._download(path,name,"application/zip")
        elif route=="/api/publisher-state":
            self._json(ws.publisher.call("publisher.state",{}))
        elif route=="/api/publisher-export":
            with ws.mutex:
                selected=ws.publisher.call("publisher.export",{"kind":q["kind"],"id":q["id"]})
                path=Path(selected["path"])
                if file_digest(path,MAX_PACKET)!=selected["sha256"]:raise InputError("Original publisher export changed")
                self._download(path,selected["filename"],selected.get("contentType","application/octet-stream"))
        else:self._json({"error":"Unknown utility operator route"},404)

    def _post(self):
        target=self._gate();ws=self.server.workspace
        if target.path in {"/api/upload","/api/restore"}:
            name=unquote(self.headers.get("X-Utility-Name","Original utility source"))
            expected=self.headers.get("X-Utility-Revision")
            request_id=self.headers.get("X-Utility-Request-Id") or str(uuid.uuid4())
            with ws.mutex,ws.scratch() as temp:
                path=temp/("source" if target.path=="/api/upload" else "workspace.zip")
                reader=self._body(MAX_BYTES if target.path=="/api/upload" else MAX_PACKET)
                with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                    shutil.copyfileobj(reader,out,65536);out.flush();os.fsync(out.fileno())
                payload={"path":str(path),"sha256":file_digest(path,MAX_PACKET)}
                if target.path=="/api/upload":
                    payload.update(name=name,provider=self.headers.get("X-Utility-Provider","auto"),
                        kind=self.headers.get("X-Utility-Kind","auto"))
                    context=self.headers.get("X-Utility-Context")
                    if context:payload["context"]=load_json(unquote(context))
                action="source.import" if target.path=="/api/upload" else "package.restore"
                self._json(ws.act(action,payload,int(expected) if expected is not None else None,request_id),201)
            return
        if target.path=="/api/action":
            body=load_json(self._body(16*1024*1024).read())
            if not isinstance(body,dict) or set(body)-{"action","payload","expected_revision","request_id"}:
                raise InputError("Use the original named workspace operation")
            self._json(ws.act(body["action"],body.get("payload"),body.get("expected_revision"),body.get("request_id")))
        else:self._json({"error":"Unknown utility operator route"},404)

class OperatorServer(RetainedServer):
    def __init__(self,workspace,port=0):
        super().__init__(workspace,port,assets_directory=HERE/"public",handler_class=Handler)
