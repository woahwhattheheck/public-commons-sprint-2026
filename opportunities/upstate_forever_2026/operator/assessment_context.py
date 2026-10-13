"""Assessment geographic-context extension for the maintained operator queue."""
from pathlib import Path
from model import assessment_context as model
from model.common import identifier, relative_file

ACTIONS=frozenset(("assessment.context.build","assessment.context.receive","assessment.context.criteria"))

class AssessmentContext:
    def __init__(self,operator,fault):
        self.operator,self.Fault=operator,fault

    def state(self,workspace_key):
        ws=self.operator.ws(workspace_key)
        return [{key:row.get(key) for key in ("id","title","summary","created_at")}
                for row in ws._list(model.KIND)]

    def edition(self,workspace_key,key,complete=True):
        ws=self.operator.ws(workspace_key)
        row=model.inspect(ws,identifier(key),include_result=complete)
        row["_downloads"]=[self.operator._ticket(workspace_key,relative_file(ws.root,item["path"]),
                           item,item.get("label") or Path(item["path"]).name) for item in row["files"]]
        return row

    def read(self,workspace_key,operation,payload=None):
        value=payload or {};ws=self.operator.ws(workspace_key)
        if operation=="catalog":
            return model.catalog(ws)
        if operation=="options":
            return model.options(ws,identifier(value.get("geography_id")))
        if operation=="edition":
            return self.edition(workspace_key,value.get("id"))
        raise self.Fault("ASSESSMENT_CONTEXT_READ","Choose a registered context operation.",422)

    def item(self,workspace_key,payload):
        return self.edition(workspace_key,payload.get("id") or payload.get("key"))

    def invoke(self,task):
        action=task.get("action");value=task.get("payload") or {}
        ws=self.operator.ws(task["workspace"])
        if action=="assessment.context.build":
            result=model.build(ws,value.get("selection",value))
        elif action=="assessment.context.receive":
            upload=self.operator.upload(identifier(value.get("upload_id")))
            result=model.receive(ws,upload["path"],max_extracted_bytes=self.operator.extraction_limit)
        elif action=="assessment.context.criteria":
            return model.prepare_parcel_criteria(ws,identifier(value.get("context_id")),
                identifier(value.get("study_id")),settings=value.get("settings"),sources=value.get("sources"))
        else:
            raise self.Fault("ASSESSMENT_CONTEXT_ACTION","Choose a registered context action.",422)
        return {key:result[key] for key in
                ("id","title","build_id","summary","source_collection_id","source_id","parcel_criteria_binding")}

    def decorate_task(self,task):
        if task.get("action") not in ACTIONS or task.get("state")!="complete":
            return task
        result=task.get("result") or {}
        if task["action"]=="assessment.context.criteria":
            task["_assessment_context"]={"study_id":result.get("study_id"),
                                        "criteria_operation_id":result.get("id")}
            files=list((result.get("files") or {}).values())
        elif result.get("id"):
            row=self.edition(task["workspace"],result["id"],complete=False)
            task.setdefault("_downloads",[]).extend(row["_downloads"])
            task["_assessment_context"]={"id":row["id"],"view":"assessment-context"}
            return task
        else:
            return task
        ws=self.operator.ws(task["workspace"])
        for item in files:
            if isinstance(item,dict) and {"path","sha256","bytes"}<=set(item):
                task.setdefault("_downloads",[]).append(self.operator._ticket(
                    task["workspace"],relative_file(ws.root,item["path"]),item,Path(item["path"]).name))
        return task
