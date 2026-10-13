# Prepare original period-specific forcing for the native study

This course prepares original precipitation and erosivity sources for the existing **Climate forcing** workflow. It reuses `source_tools.prism_period`, `source_tools.climate_region`, `source_tools.compose` and the native Workspace importer. It does not introduce a downloader, model runner or alternative raster engine.

Read the current `CURRENT_OWNER_DIRECTION.md` and project `AGENTS.md` before receiving. This source was prepared against owner direction **2026-10-13.4** and the expanded file-intake mandate: a scientist opens original files, reviews their meaning and units, chooses settings, runs the real model, then inspects readable results and reopens a complete delivery. Original files, scientific judgment and the existing Workspace remain authoritative.

## Scientific question and complete input family

A useful first comparison is the **actual 2025 PRISM annual spatial precipitation field** against the retained **1991–2020 annual normal**, on the exact same prepared model lattice and unchanged land cover, terrain, soil erodibility, source-loading profile, scenario and model/reporting masks. This measures the selected annual spatial-pattern sensitivity of the model. It is not an attribution of climate change, an event response, or a calibrated annual hindcast.

Each additional selected period becomes its own source edition, prepared grid and native run. The same period tool supports complete multi-year periods and off-calendar complete-year intervals; the scientist chooses those periods explicitly. Do not silently combine a selected year with the normal, or label years wet/dry without examining the actual retained domain summaries. Comparisons between PRISM normal products built with different station networks are not themselves climate trends.

NDR uses the actual configured runoff-proxy normalization. With its default mean normalization, a uniform multiplier can cancel. Keep the true runoff proxy, mean or explicit profile denominator and resulting spatial ratios visible. Actual NDR output is annual mass delivered to streams. It does not model event hydrographs or downstream in-stream processing.

The SDR R-factor is a separate physical input. Keep the retained NOAA long-term R-factor unchanged in a precipitation-only case. A new precipitation raster does not supply an annual R-factor or justify scaling erosivity by annual rainfall. New R-factor cases require a separately identified source or explicit defensible derivation with its own period and units.

## Source identities and current publisher routes

| Source | Meaning | Original route |
|---|---|---|
| PRISM normal | 1991–2020 mean annual precipitation, nominal 800 m / 30 arcseconds | `source/prism-precipitation-1991-2020/source-transfer.json` |
| PRISM 2025 AN | Actual received annual cumulative precipitation for 2025, nominal 800 m / 30 arcseconds | https://services.nacse.org/prism/data/get/us/800m/ppt/2025 |
| NOAA R-factor | Published long-term rainfall erosivity; retained source period 1975–1997 and publisher metadata | https://coast.noaa.gov/data/digitalcoast/zip/R-Factor-CONUS.zip |

The retained PRISM normal ZIP is **62,685,097 bytes**, SHA-256 `763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3`. Read the current source-transfer file for the exact authoritative digest and original filename before adopting the archive. Preserve the original transfer/capture record and all archive members. If a copied receipt and actual bytes disagree, use the retained original receipt and actual digest to resolve that source; never rewrite the digest to make the input fit.

The current annual publisher index is https://ftp.prism.oregonstate.edu/time_series/us/an/800m/ppt/monthly/2025/ . It lists `prism_ppt_us_30s_2025.zip`. Capture the actual response, release metadata, bytes and digest at acquisition. Do not assign the normal ZIP's identity to this annual file or infer a fixed annual-file digest from a directory listing.

The NOAA source loader retains native units `hundreds*ft*tonf*in/(acre*h*year)` and the explicitly referenced factor **17.02** to `MJ*mm/(ha*h*year)`. Apply that conversion once. Already aligned target-unit rasters deliberately have no second top-level conversion.

## Reuse the actual source and native owner

Use the existing owner of the original full-domain source store and prepared Workspace. Reconcile an already running capture by its real process/output before issuing the same selection again. Reuse a complete retained archive and receipt where available. All paths below must be taken from that worker's actual filesystem; another session's path is not a transfer mechanism.

The source-preparation worker supplies:

