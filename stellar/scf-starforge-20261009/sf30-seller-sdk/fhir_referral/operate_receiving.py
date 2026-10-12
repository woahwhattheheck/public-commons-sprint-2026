#!/usr/bin/env python3
"""MIT. Operate complete published Gravity3.0 originals through native referral receiving."""
from __future__ import annotations
import argparse
import ast
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import uuid
import zipfile

OPERATION = "SCF-GRAVITY-REFERRAL-WORKSPACE-450E-20261012"
SCHEMA = "stellar-forge.gravity-referral-operated.v1"
EXAMPLES_URL = "https://hl7.org/fhir/us/sdoh-clinicalcare/3.0.0/examples.json.zip"
DEFINITIONS_URL = "https://hl7.org/fhir/us/sdoh-clinicalcare/3.0.0/definitions.json.zip"
EXAMPLES_SHA256 = "604276df00e91ebee5067e88a3cd6bfaa72ba16caed0bce93cc845c3d575a4c4"
DEFINITIONS_SHA256 = "47801dca02f29cc1f6728e6d8cf8255757c1d9b441895c4ebdbc95cc72bfe5b6"
REFERENCE_BASE = "https://hl7.org/fhir/us/sdoh-clinicalcare"
ACTOR = "Commons Gravity published-source receiving operator"

def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def must(value, message):
    if not value:
        raise RuntimeError(message)

