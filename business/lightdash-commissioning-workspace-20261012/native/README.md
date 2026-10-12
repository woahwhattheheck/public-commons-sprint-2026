# Original Lightdash engine integration

This adapter connects the commissioning workspace to the original dbt executable and Lightdash CLI 2.568.0. It owns the selected native command, its source edition, the provider project identities, complete command results and interrupted-operation recovery. The workspace remains the source editor and operator interface; dbt and Lightdash perform compilation, warehouse execution, validation, content handling and chart queries.

The supported upstream source is [lightdash/lightdash at 91e610898395e6659841a321a0cee31cfcac8ae8](https://github.com/lightdash/lightdash/tree/91e610898395e6659841a321a0cee31cfcac8ae8). See [the whole receiving guide](../receiving/README.md) for the actual full-example operation and its required estate selection. Source syntax checks do not establish a successful provider run.

## Host and source selection

Use Linux, Node 24, Python 3 with POSIX `flock`, the original installed `@lightdash/cli@2.568.0` and the selected original dbt executable with its actual adapter. Keep the CLI's complete normal package dependencies. The adapter verifies the selected executables, package version and original modules before a command can begin. The portable input records actual installed hashes; it does not substitute source files into the installed CLI.

The original CLI uses `os.homedir()/.config/lightdash/config.yaml`. It has no supported `--config` or `LIGHTDASH_CONFIG_DIR` option. This implementation keeps that native location and serializes its own CLI operations through a permanent configuration lock. Do not change `HOME` to manufacture an isolated native account. Use the explicit host environment references below and preserve the original CLI configuration for recovery.

A connection is private merchant/operator configuration:

```json
{
  "id": "lightdash-disposable-receiving",
  "origin": "https://lightdash.example.invalid",
  "projectUuid": "REPLACE_WITH_ACTUAL_PROJECT_UUID",
  "tokenEnv": "LDW_LIGHTDASH_TOKEN",
  "proxyAuthorizationEnv": "LDW_LIGHTDASH_PROXY_AUTHORIZATION",
  "allowHttp": false,
  "runtime": {
    "node": "/absolute/selected/node",
    "cliEntry": "/absolute/installed/node_modules/@lightdash/cli/dist/index.js",
    "python": "/absolute/selected/python3",
    "dbt": "/absolute/selected/dbt"
  },
  "environment": {
    "PGHOST": "LDW_PGHOST",
    "PGPORT": "LDW_PGPORT",
    "PGUSER": "LDW_PGUSER",
    "PGPASSWORD": "LDW_PGPASSWORD",
    "PGDATABASE": "LDW_PGDATABASE",
    "SEED_SCHEMA": "LDW_SEED_SCHEMA"
  }
}
```

Replace the example paths, origin and native UUID with the actual selected estate. Omit `proxyAuthorizationEnv` when the host has no separate proxy authorization. Values on the right of `environment` are names of existing private host variables, not database passwords. The origin contains no embedded credentials, query, fragment or extra path. Plain HTTP is accepted only when the private host connection explicitly sets `allowHttp: true`. An undeclared ambient agent connection or incompatible saved proxy/source selection is rejected.

For a selected native dbt source, an optional `source: {name, uuid}` records its actual native name and UUID. This is distinct from the Lightdash project UUID and from a source edition.

An edition is a complete immutable file inventory:

```json
{
  "id": "edition-from-the-original-workspace",
  "directory": "/absolute/workspace/editions/selected/source",
  "manifestFile": "/absolute/workspace/editions/selected/manifest.json",
  "manifestSha256": "REPLACE_WITH_ACTUAL_MANIFEST_SHA256",
  "sourceSha256": "REPLACE_WITH_ACTUAL_SOURCE_SHA256",
  "projectDir": "dbt",
  "profilesDir": "profiles",
  "profile": "jaffle_shop",
  "target": "jaffle"
}
```

The manifest has `files: [{path, bytes, sha256, executable?}]`. All paths are relative to its complete directory. Verification compares the complete actual regular-file inventory, rejecting missing, additional, changed and symbolic-link members. When the manifest is inside the selected directory, that manifest itself is excluded from the file inventory to avoid a recursive self-hash.

The full upstream example has both `dbt/` and a sibling `lightdash/models/`. Its dbt journey must select `projectDir: "dbt"`, not the common parent. The original native project detector treats a directory containing Lightdash YAML models differently.

### Private host profiles

A private host may keep credential-bearing profiles outside source editions. Use:

```json
{
  "profiles": {
    "directory": "/absolute/private/dbt-profile",
    "manifestFile": "/absolute/private/dbt-profile-manifest.json",
    "manifestSha256": "REPLACE_WITH_ACTUAL_PRIVATE_PROFILE_MANIFEST_SHA256"
  }
}
```

The exact host inventory must include `profiles.yml`. The adapter verifies that inventory before execution and passes its original directory to dbt/Lightdash. It does not copy those private profile bytes into the edition. Keep the containing profile directory and manifest under operator custody. The workspace defaults to omitting profile files from ordinary project intake; the receiving program explicitly includes the public example's two environment-only profile files to preserve all 189 original files.

A preview with `warehouseCredentials: "profiles"` uses the original CLI flow that supplies selected warehouse credentials to the selected disposable Lightdash estate. The planned effect records that behavior. `"copy-upstream"` instead uses the native upstream-credential flow. In the latter case the adapter first performs a full original compile because the CLI's `--no-warehouse-credentials` also implies skipping dbt compilation and the warehouse catalog.

## Public JavaScript contract

The application imports `native/index.mjs`:

```js
import {
  describeEngine,
  planOperation,
  executeOperation,
  inspectOperation,
} from './native/index.mjs';

const engine = describeEngine();
const operation = await planOperation({
  operationId,
  action,
  connection,
  edition,
  input,
});
const result = await executeOperation({
  workspaceDir,
  operationDir,
  operation,
});
const observed = await inspectOperation({
  workspaceDir,
  operationDir,
  operation,
  refresh: true,
});
```

`planOperation` returns the exact immutable normalized plan with `schema`, `operationId`, `action`, `upstream`, `connection`, `edition`, `input`, `effects`, `commands` and `digest`. The plan fixes runtime/source/profile/content hashes, the explicit project UUID and each requested native effect.

`executeOperation` stages the original plan and permanent operation locator, verifies its selection and enters the Python-owned native lifetime. A completed same-operation result reopens with `replayed: true` after its identity is checked. It does not repeat the command.

`inspectOperation` defaults to local status. Explicit `refresh: true` reconciles the same original operation through supported native reads. The workspace's Inspect action supplies this flag; ordinary UI state loading does not silently start remote readback.

Both execution and inspection require `operationDir` inside the owning `workspaceDir`. They do not create a separate job queue or allocate another host.

## Native actions and inputs

Each action accepts an optional `resumeOf` naming a retained prior operation. This is an explicit reviewed continuation; it does not erase or rewrite the prior operation.

Before the new operation's original command is dispatched, its saved continuation receipt must still match the prior result bytes and SHA256, the prior state must still be incomplete, and the prior kernel lease must be free. An intervening reconciliation of that prior operation requires review of the current result. Read-only preflight or local dependency preparation does not waive that check on reopen. Once the new operation has dispatched its own original command, recovery follows that command's own retained history.

| Action | Selected input | Native behavior |
| --- | --- | --- |
| `inspect` | No action-specific fields | Original health, account and exact project observation. |
| `dbt-deps` | No action-specific fields | Original `dbt deps` for the selected project and profile. |
| `dbt-build` | `select`, `exclude`, `vars`, `threads` | Original warehouse build, including the selected seeds and models. |
| `compile` | The same dbt selection fields | Original Lightdash compile with selected dbt/profile paths. |
| `start-preview` | `name`, `expiresInHours`, `skipCopyContent`, `warehouseCredentials`, optional exact prior `startOperationId`/`previewProjectUuid`, plus dbt selection | Original retained `start-preview`, native creation/reuse rules, compile/deploy and resulting preview identity. |
| `stop-preview` | `name`, exact `previewProjectUuid` and its `startOperationId` | Stop only the preview proved by that original creation operation. |
| `validate` | `projectUuid`, preview `startOperationId` when applicable, `severity`, `only`, plus dbt selection | Original scheduler-backed validation and retained job UUID. |
| `deploy` | `projectUuid`, preview `startOperationId` when applicable, plus dbt selection | Original batched deploy and original fallback behavior. |
| `download` | `projectUuid` and preview owner when applicable | Original complete visible charts, dashboards and spaces export. |
| `upload` | Exact `content` selection, `projectUuid` and preview owner when applicable; `applySpaceAccess` | Complete target backup, original content upload/conflict handling, then target readback. |
| `run-chart` | `chartPath`, `projectUuid` and preview owner when applicable, `limit`, `pageSize` | Original YAML chart query, accepted native query UUID, native result and original CSV encoder. |

`threads` is 1–8, default 2. A preview expires in 1–720 hours, default 24. Validation defaults to error severity and tables/charts/dashboards; its supported target set also includes apps. The connection project is the default target. A different target requires the exact retained preview creation operation.

An upload content selection has:

```json
{
  "directory": "/absolute/retained/content",
  "manifestFile": "/absolute/retained/content-manifest.json",
  "manifestSha256": "REPLACE_WITH_ACTUAL_SHA256",
  "sourceProjectUuid": "REPLACE_WITH_ACTUAL_NATIVE_SOURCE_UUID",
  "sourceOperationId": "original-completed-download-operation"
}
```

Exactly one of `sourceOperationId` or `sourceEditionId` is required. The latter binds content to a complete reviewed immutable source edition. This permits editing a current native content export, preserving its native chart/space IDs and timestamps, then promoting that reviewed content through the original CLI. It does not treat a source-folder UUID as a provider UUID.

For run-chart, `chartPath` selects a real YAML member of the immutable edition. The native CLI's current result reader uses one requested result page. The adapter therefore requires `1 <= limit <= pageSize <= 5000` and retains that bounded result without claiming unbounded pagination. The full regional-sales journey has 18 actual groups and uses a limit/page size of 500.

## Ownership, recovery and shutdown

The Python host owns a permanent operation `flock` and a separate permanent lock for its original CLI configuration. Locks are regular files whose inodes are never unlinked as part of normal completion. The original Node/Python CLI/dbt descendants inherit those same descriptors. An interrupted caller cannot create a second writer while an original descendant still owns the work.

The optional whole-receiving lease is exported by `native/lease.mjs`:

- `receivingLease()` verifies `LDW_RECEIVING_LEASE_FD` and the JSON `LDW_RECEIVING_LEASE_IDENTITY`.
- The identity is `{device, inode, operationId, inputSha256}`. The descriptor must be a regular file with that exact device/inode.
- `inheritReceiving(stdio, environment)` appends that descriptor to a child's existing descriptor list and returns `{stdio, env}` with the child descriptor number. When no receiving lease is supplied it preserves the caller's normal environment and descriptors.
- The whole receiver, native host, original CLI/dbt children and handover packager use the same inherited receiving lock. The HTTP service must drain its accepted native and packaging promises before closing the workspace.

Every native command has a persisted selection before dispatch, retained process/exit information and original API request/response observations. The bridge observes the installed original API client and original compile/query helpers; it does not reimplement their semantics. Credential values are removed from retained diagnostic observations. These are retained parsed native responses and serialized request identities, not claims of byte-for-byte raw HTTP transport capture.

Terminal states are `SUCCEEDED` and `FAILED`. Active/recovery states include `PLANNED`, `RUNNING`, `BUSY`, `INTERRUPTED` and `NEEDS_RECONCILIATION`. Inspect the same original operation after interrupted output. Completed native validation/query jobs are read through their accepted job/query identities; the adapter does not submit a second job to manufacture a replacement result.

Batched deploy has a particularly important boundary. The original server finalizes a session with serialized status `"completed"` and then deletes that session. Its pinned controller exposes no GET session lookup. A missing session is not proof of a failed deploy. This adapter retains the real finalization result and inspects available project/compile evidence; it never invents a session GET or automatically replays an uncertain finalize.

Native content recovery is the original content upsert/conflict model. The adapter does not pass `--force`. It backs up the target before upload and retains native content metadata afterward. Restoring an export is not a full database rollback and does not imply deletion of unrelated target content. Space permission changes require the explicit planned `applySpaceAccess` choice.

## Result and artifact contract

A native result uses `lightdash-commissioning.result.v1` and includes `operationId`, `digest`, `state`, `attempt`, `dispatched`, `native`, `nativeReferences`, `contentExports`, `artifacts`, `artifactManifest` and any `error`/`recovery`.

`native` retains actual CLI/Node version, original command phases and exits, account/project observations, the original preview identity, unanswered native writes and complete accepted query outputs. Each query output points to the retained complete result and original CSV with bytes/SHA256, project UUID and query UUID.

The portable artifact inventory is explicit:

```js
result.artifacts = [{
  id,
  role,
  path,          // current private host location
  relativePath,  // member relative to this native operation directory
  bytes,
  sha256,
  executable,
  scope,         // "native-content" or "operator-private"
}];
result.artifactManifest = {
  schema: 'lightdash-commissioning.artifacts.v1',
  path,
  relativePath: 'artifacts.json',
  bytes,
  sha256,
};
```

The manifest contains the same `files` rows and records exclusions for changing host control files. Completed native charts/dashboards/spaces and their manifests are `native-content` so the customer handover can include reusable original content. Command logs, provider observations, queries, operation state and partial files are `operator-private` by default. The private workspace retains them for exact recovery. A handover with `includeOperatorPrivate: true` is an explicit operator choice, not a default customer export.

If complete artifact inventory cannot be saved, the adapter does not claim a successful complete delivery. The original operation and its retained outputs remain available for inspection.

## Original source contracts

These are the actual paths reviewed at the pinned upstream commit:

- [CLI command definitions](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/index.ts)
- [Configuration](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/config.ts) and [credentials](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/credentials.ts)
- [Native compile](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/compile.ts), [deploy](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/deploy.ts), [preview](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/preview.ts) and [validate](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/validate.ts)
- [Native download/upload](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/download.ts) and [project-scoped spaces](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/spacesAsCode.ts)
- [Run-chart](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/runChart.ts) and [accepted-query result polling](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/handlers/asyncQuery.ts)
- [Project type detection](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/cli/src/lightdash/projectType.ts)
- [Deploy controller](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/backend/src/controllers/v2/DeployController.ts) and [DeployService](https://github.com/lightdash/lightdash/blob/91e610898395e6659841a321a0cee31cfcac8ae8/packages/backend/src/services/DeployService.ts)


### Receipt failures after process creation

Both the original native host and whole receiving host keep their inherited leases while they drain an acquired child. Signal handling is installed immediately after process creation. If writing or syncing the process receipt fails, the host terminates and waits for that same owned process group before closing its descriptors. The retained original operation is then reconciled through its existing state; no second command is inferred from a missing process receipt.
