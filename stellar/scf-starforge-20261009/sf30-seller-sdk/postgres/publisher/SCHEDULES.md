# Keep a PostgreSQL data product current

The existing PostgreSQL publisher can keep a reviewed dataset current on a saved
cadence. Each refresh uses its original approved query, read-only repeatable-read
transaction, typed candidate, review and dataset publication. The current version
remains available while extraction runs, and buyers keep their original snapshot
and cursor under the dataset seller's existing retention policy.

## Configure the existing publisher

Start or reopen the [normal publisher workspace](README.md), using the same Linux,
Node, `flock`, `pg` and `pg-cursor` setup:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs serve \
  --workspace /private/inventory-publications --port 8442
```

The running original dataset seller must use that workspace's saved target
directory. The publisher's printed loopback page now includes **Continuous
publication**. There is no separate service to install.

1. Use the normal plan, extract, inspect, review and publish flow to establish the
   data product. Select the published extraction that is current in the running
   target. A schedule cannot use an unreviewed first candidate as its baseline.
2. Choose **Use selected published extraction**. Enter the interval, minimum and
   maximum published rows, allowed percentage decrease, failure action,
   responsible operator and policy note. The panel shows the exact retained plan
   and the target version it will bind.
3. Choose **Save publication policy**. Saving records an immutable policy edition and leaves
   recurrence paused. Refreshing the page preserves unsaved form edits; **Reload
   saved policy** deliberately replaces them.
4. Choose **Enable using displayed target**. This binds the displayed current
   snapshot and dataset revision, then sets the first due time one interval ahead.
   An intervening target change refuses the request. **Run refresh now** performs
   an immediate refresh using the saved policy, including while recurrence is
   paused.

The saved plan fixes the query, parameters, source-file revision, scalar mapping,
ordering and extraction limits. To change those inputs, publish and inspect a new
plan through the normal workflow, then save a new policy from that current
published baseline. A policy edit never mutates earlier plans or occurrences.

## Cadence, publication and retained versions

Intervals are whole seconds from 30 through 2,592,000. The next due time is shown
as an absolute timestamp. This is elapsed-time recurrence, not a timezone or cron
expression. Only one native publisher operation can run at a time. A due refresh
waits behind original manual work; it does not create another pool or extractor.
Missed slots coalesce into one current refresh. Run-now anchors subsequent slots
to that requested run; it does not add a second overlapping timer.

Publication requires all of the following:

- The original plan digest and dataset contract still match the saved policy.
- The running target still has the schedule's expected snapshot and revision.
- Every row passed the original extraction, scalar and complete-result limits.
- The candidate is within the saved minimum/maximum rows and optional maximum
  percentage decrease from the last accepted target.

The maximum cannot exceed the original plan's extraction limit. Setting a minimum
of zero explicitly permits an empty result; a higher minimum preserves the
last-good dataset if the source unexpectedly returns no rows. A percentage
decrease compares row counts, not business value, column values or freshness.
For example, 25 permits 100 rows to become 75 but refuses 74. These checks never
truncate a candidate or silently filter its rows.

An identical native dataset snapshot is recorded as **UNCHANGED**, without a new
publication or dataset revision. A changed candidate gets an original review
that identifies `Schedule: <responsible operator>`, the saved policy ID and digest,
limits and policy note. The existing publisher then promotes those exact bytes
using its normal expected-version checks. This records the saved authorization;
it does not imply that a person manually reviewed every subsequent refresh.

The original version writer collects eligible expired generations during
refresh. Protected buyer versions, active readers and its configured version
capacity still apply. A publication can therefore be refused when capacity is
full of protected versions. Choose cadence, retention and version capacity
together using the existing seller controls. The schedule does not shorten
retention, evict protected buyer snapshots or add another collection engine.

## Pause, errors and restart

**Pause after current refresh** stops future recurrence. An already accepted
refresh continues and can publish its candidate. Use the original extraction's
**Cancel** control if you also want to cancel an extraction that is still running.
Stopping the server cancels its active extraction, drains accepted native work,
and retains the original workspace for reopening.

The saved failure choice is either **Pause for operator** or **Try at next
interval**. Both retain the original failed run and leave the last-good target
serving. The latter starts a new read-only extraction at a later slot; it does not
retry payments. A target snapshot, revision or contract changed by another
operator always pauses recurrence. Inspect that target and explicitly enable
against its displayed current version to adopt it. A different dataset contract
requires a compatible newly published plan and policy.

Each occurrence reserves its native extraction UUID before starting work. If the
process stops between those steps, reopening starts that same reserved run. If
an extraction already exists, recovery inspects that original run. A committed
candidate can be recovered and published without querying again. An incomplete
interrupted extraction remains an original failed/cancelled/interrupted result;
the configured failure action determines whether a later interval may start a
new run. It is never relabelled as a successful complete candidate.

A publication with an unknown outcome remains attached to that same extraction.
The original recovery command first checks whether the exact candidate is already
active. If so, the occurrence records that observed publication. Otherwise it
stays pending with recurrence paused. **Continue retained refresh** explicitly
uses the same candidate and original expected-target checks. It does not invent
a replacement extraction or change payment terms.

The history shows the occurrence's retained native extraction, policy, state and
error code. **Open extraction** opens the original candidate inspector, review
and publication details. Older/Newer navigation uses the existing page size and
does not delete history. Only `serve`, or an explicitly started embedded
controller, starts recurrence. Reading status or saving a policy with the CLI
never starts a background timer. Reopening `serve` resumes saved enabled work;
saved paused work stays paused.

## CLI operations

Stop the browser server before opening its workspace from another CLI: both use
the same original kernel lock. From the repository root, use the original
`postgres/publisher/cli.mjs` path shown above with these commands:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs schedule \
  --workspace /private/inventory-publications
```

