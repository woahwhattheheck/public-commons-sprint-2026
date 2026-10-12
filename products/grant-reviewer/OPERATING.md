# Read the SCF application and operate its retained grant purchase

Open the original public purchase as an operating reviewer workspace. Review its
source and terms, read both complete native results, export a closed Buyer view,
and receive that packet under another operator's private workspace.

This workflow uses the retained purchase. The original transaction, quote
identities, seller outcomes and source documents remain part of that packet.
Opening, reading, exporting and receiving it do not dispatch another payment
or refresh the source data.

## Read the complete application and financing

The selected package includes the manuscript author's reviewed application,
the product and financing companion, the original six-package budget and the
source index. Open them through the shared source server:

~~~sh
starforge grant-application --port 8787
~~~

Open the exact local URL printed at startup, normally
`http://127.0.0.1:8787/grant.html`. Choose `--port 0` when another service already
uses that port. If the same package's `cocart-setup` listener is already open,
read `/grant.html` at its existing origin.

The application page provides the complete original Markdown downloads,
`budget.csv`, `source-index.json`, the preserved economic briefing and the
published presentation links. The four direct local downloads are:

| Download | Local path |
| --- | --- |
| Primary application | `/grant-data/application.md` |
| Product and financing companion | `/grant-data/product-and-finance.md` |
| Six-package budget | `/grant-data/budget.csv` |
| Source and measure index | `/grant-data/source-index.json` |

The source manifest identifies the complete selected application edition.
The source index retains the underlying manuscript and financial identities;
the preceding reviewer source at `f7fe93c07355b1688a550bbcd349a5590fa1d680`
remains in the original history. Read the published film and editable
companion at the original release links. The package retains the current
application and economic-report source downloads.

Begin with **Explore the working product** to inspect the original film and
complete report, follow Applications, or prepare the same installed/source
command and complete opening guide. Its [reviewer-opening guide](../../stellar-forge/developer-site/GRANT_ENTRY.md)
travels with this selected source.

Choose **Prepare submission** to edit the nine complete answers, map the
actual issuer fields and limits, copy the selected full text, and save a
complete version. Export and reopen the working draft with every source
edition, manual answer, field mapping and review note. Receiving a later
source edition preserves manual edits against their original baselines.
The [submission operating guide](../../stellar-forge/developer-site/GRANT_SUBMISSION.md)
covers that complete original workflow.

Choose **Review prepared draft** for the original named reviewer and author
workflow. Receive the complete saved draft, record decisions and quoted change
requests, return the full review, and compare the author's next complete draft.
Carry decisions explicitly for unchanged content; changed source or answers
reopen affected review requests. The original **Submission handover** retains
that selected review with planning, prepared output and issuer observations.
The [review-round guide](../../stellar-forge/developer-site/GRANT_REVIEW_ROUNDS.md)
and [handover guide](../../stellar-forge/developer-site/GRANT_HANDOVER.md) travel
with the same installed source and draft-store workflow.

The installed `grant-compose` command receives the owner's selected manuscript
through the same maintained composer:

~~~sh
starforge grant-compose \
  --directory /absolute/current/developer-site/dist \
  --manuscript /absolute/current-scf-application.md \
  --source-pins-output /absolute/current-grant-source-pins.json
~~~

Keep the current application, complete detailed companion, source index and
page shell together in that directory. Existing product selections are
retained from the source index; the [composition guide](../../stellar-forge/developer-site/GRANT_COMPOSITION.md)
describes explicitly selecting a new economic, coastal, merchant-financial or paired Datasette source. Its [financial application guide](../../stellar-forge/developer-site/GRANT_FINANCIAL_OPERATIONS.md) covers **--finance-commit**, dated customer balances, settlement and accountant receiving within the same current application.
The four emitted reader pins go to the original `inspectGrantApplication`
callback. The selected installed renderer/projector hashes and the original
canonical-front identity remain recorded in the source index.

Ctrl+C closes this reader. Reopen the same command to read the same installed
source. For a checkout, the original entry is
`node stellar-forge/developer-site/grant.mjs --port 8787`.
The retained purchase workbench below keeps its own saved packet and lifecycle.

## Open the reviewer

