# CareRelay event workbench

A runnable operator workflow for the existing CareRelay reducer. It imports event
metadata, persists a review queue, resumes previous decisions and exports an
offline HTML report. It does not replace the independent Ring transport client.
Python 3.10+ and the standard library are sufficient.

## Run the synthetic example

From `amazon-ring-carerelay/` in this repository:

```sh
python -m carerelay.workbench import examples/workbench_events.jsonl --source offline-simulator --out care-01.json
python -m carerelay.workbench inspect care-01.json
python -m carerelay.workbench report care-01.json --out care-review-01.html
```

Open the HTML file in a browser. It is an offline, responsive, printable review
copy with no scripts, trackers, forms or outbound requests. It shows pending and
recorded decisions, their event context and the exact state hash. All example
records are synthetic; they are not captures from the official Ring simulator.

## Record an actual review decision

Read the pending queue or HTML report, then create `decisions.jsonl` with one JSON
object per decision. Substitute a real proposal ID from the queue and the
operator's chosen pseudonymous reviewer label. Do not import example approvals as
if a human had made them.

```json
{"proposal_id":"ID_FROM_PENDING_QUEUE","approver":"reviewer-1","decision":"rejected"}
```

```sh
python -m carerelay.workbench review care-01.json decisions.jsonl --out care-02.json
python -m carerelay.workbench report care-02.json --out care-review-02.html
```

Only `approved` and `rejected` are valid. Repeating an identical decision is
idempotent. A conflicting decision for the same proposal is rejected; this version
does not provide decision revisions. Reviewer labels are operator declarations,
not authenticated human identities, electronic signatures or actuation permission.

## Add events without losing decisions

```sh
python -m carerelay.workbench import more-events.jsonl --resume care-02.json --out care-03.json
```

Import preserves previous decisions. Identical event-ID/content retries do not
multiply proposals. A reused ID with different normalized content fails the whole
batch; the previous workspace and destination remain unchanged. Source labels are
inherited on resume and cannot silently change.

## Input and source contract

The JSONL schema is CareRelay's existing normalized `ring-simulator-event/v1`
contract, **not a claim to implement Ring's native webhook schema**. Each line is an
object containing `schema`, `event_id`, `device_id`, timezone-qualified
`occurred_at`, `event_type`, and optionally `classification`, `zone`, `device_health`.
The existing core defines allowed events/classifications and rejects unknown or
privacy-sensitive fields. Do not supply names, video, embeddings, credentials or
raw provider payloads. Keep even normalized household metadata in trusted local
storage; an HTML export still contains event/device IDs, timestamps and zones.

New imports default to `provider-candidate`: operator-supplied metadata whose
provider provenance is **unverified**. Select `--source offline-simulator` for
synthetic/offline data. Neither label proves provider execution. Keep synthetic
and provider-candidate data in separate workspaces. This workflow cannot verify
whether a caller falsely labels a source.

Limits: 16,384 bytes per JSONL line including its newline, 10,000 lines per batch,
10,000 saved events, 16 MiB per input/output workspace. Blank lines are permitted
but count against the batch limits. Invalid UTF-8, duplicate JSON fields, non-finite
numbers, excessive nesting and invalid Unicode are rejected. Errors identify the
line without echoing its contents.

## Persistence and evidence

Every workspace has schema `carerelay-workspace/v1`, an unmodified core state and
a matching existing `carerelay-receipt/v1` receipt. Loading reconstructs events,
re-derives proposals under the current policy and replays explicit decisions, then
compares the complete canonical workspace and receipt. Editing a proposal and
recomputing its hash is insufficient to pass replay. A receipt is a consistency
check, not a signature: changing an otherwise valid event or declared decision and
regenerating a matching receipt is not independently detectable without a trusted
external record. Policy changes may require an explicit migration in the future.

Output always goes to a **new path**. A completed, fsynced temporary file is
atomically hard-linked to the destination; an existing destination is never
replaced, even during a race. Temporary files have private permissions on POSIX
and are removed after success/failure. The destination directory must already
exist and support hard links. Unsupported filesystems fail explicitly. This is a
single-operator immutable-version workflow, not a database or multi-writer merge
service. No automatic deletion or retention policy is imposed on operator data.

Provider execution, external actions, Devpost submission, award and payment flags
remain false. CareRelay does not send a message, unlock a door, dispatch a responder
or supply medical advice. Care-related interpretation needs appropriate human
review; this is not an emergency monitoring system.

## Focused validation

```sh
python -m unittest discover -s tests -p 'test_workbench.py' -v
```

Six acceptance checks cover the actual end-to-end workflow, retry/collision
behavior, replay/decision integrity, bounded private-input failure, immutable file
publication and escaped HTML. They use only synthetic local inputs and the
repository's actual core and receipt modules. No live Ring API or broad suite is
required for this changed behavior.

## Competition integration still required

Official rules checked October 9, 2026:
<https://amazonappdev2026.devpost.com/rules>. Ring requires runtime use of an
accepted Ring API/SDK/simulator/device and an actual simulator/device demonstration.
The deadline is October 23, 2026 at 12:00 PDT. This workbench is a product feature,
not evidence of that provider demo or a submitted entry. Connect authorized,
privacy-minimized simulator metadata through the normalization contract; preserve
a non-secret provider receipt separately and record genuine tool feedback for the
existing entrant. Do not label the included synthetic fixture as official capture.
