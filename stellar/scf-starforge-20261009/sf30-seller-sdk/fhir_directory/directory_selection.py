"""MIT. Reviewed directory service choices with original hours, units and owners."""
from __future__ import annotations
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit
from directory_runtime import InputError,source,safe_read,original_workspace
from directory_domain import DirectoryView,public_ref,ref_key,value,key,at_pointer
from directory_schedule import instant,zone,schedule_result,capacity_result
import directory_schema as schema

def check(name,state,reason,values=None,refs=None):
    return {"criterion":name,"state":state,"reason":reason,"values":values or [],"sourceRefs":refs or []}

def exact_tokens(value):
    if value is None:return []
    if isinstance(value,list):return [str(v) for v in value if not isinstance(v,(dict,list)) and v is not None]
    if isinstance(value,dict):
        out=[]
        for k in ("id","code","name","label","uri","url","identifier","term","language"):
            if k in value:out.extend(exact_tokens(value[k]))
        if "coding" in value:out.extend(exact_tokens(value["coding"]))
        return out
    return [str(value)]

def selected_evidence(record,path,observation):
    return {"ref":public_ref(record),"pointer":path,"observation":observation}

def referenced_rows(view,row,reference,resource_type):
    if not isinstance(reference,str):return []
    candidates=[]
    for link in view.links(row):
        if link.get("kind")!="fhir-reference" or link.get("reference")!=reference:continue
        candidates.extend(r for r in view.targets(link) if r["table"]==resource_type)
    return _unique(candidates)

def hsds_identity(view,table,ident):
    if ident in (None,""):return []
    return [r for r in view.rows(table) if key(value(r).get("id"))==key(ident)]

def compact_originals(rows):
    return [{"ref":public_ref(r),"table":r["table"],"original":value(r),
        "sourcePointer":r.get("pointer"),"memberName":r.get("memberName")}for r in rows]

def _unique(rows):
    return list({ref_key(r):r for r in rows}.values())

