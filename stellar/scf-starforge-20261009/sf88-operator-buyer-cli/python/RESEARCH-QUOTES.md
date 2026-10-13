# Research quotations from Python

Use the existing Research workspace to carry a customer quotation through its
reviewed brief, actual customer response, frozen paid publication, Buyer
receiving and realized delivery report. Python calls the original SF74
commercial, SF97 pricing, Research, SF101 checkout and Buyer operations.

The same client also receives every selected operation file, keeps exact
requests across interruption, and copies a complete quotation export into a
directory that can be reopened using Python alone.

## Start with the installed Research workspace

Install this Python package from the complete Stellar Forge source or the
installed product's Python directory. Keep the original Node source beside it;
the client uses the existing Research SDK and quotation operator.

~~~bash
python3 -m pip install /path/to/complete/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
~~~

The Research listener must have its original cases, pricing and merchant
configuration. Use the existing Applications commissioning or the
[quotation operating guide](../research-dossiers/customer-quotes/OPERATING.md).
That guide covers the native commercial quote editor, exact pricing selections,
customer response recording, source work and paid-publication configuration.

Open the already-running Research connection:

~~~python
from stellar_forge_buyer import ResearchWorkspace

with ResearchWorkspace(
    checkout="/path/to/complete/source",
    node="node",
    connection_file="/private/research/connection.json",
    directory="/private/python-quotes",
) as workspace:
    quotes = workspace.quotes()
    configuration = quotes.configuration()
    cases = quotes.cases(limit=50)
~~~

The first native response pins the Research workspace identity. Reopening the
same Python directory checks that identity against the selected connection.
The original credentials stay in their connection file. Closing this client
cancels and drains its admitted local calls and detaches from the listener.

`ResearchQuotes`, `ResearchQuoteExport` and `ResearchQuoteBundle` are available
from `stellar_forge_buyer`. Native selection types are in
`stellar_forge_buyer.research_quote_types`. They retain native camelCase field
names, UUIDs, revisions, review hashes and decimal strings.

## Operate the whole customer journey

Each quotation mutation has a stable Python `call_id` and an original native
request UUID inside its complete input. The Python ID names the local saved
attempt; the native UUID names the existing server operation.

| Customer work | Python operation | Original result |
| --- | --- | --- |
| Create an SF74 case from a saved Research project and brief | `quotes.create_case(selection)` | Original case and CASE operation. |
| Preview, revise and publish the commercial quote; record its actual response | `quotes.case_action(case_id, action, native_input, call_id=...)` | Original SF74 case revision and complete native reply. |
| Open or change selected pricing, capacity, supplier economics or repricing | `quotes.pricing(profile, action, native_input, call_id=...)` | Original SF97 state, preview, version or reviewed operation. |
| Prepare the exact quote-to-brief relationship | `quotes.prepare(selection)` | BRIEF review and retained native source files. |
| Apply the reviewed brief | `quotes.apply({"id": ..., "reviewSha256": ...})` | Original Research revision and quoted brief binding. |
| Carry an actual original customer response into Research | `quotes.prepare_response(selection)`, then `quotes.apply(...)` | RESPONSE review and original customer agreement. |
| Complete evidence work and freeze its delivery | `workspace.customer_updates(dossier_id)` | Original source plan, requested work and customer delivery. |
| Prepare and enroll the paid delivery | `quotes.prepare_publication(selection)`, then `quotes.enroll_publication(...)` | Original Commerce publication, merchant archive and SF101 order. |
| Continue the selected approved Buyer action and receiving | `workspace.commerce()` | Original purchase, payment execution, retrieval and received dossier. |
| Freeze the actual delivery and pricing observations | `quotes.prepare_report(selection)` | REALIZED report plus complete original order, Buyer, customer, pricing and cost files. |

