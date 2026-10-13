# Supplier payment allocation review

Use **Accounts → Statements → Invoice allocations** to connect an original statement movement to invoices already retained in the same grant case. The editor uses the current native case report for invoice liability, payments, open balances and supplier credits. The original statement receiver remains the only cash writer.

## Receive a supplier payment

1. Open the original CSV, OFX/QFX or MT940 statement, select the account and interpretation, then **Preview updated decisions**. For an outgoing supplier payment, review its category in the original row controls and preview that change.
2. Open **Invoice allocations** on the payment row. Its original reference, description, date, direction, native amount and recorded USD value remain visible.
3. Find a supplier or invoice. **Current open invoices**, **Original reference matches** and **All retained invoices** are separate views. Search applies when you choose **Find invoices**; the visible result count and 25-row pages reflect the applied query.
4. Inspect a candidate's supplier, number, state, issue/due dates, original lines and source identities. **Download original invoice source** uses the existing authenticated case source endpoint and returns the retained original bytes.
5. Choose **Add invoice**. Enter an explicit partial USD amount, or choose **Use remaining open amount**. The suggestion is capped by this movement's remaining recorded USD capacity and the invoice's current open balance after other included draft allocations. You can replace the suggestion before review.
6. Add further invoices as needed. Each invoice appears once, with a maximum of 200 allocations per movement. The editor shows the recorded USD value, working total and unallocated capacity.
7. Write the allocation review reason and choose **Review allocation changes**. Read the full before/after selection, current paid/open amounts, other draft net payments and projected open balance or supplier credit. The reason is appended to the original row note; the original category, tranche and other decisions are preserved.
8. Choose **Apply reviewed allocations**, then **Preview updated decisions**. Inspect the complete native statement result and use the existing confirmation and **Import reviewed cash movements** action.

Selecting or reviewing an allocation changes no saved cash record. Applying the reviewed proposal updates the existing statement input decisions. Native preview and the original expected-version/request-ID import still determine the saved cash and invoice result.

## Reference matches and ambiguous invoices

A suggestion requires the complete original invoice number, at least three characters long, to appear as an alphanumeric-bounded token in the statement reference or description. Matching is case insensitive. Amount similarity and supplier-name similarity do not silently choose an invoice. Identical numbers from different suppliers remain separate candidates; every matching invoice is visible through **Original reference matches**, including settled, disputed and void records. Inspect the supplier and original invoice source before selecting.

The default open view omits void and fully settled invoices. **All retained invoices** keeps every original identity available, including a previously allocated void invoice. The review explicitly identifies disputed/void selections and invoice issue dates later than the movement date.

## Amounts, credits and refunds

All amount arithmetic in this editor uses integer USD cents. A positive allocation supports two decimal places up to the existing native limit of USD 1,000,000,000,000. The total selected allocations cannot exceed the movement's recorded USD value. A non-USD movement requires its explicit native USD valuation; this editor supplies no exchange rate.

Invoice positions come from `case.report.invoices`, which already reflects the original native cash rules and retained corrections. These are **current case positions**, not historical balances as of the statement movement. Other included, unrecorded statement rows are shown separately as net invoice payments: outgoing allocations are positive, incoming refund allocations are negative. Already recorded rows and explicitly excluded rows are omitted from this draft exposure.

Outgoing payments reduce open liability and may create a supplier credit. An incoming movement can allocate only through the original **Refund** category; it reduces net paid and can increase the remaining invoice liability. For such a row, **Use available credit amount** caps the suggestion by the remaining movement capacity and the current supplier credit after other included draft movements. An explicit larger refund can still be reviewed with its projected liability visible. A supplier credit or an allocation to a disputed/void invoice is an explicit operator review, with a retained reason.

The projection includes other included draft rows, even when those rows still need native correction. The complete native re-preview displays the importable set and remaining conflicts before import.

## Working copies, version changes and handover

Every source row has its own allocation working copy within the existing Staff-scoped statement browser draft. Switching rows or closing the editor preserves unfinished amounts, reasons, search and inspected invoice identity. Reload restores those working copies and requires a new review before applying them.

**Download recovery copy** includes all original statement inputs and all unfinished allocation working copies. Reopening that recovery in the original case retains the work; preview the original statement again to bind it to current native records. **Download allocation working copy** saves the selected row's original source/account identity, explicit allocation entries and note. **Download allocation review** saves the complete before/after proposal and its case/preview identity.

A case-version change, original row interpretation change or edited row decision invalidates a prepared proposal. The editor requires the current native preview before another review/apply. If an original row's date, amount, reference, currency, description or account interpretation differs from its saved working basis, use **Start from current preview**. That action first downloads the earlier working copy and then initializes the current original row's retained allocations.

The proposal is recomputed at apply time from the same original source row, full current decision list, case version, invoice positions and original source identities. An old proposal cannot overwrite a later change. Once cash is already recorded, use the existing **Cash correction** workflow; the statement allocation editor preserves that recorded identity.

After import, the statement source and review history, original inputs, Cash/Invoice records and full case export/reopen all carry the applied native allocations and review reason. Existing pending import and setup requests keep their original exact payload and actor, and lock write operations until resumed.

## Maintained integration

- `operations_statement_allocations.mjs`: current native invoice context, original reference candidates, exact signed cent calculations, reviewed proposal/apply and operator rendering.
- `operations_statement_allocations.css`: neutral desktop/phone allocation layout.
- `operations_statements.mjs`: source inspection/download, per-row working-copy lifecycle, exact existing draft and native re-preview/import flow.
- `operations.mjs` passes the existing authenticated binary `api` to the statement desk.
- `operations_http.py` serves the two original module/style assets; `managed-source.json` includes both assets and this guide for maintained installations.
