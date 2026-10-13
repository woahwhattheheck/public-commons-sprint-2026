#!/usr/bin/env python3
"""Operate source-bound authored corrections against the completed original Directory.

Receives the original e0ec result and c00 editable workspace into a distinct
private workspace, preserves its UUID and every original record, and accepts
two explicitly authored correction editions. CSV physical cells and full rows,
nested JSON fields, complete conformance reassessment and cold receiving are
operated through the maintained native product. No publisher request or
external customer response is performed or inferred.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import urllib.request
import zipfile
from directory_runtime import source, fhir, original_workspace, atomic_json, now
from directory_workspace import Workspace
from directory_server import OperatorServer
from directory_corrections_schema import KINDS, PACKET_SCHEMA, tokens, path_at
import directory_schema
from operate_operating_plans import (Operation as OriginalOperation, private_dir,
    info, read_json, write_once, require, matches_file)

HERE = Path(__file__).resolve().parent
OPERATION = "SCF-DIRECTORY-CORRECTIONS-450E-20261013"
ACTOR = "450E authored original Directory correction receiving"
RESULT_SCHEMA = "stellar-forge.directory-corrections-operated.v1"
MAX_MEMBER = 268435456

def source_identity():
    names = ["directory_corrections.py", "directory_corrections_schema.py",
        "directory-corrections-schema.json", "directory_source.py",
        "directory_index.py", "directory_source_schema.py",
        "directory_conformance.py", "directory_conformance_rules.py",
        "directory_conformance_foreign_keys.py", "directory-conformance-schema.json",
        "directory_workspace.py", "directory_receiving.py", "directory_schema.py",
        "directory_server.py", "cli.py", "operate_operating_plans.py",
        "operate_corrections.py"]
    result = []
    for name in names:
        path = HERE / name
        raw = path.read_bytes()
        result.append({"file": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlobSha": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
    return result

def exact_reference(row):
    return {key: row[key] for key in
        ("sourceId", "recordId", "rowSha256", "resourceSha256", "memberSha256")}

def complete_record_hashes(ws):
    return {kind: {row["id"]: source.sha(source.jbytes(row))
        for row in ws.directory_records(kind)} for kind in sorted(directory_schema.KINDS - {"receives"})}

def member_bytes(ws, source_id, name):
    path, descriptor = ws.directory_source_file(source_id, name)
    require(matches_file(info(path), descriptor) and descriptor["bytes"] <= MAX_MEMBER,
        "Retain the exact complete original member within its native source bound")
    return path.read_bytes(), descriptor

def lexical_preservation(before, after, excluded, pointer=()):
    """Compare every unedited original value and numeric token independently."""
    if pointer in excluded:
        return {"values": 0, "numbers": 0, "numberTokens": []}
    result = {"values": 0, "numbers": 0, "numberTokens": []}
    if isinstance(before, dict):
        require(isinstance(after, dict), "An unedited original object changed type")
        old = set(before) - {p[-1] for p in excluded if len(p) == len(pointer) + 1 and p[:-1] == pointer}
        new = set(after) - {p[-1] for p in excluded if len(p) == len(pointer) + 1 and p[:-1] == pointer}
        require(old == new, "An unedited original JSON field was added or removed")
        children = [(key, before[key], after[key]) for key in sorted(old)]
    elif isinstance(before, list):
        require(isinstance(after, list) and len(before) == len(after), "An unedited original array changed")
        children = [(str(i), a, b) for i, (a, b) in enumerate(zip(before, after))]
    else:
        require(source.lexical_json(before) == source.lexical_json(after),
            "An unedited original scalar, type or numeric lexeme changed")
        result["values"] = 1
        if isinstance(before, fhir.Number):
            result["numbers"] = 1
            result["numberTokens"].append({"pointer": list(pointer), "token": str(before)})
        return result
    for key, a, b in children:
        child = lexical_preservation(a, b, excluded, pointer + (key,))
        result["values"] += child["values"]; result["numbers"] += child["numbers"]
        result["numberTokens"].extend(child["numberTokens"])
    return result

class Operation(OriginalOperation):
    def __init__(self, args):
        os.umask(0o077)
        self.args = args
        self.root = private_dir(args.out)
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.receiving_path = Path(args.receiving).expanduser().absolute()
        basis = info(self.receiving_path)
        require(basis["sha256"] == args.receiving_sha256, "Keep the unchanged completed Directory result")
        self.native = read_json(self.receiving_path)
        require(self.native.get("schema") == "stellar-forge.human-services-directory-operated.v1",
            "Select the actual complete native Directory result")
        self.archive = Path(args.archive).expanduser().absolute() if args.archive else None
        if self.archive:
            require(matches_file(info(self.archive), self.native["workspacePacket"]), "Select its exact completed editable packet")
        self.path = self.root / "CORRECTIONS_JOURNEY.json"
        inputs = {"operation": OPERATION, "workspace": str(self.workspace), "workspaceId": self.native["workspaceId"],
            "receiving": basis, "archive": info(self.archive) if self.archive else None, "source": source_identity()}
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["inputs"] == inputs, "Resume the same source, original UUID and complete correction inputs")
        else:
            self.journal = {"schema": "stellar-forge.directory-corrections-journey.v1", "inputs": inputs,
                "createdAt": now(), "steps": {}, "times": {}, "files": {}, "failures": []}
            self.save()
        self.copy_file("original-native-result", self.receiving_path, basis, "Original_Directory_Receiving.json")
        write_once(self.root / "CORRECTIONS_SOURCE.json", inputs["source"])
        private_dir(self.root / "records"); private_dir(self.root / "exports")

    def emit(self, stage, **value):
        print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

    def step(self, key, request, call):
        digest = source.sha(source.jbytes(request))
        old = self.journal["steps"].get(key)
        if old:
            require(old["requestSha256"] == digest, "Keep the complete accepted correction request: " + key)
            if old["state"] == "complete": return old["result"]
        else:
            self.journal["steps"][key] = {"state": "prepared", "request": request,
                "requestSha256": digest, "preparedAt": self.at(key)}
            self.save()
        result = call()
        self.journal["steps"][key].update(state="complete", result=result, completedAt=now())
        self.save()
        self.emit("DIRECTORY_CORRECTION_NATIVE_STEP", key=key,
            recordId=result.get("record", {}).get("id") if isinstance(result, dict) else None)
        return result


    def original_sources(self, ws):
        inputs = self.native.get("connectedInputs", {}).get("sourceImports", [])
        selected = {}
        for key in ("original-csv", "organization_full.json"):
            matches = [item for item in inputs if item["key"] == key]
            require(len(matches) == 1, "Select the one retained original publisher source: " + key)
            item = matches[0]
            record = ws.directory_source(item["sourceId"])
            path, descriptor = ws.directory_source_file(record["id"])
            require(matches_file(info(path), item) and matches_file(descriptor, item),
                "The original source must match the completed producer's complete input")
            selected[key] = {"input": item, "record": record}
            self.copy_file("publisher-" + key, path, descriptor, "original-sources/" + item["profile"]["filename"])
        return selected

    def source_rows(self, ws, source_id):
        return list(ws.directory_iter_rows("sources", source_id))

    def csv_input(self, ws, edition, source_id):
        rows = [row for row in self.source_rows(ws, source_id) if row["table"] == "service"
            and "cells" in row and row["headers"].count("description") == 1 and row["headers"].count("name") == 1
            and len(row["cells"]) > max(row["headers"].index("description"), row["headers"].index("name"))]
        rows.sort(key=lambda row: (row["memberName"], row["pointer"], row["recordId"]))
        require(rows, "Retain the actual complete original published service row for ordered cell and row corrections")
        original = rows[0]
        column = original["headers"].index("description")
        text = 'Authored local receiving note: review "quoted" text, commas, and complete lines.\nSecond line: café; original publisher description remains in the predecessor.'
        cells = list(original["cells"])
        # The published CSV selection has one actual service row. The full
        # row continues the preceding cell edit instead of inventing another row.
        cells[column] = text
        name_column = original["headers"].index("name")
        cells[name_column] += " — authored complete-row receiving review"
        edits = [{**exact_reference(original), "action": "csv-cell", "column": column, "value": text,
            "reason": "Explicit local cell correction exercising quoted, multiline and non-ASCII physical text."},
            {**exact_reference(original), "action": "csv-row", "cells": cells,
            "reason": "Explicit complete-row correction continuing the preceding reviewed description, changing only the name in addition, and preserving every other original physical cell."}]
        request = {"label": "Authored original CSV service correction", "editionId": edition["id"],
            "actor": ACTOR, "note": "Two ordered local edits on the actual original published service row; no provider update is inferred.",
            "predecessorId": None, "edits": edits}
        return request, [original]

    def json_input(self, ws, edition, source_id, predecessor):
        rows = [row for row in self.source_rows(ws, source_id)
            if "cells" not in row and row.get("parentRecordId") and row.get("rawRange") is None
            and isinstance(row.get("data"), dict) and type(row["data"].get("name")) is str
            and type(row["data"].get("description")) is str]
        rows.sort(key=lambda row: (row["memberName"], row["pointer"], row["recordId"]))
        require(rows, "Select a complete nested original JSON row with an actual byte-range ancestor")
        row = rows[0]
        title = row["data"]["name"] + " — authored receiving review"
        request = {"label": "Authored nested JSON correction after accepted CSV edition",
            "editionId": edition["id"], "actor": ACTOR, "predecessorId": predecessor["id"],
            "note": "The nested published row is explicitly revised locally. Numeric tokens, unrelated children and the accepted CSV successor remain unchanged.",
            "edits": [{**exact_reference(row), "action": "json-set", "pointer": "/name",
                "valueJson": source.lexical_json(title),
                "reason": "Explicit local nested name correction; preserve the original name in the predecessor and full changes."},
                {**exact_reference(row), "action": "json-remove", "pointer": "/description",
                 "reason": "Explicit removal of this optional nested description in the authored successor; retain the complete original value and absence decision."}]}
        return request, [row]

    def assess(self, ws, edition, key):
        plan_input = {"label": key + " complete original HSDS assessment", "actor": ACTOR,
            "subjectKind": "editions", "subjectId": edition["id"], "family": "hsds-3.3.1",
            "profileDisposition": "selected-standard", "publisherProfile": "HSDS 3.3.1",
            "scope": "The exact retained published CSV and nested JSON examples, with explicitly authored local corrections where selected. Complete findings and limitations are retained.",
            "formatPolicy": "annotation", "tables": [], "definitionRefs": [],
            "note": "Actual source-native assessment; no blanket certification, production directory or customer acceptance claim."}
        plan = self.step(key + "-conformance-plan", plan_input, lambda: ws.save_directory_conformance_plan(plan_input))
        request = {"label": key + " complete assessment", "actor": ACTOR, "planId": plan["id"],
            "note": "Evaluate all selected original rows and the retained exact declarations."}
        assessment = self.step(key + "-conformance-assess", request, lambda: ws.assess_directory_conformance(request))
        require(assessment["subjectKind"] == "editions" and assessment["subjectId"] == edition["id"]
            and assessment["planId"] == plan["id"], "Reassessment must retain its exact corrected edition")
        for kind, descriptor in assessment["files"].items():
            path, observed = ws.directory_conformance_file("conformanceAssessments", assessment["id"], kind)
            require(matches_file(descriptor, observed), "Complete conformance file changed")
            self.copy_file(key + "-conformance-" + kind, path, descriptor,
                "conformance/" + key + "/" + observed["name"])
        return {"planId": plan["id"], "assessmentId": assessment["id"], "summary": assessment["summary"],
            "engine": assessment["engine"], "files": assessment["files"]}

    def compare_assessments(self, ws, before, after, key):
        value = {"label": key + " selected conformance comparison", "actor": ACTOR,
            "beforeAssessmentId": before["assessmentId"], "afterAssessmentId": after["assessmentId"],
            "scopeNote": "Both exact selected complete editions are retained. This compares actual rule outcomes; it does not infer entity identity, provider publication or a passing certification.",
            "note": "Authored correction receiving course."}
        result = self.step(key + "-conformance-comparison", value, lambda: ws.compare_directory_conformance(value))
        for kind, descriptor in result["files"].items():
            path, observed = ws.directory_conformance_file("conformanceComparisons", result["id"], kind)
            self.copy_file(key + "-conformance-comparison-" + kind, path, descriptor,
                "conformance/" + key + "/comparison-" + observed["name"])
        return result

    def correction_pages(self, ws, kind, ident):
        rows, offset, total = [], 0, None
        while True:
            page = ws.directory_correction_rows(kind, ident, offset=offset, limit=1)
            require(page["kind"] == kind and page["recordId"] == ident and page["offset"] == offset
                and (total is None or total == page["total"]), "Keep the original ordered correction page identity")
            total = page["total"]; rows.extend(page["rows"])
            if page["nextOffset"] is None:
                require(len(rows) == total, "The full original correction page sequence is incomplete")
                return rows
            require(page["nextOffset"] == offset + len(page["rows"]) and page["nextOffset"] > offset,
                "Advance through each complete original correction row")
            offset = page["nextOffset"]

    def preserve_records(self, ws, kind, record):
        write_once(self.root / "records" / (kind + "-" + record["id"] + ".json"), record)
        for name, descriptor in record.get("files", {}).items():
            path, observed = ws.directory_correction_file(kind, record["id"], name)
            require(matches_file(observed, descriptor), "The complete correction file accessor changed")
            self.copy_file(kind + "-" + record["id"] + "-" + name, path, descriptor,
                "corrections/" + record["id"] + "/" + observed["name"])

    def preservation(self, ws, plan, preview, originals, key):
        """Retain evidence for complete unaffected bytes, physical cells and JSON values."""
        evidence = {"planId": plan["id"], "previewId": preview["id"], "members": [],
            "rows": [], "numericTokens": [], "originalRows": originals}
        derived_rows = {}
        roots = {}
        for target in plan["targets"]:
            roots[(target["sourceId"], target["rootRecordId"])] = target
        for pair in preview["sources"]:
            sid, did = pair["sourceId"], pair["derivedSourceId"]
            old, new = ws.directory_source(sid), ws.directory_source(did)
            rows = self.source_rows(ws, did); derived_rows[sid] = rows
            changed = {item["name"]: item for item in pair["changedMembers"]}
            for member in old["members"]:
                name = member["name"]; a, ad = member_bytes(ws, sid, name)
                b, bd = member_bytes(ws, did, "source/" + name)
                retained = {"sourceId": sid, "derivedSourceId": did, "originalMember": name,
                    "derivedMember": "source/" + name, "originalFile": ad, "derivedFile": bd}
                if name not in changed:
                    require(a == b, "An unselected complete original source member changed")
                    retained.update(unchanged=True, unchangedBytes=len(a), segments=[])
                else:
                    spans = []
                    for (source_id, root_id), target in roots.items():
                        if source_id != sid or target["memberName"] != name: continue
                        original_root = ws.directory_source_row(sid, root_id)
                        matches = [row for row in rows if row["memberName"] == "source/" + name
                            and row["pointer"] == original_root["pointer"] and row["table"] == original_root["table"]]
                        require(len(matches) == 1 and matches[0].get("rawRange") is not None,
                            "Reopen the one exact derived ancestor row, retaining its complete member and pointer")
                        current_root = matches[0]
                        spans.append((original_root["rawRange"], current_root["rawRange"]))
                        if "cells" not in original_root:
                            excluded = set()
                            prefix = tokens(original_root["pointer"])
                            for edit in plan["edits"]:
                                if edit["sourceId"] != sid: continue
                                selected = next(t for t in plan["targets"] if t["sourceId"] == sid and t["recordId"] == edit["recordId"])
                                if selected["rootRecordId"] == root_id:
                                    excluded.add(tuple(tokens(selected["pointer"])[len(prefix):] + tokens(edit["pointer"])))
                            checked = lexical_preservation(original_root["data"], current_root["data"], excluded)
                            evidence["numericTokens"].extend({"sourceId": sid, "rootRecordId": root_id, **token}
                                for token in checked.pop("numberTokens"))
                            retained.setdefault("lexicalChecks", []).append({"rootRecordId": root_id,
                                "derivedRootRecordId": current_root["recordId"], **checked,
                                "excludedPointers": [list(p) for p in sorted(excluded)]})
                    old_at = new_at = 0; segments = []
                    for (start, end), (next_start, next_end) in sorted(spans):
                        require(start >= old_at and next_start >= new_at and a[old_at:start] == b[new_at:next_start],
                            "Original bytes outside selected ancestor ranges changed")
                        segments.append({"originalRange": [old_at, start], "derivedRange": [new_at, next_start],
                            "bytes": start - old_at, "sha256": source.sha(a[old_at:start])})
                        old_at, new_at = end, next_end
                    require(a[old_at:] == b[new_at:], "The unchanged original member tail changed")
                    segments.append({"originalRange": [old_at, len(a)], "derivedRange": [new_at, len(b)],
                        "bytes": len(a) - old_at, "sha256": source.sha(a[old_at:])})
                    retained.update(unchanged=False, unchangedBytes=sum(row["bytes"] for row in segments),
                        segments=segments, selectedRanges=changed[name]["ranges"])
                evidence["members"].append(retained)
            require([(d["name"], d["selection"]) for d in new["documents"]] == [("source/" + d["name"], d["selection"])
                for d in old["documents"]], "The corrected capture changed the original parsing decisions")
        for original in originals:
            sid = original["sourceId"]; rows = derived_rows[sid]
            matches = [row for row in rows if row["memberName"] == "source/" + original["memberName"]
                and row["pointer"] == original["pointer"] and row["table"] == original["table"]]
            require(len(matches) == 1, "Reopen one complete derived row for the selected original pointer")
            after = matches[0]
            edits = [edit for edit in plan["edits"] if edit["sourceId"] == sid and edit["recordId"] == original["recordId"]]
            if "cells" in original:
                expected = list(original["cells"])
                for edit in edits:
                    if edit["action"] == "csv-row": expected = edit["cells"]
                    else:
                        while len(expected) <= edit["column"]: expected.append("")
                        expected[edit["column"]] = edit["value"]
                require(after["headers"] == original["headers"] and after["cells"] == expected,
                    "Original physical headers or explicitly reviewed cell values changed")
                checked = {"representation": "csv", "samePhysicalHeaders": True,
                    "unmodifiedColumns": [i for i, (a, b) in enumerate(zip(original["cells"], expected)) if a == b]}
            else:
                for edit in edits:
                    path = tokens(edit["pointer"])
                    if edit["action"] == "json-remove":
                        parent = path_at(after["data"], path[:-1])
                        require(isinstance(parent, dict) and path[-1] not in parent,
                            "The authored JSON absence decision was not retained")
                    else:
                        require(source.lexical_json(path_at(after["data"], path)) ==
                            source.lexical_json(source.json_value(edit["valueJson"], lexical=True)),
                            "The authored lexical JSON value differs from its reviewed input")
                checked = {"representation": "json", "nestedOriginal": bool(original.get("parentRecordId")),
                    "originalRawRange": original.get("rawRange"), "ancestorRetained": True}
            evidence["rows"].append({"original": original, "derived": after, "checks": checked})
        evidence["numericTokensSha256"] = source.sha(source.jbytes(evidence["numericTokens"]))
        evidence["sameOriginalRecordHashes"] = self.native_records(ws) == self.journal["originalRecords"]
        require(evidence["sameOriginalRecordHashes"], "The original completed Directory records changed")
        return write_once(self.root / ("PRESERVATION_" + key + ".json"), evidence)

    def accepted_case(self, ws, key, request, original_rows, replay):
        write_once(self.root / ("PREPARE_" + key + ".json"), request)
        plan = self.step(key + "-prepare", request, lambda: ws.prepare_directory_correction(request))
        preview_input = {"planId": plan["id"]}
        preview = self.step(key + "-preview", preview_input, lambda: ws.preview_directory_correction(preview_input))
        require(ws.preview_directory_correction(preview_input)["id"] == preview["id"],
            "An exact preview replay must reuse the original derived source edition")
        apply = {"previewId": preview["id"], "expectedEditionId": request["editionId"], "actor": ACTOR,
            "note": "Explicitly accept only this complete reviewed local correction preview."}
        accepted = self.step(key + "-apply", apply, lambda: ws.apply_directory_correction(apply))
        require(ws.apply_directory_correction(apply)["id"] == accepted["id"],
            "An exact acceptance replay must retain the original correction receipt")
        require(accepted["editionId"] == preview["candidateEditionId"] and
            accepted["beforeEditionId"] == request["editionId"], "The accepted correction edition changed")
        changes = self.correction_pages(ws, "corrections", accepted["id"])
        require(len(changes) == len(request["edits"]) and
            all(row["ordinal"] == n and row["edit"] == edit for n, (row, edit) in enumerate(zip(changes, request["edits"]), 1)),
            "The complete original ordered changes differ from the accepted input")
        for kind, record in (("correctionPlans", plan), ("correctionPreviews", preview), ("corrections", accepted)):
            self.preserve_records(ws, kind, record)
        preservation = self.preservation(ws, plan, preview, original_rows, key)
        export_input = {"correctionId": accepted["id"], "actor": ACTOR,
            "label": "Complete " + key + " correction and source graph", "note": "All original files, editions and accepted decisions."}
        exported = self.step(key + "-export", export_input, lambda: ws.export_directory_correction(export_input))
        path = ws._directory_file_path(exported["file"])
        exported_file = self.copy_file(key + "-correction-export", path, exported["file"], "exports/" + exported["name"])
        self.verify_correction_packet(ws, path, accepted)
        replay.extend([{"key": key + "-" + action, "action": action, "input": value,
            "expectedRecordId": record["id"]} for action, value, record in
            (("prepare", request, plan), ("preview", preview_input, preview),
             ("apply", apply, accepted), ("export", export_input, exported))])
        return {"editionId": request["editionId"], "planId": plan["id"], "previewId": preview["id"],
            "correctionId": accepted["id"], "comparisonId": preview["comparisonId"],
            "candidateEditionId": preview["candidateEditionId"], "acceptedEditionId": accepted["editionId"],
            "sources": preview["sources"], "summary": accepted["summary"], "preservation": preservation,
            "export": {"record": exported, "file": exported_file}, "changes": changes,
            "originalRowRefs": [exact_reference(row) for row in original_rows]}

    def verify_correction_packet(self, ws, path, accepted):
        with zipfile.ZipFile(path) as archive:
            manifest_raw, record_raw = archive.read("manifest.json"), archive.read("records.json")
            manifest, graph = source.json_value(manifest_raw), source.json_value(record_raw)
            require(manifest["schema"] == PACKET_SCHEMA and manifest["workspaceId"] == ws.workspace_id
                and manifest["correctionId"] == accepted["id"] and manifest["editionId"] == accepted["editionId"]
                and manifest["recordsSha256"] == source.sha(record_raw), "The complete correction packet changed its reviewed identity")
            names = {"manifest.json", "records.json"} | {"files/" + f["sha256"] + ".bin" for f in manifest["files"]}
            require(set(archive.namelist()) == names and len(archive.namelist()) == len(names),
                "The complete correction packet contains missing, repeated or undeclared members")
            for descriptor in manifest["files"]:
                h = hashlib.sha256(); size = 0
                with archive.open("files/" + descriptor["sha256"] + ".bin") as stream:
                    while block := stream.read(65536): h.update(block); size += len(block)
                require(size == descriptor["bytes"] and h.hexdigest() == descriptor["sha256"],
                    "The complete exported original correction file changed")
            for kind, records in graph["records"].items():
                require(manifest["recordCounts"][kind] == len(records), "The complete correction graph lost an original record")
                for row in records:
                    require(ws.directory_record(kind, row["id"]) == row, "An exported correction graph record differs")
            require(any(row["id"] == accepted["id"] for row in graph["records"]["corrections"]),
                "The packet omitted its actual accepted correction")
        return {"manifest": manifest, "recordCounts": manifest["recordCounts"], "allOriginalFilesVerified": True}

    def http_receiving(self, ws, cases, replay):
        result = {"workspaceId": ws.workspace_id, "requests": [], "allOriginalRequestsReused": False}
        with OperatorServer(ws, 0, expected_workspace_id=ws.workspace_id) as server:
            worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            worker.start()
            base = server.url.split("#", 1)[0].rstrip("/")
            try:
                def request(route, value=None, expected_file=None):
                    data = source.jbytes(value) if value is not None else None
                    headers = {"Authorization": "Bearer " + server.token}
                    if data is not None: headers["Content-Type"] = "application/json"
                    req = urllib.request.Request(base + route, data=data, headers=headers)
                    h = hashlib.sha256(); size = 0; blocks = []
                    with urllib.request.urlopen(req, timeout=180) as response:
                        require(response.status == 200, "The complete authenticated native correction route failed")
                        while block := response.read(65536):
                            h.update(block); size += len(block)
                            if expected_file is None:
                                require(size <= 64 * 1024 * 1024, "Receive this original response through its complete file route")
                                blocks.append(block)
                        row = {"route": route, "method": "POST" if data is not None else "GET",
                            "status": response.status, "bytes": size, "sha256": h.hexdigest()}
                    result["requests"].append(row)
                    if expected_file is not None:
                        require(matches_file(row, expected_file), "The full authenticated original file differs")
                        return row
                    return source.json_value(b"".join(blocks))
                for item in replay:
                    observed = request("/api/directory/corrections/" + item["action"], item["input"])
                    require(observed["id"] == item["expectedRecordId"],
                        "The exact authenticated correction request must reuse its original immutable result")
                for key, case in cases.items():
                    for kind, ident in (("correctionPlans", case["planId"]), ("correctionPreviews", case["previewId"]),
                                        ("corrections", case["correctionId"])):
                        record = ws.directory_record(kind, ident)
                        route = "/api/directory/" + kind + "/" + ident
                        require(request(route) == record, "The authenticated complete correction record changed")
                        pages, offset, total = [], 0, None
                        while True:
                            page = request(route + "/rows?offset=" + str(offset) + "&limit=1")
                            require(page["kind"] == kind and page["recordId"] == ident and page["offset"] == offset
                                and (total is None or page["total"] == total), "The original HTTP correction page identity changed")
                            total = page["total"]; pages.extend(page["rows"])
                            if page["nextOffset"] is None: break
                            require(page["nextOffset"] == offset + len(page["rows"]) and page["nextOffset"] > offset,
                                "Follow the complete contiguous original HTTP correction pages")
                            offset = page["nextOffset"]
                        require(len(pages) == total and pages == self.correction_pages(ws, kind, ident),
                            "The authenticated correction page sequence lost an original change")
                        for file_kind, descriptor in record["files"].items():
                            request(route + "/files/" + file_kind, expected_file=descriptor)
                    export = case["export"]["record"]
                    request("/api/directory/exports/" + export["id"] + "/file", expected_file=export["file"])
                result["allOriginalRequestsReused"] = True
            finally:
                server.shutdown(); worker.join(timeout=10)
        write_once(self.root / "HTTP_CORRECTIONS.json", result)
        return result

    def cli_receiving(self, ws, cases, replay):
        folder = private_dir(self.root / "cli")
        result = {"requests": [], "allOriginalRequestsReused": False}
        def invoke(key, arguments):
            argv = [sys.executable, "-B", str(HERE / "cli.py"), *arguments]
            proc = subprocess.run(argv, capture_output=True, timeout=300)
            files = {}
            for name, raw in (("stdout", proc.stdout), ("stderr", proc.stderr)):
                target = folder / (key + "." + name)
                if target.exists(): require(target.read_bytes() == raw, "Keep the complete original CLI stream")
                else: original_workspace.private_write(target, raw)
                files[name] = info(target)
            result["requests"].append({"argv": argv, "exitCode": proc.returncode, "files": files})
            require(proc.returncode == 0, "The original CLI correction command failed: " + proc.stderr.decode(errors="replace"))
            return source.json_value(proc.stdout)
        for item in replay:
            input_path = folder / (item["key"] + "-input.json")
            write_once(input_path, item["input"])
            value = invoke(item["key"], ["correction-" + item["action"], "--workspace", str(self.workspace),
                "--input", str(input_path)])
            require(value["id"] == item["expectedRecordId"], "The exact CLI request changed an original correction record")
        for key, case in cases.items():
            ident = case["correctionId"]
            page = invoke(key + "-rows", ["rows", "--workspace", str(self.workspace), "--kind", "correction",
                "--collection", "corrections", "--id", ident, "--offset", "0", "--limit", "250"])
            require(page["nextOffset"] is None and page["rows"] == case["changes"],
                "The original CLI must retain every complete ordered correction in this selected course")
            record = ws.directory_record("corrections", ident)
            target = folder / (key + "-accepted-review.json")
            descriptor = record["files"]["review"]
            if target.exists():
                require(matches_file(info(target), descriptor), "Retain the earlier complete original CLI file")
            else:
                invoke(key + "-review-file", ["file", "--workspace", str(self.workspace), "--kind", "correction",
                    "--collection", "corrections", "--id", ident, "--member", "review", "--out", str(target)])
                require(matches_file(info(target), descriptor), "The full original CLI file differs")
            result.setdefault("reviewFiles", {})[key] = info(target)
        result["allOriginalRequestsReused"] = True
        write_once(self.root / "CLI_CORRECTIONS.json", result)
        return result

    def operate(self):
        if not self.workspace.exists():
            require(self.archive is not None, "Receive the exact completed original packet into this distinct workspace")
            private_dir(self.workspace.parent)
        with Workspace(self.workspace, create=not self.workspace.exists()) as ws:
            originals = self.receive_original(ws)
            selected = self.original_sources(ws)
            csv_source = selected["original-csv"]["record"]
            json_source = selected["organization_full.json"]["record"]
            basis_input = {"label": "Original published CSV and nested JSON correction basis",
                "sourceIds": [csv_source["id"], json_source["id"]], "tables": [], "scope": "subset",
                "actor": ACTOR, "note": "Explicit local selection of the complete retained publisher examples, not a new provider acquisition."}
            basis = self.step("02-original-correction-edition", basis_input, lambda: ws.directory_edition(basis_input))
            before = self.assess(ws, basis, "03-original")
            replay = []
            csv_input, csv_rows = self.csv_input(ws, basis, csv_source["id"])
            first = self.accepted_case(ws, "04-csv", csv_input, csv_rows, replay)
            csv_edition = ws.directory_record("editions", first["candidateEditionId"])
            csv_assessment = self.assess(ws, csv_edition, "05-csv")
            csv_comparison = self.compare_assessments(ws, before, csv_assessment, "06-csv")
            first["conformance"] = csv_assessment
            first["conformanceComparisonId"] = csv_comparison["id"]
            first_correction = ws.directory_record("corrections", first["correctionId"])
            json_input, json_rows = self.json_input(ws, csv_edition, json_source["id"], first_correction)
            second = self.accepted_case(ws, "07-json", json_input, json_rows, replay)
            json_edition = ws.directory_record("editions", second["candidateEditionId"])
            json_assessment = self.assess(ws, json_edition, "08-json")
            json_comparison = self.compare_assessments(ws, csv_assessment, json_assessment, "09-json")
            second["conformance"] = json_assessment
            second["conformanceComparisonId"] = json_comparison["id"]
            require(ws.directory_record("corrections", second["correctionId"])["predecessorId"] == first["correctionId"]
                and json_edition["predecessorId"] == csv_edition["id"],
                "The second accepted correction must continue the first complete accepted edition")
            first_pairs = {r["sourceId"]: r["derivedSourceId"] for r in first["sources"]}
            require(first_pairs[csv_source["id"]] in json_edition["sourceIds"]
                and first_pairs[csv_source["id"]] in csv_edition["sourceIds"],
                "Nested JSON receiving must preserve the complete accepted CSV successor")
            cases = {"csv": first, "json": second}
            native_check = self.step("10-full-semantic-receiving-verification",
                {"cases": {key: value["correctionId"] for key, value in cases.items()}},
                lambda: ws._verify_directory_corrections())
            http = self.step("11-original-http-receiving", {"replay": replay},
                lambda: self.http_receiving(ws, cases, replay))
            cli = self.step("12-original-cli-receiving", {"replay": replay},
                lambda: self.cli_receiving(ws, cases, replay))
            require(self.native_records(ws) == originals, "The correction course changed original Directory records")
            packet_path = self.root / "Directory_Corrections_Complete_Editable_Workspace.zip"
            expected = complete_record_hashes(ws)
            def export_packet():
                if not packet_path.exists(): ws.export_workspace(packet_path)
                with zipfile.ZipFile(packet_path) as archive:
                    registry = source.json_value(archive.read("directory-registry.json"))
                observed = {kind: {row["id"]: source.sha(source.jbytes(row))
                    for row in registry["records"].get(kind, [])} for kind in expected}
                require(observed == expected, "The full correction export lost or changed original native records")
                return info(packet_path)
            packet = self.step("13-complete-correction-workspace-export",
                {"recordHashes": expected, "workspaceId": ws.workspace_id}, export_packet)
            with zipfile.ZipFile(packet_path) as archive:
                registry = source.json_value(archive.read("directory-registry.json"))
            write_once(self.root / "EXPORTED_CORRECTIONS_REGISTRY.json", registry)
            producer_records = {kind: [row["id"] for row in records] for kind, records in registry["records"].items()}
        restored = self.root / "received-workspace"
        with Workspace(restored, create=not restored.exists()) as target:
            restoration = self.step("14-full-customer-workspace-receive", packet,
                lambda: self._receive(target, packet_path))
            require(complete_record_hashes(target) == expected,
                "Every complete original, authored and assessed record must match after full receiving")
            for kind, rows in registry["records"].items():
                if kind != "receives":
                    require(target.directory_records(kind) == rows, "Complete received correction collection differs: " + kind)
            correction_check = target._verify_directory_corrections()
            conformance_result = target._verify_conformance_received(registry)
            conformance_check = {"completed": True, "nativeResult": conformance_result}
            require(self.native_records(target) == originals, "Independent customer receiving lost an original Directory record")
            # Reopen every retained source and native index, including unchanged
            # publisher input and both complete corrected source captures.
            reopened = []
            for kind in ("sources", "editions", "comparisons"):
                for row in target.directory_records(kind):
                    path, descriptor = target.directory_index_file(kind, row["id"])
                    require(matches_file(info(path), descriptor), "A complete received native index changed")
                    if kind == "sources":
                        path, descriptor = target.directory_source_file(row["id"])
                        require(matches_file(info(path), descriptor), "A complete received original source changed")
                    reopened.append({"kind": kind, "id": row["id"], "indexFile": row["indexFile"]})
            for case in cases.values():
                for kind, ident in (("correctionPlans", case["planId"]), ("correctionPreviews", case["previewId"]),
                                    ("corrections", case["correctionId"])):
                    for file_kind, descriptor in target.directory_record(kind, ident)["files"].items():
                        path, actual = target.directory_correction_file(kind, ident, file_kind)
                        require(matches_file(info(path), descriptor) and matches_file(actual, descriptor),
                            "Cold receiving lost a complete accepted correction input or review")
        # A distinct close/reopen observes the persisted database and original
        # receiver receipt, without resyncing state timestamps for comparison.
        with Workspace(restored, create=False) as target:
            require(target.workspace_id == self.native["workspaceId"] and complete_record_hashes(target) == expected,
                "Cold reopening changed the complete received correction workspace")
            receive = target.directory_record("receives", packet["sha256"])
            require(receive["state"] == "complete" and receive["kind"] == "workspace"
                and receive["workspaceId"] == target.workspace_id, "Cold reopening lost the exact native archive receipt")
            for item in replay:
                if item["action"] == "export": continue
                method = {"prepare": target.prepare_directory_correction,
                    "preview": target.preview_directory_correction, "apply": target.apply_directory_correction}[item["action"]]
                require(method(item["input"])["id"] == item["expectedRecordId"],
                    "The complete customer workspace must reuse each original accepted correction request")
            require(complete_record_hashes(target) == expected,
                "Exact original customer replay created another correction record")
        self.journal.setdefault("completedAt", now()); self.save()
        result = {"schema": RESULT_SCHEMA, "operation": OPERATION, "completedAt": self.journal["completedAt"],
            "workspace": str(self.workspace), "workspaceId": self.native["workspaceId"], "sourceRoot": str(HERE),
            "originalDirectoryReceiving": self.journal["inputs"]["receiving"],
            "originalDirectoryPacket": self.native["workspacePacket"],
            "originalDirectoryRecordHashes": originals, "originalSourceInputs": [v["input"] for v in selected.values()],
            "basisEditionId": basis["id"], "latestEditionId": json_edition["id"], "cases": cases,
            "originalConformance": before, "assessmentIds": [before["assessmentId"], csv_assessment["assessmentId"], json_assessment["assessmentId"]],
            "conformanceComparisonIds": [csv_comparison["id"], json_comparison["id"]],
            "recordIds": producer_records, "connectedInputs": {"replay": replay},
            "verification": native_check, "http": http, "cli": cli,
            "workspacePacket": packet, "files": self.journal["files"],
            "exports": [value["export"] for value in cases.values()],
            "restoration": {**restoration, "workspace": str(restored), "corrections": correction_check,
                "conformance": conformance_check, "reopenedIndices": reopened,
                "reopened": True, "allOriginalRecordsEqual": True, "allPortableRecordsEqual": True,
                "sameOriginalRequestsReused": True},
            "journal": str(self.path),
            "meaning": "Two explicitly authored local correction editions preserve original published source bytes, typed values, numeric lexemes and complete accepted history. Actual conformance outcomes are retained without blanket certification. No provider publication or external customer acceptance is inferred."}
        descriptor = write_once(self.root / "OPERATED_DIRECTORY_CORRECTIONS.json", result)
        self.journal["result"] = descriptor; self.save()
        self.emit("DIRECTORY_CORRECTIONS_COMPLETE", result=descriptor, workspacePacket=packet)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("receiving", "receiving-sha256", "workspace", "out"):
        parser.add_argument("--" + flag, required=True)
    parser.add_argument("--archive")
    operation = Operation(parser.parse_args(argv))
    try:
        operation.operate()
        return 0
    except BaseException as error:
        import traceback
        operation.journal["failures"].append({"at": now(), "type": type(error).__name__,
            "message": str(error), "traceback": traceback.format_exc()})
        operation.save()
        operation.emit("DIRECTORY_CORRECTIONS_INTERRUPTED", journal=str(operation.path),
            error={"type": type(error).__name__, "message": str(error)})
        raise

if __name__ == "__main__":
    raise SystemExit(main())
