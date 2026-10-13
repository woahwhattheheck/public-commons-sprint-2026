"""Crisis and Resilience Fund Year 1 reporting from retained, reviewed originals.

The selected unit is explicit: application outcome, award, spend allocation or
recipient. Annual reporting is cumulative. No eligibility or authority is inferred.
"""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import datetime, date, timedelta
from decimal import Decimal, localcontext
from zoneinfo import ZoneInfo
from migration_store import MigrationError, identity, canonical, text
from financial_domain import original_rows, original_kind, selected_cell, decimal_value, decimal_text, date_value
from property_domain import converted, absent, instant

SCHEMA = "commons.crf-reporting/v1"
RULES = "https://www.gov.uk/government/publications/crisis-and-resilience-fund-guidance-for-local-authorities-in-england-1-april-2026-to-31-march-2029/crisis-and-resilience-fund-1-april-2026-to-31-march-2029-management-information-combined-reporting-requirements"
PERIODS = {"interim":{"start":"2026-04-01","end":"2026-09-30","due":"2026-10-29"},
           "annual":{"start":"2026-04-01","end":"2027-03-31","due":"2027-05-06"}}
CATEGORIES = {
 "route":["online","phone","in_person","other"],
 "presenting_crisis":["disaster","accident_health","relationship_breakdown","essential_item_breakdown","income_loss","other"],
 "support_method":["cash","voucher","in_kind","other"],
 "crisis_need":["food","wider_essentials","furniture_appliances","housing_crisis","transport","priority_debt","utilities","other"],
 "status":["awarded","refused","pending","accepted_unawarded"],
 "payment_status":["paid","reversed","pending","failed"],
}
DEMOGRAPHICS = ["children","pensioners","disabled","other_individuals","employed","not_employed","benefits","no_benefits"]
FIELDS = {
 "applications":{"id":"text","status":"text","reporting_on":"date","application_based":"boolean"},
 "awards":{"id":"text","application_id":"text","recipient_id":"text","reporting_on":"date","application_based":"boolean",
           "route":"text","submitted_at":"instant","paid_at":"instant","presenting_crisis":"text",
           "support_method":"text","crisis_need":"text","children":"boolean","pensioners":"boolean","disabled":"boolean",
           "other_individuals":"boolean","employed":"boolean","benefits":"boolean"},
 "allocations":{"id":"text","award_id":"text","reporting_on":"date","amount":"decimal","presenting_crisis":"text",
                "support_method":"text","crisis_need":"text"},
 "payment_controls":{"id":"text","award_id":"text","reporting_on":"date","amount":"decimal","payment_status":"text","paid_at":"instant"},
 "repeat_counts":{"recipient_id":"text","as_of":"date","previous_awards":"decimal","history_start":"date","history_end":"date","basis_reference":"text"},
 "contributions":{"id":"text","metric":"text","value":"text","type":"text","period_start":"date","period_end":"date","authority_reference":"text"},
}
KEYS = {f:("recipient_id" if f=="repeat_counts" else "id") for f in FIELDS}
# Optional source fields stay absent, never default to false/zero. Each reporting
# use below creates a finding when it needs an unavailable field.
REQUIRED = {"applications":["id","status","reporting_on","application_based"],
            "awards":["id","recipient_id","reporting_on","application_based"],
            "allocations":["id","award_id","reporting_on","amount"],
            "payment_controls":["id","award_id","reporting_on","amount","payment_status"],
            "repeat_counts":["recipient_id","as_of","previous_awards","history_start","history_end","basis_reference"],
            "contributions":["id","metric","value","type","period_start","period_end","authority_reference"]}

def require(ok, code, message, **details):
    if not ok: raise MigrationError(code, message, details)

def obj(value, required=(), optional=()):
    require(isinstance(value,dict), "CRF_OBJECT", "Use the complete documented object.")
    require(set(required)<=set(value) and not set(value)-set(required)-set(optional),
            "CRF_FIELDS", "Use the documented fields.", required=list(required),actual=list(value))
    return value

def review(value):
    obj(value,("actor","role","note","evidence_files"))
    for field in ("actor","role","note"): text(value[field],field)
    require(isinstance(value["evidence_files"],list) and value["evidence_files"],
            "CRF_REVIEW", "Retain the actual review evidence files.")
    return value

