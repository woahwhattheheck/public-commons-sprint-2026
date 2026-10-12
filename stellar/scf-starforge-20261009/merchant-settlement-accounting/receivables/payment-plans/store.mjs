// MIT. Payment plans share the accounting lease, revision, recovery and request journal.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {ReceivablesWorkspace, RECEIVABLE_REQUEST_BYTES} from '../store.mjs';
import {accountingWorkspaceBinding} from '../../workspace/binding.mjs';
import {need, plain, identifier, field, dateValue, today, json, sha, invoiceSummary} from '../core.mjs';
import {PLAN_SCHEMA, addDays, normalizePlanDraft, generateInstallments, compilePlanReview,
  scheduleDocument, planProjection, collectionsReport, scheduleFiles, reportFiles} from './core.mjs';

export const PAYMENT_PLAN_REQUEST_BYTES = RECEIVABLE_REQUEST_BYTES;
const at = () => new Date().toISOString();
const FILE_NAMES = new Set(['schedule.json','schedule.csv','schedule.html','manifest.json']);
function requestId(value) {
  const id = field(value, 'request ID', 160);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id),
    'INVALID_PAYMENT_PLAN_REQUEST_ID', 'Use the original stable request identifier.');
  return id;
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
function editionSummary(edition) {
  return {id: edition.id, editionNumber: edition.document.editionNumber, effectiveDate: edition.document.effectiveDate,
    createdAt: edition.document.createdAt, actor: edition.document.actor, reviewSha256: edition.document.reviewSha256,
    total: edition.document.schedule.total, currency: edition.document.source.currency,
    reference: edition.document.schedule.reference, files: structuredClone(edition.files)};
}

