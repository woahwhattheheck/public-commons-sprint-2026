# Eighteenmile field and laboratory handover

## Open the original work

Extract the complete delivery and open `START_HERE.html`. The offline entry joins
the full laboratory report, the separate station/collection-event register, all
original source tables, both editable plan-and-file packages and the complete
native application/workspace archive.

The laboratory table contains all 88 retained results. Search filters only the
view, not the downloads. Original result types, values, source text, units,
fractions, qualifiers, limits and methods remain separate fields. Keep censored
records in their original form when interpreting the study. The full native CSV
and unchanged publisher CSV are both linked beneath the table.

The station and collection-event plan contains three original stations and 48
actual station/date/time events derived from 88 retained activity rows. The 40
repeated event rows remain in the complete decision audit. The saved onboarding
plan is separate from the original laboratory plan, so importing the original
station/event files does not replace the 88 laboratory observations.

The original coordinates explicitly declare NAD83 and are retained as
EPSG:4269. The activity file's original EST text is retained as fixed UTC-05:00,
including summer dates. The source record, not an inferred local clock or datum,
is the authority for those values. The full original station table, all event
groupings and both saved plan documents travel with the delivery.

The source records are historical 2023 observations. Each report retains its own
native reporting date; the report date is not a new observation date. Original
source references are available in each `plan.json` and the complete workspace.

## Continue the application and both plans

`Eighteenmile_Complete_Workspace.zip` is the complete native application and
workspace archive. Extract its `application/` folder first to access the
maintained receiving command, then restore into a new directory:

```sh
python application/model/cli.py restore Eighteenmile_Complete_Workspace.zip received-field
python received-field/application/operator/server.py --workspace received-field/workspace
```

The application's scientific `environment.yml` records its full environment.
This source/field course uses the retained Python implementation modules and does
not require rerunning the native scientific models. Use the operator's printed
local opening address on the receiving workstation, open Implementation, and
select the retained plan. Original project identity is
`dc92b8b9-6eda-4362-b12d-3cf2ef6c9007`.

The laboratory plan is `eighteenmile-2023-original-lake-samples`. The separate
station/event plan and both exact delivered revisions are named in the opening
page and `delivery.json`. All original revisions, source attachments, import
history and retained reports remain editable through the maintained application.
A returned field edition uses the ordinary revision-aware import/reconciliation
flow, preserving later saved work.

## Use the complete plan-and-original-file packages

`Eighteenmile_Original_Laboratory_Evidence.zip` and
`Eighteenmile_Original_Station_and_Visit_Evidence.zip` contain each unchanged saved
plan plus every original local-file attachment. Their manifests retain original
source aliases, filenames, byte identities and the source's same-plan paths.
The package for the station/event plan also carries both complete import audits.
A plan-only JSON does not include these original file bodies.

The maintained Python API can inspect or receive a package without depending on
which CLI presentation is installed. From the received application directory:

```python
from pathlib import Path
from model.implementation import ImplementationStore
from model.implementation_evidence import read_package, import_package

package = Path('/absolute/delivery/Eighteenmile_Original_Laboratory_Evidence.zip')
received = read_package(package)
store = ImplementationStore('/absolute/received-field/workspace')
result = import_package(store, package, expected_plan_id=received['plan']['id'])
print(result['status'], result['plan']['id'], result['applied_revision'])
```

The API checks the complete original ZIP before importing. A new receiving plan
can preserve its saved revision, an unchanged existing plan reopens unchanged,
and stale edited returns remain on the original conflict-aware path. Do not
resolve a concurrent change by rewriting its revision number. Use the existing
returned-field-package review instead.

## Assemble the delivery from retained completed work

The maintained source course `source_tools/receive_wqp_sites_visits.py` retains
its operation under `workspace/implementation/site-visit-receiving/`. The native
evidence export/receiving result identifies the original complete packages for
both plans. Once those operations are complete:

```sh
python source_tools/deliver_field_sources.py \
  --workspace /absolute/field/workspace \
  --onboarding-result /absolute/field/site-visit-receiving-result.json \
  --evidence-directory /absolute/field/evidence-delivery \
  --output /absolute/deliveries/eighteenmile-field
```

Use `--laboratory-report REPORT_ID` when more than one retained report matches the
selected original laboratory revision. The onboarding result selects its own
original report edition. The assembler copies both complete report sets, both
original ZIPs and all three publisher CSVs; it does not regenerate observations,
rerun intake or repeat reconciliation exercises. It captures the complete native
workspace with the maintained backup transaction.

The handover is create-only and kept outside application, workspace and original
evidence directories. Its file register and exact source selection allow an
unchanged delivery to reopen. A changed selection uses a new directory. An
interruption retains the unfinished staging directory and completed native
products. `source-receiving/` contains the original event mapping, grouping and
receiving results; `delivery.json` binds both plan editions, both reports and the
complete application source used for capture.
