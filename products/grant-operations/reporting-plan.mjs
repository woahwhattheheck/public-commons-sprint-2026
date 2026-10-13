// MIT. Reporting procedures compose the original Grant report and Operating Plans model.
import {
  createOperatingPlan, createOperatingStep, snapshotRegistration, inspectOperatingPlan,
  operatingPlanDraft, saveOperatingPlanRevision,
} from '../../stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs';

export const GRANT_REPORTING_PROFILE_SCHEMA = 'stellar-forge.grant-reporting-profile.v1';
export const GRANT_REPORTING_HANDOFF_SCHEMA = 'stellar-forge.grant-reporting-handoff.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const need = (condition, message) => {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'GRANT_REPORTING_INPUT_INVALID' });
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, label, maximum = 32000, required = true) {
  need(typeof value === 'string' && value.length <= maximum && !value.includes('\0') &&
    (!required || value.trim()), label + ' must be complete text.');
  return value;
}
function date(value, label, optional = false) {
  if (optional && (value === null || value === '')) return value;
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value, label + ' must be a civil date.');
  return value;
}
function path(value, label) {
  text(value, label, 4096);
  need(value.startsWith('/') && !value.split('/').includes('..'), label + ' must be an absolute host path.');
  return value.replace(/\/+$/, '') || '/';
}
export function inspectGrantReportingProfile(value) {
  const fields = ['schema', 'title', 'customer', 'owner', 'receiving', 'notes',
    'workspaceDirectory', 'workingDirectory', 'pythonExecutable', 'command', 'dueDate'];
  need(plain(value) && value.schema === GRANT_REPORTING_PROFILE_SCHEMA &&
    Object.keys(value).every(key => fields.includes(key)), 'Choose a Grant reporting profile.');
  const profile = copy(value);
  for (const key of ['title', 'customer', 'owner', 'receiving']) text(profile[key], key, key === 'receiving' ? 32000 : key === 'title' ? 240 : 300);
  profile.notes = text(profile.notes ?? '', 'notes', 16000, false);
  profile.workspaceDirectory = path(profile.workspaceDirectory, 'workspaceDirectory');
  profile.workingDirectory = path(profile.workingDirectory, 'workingDirectory');
  profile.pythonExecutable = path(profile.pythonExecutable ?? '/usr/bin/python3', 'pythonExecutable');
  profile.command ??= ['starforge'];
  need(Array.isArray(profile.command) && profile.command.length > 0 && profile.command.length <= 32 &&
    profile.command.every(arg => typeof arg === 'string' && arg && arg.length <= 4096 && !arg.includes('\0')),
  'command must be the actual executable and separate argument strings.');
  profile.dueDate = date(profile.dueDate ?? '', 'dueDate', true);
  return profile;
}
export function inspectGrantReportingSource(report) {
  need(plain(report) && report.schema === 'stellar-forge.sf47-performance.v1',
    'Read the complete original Budget performance report.');
  need(typeof report.case?.id === 'string' && Number.isSafeInteger(report.case.version) && report.case.version > 0 &&
    ['OPERATIONS', 'WALKTHROUGH'].includes(report.case.mode), 'Keep the original case identity and mode.');
  need(typeof report.plan?.id === 'string' && Number.isSafeInteger(report.plan.revision) && report.plan.revision > 0,
    'Keep the original pinned planning revision.');
  for (const key of ['reportSha256', 'recordsSha256'])
    need(typeof report[key] === 'string' && /^[a-f0-9]{64}$/.test(report[key]), 'Keep the native ' + key + '.');
  need(plain(report.selection), 'Keep the complete native reporting period.');
  date(report.selection.startDate ?? null, 'startDate', true); date(report.selection.endDate, 'endDate');
  need(!report.selection.startDate || report.selection.startDate <= report.selection.endDate, 'The reporting period is reversed.');
  for (const key of ['packages', 'categories', 'contributors', 'invoices', 'cash', 'workRecords', 'aging', 'assets', 'days', 'sources', 'basis'])
    need(Array.isArray(report[key]), 'Keep all original ' + key + ' rows.');
  need(plain(report.finances) && ['opening', 'period', 'closing'].every(key => plain(report.finances[key])),
    'Keep the original opening, period and closing amounts.');
  return copy(report);
}
export function createGrantReportingPlan({ id, report: input, catalog, profile: settings, savedAt }) {
  const report = inspectGrantReportingSource(input), profile = inspectGrantReportingProfile(settings);
  const grant = snapshotRegistration(catalog, 'command:grant-workspace');
  const tables = snapshotRegistration(catalog, 'command:grant-source-tables');
  const issuer = snapshotRegistration(catalog, 'export:./grant-issuer-terms');
  const discovery = snapshotRegistration(catalog, 'command:discover');
  const handoff = snapshotRegistration(catalog, 'command:grant-application-handoff');
  const args = (...words) => [...profile.command, ...words];
  const operation = (...words) => args('grant-workspace', '--python', profile.pythonExecutable,
    'operations', '--workspace', profile.workspaceDirectory, ...words);
  const dates = [...(report.selection.startDate ? ['--start-date', report.selection.startDate] : []),
    '--end-date', report.selection.endDate];
  const work = name => profile.workingDirectory + '/' + name;
  const binding = { case: report.case, plan: report.plan, selection: report.selection,
    recordsSha256: report.recordsSha256, reportSha256: report.reportSha256 };
  const steps = [];
  function step(id, title, selection, instruction, inputs, expectedResult, argv = [], extra = {}) {
    steps.push(createOperatingStep({ id, title, selection, instruction, inputs, expectedResult,
      owner: profile.owner, due: profile.dueDate, argv, ...extra }));
  }
  step('grant-reporting-capture', 'Open the captured period and case', grant,
    'Open report.json and the original performance handover. Confirm the selected customer, case mode, pinned plan and inclusive period before reviewing the figures.',
    JSON.stringify(binding, null, 2),
    'The operator is working on this exact issued reporting edition.',
    [], { status: 'completed', recordedResult: 'The original native Budget performance report and complete performance case archive were captured together.' });
  step('grant-reporting-baseline', 'Review the pinned budget and original source tables', tables,
    'Read the complete saved planning revision. Review the original source-table mapping and retained workbook editions. Record any correction through the existing source-table preview and planning amendment workflow.',
    'Plan ' + report.plan.id + ', revision ' + report.plan.revision + '. Complete source rows are retained in the native case.',
    'The reporting baseline and any separate proposed amendment are identified.',
    args('grant-source-tables', 'snapshot', '--workspace', profile.workspaceDirectory, '--plan', report.plan.id,
      '--revision', String(report.plan.revision), '--python', profile.pythonExecutable, '--output', work('baseline-source-tables.json')));
  step('grant-reporting-issuer', 'Review issuer correspondence and funding conditions', issuer,
    'Open Operations → Issuer terms. Read the retained correspondence, attachments and selected terms; compare the saved proposal and original issuer terms. Record the applicable report period, tranche criteria and accountable reviewer.',
    'Original issuer correspondence and the case source register.',
    'The reporting obligations come from the retained proposal or issuer source selected in the case.');
  step('grant-reporting-work', 'Complete contributor work and supplier invoice review', grant,
    'Open Work / invoice intake, Work and Invoices. Receive original timesheets and invoice lines, resolve corrections and duplicates, and finish the applicable review states. Keep the original accepted work and invoice source links.',
    'Current complete contributor, work and invoice records; original timesheets and supplier documents.',
    'The period includes the reviewed native records and retained corrections.',
    operation('show', '--case', report.case.id, '--output', work('current-case.json')));
  step('grant-reporting-cash', 'Reconcile cash and supplier balances', grant,
    'Open Account statements, Cash / issuer and Supplier accounts. Receive source statements with their original account, currency and date interpretation. Resolve unmatched observations, partial allocations, refunds and missing valuations through those original controls.',
    'Original statements, cash observations, invoice allocations and source documents.',
    'Opening, period and closing cash, liabilities and credits reconcile to the retained observations.');
  step('grant-reporting-performance', 'Review every budget performance view', grant,
    'Read package and category budgets, contributor activity, invoice aging, work and cash rows, and dated activity. Enter the useful explanation for variances and unfinished work in Recorded result. A source correction is followed by a fresh capture of the resulting native report.',
    'Complete report.json: ' + report.packages.length + ' packages, ' + report.invoices.length +
      ' invoices, ' + report.workRecords.length + ' work records and ' + report.cash.length + ' cash observations.',
    'The complete report has a clear management explanation and named follow-through.');
  step('grant-reporting-funding', 'Review funding assignments and delivery capacity', grant,
    'Open Cost funding, Forecast and Portfolio. Review original Work-hour and invoice-line allocations, all unassigned amounts, funding conditions, remaining tasks, resource calendars and cash timing. Save useful successor editions in their original editors.',
    'Original funding, Forecast and Portfolio selections in the same case.',
    'The remaining delivery plan reflects the full workload, funding terms and available capacity.');
  step('grant-reporting-installations', 'Review customer installations and outstanding delivery', grant,
    'Read the full delivery queue. Open each relevant installation and its selected customer return, acceptance and commercial billing. Assign the actual owner and due date for unfinished customer work.',
    'Original customer installations and the reporting closing date.',
    'Customer deliverables, acceptance and next work are accounted for.',
    operation('delivery-queue', '--case', report.case.id, '--as-of-date', report.selection.endDate,
      '--output', work('delivery-queue.json')));
  step('grant-reporting-outcomes', 'Review customer outcomes and cohort reporting', grant,
    'Open Customer task outcomes, Customer adoption plan, Cohort and Completion. Use the original measurement population and useful customer outputs. Check the applicable issuer window against the retained observations and prepared completion edition.',
    'Original customer sources, measured task outcomes and selected grant criteria.',
    'The report describes the complete customer work and applicable measured outcomes.');
  step('grant-reporting-edition', 'Freeze the reviewed period edition', grant,
    'If recording work changed the case, capture the current native report again and continue from that edition. The command below exports this report only while its original case version and report identity still match.',
    JSON.stringify(binding, null, 2),
    'The issued report and complete native case have one matching source edition.',
    operation('performance-export', '--case', report.case.id, ...dates,
      '--expected-version', String(report.case.version), '--expected-report-sha256', report.reportSha256,
      '--output', work('performance-handover.zip')));
  step('grant-reporting-procedure', 'Save the reporting procedure and readable handover', discovery,
    'Open Operating plans at the same browser host and port. Import operating-plan.json, record the completed reviews and their useful findings, and save a new revision. Export the complete editable JSON and readable HTML. Use grant-reporting pack to include the edited plan with the original period handover.',
    'Operating plan ' + id + ' and this reporting package.',
    'The receiver gets the full saved procedure, progress, findings and history.');
  step('grant-reporting-receiving', 'Receive the complete case and continue the procedure', handoff,
    'Use grant-reporting receive with the complete reporting package, the receiver’s original Runtime workspace, explicit Grant Application bindings and one original operation directory. Open the saved Application and import received-operating-plan.json into Operating plans. Review the catalog comparison against the selected receiving toolkit.',
    profile.receiving,
    'The complete native case, selected reporting dates, saved Application and procedure are open for the receiving operator.');
  return createOperatingPlan({ id, title: profile.title, customer: profile.customer,
    purpose: 'Complete the selected grant reporting period, explain its delivery and cash position, and hand over the original case and operating procedure.',
    period: (report.selection.startDate ?? 'All dates') + ' through ' + report.selection.endDate,
    owner: profile.owner, receiving: profile.receiving,
    notes: 'Case mode: ' + report.case.mode + '. Source case: ' + report.case.id + ', version ' + report.case.version +
      '. Original report: ' + report.reportSha256 + '.\n' + profile.notes,
    steps, ...(savedAt ? { savedAt } : {}) });
}
/** Preserve every incoming revision and add the actual receiver's case/path continuation. */
export function receiveGrantReportingPlan({ plan: input, profile: originalProfile, destination, receipt, savedAt }) {
  const plan = inspectOperatingPlan(input), profile = inspectGrantReportingProfile(originalProfile);
  need(plain(destination) && plain(receipt) && typeof receipt.imported?.result?.id === 'string' &&
    receipt.phase === 'APPLICATION_SAVED', 'Receive the complete original case and save its Application first.');
  const receiver = inspectGrantReportingProfile(destination);
  const directory = receiver.workspaceDirectory;
  const working = receiver.workingDirectory;
  const draft = operatingPlanDraft(plan), sourceStep = draft.content.steps.find(step => step.id === 'grant-reporting-capture');
  need(sourceStep, 'Keep the original reporting capture step.');
  const source = JSON.parse(sourceStep.inputs), originalCaseId = source.case.id;
  const mappedPath = value => value === profile.workspaceDirectory ? directory :
    value === profile.workingDirectory ? working :
    value.startsWith(profile.workingDirectory + '/') ? working + value.slice(profile.workingDirectory.length) : value;
  for (const step of draft.content.steps) {
    const command = step.argv;
    const offset = profile.command.every((value, index) => command[index] === value) ? profile.command.length : 0;
    step.argv = [...(offset ? receiver.command : []), ...command.slice(offset).map((value, index, argv) =>
      argv[index - 1] === '--case' && value === originalCaseId ? receipt.imported.result.id :
      argv[index - 1] === '--python' ? receiver.pythonExecutable : mappedPath(value))];
    // The pinned native export still describes the original issued edition.
    // Subsequent edits and re-exports begin with a fresh native period capture.
    if (['grant-reporting-edition', 'grant-reporting-baseline'].includes(step.id)) step.argv = [];
  }
  draft.content.receiving = receiver.receiving;
  draft.content.owner = receiver.owner;
  const step = draft.content.steps.find(item => item.id === 'grant-reporting-receiving');
  need(step, 'Keep the original receiving step.');
  step.status = 'completed'; step.owner = receiver.owner;
  step.recordedResult = JSON.stringify({ operationId: receipt.operationId, workspaceId: receipt.workspaceId,
    phase: receipt.phase, imported: receipt.imported.result, applicationReceipt: 'received-application.json',
    workspaceDirectory: directory, workingDirectory: working }, null, 2);
  draft.content.notes += '\nReceived case: ' + receipt.imported.result.id + ', version ' + receipt.imported.result.version +
    '. Continue native edits in ' + directory + '; the retained report remains its original issued edition.';
  return saveOperatingPlanRevision(plan, draft, { savedAt: savedAt ?? receipt.updatedAt });
}

