#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Continue the original parcel operation with a named frozen-portfolio comparison."""
from __future__ import annotations
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("starforge_parcel_comparison_journey", ROOT / "parcel-native-receiving.py")
journey = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = journey
spec.loader.exec_module(journey)
from starforge_stac.parcels.comparison import definition, get as get_comparison
from starforge_stac.parcels.portfolio import get as get_portfolio
from starforge_stac.parcels.workspace import ParcelWorkspace

SCHEMA = "starforge.parcel-comparison-receiving.v1"

class ComparisonPhase(journey.Operation):
    def __init__(self, parent, selected):
        self.parent = parent
        self.selected = copy.deepcopy(selected)
        self.phase_id = journey.value_sha(selected)
        self.root = parent.root / "portfolio-comparisons" / self.phase_id
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.actor, self.timeout = parent.actor, parent.timeout
        self.config = copy.deepcopy(parent.config)
        self.runtime_file, self.browser_file = parent.runtime_file, parent.browser_file
        self.current_phase = "retained-portfolio-comparison"
        self.original("definition", selected)
    def identity(self, name):
        return self.parent.identity("comparison-" + self.phase_id + "-" + name)

def preserve_history(workspace, before):
    after = workspace.snapshot()
    journey.ensure(after["state"]["id"] == before["state"]["id"], "Continue the original workspace.")
    journey.ensure(after["events"][:len(before["events"])] == before["events"],
                   "Comparison changed an earlier domain event.")
    for key in ("requests", "analystRequests"):
        old = before.get(key, [])
        new = after.get(key, [])
        if old and "requestId" in old[0]:
            indexed = {row["requestId"]: row for row in new}
            journey.ensure(all(indexed.get(row["requestId"]) == row for row in old),
                           "Comparison changed an original retained request.")
        else:
            journey.ensure(new[:len(old)] == old, "Comparison changed original request history.")
    for collection in ("editions", "entities", "reviews", "portfolios", "successors", "maps", "comparisons"):
        indexed = {row["id"]: row for row in after["state"]["parcels"].get(collection, [])}
        journey.ensure(all(indexed.get(row["id"]) == row for row in before["state"]["parcels"].get(collection, [])),
                       "Comparison changed an earlier parcel register: " + collection)
    for record in workspace.project_files(before):
        journey.file_digest(workspace.root / record["path"], expected=record)
    return after

