"""Actual bilingual public sources and an explicitly separate authored exercise.

Importing either seed is idempotent. It does not create real committee members,
votes, SCC approvals, awarded funding, invoices or collected money.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

if __package__:
    from . import engine
else:
    import engine

ROOT=Path(__file__).resolve().parent/"demo"

def _load(name):
    raw=(ROOT/name).read_bytes()
    return json.loads(raw),raw

def _text(value):
    if isinstance(value,str):return value
    if isinstance(value,list):return "\n".join(_text(x) for x in value)
    return engine.canonical(value)

def _record(state,collection,record_id,**fields):
    row=engine.validate_record(collection,{"id":record_id,**fields})
    state[collection].append(row)
    return row

def _verified_file(relative_path,expected):
    path=ROOT/relative_path
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected:
        raise ValueError("A packaged public source differs from its acquired digest: "+relative_path)
    return path.name,raw

def public_seed():
    annex,annex_raw=_load("profile-annex.json")
    profiles,profiles_raw=_load("procedural-profiles.json")
    programme,programme_raw=_load("work-program.json")
    manifest,manifest_raw=_load("source-manifest.json")
    expected_annex=manifest.get("annex",{}).get("sha256")
    if expected_annex and hashlib.sha256(annex_raw).hexdigest()!=expected_annex:
        raise ValueError("The public annex differs from its source manifest.")
    state=engine.initial_state("Municipal data reconciliation — public drafting example",
                               "scc-municipal-public-v1","public_example")
    files={}
    for source in annex["sources"]:
        sid=source["id"]
        language="fr" if sid.endswith("-fr") or "-fr-" in sid else ("en" if sid.endswith("-en") or "-en-" in sid else "unspecified")
        _record(state,"sources",sid,title=source["title"],url=source["url"],publisher=source["publisher"],
                version="2025 publisher edition, retrieved 2026-10-11",language=language,
                representation="original_bytes",license=source["licence"]+" — "+source["licence_url"],
                retrieved_at=source.get("retrieved_at",""),citation_visibility="public",public_redistribution=True,
                notes="Original acquired response bytes. Source cells and territorial/population vintages remain distinct.")
        files[sid]=_verified_file(source["file"],source["sha256"])
    for transform in annex.get("transformations",[]):
        sid=transform["id"]+"-utf8"
        language="fr" if transform["id"].endswith("fr") else "en"
        original=next(s for s in annex["sources"] if s["id"]==transform["source_id"])
        _record(state,"sources",sid,title="Lossless UTF-8 derivative of "+original["title"],url=original["url"],
                publisher=original["publisher"],version="Explicit cp1252 → UTF-8 derivative",language=language,
                representation="original_bytes",license=original["licence"]+" — "+original["licence_url"],
                citation_visibility="public",public_redistribution=True,
                notes=_text(transform))
        files[sid]=_verified_file(transform["output_file"],transform["output_sha256"])
    for sid,title,name,raw,url in [
        ("profile-annex-source","Authored bilingual reconciliation clauses and source-bound cases","profile-annex.json",annex_raw,""),
        ("procedural-profiles-source","Authored source-specific standards procedure summaries","procedural-profiles.json",profiles_raw,""),
        ("public-source-manifest","Public source acquisition and lossless-transform manifest","source-manifest.json",manifest_raw,""),
        ("dgc-programme","Published DGC work-programme metadata, September 2–October 1, 2026","work-program.json",programme_raw,programme["source_url"])]:
        _record(state,"sources",sid,title=title,url=url,publisher="TokenJunkie Labs" if sid!="dgc-programme" else "Digital Governance Council — authored metadata extraction",
                version="2026-10-11",language="bilingual" if sid=="profile-annex-source" else "en",
                representation="authored_summary",license="MIT for authored structure and prose; original source notices apply.",
                citation_visibility="public",public_redistribution=True,
                notes="Public demonstration source. No appointed committee, approved standard or awarded project is implied.")
        files[sid]=(name,raw)
    for source in profiles["sources"]:
        _record(state,"sources",source["id"],title=source["id"],url=source["url"],
                publisher="Standards Council of Canada" if source["id"]!="dgsi-ed7" else "Digital Governance Standards Institute",
                version="Exact linked procedure edition; see profile source locator",language="en",
                representation="reference_link",citation_visibility="public",
                notes="Reference URL only. Restricted procedural PDF bytes are not packaged or attached.")
    for profile in profiles["profiles"]:
        kind=profile["deliverable_type"]
        lifecycle=profile.get("lifecycle",{})
        _record(state,"procedures",profile["id"],title=profile["title"],
                applies_to=["NSC" if kind=="ordinary_DGSI_standard" else kind],
                source_ids=profile["source_ids"],source_locator="Source-specific profile "+profile["id"],
                edition=profile["id"],profile_status="source_summary",
                participant_majority=profile["participant_majority"],
                affirmative_fraction=profile["affirmative_fraction"],affirmative_denominator=profile["affirmative_denominator"],
                negative_fraction_max=profile["negative_fraction_max"],negative_denominator=profile["negative_denominator"],
                exclude_unjustified_negative=profile["exclude_unjustified_negative"],
                exclude_unjustified_abstention=profile["exclude_unjustified_abstention"],
                interest_balance=bool(profile.get("interest_balance")),
                public_review_days=profile.get("public_review_days"),
                public_review_requirement="guidance" if kind=="PAS" else ("mandatory" if kind=="ordinary_DGSI_standard" else "not_specified"),
                urgent_review_days=profile.get("urgent_review_days"),
                require_peer_review=kind=="TS",require_workshop=kind=="WA",
                publish_within_months_of_workshop=lifecycle.get("publish_within_calendar_months_of_workshop"),
                require_comment_disposition=True,require_negative_resolution=kind in ("PAS","ordinary_DGSI_standard"),
                require_independent_review=profile["independent_review_required"],
                require_sponsor_endorsement=profile["sponsor_required"],
                maintenance_months=lifecycle.get("initial_validity_months_max",lifecycle.get("review_within_months",lifecycle.get("review_interval_months"))),
                maximum_extension_months=lifecycle.get("extension_months_max"),
                interpretation_source="Selected source summary; actual project authority and any denominator interpretation remain explicit.",
                notes=_text(profile.get("notes",[]))+"\n"+_text(lifecycle))
    for candidate in programme["records"]:
        identifier=candidate["standard_no"]
        kind="TS" if "/TS " in identifier else "WA" if "/WA " in identifier else "PAS" if "/PAS " in identifier else "NSC"
        relationship="out_of_scope" if "140" in identifier or "142" in identifier else "not_reviewed"
        rationale="This existing open-finance/health work is not a proposed new topic in this example." if relationship=="out_of_scope" else ""
        _record(state,"references",candidate["id"],identifier=identifier,title=candidate["title"],
                owner="Digital Governance Council",deliverable_type=kind,
                stage=candidate["section"]+" — "+candidate["stage_code"],
                published_date=candidate["stage_code_start_date"] or None if candidate["section"]=="Recently Published" else None,
                source_period=programme["published_period"],relationship=relationship,rationale=rationale,
                source_ids=["dgc-programme"],source_locator="Retained source line "+str(candidate["source_line"]),
                url=programme["source_url"])
    _record(state,"scope","municipal-profile-scope",title_en=annex["title_en"],title_fr=annex["title_fr"],
            deliverable_type="TS",purpose=_text(annex["scope_en"]),purpose_fr=_text(annex["scope_fr"]),
            preface_en=_text(annex.get("preface_en","")),preface_fr=_text(annex.get("preface_fr","")),
            audience="Municipal data publishers, receiving analysts and stewards reviewing reconciliation handovers.",
            audience_fr="Organismes municipaux publiant des données, analystes destinataires et responsables de la réconciliation.",
            exclusions="No certification, real committee approval, current population estimate or silent overwrite of original records.",
            exclusions_fr="Aucune certification, approbation réelle de comité, estimation actuelle de population ni modification silencieuse des enregistrements originaux.",
            roadmap_issues=[18,23,28],procedure_id="scc-ts-flexible",new_work_status="proposed",
            national_international_relationship="Application-profile hypothesis for source-preserving municipal reconciliation; adjacent-standard analysis and prime/topic acceptance remain open.",
            source_ids=["profile-annex-source","scc-rfp"],
            notes=_text(annex.get("authority_statement_en",""))+"\n"+_text(annex.get("authority_statement_fr","")))
    for case in annex["cases"]:
        source_ids=sorted({r["source_id"] for r in case["input_rows"] if isinstance(r,dict) and r.get("source_id")})
        source_ids=list(dict.fromkeys(source_ids+[x for x in case.get("source_refs",[]) if isinstance(x,str)]))
        known={s["id"] for s in state["sources"]}
        source_ids=[s for s in source_ids if s in known]
        _record(state,"cases",case["id"],title=case["title"],title_fr=case.get("title_fr",""),authored=True,
                source_ids=source_ids,source_rows=deepcopy(case["input_rows"]),
                review_questions=case.get("review_questions",[]),review_questions_fr=case.get("review_questions_fr",[]),
                expected_observations=case.get("expected_observations",[]),expected_observations_fr=case.get("expected_observations_fr",[]),
                notes="Authored review questions and proposed outcome: "+_text(case.get("proposed_review_outcome",""))+
                "\nDerived quantities, where present: "+_text(case.get("derived_quantities",{})))
    for clause in annex["clauses"]:
        _record(state,"clauses",clause["id"],number=clause["number"],parent_id=clause.get("parent_id") or "",
                kind="normative" if clause.get("kind")=="proposed_requirement" else "informative",
                title_en=clause["title_en"],body_en=clause.get("body_en",""),title_fr=clause.get("title_fr",""),
                body_fr=clause.get("body_fr",""),table_en=clause.get("table_en",[]),table_fr=clause.get("table_fr",[]),
                source_ids=clause.get("source_ids",[]),case_ids=clause.get("case_ids",[]),
                notes="Authored proposed text. Bilingual review and standards-body acceptance are not inferred.")
    for phase,title,note in [
        ("1","Confirm scope, Canadian prime and selected standards procedure","Resolve eligibility, adjacent work, stakeholder need and the actual selected procedure."),
        ("2","Develop and review source-preserving reconciliation clauses","Use the original EN/FR rows, original vintages and explicitly authored review questions."),
        ("3","Record review responses, decisions and bilingual review","Choose the applicable TS/PAS/WA/CSG procedure; preserve comment dispositions and actual authority."),
        ("4","Publish the selected edition and retain the maintenance handover","Export editable EN/FR documents, source/case annexes and the independent private continuation archive.")]:
        _record(state,"tasks","phase-"+phase+"-drafting-plan",title=title,phase=phase,notes="Proposed workflow. "+note)
    engine.validate_state(state)
    return state,files

def authored_seed():
    state,files=public_seed()
    state["id"]="scc-authored-operator-v1"
    state["title"]="Authored operator exercise — committee and delivery records"
    state["mode"]="authored_example"
    scope=state["scope"][0]
    scope["deliverable_type"]="PAS";scope["procedure_id"]="scc-pas-2021-flexible"
    scope["notes"]+="\nThis separate exercise uses an authored PAS scenario. No people, decisions or funding in this project are actual SCC/DGC records."
    scope["planned_start"]="2027-01-15";scope["planned_finish"]="2027-10-14"
    for index,interest in enumerate(["User","User","Producer","Producer","Government/Regulator","Government/Regulator","General Interest"],1):
        pid=f"example-member-{index:02}"
        _record(state,"people",pid,name=f"Example member {index:02}",organization="Authored example organization",
                development_roles=["authored exercise participant"],authored_example=True)
        _record(state,"memberships","example-membership-"+str(index),person_id=pid,role="steering",interest=interest,
                begins="2027-01-15",source_ids=[],notes="Authored membership for an operator exercise; no actual appointment.")
    _record(state,"people","example-independent-reviewer",name="Example independent reviewer",organization="Authored reviewer organization",
            authored_example=True,notes="No actual appointment or independence declaration is implied.")
    for sid,title,content in [
        ("example-agreement","Authored agreement reference","AUTHORING EXERCISE ONLY. Proposed base CAD112000 and separate OLA contingency CAD12000. Phase amounts16000/42000/30000/24000. No actual contract or award."),
        ("example-cost-record","Authored cost substantiation","AUTHORING EXERCISE ONLY. Example delivered analysis service: net CAD1250.00, example HST162.50, total1412.50. These entered tax amounts do not determine tax treatment of an actual supplier."),
        ("example-phase-response","Authored phase response reference","AUTHORING EXERCISE ONLY. A hypothetical Phase1 report response can be recorded against its exact report digest. No SCC report acceptance has occurred."),
        ("example-remittance","Authored remittance reference","AUTHORING EXERCISE ONLY. Hypothetical invoice receipt CAD1412.50, reference EXAMPLE-REMIT-001. No money has been collected."),
        ("example-appointment","Authored committee/reviewer appointment","AUTHORING EXERCISE ONLY. Example participant appointments and independent-review declaration must be recorded explicitly. No real organization has appointed the named example people."),
        ("example-consultation-record","Authored consultation and decision record","AUTHORING EXERCISE ONLY. Retain the invitation, scope of review, individual response/disposition and separate sponsor/developer decision. This text is a workflow input, not a real public consultation.")]:
        raw=(content+"\n").encode()
        _record(state,"sources",sid,title=title,publisher="TokenJunkie Labs — authored example",language="en",
                representation="authored_example",license="MIT",citation_visibility="internal",
                notes="Explicitly authored exercise material. No actual award, acceptance, payment or committee action.")
        files[sid]=(sid+".txt",raw)
    first,second=state["clauses"][:2]
    import csv,io
    out=io.StringIO(newline="")
    writer=csv.writer(out);writer.writerow(["comment_key","clause_id","body","kind"])
    writer.writerow(["EXAMPLE-01",first["id"],"Authored comment: retain the original row identity when several rows are combined.","technical"])
    writer.writerow(["EXAMPLE-02",second["id"],"Authored comment: distinguish a missing value from a recorded zero.","editorial"])
    raw=out.getvalue().encode()
    _record(state,"sources","example-comments",title="Authored comments for explicit CSV import",publisher="TokenJunkie Labs",
            language="en",representation="authored_example",license="MIT",citation_visibility="internal",
            notes="Two authored comments; no real consultation response.")
    files["example-comments"]=("authored-comments.csv",raw)
    _record(state,"funding","example-funding",title="Authored proposed delivery budget",status="proposed",
            start="2027-01-15",finish="2027-10-14",base_cad="112000.00",ola_cad="12000.00",
            phase_amounts={"1":"16000.00","2":"42000.00","3":"30000.00","4":"24000.00"},
            notes="Planning exercise only. No executed contract, award or receivable.")
    for phase,amount in [("1","16000.00"),("2","42000.00"),("3","30000.00"),("4","24000.00")]:
        _record(state,"costs","example-phase-"+phase+"-estimate",title="Authored Phase "+phase+" estimate",phase=phase,
                category="base",basis="estimate",net_cad=amount,notes="Estimate only; not an incurred or invoiceable cost.")
    engine.validate_state(state)
    return state,files

def seed_demo(workspace,kind="public"):
    if kind not in ("public","authored"):raise ValueError("Choose public sources or the separate authored exercise.")
    state,files=public_seed() if kind=="public" else authored_seed()
    identity_state={k:v for k,v in state.items() if k not in engine.OPTIONAL_COLLECTIONS or v}
    seed_hash=engine.digest({"state":identity_state,"sources":{sid:{"filename":name,"sha256":hashlib.sha256(raw).hexdigest()} for sid,(name,raw) in sorted(files.items())}})
    result=workspace.adopt_seed(state,files,seed_hash)
    result.update({"kind":kind,"source_files":len(files),"clauses":len(state["clauses"]),"cases":len(state["cases"]),
                   "reference_candidates":len(state["references"]),"procedure_profiles":len(state["procedures"])})
    return result
