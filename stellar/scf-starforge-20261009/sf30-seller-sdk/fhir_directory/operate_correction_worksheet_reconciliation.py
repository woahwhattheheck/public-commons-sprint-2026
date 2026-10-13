#!/usr/bin/env python3
"""Operate returned worksheet reconciliation against a retained current edition.

Consumes the complete actual worksheet result and its editable packet. The course
uses that result's original publisher rows, locally authored return and two
accepted editions. It retains their complete source and customer decision history.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import sys
import zipfile
from directory_runtime import source, original_workspace, now
from directory_workspace import Workspace
from operate_correction_worksheets import Operation as WorksheetOperation, source_identity as worksheet_source_identity
from operate_corrections import exact_reference
import directory_schema
from operate_operating_plans import private_dir, info, read_json, write_once, require, matches_file

HERE = Path(__file__).resolve().parent
OPERATION = "SCF-DIRECTORY-WORKSHEET-RECONCILIATION-450E-20261013"
ACTOR = "450E Directory returned worksheet reconciliation"
RESULT_SCHEMA = "stellar-forge.directory-worksheet-reconciliation-operated.v1"
BASIS_SCHEMA = "stellar-forge.directory-worksheets-operated.v1"
ORIGINAL_UUID = "2c51f522-4852-463b-bdc0-59389d7bae83"
KINDS = ("correctionWorksheetReconciliations", "correctionWorksheetReconciliationReviews")
PRIVATE_MUTABLE = {"receives", "acquisitions"}

def complete_record_hashes(ws):
    return {kind: {row["id"]: source.sha(source.jbytes(row)) for row in ws.directory_records(kind)}
        for kind in sorted(directory_schema.KINDS - PRIVATE_MUTABLE)}

def source_identity():
    values = worksheet_source_identity()
    for name in ("directory_correction_worksheet_reconciliation.py",
            "directory_correction_worksheet_reconciliation_schema.py",
            "directory-correction-worksheet-reconciliation-schema.json",
            "operate_correction_worksheet_reconciliation.py"):
        raw = (HERE / name).read_bytes()
        values.append({"file": str(HERE / name), "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlobSha": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
    return values

class Operation(WorksheetOperation):
    def __init__(self, args):
        os.umask(0o077)
        self.args = args
        self.root = private_dir(args.out)
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.receiving_path = Path(args.worksheets).expanduser().absolute()
        original_workspace.regular(self.receiving_path, 64 * 1024 * 1024)
        received = info(self.receiving_path)
        require(received["sha256"] == args.worksheets_sha256,
            "Select the actual complete worksheet result by its original SHA256")
        self.native = self.baseline = read_json(self.receiving_path)
        require(self.baseline.get("schema") == BASIS_SCHEMA
            and self.baseline.get("workspaceId") == ORIGINAL_UUID
            and self.baseline.get("verification", {}).get("verified") is True
            and self.baseline.get("restoration", {}).get("coldReopened") is True,
            "Receive the completed original worksheet operation and full cold-reopen result")
        self.archive = Path(args.archive).expanduser().absolute()
        require(matches_file(info(self.archive), self.baseline["workspacePacket"]),
            "Use the worksheet operation's exact complete editable packet")
        require(self.workspace != Path(self.baseline["workspace"]).expanduser().absolute(),
            "Operate this reconciliation in its selected distinct editable workspace")
        self.path = self.root / "WORKSHEET_RECONCILIATION_JOURNEY.json"
        inputs = {"operation": OPERATION, "workspace": str(self.workspace), "workspaceId": ORIGINAL_UUID,
            "worksheetResult": received, "archive": info(self.archive), "source": source_identity()}
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["inputs"] == inputs,
                "Resume the same reconciliation source, original inputs and operation paths")
        else:
            self.journal = {"schema": "stellar-forge.directory-worksheet-reconciliation-journey.v1",
                "inputs": inputs, "createdAt": now(), "steps": {}, "times": {}, "files": {}, "failures": []}
            self.save()
        for name in ("records", "exports", "worksheets", "returns", "evidence", "reconciliation"):
            private_dir(self.root / name)
        self.copy_file("original-worksheet-result", self.receiving_path, received,
            "Original_Directory_Worksheet_Receiving.json")
        write_once(self.root / "WORKSHEET_RECONCILIATION_SOURCE.json", inputs["source"])

    def emit(self, stage, **value):
        print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

    def _receive(self, ws, path):
        expected = info(path)
        row = ws.directory_record("receives", expected["sha256"], required=False)
        if row is not None:
            require(row.get("archiveSha256") == expected["sha256"] and row.get("kind") == "workspace"
                and row.get("workspaceId") == ORIGINAL_UUID,
                "Continue the original selected editable receiving operation")
            if row.get("state") == "complete":
                require(ws.workspace_id == ORIGINAL_UUID, "Reopen the original completed receive")
                return {"workspaceId": ws.workspace_id, "archiveSha256": expected["sha256"],
                    "receiveRecordId": row["id"], "state": row["state"]}
        ws.import_workspace(path)
        row = ws.directory_record("receives", expected["sha256"])
        require(row.get("state") == "complete" and row.get("workspaceId") == ORIGINAL_UUID
            and ws.workspace_id == ORIGINAL_UUID, "Complete original workspace receiving was not observed")
        return {"workspaceId": ws.workspace_id, "archiveSha256": expected["sha256"],
            "receiveRecordId": row["id"], "state": row["state"]}

    def native_records(self, ws):
        return {kind + "/" + ident: source.sha(source.jbytes(ws.directory_record(kind, ident)))
            for kind, ids in self.native["recordIds"].items() if kind not in PRIVATE_MUTABLE for ident in ids}

    def current_bindings(self, ws, worksheet, returned, edition, key, additional=()):
        """Select current references using actual accepted correction source maps."""
        originals = ws._worksheet_file_rows(worksheet, "rows")
        selected = originals
        require(len({row["rowKey"] for row in selected}) == len(selected),
            "Bind every complete original worksheet row exactly once")
        lineage = [self.baseline["cases"][name] for name in ("first", "successor")] + list(additional)
        require(edition["id"] == lineage[-1]["acceptedEditionId"],
            "Select the explicit current completed worksheet edition")
        bindings, evidence, current_rows = [], [], {}
        for original in selected:
            sid = original["ref"]["sourceId"]
            member, pointer, table = original["memberName"], original["pointer"], original["table"]
            transitions = []
            for case in lineage:
                correction = ws.directory_record("corrections", case["correctionId"])
                preview = ws.directory_record("correctionPreviews", case["previewId"])
                require(correction["editionId"] == case["acceptedEditionId"]
                    and preview["sources"] == case["sources"],
                    "Use the actual accepted correction source map")
                pairs = [pair for pair in preview["sources"] if pair["sourceId"] == sid]
                require(len(pairs) <= 1, "A source has more than one current successor")
                if pairs:
                    pair = pairs[0]
                    transitions.append({"correctionId": correction["id"], "sourceId": sid,
                        "derivedSourceId": pair["derivedSourceId"], "memberName": member})
                    sid = pair["derivedSourceId"]
                    member = "source/" + member
            rows = [row for row in self.source_rows(ws, sid) if row["memberName"] == member
                and row["pointer"] == pointer and row["table"] == table]
            require(len(rows) == 1, "Select the one current row through the original accepted source lineage")
            current = ws.directory_edition_row(edition["id"], sid, rows[0]["recordId"])
            require(exact_reference(current) == exact_reference(rows[0])
                and ("cells" in current) == (original["representation"] == "csv"),
                "The explicitly selected current row changed identity or representation")
            current_rows[original["rowKey"]] = current
            bindings.append({"rowKey": original["rowKey"], "original": original["ref"], "current": exact_reference(current),
                "reason": "Selected through both original accepted correction source maps; complete current member, pointer and row hashes verified."})
            evidence.append({"rowKey": original["rowKey"], "original": original,
                "transitions": transitions, "currentEditionId": edition["id"], "current": current})
        write_once(self.root / "evidence" / (key + "-EXPLICIT_CURRENT_ROW_BINDINGS.json"), evidence)
        return bindings, current_rows

    def reconciliation_rows(self, ws, kind, ident):
        result, offset, total = [], 0, None
        while True:
            page = ws.directory_correction_worksheet_reconciliation_rows(
                kind, ident, offset=offset, limit=1)
            require(page["kind"] == kind and page["recordId"] == ident and page["offset"] == offset
                and (total is None or total == page["total"]), "Preserve the complete current comparison page sequence")
            total = page["total"]
            result.extend(page["rows"])
            if page["nextOffset"] is None:
                require(len(result) == total, "Receive every complete original comparison or decision")
                return result
            require(page["nextOffset"] == offset + len(page["rows"]) and page["nextOffset"] > offset,
                "Follow the exact original comparison page offset")
            offset = page["nextOffset"]

    def reconciliation_record(self, ws, kind, record):
        write_once(self.root / "records" / (kind + "-" + record["id"] + ".json"), record)
        complete = {}
        for name, descriptor in record["files"].items():
            path, observed = ws.directory_correction_worksheet_reconciliation_file(kind, record["id"], name)
            require(matches_file(info(path), descriptor) and matches_file(observed, descriptor),
                "The complete reconciliation file changed: " + name)
            complete[name] = self.copy_file(kind + "-" + record["id"] + "-" + name,
                path, descriptor, "reconciliation/" + record["id"] + "/" + name + ".bin")
        key = "comparison" if kind == "correctionWorksheetReconciliations" else "decisions"
        expected = [source.json_value(line) for line in
            Path(complete[key]["file"]).read_bytes().splitlines()]
        pages = self.reconciliation_rows(ws, kind, record["id"])
        require(pages == expected, "The complete comparison file and original page sequence differ")
        return pages

    def prepare_reconciliation(self, ws, worksheet, returned, edition, predecessor, key, replay, additional=()):
        bindings, rows = self.current_bindings(ws, worksheet, returned, edition, key, additional)
        request = {"returnId": returned["id"], "currentEditionId": edition["id"],
            "predecessorId": predecessor, "label": key + " complete current-edition review",
            "actor": ACTOR, "note": "Explicit full original and current row bindings retain both edition histories.",
            "bindings": bindings}
        prepared = self.step(key + "-prepare", request,
            lambda: ws.prepare_directory_correction_worksheet_reconciliation(request))
        require(prepared["returnId"] == returned["id"] and prepared["worksheetId"] == worksheet["id"]
            and prepared["baseEditionId"] == worksheet["editionId"]
            and prepared["currentEditionId"] == edition["id"] and prepared["bindings"] == bindings,
            "The reconciliation changed its complete original/current binding")
        compared = self.reconciliation_record(ws, "correctionWorksheetReconciliations", prepared)
        original_changes = ws._worksheet_file_rows(returned, "changes")
        require(len(compared) == len(original_changes)
            and {row["changeId"] for row in compared} == {row["changeId"] for row in original_changes},
            "Compare every original customer change exactly once")
        original_by_id = {row["changeId"]: row for row in original_changes}
        for row in compared:
            original = original_by_id[row["changeId"]]
            require(row["originalChange"] == original and row["base"] == original["before"]
                and row["proposed"] == original["after"]
                and row["currentRef"] == exact_reference(rows[row["rowKey"]]),
                "Keep the full original customer change, lexical atoms and explicitly bound current reference")
        replay.append({"family": "reconciliation", "action": "prepare", "key": key + "-prepare",
            "input": request, "expectedRecordId": prepared["id"]})
        return {"input": request, "record": prepared, "comparison": compared, "currentRows": rows}

    def check_three_way(self, prepared):
        changes = prepared["comparison"]
        json_description = [row for row in changes if row["representation"] == "json"
            and row.get("pointer") == "/description"]
        require(len(json_description) == 1, "Review the original one nested JSON description")
        row = json_description[0]
        require(row["base"].get("type") == "string" and row["proposed"] ==
            {"present": True, "type": "null", "valueJson": "null"}
            and row["current"] == {"present": False} and row["state"] == "conflict",
            "Distinguish the original string, proposed explicit null and current field absence")
        csv_description = [row for row in changes if row["representation"] == "csv"
            and row.get("column") is not None
            and row["originalHeaders"][row["column"]] == "description"]
        require(len(csv_description) == 1 and csv_description[0]["state"] == "already-applied"
            and csv_description[0]["current"] == csv_description[0]["proposed"],
            "Retain the already accepted complete multiline CSV description without reapplying it")
        number = [row for row in changes if row.get("pointer") == "/_worksheet_authored_number"]
        require(len(number) == 1 and number[0]["state"] == "proposable"
            and number[0]["base"] == number[0]["current"] == {"present": False}
            and number[0]["proposed"] == {"present": True, "type": "number", "valueJson": "1.20"},
            "Keep the clean authored exact numeric lexeme distinct from absence")
        write_once(self.root / "evidence" / "THREE_WAY_CURRENT_VALUES.json",
            {"jsonDescription": row, "csvDescription": csv_description[0], "numericProposal": number[0]})

    def review_reconciliation(self, ws, prepared, key, replay, mode):
        choices, resolutions = [], []
        json_keys = {row["rowKey"] for row in prepared["comparison"] if row["representation"] == "json"}
        require(len(json_keys) == 1, "Select the one complete retained JSON object for this course")
        json_key = next(iter(json_keys))
        if mode == "resolve-row":
            value = source.json_value(prepared["currentRows"][json_key]["json"], lexical=True)
            require(type(value) is dict and value.get("description") is None
                and source.lexical_json(value["_worksheet_authored_number"]) == "1.20",
                "Resolve the actual accepted current JSON object with its original numeric lexeme")
            value["description"] = "Locally authored whole-row resolution after explicit original, proposed and current review."
            resolutions = [{"rowKey": json_key, "representation": "json",
                "valueJson": source.lexical_json(value),
                "reason": "Retain the complete current object and every current field; explicitly replace only the description in this whole-row decision."}]
        for row in prepared["comparison"]:
            decision = "keep-current"
            if mode == "granular" and row["representation"] == "json" and row.get("pointer") in {
                    "/description", "/_worksheet_authored_number"}:
                decision = "accept-proposed"
            elif mode == "resolve-row" and row["rowKey"] == json_key:
                decision = "resolve-row"
            reason = {
                "accept-proposed": "Explicitly accept this exact customer proposal after reviewing its original and current values.",
                "keep-current": "Explicitly retain the current edition value and the complete original proposed change.",
                "resolve-row": "Resolve every proposed field on this row through the one complete operator-authored current object."
            }[decision]
            choices.append({"changeId": row["changeId"], "decision": decision, "reason": reason})
        request = {"reconciliationId": prepared["record"]["id"], "label": key + " complete decisions",
            "actor": ACTOR, "note": "Every proposed change receives an explicit decision; preview and acceptance remain separate.",
            "choices": choices, "rowResolutions": resolutions}
        reviewed = self.step(key + "-review", request,
            lambda: ws.review_directory_correction_worksheet_reconciliation(request))
        require(reviewed["reconciliationId"] == prepared["record"]["id"]
            and reviewed["currentEditionId"] == prepared["record"]["currentEditionId"],
            "Review the exact selected current-edition comparison")
        decisions = self.reconciliation_record(ws, "correctionWorksheetReconciliationReviews", reviewed)
        by_id = {row["changeId"]: row for row in decisions}
        require(len(by_id) == len(choices) and len(decisions) == len(choices),
            "Keep every explicitly reviewed customer change exactly once")
        for choice in choices:
            require(by_id[choice["changeId"]]["decision"] == choice["decision"]
                and by_id[choice["changeId"]]["reviewerReason"] == choice["reason"],
                "The review changed an explicit operator decision or reason")
        plan_input = None
        if mode == "keep-current":
            require(reviewed["planId"] is None and reviewed["outcome"] == "no-edits-selected"
                and reviewed["summary"]["edits"] == 0, "All-kept current values must not create a correction plan")
        else:
            require(reviewed["planId"] is not None and reviewed["outcome"] == "plan-prepared",
                "The selected granular or whole-row resolution must prepare its ordinary correction plan")
            plan = ws.directory_record("correctionPlans", reviewed["planId"])
            plan_input = source.json_value(ws._directory_file_path(plan["files"]["input"]).read_bytes())
            require(plan_input["editionId"] == prepared["record"]["currentEditionId"]
                and plan_input["predecessorId"] == prepared["record"]["predecessorId"],
                "The ordinary correction plan must start from the explicitly selected current edition")
            if mode == "granular":
                require(len(plan_input["edits"]) == 2
                    and {row["pointer"] for row in plan_input["edits"]} ==
                        {"/description", "/_worksheet_authored_number"},
                    "Prepare only the two explicitly accepted JSON changes")
                require(all(row["action"] == "json-set" and
                    all(row[name] == exact_reference(prepared["currentRows"][json_key])[name]
                        for name in ("sourceId", "recordId", "rowSha256", "resourceSha256", "memberSha256"))
                    for row in plan_input["edits"]), "Granular edits must name complete current references")
            else:
                require(len(plan_input["edits"]) == 1 and plan_input["edits"][0]["action"] == "json-set"
                    and plan_input["edits"][0]["pointer"] == ""
                    and plan_input["edits"][0]["valueJson"] == resolutions[0]["valueJson"],
                    "A complete row resolution must emit one explicitly authored full current-row edit")
        replay.append({"family": "reconciliation", "action": "review", "key": key + "-review",
            "input": request, "expectedRecordId": reviewed["id"]})
        return {"input": request, "record": reviewed, "decisions": decisions, "planInput": plan_input}

    def package_reconciliation(self, ws, prepared, reviewed, key, replay):
        request = {"reconciliationId": prepared["record"]["id"], "reviewId": reviewed["record"]["id"],
            "label": key + " complete returned-worksheet current-edition review", "actor": ACTOR,
            "note": "Complete original worksheet, return, current bindings, comparison and explicit decisions."}
        exported = self.step(key + "-export", request,
            lambda: ws.export_directory_correction_worksheet_reconciliation(request))
        require(exported["kind"] == "correction-worksheet-reconciliation"
            and exported["recordId"] == prepared["record"]["id"]
            and exported["reviewId"] == reviewed["record"]["id"],
            "Export the exact selected complete reconciliation and review")
        path = ws._directory_file_path(exported["file"])
        descriptor = self.copy_file(key + "-complete-review-package", path, exported["file"],
            "exports/" + exported["name"])
        # The native packet verifier participates in complete workspace verification
        # below. This streaming pass independently preserves every archive member.
        members = []
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            require(len(names) == len(set(names)) and {"manifest.json", "records.json"} <= set(names),
                "The complete review package must retain its original graph and manifest")
            for item in archive.infolist():
                require(not item.is_dir(), "The complete native review package has an unexpected directory member")
                digest, size = hashlib.sha256(), 0
                with archive.open(item) as stream:
                    while block := stream.read(65536):
                        digest.update(block); size += len(block)
                require(size == item.file_size, "The complete native review package ended inside an original member")
                members.append({"name": item.filename, "bytes": size, "sha256": digest.hexdigest()})
        write_once(self.root / "evidence" / (key + "-review-package-members.json"), members)
        replay.append({"family": "reconciliation", "action": "export", "key": key + "-export",
            "input": request, "expectedRecordId": exported["id"]})
        return {"record": exported, "file": descriptor, "members": members}

    def replay(self, ws, inputs):
        methods = {"prepare": ws.prepare_directory_correction_worksheet_reconciliation,
            "review": ws.review_directory_correction_worksheet_reconciliation,
            "export": ws.export_directory_correction_worksheet_reconciliation}
        results = []
        for row in inputs:
            if row["family"] != "reconciliation":
                results.extend(super().replay(ws, [row]))
                continue
            value = methods[row["action"]](row["input"])
            require(value["id"] == row["expectedRecordId"],
                "An original reconciliation request must reuse its complete original record")
            results.append({"family": "reconciliation", "action": row["action"], "key": row["key"],
                "recordId": value["id"], "reusedOriginal": True})
        return results

    def whole_packet(self, ws):
        path = self.root / "Directory_Worksheet_Reconciliation_Complete_Editable_Workspace.zip"
        def inspect():
            from directory_receiving import WORKSPACE_PACKET
            with ws.scratch() as scratch:
                ws._read_directory_packet(path, scratch, WORKSPACE_PACKET)
            with zipfile.ZipFile(path) as archive:
                registry = source.json_value(archive.read("directory-registry.json"))
            require(registry["workspaceId"] == ORIGINAL_UUID,
                "The complete editable packet changed the original workspace identity")
            return registry
        def export():
            if path.exists():
                try:
                    inspect()
                except (zipfile.BadZipFile, EOFError):
                    previous = info(path)
                    retained = private_dir(self.root / "interrupted-exports") / (previous["sha256"] + ".zip")
                    require(not retained.exists(), "Reconcile the retained original interrupted export")
                    path.rename(retained)
                    write_once(retained.with_suffix(".json"),
                        {"originalFile": previous, "retainedFile": info(retained), "observedAt": now()})
            if not path.exists():
                ws.export_workspace(path)
            inspect()
            return info(path)
        descriptor = self.step("10-complete-workspace-export", {"workspaceId": ws.workspace_id}, export)
        require(matches_file(info(path), descriptor), "Retain the original complete exported reconciliation packet")
        registry = inspect()
        expected = {kind: {row["id"]: source.sha(source.jbytes(row)) for row in rows}
            for kind, rows in registry["records"].items() if kind not in PRIVATE_MUTABLE}
        require(expected == complete_record_hashes(ws), "Export every complete immutable current record")
        write_once(self.root / "EXPORTED_WORKSHEET_RECONCILIATION_REGISTRY.json", registry)
        return descriptor, registry, expected

    def cold_receive(self, packet, registry, expected, original_hashes, replay):
        destination = self.root / "received-workspace"
        files = []
        with Workspace(destination, create=not destination.exists()) as target:
            received = self.step("11-full-customer-workspace-receive", packet,
                lambda: self._receive(target, Path(packet["file"])))
            require(complete_record_hashes(target) == expected
                and self.native_records(target) == original_hashes,
                "Receive every complete immutable original and reconciliation record")
            verified = target._verify_directory_correction_worksheet_reconciliations()
            for kind in KINDS:
                for record in registry["records"][kind]:
                    require(target.directory_record(kind, record["id"]) == record,
                        "The received complete reconciliation record changed")
                    self.reconciliation_record(target, kind, record)
                    for name, descriptor in record["files"].items():
                        path, observed = target.directory_correction_worksheet_reconciliation_file(
                            kind, record["id"], name)
                        require(matches_file(info(path), descriptor) and matches_file(observed, descriptor),
                            "Cold receiving lost a complete original/current binding or decision file")
                        files.append({"kind": kind, "recordId": record["id"], "fileKind": name, **descriptor})
            target._verify_directory_correction_worksheets()
            for kind in ("sources", "editions", "comparisons"):
                for record in registry["records"][kind]:
                    path, descriptor = target.directory_index_file(kind, record["id"])
                    require(matches_file(info(path), descriptor), "Receive the complete source-defined index")
                    if kind == "sources":
                        path, descriptor = target.directory_source_file(record["id"])
                        require(matches_file(info(path), descriptor), "Receive every complete original or derived source")
        with Workspace(destination, create=False) as target:
            require(target.workspace_id == ORIGINAL_UUID
                and complete_record_hashes(target) == expected, "Cold reopen the complete original reconciliation history")
            receipt = target.directory_record("receives", packet["sha256"])
            require(receipt["state"] == "complete" and receipt["archiveSha256"] == packet["sha256"],
                "Reopen the original completed local receive")
            reopened = self.replay(target, replay)
            require(complete_record_hashes(target) == expected,
                "Replaying exact original requests must preserve complete immutable records")
        return {"workspace": str(destination), "workspaceId": ORIGINAL_UUID, "archive": packet,
            "receive": received, "receipt": receipt, "verification": verified, "files": files,
            "replayed": reopened, "allOriginalImmutableRecordsEqual": True,
            "allPortableImmutableRecordsEqual": True, "coldReopened": True}

    def operate(self):
        private_dir(self.workspace.parent)
        with Workspace(self.workspace, create=not self.workspace.exists()) as ws:
            originals = self.receive_original(ws)
            first = self.baseline["cases"]["first"]
            worksheet = ws.directory_record("correctionWorksheets", first["worksheetId"])
            returned = ws.directory_record("correctionWorksheetReturns", first["returnId"])
            edition = ws.directory_record("editions", self.baseline["latestEditionId"])
            require(returned["worksheetId"] == worksheet["id"]
                and edition["id"] != worksheet["editionId"],
                "Select the retained original return and actual later current edition")
            replay = []
            prepared = self.prepare_reconciliation(ws, worksheet, returned, edition,
                self.baseline["cases"]["successor"]["correctionId"], "02-current", replay)
            self.check_three_way(prepared)
            kept = self.review_reconciliation(ws, prepared, "03-keep-current", replay, "keep-current")
            reviewed = self.review_reconciliation(ws, prepared, "04-granular", replay, "granular")
            correction_replay = []
            selected = [row for row in prepared["currentRows"].values()
                if any(edit["sourceId"] == row["sourceId"] and edit["recordId"] == row["recordId"]
                    for edit in reviewed["planInput"]["edits"])]
            accepted = self.accepted_case(ws, "05-accept-granular", reviewed["planInput"],
                selected, correction_replay)
            require(accepted["planId"] == reviewed["record"]["planId"],
                "Preview and accept the exact current-edition plan from explicit review")
            replay.extend({**row, "family": "correction"} for row in correction_replay)
            package = self.package_reconciliation(ws, prepared, reviewed, "06-granular", replay)
            current = ws.directory_record("editions", accepted["acceptedEditionId"])
            second = self.prepare_reconciliation(ws, worksheet, returned, current,
                accepted["correctionId"], "07-successor", replay, additional=(accepted,))
            resolved = self.review_reconciliation(ws, second, "08-resolve-row", replay, "resolve-row")
            correction_replay = []
            selected = [row for row in second["currentRows"].values()
                if any(edit["sourceId"] == row["sourceId"] and edit["recordId"] == row["recordId"]
                    for edit in resolved["planInput"]["edits"])]
            accepted_resolution = self.accepted_case(ws, "09-accept-resolution", resolved["planInput"],
                selected, correction_replay)
            require(accepted_resolution["planId"] == resolved["record"]["planId"],
                "Preview and accept the exact complete row resolution plan")
            replay.extend({**row, "family": "correction"} for row in correction_replay)
            resolved_package = self.package_reconciliation(ws, second, resolved, "09-resolved", replay)
            before = complete_record_hashes(ws)
            original_replay = self.step("09-original-request-reopen", {"requests": replay},
                lambda: self.replay(ws, replay))
            require(complete_record_hashes(ws) == before, "Exact request replay changed an immutable record")
            verification = ws._verify_directory_correction_worksheet_reconciliations()
            ws._verify_directory_correction_worksheets()
            require(self.native_records(ws) == originals,
                "Retain every immutable original worksheet and Directory source record")
            packet, registry, expected = self.whole_packet(ws)
        restored = self.cold_receive(packet, registry, expected, originals, replay)
        self.journal.setdefault("completedAt", now()); self.save()
        result = {"schema": RESULT_SCHEMA, "operation": OPERATION,
            "completedAt": self.journal["completedAt"], "workspace": str(self.workspace),
            "workspaceId": ORIGINAL_UUID, "sourceRoot": str(HERE),
            "nativeWorksheetResult": self.journal["inputs"]["worksheetResult"],
            "originalWorksheetResultPath": str(self.receiving_path),
            "originalDirectoryRecordHashes": self.baseline["originalDirectoryRecordHashes"],
            "baselineRecordHashes": originals, "originalWorksheetId": worksheet["id"],
            "originalReturnId": returned["id"], "originalEditionId": worksheet["editionId"],
            "currentEditionId": edition["id"], "acceptedEditionId": accepted_resolution["acceptedEditionId"],
            "bindings": prepared["input"]["bindings"], "preparation": prepared,
            "review": reviewed, "keepCurrentReview": kept,
            "cases": {"granular": {"preparation": prepared, "review": reviewed,
                    "correction": accepted, "export": package},
                "rowResolution": {"preparation": second, "review": resolved,
                    "correction": accepted_resolution, "export": resolved_package}},
            "recordIds": {kind: [row["id"] for row in records]
                for kind, records in registry["records"].items()},
            "connectedInputs": {"replay": replay}, "originalReplay": original_replay,
            "verification": verification, "workspacePacket": packet, "restoration": restored,
            "files": self.journal["files"], "journal": str(self.path),
            "meaning": "The actual locally authored original return is reviewed against later accepted editions. Explicit decisions retain typed current differences, one full-row resolution and complete original source history."}
        descriptor = write_once(self.root / "OPERATED_DIRECTORY_WORKSHEET_RECONCILIATION.json", result)
        self.journal["result"] = descriptor; self.save()
        self.emit("DIRECTORY_WORKSHEET_RECONCILIATION_COMPLETE", result=descriptor, workspacePacket=packet)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("worksheets", "worksheets-sha256", "archive", "workspace", "out"):
        parser.add_argument("--" + flag, required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    root = private_dir(args.out)
    descriptor = os.open(root / "WORKSHEET_RECONCILIATION_OPERATION.lock", os.O_CREAT | os.O_RDWR, 0o600)
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
            operation.emit("DIRECTORY_WORKSHEET_RECONCILIATION_INTERRUPTED", journal=str(operation.path),
                error={"type": type(error).__name__, "message": str(error)})
            raise
    finally:
        os.close(descriptor)

if __name__ == "__main__":
    raise SystemExit(main())
