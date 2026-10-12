#!/usr/bin/env python3
"""MIT. Operate the genuine published STU2 source through complete native care-plan receiving."""
from __future__ import annotations
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
import zipfile

OPERATION = "SCF-ELTSS-CAREPLAN-WORKBENCH-450E-20261012"
SCHEMA = "stellar-forge.eltss-operated.v1"
PUBLIC_URL = "https://hl7.org/fhir/us/eltss/STU2/Bundle-2039212f3fa5406bb4ffd4a.json"
PUBLIC_SHA = "b1bfe61134b7f18c8d8831b9d253f64df7d37e8bb4e457a00ab472e0aa1b4de2"
PUBLIC_BYTES = 128055
PROFILE = "eltss-stu2-2.0.0"
ACTOR = "Commons eLTSS source receiving operator"


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def identity(path):
    before = path.stat()
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(65536):
            h.update(block)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError("Original file changed during receiving")
    return {"file": str(path), "bytes": before.st_size, "sha256": h.hexdigest()}


def copy_exact(source, destination):
    expected = identity(source)
    if destination.exists():
        if {k: v for k, v in identity(destination).items() if k != "file"} != {
                k: v for k, v in expected.items() if k != "file"}:
            raise RuntimeError("Retained receiving file contains different original bytes")
    else:
        with source.open("rb") as inp, os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
            shutil.copyfileobj(inp, out, 65536)
            out.flush()
            os.fsync(out.fileno())
    return identity(destination)


def must(value, message):
    if not value:
        raise RuntimeError(message)

MERCHANT_CODE = r"""
import {readFile, writeFile, mkdir, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const sdk = input.sdk;
const {prepareEltssMerchant, readEltssMerchant, startEltssMerchant,
  publishEltssMerchant} = await import(pathToFileURL(join(sdk, 'fhir_eltss/merchant.mjs')));
const {reviewEltssBuyer, prepareEltssBuyer} = await import(pathToFileURL(join(sdk, 'fhir_eltss/customer.mjs')));
const {datasetControl} = await import(pathToFileURL(join(sdk, 'dataset-refresh/service.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = async (name, value) => {
  const file = join(input.output, name);
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  await chmod(file, 0o600); return file;
};
const originalExample = JSON.parse(await readFile(join(sdk, 'examples/service.json'), 'utf8'));
const payment = originalExample.routes[0].definition.payment;
const prepared = await prepareEltssMerchant({datasetDirectory: input.baseDataset,
  directory: input.merchant, payment, origin: 'https://eltss-careplans.example', path: '/careplan-source'});
const release = await readEltssMerchant(input.merchant);
const nextPrepared = await prepareEltssMerchant({datasetDirectory: input.correctedDataset,
  directory: input.nextMerchant, payment, origin: 'https://eltss-careplans.example', path: '/careplan-source'});
await mkdir(input.customer, {recursive: true, mode: 0o700});
const server = await startEltssMerchant({directory: input.merchant, stateDirectory: input.state,
  port: 0, controlTransport: 'loopback', maxInFlight: 4, drainGraceMs: 5000,
  maxCachedVersions: 1, maxResidentRows: 100000});
try {
  const before = await datasetControl(input.state, 'status');
  const reviewed = await reviewEltssBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'}});
  const buyer = await prepareEltssBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'eltss-careplans-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
    destination: join(input.customer, 'buyer.json')});
  const repeated = await prepareEltssBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'eltss-careplans-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
    destination: join(input.customer, 'buyer.json')});
  if (buyer.configSha256 !== repeated.configSha256 || !repeated.saved.recovered)
    throw new Error('The original SF88 preparation did not reopen the same exact saved configuration.');
  const local = new URL(reviewed.url);
  const response = await fetch(server.url + local.pathname + local.search, {redirect: 'error'});
  const responseBody = Buffer.from(await response.arrayBuffer());
  if (response.status !== 402) throw new Error('The original selected seller must return its native 402 payment challenge.');
  const challenge = {url: server.url + local.pathname + local.search, status: response.status,
    headers: Object.fromEntries(response.headers), bodyBase64: responseBody.toString('base64'),
    bodySha256: sha(responseBody), bodyBytes: responseBody.length};
  const challengeFile = await write('ORIGINAL_SELLER_CHALLENGE.json', challenge);
  const nextRelease = await readEltssMerchant(input.nextMerchant);
  const published = before.current === nextRelease.manifest.snapshot
    ? {recovered: true, current: before.current, revision: before.revision}
    : await publishEltssMerchant({directory: input.nextMerchant,
      stateDirectory: input.state, expectedSnapshot: before.current, expectedRevision: before.revision});
  const after = await datasetControl(input.state, 'status');
  const nextOffer = await reviewEltssBuyer({directory: input.nextMerchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'}});
  const nextBuyer = await prepareEltssBuyer({directory: input.nextMerchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'eltss-careplans-corrected-source-450e', acceptIndex: 0, offerSha256: nextOffer.offerSha256,
    destination: join(input.customer, 'corrected-buyer.json')});
  const value = {schema: 'stellar-forge.eltss-careplans-operated-merchant.v1',
    originalPaymentSource: {path: 'examples/service.json', payment},
    mode: server.mode, seller: server.url, prepared, nextPrepared,
    release: release.manifest, before, published, after, originalOffer: reviewed,
    buyer, reopenedBuyer: repeated.saved, nextOffer, nextBuyer, challengeFile};
  await write('OPERATED_MERCHANT.json', value);
  process.stdout.write(JSON.stringify(value) + '\n');
} finally {await server.close();}
"""

