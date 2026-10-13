#!/usr/bin/env python3
"""One retained full Installation-return walkthrough using original Workspace APIs.

The selected case is explicitly WALKTHROUGH. This records example receiving
observations to exercise the complete product, never an external acceptance.
"""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile


def encode(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def publish(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if not path.is_file() or path.is_symlink() or path.read_bytes() != raw:
            raise ValueError("The retained original receiving file changed: " + path.name)
        return
    fd, stage = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".partial", dir=path.parent)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    if Path(stage).read_bytes() != raw:
        raise ValueError("The complete staged receiving file differs.")
    os.replace(stage, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def run(config, *, completed_only=False):
    required = {"operationId", "sourceRoot", "workspaceDirectory", "receivedDirectory", "outputDirectory"}
    if not isinstance(config, dict) or set(config) != required or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,59}", config["operationId"]):
        raise ValueError("Use the complete original receiving input.")
    paths = {key: Path(config[key]).resolve() for key in required - {"operationId"}}
    if len(set(paths.values())) != 4:
        raise ValueError("Select separate original source, workspace, receiving and output directories.")
    for key in ("workspaceDirectory", "receivedDirectory", "outputDirectory"):
        if paths[key].is_relative_to(paths["sourceRoot"]):
            raise ValueError("Keep receiving state outside selected source.")
    output = paths["outputDirectory"]
    if completed_only and not (output / "result.json").is_file():
        raise ValueError("The selected original core has no retained COMPLETE result; completed-only receiving cannot start it.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (output / "receiving.lock").open("a+b")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    publish(output / "input.json", encode(config))
    def finish_completed(result):
        if result.get("schema") != "stellar-forge.sf47-installation-return-receiving.v1" or result.get("state") != "COMPLETE" or result.get("operationId") != config["operationId"]:
            raise ValueError("The retained receiving result does not identify this complete original operation.")
        selected = {}
        for item in result["files"]:
            relative = Path(item["path"])
            if relative.is_absolute() or ".." in relative.parts or str(relative) in selected or str(relative) in ("result.json", "complete-receiving.zip"):
                raise ValueError("The complete original receiving file selection is invalid.")
            path = output / relative
            if path.is_symlink() or not path.is_file():
                raise ValueError("A complete original receiving artifact is unavailable.")
            raw = path.read_bytes()
            if len(raw) != item["bytes"] or sha(raw) != item["sha256"]:
                raise ValueError("The complete original receiving artifact changed.")
            selected[str(relative)] = raw
        selected["result.json"] = encode(result)
        if (output / "result.json").read_bytes() != selected["result.json"]:
            raise ValueError("The retained complete receiving result changed.")
        archive = output / "complete-receiving.zip"
        if not archive.exists():
            content = io.BytesIO()
            with zipfile.ZipFile(content, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for name, raw in selected.items():
                    info = zipfile.ZipInfo(name, (2026, 10, 12, 0, 0, 0)); info.external_attr = (0o100600 << 16)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    bundle.writestr(info, raw)
            publish(archive, content.getvalue())
        if archive.is_symlink() or not archive.is_file():
            raise ValueError("The original receiving archive is not a complete regular file.")
        with zipfile.ZipFile(archive) as bundle:
            if len(bundle.infolist()) != len(selected) or set(bundle.namelist()) != set(selected):
                raise ValueError("The complete receiving archive member selection changed.")
            for name, raw in selected.items():
                if bundle.read(name) != raw:
                    raise ValueError("The complete receiving archive changed.")
        return {**result, "completeArtifact": {"path": str(archive), "bytes": archive.stat().st_size, "sha256": sha(archive.read_bytes())}}

    if (output / "result.json").exists():
        try:
            # The complete result freezes the selected original files before ZIP
            # publication. A missing ZIP resumes only that final publication.
            return finish_completed(json.loads((output / "result.json").read_bytes()))
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN); lock.close()
    if completed_only:
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN); lock.close()
        raise ValueError("The selected COMPLETE core disappeared; retain the original input and resolve that selection.")
    native = paths["sourceRoot"] / "stellar/scf_2026/sf47_budget_model/workspace"
    sys.path.insert(0, str(native))
    from model import Workspace, Problem, canonical, digest, now
    from operations import Operations
    import operations_installations as installations
    selected_source = native.parent / "sf10_current_candidate.json"
    source_files = []
    for path in sorted(native.glob("*.py")) + [native.parent / "budget.py", selected_source]:
        raw = path.read_bytes()
        source_files.append({"path": str(path.relative_to(paths["sourceRoot"])), "bytes": len(raw), "sha256": sha(raw)})
    # A repaired original source is retained as another complete source observation.
    source_observation = {"files": source_files, "sha256": sha(encode(source_files))}
    publish(output / "source-observations" / (source_observation["sha256"] + ".json"), encode(source_observation))
    actor = "Installation return walkthrough operator 7108"
    prefix = config["operationId"]
    workspace = Workspace(paths["workspaceDirectory"], selected_source)
    receiver_workspace = None
    ops = Operations(workspace)
    checks = []

    def step(name, build, call):
        intent_path, result_path = output / "requests" / (name + ".json"), output / "results" / (name + ".json")
        if intent_path.exists():
            supplied = json.loads(intent_path.read_bytes())
        else:
            supplied = build()
            publish(intent_path, encode(supplied))
        # The original workspace journal owns exact native replay. The saved body
        # is selected before each invocation, including a lost original reply.
        result = call(supplied)
        publish(result_path, encode(result))
        return result

    def command(name, case, action, data, note="Explicit internal WALKTHROUGH observation"):
        return step(name, lambda: {"expectedVersion": ops.read(case)["program"]["version"],
            "requestId": prefix + "-" + name, "actor": actor, "note": note, "action": action,
            "data": data() if callable(data) else data}, lambda body: ops.command(case, body))

    def artifact(name, build):
        path = output / name
        if not path.exists():
            publish(path, build())
        return path.read_bytes()

    def retained_installation(name, case, document, selected=None):
        def prepare():
            context = ops.read(case)
            candidate = ops.preview_installation(case, {"expectedVersion": context["program"]["version"],
                "installationId": selected["id"] if selected else None,
                "expectedRevision": selected["revision"] if selected else 0,
                "document": document() if callable(document) else document})
            return {"installationId": candidate["installationId"], "expectedRevision": candidate["expectedRevision"],
                    "document": candidate["document"], "expectedPreviewSha256": candidate["previewSha256"]}
        result = command(name, case, "installation.save", prepare, "Record the complete selected walkthrough edition.")
        actual = ops.installation(case, result["recordId"], result["revision"])
        retained_path = output / "results" / (name + "-edition.json")
        if retained_path.exists():
            retained = json.loads(retained_path.read_bytes())
            if {key: value for key, value in retained.items() if key != "current"} != {key: value for key, value in actual.items() if key != "current"}:
                raise AssertionError("The original retained Installation edition changed.")
            return retained
        publish(retained_path, encode(actual))
        return actual

    try:
        plan = workspace.read(workspace.list()[0]["id"])
        owner = step("owner-case", lambda: {"name": "Installation return — complete walkthrough",
            "mode": "WALKTHROUGH", "planId": plan["id"], "selectedRevision": plan["revision"],
            "expectedContentSha256": plan["contentSha256"], "calendarStart": "2026-10-12",
            "actor": actor, "requestId": prefix + "-owner-case"}, ops.create)["id"]
        source = command("original-source", owner, "source.add", {
            "filename": "walkthrough-workorder.txt", "mediaType": "text/plain", "kind": "other",
            "sourceUrl": "", "observedAt": "2026-10-12T00:00:00Z",
            "contentBase64": base64.b64encode(b"Internal WALKTHROUGH: complete request, original source and acceptance.\n").decode()})["recordId"]
        deployment = command("original-deployment", owner, "deployment.save", {
            "name": "Internal walkthrough installation", "operator": actor, "operatorId": "walkthrough-7108",
            "role": "BOTH", "participantClass": "TEAM_OPERATED", "environment": "LOCAL", "state": "INSTALLED",
            "sourceIds": [source], "sourceNote": "Internal walkthrough source", "costIds": []})["recordId"]

        def initial_document():
            value = ops.seed_installation(owner, {"expectedVersion": ops.read(owner)["program"]["version"]})["document"]
            value.update(name="Complete receiving walkthrough", merchantDeploymentId=deployment, buyerDeploymentIds=[deployment])
            value["checks"] = [{"id": ident, "title": title, "criterion": criterion, "tranche": 1,
                "required": True, "state": "OPEN", "operator": "", "observedAt": None, "note": "",
                "sourceIds": [], "workIds": [], "purchaseIds": [], "outcomeIds": []}
                for ident, title, criterion in (
                    ("complete-output", "Complete useful output", "Retain every original output byte."),
                    ("independent-reopen", "Independent receiving", "Receive and reopen the complete original case."),
                    ("changed-source", "Source change review", "Review changes before accepting another edition."))]
            value["coordination"] = {"owner": actor, "dueDate": "2026-10-16", "priority": "NORMAL",
                "note": "Original named delivery assignments and dependent receiving checks.",
                "steps": [{"checkId": "complete-output", "owner": actor, "dueDate": "2026-10-14",
                    "priority": "INHERIT", "dependsOn": [], "note": "Retain the whole original output first."},
                    {"checkId": "independent-reopen", "owner": actor, "dueDate": "2026-10-15",
                    "priority": "INHERIT", "dependsOn": ["complete-output"], "note": "Then independently receive every original byte."}]}
            value["workorder"].update(sourceId=source, payer="Internal walkthrough; no customer contract",
                reference="WALKTHROUGH-7108", scope="Exercise complete retained receiving", terms="No payment or external acceptance.")
            value["task"].update(name="Whole receiving task", purpose="Exercise the original customer workflow",
                request="Receive one complete original source edition and its full result.",
                completeOutput="Full file and case history", repeatTrigger="An explicitly selected new source",
                pricedUnit="Walkthrough task; no charge")
            value["source"].update(sourceIds=[source], mode="SNAPSHOT", population="Complete selected walkthrough source",
                meaning="Original text and byte hashes", authority="Authored internal walkthrough", changePolicy="Explicit review")
            value["payment"].update(network="local-walkthrough",asset="none",recipient="none",priceAtomic="0",
                taskBudgetAtomic="0",taskUnits=1,authority="No payment authorization; example only",termsSourceIds=[source])
            value["receiving"].update(application="Original SF47 Operations",host="Selected local receiving workspace",
                operator=actor,acceptanceRule="Complete native receiving",changeAndWithdraw="Keep previous edition and review new work",
                recovery="Replay the original retained request",maintenance="Original workspace owner",sourceIds=[source])
            return value
        baseline = retained_installation("baseline-edition", owner, initial_document)
        baseline_raw = artifact("baseline-case.zip", lambda: ops.export_installation(owner, baseline["id"], baseline["revision"]))
        received = step("receiver-case", lambda: {"name": "Receiving original Installation walkthrough",
            "requestId": prefix + "-receiver-case", "actor": actor},
            lambda body: ops.import_bundle(baseline_raw, body["name"], body["requestId"], body["actor"]))["id"]
        evidence = command("receiving-file", received, "source.add", {
            "filename": "complete-receiving-result.txt", "mediaType": "text/plain", "kind": "other", "sourceUrl": "",
            "observedAt": "2026-10-12T00:01:00Z",
            "contentBase64": base64.b64encode(b"Complete retained example receiving output.\nLine two remains present.\n").decode()})["recordId"]
        purchase = command("receiving-purchase-observation", received, "purchase.record", {
            "deploymentId": deployment, "network": "local-walkthrough", "asset": "none", "amountStroops": "0",
            "observedAt": "2026-10-12T00:01:00Z", "attemptStatus": "NOT_ATTEMPTED", "settlementStatus": "UNKNOWN",
            "paymentAttempted": False, "outputStatus": "COMPLETE", "origin": "OPERATOR_ENTRY",
            "sourceIds": [evidence], "sourceNote": "Explicit fictional walkthrough observation; no payment occurred."})["recordId"]

        def receiver_inputs():
            selection = ops.seed_installation_return(received, {"expectedVersion": ops.read(received)["program"]["version"],
                "installationId": baseline["id"], "revision": baseline["revision"], "sha256": baseline["sha256"]})["inputs"]
            selection.update(name="Complete named receiving report",recipient="Original walkthrough owner",
                environment="Original native Python Workspace, independently imported complete case",
                note="Example walkthrough exercises every original source; no external customer acceptance.")
            for row in selection["observations"]:
                row.update(state="ACCEPTED",operator=actor,observedAt="2026-10-12T00:02:00Z",
                    note="Complete original walkthrough output verified.",sourceIds=[evidence],purchaseIds=[purchase])
            preview = ops.preview_installation_return(received, {"expectedVersion": ops.read(received)["program"]["version"],"inputs":selection})
            return {"inputs":selection,"expectedPreviewSha256":preview["previewSha256"]}
        returned = command("receiving-report", received, "installation.return", receiver_inputs,
            "Freeze complete explicit walkthrough observations against the original edition.")
        returned_row = ops.review(received, returned["recordId"])
        returned_raw = artifact("returned-case.zip", lambda: ops.export_installation_return(received, returned["recordId"]))
        imported_return = step("owner-import-return", lambda: {"name":"Complete returned receiving evidence",
            "requestId":prefix+"-owner-import-return","actor":actor},
            lambda body:ops.import_bundle(returned_raw,body["name"],body["requestId"],body["actor"]))["id"]
        if ops.review(imported_return,returned["recordId"]) != returned_row:
            raise AssertionError("Complete original receiving review changed during import.")
        checks.append("Complete receiver review and all source bytes survive import.")

        def changed_document():
            value=deepcopy(baseline["preview"]["document"])
            value["checks"][2]["criterion"]="Review the new source and obtain a new named current-edition observation."
            return value
        current = retained_installation("owner-definition-change", owner, changed_document, baseline)
        owner_input={"returnedCaseId":imported_return,"reviewId":returned["recordId"],
            "reviewSha256":returned["reviewSha256"],"installationId":current["id"],
            "expectedRevision":current["revision"],"name":"Explicit owner returned-receiving review",
            "note":"Apply the two unchanged criteria; keep the changed criterion for fresh receiving.",
            "choices":[{"id":x["id"],"action":"APPLY","note":"Explicitly selected original receiving observation."}
                       for x in baseline["preview"]["document"]["checks"]]}
        refusal=output/"results"/"changed-criterion-refusal.json"
        if not refusal.exists():
            before_version=ops.read(owner)["program"]["version"]
            try:
                ops.preview_installation_return_review(owner,{"expectedVersion":before_version,"inputs":owner_input})
                raise AssertionError("Changed criterion was allowed to adopt an old receiving observation.")
            except Problem as exc:
                if exc.code!="INSTALLATION_RETURN_FRESH_REVIEW":
                    raise
                publish(refusal,encode({"code":exc.code,"status":exc.status,"message":str(exc),"caseVersion":before_version}))
            if ops.read(owner)["program"]["version"]!=before_version:
                raise AssertionError("Read-only comparison changed the case.")
        owner_input["choices"][2]={"id":"changed-source","action":"KEEP",
            "note":"The criterion changed; retain the current OPEN state and obtain fresh receiving."}

        def stage_inputs():
            value=ops.preview_installation_return_review(owner,{"expectedVersion":ops.read(owner)["program"]["version"],"inputs":owner_input})
            publish(output/"owner-preview.json",encode(value))
            return {"inputs":owner_input,"expectedPreviewSha256":value["previewSha256"]}
        staged=command("owner-stage",owner,"installation.return-stage",stage_inputs,
            "Retain complete receiving evidence and explicit owner choices before the original Installation save.")
        stage_row=ops.review(owner,staged["recordId"])
        staged_document=staged["document"]
        if staged_document["checks"][0]["purchaseIds"] or staged_document["checks"][1]["purchaseIds"]:
            raise AssertionError("Foreign purchase evidence became an owner accounting record.")
        if ops.read(owner)["records"]["purchases"]:
            raise AssertionError("Owner accounting acquired a receiving purchase.")
        if staged_document["checks"][2]["state"]!="OPEN" or "new source" not in staged_document["checks"][2]["criterion"]:
            raise AssertionError("The changed owner criterion was overwritten.")
        if len(ops.installation_history(owner,current["id"])["editions"])!=2 and not (output/"results"/"confirmed-edition.json").exists():
            raise AssertionError("Staging changed the Installation before native save.")
        checks.append("Changed criteria refuse old observations; foreign purchases remain evidence.")
        confirmed = retained_installation("confirmed-edition",owner,staged_document,current)
        if confirmed["revision"]!=3:
            raise AssertionError("The original Installation did not retain all three editions.")
        checks.append("Explicit owner stage is confirmed only by the original Installation preview/save.")
        before_replay = ops.read(owner)["program"]["version"]
        stage_body = json.loads((output / "requests" / "owner-stage.json").read_bytes())
        if ops.command(owner, stage_body) != staged or ops.read(owner)["program"]["version"] != before_replay:
            raise AssertionError("Replaying the original owner stage created another event or changed its receipt.")
        checks.append("Same-request owner-stage replay returns its original full receipt without another event.")
        owner_raw=artifact("owner-complete-case.zip",lambda:ops.export_installation_return(owner,staged["recordId"]))
        receiver_workspace=Workspace(paths["receivedDirectory"],selected_source)
        independent=Operations(receiver_workspace)
        independent_receipt=step("independent-receive",lambda:{"name":"Independent complete owner handover",
            "requestId":prefix+"-independent-receive","actor":actor},
            lambda body:independent.import_bundle(owner_raw,body["name"],body["requestId"],body["actor"]))
        iid=independent_receipt["id"]
        independent_input=json.loads((output/"requests"/"independent-receive.json").read_bytes())
        if independent.import_bundle(owner_raw,independent_input["name"],independent_input["requestId"],independent_input["actor"]) != independent_receipt:
            raise AssertionError("The complete receive retry created a different case.")
        if independent.review(iid,staged["recordId"])!=stage_row:
            raise AssertionError("The independent owner receipt no longer preserves its complete source.")
        if independent.installation(iid,confirmed["id"],3)["sha256"]!=confirmed["sha256"]:
            raise AssertionError("The received original Installation edition changed.")
        for item in ops.read(owner)["sources"]:
            if independent.source(iid,item["id"])!=ops.source(owner,item["id"]):
                raise AssertionError("The independently received full original file changed.")
        checks.append("Independent receive and exact request replay retain the full report, every edition and every file.")
        # The original receiving workspace closes before the native CLI borrows it.
        receiver_workspace.close();receiver_workspace=None
        cli=subprocess.run([sys.executable,"-B",str(native/"cli.py"),"operations","--workspace",str(paths["receivedDirectory"]),
            "--scenario",str(selected_source),"installation-returns","--case",iid],
            text=True,capture_output=True,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"},check=False)
        publish(output/"cli.stdout",cli.stdout.encode());publish(output/"cli.stderr",cli.stderr.encode())
        if cli.returncode:
            raise RuntimeError("The original Installation-return CLI failed: "+cli.stderr[-2000:])
        cli_result=json.loads(cli.stdout)
        if not any(x["id"]==staged["recordId"] for x in cli_result["reviews"]):
            raise AssertionError("The original CLI did not reopen the retained owner review.")
        receiver_workspace=Workspace(paths["receivedDirectory"],selected_source)
        independent=Operations(receiver_workspace)
        reopened=independent.installation(iid,confirmed["id"],3)
        if reopened["sha256"]!=confirmed["sha256"]:
            raise AssertionError("The full received Installation changed on database reopen.")
        checks.append("The actual native CLI and a closed/reopened workspace retain the original owner review.")
        publish(output/"receiving-report.json",encode({"baseline":baseline,"returned":returned_row,"ownerStage":stage_row,
            "confirmed":confirmed,"independent":independent_receipt,"checks":checks}))
        receiver_workspace.close();receiver_workspace=None
        workspace.close();workspace=None
        artifacts=[]
        for path in sorted(output.rglob("*")):
            if path.is_file() and not path.is_symlink() and path.name not in ("receiving.lock","result.json","complete-receiving.zip"):
                raw=path.read_bytes();artifacts.append({"path":str(path.relative_to(output)),"bytes":len(raw),"sha256":sha(raw)})
        result={"schema":"stellar-forge.sf47-installation-return-receiving.v1","state":"COMPLETE",
            "operationId":prefix,"mode":"WALKTHROUGH","source":source_observation,
            "ownerCaseId":owner,"receiverCaseId":received,"returnedCaseId":imported_return,
            "independentCaseId":iid,"installationId":confirmed["id"],"revision":confirmed["revision"],
            "installationSha256":confirmed["sha256"],"receivingReviewId":returned["recordId"],
            "ownerReviewId":staged["recordId"],"checks":checks,"files":artifacts}
        publish(output/"result.json",encode(result))
        return finish_completed(result)
    finally:
        if receiver_workspace is not None:
            receiver_workspace.close()
        if workspace is not None:
            workspace.close()
        fcntl.flock(lock.fileno(),fcntl.LOCK_UN);lock.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True)
    parser.add_argument("--completed-only", action="store_true", help="Verify and return only an already completed original core.")
    args=parser.parse_args()
    result=run(json.loads(Path(args.input).read_bytes()), completed_only=args.completed_only)
    print(json.dumps(result,ensure_ascii=False))


if __name__=="__main__":
    main()
