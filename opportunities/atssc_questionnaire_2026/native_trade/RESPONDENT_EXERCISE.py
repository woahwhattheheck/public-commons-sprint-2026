#!/usr/bin/env python3
"""Operate the original ATSSC company/respondent/relay/export lifecycle."""
from __future__ import annotations
import argparse,base64,hashlib,http.cookiejar,io,json,os,selectors,socketserver,subprocess,sys,tempfile,threading,time,traceback,urllib.error,urllib.request,uuid,zipfile
from datetime import datetime,timedelta,timezone
from email.utils import format_datetime
from pathlib import Path
from questionnaire_workspace import Workspace,receive_project
from respondent_operations import make_xlsx
from respondent_source import read_source,map_source

ARCHIVE_SHA="f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e"
ARCHIVE_BYTES=2691467
ARCHIVE_URL="https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/988f2172887d2eb60665e43a64cc52532779eb5f/atssc-questionnaire-source-2026/originals/ATSSC_Original_Annexes_and_Workbook_Catalogue.zip"
SOURCE=Path(__file__).resolve().parent
class RpcError(RuntimeError):
    def __init__(self,status,value):
        error=value.get("error",{})
        self.code=error.get("code") if isinstance(error,dict) else None
        self.detail=error.get("detail") if isinstance(error,dict) else None
        self.status=status
        super().__init__(error.get("message",str(error)) if isinstance(error,dict) else str(error))
def sha(raw):return hashlib.sha256(raw).hexdigest()
def stamp():return datetime.now(timezone.utc).isoformat()
def identity(path):
    raw=Path(path).read_bytes()
    return {"path":str(path),"bytes":len(raw),"sha256":sha(raw)}
def b64(raw):return base64.b64encode(raw).decode()
class Client:
    def __init__(self,url):
        self.url=url
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(self,path,value=None):
        data=None if value is None else json.dumps(value,ensure_ascii=False).encode()
        request=urllib.request.Request(self.url+path,data=data,headers={"Origin":self.url,"Content-Type":"application/json"})
        try:
            with self.opener.open(request,timeout=60) as response:
                raw=response.read()
                if response.headers.get("Content-Type","").startswith("application/json"):return json.loads(raw)
                return raw
        except urllib.error.HTTPError as error:
            raise RpcError(error.code,json.loads(error.read())) from error
    def invoke(self,method,params=None):
        return self.request("/api/invoke",{"method":method,"params":params or {}})["result"]
    def op(self,method,params=None):return self.invoke("outreach."+method,params)
    def change(self,method,params=None,reason="Operate the original complete commissioning case",request_id=None):
        return self.op(method,{**(params or {}),"expected_revision":self.op("status")["revision"],
                    "actor":"ATSSC native commissioning operator","reason":reason,
                    "request_id":request_id or str(uuid.uuid4())})
class Relay(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True
    def __init__(self,address):
        super().__init__(address,RelayHandler)
        self.messages=[];self.lock=threading.Lock()
class RelayHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b"220 commissioning.local ESMTP\r\n");self.wfile.flush()
        envelope={"commands":[]}
        while True:
            line=self.rfile.readline(1000000)
            if not line:return
            command=line.rstrip(b"\r\n")
            verb=command.split(b" ",1)[0].upper()
            envelope["commands"].append(command.decode("utf-8","replace"))
            if verb in (b"EHLO",b"HELO"):
                reply=b"250-commissioning.local\r\n250-DSN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n"
            elif verb in (b"MAIL",b"RCPT",b"RSET",b"NOOP"):reply=b"250 2.1.0 recorded\r\n"
            elif verb==b"DATA":
                self.wfile.write(b"354 End with a dot\r\n");self.wfile.flush()
                chunks=[]
                while True:
                    block=self.rfile.readline(1000000)
                    if block==b".\r\n":break
                    if not block:return
                    if block.startswith(b".."):block=block[1:]
                    chunks.append(block)
                raw=b"".join(chunks)
                with self.server.lock:
                    self.server.messages.append({**envelope,"raw":raw,"received_at":stamp()})
                    number=len(self.server.messages)
                reply=("250 2.0.0 stored-original-"+str(number)+"\r\n").encode()
            elif verb==b"QUIT":
                self.wfile.write(b"221 2.0.0 closing\r\n");self.wfile.flush();return
            else:reply=b"502 5.5.1 command unavailable\r\n"
            self.wfile.write(reply);self.wfile.flush()
