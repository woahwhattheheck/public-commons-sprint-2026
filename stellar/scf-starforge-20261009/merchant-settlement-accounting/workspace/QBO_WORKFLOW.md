# QuickBooks Online: merchant handoff, journal and bookkeeping return

The QuickBooks workflow takes a frozen handoff from the existing merchant accounting workspace, prepares a reviewed native journal, and brings the original QuickBooks posting back into the same accountant history. The operator keeps the source events, company and account mapping, valuation, request, response and resulting accountant return together.

Open **QuickBooks** from the private accounting workspace described in [the workspace guide](./README.md). The application uses the original workspace lease, revision control, serialization and accountant engine. The browser and HTTP API below operate on the same records.

The maintained implementation is [the journal engine](../accountant/qbo.mjs), [native company import](../accountant/qbo-company.mjs) and [workspace integration](./qbo-workspace.mjs).

## Complete operating journey

### 1. Choose the original handoff

Complete the merchant reconciliation and prepare an accountant handoff in the existing workspace. Choose that retained handoff in QuickBooks. It can carry the original period close and its frozen refund/cancellation companions.

Review the original event, network, transfer classification, atomic amount and adjustment context. Each handoff row identifies one original payment event. Its protected adjustment fields can include gross, refunded, pending refund, remaining, available refund, cancelled and over-refunded atomic amounts. A later live adjustment does not rewrite an already frozen handoff.

A QuickBooks plan selects between one and 500 of these events. Each selected event receives one reviewed positive home-currency amount and one debit/credit pair. Enter the event's accounting treatment with its frozen adjustment context in view. The amount and posting direction are the accountant's inputs. The original token quantity, a merchant quote and a fiat valuation remain separately identifiable.

Rows already reported as BOOKED or EXCLUDED require the original accountant workflow to resolve their status before a new plan can use them. Once a journal is reviewed, its selected events are reserved against another reviewed/booked journal for the same QuickBooks company and environment.

### 2. Establish the company and accounts

Choose the actual QuickBooks environment, explicit company realm ID, company name and home currency. This profile supports USD, CAD, EUR, GBP, AUD and NZD, with two decimal places.

**Importing native company documents is the recommended mapping route.** Obtain the following successful JSON responses from the authorized QuickBooks client connected to that company:

| Source | Native operation |
| --- | --- |
| Company identity | GET /v3/company/{realmId}/companyinfo/{realmId}?minorversion={version} |
| Preferences | GET /v3/company/{realmId}/preferences?minorversion={version} |
| Chart selection | POST /v3/company/{realmId}/query?minorversion={version}, with the text body SELECT * FROM Account STARTPOSITION 1 MAXRESULTS 1000 |

The company and preference paths are published in Intuit's [CompanyInfo read request][company-read] and [Preferences read request][preferences-read]. The account query and paging structure appear in Intuit's [accounting collection][native-collection] and [SDK query guide][quickstart]. Retain every original page needed to include the intended account mappings. For multiple account pages, import a JSON array of those original QueryResponse objects.

The import accepts:

- A native CompanyInfo or Preferences wrapper, the direct entity, or a singleton QueryResponse for that entity.
- A native Account read response, one Account QueryResponse, an array of Account query pages, or an array of direct native Account records.
- JSON objects, exact JSON text, or UTF-8 bytes through the programmatic helper. The HTTP endpoint accepts JSON-compatible values and JSON text.

The explicit realm ID remains part of the source binding. CompanyInfo.Id does not replace that explicit realm input. Any realmId supplied by an imported wrapper must agree.

The preview reads CompanyName (or LegalName), CurrencyPrefs.HomeCurrency.value and the actual boolean MultiCurrencyEnabled. It preserves every imported chart row and displays account name, Id, Active, AccountType and CurrencyRef.

An account is selectable when its imported source supplies an active posting account in the supported home currency without a required customer/vendor mapping. Inactive accounts, foreign or missing account currency, Accounts Receivable, Accounts Payable, Non-Posting and unrecognized types remain visible with reasons. Account IDs stay exact numeric strings. Repeated IDs and malformed source fields produce a source error, allowing the operator to correct the original selection before preparing the journal.

