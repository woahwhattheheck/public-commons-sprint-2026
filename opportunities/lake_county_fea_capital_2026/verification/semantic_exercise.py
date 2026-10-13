"""One internal semantic exercise for money, source identity and completed replay.

All records below are explicitly synthetic engineering inputs. They are not
County assets, model results, client acceptance or a professional assessment.
The verification directory is excluded from the customer runtime archive.
"""
from __future__ import annotations
import argparse
import json
import sys
import tempfile
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--application-root",required=True)
    args=parser.parse_args()
    application=Path(args.application_root).resolve()
    sys.path.insert(0,str(application))
    from domain import TABLES, stable, digest, ProgrammeError
    from workspace import Workspace, atomic, file_identity, receive_workspace
    from cli import prepared
    from operate import Programme
    assertions=[]
    def check(value,message):
        if not value: raise AssertionError(message)
        assertions.append(message)
    def row(table,**values):
        result={field:None for field in TABLES[table]["fields"]}
        result.update(values)
        return result
    with tempfile.TemporaryDirectory(prefix="fea-semantic-") as temporary:
        root=Path(temporary)
        packet=root/"Internal_Engineering_Check.json"
        atomic(packet,(stable({"purpose":"synthetic internal semantic exercise; no County records"})+"\n").encode())
        inputs={
            "assets":[row("assets",source_asset_id="internal-asset",asset_name="Synthetic engineering subject",
                          ownership_relation="unknown",record_unit="synthetic_record")],
            "actions":[
                row("actions",action_id="precise-a",source_asset_id="internal-asset",scope="Internal arithmetic",
                    planned_year="2027",capital_cost="123456789012345678901234567890.123456789",
                    operating_impact="0",currency="USD",price_basis="nominal_supplied"),
                row("actions",action_id="precise-b",source_asset_id="internal-asset",scope="Internal arithmetic",
                    planned_year="2027",capital_cost="0.000000001",operating_impact="0",
                    currency="USD",price_basis="nominal_supplied")],
            "funding":[
                row("funding",funding_id="prior-authorization",programme="Synthetic timing",
                    amount="25",currency="USD",fiscal_year="2026",status="committed",amount_role="component",
                    programme_scope="asset_capital",receipt_year="2027",receipt_status="actual_received"),
                row("funding",funding_id="unknown-authorization",programme="Synthetic timing",
                    amount="5",currency="USD",fiscal_year=None,status="committed",amount_role="component",
                    programme_scope="asset_capital",receipt_year="2028",receipt_status="actual_received")],
            "model_outputs":[
                row("model_outputs",result_id="closing-a",fiscal_year="2027",metric="closing_cash",amount="125",
                    currency="USD",price_basis="nominal_supplied",model_version="internal-v1"),
                row("model_outputs",result_id="closing-b",fiscal_year="2027",metric="closing_cash",amount="126",
                    currency="USD",price_basis="nominal_supplied",model_version="internal-v1")]
        }
        source=root/"Synthetic_Engineering_Records.json"
        atomic(source,(stable(inputs)+"\n").encode())
        selections=[{"file_key":"fixture","table":table,"format":"json",
            "mapping":{"columns":{field:field for field in TABLES[table]["fields"]},"json_pointer":"/"+table}}
            for table in inputs]
        basis={"currency":"USD","price_basis":"nominal_supplied","horizon_start":2027,
               "horizon_years":15,"schedule_overrides":[]}
        config={"schema":"lake-county.operating-selection/v1","operation_id":"INTERNAL-FEA-SEMANTIC-01",
                "actor":"internal-engineering-check","case_id":"internal-engineering-semantic-check",
                "workspace_root":str(root/"workspace"),"application_root":str(application),
                "output_root":str(root/"output"),"receiving_root":str(root/"received"),
                "workshare_source":{"path":str(packet),**file_identity(packet)},
                "files":[{"key":"fixture","path":str(source),**file_identity(source),"mime":"application/json",
                          "metadata":{"source_kind":"internal_semantic_fixture","authority":"Internal engineering check"}}],
                "editions":[{"key":"baseline","name":"Synthetic original","selections":selections},
                            {"key":"returned","name":"Same synthetic original return","predecessor_key":"baseline","selections":selections}],
                "exchanges":[{"key":"original-model","edition_key":"baseline","return_edition_key":"returned",
                    "table":"model_outputs","key_fields":["result_id"],
                    "guard_fields":["metric","fiscal_year","currency","price_basis","model_version"],
                    "editable_fields":["amount","source_note"],"model_file_keys":["fixture"],
                    "model_name":"Explicit synthetic engineering model","model_version":"internal-v1",
                    "method_note":"Internal same-source exchange; no County model or formula recalculation.",
                    "adoption":{"status":"accepted","note":"Internal engineering fixture only; verify native exchange semantics."}}],
                "scenarios":[
                    {"key":"arithmetic","edition_key":"returned","spec":{**basis,"name":"Exact arithmetic and independent dates","mode":"selected_actions"},
                     "record_keys":["precise-a","precise-b"],"funding_record_keys":["prior-authorization","unknown-authorization"]},
                    {"key":"closing-forward","edition_key":"returned","spec":{**basis,"name":"Ambiguous closing forward","mode":"received_model"},
                     "record_keys":["closing-a","closing-b"],"exchange_key":"original-model"},
                    {"key":"closing-reverse","edition_key":"returned","spec":{**basis,"name":"Ambiguous closing reverse","mode":"received_model"},
                     "record_keys":["closing-b","closing-a"],"exchange_key":"original-model"}],
                "publication":{"name":"Internal semantic exercise only","edition_key":"returned",
                               "kind":"internal_working","scenario_keys":["arithmetic","closing-forward","closing-reverse"]}}
        result=Programme(config).finish()
        w=Workspace(config["workspace_root"])
        try:
            publication=w.object("publication",result["publication"]["id"],result["publication"]["revision"])
            scenarios={item["body"]["spec"]["name"]:item for item in publication["body"]["scenarios"]}
            arithmetic=scenarios["Exact arithmetic and independent dates"]["body"]["result"]
            check(arithmetic["years"][0]["capital_need"]=="123456789012345678901234567890.123456790",
                  "Complete supported decimal precision survives native import and aggregation.")
            check(arithmetic["years"][0]["operating_impact"]=="0",
                  "Explicit supplied zero remains distinct from an absent metric.")
            check(arithmetic["years"][0]["cash_receipt"]=="25" and arithmetic["years"][0]["authorized_funding"] is None,
                  "A prior-horizon authorization does not hide its selected in-horizon actual receipt.")
            check(arithmetic["years"][1]["cash_receipt"]=="5" and not arithmetic["complete"]
                  and any(item.get("metric")=="authorized_funding" for item in arithmetic["unresolved"]),
                  "An unknown authorization date stays unresolved without erasing a valid independently dated receipt.")
            first=scenarios["Ambiguous closing forward"]["body"]["result"]
            second=scenarios["Ambiguous closing reverse"]["body"]["result"]
            check(first["years"][0]["closing_cash"] is None and second["years"][0]["closing_cash"] is None
                  and not first["complete"] and not second["complete"],
                  "Two closing-cash rows remain ambiguous in either source order.")
            check(len(first["schedule"])==len(second["schedule"])==2,
                  "All conflicting model rows remain in the complete result.")
            check(not publication["body"]["edition"]["client_records_present"] and result["client_acceptance"] is False,
                  "Synthetic exercise records cannot become a claimed client asset register or acceptance.")
            request=json.loads((root/"output"/"requests"/"publication.json").read_text())
            prior=json.loads((root/"output"/"responses"/"publication.json").read_text())
            review=prepared(w,root/"later-original-review.json",operation_id="INTERNAL-FEA-LATER-REVIEW",
                actor="internal-engineering-check",action="review.save",payload={
                    "subject_kind":"edition","subject_id":result["editions"]["returned"]["id"],
                    "subject_revision":None,"subject_sha256":result["editions"]["returned"]["sha256"],
                    "status":"follow_up","note":"Internal later edit retained after original delivery.","capacity":"internal_operator"})
            w.apply(review)
            later=w.revision()
            check(w.apply(request)==prior and w.revision()==later,
                  "Exact completed native replay precedes current revision comparison and preserves a later edit.")
            changed=json.loads(stable(request));changed["payload"]["name"]="Different input on same operation"
            try:w.apply(changed)
            except ProgrammeError as exc:check(exc.status==409,"The same native operation refuses changed input.")
            else:raise AssertionError("Changed original operation accepted.")
        finally:w.close()
        receiver=Workspace(Path(config["receiving_root"])/"workspace")
        try:
            later_request=prepared(receiver,root/"later-received-review.json",operation_id="INTERNAL-RECEIVED-LATER-REVIEW",
                actor="internal-engineering-check",action="review.save",payload={
                    "subject_kind":"edition","subject_id":result["editions"]["returned"]["id"],
                    "subject_revision":None,"subject_sha256":result["editions"]["returned"]["sha256"],
                    "status":"follow_up","note":"Retain independent receiver's later work.","capacity":"internal_operator"})
            receiver.apply(later_request)
            received_later=receiver.revision()
        finally:receiver.close()
        repeated=receive_workspace(result["export"]["path"],config["receiving_root"],
            expected_sha256=result["export"]["sha256"],expected_bytes=result["export"]["bytes"])
        receiver=Workspace(Path(config["receiving_root"])/"workspace")
        try:
            check(repeated==result["receiving"] and receiver.revision()==received_later,
                  "Complete receiving replay preserves the receiver's later native revision.")
        finally:receiver.close()
        journal_path=root/"output"/"journal.json"
        journal=json.loads(journal_path.read_text());journal["complete"]=False;journal.pop("result_sha256",None)
        atomic(journal_path,(stable(journal)+"\n").encode(),replace=True)
        check(Programme(config).finish()==result,
              "A lost completion-journal write reuses the complete original result after both workspaces have later edits.")
        check(result["independent_received_application"] and len(result["independent_readbacks"])==2,
              "The archive's received source executed in two fresh native Python processes.")
        print(stable({"schema":"lake-county.internal-semantic-exercise/v1","passed":True,
                      "assertions":assertions,"fixture_status":"synthetic_internal_only",
                      "original_export_bytes":result["export"]["bytes"],
                      "original_export_sha256":result["export"]["sha256"]}),flush=True)

if __name__=="__main__":
    main()