def run(args):
    operation_root = Path(args.operation_root).expanduser().absolute()
    original = journey.read_json(operation_root / "inputs" / "operation.json")
    journey.ensure(original["operationId"] == args.operation_id and original["actor"] == args.actor,
                   "Use the original operation ID and responsible analyst.")
    selected = definition(journey.read_json(Path(args.definition_file).expanduser().absolute()))
    initial = SimpleNamespace(output=str(operation_root), actor=args.actor, operation_timeout=args.operation_timeout,
        operation_id=args.operation_id, expected_manifest_sha256=original["sourceManifestSha256"],
        native_runtime_file=args.native_runtime_file, browser_config=args.browser_config)
    with journey.Operation(initial) as parent:
        phase = ComparisonPhase(parent, selected)
        try:
            workspace = journey.QgisWorkspace(original["workspaceDirectory"])
            parcel = ParcelWorkspace(workspace)
            left_record, left = get_portfolio(parcel, selected["leftPortfolioId"])
            right_record, right = get_portfolio(parcel, selected["rightPortfolioId"])
            before_path = phase.root / "inputs" / "before-comparison.json"
            before = journey.read_json(before_path) if before_path.exists() else phase.original("before-comparison", workspace.snapshot())
            preserve_history(workspace, before)
            phase.original("original-portfolios", {"left": left, "right": right})
            review = journey.read_json(operation_root / "inputs" / "browser-review.json")
            # Both frozen portfolios remain in the original workspace. The browser's source
            # walkthrough uses the original reviewed edition while the comparison selects its own pair.
            original_portfolio = next(row for row in before["state"]["parcels"]["portfolios"]
                                      if row["editionId"] == review["editionId"])
            original_value = get_portfolio(parcel, original_portfolio["id"])[1]
            context = {"editionId": review["editionId"], "review": review,
                       "sourceManifestSha256": review["editionId"], "keys": original_value["selectedKeys"],
                       "portfolioId": original_portfolio["id"]}
            with journey.Listener(phase, "primary", workspace.root, ROOT, args.native_runtime_file) as listener:
                preview = listener.parcel("pair-preview", "comparison.preview", {"definition": selected})["result"]
                saved = listener.parcel("pair-save", "comparison.create", {
                    "definition": selected, "previewSha256": preview["previewSha256"]})["result"]["comparison"]
                exact_request = journey.read_json(phase.root / "requests" / "primary-pair-save.json")
                replay = listener.post("/api/operations", exact_request)
                journey.ensure(replay["status"] == "COMPLETED" and replay["result"]["comparison"] == saved,
                               "The same original comparison request returned another result.")
                record, value = get_comparison(parcel, saved["id"])
                journey.ensure(value["summary"] == preview["summary"] and value["previewSha256"] == preview["previewSha256"],
                               "Saved comparison differs from the complete preview.")
                pages = []
                for offset in range(0, len(value["rows"]), 50):
                    response = listener.get("/api/parcels/comparison?" + urlencode({
                        "comparisonId": saved["id"], "offset": offset, "limit": 50}))
                    pages.extend(response["rows"])
                journey.ensure(pages == value["rows"], "Comparison pages changed original rows or ordering.")
                for file in record["files"]:
                    name = Path(file["path"]).name
                    listener.download("/download/parcels/comparisons/" + saved["id"] + "/" + name,
                                      phase.root / "downloads" / name, file)
                browser = phase.browser("primary", listener, {
                    **context, "mode": "domain-receiving", "portfolioComparisonId": saved["id"],
                    "portfolioComparisonDefinition": selected, "comparisonCreateFromUI": True})
                # The browser creates an independently named comparison through the same visible
                # preview/save controls. Its retained request is part of the complete project.
                preserve_history(workspace, before)
                exported = listener.call("complete-comparison-export", "project.export", {
                    "directory": str(phase.root / "archives" / "complete")})
                archive = phase.root / "downloads" / "complete-compared-project.zip"
                listener.download("/download/operations/" + exported["requestId"] + "/project", archive, exported["result"])
                received = journey.receive_reviewed_domain(phase, listener, workspace, exported, archive, {
                    **context, "portfolioComparisonId": saved["id"],
                    "portfolioComparisonDefinition": selected, "comparisonCreateFromUI": False})
            preserve_history(workspace, before)
            recipient = journey.QgisWorkspace(received["receivedWorkspace"])
            received_record, received_value = get_comparison(ParcelWorkspace(recipient), saved["id"])
            journey.ensure(received_record == record and received_value == value,
                           "Independent receiving changed the complete comparison.")
            result = {"schema": SCHEMA, "status": "COMPLETED", "operationId": args.operation_id,
                "workspaceId": workspace.read()["id"], "comparisonId": saved["id"],
                "previewSha256": saved["previewSha256"], "summary": value["summary"],
                "browser": browser, "receiving": received,
                "files": [journey.public_file(path) for path in sorted((phase.root / "downloads").rglob("*")) if path.is_file()]}
            phase.record("completed", result)
            journey.write_json(phase.root / "result.json", result)
            return result, phase.root
        except Exception as error:
            phase.record("continuation", {"schema": SCHEMA, "operationId": args.operation_id,
                "phase": phase.current_phase, "error": type(error).__name__, "message": str(error), "at": journey.now()})
            raise

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation-root", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--definition-file", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--browser-config", required=True)
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--operation-timeout", type=int, default=1800)
    args = parser.parse_args(argv)
    journey.ensure(30 <= args.operation_timeout <= 3600, "Use a 30–3600 second original operation wait.")
    result, root = run(args)
    print(json.dumps({"status": result["status"], "result": str(root / "result.json"),
                      "comparisonId": result["comparisonId"]}), flush=True)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(2)
