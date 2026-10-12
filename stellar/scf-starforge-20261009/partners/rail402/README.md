# Rail402 merchant receiving

Carry Rail402-backed HTTP resources through the existing Stellar Forge buyer, original operator accounting and Freighter signing flow. The receiving package preserves the exact merchant request and complete unpaid payment challenge, prepares the original SF88 configuration, and binds the same original operator and wallet to that reviewed operation.

The source covers query-based GET, concrete path GET and JSON POST. The [current upstream source](https://github.com/tolgayayci/rail402/blob/53b476149d43886e7ed37bc3c7c3cd1ee68f9cf8/apps/demo-seller/src/seller.ts) defines the hosted weather, profile and translation demonstration routes; their response contracts and original request examples are in `contracts.json`. Use a selected merchant's authoritative input and useful output for a commercial installation.

## Capture and prepare

Use Linux or macOS, Python 3.11 or newer, Node.js 22.16 or newer, and the complete existing Stellar Forge checkout or installed source layout.

```sh
python3 capture.py capture --directory /ABSOLUTE/PRIVATE/source --url 'https://demo.rail402.dev/weather?city=Ankara' --method GET
python3 capture.py prepare --capture /ABSOLUTE/PRIVATE/source --checkout /ABSOLUTE/EXISTING/TOOLKIT --directory /ABSOLUTE/PRIVATE/request --intent-id rail402-weather-001
python3 capture.py inspect --capture /ABSOLUTE/PRIVATE/source
```

For a JSON POST, supply the exact input file with `--method POST --body-file /ABSOLUTE/REQUEST.json`. The capture records the original body bytes, method, concrete URL, facilitator response, original HTTP402 headers and body, full decoded payment challenge and selected sponsored exact testnet USDC offer. The native preparer receives that complete challenge and the same explicit request. A GET has no body binding. A JSON POST retains the exact file, length, digest and content type.

The generated `source-http.json` is portable: `capture.py restore --source ORIGINAL/source-http.json --directory NEW_PRIVATE_SOURCE` reopens its original bytes offline. Repeat capture or restore with the same inputs and private directory after an interrupted source write. Repeat prepare with the same source, destination and intent to reopen or finish its original configuration. Completed source/request files remain bound to the same operation.

## Retained original requests

The customer chooser loads the actual retained merchant HTTP responses from 2026-10-12. Each route completed the maintained SF88 prepare/review/reopen journey with its own operation identity. `captures.json` maps the three original source bundles to their SHA-256 digests. The weather URL retains `?city=Ankara`, the profile retains `/users/42`, and the JSON POST retains its full 36-byte request with SHA-256 `4213917ad487b0585310d3778a5e53f03de903cf73a5f5c27f9d3791492861d2`. The live original offers are 10000, 10000 and 20000 atomic testnet USDC respectively, with 300-second authorization lifetimes and sponsored fees.

## Original operator and wallet

The customer packet includes `buyer.mjs`, the complete capture source, original HTTP bundle and request, saved setup, command arrays, license and an operating guide. Its actions are `prepare`, `review`, `operator-init`, `wallet-prepare`, `wallet-serve`, `execute`, `result` and `inspect`; each takes `--toolkit /ABSOLUTE/EXISTING/TOOLKIT`. The packet's receiving interface supplies its exact private directory, stable intent and operator. A payer can be selected in that preparation or passed explicitly to `operator-init --payer G...`.

Select the maintained runtime's `native` and `freighter-wallet` features. The buyer uses the existing @x4022.28.0 engine, original Stellar SDK and Freighter6.0.1 bridge. Its operator initialization keeps the original policy, ledger and three accounting keys. Wallet preparation and execution use that same operator; the original buyer owns approval, reservation, current offer review and payment execution. The same native child receives cancellation signals and its exit status is preserved.

Successful execution saves `request/merchant-result.json`. The `result` action parses that actual JSON response and publishes a retained view containing its operation identity, source file, exact response digest and the complete payload. `inspect` reopens the original capture, request, operator and saved response.

## Merchant adoption

TokenJunkieLabs offers a fixed US$4,800 merchant launch: one existing real API with up to three HTTP operations, one actual response adapter, original buyer/operator/Freighter wiring, retained result, interruption recovery, one merchant-owned deployment target and an editable operator handoff. The payment schedule is US$2,400 at kickoff and US$2,400 on acceptance. Delivery is ten business days after the selected API, supported target configuration and working access are available. One correction cycle for agreed acceptance items is included within five business days of delivery. Hosting, service usage and payment charges remain with the commissioning party under its own accounts.

Rail provides its technical contact and selected supported facilitator/network. The merchant supplies the actual API/source or documented extension point, receiving account, sample requests, intended response contract and release owner. Acceptance follows that agreed route/response matrix: each unpaid route exposes its actual payment terms; exact URL/method/body persist through approval and execution; the selected operator/account receives the expected result and payment outcome; reopening preserves the original operation; and a second operator completes installation and the written walkthrough. Rail can commission the work directly or introduce a merchant for a jointly scoped direct engagement. Rail retains its rail, catalog and customer relationship. Its current catalog is created from settlement and subsequent merchant-origin verification; the maintained capture retains the original Bazaar and payment-identifier metadata.

Authoritative provider documentation: [buyer quickstart](https://docs.rail402.dev/quickstart/buyers), [seller quickstart](https://docs.rail402.dev/quickstart/sellers), [cataloging](https://docs.rail402.dev/bazaar/cataloging) and [operations](https://docs.rail402.dev/operations). The public source baseline and live responses are retained separately because the hosted provider may contain later features.

MIT license applies to this integration and receiving source.
