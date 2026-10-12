# Bookkeeping on an issued buyer period

Use an existing reviewed, closed period. The **Export source to accountant** button produces a stable file with the exact original close and workspace identity. Load it in the maintained accountant workspace, create the handoff, and use its existing CSV or Xero process. Return the saved `buyer-return.json` to this same issued edition.

## Review and accept

The Bookkeeping returns panel checks the original source bytes and accountant revision chain before it offers acceptance. Inspect the references, reviewer/status and any overlap with another handoff. Name the operator and return. If another accepted handoff covers the same original allocation lines, select every handoff being superseded and state the reason.

Saving uses the original Store transaction and request journal. Keep the request identity if a response is interrupted. **Recover original request** reads the committed response; **Retry exact request** submits the same body and revision. A definitive source conflict requires a fresh preview. Opening an older accepted return shows its retained data and whether it is current.

These entries record bookkeeping references. They do not change the original expense/credit amounts or financial period. Reopening and correcting a period still creates another reviewed close through the existing financial workflow.

## Native API

| Action | Route |
| --- | --- |
| Export immutable source | `GET /api/closes/{closeId}/accountant-source` |
| Page accepted returns | `GET /api/closes/{closeId}/accountant-returns?offset=0&limit=50` |
| Preview original return | `POST /api/closes/{closeId}/accountant-preview` |
| Accept reviewed return | `POST /api/closes/{closeId}/accountant-return` |
| Read retained return | `GET /api/accountant-returns/{id}` |
| Download original packet | `GET /api/accountant-returns/{id}/original` |
| Export period and bookkeeping | `GET /api/closes/{closeId}/bookkeeping-packet?expected_revision={revision}` |

Preview accepts `{payload:{content_base64,sha256}}`. Save accepts the existing `{request_id,expected_revision,payload}` envelope. Its payload adds `preview_sha256`, `operator`, `name`, `reason` and `supersedes` to those exact original bytes and SHA. Supersedes is an explicit array of prior accepted return IDs, or an empty array when none overlap.

A bookkeeping ZIP contains the original financial accountant packet, issued buyer source, complete accepted-return history, current book-reference table, a readable review and every original returned packet. Its workspace revision is checked while the original Store lock freezes the complete selection.

## Existing MCP/customer tools

In the host's private buyer-expense connection, declare the original returned file under the selected workspace:

```json
{
  "accountantSources": {
    "reviewed_return": {
      "sourceFile": "/absolute/private/buyer-return.json",
      "sourceSha256": "EXACT_64_CHARACTER_SHA256",
      "name": "Reviewed accountant return",
      "provenance": "Original named handoff and selected returned edition"
    }
  }
}
```

This is a field within the existing workspace configuration; keep its directory and any ledger, quote, Woo or generic adjustment aliases. The file must be an owned private regular file. The host reads exactly that alias and verifies its pinned SHA. Tool arguments do not accept arbitrary source paths.

New tools use the existing `merchant_buyer_expense_` prefix:

- `accountant_returns`: page history for `closeId`.
- `accountant_return`: inspect an accepted return, with summary, rows or revisions.
- `accountant_preview`: review `closeId` with `accountantSource`.
- `accountant_return_save`: accept the reviewed packet with the same mutation envelope.
- Existing `export` also supports `buyer-accountant-source`, `bookkeeping` and `accountant-return`. Use the close or return as `recordId`; bookkeeping requires `expectedRevision`.
- Existing `request`, retained download, original source/credit operations and complete-project receiving continue unchanged.

The existing `openBuyerExpenseClient` exposes these as `accountantReturns`, `accountantReturn`, `accountantPreview` and `accountantReturnSave`. It uses the same configured MCP transport, validation and retained file client.

## Moving the complete buyer project

The complete-project ZIP retains the original issued periods, source and credit packets, all accepted bookkeeping returns, head selection and successful request responses. It includes the fixed accountant reader and original validation dependencies. Open it through the included receiving instructions; no repository checkout or original ledger is needed.

New return validation uses Node 22.13+ or Node 24 through the existing `--node` option. Reading previously retained history uses the native buyer application. Xero authorisation stays with the original accounting connection and is not copied into this buyer package.

Original development/testnet context, unknown fiat valuation and native atomic units remain explicit in both source and return. A bookkeeping reference does not independently assert a new on-chain transfer or a live-company posting.
