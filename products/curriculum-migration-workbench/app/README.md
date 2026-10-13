# Curriculum Migration Workbench

Open curriculum-migration-workbench.html in a current browser. The application contains its complete pinned source edition and works locally. Enter the operating engineer, choose one of the 25 original published response cases, load and save an actual candidate JSON response, record any agreed field migrations, and compare the complete outputs.

## Source edition

The baseline is Oak National Academy's oak-curriculum-api commit eabbd67483f37cf6ceb8abb697fc44cb12aca99c. It includes 32 REST operations, the bulk export schema, all 25 matched response examples, the published GraphQL type inventory, and exact owaClient view constants. Original source paths and identities stay attached to the edition. Oak's MIT licence accompanies the source. Curriculum material can have separate content terms; this workbench preserves the published API examples supplied in the source repository.

The published GraphQL snapshot lists type names and descriptions. Its 110 relation-like entries do not contain field definitions. The REST snapshot references three error definitions omitted from that snapshot. Imported source metadata and error bodies keep these distinctions visible.

## Daily operation

1. Enter the operating engineer. Select a published example or create a new case, including a BULK case for a complete curriculum export.
2. Retain the source response and candidate response with their status, headers, body and source description. The selected source kind identifies published examples, files and captured responses.
3. In case settings, retain the actual request and choose the candidate contract edition. To receive a new contract, use Contracts & SDK → Import new edition.
4. Add explicit copy, move, omit or constant operations. Use JSON Pointers; * traverses an existing array. Each mapping records its engineering reason. Mapping previews operate on a copy of the original response.
5. Compare complete outputs. Arrays retain order by default. An explicitly configured row-key comparison treats that selected collection as unordered and rejects missing or duplicate keys. Null, absent fields, numeric strings and numbers remain different.
6. Review every difference and both contract validations. Unsupported assertions and unresolved schema references remain visible. Record an engineering decision against the current run.
7. Export the whole workspace. Receive that file in another browser to reopen the complete editions, outputs, mappings, decisions, source assets and history.

Edits after a comparison mark that comparison CHANGED. Its prior decision remains historical. A new comparison is required for a decision on the updated case. Engineering acceptance records the operating engineer's review.

## Source assets and database migration

The Sources section retains complete SQL, Drizzle, Hasura metadata, full GraphQL introspection and source notes. Every source asset has an immutable identity; a later edition uses another identity. The public name inventory supports discovery, while the installation's actual field, relation, computed-field and SQL definitions travel as their own source assets.

## TypeScript SDK

Contracts & SDK generates client.ts, types.ts and inventory.json from the selected retained edition. The client keeps HTTP status, headers, raw response text, JSON bodies and contract outcomes. Asset redirects are observed separately so bearer credentials remain on their original API request. The complete inventory retains the original contracts and generation diagnostics. See the generated client header for its usage.

## CLI

Use an existing Node.js runtime. No package install, database, hosted CI or network request is required for workspace operations.

    node cli.mjs help
    node cli.mjs summary --workspace initial-workspace.json
    node cli.mjs receive --workspace initial-workspace.json --out received-workspace.json
    node cli.mjs import-response --workspace received-workspace.json --case oak-example-01 --lane candidate --status 200 --json returned.json --source "Staging API response, retained request" --actor "Operating engineer" --out with-response.json
    node cli.mjs compare --workspace with-response.json --case oak-example-01 --actor "Operating engineer" --out compared-workspace.json

All CLI output files are create-only so a later operation cannot silently overwrite an existing edition. Use the same workspace ID when receiving its complete export. The standalone browser saves locally when browser storage is available; export regularly to retain a portable file.

## Complete receiving programme

The application download includes `complete-receiving.mjs`, `run-receiving.py` and `SDK_GUIDE.md`. Unzip the whole application into its original source directory. Use an existing Linux Python/Node runtime, TypeScript, Playwright and Chromium installation:

    python3 run-receiving.py \
      --work-dir /absolute/private/curriculum-receiving \
      --node /absolute/existing/node \
      --node-modules /absolute/existing/node_modules \
      --chromium /absolute/existing/chrome-headless-shell

`--work-dir` defaults to the source directory's `receiving/`. `--node` otherwise uses `CODEX_PRIMARY_RUNTIME_NODE` or the existing PATH. `--node-modules` can use `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. Without `--chromium`, the programme uses Playwright's already installed executable; `CURRICULUM_CHROMIUM` also selects an existing executable. It records the actual executable identity before launch.

The original course validates all 25 published responses against their pinned contracts, runs the CLI summary and exact workspace receiving, compiles the generated client and types, and opens the actual application. In the browser it saves the original published key-stage example as the candidate, compares it, records the course's engineering decision, downloads the complete workspace, SDK and application, and receives that workspace into a separate browser profile. It closes that receiving browser process and cold-reopens the same profile. Desktop and 390-pixel screenshots, full source inventory, compiler outcome, exact workspaces and actual phase receipts remain together.

