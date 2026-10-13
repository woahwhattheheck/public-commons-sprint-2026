#!/usr/bin/env python3
"""Run one labelled native amendment case through complete receiving.

This operator uses the original Workspace and Operations APIs. All work, invoice
and cash rows are labelled WALKTHROUGH inputs; the public source plan is retained
unchanged. A saved request is replayed verbatim after interruption.
"""
from __future__ import annotations
import argparse, base64, csv, hashlib, io, json, os, sys, zipfile
from copy import deepcopy
from pathlib import Path

OPERATION = "SCF-GRANT-PLAN-AMENDMENT-018A-20261012-01"
ACTOR = "Internal engineering walkthrough"
DAY = "2026-10-12"
PREFIX = "amendment-receiving-018a-"
SOURCE_SHA = "79090013305fd4173413e7b2aad3b63c0ec696d1e8323c526eaea2c18d402ece"


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(path.name + ".incoming")
    with open(staging, "wb") as handle:
        handle.write(raw); handle.flush(); os.fsync(handle.fileno())
    os.replace(staging, path)


def main(root):
    root = Path(root).resolve()
    app = Path(__file__).resolve().parent
    sys.path.insert(0, str(app))
    from model import Workspace, Problem, canonical, digest
    from operations import Operations
    import operations_amendments as amendments

    output = root / "output"
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = output / "amendment-receiving-checkpoint.json"
    journal = json.loads(checkpoint.read_bytes()) if checkpoint.exists() else {
        "schema": "stellar-forge.sf47-amendment-receiving.v1",
        "operationId": OPERATION, "issued": {}, "phases": {}, "artifacts": {}
    }
    if journal["operationId"] != OPERATION:
        raise RuntimeError("Keep the original receiving operation.")
    def persist():
        atomic(checkpoint, (canonical(journal) + "\n").encode())
    def retained(name, raw):
        path = output / name
        identity = {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if path.exists() and path.read_bytes() != raw:
            raise RuntimeError("The retained original output differs: " + name)
        if not path.exists(): atomic(path, raw)
        journal["artifacts"][name] = identity
        persist()
        return identity
    def retain_json(name, value):
        return retained(name, (canonical(value) + "\n").encode())
    def phase(name, callback):
        if name in journal["phases"]:
            return journal["phases"][name]
        journal["activePhase"] = name
        persist()
        value = callback()
        journal["phases"][name] = value
        journal.pop("error", None)
        persist()
        print(json.dumps({"phase": name, "status": "COMPLETE"}), flush=True)
        return value

    source = app.parent / "sf10_current_candidate.json"
    source_raw = source.read_bytes()
    if hashlib.sha256(source_raw).hexdigest() != SOURCE_SHA:
        raise RuntimeError("The selected complete public source changed.")
    handles = {}
    def opened(label):
        if label not in handles:
            workspace = Workspace(root / ("data-" + label), source)
            handles[label] = (workspace, Operations(workspace))
        return handles[label]
    def close(label):
        if label in handles:
            handles.pop(label)[0].close()
    def original():
        return opened("original")
    def current(ops=None, pid=None):
        ops = ops or original()[1]
        pid = pid or journal["caseId"]
        return ops.read(pid)
    def execute(key, action, data, note, ops=None, pid=None):
        ops = ops or original()[1]
        pid = pid or journal["caseId"]
        issued = journal["issued"].get(key)
        if issued is None:
            body = {"expectedVersion": current(ops, pid)["program"]["version"],
                    "requestId": PREFIX + key, "actor": ACTOR, "note": note,
                    "action": action, "data": deepcopy(data)}
            issued = {"caseId": pid, "request": body}
            journal["issued"][key] = issued
            persist()
        if issued["caseId"] != pid or issued["request"]["action"] != action:
            raise RuntimeError("The phase changed its original action identity.")
        if "result" in issued:
            return issued["result"]
        try:
            result = ops.command(pid, issued["request"])
        except Problem as error:
            issued["lastError"] = {"code": error.code, "status": error.status, "message": str(error)}
            persist()
            raise
        issued["result"] = result
        issued.pop("lastError", None)
        persist()
        return result

    def seed():
        workspace, ops = original()
        plan = workspace.read(workspace.list()[0]["id"], 1)
        body = {"planId": plan["id"], "selectedRevision": plan["revision"],
                "expectedContentSha256": plan["contentSha256"],
                "name": "Native amendment receiving — labelled internal walkthrough",
                "mode": "WALKTHROUGH", "calendarStart": DAY,
                "actor": ACTOR, "requestId": PREFIX + "create"}
        receipt = ops.create(body)
        journal["caseId"], journal["planId"] = receipt["id"], plan["id"]
        journal["source"] = {"sha256": SOURCE_SHA, "bytes": len(source_raw), "filename": source.name}
        journal["baselinePlan"] = {"revision": plan["revision"], "sha256": plan["contentSha256"]}
        persist()
        return {"case": receipt, "source": journal["source"]}
    def intake_work():
        workspace, ops = original()
        contributor = execute("contributor", "contributor.save", {
            "name": "Internal walkthrough source author", "kind": "ROLE",
            "note": "Labelled operating exercise; these entries are not customer invoices or payments."
        }, "Open the original native role for this WALKTHROUGH only.")["recordId"]
        plan = workspace.read(journal["planId"], journal["baselinePlan"]["revision"])
        costs = plan["scenario"]["future_costs"]
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow(["externalId","contributor","costId","description","startDate","endDate","hours","fundingBasis"])
        writer.writerow(["walkthrough-work-1", contributor, costs[0]["id"], "Labelled amendment exercise: package implementation", DAY, DAY, "100", "INTERNAL"])
        writer.writerow(["walkthrough-work-2", contributor, costs[1]["id"], "Labelled amendment exercise: handover", DAY, DAY, "5", "INTERNAL"])
        raw = stream.getvalue().encode()
        retained("Walkthrough_Work_Source.csv", raw)
        upload = execute("work-source", "work-intake.upload", {
            "name": "Original labelled walkthrough work source", "kind": "WORK",
            "file": {"filename": "Walkthrough_Work_Source.csv", "mediaType": "text/csv",
                     "contentBase64": base64.b64encode(raw).decode()},
            "format": {}
        }, "Retain this complete internal exercise CSV through native work intake.")
        chosen = ops.work_intake(journal["caseId"], upload["recordId"])["intake"]
        if chosen["state"] == "APPLIED":
            accepted = journal["issued"]["work-source-apply"]["result"]
            journal["contributorId"] = contributor
            journal["costIds"] = [row["id"] for row in costs]
            persist()
            return {"intakeId": chosen["id"], "recordIds": accepted["createdRecordIds"], "rows": 2}
        view = ops.preview_work_intake(journal["caseId"], {
            "expectedVersion": current()["program"]["version"],
            "intakeId": chosen["id"], "revision": chosen["revision"], "document": chosen["document"]
        })
        if not view["summary"]["ready"]:
            raise RuntimeError("Native source mapping requires a decision: " + canonical(view))
        accepted = execute("work-source-apply", "work-intake.apply", {
            "intakeId": chosen["id"], "expectedRevision": chosen["revision"],
            "document": view["document"], "expectedPreviewSha256": view["previewSha256"]
        }, "Apply the two reviewed, labelled native work records once.")
        journal["contributorId"] = contributor
        journal["costIds"] = [row["id"] for row in costs]
        persist()
        return {"intakeId": chosen["id"], "recordIds": accepted["createdRecordIds"], "rows": 2}
    def invoice_and_cash():
        _, ops = original()
        records = current()["records"]
        work = next(row for row in records["work"] if row["costId"] == journal["costIds"][0])
        original_note = {"schema": "internal.walkthrough-ledger.v1", "purpose": "Native amendment receiving exercise",
                         "invoiceUsd": "10000.00", "cashOutUsd": "9500.00",
                         "notice": "Labelled simulated entries in a WALKTHROUGH case."}
        raw = (canonical(original_note) + "\n").encode()
        source_id = execute("ledger-source", "source.add", {
            "filename": "Walkthrough_Ledger_Source.json", "mediaType": "application/json", "kind": "other",
            "contentBase64": base64.b64encode(raw).decode()
        }, "Retain the original labelled exercise ledger input.")["recordId"]
        invoice = execute("invoice", "invoice.save", {
            "contributorId": journal["contributorId"], "number": "WALKTHROUGH-018A-001",
            "issuedDate": DAY, "dueDate": "2026-10-27",
            "lines": [{"id":"original-line-1", "costId": journal["costIds"][0],
                      "description": "Labelled operating exercise", "amountUsd": "10000.00", "workIds": [work["id"]]}],
            "sourceIds": [source_id], "sourceNote": original_note["notice"]
        }, "Retain the exercise invoice against its original work/package identities.")["recordId"]
        cash = execute("cash", "cash.record", {
            "direction": "OUT", "category": "INVOICE", "date": DAY, "currency": "USD",
            "amount": "9500.00", "externalRef": "WALKTHROUGH-018A-CASH-001",
            "allocations": [{"invoiceId": invoice, "amountUsd": "9500.00"}],
            "sourceIds": [source_id], "sourceNote": original_note["notice"]
        }, "Record the labelled exercise allocation without changing its invoice identity.")["recordId"]
        journal["ledgerSourceId"], journal["invoiceId"], journal["cashId"] = source_id, invoice, cash
        persist()
        return {"invoiceId": invoice, "cashId": cash, "sourceId": source_id}
    def old_forecast():
        _, ops = original()
        inputs = {"name": "Original pre-amendment walkthrough forecast", "asOfDate": DAY, "calendarStart": DAY,
                  "note": "Complete historical source snapshot retained before amendment."}
        preview = ops.preview_forecast(journal["caseId"], {"expectedVersion":current()["program"]["version"], "inputs":inputs})
        receipt = execute("old-forecast", "forecast.save", {"inputs":inputs,"expectedPreviewSha256":preview["previewSha256"]},
                          "Keep the original saved forecast and its full source snapshot.")
        original_forecast = ops.forecast(journal["caseId"], receipt["recordId"])
        retain_json("Original_Pre_Amendment_Forecast.json", original_forecast)
        return {"id":receipt["recordId"], "sha256":digest(original_forecast)}
    def save_selected_plan():
        workspace, ops = original()
        old = workspace.read(journal["planId"], journal["baselinePlan"]["revision"])
        fields = ("id","tranche","start_day","end_day","estimated_hours","assumed_hourly_rate_usd",
                  "amount_usd","category","remaining_work","measurable_proof")
        costs = [{key:deepcopy(row[key]) for key in fields if key in row} for row in old["scenario"]["future_costs"]]
        costs[0].update(estimated_hours=70, amount_usd=6650,
                        remaining_work=costs[0]["remaining_work"] + " Internal amendment walkthrough refinement.")
        costs[1].update(estimated_hours=50, amount_usd=4750)
        selected = workspace.save(journal["planId"], old["revision"],
            {"future_costs": costs}, old["planning"],
            "Labelled partial allocation change; exact package IDs and total original proposal remain.", PREFIX+"selected-plan")
        journal["selectedPlan"]={"revision":selected["revision"],"contentSha256":selected["contentSha256"]}
        persist()
        later = workspace.save(journal["planId"], selected["revision"],
            {"scenario_name": selected["scenario"]["scenario_name"] + " — later saved walkthrough label"},
            selected["planning"], "Retain a later native planner revision while selecting the earlier complete amendment.",
            PREFIX+"later-plan")
        journal["laterPlan"]={"revision":later["revision"],"contentSha256":later["contentSha256"]}
        persist()
        old_file = output / "Original_Pre_Amendment_Case.zip"
        original_archive = old_file.read_bytes() if old_file.exists() else ops.export(journal["caseId"])
        retained("Original_Pre_Amendment_Case.zip", original_archive)
        return {"selected":journal["selectedPlan"], "laterSaved":journal["laterPlan"]}
    def inputs():
        return {"selectedRevision":journal["selectedPlan"]["revision"],
                "expectedContentSha256":journal["selectedPlan"]["contentSha256"], "asOfDate":DAY,
                "reason":"Reallocate the two original first-tranche package estimates while retaining all recorded identities.",
                "basis":{"kind":"WALKTHROUGH","reference":OPERATION,"date":DAY,
                         "sourceIds":[journal["ledgerSourceId"]],"note":"Internal operating exercise; the original source plan remains retained."}}
    def proposal(key, ident=None, revision=0):
        _, ops = original()
        view = ops.preview_amendment(journal["caseId"], {"expectedVersion":current()["program"]["version"], "inputs":inputs()})
        if not view["compatibility"]["compatible"]:
            raise RuntimeError("The selected compatible amendment has conflicts: "+canonical(view["compatibility"]))
        retained_key = key + "-preview.json"
        # Retain the immutable native preview independently of derived read views.
        retain_json(retained_key, {key:value for key,value in view.items() if key != "calendarImpact"})
        receipt = execute(key,"amendment.save",{
            "amendmentId":ident,"expectedRevision":revision,"inputs":inputs(),
            "expectedPreviewSha256":view["previewSha256"]
        },"Save the full selected revision and original comparison.")
        return ops.amendment(journal["caseId"],receipt["recordId"],receipt["amendmentRevision"])["amendment"]
    def review(key, row):
        receipt=execute(key,"amendment.review",{
            "amendmentId":row["id"],"expectedRevision":row["revision"],"expectedAmendmentSha256":row["sha256"],
            "expectedPreviewSha256":row["preview"]["previewSha256"],"decision":"APPROVE",
            "statement":"Internal walkthrough review: package IDs, work, invoice allocation, payment clocks and original source remain; selected estimate overruns are visible.",
            "sourceIds":[journal["ledgerSourceId"]]
        },"Record the actual walkthrough operator's decision on this exact comparison.")
        return original()[1].amendment(journal["caseId"],receipt["recordId"],receipt["amendmentRevision"])["amendment"]
    def stale_proposal():
        _,ops=original()
        if "amendmentId" not in journal:
            row=proposal("proposal")
            journal["amendmentId"]=row["id"];persist()
        else:row=ops.amendment(journal["caseId"],journal["amendmentId"])["amendment"]
        if row["state"]=="PROPOSED":row=review("first-review",row)
        contributor=next(r for r in current()["records"]["contributors"] if r["id"]==journal["contributorId"])
        execute("later-contributor-note","contributor.save",{
            **{key:deepcopy(contributor[key]) for key in ("id","name","kind","contact","note","sourceIds","sourceNote")},
            "note":"Later retained case note entered after the first amendment review."
        },"Preserve the ordinary later case edit before any amendment application.")
        data={"amendmentId":row["id"],"expectedRevision":row["revision"],
              "expectedAmendmentSha256":row["sha256"],"acknowledgeBaselineChange":True}
        try: execute("stale-apply","amendment.apply",data,"Attempt the earlier exact review against the later case.")
        except Problem as error:
            if error.code!="AMENDMENT_SOURCE_CONFLICT":raise
            return {"code":error.code,"originalAmendmentId":row["id"],"laterEditRetained":True}
        raise RuntimeError("A stale reviewed amendment changed the baseline.")
    def apply_selected():
        _,ops=original()
        existing=ops.amendment(journal["caseId"],journal["amendmentId"])["amendment"]
        if "amendment-resave" not in journal["issued"]:
            row=proposal("amendment-resave",existing["id"],existing["revision"])
        else:
            receipt=journal["issued"]["amendment-resave"].get("result")
            if receipt is None:row=proposal("amendment-resave",existing["id"],existing["revision"])
            else:row=ops.amendment(journal["caseId"],receipt["recordId"],receipt["amendmentRevision"])["amendment"]
        row=review("final-review",row)
        before_file=output/"Reviewed_Pre_Apply_Case.json"
        before=json.loads(before_file.read_bytes()) if before_file.exists() else current()
        retain_json("Reviewed_Pre_Apply_Case.json",before)
        receipt=execute("apply","amendment.apply",{
            "amendmentId":row["id"],"expectedRevision":row["revision"],"expectedAmendmentSha256":row["sha256"],
            "acknowledgeBaselineChange":True
        },"Apply the exact reviewed earlier native revision to this same case.")
        accepted=current()
        if accepted["records"]!=before["records"] or accepted["sources"]!=before["sources"]:
            raise RuntimeError("Baseline application changed the retained original work or cash.")
        if accepted["program"]["planRevision"]!=journal["selectedPlan"]["revision"]:
            raise RuntimeError("Application selected the later planner head.")
        close("original")
        _,ops=original()
        replay=ops.command(journal["caseId"],journal["issued"]["apply"]["request"])
        if replay!=receipt or current()["program"]["version"]!=accepted["program"]["version"]:
            raise RuntimeError("Original application replay created another native event.")
        chosen=ops.amendment(journal["caseId"],row["id"])["amendment"]
        package=next(p for p in chosen["preview"]["exposure"]["selected"] if p["costId"]==journal["costIds"][0])
        if package["recordedInvoicesOverPlanUsd"]!="3350.00" or package["recordedPaymentsOverPlanUsd"]!="2850.00":
            raise RuntimeError("The retained invoice/payment exposure differs from the selected estimate.")
        if float(package["recordedHoursOverPlan"])!=30:
            raise RuntimeError("The selected package did not retain its recorded hour overrun.")
        return {"receipt":receipt,"exactReplay":replay,"exposure":package,
                "selectedRevision":accepted["program"]["planRevision"],"laterSavedRevision":journal["laterPlan"]["revision"]}
    def full_case():
        _,ops=original()
        r=execute("complete-review","review",{},"Complete internal receiving review of the amended case and unchanged source records.")
        full_file=output/"Amended_Complete_Case.zip"
        full=full_file.read_bytes() if full_file.exists() else ops.export(journal["caseId"])
        retained("Amended_Complete_Case.zip",full)
        document,files=ops._unpack(full)
        if len(document["amendments"])!=5 or "amendment-history.json" not in files or "amendment-changes.csv" not in files:
            raise RuntimeError("The complete native handover omitted amendment history.")
        retain_json("Amended_Complete_Case.json",document)
        return {"review":r,"editions":len(document["amendments"]),"members":sorted(files),
                "caseVersion":document["program"]["version"]}
    def receive_and_continue():
        workspace,ops=opened("receiver")
        full=(output/"Amended_Complete_Case.zip").read_bytes()
        receipt=ops.import_bundle(full,"Received native amendment walkthrough",PREFIX+"receive",ACTOR)
        journal["receiverId"]=receipt["id"];persist()
        initial_file=output/"First_Received_Case.json"
        imported=json.loads(initial_file.read_bytes()) if initial_file.exists() else ops.read(receipt["id"])
        retain_json("First_Received_Case.json",imported)
        original_doc=json.loads((output/"Amended_Complete_Case.json").read_bytes())
        if imported["records"]!=original_doc["records"] or imported["plan"]["contentSha256"]!=original_doc["plan"]["contentSha256"]:
            raise RuntimeError("Cold receiving changed native records or selected plan.")
        if imported["program"]["origin"]["programId"]!=journal["caseId"]:
            raise RuntimeError("Cold receiving lost its original case provenance.")
        received_history=amendments.load(ops,receipt["id"])
        if received_history!=original_doc["amendments"]:
            raise RuntimeError("Cold receiving changed the original amendment editions.")
        for source in imported["sources"]:
            metadata,raw=ops.source(receipt["id"],source["id"])
            if hashlib.sha256(raw).hexdigest()!=source["sha256"]:
                raise RuntimeError("Cold receiving lost an original source.")
        contributor=next(r for r in imported["records"]["contributors"] if r["id"]==journal["contributorId"])
        later=execute("received-later-note","contributor.save",{
            **{key:deepcopy(contributor[key]) for key in ("id","name","kind","contact","note","sourceIds","sourceNote")},
            "note":"Later receiving-office note must survive replay of the original complete import."
        },"Retain the receiving operator's later working change.",ops,receipt["id"])
        replay=ops.import_bundle(full,"Received native amendment walkthrough",PREFIX+"receive",ACTOR)
        if replay!=receipt or ops.read(receipt["id"])["program"]["version"]!=later["version"]:
            raise RuntimeError("Replaying a complete import replaced the later receiving work.")
        received_file=output/"Received_Complete_Case.zip"
        received_export=received_file.read_bytes() if received_file.exists() else ops.export(receipt["id"])
        retained("Received_Complete_Case.zip",received_export)
        close("receiver")
        _,ops=opened("receiver")
        reopened=ops.read(receipt["id"])
        if reopened["program"]["version"]!=later["version"]:
            raise RuntimeError("Reopen changed the original receiver version.")
        return {"receipt":receipt,"replayed":replay,"laterVersion":later["version"],
                "originalCaseId":journal["caseId"],"amendmentEditions":len(received_history)}
    def second_cold_receiving():
        _,ops=opened("second-receiver")
        raw=(output/"Received_Complete_Case.zip").read_bytes()
        receipt=ops.import_bundle(raw,"Second native receiving of original amendment history",PREFIX+"second-receive",ACTOR)
        state=ops.read(receipt["id"])
        if state["program"]["origin"]["programId"]!=journal["receiverId"] or len(amendments.load(ops,receipt["id"]))!=5:
            raise RuntimeError("The complete received case cannot continue through another native handover.")
        retain_json("Second_Received_Case.json",state)
        return {"receipt":receipt,"sourceCaseId":journal["receiverId"],"selectedRevision":state["program"]["planRevision"]}

    try:
        if journal.get("status")=="PASS":
            for value in journal["artifacts"].values():
                raw=Path(value["path"]).read_bytes()
                if len(raw)!=value["bytes"] or hashlib.sha256(raw).hexdigest()!=value["sha256"]:
                    raise RuntimeError("A retained completed artifact changed.")
            print(json.dumps({"status":"PASS","reused":True,"result":str(output/"amendment-receiving-result.json")}),flush=True)
            return journal
        phase("original_public_plan_and_case",seed)
        phase("original_work_file_native_intake",intake_work)
        phase("source_bound_invoice_and_cash",invoice_and_cash)
        phase("historical_forecast_snapshot",old_forecast)
        phase("selected_complete_native_revision",save_selected_plan)
        phase("later_case_change_requires_new_review",stale_proposal)
        phase("reviewed_apply_and_exact_replay",apply_selected)
        phase("complete_original_case_export",full_case)
        phase("cold_receive_replay_and_reopen",receive_and_continue)
        phase("received_case_complete_handover",second_cold_receiving)
        journal.pop("activePhase",None)
        result={"schema":"stellar-forge.sf47-amendment-receiving-result.v1","status":"PASS",
                "operationId":OPERATION,"source":journal["source"],"caseId":journal["caseId"],
                "receiverId":journal["receiverId"],"checks":journal["phases"],"artifacts":journal["artifacts"],
                "scope":"Labelled internal WALKTHROUGH using original public source, native intake, amendment, replay and complete receiving."}
        atomic(output/"amendment-receiving-result.json",(canonical(result)+"\n").encode())
        journal["status"]="PASS";persist()
        print(json.dumps({"status":"PASS","result":str(output/"amendment-receiving-result.json"),"phases":len(journal["phases"])}),flush=True)
        return result
    except BaseException as error:
        journal["error"]={"type":type(error).__name__,"message":str(error)}
        persist()
        raise
    finally:
        for workspace,_ in handles.values():workspace.close()


def continue_packages(root, route):
    """Continue the completed native case with referenced package reassignment."""
    import sqlite3
    root = Path(root).resolve()
    app = Path(__file__).resolve().parent
    sys.path.insert(0, str(app))
    from model import Workspace, Problem, canonical, digest
    from operations import Operations
    import operations_amendments as amendments
    import operations_completion as completion

    output = root / "output"
    checkpoint = output / "amendment-receiving-checkpoint.json"
    if not checkpoint.is_file():
        raise RuntimeError("Open the retained receiving root containing its original checkpoint.")
    journal = json.loads(checkpoint.read_bytes())
    if journal.get("operationId") != OPERATION or journal.get("status") != "PASS":
        raise RuntimeError("Continue the completed original receiving operation and checkpoint.")
    cases = {"original": journal.get("caseId"), "receiver": journal.get("receiverId"),
             "second-receiver": journal.get("phases", {}).get(
                 "received_case_complete_handover", {}).get("receipt", {}).get("id")}
    if route not in cases or not cases[route]:
        raise RuntimeError("Select a retained original, receiver, or second-receiver case.")
    case_id = cases[route]
    database = root / ("data-" + route) / "planning.sqlite3"
    if not database.is_file():
        raise RuntimeError("The selected retained database is missing: " + str(database))
    # Confirm the original row before Workspace can create or seed any database.
    probe = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    try:
        source_row = probe.execute(
            "SELECT p.source_bytes,p.source_sha,o.plan_id FROM ops_programs o "
            "JOIN plans p ON p.id=o.plan_id WHERE o.id=?", (case_id,)).fetchone()
    finally:
        probe.close()
    expected_source = journal.get("source", {}).get("sha256")
    if (not source_row or not isinstance(source_row[0], bytes)
            or source_row[1] != expected_source
            or hashlib.sha256(source_row[0]).hexdigest() != expected_source):
        raise RuntimeError("The original retained case and complete source bytes must match the checkpoint.")

    def verify_artifacts(artifacts):
        for name, identity in artifacts.items():
            if Path(name).name != name:
                raise RuntimeError("Retained artifact names must remain within the output directory.")
            local = output / name
            path = local if local.is_file() else Path(identity["path"])
            raw = path.read_bytes()
            if len(raw) != identity["bytes"] or hashlib.sha256(raw).hexdigest() != identity["sha256"]:
                raise RuntimeError("The retained artifact changed: " + name)
    verify_artifacts(journal.get("artifacts", {}))
    state = journal.get("packageContinuation")
    binding = {"route": route, "caseId": case_id, "planId": source_row[2],
               "sourceSha256": expected_source}
    if state is None:
        state = {"schema": "stellar-forge.sf47-package-receiving.v1",
                 "binding": binding, "status": "RUNNING", "issued": {},
                 "phases": {}, "artifacts": {}}
        journal["packageContinuation"] = state
    elif state.get("binding") != binding:
        raise RuntimeError("Resume the same selected case and receiving route.")
    verify_artifacts(state["artifacts"])

    def persist():
        atomic(checkpoint, (canonical(journal) + "\n").encode())
    def keep(name, producer):
        path = output / name
        known = state["artifacts"].get(name)
        if path.is_file():
            raw = path.read_bytes()
        else:
            if known:
                raise RuntimeError("Restore this retained continuation artifact: " + name)
            raw = producer()
            atomic(path, raw)
        identity = {"path": str(path), "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest()}
        if known and (identity["bytes"], identity["sha256"]) != (known["bytes"], known["sha256"]):
            raise RuntimeError("The continuation source changed: " + name)
        state["artifacts"][name] = identity
        persist()
        return raw
    def kept_json(name, producer):
        return json.loads(keep(name, lambda: (canonical(producer()) + "\n").encode()))
    def step(name, callback):
        if name in state["phases"]:
            return state["phases"][name]
        state["activePhase"] = name
        persist()
        result = callback()
        state["phases"][name] = result
        state.pop("error", None)
        state.pop("activePhase", None)
        persist()
        print(json.dumps({"continuationPhase": name, "status": "COMPLETE"}), flush=True)
        return result
    persist()
    source_path = output / "Package_Original_Source.json"
    keep(source_path.name, lambda: source_row[0])
    if source_path.read_bytes() != source_row[0]:
        raise RuntimeError("The continuation must retain the original public source exactly.")

    handles = {}
    def opened(label):
        if label not in handles:
            workspace = Workspace(root / ("data-" + label), source_path)
            handles[label] = (workspace, Operations(workspace))
        return handles[label]
    def close(label):
        if label in handles:
            handles.pop(label)[0].close()
    def current(label=route, pid=case_id):
        return opened(label)[1].read(pid)
    def issue(key, action, build, note, label=route, pid=case_id):
        entry = state["issued"].get(key)
        if entry is None:
            # Preview/data construction happens only before the first saved request.
            version = current(label, pid)["program"]["version"]
            data = build()
            entry = {"route": label, "caseId": pid, "request": {
                "expectedVersion": version, "requestId": PREFIX + "packages-" + route + "-" + key,
                "actor": ACTOR, "note": note, "action": action, "data": deepcopy(data)}}
            state["issued"][key] = entry
            persist()
        if (entry["route"], entry["caseId"], entry["request"]["action"]) != (label, pid, action):
            raise RuntimeError("Keep the original native action, route and request identity.")
        if "result" not in entry:
            try:
                entry["result"] = opened(label)[1].command(pid, entry["request"])
                entry.pop("lastError", None)
            except Problem as error:
                entry["lastError"] = {"code": error.code, "status": error.status, "message": str(error)}
                persist()
                raise
            persist()
        return entry["result"]
    def immutable(value):
        return {key: deepcopy(item) for key, item in value.items() if key != "current"}
    def archive(name, label=route, pid=case_id):
        ops = opened(label)[1]
        raw = keep(name + ".zip", lambda: ops.export(pid))
        document, files = ops._unpack(raw)
        kept_json(name + ".json", lambda: document)
        return document, files
    def assert_history(before, after):
        # A receiving import changes case provenance, but frozen rows and events remain exact.
        for kind in ("reviews", "forecasts", "portfolios", "installations", "workIntakes", "amendments"):
            indexed = {(row["id"], row.get("revision")): row for row in after.get(kind, [])}
            for row in before.get(kind, []):
                if indexed.get((row["id"], row.get("revision"))) != row:
                    raise RuntimeError("The full handover changed an original " + kind + " edition.")
        if after.get("events", [])[:len(before.get("events", []))] != before.get("events", []):
            raise RuntimeError("The complete original native event history changed.")
    def assert_sources(ops, pid, document, files):
        for metadata in document["sources"]:
            retained_metadata, raw = ops.source(pid, metadata["id"])
            if (retained_metadata != metadata or files["sources/" + metadata["id"]] != raw
                    or hashlib.sha256(raw).hexdigest() != metadata["sha256"]):
                raise RuntimeError("Receiving changed the original source: " + metadata["id"])

    def bind_records():
        case = current()
        if case["program"]["mode"] != "WALKTHROUGH" or case["program"]["state"] != "OPEN":
            raise RuntimeError("Continue the open, labelled original WALKTHROUGH case.")
        if not case.get("workIntakeRefs"):
            raise RuntimeError("Open the original case containing its completed native work intake.")
        invoice = next(row for row in case["records"]["invoices"] if row["id"] == journal["invoiceId"])
        source_id = journal["ledgerSourceId"]
        if source_id not in {row["id"] for row in case["sources"]}:
            raise RuntimeError("The original retained invoice source is unavailable.")
        costs = {row["id"]: row for row in case["plan"]["scenario"]["future_costs"]}
        chosen = next((line["costId"] for line in invoice["lines"]
                       if line.get("costId") in costs and costs[line["costId"]]["tranche"] in (1, 2, 3)
                       and any(row["costId"] == line["costId"] and row["id"] in line["workIds"]
                               and row["state"] != "VOID" for row in case["records"]["work"])), None)
        if chosen is None:
            raise RuntimeError("Select the original retained invoice with its package-bound work.")
        new_id = "receiving-" + digest({"operation": OPERATION, "caseId": case_id, "costId": chosen})[:16]
        if new_id in costs:
            raise RuntimeError("The continuation destination is already present before its retained save.")
        retained = kept_json("Package_Original_Case.json", lambda: case)
        return {"oldCostId": chosen, "newCostId": new_id, "tranche": costs[chosen]["tranche"],
                "contributorId": journal["contributorId"], "sourceId": source_id,
                "initialVersion": retained["program"]["version"],
                "initialPlan": deepcopy(retained["plan"])}
    def selections():
        return state["phases"]["original_record_binding"]

    def save_deployment():
        selected = selections()
        return issue("deployment", "deployment.save", lambda: {
            "name": "Package receiving — original walkthrough installation",
            "operator": ACTOR, "role": "MERCHANT", "environment": "LOCAL", "state": "PLANNED",
            "costIds": [selected["oldCostId"]], "tranche": selected["tranche"],
            "sourceIds": [selected["sourceId"]],
            "sourceNote": "Original labelled package-reassignment exercise."},
            "Retain the selected package attribution on a native planned installation deployment.")
    def save_installation():
        def build():
            ops = opened(route)[1]
            document = ops.seed_installation(case_id, {"expectedVersion": current()["program"]["version"]})["document"]
            selected = selections()
            document["name"] = "Complete original package receiving walkthrough"
            document["merchantDeploymentId"] = state["phases"]["original_deployment"]["recordId"]
            document["source"].update(sourceIds=[selected["sourceId"]], mode="SNAPSHOT",
                                      reference=OPERATION)
            document["workorder"].update(sourceId=selected["sourceId"], reference=OPERATION,
                                        scope="Retained original WALKTHROUGH work, invoice and package attribution.")
            for check in document["checks"]:
                if check["title"] == selected["oldCostId"]:
                    check["sourceIds"] = [selected["sourceId"]]
                    check["workIds"] = [row["id"] for row in current()["records"]["work"]
                                        if row["costId"] == selected["oldCostId"] and row["state"] != "VOID"]
                    check["note"] = "Original retained observations; acceptance remains open."
            preview = ops.preview_installation(case_id, {"expectedVersion": current()["program"]["version"],
                "installationId": None, "expectedRevision": 0, "document": document})
            kept_json("Package_Installation_Preview.json", lambda: preview)
            return {"installationId": None, "expectedRevision": 0, "document": document,
                    "expectedPreviewSha256": preview["previewSha256"]}
        result = issue("installation", "installation.save", build,
                       "Save the complete planned installation against the original package and source records.")
        value = immutable(opened(route)[1].installation(case_id, result["recordId"], result["revision"]))
        kept_json("Package_Original_Installation.json", lambda: value)
        return result
    def retain_payment():
        selected = selections()
        return issue("grant-receipt", "cash.record", lambda: {
            "direction": "IN", "category": "GRANT", "date": DAY, "currency": "USD",
            "amount": "1000.00", "externalRef": PREFIX + "packages-" + route + "-receipt",
            "tranche": selected["tranche"] - 1, "allocations": [],
            "sourceIds": [selected["sourceId"]],
            "sourceNote": "Labelled internal WALKTHROUGH payment input for the native Completion clock."},
            "Retain the explicit WALKTHROUGH grant receipt alongside the original invoice allocation.")

    def completion_inputs(reassigned):
        case = current()
        selected = selections()
        seed = opened(route)[1].seed_completion(case_id, {
            "expectedVersion": case["program"]["version"], "tranche": selected["tranche"]})
        if reassigned:
            if not seed.get("reviewRequired") or not seed.get("previousInputs"):
                raise RuntimeError("The amended Completion draft must retain the original assignments for review.")
            old = json.loads((output / "Package_Original_Completion_Inputs.json").read_bytes())
            if seed["previousInputs"] != old:
                raise RuntimeError("The original Completion assignments changed before reconciliation.")
        inputs = deepcopy(seed["inputs"])
        for item in inputs["items"]:
            matching = [row for row in case["records"]["work"]
                        if row.get("costId") == item["costId"] and row["state"] != "VOID"]
            owners = sorted({selected["contributorId"], *(row["contributorId"] for row in matching)})
            item.update(ownerIds=owners, startDate=DAY, endDate=DAY, state="COMPLETE", completedOn=DAY,
                workIds=[row["id"] for row in matching],
                deploymentIds=[row["id"] for row in case["records"]["deployments"]
                               if row["id"] == state["phases"]["original_deployment"]["recordId"]
                               and item["costId"] in row["costIds"]],
                sourceIds=[selected["sourceId"]],
                note="Labelled native receiving exercise using the original saved source records.",
                completionNote="WALKTHROUGH: complete this original native package receiving exercise.")
        inputs["note"] = "Original retained receiving exercise" + ("; reviewed against the explicitly amended package set." if reassigned else ".")
        kept_json("Package_" + ("Reconciled" if reassigned else "Original") + "_Completion_Inputs.json", lambda: inputs)
        return {"inputs": inputs}
    def prepare_completion(reassigned):
        label = "Current" if reassigned else "Historical"
        key = "current-preparation" if reassigned else "historical-preparation"
        def build():
            ops = opened(route)[1]
            case = current()
            if not case.get("workIntakeRefs") or not case.get("installationRefs"):
                raise RuntimeError("Retain both native intake and installation references in this preparation.")
            values = {"receiptId": state["phases"]["native_grant_clock"]["recordId"],
                      "asOfDate": DAY,
                      "summary": "Complete labelled native receiving: " + (
                          "reviewed package reassignment and original delivery attribution." if reassigned
                          else "original package assignments before their reviewed amendment.")}
            preview = ops.preview_completion(case_id, {"expectedVersion": case["program"]["version"], **values})
            kept_json("Package_" + label + "_Completion_Preview.json", lambda: preview)
            if not preview["ready"]:
                raise RuntimeError("Complete the original preparation fields: " + canonical(preview["issues"]))
            return {**values, "expectedPreviewSha256": preview["previewSha256"]}
        result = issue(key, "completion.prepare", build,
                       "Retain the full " + label.lower() + " Completion snapshot and its original source references.")
        review = opened(route)[1].review(case_id, result["recordId"])
        completion.validate_preparation(review)
        if not review["snapshot"].get("workIntakeRefs") or not review["snapshot"].get("installationRefs"):
            raise RuntimeError("The frozen preparation omitted an original native reference collection.")
        kept_json("Package_" + label + "_Completion_Preparation.json", lambda: review)
        return result

    def save_forecast():
        def build():
            inputs = {"name": "Package continuation — historical original forecast",
                      "asOfDate": DAY, "calendarStart": DAY,
                      "note": "Complete native source before explicit package reassignment."}
            preview = opened(route)[1].preview_forecast(case_id, {
                "expectedVersion": current()["program"]["version"], "inputs": inputs})
            kept_json("Package_Historical_Forecast_Preview.json", lambda: preview)
            return {"inputs": inputs, "expectedPreviewSha256": preview["previewSha256"]}
        receipt = issue("forecast", "forecast.save", build,
                        "Preserve a complete native forecast before changing the selected package.")
        kept_json("Package_Historical_Forecast.json", lambda: immutable(
            opened(route)[1].forecast(case_id, receipt["recordId"])))
        return receipt
    def save_portfolio():
        def build():
            ops = opened(route)[1]
            inputs = ops.seed_portfolio(case_id, {
                "expectedVersion": current()["program"]["version"],
                "forecastId": state["phases"]["historical_forecast"]["recordId"]})["inputs"]
            inputs["name"] = "Package continuation — retained original delivery allocation"
            inputs["note"] = "Keep the complete original source, capacity and assignments through the later amendment."
            preview = ops.preview_portfolio(case_id, {"expectedVersion": current()["program"]["version"], "inputs": inputs})
            kept_json("Package_Historical_Portfolio_Preview.json", lambda: preview)
            return {"inputs": inputs, "expectedPreviewSha256": preview["previewSha256"]}
        receipt = issue("portfolio", "portfolio.save", build,
                        "Retain the original complete native portfolio with its saved forecast.")
        kept_json("Package_Historical_Portfolio.json", lambda: immutable(
            opened(route)[1].portfolio(case_id, receipt["recordId"])))
        return receipt

    def save_selected_revision():
        workspace, _ = opened(route)
        entry = state.get("plannerRequest")
        if entry is None:
            selected = selections()
            plan = selected["initialPlan"]
            fields = ("id", "tranche", "start_day", "end_day", "estimated_hours",
                      "assumed_hourly_rate_usd", "amount_usd", "category", "remaining_work", "measurable_proof")
            costs = [{key: deepcopy(row[key]) for key in fields if key in row}
                     for row in plan["scenario"]["future_costs"]]
            for row in costs:
                if row["id"] == selected["oldCostId"]:
                    row["id"] = selected["newCostId"]
            planning = deepcopy(plan["planning"])
            for key in ("pricing", "payments"):
                if selected["oldCostId"] in planning.get(key, {}):
                    planning[key][selected["newCostId"]] = planning[key].pop(selected["oldCostId"])
            for row in planning.get("assignments", []):
                if row["costId"] == selected["oldCostId"]:
                    row["costId"] = selected["newCostId"]
            patch = {key: deepcopy(plan["scenario"][key]) for key in
                     ("scenario_name", "award_request_usd", "project_end_day") if key in plan["scenario"]}
            patch["milestones"] = [{key: deepcopy(row[key]) for key in
                ("tranche", "submit_day", "review_and_payment_lag_days", "deliverable", "measurable_proof") if key in row}
                for row in plan["scenario"]["milestones"]]
            patch["future_costs"] = costs
            latest = workspace.read(binding["planId"])
            entry = {"planId": binding["planId"], "expectedRevision": latest["currentRevision"],
                     "patch": patch, "planning": planning,
                     "note": "Replace one retained walkthrough package identity with its explicit successor; preserve the selected budget, timing and scope.",
                     "requestId": PREFIX + "packages-" + route + "-native-plan"}
            state["plannerRequest"] = entry
            persist()
        if "plannerResult" not in state:
            state["plannerResult"] = workspace.save(entry["planId"], entry["expectedRevision"],
                entry["patch"], entry["planning"], entry["note"], entry["requestId"])
            persist()
        value = state["plannerResult"]
        kept_json("Package_Selected_Native_Plan.json", lambda: value)
        return {"revision": value["revision"], "contentSha256": value["contentSha256"]}

    def amendment_proposal():
        def build():
            selected = selections()
            target = state["phases"]["selected_native_revision"]
            inputs = {"selectedRevision": target["revision"],
                "expectedContentSha256": target["contentSha256"], "asOfDate": DAY,
                "reason": "Replace the referenced package and retain original work, invoice and deployment attribution through one explicit mapping.",
                "basis": {"kind": "WALKTHROUGH", "reference": OPERATION, "date": DAY,
                          "sourceIds": [selected["sourceId"]], "note": "Continuation of the complete original native receiving case."},
                "packageMappings": [{"fromCostId": selected["oldCostId"], "toCostId": selected["newCostId"],
                                     "note": "Same retained observations, cash and quantities assigned to the selected successor package."}]}
            preview = opened(route)[1].preview_amendment(case_id, {
                "expectedVersion": current()["program"]["version"], "inputs": inputs})
            kept_json("Package_Amendment_Preview.json",
                      lambda: {key: value for key, value in preview.items() if key != "calendarImpact"})
            if not preview["compatibility"]["compatible"]:
                raise RuntimeError("Resolve the actual native package comparison: " + canonical(preview["compatibility"]))
            if {row["kind"] for row in preview.get("recordChanges", [])} != {"work", "invoices", "deployments"}:
                raise RuntimeError("The comparison must include the original work, invoice and deployment attribution.")
            return {"amendmentId": None, "expectedRevision": 0, "inputs": inputs,
                    "expectedPreviewSha256": preview["previewSha256"]}
        result = issue("proposal", "amendment.save", build,
                       "Save the complete selected native revision and explicit original-record mapping.")
        return opened(route)[1].amendment(case_id, result["recordId"], result["amendmentRevision"])["amendment"]
    def amendment_review():
        row = state["phases"]["package_proposal"]
        result = issue("review", "amendment.review", lambda: {
            "amendmentId": row["id"], "expectedRevision": row["revision"],
            "expectedAmendmentSha256": row["sha256"], "expectedPreviewSha256": row["preview"]["previewSha256"],
            "decision": "APPROVE",
            "statement": "Reviewed labelled receiving exercise: preserve original observations and payments, retain historical selections, and map their package attribution explicitly.",
            "sourceIds": [selections()["sourceId"]]},
            "Review the exact complete package mapping and historical Completion/Installation selections.")
        return opened(route)[1].amendment(case_id, result["recordId"], result["amendmentRevision"])["amendment"]
    def apply_and_reopen():
        row = state["phases"]["package_review"]
        before = kept_json("Package_Reviewed_Pre_Apply_Case.json", current)
        receipt = issue("apply", "amendment.apply", lambda: {
            "amendmentId": row["id"], "expectedRevision": row["revision"],
            "expectedAmendmentSha256": row["sha256"], "acknowledgeBaselineChange": True},
            "Apply the reviewed native revision and its explicit attribution to the retained original case.")
        after = current()
        applied = opened(route)[1].amendment(case_id, row["id"])["amendment"]
        expected = deepcopy(before["records"])
        for change in applied["application"]["recordChanges"]:
            index = next(i for i, value in enumerate(expected[change["kind"]]) if value["id"] == change["recordId"])
            if expected[change["kind"]][index] != change["before"]:
                raise RuntimeError("The applied mapping lost an original record preimage.")
            expected[change["kind"]][index] = change["after"]
        if after["records"] != expected or after["sources"] != before["sources"]:
            raise RuntimeError("The applied mapping changed fields outside its complete retained record changes.")
        if after["records"]["cash"] != before["records"]["cash"]:
            raise RuntimeError("The package amendment changed original cash observations.")
        if after["plan"]["contentSha256"] != state["phases"]["selected_native_revision"]["contentSha256"]:
            raise RuntimeError("Application differs from the exact reviewed native revision.")
        if after["completionPlans"] != before["completionPlans"]:
            raise RuntimeError("The original Completion assignments must remain retained until separately reconciled.")
        kept_json("Package_Applied_Amendment.json", lambda: applied)
        kept_json("Package_Applied_Case.json", lambda: after)
        close(route)
        replay = opened(route)[1].command(case_id, state["issued"]["apply"]["request"])
        if replay != receipt or current()["program"]["version"] != after["program"]["version"]:
            raise RuntimeError("Reopening and replaying the accepted application created another native event.")
        return {"receipt": receipt, "replay": replay, "recordChanges": applied["application"]["recordChanges"],
                "selectedPlanSha256": after["plan"]["contentSha256"]}

    def historical_receiving():
        ops = opened(route)[1]
        historical, old_files = archive("Package_Before_Mapping")
        latest, latest_files = archive("Package_After_Mapping")
        assert_history(historical, latest)
        for name, raw in old_files.items():
            if name.startswith("sources/") and latest_files.get(name) != raw:
                raise RuntimeError("The current complete case changed a historical source file.")
        for review in historical["reviews"]:
            if review.get("purpose") == "TRANCHE_COMPLETION":
                current_review = ops.review(case_id, review["id"])
                if current_review != review:
                    raise RuntimeError("The amendment changed a frozen original Completion preparation.")
                completion.validate_preparation(current_review)
        historical_installation = json.loads((output / "Package_Original_Installation.json").read_bytes())
        selected_installation = ops.installation(case_id, historical_installation["id"], historical_installation["revision"])
        if immutable(selected_installation) != historical_installation or not selected_installation["current"]["selectedRecordsChanged"]:
            raise RuntimeError("The original Installation must retain its edition and display its changed package selection.")
        return {"historicalReviews": len(historical["reviews"]), "historicalForecasts": len(historical["forecasts"]),
                "historicalPortfolios": len(historical["portfolios"]),
                "historicalInstallation": {"id": historical_installation["id"], "revision": historical_installation["revision"]},
                "originalSources": len(historical["sources"])}

    def complete_export():
        before = json.loads((output / "Package_Before_Mapping.json").read_bytes())
        document, files = archive("Package_Complete_Case")
        assert_history(before, document)
        for review in document["reviews"]:
            completion.validate_preparation(review)
        if not document.get("workIntakeRefs") or not document.get("installationRefs"):
            raise RuntimeError("The complete case must retain native intake and Installation references.")
        assert_sources(opened(route)[1], case_id, document, files)
        return {"caseVersion": document["program"]["version"], "members": sorted(files),
                "amendmentEditions": len(document["amendments"]),
                "preparations": [row["id"] for row in document["reviews"] if row.get("purpose") == "TRANCHE_COMPLETION"]}

    receiver_route = "package-" + route + "-receiver"
    def receive_full_case():
        raw = (output / "Package_Complete_Case.zip").read_bytes()
        entry = state.get("importRequest")
        request = {"route": receiver_route, "name": "Complete retained package amendment receiving",
                   "requestId": PREFIX + "packages-" + route + "-receive",
                   "actor": ACTOR, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if entry is None:
            entry = request
            state["importRequest"] = entry
            persist()
        elif entry != request:
            raise RuntimeError("Keep the exact complete original receiving archive and import identity.")
        ops = opened(receiver_route)[1]
        if "importResult" not in state:
            state["importResult"] = ops.import_bundle(raw, entry["name"], entry["requestId"], entry["actor"])
            persist()
        result = state["importResult"]
        document, files = ops._unpack(raw)
        received, received_files = archive("Package_First_Received_Case", receiver_route, result["id"])
        for key in ("records", "sources", "completionPlans", "installationRefs", "workIntakeRefs"):
            if received.get(key) != document.get(key):
                raise RuntimeError("Native receiving changed the complete original " + key + ".")
        if (received["plan"]["contentSha256"] != document["plan"]["contentSha256"]
                or received["program"]["origin"]["programId"] != case_id):
            raise RuntimeError("Native receiving lost the selected plan or original case provenance.")
        assert_history(document, received)
        assert_sources(ops, result["id"], document, files)
        for review in document["reviews"]:
            if ops.review(result["id"], review["id"]) != review:
                raise RuntimeError("Native receiving changed an original frozen review.")
            completion.validate_preparation(review)
        return {"receipt": result, "sourceCaseId": case_id, "members": sorted(received_files)}

    def replay_and_complete_handover():
        result = state["importResult"]
        pid = result["id"]
        ops = opened(receiver_route)[1]
        def build():
            contributor = next(row for row in current(receiver_route, pid)["records"]["contributors"]
                               if row["id"] == selections()["contributorId"])
            return {**{key: deepcopy(contributor[key]) for key in
                       ("id", "name", "kind", "contact", "note", "sourceIds", "sourceNote")},
                    "note": "Later receiving-office note retained after complete package reassignment and both original Completion preparations."}
        later = issue("receiver-note", "contributor.save", build,
                      "Continue native receiving work before replaying its exact original complete import.",
                      receiver_route, pid)
        entry = state["importRequest"]
        replay = ops.import_bundle((output / "Package_Complete_Case.zip").read_bytes(),
                                   entry["name"], entry["requestId"], entry["actor"])
        if replay != result or current(receiver_route, pid)["program"]["version"] != later["version"]:
            raise RuntimeError("Import replay replaced later receiving work or created another native event.")
        close(receiver_route)
        reopened = current(receiver_route, pid)
        if reopened["program"]["version"] != later["version"]:
            raise RuntimeError("Database reopen changed the later receiving case.")
        final, files = archive("Package_Received_Complete_Handover", receiver_route, pid)
        original_doc = json.loads((output / "Package_Complete_Case.json").read_bytes())
        assert_history(original_doc, final)
        for review in final["reviews"]:
            completion.validate_preparation(review)
        assert_sources(opened(receiver_route)[1], pid, final, files)
        return {"receipt": result, "exactReplay": replay, "laterVersion": later["version"],
                "sourceCaseId": case_id, "receiverId": pid, "members": sorted(files)}

    try:
        if state.get("status") == "PASS":
            verify_artifacts(state["artifacts"])
            print(json.dumps({"status": "PASS", "continuation": True, "reused": True,
                              "result": str(output / "package-receiving-result.json")}), flush=True)
            return state
        step("original_record_binding", bind_records)
        step("original_deployment", save_deployment)
        step("original_installation", save_installation)
        step("native_grant_clock", retain_payment)
        step("original_completion_assignments", lambda: issue("original-assignments", "completion.save",
            lambda: completion_inputs(False), "Save complete original tranche assignments in the retained walkthrough case."))
        step("historical_completion_preparation", lambda: prepare_completion(False))
        step("historical_forecast", save_forecast)
        step("historical_portfolio", save_portfolio)
        step("complete_historical_archive", lambda: {
            "caseVersion": archive("Package_Before_Mapping")[0]["program"]["version"]})
        step("selected_native_revision", save_selected_revision)
        step("package_proposal", amendment_proposal)
        step("package_review", amendment_review)
        step("mapped_apply_and_reopen", apply_and_reopen)
        step("historical_selections_retained", historical_receiving)
        step("reconciled_completion_assignments", lambda: issue("current-assignments", "completion.save",
            lambda: completion_inputs(True), "Save the complete current assignments after reviewing the retained original package mapping."))
        step("current_completion_preparation", lambda: prepare_completion(True))
        step("complete_case_export", complete_export)
        step("full_original_case_receiving", receive_full_case)
        step("receiving_replay_reopen_handover", replay_and_complete_handover)
        state.pop("activePhase", None)
        state.pop("error", None)
        result = {"schema": state["schema"] + ".result", "status": "PASS", "operationId": OPERATION,
                  "binding": binding, "receiverId": state["importResult"]["id"],
                  "phases": state["phases"], "artifacts": state["artifacts"],
                  "scope": "Complete original WALKTHROUGH continuation: explicit package attribution, source-bound Completion, historical selections and complete native receiving."}
        atomic(output / "package-receiving-result.json", (canonical(result) + "\n").encode())
        state["status"] = "PASS"
        persist()
        print(json.dumps({"status": "PASS", "continuation": True, "phases": len(state["phases"]),
                          "result": str(output / "package-receiving-result.json")}), flush=True)
        return result
    except BaseException as error:
        state["error"] = {"type": type(error).__name__, "message": str(error)}
        persist()
        raise
    finally:
        for workspace, _ in handles.values():
            workspace.close()



if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--root",required=True)
    parser.add_argument("--continue-packages", choices=("original", "receiver", "second-receiver"),
                        help="Continue the selected completed case without replaying the original ten phases.")
    args=parser.parse_args()
    if args.continue_packages:
        continue_packages(args.root, args.continue_packages)
    else:
        main(args.root)
