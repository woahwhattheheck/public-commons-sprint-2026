# Grant portfolio reconciliation

This application joins complete IATI and 360Giving source editions into a saved review
workspace. Operators can inspect original records, review organization and grant–activity
relationships, retain coverage-only and unmatched records, reconcile following editions,
and hand over the full source and review history.

The console, Python CLI, typed client, Applications launch and merchant tools all use the
same saved operations and portfolio revisions.

## Start the original application

Use the installed Starforge distribution containing the source-owned
[grant-portfolio contribution](../../distribution/contributions/grant-portfolio.json).
For source use, retain the complete SDK files selected by
[source-files.json](source-files.json), together with the normal installed Starforge
Applications and merchant support.

The native runtime uses Linux, Python 3.11 or later, Node 22 or later, and the existing
360Giving publisher dependencies in
[requirements.txt](../ndjson/360giving/requirements.txt). The Comic Relief spreadsheet
converter has its own selected environment; its older conversion dependencies are separate
from the application runtime.

Create a new private workspace:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-review init
~~~

Open its console:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-review \
  serve --port 0 --connection-file /absolute/private/grant-review/console.json
~~~

The command prints the complete local console link. Open that link in the browser. Keep
the terminal or the original Applications process running while using the workspace.
Closing the process releases the original writer and retains the sources, decisions,
revisions and operations.

Direct source commands use the same model:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/grant-portfolio/cli.py \
  --workspace /absolute/private/grant-review init
~~~

Use the same Python interpreter for the saved Applications launch. The managed launch
checks the original workspace, source and interpreter before and after acquiring the
writer. [CLIENTS.md](CLIENTS.md) covers the installed command, Applications, typed client,
merchant setup and complete receiving transport.

## 1. Receive complete source editions

Open **Source editions**. For each edition, select its complete native handoff ZIP and
record:

| Field | Meaning |
| --- | --- |
| Standard | The original IATI or 360Giving receiving engine. |
| Publisher and edition label | A recognizable name for the exact release being reviewed. |
| Publisher URL | The authoritative source location recorded at acquisition. |
| Captured at | The original observation time, including timezone. |
| Published license | The license accompanying the publisher release. |
| Coverage | The programmes, time periods, geography and exclusions described by the source. |
| Native build | Original 360Giving records, or an explicitly selected reviewed candidate. |

The application receives IATI through the original complete portfolio receiver. It
receives 360Giving through the original publisher operator and its native dataset receiver.
It preserves the full uploaded packet, original source inputs, publisher metadata, native
selection, complete records and exact financial values.

IATI input is the complete native portfolio packet exported by
[iati_workspace.py](../iati/iati_workspace.py). It includes the selected original XML,
every native build, portfolio history and original reports. An optional API selection
can choose a carried original portfolio revision.

360Giving input is the complete handoff exported by
[publisher_workspace.py](../ndjson/360giving/operator/publisher_workspace.py). It retains
the complete original source JSON, matching registry record, capture/transport input,
publisher review and original native build. A selected reviewed candidate retains its
original decisions and candidate source alongside the original edition.

The received source identifier binds the exact packet, standard, selection, coverage and
label. The **Original source packet** button returns the unchanged uploaded file.
**Source details** opens its actual native selection and complete receiving information.

### Comic Relief operating inputs

The [complete Comic Relief recipe](examples/comic-relief/SOURCE_INPUTS.md) uses the
publisher's original IATI XML and both original international 360Giving spreadsheets.
It preserves the native Google Sheet export and stored XLSX, original registry and
capture, the pinned official conversion result and maps, and the complete native handoffs.

Run its source preparation and native input operations first. The resulting three
complete packet descriptors supply the source paths, hashes and native selections for
this application. Preserve the recorded coverage statement: the IATI programme subset
and the wider grant publications have different coverage.

## 2. Create the portfolio

Open **Portfolios**, choose **New portfolio**, enter a name, scope, reviewer and review
state, and select the source editions. Save the portfolio.

The source selection is explicit. It can contain 1–64 distinct complete editions.
The first saved revision retains every selected record and financial row. The summary
shows records, source editions, confirmed relationships and stale reviews.

The saved portfolio has an immutable revision number and snapshot. The revision selector
opens any earlier saved revision. Open the latest revision when saving another edit.

## 3. Review original records and relationships

Open **Review records**.

**All records** pages activities, grants and organizations. **Open** displays the complete
original record and all its financial rows. **Select left** and **Select right** prepare
a side-by-side review. The displayed source label and coverage accompany each record.

