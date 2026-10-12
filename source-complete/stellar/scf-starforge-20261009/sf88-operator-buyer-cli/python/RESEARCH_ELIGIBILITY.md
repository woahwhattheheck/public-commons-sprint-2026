# Research eligibility: Python, Merchant and customer receiving

This is the customer and automation entry point for the original Research
eligibility workflow. Protocols, source occurrences, named decisions,
resolutions, report links and applications remain in the same immutable dossier.
The browser, JavaScript client, Python client, Merchant tools and exported
customer files all address that dossier.

The complete method and each action's data are documented in
[ELIGIBILITY_REVIEW.md](../research-dossiers/ELIGIBILITY_REVIEW.md). Typed
JavaScript consumers use
[eligibility-consumer.d.mts](../research-dossiers/eligibility-consumer.d.mts).
The Python implementation uses the installed original Node engine, Python
standard library and the existing Research call journal.

## Open the installed workspace

Start or open the existing Research product through Applications or its
`research-workspace` command. Keep its directory, connection file and provider
source configurations in their original private locations. The Python client
borrows that listener:

~~~python
from stellar_forge_buyer.research_workspace import ResearchWorkspace

with ResearchWorkspace(
    checkout="/absolute/source-checkout",
    connection_file="/absolute/private/research-connection.json",
    directory="/absolute/private/python-client",
    node="node",
) as workspace:
    review = workspace.eligibility("d_ORIGINAL-DOSSIER-UUID")
    page = review.read(section="reviews")
    print(page["dossier"], page["items"])
~~~

The placeholder dossier ID above must be replaced with an ID returned by the
original workspace. The client directory contains the actual bound workspace
identity and complete request attempts. Reopen it to recover a pending call.

Closing this client detaches its requests; it leaves the Research listener
running. It creates no provider task, purchase, session authority or second
review database.

## Read source occurrences and retain the selected revision

`read` supports overview, reviews, occurrences, queue, decisions, resolutions,
studies, impact and operations. A review selects its original question.
A work-set ID further selects its saved protocol and report assignment.

Before a review exists, read occurrences and explicitly select rows belonging
to the intended question:

~~~python
rows = list(review.iter_rows(section="occurrences"))
chosen = [row for row in rows if row["questionId"] == question_id]
~~~

Each row contains its original occurrence ID, edition, question, provider,
source-byte SHA-256, source byte count and normalized content digest. Repeated
DOIs in different questions or editions remain distinct occurrences.

The first page supplies its dossier revision. `iter_rows` retains that
revision for every subsequent page. A manual page with a nonzero offset must
supply the same revision. The native page limit is 100.

~~~python
page = review.read(section="queue", review_id=review_id, limit=30)
while True:
    consume(page["items"])
    if page["nextOffset"] is None:
        break
    page = review.read(
        section="queue", review_id=review_id,
        revision=page["dossier"]["revision"],
        offset=page["nextOffset"], limit=30,
    )
~~~

The overview's units distinguish distinct report occurrences, explicit study
groups, assignments in overlapping work sets, corrected decisions and repeated
applications. Preserve these labels in exported summaries.

## Prepare, inspect and submit a complete action

A command contains one original request ID, observed revision, named actor,
action and complete data object. All actions after create-review include the
review ID. The client validates its outer request with the installed original
parser; the original engine validates action data against saved sources,
protocols and current decisions at commit.

The operator can save and inspect the complete request before sending:

~~~python
prepared = review.prepare(
    "create-workset",
    {
        "protocolId": protocol_id,
        "name": "Retained reports for this scope",
        "occurrenceIds": occurrence_ids,
        "reason": "Selected the original reports under the recorded question.",
    },
    review_id=review_id,
    actor={"id": operator_id, "name": operator_name},
    request_id=request_id,
    expected_revision=observed_revision,
)
review.save_prepared(prepared, "/absolute/private/workset-request.json")
result = review.submit_prepared(prepared)
work_set_id = result["operation"]["result"]["workSet"]["id"]
~~~

This preparation is available to the same operator who submits the action.
The selected protocol determines reviewer assignments and minimum decision
counts. There is no additional client approval step.

The convenience methods accept the exact native data object plus
`request_id`, `expected_revision`, `actor`, and (except create-review)
`review_id`:

| Python method | Original action | Data retained |
| --- | --- | --- |
| create_review | create-review | Question ID, name, description and complete protocol |
| revise_protocol | revise-protocol | Complete next protocol and reason |
| create_workset | create-workset | Protocol ID, name, exact occurrence IDs and reason |
| decide | decide | Work set, report, stage, disposition, criteria, basis, reason and optional prior decision ID |
| resolve | resolve | Every current decision ID, method, disposition and reason |
| study_link | study-link | Explicit report membership and retained source evidence for each report |
| apply_outcomes | apply-outcomes | Explicit report/resolution pairs and optional classification/note changes |
| review_impact | review-impact | Original impact ID, disposition, reason and optional receiving work set |

