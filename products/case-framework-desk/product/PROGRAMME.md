# Two-framework CASE commissioning programme

Use Node 22 or later to open the original loopback server:

```sh
node product/serve-desk.mjs --port 8765
```

Open its printed address. The server serves the complete selected product and authored examples. Publisher source and programme writing stay in the browser. The existing five-module CASE capture/compare/receive CLI is unchanged.

## Select the programme

Enter the programme title, customer or owner, work package and working notes. Each of the two framework slots has its own label, original CFDocument UUID, publisher/source, reviewing owner, intended use and selection notes. Keep credentials out of these portable fields.

Choose a framework and Round one or Round two. These are separate complete source/review records, not filters on one mutable pair. The continuity panel shows each observed UUID, open changed-row count and whether the two compared rounds retain identical baseline bytes. An empty selected UUID remains unfinished; a known selected UUID must agree with the source before comparison succeeds. Cross-framework alignment is a separate semantic task. Similar titles do not establish identity.

For the original two-round commissioner, retain the same approved baseline for each framework across both rounds. A changed candidate is a new explicit input. The desk shows a different baseline as a selection problem; it does not silently replace the earlier source or issue an approval. The private commissioner binds actual customer approval to the exported identities separately.

## Work with complete sources

Choose or paste the baseline and candidate JSON. Labels and source locators are literal editable fields. File reads retain complete UTF-8 text. Unfinished JSON and text beyond the native comparison limit remain in the working file; the original engine reports admission errors when asked to compare. Each admitted original package is limited to 1 MiB, 5,000 items and 8,000 associations as in the original source contract.

Editing a compared package or its label/location retains the complete earlier pair, review and source report in that round's history, then opens a new unreviewed selection. Source-specific decisions do not migrate silently to changed publisher bytes. Download any earlier pair from the selected round.

The supplied authored example is one framework with two editions. Loading it is an explicit action on the selected round and first freezes the whole preceding programme. It is not a second real customer framework.

## Inspect and review

Compare the selected pair. The unchanged CASE engine retains original source text, numeric coefficient/exponent values, extensions, collection order, association directions, local identity conflicts and external/not-loaded references. No external references are fetched by the desk.

Filter the complete row table by text and observed state. Open a record, enter ACCEPT, INVESTIGATE or DEFER, and record a reason or next action. A note without a disposition remains unfinished and blocks a pair delivery until a choice is supplied. Enter the named reviewer and review notes. Reviewer names are supplied text, not authenticated signatures.

Comparison/export reads a frozen source selection. If source text changes during a comparison, the result does not replace current writing. Switching framework or round is serialized against file admission, comparison and receiving operations. Literal editing remains possible during asynchronous work; its updates survive that work.

## Browser retention, editions and imports

Each page writes its own IndexedDB branch. Writes are serialized. The recovery pointer is written and read back only after the corresponding complete database write. A failed database or pointer write leaves visible recovery text and a closing warning; the complete working JSON and HTML remain available for download.

The newly opened standalone HTML supplies the selected programme. A previously saved browser copy never silently replaces it. Download or add that prior browser original explicitly. Use **List saved browser branches** to find earlier pages/programmes and add the selected branch as a named edition. Starting a new programme retains the previous complete branch under its original database key.

Freeze both frameworks and both rounds under a named edition. Restoring an edition first retains the displaced current programme. Imported programme files are added as received editions, with their exact original text and SHA-256 retained. They do not replace current writing. Original single-pair `commons.case-working.v1` files can also be imported; their entire legacy history remains downloadable in the retained original, while the current pair becomes the first framework/round of a separate received edition.

A downloaded named edition is itself a complete working programme and can be reopened. All full JSON/HTML downloads preserve intake, source text, review choices, unfinished controls, prior rounds, named editions, receiving records and imported originals.

## Receiving history

Use **Retain complete JSON record** to preserve the exact original text and its name, byte length, hash and context note.