The work directory belongs to one original operation. Its intent binds the source files, original workspace, any supplied bulk choices, existing runtime selections and physical working paths. Repeating the same command reuses that intent. Keep the original source and working directory available for continuation. A kernel file lock is inherited by the Node child, so loss of the Python supervisor's response cannot create a second owner while the child remains alive. `owner.json` records both process identities and the actual exit.

To interrupt that specific owner:

    python3 run-receiving.py \
      --work-dir /absolute/private/curriculum-receiving \
      --interrupt

The command opens a Linux pidfd, checks the retained process start identity, boot identity and inherited lock descriptor, and signals that bound process through the kernel handle. A stale marker does not authorize signaling another process. A legacy root-level `complete-receiving.lock` remains with its original owner for reconciliation before this lifecycle is adopted. An existing task directory owned by the same user is retained at its original path and made private. A live but unresolved owner remains available for reconciliation under its original operation.

Completed CLI/compiler/browser stages are returned only after checking their exact output files. Browser Save, Compare and Decision actions each retain their full before/after workspaces. If a click's reply is lost, the next continuation compares the actual saved browser state with the selected original model operation before adopting its outcome. A differing browser state is preserved for repair. The persistent browser profile and stable loopback origin remain in the original work directory.

Successful completion creates `Curriculum_Migration_Complete_Receiving_20261013.zip` and `delivery-result.json` inside the work directory. The archive contains the complete source, actual public receiving outputs, original input intent and a file-hashed manifest. A completed archive is verified and reused after a lost final reply. Browser profiles, locks and temporary browser state stay in the original private work directory. Continue the existing durable artifact delivery with the returned archive identity. When the selected volume is ephemeral, that existing delivery owner must save it in the same process lifetime before releasing the volume.

### Receive an actual bulk curriculum case

The default course retains the 25 published REST examples. Its `curriculum-bulk` phase reports `PENDING_INPUT` until an actual original/candidate bulk dataset has been received.

To include the Curriculum tab, export the existing complete workspace after saving an actual BULK case and both complete response bodies with `captured-http` or `operator-file` provenance. Keep the original workspace identity, source history, published contract editions and all 25 original cases. The key-stage course retains its original candidate contract selection.

Provide a separate reviewed JSON options file containing:

| Field | Required value |
| --- | --- |
| `caseId` | Exact existing BULK case ID in that workspace. |
| `namespaces.original`, `namespaces.candidate` | Explicit source identifier namespaces. |
| `mappings` | The reviewed array of exact `{kind, from, to, reason}` occurrence mappings; an empty array retains unique-identity matching. |
| `decision.outcome` | `accepted` or `changes-required`, as selected by the operating engineer. |
| `decision.note` | The substantive reason for that decision. |

Run the same programme with those actual files:

    python3 run-receiving.py \
      --work-dir /absolute/private/original-bulk-receiving \
      --chromium /absolute/existing/chrome-headless-shell \
      --workspace /absolute/retained-workspace-export.json \
      --bulk-options /absolute/reviewed-bulk-options.json

The programme drives the visible Curriculum controls, creates a plan with those exact namespaces and mappings, and records the selected decision. It retains the complete plan and every review row, verifies them through the enhanced workspace receiver, exports the whole application and workspace, and cold-reopens the independent received edition. The programme does not acquire publisher data or fill an absent response with generated curriculum content.

`SDK_GUIDE.md` includes the complete 32-operation map, request/body examples, redirects, error handling, source inventory, and the public model API for saving a published response into the workbench.

## Implementation

model.mjs contains the actual workspace, mapping, comparison, schema and receiving operations. generate-sdk.mjs derives the SDK. cli.mjs invokes those same model functions. The standalone HTML embeds the same implementation and compressed original workspace. No external scripts or stylesheets are required.

The schema evaluator implements the pinned source's assertion vocabulary, including local references, required properties, enum/union types, ordered arrays and URI formats. It reports unsupported assertion keywords explicitly when a new imported edition requires more capabilities.

## Validation performed during delivery

The real model was executed in connected V8 on all 25 original response examples. Every original example validates against its matched schema, and serialising/reopening the initial workspace preserves all 51 recorded import operations. Native CLI, generated TypeScript compilation and browser interaction results are recorded separately with the delivery when an executing host completes them.

## Curriculum dataset planning

The Curriculum tab adds complete bulk-dataset coverage and occurrence mapping to the existing case workflow. Save the original and candidate bulk responses, select their namespaces, review exact values and ordering, and retain a plan and engineering decision. Plans travel with workspace exports and are recomputed on receiving; later case or schema changes mark prior decisions stale.

The existing CLI provides `curriculum-plan`, `curriculum-report` and `curriculum-decision`. See [Curriculum migration plans](CURRICULUM_MIGRATION.md) for the operator workflow and API, and [Curriculum dataset coverage](CURRICULUM_COVERAGE.md) for the publisher reference rules and source identity details. Download application includes the modules and guides.
