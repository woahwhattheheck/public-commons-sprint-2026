"""Deterministic coverage, communications and follow-up projections.

Every operation is pure. Persistence, original respondent invitations, response
authorization and atomic writes remain in the maintained questionnaire Workspace.
"""
from __future__ import annotations
import copy
import csv
import html
import io
import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from urllib.parse import urlparse
from respondent_source import SourceError, canonical, digest

COVERAGE_SCHEMA = "commons.atssc.coverage.v1"
FIELD_NAMES = {
    "case_reference", "case_title", "company_name", "contact_name",
    "questionnaire_title", "questionnaire_url", "access_code",
    "due_date", "revision_reason", "support_contact", "submission_reference",
    "organization_name", "sent_date", "respondent_id"
}
KINDS = {"INVITATION", "REMINDER", "SUBMISSION_CONFIRMATION", "REVISION_REQUEST", "STAFF_NOTIFICATION"}
EMAIL_EVENTS = {"QUEUED", "SENDING", "ACCEPTED", "DELIVERED", "BOUNCED",
                "REJECTED", "DEFERRED", "UNKNOWN", "CANCELLED"}
TERMINAL_RESPONSES = {"received", "accepted", "submitted", "withdrawn"}

def amount(value):
    text = str(value)
    if not re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?", text) or len(text) > 120:
        raise SourceError("DECIMAL_REQUIRED", "Use the complete finite decimal source value.", value=text)
    result = Decimal(text)
    return result

def fixed(value):
    return "0" if value == 0 else format(value, "f")

def utc(value, field="time"):
    if not isinstance(value, str):
        raise SourceError("TIME_REQUIRED", "Use an explicit ISO time with its timezone.", field=field)
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SourceError("TIME_REQUIRED", "Use an explicit ISO time with its timezone.", field=field) from error
    if result.tzinfo is None or result.utcoffset() is None:
        raise SourceError("TIME_ZONE_REQUIRED", "The original date must include its timezone.", field=field)
    return result.astimezone(timezone.utc)

def _review_dispositions(rows, dispositions):
    supplied = dispositions or []
    if not isinstance(supplied, list):
        raise SourceError("ROW_DISPOSITIONS", "Review the complete list of row exclusions.")
    known = {r["id"] for r in rows}
    result = {}
    for item in supplied:
        if not isinstance(item, dict) or item.get("row_id") not in known or item.get("row_id") in result:
            raise SourceError("ROW_DISPOSITION", "An exclusion must identify one distinct original row.")
        if item.get("action") != "EXCLUDE" or not str(item.get("reason", "")).strip():
            raise SourceError("ROW_DISPOSITION", "Record the source reason for excluding an original row.")
        result[item["row_id"]] = {"row_id": item["row_id"], "action": "EXCLUDE", "reason": item["reason"].strip()}
    return result

