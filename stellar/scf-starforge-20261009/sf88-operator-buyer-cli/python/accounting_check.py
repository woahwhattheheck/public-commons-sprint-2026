"""Focused original-workspace accounting/restart check using a local audited fixture.

No signer, merchant request or RPC: original Governor creates one test reservation
and an explicit local fixture finalization. The application must recover that
same authenticated ledger entry through the production finalizer, unchanged.
"""
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "stellar/scf-starforge-20261009"
sys.path.insert(0, str(SOURCE / "sf36-spend-governor"))
from governor import Governor, canonical, issue_consent, issue_finality_attestation
from stellar_forge_buyer import Buyer, StateError
from stellar_forge_buyer.client import SCHEMA, now
from stellar_forge_buyer.storage import digest, dump, read

ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
PAYER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
INTENT = "python-accounting-local-fixture"
TRANSACTION = "d" * 64
os.umask(0o077)
with tempfile.TemporaryDirectory(prefix="sf88-python-accounting-") as temporary:
    directory = Path(temporary)
    workspace = directory / "operator"
    source = directory / "source.json"
    selected = {"scheme": "exact", "network": "stellar:testnet", "asset": ASSET,
                "payTo": PAYER, "maxAtomic": "200", "maxTimeoutSeconds": 60}
    dump(source, {"operation": {"intentId": INTENT,
        "url": "https://merchant.example.org/report?sf98_order=local-fixture", "method": "GET",
        "orderReference": "local-fixture", "expect": selected}})
    subprocess.run(["node", str(SOURCE / "sf88-operator-buyer-cli/cli.mjs"),
        "--init-workspace", "--config", str(source), "--dir", str(workspace),
        "--actor", "local-operator", "--service", "local-data-application", "--payer", PAYER,
        "--python", sys.executable, "--secret-env", "LOCAL_ACCOUNTING_UNUSED_SIGNER",
        "--total-atomic", "1000", "--daily-atomic", "1000"],
        check=True, capture_output=True, timeout=30)
    buyer = Buyer(checkout=ROOT, state_dir=directory / "application")
    operation = buyer.from_workspace(workspace)
    try:
        operation.finalize()
        raise AssertionError("unattempted operation reached accounting")
    except StateError as error:
        assert error.code == "ORIGINAL_ACCOUNTING_ATTEMPT_REQUIRED"

    # Retained records represent a LOCAL audited accounting fixture, not a
    # network purchase. No production execution or observer is replaced.
    config = json.loads(operation.config_path.read_bytes())
    created = now()
    dump(operation.directory / "attempt.json", {"schema": SCHEMA, "intentId": INTENT,
        "state": "RECORDED", "createdAt": created, "startedAt": created,
        "configSha256": digest(read(operation.config_path, 65536)), "bodySha256": digest(b"")})
    terms = {"scheme": "exact", "network": selected["network"], "asset": ASSET,
             "payTo": PAYER, "amount": "200", "maxTimeoutSeconds": 60}
    request = {"request_id": INTENT, "actor": "local-operator", "service": "local-data-application",
        "scheme": "exact", "network": selected["network"], "asset": ASSET,
        "pay_to": PAYER, "max_amount": "200", "max_timeout_seconds": 60,
        "resource": config["operation"]["url"], "method": "GET", "body_present": False,
        "body_bytes": 0, "body_sha256": digest(b""), "accepted_terms_sha256": digest(canonical(terms))}
    request_sha = digest(canonical(request))
    key_document = json.loads((workspace / "operator-keys.json").read_bytes())
    keys = [base64.b64decode(key_document["keys"]["SF36_" + name + "_KEY_B64"])
            for name in ("CONSENT", "AUDIT", "OPERATOR")]
    governor = Governor(Path(config["operator"]["ledger"]),
                        json.loads(Path(config["operator"]["policy"]).read_bytes()), *keys)
    consent = issue_consent(keys[0], request, (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
    assert governor.reserve(request, consent)["outcome"] == "RESERVED"
    receipt_ref = selected["network"] + "/" + TRANSACTION
    assert governor.reconcile(issue_finality_attestation(keys[2], INTENT, "200", receipt_ref,
        digest(b"explicit-local-audited-fixture")))["outcome"] == "FINALIZED"
    governor.close()
    reservation = {"schema": "stellar-forge.sf62.result.v1", "outcome": "FRESH_RESERVATION_APPROVED",
        "request_id": INTENT, "network": selected["network"], "asset": ASSET,
        "reserved_atomic_units": "200", "request_sha256": request_sha, "approved_request": request}
    receipt = {"network": selected["network"], "transaction": TRANSACTION, "payer": PAYER, "success": True}
    envelope = {"schema": "scf82.checkout-evidence.v1", "intentId": INTENT, "observedAt": now(),
        "observation": {"intentId": INTENT, "buyer": {"attempts": 2, "requirement": terms, "receipt": receipt}},
        "operatorReservation": {"outcome": reservation["outcome"], "requestId": INTENT,
            "network": selected["network"], "reservedAtomicUnits": "200", "requestSha256": request_sha},
        "reconciliation": {"status": "AVAILABLE", "record": {"intentId": INTENT,
            "requirement": terms, "receipt": receipt, "operatorReservation": reservation}}}
    evidence = Path(config["evidenceDir"]) / (digest(INTENT.encode()) + ".json")
    dump(evidence, envelope)
    os.environ.pop("LOCAL_ACCOUNTING_UNUSED_SIGNER", None)
    # Lower NEW-spending capacity; original debt must still be accounted for.
    active = json.loads((workspace / "operator.json").read_bytes())
    active["operation"]["expect"]["maxAtomic"] = "1"
    dump(workspace / "operator.json", active)
    first = operation.finalize()
    assert first.finalized and first.status == "IDEMPOTENT_FINALIZED", first.record
    assert first.actual_atomic_units == "200" and first.receipt == receipt_ref
    assert first.result["chainObservation"] == "ORIGINAL_AUDITED_FINALIZATION_REUSED"
    # Crash after complete native stdout but before the Python display record.
    (operation.directory / "accounting.json").unlink()
    (Path(first.record["runDirectory"]) / "result.json").unlink()
    reopened = Buyer(checkout=ROOT, state_dir=directory / "application")
    reopened.runtime.run = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local recovery spawned Node"))
    recovered = reopened.operation(INTENT).recover_finalization()
    assert recovered.finalized and recovered.record["runtimeError"] == "PROCESS_EXIT_NOT_RECORDED"
    exported = reopened.history(destination=directory / "history.json")
    assert exported["operations"][0]["accounting"]["native"]["result"]["receipt_ref"] == receipt_ref
    # Restore the view, then show a later actual source failure without losing
    # the original finalized outcome or adding another ledger transition.
    second = operation.finalize()
    evidence.rename(directory / "saved-evidence.json")
    failed = operation.finalize()
    assert not failed.finalized and failed.last_finalized["native"]["result"]["receipt_ref"] == receipt_ref
    governor = Governor(Path(config["operator"]["ledger"]),
                        json.loads(Path(config["operator"]["policy"]).read_bytes()), *keys)
    assert governor.audit()["events"] == 2
    governor.close()
    print(json.dumps({"result": "PASS", "application": "original Python workspace accounting/history",
        "originalLedgerEvents": 2, "accountingOutcome": first.status,
        "localCrashRecovery": recovered.record["viewStatus"], "priorFinalizationRetained": True,
        "fixture": "local HMAC-audited reservation/finalization; no chain transaction",
        "signerCalls": 0, "merchantRequests": 0, "rpcObservation": "AUDITED_LEDGER_REUSED"}))
