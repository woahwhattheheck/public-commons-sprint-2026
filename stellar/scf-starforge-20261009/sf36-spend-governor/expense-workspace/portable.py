"""Complete included-source private receiving package for this operator workspace."""
from pathlib import Path
import hashlib
import io
import json
import os
import tempfile
import zipfile
from domain import Problem
from native_mcp import reader_path
from native_node import READER_FILES as NODE_READER_FILES, FEATURE as NODE_FEATURE

ACCOUNTANT_READER_FILES = tuple(json.loads((Path(__file__).resolve().parent / 'accountant-reader-files.json').read_text())['files'])
CREDIT_READER_FILES = tuple(json.loads((Path(__file__).resolve().parent / 'credit-reader-files.json').read_text())['files'])

APP_FILES = ("native.py", "domain.py", "store.py", "exports.py", "portable.py", "server.py",
             "public/index.html", "public/app.mjs", "public/style.css", "README.md", "cli.mjs", "receive.py", "native_mcp.py", "native_woo.py", "native_adjustments.py", "credits.py", "credit_store.py", "credit-reader-files.json", "native_accountant.py", "accountant_store.py", "accountant-reader-files.json", "BOOKKEEPING.md", "native_governed_mcp.py", "GOVERNED_MCP.md", "native_node.py", "node_store.py", "NODE_OPERATIONS.md")
MCP_READER_FILES = ("stellar-forge/mcp-paid-agent/expense-statement.mjs",
                    "stellar-forge/mcp-paid-agent/expense-governed-statement.mjs",
                    "stellar-forge/mcp-paid-agent/native-spend-binding.mjs",
                    "stellar-forge/mcp-paid-agent/native-spend-configuration.mjs",
                    "stellar-forge/mcp-paid-agent/quote-store.mjs",
                    "stellar-forge/mcp-paid-agent/remote-mcp.mjs",
                    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs",
                    "stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/networks.json")
PREPARE = '''from pathlib import Path,PurePosixPath
import hashlib,json,os
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text())
os.chmod(root,0o700)
for row in manifest['files']:
 rel=PurePosixPath(row['path'])
 if rel.is_absolute() or '..' in rel.parts:raise SystemExit('Invalid retained path')
 path=root.joinpath(*rel.parts)
 for parent in path.parents:
  if parent==root.parent:break
  if parent.is_symlink():raise SystemExit('Linked retained directory: '+str(rel))
 if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:raise SystemExit('Changed retained file: '+str(rel))
 for parent in path.parents:
  if parent==root.parent:break
  os.chmod(parent,0o700)
 os.chmod(path,0o600)
os.chmod(root/'manifest.json',0o600)
print('Private expense project ready.')
'''
GUIDE = """# Buyer expense workspace — complete private project

Use Python 3.11 or newer on a POSIX host. Extract privately, then open the included application:

    umask 077
    python3 -m zipfile -e COMPLETE_PROJECT.zip received-expenses
    cd received-expenses
    python3 prepare_private.py
    python3 app/sf36-spend-governor/expense-workspace/server.py --state project --port 0

Open the complete private URL printed by that command. No repository checkout is required. Opening retained state uses Python alone; new native MCP captures or refund receiving use the host's Node 22.13+ or Node 24 runtime.

All source captures, original native row identities, allocation editions, exception decisions, period reviews, issued exports and activity history are retained in the included workspace. Sources keep their original type and locator. Opening the project does not read an original buyer source or a key. To refresh after moving the original buyer, use Sources → Rebind and select the same original ledger, MCP quote directory, or governed-source descriptor; the application compares its retained native identities before accepting the new locator. Governed sources retain their original spending-owner fields and the complete shared-ledger statement. Read app/sf36-spend-governor/expense-workspace/GOVERNED_MCP.md for the complete purchase-to-period workflow.

The original buyer ledgers, quote databases, signers, wallet keys and purchased result bodies remain outside this expense project. Retained captures and accountant editions open independently. New SF36 captures use the unchanged read-only statement API. Governed MCP captures join the original quote snapshot and original request binding to the complete original ledger under the native owner lock, retaining reserved capacity separately from quote observations. New MCP captures use the included original SqliteQuoteStore reader in one read-only transaction; they require Node 22.13+ or Node 24. Supply the host interpreter explicitly when needed:

    python3 app/sf36-spend-governor/expense-workspace/server.py --state project --port 0 --node /absolute/path/to/node

No Node process starts until an operator explicitly captures a native source, previews or imports an original Node accounting export, imports an original refund packet, or previews an original accountant return. The saved original SF86 payment observation determines whether a matched transfer is available for allocation; seller response, result metadata and quoted amount remain separate. The expense reader neither contacts an RPC nor initiates, signs or retries a payment. Reconcile an unresolved original payment through its existing buyer operation, then capture and review that source edition here.

Original Node operation exports use Sources → Import Node export. The exact complete export bytes, producing attempt/evidence, operation identity, original SF36 result and named intake/review decisions remain in this same SQLite state. An unpaid result stays NO_PAYMENT_REQUIRED with no asset, expense or fabricated reservation. A paid source supports expense coding only when the original native result is FINALIZED or IDEMPOTENT_FINALIZED. Earlier unresolved outcomes remain source history. Selecting a successor export does not replace an original ledger locator or run its worker. The included NODE_OPERATIONS.md describes native preview, stable-request capture/recovery, original-file download, period review and complete receiving.

Native SF36 reservations, settled actual and unused capacity retain their original meanings. MCP quotes create no reservations in this workspace. Quote creation day is a source date, not a payment or accounting date. The operator supplies recognition dates and exact allocations; units remain separate by network and asset. A transfer shared by source rows requires explicit review, and the same exact matched event cannot be included twice in one period or another currently closed period.

Credits and returns retain exact original customer refund packets in the native SQLite state, including their original member bytes. Woo retains its original merchant manifest; generic accounting exports retain their unchanged original JSON and an explicitly labelled buyer-selection manifest. After receiving the complete project, those captured packets open without their former source directories. Importing another Woo packet calls the included unchanged original Woo receiver and its native purchase/refund binding functions. Importing an original merchant adjustment export calls its included original accounting compiler and proof validators, preserving the selected event, original file SHA, optional paid-job binding and every decision. Original cancellations, pending returns and withdrawn requests remain source outcomes. Only an original proof-bound payment and verified returned transfer enter native expense and credit allocations. An export without an original payment proof can still be retained and accepted as a reference-only source; it creates no purchase or returned units. Choose the exact retained manifest hash, store and original operation context. Operational and development inputs remain in separate workspaces.

Each accepted packet either binds to the same original buyer payment or explicitly registers the original reviewed merchant purchase. Allocate the purchase first, then its exact returned units against remaining original cost-center, project and account dimensions. Store-currency credit amounts remain independent of native returned units; no exchange rate is inferred. A return cannot be included twice or moved out of a currently closed period without reopening it. Corrected editions preserve every original issued edition and frozen source packet.

An issued edition can export its exact buyer accountant source to the maintained accounting workspace. That workspace retains typed buyer allocation lines, the original CSV return and Xero explicit-valuation workflow. Import its original buyer-return.json into the same issued edition here. Preview verifies the original handoff, complete preceding accountant revisions and exact frozen source before saving returned references in this same database. Amounts and original issued editions remain unchanged. Complete receiving retains the returned original packet, every accepted reference edition, current handoff choices and the source-owned native validation code. Replacing a different accepted handoff for the same allocation lines requires explicit review; prior returns remain available.

Use Period review to inspect current source/coding decisions, name the reviewer and save a review. Issue a ready edition for a frozen accountant packet. Reopening requires a recorded reason and preserves all previously issued editions. The Complete project download retains runnable source and a consistent SQLite backup for subsequent receiving. Successful optional customer requests are retained in that same database. The trusted installed receive.py can verify and receive the complete ZIP with --archive, --directory and --expected-sha256; it executes no archive code or SQL and can continue only the same exact incomplete receive.
"""


