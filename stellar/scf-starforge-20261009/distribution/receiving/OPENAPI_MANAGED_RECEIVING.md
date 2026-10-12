# Receive the managed OpenAPI application

This is one receiving workflow for the existing Applications product. It consumes a real READY runtime and drives that runtime's original configuration review, save, managed adoption, start, private HTTP read, stop and reopen operations. It does not build or install a runtime, authorize a provider account, refresh a grant, or create a merchant seller. The separately maintained OpenAPI/OAuth browser workflow covers provider consent, grant review, compilation and seller operation.

The managed application source is introduced by PR1556, merge `239c0c2f2bce6a0ed613c46af1ed7576c570c79c`. PR1571 connects the catalog, preparation, startup observer and browser review to those managed sources. Select an installed edition containing both changes after its original installer reports READY. A source checkout with a fabricated READY record is not a supported input.

## Inputs from the existing installation owner

Use the original READY descriptor's `runtimeDirectory`, `sourceCommit` and `sourceManifestSha256`. The receiver calls `inspectMerchantRuntime` and verifies those exact identities before importing its Applications model. All execution modules then come from the inspected installation's `package/source`, including the original managed command runner and OpenAPI server.

A second genuine older READY descriptor is required for the compatibility selection. It must contain the original `openapi-workspace` command and server, and must predate `workspace/managed-launch.mjs`. The receiver reviews that real runtime without OAuth and retains its original command. Selecting configured OAuth against it must return the actual `APPLICATION_OPENAPI_NOT_IN_RUNTIME` error. It does not save or launch a second legacy application.

Use the same equipped host that retains both installations. If the existing producer installs under a private process mount, run this receiving call before that producer closes, or consume its complete retained installation using the owner's normal handback. Do not point a different process at a private mount that it cannot see.

## Prepare a source-bound, unauthorized connection

Select a public profile for the exact original OpenAPI source and security scheme using the existing OAuth profile/compiler tools. Keep its registered listener origin consistent with the fixed receiving port. Initialize its separate private directory using the original installed command:

```sh
starforge oauth-connection init --directory /PRIVATE/provider-connection --profile /PRIVATE/public-source-profile.json
```

Add `--allow-loopback` only when that profile explicitly describes a local development provider. This operation initializes the original profile and empty grant state; it does not request consent. The receiver requires every selected original status to report a disconnected grant with no grant ID, reviewed authorization, refresh token or scopes. Use a dedicated receiving profile, not an active customer grant.

The original host configuration has this public-reference shape:

```json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {
      "alias": "receiving-api",
      "directoryEnv": "ReceivingProviderDirectory"
    }
  ]
}
```

Retain the private environment as the original Applications JSON environment file, owned by the operator and mode 0600:

```json
{
  "ReceivingProviderDirectory": "/PRIVATE/provider-connection"
}
```

If the actual registered profile declares a client secret environment reference, provision that reference through this same private environment file. The receiver uses the original environment reader and records only its SHA-256, never its values. The managed application retains references and public profile/source identities; private token files remain in the original OAuth directory.

All selected paths must be absolute and canonical. Private OAuth directories must remain separate from both merchant projects and installed source. The projects directory must initially be absent, with an existing private parent; its creation is performed by the original Applications save. The reception directory's parent must also already exist. Keep the receiving script's reserved `unselected-projects` and `legacy-projects` children separate from OAuth directories.

## Configuration

Store this configuration in the operator's private receiving area, replacing each placeholder with the actual original descriptor or path:

```json
{
  "runtimeDirectory": "/PRIVATE/current-ready-runtime",
  "expectedSourceCommit": "ACTUAL_40_CHARACTER_SOURCE_COMMIT",
  "expectedManifest": "ACTUAL_64_CHARACTER_SOURCE_MANIFEST_SHA256",
  "receptionDirectory": "/PRIVATE/openapi-reception",
  "applicationWorkspace": "/PRIVATE/existing-applications-workspace",
  "label": "Managed API authoring receiving",
  "settings": {
    "outputParent": "/PRIVATE/new-merchant-projects",
    "port": 41579,
    "oauthConnectionsFile": "/PRIVATE/openapi-host-connections.json",
    "environmentFile": "/PRIVATE/openapi-application-environment.json",
    "allowLoopbackOAuth": false
  },
  "legacy": {
    "runtimeDirectory": "/PRIVATE/older-ready-runtime",
    "expectedSourceCommit": "ACTUAL_OLDER_40_CHARACTER_SOURCE_COMMIT",
    "expectedManifest": "ACTUAL_OLDER_64_CHARACTER_SOURCE_MANIFEST_SHA256"
  }
}
```

