# Tenderly customer analysis

Receive a completed Tenderly simulation, inspect its execution, compare two saved
results, and keep a readable review with the original customer delivery. The
workspace connects directly to the maintained Node buyer result and to the
Tenderly partner's portable customer export.

The maintained files are a local application, library and command line. They use
Node 22.16 or later and the adjacent original Node buyer SDK. No extra runtime
packages are required. All state belongs in a private directory outside the
software installation.

## Open the workspace

The installed toolkit exposes `starforge tenderly-analysis` and the
`@tokenjunkielabs/starforge-merchant/buyer/tenderly-analysis` library entry.
The server and pure record functions have adjacent `/server` and `/records`
exports. From the matching source checkout:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/tenderly-analysis/cli.mjs \
  serve --workspace /private/customer/simulation-analysis --port 8468
```

Open the printed private loopback URL. Its access token stays in the URL fragment
and then in that browser session. The listener serves only `127.0.0.1`; API calls
check the original host, origin and token.

Choose **Receive**, select the original `response.json`, and add the partner's
`simulation-request.json` and `buyer-result.json`. The request retains the EVM
network, explicit block and transaction index, sender, recipient, call data, gas
limit and value. The saved response must match the original buyer's completed
file size and SHA-256 when a buyer result is attached. Give the capture a useful
label and receive it.

The **Overview** shows the provider simulation ID, transaction outcome, exact gas
units, execution context and original buyer outcome. The **Calls**, **State**,
**Assets** and **Logs** sections preserve provider records and link each row to
its location in the unmodified JSON. Missing provider collections remain visible
as unavailable. A reverted transaction is retained as a completed provider result
with its actual status and error information.

Select another capture in **Compare with**. The context comparison comes first,
followed by outcome and gas differences. Call comparison aligns structural
position and exact call identity; state comparison uses kind, address and slot.
Repeated asset or event identities retain their occurrence order. Inspect either
side's original record directly. All integer arithmetic uses decimal strings and
`BigInt`, preserving gas and value precision.

**Save review** retains the exact selected captures, title and notes. Download its
self-contained HTML or full JSON under **Saved reviews**. **Source & exports**
provides the original files, full analysis and readable report; individual record
sections also provide CSV. Reopen the same workspace to continue with the same
captures and reviews.

## Receive from the original Node buyer

The original buyer continues to own its request, approval, signer, execution,
spending records and saved response. Pass its completed `BuyerResult` directly:

```js
import { receiveBuyerResult } from './tenderly-analysis/library.mjs';

const capture = await receiveBuyerResult(customerResult.original, {
  workspace: '/private/customer/simulation-analysis',
  request: customerResult.analysisRequest(),
  label: 'Token approval at the reviewed block',
});

console.log({ id: capture.id, analysisPath: capture.analysisPath });
```

This is the contract used by `partners/tenderly-stellar-pilot/customer/`. The
original Node SDK's verified file reader checks the saved result before receiving
it. The analysis stores the unchanged native result and its separate provider
execution outcome. Receiving calls no provider, buyer or signer.

For an original CLI summary still on the buyer host, use its retained saved-file
location:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/tenderly-analysis/cli.mjs \
  receive --workspace /private/customer/simulation-analysis \
  --result /private/customer/buyer-result.json \
  --request /private/customer/simulation-request.json --label 'Reviewed approval'
```

For a portable customer export received on another host, select its actual local
response and attach the unchanged buyer result:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/tenderly-analysis/cli.mjs \
  receive --workspace /private/customer/simulation-analysis \
  --response /private/received/response.json \
  --buyer-result /private/received/buyer-result.json \
  --request /private/received/simulation-request.json
```

The supplied local response is verified against the retained delivery metadata.
The original absolute buyer path remains part of that original record. A raw
provider export can also be received by omitting `--buyer-result`; the workspace
records its source as a provider response.

Raw Tenderly `{ "transaction": ..., "simulation": ... }` is the default input.
For a merchant's explicit wrapper, `--payload-pointer /result` selects the provider
object using a JSON pointer. Response files may be up to 64 MiB; optional request
and buyer-result files are limited to 4 MiB each. Labels are limited to 160
characters and review notes to 20,000 characters.

## Compare, review and export in an application

```js
import { openCapture, compareCaptures, saveReview, exportCapture }
  from './tenderly-analysis/library.mjs';

const workspace = '/private/customer/simulation-analysis';
const saved = await openCapture(workspace, captureId);
const { comparison } = await compareCaptures(workspace, beforeId, afterId);
const review = await saveReview(workspace, {
  beforeId, afterId,
  title: 'Approval execution comparison',
  notes: 'Review the changed transaction index before interpreting the gas difference.',
});
const exported = await exportCapture(workspace, captureId, '/private/handoff/approval');
```

The CLI exposes matching `list`, `inspect`, `compare`, `review` and `export`
actions; `--help` shows their arguments. A complete export contains the original
response and supplied context, capture metadata, full `analysis.json`, four CSV
tables, a readable review, and a file manifest. CSV protects text that spreadsheet
applications might interpret as a formula; original JSON retains exact values.

Capture IDs bind the exact response, supplied request, native record and selected
payload pointer. Repeating the same receive recovers the existing capture.
Inputs are written before the completed capture record. Incomplete receives can
resume against those same bytes after storage recovers. Export also retains its
source binding and recovers an interrupted directory without replacing files.
Changing source bytes creates a distinct capture; reopening checks the retained
inputs and analysis. Errors expose a stable `code` property from `AnalysisError`
or the original `BuyerError`.

## Provider interpretation

The implementation uses the original Tenderly Simulation API field names.
`simulation` supplies the observed context; disagreements with `transaction` or
the supplied request appear in context observations. Native request pins remain
separate from the provider's observed values. Transaction-index semantics and
provider response fields follow the current official
[Single Simulations documentation](https://docs.tenderly.co/simulations/single-simulations)
and [Simulation API reference](https://docs.tenderly.co/reference/api#/operations/simulate).

This component's source is MIT, matching the original toolkit.
