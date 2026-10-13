# Native calibration review in the complete client report

This component registers an existing completed calibration review as an original
scientific report source. The maintained ordered observed-report picker then
includes its sections, numeric figures, original dossier and every companion
file in the ordinary scientific HTML/PDF and complete delivery archive.

## Operator journey

1. In **Calibration and validation**, open a completed calibration and prepare
   its complete review with the exact desired source-error and catchment-map
   editions.
2. Open the saved review and choose **Prepare report source**. The original
   task queue builds an immutable source edition from that exact review.
3. When the task finishes, its action opens the complete delivery form. The
   review screen also lists the registered edition, its figures and companion
   count, with **Open complete delivery** and **Open source edition**.
4. The normal delivery form starts with the review's original selected baseline
   and this source in its existing ordered **Observed scientific studies**
   picker. Choose compatible completed land-cover alternatives, required source
   overlays, map settings and delivery contact.
5. Add or reorder other original scientific reports in that same picker. The
   source's sections always identify its own native run, parameter profile,
   calibration, reference methods and selected supplements.
6. Build the normal complete client delivery. Its scientific report includes the
   calibration sections and print-safe vector figures. Its retained source files
   include the readable original dossier, complete ZIP, maps, tables, source CSV,
   native run records and original catchment geometry.
7. Open the delivery and inspect those original report/source links. Receive its
   ordinary complete or incremental Workspace transfer, reopen the calibration
   review and registered source, and continue through the same delivery form.

The native map-delivery form requires complete NDR and SDR outputs for its
original baseline and compatible future land-cover alternatives. A source can
still be prepared from a supported partial-model calibration. Its original
quantities, model scope and source selection remain available in the source
catalogue; the direct map-delivery button explains the actual missing native
model family.

This feature adds one report-source action to the existing calibration review.
There is one source picker, one delivery engine and one original task queue.

## Scientific content

The source preserves the original nominal candidate selection and its declared
objective. Its report contains:

- Original selected run/profile/calibration IDs, native model scope, candidate
  and distinct profile counts.
- Original annual-reference interpretation, temporal method, estimator periods,
  objective weights, numeric normalization values and their actual source basis.
- Nominal ranking, original calibration spatial groups, and selected-only held-out
  physical metrics. Catchment-row descriptive metrics remain distinct from the
  objective's equal spatial-group weighting.
- Actual selected load accounting: observed reference, native catchment export,
  explicitly retained external annual contribution and total prediction.
- Original leave-one-calibration-group-out results and complete candidate
  envelope/support/exclusion tables.
- The selected published-source-error edition, if included in the review:
  original fixed-scale challenger gaps, interval endpoints, numeric tolerances,
  first-tie outcomes, missing support and shared-source interpretation.
- Links to every selected original catchment atlas PDF, editable GeoJSON and CSV.

Long candidate tables show the first 12 original rows in the readable report;
their complete original CSVs travel with it. All selected reference records,
including incomplete support, remain in the original dossier.

### Equal-axis figures

Each pollutant has its own physical-unit panel. One plotted point corresponds
to one included original reference unit joined to the nominal selected
prediction by its original unit ID. The x coordinate is the original
source-estimated annual reference; the y coordinate is the retained total
prediction used by the original objective, including an explicitly retained
external contribution where present.

Filled circles identify calibration groups. Open squares identify held-out
spatial groups. Both axes use exactly the same numeric domain and the diagonal
is a 1:1 reference. All-zero source values receive a finite display span while
the retained data points remain zero. Missing/incomplete predictions remain in
the source table and do not become plotted zeroes.

The SVG and the original ReportLab PDF consumer use the same retained numeric
specification. The maintained renderer now accepts optional **markers: false**
only for line geometry. The diagonal uses it so its endpoints are not drawn as
additional observations. Omitted markers retains the previous default; ordinary
observational lines, scatter points, boxplots and legends retain their behavior.

## Native API and command line

The existing Workspace supplies the saved native review:

```python
from model.workspace import Workspace
from model import calibration_report_source

workspace = Workspace("/path/to/received/workspace")
source = calibration_report_source.prepare(workspace, original_review_id)

# Reopen verifies the original review, its exact source dependencies, every
# prepared member, and the registered source's complete companion inventory.
source = calibration_report_source.inspect(workspace, source["id"])

selection = {
    "baseline_run_id": source["selected_run_id"],
    "source_roles": {
        "OBSERVED_CONTEXT": {
            "source_collection_id": source["source_collection_id"],
            "source_id": source["source_id"],
        }
    },
    "observed_context_sources": [{
        "source_collection_id": source["source_collection_id"],
        "source_id": source["source_id"],
    }],
}
# Complete the remaining original delivery selections in the normal engine.
```

