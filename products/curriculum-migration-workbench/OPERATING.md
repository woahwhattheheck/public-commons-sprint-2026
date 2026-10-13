# Curriculum Migration Workbench — operating guide

The Curriculum Migration Workbench gives an implementation team one complete working record for API and curriculum migration: retained source contracts, original and candidate outputs, explicit transformations, full comparisons, curriculum occurrence plans, engineering decisions and receiving. The managed edition adds a persistent store, independently editable branches, an authenticated browser, a typed workspace client, agent access and the maintained Runtime Applications lifecycle.

The original 20-file application remains unchanged under app/. Its model, curriculum coverage engine, occurrence planner and API SDK generator perform the operations. The managed service records the original command and its first result, then applies the same model transition. It does not substitute a different comparison or migration engine.

Use this guide for operation and ownership, SDK.md for exact client and agent contracts, STORE_HTTP.md for store/HTTP behavior, and tools/curriculum-migration-workbench/MANAGED_RECEIVING.md for the complete receiving programme. The original app/README.md, app/SDK_GUIDE.md, app/CURRICULUM_MIGRATION.md and app/CURRICULUM_COVERAGE.md remain the detailed domain guides.

## 1. Source and the initial workspace

The application source is adopted from Commons commit 0a79b94fb3fe14008d37e71838822e41dee174cb, tools/curriculum-migration-workbench/. The public curriculum contract is pinned to Oak National Academy's oak-curriculum-api commit eabbd67483f37cf6ceb8abb697fc44cb12aca99c. app/source-selection.json identifies every original file by complete byte length and SHA-256; its canonical selection SHA-256 is 0d327292684c56e52b45913e9acb5bb2efc6d7feb2a19f4ece489706fb432579.

The initial workspace retains:

- One complete public source edition containing the REST surface, original bulk JSON Schema, published GraphQL representation and exact retained view constants.
- Thirty-two API operations and twenty-five published response examples attached to their original operations.
- Twenty-five cases with original responses, awaiting candidate responses and comparisons.
- Fifty-one original history entries, including workspace creation, each case and each original response.
- The complete provenance of every included response, source file and contract edition.

The published GraphQL representation supplies 110 relation-like names and descriptions. This edition does not supply their field definitions or complete Hasura relationship metadata. The REST snapshot also omits three referenced error definitions; the generated API client keeps unresolved error payloads available instead of inventing their structure. Review the generator diagnostics when adopting a later contract.

The included examples support operation-by-operation development against publisher material. Customer staging responses, private schema extracts, SQL, Drizzle source and real bulk datasets enter through explicit retained files or responses. A real BULK plan requires the actual selected original and candidate bodies plus the operator's identifier namespaces and mapping decisions.

Published source reference: https://github.com/oaknational/oak-curriculum-api/tree/eabbd67483f37cf6ceb8abb697fc44cb12aca99c. Keep app/LICENSE.OAK with redistributed code. Review the original source/content terms for the customer's actual data and distribution.

## 2. Continue the original customer and Installation

Use the existing opportunity, Workshare, commercial plan and Installation. The managed product is an operating component of that delivery, so preserve its scope, phase, effort, funding and payment selections. Select the curriculum-migration-workbench Installation workorder profile for the complete twelve-step programme and fourteen source/input groups.

Start by agreeing the intended population: API routes and status behavior, original and candidate environments, curriculum programmes, units and lessons, required source assets, expected outputs and the people responsible for review. Record customer data access and deployment work as part of that actual scope. An engineering decision in the workbench identifies a named operator's judgment on a saved result; it is not a replacement for the customer's commercial acceptance process.

The Installation should contain the actual retained source edition, selected response files, case and plan identifiers, complete generated SDK, receiving outputs and operating observations. Preserve the customer's source restrictions and ownership in that original record. The product registration supplies the four original domain guides to the grant/developer source registry, so the application and its implementation workflow stay connected.

## 3. Install and open the managed application

The maintained Runtime provides Node 20 or later, the installed product source and its existing Linux flock-based ownership helper. Select a real, private directory whose existing parent is a canonical real directory. The store UUID identifies this physical store; choose and retain it before the first create.

From the installed Runtime command surface, create the store with the exact original source selection. These paths and identifiers illustrate the arguments; replace them with the actual selected values:

    curriculum-migration-workbench create \
      --workspace /srv/customer/curriculum-store \
      --id 8606e7ab-a4bf-45d0-9eec-0e340a96b885 \
      --title "Customer curriculum migration" \
      --at 2026-10-13T14:00:00.000Z

The default input is app/initial-workspace.json. To create a receiving store from a complete saved workspace, also supply --snapshot with its absolute path. A portable file must retain the original curriculum-workspace-export.v1 packet and canonical workspace hash. The creator binds the original directory, UUID, title, timestamp and selected snapshot; repeat those same arguments to recover that create.

