# Native facilitator operator

Use the original native facilitator from a local operator screen: review a profile, retain its original JSON file, start the SDK backend, inspect its accounts and payment state, drain it, and reopen the same configuration. The browser and original CLI use the same configuration schema and runtime. The same screen retains optional durable Bazaar publication, its original merchant bindings and its committed discovery resources.

## Installed Applications and typed client

The [complete selected installation and receiving guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/main/stellar/scf-starforge-20261009/distribution/selections/NATIVE_FACILITATOR_OPERATOR.md)
packages this same operator as `native-facilitator-operator`. The source-owned
Applications provider opens it through the original Review, Save, Connect,
Review Start, Start, Open and Stop/recovery lifecycle. Saved Applications retain
the original host directories, managed operation and selected source.

The same guide documents the typed Node client at
`@tokenjunkielabs/starforge-merchant/facilitator/operator/client`. It reviews and
saves native profiles, probes readiness, controls the original runtime and
receives complete catalog views through this authenticated operator. Its
`receiveCatalog` and the browser share the same original pagination and
fixed-revision receiving implementation.

## Start the workspace

Choose a private workspace and the **same shared signer ownership directory used by the other native facilitator processes on this host**. Keep those paths canonical and absolute. Use the existing configured Stellar accounts and secret environment-variable names. Set the actual secrets in the host environment before launching.

```sh
node native-facilitator/workspace/server.mjs \
  --directory /private/facilitator-operator \
  --ownership-directory /private/stellar-signer-ownership \
  --create --port 0
```

The installed native catalog contribution also exposes `native-facilitator-operator`, which runs this same server with the same arguments and saved files.

`--create` creates those private leaf directories when their parents already exist. On later starts the same paths reopen the saved profiles. Open the complete local URL printed by the command. The URL grants access to this local operator; keep it in the operator session. A new workspace process prints a new URL.

## Review and retain a profile

Enter the network, selected RPC, existing public settlement accounts and their environment-variable references, allowed asset contracts and recipients, maximum atomic amount, fee ceiling and account capacity. Select the accepted native payment timing. Authorization completes merchant work before settlement; upfront settles before opening the merchant source. The merchant's advertised timing must match the facilitator profile.

The review calls the original `validateConfig` and `reviewConfig` without loading signing material. It shows the complete recipient, asset, amount, timing, fees, account references and configuration digest. Capacity is limited by the distinct configured accounts. A readiness probe uses the original RPC readiness implementation.

Save under a unique profile name. The resulting `profiles/<name>.json` is the original normalized native configuration, written privately and published only after its complete bytes have been synced. Saving the same name and exact review again reopens that profile. A different configuration needs a new name. Importing or editing an existing profile preserves its shared ownership directory; a profile naming another directory requires launching the workspace with that original host directory.

The file can be supplied directly to the original `native-facilitator/cli.mjs --review|--serve --config FILE`, or selected as the native facilitator configuration in the original SF66 merchant/customer setup. The selected-profile panel supplies the exact file path, native download and original CLI argument arrays. A changed file must be reviewed again before it can start.

## Retain catalog publication with the profile

Select **Enable the durable Bazaar catalog for this profile** and enter the
original absolute journal directory for the selected network. Add each complete
merchant binding: seller identity, catalog signer identity, merchant HTTPS origin
and allowed payment recipient. Recipient suggestions come from the payment
policy above. The original native validator checks the full binding, recipient
membership, duplicate origin/recipient pairs and consistent signer identity.

The catalog signer field retains its exact original string. It is the configured
catalog identity; the payment accounts above still use their original environment
references. The policy review and selected-profile panel show every catalog
binding and the exact journal directory before save or start. Add, remove or edit
bindings in the form and review the resulting policy under a new profile name.

Importing or editing a native profile preserves its complete catalog object.
Disabling the catalog is an explicit checkbox change recorded in the next review.
The native runtime opens the existing journal when that reviewed profile starts;
the original successful settlement hook supplies the catalog outcome and
`EXTENSION-RESPONSES` header. The existing gateway forwards those committed
discovery resources through its network-specific route.

Earlier saved profiles that omitted the then-optional catalog field reopen with
their original JSON bytes, SHA-256, filename and original CLI arguments. The store
recognizes that specific earlier encoding while still checking every normalized
field and the full canonical bytes. Reviewing an equivalent disabled policy under
that existing name reopens the original file. A changed policy or enabled catalog
requires its own immutable profile name. The current normalized review hash is
available as `reviewSha256`; the selected profile's `sha256` always identifies
the original downloaded file.

