#!/usr/bin/env python3
"""One retained publisher native -> operator -> receiving -> restore journey."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid
import zipfile

sys.dont_write_bytecode=True
APPLICATION=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APPLICATION))
from groundwater_workspace import Workbench
from groundwater_workspace.common import Problem,Lock,digest,file_info,inventory,json_text,now,read_json,verify_file,write_json,lock_active,text,timestamp
from groundwater_workspace.delivery import inspect_package,receive_package,restore_workspace
from groundwater_workspace.native import completed_result,run_directory
from groundwater_workspace.sources import FINDINGS

STOP=False
def stop(*_):
    global STOP
    STOP=True
def checkpoint():
    if STOP:
        raise Problem("journey_interrupted","The original journey stopped after draining its active phase. Continue this same input and directory.")
def require(condition,message,**detail):
    if not condition:
        raise Problem("native_acceptance",message,**detail)
def handover_file(value):
    """Project the original native file descriptor into the JSON handover ABI."""
    path=value["path"]
    require(isinstance(path,(str,Path)) and Path(path).is_absolute(),
            "The native handover file must retain its original absolute path.")
    require(isinstance(value.get("filename"),str) and value["filename"]==Path(path).name,
            "The native handover filename differs from its original path.")
    verify_file(path,value)
    return {"path":str(path),"filename":value["filename"],"bytes":value["bytes"],"sha256":value["sha256"]}

def identifier(phase,operation):
    return "gw-journey-"+hashlib.sha256((operation+":"+phase).encode()).hexdigest()[:32]

SOURCE_REASONS={
 "TWRI_RECHARGE_TEXT":"The unchanged executable value 3e-8 and different prose value 3e-7 are both retained. This publisher demonstration follows the executable; changed recharge is an explicitly attributed child edition.",
 "TWRI_LEGACY_UNITS":"The original legacy DIS declaration remains metres/days. The compatible reference is a separate reviewed feet/seconds scenario; original numeric agreement is not relabelled as a physical baseline comparison.",
 "TWRI_STEADY_SOLUTION":"The retained result is one steady equilibrium output with native time metadata, not a transient 24-hour hydrograph.",
 "TWRI_NATIVE_GRID":"The publisher aquifers are explicitly mapped from MF6 0/2/4 to legacy 0/1/2 with each actual grid retained.",
 "NATIVE_UNIT_DISAGREEMENT":"The unchanged original models have different declared units. This example report preserves the conflict and withholds incompatible physical differences.",
}
def dispositions(findings):
    choices=[]
    for finding in findings:
        if finding.get("severity")=="blocking":
            raise Problem("actual_finding_requires_review","The actual native source has a blocking finding.",finding=finding)
        reason=SOURCE_REASONS.get(finding["id"])
        if reason:
            choices.append({"id":finding["id"],"disposition":"acknowledged","reason":reason})
        elif finding.get("severity")=="review":
            raise Problem("actual_finding_requires_review","A new actual numerical finding needs its named operator's review; it was not automatically approved.",finding=finding)
    return choices

class Journey:
    def __init__(self,config,source_revision=None):
        self.config=config
        require(Path(config["work_directory"]).is_absolute(),"Work directory must be absolute.")
        self.root=Path(config["work_directory"]).resolve()
        self.operation=config["operation_id"]
        require(self.root.is_absolute(),"Work directory must be absolute.")
        require(not self.root.is_relative_to(APPLICATION) and not APPLICATION.is_relative_to(self.root),"Keep the complete native workspace outside the application source directory.")
        for parent in (self.root,*self.root.parents):
            require(not (parent/".git").exists(),"The unchanged publisher must run outside a Git checkout.",path=str(parent))
        self.root.mkdir(parents=True,exist_ok=True)
        self.requests=self.root/"requests";self.requests.mkdir(exist_ok=True)
        self.output=self.root/"output";self.output.mkdir(exist_ok=True)
        source=inventory(APPLICATION)
        # Preserve the original input and every queued worker. A reviewed caller
        # correction is an additional immutable selection, never an input rewrite.
        intent={"schema":"starforge.groundwater-publisher-journey.v1","config":config,"application_files":source,"application_sha256":digest(source)}
        intent_path=self.root/"journey-input.json"
        self.application_sha256=intent["application_sha256"]
        self.source_head=config.get("source_head")
        self.source_revision=None
        if intent_path.exists():
            initial=read_json(intent_path)
            require(initial.get("schema")==intent["schema"] and initial.get("config")==config,"Continue the exact original configuration; the journey input differs.")
            require(initial.get("application_sha256")==digest(initial.get("application_files",[])),"The retained original application manifest changed.")
            if initial!=intent:
                revision_path=self.root/"application-revisions"/(self.application_sha256+".json")
                require(source_revision is not None or revision_path.is_file(),"Select the complete reviewed source revision for this original journey with --source-revision.")
                revision=read_json(source_revision if source_revision is not None else revision_path)
                require(revision.get("schema")=="starforge.groundwater-journey-source-revision.v1","Select a complete original source revision record.")
                require(revision.get("operation_id")==self.operation and revision.get("initial_input_sha256")==digest(initial),"The source revision belongs to another original journey.")
                require(revision.get("application_files")==source and revision.get("application_sha256")==self.application_sha256,"The source revision differs from the complete currently installed application.")
                head=revision.get("source_head","")
                require(isinstance(head,str) and len(head)==40 and all(c in "0123456789abcdef" for c in head),"The source revision must name its full reviewed Git commit.")
                require(revision.get("actor")==config["actor"],"The original operator must attribute the source continuation.")
                text(revision.get("reason"),"Source continuation reason",8000,True)
                timestamp(revision.get("created"),"Source continuation time")
                write_json(revision_path,revision,create_only=True)
                self.source_revision=revision
                self.source_head=head
        else:
            require(source_revision is None,"A source revision continues an existing original journey.")
            write_json(intent_path,intent,create_only=True)
            initial=intent
        self.initial_application_sha256=initial["application_sha256"]
        initial_id=str(uuid.uuid5(uuid.NAMESPACE_URL,"starforge:groundwater:"+self.operation))
        self.work=Workbench(self.root/"workspace",APPLICATION,initial_workspace_id=initial_id)
        self.actor=config["actor"]
    def op(self,phase,action,payload):
        checkpoint()
        path=self.requests/(phase+".json")
        if path.exists():
            request=read_json(path)
            require((request["action"],request["payload"],request["actor"])==(action,payload,self.actor),"The saved phase has another original request.",phase=phase)
        else:
            request={"action":action,"actor":self.actor,"operation_id":identifier(phase,self.operation),"expected_version":self.work.state()["workspace"]["version"],"payload":payload}
            write_json(path,request,create_only=True)
        try:
            prior=self.work.operation(request["operation_id"])
        except Problem as exc:
            if exc.code!="operation_not_recorded":
                raise
            self.work.dispatch(request)
            prior=self.work.operation(request["operation_id"])
        else:
            if action in ("run.execute","run.resume"):
                self.work.dispatch(request)
                prior=self.work.operation(request["operation_id"])
        require(prior["request"]==request,"Original operation readback changed.",phase=phase)
        write_json(self.output/(phase+"-operation.json"),prior,create_only=True)
        return prior["result"]
    def wait_run(self,run_id):
        deadline=time.monotonic()+int(self.config.get("run_timeout_seconds",7200))
        while True:
            detail=self.work.run_detail(run_id)
            if detail["result"] and not detail["run"]["worker_active"]:
                return detail["result"]
            if not detail["run"]["worker_active"] and detail["run"]["state"] in ("failed","interrupted"):
                raise Problem("actual_native_incomplete","The original native attempt did not complete; inspect and continue that exact run.",run=detail["run"],log=detail.get("log_excerpt"))
            if time.monotonic()>deadline:
                raise Problem("actual_native_pending","The original child is still retained; no replacement run was created.",run=detail["run"])
            # Stop requests drain the already owned native phase before ending.
            time.sleep(1)
    def execute(self,phase,edition_id,retry_runs):
        run_id=self.op(phase+"-queue","run.create",{"edition_id":edition_id,"reason":"Actual original TWRI dual-solver "+phase+"; publisher technical demonstration only."})["id"]
        current=self.work.run_detail(run_id)
        if current["result"] and not current["run"]["worker_active"]:
            return run_id,current["result"]
        if current["run"]["state"]=="queued":
            self.op(phase+"-execute","run.execute",{"id":run_id,"reason":"Execute this original queued dual-solver run."})
        elif not current["run"]["worker_active"]:
            require(run_id in retry_runs,"The incomplete original run requires explicit --retry-run ORIGINAL_ID after review.",run_id=run_id,attempts=current["attempts"])
            self.op(phase+"-resume-"+str(current["run"]["attempt"]),"run.resume",{"id":run_id,"reason":"Explicitly resume the reviewed incomplete original run and preserve its earlier attempt.","retry_incomplete":True,"rebind_runtime":False})
        result=self.wait_run(run_id);checkpoint()
        return run_id,result
    def prepare(self,retry_runs):
        project_id=self.op("project","project.create",{"name":"USGS TWRI original and attributed scenarios","description":"Published numerical example and explicit operator demonstration scenarios. No site calibration, customer design approval or field observation is asserted.","site_label":""})["id"]
        original=self.op("publisher","source.publisher",{"project_id":project_id,"name":"Unchanged USGS TWRI publisher baseline"})
        source_id,baseline_id=original["source_id"],original["edition_id"]
        self.op("runtime","runtime.configure",{**self.config["runtime"],"reason":"Use the actual selected publisher-compatible Python closure, MF6 6.8.1 and mf2005dbl 1.12.00; retain complete native identities."})
        self.op("baseline-edition-review","edition.review",{"id":baseline_id,"decision":"approved","reason":"Retain and inspect the unchanged historical publisher baseline with its explicit source and native metadata discrepancies.","findings":dispositions(FINDINGS)})
        baseline_run,baseline=self.execute("baseline",baseline_id,retry_runs)
        require(baseline["publisher_comparison"]["executed"],"The unchanged original publisher assertion and plots did not execute.")
        require(baseline["engines"]["mf6"]["units"]=={"length":"feet","time":"seconds"},"MF6 actual declaration differs from the original source.")
        require(baseline["engines"]["mf2005"]["units"]=={"length":"metres","time":"days"},"The unchanged legacy baseline metadata was altered.")
        require(baseline["time_semantics"]=="steady_solution" and all(len(x["heads"])==1 for x in baseline["engines"].values()),"The actual original study did not retain its one steady output.")
        self.op("baseline-run-review","run.review",{"id":baseline_run,"decision":"approved","reason":"Approve retention of the actual publisher numerical example with its separately visible unit conflict; no physical baseline equivalence or customer acceptance is asserted.","findings":dispositions(baseline["findings"])})
        aligned=self.op("compatible-reference","edition.create",{"project_id":project_id,"parent_id":baseline_id,"name":"Attributed compatible-unit reference","description":"Operator demonstration: change only the legacy native metadata to the source's intended feet/seconds; preserve all numerical inputs and the unchanged original baseline.","changes":[{"kind":"legacy_units","before":{"length":"metres","time":"days"},"after":{"length":"feet","time":"seconds"},"reason":"Separate explicit metadata correction for a physically compatible scenario reference; original DIS defaults remain retained."}]})["id"]
        self.op("reference-edition-review","edition.review",{"id":aligned,"decision":"approved","reason":"Approve this explicit metadata-only reference for the publisher demonstration, preserving the original baseline.","findings":dispositions(FINDINGS)})
        reference_run,reference=self.execute("reference",aligned,retry_runs)
        require(reference["engines"]["mf6"]["units"]==reference["engines"]["mf2005"]["units"]=={"length":"feet","time":"seconds"},"The reviewed reference's actual native units did not align.")
        self.op("reference-run-review","run.review",{"id":reference_run,"decision":"approved","reason":"Review the actual compatible-unit reference as a publisher demonstration; it preserves the original numerical inputs and records fresh native outputs.","findings":dispositions(reference["findings"])})
        # Re-import the complete actually generated native model tree through the UI.
        original_attempt=run_directory(self.work,baseline_run)/"attempts"/str(self.work.record(baseline_run,"run")["attempt"])
        model_root=original_attempt/"ex-gwf-twri01"
        rows=inventory(model_root)
        package_path=self.root/"actual-publisher-native-models.zip"
        package_request={"baseline_run_id":baseline_run,"baseline_result_sha256":digest(baseline),"files":rows}
        write_json(self.root/"native-package-input.json",package_request,create_only=True)
        if not package_path.exists():
            temporary=self.root/"actual-publisher-native-models.zip.pending"
            if temporary.exists():
                raise Problem("native_package_pending","The original model ZIP publication is incomplete; preserve its existing temporary.")
            with zipfile.ZipFile(temporary,"x",compression=zipfile.ZIP_DEFLATED) as archive:
                for row in rows:
                    source=model_root/row["path"];verify_file(source,row)
                    info=zipfile.ZipInfo("ex-gwf-twri01/"+row["path"],date_time=(1980,1,1,0,0,0))
                    info.compress_type=zipfile.ZIP_DEFLATED
                    info.external_attr=0o100600<<16
                    archive.writestr(info,source.read_bytes())
            os.link(temporary,package_path);temporary.unlink()
        with zipfile.ZipFile(package_path) as archive:
            require(set(archive.namelist())=={"ex-gwf-twri01/"+row["path"] for row in rows},"The retained model ZIP file set differs from its original native run.")
            for row in rows:
                require(digest(archive.read("ex-gwf-twri01/"+row["path"]))==row["sha256"],"A re-imported native model original changed.",path=row["path"])
        receiving=self.root/"receiving";receiving.mkdir(exist_ok=True)
        handoff={"schema":"starforge.groundwater-browser-handoff.v1","operation_id":self.operation,"application":str(APPLICATION),"source_head":self.source_head,"application_sha256":self.application_sha256,"initial_application_sha256":self.initial_application_sha256,"source_revision":self.source_revision,"workspace":str(self.work.directory),"workspace_id":self.work.state()["workspace"]["id"],"project_id":project_id,"source_id":source_id,"baseline_edition_id":baseline_id,"baseline_run_id":baseline_run,"reference_edition_id":aligned,"reference_run_id":reference_run,"actor":self.actor,"receiving_actor":self.config["receiving_actor"],"receiver_directory":str(receiving),"output_directory":str(self.output),"browser_journal":str(self.root/"browser"),"runtime":self.config["runtime"],"node_executable":self.config["node_executable"],"playwright_module":self.config["playwright_module"],"browser_executable":self.config["browser_executable"],"port":int(self.config.get("port",8894)),"run_timeout_seconds":int(self.config.get("run_timeout_seconds",7200)),"source_finding_reasons":SOURCE_REASONS,"native_package":{"path":str(package_path),**file_info(package_path),"mf6_namefile":"ex-gwf-twri01/mfsim.nam","legacy_namefile":"ex-gwf-twri01/mf2005/ex-gwf-twri01.nam"}}
        handoff_path=self.root/"browser-handoff.json"
        if handoff_path.exists():
            original_handoff=read_json(handoff_path)
            context_keys={"source_head","application_sha256","initial_application_sha256","source_revision"}
            stable_handoff=lambda value:{key:item for key,item in value.items() if key not in context_keys}
            require(stable_handoff(original_handoff)==stable_handoff(handoff),
                    "The original browser handoff data, paths or operation selections changed.")
            if original_handoff!=handoff:
                require(self.source_revision is not None,"An updated browser source requires the original attributed application revision.")
                revision={"schema":"starforge.groundwater-browser-handoff-source-revision.v1",
                          "operation_id":self.operation,"original_handoff_sha256":digest(original_handoff),
                          "application_sha256":self.application_sha256,"source_revision":self.source_revision,
                          "current_source_context":{key:handoff[key] for key in sorted(context_keys)}}
                write_json(self.root/"browser-handoff-revisions"/(self.application_sha256+".json"),revision,create_only=True)
            # Existing browser input and every original phase keep their exact
            # saved bytes. The actual current caller is attributed separately.
            handoff=original_handoff
        else:
            write_json(handoff_path,handoff,create_only=True)
        print(json_text({"phase":"prepared","handoff":str(handoff_path),"baseline_run_id":baseline_run,"reference_run_id":reference_run}),flush=True)
        return handoff
    def operator(self,workspace,port):
        log=(self.output/("operator-"+str(port)+".stderr.log")).open("ab",buffering=0)
        child=subprocess.Popen([sys.executable,"-B",str(APPLICATION/"workspace.py"),"serve","--workspace",str(workspace),"--port",str(port)],stdout=subprocess.PIPE,stderr=log,text=True)
        line=child.stdout.readline()
        try:
            value=json.loads(line)
            require(value.get("state")=="listening","Original operator did not start.",output=line)
        except BaseException:
            if child.poll() is None:
                child.terminate()
            child.wait();log.close();raise
        return child,log,value["url"]
    def browser(self,handoff,mode="operate"):
        checkpoint()
        workspace=handoff.get("restored_workspace",handoff["workspace"]) if mode=="restored" else handoff["workspace"]
        server,log,url=self.operator(workspace,handoff["port"])
        child=None
        try:
            supplied={**handoff,"operator_url":url,"mode":mode}
            input_path=self.root/("browser-"+mode+"-input.json")
            write_json(input_path,supplied,create_only=True)
            with (self.output/("browser-"+mode+".log")).open("ab",buffering=0) as stream:
                child=subprocess.Popen([handoff["node_executable"],str(APPLICATION/"examples"/"browser_workflow.mjs"),str(input_path)],stdout=stream,stderr=subprocess.STDOUT)
                code=child.wait()
            require(code==0,"Original browser continuation is incomplete; retain its phase requests and current native runs.",mode=mode,exit_code=code)
        finally:
            # A browser stop never creates a replacement native attempt. Drain any active
            # original run before closing its receiving server.
            while any(row["worker_active"] for row in self.work.state(handoff["project_id"])["runs"]):
                time.sleep(1)
            if server.poll() is None:
                server.terminate()
            server.wait()
            log.close()
        return read_json(self.output/("browser-"+mode+"-result.json"))
    def complete(self,handoff):
        browser=read_json(self.output/"browser-operate-result.json")
        require(browser["workspace_id"]==handoff["workspace_id"] and browser["operation_id"]==self.operation,"Browser result belongs to another original workspace.")
        for row in browser.get("screenshots",[]):
            verify_file(self.output/row["path"],row)
        state=self.work.state(handoff["project_id"])
        ids=[handoff["baseline_run_id"],handoff["reference_run_id"],browser["scenario_run_id"]]
        results=[completed_result(self.work,self.work.record(value,"run")) for value in ids]
        require(not any(row["worker_active"] for row in state["runs"]),"A native worker still owns the original workspace.")
        report=self.work.report_detail(browser["report_id"])
        archive=self.work.report_export(browser["report_id"],"zip")
        package=inspect_package(archive["path"])
        received=receive_package(archive["path"],self.root/"independent-report")
        require(received["receipt"]["report_id"]==browser["report_id"],"Independent receiving lost the frozen report identity.")
        delivery=self.work.record(browser["delivery_id"],"delivery")
        delivered=Path(delivery["receiver"]["directory"])/delivery["filename"]
        verify_file(delivered,delivery)
        backup=self.work.backup_file(browser["backup_id"])
        inspect_package(backup["path"])
        restored=restore_workspace(backup["path"],self.root/"restored")
        with Workbench(restored["workspace"],existing_only=True) as reopened:
            restored_state=reopened.state(handoff["project_id"])
            require(restored_state["workspace"]["id"]==handoff["workspace_id"],"Restore changed the original workspace UUID.")
            for original in results:
                actual=completed_result(reopened,reopened.record(original["run_id"],"run"))
                require(digest(actual)==digest(original),"Restore changed original native output.",run_id=original["run_id"])
            for phase in self.requests.glob("*.json"):
                request=read_json(phase)
                require(reopened.operation(request["operation_id"])==self.work.operation(request["operation_id"]),"Restore changed a committed original operation.",operation_id=request["operation_id"])
            for request in browser["requests"]:
                require(reopened.operation(request["operation_id"])["request_sha256"]==request["request_sha256"],"Restore lost an original browser operation.")
            if browser.get("reference_inspection_id"):
                original_source=self.work.source_detail(browser["imported_source_id"])
                restored_source=reopened.source_detail(browser["imported_source_id"])
                require(restored_source["source"]==original_source["source"],"Restore changed the original imported source.")
                expected_basis=original_source["reference_inspection"]["basis"]
                actual_basis=restored_source["reference_inspection"]["basis"]
                require(expected_basis==actual_basis and actual_basis["inspection_id"]==browser["reference_inspection_id"] and actual_basis["sha256"]==browser["reference_basis_sha256"],
                        "Restore changed the original attributed reference inspection.")
            reopened.report_detail(browser["report_id"])
            require(all(row["status"]=="external_archive" for row in restored_state["backups"]),"Restored backup history points to unavailable local archives.")
            require(not any(row["worker_active"] for row in restored_state["runs"]),"Restore unexpectedly started a solver.")
        full_handoff={**handoff,"restored_workspace":str(restored["workspace"]),"report_id":browser["report_id"],"scenario_run_id":browser["scenario_run_id"],"backup":handover_file(backup)}
        if browser.get("reference_inspection_id"):
            full_handoff.update({key:browser[key] for key in ("imported_source_id","imported_source_sha256","reference_inspection_id","reference_basis_sha256")})
        write_json(self.root/"restored-browser-handoff.json",full_handoff,create_only=True)
        restored_browser=self.browser(full_handoff,"restored")
        result={"schema":"starforge.groundwater-publisher-native.v1","state":"complete","operation_id":self.operation,"workspace_id":handoff["workspace_id"],"source_head":self.source_head,"browser_handoff_source_head":handoff.get("source_head"),"application_sha256":self.application_sha256,"initial_application_sha256":self.initial_application_sha256,"source_revision":self.source_revision,"runs":[{"id":r["run_id"],"edition_id":r["edition_id"],"result_sha256":digest(r),"runtime_sha256":r["runtime_sha256"],"units":{k:v["units"] for k,v in r["engines"].items()},"native_executions":r["native_executions"]} for r in results],"browser":browser,"restored_browser":restored_browser,"report":{"id":browser["report_id"],"archive":handover_file(archive),"manifest_sha256":package["manifest_sha256"],"files":package["files"]},"independent_receiving":received["receipt"],"delivery_id":browser["delivery_id"],"backup":full_handoff["backup"],"restore":restored,"all_owned_services_closed":True,"completed_at":now()}
        result_path=self.output/"native-result.json"
        if result_path.exists():
            prior=read_json(result_path)
            # Completion is immutable; all originals above were verified before replay.
            require(prior["operation_id"]==self.operation and prior["backup"]==result["backup"],"Original completed journey identifies different receiving artifacts.")
            return prior
        write_json(result_path,result,create_only=True)
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("--phase",choices=("all","prepare","complete"),default="all")
    parser.add_argument("--retry-run",action="append",default=[])
    parser.add_argument("--source-revision",help="Explicit reviewed source continuation record; original input and queued workers remain unchanged")
    args=parser.parse_args()
    config=read_json(args.input)
    require(config.get("schema")=="starforge.groundwater-publisher-input.v1","Select the complete original publisher input schema.")
    for name in ("operation_id","work_directory","actor","receiving_actor","runtime","node_executable","playwright_module","browser_executable"):
        require(bool(config.get(name)),"Original input field is required.",field=name)
    for signum in (signal.SIGTERM,signal.SIGINT):
        signal.signal(signum,stop)
    journey=Journey(config,args.source_revision)
    with Lock(journey.root/"journey.lock",blocking=False):
        if args.phase in ("all","prepare"):
            handoff=journey.prepare(set(args.retry_run))
            if args.phase=="prepare":
                return 0
        else:
            handoff=read_json(journey.root/"browser-handoff.json")
        if args.phase=="all":
            journey.browser(handoff)
        result=journey.complete(handoff)
    print(json_text({"state":result["state"],"result":str(journey.output/"native-result.json"),"backup":result["backup"],"report":result["report"],"all_owned_services_closed":True}),flush=True)
    return 0

if __name__=="__main__":
    try:
        sys.exit(main())
    except Problem as exc:
        print(json_text({"state":"incomplete","error":exc.as_dict()}),file=sys.stderr,flush=True)
        sys.exit(2)
