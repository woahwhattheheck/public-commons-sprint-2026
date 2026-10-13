#!/usr/bin/env python3
"""Receive selected original coefficient sources into a saved scientific Study.

This operation uses the existing population, native-source, scientific-edition,
Study-transfer and portable-receiving APIs. It never prepares or executes a model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def _arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--ensemble", required=True)
    parser.add_argument("--output", required=True,
                        help="New sibling output directory, outside application and Workspace")
    parser.add_argument("--evidence-id",
                        help="Explicit existing evidence record; omit to populate the actual supplied table")
    parser.add_argument("--range-id", action="append", default=[],
                        help="Explicit saved range ID; repeat to select more than one")
    parser.add_argument("--base-report-edition",
                        help="Preserve this report's ordered sources, replacing only the selected ensemble source")
    parser.add_argument("--title", default=None)
    parser.add_argument("--resume", action="store_true",
                        help="Resume the exact retained selection in the same output")
    return parser.parse_args(argv)


# The child imports exclusively from the application carried in the actual
# received Study. It performs no native solve and emits one machine-readable
# result after checking the ordinary saved records.
_COLD_REOPEN = r"""
import hashlib, json, sys
from pathlib import Path
application, workspace_path, expected_path = map(Path, sys.argv[1:])
sys.path.insert(0, str(application.resolve(strict=True)))
from model.workspace import Workspace
from model import biophysical_evidence, scientific_report_editions, study_transfer
from model.common import digest, file_digest, read_json
expected = read_json(expected_path)
workspace = Workspace(workspace_path)
if workspace.project['id'] != expected['workspace_id']:
    raise ValueError('Cold receiving changed the original project')
profile = workspace._get('profiles', expected['profile_id'])
if digest(profile) != expected['profile_record_sha256']:
    raise ValueError('Cold receiving changed the selected profile')
table, entry = workspace.source_file(profile['source_collection_id'], profile['biophysical_source_id'])
if file_digest(table) != expected['table_sha256'] or table.stat().st_size != expected['table_bytes']:
    raise ValueError('Cold receiving changed the original coefficient table')
evidence = biophysical_evidence.inspect_evidence(workspace, expected['evidence_id'])
if evidence['profile_id'] != profile['id'] or digest(evidence) != expected['evidence_record_sha256']:
    raise ValueError('Cold receiving changed the selected evidence record')
for key, sha in expected['range_record_sha256'].items():
    if digest(biophysical_evidence.inspect_ranges(workspace, key)) != sha:
        raise ValueError('Cold receiving changed a selected range')
for key, sha in expected['run_record_sha256'].items():
    if digest(workspace.inspect_run(key)) != sha:
        raise ValueError('Cold receiving changed an original completed run: ' + key)
record, directory, operation = scientific_report_editions.inspect(workspace, expected['report_edition_id'])
if digest(record) != expected['report_record_sha256']:
    raise ValueError('Cold receiving changed the registered scientific report')
receipts = study_transfer.verify_received_studies(workspace)
if not any(item['id'] == expected['study_id'] and item['identity'] == 'MATCH' for item in receipts):
    raise ValueError('Cold receiving lost the selected editable Study')
