# Paid Research delivery

Publish an already frozen customer delivery through the existing Stellar merchant, acquire it through the existing Buyer application, and reopen the complete editable Research programme in the customer's workspace. The purchased file includes the original dossier, the exact four frozen reports, the saved work record and, when selected, the full original Europe PMC source workspace.

The seller chooses a saved delivery and an existing checkout. Its reviewed terms and file identity become one native SF101 order. The buyer receives the public publication file, chooses an existing Buyer application, reviews the exact native budget and approval, and receives that same archive into the original Research engines. Source, findings, customer work, reports and subsequent corrections remain editable after receiving.

## Open the workspace

The complete interface lives at **Paid delivery** in the original Research workspace, at `/customer-commerce.html`. The launcher uses the same listener, original session, workspace identity and complete dossier store:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /absolute/private/research \
  --connection-file /absolute/private/research-connection.json \
  --customer-commerce-host /absolute/private/research-commerce.json \
  --port 8846
~~~

Retain the actual connection file written by this command. It contains the selected original workspace and listener identity. Open its browser URL on the same machine, or attach the original Research client to that connection file. Existing Research launch options for source workspaces, pipeline inputs, extraction and Zotero compose with this option.

The launcher selects merchant and Buyer configuration files. Browser forms choose their declared aliases. A host can provide only sellers, only buyers, or both:

~~~json
{
  "schema": "sf88-research-customer-commerce-host/v1",
  "merchants": {
    "research-report": {
      "label": "Research reports",
      "checkoutFile": "/absolute/private/research-checkout.json",
      "claimEnv": "SF101_CLAIM_TOKEN"
    }
  },
  "buyers": {
    "research-acquisition": {
      "label": "Research acquisition",
      "agentFile": "/absolute/private/research-buyer-agent.json",
      "workspace": "research-acquisition"
    }
  }
}
~~~

A complete example is in [host.example.json](host.example.json). Replace its paths with the existing private configuration files. Relative file references resolve from the host configuration's directory. Keep this host file private to the launching account. The configuration view reports each selected alias, native terms, configured source and any concrete unavailable selection.

The `claimEnv` values are environment variable names. The corresponding existing merchant and buyer processes need the agreed claim value in their own environments. The browser, public publication and retained request contain the name, while the original checkout and Buyer own secret use.

## Prepare the existing merchant and Buyer

### Merchant

Choose the original SF101 checkout configuration already used for this resource. Its HTTPS public origin, route, Stellar network, asset, amount and recipient define the payment terms. Its original private state and outbox directories must be initialized by the native checkout. This workspace reads those selected terms before it creates the order.

The original checkout commands remain:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs \
  inspect --config /absolute/private/research-checkout.json

node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs \
  init --config /absolute/private/research-checkout.json

node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.mjs \
  serve --config /absolute/private/research-checkout.json \
  --port 8423 --operations-port 8424
~~~

Run initialization for a new native checkout; an existing deployment keeps its original state. Keep the current native facilitator, outbox delivery and signed success-notice receiver configuration from that deployment. The public purchase URL and delivery URL use the selected checkout's HTTPS origin. The native receiver releases the purchased bytes after its signed native payment notice establishes entitlement.

Paid delivery performs the original native enrollment after its review. Its order reference is `research-` followed by the publication request UUID. Keep that one order with its retained review and publication. An interrupted enrollment reopens or inspects this same native order before continuing.

The complete native contracts and deployment instructions remain in [SF101 checkout](../../../sf101-merchant-receiver/) and the [Buyer paid-file guide](../../../buyer-runbook/PAID_FILES.md). Use the actual deployment's amount and network for an operating run.

### Buyer

Choose an existing Buyer Runbook application whose local operator, payer/signing source and budgets are already configured for the selected native network and asset. Its original private workspace, retained launch file and exact selection digest belong in the existing agent configuration:

