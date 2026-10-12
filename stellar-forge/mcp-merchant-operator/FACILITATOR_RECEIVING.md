# Receive the complete Huwise facilitator operation

Run the installed Huwise product against an existing, completed merchant
workbench. This programme joins the original native facilitator review and SF82
release staging, complete typed client downloads, the actual desktop and phone
browser, and offline customer receiving in one retained operation.

The original merchant export, capture, analyst notes, source release and buyer
requests remain the starting authorities. Provider reviews use the installed
native SDK and the actual host profiles. Compatible observations stage a
derived release through the original SF82 engine. The programme closes the
merchant host, reopens those committed stages through the original workbench
without a facilitator configuration, and verifies the full delivered files
after the host closes.

This command performs the compatibility read and reviewed stage that its
input requests. It does not capture another dataset, create a purchase,
activate the staged release, start the seller, or settle a payment. Existing
paid receiving records stay attached to their original merchant. Use the
ordinary merchant lifecycle if a later, separately chosen release should
be activated.

## 1. Receive and install the selected source

Use Linux, Node.js 24 or later, the original Huwise selected distribution,
and its maintained native runtime. Keep the existing operating project and
this receiving directory under separate owned private paths. The original
project must already have its seller-releases directory, complete merchant
export and source release.

Build the exact chosen source edition with the maintained builder:

~~~sh
node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-checkout \
  --ref ORIGINAL_COMPLETE_COMMIT \
  --selection huwise \
  --out /absolute/private/huwise-selected-release \
  > /absolute/private/huwise-build-result.json
~~~

The builder returns the original archive path, SHA-256, sourceCommit and
sourceSelection. Keep that complete JSON response and the actual TGZ. Its
sourceSelection.id must be huwise. The receiver also accepts the original
source-receiving wrapper result whose distribution member contains this same
builder response.

For an interrupted source build, use the builder's --resume operation against
the same output and immutable commit. If all source objects have already been
received, use its --offline option. A new source edition belongs in a new
selected-build output; preserve the older build, donor cache and provider
operation identities. The Git-object receiver can reuse those unchanged
objects while verifying the explicit successor's commit, tree and complete
dependency closure.

Prepare and continue the original native runtime through its own installer:

~~~sh
node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/private/huwise-runtime \
  --archive /absolute/private/huwise-selected-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/private/huwise-runtime

node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/private/huwise-runtime --load --source
~~~

Use the installer's existing dependency adoption or cache receiving when a
complete matching runtime is already available. Installation does not require a
new provider review or purchase. Keep every returned installation and source
receipt with the original operation.

Define the installed dispatcher in this terminal:

~~~sh
starforge() {
  node /absolute/toolkit/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /absolute/private/huwise-runtime -- "$@"
}
starforge merchant-huwise-facilitators-receive --help
~~~

This invokes the prepared private runtime. It does not depend on a global
starforge binary.

The command is implemented by the full three-file cohort beside
examples/opendatasoft-facilitator-receiving.mjs:
opendatasoft-facilitator-browser.mjs and opendatasoft-facilitator-files.mjs.
Keep this guide with them. The selected contribution declares the command and
support files; the original dependency walker supplies the unchanged shared
workbench, merchant MCP, SF82, client, browser and downloader modules.

## 2. Bind the original operating inputs

Read the current original workbench through its owning interface. Select its
complete merchantExportId and the source release already derived from that
merchant. The input must use actual returned IDs. The placeholder below is a
shape example; replace every placeholder before execution.

~~~json
{
  "schema": "stellar-forge.opendatasoft-facilitator-receiving-input.v1",
  "operationId": "huwise-facilitator-receiving-original",
  "parentOperation": "ORIGINAL_PARENT_OPERATION",
  "merchantExportId": "ORIGINAL_MERCHANT_EXPORT_UUID",
  "releaseId": "original-source-release",
  "providers": [
    {
      "provider": "vellar",
      "id": "original-vellar-derived",
      "label": "Original Huwise service through Vellar",
      "exportId": "original-vellar-customer"
    },
    {
      "provider": "periplo",
      "id": "original-periplo-derived",
      "label": "Original Huwise service through Periplo",
      "exportId": "original-periplo-customer"
    }
  ],
  "expected": {
    "captureSha256": "ORIGINAL_COMPLETE_CAPTURE_SHA256",
    "rowCount": 3763,
    "notesRevision": 1,
    "releaseDigest": "ORIGINAL_COMPLETE_RELEASE_SHA256",
    "buyerRequestIds": ["ORIGINAL_BUYER_REQUEST_UUID"]
  }
}
~~~

