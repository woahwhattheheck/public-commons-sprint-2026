#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Receive a complete later parcel edition into the original reviewed project.

This programme continues parcel-native-receiving.py's existing operation and
workspace. It retains a distinct phase named by the original successor manifest,
uses the original analyst journal and closes every original input, decision,
portfolio and request through independent receiving.
"""
from __future__ import annotations
import argparse
import copy
import gc
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import urlencode
import zipfile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("starforge_parcel_original_receiving", ROOT / "parcel-native-receiving.py")
journey = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = journey
spec.loader.exec_module(journey)
from starforge_stac.parcels.review import decision_input

SCHEMA = "starforge.parcel-successor-receiving.v1"


class SuccessorPhase(journey.Operation):
    def __init__(self, original, source_sha):
        self.parent = original
        self.root = original.root / "successors" / source_sha
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.actor, self.timeout = original.actor, original.timeout
        self.config = copy.deepcopy(original.config)
        self.runtime_file, self.browser_file = original.runtime_file, original.browser_file
        self.source_sha = source_sha
        self.current_phase = "source-validation"
        self.original("successor", {"schema": SCHEMA, "operationId": self.config["operationId"],
            "originalManifestSha256": self.config["sourceManifestSha256"],
            "successorManifestSha256": source_sha, "actor": self.actor,
            "workspaceDirectory": self.config["workspaceDirectory"]})

    def identity(self, name):
        return self.parent.identity("successor-" + self.source_sha + "-" + name)


def assert_original_history(workspace, before):
    current = workspace.snapshot()
    journey.ensure(current["state"]["id"] == before["state"]["id"], "Keep the original reviewed workspace.")
    journey.ensure(current["events"][:len(before["events"])] == before["events"],
                   "The successor changed an original domain event.")
    for collection, key in (("requests", "requestId"), ("analystRequests", "requestId")):
        # Native domain request records use their own original request ID field.
        old = before.get(collection, [])
        new = current.get(collection, [])
        if old and key not in old[0]:
            journey.ensure(new[:len(old)] == old, "The successor changed original request history.")
        else:
            indexed = {row[key]: row for row in new}
            journey.ensure(all(indexed.get(row[key]) == row for row in old),
                           "The successor changed an original retained request.")
    original_parcels = before["state"].get("parcels", {})
    current_parcels = current["state"].get("parcels", {})
    for collection in ("editions", "entities", "reviews", "portfolios", "successors", "maps"):
        indexed = {row["id"]: row for row in current_parcels.get(collection, [])}
        journey.ensure(all(indexed.get(row["id"]) == row for row in original_parcels.get(collection, [])),
                       "The successor altered the earlier parcel register: " + collection)
    for record in workspace.project_files(before):
        journey.file_digest(workspace.root / record["path"], expected=record)
    return current


def select_source_owner(listener, phase, edition, original_review):
    key = original_review["key"]
    def decisions():
        detail = listener.get("/api/parcels/detail?" + urlencode({"editionId": edition, "key": key}))
        candidates = [claim for claim in detail["parcel"]["claims"]
                      if claim["kind"] == "owner-assertion" and claim["field"] == "owner"]
        journey.ensure(len(candidates) == 1,
                       "Review the later edition's exact City owner assertion when its source records conflict.")
        choice = decision_input(detail["parcel"], detail["decision"])
        choice["owner"] = {"mode": "source", "claimId": candidates[0]["id"]}
        choice["accountable"] = {"mode": "unassigned"}
        choice["reason"] = original_review["reason"]
        return {"editionId": edition, "decisions": [choice]}
    preview = listener.parcel("named-owner-preview", "review.preview", decisions)
    # Read the exact retained request rather than regenerate a decision after a retry.
    selected = preview["input"]["payload"]["payload"]["decisions"]
    saved = listener.parcel("named-owner-save", "review.save", {
        "editionId": edition, "decisions": selected, "previewSha256": preview["result"]["previewSha256"]})
    detail = listener.get("/api/parcels/detail?" + urlencode({"editionId": edition, "key": key}))
    claim_id = selected[0]["owner"]["claimId"]
    journey.ensure(detail["decision"]["owner"]["claim"]["id"] == claim_id and
                   detail["decision"]["accountable"]["mode"] == "unassigned",
                   "The later review changed the original explicit responsibility choice.")
    return phase.original("browser-review", {"editionId": edition, "key": key,
        "ownerClaimId": claim_id, "reason": original_review["reason"]})


def native_receiving(phase, listener, workspace, mapped, context, runtime):
    asset = workspace.source(mapped["source"]["id"]).asset_rows()[0]
    inspection = listener.call("inspect-native-parcels", "map.inspect", {
        "sourceId": mapped["source"]["id"], "collection": asset["collection"],
        "itemId": asset["itemId"], "assetKey": asset["assetKey"]})["result"]
    project = listener.call("save-native-map", "map.save", {"projectCrs": "EPSG:4326"})["result"]["project"]
    rendered = listener.call("render-native-map", "map.render", {
        "projectId": project["id"], "width": 1400, "height": 900})
    listener.download("/download/operations/" + rendered["requestId"] + "/files/0",
                      phase.root / "downloads" / "full-cohort-native-map.png", rendered["result"]["file"])
    features = listener.call("read-native-features", "map.features", {
        "projectId": project["id"], "layerId": mapped["layer"]["id"], "offset": 0, "limit": 100})["result"]
    journey.ensure(int(features["nativeFeatureCount"]) == mapped["source"]["summary"]["features"],
                   "The native feature count differs from the exact selected original geometries.")
    exported = listener.call("complete-native-export", "project.export",
                             {"directory": str(phase.root / "archives" / "native")})
    archive = phase.root / "downloads" / "full-cohort-native-project.zip"
    listener.download("/download/operations/" + exported["requestId"] + "/project", archive, exported["result"])
    with zipfile.ZipFile(archive) as carrier:
        snapshot = json.loads(carrier.read("workspace-snapshot.json"))
    phase.original("native-receiving-snapshot", snapshot)
    destination = phase.root / "received-native"
    received = listener.call("receive-native-project", "project.receive", {
        "file": str(archive), "destination": str(destination),
        "expectedSha256": exported["result"]["sha256"]})["result"]
    original_request = journey.read_json(phase.root / "requests" / "primary-receive-native-project.json")
    replay = listener.post("/api/operations", original_request)
    journey.ensure(replay["status"] == "COMPLETED" and replay["result"] == received,
                   "The original native receiving request returned another receipt.")
    recipient = journey.QgisWorkspace(destination)
    current = recipient.snapshot()
    for key in ("schema", "state", "events", "requests"):
        journey.ensure(current.get(key) == snapshot.get(key), "Native receiving changed the original project.")
    original_requests = {row["requestId"]: row for row in snapshot.get("analystRequests", [])}
    actual_requests = {row["requestId"]: row for row in current.get("analystRequests", [])}
    allowed = {phase.identity("received-native-" + name) for name in
               ("reopen", "render", "features")}
    journey.ensure(all(actual_requests.get(key) == value for key, value in original_requests.items()) and
                   set(actual_requests) - set(original_requests) <= allowed,
                   "The received workspace lost an original analyst request.")
    for record in recipient.project_files(current):
        journey.file_digest(destination / record["path"], expected=record)
    with journey.Listener(phase, "received-native", destination, destination / "software", runtime) as receiver:
        reopened = receiver.call("reopen", "map.reopen", {"projectId": project["id"]})["result"]
        rendered_again = receiver.call("render", "map.render",
                                      {"projectId": project["id"], "width": 1400, "height": 900})
        receiver.download("/download/operations/" + rendered_again["requestId"] + "/files/0",
                          phase.root / "downloads" / "received-full-cohort-map.png", rendered_again["result"]["file"])
        features_again = receiver.call("features", "map.features", {
            "projectId": project["id"], "layerId": mapped["layer"]["id"], "offset": 0, "limit": 100})["result"]
        journey.ensure(features_again["fields"] == features["fields"] and features_again["rows"] == features["rows"],
                       "The independent native map changed its original parcel attributes.")
        browser = phase.browser("received-native", receiver, {**context, "mode": "receiving",
            "projectId": project["id"], "mapRequestId": rendered_again["requestId"]})
    journey.ensure(recipient.read() == snapshot["state"] and recipient.history() == snapshot["events"],
                   "The recipient inspection changed the original domain history.")
    return phase.record("native-receiving", {"status": "COMPLETED", "inspection": inspection,
        "projectId": project["id"], "nativeFeatureCount": features["nativeFeatureCount"],
        "archive": journey.public_file(archive), "receipt": received["receipt"],
        "receivedWorkspace": str(destination), "reopened": reopened, "browser": browser})


def run(args):
    operation_root = Path(args.operation_root).expanduser().absolute()
    original = journey.read_json(operation_root / "inputs" / "operation.json")
    journey.ensure(original["operationId"] == args.operation_id and original["actor"] == args.actor,
                   "Continue the same original application and responsible analyst.")
    initial_args = SimpleNamespace(output=str(operation_root), actor=args.actor,
        operation_timeout=args.operation_timeout, operation_id=args.operation_id,
        expected_manifest_sha256=original["sourceManifestSha256"],
        native_runtime_file=args.native_runtime_file, browser_config=args.browser_config)
    with journey.Operation(initial_args) as parent:
        completed = journey.read_json(operation_root / "result.json")
        journey.ensure(completed.get("status") in ("PARCEL_RECEIVING_COMPLETED", "COMPLETED") and
                       completed["operationId"] == args.operation_id,
                       "Finish the existing source/review/portfolio receiving before its later edition.")
        phase = SuccessorPhase(parent, args.expected_manifest_sha256)
        try:
            workspace = journey.QgisWorkspace(original["workspaceDirectory"])
            journey.ensure(workspace.read()["id"] == completed["workspaceId"],
                           "The continuation selected another reviewed workspace.")
            before_file = phase.root / "inputs" / "before-successor-snapshot.json"
            if before_file.exists():
                before = journey.read_json(before_file)
            else:
                before = workspace.snapshot()
                phase.original("before-successor-snapshot", before)
            assert_original_history(workspace, before)
            source_directory = Path(args.source_directory).expanduser().absolute()
            intake = journey.ParcelIntake(source_directory, args.expected_manifest_sha256)
            phase.progress("complete-source-validation")
            prepared = intake.prepare(progress=lambda value: phase.progress(**value))
            keys = [row["key"] for row in prepared["rows"]]
            summary = prepared["summary"]
            journey.ensure(keys == sorted(keys) and len(keys) == len(set(keys)) and keys,
                           "Retain the complete distinct original successor cohort.")
            phase.original("source-summary", {"manifestSha256": intake.id, "summary": summary})
            del prepared
            gc.collect()
            manifest, source_files = journey.complete_files(source_directory)
            original_review = journey.read_json(operation_root / "inputs" / "browser-review.json")
            previous = args.previous_edition_id or before["state"]["parcels"]["activeEditionId"]
            journey.ensure(any(row["id"] == previous for row in before["state"]["parcels"]["editions"]),
                           "Select a predecessor edition retained in the original project.")
            phase.original("predecessor", {"editionId": previous})
            left = previous
            with journey.Listener(phase, "primary", workspace.root, ROOT, args.native_runtime_file) as listener:
                uploaded = listener.upload("complete-successor", source_directory, source_files)
                preview = listener.parcel("source-preview", "source.preview", {
                    "directory": uploaded["directory"], "expectedManifestSha256": intake.id})["result"]
                right = listener.parcel("source-import", "source.import", {
                    "directory": uploaded["directory"], "expectedManifestSha256": intake.id,
                    "previewSha256": preview["previewSha256"]})["result"]["editionId"]
                comparison = listener.parcel("compare", "successor.compare",
                    {"leftEditionId": left, "rightEditionId": right})["result"]
                successor = listener.parcel("review-successor", "successor.review", {"definition": {
                    "leftEditionId": left, "rightEditionId": right,
                    "comparisonSha256": comparison["comparisonSha256"],
                    "unchanged": "carry-reviewed", "changed": "leave-unreviewed", "removed": "retain-history",
                    "note": "Receive the complete original source cohort; carry only unchanged reviewed facts, and review changed or added records from their exact current captures."}})["result"]
                for offset in range(0, len(keys), 1000):
                    batch = keys[offset:offset + 1000]
                    journey.save_batch(listener, "review-" + str(offset).zfill(6), right, batch)
                rows = journey.all_rows(listener, right)
                journey.ensure(len(rows) == len(keys) and all(row["decision"] for row in rows),
                               "Every selected key must retain its explicit review, including unresolved source claims.")
                del rows
                review = select_source_owner(listener, phase, right, original_review)
                portfolios = []
                for basis, title in (
                    ("county-assessed", "Complete original County assessed portfolio"),
                    ("local-assessed", "Complete original municipal and school assessed portfolio"),
                    ("base-year-2012-appraisal", "Complete original 2012 base-year appraisal portfolio")):
                    portfolios.append(journey.save_portfolio(listener, "portfolio-" + basis,
                        journey.portfolio_definition(right, keys, title, basis)))
                selected = portfolios[0]
                mapped = listener.parcel("map-source", "map.publish", {"portfolioId": selected["id"]})["result"]
                listener.call("save-map-layer", "layers.save", lambda: {
                    "layers": [*workspace.read()["layers"], mapped["layer"]]})
                context = {"editionId": right, "keys": keys, "review": review,
                           "sourceManifestSha256": intake.id, "portfolioId": selected["id"]}
                browser = phase.browser("primary", listener, {**context, "mode": "domain-receiving"})
                assert_original_history(workspace, before)
                exported = listener.call("complete-domain-export", "project.export",
                                         {"directory": str(phase.root / "archives" / "domain")})
                archive = phase.root / "downloads" / "full-cohort-reviewed-project.zip"
                listener.download("/download/operations/" + exported["requestId"] + "/project", archive, exported["result"])
                domain = journey.receive_reviewed_domain(phase, listener, workspace, exported, archive, context)
                native = native_receiving(phase, listener, workspace, mapped, context, args.native_runtime_file) if args.native_runtime_file else None
            assert_original_history(workspace, before)
            result = {"schema": SCHEMA, "status": "COMPLETED" if native else "PARCEL_RECEIVING_COMPLETED",
                "completedAt": journey.now(), "operationId": args.operation_id,
                "workspaceId": workspace.read()["id"], "revision": workspace.read()["revision"],
                "originalManifestSha256": original["sourceManifestSha256"], "previousEditionId": left,
                "sourceManifestSha256": intake.id,
                "sourceSummary": summary, "successor": successor, "portfolioIds": [row["id"] for row in portfolios],
                "browser": browser, "domainReceiving": domain, "nativeReceiving": native,
                "files": [journey.public_file(path) for path in sorted((phase.root / "downloads").rglob("*")) if path.is_file()],
                "nativeContinuation": {"phase": "original-qgis-map", "portfolioId": selected["id"],
                    "reviewedSourceId": mapped["source"]["id"], "layerId": mapped["layer"]["id"],
                    "inputArchive": domain["archive"]}}
            phase.record("completed", result)
            journey.write_json(phase.root / "result.json", result)
            phase.progress("complete-successor-receiving", workspaceId=result["workspaceId"],
                           revision=result["revision"], selectedKeys=summary["selectedKeys"])
            return result, phase.root
        except Exception as error:
            phase.record("continuation", {"schema": SCHEMA, "operationId": args.operation_id,
                "phase": phase.current_phase, "at": journey.now(),
                "error": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation-root", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--source-directory", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    parser.add_argument("--previous-edition-id", help="Defaults to the active edition frozen before this successor phase.")
    parser.add_argument("--actor", required=True)
    parser.add_argument("--browser-config", required=True)
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--operation-timeout", type=int, default=1800)
    args = parser.parse_args(argv)
    journey.ensure(30 <= args.operation_timeout <= 3600, "Choose a 30–3,600 second original request wait.")
    result, root = run(args)
    print(json.dumps({"status": result["status"], "result": str(root / "result.json"),
                      "workspaceId": result["workspaceId"]}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(2)
