"""Original read-only MCP quote snapshots projected into the existing expense model."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

SCHEMA = "stellar-forge.mcp-expense-source.v1"
MAX_OUTPUT = 100 * 1024 * 1024
INTEGER = re.compile(r"(?:0|[1-9][0-9]{0,99})")
HEX = re.compile(r"[0-9a-f]{64}")


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def reader_path():
    native = Path(__file__).resolve().parent.parent
    # A normal original checkout, or the complete included-source project layout.
    candidates = [native.parents[2] / "stellar-forge/mcp-paid-agent/expense-statement.mjs",
                  native.parent / "stellar-forge/mcp-paid-agent/expense-statement.mjs"]
    for path in candidates:
        if path.is_file():
            return path.resolve(strict=True)
    raise ValueError("The original MCP expense reader is absent from this application. Use the complete installed or receiving source.")


def node_path(value=None):
    value = value or "node"
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Choose the host's existing Node executable.")
    selected = shutil.which(value)
    if not selected:
        raise ValueError("Native MCP capture needs the host's Node 22.13+ or 24 executable. Reopening saved financial state does not.")
    return str(Path(selected).resolve(strict=True))


def quote_rows(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("schema") != SCHEMA or not isinstance(snapshot.get("records"), list):
        raise ValueError("The original MCP reader did not return a complete source capture.")
    if snapshot.get("quoteCount") != len(snapshot["records"]):
        raise ValueError("The source's complete quote count does not match its retained records.")
    rows, seen = [], set()
    for record in snapshot["records"]:
        q, payment = record["quote"], record["payment"]
        ident = q["quoteId"]
        if ident in seen:
            raise ValueError("The original quote source contains a repeated identity.")
        seen.add(ident)
        accepted = q["accepted"]
        amount = accepted.get("amount")
        exact = amount if isinstance(amount, str) and INTEGER.fullmatch(amount) else None
        observed = payment.get("observation")
        receipt = (q.get("result") or {}).get("paymentResponse")
        content = (q.get("result") or {}).get("content") or {}
        response = (q.get("result") or {}).get("responseFile")
        invocation = q.get("invocation") or {}
        classification = payment["classification"]
        state = {"TRANSFER_MATCHED":"settled", "FAILED_TRANSACTION":"failed",
                 "NO_SIGNED_DISPATCH":"not_dispatched", "UNRESOLVED":"unresolved",
                 "OBSERVATION_REVIEW_REQUIRED":"observation_review"}[classification]
        if state == "settled" and exact is None:
            raise ValueError("The saved matched transfer lost its original exact amount.")
        transaction = observed.get("transaction") if isinstance(observed, dict) else None
        if transaction is None and isinstance(receipt, dict):
            transaction = receipt.get("transaction")
        if not isinstance(transaction, str) or not HEX.fullmatch(transaction.lower()):
            transaction = None
        else:
            transaction = transaction.lower()
        payer = observed.get("payer") if isinstance(observed, dict) else None
        if not payer and isinstance(receipt, dict):
            payer = receipt.get("payer")
        detail = {"quote_id":ident, "quote_sha256":record["quoteSha256"],
                  "classification":classification, "native_status":q["status"], "phase":q.get("phase"),
                  "created_at_ms":q["createdAt"], "updated_at_ms":q["updatedAt"],
                  "signed_request_dispatched":q["signedRequestDispatched"], "attempts":q["attempts"],
                  "url":q["url"], "method":q["method"], "tool_name":invocation.get("toolName"),
                  "arguments_sha256":invocation.get("argumentsSha256"),
                  "payer":payer, "recipient":accepted.get("payTo"), "quoted_amount":exact,
                  "transaction":transaction, "receipt":receipt, "observation":observed,
                  "observation_sha256":payment.get("observationSha256"),
                  "transfer_identity":payment.get("transferIdentity"), "problems":payment.get("problems", []),
                  "result_file":response,
                  "result_preview":{key:content[key] for key in ("contentType","bodyBytes","bodySha256","omitted","truncated") if key in content},
                  "superseded_observation":(q.get("result") or {}).get("supersededReconciliation")}
        # Ignore checkpoint time alone; semantic quote/result/payment changes
        # require an explicit source/coding review in the existing workspace.
        context = dict(detail)
        context.pop("updated_at_ms", None)
        context.pop("quote_sha256", None)
        row = {"request_id":ident, "request_digest":record["identitySha256"],
               "actor":payer or q["operatorScope"], "service":invocation.get("toolName") or q["resource"],
               "network":accepted.get("network", ""), "asset":accepted.get("asset", ""),
               "scheme":accepted.get("scheme", ""), "amount":exact or "", "day":
                   datetime.fromtimestamp(q["createdAt"] / 1000, timezone.utc).date().isoformat(),
               "state":state, "actual":exact if state == "settled" else "",
               "receipt_ref":accepted.get("network", "") + "/" + transaction if transaction else "",
               "proof_sha256":payment.get("observationSha256") if state == "settled" else "",
               "settled_base_units":exact if state == "settled" else None,
               "reserved_base_units":"0", "released_capacity_base_units":"0", "age_utc_days":None,
               "source_kind":"mcp_quote", "native_date_basis":"MCP quote creation day",
               "native_context_sha256":digest(context), "native_detail":detail}
        rows.append(row)
    return sorted(rows, key=lambda row:(row["day"], row["request_id"]))


def project_snapshot(snapshot):
    rows = quote_rows(snapshot)
    groups = {}
    for row in rows:
        key = (row["network"], row["asset"])
        group = groups.setdefault(key, {"network":key[0], "asset":key[1], "requests":0,
            "pending_requests":0, "unresolved_quotes":0, "settled_base_units":0,
            "reserved_base_units":"0", "released_capacity_base_units":"0"})
        group["requests"] += 1
        if row["state"] == "settled":
            group["settled_base_units"] += int(row["settled_base_units"])
        elif row["state"] in ("unresolved", "observation_review"):
            group["unresolved_quotes"] += 1
    for group in groups.values():
        group["accounted_base_units"] = str(group["settled_base_units"])
        group["settled_base_units"] = str(group["settled_base_units"])
    return {"schema":"stellar-forge.mcp-expense-statement.v1", "captured_at":snapshot["capturedAt"],
            "source":{"kind":"mcp_quote", "database_name":"quotes.sqlite", "reservations":len(rows),
                      "records":len(rows), "record_kind":"quotes", "journal_events":snapshot["transitionCount"],
                      "last_sequence":snapshot["lastSequence"], "projection_sha256":digest(rows),
                      "quote_projection_sha256":snapshot["quoteProjectionSha256"], "quote_bytes":snapshot["quoteBytes"]},
            "rows":rows, "portfolio":[groups[k] for k in sorted(groups)],
            "basis":"Original MCP quote snapshot and its retained, exact-bound SF86 payment observations",
            "date_basis":"Original quote creation day; payment and operator recognition dates remain separate",
            "notes":["Seller-reported success alone is unresolved payment, not allocated expense.",
                     "Only a saved original SF86 TRANSFER_MATCHED observation enters settled expense.",
                     "No MCP quote amount becomes an SF36 reservation or released spending capacity.",
                     "Result metadata is retained as recorded; purchased result bytes remain in the original buyer workspace."]}


def capture_mcp_quotes(path, node=None):
    selected = Path(path).expanduser()
    if not selected.is_absolute() or selected.is_symlink():
        raise ValueError("Choose the absolute original private MCP quote directory, without a directory symlink.")
    command = [node_path(node), str(reader_path()), "--state-dir", str(selected)]
    completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=60, check=False)
    if len(completed.stdout) > MAX_OUTPUT or len(completed.stderr) > 1024 * 1024:
        raise ValueError("The original source exceeded the complete native capture capacity.")
    if completed.returncode:
        message = "The original MCP quote reader could not capture this source."
        try:
            error = json.loads(completed.stderr.decode().splitlines()[-1]).get("error", {})
            message = str(error.get("code", "MCP_CAPTURE_FAILED")) + ": " + str(error.get("message", message))
        except (ValueError, IndexError, UnicodeError):
            pass
        raise ValueError(message)
    snapshot = json.loads(completed.stdout)
    return {"path":snapshot["directory"], "identity":snapshot["identity"],
            "snapshot":snapshot, "report":project_snapshot(snapshot)}
