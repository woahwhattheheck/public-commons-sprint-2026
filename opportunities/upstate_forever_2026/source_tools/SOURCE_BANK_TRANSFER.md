# Prepare complete source transfers in JavaScript

Use this encoder when a source-bank response is too large for the working connection. The complete original bank becomes deterministic gzip parts, each small enough for the configured connector request. The existing Python materializer reconstructs the exact bank and all original files.

Prefer an ordinary complete archive or repository checkout when the receiving runtime can fetch it. This path addresses the observed managed-blob truncation during the Ecosystem Sciences native handoff. It also works in a JavaScript-only session that has no filesystem, Node, compression API or network API: the caller supplies the exact original JSON text and publishes the returned strings through its already authorized connector.

## Prepare

The maintained module is `source_tools/source_bank_transfer.cjs`. It exports `prepareTransfer` and `identity` under Node, or installs `globalThis.CommonsSourceBankTransfer` when loaded as a plain script. It has no dependencies or side effects outside that export. Keep the module's retrieved source identity with the transfer.

~~~js
const {prepareTransfer} = require("./source_bank_transfer.cjs");
const transfer = prepareTransfer([
  {
    name: "successors",
    text: exactOriginalBankText,
    git_blob: "d85b250872047d04c7d75851cf0aef96eabeff81"
  },
  {
    name: "source-tools",
    text: exactOriginalSourceToolsBankText,
    git_blob: "ac740f87dc7f5948fee9c50e32ddf7c99ad9a47f"
  }
], {
  operationId: "your-retained-operation-id",
  repository: "woahwhattheheck/public-commons-sprint-2026",
  maxPayloadBytes: 600000,
  reserveBytes: 4096,
  chunkBytes: 400000
});
~~~

`text` is the exact original UTF-8 JSON, including its whitespace and terminal newline. `git_blob` and `sha256` are optional expected identities; provide the source's known identity whenever available. A parsed tool response alone does not establish its original serialization. Recover the complete original text or reproduce and verify its known byte identity before preparing a transfer.

The original bank may use one of these retained contracts:

| Original schema | Member content | Inventory and source identities |
| --- | --- | --- |
| `commons.source-bank/v1` | Exactly one of canonical `content_base64` or literal UTF-8 `content` | `file_count` and `source_bytes` are required. Base64 members require their original `git_blob`. |
| `commons.source-text-bank/v1` | Literal UTF-8 `content` | `file_count` and `source_bytes` are required. |
| `upstate.source-bank/v1` | Literal UTF-8 `content` | Original totals and member Git identities are optional; every declared value is checked. |

Every member requires its original relative POSIX `path`, `bytes` and `sha256`. If a text member declares `git_blob`, it must match. The sender and receiver derive the transfer inventory and actual Git identity directly from the complete file bytes when that historical text contract omits them. Those derived values appear in transfer/receiving metadata; the original JSON remains byte-for-byte unchanged, including its schema, whitespace, input associations and missing optional fields.

The encoder rejects duplicate bank names, duplicate member paths, a file used as another file's directory, unsafe paths, malformed Unicode, ambiguous text-plus-base64 content, noncanonical base64 and inconsistent declared inventory. Binary files remain supported through the base64 contract. Plain-text members must be real strings, including an empty string where the original file is empty.

An unknown bank schema still needs an explicitly authored compatible successor with its relationship to the original recorded. The tool does not infer a schema from arbitrary tool output. Metadata describing an external input is retained as metadata; it is not counted as a file supplied by the bank.

The returned object has:

- `parts`: complete part JSON strings with their exact `git_blob`, `json_bytes`, `json_sha256`, bank/index/offset/raw-byte identity and measured `payload_bytes`.
- `manifestJson`: the complete transfer manifest string.
- `manifestIdentity`: the manifest's byte count, SHA-256 and Git blob ID.
- `manifest`: the parsed manifest for inspecting its inventory and part order.
- `payloadBudget`: the settings actually used.

