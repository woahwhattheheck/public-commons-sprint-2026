#!/usr/bin/env python3
"""Continue the same saved ATSSC case through the actual browser and cold handover."""
from __future__ import annotations
import argparse,json,os,subprocess,sys,threading,traceback,uuid,zipfile
from pathlib import Path
from questionnaire_workspace import Workspace,receive_project
from RESPONDENT_EXERCISE import Relay,start_server,stamp,identity,b64

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--workspace",required=True,help="The existing saved commissioning workspace")
    parser.add_argument("--output",required=True,help="A new private output directory for this continuation")
    parser.add_argument("--chrome",required=True,help="The existing exact Chrome headless-shell executable")
    parser.add_argument("--playwright",help="The installed Playwright package entry or directory")
    parser.add_argument("--publication")
    parser.add_argument("--trade-source")
    parser.add_argument("--run-id")
    parser.add_argument("--resume",action="store_true",help="Continue the original retained browser run after its saved respondent submission")
    args=parser.parse_args()
    workspace_path=Path(args.workspace).resolve()
    if not (workspace_path/"questionnaires.sqlite3").is_file():
        raise ValueError("Open the original saved commissioning workspace")
    root=Path(args.output).resolve()
    prior=None
    if args.resume:
        prior=json.loads((root/"BROWSER_RECEIVING_RESULT.json").read_text())
        browser=json.loads((root/"browser"/"BROWSER_RESULT.json").read_text())
        if prior["original_workspace"]!=str(workspace_path) or not any(x["name"]=="original_respondent_saved_progress_reopen_and_submission" for x in browser["phases"]):
            raise ValueError("Resume the original saved run after its retained respondent submission")
        if prior.get("status")=="PASS":
            for retained in prior["outputs"]:
                actual=identity(Path(retained["path"]))
                if actual["bytes"]!=retained["bytes"] or actual["sha256"]!=retained["sha256"]:
                    raise ValueError("The completed original browser output changed")
            print(json.dumps({"complete":True,"status":"PASS","result":str(root/"BROWSER_RECEIVING_RESULT.json"),
                              "workspace_id":prior["workspace_id"],"revision":prior["revision"],"replayed":True}),flush=True)
            return prior
        attempt=1
        while (root/("BROWSER_RECEIVING_ATTEMPT_"+str(attempt)+".json")).exists():attempt+=1
        (root/("BROWSER_RECEIVING_ATTEMPT_"+str(attempt)+".json")).write_text(json.dumps(prior,ensure_ascii=False,indent=2)+"\n")
    else:root.mkdir(parents=True,exist_ok=False,mode=0o700)
    workspace=Workspace(workspace_path)
    original=workspace.outreach.op_status({})
    publication=args.publication
    native=workspace.op_status({})
    if not publication:
        matches=[]
        for p in native["publications"]:
            with workspace.connection() as db:
                _,definition=workspace._definition(db,p["id"])
            ids={q["id"] for q in definition["questions"]}
            if ids=={"company_name","reported_value"}:
                matches.append(p["id"])
        if len(matches)!=1:raise ValueError("Select the original published commissioning questionnaire explicitly")
        publication=matches[0]
    sources=[s["id"] for s in original["sources"] if s["kind"]=="TRADE" and s["current"]]
    trade_source=args.trade_source or (sources[0] if len(sources)==1 else None)
    if not trade_source:raise ValueError("Select the retained original commissioning trade edition explicitly")
    run_id=(prior["run_id"] if prior else args.run_id or str(uuid.uuid4()))
    result={"schema":"commons.atssc.respondent-browser-receiving.v1","operation":"ATSSC-QUESTIONNAIRE-WORKSHARE-9FCD-20261012",
            "run_id":run_id,"started_at":stamp(),"workspace_id":original["workspace_id"],"initial_revision":original["revision"],
            "original_workspace":str(workspace_path),"outputs":[]}
    relay=Relay(("127.0.0.1",0));threading.Thread(target=relay.serve_forever,daemon=True).start()
    server=None;stderr=None
    env={**{k:v for k,v in os.environ.items() if not k.startswith("ATSSC_SMTP_")},
         "ATSSC_SMTP_HOST":"127.0.0.1","ATSSC_SMTP_PORT":str(relay.server_address[1]),"ATSSC_SMTP_MODE":"PLAIN_LOCAL",
         "ATSSC_SMTP_PROVIDER":"commissioning-original-local-relay"}
    try:
        server,stderr,opening=start_server(workspace_path,env,root)
        config={"baseUrl":opening["url"],"operatorKey":Path(opening["operator_key_file"]).read_text().strip(),
                "outputDirectory":str(root/"browser"),"publicationId":publication,"tradeSourceId":trade_source,
                "runId":run_id,"resume":args.resume,"chrome_path":str(Path(args.chrome).resolve()),"playwright_module":args.playwright}
        config_path=root/"browser-input.json";config_path.write_text(json.dumps(config));os.chmod(config_path,0o600)
        print(json.dumps({"ready":True,"url":opening["url"],"workspace_id":original["workspace_id"],"run_id":run_id}),flush=True)
        run=subprocess.run(["node",str(Path(__file__).with_suffix(".mjs")),str(config_path)],
                           cwd=Path(__file__).resolve().parent,env=env,text=True,capture_output=True,timeout=600)
        (root/"browser.stdout").write_text(run.stdout);(root/"browser.stderr").write_text(run.stderr)
        result["browser_exit_code"]=run.returncode
        browser_report=root/"browser"/"BROWSER_RESULT.json"
        if browser_report.is_file():result["browser"]=json.loads(browser_report.read_text())
        print(json.dumps({"browser_exit_code":run.returncode,"stdout":run.stdout,"stderr":run.stderr},ensure_ascii=False),flush=True)
        if run.returncode:raise RuntimeError("The same-case browser operation returned a failure; its original progress and current case are retained")
        if not result.get("browser",{}).get("status")=="PASS":raise RuntimeError("The original browser report did not return its complete outcome")
        browser_project=root/"browser"/"ATSSC_Browser_Complete_Project.zip"
        project_identity=identity(browser_project)
        received=receive_project(browser_project,root/"cold-received",project_identity["sha256"])
        cold=Workspace(root/"cold-received"/"workspace")
        state=cold.outreach.op_status({})
        if state["workspace_id"]!=original["workspace_id"] or state["revision"]!=result["browser"]["revision"]:
            raise RuntimeError("The whole browser download did not reopen the exact original case")
        cold.outreach.verify_sources()
        # One original operator continuation proves the downloaded case remains editable.
        chosen=next(p["result"]["assignment_ids"][0] for p in result["browser"]["phases"] if p["name"]=="visible_original_company_assignments")
        edited=cold.outreach.invoke("log_followup",{"assignment_id":chosen,"channel":"POSTAL","outcome":"POSTAL_SENT","at":stamp(),
            "note":"Continued the original browser-downloaded company case after complete cold receiving.",
            "original_source":{"kind":"COMMISSIONING_HANDOVER","reference":"Original browser download "+run_id},
            "expected_revision":state["revision"],"actor":"Browser receiving operator","reason":"Continue the same complete received project",
            "request_id":"browser-cold-receive:"+run_id})
        final_project=root/"ATSSC_Complete_Respondent_Project_Final.zip"
        exported=cold.outreach.op_export_project({"path":str(final_project)})
        second=receive_project(final_project,root/"final-received",exported["sha256"])
        final_workspace=Workspace(root/"final-received"/"workspace");final=final_workspace.outreach.op_status({})
        if final["workspace_id"]!=original["workspace_id"] or final["revision"]!=edited["revision"]:
            raise RuntimeError("The edited browser case did not reopen as the same final edition")
        for format_name,filename in (("xlsx","ATSSC_Respondent_Operations.xlsx"),("zip","ATSSC_Respondent_Operating_Files.zip")):
            raw,_,_=final_workspace.outreach.file_bytes("operating",format_name=format_name)
            (root/filename).write_bytes(raw);os.chmod(root/filename,0o600)
        result.update({"status":"PASS","finished_at":stamp(),"revision":final["revision"],"first_receive":received,"final_receive":second,
                       "final_counts":{key:len(final[key]) for key in ("companies","contacts","assignments","sources","messages")},
                       "outputs":[identity(p) for p in (final_project,root/"ATSSC_Respondent_Operations.xlsx",root/"ATSSC_Respondent_Operating_Files.zip")],
                       "smtp_receiver_originals":[{"received_at":m["received_at"],"commands":m["commands"],"original_base64":b64(m["raw"])} for m in relay.messages]})
    except Exception as error:
        result.update({"status":"FAILED","finished_at":stamp(),"error":{"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()}})
        # Preserve the current same-case state before any browser/runtime cleanup.
        try:
            retained=workspace.outreach.op_export_project({"path":str(root/"ATSSC_Browser_Current_Case.zip")})
            result["current_case_after_failure"]=retained
        except Exception as retention_error:result["current_case_save_error"]=str(retention_error)
        raise
    finally:
        (root/"BROWSER_RECEIVING_RESULT.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        if server:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait()
        if stderr:stderr.close()
        relay.shutdown();relay.server_close()
    print(json.dumps({"complete":True,"status":result["status"],"result":str(root/"BROWSER_RECEIVING_RESULT.json"),
                      "workspace_id":result["workspace_id"],"revision":result["revision"],"outputs":result["outputs"]}),flush=True)
    return result
if __name__=="__main__":main()
