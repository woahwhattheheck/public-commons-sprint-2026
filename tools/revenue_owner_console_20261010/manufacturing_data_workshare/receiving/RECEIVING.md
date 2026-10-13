# Receive the complete Manufacturing Data Desk

This is a continuation of the existing customer operation on its already equipped browser. It operates the delivered standalone desk and proposal, using the exact retained mechanical workspace to exercise editing and exports. The original customer desk starts empty. The mechanical source is labeled as an example and is never treated as customer operational data.

## Complete source and private inputs

Retain this runner beside the current complete source:

- `data_readiness.mjs`
- `data_desk.mjs`
- `data_desk.css`
- `bundle.mjs`
- `build.mjs`
- `README.md`
- `receiving/receive_data_readiness.mjs`
- this guide.

The source owner supplies the exact standalone desk, complete customer proposal and already operated revision 9 mechanical workspace in the existing private customer handover. Customer names, offers and operational inputs stay out of the generic source repository. The public core begins with no data.

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
  "core": {
    "bytes": 30924,
    "sha256": "d679c01e51519467eede041b751a0562b4b77a6aaa8343358d0d1887b57c06fc"
  }
}
```

Replace the two zero lengths and placeholder digests with the source owner's actual complete file identities. Paths belong to the same private source edition. The runner reads its actual relative `../data_readiness.mjs` and requires that identity too. The mechanical workspace is the complete already-operated original, public source blob `da1c61858600a59f04a2c8003a0f66e48bbccc07`; its explicit label and all nine revisions remain intact. No replacement customer dataset is generated.

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

Retain the same input and output paths after interruption. Each attempt receives its own child directory, preserving earlier downloads and images. A completed invocation verifies all retained output file identities and reopens the same result. The original receiver remains the sole executor; this helper does not schedule work or claim an external host.

## The actual user workflow

The course opens the customer desk at desktop and narrow widths, verifies that its source tables are empty, and saves that exact initial working file. It enters a clearly labeled receiving note, stages the complete original mechanical working file through the normal file chooser, and explicitly opens it. The displaced initial desk and note must remain in history.

It then imports the actual retained mechanical inventory with an explicit UTF-8 BOM, selects and restores the explicit blank-revision mapping, downloads the exact incoming original, and adopts the new source edition. An invalid UTF-8 mechanical file exercises the real error path; the current workspace must remain intact.

The actual retained circular BOM predecessor is opened through the normal mapping review. A reviewer records a note on the exact cycle exception. The complete exceptions CSV and readable report are downloaded and reopened. The earlier valid BOM is deliberately restored as a successor source while all prior editions and the cycle note remain retained.

All four complete canonical CSVs and table JSONs are downloaded, as are the four selected exact original CSVs. They are compared to the source-bound core exports and reopened in readable browser tables. The complete current working file is then opened in a fresh context; its full editor, source history, mappings and decisions must match. Finally the exact customer proposal is rendered at both widths.

Outputs include:

- complete initial, staged, adopted and cold-reopened working JSON;
- all original selected CSV files, with exact UTF-8 BOM identity where present;
- complete canonical tables in CSV and JSON;
- cycle exceptions and complete readable reports;
- complete handover JSON;
- actual desktop and 390-pixel screenshots;
- `receiving.json` with exact input, output, viewport and original operation identities.

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