## Run and observe

Select a saved profile, choose the local HTTP listener port, and start its backend. Port zero assigns a free port. Startup loads the existing environment references and uses `createNativeFacilitator` plus `startFacilitatorServer`. The existing SDK owns payment verification, signing, fee sponsorship and settlement. The original shared ownership lease protects its configured accounts. No backend starts automatically when the operator page or process reopens.

The running panel shows its exact profile digest and runtime identity, network and payment timings, original supported metadata, each settlement account's state, active work, available capacity, native verification/settlement counts, refusals and errors. Counters describe the current runtime. The buyer and merchant retain their own purchase receipts and outputs through their original workflows. Configure any deployment gateway against the displayed listener using the existing native facilitator operating guide.

The operator screen is authenticated separately from the native facilitator HTTP endpoint. Both bind to loopback. The management API verifies the exact local origin and its printed session capability. Key values are never requested by the form or returned by the runtime status.

## Browse and receive committed catalog resources

Start the selected profile and use **Read current catalog**. The catalog panel
shows the original durable resource count, version, operation count and head,
pending settlement metadata, current queue and successful batch commits. These
observations come directly from the running native catalog and its original SF60
journal. A catalog error remains visible beside the native payment runtime.

Browse the full network-bound catalog or enter a search. Type, payment scheme,
recipient, asset and extension filters use the original discovery engine. Read
20, 50 or 100 complete resources per page. Each resource includes the native
discovery operation, full atomic payment terms and an expandable original JSON
record with its input, output and schema metadata.

Each read retains the runtime ID, original profile name and byte hash, network,
observation time, catalog version/head, exact query and complete returned page.
**Next page** and **Previous page** stay on that same resource version. Search
uses the original revision-bound cursor. List pagination adds an explicit
version check before the original page read. A newer catalog revision requires
**Read current catalog** to select current resources. Background status updates
retain the expanded resource details and the original page.

**Download retained page** saves that complete observation, including the native
pagination metadata. It remains available after the original runtime stops.
**Download complete view** receives every matching original resource across
100-resource pages at the selected version, then creates one JSON file. The file
retains the original runtime/profile, first page observation, network, query,
catalog head, all resources, resource count and page count. If the runtime or
resource version changes during receiving, the operation ends before publishing
a file; the previously retained page remains available. Apply the current query
again to select a new complete view.

The complete-view schema is
`stellar-forge.native-catalog-export.v1`; individual page observations use
`stellar-forge.native-catalog-page.v1`. Source amounts remain original strings.
These discovery exports can be inspected or received alongside the merchant's
native profile and original journal.

### Authenticated catalog API

The existing local operator capability protects `GET /api/catalog`.
Pass the original `runtimeId` from `/api/status`, the optional
`expectedVersion` from a retained page, and the same discovery parameters:
`query`, `type`, `payTo`, `network`, `scheme`, `asset`,
`extensions`, `limit`, and the appropriate `offset` or `cursor`.
The selected native runtime enforces its configured network. Duplicate or
unknown parameters are rejected.

A changed runtime returns `FACILITATOR_RUNTIME_CHANGED`; a changed selected
resource version returns `FACILITATOR_CATALOG_VERSION_CHANGED`. A catalog that
requires reopening returns `FACILITATOR_CATALOG_UNAVAILABLE`. Reconcile and
reopen the original journal through the existing native operating workflow.

## Drain, update and reopen

Use **Drain and stop** before choosing another profile or port. The original transport stops admitting requests and drains the original SDK. If its grace period ends while accepted native work is still running, the screen retains that runtime and its signer ownership until the SDK completes. The operator process also retains those descriptors during shutdown. Review the original merchant/buyer operation before retrying any payment after a lost connection.

An edited policy is a new immutable named file. Start it only after the previous runtime finishes draining. Restarting the operator process reopens the saved files with no automatic payment or backend action. The original CLI and a prepared customer session can consume the same files, using that same shared ownership directory.

Ctrl-C closes the management listener and drains its owned native backend. Keep the original process running while accepted SDK work is completing. See the parent `OPERATIONS.md` for readiness, signing-account custody and payment reconciliation.