Create a private JSON policy input. Replace the example IDs, digest, snapshot,
revision and row limits with the actual selected published run and target:

```json
{
  "referenceRun": "00000000-0000-4000-8000-000000000001",
  "planDigest": "the-exact-saved-plan-digest",
  "expectedSnapshot": "the-current-native-dataset-snapshot",
  "expectedRevision": 1,
  "intervalSeconds": 3600,
  "minimumRows": 100,
  "maximumRows": 250000,
  "maximumDropPercent": 25,
  "onError": "pause",
  "reviewer": "Dataset operator",
  "note": "Publish the retained inventory query hourly within these row limits."
}
```

Use `null` for `maximumDropPercent` to omit that decrease check. Every policy field
above is required. The example UUID is a placeholder, not a usable native run.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs schedule-save \
  --workspace /private/inventory-publications --input /private/policy.json --revision 0
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/cli.mjs schedule-enable \
  --workspace /private/inventory-publications --revision 1 \
  --expect CURRENT_SNAPSHOT --expect-revision 1
```

`--revision` is the schedule policy/control revision from `schedule`; it is
different from `--expect-revision`, the original dataset target revision. Read
fresh values before each mutation. Save, enable and pause advance the control
revision; completing a run can also advance it when an error pauses recurrence.

The remaining operations are `schedule-pause --revision N`, `schedule-run
--revision N [--request UUID]`, and `schedule-continue --revision N`, each with
`--workspace`. Run and continue wait for the retained result. A caller-supplied
request UUID makes a repeated run request refer to its original occurrence in
the same policy. Reusing an ID from another policy is refused. History supports
`--limit 25 --history-offset 0`. Leave `serve` running for subsequent due slots.

## Embedding and storage

`openPostgresSchedule({publisher})` accepts an already-open original
`openPostgresPublisher(...)`. Use `configure`, `enable`, `pause`, `runNow`,
`continueRun` and `status` with the same structured fields as the CLI. Run-now and
continue return `{id, completion}`. Call `start()` to enable timer processing and
await `close()` before closing the original publisher. The existing
`startPostgresPublisherServer(...)` does this lifecycle automatically and exposes its
controller as `service.schedule`.

The controller retains immutable policies and references to original runs in a
private `schedule.sqlite` inside the already-locked publisher directory. Query
results, candidates and reviews stay in their original files and tables. The
native `startExtraction(planId, {id})` accepts the reserved UUID; callers that
omit it retain the original generated-ID behavior. There are no new packages.

Back up the original private publisher workspace and target through their
existing stopped-workspace process. Keep source credentials and candidate data
private. Recurrence does not delete extraction history or create a separate
dataset backup policy.