The current operation ID, review ID and saved child IDs come from
`result["operation"]`. Use those actual results. The consumer verifies the
complete saved request, request hash, operation hash, original and resulting
revisions, actor and dossier before accepting a successful response.

### Decisions and corrections

A decision's actor must match a named reviewer assigned to that stage. An
include/exclude decision supplies all of the stage's criterion answers. An
available basis identifies retained occurrences and a source locator. A
full-text stage requires an available retained basis for a decisive outcome.

A correction supplies the exact prior decision ID in `supersedes`. The
previous decision remains in history, and any resolution using it becomes
stale. Read the resulting queue to obtain the complete current decision ID
set before resolving again.

`unavailable` and `uncertain` preserve the actual information gap. They do
not become exclusion by implication. An adjudication and a consensus are
separately recorded methods.

### Study identities and selected outcomes

Study membership uses the operator's explicit retained-source evidence.
Repeated report metadata alone does not establish that two different reports
describe the same study. Record the actual locators and relationship used.

An applied outcome selects an explicit occurrence/resolution pair. Including
a report requires the final stage to have a current inclusion. The original
supports/contradicts/background classification and existing note remain
unchanged unless supplied in that action.

Later source editions, changed question wording, protocol editions, corrected
resolutions and manual selection changes remain available in the impact view.
Create the required work set and decisions, then record the actual impact
disposition.

## Recover an interrupted request

The Python workspace saves the entire original action before invoking Node.
If the response is lost, use the same client directory:

~~~python
record = review.saved_request(request_id)
result = review.recover(request_id)
~~~

The original engine reconciles the unchanged request before applying its
current-revision check. It returns the saved operation with
`duplicate: true` after a committed-response loss. The dossier metadata in
that reply may be newer than the operation; the saved operation remains bound
to its original revision.

A changed payload cannot reuse the request ID. An ordinary conflict with an
unrelated new dossier revision needs a fresh read, deliberate changes and a
new request ID. Recovery never silently updates an actor, revision, protocol,
report selection or decision set.

Prepared envelopes are bound to the sender workspace. After an independent
customer receiving, select the receiver's actual identity and current
revision for new work. A deliberately repeated historical request can be
submitted as its original request object to demonstrate native replay; an old
sender's prepared workspace envelope is not retargeted.

## Export selected reports

The JSON export contains the complete selected review projection and
operations. CSV exports a selected queue, decision, resolution, study, impact,
operation or occurrence table. Nested source fields remain JSON cells.

~~~python
with review.export(
    "/absolute/private/eligibility.json",
    review_id=review_id, revision=selected_revision,
).open() as source:
    consume_bytes(source.read())

review.export(
    "/absolute/private/decisions.csv",
    format="csv", section="decisions",
    review_id=review_id, revision=selected_revision,
)
~~~

Choose one revision for a multi-file report. Omitting revision on an individual
export first reads and pins the actual selected overview. The original file
receiver supplies SHA-256 and byte count; the Python FileDelivery verifies the
completed file.

## Build a complete customer delivery

A delivery selection freezes the original metadata, complete revision list,
overview and every selected review section. It exports twelve complete files:

- Original dossier JSON and gzip, containing every saved revision and source blob.
- The normal HTML and Markdown dossier reports.
- The complete eligibility JSON report.
- Seven CSV tables: queue, decisions, resolutions, studies, impact, operations
  and occurrences.

~~~python
delivery = review.delivery(
    "/absolute/private/customer-delivery",
    review_id=review_id,
    revision=selected_revision,
)
manifest = delivery.export(review)
manifest = delivery.verify()
~~~

An existing delivery directory keeps its first selection. A new selection uses
another directory. A lost download reply is recoverable: the Node helper
retains a selection beside the destination before exporting, inspects the
already-published complete file, and returns its original bytes instead of
overwriting it. Portable file recovery uses the original cold reader;
deterministic reports are compared against the same pinned source revision.

All files keep their actual content hashes and counts. Connection tokens,
client configuration files and host directories are outside the delivery.

## Independently receive and continue

Use both original JSON and streamed/gzip receiving paths:

~~~python
received = delivery.receive(
    "/absolute/private/customer-receivers",
    checkout="/absolute/source-checkout",
    node="node",
)
print(received["stream-reader"]["directory"])
~~~

Each path reopens the complete original portable dossier, validates every
immutable operation and source binding, and compares the selected metadata,
history, overview, full section rows and regenerated report hashes.
The result returns the actual new workspace directory and its current
revision.

