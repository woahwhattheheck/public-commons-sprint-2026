# OpenLineage operations workspace

A private, editable operations workspace for original OpenLineage events.
Import a producer's JSON or NDJSON, inspect its jobs, runs and datasets, follow
the reported dependencies, save an edition, record an operator decision and
attach a complete result to the event context that explains it. Deliver that
whole workspace, including the original files and editable application, to
another operator.

The browser, command line, Node SDK and MCP tools use the same revisioned
workspace. The maintained SCF distribution adds this product to its existing
command catalog and Applications lifecycle. Its source-owned merchant provider adds
22 tools over this same original application; see [MERCHANT.md](MERCHANT.md).

## Start

Node 22 or newer is the only runtime dependency. A received application can
run directly from its own directory; there is no package installation step.

    node cli.mjs init --workspace /absolute/private/lineage --title "Data operations"
    node cli.mjs serve --workspace /absolute/private/lineage --port 8767

Open the printed local URL. The browser has source import, a searchable
jobs/runs/datasets inventory, original event and facet inspection, lineage,
saved editions and comparison, reasoned reviews, attached result files and
complete downloads. Existing projects reopen through the same command.

In the maintained installed distribution:

    starforge openlineage init --workspace /absolute/private/lineage
    starforge openlineage serve --workspace /absolute/private/lineage
    starforge registrations --source openlineage-workspace

Applications lists **OpenLineage operations**. Select the initialized or
received workspace and an optional private token file, then use the existing
Review, Save, Review Start, Start, Open and Stop controls. The adapter binds the
original workspace identity and selected source to that existing lifecycle.

## Import original events

Select a complete source file in the browser or use:

    node cli.mjs import --workspace /absolute/private/lineage \
      --input /absolute/producer/events.ndjson \
      --source https://your-producer.example/retained-job-log \
      --operation-id producer-capture-20261012

The CLI infers the current revision unless --revision is supplied. Reuse the
same operation ID and exact original arguments after an interrupted response.
A new intended source import gets its own ID.

Import accepts one JSON event, an array of JSON events, or NDJSON. Every
original source byte is retained under its SHA-256. Logical events deduplicate
by canonical complete event content; later observations with changed facets
remain distinct even when their run and event type match. The source inspector
retains the original source position and diagnostic for each event.

The source URL is an operator-supplied provenance field. The application does
not fetch it. Source downloads return the exact retained bytes.

### Producer HTTP transport

A producer can send an original event or event batch to:

    POST http://127.0.0.1:8767/api/v1/lineage

The body is the original JSON/NDJSON bytes. The optional Idempotency-Key header
sets the import operation ID. If-Match can select the current numeric revision.
When omitted, the intake uses a content-derived operation ID and the revision
read immediately before the mutation. A concurrent import may return 409 or
423; retry the same original request after reading the current outcome.

The same endpoint is available at /api/sources?name=events.ndjson&source=URL.
When a token is configured, send Authorization: Bearer followed by that token.

## Operate the project

1. Import complete producer files. Inspect any source diagnostics before
   choosing the event set to review.
2. Open a job, dataset or run. Namespaces are part of identity. Runs retain their
   native UUID plus the owning job identity. Inspect original facets and input
   and output observations alongside the graph.
3. Save a named edition. It retains the current event IDs and source IDs; later
   imports do not change that saved selection.
4. Compare two editions, or a saved edition with the live project. Inspect
   added events and changed jobs, datasets and run outcomes.
5. Save a review against selected entities. A reason is required. Decisions are
   accepted, needs-work, excluded or observed. Updating a review retains its
   previous text, selection and decision in the review's history.
6. Attach the complete existing result file to its saved edition and entities.
   Keep its source reference and, where applicable, its original query alongside
   the bytes. CSV, JSON, reports and other file formats remain their original
   files.
7. Export the complete workspace or generate its complete JSON, CSV or printable
   HTML report. Reopen the delivered workspace to continue the same history.

A review records a human or agent assessment. It does not erase an event,
rewrite the upstream pipeline outcome or cause an upstream job to run.
Result attachment carries existing bytes and their declared relationship to
the selected context.

## Deliver and receive

    node cli.mjs export --workspace /absolute/private/lineage \
      --out /absolute/delivery/openlineage-workspace.json

The package contains the saved state, all source and attached-result objects,
and the complete portable application. Each object and application file has
its byte length and SHA-256; the complete payload has its own digest. Existing
workspace, event, edition, review and operation identities survive receiving.

    node cli.mjs verify --input /absolute/delivery/openlineage-workspace.json
    node cli.mjs receive --input /absolute/delivery/openlineage-workspace.json \
      --out /absolute/private/received-lineage
    node /absolute/private/received-lineage/application/cli.mjs serve \
      --workspace /absolute/private/received-lineage --port 8768

