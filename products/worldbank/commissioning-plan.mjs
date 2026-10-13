// MIT. An ordinary Operating Plan for the existing World Bank customer workflow.
import {
  createOperatingPlan, createOperatingStep, snapshotRegistration,
  createOperatingFile, inspectOperatingFile,
} from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

export const WORLD_BANK_BRIEF_SCHEMA = 'stellar-forge.worldbank-commissioning-brief.v1';
export const COMMISSIONING_STEP_IDS = Object.freeze([
  'brief', 'runtime', 'source', 'source-review', 'handover', 'analysis',
  'report-review', 'programme', 'delivery', 'customer-receive', 'acceptance',
]);
const copy = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(ok, message) { if (!ok) throw new TypeError(message); }
function fields(value, keys, name) {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)), name + ' has unsupported fields.');
}
function text(value, name, limit = 32000) {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), name + ' must be nonempty text without control characters.');
  return value;
}
function list(value, name) {
  need(Array.isArray(value) && value.length > 0 && value.length <= 1000, name + ' must be a nonempty list.');
  value.forEach(item => text(item, name + ' item', 300));
  need(new Set(value).size === value.length, name + ' contains duplicate selections.');
}
export function inspectWorldBankCommissioningBrief(value) {
  fields(value, ['schema','id','createdAt','title','customer','purpose','period','owner','receiving',
    'operationId','prefix','python','paths','scope','assignments','attachments'], 'Commissioning brief');
  need(value.schema === WORLD_BANK_BRIEF_SCHEMA, 'Choose a World Bank commissioning brief.');
  for (const name of ['title','customer','purpose','period','owner','receiving','python']) text(value[name], name);
  need(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.id ?? ''), 'Supply the original plan ID.');
  need(typeof value.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString().slice(0,19) === value.createdAt.slice(0,19),
    'createdAt must retain the original UTC creation time.');
  need(/^[0-9a-f]{32}$/.test(value.operationId ?? ''), 'operationId must be the original 32 lower-case hexadecimal Analysis operation ID.');
  need(/^[A-Za-z][A-Za-z0-9_]{0,20}$/.test(value.prefix ?? ''), 'prefix must begin with a letter and contain up to 21 letters, digits or underscores.');
  fields(value.paths, ['sourceWorkspace','analysisWorkspace','handover','customerWorkspace'], 'Paths');
  for (const name of ['sourceWorkspace','analysisWorkspace','handover','customerWorkspace']) {
    text(value.paths[name], name, 4096);
    need(value.paths[name].startsWith('/') && !value.paths[name].split('/').some(part => part === '..' || part === '.'),
      name + ' must be an absolute Linux path without dot segments.');
  }
  need(new Set(Object.values(value.paths)).size === 4, 'Use separate source, Analysis, handover and customer destinations.');
  fields(value.scope, ['source','countries','indicators','periods','rights','missingValues','review',
    'calculations','workbook','acceptance','care','recurrence'], 'Scope');
  for (const name of ['source','rights','missingValues','review','calculations','workbook','acceptance','care','recurrence'])
    text(value.scope[name], 'scope.' + name);
  for (const name of ['countries','indicators','periods']) list(value.scope[name], 'scope.' + name);
  const assignments = value.assignments ?? {};
  fields(assignments, COMMISSIONING_STEP_IDS, 'Assignments');
  for (const [id, assignment] of Object.entries(assignments)) {
    fields(assignment, ['owner','due'], id + ' assignment');
    if (assignment.owner !== undefined) text(assignment.owner, id + ' owner', 300);
    if (assignment.due !== undefined) {
      need(typeof assignment.due === 'string' && (assignment.due === '' ||
        /^\d{4}-\d{2}-\d{2}$/.test(assignment.due) &&
        Number.isFinite(Date.parse(assignment.due + 'T00:00:00Z')) &&
        new Date(assignment.due + 'T00:00:00Z').toISOString().slice(0,10) === assignment.due),
        id + ' due must be an empty value or real YYYY-MM-DD date.');
    }
  }
  const attachments = value.attachments ?? [];
  need(Array.isArray(attachments) && attachments.length <= 100, 'Select at most 100 complete supporting files.');
  const ids = new Set(['commissioning-brief']);
  for (const file of attachments) {
    fields(file, ['id','step','path','name','mediaType','note'], 'Attachment');
    need(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(file.id ?? '') && !ids.has(file.id), 'Each attachment needs its own ID.');
    ids.add(file.id);
    need(COMMISSIONING_STEP_IDS.includes(file.step), 'Select an existing commissioning step for each attachment.');
    text(file.path, 'Attachment path', 4096);
    need(file.path.startsWith('/'), 'Attachment paths must be absolute.');
    text(file.name, 'Attachment name', 255); text(file.mediaType, 'Attachment media type', 255);
    need(typeof file.note === 'string' && file.note.length <= 32000 && !file.note.includes('\u0000'), 'Attachment note must be text.');
  }
  return copy(value);
}
const utf8 = value => new TextEncoder().encode(value);
const same = (a,b) => {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};

