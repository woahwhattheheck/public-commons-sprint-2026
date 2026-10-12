# Continue an original reviewed Prescient client operation

This executable carries the original saved Prescient profile review through the maintained Node client, command line, merchant MCP adapter, owned host restart and receiver binding. It uses the same already reviewed native case and its retained operation identity. It does not initialize another case, connect a provider SDK, acquire imagery, or replace the complete StacDelivery customer receiving workflow.

The original implementation is in [examples/prescient-client-retained-operation.mjs](examples/prescient-client-retained-operation.mjs). The installed client workflow is described in [PRESCIENT.md](PRESCIENT.md); provider and full customer requirements remain in the original Prescient operator guide.

## Required retained input

Select the input JSON retained by the original configured sender/receiver operation. It contains:

| Field | Existing selection |
| --- | --- |
| directory | Absolute root of the original native case, containing sender `operator/`, receiver `receiver/`, original `result.json`, and `portable-profile.json`. |
| profile | Exact original reviewed source profile. Its configuration digest must equal the initial native result. |
| deployment | Original deployment declaration referring to the host's existing local binding. Keep credentials in their original host-owned references. |
| receiverBindingId | The receiver's own existing reviewed local binding identity. |
| customerDirectory | Optional already completed original StacDelivery directory. This continuation only retains its configured alias; it does not create or receive a replacement customer. |

The native result must retain its `initialized`, `profile_review`, `receiver_initialized` and `receiver_review` stages. The sender's original version history must contain the completed `native-profile-review` operation and its immediate preimage. These are the actual input contract for this retained example. To operate another ordinary installation, use the general client commands in PRESCIENT.md with that installation's own saved operation.

The selected source tree must be the complete maintained distribution, including the original STAC host's declared browser assets. This runner launches the original hosts directly and consumes their managed `STAC_READY` records. The caller already owns the sender and receiver lifetimes; coordinate the same operation before invoking it.

## Run or continue

From the complete source checkout or the distribution's source directory:

```sh
node stellar-forge/mcp-merchant-operator/examples/prescient-client-retained-operation.mjs \
  /private/original-prescient-case/operator-input.json
```

Use the same original native dependency resolver as the installed distribution when its packages are provided through a retained runtime. No dependency installation is performed by the executable. All local workspace paths remain inside the selected original operation; the input file is not copied into the repository.

The runner retains its private results at `directory/client-continuation/result.json`. It also retains the exact original action file, private managed startup/connection files and the completed portable-profile download. Every stage is committed before the following stage. A completed original result is returned without launching another host.

If a process was interrupted, reconcile its owned lifetime through the original operator before invoking the same command. Continue with the same input and same directory. Completed stages and the original action identity remain authoritative. A response deliberately disconnected at the client boundary is recorded before that disconnect; continuation reads the original operation and can consume its existing result.

## What the joined operation demonstrates

The original source profile is read through Node and its portable configuration is verified. The receiver's local binding is deliberately different while the portable profile remains the same.

The first cold client dispatches the exact already retained native profile-review action. The caller then changes its original JavaScript object during connection establishment. The client must still send the immutable reviewed body and preserve its original operation ID.

After the original host returns HTTP 200 for that same action, the runner retains the response and deliberately disconnects it from the caller. The caller receives the actual ambiguous transport error. The merchant MCP adapter then reads the durable original operation and explicitly replays its unchanged body. Both return the same native completion; no new operation is created.

The command line reads that original operation and downloads the complete portable profile. A direct filesystem path submitted to the MCP action is rejected before dispatch; configured aliases remain the original operator selection.

The runner closes its original sender host, reopens that same workspace at a new local address and updates the existing managed startup file. The same Node client and MCP adapter reconnect through it, verify the same workspace and recover the same durable operation. It then opens the original receiver, verifies its own binding and the same portable configuration, and closes every owned host/client.

The result distinguishes profile configuration revision from imagery workspace revision. A saved configuration mismatch, provider SDK activation, changed operation fingerprint or different receiver binding prevents the continuation from being classified complete.

## Actual retained completion

The original joined continuation completed on 12 October 2026 at 08:01:56 UTC using the merged client source from PR1812 (643c5de0630fb7da8e729ae574fb156abc9219b4) and the released managed host source from PR1784 (7169c10e37a1800d22133efaf37cfaac5d96e343). It returned the same completed native profile-review after the lost response, preserved the caller-body snapshot, created zero new operations, downloaded the exact 1,007-byte portable profile, reconnected the same client after host rotation, and retained the original receiver's local binding. All owned lifetimes closed without errors.

The initial sparse-source launch lacked two assets already named in the original host manifest. The operator adopted those exact source files from the merged client source tree and continued the same retained operation. The completed result describes that continuation; it is separate from the original full StacDelivery/customer/GIS operation.

No provider SDK was started and no source acquisition or payment occurred in this client continuation. Its purpose is to carry an existing native completion safely across client failure and host restart. The complete customer edition and all its original files remain the artifact required for the full delivery/receiving workflow.

## Retained result fields

`status: COMPLETE` and empty `closeErrors` describe the completed run. `stages.node`, `lostResponse`, `replay`, `cli`, `reopen` and `receiver` preserve the actual workspace, original request/result hashes, file bytes/digest, receiver binding and closure outcome.

Earlier incomplete launches are retained in `interruptions` when the same executable resumes them. The same native case result and native version history remain the authority for the underlying operation. The runner's report is an operating record; it is not an alternative source of native permission, provider credentials, customer data or payment completion.
