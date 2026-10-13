#!/usr/bin/env python3
"""Receive original forcing sources through native management results and portable reopening.

TokenJunkieLabs. This course orchestrates the installed original scientific APIs.
It never constructs substitute rasters, model parameters, scenarios or run IDs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time

SCHEMA = "upstate.climate-management-receiving/v1"
CONFIG_SCHEMA = "upstate.climate-management-course/v1"
SOURCE_PATHS = (
    "CURRENT_OWNER_DIRECTION.md",
    "source_tools/receive_climate_management.py", "source_tools/compose.py",
    "model/forcing_sources.py", "model/climate_forcing.py",
    "model/climate_management.py", "model/climate_management_figures.py",
    "model/climate_forcing_study_transfer.py", "model/climate_management_study_transfer.py",
    "model/study_transfer.py", "model/scientific_report_editions.py",
    "model/observed_report_render.py", "model/portable.py", "model/native.py",
    "operator/native_jobs.py", "model/native_worker.py", "ecsa_runs/upstate.py",
    "operator/server.py", "operator/climate_forcing.py",
    "operator/climate_management.py", "operator/source_report_editions.py",
    "operator/study_transfer.py",
)
ROLES = ("reference", "treatment", "control")


def identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select an original regular file: " + str(path))
    checksum = hashlib.sha256()
    count = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            count += len(block)
            checksum.update(block)
    if path.stat().st_size != count:
        raise ValueError("An original input changed during its identity check")
    return {"bytes": count, "sha256": checksum.hexdigest()}


def pinned(path, descriptor):
    actual = identity(path)
    if (type(descriptor.get("bytes")) is not int or descriptor["bytes"] < 0
            or not re.fullmatch(r"[0-9a-f]{64}", str(descriptor.get("sha256", "")))
            or actual != {name: descriptor.get(name) for name in actual}):
        raise ValueError("Original file differs from the selected bytes/SHA256: " + str(path))
    return actual


def text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Retain an explicit " + name)
    return value


def safe_name(value, name):
    value = text(value, name)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", value):
        raise ValueError("Use a short plain identifier for " + name)
    return value


def file_path(base, value):
    path = Path(text(value, "original input path")).expanduser()
    path = path if path.is_absolute() else base / path
    if path.is_symlink():
        raise ValueError("Select the original file rather than a symbolic link")
    return path.resolve(strict=True)


def application_sources(root):
    return {name: identity(root / name) for name in SOURCE_PATHS}


def copy_download(operator, ticket, destination):
    """Use the original authenticated ticket and verify all bytes before publication."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError("A retained receiving destination is a symbolic link")
    temporary = destination.with_name(destination.name + ".receiving")
    if temporary.is_symlink():
        raise ValueError("A receiving temporary path is a symbolic link")
    stream, opened = operator.open_download(ticket["id"])
    total, checksum = 0, hashlib.sha256()
    try:
        with temporary.open("wb") as target:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                total += len(block)
                checksum.update(block)
                target.write(block)
    finally:
        stream.close()
    actual = {"bytes": total, "sha256": checksum.hexdigest()}
    if actual != {name: ticket[name] for name in actual}:
        temporary.unlink(missing_ok=True)
        raise ValueError("The complete original download differs from its saved descriptor")
    if destination.exists():
        if identity(destination) != actual:
            temporary.unlink(missing_ok=True)
            raise ValueError("The receiving output already contains another original edition")
        temporary.unlink()
    else:
        temporary.replace(destination)
    return {"path": str(destination), **actual, "ticket_id": opened["id"]}


