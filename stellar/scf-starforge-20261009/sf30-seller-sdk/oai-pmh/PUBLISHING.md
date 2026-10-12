# Publish a reviewed OAI-PMH repository edition

This publisher takes the original repository workbench's completed, reviewed export through the existing SF30 dataset engine, durable dataset publisher, SF82 merchant releases and SF88 customer handoff. The original capture, review, mapping, raw responses and publisher candidate travel together.

The Python repository workflow is documented in [README.md](README.md). This guide starts with its existing native build and continues through a running merchant and its next edition.

## One retained operation and its stores

Use one private directory for each original role:

| Directory | Original owner and contents |
|---|---|
| Repository workspace | Python OAI operations, attempts, response bodies, reconciled editions, mappings and native builds |
| Source export | Exact source.json and its complete capture/ directory |
| Publisher workspace | Existing durable publisher SQLite state, immutable plans, extraction candidates, reviews and publication outcomes |
| Dataset version directory | Existing SF30 version writer, snapshots and live refresh control |
| Prepared release package | Original five serving files plus the complete declared source closure |
| Merchant release store | Existing SF82 staged releases, generation selection, running merchant, receiving and customer console |

Create private parents with the operator's normal mode 0700 and use mode 0600 for JSON input files. The publisher requires canonical absolute paths without symlink components for retained source and state. It creates its new files privately and preserves existing permissions.

The repository workspace and the publisher have separate, useful reviews: the first records reconciliation of the source population; the second binds a concrete extracted candidate to the original dataset target. Each review remains attached to its original operation.

## 1. Export the original reviewed native build

Run from this oai-pmh directory with the same Python workspace used for acquisition:

~~~sh
python cli.py --workspace /private/repository-workspace export-source \
  --build ORIGINAL_BUILD_ID --out /private/repository-export
~~~

The source reader accepts the exact output:

- source.json uses schema stellar-forge.oai-pmh-source.v1, one capture connection and the fixed records query.
- capture/capture.json binds every member by its original byte count and SHA-256.
- The manifest retains repository identity, selection, completed operation/attempt, reviewed edition, active/deleted counts and the original native build.
- data.csv and dataset.json are the original XML workbench's SF30 dataset output.
- mapping.json, lineage.json, records.jsonl and requests.jsonl retain the conversion and source history.
- pages/ retains exact XML response bytes; http/ retains exact additional HTTP response bodies, including error responses.

The reader inventories the full capture and verifies every declared member. It rejects missing, extra or changed files, unsafe paths, a mismatched reviewed edition, and a native snapshot or row count that differs from the original build. Deleted source records stay in the lineage and source population; the serving dataset has one row for each active reviewed record.

Create the publisher with its source and a new dataset version directory:

~~~sh
node publisher/cli.mjs init \
  --dir /private/repository-publisher \
  --source /private/repository-export/source.json \
  --target /private/repository-versions

node publisher/cli.mjs source --dir /private/repository-publisher
~~~

Keep the returned source hash, native columns, row count, snapshot, repository selection and review visible when choosing the publication plan.

## 2. Save a complete extraction plan

A private plan JSON document has this form:

~~~json
{
  "title": "Reviewed repository edition",
  "query": "records",
  "input": {},
  "sourceHash": "SHA256_FROM_THE_SOURCE_COMMAND"
}
~~~

Use the exact source hash returned by the previous command. For a later exported capture, also supply its absolute sourceFile in this plan; the same publisher keeps all editions and one target. Save the plan:

~~~sh
node publisher/cli.mjs plan \
  --dir /private/repository-publisher --input /private/plan.json
~~~

The returned numeric id identifies the original saved plan. The plan retains its own exact copy of the source and the complete capture, so later changes to the export directory cannot change an already selected candidate.

All declared fields and native types are carried through. The only optional publication selection is an existing native sort, for example input.sort set to an enabled column name, or that name prefixed with a minus sign for descending order. The original engine retains null ordering and ties. Filtering, field removal and new conversion expressions belong in an explicitly reviewed original mapping/build.

Optional extraction settings are maxRows, maxBytes, pageRows and timeoutMs. Defaults follow the captured dataset, with pages at most 250 rows and a five-minute extraction deadline. The original engine's bounds apply: at most one million rows, 256 MiB CSV, 1,000 rows per native page, and the source's configured page/cell limits. A large page is retried at a smaller native limit with the same cursor. Oversized individual cells or pages return the original error.