~~~json
{
  "schema": "stellar-forge.buyer-runbook.agent-connections.v1",
  "workspaces": {
    "research-acquisition": {
      "directory": "/absolute/private/buyer/workspace",
      "launchFile": "/absolute/private/buyer/launch.json",
      "expectedSelectionSha256": "COPY_THE_ACTUAL_64_CHARACTER_SELECTION_DIGEST",
      "storageDirectory": "/absolute/private/buyer/agent-files"
    }
  }
}
~~~

Read the launch file and selection digest from that application's actual retained launch. Preserve its configured operator aliases and native export limits where present. The configured original agent maximum must accommodate the complete selected archive, up to 32 MiB. Its workspace and agent storage stay in the original distinct private directories.

The Research host attaches through the existing agent client. The Buyer application's original approval mode and local operator retain the approval decision. **Open Buyer approval** takes the operator to that application's original browser origin. A workspace configured for terminal approval continues through its existing local approval flow.

## Seller: publish the complete frozen delivery

First finish the customer work in [Customer updates](../customer-updates/CUSTOMER_UPDATES.md). Save the brief, source selection, work record and delivery. A frozen delivery identifies its own dossier revision, work and four complete reports. Later work can continue without changing that original delivery.

In **Publications**, choose **New publication** and fill the original dossier, frozen delivery and declared merchant. The delivery selector supplies its saved revision. Add the customer-facing title, summary and permitted usage. If the complete Europe PMC workspace belongs in the handover, choose its original or previously received library and the actual source actor and request.

Choose **Review publication**. The review assembles and inspects the full native handover, creates the complete gzip archive, reads the original checkout and pins:

- the exact frozen delivery, work and original dossier revision;
- all six or seven original files, their full byte counts, hashes and media types;
- the complete archive's byte count and SHA-256;
- the selected checkout's actual route, network, asset, amount and recipient;
- the selected checkout configuration and existing state/outbox directory identities;
- the publication's complete customer-facing text and original request UUID.

Read that review, then choose **Enroll this publication**. Enrollment uses the same native checkout and exact reviewed archive. The workspace saves the full public publication, original merchant handoff and complete archive under the original publication. Download the **Publication** file for the buyer. It includes the native purchase/delivery URLs, payment terms and exact delivered-file promise.

The retained original request can be reopened after later dossier work or a browser restart. Changing a merchant configuration before first enrollment requires a new review against that actual selection. An already completed enrollment reopens its retained order and publication.

## Buyer: receive, approve and retrieve

In **Purchases**, receive the seller's exact publication JSON and select the declared Buyer alias. The original publication bytes are retained before the native Buyer intake. The screen shows the full public terms and file inventory alongside the native paid-file state.

Refresh the original acquisition, then enter the native total and daily budget as decimal atomic-unit strings. Use the actual selected price and operator budget; the amount stays in the selected payment asset. Choose the buyer's existing claim environment name.

**Prepare purchase** performs the original native paid-file review, budgeted draft and run initialization. The prepared record binds the original publication, full archive, actual native paid-file revision, one plan/run/operation, selected Buyer workspace and native source/frozen configuration identities.

Choose **Execute** and use the original Buyer approval flow. While that native execution runs, refresh and cancellation remain available in Paid delivery. Cancellation identifies the actual running execution returned by the original Buyer. It reaches that same execution through the existing native API.

A transport interruption can leave the native execution continuing. The retained request remains available in **History**. Reopen the acquisition and refresh its actual native state. If the native agent reports an uncertain request, use its displayed original request ID for **Reconcile**. Continue the original request, approval and run.

Use **Retrieve**, **Recover** or **Finalize** as indicated by the current native paid-file result. These actions keep the same prepared plan and original native operation. The original paid-file receiver and signed notice determine when the file is entitled and available.

When the full original download is available, choose **Receive editable Research dossier**. If the source workspace travels, provide the receiving source actor. The receiving operation:

