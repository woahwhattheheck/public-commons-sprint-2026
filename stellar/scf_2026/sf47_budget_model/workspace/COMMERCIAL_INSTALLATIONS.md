# Accepted customer quotations → Customer Installation

This workflow receives the original accepted SF74 Merchant Support quotation into
a saved SF47 Customer Installation. It carries the agreed task definitions,
recorded customer response, commercial terms and complete source files into the
same operating case as delivery assignments, deployments, purchases and receiving.

Later accepted quotation editions become reviewed change orders in the same
Installation. Every saved Installation edition and the original case history
remain available to the receiving operator.

## Start with the original customer work

In Merchant Support, open the original saved case and its Commercial desk. Use
the published quotation edition and record the actual customer response against
that edition. The response's ID, original quotation SHA-256, observation time,
source reference and recorded actor are retained by the native commercial writer.

Download **HANDOFF** from the original Commercial operation. If the case contains
Support, that download is its complete portable Support handoff; otherwise it is
the complete merchant workspace. A standalone quotation JSON or Markdown file
does not carry the original implementation, response and material history.

This receiving path uses the current recorded response in the selected source:
the original engine orders responses by observation time, recording time and ID.
A later declined response or revision request is visible in the inventory and
does not appear as a current acceptance. Previously saved Installation editions
continue to open against their own frozen original source.

The Installation source reader uses the installed original
commercialContext and inspectAcceptedCommercialImplementation functions. The
latter is a read-only projection of the existing prepared commercial review: its
accepted plan and task bindings come from the same original implementation engine
that Merchant Support uses. Inspecting or preparing an Installation does not
invoke the original SF74 case writer.

## Operate in the browser

1. Open the maintained SF47 workspace and the intended Delivery operations case.
   In **Sources**, attach the complete original merchant workspace or Support
   handoff. Keep the displayed source ID and file SHA-256.
2. Open **Customer installations → Receive accepted quotation**.
3. Select that original file and choose **Read accepted quotations**. The panel
   lists published editions, current recorded customer responses and their
   native commercial amounts. If the portable case references external original
   files, the panel lists their names, byte lengths and SHA-256 values. Attach
   those exact files in Sources; embedded original materials are already inside
   the complete selected source.
4. Select the accepted quotation and its original recorded response. Choose a
   saved Installation for a change order, or prepare a new Installation.
5. Choose **Review accepted scope**. Read the complete task changes, agreed terms,
   current Installation fields and any fields edited on both sides. For each
   conflict, keep either the current operator value or the accepted source value,
   then choose **Review selected choices**.
6. Choose **Continue in Installation**. The complete candidate enters the existing
   Installation editor. Review its accountable deployments, payment authority,
   funded work assignments, source behavior, receiving application and delivery
   coordination. Save through **Review complete installation → Save reviewed
   edition**.
7. Open the saved edition and export its complete handover. The ZIP contains
   the selected readable Installation, all previous saved editions, the original
   case records and the selected original source files.

The receiving panel retains its source/quotation/response/Installation selection.
The original Installation editor retains the complete entered draft and its
original save request. Typing or opening another Installation while a source
review is in flight cannot replace that later work. A case-version change
invalidates the stale source review. Use **Read current Installation** to reload
the same saved target, then read and review its selected original source.

The quotation workorder and its bound task names/criteria are displayed as
original source fields. Record actual receiving through the normal check state,
operator, observation time, result and source-record links. Receive an accepted
later source to change the agreed task definition.

## Review delivery effort on an accepted quotation

Open the saved accepted-quotation Installation and choose **Use this edition as
a draft**. Its **Delivery task effort** section reads the original Operations
Work records against the exact accepted task definitions.

1. Select **Review work through** and choose **Read current work and accepted
   tasks**. Inspect the retained Merchant case, quotation family, sealed quote,
   recorded acceptance, accepted scope and complete source-file identities.
   Every task shows its native definition, dependencies and original
   Installation acceptance check.
2. Under **Original work allocations**, select the original Work record and
   accepted delivery task, enter the hours belonging to that task and explain
   the allocation. A Work record can be split across tasks. The original engine
   checks all current Installations for quantities assigned more than once.
3. Review the current recorded and internally accepted Work separately. When a
   Work record has a correction, inspect the changed source and explicitly
   choose **Use corrected work record** for the affected allocation. The older
   source stays in the previous saved Installation edition.
4. Enter a remaining-hours estimate for each task being reviewed, a reason,
   supporting original files, the reviewer and an observation time with its
   timezone. **Apply reviewed remaining hours** binds the estimate to the exact
   current Work and task definition. An explicit zero records an estimate that
   no effort remains. A blank input preserves the existing review.