- Actual application directory and GIS Python executable.
- The original full upstream model-domain file, its original layer and property selector when applicable, and its companion files.
- The explicit source-coverage buffer used to cover that full domain; this is retained in the source plan. It does not replace or enlarge the saved model domain.
- Original Workspace, completed base-grid ID, exact grid definition and corresponding run/profile/scenario selections.
- The original normal and NOAA prepared source-entry paths, or their existing archive-custody return.
- A new owned source output directory beneath the retained source project root.

The South Carolina reporting mask and four utility anchors remain reporting selections. Do not use a reporting mask to clip away upstream contributing source coverage. Likewise, do not substitute the small teaching-square geometry for a real regional-domain comparison. A teaching demonstration may use its own actual original domain, with that scope plainly retained.

## Prepare an annual source with the maintained tool

Run from the actual application directory. Set these shell variables to existing observed paths and the explicit domain-buffer selection, preserving any original layer/filter:

```bash
cd "$ECO_APPLICATION"

"$ECO_GIS_PYTHON" -B -m source_tools.prism_period \
  --domain "$ECO_FULL_DOMAIN" \
  --start 2025-01-01 --end 2026-01-01 \
  --resolution 800m --buffer-m "$ECO_SOURCE_BUFFER_M" \
  --output "$ECO_FORCING_SOURCE_ROOT/prism-2025"
```

If the original selected domain is a particular layer or exact property selection, pass the existing `--layer` and `--where` arguments as well. `--where` accepts the original equality mapping as JSON; do not invent property names or collapse the whole domain to a similarly named feature.

The output directory is immutable for its selected plan. Resume that directory after an interruption. Use a new directory for a changed domain, period, resolution or selection. The tool preserves acquisition receipts and progress and validates completed members before reuse.

For a complete archive already received by the same source operation, place/adopt it at the tool's expected `original/prism_ppt_us_30s_2025.zip` path with its original receipt and use the same command with `--originals-only`. This mode prepares the actual retained file without requesting a replacement archive. Do not manufacture a complete acquisition receipt. If copying is necessary, retain byte identity and verify the copied SHA against the original source before preparation.

The normal helper in `source_tools.raster_sources prism` is specifically for the retained 1991–2020 normal. **Never pass a different annual source through that normal identity.**

### What the existing period tool actually preserves

The current tool uses the public consolidated PRISM service and validates the actual AN dataset metadata. It retains the complete ZIP, original `.info.txt`, XML and projection metadata, exact selected domain and companions, period plan, clipping details and derivation.

Whole-calendar-year archive totals replace their twelve months. Edge months of off-calendar complete-year periods are explicit. Every original precipitation period contributes exactly once; cumulative millimetres are summed and divided by the number of complete years. There is no day-weighting of cumulative totals. Only cells valid in every chosen original period survive into the mean annual source.

The output `source-entry.json` declares `PRECIPITATION`, `mm/year`, original resolution and `temporal_support` with exclusive end. For 2025, start is `2025-01-01`, end is `2026-01-01`, years is 1. The numerical annual total is therefore also that year's mean annual rate.

The output `source-manifest.json` is the normal `upstate.sources/v1` intake. `result.json` identifies its actual source ID, periods, statistics and every retained file. Use those returned values unchanged.

## Bind the actual source to the saved base grid

The forcing-study source helper imports/composes selected original sources through the current Workspace and preserves the completed base-grid definition. Select the actual returned precipitation entry and keep unselected base roles. Use the normal native source import path; do not create replacement DEM, land-cover or K entries merely to make IDs look related.

The comparison requires exact physical lattice and unchanged structural inputs: CRS, affine coefficients, dimensions, DEM/NLCD/K bytes, model-domain and reporting-area/mask bytes, profile, scenario and selected model scope. Prepared-grid and run IDs will differ when an actual forcing source changes. Preserve those distinct IDs; do not weaken existing same-grid scenario or scalar-parameter comparison rules. A change of resolution, terrain, stream definition, contributing buffer or geographic support belongs to the separate structural comparison workflow.