Open that directory with the original Research workspace command. Its
connection file belongs to the receiver. Attach a new Python client directory,
read the saved review and queue, then continue using the actual current
revision. The original revisions and source bytes remain in the same dossier.

Receiving the same source again verifies the shared immutable history prefix.
The original reader preserves later local receiver revisions. A divergent
history is reported by the native reader.

### Transfer the whole delivery

~~~python
package = delivery.archive("/absolute/private/Eligibility_Delivery.zip")

from stellar_forge_buyer.research_eligibility_delivery import EligibilityDelivery
received_delivery = EligibilityDelivery.from_archive(
    "/absolute/private/Eligibility_Delivery.zip",
    "/absolute/private/received-delivery",
    expected_sha256=package["sha256"],
)
received_delivery.receive(
    "/absolute/private/customer-workspaces",
    checkout="/absolute/source-checkout",
)
~~~

The ZIP contains the selection, delivery manifest, exact twelve files and an
existing receiving record when available. The archive manifest supplies the
hash and count of every member. The receiver checks the entire input hash,
member names, duplicate entries, regular-file types, total size and every
member's exact bytes. Existing different customer files are preserved.

The source selection/report manifest is limited to 32 MiB, each original
portable or report file to 256 MiB and the complete handover to 512 MiB.
The original engines' own request, dossier and source limits still apply.

## Command line

Use the existing `stellar-forge-research` Python entry point, or
`python3 -m stellar_forge_buyer.research_cli` from the installed source.

~~~sh
stellar-forge-research --checkout /absolute/source-checkout \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private/python-client \
  eligibility-read d_ORIGINAL-DOSSIER-UUID --section queue \
  --review-id er_ORIGINAL --all
~~~

The command group includes:

| Command | Purpose |
| --- | --- |
| eligibility-read | One pinned page or the whole selected section |
| eligibility-prepare | Save a full actor/action/data request JSON |
| eligibility-submit | Submit a saved envelope or complete native request |
| eligibility-saved | Read the original saved call and attempts |
| eligibility-recover | Replay the same original saved operation |
| eligibility-export | Download one exact review JSON or CSV |
| eligibility-delivery-build | Complete twelve-file export; optional receiving and ZIP |
| eligibility-delivery-verify | Verify every retained delivery member |
| eligibility-delivery-receive | Run both original portable receiving paths |
| eligibility-delivery-archive | Package complete selected delivery bytes |
| eligibility-delivery-open | Reopen an exact-hash customer ZIP |

For prepare, `--data` is one complete action-data JSON file. Use
`--actor-id`, `--actor-name`, `--request-id`, `--revision`, and an
existing `--review-id` when the action requires it. Work-set references stay
inside the exact action data.

## Merchant tools

The existing configured Research attachment exposes:

- `merchant_research_eligibility`: revision-pinned full section reads.
- `merchant_research_eligibility_review`: the complete original action
  request, with native replay.
- `merchant_research_export` with `eligibility-json` or
  `eligibility-csv`: selected complete report bytes in the original retained
  export ledger.

For report exports, supply the actual dossier revision, optional review/work
set and CSV section. The normal `merchant_research_exports` and
`merchant_research_file_read` return the same retained file after restart.
The original portable-json/portable-gzip exports and
`merchant_research_reopen` carry the complete editable dossier.

The Merchant consumer checks the original operation's request, source
selection and hashes before reporting completion. An incomplete response
retains outcome uncertainty and the same request ID for recovery.

## Source and operating method

The software adds no fixed reviewer count. The selected protocol records the
intended method and named local-workspace operators. For methods using Cochrane
final full-text decisions, retain the required independent decisions and
predefined disagreement procedure in that protocol. A saved actor label is
the local operator attribution used by the original Research engine.

Method source: [Cochrane Handbook chapter 4, sections 4.6.1–4.6.4](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04),
retrieved 12 October 2026. The original engine guide contains the source-linked
method and action semantics.

A provider edition's actual source observations remain authoritative. A
changed search scope is labelled as a changed scope; an absent HTTP response
status is retained as absent. The programme's source manifest identifies the
actual complete input bytes used by the connected receiving operation.

## Selected report download contract

Every eligibility JSON/CSV download names the original `reviewId` and retained dossier revision. Python requires `review_id`, the CLI requires `--review-id`, and Merchant exports require `reviewId`; `workSetId` can narrow that review. Complete dossier JSON/gzip exports retain every original review and revision. Ordinary eligibility page reads use the existing workspace client's request policy; page selectors contain only revision, review, work set, section, offset and limit. Download cancellation uses the original client's download option.
