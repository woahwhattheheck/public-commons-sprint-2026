"""MIT. Operate the complete original directory-to-Gravity receiving workflow.

Consumes an already-operated original Gravity workspace and unchanged published
directory inputs. Every authored mapping and service choice is labeled as a
receiving exercise; source bytes, native statuses and original UUID are retained.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import zipfile
from directory_runtime import BaseWorkspace,InputError,ConflictError,source,original_workspace,private_directory,atomic_json,now,write_zip
from directory_workspace import Workspace
from directory_domain import value,public_ref,ref_key
from directory_source import retained_file_descriptors
from operate_sources import exercise_directory_sources

OPERATION="SCF-HUMAN-SERVICES-DIRECTORY-RECEIVING-450E-20261012"
SCHEMA="stellar-forge.human-services-directory-operated.v1"
ACTOR="450E authored source receiving procedure"
HERE=Path(__file__).resolve().parent
MAX_PACKET=2147483648

def file_identity(path):
    path=Path(path).resolve()
    return {"file":str(path),"bytes":original_workspace.regular(path,MAX_PACKET).st_size,
            "sha256":original_workspace.file_digest(path,MAX_PACKET)}

def input_file(path):
    observed=file_identity(path)
    return {key:observed[key] for key in ("bytes","sha256")}

def put(path,data):
    path=Path(path);private_directory(path.parent)
    if path.exists():
        if path.is_symlink()or path.read_bytes()!=data:raise ConflictError("Original receiving input changed: "+path.name)
    else:original_workspace.private_write(path,data)
    return path

def copy_original(source_path,destination,expected=None):
    source_path=Path(source_path);destination=Path(destination);observed=file_identity(source_path)
    if expected and any(observed[k]!=expected[k]for k in ("bytes","sha256")):raise InputError("Original input failed its complete byte identity")
    private_directory(destination.parent)
    if destination.exists():
        received=file_identity(destination)
        if any(received[k]!=observed[k]for k in("bytes","sha256")):raise ConflictError("Retained original input differs")
    else:
        with source_path.open("rb")as inp,os.fdopen(os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb")as out:
            shutil.copyfileobj(inp,out,65536);out.flush();os.fsync(out.fileno())
    return destination

def records(ws):
    return {kind:[r["id"]for r in ws.directory_records(kind)]for kind in sorted(ws.directory_catalogue()["recordKinds"])}

def require_originals(ws,baseline):
    current=ws.state()
    if current["workspaceId"]!=baseline["workspaceId"]:raise InputError("Directory receiving changed its original Gravity UUID")
    for key in ("sourceIds","editionIds","configurationIds","assessmentIds","exchangeRequestIds"):
        if key=="sourceIds":
            present={r["id"]for r in current["sources"]}
        else:
            kind={"editionIds":"editions","configurationIds":"configurations","assessmentIds":"assessments","exchangeRequestIds":"exchangeRequests"}[key]
            present={r["id"]for r in ws.referral_records(kind)}
        if not set(baseline.get(key,[]))<=present:raise InputError("Directory receiving omitted original Gravity "+key)

class Journey:
    def __init__(self,output,baseline):
        self.output=private_directory(Path(output).resolve());self.path=self.output/"DIRECTORY_JOURNEY.json"
        if self.path.exists():
            self.value=source.json_value(self.path.read_bytes())
            if self.value.get("operation")!=OPERATION or self.value.get("workspaceId")!=baseline["workspaceId"]:
                raise InputError("Resume the original Directory operation and UUID")
        else:self.value={"schema":"stellar-forge.human-services-directory-journey.v1","operation":OPERATION,
            "workspaceId":baseline["workspaceId"],"createdAt":now(),"steps":{},"files":{}}
        self.save()
    def save(self):
        self.value["updatedAt"]=now();atomic_json(self.path,self.value)
    def step(self,name,input,call,read=None):
        digest=source.sha(source.jbytes(input));old=self.value["steps"].get(name)
        if old and old["inputSha256"]!=digest:raise ConflictError("Original Directory step was rebound: "+name)
        if old and old["state"]=="complete":
            result=old["result"]
            return read(result)if read else result
        self.value["steps"][name]={"state":"prepared","input":input,"inputSha256":digest,"preparedAt":now()};self.save()
        print(json.dumps({"phase":name,"state":"prepared"}),flush=True)
        try:result=call()
        except Exception as error:
            self.value["steps"][name].update({"state":"interrupted","error":str(error),"observedAt":now()});self.save();raise
        self.value["steps"][name].update({"state":"complete","result":result,"completedAt":now()});self.save()
        print(json.dumps({"phase":name,"state":"complete","id":result.get("id")if isinstance(result,dict)else None}),flush=True)
        return result
    def file(self,name,path):
        identity=file_identity(path);self.value["files"][name]=identity;self.save();return identity

def operate(args):
    output=private_directory(Path(args.output).resolve())
    original_input=source.json_value(Path(args.gravity_receiving).read_bytes())
    if original_input.get("schema")!="stellar-forge.gravity-referral-operated.v1":raise InputError("Select the complete original operated Gravity result")
    baseline={k:original_input[k]for k in ["workspaceId","sourceIds","editionIds","configurationIds","assessmentIds","exchangeRequestIds"]}
    original_dir=private_directory(output/"originals")
    original_result=copy_original(args.gravity_receiving,original_dir/"OPERATED_GRAVITY_REFERRAL.json")
    original_archive=copy_original(args.gravity_workspace,original_dir/"Gravity_Complete_Editable_Workspace.zip",original_input["workspacePacket"])
    examples=copy_original(args.hsd_examples,original_dir/"HSD_STU1_Original_Examples.zip")if args.hsd_examples else None
    journey=Journey(output,baseline)
    root=Path(args.workspace).resolve()
    with Workspace(root,create=not root.exists())as ws:
        def clinical_receive():
            if ws.workspace_id==baseline["workspaceId"]:
                require_originals(ws,baseline);return {"workspaceId":ws.workspace_id,"retainedOriginal":True}
            result=BaseWorkspace.import_workspace(ws,original_archive)
            require_originals(ws,baseline)
            return {"workspaceId":ws.workspace_id,"archive":file_identity(original_archive),"stateSchema":result["state"]["schema"]}
        journey.step("01-original-gravity-receiving",{"originalResult":input_file(original_result),"archive":input_file(original_archive)},clinical_receive,
            lambda r:(require_originals(ws,baseline)or r))
        source_run=journey.step("02-complete-published-directory-sources",{"originalSourceSha256":source.sha((HERE/"directory-original-source.json").read_bytes()),
            "compiledHsd":input_file(examples)if examples else None},
            lambda:exercise_directory_sources(ws,output/"source-operation",examples))
        source_journal=source.json_value((output/"source-operation"/"SOURCE_JOURNEY.json").read_bytes())
        # Store explicit complete source import inputs for the same connected receiver.
        imports=[]
        for name,step in source_journal["steps"].items():
            if step["kind"]!="sources"or step["state"]!="complete":continue
            record=ws.directory_source(step["id"]);path,d=ws.directory_source_file(record["id"])
            profile=record["interpretation"]
            original_name=profile.get("filename")or(record["members"][0]["name"]if record["format"]not in {"hsds-csv-zip","fhir-json-zip","directory-capture"}else"Original_Directory_Input.zip")
            source.member_name(original_name)
            received=copy_original(path,output/"connected-inputs"/record["id"]/original_name,d)
            imports.append({"key":name,**file_identity(received),"profile":profile,"sourceId":record["id"]})
        replay=[]
        def mutation(name,kind,action,input,call):
            result=journey.step(name,input,call,lambda r:ws.directory_record(kind,r["id"]))
            replay.append({"key":name,"action":action,"args":copy.deepcopy(input),"expectedRecordId":result["id"]})
            return result
        catalogue=ws.directory_catalogue();guidance=ws.directory_guidance()
        profile=copy.deepcopy(next(p for p in catalogue["defaultMappings"]if p["mode"]=="hsds-to-fhir"))
        mapping_input={k:v for k,v in profile.items()if k in catalogue["inputSchemas"]["mapping"]["properties"]}
        mapping_input.update({"label":"Original HSDS 3.3.1 CSV example — reviewed FHIR receiving",
            "actor":ACTOR,"editionId":source_run["baseEditionId"],"predecessorId":None,
            "note":"Authored source receiving procedure over unchanged publisher examples. Mapped values retain exact original row/member identities; service availability requires actual receiving-team confirmation."})
        used_reviews={ident for rule in mapping_input["rules"]for ident in rule.get("reviewIds",[])}
        mapping_input["reviews"]=[]
        for original in [*guidance["publishedMappings"],*guidance["migrations"]]:
            mapping_input["reviews"].append({"id":original["id"],"disposition":"adapted"if original["id"]in used_reviews else"excluded",
                "reason":"This authored receiving edition selects the explicit original CSV-to-FHIR field rule and keeps its source value and row hash."if original["id"]in used_reviews else
                    "Outside the selected original CSV conversion fields in this receiving exercise; complete publisher guidance is retained for later operator review."})
        mapping=mutation("03-reviewed-directory-mapping","mappings","directory_mapping_save",mapping_input,lambda:ws.save_directory_mapping(mapping_input))
        preview_input={"mappingId":mapping["id"]}
        preview=mutation("04-complete-mapping-preview","mappingPreviews","directory_mapping_preview",preview_input,lambda:ws.preview_directory_mapping(preview_input))
        if preview["summary"]["errors"]:
            actual=ws.directory_preview(preview["id"]);atomic_json(output/"MAPPING_REVIEW_REQUIRED.json",actual)
            raise InputError("The original published example has mapping errors; review MAPPING_REVIEW_REQUIRED.json before continuing the same saved mapping")
        conversion_input={"label":"Reviewed native directory source from unchanged HSDS examples","actor":ACTOR,"previewId":preview["id"],
            "note":"Complete original publisher inputs and reviewed field map retained in the same native source."}
        conversion=mutation("05-native-fhir-directory-source","sourceConversions","directory_mapping_apply",conversion_input,lambda:ws.apply_directory_mapping(conversion_input))
        services=[r for r in ws.directory_iter_rows("editions",source_run["baseEditionId"],table="service")]
        if not services:raise InputError("Original directory edition contains no complete service examples")
        selected=next((r for r in services if value(r).get("status")=="active"),services[0])
        schedule_rows=[r for r in ws.directory_iter_rows("editions",source_run["baseEditionId"],table="schedule")]
        criteria={"at":journey.value["createdAt"],"timezone":"UTC","allowedStatuses":["active"],"requireContact":True,
            "scope":"Published source receiving exercise: compare declared source status, exact original contact routes and original schedule evidence at this recorded instant. Selected service is an example, with confirmation assigned to the receiving team.",
            "scheduleDecisions":[{"ref":public_ref(r),"use":"operating-hours","reason":"Explicit authored receiving interpretation of this legacy published schedule row. Original row and source semantics remain complete for receiving-team review."}for r in schedule_rows]}
        selection_input={"label":"Original directory example — reviewed service choice","actor":ACTOR,"editionId":source_run["baseEditionId"],
            "conversionId":conversion["id"],"predecessorId":None,"serviceRefs":[public_ref(r)for r in services],
            "chosenRefs":[public_ref(selected)],"criteria":criteria,"dispositions":[{"ref":public_ref(selected),"decision":"selected",
                "reason":"Selected original published example for the complete source-to-Task receiving exercise. Source observations and unresolved operating checks are retained; actual service confirmation belongs to the receiving owner.","owner":ACTOR}],
            "note":"This is an authored receiving choice over the publisher's original example population."}
        selection=mutation("06-complete-service-choice","selections","directory_selection_save",selection_input,lambda:ws.save_directory_selection(selection_input))
        native_edition=ws.referral_record("editions",original_input["correctedEditionId"])
        task_id=original_input["selectedCorrectedTaskId"]
        if task_id not in native_edition["taskIds"]:raise InputError("Original selected Task is absent from the retained corrected Gravity edition")
        join_input={"label":"Directory service assigned to the original Gravity example Task","actor":ACTOR,
            "selectionId":selection["id"],"conversionId":conversion["id"],"referralEditionId":native_edition["id"],
            "configurationId":native_edition["configurationId"],
            "taskBindings":[{"taskId":task_id,"serviceRef":public_ref(selected),"destinationField":"Task.owner","recipientType":"HealthcareService",
                "reason":"Explicit authored receiving assignment to the mapped original service; preserve the complete native Task status, clinical focus, consent and outcome bodies."}],
            "note":"Source-selected example assignment only. The original receiver topology remains unchanged; this operation performs no endpoint write."}
        joined=mutation("07-original-referral-service-assignment","referralJoins","directory_referral_join",join_input,lambda:ws.join_directory_referrals(join_input))
        handoff_input={"label":"Complete directory service and original referral receiving","actor":ACTOR,"selectionId":selection["id"],
            "conversionId":conversion["id"],"referralJoinId":joined["id"],"owner":ACTOR,
            "recipient":"Original directory and referral implementation receiving team",
            "scope":"Complete original HSDS CSV/JSON sources and source editions; reviewed FHIR conversion; saved service criteria and follow-through; explicit Task.owner successor with original clinical lineage; readable handoff and complete editable reopening.",
            "sourceRefs":[{"sourceId":selected["sourceId"],"recordId":selected["recordId"],"note":"Exact original published service selected for this receiving exercise."}],
            "note":"Whole original example operation. Receiving team records actual deployment, service confirmation and adoption separately."}
        handoff=mutation("08-readable-complete-handoff","handoffs","directory_handoff_prepare",handoff_input,lambda:ws.prepare_directory_handoff(handoff_input))
        export_ids=[];exports=[]
        for key,kind,record_id in [("source","source",source_run["baseSourceId"]),("mapping","mapping-preview",preview["id"]),
            ("selection","selection",selection["id"]),("join","referral-join",joined["id"]),("handoff","handoff",handoff["id"]),("guidance","guidance",None)]:
            request={"label":"Original complete "+key+" receiving","actor":ACTOR,"kind":kind,"recordId":record_id,"note":"Complete original file from the same native operation."}
            r=mutation("09-export-"+key,"exports","directory_export_prepare",request,lambda request=request:ws.prepare_directory_export(request))
            export_ids.append(r["id"])
            target=copy_original(ws._directory_file_path(r["file"]),output/"files"/r["name"],r["file"]);exports.append({"key":key,"exportId":r["id"],**journey.file(key,target)})
        handoff_path=output/"Human_Services_Directory_Complete_Private_Handoff.zip"
        if not handoff_path.exists():ws.export_directory_handoff(handoff["id"],handoff_path)
        handoff_file=journey.file("complete-private-handoff",handoff_path)
        # Observe actual native resources and original queue without sending.
        require_originals(ws,baseline)
        final_records=records(ws)
        selection_analysis=ws.directory_selection(selection["id"])
        mapping_report=ws.directory_preview(preview["id"])
        for name,body in [("Directory_Service_Selection.json",selection_analysis),("Directory_Complete_Field_Map.json",mapping_report["fields"]),
            ("Directory_Referral_Join.json",ws.directory_referral_join(joined["id"])),("Directory_Complete_State.json",ws.state())]:
            path=put(output/name,source.lexical_json(body).encode()+b"\n");journey.file(name,path)
        editable_path=output/"Human_Services_Directory_Editable_Workspace.zip"
        if not editable_path.exists():ws.export_workspace(editable_path)
        editable=journey.file("complete-editable-workspace",editable_path)
        expected_uuid=ws.workspace_id
    def restored(name,archive,kind):
        path=output/name
        with Workspace(path,create=not path.exists())as received:
            result=received.import_workspace(archive)if kind=="workspace"else received.import_directory_handoff(archive)
            if received.workspace_id!=expected_uuid:raise InputError("Complete directory receiving changed its original UUID")
            require_originals(received,baseline)
            actual=records(received)
            for collection,ids in final_records.items():
                if collection=="receives":continue
                if kind=="workspace"and not set(ids)<=set(actual[collection]):raise InputError("Complete editable receiving lost original "+collection)
            original_service=received.directory_edition_row(source_run["baseEditionId"],selected["sourceId"],selected["recordId"])
            if original_service["rowSha256"]!=selected["rowSha256"]or original_service["json"]!=selected["json"]:
                raise InputError("Receiving changed complete original service values")
            return {"workspace":str(path),"workspaceId":received.workspace_id,"recordIds":actual,"originalServiceRef":public_ref(original_service),
                "receiving":{k:v for k,v in result.items()if k!="state"}}
    restored_workspace=journey.step("10-fresh-editable-receiving",input_file(editable_path),lambda:restored("received-editable",editable_path,"workspace"))
    restored_handoff=journey.step("11-fresh-private-handoff-receiving",input_file(handoff_path),lambda:restored("received-handoff",handoff_path,"handoff"))
    with Workspace(root)as ws:
        observation_input={"label":"Actual complete directory receiving and fresh reopening","actor":ACTOR,"handoffId":handoff["id"],
            "archiveSha256":editable["sha256"],"disposition":"received","owner":ACTOR,
            "findings":"The complete editable workspace and private handoff were received into separate fresh native directories. The original UUID, source service JSON/hash, clinical lineage and saved directory records reopened successfully.",
            "note":"Automated native source receiving observation; actual partner deployment and service confirmation remain receiving-team records."}
        receiving=mutation("12-actual-receiving-observation","receivingReviews","directory_receiving_save",observation_input,lambda:ws.save_directory_receiving(observation_input))
        final_records=records(ws)
        final_path=output/"Human_Services_Directory_Complete_Editable_Receiving.zip"
        if not final_path.exists():ws.export_workspace(final_path)
        final_packet=journey.file("final-editable-receiving",final_path)
        final_restore=journey.step("13-final-record-reopening",input_file(final_path),lambda:restored("received-final",final_path,"workspace"))
        result={"schema":SCHEMA,"operation":OPERATION,"completedAt":now(),"workspace":str(root),"workspaceId":ws.workspace_id,
            "sourceRoot":str(HERE),"originalGravityReceiving":file_identity(original_result),"originalGravityWorkspace":file_identity(original_archive),
            "sourceOperation":source_run,"sourceIds":source_run["sourceIds"],"editionIds":source_run["editionIds"],"comparisonIds":source_run["comparisonIds"],
            "mappingIds":[mapping["id"]],"mappingPreviewIds":[preview["id"]],"conversionIds":[conversion["id"]],
            "selectionIds":[selection["id"]],"referralJoinIds":[joined["id"]],"handoffIds":[handoff["id"]],"exportIds":export_ids,
            "receivingIds":[receiving["id"]],"connectionIds":[],"discoveryIds":[],"requestIds":[],"acquisitionOperationIds":[],
            "selectedDirectoryEditionId":source_run["baseEditionId"],"selectedServiceRef":public_ref(selected),
            "originalReferralEditionId":native_edition["id"],"successorReferralEditionId":joined["successorEditionId"],
            "originalTaskId":task_id,"successorTaskId":joined["recordMap"][task_id],
            "mappingSummary":preview["summary"],"selectionSummary":selection["summary"],"joinSummary":joined["summary"],
            "recordIds":final_records,"originalGravityRecordIds":baseline,"exports":exports,
            "handoffPacket":handoff_file,"workspacePacket":final_packet,"preObservationWorkspacePacket":editable,
            "restoration":{"editable":restored_workspace,"handoff":restored_handoff,"final":final_restore},
            "connectedInputs":{"sourceImports":imports,"replayInputs":replay},
            "files":journey.value["files"],"journal":str(journey.path),
            "sourceScope":"Unchanged published directory examples and explicitly authored mappings/service choices; original operated Gravity clinical examples.",
            "nativeAcquisition":"The source exercise imports complete original published files. No live directory provider operation is represented."}
        atomic_json(output/"OPERATED_HUMAN_SERVICES_DIRECTORY.json",result)
        journey.value["completedAt"]=result["completedAt"];journey.value["result"]="OPERATED_HUMAN_SERVICES_DIRECTORY.json";journey.save()
        print(json.dumps({"operation":OPERATION,"workspaceId":ws.workspace_id,"result":str(output/"OPERATED_HUMAN_SERVICES_DIRECTORY.json"),
            "mapping":result["mappingSummary"],"selection":result["selectionSummary"],"join":result["joinSummary"]}),flush=True)
        return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace",required=True);p.add_argument("--output",required=True)
    p.add_argument("--gravity-receiving",required=True);p.add_argument("--gravity-workspace",required=True);p.add_argument("--hsd-examples")
    args=p.parse_args();operate(args);return 0

if __name__=="__main__":sys.exit(main())