def build_coverage(mapped, policy):
    if mapped.get("schema") != "commons.atssc.respondent-mapping.v1" or mapped.get("kind") != "TRADE":
        raise SourceError("TRADE_REQUIRED", "Use an original reviewed trade-source mapping.")
    policy = copy.deepcopy(policy or {})
    if policy.get("target_percent") is None:
        raise SourceError("COVERAGE_TARGET", "Choose the representative-coverage target for this case.")
    target = amount(policy["target_percent"])
    if not 0 <= target <= 100:
        raise SourceError("COVERAGE_TARGET", "Coverage target must be between zero and one hundred.")
    if policy.get("mode", "AUTO") not in ("AUTO", "MANUAL"):
        raise SourceError("COVERAGE_MODE", "Choose automatic recommendation or an explicit company selection.")
    basis = policy.get("value_basis", "NET_COMPANY")
    if basis not in ("NET_COMPANY", "POSITIVE_ROWS"):
        raise SourceError("COVERAGE_BASIS", "Choose net importer value or positive original rows.")
    grouping = policy.get("group_by", ["hs_code", "country"])
    if not isinstance(grouping, list) or not grouping or len(grouping) != len(set(grouping)) or set(grouping)-{"hs_code", "country"}:
        raise SourceError("COVERAGE_GROUP", "Group the original values by HS code, country, or both.")
    hs_digits = policy.get("hs_digits")
    if hs_digits is not None and hs_digits not in (2, 4, 6, 8, 10):
        raise SourceError("HS_GROUP", "Choose an explicit 2, 4, 6, 8 or 10 digit HS grouping.")
    filters = policy.get("filters", {})
    if set(filters)-{"hs_codes", "countries"}:
        raise SourceError("COVERAGE_FILTER", "Filter using selected original HS codes and countries.")
    rows = mapped["rows"]
    if len(rows) != len({r["id"] for r in rows}):
        raise SourceError("DUPLICATE_SOURCE_ROW", "The same original row appears twice in this edition.")
    dispositions = _review_dispositions(rows, policy.get("row_dispositions"))
    exclusions = {}
    for item in policy.get("excluded_companies", []):
        if not item.get("company_id") or not str(item.get("reason", "")).strip() or item["company_id"] in exclusions:
            raise SourceError("COMPANY_EXCLUSION", "Record one reason per explicitly excluded company.")
        exclusions[item["company_id"]] = copy.deepcopy(item)
    manual = policy.get("included_companies", [])
    if not isinstance(manual, list) or any(not isinstance(x, str) or not x for x in manual) or len(manual) != len(set(manual)):
        raise SourceError("COMPANY_SELECTION", "Select distinct original company identifiers.")
    additional = {}
    for item in policy.get("additional_companies", []):
        key = item.get("company_id")
        if not key or key in additional or not item.get("name") or not str(item.get("reason", "")).strip() or not item.get("source"):
            raise SourceError("ADDITIONAL_COMPANY", "An interested party or referral needs its identity, name, reason and original source.")
        additional[key] = copy.deepcopy(item)
    if (set(manual)|set(additional)) & set(exclusions):
        raise SourceError("COMPANY_SELECTION", "An excluded company cannot also be explicitly included.")
    problems, ignored, accepted = [], [], []
    company_names = defaultdict(set)
    currencies = set()
    groups = {}
    with localcontext() as context:
        context.prec = 200
        for row in rows:
            if row["id"] in dispositions:
                ignored.append({"row_id": row["id"], "disposition": dispositions[row["id"]], "source": row["source"]})
                continue
            if not row.get("valid"):
                problems.append({"code": "UNRESOLVED_SOURCE_ROW", "row_id": row["id"], "issues": row.get("errors", [])})
                continue
            if any(filters.get(key) and row[field] not in filters[key] for key, field in (("hs_codes","hs_code"),("countries","country"))):
                ignored.append({"row_id": row["id"], "disposition": {"action": "OUTSIDE_FILTER"}, "source": row["source"]})
                continue
            hs_code = row["hs_code"]
            if hs_digits is not None:
                if not hs_code.isascii() or not hs_code.isdigit() or len(hs_code) < hs_digits:
                    problems.append({"code": "HS_GROUP_INTERPRETATION", "row_id": row["id"], "hs_code": hs_code,
                                     "message": "Review original HS punctuation/padding before applying the chosen digit grouping."})
                    continue
                hs_code = hs_code[:hs_digits]
            group_values = {"hs_code": hs_code, "country": row["country"]}
            currency = row["currency"]
            currencies.add(currency)
            group_key = canonical({"currency": currency, **{key:group_values[key] for key in grouping}})
            group = groups.setdefault(group_key, {"key": digest(group_key.encode()), "fields": json.loads(group_key),
                              "companies": {}, "row_ids": [], "net": Decimal(0), "positive": Decimal(0), "negative": Decimal(0)})
            number = amount(row["value_for_duty"])
            company = group["companies"].setdefault(row["company_id"],
                       {"company_id":row["company_id"], "net":Decimal(0), "positive":Decimal(0), "negative":Decimal(0), "row_ids":[]})
            for dest in (group, company):
                dest["net"] += number
                dest["positive"] += max(number, Decimal(0))
                dest["negative"] += min(number, Decimal(0))
                dest["row_ids"].append(row["id"])
            company_names[row["company_id"]].add(row.get("company_name") or row["company_id"])
            accepted.append(row["id"])
        known = set(company_names)|set(additional)
        if set(manual)-known or set(exclusions)-known:
            raise SourceError("COMPANY_SELECTION", "The selection names a company outside this original edition and its explicit additions.",
                              missing=sorted((set(manual)|set(exclusions))-known))
        selected = set(manual)|set(additional)
        recommendations = set()
        for group in groups.values():
            ordered = sorted(group["companies"].values(), key=lambda c: (-(c["net"] if basis == "NET_COMPANY" else c["positive"]), c["company_id"]))
            for company in ordered:
                company["basis"] = max(company["net"], Decimal(0)) if basis == "NET_COMPANY" else company["positive"]
            denominator = sum((c["basis"] for c in ordered), Decimal(0))
            group["denominator"] = denominator
            covered = sum((c["basis"] for c in ordered if c["company_id"] in selected), Decimal(0))
            group["recommended"] = []
            if policy.get("mode", "AUTO") == "AUTO":
                for company in ordered:
                    if covered * 100 >= denominator * target:
                        break
                    if company["company_id"] in exclusions or company["company_id"] in selected or company["basis"] <= 0:
                        continue
                    group["recommended"].append(company["company_id"])
                    recommendations.add(company["company_id"])
                    covered += company["basis"]
            if denominator == 0 and target > 0:
                problems.append({"code": "NO_POSITIVE_COVERAGE_BASIS", "group": group["key"]})
            if group["negative"] < 0 and not policy.get("negative_values_reviewed", False):
                problems.append({"code": "NEGATIVE_VALUES_REVIEW", "group": group["key"],
                                 "message": "Review original negative values and the selected NET_COMPANY or POSITIVE_ROWS basis."})
        selected |= recommendations
        output_groups = []
        selected_details = {key:{"company_id":key, "names":sorted(company_names.get(key, {additional[key]["name"]} if key in additional else set())),
                               "selection_reasons":[], "groups":[], "additional":additional.get(key)}
                            for key in sorted(selected)}
        for group in sorted(groups.values(), key=lambda g: canonical(g["fields"])):
            denominator = group["denominator"]
            covered = sum((c["basis"] for c in group["companies"].values() if c["company_id"] in selected), Decimal(0))
            achieved = None if denominator == 0 else fixed((covered * 100 / denominator).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP))
            meets_target = denominator > 0 and covered * 100 >= denominator * target or target == 0
            if not meets_target:
                problems.append({"code": "COVERAGE_SHORTFALL", "group":group["key"], "covered":fixed(covered),
                                 "total":fixed(denominator), "target_percent":fixed(target)})
            companies = []
            for company in sorted(group["companies"].values(), key=lambda c:(-c["basis"],c["company_id"])):
                key = company["company_id"]
                entry = {"company_id":key, "names":sorted(company_names[key]), "net_value":fixed(company["net"]),
                         "positive_value":fixed(company["positive"]), "negative_value":fixed(company["negative"]),
                         "coverage_value":fixed(company["basis"]), "source_row_ids":company["row_ids"],
                         "selected":key in selected, "exclusion":exclusions.get(key)}
                companies.append(entry)
                if key in selected:
                    selected_details[key]["groups"].append({"key":group["key"], "fields":group["fields"], "value":entry["coverage_value"],
                                                           "source_row_ids":company["row_ids"]})
                    if key in group["recommended"]:
                        selected_details[key]["selection_reasons"].append({"kind":"COVERAGE", "group":group["key"]})
            output_groups.append({"key":group["key"], "fields":group["fields"], "source_row_ids":group["row_ids"],
                "net_value":fixed(group["net"]), "positive_value":fixed(group["positive"]), "negative_value":fixed(group["negative"]),
                "coverage_basis":fixed(denominator), "selected_value":fixed(covered), "achieved_percent":achieved,
                "target_percent":fixed(target), "meets_target":meets_target, "companies":companies})
        for key, item in selected_details.items():
            if key in manual:
                item["selection_reasons"].append({"kind":"OPERATOR_SELECTION"})
            if key in additional:
                item["selection_reasons"].append({"kind":"ADDITIONAL_PARTY", "reason":additional[key]["reason"], "source":additional[key]["source"]})
        if not groups:
            problems.append({"code":"NO_TRADE_GROUPS", "message":"No reviewed rows remain in the selected trade scope."})
        report = {"schema":COVERAGE_SCHEMA, "source_file":mapped["source_file"], "mapping_review_sha256":mapped["review_sha256"],
                  "policy":policy, "groups":output_groups, "selected_companies":list(selected_details.values()),
                  "source_row_ids":accepted, "row_dispositions":ignored, "problems":problems, "ready":not problems,
                  "counts":{"original_rows":len(rows), "included_rows":len(accepted), "excluded_rows":len(ignored),
                            "unresolved_rows":sum(p["code"]=="UNRESOLVED_SOURCE_ROW" for p in problems),
                            "trade_groups":len(groups), "selected_companies":len(selected)}}
        report["review_sha256"] = digest(report)
        return report

