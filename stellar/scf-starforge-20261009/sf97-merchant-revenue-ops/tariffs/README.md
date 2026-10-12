# Merchant tariff workspace

Plan merchant prices against an exact source version, compare volume assumptions, save a review, and carry a selected comparison into the existing scenario and pricing workflow.

The tariff workspace uses the original seller configuration, observations, commercial terms, pricing state, request identities and native repricing operations. The command-line operator, HTTP client and browser console share the same workspace methods.

## Run the operator

Use the product's existing Node runtime. Commands below run from `sf97-merchant-revenue-ops/`.

~~~bash
node ./tariffs/cli.mjs \
  --config /absolute/path/seller.json \
  --state /absolute/path/merchant-pricing \
  --snapshot /absolute/path/native-snapshot.json
~~~

The default command starts the local console. The console prints its private launch URL, including `#token=…`, to the terminal. Its port defaults to an available port; `--port 4317` selects a particular local port. Ctrl-C, SIGTERM or SIGHUP closes the HTTP server.

`--state` is the **existing pricing directory**. The tariff workspace derives its own `tariff-plans` and the original `scenario-plans` storage inside that directory. Use the same path across server, command-line and receiving operations.

Choose the source supported by the original pricing workspace:

| Option | Original source |
| --- | --- |
| `--snapshot FILE` | One native seller observation |
| `--history FILE` | Existing captured observation history |
| `--ops-url URL` | Existing loopback operations service |

Supply saved snapshot and/or history files, or a live operations URL. The operator forwards `--native-outbox`, `--source-package` and `--release-store` to the original pricing workspace. `--release-runtime FILE` reads the original runtime JSON object from that file before opening the workspace.

~~~bash
node ./tariffs/cli.mjs --help
~~~

## Understand the two pricing modes

Every tariff belongs to one exact existing route. A tariff has an ID, a label, a mode and increasing quantity tiers. The final tier has `upTo: null`.

**Graduated pricing** charges each portion of the quantity at that portion's tier price. With the first 100 requests at USD 0.05 and the next requests at USD 0.03, a quantity of 150 has a graduated total of USD 6.50.

**Volume pricing** uses the tier containing the total quantity and applies that tier's unit price to every request. Under the same thresholds, 150 requests at the USD 0.03 volume tier have a total of USD 4.50.

A lower all-units price can reduce total gross revenue at a volume boundary. For example, 100 requests at USD 0.05 produce USD 5.00; 101 requests at USD 0.03 produce USD 3.03. The review includes each boundary's before and after quantities, totals, gross change and `decreasesGross` value.

### Selecting a row produces a uniform route price

The existing route pricing workflow uses one uniform price per request. A selected graduated comparison therefore carries a **derived uniform price** into that workflow.

The derivation divides the exact tariff total in micro-USD by the selected quantity and rounds the unit price **up** to the next micro-USD. The review keeps all of these values:

| Field | Meaning |
| --- | --- |
| `quote.totalUsd` | Exact graduated or volume total for the selected quantity |
| `quote.effectiveUnitUsd` | Exact numerator/denominator and the twelve-decimal floor and ceiling |
| `quote.chosenUniformQuoteUsd` | Unit price passed into the original uniform-price scenario |
| `quote.uniformGrossUsd` | Gross total from that uniform unit price and the selected quantity |
| `quote.roundingDeltaUsd` | Difference introduced by rounding the uniform unit price upward |

In the 150-request graduated example, USD 6.50 / 150 is a repeating decimal. The derived unit price is USD 0.043334, giving uniform gross USD 6.500100 and a rounding delta of USD 0.000100.

Keep the selected quantity with its review: it is the volume assumption used to derive that uniform price. The source pricing workflow retains the resulting route patch and its existing commercial assumptions.

A zero-quantity row is useful for comparison and has `scenario: null`. Select a positive quantity when preparing a scenario. The operator never substitutes another row for a zero-quantity selection.

### Cost and contribution fields

The review preserves the original fulfilled-request cost basis, separately identified challenge costs, unknown cost inputs and nullable contribution or margin values. Unknown inputs remain visible in the saved review. Read the original terms and each row's `costs.unknownInputs` before using its margin projection.

