# Merchant financial reviewer walkthrough

Follow one merchant's useful service and original customer records from setup through payment, correction, account close and receiving. The finished handover explains what was sold, what the customer received, which money moved, what remains due and how the next operator continues the same work.

Use the actual selected merchant, customer, source files and account period throughout. The installed product keeps the original network transfers, commercial valuations, issued documents, bank observations and service activity available together. This guide follows the existing applications and their saved records.

## Choose the working edition and account

The public financial integration is [PR2583, merge 8aed042e](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2583). Its 139 changed paths join invoice collection, refunds, customer credit, bank receipts, payment plans, service agreements, customer closing and Xero with the original merchant accounting host. The same release exposes 46 receivables operations through the existing merchant MCP interface.

The maintained product also includes the complete [Bank statement reconciliation application](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/e57a359966f093f483a1aa5f4c2dac28566b6a5c/products/merchant-bank-statements/README.md), with original statement balances, fees, remittances and account-close editions. Select the complete maintained source that contains the applications needed for the chosen customer task. The package's manifest and saved Runtime review identify that source and its dependencies.

| Open in the installed product | Work performed | Original state to retain |
| --- | --- | --- |
| Grant purchase reviewer | Open the existing paid example and read its complete saved result. | Purchase packet, quote identities, returned bytes and reviewer directory. |
| Merchant accounting | Review the merchant's original source, native transfer, delivery and reconciliation. | Accounting workspace, configured outbox, proofs, terms and saved report. |
| Merchant receivables | Issue the customer's invoice, receive or apply money, credit or refund, and continue collections. | Customer UUID, invoice and receipt records, dated allocations and original request IDs. |
| Customer payment plans and Xero customer handovers | Agree collection dates and receive the accountant's original document outcomes. | Same accounting workspace, schedule editions and Xero package family. |
| Bank statement reconciliation | Match actual bank movements, fees and existing customer money; retain a period close. | Original account and statement files, posting coverage and close editions. |
| Bank accountant receiving | Inspect the retained close and source/customer lineage, compare corrections, retain findings and hand over the whole review. | Exact original close TARs, private review editions, original edit requests and complete receiving bundle. |
| Customer statements | Explain prepaid service activity and issue or resume the customer's closing cycle. | Original merchant connection, capture sources, saved cycle and complete customer packet. |

The accounting directory has one writer. Use the companion views of the running service together. To move that directory to another saved Application or a direct command, stop its current owner through the existing lifecycle and reopen the same directory. The customer-closing workbench uses the existing merchant MCP owner.

## Open the delivered customer billing case

The completed [portable customer handover](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/eaa169825c48c5ec3cef260672dc8fa52deb5e12/stellar/scf_2026/commercial_milestone_handover_20261012/PORTABLE.md) supplies a concrete starting account. Its version-1 archive retains the full 243-file application, the original native accounting workspace, both saved planning cases, customer working files and the portable opening/repacking commands. The original native and independent receiving operation completed on the desktop and 390-pixel customer billing views.

Use the delivered **SCF_Customer_Billing_Portable_Complete_20261012.zip** and its included openers. The complete archive is 11,158,060 bytes with SHA-256 **a1579acfd1a1ac9f6c3597fb7ed341d37257a9bcea8a5427a51875d59f6eb834**. On Linux with Python 3.11 or later and Node 22 or later:

~~~sh
python3 -B open-portable-commercial-handover.py inspect \
  /absolute/private/SCF_Customer_Billing_Portable_Complete_20261012.zip

python3 -B open-portable-commercial-handover.py open \
  /absolute/private/SCF_Customer_Billing_Portable_Complete_20261012.zip \
  --root /absolute/private/customer-billing \
  --sha256 a1579acfd1a1ac9f6c3597fb7ed341d37257a9bcea8a5427a51875d59f6eb834
~~~

The chosen root's parent must exist. Open the private access page printed by the launcher. Choose **Delivery operations → Customer billing**, the retained case and its **Freeform Solutions** schedule. Follow the original invoices, receipt and allocation:

| Original operated example | Retained outcome |
| --- | --- |
| First USD 4,400 milestone | Invoice Paid, original USD 4,400 receipt allocation, amount due 0. |
| Later USD 4,400 handover milestone | Invoice Open, amount due USD 4,400. |
| Planning and accounting receiving | Both original planning databases and the full account survived repack, independent cold receiving and reopening. |

Add **--case receiving** when opening to select the independently received planning case. Repeated opening continues the same private working root, including later edits. After closing its services, the original **repack** command produces the next complete edition from that current account and both planning databases. The linked portable guide includes the full receiving and later-move commands.