operationId is a stable logical identifier for this whole receiving operation;
parentOperation records its original source or customer operation. The latter
is optional. Neither value is a provider request key invented on each retry.

providers selects one to sixteen aliases from the original host profile.
Each proposed release id and customer exportId must be unique in this input.
The proposed release ID must have no previous native review unless an operator
explicitly adopts its exact retained review. Labels are complete human-readable
native labels, not path names.

releaseId is optional only when the saved original seller-store snapshot
contains exactly one release for merchantExportId. The programme freezes that
initial snapshot. New stages created by this same receiving do not turn its
subsequent release selection into a multiple-match ambiguity.

expected is optional, but use the actual accepted values when continuing an
existing customer operation. Every supplied value must match the original
workbench. The row count is the count of complete captured records, notesRevision
is the actual edition revision, and buyerRequestIds is the complete selected
merchant's original buyer-request set. The example count is illustrative; it
does not establish a capture or payment outcome.

Retain the full input JSON as an original byte file. A continuation requires its
same bytes, including its formatting. The programme keeps input.original.json
and a complete source plan with the actual edition, source, publication, merchant,
release, notes, buyer requests and initial seller selection.

The source edition must support the selected complete analyst formats.
This receiving requires data.json, data.csv, data.geojson and review.html;
for GeoJSON, use a capture with the original geo_point_2d or geo_shape field.
The native export selects that actual field. It does not synthesize geometry.

## 3. Use the original host profiles and browser runtime

Copy the complete original profile file, unchanged, to a private host path.
Its native schema is stellar-forge.seller-facilitators.v1. The Huwise
facilitators.example.json contains the shared testnet profile definitions:

~~~json
{
  "schema": "stellar-forge.seller-facilitators.v1",
  "providers": {
    "vellar": {
      "label": "Vellar testnet",
      "url": "https://vellar-facilitator-testnet-production.up.railway.app",
      "timeoutMs": 10000
    },
    "periplo": {
      "label": "Periplo testnet",
      "url": "https://periplo-testnet.fly.dev",
      "timeoutMs": 10000
    }
  }
}
~~~

These endpoint definitions are inputs, not availability or compatibility
results. The native review receives the current complete supported response,
native payment alternatives and compatibility/error result. It retains the
exact provider definition actually used.

Use the host's already installed Playwright module and Chromium executable.
Provide their actual absolute paths. The programme does not install a browser,
start a different browser service, or substitute a fixture. It hashes the
selected Playwright entry, retains the launch arguments, and records the actual
Chromium version and measured viewports during receiving.

The selected module must expose chromium.launch, either as its named chromium
export or under its default export. The two viewports are 1440 by 1000 and
390 by 844. Browser arguments are supplied one at a time through --browser-arg.
Retain the original host's reviewed low-memory arguments if it needs them; do
not infer browser readiness from a Node or filesystem probe.

## 4. Run one original foreground operation

Close the earlier owning workbench or merchant process through its ordinary
interface before handing this project to the programme. The existing workbench
lease remains authoritative; do not remove it or start a second owner.

Use the same complete directory for every continuation:

~~~sh
starforge merchant-huwise-facilitators-receive \
  --directory /absolute/private/huwise-facilitator-receiving \
  --input /absolute/private/input.json \
  --project /absolute/private/original-huwise-project \
  --profiles /absolute/private/facilitators.json \
  --source-ref ORIGINAL_COMPLETE_COMMIT \
  --build-result /absolute/private/huwise-build-result.json \
  --playwright-module /absolute/installed/playwright/index.mjs \
  --browser /absolute/installed/chromium
~~~

The receiving directory and original project must be canonical, owned private
directories, with no symlink replacing either selected root. The receiver owns
its operation lease, its adjacent merchant metadata directory, the original
MCP/workbench instance it opens, and the actual browser it launches.

Its source binding includes the full input, original profiles, physical
workbench path, exact builder response, complete selected source archive,
and 24 complete observed executable/guide dependencies. Each observed body must
match the installed native manifest's exact path, size and SHA-256; that complete
manifest must bind the selected commit and huwise edition. The installed package
metadata must match its manifest digest and the builder's package identity. Both
metadata files are retained. The full selected archive preserves the rest of the
source closure. The observed inventory and installed manifest must match on
continuation.

The complete build result and TGZ are copied before native provider dispatch.
If the original external TGZ is subsequently retired, the receiver reopens
its own retained exact copy. If a supplied external build result still exists,
it must match the original retained response. The original source commit and
archive digest never change during resume.

For an ephemeral host, prepare all source and private inputs before starting its
foreground execution. Feed the complete programme, run the original operation,
pack its complete result and preserve the artifact before that same execution
lifetime ends. A READY message alone is not a completed source transfer or a
native result.