def complete_project(store, expected_revision=None):
    with store.lock:
        state = store.state()
        if expected_revision is not None and (type(expected_revision) is not int or expected_revision != state["revision"]):
            raise Problem("WORKSPACE_CHANGED", "Refresh the original workspace revision before exporting this complete project", 409)
        return _complete_project(store, state)


def _complete_project(store, state):
    app = Path(__file__).resolve().parent
    entries = {}
    node_sources = {source["id"] for source in state["sources"] if source.get("kind") == "node_operation"}
    for name in APP_FILES:
        path = app / name
        if path.is_symlink():
            raise ValueError("Application source cannot be a symlink")
        entries["app/sf36-spend-governor/expense-workspace/" + name] = path.read_bytes()
    for name in ("statement.py", "governor.py", "STATEMENTS.md"):
        entries["app/sf36-spend-governor/" + name] = (app.parent / name).read_bytes()
    native_root = reader_path().parents[2]
    for name in sorted(set(MCP_READER_FILES) | set(CREDIT_READER_FILES) | set(ACCOUNTANT_READER_FILES) | set(NODE_READER_FILES)):
        path = native_root / name
        if path.is_symlink():
            raise ValueError("Original MCP reader source cannot be a symlink")
        entries["app/" + name] = path.read_bytes()
    with tempfile.TemporaryDirectory(prefix=".private-export-", dir=store.root) as scratch:
        path = Path(scratch) / "workspace.sqlite"
        store.backup_to(path)
        entries["project/workspace.sqlite"] = path.read_bytes()
    entries["README.md"] = GUIDE.encode()
    entries["prepare_private.py"] = PREPARE.encode()
    entries["manifest.json"] = (json.dumps({"schema": "stellar-forge.buyer-expense-private-project.v1",
        "workspace": state["id"], "revision": state["revision"],
        "request_recovery": "sqlite-transaction-v1",
        "mcp_quote_capture": "native-readonly-v1",
        "governed_mcp_capture": "original-spending-readonly-v1",
        "node_operation_capture": NODE_FEATURE,
        "node_operation_count": len(node_sources),
        "node_capture_count": sum(row[0] in node_sources for row in store.connection.execute("SELECT source_id FROM captures")),
        "buyer_credit_capture": "original-native-refund-v2",
        "data_context": state["data_context"],
        "buyer_bookkeeping": "issued-accountant-return-v1",
        "accountant_return_count": state["accountant_return_count"],
        "credit_count": state["credit_count"],
        "refund_packet_count": store.connection.execute("SELECT COUNT(*) FROM refund_packets").fetchone()[0],
        "source_kinds": sorted({source.get("kind", "sf36_ledger") for source in state["sources"]}),
        "request_count": store.connection.execute("SELECT COUNT(*) FROM api_requests").fetchone()[0],
        "files": [{"path": name, "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()} for name, value in sorted(entries.items())]}, indent=2) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return output.getvalue()
