"""One original customer -> browser/MCP reports -> full portable reopening journey.

This executable accepts an EXISTING completed customer warehouse and native MCP
workspace. It imports no replacement rows, starts one original Python service,
and makes no provider, merchant purchase, signature or migration-engine call.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time

from ..duckdb_dataset import DuckDBWorkspace, _json, _qid, _now
from ..duckdb_http import serve
from ..storage import dump, lock, parse, private_directory, read
from .contracts import fail, request_id, sha
from .model import Reconciliation
from .package import inspect_package, receive_package, _path

OPERATION = "SCF-DUCKDB-PAIRED-RECONCILIATION-DBA55-20261012"


def _all_editions(workspace):
    result, before = [], None
    while True:
        page = workspace.editions(limit=100, before=before)
        result.extend(page["editions"])
        if page["next_before"] is None:
            return result
        if page["next_before"] == before:
            fail("NATIVE_CATALOG_CURSOR_CHANGED")
        before = page["next_before"]


def _baseline(workspace):
    with workspace._guard(), workspace._connection() as db:
        editions = [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_editions ORDER BY sequence").fetchall()]
        histories = {}
        for table in ("sf_view_history", "sf_query_history"):
            histories[table] = [{"id": row[0], "revision": row[1], "record": parse(row[2].encode())}
                                for row in db.execute("SELECT id,revision,record FROM " + table + " ORDER BY id,revision").fetchall()] if table == "sf_query_history" else [
                {"name": row[0], "revision": row[1], "record": parse(row[2].encode())}
                for row in db.execute("SELECT name,revision,record FROM sf_view_history ORDER BY name,revision").fetchall()]
        return {"editions": editions, "views": workspace._views(db),
                "queries": [parse(row[0].encode()) for row in db.execute("SELECT record FROM sf_queries ORDER BY id").fetchall()],
                "histories": histories}


def _preserved(workspace, baseline):
    after = _baseline(workspace)
    if after["editions"] != baseline["editions"] or after["views"] != baseline["views"]:
        fail("ORIGINAL_CUSTOMER_SELECTION_CHANGED")
    current = {record["query_id"]: record for record in after["queries"]}
    if any(current.get(record["query_id"]) != record for record in baseline["queries"]):
        fail("ORIGINAL_CUSTOMER_RECIPE_CHANGED")
    for table, rows in baseline["histories"].items():
        selected = {(row.get("id") or row.get("name"), row["revision"]): row for row in after["histories"][table]}
        if any(selected.get((row.get("id") or row.get("name"), row["revision"])) != row for row in rows):
            fail("ORIGINAL_CUSTOMER_HISTORY_CHANGED")
    return {"original_editions": len(baseline["editions"]), "original_views": len(baseline["views"]),
            "original_queries": len(baseline["queries"]), "original_history_preserved": True}


def _definition(workspace, original, source_id, target_id, expected_rows):
    editions = _all_editions(workspace)
    candidates = [x for x in editions if x["row_count"] == expected_rows]
    if source_id is not None:
        source = workspace.edition(source_id)
    elif len(candidates) >= 2:
        source = candidates[-1]
    else:
        fail("ORIGINAL_TWO_EDITIONS_REQUIRED")
    if target_id is not None:
        target = workspace.edition(target_id)
    else:
        target = next((x for x in candidates if x["edition_id"] != source["edition_id"]), None)
        if target is None:
            fail("ORIGINAL_TWO_EDITIONS_REQUIRED")
    if source["row_count"] != expected_rows or target["row_count"] != expected_rows:
        fail("ORIGINAL_ROW_COUNT_CHANGED")
    targets = {x["source"]: x for x in target["columns"]}
    common = [(left, targets[left["source"]]) for left in source["columns"]
              if left["source"] in targets and left["type"] == targets[left["source"]]["type"]]
    if not 2 <= len(common) <= 64:
        fail("ORIGINAL_COMPATIBLE_COLUMNS_REQUIRED")
    keys = sorted(common, key=lambda pair: (pair[0]["name"] not in source["keys"], pair[0]["name"]))
    key = None
    for left, right in keys:
        if left["type"] not in {"VARCHAR", "BIGINT", "HUGEINT"}:
            continue
        good = True
        for edition, column in ((source, left), (target, right)):
            query = workspace.query("SELECT count(*),count(" + _qid(column["name"]) + "),count(DISTINCT " +
                        _qid(column["name"]) + ") FROM " + _qid(edition["table"]), max_rows=1, expected_views=original["views"])
            good = good and query["rows"] == [[expected_rows, expected_rows, expected_rows]] and query["truncated"] is False
        if good:
            key = left["source"]
            break
    if key is None:
        fail("ORIGINAL_UNIQUE_COMPARISON_KEY_REQUIRED")
    columns = [{"name": left["name"], "source": left["name"], "target": right["name"],
                "role": "key" if left["source"] == key else "value", "meaning": "Original " + left["source"],
                "source_map": [], "target_map": []} for left, right in common]
    definition = {"name": "RetainedPairedReceiving_" + sha({"source": source["edition_id"], "target": target["edition_id"]})[:16],
                  "label": "Original retained customer observations", "source_edition": source["edition_id"],
                  "target_edition": target["edition_id"], "columns": columns, "windows": [], "window_column": None,
                  "notes": "Native receiving over the two existing original public-source customer editions. All original rows, fields, meanings, views and earlier recipes stay retained."}
    # The later native scenario changes an explicitly reviewed interpretation
    # map of a real retained VARCHAR value; it never fabricates a source record.
    scenario = None
    for left, right in common:
        if left["source"] == key or left["type"] != "VARCHAR":
            continue
        values = workspace.query("SELECT " + _qid(right["name"]) + " FROM " + _qid(target["table"]) +
                                 " ORDER BY sf_row", max_rows=expected_rows, expected_views=original["views"])
        if values["truncated"]:
            fail("ORIGINAL_ROWS_TRUNCATED")
        literals = list(dict.fromkeys(row[0] for row in values["rows"] if isinstance(row[0], str)))
        if literals and all(len(value.encode("utf-8")) <= 2048 for value in literals):
            scenario = {"column": left["name"], "target_values": literals, "selected_original": literals[0]}
            break
    if scenario is None:
        fail("ORIGINAL_VARCHAR_SCENARIO_REQUIRED")
    return definition, scenario


def run(args):
    os.umask(0o077)
    root, customer, native_root, source_root = map(_path, (args.directory, args.workspace, args.native_workspace, args.source_root))
    request_id(args.workspace_id)
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        fail("NATIVE_SOURCE_COMMIT_REQUIRED")
    if not (customer / "warehouse.duckdb").is_file() or not (native_root / "native-workspace.json").is_file():
        fail("ORIGINAL_CUSTOMER_AND_NATIVE_WORKSPACE_REQUIRED")
    private_directory(root)
    original_binding = {"operation_id": OPERATION, "workspace": str(customer), "workspace_id": args.workspace_id,
                        "native_workspace": str(native_root), "source_root": str(source_root), "source_commit": args.source_commit,
                        "source_edition": args.source_edition, "target_edition": args.target_edition,
                        "expected_rows": args.expected_rows}
    journal = root / "native-result.json"
    with lock(root):
        state = parse(read(journal, 32 * 1024 * 1024)) if journal.exists() else {
            "schema": "stellar-forge.duckdb-reconciliation-native-receiving.v1",
            "binding": original_binding, "created_at": _now(), "phases": []}
        if state.get("binding") != original_binding:
            fail("NATIVE_RECEIVING_BINDING_CHANGED")
        def save():
            dump(journal, state)
        def phase(name, result):
            state["phases"].append({"name": name, "completed_at": _now(), "result": result})
            save()
        if state.get("complete") is True:
            with DuckDBWorkspace(customer) as workspace:
                if workspace.identity()["workspace_id"] != args.workspace_id:
                    fail("WORKSPACE_CHANGED")
                _preserved(workspace, state["baseline"])
            return {**state, "reused": True}
        server, thread, child, workspace = None, None, None, None
        try:
            workspace = DuckDBWorkspace(customer)
            if workspace.duckdb.__version__ != "1.5.6":
                fail("NATIVE_DUCKDB_1_5_6_REQUIRED")
            if workspace.identity()["workspace_id"] != args.workspace_id:
                fail("WORKSPACE_CHANGED")
            if "baseline" not in state:
                state["baseline"] = _baseline(workspace)
                definition, scenario = _definition(workspace, state["baseline"], args.source_edition,
                                                    args.target_edition, args.expected_rows)
                state["definition"], state["scenario"] = definition, scenario
                state["runtime"] = {"python": sys.version, "duckdb": workspace.duckdb.__version__}
                save()
                phase("original_customer_bound", {"workspace_id": args.workspace_id, "rows_per_edition": args.expected_rows,
                      "source_edition": definition["source_edition"], "target_edition": definition["target_edition"]})
            _preserved(workspace, state["baseline"])
            if "node_result" not in state:
                server, control, url = serve(workspace, port=state.get("python_port", 0),
                                            export_root=root / "exports", handoff_root=root / "handoffs")
                state["python_port"] = server.server_port
                state["listener"] = {"address": url.split("#", 1)[0], "workspace_id": args.workspace_id}
                save()
                thread = threading.Thread(target=server.serve_forever, name="original-duckdb-reconciliation", daemon=False)
                thread.start()
                input_record = {"operation_id": OPERATION, "source_commit": args.source_commit,
                                "workspace_id": args.workspace_id, "workspace": str(customer),
                                "native_workspace": str(native_root), "launch_file": str(control),
                                "source_root": str(source_root), "output_directory": str(root / "agent"),
                                "definition": state["definition"], "scenario": state["scenario"],
                                "actor": "Native receiving operator",
                                "reason": "Record the observed retained public-source comparison without asserting a source defect or customer acceptance."}
                dump(root / "native-input.json", input_record)
                executable = source_root / "stellar-forge/mcp-paid-agent/duckdb-reconciliation-receiving.mjs"
                argv = [str(_path(args.node)), str(executable), "--input", str(root / "native-input.json"),
                        "--playwright", str(_path(args.playwright)), "--chromium", str(_path(args.chromium))]
                state["child"] = {"state": "PREPARED", "argv": argv}
                save()
                with open(root / "agent-stdout.txt", "ab", buffering=0) as stdout, open(root / "agent-stderr.txt", "ab", buffering=0) as stderr:
                    child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=os.environ.copy())
                    state["child"] = {"state": "RUNNING", "pid": child.pid, "argv": argv}
                    launch_checkpoint_error = None
                    try:
                        save()
                    except OSError as error:
                        # PREPARED is already durable. A journal-full condition
                        # must not terminate the launched original browser/MCP
                        # owner before its own finally blocks drain resources.
                        launch_checkpoint_error = error
                        state["child"]["checkpoint_error"] = {"code": type(error).__name__, "errno": error.errno}
                    code = child.wait()
                    state["child"].update(state="EXITED", returncode=code)
                    save()
                    if launch_checkpoint_error is not None:
                        raise launch_checkpoint_error
                    if code != 0:
                        fail("ORIGINAL_AGENT_RECEIVING_INCOMPLETE")
                node_record = parse(read(root / "agent" / "result.json", 32 * 1024 * 1024))
                if node_record.get("complete") is not True or node_record.get("workspace_id") != args.workspace_id:
                    fail("ORIGINAL_AGENT_RESULT_INCOMPLETE")
                state["node_result"] = node_record
                save()
                phase("browser_and_agent_receiving", {"record": "agent/result.json",
                      "pair_id": node_record["pair_id"], "report_id": node_record["report_id"],
                      "export_id": node_record["export_id"], "download": node_record["download"]})
            if server is not None:
                server.shutdown()
                thread.join()
                server.server_close()
                server, thread = None, None
                phase("original_python_host_closed", {"closed": True})
            node_record = state["node_result"]
            if "portable" not in state:
                package = root / "agent" / "received"
                inspected = inspect_package(package, expected_manifest_sha256=node_record["download"]["manifestSha256"])
                phase("complete_original_package_verified", {"files": len(inspected["files"]),
                      "bytes": inspected["bytes"], "manifest_sha256": inspected["manifest_sha256"]})
                received = receive_package(package, root / "portable-customer",
                    expected_manifest_sha256=inspected["manifest_sha256"], expected_workspace_id=args.workspace_id)
                repeated = receive_package(package, root / "portable-customer",
                    expected_manifest_sha256=inspected["manifest_sha256"], expected_workspace_id=args.workspace_id)
                if not received["complete"] or not repeated["reused"]:
                    fail("PORTABLE_REOPEN_INCOMPLETE")
                with DuckDBWorkspace(root / "portable-customer") as reopened:
                    model = Reconciliation(reopened)
                    report = model.report(node_record["report_id"])
                    if report != inspected["report"]:
                        fail("PORTABLE_REPORT_CHANGED")
                    reexport = reopened.export_query(report["queries"][0]["query_id"], root / "portable-query-export",
                        expected_revision=report["queries"][0]["revision"], expected_views=reopened.views(),
                        retained_query={key: value for key, value in report["queries"][0].items() if key != "kind"})
                state["portable"] = {"receiving": received, "reopened": repeated,
                    "query_export_id": reexport["export_id"], "rows": reexport["rows"],
                    "manifest_sha256": inspected["manifest_sha256"]}
                save()
                phase("portable_customer_reopened", state["portable"])
            state["preserved"] = _preserved(workspace, state["baseline"])
            workspace.close()
            workspace = None
            state.update(complete=True, completed_at=_now(), source_operations=0, purchases=0,
                         all_owned_handles_closed=True)
            save()
            return state
        except BaseException as error:
            state["complete"] = False
            state["last_error"] = {"code": getattr(error, "code", type(error).__name__), "at": _now()}
            try:
                save()
            except BaseException:
                pass
            raise
        finally:
            # Close actual owned processes even if journal/log storage is full.
            if child is not None and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            if server is not None:
                if thread is not None and thread.is_alive():
                    server.shutdown()
                    thread.join()
                server.server_close()
            if workspace is not None:
                workspace.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--native-workspace", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chromium", required=True)
    parser.add_argument("--source-edition")
    parser.add_argument("--target-edition")
    parser.add_argument("--expected-rows", type=int, default=4)
    args = parser.parse_args(argv)
    result = run(args)
    print(_json({"complete": result["complete"], "record": str(_path(args.directory) / "native-result.json"),
                 "operation_id": OPERATION, "workspace_id": args.workspace_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
