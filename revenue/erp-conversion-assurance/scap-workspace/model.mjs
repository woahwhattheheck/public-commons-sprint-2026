// MIT. One operator projection over the original retained reconciliation service.
import { mkdtemp, writeFile, rm, open, stat } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { WORKSPACE_SCHEMA, validateProfile, inspectCsvHeader, compileDraft, draftFromSpec,
  reviewNote, parseReviewNote, WorkspaceError, fail } from './mapping.mjs';

const SHA = /^[a-f0-9]{64}$/;
const JOB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const MAX_SPEC_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_REPORT_CACHE_BYTES = 32 * 1024 * 1024;
const clone = value => structuredClone(value);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const checkId = id => { if (typeof id !== 'string' || !JOB.test(id)) fail('INVALID_JOB_ID', 'Use a job ID containing letters, digits, dots, underscores or hyphens, starting with a letter or digit.'); return id; };
const pageNumber = (value, fallback, maximum) => {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 0 || n > maximum) fail('INVALID_PAGE', 'The requested page is outside the supported range.');
  return n;
};

export function createConversionWorkspace({ service, profile: inputProfile, extension = null }) {
  const profile = validateProfile(inputProfile);
  for (const method of ['stageBundle', 'getBundle', 'listBundles', 'reviseBundle', 'execute', 'getJob',
    'listJobs', 'readReportChunk', 'review', 'getReviews', 'cancel', 'recover', 'exportReplay'])
    if (typeof service?.[method] !== 'function') fail('SERVICE_API_UNAVAILABLE', `The retained reconciliation service needs ${method}.`, 503);
  const configuration = service.configuration;
  const decorateDraft = (spec, draft) => extension?.decorateDraft
    ? extension.decorateDraft({ spec: clone(spec), draft }) : draft;
  const bundles = new Map(), reports = new Map();
  let reportCacheBytes = 0;

  async function getBundle(bundleId, { refresh = false } = {}) {
    if (typeof bundleId !== 'string' || !SHA.test(bundleId)) fail('INVALID_BUNDLE_ID', 'Choose a retained bundle.');
    if (!refresh && bundles.has(bundleId)) return clone(bundles.get(bundleId));
    const result = await service.getBundle(bundleId);
    if (result.bundle?.bundleId !== bundleId || !result.spec || result.spec.version !== 1)
      fail('BUNDLE_INVALID', 'The retained bundle did not return its original mapping.', 409);
    bundles.delete(bundleId); bundles.set(bundleId, clone(result));
    while (bundles.size > 64) bundles.delete(bundles.keys().next().value);
    return clone(result);
  }

  function workspaceSummary(spec) {
    const value = spec.workspace;
    return { dataset: spec.dataset, ...(value?.schema === WORKSPACE_SCHEMA ? {
      profileId: value.profile?.id, cohortId: value.cohortId,
      cohort: value.profile?.cohorts?.find(v => v.id === value.cohortId)?.title ?? value.cohortId,
      revision: value.revision, conversionOwner: value.scope?.conversionOwner, previous: value.previous,
    } : {}) };
  }

  async function listJobs({ limit = 25, after = '' } = {}) {
    const result = await service.listJobs({ limit: pageNumber(limit, 25, 100), after });
    const jobs = await Promise.all(result.jobs.map(async job => {
      try {
        const { spec } = await getBundle(job.bundleId);
        return { ...job, workspace: workspaceSummary(spec) };
      } catch (error) {
        return { ...job, mappingError: { code: error.code ?? 'MAPPING_UNAVAILABLE' } };
      }
    }));
    return { jobs, nextCursor: result.nextCursor };
  }

  async function listBundles({ limit = 25, after = '' } = {}) {
    const result = await service.listBundles({ limit: pageNumber(limit, 25, 100), after });
    return { ...result, bundles: result.bundles.map(bundle => ({ ...bundle,
      ...(bundles.has(bundle.bundleId) ? { workspace: workspaceSummary(bundles.get(bundle.bundleId).spec) } : {}) })) };
  }

  async function openBundle(bundleId) {
    const { bundle, spec } = await getBundle(bundleId, { refresh: true });
    return { bundle, spec, draft: decorateDraft(spec, draftFromSpec(spec, profile)) };
  }

  async function stage({ draft, baseBundleId, previousJobId, source, target } = {}) {
    let base = null, selectedProfile = profile;
    if (baseBundleId) {
      base = await getBundle(baseBundleId, { refresh: true });
      if (base.spec.workspace?.schema === WORKSPACE_SCHEMA) selectedProfile = validateProfile(base.spec.workspace.profile);
    }
    if (previousJobId) {
      const previous = await service.getJob(checkId(previousJobId));
      if (!base || previous.bundleId !== baseBundleId) fail('PREVIOUS_JOB_CONFLICT', 'The correction must retain the selected job’s original bundle.', 409);
    }
    const uploads = { source, target }, headers = {}, inputs = {}, bytes = {};
    for (const side of ['source', 'target']) {
      const upload = uploads[side];
      if (upload) {
        if (typeof upload.name !== 'string' || !upload.name.trim() || upload.name.length > 255 || !(upload.bytes instanceof Uint8Array))
          fail('INPUT_INVALID', `Choose a ${side} CSV export.`);
        if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > configuration.maxInputBytes)
          fail('INPUT_LIMIT_EXCEEDED', `The ${side} export exceeds this service’s ${configuration.maxInputBytes}-byte limit.`);
        bytes[side] = Buffer.from(upload.bytes);
        headers[side] = inspectCsvHeader(bytes[side].subarray(0, MAX_HEADER_BYTES), { complete: bytes[side].length <= MAX_HEADER_BYTES });
        inputs[side] = { name: upload.name };
      } else {
        if (!base) fail('INPUT_REQUIRED', `Choose a ${side} CSV export.`);
        const saved = base.spec.workspace?.schema === WORKSPACE_SCHEMA ? base.spec.workspace : null;
        headers[side] = saved?.headers?.[side] ?? [...new Set(Object.values(base.spec[`${side}_columns`] ?? {}))];
        inputs[side] = saved?.inputs?.[side] ?? { name: `Retained ${side} export` };
      }
    }
    const previous = base ? { bundleId: baseBundleId, ...(previousJobId ? { jobId: previousJobId } : {}),
      revision: base.spec.workspace?.schema === WORKSPACE_SCHEMA ? base.spec.workspace.revision : 0 } : null;
    let spec = compileDraft(draft, { profile: selectedProfile, headers, inputs, previous });
    if (extension?.compileSpec) spec = await extension.compileSpec({ spec, draft, base, service });
    const specBytes = json(spec);
    if (specBytes.length > MAX_SPEC_BYTES) fail('MAPPING_LIMIT_EXCEEDED', 'The complete mapping, crosswalk and scope must fit within the retained service’s 256 KiB mapping limit.');
    const temporary = await mkdtemp(join(tmpdir(), 'erp-workspace-intake-'));
    try {
      const paths = {};
      for (const side of ['source', 'target']) if (bytes[side]) {
        paths[side] = join(temporary, `${side}.csv`);
        await writeFile(paths[side], bytes[side], { flag: 'wx', mode: 0o600 });
      }
      const specPath = join(temporary, 'spec.json');
      await writeFile(specPath, specBytes, { flag: 'wx', mode: 0o600 });
      const bundle = base
        ? await service.reviseBundle({ bundleId: baseBundleId, ...paths, spec: specPath })
        : await service.stageBundle({ ...paths, spec: specPath });
      const retained = await getBundle(bundle.bundleId, { refresh: true });
      if (retained.bundle.spec.sha256 !== digest(specBytes)) fail('MAPPING_CHANGED', 'The staged mapping does not match the reviewed bytes.', 409);
      return { ...retained, draft: decorateDraft(retained.spec, draftFromSpec(retained.spec, selectedProfile)) };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async function readReport(job) {
    const descriptor = job.result?.report;
    if (job.state !== 'COMPLETED' || !descriptor || !SHA.test(descriptor.sha256)) return null;
    const cacheKey = `${job.jobId}:${descriptor.sha256}`;
    if (reports.has(cacheKey)) {
      const value = reports.get(cacheKey); reports.delete(cacheKey); reports.set(cacheKey, value); return value.report;
    }
    if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > configuration.maxReportBytes)
      fail('REPORT_LIMIT_EXCEEDED', 'The retained report exceeds the configured limit.', 409);
    const parts = []; let offset = 0;
    while (offset < descriptor.bytes) {
      const part = await service.readReportChunk({ jobId: job.jobId, reportSha256: descriptor.sha256, offset, length: 8192 });
      const decoded = Buffer.from(part.data ?? '', 'base64');
      if (part.jobId !== job.jobId || part.reportSha256 !== descriptor.sha256 || part.offset !== offset ||
        part.totalBytes !== descriptor.bytes || part.encoding !== 'base64' || part.bytes !== decoded.length ||
        part.bytes < 1 || part.bytes > 8192 || part.nextOffset !== offset + part.bytes || part.nextOffset > descriptor.bytes ||
        part.done !== (part.nextOffset === descriptor.bytes) || decoded.toString('base64') !== part.data)
        fail('REPORT_CHANGED', 'The report transfer did not match its retained identity.', 409);
      parts.push(decoded); offset = part.nextOffset;
    }
    const reportBytes = Buffer.concat(parts);
    if (digest(reportBytes) !== descriptor.sha256) fail('REPORT_CHANGED', 'The complete report digest changed.', 409);
    let report;
    try { report = JSON.parse(reportBytes); } catch { fail('REPORT_INVALID', 'The retained report is not valid JSON.', 409); }
    if (report.schema !== 'ERP-CONVERSION-RECON-V1' || !Array.isArray(report.discrepancies) || !Array.isArray(report.group_discrepancies))
      fail('REPORT_INVALID', 'The retained report has an unsupported schema.', 409);
    if (reportBytes.length <= MAX_REPORT_CACHE_BYTES) {
      reports.set(cacheKey, { report, bytes: reportBytes.length }); reportCacheBytes += reportBytes.length;
      while (reports.size > 4 || reportCacheBytes > MAX_REPORT_CACHE_BYTES) {
        const oldest = reports.keys().next().value; reportCacheBytes -= reports.get(oldest).bytes; reports.delete(oldest);
      }
    }
    return report;
  }

  async function getJob(jobId, { kind = 'records', offset = 0, limit = 50, filter = '' } = {}) {
    checkId(jobId);
    if (!['records', 'groups'].includes(kind) || typeof filter !== 'string' || filter.length > 80) fail('INVALID_PAGE', 'Choose a record or group discrepancy page.');
    offset = pageNumber(offset, 0, Number.MAX_SAFE_INTEGER); limit = pageNumber(limit, 50, 200);
    if (limit < 1) fail('INVALID_PAGE', 'Page size must be positive.');
    const job = await service.getJob(jobId), { bundle, spec } = await getBundle(job.bundleId);
    const reviews = (await service.getReviews(jobId)).map(review => ({ ...review, workspace: parseReviewNote(review.note) }));
    const report = await readReport(job);
    let comparison = null;
    if (report) {
      const all = kind === 'groups' ? report.group_discrepancies : report.discrepancies;
      const selected = filter && kind === 'records' ? all.filter(row => row.kind === filter || row.reason === filter) : all;
      comparison = { status: report.status, totals: report.totals, counts: report.counts,
        ...(report.key_mapping ? { key_mapping: report.key_mapping } : {}),
        kinds: [...new Set(report.discrepancies.map(row => row.kind ?? row.reason))],
        page: { kind, filter, offset, limit, total: selected.length, nextOffset: offset + limit < selected.length ? offset + limit : null,
          rows: selected.slice(offset, offset + limit) } };
    }
    return { job, bundle, spec, workspace: workspaceSummary(spec), reviews, comparison };
  }

  async function review({ jobId, reportSha256, reviewer, decision, comment, observations } = {}) {
    const job = await service.getJob(checkId(jobId));
    if (job.state !== 'COMPLETED' || job.result?.report?.sha256 !== reportSha256)
      fail('REVIEW_REPORT_CONFLICT', 'Reopen the completed report before recording this review.', 409);
    const { spec } = await getBundle(job.bundleId);
    const selectedProfile = validateProfile(spec.workspace?.profile ?? profile);
    const note = reviewNote({ comment, observations }, selectedProfile);
    const result = await service.review({ jobId, reportSha256, reviewer, decision, note });
    return { ...result, workspace: parseReviewNote(result.note) };
  }

  async function createHandoff(jobId) {
    checkId(jobId);
    const temporary = await mkdtemp(join(tmpdir(), 'erp-workspace-handoff-'));
    let output;
    try {
      const folder = `reconciliation-${jobId}`;
      const exported = await service.exportReplay({ jobId, destination: join(temporary, folder) });
      const archive = join(temporary, `${folder}.tar.gz`);
      output = await open(archive, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      const child = spawn('tar', ['-czf', '-', '-C', temporary, folder], { stdio: ['ignore', output.fd, 'pipe'] });
      child.stderr.on('data', () => {});
      let timer;
      try {
        const result = await new Promise((yes, no) => {
          child.once('error', no); child.once('close', (code, signal) => yes({ code, signal }));
          timer = setTimeout(() => child.kill('SIGKILL'), 60000);
        });
        if (result.code !== 0) fail('HANDOFF_ARCHIVE_FAILED', 'The retained export could not be packaged. Try the original operator export command.', 500);
      } finally { clearTimeout(timer); await output.close(); output = null; }
      const size = (await stat(archive)).size;
      if (size > configuration.maxInputBytes * 2 + configuration.maxReportBytes + 4 * 1024 * 1024)
        fail('HANDOFF_LIMIT_EXCEEDED', 'The completed export exceeds the expected private artifact size.', 500);
      return { exported, bytes: size, filename: `${folder}.tar.gz`, stream: () => createReadStream(archive),
        close: () => rm(temporary, { recursive: true, force: true }) };
    } catch (error) {
      if (output) await output.close().catch(() => {});
      await rm(temporary, { recursive: true, force: true }); throw error;
    }
  }

  return Object.freeze({ profile: clone(profile), configuration: clone(configuration), stage, getBundle: openBundle,
    listBundles, listJobs, getJob, review, createHandoff,
    execute: ({ jobId, bundleId }) => service.execute({ jobId: checkId(jobId), bundleId }),
    cancel: jobId => service.cancel(checkId(jobId)), recover: jobId => service.recover(checkId(jobId)),
    close: () => { bundles.clear(); reports.clear(); reportCacheBytes = 0; } });
}