print(json.dumps({
    'schema': 'upstate.ensemble-coefficient-cold-reopen/v1', 'state': 'complete',
    'workspace_id': workspace.project['id'], 'workspace': str(workspace.root),
    'application': str(application.resolve()), 'evidence_id': evidence['id'],
    'range_ids': expected['range_ids'], 'report_edition_id': record['id'],
    'report_directory': str(directory), 'report_files': record['files'],
    'study_id': expected['study_id'], 'original_runs': len(expected['run_record_sha256']),
    'table_sha256': expected['table_sha256'], 'coverage': evidence['coverage'],
    'scientific_sources': operation['sources']
}, sort_keys=True))
"""


def main(argv=None):
    # Keep the standard command parser so this file is directly runnable from
    # the maintained source-tools family.
    args = _arguments(argv)
    application = Path(args.application).resolve(strict=True)
    workspace_path = Path(args.workspace).resolve(strict=True)
    output = Path(args.output).resolve()
    if any(output == root or output.is_relative_to(root)
           for root in (application, workspace_path)):
        raise ValueError("Keep the receiving output outside the original application and Workspace")
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model import (biophysical_evidence, ensemble_coefficient_evidence,
                       ensemble_study_source, scientific_report_editions,
                       study_transfer, portable, observed_context)
    from model.common import atomic_json, digest, file_digest, held, read_json
    from source_tools.receive_biophysical_evidence import populate

    workspace = Workspace(workspace_path)
    profile = workspace._get("profiles", args.profile)
    table, table_entry = workspace.source_file(
        profile["source_collection_id"], profile["biophysical_source_id"])
    context = ensemble_coefficient_evidence.context(workspace, args.ensemble)
    if profile["id"] not in context["reference_profile_ids"]:
        raise ValueError("Select an actual member or retained ancestor profile from this ensemble")
    runs = {key: workspace.inspect_run(key) for key in context["selected_run_ids"]}
    if any(row.get("state") != "complete" for row in runs.values()):
        raise ValueError("Finish the original selected native runs before receiving their completed report")
    range_ids = sorted(set(args.range_id))
    title = args.title.strip() if args.title is not None else (
        "Original native study with coefficient provenance")
    if not title:
        raise ValueError("Enter a nonempty scientific report title")
    source_choices, contact = [], None
    if args.base_report_edition:
        base, _, _ = scientific_report_editions.inspect(workspace, args.base_report_edition)
        source_choices = observed_context.source_choices(base["render_identity"]["selection"])
        contact = base["render_identity"].get("contact")
        if args.title is None:
            title = base["title"]

    selection = {
        "schema": "upstate.ensemble-coefficient-receiving-selection/v1",
        "workspace_id": workspace.project["id"], "ensemble_id": args.ensemble,
        "profile_id": profile["id"], "profile_record_sha256": digest(profile),
        "table_sha256": file_digest(table), "table_bytes": table.stat().st_size,
        "run_record_sha256": {key: digest(value) for key, value in sorted(runs.items())},
        "requested_evidence_id": args.evidence_id, "range_ids": range_ids,
        "base_report_edition_id": args.base_report_edition,
        "base_report_sources": source_choices, "title": title, "contact": contact,
    }
    if (selection["table_sha256"] != table_entry["body"]["sha256"]
            or selection["table_bytes"] != table_entry["body"]["bytes"]):
        raise ValueError("The original profile table differs from its retained source descriptor")
    existed = output.exists()
    if existed and not args.resume:
        raise ValueError("Use --resume for the exact existing receiving output")
    if args.resume and not existed:
        raise ValueError("Resume an existing receiving output")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        selection_path = output / "selection.json"
        if selection_path.exists():
            if read_json(selection_path) != selection:
                raise ValueError("Resume the original project, runs, profile, sources and report selection")
        elif existed and any(path.name != ".receiving.lock" for path in output.iterdir()):
            raise ValueError("The output contains files without this original receiving selection")
        atomic_json(selection_path, selection, immutable=True)

        def retain(name, value):
            atomic_json(output / name, value, immutable=True)
            return value

        def announce(phase, **values):
            print(json.dumps({"phase": phase, **values}, sort_keys=True), flush=True)

        announce("coefficient-evidence")
        if args.evidence_id:
            evidence = biophysical_evidence.inspect_evidence(workspace, args.evidence_id)
            if evidence["profile_id"] != profile["id"]:
                raise ValueError("The selected evidence belongs to a different original profile")
        else:
            population = output / "population"
            populated = populate(workspace, profile["id"], population, resume=population.exists())
            evidence = biophysical_evidence.inspect_evidence(workspace, populated["evidence_id"])
        evidence_choice = {"evidence_ids": [evidence["id"]], "range_ids": range_ids}
        retain("coefficient-evidence-selection.json", evidence_choice)
        range_records = {key: biophysical_evidence.inspect_ranges(workspace, key) for key in range_ids}

        announce("native-scientific-source", evidence_id=evidence["id"])
        source_path = output / "source-operation.json"
        if source_path.exists():
            saved = read_json(source_path)
            # The original family supports deterministic prepare on resume;
            # newer latest(...source_operation_id=...) is not required.
            source = ensemble_study_source.prepare(
                workspace, args.ensemble, render=False, coefficient_evidence=evidence_choice)
            if (source["id"] != saved["id"] or source["selection"] != saved["selection"]
                    or source.get("source") != saved.get("source")):
                raise ValueError("The retained scientific source changed its original selection")
        else:
            # The edition renderer below produces the one customer PDF/HTML.
            # The original source producer only retains its recipe and figures.
            source = ensemble_study_source.prepare(
                workspace, args.ensemble, render=False, coefficient_evidence=evidence_choice)
            retain("source-operation.json", source)
        binding = source["selection"].get("coefficient_evidence")
        if binding is None or binding["reference_binding"]["workspace_id"] != workspace.project["id"]:
            raise ValueError("The prepared source lacks its selected original coefficient evidence")
        selected_evidence = sorted(row["id"] for row in binding["reference_binding"]["evidence"])
        selected_ranges = sorted(row["id"] for row in binding["reference_binding"]["ranges"])
        if selected_evidence != evidence_choice["evidence_ids"] or selected_ranges != range_ids:
            raise ValueError("The prepared source changed the explicit evidence or range selection")

        # Preserve the selected existing report's source order. Replace only a
        # source that identifies this exact saved ensemble in this same project.
        ordered, inserted = [], False
        for choice in source_choices:
            original_recipe, entry = workspace.source_file(
                choice["source_collection_id"], choice["source_id"])
            metadata = entry.get("metadata") or {}
            same = (metadata.get("source_basis") == "saved_native_ensemble"
                    and metadata.get("ensemble_id") == args.ensemble
                    and metadata.get("workspace_id") == workspace.project["id"])
            if same:
                # Current sources also include separately selected scenario
                # contrasts under the same ensemble metadata. Keep those and
                # older physical report editions in their original positions.
                basis = read_json(original_recipe).get("basis") or {}
                same = (not basis.get("scenario_reference")
                        and basis.get("report_id") == source["selection"]["report_id"])
            if same:
                if not inserted:
                    ordered.append(source["source"])
                    inserted = True
            else:
                ordered.append(choice)
        if not inserted:
            ordered.append(source["source"])
        payload = {"sources": ordered, "title": title, "contact": contact}
        request_path = output / "report-request.json"
        if request_path.exists():
            request = read_json(request_path)
            if any(request.get(key) != value for key, value in payload.items()):
                raise ValueError("The retained report preview changed its selected sources or presentation")
        else:
            reviewed = scientific_report_editions.preview(workspace, payload)
            request = retain("report-request.json", {**payload, "preview_id": reviewed["id"]})
        announce("registered-scientific-report", preview_id=request["preview_id"])
        rendered = scientific_report_editions.render(workspace, request)
        retain("report-result.json", rendered)
        report_id = rendered["scientific_report_edition_id"]
        report, report_directory, _ = scientific_report_editions.inspect(workspace, report_id)
        report_export = scientific_report_editions.export(workspace, report_id)
        retain("report-export.json", report_export)

        study_selection = retain("study-selection.json", {
            "schema": "upstate.study-selection/v1", "title": title,
            "roots": [{"kind": "scientific-report-editions", "id": report_id}],
            "include_related_results": True,
        })
        announce("editable-study-export", report_edition_id=report_id)
        study = study_transfer.export_study(workspace, output / "scientific-study.zip", study_selection)
        # Reuse flags are observations, not part of the retained archive identity.
        study_record = {key: study[key] for key in ("id", "path", "bytes", "sha256", "study")}
        retain("study-export.json", study_record)
        expected = retain("cold-reopen-selection.json", {
            **selection, "evidence_id": evidence["id"],
            "evidence_record_sha256": digest(evidence),
            "range_record_sha256": {key: digest(value) for key, value in range_records.items()},
            "report_edition_id": report_id, "report_record_sha256": digest(report),
            "study_id": study["id"],
        })
        destination = output / "received-study"
        announce("original-portable-receiving", study_id=study["id"])
        received = (portable.resume_restore(study["path"], destination,
                                            expected_archive_sha256=study["sha256"])
                    if destination.exists() else portable.restore(study["path"], destination))
        retained_receive = {key: value for key, value in received.items()
                            if key != "reused_completed_output"}
        retain("receiving-result.json", retained_receive)
        announce("cold-reopen")
        cold = subprocess.run(
            [sys.executable, "-c", _COLD_REOPEN, received["application"],
             received["workspace"], str(output / "cold-reopen-selection.json")],
            check=True, text=True, capture_output=True)
        # Native import warnings belong on stderr; do not silently discard a
        # failed child's original exception or replace it with a generic status.
        if cold.stderr:
            print(cold.stderr, file=sys.stderr, end="")
        reopened = json.loads(cold.stdout)
        retain("cold-reopen.json", reopened)

        if (digest(workspace._get("profiles", profile["id"])) != selection["profile_record_sha256"]
                or file_digest(table) != selection["table_sha256"]):
            raise ValueError("The original selected profile or table changed during receiving")
        for key, sha in selection["run_record_sha256"].items():
            if digest(workspace.inspect_run(key)) != sha:
                raise ValueError("An original completed native run changed during receiving: " + key)
        result = {
            "schema": "upstate.ensemble-coefficient-receiving/v1", "state": "complete",
            "workspace_id": workspace.project["id"], "ensemble_id": args.ensemble,
            "profile_id": profile["id"], "evidence_id": evidence["id"],
            "range_ids": range_ids, "coverage": evidence["coverage"],
            "applicability": binding["applicability"], "source_operation_id": source["id"],
            "report_edition_id": report_id, "report_directory": str(report_directory),
            "report_files": report["files"], "report_export": report_export,
            "study": study_record, "received": retained_receive, "cold_reopen": reopened,
            "original_runs_preserved": len(selection["run_record_sha256"]),
            "table_sha256": selection["table_sha256"],
            "operator_review": "Open and inspect the populated original and received reports, "
                               "all outgoing attachments and the saved evidence/profile controls; "
                               "look at desktop and narrow rendered views before delivery.",
        }
        retain("operation-result.json", result)
        print(json.dumps(result, indent=2, sort_keys=True))
        return result


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        if error.stdout:
            print(error.stdout, file=sys.stderr, end="")
        if error.stderr:
            print(error.stderr, file=sys.stderr, end="")
        raise