def configuration(path, workspace):
    """Validate original source files before import or preparation mutates this course."""
    from model.common import read_json, relative_file, identifier
    path = Path(path).resolve(strict=True)
    value = read_json(path)
    allowed = {"schema", "project_id", "title", "purpose", "source_manifest_directory",
               "sources", "roles", "periods", "reference_period_id",
               "reporting_areas", "difference_maps"}
    if not isinstance(value, dict) or value.get("schema") != CONFIG_SCHEMA or set(value) - allowed:
        raise ValueError("Use the complete original climate-management receiving configuration")
    if value.get("project_id") != workspace.project["id"]:
        raise ValueError("The receiving configuration names another original project")
    text(value.get("title"), "course title")
    text(value.get("purpose"), "scientific purpose")
    if type(value.get("difference_maps", True)) is not bool:
        raise ValueError("Select difference maps with a boolean")
    if not isinstance(value.get("reporting_areas", []), list):
        raise ValueError("Retain the existing reporting-area selections")
    roles = value.get("roles")
    if (not isinstance(roles, dict) or set(roles) not in (
            {"reference", "treatment"}, {"reference", "treatment", "control"})):
        raise ValueError("Select original reference and treatment runs, plus control only when retained")
    originals = {}
    for role in ROLES:
        if role not in roles:
            continue
        requested = roles[role]
        if not isinstance(requested, dict) or set(requested) != {"baseline_run_id"}:
            raise ValueError("Each role names its original completed baseline_run_id")
        run_id = identifier(requested["baseline_run_id"])
        run = workspace.inspect_run(run_id)
        if run.get("state") != "complete":
            raise ValueError("Complete the selected original role before this forcing course: " + role)
        originals[role] = {
            "run_id": run_id, "selection": copy.deepcopy(run["selection"]),
            "record": identity(workspace.root / "runs" / run_id / "run.json"),
            "artifacts": copy.deepcopy(run.get("artifacts", {})),
        }
    if len({row["run_id"] for row in originals.values()}) != len(originals):
        raise ValueError("Reference, treatment and control must identify their distinct original runs")
    reference = originals["reference"]["selection"]
    for role, original in originals.items():
        for field in ("grid_id", "profile_id", "invest_version", "models"):
            if original["selection"].get(field) != reference.get(field):
                raise ValueError("All roles must retain the same original " + field + ": " + role)
    sources = value.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Select actual prepared source-entry files and their complete identities")
    source_rows, seen = {}, set()
    for row in sources:
        if not isinstance(row, dict) or set(row) != {"key", "entry", "bytes", "sha256"}:
            raise ValueError("Each source needs key, entry path, bytes and SHA256")
        key = safe_name(row["key"], "source key")
        if key in source_rows:
            raise ValueError("A prepared source key is repeated")
        entry_path = file_path(path.parent, row["entry"])
        pinned(entry_path, row)
        entry = read_json(entry_path)
        if (entry.get("kind") != "raster" or entry.get("role") not in {"PRECIPITATION", "R_FACTOR"}
                or not entry.get("id") or entry["id"] in seen):
            raise ValueError("Select distinct original typed precipitation or erosivity source entries")
        seen.add(entry["id"])
        members = []
        for item in [entry, *entry.get("companions", [])]:
            member = relative_file(entry_path.parent, item["path"])
            descriptor = pinned(member, item)
            members.append({"path": str(member), **descriptor})
        source_rows[key] = {"entry_path": str(entry_path), "entry_identity": identity(entry_path),
                            "entry": entry, "members": members}
    periods = value.get("periods")
    if not isinstance(periods, list) or not periods:
        raise ValueError("Select one or more actual forcing periods")
    period_ids, used = [], set()
    for period in periods:
        if not isinstance(period, dict) or set(period) != {"id", "label", "overrides"}:
            raise ValueError("A period needs its original ID, label and explicit forcing overrides")
        key = safe_name(period["id"], "period ID")
        if key == "baseline" or key in period_ids:
            raise ValueError("Use unique period IDs separate from the original baseline")
        period_ids.append(key)
        text(period["label"], "period label")
        overrides = period["overrides"]
        if not isinstance(overrides, dict) or not overrides or set(overrides) - {"PRECIPITATION", "R_FACTOR"}:
            raise ValueError("Each period explicitly selects precipitation and/or independent erosivity")
        for role, choice in overrides.items():
            if not isinstance(choice, dict) or set(choice) != {
                    "source_key", "period_label", "temporal_basis", "interpretation"}:
                raise ValueError("Retain the full source period, temporal basis and interpretation")
            original = source_rows.get(choice["source_key"])
            if original is None or original["entry"]["role"] != role:
                raise ValueError("A forcing role names another source kind or an unselected entry")
            used.add(choice["source_key"])
            for field in ("period_label", "temporal_basis", "interpretation"):
                text(choice[field], field)
    if used != set(source_rows):
        raise ValueError("Every admitted source entry must belong to the explicit period selection")
    if value.get("reference_period_id") not in period_ids:
        raise ValueError("Select the explicit reference period from this original matrix")
    selected_root = Path(text(value.get("source_manifest_directory"), "source manifest directory")).expanduser()
    selected_root = selected_root if selected_root.is_absolute() else path.parent / selected_root
    root = selected_root.resolve(strict=True)
    if not root.is_dir() or selected_root.is_symlink() or root.is_relative_to(workspace.root):
        raise ValueError("Keep composed source manifests in the original source directory outside the Workspace")
    for source in source_rows.values():
        for selected in [source["entry_path"], *[member["path"] for member in source["members"]]]:
            if not Path(selected).is_relative_to(root):
                raise ValueError("Place source_manifest_directory above all actual source entries and companions")
    return value, originals, source_rows, root


