# Merchant receivables and service billing

Follow the [complete merchant financial workflow](../merchant-workspace/FINANCIAL_OPERATIONS.md) for original Stellar reconciliation, customer billing, dated payment plans, Xero handover and full operating recovery in this same accounting workspace.

Operate a merchant's complete invoice and customer-payment cycle in the original private accounting workspace. The product brings customer records, service quotations, issued invoices, payment allocation, credit notes and dated account delivery into one installed operator.

The maintained `merchant-receivables` selection includes the invoice and quotation workflow, service-agreement calendars, typed HTTP and MCP clients, Stellar wallet collection and refunds, customer payment plans, collections casework, cash planning, Xero handovers and customer closing. Their original commands, explicit package exports and managed Applications adapters are included. It uses the existing accounting writer and customer UUIDs, the SF74 quotation engine and the source distribution's installation, lifecycle and recovery. `starforge registrations` shows the inventory in the installed source edition.

## Install the selected product

Use the current maintained repository and an exact commit that contains [the receivables selection](../../stellar/scf-starforge-20261009/distribution/selections/merchant-receivables.json). The source builder packages that commit through the existing Git reader, original browser manifests and dependency collector.

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection merchant-receivables --out /private/receivables-release
~~~

Use the archive path and SHA256 returned by that command. The retained output belongs to that source commit and selection. To continue the same output after interruption:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --out /private/receivables-release --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /private/receivables-release --status
~~~

The original Runtime workspace also discovers this recipe in **Build a product**. Select **Merchant receivables, service billing and collections**, review its exact source, then open the completed archive in **Source & profile**. The package version includes both the source commit and `selection.merchant-receivables`.

The complete installed accounting, quotation and managed-operator profile uses the existing Linux runtime: Node 22.16+, Python 3.11+, npm, `flock` and the original archive utilities. Prepare the selected original dependencies through the maintained installer:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/receivables-runtime \
  --archive /absolute/returned-package.tgz --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/receivables-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/receivables-runtime --load --source
~~~

The native feature equips the existing Stellar verification/recovery paths; schema and OpenAPI belong to the original source and quotation-support workflows. The MCP feature equips the original merchant agent host and its HTTP and stdio interfaces. The installer selects their actual declared versions. An already retained matching dependency graph can be received with its original lock and the installer's `--adopt-existing` option. Use `resume --dir /private/receivables-runtime` to continue that same prepared installation.

The installed package stays in `/private/receivables-runtime/package/`, beside the selected `node_modules/`. Run its original command through that layout:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/receivables-runtime -- receivables help
~~~

The remaining examples use the installed `starforge` command. The same arguments can be passed after `runtime-install ... run --`.

## Connect the original accounting workspace

An initialized accounting workspace is reopened using its existing directory:

~~~sh
starforge receivables serve \
  --directory /private/merchant/accounting --port 8448
~~~

For first initialization, select the merchant's actual source outbox, proof directory and accounting terms. Keep the accounting directory outside those input directories:

~~~sh
starforge receivables serve \
  --directory /private/merchant/accounting \
  --outbox /private/merchant/source/outbox \
  --proof-dir /private/merchant/source/proofs \
  --terms /private/merchant/source/terms.json \
  --port 8448
~~~

The original initializer validates the selected private paths and terms before saving. Existing records keep their actual customer, order, report and source identities.

Open the printed local URL. **Customers and statements** opens the original customer manager in that same process. Add or update the customer's billing address, reference and contact details there. Back in receivables, save the issuer name, document prefixes and payment instructions in Settings. The same customer UUID is used for quotations, invoices, receipts and account exports.

In the existing Runtime workspace, attach this installed runtime and use **Applications**:

~~~sh
starforge runtime-workspace init --workspace /private/receivables-operator

starforge runtime-workspace attach \
  --workspace /private/receivables-operator \
  --runtime /private/receivables-runtime --label "Merchant billing"

starforge runtime-workspace serve \
  --workspace /private/receivables-operator --port 8465
~~~

