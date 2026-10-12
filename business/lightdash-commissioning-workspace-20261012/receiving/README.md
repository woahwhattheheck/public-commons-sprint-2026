# Complete Lightdash commissioning receiving

This program receives the full commissioning application on the same prepared disposable Lightdash estate. It imports the exact original 189-file full-Jaffle example, edits a real business metric and its consuming chart, reviews the complete source change, runs the original dbt/Lightdash operations, compares native warehouse query results, restores a retained content backup into an owned preview, and reopens the complete customer handover.

The original operation is `SCF-LIGHTDASH-COMMISSIONING-20261012-14F5`. Keep its existing prepared estate, source selection and private host credentials. This program is a continuation on that estate, not a second provider service or payment workflow. Publication and syntax checks alone are not a native receiving result. The actual complete result is `receiving-result.json` with `state: "SUCCEEDED"` and the original native identities described below.

The original engine interface is documented in [native/README.md](../native/README.md). The application operator guide describes ordinary source editing and customer work; this guide describes the complete source-native receiving operation.

## The business change

The original example contains regional sales transactions in USD. This receiving adds **Revenue per Unit** as total selected revenue divided by total selected units, and adds both units and that metric to the original regional-sales chart. This is weighted USD per unit within each month/region group. It is not average revenue per sale, and it does not annualize six months of source data.

The candidate preserves the existing model, metric, chart slug, native space and original month/region dimensions. Its formula promotes multiplication to a fractional number and returns null for a zero-unit group. The native chart continues to include the original revenue-share table calculations and region pivot.

Two complete proposed source files are supplied:

| Relative member | Original input | Reviewed change |
| --- | --- | --- |
| `dbt/models/regional_sales.yml` | Upstream Git blob `8ae45d2e95443bc67e8ea51403b45a6b6776a915` | Add the native number metric `revenue_per_unit` beside existing total revenue. |
| `dbt/charts/regional-sales-total-row-total-demo.yml` | Upstream Git blob `98bf3dd9434ee156367d3822eb8233ddcba7f153` | Name and describe the monthly business view; add total units and revenue per unit in the metric query and table column order. |

The complete postimages live in `receiving/candidate/`. They keep the historical source timestamps as historical metadata. Promotion itself uses a fresh original native content download: the receiving program retains that current chart's IDs and timestamps, changes its reviewed business content, and seals the complete native export as part of the candidate edition. It does not use `--force` to bypass the native conflict rules.

The comparison basis comes from the actual original `dbt/data/raw_regional_sales.csv`, Git blob `ba0c5e1b23283543b23e4957fd1fc2e4431aefd4`. The program validates the whole file and computes every group, rather than asserting only a sample row.

| Source-derived expectation | Value |
| --- | --- |
| Transactions | 72 |
| Date range | 2025-01-05 through 2025-06-28 |
| Month/region groups | 18 |
| Units | 14,395 |
| Revenue | USD 1,127,250 |

These are expectations calculated from source data, not claims that a provider query has already completed. Acceptance uses the original Lightdash query result and compares all 18 native month/region groups, revenue, units and weighted USD per unit. It retains the original query UUID, complete bounded native result and original CLI CSV.

## Required original source and estate

Select all 189 files under `examples/full-jaffle-shop-demo` at upstream commit `91e610898395e6659841a321a0cee31cfcac8ae8`. The complete original tree is `aeb0d9a2ca10e24b30641c91b187b4efcae57324`, totaling 28,190,932 bytes. `receiving/upstream.json` records every actual Git blob, size and executable mode. Preparation checks the complete directory against that inventory. Do not substitute a small starter, altered CSV or hand-written table.

Keep the original upstream license files. The example's `dbt/LICENSE` is an Apache 2.0 member of the complete original inventory. The included `receiving/licenses/Lightdash-LICENSE.txt` is the exact upstream root MIT license, including its exclusions for enterprise and third-party material. The receiving source does not change those license scopes.

The host operator supplies:

