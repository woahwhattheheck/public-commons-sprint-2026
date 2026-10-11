# Customer SDK handover for a retained fleet

Use the existing fleet workspace, foreground CLI, or merchant MCP provider to generate and deliver a customer SDK from the exact merchant instance you own. Each tenant and release slot has its own retained export directory. The same export stays inspectable and downloadable after that slot stops, another release begins serving, or the fleet is reopened.

The desk calls the original SF82 customer exporter and retained-file reader. Its output is the original JavaScript client, TypeScript declarations, OpenAPI document, package metadata, README, and completion receipt. The receipt binds the release ID, release digest, owned instance, offers, and each original file's byte count and SHA-256.

## Open the existing fleet

Start the managed workspace with the original plan and release-state directory:

```sh
starforge merchant-fleet-workspace --releases ./fleet/fleet-plan.json \
  --release-state ./fleet --port 8402
```

The `--releases` and `--release-state` options select the plan and directory already created by the fleet setup workflow. See [BOOTSTRAP.md](BOOTSTRAP.md) for first use and [RELEASE_OPERATOR.md](RELEASE_OPERATOR.md) for the existing managed lifecycle.

In **Managed releases**, choose **Customer SDKs** beside a tenant's slot. You can also select the merchant and slot directly in the **Customer SDK handover** section. The ownership line identifies the selected slot's current release and instance. A stopped slot exposes its saved exports; generating a new export requires a live instance owned by this workspace.

## Generate and review a customer delivery

1. Select the merchant and slot. Verify the ownership line and enter a new export ID, such as `customer-acme-20261011`.
2. Choose **Generate customer SDK**. The original exporter reads the owned merchant's health, offer catalogue, and OpenAPI document, and checks that the instance remains current while reading them.
3. Inspect the completion receipt. Review the original public operations and exact payment terms, the release and instance identity, and the files' hashes before downloading.
4. Download the complete `.tar.gz` package or an individual original file. The package includes all five payloads and `client-export.json`.
5. Give the customer the generated README, client, declarations, OpenAPI document, package metadata, and receipt together.

The public origin and offer terms come from that merchant's own OpenAPI source. An export ID is immutable within its tenant and slot. If a response is lost or the ID already exists, inspect that ID to recover its saved state. Use a new ID for a changed release or a different customer delivery.

The same ID may exist in two different slots or tenants. The page keeps those contexts separate, displays their scope, and uses the selected tenant and slot on every request. Changing scope stops and awaits an active browser transfer before clearing the old review. The export-ID field is retained independently for each scope.

### Completed, legacy, and interrupted exports

A completed export has an original `client-export.json` receipt. Inspection verifies its exact files and shows the original provenance and offers.

An older original five-file export can be completed explicitly after reviewing its `filesSha256`. Choose the adoption action for that inspected digest. Adoption retains those exact existing files and writes the original completion receipt. An incomplete or changed export remains visible with the original recovery reason; generation does not overwrite it.

A byte or receipt mismatch requires a fresh inspection. The desk does not silently replace a reviewed manifest with another generation.

## Foreground CLI

Open the same original lifecycle owner:

```sh
starforge fleet-release start \
  --plan ./fleet/fleet-plan.json \
  --directory ./fleet
```

The following are commands entered in that foreground session. Read `status` for each slot's current `instanceId`.

| Command | Result |
| --- | --- |
| `client-list TENANT SLOT [AFTER [LIMIT]]` | Page retained exports in one declared slot. |
| `client-inspect TENANT SLOT EXPORT_ID` | Verify the saved payloads and review completion, provenance, and offers. |
| `client-generate TENANT SLOT INSTANCE_ID EXPORT_ID` | Generate through that exact live owned instance. |
| `client-adopt TENANT SLOT EXPORT_ID FILES_SHA256` | Complete the inspected original legacy files without regenerating them. |
| `client-manifest TENANT SLOT EXPORT_ID` | Read the original manifest, manifest digest, and exact file descriptors. |
| `client-download TENANT SLOT EXPORT_ID MANIFEST_SHA256 DESTINATION` | Save all original files with the existing durable download writer. |

For example, after taking the actual manifest SHA-256 from `client-manifest north blue customer-acme-20261011`, enter:

```text
client-download north blue customer-acme-20261011 ACTUAL_MANIFEST_SHA256 "/tmp/Client  A"
```

The quoted destination uses JSON string syntax. Its exact spaces are preserved. The destination must be new and empty, or the existing directory for that same retained download. Its parent directory must already exist.

Repeat the same command and destination after an interruption. The original writer holds a private local lease, records verified offsets and hashes, resumes only that same manifest, and publishes the completion receipt after every original payload is complete. A changed tenant, slot, plan identity, export ID, manifest, or existing file is rejected. Retrying does not regenerate the SDK or issue a payment.

## The same merchant MCP provider

Configure the existing fleet through `starforge merchant-mcp init-fleet --dir NEW_MCP_DIRECTORY --plan ORIGINAL_FLEET_PLAN --fleet-directory ORIGINAL_FLEET_DIRECTORY`, then start the existing authenticated MCP transport. Keep its bearer token in the configured environment variable.

The following tools use the original fleet owner's selection and retained files. All require `tenant` and `slot`; the fields below are additional.

| Tool | Additional fields |
| --- | --- |
| `merchant_fleet_client_list` | Optional `after` and `limit`. |
| `merchant_fleet_client_status` | `exportId`. |
| `merchant_fleet_client_generate` | `id` and the current `instanceId`. |
| `merchant_fleet_client_adopt` | `exportId` and inspected `expectedFilesSha256`. |
| `merchant_fleet_client_manifest` | `exportId`. |
| `merchant_fleet_client_file` | `exportId`, original `file`, `expectedManifestSha256`, `expectedSha256`; optional `offset`, `limit`, `readId`. |
| `merchant_fleet_client_file_release` | `exportId` and the original `readId`. |

Read the manifest before requesting files. Select a name and digest from that manifest, then retrieve the original bounded chunks. Chunk limits remain 196,608 bytes. Reuse the returned `readId` while advancing the verified offset and release it when finished or cancelled. If a temporary read has expired, resume from the retained offset with the same original file and manifest hashes and obtain a fresh read ID.

The SDK desk shares the existing serialized owner for generation and legacy adoption. File inspection and reads keep their original read-snapshot lifetime and remain useful when the merchant itself is stopped. Shutting down the provider cancels fleet staging and client transfers before it waits for an active request, then performs the existing fleet and merchant cleanup.

## Retention and reopening

The original files live below:

```text
FLEET_DIRECTORY/clients/TENANT/SLOT/EXPORT_ID/
```

These private real directories use the original customer-export format. The operator validates tenant and slot against the current declared plan before selecting any directory. Browser and MCP views return scoped identities without exposing host directory paths.

Reopen with the same fleet plan and directory to recover listings, manifests, offers, and downloads. Slot retirement and rollback preserve the saved SDKs. Generating from a replacement instance creates a separate delivery when you provide a new ID; it does not change the older customer's files.

One process owns a release directory at a time. Close the workspace before opening the foreground CLI or a separately hosted MCP owner on that directory. The shutdown path stops active transfers before draining HTTP requests, retains completed export files, and closes the existing readers and release sessions.

For the generated client's actual request, payment, operation, and retry APIs, use its saved README and the original [customer SDK handover guide](../../../stellar-forge/mcp-merchant-operator/CLIENT_EXPORTS.md).
