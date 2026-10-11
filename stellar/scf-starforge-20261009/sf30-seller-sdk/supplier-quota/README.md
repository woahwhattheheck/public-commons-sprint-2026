# Shared supplier accounts

A merchant can use one supplier account behind several paid routes or seller
processes. This module gives those original dispatches one shared call allowance
and keeps the supplier's rate-limit cooldown with the account.

The integration composes the maintained Routescan quota engine. Its existing
atomic reservation, process lock, saved state and recovery behavior remain the
account owner. The original SF30 upstream dispatcher checks that account before
contacting the supplier.

## Configure the existing upstream seller

Add a **supplierAccounts** object to the existing
**stellar-forge.seller-upstreams.v1** configuration. Keep its existing routes,
request mappings, secrets references, cache and delivery settings.

The following is the supplier-account portion to compose into that file:

~~~json
{
  "supplierAccounts": {
    "market-data": {
      "directory": "/var/lib/starforge/suppliers/market-data",
      "account": "market-data-primary",
      "apiKeyEnv": "DATA_FEED_API_KEY",
      "requestsPerSecond": 3,
      "callsPerDay": 1000
    }
  }
}
~~~

Set **supplierAccount** to **"market-data"** on each existing upstream binding
that uses this allowance. A binding keeps its original authentication and request
mapping; the new field selects the shared quota account.

| Field | Operator meaning |
| --- | --- |
| Account alias | The key in **supplierAccounts**; bindings select this alias. |
| **directory** | An absolute private directory shared by seller processes using this account. |
| **account** | The stable label used by the original quota ledger. Keep it with the existing account. |
| **apiKeyEnv** | Optional environment-variable reference used for the quota account's identity. |
| **requestsPerSecond** | Shared original-dispatch rate, from 1 to 1,000 calls per second. |
| **callsPerDay** | Shared rolling 24-hour allowance, from 1 to 100,000,000 calls. |
| Binding **supplierAccount** | The configured alias used for this route's original supplier dispatches. |

Use the same directory, account identity and policy for processes drawing from
the same allowance. Keep the original private directory when restarting or
moving the service into its maintained runtime. Separate supplier accounts use
separate state directories.

The allowance unit is an original supplier call. Configure it from the
supplier's account limits. Provider tariffs expressed as credits, weighted
operations or currency continue through their existing provider-specific tariff
calculation.

## Operate the account

Start the original upstream seller with its existing upstream configuration and
operations listener. Open the listener's seller operations page, then choose
**Supplier accounts**.

1. Select **Load supplier accounts**. The listener reads each account's original
   local state and shows the capture time.
2. Review the shared account table. It includes original route membership,
   rolling-window calls, remaining calls, per-second allowance, admission and
   retry time.
3. Select **View** beside an account to inspect its policy, state revision,
   dispatch reservations, last dispatch, provider cooldown and route bindings.
4. Select **Refresh snapshot** after traffic or a recovery operation to read
   current state.
5. Download **Snapshot JSON** or **Account CSV** to hand over the exact displayed
   snapshot. Filtering the table leaves the complete account set in these
   downloads.

The page uses explicit refreshes. A failed refresh keeps the previous snapshot
and its timestamp visible. Individual unavailable accounts remain visible while
other configured accounts can still be reviewed. The account's safe error code
appears in its detail panel.

The installed Starforge release provides the same operator command:

~~~sh
starforge supplier-quotas check --upstreams /private/seller-upstreams.json
starforge supplier-quotas inspect --upstreams /private/seller-upstreams.json --account market-data
~~~

Application code can import **createSupplierQuotaRegistry** and
**attachSupplierQuota** from
**@tokenjunkielabs/starforge-merchant/seller/supplier-quotas**, and
**compileSupplierAccounts** from its **/config** export. The same named functions
are also available from the package root.

The source checkout provides the corresponding local operator command:

~~~sh
node sf30-seller-sdk/supplier-quota/cli.mjs check --upstreams /private/seller-upstreams.json
node sf30-seller-sdk/supplier-quota/cli.mjs inspect --upstreams /private/seller-upstreams.json
node sf30-seller-sdk/supplier-quota/cli.mjs inspect --upstreams /private/seller-upstreams.json --account market-data
~~~

**check** validates the existing configuration without opening its quota state.
**inspect** reads the original account state and prints the shared snapshot;
it exits with status 2 when a selected account is unavailable.

## Admission and retained state

The original quota engine accounts conservatively for a rolling 24 hours using
one-minute buckets. Every original supplier dispatch reserves one call
atomically. A request that has entered that dispatch path keeps its reservation
when the supplier or network later fails.

The reservation runs at the original dispatch boundary after the existing
request preparation, credentials, cache and idempotency behavior. Cached
responses and completed request replays keep their original path. A real cache
miss or new mutation checks the shared account before its supplier call.

An original supplier HTTP 429 response records its Retry-After cooldown on this
same account. Other bindings and processes see that cooldown through the
existing persisted quota state. Restarting the seller reopens the original
account.

| Display state | Interpretation |
| --- | --- |
| Accepting calls | The saved snapshot allowed another original supplier dispatch; dispatch checks current state again. |
| Supplier cooldown | The supplier's original cooldown extends beyond the snapshot time. |
| Window limit | The account's rolling-window call allowance is used. |
| Rate limit | The configured shared call rate requires a delay. |
| Unavailable | The account's original state could not be read; inspect its configuration and retained directory. |

**retryAt** is an absolute UTC time from the original quota engine.
**retryAfterSeconds** is the corresponding delay when that snapshot was taken.
A displayed past retry time means it is time to refresh the view.

Configuration checking and unpaid challenge handling keep their existing
state-free path. The original quota state opens lazily for an explicit account
snapshot, admission or supplier dispatch.

## Operator API and exports

The existing private operations listener serves these routes:

| Route | Response |
| --- | --- |
| **GET /supplier-quotas** | Supplier-account operator screen. |
| **GET /api/supplier-quotas** | Current account snapshot. |
| **GET /supplier-quotas.json** | Current account snapshot as a JSON download. |
| **GET /supplier-quotas.csv** | Current account snapshot as a CSV download. |

These reads retain the listener's host, origin, method and cache controls. Each
API or export request reads current local account state. Browser download
buttons instead export the exact already displayed snapshot.

The JSON schema is **stellar-forge.supplier-quotas.v1**. It contains **enabled**,
**capturedAt** and an **accounts** array. Each account has its alias, original
binding names, availability, safe error code and projected original quota fields.
Quota fields include the stable account label, policy, rolling-window totals,
dispatch timestamps, cooldown, retry time and saved revision. Credential values
and private state paths remain in the existing service configuration.

CSV contains one row per account and retains the same capture time. Labels are
quoted and spreadsheet-formula prefixes are protected. Unavailable accounts
retain their aliases, bindings and safe error codes; their unavailable numeric
fields are empty.

A seller without the shared supplier service returns **enabled: false** and an
empty account list, and the screen presents the configuration step. An account
read failure affects that account's row. A failure to obtain the complete service
snapshot returns **503 SUPPLIER_QUOTA_UNAVAILABLE**.

## Continue the original installation

Keep this module with the same SF30 seller SDK, original Routescan quota engine
and operations assets in the maintained Starforge release. Continue the
existing merchant's upstream file and account directories when receiving or
upgrading that release.

The shared account service supports the same original provider adapters. Start
adoption with one real account and its actual provider limits; attach the
additional bindings that draw from that account, then review one account
snapshot from the original running merchant.
