# Event Analysis customer Installation and complete receiving

Use this programme to carry a complete acquired event result into the existing
Customer installations record. The original event source, buyer, Analysis
workspace and commercial Workshare remain the continuing records. The installed
preparation command receives all sixteen original customer files together with
the actual Installation seed, selected profile and operator bindings.

## Original scope and accountable people

Start with a useful recurring report, reconciled table or application update for
one authorized Stellar contract/event family. Agree its complete source window,
field meanings, destination and acceptance owner. An actual later source change
or reporting need determines the next useful task.

The original Mercury/Xycloo case proposed a USD 2,400 implementation, five
business days after the source, access and destination are agreed, with 50%
at the agreed start and 50% at accepted handover. Its original sender owns that
relationship and current terms. The customer's retained Workshare supplies the
actual scope, phase owners, effort, fees and acceptance criteria used here.

The SCF programme remains USD 38,000 / 400 prospective hours / 150 days across
six packages and two selected installations. Customer-specific engineering is
assigned once to its funded package or its original commercial workorder.
Source subscriptions, hosted usage and routine operations keep their actual
cost owner.

| Role | Continuing operating responsibility |
| --- | --- |
| Merchant/source operator | Authorized event family, signed ingestion, output fields, published resource terms and source recovery |
| Independent buyer | Original authorization, aggregate task budget, complete subscriber acquisition and actual financial continuation |
| Customer analyst | Payload field meanings, explicit complete review, useful report/workbook changes and later-window selection |
| Receiving engineer | Original installed source, complete file receiving, independent native restore and continued customer work |
| Installation/acceptance owner | Existing case, commercial phases, source/deployment selections, actual acceptance observations and complete case handover |

Multiple windows or agent processes retain the same accountable people. The
original buyer journal and independently observed transfer records determine
purchases; event counts, downloads, source replay and workbook edits retain
their own meaning.

## 1. Complete the original event customer course

Use the [Event programmes browser](../../../scf-starforge-20261009/sf88-operator-buyer-cli/python/EVENT_PROGRAMMES.md)
or [installed Analysis agent](../../../../stellar-forge/mcp-paid-agent/ANALYSIS_EVENTS.md).
The [commissioning guide](../../../../products/webhook-feed/COMMISSIONING.md)
contains the source, merchant and buyer roles.

Receive the exact original NDJSON and manifest. Retain their source/store/feed,
ordered page history, distinct event identities, actual native/HTTP outcomes
and original financial references. Select the customer's payload pointers and
meanings; preserve exact decimal/identifier text, missing values and JSON null
where applicable. Read the entire native review before selecting its digest
for apply.

Open the complete typed table, report and workbook. Make the customer's useful
edit through the ordinary Analysis application. Continue a later actual
cumulative source window, retaining previous events and current customer work.
An empty result stays its actual empty result. The original action table
retains review/apply/delivery before dispatch and is the continuation route
after an uncertain reply.

Prepare a fresh linked delivery from the accepted programme. Inspect and
download that original delivery:

~~~sh
starforge mcp-analysis-events inspect \
  --url "$MCP_URL" --workspace "$ANALYSIS_ALIAS" \
  --programme "$PROGRAMME" --delivery "$DELIVERY_ID"

starforge mcp-analysis-events download \
  --url "$MCP_URL" --workspace "$ANALYSIS_ALIAS" \
  --programme "$PROGRAMME" --delivery "$DELIVERY_ID" \
  --dir "$EVENT_DELIVERY" --index-sha256 "$REVIEWED_INDEX_SHA256"

starforge mcp-analysis-events reopen \
  --workspace "$ANALYSIS_ALIAS" --programme "$PROGRAMME" \
  --delivery "$DELIVERY_ID" --dir "$EVENT_DELIVERY" \
  --index-sha256 "$REVIEWED_INDEX_SHA256"
~~~

Use actual selected values returned by this same original operation. The exact
index distinguishes the accepted result edition from the programme in its
archived workspace. It covers the report, full typed export, workbook, original
source pair, reviewed window, complete native archive, programme snapshot,
manifests and opening instructions.

## 2. Select the customer's existing Installation

Open the original Grant Operations case and inspect **Customer installations**.
Continue an existing saved Installation through **Use this edition as a draft**.
Its current native document, revision and observed checks stay with that
existing identity.

For a new Installation, attach the original commercial commissioning source
and its matching full packet in the existing case. Select their actual native
IDs and digests. Run these original commands from sf47_budget_model:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshares --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --output "$PRIVATE_INPUT/original-workshares.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshare-seed --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE" --expected-revision 0 \
  --output "$PRIVATE_INPUT/original-seed.json"
