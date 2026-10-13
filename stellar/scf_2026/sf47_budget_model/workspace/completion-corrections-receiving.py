"""Complete two-round correction receiving through the original SQLite Operations APIs.

Every payment, submission and issuer decision below is clearly labelled synthetic
WALKTHROUGH data. No actual grant case, network or external form is changed.
"""
from __future__ import annotations
import argparse, base64, hashlib, io, json, os
from copy import deepcopy
from pathlib import Path
import sys, uuid, zipfile

def encoded(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def durable(path,raw):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.read_bytes()!=raw: raise RuntimeError("Preserve differing original artifact: "+str(path))
        return
    temp=path.with_name(path.name+"."+uuid.uuid4().hex+".stage")
    with open(temp,"xb") as out:
        out.write(raw);out.flush();os.fsync(out.fileno())
    try: os.link(temp,path)
    finally: temp.unlink()
    fd=os.open(path.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source-root",required=True);parser.add_argument("--output",required=True)
    args=parser.parse_args()
    source=Path(args.source_root).resolve(); output=Path(args.output).resolve()
    output.mkdir(parents=True,exist_ok=True,mode=0o700)
    for leaf in sorted((source/"workspace").glob("*.py")):
        compile(leaf.read_bytes(),str(leaf),"exec")
    print("PYTHON_SOURCE_PARSE_PASS",flush=True)
    sys.path.insert(0,str(source/"workspace"))
    from model import Workspace, canonical, digest, Problem
    from operations import Operations
    import operations_completion_corrections as corrections
    source_path=source/"sf10_current_candidate.json"
    state_path=output/"operation.json"
    state=json.loads(state_path.read_bytes()) if state_path.exists() else {"schema":"sf47.completion-corrections-receiving.v1","steps":{}}
    def checkpoint():
        raw=encoded(state);tmp=state_path.with_suffix(".stage")
        with open(tmp,"wb") as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(tmp,state_path)
        fd=os.open(output,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    def step(key,build,call):
        row=state["steps"].get(key)
        if row and "result" in row:return deepcopy(row["result"])
        if row is None:
            row={"request":build()};state["steps"][key]=row;checkpoint()
        row["result"]=call(deepcopy(row["request"]));checkpoint()
        print("STEP",key,json.dumps(row["result"],ensure_ascii=False),flush=True)
        return deepcopy(row["result"])
    workspace=Workspace(output/"original-workspace",source_path)
    received=None; twice=None
    try:
        ops=Operations(workspace)
        plan=workspace.read(workspace.list()[0]["id"])
        case=step("create",lambda:{"planId":plan["id"],"selectedRevision":plan["revision"],
            "expectedContentSha256":plan["contentSha256"],"name":"SYNTHETIC correction/resubmission receiving",
            "mode":"WALKTHROUGH","calendarStart":"2026-10-01","actor":"Synthetic receiving operator",
            "requestId":"correction-course-create"},ops.create)
        case_id=case["id"]
        def version(): return ops.read(case_id)["program"]["version"]
        def command(key,action,data):
            return step(key,lambda:{"expectedVersion":version(),"requestId":"correction-course-"+key,
                "actor":"Synthetic receiving operator","note":"Synthetic WALKTHROUGH only","action":action,
                "data":data() if callable(data) else deepcopy(data)},lambda body:ops.command(case_id,body))
        attachment=command("source","source.add",{"filename":"SYNTHETIC-original-issuer-and-work.txt",
            "mediaType":"text/plain","kind":"grant","observedAt":"2026-10-01T00:00:00Z",
            "contentBase64":base64.b64encode(b"SYNTHETIC WALKTHROUGH: original source, no actual award or issuer statement.\n").decode()})
        src={"sourceIds":[attachment["recordId"]],"sourceNote":"Explicit synthetic walkthrough source"}
        owner=command("owner","contributor.save",{"name":"Synthetic accountable contributor","kind":"PERSON",**src})["recordId"]
        receipt=command("receipt","cash.record",{"direction":"IN","category":"GRANT","currency":"USD",
            "amount":"1.00","date":"2026-10-01","tranche":0,"externalRef":"SYNTHETIC-RECEIPT-NOT-A-PAYMENT",**src})["recordId"]
        seed=step("assignment-seed",lambda:{"expectedVersion":version(),"tranche":1},
                  lambda body:ops.seed_completion(case_id,body))
        assignment=deepcopy(seed["inputs"])
        for index,item in enumerate(assignment["items"]):
            work=command("work-"+str(index),"work.save",{"contributorId":owner,"costId":item["costId"],
                "description":"Synthetic original completed package","startDate":"2026-10-01",
                "endDate":"2026-10-02","hours":"1","fundingBasis":"INTERNAL",**src})["recordId"]
            item.update(ownerIds=[owner],startDate="2026-10-01",endDate="2026-10-02",state="COMPLETE",
                completedOn="2026-10-02",workIds=[work],sourceIds=src["sourceIds"],
                completionNote="Synthetic completed original result; no actual delivery claim")
        command("assignments","completion.save",{"inputs":assignment})
        def prepare(key,date,correction=None):
            data={"receiptId":receipt,"asOfDate":date,"summary":"Synthetic full tranche preparation "+key}
            if correction:data["correctionReviewId"]=correction
            preview=step(key+"-preview",lambda:{"expectedVersion":version(),**data},
                lambda body:ops.preview_completion(case_id,body))
            assert preview["ready"],preview["issues"]
            result=command(key,"completion.prepare",{**data,"expectedPreviewSha256":preview["previewSha256"]})
            return ops.review(case_id,result["recordId"])
        def submit(key,review,date):
            return command(key,"completion.submit",{"reviewId":review["id"],
                "expectedReviewSha256":review["businessSha256"],"submittedOn":date,
                "formReference":"SYNTHETIC-"+key,**src})["recordId"]
        def decision(key,outcome,date,status):
            return command(key,"completion.decision",{"outcomeId":outcome,"state":status,"date":date,**src})
        original=prepare("original-preparation","2026-10-02")
        original_outcome=submit("original-submission",original,"2026-10-03")
        decision("first-issuer-decision",original_outcome,"2026-10-04","CHANGES_REQUESTED")
        round1=step("first-correction-seed",lambda:{"expectedVersion":version(),"outcomeId":original_outcome},
                    lambda body:ops.seed_completion_corrections(case_id,body))
        inputs=deepcopy(round1["inputs"])
        inputs["document"]["findings"]=[{"id":"finding-"+sha(b"synthetic-finding-one")[:32],
            "request":"SYNTHETIC issuer request: clarify source receiving",
            "basis":"Synthetic original decision retained in this WALKTHROUGH",
            "costIds":[assignment["items"][0]["costId"]],"ownerIds":[owner],"state":"OPEN",
            "dueOn":"2026-10-08","completedOn":None,"response":"","workIds":[],"deploymentIds":[],
            "sourceIds":src["sourceIds"]}]
        def save_correction(key,inputs_,date):
            preview=step(key+"-preview",lambda:{"expectedVersion":version(),"inputs":deepcopy(inputs_),"asOfDate":date},
                         lambda body:ops.preview_completion_corrections(case_id,body))
            result=command(key,"completion.corrections.save",{"inputs":preview["inputs"],"asOfDate":date,
                "expectedPreviewSha256":preview["previewSha256"]})
            return ops.review(case_id,result["recordId"])
        open_review=save_correction("first-open-edition",inputs,"2026-10-04")
        assert not open_review["corrections"]["report"]["readyForPreparation"]
        open_preview=step("open-preparation-inspection",lambda:{"expectedVersion":version(),"receiptId":receipt,
            "asOfDate":"2026-10-04","summary":"Synthetic open corrections remain unresolved","correctionReviewId":open_review["id"]},
            lambda body:ops.preview_completion(case_id,body))
        assert not open_preview["ready"]
        correction_work=command("correction-work","work.save",{"contributorId":owner,
            "costId":assignment["items"][0]["costId"],"description":"Synthetic corrected source receiving",
            "startDate":"2026-10-05","endDate":"2026-10-05","hours":"1","fundingBasis":"INTERNAL",**src})["recordId"]
        edited=deepcopy(inputs);edited["previousReviewId"]=open_review["id"]
        edited["document"]["findings"][0].update(state="ADDRESSED",completedOn="2026-10-05",
            response="Synthetic original source independently reopened",workIds=[correction_work])
        closed_review=save_correction("first-addressed-edition",edited,"2026-10-05")
        assert closed_review["corrections"]["report"]["readyForPreparation"]
        try:
            ops.preview_completion(case_id,{"expectedVersion":version(),"receiptId":receipt,"asOfDate":"2026-10-06",
                "summary":"Do not select stale correction edition","correctionReviewId":open_review["id"]})
        except Problem as exc:
            assert exc.code=="COMPLETION_CORRECTIONS_HEAD_CHANGED"
        else:raise AssertionError("Earlier correction edition admitted as current")
        second=prepare("first-repreparation","2026-10-06",closed_review["id"])
        outcome2=submit("first-resubmission",second,"2026-10-06")
        decision("second-issuer-decision",outcome2,"2026-10-07","CHANGES_REQUESTED")
        round2=step("second-correction-seed",lambda:{"expectedVersion":version(),"outcomeId":outcome2},
            lambda body:ops.seed_completion_corrections(case_id,body))
        final_inputs=deepcopy(round2["inputs"])
        finding=deepcopy(edited["document"]["findings"][0]);finding.update(
            id="finding-"+sha(b"synthetic-finding-two")[:32],request="SYNTHETIC second request: include full handover",
            basis="Second synthetic original issuer decision",completedOn="2026-10-08",
            response="Synthetic second clarification retained",workIds=[])
        final_inputs["document"]["findings"]=[finding]
        final_correction=save_correction("second-addressed-edition",final_inputs,"2026-10-08")
        third=prepare("second-repreparation","2026-10-09",final_correction["id"])
        outcome3=submit("second-resubmission",third,"2026-10-09")
        decision("final-issuer-decision",outcome3,"2026-10-10","ACCEPTED")
        current=ops.read(case_id)
        assert current["program"]["mode"]=="WALKTHROUGH"
        assert len(current["records"]["cash"])==1
        outcomes={x["id"]:x for x in current["records"]["outcomes"]}
        assert outcomes[outcome2]["completion"]["correction"]["sourceOutcomeId"]==original_outcome
        assert outcomes[outcome3]["completion"]["correction"]["sourceOutcomeId"]==outcome2
        assert original["completion"]["clock"]["originalDeadlineOn"]==third["completion"]["clock"]["originalDeadlineOn"]
        old_version=version()
        replay=ops.command(case_id,state["steps"]["first-addressed-edition"]["request"])
        assert replay==state["steps"]["first-addressed-edition"]["result"] and version()==old_version
        complete_review_ids=[original["id"],open_review["id"],closed_review["id"],second["id"],final_correction["id"],third["id"]]
        originals={rid:ops.review(case_id,rid) for rid in complete_review_ids}
        correction_zip=ops.export_completion_corrections(case_id,final_correction["id"])
        final_zip=ops.export_completion(case_id,third["id"])
        case_zip=ops.export(case_id)
        artifacts=[]
        for name,raw in [("second-correction-round.zip",correction_zip),("second-resubmission-preparation.zip",final_zip),
                         ("complete-original-walkthrough.zip",case_zip)]:
            durable(output/name,raw);artifacts.append({"path":name,"bytes":len(raw),"sha256":sha(raw)})
        with zipfile.ZipFile(io.BytesIO(correction_zip)) as archive:
            assert archive.testzip() is None
            nested=archive.read("original-preparation.zip")
            with zipfile.ZipFile(io.BytesIO(nested)) as preparation:
                assert preparation.testzip() is None
                assert any(x.startswith("corrections/") for x in preparation.namelist())
        received=Workspace(output/"received-workspace",source_path)
        receiving=Operations(received)
        imported=step("independent-receive",lambda:{"sha256":sha(case_zip)},
            lambda _:receiving.import_bundle(case_zip,"Synthetic independently received correction case",
                "correction-course-import","Synthetic receiving operator"))
        imported_id=imported["id"]
        for rid,review in originals.items():assert receiving.review(imported_id,rid)==review
        assert receiving.read(imported_id)["records"]==current["records"]
        received.close();received=None
        received=Workspace(output/"received-workspace",source_path);receiving=Operations(received)
        for rid,review in originals.items():assert receiving.review(imported_id,rid)==review
        received_seed=step("received-edit-seed",lambda:{"expectedVersion":receiving.read(imported_id)["program"]["version"],
            "outcomeId":outcome2,"reviewId":final_correction["id"]},
            lambda body:receiving.seed_completion_corrections(imported_id,body))
        received_inputs=deepcopy(received_seed["inputs"])
        received_inputs["document"]["note"]="Synthetic deliberate edit after independent receiving and cold reopen"
        received_preview=step("received-edit-preview",lambda:{"expectedVersion":receiving.read(imported_id)["program"]["version"],
            "inputs":received_inputs,"asOfDate":"2026-10-11"},
            lambda body:receiving.preview_completion_corrections(imported_id,body))
        received_save=step("received-edit-save",lambda:{"expectedVersion":receiving.read(imported_id)["program"]["version"],
            "requestId":"correction-course-received-edit","actor":"Synthetic receiving operator",
            "note":"Synthetic explicit edit of the independently received same round",
            "action":"completion.corrections.save","data":{"inputs":received_preview["inputs"],
                "asOfDate":"2026-10-11","expectedPreviewSha256":received_preview["previewSha256"]}},
            lambda body:receiving.command(imported_id,body))
        received_review=receiving.review(imported_id,received_save["recordId"])
        assert received_review["corrections"]["inputs"]["roundId"]==final_inputs["roundId"]
        assert received_review["corrections"]["revision"]==2
        originals[received_review["id"]]=received_review
        repeat_zip=receiving.export(imported_id);durable(output/"complete-received-walkthrough.zip",repeat_zip)
        twice=Workspace(output/"second-generation-workspace",source_path);second_receiver=Operations(twice)
        imported2=step("second-generation-receive",lambda:{"sha256":sha(repeat_zip)},
            lambda _:second_receiver.import_bundle(repeat_zip,"Synthetic second-generation correction case",
                "correction-course-second-import","Synthetic receiving operator"))
        for rid,review in originals.items():assert second_receiver.review(imported2["id"],rid)==review
        result={"schema":"sf47.completion-corrections-receiving-result.v1","status":"PASS",
            "mode":"SYNTHETIC_WALKTHROUGH","actualGrantMutations":False,
            "originalCaseId":case_id,"receivedCaseId":imported_id,"secondGenerationCaseId":imported2["id"],
            "originalVersion":version(),"reviewIds":complete_review_ids,"correctionRounds":2,
            "correctionEditions":3,"submissionOutcomeIds":[original_outcome,outcome2,outcome3],
            "originalDeadlineOn":original["completion"]["clock"]["originalDeadlineOn"],
            "singleSyntheticPaymentRetained":True,"sameRequestReplay":True,"coldReopen":True,
            "receivedEditedReviewId":received_review["id"],"receivedEditedRoundRevision":2,
            "allHistoricalReviewsEqual":True,"artifacts":artifacts}
        durable(output/"receiving-result.json",encoded(result))
        state["result"]=result;checkpoint()
        print("RECEIVING_RESULT",json.dumps(result,ensure_ascii=False),flush=True)
    finally:
        if twice:twice.close()
        if received:received.close()
        workspace.close()
if __name__=="__main__":
    try:main()
    except BaseException:
        import traceback
        output=Path(sys.argv[sys.argv.index("--output")+1])
        output.mkdir(parents=True,exist_ok=True)
        failure={"schema":"sf47.completion-corrections-receiving-failure.v1","traceback":traceback.format_exc()}
        failure_path=output/("failure-"+uuid.uuid4().hex+".json")
        durable(failure_path,encoded(failure))
        print("RECEIVING_FAILED",str(failure_path),flush=True)
        raise
