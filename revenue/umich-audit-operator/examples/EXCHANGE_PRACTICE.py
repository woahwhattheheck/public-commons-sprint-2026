"""One complete, explicitly marked Practice interchange/receiving journey."""
import copy, hashlib, io, json, pathlib, sys, zipfile
if "__file__" in globals():
    sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from audit_operator import exchange as ex
from audit_operator.reporting import project_snapshot, project_for_access

def run():
    namespace="practice-um-audit"
    evidence=b"Practice attachment: exact retained workpaper bytes.\n"
    raw=b"source_id,unit,detail\nA,unit-a,A_PRIVATE_DETAIL\nB,unit-b,B_PRIVATE_DETAIL\n"
    rows={
      "engagement":[
        {"source_id":"eng-a","title":"Practice shared IT audit","unit_ids":["unit-a","unit-b"],"scope_text":"Two scoped units","objectives":"Assess documented control operation","balanced_conclusion":"One control works; one exception needs action.","is_it_audit":True,"is_michigan_medicine":False,"issue_date":"2026-08-31"},
        {"source_id":"eng-b","title":"Practice non-IT audit","unit_ids":["unit-b"],"scope_text":"Unit B","objectives":"Assess B","balanced_conclusion":"Separate unit scope.","is_it_audit":False,"is_michigan_medicine":False},
        {"source_id":"eng-c","title":"Practice Medicine IT audit","unit_ids":["unit-a"],"scope_text":"Unit A Medicine IT","objectives":"Assess C","balanced_conclusion":"Controls reviewed.","is_it_audit":True,"is_michigan_medicine":True}],
      "audit_area":[{"source_id":"area-a","engagement_id":"eng-a","label":"Access administration","objective":"Documented access control","source_order":1},
                    {"source_id":"area-b","engagement_id":"eng-b","label":"Separate B area","objective":"B operations","source_order":1}],
      "sub_activity":[{"source_id":"sub-a","area_id":"area-a","label":"Account review","raw_result_symbol":"O"},
                      {"source_id":"sub-ok","area_id":"area-a","label":"Working control","raw_result_symbol":"\uf0fc"},
                      {"source_id":"sub-b","area_id":"area-b","label":"B process","raw_result_symbol":"O"}],
      "observation":[
        {"source_id":"obs-h","engagement_id":"eng-a","sub_activity_id":"sub-a","title":"Practice high","owner_unit":"unit-a","priority_raw":"High","details":"A_PRIVATE_DETAIL","report_summary":"Reviewed high-priority summary.","report_inclusion":True},
        {"source_id":"obs-m","engagement_id":"eng-a","sub_activity_id":"sub-a","title":"Practice medium B","owner_unit":"unit-b","priority_raw":"Medium","details":"B_PRIVATE_DETAIL","report_summary":"Reviewed B summary.","report_inclusion":True},
        {"source_id":"obs-l","engagement_id":"eng-a","sub_activity_id":"sub-a","title":"Practice low","owner_unit":"unit-a","priority_raw":"Low","details":"A_LOW_PRIVATE","report_summary":"Unit-only low.","report_inclusion":False},
        {"source_id":"obs-u","engagement_id":"eng-b","sub_activity_id":"sub-b","title":"Unresolved classification","owner_unit":"unit-b","priority_raw":"Priority TBD","details":"B_UNRESOLVED_PRIVATE","report_summary":None}],
      "management_action":[
        {"source_id":"act-h","observation_id":"obs-h","plan_text":"A_PRIVATE_PLAN","report_summary":"Reviewed corrective action.","issue_date":"2026-08-31","explicit_target_date":"2027-04-15","reference_target_date":"2027-02-28","override_source":"Practice explicit MAP date","unit_completion_statement":"Unit says complete; auditor has not verified.","source_status":"Unit submitted"},
        {"source_id":"act-m","observation_id":"obs-m","plan_text":"B_PRIVATE_PLAN","report_summary":"Reviewed B action.","verified_at":"2026-10-11T12:00:00Z","verification_reference":"Practice auditor verification"}],
      "follow_up_review":[{"source_id":"fu-h","action_id":"act-h","review_date":"2026-10-11","implementation_evidence":"Practice unit statement","auditor_verification":None,"next_review_date":"2027-02-28","committee_review_flag":False}],
      "evidence":[{"record_source_id":"ev-a","source_id":"practice-evidence","engagement_id":"eng-a","observation_id":"obs-h","filename":"practice-workpaper.txt","media_type":"text/plain","sha256":ex.sha256(evidence),"size":len(evidence),"classification":"unknown","owner_unit":"unit-a"}],
      "risk":[{"source_id":"risk-unassigned","title":"Practice planning risk","owner_unit":"unit-a","description":"Risk exists before an engagement","classification":"auditor_only"}],
      "workpaper":[{"source_id":"wp-a","engagement_id":"eng-a","sub_activity_id":"sub-a","title":"Practice workpaper","procedure":"Inspect retained control evidence","results":"A_WORKPAPER_PRIVATE","classification":"auditor_only","evidence_ids":["ev-a"]}],
      "advisory_memo":[{"source_id":"memo-b","engagement_id":"eng-a","title":"Practice referral","purpose":"Explicit referral to unit B","body":"Reviewed advice for B.","recipient_unit_ids":["unit-b"],"record_ids":[]}],
      "questionnaire_response":[{"source_id":"q-3.3.5","question_id":"3.3.5","catalog_sha":"819a01647a939e867e344abc94e24db04df290687463cb43771944ec13099bac","response":"Practice response, not an institutional submission.","status":"draft","evidence_refs":[]}],
      "source_mapping":[{"source_id":"mapping-1","source_field_or_ordinal":"Priority","target_field":"priority_normalized","transform":"value_map","value_map":{"High":"high","Medium":"medium","Low":"low"},"native_contract_reference":"Practice explicitly reviewed mapping","revision":1,"record_kind":"observation"}],
    }
    normalized=ex.normalize_records(rows,{},namespace)
    assert normalized["valid"],normalized["diagnostics"]
    assert any(d["code"]=="priority_unresolved" for d in normalized["diagnostics"])
    records=normalized["records"]
    index={r["id"]:r for r in records}
    sid=lambda kind,raw_id:ex.stable_record_id(kind,namespace,raw_id)
    sub=index[sid("sub_activity","sub-ok")]
    assert sub["payload"]["normalized_result"]=="no_observation" and "priority_normalized" not in sub["payload"]
    assert index[sid("evidence","ev-a")]["payload"]["source_id"]=="practice-evidence"
    assert index[sid("questionnaire_response","q-3.3.5")]["payload"]["catalog_sha256"]=="819a01647a939e867e344abc94e24db04df290687463cb43771944ec13099bac"
    source={"id":"practice-input","name":"practice-original.csv","sha256":ex.sha256(raw),"bytes":len(raw),"media_type":"text/csv","role":"original_input"}
    snapshot={"format":"commons-audit-snapshot/1","workspace_id":"practice-source-workspace","captured_at":"2026-10-11T00:00:00Z","records":records,"sources":[source,{"id":"practice-evidence","name":"practice-workpaper.txt","sha256":ex.sha256(evidence),"bytes":len(evidence),"media_type":"text/plain","role":"evidence"}],"revisions":[]}
    blobs={ex.sha256(raw):raw,ex.sha256(evidence):evidence}
    selection=[r["id"] for r in records if r["kind"]=="engagement"]
    roles=[
      {"role":"auditor","unit_ids":[]},
      {"role":"unit_leadership","unit_ids":["unit-a"]},
      {"role":"executive","unit_ids":[]},
      {"role":"it_leadership","unit_ids":["unit-a"]},
      {"role":"medicine_it_leadership","unit_ids":["unit-a"]},
      {"role":"board_regents","unit_ids":[]},
      {"role":"faic","unit_ids":[]},
      {"role":"advisory","unit_ids":["unit-b"],"recipient_unit_ids":["unit-b"],"selected_record_ids":[sid("advisory_memo","memo-b")]}]
    outcomes={}
    full=None
    for audience in roles:
        data,manifest=ex.build_handoff(snapshot,lambda digest:blobs[digest],audience=audience,selected_engagement_ids=selection,review_reference="Practice reviewed selection 1")
        returned=ex.read_handoff(data)
        role=returned["manifest"]["projection"]["audience"]["role"]
        assert len(returned["snapshot"]["records"])==sum(manifest["record_counts"].values())
        if role=="auditor":
            full=(data,returned)
            assert returned["blobs"]==blobs
            assert any(r["kind"]=="questionnaire_response" for r in returned["snapshot"]["records"])
        else:
            all_text=b"\n".join(returned["files"].values())
            assert not returned["blobs"] and not returned["snapshot"]["sources"]
            assert b"B_PRIVATE_DETAIL" not in all_text
            assert b"A_WORKPAPER_PRIVATE" not in all_text
            if role!="unit_leadership":
                assert b"A_PRIVATE_DETAIL" not in all_text and b"A_PRIVATE_PLAN" not in all_text
            if role in {"it_leadership","medicine_it"}:
                assert all(r["id"]!=sid("observation","obs-m") for r in returned["snapshot"]["records"])
            if role=="medicine_it":
                assert {r["id"] for r in returned["snapshot"]["records"] if r["kind"]=="engagement"}=={sid("engagement","eng-c")}
        if role=="management_advisory":
            assert {r["kind"] for r in returned["snapshot"]["records"]}=={"engagement","advisory_memo"}
            assert len(returned["snapshot"]["records"])==2
        outcomes[role]={"records":len(returned["snapshot"]["records"]),"zip_bytes":len(data),"omitted":len(manifest["projection"]["omitted_records"])}
    assert any(r["id"]==sid("risk","risk-unassigned") for r in project_for_access(snapshot,audience={"role":"auditor","unit_ids":[]})["records"])
    current={"format":"commons-audit-snapshot/1","workspace_id":"practice-receiving-workspace","captured_at":"2026-10-11T00:00:00Z","records":[],"sources":[],"revisions":[]}
    data,received=full
    plan=ex.plan_receipt(current,received)
    assert plan["status"]=="ready" and plan["imported"]==[]
    prepared=ex.prepare_adoption(current,received,plan)
    assert prepared["receipt"]["status"]=="prepared" and current["records"]==[]
    committed=copy.deepcopy(prepared["receipt"])
    committed["status"]="accepted"
    committed["imported"]=committed["prepared_record_ids"]
    replay=ex.plan_receipt(prepared["snapshot"],received,prior_receipts=[committed])
    assert replay["status"]=="replayed" and not replay["planned_imports"]
    conflicted=copy.deepcopy(prepared["snapshot"])
    next(r for r in conflicted["records"] if r["id"]==sid("observation","obs-h"))["payload"]["details"]="A separately changed local head."
    conflict=ex.plan_receipt(conflicted,received)
    assert conflict["status"]=="conflicted" and any(x.get("reason")=="same_revision_different_content" for x in conflict["conflicted"])
    conflicting=conflict["conflicted"][0]
    choice={"id":conflicting["id"],"kind":conflicting["kind"],"decision":"accept_incoming_as_next",
            "current_sha256":conflicting["current_sha256"],"incoming_sha256":conflicting["incoming_sha256"],
            "bundle_sha256":received["bundle_sha256"],"reason":"Practice reviewed competing source revision",
            "reviewer_reference":"practice-auditor","reviewed_at":"2026-10-11T12:00:00Z"}
    host_choice={"id":choice["id"],"choice":"accept_incoming_as_next","current_sha256":choice["current_sha256"],"incoming_sha256":choice["incoming_sha256"],"reason":choice["reason"]}
    resolved=ex.resolve_receipt(conflicted,received,conflict,[host_choice],reviewer_reference="practice-auditor",reviewed_at="2026-10-11T12:00:00Z")
    assert resolved["status"]=="ready",resolved
    corrected=ex.prepare_adoption(conflicted,received,resolved)
    adopted=next(r for r in corrected["snapshot"]["records"] if r["id"]==choice["id"])
    assert adopted["revision"]==2 and adopted["payload"]["details"]=="A_PRIVATE_DETAIL"
    assert any(r["id"]==choice["id"] and r["revision"]==1 and r["payload"]["details"]=="A separately changed local head." for r in corrected["snapshot"]["revisions"])
    stale=copy.deepcopy(choice);stale["current_sha256"]="0"*64
    try:
        ex.resolve_receipt(conflicted,received,[stale]);raise AssertionError("Stale resolution accepted")
    except ex.ExchangeError as exc:
        assert exc.code=="resolution_stale"
    original_files=received["files"]
    tampered=dict(original_files)
    blob_name=next(name for name in tampered if name.startswith("blobs/"))
    tampered[blob_name]+=b"changed"
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as archive:
        for name,body in tampered.items():archive.writestr(name,body)
    try:
        ex.read_handoff(output.getvalue())
        raise AssertionError("Tampered body accepted")
    except ex.ExchangeError as exc:
        assert exc.code=="member_identity_mismatch",exc.as_dict()
    projected=project_snapshot(snapshot,audience={"role":"auditor","unit_ids":[]},selected_engagement_ids=selection,review_reference="Practice native contract review")
    contract={"format":"commons-audit-target-contract/1","native_contract_reference":{"classification":"authored_practice_contract_not_vendor_schema","id":"practice-ordered-columns/1"},"tables":[
      {"kind":"engagement","file":"engagements.csv","encoding":"utf-8-sig","header":True,"delimiter":",","line_ending":"CRLF","fields":[
        {"name":"ID","target_field":"source_id"},
        {"name":"Title","target_field":"title"},
        {"name":"Units","target_field":"unit_ids","transform":"json"},
        {"name":"IT","target_field":"is_it_audit","transform":"boolean"},
        {"name":"Medicine IT","target_field":"is_michigan_medicine","transform":"boolean"}]},
      {"kind":"observation","file":"observations.csv","encoding":"utf-8-sig","header":True,"delimiter":",","line_ending":"CRLF","fields":[
        {"name":"ID","target_field":"source_id"},
        {"name":"Engagement","target_field":"engagement_id","relationship_key":{"kind":"engagement"}},
        {"name":"Priority","target_field":"priority_raw","null_rule":"empty_to_null"},
        {"name":"Priority","target_field":"priority_normalized","null_rule":"empty_to_null"},
        {"name":"","target_field":"report_summary","null_rule":"empty_to_null"},
        {"name":"Unit","target_field":"owner_unit"}]}]}
    native=ex.export_native(projected,contract)
    native_return=ex.normalize_native_files(native["files"],contract,namespace)
    assert native_return["valid"],native_return["diagnostics"]
    comparison=ex.reconcile_native(projected,native_return,contract)
    assert comparison["status"]=="match",comparison
    changed_files=dict(native["files"])
    changed_files["observations.csv"]=changed_files["observations.csv"].replace(b"Reviewed high-priority summary.",b"Returned changed summary.")
    correction=ex.reconcile_native(projected,ex.normalize_native_files(changed_files,contract,namespace),contract)
    assert correction["status"]=="different" and len(correction["changed"])==1
    result={"case":"explicit Practice records, public U-M field distinctions","status":"COMPLETE",
            "normalized_records":len(records),"audiences":outcomes,
            "receiving":{"prepared":len(plan["planned_imports"]),"original_blobs_equal":prepared["blobs"]==blobs,"same_bundle_replay":replay["status"],"conflict_count":len(conflict["conflicted"]),"tamper_rejected":True,"resolved_as_next_revision":adopted["revision"],"stale_resolution_rejected":True},
            "native":{"matched":comparison["matched"],"changed":len(correction["changed"]),"duplicate_and_blank_headers_preserved":True},
            "source_sha256":ex.sha256(raw),"evidence_sha256":ex.sha256(evidence)}
    print(json.dumps(result,sort_keys=True))
    return result

if __name__=="__main__":
    run()
