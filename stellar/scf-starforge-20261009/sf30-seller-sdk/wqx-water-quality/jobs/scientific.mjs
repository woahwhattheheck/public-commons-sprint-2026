// MIT. Paid delivery of one complete original reporting-unit scientific edition.
import { verifyStandardizedReview, receiveStandardizedReview, exportStandardizedReview,
  standardizedExportFiles, STANDARDIZED_BUNDLE_SCHEMA } from '../standardized-analysis/workflow.mjs';

export const WQX_PAIRED_JOB_RESULT_SCHEMA = 'starforge.wqx-paired-scientific-job-result.v1';
export const WQX_PAIRED_SOURCE_LIMIT = 128 * 1024 * 1024;
export const PAIRED_JOB_EXPORTS = Object.freeze({
  json: 'scientific-review.json',
  observations: 'paired-observations.csv',
  'observations-tsv': 'paired-observations.tsv',
  groups: 'paired-groups.csv',
  changes: 'edition-changes.csv',
  report: 'report.html',
  bundle: 'complete-scientific-review.json',
});
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = code => { throw Object.assign(new Error(code), { code }); };
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

export function pairedScientificIdentity(value) {
  const record = verifyStandardizedReview(value);
  return {
    reviewId: record.reviewId, reviewSha256: record.reviewSha256,
    analysisSha256: record.analysis.analysisSha256, decision: record.decision,
    title: record.title, note: record.note, options: record.request.options,
    inventory: record.analysis.inventory,
    previous: record.previous ? {
      reviewId: record.previous.reviewId, reviewSha256: record.previous.reviewSha256,
      analysisSha256: record.previous.analysis.analysisSha256,
      decision: record.previous.decision, options: record.previous.request.options,
      inventory: record.previous.analysis.inventory,
    } : null,
    comparisonSha256: record.comparison?.comparisonSha256 ?? null,
    comparisonCounts: record.comparison?.counts ?? null,
  };
}

export function selectPairedScientificJob(input, bundle) {
  if (bundle?.schema !== STANDARDIZED_BUNDLE_SCHEMA) fail('JOB_INPUT_WQX_SCIENTIFIC_BUNDLE_REQUIRED');
  const identity = pairedScientificIdentity(bundle.review);
  if (input.mode !== 'scientific' || input.planId !== undefined)
    fail('JOB_INPUT_WQX_SCIENTIFIC_MODE_REQUIRED');
  if (input.reviewId !== identity.reviewId) fail('JOB_INPUT_WQX_SCIENTIFIC_REVIEW_ID_CHANGED');
  if (input.expectedScientificReviewSha256 !== identity.reviewSha256)
    fail('JOB_INPUT_WQX_SCIENTIFIC_REVIEW_CHANGED');
  if (input.expectedCaptureSha256 && input.expectedCaptureSha256 !== identity.decision.captureSha256)
    fail('JOB_INPUT_WQX_CAPTURE_CHANGED');
  if (input.expectedReviewSha256 && input.expectedReviewSha256 !== identity.decision.sourceReviewSha256)
    fail('JOB_INPUT_WQX_REVIEW_CHANGED');
  const formats = standardizedExportFiles(identity.reviewId).map(file => file.format);
  if (!same(formats, Object.keys(PAIRED_JOB_EXPORTS))) fail('JOB_OUTPUT_WQX_SCIENTIFIC_FORMATS_CHANGED');
  return identity;
}