In Runtime Applications, select **Curriculum Migration Workbench**. Settings are workspaceDirectory, optional connectionFile and optional port. The provider validates the original source files, creation receipt, selected Node executable and connection path. Applications owns the running process and publishes its private connection only after the actual service responds with the expected physical identity.

Open the Application's private URL. The browser consumes the bearer token from its URL fragment, removes that fragment from the visible URL and retains the private connection in the tab session. Every managed request carries the exact store ID and directory. The service accepts its original loopback Host and same origin; the client does not redirect its capability.

The first selected port is retained in the physical store. Reopening that store uses the same local origin so its browser's pending request and retained forms remain associated with the correct service. After a restart, reopen through the current private connection URL to pick up the current token.

The operating header shows the current store title, physical branch and revision. Enter the operating engineer before saving a command. The original source edition and case inventory appear in the workbench immediately.

### Direct command ownership

The command-line tool also provides binding and serve for a host that explicitly owns that service. binding returns the exact binding hash; serve requires that hash and a retained application request UUID. Normal product operation uses Applications so its existing start, stop, recovery and installation records remain authoritative.

The service holds its store lease for its complete lifetime. Direct local store commands acquire the same lease, so stop the owning Application before using direct branch/command/report/export operations against its directory. Use the typed client or agent tools while the Application is running; they borrow its authenticated service.

A shutdown closes the HTTP service and the store independently and records STOPPED after both complete. An interrupted application resumes through its original Applications operation and retained request state.

## 4. Understand store, branch and portable identity

Three identities serve different purposes:

| Identity | Meaning | Where to find it |
| --- | --- | --- |
| Physical store UUID and canonical directory | The owner of persisted branches and original requests | creation/identity receipt, private connection, operating header |
| Physical branch ID | One independently editable working copy in that store | branch selector and client branches() |
| Portable workspace ID, revision and SHA-256 | The complete original workbench edition inside a branch | branch response and exported portable packet |

Receiving preserves the portable workspace identity and its entire history. It creates a new physical branch with a fresh branch ID. Two branches can therefore contain the same portable workspace ID and later diverge without replacing each other.

**Create working copy** receives the selected saved workspace into a new branch. **Receive workspace** accepts a complete portable JSON file and creates another branch. The latter also retains the selected file's complete hash and its parent branch. A branch switch preserves the current form for that branch and view.

All mutations and selected reports require the observed workspace ID, revision and snapshot SHA-256 together. They apply to the physical branch selected by ID. This complete expectation prevents a stale tab or agent from quietly applying an operation to a newer edition.

## 5. Work through an API migration case

Choose a retained case or select **New migration case**. A case binds an API operation and its source/candidate contract editions. The original public cases initially hold the publisher's example only. A new case dialog stays tied to the physical branch and revision where it opened.

For each actual operating case:

1. Confirm the operation, original contract and candidate contract.
2. Retain the real request parameters/body and any explicitly reviewed keyed-array settings.
3. Load or paste each complete response body, status, headers, provenance kind and source description.
4. Save the original and candidate responses separately.
5. Save explicit field mappings with engineering reasons.
6. Run the complete comparison and review its schema results and differences.
7. Record the engineering decision on that exact current run.

A loaded file remains an editable form until its save operation completes. File reads are tied to their original branch, revision, view and connected editor. The browser excludes navigation during the read and checks that context before inserting the result. A delayed file cannot land in another case or branch.

The response provenance distinguishes published-example, operator-file and captured-http. Keep the actual status and headers as well as the JSON body. The original comparison handles redirect Location values explicitly. A later response save preserves the previous response in the original history; saved runs also retain their full input responses.

### Field mappings and arrays

Copy, move, omit and constant operations use JSON Pointers and an engineering reason. Mappings transform a copy of the retained original body. The comparison keeps the original response, mapping list, transformed expected output and complete candidate together.

Arrays are ordered by default. Select a keyed-array path and scalar row-key pointer only for an explicitly unordered collection with a valid unique key. Missing or duplicate keys require review rather than an invented correspondence. Preserve distinctions between absent values, nulls, empty strings, numbers and numeric strings.

The UI pages differences in groups of 100 while the saved run and exported case retain every difference. Read the original and candidate contract-validation results, including unsupported assertions. A MATCH requires both schema results to be valid and no retained difference under the selected mapping/comparison rules.

### Decisions remain attached to a run

Record accepted or changes-required with a substantive note. The decision names the saved run and operating engineer. A changed case makes the earlier run historical; run the comparison again before recording a decision on the current case.

Exporting a case includes all its runs and decisions. The commissioning overview summarizes the saved case population; use the complete case export when reviewing its individual evidence.

