#!/usr/bin/env python3
"""Operate complete Directory worksheets, authored returned files and cold receiving.

Uses the completed original e0ec/c00 workspace on a distinct private copy.
Customer proposals in this course are explicitly authored local examples.
No publisher request, external customer response or production edit is inferred.
"""
from __future__ import annotations
import argparse
import copy
import fcntl
import hashlib
import os
from pathlib import Path
import sys
import zipfile
from directory_runtime import source, fhir, original_workspace, now
from directory_workspace import Workspace
import directory_schema
from operate_corrections import (
    Operation as CorrectionOperation, exact_reference, complete_record_hashes,
    source_identity as correction_source_identity)
from operate_operating_plans import private_dir, info, read_json, write_once, require, matches_file

HERE = Path(__file__).resolve().parent
OPERATION = "SCF-DIRECTORY-WORKSHEETS-450E-20261013"
ACTOR = "450E authored Directory worksheet receiving"
RESULT_SCHEMA = "stellar-forge.directory-worksheets-operated.v1"
WORKSHEET_SCHEMA = "stellar-forge.directory-correction-worksheet.v1"
RETURN_SCHEMA = "stellar-forge.directory-correction-worksheet-return.v1"
NATIVE_SHA = "0b0e08808ae3c1c62c512271dd6269cee2219b792d63d720ef67b8411e775fe0"
ARCHIVE_SHA = "c00ad722ed19986a513e113b3a69c82cfae2aa4bdcddc6b7056187a3b1578064"
ORIGINAL_UUID = "2c51f522-4852-463b-bdc0-59389d7bae83"
WORKSHEET_KINDS = (
    "correctionWorksheets", "correctionWorksheetImports",
    "correctionWorksheetReturns", "correctionWorksheetReviews")
PROBES = {
    "_worksheet_authored_number": "1.20",
    "_worksheet_authored_string": '"1.20"',
    "_worksheet_authored_false": "false",
    "_worksheet_authored_empty": '""',
}

