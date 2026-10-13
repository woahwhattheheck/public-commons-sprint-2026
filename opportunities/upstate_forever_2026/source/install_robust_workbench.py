#!/usr/bin/env python3
"""Install exact Decision studies source packets into a complete native application.

Packets are explicit layers in command-line order. An existing identical file is
reused. Any other existing file must match a declared original preimage or a
verified earlier layer for that same path. All conflicts are reported before
replacement, preserving newer work for composition.
"""
from __future__ import annotations

import argparse
import ast
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile

ALLOWED = frozenset({
    "model/economic_comparison.py",
    "model/economic_comparison_render.py",
    "model/economic_comparison_source.py",
    "model/economic_comparison_study_transfer.py",
    "model/decision_analysis.py",
    "model/decision_cli.py",
    "model/decision_desk.html",
    "model/model_selection.py",
    "model/decision_receive.py",
    "operator/economic_workbench.py",
    "operator/economic_comparison.py",
    "operator/economic_comparison_source.py",
    "operator/economic_receive.py",
    "operator/extensions/economic-desk.json",
    "operator/extensions/economic-comparison.json",
    "operator/extensions/economic-comparison-source.json",
    "operator/web/economic_desk.mjs",
    "operator/web/economic_desk.css",
    "operator/web/economic_request_store.mjs",
    "operator/web/economic_cost_worksheet.mjs",
    "operator/web/economic_implementation.mjs",
    "operator/web/economic_comparison.mjs",
    "operator/web/economic_comparison_source.mjs",
    "operator/web/economic_received_comparisons.mjs",
    "operator/ECONOMIC_DESK.md",
    "operator/ECONOMIC_COMPARISON.md",
    "operator/ECONOMIC_COMPARISON_REPORT.md",
    "operator/COST_WORKSHEETS.md",
    "operator/ECONOMIC_IMPLEMENTATION.md",
    "docs/ECONOMIC_COMPARISON_STUDY_TRANSFER.md",
    "docs/ECONOMIC_COMPARISON_STUDY_INTEGRATION.md",
    "install_economic_desk.py",
    "install_implementation.py",
    "integration/component_fragments/economic-comparison.json",
    "integration/component_fragments/economic-comparison-source.json",
    "model/report_changes_review.py",
    "model/report_review_study_receiving.py",
    "model/study_receiving.py",
    "operator/study_receiving.py",
    "model/gauge_study_receiving.py",
    "model/ensemble_study_receiving.py",
    "model/observed_landcover_receiving.py",
    "operator/gauge_receiving.py",
    "operator/ensemble_receiving.py",
    "operator/observed_landcover_receiving.py",
    "operator/study_transfer.py",
    "operator/extensions/study-transfer.json",
    "operator/web/extensions/study_transfer.css",
    "operator/web/study_report_navigation.mjs",
    "operator/web/received_studies.mjs",
    "operator/web/gauge_received_studies.mjs",
    "operator/web/ensemble_received_studies.mjs",
    "operator/web/observed_landcover_received.mjs",
    "operator/web/observed_landcover_received.css",
    "model/observed_landcover.py",
    "model/landcover_report_source.py",
    "model/observation_comparability_study_transfer.py",
    "model/observation_comparability_store.py",
    "measurement_workspace/__init__.py",
    "measurement_workspace/observation_comparability.py",
    "measurement_workspace/observation_comparability_delivery.py",
    "measurement_workspace/OBSERVATION_COMPARABILITY.md",
    "measurement_workspace/observation_comparability.html",
    "operator/observation_comparability_operator.py",
    "operator/extensions/observation-comparability.json",
    "operator/web/observation_comparability.mjs",
    "operator/web/observation_comparability.css",
    "operator/web/comparability_received_studies.mjs",
    "integration/component_fragments/observation-comparability.json",
    "operator/REPORT_REVIEW_STUDY_RECEIVING.md",
    "integration/component_fragments/report-review-study-receiving.json",
    "integration/scientific_report_capture_patch.json",
    "model/scientific_report_capture.py",
    "model/scientific_report_editions.py",
    "operator/extensions/source-reports.json",
    "operator/web/source_reports.mjs",
    "operator/SCIENTIFIC_REPORT_CAPTURE.md",
    "integration/component_fragments/scientific-report-capture.json",
    "model/report_changes_study_transfer.py",
    "model/REPORT_CHANGES_STUDY_TRANSFER.md",
    "integration/component_fragments/report-changes-study-transfer.json",
    "operator/web/report_changes.mjs",
    "operator/extensions/report-changes.json",
    "model/report_changes.py",
    "operator/report_changes.py",
    "operator/web/report_changes.css",
    "docs/SCIENTIFIC_REPORT_CHANGES.md",
    "install_report_changes.py",
    "integration/component_fragments/scientific-report-changes.json",
    "source_tools/receive_scientific_report_review.py",
    "source_tools/RECEIVE_SCIENTIFIC_REPORT_REVIEW.md",
    "integration/component_fragments/customer-review-receiving.json",
    "integration/component_fragments/conservation-design-study-transfer.json",
    "integration/conservation_design_study_transfer_composition.json",
    "model/CONSERVATION_DESIGN_STUDY_TRANSFER.md",
    "operator/CONSERVATION_DESIGN_BROWSER.md",
    "operator/CONSERVATION_DESIGN_RECEIVING.md",
    "operator/conservation_design_browser_receiving.py",
    "operator/install_conservation_design.py",
    "operator/conservation_browser_receiving.py",
    "model/paired_ensemble_study_transfer.py",
    "model/paired_ensemble_study_cli.py",
    "model/PAIRED_ENSEMBLE_STUDY_TRANSFER.md",
    "integration/component_fragments/paired-ensemble-study-transfer.json",
    "operator/web/paired_ensemble_desk.mjs",
    "operator/extensions/paired-ensemble.json",
    "integration/component_fragments/study-transfer-native-lineage.json",
    "model/customer_review_study_transfer.py",
    "model/SCIENTIFIC_REPORT_REVIEW.md",
    "operator/web/reviews.mjs",
    "integration/customer-review-study-transfer.patch.json",
    "integration/component_fragments/customer-review-study-transfer.json",
    "model/conservation_design_study_transfer.py",
    "model/chemistry_study_transfer.py",
    "model/CHEMISTRY_STUDY_TRANSFER.md",
    "source_tools/chemistry_study_composition.py",
    "integration/component_fragments/chemistry_study_transfer.json",
    "model/ensemble_study_transfer.py",
    "model/ENSEMBLE_STUDY_TRANSFER.md",
    "integration/component_fragments/ensemble-scientific-study-transfer.json",
    "model/gauge_study_transfer.py",
    "model/GAUGE_STUDY_TRANSFER.md",
    "integration/component_fragments/gauge-study-transfer.json",
    "model/landcover_study_transfer.py",
    "integration/component_fragments/landcover-scientific-report.json",
    "model/published_review_study_transfer.py",
    "model/published_review_report_source.py",
    "model/PUBLISHED_REVIEW_REPORT_SOURCE.md",
    "integration/component_fragments/published-review-report-source.json",
    "model/implementation_report_transfer.py",
    "model/receptor_report_maps.py",
    "model/scientific_figures.py",
    "model/scientific_map_figures.py",
    "model/spatial_esri.py",
    "source/capture_upstream_network.py",
    "model/receptor_study_transfer.py",
    "model/RECEPTOR_STUDY_TRANSFER.md",
    "operator/web/receptors.mjs",
    "integration/receptor_study_transfer.json",
    "integration/component_fragments/receptor-study-transfer.json",
    "model/monitoring_frontier_comparison.py",
    "model/monitoring_comparison_report.py",
    "model/community_study_transfer.py",
    "model/COMMUNITY_STUDY_TRANSFER.md",
    "operator/web/community.mjs",
    "operator/web/community_revisions.mjs",
    "integration/community_study_transfer_ui.patch.json",
    "integration/component_fragments/community-study-transfer.json",
    "model/conservation_study_transfer.py",
    "operator/CONSERVATION_STUDY_TRANSFER.md",
    "operator/web/conservation.mjs",
    "operator/source_report_editions.py",
    "integration/component_fragments/conservation-study-transfer.json",
    "model/native_process_study_transfer.py",
    "model/NATIVE_PROCESS_STUDY_TRANSFER.md",
    "integration/component_fragments/native-process-study-transfer.json",
    "model/receiving_water_report_transfer.py",
    "model/RECEIVING_WATER_REPORT_TRANSFER.md",
    "integration/component_fragments/receiving-water-report-transfer.json",
    "model/scientific_report_study_transfer.py",
    "model/calibration_study_transfer.py",
    "model/study_report_transfer.py",
    "model/monitoring_study_transfer.py",
    "operator/web/extensions/study_transfer.mjs",
    "operator/web/source_report_editions.mjs",
    "operator/web/app.mjs",
    "operator/SCIENTIFIC_REPORT_EDITIONS.md",
    "model/SCIENTIFIC_REPORT_STUDY_TRANSFER.md",
    "operator/CALIBRATION_REPORT_TRANSFER.md",
    "integration/component_fragments/scientific-report-study-transfer.json",
    "model/native_versions.py",
    "model/robust_decisions/eco_robust/decision_delivery.py",
    "model/delivery.py",
    "model/client_report.py",
    "operator/web/map_atlas.mjs",
    "operator/MAP_ATLAS.md",
    "model/decision_study_transfer.py",
    "model/study_transfer.py",
    "model/study_delivery_transfer.py",
    "operator/STUDY_TRANSFER.md",
    "model/robust_decisions/eco_robust/store.py",
    "model/robust_decisions/eco_robust/diagnostics.py",
    "model/robust_decisions/eco_robust/cli.py",
    "model/robust_decisions/eco_robust/operations.py",
    "model/robust_decisions/eco_robust/integration.py",
    "model/robust_decisions/SOURCE_MANIFEST.json",
    "operator/robust_workbench.py",
    "operator/extensions/robust-workbench.json",
    "operator/web/robust_workbench.mjs",
    "operator/web/robust_workbench.css",
    "operator/web/retained_desks.mjs",
    "operator/web/experiment_diagnostics.mjs",
    "operator/ROBUST_WORKBENCH.md",
    "operator/ROBUST_WORKBENCH_UI.md",
    "source/run_robust_workspace_transfer.py",
    "source/run_robust_workbench_browser.mjs",
    "source/install_robust_workbench.py",
    "source/ROBUST_RECEIVING.md",
})
REQUIRED = ALLOWED - {
    "model/economic_comparison.py",
    "model/economic_comparison_render.py",
    "model/economic_comparison_source.py",
    "model/economic_comparison_study_transfer.py",
    "model/decision_analysis.py",
    "model/decision_cli.py",
    "model/decision_desk.html",
    "model/model_selection.py",
    "model/decision_receive.py",
    "operator/economic_workbench.py",
    "operator/economic_comparison.py",
    "operator/economic_comparison_source.py",
    "operator/economic_receive.py",
    "operator/extensions/economic-desk.json",
    "operator/extensions/economic-comparison.json",
    "operator/extensions/economic-comparison-source.json",
    "operator/web/economic_desk.mjs",
    "operator/web/economic_desk.css",
    "operator/web/economic_request_store.mjs",
    "operator/web/economic_cost_worksheet.mjs",
    "operator/web/economic_implementation.mjs",
    "operator/web/economic_comparison.mjs",
    "operator/web/economic_comparison_source.mjs",
    "operator/web/economic_received_comparisons.mjs",
    "operator/ECONOMIC_DESK.md",
    "operator/ECONOMIC_COMPARISON.md",
    "operator/ECONOMIC_COMPARISON_REPORT.md",
    "operator/COST_WORKSHEETS.md",
    "operator/ECONOMIC_IMPLEMENTATION.md",
    "docs/ECONOMIC_COMPARISON_STUDY_TRANSFER.md",
    "docs/ECONOMIC_COMPARISON_STUDY_INTEGRATION.md",
    "install_economic_desk.py",
    "install_implementation.py",
    "integration/component_fragments/economic-comparison.json",
    "integration/component_fragments/economic-comparison-source.json",
    "model/report_changes_review.py",
    "model/report_review_study_receiving.py",
    "model/study_receiving.py",
    "operator/study_receiving.py",
    "model/gauge_study_receiving.py",
    "model/ensemble_study_receiving.py",
    "model/observed_landcover_receiving.py",
    "operator/gauge_receiving.py",
    "operator/ensemble_receiving.py",
    "operator/observed_landcover_receiving.py",
    "operator/study_transfer.py",
    "operator/extensions/study-transfer.json",
    "operator/web/extensions/study_transfer.css",
    "operator/web/study_report_navigation.mjs",
    "operator/web/received_studies.mjs",
    "operator/web/gauge_received_studies.mjs",
    "operator/web/ensemble_received_studies.mjs",
    "operator/web/observed_landcover_received.mjs",
    "operator/web/observed_landcover_received.css",
    "model/observed_landcover.py",
    "model/landcover_report_source.py",
    "model/observation_comparability_study_transfer.py",
    "model/observation_comparability_store.py",
    "measurement_workspace/__init__.py",
    "measurement_workspace/observation_comparability.py",
    "measurement_workspace/observation_comparability_delivery.py",
    "measurement_workspace/OBSERVATION_COMPARABILITY.md",
    "measurement_workspace/observation_comparability.html",
    "operator/observation_comparability_operator.py",
    "operator/extensions/observation-comparability.json",
    "operator/web/observation_comparability.mjs",
    "operator/web/observation_comparability.css",
    "operator/web/comparability_received_studies.mjs",
    "integration/component_fragments/observation-comparability.json",
    "operator/REPORT_REVIEW_STUDY_RECEIVING.md",
    "integration/component_fragments/report-review-study-receiving.json",
    "integration/scientific_report_capture_patch.json",
    "model/scientific_report_capture.py",
    "model/scientific_report_editions.py",
    "operator/extensions/source-reports.json",
    "operator/web/source_reports.mjs",
    "operator/SCIENTIFIC_REPORT_CAPTURE.md",
    "integration/component_fragments/scientific-report-capture.json",
    "model/report_changes_study_transfer.py",
    "model/REPORT_CHANGES_STUDY_TRANSFER.md",
    "integration/component_fragments/report-changes-study-transfer.json",
    "operator/web/report_changes.mjs",
    "operator/extensions/report-changes.json",
    "model/report_changes.py",
    "operator/report_changes.py",
    "operator/web/report_changes.css",
    "docs/SCIENTIFIC_REPORT_CHANGES.md",
    "install_report_changes.py",
    "integration/component_fragments/scientific-report-changes.json",
    "source_tools/receive_scientific_report_review.py",
    "source_tools/RECEIVE_SCIENTIFIC_REPORT_REVIEW.md",
    "integration/component_fragments/customer-review-receiving.json",
    "integration/component_fragments/conservation-design-study-transfer.json",
    "integration/conservation_design_study_transfer_composition.json",
    "model/CONSERVATION_DESIGN_STUDY_TRANSFER.md",
    "operator/CONSERVATION_DESIGN_BROWSER.md",
    "operator/CONSERVATION_DESIGN_RECEIVING.md",
    "operator/conservation_design_browser_receiving.py",
    "operator/install_conservation_design.py",
    "operator/conservation_browser_receiving.py",
    "model/paired_ensemble_study_transfer.py",
    "model/paired_ensemble_study_cli.py",
    "model/PAIRED_ENSEMBLE_STUDY_TRANSFER.md",
    "integration/component_fragments/paired-ensemble-study-transfer.json",
    "operator/web/paired_ensemble_desk.mjs",
    "operator/extensions/paired-ensemble.json",
    "integration/component_fragments/study-transfer-native-lineage.json",
    "model/customer_review_study_transfer.py",
    "model/SCIENTIFIC_REPORT_REVIEW.md",
    "operator/web/reviews.mjs",
    "integration/customer-review-study-transfer.patch.json",
    "integration/component_fragments/customer-review-study-transfer.json",
    "model/conservation_design_study_transfer.py",
    "model/chemistry_study_transfer.py",
    "model/CHEMISTRY_STUDY_TRANSFER.md",
    "source_tools/chemistry_study_composition.py",
    "integration/component_fragments/chemistry_study_transfer.json",
    "model/ensemble_study_transfer.py",
    "model/ENSEMBLE_STUDY_TRANSFER.md",
    "integration/component_fragments/ensemble-scientific-study-transfer.json",
    "model/gauge_study_transfer.py",
    "model/GAUGE_STUDY_TRANSFER.md",
    "integration/component_fragments/gauge-study-transfer.json",
    "model/landcover_study_transfer.py",
    "integration/component_fragments/landcover-scientific-report.json",
    "model/published_review_study_transfer.py",
    "model/published_review_report_source.py",
    "model/PUBLISHED_REVIEW_REPORT_SOURCE.md",
    "integration/component_fragments/published-review-report-source.json",
    "model/implementation_report_transfer.py",
    "model/receptor_report_maps.py",
    "model/scientific_figures.py",
    "model/scientific_map_figures.py",
    "model/spatial_esri.py",
    "source/capture_upstream_network.py",
    "model/receptor_study_transfer.py",
    "model/RECEPTOR_STUDY_TRANSFER.md",
    "operator/web/receptors.mjs",
    "integration/receptor_study_transfer.json",
    "integration/component_fragments/receptor-study-transfer.json",
    "model/monitoring_frontier_comparison.py",
    "model/monitoring_comparison_report.py",
    "model/community_study_transfer.py",
    "model/COMMUNITY_STUDY_TRANSFER.md",
    "operator/web/community.mjs",
    "operator/web/community_revisions.mjs",
    "integration/community_study_transfer_ui.patch.json",
    "integration/component_fragments/community-study-transfer.json",
    "model/conservation_study_transfer.py",
    "operator/CONSERVATION_STUDY_TRANSFER.md",
    "operator/web/conservation.mjs",
    "operator/source_report_editions.py",
    "integration/component_fragments/conservation-study-transfer.json",
    "model/native_process_study_transfer.py",
    "model/NATIVE_PROCESS_STUDY_TRANSFER.md",
    "integration/component_fragments/native-process-study-transfer.json",
    "model/receiving_water_report_transfer.py",
    "model/RECEIVING_WATER_REPORT_TRANSFER.md",
    "integration/component_fragments/receiving-water-report-transfer.json",
    # Optional selected-report continuation composes original study owners.
    "model/scientific_report_study_transfer.py",
    "model/calibration_study_transfer.py",
    "model/study_report_transfer.py",
    "model/monitoring_study_transfer.py",
    "operator/web/extensions/study_transfer.mjs",
    "operator/web/source_report_editions.mjs",
    "operator/web/app.mjs",
    "operator/SCIENTIFIC_REPORT_EDITIONS.md",
    "model/SCIENTIFIC_REPORT_STUDY_TRANSFER.md",
    "operator/CALIBRATION_REPORT_TRANSFER.md",
    "integration/component_fragments/scientific-report-study-transfer.json",
    "model/native_versions.py",
    # Optional full current postimages bind original native atlas delivery.
    "model/delivery.py",
    "model/client_report.py",
    "operator/web/map_atlas.mjs",
    "operator/MAP_ATLAS.md",
    "model/decision_study_transfer.py",
    "model/study_transfer.py",
    "model/study_delivery_transfer.py",
    "operator/STUDY_TRANSFER.md",
    "source/install_robust_workbench.py",
    "source/ROBUST_RECEIVING.md",
    # Optional full postimages join existing registered diagnostic desks. The
    # core sixteen-file packet also installs without changing these host files.
    "operator/web/retained_desks.mjs",
    "operator/web/experiment_diagnostics.mjs",
}
HASH = re.compile(r"[0-9a-f]{64}")
PREIMAGE_KEYS = ("before_sha256", "base_sha256", "replaces_sha256")
PACKAGE_ROOT = "model/robust_decisions/"
LEGACY = "operator/extensions/robust-decisions.json"
LEGACY_SHA = "8c5dfebfddd81df683a4b40fd8e8b893ec7940acf807575edaa0d35cbc8fcd13"
LEGACY_PREDECESSORS = {
    (757, LEGACY_SHA),
    # Original ECD1 complete-source queue registration and workspace verifier.
    (1912, "f21897e81a61f61074a12c58295fe00377414b8fb2557e08b98345ded0792175"),
}
RETIRED = LEGACY + ".retired-ECO13-ROBUST-DD6B"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_hash(value, label):
    if not isinstance(value, str) or HASH.fullmatch(value) is None:
        raise ValueError(label + ": expected a lowercase SHA-256")
    return value


