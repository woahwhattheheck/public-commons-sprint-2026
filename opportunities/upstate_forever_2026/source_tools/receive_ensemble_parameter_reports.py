"""Receive original Ensemble runs as editable Parameter reports and a Study.

This course composes the maintained bridge, source report renderer and selected
Study transfer. It does not start native model calculations.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback
from urllib.parse import quote

APPLICATION = Path(__file__).resolve().parents[1]
for directory in (APPLICATION, APPLICATION / "operator"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from model.common import (
    atomic_bytes, atomic_json, describe_file, digest, held, identifier,
    now, read_json, verify_file,
)
from model import ensemble_parameter_studies as bridge
from model import parameter_report_source as sources
from model import parameter_studies as studies
from model import scientific_report_editions as reports
from model import study_receiving, study_transfer
from model.project_transfer_workspace import NativeProjectTransfer
from model.workspace import Workspace

SCHEMA = "upstate.ensemble-parameter-report-course/v1"
LEAF = "source_tools/receive_ensemble_parameter_reports.py"
CODE = (
    LEAF, "model/ensemble_parameter_studies.py", "model/parameter_studies.py",
    "model/parameter_report_source.py", "model/parameter_scientific_figures.py",
    "model/ensemble_study_scope.py", "model/scientific_report_editions.py",
    "model/parameter_study_transfer.py", "model/study_transfer.py",
    "model/project_transfer_workspace.py", "model/portable.py",
    "CURRENT_OWNER_DIRECTION.md",
)


def _separate(first, second):
    if first == second or first in second.parents or second in first.parents:
        raise ValueError("Keep the receiving operation, application and original Workspace in separate trees")


def _event(phase, **values):
    print(json.dumps({"schema": SCHEMA, "phase": phase, "at": now(), **values},
                     ensure_ascii=False, allow_nan=False), flush=True)


def _cases(state):
    return [{name: deepcopy(row[name]) for name in
             ("id", "profile_id", "run_id", "run_selection")}
            for row in state["cases"]]


def _original_studies(workspace, continued):
    answer = []
    for row in continued["studies"]:
        key = identifier(row["experiment_id"])
        state = studies.inspect(workspace, key)
        if state["progress"]["completed"] != state["progress"]["total"]:
            raise ValueError("Complete the original retained native cases before report receiving")
        directory = workspace.root / "experiments" / key
        artifact = state.get("artifacts", {}).get("results")
        if artifact is None:
            raise ValueError("Prepare the retained Parameter results before receiving their report")
        result = verify_file(directory, artifact)
        answer.append({
            "id": key, "title": state["selection"]["title"],
            "scenario_id": row["scenario_id"], "scenario_title": row["scenario_title"],
            "base_profile_id": row["base_profile_id"],
            "selection": deepcopy(state["selection"]),
            "baseline_selection": deepcopy(state["baseline_selection"]),
            "models": state["models"], "pollutants": state["pollutants"],
            "cases": _cases(state),
            "specification": describe_file(workspace.root,
                workspace.root / "experiment-specs" / (key + ".json")),
            "result": describe_file(workspace.root, result),
        })
    return answer


def _verify_studies(workspace, originals):
    rows = []
    for original in originals:
        key = identifier(original["id"])
        verify_file(workspace.root, original["specification"])
        verify_file(workspace.root, original["result"])
        state = studies.inspect(workspace, key)
        if (state["selection"] != original["selection"]
                or state["baseline_selection"] != original["baseline_selection"]
                or state["models"] != original["models"]
                or state["pollutants"] != original["pollutants"]
                or _cases(state) != original["cases"]):
            raise ValueError("The receiving study changed its original case, source or model selection")
        current = state.get("artifacts", {}).get("results")
        if (not isinstance(current, dict)
                or any(current.get(name) != original["result"][name]
                       for name in ("bytes", "sha256"))):
            raise ValueError("The receiving study no longer selects its captured result edition")
        rows.append({"id": key, "title": original["title"], "state": state["state"],
                     "progress": state["progress"], "scenario_id": original["scenario_id"],
                     "models": state["models"], "pollutants": state["pollutants"],
                     "case_run_ids": [row["run_id"] for row in state["cases"]],
                     "result_sha256": current["sha256"]})
    return rows


def _source_record(workspace, original, saved=None):
    if saved is not None:
        record = sources.get(workspace, saved["id"])
        if (record["source"] != saved["source"]
                or record["selection"] != saved["selection"]
                or record["experiment_id"] != original["id"]):
            raise ValueError("The receiving source changed its original Parameter selection")
    else:
        # The current source producer supplies its exact geographic and input
        # declaration even when the bridge has an earlier valid report edition.
        record = sources.prepare(workspace, {
            "experiment_id": original["id"], "title": original["title"],
            "expected_artifact_sha256": original["result"]["sha256"]}, render=False)
    if record["selection"]["expected_artifact_sha256"] != original["result"]["sha256"]:
        raise ValueError("The source report belongs to another original result edition")
    for item in record.get("files", {}).values():
        verify_file(workspace.root, item)
    workspace.source_file(record["source"]["source_collection_id"], record["source"]["source_id"])
    return {"id": record["id"], "experiment_id": original["id"],
            "source": deepcopy(record["source"]), "selection": deepcopy(record["selection"]),
            "files": deepcopy(record["files"])}


def _report(workspace, root, state, checkpoint, payload):
    key = state.get("scientific_report_edition_id")
    if key:
        record, _, _ = reports.inspect(workspace, key)
        reports.validate_request(workspace, payload, record["render_identity"])
    else:
        preview_path = root / "report-preview.json"
        prepared = read_json(preview_path) if preview_path.is_file() else None
        if prepared is None:
            prepared = reports.preview(workspace, payload)
            atomic_json(preview_path, prepared, immutable=True)
        reports.validate_request(workspace, payload, prepared["render_identity"])
        checkpoint("rendering_report", scientific_preview_id=prepared["id"])
        directory = reports.directory(workspace, prepared["id"])
        if (directory / "operation.json").is_file():
            outcome = reports.render(workspace, {**payload, "preview_id": prepared["id"]})
        else:
            outcome = reports.render_prepared(workspace, prepared)
        key = outcome["scientific_report_edition_id"]
        record, _, _ = reports.inspect(workspace, key)
        checkpoint("report_retained", scientific_report_edition_id=key)
    exported = reports.export(workspace, key)
    return record, exported


def verify_received(workspace_path, expected_path, output):
    """Use the transported application's own original APIs in a fresh process."""
    workspace = Workspace(Path(workspace_path).resolve(strict=True))
    expected = read_json(expected_path)
    target = Path(output).resolve()
    if (expected.get("schema") != SCHEMA
            or workspace.project["id"] != expected["project_id"]):
        raise ValueError("The received Workspace belongs to another original project")
    target.parent.mkdir(parents=True, exist_ok=True)
    with held(target.parent / ".verify.lock", blocking=False):
        reopened = _verify_studies(workspace, expected["studies"])
        received_sources = []
        if len(expected["sources"]) != len(expected["studies"]):
            raise ValueError("The receiving selection must bind one source to each original scenario")
        for original, source in zip(expected["studies"], expected["sources"]):
            record = _source_record(workspace, original, source)
            received_sources.append({"id": record["id"], "experiment_id": original["id"],
                                     "source": record["source"]})
        if len(received_sources) != len(expected["studies"]):
            raise ValueError("The received source list omits an original scenario")
        report, directory, _ = reports.inspect(workspace, expected["report_id"])
        if (report["render_identity"] != expected["render_identity"]
                or report["files"] != expected["report_files"]):
            raise ValueError("The received report changed its original source or output edition")
        # The original receiving reader reconciles every selected report/source
        # dependency, including the editable Parameter producer and native runs.
        received = study_receiving.detail(workspace, expected["study_id"])
        if not any(row["id"] == report["id"] for row in received["reports"]):
            raise ValueError("The received Study does not expose its captured report")
        self_source = describe_file(APPLICATION, APPLICATION / LEAF)
        if any(self_source[name] != expected["receiver_source"][name] for name in ("bytes", "sha256")):
            raise ValueError("Use the receiver included in the original transferred application")
        answer = {
            "schema": SCHEMA, "state": "complete", "project_id": workspace.project["id"],
            "application": str(APPLICATION), "workspace": str(workspace.root),
            "python_executable": sys.executable, "python_version": sys.version,
            "study_id": expected["study_id"], "scientific_report_edition_id": report["id"],
            "report_directory": str(directory), "report_files": report["files"],
            "parameter_studies": reopened, "sources": received_sources,
            "receiver_source": self_source, "completed_at": now(),
        }
        atomic_json(target, answer)
        _event("fresh_reopen_complete", result=str(target),
               parameter_studies=len(reopened), report_id=report["id"])
        return answer


