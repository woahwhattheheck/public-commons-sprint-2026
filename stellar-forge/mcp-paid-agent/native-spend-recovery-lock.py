#!/usr/bin/env python3
"""MIT. Hold the original native owner lock; verify its original retained records.

The original SF88 relay owns SQLite checkpoint/audit/online backup. This adapter
does not initialize a ledger, reserve, sign, release or reconcile a payment.
"""
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2] / "stellar" / "scf-starforge-20261009"


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


def run():
    os.umask(0o077)
    mode, directory = sys.argv[1:3]
    state = Path(directory)
    if not state.is_absolute() or state.resolve() != state:
        raise ValueError("canonical state required")
    info = state.stat(follow_symlinks=False)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("private state required")
    if mode == "lock":
        fd = os.open(state / "state.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "r+") as locked:
            observed = os.fstat(fd)
            if not stat.S_ISREG(observed.st_mode) or observed.st_uid != os.geteuid() or observed.st_mode & 0o077:
                raise ValueError("private lock required")
            fcntl.flock(locked, fcntl.LOCK_EX)
            print(json.dumps({"status": "STATE_LOCKED", "identity": {
                "dev": info.st_dev, "ino": info.st_ino}}), flush=True)
            if sys.stdin.readline().strip() != "release":
                raise ValueError("capture parent disconnected")
            current = state.stat(follow_symlinks=False)
            current_lock = (state / "state.lock").stat(follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or \
                    (current_lock.st_dev, current_lock.st_ino) != (observed.st_dev, observed.st_ino):
                raise ValueError("original owner changed")
        return
    if mode != "verify":
        raise ValueError("unsupported recovery mode")
    raw = sys.stdin.buffer.readline(131073)
    if len(raw) > 131072:
        raise ValueError("input limit")
    values = json.loads(raw)
    owner = values["owner"]
    original = module("native_recovery_original", Path(__file__).with_name("native-spend-governor.py"))
    relay = module("native_recovery_ledger", ROOT / "sf88-operator-buyer-cli" / "workspace-recovery-ledger.py")
    args = SimpleNamespace(actor=owner["actor"], service=owner["service"],
        ledger=Path(owner["ledger"]), policy=Path(owner["policy"]), state_directory=state)
    configuration = original.read_record(state / "configuration.json")
    if configuration != {"schema": original.SCHEMA, "actor": args.actor, "service": args.service,
                         "ledger": owner["ledger"], "policy": owner["policy"]}:
        raise ValueError("original configuration changed")
    if original.read_record(state / "ledger-initialized.json") != {
            "schema": original.SCHEMA, "ledger": owner["ledger"]}:
        raise ValueError("original ledger binding changed")
    keys = [base64.b64decode(values["keys"]["SF36_" + name + "_KEY_B64"], validate=True)
            for name in ("CONSENT", "AUDIT", "OPERATOR")]
    policy = original.read_record(Path(values["policy"]), private=False)
    governor = relay.existing_governor(values["database"], policy, keys, readonly=True)
    try:
        governor.db.execute("BEGIN")
        if governor.db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("snapshot integrity")
        checkpoint = relay.checkpoint(governor)
        prefix = values.get("expected_checkpoint")
        if prefix is not None:
            sequence, mac = prefix.get("sequence"), prefix.get("journalMac")
            if type(sequence) is not int or sequence < 0 or type(mac) is not str or not original.HASH.fullmatch(mac):
                raise ValueError("archive checkpoint invalid")
            observed = governor.db.execute("SELECT mac FROM journal WHERE sequence=?", (sequence,)).fetchone()
            if (sequence == 0 and mac != "0" * 64) or \
                    (sequence > 0 and (observed is None or observed[0] != mac)) or checkpoint["sequence"] < sequence:
                raise ValueError("archive is not a prefix of current history")
        bindings, finals, pending = {}, 0, 0
        for entry in sorted(state.iterdir()):
            if entry.name.endswith(".json") and original.UUID.fullmatch(entry.name[:-5]):
                binding, request, request_sha = original.record_at(state, entry.name[:-5], args)
                row = original.native_reservation(governor, request)
                bindings[request["request_id"]] = (binding, request, request_sha, row)
                if row and row["state"] == "reserved":
                    pending += 1
        for entry in sorted(state.iterdir()):
            if not entry.name.endswith(".finality.json"):
                continue
            request_id = entry.name[:-14]
            binding, request, request_sha, row = bindings[request_id]
            saved = original.read_record(entry)
            facts = saved["verifiedFacts"]
            if saved.get("schema") != original.SCHEMA or saved.get("request_id") != request_id or \
                    saved.get("request_sha256") != request_sha or \
                    saved.get("proof_sha256") != original.digest(original.canonical(facts)):
                raise ValueError("retained finality changed")
            proof = saved["proof"]
            if proof.get("schema") != "stellar-forge.sf86.payment-attempt.v1" or \
                    proof.get("outcome") != "TRANSFER_MATCHED" or proof.get("rpcStatus") != "SUCCESS":
                raise ValueError("original finality report required")
            transaction = proof["transaction"]
            verified = original.verified_facts(proof["transfer"], request, request_sha,
                                               transaction, binding["payer"])
            if facts != verified or row is None:
                raise ValueError("retained finality binding changed")
            if row["state"] == "settled" and (row["proof_sha256"] != saved["proof_sha256"] or
                    row["receipt_ref"] != request["network"] + "/" + transaction or
                    row["actual"] != request["max_amount"]):
                raise ValueError("settled finality changed")
            finals += 1
        print(json.dumps({"status": "NATIVE_STATE_VERIFIED", "checkpoint": checkpoint,
                          "boundRequests": len(bindings), "reservedRequests": pending,
                          "finalityRecords": finals, **({"archivePrefix": prefix} if prefix is not None else {})}, sort_keys=True), flush=True)
    finally:
        governor.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        print(json.dumps({"status": "NATIVE_RECOVERY_FAILED"}), flush=True)
        sys.exit(1)
