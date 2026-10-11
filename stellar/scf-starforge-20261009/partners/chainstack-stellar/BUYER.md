# Chainstack buyer handoff

This directory carries selected original merchant requests and their exact released clients. Open handoff.json for the merchant, each request's intent/release identity, and the retained file hashes. The Node and Python programs use the existing SF88 buyer, including its saved review, execution state and response recovery.

## Create the transfer on the merchant host

Prepare each actual request through the original installation CLI. The merchant body is the Stellar method's parameters object: for example {"hash":"ACTUAL_64_CHARACTER_TRANSACTION_HASH"}. The public endpoint fixes the upstream method. For getEvents, retain the actual returned cursor for a following page; a cursor request omits startLedger and endLedger.

Create the complete transfer in a new private directory outside the installation:

    node cli.mjs handoff --root /absolute/private/installation --requests transaction-1,events-1,entries-1 --out /absolute/private/customer-handoff

The command selects 1–12 distinct prepared request IDs. It verifies their original body/config hashes, retained release digests, and complete original client exports before writing. handoff.json is written after all selected payloads. Retain the complete directory and its private permissions when transferring it through the agreed customer channel.

The layout is requests/INTENT/{request.json,request.body.json,buyer-config.json}, clients/RELEASE/{release.json,seller-openapi.json,buyer.mjs,buyer.py,javascript/}, this guide and handoff.json. Each javascript/ directory contains the original five generated SDK files and client-export.json. Multiple requests for one release share that release's client directory.

## Select the existing buyer runtime

The receiving operator selects its complete maintained Stellar Forge source installation and private buyer state. In the commands below, replace /absolute/source-checkout with that actual source root, RELEASE with the releaseId in the selected request.json, and INTENT with its intentId. Use one buyer state and selected client for each purchase and its recovery. Keep the state after closing the process.

Node takes --runtime pointing directly to sf88-operator-buyer-cli. Python takes --checkout pointing to the complete repository/source root. The optional --profile on review selects an existing original private operator profile. The transferred request files remain unchanged: both programs supply the exact retained body bytes to the original buyer, so a prior absolute body path in buyer-config.json does not control the moved request.

Create private directories for buyer state, reviews and received files before the first command:

    install -d -m 700 /absolute/private/buyer-state /absolute/private/reviews /absolute/private/received

## Node: review, execute and reopen

Review the selected original request and save the resulting review to a new filename:

    node clients/RELEASE/buyer.mjs review --runtime /absolute/source-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli --state /absolute/private/buyer-state --request requests/INTENT --review-file /absolute/private/reviews/INTENT.json --profile /absolute/private/original-operator-profile.json

Read the saved review and check the merchant URL, method, input, payment network, asset, receiving account, exact atomic amount and the original runtime's review result. The payment network and the provider data network are separate selections. Execute that saved review through the same state and intent:

    node clients/RELEASE/buyer.mjs execute --runtime /absolute/source-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli --state /absolute/private/buyer-state --intent INTENT --review-file /absolute/private/reviews/INTENT.json --output /absolute/private/received/INTENT.json

Inspect or recover that same operation after an interrupted command or a lost response:

    node clients/RELEASE/buyer.mjs inspect --runtime /absolute/source-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli --state /absolute/private/buyer-state --intent INTENT
    node clients/RELEASE/buyer.mjs recover --runtime /absolute/source-checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli --state /absolute/private/buyer-state --intent INTENT --output /absolute/private/received/INTENT-recovered.json

The output filename must be new. Inspect the existing saved response before choosing a recovery destination. Retain the original intent, state and review while resolving an uncertain execution.

## Python: the same original workflow

Choose the Python client for the selected purchase and use its existing private state throughout:

    python3 clients/RELEASE/buyer.py review --checkout /absolute/source-checkout --state /absolute/private/buyer-state --request requests/INTENT --review-file /absolute/private/reviews/INTENT.json --profile /absolute/private/original-operator-profile.json
    python3 clients/RELEASE/buyer.py execute --checkout /absolute/source-checkout --state /absolute/private/buyer-state --intent INTENT --review-file /absolute/private/reviews/INTENT.json --output /absolute/private/received/INTENT.json
    python3 clients/RELEASE/buyer.py inspect --checkout /absolute/source-checkout --state /absolute/private/buyer-state --intent INTENT
    python3 clients/RELEASE/buyer.py recover --checkout /absolute/source-checkout --state /absolute/private/buyer-state --intent INTENT --output /absolute/private/received/INTENT-recovered.json

Use the saved Python review with the Python client and the saved Node review with the Node client. Their existing source-native buyer implementations own request admission, payment execution, result retention and recovery.

## Read the returned Stellar data

getTransaction preserves SUCCESS, FAILED or NOT_FOUND as actual chain-data outcomes. getEvents preserves original event IDs, XDR topics/data and the returned cursor. Prepare the next selected page as a new deliberate request/purchase using that cursor. getLedgerEntries preserves the canonical requested keys and returned XDR. Compare the data network and actual provider observation with the selected installation's plan when investigating an unexpected result.

For a changed body, price or release, prepare a new request under its own intent and review the selected current terms. For an interrupted existing purchase, continue its original saved state with inspect/recover. This keeps the receiving team's operating history and exact delivered bytes connected to the original merchant request.