## 6. Plan curriculum occurrence migration

Create or select a BULK case after receiving its complete actual original and candidate outputs. Select the correct contract editions and retain their source descriptions. The Curriculum view opens the original planner against that saved case.

Enter both identifier namespaces. These namespaces identify the selected datasets; they must reflect the real source/candidate systems. The planner retains scoped programme, year, option, board, tier, pathway and related identity components supplied by the original schema and data. Repeated units or lessons remain separate occurrences with exact pointers.

Unique valid identities can establish automatic correspondence. When an identity changes or occurs more than once, select explicit original and candidate occurrence pointers and record the reason. Each mapping must preserve one-to-one correspondence within its selected kind. Review unmatched occurrences and ambiguous identities directly; duplicate rows remain available for inspection.

**Create migration plan** retains the actual responses, source/schema identities, field transformations, namespaces, occurrence mappings, complete coverage/comparison and transport differences. The saved plan receives its own ID and operating context. The findings view pages rows in groups of 50, with category filtering; complete plan/review exports retain the entire population.

Review the source, transformed expected output and candidate coverage together. The original coverage engine checks retained publisher relationships and publication states. Differences in unit/lesson identity, order, containment, membership and returned values are visible independently of a chosen correspondence.

Select the saved plan edition before making an engineering decision. A change to a namespace or occurrence mapping leaves the form unfinished until a new plan is created. A change to the case response or contract makes an earlier plan historical. The decision control requires the selected saved plan and a meaningful note.

The portable receiver recomputes retained curriculum plans using the original engine. The base workbench receiver checks the original structural history and identities. Keep the full original history and source files; new managed commands execute the actual native transition rather than accepting a replacement arbitrary snapshot.

## 7. Contracts, generated SDK and source assets

**Contracts & SDK** selects a retained edition. Its inventory shows published operations, GraphQL names/descriptions and exact retained constants. Importing a new contract edition creates a new immutable source edition; existing cases and saved outputs keep their original source references. Select the candidate edition explicitly within the case.

Generate the API SDK from the intended retained edition. The complete result contains client.ts, types.ts and inventory.json plus diagnostics. These are the original publisher-facing API client and types. Their behavior, including authentication parameters, response decoding, raw error bodies and redirects, is documented in app/SDK_GUIDE.md.

The managed workspace SDK is a separate interface: CurriculumMigrationClient reads and edits the saved engineering workbench through the existing Application. Its types are in client.d.mts. Creating or generating either interface does not implicitly fetch provider data.

Use **Source assets** to retain full SQL, Drizzle modules, Hasura metadata, GraphQL introspection and engineering source notes. An asset is immutable under its ID. Save changed content as a later asset with a new ID and clear name. The full content is available in the workspace, authenticated asset download, agent file reader and portable exports.

The model retains parsed JSON responses. When exact source-file lexical bytes matter, keep the original file and byte receipt in the customer source records as well. Text assets preserve their complete retained string; the file-import helper verifies the selected original file before creating it.

## 8. Retained forms and interrupted requests

The browser records unfinished forms separately from the managed branch. It keeps case, contract, source and curriculum planner form state by physical branch and view. **Export retained forms** provides the complete retained form document, including its original saved-revision basis.

If another tab saves first, the service rejects the stale expectation and keeps the current saved branch. The browser retains the rejected form. Use **Reopen current revision** and **Inspect current saved values** to review the latest saved state alongside that form. Then explicitly choose **Use retained form on this revision** or **Discard current form**. Rebasing the form selects a new basis; its actual operation still requires an explicit Save.

Before a mutation is sent, IndexedDB stores the complete path, request body, request UUID and canonical hash. The request remains there until a returned result or definitive absence settles it. **Recover original request** looks up the retained UUID and dispatches that same original body for exact reconciliation. A later unrelated change cannot replace the pending request.

A successful exact retry returns its original first result. The browser then reads the current branch so later edits remain visible. Reopening the original receive request similarly preserves edits made after receiving. If a connection or process stops between dispatch and reply, preserve the existing file, request and operation identities and continue this recovery.

Browser storage can fail or fill. A failed draft/request retention prevents dispatch of a new managed mutation. Export the retained form or original input file and restore browser storage before proceeding. The managed saved workspace remains in its physical store.

## 9. Export and independently receive the complete work

**Export workspace** obtains the full portable packet from the selected managed branch, bound to its current expected identity. It includes all source editions, cases, complete responses, mappings, runs, curriculum plans, decisions, assets and original history.

**Download application** produces one complete ZIP containing:

- All twenty exact original application/source files, including the pristine standalone HTML.
- The complete generated API SDK for the selected latest retained edition.
- current-workspace.json, containing the selected portable workspace.
- A short receiving instruction file.

