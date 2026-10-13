#!/usr/bin/env python3
"""Continue one original cohort through the native queue, reports and editable Study receiving."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
for directory in (APPLICATION, APPLICATION / "operator"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

def load_native():
    # Keep native application imports inside the supervised owned process.
    global atomic_json, canonical, describe_file, digest, file_digest, read_json, verify_file
    global comparisons, reports, observed_context, portable, study_receiving, study_transfer
    global Operator, Fault, ScientificReportEditions
    from model.common import atomic_json, canonical, describe_file, digest, file_digest, read_json, verify_file
    from model import observation_comparability_store as comparisons
    from model import scientific_report_editions as reports
    from model import observed_context, portable, study_receiving, study_transfer
    from server import Operator, Fault
    from source_report_editions import ScientificReportEditions

SCHEMA = "upstate.observation-comparability-receiving/v1"
MEMBERS = (
    "source_tools/receive_observation_comparability.py",
    "measurement_workspace/observation_comparability.py",
    "measurement_workspace/observation_comparability.html",
    "model/observation_comparability_store.py",
    "model/observation_comparability_study_transfer.py",
    "operator/observation_comparability_operator.py",
    "operator/extensions/observation-comparability.json",
    "operator/web/observation_comparability.mjs",
    "operator/web/comparability_received_studies.mjs",
    "model/scientific_report_editions.py", "model/observed_report_render.py",
    "model/observed_context.py", "model/scientific_report.py",
    "model/study_transfer.py", "model/scientific_report_study_transfer.py",
    "model/study_receiving.py", "model/portable.py", "operator/server.py",
)
PRODUCT_FIELDS = ("project_id", "selection_id", "selection", "source", "counts",
                  "scientific_report_edition_id", "comparison_files", "report_files")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def emit(phase, **values):
    print(json.dumps({"phase": phase, **values}, ensure_ascii=False, sort_keys=True), flush=True)


def consume_download(operator, ticket, destination=None):
    """Read the real authorized file stream and keep its full original bytes."""
    stream, item = operator.open_download(ticket["id"])
    checksum, count, target = hashlib.sha256(), 0, None
    pending = Path(str(destination) + ".partial") if destination else None
    try:
        if pending:
            pending.parent.mkdir(parents=True, exist_ok=True)
            target = pending.open("wb")
        while block := stream.read(1024 * 1024):
            checksum.update(block)
            count += len(block)
            if target:
                target.write(block)
        if target:
            target.flush()
            os.fsync(target.fileno())
    finally:
        stream.close()
        if target:
            target.close()
    require(count == ticket["bytes"] == item["bytes"]
            and checksum.hexdigest() == ticket["sha256"] == item["sha256"],
            "The original download differs from its native ticket")
    if destination:
        destination = Path(destination)
        if destination.exists():
            require(destination.stat().st_size == count
                    and file_digest(destination) == checksum.hexdigest(),
                    "The retained download belongs to another original output")
            pending.unlink()
        else:
            os.link(pending, destination)
            pending.unlink()
    return {"filename": item["filename"], "bytes": count, "sha256": checksum.hexdigest(),
            **({"path": str(Path(destination).resolve())} if destination else {})}


def check_product(operator, workspace_key, selection_id, report_id, study_id=None):
    workspace = operator.ws(workspace_key)
    value = operator.extensions.read(
        "GET", "/api/observation-comparability/edition", workspace_key, {"id": selection_id})
    original = comparisons.inspect(workspace, selection_id)
    require(value["edition"] == original["edition"] and value["data"] == original["data"],
            "The native comparison reader differs from the retained source")
    edition = original["edition"]
    report, directory, operation = reports.inspect(workspace, report_id)
    choices = observed_context.source_choices(report["render_identity"]["selection"])
    require(choices == [edition["source"]], "The saved report belongs to another original comparison")
    require({"report_pdf", "report_html", "report_markdown", "report_data"} <= set(operation["files"]),
            "Retain all four original scientific report outputs")
    pdf = verify_file(directory, operation["files"]["report_pdf"])
    with pdf.open("rb") as stream:
        require(stream.read(5) == b"%PDF-", "The retained report has no original PDF")
    detail = ScientificReportEditions(operator, Fault).detail(workspace_key, report_id)
    comparison_downloads = [consume_download(operator, row) for row in value["_downloads"]]
    report_downloads = [consume_download(operator, row) for row in detail["_downloads"]]
    product = {
        "project_id": workspace.project["id"], "selection_id": selection_id,
        "selection": edition["selection"], "source": edition["source"], "counts": edition["counts"],
        "scientific_report_edition_id": report_id,
        "comparison_files": {name: {field: item[field] for field in ("bytes", "sha256")}
                             for name, item in sorted(edition["files"].items())},
        "report_files": {name: {field: item[field] for field in ("bytes", "sha256")}
                         for name, item in sorted(operation["files"].items())},
        "comparison_downloads": comparison_downloads, "report_downloads": report_downloads,
    }
    if study_id:
        actual = study_receiving.detail(workspace, study_id)
        rows = [row for row in actual.get("comparable_period_sources", [])
                if row["native_origin"]["selection_id"] == selection_id
                and row["source_collection_id"] == edition["source"]["source_collection_id"]
                and row["source_id"] == edition["source"]["source_id"]]
        require(len(rows) == 1 and rows[0].get("native_comparison")
                and rows[0]["native_comparison"]["id"] == selection_id,
                "The received Study lost the exact original comparison editor")
        statuses = study_transfer.verify_received_studies(workspace)
        require(any(row["id"] == study_id and row["identity"] == "MATCH" for row in statuses),
                "The received Study differs from its original complete source closure")
        public = operator.extensions.read("GET", "/api/study-transfer/received-detail",
                                          workspace_key, {"study_id": study_id})
        require(public["workspace_key"] == workspace_key and public["id"] == study_id
                and public["comparable_period_sources"] == actual["comparable_period_sources"],
                "The received browser card differs from its original native lineage")
        product["selected_study_id"] = study_id
        product["original_source_card"] = rows[0]
    return product


def same_product(before, after):
    for name in PRODUCT_FIELDS:
        require(before[name] == after[name], "The original received product changed: " + name)


class Receiving:
    """Retain original requests; the existing operator remains the task authority."""
    def __init__(self, path, configuration, timeout, resume_failed):
        self.path, self.timeout, self.resume_failed = path, timeout, resume_failed
        self.value = read_json(path) if path.exists() else {
            "schema": SCHEMA, "configuration": configuration, "tasks": {}, "state": "prepared",
            "implementation_history": [],
        }
        require(self.value.get("schema") == SCHEMA
                and self.value.get("configuration") == configuration,
                "Resume the same original cohort, Workspace, operation and output")
        self.save()

    def save(self):
        atomic_json(self.path, self.value)

    def implementation(self):
        files = {name: describe_file(APPLICATION, APPLICATION / name) for name in MEMBERS}
        history = self.value["implementation_history"]
        if not history or history[-1]["files"] != files:
            history.append({"files": files, "sha256": digest(files),
                            "retained_tasks": {name: row.get("task_id")
                                               for name, row in self.value["tasks"].items()}})
        self.save()

    def request(self, phase, workspace, action, payload):
        original = self.value["tasks"].get(phase)
        wanted = {"workspace": workspace, "action": action,
                  "payload": json.loads(canonical(payload))}
        if original:
            require(original["request"] == wanted,
                    "The retained native phase has a different request: " + phase)
        else:
            original = {"request": wanted, "operation_id": "cohort-" + digest({
                "operation": self.value["configuration"]["operation_id"],
                "phase": phase, "request": wanted})[:56]}
            self.value["tasks"][phase] = original
            self.save()
        return original

    def task(self, operator, phase, workspace, action, payload):
        original = self.request(phase, workspace, action, payload)
        actual = (operator.task(original["task_id"]) if original.get("task_id") else
                  operator.submit(workspace, action, original["request"]["payload"], original["operation_id"]))
        require({key: actual[key] for key in ("workspace", "action", "payload")} == original["request"],
                "The original queue returned another selected request")
        original.update(task_id=actual["id"], accepted_operation_id=actual["operation_id"])
        self.value["active_phase"] = phase
        self.save()
        emit(phase, task_id=actual["id"], state=actual["state"])
        if actual["state"] == "interrupted" or (
                self.resume_failed and actual["state"] in {"failed", "cancelled"}):
            actual = operator.resume(actual["id"])
        deadline = time.monotonic() + self.timeout
        while actual["state"] in {"queued", "running"}:
            require(time.monotonic() < deadline,
                    "Original task is still active; retain and resume " + actual["id"])
            time.sleep(.5)
            actual = operator.task(actual["id"])
        original["state"] = actual["state"]
        self.save()
        require(actual["state"] == "complete",
                "Original " + phase + " task ended " + actual["state"] + ": " + json.dumps(actual.get("error")))
        if "result" in original:
            require(original["result"] == actual["result"], "The completed original task result changed")
        original["result"] = actual["result"]
        self.save()
        return actual

    def report_payload(self, operator, workspace, payload):
        original = self.value["tasks"].get("scientific-report")
        if original:
            saved = original["request"]
            require(saved["workspace"] == workspace and saved["action"] == "source-reports.render"
                    and {k: v for k, v in saved["payload"].items() if k != "preview_id"} == payload,
                    "The original report phase has another source, title or contact")
            # Original completed native effects and interrupted requests must be
            # reconciled by the maintained renderer before considering new code.
            return saved["payload"]
        prepared = ScientificReportEditions(operator, Fault).preview(workspace, payload)
        self.value["report_preview"] = prepared
        self.save()
        return {**payload, "preview_id": prepared["id"]}


def source_choice(operator, key, args):
    catalog = operator.extensions.read("GET", "/api/observation-comparability/catalog", key, {})
    choices = [row["choice"] for row in catalog["sources"]]
    if args.source_collection:
        selected = [row for row in choices if row.get("source_collection_id") == args.source_collection
                    and row.get("source_id") == args.source_id]
    else:
        selected = [row for row in choices if row.get("kind") == "installed"]
    require(len(selected) == 1, "Choose one available exact original cohort from the native catalogue")
    return selected[0]


def receive_archive(course, operator, key, phase, exported, output):
    tickets = operator.task_view(exported["id"])["_downloads"]
    result = exported["result"]
    ticket = next(row for row in tickets if row["sha256"] == result["sha256"])
    downloaded = consume_download(operator, ticket, output / (phase + ".zip"))
    stream, item = operator.open_download(ticket["id"])
    try:
        upload = operator.receive_upload(stream, item["bytes"], item["filename"], "application/zip")
    finally:
        stream.close()
    require(upload["sha256"] == result["sha256"], "The original archive changed during native upload")
    restored = course.task(operator, phase + "-restore", key, "workspace.restore",
                           {"upload_id": upload["id"]})["result"]
    require(restored["identity"] == "MATCH"
            and restored["project"]["id"] == operator.ws(key).project["id"],
            "The original archive restored another project or changed original members")
    return {"archive": result, "download": downloaded, "upload": upload, "restore": restored}


def cold_reopen(args):
    expected = read_json(args.expected)
    operator = Operator(args.workspace, args.state_directory)
    try:
        product = check_product(operator, operator.primary, expected["selection_id"],
                                expected["scientific_report_edition_id"], args.study_id)
        same_product(expected, product)
        value = {"application": str(APPLICATION), "workspace": str(args.workspace.resolve()),
                 "driver": describe_file(APPLICATION, Path(__file__)), "product": product}
        atomic_json(args.output / "cold-reopen.json", value)
        emit("cold-reopen-complete", selection_id=product["selection_id"],
             scientific_report_edition_id=product["scientific_report_edition_id"])
        return 0
    finally:
        operator.close()


def run(args, lock):
    configuration = {
        "operation_id": args.operation_id, "workspace": str(args.workspace.resolve(strict=True)),
        "state_directory": str(args.state_directory.resolve()),
        "restore_directory": str(args.restore_directory.resolve()) if args.restore_directory else None,
        "source_collection": args.source_collection, "source_id": args.source_id,
        "year_a": args.year_a, "year_b": args.year_b, "title": args.title,
    }
    course = Receiving(args.output / "cohort-receiving.json", configuration,
                       args.timeout_seconds, args.resume_failed)
    course.implementation()
    course.value["execution"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
                                  "python": sys.executable, "application": str(APPLICATION)}
    course.value["state"] = "running"
    course.save()
    emit("NATIVE_STARTED", **course.value["execution"], operation_id=args.operation_id)
    operator = None
    try:
        operator = Operator(args.workspace, args.state_directory, restore_directory=args.restore_directory)
        key, ws = operator.primary, operator.ws(operator.primary)
        for action in ("observation.comparability.save", "source-reports.render",
                       "source-reports.export", "study.export"):
            require(operator.extensions.handles_action(action),
                    "Install the original complete component for " + action)
        if "selected-comparison" in course.value["tasks"]:
            payload = course.value["tasks"]["selected-comparison"]["request"]["payload"]
        else:
            choice = source_choice(operator, key, args)
            original = operator.extensions.read(
                "POST", "/api/observation-comparability/inputs", key, {"source": choice})
            payload = {"source": choice, "binding_sha256": original["binding_sha256"],
                       "producers": original["producers"],
                       "year_a": args.year_a if args.year_a is not None else original["defaults"]["year_a"],
                       "year_b": args.year_b if args.year_b is not None else original["defaults"]["year_b"],
                       "title": args.title or original["presentation"]["title"]}
        selected = course.task(operator, "selected-comparison", key,
                               "observation.comparability.save", payload)["result"]
        _, source_entry = ws.source_file(selected["source"]["source_collection_id"], selected["source"]["source_id"])
        require(source_entry.get("metadata", {}).get("native_comparability", {}).get("selection_id") == selected["id"],
                "Use the complete native comparison source with its original saved-editor binding")
        report_payload = course.report_payload(
            operator, key, {"sources": [selected["source"]], "title": selected["title"]})
        report_task = course.task(operator, "scientific-report", key, "source-reports.render", report_payload)
        report_id = report_task["result"]["scientific_report_edition_id"]
        report_export = course.task(operator, "scientific-report-export", key,
                                    "source-reports.export", {"id": report_id})
        exported_report = operator.task_view(report_export["id"])
        report_ticket = exported_report.get("result", {}).get("download")
        if report_ticket is None:
            report_ticket = ScientificReportEditions(operator, Fault).detail(key, report_id)["archive"]
        require(report_ticket is not None, "The completed native report has no original ZIP ticket")
        course.value["report_download"] = consume_download(
            operator, report_ticket, args.output / "scientific-report-files.zip")
        product = check_product(operator, key, selected["id"], report_id)
        if "product" in course.value:
            same_product(course.value["product"], product)
        course.value["product"] = product
        atomic_json(args.output / "original-product.json", product, immutable=True)
        course.save()
        selection = {"schema": study_transfer.SELECTION_SCHEMA,
                     "title": "Original cohort study: " + selected["title"],
                     "roots": [{"kind": "scientific-report-editions", "id": report_id}],
                     "include_related_results": False}
        study = course.task(operator, "selected-study-export", key, "study.export", selection)
        inspected = study_transfer.inspect_transfer_archive(study["result"]["path"], verify=True)
        require("workspace/" + comparisons.KIND + "/" + selected["id"] + "/receipt.json"
                in inspected["manifest"]["members"],
                "The selected Study archive omitted its original saved comparison")
        for name, action, request in (
                ("selected-study", None, None),
                ("full-workspace", "workspace.backup", {"include_intermediates": True})):
            exported = study if action is None else course.task(operator, name + "-export", key, action, request)
            receipt = receive_archive(course, operator, key, name, exported, args.output)
            received_key = receipt["restore"]["workspace_key"]
            study_id = study["result"]["id"] if name == "selected-study" else None
            restored = check_product(operator, received_key, selected["id"], report_id, study_id)
            same_product(product, restored)
            receipt["product"] = restored
            course.value[name] = receipt
            course.save()
        operator.close()
        operator = None
        # Reopen the original operator task registry before invoking each actual
        # restored application's own complete source in a separate interpreter.
        operator = Operator(args.workspace, args.state_directory, restore_directory=args.restore_directory)
        for row in course.value["tasks"].values():
            task = operator.task(row["task_id"])
            require(task["state"] == "complete" and task["operation_id"] == row["accepted_operation_id"]
                    and {k: task[k] for k in ("workspace", "action", "payload")} == row["request"],
                    "An original complete queue request did not reopen")
        operator.close()
        operator = None
        for name in ("selected-study", "full-workspace"):
            restored = course.value[name]["restore"]
            app = Path(restored["application"]).resolve(strict=True)
            driver = app / "source_tools/receive_observation_comparability.py"
            require(driver.is_file(), "The restored source family omitted its original receiving command")
            cold_output = args.output / (name + "-cold")
            cold_output.mkdir(exist_ok=True)
            command = [sys.executable, "-B", str(driver), "--cold-reopen",
                       "--workspace", restored["workspace"],
                       "--state-directory", str(args.output / (name + "-cold-state")),
                       "--output", str(cold_output),
                       "--expected", str(args.output / "original-product.json")]
            if name == "selected-study":
                command += ["--study-id", study["result"]["id"]]
            course.value[name]["cold_command"] = command
            course.save()
            environment = dict(os.environ)
            environment.pop("PYTHONPATH", None)
            stamp = str(time.time_ns())
            stdout_path = args.output / (name + "-cold-" + stamp + ".stdout.txt")
            stderr_path = args.output / (name + "-cold-" + stamp + ".stderr.txt")
            with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
                child = subprocess.run(command, cwd=app, env=environment, stdout=stdout, stderr=stderr,
                                       timeout=args.timeout_seconds, check=False, pass_fds=(lock.fileno(),))
            require(child.returncode == 0,
                    "The actual restored application failed reopening; inspect " + str(stderr_path))
            cold = read_json(cold_output / "cold-reopen.json")
            expected_driver = portable.inspect_archive(course.value[name]["archive"]["path"], verify=False)[
                "members"]["application/source_tools/receive_observation_comparability.py"]
            require(cold["application"] == str(app)
                    and cold["driver"]["sha256"] == expected_driver["sha256"],
                    "Cold receiving used another application source")
            same_product(product, cold["product"])
            course.value[name]["cold_reopen"] = cold
            course.save()
        course.value["browser_handoff"] = {
            "application": str(APPLICATION), "workspace": configuration["workspace"],
            "operator_state": configuration["state_directory"],
            "selection_id": selected["id"], "scientific_report_edition_id": report_id,
            "selected_study": course.value["selected-study"]["restore"],
            "selected_study_id": study["result"]["id"],
            "full_workspace": course.value["full-workspace"]["restore"],
            "required_views": ["Comparable observation periods", "Scientific Reports", "Received studies"],
            "required_widths": [1440, 390],
            "course": "Open and inspect the exact saved period/source/title, original rows and calendar; "
                      "download CSV, complete source ZIP and native report ZIP; reopen the offline desk; "
                      "open this exact received Study and its original comparison; exercise replace/append "
                      "report choices, empty/loading/error recovery, then view all captured screenshots.",
        }
        atomic_json(args.output / "browser-handoff.json", course.value["browser_handoff"])
        course.value.update(state="complete")
        course.value.pop("error", None)
        course.save()
        emit("COHORT_RECEIVING_COMPLETE", result=str(course.path), selection_id=selected["id"],
             report_id=report_id, study_id=study["result"]["id"])
        return 0
    except Exception as error:
        course.value.update(state="failed", error={"type": type(error).__name__, "message": str(error)})
        course.save()
        raise
    finally:
        if operator is not None:
            operator.close()



def process_identity(pid):
    """Match the exact original child, including Linux boot and process start."""
    try:
        root = Path("/proc") / str(pid)
        stat = (root / "stat").read_text()
        fields = stat[stat.rfind(")") + 2:].split()
        return {"pid": pid, "start_ticks": fields[19],
                "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (OSError, ValueError, IndexError):
        return None


def save_supervision(path, value):
    import tempfile
    fd, name = tempfile.mkstemp(prefix=".cohort-supervision-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def stop_owned(child, identity, seconds):
    """Bound shutdown of this process group; never signal another native owner."""
    def signal_original(number):
        if child.poll() is not None:
            return
        require(identity is not None and process_identity(child.pid) == identity
                and os.getpgid(child.pid) == child.pid,
                "Retain the original child; its exact process identity could not be reconciled")
        os.killpg(child.pid, number)
    signal_original(signal.SIGTERM)
    try:
        child.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        signal_original(signal.SIGKILL)
        child.wait(timeout=seconds)


def supervise(args, lock, argv):
    path = args.output / "supervision.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    command = [sys.executable, "-B", str(Path(__file__).resolve()), *argv,
               "--owned-child", "--lock-fd", str(lock.fileno())]
    record = {"schema": "upstate.observation-comparability-process/v1",
              "command": command, "state": "starting", "started_at": time.time(),
              "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "previous": previous}
    save_supervision(path, record)
    child = subprocess.Popen(command, cwd=APPLICATION, stdin=subprocess.DEVNULL,
                             close_fds=True, pass_fds=(lock.fileno(),), start_new_session=True)
    identity = None
    try:
        identity = process_identity(child.pid)
        record.update(state="running", process=identity, pid=child.pid)
        save_supervision(path, record)
        emit("NATIVE_PROCESS_STARTED", pid=child.pid, application=str(APPLICATION),
             python=sys.executable, operation_id=args.operation_id)
        try:
            result = child.wait(timeout=args.timeout_seconds)
        except subprocess.TimeoutExpired:
            record["state"] = "deadline"
            save_supervision(path, record)
            stop_owned(child, identity, args.shutdown_seconds)
            record.update(state="interrupted", returncode=child.returncode,
                          reason="Original receiving deadline; resume its retained queue and outputs")
            save_supervision(path, record)
            emit("NATIVE_INTERRUPTED", result=str(args.output / "cohort-receiving.json"))
            return 124
        record.update(state="complete" if result == 0 else "failed", returncode=result,
                      finished_at=time.time())
        save_supervision(path, record)
        return result if result >= 0 else 1
    except BaseException:
        # Persistence/progress failures immediately after spawn also close only
        # this owned process before the parent's output lease can be released.
        stop_owned(child, identity or process_identity(child.pid), args.shutdown_seconds)
        raise

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--restore-directory", type=Path)
    parser.add_argument("--operation-id", default="ECO-INTEGRATE-ASTRA13-7C31")
    parser.add_argument("--source-collection")
    parser.add_argument("--source-id")
    parser.add_argument("--year-a", type=int)
    parser.add_argument("--year-b", type=int)
    parser.add_argument("--title")
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--resume-failed", action="store_true")
    parser.add_argument("--shutdown-seconds", type=float, default=15)
    parser.add_argument("--owned-child", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--lock-fd", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--cold-reopen", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--expected", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--study-id", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    require(args.timeout_seconds > 0 and args.shutdown_seconds > 0,
            "Choose positive receiving and shutdown deadlines")
    require(bool(args.source_collection) == bool(args.source_id),
            "Choose both original source collection and source identifier")
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    workspace = args.workspace.resolve()
    state = args.state_directory.resolve()
    def overlap(first, second):
        return first.is_relative_to(second) or second.is_relative_to(first)
    require(not overlap(args.output, workspace) and not overlap(args.output, APPLICATION),
            "Keep receiving output separate from the original scientific Workspace and application")
    require(not overlap(state, workspace) and not overlap(state, APPLICATION)
            and not args.output.is_relative_to(state),
            "Keep operator state separate from scientific source and outside the receipt's parents")
    if args.restore_directory:
        restored = args.restore_directory.resolve()
        require(not overlap(restored, workspace) and not overlap(restored, APPLICATION),
                "Keep receiving destinations separate from the original application and Workspace")
    if args.cold_reopen:
        require(args.expected is not None, "Choose the retained original product for cold receiving")
        load_native()
        return cold_reopen(args)
    import fcntl
    require(os.name == "posix" and Path("/proc/self/stat").is_file(),
            "Use the original Linux receiver for exact process and inherited-lease continuation")
    lock_path = args.output / ".cohort-receiving.lock"
    if args.owned_child:
        require(args.lock_fd is not None, "The owned receiver needs its original inherited lease")
        with os.fdopen(args.lock_fd, "a") as lock:
            held_stat, original_stat = os.fstat(lock.fileno()), lock_path.stat()
            require((held_stat.st_dev, held_stat.st_ino) == (original_stat.st_dev, original_stat.st_ino),
                    "Retain the original receiving output lease")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            emit("NATIVE_IMPORT_START", pid=os.getpid(), application=str(APPLICATION))
            load_native()
            return run(args, lock)
    require(args.lock_fd is None, "Only the original owned child receives an inherited lease")
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return supervise(args, lock, argv)


if __name__ == "__main__":
    raise SystemExit(main())
