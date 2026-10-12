# Receive original Xero invoice and credit-note results

Use **Native Xero JSON** for the original Accounting API response. The receiving operation stores the complete response file, its byte count and SHA-256, document and line originals, and each JSON pointer. A saved file can contain one API page, one individual-document response, or a provider validation response. Import each original page separately into the same prepared package.

## Acquire the original response

Use the existing authorised Xero connection for the organisation selected in the package. The API requires the organisation's **xero-tenant-id** header and an existing OAuth connection with **accounting.transactions.read** or its broader transactions scope. Save the original UTF-8 HTTP response body. Keep credentials in the connection.

| Required source | Read request |
| --- | --- |
| A page of sales invoices, with the original lines | GET https://api.xero.com/api.xro/2.0/Invoices?page=1&pageSize=100&summaryOnly=false |
| A page of customer credit notes, with the original lines | GET https://api.xero.com/api.xro/2.0/CreditNotes?page=1&pageSize=100 |
| A known invoice's current document, including its retirement status | GET https://api.xero.com/api.xro/2.0/Invoices/{InvoiceID} |
| A known credit note's current document | GET https://api.xero.com/api.xro/2.0/CreditNotes/{CreditNoteID} |

Invoice reads can use the documented **InvoiceNumbers** or **IDs** filters to retrieve the package's original documents. Preserve the response **pagination** values and continue the original page sequence. Include the document types/statuses required for the operation; an ordinary active-document list is not a substitute for the specific retired UUID's current response. Use the individual invoice read for a document that uses Xero's optional rounding adjustment.

Save each response body directly as a .json file. A connector that returns parsed objects should expose its original HTTP response body for this operation: serialising already rounded JavaScript numbers would lose the provider's monetary values. The native importer accepts the original response file as it stands; it handles decimal and exponent number tokens exactly.