## 5. What completes inside the programme

The programme first opens the existing original project through the maintained
merchant MCP. It verifies the source merchant, capture hash, source release,
notes and buyer-request identities and reads every captured row through the
native paginated API.

For each selected provider it then:

1. Saves the complete review request and the previous native operation/history
   identities before dispatch.
2. Invokes the original Huwise facilitator review. It retains the original
   operation ID, native operation observation and complete saved review.
3. For a compatible review, invokes SF82's existing stage action against that
   exact saved review. It receives the committed derived release and digest.
4. Exports the complete original capture, analyst formats, source declaration,
   merchant package and guide, selected original buyer request, and the native
   facilitator review, source binding and operating guide.
5. Starts a real typed-client download, preserves its first durable checkpoint
   interruption, and continues that same export with the existing retained-file
   downloader. Every full received file must match its manifest size and SHA-256.
6. Repeats the original immutable export request and requires the same manifest
   hash.

A complete provider incompatibility is retained as a native business result,
including its full supported response and alternatives. It is not replaced by
a compatible stub, omitted from the customer files, or retried with altered
profiles.

The browser phase opens each returned saved review at desktop and phone sizes.
It checks the displayed capture and merchant IDs, complete native/provider
details, actual horizontal layout, saved-review reload and native history
selection. It clicks all three real download buttons and requires the returned
names, sizes and hashes to match the complete client export:

| Actual browser control | Received native file |
|---|---|
| Download native review | facilitator-review.json |
| Download source binding | facilitator-source.json |
| Download operating guide | FACILITATORS.md |

Screenshots and complete browser downloads are retained. The browser phase
performs reads and downloads; it checks that its observed API requests include
no native mutation. The engine/provider actions remain in the original native
programme before this phase.

A partial set of received providers gets its own immutable browser cohort.
When another provider completes later, the full set belongs to a different
cohort under the same receiving operation. All earlier actual browser files
remain retained.

After the merchant and browser close, the programme opens the original native
workbench without a facilitator profile. It calls the same committed-review
stage recovery and requires the original retained release. If interruption hid
that recovery response, subsequent receiving reads the already committed exact
release and records that observation; it does not dispatch another recovery
action blindly.

Finally it verifies the original seller selection generation, active and
previous release; original source release digest; original project histories
and buyer requests; and every complete customer file through
reopenOpendatasoftExport with the original manifest hash.

## 6. Continue the same operation after interruption

Rerun the command with the same input bytes, project, profiles, source edition,
build response, selected Playwright entry and browser arguments. Do not delete
receiving.json, native request records, partial download checkpoints or the
merchant export directory.

Local request publication is retained as PREPARING. If file or record creation
fails before the native method is invoked, the same request, attempt and first
timestamp resume locally. DISPATCHING is saved immediately before the actual
native invocation. A thrown or unobserved invocation remains uncertain; it is
not classified as unapplied merely because a response is missing.

The command inspects retained native state before any new action:

| Retained condition | Same-operation behaviour |
|---|---|
| Local request preparation failed before native invocation | Continue the same original request-file publication and attempt, then perform its first native invocation. |
| Original native review returned | Reopen the exact review and full source binding. |
| Review dispatch lost its response | Search original native operation and complete saved review history for the exact input; do not automatically review again. |
| Several exact candidate reviews | Stop with their retained state; require explicit original-review selection. |
| Stage committed but response lost | Read the exact proposed release with derivedFrom.reviewId and adopt it. |
| Stage returned a native failure | Preserve the complete failure; an explicit same-review stage retry is available. |
| Stage has an unobserved outcome | Retain uncertainty and refuse blind redispatch. |
| Customer download interrupted | Continue the existing export and original checkpoint; keep complete-byte hashes. |
| Browser interrupted | Keep the whole original attempt, then start another actual attempt in the same exact review cohort. |
| All original files complete | Reopen their hashes and native offline export locally; start no provider or browser action. |

If a review response remains unresolved, inspect the original workbench's
facilitator history through its current owner. Explicit adoption is:

~~~sh
starforge merchant-huwise-facilitators-receive \
  ...THE_SAME_REQUIRED_ARGUMENTS... \
  --adopt-review vellar=ORIGINAL_REVIEW_SHA256
~~~

The selected review must match the source release ID/digest, merchant ID and
manifest, capture hash, provider alias, proposed release ID and label. Adoption
preserves the original saved review; it does not manufacture a provider result.

An explicitly observed failed native stage can be continued with:

~~~sh
starforge merchant-huwise-facilitators-receive \
  ...THE_SAME_REQUIRED_ARGUMENTS... \
  --retry-stage vellar
~~~

The original stage's native observation must actually be FAILED, CANCELLED or
INTERRUPTED. A timeout or missing response alone does not satisfy that condition.
The same native engine still validates the retained provider definition,
source release and original stage semantics.

The ellipses above indicate the complete unchanged arguments from section 4;
they are not literal shell arguments.

A complete incompatible review is a final received observation for that
operation. To request a new current provider observation, use a deliberate new
receiving operation and proposed release IDs while preserving this completed
packet. Do not rewrite its profiles or erase its review.

The programme handles SIGINT, SIGTERM and SIGHUP through its original operation
signal, drains its owned native/browser resources, and retains the actual
failure state. An uncatchable process or host failure can require the original
host's process reconciliation before another owner opens the project.
The receiver does not scan for and kill unrelated processes.

## 7. Read the complete outcome

receiving.json is the durable operation record. Progress lines are compact JSON
events, not replacements for the full native files.

| Final state | Meaning and CLI result |
|---|---|
| COMPLETE | Every selected provider has its actual compatible review, committed stage, full client/browser files, closed resources and offline reopen; exit 0. |
| RECEIVED_INCOMPATIBLE | Every selected provider was received, but at least one native review is incompatible; its full files remain available; exit 1. |
| INCOMPLETE or INTERRUPTED | Preserve the same operation and inspect its exact retained failure before continuing; exit 2. |
| REOPENED progress event | The complete original operation and files were verified locally; its original final state and timestamps are preserved. |

A successful source parse, an HTTP response, a browser launch or a single
provider review does not establish COMPLETE. The final state is only published
after the full selected provider/client/browser/offline workflow.

The original captured row count and existing buyer-request IDs are reported as
readback of retained state. They are not new purchases, new payment receipts
or live source captures.

## 8. Deliver and reopen every original file

Preserve the whole receiving directory, together with the original workbench's
existing backup/export authority and the runtime/source receipts. The receiving
directory includes:

- receiving.json, full source input/profile/build binding and exact selected TGZ.
- source/observed-source with the complete 24-file executable/guide cohort,
  original package manifest and package metadata.
- source/workbench.before.json, the exact source plan and final authority readback.
- native/PROVIDER with requests, operation starts/observations, saved review,
  committed stage, customer export and closed-native recovery records.
- received/PROVIDER with every original client-export file and its retained
  export manifest/checkpoint.
- browser/COHORT with all original attempts, measured desktop/phone steps,
  complete downloaded files, screenshots and browser-receiving.json.
- The adjacent merchant metadata/export store needed to reopen the same original
  native receiving operation.

Receiving artifacts use their full byte count and SHA-256. Immutable filenames
are published exclusively: an existing different body is an error. Mutable
operation records use a unique temporary in the same directory, complete write,
fsync, replacement and directory fsync. A failed process cannot turn a truncated
temporary into a completed customer file.

The complete customer export includes the original merchant TAR; use its own
MERCHANT-RECEIVING.md to import or start that merchant elsewhere. The facilitator
export contains the full native review and source binding. These files remain
bound to the original proposed stage; receipt does not activate it.

For data-only offline receiving, use the original exported client:

~~~js
import { reopenOpendatasoftExport } from
  '@tokenjunkielabs/starforge-merchant/merchant/mcp/opendatasoft/client';

const result = await reopenOpendatasoftExport({
  directory: '/absolute/received/vellar',
  exportId: 'ORIGINAL_CUSTOMER_EXPORT_ID',
  expectedManifestSha256: 'ORIGINAL_COMPLETE_MANIFEST_SHA256'
});
console.log(result);
~~~

This reads the retained full local files and manifest. It does not need the
merchant host, a facilitator request or another purchase. The complete programme's
same-directory reopen additionally verifies its source/runtime binding and
all received browser/native artifacts.

Moving the whole operating workbench to another host is a restoration operation.
Preserve its original physical binding or explicitly use the original
workbench/merchant restoration instructions. Do not silently rebind a completed
programme's project path, source edition or provider profile.

## Related original contracts

- [Native facilitator review and staging](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/FACILITATORS.md)
- [Complete merchant MCP commands](OPENDATASOFT.md)
- [Huwise product installation and operation](../../products/huwise/OPERATING.md)
- [Original complete capture/client receiving](examples/opendatasoft-receiving.mjs)
- [Native release facilitator implementation](../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs)

The source delivery makes this real workflow executable. Actual provider,
browser and customer outcomes are established only by the original retained
operation records produced on its receiving host.
