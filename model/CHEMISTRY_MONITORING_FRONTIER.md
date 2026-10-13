# Four-reach teaching case: monitoring budgets and missed-visit plans

This delivery extends the original constructed four-reach case with complete
assay-budget and missed-visit decisions. It retains the original twelve JSON
artifacts from four operated runs and uses the unchanged native chemistry
selector and exact tangent engine. Study ID: `2357ec0cb8413ed2d9ce39eef2a43b0497593a6c69b7072b516d369294f7ac38`.

Open `index.html` in an ordinary browser. It is entirely offline. Choose a
coefficient state, prior multiplier and assay count. The two parameter plots,
original candidate schedule and visit counts update together. The disruption
panel separates a contingency prepared before the campaign from a response
made after a missed day. Reactive replacement candidates are strictly later
than the missing day; unfilled assay slots stay visible.

## Rebuild

Python 3 with NumPy 2.3.5 and SciPy 1.17.0 operated
this edition. The pinned dependencies are in `rebuild/requirements.txt`.
From this extracted study directory, use a NEW output path:

```sh
python rebuild/application/source_tools/build_chemistry_monitoring_frontier.py \
  --source-bank inputs/original-chemistry-results.source-bank.json \
  --monitoring-run 9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044 \
  --calibration-run 6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d \
  --output ../chemistry-frontier-rebuilt
```

The complete retained engine and this study's source are included under
`rebuild/application`. No InVEST, GIS download or repeat of the 512-draw
uncertainty run is needed. The CLI verifies each supplied source-bank member
before using it, checks original project/calibration identities, and preserves
the original eight-choice sequence and precision. Changed inputs produce a new
study ID. Existing output directories are never overwritten.

## Native scientific reports

Use the existing report composer with `chemistry-monitoring-frontier.sources.json`.
It contains one `upstate.observed-report/v1` document. That is the current typed
scientific report transport; its title, source metadata and first section
explicitly identify this as constructed teaching data. The report recipe keeps
all input hashes, full native results, source, CSVs and offline explorer together.

From a complete current application:

```sh
python source/observed-report-20261013/render.py \
  --app-root "$PWD" --workspace ACTUAL_WORKSPACE \
  --manifest /absolute/study/chemistry-monitoring-frontier.sources.json \
  --output /absolute/new-scientific-report-directory
```

The returned collection/source selection can join the existing ordered
`host.openScientificReport` composer. Original chemistry report producers,
Workspace IDs, model runs and source collections remain their existing owners.

## Meaning of the quantities

An assay is a reach/species/day measurement, not a field visit or a dollar.
Both assay count and distinct reach/day visits are exported. The planning prior
precision is unchanged between the original and fitted coefficient states.
Multipliers 0.25, 1 and 4 are explicit prior-sensitivity cases. Scoring assumes
the original independent errors at declared sigma_mg_l. Candidate fit/holdout
roles are retained; the score uses sensitivities, not target concentrations.

`P = prior + J'J`, with each tangent row divided by its assay sigma.
Local parameter SD is `sqrt(diag(P^-1))` in the parameter's original unit.
Relative D criterion is `exp((logdet(P)-logdet(P_reference))/parameter_count)`.
An information-ellipsoid volume ratio is `exp(-(logdet(P)-logdet(P_reference))/2)`.
The condition number uses explicit parameter-range coordinates so unlike units
are not silently mixed. A relative criterion can exceed 1 because a native
greedy schedule is not asserted to be a global optimum.

Preplanned recovery excludes the unavailable visit/day and keeps the other
selected assays, but can use another candidate time anywhere in the campaign.
Reactive recovery retains those same unaffected planned assays and admits only
strictly later times. Each replacement comes from the existing native selector
with retained-assay precision as its starting prior. No observations at missed
or earlier times are fabricated. A last-date loss can leave slots unfilled.

D-optimality is model-dependent. These are local planning summaries, not field
confidence intervals, posterior claims or a cost-minimizing route. Actual
travel costs, correlated errors and new chemistry inputs must be supplied before
making those further decisions. See the NIST references in `observed-report.json`.

The native source originated in the maintained Commons Ecosystem Sciences
application. All original source bodies and individual SHA-256 identities are
retained in the manifest. This additive study leaves that native engine intact.
