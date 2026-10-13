// MIT. Directory procedures use the unchanged source-owned OperatingPlan model.
import {
  createOperatingPlan, createOperatingStep, snapshotRegistration,
  operatingPlanDraft, saveOperatingPlanRevision, inspectOperatingPlan,
} from '../../distribution/discovery/operating-plan.mjs';

export const DIRECTORY_OPERATING_BASIS = 'stellar-forge.directory-operating-basis.v1';
export const DIRECTORY_PLAN_RESULT = 'stellar-forge.directory-operating-preview.v1';
export const MAX_PLAN_BYTES = 32 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const need = (condition, message) => { if (!condition) throw new TypeError(message); };
const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const json = value => JSON.stringify(value, null, 2);
const path = value => {
  need(typeof value === 'string' && value.startsWith('/') && value.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/.test(value), 'Select an explicit absolute operating path.');
  return value === '/' ? value : value.replace(/\/+$/, '');
};

export function inspectDirectoryOperatingBasis(value) {
  need(plain(value) && value.schema === DIRECTORY_OPERATING_BASIS,
    'Receive the original Directory operating basis first.');
  need(typeof value.workspaceId === 'string' && value.workspaceId.length > 0,
    'The basis must retain its original workspace UUID.');
  path(value.workspace);
  need(typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)),
    'Keep the actual native basis observation time.');
  need(plain(value.selection) && id(value.selection.editionId),
    'Select the original retained Directory edition.');
  need(Array.isArray(value.recordRefs) && value.recordRefs.length <= 1000 &&
    value.recordRefs.every(r => plain(r) && typeof r.kind === 'string' && id(r.id) && id(r.sha256)),
  'Keep every exact retained native record identity and complete-body hash.');
  need(new Set(value.recordRefs.map(r => r.kind + '/' + r.id)).size === value.recordRefs.length,
    'The native basis repeats a selected record.');
  need(Array.isArray(value.observations) && value.observations.length <= 1000,
    'Keep the complete selected native observations.');
  for (const observation of value.observations) {
    need(plain(observation) && typeof observation.key === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(observation.key) &&
      typeof observation.title === 'string' && observation.title &&
      typeof observation.kind === 'string' && id(observation.id) &&
      value.recordRefs.some(r => r.kind === observation.kind && r.id === observation.id),
    'Each procedure observation must resolve to its exact original native record.');
    need(['planned', 'in-progress', 'completed', 'skipped'].includes(observation.status),
      'Keep the explicit native observation status.');
  }
  need(new Set(value.observations.map(r => r.key)).size === value.observations.length,
    'Every observation needs its own stable step identity.');
  need(Array.isArray(value.findings) && value.findings.every(f => typeof f === 'string'),
    'Keep the original unresolved receiving findings.');
  return copy(value);
}

function commandPrefix(registration) {
  const argv = registration.item.helpArgv;
  need(registration.item.id === 'command:human-services-directory' &&
    Array.isArray(argv) && argv.length >= 2 && argv.at(-1) === '--help' &&
    argv.every(v => typeof v === 'string'), 'Use the actual native Directory command registration.');
  return argv.slice(0, -1);
}

/**
 * Prepare an ordinary complete OperatingPlan. The optional second revision is
 * a current observation of retained records, not a replay of their operations.
 * Every future/provider/human action remains an explicitly planned step.
 */
