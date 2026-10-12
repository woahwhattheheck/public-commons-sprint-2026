# SensorThings in the normal Starforge merchant distribution

This integration connects the maintained merchant MCP host to the original SensorThings operating workspace. The browser, managed Applications launcher, command line and MCP use the same writer, persistent workspace UUID, source editions and operation journal.

The source-owned distribution contribution is `distribution/contributions/sensorthings.json`. It registers the original command entries, package exports and `sensorthings-workspaces` merchant provider. The common distribution composer, provider registry, configuration reader, MCP host, SF30/SF82 publisher and SF88/SF100 customer engines remain their original implementations.

## 1. Use the complete selected distribution

Run these commands from the normal installed Starforge command:

```sh
starforge source
starforge registrations --source sensorthings
starforge merchant-providers inspect sensorthings-workspaces
```

The registration must list the source-owned provider, its initialize hook and the SensorThings command entries. A source selection that omits the SensorThings contribution cannot configure this provider. Keep the installed source identity and its manifest; choosing a source directory with similar filenames does not establish the same installed edition.

The integration adds no paid service or new package dependency. Setup uses the selected distribution's Node runtime and the existing Linux `flock` lease implementation. Use that release's normal runtime preparation and doctor workflow if its prerequisites are missing. Setup does not install packages, start a listener, fetch observations, publish a seller or make a purchase.

Commands supplied by this contribution:

| Command | Original operation |
| --- | --- |
| `starforge sensorthings` | Original workspace CLI, capture/edition/operation reads and explicit actions |
| `starforge sensorthings-setup connection --options FILE` | Create or reuse a private, reference-only connection file |
| `starforge sensorthings-setup merchant --options FILE` | Initialize or reopen the standard merchant host |
| `starforge merchant-providers init sensorthings-workspaces --options FILE` | The same initializer through the maintained registry |

Managed Applications and browser asset registration use their original source declarations in this same contribution. The managed launch retains the original server and workspace; it does not create an independent MCP data store.

## 2. Select the actual running workspace

Use the existing managed SensorThings application if it already owns the workspace. For an operator-managed command-line listener, the original CLI accepts:

```sh
umask 077
starforge sensorthings serve \
  --workspace /absolute/private/sensorthings-workspace \
  --port 8467 \
  --session-file /absolute/private/sensorthings-session.url
```

The workspace path is the retained original operating directory. Keep its existing source inbox and buyer workspace selections when reopening; the original serve command also accepts `--source-inbox` and `--buyer-workspace`. Start only the owner selected for that workspace.

Use the actual `workspaceId` in the original startup record. If no listener owns that workspace, the one-shot schema command also reads its original identity:

```sh
starforge sensorthings schema --workspace /absolute/private/sensorthings-workspace
```

Do not run a direct workspace command while its managed or command-line listener owns the writer; use its browser or connected client instead.

The original private startup record has schema `stellar-forge.sensorthings-workspace-startup.v1` and fields `workspaceId`, `origin`, `url` and `pid`. Its URL contains the private fragment credential. Keep that record and the session file private. Do not paste the URL into the source contribution, a tool argument, a shared report or a customer package.

## 3. Create the reference configuration

Use a private parent directory (0700) and private JSON files (0600). The setup verifies real directories and regular files, rejects symbolic links in their paths, and checks retained file identity throughout reads. It does not change the permissions or contents of an unrelated existing directory.

Create a private options file with the actual UUID and original URL-file reference. The bracketed UUID below is a placeholder to replace with the observed workspace UUID, not a generated example workspace:

```json
{
  "file": "/absolute/private/sensorthings-connection.json",
  "workspaces": {
    "observations": {
      "label": "Original observation workspace",
      "workspaceId": "<actual-original-workspace-uuid>",
      "consoleUrlFile": "/absolute/private/sensorthings-session.url"
    }
  }
}
```

Then:

```sh
starforge sensorthings-setup connection \
  --options /absolute/private/sensorthings-connection-options.json
```

The connection schema is `stellar-forge.sensorthings-workspace-connection.v1`. It contains one to 32 lowercase aliases. Each alias requires the actual persistent UUID and exactly one reference:

| Reference | What the original provider reads |
| --- | --- |
| `consoleUrlFile` | The existing private UTF-8 loopback session URL file |
| `consoleUrlEnv` | The explicitly named environment variable in the process launching the merchant |
| `applicationUrlFile` | The original managed Applications private URL JSON record |