The underlying [native selections and review lifecycle](../research-dossiers/customer-quotes/OPERATING.md#request-and-review-lifecycle)
define every required field. Python passes those complete inputs to the same
native validators. `QuoteBriefSelection.scope.component` selects IMPLEMENTATION,
RECURRING, ROUTE_USAGE or KEEP. The selected quote total retains its original
currency and unit; a quoted scope amount does not replace compiled checkout
terms.

Read a complete selected input from the customer's retained source:

~~~python
import json
from pathlib import Path

selection = json.loads(Path("/private/selections/brief.json").read_bytes())

with ResearchWorkspace(
    checkout="/path/to/complete/source",
    connection_file="/private/research/connection.json",
    directory="/private/python-quotes",
) as workspace:
    quotes = workspace.quotes()
    prepared = quotes.prepare(selection, call_id="customer-brief-review")
    original_review = prepared["result"]["review"]
~~~

The returned object is the full original terminal result. Its `result` is the
native operation or native commercial/pricing response. BRIEF and RESPONSE
preparations reach REVIEWED. Submit the selected original operation `id` and its
exact `review.reviewSha256` to apply the reviewed change. PUBLICATION enrollment
uses the same shape. CASE and REALIZED complete in their native preparation.

Keep the actual customer response in the original commercial case. The response
selection binds its case revision, response ID, operator and original customer
contact. Customer agreement, dossier revision, quoted brief and frozen delivery
relationships remain validated by the native product.

The existing [customer delivery client](RESEARCH-CUSTOMER-UPDATES.md) completes
the underlying Research work. Paid delivery and Buyer operations remain in
`ResearchWorkspace.commerce()`, including original approval, execution,
cancellation, recovery and complete archive receiving.

## Keep complete raw inputs and exact monetary values

For an input already retained as a file, use `submit_file`:

~~~python
reply = quotes.submit_file(
    "prepare",
    "/private/selections/brief.json",
    expected_input_sha256=the_original_complete_file_sha256,
    call_id="customer-brief-review",
    resume=True,
)
~~~

The client copies the entire raw file into that call's private `quote-input`
directory before the original operation can dispatch. Its source descriptor
binds byte length and SHA256. A later retry can use those retained bytes even if
the original donor file has moved. A donor that is still present must match.

The original quote input budget is 96 MiB plus 65,536 bytes. Complete raw
commercial backups and pricing inputs therefore remain file-backed. The small
Python-to-Node request carries their path and exact metadata. Complete native
replies are retained in a separate response file; stdout carries its descriptor.
Each streamed quotation file retains the original 256 MiB maximum.

JSON duplicate keys and non-finite numbers are rejected. Integers outside
JavaScript's exact safe-integer range must be represented according to the
native field contract, normally as strings for exact monetary or source
quantities. Monetary strings are passed unchanged. The original engine remains
responsible for domain validation, rounding rules and quote arithmetic.

`submit(command, value, ...)` accepts the same complete native JSON object.
The convenience methods choose their matching command. Native commercial and
pricing calls always require an explicit `call_id` because their route-specific
input may use a different request convention.

## Saved work, interruption and replay

A received result is kept in the existing `ResearchWorkspace` call journal.
The quotation operator also retains its exact native input, source binding,
attempts, review, selected files and completed result.

~~~python
saved = quotes.saved("customer-brief-review")
if not saved["completed"]:
    completed = quotes.recover("customer-brief-review")
else:
    completed = saved["result"]
~~~

`saved` is a local read. It verifies the complete response file and the original
retained raw input. `recover` continues that same recorded action, source
selection, review hash and native UUID. A completed request reopens its first
saved result; it does not reselect a newer case or pricing version.

A deliberate separate attempt uses the exact original native request:

~~~python
replayed = quotes.replay(
    "customer-brief-apply",
    replay_id="customer-brief-apply-received",
)
~~~

The replay keeps the original native IDs, source input and routing fields. It
can also continue an interruption that occurred before the original terminal
request was published. The new local attempt does not change the original
selection to match later customer work.

`quotes.inspect_run(call_id)` opens the original operator request, complete
input/selection, attempts and result. Use `ResearchError.record` for the full
original native failure, including uncertain writes, published-file outcomes
and cleanup errors. `sourceCleanupFailed` remains attached to a returned result
when original work completed but a native closer needs attention.

For a deliberately changed quote, customer response or observation period,
select a new native request. Reusing an ID with changed inputs is rejected by
the original request and source checks.

## Browse and receive all original files

`cases` returns one live native commercial page. `case(case_id, revision=sha)`
opens the exact selected case revision. Quotation operation pages carry a
listing snapshot:

~~~python
for page in quotes.iter_pages(dossier_id=dossier_id, limit=100):
    consume_complete_page(page)
~~~

Every native item and page error remains in the returned page. The iterator
keeps the first snapshot and total through the full traversal. To page manually,
pass the first page's `snapshot` to the next `list` call.

For one file, read the original metadata and receive the complete stream:

~~~python
metadata = quotes.file_info(operation_id, original_name)
original = metadata["descriptor"]

received = quotes.download(
    operation_id,
    original_name,
    expected_sha256=original["sha256"],
    expected_bytes=original["bytes"],
    call_id="customer-original-report",
)
file = quotes.downloaded_file(received)
with file.open() as complete_stream:
    consume(complete_stream)
~~~

The file metadata is retained before transfer. Reopening the completed call
checks the full original file again. `FileDelivery.save_as(destination)` creates
an exclusive complete copy with the same byte count and SHA.

Receive every file in a selected operation:

~~~python
exported = quotes.export_operation(
    operation_id,
    call_id="customer-complete-report",
)
original_export = quotes.exported_files(exported)
for name in original_export.names:
    with original_export.file(name).open() as complete_stream:
        consume(name, complete_stream)
~~~

This uses the native quotation exporter. It freezes the complete original
operation and file roster before individual files are published, then verifies
all received files. The result keeps the original selection and every file's
name, media type, byte count, SHA and retained path.

`export_case(case_id, input_file=..., call_id=..., expected_sha256=...,
expected_bytes=...)` receives an original selected commercial file. Set
`tariff=True` for the original tariff route. Read `case_file_info` first with
the same native body when preparing the explicit file selection; retain its
actual revision and complete metadata.

## Deliver a portable complete quotation export

Use the original native copy publisher:

~~~python
copied = quotes.copy_export(
    "customer-complete-report",
    "/private/customer-return/realized",
    copy_id="customer-complete-report-copy",
)
manifest_sha256 = copied["manifest"]["sha256"]
~~~

The destination contains the original `quote-export.json`,
`quote-export-selection.json` and every original file named by that selection.
Copy the complete directory to the receiving computer.

The receiving computer can verify and use it without a Research connection,
Node process, wallet or merchant:

~~~python
from stellar_forge_buyer import ResearchQuoteBundle

bundle = ResearchQuoteBundle.reopen(
    "/customer/received/realized",
    expected_manifest_sha256=manifest_sha256,
)
bundle.verify()
for name in bundle.names:
    with bundle.file(name).open() as complete_stream:
        consume(name, complete_stream)
~~~

The full manifest, original selection and every complete file are verified.
The bundle retains native filenames and records, including the quote, source
case, reviewed binding, paid-publication and realized-report files that were
selected by the original exporter.

## Installed commands

The existing `stellar-forge-research` command exposes all quotation operations.
The same commands are available with
`python3 -m stellar_forge_buyer.research_cli` or
`python3 -m stellar_forge_buyer.research_quotes_cli`.

Global options precede the command:

~~~bash
stellar-forge-research \
  --checkout /path/to/complete/source \
  --connection /private/research/connection.json \
  --directory /private/python-quotes \
  quotes-prepare \
  --input /private/selections/brief.json \
  --call-id customer-brief-review \
  --resume \
  --output /private/results/brief-review.json
~~~

`--output` retains the complete JSON reply in an exclusive file. Without it, the
full reply is printed. Native write inputs use `--input`, optional
`--input-sha256`, a stable `--call-id`, and optional `--resume`.

| Commands | Selection |
| --- | --- |
| `quotes-configuration`, `quotes-cases`, `quotes-case` | Original host declarations and full native case pages/revision. |
| `quotes-list`, `quotes-operation`, `quotes-files`, `quotes-file-info` | Original snapshot, operation UUID and file name. |
| `quotes-create-case`, `quotes-prepare`, `quotes-apply`, `quotes-prepare-response` | Complete original request JSON. |
| `quotes-prepare-publication`, `quotes-enroll-publication`, `quotes-prepare-report` | Complete original delivery/publication/report JSON. |
| `quotes-native-case` | `--case-id`, `--action` and complete native input. |
| `quotes-pricing` | `--profile`, `--action` and complete native input. |
| `quotes-case-file-info` | `--case-id`, original `--input`, optional `--tariff`. |
| `quotes-export-operation` | `--id`, `--call-id`, optional `--operation-sha256`. |
| `quotes-export-case`, `quotes-export-tariff` | `--case-id`, original `--input`, `--call-id`, original optional `--sha256`/`--bytes`. |
| `quotes-download` | `--id`, `--name`, `--sha256`, `--bytes`, `--call-id`, optional exclusive `--file`. |
| `quotes-copy-export` | Original export call ID, `--target`, distinct `--copy-id`. |
| `quotes-saved`, `quotes-resume`, `quotes-run-inspect` | Original local call ID. |
| `quotes-replay` | Original local call ID and distinct `--replay-id`. |
| `quotes-bundle-inspect`, `quotes-bundle-file` | Complete bundle in global `--directory`, exact `--manifest-sha256`. |

Saved calls can reopen with `--checkout` and their original `--directory`
without a connection. The standalone bundle commands require neither checkout
nor connection:

~~~bash
stellar-forge-research \
  --directory /customer/received/realized \
  quotes-bundle-inspect \
  --manifest-sha256 ACTUAL_QUOTE_EXPORT_JSON_SHA256
~~~

## Complete original programme receiving

[examples/research_quotes_receiving.py](examples/research_quotes_receiving.py)
executes selected original requests, receives all selected quotation and paid
files, deliberately replays one original quotation request, closes and reopens
the client, exercises the installed CLI, and builds a fully inventoried customer
ZIP.

This programme consumes the original customer's input files and native request
IDs. Its `steps` may include quotation operations and the existing Commerce
client's approved Buyer operations, in the exact selected order. It uses the
existing Python/native call journals and original source workspace throughout.

The complete selection is one JSON object:

~~~text
schema: "stellar-forge.research-quotation-receiving.v1"
operationId: a stable descriptive local name
workspaceId: the original Research workspace ID
dossierId: the original customer dossier ID
caseId: the original SF74 case UUID
steps: ordered complete original requests
operations: original completed quotation operations to export
caseExports: selected original case/tariff files
commerceExports: selected original paid-publication/Buyer files
replayCallId: one quotation step whose original request will be replayed
~~~

Every step has these fields:

~~~text
callId: stable Python call ID
family: "quotes" or "commerce"
command: the original native command
source: {file: relative original JSON path, bytes: exact byte count, sha256: exact hash}
~~~

For `family: "quotes"`, command names are `create-case`, `native-case`, `pricing`,
`prepare`, `apply`, `prepare-response`, `prepare-publication`,
`enroll-publication` or `prepare-report`. Add `caseId` and `action` for
`native-case`; add `profile` and `action` for `pricing`. The full route-specific
native body remains in its selected source file.

For `family: "commerce"`, use an existing native command such as
`purchase-receive`, `purchase-prepare`, `execute`, `retrieve`, `finalize`,
`recover`, `cancel`, `reconcile` or `receive-dossier`. The original Commerce
selection, approval and request IDs remain in that complete source. Its existing
native input limits still apply.

Each `operations` entry is `{id, kind, requestSha256}` from an actual native
CASE, BRIEF, RESPONSE, PUBLICATION or REALIZED operation. The receiver requires
that selected operation to be COMPLETE and exports every original file.
Choose the complete relevant set from the actual customer programme.

Each `caseExports` entry is
`{name, source, tariff, sha256, bytes}`. The source is the same exact native
download request, and the metadata comes from the original case/tariff
file-info operation. `name` labels its portable directory.

Each `commerceExports` entry is `{name, kind, id, part, sha256}`. `kind` is
`publications` or `purchases`; `part` uses the original Commerce file selector:
`publication`, `handoff`, `archive` or `received`. `name` is the receiving
filename.

All lists are required; a source programme without a particular optional export
uses an empty list. `replayCallId` selects one quotation request from `steps`,
excluding raw `native-case` and `pricing` actions. This explicitly exercises an
original native idempotent quotation request.

~~~bash
python3 examples/research_quotes_receiving.py \
  --checkout /path/to/complete/source \
  --connection /private/research/connection.json \
  --selection /private/selected-customer/quotation-receiving.json \
  --selection-sha256 ACTUAL_COMPLETE_SELECTION_SHA256 \
  --directory /private/quotation-receiving
~~~

The receiver preserves the complete raw selection and every input before any
native mutation. Each input path is relative to the original selection's
directory; a complete returned handover can also supply its retained `inputs/`
directory. Rerunning the same command reopens the original saved calls and exact
file selections.

The resulting `research-quotation-delivery.zip` includes the complete original
inputs, native replies, selected operation files, commercial files, paid
files, portable quotation manifests, installed CLI results and full receiving
record. Every archive member is streamed back and checked against the complete
manifest before success. `receiving.json` supplies each bundle's
`relativeDirectory` and exact manifest SHA for another receiving computer.

Keep the receiver's full `client` directory with the original operating
workspace when continuing its local request history. The portable handover
contains the complete customer sources/results and reopens its original export
bundles independently. The original native workflow remains reachable using its
unchanged server operation IDs.

## Source and ownership

The implementation joins the original
[quotation operator](../research-dossiers/customer-quotes/operator.mjs),
[typed native client](../research-dossiers/customer-quotes/client.d.mts),
[complete file publisher](../research-dossiers/customer-updates/files.mjs)
and existing Python `ResearchWorkspace`. It adds no commercial case store,
pricing calculator, payment ledger or second Research listener.

The installed Research contribution includes the complete Python bridge,
client, types, CLI, guide and receiving programme. Existing Applications
commissioning, customer source work, paid delivery and the native commercial
editor retain their original owners and saved operations.