def service_context(view,row,criteria):
    raw=value(row);fhir=row["table"]=="HealthcareService";findings=[];organizations=[];locations=[];phones=[];languages=[];attributes=[];schedules=[];capacities=[]
    if fhir:
        ref=raw.get("providedBy",{}).get("reference")
        organizations=referenced_rows(view,row,ref,"Organization") if ref else []
        if ref and len(organizations)!=1:findings.append({"code":"provider-reference","reference":ref,"candidateRefs":[public_ref(r)for r in organizations],"state":"ambiguous" if organizations else "unresolved"})
        for reference in raw.get("location",[]):
            refs=referenced_rows(view,row,reference.get("reference"),"Location")
            locations.extend(refs)
            if len(refs)!=1:findings.append({"code":"location-reference","reference":reference,"candidateRefs":[public_ref(r)for r in refs],"state":"ambiguous" if refs else "unresolved"})
        if not ref:
            # R4 gives the selected Location's managingOrganization as the
            # meaning when HealthcareService.providedBy is absent.
            for location in _unique(locations):
                managing=value(location).get("managingOrganization",{}).get("reference")
                if not managing:continue
                related=referenced_rows(view,location,managing,"Organization")
                organizations.extend(related)
                if len(related)!=1:findings.append({"code":"location-provider-reference","reference":managing,"locationRef":public_ref(location),"candidateRefs":[public_ref(r)for r in related],"state":"ambiguous" if related else "unresolved"})
            if len(_unique(organizations))>1:findings.append({"code":"multiple-location-providers","candidateRefs":[public_ref(r)for r in _unique(organizations)],"state":"ambiguous"})
        for pos,s in enumerate(raw.get("availableTime",[])):
            schedules.append({"ref":public_ref(row),"pointer":"/availableTime/"+str(pos),"use":"operating-hours","basis":"FHIR-availableTime","original":s})
        for pos,s in enumerate(raw.get("notAvailable",[])):
            schedules.append({"ref":public_ref(row),"pointer":"/notAvailable/"+str(pos),"use":"exclusion","basis":"FHIR-notAvailable","original":s})
        if raw.get("availabilityExceptions"):
            schedules.append({"ref":public_ref(row),"pointer":"/availabilityExceptions","use":"narrative-exception","basis":"FHIR-availabilityExceptions","original":raw["availabilityExceptions"]})
        languages=[{"ref":public_ref(row),"pointer":"/communication","tokens":exact_tokens(raw.get("communication",[]))}]
        attributes=[{"ref":public_ref(row),"pointer":"/type","tokens":exact_tokens(raw.get("type",[]))+exact_tokens(raw.get("category",[]))+exact_tokens(raw.get("specialty",[]))}]
    else:
        organizations=hsds_identity(view,"organization",raw.get("organization_id"))
        organizations.extend(view.children(row,"organization",["organization"]))
        organizations=_unique(organizations)
        if raw.get("organization_id") and len(organizations)!=1:
            findings.append({"code":"provider-reference","nativeId":raw["organization_id"],"candidateRefs":[public_ref(r)for r in organizations],"state":"ambiguous" if organizations else "unresolved"})
        links=view.related(row,"service_at_location","/service_id")
        for link in links:
            related=hsds_identity(view,"location",value(link).get("location_id"))
            related.extend(view.children(link,"location",["location"]))
            locations.extend(related)
            if len(_unique(related))!=1:findings.append({"code":"location-reference","ref":public_ref(link),"candidateRefs":[public_ref(r)for r in related],"state":"ambiguous" if related else "unresolved"})
        phones.extend(view.related(row,"phone","/service_id"))
        for language in view.related(row,"language","/service_id"):
            languages.append({"ref":public_ref(language),"pointer":"","tokens":exact_tokens(value(language))})
        for attr in view.related(row,"attribute","/link_id"):
            raw_attr=value(attr);tokens=exact_tokens(raw_attr)
            for term in hsds_identity(view,"taxonomy_term",raw_attr.get("taxonomy_term_id")):tokens.extend(exact_tokens(value(term)))
            attributes.append({"ref":public_ref(attr),"pointer":"","tokens":tokens})
        decisions={ref_key(v["ref"]):v for v in criteria.get("scheduleDecisions",[])}
        schedule_rows=view.related(row,"schedule","/service_id")
        for link in links:schedule_rows.extend(view.related(link,"schedule","/service_at_location_id"))
        selected_locations={ref_key(v)for v in criteria.get("locationRefs",[])}
        for location in _unique(locations):
            if not selected_locations or ref_key(location)in selected_locations:
                schedule_rows.extend(view.related(location,"schedule","/location_id"))
        for item in _unique(schedule_rows):
            pointer=item.get("pointer","");decision=decisions.get(ref_key(item))
            if "/operating_hours/" in pointer:use="operating-hours";basis="original-operating_hours"
            elif "/events/" in pointer:use="event";basis="original-events"
            elif decision:use=decision["use"];basis="reviewed-legacy-schedule"
            else:use="unclassified";basis="legacy-schedule-needs-classification"
            schedules.append({"ref":public_ref(item),"pointer":pointer,"use":use,"basis":basis,"original":value(item),"decision":decision})
        capacities=view.related(row,"service_capacity","/service_id")
    locations=_unique(locations);organizations=_unique(organizations)
    for org in organizations:
        if not fhir:phones.extend(view.related(org,"phone","/organization_id"))
    for loc in locations:
        if not fhir:phones.extend(view.related(loc,"phone","/location_id"))
    contact=[]
    for original in [row]+organizations+locations:
        body=value(original)
        if fhir:
            for pos,p in enumerate(body.get("telecom",[])):
                if p.get("value"):contact.append({"ref":public_ref(original),"pointer":"/telecom/"+str(pos),"system":p.get("system"),"value":p["value"]})
        else:
            for k,system in [("email","email"),("url","url")]:
                if body.get(k):contact.append({"ref":public_ref(original),"pointer":"/"+k,"system":system,"value":body[k]})
    for p in _unique(phones):
        if value(p).get("number"):contact.append({"ref":public_ref(p),"pointer":"/number","system":"phone","value":value(p)["number"],"type":value(p).get("type")})
    return {"original":raw,"fhir":fhir,"organizations":organizations,"locations":locations,"languages":languages,"taxonomy":attributes,
        "schedules":schedules,"capacities":capacities,"contacts":contact,"findings":findings}

