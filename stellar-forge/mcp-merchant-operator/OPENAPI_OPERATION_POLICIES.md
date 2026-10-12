# Merchant operation policies

The original SF61 workspace saves reusable operating-policy editions and applies an explicit edition to its source-bound route worksheet. Browser, merchant MCP and CLI share the same library, source inspector, compiler, immutable package writer and receiving workflow.

Six additional tools use the existing `openapiWorkspaces` configuration. Normal source, plan, packet and delivery handles remain the source of file access. The route worksheet chooses inclusion and prices; a policy supplies explicitly authored operating settings for those routes.

## Complete workflow

1. Open the original source and merchant plan, or a saved `baseName`. Inspect the complete inventory with `merchant_openapi_routes` and follow every `nextOffset`. Retain the returned source, plan and worksheet identities.
2. Save a complete policy document to the original library. Creation uses `expectedHeadSha256: null`; an edit names the exact current head. Load returns the selected immutable edition, current head and a page of edition history.
3. Select exact method/path targets already included and priced in the worksheet. A template may configure a newly selected route: its explicit price comes from the worksheet, and the original compiler supplies its normal route ID unless a complete authored operation record supplied one.
4. Review the full source, base plan, worksheet, policy edition, targets and overrides. The original compiler validates the candidate, including source-compatible response handling, credentials, examples, transport, cache, availability, idempotency and streaming.
5. Save using the returned `review.sha256` and a new package name. Repeating the same complete request reopens the completed original package. A changed source, plan, selection, template, override or capture requires its own review.
6. Export and receive the ordinary complete package. Its original manifest retains `operation-policy.json` beside the exact source and compiled configuration. Continue through existing package inspection, SF82 staging, comparison, activation and start.

Policy fields replace whole native values. Setting `cache` replaces the complete cache object. Each route override explicitly replaces fields with `set` and removes optional fields with `unset`. Policy application preserves the source route, route ID and atomic amount; the original worksheet controls inclusion and price.

## Policy document

A complete policy uses `stellar-forge.api-operation-policy.v1`:

```json
{
  "schema": "stellar-forge.api-operation-policy.v1",
  "id": "JsonRead",
  "title": "Selected JSON read operating settings",
  "description": "Explicit settings selected by the merchant operator.",
  "methods": ["GET"],
  "settings": {
    "timeoutMs": 8000,
    "maxResponseBytes": 262144,
    "maxInFlight": 8
  }
}
```

The ID begins with a letter and contains at most 64 letters, digits, underscores or hyphens. Title and description limits are 240 and 4,000 characters. The full normalized edition is at most 256 KiB. Supported methods are GET, HEAD, POST, PUT, PATCH and DELETE; each template explicitly selects its methods.

The 23 optional native setting fields are:

```text
serverIndex headerEnv securityAlternative responseMode responseValidation
publicDescription requestExample querySerialization timeoutMs maxResponseBytes
maxRequestBytes maxInFlight requestHeaders cache availability
enforceResponseContract oauth2 oauthConnection oauthProfile oauthAlias
idempotency stream transport
```

The original compiler owns nested schemas, limits and source compatibility. Full top-level merchant settings, declared transports and payment configuration remain in the base plan. A policy cannot set or unset `method`, `path`, `id` or `amountAtomic`. A route override can unset any of the 23 optional fields, without also setting that field.

## Tool contracts

| Tool | Request and result |
| --- | --- |
| `merchant_openapi_operation_policies` | `workspace` and optional `offset`/`limit`. Returns the original library page in `native`; follow `native.nextOffset`. |
| `merchant_openapi_operation_policy_load` | `workspace`, `policyId`, optional `policySha256`, `historyOffset` and `historyLimit`. Returns the full selected edition and retained history. |
| `merchant_openapi_operation_policy_save` | One `policyDocument` or host-declared `policyFile` and required `expectedHeadSha256`. The original writer returns `SAVED` or `REOPENED`. |
| `merchant_openapi_operation_policy_review` | Original worksheet context; one exact `policy: {id, sha256}` or full `policyDocument`/`policyFile`; explicit `targets`; optional overrides and complete new operation records. Returns the exact review, candidate plan, native preview, application metadata and paginated changes. |
| `merchant_openapi_operation_policy_package` | The same complete request, `name` and `expectedReviewSha256`. Publishes or reopens the original package. |
| `merchant_openapi_operation_policy_file` | `kind: "policy"` selects a policy ID and edition. `kind: "application"` uses the complete review input or a saved package `name`. Returns exact base64 chunks with full byte count, file digest and explicit continuation. |

Policy and change pages accept at most 100 items. File chunks contain 1–196,608 bytes. Complete application records retain the source digest, full base plan, whole worksheet, policy edition, explicit targets and overrides, original capture selection and native review; their limit is 4 MiB.

Edition history remains independent of the current head. A historical SHA continues to select that exact edition when another operator saves a later head. Library updates require current-head compare-and-swap. The original writer rejects publishing a historical edition as a new head.