`applicationWorkspace` is optional. When supplied, it must be the existing original Applications workspace. When omitted, the receiver creates one through `createRuntimeWorkspace` under its reception directory. An optional `homeId` reuses the original managed home selected by the installation owner; otherwise the existing Applications model selects or opens its normal managed home. Reuse a matching adopted release when one is already available.

`bootstrapSourceRoot` is optional and defaults to the selected installation's `package/source`. If supplied, it only locates the original runtime inspector; every application module is subsequently loaded from the inspected runtime. The receiver never copies a newer source overlay into a supposedly READY runtime.

Use a fixed unused port from 1 through 65,535, except 80, that matches all selected provider callbacks. The receiver and app preserve the normal environment-name syntax, including mixed-case references. The settings remain the same across stop and reopen.

## Run once and retain the original receipt

Invoke the delivered script with the existing installed Node runtime:

```sh
node /SOURCE/stellar/scf-starforge-20261009/distribution/receiving/openapi-managed-reception.mjs /PRIVATE/openapi-receiver-config.json
```

The exported `receiveOpenApiManagedApplication(config, { onProgress, signal })` can instead be called from the existing installation owner's receiving process. It adds no independent installer, supervisor or provider fixture.

The private `receptionDirectory/openapi-managed-reception.json` binds:

- Both actual source commits, manifests and installation identities.
- The original Applications workspace, environment file identity and exact public source/profile registrations.
- The configuration review and save request, original adoption identity, and each retained start review/request ID.
- The real missing-folder creation, selected output inode, and rejected unselected output directory.
- Each original startup descriptor, authenticated local connection/package read, and observed terminal stop.
- Separate startup instance IDs and private URL hashes for the two launches.

The receiver authenticates only the original loopback `/api/packages` and `/api/oauth/connections` reads. It verifies the actual startup announcement captured by the common Applications observer, the same original profile hashes/callbacks, the saved project directory, and the unchanged package-name inventory. It stores no workspace capability or provider token in the receiving receipt or progress output; the original managed operation retains its own private URL file.

The unselected-directory check passes the reviewed command digest with a different private projects directory to the original managed launcher. The original host must reject it with `OPENAPI_MANAGED_INPUTS_CHANGED` before opening a listener. The real first start is then dispatched through Applications, followed by stop, reopening the original Applications model, a new reviewed start of the same saved application, and a second stop.

## Continue and close through the original operation

Reinvoke the same configuration and reception directory to inspect or continue the original journal. A kernel lease prevents two receivers from owning that journal. Configuration/source changes are rejected rather than silently changing the retained selection.

Unknown start responses and interrupted adoption/start workers retain their original request IDs. The receiver asks the original `resumeQueued`, `recoverManagedOperation` or `applicationsRecover` operation to continue an eligible retained worker; it never invents a substitute request or edits its ledger. A genuinely running original command is read without dispatching a second one.

On a receiving failure after a start request, the receiver attempts the original stop and waits for that exact owned run to become terminal. This cleanup still runs if writing the receiving receipt fails. A pass that was stopped before its HTTP read is preserved as requiring operator review; it is not reported as completed or silently replaced by a new start. Retain the issue and original application run while correcting the actual source or environment cause.

The CLI converts SIGINT/SIGTERM into a stop request for the receiving function so normal shutdown can drain its owned managed host. The importing host can supply its existing abort signal. A failure to stop or close remains an error, including when another earlier error also occurred.

A final `COMPLETED` receipt requires both observed starts and both stops, a new actual startup/capability for reopening, matching saved profile/project identities and the unchanged original package inventory. Merely writing this source or obtaining a source-only review is not a native completion.
