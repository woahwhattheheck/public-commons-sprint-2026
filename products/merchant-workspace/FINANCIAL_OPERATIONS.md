# Merchant financial operations

Run the financial side of a Stellar merchant from the existing settlement accounting, customer, receivables, payment-plan and Xero workspaces. This chapter connects their original operating procedures, so an accounts operator and receiving engineer can follow the same customer from an agreed charge through the correct payment record, dated balance and accountant handover.

The installed **Merchant receivables and Xero handovers** selection includes the existing accounting, service quotation and customer operations. Its Xero server composes the original receivables handler, which also serves payment plans and customer statements. One accounting workspace and writer retain the shared customer IDs, invoices, receipts, credits, schedule editions and Xero packages.

## Choose the commercial record

Begin with the customer's actual transaction. A paid API request, a prepaid allowance and an implementation invoice have different source records.

| Customer transaction | Original record and continuation |
| --- | --- |
| One paid resource request | The buyer's approved intent and selected terms lead to the native settlement, complete returned output and merchant delivery record. The accounting reconciliation receives that original settlement and its independent verification. |
| One prepaid API allowance | The acquired order retains its purchase and allowance. Later calls record reserved, consumed and remaining service units against that order. The selected result and recovery history remain attached to their original request. |
| An implementation or service invoice | The accepted commercial scope becomes an explicitly reviewed customer invoice. Recorded receipts and credit notes determine its dated balance. A plan distributes an outstanding balance across agreed due dates. |
| A customer accounting handover | Original issued invoices and credits are mapped into the customer's Xero organisation. Returned document identities and amounts reconcile that handover. Payment and allocation schedules remain linked to their original ledger records. |

Use the same original source identity through each applicable continuation. The distinct Stellar purchase remains identified by its approved intent and original network transaction; invoice numbering, installment editions, accounting exports and repeated receiving all retain that underlying identity.

## 1. Prepare the complete installed workspace

Select the maintained repository commit that contains the required original products. The existing source builder packages the complete **merchant-receivables-xero** recipe:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout --ref FULL_COMMIT_SHA \
  --selection merchant-receivables-xero --out /private/finance-release
~~~

Use the returned archive and SHA-256 in the original runtime installer. The complete managed profile selects the original Stellar verification, schema/OpenAPI and operator dependencies.

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

A prepared installation resumes through the same installer's **resume** operation. Retain its source archive, complete dependency selection and lock alongside the installed runtime. Use a new runtime directory for a later source edition and reopen the existing private accounting state after stopping its current owner.

The installed dispatcher can run every following command with the same layout:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /private/finance-runtime -- receivables-xero help
~~~

The examples below use **starforge** for that installed command.

### Keep the source directories and owner together

For a new merchant, select its actual native outbox, verification directory and approved accounting terms. Keep the accounting directory separate from those inputs:

~~~sh
starforge receivables serve \
  --directory /private/merchant/accounting \
  --outbox /private/merchant/source/outbox \
  --proof-dir /private/merchant/source/proofs \
  --terms /private/merchant/source/terms.json \
  --port 8448
~~~

Initialization validates the selected paths and terms and retains their identity. Enter the issuer's billing name, document prefixes and payment instructions in Settings. Use **Customers and statements** to maintain the actual accounting customer and billing details. Reuse that customer's UUID for quotation imports, invoices, receipts and exports.

An initialized workspace opens directly at the full Xero and receivables service:

~~~sh
starforge receivables-xero serve \
  --directory /private/merchant/accounting --port 8448
~~~

Use the actual URL returned at startup. Under its same origin, the standard routes are:

| View | Route | Work |
| --- | --- | --- |
| Xero customer handovers | /receivables/xero/ | Organisation profiles, exact import files, original results and correction packages. |
| Invoices and payments | /receivables/ | Customer invoices, receipt allocations, credit notes and quotation sources. |
| Customer payment plans | /payment-plans/ | Reviewed schedule editions, dated collections and retained schedule files. |
| Customers and statements | /customer-statements/ | Customer billing identity, account selection and dated statements. |

**Applications** in the original Runtime workspace provides the same lifecycle. Attach the installed runtime, select **Xero customer handovers**, choose the initialized accounting directory and use **Review → Save → Start → Open**. Its reviewed configuration binds the original workspace ID and source settings. Open the companion invoice, plan and statement routes in that running process.

