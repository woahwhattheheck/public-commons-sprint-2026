# Bring a Postman collection into the merchant workspace

Use an existing Postman Collection v2.1 to configure a paid API through the maintained API merchant workspace. The importer retains the original collection, selected environment and source decisions, then generates the OpenAPI input consumed by the existing merchant compiler. Saved packages use the normal seller, operations dashboard, release store and buyer handover.

## Complete workspace flow

Start the maintained command with a private project parent:

```sh
mkdir -m 700 /path/to/merchant-projects
starforge openapi-workspace --out-parent /path/to/merchant-projects --port 0
```

Open the complete local URL printed by the launcher. Its fragment supplies the original workspace authentication. The workspace binds to loopback.

1. In **Load your API description**, open **Import an existing Postman collection**. Select the original Collection v2.1 JSON and, when applicable, one environment export. Enter any explicit public variable overrides, then choose **Inspect collection**.
2. Find and select up to 64 requests. The inventory retains nested folder names and original JSON pointers. Open **Request source decisions** to choose structured or raw URL fields, supply colon path samples, select JSON or bytes responses, or supply an explicit public JSON body/schema. A request with pre-request scripts requires the explicit decision to use the displayed resolved values. Inspect again after changing variables or request decisions.
3. Choose **Review selected requests**. Read each complete resolved URL, backend authentication type and header names, public query/path/body sample, inferred or declared body schema, response mode, and script identities. Confirm the public samples and choose **Use reviewed requests**. Changing intake data clears the prepared review.
4. Continue in the original workspace: enter the public HTTPS seller address, Stellar network, payment asset, recipient and atomic price for each route. Review the suggested **Header → environment variable references**. Replace suggested names with the actual names your launcher will provide. Validate the configuration and save a new package.
5. Start the saved seller, check the unpaid routes, and use the existing operations and buyer workflows. Stop the managed seller before closing its workspace. Reopen the same private parent and select the saved project: the original packet, source decisions, merchant plan and compiled output are read back together. A changed selection is saved under a new package name and can enter the normal release review.

Use the selection count, **Show selected requests only**, and page selection to review larger collections. Prices, limits and backend references carry into a revised selection only for the same retained collection, environment and request decisions. Newly reviewed response modes and public samples take precedence. Replacing the active source resets the intake; controls stay disabled while an adoption or reopen is in progress.

The [USGS facility-event example](examples/usgs-facility-events/README.md) includes a public collection, original merchant-plan preparation and a downstream customer reporting application. The [complete onboarding guide](../ONBOARDING.md) also covers installed package imports and the original OpenWeather entry.

For source checkout use, the equivalent entry is `node sf61-openapi-seller-import/workspace/server.mjs --out-parent ...`. Installed commands retain the same arguments.

## Source decisions and request semantics

| Source feature | Merchant representation |
| --- | --- |
| Nested collection folders | Retained request pointer and display path; no flattening collision can overwrite another selected route. |
| Collection variables and one environment | Enabled environment values override collection values. Explicit public sample overrides take precedence over both. Unresolved/dynamic variables require a supplied value. Cycles are rejected. |
| Structured URL object | Protocol, host, port, path and enabled query rows supply the request. The object's `raw` text is informational unless the operator explicitly selects it. A raw-only object therefore requires that choice. |
| URL string or explicit raw selection | Its absolute HTTP/HTTPS URL supplies the request. Credentials, fragments, path normalization, repeated query names and query flags without equals values require source adaptation. |
| Colon path variables | The original URL variable list or explicit path samples supplies concrete values; the generated source retains native dynamic route parameters. |
| Query values | Public string examples with the original compiler's query admission. Disabled rows remain only in the original collection. |
| Fixed request headers | Names become required backend header references. The operator supplies complete values through the original launcher environment. Missing mappings fail compilation. |
| Header API key, Basic, Bearer | Original OpenAPI security declarations and existing backend authentication compiler. Complete Basic/Bearer header values belong in the named environment variable. |
| OAuth client credentials | The exported `grant_type`, `accessTokenUrl` and scopes declare the original OAuth flow. Client ID/secret remain original environment references. Other exported grant types require their supported backend integration. |
| JSON body | Exact resolved public object sample. An inferred schema describes sample types without asserting that sampled object properties are required. An explicit operator schema can supply stronger request admission. |
| GraphQL body | The declared query and variables become the existing JSON request representation. |
| Multipart body | Named text/file fields use the original multipart compiler. Collection file paths are retained as data and are never opened. Select actual files later in the existing private file-input form. |
| Saved response examples | Status and size are shown for source review. Example response bodies remain private in the collection and are not promoted to an authoritative response contract. New plan rows use `responseValidation: "none"`. |
| Pre-request scripts | Original script bytes and hashes remain retained. No script executes during import or merchant operation; an operator explicitly confirms the resolved request values. |
| Unsupported auth/body/serialization | The inventory identifies the actual request and required adaptation. It does not silently remove authentication, truncate a repeated parameter, read a referenced local file, or convert an unsupported body into an empty request. |

