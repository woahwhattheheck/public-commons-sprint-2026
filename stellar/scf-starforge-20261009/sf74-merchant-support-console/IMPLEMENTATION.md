# Merchant implementation and receiving

The **Implementation and receiving** desk completes the existing SF74 merchant case after its workorder is prepared. The same saved case carries the customer task, assigned implementation, original deliverables, receiving decisions and measured effort. Browser, HTTP, CLI and MCP operations use one workspace format and the original case writer.

The source/terms preparation in [SF49 source-edition commissioning](../../scf_2026/sf49_data_commissioning/SOURCE_EDITION_COMMISSIONING.md) and the original [SF77 workorder](../sf77-merchant-workorder/README.md) supply the agreed work. This desk turns those milestones into editable implementation tasks. Existing runtime, incident, payment, merchant-release and buyer operations retain their own saved records; attach their actual output or refer to those records from the implementation.

## Use the complete browser workflow

Start the existing console with its private case directory, or open its configured application from the maintained Applications workspace:

~~~sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /absolute/private/merchant-cases \
  --port 8784
~~~

Open the printed local address. Reopen the relevant merchant case, including its original source captures, attached runtime and owner terms.

1. **Generate the original workorder.** Choose the existing diagnostic or attached-runtime source, review its terms, and select **Create workorder**. The implementation panel displays the workorder reference, changed route scope, new milestones and changed source fields.
2. **Use the workorder.** Enter the actual operator in **Recorded by**, review the source changes, and select **Use this workorder**. The exact packet, HTML, acceptance checklist and every supplied original input become a retained edition. Reusing an identical retained edition selects its existing identity.
3. **Describe the useful customer result.** Fill in the customer task, implementation payer, merchant, buyer, original source location, merchant host, consuming application, complete output, repeat trigger, implementation and receiving owners, and support scope. Keep the original commercial record linked here. Draft plan changes are included by **Save case**.
4. **Assign and perform the work.** Give the original milestones owners, due dates, acceptance criteria, prerequisites and implementation notes. Add the actual integration tasks needed for this customer. Status and retirement are explicit operator choices. Task search and paging retain the complete case; they do not truncate it.
5. **Attach original deliverables.** Select the actual files, their purpose, source reference and related tasks. Files keep their original names and bytes. Mark observation files as observations; customer files, source inputs, installation files and guides can form part of the delivered work.
6. **Record receiving.** Select the actual workorder edition, receiving kind, tasks, original deliverables, observation time and result. Enter the receiving operator, record or application reference, and what was observed. Technical receiving and customer receiving have separate totals.
7. **Measure the customer task.** Record a before, installed or later recurring observation using the same task definition, comparison identifier, output and unit. Enter actual input population, quantity, operator time, elapsed time and corrections as available. Keep original measurement files and references attached.
8. **Save and hand over.** **Save case** retains the whole implementation. The existing complete support export carries it to the receiving desk. The implementation section also downloads the readable report, task CSV and complete implementation JSON.

Plan and task edits are part of the case draft immediately. A receiving or measurement form becomes a recorded observation when its **Record** button succeeds; then save the case. Form values survive related attachment/task refreshes. Opening another case uses the existing case desk's draft transition controls.

## Source editions and operator choices

The original workorder reference and milestone key identify a source task. A later workorder with the same reference updates source-owned title and acceptance text when those fields still match the earlier source. Deliberately edited text remains in place, with the new source value displayed for selective adoption.

Owners, due dates, status, prerequisites and notes remain operator work. A milestone missing from the new source receives a visible retirement proposal. The task and its original receiving history stay available. A different workorder reference creates a separate set of source task identities inside the same case; the earlier work can be reviewed and retired deliberately.

The **Workorders, history and handover** section opens the exact earlier packet and inputs. Reviewing and using an earlier edition selects that source for the current workplan. All later source files, deliverables and receiving observations remain retained.

### Receiving is tied to the actual delivered subject

Each receiving record saves a SHA-256 digest and complete subject snapshot containing:

- the selected task titles, acceptance criteria and prerequisites;
- the delivery-relevant customer task, merchant, buyer, source, host, consuming application and output definition;
- the inspected original file IDs and hashes;
- the task-linked deliverable set for that workorder edition.

Current accepted totals include only observations whose subject still matches. Changing the task definition or adding linked delivery files makes the earlier observation historical and increments **Receiving needs updating**. Changing a task's owner, due date, status or work notes leaves its delivery definition intact.

A correction retains the original task scope, delivery definition and delivered file set. It can correct the observed result, time, reference or notes and attach additional observation files. Record a new receiving observation for changed work or new deliverables. The earlier row remains in the history and identifies its correction. The most recent observed receiving result is selected independently for technical and customer receiving.