All monetary inputs and exact USD outputs use decimal strings. Quantity and micro-USD output fields use integer strings. The original scenario's `monthlyPaidTarget` retains the number form required by its existing planner.

## Full command-line workflow

The commands call local workspace methods directly. Use the same seller, state and source options for each command.

A shell helper makes the examples shorter:

~~~bash
tariff() {
  node ./tariffs/cli.mjs "$@" \
    --config /absolute/path/seller.json \
    --state /absolute/path/merchant-pricing \
    --snapshot /absolute/path/native-snapshot.json
}
~~~

### 1. Inspect the source version

~~~bash
tariff state --output current-state.json
tariff source --version EXACT_SOURCE_VERSION --output selected-source.json
~~~

Use the source version returned by the original pricing state. `source` returns its version, label, capture time, routes, commercial terms, provenance, observation and seller-change indication. Copy an exact route ID from that source into the tariff input.

### 2. Preview tariffs and volumes

Create `preview-input.json` using the actual source version and route ID:

~~~json
{
  "version": "EXACT_SOURCE_VERSION",
  "tariffs": [
    {
      "id": "report-graduated",
      "label": "Graduated report requests",
      "routeId": "EXACT_EXISTING_ROUTE_ID",
      "mode": "graduated",
      "tiers": [
        { "upTo": "100", "unitPriceUsd": "0.050000" },
        { "upTo": "1000", "unitPriceUsd": "0.030000" },
        { "upTo": null, "unitPriceUsd": "0.020000" }
      ]
    },
    {
      "id": "report-volume",
      "label": "Volume report requests",
      "routeId": "EXACT_EXISTING_ROUTE_ID",
      "mode": "volume",
      "tiers": [
        { "upTo": "100", "unitPriceUsd": "0.050000" },
        { "upTo": "1000", "unitPriceUsd": "0.030000" },
        { "upTo": null, "unitPriceUsd": "0.020000" }
      ]
    }
  ],
  "volumes": ["0", "100", "101", "150", "1000", "1001"]
}
~~~

~~~bash
tariff preview --input preview-input.json --output tariff-review.json
~~~

The returned review includes `tariffReviewSha256`, normalized tariffs and volumes, every comparison, exact quote arithmetic, original baseline and cost projections, selectable scenario patches, and tier-boundary changes.

The source model accepts up to 12 tariffs, up to 64 tiers per tariff and up to 24 distinct volume quantities. IDs contain 1–64 letters, digits, underscores or hyphens and start with a letter or digit. Labels contain 1–120 characters. Finite tier caps are positive safe integers or canonical integer strings and increase strictly. Volumes are nonnegative safe integers or canonical integer strings. USD prices are nonnegative decimal strings with at most six fractional digits.

### 3. Save the reviewed input with its identity

A save adds `requestId`, a required nonempty `label` of at most 100 characters and `review.tariffReviewSha256` from the preview response to the original preview input.

This creates one fresh save payload. Keep this exact file for the operation's recovery:

~~~bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const input = JSON.parse(readFileSync("preview-input.json", "utf8"));
const { review } = JSON.parse(readFileSync("tariff-review.json", "utf8"));
const save = {
  ...input,
  requestId: randomUUID(),
  label: "Merchant volume review",
  tariffReviewSha256: review.tariffReviewSha256
};
writeFileSync("save-input.json", JSON.stringify(save, null, 2) + "\n", { flag: "wx", mode: 0o600 });
'
tariff save --input save-input.json --output saved-tariff-plan.json
~~~

The workspace binds the saved review to its original source and tariff-review identity. A changed source or input needs its own current review.

~~~bash
tariff list --output tariff-plans.json
tariff load --plan EXACT_SAVED_PLAN_ID --output reopened-tariff-plan.json
~~~

### 4. Prepare one saved comparison

Use the exact saved plan ID and a positive-quantity comparison ID from that plan:

~~~bash
tariff select \
  --plan EXACT_SAVED_PLAN_ID \
  --comparison EXACT_COMPARISON_ID \
  --output prepared-selection.json
~~~

The equivalent `--input` body is:

~~~json
{
  "planId": "EXACT_SAVED_PLAN_ID",
  "comparisonId": "EXACT_COMPARISON_ID"
}
~~~

