"""MIT. Human Services Directory over the complete original Gravity workspace."""
from __future__ import annotations
from pathlib import Path
import re
import stat
import os
import hashlib
import tempfile
from directory_runtime import (BaseWorkspace,InputError,ConflictError,source,now,
    private_directory,safe_read,original_workspace)
import directory_schema as schema
from directory_source import DirectorySources
from directory_mapping import DirectoryMapping
from directory_selection import DirectorySelection
from directory_referral import DirectoryReferral
from directory_receiving import DirectoryReceiving
from directory_conformance import DirectoryConformance
from directory_operating_plans import DirectoryOperatingPlans
from directory_operating_returns import DirectoryOperatingReturns
from directory_corrections import DirectoryCorrections
from directory_correction_worksheets import DirectoryCorrectionWorksheets
from directory_correction_worksheet_reconciliation import DirectoryWorksheetReconciliation

def digest(kind,record):
    return source.sha(source.jbytes({"kind":kind,"value":{k:v for k,v in record.items()if k not in {"id","createdAt"}}}))

def clean_record(kind,record):
    if kind not in schema.KINDS or not isinstance(record,dict):raise InputError("Unknown directory collection or original record")
    ident=schema.token(record.get("id")) if kind in schema.MUTABLE else source.identity(record.get("id"))
    if kind not in schema.MUTABLE and digest(kind,record)!=ident:
        raise InputError("Original directory record differs from its complete content identity")
    if kind=="acquisitions" and record.get("operationId")!=ident:
        raise InputError("The native acquisition must retain its original operation identity")
    return record

