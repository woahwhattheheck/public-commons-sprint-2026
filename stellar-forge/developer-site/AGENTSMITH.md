# AgentSmith buyer receiving page

The public [AgentSmith receiving page](https://agentsmith-receiving.tokenjunkielabs.chatgpt.site) turns the retained AgentSmith HTTP source into a complete portable preparation and runs the maintained buyer and Freighter wallet from that preparation.

## Product flow

Open the page, review the original unpaid POST and advertised payment choices, and choose a new absolute private directory on the receiving Linux host. Keep one stable operation ID. The actual Freighter public payer can be selected now or supplied when the original operator is initialized.

**Save editable draft** writes setup-input.json, including the exact source text. **Open saved draft** restores that preparation. **Download receiving packet** writes a nine-file ZIP using the existing onboarding.mjs ZIP implementation.

| Packet file | Role |
| --- | --- |
| source-http.json | Complete original request and both HTTP response captures |
| request.json | Exact UTF-8 request bytes |
| capture.py | Maintained original capture and native preparation program |
| buyer.mjs | Receiving runner that calls the original buyer and wallet commands |
| packet.json | Operation settings and source/program digests |
| setup-input.json | Complete editable receiving draft |
| INSTALL.json | Native command arrays and their shell rendering |
| README.md | Runtime, preparation, execution and reopen guide |
| LICENSE | Original MIT license and attribution |

The original offer decoder remains offer.mjs. The native capture program is retained from **stellar/scf-starforge-20261009/partners/agentsmith/capture.py** at source **aea13f36c6bddf09fcc16cc3825094d1d30cfbb9**, SHA-256 **93214bc738c9ad92c70aadddb07655d86ea7e304ea7ed1afda0e5c6b4a940098**.

## Captured operation

The default source bundle is the actual AgentSmith capture from **2026-10-12T00:36:42.324725+00:00**:

- POST https://agentsmith.xyz/metar/v1/metar returned HTTP 402.
- GET https://agentsmith.xyz/facilitator/supported returned HTTP 200.
- Request body is the original 21-byte UTF-8 JSON request for KJFK.
- Selected offer is exact, stellar:testnet, sponsored authorization, amount 40000 atomic USDC, timeout 300 seconds.
- USDC contract: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA.
- Recipient: GBW2N6DQ5QQVVUFBMH7KORTUB55JMVJCRAXEAUONUHUGB4ETE5KZ7FNI.
- Request SHA-256: 48b7f29c8f78676a1a8cf2a1bebe83a01bf970ffe584ff70a9cdb7d694fecd93.
- Source bundle SHA-256: 18d45f986bc0f53292086f715f8dbafc5cbf92a59f5fb599c0034285d97103a8.

The complete alternate offer and original extension metadata are preserved. An imported original capture passes the same source, request and selected-payment validation. Amounts remain atomic integer strings. Native operator amounts fit the original signed 64-bit accounting limit.

## Receiving runtime

Use Linux, Node.js **22.16 or later**, Python **3.11 or later**, and the complete existing toolkit checkout or installed source package. The runner accepts a checkout root, an installed package root containing source/stellar/scf-starforge-20261009, or that component directory in its original layout.

Include the **native** and **freighter-wallet** runtime features. The native engine uses the maintained x402 2.28.0 source, Stellar SDK satisfying ^16.3.0, and the official **@stellar/freighter-api 6.0.1** in the same dependency tree. The operator browser needs the Freighter extension.

For an existing application that manages its own toolkit dependencies:

~~~sh
npm install --save-exact @stellar/freighter-api@6.0.1
starforge doctor --native --feature freighter-wallet
~~~

The wallet source contract is sf103-native-buyer-signer/browser-wallet/README.md and cli.mjs at merged source **c3f1f9a930e1a4b08a6d60f5643b98ba2f4a0e1d**. Its installed alias is **starforge browser-wallet**.

## Original commands behind the packet

The packet runner retains receiving.json in the chosen operation directory and verifies its original packet identity. The following are the underlying source commands, with explicit absolute paths substituted for the receiver.

~~~sh
python3 capture.py restore \
  --source /private/packet/source-http.json \
  --directory /private/operation/source

python3 capture.py prepare \
  --capture /private/operation/source \
  --checkout /absolute/original/checkout \
  --directory /private/operation/request \
  --intent-id ORIGINAL_STABLE_OPERATION_ID \
  --node /absolute/path/to/node

node /absolute/original/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/operation/request/review.json

node /absolute/original/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --init-workspace --config /private/operation/request/review.json \
  --dir /private/operation/operator \
  --actor ORIGINAL_OPERATOR_ID --service agentsmith-metar \
  --payer ACTUAL_FREIGHTER_PUBLIC_ACCOUNT \
  --python /absolute/path/to/python3

node /absolute/original/checkout/stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs prepare \
  --buyer-config /private/operation/operator/operator.json \
  --out /private/operation/wallet

node /absolute/original/checkout/stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs serve \
  --workspace /private/operation/wallet
~~~

Open the original wallet service's printed loopback URL in the intended browser and connect Freighter. In a second terminal:

~~~sh
node /absolute/original/checkout/stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs execute \
  --workspace /private/operation/wallet \
  --operator-workspace /private/operation/operator
~~~

The original terminal approval and native authorization entry belong to this operation. Its useful merchant response remains at **/private/operation/request/metar-result.json**. Inspect the retained wallet using the original command:

~~~sh
node /absolute/original/checkout/stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs inspect \
  --workspace /private/operation/wallet
~~~

The packet's **inspect** also reopens the retained capture and reviewed request, reviews the original operator if present, and reports the saved response path and size. Repeating **prepare** completes an interrupted source restoration or native preparation in the same directory. Complete private files are published atomically and reused only when their original bytes match. The original SF88 preparer derives the expected configuration before reopening a retained draft, preserving the request, stable intent and response destination. A private operation lock prevents concurrent writers.

Repeating **operator-init** invokes the maintained initializer's resume operation when its original initialization is incomplete, then checks the complete source configuration, actor, service, payer and exact request bytes. Wallet actions make those same checks before entering the original provider. The receiving manifest is created atomically, and an empty original receiving directory can finish its first creation.

The runner forwards SIGINT and SIGTERM until the native child closes and returns the child's exit status. Repeating **wallet-prepare** inspects the existing wallet. Interrupted execution continues through the original buyer and wallet recovery commands with its retained ledger and keys.

## Site integration

The additive receiving assets live in the existing **dist/** tree:

- agentsmith.html, agentsmith.css and agentsmith-setup.mjs.
- agentsmith-onboarding.mjs and agentsmith-runner.mjs.
- agentsmith-capture.py, agentsmith-source-http.json and agentsmith-LICENSE.txt.

The page imports the existing offer.mjs and onboarding.mjs. Shared styles come from style.css. The home navigation adds the same-origin AgentSmith buyer route. The page uses the existing grayscale industrial layout, explicit form labels, responsive panels, text-only source display, and local draft/ZIP downloads.

The standalone customer receiving page is published at **https://agentsmith-receiving.tokenjunkielabs.chatgpt.site** under the Bryce / TokenJunkieLabs Sites account, public project **appgprj_6acc430d195c8191a124909673496433**. Its first deployed source is **6f4ec6a14ff9f62464d2e356c5d5751289c9ab8c**, version **appgver_b6c72a5528308191a33f0bc44c2b89c6**. The receiving assets use the same original source as merged **9fec9b4df3d6933221aa4dae87a2b8866de80fd1**; its root page and navigation form the standalone customer destination.

The existing developer-site copy remains available for an owner of that separate project to publish with its complete current merchant edition. Future AgentSmith customer page updates use the dedicated receiving project's original source and hosting binding. Send customers the branded receiving URL.

## Validation

The generated nine-file customer packet completed original native **prepare → review → prepare → inspect** at **2026-10-12T02:25:33Z**, with every command exiting 0. Draft import reproduced the identical 66,463-byte ZIP. The complete original source, exact 21-byte request, stable intent, native review and saved receiving files remained unchanged on reopen.

The original interruption/recovery operation also completed at **2026-10-12T02:25:31Z**. It resumed after committed payment-required.json and after committed native review.json, continued through the original SF88 preparer and reviewer, and rejected a changed intent while retaining the original operation. All 15 original native source blobs and the customer receiving assets were checked before execution.

The compact outcome and compressed complete native stdout are retained at **.swarm-delivery/8f43-agentsmith/customer-native-result.json** and **customer-native-result.json.gz**. The complete receiving modules passed original Acorn parsing, and the page's referenced UI IDs and source assets were checked during preparation.

TokenJunkieLabs. Preserve the original MIT license in distributed packets.
