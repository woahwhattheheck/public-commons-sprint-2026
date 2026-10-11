# Customer SDK handover in the retained release console

The existing seller release console now completes a customer handover from its
owned running seller. It generates the original JavaScript client, TypeScript
declarations, OpenAPI, package metadata and guide; retains their completion
receipt; and lists, reviews and downloads those same files after seller shutdown
or console reopening. All six HTTP methods and every original payment alternative
remain in the canonical client snapshot.

## Open the merchant's existing customer directory

```sh
node release-cli.mjs console --store /srv/merchant/releases \
  --client-exports /srv/merchant/customer-exports
```

Use the private operator URL printed by the original command. The new
**Customer SDK handover** section sits beside the existing seller, cache,
discovery and release controls. The host selects the directory at startup;
browser requests select only an export ID and original file names.

Without `--client-exports`, the console creates or reopens `STORE.clients`. For
an existing MCP merchant, select the exact directory named by its
`exportsDirectory` configuration. The standard merchant initialization creates
`customer-exports` beside `merchant-mcp.json` and `releases`. This lets the console
and original MCP operate on one retained directory. The directory must be real,
private (0700 on Unix) and accessible to the console's user. Keep it separate
from immutable release source files.

The library option is:

```js
const console = await startReleaseConsole(releaseStore, {
  port: 8425,
  clientExportsDirectory: customerExportsDirectory,
});
```

The original catalog, discovery, receiving and source-family options remain
available. Closing this console stops its own seller and download readers using
their original lifecycle.

## Generate and deliver a complete client

1. Start the intended release through this console's existing seller controls.
   The handover panel names its actual running release and mode. A selected
   release takes effect when the original seller starts or restarts.
2. Enter a stable customer export ID, such as `customer-v1`. IDs use one to 64
   lowercase letters, digits, underscores or hyphens, beginning with a letter
   or digit. The original exporter creates a new directory exclusively.
3. Select **Generate from running seller**. The original owned metadata reader
   retrieves the seller's health, offers and OpenAPI, checks that the same
   instance is still owned, and passes its exact OpenAPI bytes to the canonical
   SF30 exporter.
4. Review the completed handover. It shows the source digest, saved origin and
   mode, original release/digest/instance, all five payload identities, and the
   completion receipt. Each operation lists every original payment choice:
   zero-based option, exact atomic amount, network, asset, recipient, scheme,
   timeout and any additional metadata. Expand the original request and payment
   metadata for its complete canonical definition.
5. Select **Download complete client** for one `EXPORT_ID-client.tar.gz`. It
   contains `EXPORT_ID/` and the five original files plus `client-export.json`.
   Individual file downloads are available in the same reviewed table.

The generated client retains its exact original request and offer definitions.
Its saved mode describes the source at export time. The customer's original buyer
continues to review current terms and own authorization, signing, spending and
payment outcomes. Use the included README and declarations to build the actual
operation inputs and select an explicit payment option where multiple options
are offered.

The archive contains these exact original members:

| File | Role |
| --- | --- |
| `seller-client.mjs` | Original generated JavaScript client and request runtime |
| `seller-client.d.mts` | Matching TypeScript declarations |
| `seller-openapi.json` | Exact seller OpenAPI used to generate this client |
| `package.json` | Original package metadata |
| `README.md` | Client use, inputs, payment-option and original buyer guidance |
| `client-export.json` | Completion time, source and full-file digests, known provenance |

The browser requests the exact reviewed completion digest. The existing
`RetainedFileReads` authority verifies a selected file once and serves immutable
chunks. The archive streams those verified chunks into the original standard
ustar layout and gzip transport; it requires no second retained archive or
temporary full-package copy. Receipt time supplies archive member timestamps.

## Reopen after a lost response, stop or restart

Choose an entry in the retained list, or enter its original ID and select
**Inspect retained client**. Listing reads completion receipts in pages of 20
without reloading every SDK payload. Inspection reads and validates all five
original files before enabling complete delivery.

If a generation response is lost, inspect that same ID first. A completed
directory returns its original receipt. An incomplete directory names the
missing files; keep those retained bytes for recovery and choose a new ID when
generating a fresh client. An existing ID is never overwritten by generation.

Stopping the seller leaves all retained handovers available. Reopening the
console with the same host-selected directory restores the list and exact
completion identities. Current seller ownership is required for new generation;
inspection, adoption and download read the retained customer files directly.

**Stop download** cancels the current browser transfer and releases its reader.
Start the same reviewed download again when ready. The original individual-file
HTTP endpoint also accepts one explicit byte range, and the original MCP
downloader retains its durable chunk/checkpoint continuation. Those paths use the
same manifest and original file digest after server or MCP restart.

## Adopt an older five-file customer export

Older retained clients may contain the five canonical payloads without a
`client-export.json` receipt. Inspection reports **Legacy files retained** when
all five files exist, the JavaScript names the exact original OpenAPI digest and
the original client metadata validates.

Review their operations, all payment options and complete-files digest, then
select **Adopt these retained files**. The existing canonical adoption function
rereads that exact digest, retains today's completion receipt and preserves all
five payloads. A repeated adoption reuses its first retained receipt. The receipt
records the known export ID; original release or instance identity appears only
when it was actually retained by generation.

If any file changes after review, the digest comparison reports the changed
handover. Inspect the current original files to resolve it. An incomplete or
invalid directory remains available for the host's original file recovery.

## Original MCP and HTTP operations

`MerchantClientExports` extracts the original MCP client operations into one
implementation used by both surfaces. `operator.mjs` retains its existing tool
registration, mutation serialization and owned seller lifecycle.

| Operation | Behavior |
| --- | --- |
| `merchant_client_export_list` | Lists original entries, with optional `after` and `limit` (1–50) |
| `merchant_client_export_status` | Original full-file inspection; optional `includeOffers: true` returns the canonical snapshot |
| `merchant_client_export` | Original owned-seller generation and complete provenance |
| `merchant_client_export_adopt` | Original reviewed five-file adoption |
| `merchant_client_export_manifest` | Original retained receipt and its digest |
| `merchant_client_export_file` | Original immutable, digest-pinned chunk reader |
| `merchant_client_export_file_release` | Releases only that original reader |

The existing [MCP client guide](../../../stellar-forge/mcp-merchant-operator/CLIENT_EXPORTS.md)
contains the original download and restart commands. Existing tool defaults and
reply fields remain compatible.

The console's existing session capability and origin checks apply to all
customer endpoints:

| Endpoint | Input |
| --- | --- |
| `GET /api/clients` | Optional `after`, `limit` query fields |
| `GET /api/clients/inspect` | `exportId` |
| `POST /api/clients/generate` | JSON `{id, instanceId}` for this console's owned seller |
| `POST /api/clients/adopt` | JSON `{exportId, expectedFilesSha256}` from inspection |
| `GET /api/clients/download` | `exportId`, `expectedManifestSha256` for the complete archive |
| `GET /api/clients/download` | The same fields plus `file`, `expectedSha256` for an individual file |

Individual downloads advertise the original full-file SHA-256 and ETag, and
support `Range: bytes=4096-` or an explicit ending byte. Preserve the same reviewed
manifest and file digests when joining a previous prefix to a range response.
Complete archives restart as a whole. At most two console downloads run at once;
the shared reader retains its existing file, snapshot and idle-expiry limits.

The original source-only distribution already includes the full SF82, SF30 and
merchant-MCP directories. Its existing `releases` and `merchant-mcp` commands carry
this workflow in the next cumulative source cut.
