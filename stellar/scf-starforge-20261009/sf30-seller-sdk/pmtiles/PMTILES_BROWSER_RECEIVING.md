# PMTiles original map inspection continuation

This continuation extends the existing native Florence receiving operation through the complete map inspection and comparison desk. It uses the page that the original PMTiles caller already owns, and returns that page with its original unfinished edition draft and selected release controls restored.

## Exact source

- Repository: `woahwhattheheck/public-commons-sprint-2026`.
- Included source: `stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/exercise-pmtiles-preview.mjs`.
- Git blob: `bc8e730beb80c3307a43e41fe09a576b1b13443e`.
- Bytes: 38,474.
- SHA-256: `1bc0366e89e922d8e512d311f7298c67296f60b68c11dcb9513b9d42d153f3f7`.
- Served PMTiles application: public-sprint app blob `c722bb42012a23bbbbace5cc303d884fcdb852ec`.
- Served HTML: public-sprint index blob `02dfc89835f1fd2eb8d1fe78ef356ba7791dfd28`.
- Original source/controller reviewed for this join: native receiving `108787b25f043702079adb752472f8e6abba13cb`, controller `daf027eea9739a26480c82d208c1812e7a9e1b34`.

The helper reads the actual served app and HTML bytes and matches their Git identities before interacting. It also binds the original workspace, release manifest, edition source, review, preceding release, runtime identity, and its own bytes into a retained input.

## Join the current native owner

The existing native operation already owns the original archive, Martin, the complete runtime, workspace lease, browser and server. Insert this call after its `original-vector-source-replacement` phase, immediately before `complete-package`.

```js
import {exercisePMTilesPreview} from './exercise-pmtiles-preview.mjs';

const previewBrowser = await exercisePMTilesPreview({
  page,
  releaseId: vectorRelease.id,
  outputDirectory: join(root, 'browser-records', 'preview-inspection')
});

need(previewBrowser.status === 'COMPLETED',
  'PMTILES_PREVIEW_BROWSER_INCOMPLETE');
await step('original-vector-preview-browser', async () => previewBrowser);
```

Call the helper outside the cached step, so it can verify a previously completed set of exact files when the same original process resumes. Include `previewBrowser` in the original final `native-result.json`. The native result's existing completed-return branch should verify every `previewBrowser.files` descriptor with the original file reader before returning its completed outcome.

Use the current original Playwright module. If that selected path is a CommonJS `index.js`, the original browser loader should resolve `module.chromium ?? module.default?.chromium` before calling its existing `launchPersistentContext`. This helper accepts the live page and does not construct another browser or context.

## Original data at this point

The caller has already imported and checked the original 6,601,156-byte Florence vector archive, matching original four-layer style, native source-layer inventory, and v4 edition. That release is currently published and previewed. Its preceding published edition is obtained from the actual `previousReleaseId`; no release IDs are guessed.

The page still contains the original unfinished v3 draft:

> Customer draft retained across the original authoring Stop and Start.

The helper captures the original working draft, pending request, uploads, closed requests, layer visibility and decision notes, release selector, review inputs, comparison fields, scroll position and viewport in its private operation directory. It opens the actual released edition for comparison and transient view capture, then reopens the retained v3 draft through the existing exact-edition controls.

## Complete operator behavior

The helper performs these connected actions on the current original product:

1. Read the current release, original preceding release, both exact saved editions, native preview manifest and complete source metadata. Confirm that the displayed source SHA values and original vector-layer metadata match those native records.
2. Download the complete release selection, including the published predecessor. Open the actual release edition and compare its preceding published edition through the exact-edition form. Download that difference. Then use **Compare published release** and download the current publication comparison. At this insertion point that second comparison correctly compares the current published v4 with saved v4.
3. Find an actual visible vector layer, filter to it, change its visibility, and download the native map observation showing that change. Restore that same layer and retain all decision notes.
4. Fit the original archive bounds, capture the actual view into the existing edition draft, and download its native observation. Restore the released map view and restore the original saved draft fields.
5. Click actual positions on the native map until it returns a rendered vector feature. Inspect the selected original source/layer, complete native properties and geometry. Download that map inspection. The feature must belong to the original archive's vector-layer inventory.
6. Capture the actual desktop map and selected feature views, then the 390-pixel map. Record document/body/map widths and any overflowing element identities.
7. Reopen the original unfinished draft and restore the original controls, viewport and layer choices. Verify that its complete pending body, uploads and closed-request history are unchanged, and that no native mutation was dispatched during the inspection. The native workspace and published release retain their original identities.

All comparison and map inspection files are downloaded through the application's own buttons. Native reads use the page's existing workspace session. Access tokens are never included in the output records.

## Saved outcome and receiving

The private directory contains:

- `input.json`: immutable source and native selection.
- `original-browser-state.json`: the original operator draft and local workflow state.
- `active-draft.json`: the exact selected draft needed if an interruption occurs during the reversible edition/view excursion.
- `draft-transition.json`: the exact before and target values saved before changing multiple draft fields. Recovery accepts only those retained field values.
- `original-native-view.json`: the original source-bound view and layer selection restored before a resumed attempt reads its initial observation.
- `attempt-*/attempt.json`: the receiving phase and completed files.
- The actual release selection, predecessor and current-publication comparisons, original and changed-layer inspections, captured view, and original feature inspection.
- Desktop and 390-pixel PNG files.
- `native-browser-outcome.json`: native IDs, source metadata, actual feature selection, view/layer results and draft restoration.
- `browser-result.json`: the compact completed outcome and every exact `{path,bytes,sha256}` file descriptor.

A completed call checks its retained input and all saved file hashes before returning `reused:true`. The authoritative input and original browser state are published from fully written, fsynced temporary files through a create-only link. An incomplete attempt retains its error and restores the original draft through the existing controls. A resumed attempt first restores the retained layer choices, side inputs and released view before taking its new initial observation. A later attempt uses the same input and directory, preserving previous attempt files. Independent operator edits are surfaced for the existing receiving owner instead of being overwritten.

The parent owns process cancellation and close. This helper drains its own application listeners in `finally` and leaves the caller's page, browser, server and native preview under their original ownership. Continue the same original complete-package, cold receiving/restoration, CLI, merchant MCP and managed Applications phases afterward. The [selected installation guide](../../distribution/selections/PMTILES_OPERATIONS.md) supplies the original READY merchant installation used by that final Applications phase.
