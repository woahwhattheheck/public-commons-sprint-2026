"""Prepare and receive an actual-geography, simulated-input Upper Savannah case.

Preparation uses retained original geography and ordinary Workspace APIs.
--run continues the existing native parameter course and exports its real report.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import time

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, now, read_json
from model.workspace import Workspace
from model import geographic_headwaters as geographic
from source_tools.geographic_headwaters_reopen import cold_reopen, receiving_lock
from source_tools.demo_deadline import CUTOFF, DemoDeadlineReached, check_cutoff, cutoff_guard
from source_tools.geographic_archive import retained_prepared, retain_binding, verify_archive
from source_tools.geographic_headwaters_handover import prepare as prepare_handover


def _outside(path, root):
    if path.is_relative_to(root) or root.is_relative_to(path):
        raise ValueError("Keep receiving output separate from the application and Workspace")


def _scientific_source(workspace, ensemble_id, output):
    """Reuse the verified complete source edition without rewriting its operation.

    The maintained producer decides whether its source/result signatures remain
    current. Changed signatures still receive a new ordinary producer edition.
    Every selected snapshot is retained before advancing the receiving pointer.
    """
    from model import ensemble_study_source as study_source

    scientific = study_source.latest(workspace, ensemble_id, verify=True)
    if (scientific is None or scientific.get("state") != "complete"
            or scientific.get("source_state") != "current"):
        scientific = study_source.prepare(workspace, ensemble_id, render=True)
    if scientific.get("state") != "complete":
        raise ValueError("Continue the original ensemble scientific source until complete")
    # Verify the selected complete operation and all of its existing native
    # source/report members after a prepare as well as during a retained reopen.
    verified = study_source.latest(workspace, ensemble_id, verify=True)
    if verified != scientific or verified.get("source_state") != "current":
        raise ValueError("The selected scientific source advanced during receiving; retain this original attempt and reopen")
    pointer = Path(output) / "scientific-source.json"
    for value in ([read_json(pointer)] if pointer.exists() else []) + [scientific]:
        if (value.get("workspace_id") != workspace.project["id"]
                or value.get("ensemble_id") != ensemble_id
                or value.get("id") != digest(value.get("selection"))):
            raise ValueError("Retained scientific snapshot belongs to another original study")
        atomic_json(Path(output) / "scientific-editions" / value["id"]
                    / (digest(value) + ".json"), value, immutable=True)
    atomic_json(pointer, scientific)
    return scientific


def receive(args):
    workspace = Workspace(args.workspace.resolve(), create=True, title="Upper Savannah geographic demonstration")
    # Source intake is explicit; paths name original ordinary Workspace manifests.
    for manifest in args.import_sources:
        with held(workspace.root/".workspace.lock", blocking=False):
            workspace.import_sources(manifest.resolve(strict=True))
    if args.catalog:
        return geographic.catalog(workspace)
    if args.selection is None:
        raise ValueError("Supply --selection, or inspect the actual --catalog first")
    source_bytes = args.selection.resolve(strict=True).read_bytes()
    selection = geographic.normalize(json.loads(source_bytes))
    if args.preview:
        return geographic.preview(workspace, selection)
    output = args.output.resolve()
    _outside(output, workspace.root.resolve())
    _outside(output, APP)
    output.mkdir(parents=True, exist_ok=True)
    with receiving_lock(output/".geographic-receiving.lock") as receiving_lock_fd:
        original_selection = output/"original-selection.json"
        atomic_bytes(original_selection, source_bytes, immutable=True)
        admission = {"schema":"upstate.geographic-headwaters-receiving/v1",
                     "project_id":workspace.project["id"],"selection":selection,
                     "selection_bytes_sha256":hashlib.sha256(source_bytes).hexdigest(),
                     "implementation_sha256":file_digest(APP/"model/geographic_headwaters.py"),
                     "receiver_sha256":file_digest(Path(__file__))}
        path = output/"receiving.json"
        adopted_prepared = None
        if args.adopt_handover:
            original_admission, state, adopted_prepared = retained_prepared(
                workspace, output, source_bytes, selection)
            operation_id = state["operation_id"]
            adopted_source = {
                "schema": "upstate.geographic-handover-adoption/v1",
                "operation_id": operation_id, "project_id": workspace.project["id"],
                "original_admission": original_admission,
                "geographic_edition_id": adopted_prepared["id"],
                "sources": {name: file_digest(APP/name) for name in (
                    "source_tools/receive_geographic_headwaters.py",
                    "source_tools/geographic_archive.py",
                    "source_tools/geographic_headwaters_reopen.py",
                    "source_tools/geographic_headwaters_handover.py",
                    "source_tools/simulated_headwaters_receiving.py",
                    "source_tools/simulated_headwaters_handover.py",
                    "source_tools/demo_deadline.py",
                    "model/geographic_receiving_context.py",
                    "source_tools/geographic_scenario_context.py",
                    "source_tools/geographic_scenario_interpretation.mjs")},
            }
            adoption_id = digest(adopted_source)
            atomic_json(output/"handover-adoptions"/(adoption_id+".json"),
                        {"id":adoption_id, **adopted_source}, immutable=True)
            state["handover_adoption_id"] = adoption_id
        else:
            operation_id = digest(admission)
            atomic_json(output/"admission.json", {"id":operation_id,**admission}, immutable=True)
            state = read_json(path) if path.exists() else {
                "schema":admission["schema"],"operation_id":operation_id,
                "project_id":workspace.project["id"],"created_at":now(),"stages":{}}
            if state["operation_id"] != operation_id:
                raise ValueError("Resume the original source/receiver edition in this directory; use explicit --report-only --adopt-handover for a completed original preparation")
        def save(**values):
            state.update(values,updated_at=now())
            atomic_json(path,state)
        def phase(name, action):
            started = time.perf_counter()
            save(active_stage=name,state="running")
            print(json.dumps({"operation_id":operation_id,"stage":name,"state":"running"}),flush=True)
            try:
                check_cutoff()
                result = action()
            except BaseException as error:
                try:
                    save(state="interrupted" if not isinstance(error,Exception) else "failed",
                         error={"type":type(error).__name__,"message":str(error),"stage":name})
                except Exception as receipt_error:
                    if hasattr(error,"add_note"):
                        error.add_note("Receipt write failed: "+str(receipt_error))
                raise
            elapsed = time.perf_counter()-started
            previous = state["stages"].get(name,{})
            state["stages"][name] = {"state":"complete",
                "first_completed_at":previous.get("first_completed_at",now()),
                "first_elapsed_seconds":previous.get("first_elapsed_seconds",elapsed),
                "latest_elapsed_seconds":elapsed}
            state.pop("error",None)
            save()
            return result
        prepared = adopted_prepared or phase("prepare_geographic_inputs",lambda:geographic.prepare(workspace,selection))
        atomic_json(output/"prepared.json",prepared,immutable=True)
        save(prepared=prepared,geographic_edition_id=prepared["id"],
             ensemble_id=prepared["ensemble_id"])
        if not args.run and not args.report_only:
            save(state="prepared",active_stage=None)
            return state
        from source_tools.headwaters_parameter_course import continue_course
        course = phase("native_parameter_course",lambda:continue_course(
            workspace,prepared["ensemble_id"],execute=args.run,
            on_progress=lambda value:print(json.dumps({"native_progress":value},default=str),flush=True)))
        atomic_json(output/"parameter-course.json",course)
        save(parameter_course=course)
        if course["state"] != "complete":
            save(state="partial",active_stage=None)
            return state
        from model import geographic_receiving_context as utility_context
        utilities = phase("utility_comparisons", lambda: utility_context.prepare(
            workspace, prepared,
            progress=lambda value: print(json.dumps({"utility_progress":value}, default=str), flush=True)))
        atomic_json(output/"utility-comparisons.json", utilities)
        save(utility_comparisons=utilities)
        from source_tools import geographic_scenario_context as scenario_context
        interpreted = phase("scenario_source_context", lambda: scenario_context.prepare(
            workspace, prepared, output/"scenario-source-context", node=args.node,
            receiving_lock_fd=receiving_lock_fd,
            receiving_lock_path=output/".geographic-receiving.lock"))
        atomic_json(output/"scenario-source-context.json", interpreted)
        save(scenario_source_context=interpreted)
        from model.ensemble_scientific_source import delivery_selection
        scientific = phase("scientific_report", lambda: _scientific_source(
            workspace, prepared["ensemble_id"], output))
        save(scientific_source_generation={"id": scientific["id"],
             "snapshot_digest": digest(scientific),
             "snapshot": str(Path("scientific-editions") / scientific["id"]
                             / (digest(scientific) + ".json"))})
        selected = {
            "delivery_mode":"native_study","audit_scope":"source-native",
            "native_study":{"title":selection["title"],"purpose":selection["question"],
                            "reference":"geographic-edition:"+prepared["id"]},
            "baseline_run_id":prepared["baseline_run_id"],
            "scenario_run_ids":prepared["alternative_run_ids"],
            "contact":{"name":"Upper Savannah project team","organization":"Internal geographic demonstration","email":""},
            "source_roles":{},
            "overlays":{"drinking_water":{"source_collection_id":prepared["source_collection_id"],
                        "source_id":"GEOGRAPHIC_UTILITY_FOCUS",
                        "label":selection["utility_label"]+": original footprint within reporting area"}},
            "map_settings":{"weights":{"nitrogen_export":1,"phosphorus_export":1,"sediment_export":1}},
            "notes":["Actual geography; explicitly simulated terrain, forcing, land cover and source coefficients.",
                     "Upstream computational domain, South Carolina reporting area and utility focus are distinct.",
                     "Annual stream export is not concentration or intake delivery.",
                     "Restoration/control preserve actual class counts, area and recorded rainfall residuals."]}
        selected = delivery_selection(scientific["source"], selected)
        selected = utility_context.append_sources(selected, utilities)
        selected = scenario_context.append_source(selected, interpreted)
        atomic_json(output/"delivery-selection.json",selected)
        delivery = phase("mapped_delivery",lambda:workspace.build_delivery(selected))
        if delivery.get("state") != "complete":
            raise ValueError("Complete the original mapped delivery before handover")
        save(scientific_source=scientific["source"],delivery_id=delivery["id"])
        atomic_json(output/"mapped-delivery.json",delivery)
        from model import reviews
        review_selection = {"schema":reviews.SELECTION_SCHEMA,
            "title":selection["title"]+": geography, assumptions and native results",
            "purpose":selection["question"],"source_collection_ids":list(dict.fromkeys([prepared["source_collection_id"],
                    scientific["source"]["source_collection_id"],
                    *utility_context.source_collection_ids(utilities),
                    interpreted["source"]["source_collection_id"]])),
            "run_ids":[prepared["baseline_run_id"],*prepared["alternative_run_ids"]],
            "delivery_ids":[delivery["id"]],"spatial_export_ids":[],
            "requirements":[
                {"id":"geography","title":"Review actual geography and scope",
                 "detail":"Check original HUC membership, upstream closure, South Carolina reporting intersection and separate utility footprint."},
                {"id":"assumptions","title":"Review simulated assumptions",
                 "detail":"Check assumed terrain, rainfall, erodibility, land cover, coefficients and treatment/control matching."},
                {"id":"native-results","title":"Review native support and annual export",
                 "detail":"Check original producing models, common finite cells, annual mass units and separate routing-support groups."}],
            "notes":["Scientific approval is recorded only through the actual returned reviewer response."]}
        review = phase("customer_review",lambda:reviews.create_review(
            workspace,review_selection,created_at=state["created_at"]))
        save(customer_review_id=review["id"])
        review_packet = reviews.show_review(workspace,review["id"],previews=False)
        response_id = review_packet["latest_response_id"]
        review_directory = output/"customer-review"/review["id"]/(response_id or "request")
        if review_directory.exists():
            exported = reviews.describe_export(review_directory)
            if (exported["review_id"] != review["id"] or
                    exported["project_id"] != workspace.project["id"] or
                    exported["latest_response_id"] != response_id):
                raise ValueError("Retained review export differs from the selected response generation")
        else:
            exported = phase("review_export",lambda:reviews.export_review(
                workspace,review["id"],review_directory,expected_response_id=response_id))
        save(review_export=exported)
        handover = phase("handover", lambda: prepare_handover(
            workspace, output, state, prepared, scientific, delivery, exported))
        save(handover=handover)
        archive_policy = {"include_intermediates": True, "include_deliveries": True}
        selected_binding = retain_binding(
            workspace, output, prepared, scientific, delivery, review, response_id,
            archive_selection=archive_policy, handover=handover, utility_context=utilities)
        save(archive_binding_id=selected_binding["id"])
        from model import portable
        edition = digest({"prepared":prepared["id"],"ensemble":prepared["ensemble_id"],
                          "scientific_source":scientific["id"],"delivery":delivery["id"],"review":review["id"],
                          "review_response_id":response_id, "handover_id":handover["id"],
                          "utility_context_id":utilities["id"],
                          "scenario_context_id":interpreted["id"], "binding_id":selected_binding["id"]})
        archive = output/("geographic-study-"+edition+".zip")
        archives = state.setdefault("archive_editions",{})
        previous = archives.get(edition)
        if previous is not None or archive.exists():
            manifest, saved = phase("archive", lambda: verify_archive(
                archive, selected_binding, previous=previous))
        else:
            phase("archive", lambda: portable.backup(
                workspace, archive, **archive_policy,
                delivery_root=handover["directory"], delivery_files=handover["files"]))
            manifest, saved = verify_archive(archive, selected_binding)
        archives[edition] = saved
        save(archive=saved, archive_editions=archives)
        received = output/"reopened"/edition
        if received.exists():
            restored = phase("resume_independent_restore",lambda:portable.resume_restore(
                archive,received,expected_archive_sha256=saved["sha256"]))
        else:
            received.parent.mkdir(parents=True,exist_ok=True)
            restored = phase("independent_restore",lambda:portable.restore(archive,received))
        save(restored=restored)
        if (Path(restored["directory"]).resolve() != received.resolve()
                or restored["archive_sha256"] != saved["sha256"]
                or restored["project"] != workspace.project):
            raise ValueError("Independent receiving returned another original archive or project")
        cold = phase("independent_cold_reopen", lambda: cold_reopen(
            restored, manifest, prepared, scientific, delivery["id"], review["id"],
            output/"cold-reopen"/edition, receiving_lock_fd=receiving_lock_fd,
            receiving_lock_path=output/".geographic-receiving.lock",
            review_response_id=response_id, receiving_context=utilities,
            scenario_context=interpreted))
        save(state="complete", active_stage=None,
             completed_at=state.get("completed_at", now()), independent_reopen=cold)
        return state


def _retain_geographic_checkpoint(args, error):
    """Preserve the same original receiving record at the owner's native cutoff."""
    output = args.output.resolve()
    receipt = output / "receiving.json"
    original = {}
    read_error = None
    if receipt.is_file():
        try:
            original = read_json(receipt)
            if original.get("schema") != "upstate.geographic-headwaters-receiving/v1":
                raise ValueError("The receiving receipt has another original schema")
        except (OSError, ValueError, TypeError) as problem:
            read_error = {"type": type(problem).__name__, "message": str(problem)}
            original = {}
    checkpoint = {
        "schema": "upstate.geographic-headwaters-checkpoint/v1",
        "cutoff": CUTOFF.isoformat(), "stopped_at": now(),
        "state": "cutoff" if isinstance(error, DemoDeadlineReached) else "interrupted",
        "workspace": str(args.workspace.resolve()), "output": str(output),
        "source_receipt": str(receipt) if receipt.exists() else None,
        "operation_id": original.get("operation_id"),
        "project_id": original.get("project_id"),
        "active_stage": original.get("active_stage"),
        "recorded_state": original.get("state"),
        "error": {"type": type(error).__name__, "message": str(error)},
        "retained_receiving": original,
    }
    if read_error is not None:
        checkpoint["receipt_read_error"] = read_error
    atomic_json(output / "geographic-checkpoint.json", checkpoint)
    return checkpoint


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",type=Path,required=True)
    parser.add_argument("--import-sources",type=Path,action="append",default=[])
    parser.add_argument("--selection",type=Path)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--node",default="node",help="Actual equipped Node executable for the maintained complete source-loading report")
    parser.add_argument("--adopt-handover",action="store_true",help="Use the completed original preparation under its retained admission for report-only handover source adoption")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--catalog",action="store_true")
    modes.add_argument("--preview",action="store_true")
    modes.add_argument("--prepare-only",action="store_true")
    modes.add_argument("--run",action="store_true")
    modes.add_argument("--report-only",action="store_true")
    args = parser.parse_args(argv)
    if args.adopt_handover and not args.report_only:
        parser.error("--adopt-handover requires --report-only; native preparation keeps its original admitted source")
    if not (args.catalog or args.preview) and args.output is None:
        parser.error("--output is required for preparation or receiving")
    if args.catalog or args.preview:
        result = receive(args)
    else:
        try:
            with cutoff_guard():
                result = receive(args)
        except BaseException as error:
            if not isinstance(error, Exception):
                try:
                    _retain_geographic_checkpoint(args, error)
                except Exception as receipt_error:
                    if hasattr(error, "add_note"):
                        error.add_note("Geographic checkpoint write failed: " + str(receipt_error))
            raise
    print(json.dumps(result,indent=2,sort_keys=True,allow_nan=False))
    return 2 if result.get("state") == "partial" else 0


if __name__ == "__main__":
    raise SystemExit(main())