def normalized_contact(value):
    if not isinstance(value, dict):
        raise SourceError("CONTACT", "Provide the complete contact record.")
    out = {key:str(value.get(key, "")).strip() for key in
           ("company_id", "company_name", "contact_name", "email", "phone", "postal_address", "country", "role")}
    if not out["company_id"] or not out["company_name"]:
        raise SourceError("CONTACT_COMPANY", "Bind the contact to one named original company.")
    if out["email"] and (len(out["email"])>320 or not re.fullmatch(r"[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+",out["email"])):
        raise SourceError("CONTACT_EMAIL", "Use one complete contact email address.")
    out["language"] = str(value.get("language", "")).upper()
    if out["language"] not in ("EN","FR"):
        raise SourceError("CONTACT_LANGUAGE", "Choose English or French.")
    out["kind"] = value.get("kind", "PERSON")
    if out["kind"] not in ("PERSON","GENERIC_INBOX","PUBLIC_ENTRY"):
        raise SourceError("CONTACT_KIND", "Choose an individual, generic inbox or public registration.")
    out["custom"] = value.get("custom", {})
    if not isinstance(out["custom"],dict) or any(not isinstance(k,str) or not k or len(k)>80 or not isinstance(v,(str,int,bool)) for k,v in out["custom"].items()):
        raise SourceError("CONTACT_CUSTOM", "Custom fields need named scalar values.")
    out["custom"] = {k:str(v) for k,v in out["custom"].items()}
    out["source"] = value.get("source")
    if not out["source"]:
        raise SourceError("CONTACT_SOURCE", "Retain the original source or operator account for this contact.")
    out["note"] = str(value.get("note","")).strip()
    out["active"] = value.get("active",True)
    if type(out["active"]) is not bool:
        raise SourceError("CONTACT_ACTIVE", "Contact active state must be true or false.")
    return out

