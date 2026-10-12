# Governed MCP purchases in the original buyer expense workspace

The governed source connects the original native MCP quote store to the spending owner that approved and reserved its purchases. Operators can review a purchase's original arguments and payment observation alongside its actual SF36 reservation, code settled units, review a period, issue accountant files, and reopen the complete expense project.

This is the same expense application, transaction journal, request recovery, allocation model and receiving format used by original SF36 ledger and native MCP quote sources. The source kind is `governed_mcp`. Existing source types retain their behavior.

## Select the original buyer and spending owner

Use the quote directory from the actual native buyer and the configuration file used by its original governed operator. The operator workspace writes the private host configuration with schema `stellar-forge.mcp-spending-host.v1`; its generated operator also declares `spendingConfigurationFile`. The selected configuration identifies the original actor, service, payer, policy, complete shared ledger and native state directory.

Create one owned private JSON descriptor. All paths below are examples; select the actual canonical paths on the receiving host.

```json
{
  "schema": "stellar-forge.governed-mcp-expense-input.v1",
  "quoteDirectory": "/srv/starforge/remote-buyer/quotes",
  "spendingConfigurationFile": "/srv/starforge/remote-buyer/spending/host.json"
}
```

The descriptor and native host configuration must be regular mode-0600 files owned by the running operator, at most 32 KiB each. Directory ownership and private permissions follow the original native host. Resolve path aliases before selecting the source.

The source retains the host's selected policy location and reads its original spending records. The original configuration retains environment-variable names for signing; capture does not load the operator module or supply those variables. A private descriptor contains source locations and the selected owner identity, not wallet or control keys.

For a shared spending ledger, select that complete original ledger through its host configuration. Preserve its other actors and services. The capture retains the complete original ledger snapshot, then attributes only the selected native buyer's exactly bound requests to this expense source.

## Operate the existing application

Start the original application with Python 3.11 or newer on a POSIX host and the host's existing Node 22.13+ or Node 24 runtime:

```sh
umask 077
python3 stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/server.py \
  --state /srv/starforge/buyer-expenses \
  --node /absolute/path/to/node \
  --port 0
```

Open the private application URL printed by that process. In **Sources**, choose **Register governed native MCP purchases**, name the source, select its descriptor and retain the actual buyer/source provenance. Preserve the original operation context: controlled development activity remains development; operating buyer purchases remain operational.

Registration creates a complete pending capture. Review its original rows, capture differences, native owner, original host SHA-256, original ledger state and source coverage. Accept it with a named source reviewer and reason. Each later capture is a new retained edition; acceptance makes that edition current while prior captures remain available.

The source uses the original quote-store read transaction and original SF36 statement transaction. It holds the native owner's existing spending lock while reading the immutable approval and finality records. An untouched owner is observed without creating a ledger, lock, native markers or a reservation.

### Read the purchase and its spending state

Open a purchase from **Buyer expenses**. Its original native purchase section retains the tool, endpoint, arguments digest, payer, recipient, original saved payment observation and complete-result metadata. The original governed spending section adds the exact request digest, retained binding digest, original reservation day, maximum, settled actual, outstanding capacity and finality references.

| Original condition | Expense behavior |
| --- | --- |
| Quote exists; no governed reservation was created | Preserve the original quote/payment classification. A quoted price alone supplies no reservation. |
| Binding was recorded before an original reservation denial | Show the retained binding and no original reservation. |
| Original ledger remains reserved, including an interrupted signer | Show its real reserved maximum. Expense allocation remains unavailable. |
| Quote has a matched transfer; original ledger remains reserved | Retain the separate observed transfer and actual outstanding reservation. Complete reconciliation in the original buyer, then capture and review again. |
| Original ledger is settled and its source binding agrees | Its original actual units become eligible for the existing allocation workflow. |
| Binding is missing or damaged but the complete original quote-derived request matches the ledger | Keep the original exposure visible and mark the row for source review. |
| A selected native record cannot be joined exactly to its original ledger row | Retain the selected owner's observed ledger exposure separately, with its exact request digest and unresolved source attribution. |
| Saved source views disagree about one physical ledger request | Retain their contributing captures and require refreshed, reviewed source editions. |

A binding or finality disagreement is an original source issue. Repair or reconcile the original buyer through its existing controls, then capture and review that state. A finance allocation or period disposition does not rewrite payment history.

The same original reservation can appear through a direct ledger source and a governed MCP source. The period joins matching original device/inode identity and request digest, counts that outstanding capacity once, and retains all contributing source/item/capture references. Separately owned ledgers keep separate exposure. Settled charges continue to use the existing receipt and native-transfer duplicate review, including its one-original-charge control.

## Allocate, review and issue a period

