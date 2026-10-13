# Customer hourly Work billing

This desk connects original accepted Work to an explicit customer hourly agreement and the existing native Receivables account. Open **Customer hourly Work billing** in the original Grant Operations case.

## Working order

1. In **Work**, retain the real contributor, work package, service dates, description, hours and original evidence. Submit and accept the record through the existing Work lifecycle. A positive hourly charge requires `ACCEPTED` and `CUSTOMER`; contributor payables and planning valuations remain separate.
2. In **Sources**, retain the customer's agreement or authorization file. Use the original accounting connection and native customer.
3. Record one customer hourly authority: title, interpretation, authorization date, service-period boundaries, explicit contributor/package rate scopes, native currency/precision, rounding policy and any whole-authority hour or amount cap. Each rate must name actual contributors and work packages. A blank cap records no stated cap; do not use blank to omit a known limit.
4. Select accepted Work portions and the matching rate. Review the exact original row, hours, agreement edition, computed native amount and proposed financial commands. **Prepare** retains this review and reserves the selected Work.
5. **Apply / resume original native operations** creates or changes the draft through the original Receivables API. Review the native invoice separately before **Issue**. If native credit control requires a decision, use its actual current reviewed decision.
6. Continue the retained charge for draft correction, credit, void or replacement. Enter remaining hours. A credit or void can release revoked/reopened Work at zero hours. Positive remaining hours still require accepted CUSTOMER Work and valid source/terms.
7. Export the complete case and customer account. Save the working desk when changing device or recovering a response. Reopen the complete Operations ZIP, configure the same native account identity at its current local service URL, and continue the original request journal.

## Quantities, money and caps

Hours use the original Work ledger's maximum four decimal places. Reservation quantities are integer ten-thousandths of an hour. The backend uses integer native currency minor units for all rate calculations; browsers and clients retain decimal/integer strings.

For a line with hour-unit quantity `q` and hourly rate `r` in native minor units, the unrounded amount is `q*r/10000`. `EXACT` rejects a fractional minor unit. `HALF_UP` rounds each positive line half up. The chosen policy is retained with the actual customer agreement; no exchange rate or markup is inferred.

A pending credit, void or replacement retains the greater old/new exposure until the native correction is acknowledged and the charge is applied. Whole-authority caps use the greatest edition total in each active chain and then sum the chains. Moving hours among lines does not add unrelated per-line maxima to the commercial cap.

Reservations are shared among cases registered in the **same Operations workspace database**, including imported copies that reference the same original Work and charge IDs. Separate restored installations do not share a distributed reservation lock. Reconcile their complete saved histories into one operating workspace before dispatching new financial work. Replaying the same original native request keeps its original request ID.

## Authority revisions

A revision preserves its authority family, native account, customer and currency. It retains the complete preceding agreement and original request. Rates, scope, service period, source files and caps can be revised explicitly. A reduced cap cannot fall below currently retained exposure, including pending corrections.

New positive charges use the latest authority. Existing invoices and earlier customer terms remain immutable. A credit or void may use a retained older authority to release its original obligation. A correction stays within its original authority family; opening a new agreement does not reset the old family's cap.

## Recovery

The desk saves an exact outgoing request before dispatch. Lost responses retain that request for replay or native-journal reconciliation. Never replace its request ID, actor, charge identity or reviewed payload to escape an uncertain result.

A proved local review refusal can be retained in request history and corrected. Native commands remain pending until the actual original account reports their result or the source-defined native error is definitively noncommitting. A failed network call is not a rejection.

Issue replay uses only the retained original credit decision, including its absence. A new issue decision requires a fresh native preview. Cancellation requires a recorded reason and is allowed only while all original native commands are absent or definitively rejected.

A copied case retains exact authority, preparation and cancellation request bodies. Import never synthesizes a new charge reservation from a new receiving case ID. A conflicting authority revision, native result or cancelled ancestor with a live successor is rejected for explicit reconciliation.

## Complete exports

The download contains:

- `operations.zip`: the complete original Grant case, including Work, sources, hourly authorities, all charge editions and command histories.
- `work-billing.json`, `work-billing.csv` and `work-billing.html`: original Work/rate selections and every retained customer charge.
- `selected-charge.json`: the selected original review and journal.
- `native-customer-account.tar`: the actual native customer export.
- Every linked immutable invoice and credit JSON/CSV/HTML/manifest, including later-dated invoices outside an account statement's date range.
- Original per-file hashes and export observations.

The local case is captured under one aggregate snapshot. Native customer export and linked documents are bracketed by an unchanged observed native revision. This does not claim a distributed transaction across both services. An account export is not a substitute for the native authenticated full-account backup needed to restore the accounting service.

## HTTP contract

All routes retain the original case staff/finance guard and actor binding.

