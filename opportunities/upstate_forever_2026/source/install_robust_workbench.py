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
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
from types import SimpleNamespace

if os.name != "nt":
    import fcntl

ALLOWED = frozenset({
    "model/climate_management_working.py",
    "model/climate_management_working_comparison.py",
    "model/climate_management_working_comparison_transfer.py",
    "model/climate_management_working_transfer.py",
    "operator/CLIMATE_MANAGEMENT_DESIGN_COMPARISON.md",
    "operator/CLIMATE_MANAGEMENT_WORKING.md",
    "operator/web/climate_management_working.mjs",
    "operator/web/climate_management_working_comparison.mjs",
    "source_tools/CLIMATE_MANAGEMENT_RECEIVING.md",
    "source_tools/climate_management_browser_support.py",
    "source_tools/climate_management_working.py",
    "source_tools/compose.py",
    "source_tools/receive_climate_management.py",
    "source_tools/receive_climate_management_browser.mjs",
    "model/joint_delivery.py",
    "operator/joint_delivery.py",
    "source/joint-delivery/20261013/profile.json",
    "operator/web/joint_delivery.mjs",
    "operator/web/joint_delivery.css",
    "operator/extensions/joint-delivery.json",
    "source_tools/receive_joint_delivery.py",
    "source_tools/receive_joint_delivery_browser.mjs",
    "JOINT_DELIVERY.md",
    "integration/component_fragments/joint-delivery.json",
    "operator/web/conservation_working.mjs",
    "operator/web/conservation_working_view.mjs",
    "operator/CONSERVATION_WORKING_FILES.md",
    "integration/component_fragments/conservation-working-files.json",
    "model/conservation_joint_choices.py",
    "operator/web/conservation_joint_choices.mjs",
    "CONSERVATION_JOINT_CHOICES.md",
    "integration/component_fragments/conservation-joint-choices.json",
    "CONSERVATION_DECISION_METHODS.md",
    "ecsa_runs/upstate.py",
    "integration/component_fragments/calibration-native-catchments.json",
    "integration/component_fragments/calibration-parameter-continuation.json",
    "integration/component_fragments/calibration-profile-history.json",
    "integration/component_fragments/calibration-reference-followup.json",
    "integration/component_fragments/calibration-studies.json",
    "integration/component_fragments/climate-forcing.json",
    "integration/component_fragments/climate-management.json",
    "integration/component_fragments/conservation-scientific-report-source.json",
    "integration/component_fragments/headwaters-input-interpretation.json",
    "integration/component_fragments/headwaters-native-interpretation.json",
    "integration/component_fragments/parameter-working.json",
    "integration/conservation_report_map_composition.json",
    "integration/conservation_report_operator_composition.json",
    "model/CALIBRATION.md",
    "model/CALIBRATION_CATCHMENTS.md",
    "model/CALIBRATION_FOLLOWUP.md",
    "model/CALIBRATION_HISTORY.md",
    "model/CALIBRATION_MAPS.md",
    "model/CALIBRATION_REPORT_SOURCE.md",
    "model/CALIBRATION_REVIEW.md",
    "model/CALIBRATION_STUDIES.md",
    "model/CALIBRATION_UNCERTAINTY.md",
    "model/CONSERVATION_REPORT_MAPS.md",
    "model/CONSERVATION_REPORT_SOURCE.md",
    "model/calibration.py",
    "model/calibration_catchments.py",
    "model/calibration_execution.py",
    "model/calibration_followup.py",
    "model/calibration_history.py",
    "model/calibration_history_export.py",
    "model/calibration_maps.py",
    "model/calibration_native_study_transfer.py",
    "model/calibration_report_source.py",
    "model/calibration_review.py",
    "model/calibration_study_receiving.py",
    "model/calibration_uncertainty.py",
    "model/climate_forcing.py",
    "model/climate_forcing_study_transfer.py",
    "model/climate_management.py",
    "model/climate_management_figures.py",
    "model/climate_management_study_transfer.py",
    "model/climate_working.py",
    "model/climate_working_transfer.py",
    "model/conservation.py",
    "model/conservation_decision_geography.py",
    "model/conservation_families.py",
    "model/conservation_optimization.py",
    "model/conservation_report_maps.py",
    "model/conservation_report_source.py",
    "model/conservation_report_source_cli.py",
    "model/conservation_reporting.py",
    "model/conservation_sampling_evidence.py",
    "model/experiment_profiles.py",
    "model/forcing_sources.py",
    "model/joint_parameter_analysis.py",
    "model/joint_parameter_studies.py",
    "model/joint_parameter_study_transfer.py",
    "model/keowee_priority.py",
    "model/management_case_study_transfer.py",
    "model/management_cases.py",
    "model/native_worker.py",
    "model/parameter_calibration.py",
    "model/parameter_report_source.py",
    "model/parameter_studies.py",
    "model/parameter_study_receiving.py",
    "model/parameter_study_transfer.py",
    "model/parameter_working.py",
    "model/parameter_working_transfer.py",
    "model/portable_parameter_studies.py",
    "model/portfolios.py",
    "model/source_lineage.py",
    "operator/CALIBRATION.md",
    "operator/CALIBRATION_DESIGN.md",
    "operator/CLIMATE_FORCING.md",
    "operator/CLIMATE_FORCING_STUDY_DELIVERY.md",
    "operator/CLIMATE_MANAGEMENT.md",
    "operator/CLIMATE_WORKING.md",
    "operator/PARAMETER_STUDY_CALIBRATION.md",
    "operator/PARAMETER_WORKING.md",
    "operator/calibration.py",
    "operator/calibration_design_patch.json",
    "operator/climate_forcing.py",
    "operator/climate_management.py",
    "operator/conservation.py",
    "operator/extensions/calibration.json",
    "operator/extensions/climate-forcing.json",
    "operator/extensions/climate-management.json",
    "operator/extensions/conservation.json",
    "operator/extensions/joint-parameter-studies.json",
    "operator/install_calibration.py",
    "operator/install_calibration_design.py",
    "operator/joint_parameter_operator.py",
    "operator/native_jobs.py",
    "operator/parameter_receiving.py",
    "operator/parameter_study_api.py",
    "operator/web/calibration.css",
    "operator/web/calibration.mjs",
    "operator/web/calibration_catchments.mjs",
    "operator/web/calibration_design.mjs",
    "operator/web/calibration_history.mjs",
    "operator/web/calibration_maps.mjs",
    "operator/web/calibration_received_studies.mjs",
    "operator/web/calibration_review.mjs",
    "operator/web/climate_forcing.css",
    "operator/web/climate_forcing.mjs",
    "operator/web/climate_management.css",
    "operator/web/climate_management.mjs",
    "operator/web/climate_management_explorer.mjs",
    "operator/web/climate_working.mjs",
    "operator/web/joint_parameter_studies.css",
    "operator/web/joint_parameter_studies.mjs",
    "operator/web/parameter_received_studies.mjs",
    "operator/web/parameter_studies.css",
    "operator/web/parameter_studies.mjs",
    "operator/web/parameter_working.mjs",
    "source/calibration-design/upper-savannah-reference-support.json",
    "source/usgs-southeast-sparrow-2012/CANDIDATE_COURSE.md",
    "source_tools/CLIMATE_FORCING_PERIODS.md",
    "source_tools/calibration_assembly.py",
    "source_tools/climate_forcing_study.py",
    "source_tools/climate_working.py",
    "source_tools/sparrow_candidate_course.py",
    "model/monitoring_native_observations.py",
    "model/monitoring_concentration_report.py",
    "operator/web/monitoring-native-context.mjs",
    "operator/web/monitoring-native-context.css",
    "source/NATIVE_OBSERVATIONS_SAMPLING.md",
    "source_tools/sampling_native_observation_receiving.py",
    "source_tools/selections/sampling_sv833_20261013.json",
    "integration/component_fragments/monitoring-native-observations.json",
    "model/MONITORING.md",
    "model/MONITORING_FIELDWORK.md",
    "model/MONITORING_OBSERVED_CONTEXT.md",
    "model/implementation.py",
    "model/implementation_reporting.py",
    "model/implementation_schema.py",
    "model/monitoring_actions.py",
    "model/monitoring_campaign.py",
    "model/monitoring_cli.py",
    "model/monitoring_design.py",
    "model/monitoring_field_return.py",
    "model/monitoring_implementation.py",
    "model/monitoring_network.py",
    "model/monitoring_report_source.py",
    "model/monitoring_sources.py",
    "model/monitoring_workspace.py",
    "model/receiving_water_monitoring.py",
    "model/requirements-monitoring.txt",
    "model/utility_microbial_study.py",
    "model/utility_monitoring.py",
    "model/utility_monitoring_comparison.py",
    "model/utility_monitoring_report.py",
    "operator/MONITORING_API.md",
    "operator/extensions/monitoring.json",
    "operator/monitoring.py",
    "operator/monitoring_native.py",
    "operator/monitoring_receiving.py",
    "operator/static/monitoring.js",
    "operator/web/monitoring-component.mjs",
    "operator/web/monitoring-field-selection.mjs",
    "operator/web/monitoring-frontiers.css",
    "operator/web/monitoring-frontiers.mjs",
    "operator/web/monitoring-observed.mjs",
    "operator/web/monitoring-report.mjs",
    "operator/web/monitoring-study-transfer.mjs",
    "operator/web/monitoring.css",
    "operator/web/monitoring.mjs",
    "operator/web/monitoring_field_return.mjs",
    "operator/web/monitoring_fieldwork.mjs",
    "source_tools/demo_deadline.py",
    "source_tools/simulated_headwaters_receiving.py",
    "model/monitoring_native_evidence.py",
    "model/monitoring_evidence_report.py",
    "model/monitoring_recommendations.py",
    "model/monitoring_common.py",
    "model/monitoring_observed_context.py",
    "model/monitoring_packet.py",
    "model/MONITORING_RECOMMENDATIONS.md",
    "source/SAMPLING_NATIVE_EVIDENCE.md",
    "operator/monitoring_recommendations.py",
    "operator/extensions/monitoring-recommendations.json",
    "operator/web/monitoring_recommendations.mjs",
    "operator/web/monitoring_recommendations.css",
    "operator/SAMPLING_PRIORITIES.md",
    "source_tools/receive_sampling_recommendations.py",
    "integration/component_fragments/monitoring-recommendations.json",
    "integration/component_fragments/monitoring-native-evidence.json",
    "model/common.py",
    "model/workspace.py",
    "source/observed-report-20261013/RECEIVING.md",
    "source/observed-report-20261013/RECEIVING_COURSE.md",
    "checks/terrain_conditioning_course.py",
    "operator/web/source_reports.css",
    "operator/web/scientific_source_reader.mjs",
    "operator/web/published_original_reports.mjs",
    "operator/web/published_studies.css",
    "operator/web/scientific_synthesis.mjs",
    "operator/web/scientific_synthesis_core.mjs",
    "operator/web/scientific_synthesis.css",
    "operator/server.py",
    "operator/extension_registry.py",
    "operator/source_reports.py",
    "operator/source_archive_ingress.py",
    "operator/scientific_synthesis.py",
    "operator/scientific_source_reader.py",
    "model/scientific_briefing.py",
    "model/observed_context.py",
    "model/scientific_report_review.py",
    "model/scientific_synthesis.py",
    "model/scientific_synthesis_catalog.py",
    "integration/component_fragments/terrain-conditioning-report-source.json",
    "integration/component_fragments/terrain-conditioning.json",
    "integration/component_fragments/terrain-report-receiving.json",
    "integration/component_fragments/terrain-study-transfer.json",
    "model/terrain_conditioning_report_cli.py",
    "model/terrain_conditioning_report_source.py",
    "model/terrain_conditioning_scientific_report.py",
    "model/terrain_conditioning_study_transfer.py",
    "operator/TERRAIN_SCIENTIFIC_SOURCE.md",
    "operator/extensions/terrain-conditioning.json",
    "operator/terrain_conditioning_native.py",
    "operator/web/terrain_conditioning.css",
    "operator/web/terrain_conditioning.mjs",
    "source/TERRAIN_STUDY_TRANSFER.md",
    "source/observed-report-20261013/assessment_browser.mjs",
    "source/observed-report-20261013/receive_browser.mjs",
    "source/observed-report-20261013/receive_course.py",
    "source/observed-report-20261013/receive_operator.py",
    "source_tools/TERRAIN_CONDITIONING.md",
    "source_tools/TERRAIN_REPORT_RECEIVING.md",
    "source_tools/terrain_conditioning.py",
    "source_tools/terrain_conditioning_report.py",
    "source_tools/terrain_conditioning_response.py",
    "source_tools/terrain_flood.cpp",
    "source_tools/terrain_prepare.py",
    "source_tools/terrain_report_browser.mjs",
    "source_tools/terrain_report_receiving.py",
    "operator/delivery_preparation_receiving.mjs",
    "operator/web/delivery_preparation_storage.mjs",
    "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
    "operator/multivariate_control_operator.py",
    "operator/web/multivariate_control_core.mjs",
    "model/multivariate_control_study_transfer.py",
    "operator/web/multivariate_control.css",
    "model/multivariate_control_report.py",
    "model/multivariate_control_design.py",
    "model/multivariate_control_cli.py",
    "operator/web/multivariate_control.mjs",
    "integration/component_fragments/multivariate-control.json",
    "integration/component_fragments/multivariate-control-study-transfer.json",
    "source_tools/MULTIVARIATE_CONTROL_RECEIVING.md",
    "operator/MULTIVARIATE_CONTROL.md",
    "model/multivariate_control.py",
    "source/MULTIVARIATE_CONTROLS.md",
    "integration/component_fragments/multivariate-control-receiving.json",
    "source_tools/multivariate_control_browser.mjs",
    "source_tools/multivariate_control_receiving.py",
    "operator/extensions/multivariate-control.json",
    "model/multivariate_control_outcomes.py",
    "model/multivariate_control_outcome_analysis.py",
    "model/multivariate_control_outcome_report.py",
    "model/multivariate_control_outcome_transfer.py",
    "model/multivariate_control_outcomes_cli.py",
    "source/MULTIVARIATE_CONTROL_OUTCOMES.md",
    "integration/component_fragments/multivariate-control-outcomes.json",
    "operator/multivariate_control_outcomes_operator.py",
    "operator/extensions/multivariate-control-outcomes.json",
    "operator/web/multivariate_control_outcomes_core.mjs",
    "operator/web/multivariate_control_outcomes.mjs",
    "operator/MULTIVARIATE_CONTROL_OUTCOMES.md",
    "integration/component_fragments/multivariate-control-outcome-desk.json",
    "model/experiments.py",
    "model/scientific_report.py",
    "source_tools/geographic_programme_browser.mjs",
    "source_tools/receive_geographic_handover_browser.mjs",
    "source_tools/geographic_review_browser.mjs",
    "source_tools/geographic_browser_course.mjs",
    "source_tools/geographic_allocation_browser.mjs",
    "docs/GEOGRAPHIC_HANDOVER_BROWSER.md",
    "integration/component_fragments/geographic-handover-browser.json",
    "model/paired_ensemble/ensemble_portable.py",
    "integration/component_fragments/geographic-study-receiving.json",
    "model/geographic_study_receiving.py",
    "operator/geographic_receiving.py",
    "operator/web/geographic_received_studies.mjs",
    "model/GEOGRAPHIC_STUDY_RECEIVING.md",
    "source_tools/geographic_headwaters_handover.py",
    "source_tools/simulated_headwaters_handover.py",
    "model/geographic_programme.py",
    "source_tools/adopt_geographic_headwaters_programme.py",
    "source_tools/GEOGRAPHIC_PROGRAMME.md",
    "operator/extensions/programme-activity.json",
    "operator/programme_activity.py",
    "model/compute_programme.py",
    "model/programme_interactions.py",
    "docs/programme-interactions.md",
    "model/compute_programme_cli.py",
    "model/portable.py",
    "operator/programmes.py",
    "operator/web/programmes.mjs",
    "install_programmes.py",
    "operator/web/native-interactions.mjs",
    "PROGRAMME_INTERACTIONS.md",
    "install_programme_interactions.py",
    "docs/PARAMETER_CASE_CONSOLE.md",
    "docs/PROGRAMME_CASE_CONSOLE.md",
    "docs/PROGRAMME_LARGE_DESIGNS.md",
    "model/delivery_catalogue.py",
    "model/parameter_case_status.py",
    "model/programme_case_status.py",
    "model/programme_views.py",
    "model/record_catalog.py",
    "operator/web/parameter_case_console.mjs",
    "model/programme_source_updates.py",
    "model/PROGRAMME_SOURCE_UPDATES.md",
    "operator/programme_source_updates.py",
    "operator/extensions/programme-source-updates.json",
    "operator/web/programme_source_updates.mjs",
    "operator/programme_source_updates_patch.json",
    "operator/install_programme_source_updates.py",
    "operator/PROGRAMME_SOURCE_UPDATES.md",
    "integration/component_fragments/programme-source-updates.json",
    "integration/component_fragments/geographic-programme.json",
    "model/native_study.py",
    "model/fgdc_metadata.py",
    "model/programme_reuse.py",
    "model/native_execution.py",
    "docs/native-interactions.md",
    "model/interaction_dispatch.py",
    "model/native_interactions.py",
    "model/native_interactions_cli.py",
    "operator/NATIVE_INTERACTIONS.md",
    "operator/extensions/native-interactions.json",
    "operator/install_native_interactions.py",
    "operator/native_interactions.py",
    "operator/web/native-interactions.css",
    "model/PROGRAMME_NATIVE_REUSE.md",
    "operator/programme_native_reuse_patch.json",
    "operator/install_programme_reuse.py",
    "integration/component_fragments/programme-native-reuse.json",
    "source_tools/continue_programme_source_reuse.py",
    "source_tools/PROGRAMME_SOURCE_REUSE_COURSE.md",
    "model/geographic_study_transfer.py",
    "model/GEOGRAPHIC_STUDY_TRANSFER.md",
    "source_tools/geographic_scenario_context.py",
    "source_tools/geographic_scenario_interpretation.mjs",
    "source_tools/geographic_headwaters_reopen.py",
    "source_tools/receive_geographic_headwaters.py",
    "integration/component_fragments/geographic-study-transfer.json",
    "model/geographic_siting_contrasts.py",
    "model/GEOGRAPHIC_SITING_CONTRASTS.md",
    "source_tools/high_quality_water_preparation.py",
    "source_tools/nlcd_range_preparation.py",
    "source_tools/nlcd_remote_window.py",
    "source_tools/nlcd_static.py",
    "source_tools/nlcd_wcs.py",
    "source_tools/raster_sources.py",
    "source_tools/source_transfer.py",
    "model/geographic_scenario_contrasts.py",
    "model/GEOGRAPHIC_PHYSICAL_CONTRASTS.md",
    "model/geographic_utility_groups.py",
    "operator/geographic_preparation.py",
    "operator/extensions/geographic-headwaters.json",
    "operator/web/geographic_workbench.mjs",
    "operator/web/geographic_workbench.css",
    "operator/web/geographic_allocation.mjs",
    "operator/GEOGRAPHIC_HEADWATERS.md",
    "integration/component_fragments/geographic-operator.json",
    "operator/source_preparation.py",
    "operator/extensions/source-preparation.json",
    "operator/web/source_workbench.mjs",
    "operator/web/source_workbench.css",
    "model/geographic_scenario_allocation.py",
    "model/geographic_scenario_allocation_report.py",
    "model/GEOGRAPHIC_SCENARIO_ALLOCATION.md",
    "model/geographic_receiving_context.py",
    "model/GEOGRAPHIC_RECEIVING_CONTEXT.md",
    "integration/component_fragments/geographic-receiving-context.json",
    "model/geographic_headwaters.py",
    "source/receptor-profiles/utility-focus-20261012.json",
    "source/water_context/20261012/public-water/receiving-waters.public-spec.json",
    "source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json",
    "source_tools/geographic_matched_control.py",
    "source_tools/regional_matched_control.py",
    "source_tools/precipitation_matching.py",
    "source_tools/headwaters_parameter_course.py",
    "model/ensembles.py",
    "model/ensemble_operations.py",
    "model/ensemble_report.py",
    "source/simulated_headwaters_20261013/PARAMETER_COURSE.md",
    "CURRENT_OWNER_DIRECTION.md",
    "model/scenario_footprint.py",
    "model/receiving_water_accounting.py",
    "model/receiving_waters.py",
    "model/receiving_water_report_source.py",
    "model/rasters.py",
    "model/reuse.py",
    "model/profiles.py",
    "model/source_refresh_report_transfer.py",
    "model/source_refresh_report_source.py",
    "model/source_refresh_receiving.py",
    "model/source_refresh.py",
    "model/source_refresh_legacy.py",
    "model/source_refresh_compat.py",
    "model/observed_landcover_study_transfer.py",
    "model/observed_landcover_local_copy.py",
    "integration/component_fragments/study-source-lineage-dependencies.json",
    "model/source_refresh_comparison.py",
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
    "model/climate_management_working.py",
    "model/climate_management_working_comparison.py",
    "model/climate_management_working_comparison_transfer.py",
    "model/climate_management_working_transfer.py",
    "operator/CLIMATE_MANAGEMENT_DESIGN_COMPARISON.md",
    "operator/CLIMATE_MANAGEMENT_WORKING.md",
    "operator/web/climate_management_working.mjs",
    "operator/web/climate_management_working_comparison.mjs",
    "source_tools/CLIMATE_MANAGEMENT_RECEIVING.md",
    "source_tools/climate_management_browser_support.py",
    "source_tools/climate_management_working.py",
    "source_tools/compose.py",
    "source_tools/receive_climate_management.py",
    "source_tools/receive_climate_management_browser.mjs",
    "model/joint_delivery.py",
    "operator/joint_delivery.py",
    "source/joint-delivery/20261013/profile.json",
    "operator/web/joint_delivery.mjs",
    "operator/web/joint_delivery.css",
    "operator/extensions/joint-delivery.json",
    "source_tools/receive_joint_delivery.py",
    "source_tools/receive_joint_delivery_browser.mjs",
    "JOINT_DELIVERY.md",
    "integration/component_fragments/joint-delivery.json",
    "operator/web/conservation_working.mjs",
    "operator/web/conservation_working_view.mjs",
    "operator/CONSERVATION_WORKING_FILES.md",
    "integration/component_fragments/conservation-working-files.json",
    "model/conservation_joint_choices.py",
    "operator/web/conservation_joint_choices.mjs",
    "CONSERVATION_JOINT_CHOICES.md",
    "integration/component_fragments/conservation-joint-choices.json",
    "CONSERVATION_DECISION_METHODS.md",
    "ecsa_runs/upstate.py",
    "integration/component_fragments/calibration-native-catchments.json",
    "integration/component_fragments/calibration-parameter-continuation.json",
    "integration/component_fragments/calibration-profile-history.json",
    "integration/component_fragments/calibration-reference-followup.json",
    "integration/component_fragments/calibration-studies.json",
    "integration/component_fragments/climate-forcing.json",
    "integration/component_fragments/climate-management.json",
    "integration/component_fragments/conservation-scientific-report-source.json",
    "integration/component_fragments/headwaters-input-interpretation.json",
    "integration/component_fragments/headwaters-native-interpretation.json",
    "integration/component_fragments/parameter-working.json",
    "integration/conservation_report_map_composition.json",
    "integration/conservation_report_operator_composition.json",
    "model/CALIBRATION.md",
    "model/CALIBRATION_CATCHMENTS.md",
    "model/CALIBRATION_FOLLOWUP.md",
    "model/CALIBRATION_HISTORY.md",
    "model/CALIBRATION_MAPS.md",
    "model/CALIBRATION_REPORT_SOURCE.md",
    "model/CALIBRATION_REVIEW.md",
    "model/CALIBRATION_STUDIES.md",
    "model/CALIBRATION_UNCERTAINTY.md",
    "model/CONSERVATION_REPORT_MAPS.md",
    "model/CONSERVATION_REPORT_SOURCE.md",
    "model/calibration.py",
    "model/calibration_catchments.py",
    "model/calibration_execution.py",
    "model/calibration_followup.py",
    "model/calibration_history.py",
    "model/calibration_history_export.py",
    "model/calibration_maps.py",
    "model/calibration_native_study_transfer.py",
    "model/calibration_report_source.py",
    "model/calibration_review.py",
    "model/calibration_study_receiving.py",
    "model/calibration_uncertainty.py",
    "model/climate_forcing.py",
    "model/climate_forcing_study_transfer.py",
    "model/climate_management.py",
    "model/climate_management_figures.py",
    "model/climate_management_study_transfer.py",
    "model/climate_working.py",
    "model/climate_working_transfer.py",
    "model/conservation.py",
    "model/conservation_decision_geography.py",
    "model/conservation_families.py",
    "model/conservation_optimization.py",
    "model/conservation_report_maps.py",
    "model/conservation_report_source.py",
    "model/conservation_report_source_cli.py",
    "model/conservation_reporting.py",
    "model/conservation_sampling_evidence.py",
    "model/experiment_profiles.py",
    "model/forcing_sources.py",
    "model/joint_parameter_analysis.py",
    "model/joint_parameter_studies.py",
    "model/joint_parameter_study_transfer.py",
    "model/keowee_priority.py",
    "model/management_case_study_transfer.py",
    "model/management_cases.py",
    "model/native_worker.py",
    "model/parameter_calibration.py",
    "model/parameter_report_source.py",
    "model/parameter_studies.py",
    "model/parameter_study_receiving.py",
    "model/parameter_study_transfer.py",
    "model/parameter_working.py",
    "model/parameter_working_transfer.py",
    "model/portable_parameter_studies.py",
    "model/portfolios.py",
    "model/source_lineage.py",
    "operator/CALIBRATION.md",
    "operator/CALIBRATION_DESIGN.md",
    "operator/CLIMATE_FORCING.md",
    "operator/CLIMATE_FORCING_STUDY_DELIVERY.md",
    "operator/CLIMATE_MANAGEMENT.md",
    "operator/CLIMATE_WORKING.md",
    "operator/PARAMETER_STUDY_CALIBRATION.md",
    "operator/PARAMETER_WORKING.md",
    "operator/calibration.py",
    "operator/calibration_design_patch.json",
    "operator/climate_forcing.py",
    "operator/climate_management.py",
    "operator/conservation.py",
    "operator/extensions/calibration.json",
    "operator/extensions/climate-forcing.json",
    "operator/extensions/climate-management.json",
    "operator/extensions/conservation.json",
    "operator/extensions/joint-parameter-studies.json",
    "operator/install_calibration.py",
    "operator/install_calibration_design.py",
    "operator/joint_parameter_operator.py",
    "operator/native_jobs.py",
    "operator/parameter_receiving.py",
    "operator/parameter_study_api.py",
    "operator/web/calibration.css",
    "operator/web/calibration.mjs",
    "operator/web/calibration_catchments.mjs",
    "operator/web/calibration_design.mjs",
    "operator/web/calibration_history.mjs",
    "operator/web/calibration_maps.mjs",
    "operator/web/calibration_received_studies.mjs",
    "operator/web/calibration_review.mjs",
    "operator/web/climate_forcing.css",
    "operator/web/climate_forcing.mjs",
    "operator/web/climate_management.css",
    "operator/web/climate_management.mjs",
    "operator/web/climate_management_explorer.mjs",
    "operator/web/climate_working.mjs",
    "operator/web/joint_parameter_studies.css",
    "operator/web/joint_parameter_studies.mjs",
    "operator/web/parameter_received_studies.mjs",
    "operator/web/parameter_studies.css",
    "operator/web/parameter_studies.mjs",
    "operator/web/parameter_working.mjs",
    "source/calibration-design/upper-savannah-reference-support.json",
    "source/usgs-southeast-sparrow-2012/CANDIDATE_COURSE.md",
    "source_tools/CLIMATE_FORCING_PERIODS.md",
    "source_tools/calibration_assembly.py",
    "source_tools/climate_forcing_study.py",
    "source_tools/climate_working.py",
    "source_tools/sparrow_candidate_course.py",
    "model/monitoring_native_observations.py",
    "model/monitoring_concentration_report.py",
    "operator/web/monitoring-native-context.mjs",
    "operator/web/monitoring-native-context.css",
    "source/NATIVE_OBSERVATIONS_SAMPLING.md",
    "source_tools/sampling_native_observation_receiving.py",
    "source_tools/selections/sampling_sv833_20261013.json",
    "integration/component_fragments/monitoring-native-observations.json",
    "model/MONITORING.md",
    "model/MONITORING_FIELDWORK.md",
    "model/MONITORING_OBSERVED_CONTEXT.md",
    "model/implementation.py",
    "model/implementation_reporting.py",
    "model/implementation_schema.py",
    "model/monitoring_actions.py",
    "model/monitoring_campaign.py",
    "model/monitoring_cli.py",
    "model/monitoring_design.py",
    "model/monitoring_field_return.py",
    "model/monitoring_implementation.py",
    "model/monitoring_network.py",
    "model/monitoring_report_source.py",
    "model/monitoring_sources.py",
    "model/monitoring_workspace.py",
    "model/receiving_water_monitoring.py",
    "model/requirements-monitoring.txt",
    "model/utility_microbial_study.py",
    "model/utility_monitoring.py",
    "model/utility_monitoring_comparison.py",
    "model/utility_monitoring_report.py",
    "operator/MONITORING_API.md",
    "operator/extensions/monitoring.json",
    "operator/monitoring.py",
    "operator/monitoring_native.py",
    "operator/monitoring_receiving.py",
    "operator/static/monitoring.js",
    "operator/web/monitoring-component.mjs",
    "operator/web/monitoring-field-selection.mjs",
    "operator/web/monitoring-frontiers.css",
    "operator/web/monitoring-frontiers.mjs",
    "operator/web/monitoring-observed.mjs",
    "operator/web/monitoring-report.mjs",
    "operator/web/monitoring-study-transfer.mjs",
    "operator/web/monitoring.css",
    "operator/web/monitoring.mjs",
    "operator/web/monitoring_field_return.mjs",
    "operator/web/monitoring_fieldwork.mjs",
    "source_tools/demo_deadline.py",
    "source_tools/simulated_headwaters_receiving.py",
    "model/monitoring_native_evidence.py",
    "model/monitoring_evidence_report.py",
    "model/monitoring_recommendations.py",
    "model/monitoring_common.py",
    "model/monitoring_observed_context.py",
    "model/monitoring_packet.py",
    "model/MONITORING_RECOMMENDATIONS.md",
    "source/SAMPLING_NATIVE_EVIDENCE.md",
    "operator/monitoring_recommendations.py",
    "operator/extensions/monitoring-recommendations.json",
    "operator/web/monitoring_recommendations.mjs",
    "operator/web/monitoring_recommendations.css",
    "operator/SAMPLING_PRIORITIES.md",
    "source_tools/receive_sampling_recommendations.py",
    "integration/component_fragments/monitoring-recommendations.json",
    "integration/component_fragments/monitoring-native-evidence.json",
    "model/common.py",
    "model/workspace.py",
    "source/observed-report-20261013/RECEIVING.md",
    "source/observed-report-20261013/RECEIVING_COURSE.md",
    "checks/terrain_conditioning_course.py",
    "operator/web/source_reports.css",
    "operator/web/scientific_source_reader.mjs",
    "operator/web/published_original_reports.mjs",
    "operator/web/published_studies.css",
    "operator/web/scientific_synthesis.mjs",
    "operator/web/scientific_synthesis_core.mjs",
    "operator/web/scientific_synthesis.css",
    "operator/server.py",
    "operator/extension_registry.py",
    "operator/source_reports.py",
    "operator/source_archive_ingress.py",
    "operator/scientific_synthesis.py",
    "operator/scientific_source_reader.py",
    "model/scientific_briefing.py",
    "model/observed_context.py",
    "model/scientific_report_review.py",
    "model/scientific_synthesis.py",
    "model/scientific_synthesis_catalog.py",
    "integration/component_fragments/terrain-conditioning-report-source.json",
    "integration/component_fragments/terrain-conditioning.json",
    "integration/component_fragments/terrain-report-receiving.json",
    "integration/component_fragments/terrain-study-transfer.json",
    "model/terrain_conditioning_report_cli.py",
    "model/terrain_conditioning_report_source.py",
    "model/terrain_conditioning_scientific_report.py",
    "model/terrain_conditioning_study_transfer.py",
    "operator/TERRAIN_SCIENTIFIC_SOURCE.md",
    "operator/extensions/terrain-conditioning.json",
    "operator/terrain_conditioning_native.py",
    "operator/web/terrain_conditioning.css",
    "operator/web/terrain_conditioning.mjs",
    "source/TERRAIN_STUDY_TRANSFER.md",
    "source/observed-report-20261013/assessment_browser.mjs",
    "source/observed-report-20261013/receive_browser.mjs",
    "source/observed-report-20261013/receive_course.py",
    "source/observed-report-20261013/receive_operator.py",
    "source_tools/TERRAIN_CONDITIONING.md",
    "source_tools/TERRAIN_REPORT_RECEIVING.md",
    "source_tools/terrain_conditioning.py",
    "source_tools/terrain_conditioning_report.py",
    "source_tools/terrain_conditioning_response.py",
    "source_tools/terrain_flood.cpp",
    "source_tools/terrain_prepare.py",
    "source_tools/terrain_report_browser.mjs",
    "source_tools/terrain_report_receiving.py",
    "operator/delivery_preparation_receiving.mjs",
    "operator/web/delivery_preparation_storage.mjs",
    "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
    "operator/multivariate_control_operator.py",
    "operator/web/multivariate_control_core.mjs",
    "model/multivariate_control_study_transfer.py",
    "operator/web/multivariate_control.css",
    "model/multivariate_control_report.py",
    "model/multivariate_control_design.py",
    "model/multivariate_control_cli.py",
    "operator/web/multivariate_control.mjs",
    "integration/component_fragments/multivariate-control.json",
    "integration/component_fragments/multivariate-control-study-transfer.json",
    "source_tools/MULTIVARIATE_CONTROL_RECEIVING.md",
    "operator/MULTIVARIATE_CONTROL.md",
    "model/multivariate_control.py",
    "source/MULTIVARIATE_CONTROLS.md",
    "integration/component_fragments/multivariate-control-receiving.json",
    "source_tools/multivariate_control_browser.mjs",
    "source_tools/multivariate_control_receiving.py",
    "operator/extensions/multivariate-control.json",
    "model/multivariate_control_outcomes.py",
    "model/multivariate_control_outcome_analysis.py",
    "model/multivariate_control_outcome_report.py",
    "model/multivariate_control_outcome_transfer.py",
    "model/multivariate_control_outcomes_cli.py",
    "source/MULTIVARIATE_CONTROL_OUTCOMES.md",
    "integration/component_fragments/multivariate-control-outcomes.json",
    "operator/multivariate_control_outcomes_operator.py",
    "operator/extensions/multivariate-control-outcomes.json",
    "operator/web/multivariate_control_outcomes_core.mjs",
    "operator/web/multivariate_control_outcomes.mjs",
    "operator/MULTIVARIATE_CONTROL_OUTCOMES.md",
    "integration/component_fragments/multivariate-control-outcome-desk.json",
    "model/experiments.py",
    "model/scientific_report.py",
    "source_tools/geographic_programme_browser.mjs",
    "source_tools/receive_geographic_handover_browser.mjs",
    "source_tools/geographic_review_browser.mjs",
    "source_tools/geographic_browser_course.mjs",
    "source_tools/geographic_allocation_browser.mjs",
    "docs/GEOGRAPHIC_HANDOVER_BROWSER.md",
    "integration/component_fragments/geographic-handover-browser.json",
    "model/paired_ensemble/ensemble_portable.py",
    "integration/component_fragments/geographic-study-receiving.json",
    "model/geographic_study_receiving.py",
    "operator/geographic_receiving.py",
    "operator/web/geographic_received_studies.mjs",
    "model/GEOGRAPHIC_STUDY_RECEIVING.md",
    "source_tools/geographic_headwaters_handover.py",
    "source_tools/simulated_headwaters_handover.py",
    "model/geographic_programme.py",
    "source_tools/adopt_geographic_headwaters_programme.py",
    "source_tools/GEOGRAPHIC_PROGRAMME.md",
    "operator/extensions/programme-activity.json",
    "operator/programme_activity.py",
    "model/compute_programme.py",
    "model/programme_interactions.py",
    "docs/programme-interactions.md",
    "model/compute_programme_cli.py",
    "model/portable.py",
    "operator/programmes.py",
    "operator/web/programmes.mjs",
    "install_programmes.py",
    "operator/web/native-interactions.mjs",
    "PROGRAMME_INTERACTIONS.md",
    "install_programme_interactions.py",
    "docs/PARAMETER_CASE_CONSOLE.md",
    "docs/PROGRAMME_CASE_CONSOLE.md",
    "docs/PROGRAMME_LARGE_DESIGNS.md",
    "model/delivery_catalogue.py",
    "model/parameter_case_status.py",
    "model/programme_case_status.py",
    "model/programme_views.py",
    "model/record_catalog.py",
    "operator/web/parameter_case_console.mjs",
    "model/programme_source_updates.py",
    "model/PROGRAMME_SOURCE_UPDATES.md",
    "operator/programme_source_updates.py",
    "operator/extensions/programme-source-updates.json",
    "operator/web/programme_source_updates.mjs",
    "operator/programme_source_updates_patch.json",
    "operator/install_programme_source_updates.py",
    "operator/PROGRAMME_SOURCE_UPDATES.md",
    "integration/component_fragments/programme-source-updates.json",
    "integration/component_fragments/geographic-programme.json",
    "model/native_study.py",
    "model/fgdc_metadata.py",
    "model/programme_reuse.py",
    "model/native_execution.py",
    "docs/native-interactions.md",
    "model/interaction_dispatch.py",
    "model/native_interactions.py",
    "model/native_interactions_cli.py",
    "operator/NATIVE_INTERACTIONS.md",
    "operator/extensions/native-interactions.json",
    "operator/install_native_interactions.py",
    "operator/native_interactions.py",
    "operator/web/native-interactions.css",
    "model/PROGRAMME_NATIVE_REUSE.md",
    "operator/programme_native_reuse_patch.json",
    "operator/install_programme_reuse.py",
    "integration/component_fragments/programme-native-reuse.json",
    "source_tools/continue_programme_source_reuse.py",
    "source_tools/PROGRAMME_SOURCE_REUSE_COURSE.md",
    "model/geographic_study_transfer.py",
    "model/GEOGRAPHIC_STUDY_TRANSFER.md",
    "source_tools/geographic_scenario_context.py",
    "source_tools/geographic_scenario_interpretation.mjs",
    "source_tools/geographic_headwaters_reopen.py",
    "source_tools/receive_geographic_headwaters.py",
    "integration/component_fragments/geographic-study-transfer.json",
    "model/geographic_siting_contrasts.py",
    "model/GEOGRAPHIC_SITING_CONTRASTS.md",
    "source_tools/high_quality_water_preparation.py",
    "source_tools/nlcd_range_preparation.py",
    "source_tools/nlcd_remote_window.py",
    "source_tools/nlcd_static.py",
    "source_tools/nlcd_wcs.py",
    "source_tools/raster_sources.py",
    "source_tools/source_transfer.py",
    "model/geographic_scenario_contrasts.py",
    "model/GEOGRAPHIC_PHYSICAL_CONTRASTS.md",
    "model/geographic_utility_groups.py",
    "operator/geographic_preparation.py",
    "operator/extensions/geographic-headwaters.json",
    "operator/web/geographic_workbench.mjs",
    "operator/web/geographic_workbench.css",
    "operator/web/geographic_allocation.mjs",
    "operator/GEOGRAPHIC_HEADWATERS.md",
    "integration/component_fragments/geographic-operator.json",
    "operator/source_preparation.py",
    "operator/extensions/source-preparation.json",
    "operator/web/source_workbench.mjs",
    "operator/web/source_workbench.css",
    "model/geographic_scenario_allocation.py",
    "model/geographic_scenario_allocation_report.py",
    "model/GEOGRAPHIC_SCENARIO_ALLOCATION.md",
    "model/geographic_receiving_context.py",
    "model/GEOGRAPHIC_RECEIVING_CONTEXT.md",
    "integration/component_fragments/geographic-receiving-context.json",
    "model/geographic_headwaters.py",
    "source/receptor-profiles/utility-focus-20261012.json",
    "source/water_context/20261012/public-water/receiving-waters.public-spec.json",
    "source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json",
    "source_tools/geographic_matched_control.py",
    "source_tools/regional_matched_control.py",
    "source_tools/precipitation_matching.py",
    "source_tools/headwaters_parameter_course.py",
    "model/ensembles.py",
    "model/ensemble_operations.py",
    "model/ensemble_report.py",
    "source/simulated_headwaters_20261013/PARAMETER_COURSE.md",
    "CURRENT_OWNER_DIRECTION.md",
    "model/scenario_footprint.py",
    "model/receiving_water_accounting.py",
    "model/receiving_waters.py",
    "model/receiving_water_report_source.py",
    "model/rasters.py",
    "model/reuse.py",
    "model/profiles.py",
    "model/source_refresh_report_transfer.py",
    "model/source_refresh_report_source.py",
    "model/source_refresh_receiving.py",
    "model/source_refresh.py",
    "model/source_refresh_legacy.py",
    "model/source_refresh_compat.py",
    "model/observed_landcover_study_transfer.py",
    "model/observed_landcover_local_copy.py",
    "integration/component_fragments/study-source-lineage-dependencies.json",
    "model/source_refresh_comparison.py",
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

# Optional whole-workbench receiving closure; the original REQUIRED set stays unchanged.
STARTUP_GUIDE_FILES = frozenset({
    "operator/web/startup_guide.mjs",
    "operator/web/startup_guide.css",
    "operator/STARTUP_GUIDE.md",
    "operator/web/index.html",
    "operator/README.md",
    "source_tools/Open_Workbench.sh",
    "source_tools/Open_Workbench_WSL.cmd",
    "source_tools/open_workbench_wsl.sh",
    "source_tools/open_windows_browser.py",
    "source_tools/prepare_recipient_opening.py",
    "source_tools/WORKBENCH_OPENING_RECEIVING.md",
    "integration/component_fragments/workbench-startup-guide.json",
    "source_tools/open_received_study.py",
    "source_tools/workbench_session.py",
    "source_tools/OPEN_RECEIVED_WORKBENCH.md",
    "tests/test_workbench_session.py",
    "integration/component_fragments/recipient-workbench-opening.json",
    "source_tools/native_runtime/invocation.py",
    "source_tools/NATIVE_INVOCATION.md",
    "integration/component_fragments/native-runtime-invocation.json",
    "source_tools/native_runtime/__init__.py",
    "source_tools/native_runtime/__main__.py",
    "source_tools/native_runtime/capsule.py",
    "source_tools/native_runtime/probe.py",
    "source_tools/native_runtime/transport.py",
    "source_tools/NATIVE_RUNTIME.md",
    "tests/test_native_runtime_workflows.py",
    "integration/component_fragments/native-runtime-capsule.json",
})
ALLOWED = ALLOWED | STARTUP_GUIDE_FILES | frozenset({
    "operator/CONSERVATION_REPORT_PRESENTATION.md",
    "model/windows_fs.py",
    "model/verified_files.py",
    "model/parameter_views.py",
    "model/paired_ensemble/ensemble_store.py",
    "model/client_source_recipe_portable.py",
    # Optional original-source intake and readable inspection receiving.
    "model/client_source_files.py",
    "model/client_source_inspection_report.py",
    "operator/client_source_intake.py",
    "operator/extensions/client-source-intake.json",
    "operator/web/client_source_intake.mjs",
    "operator/web/client_source_intake.css",
    "operator/web/scientific_inspection.mjs",
    "operator/web/source_inspection_summary.mjs",
    "operator/extensions/scientific-inspection.json",
    "operator/CLIENT_SOURCE_INTAKE.md",
    "source_tools/CLIENT_SOURCE_INSPECTION_REPORT.md",
})

# Optional Sampling field protocol and maintained API client; REQUIRED was calculated above.
ALLOWED = ALLOWED | frozenset({
    "model/monitoring_sampling_protocol.py",
    "model/field_deployment.py",
    "integration/SAMPLING_FIELDWORK_HANDOVER.md",
    "integration/component_fragments/sampling-field-protocol.json",
    "operator/workbench_client.py",
    "operator/WORKBENCH_API.md",
    "operator/workbench_api.py",
    "operator/extensions/workbench-api.json",
})

# Optional primary native Windows opener; REQUIRED was calculated above.
ALLOWED = ALLOWED | frozenset({
    "source_tools/Open_Workbench.cmd",
    "source_tools/open_workbench_windows.py",
})

# Optional maintained Implementation receiving; REQUIRED remains unchanged.
ALLOWED = ALLOWED | frozenset({
    "source_tools/receive_implementation.py",
    "source_tools/receive_monitoring_fieldwork.py",
    "model/project_transfer.py",
    "model/project_transfer_workspace.py",
    "model/portable_databases.py",
})

# Optional authenticated HTTPS origin and browser transport; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "operator/origin_policy.py",
    "integration/component_fragments/workbench-advertised-origin.json",
    "integration/WORKBENCH_HTTPS_ORIGIN.md",
    "operator/web/style.css",
    "operator/web/community_report_handover.mjs",
    "operator/web/scenario_input_review.mjs",
    "source_tools/receive_native_runtime.py",
    "model/retained_download.py",
    "source_tools/receive_sampling_additions.py",
    "operator/web/remote_transport.mjs",
    "operator/extensions/remote-transport.json",
    "integration/component_fragments/remote-browser-transport.json",
    "integration/REMOTE_BROWSER_TRANSPORT.md",
})