If the source producer already needs explicit regional climate rasters, use its existing `source_tools.climate_region` against the exact saved grid rather than another resampler:

```bash
"$ECO_GIS_PYTHON" -B -m source_tools.climate_region \
  --project-root "$ECO_FORCING_SOURCE_ROOT" \
  --grid "$ECO_SAVED_GRID_JSON" \
  --precipitation-entry "$ECO_FORCING_SOURCE_ROOT/prism-2025/source-entry.json" \
  --directory regional-prism-2025
```

The project root must actually contain the selected grid, original source files and every companion. This optional regional preparation is for the retained north-up 30-metre grid and preserves source resolution. Interpolation onto 30 metres does not turn an 800-metre observation into new 30-metre observed detail.

Use either the original prepared source or its explicitly derived regional edition in the selected input binding. Preserve its actual ID and units. Regional alignment retains the original source-entry as an `ORIGINAL_SOURCE_ENTRY` companion and all original source companions. Its top-level entry may not repeat `temporal_support`; read the retained original entry and derivation rather than inventing dates from filenames.

Where a combined source manifest is needed, the maintained composer rewrites paths and verifies originals without duplicating source content:

```bash
"$ECO_GIS_PYTHON" -B -m source_tools.compose \
  --entry "$ECO_FORCING_SOURCE_ROOT/prism-2025/source-entry.json" \
  --output "$ECO_FORCING_SOURCE_ROOT/forcing-period-sources.json" \
  --title "Original period-specific precipitation sources"
```

The composed manifest must sit above every selected source and companion. Add only genuinely selected additional `--entry` or `--manifest` arguments. The unchanged normal/R-factor already registered in the base Workspace can remain there; a second capture is unnecessary.

## Execute and deliver the native family

Use the existing forcing-study operator and queue to choose the base case, original forcing editions and scientific settings. The default product is readable source titles/periods/units and file previews; the operator owns native preparation/run progress, saved results and errors. The source CLI above is a receiving/producer route, not a requirement for Tim to operate the application.

The receiving owner runs the new explicit cases on its actual installed NDR/SDR runtime, saves their original outputs, and compares only the accepted common support. A precipitation-only change may leave SDR inputs/results reusable; label that original stage reuse. Preserve valid-area counts, missing-data support, actual normalization and units. Do not present a changed domain mean alone as the export response.

Return the complete saved study and original-source bindings, annual N/P kilograms per year and sediment tonnes per year to streams, maps/tables with matched support and denominators, editable GIS handover and full application/Workspace reopen. The producing worker operates the actual desktop and narrow interface, inspects the changed/unchanged source details, opens every outgoing attachment and independently reopens the delivered study. Record the actual runtime, process/task/run identities, failures and retained results in the original receiving operation.

## Publisher methods and attribution

Retain access time and original release metadata with actual captures, and include PRISM Climate Group, Oregon State University attribution and publisher URL in derived products.

- PRISM dataset methods and normal/AN/LT distinctions: https://prism.oregonstate.edu/documents/PRISM_datasets.pdf
- Current consolidated web-service syntax: https://prism.oregonstate.edu/documents/PRISM_downloads_web_service.pdf
- Public 800-metre time-series availability: https://www.prism.oregonstate.edu/notices/notice_20250327.php
- Current COG/name transition: https://prism.oregonstate.edu/notices/notice_20251001.php
- Use and attribution: https://prism.oregonstate.edu/terms/
- Original NOAA metadata: https://www.fisheries.noaa.gov/inport/item/48224
- InVEST 3.20 NDR method and normalization: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html

The application source contracts reviewed for this course are `prism_period.py` 1b177edd5f2f065914d96f2d12463c795ae4a174, `climate_region.py` de4fd2bc8029c209a9601c932553462d7eba4b03, `compose.py` dfd4035e80ef439ded28d28848f32382caf3167c and `erosivity_sources.py` 743c6e4b955be8cb6f1dc1a6ff05780ba79b2270. Compose newer compatible source at the actual receiving boundary; retain the installed identities with the result.
