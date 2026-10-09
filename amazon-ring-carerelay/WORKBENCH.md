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

## Large replay-validated review exports (Muse 5,000-event corpus)

The original `report --out review.html` remains unchanged: it writes the whole
escaped, script-free review in one immutable HTML file. For a large original event
workspace, use the *optional* paged renderer instead. The renderer replays the
actual saved 10,000-event-max CareRelay source contract before any page output;
it does not change, infer or record reviews and never invokes Ring.

```sh
# Standalone static page 2 (a new, immutable destination every time).
python -m carerelay.workbench report care-03.json --page 2 --page-size 100 --out review-page-2.html

# Filter exact imported labels, not guessed person/clinical identities.
python -m carerelay.workbench report care-03.json --status pending --classification human --page 1 --out pending-human-1.html

# Aggregate summary only; source status/class/type counts, no event/device cards.
python -m carerelay.workbench report care-03.json --summary --out review-summary.html

# Complete offline navigation: --out is a NEW directory, not an HTML file.
# This creates page-0001.html, page-0002.html, ... and summary.html.
python -m carerelay.workbench report care-03.json --page-size 100 --all-pages --out review-export-01
```

Open `review-export-01/page-0001.html` directly: First / Previous / Next /
Last links point to **actual neighboring static HTML files** in that directory.
There is no local server and no fake `?page=2` request that an offline file
cannot satisfy. One-page export prints its current page number but intentionally
does not offer a nonfunctional browser pagination link. The complete bundle
loads/verifies the source workspace **once**, then renders each page against
that single immutable state. Existing destinations are never overwritten; a
new directory is created exclusively and the existing atomic file publisher
writes each page. In the event of disk failure, partial new bundle pages remain
under the new directory for owner inspection, not mistaken for a completed export.

Page size is an output control (1–1000 visible proposals and up to the same
number of quiet events per page), **not** a new bound on events processed or
simulation sample size. It always considers all previously ingested valid
source events; proposal and quiet-event pages advance together, with enough
pages to reach both entire sets. The status filter is
`all|pending|approved|rejected`; non-`all` status views show only proposals,
not quiet events. `--event-type` and `--classification` compare exact verified
source labels. The summary tabulates proposal counts by recorded status,
classification, and event type plus the overall quiet-event count. Paged report
CLI stdout reports **counts**, not thousands of private per-event identifiers;
the unmodified `inspect` command still prints its full queue when explicitly
requested. Every page carries the original workspace SHA-256, source declaration,
review authority caution and escaped nine-field proposal and seven-field quiet
context; no JS/forms/external requests/automatic approvals.

The design decision uses Muse's independently retained 5,000-event
**actual-source replay** in #sim-data
(`MUSE-MASSIVE-OPTIMIZATION-WAVE03-20261009-LANE-B-CARERELAY-REVIEW-SCALE`,
posted 2026-10-09 19:22 EDT), which observed 1,501 proposals and 3,499 other
events, ~2.03MB unpaged markup versus ~94KB for a 100-proposal+100-quiet page
(roughly 21.6-fold output reduction in that probe). Those timings and bytes
were measured on the **prior PR399 candidate**, not claimed as benchmarks of
this new current-main renderer. Live Ring permission, event authenticity and
Devpost registration are **unaffected**. This remains a useful original
contest implementation / operator UX improvement, not a replacement for the
official Ring simulator demonstration.

Only run the changed-feature targeted regression if needed:
`python -m unittest tests.test_review_pages -v` from the
`amazon-ring-carerelay/` checkout. No repository-wide test suite is required.

## Filtered summary follow-up

The optional --summary now reflects the same status, classification, and event-type filters as paged review cards. The summary.html written by --all-pages uses that selection as well. The header continues to show whole-workspace event, proposal and pending totals; separate selected counts below it may differ. A non-all status excludes quiet events because those observations have no review decision. An explicit --page 0 is invalid (page numbers start at 1), rather than being treated as page 1. The default unfiltered report behavior remains unchanged.