The normalized snapshot retains:

- Exact sourceDocuments text for text/byte imports of CompanyInfo, Preferences and accounts. JSON object inputs are retained as canonical JSON text.
- Raw-byte SHA256, canonical JSON SHA256 and byte count for each source.
- All normalized accounts, their eligibility reasons and source/page counts.
- A sealed snapshot whose validation reconstructs the company and eligibility from those original documents.

The current import limit is 8 MiB for the combined original company sources. Supplying the snapshot to a plan binds its company and selected account references to that retained import.

For an independently verified manual mapping, enter the exact native Account.Id values and the reviewed company/home currency directly. Include the actual Active, AccountType and CurrencyRef fields whenever available. Choose different debit and credit accounts for each selected event.

### 3. Enter and preview the journal

Give the journal a meaningful name and record the operator. Select the posting date explicitly. Intuit's TxnDate is the date used for the posting; omitting it at the provider would use the server date, so this workflow always carries the chosen date. [JournalEntry properties][journal-properties]

For every selected event, enter:

- Its frozen rowId.
- A positive home-currency amount, with at most two decimal places and a maximum of 999999999.99.
- The actual debit account and credit account.
- A useful description explaining the valuation and account treatment.

A sale may use a merchant clearing asset account and an income account. A reviewed return may need the opposite treatment. Select the direction that matches the accountant's treatment of that event and its retained adjustments.

The preview shows the selected source and generated journal. Every event contributes equal debit and credit amounts, so the journal balances before export. Amounts are validated in integer minor units. The native payload contains JSON numeric Amount values.

A document number can be provided up to 21 characters. Otherwise the engine derives a stable short reference from the retained plan UUID. PrivateNote carries the full plan and handoff identity, and each line description carries the source row identity.

The environment is part of the plan. Production requires the selected original events to be on stellar:pubnet with OFFICIAL_TRANSFER_MATCHED. The sandbox workflow carries the original testnet context through its review and later accountant note.

### 4. Retain, review and export

The preview is read-only. Saving its exact previewSha256 creates a DRAFT journal and freezes its request, source, mappings and original accountant revision. A stable request UUID identifies that operation; repeating it with the same content reopens the original result.

Open the retained draft and review its actual company, date, source, account directions, home amounts and totals. The review operation records the reviewer, note and retained plan digest. It changes the journal to REVIEWED and reserves the selected events for that company/environment.

Download journal-entry.json from the reviewed plan. It is the native JournalEntry create body. Also retain plan.json and review.html with the accountant's working papers.

The packet includes:

| File | Purpose |
| --- | --- |
| plan.json | Frozen journal, selected events, mappings, optional company snapshot and integrity |
| journal-entry.json | Exact native JournalEntry create body |
| handoff.json | Original frozen accountant handoff |
| accountant.csv | Original current accountant template at plan preparation |
| accountant-return.json | The existing parent accountant return, when one was present |
| review.html | Standalone human review of the selected source and journal |

### 5. Complete the native QuickBooks posting

Use the authorized QuickBooks accounting client for the selected company and environment to submit the retained journal-entry.json:

POST /v3/company/{realmId}/journalentry?minorversion={version}

The production API host is https://quickbooks.api.intuit.com and the sandbox host is https://sandbox-quickbooks.api.intuit.com. Intuit publishes the [native JournalEntry request][journal-create] and the corresponding environment configuration in its [current sample application][batch-sample].

Retain the client's original request identity, endpoint, environment, exact body and complete JSON response. The document number is a human reference. Use the client's existing idempotent operation handling when it supplies requestid, preserving the same request/body on retry.

If the provider completed a posting while the client lost its response, retrieve that original posting through the client's retained operation or its JournalEntry.Id. Bring back the full native JournalEntry JSON for this same plan. Preserve the existing provider operation during recovery.

