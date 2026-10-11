# GraphQL merchant workspace

This is the local browser workflow for the original SF105 SubQuery merchant.
It consumes the maintained [onboarding compiler](../onboarding/README.md) and
starts the original SF30 seller. The same original GraphQL schema, approved
queries and merchant plan feed review, export and runtime.

## Start

Use Linux with Node 22 or later and `flock` from util-linux, and install the original runtime and GraphQL dependencies
as described in the [onboarding guide](../onboarding/README.md). From the source
checkout:

```sh
node stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/workspace/server.mjs \
  --workspace /private/graphql-merchants --port 0
```

The launcher creates a private workspace if it does not exist and prints its
complete local browser URL. Open that URL in the same machine's browser. The
workspace binds `127.0.0.1`; `--port 0` chooses an available port. The URL's
private capability moves into browser session storage and is removed from the
address bar. Every private API uses that capability and the exact local origin.
Closing the browser leaves the workspace process running; Ctrl-C drains its
managed merchant and closes the workspace. The next launch prints a new URL.

Provide backend credential environment values to the launcher process when the
original approved-queries file declares an `authorizationEnv`. The browser
edits only the environment variable name. It has no credential-value field.

## Complete an operator project

1. **Load the actual query service schema.** Choose served SDL, raw introspection
   JSON, or the original captured-source envelope. Inspect the query roots,
   argument types and searchable named types. The original GraphQL reference
   implementation validates it. Entity-only indexer SDL requires the actual
   query-service schema, as explained in the onboarding guide.
2. **Load or author approved queries.** The guided editor retains the original
   `stellar-forge.subquery-merchant.v1` shape: fixed query, response root, named
   native handler/admission, buyer variable types and bounds, defaults, node
   cap, backend origin/path, timeout and capacity. The full original JSON is
   also editable. Use **Apply JSON to editors** after changing raw JSON.
3. **Load or author the merchant plan.** Use the original
   `stellar-forge.subquery-merchant-plan.v1` format. Create one public POST route
   per approved operation, enter its service name and description, and provide
   public example variables and descriptions. Shared ordered payment choices
   have explicit scheme, network, asset, recipient, atomic amount and timeout.
   Existing per-route payment overrides remain in the plan; edit those complete
   declarations in its JSON view. Changing an operation name updates its route
   reference; removing an operation removes its corresponding route.
4. **Save and review.** An unfinished draft can be saved before its schema or
   terms are valid. Review calls the original `compileSchemaSource`,
   `inspectSchema` and `compileSubQueryMerchantPlan`; it displays exact compiled
   routes, payment alternatives and native source review. Draft changes clear
   that review. Save the reviewed contents before export.
5. **Export the current project.** The maintained `prepareSubQuerySeller`
   creates a new private package containing the original source, approved
   queries, merchant plan, exact seller-service and query files, readable review,
   original generated buyer JavaScript/TypeScript client and request examples.
   The workspace displays the actual returned file paths and launch command.
6. **Start the original merchant.** Select an export matching the current draft.
   Leave the facilitator blank to start its original challenge-only mode, or
   supply the deployment's configured HTTPS facilitator for its native mode.
   A same-host HTTP backend needs the explicit local-development checkbox.
   Status links point to the original offers and readiness endpoints. **Stop
   managed merchant** uses the original runtime's drain/close operation.

The browser does not automatically capture a remote schema, execute a buyer
purchase or send a partner message. The original onboarding CLI performs
explicit schema capture, and the original buyer client performs customer
purchases with its existing authorization and recovery behavior. A successful
offline review and HTTP 402 show the setup path; actual indexed-data delivery
and Stellar settlement use the configured original runtime.

## Saved work and recovery

Drafts live below `projects/PROJECT/` with immutable numbered versions and an
atomically updated current pointer. Complete synced bytes are published without
replacing an existing revision before that pointer moves. Save compares the expected revision, so an
older tab cannot silently replace a newer draft. History opens a retained
version; saving it appends a new revision and preserves the subsequent history.
The browser asks before discarding unsaved edits while switching projects.

Packages live below `packages/PROJECT-rREVISION-ID/`. Each export retains exact
input bytes and the original compiler output. Changing a draft leaves earlier
exports available but disables their use as the current merchant. A matching
export remains usable after restarting the workspace. Before managed startup,
the workspace checks the retained export record and the original exported file
bytes; changes require a fresh export. An unavailable export does not prevent
opening or editing its source draft.

The workspace requires private regular directories (`0700`) and writes private
files (`0600`) on Unix. Input limits match the canonical exporter: schema and
queries each up to 1 MiB; plan up to 256 KiB. The workspace owns one local writer
and one managed seller. Linux holds the exclusive writer lock on the workspace
process's open descriptor; a second writer is refused. Process exit releases the
lock automatically, including an interrupted process, so reopening needs no
stale-record removal. The persistent `writer.lock` file must remain in place.
Interrupted exports leave their private partial files for inspection, matching
the original create-only exporter behavior.

## Integration API

`startWorkspace({workspace, port:0, noSignals:true})` from `server.mjs` returns
`{url, origin, token, directory, close}`. The private API supports schema
inspection, current-draft review, project save/load/history, export, and managed
merchant start/stop/status. The web page and API call the same maintained
compiler and original native runtime. No separate GraphQL parser, payment
implementation, scheduler or project database is introduced.
