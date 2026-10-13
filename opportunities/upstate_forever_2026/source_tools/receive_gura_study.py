#!/usr/bin/env python3
"""Build the original Gura scientific release from retained native runs.

Uses the original InVEST 3.20.0 sample inputs, maintained reference receiver and
subwatershed planning continuation. The explicit native-study delivery retains
the original 15 m reporting grid and its zero upstream buffer.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import sys
import traceback


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--application", type=Path, required=True)
    value.add_argument("--workspace", type=Path, required=True)
    value.add_argument("--inputs", type=Path,
                       help="Official ZIP directory for first intake; omit to verify retained Workspace inputs")
    value.add_argument("--baseline-run-id", help="Existing original Gura baseline")
    value.add_argument("--alternative-run-id", action="append", default=[],
                       help="Completed original-grid land-cover alternative; repeat in map order")
    value.add_argument("--run-planning", action="store_true",
                       help="Continue original native receiving/planning before delivery")
    value.add_argument("--max-count", type=int, default=3)
    value.add_argument("--area-ha", type=float)
    value.add_argument("--min-coverage", type=float, default=0.90,
                       help="Minimum retained common-valid subwatershed coverage (default: 90%%); measured coverage remains visible")
    value.add_argument("--feature-id-field")
    value.add_argument("--solver", choices=("deterministic", "scipy-milp"), default="deterministic")
    value.add_argument("--source-report-id", help="Optional exact saved watershed report for this cohort")
    value.add_argument("--economic-edition-id",
                       help="Include an existing completed Economic desk edition for this exact cohort")
    value.add_argument("--title", default="Gura watershed, Kenya — original study and restoration alternatives")
    value.add_argument("--contact-name", default="")
    value.add_argument("--contact-organization", default="")
    value.add_argument("--contact-email", default="")
    value.add_argument("--paper", choices=("letter", "a4", "a3"), default="a4")
    value.add_argument("--dpi", type=int, default=220)
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    if not args.title.strip() or not 120 <= args.dpi <= 600:
        raise ValueError("Supply a study title and a print DPI between 120 and 600")
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    sys.path.insert(0, str(application / "source_tools"))
    # Preserve the original receiver resource defaults when reusing completed runs.
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ.setdefault(key, "1")
    os.environ.setdefault("GDAL_CACHEMAX", "64")
    import receive_gura_native as receiver
    import receive_gura_planning as planning
    from model.client_economics import inspect_edition
    from model.common import describe_file, digest, held, identifier, read_json
    from model.delivery import build as build_delivery
    from model.model_selection import require_complete_delivery
    from model.report_release import bind_report
    from model.scenario_decisions import build as build_decisions
    from model.workspace import Workspace

    root = args.workspace.resolve()
    receiving = root / "gura-receiving"
    receiving.mkdir(parents=True, exist_ok=True)
    state_path = receiving / "gura-native-study-state.json"
    planning_path = receiving / "gura-planning-state.json"
    state = {
        "schema": "upstate.gura-native-study-operation/v1",
        "scope": receiver.SCOPE,
        "state": "starting",
        "request": {key: str(value) if isinstance(value, Path) else value
                    for key, value in vars(args).items()},
    }

    def checkpoint(stage, **values):
        state.update(stage=stage, updated_at=receiver.now(), **values)
        receiver.atomic(state_path, state)
        receiver.emit("gura-native-study-" + stage, state_path=str(state_path), **values)

    with held(receiving / ".native-study-driver.lock", blocking=False):
        try:
            checkpoint("native-cohort")
            planned = read_json(planning_path) if planning_path.is_file() else {}
            need_planning = (args.run_planning or (
                not args.alternative_run_id and
                (planned.get("state") != "complete" or not planned.get("alternative_run_id"))))
            if need_planning:
                values = [
                    "--application", str(application), "--workspace", str(root),
                    "--max-count", str(args.max_count),
                    "--min-coverage", str(args.min_coverage), "--solver", args.solver,
                ]
                if args.inputs is not None:
                    values += ["--inputs", str(args.inputs.resolve())]
                for flag, value in (
                    ("--baseline-run-id", args.baseline_run_id),
                    ("--area-ha", args.area_ha),
                    ("--feature-id-field", args.feature_id_field),
                ):
                    if value is not None:
                        values.extend([flag, str(value)])
                if planning.main(values):
                    raise RuntimeError("Original Gura planning stopped at its retained stage; inspect " + str(planning_path))
                planned = read_json(planning_path)

            workspace = Workspace(root)
            baseline_id = args.baseline_run_id or planned.get("baseline_run_id")
            if not baseline_id:
                reference_path = receiving / "gura-receiving-state.json"
                baseline_id = read_json(reference_path).get("workspace_baseline", {}).get("run_id")
            if not baseline_id:
                raise ValueError("Select the original completed Gura baseline")
            baseline_id = identifier(baseline_id)
            originals = planning.original_sources(args.inputs, receiving, receiver)
            baseline, grid = planning.original_baseline(workspace, baseline_id, originals, receiver)
            alternative_ids = list(args.alternative_run_id)
            if not alternative_ids:
                if planned.get("baseline_run_id") != baseline_id:
                    raise ValueError("Retained planning results use a different baseline; select the intended alternatives explicitly")
                alternative_ids = [planned[key] for key in ("alternative_run_id", "evaluation_run_id")
                                   if planned.get(key)]
            alternative_ids = list(dict.fromkeys(identifier(key) for key in alternative_ids))
            if not alternative_ids or baseline_id in alternative_ids:
                raise ValueError("Select distinct completed land-cover alternatives after the baseline")
            if workspace._get("scenarios", baseline["selection"]["scenario_id"])["kind"] != "baseline":
                raise ValueError("The first Gura run must retain its original baseline scenario")
            for key in alternative_ids:
                run = workspace.inspect_run(key)
                require_complete_delivery(run)
                scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
                if (run.get("state") != "complete" or scenario["kind"] != "landcover"
                        or run["selection"]["grid_id"] != grid["id"]
                        or run["selection"]["profile_id"] != baseline["selection"]["profile_id"]):
                    raise ValueError("Complete each explicit Gura land-cover alternative on the original grid and profile")
            checkpoint("cohort-ready", baseline_run_id=baseline_id,
                       scenario_run_ids=alternative_ids, grid_id=grid["id"],
                       original_pixel_area_ha=abs(grid["grid"]["transform"][0] * grid["grid"]["transform"][4]
                                                  - grid["grid"]["transform"][1] * grid["grid"]["transform"][3]) / 10000,
                       upstream_buffer_m=grid["spec"]["upstream_buffer_m"])

            study_context = {
                "delivery_mode": "native_study",
                "native_study": {
                    "title": "Gura watershed, Kenya — original InVEST 3.20.0 sample study",
                    "purpose": (
                        "Interpret original annual nitrogen, phosphorus and sediment exports, "
                        "then compare the explicitly selected restoration alternatives on the "
                        "retained Gura study grid and watershed domain."
                    ),
                    "reference": (
                        "Official InVEST 3.20.0 NDR and SDR sample archives; original release "
                        "parameter files, raster inputs, watersheds and biophysical tables "
                        "are retained in the scientific workspace."
                    ),
                },
            }

            source_report_id = args.source_report_id
            economic = {}
            if args.economic_edition_id:
                edition_root, edition, _, economic_report = inspect_edition(workspace, args.economic_edition_id)
                physical = economic_report["physical_source"]
                if physical["selection"]["run_ids"] != [baseline_id, *alternative_ids]:
                    raise ValueError("The economic edition requires its exact original ordered Gura cohort")
                if source_report_id not in (None, physical["id"]):
                    raise ValueError("Use the economic edition's exact source watershed report")
                source_report_id = physical["id"]
                economic = {
                    "economic_edition_id": edition["id"],
                    "economic_edition_sha256": describe_file(edition_root, edition_root / "edition.json")["sha256"],
                }
            if source_report_id is None:
                report = build_decisions(workspace, {
                    "schema": "upstate.scenario-decision-selection/v1",
                    "title": args.title.strip(),
                    "run_ids": [baseline_id, *alternative_ids],
                    "zones": [],
                    **study_context,
                })
                source_report_id = report["id"]
            selection = {
                "title": args.title.strip(),
                **study_context,
                "baseline_run_id": baseline_id, "scenario_run_ids": alternative_ids,
                "source_report_id": identifier(source_report_id),
                "source_roles": {}, "overlays": {},
                "contact": {"name": args.contact_name, "organization": args.contact_organization,
                            "email": args.contact_email},
                "map_settings": {
                    "paper": args.paper, "dpi": args.dpi, "display_percentile": 98,
                    "weights": {"nitrogen_export": 1, "phosphorus_export": 1, "sediment_export": 1},
                },
                "notes": [
                    "Gura watershed, Kenya; original 15 m projected reference grid and zero upstream buffer.",
                    "The selected alternatives are declared land-cover treatments evaluated by the retained native engines.",
                    "Reporting-area and model-domain totals describe their own retained geographic supports.",
                ],
                **economic,
            }
            binding = bind_report(workspace, selection)
            selection["source_report_sha256"] = binding["report_sha256"]
            checkpoint("report-ready", source_report_id=source_report_id,
                       source_report_sha256=binding["report_sha256"],
                       economic_edition_id=args.economic_edition_id)
            selection_path = receiving / ("native-study-selection-" + digest(selection) + ".json")
            receiver.atomic(selection_path, selection)
            checkpoint("delivery-building", selection_path=str(selection_path))
            release = build_delivery(workspace, selection)
            if release.get("state") != "complete":
                raise RuntimeError("The original native-study delivery did not complete")
            directory = root / "deliveries" / release["id"]
            files = {name: {**record, "absolute_path": str(directory / record["path"])}
                     for name, record in release["files"].items()}
            checkpoint("complete", state="complete", completed_at=receiver.now(),
                       delivery_id=release["id"], output_directory=str(directory),
                       package=release["package"],
                       files=files, map_families=list(release["manifest"]["maps"]),
                       source_report_id=source_report_id)
            return 0
        except Exception as error:
            checkpoint("error", state="error", error={
                "type": type(error).__name__, "message": str(error),
                "traceback": traceback.format_exc(),
            })
            logging.exception("Original Gura study release failed at its retained stage")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
