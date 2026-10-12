"""Run the original publication capture and complete portable receiving workflow.

The publisher calls capture while each actual edition is selected. finish reuses
those exact responses, operates the browser, exports, and opens a fresh receiver.
"""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

from publication_plan import publication_input, existing_sessions
from qwc_acceptance import (PublicationReview, AcceptanceError, MAX_BODY, MAX_CONFIG,
    MAX_SOURCE, SCHEMA, descriptor, evaluate, identifier, load_json, need, pack,
    read_file, receive, relative, replace_json, retain, sha, stamp)

JOURNEY_SCHEMA = "starforge.stac-qwc-native-review-journey.v1"
HERE = Path(__file__).resolve().parent


@contextlib.contextmanager
def lifetime(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(directory / "native-journey.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "JOURNEY_LOCK", "Use the original private journey lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise AcceptanceError("JOURNEY_ACTIVE", "The original native customer operation already has its owner") from exc
        yield fd
    finally:
        os.close(fd)


def identity_file(path, limit=512 * 1024 * 1024):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "NATIVE_INPUT", "Select a bounded original regular file")
        digest, count = hashlib.sha256(), 0
        with os.fdopen(fd, "rb", closefd=False) as stream:
            while part := stream.read(1024 * 1024):
                count += len(part)
                digest.update(part)
        need(count == info.st_size, "NATIVE_INPUT_CHANGED", str(path))
        return {"path": str(path), "bytes": count, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def original_journey(directory, config):
    path = directory / "native-journey.json"
    if path.exists():
        value = load_json(read_file(path, 32 * 1024 * 1024))
        need(value["schema"] == JOURNEY_SCHEMA and value["operation_id"] == config["operation_id"],
             "JOURNEY_ID", "Continue the original native customer operation")
        need(value["actor"] == config["actor"], "JOURNEY_ACTOR", "Continue with the original selected operator")
        return value
    return {"schema": JOURNEY_SCHEMA, "operation_id": identifier(config["operation_id"]),
            "actor": config["actor"], "created_at": stamp(), "captures": {}, "stages": {}, "attempts": []}


def save(directory, report):
    replace_json(directory / "native-journey.json", report)


def stage_id(operation, kind, selection):
    return kind + "-" + sha(pack([operation, selection]))[:48]


def capture(config):
    directory = Path(config["directory"]).absolute()
    capture_id = identifier(config["capture_id"])
    with lifetime(directory):
        report = original_journey(directory, config)
        need(report.get("state") != "COMPLETE", "JOURNEY_COMPLETE", "This complete native journey is retained. Continue later acceptance in its received workspace with a new journey identity.")
        selected = publication_input(config["publication"], config["profile"],
                                     expected_sha256=config["expected_publication_sha256"])
        plan = selected["plan"]
        selection = {"publication_sha256": selected["publication_sha256"],
                     "profile_sha256": selected["profile_sha256"], "plan_sha256": sha(pack(plan)),
                     "sources": {name: {"bytes": len(raw), "sha256": sha(raw)}
                                 for name, raw in sorted(selected["sources"].items())}}
        fingerprint = sha(pack(selection))
        old = report["captures"].get(capture_id)
        need(old is None or old["fingerprint"] == fingerprint, "CAPTURE_SELECTION_CHANGED",
             "A retained capture stage cannot select a different publication or request profile")
        root = directory / "workspace"
        review = PublicationReview(root) if root.exists() else PublicationReview.create(root, config.get("title", "QWC publication review"))
        report["workspace_id"] = review.workspace_id
        phase = old or {"capture_id": capture_id, "fingerprint": fingerprint, "selection": selection,
                        "run_id": plan["run_id"], "started_at": stamp(), "responses": {}}
        report["captures"][capture_id] = phase
        save(directory, report)
        review.add_run(plan, selected["sources"], actor=config["actor"],
                       operation_id=stage_id(config["operation_id"], "publication", [plan["run_id"], fingerprint]))
        # Resolve an existing session only if a selected native operation has no completed original result.
        sessions = None
        check_order = sorted(plan["checks"], key=lambda item: item["operation"] != "GetCapabilities")
        for check in check_order:
            for role in plan["roles"]:
                key = check["id"] + "/" + role["id"]
                operation_id = stage_id(config["operation_id"], "native", [capture_id, key])
                completed = review.read()["operations"].get(operation_id)
                if completed and completed["state"] == "COMPLETE":
                    result = review.capture(plan["run_id"], check["id"], role["id"],
                        operation_id=operation_id, actor=config["actor"])
                else:
                    if sessions is None:
                        sessions = existing_sessions(selected["session_bindings"])
                    result = review.capture(plan["run_id"], check["id"], role["id"],
                        operation_id=operation_id, actor=config["actor"], session=sessions.get(role["id"]))
                phase["responses"][key] = {"operation_id": operation_id,
                    "body": result["body"], "metadata": identity_file(review.root / "captures" / operation_id / "capture.json"),
                    "evaluation": result["evaluation"]["state"],
                    "issue_codes": [item["code"] for item in result["evaluation"]["issues"]]}
                save(directory, report)
        phase.update({"state": "COMPLETE", "completed_at": stamp(), "response_count": len(phase["responses"]),
                      "review_count": sum(item["evaluation"] != "PASS" for item in phase["responses"].values())})
        save(directory, report)
        return phase


def read_startup(process, log_path, timeout=30):
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline, lines = time.monotonic() + timeout, []
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AcceptanceError("OPERATOR_START", "The original operator exited before its local address", exit_code=process.returncode)
            for key, _ in selector.select(min(0.25, max(0, deadline - time.monotonic()))):
                line = key.fileobj.readline()
                if not line:
                    continue
                lines.append(line)
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if value.get("origin", "").startswith("http://127.0.0.1:"):
                    retain(log_path, "".join(lines).encode())
                    return value
        raise AcceptanceError("OPERATOR_START_TIMEOUT", "The original operator did not return its startup address")
    finally:
        selector.close()


def stop(process):
    if process is None:
        return
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
            raise AcceptanceError("OPERATOR_DRAIN", "The original operator did not drain within its declared close window")



def process_identity(process, argv, lease_fd):
    stat_text = Path(f"/proc/{process.pid}/stat").read_text()
    tail = stat_text[stat_text.rfind(")") + 2:].split()
    return {"pid": process.pid, "process_group": process.pid, "start_ticks": tail[19],
            "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "argv": [str(value) for value in argv], "selected_at": stamp(),
            "lifetime": "inherited original journey flock", "inherited_descriptor": lease_fd}


def record_exit(path, process):
    if process is not None and process.poll() is not None:
        retain(path, pack({"pid": process.pid, "ended_at": stamp(), "exit_code": process.returncode}))


def browser_operation(config, directory, phase, server_source, workspace, input_value, lease_fd):
    browser = config["browser"]
    stage = directory / phase
    stage.mkdir(parents=True, exist_ok=True, mode=0o700)
    # A finished browser result is reopened from its exact retained artifact instead of rerunning the customer.
    result_path = stage / "browser-result.json"
    if result_path.exists():
        value = load_json(read_file(result_path, MAX_CONFIG))
        need(value["phase"] == phase and value["workspace_id"] == config["workspace_id"],
             "BROWSER_RESULT_BINDING", "The retained browser result belongs to another operation")
        for item in value.get("artifacts", []):
            current = identity_file(item["path"])
            need(current["bytes"] == item["bytes"] and current["sha256"] == item["sha256"],
                 "BROWSER_ARTIFACT_CHANGED", item["path"])
        return value
    error_log = (stage / "operator-stderr.log").open("ab")
    process = None
    try:
        server_argv = [sys.executable, "-B", str(server_source), "--workspace", str(workspace), "--port", "0"]
        process = subprocess.Popen(server_argv,
            cwd=server_source.parent, stdout=subprocess.PIPE, stderr=error_log, text=True,
            start_new_session=True, pass_fds=(lease_fd,))
        retain(stage / f"operator-process-{process.pid}.json", pack(process_identity(process, server_argv, lease_fd)))

        startup = read_startup(process, stage / ("operator-start-" + str(process.pid) + ".json"))
        need(startup["workspace_id"] == config["workspace_id"], "OPERATOR_WORKSPACE",
             "The local operator opened a different workspace")
        argv = [browser["node"], str(HERE / "browser_journey.mjs")]
        child_input = {**input_value, "phase": phase, "origin": startup["origin"], "directory": str(stage),
                       "workspace_id": config["workspace_id"], "actor": config["actor"],
                       "playwright_module": browser["playwright_module"], "chrome": browser["chrome"]}
        input_path = stage / ("browser-input-" + str(process.pid) + ".json")
        retain(input_path, pack(child_input))
        argv.extend(["--input", str(input_path)])
        with (stage / "browser-stdout.log").open("ab") as output:
            child = None
            try:
                child = subprocess.Popen(argv, cwd=HERE, stdout=output, stderr=subprocess.STDOUT,
                                         start_new_session=True, pass_fds=(lease_fd,),
                                         env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
                retain(stage / f"browser-process-{child.pid}.json", pack(process_identity(child, argv, lease_fd)))
                code = child.wait(timeout=config.get("browser_timeout", 300))
                need(code == 0, "BROWSER_OPERATION", "The complete native browser operation requires its retained result", exit_code=code)
            finally:
                try:
                    stop(child)
                finally:
                    if child is not None:
                        record_exit(stage / f"browser-exit-{child.pid}.json", child)
        value = load_json(read_file(result_path, MAX_CONFIG))
        need(value["phase"] == phase and value["workspace_id"] == config["workspace_id"],
             "BROWSER_RESULT_BINDING", "The original browser result identity differs")
        return value
    finally:
        try:
            stop(process)
        finally:
            try:
                if process is not None:
                    record_exit(stage / f"operator-exit-{process.pid}.json", process)
            finally:
                error_log.close()


def verify_archive(path, expected):
    current = identity_file(path)
    need(current["bytes"] == expected["bytes"] and current["sha256"] == expected["sha256"],
         "HANDOVER_BYTES", "The downloaded original handover differs from its receipt")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        need(len(names) == len(set(names)), "HANDOVER_INVENTORY", "Duplicate handover member")
        manifest_raw = archive.read("manifest.json")
        manifest = load_json(manifest_raw)
        need(manifest["schema"] == SCHEMA, "HANDOVER_SCHEMA", "The original handover schema differs")
        members = {item["path"]: item for item in manifest["members"]}
        need(set(names) == set(members) | {"manifest.json"}, "HANDOVER_INVENTORY", "The complete handover inventory differs")
        for name, item in members.items():
            digest, size = hashlib.sha256(), 0
            with archive.open(name) as stream:
                while part := stream.read(1024 * 1024):
                    size += len(part)
                    digest.update(part)
            need(size == item["bytes"] and digest.hexdigest() == item["sha256"], "HANDOVER_MEMBER", name)
    return {**current, "manifest_sha256": sha(manifest_raw), "members": len(names),
            "workspace_id": manifest["workspace_id"], "operation_id": manifest["operation_id"]}



def publish_native_delivery(directory, prepared):
    """Publish or reconcile the frozen complete original delivery selection."""
    selected, manifest = prepared["selected"], prepared["manifest"]
    manifest_raw = pack(manifest)
    package = directory / "QWC_Complete_Native_Receiving.zip"
    expected_names = set(selected) | {"delivery-manifest.json"}
    if package.exists():
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            need(len(names) == len(set(names)) and set(names) == expected_names and
                 archive.read("delivery-manifest.json") == manifest_raw, "DELIVERY_SELECTION",
                 "Preserve a previously published native delivery with a different selection")
            for name, item in selected.items():
                digest, count = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    while part := stream.read(1024 * 1024):
                        count += len(part)
                        digest.update(part)
                need(count == item["bytes"] and digest.hexdigest() == item["sha256"], "DELIVERY_MEMBER", name)
    else:
        fd, temporary = tempfile.mkstemp(prefix=".qwc-native-", suffix=".zip", dir=directory)
        os.close(fd)
        try:
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name, item in sorted(selected.items()):
                    current = identity_file(item["path"])
                    need(current["bytes"] == item["bytes"] and current["sha256"] == item["sha256"],
                         "DELIVERY_MEMBER_CHANGED", name)
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.external_attr = 0o100600 << 16
                    info.compress_type = zipfile.ZIP_STORED if name.endswith((".zip", ".png", ".pdf")) else zipfile.ZIP_DEFLATED
                    digest, count = hashlib.sha256(), 0
                    with open(item["path"], "rb") as source, archive.open(info, "w", force_zip64=True) as target:
                        while part := source.read(1024 * 1024):
                            target.write(part)
                            digest.update(part)
                            count += len(part)
                    need(count == item["bytes"] and digest.hexdigest() == item["sha256"], "DELIVERY_MEMBER_CHANGED", name)
                info = zipfile.ZipInfo("delivery-manifest.json", (1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100600 << 16
                archive.writestr(info, manifest_raw)
            with open(temporary, "rb") as stream:
                os.fsync(stream.fileno())
            os.link(temporary, package)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temporary)
    result = {**identity_file(package), "operation_id": prepared["operation_id"],
              "workspace_id": prepared["workspace_id"], "state": "COMPLETE",
              "member_count": len(selected) + 1, "manifest_sha256": sha(manifest_raw)}
    retain(directory / "complete-delivery.json", pack(result))
    return result


def finish(config):
    directory = Path(config["directory"]).absolute()
    with lifetime(directory) as lease_fd:
        report = original_journey(directory, config)
        review = PublicationReview(directory / "workspace")
        need(report.get("workspace_id") == review.workspace_id, "JOURNEY_WORKSPACE", "Continue the original captured workspace")
        finish_selection = {"capture_ids": config["capture_ids"], "workspace_id": review.workspace_id}
        finish_fingerprint = sha(pack(finish_selection))
        need(report.get("finish_fingerprint", finish_fingerprint) == finish_fingerprint,
             "FINISH_SELECTION_CHANGED", "Continue the original selected native editions")
        report["finish_fingerprint"] = finish_fingerprint
        completed_path = directory / "complete-delivery.json"
        if completed_path.exists():
            completed = load_json(read_file(completed_path, MAX_CONFIG))
            current = identity_file(completed["path"])
            need(completed["operation_id"] == config["operation_id"] and
                 completed["workspace_id"] == review.workspace_id and
                 current["bytes"] == completed["bytes"] and current["sha256"] == completed["sha256"],
                 "COMPLETE_DELIVERY_CHANGED", "The retained complete native delivery differs")
            return completed
        prepared_path = directory / "native-delivery.prepared.json"
        if prepared_path.exists():
            prepared = load_json(read_file(prepared_path, MAX_CONFIG))
            need(prepared["finish_fingerprint"] == finish_fingerprint and
                 prepared["operation_id"] == config["operation_id"] and prepared["workspace_id"] == review.workspace_id,
                 "DELIVERY_PREPARED_SELECTION", "Continue the original frozen native delivery")
            return publish_native_delivery(directory, prepared)
        capture_ids = config["capture_ids"]
        need(isinstance(capture_ids, list) and len(capture_ids) == 2 and len(set(capture_ids)) == 2,
             "TWO_EDITIONS", "Select the two original native capture stages")
        phases = [report["captures"][value] for value in capture_ids]
        need(all(value.get("state") == "COMPLETE" for value in phases), "NATIVE_CAPTURES",
             "Complete both original publication captures before receiving")
        need(phases[0]["selection"]["publication_sha256"] != phases[1]["selection"]["publication_sha256"],
             "DISTINCT_PUBLICATIONS", "Select two actual different publication manifests")
        run_ids = [value["run_id"] for value in phases]
        need(len(set(run_ids)) == 2, "DISTINCT_RUNS", "Each native publication edition needs its own retained run")
        plans = [review.plan(run_id) for run_id in run_ids]
        for plan in plans:
            actual = {check["operation"] for check in plan["checks"]}
            need({"GetCapabilities", "GetProjectSettings", "GetMap", "GetFeatureInfo", "GetPrint"} <= actual,
                 "COMPLETE_PUBLICATION_OPERATIONS", "The full customer workflow includes metadata, map, feature information and print")
        all_records = []
        for phase in phases:
            for result in phase["responses"].values():
                record = review.capture_record(result["operation_id"])
                need(record["body"] == result["body"], "CAPTURE_BODY", "The retained native response changed")
                all_records.append(record)
        # A focused source-native evaluator check covers the concrete denial defect.
        normal = next((item for item in all_records if item["request"]["operation"] == "GetCapabilities"
                       and item["evaluation"]["state"] == "PASS"), None)
        need(normal is not None, "CAPABILITIES_REVIEW", "Select a completed native capability response for the full receiving journey")
        source_plan = review.plan(normal["run_id"])
        source_check = next(item for item in source_plan["checks"] if item["id"] == normal["check_id"])
        selected = {**source_check, "expect": {"status": [200], "denial_codes": ["LayerNotDefined"]}, "role_expectations": {}}
        diagnostic = evaluate(selected, normal["role_id"], normal["response"], review.member(normal["body"]))
        need(any(item["code"] == "EXPECTED_DENIAL_MISSING" for item in diagnostic["issues"]),
             "DENIAL_EVALUATOR", "The actual allowed native response must not pass an expected-denial profile")
        report["stages"]["denial_evaluator"] = {"source_capture_id": normal["operation_id"],
            "source_body_sha256": normal["body"]["sha256"], "result": diagnostic["state"],
            "issue_codes": [item["code"] for item in diagnostic["issues"]]}
        if "comparison" not in report["stages"]:
            report["stages"]["comparison"] = review.compare(*run_ids)
        save(directory, report)
        first = normal
        input_value = {"run_ids": run_ids, "capture_id": first["operation_id"],
            "capture_run": first["run_id"], "capture_check": first["check_id"], "capture_role": first["role_id"],
            "body": str(review.root / first["body"]["path"]),
            "metadata": str(review.root / "captures" / first["operation_id"] / "capture.json"),
            "body_sha256": first["body"]["sha256"], "native_response_count": len(all_records),
            "operation_id": config["operation_id"]}
        browser_config = {**config, "workspace_id": review.workspace_id}
        operated = browser_operation(browser_config, directory, "operate", HERE / "server.py", review.root, input_value, lease_fd)
        report["stages"]["operate"] = operated
        first_archive = verify_archive(operated["archive"]["path"], operated["archive"])
        report["stages"]["first_archive"] = first_archive
        save(directory, report)
        received_root = directory / "received"
        if received_root.exists():
            receipt = load_json(read_file(received_root / "receiving.json", MAX_CONFIG))
            need(receipt["archive_sha256"] == first_archive["sha256"] and receipt["workspace_id"] == review.workspace_id,
                 "RECEIVING_EXISTS", "Preserve a receiving directory selected from another original archive")
            reopened = PublicationReview(received_root / "workspace")
            reopened.overview()
            received = report["stages"].get("received") or {"directory": str(received_root), "workspace": str(reopened.root),
                        "workspace_id": reopened.workspace_id, "archive_sha256": first_archive["sha256"]}
        else:
            received = receive(first_archive["path"], received_root, expected_sha256=first_archive["sha256"])
        report["stages"]["received"] = received
        save(directory, report)
        final = browser_operation(browser_config, directory, "reopen", received_root / "software" / "server.py",
            received_root / "workspace", {**input_value, "original_export_id": first_archive["operation_id"],
                "original_archive_sha256": first_archive["sha256"]}, lease_fd)
        report["stages"]["reopen"] = final
        final_archive = verify_archive(final["archive"]["path"], final["archive"])
        need(final_archive["workspace_id"] == first_archive["workspace_id"] and
             final_archive["operation_id"] != first_archive["operation_id"], "RECEIVING_NEW_EXPORT",
             "A fresh receiving export keeps workspace identity and its own original request")
        report["stages"]["final_archive"] = final_archive
        report.update({"state": "COMPLETE", "completed_at": report.get("completed_at") or stamp(), "run_ids": run_ids})
        save(directory, report)
        selected = {"native-journey.json": identity_file(directory / "native-journey.json"),
                    "original-handover.zip": first_archive, "received-handover.zip": final_archive}
        for phase in ("operate", "reopen"):
            result = report["stages"][phase]
            selected[phase + "/browser-result.json"] = identity_file(directory / phase / "browser-result.json")
            for item in result["artifacts"]:
                name = phase + "/" + Path(item["path"]).name
                need(name not in selected, "DELIVERY_MEMBER", "A complete receiving artifact name is duplicated")
                selected[name] = item
        manifest = {"schema": JOURNEY_SCHEMA, "operation_id": config["operation_id"],
                    "workspace_id": review.workspace_id,
                    "members": [{**value, "path": name} for name, value in sorted(selected.items())]}
        prepared = {"schema": JOURNEY_SCHEMA, "finish_fingerprint": finish_fingerprint,
                    "operation_id": config["operation_id"], "workspace_id": review.workspace_id,
                    "selected": selected, "manifest": manifest}
        retain(directory / "native-delivery.prepared.json", pack(prepared))
        return publish_native_delivery(directory, prepared)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("capture", "finish"))
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    value = load_json(read_file(args.config, MAX_CONFIG))
    need(value.get("schema") == JOURNEY_SCHEMA, "JOURNEY_SCHEMA", "Use the original complete customer configuration")
    def interrupted(signum, frame):
        raise KeyboardInterrupt("The original native journey was interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    result = capture(value) if args.phase == "capture" else finish(value)
    print(pack(result).decode(), end="")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        result = exc.as_dict() if isinstance(exc, AcceptanceError) else {"code": type(exc).__name__, "message": str(exc)[:2000]}
        print(pack({"error": result}).decode(), file=sys.stderr, end="")
        raise SystemExit(1)
