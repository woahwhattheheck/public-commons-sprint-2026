# AgentSmith buyer receiving page

The existing Stellar Forge site exposes **/agentsmith.html**. It turns the retained AgentSmith HTTP source into a complete portable preparation and runs the maintained buyer and Freighter wallet from that preparation.

## Product flow

Open the page, review the original unpaid POST and advertised payment choices, and choose a new absolute private directory on the receiving Linux host. Keep one stable operation ID. The actual Freighter public payer can be selected now or supplied when the original operator is initialized.

**Save editable draft** writes setup-input.json, including the exact source text. **Open saved draft** restores that preparation. **Download receiving packet** writes a nine-file ZIP using the existing onboarding.mjs ZIP implementation.

| Packet file | Role |
| --- | --- |
| source-http.json | Complete original request and both HTTP response captures |
| request.json | Exact UTF-8 request bytes |
| capture.py | Original native capture and preparation program, unchanged |
| buyer.mjs | Receiving runner that calls the original buyer and wallet commands |
| packet.json | Operation settings and source/program digests |
| setup-input.json | Complete editable receiving draft |
| INSTALL.json | Native command arrays and their shell rendering |
| README.md | Runtime, preparation, execution and reopen guide |
| LICENSE | Original MIT license and attribution |

The original offer decoder remains offer.mjs. The native capture program is retained from **stellar/scf-starforge-20261009/partners/agentsmith/capture.py** at source **41f15c0e57d2ba9655885399c1b37134e1a81d41**, SHA-256 **60dd7f472ec518846f50c222160c53751554648f492d150f384b70fa05fb4381**.

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

The packet's **inspect** also reopens the retained capture and reviewed request, reviews the original operator if present, and reports the saved response path and size. Repeating **prepare** reopens its completed native preparation. Repeating **operator-init** checks the existing trustedPayer and reviews the same operator. Repeating **wallet-prepare** inspects the existing wallet. Interrupted execution continues through the original buyer and wallet recovery commands with its retained ledger and keys.

## Site integration

The additive receiving assets live in the existing **dist/** tree:

- agentsmith.html, agentsmith.css and agentsmith-setup.mjs.
- agentsmith-onboarding.mjs and agentsmith-runner.mjs.
- agentsmith-capture.py, agentsmith-source-http.json and agentsmith-LICENSE.txt.

The page imports the existing offer.mjs and onboarding.mjs. Shared styles come from style.css. The home navigation adds the same-origin AgentSmith buyer route. The page uses the existing grayscale industrial layout, explicit form labels, responsive panels, text-only source display, and local draft/ZIP downloads.

Publishing consumes the complete current developer-site tree through the original Sites project and its existing audience. The nonsecret .openai/hosting.json remains its project binding. The original publisher can assemble these additive assets with the current WooCommerce, Fleet, CoinGecko, OpenSearch and merchant workspace edition.

## Validation

The original HTTP source and unchanged capture program completed restore, native SF88 prepare, review and reopen with all commands exiting 0. The buyer retained the exact 21-byte request, source offer, stable intent and response destination. The browser wallet's owning engineering lane completed its native SDK/provider lifecycle on the maintained wallet source.

The receiving page's three ESM files passed V8 syntax parsing. Every directly referenced UI ID exists and all HTML IDs are unique. Exact capture and HTTP bundle content match their retained original source. The native nine-file packet operation and browser layout review belong to the receiving/publishing run on the original equipped host.

TokenJunkieLabs. Preserve the original MIT license in distributed packets.
