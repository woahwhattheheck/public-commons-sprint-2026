# Native energy analysis

This operator runs the original nmecr R package against one explicitly selected BuildingSync energy stream and a complete observed-weather CSV. It keeps the original XML, selection, weather, timezone decisions, native frames, fitted models, coefficients, statistics, reporting predictions, uncertainty calculations, plots, logs and package identities together.

## Runtime installation

The application needs Python 3.11 or newer on a POSIX host, R, and the imports declared in analysis-dependencies.json. R is a host runtime; queued analysis jobs do not install software. Install into an owned R library:

    python3 install_analysis.py --directory /absolute/analysis-runtime/source --library /absolute/analysis-runtime/library --install-dependencies

The installer receives the public source archive at nmecr commit 343146d7a1e20d027e6ca48bd7ca2b38c646592a, verifies every one of its 102 original Git blobs against nmecr-source-index.json, retains the complete source, installs the native package and saves original source plus installed-file identities. An already received original archive can be supplied with --archive. --rscript chooses an existing host Rscript. --install-dependencies authorizes this host setup to install missing R imports from CRAN; omit it when the host already supplies them.

Set R_LIBS_USER to that owned library before starting the application. AUDIT_RSCRIPT can name an explicit Rscript executable or a host's private runtime launcher. The package version is 1.0.18. Its original monthly interval joins require dplyr 1.1.0 or newer. Full dependency versions, sessionInfo(), commands and original installation logs remain in the case.

On a host with an existing supported R installation, the source installer needs no compiler for nmecr itself. Some imported packages contain compiled native code; provide the host's ordinary binary packages or compiler toolchain for those dependencies. The installer preserves native installation errors in their complete logs.

## Choosing the source

Select a source and revision, one building, one scenario, one resource, one exact stream, Total reading type and its original energy units. Every reading must resolve to that same combination. Original decimal literals and interval boundaries stay in selection.json and original.xml. A floating-point frame is created only for the native R computation.

The seven streams in the published combined L100 + BSyncr example include electricity Total, Peak and Cost; natural-gas Total and Cost; and onsite-generation Total and Cost. Only its three Total energy streams enter this energy model path. Peak kW and currency amounts remain separate quantities. Volume-based fuels require a documented original calorific conversion before entering an energy model.

The published example contains an address/coordinate conflict and no UTC offsets in its timestamps. The operator must retain a chosen timezone and weather-station rationale with this example. The software preserves original coordinates and never silently geocodes a replacement.

## Weather

Attach the full original UTF-8 CSV and supply its name, source URL or acquisition reference, SHA-256 and byte length. Default column names are time and temp. An explicit mapping can choose the original source's names:

    {
      "sourceTimezone": "UTC",
      "weatherTimezone": "UTC",
      "weatherColumns": {"time": "DATE", "temp": "TEMP", "station": "STATION"},
      "weatherUnits": "F",
      "weatherInterval": "Daily"
    }

This is a format example. Use the timezones, units and interval stated by the actual source. Temperatures in C are converted to F in the native frame while the original values remain intact. Weather must be at least as frequent as the meter interval, cover its entire start-inclusive/end-exclusive period, and have no missing or overlapping intervals within that period. Missing sentinel values can be declared through weatherMissingValues. The operator never chooses a nearest observation to fill a gap.

The original weather file may contain additional complete periods for explicit normalization. Complete original rows remain in weather.csv; weather-native.csv records the actual Fahrenheit conversion and original CSV line number. Station/source information remains in weather-metadata.json.

## Model options

models chooses from Mean, SLR, 3PC, 3PH, 4P, 5P, HDD, CDD, HDD-CDD, TOW and TOWT. The default runs all eleven and returns an explicit applicability result for each. TOW/TOWT support submonthly data; HDD/CDD models support Daily/Monthly data. There is no automatic substitution for an unsupported interval.

interval can explicitly select 15-min, Hourly, Daily or Monthly matching the original meter interval. Energy is never silently resampled. Missing meter ends require an explicit endPolicy: next-reading with lastEnd, or frequency with a supported interval. The default requires original ends. Offset-free timestamps require sourceTimezone/weatherTimezone. Ambiguous or nonexistent local clock times require an actual original offset.

modelArguments forwards the original assign_model_inputs controls:
has_temp_knots_defined, equal_temp_segment_points, temp_segments_numeric, temp_knots_value, initial_breakpoints, occupancy_threshold and day_normalized. The energy path leaves demand timescale_days unset. balancePoint specifies the real degree-day base in F, default 65; existing daily degree days are aggregated through the original package. Monthly SLR/HDD/CDD use physical predictors after date-boundary metadata is removed from their regression inputs. The complete native frame remains retained.

