#!/usr/bin/env python3
"""MIT. Receive and open the complete original programme on a private Linux workspace."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from programme import (
    HANDOVER, SOURCE_FILES, SHA, ProgrammeError, absolute, alias, check, digest, encoded, fields, identity,
    immutable_json, load_runtime, operation_lock, private_directory, read_json, relative,
)


def verify_bundle(bundle):
    bundle = absolute(bundle).resolve(strict=True)
    manifest_path = bundle / "HANDOVER.json"
    manifest_identity = identity(manifest_path)
    manifest = read_json(manifest_path)
    fields(manifest, ("schema", "operationId", "programme", "originalWorkspaceId", "iatiPath",
                      "runtimeSelection", "results", "selectedHeads", "publishing", "files", "resumedBuild"),
           ("schema", "operationId", "programme", "originalWorkspaceId", "iatiPath",
            "runtimeSelection", "results", "selectedHeads", "publishing", "files"), "complete handover")
    check(manifest["schema"] == HANDOVER, "Unsupported programme handover")
    check(isinstance(manifest["files"], dict) and manifest["files"], "The complete member inventory is missing")
    for name, selected in manifest["files"].items():
        relative(name)
        path = bundle / name
        check(path.resolve().is_relative_to(bundle), "A selected handover member leaves its directory")
        fields(selected, ("bytes", "sha256"), ("bytes", "sha256"), "member identity")
        check(identity(path) == selected, "A complete handover member differs: " + name)
    iati_relative = relative(manifest["iatiPath"])
    for name in ("programme.py", "START.py", "GUIDE.md", "LICENSE", "runtime-selection.json",
                 "programme-plan.json", "programme-result.json", "index.html",
                 iati_relative + "/iati_workspace.py", iati_relative + "/results/workspace.py"):
        check(name in manifest["files"], "The complete handover lacks " + name)
    check(isinstance(manifest["results"], list) and manifest["results"],
          "Select at least one complete original Results packet")
    check(isinstance(manifest["publishing"], list), "Original publisher packet inventory must be a list")
    packet_names = {"results": set(), "publishing": set()}
    for kind in ("results", "publishing"):
        for packet in manifest[kind]:
            name = alias(packet["alias"], "native packet alias")
            check(name not in packet_names[kind], "Duplicate native packet alias")
            packet_names[kind].add(name)
    for packet in manifest["results"] + manifest["publishing"]:
        path = relative(packet["path"])
        check(path in manifest["files"] and
              manifest["files"][path] == {"bytes": packet["bytes"], "sha256": packet["sha256"]},
              "Native packet differs from the complete handover selection")
    check(isinstance(manifest["selectedHeads"], list) and manifest["selectedHeads"],
          "Select the intended receiving head for every programme project")
    selected_projects = set()
    for head in manifest["selectedHeads"]:
        fields(head, ("project", "revision", "editionSha256", "alias"),
               ("project", "revision", "editionSha256", "alias"), "selected receiving head")
        check(head["project"] not in selected_projects, "Select one receiving head per original project")
        selected_projects.add(head["project"])
        check(any(all(row[key] == head[key] for key in ("project", "revision", "editionSha256", "alias"))
                  for row in manifest["results"]), "The intended head is not a complete selected packet")
    check(selected_projects == {row["project"] for row in manifest["results"]},
          "Every original programme project needs its intended receiving head")
    result = read_json(bundle / "programme-result.json")
    check(result["operationId"] == manifest["operationId"] and
          result["workspaceId"] == manifest["originalWorkspaceId"] and
          result["programme"] == manifest["programme"], "Programme selection differs from its original operation")
    check(set(result["editions"]) == {row["alias"] for row in manifest["results"]},
          "The handover omits a complete selected reporting edition")
    for row in manifest["results"]:
        original = result["editions"][row["alias"]]
        check((row["project"], row["revision"], row["editionSha256"]) ==
              (original["id"], original["revision"], original["sha256"]),
              "A native packet names a different programme edition")
    if "resumedBuild" in manifest:
        resumed = fields(manifest["resumedBuild"], ("build", "runtime", "operator"),
                         ("build", "runtime", "operator"), "resumed build")
        for name in ("resumed-build/BUILD.json", "resumed-build/runtime-selection.json"):
            check(name in manifest["files"], "The continued handover lacks " + name)
        check(resumed["build"] == manifest["files"]["resumed-build/BUILD.json"],
              "The continued handover changes its original build identity")
        previous = read_json(bundle / "resumed-build/BUILD.json")
        prior_runtime = read_json(bundle / "resumed-build/runtime-selection.json")
        check(previous.get("schema") == "tjlabs.pmel.handover-build.v1" and
              previous.get("operationId") == manifest["operationId"] and
              previous.get("result") == manifest["files"]["programme-result.json"] and
              previous.get("runtime") == resumed["runtime"] == digest(encoded(prior_runtime)) and
              previous.get("operator") == resumed["operator"],
              "The continued handover differs from its completed original programme or software basis")
        check(isinstance(resumed["operator"], dict) and set(resumed["operator"]) == set(SOURCE_FILES),
              "The original complete operator identity is missing")
        for name, selected in resumed["operator"].items():
            fields(selected, ("bytes", "sha256"), ("bytes", "sha256"), "original operator identity")
            check(type(selected["bytes"]) is int and selected["bytes"] > 0 and
                  isinstance(selected["sha256"], str) and SHA.fullmatch(selected["sha256"]),
                  "The original operator identity is invalid: " + name)
    return bundle, manifest, manifest_identity, result


def receive(bundle, workspace, existing=False):
    bundle, manifest, manifest_identity, original = verify_bundle(bundle)
    workspace = absolute(workspace)
    check(not workspace.is_relative_to(bundle) and not bundle.is_relative_to(workspace),
          "Keep the receiving workspace outside the complete delivered source")
    parent = private_directory(workspace.parent)
    marker = parent / ("." + workspace.name + ".programme-receiving.json")
    selected = {"schema": "tjlabs.pmel.receiving-selection.v1",
                "workspace": str(workspace), "handover": manifest_identity,
                "operationId": manifest["operationId"]}
    if workspace.exists() and not marker.exists():
        check(existing, "Use a new private workspace, the original receiving selection, or --existing-workspace")
    immutable_json(marker, selected)
    Workspace = load_runtime(bundle / manifest["iatiPath"])
    create = not workspace.exists()
    with Workspace(str(workspace), create=create) as ws:
        book = ws.root / "programme-receiving" / manifest_identity["sha256"]
        with operation_lock(book):
            immutable_json(book / "selection.json", selected)
            result = {"schema": "tjlabs.pmel.programme-received.v1",
                      "operationId": manifest["operationId"], "handover": manifest_identity,
                      "originalWorkspaceId": manifest["originalWorkspaceId"],
                      "workspaceId": ws.results.inventory()["workspaceId"],
                      "programme": manifest["programme"], "publishing": [], "results": []}
            for packet in manifest["publishing"]:
                path = book / ("publisher-" + packet["alias"] + ".json")
                if path.exists():
                    receipt = read_json(path)
                else:
                    receipt = ws.publishing.receive(bundle / packet["path"])
                    immutable_json(path, receipt)
                reopened = ws.publishing.project(packet["project"], packet["revision"])
                check(reopened["revision"] == packet["revision"],
                      "The original publisher edition did not reopen")
                result["publishing"].append({"project": packet["project"], "revision": packet["revision"],
                                             "packet": {"bytes": packet["bytes"], "sha256": packet["sha256"]},
                                             "receipt": receipt})
            selected_heads = {(row["project"], row["revision"], row["editionSha256"])
                              for row in manifest["selectedHeads"]}
            receiving_order = sorted(manifest["results"], key=lambda row:
                (row["project"], row["revision"], row["editionSha256"]) not in selected_heads)
            for packet in receiving_order:
                path = book / ("results-" + packet["alias"] + ".json")
                if path.exists():
                    receipt = read_json(path)
                else:
                    receipt = ws.results.receive(bundle / packet["path"],
                                                 expected_sha256=packet["sha256"],
                                                 expected_bytes=packet["bytes"])
                    immutable_json(path, receipt)
                reopened = ws.results.project(packet["project"], packet["revision"])
                check(reopened["sha256"] == packet["editionSha256"],
                      "The original reporting edition did not reopen")
                rebuilt = ws.results.report(packet["project"], packet["revision"])
                expected = original["editions"][packet["alias"]]["report"]
                check(rebuilt["report"]["reportSha256"] == expected["reportSha256"],
                      "The reopened native report differs from the selected original edition")
                result["results"].append({"alias": packet["alias"], "project": packet["project"],
                                          "revision": packet["revision"], "editionSha256": reopened["sha256"],
                                          "reportSha256": rebuilt["report"]["reportSha256"],
                                          "counts": rebuilt["report"]["counts"], "receipt": receipt})
            immutable_json(book / "result.json", result)
    # Close the original SQLite connection, then independently reopen and rebuild
    # all selected reports before announcing a usable receiving workspace.
    with Workspace(str(workspace)) as ws:
        for packet in manifest["results"]:
            rebuilt = ws.results.report(packet["project"], packet["revision"])
            check(rebuilt["edition"]["sha256"] == packet["editionSha256"],
                  "The original edition did not survive close and reopen")
    return {"workspace": str(workspace), "receipt": str(book / "result.json"),
            "operationId": manifest["operationId"], "programme": manifest["programme"],
            "editions": [{k: row[k] for k in ("alias", "project", "revision", "reportSha256", "counts")}
                         for row in result["results"]],
            "iati": str(bundle / manifest["iatiPath"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Receive and open the complete selected programme and its original software")
    parser.add_argument("--bundle", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--workspace", type=Path, required=True, help="Absolute original private receiving workspace")
    parser.add_argument("--receive-only", action="store_true", help="Complete receiving and close/reopen without starting the UI")
    parser.add_argument("--existing-workspace", action="store_true",
                        help="Receive into this existing original workspace; native receiving preserves an existing head")
    parser.add_argument("--port", type=int, default=0, help="Local original application port; 0 selects an available port")
    parser.add_argument("--connection-file", type=Path, help="Optional original private connection file for the native application")
    args = parser.parse_args(argv)
    check(0 <= args.port <= 65535, "Choose a local port from 0 to 65535")
    result = receive(args.bundle, args.workspace, args.existing_workspace)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), flush=True)
    if not args.receive_only:
        command = [sys.executable, str(Path(result["iati"]) / "cli.py"),
                   "--workspace", result["workspace"], "serve", "--port", str(args.port)]
        if args.connection_file:
            command += ["--connection-file", str(absolute(args.connection_file))]
        os.execv(sys.executable, command)


if __name__ == "__main__":
    try:
        main()
    except (ProgrammeError, OSError, ValueError) as error:
        print("Programme receiving: " + str(error), file=sys.stderr)
        sys.exit(1)
