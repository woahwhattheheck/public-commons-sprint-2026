# Receive the complete Manufacturing Data Desk

This is a continuation of the existing customer operation on its already equipped browser. It operates the delivered standalone desk and proposal, using the exact retained mechanical workspace to exercise editing and exports. The original customer desk starts empty. The mechanical source is labeled as an example and is never treated as customer operational data.

## Complete source and private inputs

Retain this runner beside the current complete source:

- `data_readiness.mjs`
- `data_comparison.mjs`
- `data_desk.mjs`
- `data_desk.css`
- `bundle.mjs`
- `build.mjs`
- `README.md`
- `receiving/receive_data_readiness.mjs`
- this guide.

The source owner supplies the exact standalone desk, complete customer proposal, already operated revision 9 mechanical workspace and its actual later source edition in the existing private customer handover. Keep both complete original files and their byte counts and SHA-256 digests. A raw workspace, complete working file or workspace-bearing handover can supply the later edition; its complete original envelope is retained for comparison and download. Customer names, offers and operational inputs stay out of the generic source repository. The public core begins with no data.

The earlier source-owner receipt described a revision 9 to revision 13 comparison. That is historical context, not a replacement input or a fixed expected outcome. The receiver requires the actual supplied later edition, checks its original workspace identity and retained history, requests and source editions, and calculates the expected comparison with the maintained engine. Do not generate a substitute successor or copy an unrelated empty customer workspace. Until the original pair is supplied, the comparison browser course remains unexecuted.

Use one private input JSON file:

```json
{
  "schema": "manufacturing-data-receiving-input.v1",
  "operationId": "THE_EXISTING_CUSTOMER_RECEIVING_OPERATION",
  "desk": {
    "path": "/owned/source/exact-customer-data-desk.html",
    "bytes": 0,
    "sha256": "EXACT_FULL_UTF8_SHA256"
  },
  "proposal": {
    "path": "/owned/source/exact-customer-proposal.html",
    "bytes": 0,
    "sha256": "EXACT_FULL_UTF8_SHA256"
  },
  "mechanicalWorkspace": {
    "path": "/owned/source/original-mechanical-workspace.json",
    "bytes": 9485,
    "sha256": "7850b02960e9c95813ebfa531ac947fd35e284f4c4d3a5e7175ad7307841ba16"
  },
  "comparisonWorkspace": {
    "path": "/owned/source/original-mechanical-successor.json",
    "bytes": 0,
    "sha256": "EXACT_COMPLETE_SUPPLIED_SUCCESSOR_SHA256"
  },
  "core": {
    "bytes": 30958,
    "sha256": "4d29b85b700e8300464f319512d56ddb491e44be5829958fef426053e695c397"
  },
  "comparison": {
    "bytes": 20872,
    "sha256": "3a18952c275a744168b4377e5b810e6a21336ab2297e1e80c581af8a97df4cba"
  }
}
```

Replace all three zero lengths and placeholder digests with the source owner's actual complete file identities. Paths belong to the same private source edition. The module identities shown are the comparison feature's source edition; use the exact selected current module identities if the application has subsequently changed. The runner reads its actual relative `../data_readiness.mjs` and `../data_comparison.mjs` and requires both identities. Rebuild the standalone desk from that same complete source before selecting its hash; an older HTML desk lacks the comparison controls. The mechanical baseline is the complete already-operated original, public source blob `da1c61858600a59f04a2c8003a0f66e48bbccc07`; its explicit label and all nine revisions remain intact. No replacement customer dataset is generated.

## Join the original equipped browser

Import the function into the current receiving programme, using its actual existing Playwright browser and a new owned output child:

```js
import {runDataReadinessCourse} from './receiving/receive_data_readiness.mjs';

const result = await runDataReadinessCourse({
  browser: existingBrowser,
  inputFile: '/owned/original-case/manufacturing-receiving-input.json',
  outputRoot: '/owned/original-case/manufacturing-receiving',
  onProgress: event => originalReceivingLog(event)
});
```

The runner uses separate browser contexts and closes only those contexts. It leaves the caller's browser open. It loads the exact supplied HTML with `setContent`, requires no public server, blocks HTTP(S) requests inside its own contexts, and changes no browser policy. Use the installed source/browser versions already accepted by the original receiver. Do not create another customer case, competing process request or paid browser run.