Original API contracts: [Invoices](https://developer.xero.com/documentation/api/accounting/invoices), [Credit notes](https://developer.xero.com/documentation/api/accounting/creditnotes), [requests, paging and filtering](https://developer.xero.com/documentation/api/accounting/requests-and-responses/), and the [official Accounting OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml). The implementation was checked against that specification's version 19.1.0.

## Receive a file into its existing package

1. Open the prepared package and select **Native Xero JSON**.
2. Confirm the same existing Xero organisation used for the export and response.
3. Select the original response file. Review its invoice/credit-note numbers, UUIDs, actual statuses, currency and exact amounts. The preview and server share the same lossless JSON reader.
4. Submit the receiving operation once. Keep its original request ID when retrying an uncertain operation.
5. Review the resulting documents. Further original pages and later corrections can be received into the same package. Reopen the package to see its persisted receiving history and source files.

A partial page resolves only the documents it actually contains. The remaining selected originals keep their current state. A supplier bill or supplier credit note is retained in the source index as an excluded document; a coincident number cannot bind it to a customer receivable.

## Native fields and original provenance

| Accounting meaning | Invoice source | Credit-note source |
| --- | --- | --- |
| Receivables type | Type = ACCREC | Type = ACCRECCREDIT |
| Original document number | InvoiceNumber | CreditNoteNumber |
| Xero document identity | InvoiceID | CreditNoteID |
| Provider status | Status | Status |
| Customer name | Contact.Name | Contact.Name |
| Net amount | SubTotal | SubTotal |
| Tax amount | TotalTax | TotalTax |
| Total amount | Total | Total |
| Currency | CurrencyCode | CurrencyCode |
| Provider rounding, if present | RoundingAmount | Original field retained if supplied |
| Original lines | LineItems | LineItems |
| Validation outcome | HasErrors / ValidationErrors | HasErrors / ValidationErrors |

The reader accepts top-level **Invoices**, **CreditNotes**, and original validation **Elements** arrays. Both supported document collections may be read when present in one original body. The saved file remains complete; the operator does not combine pages to make a new source.

The result's **native** record contains:

- **collections** with the original collection names, pointers and counts; **envelope** with the remaining response metadata and paging.
- **documents** with the original number, UUID, status, kind, currency, monetary lexemes, exact canonical amounts, validation flags, field pointers, complete parsed original document, and each original line.
- **numericTokens** with the exact original JSON number and its pointer. Parsed numeric values are stored as strings, so a value such as 9007199254740993.01 retains every digit.
- **excludedDocuments** with original pointers and the reason a non-receivables type was excluded.
- The original file descriptor and unchanged bytes retained by the maintained package operation.

For example, **/Invoices/0/SubTotal** identifies the original net amount, while **/Invoices/0/LineItems/2/TaxAmount** identifies tax on the third original line. Source pointers use normal JSON Pointer escaping for field names.

Native Accounting API credit-note totals are compared using the positive document convention. The negative **UnitAmount** used in the separate Xero credit CSV import template does not change the native API return's sign. The importer fixes native decimal/grouping conventions to JSON's decimal point and no grouping; locale controls belong to the explicit CSV summary path.

The original response can preserve quantities, unit prices, discounts, tax types, tracking, allocations, payments and contact metadata inside each document. Matching uses the frozen original receivable's number, kind, mapped contact name, currency and exact net/tax/total; it does not reconstruct totals by summing repeated document totals on line rows.

## Correct a provider rejection or a changed document

A returned **DRAFT** status alone does not establish success when the same provider document has **HasErrors**, **ValidationErrors**, or appears in the provider's validation **Elements**. These records keep the actual status, messages, source pointers and placeholder identity as original source, and are recorded as provider rejections.

For an ordinary accepted document, the receiving ledger tracks the original Xero UUID within its organisation. A different active UUID for the same original or a UUID assigned to two originals remains a visible conflict until a later original response resolves the provider state. A fresh response at the same UUID can correct wrong totals or a wrong customer. A missing or different Contact.Name on a successful detailed return is a visible mismatch, with that accepted UUID retained. An actual **DELETED** or **VOIDED** response can retire that UUID. Keep that original retirement response in the same receiving history before receiving a legitimate replacement.

For an unsent invoice with an error, correct the existing draft in Xero and read it again at the same UUID. Xero permits reuse of the number of a deleted draft or awaiting-approval invoice. An approved invoice's number must be changed before it is voided if that number is to be reused; an already-voided invoice cannot be restored. When the retired approved invoice still occupies the number, use the maintained receivables correction/replacement flow with a new original document number and retain the link to its predecessor. For a customer-sent invoice that needs correction, Xero's guidance is to issue a credit note. [Original Xero deletion and correction guidance](https://central.xero.com/0/article/Delete-or-void-a-sales-invoice).

Read each document's actual UUID/status after the operator completes the correction. Retaining a retirement return changes receiving identity history; it does not erase the original accounting document or its source.

## Existing CSV files

Xero's standard invoice/bill CSV export has one row per transaction line. Keep those original files for accounting comparison. **CSV summary** is an explicit alternative only when an actual returned source contains the required document-level UUID, status, currency, net, tax and total columns; map those original columns and their number conventions. A document-summary file manufactured by an operator is not needed for native receiving. [Original export layout](https://central.xero.com/0/article/Export-invoices-and-bills).

## Module interface

The maintained store selects the native helper when the request's **format** is **NATIVE_JSON**. Its **organisation** must equal the package's organisation; the store enforces that identity before retaining the result. Existing omitted-format requests remain **CSV_SUMMARY**.

    readNativeXeroResults({
      format: 'NATIVE_JSON',
      organisation: existingPackageOrganisation,
      file: {name: originalFileName, dataBase64: originalResponseBytes.toString('base64')}
    }, frozenPackageDocuments)

The pure helper returns the unchanged byte buffer, file descriptor, native source index and the shared domain evaluator's normalised rows. Each row carries its original **sourcePointers**, actual status and IDs, exact monetary outcome, provider rejection flag and resulting active/retired identity records. The existing store owns durable files, history, request replay and accounting mutations.

The browser-safe **public/native-json.mjs** exports **parseXeroNativeJson(text)** as **{value,numericTokens}**. The parser checks complete JSON, duplicate object keys, structure limits and exact numeric lexemes. It makes no provider call and performs no state write.
