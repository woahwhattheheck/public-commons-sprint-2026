# Buyer-only accounting through the configured MCP host

A host can now declare the original accountant as a buyer-only workspace. The
same accounting provider retains an issued buyer period, its expense and credit
allocations, the first accountant handoff, returned bookkeeping references and
the original Xero and encrypted-recovery histories. The input is the native
`stellar-forge.buyer-accountant-source.v1` document produced by the buyer expense
workspace; its validator remains the authority for the exact accepted schema.

## Declare the original source

Use `sourceMode:"buyer"` on the existing accounting workspace declaration. The
workspace directory may be new or an already initialized original buyer-only
accountant. Paths resolve relative to the host's configuration file.

```json
{
  "workspaces": {
    "expenses": {
      "label": "Buyer expense accounting",
      "sourceMode": "buyer",
      "directory": "./buyer-accounting",
      "buyerSources": {
        "issued-period": "../issued/period-accountant-source.json"
      },
      "accountantReturns": {
        "reviewed-return": "../accountant/returned.csv"
      },
      "platformInputs": {
        "xero-context": "../accountant/original-xero-context-request.json",
        "xero-plan": "../accountant/reviewed-xero-plan.json",
        "xero-response": "../accountant/original-xero-response-request.json"
      },
      "recovery": {
        "stateRoot": ".",
        "backupRoot": "../accounting-backups",
        "passEnv": "STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE"
      }
    }
  }
}
```

Declare only the aliases whose original files are actually available. Empty maps
may be omitted. Keep the state and source directories private (0700) and the
issued file private (0600). The original startup reader accepts a regular,
owner-controlled source up to 64 MiB, checks its exact bytes while reading, and
validates the native issued period and aggregate allocations.

This standalone declaration is accepted by the existing initializer:

```sh
starforge merchant-mcp init-accounting --dir /absolute/private/accounting-operator --accounting /absolute/private/accounting.json
starforge merchant-mcp serve --config /absolute/private/accounting-operator/merchant-mcp.json
```

The ordinary host still uses its configured loopback listener and bearer
credential. Existing stdio and configured-provider clients expose the same
registered accounting tools. Configuring the provider does not initialize the
accounting directory, import a source, contact a bookkeeping service or make a
payment.

An existing merchant configuration can instead include the declaration under
`accounting`; preserve its other provider settings. An omitted sourceMode keeps
the existing merchant contract, including its required outbox, proof and terms
paths. A buyer declaration omits those paths and merchant-only input maps. Its
supported accounting operations are source startup, accountant handoff/returns,
Xero, exact retained files and native operating recovery. The host reports these
capabilities with each alias. Merchant sales, collection, statements, Bitwave,
Cryptoworth and runbook operations continue under their original merchant alias.

## Preview and explicitly initialize

1. Call `merchant_accounting_sources` and select the declared buyer alias.
2. Call `merchant_accounting_buyer_source_preview` with `workspace` and
   `source`. It reads the original private file without opening a workspace.
3. Keep its returned `sourceSha256`. Review the original period, source context,
   exact native totals, credits and outstanding reservations.
4. To read the complete source review, use `view:"allocations"`,
   `"outstanding"` or `"captures"`, with `offset` and `limit` (up to 200).
   Supply the same sourceSha256 on every subsequent page. A changed original
   file rejects that old selection.
5. Submit `merchant_accounting_buyer_initialize` with the same alias and digest,
   plus the actual source name and operator.

Example tool arguments, with the digest copied from that actual preview:

```json
{
  "workspace": "expenses",
  "source": "issued-period",
  "sourceSha256": "<exact SHA256 returned by source_preview>",
  "name": "Reviewed issued expense period",
  "actor": "<operator name>"
}
```

Initialization uses the original Store lease and startup writer. It retains the
complete issued bytes in the accountant's private inputs, source context and
summary, original initialization name/operator, and the native first-handoff
UUID. Its result includes the actual workspace/source binding and that startup
record. The response keeps the original workspace ID and source-binding digest;
host-owned input paths are omitted from the buyer projection. Original source
values and reviewed request text remain unchanged. The configured accounting
session then opens normally, or remains in
the explicitly declared paused-recovery mode.

After an uncertain response, repeat the identical initialization arguments.
An accepted initialization recovers from its retained original source without
rereading the former import file. Changing the source digest, name or operator
does not silently replace that retained initialization. The source alias remains
a host declaration; recovery does not allow arbitrary file paths.

Once initialized, `merchant_accounting_open` reopens the retained directory.
It reads the original source binding and the Store rechecks it under the writer
lease. Reopening does not require the former import path or a new source alias.
The host cannot reinterpret a merchant directory as a buyer directory.

