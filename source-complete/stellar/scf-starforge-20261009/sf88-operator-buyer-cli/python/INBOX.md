# Original Inbox source for delivery Operations

A Python application can inspect an existing native SF88 Inbox and export
selected original jobs into the maintained Operations handoff. The same
original Node queue, SF52 outcome interpretation, SF36 saved finalization
reader and verified output reader supply the observations. The Python view
creates no queue or application-operation journal.

Use Python 3.11+ with the matching complete SF88 checkout and its existing
Node 22+ runtime. The Python wheel alone does not contain the native source.
Install/upgrade it together with the maintained release:

~~~sh
python -m pip install ./stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python
install -d -m 700 /srv/private/exports
~~~

## Select the existing original jobs

The stand-alone Inbox view needs no new Buyer application directory:

~~~python
from stellar_forge_buyer import Inbox

inbox = Inbox(
    checkout="/srv/forge/public-commons-sprint-2026",
    directory="/srv/private/customer-inbox",
    node="/srv/runtime/bin/node",
)
listed = inbox.list()
for job in listed.native["jobs"]:
    print(job["operation"]["intentId"], job["state"])

selected = inbox.show("monthly-report-001")
print(selected.native["job"])
~~~

An application that already uses `Buyer` can call
`buyer.inbox("/srv/private/customer-inbox")`. That view uses the Buyer's
original checkout, Node executable, environment and timeout. It does not import
a second request into Buyer state. The view exposes only list, show, export and
saved-file inspection; the original terminal, queue and accounting owners
continue to own economic actions.

These methods return `InboxResult`. Its `native` field contains the original
reader result; `process` records this local command's return code, error and
interruption status. An inspection completing successfully does not change the
historical buyer's outcome.

## Export one explicit source edition

Select 1–100 unique original intent IDs. The output must be a new absolute
filename whose existing parent is private (mode 0700 on POSIX). The native
writer publishes the complete source file with mode 0600:

~~~python
receipt = inbox.export_operations(
    "/srv/private/exports/operations-source.json",
    intent_ids=["monthly-report-001"],
    max_verify_bytes=268_435_456,
)
print(receipt.native["path"])
print(receipt.native["bytes"], receipt.native["sha256"])
print(receipt.native["intentIds"], receipt.native["counts"])
~~~

The compact result retains
`path`, `bytes`, `sha256`, `counts`, `intentIds`, `canReceive` and
`noExecution: true`. It does not place the raw private packet on stdout.

The exact capture retains original Inbox, request, attempt, terminal, recovery,
finalization and checkout-evidence bytes. The output reader verifies each
selected saved response's complete byte count and SHA-256 before recording a
verification observation. Response bodies are not embedded in this source
handoff. Their retained original files stay with the buyer.

The entire handoff is bounded to 8 MiB. The per-file
`max_verify_bytes` limit defaults to 256 MiB and accepts an integer from
0 to 1 GiB; the aggregate verification ceiling is 1 GiB. Source capture stops
when its packet bound is exceeded and asks for a smaller explicit selection.
An output above the chosen verification cap is marked `OVER_LIMIT`; a
missing/unreadable retained file remains unavailable. Neither state becomes
a verified product or a financial reversal.

`canReceive` is the aggregate of the original per-row flags. False does not
mean the capture failed: the exact source can include a conflict or other row
that requires the operator's attention. The receiving UI permits explicit
selection of receivable rows and preserves all unselected originals.

## Reopen after a lost response

The file's capture timestamps are part of its source identity. Inspect the
same destination after an interrupted or uncertain command, rather than
recapturing the changing Inbox into that name:

~~~python
from stellar_forge_buyer import InboxError

destination = "/srv/private/exports/operations-source.json"
try:
    receipt = inbox.export_operations(destination, intent_ids=["monthly-report-001"])
