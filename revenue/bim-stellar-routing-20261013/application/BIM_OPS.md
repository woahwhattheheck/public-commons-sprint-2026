# BIM Stellar routing operations

Use this guide to install and operate the complete source-bound application: compare Stellar routes, simulate a selected swap, hand its exact envelope to a wallet, and independently confirm the result. The same workspace includes Sushi positions, DeFindex vaults, the documented Socket Stellar/Base USDC bridge, MoneyGram cash sessions, original provider evidence and portable receiving.

The current SCF45 integration scope covers Aquarius, common quote normalization, Sushi Stellar including accessible concentrated-position data, parallel Soroswap/Aquarius/Sushi discovery with pre-signature simulation and visible fallback proposals, the operator UI and source-attributed analytics. Earlier removed deliverables are not represented as current funded acceptance criteria. Wallet, vault, bridge and cash workflows are separately documented supporting integrations. This independently authored application does not claim access to BIM's proprietary app or deployed customer configuration.

Amounts stay exact decimal text in the original token's smallest units. Asset metadata, issuer/contract identity, network, wallet and deployment belong to the selection. A quote is an observation; PREPARED is an unsigned simulated proposal; a wallet-reported hash is a reported submission. Confirmation requires original network evidence. Missing fees, unsupported paths, partial sources and unknown outcomes remain visible.

## 1. Install a new edition

Read native/INSTALLING.md and the current AGENTS.md. Use Linux, Python 3 and Node 22.16 or later. Select the real Node executable and npm-cli.js path, hashes and actual version strings in one original installation input. Keep the complete authored application and source-inputs.json together.

~~~sh
python3 -B /ABS/authored-application/native/install.py \
  --input /ABS/original-installation-input.json
~~~

The driver owns the original process tree through native/watershed_process.py. It writes into a new installation-operation directory, with the application under its application child. It runs actual npm resolution or ci with scripts/audit/funding disabled, freezes the lock and builds the complete local wallet bundle. Its exact accepted source, versions, logs, dependency inputs, bundle/legal artifacts and final source-files.json remain available.

Do not rebuild or edit an installation already selected by a workspace. Choose a new installation for a changed authored edition. An identical completed installation is verified without npm or esbuild activity. When sourceRoot contains an original installed source-files.json, the driver preserves all original bundle/build/manifest bytes and materializes dependencies from its exact lock; the original build is adopted rather than regenerated. This preserves a received workspace's installed edition.

The direct package pins are SDK 16.0.1, Wallets Kit 2.7.1 and esbuild 0.25.10. Kit's own transitive SDK remains separate in the lock. Optional Privy 3.13.0 with React/ReactDOM 18 or 19 belongs to the actual configured host, not an automatic wallet login. The standalone operator uses the bundled Wallets Kit flow.

## 2. Create and open the original workspace

Use the completed application directory and a workspace outside it. CLI inputs, outputs and workspace paths are absolute. Outputs are complete create-only files: select a new output filename or repeat exactly the prior result.

~~~sh
node /ABS/installation/application/cli.mjs init \
  --workspace /ABS/private/bim-workspace \
  --name "BIM routing" --out /ABS/private/initial-state.json

node /ABS/installation/application/cli.mjs bootstrap \
  --workspace /ABS/private/bim-workspace \
  --out /ABS/private/bootstrap.json

node /ABS/installation/application/cli.mjs serve \
  --workspace /ABS/private/bim-workspace \
  --token-file /ABS/private/operator-token \
  --credentials-file /ABS/private/provider-aliases.json \
  --port 8787
~~~

The token is an operator-selected private regular file with at least 24 characters after trimming. The credentials file is optional; omit that flag for selected sources that require none. Give both files owner-only permissions. The server binds localhost and prints its actual URL/workspace ID. Open that URL and enter the token in the operator. Keep exactly one server or CLI owner against a workspace at a time; stop the listener normally before using an independent CLI command.

For an existing Next application, follow NEXT_INTEGRATION.md. Mount the supplied persistent Node route and publish the complete assets into a separate public subdirectory:

~~~sh
node /ABS/installation/application/tools/export-next-assets.mjs \
  --out /ABS/next-app/public/bim-app --api-prefix /api/bim
~~~

The Next owner and standalone server use the same command handler, source manifest and SQLite journal. Select one owner, not parallel writers. The host's actual framework/runtime lock remains part of that host's installation.

## 3. Select network, account and public provider configuration