An explicit JSON body replaces the collection body only after review; a conflicting explicit source Content-Type still requires correction. The existing merchant compiler remains the final authority for representable schemas, methods, media types, upstream URLs and limits. Collection samples are reusable public examples, not a statement that every backend input or output is represented.

The importer adds no new seller request engine. It does not run Postman scripts, emulate a Postman cookie jar, select a client certificate, or invoke the Postman API. The original merchant's timeout, redirects, authentication, request admission, payment and response policies govern the running product.

## Retention and privacy

The retained JSON input has schema `stellar-forge.postman-source.v1`. It contains the exact collection and optional environment text, normalized explicit decisions, and SHA-256 hashes of each source, the decisions and the deterministically generated OpenAPI document. Reopening regenerates the document and checks those hashes. A changed source or decision requires a new prepared packet.

The existing `savePackage` writes that packet as its normal `original-openapi.json`, alongside the unchanged merchant plan, facade, selections, bindings, upstream configuration, request cases and compiled seller. Existing source refresh and release staging consume the same original parser. No additional project database is introduced.

Treat the entire packet and merchant package as private. An exported collection or environment can already contain credentials, internal URLs and response data. Those original bytes stay in private files; generated backend configuration contains environment-variable names. Imported credential/header variable references and variables marked `secret` require an explicit separate public override before they can appear in public URL/body values. The review displays the public samples that will enter native discovery metadata.

The importer reads no process environment and contacts no endpoint. The original launcher reads actual backend values when starting the seller. Credential rotation therefore uses the existing environment/runtime lifecycle, without editing the retained collection or introducing another secret store.

## CLI workflow

Inspect the original source and find its request pointers:

```sh
starforge openapi postman inspect \
  --collection collection.json \
  --environment environment.json
```

Create a private decisions file using pointers returned by that inspection. For example:

```json
{
  "publicVariables": {"region": "demo-region"},
  "requests": [
    {
      "pointer": "/item/0/item/0",
      "urlSource": "structured",
      "pathVariables": {"id": "sample-17"},
      "responseMode": "json",
      "useResolvedValues": true
    }
  ]
}
```

Inspect that exact decision before retaining it. Supply `useResolvedValues: true` only after reviewing the request affected by its pre-request scripts.

```sh
starforge openapi postman inspect \
  --collection collection.json --environment environment.json \
  --decisions decisions.json

starforge openapi postman source \
  --collection collection.json --environment environment.json \
  --decisions decisions.json --out /path/to/private/source.json

starforge openapi postman plan \
  --source /path/to/private/source.json \
  --out /path/to/private/merchant-plan.json
```

Fill the generated **original merchant plan**: public seller URL, payment asset/recipient, per-route `amountAtomic`, and actual `headerEnv`/OAuth environment names. Empty terms intentionally remain editable. Then create the original compiled merchant package:

```sh
starforge openapi postman merchant \
  --source /path/to/private/source.json \
  --plan /path/to/private/merchant-plan.json \
  --out-parent /path/to/merchant-projects --name merchant-api

starforge openapi postman inspect \
  --source /path/to/merchant-projects/merchant-api/original-openapi.json
```

The source and plan output commands use the existing atomic create-only source writer. Repeating identical completed output returns its existing identity; a different existing file is preserved. `merchant` uses the existing new-package semantics. Reopen an existing merchant through its original workspace/read-package path rather than issuing another create command.

## Release and buyer delivery

The saved package's `RUN.md` gives the actual seller and operations commands. For retained deployment, use the existing [seller release workflow](../../sf82-seller-pilot/README.md) with the saved facade, selections, route bindings and upstreams. It preserves the original release ID, digest, generation checks, activation, drain and rollback.

Use the original [operator buyer](../../sf88-operator-buyer-cli/README.md) or maintained customer setup for the concrete generated resource. Buyer review retains the exact method, URL, query/body, native payment requirements and independent budget. Terminal approval, signer selection, payment execution, evidence and response recovery remain those original interfaces. File and durable POST requests use the existing [private file input](../workspace/FILE_INPUT.md) and [operation ticket](../../sf88-operator-buyer-cli/OPERATION_TICKETS.md) paths.

An unpaid HTTP 402 demonstrates an advertised native offer; successful revenue is recorded only by the actual original payment and delivery outcome. Collection import itself neither pays nor claims a conversion.

## Primary format references

- [Postman Collection v2.1 schema](https://schema.postman.com/json/collection/v2.1.0/collection.json)
- [Original Postman SDK URL representation](https://www.postmanlabs.com/postman-collection/collection_url.js.html)
- [Postman variable scopes](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-variables/)
- [Postman request authorization](https://learning.postman.com/docs/use/send-requests/authorization/specifying-authorization-details/)
- [Postman pre-request and post-response scripts](https://learning.postman.com/docs/tests-and-scripts/write-scripts/intro-to-scripts)