Choose **Merchant receivables**, select the initialized accounting directory, and use Review, Save, Start and Open. The source-owned adapter binds the original workspace ID and source configuration and rechecks them inside the accounting lease. **Merchant accounting** opens the maintained reconciliation/connection workflow; **Merchant support** opens the existing cases and quotation workflow. The service-agreement application operates accepted recurring calendars and creates their original invoice drafts. The receivables Xero application opens customer-document mapping, native import results and corrected handovers. Their source-owned application entries appear in the installed registrations.

One process owns an accounting directory at a time. Use the running process's customer, receivables and **Payment plans** views together. **Customer payment plans** in Applications opens the same combined server directly at its collection desk. Stop that process through its original application before opening the directory with another owner.

## Close customer statements from the merchant connection

**Customer statements** in Applications opens the complete customer closing workbench included in this merchant receivables package. Select the original running merchant MCP address, its accounting workspace alias, the named operator and a private folder for saved customer closing work. The access token stays in the original environment or a private environment file.

Review, save, start and open that application through the existing Runtime workspace. The original startup records the local opening address with the reviewed merchant connection and saved-work folder. Reopen the same folder after a restart or package upgrade.

~~~sh
starforge customer-closing \
  --directory /private/merchant/customer-closes \
  --url http://127.0.0.1:8787/mcp \
  --workspace accounting --actor operator --port 4419
~~~

Use **Customers and service** to create or edit billing profiles, assign original order references, compare them with a retained accounting run and import configured service captures. Every change is reviewed and saved before application. The same saved request can be reconciled or resumed after an interrupted reply.

Choose customers, accounting runs and the original opening and closing service captures in **Compose a cycle**. Review each customer's complete native statement before issuing the selected closing cycle. Progress, original statement identities and completed files stay available during a resumed close. **Download customer delivery** provides that customer's full original files; the whole-cycle download preserves the complete operator folder for continued work.

Issued statements expose the original customer details, complete history and retained files. Prepare a correction from that original statement to retain its customer, sources and period; withdrawals record an explicit reason while preserving its original files and history. Customer profile edits update the source customer while issued documents keep their original billing details.

The [complete customer closing guide](../../stellar-forge/mcp-merchant-operator/ACCOUNTING_STATEMENT_WORKBENCH.md) covers customer intake, capture configuration, closing cycles, correction, withdrawal, saved-operation recovery, file delivery and the typed interfaces. The workbench uses the original accounting writer through the existing MCP host.

## From service quotation to invoice

The original Merchant support desk creates and retains commercial quotations. Its existing commercial guide and command remain packaged:

~~~sh
starforge merchant-commercial --help
~~~

Prepare the quotation from the selected implementation, service and original pricing sources. Review its original calculation and publish the selected edition. Download the complete retained QUOTE material or QUOTE_JSON. The source case retains the separate RESPONSE material for a chosen customer response.

In receivables, choose those original files, select the existing accounting customer, dates and currency precision, then choose a billing scope:

| Scope | Selected charge |
| --- | --- |
| IMPLEMENTATION | The quotation's one-time implementation lines, charged once. |
| RECURRING | Service and planned route-usage lines multiplied by an explicit positive number of monthly periods and a specific period label. |

For recurring charges, use an explicit label such as `October–December 2026` and a count of three. Enter the intended issue and due dates separately.

The compiler checks the original canonical quote seal, draft and calculation review; complete source line totals; and a supplied response's binding to that exact quote edition. It preserves both original case IDs when a receiving case records the response. The accounting customer mapping is explicit.

The resulting invoice is an editable draft. Review the scope, currency precision, purchase order, tax, dates and individual charges before issue. The full mapping retains original line identifiers, quantities, rates, micro-USD extended amounts, selected periods and each rounding difference. Planned usage keeps its original description. The chosen matching ACCEPTED response appears in the retained quote review.

An implementation charge cannot be duplicated by changing a period label. Recurring imports retain their exact quote, customer, scope, period count and label. The complete original quote, chosen response, calculation source and review are downloadable from the invoice's source record. Later manual edits to the imported draft remain visible.

The original SF74 operating documents are included at:

- [Commercial quotation workflow](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/COMMERCIAL.md).
- [Full commercial receiving](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/RECEIVING.md).
- [Receivables source/operator guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/README.md).

### Quotes with a selected tariff

The same import accepts the original tariff-bearing quotation and its response. **Tariff at quote import** shows the saved selection volume, quoted monthly volume, accepted uniform rate, original tariff total and unit-rounding difference. The service-agreement desk presents the same basis beside each accepted quote edition and its billing preview.

The quoted route amount remains the amount to bill. The original tariff comparison may show a different total when a revised quotation changes its monthly request volume. For example, the [original tariff receiving journey](../../stellar/scf-starforge-20261009/sf74-merchant-support-console/commercial/tariff-receiving-native.mjs) selects 1,250 requests, then publishes a revision for 1,500 requests. That revision retains the saved USD 0.0114 uniform rate and quotes USD 17.10 per month; its separately retained tier comparison at 1,500 requests totals USD 16.50. Selecting two recurring periods therefore imports USD 34.20 at two-place invoice precision.

The importer checks the tariff binding against the quote's selected pricing source, its original file-descriptor identity, scenario plan, selected route, quoted volume and uniform rate. It preserves the source pricing version and the tariff operation's completed pricing version as their separate original identities. The quote's original canonical seal, draft seal, review seal, calculated line totals and matching response are checked by the existing importer.

The complete selected tariff binding is retained in `source.json`, including original material identity and byte hash, both tariff file descriptors, native selection UUID, plan and comparison identities, tier schedule, and the saved-versus-quoted calculation basis. Its associated pricing source retains its original material and five file descriptors. Each selected route line also carries its tariff source and comparison identities. `review.json` identifies the included invoice line, whole period count, original monthly amount and imported charge.

The original `quote.json` and `response.json` bytes remain downloadable beside that source and review. An implementation-only import retains the tariff as quotation context; its selected invoice lines remain the one-time implementation charges. Recurring import includes the original service and planned-route lines for the chosen monthly periods. Later invoice edits retain the import's original source and its visible changed-draft indicator.

Accepted tariff quotations can also supply the [service-agreement calendar](../merchant-service-agreements/README.md). Each period uses that same importer, and the agreement's source JSON, calculation review and complete source downloads carry the tariff through billing and later export.

### Accepted revisions informed by recorded usage

A revised Commercial quote may also carry its original `sourceBindings.performance`. The same import retains this complete binding and joins its explicit proposed monthly volume, target tariff/pricing source, accepted unit rate and original extended amount to the revised quote's route. The measured quote and selected historical tariff keep their own identities; a revision may intentionally choose a different saved tariff.

Both billing operators display the earlier quote, observed period and quantity basis, saved price and tier comparison at that quantity, then the revised monthly volume and accepted charge. The saved native cost view, individual source counts, usage version/revision and full source identities remain available with that review. Billing uses the accepted revised monthly amount for the selected whole periods.

`source.json` retains the native performance source ID, saved review ID/hash, original material and source-file descriptors, measured quote/tariff/selection, observed period/basis, recorded quote/tariff/cost view, original issues and complete proposed pricing fields. `review.json` keeps that same binding and identifies its included invoice line and selected amount. The raw quotation and matching customer response continue through the ordinary source downloads and agreement export. The complete underlying usage export remains in the original Commercial case and its recipient package, addressed by the retained file and material identities.

## Issue and deliver the invoice

Create a manual invoice or continue an imported quotation draft. Monetary fields are decimal strings at an explicit currency precision. Quantities support six decimal places. Line discounts, invoice discounts and tax amounts are explicit.

Save the draft, review its current preview, then issue it. The current customer and issuer details participate in that review. Issuing assigns the configured prefix, issue year and next workspace sequence and creates immutable invoice JSON, a line CSV, printable HTML and its file manifest.

Download the original issued files for the customer's usual delivery channel. The printable invoice displays line and invoice discounts, taxes, dates, payment instructions and the frozen billing identity. Later changes to a customer address or issuer settings leave that issued document's original content intact.

## Review customer credit and release an order

