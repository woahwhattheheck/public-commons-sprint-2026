#!/usr/bin/env python3
"""MIT. Operate the unchanged SMART public source through the complete native product."""
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
import stat
import subprocess
import sys
import time
import uuid
import zipfile

SCHEMA = "stellar-forge.fhir-bulk-operated-receiving.v1"
OPERATION = "SCF-FHIR-BULK-DATA-WORKBENCH-450E-20261012"
PUBLIC_BASE = "https://bulk-data.smarthealthit.org/fhir"


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest_file(path):
    before = path.stat()
    h = hashlib.sha256()
    with path.open("rb") as stream:
        while data := stream.read(1024 * 1024):
            h.update(data)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError("Original file changed during receiving: " + str(path))
    return {"file": str(path), "bytes": before.st_size, "sha256": h.hexdigest()}


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError("Choose an original regular private directory")
    os.chmod(path, 0o700)


def atomic(path, value):
    data = encode(value)
    temporary = path.parent / (".receiving-" + uuid.uuid4().hex)
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def retained(path, fallback=None):
    try:
        return json.loads(path.read_bytes())
    except FileNotFoundError:
        return fallback


def same_membership(before, after):
    keys = {"sources": "id", "plans": "id", "builds": "id", "comparisons": "id",
            "connections": "id", "exports": "id", "discoveries": "id",
            "groupPages": "id", "operations": "operationId", "compositions": "sourceId"}
    counts = {}
    for collection, key in keys.items():
        wanted = sorted(item[key] for item in before[collection])
        actual = sorted(item[key] for item in after[collection])
        if actual != wanted:
            raise RuntimeError("Original whole receiving changed " + collection)
        counts[collection] = len(actual)
    return counts


