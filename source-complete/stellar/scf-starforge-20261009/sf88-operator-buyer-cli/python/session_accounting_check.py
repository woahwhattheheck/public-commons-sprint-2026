"""One original native session/ledger lifecycle; no signer, HTTP or chain payment.

Original initializers create a dataset session and chunk inbox. Explicit local
audited fixtures supply two historical reservations/finalizations. The customer
APIs must recover those same authenticated receipts, including without products.
"""
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "stellar/scf-starforge-20261009"
NATIVE = SOURCE / "sf88-operator-buyer-cli"
sys.path.insert(0, str(SOURCE / "sf36-spend-governor"))
from governor import Governor, canonical, issue_consent, issue_finality_attestation
from stellar_forge_buyer import DatasetAcquisition, ObjectBuyer, SessionAccountingResult
from stellar_forge_buyer.client import now
from stellar_forge_buyer.storage import digest, dump

ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
PAYER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
os.umask(0o077)

def node(code, *args):
    result = subprocess.run(["node", "--input-type=module", "-e", code, *map(str, args)],
                            check=True, capture_output=True, text=True, timeout=40)
    return json.loads(result.stdout)

with tempfile.TemporaryDirectory(prefix="sf88-session-accounting-") as temporary:
    directory = Path(temporary)
    workspace = directory / "operator"
    source = directory / "source.json"
    selected = {"scheme":"exact", "network":"stellar:testnet", "asset":ASSET,
                "payTo":PAYER, "maxAtomic":"200", "maxTimeoutSeconds":60}
    dump(source, {"operation":{"intentId":"local-accounting-dataset", "method":"GET",
        "url":"https://merchant.example.org/data?fields=id&limit=100", "expect":selected}})
    subprocess.run(["node", str(NATIVE / "cli.mjs"), "--init-workspace", "--config", str(source),
        "--dir", str(workspace), "--actor", "local-operator", "--service", "local-data",
        "--payer", PAYER, "--python", sys.executable, "--secret-env", "LOCAL_UNUSED_SIGNER",
        "--total-atomic", "1000", "--daily-atomic", "1000"],
        check=True, capture_output=True, timeout=30)
    dataset = DatasetAcquisition.create(checkout=ROOT, session=directory / "dataset",
        workspace=workspace, max_pages=2, max_total_atomic="400")
    # Original native durable attempt creation; this fixture sends no request.
    state = node("const m=await import(process.argv[1]); const r=await m.runDatasetSession(process.argv[2],"
        "{executePage:async()=>{throw Object.assign(new Error(),{code:'LOCAL_FIXTURE_NO_REQUEST'})},"
        "emitPageSummaries:false});console.log(JSON.stringify(r));",
        NATIVE / "dataset-session.mjs", dataset.directory)
    assert state["status"] == "RECONCILIATION_REQUIRED"
    page = dataset.directory / "pages/000001"
    config = json.loads((workspace / "operator.json").read_bytes())
    object_config = json.loads(json.dumps(config))
    object_config["operation"].update(intentId="local-accounting-object", url="https://merchant.example.org/object")
    dump(directory / "object.json", object_config)
    objects = ObjectBuyer(checkout=ROOT)
    session = objects.prepare_explicit(directory / "object", bytes=30, chunk_bytes=10,
        snapshot="a" * 64, max_total_atomic="600", config_file=directory / "object.json", workspace=workspace)
    jobs = sorted((session.directory / "inbox/jobs").iterdir(),
                  key=lambda p: json.loads((p / "request.json").read_bytes())["operation"]["url"])
    for job in jobs[:2]:
        request = json.loads((job / "request.json").read_bytes())
        dump(job / "attempt.json", {"schema":request["schema"], "kind":"EXECUTE", "id":str(uuid.uuid4()),
            "intentId":request["operation"]["intentId"], "configSha256":request["configSha256"], "startedAt":now()})
    key_document = json.loads((workspace / "operator-keys.json").read_bytes())
    keys = [base64.b64decode(key_document["keys"]["SF36_" + name + "_KEY_B64"])
            for name in ("CONSENT", "AUDIT", "OPERATOR")]
    policy = json.loads(Path(config["operator"]["policy"]).read_bytes())
    governor = Governor(Path(config["operator"]["ledger"]), policy, *keys)

    def finalized_fixture(configuration_path):
        cfg = json.loads(configuration_path.read_bytes())
        intent = cfg["operation"]["intentId"]
        terms = {key:value for key,value in cfg["operation"]["expect"].items() if key != "maxAtomic"}
        terms["amount"] = "200"
        request = {"request_id":intent, "actor":"local-operator", "service":"local-data",
            "scheme":"exact", "network":"stellar:testnet", "asset":ASSET, "pay_to":PAYER,
            "max_amount":"200", "max_timeout_seconds":60, "resource":cfg["operation"]["url"],
            "method":"GET", "body_present":False, "body_bytes":0, "body_sha256":digest(b""),
            "accepted_terms_sha256":digest(canonical(terms))}
        consent = issue_consent(keys[0], request, (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
        assert governor.reserve(request, consent)["outcome"] == "RESERVED"
        transaction = digest(intent.encode())
        receipt_ref = "stellar:testnet/" + transaction
        assert governor.reconcile(issue_finality_attestation(keys[2], intent, "200", receipt_ref,
            digest(b"explicit-local-audited-fixture")))["outcome"] == "FINALIZED"
        reservation = {"schema":"stellar-forge.sf62.result.v1", "outcome":"FRESH_RESERVATION_APPROVED",
            "request_id":intent, "network":"stellar:testnet", "asset":ASSET, "reserved_atomic_units":"200",
            "request_sha256":digest(canonical(request)), "approved_request":request}
        receipt = {"network":"stellar:testnet", "transaction":transaction, "payer":PAYER, "success":True}
        evidence = Path(cfg["evidenceDir"]) / (digest(intent.encode()) + ".json")
        dump(evidence, {"schema":"scf82.checkout-evidence.v1", "intentId":intent, "observedAt":now(),
            "observation":{"intentId":intent, "buyer":{"attempts":2, "requirement":terms, "receipt":receipt}},
            "operatorReservation":{"outcome":reservation["outcome"], "requestId":intent,
                "network":"stellar:testnet", "reservedAtomicUnits":"200", "requestSha256":reservation["request_sha256"]},
            "reconciliation":{"status":"AVAILABLE", "record":{"intentId":intent,
                "requirement":terms, "receipt":receipt, "operatorReservation":reservation}}})
        return evidence, receipt_ref

    dataset_evidence, dataset_receipt = finalized_fixture(page / "config.json")
    object_evidence, object_receipt = finalized_fixture(jobs[0] / "execution.json")
    free = json.loads((jobs[1] / "execution.json").read_bytes())
    free_id = free["operation"]["intentId"]
    observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    dump(Path(free["evidenceDir"]) / (digest(free_id.encode()) + ".json"), {
        "schema":"scf82.checkout-evidence.v1", "intentId":free_id, "observedAt":observed,
        "operatorReservation":None, "observation":{"intentId":free_id, "observedAt":observed,
        "buyer":{"status":"NO_PAYMENT_REQUIRED", "httpStatus":206, "attempts":1,
                 "settlement":"NOT_REQUESTED", "requirement":None, "receipt":None}}})
    before = {p:p.read_bytes() for p in [page / "attempt.json", *[j / "attempt.json" for j in jobs[:2]]]}
    assert governor.audit()["events"] == 4
    governor.close()
    # Later cap changes and missing product bytes cannot cancel prior debt.
    config["operation"]["expect"]["maxAtomic"] = "1"
    dump(workspace / "operator.json", config)
    attempted = json.loads((page / "attempt.json").read_bytes())
    original_args = {"configurationPath":str(page / "config.json"), "workspace":str(workspace),
        "configSha256":digest((page / "config.json").read_bytes()), "intentId":attempted["intentId"],
        "evidencePath":str(dataset_evidence), "bodySha256":None, "bodyBytes":0,
        "attemptStartedAt":attempted["startedAt"]}
    rejected = node("const m=await import(process.argv[1]);try{await m.finalizeOriginalAttempt(JSON.parse(process.argv[2]));"
        "console.log(JSON.stringify({code:'UNEXPECTED_DEFAULT_ACCEPTANCE'}))}catch(e){console.log(JSON.stringify({code:e.code}))}",
        NATIVE / "finalization.mjs", json.dumps(original_args))
    assert rejected["code"] == "INBOX_WORKSPACE_OPERATOR_MISMATCH"
    assert not (page / "response.json").exists()
    d = dataset.finalize()
    assert isinstance(d, SessionAccountingResult) and d.window_complete, d.native
    assert d.entries[0]["receipt"] == dataset_receipt and d.recorded_actual_atomic_units == "200"
    views = list(session.finalize_all(page_size=1))
    assert [v.entries[0]["outcome"] for v in views] == ["IDEMPOTENT_FINALIZED", "NO_PAYMENT_REQUIRED", "NOT_ATTEMPTED"], [v.native for v in views]
    assert views[0].entries[0]["receipt"] == object_receipt
    # Reopen through the actual CLI and a fresh Python client without key access.
    (workspace / "operator-keys.json").rename(directory / "saved-keys.json")
    reopened = DatasetAcquisition(checkout=ROOT, session=dataset.directory / ".." / "dataset")
    assert reopened.accounting().entries[0]["receipt"] == dataset_receipt
    assert ObjectBuyer(checkout=ROOT).open(session.directory).accounting().entries[0]["receipt"] == object_receipt
    cli = subprocess.run(["node", str(NATIVE / "dataset-cli.mjs"), "accounting", "--session", str(dataset.directory)],
                         check=True, capture_output=True, text=True, timeout=30)
    assert json.loads(cli.stdout)["entries"][0]["receipt"] == dataset_receipt
    cli = subprocess.run(["node", str(NATIVE / "object-cli.mjs"), "finalize", "--session", str(session.directory),
                          "--offset", "1", "--limit", "2"], check=True, capture_output=True, text=True, timeout=30)
    assert [entry["outcome"] for entry in json.loads(cli.stdout)["entries"]] == ["NO_PAYMENT_REQUIRED", "NOT_ATTEMPTED"]
    (directory / "saved-keys.json").rename(workspace / "operator-keys.json")
    dataset_evidence.rename(directory / "saved-evidence.json")
    later = dataset.finalize()
    assert later.attention and later.entries[0]["lastFinalized"]["receipt"] == dataset_receipt
    assert all(p.read_bytes() == raw for p,raw in before.items())
    governor = Governor(Path(config["operator"]["ledger"]), policy, *keys)
    assert governor.audit()["events"] == 4
    governor.close()
    print(json.dumps({"result":"PASS", "originalLedgerEvents":4, "originalAttemptsUnchanged":3,
        "datasetReceipt":d.entries[0]["outcome"], "objectOutcomes":[v.entries[0]["outcome"] for v in views],
        "missingProductAccounting":True, "freshKeylessHistory":True, "priorReceiptRetained":True,
        "fixture":"local HMAC-audited reservation/finalization; no chain transaction",
        "signerCalls":0, "merchantRequests":0, "rpcObservation":"AUDITED_LEDGER_REUSED"}))
