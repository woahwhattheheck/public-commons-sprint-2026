# BIM Stellar routing workspace

A complete operator and reusable Next server integration for source-bound route discovery, preparation, wallet submission records, cash/bridge continuation and full workspace handover.

The current SCF45 source is [Aggregate Stellar, from swap to cash](https://communityfund.stellar.org/submissions/recMWcSVJ3u1AoGy2). The application distinguishes its funded Aquarius/Sushi normalization, parallel discovery, simulated fallback, operator and audit/analytics work from the separately sourced Soroswap/DeFindex, wallet, Privy, MoneyGram and Socket integrations. An installed action is an available capability; it does not mean a provider account, issuer permission, liquidity, audit or live transaction has been supplied.

## Open the application

Use Linux with Node22.16 or later, Python3 and the actual selected npm installation. Start with [native/INSTALLING.md](native/INSTALLING.md). The single retained installer copies the complete authored source into a separate installation, resolves or adopts the original dependency lock, builds the actual wallet bundle and records all native output. A completed installation has a complete `source-files.json`; an authored source checkout has `source-inputs.json`. These represent different stages.

Then follow [BIM_OPS.md](BIM_OPS.md) for the complete standalone workflow. Create the workspace outside the installation, keep the token in a private regular file, and run the original CLI:

```sh
node /ABS/INSTALLATION/cli.mjs init --workspace /ABS/NEW_WORKSPACE
node /ABS/INSTALLATION/cli.mjs serve --workspace /ABS/NEW_WORKSPACE --token-file /ABS/PRIVATE_TOKEN
```

The serve receipt returns the actual loopback URL and workspace identity. Enter the token in the operator. Set the original public network/provider selections and server credential aliases; keep private keys and API credentials out of browser configuration.

For an existing persistent Next application use [NEXT_INTEGRATION.md](NEXT_INTEGRATION.md). The supplied server helper, API route and complete asset publisher mount the same SQLite writer and exact UI. Do not open two owners against one workspace.

## What the complete source implements

- Parallel Soroswap, Aquarius and Sushi route reads keep every original result or failed/partial response under deterministic request lanes. Exact-amount normalization and route comparison retain token/network identities and source-specific paths.
- Preparation simulates a selected original route and produces an unsigned transaction. A failed alternative remains in the record; a successful fallback must prove the complete selected source lane. The operator reviews the fallback before wallet use.
- Original XDR, transaction source, network, hash, selected plan and account bind the wallet operation. The backend retains the original admission before the browser sends once. Unknown or already submitted operations continue by status lookup; an old accepted result never grants another first send.
- Original MoneyGram sessions and Socket activation are explicit provider writes. Private session capabilities remain with their original host. Cash and bridge states remain provider observations until their original asset, transaction and ledger evidence has been reconciled.
- DeFindex full native/HTTP vault reads and preparations preserve exact asset ordering, amounts, bounds and smart-wallet distinctions.
- Settlement and accountant views derive exact asset-separated totals, route attempts, execution quality, movements, balances and exceptions from the retained original workspace. Complete report files and source packages reopen against their immutable source; exception reviews use the same original note writer.
- SQLite retains original commands, request outcomes, source Files, full provider responses, plans, submissions, notes and history. Browser working copies retain unfinished forms and original requests. Workspace export/inspect/receive preserves complete public source and selected originals; received private capabilities remain unavailable and execution is disabled.

The UI, CLI and Next API all call the same original writer. Configuration changes, reads, preparation, explicit external writes and wallet evidence are separate commands. A read failure is retained as a failed original request and does not reserve a global unknown external outcome. An actual uncertain write requires deliberate preservation/retirement before unrelated new work; retirement never authorizes repeating that same external attempt.

## Source and operation references

- [BACKEND.md](BACKEND.md), [BACKEND_API.json](BACKEND_API.json): exact request, provider, file, session, wallet and portable contract.
- [SOROSWAP_DEFINDEX.md](SOROSWAP_DEFINDEX.md): source-specific direct and HTTP contract methods and bounds.
- [WALLETS_MONEYGRAM.md](WALLETS_MONEYGRAM.md), [SOCKET.md](SOCKET.md): actual wallet/cash/bridge lifecycle and retained original provider semantics.
- [SETTLEMENT.md](SETTLEMENT.md): complete accountant report, original source inventory, exception decisions, all sixteen downloads and the source-only native receiving continuation.
- [AGENTS.md](AGENTS.md): the complete owner instruction to operate and visually view the exact product and every relevant attachment before client/demo readiness.

The public package contains authored integration source and source provenance. It does not redistribute unlicensed private source collections. Installed dependency licenses and legal text remain in their original packages and complete bundle outputs.

Source review and publication are not runtime acceptance. Record the actual installed source/lock/runtime, operate the populated product at desktop and narrow widths, visually inspect the rendered results, and download/open/reopen every relevant original and portable attachment. Keep those actual results with the original operation. No provider, wallet, deployment, funded action or rendered-browser result is inferred from this source package.
