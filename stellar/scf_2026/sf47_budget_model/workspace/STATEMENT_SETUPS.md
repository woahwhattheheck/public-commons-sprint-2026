# Saved statement setups

Use **Account statements → Use a saved statement setup** to carry an account's
actual import choices into the next period. A setup belongs to this grant case.
Every save creates a named edition with the operator, reason, original mapping
basis and exact previous edition. Full case export and reopen carry that history.

## Save the first period's setup

1. Choose the original CSV, OFX/QFX or MT940 file in Account statements.
2. Set the stable account key, readable account label and currency. Map the CSV's
   exact headings, date order, decimal/grouping marks and amount convention. For
   OFX or MT940, inspect the original file and select the bank account. MT940
   retains its explicit transport, encoding, reversal interpretation, century
   window, currency precision and value-date basis.
3. Enter a clear setup name such as **Project operating account — monthly CSV**
   and a reason describing this interpretation.
4. Choose **Save current mapping as a new setup**. The case records edition 1
   through its existing request and source history. The current statement selects
   that exact edition.
5. Reconcile this period's balances, review the original rows and allocations,
   preview, confirm and import as usual. The import retains the unchanged source
   file, the actual mapping and the selected setup name and edition.

A setup saves configuration. Its creation does not receive cash. Statement
preview and import remain the cash receiving actions.

## Receive the next month

Choose the next original file before selecting a setup. The comparison names the
saved bank/account, currency and source format and shows every interpretation
choice that would change the current mapping.

For CSV, the comparison lists exact header matches, missing mapped headers,
other missing headings and new headings. A changed column order is allowed
because mapping uses the original names. Missing mapped headings require an
explicit current mapping; the desk never substitutes a similar-looking name.

Choose **Apply this setup** after reviewing that comparison. The selected
original file stays attached. The desk clears balances, row decisions, invoice
allocations and the prior bank section selection. Supply this period's actual
balances and decisions. For native bank formats, inspect the new file and select
its original account; the receiving API checks that the account context matches
the setup.

Account key, label, currency, date order, number separators, signed direction,
CSV columns, default category and MT940 interpretation remain visible in the
ordinary statement mapping. If any reusable choice changes, the desk clears the
selected setup link. Review the changed mapping and save a new edition before
importing if this should become the next reusable configuration.

## Revise, retain or archive

Select the named setup, edit the current actual statement mapping, enter a reason
and choose **Save new edition from current mapping**. The original edition stays
available. A stale case or earlier revision cannot overwrite a later edition;
refresh and compare the latest saved choice first.

Use **Save current mapping as a new setup** for a different bank, account,
currency or import convention that should have its own name and history.
**Archive setup** appends an archived edition while retaining all earlier source
records. Earlier active editions remain explicitly selectable for historical
work; the picker labels the archived series. Archived editions themselves cannot
be applied.

A chosen edition is stable even if a newer edition is saved later. No later save
rewrites an earlier imported statement. **Clear setup selection** keeps the
editable current mapping and file and removes only its reusable-edition link.

## Original source, recovery and handover

The setup keeps the original mapping file's name and SHA-256 plus exact CSV
headers or the selected native account context. The statement import preserves
the full original file and its complete interpretation through the existing
statement source/review pair. A setup does not copy month-specific transactions,
balances, invoice allocations, exclusion reasons, valuations or source notes into
the next period.

The browser saves the exact setup request before sending it. If the response is
lost, **Resume saved setup request** reuses its original request ID and payload.
A returned receipt is reconciled with the saved case before the desk resumes
editing. **Download recovery copy** carries the pending setup request with the
current statement draft. Staff drafts remain scoped to the existing Staff
session identity.

The complete case ZIP includes every setup edition in the ordinary retained
source list. On case import, setup source digests, ordered revisions, original
save events and statement selections are checked together. Original statement
reopening displays the selected setup name and edition. The source JSON keeps
the exact settings and prior-edition link for independent downstream use.

## Native API and CLI

Use the existing command endpoint:

`POST /api/operations/{caseId}/command`

A first save has this shape. The `inputs` value is the complete actual current
statement input accepted by the existing Statements desk:

~~~json
{
  "expectedVersion": 12,
  "actor": "Finance operator",
  "note": "Use the bank's YYYY-MM-DD debit/credit export for this account.",
  "requestId": "original-stable-request-id",
  "action": "statement-setup.save",
  "data": {
    "expectedRevision": 0,
    "name": "Project operating account — monthly CSV",
    "status": "ACTIVE",
    "inputs": {}
  }
}
~~~

Replace the empty illustrative `inputs` object with the actual source and mapped
statement input. A revision includes `id` and the latest `expectedRevision`.
Archiving supplies the existing `id`, current revision, name and
`status: "ARCHIVED"` and omits `inputs`. Both operations use the ordinary case
version guard and stable request identity.

The result includes `statementSetup`, and the ordinary case read includes
`statementSetups`, containing complete edition summaries with settings and
mapping basis. Select an edition by copying exactly its
`id`, `name`, `revision`, `sourceId`, `sourceSha256` and `editionSha256` into the
statement input's optional `statementSetup` field. The preview and retained
review carry that same link. A different interpretation or bank account is
rejected until the caller clears the link or saves and selects a matching edition.

The existing generic Operations command CLI and Merchant grant-case command use
this same action and payload. Existing statement inspection, preview and receive
interfaces retain their roles; statement setups add no separate cash writer.

## Practical first-to-next-period operation

For a CSV whose original headings are
`Date,Reference,Description,Debit,Credit,Currency`, map those exact names to the
date, reference, description, debit, credit and currency fields, choose
`DEBIT_CREDIT`, the actual date order and separators, and save a named setup.
When the next file presents the same headings in a different order, the
comparison shows the order change and applies the same names. If the bank changes
`Reference` to `Transaction Reference`, the missing mapped heading is visible
and Apply remains unavailable. Map the new heading explicitly and save edition 2.

The next import still requires its own balances, actual row classifications and
invoice allocations. Reopening the earlier statement continues to select
edition 1 and its original source interpretation.