5. Choose **Review complete installation**, inspect the task totals and findings,
   then **Save reviewed edition**. Open the resulting saved edition and export
   its complete handover through the existing controls.

The accepted quote specifies fees and native task definitions. It does not
establish task effort. Quoted hours, quote-balance hours and effort-overrun hours
therefore remain unknown. The task report presents recorded hours, internally
accepted hours, reviewed remaining hours and projected total hours. Projected
total is the original recorded quantity plus a current reviewed remainder.
An outdated or missing remaining-work review leaves the projection unknown.

The overall review also shows unassigned selected Work, overallocated Work and
the number of current tasks with current reviews. Work spanning the review date,
later Work, voided records and changed source records remain visible under the
original reporting rules. Task receiving acceptance and internal acceptance of
a Work record keep their distinct original meanings.

### Accepted scope changes and retained effort

Receive a later accepted quote through the same change-order workflow. The
Installation retains the complete earlier task definitions, check observations,
source identities and saved effort editions. If a removed task still has an
allocation or remaining-work review, the report shows that earlier task with
its original accepted source. Reassign or remove its current allocations after
reviewing the new scope; its historical edition remains available.

A changed task definition or Work record changes the basis of a remaining-hours
review. Read the current inventory, inspect the correction, and apply an explicit
new review. Draft controls and the original save request retain the existing
editor's interruption and lost-response recovery behavior.

The **Original support allowances** controls continue to belong to the
Workshare workflow whose original terms specify included hours and calendar
anchors. Accepted-quotation task effort uses the original implementation scope.
Recurring care fees stay with their service workflow.

### Complete source and independent receiving

Effort is part of the original saved Installation document and frozen source
snapshot. Its readable report, historical editions, original Work, accepted quote
and complete attachments travel in the existing Installation ZIP and whole-case
receiving flow. Reopen the exact selected edition after receiving to inspect the
same task definitions, allocations, reviewer basis and quantities.

The original `installation-effort-seed`, `installation-preview` and
`installation-save` API and CLI operations now accept both original Workshare
Installations and accepted-quotation Installations. A commercial effort source
is explicitly identified by `sourceKind: "COMMERCIAL"`; its stable
`phaseId` field retains the native task ID used by the existing allocation and
remaining-review schema. The operator interface presents these entries as
delivery tasks.

The adapter is `operations_commercial_effort.py`. It reads the original
accepted source through the maintained commercial Installation binding and
supplies its native tasks to the original decimal effort engine. Both managed
source selections must carry this module with the original Installation engine,
browser and source-reader dependencies.

## What a change order preserves

| Original subject | Receiving behavior |
| --- | --- |
| Same original task definition | Retains the check identity, receiving observation and linked original records. |
| Changed accepted title, criterion, dependencies or retirement state | Creates the current check as open for new receiving; its earlier observation remains in the preceding saved edition. |
| Price-only quotation revision | Retains unchanged task receiving; the accepted new quotation and its exact native totals remain in the new workorder/source. |
| Added accepted task | Adds an open check with its stable original task identity. |
| Task removed from accepted scope | Removes that bound check from the new edition and preserves its complete earlier editions. |
| Independent Installation check | Preserved. |
| Current operator field changed from the earlier accepted source | Preserved when the accepted source is unchanged; otherwise requires an explicit current/accepted choice. |
| Another quotation family or case | Requires a separate Installation. |
| Existing company Workshare Installation | Continues through its original Workshare receiver; a distinct SF74 quotation uses a separate Installation. |

Task identities come from the original SF74 prepared bindings, including the
native grouping of quoted lines and its quotation-family identities. Installation
check IDs are derived from that original quotation family and task ID. Monetary
values are the producer's exact decimal strings; this bridge does not recalculate
quoted fees.

The native Installation supports at most 100 checks including independent checks
and a 128 KiB input. The selected source may be up to 8 MiB and its complete native
read up to 16 MiB. The receiver reports a bound explicitly rather than dropping
tasks or source history. If original wording exceeds an individual Installation
field's limit, that field points to the exact complete retained quotation; the
original full definition remains in the selected source and in the source review.

## Native CLI

Use the maintained complete repository source and its existing Python/Node
installation. The original launcher supplies SF47_SUPPORT_NODE. Direct Python
use can set that variable to the existing absolute Node executable.

All commands below use the existing workspace and operations case. Replace the
uppercase selection values with the original values returned by that workspace.
Use new output filenames or the CLI's exact-output reopen behavior.

Read the original source:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /ABS/PRIVATE_WORKSPACE installation-commercial \
  --case OPERATION_ID --expected-version VERSION \
  --source SOURCE_ID --expected-source-sha256 SOURCE_SHA256 \
  --output /ABS/commercial-source.json
~~~

