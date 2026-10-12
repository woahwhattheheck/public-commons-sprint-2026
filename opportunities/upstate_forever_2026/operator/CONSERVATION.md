# Conservation planning in the Upper Savannah operator

Operation: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1.

This addition carries retained planning-unit geometry through a complete candidate inventory, explicit land selection, saved portfolios, editable GIS/tabular exports and original land-cover scenarios. It uses the existing authenticated operator, task queue, Workspace and scientific engine. Code is covered by the repository MIT license. Scientific interpretation: Needs expert review.

## Install into the current application

Use the complete additive source directory beside this guide. The application argument points to the current cumulative Upper Savannah application containing model/workspace.py and operator/server.py.

    python -B /absolute/addon/operator/install_conservation.py --application /absolute/current/upstate_forever_2026

For a decoded complete JSON source packet, materialize its installer first and use:

    python -B /absolute/installer.py --application /absolute/current/upstate_forever_2026 --source /absolute/conservation-source.json

The installer verifies every retained source body, installs the complete model/operator files and composes the current server, browser and navigation registrations. It retains before/after source and automatically restores its own writes if an installation fails. Running the same edition again is idempotent. Stop and restart the local operator normally after installing Python source, using the original application's startup command and its printed authenticated URL.

The current scientific application supplies Python, NumPy, Rasterio, Fiona, Shapely and pyproj. Source-context inventories need the geospatial stack; native quantitative inventories also need completed original InVEST run outputs. The producer code and Workspace records travel in the existing full-project backup.

## Operating journey

| Step | Click or select | What to see and explain |
| --- | --- | --- |
| Open | Choose the intended Workspace, then **Conservation plans**. | Retained studies and saved portfolios for this project. Existing study IDs identify a precise original input selection. |
| Define | **New study**. Name its purpose and choose the actual unit type: parcel, watershed or management unit. | The inventory keeps original IDs and source geometry. Use **Original sources** or the source inspection control to inspect real field and layer names. |
| Choose geometry | Select the planning-unit source and its native ID field. In source-context mode select the reporting source and analysis CRS. | Full original area and the portion inside the reporting boundary have separate fields. The regional source uses native lowercase huc12. |
| Add context | Select any available protected land, drinking-water geography or high-quality-water source, with its reference and geographic relation. | The result describes overlap with the actual selected source edition. A utility-focus HUC is labeled as utility-focus geography. |
| Set priorities | Choose eligibility thresholds and explicit score settings, or leave context weights empty for manual land selection. | Every exclusion has a reason. N, P and sediment keep their own quantities and units. Scores explain their normalization and weights. |
| Compute | **Build candidate inventory**. Open its retained operation, then **Open conservation study**. | The complete candidate inventory is searchable, sortable and paginated. A page is a view of all candidates; selections persist while paging or refreshing. |
| Inspect | Click a candidate name. Compare original area, reporting area, context, physical quantities and coverage. | Native comparisons expose alternative support and common support separately. Signed differences describe the chosen complete scenario. |
| Select | Check the intended units, then **Create portfolio**. Choose manual or ranked selection, and any sourced cost, area or count limits. | Select whether an area budget refers to full original units or reporting footprints. Currency and unknown costs remain visible. |
| Save | **Create saved portfolio**, then open that retained result. | The portfolio recomputes quantities and context on the geometric union. Overlapping units keep their identities while shared land contributes once to physical totals. |
| Export | **Export this saved portfolio** or **Export candidate inventory**. Open the operation's download. | The ZIP opens at index.html and includes full CSV/JSON, editable GeoPackage geometry and the original selections. |
| Reopen | Return to all records or close and reopen the original operator URL; open the portfolio under **Saved portfolios**. | Its study, actual selected IDs, selection settings, physical union and export files remain available. |
| Revise | **Use these units in a new portfolio**, or define a new study selection. | Each changed saved selection creates its own retained version. |

A **source-context** study computes geometry and selected-source relations. A **native-model** study binds the inventory to a completed baseline and any completed alternatives on the same original grid. Source-context planning lets the operator use the original watershed geometry while native results are prepared.

## Model the actual selected intervention

Open a saved portfolio and choose **Create land-cover scenario**. Give the scenario a title and an explanation, enter the original integer land-cover codes that may change, and select the replacement code. Use codes present in the actual retained land-cover source and the selected parameter table.