# Optional rescued complete Measurements source; REQUIRED remains unchanged.
ALLOWED = ALLOWED | frozenset({
    "MEASUREMENT_LARGE_FILES_SOURCE.json",
    "install_measurement_large_files.py",
    "integration/component_fragments/measurement-chemistry.json",
    "integration/component_fragments/temporal-analysis.json",
    "integration/measurements/INSTALLATION.json",
    "measurement_workspace/NATIVE_OBSERVATION_SELECTION.md",
    "measurement_workspace/RUNTIME.md",
    "measurement_workspace/TEMPORAL_ANALYSIS.md",
    "measurement_workspace/TEMPORAL_COMPARISON.md",
    "measurement_workspace/WINDOWS_FILE_WORKFLOW.md",
    "measurement_workspace/WINDOWS_LONG_PATH_SUCCESSOR.md",
    "measurement_workspace/engine/chiques_nutrient_cli.mjs",
    "measurement_workspace/engine/eco_handover.mjs",
    "measurement_workspace/engine/file_platform.mjs",
    "measurement_workspace/engine/file_platform.py",
    "measurement_workspace/engine/file_product.mjs",
    "measurement_workspace/engine/handover_archive.py",
    "measurement_workspace/engine/intake-comparison-receiving.mjs",
    "measurement_workspace/engine/large_archive.py",
    "measurement_workspace/install_platform.py",
    "measurement_workspace/node_runtime.py",
    "measurement_workspace/operator.py",
    "measurement_workspace/temporal_analysis.py",
    "measurement_workspace/temporal_comparison.py",
    "measurement_workspace/temporal_report.html",
    "measurement_workspace/temporal_transfer.py",
    "measurement_workspace/temporal_workspace.py",
    "operator/MEASUREMENTS_INSTALLATION.md",
    "operator/extensions/temporal-analysis.json",
    "operator/install_measurements.py",
    "operator/temporal_analysis_provider.py",
    "operator/web/measured_native_observations.mjs",
    "operator/web/measured_observations_extension.mjs",
    "operator/web/temporal_analysis.css",
    "operator/web/temporal_analysis.mjs",
    "operator/web/temporal_comparison.mjs",
    "source_tools/exercise_temporal_comparison.py",
})