1. Captures the original paid resource export from that actual Buyer run.
2. Downloads its complete bytes and verifies the native archive promise.
3. Retains and inspects the complete framed archive before publishing its members.
4. Reopens the original full handover and validates its dossier, work, reports and optional source workspace.
5. Receives the dossier through the original Research client and the full source workspace through the existing source receiver.
6. Saves the first completed receiving result so it can reopen after later customer work or donor relocation.

Open the received dossier or Customer updates from the completed acquisition. The complete customer history, original citations, saved work and four frozen reports remain available. Create a new customer correction or delivery through the ordinary Research workflow. The acquired delivery retains its original frozen files.

## Work in the terminal

Use `research-client` in an installed distribution, or the repository entry point:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-cli.mjs \
  commerce-help
~~~

The additional `research-commerce` command dispatches the same command names and implementation. Every write accepts a complete input file and a distinct private `--run-directory`. The first request, original native result and complete file selections stay in that directory.

Inspect the actual host and sources:

~~~sh
research-client commerce-configuration \
  --connection-file /absolute/private/research-connection.json

research-client commerce-list --kind publications \
  --connection-file /absolute/private/research-connection.json

research-client commerce-purchase --id PURCHASE_UUID --refresh \
  --connection-file /absolute/private/research-connection.json
~~~

### Publication inputs

Save the review input with the actual IDs and frozen revision from Customer updates:

~~~json
{
  "requestId": "ORIGINAL_PUBLICATION_UUID",
  "merchant": "research-report",
  "dossierId": "ACTUAL_DOSSIER_ID",
  "deliveryId": "ACTUAL_SAVED_DELIVERY_ID",
  "revision": 12,
  "title": "Customer research update",
  "summary": "Description of this exact frozen delivery.",
  "usage": "The permitted use agreed for this delivery."
}
~~~

The revision above illustrates the field; select the saved delivery's actual revision. When the full original literature workspace is part of the delivery, add its exact `sourceWorkspace: {library, actor, requestId}`.

~~~sh
research-client commerce-publication-prepare \
  --connection-file /absolute/private/research-connection.json \
  --input /absolute/private/publication-request.json \
  --run-directory /absolute/private/operations/publication-review \
  --out /absolute/private/publication-review-result.json
~~~

Read `result.review.reviewSha256` from the retained result and enroll with `{"id":"ORIGINAL_PUBLICATION_UUID","reviewSha256":"ACTUAL_REVIEW_SHA256"}`:

~~~sh
research-client commerce-publication-enroll \
  --connection-file /absolute/private/research-connection.json \
  --input /absolute/private/publication-enroll.json \
  --run-directory /absolute/private/operations/publication-enroll

research-client commerce-export --kind publications --id ORIGINAL_PUBLICATION_UUID \
  --part publication --run-directory /absolute/private/exports/publication \
  --out /absolute/private/customer-publication.json \
  --connection-file /absolute/private/research-connection.json
~~~

The `handoff` and `archive` parts are also complete downloadable native files.

### Purchase inputs

Receive that exact public publication into the buyer's Research host:

~~~sh
research-client commerce-purchase-receive \
  --connection-file /absolute/private/customer-research-connection.json \
  --publication-file /absolute/private/customer-publication.json \
  --buyer research-acquisition --request-id ORIGINAL_PURCHASE_UUID \
  --run-directory /absolute/private/operations/purchase-receive
~~~

Refresh the purchase and use its actual `paidFile.revision` in preparation:

~~~json
{
  "id": "ORIGINAL_PURCHASE_UUID",
  "requestId": "ORIGINAL_PREPARATION_UUID",
  "expectedRevision": 2,
  "totalAtomic": "ACTUAL_TOTAL_ATOMIC_BUDGET",
  "dailyAtomic": "ACTUAL_DAILY_ATOMIC_BUDGET",
  "claimEnv": "SF101_CLAIM_TOKEN"
}
~~~