## Prepare and recover the first handoff

Call `merchant_accounting_buyer_startup` after opening. It returns the original
binding, current workspace revision, source identity and first-handoff UUID.
Then call `merchant_accounting_buyer_prepare` with the retained sourceSha256.
This reads the retained issued file and supports the same complete paged review
as the pre-initialization preview.

Use `merchant_accounting_buyer_handoff` with:

| Field | Original value to retain |
| --- | --- |
| workspace | The configured buyer alias. |
| handoffId | The native startup UUID returned by prepare. |
| sourceSha256 | The retained original issued-source digest. |
| revision | The current workspace revision shown by prepare. |
| name | The reviewer's handoff name. |
| actor | The named reviewer. |

Save that full request before submission. The original accountant writer uses
the same startup ID and request identity on every retry. If it accepted the
handoff but the reply was lost, the identical request recovers its original
record before checking the now-old workspace revision. A different name,
operator or source under that same ID remains a request conflict.

The existing `merchant_accounting_accountant`,
`merchant_accounting_accountant_rows`,
`merchant_accounting_accountant_preview` and
`merchant_accounting_accountant_apply` tools inspect and review the original
handoff and its returned editions. The existing
`merchant_accounting_accountant_buyer_prepare/create` path remains available
for an explicitly selected additional issued source; it does not replace the
startup's retained source or first-handoff identity.

## Read exact original files

Use the existing retained file reader with `kind:"buyer-source"` to retrieve the
startup's complete issued bytes. It requires only the workspace selection; do
not attach unrelated handoff, plan or report selectors.

```json
{
  "workspace": "expenses",
  "kind": "buyer-source",
  "offset": 0,
  "limit": 196608
}
```

Keep the returned readId, exact digest and selectors unchanged for subsequent
chunks. The reader supplies the original filename, byte count and base64 data.
Release an incomplete read with `merchant_accounting_file_release`.
`kind:"accountant"` continues to select the exact handoff/return and its
original allowed file, including `buyer-return.json`.
`kind:"xero"` continues to select the original native plan's retained files and
`xero-handoff.tar`. These reads do not query a merchant or repeat a purchase.

## Continue the existing Xero operation

The buyer session opens the original Xero controller and the same accountant
instance. It does not initialize the unrelated merchant collection, sales or
QuickBooks controllers. The original source, context, plan, operation, response,
comparison and return APIs retain their existing contract.

Use [the maintained platform guide](./ACCOUNTING-PLATFORMS.md) and
[its existing customer SDK and durable CLI](./ACCOUNTING-PLATFORMS-CLIENT.md) for:

- A retained native Organisation/Accounts context or an explicitly requested
  provider capture under an already configured tenant.
- The selected buyer handoff and exact accountant return revision.
- Explicit dated fiat amounts, chart accounts, source descriptions and reasons.
- A reviewed native draft, original saved operation and response capture.
- The existing accountant-return preview, application and lost-reply recovery.
- Exact handoff/return files for the original buyer workspace to accept.

A zero-native allocation cannot acquire an unrelated positive fiat valuation;
the original Xero decision path retains an explicit exclusion where required.
Unknown prices and currencies retain their original meaning. A provider's draft
or posted status is recorded separately from the original purchase, delivery,
native amount, development/testnet scope and buyer-return acceptance.

Nothing in source preparation, initialization, reopen, first handoff or file
reading performs a provider request. Actual journal creation or refresh remains
the existing explicit Xero operation with its original request ID and lifecycle.

## Pause, back up, receive and reopen the same operation

The existing `merchant_accounting_maintenance_*` tools retain the whole native
buyer accountant using its declared state root and separate backup catalog.
Use the original sequence: pause, review, acknowledge stopped external writers,
capture the encrypted backup, verify the exact selected backup, restore its
original destination, then resume. Keep each native request ID, review identity
and archive digest. The passphrase stays in its host environment variable.

The backup includes the original startup source and binding, native workspace
history, first handoff, Xero context/plans/responses, returned editions and
source files under the original recovery rules. An incomplete restore retains
the same native marker; resume that authenticated original backup rather than
initializing over it.

Close the MCP alias before opening the same directory in the original
accountant browser, buyer CLI or managed Applications. All use the existing
exclusive writer lease. Close drains accepted calls and verified readers.
Provider-wide close also finishes any already accepted source previews.

The [original buyer CLI](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/BUYER_ACCOUNTING.md)
and managed Applications source binding use this same retained startup.
Their normal close/reopen does not create another buyer period, handoff or
accounting source.