def start_server(workspace,env,root):
    out=(root/"server.stderr").open("ab")
    process=subprocess.Popen([sys.executable,str(SOURCE/"server.py"),"--workspace",str(workspace),"--port","0"],
        cwd=SOURCE,env=env,stdout=subprocess.PIPE,stderr=out,text=True)
    selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
    if not selector.select(30):
        process.terminate();raise RuntimeError("Original HTTP application did not print its opening result")
    line=process.stdout.readline()
    if not line:
        process.wait(timeout=5);raise RuntimeError((root/"server.stderr").read_text())
    opening=json.loads(line)
    return process,out,opening
def provider_dsn(message,action="delivered"):
    wire=message["wire"];recipient=message["recipient"]
    status="2.0.0" if action=="delivered" else "5.1.1"
    at=format_datetime(datetime.now(timezone.utc))
    boundary="dsn-"+message["id"]
    text=("From: native-relay@commissioning.invalid\r\nTo: staff@commissioning.invalid\r\n"
      "Date: "+at+"\r\nMessage-ID: <dsn-"+message["id"]+"@commissioning.invalid>\r\n"
      "MIME-Version: 1.0\r\nContent-Type: multipart/report; report-type=delivery-status; boundary=\""+boundary+"\"\r\n\r\n"
      "--"+boundary+"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThe local commissioning receiver retained the original message.\r\n"
      "--"+boundary+"\r\nContent-Type: message/delivery-status\r\n\r\n"
      "Reporting-MTA: dns; commissioning.local\r\nOriginal-Envelope-Id: "+wire["envelope_id"]+"\r\nArrival-Date: "+at+"\r\n\r\n"
      "Final-Recipient: rfc822; "+recipient+"\r\nAction: "+action+"\r\nStatus: "+status+"\r\nLast-Attempt-Date: "+at+"\r\n"
      "Diagnostic-Code: smtp; "+("250 original retained" if action=="delivered" else "550 commissioning recipient unavailable")+"\r\n\r\n"
      "--"+boundary+"\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: "+wire["message_id"]+"\r\nTo: "+recipient+"\r\n\r\n"
      "--"+boundary+"--\r\n")
    return text.encode()
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--output",required=True);parser.add_argument("--annex");parser.add_argument("--workspace",help="Continue the original product in this existing native workspace");args=parser.parse_args()
    root=Path(args.output).resolve();root.mkdir(parents=True,exist_ok=False,mode=0o700)
    report={"schema":"commons.atssc.respondent-native-operation.v1","operation":"ATSSC-QUESTIONNAIRE-WORKSHARE-9FCD-20261012","started_at":stamp(),
            "source_application":"Complete joined Native-Trade PR2598 application with the original respondent operating arm",
            "case_data":"Explicit local commissioning company/contact/trade examples; all issuer Annex workbook bytes are the unchanged original source.",
            "phases":[],"outputs":[]}
    server=None;relay=None;stderr=None
    def phase(name,value):
        report["phases"].append({"name":name,"at":stamp(),"result":value})
        (root/"native-progress.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        print(json.dumps({"phase":name,"state":"complete"},ensure_ascii=False),flush=True)
    try:
        annex=Path(args.annex) if args.annex else Path("/workspace/scratch/609f373a480f/atssc-workbook-interop/originals/ATSSC_Original_Annexes_and_Workbook_Catalogue.zip")
        if annex.is_file():original=annex.read_bytes()
        else:
            with urllib.request.urlopen(ARCHIVE_URL,timeout=90) as response:original=response.read()
            annex=root/"ATSSC_Original_Annexes_and_Workbook_Catalogue.zip";annex.write_bytes(original)
        assert len(original)==ARCHIVE_BYTES and sha(original)==ARCHIVE_SHA
        workspace=Workspace(args.workspace if args.workspace else root/"workspace")
        existing=workspace.outreach.op_status({})
        if existing["profile"] or existing["companies"] or existing["contacts"]:
            raise RuntimeError("This full commissioning case requires an unconfigured respondent register; its existing programme must be continued by its retained IDs")
        with zipfile.ZipFile(io.BytesIO(original)) as archive:
            paths=sorted(n for n in archive.namelist() if n.lower().endswith(".xlsx"))
            assert len(paths)==5
            books=[]
            for path in paths:
                raw=archive.read(path)
                received=workspace.invoke("import_workbook",{"name":Path(path).name,"data_base64":b64(raw),"expected_sha256":sha(raw),"source_url":ARCHIVE_URL})
                books.append({"original_path":path,**received})
        phase("original_five_issuer_workbooks_received",{"archive_sha256":ARCHIVE_SHA,"workbooks":books})
        relay=Relay(("127.0.0.1",0));threading.Thread(target=relay.serve_forever,daemon=True).start()
        env={**{k:v for k,v in os.environ.items() if not k.startswith("ATSSC_SMTP_")},"ATSSC_SMTP_HOST":"127.0.0.1","ATSSC_SMTP_PORT":str(relay.server_address[1]),
             "ATSSC_SMTP_MODE":"PLAIN_LOCAL","ATSSC_SMTP_PROVIDER":"commissioning-original-local-relay"}
        server,stderr,opening=start_server(workspace.directory,env,root)
        client=Client(opening["url"])
        client.request("/api/session",{"role":"operator","access_code":Path(opening["operator_key_file"]).read_text().strip()})
        now=datetime.now(timezone.utc);notice=(now-timedelta(days=3)).isoformat();due=(now+timedelta(days=7)).isoformat()
        client.change("save_profile",{"expected_version":0,"profile":{"case_reference":"ATSSC-RFI-008 · commissioning","case_title":"Complete company and questionnaire operating journey",
            "organization_name":"Commissioning questionnaire office","support_contact":"support@commissioning.invalid",
            "application_url":opening["url"],"sender_email":"office@commissioning.invalid","staff_email":"staff@commissioning.invalid",
            "notice_at":notice,"due_at":due,"automatic_notifications":True,
            "followup_settings":{"initial_followup_hours":24,"before_due_days":2,"automatic":True,"after_due":False}}})
        client.change("install_templates")
        questionnaire=client.invoke("create_questionnaire",{"name":"Original respondent operating commissioning"})
        definition={"title":"Company response / Réponse de l'entreprise","source_workbooks":[b["sha256"] for b in books],
            "questions":[{"id":"company_name","label":"Company name","kind":"text","required":True,"disclosure":"public"},
                         {"id":"reported_value","label":"Reported value","kind":"number","required":True,"minimum":"0","disclosure":"protected"}]}
        saved=client.invoke("save_definition",{"questionnaire_id":questionnaire["questionnaire_id"],"expected_version":0,"definition":definition})
        publication=client.invoke("publish",{"questionnaire_id":saved["questionnaire_id"],"expected_version":saved["version"]})
        phase("native_case_profile_publication_and_bilingual_templates",{"workspace_id":opening["workspace_id"],"publication_id":publication["publication_id"],"templates":len(client.op("status")["templates"])})
        trade=("Company ID,Company,HS,Country,Value\nA,Commissioning Importer A,847130,CN,700.10\n"
               "B,Commissioning Importer B,847130,CN,200.20\nC,Commissioning Importer C,847130,CN,99.70\n"
               "A,Commissioning Importer A,847130,CN,-0.10\nA,Commissioning Importer A,850440,US,100\n"
               "C,Commissioning Importer C,850440,US,400\nD,Commissioning Importer D,850440,US,500\n").encode()
        trade_input={"source":{"name":"Commissioning_Trade_Original.csv","content_base64":b64(trade),"options":{"format":"CSV","header_row":1,"encoding":"utf-8-sig","delimiter":","}},
                     "kind":"TRADE","mapping":{"company_id":"A","company_name":"B","hs_code":"C","country":"D","value_for_duty":"E"},
                     "settings":{"currency":"CAD","numbers":{"decimal_separator":".","group_separator":""}}}
        preview=client.op("preview_source",trade_input);assert preview["mapping"]["counts"]=={"rows":7,"valid":7,"invalid":0,"with_warnings":1}
        trade_id=client.change("receive_source",{**trade_input,"review_sha256":preview["mapping"]["review_sha256"]})["source_id"]
        policy={"target_percent":"80","group_by":["hs_code","country"],"value_basis":"NET_COMPANY","mode":"AUTO","negative_values_reviewed":True,
                "additional_companies":[{"company_id":"E","name":"Commissioning Interested Party E","reason":"Recorded local commissioning referral",
                                       "source":{"kind":"COMMISSIONING_REFERRAL","reference":"Local operating source input E"}}]}
        coverage=client.op("preview_coverage",{"source_id":trade_id,"policy":policy})
        assert coverage["ready"] and len(coverage["selected_companies"])==5
        assert sorted(g["net_value"] for g in coverage["groups"])==["1000","999.90"]
        plan=client.change("save_coverage",{"source_id":trade_id,"policy":policy,"review_sha256":coverage["review_sha256"],"name":"Reviewed original trade scope"})["coverage"]
        phase("whole_trade_source_and_exact_representative_coverage",{"source_id":trade_id,"coverage_id":plan["id"],"groups":coverage["groups"],"selected":coverage["selected_companies"]})
        table={"Contacts":{"headers":["Company ID","Company","Contact","Email","Language","Phone","Office"],
                "rows":[["A","Commissioning Importer A","Alice Example","alice@commissioning.invalid","EN","+1 555 0100","East"],
                        ["B","Commissioning Importer B","Boîte générale","general@commissioning.invalid","FR","+1 555 0101","Québec"],
                        ["C","Commissioning Importer C","Casey Example","casey@commissioning.invalid","EN","+1 555 0102","West"],
                        ["D","Commissioning Importer D","Dee Example","dee@commissioning.invalid","EN","+1 555 0103","Central"],
                        ["E","Commissioning Interested Party E","Eli Example","eli@commissioning.invalid","EN","+1 555 0104","North"],
                        ["A","Commissioning Importer A","Alice Example","alice@commissioning.invalid","EN","+1 555 0100","East"]]}}
        contact_bytes=make_xlsx(table)
        contact_input={"source":{"name":"Commissioning_Contacts_Original.xlsx","content_base64":b64(contact_bytes),"options":{"format":"XLSX","sheet":"Contacts","header_row":1}},
            "kind":"CONTACTS","mapping":{"company_id":"A","company_name":"B","contact_name":"C","email":"D","language":"E","phone":"F","custom.Office":"G"},
            "settings":{"default_language":"EN"}}
        cp=client.op("preview_source",contact_input);assert cp["mapping"]["counts"]["rows"]==6
        contact_source=client.change("receive_source",{**contact_input,"review_sha256":cp["mapping"]["review_sha256"]})["source_id"]
        choices=[{"row_id":r["id"],"action":"SKIP" if n==5 else "CREATE","kind":"GENERIC_INBOX" if r["company_id"]=="B" else "PERSON",
                  "reason":"Reviewed repeated original contact row" if n==5 else "Original named source contact"} for n,r in enumerate(cp["mapping"]["rows"])]
        contacts=client.change("receive_contacts",{"source_id":contact_source,"rows":choices})["results"]
        state=client.op("status");assert len(state["contacts"])==5 and all(c["custom"].get("Office") for c in state["contacts"])
        assignments=client.change("assign",{"assignments":[{"company_id":c["company_id"],"contact_id":c["id"],"publication_id":publication["publication_id"],"coverage_id":plan["id"]} for c in state["contacts"]]})["assignments"]
        by_company={a["company_id"]:a for a in assignments}
        phase("whole_contact_source_review_and_original_respondent_assignments",{"contact_source_id":contact_source,"source_rows":len(choices),"contacts":len(state["contacts"]),"assignments":[{"id":a["id"],"respondent_id":a["respondent_id"],"company_id":a["company_id"]} for a in assignments]})
        def prepare(assignment,kind="INVITATION",extra=None):
            params={"assignment_id":assignment["id"],"template_id":"standard-"+kind.lower()+"-"+assignment["language"].lower(),"at":stamp(),**(extra or {})}
            review=client.op("preview_message",params)
            return client.change("retain_message",{**params,"review_sha256":review["review_sha256"]})["message"]
        message=prepare(by_company["A"]);dispatch_id="native-original-smtp-"+message["id"]
        outcome=client.change("dispatch",{"id":message["id"]},request_id=dispatch_id)
        assert outcome["delivery"]["state"]=="ACCEPTED" and len(relay.messages)==1
        replay=client.change("dispatch",{"id":message["id"]},request_id=dispatch_id)
        assert replay["delivery"]["state"]=="ACCEPTED" and len(relay.messages)==1
        original_message=client.op("get_message",{"id":message["id"]})["message"]
        assert relay.messages[0]["raw"]==base64.b64decode(original_message["wire_base64"])
        dsn=provider_dsn(original_message)
        dp={"name":"Original_Local_Relay_Delivery.eml","content_base64":b64(dsn),"format":"DSN"}
        delivery=client.op("preview_delivery",dp);assert not delivery["problems"]
        client.change("receive_delivery",{**dp,"review_sha256":delivery["review_sha256"]})
        assert client.op("get_message",{"id":message["id"]})["message"]["delivery"]["state"]=="DELIVERED"
        phase("actual_smtp_original_mime_single_submission_and_native_dsn",{"message_id":message["id"],"wire":original_message["wire"],"native_outcome":outcome,"replay":replay["operation"],"dsn_review":delivery,"receiver_messages":len(relay.messages)})
        french=prepare(by_company["B"]);assert french["rendered"]["language"]=="FR" and "Bonjour" in french["rendered"]["body"]
        client.change("dispatch",{"id":french["id"]})
        french=client.op("get_message",{"id":french["id"]})["message"]
        failed=provider_dsn(french,"failed")
        failure_input={"name":"Original_Local_Relay_Failure.eml","content_base64":b64(failed),"format":"DSN"}
        failure=client.op("preview_delivery",failure_input);assert not failure["problems"]
        client.change("receive_delivery",{**failure_input,"review_sha256":failure["review_sha256"]})
        assert client.op("get_message",{"id":french["id"]})["message"]["delivery"]["state"]=="BOUNCED"
        phase("french_general_inbox_and_original_failure_review",{"message_id":french["id"],"recipient":french["recipient"],"body":french["rendered"]["body"],"native_delivery":failure})
        queue=client.op("followups",{"at":stamp()})
        due_a=next(x for x in queue["items"] if x["assignment_id"]==by_company["A"]["id"] and x["eligible"])
        reminder=prepare(by_company["A"],"REMINDER",{"followup_key":due_a["key"]})
        own=client.op("get_assignment",{"id":by_company["A"]["id"]})["assignment"]
        respondent=Client(opening["url"]);respondent.request("/api/session",{"role":"respondent","respondent_id":own["respondent_id"],"access_code":own["access_code"]})
        response=respondent.invoke("submit_revision",{"respondent_id":own["respondent_id"],"expected_version":0,"answers":{"company_name":own["company"]["name"],"reported_value":"700.00"},"public_confirmed":True})
        assert response["validation"]["valid"] and response["notifications"]["prepared_count"]==2
        assert set(response["notifications"])=={"state","prepared_count","review_count"}
        suppressed=client.op("followups",{"at":stamp()})
        assert all(not x["eligible"] for x in suppressed["items"] if x["assignment_id"]==own["id"])
        before=len(relay.messages)
        try:client.change("dispatch",{"id":reminder["id"]})
        except RpcError as error:assert error.code=="RESPONSE_RECEIVED"
        else:raise AssertionError("Received response did not suppress queued reminder")
        assert len(relay.messages)==before
        review=client.invoke("review_revision",{"revision_id":response["revision_id"],"expected_version":1,"decision":"changes_requested","note":"Please revise the original reported value to include its recorded adjustment."})
        assert len(review["notifications"]["messages"])==1
        revised=respondent.invoke("submit_revision",{"respondent_id":own["respondent_id"],"expected_version":1,"answers":{"company_name":own["company"]["name"],"reported_value":"699.90"},"public_confirmed":True})
        client.invoke("review_revision",{"revision_id":revised["revision_id"],"expected_version":2,"decision":"accept","note":"Original adjusted response accepted"})
        resync=client.change("sync_notifications",{"at":stamp()});assert not resync["messages"]
        phase("native_received_revision_confirmation_correction_and_reminder_suppression",{"first_revision":response["revision_id"],"revised_revision":revised["revision_id"],"original_comparison":revised["comparison"],"suppressed_followup_key":due_a["key"],"automatic_notices":5,"resync":resync})
        own_contact=respondent.op("respondent_contact",{"respondent_id":own["respondent_id"]})
        respondent.op("update_respondent_contact",{"respondent_id":own["respondent_id"],"expected_version":own_contact["version"],
            "request_id":str(uuid.uuid4()),"contact":{"contact_name":"Alice Example","email":"alice.updated@commissioning.invalid","phone":"+1 555 0199","postal_address":"Local commissioning address","country":"CA","language":"EN"}})
        try:respondent.op("respondent_contact",{"respondent_id":by_company["B"]["respondent_id"]})
        except RpcError as error:assert error.status==403
        else:raise AssertionError("A respondent read another original contact")
        try:respondent.op("status")
        except RpcError as error:assert error.status==403
        else:raise AssertionError("A respondent read the original operator register")
        public=client.change("save_public_link",{"publication_id":publication["publication_id"],"name":"Original public commissioning route","expires_at":due,"language":"FR"})
        anonymous=Client(opening["url"])
        token=public["link"]["token"]
        public_body={"token":token,"request_id":str(uuid.uuid4()),"contact":{"company_name":"Commissioning Importer A","contact_name":"Public example","email":"public@commissioning.invalid","phone":"","postal_address":"","country":"CA","language":"FR"}}
        entered=anonymous.request("/api/outreach/public-entry",public_body)["result"]
        again=anonymous.request("/api/outreach/public-entry",public_body)["result"];assert again["respondent_id"]==entered["respondent_id"]
        state=client.op("status");public_assignment=next(a for a in state["assignments"] if a["respondent_id"]==entered["respondent_id"])
        assert public_assignment["company_id"]!="A" and public_assignment["registration_state"]=="NEW_COMPANY_CONTACT_REVIEW"
        phase("scoped_contact_edit_and_idempotent_public_company_registration",{"original_respondent_id":own["respondent_id"],"updated_contact":respondent.op("respondent_contact",{"respondent_id":own["respondent_id"]}),"public_respondent_id":entered["respondent_id"],"separate_company_id":public_assignment["company_id"],"cross_respondent_http_status":403})
        client.change("log_followup",{"assignment_id":by_company["C"]["id"],"channel":"PHONE","outcome":"ASSISTANCE","at":stamp(),
            "note":"Walked through the original workbook and recorded the requested response timing.","expected_response_at":(now+timedelta(days=2)).isoformat(),
            "original_source":{"kind":"COMMISSIONING_CONTACT_NOTE","reference":"Native operating input phone record"}})
        # Correct interpretation retains the exact original bytes and prior source.
        corrected={**trade_input,"settings":{**trade_input["settings"],"identifiers":{"hs_code":{"case":"KEEP","remove_spaces":True}}}}
        correction_preview=client.op("preview_source",corrected)
        successor=client.change("receive_source",{**corrected,"review_sha256":correction_preview["mapping"]["review_sha256"],"supersedes_id":trade_id})["source_id"]
        source_a=client.op("get_source",{"source_id":trade_id,"complete":True})
        source_b=client.op("get_source",{"source_id":successor,"complete":True})
        assert source_a["sha256"]==source_b["sha256"]==sha(trade) and source_a["mapping_sha256"]!=source_b["mapping_sha256"]
        phase("source_interpretation_successor_and_assistance_history",{"original_source_id":trade_id,"successor_source_id":successor,"unchanged_original_sha256":sha(trade)})
        # All visible application resources are the actual served originals.
        served=[]
        for path in ("/respondent-operations/","/respondent-operations.mjs","/respondent-operations.css","/respondent-operations/guide","/app.mjs"):
            raw=client.request(path);assert isinstance(raw,bytes) and raw
            served.append({"path":path,"bytes":len(raw),"sha256":sha(raw)})
        operating=client.request("/api/outreach/files/operating.zip")
        (root/"ATSSC_Respondent_Operating_Files.zip").write_bytes(operating)
        with zipfile.ZipFile(io.BytesIO(operating)) as archive:
            manifest=json.loads(archive.read("MANIFEST.json"))
            for item in manifest["files"]:
                raw=archive.read(item["path"]);assert len(raw)==item["bytes"] and sha(raw)==item["sha256"]
            workbook=archive.read("ATSSC_Respondent_Operations.xlsx")
            (root/"ATSSC_Respondent_Operations.xlsx").write_bytes(workbook)
            parsed=read_source(workbook,"ATSSC_Respondent_Operations.xlsx",{"format":"XLSX"})
            assert parsed["requires_sheet"] and len(parsed["sheets"])==7
        project=client.request("/api/outreach/files/project.zip")
        full=root/"ATSSC_Complete_Respondent_Project.zip";full.write_bytes(project)
        phase("actual_http_whole_operating_and_original_project_exports",{"served_application":served,"operating":identity(root/"ATSSC_Respondent_Operating_Files.zip"),"project":identity(full),"workbook_sheets":parsed["sheets"]})
        cold=receive_project(full,root/"cold-received",sha(project))
        cold_workspace=Workspace(root/"cold-received"/"workspace")
        original_state=client.op("status");cold_state=cold_workspace.outreach.op_status({})
        assert cold_state["workspace_id"]==original_state["workspace_id"] and cold_state["revision"]==original_state["revision"]
        assert [a["respondent_id"] for a in cold_state["assignments"]]==[a["respondent_id"] for a in original_state["assignments"]]
        assert cold_workspace.authorize(Path(opening["operator_key_file"]).read_text().strip())
        assert cold_workspace.outreach.verify_sources()["verified_originals"]
        cold_workspace.outreach.invoke("log_followup",{"assignment_id":by_company["D"]["id"],"channel":"POSTAL","outcome":"POSTAL_SENT","at":stamp(),
            "note":"Recorded the same-case cold-received operating continuation.","original_source":{"kind":"COMMISSIONING_MAILROOM_RECORD","reference":"Cold receive operating continuation"},
            "expected_revision":cold_state["revision"],"actor":"Receiving operator","reason":"Continue the same original case after complete receiving","request_id":str(uuid.uuid4())})
        final_path=root/"ATSSC_Complete_Respondent_Project_Final.zip"
        final=cold_workspace.outreach.op_export_project({"path":str(final_path)})
        second=receive_project(final_path,root/"final-cold-received",final["sha256"])
        final_state=Workspace(root/"final-cold-received"/"workspace").outreach.op_status({})
        assert final_state["revision"]==cold_state["revision"]+1
        final_workspace=Workspace(root/"final-cold-received"/"workspace")
        for format_name,filename in (("zip","ATSSC_Respondent_Operating_Files.zip"),("xlsx","ATSSC_Respondent_Operations.xlsx")):
            raw,_,_=final_workspace.outreach.file_bytes("operating",format_name=format_name)
            (root/filename).write_bytes(raw)
        phase("cold_project_receive_edit_reexport_and_reopen",{"first_receive":cold,"final_receive":second,"workspace_id":final_state["workspace_id"],
              "final_revision":final_state["revision"],"companies":len(final_state["companies"]),"contacts":len(final_state["contacts"]),
              "assignments":len(final_state["assignments"]),"original_sources":len(final_state["sources"]),"messages":len(final_state["messages"])})
        report.update({"status":"PASS","finished_at":stamp(),"workspace_id":final_state["workspace_id"],"revision":final_state["revision"],
                       "outputs":[identity(p) for p in (root/"ATSSC_Respondent_Operating_Files.zip",root/"ATSSC_Respondent_Operations.xlsx",final_path)],
                       "smtp_receiver_originals":[{"commands":m["commands"],"received_at":m["received_at"],"bytes":len(m["raw"]),"sha256":sha(m["raw"]),"original_base64":b64(m["raw"])} for m in relay.messages]})
        (root/"NATIVE_RESULT.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        print(json.dumps({"complete":True,"status":report["status"],"result":str(root/"NATIVE_RESULT.json"),"outputs":report["outputs"]},ensure_ascii=False),flush=True)
        return report
    except Exception as error:
        report.update({"status":"FAILED","finished_at":stamp(),"error":{"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()}})
        try:
            checkpoint_path=root/"ATSSC_Interrupted_Respondent_Project.zip"
            selected_workspace=workspace.directory if "workspace" in locals() else (Path(args.workspace) if args.workspace else root/"workspace")
            if (selected_workspace/"questionnaires.sqlite3").is_file() and not checkpoint_path.exists():
                retained=Workspace(selected_workspace).outreach.op_export_project({"path":str(checkpoint_path)})
                report["retained_case_checkpoint"]=retained
        except Exception as checkpoint_error:
            report["checkpoint_error"]={"type":type(checkpoint_error).__name__,"message":str(checkpoint_error)}
        (root/"NATIVE_RESULT.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        raise
    finally:
        if server:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait()
        if stderr:stderr.close()
        if relay:relay.shutdown();relay.server_close()
if __name__=="__main__":main()
