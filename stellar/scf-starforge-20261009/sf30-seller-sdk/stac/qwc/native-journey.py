# SPDX-License-Identifier: MIT
"""One original QGIS -> QWC -> native acceptance -> restore -> portable customer journey."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import threading
import time
import zipfile

from contract import (HERE, SOURCE, QwcError, need, directory, member, identifier, relative,
                      measure, read_json, json_bytes, digest, value_hash, keep_json, atomic,
                      copy_file, sync_directory, writer, now)
from host import NativeContext, ensure_namespace, read_pointer
from workspace import QwcWorkspace, source_inventory
from portable import (export_publication, inspect_archive, inspect_received,
                      DEFAULT_MAX_BYTES)
from managed import require_binding, executable_identity, startup, published_connection

SCHEMA = "starforge.stac-qwc-publication-native-journey.v1"
RESULT_SCHEMA = "starforge.stac-qwc-publication-native-result.v1"
ACCEPTANCE_SCHEMA = "starforge.stac-qwc-native-review-journey.v1"
BROWSER_SCHEMA = "starforge.stac-qwc-publication-browser-input.v1"
ACCEPTANCE = HERE.parent / "qwc-acceptance"


def file_identity(path, *, progress=None):
    path = Path(path).expanduser().absolute()
    return {"path": str(path), **measure(path, progress=progress)}


def retain_original(root, name, original, context):
    destination = member(directory(root / "inputs", True), name, False)
    if destination.exists():
        # The literal controlling config is retained first. A resumed operation
        # consumes the exact copied input even after its original delivery moves.
        return read_json(destination)[0], file_identity(destination, progress=context.checkpoint)
    selected, body = read_json(original)
    atomic(destination, body, create_only=True)
    context.checkpoint()
    return selected, {"path": str(destination), "bytes": len(body), "sha256": digest(body)}


def native_sources():
    result = {}
    for base in (HERE, HERE.parent / "qgis", ACCEPTANCE):
        need(base.is_dir(), "COMPLETE_NATIVE_SOURCE",
             "Keep the complete publisher, original QGIS and acceptance directories in this source edition.")
        for row in source_inventory(base):
            path = (base / row["path"]).relative_to(SOURCE).as_posix()
            result[path] = {key: row[key] for key in ("bytes", "sha256")}
    for path in ("native_journey.py", "publication_plan.py", "qwc_acceptance.py", "browser_journey.mjs"):
        need((ACCEPTANCE / path).is_file(), "COMPLETE_ACCEPTANCE_SOURCE",
             "Keep the original merged acceptance driver and complete browser operator.", path=path)
    return result


def freeze_inputs(root, raw, original_body, context):
    need(raw.get("schema") == SCHEMA, "NATIVE_JOURNEY_REQUIRED", "Select the complete original publication journey.")
    identifier(raw.get("operationId"), "operationId")
    need(isinstance(raw.get("actor"), str) and raw["actor"].strip(), "NATIVE_ACTOR", "Retain the original selected operator.")
    need(str(Path(raw["directory"]).expanduser().absolute()) == str(root),
         "ORIGINAL_JOURNEY_DIRECTORY", "Continue the same original customer directory.")
    atomic(root / "original-config.json", original_body, create_only=True)
    profile, profile_file = retain_original(root, "host-profile.json", raw["profile"], context)
    selected = raw.get("editions")
    need(isinstance(selected, list) and len(selected) == 2, "TWO_NATIVE_EDITIONS",
         "Select the original saved GIS edition and its actual saved refresh.")
    editions, files = [], {"profile": profile_file}
    seen_ids, seen_requests, seen_runs = set(), set(), set()
    for position, item in enumerate(selected):
        label = identifier(item.get("id"), "edition.id")
        need(label not in seen_ids, "EDITION_ID_DUPLICATE", "Keep each original capture identity distinct.")
        seen_ids.add(label)
        request, request_file = retain_original(root, label + "-publication-request.json", item["request"], context)
        review, review_file = retain_original(root, label + "-acceptance-profile.json", item["reviewProfile"], context)
        need(request.get("operationId") == raw["operationId"] and request.get("actor") == raw["actor"],
             "ORIGINAL_PUBLICATION_OPERATION", "Both editions retain this same original customer operation and actor.")
        request_id = identifier(request.get("requestId"), "requestId")
        need(request_id not in seen_requests, "PUBLICATION_REQUEST_DUPLICATE",
             "Each native edition needs its own original publication request.")
        seen_requests.add(request_id)
        need(review.get("schema") == "starforge.stac-qwc-review-profile.v1",
             "NATIVE_REVIEW_PROFILE", "Retain the original acceptance profile.")
        run_id = review.get("run_id")
        need(isinstance(run_id, str) and run_id and run_id not in seen_runs, "REVIEW_RUN_DUPLICATE",
             "Select two distinct original acceptance runs.")
        seen_runs.add(run_id)
        operations = {"GetCapabilities"} | {item.get("operation") for item in review.get("checks", [])}
        need({"GetCapabilities", "GetProjectSettings", "GetMap", "GetFeatureInfo", "GetPrint"} <= operations,
             "COMPLETE_NATIVE_REQUEST_SELECTION",
             "Each original acceptance profile selects the actual map, metadata, feature and print requests.")
        files[label + ".request"] = request_file
        files[label + ".reviewProfile"] = review_file
        editions.append({"id": label, "request": request, "reviewProfile": review,
                         "requestFile": request_file, "reviewProfileFile": review_file})
    first, refreshed = [item["request"]["qgis"] for item in editions]
    need(any(first.get(key) != refreshed.get(key) for key in ("directory", "revision", "projectId")),
         "ORIGINAL_GIS_REFRESH", "Select the actual saved GIS refresh as the second publication.")
    browser = raw.get("browser")
    need(isinstance(browser, dict), "EXISTING_BROWSER_REQUIRED", "Select the original equipped browser runtime.")
    for key in ("node", "chrome", "playwrightModule"):
        need(isinstance(browser.get(key), str) and Path(browser[key]).is_absolute(),
             "EXISTING_BROWSER_REQUIRED", "Use absolute paths from the existing selected runtime.", field=key)
    selected_browser = {"node": executable_identity(browser["node"]),
                        "chrome": executable_identity(browser["chrome"]),
                        "playwrightModule": file_identity(browser["playwrightModule"], progress=context.checkpoint)}
    maximum = raw.get("maxArchiveBytes", DEFAULT_MAX_BYTES)
    delivery_maximum = raw.get("maxDeliveryBytes", 3 * DEFAULT_MAX_BYTES)
    timeout = raw.get("browserTimeoutSeconds", 900)
    need(type(maximum) is int and maximum > 0 and type(delivery_maximum) is int and delivery_maximum > 0,
         "COMPLETE_ARCHIVE_ALLOWANCE", "Declare the complete original archive and final delivery volumes.")
    need(type(timeout) is int and 30 <= timeout <= 86400, "BROWSER_ALLOWANCE",
         "Select the actual complete browser and native receiving allowance.")
    inventory = {"schema": SCHEMA, "operationId": raw["operationId"], "actor": raw["actor"],
                 "directory": str(root), "originalConfigSha256": digest(original_body),
                 "workspace": str(Path(raw["workspace"]).expanduser().absolute()),
                 "files": files, "source": native_sources(), "browser": selected_browser,
                 "python": executable_identity(sys.executable),
                 "maxArchiveBytes": maximum, "maxDeliveryBytes": delivery_maximum,
                 "browserTimeoutSeconds": timeout}
    keep_json(root / "native-input.json", inventory)
    return profile, editions, inventory


def receipt(root, label, action, *, context, verify=None):
    identifier(label, "nativeStage")
    path = directory(root / "receipts", True) / (label + ".json")
    if path.exists():
        value, _ = read_json(path)
        if verify:
            verify(value)
        context.checkpoint()
        return value
    context.checkpoint({"phase": label, "state": "STARTING"})
    atomic(root / "current-stage.json", json_bytes({"stage": label, "state": "RUNNING", "at": now()}))
    value = action()
    context.checkpoint()
    if verify:
        verify(value)
    keep_json(path, value)
    atomic(root / "current-stage.json", json_bytes({"stage": label, "state": "COMPLETED", "at": now()}))
    context.checkpoint({"phase": label, "state": "COMPLETED"})
    return value


def publication_identity(workspace, edition, context):
    selected = workspace.inspect(edition["request"]["requestId"], verify=True)["operations"][0]
    need("publication" in selected and "deployment" in selected,
         "NATIVE_PUBLICATION_REQUIRED", "Complete the original native publication before acceptance.")
    publication = selected["publication"]
    need(publication["operationId"] == edition["request"]["operationId"] and
         publication["requestId"] == edition["request"]["requestId"],
         "NATIVE_PUBLICATION_IDENTITY", "The retained publication belongs to another original operation.")
    return {"requestId": publication["requestId"], "publicationId": publication["publicationId"],
            "publicationSha256": selected["publicationSha256"],
            "path": str(workspace._operation(publication["requestId"]) / "publication.json"),
            "projectId": publication["qgis"]["projectId"], "reviewSha256": selected["reviewSha256"],
            "title": publication["theme"]["title"]}


def original_capture(root, raw, edition, publication, workspace, context):
    accepted_root = root / "acceptance"
    capture_config = {"schema": ACCEPTANCE_SCHEMA, "operation_id": raw["operationId"],
                      "actor": raw["actor"], "directory": str(accepted_root),
                      "capture_id": edition["id"], "title": raw.get("title", "QWC original publication receiving"),
                      "publication": publication["path"],
                      "profile": edition["reviewProfileFile"]["path"],
                      "expected_publication_sha256": publication["publicationSha256"]}
    config_path = root / "inputs" / (edition["id"] + "-capture.json")
    keep_json(config_path, capture_config)
    journal_path = accepted_root / "native-journey.json"

    def retained():
        if not journal_path.exists():
            return None
        journal, _ = read_json(journal_path)
        need(journal.get("operation_id") == raw["operationId"] and journal.get("actor") == raw["actor"],
             "ORIGINAL_ACCEPTANCE_OPERATION", "Continue the original same-actor acceptance journey.")
        phase = journal.get("captures", {}).get(edition["id"])
        if phase is None or phase.get("state") != "COMPLETE":
            return None
        selection = phase["selection"]
        need(selection.get("publication_sha256") == publication["publicationSha256"] and
             selection.get("profile_sha256") == edition["reviewProfileFile"]["sha256"] and
             phase.get("run_id") == edition["reviewProfile"]["run_id"],
             "ORIGINAL_ACCEPTANCE_IDENTITY", "The retained native responses select another publication or request profile.")
        for row in phase["responses"].values():
            for field in ("body", "metadata"):
                value = row[field]
                need(isinstance(value, dict) and "path" in value,
                     "NATIVE_RESPONSE_DESCRIPTOR", "Keep the original complete native response descriptor.")
                path = Path(value["path"])
                # Native capture body paths can be relative to the original review workspace.
                if not path.is_absolute():
                    path = accepted_root / "workspace" / path
                measure(path, value, context.checkpoint)
        return copy.deepcopy(phase)

    completed = retained()
    if completed is not None:
        return completed
    current = read_pointer(ensure_namespace(workspace.profile, workspace.marker["id"]))
    need(current == "releases/" + publication["publicationId"],
         "SELECTED_NATIVE_PUBLICATION", "Capture this exact native publication while its retained pointer is selected.")
    context.run([sys.executable, "-B", str(ACCEPTANCE / "native_journey.py"), "capture", "--config", str(config_path)],
                root / "jobs", edition["id"] + "-native-capture", environment=os.environ.copy())
    completed = retained()
    need(completed is not None, "NATIVE_CAPTURE_INCOMPLETE",
         "The original acceptance owner has not retained every selected native response.")
    return completed


def original_finish(root, raw, inventory, context):
    original_browser = raw["browser"]
    config = {"schema": ACCEPTANCE_SCHEMA, "operation_id": raw["operationId"],
              "actor": raw["actor"], "directory": str(root / "acceptance"),
              "capture_ids": [item["id"] for item in raw["editions"]],
              "browser_timeout": inventory["browserTimeoutSeconds"],
              "browser": {"node": original_browser["node"],
                          "playwright_module": original_browser["playwrightModule"],
                          "chrome": original_browser["chrome"]}}
    path = root / "inputs" / "acceptance-finish.json"
    keep_json(path, config)
    result_path = root / "acceptance" / "complete-delivery.json"
    if not result_path.exists():
        context.run([sys.executable, "-B", str(ACCEPTANCE / "native_journey.py"), "finish", "--config", str(path)],
                    root / "jobs", "native-acceptance-receiving", environment=os.environ.copy())
    result, _ = read_json(result_path)
    need(result.get("operation_id") == raw["operationId"],
         "ACCEPTANCE_DELIVERY_IDENTITY", "The original acceptance archive belongs to another customer operation.")
    measure(result["path"], result, context.checkpoint)
    return result


def browser_operation(root, raw, inventory, workspace, publications, mode, context, active, received=None):
    from server import Console
    output = directory(root / ("browser-" + mode), True)
    connection = output / "console.connection"
    selected_root = Path(received["directory"]) if received else workspace.root
    binding = require_binding(str(selected_root), received=bool(received),
                              qgis_python=workspace.profile["qgisPython"])
    selection = {"schema": BROWSER_SCHEMA, "operationId": raw["operationId"], "mode": mode,
                 "output": str(output), "connectionFile": str(connection),
                 "workspace": str(selected_root), "workspaceId": binding["workspaceId"],
                 "bindingSha256": binding["sha256"], "qgisPython": workspace.profile["qgisPython"],
                 "browser": {"playwrightModule": raw["browser"]["playwrightModule"],
                             "chrome": raw["browser"]["chrome"]},
                 "timeoutSeconds": inventory["browserTimeoutSeconds"]}
    if mode == "publisher":
        selection.update({"editions": publications, "exportId": "native-refreshed-" + value_hash(raw["operationId"])[:32],
                          "receiverId": "native-received-" + value_hash(raw["operationId"])[:32]})
    else:
        selection.update({"publicationId": received["publication"]["publicationId"],
                          "publicationSha256": received["publicationSha256"],
                          "archiveSha256": received["receipt"]["archiveSha256"]})
    input_path = output / "browser-input.json"
    keep_json(input_path, selection)
    result_path = output / "result.json"
    def verify_browser():
        result, _ = read_json(result_path)
        retained_input, input_body = read_json(output / "input.json")
        need(result.get("schema") == "starforge.stac-qwc-publication-browser-result.v1" and
             result.get("operationId") == raw["operationId"] and result.get("status") == "COMPLETED" and
             result.get("mode") == mode and result.get("workspaceId") == binding["workspaceId"] and
             result.get("bindingSha256") == binding["sha256"] and retained_input == selection and
             result.get("inputSha256") == digest(input_body),
             "BROWSER_RECEIVING_IDENTITY", "Continue the original complete browser input and workspace.")
        for file in result["artifacts"]:
            path = Path(file["path"])
            need(path.is_relative_to(output), "BROWSER_ARTIFACT_PATH", "Keep original browser artifacts in their retained directory.")
            measure(path, file, context.checkpoint)
        return result
    if result_path.exists():
        return verify_browser()
    # Each child inherits the original journey and console leases. The connection
    # stays available until both browser and native/HTTP owners have drained.
    with writer(selected_root, ".qwc-console.lock") as fd:
        server, thread = None, None
        try:
            server = Console(str(selected_root), received=bool(received),
                             qgis_python=workspace.profile["qgisPython"],
                             max_archive_bytes=inventory["maxArchiveBytes"],
                             lease_fds=tuple(sorted(context.fds | {fd})))
            active["server"] = server
            context.checkpoint()
            if connection.exists() or connection.is_symlink():
                info = connection.lstat()
                need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
                     "PRIVATE_RETAINED_CONNECTION", "The interrupted console connection must remain its original private file.")
                # Acquiring the original console lease establishes that its owner
                # and inherited native children have finished before this cleanup.
                connection.unlink()
                sync_directory(connection.parent)
            with published_connection(connection, server.url):
                try:
                    server.launch = startup(server, binding, str(connection))
                    thread = threading.Thread(target=server.run, name="qwc-original-native-console", daemon=False)
                    thread.start()
                    context.checkpoint()
                    context.run([raw["browser"]["node"], str(HERE / "native-browser.mjs"), "--input", str(input_path)],
                                root / "jobs", "original-" + mode + "-browser", environment=os.environ.copy())
                finally:
                    server.close()
                    if thread is not None and thread.ident is not None:
                        thread.join()
                    server = None
        finally:
            if server is not None:
                server.close()
                if thread is not None and thread.ident is not None:
                    thread.join()
            active["server"] = None
    return verify_browser()


def whole_delivery(root, raw, inventory, report, context):
    manifest_path = root / "delivery-input.json"
    if manifest_path.exists():
        prepared, _ = read_json(manifest_path)
        need(prepared["operationId"] == raw["operationId"] and
             prepared["inputSha256"] == file_identity(root / "native-input.json")["sha256"],
             "DELIVERY_OPERATION_CHANGED", "Continue the same complete native delivery.")
    else:
        selected = {}
        def add(name, path):
            relative(name)
            need(name not in selected, "DELIVERY_MEMBER_DUPLICATE", "Each native delivery member has its own original path.")
            selected[name] = file_identity(path, progress=context.checkpoint)
        add("native-input.json", root / "native-input.json")
        add("native-report.json", root / "native-report.json")
        add("QWC_First_Publication.zip", report["firstExport"]["path"])
        add("QWC_Refreshed_Publication.zip", report["browserPublisher"]["stages"]["archive"]["path"])
        add("QWC_Complete_Native_Receiving.zip", report["acceptance"]["path"])
        for path in sorted((root / "inputs").iterdir()):
            if path.is_file() and not path.is_symlink():
                add("inputs/" + path.name, path)
        for path in sorted((root / "receipts").iterdir()):
            if path.is_file() and not path.is_symlink():
                add("receipts/" + path.name, path)
        for mode in ("publisher", "received"):
            base = root / ("browser-" + mode)
            add("browser-" + mode + "/result.json", base / "result.json")
            result, _ = read_json(base / "result.json")
            for item in result["artifacts"]:
                if Path(item["path"]).suffix.lower() == ".zip":
                    continue
                add("browser-" + mode + "/" + Path(item["path"]).name, item["path"])
        manifest = {"schema": RESULT_SCHEMA, "operationId": raw["operationId"],
                    "workspaceId": report["workspaceId"],
                    "members": [{"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}
                                for name, row in sorted(selected.items())],
                    "totalBytes": sum(item["bytes"] for item in selected.values())}
        need(manifest["totalBytes"] <= inventory["maxDeliveryBytes"], "COMPLETE_DELIVERY_ALLOWANCE",
             "The full customer handover exceeds this selected native delivery allowance.",
             requiredBytes=manifest["totalBytes"], selectedBytes=inventory["maxDeliveryBytes"])
        prepared = {"schema": SCHEMA, "operationId": raw["operationId"],
                    "inputSha256": file_identity(root / "native-input.json")["sha256"],
                    "selected": selected, "manifest": manifest}
        keep_json(manifest_path, prepared)
    body = json_bytes(prepared["manifest"])
    target = root / "QWC_Complete_Customer_Delivery.zip"
    names = set(prepared["selected"]) | {"customer-delivery.json"}

    def verify():
        with zipfile.ZipFile(target) as archive:
            need(len(archive.namelist()) == len(names) and set(archive.namelist()) == names,
                 "DELIVERY_MEMBERS_CHANGED", "Keep every complete original native handover member.")
            need(archive.read("customer-delivery.json") == body,
                 "DELIVERY_MANIFEST_CHANGED", "The original complete delivery manifest changed.")
            for name, expected in prepared["selected"].items():
                info = archive.getinfo(name)
                need(info.file_size == expected["bytes"], "DELIVERY_MEMBER_SIZE", "A retained member differs.")
                import hashlib
                hasher, total = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    while block := stream.read(1024 * 1024):
                        context.checkpoint()
                        hasher.update(block)
                        total += len(block)
                need(total == expected["bytes"] and hasher.hexdigest() == expected["sha256"],
                     "DELIVERY_MEMBER_IDENTITY", "An original native delivery member changed.", path=name)
    if not target.exists():
        fd, temporary = tempfile.mkstemp(prefix=".qwc-complete-", dir=root)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w+b") as stream:
                with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    archive.writestr("customer-delivery.json", body)
                    for name, expected in sorted(prepared["selected"].items()):
                        context.checkpoint()
                        fd = os.open(expected["path"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                        with os.fdopen(fd, "rb") as source:
                            before = os.fstat(source.fileno())
                            need(stat.S_ISREG(before.st_mode) and before.st_size == expected["bytes"],
                                 "DELIVERY_SOURCE_CHANGED", "Keep the original ordinary delivery member.", path=name)
                            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                            info.compress_type = (zipfile.ZIP_STORED if Path(name).suffix.lower() in
                                                  (".zip", ".png", ".pdf") else zipfile.ZIP_DEFLATED)
                            info.external_attr = (stat.S_IFREG | 0o600) << 16
                            info.file_size = expected["bytes"]
                            hasher, total = hashlib.sha256(), 0
                            with archive.open(info, "w", force_zip64=True) as destination:
                                while True:
                                    context.checkpoint()
                                    block = source.read(1024 * 1024)
                                    if not block:
                                        break
                                    total += len(block)
                                    need(total <= expected["bytes"], "DELIVERY_SOURCE_GREW",
                                         "The original delivery member grew during copying.", path=name)
                                    hasher.update(block)
                                    destination.write(block)
                                    context.checkpoint()
                            after = os.fstat(source.fileno())
                            visible = os.stat(expected["path"], follow_symlinks=False)
                            identity = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns)
                            need(stat.S_ISREG(visible.st_mode) and identity(before) == identity(after) ==
                                 identity(visible) and total == expected["bytes"] and
                                 hasher.hexdigest() == expected["sha256"],
                                 "DELIVERY_SOURCE_CHANGED", "An original delivery member changed while copying.", path=name)
                        context.checkpoint()
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                pass
            sync_directory(root)
        finally:
            Path(temporary).unlink(missing_ok=True)
    verify()
    result = {"schema": RESULT_SCHEMA, "status": "COMPLETED", "operationId": raw["operationId"],
              "workspaceId": report["workspaceId"], "path": str(target),
              **measure(target, progress=context.checkpoint),
              "manifestSha256": digest(body), "members": len(names),
              "publications": report["publications"], "completedAt": report["completedAt"]}
    keep_json(root / "complete-delivery.json", result)
    return result


def run(config_path):
    raw, original_body = read_json(config_path)
    need(raw.get("schema") == SCHEMA, "NATIVE_JOURNEY_REQUIRED", "Open the original complete native journey config.")
    root = directory(raw["directory"], True)
    last_progress = [0.0, None]
    def progress(value):
        current = time.monotonic()
        marker = (value.get("phase"), value.get("state"))
        if marker != last_progress[1] or current - last_progress[0] > 2:
            print(json_bytes({"nativeProgress": value}).decode("utf-8").rstrip(), flush=True)
            last_progress[:] = [current, marker]
    context = NativeContext(progress)
    active = {"server": None}
    previous = {}
    def interrupted(signum, frame):
        context.stop(signum)
        if active["server"] is not None:
            active["server"].request_stop(signum)
    with writer(root, ".original-customer.lock") as fd:
        context.fds.add(fd)
        try:
            for number in (signal.SIGINT, signal.SIGTERM):
                previous[number] = signal.getsignal(number)
                signal.signal(number, interrupted)
            completed_path = root / "complete-delivery.json"
            if completed_path.exists():
                completed, _ = read_json(completed_path)
                retained, retained_body = read_json(root / "original-config.json")
                need(retained_body == original_body and completed["operationId"] == raw["operationId"],
                     "ORIGINAL_COMPLETE_OPERATION", "Reopen the original complete native customer selection.")
                measure(completed["path"], completed, context.checkpoint)
                return completed
            profile, editions, inventory = freeze_inputs(root, raw, original_body, context)
            workspace = QwcWorkspace.create(inventory["workspace"], profile)
            report_path = root / "native-report.json"
            if report_path.exists():
                report, _ = read_json(report_path)
                need(report.get("operationId") == raw["operationId"] and report.get("workspaceId") == workspace.marker["id"] and
                     report.get("status") == "COMPLETED", "NATIVE_REPORT_IDENTITY", "Continue the original completed native report.")
                return whole_delivery(root, raw, inventory, report, context)
            publications, captures = [], []
            for edition in editions:
                label = edition["id"]
                publication_path = root / "receipts" / (label + "-publication.json")
                if publication_path.exists():
                    publication, _ = read_json(publication_path)
                    observed = publication_identity(workspace, edition, context)
                    need(observed == publication, "ORIGINAL_PUBLICATION_CHANGED",
                         "The same native stage retains another publication identity.")
                else:
                    selected = workspace.prepare(edition["request"], context=context)
                    workspace.publish(edition["request"]["requestId"], selected["reviewSha256"], context=context)
                    publication = publication_identity(workspace, edition, context)
                    keep_json(publication_path, publication)
                publications.append(publication)
                captures.append(receipt(root, label + "-capture",
                    lambda edition=edition, publication=publication:
                        original_capture(root, raw, edition, publication, workspace, context),
                    context=context))
            need(publications[0]["publicationId"] != publications[1]["publicationId"],
                 "DISTINCT_NATIVE_PUBLICATIONS", "Retain the two actual native publication editions.")
            # Restore through the same retained host CAS after both source-bound
            # captures are complete. Native acceptance now works from those bytes.
            rollback = receipt(root, "restore-original-host",
                lambda: workspace.rollback(publications[1]["requestId"], publications[1]["publicationSha256"],
                                           context=context), context=context)
            namespace = ensure_namespace(workspace.profile, workspace.marker["id"])
            need(read_pointer(namespace) == "releases/" + publications[0]["publicationId"],
                 "ORIGINAL_HOST_RESTORE", "The original scoped restore must select the first retained project.")
            acceptance = receipt(root, "complete-native-acceptance",
                lambda: original_finish(root, raw, inventory, context), context=context,
                verify=lambda value: measure(value["path"], value, context.checkpoint))
            # The current publication view carries the actual restored deployment.
            publications = [publication_identity(workspace, edition, context) for edition in editions]
            publisher_browser = receipt(root, "publisher-browser-receiving",
                lambda: browser_operation(root, raw, inventory, workspace, publications, "publisher", context, active),
                context=context)
            received_root = publisher_browser["stages"]["receivedDirectory"]
            received = inspect_received(received_root, verify=True, progress=context.checkpoint)
            received_browser = receipt(root, "independent-received-console",
                lambda: browser_operation(root, raw, inventory, workspace, publications, "received", context, active,
                                          received=received), context=context)
            first_export = receipt(root, "first-publication-handover",
                lambda: export_publication(workspace, publications[0]["requestId"], root / "QWC_First_Publication.zip",
                                           "native-first-" + value_hash(raw["operationId"])[:32], context=context),
                context=context, verify=lambda value: inspect_archive(value["path"],
                    expected_sha256=value["sha256"], max_bytes=inventory["maxArchiveBytes"], verify_files=True,
                    progress=context.checkpoint))
            report = {"schema": RESULT_SCHEMA, "status": "COMPLETED", "operationId": raw["operationId"],
                      "workspaceId": workspace.marker["id"], "publications": publications,
                      "captures": captures, "rollback": rollback, "acceptance": acceptance,
                      "browserPublisher": publisher_browser, "browserReceived": received_browser,
                      "firstExport": first_export, "received": received["receipt"], "completedAt": now()}
            keep_json(report_path, report)
            return whole_delivery(root, raw, inventory, report, context)
        except BaseException as error:
            try:
                atomic(root / "last-error.json", json_bytes({"schema": SCHEMA,
                    "operationId": raw.get("operationId"), "at": now(),
                    "error": {"code": getattr(error, "code", type(error).__name__),
                              "message": str(error), "details": getattr(error, "details", {})}}))
            except BaseException:
                pass
            raise
        finally:
            # Every owned native/browser process has already drained in its original
            # caller. Keep signal handlers and the original lock until console close.
            if active["server"] is not None:
                active["server"].close()
            for number, handler in previous.items():
                signal.signal(number, handler)
            context.fds.discard(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    selected = parser.parse_args()
    try:
        result = run(selected.config)
        print(json_bytes(result).decode("utf-8").rstrip(), flush=True)
    except QwcError as error:
        print(json_bytes({"error": {"code": error.code, "message": str(error),
                                  "details": error.details}}).decode("utf-8").rstrip(), file=sys.stderr)
        raise SystemExit(130 if error.code == "CANCELLED" and error.details.get("signal") == signal.SIGINT
                         else 143 if error.code == "CANCELLED" else 1)


if __name__ == "__main__":
    main()
