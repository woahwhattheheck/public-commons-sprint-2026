#!/usr/bin/env python3
"""Reviewed grant intake over the existing case migration/portable receiving operation."""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import sys

from case_receiving import Receiving, json_file, need, SCHEMA as RECEIVING_SCHEMA, INPUT_LIMIT
from migration_store import canonical, identifier, file_hash
from migration_cases import stamp, destination_policy

SCHEMA = "commons.grant-migration-contract/v1"
FAMILIES = ("persons","organisations","programmes","rounds","forms","applications",
            "reviewers","panels","assignments","conflicts","reviews","awards","amendments",
            "milestones","reports","documents","document_links","payment_requests",
            "payment_approvals","disbursements","refunds","workflows","access","integrations")
MEANING = {
    "customer_migration":"Supplied original institution exports and independent F1 target returns; no vendor write or payment instruction.",
    "public_reference_review":"Operator-authored review of public vendor requirements; no tenant rows, vendor import or migrated-customer result."
}

def result_ref(value, lane="producer"):
    need(isinstance(value,dict) and set(value)=={"$result","pointer"} and
         isinstance(value["$result"],str) and value["$result"].startswith(lane+":") and
         value["pointer"]=="/id", "Use the exact original producer result ID reference")
    return value["$result"].split(":",1)[1]

def string(value, label):
    need(isinstance(value,str) and value.strip(), "Retain the complete "+label)
    return value

def validate_input(value):
    """Inspect original action bytes without opening a workspace or dispatching an import."""
    need(isinstance(value,dict) and value.get("schema")==RECEIVING_SCHEMA,
         "Use the existing complete case receiving input")
    contract=value.get("grant_contract")
    need(isinstance(contract,dict) and contract.get("schema")==SCHEMA,"Supply the reviewed grant contract")
    mode=contract.get("mode")
    need(mode in MEANING,"Declare actual customer migration or public reference review")
    for name in ("title","scope_note","source_owner","target_loader","acceptance_owner"):
        string(contract.get(name),name)
    family_rules=contract.get("families")
    omitted=contract.get("excluded_families")
    need(isinstance(family_rules,dict) and family_rules and isinstance(omitted,dict),
         "Declare each included family and every excluded family with a reason")
    need(set(family_rules)<=set(FAMILIES) and set(omitted)<=set(FAMILIES) and
         not set(family_rules)&set(omitted) and set(family_rules)|set(omitted)==set(FAMILIES),
         "Account explicitly for every grant family without inventing absent populations")
    for family,reason in omitted.items():string(reason,"exclusion for "+family)
    for family,rule in family_rules.items():
        need(isinstance(rule,dict) and rule.get("kind") in ("cases","documents","links"),
             "Use existing cases/documents/links for "+family)
        identifier(rule.get("identity_scope"))
        string(rule.get("meaning"),"record meaning for "+family)
        fields=rule.get("compare_fields")
        need(isinstance(fields,list) and fields and all(isinstance(x,str) and x for x in fields) and len(fields)==len(set(fields)),
             "Select the exact comparison fields for "+family)
    files={}
    for item in value.get("source_files",[]):
        key=identifier(item.get("key"));need(key not in files,"Original source keys must be unique");files[key]=item
    evidence=contract.get("interface_evidence")
    need(isinstance(evidence,list) and evidence,"Retain supplied template/return/workflow evidence or explicit missing status")
    evidence_kinds=set()
    for item in evidence:
        need(isinstance(item,dict) and item.get("kind") in
             ("source_export","target_template","target_return","document_return","roles","workflow","integration","public_source"),
             "Use an explicit interface evidence kind")
        evidence_kinds.add(item["kind"])
        need(item.get("status") in ("retained","missing","not_applicable"),"Record actual interface evidence status")
        string(item.get("description"),"interface evidence description")
        if item["status"]=="retained":
            need(item.get("source_file") in files,"Bind evidence to a complete original source_files member")
        else:string(item.get("reason"),"missing or excluded evidence reason")
    if mode=="customer_migration":
        need({"source_export","target_template","target_return","document_return","roles","workflow","integration"}<=evidence_kinds,
             "Account for the original export, template, independent return, documents, roles, workflow and integrations")
    else:
        need("public_source" in evidence_kinds,"Bind the public example to its retained source register")
    steps={}
    all_ids=set()
    for lane,field in (("producer","steps"),("customer","customer_steps")):
        for step in value.get(field,[]):
            key=(lane,identifier(step.get("key")));need(key not in steps,"Keep action keys unique")
            need(step.get("operation_id") not in all_ids,"Keep original action IDs unique")
            all_ids.add(step.get("operation_id"));steps[key]=step
    def action(key,operation):
        item=steps.get(("producer",key))
        need(item and item.get("operation")==operation,"Select the original producer "+operation+" action")
        return item["payload"]
    def import_for(dataset,side):
        imported=action(result_ref(dataset.get("source_id")),"source.import")
        context=imported.get("context",{})
        need(context.get("role")==("source_inventory" if side=="source" else "target_inventory"),
             "Independent target observations cannot be replaced by loader receipts")
        coverage=context.get("coverage")
        need(isinstance(coverage,dict) and coverage.get("mode") in ("complete","partial","failure_only","unknown") and
             isinstance(coverage.get("description"),str) and coverage["description"].strip(),
             "Retain actual population coverage for every family occurrence")
        expected="customer_export" if mode=="customer_migration" else None
        if expected:need(context.get("capture_kind")==expected,"Real receiving requires the selected institution export/return")
        else:need(context.get("capture_kind") in ("public_reference","local_reference"),
                  "Public requirements review must stay visibly separate from customer data")
        stamp(context.get("captured_at"),"actual capture time")
        return imported
    periods=contract.get("periods")
    need(isinstance(periods,list) and len(periods)==2,"Select exactly two complete reviewed editions")
    summaries=[];rehearsals=[]
    for period in periods:
        need(isinstance(period,dict),"Supply a complete period selection")
        label=string(period.get("label"),"period label")
        cutoff=stamp(period.get("cutoff_at"),"period cutoff")
        plan_key=identifier(period.get("plan_key"));rehearsal_key=identifier(period.get("rehearsal_key"))
        plan=action(plan_key,"case.plan.create");rehearsal=action(rehearsal_key,"case.rehearsal.create")
        need(stamp(plan.get("cutoff_at"),"plan cutoff")==cutoff and
             result_ref(rehearsal.get("plan_id"))==plan_key,"Bind each actual rehearsal to its exact cutoff plan")
        need("destination_policy" in plan,"Select grant destinations explicitly; do not inherit the original Dynamics defaults")
        destination_policy(plan["destination_policy"])
        selected={}
        for side,refs in (("source",plan.get("source_dataset_ids")),("target",rehearsal.get("target_dataset_ids"))):
            need(isinstance(refs,list) and refs,"Select the complete "+side+" family projection list")
            population={}
            for ref in refs:
                ds=action(result_ref(ref),"case.dataset.create")
                need(ds.get("side")==side,"The selected projection has another evidence side")
                family=ds.get("record_family");need(family in family_rules,"Declare the selected original record family")
                rule=family_rules[family]
                identity_field="case_id" if rule["kind"]=="cases" else "document_id"
                need(ds.get("kind")==rule["kind"] and ds.get("identity_scopes",{}).get(identity_field)==rule["identity_scope"],
                     "Use the declared kind and exact family identity scope")
                need(set(rule["compare_fields"])<=set(ds.get("columns",{})),
                     "Map every explicitly reviewed comparison field on source and target")
                import_for(ds,side)
                population.setdefault(family,[]).append(result_ref(ref))
            need(set(population)==set(family_rules),"Keep all included families visible in both selected populations")
            selected[side]=population
        checks=plan.get("family_checks",{})
        for family,rule in family_rules.items():
            need(checks.get(family)==rule["compare_fields"],"Freeze the exact per-family comparison selection")
        rules=plan.get("relation_rules")
        need(isinstance(rules,list),"Declare all reviewed relationships, including an explicit empty list when none")
        summaries.append({"label":label,"cutoff_at":period["cutoff_at"],"plan_key":plan_key,
                          "rehearsal_key":rehearsal_key,"families":selected,"relation_rule_count":len(rules)})
        rehearsals.append(rehearsal_key)
    need(rehearsals[0]!=rehearsals[1] and periods[0]["label"]!=periods[1]["label"],
         "Keep the two original editions separately identified")
    need(stamp(periods[1]["cutoff_at"],"second cutoff")>stamp(periods[0]["cutoff_at"],"first cutoff"),
         "The later edition must have a later explicit cutoff")
    comparison=value.get("comparison",{})
    need(result_ref(comparison.get("before_id"))==rehearsals[0] and
         result_ref(comparison.get("after_id"))==rehearsals[1],"Compare the exact two selected rehearsal editions")
    return {"schema":SCHEMA,"mode":mode,"title":contract["title"],"meaning":MEANING[mode],
            "included_families":list(family_rules),"excluded_families":omitted,
            "periods":summaries,"interface_evidence":evidence,"vendor_dispatch":False,
            "payment_instruction":False,"acceptance_inferred":False}