If dataset is supplied in a plan, it must describe the same original dataset declaration. Most operators should omit it and retain the workbench's configuration.

## 3. Extract, inspect and publish in the original version store

Start one extraction with its returned numeric plan ID:

~~~sh
node publisher/cli.mjs extract \
  --dir /private/repository-publisher --plan 1
~~~

The command waits for completion. It returns the run UUID, state and complete candidate metadata. Use --id with an existing chosen UUID only when starting that original operation; an already retained UUID is reported instead of creating another population. Ctrl-C records cancellation in the same workspace. A failed extraction returns a nonzero process result and its retained error state.

The extraction follows the original dataset's cursors unchanged, verifies total/returned rows and snapshot on every page, and writes every selected row to the generic publisher's candidate CSV. Original primitive types are retained, including nullable cells, exact strings and negative zero. The candidate's native snapshot is recorded separately from the original captured snapshot because CSV serialization or an explicit native sort can produce a new byte representation.

Inspect the same run and current target:

~~~sh
node publisher/cli.mjs inspect \
  --dir /private/repository-publisher --id RUN_UUID --query "limit=20"

node publisher/cli.mjs candidate \
  --dir /private/repository-publisher --id RUN_UUID

node publisher/cli.mjs target --dir /private/repository-publisher
~~~

For a new target, the review JSON contains:

~~~json
{
  "reviewer": "Operator name",
  "note": "Reviewed the retained repository selection, source population, field mapping and extracted candidate.",
  "initialize": true
}
~~~

For an already running target, replace initialize with expectedSnapshot and expectedRevision copied from the current target response. The original publisher checks the complete native query contract and exact current version before accepting a refresh review.

~~~sh
node publisher/cli.mjs review \
  --dir /private/repository-publisher --id RUN_UUID --input /private/review.json

node publisher/cli.mjs publish \
  --dir /private/repository-publisher --id RUN_UUID --review REVIEW_UUID
~~~

The review UUID is returned in data.review.id. Publication initializes the original version store or calls its existing managed refresh control. The successful run has state PUBLISHED and retains the snapshot and revision.

If a process stopped during publication, reopen this same publisher and run recover with the same UUID. Recovery checks the original target/candidate and records its observed outcome. The status command includes plans, runs and event history with independent offsets for each population:

~~~sh
node publisher/cli.mjs recover --dir /private/repository-publisher --id RUN_UUID
node publisher/cli.mjs status --dir /private/repository-publisher --limit 25 --runs-offset 25
~~~

## 4. Prepare the original merchant dataset package

Use the same published candidate and its original version directory. A private release JSON document supplies:

| Field | Value |
|---|---|
| runId | Original PUBLISHED run UUID |
| directory | New absolute prepared-package directory |
| payment | Existing public SF30 payment terms: scheme, network, asset, amount, payTo and optional maxTimeoutSeconds |
| origin | Operator's canonical HTTPS public origin |
| path | Fixed resource path; defaults to /records |
| expectedCandidateDigest | Optional exact candidateDigest shown during inspection |

Payment terms come from the operator's configured merchant. They are the public offer terms, and are validated by the original SF30 seller compiler.

~~~sh
node publisher/cli.mjs release-prepare \
  --dir /private/repository-publisher --input /private/release.json

node publisher/cli.mjs release-inspect --package /private/repository-package
~~~

The package contains the original five serving files:

| File | Purpose |
|---|---|
| dataset.csv | Exact completed candidate CSV |
| dataset.json | Same candidate declaration with its adjacent dataset.csv filename |
| seller.json | Original SF30 dataset offer and handlers, including native snapshot selection |
| binding.json | Original SF82 dataset contract, baseline snapshot, source hash and exact version-directory binding |
| source.json | OAI publication provenance plus explicit sourceFiles descriptors |

Its sourceFiles closure also preserves:

- oai-source.json: exact original exported source declaration.
- publisher-plan.json: exact immutable extraction plan.
- publisher-candidate.json: exact complete candidate manifest.
- publisher-dataset.json: exact candidate dataset configuration.
- publisher-publication.json: the original completed run, review and publication record.
- capture/capture.json and every original raw response, dataset, mapping, request, record and lineage member.

