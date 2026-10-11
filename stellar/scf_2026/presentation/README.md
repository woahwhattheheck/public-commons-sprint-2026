# SCF product presentation

This presentation follows one completed MySQL purchase through the maintained
Stellar Forge buyer console. It shows the merchant's original reviewed query,
the closed quote and payment terms, its retained Stellar transaction observation,
the complete purchased data, an actual browser download, and the same result
after closing and reopening the recording workspace.

The applicant and future deployment plan come from the existing canonical SCF
application. The film identifies Bryce Muhlnickel as the individual applicant
and discloses AI assistance. The proposed $38,000 and 400 hours fund future work
over 150 days; the seven completed team-operated testnet purchases remain a
baseline separate from the proposed independent-operator and mainnet outcomes.

## Recorded product and original operation

The unmodified buyer runtime and its static UI match published source commit
`57835a18f005cf63b5e5e76e0538860806196cc9`.
The maintained merchant archive is
`@tokenjunkielabs/starforge-merchant@0.1.0-source.g57835a18f005`.
Its release includes the merchant packaging tools, buyer workspace, complete
result tools and operating guides.

The original operation is
`scf-hpd-native-mcp-mysql-b028-20261011`.
It purchased the named `hpd_projects` query with
`{"constructionType":"Preservation","minimumUnits":"20"}`.
The retained NYC HPD source contains building-in-project events in Queens;
these records are not current vacancies or unique-building counts.
The configured query returns at most 100 rows and retains exact scalar strings.

| Original item | Value |
| --- | --- |
| Quote | `c2a5d4c5-e2c3-4d50-abe2-3edb4c8fa36e` |
| Transaction | `50d61d1102bfcf960af44171e5248e0899ed6d99cec1951a62075f9a65a6cbed` |
| Network / ledger | Stellar testnet / 5145195 |
| Native payment | 50000 stroops / 0.005 testnet XLM |
| Complete result | 100 rows, 14 columns, 53,468 bytes |
| Result SHA-256 | `4c22f8a26d48156c3e07543328b62ca6f993ce60856166d6805dc0660d9acb8d` |
| Source encoding | `mysql-exact-scalars`; configured truncation remains present |

The recorder reads the two closed quotes from the original inspection workspace
and imports their exact saved files into a separate private recording workspace
through the maintained result API. Their original statuses, attempts and
transaction observations stay attached to their original quote IDs. It verifies
the complete UI result and actual downloaded bytes against the retained original.
After reopening, it verifies the same successful quote, attempt count, transaction
observation and result identity.

The recording workspace has no payment adapter. The existing transaction
observation is already saved, so the film does not need another ledger request
or purchase. Authentication happens before recording; the private access token
is generated in memory and is never included in the deliverables.

## Companion workflow: saved simulations

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
showing those saved artifacts. This saved-simulation workflow remains a separate companion demonstration.
The current filmed purchase is the original MySQL operation documented above.

## Capture and composition

`film.json` contains the ordered narrative, chapter durations and source links.
`record.mjs` opens the original product UI and performs the recorded interactions.
It streams actual browser screenshots directly into one H.264 chapter clip at a
time. The film uses edited holds on these actual screens; it is not a real-time
recording of elapsed operation latency. This keeps temporary storage small and
avoids a large cache of repeated JPEG files.

The resulting `capture.json` uses
`stellar-forge.presentation.capture/2`: ordered chapter clips, actual encoded
frame counts, frame rate, dimensions, duration and file identity. Chapter timing
is derived from those frames. Only a complete capture with the actual download
and reopen journey should be rendered as the finished presentation.

`render.py` composes the clips into a 1920×1080, 24 fps MP4, with a reserved
heading band and synchronized captions below the UI. It also creates WebVTT,
a matching presenter script and a source index. It continues to accept the
original frame-based recording format. See [PRODUCTION.md](PRODUCTION.md) for
the composition contract and production controls.

Use an installed Node runtime with SQLite support, the available Playwright and
Chromium installation, and FFmpeg with libx264 and libass. Keep all runtime state
and original operator records outside this public source directory.

Example private capture configuration, with the actual absolute source paths:

```json
{
  "source": "/absolute/verified-source",
  "sourceIdentity": "/private/verified-source-identity.json",
  "originalState": "/private/original-closed-inspection/buyer-workspace",
  "state": "/private/recording/buyer-workspace",
  "nativeOperation": "/private/original-operation/operation.json",
  "nativeInspection": "/private/original-closed-inspection/native-result.json",
  "nativeResponse": "/private/original-closed-inspection/original-hpd-result.json",
  "merchantPackage": "/private/original-operation/mysql-mcp-product",
  "output": "/absolute/recorded-film",
  "tmp": "/private/recording/tmp",
  "playwright": "/absolute/playwright/index.js",
  "chromium": "/absolute/chrome-headless-shell",
  "ffmpeg": "/absolute/ffmpeg"
}
```

The source identity file contains the published commit and selected source files
as `{path, bytes, sha256}` entries under `files`, plus `all_match: true`.
The recorder rechecks those bytes before opening the UI. It also rechecks the
original operation, source review, complete response and cached transaction.

Run capture and composition inside the existing native-job admission mechanism
for the selected worker. Keep one operation identity and one browser/encoder
lifetime rather than launching duplicate jobs. The selected production configuration declares
768 MiB of memory plus a 256 MiB reserve; runtime admission remains
the worker's responsibility.

```sh
node stellar/scf_2026/presentation/record.mjs /private/capture-config.json
python3 -B stellar/scf_2026/presentation/render.py /absolute/recorded-film
```

Keep the recording state private. The public presentation source, finished film,
captions, script and source index can be delivered together through the existing
SCF application workstream. This presentation supplements the canonical
application; it does not submit a new application or assert an award.