Compression is deterministic: the same original bank produces the same gzip stream. Splitting also includes the bank name, part number and offset, so retain the original settings to reproduce exact published part IDs.

## Publish and resume

Publish each `part.json` as a UTF-8 Git blob through the existing connection. Check the returned SHA against `part.git_blob` and retain the accepted ID immediately. After every part is accepted, publish `manifestJson` and check against `manifestIdentity.git_blob`.

Use the existing Git tree/commit/branch workflow to retain a reachable directory containing `transfer.json` and `parts/<git_blob>.json`. Publishing a Git blob alone does not give later workers a durable branch to discover. Include the branch/commit, manifest identity, receiving helper and active application/Workspace owner in the existing handoff.

If a write response is lost, fetch the predicted blob ID and compare its complete content before attempting the same deterministic write again. After a transfer interruption, keep already accepted parts. A receiver can request only missing part IDs. Do not generate a competing source edition or replace active worker modifications to restart transport.

The encoder uses the schemas already consumed by `materialize_source_banks.py`; it does not add another receiver. On the native runtime:

~~~sh
python -B source_tools/materialize_source_banks.py \
  --manifest transfer.json \
  --parts parts \
  --output /path/to/new-owned-source-receiving
~~~

Then use the maintained component installer or compose the received source with the working application, retaining the exact active Workspace and current local changes. See [MATERIALIZE_SOURCE_BANKS.md](MATERIALIZE_SOURCE_BANKS.md).

Keep overlays in separate receiving directories when they intentionally repeat existing paths. A single transfer rejects duplicate source paths across its banks, even when the duplicated bytes are identical. The caller's application composition decides which reviewed successor replaces an older file.

## Receive one complete small transfer from a pasted script

When a receiver specifically needs copyable source instead of a file download, `prepareInlineReceiver` frames the same transfer with the exact maintained Python materializer. It does not add a separate source decoder. Supply the reviewed full materializer text and its known Git identity:

~~~js
const inline = prepareInlineReceiver(transfer, exactMaterializerSource, {
  materializerGitBlob: knownMaterializerBlob,
  maxScriptBytes: 250000
});
// Publish inline.script and retain inline.scriptIdentity.
~~~

The returned script has three unindented ASCII lines. Both its payload and its Python bootstrap body are base64-encoded, so repeated-space conversion in a Slack Canvas cannot alter Python indentation. The packet includes the original part JSON, original transfer manifest and exact materializer. It preserves original part/manifest identities and checks the full packet, helper and part bodies before receiving.

Save those three lines as an ordinary local Python file and run:

~~~sh
python -B receive-original-source.py /path/to/new-owned-receiving
~~~

The script takes exactly one owned directory. It retains `input/materialize_source_banks.py`, `input/transfer.json` and `input/parts/<git_blob>.json`, then calls that exact materializer into `received/`. Original source files are in `received/source/`; original bank JSON and the complete receiving inventory accompany them. Existing different inputs or source files remain untouched. The bootstrap rejects symlinked paths in its receiving input tree.

The sender returns `scriptIdentity`, `packetIdentity`, `materializerIdentity` and `transferManifestIdentity` for the actual generated bytes. Its budget measures the entire script. If it exceeds the configured limit, publish the existing manifest and parts separately. Large inline scripts are a fallback for an observed receiving constraint; ordinary native files or repository archives remain the preferred handoff.

The complete original seasonal-comparison bank from PR3886 is an exercised text-contract example: Git `ab08fa5b981826c33a91e7b36c3d3188150da041`, 2,387,238 JSON bytes, six source files and 2,161,616 original source bytes. Its unchanged original JSON compresses to 129,721 bytes and one 173,181-byte part. All eight original input associations remain in the bank; they do not silently become extra supplied files.

## Size budget

