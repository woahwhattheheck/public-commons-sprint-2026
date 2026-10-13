#!/usr/bin/env python3
"""Operate the complete typed exchange against the five issued Annex workbooks."""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import tempfile
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import zipfile
import xml.etree.ElementTree as ET

from questionnaire_workspace import Workspace, receive_project
from workbook_exchange import semantic_workbook, sha256, ExchangeError
from workbooks import read_xlsx, range_cells, cell_parts

ANNEX_SHA = "f31ec3fef4ee808ada65afb66cfbf67114c7be8016ca6307bf664c56bffcab8e"
PREFIX = "ATSSC_Original_Annexes/"
N = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def save_json(path, value):
    raw = (json.dumps(value, ensure_ascii=False, indent=2)+"\n").encode()
    if path.exists():
        if path.read_bytes() != raw:
            raise ExchangeError("OUTPUT_IDENTITY", "An existing source artifact differs from this same native operation", str(path))
        return {"path": str(path), "bytes": len(raw), "sha256": sha256(raw)}
    fd = os.open(path, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    return {"path": str(path), "bytes": len(raw), "sha256": sha256(raw)}


def save_progress(path, value):
    raw = (json.dumps(value, ensure_ascii=False, indent=2)+"\n").encode()
    fd, staged = tempfile.mkstemp(prefix=".exchange-progress-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(staged, 0o600)
        os.replace(staged, path)
    finally:
        Path(staged).unlink(missing_ok=True)


def same_operation(workspace, method, params):
    mutations = {"import_workbook", "exchange_export", "exchange_export_answers", "create_questionnaire",
                 "save_definition", "publish", "invite", "submit_revision", "review_revision", "create_report"}
    if method in mutations:
        identity = sha256(json.dumps({"method": method, "params": params}, sort_keys=True, separators=(",", ":")).encode())
        params = {**params, "request_id": "original-workbook-exchange-"+identity}
    return workspace.invoke(method, params)


def editable_original_cells(raw, native):
    """Select physical unlocked source blanks for the typed input exercise."""
    import io
    selected = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        styles = ET.fromstring(archive.read("xl/styles.xml")).findall("s:cellXfs/s:xf", N)
        for sheet in native["sheets"]:
            if sheet["state"] != "visible":
                continue
            root = ET.fromstring(archive.read(sheet["member"]))
            excluded = set()
            for merge in root.findall("s:mergeCells/s:mergeCell", N):
                address = merge.get("ref")
                excluded.update(set(range_cells(address))-{address.split(":")[0]})
            for formula in root.findall("s:sheetData/s:row/s:c/s:f", N):
                if formula.get("t") in {"array", "dataTable"} and formula.get("ref"):
                    excluded.update(range_cells(formula.get("ref")))
            for address, cell in sorted(sheet["cells"].items(), key=lambda pair: cell_parts(pair[0])):
                if address in excluded or cell["formula"] is not None or cell["value"] is not None:
                    continue
                style = styles[int(cell["style"] or 0)]
                protection = style.find("s:protection", N)
                if protection is None or protection.get("locked") not in {"0", "false"}:
                    continue
                selected.append({"sheet": sheet["name"], "cell": address, "style": cell["style"]})
                if len(selected) == 4:
                    return selected
    raise ExchangeError("ORIGINAL_INPUTS", "The issued workbook needs four original unlocked blank answer cells for this operation")


def run(annex, output):
    raw_archive = annex.read_bytes()
    if sha256(raw_archive) != ANNEX_SHA:
        raise ExchangeError("ANNEX_SOURCE", "Receive the complete exact published original Annex ZIP")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if any(output.iterdir()) and not (output/"SOURCE.json").exists():
        raise ExchangeError("OUTPUT_IDENTITY", "Continue the original source-owned operation directory")
    workspace = Workspace(output/"workspace")
    case = {"schema": "atssc.workbook-exchange-native.v1",
            "annex_sha256": ANNEX_SHA, "annex_bytes": len(raw_archive),
            "workspace_id": workspace.op_status({})["workspace_id"], "workbooks": [], "state": "running"}
    save_json(output/"SOURCE.json", {"annex_path": str(annex), "sha256": ANNEX_SHA,
        "bytes": len(raw_archive), "application": str(Path(__file__).resolve().parent)})
    try:
        totals = {"cells": 0, "formulas": 0, "errors": 0, "hidden_sheets": 0, "sheets": 0}
        with zipfile.ZipFile(annex) as archive:
            names = [name for name in archive.namelist() if name.startswith(PREFIX+"originals/") and name.endswith(".xlsx")]
            if len(names) != 5:
                raise ExchangeError("ANNEX_SOURCE", "The original Annex set must contain all five issued XLSX workbooks")
            for index, member in enumerate(sorted(names), 1):
                raw, name = archive.read(member), Path(member).name
                original_sha = sha256(raw)
                retained = same_operation(workspace, "import_workbook", {"name": name, "data_base64": base64.b64encode(raw).decode(),
                    "expected_sha256": original_sha})
                downloaded = same_operation(workspace, "exchange_download_original", {"sha256": original_sha})
                if base64.b64decode(downloaded["data_base64"], validate=True) != raw:
                    raise ExchangeError("ORIGINAL_BYTES", "Original download differs from the issued XLSX")
                inspect = same_operation(workspace, "exchange_inspect", {"sha256": original_sha})
                for key in ("cells", "formulas", "errors", "hidden_sheets"):
                    totals[key] += inspect["counts"][key]
                totals["sheets"] += len(inspect["sheets"])
                native = read_xlsx(raw)
                cells = editable_original_cells(raw, native)
                kinds = [("number", "0"), ("text", ""), ("blank", None), ("absent", None)]
                changes = [{**cell, "kind": kind, "value": value} for cell, (kind, value) in zip(cells, kinds)]
                result = same_operation(workspace, "exchange_export", {"sha256": original_sha, "changes": changes})
                successor = base64.b64decode(result["data_base64"], validate=True)
                (output/result["name"]).write_bytes(successor)
                save_json(output/(Path(name).stem+"-exchange.json"), result["metadata"])
                returned = same_operation(workspace, "import_workbook", {"name": result["name"],
                    "data_base64": result["data_base64"], "expected_sha256": result["sha256"]})
                if returned["sha256"] != result["sha256"]:
                    raise ExchangeError("SUCCESSOR_IDENTITY", "Reimported Excel edition identity differs")
                semantics = semantic_workbook(successor, {s: [c["cell"] for c in cells if c["sheet"] == s] for s in {c["sheet"] for c in cells}})
                states = {(s["name"], a): cell for s in semantics["sheets"] for a, cell in s["cells"].items()}
                expected_states = [("number", "0"), ("text", ""), ("blank", None), ("absent", None)]
                for cell, expected in zip(cells, expected_states):
                    state = states[(cell["sheet"], cell["cell"])]
                    if (state["state"], state["value"]) != expected:
                        raise ExchangeError("TYPED_ROUNDTRIP", "Original-format successor lost the selected source type", {"cell": cell, "expected": expected, "actual": state})
                if semantics["counts"]["formulas"] != inspect["counts"]["formulas"] or semantics["counts"]["errors"] != inspect["counts"]["errors"]:
                    raise ExchangeError("FORMULA_PRESERVATION", "An original formula or error cell changed")
                questionnaire = same_operation(workspace, "create_questionnaire", {"name": "Source-cell exchange · "+name})
                questions = [{"id": "source_"+str(i), "label": cell["sheet"]+"!"+cell["cell"],
                    "kind": "number" if i == 0 else "text", "disclosure": "protected",
                    "source": {"workbook_sha256": original_sha, "sheet": cell["sheet"], "cell": cell["cell"]}}
                    for i, cell in enumerate(cells)]
                definition = same_operation(workspace, "save_definition", {"questionnaire_id": questionnaire["questionnaire_id"],
                    "expected_version": 0, "definition": {"title": "Original source-cell exchange", "source_workbooks": [original_sha],
                    "questions": questions, "rules": []}})
                publication = same_operation(workspace, "publish", {"questionnaire_id": questionnaire["questionnaire_id"], "expected_version": definition["version"]})
                invitation = same_operation(workspace, "invite", {"publication_id": publication["publication_id"], "name": "Workbook exchange "+str(index)})
                extraction = same_operation(workspace, "exchange_extract", {"respondent_id": invitation["respondent_id"], "sha256": result["sha256"],
                    "template_sha256": original_sha})
                if not extraction["validation"]["valid"]:
                    raise ExchangeError("EXTRACTION", "Source-cell exchange did not produce a valid native answer edition", extraction["validation"])
                save_json(output/(Path(name).stem+"-extraction.json"), extraction)
                extracted_package = same_operation(workspace, "exchange_extract_package", {
                    "respondent_id": invitation["respondent_id"], "sha256": result["sha256"], "template_sha256": original_sha})
                package_raw = base64.b64decode(extracted_package["data_base64"], validate=True)
                (output/(Path(name).stem+"-internal-extraction.zip")).write_bytes(package_raw)
                with zipfile.ZipFile(io.BytesIO(package_raw)) as received_extraction:
                    extracted_manifest = json.loads(received_extraction.read("manifest.json"))
                    for record in extracted_manifest["files"]:
                        received = received_extraction.read(record["path"])
                        if len(received) != record["bytes"] or sha256(received) != record["sha256"]:
                            raise ExchangeError("EXTRACTION_PACKAGE", "The complete extraction package differs from its original manifest")
                    internal_workbook = read_xlsx(received_extraction.read("Source_Extraction.xlsx"))
                    if internal_workbook["sheetCount"] != 4 or json.loads(received_extraction.read("Source_Extraction.json")) != extraction:
                        raise ExchangeError("EXTRACTION_PACKAGE", "The native Excel extraction and complete source records were not received together")
                revision = same_operation(workspace, "submit_revision", {"respondent_id": invitation["respondent_id"], "expected_version": 0,
                    "workbook_sha256": result["sha256"]})
                reviewed = same_operation(workspace, "review_revision", {"revision_id": revision["revision_id"], "expected_version": revision["number"],
                    "decision": "accept", "note": "Original source-cell typed exchange completed in this native operating case."})
                report = same_operation(workspace, "create_report", {"publication_id": publication["publication_id"]})
                case["workbooks"].append({"name": name, "original": retained, "counts": inspect["counts"], "selected_source_cells": cells,
                    "successor_sha256": result["sha256"], "successor_bytes": result["bytes"], "unchanged_parts": len(result["metadata"]["unchanged_members"]),
                    "questionnaire_id": questionnaire["questionnaire_id"], "publication_id": publication["publication_id"],
                    "respondent_id": invitation["respondent_id"], "revision_id": revision["revision_id"], "review_id": reviewed["review_id"],
                    "report_id": report["report_id"], "extracted_cells": len(extraction["cells"]), "roundtrip": "complete", "internal_extraction": {key: extracted_package[key] for key in ("name", "bytes", "sha256")}})
                save_progress(output/"NATIVE_PROGRESS.json", case)
                print(json.dumps({"phase": "workbook_complete", "name": name, "counts": inspect["counts"], "successor_sha256": result["sha256"]}), flush=True)
        if totals["sheets"] != 79 or totals["cells"] != 71717 or totals["formulas"] != 7661 or totals["hidden_sheets"] != 21:
            raise ExchangeError("SOURCE_TOTALS", "The original workbook totals differ from the received Annex catalogue", totals)
        archive_path = output/"ATSSC_Workbook_Exchange_Project.zip"
        if archive_path.exists():
            archive_raw = archive_path.read_bytes()
            with zipfile.ZipFile(io.BytesIO(archive_raw)) as package:
                manifest = json.loads(package.read("MANIFEST.json"))
                if manifest["workspace_id"] != case["workspace_id"]:
                    raise ExchangeError("PROJECT_IDENTITY", "The saved export belongs to a different workspace")
                for member in manifest["files"]:
                    data = package.read(member["path"])
                    if len(data) != member["bytes"] or sha256(data) != member["sha256"]:
                        raise ExchangeError("PROJECT_IDENTITY", "The saved project archive member differs", member["path"])
            project = {"path": str(archive_path), "bytes": len(archive_raw), "sha256": sha256(archive_raw)}
        else:
            project = same_operation(workspace, "export_project", {"path": str(archive_path)})
        reopened = output/"reopened"
        if reopened.exists():
            with zipfile.ZipFile(project["path"]) as package:
                manifest = json.loads(package.read("MANIFEST.json"))
                for member in manifest["files"]:
                    path = reopened/member["path"]
                    if not path.is_file() or path.is_symlink():
                        raise ExchangeError("RECEIVING_IDENTITY", "The original receiving tree is incomplete", member["path"])
                    data = path.read_bytes()
                    if len(data) != member["bytes"] or sha256(data) != member["sha256"]:
                        raise ExchangeError("RECEIVING_IDENTITY", "The original receiving tree member differs", member["path"])
            received_workspace = Workspace(reopened/"workspace")
            received_id = received_workspace.op_status({})["workspace_id"]
            receiving = {"workspace_id": received_id, "directory": str(reopened), "sha256": project["sha256"], "disposition": "reused_exact_receiving"}
        else:
            receiving = receive_project(project["path"], reopened, project["sha256"])
        if receiving["workspace_id"] != case["workspace_id"]:
            raise ExchangeError("COLD_IDENTITY", "Cold receiving changed the original workspace identity")
        requests = [{"id": row["original"]["sha256"], "method": "exchange_download_original", "params": {"sha256": row["original"]["sha256"]}} for row in case["workbooks"]]
        requests.extend({"id": row["successor_sha256"], "method": "exchange_download_original", "params": {"sha256": row["successor_sha256"]}} for row in case["workbooks"])
        cold = subprocess.run([sys.executable, str(output/"reopened/application/cli.py"), "--workspace", str(output/"reopened/workspace"), "rpc"],
            input="".join(json.dumps(r)+"\n" for r in requests), text=True, capture_output=True, timeout=120, check=True)
        responses = [json.loads(line) for line in cold.stdout.splitlines() if line.strip()]
        if len(responses) != len(requests):
            raise ExchangeError("COLD_RECEIVING", "The cold application returned an incomplete workbook receiving result")
        cold_results = []
        for request, response in zip(requests, responses):
            result = response.get("result")
            if response.get("id") != request["id"] or not result:
                raise ExchangeError("COLD_RECEIVING", "The cold application could not reopen its original workbook", response)
            raw = base64.b64decode(result["data_base64"], validate=True)
            if sha256(raw) != request["id"] or len(raw) != result["bytes"]:
                raise ExchangeError("COLD_BYTES", "Cold-received workbook bytes differ")
            cold_results.append({key: result[key] for key in ("name", "bytes", "sha256")})
        case.update({"state": "complete", "totals": totals, "project": {key: project[key] for key in ("path", "bytes", "sha256")},
                     "cold_receiving": receiving, "cold_original_and_successor_downloads": cold_results})
    except BaseException as error:
        case["state"] = "failed"
        case["error"] = {"type": type(error).__name__, "code": getattr(error, "code", None), "message": str(error), "detail": getattr(error, "detail", None)}
        (output/"native-error.txt").write_text(traceback.format_exc())
        save_progress(output/"NATIVE_RESULT.json", case)
        raise
    save_progress(output/"NATIVE_RESULT.json", case)
    print(json.dumps({"state": case["state"], "workspace_id": case["workspace_id"], "totals": case["totals"], "project": case["project"]}), flush=True)
    return case


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annex", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    run(args.annex.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