- The complete final commissioning application with its original `source-manifest.json` and exact manifest SHA256.
- The complete verified original example directory, including the original executable file modes.
- Node 24, the complete original `@lightdash/cli@2.568.0` install, Python 3 and the original dbt executable with its selected PostgreSQL adapter.
- One existing prepared disposable Lightdash project, its actual native UUID, a usable private token environment reference and its warehouse environment references.
- Actual server version, dbt core/adapter versions, and resolved Lightdash/PostgreSQL image digests in a prepared-estate receipt.
- An existing actual Playwright module and browser executable.
- A persistent output directory on that same receiving host.

The upstream example profiles use `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` and `SEED_SCHEMA`. The full example journey selects `projectDir: "dbt"`, `profilesDir: "profiles"`, profile `jaffle_shop` and target `jaffle`. Its public environment-only profile files are explicitly included in the source edition. Host variable values and literal credentials are not put in the selection JSON.

The original example container entrypoint resets and seeds the backend database. Use it only when preparing a fresh disposable example estate. Never launch that reset entrypoint against a resident Lightdash database. Mutable image tags are insufficient provenance; retain the actual selected image digests and native versions. The upstream example does not declare one exclusive dbt patch version, so record the actual selected core and adapter versions rather than inventing a pin.

An existing source project may already contain native charts. The original upload handles its timestamp/conflict rules. A conflict is retained for explicit original-input recovery; the receiver does not force or overwrite unrelated content to make a demonstration pass. The final target remains the reviewed candidate. Backup restoration occurs in a separate owned preview that is stopped afterward.

## Preparation input

`selection.example.json` is a shape template. Every `REPLACE_*` value must come from the actual existing estate or source result. Preparation rejects invalid placeholders and mismatched identities before the native receiver is started.

The selection has these fields:

| Field | Meaning |
| --- | --- |
| `operationId` | The same original receiving business operation ID. |
| `appRoot` | Absolute directory containing the complete joined application. |
| `sourceManifest.file/sha256` | That directory's exact `source-manifest.json` and hash. |
| `exampleDirectory` | Absolute full original 189-file example directory. |
| `connection` | The original engine connection: actual native project/origin, runtime paths and host environment references. |
| `estate.file/sha256` | The actual prepared-estate receipt, with retained original preparation evidence. |
| `browser.moduleFile/executable` | Existing Playwright entry module and browser binary. |
| `outputDirectory` | Persistent complete receiving output, outside application/example source. |
| `operationTimeoutMs` | Optional per-operation receiving wait; default 7,200,000 ms. This does not replace native admission. |

The prepared estate uses schema `lightdash-commissioning.prepared-estate.v1`. It binds the same operation, origin and project UUID; declares the actual estate disposable; records server/dbt/adapter versions; and records image rows `{role, reference, digest}` for roles `lightdash` and `postgres`. The digest must be the actual `sha256:...` image digest.

Its `evidence` rows are `{file, bytes?, sha256}` for retained original preparation logs or command results. The program verifies their complete bytes. It does not infer that a new image was started from a version string alone. `estate.example.json` shows this schema without pretending to be a completed estate receipt.

The receiver prepares a create-only `receiving-input.json`. It binds the complete application manifest, normalized runtime fingerprints, actual example inventory and license, original estate evidence, browser fingerprints and output path. Keep that file unchanged for every resume.

## Run the complete original operation

Use the current prepared host and its normal admission/ownership mechanism. These source commands do not start another host or implement another capacity queue.

First set task-specific shell variables to the selected paths. They do not change `HOME` or the original CLI account location:

```bash
LDW_APP=/absolute/complete/lightdash-commissioning-workspace-20261012
LDW_SELECTION=/absolute/private/lightdash-receiving-selection.json
LDW_NODE=/absolute/selected/node
```

Then invoke this complete preparation/launch stanza. It uses the returned original command array directly and derives the receiving input identity from its actual saved bytes:

```bash
"$LDW_NODE" --input-type=module - "$LDW_APP" "$LDW_SELECTION" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const [appRoot, selectionFile] = process.argv.slice(2);
const {prepareReceiving} = await import(
  pathToFileURL(path.join(appRoot, 'receiving/prepare.mjs')).href
);
const selected = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
const prepared = await prepareReceiving(selected);
console.log(JSON.stringify({phase: 'PREPARED', ...prepared}));
const [executable, ...args] = prepared.command;
const child = spawnSync(executable, args, {stdio: 'inherit', env: process.env});
if (child.error) throw child.error;
process.exitCode = child.status ?? 3;
NODE
```

The original standalone prepare command is also available:

```bash
"$LDW_NODE" "$LDW_APP/receiving/prepare.mjs" --selection "$LDW_SELECTION"
```

It returns `file`, `bytes`, `sha256`, `workspaceDirectory` and the exact executable `command` array. The command starts `receiving/host.py` with `--input` and `--input-sha256`. Do not run `receive.mjs` without that original host: the Node receiver requires the verified inherited whole-operation lock.

The source uses only the existing host's runtime and its complete installed CLI/browser dependencies. It does not run npm inside an edition, install another server, fund an account or borrow another receiving operation's private identity.

## What the one receiving operation does

The stages share the same durable journal and workspace:

1. Verify the complete app, original example, native/runtime/profile selection, estate evidence and browser identities.
2. Create or reopen the same original commissioning workspace; save its explicit private connection and full-example source settings.
3. Import the complete original example through the real browser intake and verify the resulting baseline edition against all original files.
4. Inspect the selected original Lightdash account/project/server and download the target's original core content.
5. Plan and run the actual original dbt build through the application UI. The receiving program deliberately drops one accepted execute response and recovers the same operation UUID. It does not submit a second build to hide the lost response.
6. Run the original baseline compile/deploy, upload the original example content through the native content interface, and download current native content for an exact editing basis.
7. Create a draft, edit the real regional-sales metric and chart through the actual editor, include the complete current native content export, seal the candidate and review the full change set. Retain desktop/mobile views of that source review.
8. Start the owned candidate preview using the original CLI; retain its exact project UUID, validation job and deployment results.
9. Execute the reviewed native chart and compare every returned monthly group against the whole original CSV. Download the preview's original content.
10. Deploy the reviewed candidate to the explicitly selected disposable source project. Promote its current native chart/content with an original complete target backup and native conflict handling.
11. Run the promoted chart through the actual Lightdash engine, compare all 18 groups, retain the current native chart and complete results, and run native validation.
12. Stop only the candidate preview proved by its original start operation.
13. Start a separate owned empty preview using the original baseline source. Restore the retained before-promotion native content backup there. Read back its original chart, execute its original baseline query, compare the native revenue groups and stop that exact restore preview.
14. Produce the complete application handover under one explicit stable handover ID. Include complete source editions/drafts and reusable native content while keeping operator-private observations private by default.
15. Drain/close the original browser, HTTP service and workspace. Reopen the same workspace and confirm original editions, source hashes, review and native operation identities.
16. Reopen the completed original query without a new query POST. Reopen the exact same complete handover archive, download it through the actual application route and compare every byte by length/SHA256.
17. Verify the original whole archive through the application's own package verifier and extract every declared member into one create-only receiving directory. Keep its exact extraction receipt before opening the included application and detached SQLite copy.
18. Open that included application and confirm all original editions, complete draft overlays, reviews, terminal native IDs and reusable content. Reopen the completed query and inspect its historical result without private journals or a provider request; the terminal result remains intact. Retain an actual browser view of this receiving copy.
19. Save the complete receiving result only after native stages, both original and portable reopening, handover byte comparison and closure succeed.

The native engine retains exact accepted project/job/query identities. The receiver never treats a source edition ID or an operation-storage folder ID as a native provider UUID.

## Interrupted work and original result reopening

The whole Python host takes a permanent `control/receiving.lock`. It records the input identity before launching the original Node receiver, and the same descriptor is inherited by native CLI/dbt descendants and the packager. If that lock is still owned, a second call reports the existing run instead of acquiring a second writer. A process-receipt write or fsync failure after child creation still drains that acquired child before the host releases its original descriptors.

