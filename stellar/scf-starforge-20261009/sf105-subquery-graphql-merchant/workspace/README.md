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

## Revise a merchant as its schema and products change

The **Schema and merchant revisions** panel uses the original
[`onboarding/revisions.mjs`](../onboarding/revisions.mjs) comparison and preparation
API. It accepts the actual new served schema, including query or merchant-term
changes in the same draft. It does not modify the provider's schema.

1. Open the saved project and choose a previous merchant export. Exports from
   earlier draft contents remain valid baselines, including an earlier revised
   merchant. The workspace verifies its saved record and exact package files;
   the original bundle reader verifies the schema, queries, plan and generated
   service binding.
2. Edit or load the new schema and proposed query/plan files. **Compare current
   draft** works before saving. The original report identifies each existing
   query's validity and selected schema contract under the new schema, changes
   to approved queries and variables, and added or removed operations. It also
   shows the exact previous/candidate route, request schema, public example,
   ordered payment choices and endpoint. Global breaking and dangerous schema
   changes remain visible even when the selected products still compile.
3. Correct any candidate error and compare again. An invalid candidate can
   still be saved as unfinished work. Its report remains inspectable; complete
   route/payment comparison and revised preparation need a valid original
   compiler result. Changes to the draft or selected baseline clear the prior
   comparison. Saving the exact compared contents preserves it.
4. **Prepare revised package** after saving. The server binds this operation to
   the current project revision, selected retained export and exact comparison.
   It calls the original `prepareSubQueryRevision`, retaining its unchanged
   `merchant/`, exact `previous/` package, frozen `candidate/` inputs, and
   `revision/review.json`, `review.html`, `manifest.json` and `RUN.md`. The
   revision report is checked against the report reviewed in the browser before
   the new export is attached to the project. Previous packages stay intact.
5. Use the new export's launch command, **Copy buyer client path**, and **Buyer
   and operator files** for the original generated client, service, queries and
   review. The updated route IDs, inputs and payment terms feed the same native
   buyer and seller implementations. After runtime configuration changes, use
   the original live seller's client export for its current runtime snapshot.
6. Select the revised export and start the same original seller. If a merchant
   is already running, stop it first; revision preparation does not replace a
   running process. Reopen the project after a workspace restart to start the
   same retained export. **Open saved change report** reads and verifies the
   stored original report, including its baseline, even after further edits.
   For a subsequent revision, select the latest revised export as its baseline.

The revised package includes both original launchable merchant versions and
their buyer files. Use its `revision/RUN.md` to run the prior version when the
provider still serves the necessary schema. In the workspace, opening the prior
project revision and saving it as a new current revision makes a matching older
export selectable again. This preserves intervening history and exports.

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

Revised exports live under `packages/PROJECT-rREVISION-ID/revised/`. Their
retained workspace record also binds every original revision-wrapper file,
including the previous merchant and change report. Those bytes are verified
before a saved report is opened, an export is used as a baseline, or its
merchant is started. Each successive revision copies the prior merchant package,
not all earlier wrappers, so historical lineage does not recursively duplicate
the complete workspace.

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
inspection, current-draft review, project save/load/history, export, evolution and managed
merchant start/stop/status. The web page and API call the same maintained
compiler and original native runtime. No separate GraphQL parser, payment
implementation, scheduler or project database is introduced.

The same authenticated local API exposes:

| Endpoint | Input / result |
| --- | --- |
| `POST /api/evolution/compare` | Current project `id`, `expectedRevision`, retained `baselineExportId`, and editable `input`; returns original `review`, exact `comparisonDigest`, candidate `inputDigest`, baseline identity and valid candidate merchant review. |
| `POST /api/evolution/prepare` | Current project `id`, `expectedRevision`, `baselineExportId` and previously returned `comparisonDigest`; prepares the saved candidate and returns the updated project and complete original export. |
| `GET /api/evolution/report?id=PROJECT&exportId=EXPORT` | Verifies the retained package and returns its original saved review and baseline identity. |

Export identifiers resolve only within the named project. These endpoints accept
no caller-provided package directory. A comparison that no longer matches the
current draft or baseline returns a conflict and requires a fresh comparison.