class GrantReceiving(Receiving):
    def __init__(self,source_input,out):
        # The exact same bytes are reread/bound by Receiving before any source/workspace action.
        raw,value=json_file(source_input,INPUT_LIMIT)
        self.grant_validation=validate_input(value)
        super().__init__(source_input,out)
        need(self.raw==raw,"The reviewed original input changed during admission")
        self.put("grant-contract-review.json",(canonical(self.grant_validation)+"\n").encode("utf-8"))

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True)
    parser.add_argument("--out",help="Existing original operation directory for run/continuation")
    parser.add_argument("--inspect",action="store_true",help="Read the complete intake contract; no workspace or provider action")
    args=parser.parse_args(argv)
    if args.inspect:
        _,value=json_file(args.input,INPUT_LIMIT)
        print(canonical(validate_input(value)));return 0
    need(args.out,"Choose the original operation output directory")
    runner=GrantReceiving.__new__(GrantReceiving);runner.owned=[];runner.lock=None
    try:
        runner.__init__(args.input,args.out);report=runner.run()
        print(canonical({"state":report["state"],"operation_id":report["operation_id"],
                         "report":str(runner.out/"COMPLETE.json"),"phases":len(report["phases"]),
                         "grant_contract":runner.grant_validation}))
        return 0
    except BaseException as error:
        try:runner.close_all()
        except BaseException as close_error:
            print(canonical({"state":"INTERRUPTED","error":str(error),"close_error":str(close_error)}),file=sys.stderr);return 2
        print(canonical({"state":"INTERRUPTED","error":type(error).__name__,"message":str(error)}),file=sys.stderr);return 2
    finally:
        if not runner.owned and runner.lock is not None:
            fcntl.flock(runner.lock,fcntl.LOCK_UN);os.close(runner.lock);runner.lock=None

if __name__=="__main__":raise SystemExit(main())