## Declared files and large inventories

The merchant request limit remains 128 KiB. Put complete source, plan, policy, target, override, new-operation, worksheet and application documents in the existing host configuration, then select their aliases.

```json
{
  "schema": "stellar-forge.sf61-workspace-connection.v1",
  "workspaces": {
    "authoring": {
      "label": "Original API workspace",
      "consoleUrlFile": "/private/merchant/application-url.json",
      "files": {
        "api": {"path": "/private/merchant/source.json", "kind": "source"},
        "plan": {"path": "/private/merchant/plan.json", "kind": "plan"},
        "policy": {"path": "/private/merchant/policy.json", "kind": "packet"},
        "worksheet": {"path": "/private/merchant/worksheet.json", "kind": "packet"},
        "application": {"path": "/private/merchant/application.json", "kind": "packet"},
        "targets": {"path": "/private/merchant/targets.json", "kind": "packet"},
        "overrides": {"path": "/private/merchant/overrides.json", "kind": "packet"},
        "newOperations": {"path": "/private/merchant/new-operations.json", "kind": "plan"}
      }
    }
  }
}
```

The selected URL may be the original Applications URL record or plain console URL. A merchant operation pins that console through dependent reads and save; the next operation observes a managed URL refresh.

Authoring reuses worksheet `baseName` or explicit source/plan context, optional retained worksheet and its base, exact conflict choices and filtered inclusion/price actions. `targetsFile` and `overridesFile` use packet handles; `operationPlansFile` uses a plan handle. `applicationFile` is a packet handle.

For an incoming application, supply `applicationFile` and its original `specFile`/`specText`. The record supplies its base plan, worksheet, policy, targets, overrides and capture. The target workspace rechecks those exact inputs with the original planner and compiler. Its embedded edition permits receiving without changing the destination library head. Captured HAR sources continue through their original capture receiving and authorization workflow.

## CLI

The distribution contributes `merchant-operation-policies`. From a source checkout:

```sh
node stellar-forge/mcp-merchant-operator/openapi-operation-policies-cli.mjs \
  save --url http://127.0.0.1:4100/mcp --request-file policy-save.json
```

The original bearer token comes from `MCP_ACCESS_TOKEN`, or an explicit `--token-env` selector. Credentials remain in the original host environment and declarations.

An initial `policy-save.json`:

```json
{"workspace":"authoring","policyFile":"policy","expectedHeadSha256":null}
```

A review request:

```json
{
  "workspace": "authoring",
  "specFile": "api",
  "planFile": "plan",
  "worksheetFile": "worksheet",
  "policyFile": "policy",
  "targets": [{"method":"GET","path":"/forecast"}],
  "overrides": [
    {"method":"GET","path":"/forecast","set":{"timeoutMs":6000},"unset":["availability"]}
  ]
}
```

Use your workspace's actual source routes and authored policy. Call `review` with that file, add the chosen `name` and returned `expectedReviewSha256`, then call `package`. Recover an uncertain save by repeating the same complete request and destination.

For a complete library edition, use this export request:

```json
{"workspace":"authoring","kind":"policy","policyId":"JsonRead"}
```

```sh
node stellar-forge/mcp-merchant-operator/openapi-operation-policies-cli.mjs \
  export --url http://127.0.0.1:4100/mcp --request-file policy-export.json \
  --out /private/receiving/policy.json

node stellar-forge/mcp-merchant-operator/openapi-operation-policies-cli.mjs \
  read --file /private/receiving/policy.json --kind policy
```

The first chunk selects an exact edition; subsequent chunks pin it even if the library head advances. The client verifies every byte and atomically publishes the full receiving file. Reopening the same filename returns `REOPENED`; another complete document at that name is a conflict.

For an application retained in a package:

```json
{"workspace":"authoring","kind":"application","name":"forecast-policy-v1"}
```

Export it to a full local filename and read with `--kind application`. Declare the received file on the target host and use its original review/package operation. Whole-package transfer remains available through `merchant_openapi_export`, the existing merchant package download client and `merchant_openapi_receive`.

## Client exports and identities

The distribution export `./merchant/openapi-operation-policies` exposes `callOpenApiOperationPolicy`, `downloadOpenApiOperationPolicy` and `readOpenApiOperationPolicy` using Node built-ins and the original merchant transport. Callers can supply that existing transport client directly.

| Identity | Meaning |
| --- | --- |
| Library `sha256` / application `policySha256` | Exact normalized policy edition bytes. |
| `review.sha256` | Native review identity over source, base/candidate plans, worksheet, policy, overrides and capture. |
| `review.worksheetSha256` | Original normalized worksheet file identity. |
| Download `file.sha256` | Exact full policy or application file bytes. |
| Package `operationPolicySha256` | Full retained `operation-policy.json` member identity. |

The original parser checks the optional member and manifest identity together. Whole-package receiving preserves the package UUID, source, compiled files, revision lineage and operating-policy record.
