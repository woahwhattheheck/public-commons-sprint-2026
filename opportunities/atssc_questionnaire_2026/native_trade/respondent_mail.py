"""Native SMTP dispatch and exact original delivery-status intake.

SMTP acceptance is retained separately from delivered/read/responded states.
Credentials remain in runtime environment variables; the original wire message,
provider responses and complete delivery notifications are retained in SQLite.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import format_datetime, parsedate_to_datetime
from urllib.parse import urlparse

from respondent_source import SourceError, digest
from respondent_domain import utc

def _email(value):
    if not isinstance(value,str) or len(value)>320 or not re.fullmatch(r"[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+",value):
        raise SourceError("SMTP_ADDRESS","Use one complete original email address.")
    return value

def _same_address(a,b):
    if not isinstance(a,str) or not isinstance(b,str) or "@" not in a or "@" not in b:return False
    left,right=a.rsplit("@",1),b.rsplit("@",1)
    return left[0]==right[0] and left[1].casefold()==right[1].casefold()

def compose_wire(message):
    sender,recipient=_email(message.get("sender")),_email(message.get("recipient"))
    record=EmailMessage(policy=policy.SMTP)
    record["From"]=sender
    record["To"]=recipient
    record["Subject"]=message["rendered"]["subject"]
    reply=message.get("reply_to","")
    if re.fullmatch(r"[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+",reply):
        record["Reply-To"]=reply
    domain=sender.rsplit("@",1)[1].encode("idna").decode("ascii")
    message_id="<atssc."+message["id"]+"@"+domain+">"
    record["Message-ID"]=message_id
    record["Date"]=format_datetime(utc(message.get("at") or message["created"]))
    record["X-ATSSC-Operation"]=message["id"]
    record.set_content(message["rendered"]["body"],charset="utf-8")
    record.add_alternative(message["rendered"]["html"],subtype="html",charset="utf-8")
    record.set_boundary("atssc-"+message["id"])
    raw=record.as_bytes(policy=policy.SMTP)
    return raw,{"message_id":message_id,"envelope_id":"atssc-"+message["id"],
                "bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),"content_type":record.get_content_type()}

def smtp_config(environ=None):
    env=os.environ if environ is None else environ
    host=env.get("ATSSC_SMTP_HOST","").strip()
    if not host:raise SourceError("SMTP_CONFIGURATION","Configure the selected non-Exchange SMTP service on the application host.")
    mode=env.get("ATSSC_SMTP_MODE","STARTTLS").upper()
    if mode not in ("STARTTLS","SSL","PLAIN_LOCAL"):
        raise SourceError("SMTP_CONFIGURATION","Use STARTTLS or SSL for the deployed mail service.")
    if mode=="PLAIN_LOCAL" and host not in ("127.0.0.1","localhost","::1"):
        raise SourceError("SMTP_CONFIGURATION","Plain SMTP is reserved for the explicitly selected local commissioning receiver.")
    try:
        port=int(env.get("ATSSC_SMTP_PORT","465" if mode=="SSL" else "587"))
        timeout=int(env.get("ATSSC_SMTP_TIMEOUT","30"))
    except ValueError as error:raise SourceError("SMTP_CONFIGURATION","Use whole SMTP port and timeout values.") from error
    if not 1<=port<=65535 or not 1<=timeout<=300:
        raise SourceError("SMTP_CONFIGURATION","SMTP port or timeout is outside its operating range.")
    return {"host":host,"port":port,"mode":mode,"timeout":timeout,
            "username":env.get("ATSSC_SMTP_USERNAME"),"password":env.get("ATSSC_SMTP_PASSWORD"),
            "provider":env.get("ATSSC_SMTP_PROVIDER",host),
            "cafile":env.get("ATSSC_SMTP_CA_FILE")}

def native_smtp(claim,config,before_data=None):
    raw=base64.b64decode(claim["wire_base64"],validate=True)
    if len(raw)!=claim["wire"]["bytes"] or hashlib.sha256(raw).hexdigest()!=claim["wire"]["sha256"]:
        raise SourceError("SMTP_WIRE","The retained original MIME message failed its byte identity.")
    sender,recipient=_email(claim["sender"]),_email(claim["recipient"])
    connection=None
    stage="CONNECT"
    responses=[]
    accepted=False
    def response(phase,code,message):
        payload=message if isinstance(message,bytes) else str(message).encode()
        responses.append({"phase":phase,"code":int(code),"text":payload.decode("utf-8","replace"),
                          "original_base64":base64.b64encode(payload).decode()})
    result={"provider":config["provider"],"event_id":"smtp-result:"+claim["message_id"],
            "message_id":claim["message_id"],"original_message_id":claim["wire"]["message_id"],
            "host":config["host"],"port":config["port"],"mode":config["mode"],
            "wire_sha256":claim["wire"]["sha256"],"responses":responses}
    try:
        context=ssl.create_default_context(cafile=config.get("cafile"))
        if config["mode"]=="SSL":
            connection=smtplib.SMTP_SSL(config["host"],config["port"],timeout=config["timeout"],context=context)
        else:
            connection=smtplib.SMTP(config["host"],config["port"],timeout=config["timeout"])
        stage="EHLO"
        code,msg=connection.ehlo();response(stage,code,msg)
        if code!=250:raise smtplib.SMTPHeloError(code,msg)
        if config["mode"]=="STARTTLS":
            stage="STARTTLS"
            code,msg=connection.starttls(context=context);response(stage,code,msg)
            stage="EHLO_AFTER_TLS"
            code,msg=connection.ehlo();response(stage,code,msg)
            if code!=250:raise smtplib.SMTPHeloError(code,msg)
        if config.get("username"):
            if config.get("password") is None:raise SourceError("SMTP_CONFIGURATION","Configure the selected SMTP credential before dispatch.")
            stage="AUTH"
            code,msg=connection.login(config["username"],config["password"])
            response(stage,code,msg)
        mail_options=[]
        recipient_options=[]
        if any(ord(c)>127 for c in sender+recipient):
            if not connection.has_extn("smtputf8"):raise smtplib.SMTPNotSupportedError("The original recipient requires SMTPUTF8")
            mail_options.extend(["SMTPUTF8","BODY=8BITMIME"])
        if connection.has_extn("dsn"):
            mail_options.extend(["RET=HDRS","ENVID="+claim["wire"]["envelope_id"]])
            recipient_options.append("NOTIFY=SUCCESS,FAILURE,DELAY")
            result["dsn_envelope_id"]=claim["wire"]["envelope_id"]
        stage="MAIL"
        code,msg=connection.mail(sender,options=mail_options);response(stage,code,msg)
        if code!=250:raise smtplib.SMTPSenderRefused(code,msg,sender)
        stage="RCPT"
        code,msg=connection.rcpt(recipient,options=recipient_options);response(stage,code,msg)
        if code not in (250,251):raise smtplib.SMTPRecipientsRefused({recipient:(code,msg)})
        stage="PRE_DATA_CURRENT_RESPONSE"
        if before_data is not None:before_data()
        stage="DATA"
        code,msg=connection.data(raw);response(stage,code,msg)
        if code!=250:raise smtplib.SMTPDataError(code,msg)
        accepted=True
        result.update({"kind":"ACCEPTED","definitive_no_accept":False,"accepted_recipients":[recipient],
                       "final_smtp_code":code,"final_smtp_text":msg.decode("utf-8","replace")})
    except BaseException as error:
        # A returned negative SMTP reply definitively refused this transaction.
        # A disconnect after DATA begins leaves delivery unknown and is never
        # retried automatically under a new message identity.
        if isinstance(error,(KeyboardInterrupt,SystemExit)):raise
        reply_code=getattr(error,"smtp_code",None)
        reply_bytes=getattr(error,"smtp_error",None)
        if reply_code is not None:response(stage,reply_code,reply_bytes or b"")
        if isinstance(error,smtplib.SMTPRecipientsRefused):
            for address,(code,msg) in error.recipients.items():
                response(stage,code,msg)
                reply_code=code
        if stage=="PRE_DATA_CURRENT_RESPONSE":
            state="CANCELLED"
            no_accept=True
        elif reply_code is not None or stage!="DATA":
            state="REJECTED"
            no_accept=True
        else:
            state="UNKNOWN"
            no_accept=False
        result.update({"kind":state,"definitive_no_accept":no_accept,"error_type":type(error).__name__,
                       "error_code":getattr(error,"code",None),"stage":stage,
                       "retryable":bool(no_accept and (reply_code is None or 400<=reply_code<500)),
                       "final_smtp_code":reply_code})
        if stage=="PRE_DATA_CURRENT_RESPONSE":result["suppression_reason"]=str(error)
    finally:
        if connection is not None:
            try:connection.quit()
            except Exception:
                try:connection.close()
                except Exception:pass
        result["at"]=datetime.now(timezone.utc).isoformat()
    return result

def dispatch_message(workspace,message_id,actor,reason,environ=None,request_id=None):
    request_id=request_id or "dispatch:"+message_id
    state=workspace.outreach.op_status({})
    message=workspace.outreach.op_get_message({"id":message_id})["message"]
    # The durable original claim is the send boundary. Replaying either the
    # HTTP operation or a concurrent request never submits its MIME again.
    try:
        prior=workspace.outreach.op_operation({"request_id":request_id+":result"})
    except Exception as error:
        if getattr(error,"code","")!="NOT_FOUND":raise
        prior=None
    if prior:
        if prior.get("message",{}).get("id")!=message_id:
            raise SourceError("REQUEST_REUSE","This dispatch request belongs to a different original message.")
        return {"message_id":message_id,"delivery":prior["message"]["delivery"],"revision":prior["revision"],
                "wire":message.get("wire"),"operation":prior["operation"]}
    if message["delivery"]["state"]!="QUEUED":
        try:prior=workspace.outreach.op_operation({"request_id":request_id})
        except Exception as error:
            if getattr(error,"code","")!="NOT_FOUND":raise
            prior=None
        if prior and prior.get("message_id")==message_id:
            return {"message_id":message_id,"delivery":message["delivery"],"revision":state["revision"],
                    "wire":message.get("wire"),"operation":prior["operation"],"awaiting_provider":message["delivery"]["state"] in ("SENDING","UNKNOWN")}
        raise SourceError("DELIVERY_OUTCOME","This original message already entered dispatch; recover its current outcome.")
    config=smtp_config(environ)
    claim=workspace.outreach.invoke("begin_dispatch",{"id":message_id,"expected_version":message["version"],
       "expected_revision":state["revision"],"request_id":request_id,"actor":actor,"reason":reason,
       "transport":config["provider"]})
    if claim.get("operation",{}).get("replayed"):
        current=workspace.outreach.op_get_message({"id":message_id})
        return {"message_id":message_id,"delivery":current["message"]["delivery"],"revision":current["revision"],
                "wire":current["message"].get("wire"),"operation":claim["operation"],
                "awaiting_provider":current["message"]["delivery"]["state"] in ("SENDING","UNKNOWN")}
    def still_current():
        with workspace.connection() as db:
            current=workspace.outreach._message(db,message_id)
            if current.get("claim_token")!=claim["claim_token"] or current["delivery"]["state"]!="SENDING":
                raise SourceError("DISPATCH_CLAIM","The original dispatch claim changed.")
            workspace.outreach._still_current(db,current,datetime.now(timezone.utc).isoformat())
    outcome=native_smtp(claim,config,still_current)
    result=workspace.outreach.invoke("finish_dispatch",{"id":message_id,"claim_token":claim["claim_token"],
       "outcome":outcome,"request_id":request_id+":result","actor":actor,"reason":"Retain the actual original SMTP outcome"})
    return {"message_id":message_id,"delivery":result["message"]["delivery"],"revision":result["revision"],
            "wire":claim["wire"],"operation":result["operation"]}

def _pointer(value,pointer):
    if pointer=="":return value
    if not isinstance(pointer,str) or not pointer.startswith("/"):
        raise SourceError("PROVIDER_MAPPING","Use an original JSON pointer.")
    out=value
    for segment in pointer[1:].split("/"):
        key=segment.replace("~1","/").replace("~0","~")
        if isinstance(out,list):
            if not re.fullmatch(r"0|[1-9][0-9]*",key):raise SourceError("PROVIDER_MAPPING","Invalid original array pointer.")
            try:out=out[int(key)]
            except IndexError as error:raise SourceError("PROVIDER_MAPPING","Original array pointer is absent.") from error
        elif isinstance(out,dict) and key in out:out=out[key]
        else:raise SourceError("PROVIDER_MAPPING","Original JSON pointer is absent.",pointer=pointer)
    return out

def _parsed_time(value):
    try:return utc(value).isoformat(),"ORIGINAL_ISO"
    except SourceError:pass
    try:
        parsed=parsedate_to_datetime(value)
        if parsed.tzinfo is None:raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat(),"ORIGINAL_MAIL_DATE"
    except (ValueError,TypeError,IndexError) as error:
        raise SourceError("DELIVERY_DATE","The original provider result needs an explicit timezone-bearing date.",value=value) from error

def _identity_maps(messages):
    envelope,header={},{}
    for message in messages:
        wire=message.get("wire") or {}
        if wire.get("envelope_id"):envelope.setdefault(wire["envelope_id"],[]).append(message)
        if wire.get("message_id"):header.setdefault(wire["message_id"],[]).append(message)
    return envelope,header

def _match_original(envelope_id,message_id,recipient,messages):
    envelopes,headers=_identity_maps(messages)
    candidates=[]
    if envelope_id:candidates.extend(envelopes.get(envelope_id,[]))
    if message_id:candidates.extend(headers.get(message_id,[]))
    unique={m["id"]:m for m in candidates}
    if len(unique)!=1:
        raise SourceError("DELIVERY_IDENTITY","The original provider result does not identify one dispatched message.",
                          envelope_id=envelope_id,original_message_id=message_id)
    original=next(iter(unique.values()))
    if envelope_id and envelope_id!=(original.get("wire") or {}).get("envelope_id") or message_id and message_id!=(original.get("wire") or {}).get("message_id"):
        raise SourceError("DELIVERY_IDENTITY_CONFLICT","Provider envelope and header identities refer to different originals.")
    if not _same_address(original["recipient"],recipient):
        raise SourceError("DELIVERY_RECIPIENT","The original provider recipient differs from the dispatched recipient.",
                          original_recipient=original["recipient"],provider_recipient=recipient)
    return original

def read_delivery(raw,name,messages,format_name="DSN",mapping=None):
    if not isinstance(raw,bytes) or not raw or len(raw)>32*1024*1024:
        raise SourceError("DELIVERY_SOURCE","Use the complete original provider response, up to 32 MiB.")
    file={"name":str(name),"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw),"format":format_name}
    events,problems=[],[]
    if format_name=="DSN":
        mail=BytesParser(policy=policy.default).parsebytes(raw)
        returned_message_ids=[]
        for part in mail.walk():
            if part.get_content_type()=="message/rfc822":
                content=part.get_payload()
                for original in content if isinstance(content,list) else []:
                    if original.get("Message-ID"):returned_message_ids.append(str(original["Message-ID"]).strip())
            elif part.get_content_type()=="text/rfc822-headers":
                headers=BytesParser(policy=policy.default).parsebytes(part.get_payload(decode=True) or b"")
                if headers.get("Message-ID"):returned_message_ids.append(str(headers["Message-ID"]).strip())
        if len(set(returned_message_ids))>1:
            problems.append({"code":"DELIVERY_HEADER_CONFLICT","message":"The notification contains several original message identities."})
        returned_id=returned_message_ids[0] if len(set(returned_message_ids))==1 else None
        reports=[part for part in mail.walk() if part.get_content_type()=="message/delivery-status"]
        if not reports:raise SourceError("DELIVERY_FORMAT","The original message contains no native delivery-status part.")
        for part_number,part in enumerate(reports):
            blocks=part.get_payload()
            if not isinstance(blocks,list) or len(blocks)<2:
                problems.append({"code":"DELIVERY_FORMAT","part":part_number,"message":"A delivery-status report lacks its recipient records."})
                continue
            header=blocks[0]
            envelope=str(header.get("Original-Envelope-Id","")).strip() or None
            provider=str(header.get("Reporting-MTA","")).strip()
            for row_number,record in enumerate(blocks[1:],1):
                pointer="mime/delivery-status/"+str(part_number)+"/recipient/"+str(row_number)
                try:
                    if not provider:raise SourceError("DELIVERY_PROVIDER","Original Reporting-MTA is required.")
                    address_field=record.get("Original-Recipient") or record.get("Final-Recipient")
                    if not address_field or ";" not in address_field:raise SourceError("DELIVERY_RECIPIENT","Original recipient field is absent.")
                    address_type,recipient=str(address_field).split(";",1)
                    if address_type.strip().lower() not in ("rfc822","utf-8"):
                        raise SourceError("DELIVERY_RECIPIENT","This original recipient address type is unsupported.")
                    recipient=recipient.strip()
                    action=str(record.get("Action","")).strip().lower()
                    status=str(record.get("Status","")).strip()
                    if action not in ("failed","delayed","delivered","relayed","expanded") or not re.fullmatch(r"[245]\.[0-9]{1,3}\.[0-9]{1,3}",status):
                        raise SourceError("DELIVERY_STATUS","The native recipient Action or Status is invalid.")
                    original=_match_original(envelope,returned_id,recipient,messages)
                    original_time=record.get("Last-Attempt-Date") or mail.get("Date")
                    at,time_format=_parsed_time(str(original_time or ""))
                    kind={"failed":"BOUNCED","delayed":"DEFERRED","delivered":"DELIVERED","relayed":"ACCEPTED","expanded":"ACCEPTED"}[action]
                    event_id=str(mail.get("Message-ID","")).strip()
                    provider_event_id=(event_id or file["sha256"])+":"+str(part_number)+":"+str(row_number)
                    events.append({"message_id":original["id"],"provider":provider,"provider_event_id":provider_event_id,
                       "kind":kind,"at":at,"pointer":pointer,"original_action":action,"original_status":status,
                       "envelope_id":envelope,"original_message_id":returned_id,"recipient":recipient,
                       "original_recipient":str(record.get("Original-Recipient","")),
                       "final_recipient":str(record.get("Final-Recipient","")),"diagnostic":str(record.get("Diagnostic-Code","")),
                       "original_time":str(original_time),"time_basis":"LAST_ATTEMPT" if record.get("Last-Attempt-Date") else "NOTIFICATION_DATE",
                       "time_format":time_format,"headers":list(record.raw_items()),"message_headers":list(header.raw_items())})
                except SourceError as error:problems.append({**error.as_dict(),"pointer":pointer})
    elif format_name=="JSON":
        if not isinstance(mapping,dict):
            raise SourceError("PROVIDER_MAPPING","Map the original provider JSON fields explicitly.")
        try:
            document=json.loads(raw.decode("utf-8-sig"),parse_int=str,parse_float=str)
        except (ValueError,UnicodeError) as error:raise SourceError("DELIVERY_JSON","The original provider JSON is unreadable.") from error
        records=_pointer(document,mapping.get("records",""))
        if isinstance(records,dict):records=[records];single=True
        else:single=False
        if not isinstance(records,list):raise SourceError("PROVIDER_MAPPING","The original selected provider records must be an object or array.")
        fields=mapping.get("fields",{})
        if not {"provider","event_id","recipient","status","at"}<=set(fields) or not ({"message_id","envelope_id"}&set(fields)):
            raise SourceError("PROVIDER_MAPPING","Map provider, event ID, recipient, status, time and original message/envelope identity.")
        states=mapping.get("statuses",{})
        if not isinstance(states,dict) or any(s not in ("ACCEPTED","DELIVERED","BOUNCED","REJECTED","DEFERRED") for s in states.values()):
            raise SourceError("PROVIDER_MAPPING","Map exact provider statuses to their supported delivery outcomes.")
        for number,record in enumerate(records):
            pointer=mapping.get("records","")+("" if single else "/"+str(number))
            try:
                values={key:_pointer(record,pointer_value) for key,pointer_value in fields.items()}
                if any(not isinstance(values[key],str) or not values[key] for key in ("provider","event_id","recipient","status","at")):
                    raise SourceError("PROVIDER_MAPPING","Mapped provider identity and outcome fields must be nonempty source strings.")
                if values["status"] not in states:raise SourceError("DELIVERY_STATUS","Review this original provider status.",status=values["status"])
                original=_match_original(values.get("envelope_id"),values.get("message_id"),values["recipient"],messages)
                at,time_format=_parsed_time(values["at"])
                events.append({"message_id":original["id"],"provider":values["provider"],"provider_event_id":values["event_id"],
                    "kind":states[values["status"]],"at":at,"pointer":pointer,"original":record,"mapped_fields":values,
                    "original_status":values["status"],"time_format":time_format,"original_time":values["at"]})
            except SourceError as error:problems.append({**error.as_dict(),"pointer":pointer})
    else:raise SourceError("DELIVERY_FORMAT","Choose a native DSN message or explicitly mapped original provider JSON.")
    if not events and not problems:problems.append({"code":"NO_DELIVERY_EVENTS","message":"The original provider file contains no delivery records."})
    unique=set()
    for event in events:
        identity=(event["provider"],event["provider_event_id"])
        if identity in unique:problems.append({"code":"DUPLICATE_DELIVERY_EVENT","provider":identity[0],"provider_event_id":identity[1]})
        unique.add(identity)
    result={"schema":"commons.atssc.original-delivery-review.v1","file":file,"mapping":mapping,"events":events,"problems":problems}
    result["review_sha256"]=digest(result)
    return result

def process_due(workspace,actor,reason,send=False,environ=None):
    current=workspace.outreach.op_status({})
    profile=current.get("profile") or {}
    if not profile.get("followup_settings",{}).get("automatic",False):
        raise SourceError("REMINDER_SCHEDULE","Enable the original case's automatic reminder schedule before running it.")
    point=datetime.now(timezone.utc).isoformat()
    queue=workspace.outreach.op_followups({"at":point})
    results=[]
    for item in queue["items"]:
        if not item["eligible"]:continue
        # Re-read before every original queued message; a preceding provider
        # return or a concurrent submitted revision may have changed this row.
        state=workspace.outreach.op_status({})
        assignment=next((a for a in state["assignments"] if a["id"]==item["assignment_id"]),None)
        if assignment is None:continue
        template_id="standard-reminder-"+assignment["language"].lower()
        params={"assignment_id":assignment["id"],"template_id":template_id,"followup_key":item["key"],
                "at":datetime.now(timezone.utc).isoformat()}
        try:
            review=workspace.outreach.op_preview_message(params)
            retained=workspace.outreach.invoke("retain_message",{**params,"review_sha256":review["review_sha256"],
                "expected_revision":state["revision"],"request_id":"automatic-followup:"+item["key"],
                "actor":actor,"reason":reason})
            entry={"followup_key":item["key"],"message_id":retained["message"]["id"],"state":"QUEUED"}
            if send:entry["dispatch"]=dispatch_message(workspace,entry["message_id"],actor,reason,environ)
            results.append(entry)
        except Exception as error:
            results.append({"followup_key":item["key"],"error":{"code":getattr(error,"code",type(error).__name__),"message":str(error)}})
    if send:
        # A preceding worker may have queued a reviewed message before its
        # host exited. Continue that original claim; never create a replacement.
        state=workspace.outreach.op_status({})
        candidates=[m for m in state["messages"] if m["delivery"]["state"]=="QUEUED" and
                    (m.get("followup_key") or m["kind"] in ("SUBMISSION_CONFIRMATION","STAFF_NOTIFICATION","REVISION_REQUEST"))]
        for message in candidates:
            if any(x.get("message_id")==message["id"] and x.get("dispatch") for x in results):
                continue
            try:
                result=dispatch_message(workspace,message["id"],actor,reason,environ)
                results.append({"message_id":message["id"],"continued_original_queue":True,"dispatch":result})
            except Exception as error:
                results.append({"message_id":message["id"],"error":{"code":getattr(error,"code",type(error).__name__),"message":str(error)}})
    return {"at":point,"results":results}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--workspace",required=True)
    parser.add_argument("--actor",required=True)
    parser.add_argument("--reason",required=True)
    commands=parser.add_subparsers(dest="command",required=True)
    dispatch=commands.add_parser("dispatch")
    dispatch.add_argument("--message-id",required=True)
    due=commands.add_parser("due")
    due.add_argument("--send",action="store_true")
    args=parser.parse_args()
    from questionnaire_workspace import Workspace
    workspace=Workspace(args.workspace)
    if args.command=="dispatch":result=dispatch_message(workspace,args.message_id,args.actor,args.reason)
    else:result=process_due(workspace,args.actor,args.reason,args.send)
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=="__main__":
    try:main()
    except Exception as error:
        print(json.dumps({"error":{"code":getattr(error,"code",type(error).__name__),"message":str(error)}}),file=sys.stderr)
        raise SystemExit(2)
