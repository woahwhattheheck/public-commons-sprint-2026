"""Receive an existing complete Timescale report into the original customer.

The original Python service, native MCP owner and visible operator controls form
one retained operation. PostgreSQL capture/refresh, purchases and a second SQL
engine are outside this program. It requires the actual complete report and an
existing customer warehouse; it never manufactures replacement source rows.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import os
from pathlib import Path
import re
import subprocess
import sys
import threading

from ..duckdb_dataset import DuckDBWorkspace, _json, _now
from ..duckdb_http import serve
from ..duckdb_semantics import _file_bytes
from ..errors import StateError
from ..storage import dump, lock, parse, private_directory, read, digest
from ..reconciliation.model import Reconciliation
from ..reconciliation.package import inspect_package, receive_package, _path
from ..reconciliation.receiving import _baseline
from .model import TimescaleIntake, report_bytes, report_guide_bytes
from .source import (CommissioningReport, MAX_REPORT, fail, need, fields, request_id,
                     hash_id, filename, interpretation, read_original, uuid)

SCHEMA = "stellar-forge.duckdb-timescale-intake.native-receiving.v1"


def _input(path):
    raw = read_original(path, 2 * 1024 * 1024)
    value = parse(raw)
    fields(value, ("operation_id", "source_commit", "source_root", "workspace", "workspace_id",
                   "native_workspace", "report", "baseline", "observed", "pair", "actor", "reason"))
    need(isinstance(value["operation_id"], str) and 0 < len(value["operation_id"]) <= 240,
         "RECEIVING_OPERATION_REQUIRED")
    need(isinstance(value["source_commit"], str) and re.fullmatch(r"[0-9a-f]{40}", value["source_commit"]),
         "RECEIVING_SOURCE_COMMIT_REQUIRED")
    request_id(value["workspace_id"])
    for key in ("source_root", "workspace", "native_workspace"):
        value[key] = str(_path(value[key]))
    fields(value["report"], ("path", "sha256", "filename"))
    value["report"]["path"] = str(_path(value["report"]["path"]))
    hash_id(value["report"]["sha256"]); filename(value["report"]["filename"])
    need(Path(value["report"]["path"]).name == value["report"]["filename"], "ORIGINAL_FILENAME_CHANGED")
    for key in ("baseline", "observed"):
        selected = value[key]
        fields(selected, ("source_id", "columns", "interpretation"), ("keys",))
        uuid(selected["source_id"])
        need(isinstance(selected["columns"], list) and selected.get("keys", []) == [],
             "COMPLETE_MAPPING_WITH_DUPLICATES_REQUIRED")
        selected["keys"] = []
        for column in selected["columns"]:
            fields(column, ("source", "name", "type", "nullable"))
            need(all(isinstance(column[key], str) and bool(column[key]) for key in ("source", "name", "type"))
                 and type(column["nullable"]) is bool, "COMPLETE_MAPPING_REQUIRED")
        names = [column["source"] for column in selected["columns"]]
        selected["interpretation"] = interpretation(selected["interpretation"], names)
        meanings = {column["source"]: column for column in selected["interpretation"]["columns"]}
        selected["interpretation"]["columns"] = [meanings[name] for name in names]
    need(value["baseline"]["source_id"] != value["observed"]["source_id"], "TWO_ORIGINAL_SOURCES_REQUIRED")
    fields(value["pair"], ("name", "label", "columns"), ("window_column", "windows", "notes"))
    need(isinstance(value["pair"]["columns"], list), "PAIR_MAPPING_REQUIRED")
    value["pair"].setdefault("window_column", None)
    value["pair"].setdefault("windows", [])
    value["pair"].setdefault("notes", "")
    for column in value["pair"]["columns"]:
        need(isinstance(column, dict) and isinstance(column.get("meaning"), str)
             and bool(column["meaning"].strip()), "EXPLICIT_PAIR_MEANING_REQUIRED")
        column.setdefault("source_map", [])
        column.setdefault("target_map", [])
        need(column["source_map"] == column["target_map"] == [], "INTAKE_PAIR_PRESERVES_NATIVE_VALUES")
    for key in ("actor", "reason"):
        need(isinstance(value[key], str) and bool(value[key].strip()), "REVIEWER_AND_REASON_REQUIRED")
    return raw, value


def _original_report(workspace, binding):
    selected = binding["report"]
    try:
        raw, record = report_bytes(workspace, selected["sha256"],
                                   expected_workspace_id=binding["workspace_id"])
        need(record["filename"] == selected["filename"], "ORIGINAL_FILENAME_CHANGED")
    except StateError as error:
        if error.code != "DUCKDB_TIMESCALE_REPORT_NOT_FOUND":
            raise
        raw = read_original(selected["path"])
    return CommissioningReport(raw, selected["sha256"])


def _source_contract(report, binding):
    result = {}
    for name, role in (("baseline", "BASELINE"), ("observed", "OBSERVED")):
        selected = binding[name]
        native = report.source(selected["source_id"])
        descriptor, table = native["descriptor"], native["table"]
        need(descriptor["role"] == role and len(table["rows"]) > 0, "NONEMPTY_BASELINE_AND_OBSERVED_REQUIRED")
        names = table["names"]
        interpretation(selected["interpretation"], names)
        columns = selected["columns"]
        need(len(columns) == len(names) and all(isinstance(item, dict) for item in columns)
             and [item.get("source") for item in columns] == names,
             "EVERY_ORIGINAL_FIELD_REQUIRED")
        result[name] = {"source_id": selected["source_id"], "role": role, "rows": len(table["rows"]),
                        "filename": descriptor["filename"], "bytes": descriptor["bytes"],
                        "sha256": descriptor["sha256"], "table_name": descriptor.get("tableName"),
                        "table_digest": descriptor["tableDigest"], "columns": table["columns"],
                        "contract_revision": descriptor["contractRevision"],
                        "provider_completeness": table["provider_completeness"]}
    return result


def _preserved(workspace, baseline):
    """New reviewed editions/reports are allowed; original history stays exact."""
    after = _baseline(workspace)
    current = {record["edition_id"]: record for record in after["editions"]}
    need(all(current.get(record["edition_id"]) == record for record in baseline["editions"]),
         "ORIGINAL_CUSTOMER_EDITION_CHANGED")
    need(after["views"] == baseline["views"], "ORIGINAL_CUSTOMER_SELECTION_CHANGED")
    current = {record["query_id"]: record for record in after["queries"]}
    need(all(current.get(record["query_id"]) == record for record in baseline["queries"]),
         "ORIGINAL_CUSTOMER_RECIPE_CHANGED")
    for table, rows in baseline["histories"].items():
        retained = {(row.get("id") or row.get("name"), row["revision"]): row for row in after["histories"][table]}
        need(all(retained.get((row.get("id") or row.get("name"), row["revision"])) == row for row in rows),
             "ORIGINAL_CUSTOMER_HISTORY_CHANGED")
    return {"original_editions": len(baseline["editions"]), "original_views": len(baseline["views"]),
            "original_queries": len(baseline["queries"]), "original_history_preserved": True,
            "current_editions": len(after["editions"])}


def _retained_editions(workspace, binding, agent):
    """Verify every original source byte and native review link after reopening."""
    report = _original_report(workspace, binding)
    guide = report_guide_bytes(workspace, report.sha256)
    result = {}
    for name, role in (("baseline", "BASELINE"), ("observed", "OBSERVED")):
        identity = hash_id(agent["intake"][name + "_edition"])
        edition = workspace.edition(identity)
        with workspace._guard(), workspace._connection() as db:
            review = workspace._record(db, "sf_reviews", identity)
            need(edition["edition_id"] == identity and edition["review_id"] == identity
                 and review["review_id"] == identity and edition["manifest_sha256"] == review["manifest_sha256"]
                 and edition["columns"] == review["columns"] and edition["keys"] == review["keys"] == []
                 and edition["row_count"] == review["row_count"]
                 and edition["timescale_source"] == review["timescale_source"], "REVIEW_EDITION_BINDING_CHANGED")
            source = report.source(binding[name]["source_id"])
            context = edition["timescale_source"]
            need(context["report_id"] == report.sha256 and context["source_id"] == binding[name]["source_id"]
                 and context["role"] == role and context["descriptor"]["workspace_id"] == binding["workspace_id"]
                 and context["descriptor"]["report_filename"] == binding["report"]["filename"]
                 and context["native_sha256"] == source["descriptor"]["sha256"]
                 and context["table_digest"] == source["descriptor"]["tableDigest"]
                 and edition["row_count"] == len(source["table"]["rows"]), "IMPORTED_SOURCE_CHANGED")
            original = _file_bytes(db, identity, "original-commissioning.json", MAX_REPORT)
            selected = _file_bytes(db, identity, "original-source.json", MAX_REPORT)
            retained_guide = _file_bytes(db, identity, "TIMESCALE_INTAKE.md", 2 * 1024 * 1024)
            need(original == report.raw and selected == source["content"] and retained_guide == guide,
                 "PORTABLE_ORIGINAL_FILE_CHANGED")
            manifest = _file_bytes(db, identity, "manifest.json", 4 * 1024 * 1024)
            need(digest(manifest) == edition["manifest_sha256"], "PORTABLE_SOURCE_MANIFEST_CHANGED")
        result[name] = {"edition_id": identity, "review_id": identity, "rows": edition["row_count"],
                        "manifest_sha256": edition["manifest_sha256"], "native_sha256": context["native_sha256"],
                        "table_digest": context["table_digest"], "guide_sha256": digest(guide)}
    return result


def _portable(root, binding, agent):
    package = root / "agent" / "received"
    inspected = inspect_package(package, expected_manifest_sha256=agent["manifest_sha256"])
    need(inspected["manifest"]["report_id"] == agent["report_id"]
         and inspected["manifest"]["workspace_id"] == binding["workspace_id"], "PORTABLE_REPORT_CHANGED")
    destination = root / "portable-customer"
    received = receive_package(package, destination, expected_manifest_sha256=inspected["manifest_sha256"],
                               expected_workspace_id=binding["workspace_id"])
    repeated = receive_package(package, destination, expected_manifest_sha256=inspected["manifest_sha256"],
                               expected_workspace_id=binding["workspace_id"])
    need(received["complete"] and repeated["complete"] and repeated["reused"], "PORTABLE_REOPEN_INCOMPLETE")
    with DuckDBWorkspace(destination) as reopened:
        native = Reconciliation(reopened).report(agent["report_id"])
        need(native == inspected["report"], "PORTABLE_REPORT_CHANGED")
        editions = _retained_editions(reopened, binding, agent)
        recipe = next(item for item in native["queries"] if item["kind"] == "rows")
        exported = reopened.export_query(recipe["query_id"], root / "portable-query-export",
                     expected_revision=recipe["revision"], expected_views=reopened.views(),
                     retained_query={key: value for key, value in recipe.items() if key != "kind"})
        need(exported["state"] == "COMPLETE", "PORTABLE_QUERY_EXPORT_INCOMPLETE")
    return {"receiving": received, "reopened": repeated, "files": len(inspected["files"]),
            "bytes": inspected["bytes"], "manifest_sha256": inspected["manifest_sha256"],
            "editions": editions, "query_export_id": exported["export_id"], "query_rows": exported["rows"]}


def run(args):
    os.umask(0o077)
    original_input, binding = _input(args.input)
    root, customer, native_root, source_root = map(_path, (
        args.directory, binding["workspace"], binding["native_workspace"], binding["source_root"]))
    need((customer / "warehouse.duckdb").is_file() and (native_root / "native-workspace.json").is_file(),
         "EXISTING_CUSTOMER_AND_NATIVE_WORKSPACE_REQUIRED")
    executable = source_root / "stellar-forge/mcp-paid-agent/duckdb-timescale-receiving.mjs"
    need(executable.is_file(), "COMPLETE_SELECTED_SOURCE_REQUIRED")
    private_directory(root)
    journal = root / "native-result.json"
    with lock(root):
        state = parse(read(journal, 32 * 1024 * 1024)) if journal.exists() else {
            "schema": SCHEMA, "binding": binding, "input_sha256": digest(original_input),
            "created_at": _now(), "phases": []}
        need(state.get("schema") == SCHEMA and state.get("binding") == binding
             and state.get("input_sha256") == digest(original_input), "RECEIVING_BINDING_CHANGED")
        original_path = root / "receiving-input.json"
        from ..reconciliation.package import _retain
        _retain(original_path, original_input)
        previously_complete = state.get("complete") is True
        def save():
            dump(journal, state)
        def phase(name, result):
            state["phases"].append({"name": name, "completed_at": _now(), "result": result})
            save()
        server, thread, child, workspace = None, None, None, None
        try:
            workspace = DuckDBWorkspace(customer)
            need(workspace.duckdb.__version__ == "1.5.6", "NATIVE_DUCKDB_1_5_6_REQUIRED")
            need(workspace.identity()["workspace_id"] == binding["workspace_id"], "WORKSPACE_ID_CHANGED")
            report = _original_report(workspace, binding)
            original_sources = _source_contract(report, binding)
            if "baseline" not in state:
                state["baseline"] = _baseline(workspace)
                state["sources"] = original_sources
                state["runtime"] = {"python": sys.version, "duckdb": workspace.duckdb.__version__,
                                    "memory_limit": workspace.memory_limit, "threads": workspace.threads}
                save()
                phase("original_customer_and_commissioning_report_bound", {
                    "workspace_id": binding["workspace_id"], "report_sha256": report.sha256,
                    "report_bytes": len(report.raw), "sources": original_sources})
            need(state["sources"] == original_sources, "ORIGINAL_NATIVE_SOURCE_CHANGED")
            _preserved(workspace, state["baseline"])
            if "node_result" not in state:
                server, control, url = serve(workspace, port=state.get("python_port", 0),
                                            export_root=root / "exports", handoff_root=root / "handoffs")
                state["python_port"] = server.server_port
                state["listener"] = {"address": url.split("#", 1)[0], "workspace_id": binding["workspace_id"]}
                save()
                thread = threading.Thread(target=server.serve_forever, name="original-duckdb-timescale-intake", daemon=False)
                thread.start()
                native_input = {**deepcopy(binding), "launch_file": str(control),
                                "output_directory": str(root / "agent")}
                dump(root / "native-input.json", native_input)
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
                        # PREPARED is already durable. Let the owned MCP/browser
                        # finish its own cleanup before reporting storage failure.
                        launch_checkpoint_error = error
                        state["child"]["checkpoint_error"] = {"code": type(error).__name__, "errno": error.errno}
                    code = child.wait()
                    state["child"].update(state="EXITED", returncode=code)
                    save()
                    if launch_checkpoint_error is not None:
                        raise launch_checkpoint_error
                    need(code == 0, "ORIGINAL_AGENT_RECEIVING_INCOMPLETE")
                agent = parse(read(root / "agent" / "result.json", 32 * 1024 * 1024))
                need(agent.get("complete") is True and agent.get("workspace_id") == binding["workspace_id"]
                     and agent.get("binding") == binding and agent.get("all_owned_handles_closed") is True,
                     "ORIGINAL_AGENT_RESULT_INCOMPLETE")
                state["node_result"] = agent
                save()
                phase("visible_intake_and_complete_paired_customer_receiving", {
                    "record": "agent/result.json", "pair_id": agent["pair_id"], "report_id": agent["report_id"],
                    "export_id": agent["export_id"], "source_download": agent["report_download"],
                    "customer_download": agent["download"]})
            if server is not None:
                server.shutdown()
                thread.join()
                server.server_close()
                server, thread = None, None
                phase("original_python_owner_closed", {"closed": True})
            agent = state["node_result"]
            state["retained_editions"] = _retained_editions(workspace, binding, agent)
            state["portable"] = _portable(root, binding, agent)
            phase("complete_immutable_package_and_sparse_customer_reopened", state["portable"])
            state["preserved"] = _preserved(workspace, state["baseline"])
            workspace.close()
            workspace = None
            state.update(complete=True, completed_at=_now(), source_operations=0, purchases=0,
                         all_owned_handles_closed=True)
            save()
            return {**state, "reused": previously_complete}
        except BaseException as error:
            state["complete"] = previously_complete
            state["last_error"] = {"code": getattr(error, "code", type(error).__name__), "at": _now()}
            try:
                save()
            except BaseException:
                pass
            raise
        finally:
            # No outer timeout: the original browser/client owns its deadlines.
            # Process cancellation still closes this exact child and listener.
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
    parser.add_argument("--input", required=True, help="Private complete input JSON for the original report and mappings.")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chromium", required=True)
    args = parser.parse_args(argv)
    result = run(args)
    print(_json({"complete": result["complete"], "operation_id": result["binding"]["operation_id"],
                 "workspace_id": result["binding"]["workspace_id"],
                 "record": str(_path(args.directory) / "native-result.json")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