**Suggested relations** identifies records with the same published organization identifier,
shared published reference, or exactly normalized title. Multiple possible counterparts
are marked ambiguous. A suggestion enters the queue; an operator's saved decision creates
a confirmed relationship.

Supported decisions are:

| Decision | Use |
| --- | --- |
| Same organization | Connect two source organization records after reviewing their original identities. |
| Grant and activity | Connect a 360Giving grant and an IATI activity after reviewing the publisher references and scope. |
| Duplicate | Identify a duplicate record while retaining both originals. |
| Unmatched | Record that a reviewed record has no selected counterpart. |
| Covered by this source only | Explain a record's legitimate place in one publication's coverage. |
| Ambiguous | Retain a relationship that cannot yet be resolved to one counterpart. |
| Rejected relation | Record why a suggested or selected relationship should not be used. |

Each decision retains its reviewer, time and rationale. The record reference includes the
source edition, stable entity key and semantic SHA of the complete original entity.
IATI activities retain the complete original activity object, including financial elements.
360Giving grants retain the exact full original grant JSON and native fields. Organization
reviews retain every original organization representation and its published relationships.

**Saved decisions** reopens an existing decision for correction or following-edition review.
Saving the original decision ID updates that decision in a new portfolio revision. Its
earlier version remains in the earlier revision.

The UI displays original values as text. Grant values and review text are never interpreted
as HTML or executable instructions.

## 4. Read financial meaning

Open **Financial ledger**. The first table pages independent exact totals. The second
pages every original financial record.

Each financial group keeps its source edition, standard, meaning, currency and original
dimensions. IATI groups preserve transaction type, reporting organization, hierarchy,
value date and the native budget type/status/period where applicable. 360Giving awarded
amounts and requested amounts use separate meanings and retain the award date.

The group displays included, excluded and missing record counts. A missing amount remains
missing. Original ineligible financial records stay in the ledger. Amounts travel as
decimal strings through the Python model, browser, typed client and merchant tools.

Reviewing an organization or grant relationship keeps both source records available.
It does not convert currencies, multiply a grant by its recipient count, or collapse
the IATI and 360Giving amounts into a combined total. The
[domain guide](DOMAIN.md) explains the source and financial semantics.

## 5. Reconcile a following edition

Receive the new complete native source packet first. Open the current portfolio, select
the following source edition and deselect the earlier edition. Under **Following editions**,
pair each removed edition with its explicit replacement, then save.

The new revision compares complete record identities:

- Unchanged originals carry their existing review.
- Changed or removed originals return their earlier decisions as stale.
- New and removed records appear in the revision changes.
- Unpaired source changes retain their explicit additions and removals.

Open stale decisions, inspect the current originals, and save the reviewed decision using
its existing ID. If a record was removed, choose the correct remaining or replacement
record directly from **All records**. Every earlier decision and source remains available
through the saved revision history and complete export.

The same-standard replacement mapping is deliberate. A source's label, dates or similar
titles do not silently pair releases.

## 6. Export, receive and reopen

Choose **Export complete portfolio** for the selected revision. The output includes every
portfolio revision through that selection, all referenced original source packets,
complete paged-table contents, original review operations and the source runtime.

Use **Receive a complete portfolio** on the receiving workspace's **Source editions**
page. The receiver verifies the whole archive, reconstructs each source through its
original native engine, rebuilds every revision and table, and saves the complete history
in one domain transaction.

Close and reopen the receiving workspace with its original command. Review its records,
financial groups and saved history. A subsequent export retains the incoming original
operation history as well as later local revisions. [RECEIVING.md](RECEIVING.md) describes
the exact complete-file contract and CLI flow.

## Original saved operations

The browser saves an operation ID before sending an action. The server retains the
complete action input before executing it. **Saved operations** opens that input, current
state, error or complete result.

The same operation ID with identical input coalesces into the original action. Reusing
that ID for a different action is a conflict. **Resume original** continues a retained
operation after interruption. Workspace and portfolio revision comparisons prevent a
stale edit from silently replacing a newer saved revision.

The console accepts complete source files up to 4 GiB; the original 360Giving receiver
keeps its own 1 GiB packet limit. JSON actions are limited to 1 MiB, and record tables
page up to 250 rows. Complete original native query pages use the engine's original
response envelope and cursor. The application has one workspace writer and a serialized
action worker; reads observe completed SQLite transactions while native preparations run.