# Optional original Intelligence source and maintained staged API transport; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "eco_intelligence/upstate.py",
    "operator/web/investigations.mjs",
    "model/staged_transport.py",
})

# Optional original saved-source receiving course; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "source_tools/receive_saved_source_reference.py",
    "source_tools/SAVED_SOURCE_REFERENCE_RECEIVING.md",
})

# Optional original native HTTPS connector family; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "source_tools/eco_native_connector.py",
    "integration/NATIVE_HTTPS_CONNECTOR.md",
    "integration/component_fragments/native-https-connector.json",
})

# Optional original Sampling design comparison family; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "model/monitoring_sampling_comparison.py",
    "operator/web/monitoring_sampling_comparison.mjs",
    "integration/component_fragments/sampling-design-comparison.json",
})

# Optional original configured HTTPS opening; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "source_tools/workbench_transport.py",
    "integration/WORKBENCH_HTTPS_OPENING.md",
    "integration/component_fragments/workbench-https-opening.json",
})

# Optional original Intelligence catalogue and component tooling; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "science_catalog_delivery.py",
    "SCIENTIFIC_CATALOG.md",
    "requirements-intelligence.txt",
    "install_intelligence.py",
})

# Optional original Disturbance report and comparison desk; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "model/disturbance_report.html",
    "operator/web/disturbance_studies.mjs",
    "operator/web/disturbance_studies.css",
})