In Configuration, save the whole public configuration. Select a real wallet/account on the same network. Reads and simulations use a funded G account for transaction construction; they do not request its private key. Use the exact passphrase and HTTPS RPC/Horizon endpoints. The helper checks RPC network and Horizon root evidence before interpreting network-specific results.

The following is a configuration template, not an issued customer selection. Replace SELECTED_G_ACCOUNT and any deployment/alias placeholders with the real selected values. Enable only the providers you intend to use.

~~~json
{
  "name": "BIM public-network workspace",
  "executionEnabled": false,
  "network": {
    "id": "stellar-public",
    "kind": "stellar",
    "chainId": "1110002",
    "rpcUrl": "https://mainnet.sorobanrpc.com",
    "horizonUrl": "https://horizon.stellar.org",
    "passphrase": "Public Global Stellar Network ; September 2015"
  },
  "wallet": {
    "address": "SELECTED_G_ACCOUNT",
    "networkId": "stellar-public",
    "provider": "SELECTED_WALLET"
  },
  "providers": {
    "soroswap": {
      "baseUrl": "https://api.soroswap.finance",
      "environment": "mainnet",
      "credentialAlias": "soroswap-mainnet",
      "publicConfig": {
        "protocols": ["soroswap"],
        "parts": 10,
        "maxHops": 3,
        "maxFeeStroops": "1000000"
      }
    },
    "aqua": {
      "baseUrl": "https://amm-api.aqua.network/api/external/v2",
      "environment": "mainnet"
    },
    "sushi": {
      "environment": "mainnet"
    },
    "defindex": {
      "baseUrl": "https://api.defindex.io",
      "environment": "mainnet",
      "credentialAlias": "defindex-mainnet"
    },
    "socket": {
      "environment": "prototype",
      "publicConfig": {"access": "prototype"}
    },
    "moneygram": {
      "environment": "production",
      "credentialAlias": "moneygram-production",
      "publicConfig": {
        "registeredWebhookUrl": "https://SELECTED_REGISTERED_DOMAIN/moneygram"
      }
    }
  }
}
~~~

The sample maximum network fee is an operator policy example, not a fee estimate. Choose it deliberately from the actual simulation. Contract overrides use provider.contractIds. Aqua accepts router; Sushi router,factory,positionManager; Soroswap optionally pins router or aggregator against its actual API lookup. The built-in Aqua mainnet/testnet and Sushi mainnet defaults retain their original source references. Another deployment requires explicit configured IDs and real evidence.

For testnet select Test SDF Network ; September 2015, the actual testnet RPC/Horizon, matching wallet networkId, Soroswap/DeFindex testnet environment and Aqua testnet endpoint. Sushi has no implicit testnet preset; select actual supported deployment addresses. Socket's documented Stellar route requires the public Stellar network and chainId 1110002. MoneyGram sandbox uses its documented testnet environment and separate asset issuer; production uses public network. Do not combine a sandbox session with a production wallet payment.

### Server aliases

The credential file maps each selected alias to exact allowed origins and injected headers:

~~~json
{
  "soroswap-mainnet": {
    "origins": ["https://api.soroswap.finance"],
    "headers": {"Authorization": "Bearer REPLACE_WITH_ISSUED_SERVER_TOKEN"}
  }
}
~~~

Use the provider's issued header contract for each alias. This example illustrates the file structure, not a supplied credential. Do not put secret headers in publicConfig, form inputs, source files, browser drafts or exported workspaces. Socket production selects publicConfig.access:"production", its dedicated origin, credentialAlias and publicConfig.affiliate. Prototype and production access are distinct. MoneyGram session capabilities remain private to their original server; public exports retain their identities and expiry, not the capability bytes.

## 4. Discover and compare swaps

Open Swap routes. Select the actual input/output token contracts, exact amount, EXACT_IN or EXACT_OUT, basis-point slippage and quote lifetime. Use the original asset metadata to interpret smallest units; do not assume seven decimals for every contract.

The shared read action is exchange.discover. It queries selected Soroswap, Aquarius and Sushi providers concurrently through deterministic source lanes and preserves every full reply and failure. Typical input is:

~~~json
{
  "tokenIn": "SELECTED_INPUT_CONTRACT",
  "tokenOut": "SELECTED_OUTPUT_CONTRACT",
  "amount": "10000000",
  "mode": "EXACT_IN",
  "slippageBps": "50",
  "ttlSeconds": "300",
  "providers": ["soroswap", "aqua", "sushi"]
}
~~~