baseline and reporting each have start and end, using whole original intervals and at least three readings. They must be disjoint. Reporting-period predictions and nmecr uncertainty are calculated only when both periods are explicitly selected. normalization also selects a start/end window from complete supplied observed weather and fits the actual reporting-period model before calling the native normalized-savings API. These are analytical comparisons of the supplied periods; no intervention is inferred from a date split.

confidenceLevel defaults to 90. seed defaults to 20261012. timeoutSeconds defaults to 3600 and can be 30 through 86400. allowNegativePredictions forwards the original native option; the package applies it to TOW/TOWT. Mean prediction uses stats::predict on its actual native intercept model because the upstream prediction dispatcher has no Mean branch. All calls, original fitted objects and decisions remain in the output.

## Retention and continuation

The workspace worker holds operation.lock through the actual R lifetime. Direct run_analysis calls use that same lock. A supplied lease_fd is inherited by every native subprocess, so a lost controller cannot start a second writer while the original R process is still active.

Input identity includes the original source, selection, weather, options and engine source identities. A complete cached result is reused only after every retained output matches its recorded length and SHA-256. Every model has its own retained terminal checkpoint and complete object; an interrupted catalogue resumes from valid completed model checkpoints.

metadata.terminal distinguishes a complete original outcome from a recoverable native interruption. metadata.resumable is true for unfinished runtime/native failures. Installing the runtime or resuming after a timeout uses the same analysis identifier and original input. Immutable input errors require a new corrected selection. A completed native model failure remains its actual outcome; change model options intentionally to run another analysis.

Statuses are complete, partial, failed, needs-input, needs-runtime and running. A partial result contains successful fitted models alongside actual native failures. Its original warnings/errors remain accessible. Signed NDBE/NMBE and all native statistics are preserved. JSON represents non-finite numbers as null; full RDS, R text and CSV preserve the original native forms.

## Native receiving operation

The accompanying receiving programme uses the complete original BuildingSync example and acquired observed weather, then the original package's published datasets for daily model coverage. It retains original source identities, full input frames and every original model outcome. It exercises actual native APIs and the application's lease/continuation path. Model convergence and uncertainty failures are recorded as native outcomes, with successful results preserved.

The official sources are https://github.com/kW-Labs/nmecr and https://kw-labs.github.io/nmecr/. The complete bsyncr originals are reviewed for interoperability; this implementation selects original streams explicitly instead of using bsyncr's implicit first-resource/all-readings selection.

## Selected weather normalization

Normalized savings uses the selected balance point and negative-prediction policy consistently with the fitted models and reporting predictions. The installed nmecr 1.0.18 function aggregates normalization weather with a default 65°F balance point and invokes its default prediction policy. The application instead supplies the complete native weather aggregation with the operator's selected balance point, explicit inclusive start and exclusive end, and unchanged observed timestamps. It then calls the complete pinned upstream normalization body through two documented input seams: the prepared native weather and the same native prediction method used for reporting. Every original savings and uncertainty expression is retained. The package itself stays unchanged.

The original upstream prediction dispatcher has no Mean branch. Mean predictions use `stats::predict` on the actual fitted native intercept model, with the selected monthly day normalization and negative-prediction policy. Other models use `nmecr::calculate_model_predictions`.

Each model retains the original and adapted function representations, selected input policy, complete original weather, native aggregated weather, both complete prediction series and the full native normalization return. Receiving checks the complete selected weather window, native interval boundaries and prediction rows. A native aggregation that omits a selected period reports a normalization error while retaining the fitted models, statistics and all original output. Undefined uncertainty arithmetic stays in the original RDS/R/CSV output; its JSON representation follows the existing non-finite-value policy.

The complete Python analysis identity includes both the R engine and Python wrapper hashes. Existing completed or interrupted model directories retain their original engine identity. A corrected engine is received through the existing deliberate analysis continuation or a new original analysis, preserving prior outputs. The per-model normalization checkpoint also names `nmecr-1.0.18-selected-weather-v1`.

Original implementation: [normalization](https://github.com/kW-Labs/nmecr/blob/343146d7a1e20d027e6ca48bd7ca2b38c646592a/R/normalized_savings_and_uncertainty.R), [weather aggregation](https://github.com/kW-Labs/nmecr/blob/343146d7a1e20d027e6ca48bd7ca2b38c646592a/R/aggregate.R), and [prediction](https://github.com/kW-Labs/nmecr/blob/343146d7a1e20d027e6ca48bd7ca2b38c646592a/R/calculate_model_predictions.R), all pinned to the installed original source. The full upstream MIT notice accompanies the adapted function.
