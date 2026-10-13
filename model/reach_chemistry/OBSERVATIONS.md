# Original Chemistry observation operators and censored intervals

The native Chemistry engine evaluates an observation against explicit conserved-basis species concentrations. The same declared operator is used by exact tangent sensitivities, calibration, local monitoring design and every draw of the existing parameter ensemble.

## Single-species observations

Existing inputs retain their `species`, `reach`, `day`, `mg_l`, `sigma_mg_l`, `role`, `qualifier` and provenance fields. The existing `equal` and `below` paths keep their established numerical operations and result fields.

## Compound observations

Omit `species` and supply:

```json
{
  "measurement": "Declared combined measurement",
  "basis": "N",
  "components": [
    {"species": "actual_first_native_species", "weight": 1},
    {"species": "actual_second_native_species", "weight": 1}
  ]
}
```

Each component must identify one known species in the original project. Weights are explicit, finite, strictly positive and dimensionless. Each species may appear once. Every component must share the declared conserved basis. The original reach, time, measurement uncertainty and provenance still apply.

The prediction is the weighted sum of the component concentrations at that exact reach and time. Its parameter derivative is the same weighted sum of the original exact tangent derivatives. Ensemble predictions use the complete weighted operator on every native simulation draw. Monitoring design evaluates the sensitivity of that same operator with its supplied prospective measurement uncertainty and original prior precision.

The measurement label does not choose pools, infer a laboratory fraction or convert a concentration basis. For example, source TKN includes ammonia and organic nitrogen; NOx and nitrate are distinct definitions unless the original project explicitly defines the aggregated state. Total nitrogen reconstructed as TKN + NOx includes ammonia once. An ammonia-plus-nitrate model sum is the sum of those declared pools. Source intake keeps the original analyte, fraction, method, units and component mapping alongside its observation.

## Interval observations

A censored component added to a measured component can produce a positive lower bound and a finite upper bound. Use `qualifier: "interval"` and retain that full interval:

```json
{
  "qualifier": "interval",
  "lower_mg_l": 0.4,
  "upper_mg_l": 0.5,
  "lower_closed": true,
  "upper_closed": false
}
```

These numbers illustrate the input shape. The operated field workflow uses the exact bounds derived from its original source records. Both endpoint flags are required, both bounds are finite and nonnegative, and the upper bound must exceed the lower bound. A point value must not be supplied; `mg_l` may be omitted or null. The existing positive `sigma_mg_l` and explicit fit/holdout role remain required for calibration.

For prediction (c), lower bound (l), upper bound (u) and supplied uncertainty (sigma), the weighted residual is:

- ((c-l)/sigma) below the lower bound;
- zero between the endpoints;
- ((c-u)/sigma) above the upper bound.

Outside the interval, the residual Jacobian is the original observation derivative divided by (sigma). Inside the interval closure it is zero. The existing linear, soft-L1 and Huber choices act on this residual through the original bounded least-squares solver.

This is distance to interval support. Open endpoints have zero distance at the boundary, while their exact membership is false. The result reports that distinction with `interval_contains_prediction`; the engine does not add an epsilon, invent a midpoint or substitute half a detection limit. It preserves `lower_mg_l`, `upper_mg_l`, `lower_closed` and `upper_closed` with `observed_mg_l: null`.

Point-observation RMSE and bias use equal observations only, grouped by the exact species or complete compound operator. `interval_scores` separately reports the count, predictions within the declared interval, and weighted distance-to-interval RMSE for each operator and fit/holdout role. The original local residual-Jacobian identifiability result describes the active calibration information; an interval already containing its prediction contributes a zero residual derivative.

## Original source and case continuity

Preserve the actual study row identifiers, source hashes, analyte/method definitions and station-to-reach/time mapping in observation provenance. A compound or interval extends how the selected original case reads an observation; it does not create a physical pool or a station mapping.

The field nutrient study retains its original interval arithmetic and source explorer. The existing Measurements review, native Chemistry desk and scientific report use those records through their explicit mapping. Original single-species reference cases and their saved native runs remain independently available.

Public helpers in the original `inference.py` are `observation_components(project, row)`, `observation_fields(row)` and `observation_key(row)`. Report consumers use the complete observable identity for titles, tables and grouping; a compound label is not inserted into the physical species table.
