"""MIT. Borrowed authenticated console for the original registry/source workspace."""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit, parse_qs, unquote
import uuid

from clinical_shared import HERE, RetainedHandler, RetainedServer, InputError, json_bytes, load_json, file_digest, sync_dir
from clinical_workspace import Workspace, checked_sha
import clinical_prs as prs
from clinical_package import MAX_PACKET

CONTRACTS={"api-contract.json","clinicaltrials-openapi.yaml","ProtocolRecordSchema.xsd","RRSUploadSchema.xsd","source-contracts.json"}

def media(path):
    suffix=Path(path).suffix.lower()
    return {".json":"application/json; charset=utf-8",".ndjson":"application/x-ndjson",
            ".jsonl":"application/x-ndjson",".xml":"application/xml",".xsd":"application/xml",
            ".yaml":"application/yaml",".csv":"text/csv; charset=utf-8",".md":"text/markdown; charset=utf-8",
            ".zip":"application/zip"}.get(suffix,mimetypes.guess_type(str(path))[0] or "application/octet-stream")

class Handler(RetainedHandler):
    server_version="SF30-ClinicalTrials"

    def setup(self):
        super().setup()
        self.connection.settimeout(600)

    def _query(self):
        target=self._gate()
        rows=parse_qs(target.query,keep_blank_values=True)
        if any(len(v)!=1 for v in rows.values()):raise InputError("Repeated query parameters are not accepted")
        return target,{k:v[0] for k,v in rows.items()}

    def _get(self):
        target=urlsplit(self.path)
        if target.path=="/publisher.mjs":
            self._gate(api=False)
            path=HERE.parent/"socrata"/"public"/"publisher.mjs"
            body=path.read_bytes()
            self._headers(200,"text/javascript; charset=utf-8",len(body));self.wfile.write(body);return
        if not target.path.startswith("/api/clinical/"):return super()._get()
        target,q=self._query();ws=self.server.workspace
        route=target.path
        if route=="/api/clinical/operation":
            self._json(ws.operation(q["requestId"]));return
        with ws.mutex:
            if route=="/api/clinical/capture":self._json(ws.capture_manifest(q.get("captureId")))
            elif route=="/api/clinical/studies":
                self._json(ws.studies(q.get("captureId"),int(q.get("offset","0")),int(q.get("limit","50")),q.get("query","")))
            elif route=="/api/clinical/study":self._json(ws.study(q["captureId"],q["nctId"]))
            elif route=="/api/clinical/study-compare":self._json(ws.study_compare(q["beforeId"],q["afterId"],q["nctId"]))
            elif route=="/api/clinical/prs":self._json(ws.prs_document(q["documentId"]))
            elif route=="/api/clinical/prs-plan":self._json(ws.prs_plan(q["planId"]))
            elif route=="/api/clinical/prs-reconciliation":self._json(ws.prs_reconciliation(q["reportId"]))
            elif route=="/api/clinical/prs-preview":self._json(ws.prs_preview(q["previewId"]))
            elif route=="/api/clinical/prs-catalog":self._json(ws.prs_catalog())
            elif route=="/api/clinical/export":
                exported=ws.read_export(q["exportId"],q["file"])
                self._download(exported["path"],exported["filename"],media(exported["filename"]))
            elif route=="/api/clinical/source-file":
                path=ws.source_file(q["captureId"],q["file"]);self._download(path,path.name,media(path))
            elif route=="/api/clinical/contract":
                if q["name"] not in CONTRACTS:raise InputError("Select one declared original source contract")
                path=HERE/"contracts"/q["name"];self._download(path,path.name,media(path))
            elif route=="/api/clinical/prs-file":
                ident=checked_sha(q["documentId"]);ws.prs_document(ident)
                if q["kind"] not in {"xml","report"}:raise InputError("Choose the original XML or inspection report")
                suffix=".xml" if q["kind"]=="xml" else ".json"
                path=ws._verified("prs/"+ident+suffix,ident if suffix==".xml" else None,prs.MAX_XML)
                self._download(path,ident+suffix,media(path))
            elif route=="/api/clinical/publisher-export":
                exported=ws.publisher.call("publisher.export",{"kind":q["kind"],"id":q["id"]})
                path=Path(exported["path"])
                expected=ws.root/"publisher"/"operator-downloads"
                if path.parent.resolve()!=expected.resolve() or file_digest(path,512*1024*1024)!=exported["sha256"]:
                    raise InputError("Original publisher download changed")
                self._download(path,exported["filename"],exported["contentType"])
            else:self._json({"error":"Unknown ClinicalTrials route"},404)

    def _identity(self):
        for name in ["X-Request-Id","X-Expected-Revision"]:
            if len(self.headers.get_all(name,[]))!=1:raise InputError("Supply one "+name+" header")
        request_id=self.headers["X-Request-Id"]
        try:
            if str(uuid.UUID(request_id))!=request_id:raise ValueError()
        except (ValueError,TypeError):raise InputError("Use the original canonical request UUID")
        revision=self.headers["X-Expected-Revision"]
        if not revision.isdecimal():raise InputError("Expected revision must be an integer")
        return request_id,int(revision)

    def _upload(self,action):
        ws=self.server.workspace;request_id,revision=self._identity()
        maximum=MAX_PACKET if action=="package.import" else prs.MAX_XML
        suffix=".zip" if action=="package.import" else ".xml"
        name=unquote(self.headers.get("X-Clinical-Name","input"+suffix))
        if not name or Path(name).name!=name or len(name)>200:raise InputError("Use a short original filename")
        with ws.mutex,ws.scratch() as temp:
            incoming=temp/("incoming"+suffix)
            with os.fdopen(os.open(incoming,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                shutil.copyfileobj(self._body(maximum),out,1048576);out.flush();os.fsync(out.fileno())
            digest=file_digest(incoming,maximum)
            if self.headers.get("X-Clinical-Sha256") not in {None,digest}:
                raise InputError("Uploaded file differs from its declared SHA256")
            folder=ws.root/"uploads";folder.mkdir(mode=0o700,exist_ok=True)
            if folder.is_symlink() or not folder.is_dir():raise InputError("Use the original private upload directory")
            retained=folder/(request_id+suffix)
            if retained.exists():
                if file_digest(retained,maximum)!=digest:raise InputError("This request UUID retains different original upload bytes")
            else:os.replace(incoming,retained);sync_dir(folder)
            try:
                payload={"packagePath":str(retained),"sha256":digest} if action=="package.import" else {
                    "path":str(retained),"sha256":digest,"name":name,"schema":self.headers.get("X-Clinical-Schema","protocol")}
                result=ws.act(action,payload,revision,request_id)
                self._json(result,201)
            finally:
                retained.unlink(missing_ok=True)

    def _post(self):
        target=self._gate()
        ws=self.server.workspace
        if target.path=="/api/clinical/restore":return self._upload("package.import")
        if target.path=="/api/clinical/prs-upload":return self._upload("prs.import")
        if target.path=="/api/clinical/action":
            body=load_json(self._body(prs.MAX_XML+1024*1024).read())
            if not isinstance(body,dict) or set(body)!={"action","payload","expectedRevision","requestId"}:
                raise InputError("Supply action, payload, expectedRevision and the original requestId")
            if body["action"] in {"package.import","prs.import"}:
                raise InputError("Use the original file upload route for this action")
            self._json(ws.act(body["action"],body["payload"],body["expectedRevision"],body["requestId"]))
            return
        with ws.mutex:
            result=super()._post()
            # Preserve the unchanged source-engine API while exposing its mutations to Clinical CAS.
            if target.path in {"/api/source","/api/import","/api/plan","/api/build","/api/compare","/api/merchant","/api/query"}:
                ws._set("revision",ws._meta("revision",0)+1)
            return result

class OperatorServer(RetainedServer):
    """The caller owns workspace.close(); this server owns only its listener."""
    def __init__(self,workspace:Workspace,port:int=0):
        super().__init__(workspace,port,assets_directory=HERE/"public",handler_class=Handler)