def checked_name(value):
    if not isinstance(value, str) or value not in ALLOWED:
        raise ValueError("Unexpected Decision studies source path: " + repr(value))
    return value


def records(document, label):
    if not isinstance(document, dict):
        raise ValueError(label + ": expected a source packet object")
    files = document.get("files")
    if isinstance(files, list):
        result = files
    elif isinstance(files, dict):
        metadata = document.get("file_metadata", {})
        if not isinstance(metadata, dict):
            raise ValueError(label + ": malformed file_metadata")
        result = []
        for name, item in files.items():
            if isinstance(item, str):
                meta = metadata.get(name, {})
                if not isinstance(meta, dict):
                    raise ValueError(label + ": malformed metadata for " + name)
                result.append(dict(meta, path=name, content=item))
            elif isinstance(item, dict):
                if "path" in item and item["path"] != name:
                    raise ValueError(label + ": conflicting path for " + name)
                result.append(dict(item, path=name))
            else:
                raise ValueError(label + ": malformed file record")
    else:
        raise ValueError(label + ": missing files")
    if not result:
        raise ValueError(label + ": empty source packet")
    return result



def transport_document(text):
    # Canvas may insert NBSP indentation. Preserve quoted source strings here;
    # repair any affected source body only under its declared hash below.
    normalized, quoted, escaped = [], False, False
    for char in text:
        if quoted:
            normalized.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        else:
            normalized.append(" " if char == "\u00a0" else char)
            if char == '"':
                quoted = True
    return json.loads("".join(normalized))