def validate_contract(value):
    obj(value,("scope_id","authority_name","authority_type","financial_year","recognition_basis","repeat_count_basis","review"))
    for field in ("scope_id","authority_name","recognition_basis","repeat_count_basis"): text(value[field],field)
    require(value["authority_type"] in ("county","unitary"),"CRF_AUTHORITY","This application supports the county/unitary Crisis support workstream.")
    require(type(value["financial_year"]) is int and value["financial_year"]==2026,
            "CRF_RULE_VERSION","Select the retained Year 1 rule version; later-year rules require a reviewed code revision.")
    review(value["review"])
    return value

def validate_context(value):
    obj(value,("coverage","period_start","period_end","captured_at","source_system","extraction_reference","review"))
    require(value["coverage"] in ("complete","partial","unknown"),"CRF_COVERAGE","Declare the actual full extraction coverage.")
    require(date_value(value["period_start"])<=date_value(value["period_end"]),"CRF_WINDOW","Source dates are reversed.")
    instant(value["captured_at"])
    for field in ("source_system","extraction_reference"): text(value[field],field)
    review(value["review"]); return value

def validate_mapping(mapping, columns, family):
    require(family in FIELDS,"CRF_FAMILY","Select an advertised source family.")
    require(isinstance(mapping,dict) and set(REQUIRED[family])<=set(mapping) and not set(mapping)-set(FIELDS[family]),
            "CRF_MAPPING","Map actual original columns; missing optional fields remain unknown.",required=REQUIRED[family])
    for field,spec in mapping.items():
        if isinstance(spec,str): column=spec
        else:
            obj(spec,("column","values")); column=spec["column"]
            require(isinstance(spec["values"],list),"CRF_VALUE_MAPPING","Use explicit original-to-reviewed value pairs.")
            seen=set()
            for entry in spec["values"]:
                obj(entry,("source","target")); obj(entry["source"],("kind","value"))
                require(entry["source"]["kind"] in ("string","number","boolean","null"),"CRF_VALUE_KIND","Retain the original scalar kind.")
                signature=canonical(entry["source"])
                require(signature not in seen,"CRF_VALUE_DUPLICATE","Map each original scalar once.");seen.add(signature)
                require(isinstance(entry["target"],(str,bool)),"CRF_VALUE_TARGET","Use an explicit reviewed scalar target.")
        require(column in columns,"CRF_COLUMN","Map an actual retained source column.",field=field,column=column)
    return mapping

def normalize(original, mapping, family):
    result=[]; counts=Counter()
    for ordinal,raw in enumerate(original,1):
        cells={};issues=[]
        for field,kind in FIELDS[family].items():
            spec=mapping.get(field)
            cell=selected_cell(raw,spec if isinstance(spec,str) else spec["column"]) if spec is not None else {"present":False}
            original_cell=dict(cell)
            if isinstance(spec,dict) and cell["present"]:
                selected={"kind":cell["kind"],"value":cell["value"]}
                matches=[m["target"] for m in spec["values"] if canonical(m["source"])==canonical(selected)]
                if matches:
                    target=matches[0]
                    cell={"present":True,"kind":"boolean" if isinstance(target,bool) else "string","value":target}
                else:
                    cell={**cell,"invalid":"UNMAPPED_VALUE"}
                    issues.append({"field":field,"code":"UNMAPPED_VALUE"})
            try:
                cells[field]=converted(cell,kind) if not cell.get("invalid") else cell
                if cells[field].get("value") is not None and field in CATEGORIES and cells[field].get("value") not in CATEGORIES[field]:
                    cells[field]["invalid"]="UNKNOWN_CATEGORY";issues.append({"field":field,"code":"UNKNOWN_CATEGORY"})
            except MigrationError as exc:
                cells[field]={**cell,"invalid":exc.code};issues.append({"field":field,"code":exc.code})
            if field in REQUIRED[family] and absent(cell): issues.append({"field":field,"code":"REQUIRED_VALUE"})
            if isinstance(spec,dict): cells[field]["original"]=original_cell
        key=cells[KEYS[family]]
        row_id=identity({"family":family,"key":{k:v for k,v in key.items() if k!="original"}})
        counts[row_id]+=1
        result.append({"id":row_id,"ordinal":ordinal,"family":family,"key":key,"cells":cells,"issues":issues,
                       "raw":raw,"raw_types":{k:original_kind(v) for k,v in raw.items()}})
    occurrences=Counter()
    for row in result:
        if counts[row["id"]]>1:
            occurrences[row["id"]]+=1
            row["occurrence"]=occurrences[row["id"]]
            row["issues"].append({"field":KEYS[family],"code":"DUPLICATE_IDENTITY"})
    return result