### Compare actual effort

Measurements retain their original edition, task definition, output, unit, input description, observed time, operator, files and reference. Comparisons select an earlier baseline with the same comparison identifier, exact task definition, output and unit. Corrections supersede the selected earlier measurement while preserving it.

The report shows recorded totals, arithmetic changes and percentages. When quantities differ, it identifies the volume difference and also computes per-unit time and corrections where both quantities are positive. A missing value stays blank, a measured zero stays zero, and a zero baseline has no percentage denominator. Each comparison links its two original measurement records.

## Save, restore and recover

The original case revision is the outer concurrency boundary. Every API or MCP mutation requires the exact current saved case revision. The implementation also carries an integer revision; commands require that current value.

Keep one stable request ID and the exact original command payload. On a lost response, inspect the original case and repeat the same command. Its retained operation is checked before current revision rejection, so a successful original request is returned without applying it again. Reusing an ID for a different payload is a conflict.

The saved-case preparation command also retains its exact compiled edition. Recovery reuses that packet and its original inputs rather than generating a second workorder with another timestamp.

Restoring an older case version applies the selected historical workplan while retaining all later immutable editions, files, receiving records, measurements and operation identities. Later-only tasks remain available as retired tasks so historical references stay usable. The restore creates a new current case version. The browser receives the canonical merged implementation after save. Older clients that omit the optional implementation field preserve the existing saved implementation.

Private case writer ownership, stopped-process recovery and immutable version storage remain the original [case desk](CASE_DESK.md) operations.

## Installed CLI

The source-owned `merchant-implementation` contribution registers the original CLI and both programmatic interfaces. Its complete source is included by the original distribution builder.

~~~sh
starforge registrations --source merchant-implementation
starforge registrations --command merchant-implementation
starforge merchant-implementation --help
~~~

The following paths, IDs and hashes stand for the operator's actual retained values.

Read the current implementation and every requested task page:

~~~sh
starforge merchant-implementation read \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID

starforge merchant-implementation read \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID --section tasks --offset 0 --limit 100
~~~

A section returns `total` and `nextOffset`. Continue from that returned offset until it is null. Sections are `overview`, `tasks`, `materials`, `receiving`, `measurements`, `events`, `editions`, `files` and `comparisons`. An explicit `--revision` opens a retained historical case.

Prepare the implementation directly from the saved case:

~~~sh
starforge merchant-implementation prepare \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID --revision CURRENT_CASE_SHA256 \
  --implementation-revision 0 \
  --request-id original-workorder-operation \
  --actor "Actual implementation operator"
~~~

Use the returned case and implementation revisions for the next mutation. Supply `--recorded-at` only when deliberately retaining a specific actual UTC preparation time.

Attach an original private deliverable:

~~~sh
starforge merchant-implementation attach \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID --revision CURRENT_CASE_SHA256 \
  --implementation-revision CURRENT_INTEGER \
  --request-id original-deliverable-operation \
  --actor "Actual implementation operator" \
  --file /absolute/private/original-deliverable.csv \
  --kind deliverable --tasks TASK_ID \
  --description "Complete customer output" \
  --reference ORIGINAL_SOURCE_RECORD
~~~

Apply a saved original command file:

~~~sh
starforge merchant-implementation apply \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID --revision CURRENT_CASE_SHA256 \
  --command-file /absolute/private/original-command.json
~~~

The command document has `type`, `requestId`, integer `expectedRevision`, `actor` and `payload`, plus an optional UTC `recordedAt`. `expectedRevision` inside the document is the implementation revision; the command-line `--revision` is the saved case SHA-256.

Export the complete selected implementation and receiving package:

~~~sh
starforge merchant-implementation export \
  --cases-dir /absolute/private/merchant-cases \
  --case CASE_UUID --revision SELECTED_CASE_SHA256 \
  --out /absolute/private/received-implementation
~~~

The output includes case metadata, the exact workspace, complete implementation JSON, readable HTML, task CSV and every original edition/input/material file. If the selected case has an attached runtime, the same manifest also contains the original complete `merchant-support.json` handoff and `support.html` report. The original `support-export.json` manifest is also included, followed by the complete `implementation-export.json` inventory. Repeating the export verifies matching retained files; different existing bytes are preserved and reported as a conflict.

For the complete automatic receiving flow, export under the configured MCP private exports directory using a matching export ID, then select that original named export in the Handoffs desk. The package includes the same `support-export.json` schema used by MCP; its existing manifest/file reader transfers the exact workspace and case metadata for both diagnostic and runtime cases. `--export-id` sets the original ID; otherwise it is the output directory basename. A runtime case can also import its `merchant-support.json` directly through the existing portable support-file flow.