Use the [maintained runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
with the native Stellar packages, the `mcp` feature and operator support.
Retain its selected source archive, complete lock and READY installation.

In **Applications**, select **Grant purchase reviewer**. Choose that runtime
and a private workbench directory beneath an existing private parent. Leave
Packet and SHA-256 empty to select the bundled original purchase in the
workbench, or supply the exact receiving packet and displayed digest.

Choose **Review**, **Save**, **Connect** and **Start**, then **Open**.
The saved application binds the workbench, selected packet and runtime.
Applications opens only the current workbench instance.

The installed command opens the same product directly:

~~~sh
starforge grant-demo workbench --dir /srv/starforge/state/grant-review --port 0
~~~

For a source checkout, replace `starforge grant-demo` with
`node stellar/scf_2026/presentation/reviewer/cli.mjs`.
Keep the private parent directory under the operator's control. Structured
startup output contains the listening address and instance identity; open
through Applications or read the original local
`workbench-connection.json` for this instance's private access code.
The browser clears the entered code and URL fragment after connecting.

## Review the original source and read the complete result

1. Open **Packet intake** and choose **Review bundled purchase**, or upload the
   complete exported JSON packet. The workbench retains its exact bytes and
   checks its original documents, native result representation and SHA-256.
2. Open **Source and query**. Review the retained source, original query,
   selected terms and complete source-document downloads.
3. Choose **Receive this packet**. The original receiving engine restores the
   native quote records and full result files into this selection's private
   directory.
4. Choose **Open original Buyer**, then open **Buyer results**.
5. Select each quote and choose **Read complete saved result**. The original
   Buyer client reads every retained range and checks the complete byte count
   and digest before presenting or downloading the result.

The bundled NYC HPD purchase contains 100 building-in-project rows and
14 columns in its original 53,468-byte MCP result. Its retained truncation flag
remains true. The source vintage and exact query are shown with that result;
these are historical project events rather than a current housing listing.

The primary quote retains its confirmed seller status and matched transfer.
The earlier indeterminate quote remains separately visible with its original
failed observation and complete 4,733-byte error result. Read each original
record in its own history.

**Open original console** uses that Buyer's existing private-code form.
Retrieve and copy its current code through authenticated local access.
Keep it out of exported packets and shared project metadata.

## Export a closed Buyer and receive it elsewhere

Choose **Handover → Close Buyer and export packet**. The workbench waits for
the whole original Buyer to close, drain its work and release the writer lease.
The export then includes the complete native quote transitions and results
from that closed view.

Download the packet and retain its displayed SHA-256 with it. Give the receiving
operator the complete packet. Their new Applications review selects that
original file and digest, a new private workbench directory and their own
reviewed runtime.

The direct command uses the same receiving path:

~~~sh
starforge grant-demo workbench --dir /srv/starforge/state/received-review \
  --packet /srv/starforge/received/original-review.json \
  --sha256 ORIGINAL_EXPORTED_SHA256 --port 0
~~~

The receiving operator reviews and receives the packet, opens the native Buyer
and reads the full original results. Their private access code and workbench
are new; the original quote identities and result bytes remain the same.
**Review receiving copy** provides this same handover locally and labels that
selection as a local copy.

## Continue after closing or interruption

Use **Reopen this received packet** to start the original Buyer after a closed
export. In Applications, **Stop** drains the managed workbench and its Buyer;
the next reviewed Start reopens the same retained workspace.

Keep the workbench directory and its original action IDs. A lost response can
continue the same action with the same selected inputs. An already published
export is recovered by its original identity before current mutable Buyer
history is read. A completed Open receipt shows its historical outcome
separately from the current live Buyer.

A prepared managed start retains its original request ID before child dispatch.
Reopen the same Applications controller and recover that request. Do not
substitute a new workbench or repeat the original purchase.

The [complete reviewer operating guide](../../stellar/scf_2026/presentation/reviewer/WORKBENCH.md)
covers the original command, private access, receiving decisions and managed
continuation. Its full receiving carrier can extend the same already completed
direct journal with an actual matching READY runtime; it keeps the original
run, skips completed direct phases and preserves the earlier result.


## Operate the same review from a merchant or application client

The [merchant provider and typed client](../../stellar/scf_2026/presentation/reviewer/merchant/README.md)
connect these same workbenches to the existing merchant MCP host. Select the
full toolkit or a reviewed product selection containing both `merchant-mcp`
and the `merchant-grant-reviewer` contribution.

Save the original and receiving directories under named aliases in a private
`stellar-forge.grant-reviewer-merchant-connection.v1` JSON file. An alias with
`allowStart: false` borrows the workbench already opened by Applications;
`allowStart: true` permits an explicit start of that same original workbench.
The complete guide supplies the exact connection fields and source-file pins.

~~~sh
starforge merchant-grant-reviewer init --directory /srv/starforge/reviewer-merchant \
  --connection /srv/starforge/private/reviewer-connections.json
starforge merchant-mcp serve --config /srv/starforge/reviewer-merchant/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

The twenty `merchant_grant_reviewer_` operations provide source review and
receiving, current Buyer lifecycle, original quote/history/result reading,
complete document retrieval, closed-view export and full-file receiving.
The typed `@tokenjunkielabs/starforge-merchant/grant/reviewer-merchant` client
uses the same contracts; its CLI supports calls, local-file review, inspection,
interrupted-download continuation and local cold reopening.

Retain the request UUID with each action. After a lost reply, inspect or repeat
that original action with the same input. An exported file keeps its complete
manifest, original workbench identity, byte count and SHA-256 as the merchant
host restarts. The receiver resumes the original saved download directory and
checks every file before reopening it.

Merchant shutdown releases its readers and its own workbenches. An
Applications-owned workbench remains with that original owner. The private
Buyer code stays in its original host connection.

This standalone edition includes the complete source from
[public PR1984](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1984),
merge `ddde47d69aac27cae5021a17bc6b3d15d43fc884`. The complete
[merchant receiving continuation](../../stellar/scf_2026/presentation/reviewer/merchant/RECEIVING.mjs)
extends the same original closed reviewer operation and both saved result files.
The Console continuation follows that same operation and its existing merchant
journal through complete customer delivery and independent receiving.

## Complete customer delivery in the operator workspace

The `grant-reviewer` product selection includes both **Grant purchase reviewer**
and **Merchant operator** in Applications. Keep the original workbench open
through its owning application. Initialize its merchant connection with the
command above, then save **Merchant operator** using that
`merchant-mcp.json`, a private saved operator directory and the original token
environment name. **Review Start → Start → Open** leads to the authenticated
operator workspace on that same merchant listener.

The direct command opens the same workspace:

~~~sh
starforge merchant-mcp serve \
  --config /srv/starforge/reviewer-merchant/merchant-mcp.json \
  --operator-console-dir /srv/starforge/reviewer-merchant/operator-console \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

Select or create a named profile, then open **Customers → Reviewer customer
delivery**. Work through the five sections:

1. Load the configured workbench aliases and open the original source state.
2. Review the bundled purchase, a declared host file, or a complete local packet.
   Inspect the saved selection and its revision before receiving it.
3. Open the original Buyer and read its complete saved history, both quote
   outcomes, full result files and source documents.
4. Close the Buyer and export the selected packet. **Receive these original
   files** retains its complete manifest and every original file in Customers.
   Download the full receiving packet, or choose an individual retained file.
5. Prepare the complete delivery or receiving recipe. The existing Workflow
   Recipes editor reviews its actual inputs and native contracts, then installs
   a named immutable workflow edition.

The delivery recipe has fourteen native steps, with pauses at source inspection,
the complete saved result, closed export, receiving review and received history.
The six-step receiving recipe starts from an existing reviewed export. Its
destination is another configured workbench. Each original action UUID stays
with its saved request; a lost response continues that request and revision.

A completed workflow export can be reopened in Customers with its exact
workbench alias, export ID and manifest SHA-256. Receiving resumes the retained
file checkpoints after interruption. The complete packet remains
`grant-reviewer-packet.json`; its accompanying manifest and operation file are
also available individually.

**Export profile** carries the original requests, workflow installation and run,
complete customer identities and immutable host-binding history. The receiving
operator imports that history into its own retained Console, then receives the
original files from the selected export. After a host change, **Host → Review
host** compares the actual configured tools and declarations before the operator
saves the displayed binding.

The [complete Reviewer Customer Delivery guide](../../stellar-forge/mcp-merchant-operator/console/CUSTOMER_REVIEWER.md)
includes the exact recipe inputs, response recovery, full-file controls and
original native receiving continuation. The
[Merchant operator Applications guide](../../stellar-forge/mcp-merchant-operator/console/APPLICATIONS.md)
covers saved launch, current private Open, drained Stop and cold reopen.