The accounting directory has one process owner. Stop the previous application through its existing Runtime controls before opening the original accounting reconciliation browser or a standalone CLI against that directory. A later owner reopens the same saved records.

## 2. Reconcile the original Stellar operation

Open **Merchant accounting** in the original Applications workflow to review the merchant's outbox and payment verification. In a source checkout, the original entry is:

~~~sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting
~~~

The saved workspace supplies its existing input paths. In **Sources**, review the native outbox, selected terms, original verification files and any connected recovered-settlement directory. Each actual payment option has its own route, method, network, asset, recipient and exact atomic amount. The merchant supplies its quoted commercial value and cost basis explicitly.

When original verification is needed, **RPC collections** receives the actual reserved-payment or checkout record and independently known payer, prepares the existing read-only collection, and retains its original results and attempts. Publish those selected results into the same accounting sources.

Choose **Reconcile current sources**. The completed run retains a complete input snapshot. Review its event ledger, payment-option groups and exceptions; compare with an earlier run when continuing the same period. Open an event's native outcome, independently observed transfer, delivery and selected terms together.

The accounting engine keeps exact units under their own network and payment option. Its transfer join uses the original transaction fingerprint and matching asset, parties and atomic amount. Merchant-supplied quoted USD value and cost remain separately named fields. Record the responsible operator's correction or valuation basis with the original source rather than replacing those native units.

An interrupted settled request continues through the original buyer or recovery intent. A reopened output retains the original purchase and complete saved response. The merchant's delivery and the customer's receipt of the useful result remain visible alongside settlement.

## 3. Continue the agreed service into an invoice

Use **Merchant support** for the original quotation and customer response. Prepare the agreed implementation, service commitments and selected pricing assumptions there. Review and publish its complete quote edition; retain the original QUOTE or QUOTE_JSON and the selected RESPONSE material.

In **Invoices and payments**, import those original files and map them to the existing accounting customer. Choose the actual charge:

| Invoice scope | Review before creating the draft |
| --- | --- |
| IMPLEMENTATION | The quotation's one-time implementation lines and actual customer agreement. |
| RECURRING | The original recurring service and planned usage lines, an explicit positive monthly period count and a specific period label. |

Keep the issue date, due date, purchase order, currency precision, discounts and tax decisions explicit. The source review retains original quote lines, calculations, period selection, the selected customer response and rounding differences. Actual metered usage can be selected through its own maintained service-period source when that installed contribution supplies it; the original planned quote remains identifiable.

Save the complete draft and open its current preview. Issuing freezes the issuer and customer details, original amounts, dates, payment instructions and numbered invoice into JSON, line CSV, printable HTML and a manifest. Download that issued edition for the customer's ordinary delivery channel.

Later source corrections continue through revised drafts, credit notes or linked replacements as the original document lifecycle permits. An already issued document keeps its original bytes.

### Review customer credit before releasing the invoice

In **Receivables → Customer credit**, save the merchant's actual terms for the selected customer and currency. Policies begin disabled; the operator chooses and enables the credit limit, overdue threshold, dispute review or review of each order. The assessment shows current and future issued obligations, the selected draft, overdue and disputed balances, available receipts and retained invoice credits with their original dates and precision.

Review the complete assessment before approving or declining that saved draft. The decision retains its operator, reason, policy edition and exact account basis. An approval is consumed by the original invoice-issue transaction only while the draft, policy, account and assessment date still match. A changed source opens a current assessment for review. Download the retained decision and issued invoice together for the customer's account record.

The [customer credit and order-release guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CREDIT_CONTROL.md) contains policy setup, decision history, source comparisons, file downloads and the original HTTP and CLI operations.

## 4. Record receipts and apply them at the right date

For money received against a customer obligation, record the actual customer, currency and decimal precision, received date, method, reference and amount. The receipt retains its full amount; an allocation chooses how much is applied to an issued invoice.

Select the invoice, allocation amount and effective date. The controller checks the receipt's available amount, the matching customer and currency, and affected later allocation intervals. Any unapplied balance remains available for that customer's subsequent allocation.

For a native settlement from a completed accounting report, select its original ledger event and customer/order binding. Enter the actual commercial-currency amount and valuation basis. The resulting receipt preserves the report, native event, transaction fingerprint, asset and atomic amount alongside that explicit valuation. Reuse the resulting receipt when applying it to the intended invoice.

