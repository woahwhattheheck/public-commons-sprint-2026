# Chemistry scientific reports from saved results

The existing Reach chemistry desk can now prepare an immutable scientific report
from a completed original analysis. Open a completed analysis and choose
**Prepare scientific report**. When the original queued action completes, open
the report in **Saved scientific reports**. The same desk shows the selected
original analysis, complete source downloads, and an inline report.

This action reads the saved project, request, result and artifact inventory. It
renders a report and uses the existing editable Chemistry exporter. The equations,
parameter fit, priors, samples, numerical result, original run ID and original
report files stay with their original editions. No native calculation is repeated.

## What the reader can inspect

Every report identifies its original project provenance, producing engine
version, model duration, saved run/case, request/result SHA256, and retained
source references. Physical tables retain each species' conserved mass basis,
reach volume, water flow, boundary concentrations, external load, reaction
coefficients, temperature correction, phase multipliers and original sources.

For calibration, the report displays the original convergence flag, termination
message, loss, optimizer cost and evaluation count. It keeps the original fit and
held-out roles, coefficients and bounds, exact-valued RMSE/bias summaries, full
observation table, original source references and local identifiability result.
Equal-axis plots compare the actual exact-valued reference and prediction pairs
separately by species. Filled circles identify fit records and open squares
identify held-out records. Below-limit records remain in the full table rather
than appearing as exact concentrations.

A role named `holdout` means that the original record was excluded from the fit
objective. Its source and sampling design determine whether it provides an
independent empirical evaluation. For the retained REACT12 four-reach reference,
each record explicitly identifies the noise-free authored recovery calculation.
The original source text remains visible beside each original reference value.

The optimizer's retained cost is one half the sum of its chosen loss evaluated
on squared error-standardized fit residuals. The source engine uses a one-sided
exceedance penalty for below-limit records: zero at or below the original limit,
positive above it. It does not substitute a fraction of the detection limit.
The original RMSE/bias tables use only exact-valued records.

For the parameter ensemble, the report shows the completed draw count, seed,
physical parameter units and bounds, original distribution specification,
original latent Gaussian correlation matrix, and every original target's
mean/median/5th/95th percentiles. The central interval describes the supplied
parameter-prior draws. It does not include errors or uncertain quantities absent
from that request. Correlation is declared in the latent Gaussian space; the
transformed physical parameters may have a different Pearson correlation.

For chemical monitoring design, the report names the exact selected candidates,
their days/species/error scales, prediction and incremental information gain.
Prior and resulting linearized precision matrices keep the original parameter
order, with units equal to inverse products of the corresponding parameter units.
These are proposed measurement locations/times under the saved local design.
The distinct regional Monitoring desk continues to own campaign costs,
catchment coverage, station bindings and field operations.

Simulation and attribution reports retain the full-duration mass budgets,
sampled concentrations, boundary exports and integrated reaction transfers.
Kilograms over the completed model duration are not silently converted to annual
loads. Numerical mass conservation describes the implemented model.

## Native saved-result operation

Use the existing actual Workspace and an existing completed Chemistry run ID:

```json
{"run_id": "ACTUAL_COMPLETED_CHEMISTRY_RUN_ID"}
```

Save this as `report-selection.json`, then call the original CLI:

```sh
python -B -m model.chemistry_cli --workspace ACTUAL_WORKSPACE   chemistry.report.prepare report-selection.json
```

The result returns an immutable report ID, original run/case, presentation
edition, complete summary, report descriptor, ZIP descriptor and every retained
artifact. The original action is also available through
`POST /api/actions` as `chemistry.report.prepare`; payload is exactly the JSON
above. Queuing uses the existing action/operation identity and native task store.

Read a saved report through `GET /api/chemistry/report?workspace=KEY&report_id=ID`.
The provider verifies the retained record and its source stamp, registers the
actual original file tickets, and uses those tickets for report links in the
inline preview. The exported report keeps portable relative links.

The existing CLI also accepts `chemistry.report.get` with
`{"report_id":"ACTUAL_REPORT_ID"}` and `chemistry.report.list` with
`{}` or `{"run_id":"ACTUAL_COMPLETED_CHEMISTRY_RUN_ID"}`.

## Complete portable result

Each report lives at `Workspace/chemistry-reports/REPORT_ID/`:

- `report.html`: the current scientific presentation;
- `scientific-summary.json`: the original result summary and provenance;
- `original/`: exact original saved case/run and every original artifact;
- `editable-chemistry.zip`: the original exporter’s complete editable case,
  selected run and retained source bodies/companions;
- `manifest.json`: exact report identity, original source stamp, lengths and
  SHA256 values for every report member;
- `scientific-report.zip`: the complete offline report and all linked members;
- `report.json`: the saved Workspace report record.

Extract `scientific-report.zip` as a directory and open `report.html`; all
relative links remain inside that package. The nested editable project imports
through the existing Chemistry **Receive editable ZIP** course. It adopts the
original project and completed result through the maintained native receiver.
The existing full Workspace archive preserves the saved scientific-report
directory as well, and its Chemistry verification hook reopens each report
against the original run/artifact/source identities.

A report selection includes workspace ID, original run ID, presentation
edition, full source stamp and exact producer/renderer source hashes. Another
presentation receives another immutable ID. Existing reports stay readable even
when a later renderer is installed. Preparing the same edition reuses its
verified saved report. New calculations use the same improved presentation in
their ordinary original result artifacts; completed earlier calculations keep
their existing artifacts.

## Native receiving on the existing DD6B programme

Use the already-completed DD6B four-mode chemical reference in the existing
`b9d5d257-c6bb-4f07-b975-8e8c63705db3` regional Workspace or its actual restored
recipient. Retrieve actual Chemistry run IDs from its native catalogue. Prepare
one report for each existing completed mode, inspect the saved reports, open the
report in the existing desk, export and reopen the complete Workspace, and compare
the original run/result SHA256 values before and after. This course only renders
already completed outputs. Return the exact report IDs, artifact names, source
provenance, original result checksums, and the first actual exception if one occurs.

The maintained registry installer includes the renderer, retained-report model,
provider/browser/descriptor and verification hook. Its owned component fragment
extends only the existing `chemistry` family, so current full application
receiving includes all new runtime leaves and this guide.
