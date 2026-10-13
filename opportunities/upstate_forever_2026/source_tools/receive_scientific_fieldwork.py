"""Continue a saved scientific plan through reports, fieldwork and fresh receiving.

Run with the maintained application's Python runtime. The operation directory
retains the selected native revision, original ordered sources and every phase.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
from urllib.parse import quote

APPLICATION = Path(__file__).resolve().parents[1]
for directory in (APPLICATION, APPLICATION / "operator"):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from model.common import (atomic_bytes, atomic_json, digest, file_digest, held,
                          now, read_json, verify_file)
from model.implementation import ImplementationStore
from model.implementation_schema import document_digest
from model.portable_implementation import report_edition
from model import field_deployment, implementation_report_source, observed_context
from model import scientific_briefing, study_receiving, study_transfer
from model.project_transfer_workspace import NativeProjectTransfer

SCHEMA = "upstate.scientific-fieldwork-course/v1"


def separate(left, right):
    if left == right or left in right.parents or right in left.parents:
        raise ValueError("Keep the operation, original Workspace and application in separate trees")


def emit(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=False, default=str), flush=True)


def source_choices(path):
    if path is None:
        return []
    value = read_json(path)
    if isinstance(value, dict) and isinstance(value.get("selection"), dict):
        value = value["selection"]
    if isinstance(value, list):
        value = {"observed_context_sources": value}
    if not isinstance(value, dict):
        raise ValueError("Use an ordered source list or the original delivery-selection object")
    choices = observed_context.source_choices(value)
    if not choices:
        raise ValueError("The original source selection contains no scientific reports")
    return choices


def plan_report(store, root, state, checkpoint, original):
    if state.get("plan_report"):
        key = state["plan_report"]["id"]
        return report_edition(store, store.base / original["plan_id"] / "reports" / key)
    reports = store.list_reports(original["plan_id"])
    wanted = original.get("report_id")
    chosen = next((row for row in reports if
                   (row["id"] == wanted if wanted else
                    row["revision"] == original["revision"] and row["as_of"] == original["as_of"])), None)
    if wanted and chosen is None:
        raise ValueError("The selected original saved plan report is absent")
    if chosen is None:
        attempts = state.setdefault("report_attempts", [])
        target = Path(attempts[-1]) if attempts else None
        if target is None or not (target / "manifest.json").is_file():
            target = root / ("plan-report-" + str(len(attempts) + 1))
            if target.exists():
                raise ValueError("An unrelated file occupies the next plan report destination")
            attempts.append(str(target))
            checkpoint("reporting_plan", report_attempts=attempts)
            store.report(original["plan_id"], target, original["as_of"], revision=original["revision"])
        chosen = store.retain_report(target)
    if (chosen["revision"] != original["revision"]
            or chosen["document_digest"] != original["document_digest"]):
        raise ValueError("The original report belongs to another saved plan revision")
    checkpoint("plan_report_retained", plan_report=chosen)
    return chosen


def render_science(workspace, root, state, checkpoint, original, source):
    # The real Operator supplies the same registered Workspace and original
    # ScientificReportEditions implementation used by the browser.
    from server import Operator, Fault
    from source_report_editions import ScientificReportEditions
    operator = Operator(workspace.root, root / "operator-state")
    try:
        reports = ScientificReportEditions(operator, Fault)
        if state.get("scientific_edition_id"):
            key = state["scientific_edition_id"]
            record, _, _ = reports._inspect(workspace, key)
        else:
            choices = deepcopy(original["sources"])
            choice = {name: source[name] for name in ("source_collection_id", "source_id")}
            if choice not in choices:
                choices.append(choice)
            payload = {"sources": choices, "title": original["title"]}
            preview = reports.preview(operator.primary, payload)
            if state.get("scientific_preview_id") not in (None, preview["id"]):
                raise ValueError("The original scientific selection changed during this operation")
            checkpoint("rendering_science", scientific_preview_id=preview["id"])
            outcome = reports.render(operator.primary, {**payload, "preview_id": preview["id"]})
            key = outcome["scientific_report_edition_id"]
            record, _, _ = reports._inspect(workspace, key)
            checkpoint("science_retained", scientific_edition_id=key)
        reports.export(operator.primary, key)
        return record
    finally:
        operator.close()


def briefing(workspace, state, checkpoint, edition_id):
    if state.get("briefing_id"):
        key = state["briefing_id"]
        record, _ = scientific_briefing.inspect(workspace, key)
        if record["source_edition_id"] != edition_id:
            raise ValueError("The saved briefing belongs to another scientific report")
    else:
        preview = scientific_briefing.preview(workspace, edition_id)
        if state.get("briefing_preview_id") not in (None, preview["id"]):
            raise ValueError("The original briefing changed during this operation")
        checkpoint("preparing_briefing", briefing_preview_id=preview["id"])
        record = scientific_briefing.create(workspace, edition_id, expected_id=preview["id"])
        checkpoint("briefing_retained", briefing_id=record["id"])
    return scientific_briefing.export(workspace, record["id"])


def crew(workspace, state, checkpoint, original):
    if state.get("deployment_id"):
        record = field_deployment.inspect(workspace, original["plan_id"], state["deployment_id"])
    else:
        selected = {"title": original["crew_title"], "visit_ids": original["visit_ids"]}
        preview = field_deployment.preview(workspace, original["plan_id"], original["revision"], selected)
        if state.get("deployment_preview_id") not in (None, preview["id"]):
            # A completed packet is reconnected by its pinned original ID even
            # after the installed builder is repaired between process restarts.
            prior = state.get("deployment_preview_id")
            path = workspace.root / "implementation" / "plans" / original["plan_id"] / "deployments" / prior / "deployment.json"
            if path.is_file():
                record = field_deployment.inspect(workspace, original["plan_id"], prior)
                checkpoint("crew_retained", deployment_id=record["id"])
                return record
            state.setdefault("earlier_deployments", []).append({"id": prior, "state": "unfinished",
                "directory": str(path.parent), "reason": "Original builder edition changed before completion"})
            checkpoint("continuing_crew", earlier_deployments=state["earlier_deployments"])
        checkpoint("preparing_crew", deployment_preview_id=preview["id"])
        record = field_deployment.prepare(workspace, original["plan_id"], original["revision"],
                                          selected, expected_id=preview["id"])
        checkpoint("crew_retained", deployment_id=record["id"])
    if (record["plan"]["revision"] != original["revision"]
            or record["plan"]["document_digest"] != original["document_digest"]
            or record["selection"]["visit_ids"] != original["visit_ids"]):
        raise ValueError("The original crew packet differs from the selected fieldwork")
    return record


def capture_workspace(transfer, state, checkpoint):
    attempts = state.setdefault("workspace_capture_attempts", [])
    if not attempts:
        attempts.append({"operation_id": state["operation_id"] + ":workspace:1"})
    current = attempts[-1]
    key = hashlib.sha256(current["operation_id"].encode("utf-8")).hexdigest()
    archive = transfer.archives / (key + ".zip")
    pending = transfer.archives / (".archive-" + archive.name + ".pending")
    if pending.exists() and not archive.exists():
        current.update(state="interrupted", retained_pending=str(pending))
        current = {"operation_id": state["operation_id"] + ":workspace:" + str(len(attempts) + 1)}
        attempts.append(current)
    checkpoint("capturing_workspace", workspace_capture_attempts=attempts)
    captured = transfer.capture(current["operation_id"], progress=lambda row: emit("workspace_capture", **row))
    current.update(state="complete", snapshot_id=captured["snapshot_id"])
    checkpoint("workspace_captured", workspace_capture_attempts=attempts,
               workspace_snapshot_id=captured["snapshot_id"], workspace_archive=captured["archive"])
    return captured


def verify_received(workspace_path, expected_path, output, kind):
    """Executed by a new process from the transported application's own source."""
    expected = read_json(expected_path)
    from model.workspace import Workspace
    workspace = Workspace(workspace_path)
    if workspace.project["id"] != expected["project_id"]:
        raise ValueError("The received Workspace has another original project identity")
    store = ImplementationStore(workspace)
    selected = expected["plan"]
    plan = store.get(selected["id"], selected["revision"])
    if document_digest(plan) != selected["document_digest"]:
        raise ValueError("Fresh receiving changed the selected original plan")
    native_report = report_edition(store, store.base / selected["id"] / "reports" / expected["plan_report_id"])
    if native_report["document_digest"] != selected["document_digest"]:
        raise ValueError("The received plan report differs from its original revision")
    source = implementation_report_source.get_report_source(
        workspace, expected["source_key"], expected["source_operation_id"])
    if source["report_id"] != native_report["id"]:
        raise ValueError("The received scientific source points to another original plan report")
    from source_report_editions import ScientificReportEditions
    # The inspector's native contract is Workspace-only; no live Operator or
    # network is needed to reopen an archived edition.
    report_reader = ScientificReportEditions(None, ValueError)
    report, directory, _ = report_reader._inspect(workspace, expected["scientific_edition_id"])
    packet = field_deployment.inspect(workspace, selected["id"], expected["deployment_id"])
    if packet["plan"] != expected["deployment_plan"] or packet["selection"] != expected["deployment_selection"]:
        raise ValueError("Receiving changed the original crew packet selection")
    summary = {
        "schema": SCHEMA, "state": "complete", "kind": kind, "project": workspace.project,
        "application": str(APPLICATION), "workspace": str(workspace.root),
        "python": sys.version, "plan": selected, "editable_revision": store.get(selected["id"])["revision"],
        "plan_report_id": native_report["id"], "source_operation_id": source["operation_id"],
        "scientific_edition_id": report["id"], "scientific_files": len(report["files"]),
        "deployment_id": packet["id"], "deployment_files": len(packet["files"]),
        "deployment_summary": packet["summary"],
    }
    if kind == "study":
        received = study_receiving.detail(workspace, expected["study_id"])
        if not any(row["id"] == report["id"] for row in received["reports"]):
            raise ValueError("The received Study does not expose the original scientific report")
        fields = [row for row in received["field_sources"]
                  if (row.get("native_plan") or {}).get("plan_id") == selected["id"]]
        if not any(any(item["id"] == packet["id"] and item["captured_with_study"]
                       for item in row["deployments"]) for row in fields):
            raise ValueError("The received Study does not expose the original captured crew packet")
        summary.update(study_id=received["id"], field_sources=len(fields),
                       received_reports=len(received["reports"]))
    elif kind == "workspace":
        saved, _ = scientific_briefing.inspect(workspace, expected["briefing_id"])
        if saved["source_edition_id"] != report["id"]:
            raise ValueError("The received full briefing points to another scientific report")
        summary.update(briefing_id=saved["id"], briefing_pages=saved["page_count"])
    else:
        raise ValueError("Choose the original Study or whole Workspace receiving course")
    atomic_json(output, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return summary


def fresh_process(root, received, expected_path, kind, state, checkpoint):
    attempts = state.setdefault("fresh_processes", {}).setdefault(kind, [])
    attempt = len(attempts) + 1
    target = root / ("fresh-" + kind)
    target.mkdir(exist_ok=True)
    output = target / ("result-" + str(attempt) + ".json")
    log = target / ("stdout-" + str(attempt) + ".log")
    command = [sys.executable, "-B", str(Path(received["application"]) / "source_tools" /
               "receive_scientific_fieldwork.py"), "--verify-received", kind,
               "--workspace", received["workspace"], "--expect", str(expected_path),
               "--result", str(output)]
    row = {"attempt": attempt, "argv": command, "log": str(log), "result": str(output), "state": "running"}
    attempts.append(row)
    checkpoint("reopening_" + kind, fresh_processes=state["fresh_processes"])
    # The child holds its destination receiving lock, so a resumed parent
    # cannot race an original child that is still reopening these files.
    with log.open("wb") as stream:
        result = subprocess.run(command, cwd=received["application"], stdout=stream,
                                stderr=subprocess.STDOUT, check=False)
    row.update(returncode=result.returncode, state="complete" if result.returncode == 0 else "failed")
    checkpoint("reopened_" + kind if result.returncode == 0 else "reopen_failed",
               fresh_processes=state["fresh_processes"])
    if result.returncode:
        raise RuntimeError("The original " + kind + " receiver exited " + str(result.returncode) + "; read " + str(log))
    answer = read_json(output)
    if (answer.get("state") != "complete" or answer.get("kind") != kind
            or Path(answer["application"]).resolve() != Path(received["application"]).resolve()):
        raise ValueError("The fresh receiver returned another application or operation")
    return answer


def start_page(root, result):
    """A simple local entrypoint over the actual reopened original members."""
    original = result["original"]
    links = []
    def add(label, path):
        path = Path(path)
        if not path.is_file():
            raise ValueError("The receiving start page needs its original file: " + str(path))
        relative = path.relative_to(root).as_posix()
        links.append('<li><a href="' + html.escape(quote(relative, safe="/"), quote=True) +
                     '">' + html.escape(label) + '</a></li>')
    whole = Path(result["workspace_receiving"]["workspace"])
    study = Path(result["study_receiving"]["workspace"])
    source = read_json(whole / "scientific-report-editions" / result["scientific_edition_id"] / "edition.json")
    add("Scientific report", whole / "scientific-report-editions" / source["id"] / source["files"]["report_html"]["path"])
    saved = read_json(whole / "scientific-report-briefings" / result["briefing_id"] / "briefing.json")
    add("Scientific briefing", whole / "scientific-report-briefings" / saved["id"] / saved["files"]["html"]["path"])
    packet_root = study / "implementation" / "plans" / original["plan_id"] / "deployments" / result["deployment_id"]
    packet = read_json(packet_root / "deployment.json")
    for label, name in (("Field crew packet", "crew-packet.html"), ("Offline field workbench", "field-workbench.html")):
        add(label, packet_root / name)
    add("Complete original Study archive", result["study_archive"]["path"])
    add("Complete original Workspace archive", result["workspace_archive"])
    body = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>' + html.escape(original["title"]) + '</title><style>body{max-width:54rem;margin:3rem auto;padding:0 1.25rem;'
            'font:16px/1.6 system-ui;color:#202020;background:#fff}h1{font-size:1.7rem}a{color:inherit}li{margin:.75rem 0}'
            'code{overflow-wrap:anywhere}</style><main><h1>' + html.escape(original["title"]) + '</h1><p>Original project '
            '<code>' + html.escape(result["project_id"]) + '</code>. Saved plan revision ' + str(original["revision"]) +
            '; ' + str(len(original["visit_ids"])) + ' selected visits.</p><ul>' + "".join(links) +
            '</ul><p>The Study opens its captured scientific report, editable plan history and crew packet. '
            'The whole Workspace also contains the complete scientific briefing. Both copies reopened in fresh '
            'processes using their own received application source.</p></main></html>')
    atomic_bytes(root / "START_HERE.html", body.encode("utf-8"))


def run(args):
    from model.workspace import Workspace
    workspace_path = Path(args.workspace).expanduser().resolve(strict=True)
    root = Path(args.operation).expanduser().resolve()
    separate(root, workspace_path)
    separate(root, APPLICATION)
    dt.date.fromisoformat(args.as_of)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".scientific-fieldwork.lock", blocking=False):
        workspace = Workspace(workspace_path)
        store = ImplementationStore(workspace)
        input_path = Path(args.sources).expanduser().resolve(strict=True) if args.sources else None
        supplied = source_choices(input_path)
        intent = {"workspace": str(workspace.root), "project_id": workspace.project["id"],
                  "plan_id": args.plan_id, "requested_revision": args.revision, "report_id": args.report_id,
                  "as_of": args.as_of, "title": args.title, "sources": supplied,
                  "source_file_sha256": file_digest(input_path) if input_path else None,
                  "requested_visit_ids": args.visit_id}
        atomic_json(root / "intent.json", intent, immutable=True)
        selection_path = root / "original.json"
        if selection_path.is_file():
            original = read_json(selection_path)
        else:
            plan = store.get(args.plan_id, args.revision)
            visits = args.visit_id or [row["id"] for row in plan["visits"]]
            if not visits or len(set(visits)) != len(visits) or set(visits) - {row["id"] for row in plan["visits"]}:
                raise ValueError("Choose one or more distinct original visit IDs from this saved plan")
            title = args.title or plan["title"] + " — scientific fieldwork"
            original = {"schema": SCHEMA, **intent, "revision": plan["revision"],
                        "document_digest": document_digest(plan), "title": title,
                        "visit_ids": visits, "crew_title": plan["title"] + " — crew packet"}
            atomic_json(selection_path, original, immutable=True)
            if input_path:
                atomic_bytes(root / "original-source-selection.json", input_path.read_bytes(), immutable=True)
        selected = store.get(args.plan_id, original["revision"])
        if document_digest(selected) != original["document_digest"]:
            raise ValueError("The pinned original plan revision changed")
        state_path = root / "state.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "operation_id": "scientific-fieldwork-" + digest(original),
            "original_sha256": digest(original), "created_at": now()}
        if state.get("original_sha256") != digest(original):
            raise ValueError("This retained course belongs to another original scientific selection")
        def checkpoint(phase, **values):
            state.update(values, phase=phase, updated_at=now())
            atomic_json(state_path, state)
            emit(phase, operation=str(root))
        try:
            checkpoint("opening_original")
            report = plan_report(store, root, state, checkpoint, original)
            if state.get("source_key"):
                source = implementation_report_source.get_report_source(workspace, state["source_key"], state["source_operation_id"])
            else:
                preview = implementation_report_source.preview_report_source(workspace, args.plan_id, report["id"])
                checkpoint("registering_plan_report", source_preview_id=preview["operation_id"])
                source = implementation_report_source.import_report_source(
                    workspace, args.plan_id, report["id"], expected_operation_id=preview["operation_id"])
                checkpoint("plan_report_registered", source_key=source["source_key"], source_operation_id=source["operation_id"])
            science = render_science(workspace, root, state, checkpoint, original, source)
            briefing_record = briefing(workspace, state, checkpoint, science["id"])
            packet = crew(workspace, state, checkpoint, original)
            selection = {"schema": "upstate.study-selection/v1", "title": original["title"],
                         "roots": [{"kind": "scientific-report-editions", "id": science["id"]}],
                         "include_related_results": True}
            atomic_json(root / "study-selection.json", selection, immutable=True)
            checkpoint("exporting_study")
            exported = study_transfer.export_study(workspace, root / "scientific-fieldwork-study.zip", selection,
                progress=lambda row: emit("study_export", **row))
            checkpoint("study_exported", study_id=exported["id"], study_archive=exported)
            transfer = NativeProjectTransfer(workspace, root / "transfer")
            snapshot = transfer.store.capture_archive(exported["path"],
                progress=lambda row: emit("study_index", **row))
            checkpoint("receiving_study", study_snapshot_id=snapshot["id"])
            received_study = transfer.restore(snapshot["id"], root / "received-study",
                progress=lambda row: emit("study_receive", **row))
            checkpoint("study_received", study_receiving=received_study)
            captured = capture_workspace(transfer, state, checkpoint)
            checkpoint("receiving_workspace")
            received_whole = transfer.restore(captured["snapshot_id"], root / "received-workspace",
                progress=lambda row: emit("workspace_receive", **row))
            checkpoint("workspace_received", workspace_receiving=received_whole)
            expected = {"schema": SCHEMA, "project_id": workspace.project["id"],
                        "plan": {"id": args.plan_id, "revision": original["revision"], "document_digest": original["document_digest"]},
                        "plan_report_id": report["id"], "source_key": source["source_key"],
                        "source_operation_id": source["operation_id"], "scientific_edition_id": science["id"],
                        "briefing_id": briefing_record["id"], "deployment_id": packet["id"],
                        "deployment_plan": packet["plan"], "deployment_selection": packet["selection"],
                        "study_id": exported["id"]}
            expected_path = root / "receiving-selection.json"
            atomic_json(expected_path, expected, immutable=True)
            checks = {kind: fresh_process(root, received, expected_path, kind, state, checkpoint)
                      for kind, received in (("study", received_study), ("workspace", received_whole))}
            result = {"schema": SCHEMA, "state": "complete", "completed_at": now(),
                      "operation": str(root), "project_id": workspace.project["id"], "original": original,
                      **{name: expected[name] for name in ("plan_report_id", "scientific_edition_id", "briefing_id", "deployment_id", "study_id")},
                      "study_archive": {name: exported[name] for name in ("path", "bytes", "sha256", "members")},
                      "workspace_archive": captured["archive"], "study_receiving": received_study,
                      "workspace_receiving": received_whole, "fresh_processes": checks}
            start_page(root, result)
            atomic_json(root / "result.json", result)
            checkpoint("complete", result_file=str(root / "result.json"), start_here=str(root / "START_HERE.html"))
            return result
        except BaseException as error:
            checkpoint("interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                       error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", help="Retained operation directory outside application and Workspace")
    parser.add_argument("--plan-id", help="Original saved Implementation plan")
    parser.add_argument("--revision", type=int, help="Exact native revision; first run pins the current revision by default")
    parser.add_argument("--report-id", help="Existing native report for this revision; otherwise reuses or creates its report")
    parser.add_argument("--as-of", default="2026-10-13")
    parser.add_argument("--title")
    parser.add_argument("--sources", help="Ordered existing source choices or native delivery-selection JSON")
    parser.add_argument("--visit-id", action="append", help="Repeat for an ordered subset; defaults to every original saved visit")
    parser.add_argument("--verify-received", choices=("study", "workspace"), help=argparse.SUPPRESS)
    parser.add_argument("--expect", help=argparse.SUPPRESS)
    parser.add_argument("--result", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.verify_received:
            if not args.expect or not args.result:
                parser.error("The fresh receiver requires its retained selection and output")
            output = Path(args.result)
            with held(output.parent / ".receiving.lock", blocking=False):
                verify_received(args.workspace, args.expect, output, args.verify_received)
        else:
            if not args.operation or not args.plan_id:
                parser.error("Choose the original --plan-id and retained --operation")
            print(json.dumps(run(args), ensure_ascii=False, indent=2), flush=True)
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
