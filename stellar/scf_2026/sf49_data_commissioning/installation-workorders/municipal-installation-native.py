#!/usr/bin/env python3
"""Inspect and receive the original municipal archive through its maintained owner."""
from __future__ import annotations
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

SOURCE_ROOT = Path(__file__).resolve().parents[3] / "scf-starforge-20261009/sf30-seller-sdk/municipal-assets"
sys.path.insert(0, str(SOURCE_ROOT / "native"))
import managed
import portable
from workspace.engine import restore_backup, Workspace
from workspace.capture_intake import locked

SCHEMA = "stellar-forge.municipal-installation-source.v1"
MAX_CASE_ARCHIVE = 8 * 1024 * 1024
def need(ok, message):
    if not ok: raise ValueError(message)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def wire(value): return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)+"\n").encode()
def parsed(value): return json.loads(value)
def original_rows(db, table, project):
    # Table names are fixed by this source, never caller-supplied.
    rows = [dict(row) for row in db.execute("SELECT * FROM "+table+" WHERE project_id=? ORDER BY rowid", (project,))]
    output = []
    for row in rows:
        item = {}
        for key, value in row.items():
            if isinstance(value, bytes):
                item[key] = {"bytes": len(value), "sha256": sha(value)}
            else:
                item[key] = value
        output.append(item)
    return output
def project_snapshot(db, project_id, revision=None):
    row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    need(row is not None, "The selected original project is missing")
    current = dict(row)
    selected_revision = current["revision"] if revision is None else revision
    need(type(selected_revision) is int and 0 <= selected_revision <= current["revision"],
         "Select a retained original project revision")
    rows = original_rows(db, "history", project_id)
    prior = [r for r in rows if r["revision"] <= selected_revision]
    need([r["revision"] for r in sorted(prior, key=lambda r:r["revision"])] == list(range(selected_revision+1)),
         "Retain the whole original revision history")
    chosen = next(r for r in prior if r["revision"] == selected_revision)
    state = parsed(chosen["state"])
    if selected_revision == current["revision"]:
        need(current["state"] == chosen["state"], "The current project differs from its original saved history")
    input_rows = original_rows(db, "inputs", project_id)
    inputs = []
    for item in input_rows:
        need(item["body"]["sha256"] == item["sha256"], "Original input body differs: "+item["id"])
        inputs.append(item)
    history = []
    for item in prior:
        history.append({**item, "stateSha256": sha(item["state"].encode()), "state": parsed(item["state"]),
                        "detailSha256": sha(item["detail"].encode()), "detail": parsed(item["detail"])})
    snapshot = {
        "id": current["id"], "title": current["title"], "mode": current["mode"],
        "revision": selected_revision, "created_at": current["created_at"],
        "state": state, "stateSha256": sha(chosen["state"].encode()),
        "history": history, "inputs": inputs,
        "operations": original_rows(db, "operations", project_id),
        "nativeRuns": original_rows(db, "native_runs", project_id),
        "releases": original_rows(db, "releases", project_id),
    }
    return snapshot
def inspect_archive(path):
    source_sha = managed.source()
    raw = portable.read(path, MAX_CASE_ARCHIVE)
    manifest, values = portable.inspect_archive(raw)
    need(manifest["binding"]["workspace"] == manifest["workspace"], "The original managed identity differs")
    managed.identity(manifest["workspace"])
    with tempfile.TemporaryDirectory(prefix="municipal-installation-source-") as folder:
        root = Path(folder); archive = root/"database.zip"; archive.write_bytes(values["database.zip"])
        restore_backup(archive, root/"workspace")
        workspace = Workspace(root/"workspace")
        need(workspace.projects() == manifest["projects"], "Original project selection differs from the complete database")
        with closing(sqlite3.connect(workspace.database.as_uri()+"?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            identity = parsed(db.execute("SELECT value FROM settings WHERE key=?", (managed.BINDING_KEY,)).fetchone()["value"])
            need(identity == manifest["workspace"], "Original database identity differs from its handover")
            projects = []
            for row in sorted(manifest["projects"], key=lambda x:x["id"]):
                snapshot = project_snapshot(db, row["id"])
                projects.append({**snapshot, "snapshotSha256": sha(wire(snapshot))})
    # Retain the entire archive and original manifest. This report is its readable selection.
    return {"schema": SCHEMA, "archive": {"bytes":len(raw), "sha256":sha(raw)},
            "workspace": manifest["workspace"], "originalSourceSha256":manifest["binding"]["source_sha256"],
            "receivingSourceSha256":source_sha, "manifest":manifest,
            "database":next(row for row in manifest["files"] if row["path"]=="database.zip"),
            "projects":projects}
def compare_original(received, source):
    observed = managed.inspect(received)
    need(observed["binding"]["workspace"] == source["workspace"], "The independently received workspace changed")
    directory = Path(received)
    with closing(sqlite3.connect((directory/"workspace.sqlite3").as_uri()+"?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        compared=[]
        for original in source["projects"]:
            current=project_snapshot(db, original["id"], original["revision"])
            # Preserve later input/operation/release rows while requiring every original row.
            for key, identity in (("inputs","id"),("operations","id"),("nativeRuns","id"),("releases","id")):
                actual={row[identity]:row for row in current[key]}
                for row in original[key]:
                    observed_row = actual.get(row[identity])
                    if key == "releases" and row.get("packet") is None and observed_row is not None:
                        observed_row = {**observed_row, "packet": None}
                    need(observed_row == row, "An original "+key+" row changed: "+row[identity])
                current[key]=original[key]
            # Original project title/mode are part of immutable historic selection;
            # this engine keeps those attributes outside mutable state.
            need(sha(wire(current)) == original["snapshotSha256"], "The original saved project edition changed")
            compared.append({"id":original["id"],"revision":original["revision"],"snapshotSha256":original["snapshotSha256"]})
    return {"workspace":source["workspace"], "projects":compared}
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("inspect","receive","reopen"))
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--destination", type=Path)
    args=parser.parse_args()
    need(sys.version_info >= (3,11), "Use the original Python 3.11+ runtime")
    source=inspect_archive(args.archive)
    if args.command=="inspect":
        print(json.dumps(source, ensure_ascii=False, allow_nan=False));return
    need(args.destination is not None, "Choose the original independent receiving destination")
    if args.command=="receive":
        received=portable.receive(args.archive,args.destination,source["receivingSourceSha256"],managed.inspect)
    else:
        received={"state":"reopened"}
    with locked(args.destination/".managed-server.lock"):
        checked=compare_original(args.destination,source)
    # Recheck the selected original after the whole independent receive/reopen.
    raw=portable.read(args.archive,MAX_CASE_ARCHIVE)
    need(len(raw)==source["archive"]["bytes"] and sha(raw)==source["archive"]["sha256"],
         "The original archive changed during receiving")
    print(json.dumps({"schema":"stellar-forge.municipal-installation-native-receiving.v1",
                      "state":"complete","archive":source["archive"],"sourceSha256":source["receivingSourceSha256"],
                      "receiving":received,"originalProjects":checked},ensure_ascii=False,allow_nan=False))
if __name__=="__main__":
    try: main()
    except (ValueError,KeyError,OSError,sqlite3.Error) as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)