References inside a connection options file resolve relative to the destination connection file. The initializer's own `directory`, `connection` and optional `releaseStore` paths resolve relative to the invoking process's working directory. Absolute paths make this distinction explicit.

For `consoleUrlEnv`, provide only the environment variable name. The setup never reads or exports its value. Ensure the real merchant process inherits that variable; the generated MCP registration does not copy arbitrary process environment or credentials.

For a managed Applications connection, the URL record must contain the original private `url` and `original.schema` equal to `stellar-forge.sensorthings-workspace-startup.v1`, with `original.workspaceId` matching the declared UUID. Select the URL-record filename returned by the original managed launcher. A browser link, a guessed filename or a record for another application is not an equivalent binding.

Publishing is create-only. Repeating the same normalized connection options reuses identical bytes. A different existing file is preserved and rejected. To change which workspace an alias selects, create an explicitly selected new connection and merchant setup rather than silently replacing the original binding.

## 4. Initialize the original merchant host and client

Keep the merchant host in its own private directory, separate from the SensorThings writer. Create a private setup options file:

```json
{
  "directory": "/absolute/private/sensorthings-merchant",
  "connection": "/absolute/private/sensorthings-connection.json",
  "name": "SensorThings observation operator"
}
```

Use the normal provider initializer:

```sh
starforge merchant-providers init sensorthings-workspaces \
  --options /absolute/private/sensorthings-merchant-options.json
```

The source-local `sensorthings-setup merchant` command invokes the same implementation. It does not bypass the maintained provider registry: the selected installed source must contain the declared provider and initialize hook before setup creates host state.

The completed host contains:

| File/directory | Purpose |
| --- | --- |
| `sensorthings-setup.json` | Original directory, connection, normalized UUID/reference bindings, name and release-store intent |
| `releases/` | Original SF82 host store initialized through `initReleaseStore`, unless an existing store was explicitly selected |
| `customer-exports/` | Private standard merchant export directory |
| `merchant-mcp.json` | Common merchant configuration using `sensorthingsWorkspaceConnection` |
| `merchant-client.json` | Original subprocess MCP registration for `starforge-sensorthings` |
| `sensorthings-setup-complete.json` | Complete configuration and client byte hashes, original bindings and completion time |

The common merchant configuration requires an SF82 release store even when its `sources` map is empty. This host store does not copy the SensorThings database, observations or publisher state. SensorThings-specific operations still go to the original running workspace and its own native publication/customer history.

If the merchant should use a pre-existing original SF82 store, include its actual path as `releaseStore`. Setup validates that existing private store and never initializes a replacement when it is missing.

The result reports `INITIALIZED`, `RESUMED` or `REOPENED`, configuration/client SHA256 identities, workspace aliases/UUIDs, and `sessionChecked:false`. This is a completed configuration operation. It does not claim a running listener, a successful provider request or a payment result.

Import the generated `merchant-client.json` through the MCP client's normal configuration surface. It uses the selected installed original `stdio.mjs` and Node executable, and passes only `MCP_MERCHANT_CONFIG`. It contains no listener URL or token.

To compose with another MCP client's existing servers, use the original exporter and a new output file:

```sh
starforge merchant-mcp-client-config \
  --config /absolute/private/sensorthings-merchant/merchant-mcp.json \
  --name starforge-sensorthings \
  --merge /absolute/private/existing-mcp-client.json \
  --output /absolute/private/combined-mcp-client.json
```

The original exporter preserves existing settings and refuses a duplicate server name. It does not edit the application's live settings file in place.

## 5. Operate through the same writer

The source-owned catalog advertises these fourteen tool names:

| Tool suffix after `merchant_sensorthings_` | Operation |
| --- | --- |
| `workspaces` | Declared aliases/UUIDs and this client's active original file reads |
| `schema` | Original action/field schema and running workspace identity |
| `view` | Current original sources, plans, captures, reviews, revisions and native outcomes |
| `catalog` | Page one original retained stream catalog |
| `edition` | Immutable source edition metadata or summary |
| `rows` | Observation, ordered component or entity rows with original field distinctions |
| `capture` | The same capture's attempts, complete pages and continuation state |
| `release` | Original selected seller release and publisher generations |
| `publisher` | Same original publisher, customer recovery and accounting |
| `operation` | Durable result/status of the original operation ID |
| `action` | Explicit original action at an expected revision with a stable operation ID |
| `files` | Page original manifest-selected file identities |
| `file_read` | Bounded original held-file chunks |
| `file_release` | Close this client's original named read without deleting retained source |

