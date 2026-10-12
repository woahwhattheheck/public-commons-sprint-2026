# Retained NDJSON merchants

The JSON Lines console keeps each complete prepared merchant in its original
workspace. Prepare a reviewed edition once, close and reopen the console, then
select or download that same merchant. The retained ZIP includes the original
source and mapping, native CSV and dataset configuration, full lineage, public
payment terms, seller configuration, OpenAPI, operating guide and all six
generated customer SDK files.

Repeated downloads verify the saved bytes and stream the existing ZIP. They do
not run the merchant compiler, generate another customer SDK, create another
temporary full package or hold the workspace writer while the client downloads.
The source workspace owns its original lifetime lock, dataset engine and saved
source/build records. There is no additional service or database.

## Browser workflow

Start the installed NDJSON console for an initialized source workspace:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/source serve \
  --connection-file /absolute/private/source-console.url
~~~

Retain the complete source, save its explicit field mapping and build the original
dataset as described in [README.md](README.md). In **Merchant & recovery**, select
that reviewed build, public HTTPS origin, route and original x402 payment object.
**Prepare and retain merchant** saves the complete package and returns its ZIP
SHA-256, source/plan/build identities and native snapshot.

**Saved merchant packages** lists completed preparations and received merchants.
**Verify and reopen** checks all sixteen prepared files and the complete ZIP.
**Download saved package** returns those exact bytes without compiling. A later
source edition or different payment/origin/path prepares a separate package;
earlier merchants remain selectable.

Preparation is local authoring. It does not deploy a service, make a paid query,
purchase a provider entitlement or perform settlement. Enter actual approved
public payment values; the unchanged original compiler validates them.

## CLI preparation and recovery

The existing one-off merchant command with --out NEW_DIRECTORY remains available.
For retained preparation, use:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/source merchant-save \
  --build ORIGINAL_BUILD_SHA256 \
  --payment /absolute/private/reviewed-payment.json \
  --origin https://data.example.com --path /data \
  --request-id supplier-merchant-20261012

starforge dataset-ndjson --workspace /absolute/private/source merchants

starforge dataset-ndjson --workspace /absolute/private/source merchant-show \
  --id PACKAGE_ZIP_SHA256

starforge dataset-ndjson --workspace /absolute/private/source merchant-download \
  --id PACKAGE_ZIP_SHA256 --out /absolute/private/ndjson-merchant.zip
~~~

The example origin and identifiers are placeholders. Select the actual reviewed
resource and original build.

An optional request-id binds the operation to its complete build/payment/origin/
path selection. Retry the same ID and exact input after an interrupted reply.
Changed input under that ID is refused; use a new ID for a different reviewed
preparation. Without an explicit ID, the full selection determines the request,
so repeated browser submissions recover the original result.

The result contains the original merchant manifest, archive bytes/SHA, retained
prepared directory and download route. Use its directory with the unchanged
native merchant commands:

~~~sh
starforge dataset-ndjson-merchant status --prepared RETURNED_DIRECTORY
starforge dataset-ndjson-merchant serve --prepared RETURNED_DIRECTORY --port 8423
~~~

Select the original seller's reviewed facilitator configuration when settlement
is required. Default challenge-only behavior and SF82 release tooling are
unchanged. Follow the prepared OPERATING.md and customer/README.md for the
selected resource.

A download publishes the complete ZIP exclusively. It reuses an existing output
only if all bytes match; it never replaces a different file.

## Receive and reopen the full merchant

Choose **Receive a complete merchant** in the receiving browser, or use:

~~~sh
starforge dataset-ndjson --workspace /absolute/private/receiver init
chmod 600 /absolute/private/ndjson-merchant.zip
starforge dataset-ndjson --workspace /absolute/private/receiver merchant-receive \
  --file /absolute/private/ndjson-merchant.zip
~~~

When continuing an initialized receiving workspace, omit init. The original
console or CLI must be its one owner.

Receiving accepts the original sixteen-file merchant ZIP, including earlier
packages produced by POST /api/merchant. It checks the exact roster, root/customer
paths, regular file types, bounded complete decompression, CRC and every manifest
hash. It invokes the original merchant validator, retains the source and mapping
through their original methods, and rebuilds the dataset using the original
expected-lineage checks. Source/plan/build IDs, CSV/configuration and native
snapshot must agree.

The complete uploaded ZIP remains byte-for-byte unchanged. Its SHA-256 is the
package ID. Receiving it again recovers the same request and result. Distinct ZIP
encodings with equal member contents can have different package IDs; the receiver
does not replace either encoding.

The original source, mapping and build appear in the receiving console's normal
query and comparison screens. The saved prepared directory can immediately use
the original merchant status, serve and SF82 release commands. No vendor,
payment or new source-acquisition call occurs during receive.

The separate six-file source-project ZIP continues through source project import
or CLI import. Merchant receiving does not reinterpret that format.

## Existing merchant MCP

The adapter attaches to the same running private console; browser and agent share
the original saved workspace. See [SOURCE_WORKSPACES.md](../../../../stellar-forge/mcp-merchant-operator/SOURCE_WORKSPACES.md)
for connection documents and the existing transport.

