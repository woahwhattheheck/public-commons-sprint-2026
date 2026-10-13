# Eighteenmile nutrient composition in the maintained application

The composition study uses the existing **Sources** screen, **Source reports and regional context** panel, scientific Workspace and original observed-report formatter. Its complete source edition contains the unchanged original CSVs, all 153 activity calculations, 464 matched-date component comparisons, the offline explorer and the report recipe. The source entry is `eighteenmile-nutrient-composition-20261013-v1`.

## Open the already prepared portable edition

Open the intended Workspace in the maintained application. In **Sources**, choose **Import report ZIP** in **Source reports and regional context** and select the portable source report archive. This is the archive produced by **Download report and source edition**, with `sources.json` at its root, not the larger outer delivery ZIP containing several packages.

After import, search for **Eighteenmile nutrient composition** and choose **Open report**. The original document is `observations/eighteenmile_stoichiometry_20261013/index.html`. It is the complete working explorer: station/year/season summaries, matched-date signed intervals, activity search, original-result inspection and full selected CSV/JSON downloads.

**All retained report and source files** exposes every original member. **Download report and source edition** produces the same maintained portable source format for another Workspace. Both this route and the direct observed-report renderer preserve the original native source kind `document`; derived calculations do not become new observed-measurement rows.

The maintained Operator has executed catalogue, detail and complete archive export for this edition. Its source body and 18 companions retain their original source identifiers and file bytes.

## Build and receive from source

The original source CSVs are included in the application's additive `eighteenmile-nutrient-composition` component together with the five study source files, original Source Reports routes/assets and this guide. The component depends on the existing observed-context component. The original application's fragment composer includes it without replacing the shared catalogue or another component.

From the application root:

```sh
python -B observations/eighteenmile_stoichiometry_20261013/receive.py \
  --application-root /path/to/current/application \
  --workspace /path/to/current/scientific-workspace \
  --package /path/to/new-composition-package \
  --report /path/to/new-native-composition-report
```

Both output directories must be new; their parents must exist. The command builds from the two exact original CSVs, imports the source edition into the existing Workspace and writes native PDF, HTML, Markdown and JSON through the maintained formatter. Refresh **Sources** to open the retained explorer. A completed source package is also reproducible without the canonical input paths because it contains unchanged retained copies.

For an already-prepared complete source package, use the existing renderer without recomputing the study:

```sh
python -B /path/to/current/application/source/observed-report-20261013/render.py \
  --app-root /path/to/current/application \
  --workspace /path/to/current/scientific-workspace \
  --manifest /path/to/composition-package/eighteenmile_stoichiometry.sources.json \
  --output /path/to/new-native-composition-report
```

## Compose with existing scientific context

The existing renderer accepts repeated `--manifest` arguments in report order. Keep the current original observed-report source first and append `eighteenmile_stoichiometry.sources.json`. Each manifest selected this way must identify exactly one `upstate.observed-report/v1` document. A general table manifest is not a report recipe.

For a saved selection, append the composition source collection/document choice to the existing ordered `observed_context_sources` list and keep its first item consistent with `source_roles.OBSERVED_CONTEXT`. Use the actual collection identifier returned by the Workspace import. Retain the original selected reports and their source choices rather than recreating their scientific data.

The composition recipe sits at the package root. This preserves its application-relative companion paths through the native source import's common-directory normalization. Keep that layout when transferring or rebundling the original source edition.

## Read the scientific result

The 23 shared SV-375/SV-376 dates have higher P:reconstructed-N at SV-376 on 22 dates, with one overlap. NOx's fraction of reconstructed N is lower on 15 dates and overlaps on eight. These are exact original-activity composition comparisons with their original collection clocks, not simultaneous transport experiments.

All 35 below-quantitation phosphorus activities retain `[0, original limit)`. P:N remains defined because reconstructed N is positive. N:P over positive P is unbounded above for those activities, with the zero-P point explicitly undefined. The original source methods, exact endpoint arithmetic, complete interval memberships and primary references are documented in `observations/eighteenmile_stoichiometry_20261013/README.md` and the explorer's **Methods & source** section.
