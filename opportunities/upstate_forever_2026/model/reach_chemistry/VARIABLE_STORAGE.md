# Variable storage in the original reach chemistry engine

The same `reach-chemistry/1` project and original Workspace chemistry actions now accept
`"hydrology": {"mode": "variable-storage"}`. Initial reach volume is the existing
`reaches[].volume_m3`. Every original flow and phase multiplier remains explicit.
Without this selection, the original fixed-volume matrix-exponential path remains active.

## Water, chemical mass and time

Within each declared phase, flow and load rates are piecewise constant. At reach i,

`dV_i/dt = sum(Q_in) - sum(Q_out)`.

Storage follows those declared flows continuously across phases. Every phase-end
volume must remain strictly positive and finite; because volume is linear inside
a phase, this also establishes positivity between its endpoints. The calculation
does not silently insert a balancing inflow, move an initial volume, or reset the
state to a later observed storage value.

The chemical state remains kilograms of the species' declared conserved basis.
An outgoing solute-carrying flow removes `Q * M_i/V_i(t)`; the same amount enters
its connected downstream reach. Boundary concentration uses the original
`Q[m3/day] * C[mg/l] / 1000 = kg/day` conversion. A direct load retains kg/day.
Concentration output is `1000 * M[kg]/V[m3]` in mg/l at the actual sample time.

A flow may explicitly select `"solute_transport": false` only when it leaves a
reach to the external boundary. It then removes water without exporting modeled
solute, for an explicitly documented evaporation process. Ordinary discharge,
seepage and withdrawals that carry solute keep the default true. The flag is not
an inferred property of a source series.

Ordinary reactions retain their existing constant first-order rate_day, phase
multiplier, temperature factor, products, basis and sink identity. An explicitly
selected `"volume_scaling": "inverse"` scales that rate by V_initial/V(t). For a
well-mixed reservoir with constant surface area A and settling velocity v_s, the
source builder can use `rate_day = v_s * A / V_initial` and this inverse scaling.
Use separate reach-specific reaction rows if the reference geometry differs.
A changing area-elevation curve must be represented by explicit operating periods
and documented coefficient choices; no area curve is invented by the solver.
This is a completely mixed compartment calculation, not hydrodynamic stratification.

## Original numerical path and scientific accounting

The fixed-volume solver still uses its original sparse augmented matrix
exponential. Variable storage uses SciPy Radau on the time-dependent sparse linear
system with the exact sparse Jacobian and rtol=1e-10, atol=1e-12. A period with
constant storage reuses the original matrix exponential at that period's actual
volume. Hydraulic phase lookup and output-event selection use binary search so
an annual hourly series does not rescan every preceding period at each RHS call.

Each accepted step simultaneously integrates mass, the time integral of mass,
and the time integral of mass multiplied by V_initial/V(t). Those integrated
states give boundary export and reaction extents. An endpoint concentration or
trapezoidal approximation is not substituted for a load integral. All original
basis budgets retain their independent 1e-8 relative closure requirement;
the variable-storage water budget also checks 1e-10 relative closure. Negative
state checks remain active and accepted states are not clipped or renormalized.

Sparse forward tangent equations use the same changing volumes. Sensitivity,
observation fitting, monitoring design and parameter ensembles retain the original
reaction-rate, direct-load, boundary-concentration and initial-mass parameter
contracts. These parameters leave the declared hydraulic trajectory fixed;
flow and initial storage can be explored as explicit scientific scenario edits.
Inverse-volume reaction-rate derivatives receive the same physical volume factor
as the corresponding reaction. Observation components and censoring retain their
existing semantics.

Cancellation is checked during integration as well as between output events.
The existing immutable checkpoint records retain full mass/input/export/reaction
state and completed storage-step diagnostics. Resume uses the original project,
sampling and source-tag signature. The full original run export and case receive
remain the existing Workspace mechanisms.

## Added outputs

Variable-storage results retain the original final concentrations, samples,
mass budgets, reaction transfers and source attribution, and add:

* `samples[].storage`: volume, incoming/outgoing water rate, storage-change rate
  and nominal turnover time for each reach at that sample.
* `storage`: the same complete hydraulic rows at the final day.
* `storage_budgets`: initial volume, integrated inflow/outflow, final volume and
  the actual numerical residual.
* `numerics.storage_steps`: accepted event intervals, solver controls and actual
  function/Jacobian/LU counts.
* `water-storage-final.csv`, `water-storage-budget.csv` and
  `water-storage-timeseries.csv` in the existing complete result archive.

Nominal turnover is instantaneous volume divided by total outgoing water rate.
It is null for zero outgoing water. It is not a tracer age distribution.
At an internal phase boundary, storage is continuous and the reported flow belongs
to the following operating period.

## Source-bound operating periods

Retain original source files, timestamp/timezone, native units, quality flags,
missing values, original aggregation windows and any interpolation decisions.
A daily or hourly volume difference is not interchangeable with a measured
discharge. Computed negative inflow values require an explicit source-treatment
decision; do not clip them silently. Initial storage comes from an identified
observed source row. Later observed storage is a comparison series against the
flow-derived trajectory, rather than an automatic replacement state.

The source builder and original operator integration own the period selection,
observed comparison, editable case, scenario family and complete handover. Existing
R01/R02 drainage accounting and accepted RIVER13 work remain available as their
original separate studies.

## Primary references

* US EPA, WASP model documentation and Water Transport theory:
  https://www.epa.gov/hydrowq/wasp-model-documentation
* US EPA, WASP7 Stream Transport Model Theory and User's Guide (EPA/600/R-09/100):
  https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1005O7C.TXT
* SciPy, solve_ivp reference, Radau, error controls and callable sparse Jacobian:
  https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html

The equations above describe this original reach engine's implementation.
The EPA documents provide the transport-model context; this extension does not
invoke WASP or claim to reproduce another engine's complete process set.

## Current producing and receiving instructions

Read the complete original project AGENTS.md and CURRENT_OWNER_DIRECTION.md,
version 2026-10-13.4, supplied with the source handoff. The current post-call
client-data direction is retained in the original Eco thread at
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791910704161709 .
Build the existing operator so the scientist can open their own files, inspect
their columns and units, choose scientific settings, run, read useful outputs,
and save/export/reopen the work while preserving their source organization.

The responsible producing peer must run and LOOK at the exact outgoing operator
and report at desktop and narrow widths, use its important controls, and open
every delivered attachment in its ordinary recipient view. Use the current
populated case. Fix any unreadable chart/table, clipping, broken download or
reopening problem in this same implementation. Screenshots must actually be
viewed; source review and native numerical checks do not substitute for product
use. Keep presentation plain and industrial.

The native physical study is run from the original application source with
`python -m model.reach_chemistry.study_storage --output ABS_NEW_EMPTY`.
It records the actual Python/NumPy/SciPy runtime, complete analytical-case inputs
and their full original reports/CSVs/JSON/ZIPs, integrated-load comparisons,
source attribution, tangent perturbation comparisons and checkpoint continuation.
Use the original equipped Eco owner and preserve accepted source/run directories.
The source-bound USACE/client-file cases join the original Chemistry lifecycle;
their observed comparisons and scenarios remain separately selectable.
