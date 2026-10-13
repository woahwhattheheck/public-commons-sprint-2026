// MIT. Full original Grant inputs feed the same source-owned Operating Plan builder.
import { createGrantReportingPlan as createReferencePlan } from './grant-reporting-plan.mjs';
import { inspectGrantReportingInput, requireSameGrantReportingPreview } from './grant-reporting-input.mjs';
import { createOperatingPlan, createOperatingStep, operatingPlanRevision, snapshotRegistration } from './operating-plan.mjs';

export { GRANT_REPORTING_PREPARATION_SCHEMA, GrantReportingInputError,
  grantReportingPreparationInput, inspectGrantReportingInput, requireSameGrantReportingPreview }
  from './grant-reporting-input.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const pretty = value => JSON.stringify(value, null, 2);
function child(directory, name) {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(directory);
  const separator = windows && !directory.includes('/') ? '\\' : '/';
  return directory.replace(/[\\/]+$/, '') + separator + name;
}

export function grantReportingProcedureFile(directory) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Enter the original report output directory.');
  return child(directory, 'grant-reporting-plan.json');
}

/** Rebuild a complete preparation through the original native source importer and plan model. */
export async function prepareGrantReportingPlan(value) {
  const received = await inspectGrantReportingInput(value);
  const { input, selection, preview } = received;
  const project = selection.sourceProject;
  const procedureFile = grantReportingProcedureFile(input.paths.outputDirectory);
  const reference = {
    id: input.id, savedAt: input.savedAt, title: input.title, customer: input.customer,
    period: input.period, owner: input.owner, receiving: input.receiving,
    purpose: 'Prepare the customer reporting period from the original Grant case and complete Source Tables project, then return the full editable procedure and native case history.',
    case: { id: selection.case.id, version: selection.case.version,
      planId: selection.plan.id, planRevision: selection.plan.revision,
      planContentSha256: selection.plan.contentSha256, workspace: input.paths.workspace },
    sourceTables: { project: { path: input.paths.sourceProject, sourceId: project.id,
      note: 'Retained project ' + project.id + '; normalized content SHA-256 ' + project.contentSha256 +
        '. Baseline ' + project.baseline.id + ' revision ' + project.baseline.revision +
        ', content SHA-256 ' + project.baseline.contentSha256 +
        '. The portable preparation retains the complete original file. Record its actual path byte identity when opening it on the operating host.' } },
    reporting: { startDate: input.startDate ?? null, endDate: input.asOfDate },
    outputDirectory: input.paths.outputDirectory, procedureFile,
    browserOrigin: selection.browserOrigin,
    sourceRoot: input.sourceRoot, sourceSelection: input.sourceSelection,
  };
  const base = createReferencePlan({ catalog: input.catalog, input: reference });
  const body = copy(operatingPlanRevision(base));
  const sourceSelection = snapshotRegistration(input.catalog, 'command:grant-source-tables');
  const selected = (id, title, inputs, instruction, expectedResult, command = sourceSelection) =>
    createOperatingStep({ id, title, inputs, instruction, expectedResult, owner: input.owner,
      selection: command, argv: [], status: 'planned', recordedResult: '' });
  const retained = [
    selected('review-original-source-selection', 'Review the complete original case and source selection',
      pretty({ case: selection.case, plan: selection.plan,
        sourceProject: { id: project.id, name: project.name, contentSha256: project.contentSha256,
          baseline: project.baseline, sameSelectedPlan: project.sameSelectedPlan },
        reporting: selection.reporting, paths: selection.paths, browserOrigin: selection.browserOrigin }),
      'Compare these selected native identities with the complete case and Source Tables project retained in the preparation. Keep every original record, file edition, mapping and review. The content hashes identify the normalized native inputs; the preparation retains its original file-byte identities separately. ' +
        (project.sameSelectedPlan
          ? 'The retained source baseline matches this selected case plan.'
          : 'This source project retains an earlier or different revision of the same plan. Use the original explicit Source Tables Rebase review before accepting a new planning preview; retain both original baselines and the actual decision.'),
      'The original case, selected plan and complete source project are available with their actual matching or differing baseline recorded.'),
    ...project.tables.map((table, index) => selected('review-retained-source-' + (index + 1),
      'Review retained ' + table.role + ' source and mapping', pretty(table),
      'Reopen this exact selected original table in Source Tables. Compare its document/resource, original file edition, positional mapping and native binding. Keep the selected workbook source and worksheet identity when present. ' +
        (table.reviewCurrent
          ? 'The retained review belongs to this selected edition and mapping; review its complete issues and choices.'
          : 'The selected table has no current retained review. Resolve its complete native issues and save the original review before advancing.'),
      'The table retains its original bytes, mapping, selected review and native target IDs. An unresolved or changed review remains explicit.')),
  ];
  const sourceIndex = body.steps.findIndex(step => step.id === 'read-source-project');
  if (sourceIndex < 0) throw new Error('The original builder did not retain its selected Source Tables step.');
  body.steps.splice(sourceIndex + 1, 0, ...retained);
  const receiving = body.steps.find(step => step.id === 'retain-in-original-case');
  if (!receiving) throw new Error('The original builder did not retain its case receiving step.');
  receiving.inputs += '\n\nReceiving workspace selected by the operator:\n' + input.paths.receivingWorkspace;
  receiving.instruction += ' Keep the selected receiving workspace and its existing customer/Installation owner. The original receiver records the actual imported case mapping and verifies the full procedure parent chain; retain that mapping before following commands in a moved workspace.';
  if (input.catalog.items.some(item => item.id === 'command:grant-procedures' && item.kind === 'command')) {
    receiving.selection = snapshotRegistration(input.catalog, 'command:grant-procedures');
    receiving.instruction += ' Use grant-procedures prepare/save/export/receive with the original private client binding, selected case version, recording actor and stable request IDs. Choose them in the native receiver and record the actual commands/results in a saved procedure revision.';
  }
  // Keep the complete entered receiving text; selected paths already appear in the source and receiving steps.
  body.receiving = input.receiving;
  const generated = createOperatingPlan({ id: input.id, savedAt: input.savedAt,
    title: body.title, customer: body.customer, purpose: body.purpose, period: body.period,
    owner: body.owner, receiving: body.receiving, notes: body.notes, steps: body.steps });
  const plan = requireSameGrantReportingPreview(preview, generated);
  return { plan, selection: copy(selection), procedureFile };
}

/** Complete original OperatingPlan; no native case mutation or work result is created. */
export async function createGrantReportingPlan(value) {
  return (await prepareGrantReportingPlan(value)).plan;
}
