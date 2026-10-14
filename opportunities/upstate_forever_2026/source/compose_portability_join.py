#!/usr/bin/env python3
"""Emit the exact Current195/R5 portability join as an ordinary full-source packet.

Read an already-received C47F/J76 packet or a complete current source directory.
Write JSON to stdout. This authoring operation does not install source, alter a
Workspace, fetch dependencies, or change the maintained installer's checks.
"""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import json
from pathlib import Path
import re
import sys

JOBS = "operator/native_jobs.py"
INSTALLER = "source/install_robust_workbench.py"
JOBS_BLOB = "fb2548b1f9b6b50b6e8566d2a762bd3e3bf41cd7"
C47F_INSTALLER = "d87812c83e3abd959e8ddd69114d9a5780c48b99"
PR5021_INSTALLER = "fee31b1fa3ee5a202efbb95b727fd35bc9cbd3cd"
PR5034_INSTALLER = "50ac07131c2ecb74e33c31b2e2ef09ed1a6dc209"
PR5040_INSTALLER = "404f167cb6fef47ae82638588fdd8f2bdc4efe52"
PR5042_INSTALLER = "6607d25f7a2bd5987bdbd8eb75fb7718a03b794f"
PR5044_INSTALLER = "d8208156ac3b5f6837819fbf7b05b530f91b5398"
C97_FIRST_INSTALLER = "891d74ea6b4fcd338fcd44d09fb6017a127ae0b4"
C97_COMPLETE_INSTALLER = "1b81abb843d61a06658fbc97bb19f8aff96ae39b"
PR5065_INSTALLER = "f245e47ee51d569f1429e5e365c9ffdcfdd01441"
JOINED_INSTALLER = "f87c5a975c5bf34f63da81cb37e160c772b498e0"
ORIGINALS = {
    JOBS: "357b637d098f808cb8fc821a74b7cccc3b5deab60e6cc0221fcd47c5ea92f981",
    INSTALLER: "192a48f1e693519d9ee917ffc4c58053d74ff9c5a172e74d8518f7514ba4311d",
}
ENTRYPOINT = '\n\nif __name__ == "__main__":\n    main()\n'
PAIRED_BLOCK = '''

# Complete published Investigations and paired-report portability cohorts.
# Optional source admission only; REQUIRED and predecessor checks stay unchanged.
ALLOWED = ALLOWED | frozenset({
    "eco_intelligence/install_upstate.py",
    "eco_intelligence/UPSTATE_BINDING.md",
    "operator/web/investigations.css",
    "model/paired_ensemble/__init__.py",
    "model/paired_ensemble/ensemble_cli.py",
    "model/paired_ensemble/ensemble_report.py",
    "model/paired_ensemble/ensemble_report_cli.py",
    "model/paired_ensemble/ensemble_report_source.py",
    "model/paired_ensemble/ensemble_rasters.py",
    "model/paired_ensemble/ensemble_source_receiving.py",
    "integration/component_fragments/paired-ensemble-report.json",
    "docs/PAIRED_ENSEMBLE_PORTABILITY.md",
})
'''
PAYLOAD_BLOCK = '''

# Complete native packing, original-output and root dependency cohorts.
# These remain optional source paths under the existing exact layer checks.
ALLOWED = ALLOWED | frozenset({
    "source_tools/native_runtime/windows_packing.py",
    "source_tools/WINDOWS_CLOUD_PACKING.md",
    "source_tools/native_runtime/conda_sources.py",
    "source_tools/CONDA_CACHE_PACKING.md",
    "source_tools/native_runtime/conda_cache.py",
    "source_tools/NATIVE_CONDA_ACQUISITION.md",
    "source_tools/collection_opening/compose_runtime_dependencies.py",
    "model/parameter_exports.py",
    "model/receiving_water_report_maps.py",
    "model/delivery_archive.py",
})
'''
OPENING_BLOCK = '''

# Complete root opening guidance and retained native source continuation.
ALLOWED = ALLOWED | frozenset({
    "START_HERE.md",
    "source_tools/collection_opening/build_guides.py",
    "source_tools/collection_opening/session_api.py",
    "source_tools/COLLECTION_GUIDANCE.md",
    "integration/component_fragments/collection-opening-guidance.json",
    "source_tools/native_resources.py",
    "source_tools/storage_resources.py",
    "source_tools/continue_original_capture.py",
    "source_tools/http_capture_resume.py",
    "docs/NATIVE_SOURCE_CONTINUATION.md",
    "integration/component_fragments/native-source-continuation.json",
    "model/gis_project_portable.py",
    "docs/GIS_OPENING_WINDOWS_MAC.md",
    "integration/component_fragments/gis-portable-receiving.json",
})
'''
LAB_BLOCK = '''

# Complete original Implementation lab and quality-control source cohort.
ALLOWED = ALLOWED | frozenset({
    "model/implementation_lab_dispatch.py",
    "model/implementation_qc.py",
    "model/implementation_qc_actions.py",
    "model/implementation_qc_comparison.py",
})
'''
GIS_AUTHORING_BLOCK = '''

# Retain the authoring source shipped in the complete native GIS packet.
ALLOWED = ALLOWED | frozenset({"source_tools/apply_gis_portability.py"})
'''
COHORT_BLOCK = '''

# Complete retained native-report, source-receiving and jobs-display cohorts.
# Optional admission preserves REQUIRED and all exact predecessor checks.
ALLOWED = ALLOWED | frozenset({
    "model/scientific_report_workbook.py",
    "source_tools/terrain_io.py",
    "source_tools/dem_transfer.py",
    "source_tools/usgs_archive.py",
    "operator/web/jobs.mjs",
})
'''
EMPTY_PREIMAGE_CHECK = '                    if not values:\n                        raise ValueError(name + " " + key + ": expected at least one preimage SHA-256")\n'
NATIVE_OPERATIONS_BLOCK = '''

# Complete original native export, receiving, review and Gura source cohorts.
# Each remains optional and subject to the exact original-source checks.
ALLOWED = ALLOWED | frozenset({
    "docs/GURA_NATIVE_RECEIVING.md",
    "integration/component_fragments/gura-native-receiving.json",
    "integration/component_fragments/project-transfer-portability.json",
    "model/PROJECT_TRANSFER.md",
    "model/chemistry.py",
    "model/chemistry_reports.py",
    "model/cohort_cli.py",
    "model/landcover_ledger.py",
    "model/project_transfer_cli.py",
    "model/project_transfer_desk.py",
    "model/receive_selected_model_source.py",
    "model/region_cli.py",
    "model/review_handback.py",
    "model/reviews.py",
    "operator/customer_reviews.py",
    "operator/project_transfer.py",
    "source_tools/application_assembly.py",
    "source_tools/archive_delta.py",
    "source_tools/gura_receiving.py",
    "source_tools/gura_workflow.py",
    "source_tools/receive_first_gura_case.py",
    "source_tools/receive_gura_operation.py",
    "source_tools/receive_gura_studies.py",
    "source_tools/receive_original_study.py",
    "source_tools/receive_scientific_fieldwork.py",
    "source_tools/receive_study_set.py",
    "source_tools/source_response_reuse.py",
})
'''
ARCHIVE_CONTINUATION_BLOCK = '''
# Full native continuation of the ORIGINAL archive, Study, source response and
# scientific fieldwork receivers. These remain optional source admissions; the
# existing REQUIRED set, source predecessor checks and scientific semantics stay
# exactly as published. Include complete original guides/component sources so
# the canonical application's recipient can reopen these existing workflows.
ALLOWED = ALLOWED | frozenset({
    "source_tools/archive_delta.py",
    "source_tools/archive_delta_view.py",
    "docs/INCREMENTAL_STUDY_DELIVERY.md",
    "integration/component_fragments/archive-delta.json",
    "source_tools/receive_study_set.py",
    "source_tools/RECEIVE_STUDY_SET.md",
    "source_tools/source_response_reuse.py",
    "source_tools/SOURCE_ACQUISITION_CONTINUATION.md",
    "source_tools/receive_original_study.py",
    "source_tools/receive_scientific_fieldwork.py",
    "docs/SCIENTIFIC_FIELDWORK_COURSE.md",
    "integration/component_fragments/scientific-fieldwork-course.json",
})

'''
STAGES = (PAIRED_BLOCK, PAYLOAD_BLOCK, OPENING_BLOCK, LAB_BLOCK, GIS_AUTHORING_BLOCK,
          COHORT_BLOCK, NATIVE_OPERATIONS_BLOCK, ARCHIVE_CONTINUATION_BLOCK)