def _fresh(root, received, expected_path, state, checkpoint):
    expected = read_json(expected_path)
    if state.get("fresh_result"):
        retained = read_json(root / state["fresh_result"])
        if (retained.get("study_id") != expected["study_id"]
                or retained.get("scientific_report_edition_id") != expected["report_id"]
                or Path(retained["application"]).resolve() != Path(received["application"]).resolve()):
            raise ValueError("The retained fresh-process result names another received application")
        return retained
    attempts = state.setdefault("fresh_processes", [])
    number = len(attempts) + 1
    destination = root / "fresh"
    destination.mkdir(exist_ok=True)
    output = destination / ("result-" + str(number) + ".json")
    log = destination / ("stdout-" + str(number) + ".log")
    command = [sys.executable, "-B", str(Path(received["application"]) / LEAF),
               "--verify-received", "--workspace", received["workspace"],
               "--expect", str(expected_path), "--result", str(output)]
    attempt = {"attempt": number, "argv": command, "cwd": received["application"],
               "log": str(log), "result": str(output), "started_at": now()}
    attempts.append(attempt)
    checkpoint("fresh_reopen", fresh_processes=attempts)
    started = time.monotonic()
    with log.open("wb") as stream:
        process = subprocess.run(command, cwd=received["application"],
                                 stdout=stream, stderr=subprocess.STDOUT, check=False)
    attempt.update(returncode=process.returncode, finished_at=now(),
                   elapsed_seconds=time.monotonic() - started)
    checkpoint("fresh_reopen_finished", fresh_processes=attempts)
    if process.returncode:
        raise RuntimeError("Fresh report receiving exited " + str(process.returncode) +
                           "; continue this same course after reading " + str(log))
    result = read_json(output)
    if (result.get("schema") != SCHEMA or result.get("state") != "complete"
            or result.get("study_id") != expected["study_id"]
            or result.get("scientific_report_edition_id") != expected["report_id"]
            or Path(result["application"]).resolve() != Path(received["application"]).resolve()
            or result.get("project_id") != expected["project_id"]):
        raise ValueError("The fresh interpreter returned another original receiving result")
    checkpoint("fresh_reopened", fresh_result=output.relative_to(root).as_posix())
    return result


