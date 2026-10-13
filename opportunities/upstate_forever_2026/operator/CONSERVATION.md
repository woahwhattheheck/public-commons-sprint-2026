# Conservation planning in the Upper Savannah operator

Operation: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1.

This addition carries retained planning-unit geometry through a complete candidate inventory, explicit land selection, saved portfolios, editable GIS/tabular exports and original land-cover scenarios. It uses the existing authenticated operator, task queue, Workspace and scientific engine. Code is covered by the repository MIT license. 

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

The existing task queue accepts conservation.prepare, conservation.build, conservation.plan.save, conservation.export, conservation.scenario.create, conservation.criteria.prepare and conservation.experiment.prepare. Authenticated reads are /api/conservation/overview, /api/conservation/study?study_id=ID and /api/conservation/plan?plan_id=ID, with the usual workspace query. The browser uses the same queue and retained read methods.

Source-context and native-model states, exact source selections, coverage and practical run timings should accompany a walkthrough recording. Use the receiving result's actual stage timings when narrating a prepared result and a fresh operation.

## Original references

- RFP: https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf
- Native NDR 3.20 contract: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- Native SDR 3.20 contract: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Current full-product work order: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791846014898459


## Published parcel criteria and practice scores

Select the original parcel source and its native identifier field. The exact unit selection preserves typed values, including identifier text with leading zeros. Choose the reporting geography, or a completed native baseline with its original grid. Published practice scores require parcel units. Watershed and management-unit inventories retain their existing geometry and native-quantity workflows.

Choose Published practice points in the scoring controls. The operator reads the maintained Lake Keowee method catalogue, including each practice's criteria, point maximum and priority ranges. It uses the selected category's published purpose. The complete method, original source pages and interpretation choices are in model/KEOWEE_PRIORITIES.md.

Build criteria from imported layers queues the actual parcel derivation. The builder resolves retained original overlays, intersects them with the selected parcels, and imports a criterion table with its source editions and coverage. Native-context derivation uses the retained grid's original land-cover source. Its JSON table binds the exact parcel geometry selection, reporting geometry and source bodies. Use prepared parcel criteria reopens that original study before selecting the generated table; the same geometry binding is checked when the points are calculated.

Land-protection acreage uses the complete original parcel geometry. Reporting-area intersections and native output coverage have separate fields. Choose the first-order Appendix D variant only when the retained stream-order column is available; the system derives the criterion from those orders. The Table 31 variant uses first- and second-order streams. The method guide documents the published difference.

The original export-priority categories can come from the retained criterion table. When a completed baseline contains both NDR and SDR, Current-study native export classes derives three classes from actual parcel-mean nitrogen, phosphorus and sediment outputs. The retained interpretation identifies that current-study adaptation and records its cutoffs. NDR-only and SDR-only inventories keep their actual output availability.

Build the inventory to calculate the selected practice points. Candidate rows show point totals and priority labels; the details expose individual criterion contributions and their original sources. A known zero and an unavailable criterion remain distinct. The model retains known points and unresolved contributions. These records travel with the candidate exports and the saved portfolio.

## From a portfolio to native experiments and ensemble maps

Open a saved portfolio and choose Create land-cover scenario. Record the source and replacement land-cover codes and the purpose of the change. The scenario uses the unique selected footprint, and its native profile must contain coefficients for the replacement class.

Continue with offers three paths: save the scenario, prepare its native run, or prepare a paired experiment. The native paths select an existing grid, an existing profile and NDR, SDR or both. The native scope controls list NDR and SDR against the selected completed grid and retained profile. Unsupported choices are disabled. A matching study baseline supplies the initial selected families; changing the grid or profile recomputes their compatible intersection. A deliberately selected partial scope remains explicit in the request. Completed grids keep their original model resolution. A complete model domain must contain the selected footprint; reporting-area overlap is measured separately.

A paired experiment finds or prepares the original land-cover baseline on that same grid, profile and model choice. Additional retained profiles receive their own matched original baseline. The interface lists explicit completed original baselines only when their grid, profile, selected model families and retained InVEST version match. Additional-profile controls display native-family compatibility, while preparation verifies each original coefficient table, its retained checksum, every original grid land-cover class and the scenario replacement class. Optional parameter axes use the maintained experiment schema: path, values and reference. The experiment editor provides the complete native parameter controls and published design presets. No native models execute while a scenario or experiment is being prepared.

Open paired experiment from the finished operation to run the cases through the existing workspace queue. The experiment retains native outputs, common-support comparisons, candidate metrics and its HTML, CSV and JSON reports. Completed native cases can also be received from the compute programme and synchronized into the same retained experiment.

Saved conservation scenarios remain visible after reopening the application or restoring a portable workspace. Their experiment rows show current case progress from the actual retained experiment, with preparation history kept separately. Open an existing experiment or prepare another one using the same original conservation footprint. A scenario saved before choosing a native grid can acquire its first paired experiment through these controls.