The exported HTML is read from the original selected source, so it has no live managed controls, private connection configuration or token. Source downloads verify complete byte lengths and SHA-256 values. The ZIP's source files remain the original adopted files.

To receive offline, extract the ZIP into a chosen directory and open curriculum-migration-workbench.html in an independent browser context. Use **Receive workspace** to load current-workspace.json. The original offline application stores one workspace in that browser context; use separate contexts for independent copies that preserve the same portable workspace ID. The managed application provides multiple physical branches directly.

Save a legitimate later edit in the received workspace and reopen it. Export it again and inspect complete history, source assets and plans. In a customer Installation, record the actual operator observations, downloaded files and continuing source/support ownership.

The complete managed receiving programme also checks two managed branches, a real stale-tab conflict, desktop and 390-pixel layouts, exact ZIP membership, two independently opened standalone contexts, service restart and a third cold receiving store.

## 10. Typed client and customer-agent access

Create a CurriculumMigrationClient with the selected connection file, store UUID and canonical directory. It validates the current private connection and borrows the running Application. Await each call on that client. close() drains accepted requests; Applications owns the service lifetime.

For each write, retain one command envelope before dispatch:

    {
      "requestId": "retained-original-uuid",
      "id": "selected-physical-branch",
      "expected": {
        "workspaceId": "portable-workspace-id",
        "revision": 51,
        "snapshotSha256": "complete-canonical-sha256"
      },
      "command": {
        "kind": "saveResponse",
        "actor": "Named operating engineer",
        "at": "2026-10-13T14:30:00.000Z",
        "body": {
          "caseId": "selected-case",
          "lane": "candidate",
          "response": {
            "status": 200,
            "headers": {},
            "contentType": "application/json",
            "provenance": {
              "kind": "operator-file",
              "label": "Actual selected candidate response"
            },
            "body": {}
          }
        }
      }
    }

The example describes the envelope; choose actual current branch values and the actual returned response. Supported kinds are addEdition, addCase, updateCase, saveResponse, compareCase, decide, addAsset, planCurriculumCase and decideCurriculumPlan. The operation bodies match the original functions exactly.

Use history() to consume every page at one frozen revision. Reports include portfolio, curriculumPortfolio, full case, source inventory, curriculum plan, complete curriculum review rows and generated API SDK. The binary helpers stream full workspace/report/SDK/source/case/response/asset data and verify final length and SHA-256.

Customer-agent tools use curriculumMigration/curriculumMigrationConnection configuration. A host declares the allowed physical stores and complete input-file aliases. The agent receives the same store ID/directory and branch expectation as the client. Large inputs travel through a complete host-declared file and its exact byte/hash descriptor; full outputs use the maintained retained-file reader, including its final release.

Follow every nextOffset and preserve the read ID and final file descriptor. Keep the original request UUID when reconciling an uncertain operation. Agent tools borrow the same Application and native model; the provider does not create a second writer or service.

## 11. Capacity and operation records

| Retained surface | Capacity |
| --- | --- |
| Complete canonical workspace | 128 MiB |
| Immutable stored JSON object | 160 MiB |
| Complete HTTP request body | 160 MiB |
| Compact branch/request head | 24 MiB |
| Physical branches per store | 256 |
| Retained request identities per store | 20,000 |
| Complete retained asset/response/edition file input | 128 MiB, subject to complete workspace/body capacity |
| Each fixed original application file | 16 MiB |
| Complete original application selection | 64 MiB |
| History page | Up to 200 complete rows |

These limits apply to complete encoded material. Escaping a JSON request or retaining source in several historical outputs can expand its stored size. A capacity rejection preserves the existing complete state and input. Use deliberate customer scope and complete independent receiving when approaching a store's documented capacity; never discard rows or truncate source to force a save.

The store keeps immutable objects for snapshots, original request inputs and first results. The compact head holds branch and request references. A lifetime lease serializes writers; an uncertain filesystem commit requires reopening the same store before further changes. Requests are not marked definitely absent unless the original writer can establish that absence.

## 12. Continuing work and support

A later source contract, captured response or curriculum export continues the same customer migration. Receive the source as a named later edition or file, update the selected case, run its comparison/plan and record the current reviewed decision. Earlier runs and plans retain their complete inputs for review.

Use the original Installation to track genuine provider acquisition, database/Hasura/Drizzle implementation, consumer integration, deployment, operator training and support. Keep the complete generated API client together with its source edition and diagnostics. Keep customer questions and source-owner answers attached to the original opportunity and delivery.

When handing over, include the full application, source selection, portable workspace, generated SDK, operating and receiving guides, actual observed receiving results and the agreed maintenance owner. Continue the named native receiving operation from its retained source and outputs so completed customer work remains usable.