class Workspace(DirectoryWorksheetReconciliation,DirectoryCorrectionWorksheets,DirectoryCorrections,DirectoryOperatingReturns,DirectoryOperatingPlans,DirectoryConformance,DirectoryReceiving,DirectoryReferral,DirectorySelection,DirectoryMapping,DirectorySources,BaseWorkspace):
    def __init__(self,root,create=False,credentials_file=None):
        super().__init__(root,create=create,credentials_file=credentials_file)
        try:
            private_directory(self.root/"directory")
            self.db.execute("""CREATE TABLE IF NOT EXISTS directory_records(
                kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,
                PRIMARY KEY(kind,id))""")
            self.db.commit()
            self.init_directory_sources()
        except Exception:
            self.close();raise

    def directory_catalogue(self):return schema.catalogue()
    def directory_guidance(self):return schema.guidance()

    def directory_record(self,kind,ident,required=True):
        if kind not in schema.KINDS:raise InputError("Unknown retained directory collection")
        ident=schema.token(ident) if kind in schema.MUTABLE else source.identity(ident)
        with self.mutex:
            row=self.db.execute("SELECT body FROM directory_records WHERE kind=? AND id=?",(kind,ident)).fetchone()
            if row is None:
                if required:raise InputError("Unknown original directory "+kind+" record")
                return None
            return clean_record(kind,source.json_value(row[0]))

    def directory_records(self,kind,offset=None,limit=50,query=""):
        if kind not in schema.KINDS:raise InputError("Unknown original directory collection")
        if not isinstance(query,str)or len(query)>1000:raise InputError("Record query must be at most1,000 characters")
        with self.mutex:
            if offset is None:
                total=self.db.execute("SELECT COALESCE(sum(length(CAST(body AS BLOB))),0) FROM directory_records WHERE kind=?",(kind,)).fetchone()[0]
                if total>schema.MAX_RECORD:raise InputError("Complete collection exceeds64MiB; use original paginated records and complete files")
            else:
                source.integer(offset,0,10000000,"Page offset");source.integer(limit,1,250,"Page size")
            selected=[];matched=0;used=0;page_full=False
            for row in self.db.execute("SELECT body FROM directory_records WHERE kind=? ORDER BY created,id",(kind,)):
                body=row[0]
                if query and query.casefold()not in body.casefold():continue
                pos=matched;matched+=1
                if offset is not None and (pos<offset or len(selected)>=limit or page_full):continue
                record=clean_record(kind,source.json_value(body))
                if offset is None:selected.append(record);continue
                size=len(body.encode())
                if size>source.MAX_INTERACTIVE:
                    if selected:page_full=True;continue
                    raise InputError("Read this complete original record by ID or use its complete file; it exceeds the interactive page limit")
                if used+size>source.MAX_INTERACTIVE:page_full=True;continue
                selected.append(record);used+=size
            if offset is None:return selected
            # Every returned item is a contiguous original page. Once the byte
            # budget fills, later rows must not skip the first unreturned row.
            nxt=offset+len(selected)
            return {"rows":selected,"total":matched,"offset":offset,"limit":limit,
                "nextOffset":nxt if nxt<matched else None,"bytes":used,"byteBudget":source.MAX_INTERACTIVE}

    @staticmethod
    def _directory_rows_page(rows,offset=0,limit=50):
        source.integer(offset,0,10000000,"Page offset");source.integer(limit,1,250,"Page size")
        used=0;selected=[]
        for row in rows[offset:offset+limit]:
            size=len(source.lexical_json(row).encode())
            if size>source.MAX_INTERACTIVE:
                raise InputError("Open the complete original file for this row larger than the interactive page limit")
            if selected and used+size>source.MAX_INTERACTIVE:break
            selected.append(row);used+=size
        nxt=offset+len(selected)
        return {"rows":selected,"total":len(rows),"offset":offset,"limit":limit,
            "nextOffset":nxt if nxt<len(rows)else None,"bytes":used,"byteBudget":source.MAX_INTERACTIVE}

    def _directory_save(self,kind,record):
        clean_record(kind,record);raw=source.jbytes(record)
        if len(raw)>schema.MAX_RECORD:raise InputError("One complete retained directory record exceeds64MiB")
        with self.mutex:
            old=self.directory_record(kind,record["id"],required=False)
            if old and kind not in schema.MUTABLE and source.jbytes(old)!=raw:
                raise ConflictError("An original directory content ID is already bound to another complete record")
            with self.db:
                self.db.execute("""INSERT INTO directory_records VALUES(?,?,?,?)
                    ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body""",
                    (kind,record["id"],raw.decode(),record.get("createdAt",now())))
        return record

    def _directory_store(self,kind,value):
        if kind in schema.MUTABLE or "id"in value or "createdAt"in value:
            raise InputError("Immutable directory input leaves its identity and creation time to the original store")
        ident=digest(kind,value)
        return self.directory_record(kind,ident,required=False) or self._directory_save(kind,{"id":ident,**value,"createdAt":now()})

    def _directory_file_path(self,descriptor):
        ident=source.identity(descriptor.get("sha256"))
        size=source.integer(descriptor.get("bytes"),0,2147483648,"Directory retained file size")
        path=self.root/"eltss"/"files"/(ident+".bin")
        original_workspace.regular(path,2147483648)
        if path.stat().st_size!=size or original_workspace.file_digest(path,2147483648)!=ident:
            raise InputError("The retained complete directory file differs from its original bytes")
        return path

    def _directory_retain_file(self,path,role):
        """Retain a complete Directory file in the original private object store."""
        path=Path(path)
        if not isinstance(role,str)or not role:raise InputError("The complete original file requires its receiving role")
        size=original_workspace.regular(path,2147483648).st_size
        ident=original_workspace.file_digest(path,2147483648)
        destination=self.root/"eltss"/"files"/(ident+".bin")
        with self.mutex:
            if destination.exists():
                if original_workspace.regular(destination,2147483648).st_size!=size or original_workspace.file_digest(destination,2147483648)!=ident:
                    raise InputError("Original Directory file identity was changed")
            else:
                fd,tmp=tempfile.mkstemp(prefix=".directory-retain-",dir=destination.parent)
                try:
                    digest=hashlib.sha256();count=0
                    with path.open("rb")as inp,os.fdopen(fd,"wb")as out:
                        os.fchmod(out.fileno(),0o600)
                        while block:=inp.read(65536):
                            count+=len(block)
                            if count>size:raise InputError("Original file grew during complete receiving")
                            digest.update(block);out.write(block)
                        out.flush();os.fsync(out.fileno())
                    if count!=size or digest.hexdigest()!=ident:raise InputError("Original file changed during complete receiving")
                    try:os.link(tmp,destination)
                    except FileExistsError:
                        if original_workspace.regular(destination,2147483648).st_size!=size or original_workspace.file_digest(destination,2147483648)!=ident:
                            raise InputError("Another original retained file has conflicting bytes")
                    original_workspace.sync_dir(destination.parent)
                finally:
                    try:os.unlink(tmp)
                    except FileNotFoundError:pass
        return {"sha256":ident,"bytes":size,"role":role}

    def save_directory_import(self,raw):
        native=source.json_value((Path(__file__).parent/"directory-source-schema.json").read_bytes())
        import copy
        profile=copy.deepcopy(schema.validate(raw,native["inputSchemas"]["import"],"Complete original source import profile"))
        return self._directory_store("importProfiles",{"profile":profile})

    def import_directory_profile(self,ident,path):
        profile=self.directory_record("importProfiles",ident)
        return self.directory_import(path,profile["profile"])

    def directory_state(self):
        fields={
            "connections":["label","protocol","baseUrl","authProfile"],
            "discoveries":["connectionId","operationId","declaredVersion","profile","openapiUrl","capabilities","url"],
            "requests":["label","connectionId","discoveryId","route","connectionSnapshot","scope"],
            "sources":["label","format","origin","scope","inventory","originalFile","indexFile"],
            "editions":["label","sourceIds","predecessorId","scope","inventory","actor"],
            "comparisons":["label","beforeEditionId","afterEditionId","summary","counts","actor"],
            "acquisitions":["operationId","state","phase","requestId","connectionId","sourceId","discoveryId","updatedAt","notBefore","receivedBytes","receivedRecords","receivedRows","pageCount","decodedBytes","error"],
            "mappings":["label","editionId","predecessorId","mode","identitySystem","referenceBase","actor"],
            "mappingPreviews":["mappingId","editionId","summary","reportFile","bundleFile","fieldMapFile"],
            "sourceConversions":["label","editionId","mappingId","previewId","sourceId","summary","actor"],
            "selections":["label","editionId","conversionId","predecessorId","chosenRefs","summary","actor"],
            "referralJoins":["label","selectionId","conversionId","sourceEditionId","successorEditionId","sourceId","graphId","summary","actor"],
            "handoffs":["label","selectionId","conversionId","referralJoinId","owner","recipient","requestSha256","actor"],
            "exports":["label","kind","recordId","name","file","actor"],
            "receivingReviews":["label","handoffId","archiveSha256","disposition","owner","actor"],
            "receives":["state","archiveSha256","workspaceId","kind","handoffId","updatedAt","error"],
            "importProfiles":["profile"],
            "correctionWorksheets":["schema","workspaceId","label","editionId","actor","note","predecessorId","summary","files"],
            "correctionWorksheetImports":["schema","workspaceId","worksheetId","actor","filename","expectedSha256","expectedBytes","note","files"],
            "correctionWorksheetReturns":["schema","workspaceId","importId","worksheetId","editionId","actor","returnedBy","returnedAt","note","summary","files"],
            "correctionWorksheetReviews":["schema","workspaceId","label","actor","note","returnId","worksheetId","editionId","planId","outcome","summary","files"],
            "correctionWorksheetReconciliations":["schema","workspaceId","label","actor","note","returnId","worksheetId","baseEditionId","currentEditionId","predecessorId","summary","files"],
            "correctionWorksheetReconciliationReviews":["schema","workspaceId","label","actor","note","reconciliationId","returnId","worksheetId","baseEditionId","currentEditionId","predecessorId","planId","outcome","summary","files"],
            "correctionPlans":["schema","label","editionId","predecessorId","actor","note","summary","files"],
            "correctionPreviews":["schema","planId","editionId","candidateEditionId","comparisonId","sources","summary","files"],
            "corrections":["schema","stage","planId","previewId","editionId","beforeEditionId","expectedEditionId","comparisonId","sources","actor","summary","files"],
            "operatingPlanReturns":["schema","workspaceId","stage","reviewId","planId","currentRecordId","predecessorRecordId","appliedPlanRecordId","action","requestSha256","summary","reviewDetails","files","actor"],
            "operatingPlans":["schema","workspaceId","stage","planId","revision","predecessorRecordId","preparedFromId","originRecordId","action","requestSha256","summary","files","actor"],
            "conformancePlans":["label","actor","subjectKind","subjectId","family","tables","profileDisposition"],
            "conformanceAssessments":["label","actor","planId","subjectKind","subjectId","family","summary","files"],
            "conformanceReviews":["label","actor","assessmentId","disposition","predecessorId","summary","files"],
            "conformanceComparisons":["label","actor","beforeAssessmentId","afterAssessmentId","summary","files"]}
        result={"schema":schema.SCHEMA,"workspaceId":self.workspace_id,"collections":{}}
        budget=source.MAX_INTERACTIVE-32768;used=0
        with self.mutex:
            for kind,selected in fields.items():
                total=self.db.execute("SELECT count(*) FROM directory_records WHERE kind=?",(kind,)).fetchone()[0]
                kept=[]
                for ident,created,body_bytes,body in self.db.execute(
                    "SELECT id,created,length(CAST(body AS BLOB)),CASE WHEN length(CAST(body AS BLOB))<=? THEN body ELSE NULL END FROM directory_records WHERE kind=? ORDER BY created,id",
                    (source.MAX_INTERACTIVE,kind)):
                    if body is None:
                        row={"id":ident,"createdAt":created,"recordBytes":body_bytes,"completeRecordRequired":True}
                    else:
                        r=source.json_value(body);row={k:r.get(k)for k in ["id","createdAt"]+selected}
                    n=len(source.jbytes(row))
                    if used+n>budget:break
                    used+=n;kept.append(row)
                result[kind]=kept
                result["collections"][kind]={"total":total,"returned":len(kept),"nextOffset":len(kept)if len(kept)<total else None}
        result["viewBytes"]=used;result["byteBudget"]=source.MAX_INTERACTIVE
        return result

    def state(self):
        result=super().state();result["directory"]=self.directory_state();return result

    def directory_guidance_file(self,member=None):
        root=Path(__file__).parent
        if not member:return root/"directory-original-source.json",{"filename":"Directory_Original_Sources.json","contentType":"application/json"}
        original=source.json_value((root/"directory-original-source.json").read_bytes())
        for selected in original["sources"]:
            for file in selected["files"]:
                if selected["id"]+"/"+file["path"]==member:
                    with self.scratch()as temp:
                        path=Path(temp)/"original-source";original_workspace.private_write(path,file["content"].encode())
                        retained=self._retain_file(path,"complete-original-directory-guidance")
                    return self._directory_file_path(retained),{"filename":Path(file["path"]).name,"contentType":"text/plain; charset=utf-8"}
        raise InputError("Choose an exact retained original source member")