def read_layers(paths):
    final, allowed, origins = {}, {}, {}
    for path in paths:
        packet_path = Path(path).resolve(strict=True)
        document = transport_document(packet_path.read_text(encoding="utf-8-sig"))
        seen = set()
        for item in records(document, str(packet_path)):
            if not isinstance(item, dict):
                raise ValueError(str(packet_path) + ": malformed file record")
            name = checked_name(item.get("path"))
            if name in seen:
                raise ValueError(str(packet_path) + ": duplicate file " + name)
            seen.add(name)
            expected = checked_hash(item.get("sha256"), name)
            size = item.get("bytes")
            if type(size) is not int or size < 0:
                raise ValueError(name + ": expected an exact nonnegative byte length")
            if "content_base64" in item:
                if "content" in item or not isinstance(item["content_base64"], str):
                    raise ValueError(name + ": select one full source encoding")
                data = base64.b64decode(item["content_base64"], validate=True)
                content = data.decode("utf-8")
            else:
                content = item.get("content")
                if not isinstance(content, str):
                    raise ValueError(name + ": full UTF-8 content is required")
                data = content.encode("utf-8")
                if len(data) != size or sha(data) != expected:
                    candidate = content.replace("\u00a0", " ").encode("utf-8")
                    if len(candidate) == size and sha(candidate) == expected:
                        data, content = candidate, candidate.decode("utf-8")
            if len(data) != size or sha(data) != expected:
                raise ValueError(name + ": incoming byte length or SHA-256 differs")
            if name.endswith(".py"):
                ast.parse(content, filename=name)
            elif name.endswith(".json"):
                json.loads(content)
            previous = allowed.setdefault(name, set())
            if name in final:
                previous.add(sha(final[name]))
            for key in PREIMAGE_KEYS:
                value = item.get(key)
                if value is not None:
                    values = value if isinstance(value, list) else [value]
                    if not values:
                        raise ValueError(name + " " + key + ": expected at least one preimage SHA-256")
                    for expected_before in values:
                        previous.add(checked_hash(expected_before, name + " " + key))
            final[name], origins[name] = data, str(packet_path)
    return final, allowed, origins


