# VIP Gateway pipeline manager

A retained local operator for HubSpot deals, manager decisions and approved native tasks and notes. The workspace calls the original [triage engine](../triage.mjs); its scoring and cohort calculations remain unchanged. The browser and CLI use the same SQLite project, immutable source files, definitions, reviews and provider receipts.

## Obtain this product

A sparse checkout downloads the product from the shared source repository without checking out unrelated projects:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/woahwhattheheck/public-commons-sprint-2026.git vip-pipeline
cd vip-pipeline
git sparse-checkout set business/vip-gateway-hubspot-triage-20261010
cd business/vip-gateway-hubspot-triage-20261010
```

## Run the operator

Use Node.js 24. The workspace has no installed dependencies, build step or hosted service requirement. Run these commands from this product directory:

```sh
node workspace/example.mjs /private/vip-development
node workspace/cli.mjs serve --state /private/vip-development --port 0
```

Open the local address printed by the second command. The example creates 64 explicitly generated development records and a completed original-engine review. It does not connect a HubSpot account. Keep each workspace in a private directory outside the source repository. Stop the server with Ctrl-C before accessing that same directory through the CLI.

For the original permitted HubSpot account, place its access token in the operator host's environment and pass only the variable name:

```sh
node workspace/cli.mjs serve --state /private/vip-operator \
  --token-env VIP_HUBSPOT_TOKEN --port 0
```

The configured provider is the original `https://api.hubapi.com` endpoint. The server binds to loopback. It serves its own scripts/styles and accepts writes from its original local origin using the workspace request header. The token is never sent to the browser, included in a project export, written in provider receipts or embedded in command arguments. Use the account permissions appropriate to the selected CRM reads and task/note operations; inspect actual native HTTP errors and retained responses if the account denies an operation.

An explicitly selected loopback development HTTP provider is supported with `--provider-origin http://127.0.0.1:PORT --development`. Its origin and development classification remain visible. This is useful for an integrator's native route fixture; it does not change the official production origin.

## Source and definition workflow

1. Create or reopen a project and enter a named operator.
2. In Definitions, select the original property names for next action, lead source, optional lead quality and record modification. Map native stage IDs to open, won or lost; choose the analysis pipeline/team scope and alert budgets. Last contact, stage entry, lost reason, amount and currency are separate optional context mappings.
3. Capture the account's original property and pipeline schemas, then its paginated deals, or import the original schema responses and deal JSON. Each saved source version retains exact bytes and hashes. Inspect source rows, field inventory, pipeline/stage counts and downloadable originals before selecting a run.
4. Start an analysis with an explicit as-of time. Each run pins the selected source, configuration and hashes. The original report is downloadable unchanged.
5. Save manager decisions, compare saved runs and prepare specific native work from the emitted attention list.

Native deal acquisition uses fixed original property selections, `archived=false` and opaque provider cursors. It captures the account's permitted deal listing before applying the chosen analysis scope. Each completed page is committed with its exact response and next cursor. A stopped capture retains its prefix and resumes that same request chain; a changed credential/origin binding starts a separate capture. Exact repeated records are counted once. Conflicting duplicate values, repeated cursors or capacity limits leave the stopped capture available for inspection.

A completed paginated listing is an observation interval, with separate start and end times. It does not claim an atomic account snapshot or a complete history of associated activities. Imports are explicitly marked operator-declared complete or partial; a response that still contains a next cursor cannot be declared complete.

When a source has captured account schemas, analysis checks that each configured property exists and each selected deal's stage belongs to its original pipeline. Imports without schema captures retain their operator-supplied mappings. The workspace retains both omitted original properties and explicit null values. Schema and scope choices are part of the source contract. A label is not a native property name, a HubSpot owner ID is not its user ID, and a native stage belongs to its pipeline. Owners are displayed by their original IDs; the current connector does not fetch the owners directory or associated activity histories.

Deal amounts and native atomic values remain strings in the manager context. The workspace does not total or convert them through JavaScript floating point. A mapped numeric amount is rejected rather than silently rounding it.

## Reading the original analysis

