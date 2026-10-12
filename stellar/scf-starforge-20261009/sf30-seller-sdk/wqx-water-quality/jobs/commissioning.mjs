// MIT. Complete reviewed KiWIS commissioning through the original paid Water Quality function.
import { operationId } from '../project.mjs';
import { canonical, digest } from '../kiwis/source.mjs';
import { COMMISSIONING_FORMATS } from '../kiwis/formats.mjs';
import { receiveCommissioningReview, exportCommissioningReview } from '../kiwis/workflow.mjs';

export const WQX_COMMISSIONING_JOB_RESULT_SCHEMA = 'starforge.wqx-commissioning-job-result.v1';
export const WQX_COMMISSIONING_BUNDLE_SCHEMA = 'starforge.kiwis-commissioning-bundle.v1';
export const WQX_COMMISSIONING_SOURCE_LIMIT = 128 * 1024 * 1024;
export const COMMISSIONING_JOB_EXPORTS = Object.freeze({
  bundle: 'complete-commissioning.json',
  review: 'commissioning-review.json',
  decisions: 'decisions.json',
  observations: 'observations.csv',
  counterparts: 'counterparts.csv',
  correspondences: 'correspondences.csv',
  series: 'series.csv',
  report: 'report.html',
});
const HASH = /^[0-9a-f]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a,b) => canonical(a) === canonical(b);
const requestKeys = ['mode','reviewId','expectedCommissioningSavedSha256','expectedCommissioningReviewSha256'];

/** Select the existing immutable record; its native receiver still reproduces every source and choice. */
export function commissioningJobIdentity(record) {
  if (!plain(record) || record.schema !== 'starforge.kiwis-commissioning-saved.v1')
    fail('JOB_INPUT_KIWIS_SAVED_REVIEW_REQUIRED');
  operationId(record.reviewId); operationId(record.sourceId);
  const { savedSha256, ...body } = record, review = record.review;
  if (!HASH.test(savedSha256 ?? '') || digest(canonical(body)) !== savedSha256 ||
      !plain(review) || review.schema !== 'starforge.kiwis-commissioning-review.v1')
    fail('JOB_INPUT_KIWIS_SAVED_REVIEW_CHANGED');
  const { reviewSha256, ...content } = review;
  if (!HASH.test(reviewSha256 ?? '') || digest(canonical(content)) !== reviewSha256 ||
      !HASH.test(review.sourceSha256 ?? '') || digest(canonical(review.source)) !== review.sourceSha256 ||
      !plain(review.document) || review.document.schema !== 'starforge.kiwis-commissioning-decisions.v1' ||
      review.document.sourceSha256 !== review.sourceSha256 ||
      digest(canonical(review.document)) !== review.documentSha256)
    fail('JOB_INPUT_KIWIS_REVIEW_CHANGED');
  return {
    reviewId: record.reviewId, sourceId: record.sourceId, title: record.title,
    savedSha256, reviewSha256, documentSha256: review.documentSha256,
    sourceSha256: review.sourceSha256, source: review.source, counts: review.counts,
  };
}

/** Exact ordinary JSON input; the original upload controller adds its source descriptor in $files. */
export function commissioningJobInput(bundle) {
  if (!plain(bundle) || bundle.schema !== WQX_COMMISSIONING_BUNDLE_SCHEMA)
    fail('JOB_INPUT_KIWIS_COMPLETE_BUNDLE_REQUIRED');
  const identity = commissioningJobIdentity(bundle.review);
  const input = {
    mode: 'commissioning', reviewId: identity.reviewId,
    expectedCommissioningSavedSha256: identity.savedSha256,
    expectedCommissioningReviewSha256: identity.reviewSha256,
  };
  selectCommissioningJob(input,bundle);
  return input;
}

export function selectCommissioningJob(input,bundle) {
  if (!plain(input) || Object.keys(input).some(key => ![...requestKeys,'$files'].includes(key)) ||
      input.mode !== 'commissioning') fail('JOB_INPUT_KIWIS_COMMISSIONING_MODE_REQUIRED');
  if (!plain(bundle) || bundle.schema !== WQX_COMMISSIONING_BUNDLE_SCHEMA)
    fail('JOB_INPUT_KIWIS_COMPLETE_BUNDLE_REQUIRED');
  const { bundleSha256, ...body } = bundle;
  if (!HASH.test(bundleSha256 ?? '') || digest(canonical(body)) !== bundleSha256)
    fail('JOB_INPUT_KIWIS_BUNDLE_CHANGED');
  const identity = commissioningJobIdentity(bundle.review), original = bundle.input;
  if (!plain(original) || original.schema !== 'starforge.kiwis-commissioning-input.v1' ||
      original.sourceId !== identity.sourceId || original.sourceSha256 !== identity.sourceSha256)
    fail('JOB_INPUT_KIWIS_SOURCE_CHANGED');
  const { inputSha256, sourceSha256, ...source } = original;
  if (!HASH.test(inputSha256 ?? '') || digest(canonical(source)) !== inputSha256)
    fail('JOB_INPUT_KIWIS_SOURCE_CHANGED');
  if (input.reviewId !== identity.reviewId) fail('JOB_INPUT_KIWIS_REVIEW_ID_CHANGED');
  if (input.expectedCommissioningSavedSha256 !== identity.savedSha256)
    fail('JOB_INPUT_KIWIS_SAVED_REVIEW_CHANGED');
  if (input.expectedCommissioningReviewSha256 !== identity.reviewSha256)
    fail('JOB_INPUT_KIWIS_REVIEW_CHANGED');
  if (!same(COMMISSIONING_FORMATS,Object.keys(COMMISSIONING_JOB_EXPORTS)))
    fail('JOB_OUTPUT_KIWIS_FORMATS_CHANGED');
  return { ...identity, inputSha256, bundleSha256 };
}

