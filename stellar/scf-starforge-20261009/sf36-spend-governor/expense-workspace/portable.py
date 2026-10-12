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

APP_FILES = ("native.py", "domain.py", "store.py", "exports.py", "portable.py", "server.py",
             "public/index.html", "public/app.mjs", "public/style.css", "README.md", "cli.mjs", "receive.py", "native_mcp.py")
MCP_READER_FILES = ("stellar-forge/mcp-paid-agent/expense-statement.mjs",
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

Open the complete private URL printed by that command. No repository checkout or dependency installation is required.

All source captures, original native row identities, allocation editions, exception decisions, period reviews, issued exports and activity history are retained in the included workspace. Sources keep their original type and locator. Opening the project does not read an original buyer source or a key. To refresh after moving the original buyer, use Sources → Rebind and select the same original ledger or MCP quote directory; the application compares its retained native identities before accepting the new locator.

The original buyer ledgers, quote databases, signers, wallet keys and purchased result bodies remain outside this expense project. Retained captures and accountant editions open independently. New SF36 captures use the unchanged read-only statement API. New MCP captures use the included original SqliteQuoteStore reader in one read-only transaction; they require Node 22.13+ or Node 24. Supply the host interpreter explicitly when needed:

    python3 app/sf36-spend-governor/expense-workspace/server.py --state project --port 0 --node /absolute/path/to/node

No Node process starts until an operator explicitly captures an MCP source. The saved original SF86 payment observation determines whether a matched transfer is available for allocation; seller response, result metadata and quoted amount remain separate. The expense reader neither contacts an RPC nor initiates, signs or retries a payment. Reconcile an unresolved original payment through its existing buyer operation, then capture and review that source edition here.

Native SF36 reservations, settled actual and unused capacity retain their original meanings. MCP quotes create no reservations in this workspace. Quote creation day is a source date, not a payment or accounting date. The operator supplies recognition dates and exact allocations; units remain separate by network and asset. A transfer shared by source rows requires explicit review, and the same exact matched event cannot be included twice in one period.

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
    for name in APP_FILES:
        path = app / name
        if path.is_symlink():
            raise ValueError("Application source cannot be a symlink")
        entries["app/sf36-spend-governor/expense-workspace/" + name] = path.read_bytes()
    for name in ("statement.py", "governor.py", "STATEMENTS.md"):
        entries["app/sf36-spend-governor/" + name] = (app.parent / name).read_bytes()
    native_root = reader_path().parents[2]
    for name in MCP_READER_FILES:
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
