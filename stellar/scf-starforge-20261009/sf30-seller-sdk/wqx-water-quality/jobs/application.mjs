// MIT. One paid scientific job joins the original WQX review and Open Waters receivers.
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openWaterQualityProject, operationId } from '../project.mjs';
import { normalizeAnalysisOptions } from '../analysis.mjs';
import { normalizeOpenWatersOptions, openWatersPlanSummary } from '../openwaters.mjs';
import { createScientificArchive } from './archive.mjs';

export const WQX_JOB_CHOICES_SCHEMA = 'starforge.wqx-job-choices.v1';
export const WQX_JOB_RESULT_SCHEMA = 'starforge.wqx-scientific-job-result.v1';
const SOURCE_LIMIT = 67108864, CHOICES_LIMIT = 2097152;
const BUNDLE = 'starforge.wqx-review-bundle.v1', OPEN_WATERS = 'starforge.wqx-open-waters-bundle.v1';
const HASH = /^[0-9a-f]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
function exact(value, keys, code) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code);
}
async function readJson(files, slot, maxBytes) {
  try {
    const bytes = await files.read(slot, { maxBytes });
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) fail('JOB_INPUT_JSON_INVALID');
    throw error;
  }
}
function choicesFor(value, original) {
  if (value === null) return null;
  exact(value, ['schema', 'sourceReviewSha256', 'sourcePlanSha256', 'analysisOptions', 'note', 'openWatersOptions'],
    'JOB_INPUT_WQX_CHOICES_INVALID');
  if (value.schema !== WQX_JOB_CHOICES_SCHEMA || !HASH.test(value.sourceReviewSha256 ?? '') ||
      value.sourceReviewSha256 !== original.reviewSha256) fail('JOB_INPUT_WQX_CHOICES_REVIEW_CHANGED');
  if (own(value, 'sourcePlanSha256') && (!HASH.test(value.sourcePlanSha256 ?? '') ||
      value.sourcePlanSha256 !== original.planSha256)) fail('JOB_INPUT_WQX_CHOICES_PLAN_CHANGED');
  if (own(value, 'note') && (typeof value.note !== 'string' || value.note.length > 24000))
    fail('JOB_INPUT_WQX_DECISION_NOTE_INVALID');
  try {
    if (own(value, 'analysisOptions')) {
      exact(value.analysisOptions, Object.keys(normalizeAnalysisOptions({})), 'JOB_INPUT_WQX_ANALYSIS_OPTION_INVALID');
      for (const name of ['window', 'baselineWindow']) {
        const window = value.analysisOptions[name];
        if (window !== undefined && window !== null) exact(window, ['start', 'end'], 'JOB_INPUT_WQX_ANALYSIS_WINDOW_INVALID');
      }
      normalizeAnalysisOptions(value.analysisOptions);
    }
    if (own(value, 'openWatersOptions')) normalizeOpenWatersOptions(value.openWatersOptions);
  } catch (error) {
    if (error.code?.startsWith('JOB_INPUT_')) throw error;
    fail('JOB_INPUT_WQX_CHOICES_INVALID');
  }
  return value;
}
function decision(review, plan) {
  return {
    schema: 'starforge.wqx-job-source-decision.v1',
    reviewId: review.reviewId, reviewSha256: review.reviewSha256, captureId: review.captureId,
    captureSha256: review.captureSha256, comparisonCaptureId: review.comparisonCaptureId,
    title: review.title, revision: review.revision, requestedOptions: review.requestedOptions,
    normalizedOptions: review.analysis.options, note: review.note,
    planId: plan?.planId ?? null, planSha256: plan?.planSha256 ?? null,
    openWatersOptions: plan?.options ?? null,
  };
}
function resultGuide(manifest) {
  const rows = [
    '# Water quality scientific delivery', '',
    'Open review/report.html for the complete scientific report, and manifest.json for the original inputs, decisions and exact file identities.',
    'The original sealed source and optional decision file are under original/. The resulting saved review is under review/.', '',
    '## Reopen the resulting review', '',
    'Use the existing Water quality application with an empty private project, then choose Receive and select review/complete-review.json.',
    'From the installed command line:', '',
    '    starforge water-quality receive --project /private/received-water --bundle /absolute/unpacked/review/complete-review.json',
    '    starforge water-quality serve --project /private/received-water --port 0', '',
    'The review retains the complete original capture, original request and project revisions. The JSON, HTML, CSV and GeoJSON exports use the same saved scientific choice.',
    'Source result strings, all limits, methods, units, qualifiers and times remain in the native graph and exports.',
    'Original and resulting decision identities are separate: original/decision.json and review/review.json.', '',
    'Job: ' + manifest.jobId,
    'Source capture: ' + manifest.sourceDecision.captureSha256,
    'Original review: ' + manifest.sourceDecision.reviewId + ' / ' + manifest.sourceDecision.reviewSha256,
    'Result review: ' + manifest.review.reviewId + ' / ' + manifest.review.reviewSha256, '',
  ];
  if (manifest.openWaters) rows.push(
    '## Open Waters receiving', '',
    'Open open-waters/receiving.html for the complete native field and reference choices. Its locations.tsv and results.tsv use the published importer aliases.',
    'Open Waters reference and method values are checked against the receiving installation as described in that report.',
    'The crosswalk preserves every selected source result and receiving decision, including results requiring further field choices.',
    'To reopen the complete receiving plan, choose the existing Open Waters Receive control or run:', '',
    '    starforge water-quality water-receive --project /private/received-open-waters --bundle /absolute/unpacked/open-waters/complete-open-waters.json', '',
    'Result plan: ' + manifest.openWaters.planId + ' / ' + manifest.openWaters.planSha256, '');
  rows.push('## Measurement interpretation', '',
    'The original analysis compares exact scientific groups and local sample dates. Arithmetic summaries retain exact decimal fractions.',
    'Censored observations retain their reported limits. Estimates and other qualifiers follow the saved analyst selection.',
    'The report shows absolute differences on the original measurement scale; relative changes follow the native ratio-scale rules.',
    'GeoJSON uses unambiguous provided WGS84 coordinates; other source datums remain in the original properties.', '');
  return rows.join('\n');
}

