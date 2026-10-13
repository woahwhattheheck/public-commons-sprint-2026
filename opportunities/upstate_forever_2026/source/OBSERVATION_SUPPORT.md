# Physical measurement support in the existing observation workflow

This component extends the current Observed Context v3 source and the existing native observation workflow. A receiving-water catchment export, a facility/outfall discharge quantity and a concentration sample have different physical support. The native comparison now retains this distinction through ingestion, report rows and operator presentation.

## Operation

Install the complete component into the maintained application:

```bash
python -B source/install_observation_support.py --application CURRENT_APP --source-root RECEIVED_COMPONENT
```

The combined installer applies the existing Observed Context v3 changes first when needed, then these additive support changes. It preserves that component's original censored-value handling, sample dates, interval conventions, station/parameter plots, original CSV and SVG downloads. Shared model/app edits use unique source seams rather than replacing unrelated changes. The server's existing static allowlist gains the two authored browser assets; original authentication and file routing stay in use.

Restart the original operator process with its existing Workspace and authentication. The existing import form now offers physical measurement support, optional per-row support/species/facility/outfall fields, and the original annualization choices. The observation detail adds typed support, separate state outfall and EPA reporting feature, gauge relation and quantified-day coverage.

Import the actual annual/partial DMR quantities using the existing scientific source tree and same Workspace:

```bash
python -m source.import_observation_support --workspace ACTUAL_WORKSPACE --source-root ACTUAL_SCIENTIFIC_SOURCE --output ACTUAL_RECEIPTS/observation-support-import.json
```

This verifies and imports both authored model-sources.json and routing-model-sources.json through Workspace.import_sources, then opens the original period, annual-quantity and relation tables through Workspace.source_file. The first retains the complete EPA response closure; the second retains the actual network closure. All native originals and companions remain in that source edition. Two contextual views use the same original twenty series: complete calendar-year quantities and actual quantified-period quantities. Blank annual quantities remain blank; a partial-period total is never annualized by this importer.

## Native comparison behavior

New rows retain measurement_support, support_origin, species, facility_id/name, outfall_id, reporting_feature, monitoring_location, parameter_code, gauge_id/relation, relation_method, quantity_basis, coverage days, expected days and source completeness when supplied. Original source rows, methods, qualifiers and contributing identifiers remain intact.

Only receiving-water catchment exports of the matching total native parameter enter annual model residuals. Explicit nitrate, ammonia, suspended-solids and other species do not become total native nitrogen/phosphorus/sediment merely because someone maps their source labels to a native parameter. Outfall and concentration rows remain usable context with their original quantities. Annual admission still requires the source's method, catchment identifier, explicit annual units, accepted qualifier and original period; whole-catchment native support still governs the spatial metrics.

Earlier annual observation editions retain the original catchment-import contract and are visibly identified by support_origin=legacy_catchment_import_contract. Existing immutable results are not rewritten. A fresh comparison rechecks explicit support/species from its retained row or edition and includes contextual rows separately. Legacy IDs do not acquire a fabricated facility relation.

Context imports keep Observed Context v3's existing nonnumeric/censored values and dates. Declared receiving-water sample kinds are concentration context, declared effluent amount kinds are point-source context, and discharge/stage/indices retain other context. Explicit source support takes precedence.

## Actual Eighteenmile findings preserved in the UI

The verified 2023 DMR and actual network-routing edition contains four original facilities. At USGS-02186702, Milliken and the two Pickens plants are upstream; Pendleton-Clemson is downstream on the gauge's same NHD reach. All four lie inside the unsplit whole-basin polygon. The relation table, rather than polygon membership alone, selects the upstream cohort.

The authored upstream table reports:

- Total phosphorus: 949.31580872 kg, complete coverage for all three upstream facilities.
- Total suspended solids: 52868.11341562 kg, complete coverage for all three.
- Reported effluent volume: 683.717745 million US gallons, complete coverage for all three.
- Pickens total nitrogen: 5148.93199689 kg over 334 quantified days per series; Milliken does not report that total-N species in this source.
- Milliken nitrate as N: 4887.58235867 kg over 365 days, retained separately.
- Ammonia: the series keep different quantified-day coverage, including Milliken's 91-day quantified period and its remaining unknown periods.

The full four-facility phosphorus quantity is 1119.47500782 kg; Pendleton-Clemson contributes 170.1591991 kg downstream of this gauge. The UI displays original per-species quantities, represented days, missing species and actual network assignment. Reported facility discharge is a source term; no river attenuation or mixing adjustment is applied.

## Calendar timing and facility contributions

The source calendar uses the original selected mean rate over each calendar month's actual overlap days. This is the same constant represented-period rate assumption as the source processor. Exact Decimal monthly allocations reconcile to every already retained annual quantified series, including quarterly monitoring intervals. Missing intervals remain unquantified; a complete cohort month requires every selected permit to report the species and every reported series to cover the month.