STAGE_BY_BLOB = {C47F_INSTALLER: 0, PR5021_INSTALLER: 1,
                 PR5034_INSTALLER: 2, PR5040_INSTALLER: 3, PR5042_INSTALLER: 4,
                 PR5044_INSTALLER: 5, C97_FIRST_INSTALLER: 6,
                 C97_COMPLETE_INSTALLER: 7}


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def source_records(document: dict) -> dict[str, dict]:
    """Select the two full bodies from the existing packet record forms."""
    if not isinstance(document, dict):
        raise ValueError("Expected a full source packet object")
    files = document.get("files")
    if isinstance(files, dict):
        metadata = document.get("file_metadata", {})
        if not isinstance(metadata, dict):
            raise ValueError("Expected source file metadata keyed by original path")
        records = []
        for name in (JOBS, INSTALLER):
            value = files.get(name)
            if isinstance(value, str):
                details = metadata.get(name, {})
                if not isinstance(details, dict):
                    raise ValueError("Malformed source metadata: " + name)
                records.append(dict(details, path=name, content=value))
            elif isinstance(value, dict):
                if value.get("path", name) != name:
                    raise ValueError("Conflicting source name: " + name)
                records.append(dict(value, path=name))
    elif isinstance(files, list):
        records = files
    else:
        raise ValueError("The existing packet has no files collection")
    selected = {}
    for record in records:
        if not isinstance(record, dict) or record.get("path") not in ORIGINALS:
            continue
        name = record["path"]
        if name in selected:
            raise ValueError("Duplicate selected source: " + name)
        selected[name] = record
    if set(selected) != set(ORIGINALS):
        raise ValueError("Supply both complete C47F/J76 native_jobs and installer bodies")
    return selected