After the native pairs finish, the experiment's paired-ensemble control previews the actual members and source references. Each land-cover alternative becomes a separate product with one member per retained profile and the selected native pollutants. The maintained all-pairs support and chosen quantiles determine the resulting ensemble maps. Open and export those products through the existing paired-ensemble workflow.

## Execute and reopen the regional native journey

The receiving runner accepts the selected native families using --models ndr, --models sdr or --models ndr sdr alongside its existing --grid-id and --profile-id. The explicit original land-cover arguments remain required.

Add --prepare-experiment to retain the matching experiment, or --execute-experiment to calculate it and reopen its completed summary from a new Workspace instance. --experiment-title records the experiment title. Repeat --experiment-profile-id for additional actual profiles. --experiment-axes reads the parameter-axis array from an existing JSON file; --experiment-design chooses one_at_a_time or factorial. All native work uses the maintained experiment engine and original workspace locks.

The receiving record includes the scenario and experiment IDs, native stage result, report files and reopened summary. Its state is written between stages so an interrupted command can resume through the same retained model and experiment identities.

The additional queue actions are conservation.criteria.prepare and conservation.experiment.prepare. The conservation overview includes published_methods and scenario_bridges. These additions use the existing authenticated operator and task queue. The overview also lists criteria_operations so a restored workspace can reopen a completed table or resume its saved source derivation without old task history. conservation.criteria.prepare accepts operation_id for that retained continuation.


The parcel import desk can open this same form with data-action="conservation-new-parcel-study", data-source-collection and data-source-id. Optional data-layer, data-id-field, data-label-field, data-where and data-study-title retain the actual imported source selection. data-where contains a typed JSON object. The operator opens a fresh parcel study; reporting-area or native-baseline selection continues in the existing conservation controls.


## Registered operator integration and live experiment progress

The provider remains the same Conservation class and original task queue. Its declared actions include parcel criteria and paired-experiment preparation. Register each route and queue action once when the cumulative application uses the extension host. The separate conservation-optimization descriptor retains its own queue and the same original Conservation plan IDs.

The client exports attachConservation with render, mount, detach, dispatch and taskActions. A new mounted Conservation view renders its section before mounting; ordinary host updates preserve current form inputs and selection. The module listens to the existing task feed for conservation operations and the exact experiment.save, experiment.run and experiment.summarize actions, including published progress. Completing or summarizing an experiment refreshes the saved-scenario cards through the same overview.

Controls arriving from a task or another desk must close the current detail view and navigate to Conservation before dispatching conservation-open-study, conservation-open-plan, conservation-use-criteria or conservation-new-parcel-study. The imported parcel callback retains the exact source, layer and typed filter. Its full registration contract is above. Native run/scenario buttons and experiment-show continue through the existing host dispatch.

The native scope is retained independently for each new portfolio scenario. Reopening a saved scenario keeps that scenario's original identity while allowing a further compatible experiment. Changing a profile does not silently replace an explicit baseline or incompatible selected comparison profile; the form identifies the mismatch and asks for a compatible selection within the same workflow.

## Actual source-water protection receiving

The cumulative regional receiver supports protection_upstream and protection_reporting when the actual retained public-water source has been prepared. These are distinct from utility-focus watershed geography. Their original candidate table, positive source-water overlap cohort, optimizer analysis and saved plan remain in the same Workspace.

Run the browser receiver against that actual regional record and the current local operator startup receipt:

    python -B operator/conservation_browser_receiving.py \
      --operator-receipt /absolute/local-operator-startup.json \
      --regional-receiving /absolute/current-workspace/conservation-receiving/regional-receiving.json \
      --study-key protection_upstream \
      --output /absolute/conservation-browser-receiving \
      --chromium /usr/bin/chromium

The runner uses the actual eligible original HUC IDs with positive published protection overlap, selects through the rendered controls, saves the portfolio through the original queue, reloads and reopens it, and downloads its exported packet. The report retains the chosen original candidate rows and source regional plan ID alongside the actual task IDs, four screenshots and optional video. Use the same output directory to resume an interrupted receiving operation. The original upstream study remains the default when --study-key is omitted.

## Published-practice optimization

The queued conservation-optimization catalog exposes published_axes alongside context_axes and physical_axes. The published-method objective uses the selected original practice's complete point score and prerequisite; its category, retained criterion sources, original priority definition and native support remain visible. Physical pollutant quantities and geographic context keep their own units. The original optimizer writes the selected plan through Conservation, so its study and plan controls reopen the same saved selection. See operator/CONSERVATION_OPTIMIZATION.md and model/CONSERVATION_OPTIMIZATION.md for the full native request and export shape.
