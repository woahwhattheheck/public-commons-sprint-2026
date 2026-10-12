# AgentSmith — retained Stellar buyer integration

This component takes the original AgentSmith paid HTTP request through source capture, an exact saved offer, the maintained Commons buyer's review, and the same operator's wallet execution. It includes the original October 12 HTTP source so a receiving engineer can reproduce preparation immediately, then refresh the real merchant terms for a new operation.

The executable owns source intake and preparation. SF88 owns the buyer configuration and request-body pin; SF81/SF36 own operator approval and the spending journal; SF103 owns native Stellar construction and the browser signer; SF31 owns the paid HTTP retry and saved response.

## Receive the original request

Use a complete Commons checkout with Python 3.11+ and Node 22+. Run from the checkout root. Choose a private parent directory that already exists.

```sh
AGENTSMITH_CHECKOUT="$PWD"
AGENTSMITH_PRIVATE=/absolute/private/agentsmith
mkdir -m 700 "$AGENTSMITH_PRIVATE"

python3 stellar/scf-starforge-20261009/partners/agentsmith/capture.py restore \
  --source stellar/scf-starforge-20261009/partners/agentsmith/source-http-20261012.json \
  --directory "$AGENTSMITH_PRIVATE/source"

python3 stellar/scf-starforge-20261009/partners/agentsmith/capture.py prepare \
  --capture "$AGENTSMITH_PRIVATE/source" \
  --checkout "$AGENTSMITH_CHECKOUT" \
  --directory "$AGENTSMITH_PRIVATE/request" \
  --intent-id agentsmith-metar-CHOOSE-ONE-STABLE-OPERATION-ID
```

Replace the intent value with the receiving operator's stable operation ID. Preparation calls the original SF88 `--prepare` and `--review` commands. Its result is `request/review.json`, an exact private `request.json`, native preparation/review output, and a preparation record tied to the original capture.

The retained operation posts `{"icao":"KJFK"}` to `https://agentsmith.xyz/metar/v1/metar`. Its original body is 21 bytes, including JSON formatting and its trailing newline. Those bytes are copied unchanged and pinned by the native buyer; the example printed here expresses the JSON value.

To obtain current terms for a new operation, use `capture` in a new source directory:

```sh
python3 stellar/scf-starforge-20261009/partners/agentsmith/capture.py capture \
  --directory "$AGENTSMITH_PRIVATE/current-source" --icao KJFK
```

The capture performs the actual public facilitator `GET /supported` and the actual unpaid seller `POST`. It retains response URLs, status, headers, original body and UTC retrieval times. The complete decoded `PAYMENT-REQUIRED` object becomes one `resources` row for native SF88 preparation. Resource metadata, both advertised schemes and all Bazaar extensions remain intact.

## Selected native contract

The October 12, 2026 capture at 00:36:42 UTC contained this exact selected offer:

| Field | Original value |
| --- | --- |
| Resource | `https://agentsmith.xyz/metar/v1/metar` |
| Method | `POST` |
| Request | JSON `icao: KJFK` |
| x402 version | `2` |
| Scheme / network | `exact` / `stellar:testnet` |
| Atomic amount | `40000` |
| Display amount | `0.004 USDC`, using Stellar USDC's seven decimals |
| Asset contract | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Recipient | `GBW2N6DQ5QQVVUFBMH7KORTUB55JMVJCRAXEAUONUHUGB4ETE5KZ7FNI` |
| Authorization lifetime | `300` seconds |
| Fee sponsorship | `extra.areFeesSponsored: true` |
| Request content type | `application/json` |

The native buyer selects the sponsored exact authorization offer. AgentSmith also advertises `upto`; that original offer is retained as source context. Changing the chosen network, asset, recipient, amount, request body or payment flow is a new operator review.

The facilitator response advertised the same sponsored exact testnet scheme. Its exact URL is `https://agentsmith.xyz/facilitator/supported`. The merchant calls facilitator verification and settlement; the buyer's paid retry goes to the original resource URL.

## Continue through the original operator and Freighter

Install the native buyer's pinned runtime using its existing setup guide. The browser-wallet component under `sf103-native-buyer-signer/browser-wallet/` supplies the ready Freighter provider and the following commands. Its current README owns wallet setup and runtime requirements.

