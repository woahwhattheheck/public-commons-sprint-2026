# Paired native results: spatial review

Version 1.0.0 · TokenJunkieLabs · 13 October 2026

## Purpose

Use completed, source-bound paired-raster results as a working scientific handoff.
A reviewer can locate a cell, read the original numerical statistics and coordinate,
compare retained scenarios, select a multi-output pattern, attach a note, and return
an editable review plus an original-grid selection GeoTIFF and full-precision CSV.
The original model producer, report, paired reductions and scientific Workspace remain
the authoritative sources. This component performs no InVEST execution and does not
change an intervention, model parameter, source edition or native run.

The explicitly enhanced native report opens **Interactive spatial review**. The existing report
inventory and portable exporter carry the single offline page and its original-bound
atlas metadata; there is no new operator, server, scheduler or model queue.

## Install into the maintained application

Run with an existing NumPy / Rasterio / Pillow scientific Python. All five contribution
files must remain in their original relative locations.

```sh
python -B source_tools/install_paired_spatial_review.py --application /absolute/current/application
```

The installer preflights the complete source contribution and preserves differing
existing files. It leaves the original scientific/report producers unchanged.
Rerunning the same installation is harmless. The component fragment
`integration/component_fragments/paired-spatial-review.json` retains the complete
source in normal application assembly. Explicit `enhance` invokes the maintained
native report producer and appends the offline reader under its original report lock.
Regular report/model jobs retain their original execution cost; a large regional
result is not automatically expanded into an embedded browser package.

Using an independently owned copy of a completed original paired product:

```sh
PYTHONPATH=/absolute/current/application python -B /absolute/current/application/source_tools/paired_spatial_review.py enhance --project /absolute/paired-product
PYTHONPATH=/absolute/current/application python -B -m model.paired_ensemble.ensemble_cli export --project /absolute/paired-product --out /absolute/new-result.zip
PYTHONPATH=/absolute/current/application python -B -m model.paired_ensemble.ensemble_cli receive --archive /absolute/new-result.zip --out /absolute/new-received-product
```

The explicit enhancement uses the original exporter and its existing report lock. It reads every
original statistic and source descriptor, retains the original quantity tables, and
adds `spatial-review.html` and `spatial-review-atlas.json` to that same report inventory.
Follow the link in the original `index.html` or open `spatial-review.html` directly.
Historical result archives remain untouched. A later ordinary report re-render is a new presentation; use enhance again when that edition should carry the reader. Original source-download bytes embedded
in the reader are the complete original report edition captured before its new
navigation link; its descriptor and downloaded bytes agree exactly.

## Combine several completed comparisons

The standalone producer accepts one or more distinct completed original products,
each with its own original grid, selected profiles, support and units. The output
directory must be outside every input; choose a new directory for a changed edition.

```sh
PYTHONPATH=/absolute/current/application python -B source_tools/paired_spatial_review.py build \
  --project /absolute/riparian-result --project /absolute/control-result \
  --output /absolute/spatial-reader \
  --title 'Native model results · spatial review' \
  --classification 'Describe the exact retained study, geographic domain and simulated or measured source status here.'
```

Open `START_HERE.html`. It includes the full data needed for all controls and original
file downloads; no network, CDN, tile service, external script, browser installation
or account is required by the page. The ordinary product directories and `atlas.json`
also remain in the complete package for native receiving. A browser with gzip
DecompressionStream support is required. Tile payloads use Float64 little-endian
values with explicit missing values, checked against their SHA-256 and decoded length.
Exact numerical reads use original raster tiles rather than the overview pixels.
The browser keeps four decoded tiles in memory. Overview maps use nearest original
raster cells, original row orientation, labeled grayscale scales and checkerboard
missing support. Per-scenario scales can differ; compare the actual values and labels,
not shade alone. The complete offline payload is embedded, so choose the original
scientific selection appropriate to the recipient's browser memory.

## Operate a real review

Choose a retained scenario and a pollutant. Mean, minimum, maximum, quantiles, improved
fraction and support counts retain their exact original definitions. Read the legend,
original coordinate units and selected profile count. Click a map cell or enter its
zero-based row and column. Arrow keys move the selected cell; Space toggles its review
selection. Zoom, fit and scrolling do not alter the original grid. Toggle the review
overlay off to inspect the underlying quantities without a selection pattern.

