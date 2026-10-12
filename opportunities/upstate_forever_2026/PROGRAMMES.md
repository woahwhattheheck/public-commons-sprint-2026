# Native run programmes

This component adds a reusable execution and recovery service to the existing Upper Savannah Scientific Workbench. It accepts expanded scientific cases from the experiment planner and runs them through the retained Workspace and native InVEST engine.

Open **Native model runs → Run programmes** in the current operator, or use its existing authenticated address followed by **#programmes**. The application keeps the current workspace, original data selectors, model grids, profiles, spatial review, customer review and backup workflow.

## Complete operator workflow

1. Prepare or select a completed model grid, saved parameter profiles and land-cover scenarios in the existing workbench.
2. Open **Run programmes**. Choose **Create programme** to group prepared cases, or **Import selections** to receive the complete expanded case list from the experiment planner.
3. Review the named cases and distinct native selections. Save the programme. Its identity binds the complete selected grid, profiles, scenarios, case labels and source reference.
4. Open the saved programme and choose **Continue unfinished runs**. Each case appears with its original native run ID, state, completed stages and error, when present. **Run selected cases** operates on a selected subset while retaining the entire programme.
5. Use **Pause after current run** to request a checkpoint between native calculations. The request is delivered immediately to the programme controller, independently of the single native worker queue. The current native run finishes before the next one starts.
6. Reopen the programme after an interruption and continue it. Completed native stages are reused under their original identities; failed cases keep their causes. Original logs and output artifacts remain available through **Inspect run** and **Log**.
7. Build the result catalogue. Download its original JSON, CSV and method notes, inspect physical units and valid coverage, and pass exact run IDs to the watershed decision-report and map-release workflows.
8. Save the ordinary complete Workspace backup and restore it with the current operator. Programme selections, progress, pause state and generated reports travel in that same working archive.

The **Copy selections** action creates another selected programme while retaining the original. Changes to an experiment's coefficients happen in the experiment/profile workflow before its expanded rows enter this controller.

## Install into the maintained application

The source edition contains the two model modules, operator adapter, browser component, stylesheet, this guide and the installer. Receive it beside the existing full application.

    python -B install_programmes.py --application /absolute/path/to/current/application

The installer reads the current shared operator and browser files, inserts the programme registrations, and preserves the other registered modules and static assets. It validates the Python source before replacement and checks each current file again at its replacement boundary. An already-installed identical edition is reusable. If a programme-owned file already has different authored contents, reconcile that exact edition before updating it.

The existing operator must be restarted after source installation so it imports the new backend. Use the same original workspace and operator state directory. The normal startup command and capability URL remain the opening route.

## Expanded selection contract

    {
      "schema": "upstate.compute-programme-selection/v1",
      "title": "Selected Upper Savannah calculations",
      "grid_id": "EXISTING_GRID_ID",
      "baseline_run": "baseline",
      "runs": [
        {
          "key": "baseline",
          "title": "Current land cover / selected profile",
          "profile_id": "EXISTING_PROFILE_ID",
          "scenario_id": "EXISTING_BASELINE_SCENARIO_ID"
        }
      ],
      "source_reference": "Original experiment or scientific source reference"
    }

Replace the ID labels with the complete identifiers returned by the actual Workspace. The programme accepts one or more explicit named cases. Additional rows use their actual retained profile and scenario IDs. Optional **reason**, **experiment_key** and **changes** fields preserve the experiment designer's explanations. All cases refer to the selected real grid.

Parameter planners can construct this selection directly. The service validates existing selections and native compatibility; source acquisition and scientific parameter generation retain their existing owners.

## Shared Python service

Import **ComputeProgrammes** from **model.compute_programme** and construct it with the current **Workspace** instance.

| Method | Result |
| --- | --- |
| catalog() | Lightweight programmes and current grid/profile/scenario choices |
| preview(selection) | Validated expanded named selections and native identities |
| create(selection, source_reference=None) | Persisted programme |
| status(programme_id) | Saved selections, live native states, stages, errors and counts |
| execute(programme_id, only_runs=None) | Native execution and continuation |
| pause(programme_id) | Immediate request to pause between native runs |
| resume(programme_id, only_runs=None) | Continued original execution |
| report(programme_id) | Saved metadata-based result catalogue |
| read_report(programme_id) | Previously saved catalogue, without a raster calculation |
| delivery_preview(programme_id, selection) | Required later release selections and compatibility |
| prepare_delivery(programme_id, selection) | Complete native release using the selected finished runs |

The native CLI is **python -B -m model.compute_programme_cli --help**. Its subcommand help gives the exact current arguments. Use that same application and Python environment as the original Workspace.

## Operator API

The current operator's authentication, request identities and task queue apply to every route.

| Route | Request / behaviour |
| --- | --- |
| GET /api/programmes/catalog?workspace=… | Programme and prepared-input catalogue |
| GET /api/programmes/detail?workspace=…&programme_id=… | Saved programme and authenticated output links |
| GET /api/programmes/report?workspace=…&programme_id=… | Saved result catalogue |
| POST /api/programmes/preview | {workspace, selection} |
| POST /api/programmes/pause | {workspace, programme_id}; immediate checkpoint signal |
| POST /api/programmes/delivery-preview | {workspace, programme_id, selection} |
| POST /api/actions | Existing retained task protocol with one of the actions below |

Task actions:

- **compute.programme.save** with **{selection, source_reference?}**
- **compute.programme.run** with **{programme_id, only_runs?}**
- **compute.programme.report** with **{programme_id}**
- **compute.programme.delivery** with **{programme_id, selection}**

Supply the existing task protocol's workspace, action, payload and stable operation_id fields. A failed or interrupted original task can be continued through **/api/task/resume**. The browser retains a request identity across an uncertain response and reuses a matching failed task on retry.

External operator modules can import **attachProgrammes** from **operator/web/programmes.mjs**, using the existing workbench API/context helpers. Its **mount**, **open**, **refresh**, **detach**, **create** and **importSelections** methods provide the same execution controls inside an experiment or native-run desk.

## Calculation and release dependencies

A completed native model grid, scientific profile and selected land-cover case are the calculation inputs. A programme can run a baseline alone and retain useful output before the final release selections are complete.

The later full release still supplies its required source roles, overlays, named baseline and alternatives, observation links, cartography choices and contact metadata through the existing native delivery service. The current original grid and native run contracts require the complete selected NDR/SDR input stack. Stage-specific source/native preparation can extend that contract separately.

## Interpreting retained quantities

The result catalogue carries each artifact's recorded physical unit, valid pixel count and supported area. Whole-run totals use each run's actual valid coverage. Pairwise changes refer to the original comparison's common valid support. The full watershed decision-report producer owns catchment aggregation, paired denominators and the detailed scientific interpretation.

The programme preserves parameter designs and source references chosen by the experiment builder. InVEST's version-specific calibration guidance describes explicit sensitivity runs and subsequent comparison with compatible observations. Observation comparisons require the relevant measurement, units, time period and catchment.

Primary method sources:

- [InVEST 3.20.0 freshwater calibration and sensitivity](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html)
- [InVEST 3.20.0 Nutrient Delivery Ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST 3.20.0 Sediment Delivery Ratio](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

## Source operation

**UPSTATE-SCIENTIFIC-PROGRAMMES-A73C-20261012**, part of **UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012**.

Implementation: TokenJunkieLabs. Existing application and third-party license notices remain with their source.