```bash
python -m model.calibration_report_source --workspace /path/to/workspace prepare --review REVIEW_ID
python -m model.calibration_report_source --workspace /path/to/workspace inspect --id SOURCE_RECORD_ID
python -m model.calibration_report_source --workspace /path/to/workspace list
```

Queued action: calibration.review.source with payload review_id. Native read:
GET /api/calibration/report-source with the saved report-source record id. It
returns the source record, original source selector, authenticated JSON download
and a prefilled delivery_selection when the original baseline satisfies the
current native map-delivery contract. The original provider decorates the task;
the shared host owns task display and file authorization.

## Stored edition and original companions

The immutable operation selection includes the producer edition, Workspace
project ID, review ID, original review selection ID and review dependency stamp.
Its digest names calibration-report-source-exports/SELECTION_ID. The saved
calibration-report-sources record points to the imported source collection and
native report source entry.

The primary document is observed-report.json, schema
upstate.observed-report/v1. Its ordinary source entry declares
metadata.report_schema so the maintained typed picker recognizes it.

Companions include:

| Path | Original content |
| --- | --- |
| dossier/index.html | Complete original readable review |
| dossier/calibration-review.zip | Complete original review archive |
| dossier/manifest.json | Original dossier inventory |
| dossier/records/ | Original calibration, selection, observations, native runs and selected supplements |
| dossier/tables/ | Complete original scientific tables |
| dossier/sources/ | Original observation CSV and full native catchment source members |
| dossier/maps/ | Every artifact from the exact selected original map edition |
| figures/specification.json | Original selected-pair numeric figure specification |
| figures/selected-POLLUTANT.svg | Monochrome plot of those same retained coordinates |

Every member has its actual byte count and SHA-256. The source entry preserves
relative paths, so the original dossier HTML and its map/table links remain
usable after copying into the delivery. The source manifest uses a deterministic
derived vintage and original-review URI; it does not substitute a new source
measurement date.

Preparation verifies and streams large original files through the existing
immutable review-copy helper. Repeating an interrupted operation verifies the
members already present and retains the same imported source identity. A saved
result is published only after the original review is reopened.

The source validator checks the completed original review, selection digest,
calibration/plan/native run/profile IDs, local source manifest and file inventory,
and the exact body/companion hashes reopened by the maintained observed_context
consumer. The calibration extension's existing verify_workspace hook invokes
this validator on received records.

## Complete application receiving

Use the current original application with Workspace, calibration review,
observed_context's ordered reports, scientific_figures and the maintained shared
extension host. The source cohort adds:

- model/calibration_report_source.py and this guide.
- The current complete calibration provider, descriptor, desk and review client.
- Updated calibration installer and cumulative assembly driver.
- The complete current scientific figure renderer with the marker-free line
  option.

The component installer includes the two new owned files in FILES. It composes
the exact three optional-marker joins against the receiving application's
current scientific figure source; it preserves the remainder of that current
owner's renderer. A repeated installation recognizes the already-installed
joins. Unknown independent changes at those anchors require composing the
current owner edition.

```bash
python operator/install_calibration.py --application /path/to/current/app --source /path/to/current/cohort --preview
python operator/install_calibration.py --application /path/to/current/app --source /path/to/current/cohort
```

The cumulative assembly driver performs the same registration before source-map
receipt and ZIP generation. The ordinary portable collector retains the new
model code, Workspace collection, prepared source directory and banked source
objects recursively. No separate transfer format or manual archive injection
is needed.

## Native execution provenance and retained producer editions

Producer edition `native-calibration-review-report-v2` carries the original calibration's native-execution snapshot into the source recipe and the scientific report's **Native model versions and output quantities** section. It shows the producing version and its basis beside the requested version, per-hectare raster units, annual-load units and the exact area reduction. The source reference links the complete native-execution CSV when that member belongs to the original review. All source companions remain the exact verified review members.

Reopening an original `native-calibration-review-report-v1` source preserves that producer edition and reconstructs its original selection identity. New preparation uses v2 and therefore receives a distinct immutable source identity; it never changes an existing delivery's selected source. The review controller displays the retained edition beside each registered report source.

Historical completed calibrations without a native-execution snapshot still produce a readable source with its original native records. New provenance is supplied by a newly completed calibration and its new review, rather than reconstructed from the executing machine's current model version.