This amount is an authored input example, not a quote or completed trade. Slippage 50 means 0.5%; quote lifetime is 1–3600 seconds. Exact-output Sushi is unsupported by the selected current router, so its actual failure remains alongside other usable sources. You may select intermediate Sushi bridgeTokens, feeTiers and maxHops when deliberately expanding its current factory search; they are not forwarded as invented Soroswap query fields.

Inspect complete original replies and each normalized route. EXACT_IN ranking prefers the highest quoted output; EXACT_OUT prefers the lowest quoted input. Network fees are separate until simulation. A Soroswap aggregate route is identified as that provider's returned route, not counted as independently observed liquidity from each underlying venue. Missing provider fees/price impact remain unreported.

Every discovery route uses its index in the complete flattened quote array. When selecting it through the CLI, retain the original discovery record ID and that global routeIndex. Include the record in evidenceIds. Changing network, wallet, provider configuration, amount or expiry requires a fresh selected quote.

## 5. Simulate and review the actual proposal

Use exchange.prepareBest through plan.prepare with selected quoteIds in both input and evidenceIds. It tries the ranked original routes sequentially and returns the first successfully simulated proposal, preserving earlier failures and any fallback reason. An explicit preferred original route can be proposed first. The UI must show the chosen source and require review of a fallback; the adapter does not silently sign another route.

The result retains the full comparison, attempted route results, exact unsigned envelope and actual simulation. selectedSourceLane/selectedExchangeIds name the complete current successful preparation lane. Earlier failed read-only lanes remain in the whole source history; they are not hidden or relabelled successful. An incomplete selected lane prevents PREPARED. An incomplete external write cannot be excluded from completion.

For a specific venue use soroswap.prepare, aqua.prepare or sushi.prepare with {quoteId,routeIndex}. The exact selected asset path, source/recipient, network, amount, minimum output or maximum input, deadline and deployment are checked. Sushi refreshes actual factory pools and complete oracle hints. Aqua uses the actual returned chain XDR. Soroswap preserves the original quote JSON and checks the built transaction against the selected route and limits.

Review fee, time bounds, authorization entries, actual simulation result and any restore requirement before opening the wallet. NEEDS_REVIEW or a restore preamble is not an executable successful simulation. A separately source-checked classic SDEX path has no Soroban simulation and is not promoted by exchange.prepareBest to a simulated route.

## 6. Sign, submit and confirm the original transaction

Wallet connection, signing and submission are explicit operator actions. Enable execution deliberately for the selected original wallet/network before the first submission; this switch is not a signing instruction. Select the exact prepared plan. Verify the displayed network/account and entire envelope. Private keys stay in the wallet. Cancelled or rejected prompts remain recoverable working state and do not cause a submission.

The mounted flow reserves one wallet operation, records the signed envelope, and commits SUBMITTING before the first transport attempt. Only a newly admitted original submitting command with X-BIM-Replayed:false permits that first send. Lost responses, replayed receipts, missing headers, NOT_FOUND and uncertain outcomes never grant another send. Recover through the original wallet operation/hash.

After the signed transaction is reported, retain it through submission.record with its original plan. Independent refresh uses submission.refresh with actionId:"exchange.confirm" and input:{submissionId}. The backend adds the original plan and submission evidence. The confirmation helper compares the prepared inner hash, full signed envelope, submitted outer hash, selected network and actual ledger envelope/result. RPC NOT_FOUND can use the actual Horizon fallback; absence remains unresolved.

A successful browser callback or wallet response is CLIENT_REPORTED_SUBMISSION/CLIENT_BROWSER_OBSERVATION until the independent network result is obtained. Open the complete original confirmation, including ledger metadata and result XDR. The exact return/meta bytes remain available even when a newer metadata structure has no decoded presentation.

## 7. Positions and vaults

In Positions & vaults, sushi.positions reads the selected owner's complete observed NFT count and pages. It checks duplicate IDs, ending count, each current owner, actual factory pool, slot price, live fees and principal through the current position-manager ABI. The result includes full original position fields and individual read failures. COMPLETE_OBSERVED describes that sequential observation; it is not an atomic historical portfolio snapshot. A changed page/owner or failed call stays PARTIAL_OR_CHANGED.

For DeFindex, discover the actual vault or select its original contract, then run defindex.vault and defindex.position. Retain the complete asset order and its separate simulation/ledger observations. Direct deposit uses amounts[] and minAmounts[] in that order plus an explicit invest boolean. Direct withdrawal uses exact shares and minAmounts[]. Both produce an unsigned actually simulated contract call.

