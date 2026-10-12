# Source bundles: commission, deliver and reopen the same workorder

The source-bundle panel belongs to the original SF74 commissioning desk. It retains the saved merchant case, its exact workorder terms and the files chosen by the operator. The original SF49 carrier prepares the workorder through SF74/SF77 and publishes a complete source manifest. A second operator can receive the resulting ZIP and replay that same workorder.

The full source files remain private files beside the case. The case keeps a compact reference to their bundle, original source identities, roles and hashes. A technical receiving result does not set customer acceptance or create a payment event.

## 1. Save the source case

Open the existing case and finish the workorder terms in the original commissioning editor. Save that case before opening a source transfer. The source panel displays its current case ID and saved revision.

A new source transfer binds that exact saved version. Its original handoff comes from the native SF74 runtime export; its terms come from the saved original terms. These files retain the first export's timestamp and bytes across a retry.

The panel does not ask the operator to rebuild the support JSON or copy financial values into another form. The existing workorder model continues to distinguish an approved fee, an unknown cost, an explicit zero cost and a known margin.

## 2. Select the complete source files

Choose **Saved case and source files**, add a useful label and select the original files. Assign each file's role explicitly:

| Role | Meaning |
|---|---|
| source | Original selected data or supporting source. |
| source-contract | Original API, schema, manifest or documented delivery contract. |
| coverage | Retained pagination, partition, interval or population evidence. |
| comparison | Saved comparison output for the selected source editions. |
| receiving-observation | Actual downstream receiving or reopen output. |
| notes | Additional operator context, distinct from original source data. |

These roles are labels within the retained source inventory. They do not infer missing pages, measure unobserved cost, assert that a customer accepted work, or change the original delivery's payment status.

Select **Retain selected sources**. The saved case handoff and terms are retained first. Each selected file then streams directly to its declared private destination. The completed list displays exact byte counts and SHA-256 values.

Review those values before selecting **Build original workorder bundle**. The native carrier validates and rebuilds the workorder through its original engines, retains the source files and publishes its manifest last.

An empty attachment selection is valid when the complete relevant source is already in the original saved case. Add the actual comparison, coverage and receiving files whenever those are part of the selected commissioning scope.

## 3. Review the resulting bundle

The completed panel shows:

- The original workorder reference, bundle ID and manifest SHA.
- The native replay result and whether the retained implementation pins match the current source.
- Every declared file's role, byte count and SHA.
- Direct downloads of the original packet, printable workorder, checklist, source handoff, terms, attachments and manifest.

Source pins and output replay answer different questions. A changed implementation pin does not turn a mismatching replay into a pass. The original carrier still requires the current native replay to reproduce the retained packet, HTML and checklist exactly before it returns a successful replay.

Use **Reopen and replay** to inspect the retained bundle again. Its request identity and result stay in the same transfer history.

## 4. Attach it to the original commissioning case

Select **Attach to saved commissioning case**. The panel obtains the original case's current saved revision, then invokes the existing case writer and commissioning command with one retained request ID.

The host stores the compact source descriptor in that case's commissioning state. Large handoffs and attachments remain outside its inline material collection. Task assignment, acceptance, subsequent case edits and service reporting continue in their existing original controls.

If another operator changes the case first, the original CAS reports the current revision. Refresh and inspect the case. A missing attachment response is reconciled with its retained request; the service checks whether that same attachment already committed before creating any new case edition.

Do not change the request ID merely because a response was lost.

## 5. Export the complete portable source

Select **Build portable ZIP**, then download the saved archive. The export uses the original shared streaming ZIP64 engine. It contains:

~~~text
handover.json
files/manifest.json
files/request.json
files/originals/support.json
files/originals/terms.json
files/packet.json
files/seller-packet.html
files/acceptance-checklist.md
files/attachments/<original-id>/<original-name>
~~~

The root handover.json uses the distinct SF49 source-archive schema. The original manifest.json and all native bundle members are byte-identical. The archive's own SHA is retained separately.

A repeated export verifies and returns the existing archive. It does not generate a new workorder identity. An interrupted archive build keeps the same destination request; a matching completed staging file can be published by the same continuation.

Save or transfer this archive using the source owner's permitted destination. It includes the selected original data and may include private support information. Source code releases do not need the private operating ZIP.

## 6. Receive and reopen

In the same original desk, choose **Receive an existing ZIP** and select the complete original archive. Give the receiving transfer its own label, then select **Retain archive**.

The browser sends the File directly; the native writer computes its SHA while receiving it. The browser does not allocate the complete archive in JavaScript memory.

Select **Inspect complete archive**. The service verifies the full archive, its distinct schema, all member names and sizes, and every original file hash. Review the original operation, bundle and manifest identities.