Initialize the original SF88 operator workspace from the prepared review, with the actual existing payer address selected in Freighter:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --init-workspace --config "$AGENTSMITH_PRIVATE/request/review.json" \
  --dir "$AGENTSMITH_PRIVATE/operator" \
  --actor CHOOSE-OPERATOR-ID --service agentsmith-metar \
  --payer ACTUAL_EXISTING_TESTNET_PUBLIC_ADDRESS --python /usr/bin/python3

node stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs prepare \
  --buyer-config "$AGENTSMITH_PRIVATE/operator/operator.json" \
  --out "$AGENTSMITH_PRIVATE/wallet"

node stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs serve \
  --workspace "$AGENTSMITH_PRIVATE/wallet"
```

Open the private loopback URL shown by the wallet server. Connect the intended Freighter account on Stellar testnet. In another operator terminal, execute the same prepared request:

```sh
node stellar/scf-starforge-20261009/sf103-native-buyer-signer/browser-wallet/cli.mjs execute \
  --workspace "$AGENTSMITH_PRIVATE/wallet" \
  --operator-workspace "$AGENTSMITH_PRIVATE/operator"
```

The wallet execution opens the existing operator workspace, checks the original configuration digest, loads its original operator keys and uses the same spending journal. The derived buyer changes only its signer module. The operator reviews the native request and spending terms before Freighter signs the original authorization. Keep the original workspace, wallet directory and stable intent together through execution and recovery.

Successful HTTP receiving saves the merchant response at `request/metar-result.json`; the original buyer records its operation outcome in the operator evidence directory. Use the native buyer's finalization and recovery commands on that same operation when inspecting its receipt, transfer and saved response.

## Reopen or adapt the receiving package

```sh
python3 stellar/scf-starforge-20261009/partners/agentsmith/capture.py inspect \
  --capture "$AGENTSMITH_PRIVATE/source"
```

Reopening checks the retained request, original HTTP bodies, decoded header, complete saved offer and selected terms together. `restore`, `capture` and `prepare` create new output directories. An interrupted preparation retains its original files; correct setup, keep the same source and intent, and select a fresh preparation output directory.

For another agreed AgentSmith seller, pass its actual HTTPS URL, facilitator and JSON body:

```sh
python3 stellar/scf-starforge-20261009/partners/agentsmith/capture.py capture \
  --url https://ACTUAL-MERCHANT-HOST/ACTUAL-PAID-ROUTE \
  --facilitator https://agentsmith.xyz/facilitator \
  --body-file /absolute/private/agreed-request.json \
  --directory /absolute/private/new-merchant-source
```

This recipe requires a sponsored exact Stellar testnet USDC authorization offer and an exact match between the challenged resource and the requested URL. The same full request then enters native preparation. Merchant-specific response interpretation belongs in the agreed API adapter; METAR fields should not be imposed on a different product.

## Native receiving performed

Python 3.12 and Node 24.19.0 ran the actual retained METAR source through the original SF88 preparation and offline review at Commons commit `3f055d51322329768f487557b689803be07b5247`. Both commands exited 0. Reopening the same captured source also exited 0.

- Original request: 21 bytes, SHA-256 `48b7f29c8f78676a1a8cf2a1bebe83a01bf970ffe584ff70a9cdb7d694fecd93`.
- Native saved-offer source: SHA-256 `a1601a2cf425f94b59e8364cda57612292238f243b8007b9f9fa14de8e02b69b`.
- Selected source row / offer: `0 / 0`; exact testnet USDC, 40,000 atomic, 300 seconds.
- Native result: `OFFLINE_CONFIG_PREPARED` and `OFFLINE_REVIEW`, with the request body pinned and the complete original listing retained.

## Source lineage

- [AgentSmith product and onboarding](https://agentsmith.xyz/).
- [57Blocks' operated blockchain products](https://57blocks.com/blockchain).
- [Original METAR implementation](https://github.com/57blocks/weather-x402/tree/f0fdd336f922ecf258734d7fc3c6273334a1f3d1): paid request, browser buyer and seller payment configuration.
- [Original AgentSmith facilitator and Bazaar](https://github.com/57blocks/agentsmith-x402/tree/3b1c9d2dfcea872e47a06cce5b1c725fb3776129): sponsored exact settlement, catalog metadata and settlement callbacks.
- [Original SF88 buyer](../../sf88-operator-buyer-cli/README.md) and [native signer](../../sf103-native-buyer-signer/README.md).
- [Official Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide).

The adapter source in this directory is MIT. Upstream implementations remain in their original repositories and packages.
