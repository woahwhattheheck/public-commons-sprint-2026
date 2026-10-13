# Dated measurements in the existing observation desk

This component connects the actual retained scientific sources to the existing Observed water quality desk. It adds a station/parameter/date plot, original-row CSV and SVG downloads, and a repeatable native import command. It preserves the current original-row search, annual-load comparison, asynchronous CSV/source-method selection guards, extension assets and all other application code.

## Existing application integration

The source was composed against merged PR2807 head 22130c9cffb89e52c70097aeabc06692725ddb0f. The actual model/observations.py is 23,618 bytes and unchanged from the maintained source; the actual app.mjs has the newer CSV race-condition repair. The installer modifies the exact ingest function, eleven narrow app seams and only the literal static-asset set inside the current server's extension union. It retains the original source bodies by SHA256. The complete Workspace, model, delivery, portable and server implementations remain the current application's versions.

Apply this additive component through the current application's existing source assembler or receive its five complete files under the application root. Then:

python source/install_observed_context.py --application /actual/application --receipt /actual/receipts/observed-context-install.json

All maintained seams and new file hashes are checked before writes. Repeating this command retains already-applied changes. The actual pre/post hashes go into its receipt. An unexpected modified seam reports its exact label so the current implementation can be composed deliberately. It never substitutes an old whole application file.

Restart the existing operator process after the source change, preserving its configured Workspace, authentication and port. This makes the Python ingest change active in its existing server. Reloading the browser then loads observed_series.mjs from the same static-asset route.

## Import the actual retained source editions

Use the same application interpreter and populated Workspace. The source root contains the original observations/ tree, including each selected manifest and its retained bodies.

python -m source.import_observed_context --workspace /actual/populated-workspace --source-root /actual/scientific-source-root --output /actual/receipts/observed-context-import.json

By default the programme selects the maintained study, hydrology and effluent-flow manifests present under that tree. A specific source can be selected with --manifest, repeated as needed:

- observations/eighteenmile_2023/model-sources.json
- observations/observed_hydrology_20261013/model-sources.json
- observations/eighteenmile_2023/npdes/flow_context/model-sources.json

The receiver also recognizes the exact earlier component hashes and upgrades that owned edition atomically with retained originals. The ingest patch accepts either the original maintained function or the component's earlier complete function.

The complete current study is in Slack F0C8JNNS1BP; the actual hydrology and monthly effluent-flow companions are in F0C8QAH0AQ2. The current study's source-bound detection classification successor is compatible: the importer reads the selected manifest's actual hash rather than hard-coding an older derived-table hash.

The programme first checks every selected table/header/hash. It imports each ordinary upstate.sources/v1 edition through Workspace.import_sources, opens its hash-bound native body through Workspace.source_file, and calls the existing Workspace.import_observations. Metadata binds source collection, original table ID/hash, manifest hash, original URI and vintage. All original CSV cells and row order remain available. The output receipt contains the actual populated Workspace path, collection IDs, observation IDs, kinds, counts and hashes. Identical sources and metadata produce the same immutable observation IDs.

## Scientific interpretation

The study intake retains all 920 original normalized results. Parameter, physical unit, fraction, sample depth and project define separate series. Dates and source clocks/timezones remain original. A non-detect is displayed at its stated bound with an open downward triangle; an above-range result uses an open upward triangle. These symbols represent censor bounds, not substituted measurements. Four original E. coli upper-quantitation-limit records are explicitly handled even in the earlier normalized edition that labeled them quantified. The remaining 676 numerical results and 240 lower bounds preserve their original values and units.

USGS daily discharge retains 33,459 actual daily means across the selected gauges. Stage and dated monthly-flow summaries are separate observation editions. Daily traces connect only consecutive original dates; missing dates break the trace. Monthly summaries retain valid/expected days, approval status and original measured volume. Blank censored or otherwise unquantified original context values retain their source status without being labeled a numeric validation failure; annual-load validation remains strict. The original detection condition and stated bound also appear in the record table. Their original hydrology period_end is inclusive; context metadata preserves that convention when displaying duration. DMR period_end_exclusive remains exclusive. The annual model-comparison period contract is unchanged. Gauge selection prevents mixing station datums or different drainage areas. The derived routine total-nitrogen view uses the source processor's fully quantified same-activity TKN + NOx result, retaining the components and censor intervals in original rows.

The monthly DMR component exposes separate fields from the same unmodified original tables:

- quantified reported amounts with actual partial coverage;
- complete source amounts only where the source processor marks the month/cohort complete;
- gross reported source mass divided by observed gauge volume;
- reported effluent volume as a fraction of observed gauge volume.

Each view retains its original reporting features, monitoring location, pollutant species, dates, coverage days, gauge relation and source-period JSON. The gross mass/volume index is a source-term calculation in mg/L; it does not become a receiving-water concentration measurement. The complete same-period gauge series remains separately selectable.

All these editions have value_basis=context. The annual model-comparison admission rules still require an explicit original annualization method, annual mass units, positive complete period, accepted qualifier and catchment ID. Ordinary context no longer requires a fictional catchment ID or annual interval. Explicit context constants only supply genuine table-wide parameter/unit labels; original cells remain unchanged.

## Operator use

Open Observed water quality, choose the retained edition, then select its parameter/unit/source group and station. Optional date filters restrict the displayed original rows. The existing record search remains immediately below the dated plot. Download selected original rows exports their actual CSV fields; Download dated plot exports the same monochrome SVG with source dates, units and point tooltips.

The importer can create fourteen distinct value views when all three complete source editions are installed. Several DMR views deliberately share the same retained original rows while selecting different physically defined output columns. The receipt reports observation rows per view, not a claim of additional independent measurements.

## Verification and native receiving

The current full patched browser module and added module were parsed in the JS runtime; the eleven app edits were applied twice against the actual current source and remained unchanged on the second pass. Every one of the 920 actual WQP rows reaches the date/value renderer: 676 reported values, 240 original lower bounds and four original upper bounds in 33 parameter/unit/depth/project groups. The model's existing comparison tail remains byte-for-byte unchanged.

The installed Python programmes must run on the equipped native application. Return the real install receipt, import receipt, existing operator Workspace ID/path, one actual censored E. coli plot and one actual USGS daily-series SVG. Use the current authenticated browser to verify source selection and source downloads in the already-populated application. These are direct receiving checks on the actual sources.
