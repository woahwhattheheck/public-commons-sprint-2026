# WQX scientific editions through the merchant operator

The WQX operator now exposes 39 tools. The two scientific operations compose the original paired scientific review with the existing managed project, native file transport and typed client.

Read [the scientific workflow and interpretation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/SCIENTIFIC.md) for original units, explicit reporting-unit choices, source qualifications, reporting-window summaries and cross-edition comparisons.

## Preview and save

```js
const request = {
  reviewId: 'potomac-q1-reporting-science',
  decisionReviewId: 'potomac-concentration-review-01',
  expectedDecisionReviewSha256: selectedDecision.reviewSha256,
  title: 'Potomac Q1 — original and reporting units',
  options: {},
  previousReviewId: originalScientific.reviewId,
  expectedPreviousReviewSha256: originalScientific.reviewSha256,
};
const preview = await client.scientificPreview({ request });
const complete = await client.downloadFile({
  file: preview.file, directory: '/srv/water/downloads/scientific-preview',
});
// Read the complete downloaded JSON when a large section is represented by a pointer.
const saved = await client.scientificSave({
  request: { ...request, expectedPreviewSha256: preview.result.previewSha256 },
});
```

`merchant_wqx_scientific_preview` and `merchant_wqx_scientific_save` use the same `{request}` or `{inputRef}` convention as existing native project operations. A preview retains the complete original HTTP response in `file`. Saving requires the exact preview's original request and hash. Repeating that same saved identity reopens the complete edition.

The typed methods are `scientificPreview` and `scientificSave`. The CLI commands are `scientific-preview` and `scientific-save`:

```bash
starforge merchant-wqx scientific-preview \
  --url http://127.0.0.1:3211 --workspace water --token-env MCP_ACCESS_TOKEN \
  --request-file /srv/water/scientific-request.json \
  --save-json /srv/water/scientific-preview-response.json

starforge merchant-wqx scientific-save \
  --url http://127.0.0.1:3211 --workspace water --token-env MCP_ACCESS_TOKEN \
  --request-file /srv/water/scientific-save-request.json \
  --save-json /srv/water/scientific-saved-response.json
```

The save request adds `expectedPreviewSha256` from the original complete preview. Native errors retain their original response file. The existing output reservation, input identities and provider operation IDs remain the continuation surface after interruption.

## Inventory, records and complete files

```js
const editions = await client.inventory({ kind: 'scientific', limit: 100 });
const edition = await client.record({ family: 'scientific', id: request.reviewId });
const bundle = await client.file({
  family: 'scientific', id: request.reviewId, format: 'bundle',
});
const local = await client.downloadFile({
  file: bundle, directory: '/srv/water/downloads/complete-scientific-review',
});
const received = await otherProject.receive({
  kind: 'scientific', inputRef: 'file:' + bundle.fileId,
});
```

An independent operator first uploads the complete downloaded bundle with the original `uploadWqxInput` method, then uses its returned input reference. The seven scientific file formats are `json`, `observations`, `observations-tsv`, `groups`, `changes`, `report` and `bundle`.

The full bundle retains the current and selected previous native sources, complete receiving choices, scientific options and the entire earlier review hash preimage. The receiving project recomputes both selected analyses from original source bytes before publishing the saved review. Current and earlier source identities remain distinct.

The original transport limit remains 128 MiB with 65,536-byte upload/read chunks. Complete scientific files use the same retained source binding, named input, prefix hash, lease, offset and resumable download as all existing WQX files. Inventory uses small immutable scientific summaries; full records remain available through their original file and JSON pointers.

## Whole receiving

The full [scientific receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/standardized-analysis/RECEIVING.md) extends the original complete Potomac operation.

Its MCP phase uses the original common provider initializer, maintained merchant HTTP server, two original managed projects and existing typed file client. It previews and saves through both new native tools, replays the same ID through the original CLI, exports all seven complete files, resumes the large scientific bundle across a merchant restart, receives both complete source editions in an independent project and compares every original output byte/hash after cold restart.

The original concentration proposal and scientific source calculations retain 1,035 results and 1,112 limits. The new representation selects 749 concentration records and independently converts 1,089 reported limits while keeping 451 blank result/unit pairs. The original/default scientific inclusion remains 413 arithmetic results, 452 censored results, 146 qualified results and 10 source-labelled estimates.

The complete execution records actual file sizes, source/review hashes, request count, original host identities, restarts and final outcomes in the same operation's `scientific-receiving/mcp-result.json`.
