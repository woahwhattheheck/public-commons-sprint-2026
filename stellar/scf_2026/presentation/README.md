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