# Optional original Assistant question and selected-Study Windows source.
ALLOWED = ALLOWED | frozenset({
    "operator/intelligence_diagnostic_entry.py",
    "eco_intelligence/study_transfer.py",
})

# Optional original observed-report renderer; REQUIRED stays unchanged.
ALLOWED = ALLOWED | frozenset({
    "model/observed_report_render.py",
})

# Optional original Assistant focused-source and provider delivery paths.
ALLOWED = ALLOWED | frozenset({
    "eco_intelligence/provider.py",
    "eco_intelligence/schemas.py",
    "eco_intelligence/engine.py",
    "operator/intelligence.py",
    "eco_intelligence/report.py",
})

# Current own-data table, source-lineage and Assistant source readers.
ALLOWED = ALLOWED | frozenset({
    "eco_intelligence/profiling.py",
    "measurement_workspace/engine/parse.mjs",
    "measurement_workspace/engine/source_handback_core.mjs",
    "measurement_workspace/engine/source_lineage.mjs",
    "measurement_workspace/engine/stream_csv.mjs",
    "model/client_measurement_sources.py",
    "operator/WORKBOOK_MEASUREMENTS.md",
    "operator/client_measurement_sources.py",
    "operator/web/client_measurement_sources.mjs",
    "source_tools/receive_workbook_measurements.mjs",
})

# Complete selected own-data source interpretation and receiving leaves.
ALLOWED = ALLOWED | frozenset({
    "measurement_workspace/engine/benchmark_workspace.mjs",
    "measurement_workspace/engine/chiques_nutrient_workspace.mjs",
    "measurement_workspace/engine/chiques_nutrients.mjs",
    "measurement_workspace/engine/collections.mjs",
    "measurement_workspace/engine/intake.mjs",
    "measurement_workspace/engine/intake_comparison.mjs",
    "measurement_workspace/engine/large_delivery.mjs",
    "measurement_workspace/engine/large_intake.mjs",
    "measurement_workspace/engine/native_observations.mjs",
    "measurement_workspace/engine/normalise.mjs",
    "measurement_workspace/engine/sediment_workspace.mjs",
    "measurement_workspace/engine/source_handback.mjs",
    "measurement_workspace/engine/source_workbook_returns.mjs",
    "measurement_workspace/engine/workspace.mjs",
    "measurement_workspace/web/intake.mjs",
})

# Complete selected own-data source interpretation and receiving leaves.
ALLOWED = ALLOWED | frozenset({
    "checks/client_source_mapping_check.mjs",
    "operator/web/client_source_mapping.mjs",
})

# Complete selected own-data source interpretation and receiving leaves.
ALLOWED = ALLOWED | frozenset({
    "install_intelligence_operator.py",
    "model/scenario_mask_sources.py",
    "operator/INPUT_LINEAGE.md",
    "operator/extensions/investigations.json",
    "operator/intelligence_lineage.py",
    "operator/science_catalog.py",
    "operator/web/investigation_lineage.mjs",
    "receiving/eco_intelligence/receive_input_lineage.mjs",
    "receiving/eco_intelligence/receive_input_lineage.py",
})

# Complete selected own-data source interpretation and receiving leaves.
ALLOWED = ALLOWED | frozenset({
    "operator/web/profile_workbench.css",
    "operator/web/profile_workbench.mjs",
})

# Approved native platform and complete original-table source cohorts.
# Optional admission only; REQUIRED and all source/preimage checks remain unchanged.
ALLOWED = ALLOWED | frozenset({
    "integration/component_fragments/native-helpers.json",
    "integration/component_fragments/original-table-explorer.json",
    "model/client_source_rows.py",
    "model/macos_process.py",
    "model/native_supervision.py",
    "model/portable_fs.py",
    "model/windows_process.py",
    "operator/web/client_source_rows.mjs",
    "source_tools/NATIVE_HELPERS.md",
    "source_tools/build_bootstrap_payloads.py",
    "source_tools/matched_control_exact.py",
    "source_tools/native_helpers.py",
    "source_tools/native_runtime/macos_bundle.py",
    "source_tools/native_runtime/platform_runtime.py",
    "source_tools/receiving_process.py",
    "source_tools/runtime_platform.py",
    "integration/component_fragments/native-payload-completion.json",
    "model/portable_reopening.py",
    "source_tools/NATIVE_PAYLOAD_COMPLETION.md",
    "source_tools/native_runtime/binary_dependencies.py",
    "source_tools/native_runtime/payload_closure.py",
})

# Complete published collection opening, runtime receiving and helper producer.
ALLOWED = ALLOWED | frozenset({
    "checks/received_runtime_portability.py",
    "docs/NATIVE_RUNTIME_RECEIVING.md",
    "integration/component_fragments/native-helper-producer.json",
    "source_tools/NATIVE_HELPER_PRODUCER.md",
    "source_tools/build_native_helper_bundle.py",
    "source_tools/collection_opening/OPEN.sh",
    "source_tools/collection_opening/OPENING_COMPONENT.json",
    "source_tools/collection_opening/Open_Native_Collection.sh",
    "source_tools/collection_opening/Open_Workbench.cmd",
    "source_tools/collection_opening/Open_Workbench.command",
    "source_tools/collection_opening/Open_Workbench.ps1",
    "source_tools/collection_opening/README.md",
    "source_tools/collection_opening/apply_to_collection.py",
    "source_tools/collection_opening/open_collection.py",
    "source_tools/collection_opening/open_native_collection.py",
    "source_tools/collection_opening/prepare_runtime_dependencies.py",
})

# Complete storage, original-object and final native-runtime integration sources.
ALLOWED = ALLOWED | frozenset({
    "integration/apply_supervisor_recovery.py",
    "source_tools/NATIVE_RUNTIME_PORTABILITY.md",
    "source_tools/apply_macos_worker_port.py",
    "source_tools/original_object_io.py",
    "source_tools/original_object_windows.py",
    "source_tools/private_capability.py",
    "tests/test_native_runtime_platforms.py",
})

# Complete stale-address recovery and portable opening help cohort.
ALLOWED = ALLOWED | frozenset({
    "operator/workbench_links.py",
    "operator/web/workbench_links.mjs",
    "operator/web/workbench_links.css",
    "operator/web/workbench_recovery_sw.mjs",
    "operator/web/workbench_reopen.html",
    "WORKBENCH_LINKS.md",
    "integration/component_fragments/workbench-links.json",
    "source_tools/apply_workbench_links.py",
})

# Complete original receiving, native packaging and Mac dependency source.
ALLOWED = ALLOWED | frozenset({
    "operator/CLIENT_SOURCE_PORTABLE_RECEIVING.md",
    "source_tools/native_runtime/prefix_pack.py",
    "integration/component_fragments/receiving-process-portability.json",
    "model/reach_chemistry/cli.py",
    "source_tools/receiving_water_course.py",
    "source_tools/gura_comparison.py",
    "source_tools/MACOS_NATIVE_CLOSURE.md",
    "integration/component_fragments/macos-runtime-closure.json",
})

# Complete current portable report, intake and private source receiving callers.
ALLOWED = ALLOWED | frozenset({
    "model/community_report_handover.py",
    "model/field_report_recovery.py",
    "operator/community_archive_inputs.py",
    "operator/customer_spatial_receiving.py",
    "source_tools/operator_source_intake.py",
})

# Restore retained collection Workspaces through the existing native receiver.
ALLOWED = ALLOWED | frozenset({
    "source_tools/collection_opening/receive_collection_studies.py",
})

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
    native_versions = assembled_data(application, pending, "model/native_versions.py")
    if b"source_refresh_comparison" in native_versions:
        for dependency in ("model/source_refresh_comparison.py", "model/rasters.py"):
            assembled_data(application, pending, dependency)
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


