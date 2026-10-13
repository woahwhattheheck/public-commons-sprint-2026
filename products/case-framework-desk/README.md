# CASE framework source desk

## Open the editable project

Use Node 22 or later. The product uses built-in Node and browser APIs; no package installation is required.

```sh
node product/serve-desk.mjs --port 8765
```

Open the printed loopback address. Source packages and working copies remain in your browser; the local server serves the selected application and authored examples only.

## Compare two editions

Choose the complete before and after JSON packages. Each must be valid UTF-8, within 1 MiB, and name the same original CFDocument identifier. You can also paste the complete package text. The authored example demonstrates large-number changes, added/removed items and associations, contextual sequence changes, external references and a deliberate local identity conflict.

Choose **Compare selected editions**. Review the source findings, observed changes and original identifiers. Use search/state filters to select a view, then **Inspect / review** to examine exact changed fields and associated reference findings. ACCEPT, INVESTIGATE and DEFER describe your disposition; they do not rewrite the publisher's data or turn an unresolved external reference into a verified mapping.

Source rich text is escaped and displayed as text. Markdown/LaTeX remain verbatim. Numeric comparison details retain exact coefficient/exponent values, including values that cannot be represented precisely as JavaScript numbers.

## Retain unfinished work

The desk saves complete working copies in this browser's IndexedDB. Each opened copy/tab uses its own branch, leaving the previous copy available. A new comparison round retains the earlier complete source/review round. **Download working copy** includes original text, unfinished choices/notes and round history, even when the current source cannot yet be compared.

Reopen a downloaded working copy or complete delivery through the original file control. Imported copies receive a separate working identity. Compare the reopened sources to regenerate their current view. If browser storage is unavailable or full, the status explains that the live copy needs a download; do not close it before retaining that file.

## Handover outputs

Enter the reviewer name and notes, then download:
- Complete delivery JSON with both original package texts, source/reference analysis and explicit decisions.
- Offline readable HTML with full association-direction/reference tables, search/state filters, record details and original-source/full-delivery downloads.
- Change CSV for the complete row set and review choices.

Open the generated HTML normally. Inspect all rows and source findings; download and reopen both original packages and the complete delivery. Printing includes all report rows and restores the selected filter afterward. The CSV is a summary; the full original JSON delivery remains authoritative.

## Capture selected provider sources and receive independently

The complete command-line course is in `product/CASE_CLI.md`. For the authored files:

```sh
node product/case-cli.mjs capture --file examples/framework-v1.json --label "Authored baseline" --out capture-before
node product/case-cli.mjs capture --file examples/framework-v2.json --label "Authored candidate" --out capture-after
node product/case-cli.mjs compare --before capture-before --after capture-after --review examples/review.json --out reviewed-example
node product/case-cli.mjs reproduce --case reviewed-example
node product/case-cli.mjs receive --delivery reviewed-example/case-edition-delivery.json --out independently-received
```

Use new output directories. The selected GET route is read-only and requires the exact requested framework UUID in its returned CFDocument. Authorization comes from the selected environment variable. Failed or wrong-package responses are not accepted as captures.

## Independent receiving and recovery

Use the original CLI to receive the complete browser delivery into a new directory, then reproduce its JSON, HTML, CSV and original source files. Interrupted materialization retains its complete inputs and can be recovered into a separate new directory. See product/CASE_CLI.md for exact commands and failure behavior.

The generic package includes one authored reference framework and two editions. It is a read-only source inspection/review consumer. It does not publish framework changes or claim certification, automatic semantic equivalence or authenticated reviewer signatures. The actual supplied original byte digests identify each edition; publisher version/timestamp remain separate metadata.

Source and focused pure-function/contract checks have completed. Actual native/browser execution must use this exact outgoing version and the owner inspection instruction in AGENTS.md; code publication alone is not an observed product result.

Created by TokenJunkie Labs. See LICENSE, NOTICE.txt and SOURCE_MAP.json for source and specification attribution.