except InboxError as error:
    # Preserve these actual handles. A file may have published before a timeout.
    print(error.code, error.inbox_directory, error.destination)
    # Call this once the operator has checked the reported failure.
    # It succeeds only for an existing complete, valid private handoff.
    saved = inbox.inspect_operations(destination)
else:
    saved = inbox.inspect_operations(receipt.native["path"])

print(saved.native["sha256"], saved.native["intentIds"])
for row in saved.native["report"]["rows"]:
    print(row["intentId"], row["purchase"]["settlementStatus"],
          row["output"]["state"], row["issues"])
~~~

Inspection reads the exact saved edition even if the original Inbox is now
offline. Compare the returned source digest and selected intent IDs with the
intended handoff before receiving it into an operating case.
`BUYER_HANDOFF_ALREADY_EXISTS_USE_INSPECT` preserves an existing file.
If there is no published destination, retain the original error and resolve the
read/storage issue; an explicit new capture into the same still-unused
destination remains a local source action. An operator can choose another new
filename for a later edition. Existing editions are never overwritten.

Every method accepts `cancel_event=threading.Event()`. Setting it signals
the existing native child through the shared Runtime, which retains bounded
output and cancellation handling. The default native timeout is 360 seconds
and can be configured up to the Runtime's 3,600-second bound for the selected
original files. The Inbox view's report-output ceiling defaults to 16 MiB;
`output_limit` is a constructor setting within the existing Runtime bounds.
It affects the command report only, not request, spending or capture limits.

## Use the maintained command line

These original `stellar-forge-buyer` subcommands need no `--state`
directory. Supply the matching source checkout and existing Inbox:

~~~sh
stellar-forge-buyer --checkout /srv/forge/public-commons-sprint-2026 \
  inbox-list --inbox /srv/private/customer-inbox

stellar-forge-buyer --checkout /srv/forge/public-commons-sprint-2026 \
  inbox-show --inbox /srv/private/customer-inbox --intent monthly-report-001

stellar-forge-buyer --checkout /srv/forge/public-commons-sprint-2026 \
  inbox-export-operations --inbox /srv/private/customer-inbox \
  --intent monthly-report-001 --out /srv/private/exports/operations-source.json

stellar-forge-buyer --checkout /srv/forge/public-commons-sprint-2026 \
  inbox-inspect-operations --inbox /srv/private/customer-inbox \
  --file /srv/private/exports/operations-source.json
~~~

Repeat `--intent ID` for the next explicitly selected job. Add
`--max-verify-bytes N` to set the same per-output cap. The inspection
command's Inbox argument identifies the original source view; it does not
require that directory to remain accessible or silently substitute its
current state for the saved edition.

CLI exit 0 reports completion of the requested local reader/export. Source
conflicts remain in the successful report for review. A native, argument,
storage or interrupted-result error returns a nonzero exit with the stable
code and available destination/process handles. No command in this section
calls native execution, recovery, reservation finalization, a signer or a
merchant. Existing application-operation commands still require `--state`
and retain their original approval/execution behavior.

The direct original queue CLI also exposes
`queue-cli.mjs operations export --inbox ABS --intent ID --output ABS`
and `operations inspect --file ABS`; it prints the complete private report.

## Complete the original receiving workflow

Open the existing **Delivery operations → Native buyer handoff** pane.
Inspect the saved file and its digest, associate the source with the original
operating case and deployment, and review the exact intent rows. The native
source is retained with its full bindings before the selected original
purchase observations enter the case's existing transaction and history.

Keep unknown and failed states, unlike assets and networks, output status,
settlement evidence, capture timestamps and any source conflicts distinct.
The receiving operation does not create another purchase or reinterpret an
authorization ceiling as a paid amount. Local native delivery, a recorded
testnet transfer, commercial customer acceptance and grant/payment claims have
their own source and decision records.

Retain the private handoff, original Inbox, original response files and the
receiving case through their maintained backup paths. To re-open this capture,
use its saved file and digest. To perform a future economic action, return to
the original queue/operator workflow; this API does not provide an action that
could repeat one.