def verify_geographic_allocation_dependencies(application, pending):
    """Keep the original utility-context allocation and source closure together."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    context = source("model/geographic_receiving_context.py")
    active = any(source(name) is not None for name in (
        "model/geographic_scenario_allocation.py",
        "model/geographic_scenario_allocation_report.py"))
    active = active or (context is not None and b"geographic_scenario_allocation" in context)
    if not active:
        return
    dependencies = (
        "model/geographic_scenario_allocation.py",
        "model/geographic_scenario_allocation_report.py",
        "model/GEOGRAPHIC_SCENARIO_ALLOCATION.md",
        "model/geographic_receiving_context.py", "model/GEOGRAPHIC_RECEIVING_CONTEXT.md",
        "integration/component_fragments/geographic-receiving-context.json",
        "model/common.py", "model/workspace.py", "model/rasters.py",
        "model/receiving_waters.py", "model/receiving_water_accounting.py",
        "model/receiving_water_report_source.py", "model/observed_context.py",
        "model/scenario_footprint.py", "model/scientific_figures.py",
        "model/scientific_map_figures.py", "model/geographic_headwaters.py",
        "model/native_versions.py", "model/model_selection.py", "model/reuse.py",
        "model/spatial_esri.py", "model/profiles.py",
        "source_tools/geographic_matched_control.py",
        "source_tools/regional_matched_control.py", "source_tools/precipitation_matching.py",
        "source_tools/headwaters_parameter_course.py",
        "model/ensembles.py", "model/ensemble_operations.py", "model/ensemble_report.py",
        "model/paired_ensemble/__init__.py", "model/paired_ensemble/ensemble_workspace.py",
        "model/paired_ensemble/designs.py", "model/paired_ensemble/ensemble_store.py",
        "source/receptor-profiles/utility-focus-20261012.json",
        "source/water_context/20261012/public-water/receiving-waters.public-spec.json",
        "source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json",
        "CURRENT_OWNER_DIRECTION.md",
    )
    for name in dependencies:
        assembled_data(application, pending, name)
    if b"geographic_scenario_allocation" not in assembled_data(
            application, pending, "model/geographic_receiving_context.py"):
        raise ValueError("Compose allocation into the original Geographic utility context")
    kernel = assembled_data(application, pending, "model/geographic_scenario_allocation.py")
    renderer = assembled_data(application, pending, "model/geographic_scenario_allocation_report.py")
    if (b"def prepare(" not in kernel or b"def inspect(" not in kernel
            or b"def write(" not in renderer):
        raise ValueError("Receive the complete original Geographic allocation and report modules")
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-receiving-context.json"))
    family = fragment.get("components", {}).get("geographic-receiving-context", {})
    needed = {
        "model/geographic_receiving_context.py",
        "model/geographic_scenario_allocation.py", "model/geographic_scenario_allocation_report.py",
        "model/GEOGRAPHIC_SCENARIO_ALLOCATION.md", "model/geographic_headwaters.py",
        "source/receptor-profiles/utility-focus-20261012.json",
        "source_tools/geographic_matched_control.py", "source_tools/regional_matched_control.py",
        "source_tools/precipitation_matching.py", "source_tools/headwaters_parameter_course.py",
        "model/ensembles.py", "model/ensemble_operations.py", "model/ensemble_report.py",
    }
    optional_modules = (
        ("geographic_siting_contrasts", kernel, (
            "model/geographic_siting_contrasts.py",
            "model/GEOGRAPHIC_SITING_CONTRASTS.md")),
        ("geographic_scenario_contrasts", kernel, (
            "model/geographic_scenario_contrasts.py",
            "model/GEOGRAPHIC_PHYSICAL_CONTRASTS.md")),
        ("geographic_utility_groups", context, (
            "model/geographic_utility_groups.py",
            "source/receptor-profiles/utility-focus-20261012.json")),
    )
    for module, importer, members in optional_modules:
        if importer is not None and module.encode("ascii") in importer:
            for name in members:
                assembled_data(application, pending, name)
            needed.update(members)
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-receiving-context"
            or not needed.issubset(set(family.get("paths", [])))):
        raise ValueError("Retain Geographic allocation in its original complete component family")



def verify_geographic_operator_dependencies(application, pending):
    """Keep the existing Geographic desk and its read-only allocation view together."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    view_name = "operator/web/geographic_allocation.mjs"
    workbench_name = "operator/web/geographic_workbench.mjs"
    workbench = source(workbench_name)
    if (source(view_name) is None
            and (workbench is None or b"geographic_allocation.mjs" not in workbench)):
        return
    members = (
        "operator/geographic_preparation.py",
        "operator/extensions/geographic-headwaters.json",
        workbench_name, "operator/web/geographic_workbench.css", view_name,
        "operator/GEOGRAPHIC_HEADWATERS.md",
    )
    for name in members + (
            "integration/component_fragments/geographic-operator.json",
            "operator/source_preparation.py",
            "operator/extensions/source-preparation.json",
            "operator/web/source_workbench.mjs", "operator/web/source_workbench.css",
            "source_tools/high_quality_water_preparation.py",
            "source_tools/nlcd_range_preparation.py",
            "source_tools/nlcd_remote_window.py",
            "source_tools/nlcd_static.py",
            "source_tools/nlcd_wcs.py",
            "source_tools/raster_sources.py",
            "source_tools/source_transfer.py",
            "operator/extension_registry.py", "operator/web/extension_host.mjs",
            "model/geographic_receiving_context.py",
            "model/geographic_scenario_allocation.py",
            "model/geographic_scenario_allocation_report.py"):
        assembled_data(application, pending, name)
    workbench = assembled_data(application, pending, workbench_name)
    descriptor = json.loads(assembled_data(
        application, pending, "operator/extensions/geographic-headwaters.json"))
    assets = set(descriptor.get("assets", []))
    backend = descriptor.get("backend", {})
    allocation_routes = [route for route in backend.get("routes", [])
                         if route.get("path") == "/api/geographic-headwaters/allocation"]
    if (len(allocation_routes) != 1
            or allocation_routes[0].get("operation") != "allocation"
            or allocation_routes[0].get("handler") != "read"
            or allocation_routes[0].get("args") != ["workspace_key", "operation", "payload"]
            or backend.get("module") != "geographic_preparation"):
        raise ValueError("Retain the original read-only Geographic allocation route")
    if (descriptor.get("id") != "geographic-headwaters"
            or not {"geographic_allocation.mjs", "geographic_workbench.mjs",
                    "geographic_workbench.css", "source_workbench.mjs",
                    "source_workbench.css"}.issubset(assets)
            or b"geographic_allocation.mjs" not in workbench
            or descriptor.get("client", {}).get("module") != "/web/geographic_workbench.mjs"):
        raise ValueError("Compose the allocation view with its original Geographic desk and asset registration")
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-operator.json"))
    family = fragment.get("components", {}).get("geographic-operator", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-operator"
            or not set(members).issubset(set(family.get("paths", [])))):
        raise ValueError("Retain the allocation view in the complete original Geographic operator family")


def verify_geographic_study_dependencies(application, pending):
    """Retain the original editable Geographic course behind saved reports."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    helper = source("model/geographic_study_transfer.py")
    callers = (source("model/study_transfer.py"),
               source("model/scientific_report_study_transfer.py"))
    if helper is None and not any(
            body is not None and b"geographic_study_transfer" in body for body in callers):
        return
    members = (
        "model/geographic_study_transfer.py",
        "model/GEOGRAPHIC_STUDY_TRANSFER.md",
        "model/geographic_headwaters.py",
        "model/geographic_receiving_context.py",
        "model/geographic_scenario_allocation.py",
        "model/geographic_scenario_allocation_report.py",
        "model/geographic_scenario_contrasts.py",
        "model/geographic_siting_contrasts.py",
        "model/geographic_utility_groups.py",
        "model/ensemble_study_transfer.py",
        "model/receiving_water_report_transfer.py",
        "model/scenario_footprint.py",
        "model/ensembles.py",
        "model/ensemble_operations.py",
        "model/ensemble_report.py",
        "source_tools/headwaters_parameter_course.py",
        "source_tools/geographic_scenario_context.py",
        "source_tools/geographic_scenario_interpretation.mjs",
        "source_tools/geographic_headwaters_reopen.py",
        "source_tools/receive_geographic_headwaters.py",
        "CURRENT_OWNER_DIRECTION.md",
    )
    if helper is not None and b"from .compute_programme import ComputeProgrammes" in helper:
        members += (
            "model/compute_programme.py", "model/receptor_study_transfer.py",
            "model/geographic_programme.py",
        )
    if helper is not None and b"ensemble_portable" in helper:
        members += ("model/paired_ensemble/ensemble_portable.py",)
    for name in (*members,
                 "integration/component_fragments/geographic-study-transfer.json",
                 "model/common.py", "model/native_versions.py",
                 "model/paired_ensemble/__init__.py",
                 "model/paired_ensemble/ensemble_store.py",
                 "model/paired_ensemble/ensemble_workspace.py",
                 "model/paired_ensemble/designs.py"):
        assembled_data(application, pending, name)
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-study-transfer.json"))
    family = fragment.get("extend_components", {}).get("study-transfer", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-study-transfer"
            or "study-transfer" in fragment.get("components", {})
            or not set(members).issubset(set(family.get("paths", [])))):
        raise ValueError("Retain Geographic source history in the existing Study-transfer family")


def verify_geographic_programme_dependencies(application, pending):
    """Keep adopted native cases in the original Programme and source-update workflow."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    helper = source("model/geographic_programme.py")
    provider = source("operator/geographic_preparation.py")
    if helper is None and (provider is None or b"geographic_programme" not in provider):
        return
    members = (
        "model/geographic_programme.py",
        "source_tools/adopt_geographic_headwaters_programme.py",
        "source_tools/GEOGRAPHIC_PROGRAMME.md",
        "operator/extensions/programme-activity.json",
        "operator/programme_activity.py",
        "model/compute_programme.py",
        "model/programme_interactions.py",
        "docs/programme-interactions.md",
        "model/compute_programme_cli.py",
        "model/portable.py",
        "operator/programmes.py",
        "operator/web/programmes.mjs",
        "install_programmes.py",
        "operator/web/native-interactions.mjs",
        "PROGRAMME_INTERACTIONS.md",
        "install_programme_interactions.py",
        "docs/PARAMETER_CASE_CONSOLE.md",
        "docs/PROGRAMME_CASE_CONSOLE.md",
        "docs/PROGRAMME_LARGE_DESIGNS.md",
        "model/delivery_catalogue.py",
        "model/parameter_case_status.py",
        "model/programme_case_status.py",
        "model/programme_views.py",
        "model/record_catalog.py",
        "operator/web/parameter_case_console.mjs",
        "model/programme_source_updates.py",
        "model/PROGRAMME_SOURCE_UPDATES.md",
        "operator/programme_source_updates.py",
        "operator/extensions/programme-source-updates.json",
        "operator/web/programme_source_updates.mjs",
        "operator/programme_source_updates_patch.json",
        "operator/install_programme_source_updates.py",
        "operator/PROGRAMME_SOURCE_UPDATES.md",
        "integration/component_fragments/programme-source-updates.json",
        "integration/component_fragments/geographic-programme.json",
        "model/native_study.py",
        "model/fgdc_metadata.py",
        "model/programme_reuse.py",
        "model/native_execution.py",
        "docs/native-interactions.md",
        "model/interaction_dispatch.py",
        "model/native_interactions.py",
        "model/native_interactions_cli.py",
        "model/native_versions.py",
        "operator/NATIVE_INTERACTIONS.md",
        "operator/extensions/native-interactions.json",
        "operator/install_native_interactions.py",
        "operator/native_interactions.py",
        "operator/web/native-interactions.css",
        "model/PROGRAMME_NATIVE_REUSE.md",
        "operator/programme_native_reuse_patch.json",
        "operator/install_programme_reuse.py",
        "integration/component_fragments/programme-native-reuse.json",
        "source_tools/continue_programme_source_reuse.py",
        "source_tools/PROGRAMME_SOURCE_REUSE_COURSE.md",
    )
    for name in members + (
            "model/common.py", "model/workspace.py", "model/model_selection.py",
            "model/native_versions.py", "model/profiles.py", "model/reuse.py",
            "model/source_refresh.py", "model/source_refresh_legacy.py",
            "model/geographic_headwaters.py", "operator/extension_registry.py",
            "operator/web/extension_host.mjs"):
        assembled_data(application, pending, name)
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-programme.json"))
    family = fragment.get("components", {}).get("geographic-programme", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-programme"
            or not {"model/geographic_programme.py",
                    "source_tools/adopt_geographic_headwaters_programme.py",
                    "source_tools/GEOGRAPHIC_PROGRAMME.md"}.issubset(set(family.get("paths", [])))
            or not {"geographic-native-receiving", "programme-activity"}.issubset(
                set(family.get("requires", [])))):
        raise ValueError("Retain Geographic adoption in the original Programme family")


def verify_geographic_received_study_dependencies(application, pending):
    """Keep the original selected Geographic receipt readable and navigable."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    reader = source("model/study_receiving.py")
    helper = source("model/geographic_study_receiving.py")
    if helper is None and (reader is None or b"geographic_study_receiving" not in reader):
        return
    members = (
        "integration/component_fragments/geographic-study-receiving.json",
        "model/geographic_study_transfer.py",
        "model/geographic_study_receiving.py",
        "operator/geographic_receiving.py",
        "operator/web/geographic_received_studies.mjs",
        "model/GEOGRAPHIC_STUDY_RECEIVING.md",
        "source_tools/geographic_headwaters_handover.py",
        "source_tools/simulated_headwaters_handover.py",
        "CURRENT_OWNER_DIRECTION.md",
    )
    for name in members + (
            "model/common.py", "model/study_transfer.py", "model/study_receiving.py",
            "operator/study_receiving.py", "operator/extensions/study-transfer.json",
            "operator/web/received_studies.mjs", "operator/geographic_preparation.py",
            "operator/web/geographic_workbench.mjs"):
        assembled_data(application, pending, name)
    descriptor = json.loads(assembled_data(
        application, pending, "operator/extensions/study-transfer.json"))
    if "geographic_received_studies.mjs" not in descriptor.get("assets", []):
        raise ValueError("Retain the Geographic received-study view in the original Study descriptor")
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-study-receiving.json"))
    family = fragment.get("components", {}).get("geographic-study-receiving", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-study-receiving"
            or not set(members).issubset(set(family.get("paths", [])))
            or not {"geographic-operator", "study-transfer"}.issubset(set(family.get("requires", [])))):
        raise ValueError("Retain the original Geographic received-study component")


def verify_geographic_browser_dependencies(application, pending):
    """Keep the maintained receiving browser with its original Programme chapter."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    driver = source("source_tools/receive_geographic_handover_browser.mjs")
    chapter = source("source_tools/geographic_programme_browser.mjs")
    if chapter is None and (driver is None or b"geographic_programme_browser.mjs" not in driver):
        return
    members = (
        "source_tools/receive_geographic_handover_browser.mjs",
        "source_tools/geographic_review_browser.mjs",
        "source_tools/geographic_browser_course.mjs",
        "source_tools/geographic_allocation_browser.mjs",
        "source_tools/geographic_programme_browser.mjs",
        "docs/GEOGRAPHIC_HANDOVER_BROWSER.md",
    )
    for name in members + (
            "integration/component_fragments/geographic-handover-browser.json",
            "source_tools/receive_geographic_headwaters.py",
            "source_tools/geographic_headwaters_handover.py",
            "model/geographic_programme.py", "model/compute_programme.py",
            "operator/geographic_preparation.py",
            "operator/extensions/geographic-headwaters.json",
            "operator/web/geographic_workbench.mjs", "CURRENT_OWNER_DIRECTION.md"):
        assembled_data(application, pending, name)
    driver = assembled_data(application, pending, members[0])
    if b"geographic_programme_browser.mjs" not in driver:
        raise ValueError("Retain the Programme chapter in the original Geographic browser")
    fragment = json.loads(assembled_data(
        application, pending, "integration/component_fragments/geographic-handover-browser.json"))
    family = fragment.get("components", {}).get("geographic-handover-browser", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "geographic-handover-browser"
            or not set(members).issubset(set(family.get("paths", [])))
            or "geographic-native-receiving" not in family.get("requires", [])):
        raise ValueError("Retain the original Geographic receiving browser component")


