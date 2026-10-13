"""Complete original Installation-to-Completion receiving through the original SQLite Operations APIs.

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
    import operations_installations as installations
    source_path=source/"sf10_current_candidate.json"
    state_path=output/"operation.json"
    state=json.loads(state_path.read_bytes()) if state_path.exists() else {"schema":"sf47.installation-completion-receiving.v1","steps":{}}
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
    if state.get("result"):
        for artifact in state["result"]["artifacts"]:
            original=output/artifact["path"]
            if not original.is_file() or original.stat().st_size!=artifact["bytes"] or sha(original.read_bytes())!=artifact["sha256"]:
                raise RuntimeError("Preserve and reconcile the original completed output: "+str(original))
        print("RECEIVING_RESULT",json.dumps(state["result"],ensure_ascii=False),flush=True)
        return
    workspace=Workspace(output/"original-workspace",source_path)
    received=None; twice=None
    try:
        from datetime import datetime, timezone
        stamp=state.setdefault("asOfAt",datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"))
        day=stamp[:10];checkpoint()
        ops=Operations(workspace)
        plan=workspace.read(workspace.list()[0]["id"])
        case=step("create",lambda:{"planId":plan["id"],"selectedRevision":plan["revision"],
            "expectedContentSha256":plan["contentSha256"],"name":"SYNTHETIC Installation-to-Completion receiving",
            "mode":"WALKTHROUGH","calendarStart":day,"actor":"Synthetic receiving operator",
            "requestId":"installation-completion-create"},ops.create)
        case_id=case["id"]
        def version():return ops.read(case_id)["program"]["version"]
        def command(key,action,data):
            return step(key,lambda:{"expectedVersion":version(),"requestId":"installation-completion-"+key,
                "actor":"Synthetic receiving operator","note":"Synthetic WALKTHROUGH only","action":action,
                "data":data() if callable(data) else deepcopy(data)},lambda body:ops.command(case_id,body))
        attachment=command("source","source.add",{"filename":"SYNTHETIC-installation-source.txt",
            "mediaType":"text/plain","kind":"other","observedAt":stamp,
            "contentBase64":base64.b64encode(b"SYNTHETIC WALKTHROUGH original customer result; no actual customer or award.\n").decode()})
        src={"sourceIds":[attachment["recordId"]],"sourceNote":"Explicit synthetic walkthrough source"}
        owner=command("owner","contributor.save",{"name":"Synthetic accountable contributor","kind":"PERSON",**src})["recordId"]
        receipt=command("receipt","cash.record",{"direction":"IN","category":"GRANT","currency":"USD","amount":"1.00",
            "date":day,"tranche":0,"externalRef":"SYNTHETIC-NOT-A-REAL-PAYMENT",**src})["recordId"]
        seed=step("assignment-seed",lambda:{"expectedVersion":version(),"tranche":1},lambda body:ops.seed_completion(case_id,body))
        assignment=deepcopy(seed["inputs"]);costs=[item["costId"] for item in assignment["items"]]
        merchant=command("merchant","deployment.save",{"name":"Synthetic merchant","operator":"Synthetic merchant operator","role":"MERCHANT",
            "participantClass":"TEAM_OPERATED","environment":"TESTNET","state":"INSTALLED","costIds":costs,"tranche":1,**src})["recordId"]
        buyer=command("buyer","deployment.save",{"name":"Synthetic buyer","operator":"Synthetic buyer operator","role":"BUYER",
            "participantClass":"TEAM_OPERATED","environment":"TESTNET","state":"INSTALLED","costIds":costs,"tranche":1,**src})["recordId"]
        works=[]
        for i,item in enumerate(assignment["items"]):
            work=command("work-"+str(i),"work.save",{"contributorId":owner,"costId":item["costId"],
                "description":"Synthetic original whole useful result","startDate":day,"endDate":day,
                "hours":"1","fundingBasis":"INTERNAL",**src})["recordId"]
            works.append(work)
            item["note"]="Preserve this operator's existing package note "+str(i)
        purchase=command("purchase","purchase.record",{"deploymentId":buyer,"network":"SYNTHETIC TESTNET","asset":"native",
            "transactionHash":sha(b"synthetic transaction"),"amountStroops":"1","observedAt":stamp,
            "settledAt":stamp,"outputCompletedAt":stamp,"settlementStatus":"SETTLED","outputStatus":"COMPLETE",
            "orderStatus":"NOT_APPLICABLE","deliveredBytes":9,"deliveredSha256":sha(b"synthetic"),
            "intentId":"SYNTHETIC-ORIGINAL-INTENT","origin":"OPERATOR_ENTRY",**src})["recordId"]
        document=installations.seed(ops._context(case_id))
        document.update(name="SYNTHETIC complete original Installation",merchantDeploymentId=merchant,buyerDeploymentIds=[buyer])
        document["assignments"]["costIds"]=costs
        document["checks"]=[{"id":"synthetic-check-"+str(i),"title":"Synthetic acceptance "+item["costId"],
            "criterion":"Original synthetic whole useful output","tranche":1,"required":True,"state":"ACCEPTED",
            "operator":"Synthetic customer receiving operator","observedAt":stamp,
            "note":"Synthetic actual-result observation for "+item["costId"],"sourceIds":src["sourceIds"],
            "workIds":[works[i]],"purchaseIds":[purchase],"outcomeIds":[]} for i,item in enumerate(assignment["items"])]
        def save_installation(key,doc,ident=None,revision=0):
            preview=step(key+"-preview",lambda:{"expectedVersion":version(),"installationId":ident,
                "expectedRevision":revision,"document":deepcopy(doc)},lambda body:ops.preview_installation(case_id,body))
            return command(key,"installation.save",{"installationId":ident,"expectedRevision":revision,
                "document":preview["document"],"expectedPreviewSha256":preview["previewSha256"]})
        first=save_installation("installation-first",document)
        catalogue=step("catalogue",lambda:{"expectedVersion":version(),"tranche":1},lambda body:ops.completion_installations(case_id,body))
        native=next(x for x in catalogue["installations"] if x["id"]==first["recordId"])
        assignment["installationSelections"]=[{"costId":item["costId"],"installationId":native["id"],"revision":native["revision"],
            "sha256":native["sha256"],"checkId":"synthetic-check-"+str(i),"requirePaidPurchase":True}
            for i,item in enumerate(assignment["items"])]
        transfer=step("original-transfer",lambda:{"expectedVersion":version(),"inputs":assignment,"asOfDate":day},
            lambda body:ops.preview_completion_installations(case_id,body))
        assert transfer["report"]["ready"],transfer["report"]["issues"]
        assert transfer["report"]["summary"]["distinctUsefulPaidPurchases"]==1
        proposed=deepcopy(transfer["proposedInputs"])
        for item,suggestion,prior in zip(proposed["items"],transfer["suggestions"],assignment["items"]):
            assert item["note"]==prior["note"] and item["state"]=="PLANNED"
            assert owner in item["ownerIds"] and works[costs.index(item["costId"])] in item["workIds"]
            item.update(state="COMPLETE",completedOn=suggestion["completedOn"],completionNote=suggestion["completionNote"])
        assignment_result=command("assignments-first","completion.save",{"inputs":proposed})
        def prepare(key):
            data={"receiptId":receipt,"asOfDate":day,"summary":"SYNTHETIC original Installation acceptance delivery"}
            preview=step(key+"-preview",lambda:{"expectedVersion":version(),**data},lambda body:ops.preview_completion(case_id,body))
            assert preview["ready"],preview["issues"]
            result=command(key,"completion.prepare",{**data,"expectedPreviewSha256":preview["previewSha256"]})
            return ops.review(case_id,result["recordId"])
        original=prepare("first-preparation")
        complete_before=ops.export_completion(case_id,original["id"])
        durable(output/"first-preparation.zip",complete_before)
        with zipfile.ZipFile(io.BytesIO(complete_before)) as archive:
            assert archive.testzip() is None
            assert "installation-evidence.json" in archive.namelist()
            assert any(x.endswith("/sources/"+attachment["recordId"]) for x in archive.namelist())
        later=deepcopy(document);later["checks"][0]["note"]+="; explicit later source clarification"
        second=save_installation("installation-second",later,first["recordId"],1)
        old_preview=step("earlier-selection-inspection",lambda:{"expectedVersion":version(),"receiptId":receipt,"asOfDate":day,
            "summary":"SYNTHETIC inspect old selection"},lambda body:ops.preview_completion(case_id,body))
        assert not old_preview["ready"] and any(x["code"]=="INSTALLATION_EDITION_CHANGED" for x in old_preview["issues"])
        assert ops.export_completion(case_id,original["id"])==complete_before
        current_installation=installations.get(ops,case_id,first["recordId"],2)
        revised=deepcopy(proposed)
        for selection in revised["installationSelections"]:selection.update(revision=2,sha256=current_installation["sha256"])
        revised_transfer=step("revised-transfer",lambda:{"expectedVersion":version(),"inputs":revised,"asOfDate":day},
            lambda body:ops.preview_completion_installations(case_id,body))
        revised=revised_transfer["proposedInputs"]
        revised["items"][0]["completionNote"]=revised_transfer["suggestions"][0]["completionNote"]
        command("assignments-second","completion.save",{"inputs":revised})
        final=prepare("second-preparation")
        before_version=version()
        assert ops.command(case_id,state["steps"]["assignments-first"]["request"])==assignment_result
        assert version()==before_version
        complete=ops.export_completion(case_id,final["id"]);whole=ops.export(case_id)
        durable(output/"second-preparation.zip",complete);durable(output/"complete-original-case.zip",whole)
        original_rows={1:installations.get(ops,case_id,first["recordId"],1),2:current_installation}
        received=Workspace(output/"received-workspace",source_path);receiving=Operations(received)
        imported=step("receive",lambda:{"sha256":sha(whole)},lambda _:receiving.import_bundle(whole,
            "SYNTHETIC independently received Installation completion","installation-completion-receive","Synthetic receiving operator"))
        target=imported["id"]
        for number,row in original_rows.items():assert installations.get(receiving,target,first["recordId"],number)==row
        for review in (original,final):assert receiving.review(target,review["id"])==review
        received.close();received=None
        received=Workspace(output/"received-workspace",source_path);receiving=Operations(received)
        assert receiving.export_completion(target,original["id"])==complete_before
        assert receiving.export_completion(target,final["id"])==complete
        current=receiving.read(target)
        saved=next(x for x in current["completionPlans"] if x["tranche"]==1)
        edited=deepcopy(saved["inputs"]);edited["items"][0]["note"]+="; explicit received-case edit"
        edit=step("received-edit",lambda:{"expectedVersion":receiving.read(target)["program"]["version"],
            "requestId":"installation-completion-received-edit","actor":"Synthetic receiving operator","note":"Synthetic explicit edit after cold receiving",
            "action":"completion.save","data":{"inputs":edited}},lambda body:receiving.command(target,body))
        repeat=receiving.export(target);durable(output/"complete-received-case.zip",repeat)
        twice=Workspace(output/"second-generation-workspace",source_path);second_receiver=Operations(twice)
        imported2=step("receive-second-generation",lambda:{"sha256":sha(repeat)},lambda _:second_receiver.import_bundle(repeat,
            "SYNTHETIC second generation Installation completion","installation-completion-receive-twice","Synthetic receiving operator"))
        for review in (original,final):assert second_receiver.review(imported2["id"],review["id"])==review
        result={"schema":"sf47.installation-completion-receiving-result.v1","status":"PASS","mode":"SYNTHETIC_WALKTHROUGH",
            "actualGrantMutations":False,"originalCaseId":case_id,"receivedCaseId":target,"secondGenerationCaseId":imported2["id"],
            "installationId":first["recordId"],"installationRevisions":[1,2],"completionReviewIds":[original["id"],final["id"]],
            "distinctSyntheticPaidTransactionCount":1,"existingDraftNotesPreserved":True,"sourceChangeBlocksNewPreparation":True,
            "historicalPreparedBytesUnchanged":True,"sameOriginalRequestReplay":True,"coldReopen":True,"receivedEdit":edit,
            "artifacts":[{"path":p.name,"bytes":p.stat().st_size,"sha256":sha(p.read_bytes())} for p in sorted(output.glob("*.zip"))]}
        durable(output/"receiving-result.json",encoded(result));state["result"]=result;checkpoint()
        print("RECEIVING_RESULT",json.dumps(result,ensure_ascii=False),flush=True)
    finally:
        if twice:twice.close()
        if received:received.close()
        workspace.close()
if __name__=="__main__":
    try:main()
    except BaseException:
        import traceback
        output=Path(sys.argv[sys.argv.index("--output")+1]);output.mkdir(parents=True,exist_ok=True)
        failure={"schema":"sf47.installation-completion-receiving-failure.v1","traceback":traceback.format_exc()}
        failure_path=output/("failure-"+uuid.uuid4().hex+".json");durable(failure_path,encoded(failure))
        print("RECEIVING_FAILED",str(failure_path),flush=True)
        raise