export function pairedJobResultGuide(manifest) {
  return [
    '# Complete paired scientific delivery', '',
    'Open scientific/report.html for the scientific report and manifest.json for exact source, selection and output identities.',
    'The service received the complete original bundle and independently recomputed each selected source edition through the native Water Quality receiver.', '',
    '## Selected study', '',
    'Job: ' + manifest.jobId,
    'Scientific review: ' + manifest.scientific.reviewId + ' / ' + manifest.scientific.reviewSha256,
    'Original capture: ' + manifest.scientific.decision.captureSha256,
    'Original receiving decision: ' + manifest.scientific.decision.reviewId + ' / ' + manifest.scientific.decision.reviewSha256,
    'Earlier edition: ' + (manifest.scientific.previous
      ? manifest.scientific.previous.reviewId + ' / ' + manifest.scientific.previous.reviewSha256 : 'None selected'), '',
    'The selected reporting windows, qualification policy, complete unit/limit choices and earlier edition travel with the saved source. Change those choices in the Water Quality workspace and save a new immutable edition before submitting another job.', '',
    '## Complete files', '',
    '| Path | Content |', '| --- | --- |',
    '| original/source-bundle.json | Exact sealed input, including both selected source graphs and the complete earlier review preimage. |',
    '| original/scientific-selection.json | Exact saved scientific request and original review/decision references. |',
    '| scientific/scientific-review.json | Complete saved scientific edition. |',
    '| scientific/paired-observations.csv | Original and reporting values, units, limits, qualification and scientific inclusion. |',
    '| scientific/paired-observations.tsv | The same complete observation table as TSV. |',
    '| scientific/paired-groups.csv | Exact original and reporting group summaries. |',
    '| scientific/edition-changes.csv | The selected cross-edition differences. |',
    '| scientific/report.html | Complete human-readable scientific report. |',
    '| scientific/complete-scientific-review.json | Native portable edition with its complete current and previous source graphs. |', '',
    '## Receive and reopen', '',
    'Use Scientific editions → Receive in an independent private Water Quality workspace. Select scientific/complete-scientific-review.json.',
    'The installed command line uses the same original receiver:', '',
    '    starforge water-quality scientific receive --project /private/received-water --bundle /absolute/unpacked/scientific/complete-scientific-review.json --out /private/received-water-response.json',
    '    starforge water-quality scientific read --project /private/received-water --review ' + manifest.scientific.reviewId, '',
    'Receive verifies the exact native source/decision graphs and recomputes both selected analyses before retaining the immutable edition. Reopening the same scientific review preserves its original identity.', '',
    '## Scientific interpretation', '',
    'Reporting-unit conversions are the reviewed exact concentration transformations in the input. Every reported limit is independent. Blank measurements, censored results, estimates, qualifiers, optical units and explicit Keep reasons retain their source context.',
    'Arithmetic uses the selected original scientific rules and complete method/site/sample groups. These comparisons describe the retained observations; original sample dates and qualification remain available for interpretation.', '',
  ].join('\n');
}

/** Append the original seven exports after the source-native receiver has reproduced the edition. */
export async function appendPairedScientificJob({ project, bundle, archive, context, input, sourceFiles } = {}) {
  const expected = selectPairedScientificJob(input, bundle);
  context.signal.throwIfAborted();
  let record = await receiveStandardizedReview({ project, bundle });
  bundle = null;
  context.signal.throwIfAborted();
  const scientific = pairedScientificIdentity(record);
  if (!same(scientific, expected)) fail('JOB_INPUT_WQX_SCIENTIFIC_RECOMPUTE_CHANGED');
  const selected = {
    schema: 'starforge.wqx-paired-job-selection.v1',
    reviewId: record.reviewId, reviewSha256: record.reviewSha256,
    requestSha256: record.requestSha256, request: record.request,
    decision: record.decision,
    previous: record.previous ? {
      reviewId: record.previous.reviewId, reviewSha256: record.previous.reviewSha256,
      requestSha256: record.previous.requestSha256, request: record.previous.request,
      decision: record.previous.decision,
    } : null,
  };
  record = null;
  await archive.add('original/scientific-selection.json', Buffer.from(json(selected)), { contentType: 'application/json' });
  const exports = [];
  for (const [format, name] of Object.entries(PAIRED_JOB_EXPORTS)) {
    context.signal.throwIfAborted();
    const artifact = await exportStandardizedReview({ project, reviewId: scientific.reviewId, format });
    const path = 'scientific/' + name;
    const retained = await archive.add(path, artifact.bytes, { contentType: artifact.mime });
    exports.push({ format, path, filename: artifact.filename, contentType: artifact.mime,
      bytes: retained.bytes, sha256: retained.sha256 });
  }
  const manifest = {
    schema: WQX_PAIRED_JOB_RESULT_SCHEMA, functionId: 'waterQualityReview', mode: 'scientific',
    jobId: context.jobId, sourceSchema: STANDARDIZED_BUNDLE_SCHEMA, sourceFiles,
    request: Object.fromEntries(Object.entries(input).filter(([key]) => key !== '$files')),
    scientific, selection: 'COMPLETE_SAVED_SCIENTIFIC_EDITION', sourceRecomputed: true, exports,
  };
  await archive.add('README.md', Buffer.from(pairedJobResultGuide(manifest)), { contentType: 'text/markdown; charset=utf-8' });
  manifest.members = archive.members();
  await archive.add('manifest.json', Buffer.from(json(manifest)), { contentType: 'application/json' });
  await archive.finish();
  return manifest;
}