def source_identity():
    result = correction_source_identity()
    for name in ("directory_correction_worksheets.py",
            "directory_correction_worksheets_schema.py",
            "directory-correction-worksheets-schema.json",
            "operate_correction_worksheets.py",
            "public/directory-correction-worksheet-customer.html",
            "public/directory-correction-worksheet-customer.css",
            "public/directory-correction-worksheet-customer.js"):
        path = HERE / name
        raw = path.read_bytes()
        result.append({"file": str(path), "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlobSha": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
    return result

def plain_copy(value):
    return source.json_value(source.jbytes(value))

def lexical_copy(value):
    return source.json_value(source.lexical_json(value), lexical=True)

def pointer(key):
    return "/" + key.replace("~", "~0").replace("/", "~1")

class Operation(CorrectionOperation):
    def __init__(self, args):
        os.umask(0o077)
        self.args = args
        self.root = private_dir(args.out)
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.receiving_path = Path(args.receiving).expanduser().absolute()
        descriptor = info(self.receiving_path)
        require(descriptor["sha256"] == args.receiving_sha256 == NATIVE_SHA
            and descriptor["bytes"] == 103569, "Receive the unchanged complete original Directory result")
        self.native = read_json(self.receiving_path)
        require(self.native.get("schema") == "stellar-forge.human-services-directory-operated.v1"
            and self.native.get("workspaceId") == ORIGINAL_UUID, "Select the actual completed original Directory workspace")
        self.archive = Path(args.archive).expanduser().absolute() if args.archive else None
        if self.archive:
            require(matches_file(info(self.archive), self.native["workspacePacket"])
                and info(self.archive)["sha256"] == ARCHIVE_SHA, "Use the native result's exact complete editable packet")
        self.path = self.root / "WORKSHEETS_JOURNEY.json"
        inputs = {"operation": OPERATION, "workspace": str(self.workspace), "workspaceId": ORIGINAL_UUID,
            "receiving": descriptor, "archive": info(self.archive) if self.archive else None, "source": source_identity()}
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["inputs"] == inputs, "Resume the same worksheet source, original inputs and operation paths")
        else:
            self.journal = {"schema": "stellar-forge.directory-worksheets-journey.v1",
                "inputs": inputs, "createdAt": now(), "steps": {}, "times": {}, "files": {}, "failures": []}
            self.save()
        for name in ("records", "exports", "worksheets", "returns", "evidence"):
            private_dir(self.root / name)
        self.copy_file("original-native-result", self.receiving_path, descriptor, "Original_Directory_Receiving.json")
        write_once(self.root / "WORKSHEETS_SOURCE.json", inputs["source"])

    def emit(self, stage, **value):
        print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

    def step(self, key, request, call):
        digest = source.sha(source.jbytes(request))
        old = self.journal["steps"].get(key)
        if old is not None:
            require(old["requestSha256"] == digest and old["request"] == request,
                "Preserve the exact original prepared worksheet request: " + key)
            if old["state"] == "complete":
                return old["result"]
        else:
            self.journal["steps"][key] = {"state": "prepared", "request": request,
                "requestSha256": digest, "preparedAt": self.at(key)}
            self.save()
        result = call()
        self.journal["steps"][key].update(state="complete", result=result, completedAt=now())
        self.save()
        self.emit("DIRECTORY_WORKSHEET_NATIVE_STEP", key=key,
            recordId=result.get("id") if isinstance(result, dict) else None)
        return result

    def rows(self, ws, kind, ident):
        result, offset, total = [], 0, None
        while True:
            page = ws.directory_correction_worksheet_rows(kind, ident, offset=offset, limit=1)
            require(page["offset"] == offset and (total is None or total == page["total"]),
                "Keep the same complete worksheet page sequence")
            total = page["total"]
            require(isinstance(page["rows"], list), "Receive complete original row bodies")
            result.extend(page["rows"])
            next_offset = page["nextOffset"]
            if next_offset is None:
                require(len(result) == total, "The complete worksheet page sequence is incomplete")
                return result
            require(next_offset == offset + len(page["rows"]) and next_offset > offset,
                "Advance by the original returned worksheet page offset")
            offset = next_offset

    def worksheet_record(self, ws, kind, record):
        write_once(self.root / "records" / (kind + "-" + record["id"] + ".json"), record)
        for name, descriptor in record.get("files", {}).items():
            path, observed = ws.directory_correction_worksheet_file(kind, record["id"], name)
            require(matches_file(info(path), descriptor) and matches_file(observed, descriptor),
                "The complete worksheet file changed: " + kind + "/" + name)
            self.copy_file(kind + "-" + record["id"] + "-" + name, path, descriptor,
                "worksheets/" + record["id"] + "/" + name + ".bin")

    def worksheet_document(self, ws, record):
        document = ws.directory_correction_worksheet_document(record["id"])
        require(document["schema"] == WORKSHEET_SCHEMA and document["worksheetId"] == record["id"]
            and document["workspaceId"] == ORIGINAL_UUID and document["editionId"] == record["editionId"],
            "The complete worksheet document changed its original identity")
        selected = {tuple(ref[name] for name in ("sourceId", "recordId")): ref for ref in record["rows"]}
        require(len(document["rows"]) == len(selected)
            and len({r["rowKey"] for r in document["rows"]}) == len(document["rows"]),
            "The worksheet must retain every selected original row exactly once")
        for row in document["rows"]:
            ref = row["ref"]
            require(selected.get((ref["sourceId"], ref["recordId"])) == ref,
                "The editable worksheet changed an original selected reference")
            original = ws.directory_edition_row(record["editionId"], ref["sourceId"], ref["recordId"])
            require(exact_reference(original) == ref and row["memberName"] == original["memberName"]
                and row["pointer"] == original["pointer"] and row["table"] == original["table"],
                "The editable worksheet changed source member or native row provenance")
            if "cells" in original:
                require(row["representation"] == "csv" and row["cells"] == original["cells"]
                    and row["headers"] == original["headers"], "Keep complete physical CSV cells and ordered headers")
            else:
                require(row["representation"] == "json"
                    and row["valueJson"] == original["json"],
                    "Keep the complete lexical original JSON object")
        write_once(self.root / "worksheets" / (record["id"] + "-document.json"), document)
        return document

    def package(self, ws, worksheet, key, replay):
        request = {"worksheetId": worksheet["id"], "actor": ACTOR,
            "label": key + " complete editable customer worksheet",
            "note": "Complete selected original rows and a portable customer editor; no external customer return is inferred."}
        exported = self.step(key + "-customer-package", request,
            lambda: ws.export_directory_correction_worksheet(request))
        require(exported["kind"] == "correction-worksheet" and exported["recordId"] == worksheet["id"],
            "Export the selected complete original worksheet")
        path = ws._directory_file_path(exported["file"])
        descriptor = self.copy_file(key + "-customer-package", path, exported["file"],
            "exports/" + exported["name"])
        document = self.worksheet_document(ws, worksheet)
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names))
                and {"worksheet.json", "customer.html", "README.md", "manifest.json", "records.json"} <= set(names),
                "The whole customer package lacks its original editable document, editor or complete retained source")
            require(source.json_value(archive.read("worksheet.json")) == document,
                "The customer package changed the original worksheet")
            manifest = source.json_value(archive.read("manifest.json"))
            declarations = manifest["members"]
            require(isinstance(declarations, list)
                and len({item["name"] for item in declarations}) == len(declarations)
                and set(names) == {item["name"] for item in declarations} | {"manifest.json"},
                "The customer package must declare every complete member exactly once")
            checked = []
            for expected in declarations:
                name = expected["name"]
                require(not archive.getinfo(name).is_dir(), "Receive original regular customer members")
                digest, size = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    while block := stream.read(65536):
                        digest.update(block); size += len(block)
                require(size == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                    "A complete original customer package member changed")
                checked.append({"name": name, "bytes": size, "sha256": digest.hexdigest()})
            require(b"{{WORKSHEET_JSON}}" not in archive.read("customer.html")
                and b"{{CUSTOMER_CSS}}" not in archive.read("customer.html")
                and b"{{CUSTOMER_JS}}" not in archive.read("customer.html"),
                "The customer editor still contains an unbound original template marker")
            records = source.json_value(archive.read("records.json"))
            require(records == {"workspaceId": ORIGINAL_UUID, "worksheet": worksheet,
                "sources": [ws.directory_source(ident)
                    for ident in sorted({ref["sourceId"] for ref in worksheet["rows"]})]},
                "The complete customer package changed its original selected source records")
        proof = write_once(self.root / "evidence" / (key + "-customer-package.json"),
            {"worksheetId": worksheet["id"], "exportId": exported["id"], "file": descriptor,
             "members": checked, "allOriginalRowsEqual": True})
        replay.append({"family": "worksheet", "key": key + "-export", "action": "export",
            "input": request, "expectedRecordId": exported["id"]})
        return {"record": exported, "file": descriptor, "verification": proof, "document": document}

    def select_original_rows(self, ws, selected):
        csv_source = selected["original-csv"]["record"]["id"]
        json_source = selected["organization_full.json"]["record"]["id"]
        csv_rows = sorted(self.source_rows(ws, csv_source),
            key=lambda row: (row["memberName"], row["pointer"], row["recordId"]))
        csv = next((row for row in csv_rows if row["table"] == "service" and "cells" in row
            and row["headers"].count("description") == 1 and row["headers"].count("name") == 1
            and len(row["cells"]) > max(row["headers"].index("description"), row["headers"].index("name"))), None)
        nested = sorted((row for row in self.source_rows(ws, json_source) if "cells" not in row
            and row.get("parentRecordId") and row.get("rawRange") is None
            and isinstance(row.get("data"), dict) and type(row["data"].get("name")) is str
            and type(row["data"].get("description")) is str),
            key=lambda row: (row["memberName"], row["pointer"], row["recordId"]))
        require(csv is not None and nested, "Select the actual published CSV service and nested original JSON row")
        # The published CSV source can contain only its actual one service
        # row. Choose any additional examples from the retained sources, never
        # invent more physical rows or require another source acquisition.
        chosen = {"csv": csv, "json": nested[0]}
        from directory_corrections_schema import tokens
        def overlaps(candidate, existing):
            if candidate["sourceId"] != existing["sourceId"] or candidate["memberName"] != existing["memberName"]:
                return False
            left, right = tokens(candidate["pointer"]), tokens(existing["pointer"])
            return left[:len(right)] == right or right[:len(left)] == left
        candidates = csv_rows + sorted(self.source_rows(ws, json_source),
            key=lambda row: (row["memberName"], row["pointer"], row["recordId"]))
        for name in ("unchanged", "omitted"):
            extra = next((r for r in candidates if r.get("protocol") == "hsds"
                and not any(overlaps(r, old) for old in chosen.values())), None)
            if extra is not None:
                chosen[name] = extra
        return chosen

    def prepare_worksheet(self, ws, edition, rows, predecessor, key, replay):
        request = {"label": key + " complete original Directory worksheet", "actor": ACTOR,
            "editionId": edition["id"], "predecessorId": predecessor,
            "rows": [exact_reference(row) for row in rows],
            "note": "Selected complete original HSDS rows. Returned proposals remain separate until explicit review and correction acceptance."}
        record = self.step(key + "-prepare-worksheet", request,
            lambda: ws.prepare_directory_correction_worksheet(request))
        require(record["editionId"] == edition["id"] and record["rows"] == request["rows"],
            "The worksheet changed its exact selected original rows")
        self.worksheet_record(ws, "correctionWorksheets", record)
        document = self.worksheet_document(ws, record)
        pages = self.rows(ws, "correctionWorksheets", record["id"])
        require(len(pages) == len(rows), "Receive all selected worksheet rows through the native original pages")
        replay.append({"family": "worksheet", "key": key + "-prepare", "action": "prepare",
            "input": request, "expectedRecordId": record["id"]})
        return record, document

    def candidate(self, row, *, cells=None, value=None, reason):
        if row["representation"] == "csv":
            return {"rowKey": row["rowKey"], "representation": "csv",
                "cells": list(row["cells"] if cells is None else cells), "reason": reason}
        return {"rowKey": row["rowKey"], "representation": "json",
            "valueJson": row["valueJson"] if value is None else source.lexical_json(value), "reason": reason}

    def authored_return(self, document, original_rows, key, successor=False):
        by_ref = {(r["ref"]["sourceId"], r["ref"]["recordId"]): r for r in document["rows"]}
        selected = {name: by_ref[(row["sourceId"], row["recordId"])]
            for name, row in original_rows.items()}
        json_row = selected["json"]
        value = source.json_value(json_row["valueJson"], lexical=True)
        if successor:
            require("description" in value and value["description"] is None,
                "The second customer worksheet must contain the actual previously accepted explicit null")
            del value["description"]
            candidates = [self.candidate(json_row, value=value,
                reason="Explicitly remove the previously accepted null field in this authored successor."),
                self.candidate(selected["csv"],
                    reason="Return the complete accepted CSV row unchanged; preserve its earlier reviewed description.")]
        else:
            require(all(name not in value for name in PROBES),
                "Authored comparison illustration names must not replace a published source field")
            value["name"] += " — proposed name kept original after review"
            value["description"] = None
            for name, lexical in PROBES.items():
                value[name] = source.json_value(lexical, lexical=True)
            csv_row = selected["csv"]
            cells = list(csv_row["cells"])
            cells[csv_row["headers"].index("description")] = (
                'Authored worksheet description: review "quoted" words, commas and full lines.\n'
                "Second line: café. The original publisher value remains in the frozen predecessor.")
            cells[csv_row["headers"].index("name")] += " — proposed name kept original after review"
            candidates = [self.candidate(csv_row, cells=cells,
                reason="Propose a full physical row with an explicit multiline description and a separate name change."),
                self.candidate(json_row, value=value,
                    reason="Propose explicit null and name changes plus clearly authored typed comparison illustrations; each needs its own operator decision."),
                ]
            if "unchanged" in selected:
                candidates.append(self.candidate(selected["unchanged"],
                    reason="Return this complete selected original row unchanged; do not infer a correction."))
            # A selected omitted row is absent from candidates. Its original
            # bytes remain in the worksheet and no deletion is proposed.
        document_return = {"schema": RETURN_SCHEMA, "workspaceId": ORIGINAL_UUID,
            "worksheetId": document["worksheetId"], "editionId": document["editionId"],
            "returnedBy": "450E authored customer-role receiving exercise", "returnedAt": self.at(key + "-returned"),
            "note": "Actual locally authored complete returned file. No external customer response is asserted.",
            "candidates": candidates}
        path = self.root / "returns" / (key + "-Authored_Directory_Worksheet_Return.json")
        descriptor = write_once(path, document_return)
        require(info(path)["sha256"] == descriptor["sha256"], "Retain the exact complete authored customer return")
        return path, descriptor, document_return, selected

    def receive_return(self, ws, worksheet, returned, key, replay):
        path, descriptor, document, selected = returned
        request = {"worksheetId": worksheet["id"], "actor": ACTOR, "filename": path.name,
            "expectedSha256": descriptor["sha256"], "expectedBytes": descriptor["bytes"],
            "note": "Receive the exact complete authored customer file through the original saved import metadata."}
        imported = self.step(key + "-save-import", request,
            lambda: ws.save_directory_correction_worksheet_import(request))
        self.worksheet_record(ws, "correctionWorksheetImports", imported)
        result = self.step(key + "-receive-return",
            {"importId": imported["id"], "file": descriptor},
            lambda: ws.import_directory_correction_worksheet_return(imported["id"], path))
        require(result["worksheetId"] == worksheet["id"] and result["importId"] == imported["id"]
            and result["editionId"] == worksheet["editionId"]
            and matches_file(result["files"]["original"], descriptor),
            "The original retained returned-file identity changed")
        self.worksheet_record(ws, "correctionWorksheetReturns", result)
        changes = self.rows(ws, "correctionWorksheetReturns", result["id"])
        require(len(changes) == result["summary"]["changes"]
            and len({r["changeId"] for r in changes}) == len(changes),
            "The complete returned difference set is missing or repeats a native change")
        for name, expected in (("worksheetId", worksheet["id"]), ("editionId", worksheet["editionId"])):
            require(document[name] == expected, "Keep the complete returned document binding")
        replay.extend([
            {"family": "worksheet", "key": key + "-import", "action": "import",
                "input": request, "expectedRecordId": imported["id"]},
            {"family": "worksheet", "key": key + "-receive", "action": "receive",
                "importId": imported["id"], "file": descriptor, "expectedRecordId": result["id"]}])
        write_once(self.root / "evidence" / (key + "-complete-return-changes.json"), changes)
        return imported, result, changes

    def review_return(self, ws, worksheet, result, changes, selected, key, replay, successor=False):
        csv_key, json_key = selected["csv"]["rowKey"], selected["json"]["rowKey"]
        desc_column = selected["csv"]["headers"].index("description")
        choices, accepted_ids = [], []
        for change in changes:
            accept = ((change["rowKey"] == json_key and change.get("pointer") == "/description")
                or (not successor and change["rowKey"] == csv_key and change.get("column") == desc_column))
            if accept: accepted_ids.append(change["changeId"])
            choices.append({"changeId": change["changeId"], "decision": "accept" if accept else "keep-original",
                "reason": ("Explicitly accept this authored description change against the retained original worksheet."
                    if accept else "Keep the complete published value; retain this proposed name/type illustration for review history.")})
        require(len(accepted_ids) == (1 if successor else 2),
            "Accept only the actual intended description changes, not a label-based or invented row match")
        if not successor:
            expected_unchanged = int("unchanged" in selected)
            expected_omitted = int("omitted" in selected)
            require(result["summary"]["rows"] == len(selected)
                and result["summary"]["proposedRows"] == 2 + expected_unchanged
                and result["summary"]["omittedRows"] == expected_omitted
                and result["summary"]["unchangedRows"] == expected_unchanged
                and result["summary"]["changedRows"] == 2, "Distinguish actual omitted, unchanged and changed returned rows")
            for name, expected_lexical in PROBES.items():
                found = [r for r in changes if r["rowKey"] == json_key and r.get("pointer") == pointer(name)]
                require(len(found) == 1 and found[0]["before"] == {"present": False}
                    and found[0]["after"]["present"] is True
                    and found[0]["after"]["valueJson"] == expected_lexical,
                    "Preserve typed candidate values and exact field absence in the full comparison")
            null_change = next(r for r in changes if r["rowKey"] == json_key and r.get("pointer") == "/description")
            require(null_change["before"]["present"] is True and null_change["after"]["present"] is True
                and null_change["after"]["valueJson"] == "null", "Explicit null must remain a present value")
        else:
            require(result["summary"]["omittedRows"] == 0 and result["summary"]["unchangedRows"] == 1,
                "The accepted CSV row must remain a complete unchanged proposal in the successor")
            change = next(r for r in changes if r["changeId"] == accepted_ids[0])
            require(change["before"]["present"] is True and change["before"]["valueJson"] == "null"
                and change["after"] == {"present": False}, "Removing null must retain presence-to-absence semantics")
        request = {"returnId": result["id"], "label": key + " explicit complete customer return review",
            "actor": ACTOR, "choices": choices,
            "note": "Every actual difference receives one explicit decision. Correction preview and acceptance remain separate native operations."}
        reviewed = self.step(key + "-review-return", request,
            lambda: ws.review_directory_correction_worksheet_return(request))
        require(reviewed["outcome"] == "plan-prepared" and reviewed["planId"] is not None
            and reviewed["summary"]["changes"] == len(changes)
            and reviewed["summary"]["accepted"] == len(accepted_ids)
            and reviewed["summary"]["keptOriginal"] == len(changes) - len(accepted_ids),
            "The review must prepare exactly the selected original correction changes")
        self.worksheet_record(ws, "correctionWorksheetReviews", reviewed)
        reviewed_rows = self.rows(ws, "correctionWorksheetReviews", reviewed["id"])
        require(len(reviewed_rows) == len(changes)
            and {r["changeId"] for r in reviewed_rows} == {r["changeId"] for r in changes},
            "The complete reviewed difference history must retain every original proposal")
        plan = ws.directory_record("correctionPlans", reviewed["planId"])
        plan_input = source.json_value(ws._directory_file_path(plan["files"]["input"]).read_bytes())
        accepted_edits = [r["edit"] for r in changes if r["changeId"] in accepted_ids]
        # Operator reasons become the existing correction edits' authored reasons;
        # every other exact edit field remains the original proposed edit.
        strip_reason = lambda edit: {k: v for k, v in edit.items() if k != "reason"}
        require([strip_reason(e) for e in plan_input["edits"]] == [strip_reason(e) for e in accepted_edits]
            and plan_input["editionId"] == worksheet["editionId"],
            "Generated correction plan must contain only explicitly accepted original edits")
        replay.append({"family": "worksheet", "key": key + "-review", "action": "review",
            "input": request, "expectedRecordId": reviewed["id"]})
        return reviewed, plan_input, reviewed_rows

    def run_round(self, ws, edition, original_rows, predecessor, key, replay, successor=False):
        worksheet, document = self.prepare_worksheet(ws, edition, list(original_rows.values()),
            predecessor, key, replay)
        package = self.package(ws, worksheet, key, replay)
        returned = self.authored_return(document, original_rows, key, successor)
        imported, result, changes = self.receive_return(ws, worksheet, returned, key, replay)
        reviewed, plan_input, decisions = self.review_return(ws, worksheet, result, changes,
            returned[3], key, replay, successor)
        correction_replay = []
        changed_rows = [original_rows["json"]] if successor else [original_rows["csv"], original_rows["json"]]
        accepted = self.accepted_case(ws, key + "-accepted", plan_input, changed_rows, correction_replay)
        require(accepted["planId"] == reviewed["planId"], "Preview and accept the exact plan prepared by this original return review")
        replay.extend({**r, "family": "correction"} for r in correction_replay)
        return {"worksheetId": worksheet["id"], "importId": imported["id"], "returnId": result["id"],
            "reviewId": reviewed["id"], **accepted, "worksheet": worksheet, "return": result, "review": reviewed,
            "package": {k: v for k, v in package.items() if k != "document"},
            "returnedFile": returned[1], "returnedDocument": returned[2], "worksheetDocument": document,
            "changes": changes, "decisions": decisions}

    def successor_rows(self, ws, first, original_rows):
        pairs = {r["sourceId"]: r["derivedSourceId"] for r in first["sources"]}
        selected = {}
        for name in ("csv", "json"):
            original = original_rows[name]
            rows = [r for r in self.source_rows(ws, pairs[original["sourceId"]])
                if r["memberName"] == "source/" + original["memberName"]
                and r["pointer"] == original["pointer"] and r["table"] == original["table"]]
            require(len(rows) == 1, "Select the one accepted successor by original source member and pointer")
            selected[name] = rows[0]
        return selected

    def replay(self, ws, inputs):
        methods = {
            ("worksheet", "prepare"): ws.prepare_directory_correction_worksheet,
            ("worksheet", "export"): ws.export_directory_correction_worksheet,
            ("worksheet", "import"): ws.save_directory_correction_worksheet_import,
            ("worksheet", "review"): ws.review_directory_correction_worksheet_return,
            ("correction", "prepare"): ws.prepare_directory_correction,
            ("correction", "preview"): ws.preview_directory_correction,
            ("correction", "apply"): ws.apply_directory_correction,
            ("correction", "export"): ws.export_directory_correction}
        results = []
        for row in inputs:
            if row["action"] == "receive":
                require(matches_file(info(row["file"]["file"]), row["file"]),
                    "Keep the complete original customer return before replay")
                result = ws.import_directory_correction_worksheet_return(row["importId"], Path(row["file"]["file"]))
            else:
                result = methods[(row["family"], row["action"])](row["input"])
            require(result["id"] == row["expectedRecordId"],
                "Reopening the exact original worksheet/correction request must reuse its original record")
            results.append({"key": row["key"], "family": row["family"], "action": row["action"],
                "recordId": result["id"], "reusedOriginal": True})
        return results

    def whole_packet(self, ws):
        path = self.root / "Directory_Worksheets_Complete_Editable_Workspace.zip"
        def inspect_packet():
            with ws.scratch() as scratch:
                from directory_receiving import WORKSPACE_PACKET
                ws._read_directory_packet(path, scratch, WORKSPACE_PACKET)
            with zipfile.ZipFile(path) as archive:
                registry = source.json_value(archive.read("directory-registry.json"))
            require(registry["workspaceId"] == ORIGINAL_UUID,
                "The complete exported registry must retain the original workspace identity")
            return registry
        def export_original():
            if path.exists():
                try:
                    inspect_packet()
                except (zipfile.BadZipFile, EOFError):
                    # Preserve the incomplete original bytes under their own
                    # digest before rebuilding the same private derived export.
                    partial = info(path)
                    retained = private_dir(self.root / "interrupted-exports") / (partial["sha256"] + ".zip")
                    require(not retained.exists(), "Retain and reconcile the original interrupted export before another recovery")
                    path.rename(retained)
                    write_once(retained.with_suffix(".json"),
                        {"originalFile": partial, "retainedFile": info(retained), "observedAt": now()})
            if not path.exists():
                ws.export_workspace(path)
            inspect_packet()
            return info(path)
        descriptor = self.step("10-complete-workspace-export", {"workspaceId": ws.workspace_id},
            export_original)
        require(matches_file(info(path), descriptor), "Keep the original complete native worksheet export")
        registry = inspect_packet()
        expected = {kind: {row["id"]: source.sha(source.jbytes(row)) for row in rows}
            for kind, rows in registry["records"].items()}
        require(expected == complete_record_hashes(ws),
            "The exact exported registry and current native source records differ")
        write_once(self.root / "EXPORTED_WORKSHEETS_REGISTRY.json", registry)
        return descriptor, registry, expected

    def cold_receive(self, packet, registry, expected, original_hashes, replay):
        destination = self.root / "received-workspace"
        with Workspace(destination, create=not destination.exists()) as target:
            received = self.step("11-full-customer-workspace-receive", packet,
                lambda: self._receive(target, Path(packet["file"])))
            require(complete_record_hashes(target) == expected and self.native_records(target) == original_hashes,
                "Cold receiving must preserve every complete portable and original native record")
            verify = target._verify_directory_correction_worksheets()
            worksheet_files = []
            for kind in WORKSHEET_KINDS:
                for row in registry["records"][kind]:
                    require(target.directory_record(kind, row["id"]) == row,
                        "Cold receiving changed a complete immutable worksheet record")
                    for name, descriptor in row.get("files", {}).items():
                        path, actual = target.directory_correction_worksheet_file(kind, row["id"], name)
                        require(matches_file(info(path), descriptor) and matches_file(actual, descriptor),
                            "Cold receiving lost an original worksheet, returned file or review file")
                        worksheet_files.append({"kind": kind, "id": row["id"], "fileKind": name, **descriptor})
            for kind in ("sources", "editions", "comparisons"):
                for row in registry["records"][kind]:
                    path, descriptor = target.directory_index_file(kind, row["id"])
                    require(matches_file(info(path), descriptor), "A full received source/edition/comparison index changed")
                    if kind == "sources":
                        path, descriptor = target.directory_source_file(row["id"])
                        require(matches_file(info(path), descriptor), "A full original/derived source file changed")
        with Workspace(destination, create=False) as target:
            require(target.workspace_id == ORIGINAL_UUID and complete_record_hashes(target) == expected,
                "Cold reopening changed the complete accepted worksheet history")
            receipt = target.directory_record("receives", packet["sha256"])
            require(receipt["id"] == packet["sha256"] and receipt["archiveSha256"] == packet["sha256"]
                and receipt["kind"] == "workspace" and receipt["state"] == "complete"
                and receipt["workspaceId"] == ORIGINAL_UUID, "Reopen the exact local completed archive receipt")
            reopened = self.replay(target, replay)
            require(complete_record_hashes(target) == expected,
                "Replaying original requests after cold receiving added or changed native records")
        return {"workspace": str(destination), "workspaceId": ORIGINAL_UUID, "archive": packet,
            "receive": received, "receipt": receipt, "verification": verify,
            "worksheetFiles": worksheet_files, "replayed": reopened,
            "allOriginalRecordsEqual": True, "allPortableRecordsEqual": True, "coldReopened": True}

    def operate(self):
        if not self.workspace.exists():
            require(self.archive is not None, "Receive the original complete packet into this distinct worksheet workspace")
            private_dir(self.workspace.parent)
        with Workspace(self.workspace, create=not self.workspace.exists()) as ws:
            originals = self.receive_original(ws)
            selected = self.original_sources(ws)
            original_rows = self.select_original_rows(ws, selected)
            basis_input = {"label": "Original complete CSV and nested JSON customer worksheet basis",
                "sourceIds": [selected[k]["record"]["id"] for k in ("original-csv", "organization_full.json")],
                "tables": [], "scope": "subset", "actor": ACTOR,
                "note": "Complete selected retained published examples; not a newly acquired provider snapshot."}
            basis = self.step("02-original-worksheet-edition", basis_input, lambda: ws.directory_edition(basis_input))
            replay = []
            first = self.run_round(ws, basis, original_rows, None, "03-first", replay)
            accepted_edition = ws.directory_record("editions", first["acceptedEditionId"])
            successor_rows = self.successor_rows(ws, first, original_rows)
            second = self.run_round(ws, accepted_edition, successor_rows, first["correctionId"],
                "04-successor", replay, successor=True)
            require(ws.directory_record("corrections", second["correctionId"])["predecessorId"] == first["correctionId"],
                "The accepted second return must continue the original first correction")
            keep_input = {"returnId": first["returnId"], "label": "Complete alternate keep-original review",
                "actor": ACTOR, "choices": [{"changeId": c["changeId"], "decision": "keep-original",
                    "reason": "Explicit alternate operator review keeps every original value; no correction plan is prepared."}
                    for c in first["changes"]], "note": "Retained alternate review is not the accepted edition."}
            no_edits = self.step("05-explicit-no-edits-review", keep_input,
                lambda: ws.review_directory_correction_worksheet_return(keep_input))
            require(no_edits["outcome"] == "no-edits-selected" and no_edits["planId"] is None,
                "An all-kept review must not manufacture a correction plan")
            self.worksheet_record(ws, "correctionWorksheetReviews", no_edits)
            replay.append({"family": "worksheet", "key": "05-no-edits-review", "action": "review",
                "input": keep_input, "expectedRecordId": no_edits["id"]})
            before_replay = complete_record_hashes(ws)
            replay_result = self.step("06-exact-original-request-reopen", {"requests": replay},
                lambda: self.replay(ws, replay))
            require(complete_record_hashes(ws) == before_replay, "Same-request reopen changed immutable worksheet records")
            verification = self.step("07-complete-native-worksheet-verification",
                {"worksheets": [first["worksheetId"], second["worksheetId"]]},
                lambda: ws._verify_directory_correction_worksheets())
            require(self.native_records(ws) == originals, "The worksheet course changed original Directory records")
            packet, registry, expected = self.whole_packet(ws)
        restored = self.cold_receive(packet, registry, expected, originals, replay)
        self.journal.setdefault("completedAt", now()); self.save()
        result = {"schema": RESULT_SCHEMA, "operation": OPERATION, "completedAt": self.journal["completedAt"],
            "workspace": str(self.workspace), "workspaceId": ORIGINAL_UUID, "sourceRoot": str(HERE),
            "originalDirectoryReceiving": self.journal["inputs"]["receiving"],
            "originalDirectoryPacket": self.native["workspacePacket"], "originalDirectoryRecordHashes": originals,
            "basisEditionId": basis["id"], "latestEditionId": second["acceptedEditionId"],
            "cases": {"first": first, "successor": second}, "noEditsReview": no_edits,
            "recordIds": {kind: [row["id"] for row in rows] for kind, rows in registry["records"].items()},
            "connectedInputs": {"replay": replay}, "originalReplay": replay_result,
            "verification": verification, "workspacePacket": packet, "restoration": restored,
            "files": self.journal["files"], "journal": str(self.path),
            "meaning": "Actual locally authored worksheet returns with explicit decisions preserve original publisher bytes, typed/present/absent values and full correction history. No external customer response, publisher update or blanket conformance certification is inferred."}
        descriptor = write_once(self.root / "OPERATED_DIRECTORY_WORKSHEETS.json", result)
        self.journal["result"] = descriptor; self.save()
        self.emit("DIRECTORY_WORKSHEETS_COMPLETE", result=descriptor, workspacePacket=packet)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("receiving", "receiving-sha256", "workspace", "out"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--archive")
    args = parser.parse_args(argv)
    os.umask(0o077)
    root = private_dir(args.out)
    descriptor = os.open(root / "WORKSHEETS_OPERATION.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operation = Operation(args)
        try:
            operation.operate()
            return 0
        except BaseException as error:
            import traceback
            operation.journal["failures"].append({"at": now(), "type": type(error).__name__,
                "message": str(error), "traceback": traceback.format_exc()})
            operation.save()
            operation.emit("DIRECTORY_WORKSHEETS_INTERRUPTED", journal=str(operation.path),
                error={"type": type(error).__name__, "message": str(error)})
            raise
    finally:
        os.close(descriptor)

if __name__ == "__main__":
    raise SystemExit(main())