def val(row,field):
    cell=row["cells"].get(field,{})
    return None if cell.get("invalid") or not cell.get("present") or cell.get("value") is None or cell.get("value")=="" else cell["value"]

def calculate(contract, period_name, selected, emit=None):
    with localcontext() as context:
        context.prec = 256
        return _calculate(contract, period_name, selected, emit)

def _calculate(contract, period_name, selected, emit=None):
    """Every source row has a retained disposition; values are exact integers/GBP.
    emit(section,row) streams lineage into the caller's original SQLite transaction.
    """
    require(period_name in PERIODS,"CRF_PERIOD","Select the explicit interim or cumulative annual period.")
    require(set(selected)==set(FIELDS),"CRF_POPULATION","Select every family, including reviewed genuinely empty exports.")
    period=PERIODS[period_name];start,end=period["start"],period["end"]
    period_close=datetime.combine(date.fromisoformat(end)+timedelta(days=1),datetime.min.time(),ZoneInfo("Europe/London"))
    checks=[];finding_index={};lineage=[];totals={};definitions={};refs=Counter();check_counts=Counter()
    def send(section,row):
        if emit: emit(section,row)
        elif section=="lineage": lineage.append(row)
    def finding(code,family,subject,message,*,status="FAIL",details=None):
        occurrence=subject.get("occurrence") if isinstance(subject,dict) else None
        subject_id=subject["id"] if isinstance(subject,dict) else subject
        key=identity({"code":code,"family":family,"subject":subject_id,"occurrence":occurrence})
        row={"id":key,"code":code,"family":family,"subject":subject_id,"occurrence":occurrence,
             "source_ordinal":subject.get("ordinal") if isinstance(subject,dict) else None,
             "status":status,"message":message,"details":details or {}}
        if key in finding_index:
            require(finding_index[key]==row,"CRF_FINDING_CONFLICT","A repeated finding identity has different complete content.")
            return finding_index[key]
        finding_index[key]=row;checks.append(row);check_counts[status]+=1
        return row
    def metric(key,label,kind="count"):
        definitions[key]={"id":key,"label":label,"type":kind}
        totals[key]=Decimal(0) if kind=="money" else 0
    def add(key,amount,row,family,reason):
        totals[key]+=amount;refs[key]+=1
        send("lineage",{"metric_id":key,"dataset_id":selected[family]["dataset"]["id"],"row_id":row["id"],
                        "ordinal":row["ordinal"],"contribution":decimal_text(amount) if isinstance(amount,Decimal) else amount,"reason":reason})
    def need(row,family,field):
        value=val(row,field)
        if value is None: finding("MISSING_"+field.upper(),family,row,"The selected reporting use requires this reviewed source value.",details={"field":field})
        return value
    metric("t8.spend","Crisis support spend","money")
    for k in ("received","awarded","refused"):metric("t9."+k,"Application outcomes: "+k)
    for k in CATEGORIES["route"]:metric("t10."+k,"Award route: "+k)
    for k in ("application","non_application"):metric("t11."+k,"Spend: "+k,"money")
    for k in ("within_48h","over_48h"):metric("t12."+k,"Application to payment: "+k)
    for k in ("none","one","two_or_more"):metric("t13."+k,"Recipients: "+k+" previous awards")
    for table,field in (("t14","presenting_crisis"),("t15","support_method"),("t16","crisis_need")):
        for k in CATEGORIES[field]:
            metric(table+"a."+k,field+": "+k)
            metric(table+"b."+k,field+": "+k,"money")
    for k in DEMOGRAPHICS:
        metric("t17a."+k,"Awards: "+k);metric("t17b."+k,"Spend: "+k,"money")
    valid={};all_keys={};complete={}
    for family,selection in selected.items():
        ds=selection["dataset"];context=ds["context"]
        captured=datetime.fromisoformat(instant(context["captured_at"]))
        complete[family]=(context["coverage"]=="complete" and context["period_start"]<=start and context["period_end"]>=end
                          and captured>=period_close)
        if captured<period_close:
            finding("PERIOD_NOT_CLOSED",family,family,"The source was captured before this England reporting period ended; this edition remains provisional.",status="UNKNOWN",details={"captured_at":context["captured_at"],"period_close":period_close.isoformat()})
        if not complete[family]:
            finding("INCOMPLETE_POPULATION",family,family,"The source does not declare complete coverage of this reporting period.",status="UNKNOWN")
        rows=selection["rows"];valid[family]={};all_keys[family]=set()
        for row in rows:
            key=val(row,KEYS[family]);all_keys[family].add(key)
            future_fields=[field for field in ("submitted_at","paid_at") if val(row,field) is not None and datetime.fromisoformat(val(row,field))>captured]
            if future_fields:
                finding("FUTURE_SOURCE_FACT",family,row,"A purported observed event is later than its actual source capture.",details={"fields":future_fields,"captured_at":context["captured_at"]})
            if row["issues"] or future_fields:
                finding("SOURCE_ROW_INVALID",family,row,"Original row has mapping, identity or scalar issues.",details={"issues":row["issues"]})
                disposition="invalid"
            else:
                valid[family][key]=row
                if family in ("applications","awards","allocations","payment_controls"):
                    disposition="selected_period" if start<=val(row,"reporting_on")<=end else "outside_period"
                elif family=="repeat_counts": disposition="period_end" if val(row,"as_of")==end else "other_period_end"
                else: disposition="selected_period" if val(row,"period_start")==start and val(row,"period_end")==end else "other_period"
            send("lineage",{"dataset_id":ds["id"],"row_id":row["id"],"ordinal":row["ordinal"],"disposition":disposition})
    within=lambda row:start<=val(row,"reporting_on")<=end
    applications={k:r for k,r in valid["applications"].items() if within(r)}
    awards={k:r for k,r in valid["awards"].items() if within(r)}
    def missing_link(family,key,source_family,row,code):
        status="FAIL" if complete[family] and key not in all_keys[family] else "UNKNOWN"
        finding(code,source_family,row,"The selected related record is absent, ambiguous, invalid or outside this reporting edition.",
                status=status,details={"target_family":family,"target_key":key})
    application_awards=defaultdict(list)
    recipients=defaultdict(list)
    for key,row in awards.items():
        application_id=val(row,"application_id");recipients[val(row,"recipient_id")].append(row)
        if application_id is None:
            finding("AWARD_APPLICATION_UNIT","awards",row,"Every award needs its explicit application/non-application reporting unit; retain a non-application outcome row as well.")
        elif application_id not in applications: missing_link("applications",application_id,"awards",row,"AWARD_APPLICATION_MISSING")
        else: application_awards[application_id].append(row)
    for key,row in applications.items():
        status=val(row,"status")
        if status not in ("awarded","refused"):
            send("lineage",{"dataset_id":selected["applications"]["dataset"]["id"],"row_id":row["id"],"ordinal":row["ordinal"],
                            "disposition":"excluded_pending_or_accepted_unawarded"})
            if application_awards.get(key):
                finding("UNAWARDED_HAS_AWARD","applications",row,"Pending or accepted-but-unawarded application is linked to an awarded record.")
            continue
        add("t9.received",1,row,"applications","Awarded or refused reporting unit; both application and non-application routes.")
        add("t9."+status,1,row,"applications","Explicit reporting outcome.")
        linked=application_awards.get(key,[])
        if status=="awarded" and len(linked)!=1:
            finding("AWARDED_UNIT_CARDINALITY","applications",row,"One reviewed Table 9 awarded reporting unit must link to one Table 10/14/15/16/17 award unit; instalments belong in allocations and controls.",details={"award_count":len(linked)})
        if status=="refused" and linked:
            finding("REFUSED_HAS_AWARD","applications",row,"A refused reporting unit has an award.")
        for award in linked:
            if val(award,"application_based")!=val(row,"application_based"):
                finding("APPLICATION_BASIS_CONFLICT","awards",award,"Application and award basis disagree.")
    def categories(row,family,prefix,amount):
        for table,field in (("t14","presenting_crisis"),("t15","support_method"),("t16","crisis_need")):
            category=need(row,family,field)
            if category in CATEGORIES[field]:add(table+prefix+"."+category,amount,row,family,"Explicit reviewed category.")
    def demographics(row,family,prefix,amount,source_row=None):
        source_row=source_row or row
        for field in ("children","pensioners","disabled","other_individuals","employed","benefits"):
            value=need(row,"awards",field)
            if value is None:continue
            category=field if value else {"employed":"not_employed","benefits":"no_benefits"}.get(field)
            if category:add("t17"+prefix+"."+category,amount,source_row,family,"Reviewed recipient characteristic; child awards use the relevant adult employment/benefit basis.")
    for key,row in awards.items():
        route=need(row,"awards","route")
        if route in CATEGORIES["route"]:add("t10."+route,1,row,"awards","All awarded units including non-application routes.")
        categories(row,"awards","a",1);demographics(row,"awards","a",1)
        method=val(row,"support_method")
        if val(row,"application_based") is True and method is not None and method!="in_kind":
            submitted=need(row,"awards","submitted_at");paid=need(row,"awards","paid_at")
            if submitted and paid:
                elapsed=datetime.fromisoformat(paid)-datetime.fromisoformat(submitted)
                if elapsed<timedelta(0):finding("PAYMENT_PRECEDES_SUBMISSION","awards",row,"Payment timestamp precedes application submission.")
                else:add("t12."+("within_48h" if elapsed<=timedelta(hours=48) else "over_48h"),1,row,"awards","Calendar elapsed time from submission to actual payment.")
    allocated=defaultdict(lambda:Decimal(0));paid_amount=defaultdict(lambda:Decimal(0));control_times=defaultdict(set)
    with localcontext() as ctx:
        ctx.prec=256
        for key,row in valid["allocations"].items():
            if not within(row):continue
            award_id=val(row,"award_id");amount=decimal_value(val(row,"amount"))
            if amount<0 or amount.as_tuple().exponent < -2:
                finding("SPEND_AMOUNT","allocations",row,"Use nonnegative GBP amounts with at most two decimal places under the retained recognition basis; corrections require reviewed source editions.")
                continue
            if award_id not in awards:
                missing_link("awards",award_id,"allocations",row,"ALLOCATION_AWARD_MISSING");continue
            award=awards[award_id];allocated[award_id]+=amount
            add("t8.spend",amount,row,"allocations","Recognised allocation under the reviewed contract.")
            add("t11."+("application" if val(award,"application_based") else "non_application"),amount,row,"allocations","Original award application basis.")
            categories(row,"allocations","b",amount);demographics(award,"allocations","b",amount,row)
        for key,row in valid["payment_controls"].items():
            if not within(row):continue
            award_id=val(row,"award_id")
            if award_id not in awards:
                missing_link("awards",award_id,"payment_controls",row,"CONTROL_AWARD_MISSING");continue
            status=val(row,"payment_status")
            if status!="paid":
                finding("CONTROL_NOT_PAID","payment_controls",row,"An independent control is pending, failed or reversed; resolve the original reporting recognition explicitly.",details={"payment_status":status})
                continue
            amount=decimal_value(val(row,"amount"))
            if amount<0 or amount.as_tuple().exponent < -2:
                finding("CONTROL_AMOUNT","payment_controls",row,"Use nonnegative actual GBP amounts with at most two decimal places.");continue
            paid_amount[award_id]+=amount
            stamp=val(row,"paid_at")
            if stamp:control_times[award_id].add(stamp)
        for key,row in awards.items():
            if key not in allocated:finding("ALLOCATION_MISSING","awards",row,"The awarded unit lacks its complete recognised spend allocation.",status="FAIL" if complete["allocations"] else "UNKNOWN")
            if key not in paid_amount:finding("PAYMENT_CONTROL_MISSING","awards",row,"The awarded unit lacks an independently acquired paid control.",status="FAIL" if complete["payment_controls"] else "UNKNOWN")
            elif allocated[key]!=paid_amount[key]:
                finding("PAYMENT_CONTROL_DIFFERENCE","awards",row,"Recognised allocation and independent paid control totals differ.",details={"allocation":decimal_text(allocated[key]),"paid_control":decimal_text(paid_amount[key])})
            if val(row,"application_based") is True and val(row,"support_method")!="in_kind" and val(row,"paid_at"):
                if val(row,"paid_at") not in control_times[key]:
                    finding("PAYMENT_TIME_UNCONFIRMED","awards",row,"The time used for Table 12 is not present in an independently acquired paid control.")
    for recipient,award_rows in recipients.items():
        row=valid["repeat_counts"].get(recipient)
        if not row:
            missing_link("repeat_counts",recipient,"awards",award_rows[0],"RECIPIENT_HISTORY_MISSING");continue
        if val(row,"as_of")!=end or val(row,"history_end")!=end:
            finding("REPEAT_PERIOD_END","repeat_counts",row,"The recipient classification must be reviewed at this reporting period end.");continue
        # Calendar twelve months, avoiding an assumed 365-day duration.
        end_date=date.fromisoformat(end)
        previous_year=end_date.year-1
        try: anniversary=end_date.replace(year=previous_year)
        except ValueError: anniversary=end_date.replace(year=previous_year,day=28)
        history_start=(anniversary+timedelta(days=1)).isoformat()
        if val(row,"history_start")>history_start:
            finding("REPEAT_HISTORY_COVERAGE","repeat_counts",row,"The retained history does not cover the previous twelve calendar months.",status="UNKNOWN");continue
        count=decimal_value(val(row,"previous_awards"))
        if count<0 or count!=count.to_integral_value():
            finding("REPEAT_COUNT","repeat_counts",row,"Use a reviewed nonnegative integer previous-award count.");continue
        add("t13."+("none" if count==0 else "one" if count==1 else "two_or_more"),1,row,"repeat_counts","One recipient entry at period end using the contract's explicit previous-award interpretation.")
    for key,row in valid["contributions"].items():
        if val(row,"period_start")!=start or val(row,"period_end")!=end:continue
        name=val(row,"metric")
        if not name.startswith("external."):
            finding("CONTRIBUTION_NAMESPACE","contributions",row,"Approved governance/other-strand inputs use the external. namespace and cannot replace computed Crisis metrics.");continue
        if name in totals:
            finding("CONTRIBUTION_DUPLICATE","contributions",row,"Each approved external metric has exactly one complete value.");continue
        kind=val(row,"type");value=val(row,"value")
        try:
            if kind=="count":
                number=decimal_value(value);require(number>=0 and number==number.to_integral_value(),"CRF_CONTRIBUTION_COUNT","Use a nonnegative whole count.");value=int(number)
            elif kind=="money":
                number=decimal_value(value);require(number>=0 and number.as_tuple().exponent>=-2,"CRF_CONTRIBUTION_MONEY","Use nonnegative GBP to at most two decimals.");value=number
            else:require(kind=="text","CRF_CONTRIBUTION_TYPE","Use count, money or text.")
        except MigrationError as exc:
            finding("CONTRIBUTION_VALUE","contributions",row,str(exc));continue
        definitions[name]={"id":name,"label":name,"type":kind};totals[name]=value;refs[name]=1
        send("lineage",{"metric_id":name,"dataset_id":selected["contributions"]["dataset"]["id"],"row_id":row["id"],"ordinal":row["ordinal"],"contribution":decimal_text(value) if isinstance(value,Decimal) else value,"reason":"Actual supplied contribution; authority reference retained in source."})
    def equality(code,ids,expected):
        actual=sum((totals[k] for k in ids),Decimal(0) if isinstance(expected,Decimal) else 0)
        if actual!=expected:finding(code,"report",code,"Required reporting categories do not reconcile.",details={"actual":str(actual),"expected":str(expected),"metrics":ids})
    equality("ROUTE_TOTAL",["t10."+k for k in CATEGORIES["route"]],totals["t9.awarded"])
    equality("SUPPORT_BASIS_TOTAL",["t11.application","t11.non_application"],totals["t8.spend"])
    for table,field in (("t14","presenting_crisis"),("t15","support_method"),("t16","crisis_need")):
        equality(table.upper()+"_AWARD_TOTAL",[table+"a."+k for k in CATEGORIES[field]],totals["t9.awarded"])
        equality(table.upper()+"_SPEND_TOTAL",[table+"b."+k for k in CATEGORIES[field]],totals["t8.spend"])
    for pair in (("employed","not_employed"),("benefits","no_benefits")):
        equality("DEMOGRAPHIC_AWARD_"+"_".join(pair),["t17a."+k for k in pair],totals["t9.awarded"])
        equality("DEMOGRAPHIC_SPEND_"+"_".join(pair),["t17b."+k for k in pair],totals["t8.spend"])
    state="READY_FOR_WORKBOOK_MAPPING" if not checks else "REVIEW_REQUIRED"
    metrics=[]
    for key in definitions:
        value=totals[key];kind=definitions[key]["type"]
        rendered=format(value,".2f") if kind=="money" else value
        metrics.append({**definitions[key],"value":rendered,"source_contributions":refs[key],"status":"COMPLETE" if not checks else "PROVISIONAL"})
    return {"schema":SCHEMA,"period":period,"period_name":period_name,"status":state,"metrics":metrics,"checks":checks,
            "lineage":lineage,"check_counts":dict(check_counts),"selected_source_rows":sum(len(x["rows"]) for x in selected.values()),
            "rule_source":RULES,"rule_version":"Year 1 / 7 April 2026","scope":"Crisis support plus explicitly supplied governance/other-strand inputs",
            "meaning":"Computed values do not establish complete whole-workbook compliance, native recalculation, Section 151 sign-off, copied recipients or DWP acceptance."}