Retain the same complete input and output paths after interruption. Each attempt receives its own child directory, preserving earlier downloads and images. This extended course uses `browser-recovery-receiving.json`; it leaves any earlier baseline-only `receiving.json` and its completed outputs unchanged. Thus a previously completed baseline course can continue through the new comparison journey in the same original operation without treating its old result as completion of new work. The new journal binds the complete input digest, including both source files and both modules. A completed invocation verifies all retained output file identities and returns the same result. The original receiver remains the sole executor; this helper does not schedule work or claim an external host.

## The actual user workflow

The course opens the customer desk at desktop and narrow widths, verifies that its source tables are empty, and saves that exact initial working file. It enters a clearly labeled receiving note, stages the complete original mechanical working file through the normal file chooser, and explicitly opens it. The displaced initial desk and note must remain in history.

It then imports the actual retained mechanical inventory with an explicit UTF-8 BOM, selects and restores the explicit blank-revision mapping, downloads the exact incoming original, and adopts the new source edition. An invalid UTF-8 mechanical file exercises the real error path; the current workspace must remain intact.

The actual retained circular BOM predecessor is opened through the normal mapping review. A reviewer records a note on the exact cycle exception. The complete exceptions CSV and readable report are downloaded and reopened. The earlier valid BOM is deliberately restored as a successor source while all prior editions and the cycle note remain retained.

All four complete canonical CSVs and table JSONs are downloaded, as are the four selected exact original CSVs. They are compared to the source-bound core exports and reopened in readable browser views.

The course then opens the two exact supplied source files through **Open an edition for comparison**. Importing them must retain the complete originals beside the current desk, without replacing its active source workspace. The normal selectors choose the exact baseline and later edition. The course operates the supported added, missing, changed, ambiguous and all-differences filters, keeping unchanged identities in their summary counts.

Where the actual comparison has a difference, the reviewer records a working disposition and source-owner note against that exact difference, then leaves a separate unfinished edit. Both the recorded review history and unfinished draft must survive. If the supplied pair has no differences, the result records that fact and the skipped review explicitly; it never invents a difference or review to satisfy a fixed count. Source errors and incomparable families remain the original engine's result.

The complete comparison JSON, differences-and-issues CSV, and readable HTML report are downloaded and matched to the maintained engine's full output with the actual review history. Both retained original source files are downloaded and matched byte-for-byte. The course opens the report at desktop and 390 pixels, renders the complete CSV and JSON, and opens both exact original files in readable browser views.

The complete current working file is then opened in a fresh context; its full editor, source history, mappings, decisions, chosen source pair, comparison reviews and unfinished notes must match. A separately named compatibility copy changes only the saved comparison filter to the older `unchanged` value. Opening it through the normal working-file controls must normalize that filter to `all` and preserve every other source and editor field. This compatibility copy contains the actual retained source data; it creates no new manufacturing observations. Finally the exact customer proposal is rendered at both widths.

Outputs include:

- complete initial, staged, adopted and cold-reopened working JSON;
- all original selected CSV files, with exact UTF-8 BOM identity where present;
- complete canonical tables in CSV and JSON;
- cycle exceptions and complete readable reports;
- complete handover JSON;
- both complete supplied comparison originals and their exact downloaded copies;
- complete comparison JSON, differences-and-issues CSV and readable HTML report;
- complete comparison working files with recorded review history and unfinished notes;
- the clearly named legacy-filter compatibility copy and its recovered complete working file;
- actual desktop and 390-pixel screenshots;
- `browser-recovery-receiving.json` with exact input, output, viewport, source-pair outcome and original operation identities; any historical `receiving.json` remains unchanged.

The helper uses the source's actual controls and original browser download events. It measures horizontal document overflow. It does not claim that creating screenshots means a producing peer has viewed them.

## Producing-peer visual and attachment inspection

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation or export ready, or putting it before a client/prospect, the responsible producing peer must open, run and render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare or presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes all attachments. Observe the actual thing the way a recipient would see and use it. Open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, archives and project attachments in their normal viewer or application. Play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text and a browser link do not substitute for opening and using the attachment.