def verify_multivariate_control_dependencies(application, pending):
    """Admit the original native family only when its actual consumer is installed."""
    def source(name):
        value = pending.get(name)
        return read_existing(application, name) if value is None else value

    def require(paths):
        for name in paths:
            assembled_data(application, pending, name)

    control = source("model/multivariate_control.py")
    control_transfer = source("model/multivariate_control_study_transfer.py")
    transfer = source("model/study_transfer.py")
    if control is not None or (transfer is not None and b"multivariate_control_study_transfer" in transfer):
        require((
        "model/multivariate_control.py",
        "model/multivariate_control_design.py",
        "model/multivariate_control_report.py",
        "model/multivariate_control_study_transfer.py",
        "model/multivariate_control_cli.py",
        "model/scenario_footprint.py",
        "model/experiments.py",
        "source_tools/precipitation_matching.py",
        "source/MULTIVARIATE_CONTROLS.md",
        "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
        "CURRENT_OWNER_DIRECTION.md",
        "model/common.py",
        "model/workspace.py",
        "model/native_versions.py",
        "model/rasters.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
    ))
    outcomes = source("model/multivariate_control_outcomes.py")
    if outcomes is not None or (control_transfer is not None and b"multivariate_control_outcome_transfer" in control_transfer):
        require((
        "model/multivariate_control_outcomes.py",
        "model/multivariate_control_outcome_analysis.py",
        "model/multivariate_control_outcome_report.py",
        "model/multivariate_control_outcome_transfer.py",
        "model/multivariate_control_study_transfer.py",
        "model/multivariate_control_outcomes_cli.py",
        "source/MULTIVARIATE_CONTROL_OUTCOMES.md",
        "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
        "CURRENT_OWNER_DIRECTION.md",
        "model/multivariate_control.py",
        "model/multivariate_control_design.py",
        "model/multivariate_control_report.py",
        "model/geographic_scenario_allocation.py",
        "model/geographic_siting_contrasts.py",
        "model/receiving_waters.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
        "model/native_versions.py",
        "model/rasters.py",
        "model/scenario_footprint.py",
        "model/experiments.py",
        "model/geographic_study_transfer.py",
        "source_tools/precipitation_matching.py",
        "model/geographic_scenario_contrasts.py",
        "model/geographic_scenario_allocation_report.py",
    ))
    control_provider = source("operator/multivariate_control_operator.py")
    if control_provider is not None:
        require((
        "operator/multivariate_control_operator.py",
        "operator/extensions/multivariate-control.json",
        "operator/web/multivariate_control_core.mjs",
        "operator/web/multivariate_control.mjs",
        "operator/web/multivariate_control.css",
        "operator/MULTIVARIATE_CONTROL.md",
    ))
    outcome_provider = source("operator/multivariate_control_outcomes_operator.py")
    if outcome_provider is not None:
        require((
        "model/multivariate_control_outcomes.py",
        "model/multivariate_control_outcome_analysis.py",
        "model/multivariate_control_outcome_report.py",
        "model/multivariate_control_outcome_transfer.py",
        "model/multivariate_control_study_transfer.py",
        "model/multivariate_control_outcomes_cli.py",
        "source/MULTIVARIATE_CONTROL_OUTCOMES.md",
        "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
        "CURRENT_OWNER_DIRECTION.md",
        "model/multivariate_control.py",
        "model/multivariate_control_design.py",
        "model/multivariate_control_report.py",
        "model/geographic_scenario_allocation.py",
        "model/geographic_siting_contrasts.py",
        "model/receiving_waters.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
        "model/native_versions.py",
        "model/rasters.py",
        "model/scenario_footprint.py",
        "model/experiments.py",
        "model/geographic_study_transfer.py",
        "source_tools/precipitation_matching.py",
        "model/geographic_scenario_contrasts.py",
        "model/geographic_scenario_allocation_report.py",
    ))
        require((
        "operator/multivariate_control_outcomes_operator.py",
        "operator/extensions/multivariate-control-outcomes.json",
        "operator/web/multivariate_control_outcomes_core.mjs",
        "operator/web/multivariate_control_outcomes.mjs",
        "operator/web/multivariate_control.mjs",
        "operator/web/multivariate_control.css",
        "operator/MULTIVARIATE_CONTROL_OUTCOMES.md",
    ))
        descriptor = json.loads(assembled_data(application, pending, "operator/extensions/multivariate-control-outcomes.json"))
        if (descriptor.get("id") != "multivariate-control-outcomes"
                or descriptor.get("backend", {}).get("module") != "multivariate_control_outcomes_operator"
                or set(descriptor.get("backend", {}).get("actions", [])) != {"control.outcomes.prepare"}):
            raise ValueError("Compose the original completed-outcome provider and read/report action")
        for asset in descriptor.get("assets", []):
            assembled_data(application, pending, "operator/web/" + asset)
    receiver = source("source_tools/multivariate_control_receiving.py")
    if receiver is not None:
        require((
            "source_tools/multivariate_control_receiving.py", "source_tools/geographic_headwaters_reopen.py",
            "source_tools/simulated_headwaters_receiving.py", "model/multivariate_control.py",
            "model/study_transfer.py", "model/portable.py"))
        if b"outcome_selection_path" in receiver:
            require((
        "model/multivariate_control_outcomes.py",
        "model/multivariate_control_outcome_analysis.py",
        "model/multivariate_control_outcome_report.py",
        "model/multivariate_control_outcome_transfer.py",
        "model/multivariate_control_study_transfer.py",
        "model/multivariate_control_outcomes_cli.py",
        "source/MULTIVARIATE_CONTROL_OUTCOMES.md",
        "source/MULTIVARIATE_CONTROL_OWNER_DIRECTION.md",
        "CURRENT_OWNER_DIRECTION.md",
        "model/multivariate_control.py",
        "model/multivariate_control_design.py",
        "model/multivariate_control_report.py",
        "model/geographic_scenario_allocation.py",
        "model/geographic_siting_contrasts.py",
        "model/receiving_waters.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
        "model/native_versions.py",
        "model/rasters.py",
        "model/scenario_footprint.py",
        "model/experiments.py",
        "model/geographic_study_transfer.py",
        "source_tools/precipitation_matching.py",
        "model/geographic_scenario_contrasts.py",
        "model/geographic_scenario_allocation_report.py",
    ))
    driver = source("source_tools/receive_geographic_handover_browser.mjs")
    if driver is not None and b"multivariate_control_browser.mjs" in driver:
        require(("source_tools/multivariate_control_browser.mjs",))
    if driver is not None and b"delivery_preparation_receiving.mjs" in driver:
        require(("operator/delivery_preparation_receiving.mjs",
                 "operator/web/delivery_preparation_storage.mjs"))
    browser = source("source_tools/multivariate_control_browser.mjs")
    if browser is not None and b"operateMatchedControlOutcomes" in browser:
        require((
        "operator/multivariate_control_outcomes_operator.py",
        "operator/extensions/multivariate-control-outcomes.json",
        "operator/web/multivariate_control_outcomes_core.mjs",
        "operator/web/multivariate_control_outcomes.mjs",
        "operator/web/multivariate_control.mjs",
        "operator/web/multivariate_control.css",
        "operator/MULTIVARIATE_CONTROL_OUTCOMES.md",
    ))


def verify_terrain_receiving_dependencies(application, pending):
    def source(name):
        return pending.get(name) if name in pending else read_existing(application, name)
    def require(names):
        for name in names:
            assembled_data(application, pending, name)
    transfer = source("model/study_transfer.py")
    ordered = source("model/scientific_report_study_transfer.py")
    terrain = source("model/terrain_conditioning_report_source.py")
    if (terrain is not None or (transfer is not None and b"terrain_conditioning_study_transfer" in transfer)
            or (ordered is not None and b"terrain_conditioning_study_transfer" in ordered)):
        require((
        "source_tools/terrain_conditioning.py",
        "source_tools/terrain_conditioning_response.py",
        "source_tools/terrain_conditioning_report.py",
        "source_tools/terrain_flood.cpp",
        "source_tools/terrain_prepare.py",
        "source_tools/TERRAIN_CONDITIONING.md",
        "model/terrain_conditioning_report_source.py",
        "model/terrain_conditioning_scientific_report.py",
        "model/terrain_conditioning_report_cli.py",
        "model/terrain_conditioning_study_transfer.py",
        "operator/terrain_conditioning_native.py",
        "operator/extensions/terrain-conditioning.json",
        "operator/web/terrain_conditioning.mjs",
        "operator/web/terrain_conditioning.css",
        "operator/TERRAIN_SCIENTIFIC_SOURCE.md",
        "source/TERRAIN_STUDY_TRANSFER.md",
        "integration/component_fragments/terrain-conditioning.json",
        "integration/component_fragments/terrain-conditioning-report-source.json",
        "integration/component_fragments/terrain-study-transfer.json",
        "model/common.py",
        "model/workspace.py",
        "model/rasters.py",
        "model/native_versions.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
    ))
    provider = source("operator/terrain_conditioning_native.py")
    if provider is not None:
        require(("operator/extensions/terrain-conditioning.json", "operator/web/terrain_conditioning.mjs",
                 "operator/web/terrain_conditioning.css"))
        descriptor = json.loads(assembled_data(application, pending, "operator/extensions/terrain-conditioning.json"))
        if (b"report_source" in provider and
                ("terrain.conditioning.report-source.prepare" not in descriptor.get("backend", {}).get("actions", [])
                 or not any(route.get("path") == "/api/terrain-conditioning/report-source-preview"
                            for route in descriptor.get("backend", {}).get("routes", [])))):
            raise ValueError("Install the complete original Terrain scientific-source registration")
        for asset in descriptor.get("assets", []):
            assembled_data(application, pending, "operator/web/" + asset)
    receiver = source("source/observed-report-20261013/receive_operator.py")
    browser = source("source/observed-report-20261013/receive_browser.mjs")
    if ((receiver is not None and b"terrain_report_receiving" in receiver)
            or (browser is not None and b"terrain_report_browser.mjs" in browser)):
        require((
        "source_tools/terrain_conditioning.py",
        "source_tools/terrain_conditioning_response.py",
        "source_tools/terrain_conditioning_report.py",
        "source_tools/terrain_flood.cpp",
        "source_tools/terrain_prepare.py",
        "source_tools/TERRAIN_CONDITIONING.md",
        "model/terrain_conditioning_report_source.py",
        "model/terrain_conditioning_scientific_report.py",
        "model/terrain_conditioning_report_cli.py",
        "model/terrain_conditioning_study_transfer.py",
        "operator/terrain_conditioning_native.py",
        "operator/extensions/terrain-conditioning.json",
        "operator/web/terrain_conditioning.mjs",
        "operator/web/terrain_conditioning.css",
        "operator/TERRAIN_SCIENTIFIC_SOURCE.md",
        "source/TERRAIN_STUDY_TRANSFER.md",
        "integration/component_fragments/terrain-conditioning.json",
        "integration/component_fragments/terrain-conditioning-report-source.json",
        "integration/component_fragments/terrain-study-transfer.json",
        "source_tools/terrain_report_receiving.py",
        "source_tools/terrain_report_browser.mjs",
        "source_tools/TERRAIN_REPORT_RECEIVING.md",
        "integration/component_fragments/terrain-report-receiving.json",
        "source/observed-report-20261013/receive_operator.py",
        "source/observed-report-20261013/receive_browser.mjs",
        "source/observed-report-20261013/assessment_browser.mjs",
        "source/observed-report-20261013/receive_course.py",
        "model/common.py",
        "model/workspace.py",
        "model/rasters.py",
        "model/native_versions.py",
        "model/scientific_report.py",
        "model/scientific_figures.py",
        "model/scientific_report_editions.py",
        "model/scientific_report_study_transfer.py",
        "model/study_transfer.py",
        "model/portable.py",
        "operator/server.py",
        "operator/extension_registry.py",
        "operator/source_reports.py",
        "operator/web/source_reports.mjs",
        "operator/extensions/source-reports.json",
        "operator/web/source_reports.css",
        "operator/web/source_report_editions.mjs",
        "operator/web/scientific_source_reader.mjs",
        "operator/web/published_original_reports.mjs",
        "operator/web/published_studies.css",
        "operator/web/scientific_synthesis.mjs",
        "operator/web/scientific_synthesis_core.mjs",
        "operator/web/scientific_synthesis.css",
        "operator/source_report_editions.py",
        "operator/source_archive_ingress.py",
        "operator/scientific_synthesis.py",
        "operator/scientific_source_reader.py",
        "model/scientific_briefing.py",
        "model/observed_context.py",
        "model/scientific_report_review.py",
        "model/scientific_report_capture.py",
        "model/scientific_synthesis.py",
        "model/scientific_synthesis_catalog.py",
        "CURRENT_OWNER_DIRECTION.md",
    ))