/** Prepare, never execute, the original workflow. Catalog snapshots remain exact. */
export function createWorldBankCommissioningPlan({ brief, catalog, briefBytes, files = [] }) {
  const selected = inspectWorldBankCommissioningBrief(brief);
  need(briefBytes instanceof Uint8Array, 'Retain the original UTF-8 brief bytes.');
  const receivedBrief = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(briefBytes));
  need(same(receivedBrief, selected), 'The original brief bytes differ from the selected commissioning brief.');
  const registrations = {
    product: snapshotRegistration(catalog, 'command:worldbank-product'),
    plans: snapshotRegistration(catalog, 'command:discover'),
  };
  need(Array.isArray(files) && files.length === (selected.attachments ?? []).length,
    'Receive every selected supporting file before creating the plan.');
  const selectedFiles = new Map();
  for (const item of files) {
    fields(item, ['step','file'], 'Received attachment');
    const file = inspectOperatingFile(item.file);
    const request = selected.attachments?.find(candidate => candidate.id === file.id);
    need(request && request.step === item.step && request.name === file.name &&
      request.mediaType === file.mediaType && request.note === file.note && !selectedFiles.has(file.id),
      'A received supporting file does not match its exact selected descriptor.');
    selectedFiles.set(file.id, { step: item.step, file });
  }
  const p = selected.paths, scope = selected.scope;
  const product = ['starforge','worldbank-product'];
  const analysis = [...product,'analysis','--python',selected.python];
  const step = (id,title,instruction,inputs,expectedResult,argv = [],registration = null) =>
    createOperatingStep({
      id, title, instruction, inputs, expectedResult, argv,
      selection: registration ? registrations[registration] : null,
      owner: selected.assignments?.[id]?.owner ?? selected.owner,
      due: selected.assignments?.[id]?.due ?? '',
      files: [...selectedFiles.values()].filter(item => item.step === id).map(item => item.file),
    });
  const steps = [
    step('brief','Accept the customer brief',
      'Review the carried complete brief with the customer. Record the source population, intended use, rights, exception policy, calculations and receiving responsibilities. Save the accepted decisions in this plan before acquisition.',
      'Customer: ' + selected.customer + '\nPurpose: ' + selected.purpose + '\nRights: ' + scope.rights,
      'The customer and operating owner have accepted the selected scope and receiving criteria.'),
    step('runtime','Select and open the installed toolkit',
      'Use the selected World Bank installation and its original runtime inspection. Keep its installation/source manifest with the delivery. Verify the selected Python has the workbooks extra before Analysis. Review the retained command registration against the current toolkit in Operating plans.',
      'Python executable: ' + selected.python + '\nThe retained catalog identifies the selected package and owning source registrations.',
      'The operator records the actual installation, source selection and dependency result. No runtime is installed by this procedure.',
      [...product,'--help'],'product'),
    step('source','Acquire the agreed source edition',
      'Open the original source workspace. Select the agreed source, countries, indicators and periods in its existing editor. Capture all original pages once and retain failures or continuation in that same operation. Reopen the original capture after interruption.',
      'Source: ' + scope.source + '\nCountries: ' + scope.countries.join(', ') +
        '\nIndicators: ' + scope.indicators.join(', ') + '\nPeriods: ' + scope.periods.join(', ') +
        '\nSource workspace: ' + p.sourceWorkspace,
      'A complete original capture with actual URL, source metadata, response pages and capture identity is retained.',
      [...product,'workspace','--directory',p.sourceWorkspace,'--python',selected.python],'product'),
    step('source-review','Review observations and exceptions',
      'Use the source workspace to inspect coverage and compare any original baseline. Save explicit exclusions and review reasons against that capture; preserve all original rows and metadata.',
      'Missing-value policy: ' + scope.missingValues + '\nReview: ' + scope.review,
      'An accepted review identifies its exact capture and revision; missing observations remain distinct from numeric zero.'),
    step('handover','Export the accepted source handover',
      'Export the accepted original review using the source workspace. Save its complete handover ZIP at the planned handover path and retain the export ID, review revision, byte count and digest. Attach a small complete manifest to this step if useful; keep large originals in their normal delivery.',
      'Planned handover path: ' + p.handover + '\nThis path is a future output until the actual export is recorded.',
      'The complete original handover is available for the Analysis importer with its unmodified source closure.'),
    step('analysis','Prepare the original Analysis workspace',
      'Run this original importer only after the accepted handover exists. Continue with the same workspace, prefix and operation ID on interruption. The original importer verifies the handover before creating its typed source and reference analysis.',
      'Original operation: ' + selected.operationId + '\nPrefix: ' + selected.prefix +
        '\nAnalysis workspace: ' + p.analysisWorkspace + '\nAccepted handover: ' + p.handover,
      'The original source document, reviewed table, saved queries, report and workbook reopen in Analysis.',
      [...analysis,'prepare','--handover',p.handover,'--workspace',p.analysisWorkspace,
        '--operation-id',selected.operationId,'--prefix',selected.prefix,'--resume'],'product'),
    step('report-review','Approve customer calculations and presentation',
      'Open Analysis and edit the saved queries, report sections, labels and workbook columns for this customer. Review units, rounding and nulls. Run and publish the accepted original definitions; keep their revisions and source bindings.',
      'Calculations: ' + scope.calculations + '\nWorkbook: ' + scope.workbook,
      'The reviewed report and workbook use the customer-approved definitions with original raw values retained.',
      [...analysis,'serve','--workspace',p.analysisWorkspace],'product'),
    step('programme','Record the following-edition procedure',
      'If recurring delivery is agreed, save a named programme in the existing World Bank programme editor using the accepted view, report, workbook and native row keys. Receive a later actual handover through the documented intake, review changes, then publish that same accepted edition. Preserve later customer edits and the original period history. Otherwise record why this step is not required.',
      'Recurrence: ' + scope.recurrence + '\nCare and change owner: ' + scope.care,
      'An agreed recurrence has a named programme and explicit operator; this plan schedules no provider call or unattended publication.',
      [...product,'programme','--python',selected.python,'--workspace',p.analysisWorkspace,'serve'],'product'),
    step('delivery','Prepare the customer files',
      'From the accepted original report/workbook and workspace, export the customer files and portable workspace. Retain their exact names, byte counts and digests. Add suitable complete result files to this plan with Operating plans; keep native archives too large for its 32 MiB limit in their original delivery. Inspect the exact outgoing reports and every shipping guide before handover.',
      'Receiving: ' + selected.receiving + '\nWorkbook: ' + scope.workbook,
      'The customer receives original report exports, workbook package, portable workspace and usable opening instructions.',
      ['starforge','discover','plan','--help'],'plans'),
    step('customer-receive','Restore and reopen at the customer destination',
      'Use worldbank-product analysis receive with the actual workspace archive, its actual SHA256, a new receiving operation ID and the absent customer destination below. Fill those measured values into this step’s argument array before running. Reopen the original restored Analysis UI, sources, report and workbook; check the downloaded original files.',
      'Fresh customer destination: ' + p.customerWorkspace + '\nUse a fresh receiving operation ID, separate from the producer ID ' + selected.operationId + '.',
      'The customer can reopen the original workspace and files; repeated completed receiving preserves later customer edits.'),
    step('acceptance','Accept delivery and retain continuation',
      'Record the customer acceptance decision, actual received file identities, unresolved exceptions and the next responsible operator. Save a new revision of this same Operating Plan. Transfer its complete editable JSON with the original customer delivery and, where used, its existing Installation record.',
      'Acceptance: ' + scope.acceptance + '\nCare: ' + scope.care + '\nReceiving: ' + selected.receiving,
      'The agreed acceptance is recorded with the actual result; every earlier brief, file and plan revision remains recoverable.'),
  ];
  steps[0].files.unshift(createOperatingFile({ id:'commissioning-brief',
    name:'World_Bank_Commissioning_Brief.json',mediaType:'application/json',bytes:briefBytes,
    note:'Complete original commissioning input. Paths describe planned destinations unless separately recorded as received outputs.' }));
  const plan = createOperatingPlan({
    id:selected.id,title:selected.title,customer:selected.customer,purpose:selected.purpose,
    period:selected.period,owner:selected.owner,receiving:selected.receiving,savedAt:selected.createdAt,
    notes:'Prepared from ' + WORLD_BANK_BRIEF_SCHEMA + '. All steps begin planned. Commands are argument arrays for the original toolkit; preparing this plan performs no acquisition, publication, payment, scheduler or grant submission. Record actual results only after the original operation completes.',
    steps,
  });
  need(utf8(JSON.stringify(plan,null,2) + '\n').length <= 32 * 1024 * 1024,
    'The complete plan exceeds the existing 32 MiB receiving limit.');
  return plan;
}