Begin with the original workspace list, then its schema and view. Every live connection checks the declared UUID in the schema and response. Configuration changes do not grant authority to another workspace at a reused port.

For a mutation, retain the caller's actual `operationId`, `expectedRevision`, `action` and complete `payload`. Read the advertised source schema for exact fields. The client never manufactures an operation ID or retries an uncertain write. If the reply is lost, read the same `operation` before deciding whether its exact original action can continue.

The command-line client uses this same provider:

```sh
starforge sensorthings connect \
  --config /absolute/private/sensorthings-connection.json \
  --alias observations \
  --tool merchant_sensorthings_view \
  --input /absolute/private/view-input.json
```

The input file contains only the tool-specific fields. For this view request it is `{}` and `--input` may be omitted. `--alias` supplies the original `workspace` field; an input file that also contains `workspace` is rejected. The same rule applies to explicit action input files.

Use the source-owned selected-file downloader for a full original artifact:

```sh
starforge sensorthings download \
  --config /absolute/private/sensorthings-connection.json \
  --alias observations \
  --selection /absolute/private/selected-original-file.json \
  --directory /absolute/private/received-files
```

Select a returned file selector and full SHA256 identity. Continue the same original read ID, selector, SHA256 and offset. After process restart, use the same selector, hash and offset without an expired read ID. The runtime's original read owner holds files and enforces its chunk contract. Closing the merchant provider drains its own pending work and releases its borrowed reads; it does not stop the original managed application.

### Installed JavaScript and TypeScript clients

The same package exports the native workspace client and retained-file receiver at `@tokenjunkielabs/starforge-merchant/sensorthings/mcp` and `@tokenjunkielabs/starforge-merchant/sensorthings/download`. Their paired declarations describe the actual tool inputs, capture pages, native file selections and receiving results. The pure catalog and validator are available at `@tokenjunkielabs/starforge-merchant/sensorthings/mcp-protocol`; setup keeps its existing `/sensorthings/setup` export.

This complete ES module receives files selected from the original running workspace. In a project installation, place it beside the existing `node_modules` directory that resolves the selected merchant package, outside the immutable package/source directory. Pass the private connection file, its declared alias, a JSON file containing the returned native selection, and the original receiving directory:

```js
import { readFile } from 'node:fs/promises';
import {
  readSensorThingsWorkspaceConfiguration,
  MerchantSensorThingsWorkspaces,
} from '@tokenjunkielabs/starforge-merchant/sensorthings/mcp';
import {
  inspectSensorThingsFiles,
  downloadSensorThingsFiles,
} from '@tokenjunkielabs/starforge-merchant/sensorthings/download';

const [connectionFile, workspace, selectionFile, directory] = process.argv.slice(2);
if (!connectionFile || !workspace || !selectionFile || !directory) {
  throw new Error('Pass CONNECTION_FILE ALIAS SELECTION_FILE RECEIVING_DIRECTORY.');
}
const configuration = await readSensorThingsWorkspaceConfiguration(connectionFile);
const workspaceId = configuration.workspaces[workspace]?.workspaceId;
if (!workspaceId) throw new Error('Choose an alias retained in this connection file.');
const selection = JSON.parse(await readFile(selectionFile, 'utf8'));
const client = new MerchantSensorThingsWorkspaces(configuration);
try {
  const scope = { client, workspace, workspaceId, selection };
  const inspected = await inspectSensorThingsFiles(scope);
  const result = await downloadSensorThingsFiles({
    ...scope,
    directory,
    exportId: inspected.manifest.id,
    expectedManifestSha256: inspected.manifestSha256,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally {
  await client.close();
}
```

Run the script with that project's selected Node executable. Command-only installations can use the original `starforge sensorthings download` command above with the same inputs and recovery behavior. The private connection remains the authority for the alias and persistent workspace UUID. The example does not print its private URL or token. `inspectSensorThingsFiles` binds the complete native file list; the subsequent download requires that same client selection ID and receiving-manifest SHA256. Provider file bytes retain their own full hashes and original names in `sensorthings-download.json`.