export function commissioningJobResultGuide(manifest) {
  const selected = manifest.commissioning;
  return [
    '# Complete KiWIS commissioning delivery', '',
    'Open commissioning/report.html for the complete operator review. manifest.json binds the original job, exact sealed source, saved choices and every delivered member.', '',
    'The service received the complete saved commissioning bundle through the original waterQualityReview function and independently reconstructed its original KiWIS and native counterpart sources. The native planner reproduced the exact saved review before these outputs were emitted.', '',
    '## Saved edition', '',
    'Job: ' + manifest.jobId,
    'Saved review: ' + selected.reviewId + ' / ' + selected.savedSha256,
    'Commissioning review: ' + selected.reviewSha256,
    'Original source pair: ' + selected.sourceId + ' / ' + selected.sourceSha256,
    'KiWIS edition: ' + selected.source.kiwisEditionSha256,
    'Counterpart: ' + selected.source.counterpart.kind + ' / ' + selected.source.counterpart.sourceSha256, '',
    '## Complete delivered files', '',
    '| Path | Contents |', '| --- | --- |',
    '| original/source-bundle.json | Every exact sealed input byte, including original response bodies, receipts, source metadata and the native counterpart. |',
    '| original/commissioning-selection.json | Exact original saved name, source bindings, full field/time/quality/correspondence choices and reasons. |',
    '| commissioning/complete-commissioning.json | Complete native portable project bundle. |',
    '| commissioning/commissioning-review.json | Entire immutable saved review and every physical record disposition. |',
    '| commissioning/decisions.json | Complete editable source-bound decision document. |',
    '| commissioning/observations.csv | Every original KiWIS observation, original fields and source pointer. |',
    '| commissioning/counterparts.csv | Every complete native counterpart record and source/interpretation context. |',
    '| commissioning/correspondences.csv | Every selected, competing, separate, unresolved or review-required relationship. |',
    '| commissioning/series.csv | Complete selected series, original metadata and request/quality coverage. |',
    '| commissioning/report.html | Full human-readable review with mappings and source identities. |', '',
    '## Receive and reopen', '',
    'Use KiWIS commissioning → Receive in an independent private Water Quality workspace and select commissioning/complete-commissioning.json.',
    'The installed original command uses the same receiver:', '',
    '    starforge water-quality kiwis receive --project /private/received-commissioning --bundle /absolute/unpacked/commissioning/complete-commissioning.json --out /private/commissioning-received.json',
    '    starforge water-quality kiwis read --project /private/received-commissioning --review ' + selected.reviewId, '',
    'Receive reproduces the original source pair and every saved choice. Reopening preserves the same saved names and identities. A revised mapping or time/quality/correspondence choice belongs in a new immutable commissioning review before another job is selected.', '',
    '## Interpretation', '',
    'This delivery preserves the reviewed relationships; it does not infer a new station, parameter, timezone, unit conversion or quality policy. Original timestamps and sample timestamps remain separate. Every limit, qualifier, censored/blank result, duplicate record, raw response type and original unit remains available in the full source and native exports.',
    'Unresolved and review-required records stay visible with their original status and candidates. They are complete delivered review work, not silently accepted scientific matches.', '',
  ].join('\n');
}

/** Append all eight native formats only after the original receiving functions reproduce the complete edition. */
export async function appendCommissioningJob({project,bundle,archive,context,input,sourceFiles}={}) {
  const expected = selectCommissioningJob(input,bundle);
  context.signal.throwIfAborted();
  let record = await receiveCommissioningReview({project,bundle});
  bundle = null;
  context.signal.throwIfAborted();
  const reproduced = commissioningJobIdentity(record);
  const {inputSha256,bundleSha256,...original} = expected;
  if (!same(reproduced,original)) fail('JOB_INPUT_KIWIS_RECOMPUTE_CHANGED');
  const selection = {
    schema:'starforge.wqx-commissioning-job-selection.v1',
    ...expected, document:record.review.document,
  };
  record = null;
  await archive.add('original/commissioning-selection.json',Buffer.from(json(selection)),
    {contentType:'application/json'});
  const exports = [];
  for (const [format,name] of Object.entries(COMMISSIONING_JOB_EXPORTS)) {
    context.signal.throwIfAborted();
    const artifact = await exportCommissioningReview({project,reviewId:expected.reviewId,format});
    const path = 'commissioning/' + name;
    const retained = await archive.add(path,artifact.bytes,{contentType:artifact.mime});
    exports.push({format,path,filename:artifact.filename,contentType:artifact.mime,
      bytes:retained.bytes,sha256:retained.sha256});
  }
  const manifest = {
    schema:WQX_COMMISSIONING_JOB_RESULT_SCHEMA,functionId:'waterQualityReview',mode:'commissioning',
    jobId:context.jobId,sourceSchema:WQX_COMMISSIONING_BUNDLE_SCHEMA,sourceFiles,
    request:Object.fromEntries(Object.entries(input).filter(([key])=>key!=='$files')),
    commissioning:expected,selection:'COMPLETE_SAVED_COMMISSIONING_EDITION',sourceRecomputed:true,exports,
  };
  await archive.add('README.md',Buffer.from(commissioningJobResultGuide(manifest)),
    {contentType:'text/markdown; charset=utf-8'});
  manifest.members = archive.members();
  await archive.add('manifest.json',Buffer.from(json(manifest)),{contentType:'application/json'});
  await archive.finish();
  return manifest;
}