Use the existing cost centers and optional asset labels. Preserve all amounts as strings containing exact native base units. Network and asset stay separate. Display labels do not convert currency.

For a settled purchase, assign the operator's recognition date and allocation lines. Their sum must equal the original settled actual. Retain project, account code, memo and cost center as the existing allocation model requires. The original reservation day and original quote creation day remain separate source facts.

In **Period review**, inspect:

- Exact settled allocation totals by network and asset.
- Actual outstanding original reservations, including a single row for a shared reservation with multiple source views.
- Original purchase outcomes, quoted units, quote-observed transfer, governed state and native request/finality references.
- Pending source decisions, missing rows, conflicting original bindings and stale allocations.
- The existing credit/return history and accounting references when those sources are present.

Use the existing allowed period dispositions for outstanding work. Source-integrity and divergent-capture issues require original source recovery and a new accepted capture. Retain the named review against the current exact period context, then issue that review. Reopening preserves the prior issued edition.

Download the original accountant packet or issued JSON/HTML. The native outcome CSV includes the governed request, binding, reservation, finality and separate quote-observed units. Outstanding-reservation CSV retains the contributing source captures. Nested fields are JSON strings inside CSV cells. The packet also retains each complete captured source, including the shared ledger snapshot and original bound records.

Purchased result bytes remain in the original buyer's result inbox. The expense capture carries their original digest, byte count and file state so the accountant can trace the result without duplicating the buyer's delivery store.

## Operate through the existing merchant MCP or customer SDK

Declare a governed descriptor alias in the original private expense connection:

```json
{
  "schema": "stellar-forge.buyer-expense-connection.v1",
  "workspaces": {
    "finance": {
      "directory": "/srv/starforge/buyer-expenses",
      "python": "python3",
      "governedQuoteSources": {
        "remote_tools": {
          "path": "/srv/starforge/governed-expense-source.json",
          "name": "Original governed remote-tool purchases",
          "provenance": "Actual native buyer and spending-owner operation references.",
          "dataContext": "operational"
        }
      }
    }
  }
}
```

This is an additive source map beside `ledgers`, `quoteSources` and the original merchant/accountant source maps. A caller selects its declared alias; arbitrary descriptor paths or executables are not MCP tool arguments.

Use the original buyer-expense host initialization and transport described in [BUYER_EXPENSES.md](../../../../stellar-forge/mcp-merchant-operator/BUYER_EXPENSES.md). The new registration action is `merchant_buyer_expense_governed_mcp_register`:

```json
{
  "workspace": "finance",
  "requestId": "governed-source-registration-01",
  "expectedRevision": 0,
  "governedSource": "remote_tools"
}
```

Read the actual revision first; zero above is an example for a new workspace. Retain the exact request ID and complete arguments before sending. The existing request endpoint returns the original committed response after reply loss or restart.

The rest of the workflow uses the original tools: `capture_review`, `items`, `item`, `coding_save`, `period_report`, `period_review`, `period_close` and `export`. The shared protocol exposes the same action to the maintained SDK. `source_rebind` accepts exactly one declared `governedSource`, `quoteSource` or `ledger` alias and enforces the registered source kind.

## Complete project receiving and reattachment

Use the existing **Complete project** export. It contains the application and the original reader dependencies, a consistent expense workspace, source captures, request journal, allocations, period history and issued records. The new manifest capability is `governed_mcp_capture: original-spending-readonly-v1`.

Receive through the maintained receiver and the exact selected archive SHA-256:

```sh
python3 stellar/scf-starforge-20261009/sf36-spend-governor/expense-workspace/receive.py \
  --archive /private/buyer-expense-project.zip \
  --expected-sha256 EXACT_ARCHIVE_SHA256 \
  --directory /private/received-buyer-expenses
python3 /private/received-buyer-expenses/app/sf36-spend-governor/expense-workspace/server.py \
  --state /private/received-buyer-expenses/project \
  --node /absolute/path/to/node \
  --port 0
```

The original receiver verifies archive members, source identities, SQLite state, source kinds and the complete required reader closure. It preserves the original workspace/revision and request recovery. Repeating the same selected receive operation resumes its existing destination; changed files require another destination. Retained expense history opens before any original live source is attached.

To refresh after the buyer itself has moved or been restored, use its original native recovery workflow first. Preserve the complete shared spending ledger and native request identities. Create a private descriptor selecting the restored original quote store and original spending host, then use **Sources → Reattach original governed source**. The existing continuity check compares all retained original request IDs and request digests before capturing the new location. Accept the new source edition after reviewing its native owner and original ledger state.

The expense project remains the record of expense decisions and source observations. The original buyer remains the owner of signing, reservation, reconciliation and complete result delivery.