~~~

Keep the complete returned envelope. The packet flags are paired when that
packet is attached. The [original Installation guide](../../sf47_budget_model/workspace/INSTALLATIONS.md)
and [workorder operating course](README.md) define its current native
references, preview, save, recovery and complete-case receiving.

## 3. Fill the actual operator bindings

The installed profile loader discovers **webhook-event-analysis** automatically:

~~~sh
starforge grant-installation-workorder profiles

starforge grant-installation-workorder template \
  --profile webhook-event-analysis \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --out "$PRIVATE_INPUT/event-bindings"
~~~

The template pins the original operating case/version, plan/revision/digests
and commercial Workshare. Fill the customer's actual source authority,
source attachments, merchant and independent buyer deployments, reviewed
network/asset/recipient, exact atomic price, useful task count, aggregate budget,
facilitators and named receiving host/operator.

Keep unselected numeric values null and original atomic amounts as strings.
A professional implementation fee is retained in the Workshare; it is separate
from a merchant's page/resource price. Source credentials stay in the existing
private configuration and the handover records their reference.

The event preparer fills a blank source description with the exact received
workspace/programme/delivery/review/index identities and supplies its installed
receiving application. Explicit customer descriptions remain intact. The full
annex always retains the selected original index and complete file inventory.

## 4. Prepare and reopen the whole installation package

Select a private output directory outside the original delivery. Both parents
must already exist on the operator's Linux host. The maintained runtime needs
Node.js and its existing util-linux flock lease.

~~~sh
starforge mcp-analysis-event-installation prepare \
  --directory "$INSTALLATION_RECEIVING" --source "$EVENT_DELIVERY" \
  --workspace "$ANALYSIS_ALIAS" --programme "$PROGRAMME" \
  --delivery "$DELIVERY_ID" --index-sha256 "$REVIEWED_INDEX_SHA256" \
  --seed "$PRIVATE_INPUT/original-seed.json" \
  --bindings "$PRIVATE_INPUT/event-bindings/bindings.json"
~~~

