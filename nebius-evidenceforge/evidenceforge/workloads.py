"""Three released, curated code tasks; actual checks live in this trusted module."""
from __future__ import annotations
import hashlib
from decimal import Decimal

INVOICE_BASE = '''import csv
import io
from decimal import Decimal, InvalidOperation

def parse_invoices(text):
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        amount = Decimal(row["amount"])
        rows.append({"id": row["id"], "cents": int(amount * 100)})
    return rows
'''
INVOICE_FIXED = '''import csv
import io
from decimal import Decimal, InvalidOperation

def parse_invoices(text):
    rows = []
    seen = set()
    clean = text.lstrip("\\ufeff")
    reader = csv.DictReader(io.StringIO(clean))
    if reader.fieldnames != ["id", "amount"]:
        raise ValueError("expected id,amount columns")
    for row in reader:
        identity = (row.get("id") or "").strip()
        if not identity or identity in seen:
            raise ValueError("missing or duplicate invoice ID")
        try:
            amount = Decimal((row.get("amount") or "").strip())
        except InvalidOperation:
            raise ValueError("invalid amount")
        if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
            raise ValueError("amount must be nonnegative finite cents")
        seen.add(identity)
        rows.append({"id": identity, "cents": int(amount * 100)})
    return rows
'''
DEPENDENCY_BASE = '''def order_tasks(manifest):
    return [row["id"] for row in manifest]
'''
DEPENDENCY_FIXED = '''def order_tasks(manifest):
    identities = [row["id"] for row in manifest]
    if len(set(identities)) != len(identities):
        raise ValueError("duplicate task ID")
    known = set(identities)
    deps = {}
    for row in manifest:
        required = list(row.get("depends_on", []))
        if any(item not in known for item in required):
            raise ValueError("unknown dependency")
        deps[row["id"]] = set(required)
    pending = list(identities)
    result = []
    while pending:
        ready = [identity for identity in pending if deps[identity].issubset(set(result))]
        if not ready:
            raise ValueError("dependency cycle")
        identity = ready[0]
        result.append(identity)
        pending.remove(identity)
    return result
'''
LEDGER_BASE = '''import json
import hashlib

def apply_operation(ledger, operation_id, payload):
    if operation_id in ledger:
        return ledger[operation_id]["result"]
    result = {"sequence": len(ledger) + 1, "payload": payload}
    ledger[operation_id] = {"result": result}
    return result
'''
LEDGER_FIXED = '''import json
import hashlib

def apply_operation(ledger, operation_id, payload):
    if not isinstance(operation_id, str) or not operation_id.strip():
        raise ValueError("operation ID required")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    if operation_id in ledger:
        record = ledger[operation_id]
        if record["fingerprint"] != fingerprint:
            raise ValueError("operation ID conflicts with prior payload")
        return record["result"]
    result = {"sequence": len(ledger) + 1, "payload": payload}
    ledger[operation_id] = {"fingerprint": fingerprint, "result": result}
    return result
'''
TASKS = {
    "invoice-import": {
        "path": "src/invoices.py", "function": "parse_invoices", "test": "invoice-regressions",
        "goal": "Parse UTF-8 invoice CSV (optional BOM) with exact id,amount header. Strip IDs; reject empty or duplicate normalized IDs. Amounts must be finite nonnegative Decimal values exactly expressible in cents. Return id/cents rows without truncating fractions.",
        "baseline": INVOICE_BASE, "corrected": INVOICE_FIXED,
    },
    "dependency-order": {
        "path": "src/dependencies.py", "function": "order_tasks", "test": "dependency-regressions",
        "goal": "Return a stable topological order, choosing the first ready task in original manifest order. Reject duplicate IDs, unknown dependencies and dependency cycles.",
        "baseline": DEPENDENCY_BASE, "corrected": DEPENDENCY_FIXED,
    },
    "operation-ledger": {
        "path": "src/ledger.py", "function": "apply_operation", "test": "ledger-regressions",
        "goal": "Apply an operation once. Replays with the same canonical JSON payload return the prior result without appending another record. Reuse with a changed payload, including true versus 1, must raise ValueError. Reject an empty operation ID and nonfinite JSON.",
        "baseline": LEDGER_BASE, "corrected": LEDGER_FIXED,
    },
}

def task_manifest():
    return [{"task_id": key, "path": task["path"], "required_test": task["test"],
             "goal": task["goal"], "baseline_sha256": hashlib.sha256(task["baseline"].encode()).hexdigest(),
             "corrected_control_sha256": hashlib.sha256(task["corrected"].encode()).hexdigest()}
            for key,task in TASKS.items()]

def check_functions(task_id, namespace):
    task=TASKS[task_id]
    fn=namespace[task["function"]]
    rows=[]
    def equal(name,args,expected):
        try:
            value=fn(*args)
            rows.append({"name":name,"passed":value==expected,
                         "observed":repr(value)[:500],"expected":repr(expected)[:500]})
        except Exception as exc:
            rows.append({"name":name,"passed":False,"error":type(exc).__name__})
    def rejected(name,args):
        try:
            fn(*args);rows.append({"name":name,"passed":False,"observed":"accepted"})
        except ValueError:
            rows.append({"name":name,"passed":True,"observed":"ValueError"})
        except Exception as exc:
            rows.append({"name":name,"passed":False,"error":type(exc).__name__})
    if task_id=="invoice-import":
        equal("BOM_normalization_and_exact_cents",["\ufeffid,amount\n  A  ,0.10\nB,12.30\n"],
              [{"id":"A","cents":10},{"id":"B","cents":1230}])
        rejected("duplicate_normalized_ID",["id,amount\n A ,1.00\nA,2.00\n"])
        rejected("fractional_cent",["id,amount\nA,1.005\n"])
        rejected("nonfinite_amount",["id,amount\nA,NaN\n"])
    elif task_id=="dependency-order":
        equal("unsorted_dependency",[[{"id":"deploy","depends_on":["test"]},{"id":"test","depends_on":["build"]},{"id":"build"}]],
              ["build","test","deploy"])
        equal("stable_ready_order",[[{"id":"B"},{"id":"A"},{"id":"C","depends_on":["A"]}]],["B","A","C"])
        rejected("unknown_reference",[[{"id":"A","depends_on":["missing"]}]])
        rejected("cycle",[[{"id":"A","depends_on":["B"]},{"id":"B","depends_on":["A"]}]])
    else:
        ledger={}
        first=fn(ledger,"op-1",{"amount":1,"currency":"USD"})
        replay=fn(ledger,"op-1",{"currency":"USD","amount":1})
        rows.append({"name":"canonical_replay_once","passed":first==replay and len(ledger)==1,
                     "observed_records":len(ledger)})
        rejected("changed_payload", [ledger,"op-1",{"amount":2,"currency":"USD"}])
        ledger={}
        fn(ledger,"bool-op",{"value":True})
        rejected("boolean_integer_conflict",[ledger,"bool-op",{"value":1}])
        rejected("empty_operation_ID",[{}," ",{}])
    return {"exit_code":0 if all(row["passed"] for row in rows) else 1,"cases":rows}