The original engine emits missing/overdue declared next-action dates and stale record edits, with stable prioritization and per-owner/global budgets. Suppressed counts remain visible. An old modification timestamp is a record-edit observation; it is not evidence of customer-contact inactivity. The separately selected contact, stage-entry and lost-reason fields retain their actual names and observed values.

Cohorts group the actual retained deals by pipeline, chosen lead source, optional quality and age bucket. The original won/lost denominator, observation window and minimum-sample suppression remain in the report. This implementation does not infer causal conversion uplift or rank individual salespeople by raw conversion rate.

Manager decisions are open, confirmed, dismissed, resolved or deferred. A non-open decision needs a named explanation; deferred work also needs a due time. Decisions carry across runs only when the exact deal basis, original rule reasons and definitions are unchanged. A changed basis has its own review. Version conflicts preserve the operator's current draft while they reload, inspect and reapply it.

Run comparison shows both original summaries and cohort values, the definitions/scope/as-of compatibility, and the exact added, absent or changed source records. An alert described as resolved is no longer emitted by the selected run; changes in scope, caps or definitions may explain it. A record absent from a later capture is not automatically a deleted or lost deal.

The operator can retain daily and weekly reviews as named runs. Capture and run commands are explicit; this product does not install a scheduler or send manager digests automatically.

## Approved tasks, reminders, escalations and notes

The supported native writes create a HubSpot task or note associated with the exact reviewed deal. Reminders use the task's reminder field. Escalations create the operator's selected task for the selected owner; they do not automatically message a customer or manager.

| Step | Retained behavior |
| --- | --- |
| Propose | Choose an emitted deal, action type, exact content, native owner ID, due/note time and optional reminder. |
| Prepare | Read the current original deal and compare its pinned basis; read the native task/note-to-deal association type; retain the complete concrete POST request and request hash. |
| Approve | A named operator approves that exact request with an explanation. Preparation alone performs no create. |
| Execute | Recheck provider and source, durably record the attempt, then issue one native create. The returned original object ID and response are retained. |
| Reconcile | Inspect the returned ID or find the unique action marker in the native object listing, then verify the marker and exact deal association. Preserve actual provider-normalized fields and differences. |

The application never automatically retries a native create. A transport loss, ambiguous server response or process interruption after the durable attempt becomes uncertain. Reconciliation reads the original native task/note objects; it does not create a replacement. A complete marker scan with no match remains inspectable, and a later read can recover an eventually visible object. Operators may supply the actual native object ID for direct reconciliation.

Read retries respect original provider backoff. A long requested delay becomes a retained retry time for explicit continuation. Transient failures and partial scans keep their original responses and progress.

Unexecuted proposals can be revoked. Native task/note deletion or undo is not implemented. Completed native objects remain real CRM objects, with their IDs and receipts, including after a project restore. Customer communications and material deal updates retain the buyer's explicit human-approval requirement; neither operation is performed by this connector.

## Private handover and recovery

Export writes a compressed project file containing the selected project's source files, saved runs, exact original reports, definitions, manager decisions, native action requests/responses and history. It contains CRM data and manager content. Handle it under the same access arrangements as the original account export.

Repeated exports exclude earlier export payloads, so handovers do not recursively embed old backups. Incomplete source-sync jobs remain historical events and are not restarted by restore. All retained source and receipt files remain available.

Restore checks the whole archive and each original file/record hash, then creates a separate project with fresh internal IDs. It preserves original byte content and provenance. Unexecuted proposals need preparation against the restored operator host before another approval. Actual uncertain native attempts remain uncertain and reconcile-only; restored projects never resend them. Completed task/note receipts retain their native identity.

SQLite uses durable transactions and a single active process owner. A normal close releases the directory; a later process can reclaim a stale lease. Opening the same directory concurrently is refused. Back up through the project export or while the server is stopped.

## CLI operations