def target_path(application, name):
    # Reject symlink components, including links that currently point inside
    # the application: an authored source leaf must have one stable location.
    current = application
    for component in PurePosixPath(name).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError("Preserve and reconcile source symlink: " + name)
    if current.exists() and not current.is_file():
        raise ValueError("Expected regular source file: " + name)
    return current


def read_existing(application, name):
    path = target_path(application, name)
    return path.read_bytes() if path.exists() else None


def assembled_data(application, pending, name):
    if name in pending:
        return pending[name]
    data = read_existing(application, name)
    if data is None:
        raise ValueError("Receive the complete application/component first; missing " + name)
    return data


def verify_received_study_dependencies(application, pending):
    """Keep the original received-record readers and their native routes together."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    def require(names):
        for name in names:
            assembled_data(application, pending, name)

    reader = source("model/study_receiving.py")
    provider = source("operator/study_transfer.py")
    view = source("operator/web/received_studies.mjs")
    selector = source("operator/web/extensions/study_transfer.mjs")
    has_navigation = any(data is not None and b"study_report_navigation.mjs" in data
                         for data in (view, selector))
    if has_navigation:
        require((
            "model/report_review_study_receiving.py", "model/study_receiving.py",
            "model/customer_review_study_transfer.py", "model/scientific_report_review.py",
            "model/scientific_report_editions.py", "operator/study_receiving.py",
            "operator/study_transfer.py", "operator/extensions/study-transfer.json",
            "operator/web/study_report_navigation.mjs", "operator/web/received_studies.mjs",
            "operator/web/extensions/study_transfer.mjs", "operator/web/extensions/study_transfer.css",
            "operator/web/reviews.mjs", "operator/web/source_reports.mjs",
            "operator/web/source_report_editions.mjs", "operator/web/app.mjs",
            "operator/REPORT_REVIEW_STUDY_RECEIVING.md",
            "integration/component_fragments/report-review-study-receiving.json"))
        if reader is None or b"report_review_study_receiving" not in reader:
            raise ValueError("Receive the original saved-report and Customer review reader with its navigation")
        if provider is None or b"import study_receiving" not in provider:
            raise ValueError("Receive the original Study provider's retained-record read routes")
        descriptor = json.loads(assembled_data(
            application, pending, "operator/extensions/study-transfer.json"))
        routes = {(row.get("path"), row.get("operation"))
                  for row in descriptor.get("backend", {}).get("routes", [])
                  if "GET" in row.get("methods", [])}
        if not {("/api/study-transfer/received", "received"),
                ("/api/study-transfer/received-detail", "received-detail")}.issubset(routes):
            raise ValueError("Receive both original received-Study catalogue and detail routes")
        if "study_report_navigation.mjs" not in descriptor.get("assets", []):
            raise ValueError("Declare the original saved-record navigation asset in the Study descriptor")
        app = assembled_data(application, pending, "operator/web/app.mjs")
        if any(name not in app for name in
               (b"openSavedScientificReport", b"openSavedCustomerReview")):
            raise ValueError("Receive the original operator's saved-report and Customer review openers")
    if reader is not None:
        groups = {
            b"report_review_study_receiving": (
                "model/report_review_study_receiving.py", "model/customer_review_study_transfer.py",
                "model/scientific_report_review.py", "model/scientific_report_editions.py"),
            b"gauge_study_receiving": ("model/gauge_study_receiving.py",),
            b"ensemble_study_receiving": ("model/ensemble_study_receiving.py",),
            b"observed_landcover_receiving": (
                "model/observed_landcover_receiving.py", "model/observed_landcover.py",
                "model/landcover_report_source.py", "model/reuse.py"),
            b"observation_comparability_study_transfer": (
                "model/observation_comparability_study_transfer.py",
                "model/observation_comparability_store.py",
                "measurement_workspace/__init__.py",
                "measurement_workspace/observation_comparability.py",
                "measurement_workspace/observation_comparability_delivery.py",
                "operator/observation_comparability_operator.py",
                "operator/extensions/observation-comparability.json",
                "operator/web/observation_comparability.mjs",
                "operator/web/observation_comparability.css",
                "operator/web/comparability_received_studies.mjs"),
        }
        for marker, names in groups.items():
            if marker in reader:
                require(names)
        for module in ("scientific_report_study_transfer", "implementation_report_transfer",
                       "portable_implementation", "study_report_transfer"):
            if module.encode("ascii") in reader:
                require(("model/" + module + ".py",))
    ticket_reader = source("operator/study_receiving.py")
    if ticket_reader is not None:
        require(("model/study_receiving.py",))
        for module in ("gauge_receiving", "ensemble_receiving", "observed_landcover_receiving"):
            if module.encode("ascii") in ticket_reader:
                require(("operator/" + module + ".py",))
    assets = {
        b"study_report_navigation.mjs": ("operator/web/study_report_navigation.mjs",),
        b"gauge_received_studies.mjs": ("operator/web/gauge_received_studies.mjs",),
        b"ensemble_received_studies.mjs": ("operator/web/ensemble_received_studies.mjs",),
        b"observed_landcover_received.mjs": (
            "operator/web/observed_landcover_received.mjs", "operator/web/observed_landcover_received.css"),
        b"comparability_received_studies.mjs": ("operator/web/comparability_received_studies.mjs",),
    }
    for data in (view, selector):
        if data is not None:
            for marker, names in assets.items():
                if marker in data:
                    require(names)


def verify_economic_study_dependencies(application, pending):
    """Keep saved Economic history and its original receiving desk complete."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    consumers = (
        ("model/study_receiving.py", b"economic_comparison_study_transfer"),
        ("model/scientific_report_study_transfer.py", b"economic_comparison_study_transfer"),
        ("operator/web/received_studies.mjs", b"economic_received_comparisons.mjs"),
        ("operator/web/extensions/study_transfer.mjs", b"economic_received_comparisons.mjs"),
    )
    active = source("model/economic_comparison_study_transfer.py") is not None
    for name, marker in consumers:
        body = source(name)
        active = active or (body is not None and marker in body)
    if not active:
        return
    dependencies = (
        "model/common.py", "model/workspace.py", "model/observed_context.py",
        "model/economic_comparison.py", "model/economic_comparison_render.py",
        "model/economic_comparison_source.py", "model/economic_comparison_study_transfer.py",
        "model/decision_analysis.py", "model/decision_cli.py", "model/decision_desk.html",
        "model/model_selection.py", "model/native_versions.py",
        "operator/economic_workbench.py", "operator/economic_comparison.py",
        "operator/economic_comparison_source.py",
        "operator/extensions/economic-desk.json", "operator/extensions/economic-comparison.json",
        "operator/extensions/economic-comparison-source.json",
        "operator/web/economic_desk.mjs", "operator/web/economic_desk.css",
        "operator/web/economic_request_store.mjs", "operator/web/economic_cost_worksheet.mjs",
        "operator/web/economic_implementation.mjs", "operator/web/economic_comparison.mjs",
        "operator/web/economic_comparison_source.mjs",
        "operator/web/economic_received_comparisons.mjs",
        "integration/component_fragments/economic-comparison.json",
        "integration/component_fragments/economic-comparison-source.json",
    )
    for name in dependencies:
        assembled_data(application, pending, name)
    helper = assembled_data(application, pending, "model/economic_comparison_study_transfer.py")
    if any(signature not in helper for signature in
           (b"def include_source(", b"def summary(", b"def augment(")):
        raise ValueError("Receive the original Economic source-history and restored-study reader together")
    desk = assembled_data(application, pending, "operator/web/economic_desk.mjs")
    if b"openSavedComparison" not in desk:
        raise ValueError("Receive the original Economic desk's saved-comparison opener")
    required_actions = {
        "economic-desk": {"economic.edition.build", "economic.draft.save"},
        "economic-comparison": {"economic.comparison.build"},
        "economic-comparison-source": {"economic.comparison.report-source.import"},
    }
    for extension_id, actions in required_actions.items():
        descriptor = json.loads(assembled_data(
            application, pending, "operator/extensions/" + extension_id + ".json"))
        if (descriptor.get("schema") != "upstate.operator-extension/v1"
                or descriptor.get("id") != extension_id
                or not actions.issubset(set(descriptor.get("backend", {}).get("actions", [])))):
            raise ValueError("Receive the original complete Economic registration: " + extension_id)
        for asset in descriptor.get("assets", []):
            assembled_data(application, pending, "operator/web/" + asset)
    reader = source("operator/web/received_studies.mjs")
    if reader is not None and b"economic_received_comparisons.mjs" in reader:
        descriptor = json.loads(assembled_data(
            application, pending, "operator/extensions/study-transfer.json"))
        if "economic_received_comparisons.mjs" not in descriptor.get("assets", []):
            raise ValueError("Declare the original Economic receiving asset in the Study descriptor")
    receiver = source("operator/economic_receive.py")
    if receiver is not None and b"decision_receive" in receiver:
        assembled_data(application, pending, "model/decision_receive.py")


