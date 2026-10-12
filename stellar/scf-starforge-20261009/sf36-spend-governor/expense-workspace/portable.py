"""Complete included-source private receiving package for this operator workspace."""
from pathlib import Path
import hashlib
import io
import json
import os
import tempfile
import zipfile
from domain import Problem

APP_FILES = ("native.py", "domain.py", "store.py", "exports.py", "portable.py", "server.py",
             "public/index.html", "public/app.mjs", "public/style.css", "README.md", "cli.mjs")
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

All source captures, original native row identities, allocation editions, exception decisions, period reviews, issued exports and activity history are retained in the included workspace. Sources keep their original ledger locators. Opening this project does not read a ledger or a key. To refresh a source after moving the original buyer, use Sources → Rebind and select the same original ledger; the application compares its retained request identities before accepting the new locator.

The original buyer ledger, signer and wallet keys are outside this expense project. Its retained statement snapshots and accountant editions open independently. New captures use the original SF36 read-only statement API. Native reservations, settled actual and unused capacity retain their original meanings. The operator supplies recognition dates and expense allocations; units remain separate by network and asset.

Use Period review to inspect current source/coding decisions, name the reviewer and save a review. Issue a ready edition for a frozen accountant packet. Reopening requires a recorded reason and preserves all previously issued editions. The Complete project download retains runnable source and a consistent SQLite backup for subsequent receiving.
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
    with tempfile.TemporaryDirectory(prefix=".private-export-", dir=store.root) as scratch:
        path = Path(scratch) / "workspace.sqlite"
        store.backup_to(path)
        entries["project/workspace.sqlite"] = path.read_bytes()
    entries["README.md"] = GUIDE.encode()
    entries["prepare_private.py"] = PREPARE.encode()
    entries["manifest.json"] = (json.dumps({"schema": "stellar-forge.buyer-expense-private-project.v1",
        "workspace": state["id"], "revision": state["revision"],
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