export function createDirectoryOperatingPlan({ catalog, input, basis }) {
  const native = inspectDirectoryOperatingBasis(basis);
  need(plain(input) && typeof input.id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(input.id), 'Choose the original procedure ID.');
  for (const key of ['title', 'customer', 'owner', 'receiving', 'savedAt', 'outputDirectory']) {
    need(typeof input[key] === 'string' && input[key].trim(), 'Procedure ' + key + ' is required.');
  }
  need(plain(input.basis) && input.basis.editionId === native.selection.editionId,
    'The prepared input and original native basis select different editions.');
  const output = path(input.outputDirectory), workspace = path(native.workspace);
  const registration = snapshotRegistration(catalog, 'command:human-services-directory');
  const prefix = commandPrefix(registration);
  const observations = new Map(native.observations.map(o => [o.key, o]));
  const steps = native.observations.map(o => createOperatingStep({
    id: o.key, title: o.title, selection: registration, owner: input.owner,
    instruction: o.instruction || 'Read this complete retained native record and keep its original source identity.',
    inputs: json({ workspaceId: native.workspaceId, workspace,
      collection: o.kind, recordId: o.id,
      recordSha256: native.recordRefs.find(r => r.kind === o.kind && r.id === o.id).sha256,
      ...(o.files ? { originalFiles: o.files } : {}),
      ...(o.links ? { linkedOriginalRecords: o.links } : {}) }),
    expectedResult: o.expectedResult || 'The complete original record remains available with the same ID and source.',
    argv: [...prefix, 'records', '--workspace', workspace, '--kind', o.kind, '--id', o.id],
  }));
  steps.push(createOperatingStep({
    id: 'review-unresolved-findings', title: 'Review the remaining source and service decisions',
    owner: input.owner, instruction: 'Review each retained mapping, conformance and receiving finding with the assigned owner. Record an actual disposition before treating it as resolved. Source schedules and capacity describe their observed edition; they do not reserve a service.',
    inputs: native.findings.length ? native.findings.join('\n\n') : 'No unresolved finding was supplied by the selected native summaries. The receiving owner still reviews the selected scope.',
    expectedResult: 'Every actual unresolved issue has a recorded owner and disposition, or remains explicitly open.',
  }));
  if (native.selection.handoffId) steps.push(createOperatingStep({
    id: 'deliver-complete-handoff', title: 'Export and deliver the selected complete handoff',
    selection: registration, owner: input.owner,
    instruction: 'Export this exact frozen handoff, verify the complete file, and pass it to the receiving owner named in the procedure. Record the actual delivery receipt separately from local export.',
    inputs: json({ workspaceId: native.workspaceId, handoffId: native.selection.handoffId,
      destination: output + '/' + input.id + '-complete-handoff.zip', receiving: input.receiving }),
    expectedResult: 'The receiving owner has the complete exact handoff and its original source/decision files.',
    argv: [...prefix, 'file', '--workspace', workspace, '--kind', 'handoff',
      '--id', native.selection.handoffId, '--out', output + '/' + input.id + '-complete-handoff.zip'],
  }));
  steps.push(createOperatingStep({
    id: 'deliver-editable-workspace', title: 'Export and receive the complete editable workspace',
    selection: registration, owner: input.owner,
    instruction: 'Export the current complete Directory workspace, including this procedure and every original record/file. Receive it through the native receive-workspace command into a separate empty private destination, reopen it, and record the actual receiving outcome. Use a new output file for each complete export.',
    inputs: json({ originalWorkspaceId: native.workspaceId,
      output: output + '/' + input.id + '-editable-workspace.zip', receiving: input.receiving }),
    expectedResult: 'The complete editable workspace reopens with its original UUID, source/clinical records and full procedure history.',
    argv: [...prefix, 'file', '--workspace', workspace, '--kind', 'workspace',
      '--out', output + '/' + input.id + '-editable-workspace.zip'],
  }));
  for (const extra of input.continuations ?? []) {
    need(plain(extra) && typeof extra.id === 'string' && !steps.some(s => s.id === 'continuation-' + extra.id),
      'Each authored continuation has a distinct identity.');
    steps.push(createOperatingStep({
      id: 'continuation-' + extra.id, title: extra.title, owner: extra.owner ?? input.owner,
      instruction: extra.instruction, inputs: extra.inputs ?? '', expectedResult: extra.expectedResult ?? '',
      due: extra.due ?? '', argv: extra.argv ?? [], selection: null,
    }));
  }
  const notes = [
    input.notes || '',
    'Original Directory basis: ' + json({ schema: native.schema, workspaceId: native.workspaceId,
      observedAt: native.observedAt, selectedEditionId: native.selection.editionId,
      originalRecordCount: native.recordRefs.length, originalRecordRefsSha256: native.recordRefsSha256,
      completeRecordReferences: 'Each selected step retains its exact original ID and complete-body hash. The native prepared/saved record retains the complete basis file.' }),
    'Native record observations retain actual saved state. They do not assert that a current provider request, human review, service reservation, browser procedure or external delivery has been performed.',
  ].filter(Boolean).join('\n\n');
  let document = createOperatingPlan({
    id: input.id, title: input.title, customer: input.customer,
    purpose: input.purpose || 'Continue the selected Directory source, reviewed service and complete customer receiving workflow.',
    period: input.period || '', owner: input.owner, receiving: input.receiving,
    notes, steps, savedAt: input.savedAt,
  });
  if (input.recorded !== false) {
    const draft = operatingPlanDraft(document);
    for (const step of draft.content.steps) {
      const observation = observations.get(step.id);
      if (!observation) continue;
      step.status = observation.status;
      step.recordedResult = json({ observedAt: native.observedAt,
        retainedRecord: { collection: observation.kind, id: observation.id },
        originalState: observation.summary ?? null,
        ...(observation.recordedResult ? { interpretation: observation.recordedResult } : {}) });
    }
    document = saveOperatingPlanRevision(document, draft,
      { savedAt: new Date(native.observedAt).toISOString() });
  }
  return inspectOperatingPlan(document);
}
