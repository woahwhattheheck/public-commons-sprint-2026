# Supplier account workspace

Use this workspace to change shared supplier allowances and route membership in
the merchant's original working upstream configuration. It completes the
existing account inspection screen with a retained draft, review, save, recovery
and receiving workflow.

The original SF30 supplier registry and Routescan quota ledger continue to own
dispatch reservations, rolling usage and provider cooldowns. This workspace
changes the configuration that the maintained merchant reads at its next normal
start. Account directories and their saved quota records stay in place.

## Open the original merchant

In the maintained **Applications** screen, choose **Supplier accounts**. Select
the private workspace directory and the merchant's existing
`stellar-forge.seller-upstreams.v1` file. Prepare and start that
application, then select **Open**. The same saved application supports the
original **Stop** and reopen workflow.

The installed command provides the same local screen:

~~~sh
starforge supplier-accounts serve \
  --state /private/merchant/supplier-workspace \
  --upstreams /private/merchant/upstreams.json \
  --port 0
~~~

The command prints its actual private launch URL. The listener binds to
127.0.0.1, uses its original per-start access token and accepts browser changes
only from its own origin. The token stays in the URL fragment and that tab's
session storage. Opening a new host instance uses its new launch link.

Select the merchant's working configuration file. Source-bound API packages and
retained release editions continue through their existing package revision and
release-store workflow. The original merchant launcher remains the startup and
drain owner.

The upstream file must be a regular file, with one link, in a real private
directory owned by the operator. The workspace is also private. Configuration
inspection reads the JSON and its source identity; it does not load the values
of credential environment variables.

## Configure and review

1. Load the original source. The screen shows the filename, content digest and
   capture time.
2. Edit an account's **Calls per second** or **Calls per rolling 24 hours**.
   Existing account labels, credential references and quota directories remain
   attached to their original alias.
3. To add an account, enter its alias, stable provider-account label, original
   private quota directory and optional credential environment reference.
   Assign at least one original binding to that account.
4. Change a binding's account selection where several products use the same
   supplier allowance. The source method, request mapping, authentication,
   response contract, cache, idempotency and other original fields remain with
   that binding.
5. Add a reason and select **Prepare review**. Inspect the retained account and
   assignment changes and their source revision.
6. Select **Save reviewed change**. The workspace checks the original file
   again, saves the reviewed configuration and retains its outcome.
7. Use the merchant's normal managed stop and start to load the saved
   configuration. Coordinate the same policy across processes using the same
   supplier account.

**Retire** removes that account from the draft and unassigns its bindings. The
review displays those changes together. The original quota directory and history
remain available, and adding the same retained alias reuses its original
identity. Aliases, directories and account identities cannot be reassigned to
another retained account.

The allowance unit is an original supplier call. Provider-specific credits,
weighted operations and monetary tariffs retain their existing source
calculations. The compiler continues to enforce 1–1,000 calls per second and
1–100,000,000 calls per rolling 24 hours.

## Continue a changed source

Refreshing the page's saved source retains an edited draft and its original
digest. The screen identifies a stale draft. **Download draft JSON** preserves
those values for the command-line workflow; **Use saved configuration** starts a
new draft from the current source.

A retained review can be continued with **Rebase review on current source**.
This creates a new review for the same intended edits against the current file
and closes its predecessor with a link to that review. Unrelated fields,
bindings, accounts and independently changed limit fields survive. If a later
edit changes the very same account field or binding assignment, review the
current configuration and choose its desired value.

Each review is bound to the file's original content, device and inode. All
workspace writers use the same source-path lock and re-read the file immediately
before publishing. A changed source remains available for inspection and a new
review.

## Recover an interrupted save

A source save has a retained **APPLYING** state before the original file is
replaced. If the response is lost, open that same change and select **Recover
this save**.

| Current original source | Continuation |
| --- | --- |
| Exact reviewed target already present | Record the existing saved result in the same change. |
| Exact original file still present | Continue the same retained save. |
| Original save has a partial private output | Verify its original inode and exact target prefix, finish the missing bytes and continue that save. |
| Source was independently changed | Retain the conflict and prepare a new review against current source. |
| Same source bytes moved to a receiving file | Prepare a new receiving review with the new file identity and its original review link. |

An already saved change returns that same saved outcome when recovered again.
The account registry is never replaced or reinitialized by recovery.

A mismatching private pending file is retained for operator inspection. It is
not used as the reviewed output.

## Restore an earlier change

Open an applied change and select **Prepare restoration**. The workspace
prepares the inverse of that original account and assignment edit against the
current source. It preserves later unrelated changes and checks fields that
were subsequently edited.

When the complete reviewed target remains the current file, restoration uses
the exact original source bytes. This preserves the original source document,
including its formatting. When later independent edits exist, the inverse
change preserves their configuration values.

The restoration is another retained review. Save it through the same source
check and normal merchant startup.

## Read retained usage

Choose **Read account usage** to open the original account registry and inspect
its actual local ledger. The screen shows calls in the rolling window, remaining
allowance, total dispatches, the next available time and any supplier cooldown.

The capture is evaluated against the currently saved policy. An already
running merchant continues to use its own loaded policy until its normal
restart. Every real supplier dispatch still uses the original atomic
reservation.