The bridge retains the portfolio's exact selected_union GeoPackage layer as a new original vector source, calls Workspace.save_scenario with that mask and the explicit class change, and optionally calls Workspace.prepare_run with the chosen existing grid/profile. The selected grid must cover the complete footprint. Use the South Carolina reporting study's plan with a reporting grid restricted to that study.

The completed operation offers **Open land-cover scenario** and, when requested, **Open native run**. Start that native run through the existing run controls. Compare its retained outputs with the matching baseline, then create a native-model conservation study selecting those actual result IDs.

A difference inside a selected footprint from an earlier whole-scenario run is a contribution within that earlier case. Running the scenario with the saved selected footprint calculates the particular proposed land change. The bridge therefore connects the planning choice to the original model.

## Quantities, coverage and costs

Nitrogen and phosphorus annual export remain kg/year; sediment remains metric tonnes/year. Original InVEST 3.20 rate rasters are multiplied by the actual polygon-cell intersection hectares once. Boundary allocation assumes the modeled rate is uniform inside the original cell. The model's spatial resolution remains unchanged.

A scenario delta uses only the shared valid pixels for that pollutant. The display retains the baseline, alternative and common-support coverage, as well as source/profile identities. Native stream omissions have their own coverage accounting. A missing quantity appears unavailable; a computed zero remains zero.

A portfolio's physical quantities refer to its reporting-area union. Full-unit union area, reporting union area, summed individual area and overlap are retained separately. The area budget records its chosen basis. Original costs apply to entire units; a missing original cost stays unknown. A monetary limit or cost-efficiency ordering requires the retained cost table and currency.

Ranked portfolios follow the chosen deterministic greedy ordering and check the next prospective spatial union against all limits. The full ordering, rules and selected IDs remain saved. See model/CONSERVATION.md for the scientific method and complete specification.

## Operate the retained regional sources

From the installed current application directory:

    python -B operator/conservation_regional_receiving.py --workspace /absolute/current-workspace --domain-manifest /absolute/dbc61-upstate-model-domain-20261012/sources.json

An already-imported original domain is reused; the manifest argument can then be omitted. If available, pass the original geography sources.json using --geography-manifest. When that edition is absent, the runner receives only the five pinned original public PlanningBasins2023 files, verifies their retained hashes and imports their original source manifest before continuing the South Carolina study. The runner resolves the original source bytes and preserves their existing identities, builds the upstream and South Carolina reporting studies, saves actual utility-focus selections, exports each packet and reopens each plan through a new Workspace instance. Its regional-receiving.json records the actual source/study/plan paths, complete selection, exported packet and stage elapsed times.

The retained domain consists of 217 original HUC12 features. The utility-focus IDs are 030601010703, 030601010704, 030601020502 and 030601020507. These select the existing watershed polygons. The South Carolina study uses PlanningBasins2023's original feature where Basin equals Upper Savannah. The reporting mask is selected from that original feature; the intersecting HUC12 set is a separate geography.

The same runner can create a scenario from its saved plan with explicit --from-codes, --to-code and --scenario-reason. --scenario-study selects upstream or reporting. Supplying both --grid-id and --profile-id also prepares the original native run.

## CLI and operator interfaces

The scientific CLI supports overview, prepare, build, inspect, selection, plan-save, plan-inspect and export. Example:

    python -B -m model.conservation_cli --workspace /absolute/current-workspace overview
    python -B -m model.conservation_cli --workspace /absolute/current-workspace build selection.json
    python -B -m model.conservation_cli --workspace /absolute/current-workspace plan-save portfolio.json
    python -B -m model.conservation_cli --workspace /absolute/current-workspace export STUDY_ID --plan-id PLAN_ID

The existing task queue accepts conservation.prepare, conservation.build, conservation.plan.save, conservation.export and conservation.scenario.create. Authenticated reads are /api/conservation/overview, /api/conservation/study?study_id=ID and /api/conservation/plan?plan_id=ID, with the usual workspace query. The browser uses the same queue and retained read methods.

Source-context and native-model states, exact source selections, coverage and practical run timings should accompany a walkthrough recording. Use the receiving result's actual stage timings when narrating a prepared result and a fresh operation.

## Original references

- RFP: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf
- Native NDR 3.20 contract: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- Native SDR 3.20 contract: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Current full-product work order: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791846014898459
