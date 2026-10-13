#!/usr/bin/env python3
"""Continue the original Installation-return case through an amendment and cold receiving.

This is a labelled internal WALKTHROUGH using the original Workspace, Operations,
CLI and borrowed browser. It preserves the completed original receiving run.
"""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

SCHEMA = "stellar-forge.sf47-installation-return-continuation.v1"
ACTOR = "Internal Installation receiving operator"
DAY = "2026-10-12"


def encode(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def original_bytes(path, maximum=128 * 1024 * 1024):
    """Read one complete regular original; parsing and identity use these bytes."""
    path = Path(path)
    if not path.is_absolute() or str(path.resolve()) != str(path):
        raise ValueError("Select an absolute original file without path redirection: " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        named = path.lstat()
        if not stat.S_ISREG(before.st_mode) or not stat.S_ISREG(named.st_mode) or (
                before.st_dev, before.st_ino) != (named.st_dev, named.st_ino) or before.st_size > maximum:
            raise ValueError("Select a complete bounded regular original file: " + str(path))
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
        current = path.lstat()
    if len(raw) != before.st_size or (before.st_dev, before.st_ino, before.st_size,
            before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino,
            after.st_size, after.st_mtime_ns, after.st_ctime_ns) or (
            current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):
        raise ValueError("The selected original file changed while receiving: " + str(path))
    return raw


def selected_original(value):
    if not isinstance(value, dict) or set(value) != {"path", "bytes", "sha256"} or (
            not isinstance(value["path"], str) or type(value["bytes"]) is not int or
            not 0 <= value["bytes"] <= 128 * 1024 * 1024 or not isinstance(value["sha256"], str) or
            not re.fullmatch(r"[0-9a-f]{64}", value["sha256"])):
        raise ValueError("Select an original file with its complete path, byte count and SHA-256.")
    raw = original_bytes(value["path"], value["bytes"])
    if len(raw) != value["bytes"] or digest(raw) != value["sha256"]:
        raise ValueError("The selected complete original file differs from its retained identity.")
    return raw


def completed_base(selection, paths):
    """Resolve the existing complete host result without operating its Page or case."""
    if not isinstance(selection, dict) or set(selection) != {"input", "result"}:
        raise ValueError("Select the exact original complete host input and COMPLETE result.")
    host_raw, result_raw = selected_original(selection["input"]), selected_original(selection["result"])
    host, result = json.loads(host_raw), json.loads(result_raw)
    schema = "stellar-forge.sf47-installation-return-complete.v1"
    required = {"schema", "operationId", "coreOperationId", "pageOperationId", "sourceRoot", "sourceManifestFile",
                "workspaceDirectory", "receivedDirectory", "outputDirectory", "pythonExecutable",
                "playwrightModule", "chromiumExecutable", "workspaceAlias"}
    if not isinstance(host, dict) or not required <= set(host) or set(host) - required - {"historicalResult"} or host["schema"] != schema + ".input":
        raise ValueError("Use the original complete Installation host input.")
    if not isinstance(result, dict) or result.get("schema") != schema or result.get("state") != "COMPLETE" or result.get("mode") != "WALKTHROUGH":
        raise ValueError("The selected original complete host has not finished its internal receiving.")
    for key in ("sourceRoot", "workspaceDirectory", "receivedDirectory", "outputDirectory"):
        if not isinstance(host[key], str) or not Path(host[key]).is_absolute() or str(Path(host[key]).resolve()) != host[key]:
            raise ValueError("Keep the original complete host's actual absolute directory: " + key)
    root = Path(host["outputDirectory"])
    if Path(selection["result"]["path"]) != root / "result.json" or (
            Path(host["workspaceDirectory"]) != paths["workspaceDirectory"] or
            Path(host["receivedDirectory"]) != paths["coreReceivedDirectory"]):
        raise ValueError("Continue the exact completed owner workspace, original receiver and result.")
    protected = [root, Path(host["sourceRoot"]), paths["workspaceDirectory"], paths["coreReceivedDirectory"]]
    for key in ("outputDirectory", "receivedDirectory", "finalReceivedDirectory"):
        if any(paths[key] == old or paths[key].is_relative_to(old) or old.is_relative_to(paths[key]) for old in protected):
            raise ValueError("Keep the new continuation output/receivers separate from the completed source, output and workspaces.")
    if paths["sourceRoot"] == Path(host["sourceRoot"]):
        raise ValueError("Retain the completed source edition; select the merged continuation source separately.")
    native_input_raw = original_bytes(root / "input.json", 4 * 1024 * 1024)
    if json.loads(native_input_raw) != host or original_bytes(root / "result.json") != result_raw:
        raise ValueError("The complete result/input is not the original saved host selection.")
    for key in ("operationId", "coreOperationId", "pageOperationId", "workspaceDirectory", "receivedDirectory"):
        if result.get(key) != host[key]:
            raise ValueError("The complete receiving result changed its original " + key + ".")
    package_pin = result.get("packageInput", {})
    if package_pin.get("path") != "customer-package-input.json":
        raise ValueError("The complete original customer package intent is absent.")
    package_raw = selected_original({"path": str(root / package_pin["path"]),
                                     "bytes": package_pin.get("bytes"), "sha256": package_pin.get("sha256")})
    package = json.loads(package_raw)
    if package.get("schema") != schema + ".package" or package.get("inputSha256") != digest(native_input_raw) or (
            {**package.get("summary", {}), "state": "COMPLETE", "completeArtifact": result.get("completeArtifact"),
             "packageInput": package_pin} != result):
        raise ValueError("The complete original package does not identify this exact input/result.")
    rows = package.get("files")
    if not isinstance(rows, list) or not rows or len(rows) > 10000:
        raise ValueError("Retain the complete original customer file selection.")
    names = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            raise ValueError("The complete original package has an invalid file descriptor.")
        relative = Path(row["path"])
        if relative.is_absolute() or str(relative) != row["path"] or any(part in ("", ".", "..") for part in relative.parts) or row["path"] in names:
            raise ValueError("The complete original package has an ambiguous file path.")
        names.add(row["path"])
        selected_original({"path": str(root / relative), "bytes": row.get("bytes"), "sha256": row.get("sha256")})
    if not {"input.json", "source-selection.json", "core-input.json", "core-result.json",
            "page-result.json", "closed.json", "core/result.json", "core/complete-receiving.zip",
            "page/result.json", "page/complete-page-receiving.zip"} <= names:
        raise ValueError("The selected original complete package omitted a required core/Page result.")
    source_raw = original_bytes(root / "source-selection.json")
    source = json.loads(source_raw)
    recorded = result.get("source", {})
    if source.get("schema") != "commons.sf47.installation-return-source-selection.v1" or (
            recorded.get("manifestSha256") != digest(source_raw) or
            package.get("sourceManifestSha256") != digest(source_raw) or recorded.get("commit") != source.get("sourceCommit")):
        raise ValueError("Keep the completed host's exact original source selection.")
    source_rows = source.get("files")
    if not isinstance(source_rows, list) or len(source_rows) != recorded.get("files"):
        raise ValueError("The complete original source file count changed.")
    source_names, source_bytes = set(), 0
    for row in source_rows:
        relative = Path(row.get("path", ""))
        if not isinstance(row.get("path"), str) or relative.is_absolute() or str(relative) != row["path"] or (
                any(part in ("", ".", "..") for part in relative.parts) or row["path"] in source_names):
            raise ValueError("The original source selection has an ambiguous file path.")
        source_names.add(row["path"]); source_bytes += row["bytes"]
        selected_original({"path": str(Path(host["sourceRoot"]) / relative), "bytes": row["bytes"], "sha256": row["sha256"]})
    if source_bytes != recorded.get("bytes"):
        raise ValueError("The complete original source byte count changed.")
    archive = result.get("completeArtifact", {})
    if archive.get("path") != str(root / "Installation_Return_Complete_Receiving_20261012.zip"):
        raise ValueError("Select the original full customer archive.")
    archive_raw = selected_original({key: archive.get(key) for key in ("path", "bytes", "sha256")})
    core_input_raw = original_bytes(root / "core-input.json", 4 * 1024 * 1024)
    core_input = {"operationId": host["coreOperationId"], "sourceRoot": host["sourceRoot"],
                  "workspaceDirectory": host["workspaceDirectory"], "receivedDirectory": host["receivedDirectory"],
                  "outputDirectory": str(root / "core")}
    core_raw = original_bytes(root / "core-result.json")
    core = json.loads(core_raw)
    if json.loads(core_input_raw) != core_input or core.get("state") != "COMPLETE" or core.get("mode") != "WALKTHROUGH" or (
            core.get("schema") != "stellar-forge.sf47-installation-return-receiving.v1" or core.get("operationId") != host["coreOperationId"]):
        raise ValueError("The selected original core input/result changed.")
    for key in ("ownerCaseId", "receiverCaseId", "returnedCaseId", "independentCaseId", "installationId",
                "revision", "installationSha256", "receivingReviewId", "ownerReviewId"):
        if core.get(key) != result.get(key):
            raise ValueError("The complete core and Page package select different original " + key + ".")
    if core.get("completeArtifact") != result.get("coreArtifact"):
        raise ValueError("The original core archive differs from the complete host result.")
    return {"input": core_input, "core": core, "result": result, "files": {
        "Original_Complete_Input.json": host_raw, "Original_Complete_Result.json": result_raw,
        "Original_Complete_Source_Selection.json": source_raw, "Original_Complete_Core_Input.json": core_input_raw,
        "Original_Complete_Core_Result.json": core_raw, "Original_Complete_Receiving.zip": archive_raw}}


def run(config, action="prepare"):
    fields = {"operationId", "sourceRoot", "workspaceDirectory", "coreReceivedDirectory",
              "receivedDirectory", "finalReceivedDirectory", "outputDirectory"}
    if not isinstance(config, dict) or not fields <= set(config) or set(config) - fields - {"completedBase"} or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", config["operationId"]):
        raise ValueError("Use one complete original continuation input.")
    paths = {key: Path(config[key]).resolve() for key in fields - {"operationId"}}
    if len(set(paths.values())) != len(paths) or any(paths[key].is_relative_to(paths["sourceRoot"])
            for key in paths if key != "sourceRoot"):
        raise ValueError("Keep the original source, output and each receiving directory separate.")
    output = paths["outputDirectory"]
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (output / "continuation.lock").open("a+b")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    native = paths["sourceRoot"] / "stellar/scf_2026/sf47_budget_model/workspace"
    sys.path.insert(0, str(native))
    from model import Workspace, Problem
    from operations import Operations
    import operations_amendments as amendments
    source_file = native.parent / "sf10_current_candidate.json"
    checkpoint = output / "continuation-progress.json"
    prior_input = output / "input.json"
    if prior_input.exists() and prior_input.read_bytes() != encode(config):
        raise ValueError("Keep the exact original continuation selection.")
    if not prior_input.exists():
        atomic(prior_input, encode(config))
    state = json.loads(checkpoint.read_bytes()) if checkpoint.exists() else {
        "schema": SCHEMA + ".progress", "operationId": config["operationId"],
        "inputSha256": digest(encode(config)), "phases": {}, "issued": {}, "files": {}}
    if state.get("schema") != SCHEMA + ".progress" or state.get("operationId") != config["operationId"] or state.get("inputSha256") != digest(encode(config)):
        raise ValueError("The original continuation journal changed.")
    handles = {}
    prefix = "ir-cont-" + digest(config["operationId"].encode())[:20] + "-"

    def persist():
        atomic(checkpoint, encode(state))

    def retained(name, make):
        selected = state["files"].get(name)
        path = output / name
        if selected:
            raw = path.read_bytes()
            if path.is_symlink() or len(raw) != selected["bytes"] or digest(raw) != selected["sha256"]:
                raise ValueError("The retained complete output changed: " + name)
            return raw
        raw = path.read_bytes() if path.exists() else make()
        if not isinstance(raw, bytes):
            raise TypeError("Retain exact complete output bytes.")
        if not path.exists():
            atomic(path, raw)
        state["files"][name] = {"path": name, "bytes": len(raw), "sha256": digest(raw)}
        persist()
        return raw

    def json_file(name, make):
        return json.loads(retained(name, lambda: encode(make())))

    def phase(name, operation):
        if name in state["phases"]:
            return state["phases"][name]
        state["activePhase"] = name; persist()
        result = operation()
        state["phases"][name] = result
        state.pop("error", None); state.pop("activePhase", None)
        persist()
        print(json.dumps({"phase": name, "status": "COMPLETE"}), flush=True)
        return result

    def opened(key):
        if key not in handles:
            workspace = Workspace(paths[key], source_file)
            handles[key] = workspace, Operations(workspace)
        return handles[key]

    def close(key):
        if key in handles:
            handles.pop(key)[0].close()

    def execute(key, ops, case_id, action_name, make, note):
        issued = state["issued"].get(key)
        if issued is None:
            data = make() if callable(make) else deepcopy(make)
            body = {"expectedVersion": ops.read(case_id)["program"]["version"], "requestId": prefix + key,
                    "actor": ACTOR, "note": note, "action": action_name, "data": data}
            issued = {"caseId": case_id, "body": body}
            state["issued"][key] = issued; persist()
        if issued["caseId"] != case_id or issued["body"]["action"] != action_name:
            raise ValueError("The original phase changed its native request.")
        if "result" not in issued:
            result = ops.command(case_id, issued["body"])
            issued["result"] = result; persist()
        return issued["result"]

    def method(key, build, call):
        issued = state["issued"].get(key)
        if issued is None:
            issued = {"body": build()}
            state["issued"][key] = issued; persist()
        if "result" not in issued:
            issued["result"] = call(deepcopy(issued["body"])); persist()
        return issued["result"]

    def installation(key, ops, case_id, previous, document, review=None):
        def prepare():
            selected = {"expectedVersion": ops.read(case_id)["program"]["version"],
                        "installationId": previous["id"], "expectedRevision": previous["revision"],
                        "document": document}
            if review:
                selected["returnReview"] = review
            value = ops.preview_installation(case_id, selected)
            return {key: value[key] for key in ("installationId", "expectedRevision", "document", "previewSha256")
                    if key != "previewSha256"} | {
                        "expectedPreviewSha256": value["previewSha256"],
                        **({"returnReview": review} if review else {})}
        result = execute(key, ops, case_id, "installation.save", prepare,
                         "Save this explicitly reviewed internal Installation edition through the original native writer.")
        row = ops.installation(case_id, result["recordId"], result["revision"])
        if row["sha256"] != result["sha256"] or row["preview"]["document"] != document:
            raise ValueError("The original Installation save differs from the selected document.")
        return row

    def core():
        module_spec = importlib.util.spec_from_file_location("original_installation_return_receiving", native / "installation-return-receiving.py")
        module = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(module)
        selected = completed_base(config["completedBase"], paths) if "completedBase" in config else None
        if selected:
            for name, raw in selected["files"].items():
                if retained(name, lambda raw=raw: raw) != raw:
                    raise ValueError("The retained completed-base selection changed: " + name)
            result = module.run(selected["input"], completed_only=True)
            if result != selected["core"]:
                raise ValueError("The verified completed original core returned another result.")
        else:
            result = module.run({"operationId": prefix + "core", "sourceRoot": str(paths["sourceRoot"]),
                                 "workspaceDirectory": str(paths["workspaceDirectory"]),
                                 "receivedDirectory": str(paths["coreReceivedDirectory"]),
                                 "outputDirectory": str(output / "original-core")})
        if result["state"] != "COMPLETE":
            raise ValueError("The original complete Installation receiving has not finished.")
        if retained("Original_Core_Result.json", lambda: encode(result)) != encode(result):
            raise ValueError("The retained original core result changed.")
        if selected:
            _, ops = opened("workspaceDirectory")
            current = ops.read(result["ownerCaseId"])
            original = ops.installation(result["ownerCaseId"], result["installationId"], result["revision"])
            if current["program"].get("mode") != "WALKTHROUGH" or original["sha256"] != result["installationSha256"]:
                raise ValueError("The original completed owner case or historical Installation is unavailable or changed.")
            state["completedBase"] = {"operationId": selected["result"]["operationId"],
                "coreOperationId": result["operationId"], "selection": deepcopy(config["completedBase"]),
                "completeArtifact": selected["result"]["completeArtifact"]}
        state["ownerCaseId"] = result["ownerCaseId"]; state["installationId"] = result["installationId"]; persist()
        return {"ownerCaseId": result["ownerCaseId"], "installationId": result["installationId"],
                "originalReviewId": result["ownerReviewId"], "completeArtifact": result["completeArtifact"]}

    def amend():
        workspace, ops = opened("workspaceDirectory")
        case_id = state["ownerCaseId"]
        original = json_file("Original_Owner_Before_Amendment.json", lambda: ops.read(case_id))
        plan_id = original["program"]["planId"]
        old = workspace.read(plan_id, original["program"]["planRevision"])
        allowed = ("id", "tranche", "start_day", "end_day", "estimated_hours", "assumed_hourly_rate_usd",
                   "amount_usd", "category", "remaining_work", "measurable_proof")
        costs = [{k: deepcopy(row[k]) for k in allowed if k in row} for row in old["scenario"]["future_costs"]]
        if len(costs) < 2 or float(costs[1]["amount_usd"]) < 100:
            raise ValueError("The selected original public planning packages do not support this explicit internal allocation.")
        costs[0]["amount_usd"] = float(costs[0]["amount_usd"]) + 100
        costs[1]["amount_usd"] = float(costs[1]["amount_usd"]) - 100
        selected = method("plan-selected", lambda: {
            "planId": plan_id, "expectedRevision": old["revision"], "scenarioPatch": {"future_costs": costs},
            "planning": old["planning"], "note": "Internal receiving: move USD100 between two unchanged package identities.",
            "requestId": prefix + "plan-selected"},
            lambda b: workspace.save(b["planId"], b["expectedRevision"], b["scenarioPatch"], b["planning"], b["note"], b["requestId"]))
        later = method("plan-later-head", lambda: {
            "planId": plan_id, "expectedRevision": selected["revision"],
            "scenarioPatch": {"scenario_name": selected["scenario"]["scenario_name"] + " — later saved internal label"},
            "planning": selected["planning"], "note": "Keep a later planner head while applying the explicitly selected earlier revision.",
            "requestId": prefix + "plan-later-head"},
            lambda b: workspace.save(b["planId"], b["expectedRevision"], b["scenarioPatch"], b["planning"], b["note"], b["requestId"]))
        inputs = {"selectedRevision": selected["revision"], "expectedContentSha256": selected["contentSha256"],
                  "asOfDate": DAY, "reason": "Internal allocation review preserving the original work packages, tranches and receiving history.",
                  "basis": {"kind": "WALKTHROUGH", "reference": config["operationId"], "date": DAY,
                            "sourceIds": [original["sources"][0]["id"]], "note": "Actual internal product exercise on the original public plan."}}
        def proposal():
            preview = ops.preview_amendment(case_id, {"expectedVersion": ops.read(case_id)["program"]["version"], "inputs": inputs})
            if not preview["compatibility"]["compatible"]:
                raise ValueError("The original internal allocation is not compatible.")
            retained("Amendment_Comparison.json", lambda: encode(preview))
            return {"amendmentId": None, "expectedRevision": 0, "inputs": inputs, "expectedPreviewSha256": preview["previewSha256"]}
        saved = execute("amendment-proposal", ops, case_id, "amendment.save", proposal, "Retain the complete selected revision and comparison.")
        row = ops.amendment(case_id, saved["recordId"], saved["amendmentRevision"])["amendment"]
        reviewed = execute("amendment-review", ops, case_id, "amendment.review", {
            "amendmentId": row["id"], "expectedRevision": row["revision"], "expectedAmendmentSha256": row["sha256"],
            "expectedPreviewSha256": row["preview"]["previewSha256"], "decision": "APPROVE",
            "statement": "Internal operator review: retain original package/tranche identities and all saved Installation editions.",
            "sourceIds": inputs["basis"]["sourceIds"]}, "Record the named internal decision on this exact comparison.")
        row = ops.amendment(case_id, reviewed["recordId"], reviewed["amendmentRevision"])["amendment"]
        result = execute("amendment-apply", ops, case_id, "amendment.apply", {
            "amendmentId": row["id"], "expectedRevision": row["revision"], "expectedAmendmentSha256": row["sha256"],
            "acknowledgeBaselineChange": True}, "Apply the exact reviewed earlier native plan revision.")
        current = ops.read(case_id)
        if current["program"]["planRevision"] != selected["revision"] or current["records"] != original["records"]:
            raise ValueError("Amendment changed the selected revision or historical operating records.")
        state["selectedPlanRevision"] = selected["revision"]; state["laterPlanRevision"] = later["revision"]; persist()
        retained("Amended_Owner_Case.json", lambda: encode(current))
        return {"applied": result, "selectedRevision": selected["revision"], "laterSavedRevision": later["revision"],
                "amendmentEditions": len(amendments.load(ops, case_id))}

    def amended_receiving():
        workspace, ops = opened("workspaceDirectory")
        owner = state["ownerCaseId"]
        baseline = ops.installation(owner, state["installationId"], 3)
        document = deepcopy(baseline["preview"]["document"])
        document["name"] = "Amended plan — complete internal receiving"
        for check in document["checks"]:
            check.update(state="OPEN", operator="", observedAt=None, note="",
                         sourceIds=[], workIds=[], purchaseIds=[], outcomeIds=[])
        current = installation("amended-installation", ops, owner, baseline, document)
        selected_raw = retained("Amended_Installation_Case.zip",
                                lambda: ops.export_installation(owner, current["id"], current["revision"]))
        receiver = method("amended-receiver", lambda: {"name": "Amended Installation receiving", "requestId": prefix + "amended-receiver", "actor": ACTOR},
                          lambda b: ops.import_bundle(selected_raw, b["name"], b["requestId"], b["actor"]))["id"]
        complete_document, complete_files = ops._unpack(selected_raw)
        proof = {"schema": SCHEMA + ".original-observation", "mode": "WALKTHROUGH",
                 "archive": {"bytes": len(selected_raw), "sha256": digest(selected_raw)},
                 "caseId": owner, "installation": {"id": current["id"], "revision": current["revision"], "sha256": current["sha256"]},
                 "selectedPlanRevision": state["selectedPlanRevision"],
                 "files": [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(complete_files.items())],
                 "note": "Actual complete native archive readback in this internal receiving operation."}
        evidence = execute("amended-receiving-file", ops, receiver, "source.add", {
            "filename": "Amended_Installation_Original_Readback.json", "mediaType": "application/json", "kind": "other",
            "contentBase64": base64.b64encode(encode(proof)).decode()}, "Retain the complete actual native archive readback.")["recordId"]
        def receiving_input():
            inputs = ops.seed_installation_return(receiver, {"expectedVersion": ops.read(receiver)["program"]["version"],
                "installationId": current["id"], "revision": current["revision"], "sha256": current["sha256"]})["inputs"]
            inputs.update(name="Complete amended Installation receiving", recipient="Original internal owner",
                environment="Original Python Workspace and full native archive imported in this owned receiving operation.",
                note="The original bytes and historical plan/Installation editions are present. The final changed criterion remains open.")
            for index, item in enumerate(inputs["observations"]):
                item.update(state="ACCEPTED" if index < 2 else "OPEN", operator=ACTOR,
                    observedAt="2026-10-12T00:03:00Z", sourceIds=[evidence],
                    note="Actual original archive/readback retained." if index < 2 else "Keep the final criterion open for its distinct current receiving.")
            preview = ops.preview_installation_return(receiver, {"expectedVersion": ops.read(receiver)["program"]["version"], "inputs": inputs})
            if not preview["basisUnchanged"]:
                raise ValueError("The independently received amended Installation has another acceptance basis.")
            retained("Amended_Receiving_Preview.json", lambda: encode(preview))
            return {"inputs": inputs, "expectedPreviewSha256": preview["previewSha256"]}
        returned = execute("amended-receiving-report", ops, receiver, "installation.return", receiving_input,
                           "Freeze actual internal receiving observations against this amended original edition.")
        row = ops.review(receiver, returned["recordId"])
        raw = retained("Amended_Returned_Case.zip", lambda: ops.export_installation_return(receiver, row["id"]))
        imported = method("owner-amended-return", lambda: {"name": "Complete amended customer return", "requestId": prefix + "owner-amended-return", "actor": ACTOR},
                          lambda b: ops.import_bundle(raw, b["name"], b["requestId"], b["actor"]))["id"]
        def stage_input():
            inputs = {"returnedCaseId": imported, "reviewId": row["id"], "reviewSha256": row["sha256"],
                "installationId": current["id"], "expectedRevision": current["revision"],
                "name": "Owner review before the later Installation change", "note": "Apply two unchanged complete observations; retain the third unfinished criterion.",
                "choices": [{"id": item["id"], "action": "APPLY" if i < 2 else "KEEP",
                    "note": "Explicitly receive this complete original result." if i < 2 else "This criterion needs its own current receiving."}
                    for i, item in enumerate(current["preview"]["document"]["checks"])]}
            preview = ops.preview_installation_return_review(owner, {"expectedVersion": ops.read(owner)["program"]["version"], "inputs": inputs})
            retained("Original_Owner_Stage_Preview.json", lambda: encode(preview))
            return {"inputs": inputs, "expectedPreviewSha256": preview["previewSha256"]}
        staged = execute("original-owner-stage", ops, owner, "installation.return-stage", stage_input,
                         "Stage the complete amended return without advancing the Installation edition.")
        stage_row = ops.review(owner, staged["recordId"])
        retained("Original_Staged_Review.json", lambda: encode(stage_row))
        retained("Staged_Complete_Owner_Case.zip", lambda: ops.export_installation_return(owner, staged["recordId"]))
        state["stageReview"] = {"id": stage_row["id"], "sha256": stage_row["sha256"]}
        state["amendedReturnId"], state["externalReturnedCaseId"] = row["id"], imported
        state["stagedInstallation"] = {"id": current["id"], "revision": current["revision"], "sha256": current["sha256"]}
        persist()
        return {"receivingCaseId": receiver, "returnedCaseId": imported, "receivingReviewId": row["id"],
                "ownerReview": state["stageReview"], "stagedInstallation": state["stagedInstallation"],
                "historicalPlanCount": len(stage_row["installationReturnReview"]["returnedProof"]["planningEvidence"]["document"]["revisions"])}

    def cli(key, directory, argv):
        def invoke():
            result = subprocess.run([sys.executable, "-B", str(native / "cli.py"), "operations", "--workspace", str(directory),
                                     "--scenario", str(source_file), *argv], capture_output=True, check=False,
                                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            retained("cli/" + key + ".stderr", lambda: result.stderr)
            if result.returncode:
                raise RuntimeError("The original CLI failed: " + result.stderr.decode(errors="replace")[-2500:])
            return result.stdout
        return json.loads(retained("cli/" + key + ".json", invoke))

    def cold_owner():
        close("workspaceDirectory")
        receipt = cli("cold-receive", paths["receivedDirectory"], ["import", "--file", str(output / "Staged_Complete_Owner_Case.zip"),
                      "--name", "Cold-received amended Installation owner", "--request-id", prefix + "cold-receive", "--actor", ACTOR])
        state["caseId"] = receipt["id"]; persist()
        _, ops = opened("receivedDirectory")
        case_id = state["caseId"]
        if any(item["id"] == state["externalReturnedCaseId"] for item in ops.list()):
            raise ValueError("The cold receiver unexpectedly depends on the separately imported customer case.")
        seed = ops.seed_installation_return_review(case_id, {"expectedVersion": ops.read(case_id)["program"]["version"],
                                                            "retainedReview": state["stageReview"]})
        if not seed["application"]["canSave"] or any(row["action"] != "KEEP" for row in seed["inputs"]["choices"]):
            raise ValueError("Cold receiving did not preserve a selectable original stage and fresh explicit choices.")
        retained("Cold_Retained_Review_Seed.json", lambda: encode(seed))
        old = ops.installation(case_id, state["installationId"], state["stagedInstallation"]["revision"])
        document = deepcopy(old["preview"]["document"])
        document["checks"][2]["criterion"] += " Complete the new receiving-office correction before accepting this check."
        changed = installation("later-owner-definition", ops, case_id, old, document)
        current_seed = ops.seed_installation_return_review(case_id, {"expectedVersion": ops.read(case_id)["program"]["version"],
                                                                    "retainedReview": state["stageReview"]})
        if current_seed["application"]["canSave"] or not current_seed["application"]["installationChanges"]:
            raise ValueError("The stale stage did not expose the actual later Installation definition.")
        retained("Staged_Versus_Current_Comparison.json", lambda: encode(current_seed))
        try:
            stage = ops.review(case_id, state["stageReview"]["id"])["installationReturnReview"]
            ops.preview_installation(case_id, {"expectedVersion": ops.read(case_id)["program"]["version"],
                "installationId": changed["id"], "expectedRevision": changed["revision"],
                "document": stage["document"], "returnReview": state["stageReview"]})
            raise AssertionError("The stale owner stage was allowed to bypass its selected Installation/source.")
        except Problem as exc:
            if exc.code != "INSTALLATION_RETURN_STAGE_CHANGED":
                raise
            retained("Stale_Stage_Refusal.json", lambda: encode({"code": exc.code, "status": exc.status, "message": str(exc)}))
        context = ops.read(case_id)
        state["currentInstallation"] = {"id": changed["id"], "revision": changed["revision"], "sha256": changed["sha256"]}
        state["preparedCaseVersion"] = context["program"]["version"]; persist()
        close("receivedDirectory")
        readback = cli("retained-seed", paths["receivedDirectory"],
                       ["installation-return-review-seed", "--case", case_id, "--expected-version", str(context["program"]["version"]),
                        "--review", state["stageReview"]["id"], "--sha256", state["stageReview"]["sha256"]])
        if readback["retainedReview"] != state["stageReview"] or readback["application"]["canSave"]:
            raise ValueError("The original CLI selected another stage or lost the visible current difference.")
        return {"caseId": case_id, "currentInstallation": state["currentInstallation"], "review": state["stageReview"],
                "staleCode": "INSTALLATION_RETURN_STAGE_CHANGED", "originalExternalCaseAbsent": True}

    def finish():
        browser_path = output / "browser" / "result.json"
        browser_raw = browser_path.read_bytes()
        browser = json.loads(browser_raw)
        if browser.get("schema") != SCHEMA + ".browser" or browser.get("state") != "COMPLETE" or browser.get("operationId") != config["operationId"]:
            raise ValueError("Finish only the same complete borrowed-browser receiving.")
        for entry in browser["files"]:
            relative = Path(entry["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("The complete browser output has an invalid file selection.")
            raw = (output / "browser" / relative).read_bytes()
            if len(raw) != entry["bytes"] or digest(raw) != entry["sha256"]:
                raise ValueError("A complete selected browser artifact changed.")
        _, owner_ops = opened("receivedDirectory")
        _, receiver_ops = opened("finalReceivedDirectory")
        original_id, final_id = state["caseId"], browser["receivedCaseId"]
        exported = (output / "browser" / "Complete_Reviewed_Owner_Case.zip").read_bytes()
        selected, files = Operations._unpack(exported)
        if selected["program"]["id"] != original_id:
            raise ValueError("The original browser exported another case.")
        saved = browser["installation"]
        selected_row = owner_ops.installation(original_id, saved["id"], saved["revision"])
        received_row = receiver_ops.installation(final_id, saved["id"], saved["revision"])
        if {k: v for k, v in selected_row.items() if k != "current"} != {k: v for k, v in received_row.items() if k != "current"} or selected_row["sha256"] != saved["sha256"]:
            raise ValueError("The complete receiver changed the selected saved Installation.")
        if selected_row["preview"].get("returnReview") != browser["review"]:
            raise ValueError("The saved Installation lost its exact staged review.")
        if [r["state"] for r in selected_row["preview"]["document"]["checks"]] != ["ACCEPTED", "ACCEPTED", "OPEN"]:
            raise ValueError("The explicit partial receiving or changed criterion was lost.")
        current = receiver_ops.read(final_id)
        if current["program"]["origin"]["programId"] != original_id or current["plan"]["revision"] != state["selectedPlanRevision"]:
            raise ValueError("The cold receiver changed the original case or selected plan revision.")
        if receiver_ops.review(final_id, browser["review"]["id"]) != owner_ops.review(original_id, browser["review"]["id"]):
            raise ValueError("The complete retained owner decision changed on receiving.")
        if amendments.load(receiver_ops, final_id) != amendments.load(owner_ops, original_id):
            raise ValueError("The complete amendment history changed on receiving.")
        for row in current["sources"]:
            if receiver_ops.source(final_id, row["id"]) != owner_ops.source(original_id, row["id"]):
                raise ValueError("The complete received original source changed.")
        for row in owner_ops.installation_history(original_id, saved["id"])["editions"]:
            if {k: v for k, v in receiver_ops.installation(final_id, row["id"], row["revision"]).items() if k != "current"} != {k: v for k, v in owner_ops.installation(original_id, row["id"], row["revision"]).items() if k != "current"}:
                raise ValueError("The original historical Installation edition changed.")
        seed = receiver_ops.seed_installation_return_review(final_id, {"expectedVersion": current["program"]["version"],
                                                                       "retainedReview": browser["review"]})
        if not any(row["sha256"] == saved["sha256"] for row in seed["savedInstallations"]):
            raise ValueError("The reopened receiver lost the original stage-to-Installation identity.")
        retained("Final_Received_Case.json", lambda: encode(current))
        retained("Final_Received_Review_Seed.json", lambda: encode(seed))
        retained("Final_Complete_Received_Case.zip", lambda: receiver_ops.export_installation_return(final_id, browser["review"]["id"]))
        close("receivedDirectory"); close("finalReceivedDirectory")
        readback = cli("final-retained-review", paths["finalReceivedDirectory"],
                      ["installation-return-review-seed", "--case", final_id, "--expected-version", str(current["program"]["version"]),
                       "--review", browser["review"]["id"], "--sha256", browser["review"]["sha256"]])
        if readback["retainedReview"] != browser["review"]:
            raise ValueError("The final closed/reopened CLI selected another original decision.")
        return {"receivedCaseId": final_id, "installation": saved, "review": browser["review"],
                "sourceFiles": len(current["sources"]), "amendmentEditions": len(selected["amendments"]),
                "browserSha256": digest(browser_raw), "sourceAndHistoryPreserved": True}

    try:
        if state.get("state") == "COMPLETE":
            for name in state["files"]:
                retained(name, lambda: b"")
            return json.loads((output / "result.json").read_bytes())
        if action == "prepare":
            phase("original_complete_installation_receiving", core)
            phase("exact_historical_plan_amendment", amend)
            phase("amended_receiving_and_original_owner_stage", amended_receiving)
            phase("cold_owner_and_later_definition", cold_owner)
            result = {"schema": SCHEMA + ".prepared", "state": "PREPARED", "operationId": config["operationId"],
                      "sourceRoot": str(paths["sourceRoot"]), "workspaceDirectory": str(paths["receivedDirectory"]),
                      "caseId": state["caseId"], "originalOwnerCaseId": state["ownerCaseId"],
                      "installationId": state["installationId"], "currentInstallation": state["currentInstallation"],
                      "stageReview": state["stageReview"], "preparedCaseVersion": state["preparedCaseVersion"],
                      "selectedPlanRevision": state["selectedPlanRevision"], "laterPlanRevision": state["laterPlanRevision"],
                      "checks": state["phases"], "files": state["files"]}
            retained("prepared.json", lambda: encode(result))
            return result
        if action != "finish":
            raise ValueError("Choose prepare or finish on the same original continuation.")
        phase("whole_browser_return_and_final_cold_receiving", finish)
        result = {"schema": SCHEMA, "state": "COMPLETE", "status": "PASS", "operationId": config["operationId"],
                  "caseId": state["caseId"], "originalOwnerCaseId": state["ownerCaseId"],
                  "checks": state["phases"], "files": state["files"]}
        atomic(output / "result.json", encode(result)); state["state"] = "COMPLETE"; persist()
        return result
    except BaseException as exc:
        state["error"] = {"type": type(exc).__name__, "message": str(exc)}
        persist()
        raise
    finally:
        for workspace, _ in handles.values():
            workspace.close()
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN); lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--phase", choices=("prepare", "finish"), default="prepare")
    args = parser.parse_args()
    result = run(json.loads(Path(args.input).read_bytes()), args.phase)
    print(json.dumps({"state": result["state"], "operationId": result["operationId"],
                      "result": str(Path(json.loads(Path(args.input).read_bytes())["outputDirectory"]) /
                                    ("prepared.json" if args.phase == "prepare" else "result.json"))}), flush=True)


if __name__ == "__main__":
    main()