class Journey:
    def __init__(self, args):
        self.args = args
        self.sdk = Path(args.source_root).expanduser().absolute()
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.output = Path(args.output).expanduser().absolute()
        self.output.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.output, 0o700)
        self.temporary = self.output / "temporary"
        self.temporary.mkdir(mode=0o700, exist_ok=True)
        os.environ["TMPDIR"] = str(self.temporary)
        os.environ["SF30_XML_NODE"] = args.node
        os.environ["SF30_FHIR_NODE"] = args.node
        sys.path.insert(0, str(self.sdk / "fhir_eltss"))
        self.module = importlib.import_module("eltss_workspace")
        self.source = importlib.import_module("eltss_source")
        self.runtime = importlib.import_module("eltss_runtime")
        self.lease = os.fdopen(os.open(self.output / "receiving.lock",
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b")
        if os.name == "posix":
            import fcntl
            fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            if not self.lease.read(1):
                self.lease.write(b"0")
                self.lease.flush()
            self.lease.seek(0)
            msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
        self.path = self.output / "RECEIVING_JOURNEY.json"
        if self.path.exists():
            self.journal = json.loads(self.path.read_bytes())
            must(self.journal["workspace"] == str(self.workspace) and self.journal["sourceRoot"] == str(self.sdk),
                 "Resume the identical native source and workspace")
        else:
            self.journal = {"schema": SCHEMA, "operation": OPERATION, "sourceRoot": str(self.sdk),
                "workspace": str(self.workspace), "createdAt": stamp(), "phases": [],
                "receivingOperationId": str(uuid.uuid4()), "artifacts": []}
            self.checkpoint()
        self.ws = None

    def checkpoint(self):
        self.journal["updatedAt"] = stamp()
        self.runtime.atomic_json(self.path, self.journal)

    def file(self, name, value):
        path = self.output / name
        self.runtime.atomic_json(path, value)
        return identity(path)

    def phase(self, name, callback):
        row = next((item for item in self.journal["phases"] if item["name"] == name), None)
        if row and row["state"] == "complete":
            return row["result"]
        if row is None:
            row = {"name": name, "state": "running", "startedAt": stamp()}
            self.journal["phases"].append(row)
        else:
            row["state"] = "running"
            row["resumedAt"] = stamp()
        self.checkpoint()
        print(json.dumps({"operation": OPERATION, "phase": name, "state": "running"}), flush=True)
        try:
            result = callback(row)
            row.update(state="complete", result=result, completedAt=stamp())
            row.pop("error", None)
            self.checkpoint()
            print(json.dumps({"operation": OPERATION, "phase": name, "state": "complete"}), flush=True)
            return result
        except BaseException as error:
            row.update(state="interrupted", error=str(error), interruptedAt=stamp())
            self.checkpoint()
            raise

    def originals(self, phase):
        supplied = Path(self.args.original_bundle).expanduser().absolute()
        info = identity(supplied)
        must(info["sha256"] == PUBLIC_SHA and info["bytes"] == PUBLIC_BYTES,
             "Use the complete unchanged published STU2 Bundle")
        original = self.output / "PUBLISHED_STU2_BUNDLE.json"
        copy_exact(supplied, original)
        bundle = json.loads(original.read_bytes())
        must(len(bundle["entry"]) == 39, "Published Bundle entry count changed")
        literal = []
        def visit(value):
            if isinstance(value, dict):
                if isinstance(value.get("reference"), str):
                    literal.append(value["reference"])
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        visit(bundle)
        must(len(literal) == 98, "Published original literal-reference count changed")
        member = {"name": "documents/published-stu2-bundle.json", "bytes": PUBLIC_BYTES,
                  "sha256": PUBLIC_SHA, "role": "published-example", "sourceUrl": PUBLIC_URL}
        manifest = {"schema": self.source.SOURCE_SCHEMA, "origin": "published_sample",
            "publisher": "HL7", "sourceUrl": PUBLIC_URL, "documents": [member], "protocol": [], "predecessors": [],
            "context": {"publication": "hl7.fhir.us.eltss#2.0.0", "fhirVersion": "4.0.1",
                        "originalBundleSha256": PUBLIC_SHA, "referenceSource": "Published STU2 example"}}
        packet = self.output / "PUBLISHED_SOURCE.zip"
        if not packet.exists():
            self.runtime.write_zip(packet, {"manifest.json": self.source.jbytes(manifest), member["name"]: original})
        with packet.open("rb") as stream, self.source.Packet(stream) as checked:
            must(checked.manifest == manifest, "Retained source packet changed its original publication selection")
        with packet.open("rb") as stream:
            saved = self.ws.add_source(stream, "HL7 published STU2 original Bundle", "PUBLISHED_SOURCE.zip")
        must(saved["inventory"]["resources"] == 39 and saved["inventory"]["carePlans"] == 2,
             "Native intake did not retain every original resource and CarePlan")
        definitions = None
        if self.args.definitions_zip:
            supplied_definitions = Path(self.args.definitions_zip).expanduser().absolute()
            target = self.output / "PUBLISHED_STU2_DEFINITIONS.zip"
            definitions = copy_exact(supplied_definitions, target)
            with zipfile.ZipFile(target) as archive:
                names = archive.namelist()
                must(len(names) == len(set(names)), "Original definitions repeat a member name")
                definitions["members"] = [{"name": name, "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest()} for name in names
                    if not name.endswith("/") for data in [archive.read(name)]]
            with target.open("rb") as stream:
                definitions["artifact"] = self.ws.add_artifact(stream, "HL7 published STU2 computable definitions",
                    target.name, "application/zip")
        return {"sourceId": saved["id"], "original": {**identity(original), "url": PUBLIC_URL},
                "sourcePacket": identity(packet), "inventory": saved["inventory"],
                "literalReferenceCount": len(literal), "definitions": definitions}

    def graph_and_review(self, phase, original):
        graph = self.ws.graph(original["sourceId"], {"referencePolicy": "bundle", "baseUrl": "", "decisionIds": []})
        careplans = graph["carePlans"]
        must(len(careplans) == 2, "Select both exact original CarePlan records")
        ids = [row["recordId"] for row in careplans]
        edges, offset = [], 0
        while True:
            page = self.ws.graph_edges(graph["id"], offset=offset, limit=100)
            edges.extend(page["rows"])
            if page.get("nextOffset") is None:
                break
            must(page["nextOffset"] > offset, "Original edge pagination did not advance")
            offset = page["nextOffset"]
        actual_literal = [edge for edge in edges if edge.get("kind") == "literal"]
        must(len(actual_literal) == 98, "Native graph must retain every original literal reference")
        must(len(edges) == graph["summary"]["edges"], "Complete original reference pages were not retained")
        # Every literal reference in the original Bundle has a retained target.
        unresolved_literals = [edge for edge in actual_literal
            if not edge.get("targetRecordIds")]
        must(not unresolved_literals, "A published literal reference did not resolve by original identity")
        edition = self.ws.save_edition({"label": "Published STU2 two-CarePlan original",
            "sourceId": original["sourceId"], "carePlanIds": ids, "referencePolicy": "bundle",
            "baseUrl": "", "decisionIds": [], "actor": ACTOR, "owner": ACTOR,
            "note": "Exact published example; both original CarePlans and their observed graph are retained."})
        draft = self.ws.adopt_profile({"profileId": PROFILE, "label": "All 56 original field selectors",
            "actor": ACTOR, "note": "Original field guidance and generated selector drafts retained for explicit review."})
        initial = self.ws.assess({"editionId": edition["id"], "reviewSetId": draft["id"],
            "label": "Complete original field observations before selected review"})
        fields = json.loads(json.dumps(draft["fields"]))
        # These four exact paths were reviewed against the published Patient and mapping.
        # Remaining original selector drafts and applicability states stay visible.
        for field in fields:
            if field["fieldKey"] in {"eltss-001", "eltss-002", "eltss-003", "eltss-004"}:
                field.update(status="reviewed", applicability="applicable", absencePolicy="retain_absence",
                    reviewer=ACTOR, reviewedAt=phase.setdefault("reviewedAt", stamp()),
                    note="Reviewed CarePlan.subject → original Patient identity; retain all original name/identifier/type/birth-date values and lexical forms.")
        self.checkpoint()
        reviewed = self.ws.save_review_set({"label": "Original demographic paths reviewed; complete 56-field edition",
            "profileId": PROFILE, "predecessorId": draft["id"], "fields": fields, "actor": ACTOR,
            "note": "Selected field applicability is authored for this published example. Every original field stays present."})
        assessment = self.ws.assess({"editionId": edition["id"], "reviewSetId": reviewed["id"],
            "label": "Complete original observations with selected demographic review"})
        must(initial["summary"]["cells"] == 112 and assessment["summary"]["cells"] == 112,
             "Each selected original CarePlan must retain all 56 field cells")
        cells = [json.loads(line) for line in self.ws.assessment_file(assessment["id"]).read_bytes().splitlines()]
        must({row["fieldKey"] for row in cells} == {field["fieldKey"] for field in fields},
             "Complete field identity set changed")
        self.file("ORIGINAL_GRAPH.json", graph)
        self.file("ORIGINAL_REFERENCE_EDGES.json", edges)
        self.file("ORIGINAL_FIELD_ASSESSMENT.json", assessment)
        copy_exact(self.ws.assessment_file(assessment["id"]), self.output / "ORIGINAL_FIELD_CELLS.jsonl")
        self.file("FIELD_REVIEW.json", reviewed)
        return {"graphId": graph["id"], "editionId": edition["id"], "carePlanIds": ids,
            "carePlans": careplans, "draftReviewSetId": draft["id"], "reviewSetId": reviewed["id"],
            "draftAssessmentId": initial["id"], "assessmentId": assessment["id"],
            "summary": assessment["summary"], "graphSummary": graph["summary"]}

    def correction(self, phase, original, reviewed):
        rows = reviewed["carePlans"]
        selected = next(row for row in rows if row.get("id") == "careplan1")
        resource = json.loads(self.ws.source_row(original["sourceId"], selected["recordId"])["jsonText"])
        title = resource["title"] + " — authored receiving correction example"
        request = {"editionId": reviewed["editionId"], "label": "Authored title correction to the published example",
            "patches": [{"recordId": selected["recordId"], "path": ["title"],
                        "action": "replace", "valueJson": json.dumps(title, ensure_ascii=False)}],
            "actor": ACTOR, "reason": "Operate an explicit field correction and unchanged predecessor receiving on the published sample."}
        preview = self.ws.preview_correction(request)
        applied = self.ws.apply_correction({"previewId": preview["id"],
            "expectedRequestSha256": preview["requestSha256"]})
        repeated = self.ws.apply_correction({"previewId": preview["id"],
            "expectedRequestSha256": preview["requestSha256"]})
        must(repeated["id"] == applied["id"], "Original correction retry created another correction")
        edition = self.ws.edition(applied["editionId"])
        assessment = self.ws.assess({"editionId": edition["id"], "reviewSetId": reviewed["reviewSetId"],
            "label": "All original field observations after reviewed sample correction"})
        comparison = self.ws.compare_editions({"beforeId": reviewed["editionId"], "afterId": edition["id"],
            "label": "Original source versus authored title correction"})
        must(comparison["counts"]["changed"] == 1 and comparison["counts"]["unchanged"] == 38,
             "The one title correction changed a different original resource set")
        must(self.ws.source(original["sourceId"])["inventory"] == original["inventory"],
             "The unchanged original publication source was altered")
        target = applied["recordMap"][selected["recordId"]]
        current = self.ws.source_row(applied["sourceId"], target)
        must(json.loads(current["jsonText"])["title"] == title, "Corrected original title did not reach the selected resource")
        decision = self.ws.save_decision({"kind": "careplan", "outcome": "replacement", "actor": ACTOR,
            "reason": "The reviewed sample title correction is retained as the explicit successor of this original CarePlan.",
            "editionIds": [reviewed["editionId"], edition["id"]], "assessmentId": assessment["id"],
            "sourceRefs": [{"sourceId": original["sourceId"], "recordId": selected["recordId"]},
                           {"sourceId": applied["sourceId"], "recordId": target}], "fieldKeys": [], "owner": ACTOR})
        self.file("CORRECTION_PREVIEW.json", preview)
        self.file("APPLIED_CORRECTION.json", applied)
        self.file("EDITION_COMPARISON.json", comparison)
        copy_exact(self.ws.edition_changes_file(comparison["id"]), self.output / "EDITION_CHANGES.jsonl")
        copy_exact(self.ws.assessment_file(assessment["id"]), self.output / "CORRECTED_FIELD_CELLS.jsonl")
        return {"correctionId": applied["id"], "previewId": preview["id"], "sourceId": applied["sourceId"],
            "editionId": edition["id"], "graphId": edition["graphId"], "carePlanIds": edition["carePlanIds"],
            "assessmentId": assessment["id"], "comparisonId": comparison["id"], "decisionId": decision["id"],
            "recordMap": applied["recordMap"], "counts": comparison["counts"]}

    def projections(self, phase, original, reviewed, corrected):
        plan = self.ws.default_mapping(original["sourceId"], "CarePlan", "Published eLTSS CarePlan editions")
        # Record IDs identify exact source positions. Compare resources across source editions
        # using their original resource identity and complete content, retaining provenance in lineage.
        plan["columns"] = [col for col in plan["columns"]
                           if not (col["source"] == "record" and col["path"] == ["recordId"])]
        preview = self.ws.projection_preview(original["sourceId"], plan)
        saved = self.ws.save_plan(plan)
        before = self.ws.build(original["sourceId"], saved["id"])
        after = self.ws.build(corrected["sourceId"], saved["id"])
        comparison = self.ws.compare(before["id"], after["id"])
        must(comparison["counts"]["changed"] == 1 and comparison["counts"]["unchanged"] == 1,
             "Native SF30 comparison did not preserve the original two-CarePlan identity")
        query = self.ws.query(after["id"], {"limit": "1", "sort": "resource_id"})
        self.file("NATIVE_QUERY.json", query)
        self.file("NATIVE_MAPPING_PREVIEW.json", preview)
        self.file("NATIVE_DATASET_COMPARISON.json", comparison)
        exports = []
        for label, build in [("original", before), ("corrected", after)]:
            destination = self.output / ("dataset-" + label)
            if not destination.exists():
                self.ws.export_dataset(build["id"], destination)
            lineage = json.loads((destination / "eltss-lineage.json").read_bytes())
            must(lineage["build"]["id"] == build["id"] and lineage["snapshot"] == build["native"]["snapshot"],
                 "Exported native lineage differs from this exact build")
            exports.append({"directory": str(destination), "lineage": lineage})
        must(exports[0]["lineage"]["family"]["id"] == exports[1]["lineage"]["family"]["id"],
             "An authored correction changed the original source-selection family")
        packet = self.output / "NATIVE_DATASET_PACKET.zip"
        if not packet.exists():
            self.ws.export_packet(after["id"], packet)
        receiver = self.output / "dataset-receiver"
        with self.module.Workspace(receiver, create=not receiver.exists()) as target:
            received = target.import_packet(packet)
            must(received["build"]["id"] == after["id"], "Original SF30 dataset receiving changed its build identity")
            received_query = target.query(received["build"]["id"], {"limit": "1", "sort": "resource_id"})
            must(received_query.get("response") == query.get("response"), "Native received dataset query differs")
        self.file("NATIVE_DATASET_RECEIVING.json", received)
        return {"planId": saved["id"], "buildIds": [before["id"], after["id"]], "comparisonId": comparison["id"],
            "baseDataset": exports[0]["directory"], "correctedDataset": exports[1]["directory"],
            "family": exports[0]["lineage"]["family"], "packet": identity(packet),
            "receiverWorkspace": str(receiver)}

    def customer_receiving(self, phase, reviewed, corrected):
        handoff = self.ws.prepare_handoff({"editionId": corrected["editionId"], "reviewSetId": reviewed["reviewSetId"],
            "assessmentId": corrected["assessmentId"], "label": "Complete published-example correction receiving",
            "scope": "edition", "receiver": "Original local editable receiving workspace",
            "decisionIds": [corrected["decisionId"]], "actor": ACTOR,
            "reason": "Receive the complete selected source, original predecessor, graph and all 56 field rows."})
        packet = self.output / "CAREPLAN_HANDOFF.zip"
        if not packet.exists():
            self.ws.export_handoff(handoff["id"], packet)
        receiver = self.output / "handoff-receiver"
        with self.module.Workspace(receiver, create=not receiver.exists()) as target:
            received = target.import_handoff(packet)
            same = target.import_handoff(packet)
            must(same.get("recovered"), "Exact same handoff did not recover its completed receipt")
            must(target.handoff(handoff["id"]) == handoff, "Received handoff content differs from the original")
            must(target.assessment_file(corrected["assessmentId"]).read_bytes() ==
                 self.ws.assessment_file(corrected["assessmentId"]).read_bytes(), "Received complete field cells changed")
            all_sources = []
            for row in target.state()["sources"]:
                actual = identity(target.source_path(row["id"]))
                must(actual["sha256"] == row["id"], "Received original source bytes changed")
                all_sources.append(actual)
            received_view = {"workspace": str(receiver), "workspaceId": target.workspace_id,
                "handoffId": handoff["id"], "archive": identity(packet), "sourceFiles": all_sources,
                "assessmentId": corrected["assessmentId"], "receivedAt": phase.setdefault("receivedAt", stamp())}
        self.checkpoint()
        result_file = self.output / "ORIGINAL_HANDOFF_RECEIPT.json"
        self.runtime.atomic_json(result_file, received_view)
        with result_file.open("rb") as stream:
            artifact = self.ws.add_artifact(stream, "Original local editable handoff receipt",
                result_file.name, "application/json")
        request = {"handoffId": handoff["id"], "operationId": self.journal["receivingOperationId"],
            "receiver": "Original local editable receiving workspace", "state": "received",
            "destinationObjectId": received_view["workspaceId"], "receivedAt": received_view["receivedAt"],
            "artifactId": artifact["id"], "sourceRefs": [], "actor": ACTOR, "owner": ACTOR,
            "note": "Actual native import/reopen and exact retained source/cell readback from the selected receiving workspace."}
        receiving = self.ws.save_receiving(request)
        repeated = self.ws.save_receiving(request)
        must(receiving["id"] == repeated["id"], "Same original receiving request did not recover its retained result")
        self.file("CAREPLAN_HANDOFF.json", handoff)
        self.file("SAVED_RECEIVING.json", receiving)
        return {"handoffId": handoff["id"], "receivingId": receiving["id"], "artifactId": artifact["id"],
            "packet": {**identity(packet), "handoffId": handoff["id"]}, "receiver": received_view}

    def merchant(self, phase, projections):
        request = {"sdk": str(self.sdk), "output": str(self.output), "baseDataset": projections["baseDataset"],
            "correctedDataset": projections["correctedDataset"], "merchant": str(self.output / "merchant-original"),
            "nextMerchant": str(self.output / "merchant-corrected"), "state": str(self.output / "merchant-state"),
            "customer": str(self.output / "original-buyer")}
        self.file("MERCHANT_INPUT.json", request)
        script = self.output / "operate-merchant.mjs"
        script.write_text(MERCHANT_CODE, encoding="utf-8")
        os.chmod(script, 0o600)
        result = subprocess.run([self.args.node, str(script), str(self.output / "MERCHANT_INPUT.json")],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=180)
        self.file("MERCHANT_PROCESS.json", {"returncode": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
        must(result.returncode == 0, "Original merchant/buyer receiving did not finish: " + result.stderr[-4000:])
        return json.loads((self.output / "OPERATED_MERCHANT.json").read_bytes())

    def restoration(self, phase, reviewed, corrected, delivery):
        expected = self.ws.state()
        packet = self.output / "COMPLETE_EDITABLE_WORKSPACE.zip"
        if not packet.exists():
            self.ws.export_workspace(packet)
        receiver = self.output / "restored-workspace"
        with self.module.Workspace(receiver, create=not receiver.exists()) as target:
            imported = target.import_workspace(packet)
            repeated = target.import_workspace(packet)
            must(imported["workspaceId"] == self.ws.workspace_id and repeated.get("recovered"),
                 "The exact whole workspace identity/repeated receiving did not reopen")
            observed = target.state()
            counts = {}
            for kind, rows in expected.items():
                if not isinstance(rows, list) or kind == "receives":
                    continue
                if kind not in observed or not isinstance(observed[kind], list):
                    continue
                key = "operationId" if kind == "operations" else "id"
                wanted = sorted(item[key] for item in rows)
                actual = sorted(item[key] for item in observed[kind])
                must(wanted == actual, "Complete editable restoration changed " + kind)
                counts[kind] = len(actual)
            originals = []
            for row in expected["sources"]:
                before = identity(self.ws.source_path(row["id"]))
                after = identity(target.source_path(row["id"]))
                must(before["sha256"] == after["sha256"] == row["id"] and before["bytes"] == after["bytes"],
                     "Complete original source differs after restoration")
                originals.append(after)
            for ident in [reviewed["assessmentId"], corrected["assessmentId"]]:
                must(target.assessment_file(ident).read_bytes() == self.ws.assessment_file(ident).read_bytes(),
                     "Complete field observation file changed after restoration")
            must(target.receiving(delivery["receivingId"]) == self.ws.receiving(delivery["receivingId"]),
                 "Original downstream receiving record changed after restoration")
            must(target.artifact_path(delivery["artifactId"]).read_bytes() ==
                 self.ws.artifact_path(delivery["artifactId"]).read_bytes(), "Original result artifact changed")
        with self.module.Workspace(receiver) as target:
            reopened_id = target.workspace_id
            must(target.edition(corrected["editionId"])["sourceId"] == corrected["sourceId"],
                 "Reopened original edition lost its retained source")
            reopened = target.state()
        result = {"workspace": str(receiver), "workspaceId": reopened_id, "packet": identity(packet),
                  "collections": counts, "originals": originals, "reopened": True}
        self.file("WHOLE_WORKSPACE_RECEIVING.json", result)
        return result

    def run(self):
        source_files = []
        for root in [self.sdk / "fhir_eltss", self.sdk / "xml"]:
            for path in sorted(root.glob("*.py")):
                raw = path.read_bytes()
                ast.parse(raw, filename=str(path))
                source_files.append({"path": str(path.relative_to(self.sdk)), **identity(path),
                    "gitBlob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
        for name in ["catalogue.json", "field-profile.json", "merchant.mjs", "customer.mjs", "cli.mjs"]:
            path = self.sdk / "fhir_eltss" / name
            source_files.append({"path": "fhir_eltss/" + name, **identity(path)})
        self.file("SOURCE_FILES.json", source_files)
        self.ws = self.module.Workspace(self.workspace, create=not self.workspace.exists())
        try:
            original = self.phase("published-original-source", self.originals)
            reviewed = self.phase("complete-graph-and-56-field-review",
                lambda row: self.graph_and_review(row, original))
            corrected = self.phase("reviewed-correction-and-original-edition-comparison",
                lambda row: self.correction(row, original, reviewed))
            projections = self.phase("original-native-datasets-and-receiving",
                lambda row: self.projections(row, original, reviewed, corrected))
            delivery = self.phase("complete-customer-handoff-and-receiving",
                lambda row: self.customer_receiving(row, reviewed, corrected))
            merchant = self.phase("original-merchant-and-buyer-edition-publication",
                lambda row: self.merchant(row, projections))
            restored = self.phase("whole-editable-restoration",
                lambda row: self.restoration(row, reviewed, corrected, delivery))
            result = {"schema": SCHEMA, "operation": OPERATION, "completedAt": stamp(),
                "sourceRoot": str(self.sdk), "workspace": str(self.workspace), "workspaceId": self.ws.workspace_id,
                "sourceIds": [original["sourceId"], corrected["sourceId"]],
                "editionIds": [reviewed["editionId"], corrected["editionId"]],
                "reviewSetIds": [reviewed["draftReviewSetId"], reviewed["reviewSetId"]],
                "assessmentIds": [reviewed["draftAssessmentId"], reviewed["assessmentId"], corrected["assessmentId"]],
                "graphIds": [reviewed["graphId"], corrected["graphId"]],
                "carePlanIds": reviewed["carePlanIds"], "planId": projections["planId"],
                "buildIds": projections["buildIds"], "decisionIds": [corrected["decisionId"]],
                "correctionIds": [corrected["correctionId"]], "editionComparisonIds": [corrected["comparisonId"]],
                "handoffIds": [delivery["handoffId"]], "receivingIds": [delivery["receivingId"]],
                "artifactIds": [delivery["artifactId"]], "baseSourceId": original["sourceId"],
                "baseEditionId": reviewed["editionId"], "baseAssessmentId": reviewed["assessmentId"],
                "correctedSourceId": corrected["sourceId"], "correctedEditionId": corrected["editionId"],
                "correctedAssessmentId": corrected["assessmentId"], "originalBundle": original["original"],
                "handoffPackets": [delivery["packet"]], "workspacePacket": restored["packet"],
                "restoredWorkspace": restored["workspace"], "sourceFiles": source_files,
                "graphSummary": reviewed["graphSummary"], "fieldSummary": reviewed["summary"],
                "editionCounts": corrected["counts"], "nativeProjections": projections,
                "merchant": merchant, "receiving": delivery["receiver"], "restoration": restored,
                "artifacts": [identity(path) for path in sorted(self.output.iterdir())
                    if path.is_file() and path.name not in {"receiving.lock", "OPERATED_ELTSS.json", "RECEIVING_JOURNEY.json"}]}
            self.file("OPERATED_ELTSS.json", result)
            return result
        finally:
            self.ws.close()
            self.lease.close()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-root", required=True, help="Absolute original SF30 SDK source directory")
    p.add_argument("--workspace", required=True, help="Original eLTSS receiving workspace")
    p.add_argument("--output", required=True, help="Original journal and output directory; reuse exactly on resume")
    p.add_argument("--original-bundle", required=True, help="Complete unchanged published STU2 JSON Bundle")
    p.add_argument("--definitions-zip", help="Optional unchanged published STU2 definitions.json.zip")
    p.add_argument("--node", default=os.environ.get("SF30_ELTSS_NODE") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node")
    result = Journey(p.parse_args(argv)).run()
    print(json.dumps({"schema": result["schema"], "workspace": result["workspace"],
        "workspaceId": result["workspaceId"], "output": str(Path(result["workspace"]).parent),
        "sourceIds": result["sourceIds"], "handoffIds": result["handoffIds"]}), flush=True)


if __name__ == "__main__":
    main()