- Complete `commons.case-edition-delivery.v1` records are independently reproduced through the existing CASE engine before receiving status becomes REPRODUCED.
- Full capture objects with their source are inspected using the original source reader.
- Native cold-reproduction receipts and other records are retained as SUPPLIED_RECORD. Importing them does not claim a native operation ran in this browser.
- Invalid JSON or a delivery that fails reproduction stays retained as NEEDS_ATTENTION, including its actual error and original text.

Adopting a reproduced pair is explicit, targets the selected framework/round, checks the selected UUID, and freezes the preceding complete programme. It does not rewrite a prior received original. No action writes to a publisher, creates a new customer approval or executes a native receiving job.

## Pair exports and whole programme handover

Pair delivery, review, readable report and CSV use the original CASE functions. Each pair's complete delivery remains usable by the unchanged CLI:

```sh
node product/case-cli.mjs receive --delivery case-edition-delivery.json --out new-pair-receiving
node product/case-cli.mjs reproduce --case new-pair-receiving
```

The full working JSON can be inspected, converted to a complete editable HTML, or materialized as a full programme directory:

```sh
node product/programme-cli.mjs inspect --working case-programme-working.json
node product/programme-cli.mjs html --working case-programme-working.json --out new-programme.html
node product/programme-cli.mjs export --working case-programme-working.json --out new-programme-directory
```

All output paths must be new; parent directories must exist. The file-only tool reads ordinary files, checks descriptor identity before/after reading, creates outputs exclusively, synchronizes files, and checks complete readback. Directory sync is used on POSIX; Windows retains file sync and readback. There is no network request or publisher write.

The export contains:

- exact `selected-working-original.json`, retained before derived materialization;
- complete `programme-working.json` and editable `programme-working.html`;
- `programme-selection.json`, mapping both framework slots and all compared rounds to exact UUIDs and baseline/candidate identities;
- for each compared round, `framework-one-round-one-delivery.json`, `...-review.json`, `...-before.json` and `...-after.json` (and the corresponding other framework/round names);
- `programme-manifest.json`, written last, identifying every other complete member.

The generic keys are framework-one/framework-two and round-one/round-two. The original customer commissioner maps these keys explicitly to its approved framework-1/framework-2 identities. It must check actual approval, customer/work package, source hashes and round continuity. The generic selection itself is authored input, not approval or completed receiving.

Every compared pair must have a valid reviewer and decisions before the complete export succeeds. Uncompared rounds remain visible as unfinished in selection/continuity; no fabricated pair is emitted. Download the full working JSON/HTML at any point, including unfinished source/review work.

If materialization is interrupted, retain the directory and rerun export into a new directory from the already pinned `selected-working-original.json`. Nothing overwrites the interrupted output. Pair-native recovery remains the original `case-cli.mjs recover` contract described in CASE_CLI.md.

## Source and actual product receiving

The original CASE source parser, semantic comparison, report renderer, HTTP capture and five-module CLI are unchanged. Existing results continue to name their actual original source edition. The new programme model, browser controller, persistence adapter, standalone builder and file-only CLI have their own selected source edition.

The producing operator must open and LOOK at the exact current browser and standalone HTML at desktop and narrow widths; use framework/round switching, literal source/review fields, invalid-source errors, receiving/adoption, named editions, downloads and independent reopen. View the actual generated pair reports and complete programme output. Source execution and authored browser/API ports do not replace actual rendered or native receiving. Continue the existing commissioning receiving operation with these exact source files and preserve its actual results.

## Focused source exercise

`node product/programme-course-cli.mjs` runs the retained whole source exercise: two frameworks × two rounds, source/receiving compatibility, local persistence failures, literal writing and actual page/file-CLI callbacks through authored boundaries. Its report labels those boundaries. The original equipped receiving operation separately owns the real native command, browser rendering and downloaded-product reopen.