A policy change does not delete quota files, reset counters, replace account
IDs or clear supplier cooldowns. The minute-bucket and provider Retry-After
semantics are those of the maintained quota engine.

## Command-line operation

Initialize once, or reopen the same private state:

~~~sh
starforge supplier-accounts init \
  --state /private/merchant/supplier-workspace \
  --upstreams /private/merchant/upstreams.json

starforge supplier-accounts show \
  --state /private/merchant/supplier-workspace
~~~

Export an editable draft:

~~~sh
starforge supplier-accounts proposal \
  --state /private/merchant/supplier-workspace \
  --out /private/merchant/proposed-accounts.json
~~~

The draft has these fields:

~~~json
{
  "sourceSha256": "the source digest returned by the original workspace",
  "accounts": [
    {
      "alias": "market-data",
      "directory": "/private/merchant/supplier-market-data",
      "account": "market-data-primary",
      "apiKeyEnv": "MARKET_DATA_API_KEY",
      "requestsPerSecond": 3,
      "callsPerDay": 1000
    }
  ],
  "assignments": [
    { "binding": "quote", "account": "market-data" },
    { "binding": "price", "account": "market-data" }
  ],
  "note": "Use the current supplier allowance for both products."
}
~~~

Use the actual source digest and complete original binding inventory from the
exported draft. An unassigned binding uses `null` for its account.

~~~sh
starforge supplier-accounts prepare \
  --state /private/merchant/supplier-workspace \
  --draft /private/merchant/proposed-accounts.json

starforge supplier-accounts review \
  --state /private/merchant/supplier-workspace \
  --id CHANGE_ID

starforge supplier-accounts apply \
  --state /private/merchant/supplier-workspace \
  --id CHANGE_ID --revision 0 --review-sha256 REVIEW_SHA256
~~~

Use the returned change ID, revision and review digest. **recover** takes the
same three fields from the current retained record. **cancel** takes the current
change ID and revision.

**restore-change** and **rebase** take the original change ID plus the current
source digest and return a newly prepared review:

~~~sh
starforge supplier-accounts rebase \
  --state /private/merchant/supplier-workspace \
  --id ORIGINAL_CHANGE_ID --source-sha256 CURRENT_SOURCE_SHA256

starforge supplier-accounts restore-change \
  --state /private/merchant/supplier-workspace \
  --id APPLIED_CHANGE_ID --source-sha256 CURRENT_SOURCE_SHA256

starforge supplier-accounts inspect \
  --state /private/merchant/supplier-workspace
~~~

An optional **--note-file** selects a private JSON file containing one string.
**show --offset N --limit N** pages the retained review history.

## Complete handover

**Download account history** and the **report** command produce a readable
configuration and change-history report. Those reports include account
declarations, assignment changes and safe source metadata; the underlying
complete upstream source documents stay in the private workspace.

The **backup** command saves the complete original source revisions, immutable
reviews, outcomes, identity registry and operating events. It preserves unknown
upstream fields and credential references as supplied in the original JSON.
It does not expand environment variables.

~~~sh
starforge supplier-accounts report \
  --state /private/merchant/supplier-workspace \
  --out /private/merchant/account-history.json

starforge supplier-accounts backup \
  --state /private/merchant/supplier-workspace \
  --out /private/merchant/supplier-workspace-backup.json

starforge supplier-accounts receive \
  --state /private/receiving/supplier-workspace \
  --upstreams /private/receiving/upstreams.json \
  --backup /private/receiving/supplier-workspace-backup.json
~~~

Outputs are created as new private files. Receiving requires a new or empty
workspace and the same exported upstream content. An interrupted empty-target
initialization can be continued; receiving the same completed backup again
returns that same received workspace.

Keep the original quota directories and account identity with the merchant's
normal complete receiving package. This configuration backup carries operator
history. It does not replace that existing ledger transfer.

Applied history stays applied. A pending review still names the original source
file. If that file moved, prepare a receiving review with **rebase**; it retains
the original review and binds the continuation to the actual receiving file.
An interrupted save whose target bytes are already present can instead recover
its existing saved result.

## JavaScript integration

The installed distribution exports:

| Import | Maintained functions |
| --- | --- |
| `@tokenjunkielabs/starforge-merchant/seller/supplier-accounts` | `openSupplierAccountWorkspace`, `inspectSupplierAccountSource`, `restoreSupplierAccountWorkspace` |
| `@tokenjunkielabs/starforge-merchant/seller/supplier-accounts/server` | `startSupplierAccountWorkspace` |
| `@tokenjunkielabs/starforge-merchant/seller/supplier-accounts/application` | Original Applications provider and startup reader |

`openSupplierAccountWorkspace({directory, upstreamsFile})` returns
**view**, **read**, **prepare**, **prepareRebase**, **prepareRestore**, **apply**,
**recover**, **cancel**, **inspectQuota**, **report**, **backup** and **close**.
The mutation methods return the retained change with its revision, original
review and review digest. Full source documents are available only through the
private backup operation.

`startSupplierAccountWorkspace` returns the original **origin**,
private **url**, **port**, **workspace** and idempotent **close**. It drains HTTP
work before closing an owned workspace. A supplied workspace remains with its
caller.

The source-owned distribution contribution registers the installed command,
help text, exports, browser assets and Applications provider together. The same
files are used from a checkout and from the maintained cumulative release.