After an interruption, run the same script against the same selected files and receiving directory. The original downloader verifies its saved manifest, completed files and partial prefix before continuing. A changed selection or file list is a conflict; preserve the existing checkpoint and recover the original retained selection. Process-local generated review snapshots must be read through the original `file_read` operation; the complete-file receiver rejects them until a fixed native file selection exists.

The direct workspace client belongs to this caller, so `close()` drains its pending calls and releases its remaining held reads. The separate `url` form supported by the retained downloader uses the original stateless HTTP merchant client and its declared bearer-token environment reference. It does not accept a private SensorThings `/#token` URL as an MCP endpoint.

## 6. Restart, interrupted setup and receiving recovery

Re-run the same merchant setup options after an interrupted installation. Setup first verifies the retained intent and normalized source bindings. It uses the original directory lease, complete private file publication and the original SF82 reader.

An interrupted empty SF82 stage is resumed if its complete original state is valid. If native initialization stopped before its complete state was written, setup preserves that exact partial directory with an `-incomplete-` suffix and starts a new original initialization stage. A stage containing release activity or unrecognized files is not treated as empty. Existing final stores and files are validated and preserved.

The completion record is written after the original common merchant configuration and client registration are complete and their identities are checked. Reopening a completed setup retains the original completion time and receipt. Changed intent, workspace UUID, connection reference, host configuration or client bytes produce a specific error.

Restart the actual SensorThings writer through its original owner. The connection reference stays the same while its private URL file or managed URL record rotates with the new session/port. The MCP provider rereads the reference on each request and checks the original workspace UUID. Setup does not need to copy or replace the token.

After updating or moving the installed source, `clientSourceMatchesCurrentInstallation:false` means the retained subprocess registration still refers to the earlier original installation. Preserve it and generate a new client registration through `merchant-mcp-client-config` with the currently selected runtime. Source-only setup does not automatically rewrite the user's client installation paths.

A portable source edition and a complete writer workspace are different receiving objects. Use the source-owned portable/import workflow and retained-file guide for the selected original artifact. Keep source response bytes, manifests, source URLs/times, license/source terms and original review evidence with it. Receiver identity, new credentials and receiving decisions belong to the actual receiving workspace; do not reuse another operator's private session or infer its UUID from a source edition ID.

Before retiring any installation copy, retain the original complete source/package identity, source editions, workspace state, private connection definitions and original operation history needed for reopening. Keep private URL files and environment values in the operator's existing credential custody, outside portable customer artifacts.

## 7. Source meaning and operational limits

Observation fields retain the source's own meaning: phenomenon time, result time, valid time, ordered multidimensional components, units, result type, result quality, and distinct null/missing states. Provider pagination tokens remain opaque. A completed selected query does not establish an atomic historical snapshot, upstream quality approval, continuous observation coverage or station uptime.

A partial or failed capture remains visible with the original attempts and returned pages. A source-edition import preserves prior review as source evidence; the receiving analyst's explicit decision is separate. Dataset, release, payment and customer operations keep the original SF30/SF82 and SF88/SF100 semantics. Setup and tool discovery establish none of those outcomes by themselves.

## 8. Maintained implementation references

The following existing source contracts define the installed behavior:

- `stellar-forge/mcp-merchant-operator/provider-contract.mjs`, `provider-registry.mjs`, `providers.mjs` and `provider-cli.mjs`: metadata, lazy setup/load hooks, common registry and provider ownership.
- `stellar/scf-starforge-20261009/distribution/specification.mjs` and `source-providers.mjs`: one contribution composition, installed original-file identity verification and source-selected registration.
- `stellar-forge/mcp-merchant-operator/config.mjs` and `client-config.mjs`: common host configuration and original subprocess MCP registration.
- `stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs` and `sf82-seller-pilot/releases.mjs`: original local lease and release-store initialization/reopen.
- This directory's `schema.mjs`, `mcp-protocol.mjs`, `mcp.mjs`, `merchant-provider.mjs`, `setup.mjs` and paired `setup.d.mts`: SensorThings source declarations and this setup ABI.
- The original managed Applications, desk, portable-file and provider guides in the same composed source edition: actual listener startup, receiving and source operations.

The one integrated native receiving operation should use the retained original source capture and its actual writer. Configuration source checks are not a claim that a provider or native process has executed. Record real source, workspace, operation, edition and downloaded-file identities when that operation completes.