## HTTP and MCP

All HTTP routes use the existing local console's host/origin checks and configured private case store.

| Operation | HTTP | MCP |
| --- | --- | --- |
| Read implementation or a complete selected page | `GET /api/cases/ID/implementation?section=tasks&offset=0&limit=100` | `merchant_case_implementation` |
| Prepare from the exact saved case | `POST /api/cases/ID/implementation/prepare` | `merchant_case_implementation_prepare` |
| Apply the original implementation command | `POST /api/cases/ID/implementation` | `merchant_case_implementation_apply` |
| Complete case export | Existing saved Support export | `merchant_case_export` |
| Recover and download that export | Existing Handoffs desk | `merchant_support_export_status`, `merchant_support_export_manifest` and `merchant_support_export_file` |

A prepare body contains `expectedRevision`, `expectedImplementationRevision`, `requestId` and `actor`. An apply body contains `expectedRevision` and `command`. MCP adds the original `id` field to select the case. The request ID and original payload must remain stable when recovering a response.

### Command payloads

| Type | Payload |
| --- | --- |
| `update_plan` | Any supplied fields from the implementation plan; omitted fields remain. |
| `save_tasks` | `tasks`: a batch of task IDs and changed title, acceptance, owner, dueOn, status, notes, dependencies or retired values. A new non-source ID creates an operator task. |
| `accept_source_changes` | `changes`: selected `taskId` / `field` pairs currently proposed by the workorder source. |
| `select_workorder` | The retained `editionId` to use for the current workplan. |
| `record_workorder` | The original `result` (`packet`, `html`, `checklist`), exact `inputs` and optional original `sourceCase`. Use saved-case preparation for the ordinary MCP workflow. |
| `add_material` | Stable material `id`, original basename, mediaType, canonical Base64 `data`, kind, description, taskIds, optional editionId and reference. |
| `record_receiving` | Stable `id`, editionId, taskIds, materialIds, kind, outcome, observedAt, reference, notes and optional supersedesId. The shared module captures the exact receiving subject. |
| `record_measurement` | Stable `id`, editionId, phase, taskDefinition, comparisonKey, inputDescription, outputDescription, unit, nullable units/activeMinutes/elapsedMinutes/manualCorrections, observedAt, materialIds, reference, notes and optional supersedesId. |

Task statuses are `planned`, `in_progress`, `ready`, `done` and `retired`. Receiving kinds are `technical` and `customer`. Outcomes are `accepted`, `changes_required`, `not_run` and `not_applicable`.

The existing MCP Support export adds three files when the selected case has an implementation: `merchant-commissioning.json`, `merchant-implementation.html` and `merchant-implementation-tasks.csv`. Its original named export, complete manifest and retained chunk reader deliver those bytes. The workspace and support handoff also contain the full implementation, including exact original file bytes.

## Programmatic use

~~~js
import {
  applyCommissioningCommand,
  commissioningSummary,
  commissioningReport
} from '@tokenjunkielabs/starforge-merchant/merchant/implementation';

import {
  inspectCaseCommissioning,
  prepareCaseCommissioning,
  operateCaseCommissioning
} from '@tokenjunkielabs/starforge-merchant/merchant/case-implementation';
~~~

The first interface is the same browser/Node pure workspace logic. The second takes an original SF74 case store and uses its saved revisions. Source documents remain original SF77 output; historical import validates their retained files and bindings without recompiling old documents against a later engine.

## Source and file capacity

Original workorder and material files are SHA-256 addressed and deduplicated within the implementation. One file can be up to 48 MiB; the complete implementation JSON can be up to 64 MiB. The surrounding workspace and support handoff have their matching expanded transport budgets. File selection, decoding and full import validate before changing the saved case.

The CLI uses the existing private file reader. Source documents, customer deliverables, observation references and complete handoffs remain in the original private case and export directories. The implementation source and operating guide are distributable application code.

## Native continuation

Continue from the existing completed SF74 support case and its retained original sources. The useful receiving journey is:

1. reopen that exact case and prepare its original workorder;
2. assign the complete source milestones and customer implementation work;
3. attach its actual original output, record the actual receiving observation and save;
4. edit a received task and confirm the current receiving indicator changes with its definition;
5. record a new observation for the changed subject and a correction of an earlier observation;
6. reopen the saved case through MCP and CLI, then export the complete private package;
7. import through the original Support receiving desk and reopen its runtime, metadata, workplan and original files;
8. restore the earlier selected workplan and confirm the later immutable observations and files remain available;
9. recover an exact earlier request and resume useful work from the received case.

Reuse the original completed captures and installation. The saved operation and actual receiving output identify where that continuation has reached.
