// MIT. Customer reporting procedures use the original Operating Plans model.
import { createOperatingPlan, createOperatingStep, snapshotRegistration } from './operating-plan.mjs';

export const GRANT_REPORTING_INPUT_SCHEMA = 'stellar-forge.grant-reporting-input.v1';
export const GRANT_REPORTING_ROLES = Object.freeze(['packages', 'milestones', 'contributors', 'assignments']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
function need(ok, code, message) {
  if (!ok) { const error = new TypeError(message); error.code = code; throw error; }
}
function object(value, keys, field) {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)),
    'GRANT_PROCEDURE_FIELDS', field + ' must be an object containing only its documented fields.');
  return value;
}
function text(value, field, maximum = 32000, required = false) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') &&
    (!required || value.trim().length > 0), 'GRANT_PROCEDURE_TEXT',
    field + ' must be ' + (required ? 'nonempty ' : '') + 'text of at most ' + maximum + ' characters without NUL.');
  return value;
}
function positive(value, field) {
  need(Number.isSafeInteger(value) && value > 0, 'GRANT_PROCEDURE_REVISION',
    field + ' must be an original positive integer.');
  return value;
}
function identity(value, field, maximum = 128) {
  text(value, field, maximum, true);
  need(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value), 'GRANT_PROCEDURE_ID',
    field + ' must use letters, digits, dots, underscores or hyphens.');
  return value;
}
function hash(value, field) {
  if (value === null || value === undefined) return null;
  need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'GRANT_PROCEDURE_HASH',
    field + ' must be the complete lowercase SHA-256, or null when not yet recorded.');
  return value;
}
function absolute(value, field) {
  text(value, field, 4096, true);
  need(/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/.test(value) &&
    !/[\r\n]/.test(value), 'GRANT_PROCEDURE_PATH',
    field + ' must be an absolute local path without a line break.');
  return value;
}
function child(directory, name) {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(directory);
  const separator = windows && !directory.includes('/') ? '\\' : '/';
  return directory.replace(/[\\/]+$/, '') + separator + name;
}
function pathKey(value) {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(value) ? value.replace(/\\/g, '/').toLowerCase() : value;
}
function file(value, field) {
  object(value, ['path', 'sha256', 'bytes', 'sourceId', 'note'], field);
  const bytes = value.bytes ?? null;
  need(bytes === null || Number.isSafeInteger(bytes) && bytes >= 0,
    'GRANT_PROCEDURE_BYTES', field + '.bytes must be the original byte count, or null.');
  return { path: absolute(value.path, field + '.path'), sha256: hash(value.sha256, field + '.sha256'),
    bytes, sourceId: text(value.sourceId ?? '', field + '.sourceId', 500),
    note: text(value.note ?? '', field + '.note', 2000) };
}
function day(value, field, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value,
  'GRANT_PROCEDURE_DATE', field + ' must be a real YYYY-MM-DD date.');
  return value;
}
function originalReference(value, field) {
  object(value, ['id', 'revision', 'note'], field);
  return {id: identity(value.id, field + '.id'), revision: positive(value.revision, field + '.revision'),
    note: text(value.note ?? '', field + '.note', 2000)};
}
/** Validates customer-supplied references without reading files, running commands or asserting that work occurred. */
export function inspectGrantReportingInput(value) {
  object(value, ['schema', 'id', 'savedAt', 'title', 'customer', 'purpose', 'period', 'owner',
    'receiving', 'notes', 'case', 'archive', 'installation', 'taskOutcome', 'reporting',
    'sourceTables', 'outputDirectory', 'procedureFile', 'browserOrigin', 'sourceRoot', 'sourceSelection'],
  'Grant reporting input');
  need(value.schema === undefined || value.schema === GRANT_REPORTING_INPUT_SCHEMA,
    'GRANT_PROCEDURE_SCHEMA', 'Use the original Grant reporting input schema.');
  const source = object(value.case, ['id', 'version', 'planId', 'planRevision', 'workspace',
    'planContentSha256', 'sourcePlanSha256'], 'case');
  const caseRef = {
    id: identity(source.id, 'case.id'), version: positive(source.version, 'case.version'),
    planId: identity(source.planId, 'case.planId'), planRevision: positive(source.planRevision, 'case.planRevision'),
    workspace: absolute(source.workspace, 'case.workspace'),
    planContentSha256: hash(source.planContentSha256, 'case.planContentSha256'),
    sourcePlanSha256: hash(source.sourcePlanSha256, 'case.sourcePlanSha256'),
  };
  const outputDirectory = absolute(value.outputDirectory, 'outputDirectory');
  const browserOrigin = text(value.browserOrigin, 'browserOrigin', 100, true).replace(/\/$/, '');
  const origin = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/.exec(browserOrigin);
  need(origin && Number(origin[2]) <= 65535, 'GRANT_PROCEDURE_ORIGIN',
    'Keep an explicit original loopback browser origin, for example http://127.0.0.1:8846.');
  const sourceTables = object(value.sourceTables ?? {}, ['project', 'files', 'save'], 'sourceTables');
  const rows = sourceTables.files ?? [];
  need(Array.isArray(rows) && rows.length <= GRANT_REPORTING_ROLES.length,
    'GRANT_PROCEDURE_TABLES', 'Choose at most one original input for each source-table role.');
  const files = rows.map((row, index) => {
    const field = 'sourceTables.files[' + index + ']';
    object(row, ['role', 'file', 'delimiter', 'header', 'binding', 'tableMapping'], field);
    need(GRANT_REPORTING_ROLES.includes(row.role), 'GRANT_PROCEDURE_ROLE',
      field + '.role must be packages, milestones, contributors or assignments.');
    const delimiter = row.delimiter;
    need(['comma', 'tab', 'semicolon', 'pipe'].includes(delimiter), 'GRANT_PROCEDURE_DELIMITER',
      field + '.delimiter must be comma, tab, semicolon or pipe.');
    need(typeof row.header === 'boolean', 'GRANT_PROCEDURE_HEADER',
      field + '.header must be true or false.');
    return {role: row.role, file: file(row.file, field + '.file'), delimiter, header: row.header,
      binding: row.binding == null ? null : file(row.binding, field + '.binding'),
      tableMapping: row.tableMapping == null ? null : file(row.tableMapping, field + '.tableMapping')};
  });
  need(new Set(files.map(row => row.role)).size === files.length, 'GRANT_PROCEDURE_DUPLICATE_ROLE',
    'Each role must retain one explicitly chosen source file.');
  // Dependency order is the original native import order. Preserve each complete selected row.
  files.sort((a, b) => GRANT_REPORTING_ROLES.indexOf(a.role) - GRANT_REPORTING_ROLES.indexOf(b.role));
  let save = null;
  if (sourceTables.save != null) {
    object(sourceTables.save, ['requestId', 'note'], 'sourceTables.save');
    save = {requestId: identity(sourceTables.save.requestId, 'sourceTables.save.requestId', 100),
      note: text(sourceTables.save.note, 'sourceTables.save.note', 8000, true)};
  }
  let reporting = null;
  if (value.reporting != null) {
    object(value.reporting, ['startDate', 'endDate', 'reportSha256'], 'reporting');
    reporting = {startDate: day(value.reporting.startDate, 'reporting.startDate', true),
      endDate: day(value.reporting.endDate, 'reporting.endDate'),
      reportSha256: hash(value.reporting.reportSha256, 'reporting.reportSha256')};
    need(reporting.startDate === null || reporting.startDate <= reporting.endDate,
      'GRANT_PROCEDURE_DATE_ORDER', 'The reporting start date must not be after its end date.');
  }
  const result = {
    schema: GRANT_REPORTING_INPUT_SCHEMA,
    id: identity(value.id, 'id'), savedAt: text(value.savedAt, 'savedAt', 40, true),
    title: text(value.title, 'title', 300, true),
    customer: text(value.customer ?? '', 'customer', 1000),
    purpose: text(value.purpose ?? 'Prepare a source-bound Grant report and return the complete editable operating procedure.', 'purpose'),
    period: text(value.period ?? '', 'period', 1000), owner: text(value.owner ?? '', 'owner', 300),
    receiving: text(value.receiving ?? '', 'receiving'), notes: text(value.notes ?? '', 'notes', 16000),
    case: caseRef, archive: value.archive == null ? null : file(value.archive, 'archive'),
    installation: value.installation == null ? null : originalReference(value.installation, 'installation'),
    taskOutcome: value.taskOutcome == null ? null : originalReference(value.taskOutcome, 'taskOutcome'),
    reporting, sourceTables: {project: sourceTables.project == null ? null : file(sourceTables.project, 'sourceTables.project'), files, save},
    outputDirectory, procedureFile: absolute(value.procedureFile ?? child(outputDirectory, 'grant-reporting-plan.json'), 'procedureFile'),
    browserOrigin, sourceRoot: value.sourceRoot == null ? null : absolute(value.sourceRoot, 'sourceRoot'),
    sourceSelection: value.sourceSelection == null ? null : identity(value.sourceSelection, 'sourceSelection'),
  };
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result.savedAt) &&
    Number.isFinite(Date.parse(result.savedAt)) &&
    new Date(result.savedAt).toISOString().slice(0, 19) === result.savedAt.slice(0, 19),
    'GRANT_PROCEDURE_TIME', 'savedAt must be the original UTC ISO creation time.');
  const protectedPaths = [result.archive, result.sourceTables.project,
    ...files.flatMap(row => [row.file, row.binding, row.tableMapping])].filter(Boolean).map(row => pathKey(row.path));
  need(!protectedPaths.includes(pathKey(result.procedureFile)), 'GRANT_PROCEDURE_OUTPUT_COLLISION',
    'The procedure output must preserve every original source file.');
  return result;
}
function pretty(value) { return JSON.stringify(value, null, 2); }
function describedFile(value) {
  if (!value) return 'No original file reference has been supplied.';
  return pretty(value) + '\nA supplied identity is a selected reference. Record the actual receiving/hash result before marking this step completed.';
}
/** Creates only the original complete OperatingPlan. Its steps remain planned until an operator records an actual result. */
export function createGrantReportingPlan({catalog, input}) {
  const value = inspectGrantReportingInput(input), c = value.case;
  // These source-owned registrations are required even when a customer has no new CSV this period.
  const selections = Object.fromEntries(['grant-workspace', 'grant-source-tables', 'discover']
    .map(name => [name, snapshotRegistration(catalog, 'command:' + name)]));
  const step = (id, title, command, instruction, inputs, expectedResult, argv = []) =>
    createOperatingStep({id, title, owner: value.owner, status: 'planned', recordedResult: '',
      selection: command === null ? null : selections[command], instruction, inputs, expectedResult, argv});
  const sourceFlags = [...(value.sourceRoot ? ['--source-root', value.sourceRoot] : []),
    ...(value.sourceSelection ? ['--selection', value.sourceSelection] : [])];
  const outputPaths = new Set([pathKey(value.procedureFile)]);
  const protectedPaths = new Set([value.archive, value.sourceTables.project,
    ...value.sourceTables.files.flatMap(row => [row.file, row.binding, row.tableMapping])]
    .filter(Boolean).map(row => pathKey(row.path)));
  const output = filename => {
    const path = child(value.outputDirectory, filename), key = pathKey(path);
    need(!outputPaths.has(key) && !protectedPaths.has(key), 'GRANT_PROCEDURE_OUTPUT_COLLISION',
      'A generated output would overwrite another selected file: ' + path);
    outputPaths.add(key); return path;
  };
  const planCommand = (...args) => ['starforge', 'grant-workspace', ...args];
  const operations = (action, ...args) => planCommand('operations', '--workspace', c.workspace, action, '--case', c.id, ...args);
  const tables = (...args) => ['starforge', 'grant-source-tables', ...args];
  const discover = (...args) => ['starforge', 'discover', ...args];
  const originalCase = pretty(c);
  const caseSnapshot = output('original-case.json'), planSnapshot = output('original-plan.json');
  const originalArchive = output('original-case.zip'), comparison = output('toolkit-comparison.json');
  const steps = [
    step('prepare-original-inputs', 'Prepare the original customer inputs', null,
      'Keep the existing Grant case and its original workspace. Create the selected private output directory. Close any Grant listener before using its headless commands; the original workspace has one native writer. Resolve a moved workspace through the existing Installation/case receiver, then retain its actual new path and ID mapping in a saved procedure revision.',
      originalCase + '\n\nOriginal case archive:\n' + describedFile(value.archive) +
        '\n\nOutput directory:\n' + value.outputDirectory,
      'The original case, planning revision and complete input archive are identified. Any unavailable source, unresolved import mapping or identity difference remains explicitly open.'),
    step('compare-toolkit', 'Compare this procedure with the selected toolkit', 'discover',
      'Save this complete JSON file first, then compare its retained registrations and runtime groups with the installed source. Review changed or missing selections before invoking their commands; preserve the original snapshots in this plan.',
      'Complete procedure: ' + value.procedureFile + '\nSelected catalog package:\n' + pretty(catalog.package),
      'A complete per-step registration comparison is retained, including changed, missing and unchanged source/runtime bindings.',
      discover('plan', 'compare', '--file', value.procedureFile, ...sourceFlags, '--out', comparison)),
    step('read-original-case', 'Read the complete original Grant case', 'grant-workspace',
      'Read the existing case and check its ID, selected plan/revision and current version against the retained input. If another operator advanced it, preserve this observation and review the new version in a new procedure revision. A planning budget or planned assignment is not recorded work, an invoice, cash, or a customer outcome.',
      originalCase,
      'The complete actual case JSON is saved. Empty work, invoice, cash or outcome tables remain empty in the customer report.',
      operations('show', '--output', caseSnapshot)),
    step('read-original-plan', 'Read the selected planning revision and its source', 'grant-workspace',
      'Open the exact selected historical planning revision. Compare its content/source identity with the case baseline and retain all scenario, source, planning and report fields.',
      originalCase,
      'The complete original selected revision is saved independently of later planning edits.',
      planCommand('show', '--workspace', c.workspace, '--plan', c.planId, '--revision', String(c.planRevision),
        '--part', 'all', '--output', planSnapshot)),
    step('preserve-original-case', 'Export the complete case before new reporting work', 'grant-workspace',
      'Use this reviewed case version. A version conflict means the case changed: read that case, reconcile the existing work and save a new procedure revision before choosing a different version. Preserve this ZIP as the original receiving input.',
      originalCase,
      'The native full case ZIP contains its original planning history, sources, records, forecasts, portfolios and review history.',
      operations('export', '--expected-version', String(c.version), '--output', originalArchive)),
  ];
  let project;
  if (value.sourceTables.project) {
    project = value.sourceTables.project.path;
    steps.push(step('read-source-project', 'Reopen the complete retained source-table project', 'grant-source-tables',
      'Open the complete retained source project in the existing Grant Source Tables view. Check its baseline plan/revision, every original file, positional mapping, excluded row, target ID and review. Preserve its previous editions.',
      describedFile(value.sourceTables.project) + '\nNative baseline:\n' + originalCase,
      'The original source project and all retained mappings/editions are available; a changed baseline is handled through the original explicit Rebase review.'));
  } else {
    project = output('source-project-00.json');
    steps.push(step('snapshot-source-project', 'Prepare Source Tables from the original saved plan', 'grant-source-tables',
      'Use the existing native planning snapshot. It carries the complete original plan and available packages, milestones, contributors and assignments. The selected historical snapshot is retained; native preview will require its baseline to match the current working plan before any save.',
      originalCase, 'A complete source-table project is saved with the original baseline and positional/native field bindings.',
      tables('snapshot', '--workspace', c.workspace, '--plan', c.planId, '--revision', String(c.planRevision), '--output', project)));
  }
  for (const row of value.sourceTables.files) {
    const received = output('source-' + row.role + '-received.json');
    steps.push(step('receive-' + row.role, 'Receive the original ' + row.role + ' file', 'grant-source-tables',
      'Receive the complete source file into this role. For an existing role, the native reader retains its parsing and mapping settings; delimiter/header options establish a new role only. Compare the actual retained format and explicitly configure any intended change in the original Source Tables view. Keep missing columns and duplicate/target-ID decisions visible.',
      'Current complete project: ' + project + '\nSource:\n' + describedFile(row.file) +
        '\nSelected new-role format: ' + row.delimiter + ', header=' + String(row.header),
      'The complete source bytes and row identities are retained in a new project edition; no native planning or case records have been changed.',
      tables('receive', '--project', project, '--role', row.role, '--file', row.file.path,
        '--delimiter', row.delimiter, ...(!row.header ? ['--no-header'] : []), '--output', received)));
    project = received;
    const configured = output('source-' + row.role + '-mapped.json');
    if (row.binding || row.tableMapping) {
      steps.push(step('map-' + row.role, 'Apply the selected ' + row.role + ' mapping', 'grant-source-tables',
        'Read the full explicit binding/mapping before configuring. Keep positional field mappings, target IDs, merge/replace choice and excluded row decisions. Cross-role package, milestone and contributor links must refer to their original IDs.',
        'Current complete project: ' + project + '\nBinding:\n' + describedFile(row.binding) +
          '\nTable mapping:\n' + describedFile(row.tableMapping),
        'The complete mapped project preserves the original source and reviewed mapping choices.',
        tables('configure', '--project', project, '--role', row.role,
          ...(row.binding ? ['--binding', row.binding.path] : []),
          ...(row.tableMapping ? ['--table-mapping', row.tableMapping.path] : []), '--output', configured)));
    } else {
      steps.push(step('map-' + row.role, 'Review the ' + row.role + ' mapping in Source Tables', 'grant-source-tables',
        'Open the received complete project in the original Grant Source Tables editor. Confirm or edit every required field, target ID, row exclusion and merge/replace choice. Download the complete mapped project to the stated output. This manual decision remains planned until an operator records the actual mapping result.',
        'Received complete project: ' + project + '\nComplete mapped output: ' + configured,
        'A complete mapped project is saved at the selected path with explicit reviewed field and row decisions.'));
    }
    project = configured;
    const reviewed = output('source-' + row.role + '-reviewed.json');
    steps.push(step('review-' + row.role, 'Retain the native ' + row.role + ' review', 'grant-source-tables',
      'Read every issue and proposed native row before retaining the source review. Resolve missing fields, duplicate IDs and dependency errors against the same source project; preserve rejected rows and their reasons.',
      'Complete mapped project: ' + project,
      'The complete project retains the original source-table review and selected target records.',
      tables('review', '--project', project, '--role', row.role, '--output', reviewed)));
    project = reviewed;
  }
  const preview = output('planning-preview.json');
  steps.push(step('preview-planning', 'Preview the complete native planning effect', 'grant-source-tables',
    'Preview this complete project through the original Python planner. Review packages, milestones, contributors, assignments, amount, hours and cash/capacity changes against the selected baseline. If the native working plan advanced, retain the conflict and use the original explicit Rebase workflow before creating another preview.',
    'Complete reviewed project: ' + project + '\nNative baseline:\n' + originalCase,
    'The complete native preview and source change review are saved. This read does not amend the recorded case baseline.',
    tables('preview', '--project', project, '--workspace', c.workspace, '--plan', c.planId, '--output', preview)));
  if (value.sourceTables.save) {
    const saved = output('saved-planning');
    steps.push(step('save-reviewed-planning', 'Save the explicitly reviewed planning revision', 'grant-source-tables',
      'Run only after the responsible operator accepts the full retained preview. Keep this original request ID, note, preview and output directory together for a retry; the native writer reconciles an already committed request before checking current revision. A new working-plan revision does not silently amend the existing Operations case baseline.',
      pretty(value.sourceTables.save) + '\nComplete preview: ' + preview,
      'The original planner returns its actual saved revision plus complete planning JSON/ZIP, source project and original request result.',
      tables('save', '--preview', preview, '--workspace', c.workspace, '--note', value.sourceTables.save.note,
        '--request-id', value.sourceTables.save.requestId, '--output-directory', saved)));
    steps.push(step('review-case-baseline', 'Review any proposed Operations baseline amendment', 'grant-workspace',
      'Compare the newly saved working plan with the original case through its existing amendment review. Keep all actual work, invoice, cash and customer record IDs. Any approved amendment uses the original case actor/request/version controls; retain its actual result in the procedure history. If reporting requires no amendment, record that decision and leave the case baseline unchanged.',
      'Original case:\n' + originalCase + '\nSaved planning directory: ' + saved,
      'The case either retains its original baseline or carries the explicit native amendment and its original request/result. Later reporting/export steps are updated to the actual case version before execution.'));
  }
  if (value.reporting) {
    const performance = output('period-performance.json');
    steps.push(step('read-period-performance', 'Read recorded work, invoices and cash for the reporting period', 'grant-workspace',
      'Review the exact period and the actual case version before this read. Preserve its native period filters and source rows. Planned budget/allocations remain planning values; absent work, payments or customer measurements are reported as unrecorded. If an earlier approved action changed the case, save a procedure revision with its actual version first.',
      pretty(value.reporting) + '\nOriginal case:\n' + originalCase,
      'The full native period performance report retains actual work/invoice/cash and budget comparisons, with its own complete report SHA.',
      operations('performance', ...(value.reporting.startDate ? ['--start-date', value.reporting.startDate] : []),
        '--end-date', value.reporting.endDate, '--expected-version', String(c.version), '--output', performance)));
    const exported = output('period-performance.zip');
    steps.push(step('export-period-performance', 'Export the reviewed performance report and full case', 'grant-workspace',
      'Use the exact report SHA returned by the reviewed native performance result and the same date range/case version. If no report SHA was supplied when this procedure was created, record it in a new saved procedure revision and set the original native export arguments before running. Keep all native CSVs, readable HTML and the full case in the returned ZIP.',
      'Full report: ' + performance + '\nExport destination: ' + exported + '\nSelection:\n' + pretty(value.reporting),
      'The performance ZIP is bound to the reviewed complete report and contains its original source case.',
      value.reporting.reportSha256 ? operations('performance-export',
        ...(value.reporting.startDate ? ['--start-date', value.reporting.startDate] : []),
        '--end-date', value.reporting.endDate, '--expected-version', String(c.version),
        '--expected-report-sha256', value.reporting.reportSha256, '--output', exported) : []));
  } else {
    steps.push(step('select-reporting-period', 'Select the actual reporting period and evidence', 'grant-workspace',
      'Choose the reporting start/end dates with the receiving operator before generating a period report. Read actual work, invoices, cash and outcome records through the original case. Keep planned deliverables and absent measurements explicit. Save the selected dates and original native report/export arguments in a procedure revision.',
      originalCase, 'The responsible operator records the actual reporting period and evidence; no date or achieved customer result is inferred.'));
  }
  if (value.taskOutcome) {
    const document = output('task-outcome-comparison.json');
    steps.push(step('read-task-outcome', 'Reopen the selected customer task comparison', 'grant-workspace',
      'Read the exact saved comparison edition and its complete source/history. Keep the measured, estimated and missing values distinct; do not substitute planned task effort for a recorded customer result.',
      pretty(value.taskOutcome), 'The exact original customer comparison and its source edition are saved.',
      operations('task-outcomes-show', '--comparison', value.taskOutcome.id, '--revision', String(value.taskOutcome.revision), '--output', document)));
  }
  if (value.installation) {
    const document = output('customer-installation.json'), archive = output('customer-installation.zip');
    steps.push(step('read-customer-installation', 'Reopen the original customer Installation', 'grant-workspace',
      'Read the exact existing Installation edition and its actual source, customer, runtime and receiving selections. Resolve any changed installation through the existing owner; keep the original edition and history.',
      pretty(value.installation), 'The existing customer Installation is identified without creating another installation or customer.',
      operations('installation-show', '--installation', value.installation.id,
        '--revision', String(value.installation.revision), '--output', document)));
    steps.push(step('export-customer-installation', 'Return the complete selected Installation handover', 'grant-workspace',
      'Export this original saved edition with the native receiver. Preserve all complete member files and the included original Operations case; record its actual path, byte count and SHA in the procedure result.',
      pretty(value.installation), 'The full native Installation handover and included case are retained for the same customer.',
      operations('installation-export', '--installation', value.installation.id,
        '--revision', String(value.installation.revision), '--output', archive)));
  }
  const browserUrl = value.browserOrigin + '/operating-plan.html';
  const origin = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]+)$/.exec(value.browserOrigin);
  steps.push(step('open-saved-procedure', 'Open and continue the complete procedure in Command finder', 'discover',
    'Start the existing Command finder from the selected installed product at this exact host spelling and port, then open the full JSON in Operating plans. Save each actual result as a new revision. Browser drafts are scoped to this origin; keep it when stopping/reopening. Use full JSON history to move to another operator or origin.',
    'Complete procedure: ' + value.procedureFile + '\nBrowser: ' + browserUrl +
      '\nSelected source checkout (when used): ' + pretty({sourceRoot: value.sourceRoot, selection: value.sourceSelection}) +
      '\nThe original source API startDiscoveryServer accepts sourceRoot/selection. The installed discover serve command uses its own installed catalog.',
    'The same procedure ID and all original revisions reopen. Unfinished steps remain planned or in progress until their actual results are recorded.',
    discover('serve', '--host', origin[1] === '[::1]' ? '::1' : origin[1], '--port', origin[2])));
  const returned = output('returned-operating-plan.json'), combined = output('received-operating-plan.json');
  steps.push(step('receive-complete-history', 'Receive the other operator’s complete history', 'discover',
    'The receiving operator downloads the complete OperatingPlan JSON after saving actual work. Receive it against the current complete local file. Identical history is replay; a shared prefix can extend; divergent shared revisions require review or an explicit copy. Preserve both files and all original IDs.',
    'Current history: ' + value.procedureFile + '\nIncoming complete history: ' + returned +
      '\nCombined complete history: ' + combined,
    'The original model accepts the complete shared history or reports its conflict without overwriting either operator’s source.',
    discover('plan', 'receive', '--file', returned, '--existing', value.procedureFile, '--out', combined)));
  steps.push(step('retain-in-original-case', 'Retain the complete procedure in the original Grant case', 'grant-workspace',
    'Use the existing Grant Operating Plans receiver to attach this complete accepted history to the same case and original Installation/task/source-table references. Select the actual current case version and original actor/request ID in that receiver. Preserve the native attachment/result and export/reopen the complete case through its original writer. Do not create another case to resolve an uncertain result.',
    'Accepted complete history: ' + combined + '\nOriginal case:\n' + originalCase +
      '\nInstallation:\n' + pretty(value.installation) + '\nTask comparison:\n' + pretty(value.taskOutcome) +
      '\nFinal source-table project: ' + project,
    'The original case retains the full editable procedure, its source bindings and history; the returned case reopens through the established receiving operation.'));
  const markdown = output('grant-reporting-handover.md'), html = output('grant-reporting-handover.html');
  for (const [format, path] of [['markdown', markdown], ['html', html]]) {
    steps.push(step('handover-' + format, 'Write the complete readable ' + format + ' handover', 'discover',
      'Render from the accepted complete history, retaining the original complete JSON alongside this readable document. Check customer, original IDs, actual results, file identities, remaining steps and the agreed receiving instructions.',
      'Complete history: ' + combined + '\nReceiving: ' + value.receiving,
      'The readable handover and complete editable JSON refer to the same original procedure and saved history.',
      discover('plan', 'show', '--file', combined, '--format', format, '--out', path)));
  }
  const notes = [
    value.notes,
    'Created by the source-owned Grant reporting builder. This is a planned customer procedure; generation does not execute commands, verify local file bytes, accept a review, record work or establish customer outcomes.',
    'Original case and selected baseline:\n' + originalCase,
    'Original browser origin: ' + value.browserOrigin,
    'Complete original procedure filename: ' + value.procedureFile,
    'Retain every source/runtime registration snapshot and all saved OperatingPlan revisions. A version, catalog, source-file or baseline difference requires an explicit retained review.',
  ].filter(Boolean).join('\n\n');
  return createOperatingPlan({id: value.id, savedAt: value.savedAt, title: value.title, customer: value.customer,
    purpose: value.purpose, period: value.period, owner: value.owner, receiving: value.receiving, notes, steps});
}