def product_snapshot(workspace, studies, forcing_reports, management_id, scientific_id):
    """Freeze complete existing products without recalculating their numerical results."""
    from model import climate_forcing, climate_management, scientific_report_editions
    from model.common import read_json
    runs = {}
    for study_id in studies.values():
        study = climate_forcing.get(workspace, study_id)
        if study["state"] != "complete":
            raise ValueError("A selected forcing study is not complete")
        for case in study["cases"]:
            run_id = case["run_id"]
            workspace.inspect_run(run_id)
            runs[run_id] = identity(workspace.root / "runs" / run_id / "run.json")
    management = climate_management.get_report(workspace, management_id, verify=True)
    scientific, directory, unused = scientific_report_editions.inspect(workspace, scientific_id)
    return {
        "project": workspace.project,
        "studies": {role: {
            "id": key,
            "selection": read_json(workspace.root / climate_forcing.ROOT / key / "selection.json"),
            "study": read_json(workspace.root / climate_forcing.ROOT / key / "study.json"),
        } for role, key in studies.items()},
        "forcing_reports": {role: climate_forcing.get_report(
            workspace, studies[role], key, verify=True) for role, key in forcing_reports.items()},
        "management": management, "scientific": scientific, "runs": runs,
        "source_collection": workspace._get("sources", management["source"]["source_collection_id"]),
        "scientific_members": scientific_report_editions.files(scientific, directory),
        "scientific_archive": read_json(directory / "report-files.json")["file"],
    }


def verify_products(operator, workspace_key, expected):
    """Read the same selected native products and every file through original tickets."""
    from model import climate_forcing, climate_management, scientific_report_editions
    from model.common import relative_file, read_json
    workspace = operator.ws(workspace_key)
    if workspace.project != expected["project"]:
        raise ValueError("The received Workspace changed the original project")
    for role, saved in expected["studies"].items():
        key = saved["id"]
        current = climate_forcing.get(workspace, key)
        directory = workspace.root / climate_forcing.ROOT / key
        if (current["state"] != "complete" or read_json(directory / "selection.json") != saved["selection"]
                or read_json(directory / "study.json") != saved["study"]):
            raise ValueError("The received forcing study changed its original saved state")
    for key, descriptor in expected["runs"].items():
        workspace.inspect_run(key)
        pinned(workspace.root / "runs" / key / "run.json", descriptor)
    management = climate_management.get_report(workspace, expected["management"]["id"], verify=True)
    if management != expected["management"]:
        raise ValueError("The received management report changed its original result or file identities")
    if workspace._get("sources", management["source"]["source_collection_id"]) != expected["source_collection"]:
        raise ValueError("The received report's registered original source collection changed")
    scientific, directory, unused = scientific_report_editions.inspect(workspace, expected["scientific"]["id"])
    if scientific != expected["scientific"]:
        raise ValueError("The received scientific edition changed")
    archive = read_json(directory / "report-files.json")["file"]
    if archive != expected["scientific_archive"]:
        raise ValueError("The received complete scientific report ZIP changed")
    products = {"management": (workspace.root / management["directory"], management["files"]),
                "scientific": (directory, scientific_report_editions.files(scientific, directory)),
                "scientific-archive": (directory, {"report-files.zip": archive})}
    for role, report in expected["forcing_reports"].items():
        actual = climate_forcing.get_report(workspace, expected["studies"][role]["id"], report["id"], verify=True)
        if actual != report:
            raise ValueError("The received forcing report changed: " + role)
        products["forcing-" + role] = (workspace.root / actual["directory"], actual["files"])
    downloads = {}
    for family, (directory, files) in products.items():
        downloads[family] = {}
        for name, descriptor in files.items():
            path = relative_file(directory, descriptor["path"])
            ticket = operator._ticket(workspace_key, path, descriptor, name)
            stream, unused = operator.open_download(ticket["id"])
            count, checksum = 0, hashlib.sha256()
            try:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    count += len(block)
                    checksum.update(block)
            finally:
                stream.close()
            actual = {"bytes": count, "sha256": checksum.hexdigest()}
            if actual != {field: descriptor[field] for field in actual}:
                raise ValueError("A received original download changed: " + family + "/" + name)
            downloads[family][name] = actual
    return {"project_id": workspace.project["id"], "workspace_key": workspace_key,
            "workspace": str(workspace.root), "management_id": management["id"],
            "scientific_report_edition_id": scientific["id"], "downloads": downloads}


