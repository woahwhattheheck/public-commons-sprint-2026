#!/usr/bin/env python3
"""Operate the declared-key conformance edition on complete retained Directory sources.

This is the source-specific receiving procedure for the new implementation
edition. It reuses original publisher CSV/JSON, their already-retained authored
description successor, native editions and the original assessment/review/store.
It opens no publisher endpoint and creates no invented standard declarations.
Use an explicitly received copy of the existing Directory workspace.
"""
from __future__ import annotations
import argparse
from collections import Counter
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import zipfile

from directory_runtime import source, original_workspace, atomic_json
from directory_workspace import Workspace
from directory_server import OperatorServer
import directory_schema as schema
from directory_conformance import engine_identity, KINDS
import directory_conformance_foreign_keys as foreign_keys
import operate_conformance as original

OPERATION = "SCF-DIRECTORY-CONFORMANCE-FOREIGN-KEYS-450E-20261013"
JOURNEY_SCHEMA = "stellar-forge.directory-foreign-keys-journey.v1"
RESULT_SCHEMA = "stellar-forge.directory-foreign-keys-operated.v1"
ACTOR = "450E declared-key source receiving"
ORIGINAL_UUID = "2c51f522-4852-463b-bdc0-59389d7bae83"
CSV = original.HSDS
SUCCESSOR = original.SUCCESSOR
TABULAR = "56fd957003a1f32f90af3c7fbe357a80927cb75575a0e4072377d17721056c0e"
NESTED = "23062b8382a95d5d173187a9defb0bf3bbbfb8c249333d1ae61a69558eef76a9"
ORIGINALS = {
    CSV: original.ORIGINALS[CSV],
    SUCCESSOR: original.ORIGINALS[SUCCESSOR],
    TABULAR: "ab60ac605315f202ae4146207e7499ddc947790e1dc210434cfea2aa852ef493",
    NESTED: "e4d689dbb64e81cf968b37e6df43b7d0dfef22632c0898878539824a044105cf",
}
utc, require, info, read_json, write_json = original.utc, original.require, original.info, original.read_json, original.write_json

def emit(stage, **value):
    print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

def private(path):
    path = Path(path).absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    current = path.lstat()
    require(stat.S_ISDIR(current.st_mode) and not path.is_symlink() and
            stat.S_IMODE(current.st_mode) == 0o700 and current.st_uid == os.getuid(),
            "Use an existing owned private receiving directory: " + str(path))
    return path

def records(ws, kind):
    """Receive the original native registry through its complete contiguous pages."""
    offset = 0
    while True:
        page = ws.directory_records(kind, offset, 100)
        require(page["offset"] == offset, "The original registry page moved")
        yield from page["rows"]
        next_offset = page["nextOffset"]
        if next_offset is None:
            require(offset + len(page["rows"]) == page["total"], "Receive the complete original registry")
            break
        require(next_offset == offset + len(page["rows"]) and next_offset > offset,
                "The original registry cursor must advance contiguously")
        offset = next_offset

def immutable_inventory(ws):
    return {kind: {row["id"]: source.sha(source.jbytes(row)) for row in records(ws, kind)}
            for kind in sorted(schema.KINDS - schema.MUTABLE)}

def assert_original_inventory(ws, expected):
    current = immutable_inventory(ws)
    for kind, rows in expected.items():
        require(all(current.get(kind, {}).get(ident) == digest for ident, digest in rows.items()),
                "An original immutable Directory record changed: " + kind)
    return current

def edition_request(key, selections):
    tables = list(selections[0][1])
    require(all(list(row[1]) == tables for row in selections),
            "The native edition applies one exact table selection to all selected sources")
    return {"label": "Declared-key receiving: " + key,
        "sourceIds": [row[0] for row in selections], "predecessorId": None,
        "tables": tables, "scope": "subset",
        "actor": ACTOR,
        "note": "Exact retained original source selection for " + key +
                ". This assessment operation preserves every original source and identity; no publisher completeness is inferred."}