These saved values describe the completed customer operating example and its original account records. The application measures independent adoption and paid Stellar use through its existing customer and purchase registers.

## 1. Set up the merchant's installed workspace

Build the selected source through the existing distribution builder. This example selects the complete receivables, quotation, payment-plan and accountant workflow:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection merchant-receivables-xero --out /private/finance-release
~~~

Retain the returned archive and SHA-256. Prepare and open it through the original runtime installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/finance-runtime \
  --archive /absolute/returned-package.tgz --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/finance-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/finance-runtime --load --source
~~~

The installer selects the original declared package versions and retains their lock. Its `resume` operation continues an interrupted preparation. Use the [bank installation guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/e57a359966f093f483a1aa5f4c2dac28566b6a5c/products/merchant-bank-statements/INSTALLATION.md) when the chosen customer task includes that complete bank application.

The examples below use the installed `starforge` command. The installer runs the same command in its retained package layout:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/finance-runtime -- receivables help
~~~

For a new accounting workspace, select the merchant's actual source outbox, verification directory and accounting terms. Keep the state directory separate from those inputs:

~~~sh
starforge receivables serve \
  --directory /private/merchant/accounting \
  --outbox /private/merchant/source/outbox \
  --proof-dir /private/merchant/source/proofs \
  --terms /private/merchant/source/terms.json \
  --port 8448
~~~

For an existing account, retain its saved source configuration and open that same accounting directory. Open the URL printed at startup. In **Settings**, save the issuer's billing identity, document prefixes and payment instructions. In **Customers and statements**, select or create the actual customer, billing address and reference. Reuse that customer's UUID through the invoice, receipt and export.

To manage the installed application, use the original Runtime workspace:

~~~sh
starforge runtime-workspace init --workspace /private/finance-operator

starforge runtime-workspace attach \
  --workspace /private/finance-operator \
  --runtime /private/finance-runtime --label "Merchant finance"

starforge runtime-workspace serve \
  --workspace /private/finance-operator --port 8465
~~~

In **Applications**, review the installed runtime and original accounting directory, then **Save → Start → Open** the selected merchant application. **Xero customer handovers** serves its original invoice, payment-plan and customer-statement companion routes under that same accounting owner.

**Ready to continue:** the operator can identify the installed source, workspace UUID, actual input paths, issuer and selected customer in the application.

## 2. Start with the useful paid result

For the selected merchant's own demonstration, open the customer's recorded purchase in **Buyer results** and the matching original merchant accounting event. Review the exact source/query, agreed population or period, price, network, asset, result and fulfillment together.

The **grant-reviewer** selection supplies the already operated bundled reference for this opening step. Prepare that selected runtime through the same original builder and installer, with its own release and runtime directories, and attach it to the existing Runtime workspace. Its source command is:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection grant-reviewer --out /private/grant-reviewer-release
~~~

Use the returned archive and source hash in the same prepare/install/inspect workflow above. In **Applications**, choose **Grant purchase reviewer** from that attached runtime, review its private workbench directory, then **Save → Connect → Start → Open**. The direct entry is:

~~~sh
starforge grant-demo workbench \
  --dir /private/merchant/grant-review --port 0
~~~

In **Packet intake**, choose **Review bundled purchase**. Open **Source and query**, then **Receive this packet → Open original Buyer → Buyer results**. Select each original quote and choose **Read complete saved result**.

The bundled successful HPD result contains 100 rows, 14 columns and 53,468 bytes; its retained truncation flag is true. The original 4,733-byte error result belongs to the earlier indeterminate quote and remains separately readable. A different completed Queens HPD acquisition received its full 144-row task in two paid pages. The [original reviewer guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/0c422d12288849eb38466b4e36e9288e4383d0e8/products/grant-reviewer/OPERATING.md) supplies the saved-packet and cold-receiving procedure.

In **Merchant accounting → Sources**, open the chosen merchant's actual outbox, verification files and accounting terms. **Reconcile current sources** retains a complete source snapshot. Open the resulting event, native transfer, full delivery record and customer/order binding.

Native asset units and merchant-supplied commercial valuation have their own fields. The original transaction fingerprint joins the transfer on its selected network. A saved output, another read of it and a later customer statement continue that same purchase.

**Ready to continue:** the useful output opens completely, and its recorded commercial and native identities are visible in the original purchase and accounting records.

## 3. Turn the accepted service into an issued invoice

An installation or service obligation begins with the customer's actual accepted scope. In **Merchant support**, open the original quotation and recorded response. Retain the complete quotation and its selected response files.