def identity(path):
    path = Path(path)
    before = path.lstat()
    must(stat.S_ISREG(before.st_mode), "Select a complete regular original file")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            digest.update(chunk)
    after = path.lstat()
    must((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "Original file changed during receiving")
    return {"file": str(path), "bytes": before.st_size, "sha256": digest.hexdigest()}

def copy_exact(original, target):
    original, target = Path(original), Path(target)
    expected = identity(original)
    if target.exists():
        actual = identity(target)
        must((actual["bytes"], actual["sha256"]) == (expected["bytes"], expected["sha256"]),
             "The retained original receiving file contains different bytes")
    else:
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        with original.open("rb") as inp, os.fdopen(os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as out:
            shutil.copyfileobj(inp, out, 65536); out.flush(); os.fsync(out.fileno())
    return identity(target)

def archive_index(path):
    result, expanded = [], 0
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        must(0 < len(entries) <= 4096 and len({r.filename for r in entries}) == len(entries),
             "The complete published archive repeats or exceeds its original member census")
        for row in entries:
            parts = row.filename.rstrip("/").split("/")
            must(all(part not in {"", ".", ".."} for part in parts) and not row.filename.startswith(("/", "\\")) and
                 "\\" not in row.filename and not stat.S_ISLNK(row.external_attr >> 16) and not row.flag_bits & 1,
                 "The original archive contains an unsupported member")
            if row.is_dir():
                continue
            expanded += row.file_size
            must(row.file_size <= 16 * 1024 * 1024 and expanded <= 256 * 1024 * 1024,
                 "The original expanded archive exceeds the selected source limits")
            raw = archive.read(row)
            result.append({"name": row.filename, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    return result

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
  directory: input.merchant, payment, origin: 'https://gravity-referrals.example', path: '/referral-source'});
const release = await readEltssMerchant(input.merchant);
const nextPrepared = await prepareEltssMerchant({datasetDirectory: input.correctedDataset,
  directory: input.nextMerchant, payment, origin: 'https://gravity-referrals.example', path: '/referral-source'});
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
    intentId: 'gravity-referrals-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
    destination: join(input.customer, 'buyer.json')});
  const repeated = await prepareEltssBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'gravity-referrals-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
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
    intentId: 'gravity-referrals-corrected-source-450e', acceptIndex: 0, offerSha256: nextOffer.offerSha256,
    destination: join(input.customer, 'corrected-buyer.json')});
  const value = {schema: 'stellar-forge.gravity-referral-operated-merchant.v1',
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
        self.output = Path(args.output).expanduser().absolute()
        self.workspace = Path(args.workspace).expanduser().absolute() if args.workspace else self.output / "workspace"
        self.output.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.output, 0o700)
        temporary = self.output / "temporary"
        temporary.mkdir(mode=0o700, exist_ok=True)
        os.environ["TMPDIR"] = str(temporary)
        for key in ["SF30_XML_NODE", "SF30_FHIR_NODE", "SF30_ELTSS_NODE", "SF30_REFERRAL_NODE"]:
            os.environ[key] = args.node
        sys.path.insert(0, str(self.sdk / "fhir_referral"))
        self.module = importlib.import_module("referral_workspace")
        self.runtime = importlib.import_module("referral_runtime")
        self.source = self.runtime.source
        self.server_module = importlib.import_module("published_example_server")
        self.path = self.output / "RECEIVING_JOURNEY.json"
        self.lease = os.fdopen(os.open(self.output / "receiving.lock",
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b")
        if os.name == "posix":
            import fcntl
            fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            if not self.lease.read(1):
                self.lease.write(b"0"); self.lease.flush()
            self.lease.seek(0); msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
        self.input_identity = {"examples": identity(Path(args.examples).expanduser().absolute()),
                               "definitions": identity(Path(args.definitions).expanduser().absolute())}
        binding = {"operation": OPERATION, "sourceRoot": str(self.sdk), "workspace": str(self.workspace),
                   "inputs": self.input_identity}
        if self.path.exists():
            self.journal = json.loads(self.path.read_bytes())
            must(self.journal["binding"] == binding, "Resume the same source, workspace and complete published archives")
        else:
            self.journal = {"schema": SCHEMA, "operation": OPERATION, "binding": binding,
                "startedAt": stamp(), "phases": [], "operationIds": {
                    key: str(uuid.uuid4()) for key in ["read", "write", "staleWrite", "history", "monitoring", "receiving"]}}
            self.checkpoint()
        self.ws, self.example_server = None, None

    def checkpoint(self):
        self.journal["updatedAt"] = stamp()
        self.runtime.atomic_json(self.path, self.journal)

    def file(self, name, value):
        path = self.output / name
        self.runtime.atomic_json(path, value)
        return identity(path)

    def phase(self, name, callback):
        row = next((r for r in self.journal["phases"] if r["name"] == name), None)
        if row and row["state"] == "complete":
            return row["result"]
        if row is None:
            row = {"name": name, "state": "running", "startedAt": stamp(), "asOf": stamp()}
            self.journal["phases"].append(row)
        else:
            row.update(state="running", resumedAt=stamp())
        self.checkpoint()
        print(json.dumps({"operation": OPERATION, "phase": name, "state": "running"}), flush=True)
        try:
            result = callback(row)
            row.update(state="complete", completedAt=stamp(), result=result)
            row.pop("error", None); self.checkpoint()
            print(json.dumps({"operation": OPERATION, "phase": name, "state": "complete"}), flush=True)
            return result
        except BaseException as error:
            row.update(state="interrupted", interruptedAt=stamp(), error=str(error))
            self.checkpoint()
            raise

    def source_rows(self, source_id, resource_type=None):
        rows, offset = [], 0
        while True:
            page = self.ws.source_rows(source_id, resource_type, offset, 250)
            rows.extend(page["rows"])
            if page["nextOffset"] is None:
                return rows
            offset = page["nextOffset"]

    def originals(self, phase):
        examples = copy_exact(self.input_identity["examples"]["file"], self.output / "Gravity_STU3_Original_Examples.zip")
        definitions = copy_exact(self.input_identity["definitions"]["file"], self.output / "Gravity_STU3_Original_Definitions.zip")
        must(examples["bytes"] == 152340 and examples["sha256"] == EXAMPLES_SHA256 and definitions["bytes"] == 670606 and definitions["sha256"] == DEFINITIONS_SHA256,
             "Use the complete unchanged retained Gravity STU3 3.0.0 published archives")
        examples["url"], definitions["url"] = EXAMPLES_URL, DEFINITIONS_URL
        members = {"examples": archive_index(Path(examples["file"])), "definitions": archive_index(Path(definitions["file"]))}
        profiles = {}
        with zipfile.ZipFile(definitions["file"]) as archive:
            for row in members["definitions"]:
                if not row["name"].endswith(".json"):
                    continue
                value = self.source.json_value(archive.read(row["name"]))
                if isinstance(value, dict) and value.get("resourceType") == "StructureDefinition" and value.get("id") in {
                        "SDOHCC-TaskForReferralManagement", "SDOHCC-ServiceRequest", "SDOHCC-Consent"}:
                    must(value.get("version") == "3.0.0" and value.get("fhirVersion") == "4.0.1",
                         "The selected original computable profile differs from Gravity3.0.0 / FHIR4.0.1")
                    profiles[value["id"]] = {**row, "url": value.get("url"), "version": value["version"],
                        "snapshotElements": len(value.get("snapshot", {}).get("element", [])),
                        "differentialElements": len(value.get("differential", {}).get("element", []))}
        must(set(profiles) == {"SDOHCC-TaskForReferralManagement", "SDOHCC-ServiceRequest", "SDOHCC-Consent"},
             "Retain the complete original Task, ServiceRequest and Consent computable definitions")
        with Path(examples["file"]).open("rb") as stream:
            added = self.ws.import_published_examples(stream, {"label": "HL7 Gravity3.0 complete original examples",
                "actor": ACTOR, "publicationUrl": EXAMPLES_URL, "referenceBase": REFERENCE_BASE,
                "note": "The operator explicitly assigns this reference base to the separately published originals. Every original member and complete archive is retained unchanged."})
        with Path(definitions["file"]).open("rb") as stream:
            artifact = self.ws.add_artifact(stream, "HL7 Gravity3.0 complete computable definitions",
                Path(definitions["file"]).name, "application/zip")
        source_id = added["source"]["id"]
        all_tasks = self.source_rows(source_id, "Task")
        task_code = "http://hl7.org/fhir/CodeSystem/task-code"
        selected = []
        for row in all_tasks:
            value = self.source.json_value(row["jsonText"], lexical=True)
            from referral_domain import coding
            if value.get("intent") == "order" and coding(value.get("code"), task_code, "fulfill"):
                selected.append(row)
        must(0 < len(selected) <= 100, "Select the actual published referral Tasks within the product cohort limit")
        accepted = [r for r in selected if self.source.json_value(r["jsonText"]).get("status") == "accepted"]
        must(accepted, "The complete published cohort must contain its actual accepted referral example")
        accepted.sort(key=lambda r: (r.get("id") != "SDOHCC-TaskReferralManagementOrderFulfillmentAcceptedExample", r["recordId"]))
        self.file("ORIGINAL_ARCHIVE_INDEX.json", {"examples": examples, "definitions": definitions,
            "members": members, "computableProfiles": profiles, "referenceAssignments": added["referenceAssignments"],
            "sourceId": source_id, "taskIds": [r["recordId"] for r in selected]})
        return {"sourceId": source_id, "examples": examples, "definitions": definitions,
            "definitionArtifactId": artifact["id"], "profiles": profiles,
            "inventory": added["source"]["inventory"], "taskIds": [r["recordId"] for r in selected],
            "selectedTaskId": accepted[0]["recordId"], "selectedLogicalId": accepted[0]["id"],
            "referenceAssignments": added["referenceAssignments"]}

    def start_example_server(self, original):
        rows = [r for r in self.source_rows(original["sourceId"])
                if not r.get("containedIn") and not r.get("bundleIn")]
        self.example_server = self.server_module.PublishedExampleServer(
            self.output / "original-http-server", original["sourceId"], rows,
            self.journal.get("exampleServerPort", 0))
        self.journal["exampleServerPort"] = self.example_server.server_address[1]
        self.checkpoint()

    def topology_review(self, phase, original):
        if "connectionId" in phase:
            connection = self.ws.connection(phase["connectionId"])
        else:
            connection = self.ws.save_connection({"label": "Actual local Gravity published-source receiving",
                "baseUrl": self.example_server.base_url, "origin": "published_sample", "publisher": "HL7 original examples",
                "sourceUrl": EXAMPLES_URL, "note": "Actual loopback HTTP exercise of unchanged published resource values with explicitly retained version metadata."})
            phase["connectionId"] = connection["id"]; self.checkpoint()
        if "discoveryId" in phase:
            discovery = self.ws.discovery(phase["discoveryId"])
        else:
            discovery = self.ws.discover(connection["id"])
            phase["discoveryId"] = discovery["id"]; self.checkpoint()
        accepted = self.ws.source_row(original["sourceId"], original["selectedTaskId"])
        resource = self.source.json_value(accepted["jsonText"], lexical=True)
        target_org = resource.get("owner", {}).get("reference")
        requester = resource.get("requester", {}).get("reference")
        must(target_org and requester, "The selected original Task retains its actual requester and owner")
        organizations = self.source_rows(original["sourceId"], "Organization")
        role_rows = self.source_rows(original["sourceId"], "PractitionerRole")
        source_org = requester
        for row in role_rows:
            if requester == "PractitionerRole/" + str(row.get("id")):
                candidate = self.source.json_value(row["jsonText"]).get("organization", {}).get("reference")
                if candidate:
                    source_org = candidate
        intermediary = next(("Organization/" + r["id"] for r in organizations
                             if "CoordinationPlatform" in r["id"]), target_org)
        configs, editions = [], []
        for topology, host in [("direct", "target"), ("direct-light", "source"),
                                ("intermediary", "target"), ("intermediary-light", "intermediary")]:
            actors = [{"role": "source", "organization": source_org, "connectionId": connection["id"],
                       "owner": ACTOR, "note": "Original source requester organisation; shared local example endpoint selected for this receiving exercise."},
                      {"role": "target", "organization": target_org, "connectionId": connection["id"],
                       "owner": ACTOR, "note": "Exact Task.owner from the selected published accepted referral."}]
            if topology.startswith("intermediary"):
                actors.append({"role": "intermediary", "organization": intermediary, "connectionId": connection["id"],
                    "owner": ACTOR, "note": "Original published coordination organisation; topology selection retained separately."})
            config = self.ws.save_referral_configuration({"label": "Published-source " + topology + " operating edition",
                "actor": ACTOR, "topology": topology, "recipientHostRole": host, "roles": actors,
                "sourceVersion": "3.0.0", "classification": "published_example",
                "monitoring": {"mode": "poll", "intervalMinutes": 60, "timezone": "UTC",
                    "businessDays": [1,2,3,4,5], "businessStart": "09:00", "businessEnd": "17:00",
                    "urgent": False, "owner": ACTOR, "reason": "Explicit one-hour operating selection for the retained published-source exercise."}})
            edition = self.ws.save_referral_edition({"label": "Complete published referral cohort · " + topology,
                "actor": ACTOR, "note": "All original fulfill/order Tasks; source members and reviewed reference assignments retained.",
                "sourceId": original["sourceId"], "configurationId": config["id"], "taskIds": original["taskIds"],
                "referencePolicy": "bundle", "baseUrl": "", "decisionIds": []})
            configs.append(config); editions.append(edition)
        draft = self.ws.initial_referral_review({"label": "Gravity complete original 57 requirement / 24 field review", "actor": ACTOR,
            "note": "Original source profile adopted completely before any receiving-specific disposition."})
        initial = self.ws.assess_referrals({"label": "Original complete published referral assessment", "actor": ACTOR,
            "editionId": editions[0]["id"], "reviewId": draft["id"], "asOf": phase["asOf"]})
        review = {key: deepcopy(draft[key]) for key in ["label", "actor", "note", "profileId", "requirements", "fields"]}
        review.update(label="Reviewed original Gravity referral operating fields", predecessorId=draft["id"])
        for row in review["requirements"]:
            if row["key"].startswith("refer-"):
                row.update(status="applicable", reason="This original referral requirement is selected for the complete published Task cohort; its source-bound findings remain in the assessment.",
                    owner=ACTOR, reviewer=ACTOR, reviewedAt=phase["asOf"])
        for row in review["fields"]:
            if row["key"] in {"task-status", "task-intent", "task-code", "task-focus", "task-owner"}:
                row.update(status="applicable", reason="Review the unchanged published values and their exact resource pointers in the saved full assessment.",
                    owner=ACTOR, reviewer=ACTOR, reviewedAt=phase["asOf"])
        selected_review = self.ws.save_referral_review(review)
        consents = self.source_rows(original["sourceId"], "Consent")
        decision = self.ws.save_referral_decision({"label": "Published example conditional-exchange purpose",
            "actor": ACTOR, "editionId": editions[0]["id"], "kind": "consent", "outcome": "permit",
            "reason": "The operator authorises this local exercise of the published fictional source resources; the original published Consent and attachments remain available for scope review.",
            "taskIds": original["taskIds"], "resourceIds": [r["recordId"] for r in consents],
            "sourceRefs": [{"sourceId": original["sourceId"], "recordId": accepted["recordId"], "pointer": accepted["entryPointer"]}],
            "purpose": "Operate the unchanged published Gravity examples through local conditional receiving",
            "owner": ACTOR, "recordedAt": phase["asOf"]})
        assessed = self.ws.assess_referrals({"label": "Reviewed complete published referral queue", "actor": ACTOR,
            "editionId": editions[0]["id"], "reviewId": selected_review["id"], "asOf": phase["asOf"]})
        report = self.ws.referral_assessment(assessed["id"])
        must(len(report["tasks"]) == len(original["taskIds"]) and len(report["cells"]) == 24 * len(original["taskIds"]),
             "The native assessment must retain every selected Task and all24 field observations per Task")
        self.file("ORIGINAL_REFERRAL_ASSESSMENT.json", report)
        return {"connectionId": connection["id"], "discoveryId": discovery["id"],
            "configurationIds": [r["id"] for r in configs], "editionIds": [r["id"] for r in editions],
            "reviewIds": [draft["id"], selected_review["id"]], "assessmentIds": [initial["id"], assessed["id"]],
            "configurationId": configs[0]["id"], "editionId": editions[0]["id"], "reviewId": selected_review["id"],
            "assessmentId": assessed["id"], "decisionId": decision["id"], "purpose": decision["purpose"],
            "taskIds": original["taskIds"], "summary": assessed["summary"]}

    def correction(self, phase, original, selected):
        preview = self.ws.preview_referral_correction({"label": "Reviewed accepted referral starts work",
            "actor": ACTOR, "editionId": selected["editionId"], "reason": "The selected local receiving exercise starts the accepted published referral; preserve the original accepted Task unchanged as predecessor.",
            "patches": [{"recordId": original["selectedTaskId"], "path": "/status", "action": "replace", "valueJson": '"in-progress"'}]})
        request = {"previewId": preview["id"], "expectedRequestSha256": preview["requestSha256"]}
        corrected = self.ws.apply_referral_correction(request)
        repeated = self.ws.apply_referral_correction(request)
        must(corrected == repeated, "The exact same reviewed correction must reopen its original successor")
        comparison = self.ws.compare_referral_editions({"label": "Full published original to reviewed source correction",
            "actor": ACTOR, "beforeId": selected["editionId"], "afterId": corrected["editionId"], "decisionIds": []})
        must(comparison["summary"].get("changed") == 1, "Exactly the selected original referral must change")
        after = self.ws.assess_referrals({"label": "Complete corrected referral queue", "actor": ACTOR,
            "editionId": corrected["editionId"], "reviewId": selected["reviewId"], "asOf": phase["asOf"]})
        new_task = corrected["recordMap"][original["selectedTaskId"]]
        row = self.ws.source_row(corrected["sourceId"], new_task)
        must(self.source.json_value(row["jsonText"])["status"] == "in-progress",
             "The exact reviewed original Task status did not reach its selected successor")
        self.file("CORRECTION_PREVIEW.json", preview)
        self.file("COMPLETE_SOURCE_COMPARISON.json", self.source.json_value(self.ws._file_path(comparison["changesFile"]).read_bytes()))
        self.file("CORRECTED_REFERRAL_ASSESSMENT.json", self.ws.referral_assessment(after["id"]))
        return {"sourceId": corrected["sourceId"], "editionId": corrected["editionId"], "taskId": new_task,
            "correctionId": corrected["id"], "previewId": preview["id"], "comparisonId": comparison["id"],
            "assessmentId": after["id"], "counts": comparison["summary"], "recordMap": corrected["recordMap"]}

    def exchange(self, phase, original, selected, corrected):
        body = self.ws.source_row(corrected["sourceId"], corrected["taskId"])["jsonText"]
        base = {"actor": ACTOR, "editionId": selected["editionId"], "connectionId": selected["connectionId"],
            "discoveryId": selected["discoveryId"], "recordId": original["selectedTaskId"],
            "resourceType": "Task", "logicalId": original["selectedLogicalId"], "role": "target"}
        read_request = self.ws.save_referral_exchange_request({**base, "label": "Read the exact published accepted referral",
            "method": "GET", "note": "Actual original HTTP read from the selected published-source listener."})
        read = self.ws.advance_referral_exchange(read_request["id"], self.journal["operationIds"]["read"])
        must(read["state"] == "complete", "The actual original Task read did not complete: " + str(read))
        write_request = self.ws.save_referral_exchange_request({**base,
            "label": "Receive the exact reviewed in-progress referral", "method": "PUT", "bodyJson": body,
            "expectedETag": 'W/"1"', "createIfAbsent": False, "consentDecisionId": selected["decisionId"],
            "purpose": selected["purpose"],
            "note": "Actual target-role status change through the original conditional PUT and complete readback."})
        written = self.ws.advance_referral_exchange(write_request["id"], self.journal["operationIds"]["write"])
        must(written["state"] == "complete", "The actual conditional source exchange did not complete: " + str(written))
        puts = self.example_server.saved["putCount"]
        repeated = self.ws.advance_referral_exchange(write_request["id"], self.journal["operationIds"]["write"])
        must(repeated["id"] == written["id"] and repeated["state"] == "complete" and self.example_server.saved["putCount"] == puts,
             "Reopening the same original operation must receive its saved result without another PUT")
        stale_request = self.ws.save_referral_exchange_request({**base,
            "label": "Review the retained prior source version after receiving", "method": "PUT", "bodyJson": body,
            "expectedETag": 'W/"1"', "createIfAbsent": False, "consentDecisionId": selected["decisionId"],
            "purpose": selected["purpose"],
            "note": "An explicitly selected stale preimage is reviewed against the actual received version."})
        stale = self.ws.advance_referral_exchange(stale_request["id"], self.journal["operationIds"]["staleWrite"])
        must(stale["state"] == "review-required" and stale["phase"] == "original-resource-changed" and
             self.example_server.saved["putCount"] == puts, "The prior source preimage must retain its actual version difference")
        history = self.ws.prepare_referral_monitoring({"label": "Complete actual referral version history",
            "actor": ACTOR, "configurationId": selected["configurationId"], "connectionId": selected["connectionId"],
            "discoveryId": selected["discoveryId"], "taskId": original["selectedLogicalId"], "history": True,
            "note": "Receive every retained version of the exact original Task using the existing acquisition engine."})
        monitoring = self.ws.prepare_referral_monitoring({"label": "Actual in-progress referral queue receiving",
            "actor": ACTOR, "configurationId": selected["configurationId"], "connectionId": selected["connectionId"],
            "discoveryId": selected["discoveryId"], "statuses": ["in-progress"], "history": False,
            "note": "An explicit original Task status search with complete returned pages and reference observations."})
        acquired = []
        for key, record in [("history", history), ("monitoring", monitoring)]:
            for _ in range(1024):
                operation = self.ws.advance(record["requestId"], self.journal["operationIds"][key])
                if operation["state"] == "complete":
                    break
                must(operation["state"] in {"ready", "running"},
                     "The selected original source receiving has an actual native condition: " + str(operation))
            must(operation["state"] == "complete", "The selected complete native acquisition did not reach its retained end")
            acquired.append(operation)
        self.file("ORIGINAL_CONDITIONAL_EXCHANGE.json", written)
        self.file("ORIGINAL_STALE_VERSION_REVIEW.json", stale)
        self.file("ORIGINAL_NATIVE_ACQUISITIONS.json", acquired)
        self.file("ORIGINAL_HTTP_SERVER_SUMMARY.json", {"classification": "published-example-http-exercise",
            "sourceId": original["sourceId"], "baseUrl": self.example_server.base_url,
            "putCount": self.example_server.saved["putCount"],
            "resources": len(self.example_server.saved["resources"]),
            "httpReceipts": len(self.example_server.saved["receipts"]),
            "originalTask": original["selectedLogicalId"],
            "versions": self.example_server.saved["resources"]["Task/" + original["selectedLogicalId"]]["versions"]})
        return {"exchangeRequestIds": [read_request["id"], write_request["id"], stale_request["id"]],
            "exchangeOperationIds": [read["id"], written["id"], stale["id"]],
            "monitoringIds": [history["id"], monitoring["id"]],
            "acquisitionOperationIds": [r["operationId"] for r in acquired],
            "sourceIds": [read["sourceId"], written["sourceId"], *[r["sourceId"] for r in acquired]],
            "readOperation": read, "writeOperation": written, "staleVersionReview": stale,
            "history": acquired[0], "monitoring": acquired[1],
            "actualPutCount": self.example_server.saved["putCount"],
            "sourceServer": {"baseUrl": self.example_server.base_url, "directory": str(self.example_server.directory),
                             "classification": "published-example-http-exercise"}}

    def projections(self, phase, original, corrected):
        plan = self.ws.default_mapping(original["sourceId"], "Task", "Gravity complete original Task editions")
        # Original source locators remain in source lineage. Compare the actual resource
        # identity and lexical JSON across its reviewed successor rather than a new row hash.
        plan["columns"] = [c for c in plan["columns"] if not (c["source"] == "record" and c["path"] == ["recordId"])]
        must(plan["keys"], "The original published Task population must expose unique resource type and ID keys")
        preview = self.ws.projection_preview(original["sourceId"], plan)
        saved = self.ws.save_plan(plan)
        before = self.ws.build(original["sourceId"], saved["id"])
        after = self.ws.build(corrected["sourceId"], saved["id"])
        compared = self.ws.compare(before["id"], after["id"])
        must(compared["counts"].get("changed") == 1, "Exactly one original Task resource must change in the native dataset")
        query = self.ws.query(after["id"], {"limit": "5", "sort": "resource_id",
            "fields": "resource_type,resource_id,resource_json"})
        self.file("ORIGINAL_MAPPING_PREVIEW.json", preview)
        self.file("ORIGINAL_NATIVE_QUERY.json", query)
        self.file("ORIGINAL_NATIVE_DATASET_COMPARISON.json", compared)
        exports = []
        for label, build in [("original", before), ("corrected", after)]:
            destination = self.output / ("dataset-" + label)
            if not destination.exists():
                self.ws.export_dataset(build["id"], destination)
            lineage = self.source.json_value((destination / "eltss-lineage.json").read_bytes())
            must(lineage["build"]["id"] == build["id"], "The native dataset export changed its exact source build")
            exports.append({"directory": str(destination), "lineage": lineage})
        must(exports[0]["lineage"]["family"]["id"] == exports[1]["lineage"]["family"]["id"],
             "The authored correction changed its original source-selection family")
        packet = self.output / "Gravity_Complete_Customer_Dataset.zip"
        if not packet.exists():
            self.ws.export_packet(after["id"], packet)
        target_path = self.output / "customer-dataset-receiver"
        with self.module.Workspace(target_path, create=not target_path.exists()) as target:
            received = target.import_packet(packet)
            must(received["build"]["id"] == after["id"], "The complete original dataset packet changed its retained build identity")
            received_query = target.query(after["id"], {"limit": "5", "sort": "resource_id",
                "fields": "resource_type,resource_id,resource_json"})
            must(received_query["response"] == query["response"], "The exact received native dataset query changed")
        self.file("ORIGINAL_DATASET_RECEIVING.json", received)
        return {"planId": saved["id"], "buildIds": [before["id"], after["id"]],
            "comparisonId": compared["id"], "counts": compared["counts"],
            "baseDataset": exports[0]["directory"], "correctedDataset": exports[1]["directory"],
            "family": exports[0]["lineage"]["family"], "packet": identity(packet),
            "receiverWorkspace": str(target_path)}

    def merchant(self, phase, projections):
        request = {"sdk": str(self.sdk), "output": str(self.output), "baseDataset": projections["baseDataset"],
            "correctedDataset": projections["correctedDataset"], "merchant": str(self.output / "merchant-original"),
            "nextMerchant": str(self.output / "merchant-corrected"), "state": str(self.output / "merchant-state"),
            "customer": str(self.output / "original-buyer")}
        self.file("MERCHANT_INPUT.json", request)
        script = self.output / "operate-merchant.mjs"
        if script.exists():
            must(script.read_text() == MERCHANT_CODE, "The original merchant source differs from the operating journal")
        else:
            script.write_text(MERCHANT_CODE, encoding="utf-8"); os.chmod(script, 0o600)
        process = subprocess.run([self.args.node, str(script), str(self.output / "MERCHANT_INPUT.json")],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=180)
        self.file("MERCHANT_PROCESS.json", {"returncode": process.returncode,
            "stdout": process.stdout, "stderr": process.stderr})
        must(process.returncode == 0, "The original merchant/customer source operation did not finish: " + process.stderr[-4000:])
        result = self.source.json_value((self.output / "OPERATED_MERCHANT.json").read_bytes())
        with (self.output / "OPERATED_MERCHANT.json").open("rb") as stream:
            artifact = self.ws.add_artifact(stream, "Actual Gravity native merchant and buyer receiving",
                "OPERATED_MERCHANT.json", "application/json")
        return {**result, "artifactId": artifact["id"]}

    def delivery(self, phase, original, selected, corrected):
        handoff = self.ws.prepare_referral_handoff({"label": "Complete Gravity referral receiving and corrected source",
            "actor": ACTOR, "editionId": corrected["editionId"], "assessmentId": corrected["assessmentId"],
            "receiver": "Original local source-complete receiving workspace", "scope": "complete-workspace",
            "purpose": "Receive the selected original referral source, reviewed correction, conditional exchange and native datasets",
            "sourceRefs": [], "note": "Complete published examples and computable definitions, all authored topology and review editions, actual local HTTP receiving and full original source custody."})
        reopened_handoff = self.ws.prepare_referral_handoff({"label": "Complete Gravity referral receiving and corrected source",
            "actor": ACTOR, "editionId": corrected["editionId"], "assessmentId": corrected["assessmentId"],
            "receiver": "Original local source-complete receiving workspace", "scope": "complete-workspace",
            "purpose": "Receive the selected original referral source, reviewed correction, conditional exchange and native datasets",
            "sourceRefs": [], "note": "Complete published examples and computable definitions, all authored topology and review editions, actual local HTTP receiving and full original source custody."})
        must(handoff["id"] == reopened_handoff["id"], "The same frozen handoff must retain its original complete snapshot")
        packet = self.output / "Gravity_Complete_Referral_Handoff.zip"
        if not packet.exists():
            self.ws.export_referral_handoff(handoff["id"], packet)
        receiver = self.output / "handoff-receiver"
        with self.module.Workspace(receiver, create=not receiver.exists()) as target:
            received = target.import_referral_handoff(packet)
            same = target.import_referral_handoff(packet)
            must(target.workspace_id == self.ws.workspace_id and same.get("recovered"),
                 "The complete repeated handoff must reopen its original workspace UUID")
            must(target.referral_record("handoffs", handoff["id"]) == handoff, "The complete frozen handoff changed")
            must(target.referral_assessment(corrected["assessmentId"]) == self.ws.referral_assessment(corrected["assessmentId"]),
                 "The complete received source-bound field observations changed")
            before_source = identity(self.ws.source_path(original["sourceId"]))
            after_source = identity(target.source_path(original["sourceId"]))
            must(before_source["sha256"] == after_source["sha256"] == original["sourceId"],
                 "The complete original published source changed during receiving")
            receipt = {"schema": "stellar-forge.gravity-original-handoff-receiving.v1", "workspace": str(receiver),
                "workspaceId": target.workspace_id, "handoffId": handoff["id"], "archive": identity(packet),
                "sourceId": original["sourceId"], "assessmentId": corrected["assessmentId"],
                "receivedAt": phase.setdefault("receivedAt", stamp()), "receiving": received}
        self.checkpoint()
        receipt_path = self.output / "ORIGINAL_HANDOFF_RECEIVING.json"
        self.runtime.atomic_json(receipt_path, receipt)
        with receipt_path.open("rb") as stream:
            artifact = self.ws.add_artifact(stream, "Actual complete Gravity handoff receipt", receipt_path.name, "application/json")
        record = self.ws.save_referral_receiving({"label": "Received original complete Gravity workspace handoff",
            "actor": ACTOR, "handoffId": handoff["id"], "receiver": "Original local source-complete receiving workspace",
            "state": "received", "operationId": self.journal["operationIds"]["receiving"],
            "receivedAt": receipt["receivedAt"], "artifactId": artifact["id"], "destinationObjectId": receipt["workspaceId"],
            "sourceRefs": [], "note": "Actual native whole-handoff receiving, exact repeated import and unchanged source/assessment readback."})
        for name, descriptor in handoff["files"].items():
            copy_exact(self.ws._file_path(descriptor), self.output / "readable-handoff" / name)
        self.file("COMPLETE_HANDOFF.json", handoff)
        self.file("SAVED_REFERRAL_RECEIVING.json", record)
        return {"handoffId": handoff["id"], "receivingId": record["id"], "artifactId": artifact["id"],
            "packet": {**identity(packet), "handoffId": handoff["id"]},
            "receiverWorkspace": str(receiver), "receiver": receipt}

    def restoration(self, phase, original, selected, corrected, delivery):
        expected = self.ws.state()
        packet = self.output / "Gravity_Complete_Editable_Workspace.zip"
        if not packet.exists():
            self.ws.export_workspace(packet)
        destination = self.output / "restored-workspace"
        with self.module.Workspace(destination, create=not destination.exists()) as target:
            first = target.import_workspace(packet)
            repeated = target.import_workspace(packet)
            must(target.workspace_id == self.ws.workspace_id and repeated.get("recovered"),
                 "The whole editable receiving must retain its original UUID and identical archive continuation")
            observed = target.state()
            counts = {}
            for kind, rows in expected["referral"].items():
                if not isinstance(rows, list) or kind == "receives":
                    continue
                actual = observed["referral"][kind]
                must(sorted(r["id"] for r in actual) == sorted(r["id"] for r in rows),
                     "Whole editable receiving changed original referral collection " + kind)
                for row in rows:
                    must(target.referral_record(kind, row["id"]) == self.ws.referral_record(kind, row["id"]),
                         "Whole editable receiving changed a complete original " + kind + " record")
                counts[kind] = len(actual)
            original_files = []
            for row in expected["sources"]:
                before = identity(self.ws.source_path(row["id"]))
                after = identity(target.source_path(row["id"]))
                must(before["sha256"] == after["sha256"] == row["id"] and before["bytes"] == after["bytes"],
                     "A complete original source changed in editable restoration")
                original_files.append(after)
            for row in expected["artifacts"]:
                must(identity(target.artifact_path(row["id"]))["sha256"] ==
                     identity(self.ws.artifact_path(row["id"]))["sha256"], "A complete retained artifact changed")
            for row in expected["builds"]:
                actual = target.build_view(row["id"])
                must(actual == row, "The retained original native dataset build changed")
            for ident in selected["assessmentIds"] + [corrected["assessmentId"]]:
                must(target.referral_assessment(ident) == self.ws.referral_assessment(ident),
                     "Original complete field observations changed after fresh restoration")
        with self.module.Workspace(destination) as target:
            must(target.referral_record("editions", corrected["editionId"])["sourceId"] == corrected["sourceId"],
                 "The reopened original corrected edition lost its exact source")
            reopened_id = target.workspace_id
        result = {"workspace": str(destination), "workspaceId": reopened_id, "packet": identity(packet),
            "collections": counts, "originalFiles": original_files, "reopened": True}
        self.file("WHOLE_WORKSPACE_RECEIVING.json", result)
        return result

    def server_custody(self, phase, original):
        directory = self.output / "original-http-server"
        self.file("ORIGINAL_HTTP_SOURCE_BINDING.json", {"sourceId": original["sourceId"],
            "classification": "published-example-http-exercise", "directory": str(directory),
            "files": [identity(p) for p in sorted(directory.iterdir()) if p.is_file()]})
        packet = self.output / "Gravity_Complete_Original_HTTP_Exchange.zip"
        if not packet.exists():
            self.runtime.write_zip(packet, {p.name: p for p in sorted(directory.iterdir()) if p.is_file()})
        with packet.open("rb") as stream:
            artifact = self.ws.add_artifact(stream, "Complete actual local published-source HTTP custody",
                packet.name, "application/zip")
        return {"packet": identity(packet), "artifactId": artifact["id"]}

    def run(self):
        source_files = []
        own_root = self.sdk / "fhir_referral"
        for path in sorted(own_root.rglob("*")):
            if not path.is_file() or path.is_symlink() or "__pycache__" in path.parts or "connected" in path.relative_to(own_root).parts:
                continue
            raw = path.read_bytes()
            if path.suffix == ".py":
                ast.parse(raw, filename=str(path))
            source_files.append({"path": path.relative_to(self.sdk).as_posix(), **identity(path),
                "gitBlob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
        self.file("SOURCE_FILES.json", source_files)
        self.ws = self.module.Workspace(self.workspace, create=not self.workspace.exists())
        try:
            if self.journal.get("workspaceId"):
                must(self.journal["workspaceId"] == self.ws.workspace_id, "The original operated workspace UUID changed")
            else:
                self.journal["workspaceId"] = self.ws.workspace_id; self.checkpoint()
            original = self.phase("complete-original-published-archives", self.originals)
            self.start_example_server(original)
            reviewed = self.phase("four-topologies-and-complete-81-row-review",
                lambda row: self.topology_review(row, original))
            corrected = self.phase("reviewed-original-source-correction",
                lambda row: self.correction(row, original, reviewed))
            exchange = self.phase("actual-conditional-http-and-original-monitoring",
                lambda row: self.exchange(row, original, reviewed, corrected))
            self.example_server.close(); self.example_server = None
            server_custody = self.phase("complete-original-http-custody",
                lambda row: self.server_custody(row, original))
            projections = self.phase("native-datasets-and-complete-customer-receiving",
                lambda row: self.projections(row, original, corrected))
            merchant = self.phase("original-native-merchant-and-buyer-edition",
                lambda row: self.merchant(row, projections))
            delivery = self.phase("complete-frozen-handoff-and-receiving",
                lambda row: self.delivery(row, original, reviewed, corrected))
            restoration = self.phase("whole-editable-receiving-and-reopen",
                lambda row: self.restoration(row, original, reviewed, corrected, delivery))
            state = self.ws.state()
            result = {"schema": SCHEMA, "operation": OPERATION, "completedAt": stamp(),
                "sourceRoot": str(self.sdk), "workspace": str(self.workspace), "workspaceId": self.ws.workspace_id,
                "originalExamples": original["examples"], "originalDefinitions": original["definitions"],
                "sourceIds": [r["id"] for r in state["sources"]],
                "configurationIds": [r["id"] for r in state["referral"]["configurations"]],
                "editionIds": [r["id"] for r in state["referral"]["editions"]],
                "reviewIds": [r["id"] for r in state["referral"]["reviews"]],
                "assessmentIds": [r["id"] for r in state["referral"]["assessments"]],
                "decisionIds": [r["id"] for r in state["referral"]["decisions"]],
                "correctionIds": [r["id"] for r in state["referral"]["corrections"]],
                "comparisonIds": [r["id"] for r in state["referral"]["comparisons"]],
                "handoffIds": [r["id"] for r in state["referral"]["handoffs"]],
                "receivingIds": [r["id"] for r in state["referral"]["receivings"]],
                "exchangeRequestIds": exchange["exchangeRequestIds"], "exchangeOperationIds": exchange["exchangeOperationIds"],
                "monitoringIds": exchange["monitoringIds"], "acquisitionOperationIds": exchange["acquisitionOperationIds"],
                "connectionIds": [reviewed["connectionId"]], "discoveryIds": [reviewed["discoveryId"]],
                "buildIds": projections["buildIds"], "planId": projections["planId"],
                "artifactIds": [r["id"] for r in state["artifacts"]],
                "sourceId": original["sourceId"], "graphId": self.ws.referral_record("editions", reviewed["editionId"])["graphId"],
                "baseSourceId": original["sourceId"], "baseEditionId": reviewed["editionId"],
                "baseAssessmentId": reviewed["assessmentId"], "correctedSourceId": corrected["sourceId"],
                "correctedEditionId": corrected["editionId"], "correctedAssessmentId": corrected["assessmentId"],
                "selectedOriginalTaskId": original["selectedTaskId"], "selectedCorrectedTaskId": corrected["taskId"],
                "selectedLogicalId": original["selectedLogicalId"], "reviewId": reviewed["reviewId"],
                "workspacePacket": restoration["packet"], "handoffPackets": [delivery["packet"]],
                "restoredWorkspace": restoration["workspace"], "restoration": restoration,
                "topologyReview": reviewed, "correction": corrected, "exchange": exchange,
                "nativeProjections": projections, "merchant": merchant, "receiving": delivery,
                "httpCustody": server_custody, "sourceFiles": source_files,
                "phases": [{"name": r["name"], "startedAt": r["startedAt"], "completedAt": r["completedAt"],
                            "state": r["state"]} for r in self.journal["phases"]],
                "files": [identity(path) for path in sorted(self.output.iterdir()) if path.is_file() and
                          path.name not in {"receiving.lock", "RECEIVING_JOURNEY.json", "OPERATED_GRAVITY_REFERRAL.json"}]}
            self.file("OPERATED_GRAVITY_REFERRAL.json", result)
            self.journal["completedAt"] = result["completedAt"]; self.checkpoint()
            return result
        finally:
            if self.example_server is not None:
                self.example_server.close()
            if self.ws is not None:
                self.ws.close()
            self.lease.close()

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-root", default=str(Path(__file__).resolve().parent.parent),
                   help="Absolute original SF30 SDK source directory")
    p.add_argument("--workspace", help="Original private Gravity workspace, defaults to OUTPUT/workspace")
    p.add_argument("--output", required=True, help="Original private journal and complete outputs, reuse on continuation")
    p.add_argument("--examples", required=True, help="Complete unchanged published Gravity3.0 examples.json.zip")
    p.add_argument("--definitions", required=True, help="Complete unchanged published Gravity3.0 definitions.json.zip")
    p.add_argument("--node", default=os.environ.get("SF30_REFERRAL_NODE") or
                   os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node")
    args = p.parse_args(argv)
    result = Journey(args).run()
    print(json.dumps({"schema": SCHEMA, "operation": OPERATION, "workspace": result["workspace"],
        "workspaceId": result["workspaceId"], "output": str(Path(args.output).absolute()),
        "sourceIds": result["sourceIds"], "handoffIds": result["handoffIds"],
        "workspacePacket": result["workspacePacket"]}), flush=True)

if __name__ == "__main__":
    main()
