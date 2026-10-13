# Measured records in Reach chemistry

Open **Measured observations → Bind reviewed measurements to Reach chemistry**.
This panel uses the saved measured-data workspace and the original Reach chemistry
case library in the same scientific project. A saved binding includes its complete
source population, accepted observations, exclusions, original source history and
an editable Chemistry child case.

## Select the actual population

Choose a saved physical case. Optional station, original source-date and normalized
parameter filters narrow the population before inspection. **Inspect original
records** reads the current measured revision, the full original rows, and the
selected case's actual reaches and species. It groups records by exact reported
characteristic, method and fraction.

A refreshed population retains compatible working mappings but adopts the newly
inspected measured revision. Review the displayed population before saving.
The native producer checks that revision again during preparation; changes in
source review or selected record versions require a new inspection.

The existing Measurements tab remains the place to review an original result,
choose a source revision, or exclude a record. Its raw row, retrieval sources,
laboratory/method, qualifier, unit, fraction and review history remain available
in this panel's individual record details.

## Define the scientific relationship

Complete the binding title, reviewer and explanation of why the measured population
supports the selected physical case.

For each station being used, choose an original native reach and record both the
assignment rationale and its source reference. The panel leaves assignments blank
until selected. Geographic proximity, a station label and a watershed identifier
do not establish a model reach relationship.

For each exact characteristic/method/fraction group being used:

1. Enable the mapping and select its measured quantity.
2. Choose the exact conserved mass basis of the modeled pools.
3. Enter positive weights for the species that form this measurement. Leave unused
   pools blank. Every component must use the declared basis.
4. Cite the source establishing the reported mass basis and fraction, then explain
   why the chosen operator represents it.
5. Enter a positive observation error scale in mg of the declared basis per litre,
   with its uncertainty rationale.

Weights define the observation operator; they do not convert a reported chemical
mass into elemental mass. The native binding checks explicit mappings and source
support. A total-nitrogen definition must use nonoverlapping pools: ammonia already
contained in TKN must not be added a second time.

## Time, censoring and roles

Enter model day zero as an ISO timestamp with an explicit timezone, for example
a source-supported timestamp ending in Z or -05:00. The model's calendar origin
is a scientific choice; it is not filled from an arbitrary import clock.

Choose the default fit or holdout role and, if appropriate, a source date from which
records are held out. Individual record details can override the role or set a
nonnegative model day with its rationale. Use **Keep record timing and role** to
retain that individual choice in the working definition.

Supported censored observations retain their actual source bounds. They are never
replaced by a midpoint. Optional interval overrides use the native shape:

~~~json
{
  "original-record-id": {
    "lower_mg_l": 0,
    "upper_mg_l": 0.02,
    "lower_closed": true,
    "upper_closed": false,
    "reason": "State the source-supported interpretation."
  }
}
~~~

The numbers above illustrate the shape only; enter the actual record's values.
An override must preserve the original declared bounds. A reviewed left-censored
concentration may use physical zero as its lower limit. A missing finite upper
bound for a right-censored result cannot be invented.

Optional derived total nitrogen uses:

~~~json
{
  "measurement": "total_nitrogen",
  "basis": "N",
  "basis_reference": "Original source establishing elemental N and fraction",
  "basis_reason": "Why the selected native pools represent this measured total",
  "components": [],
  "sigma_mg_l": null,
  "uncertainty_reason": "The scientifically chosen error scale"
}
~~~

Fill the actual same-basis components and positive error scale. The producer uses
the existing STOICH activity matching and concentration arithmetic to pair original
TKN and nitrate-plus-nitrite records within the same actual activity/context.
When it creates a total, those component targets are removed from the inference
population so the sum and its parts are not treated as independent observations.
Every original component record remains in retained source material. Unpaired,
unmapped or unsupported records remain visible with their exclusion reasons.

## Select the original native analysis