Choose **Customer credit** to configure the merchant's actual terms for a customer and currency, assess a saved invoice draft and retain an approval or decline. The assessment includes current and future issued balances, overdue and disputed amounts, available receipts, invoice credits and the selected order. Explicitly enable only the checks selected by the merchant.

A saved decision binds the original draft, policy edition, account basis and date. **Issue this approved invoice** consumes the matching approval and creates the original numbered document in the same accounting transaction. Source changes require a current review; the earlier decision, reason, operator and downloadable files remain available. The [complete credit-control guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CREDIT_CONTROL.md) covers the browser, typed HTTP client, CLI and interrupted-operation recovery.

## Receive money and allocate it

Record a payment with the accounting customer, currency and precision, received date, method, reference and amount. The ledger distinguishes the payment's total amount from amounts allocated to invoices. A partial allocation leaves the balance available for that customer's later invoices.

Choose the invoice, amount and effective allocation date. The controller requires matching customer and currency and checks both the selected date and all affected later intervals. A backdated allocation therefore preserves money already used by a later allocation.

A native Stellar settlement can be imported from a completed original accounting report. Select the original ledger event and customer order binding, then enter the commercial-currency valuation and basis. The receipt retains the native report, event, transaction fingerprint, asset and atomic amount. Its existing public-network transfer and official RPC verification remain the payment evidence.

Correct an allocation with a dated release and reason. Its original history remains visible and the receipt becomes available from that date. A receipt or invoice can be voided once applicable allocations have been released. A credited invoice retains its issued credit-note history.

## Return customer funds or move paid credit

Open **Receipts** and choose **Refund / credit**, or use **Manage customer funds** on a paid invoice with an issued credit. The desk lists the customer's original receipts, available funds, paid credits, reserved refunds and completed refunds for the selected accounting date.

Choose the original receipt. An unapplied overpayment can fund a refund directly. For a paid invoice credit, enter the exact credited amount to release from its payment allocation. Review shows the remaining payment against that invoice and the resulting receipt balance. The original allocation is retained with its dated release and the exact remaining payment is recorded as a replacement. Every affected later date is checked before saving.

For a refund, choose the actual payment route:

| Route | Operator workflow |
| --- | --- |
| Completed refund | Record the completed payment's actual method, reference and date, then review and save the customer cash movement. |
| Stellar wallet | Review the merchant paying account, customer destination, network, asset, exact transfer amount and commercial valuation. The public-network request reserves the reviewed customer funds. Open the retained wallet request, record its returned hash and receive the original transaction. |
| Original verified payout | Select an original verified return that still needs its customer accounting entry. Review derives its ledger date, sender, destination, asset, memo and native proof from that retained transfer. |
| Original verified adjustment | Select the receipt's unused original verified Stellar refund adjustment and review its commercial value and exact source binding. |

The review displays the receipt's allocated, reserved, refunded and available amounts before and after the change, together with every affected invoice's paid, due and credited amounts. Save that complete review to retain the refund and its original customer documents. Test-network requests and observations are identified in the desk.

**Move credit** uses the same original receipt and credited allocations. Select the actual outstanding invoices in that customer's currency, enter the amounts to apply and review the complete result. A remaining amount stays available in the customer account.

A pending wallet refund can be cancelled with an effective date and reason. The original request and allocation history remain visible. If a payment arrives after cancellation, or a second actual transfer is discovered, retain its hash and receive it against that original request. The customer-funds desk offers the verified unposted payout for a new review when its accounting needs correction. For an operator-recorded refund entered in error, reverse the original and use **Correct recorded refund** to prepare its linked replacement. Keep the actual bank payment date and date the cash correction on the original reversal; both dates and the original documents remain visible.

The customer account export includes original refund and disposition records, customer documents alongside invoices, credit notes, receipts and allocation history. Open **Saved refund files** for the complete original transaction receiving record and individual native proofs. The [refund and credit operating guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/REFUNDS_AND_CREDITS.md) covers browser, HTTP, CLI and merchant-agent operation with durable request recovery.

## Credit a customer and close a period