/**
 * Required file: source (complete native review or Open Waters bundle).
 * Optional file: choices (WQX_JOB_CHOICES_SCHEMA, bound to the original review).
 * Result: standard ZIP containing the exact inputs and complete native scientific outputs.
 */
export async function waterQualityReview(input, context) {
  exact(input, ['reviewId', 'planId', 'expectedCaptureSha256', 'expectedReviewSha256', '$files'], 'JOB_INPUT_WQX_REQUEST_INVALID');
  operationId(input.reviewId);
  if (input.planId !== undefined) operationId(input.planId);
  for (const name of ['expectedCaptureSha256', 'expectedReviewSha256'])
    if (input[name] !== undefined && !HASH.test(input[name])) fail('JOB_INPUT_WQX_EXPECTED_IDENTITY_INVALID');
  if (!context?.files || !context.signal || typeof context.jobId !== 'string') fail('JOB_INPUT_RECEIVER_REQUIRED');
  context.signal.throwIfAborted();
  const sourceFiles = context.files.list().sort((a, b) => a.slot.localeCompare(b.slot));
  if (!sourceFiles.some(file => file.slot === 'source') || sourceFiles.some(file => !['source', 'choices'].includes(file.slot)))
    fail('JOB_INPUT_WQX_FILE_SLOT_INVALID');
  const hasChoices = sourceFiles.some(file => file.slot === 'choices');
  const parent = resolve(process.env.WQX_JOB_TEMP_ROOT || tmpdir());
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(parent);
  const directory = await mkdtemp(join(canonicalParent, 'wqx-scientific-job-' + hash(context.jobId).slice(0,16) + '-'));
  const archivePath = join(directory, 'water-quality-review.zip');
  let archive, project;
  try {
    archive = await createScientificArchive(archivePath, { signal: context.signal });
    await archive.add('original/source-bundle.json', context.files.stream('source'), {
      contentType: 'application/json', expected: context.files.metadata('source'),
    });
    if (hasChoices) await archive.add('original/choices.json', context.files.stream('choices'), {
      contentType: 'application/json', expected: context.files.metadata('choices'),
    });
    let bundle = await readJson(context.files, 'source', SOURCE_LIMIT);
    if (!object(bundle) || ![BUNDLE, OPEN_WATERS].includes(bundle.schema)) fail('JOB_INPUT_WQX_BUNDLE_REQUIRED');
    const sourceSchema = bundle.schema;
    project = await openWaterQualityProject(join(directory, 'project'));
    let retainedReview, originalPlan = null;
    context.signal.throwIfAborted();
    if (sourceSchema === OPEN_WATERS) {
      originalPlan = await project.receiveOpenWaters({ bundle });
      retainedReview = await project.readReview(originalPlan.reviewId);
    } else {
      const received = await project.receiveReviewBundle({ bundle });
      retainedReview = received.review;
    }
    bundle = null;
    const original = decision(retainedReview, originalPlan);
    retainedReview = null; originalPlan = null;
    if (input.expectedCaptureSha256 && original.captureSha256 !== input.expectedCaptureSha256)
      fail('JOB_INPUT_WQX_CAPTURE_CHANGED');
    if (input.expectedReviewSha256 && original.reviewSha256 !== input.expectedReviewSha256)
      fail('JOB_INPUT_WQX_REVIEW_CHANGED');
    if (input.reviewId === original.reviewId) fail('JOB_INPUT_WQX_NEW_REVIEW_ID_REQUIRED');
    const choices = choicesFor(hasChoices ? await readJson(context.files, 'choices', CHOICES_LIMIT) : null, original);
    const requestedOptions = choices && own(choices, 'analysisOptions') ? choices.analysisOptions : original.requestedOptions;
    const note = choices && own(choices, 'note') ? choices.note : original.note;
    const receivingOptions = choices && own(choices, 'openWatersOptions') ? choices.openWatersOptions : original.openWatersOptions;
    if (input.planId && receivingOptions === null) fail('JOB_INPUT_WQX_OPEN_WATERS_CHOICES_REQUIRED');
    context.signal.throwIfAborted();
    let review = await project.saveReview({
      reviewId: input.reviewId, captureId: original.captureId,
      comparisonCaptureId: original.comparisonCaptureId ?? undefined,
      expectedCaptureSha256: original.captureSha256, options: requestedOptions, note,
    });
    const resultReview = {
      reviewId: review.reviewId, reviewSha256: review.reviewSha256,
      captureId: review.captureId, captureSha256: review.captureSha256,
      comparisonCaptureId: review.comparisonCaptureId, captureStatus: review.analysis.capture.status,
      requestedOptions: review.requestedOptions, normalizedOptions: review.analysis.options,
      note: review.note, inventory: review.analysis.inventory,
      baselineInventory: review.analysis.baseline?.inventory ?? null,
      captureComparison: review.comparison?.counts ?? null,
    };
    review = null;
    await archive.add('original/decision.json', Buffer.from(json(original)), { contentType: 'application/json' });
    const reviewNames = { json: 'review.json', html: 'report.html', csv: 'observations.csv', geojson: 'observations.geojson' };
    for (const [format, filename] of Object.entries(reviewNames)) {
      context.signal.throwIfAborted();
      const artifact = await project.exportReview({ reviewId: input.reviewId, format });
      await archive.add('review/' + filename, artifact.bytes, { contentType: artifact.mime });
    }
    {
      context.signal.throwIfAborted();
      const artifact = await project.exportReviewBundle({ reviewId: input.reviewId });
      await archive.add('review/complete-review.json', artifact.bytes, { contentType: artifact.mime });
    }
    let receiving = null;
    if (receivingOptions !== null) {
      const planId = input.planId ?? 'job-open-waters-' + hash(json([context.jobId, input.reviewId])).slice(0,24);
      if (planId === original.planId) fail('JOB_INPUT_WQX_NEW_PLAN_ID_REQUIRED');
      context.signal.throwIfAborted();
      let plan = await project.saveOpenWaters({
        planId, reviewId: input.reviewId, options: receivingOptions,
        expectedReviewSha256: resultReview.reviewSha256,
      });
      receiving = { ...openWatersPlanSummary(plan), options: plan.options, files: plan.files };
      plan = null;
      const files = {
        locations: 'locations.tsv', results: 'results.tsv', crosswalk: 'crosswalk.json',
        report: 'receiving.html', references: 'references.csv', bundle: 'complete-open-waters.json',
      };
      for (const [format, filename] of Object.entries(files)) {
        context.signal.throwIfAborted();
        const artifact = await project.exportOpenWaters({ planId, format });
        await archive.add('open-waters/' + filename, artifact.bytes, { contentType: artifact.mime });
      }
    }
    const manifest = {
      schema: WQX_JOB_RESULT_SCHEMA, jobId: context.jobId, functionId: 'waterQualityReview',
      sourceSchema, sourceFiles,
      request: Object.fromEntries(Object.entries(input).filter(([key]) => key !== '$files')),
      sourceDecision: original, review: resultReview, openWaters: receiving,
      decisionSelection: {
        scientificOptions: choices && own(choices, 'analysisOptions') ? 'EXPLICIT_REPLACEMENT' : 'ORIGINAL_REVIEW',
        note: choices && own(choices, 'note') ? 'EXPLICIT_REPLACEMENT' : 'ORIGINAL_REVIEW',
        openWatersOptions: choices && own(choices, 'openWatersOptions') ? 'EXPLICIT_REPLACEMENT' :
          original.openWatersOptions !== null ? 'ORIGINAL_PLAN' : 'NONE',
      },
    };
    await archive.add('README.md', Buffer.from(resultGuide(manifest)), { contentType: 'text/markdown; charset=utf-8' });
    manifest.members = archive.members();
    await archive.add('manifest.json', Buffer.from(json(manifest)), { contentType: 'application/json' });
    await archive.finish();
    await project.close(); project = null;
    context.signal.throwIfAborted();
    return await readFile(archivePath);
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason;
    if (typeof error.code === 'string' && error.code.startsWith('WQX_')) {
      const wrapped = new Error('JOB_INPUT_' + error.code, { cause: error });
      wrapped.code = wrapped.message; throw wrapped;
    }
    throw error;
  } finally {
    try { await archive?.close(); }
    finally { try { await project?.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
  }
}
