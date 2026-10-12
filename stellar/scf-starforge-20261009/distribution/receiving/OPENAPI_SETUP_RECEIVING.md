# Receive connection setup through the original Applications console

This continuation takes actual OpenAPI files and reviewed provider registrations through the complete connection-setup and managed-application flow. It uses the same original Applications workspace, private connection stores and managed receiver as [OpenAPI managed receiving](OPENAPI_MANAGED_RECEIVING.md).

Run `openapi-setup-reception.mjs` from the complete receiving source. It imports definitions, reviews the whole registry, initializes original stores, publishes immutable editions, retrieves their four handover files, reopens a prior edition when one exists, and enters the existing application review/save/start/open/stop/reopen sequence. Its source lives beside the original managed receiver; it does not contain another runtime installer or provider authorization implementation.

## Actual receiving inputs

Use a real READY installation with the original managed OpenAPI/OAuth interfaces, its exact source commit and manifest hash, and the actual older plain OpenAPI installation required by the managed receiving operation. The current console source must include the setup engine, facade and Applications hooks.

The optional `bootstrapSourceRoot` is the trusted current complete source root containing `stellar/scf-starforge-20261009/`. By default it is the selected installation's `package/source` directory. This lets the current console prepare a compatible managed OAuth installation even if that installed edition predates the setup interface.

The selected source files must be actual canonical regular UTF-8 JSON or YAML files. Record each file's literal SHA256; parsing and reserialization are not interchangeable with the original bytes. The receiver retains UTF-8 BOM and CRLF exactly and lets the original source parser decide whether the definition is supported.

The registration plan must come from the real provider/client setup. Each desired edition supplies the original backend `entries` array, the registered callbacks for every resulting alias, the reviewer and the registration reference. Confidential clients use existing environment-variable names. The receiving plan does not contain client-secret or token values.

The managed receiving continuation operates initialized, disconnected profiles. It leaves provider authorization to the original OAuth operation. If the receiving work includes a real source/client revision, supply its second complete registry plan, including the exact original `replacesProfileSha256`. The receiver processes those supplied editions in order and confirms that the earlier original stores remain unchanged.

## Configuration

The CLI accepts one private regular JSON file. The top-level configuration has these fields:

| Field | Content |
| --- | --- |
| `runtimeDirectory` | Canonical absolute path to the actual current READY installation. |
| `expectedSourceCommit` | Its exact 40-character source commit. |
| `expectedManifest` | Its exact 64-character source-manifest SHA256. |
| `legacy` | Actual older installation: `runtimeDirectory`, `expectedSourceCommit` and `expectedManifest`. It must retain the original plain OpenAPI path and predate managed launch. |
| `receptionDirectory` | Private directory for the original receiving journal and default Applications workspace. Its parent must exist. |
| `applicationWorkspace` | Optional existing original Applications workspace. If specified, it must already be initialized. |
| `bootstrapSourceRoot` | Optional current complete console/source root described above. |
| `label`, `homeId` | Optional original application label and existing runtime-home selection. |
| `settings` | New project output directory, fixed registered port and optional existing environment/registry selection. |
| `setup` | Actual source files, complete desired registration editions and optional host policy. |

`settings` contains:

```json
{
  "outputParent": "/absolute/private/path/to/new-projects",
  "port": 8787,
  "environmentFile": "/absolute/private/path/to/existing-environment.json",
  "oauthConnectionsFile": null,
  "allowLoopbackOAuth": false
}
```

These paths illustrate the configuration shape; replace them with the receiving operator's actual paths. `outputParent` must not already exist on the first run. The original Applications save creates it. The port must be the actual registered fixed port, from 1024 through 65535. Optional environment and registry fields may be null; all values declared in an existing environment file are preserved by the original setup engine.

`setup.sources` is an array of source selections:

```json
{
  "path": "/absolute/path/to/original-provider-openapi.yaml",
  "sha256": "THE_ACTUAL_64_CHARACTER_SOURCE_SHA256",
  "label": "The original provider definition"
}
```

A source's imported ID is its actual SHA256. Use that same ID in each new definition's `sourceId`. A plan may refer to a previously retained source instead; it need not import an identical file again. Each source is limited to 4 MiB by the original setup contract. This receiver accepts at most 64 source selections and 64 supplied editions, and bounds its private configuration/journal to 32 MiB.

`setup.editions` is a nonempty array of complete original registration plans. Each member has:

| Field | Content |
| --- | --- |
| `entries` | The exact complete desired registry, using the source-bound new-definition or original retained-alias forms in [Connection setup](../runtime-workspace/OPENAPI_CONNECTION_SETUP.md). |
| `registeredCallbacks` | One `{"alias":"actual-alias","uri":"actual-registered-callback"}` object for every resulting alias. |
| `actor` | The reviewer who checked the client and callback registrations. |
| `reference` | The actual registration or receiving work reference. |
| `callbacksRegistered` | Literal `true` after the listed callbacks have been registered. |

Before any commit, the receiver compares the backend's full source-derived callbacks with this registration list. A changed callback, missing alias or replacement profile causes that original step to fail before publication. A callback-registration assertion is separate from provider consent and grant approval.

The receiver requires nonempty desired editions because its final managed receiving operation opens an application with registered connections. The product itself continues to support an explicitly reviewed empty registry through its normal interface.

For host-configured paths or development-provider permission, `setup.policy` may contain `directory`, `grantRoot` and `allowLoopbackOAuth`. These are receiving-host configuration, not browser parameters. Default roots remain `oauth-setup` and `oauth-grants` inside the original Applications workspace. Enabling development providers requires both the host policy and selected settings to say `true`.

## Execute the complete original operation

Use the receiving worker that already owns the installed source and application work. Include the complete source, private state, native application and browser footprint in that worker's original resource declaration.

```bash
node stellar/scf-starforge-20261009/distribution/receiving/openapi-setup-reception.mjs /absolute/private/path/to/receiving-config.json
```

Keep the same configuration and receiving directory for continuation. The receiver validates both installations before importing their modules, attaches the selected runtime to the existing Applications workspace and calls its original `applicationsOpenApiSetup` method.

For each selected source it retains one request ID, imports the exact bytes and compares the original source inspection. For each supplied edition it obtains the complete review, checks registered callbacks, retains the review and commit identities, commits through the original initializer and repeats that exact completed request. An unchanged replay must return the original result even after its original revision has advanced.

Each completed edition is reopened through the original status API. The receiver retains the registry/environment hashes, safe profile and grant identities, and each allowed handover file's filename, byte length and SHA256. The four files are the registration review, registry, source manifest and operator plan. It does not copy environment values or grant/token files into the receiving journal.

If a previous edition exists, the receiver selects that exact previous edition and then restores the final supplied edition. This changes the setup pointer before the application is started. It leaves grant state and immutable files unchanged. When no prior edition exists, the recorded result accurately reports that no earlier edition was reopened.

After all supplied editions are prepared, the receiver closes the setup model and passes the final four settings into `receiveOpenApiManagedApplication`. That existing operation performs the actual legacy compatibility review, new output-folder save, original runtime adoption, managed host start, authenticated native API reads, original drain/stop and application reopen. It keeps its own original run IDs and receipt in the same receiving directory.

## Continue after an interruption

The private `openapi-setup-reception.json` journal retains the exact installation/configuration selection, original source and registration request IDs, reviews, prepared settings and managed continuation. The original `setup-receiving.lock` prevents a second active writer for this receiver.

Before dispatching a retained setup command, the receiver reads its original request status. A completed command returns its original result. A pending command is continued using `recover` and the original request ID. A command that never reached the backend may be submitted with its same retained input; source bytes are reread from the same pinned source file. Changed source/configuration bytes do not silently replace an existing operation.

An interruption after setup publication reuses the completed source and edition records and continues the same managed application receipt. It does not create a second application or source store. An already completed receiver returns its retained result.

Provider registration edits, an altered original environment, replacement of a private store, a changed installation or an unrelated pending setup operation require correcting the actual original input or continuing its owning request. The receiver preserves the concrete error code and stage in `issue`. Do not create a new receiving directory to evade that original state.

## Result

Successful standard output ends with `status:"COMPLETED"` and the actual application ID, installed source identities, imported source IDs, produced edition IDs and original managed operation IDs. `previousEditionReopened` contains the actual prior edition ID, or null when there was none.

The same directory retains:

- `openapi-setup-reception.json` for the complete original setup and its selected final edition.
- `openapi-managed-reception.json` for the original managed host start, stop and reopen.
- The original Applications workspace and private setup/grant roots, when defaults were used.

Keep the actual result with the existing original receiving work order and installed-source handover. A source-only parser result does not fill in the native completion fields; those fields are written by the actual operation above.