Replace both budget values with positive decimal strings and the revision with the refreshed native value. The original Buyer validates them against its configured operator and selected payment.

~~~sh
research-client commerce-purchase-prepare \
  --connection-file /absolute/private/customer-research-connection.json \
  --input /absolute/private/purchase-preparation.json \
  --run-directory /absolute/private/operations/purchase-prepare
~~~

The returned `preparedSha256` binds subsequent actions. Each action uses its own request UUID and complete private operation directory:

~~~json
{
  "id": "ORIGINAL_PURCHASE_UUID",
  "requestId": "ORIGINAL_ACTION_UUID",
  "preparedSha256": "ACTUAL_PREPARED_SHA256"
}
~~~

Run `commerce-execute`, `commerce-retrieve`, `commerce-recover` or `commerce-finalize` with `--input` and `--run-directory`. `commerce-cancel` additionally requires the original active `executionId`. `commerce-reconcile` uses `{id, requestId, nativeRequestId, nativeId?}` from the actual native error/operation record.

Receiving uses the same prepared selection with its own request UUID and optional `sourceActor`:

~~~sh
research-client commerce-receive-dossier \
  --connection-file /absolute/private/customer-research-connection.json \
  --input /absolute/private/receive-dossier.json \
  --run-directory /absolute/private/operations/dossier-receiving
~~~

### Reopen and explicitly replay

Repeat a write with its original `--run-directory` to reopen the first result or continue that exact retained request. A completed operation reopens before it needs a connection. If you pass an input file again and it still exists, its full original bytes must match.

~~~sh
research-client commerce-receive-dossier \
  --run-directory /absolute/private/operations/dossier-receiving

research-client commerce-operation \
  --run-directory /absolute/private/operations/dossier-receiving
~~~

To submit the original native request again, preserve the first result and use a distinct replay directory:

~~~sh
research-client commerce-replay \
  --connection-file /absolute/private/customer-research-connection.json \
  --source-operation /absolute/private/operations/dossier-receiving \
  --run-directory /absolute/private/operations/dossier-receiving-replay
~~~

This is an explicit new local attempt carrying the same native request and selection. An interrupted replay resumes from its own retained directory. Later customer revisions do not change the original native completion.

## Use the original JavaScript client

The existing `ResearchWorkspaceClient` owns authentication, source binding, HTTP transport, downloads and shutdown. Its `customerCommerce()` interface borrows that lifetime:

~~~js
import {ResearchWorkspaceClient} from '../workspace-client.mjs';

const client = new ResearchWorkspaceClient({
  connectionFile: '/absolute/private/research-connection.json',
});
try {
  const commerce = client.customerCommerce();
  const configuration = await commerce.configuration();
  const review = await commerce.preparePublication(originalPublicationRequest);
  const publication = await commerce.enrollPublication({
    id: originalPublicationRequest.requestId,
    reviewSha256: review.review.reviewSha256,
  });
  const file = await commerce.file('publications', publication.id, 'publication');
  await commerce.download('publications', publication.id, 'publication', {
    file: '/absolute/private/customer-publication.json',
    expectedSha256: file.descriptor.sha256,
    expectedBytes: file.descriptor.bytes,
  });
} finally {
  await client.close();
}
~~~

Use the actual constructor options from [workspace-client.mjs](../workspace-client.mjs) for your selected existing connection. The complete typed interface is in [client.d.mts](client.d.mts). Buyer receive/preparation/action/receiving methods use the same inputs described above. [operator.mjs](operator.mjs) adds retained terminal-style input/result and explicit replay directories to an existing client.

The public file metadata is bound to the selected workspace, publication or purchase, part name, full byte count and SHA-256. Complete downloads verify those same values. A successful metadata read is followed by the original complete file transfer.

## Full archive transfer and receiving

