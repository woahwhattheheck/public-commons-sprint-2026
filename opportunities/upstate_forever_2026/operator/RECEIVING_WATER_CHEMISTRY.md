# Receiving water from original flow and storage files

This is the existing Upper Savannah **Reach chemistry** application. It uses the original Workspace sources, immutable scenarios, native queue, sparse/SciPy calculation, scientific reports and editable receiving.

## Start with the actual files

Open **Sources** in the existing application and retain the complete original files. Tim can use his own CSV column names, organization, labels and units. The receiving-water desk previews the original columns and first rows before any mapping. No prescribed laboratory CSV layout is required for flow or storage.

Open **Reach chemistry → Receiving-water source periods**. Choose an original saved chemical scenario with one phase. Its species, conserved bases, initial chemical masses, boundary concentrations, loads, reactions and exchanges remain the scientific template. A one-phase template is an explicit selection: the same chemical assumptions are repeated over the chosen hydrological periods.

For each selected original flow and reach:

1. Select the original retained file or successive files for the same series.
2. Click **Preview original columns and rows**. CWMS fields retain their exact series and office identity. CSV columns remain the user's original names.
3. For CSV, map timestamp, value and optional quality columns; choose the original delimiter, timestamp format and any fixed UTC offset needed for naive timestamps. An offset does not infer daylight-saving changes. Choose original missing tokens explicitly.
4. Choose the actual units. Flow accepts cms, m3/s, cfs or m3/day. Storage accepts m3 or acre-feet. Original values and labels are retained alongside the conversion factors.
5. Choose the original interval and its meaning. Flow support is explicitly interval-ending; storage values are instantaneous. This mode does not silently reinterpret instantaneous flows as interval averages.
6. Select eligible quality codes explicitly. Codes are retained as integers or text; the application does not claim an undocumented code means approved data. A file without flags needs an explicit unflagged code.
7. Select begin/end timestamps with UTC offsets and a whole number of period hours. Select the documented signed-value arithmetic mean and unchanged single-phase chemical-template policy.

Only an exact positive storage observation at the starting timestamp sets initial volume. Later observations compare with the continuously flow-derived storage trajectory. They never reset the model between periods. Unbound reaches retain the template's declared starting volume; unbound flows retain its original base flow and multiplier. This selection is visible in the saved project.

Preview reads **every** selected interval. Original nulls, excluded quality flags, mismatching overlap, partial periods and negative aggregate flow require a corrected scientific selection. The program does not drop rows, fill gaps, interpolate concentrations or clip negative original flow values. All original hourly signs remain in the source files and period-support counts.

## Save and calculate

**Save prepared chemical scenario** uses the original queue and its retained request identity. Refresh or return through the completed task to open its immutable preparation and chemical scenario. The preparation includes the complete source selection, original source hashes, all supported periods, water-budget comparisons, report HTML and CSV.

The existing physical controls expose stored-water mode, starting volume, flow rates, reactions, water-only external outflow and inverse-volume reaction scaling. Source-bound flow bases are 1 m3/day with the actual period rates in explicit phase multipliers. Changing a base rate changes the scientific scenario; save a new edition and state the reason. Source observations remain retained.

For a normal forward run choose **simulate**, review the ordinary comma-separated sample-days control and run the selected analysis. Complete project/request JSON remains in expandable advanced sections. Calibration, uncertainty and monitoring use the existing explicit native contracts; no uncertainty, annual-load conversion or coefficient is supplied invisibly.

The engine edition is **0.4.0**. Existing accepted 0.3.0 runs stay readable and exportable with their original selection and artifacts. They do not need replay. New calculation identities carry the new engine version.

## Read and receive the results

Open the existing result and scientific-report controls. The variable-storage report includes water budgets, retained storage samples, continuous stored-water curves, chemical mass accounting, source periods and comparisons to later observed storage. Nominal turnover V/Qout is an instantaneous scale; it is not a water-age distribution or a calibrated residence-time estimate.

Download the original JSON, HTML, CSV and whole result ZIP. **Export editable project** carries the selected case, complete selected original files and completed runs through the existing Chemistry exporter. Receive that ZIP in another initialized Workspace through original Sources → Chemistry receiving. The whole Workspace portable route retains all preparations, source manifests, records and reports. Source-period receiving verification joins the existing chemistry verification.

## Complete retained Hartwell source family

The source folder `source/receiving-water-hartwell-2025` contains twelve **unchanged original CWMS responses**: four quarterly files each for the exact SAS series:

- Hartwell.Flow-In.Ave.1Hour.1Hour.Raw-SHEF_SAS
- Hartwell.Flow.Ave.1Hour.1Hour.Raw-SHEF_SAS
- Hartwell.Stor.Inst.1Hour.0.Raw-SHEF_SAS

All original URLs, body hashes, metadata, nulls and quality codes are retained. Epoch milliseconds are absolute timestamps even though CWMS also includes a named local display timezone. Identical quarter-boundary overlaps are allowed; differing original overlap is rejected.

The provided native source-study selections use complete 21-day January, April, July and October periods with weekly aggregation. They retain signed original hourly values and compare later observed storage with flow-derived volume. The two missing Q1 flow observations remain in the full original archive; the supplied selected periods do not silently bridge them.

The flow-out role is an explicit operator-selected binding of the original Flow.Ave series. The exact source series, selection and units are always visible. Chemical starting masses, inlet concentrations, load timing and reaction coefficients are separate scientific inputs; hydrology alone does not establish them. A unit-response scenario is an authored demonstration, not a measured contaminant concentration. Annual NDR/SDR or SPARROW loads are not automatically divided into daily chemical loads.

## Install the coherent source edition

Use the maintained Chemistry installer with its complete source-bank JSON. The receiver is the same full `operator/install_chemistry.py` included in that bank:

```sh
python -B /PATH/TO/SELECTED/operator/install_chemistry.py \
  --application /PATH/TO/ORIGINAL/UPPER_SAVANNAH_APP \
  --source-bank /PATH/TO/COMPLETE/receiving-water-source-bank.json
```

It checks exact known predecessors, copies complete owned source files, preserves unrelated installed application modules and uses the original extension registry. Independent changes require composition at their actual current source. The selected bank includes original data, complete new engine, full operator desk, reports, this guide and native course; it does not replace the complete scientific application with a small wrapper.

## Original native operation and rendering

Operation **ECO-RECEIVING-WATER-9B2C-20261013 / WO29** retains the original accepting scientific host, queue and output. The independent original-engine physics course is:

```sh
python -B -m model.reach_chemistry.study_storage --output /ABS/OWNED/NEW/PHYSICS_OUTPUT
```

Reconcile any already-issued handle before starting. Preserve accepted R01/R02, teaching12, regional12 and other owners' new runs. The complete physics programme covers filling, draining, water-only evaporation, decay, inverse-volume settling, phased multi-reach chemical transport, attribution, derivative comparison and original checkpoint continuation.

The producing peer must run/open/render the exact outgoing edition, **look at the actual rendered screens and screenshots**, and operate its important populated, empty, loading, error and recovery states at desktop and narrow widths. Open the full report and every attachment; operate real source mapping, preview, preparation, run, report, download, editable receiving and independent reopen. Fix actual clipped or unstyled output in the existing clean industrial design. Return the original artifacts and images to the source owners. This is the original whole product receiving course; broad unrelated repository suites are unnecessary.