MERCHANT_CODE = r"""
import {readFile, writeFile, mkdir, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const sdk = input.sdk;
const {prepareFhirBulkMerchant, readFhirBulkMerchant, startFhirBulkMerchant,
  publishFhirBulkMerchant} = await import(pathToFileURL(join(sdk, 'fhir_bulk/merchant.mjs')));
const {reviewFhirBulkBuyer, prepareFhirBulkBuyer} = await import(pathToFileURL(join(sdk, 'fhir_bulk/customer.mjs')));
const {datasetControl} = await import(pathToFileURL(join(sdk, 'dataset-refresh/service.mjs')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = async (name, value) => {
  const file = join(input.output, name);
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  await chmod(file, 0o600); return file;
};
const originalExample = JSON.parse(await readFile(join(sdk, 'examples/service.json'), 'utf8'));
const payment = originalExample.routes[0].definition.payment;
const prepared = await prepareFhirBulkMerchant({datasetDirectory: input.baseDataset,
  directory: input.merchant, payment, origin: 'https://fhir-bulk.example', path: '/patient-source'});
const release = await readFhirBulkMerchant(input.merchant);
const nextPrepared = await prepareFhirBulkMerchant({datasetDirectory: input.composedDataset,
  directory: input.nextMerchant, payment, origin: 'https://fhir-bulk.example', path: '/patient-source'});
await mkdir(input.customer, {recursive: true, mode: 0o700});
const server = await startFhirBulkMerchant({directory: input.merchant, stateDirectory: input.state,
  port: 0, controlTransport: 'loopback', maxInFlight: 4, drainGraceMs: 5000,
  maxCachedVersions: 1, maxResidentRows: 100000});
try {
  const before = await datasetControl(input.state, 'status');
  const reviewed = await reviewFhirBulkBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'}});
  const buyer = await prepareFhirBulkBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'fhir-bulk-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
    destination: join(input.customer, 'buyer.json')});
  const repeated = await prepareFhirBulkBuyer({directory: input.merchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'fhir-bulk-original-source-450e', acceptIndex: 0, offerSha256: reviewed.offerSha256,
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
  const published = await publishFhirBulkMerchant({directory: input.nextMerchant,
    stateDirectory: input.state, expectedSnapshot: before.current, expectedRevision: before.revision});
  const after = await datasetControl(input.state, 'status');
  const nextOffer = await reviewFhirBulkBuyer({directory: input.nextMerchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'}});
  const nextBuyer = await prepareFhirBulkBuyer({directory: input.nextMerchant, seller: server.url,
    query: {limit: '5', fields: 'resource_type,resource_id,resource_json'},
    intentId: 'fhir-bulk-composed-source-450e', acceptIndex: 0, offerSha256: nextOffer.offerSha256,
    destination: join(input.customer, 'composed-buyer.json')});
  const value = {schema: 'stellar-forge.fhir-bulk-operated-merchant.v1',
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
        self.workspace = Path(args.workspace).expanduser().absolute()
        for path in [self.output, self.output / "temporary"]:
            private_directory(path)
        os.environ["TMPDIR"] = str(self.output / "temporary")
        os.environ["SF30_XML_NODE"] = args.node
        os.environ["SF30_FHIR_NODE"] = args.node
        sys.path.insert(0, str(self.sdk / "fhir_bulk"))
        self.module = importlib.import_module("fhir_workspace")
        self.cli = importlib.import_module("cli")
        lock = self.output / "receiving.lock"
        self.lease = os.fdopen(os.open(lock, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b")
        try:
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
        except OSError:
            self.lease.close()
            raise RuntimeError("The original receiving operation is already active in this output directory") from None
        self.path = self.output / "RECEIVING_JOURNEY.json"
        self.journal = retained(self.path)
        if self.journal is None:
            self.journal = {"schema": SCHEMA, "operation": OPERATION, "sourceRoot": str(self.sdk),
                "workspace": str(self.workspace), "output": str(self.output), "createdAt": stamp(),
                "selectedGroupId": args.group_id, "resourceTypes": ["Patient", "Observation"],
                "baseOperationId": str(uuid.uuid4()), "deltaOperationId": str(uuid.uuid4()),
                "phases": [], "artifacts": []}
            self.checkpoint()
        if self.journal.get("schema") != SCHEMA or self.journal.get("workspace") != str(self.workspace) or \
           self.journal.get("sourceRoot") != str(self.sdk) or self.journal.get("selectedGroupId") != args.group_id:
            raise RuntimeError("Reuse the original source/workspace/Group selection for this receiving journal")
        self.ws = None

    def checkpoint(self):
        self.journal["updatedAt"] = stamp()
        atomic(self.path, self.journal)

    def phase(self, name, callback):
        entry = next((item for item in self.journal["phases"] if item["name"] == name), None)
        if entry and entry["state"] == "complete":
            return entry["result"]
        if entry is None:
            entry = {"name": name, "state": "running", "startedAt": stamp()}
            self.journal["phases"].append(entry)
        else:
            entry["state"] = "running"
            entry["resumedAt"] = stamp()
        self.checkpoint()
        print(json.dumps({"operation": OPERATION, "phase": name, "state": "running"}), flush=True)
        try:
            result = callback(entry)
            entry.update(state="complete", result=result, completedAt=stamp())
            entry.pop("error", None)
            self.checkpoint()
            print(json.dumps({"operation": OPERATION, "phase": name, "state": "complete"}), flush=True)
            return result
        except BaseException as exc:
            entry.update(state="interrupted", error=str(exc), interruptedAt=stamp())
            self.checkpoint()
            raise

    def file(self, name, value):
        path = self.output / name
        atomic(path, value)
        return digest_file(path)

    def source_identity(self):
        files = []
        for name in ["fhir_source.py", "fhir_acquisition.py", "fhir_workspace.py", "fhir_runtime.py",
                     "fhir_auth.mjs", "cli.py", "cli.mjs", "merchant.mjs", "customer.mjs",
                     "operate_receiving.py"]:
            path = self.sdk / "fhir_bulk" / name
            raw = path.read_bytes()
            if name.endswith(".py"):
                ast.parse(raw, filename=str(path))
            files.append({"path": "fhir_bulk/" + name, **digest_file(path),
                "gitBlob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
        for name in ["xml/workspace.py", "xml/xml_source.py", "xml/native.mjs", "dataset-handler.mjs",
                     "dataset-cli.mjs", "dataset-refresh/versions.mjs", "dataset-refresh/buyer-handoff.mjs"]:
            path = self.sdk / name
            raw = path.read_bytes()
            files.append({"path": name, **digest_file(path),
                "gitBlob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
        self.file("SOURCE_FILES.json", files)
        return files

    def provider(self, entry):
        connection = self.ws.save_connection(self.ws.catalogue()["examples"][0]["connection"])
        if connection["connection"]["baseUrl"] != PUBLIC_BASE:
            raise RuntimeError("The original operating example must use the unchanged public SMART source")
        if entry.get("discoveryId"):
            discovery = self.ws.discovery(entry["discoveryId"])
        else:
            discovery = self.ws.discover(connection["id"])
            entry["discoveryId"] = discovery["id"]
            self.checkpoint()
        if not {"Patient", "Observation"}.issubset(set(discovery["resourceTypes"])):
            raise RuntimeError("The original source does not advertise both selected FHIR resource types")
        pages = [self.ws.group_page(ident) for ident in entry.get("groupPageIds", [])]
        seen = set()
        while not pages or pages[-1]["nextUrl"]:
            if len(pages) >= 256:
                raise RuntimeError("Group review exceeds the supported 256 original-page receiving budget")
            next_url = pages[-1]["nextUrl"] if pages else None
            if next_url in seen:
                raise RuntimeError("The original Group search repeated its next page")
            seen.add(next_url)
            pages.append(self.ws.groups(connection["id"], next_url))
            entry["groupPageIds"] = [page["id"] for page in pages]
            self.checkpoint()
        candidates = [item for page in pages for item in page["items"]
                      if item.get("type") == "person" and item.get("actual") is True and
                      isinstance(item.get("id"), str) and isinstance(item.get("quantity"), int) and item["quantity"] > 0]
        requested = self.args.group_id
        if requested:
            selected = next((item for item in candidates if item["id"] == requested), None)
            if selected is None:
                raise RuntimeError("The explicitly selected Group was not returned with a positive original quantity")
        else:
            if not candidates:
                raise RuntimeError("The original source returned no populated person Group")
            selected = min(candidates, key=lambda row: (row["quantity"], row["id"]))
        selection = {"connectionId": connection["id"], "discoveryId": discovery["id"],
            "groupPageIds": [page["id"] for page in pages], "selectedGroupId": selected["id"],
            "group": selected, "selection": "Explicit requested original Group" if requested else
            "Complete populated original person Group with the smallest published quantity, then literal ID",
            "resourceTypes": self.journal["resourceTypes"], "fhirVersion": discovery["fhirVersion"]}
        self.file("ORIGINAL_PROVIDER_SELECTION.json", selection)
        return selection

    def capture(self, entry, provider, which, since=None):
        definition = self.ws.save_export({"connectionId": provider["connectionId"],
            "label": "SMART original " + which + " Patient and Observation export",
            "scope": "group", "groupId": provider["selectedGroupId"], "method": "GET",
            "parameters": {"types": ["Patient", "Observation"], "since": since},
            "note": "Complete original selected public Group and explicit resource types. Publisher Synthea sample source."})
        operation_id = self.journal[which + "OperationId"]
        entry.update(exportId=definition["id"], operationId=operation_id,
                     requestSha256=definition["export"]["request"]["requestSha256"])
        self.checkpoint()
        operation = self.cli.run_export(self.ws, definition["id"], operation_id, self.args.max_wait_seconds)
        if operation["state"] != "complete":
            self.file(which.upper() + "_RETAINED_OPERATION.json", operation)
            raise RuntimeError("Original " + which + " export is " + operation["state"] +
                "; continue its same saved operation ID with the original workbench")
        inventory = self.ws.source(operation["sourceId"])
        if inventory["inventory"]["classification"]["origin"] != "published_sample":
            raise RuntimeError("Original publisher sample classification changed")
        artifacts = self.file(which.upper() + "_RETAINED_OPERATION.json", operation)
        return {"operationId": operation_id, "exportId": definition["id"], "sourceId": operation["sourceId"],
                "requestSha256": operation["requestSha256"], "source": inventory, "operation": artifacts}

    def dataset(self, entry, base, composed):
        if entry.get("planId"):
            plan_id = entry["planId"]
        else:
            mapping = self.ws.default_mapping(base["sourceId"], "Patient", "SMART selected Group original Patient resources")
            # Review data-value editions while full file/line custody stays in source.
            mapping["columns"] = [column for column in mapping["columns"] if column["name"] != "record_id"]
            entry["mappingDecision"] = "Original resource values and identity retained; capture-specific record_id omitted from compared data cells"
            reviewed = self.ws.save_plan(mapping)
            plan_id = reviewed["id"]
            entry["planId"] = plan_id
            self.checkpoint()
        first = self.ws.build(base["sourceId"], plan_id)
        second = self.ws.build(composed["source"]["id"], plan_id)
        if first["rowCount"] <= 0 or second["rowCount"] <= 0:
            raise RuntimeError("The selected original complete Patient cohort must contain resources")
        preview = self.ws.projection_preview(base["sourceId"], self.ws.plan(plan_id), 5)
        query = self.ws.query(first["id"], {"fields": "resource_type,resource_id,resource_json", "limit": "5", "sort": "resource_id"})
        if query["response"]["status"] != 200:
            raise RuntimeError("Original native dataset query did not complete")
        pages, total = [query], query["response"]["body"]["page"]["total"]
        cursor = query["response"]["body"]["page"]["nextCursor"]
        while cursor:
            page = self.ws.query(first["id"], {"fields": "resource_type,resource_id,resource_json",
                "limit": "5", "sort": "resource_id", "cursor": cursor})
            if page["response"]["status"] != 200:
                raise RuntimeError("Original native cursor receiving did not complete")
            pages.append(page)
            cursor = page["response"]["body"]["page"]["nextCursor"]
        if sum(item["response"]["body"]["page"]["returned"] for item in pages) != total:
            raise RuntimeError("The complete original native query changed its row count")
        comparison = self.ws.compare(first["id"], second["id"])
        preview_file = self.file("REVIEWED_PROJECTION.json", {"plan": self.ws.plan(plan_id),
            "decision": entry["mappingDecision"], "preview": preview})
        query_file = self.file("ORIGINAL_NATIVE_QUERY.json", {"pages": pages, "total": total})
        comparison_file = self.file("ORIGINAL_NATIVE_COMPARISON.json", comparison)
        self.ws.native.close()
        return {"planId": plan_id, "buildIds": [first["id"], second["id"]], "builds": [first, second],
                "comparisonId": comparison["id"], "comparison": comparison,
                "projection": preview_file, "query": query_file, "comparisonArtifact": comparison_file}

    def export_dataset(self, build_id, directory):
        if directory.exists():
            expected = self.ws.build_view(build_id)
            lineage = retained(directory / "fhir-bulk-lineage.json")
            if not lineage or lineage.get("snapshot") != expected["native"]["snapshot"] or \
               lineage.get("build", {}).get("id") != build_id:
                raise RuntimeError("Existing merchant output belongs to a different native edition")
            for name in ["data.csv", "dataset.json"]:
                actual = digest_file(directory / name)
                if actual["sha256"] != expected["files"][name]["sha256"]:
                    raise RuntimeError("Existing merchant output changed original " + name)
            return {"directory": str(directory), "build": build_id, "reopened": True}
        return self.ws.export_dataset(build_id, directory)

    def deliver(self, entry, dataset):
        base = self.output / "merchant-input-base"
        composed = self.output / "merchant-input-composed"
        self.export_dataset(dataset["buildIds"][0], base)
        self.export_dataset(dataset["buildIds"][1], composed)
        customer = self.output / "source-backed-dataset.zip"
        if not customer.exists():
            self.ws.export_packet(dataset["buildIds"][1], customer)
        expected = self.ws.build_view(dataset["buildIds"][1])
        with zipfile.ZipFile(customer) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            if manifest["build"] != expected["id"]:
                raise RuntimeError("Existing customer packet belongs to a different selected edition")
        return {"baseDataset": str(base), "composedDataset": str(composed),
                "datasetPacket": digest_file(customer)}

    def merchant(self, entry, delivery):
        existing = retained(self.output / "OPERATED_MERCHANT.json")
        if existing:
            for buyer in [existing["buyer"], existing["nextBuyer"]]:
                if digest_file(Path(buyer["saved"]["path"]))["sha256"] != buyer["configSha256"]:
                    raise RuntimeError("A previously prepared original buyer file changed")
            return {"file": digest_file(self.output / "OPERATED_MERCHANT.json"), "result": existing}
        input = {"sdk": str(self.sdk), "output": str(self.output), **delivery,
            "merchant": str(self.output / "merchant-release-base"),
            "nextMerchant": str(self.output / "merchant-release-composed"),
            "state": str(self.output / "merchant-state"), "customer": str(self.output / "customer")}
        source = self.output / "operate-original-merchant.mjs"
        source.write_text(MERCHANT_CODE, encoding="utf-8")
        os.chmod(source, 0o600)
        request = self.output / "MERCHANT_RECEIVING_INPUT.json"
        atomic(request, input)
        stdout = self.output / "MERCHANT_STDOUT.jsonl"
        stderr = self.output / "MERCHANT_STDERR.log"
        with stdout.open("wb") as out, stderr.open("wb") as err:
            os.chmod(stdout, 0o600)
            os.chmod(stderr, 0o600)
            result = subprocess.run([self.args.node, str(source), str(request)], cwd=self.sdk,
                stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=180)
        if result.returncode:
            raise RuntimeError("Original seller/buyer receiving did not finish: " + stderr.read_text()[-4096:])
        value = retained(self.output / "OPERATED_MERCHANT.json")
        if not value:
            raise RuntimeError("Original seller/buyer result is missing")
        return {"file": digest_file(self.output / "OPERATED_MERCHANT.json"), "result": value}

    def receive_dataset(self, entry, delivery, dataset):
        destination = self.output / "received-dataset"
        with self.module.Workspace(destination, create=not destination.exists()) as receiver:
            actual = receiver.import_packet(Path(delivery["datasetPacket"]["file"]))
            expected = self.ws.build_view(dataset["buildIds"][1])
            if actual["build"]["id"] != expected["id"] or actual["build"]["native"] != expected["native"]:
                raise RuntimeError("The original customer receiver changed its native edition")
            for name in ["data.csv", "dataset.json"]:
                if actual["build"]["files"][name]["sha256"] != expected["files"][name]["sha256"]:
                    raise RuntimeError("The original customer receiver changed " + name)
            result = {"workspace": str(destination), "workspaceId": receiver.workspace_id,
                "buildId": actual["build"]["id"], "sourceId": actual["source"], "planId": actual["plan"],
                "snapshot": actual["build"]["native"]["snapshot"], "reconstructed": actual["reconstructed"]}
        return result

    def whole(self, entry, dataset):
        before = self.ws.state()
        packet = self.output / "editable-workspace.zip"
        if not packet.exists():
            self.ws.export_workspace(packet)
        archive_id = digest_file(packet)
        # Complete receiving on the original API replays the identical saved file.
        destination = self.output / "received-workspace"
        self.ws.close()
        self.ws = None
        with self.module.Workspace(destination, create=not destination.exists()) as receiver:
            result = receiver.import_workspace(packet)
            if not result["reconstructed"] or result["workspaceId"] != before["workspaceId"]:
                raise RuntimeError("Whole receiving changed the original workspace identity")
            counts = same_membership(before, receiver.state())
            for source in before["sources"]:
                path = receiver.source_path(source["id"])
                if digest_file(path)["sha256"] != source["id"]:
                    raise RuntimeError("Whole receiving changed an original source packet")
            repeat = receiver.import_workspace(packet)
            if not repeat["reconstructed"] or repeat["workspaceId"] != before["workspaceId"]:
                raise RuntimeError("Same archive receiving did not reopen its original identity")
        with self.module.Workspace(destination) as receiver:
            reopened = receiver.state()
            same_membership(before, reopened)
            query = receiver.query(dataset["buildIds"][1], {"fields": "resource_type,resource_id", "limit": "5"})
            if query["response"]["status"] != 200:
                raise RuntimeError("The reopened native dataset did not serve its original query")
            self.file("RESTORED_WORKSPACE.json", reopened)
        self.ws = self.module.Workspace(self.workspace)
        same_membership(before, self.ws.state())
        return {"workspacePacket": archive_id, "restoredWorkspace": str(destination),
            "workspaceId": before["workspaceId"], "counts": counts, "reconstructed": True, "reopened": True}

    def run(self):
        completed = retained(self.output / "OPERATED_FHIR_BULK.json")
        if completed:
            for item in completed["artifacts"]:
                actual = digest_file(Path(item["file"]))
                if actual["sha256"] != item["sha256"] or actual["bytes"] != item["bytes"]:
                    raise RuntimeError("A completed receiving artifact changed")
            print(json.dumps({"state": "complete", "reopened": True,
                "result": str(self.output / "OPERATED_FHIR_BULK.json")}), flush=True)
            return completed
        self.journal["sourceFiles"] = self.source_identity()
        self.checkpoint()
        self.ws = self.module.Workspace(self.workspace, create=not self.workspace.exists())
        try:
            provider = self.phase("original-discovery-and-complete-group-review", self.provider)
            base = self.phase("original-complete-export", lambda entry: self.capture(entry, provider, "base"))
            since = base["source"]["inventory"]["transactionTime"]
            delta = self.phase("original-modification-export", lambda entry: self.capture(entry, provider, "delta", since))
            composed = self.phase("reviewed-retained-resource-composition", lambda entry: self.ws.compose({
                "baseSourceId": base["sourceId"], "deltaSourceIds": [delta["sourceId"]],
                "label": "SMART original selected Group retained Patient and Observation state", "resolutions": []}))
            dataset = self.phase("original-projection-query-and-edition-comparison",
                lambda entry: self.dataset(entry, base, composed))
            delivery = self.phase("complete-native-dataset-and-source-packet", lambda entry: self.deliver(entry, dataset))
            merchant = self.phase("original-seller-and-sf88-buyer-receiving", lambda entry: self.merchant(entry, delivery))
            customer = self.phase("original-customer-packet-reconstruction",
                lambda entry: self.receive_dataset(entry, delivery, dataset))
            whole = self.phase("complete-editable-workspace-receive-and-reopen",
                lambda entry: self.whole(entry, dataset))
            state = self.ws.state()
            self.file("ORIGINAL_FINAL_WORKSPACE.json", state)
            artifacts = [digest_file(path) for path in sorted(self.output.iterdir())
                if path.is_file() and path.name not in {"RECEIVING_JOURNEY.json", "OPERATED_FHIR_BULK.json"}
                and path.suffix in {".json", ".zip", ".jsonl"}]
            value = {"schema": SCHEMA, "operation": OPERATION, "completedAt": stamp(),
                "sourceRoot": str(self.sdk), "workspace": str(self.workspace), "workspaceId": state["workspaceId"],
                "connectionId": provider["connectionId"], "discoveryId": provider["discoveryId"],
                "groupPageIds": provider["groupPageIds"], "selectedGroupId": provider["selectedGroupId"],
                "originalGroup": provider["group"], "selection": provider["selection"],
                "exportIds": [base["exportId"], delta["exportId"]],
                "operationIds": [base["operationId"], delta["operationId"]],
                "sourceIds": [base["sourceId"], delta["sourceId"], composed["source"]["id"]],
                "baseSourceId": base["sourceId"], "deltaSourceId": delta["sourceId"],
                "composedSourceId": composed["source"]["id"], "planId": dataset["planId"],
                "buildIds": dataset["buildIds"], "comparisonId": dataset["comparisonId"],
                "classification": base["source"]["inventory"]["classification"],
                "coverage": {"base": base["source"]["inventory"]["coverage"],
                    "delta": delta["source"]["inventory"]["coverage"],
                    "composed": composed["source"]["inventory"]["coverage"]},
                "sourceTotals": {"base": base["source"]["inventory"]["totals"],
                    "delta": delta["source"]["inventory"]["totals"], "composed": composed["source"]["inventory"]["totals"]},
                "nativeComparison": dataset["comparison"],
                "merchantDirectory": str(self.output / "merchant-release-composed"),
                "customerDirectory": str(self.output / "customer"),
                "datasetPacket": delivery["datasetPacket"], "workspacePacket": whole["workspacePacket"],
                "restoredWorkspace": whole["restoredWorkspace"],
                "receiving": {"merchant": merchant, "customer": customer, "workspace": whole},
                "sourceFiles": self.journal["sourceFiles"], "artifacts": artifacts}
            self.file("OPERATED_FHIR_BULK.json", value)
            self.journal["completedAt"] = value["completedAt"]
            self.checkpoint()
            print(json.dumps({"state": "complete", "result": str(self.output / "OPERATED_FHIR_BULK.json"),
                "selectedGroupId": provider["selectedGroupId"], "sourceIds": value["sourceIds"],
                "nativeRows": [row["rowCount"] for row in dataset["builds"]]}), flush=True)
            return value
        finally:
            if self.ws:
                self.ws.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Operate the full original SMART sample FHIR receiving journey")
    parser.add_argument("--source-root", required=True, help="Absolute sf30-seller-sdk source directory")
    parser.add_argument("--workspace", required=True, help="Absolute original private FHIR workspace")
    parser.add_argument("--output", required=True, help="Absolute original receiving output directory")
    parser.add_argument("--node", default=os.environ.get("SF30_XML_NODE", "node"))
    parser.add_argument("--group-id", help="Literal original populated Group ID; default reviews all pages and selects smallest original quantity")
    parser.add_argument("--max-wait-seconds", type=int, default=1800)
    args = parser.parse_args(argv)
    for key in ["source_root", "workspace", "output"]:
        if not Path(getattr(args, key)).expanduser().is_absolute():
            parser.error("--" + key.replace("_", "-") + " must be absolute")
    if not 1 <= args.max_wait_seconds <= 7 * 86400:
        parser.error("--max-wait-seconds must be between 1 and 604800")
    try:
        journey = Journey(args)
        try:
            journey.run()
        finally:
            journey.lease.close()
        return 0
    except Exception as exc:
        print(json.dumps({"operation": OPERATION, "state": "interrupted", "error": str(exc)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
