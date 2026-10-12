# OpenSearch managed deployments

The OpenSearch merchant workspace can retain, run, upgrade and roll back a prepared seller through the existing SF82 release manager. Its Deployment view uses one original SF82 console for the process, selection history, operations interface and customer exports.

## Open the original workspace

Use Node 22.16 or later and the original installed source distribution. Start the workspace with its original source declaration, plan and private directory:

    node sf30-seller-sdk/opensearch/workspace/server.mjs \
      --source SOURCE.json --plan PLAN.json --workspace PRIVATE_WORKSPACE --port 8447

Set the environment names declared by SOURCE.json on the host. The endpoint value and authentication values stay in that environment. A challenge-only seller uses the maintained Node HTTP transport; configuring a payment facilitator uses the original native payment runtime.

The workspace reopens its query revisions, retained search editions, relevance judgments, evaluations, prepared packages and requests. Deployment adds a private SF82 store at PRIVATE_WORKSPACE/deployment. The original generated customer exports live beside it in PRIVATE_WORKSPACE/deployment.clients.

## Complete the deployment in the browser

1. Open a saved query. Inspect its source and merchant terms, then prepare the merchant. A prepared package contains its source declaration, merchant plan, service, bindings, OpenAPI and six original customer-export files.
2. Open **Deployment**. Choose the saved package, a new release ID, a useful label and a listener port. Port 0 selects an available port.
3. Select **Stage saved package**. Staging checks the complete original package against the saved workspace edition and recompiles its query, merchant and customer contract. It retains those exact files in an immutable release.
4. Select the retained release and use **Compare with selected**. The comparison covers queries, indices, projection, sorting, limits, public request contracts, payment terms and runtime selections.
5. Select the release at the displayed generation. **Start selected** opens the original OpenSearch source and seller in the SF82 child. The workspace shows the actual running state and seller documentation.
6. To deploy an improvement, prepare its saved query revision as a new package, stage a new release and compare it. Selecting the new release keeps the current seller running. **Restart selected** drains that instance and opens a fresh process for the selected source.
7. **Select previous release** returns the selection to the previous retained source. **Restart selected** then runs it. Selection history retains both directions and their reasons.
8. While this console owns the running seller, generate a customer export. The original customer compiler reads that seller's actual OpenAPI and binds its export to the release digest and process instance. Download its complete client archive and the generated deployment handover.
9. **Drain and stop** closes the seller through its original graceful lifecycle. Closing the workspace also waits for its active requests, closes the original release console and drains its managed seller.

The **Full operations console** link opens the same existing SF82 console. It provides the original detailed operations, customer-file, receiving, facilitator and catalog controls. These controls share the same release store and process owner.

## Retained inputs and live source behavior

Each release retains eleven prepared files under opensearch/package, plus the original SF82 manifest, offers, service and release metadata. It preserves the endpoint/authentication environment names, fixed named-query declarations, explicit indices, projections, sorting, limits and generated client.

Queries execute against the configured OpenSearch source using the maintained point-in-time implementation. Retained result editions remain available in the workspace. A release changes the seller's query configuration; it does not turn a captured result edition into a replacement OpenSearch server.

The process runtime binds the original offers, service and OpenSearch execution hash. Different query definitions remain distinct even when their public payment terms match. SF82 verifies source files before starting the child, then the child verifies the same execution identity before opening the source.

## Original command-line lifecycle

From stellar/scf-starforge-20261009:

    node sf82-seller-pilot/release-cli.mjs init --store PRIVATE_RELEASE_STORE
    node sf82-seller-pilot/release-cli.mjs stage \
      --store PRIVATE_RELEASE_STORE --id search-v1 \
      --opensearch-package PREPARED_DIRECTORY --port 8423
    node sf82-seller-pilot/release-cli.mjs diff \
      --store PRIVATE_RELEASE_STORE --to search-v1
    node sf82-seller-pilot/release-cli.mjs activate \
      --store PRIVATE_RELEASE_STORE --id search-v1 --expect 0
    node sf82-seller-pilot/release-cli.mjs console \
      --store PRIVATE_RELEASE_STORE --port 8425

Read the current generation before later selections. The original CLI supports inspect, list, diff, status, activate, rollback, run and console. Keep a single managing console for a deployment. The OpenSearch workspace already owns the console it opens.

A new release may configure the existing --facilitator HTTPS_URL and explicit --allow-local-facilitator option. Source endpoint permission remains in the original OpenSearch declaration's allowLocal field; it is independent of facilitator selection.

## Agent and MCP integration

The same createOpenSearchWorkspace instance exposes:

- workspace.deployment.status(): current original release status, selected/previous release and managing console state.
- workspace.deployment.compare({from, to}): source and runtime comparison at the current selection generation.
- workspace.deployment.run({requestId, action, ...input}): retain and execute one deployment request.
- workspace.operation(requestId): reopen the original request and its result.
- workspace.deployment.clients({after, limit}): page the retained customer exports.
- workspace.deployment.client(exportId): inspect an original customer export.
- workspace.deployment.handover(releaseId): generate the deployment handover.

Actions are open, stage, activate, rollback, run, restart, stop and generate-client. Stage takes packageId, id, optional label and runtime. Selection/run use expectedGeneration. Stop/restart/customer generation use the instanceId actually owned by the console. These values come from current status.

The browser uses /api/deployment for saved mutations and /api/deployment/status, compare, clients, client, client-download and handover for reads. Existing workspace origin and mutation-token checks apply. Private console capabilities remain in the local session.

A request ID is bound to its original input in the existing workspace operations table. A repeated call returns its retained operation. After a process interruption, inspect that operation and the original release status to recover completed effects. Staged releases, selection history and generated client identities stay available.

## Move or hand over the workspace

Close the workspace and copy its complete private directory, including deployment and deployment.clients. Keep the original source distribution available on the receiving host and set its declared environment values. Reopen the workspace at its new location. Its package view resolves the copied packages/<id> carrier and checks downloads and deployment staging against the original file manifest. Historical package and request records retain their producer paths and identities. The SF82 store retains its complete package bytes independently of the earlier preparation directory.

A customer can also receive the generated client archive alone. It contains the generated JavaScript client, TypeScript declarations, OpenAPI, package metadata, usage guide and completion manifest. The accompanying deployment handover records the exact release, source and execution identities and the commands to operate it.

## Native receiving operation

The included sf30-seller-sdk/opensearch/receiving/deployment-journey.mjs and sf30-seller-sdk/opensearch/receiving/run-deployment.py continue the original retained public-flight workspace through managed deployment, live source capture, upgrade, customer exports, rollback and a fresh-process reopen. The original maintained playground bridge supplies the live OpenSearch endpoint and retains its native metadata for the duration of that single operation.