The issued HTTP interface accepts JSON numbers; this adapter permits only safe integer amounts on that path. Use the direct native i128 workflow for larger values. HTTP withdraw-by-assets also requires local maxShares plus the full minAmounts vector; withdraw-by-shares requires full minAmounts. Those local bounds inspect the returned XDR and are not invented HTTP fields. A smart-wallet response containing only an operation remains NEEDS_REVIEW until the actual selected wallet supplies its complete envelope and authorization. See SOROSWAP_DEFINDEX.md for the full action/field matrix.

## 8. Bridge and cash

### Socket Stellar/Base USDC

Read socket.chains, socket.providers and the actual token catalogue/search first. Select those retained records as evidence for socket.quote. The documented lane is Base 8453 and Stellar 1110002 in opposite directions, USDC to USDC, userOps:"deposit" and EXACT_INPUT. Specify the actual receiver, refund address, complete token identities and exact input units.

A returned preview may have activationRequired:true. Review its original quote ID, expiry, fees and exact proposed instructions. If explicitly authorized, enable execution before preparing socket.quote.activate, then prepare and execute that same plan. Activation is a provider mutation; a preview/read is not activation. Never create a replacement plan to resend an uncertain activation.

Preserve the returned deposit instructions and memo/network/amount exactly. Undocumented or conflicting txData shapes remain unavailable for automatic signing. The adapter does not infer a Stellar envelope from arbitrary provider fields. The Base leg requires its actual authorized wallet/provider workflow; this Stellar adapter does not manufacture an EVM transaction.

Use socket.status with the original quoteResultId and quoteId, even after the quote's price window expires. Status by source hash cannot replace the documented deposit quote lookup. COMPLETED, FAILED, EXPIRED and REFUNDED are provider terminal labels; REFUNDING, REFUND_FAILED and MANUAL_REVIEW_REQUIRED remain explicit. Independently retain source, destination and refund ledger evidence before claiming delivery or refund. See SOCKET.md.

### MoneyGram cash sessions

Select production/public or sandbox/testnet coherently. Choose on-ramp or off-ramp and the actual G account. Session creation is an explicit external action: set the intended execution configuration first, prepare moneygram.session.create, inspect its original selected flow/network, then execute that exact plan once. Changing the complete configuration between preparation and execution requires deliberate new preparation.

The live token stays on the original private host. The widget's original transaction IDs and events are retained as client observations. A view/reopened session is not permission for another wallet payment. Off-ramp signing verifies the original USDC issuer, recipient, exact decimal amount and optional ID memo. A recreated session reuses the original transaction's stable wallet operation rather than generating another payment.

Read moneygram.status.get using the original committed session and transaction binding. A verified original webhook can add authenticated evidence, but still requires the proper status/ledger interpretation. Expired sessions and missing private capabilities are visible; portable receiving does not reconstruct them from hashes. See WALLETS_MONEYGRAM.md.

## 9. Original requests, drafts and recovery

The browser saves each complete command before sending it. A command has requestId, expectedRevision, method and args. A completed same-ID request returns its original receipt before the revision check; the same ID with changed intent is rejected.

Read the original result before deciding what to do next:

~~~sh
node /ABS/installation/application/cli.mjs request \
  --workspace /ABS/private/bim-workspace \
  --id ORIGINAL_REQUEST_ID --out /ABS/private/original-request.json
~~~

Do this while the standalone/Next owner is stopped, or use the mounted Request recovery control against the active owner. Lookup is read-only. A failed read or preparation is retained; a fresh deliberate new quote is a new operation. An unknown external attempt remains associated with its original plan.

“Preserve unresolved attempt and continue” records an explanation through request.retire. It preserves UNKNOWN outcome and every original attempt; it does not assert provider failure, authorize another send, or release the same plan for a second execution.

Export and reopen the complete browser working copy to carry unfinished exact form text, original pending requests and retained browser files. Import restores drafts; it does not send them. Keep source files through Files & notes and use complete native source.import for durable original bytes. Private access/session tokens are excluded from public working-copy exports.

## 10. CLI and portable receiving

The CLI exposes the same domain commands. A saved input may contain:

~~~json
{
  "requestId": "ORIGINAL_QUERY_REQUEST_ID",
  "expectedRevision": 0,
  "method": "query.run",
  "args": {
    "actionId": "exchange.discover",
    "input": {
      "tokenIn": "SELECTED_INPUT_CONTRACT",
      "tokenOut": "SELECTED_OUTPUT_CONTRACT",
      "amount": "10000000",
      "mode": "EXACT_IN",
      "slippageBps": "50",
      "ttlSeconds": "300"
    }
  }
}
~~~

Replace expectedRevision with the actual current value and retain the complete input before executing. The example assumes configuration has already been selected; its revision 0 is a placeholder, not a valid continuation prediction.

~~~sh
node /ABS/installation/application/cli.mjs command \
  --workspace /ABS/private/bim-workspace --input /ABS/original-command.json \
  --credentials-file /ABS/private/provider-aliases.json --out /ABS/private/command-result.json

node /ABS/installation/application/cli.mjs export \
  --workspace /ABS/private/bim-workspace --out /ABS/private/bim-workspace-export.json

node /ABS/installation/application/cli.mjs inspect \
  --input /ABS/private/bim-workspace-export.json --out /ABS/private/packet-inspection.json

node /ABS/installation/application/cli.mjs receive \
  --input /ABS/private/bim-workspace-export.json \
  --workspace /ABS/private/new-recipient-workspace \
  --request-id ORIGINAL_RECEIVE_ID --out /ABS/private/receive-result.json
~~~

Receive uses the exact installed application edition and creates a separately selected workspace. It verifies whole objects, history, requests, provider evidence and source. Repeating the same receive preserves later recipient work. Execution is disabled in the received configuration. Private provider bodies/capabilities remain unavailable with their original identities; do not describe a public export as a private credential backup.

For a cold recipient, retain the full installed application from the packet separately, then run native/install.py on that complete original sourceRoot. It adopts the original installed roster/bundles/lock while recording the recipient's actual dependency/runtime installation. Use that identical installed application for receive. Do not rebuild a modified source edition and expect an old workspace to accept it.

The mounted Export & receive workflow uses the same verifier. Its receive command returns a child workspace; it does not silently replace the active server. Explicitly stop the current owner before serving a different workspace. Export the continued recipient and inspect/reopen the return through its original operation.

## 11. Operate and view the exact outgoing product

The current owner instruction in AGENTS.md applies to this application and every attachment. Before describing a client/demo version as ready, the responsible producing worker must open/run/render the exact outgoing installation and actually LOOK at its rendered screen or real screenshots, then use the important controls.

At the actual screenshare width and a narrow/mobile width, use the real route/configuration forms, inspect populated and empty results, observe loading and provider failures, select original evidence, open full records, prepare and recover without replacing original requests, cancel a wallet prompt where relevant, reopen unfinished working copies, and download/inspect/receive the complete portable workspace. Only explicitly authorized provider/wallet actions belong in the course. Read-only preparation does not authorize signing, bridge activation or session creation.

This includes ALL attachments: open and view downloaded HTML, every relevant report/PDF page, spreadsheet, map/image, archive and project attachment in its normal recipient-facing viewer; inspect usable archive/project contents. Play any audiovisual output. Capturing screenshots without viewing them, inspecting source/metadata, seeing HTTP 200 or obtaining a reviewer approval does not substitute for normal use.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work. Keep the plain industrial layout, clear labels, readable tables and consistent spacing. Record the exact installed/source identity, actual viewports, screenshots actually viewed, controls/states and files opened, actual fixes and any precise unresolved gap. A changed outgoing version needs inspection of its affected result.

Preserve all current owners, source history and the one accepted native operation. This is focused product use and repair, not an additional approval queue or a reason to build a test/verification product. The complete standing instruction, including propagation and media requirements, is retained verbatim in AGENTS.md. Source publication and a successful install remain source/build outcomes until this actual product use occurs.

## Reference guides and interfaces

- native/INSTALLING.md — exact input, dependency/build ownership and completed adoption.
- BACKEND.md and BACKEND_API.json — complete command/context/portable schemas.
- SOROSWAP_DEFINDEX.md — full amount, source, wallet and vault contract.
- SOCKET.md — issued deposit/activation/status/refund semantics.
- WALLETS_MONEYGRAM.md — actual wallet/session/token/webhook behavior.
- NEXT_INTEGRATION.md — persistent host/API/assets and optional Privy component.
- PROVIDER_SOURCES.json — retained provider source pins and provenance.

Use the installed bootstrap catalogue for exact available actions. Keep original provider JSON/XDR and current source identities alongside the selected operational result; do not replace them with abbreviated summaries.
