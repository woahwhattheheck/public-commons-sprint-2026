# Accountant handoffs

The **Accountant handoffs** area in the merchant accounting workspace takes a completed reconciliation through an accountant's returned bookkeeping file. Prepare a labeled CSV, retain an offline handoff, preview the accountant's changes, and save the matched references beside the original payment records. Reopen any earlier handoff or return later.

## Open the workspace

Use the existing [merchant workspace command](../workspace/README.md). The maintained distribution exposes the same application:

```sh
starforge merchant-accounting-workspace --workspace /private/merchant/accounting-workspace
```

For a source checkout, run:

```sh
node stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/server.mjs \
  --workspace /private/merchant/accounting-workspace
```

Open the printed local address, enter your operator name, and choose **Accountant handoffs**. Completed reconciliations from the original workspace appear immediately. When recorded-activity periods are installed, saved period closes appear in the same source selector.

## Prepare a handoff

1. **Choose the original source.** Select a completed reconciliation or a saved period close. The source summary shows its original networks, event count, and transfer matches. A period close carries its frozen exception notes and the original period scope.
2. **Add useful account labels.** Each original payment option has separate asset, unit, account code, and account name fields. For example, an XLM option can use `XLM`, `stroops`, and the merchant's clearing-account code. Labels describe the existing amount; the displayed atomic amount keeps its original exact value. Options on different networks or with different assets remain separate.
3. **Name and retain the handoff.** Use a name that the merchant and accountant recognize, such as `October recorded activity — first review`. Saving retains the exact source report, source identifiers, labels, preparation time, and operator.
4. **Download the accountant CSV or complete archive.** The archive includes an offline HTML review, the editable CSV, structured handoff, original report, and a file manifest. A period-based handoff also includes the original period close and frozen review notes.

The original report manifest and input manifest travel with the packet, retaining the source hashes and captured-file references used by the original reconciliation. Individual files remain available in the local workspace.

## Carry refunds and cancellations into the books

Record the later customer operation in the workspace's **Adjustments** area, then prepare the accountant handoff from the original reconciliation. Each payment keeps its original gross amount alongside verified refunds, pending refund requests, remaining amount, and recorded cancellations. The row detail and offline review show the refund's native transfer time separately from the merchant's cancellation effective date.

A handoff freezes the adjustment state that was selected when it was saved. Choosing a saved period close uses that close's original adjustment files; later refunds appear in a newly prepared live handoff. For example, a payment of `50000` atomic units with a verified refund of `12000` remains a gross payment of `50000`, with `12000` returned and `38000` remaining. A cancellation remains a separately dated merchant record. Pending refund requests stay separate from verified returned money.

The complete archive includes `adjustments.json`, the full history in `adjustments.csv`, and an offline `adjustments.html` review. These same original files accompany every returned bookkeeping revision. Their source hash, per-payment amounts, refund status and latest operation dates are protected columns in the accountant CSV. Edit the four bookkeeping columns below and retain the supplied header. To account for a later adjustment, create another handoff from the updated reconciliation.

Structured summaries group exact atomic amounts by network and asset. A verified return above the original gross payment is visible as an over-return and negative remaining amount; it is preserved for review. Older saved handoffs retain their original CSV template and source.

## Return the bookkeeping file

The accountant edits four columns in the supplied CSV:

| Column | Use |
| --- | --- |
| `externalStatus` | `UNREVIEWED`, `REVIEWED`, `BOOKED`, or `EXCLUDED` |
| `externalBookRef` | External journal or transaction reference; required for `BOOKED` |
| `externalAccountCode` | The account used in the external books |
| `externalNote` | Review explanation or follow-up, including multiline text |

Several events can share an external reference when the accountant posts a batch journal. Account labels prepared by the merchant stay in their own protected columns; the accountant's actual account code goes in `externalAccountCode`.

Keep the complete header and the protected source columns. Import numeric-looking source values as text in a spreadsheet so an amount such as `50000` keeps that exact representation. The CSV uses UTF-8 and normal quoted fields. Reordered columns and rows, a UTF-8 byte-order mark, LF or CRLF line endings, and quoted multiline notes are supported.

In the workspace, select the handoff's **Latest retained version**, name the return, choose the CSV, and select **Preview returned file**. The preview reports matched changes, unchanged rows, conflicts, unknown rows, and original events missing from the return. Inspect the per-row results before selecting **Save matched changes**.

An exact, valid row updates its four bookkeeping fields. An omitted row keeps its previous saved assignment. A row with a changed amount, network, option, source identity, or other protected value keeps its previous assignment and appears as a conflict. Duplicate or cross-wired source identities protect every affected original event. Other valid rows in the same file can still be saved. The full returned file and its conflict results stay available with that revision.

For a correction, download the latest accountant CSV, correct the returned fields, and preview it again. Each save adds a revision. Earlier CSVs, returned files, offline reviews, and complete archives remain available through the version selector. If another return was saved while a preview was open, load the latest version and preview again so the new import uses the current assignments.

## Inspect the result

The event table shows each original method, route, network, exact atomic amount, current bookkeeping status, and external reference. Filter by status or search the source and returned fields. Open an event to see its complete original record, the merchant's labels, the accountant's current assignment, and its last change attribution.

The summary distinguishes original event counts from the accountant's `BOOKED`, `REVIEWED`, and `EXCLUDED` statuses. Original testnet or public-network classification remains visible. Merchant USD quotes and unknown costs keep their original meaning and value; labeling an event or attaching a journal reference does not recalculate its amount or valuation.

## Retention and integration

Handoffs and returns live in the original private workspace under `accountant/`. A saved return contains the exact uploaded bytes, its complete current assignment set, per-row outcomes, the parent revision, the original source binding, and updated CSV/HTML/archive downloads. The original workspace's filesystem lease, revision checks, atomic state save, and operator history also govern this workflow. Stable request IDs make a repeated completed save return the same retained result.

The local interface accepts returned CSV files up to 64 MiB. It retains up to 2,000 handoffs and 2,000 returns per handoff, subject to the original workspace's overall state limit. Close the application before backing up the private workspace directory. Reopening the same directory restores the handoffs and all saved versions.

The [engine contract](SCHEMA.md) documents the pure `createHandoff`, `importReturn`, `renderCsv`, `renderHtml`, and inspection APIs. The connected `AccountantWorkspace` uses that engine through these routes:

| Route | Operation |
| --- | --- |
| `GET /api/accountant` | Retained handoffs, original closes, and current workspace revision |
| `GET /api/accountant/source?runId=…` | Prepare a completed original reconciliation; `closeId` selects an original close |
| `POST /api/accountant/handoffs` | Retain a labeled source handoff |
| `GET /api/accountant/handoffs/:id` | Inspect the selected handoff and returned version |
| `GET /api/accountant/handoffs/:id/rows` | Page and filter original events with current assignments |
| `POST /api/accountant/handoffs/:id/preview` | Preview exact returned bytes against the current saved return |
| `POST /api/accountant/handoffs/:id/returns` | Save the reviewed result using its ID, timestamp, digest, parent, and workspace revision |
| `GET /api/accountant/handoffs/:id/download/:name` | Download an immutable retained file |

Inspection and downloads accept `revisionId=initial` or a saved return ID; omitting it selects the latest saved return. Writes use the original local workspace JSON header and operator identity. The original merchant accounting report stays the shared source for the browser, pure engine, and service adapters.