def verify_sampling_native_evidence_dependencies(application, pending):
    def source(name):
        return pending.get(name) if name in pending else read_existing(application, name)
    def require(names):
        for name in names:
            assembled_data(application, pending, name)
    recommendations = source("model/monitoring_recommendations.py")
    evidence = source("model/monitoring_native_evidence.py")
    receiving = source("source_tools/receive_sampling_recommendations.py")
    if (evidence is not None
            or (recommendations is not None and b"monitoring_native_evidence" in recommendations)
            or (receiving is not None and b"verify-evidence-received" in receiving)):
        require((
            "model/monitoring_native_evidence.py",
            "model/monitoring_evidence_report.py",
            "model/monitoring_recommendations.py",
            "model/monitoring_study_transfer.py",
            "model/monitoring_common.py",
            "model/monitoring_observed_context.py",
            "model/monitoring_packet.py",
            "model/MONITORING_RECOMMENDATIONS.md",
            "source/SAMPLING_NATIVE_EVIDENCE.md",
            "operator/monitoring_recommendations.py",
            "operator/extensions/monitoring-recommendations.json",
            "operator/web/monitoring_recommendations.mjs",
            "operator/web/monitoring_recommendations.css",
            "operator/SAMPLING_PRIORITIES.md",
            "source_tools/receive_sampling_recommendations.py",
            "integration/component_fragments/monitoring-recommendations.json",
            "integration/component_fragments/monitoring-native-evidence.json",
            "model/common.py", "model/workspace.py", "model/study_transfer.py",
            "model/portable.py", "model/scientific_report.py", "model/scientific_figures.py",
            "model/multivariate_control_outcomes.py", "model/multivariate_control_outcome_analysis.py",
            "model/multivariate_control_outcome_report.py", "model/multivariate_control_outcome_transfer.py",
            "model/multivariate_control_study_transfer.py",
            "model/terrain_conditioning_report_source.py", "model/terrain_conditioning_scientific_report.py",
            "model/terrain_conditioning_study_transfer.py", "CURRENT_OWNER_DIRECTION.md",
        ))
        # Keep the original Monitoring design, calendar, fieldwork and report
        # source modules with the Sampling evidence course, including registered
        # and directly imported browser assets. The complete application remains
        # the baseline for shared Workspace and scientific service dependencies.
        require((
            "model/MONITORING.md",
            "model/MONITORING_FIELDWORK.md",
            "model/MONITORING_OBSERVED_CONTEXT.md",
            "model/implementation.py",
            "model/implementation_reporting.py",
            "model/implementation_schema.py",
            "model/monitoring_actions.py",
            "model/monitoring_campaign.py",
            "model/monitoring_cli.py",
            "model/monitoring_common.py",
            "model/monitoring_comparison_report.py",
            "model/monitoring_design.py",
            "model/monitoring_field_return.py",
            "model/monitoring_frontier_comparison.py",
            "model/monitoring_implementation.py",
            "model/monitoring_network.py",
            "model/monitoring_observed_context.py",
            "model/monitoring_report_source.py",
            "model/monitoring_sources.py",
            "model/monitoring_workspace.py",
            "model/receiving_water_accounting.py",
            "model/receiving_water_monitoring.py",
            "model/requirements-monitoring.txt",
            "model/utility_microbial_study.py",
            "model/utility_monitoring.py",
            "model/utility_monitoring_comparison.py",
            "model/utility_monitoring_report.py",
            "operator/MONITORING_API.md",
            "operator/extensions/monitoring.json",
            "operator/monitoring.py",
            "operator/monitoring_native.py",
            "operator/monitoring_receiving.py",
            "operator/static/monitoring.js",
            "operator/web/monitoring-component.mjs",
            "operator/web/monitoring-field-selection.mjs",
            "operator/web/monitoring-frontiers.css",
            "operator/web/monitoring-frontiers.mjs",
            "operator/web/monitoring-observed.mjs",
            "operator/web/monitoring-report.mjs",
            "operator/web/monitoring-study-transfer.mjs",
            "operator/web/monitoring.css",
            "operator/web/monitoring.mjs",
            "operator/web/monitoring_field_return.mjs",
            "operator/web/monitoring_fieldwork.mjs",
        ))
        descriptor = json.loads(assembled_data(application, pending, "operator/extensions/monitoring-recommendations.json"))
        if (descriptor.get("id") != "monitoring-recommendations"
                or not {"monitoring.recommendations.prepare", "monitoring.recommendations.design",
                        "monitoring.recommendations.export"}.issubset(
                            descriptor.get("backend", {}).get("actions", []))
                or not any(route.get("path") == "/api/monitoring-recommendations"
                           for route in descriptor.get("backend", {}).get("routes", []))):
            raise ValueError("Install the complete original Sampling priorities registration")
        for asset in descriptor.get("assets", []):
            assembled_data(application, pending, "operator/web/" + asset)


def verify_native_observation_context_dependencies(application, pending):
    """Keep the original concentration context, Sampling and native receiving together."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)
    helper = source("model/monitoring_native_observations.py")
    actions = source("model/monitoring_actions.py")
    if helper is None and (actions is None or b"context.native.prepare" not in actions):
        return
    for name in (
        "model/monitoring_native_observations.py",
        "model/monitoring_concentration_report.py",
        "operator/web/monitoring-native-context.mjs",
        "operator/web/monitoring-native-context.css",
        "source/NATIVE_OBSERVATIONS_SAMPLING.md",
        "source_tools/sampling_native_observation_receiving.py",
        "source_tools/selections/sampling_sv833_20261013.json",
        "integration/component_fragments/monitoring-native-observations.json",
        "model/monitoring_observed_context.py",
        "model/monitoring_actions.py",
        "model/monitoring_study_transfer.py",
        "model/monitoring_recommendations.py",
        "model/monitoring_common.py",
        "model/monitoring_sources.py",
        "model/monitoring_workspace.py",
        "model/monitoring_network.py",
        "model/monitoring_packet.py",
        "model/observations.py",
        "model/observation_support.py",
        "model/common.py",
        "model/workspace.py",
        "operator/monitoring_native.py",
        "operator/extensions/monitoring.json",
        "operator/web/monitoring.mjs",
        "operator/web/monitoring-observed.mjs",
        "operator/web/monitoring_recommendations.mjs",
        "source_tools/receive_sampling_recommendations.py",
        "CURRENT_OWNER_DIRECTION.md",
    ):
        assembled_data(application, pending, name)
    descriptor = json.loads(assembled_data(application, pending, "operator/extensions/monitoring.json"))
    if ("monitoring.context.native.prepare" not in descriptor.get("backend", {}).get("actions", [])
            or not {"monitoring-native-context.mjs", "monitoring-native-context.css"}.issubset(
                descriptor.get("assets", []))):
        raise ValueError("Install the complete original native observation context registration")
    for asset in descriptor.get("assets", []):
        assembled_data(application, pending, "operator/web/" + asset)
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/monitoring-native-observations.json"))
    family = fragment.get("components", {}).get("monitoring-native-observations", {})
    if not {"monitoring", "monitoring-recommendations"}.issubset(family.get("requires", [])):
        raise ValueError("Native concentration context requires original Monitoring and Sampling")
    for path in family.get("paths", []):
        assembled_data(application, pending, path)


def verify_advancing_study_dependencies(application, pending):
    """Retain the original saved Calibration and Climate working families."""
    transfer = pending.get("model/study_transfer.py")
    if transfer is None:
        transfer = read_existing(application, "model/study_transfer.py")
    if transfer is None:
        return
    families = (
        (b"calibration_native_study_transfer",
         "integration/component_fragments/calibration-studies.json",
         "extend_components", "study-transfer",
         ("model/calibration_native_study_transfer.py",
          "model/calibration_study_transfer.py", "model/calibration_followup.py",
          "model/parameter_calibration.py", "model/calibration.py",
          "model/parameter_studies.py", "model/common.py")),
        (b"climate_working_transfer",
         "integration/component_fragments/climate-forcing.json",
         "components", "climate-forcing",
         ("model/climate_working_transfer.py", "model/climate_working.py",
          "model/climate_forcing.py", "model/forcing_sources.py",
          "model/model_selection.py", "model/native_versions.py",
          "model/rasters.py", "model/reuse.py", "model/common.py")),
    )
    for marker, path, group, family, dependencies in families:
        if marker not in transfer:
            continue
        for name in dependencies:
            assembled_data(application, pending, name)
        fragment = json.loads(assembled_data(application, pending, path))
        declaration = fragment.get(group, {}).get(family, {})
        members = declaration.get("paths")
        if (not isinstance(members, list) or not members
                or not set(dependencies[:2]).issubset(members)):
            raise ValueError("Retain the complete original Study component: " + family)
        for name in members:
            assembled_data(application, pending, name)


def verify_conservation_sampling_dependencies(application, pending):
    """Keep the original Conservation source interpretation with Sampling."""
    resolver = pending.get("model/monitoring_native_evidence.py")
    if resolver is None:
        resolver = read_existing(application, "model/monitoring_native_evidence.py")
    if resolver is None or b"conservation_sampling_evidence" not in resolver:
        return
    for name in (
        "model/conservation_sampling_evidence.py",
        "model/conservation.py",
        "model/conservation_reporting.py",
        "model/conservation_families.py",
        "model/conservation_optimization.py",
        "model/conservation_study_transfer.py",
        "model/conservation_report_source.py",
        "model/source_lineage.py",
        "model/observed_context.py",
        "model/common.py",
        "model/monitoring_common.py",
        "model/monitoring_native_evidence.py",
        "model/monitoring_evidence_report.py",
        "model/monitoring_recommendations.py",
        "model/reuse.py",
        "model/rasters.py",
        "model/native_versions.py",
        "model/keowee_priority.py",
        "model/portfolios.py",
        "source/capture_upstream_network.py",
        "model/conservation_report_source_cli.py",
        "model/CONSERVATION_REPORT_SOURCE.md",
        "operator/conservation.py",
        "operator/extensions/conservation.json",
        "operator/web/conservation.mjs",
        "integration/conservation_report_operator_composition.json",
        "model/conservation_report_maps.py",
        "model/conservation_decision_geography.py",
        "CONSERVATION_DECISION_METHODS.md",
        "model/CONSERVATION_REPORT_MAPS.md",
        "integration/conservation_report_map_composition.json",
        "integration/component_fragments/conservation-scientific-report-source.json",
        "integration/component_fragments/monitoring-native-evidence.json",
        "source/SAMPLING_NATIVE_EVIDENCE.md",
    ):
        assembled_data(application, pending, name)
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/monitoring-native-evidence.json"))
    extension = fragment.get("extend_components", {}).get("monitoring-recommendations", {})
    if "conservation-scientific-report-source" not in extension.get("requires", []):
        raise ValueError("Sampling Conservation evidence needs its original report-source component")
    if set(extension) - {"paths", "requires", "import_roots", "source_manifests"}:
        raise ValueError("Sampling evidence must use the original append-only component fields")
    for name in extension.get("paths", []):
        assembled_data(application, pending, name)


def verify_conservation_joint_dependencies(application, pending):
    """Keep the original joint comparison kernel, desk and registration together."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)
    native = source("model/conservation_optimization.py")
    client = source("operator/web/conservation.mjs")
    if not ((native is not None and b"conservation_joint_choices" in native)
            or (client is not None and b"./conservation_joint_choices.mjs" in client)):
        return
    for name in (
        "model/conservation_joint_choices.py",
        "operator/web/conservation_joint_choices.mjs",
        "CONSERVATION_JOINT_CHOICES.md",
        "integration/component_fragments/conservation-joint-choices.json",
        "model/conservation.py", "model/conservation_optimization.py",
        "model/conservation_reporting.py", "model/conservation_report_source.py",
        "model/conservation_study_transfer.py",
        "operator/web/conservation.mjs", "operator/extensions/conservation.json",
        "operator/install_conservation.py",
    ):
        assembled_data(application, pending, name)
    descriptor = json.loads(assembled_data(application, pending,
        "operator/extensions/conservation.json"))
    if "conservation_joint_choices.mjs" not in descriptor.get("assets", []):
        raise ValueError("Register the original Conservation joint comparison browser module")
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/conservation-joint-choices.json"))
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "conservation-joint-choices"):
        raise ValueError("Retain the original Conservation joint component identity")
    extension = fragment.get("extend_components", {}).get("conservation", {})
    if not {"model/conservation_joint_choices.py",
            "operator/web/conservation_joint_choices.mjs",
            "CONSERVATION_JOINT_CHOICES.md"}.issubset(extension.get("paths", [])):
        raise ValueError("Retain the complete original Conservation joint component paths")
    if set(extension) - {"paths", "requires", "import_roots", "source_manifests"}:
        raise ValueError("Conservation joint choices use original append-only component fields")



def verify_conservation_working_dependencies(application, pending):
    """Keep complete browser drafts, portable editions and their original editor together."""
    editor = pending.get("operator/web/conservation.mjs")
    if editor is None:
        editor = read_existing(application, "operator/web/conservation.mjs")
    if editor is None or b"./conservation_working_view.mjs" not in editor:
        return
    for name in ("operator/web/conservation_working.mjs",
                 "operator/web/conservation_working_view.mjs",
                 "operator/CONSERVATION_WORKING_FILES.md",
                 "operator/extensions/conservation.json",
                 "integration/component_fragments/conservation-working-files.json"):
        assembled_data(application, pending, name)
    descriptor = json.loads(assembled_data(application, pending, "operator/extensions/conservation.json"))
    if not {"conservation_working.mjs", "conservation_working_view.mjs"} <= set(descriptor.get("assets", [])):
        raise ValueError("Register both original Conservation working-file web assets")
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/conservation-working-files.json"))
    component = fragment.get("extend_components", {}).get("conservation-scientific-report-source", {})
    if set(component) - {"paths", "requires", "import_roots", "source_manifests"}:
        raise ValueError("Conservation working files need the original append-only component fields")
    for name in component.get("paths", []):
        assembled_data(application, pending, name)