Prepare a whole new Installation:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /ABS/PRIVATE_WORKSPACE installation-commercial-seed \
  --case OPERATION_ID --expected-version VERSION \
  --source SOURCE_ID --expected-source-sha256 SOURCE_SHA256 \
  --quote ORIGINAL_QUOTE_UUID --quote-sha256 QUOTE_SHA256 \
  --acceptance ORIGINAL_RESPONSE_UUID --acceptance-sha256 RESPONSE_MATERIAL_SHA256 \
  --expected-revision 0 --output /ABS/accepted-scope-review.json
~~~

For a change order, include --installation INSTALLATION_ID and its current
--expected-revision. Include --document /ABS/current-installation-input.json to
retain the current complete editable draft. If the review returns conflicts,
pass --resolutions /ABS/field-choices.json using the exact displayed field keys:

~~~json
{
  "task.request": "current",
  "task.completeOutput": "accepted"
}
~~~

The result contains the full document, source/selection, field and task changes,
canApply and reviewSha256. A source review prepares input. To persist, write its
complete document to the existing Installation input JSON, finish the operator
fields, and use the original native preview/save:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /ABS/PRIVATE_WORKSPACE installation-preview \
  --case OPERATION_ID --expected-version VERSION --expected-revision 0 \
  --document /ABS/installation-input.json --output /ABS/installation-preview.json

python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /ABS/PRIVATE_WORKSPACE installation-save \
  --case OPERATION_ID --expected-version VERSION --expected-revision 0 \
  --document /ABS/installation-input.json \
  --expected-preview-sha256 ORIGINAL_PREVIEW_SHA256 \
  --actor "Recording operator" --request-id ORIGINAL_SAVE_UUID \
  --note "Receive the accepted original customer quotation"
~~~

Existing Installations also require --installation INSTALLATION_ID on preview
and save. The save uses the complete original operation UUID/body and current
case/Installation revision. If its response is lost, recover the same original
request; do not change its UUID, note, selected preview or body.

Export and independently receive through the existing operations commands:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /ABS/PRIVATE_WORKSPACE installation-export \
  --case OPERATION_ID --installation INSTALLATION_ID --revision EDITION \
  --output /ABS/customer-installation.zip
~~~

Use **Delivery operations → Import complete case**, or the existing operations
import command, in a separate receiving workspace. The native receiver validates
every saved commercial binding against its original complete attachment and
checks the saved sequence of Installation editions. It reopens the selected
edition from installation-selection.json. Its own workspace supplies fresh
private access authority.

## API and client

The existing authenticated SF47 API exposes two read-only preparation routes:

- POST /api/operations/:caseId/installation-commercial
  with expectedVersion, sourceId, expectedSourceSha256.
- POST /api/operations/:caseId/installation-commercial-seed
  with those fields plus quoteId, quoteSha256, acceptanceId, acceptanceSha256,
  installationId, expectedRevision and optional document/resolutions.

The maintained agent client exposes installationCommercial and
installationCommercialSeed with corresponding TypeScript interfaces. It keeps
these read operations separate from the original installationPreview and
installationSave methods. All persisted changes continue through
Operations.command with action installation.save.

The new Installation commercial field binds the original source SHA-256,
quotation family, quote/response IDs and hashes, accepted scope hash, task/check
identities, accepted-definition hashes and complete external source-file
bindings. The original attachment bytes travel in the existing case source
store and export. No parallel case, quotation, approval or payment journal is
created.

## Source and receiving integration

The product consists of the commercial Installation core, native SF74 source
reader, browser panel, native CLI/client routes, and additive hooks in the
original Installation save/export/import lifecycle. Both managed launch source
selections include the same local product files and the complete native SF74
reader dependency closure, including SF97, service and accounting modules and
original network/package metadata. The Grant Operations distribution selection
carries those same dependencies into the installed and independently received
source. The original and frozen execution copies are checked against the same
file hashes before the application opens.

The private launch record and authenticated startup response retain both complete
source maps. Their original launcher, Applications adapter and reconnecting agent
client share a 256 KiB envelope so the full reviewed source fits without dropping
its identity fields.

The original case-commercial-implementation.mjs change adds one read-only
accepted-definition export. Existing preview/adopt operations keep their native
save semantics. The source projection resolves field conflicts as accepted solely
to expose the accepted definition; the receiving Installation separately reviews
its own operator fields and never submits that source projection to the SF74
writer.

For operational continuation, keep the original Merchant Support accepted case
and the intended Grant Operations case. Complete one selected quotation→source
intake→reviewed Installation save→accepted later edition→independent receiving
journey using those original IDs. Keep any existing customer's native operation
and accepting worker; this feature can join that operation without opening a
second merchant producer.
