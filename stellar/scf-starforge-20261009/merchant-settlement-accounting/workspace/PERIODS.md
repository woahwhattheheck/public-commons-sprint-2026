# Recorded-activity periods and retained closes

The **Periods & closes** area adds saved UTC intervals and immutable close
revisions to the existing merchant accounting workspace. It uses the original
accounting engine, exception reviews, comparison, and archive writer. Open the
workspace with the same [merchant-host command](README.md#open-on-the-merchant-host);
the installed distribution's `merchant-accounting-workspace` command includes
this area in the same application.

## Choose the reporting interval

Enter a period name, a UTC start, and a UTC end. The start is included and the end
is excluded. Both fields accept seconds and milliseconds, so adjacent intervals
can share an exact boundary without counting that boundary twice.

| Original source | Timestamp used for period selection |
| --- | --- |
| `SF98_NATIVE_CAPTURE` | The original event's `at`, labeled `NATIVE_SETTLEMENT_CAPTURED_AT` |
| `RECOVERED_ORIGINAL_SF31_OUTCOME` | The retained entry's `importedAt`, labeled `RECOVERY_IMPORTED_AT` |

These are recorded-activity intervals. A recovered outcome enters the interval
containing its import timestamp. Its transaction may have settled earlier; the
workspace does not substitute an inferred ledger timestamp for the retained
source's time basis.

Select **Save & select version** to retain the definition and choose it for future
reconciliations. Editing a saved period creates another definition under the same
period identity. The earlier versions remain selectable. **Copy to editor** uses
a retained version as the starting point for another definition; it leaves the
retained version unchanged. A note can record why the coverage changed.

The current choice appears above every operator area, including pricing and RPC
collections. Select **Use all recorded activity** to restore the original
all-source behavior. Existing workspaces begin with all activity selected when
first opened with this version.

## Capture and inspect the original result

Name a run and select **Capture period sources**, or use the main reconciliation
form with the current period selected. Queueing pins the exact period identity,
version, name, start, and end to that run. Later selection or definition changes
affect future runs.

The capture retains the complete original journal prefixes, selected accounting
terms, verification results, any selected original pricing report, and the
connected recovered collection. Source bytes are never shortened to the period.
The original engine first validates all captured events, resolves payment terms,
classifies proof matches, and checks network-plus-transaction reuse across native
and recovered origins. It then selects rows in `[from, until)` and passes those
rows to its existing route, option, exception, and total summaries.

An outside-period event therefore still participates in conflict and reuse
handling for an inside-period transaction. The following scopes remain explicit:

| Result | Scope |
| --- | --- |
| Event ledger, exceptions, route and payment-option totals | Selected recorded-activity interval |
| Configured payment options with zero selected events | Still visible through the original option summarizer |
| Source SHA-256 identities, ignored proof files, unmatched official proof count | Complete captured sources |
| Verification-file and recovered-source browser views | Complete captured inputs |
| `period.sourceCounts`, `period.selectedCounts`, `period.excludedCounts` | Separate counts for every captured, selected, and outside-period record |

Amounts remain the original decimal strings. The recorded interval does not
change an original proof classification, the meaning of a native SDK success,
or the merchant's quoted USD valuation.

## Retain a close revision

Choose a completed period reconciliation, name the close, and record any useful
handoff context. Select whether to include the private captured sources, then
select **Retain close revision**. Open and investigating exceptions are retained
with their original classifications and named review notes.

Each close receives a sequence number within its saved period, including when a
later close uses another definition version. It records the previous close
identity, original run and report identity, period definition, coverage counts,
workspace revision at close, and frozen review counts. A source-inclusive close
also retains the complete original source files and any saved recovered response
bytes in its archive.

**Close history** keeps every revision available. Inspect a close to compare each
frozen note with its current workspace review, including the full note, reviewer,
assignee, status, version, and time. A later review does not change the earlier
close or its download. The source-inclusive checkbox explains when a download
contains the merchant's private original data.

The close uses the same original archive writer as an ordinary review export.
Its TAR contains the original six accounting files, `input-manifest.json`,
`review-notes.json`, `START.txt`, and the additional `period-close.json`.
Source-inclusive archives contain `sources/`. The close metadata binds the
original report, source manifest, and frozen review notes by SHA-256. Downloads
check the retained file or archive identity before returning it.

## Compare and reopen

Choose a retained close and another completed period run in **Compare a close
with another capture**. The existing comparison shows added, removed, and changed
events; new and resolved exceptions; and complete before/after option totals.
Both recorded-activity intervals appear above the result. If the boundaries
changed, added or removed rows may follow from that selection change, and the
interface states it explicitly. The original comparison remains available for
any two completed runs, including an all-activity baseline.

Stop and reopen the same workspace directory to continue. Saved period
definitions, the selected version, pinned runs, close revisions, frozen notes,
and original downloads remain available. Ordinary workspace revision conflicts
retain edited form text and use the existing explicit reload/inspect/reapply
flow. Definition edits also carry the current saved definition version.

## Reproduce the source-inclusive close

Extract the TAR into a private directory. `START.txt` contains the exact selected
UTC bounds and the original command structure. Use the same original checkout:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/cli.mjs \
  --outbox /private/extracted-close/sources/outbox \
  --proof-dir /private/extracted-close/sources/proofs \
  --terms /private/extracted-close/sources/terms.json \
  --out /private/new-period-report \
  --period-from 2026-10-01T00:00:00.000Z \
  --period-until 2026-11-01T00:00:00.000Z
```

Replace the example bounds with the exact `period.from` and `period.until` in
`report.json` or `period-close.json`. When the captured source manifest includes
a recovered collection, add `--recovered-dir /private/extracted-close/sources/recovered`.
Both period flags are required together. They accept UTC timestamps ending in
`Z`, with seconds and optional three-digit milliseconds. The end must follow the
start. Omit both flags to use the original all-activity engine behavior.

The CLI recomputes the original accounting result from the complete retained
sources. Frozen review notes remain in the separate close archive; they never
change the engine's accounting classifications.

## Existing workspace API

The native engine exports `compileAccountingPeriod({from,until})` and accepts an
optional `period` in `runOriginalAccounting` and `compileLedger`. Omit it or pass
`null` for all activity. Period metadata is included in the original report and
its output manifest.

The existing `openAccountingWorkspace` object exposes `workspace.periods`:

| Method | Operation |
| --- | --- |
| `save({revision,id?,expectedVersion?,name,from,until,note,select,actor})` | Retain another immutable definition; `select:true` selects it |
| `select({revision,selection,actor})` | Choose `null` for all activity or `{id,version}` for a saved definition |
| `retainClose({revision,runId,name,note,includeSources,actor})` | Use the original writer to retain a close and its review snapshot |
| `detail(closeId)` | Read the retained close and frozen/current review counts |
| `notes(closeId,{offset,limit,status,search})` | Page through frozen exceptions beside current reviews |
| `file(closeId,name)` | Download `period-close.json` or `review-notes.json` after identity verification |

`workspace.begin` additionally accepts `expectedPeriodSelection` and pins the
selected definition to `run.period`. `workspace.compare` returns `scope` with
the original baseline and current period metadata. Existing `workspace.archive`
serves the retained close TAR using its export identity. The full period state
appears under `workspace.view().periods`.

Same-origin HTTP routes are `GET/POST /api/periods`,
`POST /api/periods/selection`, `POST /api/periods/closes`,
`GET /api/periods/closes/:id`, and `GET /api/periods/closes/:id/notes`.
`GET /api/periods/closes/:id/download` returns the original TAR;
`/download/period-close.json` and `/download/review-notes.json` return its
individual retained metadata files. Writes use the original workspace revision
and request header. No additional account, login, or completion gate is introduced.

Retention uses the same private filesystem lease and durable state. A workspace
supports up to 1,000 saved periods, 1,000 definitions per period, and 5,000 closes,
subject to the existing 32 MB workspace state and 256 MB archive limits.
