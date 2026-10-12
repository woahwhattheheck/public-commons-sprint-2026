# Bring an existing API into a merchant installation

The API merchant workspace keeps source intake, public request review, merchant terms, saved packages and seller operation in one application. Start with the source your customer already has, then use the same compiled seller and buyer workflow.

## Choose the original source

| Customer source | Entry | What is retained |
| --- | --- | --- |
| OpenAPI 3.0 or 3.1, JSON or YAML | `starforge openapi-workspace --out-parent PRIVATE --port 0` | Original document, explicit plan, public facade and compiled package. |
| Split OpenAPI files | `starforge openapi source --help` | Explicit local source bundle and the original referenced file bytes. |
| Postman Collection v2.1 and selected environment | The workspace's **Import an existing Postman collection** panel, or `starforge openapi postman --help` | Collection, environment, request pointers and reviewed source decisions in one private packet. |
| Existing OpenWeather customer project | `starforge openapi weather --help` | The original weather application's account references, source, acquisitions, merchant integration and release state. |
| Existing Messari or Blockworks integration | The workspace's **Migrations** application | The provider contracts, customer request inventory, complete original captures, reviewed mappings, full comparisons and merchant release history. |

The installed `starforge` command forwards to these original implementations. The same checkout entry is `node stellar/scf-starforge-20261009/sf61-openapi-seller-import/cli.mjs`, followed by the same arguments. For the workspace, use `workspace/server.mjs` instead.

Use a private parent for saved merchant projects. Reopen that same parent to continue a project. Each saved package preserves its original source, plan, public request examples and backend environment-variable references.

## Migrate an existing provider integration

Open **Migrations** in the same API merchant workspace. Retain the original and current provider contracts, import the customer's actual request inventory, and use the native acquisition or receiving workflow to retain complete responses. Review entity identities, field meaning, units, time windows and coverage before comparing the selected source editions. The complete result remains downloadable while the browser displays paged records and their original source locations.

The [Blockworks migration guide](blockworks/README.md) covers project intake, source and capture provenance, native acquisition and recovery, mapping decisions, original merchant source refresh, release selection and rollback, customer receiving, and a portable handover that reopens in the complete merchant application.

## Collection to merchant

1. Load the collection and the environment used by the customer. Inspect the actual nested request inventory.
2. Select the requests to sell. Review their resolved host, path, query, body, authentication type and fixed header names. Supply explicit reusable public samples where the original values are private or dynamic.
3. Review source decisions and adopt the selected requests. The importer produces the input to the existing compiler.
4. Set the public HTTPS seller address, Stellar payment network, asset, recipient and exact atomic price for each route. Bind backend header and OAuth references to environment-variable names supplied by the original launcher.
5. Preview the complete merchant configuration and save the package. Its `RUN.md` contains the original seller and operator commands, with the actual package paths.
6. Open the saved project again to continue its original source, configuration and runtime. Save a changed selection under a new package name so it can enter the existing source and release review.

The [Postman operating guide](postman/README.md) explains URL representation, variable precedence, body and authentication decisions, source scripts, CLI options and retained packet recovery.

The [USGS facility-event example](postman/examples/usgs-facility-events/README.md) provides a concrete public collection, reviewed source decisions and a customer workflow for triaging purchased event data against a facility list.

## Use the same parser in a Node integration

The maintained package exposes the original pure collection module, with matching TypeScript declarations:

```js
import {
  inspectPostman,
  preparePostmanSource,
  openPostmanSource,
} from '@tokenjunkielabs/starforge-merchant/seller/openapi/postman';

const intake = {
  collectionText,
  environmentText,
  decisions: {
    publicVariables: { region: 'sample-region' },
    requests: [
      {
        pointer: '/item/0',
        urlSource: 'structured',
        responseMode: 'json',
      },
    ],
  },
};

const inventory = inspectPostman(intake);
// Present inventory and the selected source decisions to the operator.
const prepared = preparePostmanSource(intake);
// Persist prepared.specText as exact private UTF-8 bytes.
const reopened = openPostmanSource(JSON.parse(prepared.specText));
```

Request pointers come from that collection's inventory. `useResolvedValues: true` is the explicit per-request decision for retained pre-request scripts. Supply it only after reviewing the concrete request values.

The module returns the complete review and the operation rows consumed by the existing merchant plan. It reads no process environment and does not execute collection scripts. A row contains the original method/path, public request example, backend header references and declared response mode. Reopening regenerates the same OpenAPI document and verifies the retained source and decision hashes.

A TypeScript consumer can distinguish supported and unsupported inventory rows through `request.supported`. The public types describe source inputs, explicit decisions, original review fields, private packet hashes and generated operation rows. The declarations are adjacent to the actual implementation; the maintained package export selects them automatically.

For programmatic merchant construction, the maintained `/seller/openapi/merchant` export supplies the original `prepareMerchant`, `savePackage` and `readPackage` functions. The `/seller/openapi/source` export supplies the original source parser for ordinary OpenAPI, split-file bundles and retained collection packets.

## Review the merchant terms once

Use the original plan schema, `stellar-forge.api-merchant-plan.v1`. The Postman `plan` command produces an editable plan with blank merchant payment terms:

```sh
starforge openapi postman plan \
  --source /private/source.json \
  --out /private/merchant-plan.json
```

Set those terms deliberately. Provider credentials belong in the existing launcher environment. The collection packet remains private because an original collection or environment can contain internal URLs, saved responses or existing credentials.

The buyer has an independent native payment budget. The merchant's price and the buyer's ceiling are distinct inputs; changing a source selection does not authorize a purchase.

## Deliver and operate the same package

The package's `RUN.md` gives the concrete original commands to start its seller and operations dashboard. The workspace retains the same runtime ownership for start, status, customer operation and shutdown.

Use the existing [SF82 release workflow](../sf82-seller-pilot/README.md) for retained deployment and release changes. It stages the saved facade, route selections, bindings and upstream configuration together and preserves the original release ID, generation checks, drain and rollback.

Use the existing [SF88 buyer](../sf88-operator-buyer-cli/README.md) for the concrete generated resource. Its review carries the actual method, URL, query/body, payment requirements and customer budget through approval, signer selection, execution and retained-response recovery. The package's public examples let the customer prepare an initial request without reconstructing the source mapping.

A durable POST request uses the original [operation ticket workflow](../sf88-operator-buyer-cli/OPERATION_TICKETS.md). A file request uses the original [private file-input workflow](workspace/FILE_INPUT.md). Streaming consumers use the original [streaming customer setup](workspace/STREAMING.md).

## Customer handover contents

Give the operator the complete private merchant package and its source packet, the names of the required backend environment references, the agreed public seller and payment terms, and the original launch/reopen commands. Give the buyer the concrete public resource and its original request review.

Keep each actual operator outcome with its corresponding original operation: imported source, saved package, selected release, customer request and retained delivery. The same project and request are reopened for recovery.