| Method | Route suffix below /api/operations/{case}/work-billing | Result |
|---|---|---|
| GET | empty | Catalog: Work editions, authority histories, sources and charge summaries |
| POST | /authorities | Save one exact customer authority/revision |
| GET | /authorities/{authorityId} | Complete original authority |
| POST | /preview | Exact Work/authority/source and native financial preview |
| POST | /prepare | Retained reviewed charge |
| GET | /{chargeId} | Original charge and journal |
| POST | /{chargeId}/apply | Apply/replay original native financial commands |
| POST | /{chargeId}/cancel | Record cancellation of an unused preparation |
| POST | /{chargeId}/preview-issue | Exact native invoice issue review; empty body |
| POST | /{chargeId}/issue | Issue/replay the reviewed original invoice |
| POST | /{chargeId}/refresh | Current original native invoice observations; empty body |
| GET | /{chargeId}/export.zip | Complete case/account/document ZIP |

Authority request:

```json
{
  "requestId": "original-authority-request",
  "actor": "Actual recording operator",
  "expectedVersion": 12,
  "terms": {
    "title": "Customer's hourly implementation agreement",
    "authorization": "Interpret the attached agreement and its actual scope.",
    "authorizedOn": "2026-10-13",
    "sourceIds": ["original-source-id"],
    "endpointId": "original-account-connection",
    "customerId": "original-native-customer-id",
    "currency": {"code": "USD", "scale": 2},
    "periodStart": "2026-10-01",
    "periodEnd": "2026-10-31",
    "rates": [{
      "id": "implementation",
      "label": "Agreed implementation rate",
      "contributorIds": ["original-person-id"],
      "costIds": ["original-work-package-id"],
      "hourlyRate": "125.00"
    }],
    "rounding": "EXACT",
    "hoursCap": "40.0000",
    "amountCap": "5000.00"
  }
}
```

For a revision add `previousId` and `expectedAuthoritySha256` from the exact retained authority. Example IDs and amounts above illustrate the schema; select actual records and actual agreed amounts in an operating case.

Preview request:

```json
{
  "requestId": "original-charge-preparation",
  "actor": "Actual recording operator",
  "expectedVersion": 12,
  "mode": "NEW",
  "authorityId": "retained-hourly-authority-id",
  "expectedAuthoritySha256": "retained-authority-sha256",
  "reason": "Customer-authorized accepted implementation Work",
  "issueDate": "2026-10-13",
  "dueDate": "2026-11-12",
  "effectiveDate": "2026-10-13",
  "resolution": "CREDIT",
  "purchaseOrder": "",
  "note": "",
  "lines": [{
    "workId": "original-work-id",
    "expectedWorkSha256": "current-original-work-sha256",
    "rateId": "implementation",
    "hours": "1.2500",
    "description": "Actual accepted Work description"
  }]
}
```

Prepare sends the exact preview body plus its returned `expectedPreviewSha256`. Corrections add `previousId` and use `DRAFT_EDIT`, `CREDIT`, `VOID` or `REPLACE`. Apply uses `{actor,expectedProposalSha256}`; cancel adds original `requestId` and `reason`; issue uses `{actor,expectedIssuePreviewSha256}` plus the actual `creditDecisionId` only when required.

## CLI and managed clients

Use `work-billing-catalog`, `work-billing-authority --authority ID`, `work-billing-save-authority --file request.json`, `work-billing-preview`, `work-billing-prepare`, `work-billing-show`, `work-billing-apply`, `work-billing-cancel`, `work-billing-preview-issue`, `work-billing-issue`, `work-billing-refresh` and `work-billing-export`. All use the original `--case`; charge continuations use `--charge`, writes use the complete original `--file`, and export requires `--output`.

The managed client/MCP surface follows the same routes and original strings. It cannot bypass Work acceptance, customer terms, native credit review or an unresolved original journal.

## Producing and receiving the whole product

Run the actual complete course against a newly restored private copy of the retained native demo/customer account. Verify the original archive hash and accounting identity before opening it. Keep the source archive, original paid invoice, all original receipt/allocation histories and original request IDs unchanged.

Operate the actual served UI: record an hourly authority, accept original Work through the native Work controls/API, select fractions of hours, preview/prepare, lose a real successful response, replay the original request, correct a refused input, draft/issue, credit/replace, save/open the working desk, download the whole case and reopen its native account at a different private path.

The producing agent must LOOK at the actual final desktop and 390-pixel views in light and dark embedding contexts, including labels, disabled controls, rate scopes, authority caps, pending/rejected recovery, native invoice/credit HTML and complete export. Operate the controls and inspect every outgoing attachment and usable ZIP content. Fix concrete defects directly. Retain the complete editable source, original input identities, saved case and real run outputs together in the original SCF case; preserve private account bytes and keys in their original authorized retention.
