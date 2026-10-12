# Complete SCF submission review receiving

This directory retains the full actual-source model exercise for `SCF-SUBMISSION-REVIEW-ROUND-7108-20261012-MODEL` and the exact inputs for the existing reviewer application's browser receiving.

The final source-model execution completed at 2026-10-12T17:55:07.693Z. It retained 33 actions, 20 review targets, three complete native draft exports, all nine answers, the original receiving-example field and four author versions. Independent receiving returned the exact original 811,774-byte review JSON; explicit reopening added its 34th action. The complete report contains 41,182 bytes. All nine original artifact bodies total 3,417,626 bytes.

The example field and participants are explicitly labeled automated receiving observations. They do not claim an observed issuer form, human review, submission or issuer approval. The deterministic editorial timeline is separate from the actual execution timestamps. Both underlying application bodies are complete retained public source editions; the current canonical manuscript continues through its original author.

## Exact complete artifacts

`complete-model-artifacts.json` is one lossless UTF-8 carrier. Its SHA-256 is `8dc4f25a0e5e06b6988b81745331023e8481bbf9432f37bc0008b38e24b894e7`; Git blob `2274d5f56421e64892adefb83e2b7d1bd77c4fc6`. Its base64 payload is gzip of the complete original JSON envelope, with independent compressed and expanded size/SHA descriptors. That envelope contains every original file, the full model result, the eight exact product source identities and the capture descriptors needed by the browser callback. No artifact is a partial download or a link-only substitute.

`model-result.json` is the complete readable native-source result. `current-native-compatibility.json` records the separate actual validation of all three untouched exports against the subsequently merged planning-aware submission core, its original planning module and unchanged shared store. This does not relabel the earlier complete model exercise as a run of a newer source body.

## Use the retained original browser inputs

Run this input decoding inside the already-owned reviewer receiving process. Use its original Page, selected runtime/source manifest, output writer and operation. The browser callback does not start a listener, browser or publication.

```js
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runGrantReviewBrowser} from '../../stellar-forge/developer-site/GRANT_REVIEW_ROUNDS_BROWSER.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const carrierBytes = await readFile(new URL('./complete-model-artifacts.json', import.meta.url));
if (sha(carrierBytes) !== '8dc4f25a0e5e06b6988b81745331023e8481bbf9432f37bc0008b38e24b894e7') throw new Error('The selected full carrier changed.');
const carrier = JSON.parse(carrierBytes);
if (carrier.schema !== 'stellar-forge.grant-review-model-artifact-carrier.v1') throw new Error('Select the complete original carrier.');
const compressed = Buffer.from(carrier.content, 'base64');
if (compressed.length !== carrier.gzip.bytes || sha(compressed) !== carrier.gzip.sha256) throw new Error('Incomplete original compressed payload.');
const expanded = gunzipSync(compressed, {maxOutputLength: 8 * 1024 * 1024});
if (expanded.length !== carrier.json.bytes || sha(expanded) !== carrier.json.sha256) throw new Error('Incomplete expanded originals.');
const model = JSON.parse(expanded);
if (model.schema !== 'stellar-forge.grant-review-complete-model-artifacts.v1' || model.result.state !== 'COMPLETE') throw new Error('Keep the completed original exercise.');
const files = new Map();
for (const item of model.artifacts) {
  const body = Buffer.from(item.content, 'utf8');
  if (files.has(item.path) || body.length !== item.bytes || sha(body) !== item.sha256) throw new Error('Changed or repeated original artifact.');
  files.set(item.path, item);
}
const fixtures = {fieldId: model.browserFixtures.fieldId};
for (const name of ['firstCapture', 'editedCapture', 'latestCapture']) {
  const {artifactPath, ...descriptor} = model.browserFixtures[name];
  const original = files.get(artifactPath);
  if (!original || original.bytes !== descriptor.bytes || original.sha256 !== descriptor.id) throw new Error('Retain the exact original native capture.');
  fixtures[name] = {...descriptor, exportText: original.content};
}

const result = await runGrantReviewBrowser({
  page: existingReceivingPage,
  baseUrl: actualOriginalReviewerBaseUrl,
  fixtures,
  sourceFiles: actualSelectedBrowserSourceDescriptors,
  operationId: 'SCF-SUBMISSION-REVIEW-ROUND-7108-20261012-BROWSER',
  checkpoint: originalRetainedCheckpointOrNull,
  retain: existingAtomicCheckpointWriter
});
```

The last variables are supplied by the original receiving owner. `sourceFiles` must select the actual complete bytes served at all four new review routes, `grant-submission-core.mjs`, `drafts.mjs`, and the native core's actual module closure, including the original `grant-plan-core.mjs`. Every descriptor has route, bytes, sha256 and gitBlob. Do not substitute the older submission editor source for the current planning/handover version.

Use the original receiving writer to retain every returned checkpoint and complete artifact. Preserve the actual original Page and the full error/checkpoint on interruption. A frozen UI export is selected before separate-record import/reopen, so retry retains the original export timestamps, screenshot identities and event prefix. Only the received browser copy is explicitly reopened; the original review stays complete. Completed individual downloads are verified and reused before another UI click. Both independent receiving and recovery retain the exact full copy intent and pre-existing store identities before Save copy; continuation reconciles that original new record before another save.

## Whole application integration

The complete operating and API guide is [GRANT_REVIEW_ROUNDS.md](../../stellar-forge/developer-site/GRANT_REVIEW_ROUNDS.md). The existing serial composer applies `attachGrantReviewRounds`, the shared asset declaration applies `registerGrantReviewRoundAssets`, and the original submission page applies `attachReviewRoundToSubmission`. Keep the complete native planning, financial, customer and handover source closures together.

018A owns the final original composer and installed contribution join; 81CF owns canonical application text; 7F5A owns the native planning/editor source; 1B40 owns the complete submission handover. The original 6CF6/8910 receiving and Site operation remains the browser/publication owner. This directory records a completed actual source-model exercise and complete browser inputs; it does not claim the original Site was published or the browser callback already ran.