COLD_REOPEN = r"""
import json,sys
from pathlib import Path
application=Path(sys.argv[1]).resolve(strict=True)
sys.path[:0]=[str(application/'operator'),str(application)]
from server import Operator
from source_tools.receive_climate_management import verify_products,application_sources
from model import study_transfer
value=json.loads(sys.stdin.read())
operator=Operator(value['workspace'],value['state_directory'])
try:
    result=verify_products(operator,operator.primary,value['expected'])
    if value['selected_study']:
        result['received_studies']=study_transfer.verify_received_studies(operator.ws(operator.primary))
    result['application']=str(application)
    result['application_sources']=application_sources(application)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False,sort_keys=True))
finally:
    operator.close()
"""


def _receive(application, workspace, state_directory, output, config, *,
            execute=False, resume_failed=False, refresh_incomplete=(), timeout=14400):
    application = Path(application).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    state_directory = Path(state_directory).resolve()
    output = Path(output).resolve()
    config = Path(config).resolve(strict=True)
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("Use a positive finite original-task wait timeout")
    for selected in (state_directory, output):
        if selected.is_relative_to(workspace) or selected.is_relative_to(application):
            raise ValueError("Keep receiving state and downloads outside the original application and Workspace")
    if output == state_directory or output.is_relative_to(state_directory) or state_directory.is_relative_to(output):
        raise ValueError("Keep output and operator state in separate directories")
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator
    from model.workspace import Workspace
    from model import climate_forcing, climate_management, scientific_report_editions, study_transfer
    from model.common import atomic_json, digest, now, read_json, relative_file
    from source_tools.compose import compose
    ws = Workspace(workspace, create=False)
    chosen, originals, sources, source_root = configuration(config, ws)
    source_revision = application_sources(application)
    identity_value = {
        "schema": SCHEMA, "project_id": ws.project["id"], "application": str(application),
        "workspace": str(workspace), "output": str(output),
        "configuration": chosen, "configuration_file": {"path": str(config), **identity(config)},
        "original_roles": originals, "prepared_sources": sources, "source_manifest_directory": str(source_root),
    }
    state_directory.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    journal_path = state_directory / "climate-management-receiving.json"
    journal = read_json(journal_path) if journal_path.is_file() else None
    if journal and journal["identity"] != identity_value:
        raise ValueError("Retain the same original course configuration, source bytes and role identities")
    journal = journal or {"identity": identity_value, "phases": {}, "previews": {},
                          "source_revisions": [], "superseded": [], "native_cases": {}}
    def persist():
        atomic_json(journal_path, journal)
    if not journal["source_revisions"] or journal["source_revisions"][-1]["files"] != source_revision:
        journal["source_revisions"].append({"observed_at": now(), "files": source_revision})
    persist()
    if not execute:
        result = {"schema": SCHEMA, "status": "inputs-verified",
                  "project_id": ws.project["id"], "original_roles": originals,
                  "source_entries": {key: {"id": value["entry"]["id"],
                                          "role": value["entry"]["role"],
                                          "entry_path": value["entry_path"],
                                          **value["entry_identity"]} for key, value in sources.items()},
                  "periods": chosen["periods"], "journal": str(journal_path),
                  "native_execution": "Not requested; use --execute for this exact original course"}
        atomic_json(output / "input-review.json", result)
        return result

    operator = Operator(workspace, state_directory)
    cold_jobs = []
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        if ws.project["id"] != chosen["project_id"]:
            raise ValueError("The original operator selected another registered project")
        def complete(phase, action, payload):
            request = {"workspace": key, "action": action, "payload": payload}
            saved = journal["phases"].get(phase)
            if saved:
                if saved["request"] != request:
                    raise ValueError("This original receiving phase changed its accepted request: " + phase)
                task = operator.task(saved["task_id"])
            else:
                operation = "eco-climate-course-" + digest({
                    "identity": identity_value, "phase": phase, "request": request,
                    "predecessors": [row["task"]["task_id"] for row in journal["superseded"]
                                     if row["phase"] == phase]})[:40]
                task = operator.submit(key, action, payload, operation)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The original queue returned a different task")
                saved = {"request": request, "requested_operation_id": operation,
                         "accepted_operation_id": task["operation_id"], "task_id": task["id"]}
                journal["phases"][phase] = saved
                persist()
            if (any(task.get(name) != value for name, value in request.items())
                    or task["operation_id"] != saved["accepted_operation_id"]):
                raise ValueError("The accepted original task identity changed")
            if task["state"] in {"failed", "interrupted", "cancelled", "canceled"}:
                if not resume_failed:
                    raise ValueError("Use --resume-failed for the retained task " + task["id"])
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    saved["last_observed_state"] = task["state"]
                    persist()
                    raise TimeoutError("Original task remains active: " + task["id"]
                                       + ". Operator close waits for its accepted worker; no replacement was submitted.")
                time.sleep(.25)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                saved["last_observed_state"] = task["state"]
                saved["last_error"] = task.get("error")
                persist()
                raise RuntimeError("Original task " + task["id"] + ": " + json.dumps(task.get("error")))
            if "result" in saved and saved["result"] != task["result"]:
                raise ValueError("The original completed task changed its retained result")
            saved["result"] = task["result"]
            saved["last_observed_state"] = "complete"
            persist()
            return task

        def frozen_preview(phase, make):
            if phase in refresh_incomplete and phase in journal["phases"]:
                previous = journal["phases"][phase]
                task = operator.task(previous["task_id"])
                if task["state"] not in {"failed", "interrupted", "cancelled", "canceled"}:
                    raise ValueError("Only an incomplete failed original preview may be replaced")
                if phase == "management":
                    retained = ws.root / climate_management.ROOT / previous["request"]["payload"]["expected_id"] / "record.json"
                elif phase == "scientific":
                    retained = ws.root / scientific_report_editions.KIND / previous["request"]["payload"]["preview_id"] / "operation.json"
                else:
                    raise ValueError("Source/grid/native phases retain their original request")
                if retained.exists():
                    raise ValueError("Resume the original completed native effect instead of replacing its preview")
                if len(journal["source_revisions"]) < 2:
                    raise ValueError("An explicit reviewed implementation repair must precede a replacement preview")
                journal["superseded"].append({"phase": phase, "task": previous,
                    "preview": journal["previews"].get(phase), "at": now(),
                    "reason": "Explicit receiving continuation after reviewed implementation repair"})
                del journal["phases"][phase]
                journal["previews"].pop(phase, None)
                persist()
            if phase not in journal["previews"]:
                journal["previews"][phase] = make()
                persist()
            return journal["previews"][phase]

        # Each original entry has its own stable imported collection. Adding a
        # second period therefore cannot change an already completed annual case.
        # Original ZIP/XML/metadata companions travel through the same composer.
        collection_ids = {}
        journal.setdefault("source_imports", {})
        for source_key, source in sources.items():
            manifest = source_root / ("forcing-source-" + source["entry_identity"]["sha256"] + ".json")
            composed = compose(manifest, entries=[source["entry_path"]],
                               title=source["entry"]["title"])
            prior = journal["source_imports"].get(source_key)
            if prior:
                if prior["composition"] != composed:
                    raise ValueError("The original source composition changed")
                collection = ws._get("sources", prior["collection"]["id"])
                if collection != prior["collection"]:
                    raise ValueError("The retained imported source collection changed")
            else:
                collection = ws.import_sources(manifest)
                journal["source_imports"][source_key] = {"composition": composed, "collection": collection}
                persist()
            original_path, original_entry = ws.source_file(collection["id"], source["entry"]["id"])
            pinned(original_path, source["entry"])
            collection_ids[source_key] = collection["id"]
        cases = []
        for period in chosen["periods"]:
            overrides = {}
            for role, choice in period["overrides"].items():
                overrides[role] = {name: choice[name] for name in (
                    "period_label", "temporal_basis", "interpretation")}
                overrides[role].update(source_collection_id=collection_ids[choice["source_key"]],
                                       source_id=sources[choice["source_key"]]["entry"]["id"])
            cases.append({"id": period["id"], "label": period["label"], "overrides": overrides})
        study_ids, forcing_report_ids = {}, {}
        for role in ROLES:
            if role not in originals:
                continue
            selection = {"title": chosen["title"] + " — " + role,
                         "purpose": chosen["purpose"], "baseline_run_id": originals[role]["run_id"],
                         "cases": copy.deepcopy(cases),
                         "reporting_areas": chosen.get("reporting_areas", []),
                         "difference_maps": chosen.get("difference_maps", True)}
            phase = "prepare-" + role
            shown = frozen_preview(phase, lambda s=selection: climate_forcing.preview(ws, s))
            prepared = complete(phase, "climate-forcing.prepare",
                                {"selection": selection, "expected_id": shown["id"]})
            study_id = prepared["result"]["id"]
            study_ids[role] = study_id
            study = climate_forcing.get(ws, study_id)
            for case in study["cases"]:
                if case["baseline"]:
                    continue
                phase = "run-" + role + "-" + case["id"]
                request = climate_forcing.run_request(ws, study_id, case["id"])
                prior = journal["native_cases"].get(phase)
                run = ws.inspect_run(case["run_id"])
                if prior and prior["run_id"] != run["id"]:
                    raise ValueError("A prepared native case changed its original run ID")
                # A complete original edition is sufficient. It is never submitted
                # to the solver again merely to create a new receiving task.
                if run["state"] == "complete" and phase not in journal["phases"]:
                    record = {"run_id": run["id"], "request": request, "reused_completed_run": True,
                              "record": identity(ws.root / "runs" / run["id"] / "run.json")}
                    if prior and prior != record:
                        raise ValueError("An already completed native case changed")
                    journal["native_cases"][phase] = record
                    persist()
                else:
                    complete(phase, "run.start", request)
                    run = ws.inspect_run(case["run_id"])
                    if run["state"] != "complete":
                        raise ValueError("The original native task did not complete its selected run")
                    record = {"run_id": run["id"], "request": request, "reused_completed_run": False,
                              "record": identity(ws.root / "runs" / run["id"] / "run.json")}
                    if prior and prior != record:
                        raise ValueError("An original completed native result changed")
                    journal["native_cases"][phase] = record
                    persist()
            report_task = complete("forcing-report-" + role, "climate-forcing.report", {"study_id": study_id})
            forcing_report_ids[role] = report_task["result"]["id"]
        # One period is a useful native checkpoint while another original source
        # is still in custody. It does not claim a cross-period management result.
        if len(chosen["periods"]) < 2:
            result = {"schema": SCHEMA, "status": "single-period-native-complete",
                      "project_id": ws.project["id"], "studies": study_ids,
                      "forcing_reports": forcing_report_ids, "native_cases": journal["native_cases"],
                      "source_collection_ids": collection_ids, "phases": journal["phases"],
                      "management_result": None, "journal": str(journal_path),
                      "next": "Use a separate expanded two-period course; identical completed cases are reused."}
            atomic_json(output / "climate-management-receiving-result.json", result)
            return result
        management_selection = {
            "title": chosen["title"], "purpose": chosen["purpose"],
            "reference_period_id": chosen["reference_period_id"],
            "periods": [{"id": period["id"], "label": period["label"],
                         **{role: {"study_id": study_id, "case_id": period["id"]}
                            for role, study_id in study_ids.items()}}
                        for period in chosen["periods"]],
            "reporting_areas": chosen.get("reporting_areas", []),
            "difference_maps": chosen.get("difference_maps", True)}
        shown = frozen_preview("management", lambda: climate_management.preview(ws, management_selection))
        managed = complete("management", "climate-management.build",
                           {"selection": management_selection, "expected_id": shown["id"]})
        management = climate_management.get_report(ws, managed["result"]["id"], verify=True)
        scientific_payload = {"sources": [management["source"]],
                              "title": chosen["title"] + " — scientific interpretation"}
        report_preview = frozen_preview("scientific", lambda: scientific_report_editions.preview(ws, scientific_payload))
        scientific_payload["preview_id"] = report_preview["id"]
        rendered = complete("scientific", "source-reports.render", scientific_payload)
        scientific_id = rendered["result"]["scientific_report_edition_id"]
        exported_report = complete("scientific-export", "source-reports.export", {"id": scientific_id})
        expected = product_snapshot(ws, study_ids, forcing_report_ids, management["id"], scientific_id)
        if "products" in journal and journal["products"] != expected:
            raise ValueError("The receiving course changed its completed original products")
        journal["products"] = expected
        persist()

        products = {"management": (ws.root / management["directory"], management["files"])}
        for role, record in expected["forcing_reports"].items():
            products["forcing-" + role] = (ws.root / record["directory"], record["files"])
        edition, directory, unused = scientific_report_editions.inspect(ws, scientific_id)
        products["scientific"] = (directory, scientific_report_editions.files(edition, directory))
        downloads = {}
        for family, (directory, files) in products.items():
            downloads[family] = {}
            for name, item in files.items():
                ticket = operator._ticket(key, relative_file(directory, item["path"]), item, name)
                downloads[family][name] = copy_download(
                    operator, ticket, output / family / item["path"])
        # Re-register the original archive ticket in this Operator process. A
        # retained completed task may contain a ticket from its earlier process.
        archive_record = scientific_report_editions.export(ws, scientific_id)
        archive_item = archive_record["file"]
        if any(exported_report["result"]["download"][field] != archive_item[field]
               for field in ("bytes", "sha256")):
            raise ValueError("The retained scientific export changed its original ZIP")
        archive_ticket = operator._ticket(
            key, Path(archive_record["directory"]) / archive_item["path"], archive_item, "Complete scientific report")
        downloads["scientific_archive"] = copy_download(
            operator, archive_ticket, output / "scientific-report.zip")
        root_selection = {"title": chosen["title"] + " — editable scientific study",
                          "include_related_results": True,
                          "roots": [{"kind": "climate-management-reports", "id": management["id"]},
                                    {"kind": "scientific-report-editions", "id": scientific_id},
                                    *[{"kind": "climate-forcing-studies", "id": key}
                                      for key in study_ids.values()]]}
        study_preview = frozen_preview("selected-study", lambda: study_transfer.preview(ws, root_selection))
        study_task = complete("selected-study", "study.export",
                              {**root_selection, "preview_token": study_preview["preview_token"]})
        backup_task = complete("workspace-backup", "workspace.backup", {"include_intermediates": True})
        receiving = {}
        journal.setdefault("uploads", {})
        for name, task, selected in (("selected-study", study_task, True),
                                     ("complete-workspace", backup_task, False)):
            tickets = operator.task_view(task["id"]).get("_downloads", [])
            if len(tickets) != 1:
                raise ValueError("The original portable export has no unique actual download")
            ticket = tickets[0]
            archive = copy_download(operator, ticket, output / (name + ".zip"))
            retained_restore = journal["phases"].get("restore-" + name)
            if retained_restore:
                upload_id = retained_restore["request"]["payload"]["upload_id"]
                upload = operator.upload(upload_id)
            elif name in journal["uploads"]:
                upload = operator.upload(journal["uploads"][name]["id"])
            else:
                stream, unused = operator.open_download(ticket["id"])
                try:
                    upload = operator.receive_upload(stream, ticket["bytes"], ticket["filename"], "application/zip")
                finally:
                    stream.close()
            if any(upload[field] != archive[field] for field in ("bytes", "sha256")):
                raise ValueError("The native receiving upload changed the exact portable archive")
            saved_upload = {field: upload[field] for field in ("id", "bytes", "sha256", "filename", "mime_type")}
            if name in journal["uploads"] and journal["uploads"][name] != saved_upload:
                raise ValueError("The original accepted archive upload identity changed")
            journal["uploads"][name] = saved_upload
            persist()
            restored = complete("restore-" + name, "workspace.restore", {"upload_id": upload["id"]})["result"]
            verification = verify_products(operator, restored["workspace_key"], expected)
            if selected:
                study_transfer.verify_received_studies(operator.ws(restored["workspace_key"]))
            copied = Path(restored["application"]).resolve(strict=True)
            captured_source = application_sources(copied)
            receiving[name] = {"archive": archive, "restore": restored,
                               "verification": verification, "application_sources": captured_source}
            cold_jobs.append((name, copied, {
                "workspace": restored["workspace"], "state_directory": str(state_directory / ("cold-" + name)),
                "expected": expected, "selected_study": selected}))
        result = {
            "schema": SCHEMA, "status": "portable-products-verified",
            "project_id": ws.project["id"], "source_collection_ids": collection_ids,
            "studies": study_ids, "forcing_reports": forcing_report_ids,
            "management_report_id": management["id"], "scientific_report_edition_id": scientific_id,
            "native_cases": journal["native_cases"], "downloads": downloads, "receiving": receiving,
            "phases": journal["phases"], "source_revisions": journal["source_revisions"],
            "superseded": journal["superseded"], "journal": str(journal_path),
            "owner_direction": "CURRENT_OWNER_DIRECTION.md v2026-10-13.4",
            "visual_review": {"state": "required-not-performed-by-this-driver",
                "management_html": downloads["management"]["report.html"]["path"],
                "scientific_files": sorted(downloads["scientific"]),
                "all_attachments": "Open the actual HTML/PDF/SVG/CSV/ZIP and original app at desktop and narrow widths."},
        }
        atomic_json(output / "climate-management-receiving-result.json", result)
    finally:
        # This is the original Operator lifecycle. It drains/waits for its worker;
        # an interrupted shell never grants permission to submit a duplicate run.
        operator.close()
    for name, copied, request in cold_jobs:
        child = subprocess.run([sys.executable, "-c", COLD_REOPEN, str(copied)],
                               input=json.dumps(request), text=True, capture_output=True,
                               cwd=copied, check=False)
        if child.returncode:
            raise RuntimeError("Copied-application reopening failed for " + name + ":\n" + child.stderr)
        reopened = json.loads(child.stdout)
        if reopened["downloads"] != result["receiving"][name]["verification"]["downloads"]:
            raise ValueError("The copied application changed a selected original download")
        if reopened["application_sources"] != result["receiving"][name]["application_sources"]:
            raise ValueError("The copied original application source changed before cold reopening")
        result["receiving"][name]["cold_reopen"] = reopened
        atomic_json(output / "climate-management-receiving-result.json", result)
    result["status"] = "native-course-complete"
    result["native_course_complete"] = True
    atomic_json(output / "climate-management-receiving-result.json", result)
    return result