Use a dated **release** with a reason to correct an allocation. That restores the released amount to the receipt and changes the invoice balance from its effective date. A later allocation uses the same retained receipt. Credit notes instead adjust the issued charge: select its original invoice lines and explicit net/tax amounts, then review and issue the credit. A credit after full payment can leave a customer credit balance.

### Match the original bank statement to customer cash

Open **Bank statements** in the same Receivables desk. Select the actual bank account and currency, retain the CSV, OFX/QFX or MT940 file, and inspect its original sections, date basis and parser report. The complete row register exposes bank references, existing receipt matches and invoice candidates before paging.

A bank credit can be divided between several customers. Review each proposed new receipt, link to a recorded receipt or correction of a recorded receipt, including the actual bank date and chosen accounting date. The posting preview includes released and replacement allocations and their effect on later balances. The original journal commits the selected cash posting, allocations and source links together.

Retain the statement bytes, normalized rows, parser report, posting document and customer receipt advice. Correct an existing posting through its original source and receipt history so the statement, account and customer export continue to explain the same money. The [bank-statement operating guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/BANK_STATEMENTS.md) covers source conventions, duplicate resolution, split postings and interrupted recovery.

### Receive an invoice through its selected Stellar wallet

In the invoice's **Payment requests** view, select the part of its current balance to collect and review the exact Stellar terms. **invoiceAmount** is the value applied in the invoice's currency; **stellarAmount** is the exact amount the merchant receives, with up to seven decimal places. Retain the explicit **valuationNote**, network, destination G account and either native XLM or the exact issued asset code and issuer.

Review the generated memo, expiry and wallet message. The default hash memo binds the request to its invoice. Issuing freezes the original invoice identity, selected balance and complete terms. Download **payment-request.html** and **payment-request.uri** for the customer. The original unsigned SEP-7 URI opens those terms in the customer's selected wallet for review and signing.

When the wallet returns a transaction hash, record it against that issued request. The original receiving operation reads the selected Stellar network and verifies destination, asset, received amount, memo and ledger time. The paying account can be constrained explicitly, or derived from the matched operation.

A verified public-network transfer creates the original customer receipt with the agreed invoice valuation and source references. The operator can apply the eligible amount to that invoice immediately or retain the receipt for later allocation. The transaction, receipt and allocation remain linked in one accounting operation. A verified test-network transfer retains its original **TESTNET_VERIFIED** observation and proof for the integration demonstration.

Open the saved return to inspect a not-yet-found transaction, unavailable verification or a changed request. Continue with another observation when its original cause is resolved. Each new observation has a new request ID; recovering an uncertain observation reuses its same saved request and body. A successful receiving returns the established receipt and allocation when reopened.

The [complete invoice collection guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/PAYMENT_REQUESTS.md) supplies the exact preview, issue, wallet-file, return, receive and cancellation commands. Its browser and CLI continue in the same receivables process used by the payment-plan and Xero desks.

### Read the dated account as a whole

The invoice amount due follows its original total, effective allocations, releases and credit notes. Select the actual **as-of date** before reviewing balances or aging. A past statement shows the account at that past date even when a later correction already exists.

Keep currency code and precision together. A two-decimal USD account and a seven-decimal native-unit source carry their own exact amounts and explicit valuation link. Receipt totals, applied amounts, invoice balances, credit balances and quoted source values have different meanings and remain individually available.

Download the dated customer account with its issued invoices, credits and allocation history. That account gives the customer and accountant the complete explanation of the selected balance.

## 5. Agree an installment schedule over the existing balance

Open **Customer payment plans** in the same running service. Select the issued invoice and its balance date. The controller reads the original amount due on that date.

Enter positive exact-decimal installment amounts and actual due dates. **Generate installments** provides an editable split by count, first due date and a day interval. The final installment retains the integer-unit remainder: a 100.00 balance split into three installments becomes 33.33, 33.33 and 33.34. For monthly or irregular dates, edit the actual calendar dates.

Save the draft, inspect the complete preview and activate the reviewed edition. Activation retains the schedule, invoice balance basis, customer/issuer identity, reference, note and payment instructions. Each edition supplies **schedule.html**, **schedule.csv**, **schedule.json** and **manifest.json**.

The collection desk displays amount due, overdue, due today, upcoming, after-horizon, unscheduled and credit balance for the selected dates, separated by currency and precision.