Receiving verifies the complete package before creating the destination. Use a
new destination directory. It restores exact original objects and reconstructs
event/source relationships from those original files, installs the included
application, and records a separate local installation ID in received.json.
Starting that received application is the explicit subsequent command.

Remote clients can download an existing export in exact, resumable byte ranges:

    node cli.mjs download --url http://127.0.0.1:8767 \
      --id EXPORT_SHA256 --out /absolute/delivery/openlineage-workspace.json

A partial download retains its original export identity and offset. Repeating
the command continues that export and verifies its complete digest before
making the destination file available.

## Node SDK

Import LineageClient from ./client.mjs or the installed
@tokenjunkielabs/starforge-merchant package's /seller/openlineage export. The
adjacent client.d.ts declares the interface.

    import { LineageClient } from "./client.mjs";
    import { readFile } from "node:fs/promises";
    import { randomUUID } from "node:crypto";

    const client = new LineageClient("http://127.0.0.1:8767");
    const current = await client.read();
    const original = await readFile("/absolute/producer/events.ndjson");
    const imported = await client.importSource(original, {
      name: "events.ndjson",
      operationId: randomUUID(),
      expectedRevision: current.revision
    });
    const edition = await client.saveEdition({
      title: "Reviewed producer capture",
      operationId: randomUUID(),
      expectedRevision: imported.revision
    });

Keep the operation ID and exact arguments before sending a mutation if another
process will need to resume it. A 409 with the current revision means another
writer changed the project; read that change before issuing a new operation.
A replay with the same ID and original input returns the original result.

For a host-selected connection, the client supports expectedWorkspaceId and
instanceId. The server verifies these headers on the same request that performs
the action. The optional signal joins the caller's cancellation to the request
timeout.

The direct LineageWorkspace interface in store.mjs provides the same native
methods for a private local process.

## MCP and HTTP API

    node cli.mjs mcp --workspace /absolute/private/lineage

The stdio server uses newline-delimited JSON-RPC. It provides MCP initialize,
tools/list and tools/call for the native action catalog. The same stateless
JSON-RPC interface is available at POST /mcp. The declared protocol version is
2025-03-26.

POST /api/action accepts {"action":"workspace.read","args":{}} and returns the
native action result. Inspect catalog.mjs for exact input schemas. Mutation
arguments carry operationId and expectedRevision. Object and export downloads
have separate original-byte routes.

GET /api/identity returns the current original workspace and application
instance. The server writes that same small identity to the workspace's private
connection.json for an installed host adapter. GET /api/workspace returns the
current projection and saved history.

## Source interpretation

SOURCE_CONTRACT.md records the supported upstream schema versions, lifecycle,
facet replacement, graph rules and exact fixture provenance. Events outside the
supported operational grammar remain inspectable in their original source
with diagnostics. Native event timestamps order projections; source arrival
sequence resolves ties.

This workspace distinguishes declared job structure from individual run
observations. It follows explicit producer lineage when available and retains
the dataset-to-run-to-dataset graph when only input/output observations exist.
It does not manufacture an all-to-all dataset relationship from two event
arrays.

## Recovery and operation

The selected workspace directory holds workspace.json, content-addressed
objects/, immutable exports/, the current connection.json and a short-lived
writer.lock. Files created by the application use private permissions.

Only one mutation writes the saved state at a time. State updates use a
synchronized temporary file followed by an atomic rename. Stable operation IDs
make a lost success response recoverable. A process interruption may leave its
writer.lock. Read that original record and use:

    node cli.mjs recover-lock --workspace /absolute/private/lineage \
      --id ORIGINAL_LOCK_ID

The recovery command checks that the exact original lock remains and that its
process no longer exists.

The default HTTP body limit is 64 MiB. Larger retained sources can be imported
through the direct CLI, subject to available memory and disk. This first
implementation keeps the saved event index in memory for projection and writes
its JSON state atomically. Use a workspace per operational scope when the full
event history outgrows the available host.

The default listener is local to this computer. To bind another interface,
provide a private token file containing at least 24 characters. The server
rejects other browser origins, requires that token on its data routes and uses
the selected host consistently. Transport through a configured HTTPS service
is the operator's deployment responsibility.

## Original source and distribution

The source-owned contribution is in
distribution/contributions/openlineage-workspace.json; contribution.json here
retains its portable metadata. The command, typed client, native store/model,
MCP API, browser route manifest and Applications provider enter the existing
immutable-source builder. The managed provider uses the existing distribution's
lifecycle; the portable exported application runs independently.

browser-assets-loader.mjs is the unchanged original shared distribution
browser-assets.mjs, Git blob 63801fa838c0479e6ae156d9f155461f02df0cfb, retained
locally so the independently received application uses that same manifest
reader without an external package dependency.

The application is MIT licensed. Upstream event fixtures retain their
OpenLineage provenance and upstream license information in SOURCE_CONTRACT.md.