def verify_composition(application, pending):
    verify_received_study_dependencies(application, pending)
    verify_economic_study_dependencies(application, pending)
    for name in REQUIRED:
        assembled_data(application, pending, name)
    for name in ("model/workspace.py", "model/experiments.py", "model/native_versions.py",
                 "model/experiment_profiles.py", "operator/server.py",
                 "operator/extension_registry.py", "operator/web/app.mjs",
                 "operator/web/extension_host.mjs"):
        assembled_data(application, pending, name)
    transfer = pending.get("model/study_transfer.py")
    if transfer is None:
        transfer = read_existing(application, "model/study_transfer.py")
    if transfer is not None and b"study_delivery_transfer" in transfer:
        assembled_data(application, pending, "model/study_delivery_transfer.py")
        assembled_data(application, pending, PACKAGE_ROOT + "eco_robust/decision_delivery.py")
    if transfer is not None:
        for module in ("scientific_report_study_transfer", "calibration_study_transfer",
                       "study_report_transfer", "monitoring_study_transfer",
                       "community_study_transfer", "conservation_study_transfer",
                       "native_process_study_transfer", "receptor_study_transfer",
                       "customer_review_study_transfer", "conservation_design_study_transfer",
                       "paired_ensemble_study_transfer", "report_changes_study_transfer",
                       "chemistry_study_transfer", "ensemble_study_transfer",
                       "gauge_study_transfer", "landcover_study_transfer",
                       "published_review_study_transfer", "implementation_report_transfer"):
            if module.encode("ascii") in transfer:
                assembled_data(application, pending, "model/" + module + ".py")
        if b"receptor_study_transfer" in transfer:
            for dependency in ("model/compute_programme.py", "model/receptor_report_source.py",
                               "model/receptor_network_cli.py", "model/receptor_scenarios.py",
                               "model/receptor_programmes.py", "model/receptor_experiments.py",
                               "model/receptor_cli.py", "model/receptor_execution.py",
                               "model/receptors.py", "operator/web/receptors.mjs"):
                assembled_data(application, pending, dependency)
        if b"customer_review_study_transfer" in transfer:
            for dependency in ("model/reviews.py", "model/review_handback.py",
                               "model/review_receiving.py", "model/review_reconciliation.py",
                               "model/review_worklist.py", "model/scientific_report_editions.py",
                               "model/scientific_report_review.py",
                               "model/scientific_report_study_transfer.py",
                               "model/spatial_exports.py", "operator/review_app.html",
                               "delivery_snapshot.py"):
                assembled_data(application, pending, dependency)
        if b"conservation_design_study_transfer" in transfer:
            for dependency in ("model/conservation_design_editor.py",
                               "model/conservation_design.py", "model/conservation_bindings.py",
                               "model/conservation_scenarios.py", "model/portable_databases.py",
                               "model/conservation_study_transfer.py",
                               "scenario-design/__init__.py", "scenario-design/engine.py",
                               "scenario-design/conservation.py", "scenario-design/server.py",
                               "scenario-design/eco_bridge.py"):
                assembled_data(application, pending, dependency)
        if b"implementation_report_transfer" in transfer:
            for dependency in ("model/implementation.py", "model/implementation_schema.py",
                               "model/implementation_reporting.py", "model/portable_implementation.py",
                               "model/implementation_outcomes.py", "model/implementation_outcome_figures.py",
                               "model/implementation_observations.py", "model/field_deployment.py",
                               "model/monitoring_packet.py", "model/monitoring_common.py"):
                assembled_data(application, pending, dependency)
        if b"receptor_study_transfer" in transfer:
            producer = assembled_data(application, pending, "model/receptor_report_source.py")
            if b"receptor_report_maps" in producer:
                for dependency in ("model/receptor_report_maps.py", "model/scientific_figures.py",
                                   "model/scientific_map_figures.py", "model/spatial_esri.py",
                                   "source/capture_upstream_network.py"):
                    assembled_data(application, pending, dependency)
        if b"monitoring_study_transfer" in transfer:
            assembled_data(application, pending, "model/monitoring_frontier_comparison.py")
        if b"community_study_transfer" in transfer:
            for dependency in ("model/communities.py", "model/community_reports.py",
                               "model/community_report_context.py", "model/community_revisions.py",
                               "operator/web/community_revisions.mjs"):
                assembled_data(application, pending, dependency)
        if b"conservation_study_transfer" in transfer:
            for dependency in ("model/conservation.py", "model/conservation_reporting.py",
                               "model/source_lineage.py", "model/observed_context.py"):
                assembled_data(application, pending, dependency)
        if b"native_process_study_transfer" in transfer:
            process = assembled_data(application, pending, "model/native_process_study_transfer.py")
            if b"def include_source(" not in process or b"def lock_paths(" not in process:
                raise ValueError("Receive the matching original native-process lineage and operation-lock helper")
        if b"calibration_study_transfer" in transfer:
            for dependency in ("model/calibration.py", "model/calibration_uncertainty.py",
                               "model/calibration_maps.py", "model/calibration_review.py",
                               "model/calibration_report_source.py"):
                assembled_data(application, pending, dependency)
        if b"scientific_report_study_transfer" in transfer:
            for dependency in ("model/observed_context.py", "model/observed_report_render.py",
                               "model/receiving_water_report_transfer.py",
                               "operator/source_report_editions.py"):
                assembled_data(application, pending, dependency)
            dispatcher = assembled_data(application, pending, "model/scientific_report_study_transfer.py")
            for module in ("community_study_transfer", "conservation_study_transfer",
                           "native_process_study_transfer", "receptor_study_transfer",
                           "customer_review_study_transfer", "conservation_design_study_transfer",
                       "paired_ensemble_study_transfer",
                           "chemistry_study_transfer", "ensemble_study_transfer",
                           "gauge_study_transfer", "landcover_study_transfer",
                           "published_review_study_transfer", "implementation_report_transfer"):
                if module.encode("ascii") in dispatcher:
                    helper = assembled_data(application, pending, "model/" + module + ".py")
                    if b"def include_source(" not in helper:
                        raise ValueError("Receive the matching scoped scientific-report lineage helper: " + module)
            if b"published_review_study_transfer" in dispatcher:
                assembled_data(application, pending, "model/published_review_report_source.py")
            lineage = assembled_data(application, pending, "model/study_report_transfer.py")
            monitoring = assembled_data(application, pending, "model/monitoring_study_transfer.py")
            if b"def include_calibration(" not in lineage or b"def include_source(" not in monitoring:
                raise ValueError("Receive the matching original calibration and Monitoring report lineage helpers")
    # Optional original receiving companions travel through the same guarded
    # layer format. Verify their native sources before replacing any file.
    review_receiver = pending.get("source_tools/receive_scientific_report_review.py")
    if review_receiver is None:
        review_receiver = read_existing(application, "source_tools/receive_scientific_report_review.py")
    if review_receiver is not None:
        for dependency in ("model/common.py", "model/workspace.py", "model/portable.py",
                           "model/reviews.py", "model/scientific_report_editions.py",
                           "model/scientific_report_review.py"):
            assembled_data(application, pending, dependency)
        if b"report_changes_review" in review_receiver:
            for dependency in ("model/report_changes_review.py", "model/report_changes.py",
                               "model/report_changes_study_transfer.py"):
                assembled_data(application, pending, dependency)
        if b"def continue_selected_review(" in review_receiver:
            if transfer is None or b"customer_review_study_transfer" not in transfer:
                raise ValueError("Receive the original Customer review Study transfer before its selected receiver")
            assembled_data(application, pending, "model/customer_review_study_transfer.py")
            assembled_data(application, pending, "model/scientific_report_study_transfer.py")
    design_receiver = pending.get("operator/conservation_design_browser_receiving.py")
    if design_receiver is None:
        design_receiver = read_existing(application, "operator/conservation_design_browser_receiving.py")
    if design_receiver is not None:
        for dependency in ("operator/conservation_browser_receiving.py",
                           "operator/conservation_design.py", "model/conservation_design.py",
                           "model/conservation_design_editor.py",
                           "operator/extensions/conservation-design.json"):
            assembled_data(application, pending, dependency)
        if b"--selected-study" in design_receiver:
            if transfer is None:
                raise ValueError("Receive the original Study transfer before selected editor receiving")
            study_tree = ast.parse(transfer.decode("utf-8"), filename="model/study_transfer.py")
            aliases = {
                item.asname or item.name
                for node in ast.walk(study_tree) if isinstance(node, ast.ImportFrom)
                for item in node.names if item.name == "conservation_design_study_transfer"
            }
            calls = {
                node.func.attr for node in ast.walk(study_tree)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id in aliases
            }
            if not {"source_snapshot", "capture", "verify"}.issubset(calls):
                raise ValueError("Receive the complete original selected editor snapshot and receiving joins")
            assembled_data(application, pending, "model/conservation_design_study_transfer.py")
            databases = assembled_data(application, pending, "model/portable_databases.py")
            portable = assembled_data(application, pending, "model/portable.py")
            if (b"workspace/conservation-design/editor/projects.sqlite" not in databases
                    or b"frozen_databases" not in portable):
                raise ValueError("Receive original frozen editor-database support before selected editor receiving")
    comparison_consumers = []
    for name in ("model/customer_review_study_transfer.py", "operator/report_changes.py"):
        data = pending.get(name)
        if data is None:
            data = read_existing(application, name)
        if data is not None:
            comparison_consumers.append(data)
    if any(b"report_changes_review" in data for data in comparison_consumers):
        for dependency in ("model/report_changes_review.py", "model/report_changes.py",
                           "model/scientific_report_review.py", "model/reviews.py",
                           "model/workspace.py"):
            assembled_data(application, pending, dependency)
    if transfer is not None and b"report_changes_study_transfer" in transfer:
        for dependency in (
                "model/report_changes_study_transfer.py", "model/report_changes.py",
                "model/scientific_report_editions.py", "model/scientific_report_study_transfer.py",
                "operator/report_changes.py", "operator/extensions/report-changes.json",
                "operator/web/report_changes.mjs", "operator/web/report_changes.css",
                "docs/SCIENTIFIC_REPORT_CHANGES.md", "install_report_changes.py",
                "model/REPORT_CHANGES_STUDY_TRANSFER.md",
                "integration/component_fragments/scientific-report-changes.json",
                "integration/component_fragments/report-changes-study-transfer.json"):
            assembled_data(application, pending, dependency)
    if transfer is not None and b"paired_ensemble_study_transfer" in transfer:
        for dependency in (
                "model/paired_ensemble_study_transfer.py", "model/paired_ensemble_study_cli.py",
                "model/paired_ensemble/__init__.py", "model/paired_ensemble/ensemble_store.py",
                "model/paired_ensemble/ensemble_workspace.py", "model/paired_ensemble/ensemble_rasters.py",
                "model/paired_ensemble/ensemble_report.py", "model/paired_ensemble/ensemble_portable.py",
                "model/paired_ensemble/ensemble_cli.py", "model/paired_ensemble/designs.py",
                "model/paired_ensemble/ensemble_report_source.py", "model/paired_ensemble/ensemble_report_cli.py",
                "operator/paired_ensemble_service.py", "operator/paired_ensemble_report_native.py",
                "operator/extensions/paired-ensemble.json", "operator/extensions/paired-ensemble-report.json",
                "operator/web/paired_ensemble_desk.mjs", "operator/web/paired_ensemble_desk.css",
                "operator/web/paired_ensemble_report_desk.mjs", "operator/web/paired_ensemble.html",
                "operator/web/paired_ensemble.mjs", "operator/web/paired_ensemble.css",
                "operator/web/paired_ensemble_host.mjs", "operator/web/paired_ensemble_host.css"):
            assembled_data(application, pending, dependency)
    monitoring_report = pending.get("model/monitoring_report_source.py")
    if monitoring_report is None:
        monitoring_report = read_existing(application, "model/monitoring_report_source.py")
    if monitoring_report is not None:
        assembled_data(application, pending, "model/monitoring_comparison_report.py")
    saved_editions = pending.get("model/scientific_report_editions.py")
    if saved_editions is None:
        saved_editions = read_existing(application, "model/scientific_report_editions.py")
    report_provider = pending.get("operator/source_report_editions.py")
    if report_provider is None:
        report_provider = read_existing(application, "operator/source_report_editions.py")
    if any(source is not None and b"scientific_report_capture" in source
           for source in (saved_editions, report_provider)):
        for dependency in (
                "model/scientific_report_capture.py", "model/scientific_report_editions.py",
                "model/observed_report_render.py", "model/observed_context.py", "model/common.py",
                "operator/source_report_editions.py", "operator/extensions/source-reports.json",
                "operator/web/source_report_editions.mjs", "operator/web/source_reports.mjs",
                "operator/SCIENTIFIC_REPORT_CAPTURE.md",
                "integration/component_fragments/scientific-report-capture.json"):
            assembled_data(application, pending, dependency)
    server = assembled_data(application, pending, "operator/server.py").decode("utf-8")
    client = assembled_data(application, pending, "operator/web/app.mjs").decode("utf-8")
    if "ExtensionRegistry" not in server or "self.extensions" not in server or "createExtensionHost" not in client:
        raise ValueError("Compose the original extension installer into the current server/app first")
    manifest = json.loads(assembled_data(application, pending, PACKAGE_ROOT + "SOURCE_MANIFEST.json"))
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Original native package manifest is missing its file inventory")
    seen = set()
    for entry in entries:
        name = entry.get("path")
        if (not isinstance(name, str) or "\\" in name or
                PurePosixPath(name).is_absolute() or
                any(part in ("", ".", "..") for part in name.split("/")) or name in seen):
            raise ValueError("Malformed or duplicate native package manifest path")
        seen.add(name)
        data = assembled_data(application, pending, PACKAGE_ROOT + name)
        if (type(entry.get("bytes")) is not int or len(data) != entry["bytes"] or
                sha(data) != checked_hash(entry.get("sha256"), name)):
            raise ValueError("Compose the newer native package source and its manifest before installation: " + name)
    descriptor = json.loads(assembled_data(application, pending, "operator/extensions/robust-workbench.json"))
    if descriptor.get("schema") != "upstate.operator-extension/v1" or descriptor.get("id") != "robust-workbench":
        raise ValueError("Unexpected native Decision studies descriptor")
    if descriptor.get("backend", {}).get("module") != "robust_workbench":
        raise ValueError("Unexpected Decision studies provider module")
    if descriptor.get("client", {}).get("module") != "/web/robust_workbench.mjs":
        raise ValueError("Unexpected Decision studies client module")
    for asset in descriptor.get("assets", []):
        if asset not in ("robust_workbench.mjs", "robust_workbench.css"):
            raise ValueError("Unexpected Decision studies asset")
        assembled_data(application, pending, "operator/web/" + asset)