| Subsequent account event | Dated collection behavior |
| --- | --- |
| Additional effective receipt allocation | Covers the earliest remaining installments. |
| Additional credit note | Reduces the latest installments. |
| Allocation release | Restores the corresponding invoice amount; any amount outside the retained schedule appears as unscheduled. |
| Replacement schedule | A new reviewed edition becomes effective on its saved balance date, while earlier date views retain their earlier edition. |
| Schedule cancellation | From its cancellation date the remaining invoice balance returns to unscheduled collections. |
| Backdated change to the schedule's original balance basis | The account exposes the changed basis for review while preserving the original customer edition. |

The schedule represents the allocation of the existing obligation across dates. Each activated edition, later payment and historical view continues the same original invoice and payment records.

Use **Export CSV** or **Export JSON** for the selected complete collection report. Its rows retain actual due dates and all selected remaining amounts. When handing over one customer, include its original schedule editions together with the dated account.

### Follow up the balance and plan expected receipts

Use **Collections** in that same Receivables process to assign an overdue invoice, retain the actual customer contacts, record a payment promise or invoice dispute and prepare the next customer reminder. Its effective-dated case history follows the original invoice and customer; the actual account changes through its receipt, allocation, credit and refund records. [Collections operation](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/COLLECTIONS.md) supplies the complete browser, file, HTTP and CLI workflow.

Use **Cash planning** to retain a receipt scenario over the original remaining balance. Effective installments and open promises supply the dated portions; explicit timing, dispute and invoice assumptions determine their expected placement. Review source changes and available customer funds before saving the edition. Each original remaining amount appears once within the horizon, after it or separated, with totals kept by currency and precision. Revise, copy or compare saved editions and deliver their original JSON, CSV and printable report. [Cash planning operation](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CASH_PLANNING.md) explains the source allocation and complete interface.

## 6. Prepare the original Xero customer handover

Open **Xero customer handovers**. Save an organisation mapping from the receiving customer's actual invoice and credit CSV templates, account and tax fields, exact contact names, currency and supported decimal scale. Select invoice and credit date formats independently. Retain the original templates and any explicit line-level overrides.

Select issued invoices and credits, the saved profile and account date. **Review selected documents** displays mapping issues, exact net/tax/total, original customer identities and output files. Review all intended documents, then **Prepare immutable package**. The package freezes its source selection, mapping version, original documents, templates, import files and schedules together.

Download the retained files for the receiving organisation's established import workflow. The package's document numbers and source IDs remain the correspondence used when the accountant returns results.

### Receive the accountant's actual outcome

Save the complete original Xero **Invoices** or **CreditNotes** response from the existing authorized tenant. Follow the original response pagination and retain each complete returned page. In the desk choose **Xero Invoices or CreditNotes JSON**, select the original file, exact organisation and receipt time, then inspect and record it.

The reader preserves original numeric tokens, document UUIDs, contact names, net/tax/total, currency, status, validation messages and source pointers. If the accountant supplies a document-summary CSV, choose that format explicitly and map its actual headers, decimal/thousands conventions and credit sign.

| Current outcome | Continue the same handover |
| --- | --- |
| UNRESOLVED | Receive the original result or prepare an eligible linked correction. |
| REJECTED | Inspect the returned validation issue and the source's available correction action. |
| IMPORTED | The returned identity, status and exact amounts are associated with the original document. |
| MISMATCH | Correct the established record's discrepancy and receive its original updated result. |
| CONFLICT | Reconcile all active external IDs and receive the actual corrected or retired records. |

The returned external status and document identity describe the accountant handover. The merchant's cash and invoice balance continue to use their original receipt, allocation and credit history.

A correction package retains its parent date and only eligible unresolved source documents. Existing accepted IDs remain associated across the organisation's package family. Earlier returns, retired IDs and parent packages remain readable. Download **Complete archive** for the original templates, issued documents, prepared files, received files, interpreted outcomes and correction history.

The [Xero operating guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/xero/README.md) contains exact CLI, HTTP, source limits, correction rules and the original result acquisition procedure.

## 7. Resume the original request after interruption

Every saving interface uses the existing accounting journal with an operator, workspace revision and stable request ID. The browser retains the request before sending it. Saved plans and profiles also keep their own expected versions; activation and package preparation bind the exact reviewed result.

After a missing response, read or retry the **same saved operation**. A completed request returns its retained result. An unresolved request remains associated with the original workspace and exact body. Use the original read/recovery controls before editing or creating a successor.