def verify_joint_delivery_dependencies(application, pending):
    """Receive Joint delivery with the original Customer reviews authority."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)
    if (source("model/joint_delivery.py") is None
            and source("operator/extensions/joint-delivery.json") is None):
        return
    for name in (
        "model/joint_delivery.py",
        "operator/joint_delivery.py",
        "source/joint-delivery/20261013/profile.json",
        "operator/web/joint_delivery.mjs",
        "operator/web/joint_delivery.css",
        "operator/extensions/joint-delivery.json",
        "source_tools/receive_joint_delivery.py",
        "source_tools/receive_joint_delivery_browser.mjs",
        "JOINT_DELIVERY.md",
        "integration/component_fragments/joint-delivery.json",
        "model/common.py",
        "model/reviews.py",
        "model/review_handback.py",
        "model/review_receiving.py",
        "model/review_worklist.py",
        "operator/customer_reviews.py",
        "operator/review_app.html",
        "operator/web/reviews.mjs",
        "model/portable.py",
        "model/workspace.py",
        "operator/web/app.mjs",
    ):
        assembled_data(application, pending, name)
    descriptor = json.loads(assembled_data(application, pending,
        "operator/extensions/joint-delivery.json"))
    if (descriptor.get("schema") != "upstate.operator-extension/v1"
            or descriptor.get("id") != "joint-delivery"
            or not {"joint_delivery.mjs", "joint_delivery.css"}.issubset(
                descriptor.get("assets", []))):
        raise ValueError("Receive both registered original Joint delivery assets")
    if not {"customer.review.create", "customer.review.export"}.issubset(
            descriptor.get("requires_actions", [])):
        raise ValueError("Retain original Customer reviews actions for Joint delivery")
    if (descriptor.get("backend", {}).get("module") != "joint_delivery"
            or descriptor.get("client", {}).get("module") != "/web/joint_delivery.mjs"):
        raise ValueError("Retain original Joint delivery model and browser registration")
    app = assembled_data(application, pending, "operator/web/app.mjs")
    if b"openSavedCustomerReview" not in app:
        raise ValueError("Receive the original operator's Customer review opener")
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/joint-delivery.json"))
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "joint-delivery"):
        raise ValueError("Retain the original Joint delivery component identity")
    component = fragment.get("components", {}).get("joint-delivery", {})
    expected_paths = {
        "model/joint_delivery.py",
        "operator/joint_delivery.py",
        "source/joint-delivery/20261013/profile.json",
        "operator/web/joint_delivery.mjs",
        "operator/web/joint_delivery.css",
        "operator/extensions/joint-delivery.json",
        "source_tools/receive_joint_delivery.py",
        "source_tools/receive_joint_delivery_browser.mjs",
        "JOINT_DELIVERY.md",
        "integration/component_fragments/joint-delivery.json",
    }
    if not expected_paths.issubset(component.get("paths", [])):
        raise ValueError("Receive the complete original Joint delivery component paths")
    if not {"core", "study-transfer", "project-transfer"}.issubset(
            component.get("requires", [])):
        raise ValueError("Retain original review, Study and Project receiving dependencies")
    for name in component.get("paths", []):
        assembled_data(application, pending, name)


def verify_management_working_dependencies(application, pending):
    """Retain original unfinished Management designs and readable comparisons."""
    def source(name):
        return pending[name] if name in pending else read_existing(application, name)

    transfer = source("model/study_transfer.py")
    selector = source("operator/web/extensions/study_transfer.mjs")
    provider = source("operator/climate_management.py")
    client = source("operator/web/climate_management.mjs")
    consumers = (transfer, provider, client)
    comparison = (any(body is not None and b"climate_management_working_comparison" in body
                      for body in consumers)
                  or source("model/climate_management_working_comparison.py") is not None)
    working = comparison or any(
        body is not None and b"climate_management_working" in body for body in consumers)
    working = working or source("model/climate_management_working.py") is not None
    if not working:
        return

    paths = {
        "model/climate_management_working.py",
        "model/climate_management_working_transfer.py",
        "operator/web/climate_management_working.mjs",
        "operator/CLIMATE_MANAGEMENT_WORKING.md",
        "source_tools/climate_management_working.py",
    }
    assets = {"climate_management_working.mjs"}
    actions = {"climate-management.working.save", "climate-management.working.export"}
    routes = {("/api/climate-management/working-list", "working-list", "GET"),
              ("/api/climate-management/working-view", "working-view", "GET")}
    items = {("climate-management-working", "working-view")}
    markers = [(b"climate_management_working_transfer", b"climate-management-working",
                b"openWorkingRevision")]
    if comparison:
        paths.update({
            "model/climate_management_working_comparison.py",
            "model/climate_management_working_comparison_transfer.py",
            "operator/web/climate_management_working_comparison.mjs",
            "operator/CLIMATE_MANAGEMENT_DESIGN_COMPARISON.md",
        })
        assets.add("climate_management_working_comparison.mjs")
        actions.add("climate-management.working.compare")
        routes.update({
            ("/api/climate-management/working-comparison-catalog", "working-comparison-catalog", "GET"),
            ("/api/climate-management/working-comparison-preview", "working-comparison-preview", "POST"),
            ("/api/climate-management/working-comparison", "working-comparison", "GET"),
        })
        items.add(("climate-management-working-comparisons", "working-comparison"))
        markers.append((b"climate_management_working_comparison_transfer",
                        b"climate-management-working-comparisons", b"openWorkingComparison"))
    for name in paths | {
        "model/common.py", "model/workspace.py", "model/climate_management.py",
        "model/climate_forcing.py", "model/climate_forcing_study_transfer.py",
        "model/study_transfer.py", "operator/climate_management.py",
        "operator/extensions/climate-management.json", "operator/web/climate_management.mjs",
        "operator/web/extensions/study_transfer.mjs",
    }:
        assembled_data(application, pending, name)
    for native_marker, kind, opener in markers:
        if transfer is None or native_marker not in transfer or kind not in transfer:
            raise ValueError("Receive the original Management working Study root: " + kind.decode())
        if selector is None or kind not in selector or opener not in selector:
            raise ValueError("Receive the original Management working Study opener: " + opener.decode())
        if client is None or opener not in client:
            raise ValueError("Receive the original Management working desk method: " + opener.decode())

    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/climate-management.json"))
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "climate-management"):
        raise ValueError("Retain the original Management component identity")
    family = fragment.get("components", {}).get("climate-management", {})
    members = family.get("paths")
    if (not isinstance(members, list) or not members
            or any(not isinstance(name, str) for name in members)
            or len(members) != len(set(members)) or not paths.issubset(members)):
        raise ValueError("Retain every original Management working source and guide")
    if not {"core", "climate-forcing", "study-transfer", "extension-startup",
            "gis-projects", "scientific-report-review"}.issubset(family.get("requires", [])):
        raise ValueError("Retain original Management source/report/GIS/Study dependencies")
    for name in members:
        assembled_data(application, pending, name)

    descriptor = json.loads(assembled_data(application, pending,
        "operator/extensions/climate-management.json"))
    backend = descriptor.get("backend", {})
    declared_routes = {(row.get("path"), row.get("operation"), method)
                       for row in backend.get("routes", [])
                       for method in row.get("methods", [])}
    declared_items = {(row.get("kind"), row.get("operation"))
                      for row in backend.get("items", [])}
    if (descriptor.get("id") != "climate-management"
            or not assets.issubset(descriptor.get("assets", []))
            or not actions.issubset(backend.get("actions", []))
            or not routes.issubset(declared_routes) or not items.issubset(declared_items)):
        raise ValueError("Receive complete original Management working actions, routes, items and assets")


def verify_startup_guide_dependencies(application, pending):
    client = pending.get("operator/web/app.mjs")
    if client is None:
        client = read_existing(application, "operator/web/app.mjs")
    helper_selected = any(name in pending for name in (
        "operator/web/startup_guide.mjs", "operator/web/startup_guide.css",
        "source_tools/prepare_recipient_opening.py"))
    if not helper_selected and (client is None or b"startup_guide.mjs" not in client):
        return
    for dependency in STARTUP_GUIDE_FILES:
        assembled_data(application, pending, dependency)
    client = assembled_data(application, pending, "operator/web/app.mjs").decode("utf-8")
    index = assembled_data(application, pending, "operator/web/index.html").decode("utf-8")
    server = assembled_data(application, pending, "operator/server.py").decode("utf-8")
    helper = assembled_data(application, pending, "operator/web/startup_guide.mjs").decode("utf-8")
    for token in ("startup_guide.mjs", "attachStartupGuide", "startupGuide.observe(", "startupGuide.suspend("):
        if token not in client:
            raise ValueError("Compose the complete startup guide into the current operator app: " + token)
    for token in ("/web/startup_guide.css", 'id="startup-guide-open"'):
        if token not in index:
            raise ValueError("Compose the current startup guide stylesheet and Quick guide control: " + token)
    tree = ast.parse(server, filename="operator/server.py")
    registered = {node.value for node in ast.walk(tree)
                  if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    for asset in ("startup_guide.mjs", "startup_guide.css"):
        if asset not in registered:
            raise ValueError("Serve the startup guide's complete original browser member: " + asset)
    if "export function attachStartupGuide" not in helper:
        raise ValueError("Receive the complete maintained startup guide helper")
    fragment = json.loads(assembled_data(application, pending,
        "integration/component_fragments/workbench-startup-guide.json"))
    component = fragment.get("components", {}).get("workbench-startup-guide", {})
    if (fragment.get("schema") != "upstate.application-component-fragment/v1"
            or fragment.get("id") != "workbench-startup-guide"
            or not {"core", "recipient-workbench-opening"} <= set(component.get("requires", []))):
        raise ValueError("Compose the startup guide's original core and recipient-opening component")
    required_members = {
        "operator/web/startup_guide.mjs", "operator/web/startup_guide.css",
        "operator/web/app.mjs", "operator/web/index.html", "operator/server.py",
        "source_tools/Open_Workbench.sh", "source_tools/Open_Workbench_WSL.cmd",
        "source_tools/open_windows_browser.py", "source_tools/prepare_recipient_opening.py",
    }
    if not required_members <= set(component.get("paths", [])):
        raise ValueError("Retain the complete startup guide and recipient-opening component paths")


def verify_source_inspection_dependencies(application, pending):
    adapter = pending.get("operator/client_source_intake.py")
    if adapter is None:
        adapter = read_existing(application, "operator/client_source_intake.py")
    if adapter is not None and b"model.client_source_inspection_report" in adapter:
        for dependency in (
                "model/client_source_inspection_report.py", "model/client_source_files.py",
                "model/model_selection.py", "model/common.py",
                "operator/client_source_intake.py", "operator/extensions/client-source-intake.json",
                "operator/web/client_source_intake.mjs", "operator/web/client_source_intake.css",
                "operator/web/scientific_inspection.mjs",
                "operator/extensions/scientific-inspection.json"):
            assembled_data(application, pending, dependency)
    inspection_client = pending.get("operator/web/scientific_inspection.mjs")
    if inspection_client is None:
        inspection_client = read_existing(application, "operator/web/scientific_inspection.mjs")
    if inspection_client is not None and b"source_inspection_summary.mjs" in inspection_client:
        assembled_data(application, pending, "operator/web/source_inspection_summary.mjs")
        descriptor = json.loads(assembled_data(application, pending,
            "operator/extensions/scientific-inspection.json"))
        if "source_inspection_summary.mjs" not in descriptor.get("assets", []):
            raise ValueError("Register the source inspection summary in the existing inspection extension assets")


def verify_composition(application, pending):
    verify_source_inspection_dependencies(application, pending)
    verify_startup_guide_dependencies(application, pending)
    verify_management_working_dependencies(application, pending)
    verify_joint_delivery_dependencies(application, pending)
    verify_conservation_joint_dependencies(application, pending)
    verify_advancing_study_dependencies(application, pending)
    verify_conservation_sampling_dependencies(application, pending)
    verify_conservation_working_dependencies(application, pending)
    verify_native_observation_context_dependencies(application, pending)
    verify_sampling_native_evidence_dependencies(application, pending)
    verify_terrain_receiving_dependencies(application, pending)
    verify_multivariate_control_dependencies(application, pending)
    verify_geographic_browser_dependencies(application, pending)
    verify_geographic_received_study_dependencies(application, pending)
    verify_geographic_programme_dependencies(application, pending)
    verify_geographic_study_dependencies(application, pending)
    verify_geographic_allocation_dependencies(application, pending)
    verify_geographic_operator_dependencies(application, pending)
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
                       "published_review_study_transfer", "implementation_report_transfer",
                       "geographic_study_transfer"):
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
    # Scoped report lineage uses the same original producers and native locks.
    # Keep these optional modules together when an advancing shared reader imports them.
    source_lineage_consumers = []
    for name in ("model/study_transfer.py", "model/scientific_report_study_transfer.py"):
        body = pending.get(name)
        if body is None:
            body = read_existing(application, name)
        if body is not None:
            source_lineage_consumers.append(body)
    if any(b"source_refresh_report_transfer" in body for body in source_lineage_consumers):
        for dependency in (
                "model/source_refresh_report_transfer.py", "model/source_refresh_report_source.py",
                "model/source_refresh_receiving.py", "model/source_refresh.py",
                "model/source_refresh_legacy.py", "model/source_refresh_compat.py",
                "model/source_refresh_comparison.py", "model/native_versions.py",
                "model/model_selection.py", "model/observed_context.py"):
            assembled_data(application, pending, dependency)
    landcover_lineage = pending.get("model/landcover_study_transfer.py")
    if landcover_lineage is None:
        landcover_lineage = read_existing(application, "model/landcover_study_transfer.py")
    if landcover_lineage is not None and b"observed_landcover_study_transfer" in landcover_lineage:
        for dependency in (
                "model/observed_landcover_study_transfer.py",
                "model/observed_landcover_local_copy.py", "model/observed_landcover.py",
                "model/study_receiving.py", "model/reuse.py"):
            assembled_data(application, pending, dependency)
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


def _windows_install_platform(application, pending, allowed):
    """Use the original received platform body before application imports work."""
    if os.name != "nt":
        return None, None
    name = "model/windows_fs.py"
    current = read_existing(application, name)
    body = pending.get(name, current)
    if body is None:
        raise ValueError("Include the original Windows platform source in these packets: " + name)
    if (current is not None and body != current
            and sha(current) not in allowed.get(name, set())):
        raise ValueError("Compose the newer original Windows platform source first: " + name)
    # This is the complete same platform source carried by the checked source
    # layer. It can be loaded before common.py is updated, without importing
    # another application from sys.path or installing a second locking layer.
    namespace = {"__name__": "_upstate_windows_installer_platform",
                 "__file__": str(target_path(application, name)), "__package__": ""}
    exec(compile(body, namespace["__file__"], "exec"), namespace)
    for function in ("no_follow_open", "flock", "replace"):
        if not callable(namespace.get(function)):
            raise ValueError("The received Windows platform lacks " + function)
    if namespace.get("LOCK_EX") != 2:
        raise ValueError("Preserve the original Windows exclusive lock contract")
    return SimpleNamespace(**namespace), body


def _verify_install_platform_source(application, pending, selected):
    name = "model/windows_fs.py"
    if (selected is not None and name not in pending
            and read_existing(application, name) != selected):
        raise RuntimeError("The original Windows platform source changed; rerun these same packets")


@contextlib.contextmanager
def _extension_install_lock(path, platform):
    # The same application lock coordinates every original installer.
    if platform is None:
        with path.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield
    else:
        descriptor = platform.no_follow_open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            platform.flock(descriptor, platform.LOCK_EX)
            yield
        finally:
            os.close(descriptor)


def run(application, packet_paths, *, dry_run=False):
    application = Path(application).resolve(strict=True)
    if not application.is_dir():
        raise ValueError("Application must be a directory")
    pending, allowed, origins = read_layers(packet_paths)
    platform, platform_source = _windows_install_platform(application, pending, allowed)
    replace = platform.replace if platform is not None else os.replace
    lock_root = application / ".locks"
    if lock_root.is_symlink():
        raise ValueError("Preserve and reconcile the application's .locks symlink")
    lock_root.mkdir(exist_ok=True)
    lock_path = lock_root / "extension-install.lock"
    if lock_path.is_symlink():
        raise ValueError("Preserve and reconcile the extension installer lock symlink")
    with _extension_install_lock(lock_path, platform):
        _verify_install_platform_source(application, pending, platform_source)
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
            _verify_install_platform_source(application, pending, platform_source)
            for name in pending:
                if read_existing(application, name) != originals[name]:
                    raise RuntimeError("Concurrent authored change preserved at " + name)
            if (read_existing(application, LEGACY) != legacy or
                    read_existing(application, RETIRED) != retired):
                raise RuntimeError("Concurrent legacy registration changes preserved")
            if legacy is not None:
                # The known old descriptor owns the same twelve actions. Retain
                # its exact bytes outside *.json so the registry has one owner.
                replace(target_path(application, LEGACY), target_path(application, RETIRED))
            for name in changed:
                target = target_path(application, name)
                if read_existing(application, name) != originals[name]:
                    raise RuntimeError("Concurrent authored change preserved at " + name +
                                       "; compose current source and rerun the same packets")
                target.parent.mkdir(parents=True, exist_ok=True)
                replace(staging / name, target)
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