| Tool | Result |
| --- | --- |
| merchant_source_merchant_save | Prepare once using build, payment, origin, path and optional requestId |
| merchant_source_merchants | Page the saved catalog with existing snapshot pagination |
| merchant_source_merchant | Verify/reopen the selected merchant package ID |
| merchant_source_merchant_export | Retain that exact ZIP in the adapter's existing resumable export store |
| merchant_source_merchant_receive | Receive a declared merchant file or original retained merchant export |

The existing merchant_source_merchant_prepare and POST /api/merchant remain
compatible: they return the full ZIP through the original export store. Their
native preparation now recovers the retained package instead of recompiling on
each request.

For a complete MCP transfer:

1. Save the producer package and retain its original ID.
2. Export it with merchant_source_merchant_export. The exportId is the same ZIP hash.
3. Use merchant_source_file_read and its original readId/nextOffset, or call
   merchant_source_merchant_receive on the receiving alias with exportId and
   fromWorkspace.
4. Reopen the receiving browser and inspect the reconstructed build and merchant.

A declared connection file can also contain a handle with kind "merchant", the
private ZIP path and optional reviewed sha256. Pass that handle as file.
Receiving accepts exactly one file handle or retained export. Agents cannot pass
arbitrary host paths or redirect the original console capability.

The existing MCP export capacity remains 256,000,000 bytes for merchant ZIPs.
Larger packages use native CLI/HTTP. Native retention bounds each original member
to 256 MiB, the merchant manifest to 1 MiB, and compressed/expanded complete
packages to 4 GiB. File hashing, copying, ZIP creation and extraction use bounded
streaming chunks.

## Original HTTP interface

All routes use the existing private bearer capability and Host/Origin checks.
No public route or additional listener is added.

| Method / route | Request and response |
| --- | --- |
| POST /api/merchants/prepare | Four original selection fields, optional requestId; saved package metadata |
| GET /api/merchants | Complete lightweight saved catalog |
| GET /api/merchants/package?id=SHA256 | Verified original merchant and ZIP identity |
| GET /api/merchants/download?id=SHA256 | Exact saved ZIP bytes |
| POST /api/merchants/receive | Full ZIP with one Content-Length; received metadata |
| POST /api/merchant | Original four-field request and ZIP response, now retained |

GET /api/state adds merchants while preserving sources, plans, builds and
comparisons. Preparation, publication and receiving use the original mutex.
Upload and immutable download streaming run outside it.

## Installed source and Applications

Use a complete maintained Starforge runtime from one selected source commit.
The existing distribution includes the entire SF30 seller SDK, merchant MCP and
Applications components, and resolves their static imports. Its normal source
format filter includes the new Python module; no additional dependency package,
installation command or alternate package builder is introduced.

The console imports merchant_packages.py beside application.py and keeps the
existing ndjson_source.py, shared XML workspace/server/native engine, and original
Node merchant.mjs compiler. The compiler still uses the maintained native dataset,
seller, OpenAPI, customer SDK and SF82 release source. Keep those original runtime
components and their selected dependency profile together; copying only the new
Python file is not a complete installed application.

Both managed.py and distribution/runtime-workspace/application-ndjson.mjs bind the
same fifteen console source files, including merchant_packages.py. Applications
therefore reviews the new module with the original workspace identity and Python
selection. A source upgrade requires the normal application review/start sequence;
a stopped application then reopens its same source workspace and saved merchant
IDs. Existing application and distribution operations retain their own selected
release and recovery controls.

The new source uses Python's standard library and the original runtime modules.
MCP continues through its current source-workspace and catalog modules. All
browser assets are the original console's local index, script and stylesheet.
No vendor SDK or new network service is needed for saved-package selection,
verification, download or receiving.

## Interrupted work and capacity

The complete request is retained before compilation. Generated files, archive
and compact package record are flushed before publication; the result pointer is
written last. Retry recovers a completed stage or published orphan using the
same original request. A saved terminal result is read before current source
state is consulted.

The compiler/validator inherits the original workspace lease on POSIX. A child
that outlives its parent keeps that workspace owned until it exits. Only an
incomplete generated stage with the exact expected file names can be discarded
and regenerated; unknown files/directories remain for inspection. Completed
saved packages are never overwritten or deleted by a retry.

Complete-file publication is exclusive. On POSIX, its temporary name is bound to
the destination and the publishing process holds a native file lock through
publication and alias removal. If that process ends between the two steps, the
same workspace can remove only its recognized, private, same-inode stage aliases
after acquiring that file lock and accounting for every additional link. A live
publication owner or any unrelated link stops recovery without removing those
links. Ordinary retained reads still require a single-link file. On Windows,
exclusive rename publishes the closed stage without creating a second link.

A failed receive can leave valid source/mapping rows, as in the original project
importer. Continue with the same ZIP: original content IDs recover those rows
before the expected build is checked again. Unverified merchants do not enter
the completed catalog. Failed archive stages never become published outputs.

Keep the full prepared directory and ZIP with the authorized operator because
they include the original source. The generated customer/ directory remains the
ordinary client delivery described in its own guide. Nothing is automatically
published or sent.