def validate_template(template):
    if not isinstance(template,dict):
        raise SourceError("MESSAGE_TEMPLATE", "Provide the complete message template.")
    kind, language = template.get("kind"), template.get("language")
    if kind not in KINDS or language not in ("EN","FR"):
        raise SourceError("MESSAGE_TEMPLATE", "Choose a supported message type and English or French.")
    subject, body = template.get("subject"), template.get("body")
    if not isinstance(subject,str) or not subject.strip() or any(c in subject for c in "\r\n") or len(subject)>500:
        raise SourceError("MESSAGE_SUBJECT", "The subject must be one complete line.")
    if not isinstance(body,str) or not body.strip() or len(body)>100000:
        raise SourceError("MESSAGE_BODY", "Provide the complete plain-text message.")
    variables = sorted(set(re.findall(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}",subject+"\n"+body)))
    if set(variables)-FIELD_NAMES:
        raise SourceError("MESSAGE_FIELD", "A template uses an unknown context field.", fields=sorted(set(variables)-FIELD_NAMES))
    remainder = re.sub(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}","",subject+"\n"+body)
    if "{{" in remainder or "}}" in remainder:
        raise SourceError("MESSAGE_FIELD", "A template placeholder is malformed.")
    return {"name":str(template.get("name",kind+" "+language)).strip(), "kind":kind, "language":language,
            "subject":subject, "body":body, "variables":variables}

def render_message(template, context):
    normalized = validate_template(template)
    missing = [key for key in normalized["variables"] if context.get(key) in (None,"")]
    if missing:
        raise SourceError("MESSAGE_CONTEXT", "Complete the original assignment context before dispatch.", fields=missing)
    def substitute(text):
        return re.sub(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}",lambda m:str(context[m[1]]),text)
    subject, body = substitute(normalized["subject"]), substitute(normalized["body"])
    if "\r" in subject or "\n" in subject:
        raise SourceError("MESSAGE_SUBJECT", "The rendered subject includes an invalid line break.")
    if "questionnaire_url" in normalized["variables"]:
        parsed = urlparse(str(context["questionnaire_url"]))
        if parsed.scheme not in ("https","http") or not parsed.hostname or parsed.username or parsed.password:
            raise SourceError("QUESTIONNAIRE_LINK", "Use the original application questionnaire URL.")
        if parsed.scheme=="http" and parsed.hostname not in ("localhost","127.0.0.1","::1"):
            raise SourceError("QUESTIONNAIRE_LINK", "The deployed questionnaire link requires HTTPS.")
    organization = str(context.get("organization_name","Questionnaire operations"))
    markup = "<!doctype html><html lang='"+normalized["language"].lower()+"'><meta charset='utf-8'><body style='font:15px Arial,sans-serif;color:#222;line-height:1.5'><p><strong>"+html.escape(organization)+"</strong></p><div style='white-space:pre-wrap'>"+html.escape(body)+"</div></body></html>"
    result = {"kind":normalized["kind"], "language":normalized["language"], "subject":subject,"body":body,
              "html":markup, "template":normalized, "template_id":template.get("id"), "template_version":template.get("version"),
              "context":{key:context[key] for key in normalized["variables"]},
              "organization_name":organization}
    result["review_sha256"] = digest(result)
    return result

def delivery_projection(events):
    ordered = sorted(events, key=lambda e:(utc(e["at"]),int(e.get("sequence",0))))
    state = "NONE"
    last = None
    accepted, delivered, failed = False,False,False
    for event in ordered:
        kind = event.get("kind")
        if kind not in EMAIL_EVENTS:
            raise SourceError("DELIVERY_EVENT", "Unknown original mail outcome.", kind=kind)
        if kind == "DELIVERED":
            delivered, accepted, failed = True,True,False
            state = "DELIVERED"
        elif kind in ("BOUNCED","REJECTED"):
            failed = True
            state = kind
        elif kind == "ACCEPTED":
            accepted = True
            if not delivered and not failed:
                state = "ACCEPTED"
        elif kind == "DEFERRED":
            if not delivered and not failed:
                state = kind
        elif kind == "CANCELLED":
            if not accepted and not delivered:
                state = kind
        elif kind in ("UNKNOWN","SENDING","QUEUED"):
            if not accepted and not delivered and not failed:
                state = kind
        last = event
    return {"state":state,"accepted":accepted,"delivered":delivered,"failed":failed,
            "last_event":last,"events":ordered}

def followup_queue(assignments, messages, at, settings=None):
    """Project due work from current original respondent status and saved sends.

    Each assignment provides an original respondent record and current deadline
    edition. A receipt or accepted response suppresses all ordinary reminders.
    A changes_requested revision enables only its explicit correction follow-up.
    """
    point = utc(at)
    settings = dict(settings or {})
    before_days = settings.get("before_due_days",2)
    initial_hours = settings.get("initial_followup_hours",24)
    if type(before_days) is not int or not 0 <= before_days <= 365 or type(initial_hours) is not int or not 0 <= initial_hours <= 720:
        raise SourceError("FOLLOWUP_SCHEDULE","Use whole nonnegative follow-up intervals.")
    by_assignment = defaultdict(list)
    for message in messages:
        by_assignment[message["assignment_id"]].append(message)
    items = []
    for assignment in assignments:
        if not assignment.get("active",True):
            continue
        respondent = assignment["respondent"]
        status = respondent["status"]
        start = utc(assignment["notice_at"],"notice_at")
        due = utc(assignment["due_at"],"due_at")
        if due <= start:
            raise SourceError("ASSIGNMENT_DEADLINE","Deadline must follow the original notice.",assignment_id=assignment["id"])
        half = start + (due-start)/2
        phases = [("INITIAL_FOLLOWUP",start+timedelta(hours=initial_hours)),
                  ("MIDPOINT",half),("BEFORE_DEADLINE",due-timedelta(days=before_days))]
        if status=="changes_requested":
            request = assignment.get("revision_request")
            if request:
                phases = [("REVISION_FOLLOWUP",utc(request["at"])+timedelta(hours=initial_hours))]
            else:
                phases = []
        # A short response window can place planned phases before the notice;
        # retain their original calculation while making the earliest send the notice.
        for phase, planned in phases:
            scheduled = max(start,planned)
            source = {"assignment_id":assignment["id"],"assignment_version":assignment["version"],
                      "respondent_id":respondent["id"],"respondent_version":respondent["version"],
                      "respondent_status":status,"deadline":assignment["due_at"],"phase":phase,
                      "revision_request_id":(assignment.get("revision_request") or {}).get("id")}
            identity = digest({"assignment_id":assignment["id"], "deadline":assignment["due_at"],
                               "notice_at":assignment["notice_at"], "phase":phase,
                               "revision_request_id":source["revision_request_id"],
                               "before_due_days":before_days, "initial_followup_hours":initial_hours})
            previous = [m for m in by_assignment[assignment["id"]] if m.get("followup_key")==identity]
            outcomes = [delivery_projection(m.get("events",[]))["state"] for m in previous]
            all_outcomes = [delivery_projection(m.get("events",[]))["state"] for m in by_assignment[assignment["id"]]]
            reasons = []
            if status in TERMINAL_RESPONSES:
                reasons.append("RESPONSE_ALREADY_RECEIVED")
            if assignment.get("paused"):
                reasons.append("ASSIGNMENT_PAUSED")
            if not assignment.get("email"):
                reasons.append("CONTACT_ROUTE_REQUIRED")
            if point < scheduled:
                reasons.append("SCHEDULED_FOR_LATER")
            if point > due and not settings.get("after_due",False):
                reasons.append("DEADLINE_PASSED")
            if any(s in ("QUEUED","SENDING","UNKNOWN","ACCEPTED","DELIVERED","DEFERRED") for s in outcomes):
                reasons.append("CURRENT_FOLLOWUP_ALREADY_RETAINED")
            if all_outcomes and all_outcomes[-1] in ("BOUNCED","REJECTED"):
                reasons.append("CONTACT_DELIVERY_REVIEW")
            if assignment.get("deadline_changed") and not assignment.get("deadline_change_reviewed"):
                reasons.append("DEADLINE_CHANGE_REVIEW")
            item = {"key":identity,"assignment_id":assignment["id"],"company_id":assignment["company_id"],
                    "respondent_id":respondent["id"],"phase":phase,"planned_at":planned.isoformat(),
                    "scheduled_at":scheduled.isoformat(),"due_at":due.isoformat(),
                    "eligible":not reasons,"reasons":reasons,"basis":source,"retained_message_ids":[m["id"] for m in previous]}
            item["review_sha256"] = digest(item)
            items.append(item)
    result = {"schema":"commons.atssc.followup-queue.v1","at":point.isoformat(),"settings":settings,
              "items":sorted(items,key=lambda x:(x["scheduled_at"],x["company_id"],x["assignment_id"],x["phase"])),
              "due":sum(x["eligible"] for x in items)}
    result["review_sha256"] = digest(result)
    return result

def table_csv(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(headers)
    for row in rows:
        values = []
        for value in row:
            text = "" if value is None else canonical(value) if isinstance(value,(dict,list)) else str(value)
            # CSV applications may interpret untrusted text as a formula. The
            # exact unescaped originals stay in the editable JSON/source file.
            if text.lstrip().startswith(("=","+","-","@")):
                try: amount(text)
                except SourceError: text = "'"+text
            values.append(text)
        writer.writerow(values)
    return out.getvalue().encode("utf-8-sig")

DEFAULT_TEMPLATES = [
 {"name":"Invitation — English","kind":"INVITATION","language":"EN",
  "subject":"{{case_reference}} — questionnaire for {{company_name}}",
  "body":"Hello {{contact_name}},\n\n{{organization_name}} invites {{company_name}} to complete {{questionnaire_title}} for {{case_title}} ({{case_reference}}).\n\nOpen your questionnaire: {{questionnaire_url}}\nPrivate access code: {{access_code}}\nResponse due: {{due_date}}\n\nIf this reached a general company inbox, please forward it to the colleague authorized to complete this company’s response. Please keep the private code with that colleague.\n\nFor assistance or to correct the company/contact information, contact {{support_contact}}.\n\nThank you."},
 {"name":"Invitation — Français","kind":"INVITATION","language":"FR",
  "subject":"{{case_reference}} — questionnaire pour {{company_name}}",
  "body":"Bonjour {{contact_name}},\n\n{{organization_name}} invite {{company_name}} à remplir {{questionnaire_title}} pour {{case_title}} ({{case_reference}}).\n\nOuvrir votre questionnaire : {{questionnaire_url}}\nCode d’accès privé : {{access_code}}\nDate limite de réponse : {{due_date}}\n\nSi ce message a été transmis à une boîte générale, veuillez le transférer à la personne autorisée à préparer la réponse de votre entreprise et lui réserver le code privé.\n\nPour obtenir de l’aide ou corriger les coordonnées, veuillez communiquer avec {{support_contact}}.\n\nMerci."},
 {"name":"Reminder — English","kind":"REMINDER","language":"EN",
  "subject":"{{case_reference}} — questionnaire reminder for {{company_name}}",
  "body":"Hello {{contact_name}},\n\nOur current record has not yet received the requested response from {{company_name}} for {{questionnaire_title}}.\n\nResponse due: {{due_date}}\nQuestionnaire: {{questionnaire_url}}\nPrivate access code: {{access_code}}\n\nIf you need assistance, expect a delay, or have already submitted through another authorized route, please contact {{support_contact}} so the original record can be updated.\n\nThank you."},
 {"name":"Rappel — Français","kind":"REMINDER","language":"FR",
  "subject":"{{case_reference}} — rappel du questionnaire pour {{company_name}}",
  "body":"Bonjour {{contact_name}},\n\nSelon le dossier actuel, la réponse demandée à {{company_name}} pour {{questionnaire_title}} n’a pas encore été reçue.\n\nDate limite : {{due_date}}\nQuestionnaire : {{questionnaire_url}}\nCode d’accès privé : {{access_code}}\n\nSi vous avez besoin d’aide, prévoyez un retard ou avez déjà transmis votre réponse par une autre voie autorisée, veuillez communiquer avec {{support_contact}} afin de mettre le dossier à jour.\n\nMerci."},
 {"name":"Submission confirmation — English","kind":"SUBMISSION_CONFIRMATION","language":"EN",
  "subject":"{{case_reference}} — response received from {{company_name}}",
  "body":"Hello {{contact_name}},\n\nThe response for {{questionnaire_title}} from {{company_name}} has been received.\n\nSubmission reference: {{submission_reference}}\nQuestionnaire: {{questionnaire_url}}\n\nThe case team will review this edition and contact you if clarification or revision is required. This message confirms receipt.\n\nFor assistance: {{support_contact}}."},
 {"name":"Confirmation de réception — Français","kind":"SUBMISSION_CONFIRMATION","language":"FR",
  "subject":"{{case_reference}} — réponse de {{company_name}} reçue",
  "body":"Bonjour {{contact_name}},\n\nLa réponse de {{company_name}} à {{questionnaire_title}} a été reçue.\n\nRéférence de transmission : {{submission_reference}}\nQuestionnaire : {{questionnaire_url}}\n\nL’équipe examinera cette version et communiquera avec vous si une précision ou une révision est requise. Ce message confirme la réception.\n\nAssistance : {{support_contact}}."},
 {"name":"Revision request — English","kind":"REVISION_REQUEST","language":"EN",
  "subject":"{{case_reference}} — revision requested from {{company_name}}",
  "body":"Hello {{contact_name}},\n\nThe case team requests a revision to {{company_name}}’s response for {{questionnaire_title}}.\n\nRequested clarification:\n{{revision_reason}}\n\nResponse due: {{due_date}}\nOpen the same questionnaire: {{questionnaire_url}}\nPrivate access code: {{access_code}}\n\nYour previous edition remains in the case history. Please contact {{support_contact}} if you need assistance."},
 {"name":"Demande de révision — Français","kind":"REVISION_REQUEST","language":"FR",
  "subject":"{{case_reference}} — révision demandée à {{company_name}}",
  "body":"Bonjour {{contact_name}},\n\nL’équipe demande une révision de la réponse de {{company_name}} à {{questionnaire_title}}.\n\nPrécisions demandées :\n{{revision_reason}}\n\nDate limite : {{due_date}}\nOuvrir le même questionnaire : {{questionnaire_url}}\nCode d’accès privé : {{access_code}}\n\nLa version précédente reste dans l’historique du dossier. Pour obtenir de l’aide, veuillez communiquer avec {{support_contact}}."},
 {"name":"Staff notification — English","kind":"STAFF_NOTIFICATION","language":"EN",
  "subject":"{{case_reference}} — received questionnaire response",
  "body":"A response from {{company_name}} is retained for {{questionnaire_title}}.\n\nSubmission reference: {{submission_reference}}\nRespondent record: {{respondent_id}}\n\nOpen the original operator workspace to review the complete submission and its previous editions."},
 {"name":"Avis à l’équipe — Français","kind":"STAFF_NOTIFICATION","language":"FR",
  "subject":"{{case_reference}} — réponse au questionnaire reçue",
  "body":"La réponse de {{company_name}} à {{questionnaire_title}} est conservée au dossier.\n\nRéférence de transmission : {{submission_reference}}\nDossier du répondant : {{respondent_id}}\n\nOuvrez l’espace de travail de l’équipe pour examiner la réponse complète et les versions précédentes."}
]