The native request editor accepts the original Chemistry request schema. It begins
with a calibration request and an empty parameter list, requiring explicit parameter
choices. The available-target table lists actual reaction and load IDs and retained
values from the selected physical case.

For calibration, each parameter specifies id, kind, target, lower and upper.
Use actual targets and scientifically supported bounds. Other modes retain
their original native requirements, including uncertainty distributions and draw
count or monitoring precision/candidate definitions. Do not enter an observations
array here: the saved binding supplies the reviewed native observations.

**Save reviewed binding and source-bound case** preserves the exact selection,
measured revision and original source records, then creates an editable child case
in this same scientific project. It does not calculate a result. Repeating the
same preparation after a lost response reopens its content-addressed native binding.

## Review, calculate and reopen

The saved view presents each native observation's operator, basis, reach, model day,
fit/holdout role, original value or interval and error scale. Expand accepted
records, excluded records and the full retained binding to inspect source history
and exact decisions.

- **Open source-bound Chemistry case** navigates the existing Reach chemistry desk
  to the exact saved child case. Its original physical editor, run history,
  scientific reports and portable export remain available.
- **Run retained native request** submits the saved native payload to the original
  chemistry.run queue. The browser persists the original operation identity before
  sending, reopens that task after a lost reply, and resumes that same failed or
  interrupted task when requested again. It never silently substitutes a new
  physical case or reconstructed observation population.
- **Export complete binding and request** downloads the native exported document,
  including the retained binding and original native payload. The returned export
  also describes the original editable Chemistry project export action.
- **Export working binding definition** preserves an unfinished selection for review.
  It does not mark that definition as a saved source-bound binding.

Working fields are retained per workspace through ordinary state updates and
navigation. Incomplete native JSON is retained as typed. Returning to the panel
can reopen the saved binding library without regenerating it. Inspect the population
again to resume editing a working definition against the current measured revision.

## Integration

The extension adds measured_chemistry.mjs to the existing measured-observation
assets. The same source is retained as measurement_workspace/web/chemistry.mjs;
both original extension entrypoints compose it without replacing the underlying
collection or measurement components.

The helper calls the original authenticated POST /api/measurements/chemistry
operations catalog, inspect, prepare, get and export. Requests remain pinned to
the workspace where the panel opened. The existing extension host's openDesk
method opens the actual saved Chemistry case. Native calculation uses the original
action/task routes.

The producer owns source review, revision checks, original activity matching,
compound/interval validation, portable measured-source retention and immutable
binding recovery. This browser adapter supplies explicit choices and presents
the resulting native records.

## Rendered product inspection

Before the October 13 14:00 UTC sprint handoff, the producing worker opens this exact populated workflow and LOOKS at its rendered desktop and narrow screens. Operate inspection, invalid input, saving, reopening, native case navigation, request recovery and export. View the actual screenshots and scientific output, then repair clipping, unreadable tables, missing styles or broken controls. Preserve the images with the receiving output. Source review alone does not establish the outgoing product's visual readiness.


## Reopen a binding from an independently received Chemistry case

A complete scientific Workspace transfer retains its saved binding library.
An editable Chemistry project can also carry the binding source independently.

Select the received physical case, then open **Reopen a binding carried by a
received Chemistry case** and choose **Read selected case sources**. The list
shows the original source titles returned by the native case. Choose its measured
binding source and **Inspect original binding and review**.

The panel reads the original source ticket and displays the retained title,
reviewer, scientific rationale, station assignments, exact characteristic/method/
fraction definitions, component operators, basis evidence, uncertainty, timing
and full original population. Its source digest must match the received case's
retained reference, and the source's physical project must match the selected case.

Only **Adopt this original binding in the received workspace** creates the
receiver's native binding record. The native producer validates the case/source
relationship and preserves the originating selection. Failed lookup or adoption
leaves the existing working definition and saved binding intact. The reopened
binding supplies the original native payload to the same Chemistry queue.
