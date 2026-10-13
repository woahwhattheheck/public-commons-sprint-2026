#!/usr/bin/env python3
"""Run the complete retained supplier, WRI continuation and received successor.

The installed original Workflow, NativeWorkflowAdapter and Analysis application
perform every acquisition, query, report, workbook, export and receive action.
This programme retains the input selection and complete actual returned objects.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

SCHEMA = "commons.conapi-supplier-programme.v1"
A = "conapi-supplier-a-20261012"
B = "conapi-wri-b-20261012"
C = "conapi-supplier-c-20261012"
SUCCESSOR = "conapi-supplier-received-successor-20261012"
CORRELATION = "conapi-supplier-receiving-20261012"
SUPPLIER = "conapi-elite-initial-import-20261012"
COMPARISON = "cmp_f12da77e4f85bdcd78944729cbfd5d42c6300eec3769f778b09a6269fd08e761"
SOURCE = {}
SOURCE["published-pricing.csv"] = (3558, "6891cc62b1341ee0cdf601a78e9e04b6232f1c26cc1cdeb8f021a5edc1fa5dcb")
SOURCE["services-catalogue.csv"] = (4964, "c225a1e081f783ce20eaf5de222449c03a3d01130ebb9d123b29fcb3673034c9")
SOURCE["datapackage.json"] = (3780, "6c758cf191a670985e7195752565c8d16169d6be8941f707a50ebd6638adefe2")
QUERY_NAMES = ["original_prices", "original_catalogue", "price_catalogue",
               "catalogue_coverage", "catalogue_review", "selected_period"]


def emit(stage, **values):
    print(json.dumps({"stage": stage, **values}, ensure_ascii=False), flush=True)


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def identity(path):
    path = Path(path)
    value = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
            size += len(block)
    return {"path": str(path), "bytes": size, "sha256": value.hexdigest()}


def save(path, value, *, original=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if original and path.exists():
        if read(path) != value:
            raise ValueError("The retained original input changed: " + str(path))
        return value
    temporary = path.with_name(path.name + ".pending")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    return value


def run_cli(component, project, label, *arguments):
    command = [sys.executable, "-I", str(component / "workflow_cli.py"), *map(str, arguments)]
    with (project / (label + ".stdout")).open("wb") as out, (project / (label + ".stderr")).open("wb") as err:
        completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=out, stderr=err)
    if completed.returncode:
        raise RuntimeError(label + ": " + (project / (label + ".stderr")).read_text(errors="replace")[-12000:])
    returned = read(project / (label + ".stdout"))
    save(project / (label + ".json"), returned)
    return returned


def request(request_id, period, parent=None):
    value = {"schema": "stellar-forge.source-workflow-request.v1",
             "requestId": request_id, "correlationId": CORRELATION,
             "profile": "elite-supplier-review", "parameters": {"period": period}}
    if parent:
        value["parentRequestId"] = parent
    return value


def accept_retained(operation, incoming):
    request_id = incoming["requestId"]
    if any(row["requestId"] == request_id for row in operation.status()["requests"]):
        current = operation.status(request_id, history=True)
        if current["request"] != incoming:
            raise ValueError("The retained business request changed: " + request_id)
        return current
    return operation.accept(incoming)


def exported_archive(exported):
    archive = exported.get("archive", exported)
    path = archive.get("path") or exported.get("path")
    sha = archive.get("sha256") or exported.get("sha256")
    if not path or not sha:
        raise ValueError("Use the complete original project export's returned path and SHA.")
    selected = identity(path)
    if selected["sha256"] != sha or (
        archive.get("bytes") is not None and selected["bytes"] != archive["bytes"]
    ):
        raise ValueError("The complete original project export bytes changed.")
    return selected


def require_result(value, *, supplier=False):
    result = value.get("result")
    if not isinstance(result, dict) or result.get("analysis", {}).get("status") != "COMPLETE":
        raise RuntimeError("The original complete native Analysis result is required.")
    if supplier:
        actual = result.get("supplier", {})
        for field, selected in {"requestId": SUPPLIER, "comparisonId": COMPARISON,
                                "revision": 23, "status": "reviewed"}.items():
            if actual.get(field) != selected:
                raise ValueError("The original reviewed supplier identity changed: " + field)
        queries = result["analysis"]["queries"]
        names = [q["name"] for q in queries]
        if names != QUERY_NAMES or any(q.get("previewTruncated") for q in queries):
            raise RuntimeError("The complete original six-section report is required.")
        sources = result["analysis"]["sources"]
        if sources["prices"]["rowCount"] != 23 or sources["catalog"]["rowCount"] != 29:
            raise RuntimeError("The original complete pricing/catalogue row counts differ.")
    return result


def configure(component, project, *, sources, supplier_workspace, analysis,
              operation_id, archive, destination, flow_delivery=None):
    args = ["configure", "--template", component / "WORKFLOW_SUPPLIER_EXAMPLE.json",
            "--source-csv", sources["pricing"],
            "--related-csv", "catalog=" + str(sources["catalogue"]),
            "--source-metadata", sources["metadata"],
            "--related-metadata", "catalog=" + str(sources["metadata"]),
            "--supplier-component", component.parents[3] / "products/conapi/supplier-report",
            "--supplier-workspace", supplier_workspace,
            "--supplier-table-name", "supplier_feed_accepted",
            "--supplier-pricing", sources["pricing"],
            "--supplier-catalogue", sources["catalogue"],
            "--supplier-metadata", sources["metadata"],
            "--analysis-workspace", analysis,
            "--operation-id", operation_id,
            "--source-archive", archive,
            "--output", destination]
    if flow_delivery:
        args += ["--flow-delivery", flow_delivery]
    run_cli(component, project, destination.stem + "-configure", *args)
    return read(destination)


def original(input, component, project, Workflow, NativeWorkflowAdapter):
    source = component / "sources/elite-digital-20261012"
    originals = {}
    for name, (size, digest) in SOURCE.items():
        path = source / name
        observed = identity(path)
        if observed["bytes"] != size or observed["sha256"] != digest:
            raise ValueError("The selected complete original source changed: " + name)
        originals[name] = observed
    for name, count in (("published-pricing.csv", 23), ("services-catalogue.csv", 29)):
        with (source / name).open(encoding="utf-8", newline="") as stream:
            parsed = list(csv.DictReader(stream))
        if len(parsed) != count:
            raise ValueError("The original CSV record count differs: " + name)
    save(project / "original-source-family.json", originals, original=True)
    cfg_path = project / "supplier-configuration.json"
    cfg = configure(component, project,
        sources={"pricing": source / "published-pricing.csv",
                 "catalogue": source / "services-catalogue.csv",
                 "metadata": source / "datapackage.json"},
        supplier_workspace=component / "examples/published-pricing-intake.workspace.json",
        analysis=input["analysis"], operation_id=input["analysisOperationId"],
        archive=input["sourceArchive"], destination=cfg_path,
        flow_delivery=input.get("flowDelivery"))
    wri_cfg_path = project / "wri-configuration.json"
    run_cli(component, project, "configure-original-wri",
        "configure", "--template", component / "WORKFLOW_EXAMPLE.json",
        "--source-handover", input["wriHandover"],
        "--source-archive", input["sourceArchive"],
        "--analysis-workspace", input["analysis"],
        "--operation-id", input["analysisOperationId"], "--output", wri_cfg_path)
    wri_cfg = read(wri_cfg_path)
    a = save(project / "supplier-request-a.json", request(A, "month"), original=True)
    c = save(project / "supplier-request-c.json", request(C, "free", A), original=True)
    b = {"schema": "stellar-forge.source-workflow-request.v1", "requestId": B,
         "correlationId": CORRELATION, "profile": "wri-geothermal",
         "parameters": {"country": "USA", "minimumCapacityMw": 0}}
    if not isinstance(wri_cfg.get("profile"), str) or not wri_cfg["profile"]:
        raise ValueError("Select the complete original WRI profile.")
    b["profile"] = wri_cfg["profile"]
    save(project / "wri-request-b.json", b, original=True)
    completed_path = project / "original-programme-result.json"
    if completed_path.exists():
        retained = read(completed_path)
        if retained.get("state") != "ORIGINAL_PROGRAMME_COMPLETE":
            raise ValueError("The retained original programme result is incomplete.")
        with Workflow(input["workflow"]) as operation:
            for selected, wanted, configuration, key in (
                (A, a, cfg, "original"), (B, b, wri_cfg, "wri"), (C, c, cfg, "continued")
            ):
                current = operation.run(selected, configuration)
                require_result(current, supplier=selected != B)
                actual = operation.status(selected, history=True)
                if actual["request"] != wanted or any(
                    actual[name] != retained[key][name] for name in ("deliveryId", "resultSha256")
                ):
                    raise ValueError("The completed original request or delivery changed: " + selected)
            # Reopening a completed programme reads the same native result.
            # It does not submit the business requests again or append redelivery events.
            emit("conapi_original_programme_reopened", requests=[A, B, C],
                 delivery_id=retained["original"]["deliveryId"])
            return retained
    with Workflow(input["workflow"]) as operation:
        accept_retained(operation, a)
        first = operation.run(A, cfg)
        require_result(first, supplier=True)
        original_identity = {key: first[key] for key in ("deliveryId", "resultSha256")}
        save(project / "supplier-a-original.json", operation.status(A, history=True))
        emit("conapi_original_supplier_complete", request_id=A,
             delivery=original_identity, queries=6, pricing_rows=23, catalogue_rows=29)
        accept_retained(operation, c)
        paused = project / "supplier-c-prepared-continuation.json"
        if not paused.exists():
            class PreparedContinuation(RuntimeError):
                pass
            observations = []
            def adapter_factory(configuration, *, workspace, progress):
                def actual(event):
                    progress(event)
                    if event.get("phase") == "PREPARE" and event.get("status") == "COMPLETE":
                        observations.append(event)
                        raise PreparedContinuation("Continue the original supplier after the complete WRI source.")
                return NativeWorkflowAdapter(configuration, workspace=workspace, progress=actual)
            try:
                returned = operation.run(C, cfg, adapter_factory=adapter_factory)
                require_result(returned, supplier=True)
                save(paused, {"alreadyCompleted": True, "request": operation.status(C, history=True)})
            except PreparedContinuation:
                save(paused, {"nativePrepare": observations, "request": operation.status(C, history=True)})
        accept_retained(operation, b)
        wri = operation.run(B, wri_cfg)
        require_result(wri)
        save(project / "wri-b-complete.json", operation.status(B, history=True))
        continued = operation.run(C, cfg)
        require_result(continued, supplier=True)
        save(project / "supplier-c-complete.json", operation.status(C, history=True))
        replay = operation.run(A, cfg)
        if any(replay[key] != expected for key, expected in original_identity.items()):
            raise RuntimeError("The original monthly delivery changed after the WRI and free-price successor.")
        save(project / "supplier-a-replayed.json", operation.status(A, history=True))
        # Every archive contains the full native result, supplier package, application and workflow.
        exports = {}
        for selected in (A, B, C):
            exports[selected] = operation.export(selected, project / ("Complete_" + selected + ".zip"))
        result = {"schema": SCHEMA, "state": "ORIGINAL_PROGRAMME_COMPLETE",
                  "original": operation.status(A, history=True),
                  "wri": operation.status(B, history=True),
                  "continued": operation.status(C, history=True), "exports": exports,
                  "configuration": str(cfg_path), "source": originals,
                  "analysisOperationId": input["analysisOperationId"]}
        save(project / "original-programme-result.json", result)
        emit("conapi_original_programme_complete", requests=[A, B, C],
             deliveries={key: value for key, value in original_identity.items()})
        return result



def final_exports(input, project, Workflow):
    result = read(project / "original-programme-result.json")
    with Workflow(input["workflow"]) as operation:
        exports = {}
        # Publication and receipt events can follow the first complete export.
        # Use a retained final edition filename; the earlier edition remains intact.
        identity_file = project / "final-export-selection.json"
        prior = read(identity_file) if identity_file.exists() else None
        histories = {selected: operation.status(selected, history=True) for selected in (A, B, C)}
        selection_state = {key: {field: value.get(field) for field in
            ("requestId", "runId", "deliveryId", "resultSha256", "status", "request", "result", "publications")}
            | {"history": [event for event in value["history"]
                           if event["kind"] != "WORKSPACE_EXPORTED"]}
            for key, value in histories.items()}
        semantic = hashlib.sha256(json.dumps(selection_state, ensure_ascii=False, sort_keys=True,
                                            separators=(",", ":")).encode()).hexdigest()
        if prior and prior.get("historySha256") == semantic:
            selection = prior
        else:
            sequence = 1 if prior is None else int(prior["sequence"]) + 1
            selection = {"sequence": sequence, "historySha256": semantic,
                         "requests": list(histories), "createdAt": time.time()}
            save(identity_file, selection)
        for selected in (A, B, C):
            destination = project / ("Final_" + selected + "_edition_" +
                                     str(selection["sequence"]).zfill(4) + ".zip")
            exports[selected] = operation.export(selected, destination)
        earlier = result.setdefault("earlierExports", [])
        if result["exports"] not in earlier:
            earlier.append(result["exports"])
        result["exports"] = exports
        result["original"] = operation.status(A, history=True)
        result["wri"] = operation.status(B, history=True)
        result["continued"] = operation.status(C, history=True)
        result["finalExportSelection"] = selection
        save(project / "original-programme-result.json", result)
        emit("conapi_final_complete_projects_exported", requests=[A, B, C],
             sequence=selection["sequence"])
        return result


def receive(input, component, project, Workflow):
    original_result = read(project / "original-programme-result.json")
    exported = original_result["exports"][A]
    selected_archive = exported_archive(exported)
    selected_path = project / "receiving-selection.json"
    expected = {"archive": selected_archive, "destination": input["receivedWorkflow"],
                "analysisDestination": input["receivedAnalysis"],
                "requestId": A, "deliveryId": original_result["original"]["deliveryId"],
                "resultSha256": original_result["original"]["resultSha256"]}
    if selected_path.exists():
        selected = read(selected_path)
        for key in ("destination", "analysisDestination", "requestId", "deliveryId", "resultSha256"):
            if selected[key] != expected[key]:
                raise ValueError("The original receiving identity changed: " + key)
    else:
        selected = save(selected_path, expected, original=True)
    selected_archive = selected["archive"]
    if identity(selected_archive["path"]) != selected_archive:
        raise ValueError("The complete selected receiving archive changed.")
    result = Workflow.receive(selected_archive["path"], selected["destination"],
                              expected_sha256=selected_archive["sha256"],
                              analysis_destination=selected["analysisDestination"])
    require_result(result, supplier=True)
    save(project / "independent-receiving.json", result)
    emit("conapi_independent_project_received", request_id=A,
         delivery_id=result["deliveryId"], result_sha256=result["resultSha256"])
    return result


def receive_current_edition(input, project, Workflow):
    original = read(project / "original-programme-result.json")
    archive = exported_archive(original["exports"][A])
    first_selection = read(project / "receiving-selection.json")
    same_edition = archive["sha256"] == first_selection["archive"]["sha256"]
    destination = (Path(first_selection["destination"]) if same_edition else
                   project / "received-final-editions" / archive["sha256"] / "workflow")
    selection = {"archive": archive, "destination": str(destination), "requestId": A,
                 "deliveryId": original["original"]["deliveryId"],
                 "resultSha256": original["original"]["resultSha256"],
                 "publications": original["original"]["publications"]}
    selection_file = project / "final-edition-receiving" / (archive["sha256"] + ".json")
    save(selection_file, selection, original=True)
    # A later publication edition has its own receiving directory. The original
    # received Analysis, free-pricing successor and saved review remain intact.
    result = Workflow.receive(archive["path"], destination, expected_sha256=archive["sha256"])
    require_result(result, supplier=True)
    if any(result[key] != selection[key] for key in ("requestId", "deliveryId", "resultSha256")):
        raise ValueError("The received final edition changed the original delivery identity.")
    if result["publications"] != selection["publications"]:
        raise ValueError("The final project did not retain the complete publication history.")
    output = {"schema": SCHEMA, "state": "CURRENT_EDITION_RECEIVED",
              "sameOriginalEdition": same_edition, "selection": selection, "result": result}
    save(project / "current-edition-receiving-result.json", output)
    emit("conapi_current_complete_edition_received", request_id=A,
         archive_sha256=archive["sha256"], directory=str(destination),
         same_original_edition=same_edition)
    return output


def successor(input, component, project, Workflow):
    workflow = Path(input["receivedWorkflow"])
    supplier = workflow / "received/delivery/supplier"
    delivered = workflow / "received/application"
    archives = [path for path in delivered.iterdir() if path.is_file()]
    if len(archives) != 1:
        raise ValueError("The received project must identify its single complete installed source archive.")
    configuration_path = project / "received-successor-configuration.json"
    cfg = configure(component, project,
        sources={"pricing": supplier / "coverage-pricing-source.csv",
                 "catalogue": supplier / "coverage-catalogue-source.csv",
                 "metadata": supplier / "coverage-publisher-metadata.json"},
        supplier_workspace=supplier / "original-supplier-workspace.json",
        analysis=input["receivedAnalysis"], operation_id=input["analysisOperationId"],
        archive=archives[0], destination=configuration_path,
        flow_delivery=input.get("receivingFlowDelivery"))
    incoming = save(project / "received-successor-request.json",
                    request(SUCCESSOR, "free", A), original=True)
    with Workflow(workflow) as operation:
        original_state = operation.status(A, history=True)
        original_identity = {k: original_state[k] for k in ("deliveryId", "resultSha256")}
        completed_path = project / "received-successor-result.json"
        if completed_path.exists():
            retained = read(completed_path)
            if retained.get("state") != "RECEIVED_SUCCESSOR_COMPLETE":
                raise ValueError("The retained received successor is incomplete.")
            current = operation.run(SUCCESSOR, cfg)
            require_result(current, supplier=True)
            actual = operation.status(SUCCESSOR, history=True)
            if actual["request"] != incoming or any(
                actual[key] != retained["successor"][key] for key in ("deliveryId", "resultSha256")
            ) or any(original_state[key] != retained["original"][key] for key in original_identity):
                raise ValueError("The original received successor identity changed.")
            for selected in retained["exports"].values():
                exported_archive(selected)
            emit("conapi_received_successor_reopened", request_id=SUCCESSOR,
                 delivery_id=actual["deliveryId"])
            return retained
        accept_retained(operation, incoming)
        result = operation.run(SUCCESSOR, cfg)
        require_result(result, supplier=True)
        replay = operation.status(A, history=True)
        if any(replay[k] != v for k, v in original_identity.items()):
            raise ValueError("The original received delivery identity changed.")
        exports = {
            A: operation.export(A, project / "Complete_Received_Original_Supplier_Project.zip"),
            SUCCESSOR: operation.export(SUCCESSOR, project / "Complete_Received_Free_Pricing_Successor.zip"),
        }
        output = {"schema": SCHEMA, "state": "RECEIVED_SUCCESSOR_COMPLETE",
                  "original": replay, "successor": operation.status(SUCCESSOR, history=True),
                  "configuration": str(configuration_path), "exports": exports,
                  "receivedSupplierDirectory": str(supplier)}
        save(project / "received-successor-result.json", output)
        emit("conapi_received_successor_complete", request_id=SUCCESSOR,
             parent_request_id=A, queries=6, pricing_rows=23, catalogue_rows=29)
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--phase", required=True, choices=["original", "export", "receive", "successor", "receive-current-edition"])
    args = parser.parse_args()
    input = read(args.input)
    component = Path(input["sourceRoot"]) / "stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis"
    project = Path(input["project"])
    project.mkdir(mode=0o700, parents=True, exist_ok=True)
    sys.path.insert(0, str(component))
    from workflow_engine import Workflow
    from workflow_analysis import NativeWorkflowAdapter
    if args.phase == "original":
        return original(input, component, project, Workflow, NativeWorkflowAdapter)
    if args.phase == "export":
        return final_exports(input, project, Workflow)
    if args.phase == "receive":
        return receive(input, component, project, Workflow)
    if args.phase == "receive-current-edition":
        return receive_current_edition(input, project, Workflow)
    return successor(input, component, project, Workflow)


if __name__ == "__main__":
    main()