def decode(record: dict) -> bytes:
    if "content_base64" in record:
        if "content" in record:
            raise ValueError("Select one full source encoding")
        data = base64.b64decode(record["content_base64"], validate=True)
    else:
        value = record.get("content")
        if not isinstance(value, str):
            raise ValueError("Full UTF-8 source is required: " + record["path"])
        data = value.encode("utf-8")
    if "bytes" in record and (type(record["bytes"]) is not int or len(data) != record["bytes"]):
        raise ValueError("Source byte length differs: " + record["path"])
    if "sha256" in record and hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise ValueError("Source SHA-256 differs: " + record["path"])
    ast.parse(data.decode("utf-8"), filename=record["path"])
    return data


def joined_installer(data: bytes) -> bytes:
    identity = git_blob(data)
    if identity == JOINED_INSTALLER:
        return data
    if identity == PR5065_INSTALLER:
        # Retain the concurrently merged full admission group at the final stage.
        text = data.decode("utf-8")
        suffix = ARCHIVE_CONTINUATION_BLOCK + ENTRYPOINT
        if not text.endswith(suffix):
            raise ValueError("The concurrent original receiving cohort differs")
        data = (text[:-len(suffix)] + ENTRYPOINT).encode("utf-8")
        identity = git_blob(data)
        if identity != PR5044_INSTALLER:
            raise ValueError("The concurrent installer has additional source changes")
    stage = STAGE_BY_BLOB.get(identity)
    if stage is None:
        raise ValueError("Retain and compose the different installer edition: " + identity)
    text = data.decode("utf-8")
    if not text.endswith(ENTRYPOINT):
        raise ValueError("The complete original installer entrypoint differs")
    result_text = text[:-len(ENTRYPOINT)] + "".join(STAGES[stage:]) + ENTRYPOINT
    if stage < 6:
        if result_text.count(EMPTY_PREIMAGE_CHECK) != 1:
            raise ValueError("The retained predecessor-list reader differs")
        result_text = result_text.replace(
            EMPTY_PREIMAGE_CHECK, "                    # An empty list declares no additional predecessor.\n")
    elif EMPTY_PREIMAGE_CHECK in result_text:
        raise ValueError("The cumulative predecessor-list reader differs")
    result = result_text.encode("utf-8")
    if git_blob(result) != JOINED_INSTALLER:
        raise ValueError("Composed installer differs from the complete published source")
    return result


def compose(document: dict) -> dict:
    records = source_records(document)
    sources = {name: decode(record) for name, record in records.items()}
    if git_blob(sources[JOBS]) != JOBS_BLOB:
        raise ValueError("Retain and compose the different native supervisor edition")
    outputs = {JOBS: sources[JOBS], INSTALLER: joined_installer(sources[INSTALLER])}
    files = []
    for name in (JOBS, INSTALLER):
        previous = {ORIGINALS[name], hashlib.sha256(sources[name]).hexdigest()}
        for key in ("before_sha256", "base_sha256", "replaces_sha256"):
            values = records[name].get(key, [])
            if isinstance(values, str):
                values = [values]
            if not isinstance(values, list) or any(
                    not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None
                    for value in values):
                raise ValueError("Malformed retained preimages: " + name)
            previous.update(values)
        data = outputs[name]
        ast.parse(data.decode("utf-8"), filename=name)
        files.append({"path": name, "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest(),
                      "git_blob": git_blob(data), "before_sha256": sorted(previous),
                      "content": data.decode("utf-8")})
    return {"schema": "commons.source-map/1",
            "source_reference": "ECO-CURRENT195-PORTABILITY-J76/8",
            "description": "Final explicit source layer after the original full portability cohorts.",
            "files": files}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--packet", type=Path, help="Already-received C47F or J76 full-content JSON")
    source.add_argument("--source-root", type=Path, help="Complete current application source directory")
    args = parser.parse_args(argv)
    try:
        if args.packet:
            document = json.loads(args.packet.read_text(encoding="utf-8-sig"))
        else:
            document = {"files": [{"path": name, "content":
                         (args.source_root / name).read_bytes().decode("utf-8")}
                         for name in (JOBS, INSTALLER)]}
        result = (json.dumps(compose(document), ensure_ascii=True, indent=2) + "\n").encode("utf-8")
    except (OSError, UnicodeError, ValueError, SyntaxError) as error:
        print("Portability source join: " + str(error), file=sys.stderr)
        return 2
    sys.stdout.buffer.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