def evaluate_service(view,row,criteria):
    context=service_context(view,row,criteria);raw=context["original"];checks=[]
    if context["fhir"]:
        status="inactive" if raw.get("active")is False else "active"
        status_basis="original-FHIR-active" if "active"in raw else "FHIR-R4-meaning-if-missing-active"
    else:status=raw.get("status");status_basis="original-HSDS-status"
    allowed=criteria.get("allowedStatuses",[])
    checks.append(check("status","unknown" if allowed and status is None else "met" if status in allowed else "not-met" if allowed else "not-requested",
        "Exact declared service status compared with the selected values" if allowed else "Original status retained; no status criterion selected",[status] if status is not None else [],[public_ref(row)]))
    for name,requested,evidence in [("languages",criteria.get("languages",[]),context["languages"]),("taxonomy",criteria.get("taxonomyTerms",[]),context["taxonomy"])]:
        tokens={v for item in evidence for v in item["tokens"]}
        state="not-requested" if not requested else "unknown" if not tokens else "met" if set(requested)<=tokens else "not-met"
        checks.append(check(name,state,"Comparison uses exact original codes and labels; interpretation free text is retained separately",sorted(tokens),[e["ref"]for e in evidence]))
    requested_locations={ref_key(r)for r in criteria.get("locationRefs",[])}
    location_keys={ref_key(r)for r in context["locations"]}
    checks.append(check("locations","not-requested" if not requested_locations else "unknown" if not location_keys else "met" if requested_locations&location_keys else "not-met",
        "Selected service-location relationships retain their original references",[public_ref(r)for r in context["locations"]],[public_ref(r)for r in context["locations"]]))
    schedule_observations=[]
    if criteria.get("at"):
        at=instant(criteria["at"])
        for s in context["schedules"]:
            if s["use"]=="narrative-exception":
                schedule_observations.append({**s,"evaluation":{"state":"unknown","reason":"Original free-text availability exceptions require the receiving operator's interpretation"}})
            elif s["use"]in {"event","exclude","unclassified"}:
                schedule_observations.append({**s,"evaluation":{"state":"not-operating-hours" if s["use"]!="unclassified" else "unknown","reason":"The original event or unresolved legacy schedule is separate from operating hours"}})
            elif s["use"]=="exclusion":
                period=s["original"].get("during") or {};unknown=not(period.get("start") or period.get("end"))
                try:
                    excluded=not unknown and (not period.get("start") or instant(period["start"],"Exclusion start")<=at) and (not period.get("end") or at<=instant(period["end"],"Exclusion end"))
                    evaluation={"state":"excludes" if excluded else "unknown" if unknown else "outside-exclusion","reason":s["original"].get("description","Original FHIR notAvailable period")}
                except InputError as error:evaluation={"state":"unknown","reason":str(error)}
                schedule_observations.append({**s,"evaluation":evaluation})
            else:schedule_observations.append({**s,"evaluation":schedule_result(s["original"],at,criteria.get("timezone"),context["fhir"])})
        states=[r["evaluation"]["state"]for r in schedule_observations]
        # An observed exclusion dominates openings; unknown alternative groups remain explicit.
        observed="not-met" if "excludes"in states else "met" if "open"in states and "unknown"not in states else "unknown" if not states or "unknown"in states else "not-met"
        checks.append(check("operating-hours",observed,"Exact source intervals at the selected instant; events and legacy classifications stay separate",schedule_observations,[s["ref"]for s in schedule_observations]))
    else:checks.append(check("operating-hours","not-requested","No assessment instant was selected",context["schedules"],[s["ref"]for s in context["schedules"]]))
    capacity_observations=[]
    if criteria.get("capacity"):
        requested=criteria["capacity"]
        for r in context["capacities"]:
            original=value(r);unit=original.get("unit")
            tokens=exact_tokens(unit)+exact_tokens(original.get("unit_id"))
            if not isinstance(unit,dict) and original.get("unit_id"):
                for u in hsds_identity(view,"unit",original["unit_id"]):tokens.extend(exact_tokens(value(u)))
            if requested["unit"] not in tokens:continue
            capacity_observations.append({"ref":public_ref(r),"unitTokens":tokens,"evaluation":capacity_result(original,requested)})
        states=[o["evaluation"]["state"]for o in capacity_observations]
        # Several unequal observations require a deliberate source-edition selection.
        fingerprints={key(o["evaluation"]["original"])for o in capacity_observations}
        state="unknown" if not states or len(fingerprints)>1 else "met" if all(s=="sufficient" for s in states) else "not-met" if all(s=="insufficient" for s in states) else "unknown"
        checks.append(check("capacity",state,"Exact unit, timestamp and selected observation age; conflicting observations remain visible",capacity_observations,[o["ref"]for o in capacity_observations]))
    else:checks.append(check("capacity","not-requested","No capacity criterion was selected",compact_originals(context["capacities"]),[public_ref(r)for r in context["capacities"]]))
    checks.append(check("contact","met" if criteria.get("requireContact") and context["contacts"] else "unknown" if criteria.get("requireContact") else "not-requested",
        "Original service/provider contact routes; directory endpoints require separate receiving authorization",context["contacts"],[r["ref"]for r in context["contacts"]]))
    failures=sum(c["state"]=="not-met"for c in checks);unknowns=sum(c["state"]=="unknown"for c in checks)
    return {"ref":public_ref(row),"table":row["table"],"name":raw.get("name"),"status":status,"statusBasis":status_basis,"original":raw,
        "organizations":compact_originals(context["organizations"]),"locations":compact_originals(context["locations"]),
        "contacts":context["contacts"],"checks":checks,"referenceFindings":context["findings"],
        "classification":"criteria-not-met" if failures else "needs-review" if unknowns or context["findings"] else "matches-selected-criteria"}

