import { bitwaveDefinitions, base, alias, page, readOnly, revision, actor, uuid, nullableId, name, plan, planViews, search, change, sha256, capture, timestamp, previewViews } from './catalog/bitwave.mjs';
export { bitwaveDefinitions } from './catalog/bitwave.mjs';
// MIT. Agent operations over the original retained Bitwave/accountant workflow.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { BitwaveWorkspace } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/bitwave-workspace.mjs';
import { BitwaveHttpClient, BITWAVE_API_BASE, BITWAVE_TOKEN_ENV } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/bitwave-http.mjs';
import { bitwaveHash, bitwaveCanonical, bitwaveTargetId } from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/bitwave.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);




















function exact(value, allowed, required = []) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw fail('BITWAVE_CONFIGURATION_ERROR', 'Supply the declared Bitwave host configuration fields.');
}
function named(value) {
  if (typeof value !== 'string' || !new RegExp(alias.pattern).test(value))
    throw fail('BITWAVE_CONFIGURATION_ERROR', 'Use 1–64 lowercase letters, digits, underscores or hyphens for a Bitwave alias.');
  return value;
}
function label(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\x00-\x1f\x7f]/.test(value))
    throw fail('BITWAVE_CONFIGURATION_ERROR', 'Use a nonempty organization label up to 160 characters.');
  return value;
}
function map(value, maximum, description) {
  if (!plain(value) || Object.keys(value).length > maximum)
    throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare up to ' + maximum + ' ' + description + '.');
  return Object.entries(value);
}
export function normalizeBitwaveConfig(raw, baseDirectory) {
  if (raw === undefined || raw === null) return null;
  exact(raw, ['tokenEnv', 'organizations', 'pageSets'], ['organizations']);
  const tokenEnv = raw.tokenEnv ?? BITWAVE_TOKEN_ENV;
  if (typeof tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv))
    throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare the environment-variable name containing the Bitwave access token.');
  const organizations = Object.create(null), orgIds = new Set();
  for (const [key, value] of map(raw.organizations, 16, 'Bitwave organizations')) {
    named(key); exact(value, ['orgId', 'label', 'allowCreate', 'dataSources'], ['orgId']);
    bitwaveTargetId(value.orgId, 'organization ID');
    if (orgIds.has(value.orgId)) throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare each native organization ID once.');
    orgIds.add(value.orgId);
    if (value.allowCreate !== undefined && typeof value.allowCreate !== 'boolean')
      throw fail('BITWAVE_CONFIGURATION_ERROR', 'allowCreate must be true or false.');
    const dataSources = Object.create(null), sourceIds = new Set();
    for (const [alias, id] of map(value.dataSources ?? {}, 64, 'native table aliases per organization')) {
      named(alias); bitwaveTargetId(id);
      if (sourceIds.has(id)) throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare each native table ID once in its organization.');
      sourceIds.add(id); dataSources[alias] = id;
    }
    organizations[key] = { orgId: value.orgId, label: label(value.label, key), allowCreate: value.allowCreate ?? false, dataSources };
  }
  const pageSets = Object.create(null);
  for (const [key, value] of map(raw.pageSets ?? {}, 64, 'original Bitwave page sets')) {
    named(key); exact(value, ['organization', 'dataSource', 'files'], ['organization', 'dataSource', 'files']);
    const organization = organizations[value.organization];
    if (!Object.hasOwn(organizations, value.organization) || !Object.hasOwn(organization.dataSources, value.dataSource))
      throw fail('BITWAVE_CONFIGURATION_ERROR', 'Each page set must select its declared organization and native table alias.');
    if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 500)
      throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare 1–500 original JSON files in their native page order.');
    const files = value.files.map(value => {
      if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))
        throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare original JSON file paths in the host page set.');
      const path = resolve(baseDirectory, value);
      if (path === '/') throw fail('BITWAVE_CONFIGURATION_ERROR', 'Declare an original JSON file, not a root directory.');
      return path;
    });
    if (new Set(files).size !== files.length) throw fail('BITWAVE_CONFIGURATION_ERROR', 'A page set must not repeat the same original file.');
    pageSets[key] = { organization: value.organization, dataSource: value.dataSource, files };
  }
  return { tokenEnv, organizations, pageSets };
}
export function bitwaveSourceView(definition) {
  return definition ? { configured: true, organizations: Object.keys(definition.organizations), pageSets: Object.keys(definition.pageSets) } : { configured: false };
}
export function bitwavePathReferences(definition, workspace) {
  return Object.entries(definition?.pageSets ?? {}).flatMap(([alias, value]) => value.files.map((path, index) =>
    [path, 'accounting://' + workspace + '/bitwave/' + alias + '/page-' + (index + 1)]));
}
const pageOf = (items, args, view) => {
  const offset = args.offset ?? 0, limit = args.limit ?? 25;
  return { view, total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
};
const operationBrief = ({ steps, ...value }) => ({ ...value, stepCount: steps.length, latestStep: steps.at(-1) ?? null });
const captureBrief = ({ files, returns, ...value }) => ({ ...value, fileCount: files.length, returnCount: returns.length });
const planBrief = ({ files, batches, operations, captures, returns, returnIntents, ...value }) => ({ ...value,
  fileCount: files.length, batchCount: batches.length, operationCount: operations.length, captureCount: captures.length,
  returnCount: returns.length, pendingReturnCount: (returnIntents ?? []).filter(row => row.status !== 'SAVED').length,
  latestOperation: operations.length ? operationBrief(operations.at(-1)) : null,
  latestCapture: captures.length ? captureBrief(captures.at(-1)) : null, latestReturn: returns.at(-1) ?? null });
const batchBrief = ({ attempts, ...value }) => ({ ...value, attemptCount: attempts.length, latestAttempt: attempts.at(-1) ?? null });

async function originalFile(path, remaining) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > remaining)
      throw fail('BITWAVE_INPUT_SIZE', 'The ordered original page set must contain regular files totaling at most 64 MiB.');
    const bytes = await handle.readFile();
    if (bytes.length < 1 || bytes.length > remaining) throw fail('BITWAVE_INPUT_SIZE', 'The original page set grew beyond 64 MiB.');
    return bytes;
  } finally { await handle.close(); }
}