def prepare_legacy_retirement(application, pending):
    old = read_existing(application, LEGACY)
    backup = read_existing(application, RETIRED)
    if old is not None and (len(old), sha(old)) not in LEGACY_PREDECESSORS:
        raise ValueError("Preserve and compose the newer legacy decision registration: " + LEGACY)
    if backup is not None and (len(backup), sha(backup)) not in LEGACY_PREDECESSORS:
        raise ValueError("Preserve the existing decision-registration retirement record: " + RETIRED)
    if old is not None and backup is not None and old != backup:
        raise ValueError("Preserve both distinct original decision registrations before retirement")
    descriptor = json.loads(assembled_data(application, pending, "operator/extensions/robust-workbench.json"))
    ours = set(descriptor.get("backend", {}).get("actions", []))
    directory = target_path(application, "operator/extensions/robust-workbench.json").parent
    for path in sorted(directory.glob("*.json")):
        relative = path.relative_to(application).as_posix()
        if relative in (LEGACY, "operator/extensions/robust-workbench.json"):
            continue
        content = read_existing(application, relative)
        registration = json.loads(content)
        shared = ours & set(registration.get("backend", {}).get("actions", []))
        if shared:
            raise ValueError("Compose the existing action owner before installation: " +
                             relative + " (" + ", ".join(sorted(shared)) + ")")
    return old, backup