The simple journal profile uses explicit home-currency values and reviewed no-tax journal treatment. Currency conversion, tax-code classification, classes, departments, counterparty subledgers and additional fee/reclassification lines belong in the accountant's full journal treatment when required. The original handoff and return remain available for that work.

### 6. Preview the original response and save the return

Open the same reviewed plan, select the original response JSON, retain its company realm and preview it. The application reads either a native JournalEntry or a native Fault.

For a successful return, it checks the posting date, document number, retained private plan reference, currency, amounts, account IDs, posting sides and source descriptions. Provider-generated line IDs and display names can vary. Line order is compared by its full semantic composition.

The response must retain the native JournalEntry.Id and SyncToken as strings. SyncToken "0" is a valid initial version. The entity/version pair remains in the resulting accountant note and external reference; later provider updates use their own current version. Intuit describes these entity/version fields in its [JournalEntry model][journal-properties].

Ordinary no-tax/default fields are accepted when they preserve the reviewed treatment. This includes NotApplicable tax calculation and empty/zero tax details, plus false adjustment flags. Deleted/voided entries, conversion, substantive tax classification and changed journal economics require reconciliation against the reviewed source.

A successful preview builds the original accountant CSV return and runs it through the existing accountant preview. Saving it first retains the exact provider response and immutable return intent. The original accountant engine then applies that stable return and the workspace links the same result.

The selected rows receive:

| Accountant field | Value |
| --- | --- |
| externalStatus | BOOKED |
| externalBookRef | QBO:{realmId}:{JournalEntry.Id} |
| externalAccountCode | {debitAccountId}>{creditAccountId} |
| externalNote | Original note, with environment, realm, JournalEntry.Id, SyncToken, reviewed amount and currency appended when it fits |

Protected source columns and all unselected assignments stay with the original accountant engine. The journal becomes BOOKED when that original return has been saved and linked.

A Fault response is retained with its original error codes, messages and details. The journal remains available for the operator to resolve the provider issue and import the correct original posting result.

### 7. Resume, export and reopen

A matched response moves through PENDING while its original accountant return is being applied and linked. Reopening runs recovery for pending responses. The explicit resume operation continues that same response/return ID. Repeating a completed save returns the existing saved response.

If a pending operation reports a stale accountant parent or a source conflict, open its original accountant history and inspect the recorded return/revision before continuing. Its raw provider response, prepared return and stable identity are retained. Keep the existing posting and reconcile that record through the original accountant workflow.

A saved response carries these files:

| File | Purpose |
| --- | --- |
| response.json | Exact imported provider response bytes |
| result.json | Bound response inspection and proposed original accountant return |
| returned.csv | Exact accountant return content for a matched response |
| return-request.json | Stable original accountant import identity and preview digest |

The workspace retains the final saved accountant return ID and digest in the response record. Download the plan and response files from the same plan detail. The original accounting workspace export and backup should include its qbo directory and workspace state.

A DRAFT or REVIEWED plan can be cancelled after the operator confirms that its native journal is unused. Cancellation records the operator's reason and releases the event reservation. A matched pending/saved response continues through its existing accountant record.

## State and recovery reference

| Record | State | Meaning |
| --- | --- | --- |
| Journal | DRAFT | Exact plan and source packet retained; review remains |
| Journal | REVIEWED | Review recorded; selected company/events reserved; native request available |
| Journal | BOOKED | Original accountant return saved and linked |
| Journal | CANCELLED | Operator confirmed the plan unused and recorded cancellation |
| Response | FAULT | Exact native provider error retained |
| Response | PENDING | Matched response and original return intent retained; application/link pending |
| Response | SAVED | Original accountant return linked to this response |

The workspace revision protects writes against concurrent changes. expectedParentId protects the selected accountant revision. Preview digests bind the actual source and values that were reviewed. Stable IDs support interruption recovery.

## HTTP API

All paths are mounted on the existing private accounting server and use that server's established authentication. GET and preview operations inspect source. The remaining POST operations change the original workspace or accountant history.