The archive is gzip of one complete framed stream: native marker, original manifest byte count, exact manifest bytes, then every full original member in manifest order. Its maximum compressed size is **32 MiB**, matching this native paid-file route. Each member also retains the original Research per-file limit. If the complete handover exceeds the paid archive limit, narrow the actual selected delivery/source content or use the existing complete non-paid customer handover for that larger programme.

`createResearchPaidArchive`, `inspectResearchPaidArchive` and `receiveResearchPaidArchive` are exported from [archive.mjs](archive.mjs), with complete [declarations](archive.d.mts). Receiving retains the whole original input before publishing extracted files. Its original create-only file publishers recover matching stopped publications and preserve completed destination files.

A complete acquired archive can also be inspected or materialized from the terminal:

~~~sh
research-client commerce-archive-inspect \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES

research-client commerce-archive-receive \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES \
  --manifest-sha256 ACTUAL_HANDOVER_SHA256 \
  --run-directory /absolute/private/received-archive
~~~

After a completed or retained receive, the same command can omit `--file`; it reopens the original input and received handover in that directory. The original complete dossier receiving engine consumes the returned `handover.directory`. The normal `commerce-receive-dossier` command already performs that entire buyer-to-dossier journey.

## Preserve working forms and ownership

Browser working forms are saved separately from immutable requests and native results. Opening another view or creating another form preserves unfinished work. Export a full form to move it between sessions. Receive it through **Working forms**; the original workspace and saved delivery/base bindings are reviewed before use. A receiving form opens as a separate retained draft, and applying an imported buyer form preserves the prior working form.

**History** shows the retained exact requests, native results and interrupted actions. Resume keeps the original request. Explicit replay creates a separate local attempt and submits the original native input again. The source publication and native buyer intent remain identifiable across later work.

Stop closes admission to the Commerce controller and drains accepted native work, including whole HTTP downloads and loopback dossier receiving. It then attempts every original host owner and listener. A failed close retains that owner for retry, preserves the first failure and reports a nonzero CLI status. The CLI remains alive while cleanup is incomplete, including when its listener has already closed. Repeating Stop retries unfinished owners. Startup output is awaited inside that same ownership boundary so a broken output pipe also closes the original application.

Keep the complete original private Research workspace, merchant checkout/outbox and Buyer workspace with their existing backup and recovery workflows. Publication archives, source handovers, immutable request/result directories and received dossiers are complete product artifacts.

## Continue an existing native programme

Use the dossier, customer delivery, original revision and source selection already produced by the current Research programme. Add the paid-publication and buyer-receiving phases to that same retained operating directory and existing merchant/Buyer configuration.

The complete operating progression is:

| Stage | Original source and result |
| --- | --- |
| Select | Actual saved dossier, frozen delivery revision and optional original source-workspace request |
| Publish | Full archive and source-bound native merchant review, one enrollment, exact public publication |
| Prepare buyer | Same complete publication, original Buyer alias, actual paid-file revision and reviewed budgets |
| Execute | Original native approval, payment intent, purchase/run and receipt |
| Retrieve | Complete original paid-resource export and exact archive |
| Receive | Original full dossier/history/source receiving and four unchanged frozen reports |
| Continue | Customer correction in the received dossier, a later saved work record, then replay of the original receiving request |
| Reopen | Retained completed archive and original request/results after later work and donor relocation |

The first actual native merchant, payment and receiving results belong with that existing programme's source and operation record. Their exact IDs, bytes and source selections are carried forward into the ordinary customer and grant delivery.

## Scientific Python customer workflow

The same paid publication, original Buyer approval and retrieval, complete archive and editable receiving are available through the installed Python Research client. Its [full operating guide](../../python/RESEARCH-COMMERCE.md) includes typed original inputs, complete retained calls and exports, local archive receiving, explicit native replay and the runnable [two-workspace programme](../../python/examples/research_paid_delivery.py). The programme continues an actual saved delivery through later customer correction and original receiving replay using the existing merchant, Buyer and Research owners.