def _start_page(root, received_workspace, original, science, archive, result):
    workspace = Workspace(received_workspace)
    record, directory, _ = reports.inspect(workspace, science["id"])
    links = []
    def add(label, path):
        path = Path(path)
        if not path.is_file():
            raise ValueError("The receiving page needs its original file: " + str(path))
        relative = path.relative_to(root).as_posix()
        links.append('<li><a href="' + html.escape(quote(relative, safe="/"), quote=True) +
                     '">' + html.escape(label) + '</a></li>')
    labels = {"report_html": "Open the scientific report", "report_pdf": "Download the report PDF"}
    for name, label in labels.items():
        if name not in record["files"]:
            raise ValueError("The completed scientific report is missing " + name)
        add(label, verify_file(directory, record["files"][name]))
    add("Complete editable Study and application", archive["path"])
    add("Original report/source selection", root / "receiving-selection.json")
    for row in original["studies"]:
        key = row["id"]
        state = studies.inspect(workspace, key)
        add(row["title"] + " — original quantitative results",
            verify_file(workspace.root, row["result"]))
        descriptors = state.get("artifacts", {})
        for role, item in descriptors.items():
            if role in ("report", "csv", "archive") or role.startswith("difference"):
                add(row["scenario_title"] + " — " + role,
                    verify_file(workspace.root / "experiments" / key, item))
    body = ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Original scenario parameter reports</title><style>'
            'body{font:16px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0}'
            'main{max-width:960px;margin:32px auto;padding:0 20px}h1{font-size:28px}'
            'a{color:#222;overflow-wrap:anywhere}li{margin:10px 0}code{overflow-wrap:anywhere}'
            '.note{padding:12px;border:1px solid #bbb;background:#f5f5f5}'
            '</style><main><h1>' + html.escape(original["title"]) + '</h1>'
            '<p>' + html.escape(bridge.METHOD) + '</p><p class="note">'
            'The source declarations inside the report identify the original modeled geography, '
            'input editions and assumptions. Each constituent retains its own annual mass unit; '
            'paired support and undefined percentages stay visible in the tables and figure details.'
            '</p><p>' + str(len(original["studies"])) + ' original scenario studies; ' +
            str(len({case["run_id"] for row in original["studies"] for case in row["cases"]})) +
            ' distinct retained native runs.</p><ul>' + "".join(links) + '</ul>'
            '<h2>Continue the editable work</h2><p>Open the included application with Workspace '
            '<code>' + html.escape(result["workspace"]) + '</code>. Choose Parameter studies '
            'to reopen these original scenarios and SourceReports for the captured ordered report. '
            'The fresh-process result records the exact received application and study identities.'
            '</p><p>The report, its figures and every outgoing attachment must be opened and viewed '
            'at the presentation width and 390px before recipient delivery. Keep the original '
            'simulation label and actual geographic scope in presentation.</p></main></html>')
    atomic_bytes(root / "START_HERE.html", body.encode("utf-8"))