Issue a credit against original invoice lines with explicit net and tax amounts. Cumulative credits cannot exceed those original line amounts. A credit after full payment appears as a customer credit balance.

Choose the as-of date before reviewing balances, invoice details and aging. Amounts remain separate for every currency and precision. The aging table distinguishes current, 1–30, 31–60, 61–90 and 91+ day balances.

Download the complete customer account TAR, including its issued invoice and credit-note files and manifest. JSON, CSV and printable account views are available independently. Customer exports select issued documents effective on the chosen date and the corresponding receipt references and allocation history.

Useful original commands:

~~~sh
starforge receivables state \
  --directory /private/merchant/accounting --as-of 2026-10-31

starforge receivables detail \
  --directory /private/merchant/accounting --id INVOICE_UUID \
  --as-of 2026-10-31

starforge receivables export \
  --directory /private/merchant/accounting --customer CUSTOMER_UUID \
  --as-of 2026-10-31 --out /private/new-october-account
~~~

Exports use a new output directory. The existing customer statements, accounting pricing, native reconciliation and recovery commands remain available in the same installed selection.

## Schedule and collect an invoice balance

Open **Payment plans** from the running receivables navigation. Choose an issued invoice and balance date, enter its installment dates and amounts or generate equal installments, save the draft, review the complete invoice basis and activate the customer schedule. Every edition retains printable HTML, CSV, JSON and its file manifest.

The desk applies the same recorded allocations, releases and credit notes to the dated schedule. It separates overdue, due-today, upcoming, after-horizon and unscheduled amounts by currency and decimal precision. Revised editions preserve earlier schedule files and historical views; a dated cancellation returns the remaining invoice amount to unscheduled collections.

The [complete payment-plan operating guide](../merchant-payment-plans/README.md) covers schedule preparation, collections, customer files, recovery and the installed HTTP/CLI interfaces. This receivables selection includes that same implementation, command, browser assets and managed **Customer payment plans** application. The `merchant-payment-plans` selection packages the same accounting and quotation dependencies with the payment-plan guide as its product entry.

## Assign collections and retain customer follow-up

Choose **Collections** in the running Receivables application. Its dated queue shows overdue invoices, their assigned cases, owners, priorities and next actions. **Assign follow-up** creates the original invoice's case; **Record contact** retains the actual conversation, occurred date, effective date and source reference. Record a payment promise or invoice dispute on that case, then retain its explicit outcome or resolution.

A promise and a dispute stay attached to the same customer's original invoice. Record an actual receipt, allocation, credit or refund through the existing financial workflow when the account changes. **Prepare customer reminder** uses the dated invoice balance and configured payment instructions. Download the prepared message for the existing relationship, then record the resulting contact. Closed cases retain their history and can be reopened.

The complete queue exports to CSV and JSON. Each case supplies its retained history, dated balance, printable operator report, prepared reminder and file manifest. The [collections operating guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/COLLECTIONS.md) covers assignment, promises, disputes, customer reminders, historical views and native HTTP/CLI operation.

## Plan and compare expected cash receipts

Choose **Cash planning** to create a saved receipt scenario from issued invoices, effective installment schedules and recorded customer promises. Set the account date, final planning date, daily/weekly/monthly periods and timing assumptions. Recalculate and inspect the original invoice sources, available customer funds, separated disputes and amounts requiring a source decision before **Save reviewed edition**.

Every original remaining amount appears once: within the horizon, after the horizon or separated. Open promises replace the appropriate scheduled portion; payments allocated after the promise reduce its eligible amount. A changed historical schedule or promise basis appears for operator review. An invoice-specific expected date or exclusion retains its reason beside that source issue.

**Revise latest edition** recalculates against the current account, while **Copy this edition** prepares a separate scenario. Compare two saved plans or consecutive editions and download their exact currency/date differences. The saved JSON, CSV and printable HTML retain the selected assumptions, source accounting revision, original identities and values. Use the [cash planning guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CASH_PLANNING.md) for the complete workbench and typed interfaces.

## Continue after interruption or upgrade

Each receivables mutation retains the named operator, current accounting revision and original request ID. Draft updates also retain their expected version; issue retains the reviewed preview hash.