`chunkBytes` limits raw bytes from the compressed stream; it does not describe the JSON or provider response size. For every candidate the encoder measures:

~~~text
UTF-8 bytes of JSON.stringify({
  repository_full_name: repository,
  content: completePartJson,
  encoding: "utf-8"
}) + reserveBytes
~~~

This includes base64 expansion and escaped nested JSON. If that envelope exceeds `maxPayloadBytes`, a binary search reduces the raw segment to the largest size that fits. The manifest must also fit. `reserveBytes` covers the additional provider framing allowed by the caller. Choose the budget from actual complete responses on the connection; no setting can guarantee an undocumented provider limit. If a response still truncates, lower the verified envelope and prepare from the same original bank. An oversized manifest needs fewer banks per transfer or a larger observed working envelope.

The default raw cap is 400,000 bytes, total request cap 600,000 bytes, additional reserve 4,096 bytes. The implementation holds the original banks and compressed parts in memory. Use separate complete-bank transfers when memory or manifest size becomes the constraint.

## Existing receiving packages

The existing `delivery/ecosystem-native-source-20261013-s1` branch retains the original 660-file transfer, the 22-file successor transfer and the 29-file source-tools closure. Their directories are:

- `source/receiving/20261013/native-application-660`
- `source/receiving/20261013/native-application-successors-22`
- `source/receiving/20261013/native-application-source-tools-29`

These are under the application prefix `opportunities/upstate_forever_2026/`. They are retained source snapshots. Their merged unique application inventory is 703 files; the current working application may include later maintained additions. Reuse the existing complete packages for that native run.

The extracted encoder was exercised on the original 22- and 29-file banks: 51 source files and 1,896,515 original source bytes. Both gzip streams matched the previously published streams exactly, and an independent decoder reconstructed both original JSON texts. The default part bodies reproduced the existing published part identities. A 250,000-byte total request envelope split the 22-file bank into two parts, including one at exactly the configured limit, and reconstructed the same original content.

## Owner-directed product receiving

Carry the current application `AGENTS.md` and provider instruction copies when assembling a standalone source handoff. The current owner instruction `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.3` (copied in full below), together with `AGENTS.md`, requires opening/running/rendering the exact outgoing client-facing product and inspecting its actual screens or screenshots, then operating important populated controls, exports and reopening at screenshare and narrow/mobile widths where relevant. Fix clipping, unreadable tables and broken controls before presenting it. Use plain industrial design and preserve the active computation and source owners. Transport completion feeds the existing native product workflow; it does not substitute for the actual rendered product inspection.

## Receive one complete Canvas or source bank without installing it

The same maintained materializer also accepts `--carrier` for a complete
local source bank or complete Canvas Markdown. This is source staging only. It
does not fetch a repository, import application modules, invoke an installer,
change a Workspace, or start a model. Keep the existing application writer and
compose the staged sources through its maintained path afterward.

The original `--manifest ... --parts ... --output ...` multi-bank route above
and the current `--bank ... --output ...` complete-bank route are preserved.
The latter retains `--operation`, `--bank-bytes` and `--bank-sha256` with their
original meanings: those optional byte/hash pins identify the incoming file,
including an envelope when present. The new carrier pin instead identifies the
exact decoded original bank. Choose one of these three input modes; mode-specific
options cannot be mixed.

In carrier mode, name the actual existing or intended application and Workspace
roots so staging can reject every overlapping destination, including their
ancestors. Protected roots do not need to exist and are never created by this
command. Any existing protected root must be a directory, and symlinks in either
protected path are rejected. The owned staging parent must already exist.

~~~bash
SOURCE_PYTHON=/the/existing/qualified/runtime/bin/python
SOURCE_APPLICATION=/the/existing/application
SOURCE_WORKSPACE=/the/existing/workspace
SOURCE_STAGE=/the/existing/receiving-parent/current-source-stage