If another operator changed the current record, open its latest state and compare it with the retained local draft. Choose the intended revision explicitly and review again. The plan desk preserves the previous activated edition while this draft work continues.

For an interrupted Xero import or correction, inspect the existing package and original returned file first. Continue with the established package, external document IDs and request identity. Keep source files and account decisions in their original workspaces.

## 8. Hand over the complete operating state

There are two practical deliveries: the customer's selected account files and the merchant's complete continued workspace.

The **customer/accountant delivery** contains the dated statement, original issued invoices and credits, every selected payment-plan edition, and the complete Xero handover archive. The recipient can relate the balance, collection schedule and imported documents to the same source IDs.

The **operating transfer** includes the full private accounting workspace and its configured outbox, proof directory, terms and connected recovered-settlement sources. The existing accounting backup uses the original encrypted recovery engine and preserves the shared journal and all product records together.

Stop the accounting owner and external writers before a cold backup. Choose a private state root containing the exact saved input paths and a separate backup directory:

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

Retain the returned manifest identity and the complete encrypted bundle through the merchant's existing recovery process. The authorized receiving host supplies the separately managed passphrase environment and the original private absolute paths.

~~~sh
starforge merchant-accounting-workspace restore \
  --workspace /private/merchant/accounting \
  --state-root /private/merchant \
  --bundle /private/backups/merchant-finance \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE \
  --quiesced
~~~

The original restore reuses matching files, preserves changed surviving data for reconciliation and continues its own interrupted publication. Reopen the same accounting workspace and inspect the original customer, issued documents, receipt allocations, dated schedule editions and accountant packages. Continue the existing source reconciliation for activity after the backup point.

The complete [accounting workspace recovery guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md#back-up-and-restore-the-complete-accounting-operation) covers private-path selection, browser recovery, interrupted restore and exact original command results.

## Customer receiving and recurring use

Agree one useful transaction with the commissioning payer, merchant, independent buyer and receiving engineer. For a paid source operation, name the exact output, selected network/asset, source rights, host and receiving application. For a service invoice, name the accepted scope, accounting customer, commercial currency, billing dates and accounting destination.

Follow the original transaction from approved request or customer quotation through its actual source, payment, useful output, account and receiving. Record the customer's accepted result and corrections, source period/population, active operating effort and recovery duration. A later paid result follows a distinct useful need such as a fresh reporting period or source edition; an installment continues the existing customer obligation.

The reusable operating foundation is already supplied by the maintained products. A commissioned installation adapts its actual source formats, identity and accounting mappings, native payment configuration, supervision and receiving application. Technical receiving finishes when another accountable engineer opens the full operating state and completes the agreed continuation.

## Original product sources

| Original component | Complete source and operating procedure |
| --- | --- |
| Native settlement accounting | [Report, payment-option and valuation contract](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/README.md). |
| Accounting browser and encrypted recovery | [Original workspace operation](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/README.md). |
| Customer invoicing and service billing | [Installed receivables guide](../merchant-receivables/README.md). |
| Customer credit and order release | [Policy, assessment, approval and issued-invoice operation](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/CREDIT_CONTROL.md). |
| Original bank statements and receipt advice | [Source import, cash matching and posting correction](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/BANK_STATEMENTS.md). |
| Dated payment plans and collections | [Installed payment-plan guide](../merchant-payment-plans/README.md). |
| Xero customer document handover | [Complete Xero operator](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/xero/README.md). |
| Customer service agreements | [Installed service-agreement guide](../merchant-service-agreements/README.md). |
| Original pricing and commercial source | [Merchant operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/products/merchant-workspace/OPERATING.md#8a-operate-supplier-costs-pricing-and-full-workspace-receiving). |
| Existing SCF application reader | [Manuscript composition and financial chapter](../../stellar-forge/developer-site/GRANT_FINANCIAL_OPERATIONS.md). |

The invoice-wallet collection workflow is merged in [PR245](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/245) at **65257b07b0ee6be78bbe40bcf67dae67fbacba50**. Its reviewed wallet request and native returned-transfer receiving use the original receipt and allocation journal described above.

The native protocol source is [x402 on Stellar](https://developers.stellar.org/docs/build/agentic-payments/x402). The original Xero result contracts are [Invoices](https://developer.xero.com/documentation/api/accounting/invoices) and [Credit Notes](https://developer.xero.com/documentation/api/accounting/creditnotes). Each installed product retains the exact adapter contract and supported source shape used by its operating workflow.