In **Invoices and payments**, import those originals, map the accounting customer and choose the intended charge. **IMPLEMENTATION** selects the one-time lines. **RECURRING** selects the original recurring lines with an explicit positive period count and period label. An accepted service-agreement calendar can prepare the original period's draft through the same invoice writer.

Review the quote edition, customer response, quantities, unit prices, discounts, taxes, commercial currency and decimal precision. The issue date, due date and service period answer different questions and stay explicit. The source review retains the original quote lines, calculations and rounding differences. A manual invoice uses the same complete review with the operator's actual supporting source.

If this merchant enabled **Customer credit**, inspect the saved policy and current assessment before release. The decision shows the selected draft alongside the customer's current and future obligations, overdue or disputed balances, and available receipts. Record the actual decision and reason. The invoice issue uses that reviewed account and policy basis.

**Save draft → Review → Issue** freezes the numbered invoice with the issuer, customer, dates, payment instructions and exact amounts. Download its original JSON, line CSV, printable HTML and manifest. Later account changes remain visible alongside that issued document.

**Ready to continue:** the invoice has its original number and files, retained source/acceptance, actual dates and a dated amount due.

## 4. Receive the payment against the original obligation

Choose the route the customer actually used. The receipt records received money; an allocation states how much of that receipt applies to an invoice and from which date. The unused portion remains in that customer's account.

### Stellar wallet collection

In the invoice's **Stellar payment requests**, select the part of the balance to collect. Review the merchant destination, network, asset and issuer, memo, expiry and payer constraint when selected.

`invoiceAmount` is the commercial value applied to the invoice. `stellarAmount` is the exact transferred asset amount, at up to seven decimal places. Preserve the agreed `valuationNote` whenever those units differ.

Issue the reviewed request and open its original **payment-request.html** and **payment-request.uri**. The customer reviews and signs those terms in their selected wallet. Record the returned transaction hash against that issued request, then choose **Receive**.

The original verifier checks the network, successful operation, destination, asset, received amount, memo and ledger time. Fee-bump outer and inner hashes remain aliases of the same transfer. Public-network receiving retains the original customer receipt and eligible allocation; the test-network path displays its original **TESTNET_VERIFIED** observation and proof.

If a payer or invoice reference was entered incorrectly before verification, use the original noted correction in that saved return and inspect the resulting history. The reported transaction stays in its original record. A verified or receipted transfer retains its established financial assignment.

### Bank payment or another recorded receipt

Open the original receipt or source payment first. Retain the actual received date, method, reference, currency and amount. Select the invoice and its allocation amount and effective date.

A bank observation that refers to an already recorded payment matches that receipt. A customer payment spanning several invoices uses explicit allocations; a bank credit spanning several customers uses the original reviewed split-posting flow in **Bank statements**.

When a completed native accounting event supplies the receipt, select that original report/event and retain its network, transaction, asset and atomic amount alongside the chosen commercial valuation.

**Ready to continue:** the receipt, original source, invoice allocation and remaining customer funds agree at the selected accounting date. The source and invoice remain downloadable.

## 5. Return customer funds or move paid credit

Open **Customer funds** for the same customer and currency. Select the original receipt, the actual reason and the intended refund or credit movement. The preview shows allocated, reserved, refunded and available amounts before and after the proposal.

A credit note changes the issued charge. Select the original invoice lines and explicit net/tax amounts, review and issue the credit. When an already paid invoice is credited, the original paid allocation may need a dated release before the receipt can fund the refund or another invoice. The desk reviews that release and any remaining replacement allocation as one conserved change.

For a completed refund, record its actual method, reference and payment date. For a **Stellar wallet** refund, review the merchant paying account, customer destination, network, asset and exact value before issuing the retained wallet request. Reserved customer funds and the later verified payment remain visible in the original request history. The original verified payout or refund-adjustment path can receive a payment that already has native proof.

**Move credit** applies the same retained customer receipt to selected outstanding invoices. Review the target amounts and dates. Any remainder stays available in the account.

A corrected recorded refund retains the original reversal and linked replacement. The actual payment date and effective accounting correction can differ; inspect both. Saved refund files contain the original receiving record, customer documents and native proof.

**Ready to continue:** the customer account explains the credit, released or replaced allocations, refund or transfer, remaining funds and every original source record.

## 6. Reconcile the bank period

Open the selected original bank account and actual statement period. The receivables **Bank statements** desk and the maintained **Bank statement reconciliation** application use the same payment/source relationships. The installed bank selection opens **/bank-statements/**; its companion invoice, customer and payment-plan views share that original accounting owner. Select **Remittance receiving** at **/receivables/remittances.html** for a customer's complete payment-and-invoice allocation CSV.