The multi-output selector requires common support and every selected profile for
each pollutant. Each entered threshold is strict **greater than**, in that original
statistic's units per cell per year. Minimum is the minimum across the declared
modeled parameter members, not a confidence bound. Mean is their arithmetic mean;
median and other quantiles describe those members, not a posterior distribution.
An improved fraction is the fraction of modeled members with reduction greater than
zero, not a probability of success. All reductions are baseline minus alternative.
Nitrogen and phosphorus remain kg/year; sediment remains tonnes/year delivered to
streams. They are not concentrations, intake loads, catchment-area averages or causal
effect estimates.

**Selected area is result-cell area, not restored land.** A downstream change can
appear beyond the intervention footprint. Manual cell choices and the thresholds
that generated a selection are recorded separately. Changing a threshold field does
not silently change the prior selection; Apply evaluates a new selection.

Write a note and choose Save review. The JSON keeps exact source/atlas identities,
original selected cell indices, applied-selection context and the literal note.
Use Load review in a separate fresh page to reopen and edit it. A wrong atlas
edition is rejected. Browser draft storage is optional; the explicit JSON download
is the durable handoff and works without localStorage. Export selected CSV to get
all original statistics and original projected cell centers for the chosen cells.
The Original files disclosure opens the complete original report and downloads every
original raster, CSV, JSON and source-provenance member as retained bytes.

## Receive the review into native GIS

The same command accepts a complete standalone atlas directory, an original native
result directory with `spatial-review-atlas.json`, or either exact metadata JSON file.
Keep the accompanying original product files. A review is an explicitly chosen set
of result cells; receiving does not regenerate it from edited threshold fields.

```sh
PYTHONPATH=/absolute/current/application python -B source_tools/paired_spatial_review.py receive \
  --atlas /absolute/spatial-reader --review /absolute/downloaded-review.json \
  --output /absolute/new-received-review
```

Open `OPEN_REVIEW.html`. `selected-result-cells.tif` retains the exact original CRS,
affine transform, dimensions and row orientation. Its values are 1 for selected
modeled result cells and 0 for unselected cells; it is not an intervention raster.
`selected-result-cells.csv` contains all retained full-precision statistics, with
missing values left empty. `review.original.json` is byte-identical to the incoming
review and can be loaded back into its original browser page for independent edits.
`review-summary.json` retains the source-bound selection, original units, coordinate
reference and separate per-pollutant finite-cell mean sums. Sums of cell means are
not whole-basin quantiles. Existing differing receiver files and edits are preserved;
identical receiving can be resumed.

```sh
PYTHONPATH=/absolute/current/application python -B source_tools/paired_spatial_review.py pack \
  --directory /absolute/spatial-reader --archive /absolute/new-spatial-reader.zip
```

The complete application also retains its original paired-result and whole-Workspace
export/receiving paths. This result reader does not substitute for the full scientific
Workspace when the recipient needs to edit source inputs and rerun the model.

## Delivered original worked edition

The 13 October worked example consumes the two actual completed SAME5156 products:

- Riparian `eadb8ac31db5b47398ef65eb94ce6ff0307c30d6372fa034be065fded3cabb42`.
- Matched control `6bf18227e6494e4c2c9b39b39fdc6b832e3b9dfaf27549d0f40043a08312d556`.

Both retain four matched parameter profiles, their actual original native versions,
and thirty statistical GeoTIFFs. The grid is 120 × 120 at 30 m (1,296 ha), EPSG:26917.
It is a **simulated Piedmont teaching square, separate from the actual Upper Savannah
regional model**. Keep that distinction in every presentation and handoff.
The worked minimum-reduction > 0 joint selection contains 8,621 riparian result
cells (775.89 ha) and 4,212 control result cells (379.08 ha). These counts describe
this exact exploratory criterion on the retained modeled results, not treatment area.
Original production calculations, native run IDs, historic reports and static artifacts
remain unchanged in their original archive.

## Receiving and presentation

Operate the exact emitted page at desktop and narrow widths, inspect original-cell
values and source downloads, export and reload a changed note, and open the received
GIS mask and CSV. Open the normal native exported/re-received page as well as the
standalone page. View the actual rendered output personally. Fix visible or functional
defects in the maintained source. Use the actual worked records, not an empty shell,
and keep the selected modeled result-cell meaning visible.

The complete current owner brief follows unchanged.

---

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