Complete annual facility shares appear only for cohorts with complete year/species coverage. For upstream phosphorus, Milliken's original quantity is 80.1634047% of the three-facility source total. June and July together contain 268.09562417 kg of that year's reported upstream phosphorus. The calendar shows the actual month quantities and every series' quantified/expected days; it does not attribute the timing to weather or infer a future reduction.

The added source/observation_source_calendar.py is an analytical transformation of original reported periods, not a new discharge estimate. Original selected DMR IDs remain on the month allocations. The source-period collection and table hash join the observation metadata and import receipt.

## Source identity and primary methods

Original 39-file DMR packet: SHA256 bee7c5125750f822eb8fd8876f8e601b0fe908925087095136ef5adf4131960a.
Additive 19-file routing packet: SHA256 6f393a1c97b786f4e91d3a11b92b7ccdcb72a8ee9abe2c9299eac3e69ca8accd.
Source bank: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8J1E75FV .
Existing Observed Context v3: https://chatgpt.com/space/page_7708ce8eb1a08191a3b46177383e4746 .
Its 75087-byte packet SHA256 is baa1ee854055d5becb9eb1293fa27c42b51c21cc363dbc643276901bed8c2dc1.

The source processor integrates the selected original EPA MK/AVG standard rate over the original represented calendar days. Twelve complete nonoverlapping monthly records support each complete phosphorus sum. All original DMR IDs, reporting features, monitoring locations, quantities, units, qualifiers and unknown intervals remain in the source.

Primary references:
- InVEST 3.20 NDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- EPA original field definitions: https://echo.epa.gov/help/reports/effluent-charts-help
- EPA load calculation context: https://echo.epa.gov/trends/loading-tool/resources/loading-calculations
- USGS NHD reach measures: https://pubs.usgs.gov/fs/2012/3068/FS12-3068.pdf
- Actual gauge reference: https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702?f=json

## Integration verification

The original operator 23 source and Observed Context v3 were recovered and matched to their exact published member hashes. The v3 guarded edits and this component's model/browser edits were applied to those actual sources. Current JavaScript source parses in V8. The unchanged original exported DMR processor was executed here in V8 on all retained inputs; its 230 period rows, 20 annual rows and all three product byte hashes reproduce exactly (period CSV 872d4183…, annual CSV ef74ad35…, summary JSON 50d2234b…). The existing native model aggregation and stream/NoData treatment are unchanged; this component changes measurement semantics and presentation.

The source package includes exact complete shared postimages for composition plus the guarded installer for applications carrying other additive work. Install on the actual application and execute the import command above to obtain the native receipt and two retained source editions.

## Current application and source-only receiving

The 1.2 composition preserves the current original-source manifest overrides, observation CSV upload recovery and complete app/inspector controls. The same `source_tools/receive_observed_context.py --sources-only` operation now creates the two physical-support views after its ordinary dated and routine-nutrient views. It records their actual native observation IDs and `physical-support-observations.json` in the source-phase files before geographic processing. A previously completed geographic operation can receive these two views while retaining its original maps, operation identity and completed state. Resume the same selection without `--sources-only` for any remaining geographic processing. The optional original 13-gauge NLDI basin manifest joins the same source inventory when present.

`source.import_observation_support.import_sources` accepts keyword-only `manifest_paths` overrides keyed by its `MANIFEST` and `BASE_MANIFEST` constants. The receiving operation passes its exact selected source manifests and verifies both resulting source-collection identities and manifest hashes. The two views use standard Python, original retained CSVs and the existing native observation importer; they do not require the geographic runtime.

### Original species and model parameter mapping

A parameter mapping selects the model parameter for comparison. It does not change the measured chemical species. Explicit source `species` metadata or columns remain authoritative; otherwise the original source parameter label is retained as the species, including for earlier saved observations when comparison is reopened. Total nitrogen and phosphorus names, conventional TN/TP labels and original EPA00600/00665 codes are normalized deliberately. Nitrate, nitrate-plus-nitrite, ammonia and TKN remain distinct from total nitrogen. A comparison with one of those species stays available as context until the original source supplies a matching total-export observation. The UI retains both an explicitly declared species and its differing original parameter label. Native comparison edition5 records these semantics with the original support and catchment calculation.

The complete source component includes the current manifest-path importer and source-only receiver postimages. Its guarded installer preserves their unrelated changes and composes the receiving continuation on the exact maintained predecessor.

Known original effluent and concentration source kinds also retain their declared physical support when an annual value basis is selected. Explicit support that conflicts with such a source kind is preserved for review and excluded from landscape-export residuals. This check also applies when older saved rows are reopened. Square-bracket agency qualifiers such as `Nitrogen, total [as N]` normalize to the matching total species without changing the original label.