Selection returns its `selectionSha256`, the original `scenarioPlanInput` and `pricingInput`, and the associated `scenarioReview` and `pricingPreview`. Its `currentPricing` carries the current revision, latest saved pricing and commercial terms for the current-versus-selected review. Preserve the complete object. Its pricing input carries the original revision and snapshot binding.

### 5. Commit through the existing scenario and pricing owners

Create one commit payload with the complete prepared selection and two distinct original operation UUIDs:

~~~bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const selection = JSON.parse(readFileSync("prepared-selection.json", "utf8"));
const commit = {
  selection,
  planRequestId: randomUUID(),
  pricingRequestId: randomUUID()
};
writeFileSync("commit-input.json", JSON.stringify(commit, null, 2) + "\n", { flag: "wx", mode: 0o600 });
'
tariff commit --input commit-input.json --output committed-selection.json
~~~

The returned `TARIFF_SELECTION_SAVED` result joins the tariff plan and comparison to the original `scenarioPlan` and `pricing` results. Preserve those native results and their original UUIDs. A retry uses the same saved input file; a changed commercial decision begins with a fresh review and its own operation IDs.

The original repricing operations remain available end to end:

~~~bash
tariff repricing-source --version EXACT_PRICING_VERSION --output repricing-source.json
tariff repricing-preview --input original-repricing-preview.json --output repricing-preview.json
tariff repricing-save --input original-repricing-save.json --output saved-repricing.json
tariff repricing-stage --input original-repricing-stage.json --output staged-repricing.json
~~~

These commands pass the original pricing payloads through unchanged. Keep their existing ledger, request, expected-revision and snapshot bindings. Use the original pricing operation's returned inputs and decisions when continuing its save or stage step.

### 6. Receive the saved files and bundle

Tariff plan files use their exact supported names:

~~~bash
tariff download --plan EXACT_SAVED_PLAN_ID --name plan.json --output downloaded-plan.json
tariff download --plan EXACT_SAVED_PLAN_ID --name tariffs.json --output downloaded-tariffs.json
tariff download --plan EXACT_SAVED_PLAN_ID --name comparison.csv --output tariff-comparison.csv
tariff export --output tariff-bundle.json
~~~

The original pricing files are also available through the same operator:

~~~bash
tariff pricing-download \
  --version EXACT_PRICING_VERSION \
  --name EXACT_ORIGINAL_FILE_NAME \
  --output received-pricing-file

tariff repricing-download \
  --decision EXACT_REPRICING_DECISION_ID \
  --name EXACT_ORIGINAL_FILE_NAME \
  --output received-repricing-file
~~~

Use the filename advertised by the original pricing operation. Downloads preserve the returned bytes.

Receiving uses the complete original tariff bundle as one JSON object:

~~~bash
tariff receive --input tariff-bundle.json --output received-tariffs.json
tariff list --output received-plan-list.json
~~~

The receiving workspace validates and stores the bundle through its original receiving method. Keep the accompanying seller configuration, source package, native observation history and original pricing state together when handing over the wider merchant operation.

### File behavior

All JSON commands print the full result, or write a complete `--output` file. Output files are create-only: an already existing path produces `EEXIST` before the workspace opens and stays intact. The operator stages new output beside its destination, flushes the complete bytes, then publishes the new path atomically. Parent directories are created when necessary. If output publication fails after a workspace operation has returned, the command's error JSON includes the complete `operationResult`, preserving the original saved result and its recovery identities.

Downloads require an explicit `--output` path. `--input -` accepts one JSON object from standard input. Unexpected options, duplicate options and ambiguous select/source choices produce a usage error before opening workspace storage.

## Typed HTTP client

`client.mjs` and `client.d.mts` expose the same operation surface for JavaScript and TypeScript consumers.

~~~javascript
import { createTariffClient, TariffHttpError } from './tariffs/client.mjs';

const client = createTariffClient({
  url: 'http://127.0.0.1:PORT/#token=EXACT_64_HEX_LAUNCH_TOKEN'
});

const state = await client.state();
const source = await client.source('EXACT_SOURCE_VERSION');
const review = await client.preview({
  version: source.version,
  tariffs: [
    {
      id: 'report-graduated',
      label: 'Graduated report requests',
      routeId: 'EXACT_EXISTING_ROUTE_ID',
      mode: 'graduated',
      tiers: [
        { upTo: '100', unitPriceUsd: '0.050000' },
        { upTo: null, unitPriceUsd: '0.030000' }
      ]
    }
  ],
  volumes: ['100', '150']
});