"$SOURCE_PYTHON" -B source_tools/materialize_source_banks.py \
  --carrier /retained/watershed-handover-source.md \
  --expect-source-sha256 27bdb42a89d6f07f63393f0117717d7e892fef8e9d0522f8465bdcdb07deee87 \
  --application "$SOURCE_APPLICATION" \
  --workspace "$SOURCE_WORKSPACE" \
  --output "$SOURCE_STAGE"
~~~

Use the current receiver's actual paths; the placeholders do not authorize
creating another application or native job. The example is the complete
15-member source bank from the existing watershed handover Canvas, not the
original scientific-input manifest or a replacement for the active 976-source
whole-application intake.

### Supported original representations

- Complete JSON banks with declared source schemas, original member paths and
  per-member bytes/SHA-256: text, base64 or the maintained source-map inventory.
  The actual `commons.source-files.v1` six-file editor bank is included.
  Optional overall counts and Git blob IDs are checked when supplied. Missing
  overall counts are derived; an omitted Git ID is computed and retained without
  pretending the original publisher declared it.
- `commons.compressed-source-carrier/v1` and
  `commons.artifact-base64/v1` envelopes. The declared decoded bank identity
  is mandatory; declared gzip and original Git identities are also checked.
  Original `bytes/sha256`, `original_bytes/original_sha256` and
  `decoded_bytes/decoded_sha256` identity pairs are accepted; if multiple pairs
  are supplied they must agree. A declared `decoded_schema` must match the
  unchanged inner bank. This includes the envelopes accepted by the current
  complete-bank receiver.
- Complete Markdown containing one JSON bank/carrier or every
  `commons.compressed-source-part/v1` block. Parts are ordered by their
  original one-based index. Every index must occur exactly once and all repeated
  metadata must agree. The existing `commons.source-base64-part.v1` format uses
  its separate, explicit zero-based indexes and uncompressed base64 with
  `decoded_bytes` / `decoded_sha256`; the receiver does not guess an index basis.
  Two unrelated groups are never mixed.
- Complete saved provider results carrying `markdown_content`,
  `text_content`, `structuredContent` or the original text content field.
  Provider errors and conflicting complete payloads are rejected.

Plain Python or shell fences are instructions, not source-bank inputs, and are
never evaluated by the decoder. JSON structural nonbreaking-space handling is
confined to whitespace outside strings. File contents are never heuristically
reindented, translated or rewritten. A damaged declared source body fails its
original byte/hash check.

### Complete preflight and resulting directory

Before creating a staging directory, the new mode verifies the entire bank and
all member bytes, validates relative paths, duplicate/case aliases and
file/directory conflicts, checks regular Git file modes, and compiles every
original `.py` body with the current Python compiler. Compilation executes no
source and creates no bytecode cache. Binary members remain original bytes.

The implementation limits one input, decoded bank and normalized complete bank
to 512 MiB and the source inventory to 10,000 files. These are source transport
bounds, not limits on scientific scenarios or archive members.

A successful result points to:

| Relative path | Retained content |
| --- | --- |
| `source/` | Every original source member at its original path and 100644/100755 mode |
| `banks/original.json` | Exact decoded original bank bytes, without JSON reserialization |
| `source-bank.json` | Complete compatible bank with every body encoded losslessly, complete counts and original-bank identity |
| `receiving.json` | Existing receiving schema, full inventory, compiled Python paths and `installation_requested:false` |

Metadata lives outside `source/`, so an original source member itself named
`source-bank.json` remains valid. Read the returned `source` path when
composing; do not treat the outer receiving directory as the application.

The completed directory is published using the same Linux no-replace operation
as the maintained application assembler. An existing destination is reusable
only when the complete original banks, source files, receipt and modes match.
A differing, incomplete or aliased destination remains untouched. Retrying a
different bank cannot add files to an earlier edition.

### Byte-safe single-line bootstrap