Preparation copies large files with a bounded buffer and verifies their original lengths and hashes. A source or publication change fails the operation. A retry against the same completed package reopens it and returns reused: true. An existing different package returns a conflict so its original source remains available.

The prepared package is independent of the live source export and immutable publisher plan files. Its binding still identifies the same original dataset version store. Staging and receiving retain that binding; operating the merchant requires the declared original version store at that canonical path.

## 5. Stage, run and deliver through the original SF82/SF88 workflow

The publisher's release command delegates directly to the existing SF82 command line, including its dataset-package support:

~~~sh
node publisher/cli.mjs release init --store /private/repository-releases

node publisher/cli.mjs release stage \
  --store /private/repository-releases \
  --id repository-edition-1 \
  --dataset-package /private/repository-package \
  --port 8423

node publisher/cli.mjs release inspect \
  --store /private/repository-releases --id repository-edition-1

node publisher/cli.mjs release status --store /private/repository-releases
~~~

Supply the merchant's existing facilitator options to stage when its payment setup requires them. The original command validates those options and retains the runtime configuration. Use the current generation from status to select the exact release:

~~~sh
node publisher/cli.mjs release activate \
  --store /private/repository-releases \
  --id repository-edition-1 --expect CURRENT_GENERATION \
  --reason "Publish the reviewed repository edition"

node publisher/cli.mjs release run --store /private/repository-releases
~~~

The foreground merchant runs the existing versioned dataset seller with its original native handlers and managed loopback refresh control. The original lifecycle owns readiness, graceful termination, source reopening and release generation selection.

Use the same merchant console for source comparison, receiving, customer export, discovery and subsequent activation:

~~~sh
node publisher/cli.mjs release console --store /private/repository-releases
~~~

The complete source closure is included in the original SF82 release manifest and execution identity. The existing retained-release receiving flow copies all listed members and verifies them on reopening. Original publishers without sourceFiles keep their existing five-file behavior and identity.

For a selected running snapshot, the original SF88 dataset handoff remains available from this publisher:

~~~sh
node publisher/cli.mjs buyer-offer \
  --dir /private/repository-publisher --id RUN_UUID \
  --seller ORIGINAL_SELLER --resource EXACT_RESOURCE --query "limit=50"

node publisher/cli.mjs buyer-prepare \
  --dir /private/repository-publisher --id RUN_UUID \
  --seller ORIGINAL_SELLER --resource EXACT_RESOURCE \
  --input /private/buyer-selection.json
~~~

Use the original offer and buyer selection returned by the existing handoff workflow. The publisher checks the running target's advertised resource and snapshot selection, retains the resulting buyer configuration, and records its offer/config hashes and original intent ID. The original buyer flow owns payment, admission and subsequent cursor pages.

## 6. Carry the next repository edition forward

Continue harvesting and reconciling in the same Python repository workspace. Preserve its actual incremental selection, deletion semantics, attempt history and record-level correction decisions. Build and export the new reviewed edition through the original XML/SF30 engine.

Export the next build to a new private source-export directory. Inspect it with source --dir /private/repository-publisher --source /private/next-export/source.json, then save a plan containing that exact absolute sourceFile and its displayed sourceHash. The existing publisher retains the new source inside a new immutable plan, keeps the full earlier plan/run history and uses the same original target. Omitting sourceFile selects the workspace's initial source. Each plan records which original export was selected.

Review the new candidate against the currently running original target's snapshot/revision, then publish through managed refresh. Existing cursors and explicit snapshot selections remain governed by the original version engine. When seller terms, resource path or serving configuration change, prepare a new release package, compare it in the same SF82 store and activate with the displayed generation.

## Interfaces and source ownership

- source.mjs: complete capture verification and the original immutable dataset source adapter.
- publisher/driver.mjs: original durable publisher plan/extraction driver.
- publisher/model.mjs: the generic candidate/review/publication store with complete OAI capture checks.
- publisher/release.mjs: prepareOaiRelease(publisher, input) and inspectOaiRelease(directory).
- publisher/cli.mjs: main(args), operator commands and unchanged SF82 CLI delegation.
- handler-runtime.mjs: entry point forwarding to the original SF82 dataset runtime.

The generic optional source closure is implemented in SF82 release-dataset.mjs and the existing Socrata publisher. The same source descriptors support OAI, Census, Geocodio and other original dataset providers without introducing a second query engine or candidate store.