| Method | Path | Result |
| --- | --- | --- |
| GET | /api/qbo | Current workspace revision, handoffs, plans, currencies and source links |
| POST | /api/qbo/company/preview | Normalized original company/account snapshot in company |
| GET | /api/qbo/handoffs/{handoffId} | Frozen source rows and current expectedParentId |
| POST | /api/qbo/preview | Exact proposed plan, previewSha256 and revision |
| POST | /api/qbo/plans | Retain the previewed DRAFT plan |
| GET | /api/qbo/plans/{planId} | Retained plan, responses and current accountant parent |
| POST | /api/qbo/plans/{planId}/review | Record review and reserve its events |
| POST | /api/qbo/plans/{planId}/cancel | Record unused-plan cancellation |
| POST | /api/qbo/plans/{planId}/responses/preview | Inspect original response and preview the original accountant return |
| POST | /api/qbo/plans/{planId}/responses | Retain response and apply/link its original accountant return |
| POST | /api/qbo/plans/{planId}/responses/{responseId}/resume | Continue the retained pending return |
| GET | /api/qbo/plans/{planId}/download/{filename} | Download an exact retained plan file |
| GET | /api/qbo/plans/{planId}/responses/{responseId}/download/{filename} | Download an exact retained response file |

### Company preview request

Supply JSON objects or the original JSON text in each source field:

~~~json
{
  "realmId": "123456789012345",
  "companyInfo": {
    "CompanyInfo": {
      "CompanyName": "Example Merchant"
    }
  },
  "preferences": {
    "Preferences": {
      "CurrencyPrefs": {
        "HomeCurrency": {"value": "USD"},
        "MultiCurrencyEnabled": false
      }
    }
  },
  "accounts": {
    "QueryResponse": {
      "Account": [
        {
          "Id": "101",
          "Name": "Merchant clearing",
          "Active": true,
          "AccountType": "Other Current Asset",
          "CurrencyRef": {"value": "USD"}
        },
        {
          "Id": "102",
          "Name": "Service income",
          "Active": true,
          "AccountType": "Income",
          "CurrencyRef": {"value": "USD"}
        }
      ]
    }
  }
}
~~~

These are example shapes. The operating import uses the actual responses and account identities from the chosen company. Preserve the returned company object as companySnapshot in the journal request.

### Plan preview and creation

Prepare one request object and retain its UUID and createdAt through preview and creation:

~~~json
{
  "id": "90e6f38a-2896-4d65-b5d0-84044ca4e2ae",
  "name": "October merchant journal",
  "actor": "Accountant name",
  "createdAt": "2026-10-11T22:00:00.000Z",
  "handoffId": "<original handoff UUID>",
  "expectedParentId": null,
  "realmId": "123456789012345",
  "companyName": "Example Merchant",
  "baseCurrency": "USD",
  "environment": "sandbox",
  "txnDate": "2026-10-11",
  "rows": [
    {
      "rowId": "<selected frozen row SHA256>",
      "amount": "125.50",
      "debitAccount": {"value": "101", "name": "Merchant clearing"},
      "creditAccount": {"value": "102", "name": "Service income"},
      "description": "Reviewed event valuation"
    }
  ]
}
~~~

Include companySnapshot when using the imported company. Use the current expectedParentId from the handoff read, including its actual UUID when present.

POST the request to /api/qbo/preview. To retain the draft, POST the same fields to /api/qbo/plans with the returned revision and previewSha256. The amount string is the operator's exact decimal input; the exported native Amount is numeric.

To review the retained plan, POST:

~~~json
{
  "id": "<new review UUID>",
  "actor": "Reviewer name",
  "note": "Company, date, source context and account directions reviewed",
  "planSha256": "<retained plan integrity SHA256>",
  "revision": 42
}
~~~

Use the current workspace revision. A cancellation request uses its own stable id, actor, required note, planSha256, revision and unusedConfirmed:true.

### Response preview, save and recovery

The response request contains the exact native JSON text:

~~~json
{
  "id": "<new response UUID>",
  "name": "Original QuickBooks posting",
  "actor": "Accountant name",
  "createdAt": "2026-10-11T22:10:00.000Z",
  "realmId": "123456789012345",
  "expectedParentId": null,
  "responseJson": "<exact original UTF-8 JSON response text>"
}
~~~

