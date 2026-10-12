# Prescient through the original STAC client

The Node client, `starforge stac-workspace` command and merchant MCP server now
use the Prescient controller in the same running STAC host. They expose the
complete saved profile, review, approval, explicit SDK connection, customer
delivery review, portable export and receiving workflow.

The [Prescient operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/OPERATOR.md)
owns deployment and source requirements. This client uses that controller's
existing private session, cookie, CSRF, workspace identity, configuration
revision and durable operation records. It does not create an SDK, another
workspace or a replacement customer delivery.

## Select the original installation

Start or retain the original `prescient-serve` installation using the operator
guide. Its private startup record contains `url` and `workspaceId`; a managed
`STAC_READY` record has the same fields and is accepted directly. Keep the
startup and connection files owned by the operating user, with mode 0600 in a
0700 directory.

```sh
starforge stac-workspace connection-init \
  --out /private/prescient-connection.json \
  --console-url-file /private/prescient-startup.json \
  --workspace prescient

starforge stac-workspace prescient-status \
  --connection /private/prescient-connection.json
```

An operator may add retained customer directories to that private connection
file. Relative directories resolve beside the connection file. They still have
to be within the original server's configured `deliveryRoots`.

```json
{
  "schema": "stellar-forge.stac-workspace-connection.v1",
  "workspaces": {
    "prescient": {
      "label": "Customer imagery installation",
      "consoleUrlFile": "./prescient-startup.json",
      "timeoutMs": 300000,
      "inputs": {},
      "processingProfiles": {},
      "prescientDeliveries": {
        "source": {
          "label": "Original completed customer delivery",
          "directory": "./received-original-customer"
        },
        "received": {
          "label": "Copied complete Prescient receiving package",
          "directory": "./received-portable-customer"
        }
      }
    }
  }
}
```

For a receiving directory, the operator can also set `manifestSha256` to the
exact `prescient-receiving.json` logical manifest digest returned by the native
export. The `delivery-open` caller must supply that same digest. This is a
receiving pin, not a hash of a ZIP or a replacement for native file verification.

`merchant_stac_workspaces`, `merchant_stac_inputs` and
`merchant_stac_prescient_status` list the configured aliases and labels. Agent
action inputs select `delivery: "source"` or `delivery: "received"`; they cannot
supply a raw directory. The Node client's direct `prescientAction` API accepts
the original absolute directory and relies on the original server's root
selection. Neither interface accepts credential values. The profile names an
existing local `bindingId`; its env file and native SDK remain host owned.

## Read the two revisions correctly

`prescient-status` returns `configuration.revision`, the selected profile,
binding choices, public SDK/session metadata, receiving progress and saved
record counts. Reading it never starts the SDK or refreshes authentication.

The Prescient configuration revision is independent of
`status.native.revision`, which belongs to the imagery workspace. Prescient
writes use the former. Queries, analyst decisions and other imagery writes use
the latter.

```sh
starforge stac-workspace prescient-records \
  --connection /private/prescient-connection.json \
  --kind profiles --limit 50

starforge stac-workspace prescient-record \
  --connection /private/prescient-connection.json \
  --kind reviews --id SAVED_REVIEW_ID --revision CURRENT_CONFIGURATION_REVISION
```

Record kinds are `profiles`, `reviews`, `approvals`, `deliveryReviews`,
`deliveries` and `operations`. Continue a page with its `nextOffset` and
returned `revision`; offsets after the first page require `--revision`.
A changed configuration rejects continuation instead of mixing versions.

The MCP equivalents are `merchant_stac_prescient_records` and
`merchant_stac_prescient_record`. A record includes its complete original
source/review values and actor. For a larger full state, use the existing
`merchant_stac_file_read` with `kind: "prescient-state"`, then retain its
`readId`, `expectedSha256` and `nextOffset` through all chunks.

## Retain and dispatch a complete action

Every action requires the original `actor`, one stable `operationId` and the
current Prescient `expectedRevision`. Save those fields together with the
action's complete input before dispatch. The following is the shape of a CLI
`--args-file` or an MCP action input; replace the sample identity and revision
with the actual saved values.

```json
{
  "workspace": "prescient",
  "name": "profile-review",
  "input": {
    "profileSha256": "THE_ORIGINAL_64_CHARACTER_PROFILE_SHA256"
  },
  "actor": "Customer operator",
  "operationId": "customer-profile-review-01",
  "expectedRevision": 12
}
```

```sh
starforge stac-workspace prescient-action \
  --connection /private/prescient-connection.json \
  --args-file /private/profile-review-command.json
```

Use `merchant_stac_prescient_action` for the same exact object in MCP.
Alternatively, CLI flags accept `--name`, `--input-file`, `--actor`,
`--operation-id`, `--revision` and `--delivery`.