Receive the complete CSV, OFX/QFX or selected MT940 source through its original parser. Review the actual account section, currency, date convention, opening/closing information and parser report. CSV uses an explicit column mapping. MT940 retains its selected envelope, encoding, debit/reversal convention, year window and value-date basis.

Match each source movement to the existing receipt, refund or other cash record. For new customer money, review the complete split and original invoice allocations. A partial correction preserves the other source portions and the customer's remaining receipt.

The documented bank workflow can match a 97.00 bank credit to a 100.00 customer receipt plus a separate -3.00 fee in the same currency. The invoice keeps its 100.00 payment allocation. That gross/net relationship remains explicit in the bank posting instead of changing the original customer charge.

Use the retained account and inclusive period to review its close. Inspect opening balance plus selected posted movements against the actual closing balance, together with outstanding matching and source work. Retain the reviewed close with its transaction/posting CSVs, original statements, readable reconciliation, editable account data and customer exports.

A later correction reopens the affected close and creates a reviewed successor. Earlier close files remain available. The original bank operation reported a 150.00 close and its corrected 155.00 successor; the [worked account guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/e57a359966f093f483a1aa5f4c2dac28566b6a5c/products/merchant-bank-statements/EXAMPLE.md) identifies that same example and its original sources.

**Ready to continue:** the reviewer can trace a bank row through exact posting coverage to customer money and a retained account-close edition.

## 6a. Receive the complete close in the accountant's private review

The accountant works from the exact retained Bank close and its original statements and customer documents. In **Close statement**, open the retained close and download **account.tar**. The existing Bank command exports the same file:

~~~sh
starforge bank-statements file --directory /private/merchant/accounting \
  --kind close --id ORIGINAL_CLOSE_UUID --name account.tar \
  --out /private/accountant/original-bank-close.tar
~~~