The command opens and verifies the original complete delivery, privately
retains the exact native seed, operator bindings and installed profile, and
retains its original request before preparing the new result. It streams every
original delivery file through the existing retained download writer into
**delivery/**. File hashes and accepted prefixes remain exact; the copy uses
bounded chunks and preserves the original alias/index.

It then calls the existing Installation preparation core. Original commercial
workorder, funded assignments, phase checks, Workshare binding, workflow periods
and coordination stay unchanged. The complete native document retains its
128 KiB limit. The entire source and descriptions remain in the independently
reopenable package.

| Complete retained output | Customer use |
| --- | --- |
| delivery/ | All sixteen original event files, exact original index and retained file continuation |
| source/seed.json | Exact complete original native Installation seed |
| source/bindings.json | Exact selected operator bindings |
| source/profile.json | Exact installed customer profile used in this preparation |
| prepare-request.json | Original source selection and input identities |
| derived-bindings.json | Complete bindings with the selected original delivery descriptions |
| EVENT_CUSTOMER_SOURCE.json and .md | Full original index and readable source/result/receiving context |
| installation-input.json | Complete native document for Customer installations → Load input file |
| installation-preview-input.json | Original native API preview envelope |
| WORKORDER.md | Full customer course, source/payment/receiving, original phases and remaining selections |
| preparation.json | Complete prepared edition, original inputs, output hashes and actual pending selections |

Repeat the same retained request after interruption:

~~~sh
starforge mcp-analysis-event-installation prepare \
  --directory "$INSTALLATION_RECEIVING"
~~~

An unfinished file copy continues from the same original source directory. Once
all sixteen local files and their complete root index have arrived, interrupted
document preparation finishes from that independent copy even if the producer's
original directory is unavailable. A changed retained local file is reported for
its original correction; it does not silently trigger a replacement source. If that
complete source was independently moved, supply its new private **--source**
path; its selected workspace, programme, delivery and every byte must match.
A completed preparation reopens its own full retained copy and inputs.

Independently reopen the resulting package:

~~~sh
starforge mcp-analysis-event-installation reopen \
  --directory "$INSTALLATION_RECEIVING"
~~~

This reads every retained input and prepared output, checks their original
request identities and verifies all sixteen event files offline. It uses the
saved selected alias unless the caller explicitly provides the same one.
Reopening succeeds from the receiving directory with no producer host or
original seed/bindings path.

A changed source selection, native seed or operator decision gets its own
preparation edition directory. Keep the preceding complete source and its
request. The native Installation remains the same case's existing revision
when the customer already has a saved one.

## 5. Preview, save and continue the original case

Open **Customer installations → Load input file** and select
installation-input.json. Inspect its complete task, source, budget and
receiving sections. The original preview resolves case source IDs,
merchant/buyer deployments, pinned plan and commercial phases.

Use the existing **Preview → Save** controls and retain the original native
request, preview digest and returned Installation identity. An uncertain save
is reconciled through that original request before continuing. Once saved,
reopen that edition in the same case. Subsequent actual observations belong
to its original checks and named operators.

The event result and its complete preparation are source material for the
selected case. Attach the source annex, exact index and relevant full files
through the case's existing source interface and its actual file allowance.
The native case archive carries its selected case attachments; the complete
event preparation carries all sixteen original large files. The independent
customer handover includes both complete packages.

The existing receive.mjs driver accepts this installed profile when the
original commissioning/packet and full actual customer bindings are selected.
It resolves an existing Installation by the original Workshare, preserves
the saved native record, exports its complete case and receives that case in
the named second workspace. Reuse that established driver for its actual
existing operation; keep its retained inputs, request prefix and source root.

## 6. Independently restore and use the customer result

Open every actual attachment as its recipient would. The report and workbook
must be useful immediately. Restore Event_Analysis_Workspace.zip with the
original native archive receiver, using the exact digest from the received
index, into a distinct Analysis directory. Register that actual restored
workspace through the original host configuration and reopen the same
programme, original source and customer edits.

The archived programme is the state in that precise database snapshot. A fresh
linked delivery after restoration selects a new native archive operation.
Continue the next actual useful source window through the same programme and
the original review process.

The producer retains the complete preparation directory for the receiving
engineer. A standard archive can transport its complete named members:

~~~sh
tar -C "$INSTALLATION_RECEIVING" -czf "$CUSTOMER_PACKAGE" \
  delivery source prepare-request.json derived-bindings.json \
  EVENT_CUSTOMER_SOURCE.json EVENT_CUSTOMER_SOURCE.md \
  installation-input.json installation-preview-input.json \
  WORKORDER.md preparation.json
~~~

The receiver extracts into a private directory, then runs the installed
**reopen** command on that whole directory. The complete original source bytes
and derived native document remain the selected edition after movement.
Keep the independently received original Grant Operations case with it.

## Operating result and subsequent maintenance

Record actual source, input, review, action, accepted result, delivery and
Installation identities, complete retained paths and the named recipient's
outcome. Measure the actual restore and reconcile later operations through the
original application. Continue the same Support case for source, customer
meaning, receiving or deployment corrections.

The original source/merchant owner controls ingestion and offered terms.
The buyer controls signing, task spending and financial recovery. The
customer selects meanings and useful work. The receiving engineer maintains
the original installation. Their responsibilities remain explicit through
later source changes and handover.

## Operate and inspect the outgoing customer result

Before presenting an application, demonstration, report or export as ready,
the producing maintainer must open, run or render the exact outgoing version,
look at its actual screen or real screenshots, and operate its important
controls. This applies to every local or cloud provider and to future delegated
work. Include the instruction in each delegated receiving assignment.

For this course, open the populated Event programmes workspace and its actual
report and workbook at the intended screenshare width and at a narrow width
where relevant. Operate original-file receiving, complete-review selection,
apply, customer edits, later-window continuation and fresh delivery. Check the
empty, loading and error states used by the workflow. Download every outgoing
attachment, open its intended view, and reopen the exact complete package and
restored workspace. Inspect all attachments, including readable tables and
instructions. Play any final video or audio and inspect its actual presentation
and voice quality before including it.

Use plain industrial presentation: readable tables, clear hierarchy,
consistent typography and spacing, restrained controls and useful labels.
Repair unreadable, unstyled, cramped, clipped or overflowing output directly in
the original product. A captured screenshot must actually be viewed; source
review, DOM counts, HTTP responses, automated checks and another peer's
approval do not replace the producer seeing the result.

Where the existing native owner operates the equipped host, return the exact
outgoing source edition, resulting file locations, actual normal/narrow
screenshots and control/download/reopen outcomes to the producing maintainer
in the original receiving operation. The producer opens those images and
resolves concrete defects there. Continue the same implementation and native
operation; keep the existing focused-validation policy and owner schedule.
The current fleet cutoff is October 13, 2026 at 14:00 UTC.

