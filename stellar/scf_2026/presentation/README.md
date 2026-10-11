# SCF product presentation

This presentation records the original seller developer workspace and SF66
commerce workspace, then presents the retained native testnet purchase and its
original saved merchant response. `film.json` holds the synchronized narrative;
`record.mjs` captures actual browser interactions; `render.py` produces a playable
1080p MP4, WebVTT captions and matching presenter script.

The live UI source is pinned to published commit
`a4a8dccb3ce3ea01d56624fbda0edee32b47bb20`. It uses the original six-method
merchant configuration in a separate, challenge-only commerce session. The
recording reviews a PATCH request, inspects an unpaid response, and cancels and
reopens a different queued request through the original durable inbox. No
source modification changes those UI or runtime behaviors.

The completed native purchase is a **separate retained result**: transaction
`88ea8e8012f69e065ea0e490ce922a9899448217234dceb1a6b9fc9cf4cbbcb7`, ledger
`5142311`, `50000` atomic units of native testnet XLM. Its isolated local policy
did not exercise public ingress or production workspace approval. Its original
80-byte JSON response and independent retained chain observation supply the
payment and result cards. The recorder checks their identities before capture.

## Use the published installed runtime

The recorded commerce and seller developer UI is also delivered in
`@tokenjunkielabs/starforge-merchant` version `0.1.0-source.g34ad473dc9a3`,
[published PR972](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/972).
Its 22 included commerce/developer files match this recording's source exactly.
The original distribution's
[build guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/34ad473dc9a32b2fc09d9842ab826b7208288288/stellar/scf-starforge-20261009/distribution/README.md)
describes reproducing the archive from that same published commit.

Install the delivered archive in the intended application directory:

```sh
npm install --ignore-scripts --offline --omit=optional --no-audit --no-fund \
  /absolute/tokenjunkielabs-starforge-merchant-0.1.0-source.g34ad473dc9a3.tgz
./node_modules/.bin/starforge source
./node_modules/.bin/starforge commerce inspect \
  --directory /absolute/private/recording-session
```

The archive SHA-256 is
`e8b9dca70d2b47b7cb1fa799d488beac14b2af3c77e5bdbbc37549f5bd18748b`.
For a subsequent take, set `source` in the private capture configuration to
`/absolute/application/node_modules/@tokenjunkielabs/starforge-merchant/source`.
Keep `record.mjs` and its `film.json` together at their published presentation
source location. The recorder imports the original commerce runtime from that
installed package and opens its own session/browser lifetime as described
below. The source pin above remains the identity of the already-recorded take.

## Run a live saved-simulation demonstration

Use the complete current [Tenderly merchant and customer source](../../scf-starforge-20261009/partners/tenderly-stellar-pilot/README.md)
with the matching [retained analysis](../../scf-starforge-20261009/sf88-operator-buyer-cli/tenderly-analysis/README.md).
This live follow-up starts from one saved merchant profile and carries its exact
request into the customer's original purchase and retained result.

With Node 22.16+ and the existing runtime dependencies, open that profile from
the repository root:

```sh
node stellar/scf-starforge-20261009/partners/tenderly-stellar-pilot/workspace/server.mjs \
  --state /absolute/private/tenderly-workspace \
  --plan /absolute/private/tenderly-plan.json --port 0
```

Supply the saved plan's provider environment and stable operation key. Open
the local URL printed by the process; keep its access fragment outside the
capture. The [workspace guide](../../scf-starforge-20261009/partners/tenderly-stellar-pilot/WORKSPACE.md)
covers original facilitator selection, private launch and public merchant ingress.

| Scene | Operate and explain |
| --- | --- |
| Merchant | Review the saved provider project, EVM data network, simulation mode and independent Stellar payment terms. Prepare and open the same immutable profile. |
| Request and customer | Select the historical block, transaction position and exact call inputs. Download the complete request packet. Follow the original [Node or Python customer](../../scf-starforge-20261009/partners/tenderly-stellar-pilot/CUSTOMER.md) to import it and review its request, ticket and independent spending limit. The chosen customer application owns execution and recovery. |
| Usable result | Open the completed intent, display the simulation ID, block, gas and success or revert, and inspect its complete original JSON. Export the response with its retained request and native buyer record; the analysis consumer opens that same export. |
| Continuity | Drain and reopen the same merchant profile and customer state, then download the same result. For an existing uncertain operation, resolve its saved provider outcome against the current generation through Results & recovery. |

Suggested narration: “The merchant sells an explicitly selected simulation.
The buyer keeps the exact request, approved spend and returned result.
A reverted EVM call is still useful simulation output. Both operators reopen
the same operation when delivery is interrupted.”

The retained local source exercise uses documented Tenderly response fixtures
and the original nativeFactory acceptance seam. Identify that mode when
showing those saved artifacts. The original film's separately retained native
Stellar purchase remains its payment segment.

## Record and render

Use the existing Node runtime, Playwright/Chromium installation and FFmpeg with
libass. Start from the prepared original merchant/operator inputs. Initialize
a separate commerce session with the original `commerce-cli.mjs init`; omit
its facilitator configuration for this challenge-only presentation. Keep the
original payment records read-only. The recorder opens the original session
and browser in the same process environment, which also works on hosts whose
individual command invocations have separate loopback namespaces.

Save the following private configuration with the actual absolute paths:

```json
{
  "source": "/absolute/pinned-source",
  "session": "/absolute/private/recording-session",
  "output": "/absolute/recorded-film",
  "playwright": "/absolute/playwright/index.mjs",
  "chromium": "/absolute/chrome-headless-shell",
  "requestBody": "/absolute/original/prepared/bodies/05.json",
  "secondIntent": "setup-native-get-20261011",
  "nativeJourney": "/absolute/original/native-paid-journey-result.json",
  "nativeResponse": "/absolute/original/native-paid-response.json",
  "chainObservation": "/absolute/original/live-rpc-verification-88ea8e80/result.json"
}
```

```sh
node stellar/scf_2026/presentation/record.mjs /private/capture-config.json
python3 stellar/scf_2026/presentation/render.py /absolute/recorded-film
```

The recording deliberately cancels the selected second intent in **its own**
session. Use a fresh separate session for a subsequent take, preserving the
original operator session and accepted payment. Wallet material, capability
URLs and runtime inputs are not part of the source or delivered film.

The generated presenter script includes the original source and application
references. Applicant facts and the prospective budget come from the existing
canonical manuscript; this presentation does not submit another application,
assert an award, or represent testnet activity as commercial revenue.