The sibling file `materialize_source_banks.bootstrap.txt` contains the complete
maintained receiver, base64-encoded into **one ASCII shell command** with its
exact byte count and SHA-256. It performs the same checks and has the same CLI.
Read or materialize this complete original file through the existing authorized
source transport; do not rebuild it from a rendered Python fence.

With the same qualified runtime and arguments:

~~~bash
export SOURCE_PYTHON
sh source_tools/materialize_source_banks.bootstrap.txt \
  --carrier /retained/watershed-handover-source.md \
  --expect-source-sha256 27bdb42a89d6f07f63393f0117717d7e892fef8e9d0522f8465bdcdb07deee87 \
  --application "$SOURCE_APPLICATION" \
  --workspace "$SOURCE_WORKSPACE" \
  --output "$SOURCE_STAGE"
~~~

The bootstrap verifies its embedded receiver's bytes and hash, then compiles that
exact receiver before invocation. It performs no network operation. Keep the
whole single line; visual wrapping is harmless, inserted line breaks inside its
encoded body are not. The published source bank retains the receiver, bootstrap
and this guide together.

### Actual failure cases and current replay

In the original matching-kernel Canvas, 1,660 ASCII indentation spaces became
U+00A0. The rendered Python fence was 15,018 bytes while the original Git body was
13,358 bytes with SHA-256
`ca40c47d3537af307ee3eeb1e969ea8c950ccd13919744b173806c243a5558a4`.
Only an independently checked exact-source correction established that original
body. Another source-receiving snippet lost loop indentation. Neither case
justifies inferring missing indentation in an arbitrary program.

The current watershed carrier succeeded as six JSON sections with encoded chunks
of at most 24,000 characters after a larger section replacement failed. This is
the observed boundary in that operation, not a universal Slack size guarantee.
Retain numbered parts and the final complete-bank identity, and read the complete
outgoing carrier back after a change.

The actual current six-part bank decodes to 303,535 bytes with SHA-256
`27bdb42a89d6f07f63393f0117717d7e892fef8e9d0522f8465bdcdb07deee87`,
Git blob `553b3329b1bcecb8d85ff41b85fb8b616456872d`, and 15 original bodies
totaling 288,382 bytes. Independent V8 recovery matched those complete originals.
Physical section order may differ; original numbered order is authoritative.
Missing, duplicated, mixed-identity or truncated parts were rejected. When a raw
JSON bank is inside a Markdown fence, the closing fence can add a framing newline.
With an explicit original bank SHA, the receiver removes that one LF/CRLF and/or
one leading UTF-8 BOM only when doing so matches the supplied identity exactly.
The receipt also retains the complete incoming carrier bytes/SHA. The input file
is unchanged. Without that pin it retains
the actual extracted bank bytes and records their identity. A separate
real ten-file base64 bank lacking overall counts and per-file Git IDs retains its
declared per-file bytes/SHA and is a supported input.

These transport/source checks do not claim a native Python or rendered product
result. Continue the existing equipped source-receiving operation: stage the
same bank, repeat the exact intake to confirm reuse, inspect its actual result,
then let the original owner compose at the existing application boundary.
Preserve active jobs, the qualified interpreter and the receiving Workspace.

### Current owner direction

Read and carry the complete application `CURRENT_OWNER_DIRECTION.md` version
`2026-10-13.3` and `AGENTS.md` into the existing receiving work order.
This source-only improvement supports the actual simulated-model delivery and
does not replace native execution. Preserve the October 13 **14:00 UTC cutoff**
and do not resume automatically. The producing worker must open and use the exact
outgoing product, look at its real desktop and narrow rendered pixels, operate
critical controls/downloads/reopen, and inspect **ALL attachments** in recipient
viewers. Source validation is not visual or scientific acceptance. Preserve the
original scientific choices, attribution, source custody, active processes and
single application/Workspace writer.

## Complete current owner brief carried into source receiving

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