/** A fresh native capture advances the same procedure; custom steps and history survive. */
export function refreshGrantReportingPlan({ plan: input, report, catalog, profile, savedAt }) {
  const previous = inspectOperatingPlan(input);
  const generated = createGrantReportingPlan({ id: previous.id, report, catalog, profile, savedAt });
  const draft = operatingPlanDraft(previous), fresh = operatingPlanDraft(generated).content;
  const priorCapture = draft.content.steps.find(step => step.id === 'grant-reporting-capture');
  need(priorCapture, 'Keep the original reporting capture step.');
  const prior = JSON.parse(priorCapture.inputs);
  const sameReport = prior.reportSha256 === report.reportSha256 && prior.case.id === report.case.id;
  const freshSteps = new Map(fresh.steps.map(step => [step.id, step]));
  // Keep the operator's actual step order, including custom work interleaved with built-in reviews.
  const ordered = draft.content.steps.map(old => {
    const step = freshSteps.get(old.id);
    if (!step) return old;
    freshSteps.delete(old.id);
    if (step.id === 'grant-reporting-capture') return step;
    return { ...step, title: old.title, instruction: old.instruction, expectedResult: old.expectedResult,
      owner: old.owner, due: old.due,
      ...(sameReport ? { status: old.status, recordedResult: old.recordedResult } : {}) };
  });
  // New built-in reviews become available without displacing the saved operator's procedure.
  fresh.steps = [...ordered, ...freshSteps.values()];
  draft.content = fresh;
  return saveOperatingPlanRevision(previous, draft, { savedAt: savedAt ?? generated.createdAt });
}
