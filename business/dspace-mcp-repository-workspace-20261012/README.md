# DSpace Repository Workspace

A retained operator workflow for 4Science's original DSpace MCP server: discover repository records, preserve their full metadata and source responses, review exact changes, execute the original actions, recover interrupted operations, and reopen the same complete handover.

## Start

Use Node 24 or newer and npm. From this directory:

```sh
npm run bootstrap
node server.mjs --workspace /absolute/path/to/repository-workspace --port 0
```

Open the local address printed by the server. The workspace is stored in the directory you choose. The source folder and retained workspace are separate, so updating the code does not overwrite repository history. The server listens on 127.0.0.1. Keep it local or use your organization's established authenticated remote-access method.

Bootstrap installs the exact upstream production dependency lock with package scripts disabled, verifies the included upstream Git identities, and transforms the original TypeScript using Node. Generated `vendor/dspace-mcp/node_modules` and `dist` are rebuildable. No cloud service is needed to browse saved source or reopen a handover.

The original pinned upstream has 15 registered tools. Its README table lists 14; this workspace discovers the actual SDK inventory, including the original entity-type-checked move operation.

## Connect an institution

Create a named profile with its exact DSpace REST base URL, for example `https://repository.example.edu/server`. Enter environment variable **names** for the token or username/password references. Set the corresponding values in the server process using your normal secret manager. The default names are `DSPACE_TOKEN`, `DSPACE_USER`, and `DSPACE_PASSWORD`. Empty names create an explicitly anonymous read profile.

The actual DSpace user UUID is captured from the native session. A staff actor label records who operated the workspace; it does not replace the repository's permissions. Existing plans and executions stay attached to their original repository and user even after you select another profile. To change a repository or credential reference, save a successor profile.

## Operator workflow

1. Capture native communities, collections, search results, a full item, draft submissions, or file content. Retain complete original response bodies and metadata arrays. Search pages remain individually inspectable.
2. Select the exact source objects you want to review. A selection identifies repository, native UUID, object type, and original capture. Titles never act as identity keys.
3. Prepare the exact metadata, collection, file, draft, or archive plan. Preview every touched field. Named review records the approved source and intended change.
4. Apply through the unchanged original MCP action. The workspace records the intent before dispatch and re-reads the relevant native fields and repository user. Changed staff fields produce a corrected-plan workflow.
5. Recover an interrupted execution from its original target and native responses. Successful POST identities, complete pre-dispatch inventories, and exact received file bytes distinguish a completed operation from a second upload. Remaining undispatched steps continue only after preceding steps are reconciled.
6. Produce a new reviewed reversal for accepted metadata or collection changes. Unrelated staff edits survive. Corrected target fields require a new explicit plan.
7. Download the complete handover and open it in a fresh workspace. It contains source JSON, metadata, selections, plans, native responses, file bytes, actor history, and execution identity. Credentials stay in environment references.

The full screen-by-screen guide is [WORKFLOW.md](WORKFLOW.md).

## Important repository semantics

A normal workspace submission is a draft governed by the institution's configured submission sections. An administrative create-item operation archives immediately. They are distinct operations in the interface and plan.

DSpace submission section names are configurable. The pinned upstream's optional initial draft metadata helper uses `traditionalpageone`. For another submission configuration, create an empty draft, read its original sections, and use the exact native section paths in a reviewed update. Interrupted creation retains the created draft identity so it can be completed without a second creation.

Metadata arrays retain language, authority, confidence, order, and all original native properties. DSpace may supply default null authority/language, confidence -1, and generated place values; verification compares native value semantics while preserving the exact original objects. Generated `virtual::` values belong to linked entities: the workspace preserves them while allowing ordinary values in the same field to be edited. Use the original linked record for generated-author changes.

The supported workload is 500 selected original objects, 100 reviewed steps per execution, and 20 MiB per received file. Larger source libraries can be captured and inspected in pages; use separate meaningful reviewed cohorts when applying more than 100 steps. Original inventories page completely up to 10,000 entries and report an explicit inconsistent or oversized inventory.

## Exact source import and command line

Browser source import accepts `dspace-source-capture/v1` JSON with original response bodies. The included public-reader bundle contains 25 preserved HAL JSON bodies and the complete 44-item Publications 2 cohort. Its provider did not expose HTTP status, wire headers, or per-request retrieval times; those remain null. The capture retains that provenance and the exact submitted source-bundle bytes.

The command line uses the same workspace, native bridge, revision guard, and operation history:

```sh
node scripts/cli.mjs state --workspace /absolute/path/to/repository-workspace
node scripts/cli.mjs import-source --workspace /absolute/path/to/repository-workspace --source source-captures/public-reader-source.json --actor "Repository operator" --operation-id source-intake-001
node scripts/cli.mjs action --workspace /absolute/path/to/repository-workspace --action prepare-plan --input reviewed-request.json
node scripts/cli.mjs read --workspace /absolute/path/to/repository-workspace --kind plans --id PLAN_ID
node scripts/cli.mjs export --workspace /absolute/path/to/repository-workspace --kind handoff --id current --output /absolute/path/to/DSpace_Workspace.json.gz
```

An action input file contains actor, stable operationId, revision, and the actual action payload. Reuse that exact file after an uncertain client response; do not generate another operation ID. The command line can also hydrate a native source manifest's relative body/file paths, verifies its original digests, and retains the original manifest text and hash.

See [API.md](API.md) for the same documented programmatic contract.

## Source, operation, and support

Original upstream: [4Science/dspace-mcp](https://github.com/4Science/dspace-mcp/tree/ee503ba97910f592867c897c1fa938f9e029d03c). Complete module source: [public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/business/dspace-mcp-repository-workspace-20261012/).

Read [NOTICE.md](NOTICE.md) and the included original [AGPL license](vendor/dspace-mcp/LICENSE). Commercial implementation scope and receiving terms are in `commercial/`.