def run(application, packet_paths, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    if not application.is_dir():
        raise ValueError("Application must be a directory")
    pending, allowed, origins = read_layers(packet_paths)
    lock_root = application / ".locks"
    if lock_root.is_symlink():
        raise ValueError("Preserve and reconcile the application's .locks symlink")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    if lock_path.is_symlink():
        raise ValueError("Preserve and reconcile the extension installer lock symlink")
    with lock_path.open("a+") as lock:
        # Share the original extension installer's lock; do not create a
        # competing independent lock for modifications to the same application.
        fcntl.flock(lock, fcntl.LOCK_EX)
        originals, modes, conflicts = {}, {}, []
        for name, data in pending.items():
            path = target_path(application, name)
            before = path.read_bytes() if path.exists() else None
            originals[name] = before
            modes[name] = stat.S_IMODE(path.stat().st_mode) if before is not None else 0o644
            if before is not None and before != data and sha(before) not in allowed[name]:
                conflicts.append({"path": name, "actual_sha256": sha(before),
                                  "incoming_sha256": sha(data),
                                  "allowed_preimages": sorted(allowed[name])})
        if conflicts:
            raise ValueError("Newer or unrecognized authored files preserved; compose these exact sources first:\n" +
                             json.dumps(conflicts, indent=2, sort_keys=True))
        verify_composition(application, pending)
        legacy, retired = prepare_legacy_retirement(application, pending)
        # Publish the new registration only after its provider and assets exist.
        changed = sorted((name for name in pending if originals[name] != pending[name]),
                         key=lambda name: (name == "operator/extensions/robust-workbench.json", name))
        receipt = {
            "schema": "upstate.robust-workbench-install/v1",
            "application": str(application), "dry_run": dry_run,
            "changed": changed,
            "retired_registration": {"path": LEGACY, "retained_as": RETIRED,
                                     "sha256": sha(legacy)} if legacy is not None else None,
            "files": [{"path": name, "bytes": len(data), "sha256": sha(data),
                       "previous_sha256": sha(originals[name]) if originals[name] is not None else None,
                       "packet": origins[name]} for name, data in sorted(pending.items())],
        }
        if dry_run or (not changed and legacy is None):
            return receipt
        with tempfile.TemporaryDirectory(prefix=".robust-install-", dir=application) as temporary:
            staging = Path(temporary)
            for name in changed:
                staged = staging / name
                staged.parent.mkdir(parents=True, exist_ok=True)
                with staged.open("wb") as stream:
                    stream.write(pending[name])
                    stream.flush()
                    os.fsync(stream.fileno())
                staged.chmod(modes[name])
            # Reconcile all inputs once more before the first replacement.
            for name in pending:
                if read_existing(application, name) != originals[name]:
                    raise RuntimeError("Concurrent authored change preserved at " + name)
            if (read_existing(application, LEGACY) != legacy or
                    read_existing(application, RETIRED) != retired):
                raise RuntimeError("Concurrent legacy registration changes preserved")
            if legacy is not None:
                # The known old descriptor owns the same twelve actions. Retain
                # its exact bytes outside *.json so the registry has one owner.
                os.replace(target_path(application, LEGACY), target_path(application, RETIRED))
            for name in changed:
                target = target_path(application, name)
                if read_existing(application, name) != originals[name]:
                    raise RuntimeError("Concurrent authored change preserved at " + name +
                                       "; compose current source and rerun the same packets")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging / name, target)
        # An interrupted install is restartable because incoming-identical
        # files are accepted and all remaining replacements retain preimages.
        for name, data in pending.items():
            if read_existing(application, name) != data:
                raise RuntimeError("Installed source changed during readback: " + name)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--packet", action="append", required=True,
                        help="Decoded source JSON packet; repeat in explicit layer order")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.application, args.packet, dry_run=args.dry_run),
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