Select a runtime that includes the [complete accountant receiving application](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/e7da0a7f1aff44d44398498063df2d2d9e97684b/stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/bank-statements/accountant-receiving/ACCOUNTANT_RECEIVING.md). Its **bank-accountant-receiving** selection carries the whole browser, native command, types, guide and manual operating course through the existing builder and installer. A complete Bank runtime mounts the same application at **/bank-statements/accountant-receiving/**.

### Inspect the original close and its financial sources

Open **Bank reconciliation → Accountant receiving**, or run the separately installed reader:

~~~sh
starforge bank-accountant serve --port 8458
~~~

Choose **Receive original files** and select the complete Bank close TAR. The reader verifies the exact Bank file manifest, member lengths and digests, original account/period/currency and retained close basis. It also verifies the nested customer archives and original documents. Keep the original files with the review.

Select the **Original close edition**. In **Transactions**, open **View lineage** on the actual movement being reviewed. Read its statement source and interpretation, exact bank amount, posting parts, matched receipt or refund, allocation history and original customer documents together. A gross customer receipt, net bank credit and separate fee retain their original amounts and units.

In **Sources and files**, download the unchanged original statement or any retained document needed for the review. In **Customer accounts**, inspect the customer snapshot at the close's retained account date. A later customer account belongs to its own later source edition.

### Retain the accountant's findings

Choose **Add review note** on the original close, transaction, posting part, statement source or customer. Enter the actual reviewer, note, status and edition summary. **Open**, **Question**, **Examined** and **Resolved** describe this private accountant review. Each note remains bound to the original archive and record.

Choose **Retain review edition**. The saved edition contains the complete note set, its reviewer, time, summary and digest. **Review edition** opens earlier retained sets. A live typed draft remains separate until retained; save it before exporting the handover. If another browser window advanced the same desk, choose **Reopen saved review**, inspect the current edition and continue the preserved draft.

The browser's private store belongs to its current browser profile and address. Export the full review before changing computers, profiles or the server port. The native alternative keeps the same review in an explicit private directory:

~~~sh
starforge bank-accountant create \
  --directory /private/accountant/close-review \
  --name "Selected merchant close review" \
  --archive /private/accountant/original-bank-close.tar

starforge bank-accountant show --directory /private/accountant/close-review

starforge bank-accountant note \
  --directory /private/accountant/close-review \
  --archive ORIGINAL_ARCHIVE_SHA256 --kind TRANSACTION \
  --id ORIGINAL_TRANSACTION_UUID --status QUESTION \
  --note-file /private/accountant/source-question.txt \
  --actor "Accountant name" --summary "Review of selected original movement" \
  --request ORIGINAL_EDIT_REQUEST_UUID
~~~

Use the actual archive digest, transaction identifier, reviewer and request UUID. Retain the same request and unchanged values when recovering an uncertain note write. The native command requires Node.js 22 or newer and the ordinary Linux `flock` utility.

### Compare the Bank operator's correction

Send the source-bound question to the responsible Bank operator with the whole review. The operator performs any financial correction in the original accounting workspace, retains the reviewed successor close and returns that close's original account TAR.

Receive the successor through **Receive original files**, select it and open **Compare closes** against the earlier edition. Both selections must refer to the same original workspace, bank account, source identity and currency. Read the actual period labels, balance changes, changed transactions/postings, receipts/refunds, allocations and source imports. Expand the changed original records and download the complete comparison JSON where needed.

For the native private review:

~~~sh
starforge bank-accountant add \
  --directory /private/accountant/close-review \
  --archive /private/accountant/corrected-bank-close.tar

starforge bank-accountant compare \
  --before /private/accountant/original-bank-close.tar \
  --after /private/accountant/corrected-bank-close.tar \
  --out /private/accountant/original-to-corrected.json
~~~

Record the accountant's actual outcome in the next retained review edition. The original financial correction and the accountant's findings each keep their own complete history.

### Deliver and independently reopen the complete review

In the browser, retain the current draft and choose **Download complete review**. This TAR contains the full review and every retained note edition, all exact original Bank close TARs and its complete manifest. The nested Bank sources include the original statements and customer documents.

The native command produces the same portable review and an optional self-contained handover:

~~~sh
starforge bank-accountant export \
  --directory /private/accountant/close-review \
  --out /private/accountant/complete-close-review.tar

starforge bank-accountant prepare \
  --directory /private/accountant/close-review \
  --out /private/accountant/complete-close-handover
~~~

The handover contains **reader.html**, **review.tar**, full source, operating instructions and a file manifest. The recipient opens reader.html and receives the adjacent review.tar, or uses the included local serve command when their browser restricts file-origin storage. An independent native receiver uses:

~~~sh
starforge bank-accountant receive \
  --bundle /private/received/complete-close-review.tar \
  --directory /private/received/close-review

starforge bank-accountant show --directory /private/received/close-review
~~~

The recipient opens the original close, selected note edition, source statement and customer document, then continues the agreed review action. Compatible later reviews advance the same private history. A divergent browser return uses **Receive parallel review**, preserving both full branches; a divergent native return receives into its own private directory.

Each original close may be at most 128 MB, with up to 24 close archives inside the review's 384 MB complete-export limit. The reader checks the complete projected TAR size before saving an added archive or note edition. Keep the whole exported file for delivery.

**Ready to continue:** the receiving accountant can reopen the original close and financial lineage, compare its actual corrected successor, retain their findings and return a complete independently readable review. The original merchant accounting owner remains responsible for the financial records.

## 7. Schedule and follow up the remaining balance

In **Payment plans**, select the issued invoice and actual balance date. Enter the agreed dates and exact installment amounts, or use **Generate installments** and edit its proposed dates.

Save the draft, inspect the full account basis and activate the reviewed edition. Each edition retains **schedule.html**, **schedule.csv**, **schedule.json** and **manifest.json**. Earlier customer schedules stay readable after a replacement or dated cancellation.

The collection view separates overdue, due-today, upcoming, after-horizon, unscheduled and credit balances by currency and precision. Effective payments cover the earlier remaining installments; credits reduce later amounts; releases restore their original invoice amount. The schedule distributes the existing obligation across dates.

Use **Collections** for the invoice's actual owner, follow-up, customer contact, promise and dispute history. **Cash planning** combines the retained remaining invoices, effective schedules and original promises into a reviewed dated scenario. Inspect changed source bases, assumptions and available customer funds before saving it.

**Ready to continue:** the selected schedule and follow-up explain when the original remaining amount is expected, with the actual receipt and issued balance still available.

## 8. Close the customer's account and service period

### Dated invoice account

Choose the actual as-of date. Review issued invoices, credit notes, received funds, effective allocations/releases, refunds and available credit. Keep each currency and precision separate. A historical view uses its effective dates while later corrections remain in history.

Download the complete dated customer account, including original issued documents, receipt advice, correction relationships and allocation history. The recipient can trace the selected balance to those files.

### Publish the account and receive the customer's original response

Use **Receivables → Customer accounts** on the same running accounting owner. Select **Publish account**, choose the original customer and account date, then **Review complete operation**. Inspect the actual invoices, amounts by currency and complete file count before **Publish reviewed account**.

Download **Complete customer account**, extract the entire TAR and open `customer-account.html`. Keep its original `documents/` directory and filenames together. The customer can inspect the dated account, original invoices and credits, payments and source files. Use **Respond** beside the original invoice to prepare a message, payment promise, dispute or reported-payment reference. Save the entry and select **Download complete response**; its complete JSON is the original return to receive.

For the retained Freeform Solutions billing example above, choose the actual later invoice from that saved account. Its displayed issued amount, current balance and currency determine the response. Select the actual response and promise dates at operation time. The earlier completed paid/open invoice records remain the example's original baseline while this next customer action is prepared.

Back in the staff desk, choose **Receive response**, select that original JSON, inspect the matched publication/customer/date/author and receive the reviewed source. Open it and select **Review entry**. Review the original published invoice beside its balance at the chosen effective date, then choose the outcome and record the operator's reason.

| Staff choice | Result in the existing account |
| --- | --- |
| Record in the original collection case | Retain the original inbound contact, promise or dispute through Collections. A new case receives its actual owner, priority and follow-up date. |
| Acknowledge or decline | Keep the original entry and complete final reason in the received response. |
| Defer | Keep the reason and leave the entry available for a later decision. |

Explicitly acknowledge a changed account before recording. Inspect any closed case, open promise or unresolved dispute and select the applicable reopen, replacement or resolution choice. Current invoice amount and original case constraints remain visible in the full review. Reported payments retain the customer's source and reference for the original receipt/bank/remittance/Stellar matching step.

Save the reviewed outcome. Open its original case and inspect the linked activity, then download **Complete operator archive**. That archive retains the exact customer response, full staff review, decisions and original account files. Keep it with internal staff records. The separate customer delivery keeps the fixed dated account and offline desk.

**Ready to continue:** the same original account now carries the selected customer's response, its reasoned staff outcome and any original collection event. A saved request can be reconciled after an interrupted reply; a full account backup carries the same source and decision history to the next operator.

Complete [browser, HTTP and native customer-account guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03b310b8998f420dfa4cc71647c054f123073954/stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CUSTOMER_ACCOUNT_RESPONSES.md) and [remote MCP/typed/durable CLI guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03b310b8998f420dfa4cc71647c054f123073954/stellar-forge/mcp-merchant-operator/ACCOUNTING_CUSTOMER_RESPONSES.md) describe the exact fields, files and recovery path.

### Prepaid service closing

In **Customer statements**, use the original running merchant MCP address, accounting alias, named operator and saved closing directory. The installed direct entry is:

~~~sh
starforge customer-closing \
  --directory /private/merchant/customer-closes \
  --url http://127.0.0.1:8787/mcp \
  --workspace accounting --actor operator --port 4419
~~~

The actual merchant connection and access-token environment are retained by the configured application. Open **Customers and service** to inspect the customer's original order assignments and imported service captures.

In **Compose a cycle**, choose the customer, completed accounting run and original opening/closing captures for each pass. Inspect the capture times and period, review the native statement and prepare the saved cycle. Issue it through the original requests, or resume the saved cycle when an earlier reply was interrupted.

Open the issued statement's original files and current lifecycle. A correction keeps the selected statement, customer, source and period linked to its replacement. A withdrawal retains its reason and earlier files.

**Download customer delivery** gives the complete available customer packet. The whole-cycle download keeps the operator's full saved work for another receiving engineer. The packet's register shows completed statements and any remaining rows in that same cycle.

**Ready to continue:** the customer has the dated money account and the original service-period explanation, with separate financial and usage records joined by their real identities.

## 9. Receive the accountant's Xero outcome

In **Xero customer handovers**, use the receiving organisation's actual invoice/credit templates and saved contact, account, tax, currency and date-format mapping. Select the original issued documents and account date, then **Review selected documents → Prepare immutable package**.

Download the original import files and source package for the accountant's established receiving workflow. Retain document numbers, mapping edition and package identity.

Receive the complete original Xero **Invoices** or **CreditNotes** JSON response from that organisation. The desk retains its returned document UUIDs, exact numeric tokens, status, validation results and source pointers. A supplied summary CSV uses its explicitly selected mapping and number/sign conventions.

Open unresolved, rejected, mismatched or conflicting documents with their actual returned reason. Use an eligible linked correction and receive the resulting original outcome. Accepted external identities and all prior returns remain available in the package family.

The Xero status describes that document handover. The merchant's received and refunded money continues through its original receipts, allocations and native/bank sources.

**Ready to continue:** the accountant's original document identities and exact totals correspond to the issued customer records, and the complete package family opens with its source and correction history.

## 10. Resume and hand over the complete operation

For an interrupted mutation, reopen its saved request before editing the draft. The application retained the workspace, operator, original request ID, body and source revision before sending. Read or reconcile that same operation to obtain its recorded result. A changed current record can then be reviewed as the explicit next revision.

Prepare the customer's selected account/statement files and the merchant's full operating transfer. The customer packet supplies its readable issued records and history. The full transfer supplies the private accounting journal, configured outbox/proofs/terms, retained exports, original source files and saved continuing work.

The original accounting backup preserves these together. Stop the accounting owner and external writers, choose a state root containing the actual saved input paths, and use the existing encrypted recovery engine:

~~~sh
starforge merchant-accounting-workspace backup \
  --workspace /private/merchant/accounting \
  --state-root /private/merchant \
  --out /private/backups/merchant-finance \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE \
  --quiesced

starforge merchant-accounting-workspace verify-backup \
  --bundle /private/backups/merchant-finance \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE
~~~

The receiving engineer uses the complete verified bundle, separately managed passphrase environment and original private paths:

~~~sh
starforge merchant-accounting-workspace restore \
  --workspace /private/merchant/accounting \
  --state-root /private/merchant \
  --bundle /private/backups/merchant-finance \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE \
  --quiesced
~~~

Reopen the original customer, invoice files, receipt/credit/refund history, bank close, schedule editions, saved customer account publications/responses, service-close cycle and Xero packages. Continue the original reconciliation for activity after the backup point. The existing restore preserves surviving changes for that review and resumes its own interrupted publication.

For the bundled Buyer example, **Handover → Close Buyer and export packet** drains its original writer and exports the retained purchase. Another operator reviews and receives the complete packet under their own private workbench and reads the same original results.

**Receiving is complete when** the next operator opens the original records and files, understands the selected balances and periods, and completes the agreed next customer action in that restored application.

## Use the same workflow from the merchant agent

The original `merchant_accounting_receivables_*` family supplies 46 operations in the merged public financial edition. The [complete native interface guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/8aed042e255201c352564753caa3af69b46e82db/stellar-forge/mcp-merchant-operator/ACCOUNTING_RECEIVABLES.md) lists their real inputs, full previews and file selectors.

Use the installed merchant runtime that lists **merchant-accounting-receivables** in its source registrations. The original **receivables-agent** contribution and **customer-closing** contribution declare those client/application commands. Select that runtime in Applications or invoke its declared command against the same original merchant owner:

~~~sh
starforge merchant-accounting-receivables sources \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN

starforge merchant-accounting-receivables status \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN
~~~

Its durable **prepare**, **execute** and **reconcile** operations retain the connection, original body and request ID in the selected private operation directory. Invoice issue, wallet creation and financial corrections use the same native previews as their operator workflow. Retained file reads carry the selected original read ID, complete byte count and digest through every chunk.

An agent completes the customer's useful task through the existing account and file APIs, then returns the full readable customer output. The source-selection registrations identify the actual installed commands and exports.

### Publish, receive and review the same customer account

The maintained remote continuation is [PR1104](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/1104). Use the existing merchant endpoint and workspace alias; the complete account/response workflow joins that same owner. It offers `customer-account-preview`, `customer-account-publish`, `customer-response-preview`, `customer-response-receive`, `customer-response-detail`, `customer-response-review-preview`, `customer-response-review` and `customer-account-list`.

Save the full preview for each of the three writes. The original private selection files retain the chosen publication/customer/date or response/entry/version and actual review choices. For original customer intake, select its saved publication and use the returned file directly:

~~~sh
starforge merchant-accounting-receivables customer-response-preview \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN \
  --request /private/account/response-selection.json \
  --source /private/account/customer-response.json \
  --out /private/account/response-preview.json

starforge merchant-accounting-receivables prepare \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN \
  --dir /private/account/receive-operation --action customer-response-receive \
  --preview /private/account/response-preview.json --actor "$MERCHANT_OPERATOR"

starforge merchant-accounting-receivables execute \
  --dir /private/account/receive-operation
~~~

`response-selection.json` contains the original `publicationId`. The original file is read as complete UTF-8, up to 1,500,000 bytes, and remains embedded in the saved intake review and request. After an interrupted reply, use `reconcile --dir /private/account/receive-operation`; a retry executes that same saved operation. A later entry decision follows its own complete review preview and retained request.

Download the customer package with `kind:"receivables-customer-account"`, its `publicationId` and `file:"account.tar"`. Download staff history with `kind:"receivables-customer-response"`, its `customerResponseId` and `file:"response.tar"`. Both use the original retained-file reader, full byte/hash identity and release lifecycle.

The [complete guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/03b310b8998f420dfa4cc71647c054f123073954/stellar-forge/mcp-merchant-operator/ACCOUNTING_CUSTOMER_RESPONSES.md) supplies publication and decision commands, all original input shapes, typed helpers and full recovery instructions. Use the installed source selection that includes this merged continuation when receiving the same workflow into another runtime.

## Present the result and connect it to the award

Start with the useful acquired output. Show the matched merchant source, then the customer's actual invoice and payment. Use its credit/refund and original bank movement to explain the resulting balance. Open the retained customer close and accountant result, then let the receiving operator reopen and continue the same work.

| Reviewer question | Show in the existing application |
| --- | --- |
| What useful task did the buyer buy? | Exact approved request, selected population/period and complete output. |
| How does Stellar matter? | Original native authorization/transfer, network/asset/amount and the bound merchant fulfillment. |
| Can the merchant explain the money? | Issued obligation, actual receipt, effective allocation, refund and exact bank coverage. |
| Can the customer understand the ongoing service? | Original pass captures, reviewed period statement and complete customer account. |
| Can another operator maintain it? | Saved source/runtime selection, original request recovery, full transfer and continued customer action. |
| What will the grant add? | The selected independent installations' remaining source/receiving adaptation, native deployment, monitoring and recovery inside the existing six packages. |

The submitted financial explanation is self-contained in the [primary application](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar-forge/developer-site/dist/grant-data/application.md) and [complete financial chapter](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar-forge/developer-site/dist/grant-data/product-and-finance.md#merchant-settlement-customer-billing-and-accountant-receiving). The operating guide gives the presenter and receiving engineer the concrete route through those claims.

The existing proposal remains **$38,000 / 400 prospective hours / 150 days**. T1 adapts the two selected merchants and buyers and their actual source/authority handover. T2 deploys both selected facilitators and the original threat-response/monitoring work. T3 delivers recurring independent mainnet use and full receiving/recovery. The shipped accounting product is the starting foundation.

The existing development baseline remains **18 team-operated purchases / 411,000 stroops / 0.0411 native XLM**, with fees separate. One original purchase, its invoice collection, later installments, service usage and exported files retain their respective economic identities in the application. Outcome measurement follows the existing distinct approved purchase and complete useful-output definition.

## Original source and receiving programmes

| Source | Exact scope |
| --- | --- |
| [Public financial release](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/8aed042e255201c352564753caa3af69b46e82db) | The merged 139-path integration with 46 receivables MCP actions and complete browser, HTTP, CLI and installed financial joins. |
| [Maintained bank product](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/commit/e57a359966f093f483a1aa5f4c2dac28566b6a5c) | Original bank statements, exact gross/net/fee coverage, remittances, correction, account closes and complete customer/accountant handover. |
| [Complete Bank accountant reader](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/e7da0a7f1aff44d44398498063df2d2d9e97684b/stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/bank-statements/accountant-receiving/ACCOUNTANT_RECEIVING.md) | Merged PR1149 complete archive and financial-lineage reader, corrected-close comparison, private review editions, native CLI, full offline handover and independent receiving. Its original-close operating course uses the existing account TARs. |
| [Completed customer billing handover](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/eaa169825c48c5ec3cef260672dc8fa52deb5e12/stellar/scf_2026/commercial_milestone_handover_20261012/PORTABLE.md) | Complete portable 243-file application and the original account with two planning cases; paid/open invoice states, independent receiving and later repacking through the source-owned opener. |
| [Current financial source capsule](https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/18a23dfbf4031713d0e68918fe6687ff82d638fc) | 275 source files / 5,105,857 JSON bytes, including the merged financial overlay and unchanged original receiving programmes. Source SHA-256: f8ae4e2075a123dc220d7fe5d8f0b40c536c85165deab5ba58cc48daf9a18cfb. |
| Original PAYMENT_CHECK.mjs | Git blob 9020c4e40784b676fbc57d0fc1c7c58580be6474, 15,841 bytes; original invoice-wallet programme. |
| Original MCP_RECEIVABLES_CHECK.mjs | Git blob 568669a6e3de268aa34c4aa17427582585c4fcf9, 26,247 bytes; original merchant-interface programme. |
| [Complete financial operations](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/8aed042e255201c352564753caa3af69b46e82db/products/merchant-workspace/FINANCIAL_OPERATIONS.md) | Full original installed procedures, source directories, dated balances, plan/Xero behavior and encrypted operating recovery. |

The original programme identity is `SCF-MCP-RECEIVABLES-COLLECTION-2A51-20261012`. Its existing receiving operation retains the selected source, original programmes and returned runtime result. The complete installed customer-account operation retains its own package and saved account. Source capsules support those existing operations; the product's original complete builder and runtime installer produce the selected installed application.

The complete financial chapter retains the original completed invoice, Xero, accepted service-renewal and bank account examples with their selected sources. Follow their original returned account and package when presenting that example.

Official references: [Stellar x402](https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar), [SCF submission criteria](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/submission-criteria), and [Build budget and deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines).