Fix ugly, cramped, broken, unstyled, clipped, overflowing or unreadable results within the authorized task before presenting them. Favor plain industrial presentation, consistent spacing and typography, readable tables and working controls. Do not add decorative template styling. Source review, unit tests, HTTP 200, DOM counts, reviewer approval or an evidence form do not substitute for looking at and operating the actual product.

This is focused internal product validation, not permission to build a verification product, run broad suites or repeatedly recheck an unchanged accepted version. Building and integrating the deliverable remains the main work. Retain an exact-version visual handoff: source/artifact identity, URL/file, viewport sizes, actual images viewed, controls/states/export files exercised, fixes and any precise unresolved gap. A changed outgoing version requires inspection of its affected result. Create no separate approval gate.

For new video or media narration, use available high-quality generative voice/TTS and appropriate generative media capabilities, with natural professional delivery rather than a robotic default voice. Actually play, listen and watch the final attachment; inspect pronunciation, clarity, pacing, timing and audio alignment. A text script review does not substitute. This gives no paid-service purchase or real-person voice-cloning authorization.

Every message to a warm lead requires Bryce’s approval for that exact proposed text and its attachments before sending. Earlier approval for a thread does not approve a later message. A favorable human reply moves subsequent messages to that individual approval rule; internal preparation continues in the original customer case.

Pass this instruction into delegated and resumed work. Preserve existing owner controls, original operations, customer contact ownership, source/credential boundaries, no private GitHub publication, no GitHub Actions, no llama.cpp, stopped-work cutoffs and current contact holds. This instruction creates no watchers, hooks, restarts, approval queue or new publication authority.

Return full original screenshot files and the actual outputs to the existing private customer case. The producing peers must open and view the returned images and delivered files, then repair the first concrete visual or functional issue in this same source edition. Keep the complete working records and original operation intact.

## Complete browser copy recovery

The same `runDataReadinessCourse` now serves the exact selected desk bytes on one ephemeral `127.0.0.1` origin. It opens two pages in one existing-browser context, using the browser's real shared localStorage. Only that literal desk URL is allowed in this context; the course creates no public host or additional browser controller.

After opening the complete original source-comparison working file, the first operator saves a narrative. The second operator edits its earlier copy. The course verifies that the first shared head remains intact and that the second complete editor is separately journaled, including the original comparison sources, recorded reviews and unfinished notes. It continues the second draft independently, opens the current shared head while retaining the displaced full editor, and exercises a second stale edit.

Deliberate publication must retain its complete predecessor in the flat recovery archive. A third page stages the actual second-page journal through the recovery panel and reopens the displaced independent editor. Six alternating real edits and explicit publications must preserve all preceding operator narratives, original source bodies and comparison state without recursively embedding earlier archives. The actual saved byte sizes are returned in `browser-10-actual-repeated-publication-sizes.json`. A fresh independent browser context then imports the complete recovered working file and reopens the exact editor.

The course records `complete_browser_drafts_recovered` with the actual outcomes. All original source/comparison operations remain earlier in the same course. Its current result is `browser-recovery-receiving.json`; prior `receiving.json` and `source-comparison-receiving.json` records remain untouched.

## Additional authored assembly example

The original revision-9 receiving workspace and its exact paired successor remain required. To also operate the complete supplier-authored nested-assembly example, add this optional exact file identity to the existing private input:

```json
"authoredExample": {
  "path": "/absolute/path/authored-assembly-operating-example.json",
  "bytes": 121761,
  "sha256": "494e8154283678ea42a5f3f584bbfcb349ef97918f53e5b8c6353dbc0897320e"
}
```

This is an additional authored example, separate from the original revision-9 native fixture and any customer's operational data. The complete bank has nineteen files and binds the unchanged core. The course retains every original member and opens the initial complete desk with four sources and nine source errors. It records the two original BOM-cycle and purchase-order review notes through the normal controls, applies the explicit `cm → m` factor `0.01`, and verifies six errors remain. It imports and selects each of the four corrected original CSV files through the actual mapping workflow.

The operated result must retain all eight original source editions, both earlier review decisions and the exact canonical values and derived quantities. Its revision is 11 and the source checker reports zero errors. The course exports the actual initial-to-corrected comparison and complete readiness report, renders the populated desk and report at both widths, then reopens the complete working file in an independent context. All actual source, output and operation identities are returned in the original result. The producing peer still opens and LOOKs at the returned images and complete outgoing files.
