// MIT. Complete reporting handovers use the original native report, case importer and Application lifecycle.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, stat, open, link, unlink } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import {
  createGrantReportingPlan, refreshGrantReportingPlan, receiveGrantReportingPlan,
  inspectGrantReportingProfile, inspectGrantReportingSource, GRANT_REPORTING_HANDOFF_SCHEMA,
} from './reporting-plan.mjs';
import {
  inspectOperatingPlan, receiveOperatingPlan, compareOperatingPlan, renderOperatingPlanHTML,
  renderOperatingPlanMarkdown,
} from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

export const GRANT_REPORTING_MAX_BYTES = 128 * 1024 * 1024;
const MAX_CASE_BYTES = 32 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const need = (condition, message) => {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'GRANT_REPORTING_HANDOFF_INVALID' });
};
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const clone = value => JSON.parse(JSON.stringify(value));
function item(filename, mediaType, bytes) {
  return { filename, mediaType, bytes: bytes.length, sha256: digest(bytes), contentBase64: bytes.toString('base64') };
}
function originalBytes(value, filename, maximum) {
  need(value?.filename === filename && typeof value.contentBase64 === 'string' &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximum &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256),
  'Keep the complete original ' + filename + '.');
  need(value.contentBase64.length <= Math.ceil(maximum / 3) * 4, 'The retained source exceeds its complete native allowance.');
  const bytes = Buffer.from(value.contentBase64, 'base64');
  need(bytes.toString('base64') === value.contentBase64 && bytes.length === value.bytes && digest(bytes) === value.sha256,
    'The retained original bytes changed: ' + filename + '.');
  return bytes;
}
export function inspectGrantReportingHandoff(value) {
  need(value?.schema === GRANT_REPORTING_HANDOFF_SCHEMA && typeof value.id === 'string' &&
    typeof value.createdAt === 'string' && value.source && typeof value.source === 'object',
  'Choose a complete Grant reporting handover.');
  const profile = inspectGrantReportingProfile(value.profile), plan = inspectOperatingPlan(value.plan);
  need(value.id === plan.id, 'Keep the original reporting plan identity.');
  const reportBytes = originalBytes(value.report, 'report.json', 64 * 1024 * 1024);
  const report = inspectGrantReportingSource(JSON.parse(text(reportBytes)));
  const caseBytes = originalBytes(value.case, 'performance-handover.zip', MAX_CASE_BYTES);
  need(caseBytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Keep the original native performance ZIP.');
  const capture = plan.revisions.at(-1).steps.find(step => step.id === 'grant-reporting-capture');
  need(capture, 'Keep the reporting capture in the editable procedure.');
  let binding;
  try { binding = JSON.parse(capture.inputs); } catch { need(false, 'Keep the reporting capture source identity.'); }
  need(binding.reportSha256 === report.reportSha256 && binding.case?.id === report.case.id &&
    binding.case.version === report.case.version, 'The procedure and native period report select different source editions.');
  return { id: plan.id, createdAt: value.createdAt, profile, plan, report, reportBytes, caseBytes, source: clone(value.source) };
}

export function inspectGrantReportingArchive(packet, pythonExecutable = 'python3') {
  const original = inspectGrantReportingHandoff(packet);
  const output = execFileSync(pythonExecutable, ['-I', '-B', fileURLToPath(new URL('./reporting-archive.py', import.meta.url))],
    { input: json({ report: original.report, archiveBase64: packet.case.contentBase64 }),
      encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return JSON.parse(output);
}

/** Only native reads and an exact-version export; the original client owns service lifetime. */
export async function captureGrantReporting({ client, catalog, profile: settings, caseId, startDate, endDate,
  plan: previous, id = previous?.id ?? randomUUID(), savedAt = new Date().toISOString() }) {
  const profile = inspectGrantReportingProfile(settings);
  need(client && typeof client.read === 'function' && typeof client.download === 'function',
    'Use the original GrantWorkspaceClient.');
  need(typeof endDate === 'string' && endDate, 'Select an explicit reporting end date.');
  const response = await client.read('performance', { caseId, ...(startDate ? { startDate } : {}), endDate });
  const report = inspectGrantReportingSource(response.value);
  need(report.case.id === caseId && report.selection.endDate === endDate &&
    (report.selection.startDate ?? null) === (startDate || null), 'The native report returned a different case or period.');
  const exported = await client.download('performance', { caseId: report.case.id,
    ...(report.selection.startDate ? { startDate: report.selection.startDate } : {}),
    endDate: report.selection.endDate, expectedVersion: report.case.version, expectedReportSha256: report.reportSha256 });
  need(Buffer.isBuffer(response.bytes) && digest(response.bytes) === response.sha256 &&
    Buffer.isBuffer(exported.bytes) && digest(exported.bytes) === exported.sha256 &&
    exported.bytes.length <= MAX_CASE_BYTES, 'Keep the complete original native response bytes.');
  const plan = previous ? refreshGrantReportingPlan({ plan: previous, report, catalog, profile, savedAt }) :
    createGrantReportingPlan({ id, report, catalog, profile, savedAt });
  const packet = { schema: GRANT_REPORTING_HANDOFF_SCHEMA, id: plan.id, createdAt: savedAt,
    profile, source: { report: response.source, archive: exported.source, catalog: catalog.package },
    report: item('report.json', 'application/json', response.bytes),
    case: item('performance-handover.zip', exported.mediaType, exported.bytes), plan };
  inspectGrantReportingHandoff(packet);
  need(Buffer.byteLength(json(packet)) <= GRANT_REPORTING_MAX_BYTES, 'The complete reporting handover exceeds 128 MiB.');
  return packet;
}
export function packGrantReportingPlan(packet, incoming) {
  const original = inspectGrantReportingHandoff(packet), plan = inspectOperatingPlan(incoming);
  const result = receiveOperatingPlan(plan, original.plan);
  need(result.plan.revisions.length === plan.revisions.length, 'Use the current complete saved procedure.');
  const next = { ...clone(packet), plan: result.plan };
  inspectGrantReportingHandoff(next);
  return next;
}
export async function readGrantReportingJSON(filename) {
  const target = resolve(filename), info = await stat(target);
  need(info.isFile() && info.size <= GRANT_REPORTING_MAX_BYTES, 'Use a complete regular JSON file up to 128 MiB.');
  const bytes = await readFile(target);
  need(bytes.length <= GRANT_REPORTING_MAX_BYTES, 'The complete JSON file exceeds 128 MiB.');
  return JSON.parse(text(bytes));
}
/** Same-byte receiving can continue interrupted file publication; different files remain untouched. */
async function publish(filename, bytes) {
  const target = resolve(filename);
  const compare = async () => {
    const existing = await readFile(target);
    need(existing.equals(bytes), 'The existing receiving file belongs to different content: ' + target);
    return { filename: basename(target), bytes: bytes.length, sha256: digest(bytes) };
  };
  try { return await compare(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(target), '.' + basename(target) + '.' + randomUUID() + '.tmp');
  let file;
  try {
    file = await open(temporary, 'wx', 0o600); await file.writeFile(bytes); await file.sync();
    await file.close(); file = undefined;
    try { await link(temporary, target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await compare(); }
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { filename: basename(target), bytes: bytes.length, sha256: digest(bytes) };
}
export async function saveGrantReportingJSON(filename, value) {
  return publish(filename, Buffer.from(json(value)));
}
export async function unpackGrantReporting(packet, directory, { pythonExecutable = 'python3' } = {}) {
  const original = inspectGrantReportingHandoff(packet), target = resolve(directory);
  inspectGrantReportingArchive(packet, pythonExecutable);
  await mkdir(target, { recursive: true, mode: 0o700 });
  // Bind the complete original before producing human-readable companion files.
  const binding = await saveGrantReportingJSON(join(target, 'grant-reporting.json'), packet);
  const files = [binding];
  const entries = [
    ['report.json', original.reportBytes],
    ['performance-handover.zip', original.caseBytes],
    ['operating-plan.json', Buffer.from(json(original.plan))],
    ['operating-plan.html', Buffer.from(renderOperatingPlanHTML(original.plan))],
    ['operating-plan.md', Buffer.from(renderOperatingPlanMarkdown(original.plan))],
    ['reporting-profile.json', Buffer.from(json(original.profile))],
    ['START_HERE.txt', Buffer.from(
      'Grant reporting handover\n\nOpen operating-plan.html for the complete procedure and recorded findings.\n' +
      'Import operating-plan.json in Command finder > Operating plans at your usual browser address.\n' +
      'performance-handover.zip is the original complete Budget performance report and operating case.\n' +
      'Use grant-reporting receive to receive that native case and save its original Grant Application.\n' +
      'Use grant-reporting pack after procedure-only edits. Capture a new native reporting edition after case changes.\n' +
      'All original report rows, native archive bytes and saved procedure revisions travel in grant-reporting.json.\n')],
  ];
  for (const [name, bytes] of entries) files.push(await publish(join(target, name), bytes));
  const manifest = { schema: 'stellar-forge.grant-reporting-files.v1', planId: original.id,
    planRevision: original.plan.revisions.length, case: original.report.case, selection: original.report.selection,
    reportSha256: original.report.reportSha256, files };
  await saveGrantReportingJSON(join(target, 'REPORTING_FILES.json'), manifest);
  return { directory: target, ...manifest };
}
/** Keep the first completed catalog observation when only the read time changed on resume. */
async function publishCatalogComparison(filename, comparison) {
  const normalize = value => {
    const selected = clone(value);
    delete selected.capturedAt;
    for (const step of selected.steps ?? []) if (step.current) delete step.current.capturedAt;
    const ordered = item => Array.isArray(item) ? item.map(ordered) :
      item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
    return JSON.stringify(ordered(selected));
  };
  try {
    const previous = await readGrantReportingJSON(filename);
    need(normalize(previous) === normalize(comparison),
      'The receiving toolkit changed. Keep the completed comparison and review the current catalog in Operating plans.');
    return previous;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await saveGrantReportingJSON(filename, comparison);
  return comparison;
}

/** Complete native case/Application receiving remains in the existing handoff operation. */
export async function receiveGrantReporting({ model, packet, catalog, bindings, profile: settings, operation, directory }) {
  const { prepareGrantHandoff, receiveGrantHandoff, saveGrantHandoffApplication } = await import('./handoff.mjs');
  const original = inspectGrantReportingHandoff(packet), profile = inspectGrantReportingProfile(settings);
  need(bindings?.settings?.workspaceDirectory === profile.workspaceDirectory &&
    (bindings.settings.pythonExecutable ?? '/usr/bin/python3') === profile.pythonExecutable,
  'The reporting profile and original Application bindings must select the same receiver.');
  const output = resolve(directory), files = await unpackGrantReporting(packet, output, { pythonExecutable: profile.pythonExecutable });
  // These complete input files retain the caller's exact selection before any native receiving.
  await saveGrantReportingJSON(join(output, 'receiver-reporting-profile.json'), profile);
  await saveGrantReportingJSON(join(output, 'receiver-application-bindings.json'), bindings);
  let receipt = await prepareGrantHandoff(model, { operation, caseArchive: join(output, 'performance-handover.zip'),
    bindingsValue: bindings, name: bindings.caseName });
  if (receipt.phase !== 'APPLICATION_SAVED') receipt = await receiveGrantHandoff(model, { operation });
  need(receipt.originalCase?.id === original.report.case.id && receipt.originalCase?.planId === original.report.plan.id &&
    receipt.originalCase?.mode === original.report.case.mode, 'The native received case selects different reporting source.');
  if (receipt.phase !== 'APPLICATION_SAVED') receipt = await saveGrantHandoffApplication(model, { operation });
  const received = receiveGrantReportingPlan({ plan: original.plan, profile: original.profile,
    destination: profile, receipt, savedAt: receipt.updatedAt });
  const comparison = await publishCatalogComparison(join(output, 'receiving-catalog-comparison.json'),
    compareOperatingPlan(received, catalog));
  await saveGrantReportingJSON(join(output, 'received-application.json'), receipt);
  await saveGrantReportingJSON(join(output, 'received-operating-plan.json'), received);
  await publish(join(output, 'received-operating-plan.html'), Buffer.from(renderOperatingPlanHTML(received)));
  return { directory: output, operation: resolve(operation), phase: receipt.phase,
    planId: received.id, planRevision: received.revisions.length, case: receipt.imported.result,
    application: receipt.application, catalogComparison: comparison.counts, files };
}
