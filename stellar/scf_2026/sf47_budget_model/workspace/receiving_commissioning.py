"""Continue one original calendar case through source-bound commissioning.

This programme imports existing native output, records explicitly authored
review selections, and returns complete editable original-case archives.
It never dispatches a Console workflow, buyer request or transfer.
"""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

OPERATION = "SCF-6966-CUSTOMER-COMMISSIONING-RECEIVING-20261013"


def identity(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def publish(path, raw, *, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() and not replace:
        if path.read_bytes() == raw:
            return path
        raise ValueError("Retain the original completed output: " + str(path))
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def json_file(path, value, *, replace=False):
    return publish(path, (canonical(value) + "\n").encode(), replace=replace)


def original(path, sha):
    raw = Path(path).read_bytes()
    if identity(raw) != sha:
        raise ValueError("The selected original input differs: " + str(path))
    return raw


def run(config):
    root = Path(config["workingDirectory"]).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if config.get("operationId") != OPERATION:
        raise ValueError("Continue the declared original receiving operation.")
    source = Path(config["applicationDirectory"]).resolve()
    pins = config.get("applicationSourceSha256")
    if not isinstance(pins, dict) or not pins:
        raise ValueError("Supply the complete selected application source digest map.")
    for name, sha in pins.items():
        if not isinstance(name, str) or not isinstance(sha, str) or len(sha) != 64:
            raise ValueError("Invalid selected application source identity.")
        original(source / name, sha)
    sys.path.insert(0, str(source))
    from model import Workspace, Problem, digest
    from operations import Operations
    from operations_workflow_source import read_bundle
    import operations_commissioning as commissioning

    checkpoint_path = root / "receiving-state.json"
    if checkpoint_path.exists():
        state = json.loads(checkpoint_path.read_bytes())
        if state["operationId"] != OPERATION or state["configurationSha256"] != digest(config):
            raise ValueError("This receiving directory belongs to another original source selection.")
    else:
        state = {"operationId": OPERATION, "configurationSha256": digest(config),
            "configuration": config, "createdAt": datetime.now(timezone.utc).isoformat(),
            "state": "PREPARED", "steps": {}, "requests": {}}
        json_file(checkpoint_path, state)

    def save():
        json_file(checkpoint_path, state, replace=True)

    def step(name, function):
        if name in state["steps"]:
            return deepcopy(state["steps"][name])
        retained = root / "steps" / (name + ".json")
        if retained.exists():
            value = json.loads(retained.read_bytes())
        else:
            value = function()
            json_file(retained, value)
        state["steps"][name] = value
        save()
        print(canonical({"step": name, "complete": True}), flush=True)
        return deepcopy(value)

    def request(name, make_body, function):
        retained = root / "requests" / (name + ".json")
        if name not in state["requests"]:
            state["requests"][name] = json.loads(retained.read_bytes()) if retained.exists() else make_body()
            json_file(retained, state["requests"][name])
            save()
        elif retained.exists() and json.loads(retained.read_bytes()) != state["requests"][name]:
            raise ValueError("The retained original request differs from the checkpoint.")
        return step(name, lambda: function(deepcopy(state["requests"][name])))

    raw_case = original(config["caseArchive"], config["caseArchiveSha256"])
    raw_workflow = original(config["workflowSource"], config["workflowSourceSha256"])
    native = read_bundle(raw_workflow)
    selected_cycles = config["cycleIds"]
    available_cycles = {row["cycle"]["id"]: row for row in native["periods"]}
    if not selected_cycles or len(set(selected_cycles)) != len(selected_cycles) or not set(selected_cycles) <= set(available_cycles):
        raise ValueError("Select exact original cycle IDs from the complete workflow source.")
    if not all(available_cycles[key]["run"] for key in selected_cycles):
        raise ValueError("This receiving programme requires retained original completed runs.")

    authored = {"schema": "stellar-forge.sf47-commissioning-authored-selection.v1",
        "operationId": OPERATION, "authored": True,
        "caseArchiveSha256": config["caseArchiveSha256"],
        "workflowSourceSha256": config["workflowSourceSha256"],
        "cycleIds": selected_cycles,
        "entrySelection": config.get("entryIds") or
            "First two planned PURCHASE or ALLOWANCE_USE rows in original document order.",
        "priceSelection": "Existing Installation price and units when entered; otherwise one atomic unit and one priced unit, explicitly authored for receiving.",
        "purpose": "Exercise original-source commissioning, review lineage, exact budget comparison and complete receiving without asserting a new commissioning agreement or purchase."}
    authored_raw = (canonical(authored) + "\n").encode()
    publish(root / "authored-selection.json", authored_raw)
    actor = "Authored commissioning receiving selections"
    workspace = Workspace(root / "workspace", config["scenario"])
    ops = Operations(workspace)
    try:
        imported = step("receive-original-calendar", lambda: ops.import_bundle(raw_case,
            "Original customer calendar · commissioning continuation",
            "commissioning-calendar-6966-20261013", actor))
        case_id = imported["id"]
        initial = step("retain-original-state", lambda: ops.read(case_id))
        initial_purchase_sha = digest(initial["records"]["purchases"])
        installation_id = config["installationId"]
        first = step("retain-original-installation", lambda: ops.installation(case_id, installation_id))
        if state["state"] == "COMPLETE":
            return deepcopy(state["result"])

        def command(name, action, data, note):
            return request(name, lambda: {"requestId": "commissioning-" + name + "-6966-20261013",
                "expectedVersion": ops.read(case_id)["program"]["version"],
                "actor": actor, "note": note, "action": action, "data": data},
                lambda body: ops.command(case_id, body))

        workflow_receipt = command("attach-original-workflow", "source.add",
            {"contentBase64": base64.b64encode(raw_workflow).decode(),
             "filename": "original-customer-workflow.zip", "mediaType": "application/zip",
             "kind": "other", "sourceUrl": config.get("workflowSourceUrl", ""),
             "observedAt": state["createdAt"]},
            "Receive the complete existing Console handover; no workflow dispatch.")
        authored_receipt = command("attach-authored-selection", "source.add",
            {"contentBase64": base64.b64encode(authored_raw).decode(),
             "filename": "authored-commissioning-selection.json", "mediaType": "application/json",
             "kind": "other", "observedAt": state["createdAt"]},
            "Retain explicitly authored commissioning review selections separately from original observations.")
        workflow_source_id = workflow_receipt["recordId"]
        authored_source_id = authored_receipt["recordId"]

        def prepared_body(document):
            current = ops.installation(case_id, installation_id)
            return {"expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": installation_id, "expectedRevision": current["revision"],
                "document": document}

        def prepare_workflow():
            return ops.seed_workflow_installation(case_id, {
                **prepared_body(deepcopy(first["preview"]["document"])),
                "sourceId": workflow_source_id,
                "expectedSourceSha256": config["workflowSourceSha256"],
                "cycleIds": selected_cycles})
        joined = step("receive-original-periods", prepare_workflow)

        def select_complete():
            prepared = ops.seed_installation_commissioning(case_id, prepared_body(joined["document"]))
            document = prepared["document"]
            value = document["commissioning"]
            eligible = [row for row in document["useCalendar"]["entries"]
                if row["state"] == "PLANNED" and row["mode"] in ("PURCHASE", "ALLOWANCE_USE")]
            selected_ids = config.get("entryIds") or [row["id"] for row in eligible[:2]]
            if not selected_ids or not set(selected_ids) <= {row["id"] for row in eligible}:
                raise ValueError("Select existing planned funded customer uses.")
            cycles = {row["cycleId"]: row for row in prepared["inventory"]["cycles"]}
            for index, entry_id in enumerate(selected_ids):
                row = next(row for row in value["uses"] if row["entryId"] == entry_id)
                row["cycleIds"] = [selected_cycles[index % len(selected_cycles)]]
                row["sourceIds"] = list(dict.fromkeys([*row["sourceIds"], authored_source_id]))
                row["note"] = "Authored correspondence for original dated use " + entry_id + \
                    "; the exact retained customer cycle and complete files are selected for this receiving exercise."
                row["outputEvidence"] = "SELECTED_FILES"
                row["outputFiles"] = [{"cycleId": cycle_id, **deepcopy(item)}
                    for cycle_id in row["cycleIds"] for item in cycles[cycle_id]["files"]]
            price = document["payment"]["priceAtomic"]
            units = document["payment"]["taskUnits"]
            for row in value["funding"]:
                row["priceAtomic"] = price if price is not None else "1"
                row["units"] = units if units is not None else 1
                row["budgetAtomic"] = str(int(row["priceAtomic"]) * row["units"])
                row["sourceIds"] = list(dict.fromkeys([*row["sourceIds"], authored_source_id]))
                row["note"] = "Authored priced-unit selection using the retained Installation inputs; inspect original receipts separately."
            active = {fid for row in document["useCalendar"]["entries"]
                if row["state"] != "CANCELLED" for fid in row["fundingIds"]}
            value["aggregateBudgetAtomic"] = str(sum(int(row["budgetAtomic"])
                for row in value["funding"] if row["fundingId"] in active))
            value["authority"] = "Authored receiving budget selection; original buyer authority remains in the Installation workorder and payment record."
            value["sourceIds"] = [authored_source_id]
            value["note"] = "Original Console and calendar sources joined through authored commissioning selections."
            return ops.seed_installation_commissioning(case_id, prepared_body(document))
        prepared = step("prepare-commissioning", select_complete)

        def review_selection():
            report = prepared["report"]
            decisions = [{"kind": "FUNDING", "id": row["fundingId"], "state": "APPROVED",
                "expectedBasisSha256": row["basisSha256"], "note": "Authored review of this exact priced-unit and source selection."}
                for row in report["funding"] if row["canApprove"]]
            for row in report["uses"]:
                if row["canApprovePlan"]:
                    decisions.append({"kind": "PLAN", "id": row["entryId"], "state": "APPROVED",
                        "expectedBasisSha256": row["planBasisSha256"],
                        "note": "Authored review of this exact original use-to-cycle correspondence."})
                if row["canAcceptOutput"]:
                    decisions.append({"kind": "OUTPUT", "id": row["entryId"], "state": "APPROVED",
                        "expectedBasisSha256": row["receivingBasisSha256"],
                        "note": "Authored review of the selected complete original customer files."})
            # Funding bases do not include the review decisions; the aggregate
            # exact basis is stable while the preceding explicit reviews make
            # its prerequisites effective in this same all-or-nothing action.
            decisions.append({"kind": "BUDGET", "id": "budget", "state": "APPROVED",
                "expectedBasisSha256": report["budget"]["basisSha256"],
                "note": "Authored aggregate review; each active original group is counted once."})
            return ops.review_installation_commissioning(case_id, {
                **prepared_body(prepared["document"]), "actor": actor,
                "observedAt": state["createdAt"], "reviews": decisions})
        reviewed = step("review-exact-selections", review_selection)
        if not reviewed["report"]["budget"]["review"]["effectiveApproval"] or \
                reviewed["report"]["summary"]["acceptedOutputs"] < 1:
            raise AssertionError("The selected authored reviews did not become effective.")

        def save_installation(name, document, note):
            preview = step(name + "-preview", lambda: ops.preview_installation(case_id, prepared_body(document)))
            body = {"installationId": installation_id, "expectedRevision": preview["expectedRevision"],
                "document": preview["document"], "expectedPreviewSha256": preview["previewSha256"]}
            return command(name, "installation.save", body, note)

        first_save = save_installation("save-reviewed-commissioning", reviewed["document"],
            "Save the complete original-source commissioning selection and authored reviews.")
        saved = step("read-reviewed-edition", lambda: ops.installation(case_id, installation_id))
        if digest(ops.read(case_id)["records"]["purchases"]) != initial_purchase_sha:
            raise AssertionError("Original purchase observations changed during commissioning.")
        baseline_output_sha = digest(saved["preview"]["report"]["commissioning"])

        def changed_selection():
            document = deepcopy(saved["preview"]["document"])
            value = document["commissioning"]
            active_row = next(row for row in value["uses"] if row["receivingReview"]["state"] == "APPROVED")
            active_row["note"] += " Authored successor correspondence changes the reviewed planning and output basis."
            funding = next((row for row in value["funding"] if row["review"]["state"] == "APPROVED"), None)
            if funding:
                funding["priceAtomic"] = str(int(funding["priceAtomic"]) + 1)
                funding["budgetAtomic"] = str(funding["units"] * int(funding["priceAtomic"]))
            result = ops.seed_installation_commissioning(case_id, prepared_body(document))
            report = result["report"]
            if report["summary"]["stalePlanReviews"] < 1 or report["summary"]["staleOutputReviews"] < 1:
                raise AssertionError("Changed correspondence inherited an earlier review.")
            if funding and next(row for row in report["funding"]
                    if row["fundingId"] == funding["fundingId"])["review"]["effectiveApproval"]:
                raise AssertionError("Changed price inherited earlier price approval.")
            return result
        changed = step("retain-stale-successor", changed_selection)
        second_save = save_installation("save-successor-commissioning", changed["document"],
            "Retain changed authored price/correspondence with the earlier reviews visibly stale.")
        latest = step("read-successor-edition", lambda: ops.installation(case_id, installation_id))
        earlier = ops.installation(case_id, installation_id, saved["revision"])
        if digest(earlier["preview"]["report"]["commissioning"]) != baseline_output_sha:
            raise AssertionError("The earlier complete saved edition changed.")

        def export_current():
            path = root / "commissioning-original-handover.zip"
            if path.exists():
                raw = path.read_bytes()
                # Validate the retained export through the original receiving path
                # below. Never replace an already produced complete archive.
            else:
                raw = ops.export_installation(case_id, installation_id, latest["revision"])
                publish(path, raw)
            return {"path": str(path), "bytes": len(raw), "sha256": identity(raw),
                "caseId": case_id, "installationId": installation_id, "revision": latest["revision"]}
        exported = step("export-complete-handover", export_current)
        exported_raw = original(exported["path"], exported["sha256"])
    finally:
        workspace.close()

    restored_root = root / "received-workspace"
    received_workspace = Workspace(restored_root, config["scenario"])
    received_ops = Operations(received_workspace)
    try:
        received = step("receive-complete-handover", lambda: received_ops.import_bundle(exported_raw,
            "Received original customer commissioning",
            "commissioning-final-import-6966-20261013", actor))
        reopened = step("reopen-received-edition", lambda: received_ops.installation(received["id"], installation_id))
        if digest(reopened["preview"]) != digest(latest["preview"]):
            raise AssertionError("Complete Installation preview changed during receiving.")
        if digest(received_ops.read(received["id"])["records"]["purchases"]) != initial_purchase_sha:
            raise AssertionError("Original purchase rows changed across complete receiving.")
        source_metadata, source_raw = received_ops.source(received["id"], workflow_source_id)
        if source_raw != raw_workflow or source_metadata["sha256"] != config["workflowSourceSha256"]:
            raise AssertionError("Received original Console bytes changed.")
    finally:
        received_workspace.close()
    cold = Workspace(restored_root, config["scenario"])
    try:
        cold_ops = Operations(cold)
        final = cold_ops.installation(received["id"], installation_id)
        if digest(final["preview"]) != digest(latest["preview"]):
            raise AssertionError("Cold reopen changed the selected original edition.")
        history = cold_ops.installation_history(received["id"], installation_id)
        json_file(root / "received-installation-history.json", history)
    finally:
        cold.close()
    result = {"operationId": OPERATION, "state": "COMPLETE", "caseId": case_id,
        "receivedCaseId": received["id"], "installationId": installation_id,
        "originalRevision": first["revision"], "reviewedRevision": saved["revision"],
        "successorRevision": latest["revision"], "purchaseCount": len(initial["records"]["purchases"]),
        "originalPurchaseSha256": initial_purchase_sha, "originalPurchasesUnchanged": True,
        "workflowSourceId": workflow_source_id, "workflowSourceSha256": config["workflowSourceSha256"],
        "calendarCaseArchiveSha256": config["caseArchiveSha256"],
        "selectedCycleIds": selected_cycles, "reviewed": reviewed["report"]["summary"],
        "successor": latest["preview"]["report"]["commissioning"]["summary"],
        "archive": exported, "workspace": str(root / "workspace"),
        "receivedWorkspace": str(restored_root), "browserReceiving": "PENDING",
        "authoredReviewSelections": True, "additionalConsoleRuns": 0,
        "completedAt": datetime.now(timezone.utc).isoformat()}
    result_path = root / "native-result.json"
    if result_path.exists():
        retained = json.loads(result_path.read_bytes())
        stable_keys = ("operationId", "caseId", "receivedCaseId", "installationId",
            "originalRevision", "reviewedRevision", "successorRevision",
            "originalPurchaseSha256", "workflowSourceSha256", "archive")
        if any(retained.get(key) != result.get(key) for key in stable_keys):
            raise ValueError("The retained completion differs from this original operation.")
        result = retained
    else:
        json_file(result_path, result)
    state["result"] = result; state["state"] = "COMPLETE"; save()
    print(canonical(result), flush=True)
    return result



def complete_browser_receiving(config, browser):
    """Receive the exact browser export and reopen it through the original APIs."""
    if browser.get("operationId") != OPERATION or browser.get("state") != "COMPLETE":
        raise ValueError("Select the complete original browser result.")
    root = Path(config["workingDirectory"]).resolve()
    source = Path(config["applicationDirectory"]).resolve()
    for name, sha in config["applicationSourceSha256"].items():
        original(source / name, sha)
    sys.path.insert(0, str(source))
    from model import Workspace, digest
    from operations import Operations
    native = json.loads((root / "native-result.json").read_bytes())
    if browser["caseId"] != native["receivedCaseId"] or browser["installationId"] != native["installationId"]:
        raise ValueError("The browser result names another original receiving case.")
    raw = original(browser["archive"]["path"], browser["archive"]["sha256"])
    result_path = root / "complete-receiving-result.json"
    receipt_path = root / "browser-import-receipt.json"
    final_root = root / "browser-received-workspace"
    workspace = Workspace(final_root, config["scenario"])
    try:
        operations = Operations(workspace)
        receipt = operations.import_bundle(raw, "Complete received customer commissioning",
            "commissioning-browser-final-receive-6966-20261013", "Authored commissioning receiving selections")
        json_file(receipt_path, receipt)
        selected = operations.installation(receipt["id"], native["installationId"])
        if selected["sha256"] != browser["finalEdition"]["sha256"]:
            raise AssertionError("The browser edition differs from the imported complete original.")
        current = operations.read(receipt["id"])
        if digest(current["records"]["purchases"]) != native["originalPurchaseSha256"]:
            raise AssertionError("Final receiving changed the original purchase observations.")
    finally:
        workspace.close()
    cold = Workspace(final_root, config["scenario"])
    try:
        operations = Operations(cold)
        selected = operations.installation(receipt["id"], native["installationId"])
        if selected["sha256"] != browser["finalEdition"]["sha256"]:
            raise AssertionError("The selected browser edition changed after restart.")
        metadata, source_raw = operations.source(receipt["id"], native["workflowSourceId"])
        if identity(source_raw) != native["workflowSourceSha256"]:
            raise AssertionError("Original customer workflow bytes changed after final receiving.")
        history = operations.installation_history(receipt["id"], native["installationId"])
        json_file(root / "complete-received-installation-history.json", history)
    finally:
        cold.close()
    value = {"operationId": OPERATION, "state": "COMPLETE",
        "nativeCaseId": native["caseId"], "operatedCaseId": native["receivedCaseId"],
        "finalReceivedCaseId": receipt["id"], "installationId": native["installationId"],
        "finalRevision": selected["revision"], "installationSha256": selected["sha256"],
        "purchaseCount": native["purchaseCount"], "originalPurchaseSha256": native["originalPurchaseSha256"],
        "originalPurchasesUnchanged": True, "originalWorkflowSha256": native["workflowSourceSha256"],
        "archive": browser["archive"], "browser": browser,
        "finalWorkspace": str(final_root), "coldReopen": True,
        "additionalConsoleRuns": 0, "additionalBuyerRequests": 0,
        "completedAt": datetime.now(timezone.utc).isoformat()}
    if result_path.exists():
        retained = json.loads(result_path.read_bytes())
        if any(retained.get(key) != value.get(key) for key in
                ("operationId", "finalReceivedCaseId", "installationSha256", "archive", "originalPurchaseSha256")):
            raise ValueError("Retain the original completed receiving result.")
        value = retained
    else:
        json_file(result_path, value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Complete exact original-input and owned receiving paths.")
    parser.add_argument("--browser-result", help="Finish only the exact completed original browser export.")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_bytes())
    if args.browser_result:
        print(canonical(complete_browser_receiving(config, json.loads(Path(args.browser_result).read_bytes()))))
    else:
        run(config)


if __name__ == "__main__":
    main()