Read the current plan detail for expectedParentId. POST to its responses/preview endpoint. Save the same fields to its responses endpoint with the returned revision and previewSha256. Keep the response UUID, source text and createdAt unchanged when repeating a save.

The resume endpoint takes actor and the current revision. It uses the already retained provider response and accountant import identity.

## Common corrections

| Result | Concrete correction |
| --- | --- |
| QBO_COMPANY_SOURCE_FAULT | Open the provider error and obtain the successful CompanyInfo, Preferences or Account response |
| QBO_COMPANY_ACCOUNT_ACTIVE / REFERENCE / DUPLICATE | Correct the original account source; preserve string IDs and boolean Active, with one record per account |
| Account is visible but unselectable | Read its reason and choose a suitable actual account, or complete the required currency/counterparty treatment in the original accounting workflow |
| QBO_STALE_ACCOUNTANT / QBO_ACCOUNTANT_CHANGED | Reload the original handoff/current accountant revision and review the affected assignments |
| QBO_PREVIEW_CHANGED | Preview the current complete request and use that returned digest |
| QBO_EVENT_RESERVED | Open the original reviewed/booked plan; cancel an unused reviewed plan when appropriate |
| QBO_COMPANY_MISMATCH / QBO_RESPONSE_IDENTITY | Retrieve the original response for the selected company, plan and posting |
| QBO_RESPONSE_MISMATCH | Compare the retained native request with the provider's complete journal before importing |
| QBO_JOURNAL_ALREADY_IMPORTED | Reopen the original retained response/return |
| Pending response with lastError | Inspect the retained accountant history and resume the same return after resolving its specific conflict |

## Primary QuickBooks contract references

The generated journal uses the native JournalEntry line structure and balance rule from Intuit's [journal model][journal-model] and [JournalEntry request][journal-create]. Currency preferences are defined in [CurrencyPrefs][currency-prefs]. Native chart fields come from Intuit's [Account model][account-model]; the [AccountType enum][account-types] gives the exact spellings used by the import.

Regional tax, class, department and counterparty fields are separate native concepts in [JournalEntryLineDetail][journal-line]. The home-currency profile and explicit account selection here are the implemented product contract. The original company settings and accountant's treatment determine the actual posting.

[company-read]: https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-5ae01430-6256-4f99-b61e-25444f5b5ad3
[preferences-read]: https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-f36c1e2e-fa7b-406d-941d-80982e73862d
[native-collection]: https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/documentation/4884662-e6c576f1-f6d3-440f-b090-da9ff1ac519d
[quickstart]: https://intuit.github.io/QuickBooks-V3-PHP-SDK/quickstart.html
[journal-create]: https://www.postman.com/intuit-developer/intuit-developer-quickbooks-online-accounting-api/request/4884662-4d0c72cc-0585-4485-9221-9f3551b6e493
[journal-model]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/JournalEntry.html
[journal-properties]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/124adc26-3988-e8ee-c447-c1ada39393fe.htm
[currency-prefs]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/CurrencyPrefs.html
[account-model]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/3bb29a12-13fc-0e5b-5511-8d08dbac5cfc.htm
[account-types]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ipp-v3-java-devkit-javadoc/com/intuit/ipp/data/AccountTypeEnum.html
[journal-line]: https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/62627c63-90a3-c87a-ef9b-8b4b06daee08.htm
[batch-sample]: https://github.com/IntuitDeveloper/SampleApp-Batch-Java

### Existing accountant notes

The original accountant note is preserved. A concise QuickBooks reference is appended when the combined note fits the original 4,000-character limit. When it would overflow, the full original note stays unchanged and the company, journal ID, version and valuation remain available in the retained plan and response files and booking reference.

For a home-currency journal, a response may omit `CurrencyRef` only when the retained native company Preferences explicitly show `MultiCurrencyEnabled: false`; otherwise the response must contain the reviewed currency reference.