def run(args):
    workspace_path = Path(args.workspace).expanduser().resolve(strict=True)
    root = Path(args.operation).expanduser().resolve()
    _separate(root, workspace_path)
    _separate(root, APPLICATION)
    root.mkdir(parents=True, exist_ok=True)
    workspace = Workspace(workspace_path)
    supplied = read_json(args.selection) if args.selection else None
    if supplied is not None and not isinstance(supplied, dict):
        raise ValueError("Use the original ensemble continuation selection object")
    if args.bridge_id and supplied is not None:
        raise ValueError("Choose the retained bridge ID or an explicit new selection")
    intent = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "ensemble_id": identifier(args.ensemble_id),
        "requested_bridge_id": identifier(args.bridge_id) if args.bridge_id else None,
        "requested_selection": supplied, "requested_title": args.title,
    }
    with held(root / ".parameter-report-course.lock", blocking=False):
        atomic_json(root / "intent.json", intent, immutable=True)
        state_path = root / "state.json"
        state = read_json(state_path) if state_path.is_file() else {
            "schema": SCHEMA, "operation_id": digest(intent), "created_at": now(),
            "project_id": workspace.project["id"], "sources": [],
        }
        if state.get("schema") != SCHEMA or state.get("operation_id") != digest(intent):
            raise ValueError("Continue this operation with its original selection")
        attempt = {"started_at": now(), "application": str(APPLICATION),
                   "workspace": str(workspace.root), "python_executable": sys.executable,
                   "source_files": {name: describe_file(APPLICATION, APPLICATION / name) for name in CODE}}
        state.setdefault("attempts", []).append(attempt)
        started = time.monotonic()
        def checkpoint(phase, **values):
            state.update(values, phase=phase, updated_at=now())
            atomic_json(state_path, state)
            _event(phase, operation=str(root), **{
                name: value for name, value in values.items()
                if name in ("bridge_id", "scientific_report_edition_id", "study_id", "result_file")})
        try:
            original_path = root / "original-studies.json"
            if original_path.is_file():
                original = read_json(original_path)
                continued = bridge.get(workspace, original["bridge_id"])
            else:
                selected = None
                if (root / "bridge-preview.json").is_file():
                    prior_preview = read_json(root / "bridge-preview.json")
                    if state.get("bridge_id") not in (None, prior_preview["id"]):
                        raise ValueError("The retained continuation preview changed its original identity")
                    selected = prior_preview["selection"]
                elif args.bridge_id:
                    continued = bridge.get(workspace, identifier(args.bridge_id))
                    selected = continued["selection"]
                elif supplied is None:
                    continued = bridge.latest(workspace, args.ensemble_id)
                    if continued is not None:
                        selected = continued["selection"]
                if selected is None:
                    selected = {**(supplied or {}), "ensemble_id": args.ensemble_id}
                    selected.setdefault("difference_maps", True)
                    selected.setdefault("render_reports", False)
                if selected["ensemble_id"] != args.ensemble_id:
                    raise ValueError("The selected continuation belongs to another original ensemble")
                prepared = bridge.preview(workspace, selected)
                atomic_json(root / "bridge-preview.json", prepared, immutable=True)
                checkpoint("continuing_original_studies", bridge_id=prepared["id"])
                continued = bridge.continue_studies(workspace, selected)
                if continued["id"] != prepared["id"] or continued["state"] != "complete":
                    raise ValueError("The original retained scenario continuation is incomplete")
                original = {
                    "schema": SCHEMA, "project_id": workspace.project["id"],
                    "ensemble_id": args.ensemble_id, "bridge_id": continued["id"],
                    "bridge_selection": continued["selection"],
                    "title": args.title or continued["selection"]["title"] + " — parameter comparisons by scenario",
                    "studies": _original_studies(workspace, continued),
                }
                atomic_json(original_path, original, immutable=True)
            if (original["ensemble_id"] != args.ensemble_id
                    or original["project_id"] != workspace.project["id"]
                    or continued["ensemble_id"] != original["ensemble_id"]):
                raise ValueError("The saved course changed its original ensemble lineage")
            _verify_studies(workspace, original["studies"])
            by_study = {row["experiment_id"]: row for row in state["sources"]}
            for item in original["studies"]:
                checkpoint("preparing_original_source", active_study=item["id"])
                record = _source_record(workspace, item, by_study.get(item["id"]))
                by_study[item["id"]] = record
                checkpoint("source_retained", sources=[
                    by_study[row["id"]] for row in original["studies"] if row["id"] in by_study])
            payload = {"title": original["title"],
                       "sources": [row["source"] for row in state["sources"]]}
            science, science_export = _report(workspace, root, state, checkpoint, payload)
            selection = {"schema": "upstate.study-selection/v1", "title": original["title"],
                         "roots": [{"kind": "scientific-report-editions", "id": science["id"]}],
                         "include_related_results": True}
            atomic_json(root / "study-selection.json", selection, immutable=True)
            checkpoint("exporting_editable_study")
            archive = study_transfer.export_study(workspace, root / "parameter-scenario-study.zip", selection,
                progress=lambda row: _event("study_export", detail=row))
            checkpoint("study_exported", study_id=archive["id"], study_archive=archive)
            transfer = NativeProjectTransfer(workspace, root / "transfer")
            captured = transfer.store.capture_archive(archive["path"],
                progress=lambda row: _event("study_index", detail=row))
            checkpoint("restoring_original_study", study_snapshot_id=captured["id"])
            received = transfer.restore(captured["id"], root / "received",
                progress=lambda row: _event("study_restore", detail=row))
            checkpoint("study_restored", receiving=received)
            expected = {
                "schema": SCHEMA, "project_id": workspace.project["id"],
                "ensemble_id": original["ensemble_id"], "bridge_id": original["bridge_id"],
                "studies": original["studies"], "sources": state["sources"],
                "report_id": science["id"], "render_identity": science["render_identity"],
                "report_files": science["files"], "study_id": archive["id"],
                "receiver_source": describe_file(Path(received["application"]),
                    Path(received["application"]) / LEAF),
            }
            expected_path = root / "receiving-selection.json"
            atomic_json(expected_path, expected, immutable=True)
            fresh = _fresh(root, received, expected_path, state, checkpoint)
            # A repeated course revalidates the exact original reports/results,
            # while retaining the first independent interpreter's actual receipt.
            _verify_studies(Workspace(received["workspace"]), original["studies"])
            _start_page(root, received["workspace"], original, science, archive, fresh)
            attempt.update(finished_at=now(), elapsed_seconds=time.monotonic() - started, state="complete")
            result = {
                "schema": SCHEMA, "state": "complete", "completed_at": now(),
                "operation": str(root), "original_workspace": str(workspace.root),
                "ensemble_id": original["ensemble_id"], "bridge_id": original["bridge_id"],
                "original_studies": original["studies"], "sources": state["sources"],
                "scientific_report_edition_id": science["id"], "scientific_export": science_export,
                "study_archive": {name: archive[name] for name in ("id", "path", "bytes", "sha256", "members")},
                "receiving": received, "fresh_process": fresh,
                "start_here": str(root / "START_HERE.html"),
                "native_execution": "Original completed native runs retained; this course performs report and transfer work.",
                "attempts": state["attempts"],
            }
            atomic_json(root / "result.json", result)
            state.pop("error", None)
            checkpoint("complete", result_file=str(root / "result.json"), active_study=None)
            return result
        except BaseException as error:
            attempt.update(finished_at=now(), elapsed_seconds=time.monotonic() - started, state="failed")
            try:
                checkpoint("interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                           error={"type": type(error).__name__, "message": str(error)})
            except OSError:
                pass
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", help="Durable output directory outside application and Workspace")
    parser.add_argument("--ensemble-id", help="Original completed native Ensemble ID")
    parser.add_argument("--bridge-id", help="Existing original Ensemble-to-Parameter continuation")
    parser.add_argument("--selection", type=Path, help="Original bridge selection JSON when preparing a new continuation")
    parser.add_argument("--title", help="Title for this ordered original scientific report")
    parser.add_argument("--verify-received", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--expect", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--result", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.verify_received:
            if not args.expect or not args.result:
                parser.error("Fresh receiving requires the original --expect and --result paths")
            result = verify_received(args.workspace, args.expect, args.result)
        else:
            if not args.operation or not args.ensemble_id:
                parser.error("Choose --operation and the original --ensemble-id")
            result = run(args)
    except Exception:
        traceback.print_exc()
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