Use the exact original selection and preparation/launch stanza again after an interruption. The create-only prepared input, same workspace, stable stage UUIDs and native operation receipts are reused. Do not rename the output directory, edit its input hash, choose a new operation ID, remove a lock inode or reinitialize a partly completed workspace.

The receiver saves each stage selection before dispatch. On reopen it checks the original workspace and native receipts. It recovers an already-saved edition or review from its exact source basis. It reconciles an accepted native operation before any continuation. Uncertain or failed provider mutations remain visible as that original operation's recovery state; they are not silently rerun.

Completed-result replay reopens the retained handover and original result. It does not repeat a provider command merely to update a receipt timestamp. A later user-selected draft or changed source/runtime/input is not overwritten to match the receiving program.

The portable leg uses `receiving/handover.py` to call the included original `read_request` and `check_archive` functions. It accepts exactly the manifest's regular files and their byte/hash/executable identities, never replaces a completed member, and resumes only matching partial bytes. Its original `open-intent.json` is durable before SQLite opens. Later receiving retries preserve the copied database's local inspection history while rechecking the immutable application, editions and content; they do not extract over an opened database. The copied workspace stays connection-detached, and historical Inspect records `ORIGINAL_NATIVE_JOURNAL_UNAVAILABLE` separately from the preserved successful native result.

The controlled lost execute response is limited to the local application HTTP reply. The actual original command, operation UUID and provider behavior remain unchanged. Its observed accepted/dropped/recovered state is retained in `lostExecute`, allowing an actual result to distinguish the exercised failure from a source-only intention.

The native adapter handles incomplete deployment/validation/query output according to the pinned original APIs. In particular, completed deploy sessions disappear on the server; a missing session does not authorize a new finalize call. See the original engine guide for those recovery boundaries.

## Retained complete output

The persistent output root contains:

| Path | Purpose |
| --- | --- |
| `receiving-input.json` | Exact immutable application/example/estate/runtime/browser selection. |
| `control/request.json` | Original complete host identity and input SHA256. |
| `control/receiving.stdout.log` and `control/receiving.stderr.log` | Original host-owned complete receiving output. |
| `receiving-state.json` | Saved stage intents, stable UUIDs, completed results and precise incomplete state. |
| `receiving-result.json` | Actual final or interrupted result, native identities, complete handover and claims. |
| `workspace/` | Original SQLite workspace, complete source editions, draft/history, reviews, native operations and content artifacts. |
| `received-handover/` | Create-only extraction selection/receipt, opening intent, included application and detached receiving SQLite workspace. |
| `source-review-desktop.png`, `source-review-mobile.png`, `reopened-handover-desktop.png`, `received-handover-desktop.png` | Actual source-review, original reopen and portable receiving views. |

A successful result includes the actual baseline/candidate/review identities, complete original source basis, native source/preview/restore project UUIDs, original operation IDs and accepted query results, all expected groups compared against native data, stopped-preview outcomes, exact reopened workspace identities, whole handover identity, the detached recipient's preserved native results and actual screenshot paths.

The handover result is `{id, state: "SUCCEEDED", archive: {path, bytes, sha256}, memberCount, ...}`. The native module's content manifests use `scope: "native-content"` for reusable core chart/dashboard/space files; operator logs, private paths, original API diagnostics and query evidence remain in the operator workspace unless the operator explicitly asks for the private handover edition.

This program verifies the original native application and data workflow. It does not claim full organization backup, database rollback, customer commercial acceptance, partner enrollment or production commissioning from the disposable example result.

## Source and verification status

The original source selection, complete candidate, preparation program, host, fixture comparator and receiver are fully authored. The first complete source cohort passed actual Node module syntax and Python AST checks. The later lifecycle and portable-receiving corrections require the current source's syntax result before that validation claim is extended to them. Those checks do not import the selected CLI on the prepared host, create a Lightdash project, query PostgreSQL or exercise the browser. The sole complete receiving result remains the authoritative native outcome.

Read the actual original application source manifest and final receiving result before promoting native completion into a customer or grant claim. A source package remains useful before that result, but it must be described as source delivery with native receiving in progress.