```sh
node workspace/cli.mjs help
node workspace/cli.mjs init --state /private/vip --name 'Leasing team'
node workspace/cli.mjs config --state /private/vip --project PROJECT --file /private/config.json
node workspace/cli.mjs sync --state /private/vip --project PROJECT \
  --name 'Monday source' --token-env VIP_HUBSPOT_TOKEN
node workspace/cli.mjs resume --state /private/vip --job JOB --token-env VIP_HUBSPOT_TOKEN
node workspace/cli.mjs run --state /private/vip --project PROJECT --snapshot SOURCE \
  --as-of 2026-10-12T09:00:00Z --name 'Monday manager review'
node workspace/cli.mjs report --state /private/vip --run RUN --out /private/new-report.json
node workspace/cli.mjs compare --state /private/vip --run CURRENT --baseline PREVIOUS
node workspace/cli.mjs export --state /private/vip --project PROJECT --run RUN \
  --name 'Manager handover' --out /private/new-handover.json.gz
node workspace/cli.mjs restore --state /private/vip --file /private/new-handover.json.gz \
  --name 'Restored manager project'
```

The CLI also exposes original JSON import/schema capture, named review, action proposal, preparation, approval, execution, reconciliation and revocation. Supply `--actor` and `--request-id` for named idempotent writes. Reusing an ID with the identical request returns its original result; changing that request under the same ID is rejected. Sync, run and native action commands await their retained operation. Output files are create-only.

## Composition and implementation map

| File | Responsibility |
| --- | --- |
| `../triage.mjs` | Maintained original analysis engine, unchanged. |
| `source.mjs` | Native account/schema definitions, source integrity and official HTTP transport. |
| `store.mjs` | SQLite custody, immutable source blobs, transactions, request IDs and process ownership. |
| `model.mjs` | Capture checkpoints, original runs, named reviews, comparison and portable recovery. |
| `actions.mjs` | Concrete native requests, approvals, one-attempt execution and receipt reconciliation. |
| `server.mjs` / `cli.mjs` | The same retained workflow over local HTTP and terminal commands. |
| `public/` | Industrial operator interface, source inspection, draft recovery and mobile navigation. |
| `example.mjs` | Explicitly generated development starter for learning the complete workflow. |

Implemented capacities are 100,000 unique deals per source; 128 MiB source/import or compressed export; 16 MiB per provider/schema response; and up to 100 rows per API page. A capacity or source-shape error preserves already retained work. The current source capture is a full permitted account listing, not incremental modified-since synchronization.

## Native acceptance

The original 64-record development source was exercised through the real local HTTP provider adapter, durable SQLite model and CLI. A stopped second page resumed after process reopen; the source produced the same 24-alert original report. Named review conflicts and carryover, exact `9007199254740993.07` amount text, native reminder/note requests, a lost create response recovered with one task POST, changed-record/cohort comparison, nonrecursive export/restore and byte-identical CLI report reopening all completed. The joined browser workflow reopened this same state and completed eight operator areas: two-operator definition conflict/reapplication, source pagination and exact original import, saved original runs/cohort comparisons, named manager decisions, a distinct approved native task created once, inspection of the original recovered task, full handover/restart/restore, and all eight sections at a 390-pixel viewport. Its restored project retained four source versions, four runs, four actions and six schema captures.

This is a runnable engineering product. These development records establish implementation behavior, not a customer's account deployment, production uptime or conversion improvement.

## Original provider references

- [HubSpot deals: native properties, lists and history](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide)
- [Properties: original internal names and metadata](https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/guide)
- [Pipelines: original pipeline and stage definitions](https://developers.hubspot.com/docs/api-reference/legacy/crm/pipelines/guide)
- [Owners: owner IDs and archived identity](https://developers.hubspot.com/docs/api-reference/legacy/crm/owners/guide)
- [Tasks: native properties and create/read behavior](https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/tasks/guide)
- [Notes: native properties and create/read behavior](https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/notes/guide)
- [Association types: original object-to-object types](https://developers.hubspot.com/docs/api-reference/legacy/crm/associations/v3/associate-records)

The maintained integration uses these v3 contracts consistently. The original-source handoff from team 7108 confirmed the provider's v3 deal, owner, pipeline and property definitions; their distinctions are preserved here.
