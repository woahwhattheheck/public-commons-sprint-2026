# Captured API → original merchant

Use a locally exported **HAR 1.2** network capture to author an API source for the
existing Stellar Forge merchant workspace. The retained journey is:

**capture → private inventory → offline review → immutable decisions → OpenAPI
source → original merchant package → original release/runtime**.

This is an intake extension, not another seller, payment implementation or web
server. `model.mjs` is shared by the offline page and Node. `merchant.mjs` delegates
to the existing `workspace/model.mjs::savePackage`; that implementation still owns
facade generation, exact prices, authentication references, original compilation
and portable merchant packages. `source`, `refresh` and `postman` remain separate
existing OpenAPI commands.

## Capture and review

Node 22+ is required. Export a capture only from an API you are authorized to
inspect and integrate. A HAR can contain credentials, personal data and complete
response bodies: keep the source and working directory private, outside Git.
The intake neither replays requests nor fetches referenced URLs.

```sh
starforge openapi har prepare --har capture.har --out /private/merchant-har
starforge openapi har review --workspace /private/merchant-har \
  --out /private/merchant-review.html
```

Without the maintained distribution, replace `starforge openapi har` with
`node stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/cli.mjs`.

Open the HTML locally. It needs no server or external resources. Choose the
**source API origin**, select operations, and author path templates and safe
examples. A template must match every selected captured path. To combine
`/items/one` and `/items/two`, put both source group IDs in one operation, author
`/items/{id}`, supply `{"id":"example"}`, and leave the other operation unselected.
One reviewed document selects one source origin; another revision can select a
different origin from the same retained capture.

Resolve each query parameter, captured credential and custom header. Query values
remain strings unless you explicitly author another scalar schema and safe example.
Repeated query keys cannot silently collapse into the original scalar query contract.
The credential-name detector is a review aid, not an authentication classifier:
a secret-like query name can be explicitly reclassified as an ordinary parameter,
with a reason and safe example. Unknown header names still require a decision.

**Backend** credential/header decisions contain environment-variable names only.
Header credentials remain declared in the exported source security schemes; the
original merchant workspace removes them only from its explicitly configured paid
facade. Query/cookie security can be preserved for a manual integration, or omitted
with an explicit rationale. The original native backend supports header references,
not a new query/cookie credential transport invented by this intake.

Review JSON request-body shapes or author your own schema. Captured body values
are never copied as public examples. Set a safe body example and whether the body
itself is required. Inspect response status/media/counts, then acknowledge each
selected operation. **Validate and preview** uses the same authoring model as Node.
Download reviewed decisions; an incomplete draft can also be saved and restored.
The page stores a source-keyed browser draft when local storage is available.

## Save, export and move

```sh
starforge openapi har save --workspace /private/merchant-har \
  --decisions har-decisions.json
# Use the full revision SHA256 returned above:
starforge openapi har export --workspace /private/merchant-har \
  --revision REVIEW_SHA256 --out /private/reviewed-source
starforge openapi har inspect --workspace /private/merchant-har
starforge openapi har copy --workspace /private/merchant-har \
  --out /private/receiving-har
starforge openapi har review --workspace /private/receiving-har \
  --revision REVIEW_SHA256 --out /private/reopened-review.html
```

The workspace retains the exact original `source.har`, a source-bound inventory,
a manifest and immutable `reviews/<SHA256>.json`. Directories are mode 0700 and
files 0600. Repeating an identical decision save returns the same revision. Copy
verifies the source and every retained review; the receiving workspace can reopen
and export without the original capture path. Destinations are create-only.
Interrupted preparation is not a valid workspace until its manifest and inventory
can be reopened; use a new destination after preserving any needed partial files.

Export writes `openapi.json`, `review.json` and a file-hash manifest. It does **not**
copy the HAR. The source document includes source/review identities, observed shape
counts and reviewed backend-reference/omission decisions. Captured URL query values,
headers, cookies and request/response payload values are excluded. The document uses the reviewed path templates rather than automatically exporting
captured literal paths; source group/entry IDs retain provenance. The private HTML still displays original path and field names,
so review those before sharing it. Operator-authored examples are public by choice.

## Use the existing merchant workspace

Load exported `openapi.json` as the **backend source** in the original
[API merchant workspace](../workspace/README.md). Select the separate public HTTPS
seller URL, exact payment requirements, route IDs, backend environment references,
request examples and response policy there. The source origin is never rewritten
into a public seller by this intake.

For headless use, an existing native merchant plan enters the same package writer:

```sh
mkdir -m 700 /private/merchant-packages
starforge openapi har package --workspace /private/receiving-har \
  --revision REVIEW_SHA256 --plan merchant-plan.json \
  --parent /private/merchant-packages --name captured-api
```

The plan must select exactly the reviewed routes and retain their reviewed backend
header references. All other validation belongs to the original compiler. Example
native plan for a reviewed `GET /items/{id}`:

```json
{
  "schema": "stellar-forge.api-merchant-plan.v1",
  "sellerServer": "https://merchant.example/paid",
  "payment": {
    "network": "stellar:testnet",
    "asset": "DEMO_NONPAYABLE_ASSET",
    "payTo": "DEMO_NONPAYABLE_RECIPIENT",
    "maxTimeoutSeconds": 60
  },
  "operations": [{
    "method": "GET", "path": "/items/{id}", "id": "item_lookup",
    "amountAtomic": "10000",
    "headerEnv": {"authorization": "SOURCE_AUTH"},
    "requestExample": {"pathParams": {"id": "example"}},
    "responseMode": "json", "responseValidation": "declared"
  }]
}
```

The demonstration identifiers are intentionally nonpayable. Supply the merchant's
actual authorized payment terms in its own plan. A locally captured loopback API
also needs the existing plan's explicit `allowLoopbackUpstream: true` option.
The resulting original `merchant-package.json`, compiled service, upstreams and
`RUN.md` are ordinary maintained merchant artifacts. Reopen them in the original
workspace or stage that package with the existing SF82 release workflow; use its
normal start, route review, stop and restart controls.

## What observations mean

JSON bodies contribute observed types, object fields and unions across selected
captures. They do **not** infer required fields, closed objects, enums, API-key
semantics or complete provider contracts. Empty/missing bodies, invalid JSON,
unsupported encodings and incomplete HTTP responses remain visible. Base64 HAR
response content is decoded before shape observation; captured bytes never become
an example. Only JSON request bodies are authored by this intake; use the original
manual importer for other media. GET/HEAD/DELETE and JSON POST/PUT/PATCH compose
with the existing method support. HAR entries outside that scope remain in the
private rejected-entry inventory.

A reviewed observed schema can use original declared response validation, but its
coverage is the operator's responsibility. Author authoritative constraints from
the provider documentation when those are available. Native compilation still
rejects unsupported assertions rather than discarding them. HAR inputs are capped
at 128 MiB/100,000 entries; reviews and exports follow the original 4 MiB source
limit. Source intake and offline review add no package dependencies. Existing YAML
and pattern-bearing merchant descriptions use the original pinned dependencies.

Run the focused real-HTTP intake/merchant/reopen exercise:

```sh
node --test stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/workflow.test.mjs
```

Format references: [HAR 1.2 specification](https://www.softwareishard.com/blog/har-12-spec/)
and [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.1.html). The exported 3.1 document
is accepted by the original SF61 3.0/3.1 compiler.
