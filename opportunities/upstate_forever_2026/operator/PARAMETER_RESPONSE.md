# Interpret a parameter comparison

Open the existing **Parameter Studies** result table and expand **Interpret this comparison** for a retained case. The selected reporting area and pollutant filters continue to govern the original rows. A visible message identifies comparisons in which the shared-cell and full-total changes have opposite signs.

The interpretation reports three signed annual quantities in the original nitrogen/phosphorus kg/year or sediment metric-tonne/year units:

1. Case export minus baseline export on the same valid cells.
2. Mass on case-only cells minus mass on baseline-only cells.
3. Full case total minus full baseline total.

The first two sum to the third. The original full and paired totals, excluded cell counts, excluded areas, paired-area densities, and reconciliation residual stay visible. NoData is never assigned zero. A comparison without common valid cells keeps its available full totals and marks paired arithmetic unavailable. Per-area responses use the paired reporting area; they do not describe treatment hectares or removal physically occurring at a cell.

For a single numeric parameter, the view also shows its original baseline and selected setting, finite input change, annual export change per parameter unit, and baseline-normalized finite elasticity. These describe the two executed settings. Coupled changes have a joint result and do not receive a one-parameter slope. Categorical routing changes receive the mass/support explanation without numeric elasticity. Zero input or export baselines leave the affected ratios unavailable.

For `threshold_flow_accumulation`, the view multiplies the recorded threshold in cells by the original affine pixel area in hectares. It displays both threshold-area equivalents and the response per hectare of that equivalent area. The native mapped stream network remains the actual routing output. InVEST 3.20 defines this input as a number of upslope pixels; see the [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).

The ordinary HTML report includes the same calculation and wording. `response-interpretation.csv` and `response-interpretation.json` retain every original case/area/pollutant identity and the exact source result SHA256. The source result, original native rasters and their recorded sums are preserved. The new files travel inside the ordinary experiment archive and through its existing artifact handling.

In an already completed, current study, click **Refresh completed results** to add the interpretation exports from its authenticated saved matrix without native execution or raster aggregation. The existing native Run/resume route supports the same upgrade for source/API callers. If the original summary/native/export edition also needs updating, the existing study upgrade path remains in control. Partial studies still summarize their actual completed cases using their existing action and cache.

Source composition adds `model/parameter_response.py` and preserves the full current API, UI, styles, scientific report and installer. The `parameter-response` component fragment makes that dependency available to Parameter Studies, Calibration, Study transfer and Scientific Report editions. It adds no controller, background worker, model case or recipient obligation.

Producer operation uses the exact original four-case Gura NDR result, source Git blob `a65f19640187c0066879109b1eb310ec5481219c`, SHA256 `20a0f25d11742011784ac3bcae7857de108b244adaee8ceae7a79f9a921eaa9b`. The Gura 15 m study remains separate from the simulated headwaters and regional Upper Savannah studies. It is an archived completed native result, not a new model run.

Before recipient delivery, operate the affected table in the actual application at desktop and 390px widths; expand numeric, categorical, joint and changed-support results; download/open the report, CSV/JSON and complete archive; then independently reopen the saved study. Literally view the rendered results and fix any layout or control defect. This focused production work does not replace the original scientific modeling deliverable or authorize broad testing.