| Action name | Complete action-specific `input` | Result and next saved selection |
| --- | --- | --- |
| `profile-save` | `{profile}` | Saves an immutable profile revision; retain its SHA256. |
| `profile-import` | `{profile,bindingId}` | Verifies the full portable profile and binds it to a receiver's existing local binding. |
| `profile-review` | `{profileSha256}` | Retains the exact native review; retain its ID and SHA256. |
| `profile-approve` | `{reviewId,reviewSha256}` | Approves that saved review. A different approved profile may require the original host to reopen. |
| `connect` | `{}` or `{refresh:boolean}` | Explicitly opens the original configured SDK. |
| `session` | `{}` or `{refresh:boolean}` | Explicitly reads or refreshes the native SDK session. |
| `delivery-review` | `{}`, plus top-level `delivery` alias | Opens and verifies the original complete customer directory, preserving its catalog, edition, selected members and native bindings. |
| `delivery-export` | `{reviewId,reviewSha256}` | Creates the portable customer package in the server's configured export root. |
| `delivery-open` | `{manifestSha256}`, plus top-level `delivery` alias | Verifies the independently received package, original source/files and locally reviewed profile. |

The full `profile-save` profile uses the native `name`, `endpoint`,
`authMode`, optional OAuth `identityProvider`, local `bindingId`,
`allowedOrigins`, `collections`, `allowedS3`, `maxAssetBytes`, `rights`
and optional `refreshSkewSeconds` fields. Use the original form/export and
operator guide for those reviewed values. There is no token, password,
environment-file path or arbitrary request-header field.

Among these Prescient administration actions, only `connect` and `session`
start or refresh the native SDK. Original imagery discovery and acquisition also
use the approved original source adapter and can open its configured SDK. Profile review and customer package verification retain their existing
offline behavior; they do not purchase or reacquire source data.

## Carry the full customer result to its receiver

A source alias must contain an actual original `StacDelivery` customer:
`manifest.json`, `selection.json`, `native-bindings.json`, the original
dataset acquisition/delivery and all referenced edition/member files. An analyst
workspace, commissioning archive or screenshot is a different artifact.

Review that directory and inspect the retained review. Export using the review
ID and hash, with a separate saved operation ID. Preserve the returned
`manifestSha256`, `portableManifestSha256`, original source bindings and complete
output directory. The original exporter retains the profile and receiving
manifest beside all customer bytes.

Copy the complete package through the existing handover workflow. On the
receiving host, import the portable profile with an explicit receiver
`bindingId`, then review and approve that new local profile. The portable
profile cannot install the sender's binding. If the newly approved profile
differs from the running selection, reopen the original host before receiving.

Configure the receiving directory alias and run `delivery-open` with its actual
receiving manifest digest. The native controller verifies the same edition,
query, selection, source/native bindings, file hashes, collection scope, rights
and asset limits. Its `providerRequests: 0` receiving result describes local
verification of already acquired data.

Download the exact portable profile separately when configuring the receiver:

```sh
starforge stac-workspace download \
  --connection /private/prescient-connection.json \
  --kind prescient-profile --profile-sha SAVED_PROFILE_SHA256 \
  --out /private/new-portable-profile.json
```

The profile's own portable digest differs from the saved profile digest because
the portable configuration excludes the sender's binding. Both are retained.
The client checks the portable digest before returning it. Downloads use the
original complete-file publication: no overwrite, full bytes and returned SHA256.
The entire customer package remains the original directory handover; this client
does not substitute a metadata-only export for it.

## Continue after a lost response or host restart

A transport error on a POST may be `ambiguous: true`. The CLI preserves that
flag, the original `operationId` and native error code. Read:

```sh
starforge stac-workspace operation \
  --connection /private/prescient-connection.json \
  --operation-id customer-profile-review-01
```

The result separates `prescient.operation` and its configuration revision from
imagery and processing operations. Recent in-memory jobs may be absent after
restart; the durable Prescient record remains the authority.

If the original action is complete, consume that result. If an explicit retry is
appropriate, use the same complete saved action file, including the original
operation ID, actor, input and revision. Do not generate a replacement operation
ID or update the saved revision merely to make the retry pass. The native
controller reconciles the original fingerprint before accepting a new write.
Conflicting inputs remain a native error.

After the operator restarts the same installation, atomically update the same
private startup file with the new original startup record. The client rereads it,
establishes the new session and verifies the same workspace ID before a workspace
request. It refuses a file that points to another workspace. Disconnecting a CLI
or MCP client closes only that client's reads; original host ownership remains
with its operator.

## Node use

```js
import {
  readStacWorkspaceConfiguration,
  StacWorkspaceClient,
  saveStacFile
} from './stac-workspace-client.mjs';

const configuration = await readStacWorkspaceConfiguration(connectionPath);
const client = new StacWorkspaceClient(configuration.workspaces.prescient);
try {
  const state = await client.prescientState();
  const portable = await client.prescientProfile(state.selectedProfileSha256);
  // retainedCommand is the unchanged actor/operationId/revision/body saved before dispatch.
  const result = await client.prescientAction('profile-review', retainedCommand);
  await saveStacFile(client, {
    kind: 'prescient-profile',
    profileSha256: state.selectedProfileSha256
  }, newOutputPath);
} finally {
  client.close();
}
```

The maintained declarations describe `PrescientProfile`,
`PortablePrescientProfile`, `PrescientOperatorState`,
`PrescientActionFields` and the action-specific body union. The API forwards
native values and exposes the original action result; there is no parallel
profile or receiving implementation in this client.

## Retained native client continuation

The [complete retained-operation guide](PRESCIENT_CONTINUATION.md) and its maintained executable carry the original configured sender and receiver through an actual lost response, immutable caller-body dispatch, original MCP reconciliation, CLI file download and same-client host restart. It uses the existing native operation and never substitutes for the complete StacDelivery customer receiving workflow.
