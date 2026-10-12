# Original MPP and Applications receiving operation

This carrier runs the original Product4 merchant/customer operation and the merged managed Applications receiving command in one owned native runtime. The SDK receiver streams the exact published dependency archives and retains an opportunistic 4 MiB archive cache. The original execution source, TLS setup, configuration, native SDK calls and complete customer file receiver remain the selected Product4 operation.

## Exact inputs

| Input | Git pin |
| --- | --- |
| Original source | 9ef475062876557d6baf14e0e5414d7afbf3bc7f |
| Git object receiver | b4cfcbad88e1d076625e8f59badf315f08f9c23f |
| SDK runtime receiver | 0f1be6df1c47f8f8fb9517dcaee5b708c71aa4d6 |
| Applications receiving caller | e9fdd60207a7c706ab547ba68d60f53f504e53ec |
| Original execute.mjs | d62e3505df0e192d28e510bf04a893166e6a0185 |

The carrier verifies the exact three receiving script Git object IDs before dispatch. Its Git receiver verifies the original commit/tree/blob closure and materializes the selected source. The SDK receiver checks the original package lock and archive integrity. The managed caller verifies the original installed READY runtime and its actual private data identity.

The source packet beside this document is 430,362 bytes with SHA-256 e88010db7854addc90d348d66af44ab349565cb2676b4dc4b162f90347837827. Extract it into the selected private source-packet directory, preserving 9ef475-metadata.json.gz and incoming/. Supply the existing original read-only Git donor separately. Its objects are borrowed read-only by the receiver.

The maintained SDK receiver is available at merged 3a1d9c5265796b0e1356f7f761fa075e0dd28a95 under stellar/scf-starforge-20261009/mpp-charge/runtime-receiving.py. The receiving caller is available at merged b78c3d16b1e7a706f9dfc749a687d301744525d1 under stellar/scf-starforge-20261009/distribution/receiving/mpp-managed-reception.mjs. The Git receiver is available at merged 7e50d3be41a4af197fe60d124b0600bc97af4653 under stellar/scf-starforge-20261009/distribution/git-object-receiving.py.

## Start in the original accepted host

Use absolute canonical paths and private owned directories. Node 24, Python 3, OpenSSL and the existing original Applications runtime are used.

```sh
python3 receive-original-mpp.py \
  --run-directory /private/mpp-original-run \
  --records-directory /private/mpp-original-records \
  --source-packet /private/source-packet \
  --donor-repository /actual/original/source.git \
  --git-receiver /actual/git-object-receiving.py \
  --runtime-receiver /actual/runtime-receiving.py \
  --application-caller /actual/mpp-managed-reception.mjs \
  --following-ready /private/following-ready.json \
  --node /actual/node24/bin/node \
  --cache /private/mpp-original-cache \
  --cache-limit-bytes 4194304
```

The one original operation identifier is SCF-MPP-APPLICATIONS-NATIVE-20261012-EB459. Reconcile the current process before moving this invocation to another host. The run directory owns a process lease, source materialization, exact SDK installation, original workspaces, TLS files, Apps inputs, customer bundles and logs. The records directory retains mpp-original-complete-native-result.json.gz, containing complete phase logs and original result documents. Records and environment files are private.

The carrier executes the original source-native Product4 execute.mjs once in a fresh native state. If its complete native result is retained in the same run directory, continuation reopens that result and proceeds to the original Applications roles. An interrupted original native phase retains its actual data and log for direct reconciliation. Receiving retries reuse the original role input and journal.

## Following READY descriptor

The existing source/runtime owner supplies this actual private 0600 JSON file:

```json
{
  "schema": "stellar-forge.mpp-following-ready.v1",
  "applicationsDirectory": "/actual/original/applications/workspace",
  "runtimeDirectory": "/actual/original/following-ready-runtime",
  "expectedRuntime": {
    "sourceCommit": "ACTUAL_INSTALLED_SOURCE",
    "sourceManifestSha256": "ACTUAL_SOURCE_MANIFEST_SHA256",
    "installationId": "ACTUAL_INSTALLATION_ID",
    "profileId": "ACTUAL_PROFILE_ID"
  }
}
```

The installed source must contain the merged native MPP Applications adapter and Product4 readiness/identity implementation. The earlier c287 source cut predates the MPP adapter. The maintained runtime inspector and original Applications source checks determine the installed identity.

The carrier keeps its original native runtime alive while awaiting this descriptor. An optional --following-timeout can select a finite wait on a durable host. On command-local ephemeral storage, keep the default continuous wait so the actual SDK and customer/merchant states remain available.

## Complete receiving

Customer and merchant are the original Product4's separate private workspaces. The customer pass opens the same original two retained purchases, previews the source-native report request, reviews and saves the selected customer configuration, receives the complete original customer files, closes/reopens the operator, and runs original Stop/restart. The merchant pass receives its contract and customer package, starts the original native SDK listener, observes its health and actual HTTP 402 challenge, stops it, and finishes the same Applications lifecycle.

Each pass retains its own original request/review/application/operation IDs and file hashes. The final record contains both completed role results and all original native results. The original Applications receiving guide documents the resulting editable clients, examples, export files and private recovery journal.
