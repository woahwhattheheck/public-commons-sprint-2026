"""Receive a complete selected Research quotation programme on its original host.

All native requests come from retained, explicitly selected input files. The
programme can continue the original quoted brief, customer response, paid Buyer
work and realized report; it creates no replacement customer, price or payment.
Run --help or read ../RESEARCH-QUOTES.md for the complete selection format.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import threading
import zipfile

from stellar_forge_buyer import ResearchWorkspace, ResearchQuoteBundle
from stellar_forge_buyer.errors import BuyerError, StateError
from stellar_forge_buyer.research_quotes import (
    COMMANDS, _INPUT_LIMIT, _FILE_LIMIT, _object, _retained_file,
)
from stellar_forge_buyer.research_commerce import NATIVE_WRITES, FILE_PARTS
from stellar_forge_buyer.research_workspace import ResearchError, _json, _request_id
from stellar_forge_buyer.storage import digest, dump, lock, parse, private_directory, read, write

_SCHEMA = "stellar-forge.research-quotation-receiving.v1"
_RESULT = "stellar-forge.research-quotation-received.v1"
_HASH = re.compile(r"[a-f0-9]{64}")
_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}")
_TOP = {"schema", "operationId", "workspaceId", "dossierId", "caseId", "steps",
        "operations", "caseExports", "commerceExports", "replayCallId"}
_STEP = {"callId", "family", "command", "source", "caseId", "action", "profile"}
_CORE = {"callId", "family", "command", "source"}
_KINDS = {"CASE", "BRIEF", "RESPONSE", "PUBLICATION", "REALIZED"}


def need(ok, code):
    if not ok:
        raise StateError(code)


def fields(value, allowed, required=()):
    need(isinstance(value, dict) and set(value) <= set(allowed) and set(required) <= set(value),
         "RESEARCH_QUOTATION_RECEIVING_SELECTION_INVALID")


def exact_hash(value):
    need(isinstance(value, str) and _HASH.fullmatch(value), "RESEARCH_QUOTATION_RECEIVING_HASH_REQUIRED")
    return value


def native_id(value):
    need(isinstance(value, str) and _ID.fullmatch(value), "RESEARCH_QUOTATION_RECEIVING_ID_REQUIRED")
    return value


def name(value):
    need(isinstance(value, str) and _NAME.fullmatch(value), "RESEARCH_QUOTATION_RECEIVING_NAME_REQUIRED")
    return value


def relative_file(value):
    need(isinstance(value, str) and value and "\\" not in value, "RESEARCH_QUOTATION_SOURCE_PATH_INVALID")
    selected = PurePosixPath(value)
    need(not selected.is_absolute() and str(selected) == value and
         all(part not in {"", ".", ".."} for part in selected.parts),
         "RESEARCH_QUOTATION_SOURCE_PATH_INVALID")
    return selected


def source_descriptor(value):
    fields(value, {"file", "sha256", "bytes"}, {"file", "sha256", "bytes"})
    relative_file(value["file"]); exact_hash(value["sha256"])
    need(type(value["bytes"]) is int and 0 < value["bytes"] <= _INPUT_LIMIT,
         "RESEARCH_QUOTATION_SOURCE_SIZE_INVALID")
    return value


def selection(value):
    fields(value, _TOP, _TOP)
    need(value["schema"] == _SCHEMA and isinstance(value["workspaceId"], str) and
         re.fullmatch(r"research_[a-f0-9]{64}", value["workspaceId"]) and
         isinstance(value["dossierId"], str) and
         re.fullmatch(r"d_[a-f0-9-]{36}", value["dossierId"]),
         "RESEARCH_QUOTATION_RECEIVING_SELECTION_INVALID")
    name(value["operationId"]); native_id(value["caseId"])
    need(isinstance(value["steps"], list) and 1 <= len(value["steps"]) <= 200,
         "RESEARCH_QUOTATION_RECEIVING_STEPS_REQUIRED")
    call_ids, sources = set(), {}
    for item in value["steps"]:
        fields(item, _STEP, _CORE); call_id = _request_id(item["callId"])
        need(call_id not in call_ids, "RESEARCH_QUOTATION_RECEIVING_CALL_REUSED")
        call_ids.add(call_id)
        need(item["family"] in {"quotes", "commerce"}, "RESEARCH_QUOTATION_RECEIVING_FAMILY_INVALID")
        if item["family"] == "quotes":
            need(item["command"] in COMMANDS, "RESEARCH_QUOTATION_RECEIVING_COMMAND_INVALID")
            if item["command"] == "native-case":
                need({"caseId", "action"} <= set(item), "RESEARCH_QUOTATION_RECEIVING_COMMAND_INVALID")
                need(native_id(item["caseId"]) == value["caseId"], "RESEARCH_QUOTATION_RECEIVING_CASE_CHANGED")
            if item["command"] == "pricing":
                need({"profile", "action"} <= set(item), "RESEARCH_QUOTATION_RECEIVING_COMMAND_INVALID")
        else:
            need("commerce-" + item["command"].removeprefix("commerce-") in NATIVE_WRITES and
                 not ({"caseId", "action", "profile"} & set(item)),
                 "RESEARCH_QUOTATION_RECEIVING_COMMAND_INVALID")
        source = source_descriptor(item["source"])
        need(source["file"] not in sources or sources[source["file"]] == source,
             "RESEARCH_QUOTATION_RECEIVING_SOURCE_CHANGED")
        sources[source["file"]] = source
    _request_id(value["replayCallId"])
    replay = [item for item in value["steps"] if item["callId"] == value["replayCallId"]]
    need(len(replay) == 1 and replay[0]["family"] == "quotes" and
         replay[0]["command"] not in {"native-case", "pricing"},
         "RESEARCH_QUOTATION_RECEIVING_REPLAY_REQUIRED")
    need(isinstance(value["operations"], list) and 1 <= len(value["operations"]) <= 100,
         "RESEARCH_QUOTATION_RECEIVING_OPERATIONS_REQUIRED")
    operations = set()
    for item in value["operations"]:
        fields(item, {"id", "kind", "requestSha256"}, {"id", "kind", "requestSha256"})
        native_id(item["id"]); exact_hash(item["requestSha256"])
        need(item["id"] not in operations and item["kind"] in _KINDS,
             "RESEARCH_QUOTATION_RECEIVING_OPERATION_CHANGED")
        operations.add(item["id"])
    names = set()
    need(isinstance(value["caseExports"], list) and len(value["caseExports"]) <= 50,
         "RESEARCH_QUOTATION_RECEIVING_EXPORTS_INVALID")
    for item in value["caseExports"]:
        fields(item, {"name", "source", "tariff", "sha256", "bytes"},
               {"name", "source", "tariff", "sha256", "bytes"})
        name(item["name"]); exact_hash(item["sha256"])
        need(item["name"] not in names and type(item["tariff"]) is bool and
             type(item["bytes"]) is int and 0 <= item["bytes"] <= _FILE_LIMIT,
             "RESEARCH_QUOTATION_RECEIVING_EXPORTS_INVALID")
        names.add(item["name"])
        source = source_descriptor(item["source"])
        need(source["file"] not in sources or sources[source["file"]] == source,
             "RESEARCH_QUOTATION_RECEIVING_SOURCE_CHANGED")
        sources[source["file"]] = source
    names = set()
    need(isinstance(value["commerceExports"], list) and len(value["commerceExports"]) <= 100,
         "RESEARCH_QUOTATION_RECEIVING_EXPORTS_INVALID")
    for item in value["commerceExports"]:
        fields(item, {"name", "kind", "id", "part", "sha256"},
               {"name", "kind", "id", "part", "sha256"})
        name(item["name"]); native_id(item["id"]); exact_hash(item["sha256"])
        need(item["name"] not in names and item["kind"] in {"publications", "purchases"} and
             item["part"] in FILE_PARTS,
             "RESEARCH_QUOTATION_RECEIVING_EXPORTS_INVALID")
        names.add(item["name"])
    return value, sources


def original_file(root, relative, *, maximum):
    target = root
    for component in relative_file(relative).parts:
        target = target / component
        need(not target.is_symlink(), "RESEARCH_QUOTATION_SOURCE_SYMLINK")
    return read(target, maximum)


def retain_bytes(path, body):
    private_directory(path.parent)
    if path.exists() or path.is_symlink():
        need(read(path, max(_INPUT_LIMIT, _FILE_LIMIT)) == body, "RESEARCH_QUOTATION_RETAINED_FILE_CHANGED")
    else:
        write(path, body, exclusive=True)


def retain_json(path, value):
    retain_bytes(path, _json(value) + b"\n")
    return value


def first_observation(path, receive):
    if path.exists():
        return parse(read(path, _FILE_LIMIT))
    return retain_json(path, receive())


def cancelled(event):
    need(not event.is_set(), "RESEARCH_QUOTATION_RECEIVING_CANCELLED")


def capture(root, source_path, expected_sha256):
    target = root / "selection.json"
    if target.exists():
        body = read(target, 1024 * 1024)
        if source_path.exists() or source_path.is_symlink():
            need(read(source_path, 1024 * 1024) == body, "RESEARCH_QUOTATION_RECEIVING_SELECTION_CHANGED")
    else:
        body = read(source_path, 1024 * 1024)
    need(digest(body) == exact_hash(expected_sha256), "RESEARCH_QUOTATION_RECEIVING_SELECTION_CHANGED")
    chosen, sources = selection(parse(body))
    retain_bytes(target, body)
    retained = private_directory(root / "inputs")
    for relative, descriptor in sources.items():
        destination = retained / relative_file(relative)
        if destination.exists() or destination.is_symlink():
            data = read(destination, _INPUT_LIMIT)
            donor = source_path.parent / relative_file(relative)
            if donor.exists() or donor.is_symlink():
                need(original_file(source_path.parent, relative, maximum=_INPUT_LIMIT) == data,
                     "RESEARCH_QUOTATION_RECEIVING_SOURCE_CHANGED")
        else:
            donor_root = source_path.parent
            if not (donor_root / relative_file(relative)).exists():
                donor_root = donor_root / "inputs"
            data = original_file(donor_root, relative, maximum=_INPUT_LIMIT)
        need(len(data) == descriptor["bytes"] and digest(data) == descriptor["sha256"],
             "RESEARCH_QUOTATION_RECEIVING_SOURCE_CHANGED")
        _object(data)
        retain_bytes(destination, data)
    return chosen


def file_identity(path):
    information = path.lstat()
    need(stat.S_ISREG(information.st_mode) and not path.is_symlink(), "RESEARCH_QUOTATION_HANDOVER_FILE_INVALID")
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
    need(path.stat().st_size == information.st_size, "RESEARCH_QUOTATION_HANDOVER_FILE_CHANGED")
    return {"bytes": information.st_size, "sha256": sha.hexdigest()}


def cli_read(arguments, stdout_path):
    from stellar_forge_buyer.research_cli import main
    with stdout_path.open("w", encoding="utf-8") as output, stdout_path.with_suffix(".stderr").open("w", encoding="utf-8") as errors:
        with redirect_stdout(output), redirect_stderr(errors):
            code = main(arguments)
        output.flush(); os.fsync(output.fileno())
    need(code == 0, "RESEARCH_QUOTATION_RECEIVING_CLI_FAILED")
    return parse(read(stdout_path, _FILE_LIMIT))


def archive(handover, destination, operation):
    entries = []
    for directory, folders, names in os.walk(handover, followlinks=False):
        folders.sort(); names.sort()
        for child in folders:
            need(not (Path(directory) / child).is_symlink(), "RESEARCH_QUOTATION_HANDOVER_SYMLINK")
        for child in names:
            path = Path(directory) / child
            relative = path.relative_to(handover).as_posix()
            if relative == "manifest.json":
                continue
            entries.append({"path": relative, **file_identity(path)})
    manifest = {"schema": "stellar-forge.research-quotation-handover.v1",
                "operation": operation, "files": entries}
    retain_json(handover / "manifest.json", manifest)
    expected = {item["path"]: item for item in entries}
    expected["manifest.json"] = {"path": "manifest.json", **file_identity(handover / "manifest.json")}
    temporary = destination.with_suffix(".zip.pending")
    if not destination.exists():
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                             allowZip64=True, strict_timestamps=False) as output:
            for relative in sorted(expected):
                output.write(handover / relative, relative)
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.link(temporary, destination)
        temporary.unlink()
    with zipfile.ZipFile(destination) as saved:
        names = [item.filename for item in saved.infolist()]
        need(len(names) == len(set(names)) and set(names) == set(expected),
             "RESEARCH_QUOTATION_HANDOVER_INVENTORY_CHANGED")
        for relative, selected in expected.items():
            total, sha = 0, hashlib.sha256()
            with saved.open(relative) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    total += len(block); sha.update(block)
            need(total == selected["bytes"] and sha.hexdigest() == selected["sha256"],
                 "RESEARCH_QUOTATION_HANDOVER_MEMBER_CHANGED")
    return {"file": str(destination), **file_identity(destination), "members": len(expected),
            "manifest": {"file": str(handover / "manifest.json"),
                         **file_identity(handover / "manifest.json")}}


def receive(*, selection_file, expected_selection_sha256, directory, checkout, connection_file,
            node="node", timeout=900, request_timeout_ms=120000, cancel_event=None):
    root = private_directory(Path(directory).expanduser().absolute())
    handover = private_directory(root / "handover")
    event = cancel_event if cancel_event is not None else threading.Event()
    with lock(root):
        chosen = capture(handover, Path(selection_file).expanduser().absolute(), expected_selection_sha256)
        operation = {"id": chosen["operationId"], "workspaceId": chosen["workspaceId"],
                     "caseId": chosen["caseId"], "dossierId": chosen["dossierId"],
                     "selectionSha256": expected_selection_sha256}
        client_root = root / "client"
        reports = private_directory(handover / "operations")
        options = {"checkout": checkout, "node": node, "directory": client_root,
                   "connection_file": connection_file, "expected_workspace_id": chosen["workspaceId"],
                   "timeout": timeout, "request_timeout_ms": request_timeout_ms}
        results, export_calls, bundles, commerce_files = {}, [], [], []
        with ResearchWorkspace(**options) as workspace:
            quotes, commerce = workspace.quotes(), workspace.commerce()
            status = workspace.status(cancel_event=event)
            need(status["workspaceId"] == chosen["workspaceId"], "RESEARCH_WORKSPACE_CHANGED")
            first_observation(handover / "configuration.json", lambda: quotes.configuration(cancel_event=event))
            for number, step in enumerate(chosen["steps"], 1):
                cancelled(event)
                source = handover / "inputs" / relative_file(step["source"]["file"])
                family = quotes if step["family"] == "quotes" else commerce
                if step["family"] == "quotes":
                    result = quotes.submit_file(step["command"], source, call_id=step["callId"],
                        expected_input_sha256=step["source"]["sha256"], resume=True, cancel_event=event,
                        case_id=step.get("caseId"), action=step.get("action"), profile=step.get("profile"))
                else:
                    result = commerce.submit(step["command"], _object(read(source, _INPUT_LIMIT)),
                                             call_id=step["callId"], resume=True, cancel_event=event)
                results[step["callId"]] = result
                retain_json(reports / (str(number).zfill(3) + "-result.json"), result)
                saved = family.saved(step["callId"])
                need(saved["completed"] is True and saved["result"] == result,
                     "RESEARCH_QUOTATION_RECEIVING_CALL_CHANGED")
            for selected in chosen["operations"]:
                cancelled(event)
                identifier = selected["id"]
                current = quotes.operation(identifier, cancel_event=event)
                need(current["workspaceId"] == chosen["workspaceId"] and
                     current["kind"] == selected["kind"] and current["status"] == "COMPLETE" and
                     current["requestSha256"] == selected["requestSha256"],
                     "RESEARCH_QUOTATION_RECEIVING_OPERATION_CHANGED")
                retain_json(reports / (identifier + ".json"), current)
                call_id = "quotation-export:" + identifier
                exported = quotes.export_operation(identifier, call_id=call_id, resume=True, cancel_event=event)
                export_calls.append(call_id)
                bundle = quotes.copy_export(call_id, handover / "quotation-files" / identifier,
                                            copy_id="quotation-copy:" + identifier, resume=True, cancel_event=event)
                ResearchQuoteBundle(bundle).verify()
                bundles.append({"kind": selected["kind"], "id": identifier, **bundle,
                                "relativeDirectory": "quotation-files/" + identifier})
                retain_json(reports / (identifier + "-export.json"), exported)
                if len(bundles) == 1 and exported["files"]:
                    file = exported["files"][0]
                    metadata = quotes.file_info(identifier, file["name"], cancel_event=event)
                    need(metadata["descriptor"]["sha256"] == file["sha256"] and
                         metadata["descriptor"]["bytes"] == file["bytes"],
                         "RESEARCH_QUOTATION_RECEIVING_FILE_CHANGED")
                    single_call = "quotation-file:" + identifier
                    downloaded = quotes.download(identifier, file["name"], call_id=single_call,
                        expected_sha256=file["sha256"], expected_bytes=file["bytes"],
                        resume=True, cancel_event=event)
                    with quotes.downloaded_file(downloaded).open():
                        pass
                    export_calls.append(single_call)
                    retain_json(reports / "complete-individual-download.json", {
                        "result": downloaded, "bundleFile": "quotation-files/" + identifier + "/" + file["name"]})
            for item in chosen["caseExports"]:
                cancelled(event)
                call_id = "quotation-case-file:" + item["name"]
                exported = quotes.export_case(chosen["caseId"], input_file=handover / "inputs" / item["source"]["file"],
                    expected_input_sha256=item["source"]["sha256"], call_id=call_id, resume=True,
                    tariff=item["tariff"], expected_sha256=item["sha256"], expected_bytes=item["bytes"],
                    cancel_event=event)
                export_calls.append(call_id)
                bundle = quotes.copy_export(call_id, handover / "commercial-files" / item["name"],
                    copy_id="quotation-case-copy:" + item["name"], resume=True, cancel_event=event)
                bundles.append({"kind": "TARIFF" if item["tariff"] else "CASE_FILE", "id": item["name"], **bundle,
                                "relativeDirectory": "commercial-files/" + item["name"]})
                retain_json(reports / ("case-" + item["name"] + ".json"), exported)
            for item in chosen["commerceExports"]:
                cancelled(event)
                call_id = "quotation-commerce:" + item["name"]
                result = commerce.export(item["kind"], item["id"], item["part"], call_id=call_id,
                    expected_sha256=item["sha256"], resume=True, cancel_event=event)
                original = commerce.exported_file(result)
                target = handover / "paid-delivery" / item["name"]
                private_directory(target.parent)
                if target.exists():
                    with _retained_file({**original.delivery, "path": str(target)}).open():
                        pass
                else:
                    original.save_as(target)
                commerce_files.append({"name": item["name"], "kind": item["kind"], "id": item["id"],
                                       "part": item["part"], "callId": call_id, **file_identity(target)})
                retain_json(reports / ("commerce-" + item["name"] + ".json"), result)
            replay_id = "quotation-replay:" + digest(chosen["replayCallId"].encode())
            replay = quotes.replay(chosen["replayCallId"], replay_id=replay_id, cancel_event=event)
            need(replay["result"] == results[chosen["replayCallId"]]["result"],
                 "RESEARCH_QUOTATION_RECEIVING_REPLAY_CHANGED")
            retain_json(reports / "original-request-replay.json", replay)
            first_observation(handover / "dossier-quotation-pages.json",
                lambda: list(quotes.iter_pages(dossier_id=chosen["dossierId"], cancel_event=event)))
        # The first client is closed before reopening calls and exercising the
        # installed CLI. Completed local reads need no Research connection.
        offline_options = {**options, "connection_file": None}
        with ResearchWorkspace(**offline_options) as reopened:
            client = reopened.quotes()
            for step in chosen["steps"]:
                family = client if step["family"] == "quotes" else reopened.commerce()
                saved = family.saved(step["callId"])
                need(saved["completed"] and saved["result"] == results[step["callId"]],
                     "RESEARCH_QUOTATION_RECEIVING_REOPEN_CHANGED")
            for call_id in export_calls:
                saved = client.saved(call_id)
                recovered = client.recover(call_id, cancel_event=event)
                need(recovered == saved["result"], "RESEARCH_QUOTATION_RECEIVING_REOPEN_CHANGED")
        cli_directory = private_directory(handover / "cli")
        cli_saved = cli_read(["--checkout", str(checkout), "--node", str(node),
            "--directory", str(client_root), "quotes-saved", chosen["replayCallId"]],
            cli_directory / "saved-result.json")
        need(cli_saved["completed"] and cli_saved["result"] == results[chosen["replayCallId"]],
             "RESEARCH_QUOTATION_RECEIVING_CLI_CHANGED")
        for index, bundle in enumerate(bundles):
            received = ResearchQuoteBundle.reopen(bundle["directory"],
                expected_manifest_sha256=bundle["manifest"]["sha256"])
            received.verify()
            result = cli_read(["--directory", bundle["directory"], "quotes-bundle-inspect",
                "--manifest-sha256", bundle["manifest"]["sha256"]],
                cli_directory / ("bundle-" + str(index).zfill(3) + ".json"))
            need(result["receiving"]["selectionSha256"] == bundle["selectionSha256"],
                 "RESEARCH_QUOTATION_RECEIVING_CLI_CHANGED")
        result = {"schema": _RESULT, "state": "COMPLETE", "operation": operation,
                  "steps": [{"callId": item["callId"], "family": item["family"], "command": item["command"]}
                            for item in chosen["steps"]],
                  "originalRequestReplay": {"callId": chosen["replayCallId"], "replayId": replay_id},
                  "exports": bundles, "commerceFiles": commerce_files,
                  "clientsClosed": True, "offlineReopened": True, "installedCliReceived": True}
        retain_json(handover / "receiving.json", result)
        guide = ("# Received Research quotation programme\n\n"
            "This directory contains the complete selected native requests and files.\n\n"
            "Operation: " + chosen["operationId"] + "\n\n"
            "Open receiving.json for the complete result and every portable quotation bundle. "
            "Each bundle keeps quote-export.json and quote-export-selection.json beside all its original files. "
            "Use ResearchQuoteBundle.reopen(directory, expected_manifest_sha256=the recorded SHA256) "
            "after copying that complete directory to another computer. The installed quotes-bundle-inspect "
            "command provides the same local receiving operation.\n\n"
            "The original selected case, quoted scope, customer responses, pricing, paid-publication and "
            "Buyer request identities are preserved in operations/ and inputs/. Later customer work "
            "uses its later native request; this handover reopens the completed selected programme.\n")
        retain_bytes(handover / "RECEIVING.md", guide.encode("utf-8"))
        archived = archive(handover, root / "research-quotation-delivery.zip", operation)
        final = {**result, "archive": archived, "handover": str(handover)}
        retain_json(root / "result.json", final)
        return final


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--selection-sha256", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--connection", required=True)
    parser.add_argument("--node", default="node")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--request-timeout-ms", type=int, default=120000)
    arguments = parser.parse_args(argv)
    event, previous = threading.Event(), {}
    for kind in (signal.SIGINT, signal.SIGTERM):
        previous[kind] = signal.signal(kind, lambda *_: event.set())
    try:
        result = receive(selection_file=arguments.selection, expected_selection_sha256=arguments.selection_sha256,
            directory=arguments.directory, checkout=arguments.checkout, connection_file=arguments.connection,
            node=arguments.node, timeout=arguments.timeout, request_timeout_ms=arguments.request_timeout_ms,
            cancel_event=event)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except ResearchError as error:
        print(json.dumps({"error": error.code, "requestId": error.request_id, "record": error.record},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    except (BuyerError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": getattr(error, "code", type(error).__name__), "detail": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2
    finally:
        for kind, handler in previous.items():
            signal.signal(kind, handler)


if __name__ == "__main__":
    raise SystemExit(main())
