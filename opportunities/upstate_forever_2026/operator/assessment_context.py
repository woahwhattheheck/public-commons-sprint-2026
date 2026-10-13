"""Assessment geographic-context extension for the maintained operator queue."""
from pathlib import Path
from model import (assessment_context as model, assessment_report_context as report,
                   assessment_source_adoption as adoption)
from model.common import identifier, relative_file, verify_file

ACTIONS=frozenset(("assessment.context.build","assessment.context.receive",
                   "assessment.context.parcels","assessment.context.receive_parcels",
                   "assessment.context.report", "assessment.context.adopt_source"))

class AssessmentContext:
    def __init__(self,operator,fault):
        self.operator,self.Fault=operator,fault

    def state(self,workspace_key):
        ws=self.operator.ws(workspace_key)
        return [{key:row.get(key) for key in ("id","title","summary","created_at")}
                for row in ws._list(model.KIND)]

    def verify_workspace(self,workspace):
        return model.verify_workspace(workspace)

    def edition(self,workspace_key,key,complete=True,parcels=False):
        ws=self.operator.ws(workspace_key)
        inspect=model.inspect_parcels if parcels else model.inspect
        row=inspect(ws,identifier(key),include_result=complete)
        row["_downloads"]=[self.operator._ticket(workspace_key,relative_file(ws.root,item["path"]),
                           item,item.get("label") or Path(item["path"]).name) for item in row["files"]]
        return row

    def read(self,workspace_key,operation,payload=None):
        value=payload or {};ws=self.operator.ws(workspace_key)
        if operation=="catalog":
            return {**model.catalog(ws), "report_version": report.VERSION}
        if operation=="options":
            return model.options(ws,identifier(value.get("geography_id")))
        if operation in ("edition","parcels"):
            return self.edition(workspace_key,value.get("id"),parcels=operation=="parcels")
        raise self.Fault("ASSESSMENT_CONTEXT_READ","Choose a registered context operation.",422)

    def item(self,workspace_key,payload):
        return self.edition(workspace_key,payload.get("id") or payload.get("key"))

    def parcel_item(self,workspace_key,payload):
        return self.edition(workspace_key,payload.get("id") or payload.get("key"),parcels=True)

    def invoke(self,task):
        action=task.get("action");value=task.get("payload") or {}
        ws=self.operator.ws(task["workspace"])
        if action=="assessment.context.report":
            if "report_version" in value and value["report_version"] != report.VERSION:
                raise self.Fault("ASSESSMENT_REPORT_VERSION",
                    "Reload Assessment context before preparing the current report. "
                    "Earlier completed reports remain available in their original tasks.", 409)
            return report.prepare(ws,identifier(value.get("context_id")),
                parcel_id=value.get("parcel_id") or None, delivery_id=value.get("delivery_id") or None)
        if action=="assessment.context.adopt_source":
            return adoption.adopt_source(ws, value,
                max_extracted_bytes=self.operator.extraction_limit)
        if action=="assessment.context.build":
            result=model.build(ws,value.get("selection",value))
        elif action in ("assessment.context.receive","assessment.context.receive_parcels"):
            upload=self.operator.upload(identifier(value.get("upload_id")))
            receive=model.receive_parcels if action.endswith("receive_parcels") else model.receive
            result=receive(ws,upload["path"],max_extracted_bytes=self.operator.extraction_limit)
        elif action=="assessment.context.parcels":
            result=model.parcel_associations(ws,identifier(value.get("context_id")),
                                            identifier(value.get("study_id")))
        else:
            raise self.Fault("ASSESSMENT_CONTEXT_ACTION","Choose a registered context action.",422)
        return {key:result[key] for key in ("id","title","build_id","summary","source_collection_id",
                "source_id","context_source_binding","context_id","study_id","received_from") if key in result}

    def decorate_task(self,task):
        if task.get("action") not in ACTIONS or task.get("state")!="complete":
            return task
        result=task.get("result") or {}
        if task["action"]=="assessment.context.report":
            ws=self.operator.ws(task["workspace"])
            task.setdefault("_downloads",[]).extend(self.operator._ticket(task["workspace"],
                verify_file(ws.root,item),item,Path(item["path"]).name) for item in result.get("files",[]))
            task["_assessment_context"]={"id":result.get("context_id"),"view":"assessment-context",
                "report":True,"parcel_id":result.get("parcel_id")}
            return task
        if task["action"]=="assessment.context.adopt_source":
            row=self.edition(task["workspace"],result["context_id"],complete=False)
            task.setdefault("_downloads",[]).extend(row["_downloads"])
            if result.get("parcel_id"):
                parcel=self.edition(task["workspace"],result["parcel_id"],complete=False,parcels=True)
                task["_downloads"].extend(parcel["_downloads"])
            task["_assessment_context"]={"id":row["id"],"view":"assessment-context",
                "adopted":True,"parcel_id":result.get("parcel_id"),
                "station_geography_id":result["station_geography_id"]}
            return task
        if result.get("id"):
            parcels=task["action"] in ("assessment.context.parcels","assessment.context.receive_parcels")
            row=self.edition(task["workspace"],result["id"],complete=False,parcels=parcels)
            task.setdefault("_downloads",[]).extend(row["_downloads"])
            task["_assessment_context"]={"id":row["id"],"view":"assessment-context","parcels":parcels}
        return task