export class MerchantBitwave {
  constructor(workspace, accountant, definition, { scope, files }) {
    this.workspace = workspace; this.accountant = accountant; this.definition = definition;
    this.scope = scope; this.files = files;
    this.controller = new BitwaveWorkspace(workspace, accountant, {
      client: new BitwaveHttpClient({ token: () => process.env[definition.tokenEnv] }),
    });
  }
  recover() { return this.controller.recover(); }
  close() { return this.controller.close(); }
  organization(alias) {
    if (!Object.hasOwn(this.definition.organizations, alias))
      throw fail('BITWAVE_ORGANIZATION_NOT_CONFIGURED', 'Choose a declared Bitwave organization alias from status.');
    return this.definition.organizations[alias];
  }
  ownedPlan(planId) {
    const record = this.controller.row(planId);
    const entry = Object.entries(this.definition.organizations).find(([, value]) => value.orgId === record.orgId);
    if (!entry) throw fail('BITWAVE_ORGANIZATION_NOT_CONFIGURED', 'This retained plan’s organization is not declared for this MCP workspace.');
    return { record, alias: entry[0], organization: entry[1] };
  }
  nativeAccess(record, organization, action) {
    if (action === 'create') {
      if (!organization.allowCreate) throw fail('BITWAVE_CREATE_NOT_CONFIGURED', 'The host has not enabled native table creation for this organization. Select a declared existing table.');
      return;
    }
    if (!record.binding) throw fail('BITWAVE_SOURCE_REQUIRED', 'Create or select this plan’s exact native data source first.');
    if (Object.values(organization.dataSources).includes(record.binding.dataSourceId)) return;
    if (organization.allowCreate && record.binding.source === 'native-api') return;
    throw fail('BITWAVE_TABLE_NOT_CONFIGURED', 'Declare the plan’s selected native table in this organization before native operation.');
  }
  async input(source) {
    if (!Object.hasOwn(this.definition.pageSets, source)) throw fail('BITWAVE_INPUT_NOT_CONFIGURED', 'Choose a host-declared original page set from status.');
    const input = this.definition.pageSets[source], organization = this.organization(input.organization);
    const files = []; let size = 0;
    for (const path of input.files) {
      const bytes = await originalFile(path, 64 * 1024 * 1024 - size); size += bytes.length;
      files.push({ name: basename(path), bytes });
    }
    const manifest = { source, organization: input.organization, orgId: organization.orgId,
      dataSource: input.dataSource, dataSourceId: organization.dataSources[input.dataSource],
      files: files.map((file, index) => ({ page: index + 1, name: file.name, bytes: file.bytes.length, sha256: bitwaveHash(file.bytes) })) };
    return { manifest, files, bytes: size, inputSha256: bitwaveHash(bitwaveCanonical(manifest)) };
  }
  result(value) {
    if (value.record?.batches) value = { ...value, record: planBrief(value.record) };
    if (value.capture?.files) value = { ...value, capture: captureBrief(value.capture) };
    if (value.operation?.steps) value = { ...value, operation: operationBrief(value.operation) };
    if (value.editConflicts) {
      const { editConflicts, ...rest } = value; value = { ...rest, editConflictCount: editConflicts.length };
    }
    return value;
  }
  async call(operation, args) {
    if (operation === 'merchant_accounting_bitwave_status') {
      if (args.organization) this.organization(args.organization);
      const organizations = Object.entries(this.definition.organizations)
        .filter(([key]) => !args.organization || key === args.organization)
        .map(([alias, value]) => ({ alias, ...value }));
      const allowed = new Set(organizations.map(row => row.orgId));
      const plans = (this.workspace.state.bitwavePlans ?? []).filter(row => allowed.has(row.orgId));
      const pageSets = Object.entries(this.definition.pageSets)
        .filter(([, value]) => !args.organization || value.organization === args.organization)
        .map(([alias, { files, ...value }]) => ({ alias, ...value, fileCount: files.length }));
      const view = args.view ?? 'summary';
      return { workspace: this.scope, revision: this.workspace.state.revision,
        connection: { baseUrl: BITWAVE_API_BASE, configured: this.controller.client.available() },
        counts: { organizations: organizations.length, plans: plans.length, pageSets: pageSets.length },
        ...(view === 'summary' ? { sources: bitwaveSourceView(this.definition) }
          : { page: pageOf({ organizations, pageSets, plans: plans.map(planBrief) }[view], args, view) }) };
    }
    if (operation === 'merchant_accounting_bitwave_plan_create') {
      const organization = this.organization(args.organization);
      return this.result(await this.controller.create({ ...args, orgId: organization.orgId }));
    }
    if (operation === 'merchant_accounting_bitwave_input') {
      const { manifest, bytes, inputSha256 } = await this.input(args.source), { files, ...source } = manifest;
      return { source, bytes, inputSha256, page: pageOf(files, args, 'files') };
    }
    const { record, alias: organizationAlias, organization } = this.ownedPlan(args.planId);
    switch (operation) {
      case 'merchant_accounting_bitwave_plan': {
        const value = await this.controller.detail(args.planId), view = args.view ?? 'summary';
        const result = { workspace: this.scope, revision: value.revision, organization: organizationAlias,
          record: planBrief(value.record), batchSize: value.plan.batchSize,
          currentAccountantParentId: this.accountant.row(record.handoffId).revisions.at(-1)?.id ?? null };
        if (view !== 'summary') result.page = pageOf({ batches: value.record.batches.map(batchBrief),
          operations: value.record.operations.map(operationBrief), captures: value.record.captures.map(captureBrief),
          returns: value.record.returns, returnIntents: value.record.returnIntents ?? [], files: value.record.files,
          schema: value.plan.schemaColumns }[view], args, view);
        return result;
      }
      case 'merchant_accounting_bitwave_rows':
        if (args.status && !args.captureId) throw fail('BITWAVE_CAPTURE_REQUIRED', 'A source status filter requires an original captureId.');
        return args.captureId ? this.controller.captureRows(args.planId, args.captureId, args) : this.controller.rows(args.planId, args);
      case 'merchant_accounting_bitwave_bind':
        if (!Object.hasOwn(organization.dataSources, args.dataSource)) throw fail('BITWAVE_TABLE_NOT_CONFIGURED', 'Select a declared native table alias in this plan’s organization.');
        return this.result(await this.controller.bind(args.planId, { ...args, dataSourceId: organization.dataSources[args.dataSource] }));
      case 'merchant_accounting_bitwave_operation_start':
        if (args.action === 'repair' && (!args.captureId || !args.comparisonSha256))
          throw fail('BITWAVE_REPAIR_REVIEW_REQUIRED', 'Carry the complete native captureId and comparisonSha256 from the current source review.');
        if (args.action !== 'repair' && (args.captureId !== undefined || args.comparisonSha256 !== undefined))
          throw fail('BITWAVE_INVALID_ARGUMENTS', 'captureId and comparisonSha256 select a missing-row repair.');
        if (args.action !== 'capture' && args.resumeCaptureId !== undefined)
          throw fail('BITWAVE_INVALID_ARGUMENTS', 'resumeCaptureId continues a partial native capture.');
        this.nativeAccess(record, organization, args.action);
        return this.result(await this.controller.operate(args.planId, args));
      case 'merchant_accounting_bitwave_operation': {
        const operation = this.controller.operationRow(args.planId, args.operationId), view = args.view ?? 'summary';
        return { workspace: this.scope, revision: this.workspace.state.revision, planId: args.planId,
          operation: operationBrief(operation),
          ...(operation.captureId ? { capture: captureBrief(this.controller.captureRow(args.planId, operation.captureId)) } : {}),
          ...(view === 'steps' ? { page: pageOf(operation.steps, args, view) } : {}) };
      }
      case 'merchant_accounting_bitwave_operation_stop':
        return this.result(await this.controller.stop(args.planId, args.operationId, args));
      case 'merchant_accounting_bitwave_import': {
        const source = await this.input(args.source);
        if (source.inputSha256 !== args.inputSha256) throw fail('BITWAVE_INPUT_CHANGED', 'The declared page set changed. Inspect its current ordered files before import.');
        if (record.orgId !== source.manifest.orgId || record.binding?.dataSourceId !== source.manifest.dataSourceId)
          throw fail('BITWAVE_INPUT_TARGET_MISMATCH', 'The original page set must match this plan’s selected native organization and table.');
        return this.result(await this.controller.importPages(args.planId, { ...args,
          files: source.files.map(file => ({ name: file.name, dataBase64: file.bytes.toString('base64') })) }));
      }
      case 'merchant_accounting_bitwave_return_preview': {
        const value = await this.controller.preview(args.planId, args.captureId, args);
        const { issues: sourceIssues, ...comparison } = value.comparison;
        const { results = [], issues = [], assignments = [], missingRows = [], ...revision } = value.preview?.revision ?? {};
        const view = args.view ?? 'summary', bytes = Buffer.from(value.csvBase64, 'base64');
        return { workspace: this.scope, planId: args.planId, captureId: args.captureId,
          preview: value.preview ? { ...value.preview, revision } : null, comparison,
          currentWorkspaceRevision: this.workspace.state.revision,
          sourceIssueCount: sourceIssues.length, editConflictCount: value.editConflicts.length,
          returnedCsv: { bytes: bytes.length, sha256: bitwaveHash(bytes) },
          ...(view === 'summary' ? {} : { page: pageOf({ sourceIssues, editConflicts: value.editConflicts,
            results, issues, assignments, missingRows }[view], args, view) }) };
      }
      case 'merchant_accounting_bitwave_return_apply':
        return this.result(await this.controller.apply(args.planId, args.captureId, args));
      case 'merchant_accounting_bitwave_file':
        return { workspace: this.scope, planId: args.planId, sourceFile: args.file,
          ...await this.files.read({ scope: this.scope, key: JSON.stringify(['bitwave', args.planId, args.file]), kind: 'bitwave',
            directory: this.workspace.directory, load: () => this.controller.file(args.planId, args.file),
            readId: args.readId, offset: args.offset, limit: args.limit, expectedSha256: args.expectedSha256 }) };
      default: throw fail('BITWAVE_UNKNOWN_TOOL', 'Unknown original Bitwave operation.');
    }
  }
}
