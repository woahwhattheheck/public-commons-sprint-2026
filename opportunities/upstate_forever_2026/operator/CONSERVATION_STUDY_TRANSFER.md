# Conservation studies in editable Study transfer

## Continue an existing planning project

The existing Conservation desk can send a saved study or portfolio to the
existing Study transfer desk. Review the selected studies and their original
dependencies, export the editable project, and receive that archive through the
normal Workspace receiving flow. A saved scientific report that includes a
Conservation portfolio also brings the original planning records when the
report and planning study belong to the same project.

The receiving project keeps the original project, study and portfolio IDs. Its
Conservation desk can reopen the candidate inventory, saved portfolios,
optimization decisions and retained design/scenario continuations. Prepared or
interrupted study records keep their progress and original selections so the
existing model commands can resume them.

## What is carried

| Saved root | Original record | Retained material |
| --- | --- | --- |
| Conservation study | conservation/ID/study.json | Original bound sources, candidate and geometry inventories, native runs/grid when selected, progress, optimization history and candidate catalogue |
| Conservation portfolio | conservation-plans/ID/plan.json | Original study, portfolio selection, footprint and geodata, selected candidate results, referenced optimization and retained candidate selection |
| Decision packet | conservation-exports/ID/export.json | Original study/portfolio, exact ZIP and presentation files; optimized packets also retain their original underlying packet |
| Conservation report source | conservation-report-sources/ID/receipt.json | Exact imported report document, source companions, original source editions, study, portfolio and decision packet |

With **related results** selected, the original closure also finds portfolios,
decision packets and report captures for the selected study. Original
Conservation scenario bridges carry their source masks, native scenarios and
prepared paired experiments. Design preparations carry their complete editable
project ZIP; received designs retain the original handover, edited revision,
native registration and original prepared run. Candidate exports retain every
selected row in their original CSV/JSON.

The existing archive writer deduplicates shared source objects and native run
trees. File descriptors and original record identities remain the authority.
The Conservation resolver only reads records; it does not rebuild candidates,
change geometries, rerun a preference solver or recalculate model quantities.

## Scientific report relationship

The original Conservation report producer declares an observed-context report
role. The Sources report picker accepts that declaration and validates the
original report recipe before queuing a render.

For a selected saved scientific edition, the transfer follows the producer's
declared Conservation origin and validates the retained study, portfolio,
candidate inventory, decision packet and planning-source companions. Reports
from the same original project include their editable native records. A report
imported from another project keeps its self-contained original source members;
its lineage records the source project without resolving that project's IDs
against unrelated local records.

Reimporting the same report into another source collection of the original
project preserves its producer relationship. The selected imported edition and
the producer's original source collection are both retained, with the report
body and complete companion inventory compared by their original identities.

## Original records and locking

All four public roots extend the maintained model.study_transfer closure.
Conservation study and portfolio files are relative to the Workspace; they are
not prefixed a second time. Native run descriptors retain their original
runs/ID prefix. Decision-packet member inventories describe files inside the
ZIP and are not interpreted as Workspace paths.

Capture uses the original study, plan, source and packet owner locks. It also
acquires the original nested candidate catalogue/selection, scenario handoff,
design preparation/receiving and optimization packet locks for selected
history. The normal archive writer verifies frozen file bytes and restores
through its existing portable project contract.

A saved plan's optimization and candidate-selection history is a required
dependency even when related results are deselected. Optional scenario/design
continuations and other saved portfolios follow the related-results choice.

## Existing provider selection

The Study transfer provider accepts the established selection shape:

~~~json
{
  "schema": "upstate.study-selection/v1",
  "title": "Selected Conservation portfolio",
  "roots": [
    {"kind": "conservation-plans", "id": "<original-saved-plan-id>"}
  ],
  "include_related_results": true
}
~~~

Use an original ID from the Conservation desk or Study transfer catalogue. The
four root kinds are conservation, conservation-plans, conservation-exports and
conservation-report-sources. The original preview, export, upload and Workspace
restore routes remain the receiving path.

## Receiving exercise

Use the actual regional saved portfolio and original report-source producer
course. Preview and export its selected study, receive the full archive, and
reopen the same portfolio with its original candidate/geometry descriptors and
source collections. Reopen any included saved scientific edition and its
retained PDF/HTML/ZIP. Continue the original saved design or paired experiment
when present. This exercises actual retained project data through the normal
Conservation and Workspace implementations.