When a request's outcome is uncertain, retain that exact pending request. The operator disables another mutation until the original outcome is resolved. If the accounting writer requests reopening, stop and reopen the same original directory, then retry the same request ID and content. The saved accounting journal determines whether it already completed.

An edited draft remains parked when changing selection or importing a quotation, and can be resumed. A stale accounting revision requires reviewing the current saved state before applying a subsequent change.

All receivables state is under the original `workspace.json.receivables`; customer identities remain under `workspace.json.customerStatements`. Issued documents and source-quotation files use the existing private `exports/` tree. The maintained accounting backup captures those files with the workspace.

For an upgrade, prepare a new runtime for the selected new source archive, retain the old runtime and original accounting directory, then use the maintained runtime compare/recovery workflow. Stop the prior owner, review the same accounting binding in the new application, and reopen the existing issued documents and dated account.

## Programmatic interfaces

| Package export | Original interface |
| --- | --- |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables` | ReceivablesWorkspace over an open AccountingWorkspace. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/core` | Exact invoice/credit compilation, balances, aging and customer rendering. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/quote-import` | Pure original quotation/response-to-draft compilation. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/client` | Typed HTTP client for the same operation and file contracts. |
| `@tokenjunkielabs/starforge-merchant/merchant/receivables/server` | Complete loopback server or handler over the existing open workspace. |
| `@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables` | Typed client for invoices, collection, customer files and request recovery through the existing accounting MCP owner. |
| `@tokenjunkielabs/starforge-merchant/merchant/accounting-receivables/operations` | Durable operation preparation, execution, reconciliation and original file downloads. |

Use the actual package name shown by the installed `package.json` and retain the suffixes above. The original distribution exports are explicit; `starforge registrations --source merchant-receivables` prints this product's command, client, browser and Applications registrations.

## Collect an invoice through a Stellar wallet

Open an issued invoice and use **Stellar payment requests** to prepare collection terms. The review binds the request to the original customer, invoice document and current amount due. Choose the public network or test network, the merchant's exact receiving account, the asset and amount in Stellar units, and the amount of the commercial invoice that the transfer will settle. When the asset value differs from the invoice currency, retain the agreed valuation in the request.

Issue the reviewed request, then share its wallet link or original `payment-request.html` document. Each request has its own invoice-bound memo. The operator can issue separate partial collection requests, inspect saved returns, cancel replaced instructions and download the original request and full receiving record.

After the customer sends the payment, record the transaction hash returned by their wallet and use **Receive**. The native verifier uses the original Stellar RPC catalogue and official SDK to check the ledger transaction's network, destination, payer constraint when selected, asset issuer, exact amount, memo and successful operation result. It supports classic payments, strict-send and strict-receive path payments, and fee-bump transactions reported by either their inner or outer hash.

A verified public-network transfer produces an original customer receipt and dated invoice allocation. Both fee-bump hash identities participate in duplicate detection. Full native proof is retained as original private files and hydrated for downloads; the accounting journal keeps a compact reference. Test-network receiving remains visible as a verified test observation. All original invoice documents retain their issued content as payments and balances change.

The [complete payment request guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/PAYMENT_REQUESTS.md) covers browser operation, CLI requests, the typed HTTP client, exact file names and recovery of interrupted work.


## Import and reconcile original bank statements

Open **Bank statements** in the receivables desk to retain CSV, OFX/QFX or MT940 source files and complete customer cash matching. Add the actual bank account and currency, inspect the original account/statement sections and dates, then retain the complete source and parser report.

The row view filters and matches the complete original statement before paging. It shows actual bank references, transaction identities, possible existing receipts, invoice candidates and their matching reasons. One bank credit can split across several customers: create new receipts, link all or part of recorded receipts, or correct a recorded receipt with its original allocation history and explicit accounting date.

Prepare the customer splits and target invoices, then review the complete original posting. The review includes each released and new allocation, the original bank/receipt dates and every affected later customer cash and invoice balance. Posting retains the original source relationships, customer receipts and invoice allocations in the same accounting journal used by the other collection and refund tools.

