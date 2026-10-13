#!/usr/bin/env python3
"""Run the original publisher cohort through the complete local staff/customer workflow."""
import argparse,csv,hashlib,io,json,os,pathlib,subprocess,sys,tempfile,time,urllib.error,urllib.request,uuid,zipfile
from arches_workspace import Workspace,canonical,file_hash
from arches_source import iter_resources
def run(source_root,output):
    source_root=pathlib.Path(source_root).resolve();output=pathlib.Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    app=pathlib.Path(__file__).resolve().parent; workspace=output/"staff-workspace"; journal=[]; service=None;services_closed=False
    result={"schema":"commons.arches-publisher-receiving.v1","source_kind":"original publisher fixtures","phases":journal,"complete":False}
    def phase(name,**detail):
        journal.append({"phase":name,"at":time.time(),**detail});(output/"native-progress.json").write_text(canonical(result)+"\n");print(canonical(journal[-1]),flush=True)
    def exact_manifest():
        manifest=json.loads((source_root/"COHORT.json").read_text())
        for f in manifest["files"]:
            actual=file_hash(source_root/f["path"])
            if actual!=(f["sha256"],f["bytes"]):raise ValueError("Original cohort identity differs: "+f["path"])
        return manifest
    try:
        cohort=exact_manifest();phase("original-publisher-source",files=len(cohort["files"]))
        ready_path=output/"server-ready.txt"
        with ready_path.open("w") as log:
            service=subprocess.Popen([sys.executable,"-B",str(app/"arches_app.py"),"serve","--workspace",str(workspace),"--port","0"],stdout=log,stderr=subprocess.STDOUT)
        deadline=time.monotonic()+30;ready=None
        while time.monotonic()<deadline:
            if ready_path.exists():
                for line in ready_path.read_text().splitlines():
                    try:
                        item=json.loads(line)
                        if item.get("event")=="ready":ready=item;break
                    except json.JSONDecodeError:pass
            if ready:break
            if service.poll() is not None:raise RuntimeError("Staff service ended before ready")
            time.sleep(.05)
        if not ready:raise RuntimeError("Staff service did not become ready")
        url=ready["url"];token=pathlib.Path(ready["token_file"]).read_text().strip()
        def request(path,data=None,method=None,raw=None):
            headers={"Authorization":"Bearer "+token}
            if raw is not None:body=raw;headers["Content-Type"]="application/octet-stream"
            elif data is not None:body=canonical(data).encode();headers["Content-Type"]="application/json"
            else:body=None
            req=urllib.request.Request(url+path,body,headers,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                body=r.read()
                return json.loads(body) if "application/json" in r.headers.get("Content-Type","") else body
        ui=request("/");(output/"staff-ui.html").write_bytes(ui)
        if b"Arches Receiving Workspace" not in ui:raise RuntimeError("Staff UI did not load")
        phase("staff-service-and-ui",bytes=len(ui),workspace=ready["workspace"])
        def mutation(path,payload):
            status=request("/api/status");body={**payload,"actor":"Publisher cohort commissioning","operation_id":str(uuid.uuid4()),"expected_revision":status["revision"]}
            value=request(path,body)
            repeat=request(path,body)
            if value!=repeat:raise RuntimeError("Original operation recovery differs")
            return value
        def upload(rel,role):
            p=source_root/rel
            import urllib.parse
            return request("/api/uploads?kind="+role+"&name="+urllib.parse.quote(p.name),method="PUT",raw=p.read_bytes())["upload_id"]
        profiles=cohort["editions"]
        baseline=profiles["before"];candidate=profiles["after"]
        def receive(profile,parent=None):
            ids=[]
            for role,key in (("resource","resources"),("graph","graphs"),("collection","collections"),("license","licenses")):
                for rel in profile.get(key,[]):ids.append(upload(rel,role))
            return mutation("/api/import",{"uploads":ids,"source_format":"business_data","scope_id":"publisher-group-original-cohort","coverage":"complete","parent_release":parent})
        def decisions(snapshot,choice,reason):
            exported=request("/api/review/export",{"snapshot":snapshot,"only_open":True})
            original=request(exported["download"])
            original_path=output/(snapshot+"-review-export.csv");original_path.write_bytes(original)
            if file_hash(original_path)!=(exported["sha256"],exported["bytes"]):raise RuntimeError("Original review export changed")
            reader=csv.DictReader(io.StringIO(original.decode("utf8")));fields=reader.fieldnames;rows=list(reader)
            for row in rows:row["decision"]=choice;row["reason"]=reason
            text=io.StringIO(newline="");writer=csv.DictWriter(text,fieldnames=fields,lineterminator="\n");writer.writeheader();writer.writerows(rows)
            raw=text.getvalue().encode();(output/(snapshot+"-staff-decisions.csv")).write_bytes(raw)
            selected=request("/api/uploads?kind=review&name=staff-decisions.csv",method="PUT",raw=raw)
            revision=request("/api/status")["revision"]
            preview=request("/api/review/preview",{"snapshot":snapshot,"upload_id":selected["upload_id"],"expected_revision":revision})
            (output/(snapshot+"-preview.json")).write_text(canonical(preview)+"\n")
            if preview["rows"]!=len(rows) or preview["selected"]!=len(rows) or preview["decisions"]!={choice:len(rows)}:raise RuntimeError("Full review preview differs")
            saved=mutation("/api/review/apply",{"snapshot":snapshot,"upload_id":selected["upload_id"],"preview_sha256":preview["preview_sha256"]})
            if saved["decisions_saved"]!=len(rows) or saved["review_source"]["sha256"]!=selected["sha256"]:raise RuntimeError("Staff review decision/source receiving differs")
            phase("staff-review-file-preview-commit-and-replay",snapshot=snapshot,rows=len(rows),decisions=preview["decisions"],source_sha256=selected["sha256"],preview_sha256=preview["preview_sha256"])
            return saved
        first=receive(baseline)
        first_detail=request("/api/edition?snapshot="+first["snapshot"])
        if first_detail["blocking"] or first_detail["resources"]!=1:raise RuntimeError("Original two-tile baseline is not correctly received")
        decisions(first["snapshot"],"approve","Original publisher baseline: resource, tile ownership and matching graph/collection sources reviewed.")
        baseline_release=mutation("/api/release",{"snapshot":first["snapshot"]})
        phase("original-baseline-reviewed-and-released",edition=first["snapshot"],release=baseline_release["release"],resources=baseline_release["resources"])
        second=receive(candidate,baseline_release["release"])
        changes=request("/api/changes?snapshot="+second["snapshot"])
        if changes["total"]!=1 or changes["rows"][0]["kind"]!="changed" or not changes["rows"][0]["blocking"]:raise RuntimeError("Actual added foreign-owned tile was not retained as a blocking change")
        changed=changes["rows"][0]
        from urllib.parse import urlencode
        detail=request("/api/resource?"+urlencode({"snapshot":second["snapshot"],"graph_id":changed["graph_id"],"resource_id":changed["resource_id"]}))
        (output/"actual-resource-review.json").write_text(canonical(detail)+"\n")
        if len(detail["before"]["tiles"])!=2 or len(detail["candidate"]["tiles"])!=3:raise RuntimeError("Actual publisher editions differ from their original tile counts")
        phase("actual-publisher-change-reviewed",changes=changes["total"],issues=[i["code"] for i in detail["issues"]])
        exported=request("/api/review/export",{"snapshot":second["snapshot"],"only_open":True})
        incoming=request(exported["download"]);reader=csv.DictReader(io.StringIO(incoming.decode("utf8")));fields=reader.fieldnames;rows=list(reader)
        for row in rows:row["decision"]="approve";row["reason"]="Commissioning checks the actual source-contract approval boundary."
        text=io.StringIO(newline="");writer=csv.DictWriter(text,fieldnames=fields,lineterminator="\n");writer.writeheader();writer.writerows(rows)
        denied=request("/api/uploads?kind=review&name=blocked-approval.csv",method="PUT",raw=text.getvalue().encode())
        before_denial=request("/api/status")
        try:
            request("/api/review/preview",{"snapshot":second["snapshot"],"upload_id":denied["upload_id"],"expected_revision":before_denial["revision"]})
            raise RuntimeError("Source-contract approval was unexpectedly accepted")
        except urllib.error.HTTPError as e:
            if e.code!=409:raise
            rejected=json.loads(e.read())
            if "source-contract issue" not in rejected["error"]:raise RuntimeError("Unexpected approval diagnostic")
        if request("/api/status")!=before_denial:raise RuntimeError("Failed review preview changed workspace")
        phase("actual-contract-approval-rejected-before-mutation",diagnostic=rejected["error"])
        decisions(second["snapshot"],"reject","Retain the prior accepted resource. The added original tile names a different resource owner; preserve the incoming source and request a corrected publisher edition.")
        accepted=mutation("/api/release",{"snapshot":second["snapshot"]})
        release_meta=request("/api/export/release",{"release":accepted["release"]})
        release_zip=output/"Arches_Publisher_Reviewed_Release.zip";release_zip.write_bytes(request(release_meta["download"]))
        if file_hash(release_zip)!=(release_meta["sha256"],release_meta["bytes"]):raise RuntimeError("Released download differs")
        with zipfile.ZipFile(release_zip) as z:
            records=[n for n in z.namelist() if n.startswith("resources/") and n.endswith(".json")]
            if len(records)!=1:raise RuntimeError("Released selection differs")
            record=json.loads(z.read(records[0]))
            if record!=detail["before"]:raise RuntimeError("Rejected change did not retain the original accepted record")
            contexts=json.loads(z.read("contexts.json"))
            if first["snapshot"] not in contexts:raise RuntimeError("Original accepted context was not retained")
            downstream=json.loads(z.read("downstream.json"))
            if downstream["source_format"]!="business_data" or len(downstream["files"])!=1:raise RuntimeError("Original StaticFile release selection differs")
            selected_file=downstream["files"][0]
            if selected_file["context_snapshot"]!=first["snapshot"] or selected_file["resources"]!=1:raise RuntimeError("Original StaticFile context selection differs")
            with tempfile.TemporaryDirectory(prefix="static-file-receiving-",dir=output) as temporary:
                actual=pathlib.Path(temporary)/"business-data.json"
                with z.open(selected_file["path"]) as incoming,actual.open("xb") as outgoing:
                    for chunk in iter(lambda:incoming.read(1024*1024),b""):outgoing.write(chunk)
                if file_hash(actual)!=(selected_file["sha256"],selected_file["bytes"]):raise RuntimeError("Original StaticFile source identity differs")
                with iter_resources(actual,source_format="business_data") as incoming:
                    received=list(incoming)
                if incoming.receipt is None or len(received)!=1 or canonical(received[0])!=canonical(record):raise RuntimeError("Original StaticFile receiver changed the accepted resource")
            phase("original-static-file-downstream-received",resources=1,context=selected_file["context_snapshot"],bytes=selected_file["bytes"],sha256=selected_file["sha256"])
        phase("reviewed-release-received",release=accepted["release"],bytes=release_meta["bytes"],sha256=release_meta["sha256"])
        transfer_meta=request("/api/export/workspace",{})
        transfer=output/"Arches_Complete_Workspace.zip";transfer.write_bytes(request(transfer_meta["download"]))
        if file_hash(transfer)!=(transfer_meta["sha256"],transfer_meta["bytes"]):raise RuntimeError("Whole workspace download differs")
        receiving=Workspace.restore(transfer,output/"cold-receiver")
        cold=Workspace(receiving["root"])
        if cold.status()!=request("/api/status"):raise RuntimeError("Whole workspace restore changed state")
        if cold.resource(second["snapshot"],changed["graph_id"],changed["resource_id"])!=detail|{"decision":cold.resource(second["snapshot"],changed["graph_id"],changed["resource_id"])["decision"]}:raise RuntimeError("Original records changed on restore")
        with cold.connect() as c:
            exchanges=[dict(r) for r in c.execute("SELECT * FROM review_exchanges ORDER BY created")]
            if len(exchanges)!=2:raise RuntimeError("Complete staff file history did not reopen")
            for exchange in exchanges:
                source=json.loads(exchange["source_manifest"])
                if file_hash(cold.root/source["path"])!=(source["sha256"],source["bytes"]):raise RuntimeError("Retained review CSV changed on reopen")
        phase("complete-review-files-cold-received",files=len(exchanges))
        reopened=output/"Arches_Reopened_Release.zip";cold.export_release(accepted["release"],reopened)
        with zipfile.ZipFile(reopened) as z:
            if json.loads(z.read(records[0]))!=record:raise RuntimeError("Accepted resource changed on receiving reopen")
        phase("complete-workspace-cold-reopen",bytes=transfer_meta["bytes"],sha256=transfer_meta["sha256"],workspace=receiving["workspace"]["workspace_id"])
        result.update(complete=True,workspace=ready["workspace"],before_edition=first["snapshot"],after_edition=second["snapshot"],release=accepted["release"],resource_count=1,source_kind="original publisher fixtures",transfer=transfer_meta)
    except BaseException as e:
        result["error"]={"type":type(e).__name__,"message":str(e)};raise
    finally:
        if service:
            service.terminate()
            try:service.wait(timeout=10)
            except subprocess.TimeoutExpired:service.kill();service.wait(timeout=10)
            services_closed=service.poll() is not None
        result["services_closed"]=services_closed
        (output/"native-result.json").write_text(canonical(result)+"\n")
    if result["complete"]:
        complete=output/"Arches_Receiving_Complete_Project.zip"
        with zipfile.ZipFile(complete,"w",compression=zipfile.ZIP_DEFLATED) as z:
            for p in app.iterdir():
                if p.name in ("arches_source.py","arches_workspace.py","arches_review_exchange.py","arches_app.py","index.html","OPERATING_GUIDE.md","ARCHES_SOURCE.md","operate.py","browser-receiving.mjs","BROWSER_RECEIVING.md","receive_public_starches.py","PUBLIC_SOURCE_RECEIVING.md","arches_native_skos.py","NATIVE_SKOS_RECEIVING.md","native_skos_receiving.py","LICENSE.txt","NOTICE.md"):z.write(p,"application/"+p.name)
            commercial=app.parent/"commercial"
            if commercial.is_dir():
                for p in sorted(commercial.glob("*.md")):
                    if p.is_file() and not p.is_symlink():z.write(p,"commercial/"+p.name)
            for p in source_root.rglob("*"):
                if p.is_file():z.write(p,"original-publisher-cohort/"+p.relative_to(source_root).as_posix())
            for name in ("Arches_Complete_Workspace.zip","Arches_Publisher_Reviewed_Release.zip","Arches_Reopened_Release.zip","native-result.json","actual-resource-review.json","staff-ui.html"):
                z.write(output/name,"receiving/"+name)
            for pattern in ("*-review-export.csv","*-staff-decisions.csv","*-preview.json"):
                for p in sorted(output.glob(pattern)):z.write(p,"receiving/staff-review/"+p.name)
        sha,size=file_hash(complete);print(canonical({"event":"complete","archive":str(complete),"bytes":size,"sha256":sha,"services_closed":services_closed}),flush=True)
        return {"archive":str(complete),"bytes":size,"sha256":sha}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--cohort",required=True);p.add_argument("--output",required=True);a=p.parse_args();run(a.cohort,a.output)
