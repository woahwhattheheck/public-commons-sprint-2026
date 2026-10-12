# Grants.gov publishing and customer receiving

The native example carries one retained Grants.gov capture through the existing dataset publisher, version store, SF82 release manager, original SF88 buyer, and SF100 receiving package. It uses the saved source operation throughout.

## What the operator does

The example imports the full original capture and creates two immutable editions: the complete opportunity cohort and a focused selection of posted NSF opportunities whose retained assistance-listing numbers include 47.041. The selection comes from the saved full detail responses. Both editions keep the same dataset name, columns and query capabilities, so their row sets can occupy the same native version store.

The full cohort initializes the original publisher and becomes the first staged SF82 release. The operator then publishes the focused selection through the running version controller. The customer chooses the retained full-cohort snapshot explicitly, allowing the current curated dataset to evolve while the original purchase continues to address its selected version.

The customer sequence loads the actual native seller offer, compares its advertised payment terms with the configured original terms, prepares one stable buyer intent, and joins the existing host-configured payer workspace. Original SF88 execution, Governor checks, signer custody, settlement and finalization remain in their existing modules. The original SF100 exporter assembles the actual received pages.

The receiving step compares every exported scalar field and opportunity ID with the retained source edition. It also carries the complete source-edition packet into a new Grants.gov workspace. Finally, the example closes and reopens the original operator, recovers the same completed buyer session, and downloads the same CSV, JSONL and review bytes again.

## Source input

Use the complete credential-free output of the maintained capture exporter:

~~~sh
node acquire.mjs export \
  --directory /absolute/original-capture \
  --output /absolute/capture-export.json
~~~

For an already completed source operation, reuse its saved packet. The readCaptureExport API verifies the original manifest, every request/data slice, file length, digest, opportunity identity and coverage without another provider request.

The original AI capture completed on October 12, 2026 with seven search pages, 164 distinct opportunities and 164 detail responses. Its capture ID is GSC-161aa4d7c78274c0ef74682e96188d4b, and its source signature is 436839aeb39144dc3b0ad617d7ecdf62e1e8699698fc798fd745b5f54e53f5df. The saved 9,696,131-byte packet has file SHA-256 922740dea9de519619b69a858720f8603d19e93ae20f0b0e315eb0d2992a674e.

The example requires a complete search and complete details. Its publication makes no new Grants.gov request. Opportunity status, deadline text and timezone, active synopsis versus retained forecast, eligibility, amount text, original descriptions, attachments, application-package metadata and revisions remain in that same source packet.

## Existing merchant and payer configuration

The settings file contains public merchant terms, private directory locators and explicit limits. Use the existing configured payer workspace; its signer, keys, original ledger and policy remain in place.

~~~json
{
  "merchant": {
    "origin": "https://your-existing-merchant.example",
    "path": "/grant-opportunities",
    "payment": {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "EXISTING_STELLAR_ASSET_ADDRESS",
      "payTo": "EXISTING_MERCHANT_ADDRESS",
      "amount": "10000",
      "maxTimeoutSeconds": 600,
      "extra": {
        "areFeesSponsored": true,
        "paymentFlow": "authorization"
      }
    }
  },
  "runtime": {
    "port": 8423,
    "facilitator": "http://127.0.0.1:4020",
    "allowLocalFacilitator": true
  },
  "buyerWorkspace": {
    "id": "existing-testnet-payer",
    "directory": "/absolute/existing-payer-workspace"
  },
  "intentId": "grants-ai-full-cohort-20261012",
  "releaseId": "grants-ai-release-20261012",
  "datasetName": "Grants.gov AI opportunities",
  "pageSize": 100,
  "maxPages": 2,
  "maxTotalAtomic": "20000"
}
~~~

Replace the example locators and public payment addresses with the original host's actual configuration. The example is restricted to stellar:testnet. It verifies that the complete selected cohort fits both the page limit and aggregate cap before creating a publisher.

The SF82 release starts its original loopback seller. The configured public HTTPS origin must reach that seller through the existing approved deployment or explicit-connect transport. With an already hosted route, the CLI requires no additional adapter. For a native receiving host that attaches the route after the release chooses its loopback port, use the exported runPublisherNative function and its attachTransport callback:

~~~js
import { runPublisherNative } from './examples/publisher-native.mjs';

const result = await runPublisherNative({
  directory: '/absolute/grants-publisher-operation',
  captureFile: '/absolute/capture-export.json',
  settings: originalSettings,
  operationId: 'grants-ai-publisher-20261012',
  phase: 'receive',
  attachTransport: async ({ listener, settings }) => {
    // Bind the existing approved HTTPS/explicit-connect route to this listener.
    // Return its own close() handle; retain the original signer and facilitator.
    return existingHost.connectMerchant({
      publicOrigin: settings.merchant.origin,
      listener
    });
  },
  onProgress: ({ stage }) => console.log(stage)
});
~~~

This callback is a trusted host connection. The underlying original seller and SF88 executor continue to produce the offer, payment request, response and accounting records.

## Run and resume

From the grantsgov source directory:

~~~sh
node examples/publisher-native.mjs receive \
  --directory /absolute/grants-publisher-operation \
  --capture /absolute/capture-export.json \
  --settings /absolute/grants-native-settings.json \
  --operation grants-ai-publisher-20261012
~~~

The prepare phase completes original source import, both editions, configured merchants, initial native draft and draft preview. The publish phase also stages and runs the SF82 release, publishes the curated version and reads the retained full-cohort snapshot. The receive phase completes the same sequence and the actual customer acquisition, finalization, source handover and reopen. Each invocation closes only its own workspace and seller handles when it finishes.

Keep the same operation directory, operation ID, source packet, settings and intent on continuation. Request IDs for source, editions and merchants are stable. The original publisher reconciles saved drafts and publication results; SF88 owns page attempts and same-session recovery. The driver reads an existing completed session before deciding whether any next page is ready.

If SF88 returns a pending original attempt, the journal carries that precise session status and its retained directory. Continue through the original publisher.buyer.recover and accounting operations. A specifically verified unpaid continuation uses the maintained original buyer action and its exact attempt digest; the example preserves that attempt's identity.

## Receiving files and operating state

The native-operation.json file is the single example operation journal. It records source identity, immutable edition and merchant IDs, native draft/release/version bindings, original buyer session, actual accounting, delivery files and reopen results. The full underlying state remains under its original workspace/publisher directory.

The receiving folder contains:

- dataset.csv and dataset.jsonl: the exact stitched customer rows.
- review.html and delivery-manifest.json: the original SF100 receiving view and source-page/output bindings.
- acquisition-manifest.json: the original SF88 page, request and native evidence lineage.
- publisher-draft.json: the original full-cohort draft and query review.
- source-edition.json: the complete source edition and original capture packet for a new research workspace.

The customer-source-workspace directory is the actual receiving workspace. It preserves the source edition's identity and rows after original packet intake. The final journal's reopen result joins the original operator workspace ID, retained dataset snapshots, buyer session and page identities with identical downloaded bytes.

The public API supplies opportunity research data. The operator preserves the original application links, descriptions and rules so an analyst can make a source-backed eligibility and workshare decision. An actual application continues through that issuer's application process.

This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.