Original statement bytes, normalized rows, the complete parser report, posting documents and individual customer receipt advice remain downloadable. Customer account exports carry receipt advice and correction relationships. Open and closed statements retain their original dispositions and can be reopened for explicit corrections.

CSV intake uses the original Node reader and an exact column mapping. OFX and MT940 use the retained maintained source parsers; MT940 requires explicit envelope, encoding, debit/reversal convention, year window and complete value-date basis. The [complete bank-statement guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/BANK_STATEMENTS.md) covers source formats, customer splitting, duplicate source resolution, retained documents, all interfaces and interrupted-operation recovery.
## Operate receivables through the merchant agent interface

The original merchant MCP host now exposes the same invoice and collection workflow through 46 `merchant_accounting_receivables_*` operations. A configured accounting workspace supplies the original customers, journal, private exports and source aliases. The agent can import a service quotation, prepare and issue an invoice, create reviewed Stellar wallet instructions, receive a returned transaction, import original bank statements, split and match customer receipts, refund customer funds, move paid credit, apply receipts and deliver the dated customer account in that one owner.

The installed client command uses the host's configured endpoint, workspace alias and access-token environment variable:

~~~sh
starforge merchant-accounting-receivables sources \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN

starforge merchant-accounting-receivables status \
  --url "$MERCHANT_MCP_URL" --workspace "$MERCHANT_WORKSPACE" \
  --token-env MCP_ACCESS_TOKEN
~~~

Use complete native previews for invoice issue and payment-request creation. The client retains the full original document or wallet proposal and its review SHA. Durable `prepare`, `execute` and `reconcile` commands keep the original arguments, request ID, source revision and connection in a private operation directory. An interrupted reply is reconciled against the existing accounting journal; configured quotation aliases reconcile to the exact source bytes archived by the original import.

Native invoice and credit files, quotation sources, preview files, wallet instructions, refund records, original bank statements and parser reports, receipt advice, transaction proofs and the complete customer account are available through the existing retained file reader. Downloads retain their original selectors, read ID and SHA through every chunk. Ordinary client commands drain their own retained reads; `close` explicitly finishes the accounting owner.

The [complete agent interface guide](../../stellar-forge/mcp-merchant-operator/ACCOUNTING_RECEIVABLES.md) includes configured source aliases, customer and issuer intake, an invoice-to-payment workflow, all 46 tools, typed client examples, file selectors and durable operation recovery. Use the original [merchant accounting host guide](../../stellar-forge/mcp-merchant-operator/ACCOUNTING.md) to configure and start that owner.

## Original native exercise

The product includes one complete private-file exercise:

~~~sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/EXERCISE.mjs
~~~

It uses the actual accounting workspace and original SF74 commissioning, quote review, seal and document producer. It creates its own private temporary accounting directory and completes invoice issue, payments and dated allocations, credit, historical release/backdating checks, one-time and recurring quote imports, exact source downloads, customer export, close/reopen and actual HTTP requests.

The same programme is retained under `SCF-MERCHANT-RECEIVABLES-DFF77-20261012`. Its complete 65-member source capsule, including the original license, is Git blob `87452bd68e4208e6d48ed18bcdea24dcf3da1152` in `woahwhattheheck/public-commons-sprint-2026`. The capsule contains the full UTF-8 body and original Git identity for every member. Its selected exercised path uses Node builtins.

[Source lineage](SOURCE_LINEAGE.json) retains the exact adopted public product, original accounting dependency files and existing quotation/customer source identities. The original accounting, SF74, native transfer and distribution owners continue to maintain those components.
Partial bank receipt corrections also preserve cash from the original customer’s other source credits. The desk reviews the corrected portion and remaining receipt, and can allocate that remaining cash to original-customer invoices in the same posting. Agent callers use the same complete proposal and residualAllocations input.

The Xero handover uses these same dated receipts, refunds and credit dispositions. Its package includes the reconciliation schedules and original customer bank/refund advice, with a customer-cash-files.json index retaining the original filenames and file identities. Receipt selection follows the effective accounting date, so corrections appear in the correct customer period.
