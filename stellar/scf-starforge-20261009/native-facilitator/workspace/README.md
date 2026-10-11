# Native facilitator operator

Use the original native facilitator from a local operator screen: review a profile, retain its original JSON file, start the SDK backend, inspect its accounts and payment state, drain it, and reopen the same configuration. The browser and original CLI use the same configuration schema and runtime.

## Start the workspace

Choose a private workspace and the **same shared signer ownership directory used by the other native facilitator processes on this host**. Keep those paths canonical and absolute. Use the existing configured Stellar accounts and secret environment-variable names. Set the actual secrets in the host environment before launching.

```sh
node native-facilitator/workspace/server.mjs \
  --directory /private/facilitator-operator \
  --ownership-directory /private/stellar-signer-ownership \
  --create --port 0
```

`--create` creates those private leaf directories when their parents already exist. On later starts the same paths reopen the saved profiles. Open the complete local URL printed by the command. The URL grants access to this local operator; keep it in the operator session. A new workspace process prints a new URL.

## Review and retain a profile

Enter the network, selected RPC, existing public settlement accounts and their environment-variable references, allowed asset contracts and recipients, maximum atomic amount, fee ceiling and account capacity. Select the accepted native payment timing. Authorization completes merchant work before settlement; upfront settles before opening the merchant source. The merchant's advertised timing must match the facilitator profile.

The review calls the original `validateConfig` and `reviewConfig` without loading signing material. It shows the complete recipient, asset, amount, timing, fees, account references and configuration digest. Capacity is limited by the distinct configured accounts. A readiness probe uses the original RPC readiness implementation.

Save under a unique profile name. The resulting `profiles/<name>.json` is the original normalized native configuration, written privately and published only after its complete bytes have been synced. Saving the same name and exact review again reopens that profile. A different configuration needs a new name. Importing or editing an existing profile preserves its shared ownership directory; a profile naming another directory requires launching the workspace with that original host directory.

The file can be supplied directly to the original `native-facilitator/cli.mjs --review|--serve --config FILE`, or selected as the native facilitator configuration in the original SF66 merchant/customer setup. The selected-profile panel supplies the exact file path, native download and original CLI argument arrays. A changed file must be reviewed again before it can start.

## Run and observe

Select a saved profile, choose the local HTTP listener port, and start its backend. Port zero assigns a free port. Startup loads the existing environment references and uses `createNativeFacilitator` plus `startFacilitatorServer`. The existing SDK owns payment verification, signing, fee sponsorship and settlement. The original shared ownership lease protects its configured accounts. No backend starts automatically when the operator page or process reopens.

The running panel shows its exact profile digest and runtime identity, network and payment timings, original supported metadata, each settlement account's state, active work, available capacity, native verification/settlement counts, refusals and errors. Counters describe the current runtime. The buyer and merchant retain their own purchase receipts and outputs through their original workflows. Configure any deployment gateway against the displayed listener using the existing native facilitator operating guide.

The operator screen is authenticated separately from the native facilitator HTTP endpoint. Both bind to loopback. The management API verifies the exact local origin and its printed session capability. Key values are never requested by the form or returned by the runtime status.

## Drain, update and reopen

Use **Drain and stop** before choosing another profile or port. The original transport stops admitting requests and drains the original SDK. If its grace period ends while accepted native work is still running, the screen retains that runtime and its signer ownership until the SDK completes. The operator process also retains those descriptors during shutdown. Review the original merchant/buyer operation before retrying any payment after a lost connection.

An edited policy is a new immutable named file. Start it only after the previous runtime finishes draining. Restarting the operator process reopens the saved files with no automatic payment or backend action. The original CLI and a prepared customer session can consume the same files, using that same shared ownership directory.

Ctrl-C closes the management listener and drains its owned native backend. Keep the original process running while accepted SDK work is completing. See the parent `OPERATIONS.md` for readiness, signing-account custody and payment reconciliation.