Select **Receive verified archive**. The native engine extracts the verified files into a retained intake directory. The original SF49 receiver then copies and validates the native bundle into its receiving directory and replays the same original SF74/SF77 workorder. The resulting descriptor retains the original operation ID, bundle ID and manifest SHA.

Use **Reopen and replay** after receiving. Attach that verified source to the selected saved case through the same original commissioning callback. Receiving a source bundle is separate from accepting the work it describes.

## Interrupted work

Each long command has its own retained request before it starts. The panel keeps the exact command in browser session storage until its saved native result is available.

- After a lost response, select **Check retained result**.
- If there is no completed result, resolve the displayed native issue and select **Continue same command**.
- If another process still owns that transfer, the existing kernel lock prevents a competing continuation.
- Completed uploads remain available. Reselect an incomplete original file to send that one file again under the same transfer.
- A failed local source-only command can be left in retained history while the operator chooses corrected source inputs. Its files and command record are not deleted.
- An unresolved case attachment stays bound to its original request, so a previously committed case write can be recovered.

Closing a browser panel stops its incomplete upload and polling. It does not cancel an already accepted native archive command. Closing the original app drains the source service and its owned streams before releasing their transfer locks.

## Installed command

The already-declared command remains the complete native CLI:

~~~sh
starforge source-edition-workorder inspect --bundle /absolute/private/workorder
starforge source-edition-workorder replay --bundle /absolute/private/workorder
starforge source-edition-workorder export --bundle /absolute/private/workorder --out /absolute/private/source-edition.zip
starforge source-edition-workorder inspect-archive --archive /absolute/private/source-edition.zip
starforge source-edition-workorder receive-archive --archive /absolute/private/source-edition.zip --intake /absolute/private/intake --out /absolute/private/received
~~~

Use the existing --python option when the maintained Python interpreter is not named python3. ZIP operations use only Python's standard library. The original non-archive commands remain Node operations.

## Size boundaries and transport

An original attachment can be up to 8 GiB. The original SF49 source allowance remains 16 GiB, including its reserved handoff and terms space. The handoff allowance comes directly from SF74's exported `MAX_HANDOFF_BYTES`: `2 × (MAX_RUNTIME_BYTES + MAX_WORKSPACE_BYTES) + 1 MiB`. The current workspace codec accounts for commissioning and Service content. The source service uses this same value when reserving space and hashing the selected handoff; it does not keep a separate fixed handoff cap. Once the original handoff and terms have been read, the native builder checks their actual byte counts together with the selected attachments against the same 16 GiB ceiling. An accepted transfer can therefore continue after the installed handoff allowance grows without reducing its already accepted attachment budget.

The portable ZIP admits the original carrier's complete inventory plus its exact manifest, at most 72 members. Its expanded ceiling is `16 GiB + MAX_HANDOFF_BYTES + 3 × 2 MiB`; its compressed upload ceiling adds 16 MiB for ZIP framing and bounded compression overhead. The native Node carrier passes its installed handoff allowance to the original Python streaming policy. The public HTTP request cannot choose these limits. The state API reports the current derived values.

These limits are separate from the original commissioning editor's 48 MiB inline-material and 64 MiB commissioning-record boundaries. The complete saved case retains the original codec's exported `MAX_WORKSPACE_BYTES`, including its existing Service fields. Large source files and archives use raw HTTP file streams. The only JSON request contains bounded selection, identity and role metadata.

Direct download links support one HTTP byte range. A complete download hashes its opened file while streaming and verifies its final chunk before completing. Range/HEAD responses identify the retained whole-file SHA; the receiving path still verifies the full archive and all members.

The host uses a nonzero header deadline and an upload inactivity limit. Its streaming configuration removes the separate whole-request timeout that would otherwise cut off a sufficiently large valid upload; this follows Node's documented distinction between [request receipt timeouts and socket inactivity](https://nodejs.org/api/http.html#serverrequesttimeout).

The receiving path needs room for the uploaded archive, extracted intake and original received bundle. It does not pretend that the compressed archive size is the expanded storage requirement.

## Integration and original operating evidence

See [SOURCE_DELIVERY_API.md](SOURCE_DELIVERY_API.md) for the exact callbacks, command shapes, streamed routes and lifecycle.

This component extends the original SF49/SF77 source-edition workorder and installed command. The original 9345 receiving continuation remains the selected native operation for source-to-receiving evidence. Its retained programme and results must state whether each native phase actually completed. Source publication and a pending native phase are reported separately; no demonstration record substitutes for that original operation.

### Archive verification on continuation

Extraction stages use a reserved namespace outside the incoming source inventory. When a received file or a completed stage already exists, the receiver still reads the corresponding ZIP member through its CRC and SHA-256 checks before adopting that output. A matching local file alone does not establish that the supplied archive is intact.