def receive(application, workspace, state_directory, output, config, **options):
    """Own this one receiving journal before its first read or write."""
    application = Path(application).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    state_directory = Path(state_directory).resolve()
    if state_directory.is_relative_to(workspace) or state_directory.is_relative_to(application):
        raise ValueError("Keep receiving state outside the original Workspace and application")
    sys.path[:0] = [str(application / "operator"), str(application)]
    from model.common import held
    state_directory.mkdir(parents=True, exist_ok=True)
    with held(state_directory / ".climate-receiving.lock", blocking=False):
        return _receive(application, workspace, state_directory, output, config, **options)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--execute", action="store_true",
                        help="Execute this exact source-pinned course using original queues and native engines")
    parser.add_argument("--resume-failed", action="store_true",
                        help="Resume saved original failed/interrupted tasks without new native identities")
    parser.add_argument("--refresh-incomplete-preview", action="append", default=[],
                        choices=("management", "scientific"),
                        help="After a reviewed implementation repair, retain an incomplete predecessor and review a successor")
    parser.add_argument("--timeout", type=float, default=14400)
    args = parser.parse_args(argv)
    result = receive(args.application, args.workspace, args.state_directory, args.output, args.config,
                     execute=args.execute, resume_failed=args.resume_failed,
                     refresh_incomplete=args.refresh_incomplete_preview, timeout=args.timeout)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
