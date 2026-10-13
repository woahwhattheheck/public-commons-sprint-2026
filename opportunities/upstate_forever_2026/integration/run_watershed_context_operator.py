#!/usr/bin/env python3
"""Receive the regional watershed desk through the original operator HTTP API.

Run after installing the current shared host and regional watershed component.
The source edition and selected source manifest must retain every named companion.
Without --source-manifest, the historical complete-sources.json default is used.
The output directory is newly created; existing work is never replaced.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import importlib.util
import inspect
import json
from pathlib import Path
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


class OperatorJourney:
    def __init__(self, server, timeout, output):
        self.server = server
        self.origin = server.operator.origin
        self.capability = server.operator.capability
        self.timeout = timeout
        self.output = output
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.tasks = []
        self.downloads = []

    def request(self, path, *, params=None, body=None):
        require(path.startswith("/api/") and not path.startswith("//"),
                "Use the original local operator API.")
        if params:
            path += "?" + urllib.parse.urlencode(params)
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.origin + path, data=data,
            headers={"Authorization": "Bearer " + self.capability,
                     "Origin": self.origin, "Content-Type": "application/json"},
            method="GET" if body is None else "POST")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            raise RuntimeError("Operator HTTP " + str(error.code) + ": " + detail) from None

    def task(self, workspace, action, payload):
        task = self.request("/api/actions", body={
            "workspace": workspace, "action": action, "payload": payload,
            "operation_id": uuid.uuid4().hex,
        })
        started = time.monotonic()
        while True:
            task = self.request("/api/task", params={"id": task["id"]})
            if task["state"] == "complete":
                self.tasks.append({"id": task["id"], "action": action,
                                   "state": "complete", "seconds": round(time.monotonic()-started, 3)})
                return task
            if task["state"] not in {"queued", "running"}:
                raise RuntimeError(action + " ended as " + task["state"] + ": "
                                   + json.dumps(task.get("error", {}), sort_keys=True))
            if time.monotonic() - started > self.timeout:
                raise TimeoutError(action + " remains " + task["state"]
                                   + "; original retained task " + task["id"])
            time.sleep(0.2)

    def regional(self, workspace, operation, **params):
        return self.request("/api/watershed-context/" + operation,
                            params={"workspace": workspace, **params})

    def download(self, ticket, group, *, filename=None):
        path = ticket["url"]
        require(path.startswith("/api/file/") and "?" not in path and "#" not in path,
                "Unexpected original download ticket path.")
        name = filename or ticket["filename"]
        require(name == Path(name).name and name not in {"", ".", ".."}
                and "\\" not in name, "Download filename must be a basename.")
        folder = self.output / "downloads" / group
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / name
        if target.exists():
            target = folder / (ticket["id"] + "-" + name)
        request = urllib.request.Request(self.origin + path, headers={
            "Authorization": "Bearer " + self.capability, "Origin": self.origin,
        })
        digest, length = hashlib.sha256(), 0
        try:
            with self.opener.open(request, timeout=self.timeout) as response, target.open("xb") as stream:
                require(response.status == 200, "Original download did not return a complete file.")
                require(int(response.headers["Content-Length"]) == ticket["bytes"],
                        "Download response length differs from its retained descriptor.")
                require(response.headers.get("ETag") == '"' + ticket["sha256"] + '"',
                        "Download ETag differs from its retained descriptor.")
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    stream.write(block)
                    digest.update(block)
                    length += len(block)
            require(length == ticket["bytes"] and digest.hexdigest() == ticket["sha256"],
                    "Downloaded bytes differ from the retained original.")
        except BaseException:
            if target.exists():
                target.unlink()
            raise
        result = {"path": target.relative_to(self.output).as_posix(),
                  "filename": ticket["filename"], "bytes": length, "sha256": digest.hexdigest()}
        self.downloads.append(result)
        return target

    def upload_archive(self, archive, expected):
        with archive.open("rb") as stream:
            request = urllib.request.Request(
                self.origin + "/api/upload", data=stream, method="POST",
                headers={"Authorization": "Bearer " + self.capability,
                         "Origin": self.origin, "Content-Type": "application/zip",
                         "Content-Length": str(archive.stat().st_size),
                         "X-Upload-Filename": urllib.parse.quote(archive.name)})
            with self.opener.open(request, timeout=self.timeout) as response:
                uploaded = json.load(response)
        require(uploaded["bytes"] == expected["bytes"]
                and uploaded["sha256"] == expected["sha256"],
                "The original upload changed the downloaded workspace archive.")
        return uploaded

    def download_item(self, value, group):
        tickets = value.get("_downloads", [])
        require(bool(tickets), "The original operator exposed no retained file tickets.")
        return {ticket["filename"]: self.download(ticket, group) for ticket in tickets}


def source_selection(choice):
    return {key: choice[key] for key in (
        "source_root_id", "member_path", "source_collection_id", "source_id") if key in choice}


def receive(args):
    application = Path(args.application).resolve(strict=True)
    edition = Path(args.source_dir).resolve(strict=True)
    output = Path(args.output).absolute()
    require(not output.exists(), "Choose a new receiving output directory.")
    existing_workspace = getattr(args, "workspace", None)
    workspace_directory = (Path(existing_workspace).expanduser().resolve(strict=True)
                           if existing_workspace else output / "workspace")
    if existing_workspace:
        require(workspace_directory.is_dir(), "Choose the existing original Workspace directory.")
        resolved_output = output.resolve()
        require(not resolved_output.is_relative_to(workspace_directory)
                and not workspace_directory.is_relative_to(resolved_output),
                "Receiving output must be separate from the existing Workspace.")
    manifest_arg = getattr(args, "source_manifest", None)
    source_manifest = (Path(manifest_arg).expanduser() if manifest_arg is not None
                       else edition / "complete-sources.json").resolve(strict=True)
    require(source_manifest.is_file(), "Choose the retained source manifest file.")
    for name in ("operator/server.py", "operator/extension_registry.py",
                 "operator/extensions/watershed-context.json", "model/watershed_context.py",
                 "source_tools/prepare_watershed_context.py"):
        require((application / name).is_file(), "Current application lacks " + name)
    sys.path[:0] = [str(application / "operator"), str(application)]
    spec = importlib.util.spec_from_file_location("_upstate_watershed_receiving_server",
                                                  application / "operator/server.py")
    server_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server_module)
    from model.workspace import Workspace
    from model import watershed_context as context_model
    from source_tools.prepare_watershed_context import import_source_edition
    require("source_roots" in inspect.signature(server_module.start_server).parameters,
            "Install the current shared extension host before running this journey.")
    require(Path(inspect.getfile(Workspace)).resolve().is_relative_to(application),
            "The receiving process imported a different application's model package.")
    output.mkdir(parents=True)
    result = {"schema": "upstate.watershed-context-operator-journey/v1",
              "started_at": datetime.now(timezone.utc).isoformat(),
              "state": "running", "application": str(application), "source_directory": str(edition),
              "source_manifest_path": str(source_manifest),
              "include_observed_evidence": bool(getattr(args, "include_observed_evidence", False)),
              "workspace_directory": str(workspace_directory),
              "workspace_mode": "existing" if existing_workspace else "new"}
    server = thread = journey = None
    try:
        server, startup = server_module.start_server(
            workspace_directory, state_directory=output / "operator-state",
            create=not bool(existing_workspace),
            title=None if existing_workspace else "Upper Savannah regional watershed receiving",
            source_roots=[edition], restore_directory=output / "received", port=0)
        thread = threading.Thread(target=server.serve_forever,
                                  kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        workspace = startup["workspace_key"]
        original_project_id = startup["project"]["id"]
        result["original_project_id"] = original_project_id
        journey = OperatorJourney(server, args.timeout, output)
        adopted = adopted_files = adopted_report = None
        if args.completed_archive:
            receiver_path = application / "operator/receive_watershed_context.py"
            require(receiver_path.is_file(), "Install the current completed-result receiver.")
            receiver_spec = importlib.util.spec_from_file_location(
                "_upstate_completed_watershed_receiver", receiver_path)
            receiver_module = importlib.util.module_from_spec(receiver_spec)
            receiver_spec.loader.exec_module(receiver_module)
            adoption_options = {
                "carrier_file_id": args.completed_carrier_file_id,
                "expected_report_id": args.completed_report_id,
            }
            native_archive = Path(args.completed_archive).resolve(strict=True)
            native_upload = journey.upload_archive(native_archive, {
                "bytes": native_archive.stat().st_size,
                "sha256": args.completed_archive_sha256,
            })
            native_task = journey.task(workspace, "watershed.context.receive",
                                       {"upload_id": native_upload["id"]})
            adopted = receiver_module.adopt(
                application, server.operator.ws(workspace).root,
                native_archive, args.completed_archive_sha256, **adoption_options)
            require(native_task["result"]["id"] == adopted["id"],
                    "Queued receiving and the native receiver resolved different report identities.")
            require(adopted["state"] in {"received", "already_received"},
                    "The original completed result was not retained.")
            adopted_report = journey.regional(workspace, "report", report_id=adopted["id"])
            adopted_files = journey.download_item(adopted_report, "completed-native-report")
            repeated = receiver_module.adopt(
                application, server.operator.ws(workspace).root,
                Path(args.completed_archive).resolve(strict=True),
                args.completed_archive_sha256, **adoption_options)
            require(repeated["state"] == "already_received",
                    "Repeating the original completed result did not reopen its retained bytes.")
            result["completed_result"] = {
                "id": adopted["id"], "state": adopted["state"],
                "receiving_task_id": native_task["id"],
                "archive_sha256": args.completed_archive_sha256,
                "report_sha256": sha256(adopted_files["watershed-context.json"].read_bytes()),
                "original_outputs": sorted(name for name in adopted_files if name in {
                    "watershed-context.json", "watershed-hucs.csv", "watershed-huc8s.csv",
                    "watershed-states.csv", "watershed-report.md", "selected-watersheds.json",
                    "selected-watersheds.csv"}),
            }
            require(len(result["completed_result"]["original_outputs"]) == 7,
                    "The completed result did not expose all seven original outputs.")
        extensions = journey.request("/api/extensions")
        installed = next((row for row in extensions["extensions"]
                          if row["id"] == "watershed-context"), None)
        require(installed is not None, "Regional watershed extension failed to register: "
                + json.dumps(extensions.get("issues", []), sort_keys=True))
        catalogue = journey.regional(workspace, "catalog")
        roots = [row for row in catalogue["sources"]
                 if row.get("member_path") == "full-domain-water-context.json"
                 and row.get("source_root_id")]
        require(len(roots) == 1, "Expected one exact source edition in the registered directory.")
        root_task = journey.task(workspace, "watershed.context.analyze",
                                 {"selection": source_selection(roots[0])})
        report_id = root_task["result"]["id"]
        original = journey.regional(workspace, "report", report_id=report_id)
        report = original["report"]
        rows = report["hucs"]
        require(len(rows) == args.expect_hucs
                and len({row["huc12"] for row in rows}) == args.expect_hucs,
                "The actual regional report has a different watershed membership.")
        require(report["summary"]["selected_classification_count"] == args.expect_selected_reaches,
                "The actual selected-class feature count differs from this source edition.")
        require(report["classification_coverage"]["complete_domain_query"],
                "The report did not bind the completed classification query to its exact domain.")
        priorities = sorted(row["huc12"] for row in rows if row["priority"])
        require(len(priorities) == args.expect_priority_hucs,
                "The actual NRCS priority watershed count differs from this source edition.")
        imported = import_source_edition(server.operator.ws(workspace), edition,
                                         source_manifest=source_manifest)
        collection_id = imported["collection"]["id"]
        source_id = imported["source_id"]
        catalogue = journey.regional(workspace, "catalog")
        retained = [row for row in catalogue["sources"]
                    if row.get("source_collection_id") == collection_id
                    and row.get("source_id") == source_id]
        require(len(retained) == 1, "Imported regional source did not appear in the original catalogue.")
        import_task = journey.task(workspace, "watershed.context.analyze",
                                   {"selection": source_selection(retained[0])})
        require(import_task["result"]["id"] == report_id,
                "Importing identical retained source changed the native report identity.")
        imported_report = journey.regional(workspace, "report", report_id=report_id)
        require(imported_report["source_fingerprint"] == original["source_fingerprint"],
                "Folder and imported source editions have different scientific source fingerprints.")
        supporting = original.get("source_supporting_inputs", [])
        required_support = {"domain-huc12s.json", "nrcs-domain-fy26.csv", "classified-reaches.csv",
                            "scdes-original-domain217-classified-objectids.json",
                            "scdes-huc8-03060104-to-07-target-class-count.json"}
        require(required_support <= {row["id"] for row in supporting},
                "The operator did not retain all original scientific source companions.")
        require(imported_report.get("source_supporting_inputs") == supporting,
                "Imported source lost its original supporting-file identities.")
        detail = journey.regional(workspace, "huc", report_id=report_id, huc12=priorities[0])
        require(detail["huc"] == next(row for row in rows if row["huc12"] == priorities[0]),
                "The original HUC route changed the saved native record.")
        export_payload = {"report_id": report_id, "huc12s": priorities}
        evidence_choice = None
        if getattr(args, "include_observed_evidence", False):
            evidence_choice = imported_report.get("_evidence_profiles")
            require(isinstance(evidence_choice, dict)
                    and evidence_choice.get("schema") == "upstate.watershed-observation-choice/v1"
                    and isinstance(evidence_choice.get("sha256"), str)
                    and len(evidence_choice["sha256"]) == 64
                    and all(char in "0123456789abcdef" for char in evidence_choice["sha256"]),
                    "Install the complete retained observed-evidence source before this selected course.")
            export_payload.update(include_evidence=True,
                                  evidence_profile_sha256=evidence_choice["sha256"])
        export_task = journey.task(workspace, "watershed.context.export", export_payload)
        export_id = export_task["result"]["id"]
        selection = journey.regional(workspace, "export", export_id=export_id)
        require(selection["watershed_count"] == len(priorities),
                "The operator selection did not preserve all chosen priority watersheds.")
        saved_selections = journey.regional(workspace, "catalog").get("exports", [])
        require(any(row["id"] == export_id and sorted(row["huc12s"]) == priorities
                    for row in saved_selections),
                "The saved selection catalogue lost the original HUC12 membership.")
        report_files = journey.download_item(original, "regional-report")
        export_files = journey.download_item(selection, "priority-watersheds")
        selected = json.loads(export_files["selected-watersheds.json"].read_bytes())
        if evidence_choice is not None:
            evidence = selection.get("landcover_observation_context")
            selected_evidence = selected.get("landcover_observation_context")
            require(isinstance(evidence, dict) and isinstance(selected_evidence, dict),
                    "The selected export did not retain its requested observed evidence.")
            require(evidence.get("source", {}).get("manifest_sha256") == evidence_choice["sha256"]
                    and selected_evidence.get("source", {}).get("manifest_sha256") == evidence_choice["sha256"],
                    "The saved evidence source differs from the explicit selected manifest.")
            require(sorted(evidence.get("selected", {}).get("huc12s", [])) == priorities
                    and sorted(selected_evidence.get("selected", {}).get("huc12s", [])) == priorities,
                    "Observed evidence changed the selected HUC12 membership.")
            require(evidence.get("selected", {}).get("summary", {}).get("watershed_count") == len(priorities),
                    "The evidence summary did not retain its distinct selected-watershed count.")
            result["observed_evidence"] = {
                "choice": evidence_choice,
                "saved_context": evidence,
                "retained_export_files": selection.get("files", {}),
            }
        for brief_name in ("watershed-selection-brief.md", "watershed-selection-brief.html"):
            require(brief_name in export_files, "The selected watershed planning brief is missing.")
        native_origin = original.get("source_validation", {}).get(
            "original_source_checks", {}).get("native_network_source", {})
        if native_origin.get("status") == "original_bytes_bound":
            source_uri = native_origin["source_uri"]
            require(any(reference.get("reference", {}).get("uri") == source_uri
                        and reference.get("sha256") == native_origin["sha256"]
                        for reference in selected.get("supporting_source_references", [])),
                    "The selection lost its byte-bound original network source.")
            readable = html.unescape(export_files["watershed-selection-brief.html"].read_text(encoding="utf-8"))
            link_uri = source_uri.replace("<", "%3C").replace(">", "%3E").replace(" ", "%20")
            require('href="' + link_uri + '"' in readable,
                    "The readable brief did not link its original network publisher.")
        require(sorted(row["huc12"] for row in selected["hucs"]) == priorities,
                "The downloaded JSON selection differs from the saved HUC choice.")
        with export_files["selected-watersheds.csv"].open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream)
            require(reader.fieldnames == list(context_model.HUC_COLUMNS),
                    "The selected CSV omitted or reordered the maintained native HUC fields.")
            selected_csv = list(reader)
        require(selection.get("csv_columns") == list(context_model.HUC_COLUMNS)
                and selection.get("csv_format") == "upstate.watershed-context-csv/v2",
                "The saved selection identity did not bind its native CSV format.")
        require(sorted(row["huc12"] for row in selected_csv) == priorities,
                "The downloaded CSV selection differs from the saved HUC choice.")
        backup_task = journey.task(workspace, "workspace.backup",
                                   {"include_intermediates": False})
        backup_tickets = backup_task.get("_downloads", [])
        require(len(backup_tickets) == 1, "Original workspace backup has no unique archive ticket.")
        archive = journey.download(backup_tickets[0], "workspace", filename="regional-workspace.zip")
        uploaded = journey.upload_archive(archive, backup_tickets[0])
        restore_task = journey.task(workspace, "workspace.restore", {"upload_id": uploaded["id"]})
        receiving = restore_task["result"]
        require(receiving["identity"] == "MATCH", "Original archive receiving changed project identity.")
        require(server.operator.ws(workspace).project["id"] == original_project_id,
                "The source Workspace project identity changed during receiving.")
        restored_key = receiving["workspace_key"]
        require(server.operator.ws(restored_key).project["id"] == original_project_id,
                "The independent received Workspace does not preserve the original project identity.")
        reopened = journey.request("/api/item", params={
            "workspace": restored_key, "kind": "watershed-context", "id": report_id})
        require(reopened["report"] == report
                and reopened["source_fingerprint"] == original["source_fingerprint"],
                "Reopened workspace changed its saved report or scientific source identity.")
        if adopted is not None:
            restored_native = journey.regional(restored_key, "report", report_id=adopted["id"])
            restored_native_files = journey.download_item(restored_native, "received-native-report")
            require(restored_native["report"] == adopted_report["report"],
                    "Workspace transfer changed the adopted original model report.")
            for name in result["completed_result"]["original_outputs"]:
                require(restored_native_files[name].read_bytes() == adopted_files[name].read_bytes(),
                        "Workspace transfer changed an original native output: " + name)
        restored_catalogue = journey.regional(restored_key, "catalog")
        require(any(row["id"] == export_id and sorted(row["huc12s"]) == priorities
                    for row in restored_catalogue.get("exports", [])),
                "The restored selection catalogue changed its saved membership.")
        restored_source = [row for row in restored_catalogue["sources"]
                           if row.get("source_collection_id") == collection_id
                           and row.get("source_id") == source_id]
        require(len(restored_source) == 1, "Restored source catalogue lost its original collection.")
        rebuilt = journey.task(restored_key, "watershed.context.analyze",
                               {"selection": source_selection(restored_source[0])})
        require(rebuilt["result"]["id"] == report_id
                and rebuilt["result"]["source_fingerprint"] == original["source_fingerprint"],
                "Rebuilding from reconstructed source companions changed the report.")
        reopened_export = journey.regional(restored_key, "export", export_id=export_id)
        reopened_files = journey.download_item(reopened_export, "received-priority-watersheds")
        retained_names = ("selected-watersheds.json", "selected-watersheds.csv",
                          "watershed-selection-brief.md", "watershed-selection-brief.html")
        if evidence_choice is not None:
            require(reopened_export.get("landcover_observation_context")
                    == selection["landcover_observation_context"],
                    "Received selection changed its saved observed evidence.")
            require(reopened_export.get("files") == selection.get("files"),
                    "Received selection changed the full original evidence file inventory.")
            require(set(reopened_files) == set(export_files),
                    "Received selection lost original evidence downloads.")
            retained_names = tuple(export_files)
        for name in retained_names:
            require(reopened_files[name].read_bytes() == export_files[name].read_bytes(),
                    "Received selection download changed: " + name)
        result.update(
            state="complete", report_id=report_id, export_id=export_id,
            source_collection_id=collection_id, source_id=source_id,
            source_manifest=imported["source_manifest"],
            source_manifest_members=imported["source_manifest_members"],
            imported_source_validation=imported["imported_validation"],
            source_fingerprint=original["source_fingerprint"],
            summary=report["summary"], classification_coverage=report["classification_coverage"],
            network=report.get("network"), selected_huc12s=priorities,
            original_report_sha256=sha256(report_files["watershed-context.json"].read_bytes()),
            receiving={"identity": receiving["identity"], "archive_sha256": receiving["archive_sha256"],
                       "members": receiving["members"],
                       "directory": Path(receiving["directory"]).relative_to(output).as_posix()},
            tasks=journey.tasks, downloads=journey.downloads,
            finished_at=datetime.now(timezone.utc).isoformat())
        write_json(output / "operator-journey.json", result)
        return result
    except BaseException as error:
        result.update(state="failed", error={"type": type(error).__name__, "message": str(error)},
                      tasks=journey.tasks if journey else [],
                      downloads=journey.downloads if journey else [],
                      finished_at=datetime.now(timezone.utc).isoformat())
        write_json(output / "operator-journey.json", result)
        raise
    finally:
        if server is not None:
            if thread is not None:
                server.shutdown()
                thread.join()
            server.server_close()
            server.operator.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--workspace",
                        help="Existing original Workspace; otherwise create OUTPUT/workspace")
    parser.add_argument("--source-manifest",
                        help="Exact upstate.sources/v1 manifest; defaults to SOURCE_DIR/complete-sources.json")
    parser.add_argument("--output", required=True)
    parser.add_argument("--include-observed-evidence", action="store_true",
                        help="Include the retained land-cover/station evidence in the selected export and full archive receiving")
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--completed-archive")
    parser.add_argument("--completed-archive-sha256")
    parser.add_argument("--completed-carrier-file-id")
    parser.add_argument("--completed-report-id")
    parser.add_argument("--expect-hucs", type=int, default=217)
    parser.add_argument("--expect-selected-reaches", type=int, default=1886)
    parser.add_argument("--expect-priority-hucs", type=int, default=15)
    args = parser.parse_args()
    require(args.timeout > 0, "Task timeout must be positive.")
    require(bool(args.completed_archive) == bool(args.completed_archive_sha256),
            "Supply the completed archive and its published SHA256 together.")
    result = receive(args)
    print(json.dumps({"state": result["state"], "report_id": result["report_id"],
                      "export_id": result["export_id"], "hucs": result["summary"]["huc_count"],
                      "selected": len(result["selected_huc12s"]),
                      "receipt": str(Path(args.output).absolute() / "operator-journey.json")},
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