class DirectorySelection:
    def save_directory_selection(self,raw):
        data=schema.input_value("selection",raw)
        with self.mutex,self.scratch() as temp:
            view=DirectoryView(self,data["editionId"])
            data.setdefault("conversionId",None);data.setdefault("predecessorId",None)
            if data["predecessorId"]:self.directory_record("selections",data["predecessorId"])
            if data["conversionId"]:
                conversion=self.directory_conversion(data["conversionId"])
                if conversion["editionId"]!=data["editionId"]:raise InputError("The selected conversion must use this exact directory edition")
            if not data["serviceRefs"]:raise InputError("Choose at least one original service candidate")
            refs={ref_key(r)for r in data["serviceRefs"]}
            if len(refs)!=len(data["serviceRefs"]):raise InputError("Selection repeats an original candidate")
            chosen={ref_key(r)for r in data["chosenRefs"]}
            if len(chosen)!=len(data["chosenRefs"]) or not chosen<=refs:raise InputError("Choose distinct services from the original candidate set")
            dispositions={ref_key(r["ref"]):r for r in data["dispositions"]}
            if len(dispositions)!=len(data["dispositions"]) or not set(dispositions)<=refs:raise InputError("Each disposition selects one original candidate")
            if chosen!={k for k,v in dispositions.items()if v["decision"]=="selected"}:
                raise InputError("Chosen services and the recorded selected dispositions must agree")
            for k,v in dispositions.items():
                view.row(v["ref"])
                if not v["reason"].strip():raise InputError("Every service disposition retains its real selection reason")
                if v["decision"]in {"reserve","needs-contact"} and not v.get("owner","").strip():raise InputError("An unresolved selection step requires its operating owner")
            criteria=data["criteria"]
            if criteria.get("at"):instant(criteria["at"])
            if criteria.get("timezone"):zone(criteria["timezone"])
            if criteria.get("capacity"):instant(criteria["capacity"]["asOf"],"Capacity assessment")
            for ref in criteria.get("locationRefs",[]):
                if view.row(ref)["table"] not in {"location","Location"}:raise InputError("A selected location must be an original location record")
            seen=set()
            for decision in criteria.get("scheduleDecisions",[]):
                if ref_key(decision["ref"])in seen:raise InputError("A schedule has more than one reviewed classification")
                seen.add(ref_key(decision["ref"]))
                if view.row(decision["ref"])["table"]!="schedule":raise InputError("Schedule interpretation requires an exact original HSDS schedule row")
                if not decision["reason"].strip():raise InputError("Retain the reason for each legacy schedule classification")
            candidates=[]
            for ref in data["serviceRefs"]:
                row=view.row(ref)
                if row["table"]not in {"service","HealthcareService"}:raise InputError("Choose original HSDS service or FHIR HealthcareService candidates")
                outcome=evaluate_service(view,row,criteria)
                outcome["disposition"]=dispositions.get(ref_key(row))
                outcome["chosen"]=ref_key(row)in chosen
                candidates.append(outcome)
            result={"schema":"stellar-forge.human-services-directory-selection-analysis.v1","editionId":data["editionId"],"criteria":criteria,"candidates":candidates,
                "summary":{"candidates":len(candidates),"chosen":len(chosen),"classificationCounts":dict(Counter(c["classification"]for c in candidates)),
                    "followUpOwners":sorted({d["owner"]for d in data["dispositions"]if d.get("owner")})}}
            path=Path(temp)/"selection.json";original_workspace.private_write(path,source.lexical_json(result).encode()+b"\n")
            if path.stat().st_size>schema.MAX_RECORD:raise InputError("Complete selected-service analysis exceeds the64MiB record limit")
            return self._directory_store("selections",{**data,"summary":result["summary"],"reportFile":self._retain_file(path,"complete-directory-service-selection")})

    def directory_selection(self,ident):
        record=self.directory_record("selections",ident)
        return source.json_value(safe_read(self._file_path(record["reportFile"]),schema.MAX_RECORD),lexical=True)

    def directory_selection_page(self,ident,offset=0,limit=50,query=""):
        rows=self.directory_selection(ident)["candidates"]
        if query:rows=[r for r in rows if query.casefold()in source.lexical_json(r).casefold()]
        return self._directory_rows_page(rows,offset,limit)
