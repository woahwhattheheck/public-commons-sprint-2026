# Offline workspace inspection and selected-citation export

This add-on uses the already-published Academic Evidence Studio multi-claim workspace. It does not replace the UI, introduce another saved-file schema, or modify `app.mjs` or `workspace.mjs`. It provides a terminal path for verifying a downloaded review and producing the same native Markdown report plus a machine-readable ledger of only the citations a reviewer selected.

## Run

Node.js 22; no installation, server, API key, model, or network connection is needed. Run from the directory containing the existing `app.mjs` and `workspace.mjs`:

```sh
node workspace-tools.mjs inspect saved-workspace.json
node workspace-tools.mjs export saved-workspace.json --report report.md --citations citations.jsonl
```

A successful command writes a JSON receipt to standard output and exits 0. Invalid archives or file errors exit 2. Invalid command syntax exits 64. Either export option may be used independently. Redirect the receipt to a separate file when needed.

The accepted saved format is `academic-evidence-workspace/v1`, produced by the published workspace UI. Raw corpus inputs must first pass through that existing workspace; this CLI does not silently invent reviewer decisions.

## What inspection establishes

The tool invokes the native `restoreWorkspace` to reconstruct source hashes, claim/source fingerprints, citation offsets, quote checksums and valid selected IDs. It then compares the complete saved object with the reconstructed object. A changed source, claim, stored citation offset, score, checksum, unknown field or other noncanonical field fails inspection. JSON indentation and object key order do not matter. Duplicate keys are subject to normal JavaScript JSON parsing: this is not a duplicate-key detector.

This is deliberately stricter than the UI import operation. Native import repairs stored citation records by recomputing them. A standalone verifier must report such a mismatch instead of issuing a misleading integrity pass for the damaged file. To intentionally migrate or repair a file, inspect it in the existing workspace and save a new copy; do not present that copy as byte-identical to the original.

Receipts distinguish the raw archive SHA-256 from the canonical semantic workspace SHA-256. They report source, claim, reviewed-claim and selected-citation counts. They explicitly leave reviewer authentication, model execution verification and organizer submission verification false. A checksum is not an authenticated signature, evidence of live inference or proof that a research claim is true. A deliberate editor can recompute hashes.

## Exported citation ledger

Each JSONL row identifies the workspace, claim, reviewer-entered decision and explanation, selected evidence ID, source, exact quote and source/quote SHA-256 values. Offsets are zero-based, end-exclusive **UTF-16 code units**, matching JavaScript `String.slice`, not bytes or Unicode code points. Quotes are sliced from the unmodified original source. Unselected excerpts do not appear in JSONL; the native Markdown report includes the full retrieved context and selection labels. A workspace with no selected citations produces an empty JSONL file, not fabricated rows.

`selectedCitations` is a low-level helper for an already validated workspace. External callers should use `inspectBytes`/`inspectFile` first or use `exportFiles`, which performs validation itself.

## File handling and privacy

Inputs must be regular UTF-8 JSON files no larger than 2 MiB. The read loop enforces the limit even if a file grows after its initial size check. Each export destination must differ from the input and other outputs. Existing files are rejected before writing; exclusive file creation also prevents a racing writer from being overwritten. Newly created exports request owner-only permissions (`0600`) where supported.

Two-file export is not an atomic transaction. On a later write failure, the error receipt lists outputs that completed successfully. A failed filesystem write can leave a newly created partial file; no automatic rollback is claimed. Existing files and the source archive are never intentionally overwritten.

Workspace files, reports and ledgers contain source text, reviewer labels and notes. Share only with authorized recipients. The implementation makes no external requests and adds no API polling, rate-limit consumption or background jobs.

## Reproduce the offline demonstration

Choose a new output directory because the demonstration also refuses overwrites:

```sh
node workspace-demo.mjs demo-output
```

This executes the real CLI against two fictional sources and two claims. It records an observed-change decision separately from an unsupported causal interpretation, exports the report and selected citations, then alters a citation offset and demonstrates exit 2 with `NON_CANONICAL_ARCHIVE`. Input, output and receipt files remain in the selected directory. All source material and reviewer labels are explicitly synthetic.

## Original donor acceptance record

Executed in the cloud container on 9 October 2026, Node v22.16.0:

```sh
node --test workspace-tools.test.mjs
```

**2 passed, 0 failed.** The first check covers native-format round trip, actual CLI inspection, Unicode/CRLF offsets, selected-only export and semantic digest stability. The second covers source/offset corruption, invalid UTF-8, the size limit, input/output collisions, preservation of existing files and actual CLI rejection. The offline demonstration was also executed successfully; its terminal transcript, report, ledger and JSON receipt are preserved in the delivery package.

An earlier browser attempt in this session failed on localhost navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no browser pass or video is claimed. This offline addition neither invokes Apertus nor registers or submits a competition entry.

## Source compatibility

Target repository: `woahwhattheheck/public-commons-sprint-2026`.
Target directory: `work/competitions/hack-apertus-2026/academic-evidence-studio`.

The runnable delivery preserves these dependency Git blobs byte-for-byte:

- `app.mjs`: `354e66b8206c65255c16ccee35deb220d2bdb998`
- `workspace.mjs`: `3a40131e105581632f4efd032d70796a7dca314d`
- `LICENSE`: `b98f396da3bbfde42f37909aab9e787ded187877`

The recovery publishes only `workspace-tools.mjs`, `workspace-demo.mjs` and this document. The original two-check test supplement remains in the preserved donor packet and is not installed by this recovery. No original app, published workspace or contributor license is replaced.


## Recovery execution

The actual offline demo was rerun against current unchanged app/workspace dependencies on Node v24.19.0. The donor test supplement was not rerun or published. This recovery does not establish browser, live-model or organizer submission acceptance.