try {
  const plans = await client.list();
  console.log(plans);
} catch (error) {
  if (error instanceof TariffHttpError) {
    console.error(error.status, error.code, error.body);
  } else {
    throw error;
  }
}
~~~

The client copies the supplied URL and token at construction. Later changes to a caller-owned `URL` object leave the captured connection unchanged. Authentication uses `Authorization: Bearer TOKEN`; the token fragment is excluded from API URLs. The client accepts HTTP(S) loopback origins and an optional injected `fetch` implementation.

Every method accepts an optional final `{ signal }` for cancellation. Requests use fresh responses, omit unrelated cookies and reject HTTP redirects. The client preserves caller-provided payloads and request IDs and performs one request per method invocation.

### HTTP surface

All JSON routes return the workspace result directly.

| Client method | HTTP route | Body or result |
| --- | --- | --- |
| `state()` | `GET /api/state` | Pricing and tariff state |
| `source(version)` | `GET /api/source?version=…` | Selected source |
| `preview(input)` | `POST /api/preview` | Tariff preview input |
| `save(input)` | `POST /api/plans` | Reviewed input plus save identity |
| `list()` | `GET /api/plans` | Saved plans |
| `load(planId)` | `GET /api/plans/:id` | One saved plan |
| `selection(input)` | `POST /api/selection` | Plan and comparison IDs |
| `commitSelection(input)` | `POST /api/selection/commit` | Complete selection and both UUIDs |
| `download(planId, name)` | `GET /api/plans/:id/files/:name` | Exact bytes |
| `bundle()` | `GET /api/bundle` | Complete tariff bundle JSON |
| `receive(bundle)` | `POST /api/receive` | Complete original bundle |
| `repricingSource(version)` | `GET /api/repricing/source?version=…` | Original repricing source |
| `previewRepricing(input)` | `POST /api/repricing/preview` | Original repricing preview payload |
| `saveRepricing(input)` | `POST /api/repricing/save` | Original repricing save payload |
| `stageRepricing(input)` | `POST /api/repricing/stage` | Original repricing stage payload |
| `downloadRepricing(decision, name)` | `GET /api/repricing/:decision/files/:name` | Original repricing bytes |
| `downloadPricing(version, name)` | `GET /api/pricing/:version/files/:name` | Original pricing bytes |

A download returns `{ filename, contentType, bytes, headers }`. `bytes` is a `Uint8Array`; the filename is decoded from the server's Content-Disposition header. Choose an explicit destination when saving it.

~~~javascript
import { writeFile } from 'node:fs/promises';

const file = await client.download('EXACT_SAVED_PLAN_ID', 'comparison.csv');
await writeFile('/absolute/path/received-comparison.csv', file.bytes, {
  flag: 'wx',
  mode: 0o600
});
~~~

### Errors and recovery

The server's error response is `{ error: { code, message } }`. `TariffHttpError` retains the HTTP status, method, token-free URL, complete raw response text, parsed body and response headers. Larger domain errors remain available in full.

`TariffTransportError` identifies an incomplete response and retains its underlying cause. `TariffProtocolError` retains the full successful response text when it cannot be decoded as the declared JSON. For a mutating operation, these errors retain an `UNKNOWN` outcome so the existing workspace can recover the original operation using its saved UUIDs.

Reopen current state, the original saved plan or the original pricing operation before deciding how to continue an interrupted write. Keep the same request IDs and full payload when resuming that original decision.

## Source ownership

| File | Role |
| --- | --- |
| `model.mjs` | Exact tariff quotes, reviews, boundaries and selectable scenarios |
| `workspace.mjs` | Original source binding, saved plans, selection, receiving and pricing delegates |
| `server.mjs` | Loopback HTTP API and merchant console |
| `client.mjs` / `client.d.mts` | Complete JavaScript and TypeScript HTTP client |
| `cli.mjs` | Local operator and create-only receiving |
| `../workspace/model.mjs` | Original seller, pricing, ledger and request workflow |

The tariff operator retains those original owners from first source selection through review, saved comparison, native pricing continuation and receiving.