class Operation(original.Operation):
    def __init__(self, args):
        self.args = args
        self.root = private(args.out)
        self.workspace = Path(args.workspace).absolute()
        self.path = self.root / "FOREIGN_KEYS_JOURNEY.json"
        self.inputs = {
            "operation": OPERATION, "workspace": str(self.workspace),
            "sourceRoot": str(Path(__file__).resolve().parent),
            "workspaceId": ORIGINAL_UUID, "originalSha256": ORIGINALS,
            "engine": engine_identity(),
            "interpretation": foreign_keys.POLICY,
        }
        require(self.inputs["engine"]["implementationEdition"] == foreign_keys.EDITION,
                "Select the complete declared-key conformance implementation edition")
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["schema"] == JOURNEY_SCHEMA and self.journal["inputs"] == self.inputs,
                    "Resume the same declared-key operation, workspace and exact source")
        else:
            self.journal = {"schema": JOURNEY_SCHEMA, "inputs": self.inputs, "createdAt": utc(),
                            "steps": {}, "files": {}, "failures": []}
            self.save()

    def step(self, key, request, call):
        request_sha = source.sha(source.jbytes(request))
        old = self.journal["steps"].get(key)
        if old:
            require(old["requestSha256"] == request_sha and old["request"] == request,
                    "Retain the exact original prepared declared-key request")
            if old.get("state") == "complete":
                return old["result"]
        else:
            self.journal["steps"][key] = {"state": "prepared", "requestSha256": request_sha,
                "request": request, "preparedAt": utc()}
            self.save()
        result = call()
        self.journal["steps"][key].update(state="complete", result=result, completedAt=utc())
        self.save()
        emit("DIRECTORY_FOREIGN_KEYS_STEP", key=key,
             id=result.get("id") if isinstance(result, dict) else None)
        return result

    def related_pages(self, ws, assessment):
        callables = (
            ("foreignKeys", ws.directory_conformance_foreign_keys, "outcomeRows"),
            ("foreignKeyCandidates", ws.directory_conformance_foreign_key_candidates, "candidateRows"),
            ("foreignKeyMatches", ws.directory_conformance_foreign_key_matches, "matchRows"),
        )
        result = {}
        for name, call, expected_key in callables:
            offset, count = 0, 0
            states = Counter()
            first = None
            while True:
                page = call(assessment["id"], offset, 100)
                require(page["assessmentId"] == assessment["id"] and page["offset"] == offset,
                        "Keep the original assessment and exact relationship offset")
                if first is None and page["rows"]:
                    first = page["rows"][0]
                count += len(page["rows"])
                for row in page["rows"]:
                    if "state" in row:
                        states[row["state"]] += 1
                nxt = page["nextOffset"]
                if nxt is None:
                    require(count == page["total"], "Receive every original relationship record")
                    break
                require(nxt == offset + len(page["rows"]) and nxt > offset,
                        "Complete relationship pages must be contiguous")
                offset = nxt
            require(count == assessment["summary"]["foreignKeys"][expected_key],
                    "Complete relationship pages differ from the original assessment coverage")
            result[name] = {"rows": count, "states": dict(states), "first": first}
        return result

    def pages(self, ws, assessment):
        return {"originalAssertions": super().pages(ws, assessment),
                "relationships": self.related_pages(ws, assessment)}

    def coverage(self, ws, assessment):
        path, descriptor = ws.directory_conformance_file(
            "conformanceAssessments", assessment["id"], "foreignKeyCoverage")
        require(info(path)["sha256"] == descriptor["sha256"],
                "The complete original coverage file changed")
        value = read_json(path)
        require(value["implementationEdition"] == foreign_keys.EDITION and
                value["declaredForeignKeys"] == 38 and value["declaredCompositeKeys"] == 0,
                "Retain the actual 38 single-field declarations; do not invent a composite example")
        require(value["originalDatapackageVersion"] == "3.0.0",
                "Keep the original datapackage metadata alongside the selected HSDS 3.3.1 release")
        return value

    def assess(self, ws, key, subject_kind, subject_id, tables, scope):
        request = {
            "label": "Declared-key receiving — " + key, "actor": ACTOR,
            "subjectKind": subject_kind, "subjectId": subject_id, "family": "hsds-3.3.1",
            "tables": tables, "profileDisposition": "selected-standard",
            "publisherProfile": "HSDS 3.3.1 release; original compiled datapackage version 3.0.0",
            "scope": scope, "formatPolicy": "assert", "definitionRefs": [],
            "note": "Every published row/member and original field interpretation is retained. "
                    "The current implementation edition adds declared-key outcomes, complete targets and matching edges.",
        }
        plan = self.step(key + "-plan", request,
                         lambda: ws.save_directory_conformance_plan(request))
        request = {"label": "Complete declared-key assessment — " + key, "actor": ACTOR,
            "planId": plan["id"],
            "note": "Original references, physical absence/missing markers, exact key interpretation "
                    "and complete target coverage are separate retained evidence."}
        assessment = self.step(key + "-assessment", request,
                               lambda: ws.assess_directory_conformance(request))
        require(ws.assess_directory_conformance(request) == assessment,
                "A repeated exact assessment must reopen its original immutable record")
        ws._verify_conformance_assessment(assessment)
        page_result = self.pages(ws, assessment)
        coverage = self.coverage(ws, assessment)
        review = self.review(ws, key, assessment)
        for kind, record in (("conformanceAssessments", assessment), ("conformanceReviews", review)):
            for file_kind in record["files"]:
                path, descriptor = ws.directory_conformance_file(kind, record["id"], file_kind)
                self.copy(key + "-" + kind + "-" + file_kind, path, descriptor, descriptor["name"])
        self.journal["steps"][key + "-assessment"]["completePages"] = page_result
        self.save()
        return {"key": key, "plan": plan, "assessment": assessment, "review": review,
                "coverage": coverage, "pages": page_result}

    def empty_table_source(self, ws, original_case):
        """Author one explicit deletion edition without changing publisher bytes."""
        domains = [row for row in original_case["coverage"]["tableDomains"]
                   if row["sourceId"] == TABULAR and row["table"] == "organization" and row["selected"]]
        require(len(domains) == 1, "Select the one exact original organization table member")
        domain = domains[0]
        path, descriptor = ws.directory_source_file(TABULAR, domain["memberName"])
        require(descriptor["sha256"] == ORIGINALS[TABULAR] == domain["memberSha256"],
                "The authored deletion must use the complete original tabular.json")
        raw = path.read_bytes()
        start, end = domain["rawRange"]
        require(0 <= start < end <= len(raw) and raw[start:start + 1] == b"[" and
                raw[end - 1:end] == b"]" and len(source.json_value(raw[start:end])) == domain["tableRows"] == 1,
                "Retain the exact original array and byte range before its explicit deletion")
        changed = raw[:start] + b"[]" + raw[end:]
        folder = private(self.root / "authored-empty-table")
        target = folder / "HSDS_authored_empty_organization_table.json"
        if target.exists():
            require(target.read_bytes() == changed, "Keep this complete original authored deletion edition")
        else:
            original_workspace.private_write(target, changed)
        source_record = ws.directory_source(TABULAR)
        profile = {**source_record["interpretation"],
            "label": "Authored empty organization table from original HSDS tabular.json",
            "filename": target.name, "origin": "authored_example", "scope": "subset",
            "note": "Explicit authored receiving example: replace only the original organization array at " +
                    domain["pointer"] + " with []. Every other original byte is unchanged. The complete " +
                    "publisher predecessor remains retained; this is not a publisher update."}
        request = {"profile": profile, "file": info(target), "originalSourceId": TABULAR,
            "originalSha256": descriptor["sha256"], "originalPointer": domain["pointer"],
            "originalRawRange": domain["rawRange"], "removedBytes": end - start,
            "removedSha256": source.sha(raw[start:end]), "replacement": "[]",
            "replacementSha256": source.sha(b"[]")}
        record = self.step("authored-empty-organization-source", request,
                           lambda: ws.directory_import(target, profile))
        require(record["originalSha256"] == info(target)["sha256"],
                "The native authored source must retain its complete intended bytes")
        self.copy("empty-table-original-predecessor", path, descriptor, "Original_HSDS_tabular.json")
        derived_path, derived_descriptor = ws.directory_source_file(record["id"])
        self.copy("empty-table-authored-source", derived_path, derived_descriptor, target.name)
        derivation = {"schema": "stellar-forge.directory-authored-table-deletion.v1",
            "operation": OPERATION, "sourceId": record["id"], "originalSourceId": TABULAR,
            "originalFile": descriptor, "derivedFile": derived_descriptor, "request": request,
            "otherOriginalBytesUnchanged": True,
            "meaning": "Authored deletion of one complete retained table array, used to operate empty-table coverage. No original publisher source is modified or relabelled."}
        write_json(folder / "AUTHORED_TABLE_DELETION.json", derivation)
        return record, derivation

    def observe_cases(self, ws, cases):
        """Check the actual retained publisher examples and native edition choices."""
        by_key = {item["key"]: item for item in cases}
        csv = by_key["original-csv"]
        original_states = csv["coverage"]["states"]
        require(original_states["resolved"] > 0 and original_states["missing-target"] > 0,
                "The original CSV must retain both present relationships and its original absent target IDs")
        missing = ws.directory_conformance_foreign_keys(csv["assessment"]["id"], 0, 100,
                                                        table="location", state="missing-target")
        require(missing["total"] > 0, "Keep the original location's missing organization relationship")
        target_ids = set()
        for row in missing["rows"]:
            original_row = ws.directory_source_row(row["ref"]["sourceId"], row["ref"]["recordId"])
            require(original_row["data"].get("organization_id") == "985e4a42-bd9f-4edc-911d-0243a4640aca",
                    "The missing target observation must come from the exact original published location")
            target_ids.add(original_row["data"]["organization_id"])
            require(row["targetCoverage"]["establishedTabularCoverage"] and row["candidateCount"] == 0,
                    "Distinguish a missing target within received table coverage from an absent table")

        context = by_key["selected-service-with-original-context"]
        require(context["assessment"]["summary"]["selectedRows"] > 0 and
                context["coverage"]["states"]["resolved"] == context["coverage"]["outcomeRows"] and
                context["coverage"]["states"]["target-table-unavailable"] == 0,
                "Selecting child service assertions retains the full original organization/program target context")

        restricted = by_key["service-only-edition"]
        require(restricted["coverage"]["states"]["target-table-unavailable"] ==
                restricted["coverage"]["outcomeRows"] and restricted["coverage"]["outcomeRows"] > 0,
                "The explicitly restricted service edition must report unreceived target tables")
        require(restricted["coverage"]["states"]["missing-target"] == 0,
                "An excluded original target table is not a declaration of remote nonexistence")

        combined = by_key["two-original-editions"]
        require(combined["coverage"]["states"]["ambiguous"] > 0,
                "The two retained editions must keep their repeated original target identities")
        ambiguous = ws.directory_conformance_foreign_keys(combined["assessment"]["id"], 0, 1,
                                                          state="ambiguous")
        require(ambiguous["rows"], "Keep an actual complete ambiguous relationship")
        selected = ambiguous["rows"][0]
        edges, offset = [], 0
        while True:
            page = ws.directory_conformance_foreign_key_matches(combined["assessment"]["id"],
                                                                offset, 100, outcome_id=selected["id"])
            edges.extend(page["rows"])
            if page["nextOffset"] is None:
                break
            offset = page["nextOffset"]
        require(len(edges) == selected["candidateCount"] and len(edges) >= 2 and
                {edge["targetRef"]["sourceId"] for edge in edges} == {CSV, SUCCESSOR},
                "Retain every original source's target; do not select a winner")
        require(selected["constraintOutcome"] == "pass" and selected["resolutionOutcome"] == "ambiguous",
                "Existence and identity ambiguity must remain distinct")

        tabular = by_key["original-tabular-json"]
        nulls = ws.directory_conformance_foreign_keys(tabular["assessment"]["id"], 0, 100,
                                                     table="service_area", state="null-reference")
        require(nulls["rows"], "Keep the actual absent nullable relationship in original tabular.json")
        require(any(any(c["field"] == "service_at_location_id" and c["state"] == "absent"
                        for c in row["components"]) for row in nulls["rows"]),
                "Physical absence remains explicit under the selected null policy")
        require(all(row["constraintOutcome"] == "pass" and row["candidateCount"] == 0
                    for row in nulls["rows"]),
                "Nullable relationship interpretation does not manufacture target matches")

        empty = by_key["authored-empty-organization-table"]
        empty_domains = [row for row in empty["coverage"]["tableDomains"]
                         if row["table"] == "organization" and row["selected"]]
        require(len(empty_domains) == 1 and empty_domains[0]["tableRows"] == 0 and
                empty_domains[0]["pointer"] == "/organizations.csv" and
                empty_domains[0]["rawRange"][1] - empty_domains[0]["rawRange"][0] == 2,
                "The exact original parser must establish an explicitly present empty organization array")
        empty_outcomes = ws.directory_conformance_foreign_keys(empty["assessment"]["id"], 0, 100,
                                                              table="service", state="missing-target")
        require(empty_outcomes["rows"] and any(
            row["targetCoverage"]["targetTable"] == "organization" and
            row["targetCoverage"]["establishedTabularCoverage"] and row["candidateCount"] == 0
            for row in empty_outcomes["rows"]),
            "A non-null child of the explicitly empty selected target table must be missing-target")
        require(empty["coverage"]["states"]["target-table-unavailable"] == 0,
                "An explicitly empty organization table is received coverage, not an unavailable table")

        nested = by_key["original-nested-json"]
        require(nested["coverage"]["outcomeRows"] > 0 and
                nested["coverage"]["states"]["representation-not-tabular"] ==
                nested["coverage"]["outcomeRows"] and nested["coverage"]["matchRows"] == 0,
                "Nested publisher records must retain explicit tabular noncoverage, not invented foreign-key fields")

        repeated = [row for row in csv["coverage"]["declarations"]
                    if row["table"] == "schedule" and row["requirement"] ==
                    {"fields": "service_id", "reference": {"resource": "service", "fields": "id"}}]
        require(len(repeated) == 3 and len({row["id"] for row in repeated}) == 3 and
                all(row["checkedOriginalRows"] == 1 for row in repeated),
                "Keep all three original repeated schedule declarations with distinct source pointers")
        successor = by_key["authored-description-successor"]
        require(successor["coverage"]["states"] == original_states,
                "The retained description-only successor must preserve its exact relationship outcomes")
        return {
            "originalMissingTargetIds": sorted(target_ids),
            "completeOriginalMissingTargetOutcomes": missing,
            "selectedChildContext": {"assessmentId": context["assessment"]["id"],
                                    "coverage": context["assessment"]["summary"]["foreignKeys"]},
            "excludedTargetTables": {"assessmentId": restricted["assessment"]["id"],
                                    "coverage": restricted["assessment"]["summary"]["foreignKeys"]},
            "ambiguousOriginalOutcome": selected, "everyOriginalAmbiguousMatch": edges,
            "originalAbsentNullableRelationship": nulls,
            "authoredEmptyTable": {"tableDomains": empty_domains, "completeMissingTargetOutcomes": empty_outcomes},
            "originalRepeatedDeclarations": repeated,
            "declaredCompositeKeys": 0,
            "compositeMeaning": "The retained HSDS 3.3.1 declaration set has no composite foreign key. "
                                "The implementation accepts equal-cardinality original tuples when declared; "
                                "this original-publisher operation makes no composite execution claim.",
            "authoredSuccessorRelationshipStatesEqual": True,
            "nestedTabularCoverage": nested["assessment"]["summary"]["foreignKeys"],
        }

    def native_http(self, ws, assessment):
        with OperatorServer(ws, 0, expected_workspace_id=ws.workspace_id) as server:
            thread = threading.Thread(target=server.serve_forever,
                                      kwargs={"poll_interval": 0.05}, daemon=True)
            thread.start()
            try:
                base = server.url.split("#", 1)[0].rstrip("/")
                root = "/api/directory/conformance/assessments/" + assessment["id"]
                first = ws.directory_conformance_foreign_keys(assessment["id"], 0, 1,
                                                              state="ambiguous")["rows"][0]
                routes = [
                    (root + "/foreign-keys?offset=0&limit=5&state=ambiguous",
                     ws.directory_conformance_foreign_keys(assessment["id"], 0, 5, state="ambiguous"), None),
                    (root + "/foreign-key-candidates?offset=0&limit=5&groupId=" + first["candidateGroupId"],
                     ws.directory_conformance_foreign_key_candidates(assessment["id"], 0, 5,
                                                                    group_id=first["candidateGroupId"]), None),
                    (root + "/foreign-key-matches?offset=0&limit=5&outcomeId=" + first["id"],
                     ws.directory_conformance_foreign_key_matches(assessment["id"], 0, 5,
                                                                 outcome_id=first["id"]), None),
                ]
                for kind in foreign_keys.FILE_KINDS:
                    routes.append((root + "/files/" + kind, None, assessment["files"][kind]))
                receipts = []
                for route, expected_body, expected_file in routes:
                    request = urllib.request.Request(base + route,
                                                     headers={"Authorization": "Bearer " + server.token})
                    digest, count, parts = hashlib.sha256(), 0, []
                    with urllib.request.urlopen(request, timeout=60) as response:
                        status = response.status
                        while block := response.read(65536):
                            count += len(block)
                            digest.update(block)
                            if expected_body is not None:
                                require(count <= 4194304, "Bound the complete native relationship page")
                                parts.append(block)
                    require(status == 200, "The original authenticated relationship route failed")
                    if expected_file is not None:
                        require(count == expected_file["bytes"] and digest.hexdigest() == expected_file["sha256"],
                                "The complete native HTTP file differs from its retained descriptor")
                    else:
                        require(source.json_value(b"".join(parts)) == expected_body,
                                "The complete native HTTP relationship page differs")
                    receipts.append({"route": route, "status": status, "bytes": count,
                                     "sha256": digest.hexdigest()})
                return {"workspaceId": ws.workspace_id, "routes": receipts}
            finally:
                server.shutdown()
                thread.join(10)

    def native_cli(self, ws, assessment):
        receipts = []
        for kind, method in (
            ("conformance-foreign-keys", ws.directory_conformance_foreign_keys),
            ("conformance-foreign-key-candidates", ws.directory_conformance_foreign_key_candidates),
            ("conformance-foreign-key-matches", ws.directory_conformance_foreign_key_matches),
        ):
            argv = [sys.executable, str(Path(__file__).parent / "cli.py"), "rows",
                    "--workspace", str(self.workspace), "--kind", kind, "--id", assessment["id"],
                    "--offset", "0", "--limit", "5"]
            completed = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            label = kind.replace("conformance-", "")
            attempts = private(self.root / "cli-observations" / label)
            number = max([int(p.name) for p in attempts.iterdir() if p.is_dir() and p.name.isdigit()] or [0]) + 1
            observation = private(attempts / str(number).zfill(4))
            out = observation / "stdout"
            err = observation / "stderr"
            original_workspace.private_write(out, completed.stdout)
            original_workspace.private_write(err, completed.stderr)
            require(completed.returncode == 0, "The original CLI relationship read failed; retain its complete output")
            require(source.json_value(completed.stdout) == method(assessment["id"], 0, 5),
                    "The complete CLI relationship page differs from the same native record")
            receipts.append({"argv": argv, "returncode": completed.returncode,
                             "stdout": info(out), "stderr": info(err)})
        return {"workspaceId": ws.workspace_id, "commands": receipts}

    def operate(self):
        with Workspace(self.workspace, create=False) as ws:
            require(ws.workspace_id == ORIGINAL_UUID, "Use the original received Directory workspace UUID")
            for ident, expected in ORIGINALS.items():
                row = ws.directory_source(ident)
                require(row["originalSha256"] == expected,
                        "Keep every complete original source selected by this receiving programme")
                path, descriptor = ws.directory_source_file(ident)
                require(info(path)["sha256"] == expected == descriptor["sha256"],
                        "The retained source file differs from its immutable source record")
            if "originalRecords" not in self.journal:
                self.journal["originalRecords"] = immutable_inventory(ws)
                self.save()
            assert_original_inventory(ws, self.journal["originalRecords"])
            older = []
            for record in records(ws, "conformanceAssessments"):
                if record["id"] in self.journal["originalRecords"].get("conformanceAssessments", {}):
                    ws._verify_conformance_assessment(record)
                    older.append({"id": record["id"], "engine": record["engine"],
                                  "files": record["files"], "summary": record["summary"]})
            requests = (
                ("two-original-editions", [(CSV, []), (SUCCESSOR, [])]),
                ("service-only-edition", [(CSV, ["service"])]),
            )
            editions = {}
            for key, selected in requests:
                request = edition_request(key, selected)
                record = self.step(key + "-edition", request, lambda r=request: ws.directory_edition(r))
                require(ws.directory_edition(request) == record,
                        "A repeated native edition must return the same complete original selection")
                editions[key] = record
            selections = [
                ("original-csv", "sources", CSV, [],
                 "Every original published CSV example table and declared relationship in its complete received source."),
                ("authored-description-successor", "sources", SUCCESSOR, [],
                 "The already-retained authored one-description-cell CSV successor. Every original relationship value is preserved."),
                ("original-tabular-json", "sources", TABULAR, [],
                 "The unchanged original tabular.json table collection, including its absent nullable service_area relation."),
                ("original-nested-json", "sources", NESTED, [],
                 "The unchanged original service_full.json nested representation. Native parent links remain original; this edition records explicit tabular noncoverage."),
                ("two-original-editions", "editions", editions["two-original-editions"]["id"], [],
                 "The complete original CSV and its retained authored successor coexist as explicitly selected source editions. Repeated original target identities remain ambiguous."),
                ("service-only-edition", "editions", editions["service-only-edition"]["id"], [],
                 "Only the original service table is selected into this native edition. Organization/program source tables remain retained outside the selected subject and cannot be treated as received targets."),
                ("selected-service-with-original-context", "sources", CSV, ["service"],
                 "Only service rows are selected for child assertions; every original target table in the complete source remains the explicit relationship context."),
            ]
            cases = [self.assess(ws, *selected) for selected in selections]
            empty_source, empty_derivation = self.empty_table_source(ws,
                next(row for row in cases if row["key"] == "original-tabular-json"))
            predecessor = None
            for key, source_id in (("original-tabular-predecessor", TABULAR),
                                   ("authored-empty-organization-edition", empty_source["id"])):
                request = edition_request(key, [(source_id, [])])
                request["predecessorId"] = predecessor
                record = self.step(key + "-edition", request, lambda r=request: ws.directory_edition(r))
                require(ws.directory_edition(request) == record,
                        "The original and authored deletion editions must retain their complete native requests")
                editions[key] = record
                predecessor = record["id"]
            cases.append(self.assess(ws, "authored-empty-organization-table", "editions", predecessor,
                ["service"], "Explicit authored deletion edition of the retained original tabular.json: only its organization array becomes empty. Its actual predecessor edition, complete original and derived files, byte ranges and every other unchanged byte are retained."))
            observations = self.step("original-source-relationship-observations",
                {"assessmentIds": [item["assessment"]["id"] for item in cases]},
                lambda: self.observe_cases(ws, cases))
            by_key = {item["key"]: item for item in cases}
            request = {
                "label": "Declared-key outcomes — original versus authored description successor", "actor": ACTOR,
                "beforeAssessmentId": by_key["original-csv"]["assessment"]["id"],
                "afterAssessmentId": by_key["authored-description-successor"]["assessment"]["id"],
                "scopeNote": "The same original source relationships are preserved across the already-retained authored "
                             "description successor. Compare complete rule counts while retaining all original row identities.",
                "note": "This is a selected-source conformance comparison, not a live service or customer acceptance claim.",
            }
            comparison = self.step("original-source-comparison", request,
                                   lambda: ws.compare_directory_conformance(request))
            for file_kind in comparison["files"]:
                path, descriptor = ws.directory_conformance_file("conformanceComparisons", comparison["id"], file_kind)
                self.copy("comparison-" + file_kind, path, descriptor, descriptor["name"])
            selected = by_key["two-original-editions"]["assessment"]
            http = self.step("complete-authenticated-relationship-files",
                             {"assessmentId": selected["id"]}, lambda: self.native_http(ws, selected))
            cli = self.step("complete-native-cli-pages",
                            {"assessmentId": selected["id"]}, lambda: self.native_cli(ws, selected))
            current_inventory = assert_original_inventory(ws, self.journal["originalRecords"])
            packet_path = self.root / "Directory_Foreign_Keys_Complete_Editable_Workspace.zip"
            expected = {"workspaceId": ws.workspace_id, "immutableRecords": current_inventory}
            def export():
                if not packet_path.exists():
                    ws.export_workspace(packet_path)
                with zipfile.ZipFile(packet_path) as archive:
                    registry_raw = archive.read("directory-registry.json")
                    registry = source.json_value(registry_raw)
                    manifest = source.json_value(archive.read("manifest.json"))
                require(registry["workspaceId"] == ws.workspace_id and
                        source.sha(registry_raw) == manifest["registrySha256"],
                        "The complete original export changed workspace or registry")
                for kind, rows in current_inventory.items():
                    received = {row["id"]: source.sha(source.jbytes(row)) for row in registry["records"][kind]}
                    require(received == rows, "The complete export differs from an original immutable collection")
                return {"workspaceId": ws.workspace_id, **info(packet_path),
                        "registrySha256": source.sha(registry_raw)}
            packet = self.step("complete-editable-export", expected, export)
            with zipfile.ZipFile(packet_path) as archive:
                registry_raw = archive.read("directory-registry.json")
                registry = source.json_value(registry_raw)
            require(source.sha(registry_raw) == packet["registrySha256"],
                    "The existing full export differs from the completed original packet")
            write_json(self.root / "EXPORTED_FOREIGN_KEYS_REGISTRY.json", registry)
            state = {
                "workspaceId": ws.workspace_id, "sourceIds": list(ORIGINALS),
                "authoredSourceIds": [empty_source["id"]], "authoredTableDeletion": empty_derivation,
                "editionIds": {key: row["id"] for key, row in editions.items()},
                "planIds": {item["key"]: item["plan"]["id"] for item in cases},
                "assessmentIds": {item["key"]: item["assessment"]["id"] for item in cases},
                "reviewIds": {item["key"]: item["review"]["id"] for item in cases},
                "comparisonId": comparison["id"],
                "summaries": {item["key"]: item["assessment"]["summary"] for item in cases},
                "originalAssessmentReadback": older, "observations": observations,
                "http": http, "cli": cli, "workspacePacket": packet,
            }
        restored = self.root / "received-workspace"
        with Workspace(restored, create=not restored.exists()) as receiver:
            request = {"workspaceId": state["workspaceId"], "archiveSha256": packet["sha256"]}
            receipt = self.step("complete-editable-receive", request,
                               lambda: receiver.import_workspace(packet_path))
            require(receiver.workspace_id == state["workspaceId"],
                    "Complete fresh receiving must preserve the original workspace UUID")
            for kind, rows in registry["records"].items():
                require(list(records(receiver, kind)) == rows,
                        "Complete receiving changed the original registry collection: " + kind)
            for ident in state["assessmentIds"].values():
                record = receiver.directory_record("conformanceAssessments", ident)
                receiver._verify_conformance_assessment(record)
                self.pages(receiver, record)
            assert_original_inventory(receiver, self.journal["originalRecords"])
            receiving = {"workspace": str(restored), "workspaceId": receiver.workspace_id,
                         "registrySha256": source.sha(registry_raw), "nativeReceipt": receipt,
                         "allOriginalCollectionsEqual": True,
                         "counts": {kind: len(rows) for kind, rows in registry["records"].items()}}
        if "completedAt" not in self.journal:
            self.journal["completedAt"] = utc()
            self.save()
        result = {
            "schema": RESULT_SCHEMA, "operation": OPERATION,
            "implementationEdition": foreign_keys.EDITION,
            "completedAt": self.journal["completedAt"], "sourceRoot": str(Path(__file__).resolve().parent),
            "workspace": str(self.workspace), **state, "files": self.journal["files"],
            "restoration": receiving,
            "meaning": "Complete declared-key assessment and authored receiving review over retained publisher "
                       "examples and explicit native source selections. Original missing targets and coverage "
                       "limitations remain visible; no production certification or customer acceptance is claimed.",
        }
        path = self.root / "OPERATED_DIRECTORY_FOREIGN_KEYS.json"
        write_json(path, result)
        self.journal["result"] = info(path)
        self.save()
        emit("DIRECTORY_FOREIGN_KEYS_NATIVE_COMPLETE", result=info(path), workspacePacket=packet,
             assessmentIds=state["assessmentIds"],
             relationshipStates={key: value["foreignKeys"]["states"] for key, value in state["summaries"].items()})
        return result

def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    root = private(args.out)
    fd = os.open(root / "foreign-keys-operation.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    operation = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operation = Operation(args)
        operation.operate()
        return 0
    except BaseException as error:
        if operation is not None:
            import traceback
            operation.journal["failures"].append({"at": utc(), "type": type(error).__name__,
                "message": str(error), "traceback": traceback.format_exc()})
            operation.save()
            emit("DIRECTORY_FOREIGN_KEYS_INTERRUPTED", journal=str(operation.path),
                 error={"type": type(error).__name__, "message": str(error)})
        raise
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

if __name__ == "__main__":
    raise SystemExit(main())
