"""Read one original governed MCP owner into the existing expense application.

The native quote reader and SF36 statement reader retain their own transactions.
The original native state lock stabilizes approval/finality records across those
reads. No Governor, signing environment or source-writing command is constructed.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

from native import read_snapshot, build_statement
from native_mcp import node_path, reader_path, quote_rows, digest
from governor import canonical as native_canonical, validate_request

DESCRIPTOR = "stellar-forge.governed-mcp-expense-input.v1"
SCHEMA = "stellar-forge.governed-mcp-expense-source.v1"
STATEMENT = "stellar-forge.governed-mcp-expense-statement.v1"
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
HASH = re.compile(r"[a-f0-9]{64}")
MAX_OUTPUT = 100 * 1024 * 1024


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _private_json(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("Select the canonical original private source file.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 32768 or before.st_mode & 0o077 or before.st_uid != os.geteuid():
            raise ValueError("The selected descriptor and host configuration must be private owned JSON files, at most 32 KiB.")
        raw = stream.read(32769)
        after = os.fstat(stream.fileno())
    if len(raw) > 32768 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError("The selected source configuration changed during capture.")
    value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Finite JSON is required.")))
    if not isinstance(value, dict):
        raise ValueError("Choose an original source descriptor object.")
    return path, value, _sha(raw)


def _path(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Select the original native spending owner's canonical paths.")
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("Select the original native spending owner's canonical paths.")
    return path


def _identity(path, optional=False):
    try:
        info = path.stat(follow_symlinks=False)
    except FileNotFoundError:
        if optional:
            return None
        raise
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("The original ledger must remain a regular file.")
    return {"device": str(info.st_dev), "inode": str(info.st_ino)}


def _inventory(state):
    if not state.exists():
        return None
    info = state.stat(follow_symlinks=False)
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise ValueError("Use the original owner's private native state directory.")
    selected = []
    for path in sorted(state.iterdir()):
        name = path.name
        if name in ("state.lock", "configuration.json", "ledger-initialized.json") or (
                name.endswith(".json") and UUID.fullmatch(name[:-5])) or (
                name.endswith(".finality.json") and UUID.fullmatch(name[:-14])):
            item = path.stat(follow_symlinks=False)
            if not stat.S_ISREG(item.st_mode):
                raise ValueError("The original native owner contains a nonregular retained record.")
            selected.append((name, item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns))
    return (info.st_dev, info.st_ino, selected)


@contextmanager
def _native_lock(state):
    before = _inventory(state)
    try:
        fd = os.open(state / "state.lock", os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        # A first source capture need not initialize an unused buyer. Require
        # its complete native inventory to remain unchanged through this read.
        yield False
        if _inventory(state) != before:
            raise ValueError("The original native owner started while its first source was being captured. Capture its current state again.")
        return
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
            raise ValueError("The original native owner lock must be a private regular file.")
        deadline = time.monotonic() + 60
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ValueError("The original buyer is still updating its spending state. Finish that native operation, then capture it.")
                time.sleep(0.05)
        selected = (info.st_dev, info.st_ino)
        if _identity(state / "state.lock") != {"device":str(selected[0]), "inode":str(selected[1])}:
            raise ValueError("The original native state lock changed before capture.")
        inventory = _inventory(state)
        yield True
        if _inventory(state) != inventory:
            raise ValueError("The original native owner records changed outside their retained lock. Capture after its original writer finishes.")
    finally:
        os.close(fd)


def _empty_detail(ident, binding, ledger):
    request = binding["request"]
    invocation = json.loads(binding["invocationJson"])
    return {"quote_id":ident, "quote_sha256":None, "classification":"QUOTE_RECORD_MISSING",
        "native_status":"QUOTE_RECORD_MISSING", "phase":None, "created_at_ms":None, "updated_at_ms":None,
        "signed_request_dispatched":None, "attempts":None, "url":invocation["endpoint"], "method":"tools/call",
        "tool_name":invocation["toolName"], "arguments_sha256":None, "payer":binding["payer"],
        "recipient":request["pay_to"], "quoted_amount":request["max_amount"], "transaction":None,
        "receipt":None, "observation":None, "observation_sha256":None, "transfer_identity":None,
        "problems":[], "result_file":None, "result_preview":{}, "superseded_observation":None,
        "quote_created_day":None}


def _finality_problems(item, request, request_sha, ledger):
    finality = item.get("finality")
    if finality is None:
        return [], ["NATIVE_FINALITY_RECORD_MISSING"] if ledger["state"] == "settled" else []
    facts = finality.get("verifiedFacts")
    proof = finality.get("proof")
    if not isinstance(facts, dict) or not isinstance(proof, dict):
        return ["NATIVE_FINALITY_FORMAT"], []
    expected = {"schema":"stellar-forge.sf36.verified-facts.v1",
        "intentId":request["request_id"], "request_sha256":request_sha, "network":request["network"],
        "asset":request["asset"], "payer":item["expectedBinding"]["payer"],
        "recipient":request["pay_to"], "atomicAmount":request["max_amount"]}
    if finality.get("schema") != "stellar-forge.mcp-spending.v1" or finality.get("request_id") != request["request_id"] or (
            finality.get("request_sha256") != request_sha) or any(facts.get(k) != v for k, v in expected.items()):
        return ["NATIVE_FINALITY_REQUEST_CHANGED"], []
    transaction = facts.get("transaction")
    if not isinstance(transaction, str) or not HASH.fullmatch(transaction) or type(facts.get("ledger")) is not int or facts["ledger"] < 1:
        return ["NATIVE_FINALITY_TRANSACTION_CHANGED"], []
    facts_sha = _sha(native_canonical(facts))
    if finality.get("proof_sha256") != facts_sha:
        return ["NATIVE_FINALITY_FACTS_CHANGED"], []
    if ledger["state"] == "settled" and (
            ledger["proof_sha256"] != facts_sha or ledger["receipt_ref"] != request["network"] + "/" + transaction):
        return ["NATIVE_LEDGER_FINALITY_CHANGED"], []
    transfer = proof.get("transfer")
    if not isinstance(transfer, dict) or proof.get("schema") != "stellar-forge.sf86.payment-attempt.v1" or (
            proof.get("outcome") != "TRANSFER_MATCHED" or proof.get("rpcStatus") != "SUCCESS") or (
            transfer.get("schema") != "stellar-forge.sf86.rpc-reconciliation.v1") or (
            transfer.get("matchingEventId") != facts.get("eventId") or transfer.get("matchingTransfers") != 1):
        return ["NATIVE_FINALITY_OBSERVATION_CHANGED"], []
    for key in ("intentId", "transaction", "network", "asset", "payer", "recipient", "atomicAmount", "ledger"):
        if proof.get(key) != facts.get(key) or transfer.get(key) != facts.get(key):
            return ["NATIVE_FINALITY_OBSERVATION_CHANGED"], []
    return [], []


def project_governed_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("schema") != SCHEMA:
        raise ValueError("The original governed MCP reader did not return a complete source.")
    owner = snapshot["owner"]
    originals = {row["request_id"]: row for row in quote_rows(snapshot["quotes"])}
    derivations = {row["quoteId"]: row for row in snapshot["quoteBindings"]}
    retained = {row["quoteId"]: row for row in snapshot["bindings"]}
    ledger_report = build_statement(snapshot["ledger_snapshot"]) if snapshot["ledger_snapshot"] is not None else None
    ledger_rows = {row["request_id"]:row for row in ledger_report["rows"]} if ledger_report else {}
    rows, source_issues, source_notes = [], [], []
    linked_ids = set()
    for ident in sorted(set(originals) | set(retained)):
        original, captured = originals.get(ident), retained.get(ident)
        ledger = ledger_rows.get(ident)
        problems = list(captured.get("problems", [])) if captured else []
        notes = []
        binding = captured.get("expectedBinding") if captured else None
        request_sha = captured.get("requestSha256") if captured else derivations.get(ident, {}).get("requestSha256")
        if original:
            row = deepcopy(original)
            detail = row["native_detail"]
            detail["quote_created_day"] = row["day"]
            detail["quote_request_identity_sha256"] = row["request_digest"]
            detail["observed_settled_actual"] = row["settled_base_units"]
            if request_sha:
                row["request_digest"] = request_sha
        elif binding and ledger:
            row = deepcopy(ledger)
            detail = _empty_detail(ident, binding, ledger)
            row["native_detail"] = detail
            notes.append("QUOTE_RECORD_MISSING")
        else:
            (source_notes if binding and not problems and ledger is None else source_issues).append({
                "request_id":ident,"code":"NATIVE_BINDING_WITHOUT_QUOTE_OR_LEDGER",
                "problems":problems,"record_sha256":captured.get("recordSha256") if captured else None})
            continue
        detail.update(spending_owner=deepcopy(owner),spending_link="NO_NATIVE_BINDING",
            native_quote_present=original is not None,spending_request_sha256=request_sha,
            spending_binding_sha256=captured.get("recordSha256") if captured else None,
            finality_record_sha256=captured.get("finalitySha256") if captured else None,
            spending_state=None,spending_maximum=None,spending_actual=None,
            spending_reserved_base_units="0",spending_reservation_day=None,spending_receipt_ref=None,
            spending_proof_sha256=None,spending_problems=problems,spending_notes=notes)
        if captured and binding:
            request = validate_request(binding["request"])
            if _sha(native_canonical(request)) != request_sha:
                problems.append("NATIVE_REQUEST_DIGEST_CHANGED")
            if ledger:
                matches = {"request_id":ident,"request_digest":request_sha,"actor":owner["actor"],
                    "service":owner["service"],"network":request["network"],"asset":request["asset"],
                    "scheme":request["scheme"],"amount":request["max_amount"]}
                if any(ledger.get(k) != v for k,v in matches.items()):
                    problems.append("NATIVE_LEDGER_REQUEST_CHANGED")
                else:
                    linked_ids.add(ident)
                    detail.update(spending_link="ORIGINAL_SF36",spending_state=ledger["state"],
                        spending_maximum=ledger["amount"],spending_actual=ledger["actual"],
                        spending_reserved_base_units=ledger["reserved_base_units"],
                        spending_reservation_day=ledger["day"],spending_receipt_ref=ledger["receipt_ref"],
                        spending_proof_sha256=ledger["proof_sha256"])
                    # The original ledger supplies finance amounts for a governed
                    # row; its quoted observation remains separately visible.
                    for key,value in ledger.items():
                        row[key]=value
                    row["native_detail"]=detail
                    row["native_date_basis"]="SF36 reservation day"
                    bad,warnings=_finality_problems(captured,request,request_sha,ledger)
                    problems.extend(bad);notes.extend(warnings)
                    final_payment=captured.get("finalityPayment") or {}
                    if final_payment.get("classification") == "TRANSFER_MATCHED":
                        transfer=final_payment.get("transferIdentity")
                        if detail.get("transfer_identity") and detail["transfer_identity"] != transfer:
                            problems.append("NATIVE_TRANSFER_IDENTITY_CHANGED")
                        elif ledger["state"] == "settled":
                            detail["transfer_identity"]=transfer
                    if original and original["state"] == "settled":
                        if ledger["state"] == "reserved":
                            notes.append("MATCHED_PAYMENT_AWAITS_SPENDING_RECONCILIATION")
                        elif ledger["actual"] != original["actual"] or ledger["receipt_ref"] != original["receipt_ref"]:
                            problems.append("QUOTE_AND_SPENDING_SETTLEMENT_CHANGED")
                    elif original and ledger["state"] == "settled" and original["state"] in ("failed","observation_review"):
                        problems.append("QUOTE_AND_SPENDING_OUTCOME_DISAGREE")
            else:
                detail["spending_link"]="BOUND_WITHOUT_RESERVATION"
                if original and original["native_detail"].get("signed_request_dispatched"):
                    problems.append("GOVERNED_SIGNED_DISPATCH_WITHOUT_LEDGER_ROW")
        elif ledger and request_sha and ledger["request_digest"] == request_sha:
            problems.append("NATIVE_BINDING_RECORD_MISSING")
        if problems:
            row["state"]="spending_review"
            detail["spending_link"]="SOURCE_REVIEW_REQUIRED"
        row["source_kind"]="governed_mcp"
        row.setdefault("native_date_basis","MCP quote creation day")
        context=deepcopy(detail)
        context.pop("updated_at_ms",None);context.pop("quote_sha256",None)
        context["spending_owner"]={key:owner[key] for key in ("actor","service","payer")}
        row["native_context_sha256"]=digest(context)
        rows.append(row)
    rows.sort(key=lambda row:(row["day"],row["request_id"]))
    groups={}
    for row in rows:
        key=(row["network"],row["asset"])
        group=groups.setdefault(key,{"network":key[0],"asset":key[1],"requests":0,"pending_requests":0,
            "unresolved_quotes":0,"settled_base_units":0,"reserved_base_units":0,"released_capacity_base_units":0})
        group["requests"]+=1
        group["pending_requests"]+=int(int(row.get("reserved_base_units") or "0")>0)
        group["unresolved_quotes"]+=int(row["state"] in ("unresolved","observation_review","spending_review"))
        # A conflicting binding remains retained for review. Never promote its
        # observed amount to allocatable settled expense.
        if row["state"]=="settled":
            group["settled_base_units"]+=int(row["settled_base_units"] or "0")
        for name in ("reserved_base_units","released_capacity_base_units"):
            group[name]+=int(row.get(name) or "0")
    for group in groups.values():
        group["accounted_base_units"]=str(group["settled_base_units"]+group["reserved_base_units"])
        for name in ("settled_base_units","reserved_base_units","released_capacity_base_units"):
            group[name]=str(group[name])
    native = snapshot["ledger_snapshot"]
    return {"schema":STATEMENT,"captured_at":snapshot["observedAt"],
        "source":{"kind":"governed_mcp","records":len(rows),"record_kind":"governed_mcp_requests",
            "database_name":"Original quotes.sqlite and SF36 ledger",
            "journal_events":native["journal_events"] if native else 0,
            "last_sequence":native["last_sequence"] if native else 0,
            "projection_sha256":digest(rows),"quote_transitions":snapshot["quotes"]["transitionCount"],
            "quote_last_sequence":snapshot["quotes"]["lastSequence"],
            "spending_owner":owner,"ledger_state":"INITIALIZED" if native is not None else "UNINITIALIZED",
            "native_initialized":snapshot["nativeInitialized"],"linked_requests":len(linked_ids),
            "shared_ledger_rows":len(ledger_rows),"other_shared_ledger_rows":len(set(ledger_rows)-linked_ids),
            "integrity_issues":source_issues,"source_notes":source_notes},
        "rows":rows,"portfolio":[groups[k] for k in sorted(groups)],
        "basis":"Original MCP quote snapshot joined by original native invocation/request binding to the original SF36 statement",
        "date_basis":"Original SF36 reservation day for bound ledger rows; quote creation day for quote-only rows; recognition remains an operator decision",
        "notes":["Bound SF36 rows retain the original ledger's actual, outstanding maximum and released capacity.",
            "The original quote/payment outcome and complete-result metadata remain separately retained.",
            "A matched quote whose original ledger is still reserved needs original buyer spending reconciliation.",
            "The full shared ledger snapshot is retained; unrelated shared rows are not attributed to this native MCP owner.",
            "No signing key, control key, wallet, merchant request, new reservation or network reconciliation is used by source capture."]}


def capture_governed_mcp(path,node=None):
    descriptor,input,descriptor_sha=_private_json(path)
    if set(input)!={"schema","quoteDirectory","spendingConfigurationFile"} or input["schema"]!=DESCRIPTOR:
        raise ValueError("Use the original governed MCP source descriptor with quoteDirectory and spendingConfigurationFile.")
    _,host,host_sha=_private_json(input["spendingConfigurationFile"])
    if host.get("schema")!="stellar-forge.mcp-spending-host.v1" or not isinstance(host.get("spending"),dict):
        raise ValueError("Select the original native MCP spending host configuration.")
    state=_path(host["spending"].get("stateDirectory"))
    ledger=_path(host["spending"].get("ledger"))
    helper=reader_path().with_name("expense-governed-statement.mjs")
    if not helper.is_file():
        raise ValueError("Use the complete governed MCP expense reader from the maintained installation or received project.")
    with _native_lock(state) as locked:
        before=_identity(ledger,True)
        command=[node_path(node),str(helper),"--descriptor",str(descriptor),"--configuration-sha256",host_sha]
        completed=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90,check=False)
        if len(completed.stdout)>MAX_OUTPUT or len(completed.stderr)>1024*1024:
            raise ValueError("The complete original governed source exceeded its retained capture capacity.")
        if completed.returncode:
            message="The original governed MCP source could not be captured."
            try:
                error=json.loads(completed.stderr.decode().splitlines()[-1]).get("error",{})
                message=str(error.get("code","GOVERNED_MCP_CAPTURE_FAILED"))+": "+str(error.get("message",message))
            except (ValueError,IndexError,UnicodeError):
                pass
            raise ValueError(message)
        snapshot=json.loads(completed.stdout)
        if snapshot.get("schema")!=SCHEMA or snapshot.get("descriptorSha256")!=descriptor_sha or (
                snapshot.get("owner",{}).get("configurationSha256")!=host_sha) or snapshot.get("input")!=input:
            raise ValueError("The captured source differs from its selected original owner.")
        owner=snapshot["owner"]
        if owner.get("ledger")!=str(ledger) or owner.get("stateDirectory")!=str(state):
            raise ValueError("The locked native owner differs from the captured source.")
        snapshot["ledger_snapshot"]=read_snapshot(ledger) if before is not None else None
        after=_identity(ledger,True)
        if before!=after or _private_json(descriptor)[2]!=descriptor_sha or _private_json(input["spendingConfigurationFile"])[2]!=host_sha:
            raise ValueError("The selected original source changed during capture.")
        snapshot["ledger_identity"]=before
        snapshot["native_lock_held"]=locked
        snapshot["observation_basis"]="Original quote and ledger read transactions while native owner records remain stable"
        report=project_governed_snapshot(snapshot)
        if len(json.dumps(snapshot,ensure_ascii=True).encode())>MAX_OUTPUT:
            raise ValueError("The complete original governed source exceeded its retained capture capacity.")
        return {"path":str(descriptor),"identity":{"kind":"governed_mcp",
            "quote":snapshot["quotes"]["identity"],"state_directory":str(state),
            "actor":owner["actor"],"service":owner["service"],"payer":owner["payer"]},
            "snapshot":snapshot,"report":report}