export class PaymentPlanWorkspace extends ReceivablesWorkspace {
  binding() { return accountingWorkspaceBinding(this.workspace.directory, this.workspace.state); }
  async _mutate(action, value, work) {
    if (value?.workspaceId !== undefined) need(value.workspaceId === this.binding().workspaceId,
      'PAYMENT_PLAN_WORKSPACE_CHANGED', 'Recover this operation in its original accounting workspace.', 409);
    return super._mutate(action, value, work);
  }
  async init() {
    await super.init();
    return this.workspace.serial(async () => {
      const data = this.data();
      if (data.paymentPlans === undefined) {
        data.paymentPlans = {schema: PLAN_SCHEMA, plans: []};
        await this.workspace.commit('receivables_payment_plans_initialized', 'workspace startup');
      }
      const saved = this._planData();
      need(saved.schema === PLAN_SCHEMA && Array.isArray(saved.plans),
        'INVALID_PAYMENT_PLAN_WORKSPACE', 'The retained payment-plan workspace is invalid.', 409);
      for (const plan of saved.plans) need(plain(plan) && Array.isArray(plan.editions) && Array.isArray(plan.history),
        'INVALID_PAYMENT_PLAN_WORKSPACE', 'The retained payment-plan record is invalid.', 409);
      return this;
    });
  }
  _planData() {
    const saved = this.data().paymentPlans;
    need(saved && saved.schema === PLAN_SCHEMA && Array.isArray(saved.plans),
      'PAYMENT_PLAN_WORKSPACE_REQUIRED', 'Initialize payment plans in the original accounting workspace.', 409);
    return saved;
  }
  _plan(id) {
    identifier(id, 'payment plan');
    const plan = this._planData().plans.find(row => row.id === id);
    need(plan, 'PAYMENT_PLAN_NOT_FOUND', 'Choose a saved payment plan.', 404);
    return plan;
  }
  _edition(plan, id) {
    identifier(id, 'schedule edition');
    const edition = plan.editions.find(row => row.id === id);
    need(edition, 'PAYMENT_PLAN_EDITION_NOT_FOUND', 'Choose a retained schedule edition.', 404);
    return edition;
  }
  _result(record, asOf = today()) {
    const result = {...super._result(record, asOf), workspaceId: this.binding().workspaceId};
    if (!record.planId) return result;
    const plan = this._plan(record.planId);
    result.plan = planProjection(plan, this.data(), asOf);
    result.draft = structuredClone(plan.draft);
    if (record.editionId) result.edition = editionSummary(this._edition(plan, record.editionId));
    return result;
  }
  _review(plan) {
    need(plan.status !== 'CANCELLED', 'PAYMENT_PLAN_CANCELLED', 'Create a new schedule after a cancelled plan.', 409);
    const invoice = this._invoice(plan.invoiceId), review = compilePlanReview(plan, invoice, this.data());
    const previous = plan.editions.at(-1);
    need(!previous || review.effectiveDate >= previous.document.effectiveDate,
      'PAYMENT_PLAN_REVISION_BACKDATED', 'A revised schedule must take effect on or after its previous edition.', 409);
    return review;
  }
  async state(query = {}) {
    return this.workspace.serial(async () => {
      const asOf = dateValue(query.asOf ?? today(), 'report date');
      const through = dateValue(query.through ?? addDays(asOf, 90), 'last collection date');
      if (query.customerId) this._customer(query.customerId);
      const data = this.data(), all = this._planData().plans;
      const selected = query.customerId ? all.filter(row => this._invoice(row.invoiceId).document.customer.id === query.customerId) : all;
      return structuredClone({schema: PLAN_SCHEMA, revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId, asOf, through,
        customers: this.workspace.state.customerStatements.customers,
        invoices: data.invoices.filter(row => !query.customerId || row.draft.customerId === query.customerId)
          .map(row => invoiceSummary(row, data, asOf)),
        plans: selected.map(row => planProjection(row, data, asOf)),
        report: collectionsReport(data, all, {asOf, through, customerId: query.customerId})});
    });
  }
  async detail(id, query = {}) {
    return this.workspace.serial(async () => {
      const plan = this._plan(id), data = this.data(), asOf = dateValue(query.asOf ?? today(), 'report date');
      const invoice = this._invoice(plan.invoiceId), allocations = data.allocations.filter(row => row.invoiceId === invoice.id);
      const receiptIds = new Set(allocations.map(row => row.receiptId));
      return structuredClone({plan: planProjection(plan, data, asOf), draft: plan.draft,
        editions: plan.editions.map(editionSummary), history: plan.history,
        ledger: {invoice: invoiceSummary(invoice, data, asOf), allocations,
          credits: data.credits.filter(row => row.invoiceId === invoice.id).map(row => ({
            id: row.id, number: row.number, date: row.document.creditDate, amount: row.document.totals.total,
            currency: row.document.currency})),
          receipts: data.receipts.filter(row => receiptIds.has(row.id)).map(row => ({
            id: row.id, reference: row.reference, method: row.method, receivedDate: row.receivedDate,
            currency: row.currency, amount: row.amount, status: row.status, voidDate: row.voidDate ?? null}))},
        revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId});
    });
  }
  async generate(value) {
    need(plain(value), 'INVALID_PAYMENT_PLAN', 'Enter installment-generation settings.');
    return this.workspace.serial(async () => {
      const invoice = this._invoice(value.invoiceId);
      need(invoice.document && invoice.status === 'ISSUED', 'PAYMENT_PLAN_INVOICE_REQUIRED', 'Choose a current issued invoice.', 409);
      return {draft: generateInstallments(value, invoice, this.data()), revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId};
    });
  }
  async savePlan(value) {
    return this._mutate('payment_plan_saved', value, async (data, actor) => {
      need(plain(value.plan), 'INVALID_PAYMENT_PLAN', 'Supply the payment-plan draft.');
      const invoice = this._invoice(value.plan.invoiceId), draft = normalizePlanDraft(value.plan, invoice, data);
      let plan;
      if (value.plan.id) {
        plan = this._plan(value.plan.id);
        need(plan.status !== 'CANCELLED', 'PAYMENT_PLAN_CANCELLED', 'Create a new plan after cancellation.', 409);
        need(plan.invoiceId === draft.invoiceId, 'PAYMENT_PLAN_INVOICE_CHANGED', 'Keep the plan attached to its original invoice.', 409);
        need(value.expectedVersion === plan.version, 'STALE_PAYMENT_PLAN', 'Reload the current plan before saving this edit.', 409);
        const previous = plan.editions.at(-1);
        need(!previous || draft.balanceDate >= previous.document.effectiveDate, 'PAYMENT_PLAN_REVISION_BACKDATED',
          'A revised schedule must take effect on or after its previous edition.', 409);
        plan.history.push({at: at(), actor, action: 'draft_updated', previousVersion: plan.version,
          previousDraftSha256: sha(json(plan.draft))});
        plan.draft = draft; plan.version++; plan.updatedAt = at();
      } else {
        plan = {id: randomUUID(), invoiceId: draft.invoiceId, status: 'DRAFT', version: 1, draft,
          createdAt: at(), updatedAt: at(), cancelledDate: null, editions: [],
          history: [{at: at(), actor, action: 'draft_created'}]};
        this._planData().plans.unshift(plan);
      }
      return {planId: plan.id};
    });
  }
  async previewPlan(id) {
    return this.workspace.serial(async () => ({...this._review(this._plan(id)), revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId}));
  }
  async _retainSchedule(document) {
    const root = join(this.workspace.directory, 'exports'), directoryId = randomUUID(), directory = join(root, directoryId);
    const parent = await lstat(root);
    need(parent.isDirectory() && !parent.isSymbolicLink(), 'PAYMENT_PLAN_EXPORT_DIRECTORY_CHANGED',
      'The original accounting export directory changed.', 409);
    await mkdir(directory, {mode: 0o700});
    const prepared = scheduleFiles(document), files = {};
    for (const file of prepared) files[file.name] = {bytes: file.bytes.length, sha256: sha(file.bytes), type: file.type};
    const manifest = {schema: 'stellar-forge.merchant-payment-schedule-files.v1', planId: document.planId,
      editionId: document.id, invoiceId: document.source.invoiceId, invoiceSha256: document.source.invoiceSha256, files: structuredClone(files)};
    prepared.push({name: 'manifest.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json(manifest))});
    for (const file of prepared) {
      const handle = await open(join(directory, file.name),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(file.bytes); await handle.sync(); } finally { await handle.close(); }
      files[file.name] = {bytes: file.bytes.length, sha256: sha(file.bytes), type: file.type};
    }
    await syncDirectory(directory); await syncDirectory(root);
    return {directoryId, files};
  }
  async activate(id, value) {
    identifier(id, 'payment plan');
    return this._mutate('payment_plan_activated', {...value, planId: id}, async (data, actor) => {
      const plan = this._plan(id);
      need(value.expectedVersion === plan.version, 'STALE_PAYMENT_PLAN', 'Reload and review the current plan before activating it.', 409);
      const review = this._review(plan);
      need(typeof value.reviewSha256 === 'string' && value.reviewSha256 === review.reviewSha256,
        'PAYMENT_PLAN_REVIEW_CHANGED', 'Review the current invoice balance and installment schedule again.', 409);
      need(!plan.editions.length || sha(json(plan.draft)) !== plan.editions.at(-1).draftSha256,
        'PAYMENT_PLAN_EDITION_EXISTS', 'This exact schedule is already retained. Open its existing edition.', 409);
      const other = this._planData().plans.find(row => row.id !== plan.id && row.invoiceId === plan.invoiceId &&
        row.editions.length && (!row.cancelledDate ||
          row.cancelledDate > row.editions[0].document.effectiveDate && row.cancelledDate > review.effectiveDate));
      need(!other, 'PAYMENT_PLAN_ALREADY_ACTIVE',
        'This invoice already has an overlapping retained schedule. Revise that plan or cancel it before this plan takes effect.', 409);
      const document = scheduleDocument(review, {editionNumber: plan.editions.length + 1, actor, createdAt: at()});
      const retained = await this._retainSchedule(document);
      const edition = {id: document.id, document, draftSha256: sha(json(plan.draft)), ...retained};
      plan.editions.push(edition); plan.status = 'ACTIVE'; plan.version++; plan.updatedAt = at();
      plan.history.push({at: at(), actor, action: 'schedule_activated', editionId: edition.id,
        editionNumber: document.editionNumber, effectiveDate: document.effectiveDate, reviewSha256: review.reviewSha256,
        invoiceSha256: document.source.invoiceSha256, scheduledTotal: document.schedule.total});
      return {planId: plan.id, editionId: edition.id};
    });
  }
  async cancelPlan(id, value) {
    identifier(id, 'payment plan');
    return this._mutate('payment_plan_cancelled', {...value, planId: id}, async (data, actor) => {
      const plan = this._plan(id);
      need(value.expectedVersion === plan.version, 'STALE_PAYMENT_PLAN', 'Reload the current plan before cancellation.', 409);
      need(plan.status !== 'CANCELLED', 'PAYMENT_PLAN_ALREADY_CANCELLED', 'This plan is already cancelled.', 409);
      const cancelledDate = dateValue(value.cancelledDate, 'cancellation date'), reason = field(value.reason, 'cancellation reason', 3000);
      const latestDate = plan.editions.at(-1)?.document.effectiveDate ?? plan.draft.balanceDate;
      need(cancelledDate >= latestDate, 'PAYMENT_PLAN_CANCEL_BEFORE_EDITION',
        'Cancel on or after the most recent schedule effective date.');
      plan.status = 'CANCELLED'; plan.cancelledDate = cancelledDate; plan.version++; plan.updatedAt = at();
      plan.history.push({at: at(), actor, action: 'schedule_cancelled', cancelledDate, reason});
      return {planId: plan.id};
    });
  }
  async scheduleFile(planId, editionId, name) {
    return this.workspace.serial(async () => {
      need(FILE_NAMES.has(name), 'PAYMENT_PLAN_FILE_NOT_FOUND', 'Choose a retained schedule format.', 404);
      const plan = this._plan(planId), edition = this._edition(plan, editionId), record = edition.files[name];
      need(record, 'PAYMENT_PLAN_FILE_NOT_FOUND', 'The selected schedule format is unavailable.', 404);
      const directory = join(this.workspace.directory, 'exports', identifier(edition.directoryId, 'schedule export'));
      const stat = await lstat(directory);
      need(stat.isDirectory() && !stat.isSymbolicLink(), 'PAYMENT_PLAN_EXPORT_DIRECTORY_CHANGED',
        'The retained schedule directory changed.', 409);
      const handle = await open(join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes;
      try {
        const file = await handle.stat();
        need(file.isFile() && file.size === record.bytes && file.size <= 32_000_000,
          'PAYMENT_PLAN_FILE_CHANGED', 'The retained schedule file changed.', 409);
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      need(bytes.length === record.bytes && sha(bytes) === record.sha256,
        'PAYMENT_PLAN_FILE_CHANGED', 'The file differs from the original retained schedule.', 409);
      return {bytes, name: 'schedule-' + edition.id + '-' + name, type: record.type};
    });
  }
  async collectionsFiles(query = {}) {
    return this.workspace.serial(async () => {
      if (query.customerId) this._customer(query.customerId);
      const report = collectionsReport(this.data(), this._planData().plans, query);
      return {report, files: reportFiles(report), revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId};
    });
  }
  async getOperation(id) {
    id = requestId(id);
    return this.workspace.serial(async () => {
      const row = this.data().requests.find(item => item.id === id);
      need(!row || row.action.startsWith('payment_plan_'), 'PAYMENT_PLAN_REQUEST_REUSED',
        'This request ID belongs to another receivables operation.', 409);
      if (!row) return {revision: this.workspace.state.revision, workspaceId: this.binding().workspaceId, operation: null};
      return {...this._result(row.result), operation: {...structuredClone(row), replayed: true}};
    });
  }
}