def compare(earlier, later, earlier_sources, later_sources):
    changes=[];metrics=[]
    for family in FIELDS:
        before=defaultdict(list);after=defaultdict(list)
        for row in earlier_sources[family]["rows"]:before[row["id"]].append(row)
        for row in later_sources[family]["rows"]:after[row["id"]].append(row)
        old_ds=earlier_sources[family]["dataset"];new_ds=later_sources[family]["dataset"]
        old_context=old_ds["context"];new_context=new_ds["context"]
        coverage=(new_context["coverage"]=="complete"
                  and old_ds["contract_id"]==new_ds["contract_id"]
                  and old_ds["family"]==new_ds["family"]
                  and all(val(row,KEYS[family]) is not None for row in later_sources[family]["rows"])
                  and new_context["period_start"]<=old_context["period_start"]
                  and new_context["period_end"]>=old_context["period_end"]
                  and datetime.fromisoformat(instant(new_context["captured_at"]))>=datetime.combine(
                      date.fromisoformat(old_context["period_end"])+timedelta(days=1),datetime.min.time(),ZoneInfo("Europe/London")))
        for key in sorted(set(before)|set(after)):
            a,b=before.get(key,[]),after.get(key,[])
            # Out-of-window original rows cannot borrow the declared window's
            # absence assurance. Keep their actual temporal scope explicit.
            def covered(row):
                if family in ("applications","awards","allocations","payment_controls"):
                    day=val(row,"reporting_on")
                    return day is not None and new_context["period_start"]<=day<=new_context["period_end"]
                if family=="repeat_counts":
                    day=val(row,"as_of")
                    return day is not None and new_context["period_start"]<=day<=new_context["period_end"]
                first,last=val(row,"period_start"),val(row,"period_end")
                return first is not None and last is not None and new_context["period_start"]<=first<=last<=new_context["period_end"]
            group_coverage=coverage and all(covered(row) for row in a)
            if len(a)>1 or len(b)>1:status="AMBIGUOUS"
            elif not a:status="ADDED"
            elif not b:status="REMOVED" if group_coverage else "NOT_OBSERVED"
            elif canonical(a[0]["cells"])==canonical(b[0]["cells"]) and a[0]["raw"]==b[0]["raw"] and a[0]["raw_types"]==b[0]["raw_types"]:status="UNCHANGED"
            else:status="CHANGED"
            changes.append({"family":family,"id":key,"status":status,"before":a,"after":b,
                            "before_occurrences":len(a),"after_occurrences":len(b),
                            "later_complete_compatible_coverage":group_coverage,
                            "meaning":"Every original occurrence is retained; duplicate identities are ambiguous. Absence requires complete compatible closed-period extraction."})
    a={m["id"]:m for m in earlier["metrics"]};b={m["id"]:m for m in later["metrics"]}
    for key in sorted(set(a)|set(b)):
        old,new=a.get(key),b.get(key)
        metrics.append({"id":key,"status":"UNCHANGED" if old==new else "CHANGED","before":old,"after":new})
    return {"changes":changes,"metrics":metrics,"counts":dict(Counter(x["status"] for x in changes))}
