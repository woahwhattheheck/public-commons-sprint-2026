// MIT. Service terms share the original accounting lease, journal and invoice engine.
import {randomUUID} from 'node:crypto';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {ReceivablesWorkspace} from '../receivables/store.mjs';
import {compileQuoteInvoice} from '../receivables/quote-import.mjs';
import {need, plain, field, identifier, dateValue, today, json, sha, customerSnapshot} from '../receivables/core.mjs';
import {AGREEMENTS_SCHEMA, AGREEMENT_EXPORT_SCHEMA, clone, integer, normalizeTerms, normalizedCreation,
  monthDate, monthIndex, shiftDays, effectiveEnd, schedule, linkedInvoice, billingOccupied,
  assertUnbilledFrom, agreementStatus, periodLabel, previewIdentity, scheduleCsv, agreementHtml} from './core.mjs';
import {validateSourceBodies, retainSource, readSourceFile, sourceBodies, SOURCE_NAMES} from './files.mjs';
import {acceptedServiceRenewal, assertRenewalAssignment} from './renewal.mjs';
const at = () => new Date().toISOString();
function requestIdentifier(value) {
  const id = field(value, 'request ID', 160);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id), 'INVALID_AGREEMENT_REQUEST_ID', 'Use a stable request identifier.');
  return id;
}
function requestContent(value) {
  const content = clone(value); delete content.revision; delete content.workspaceId; return content;
}
function requestIntent(action, agreementId, value) {
  // JSON object key order is not operator intent. Preserve original arrays,
  // source document strings and field values while ordering object keys.
  const canonical = JSON.stringify({action, agreementId, value: requestContent(value)}, (_key, item) =>
    plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return sha(canonical);
}
export class ServiceAgreementWorkspace {
  constructor(workspace, {receivables} = {}) {
    this.workspace = workspace; this.receivables = receivables ?? new ReceivablesWorkspace(workspace);
  }
  async init() {
    await this.receivables.init();
    await this.workspace.serial(async () => {
      if (this.workspace.state.serviceAgreements === undefined) {
        this.workspace.state.serviceAgreements = {schema: AGREEMENTS_SCHEMA, agreements: [], requests: []};
        await this.workspace.commit('service_agreements_initialized', 'workspace startup');
      }
      const data = this.data();
      need(data.schema === AGREEMENTS_SCHEMA && Array.isArray(data.agreements) && Array.isArray(data.requests),
        'INVALID_SERVICE_AGREEMENTS', 'The original service-agreement state is invalid.', 409);
    });
    return this;
  }
  data() { this.workspace.lease.assertHeld(); return this.workspace.state.serviceAgreements; }
  _workspaceId() { return accountingWorkspaceBinding(this.workspace.directory, this.workspace.state).workspaceId; }
  _agreement(id) {
    identifier(id, 'service agreement');
    const row = this.data().agreements.find(item => item.id === id);
    need(row, 'AGREEMENT_NOT_FOUND', 'Choose an existing service agreement.', 404); return row;
  }
  _source(agreement, id) {
    identifier(id, 'agreement source');
    const row = agreement.sources.find(item => item.id === id);
    need(row, 'AGREEMENT_SOURCE_NOT_FOUND', 'Choose an original agreement source.', 404); return row;
  }
  _version(agreement, value) {
    need(value.expectedVersion === agreement.version, 'STALE_AGREEMENT',
      'The service agreement changed. Review its current calendar before saving.', 409);
  }
  _view(agreement, asOf = today()) {
    dateValue(asOf, 'calendar date');
    return clone({...agreement, customerName: this.receivables._customer(agreement.customerId).name,
      endDate: monthDate(agreement.startDate, effectiveEnd(agreement)),
      originalTermEndDate: monthDate(agreement.startDate, agreement.termMonths),
      status: agreementStatus(agreement, asOf), periods: schedule(agreement, this.receivables.data(), asOf)});
  }
  _result(result, asOf = today()) {
    const agreement = this._agreement(result.agreementId);
    const response = {workspaceId: this._workspaceId(), revision: this.workspace.state.revision,
      agreementId: agreement.id, agreement: this._view(agreement, asOf)};
    if (result.billingId) {
      const billing = agreement.billings.find(row => row.id === result.billingId);
      need(billing, 'AGREEMENT_BILLING_NOT_FOUND', 'The original billing request is missing.', 409);
      const invoice = linkedInvoice(billing, this.receivables.data());
      response.billing = clone({...billing, invoiceId: invoice?.id ?? null, status: invoice?.status ?? 'PREPARING'});
      if (invoice) response.invoice = clone(invoice);
    }
    return response;
  }
  async _mutate(action, agreementId, value, work) {
    need(plain(value), 'INVALID_AGREEMENT_REQUEST', 'Send a complete operator request.');
    const actor = field(value.actor, 'operator', 1000), requestId = requestIdentifier(value.requestId);
    const intentSha256 = requestIntent(action, agreementId, value);
    return this.workspace.serial(async () => {
      need(value.workspaceId === undefined || value.workspaceId === this._workspaceId(),
        'AGREEMENT_WORKSPACE_CHANGED', 'Open this request in its selected accounting workspace before saving.', 409);
      const data = this.data(), prior = data.requests.find(row => row.id === requestId);
      if (prior) {
        need(prior.action === action && prior.intentSha256 === intentSha256, 'AGREEMENT_REQUEST_REUSED',
          'This request ID belongs to different content. Keep the original request or use a new request ID.', 409);
        return {...this._result(prior.result), operation: {...clone(prior), replayed: true}};
      }
      this.workspace.expected(value.revision);
      const result = await work(actor, requestId), record = {id: requestId, action, actor, at: at(), intentSha256, result};
      data.requests.push(record);
      // Validate the complete resulting calendar while the original serial
      // transaction can still restore its previous state.
      const response = this._result(result);
      await this.workspace.commit('service_agreements_' + action, actor, {requestId, ...result});
      return {...response, revision: this.workspace.state.revision, operation: {...clone(record), replayed: false}};
    });
  }
  async _edition(agreement, value, fromMonth, fallback, actor, reason) {
    validateSourceBodies(value);
    const renewal = await acceptedServiceRenewal(value);
    assertRenewalAssignment(this.data().agreements, agreement, renewal);
    const terms = normalizeTerms(value, fallback), issueDate = monthDate(agreement.startDate, fromMonth);
    const selection = {quoteContent: value.quoteContent, responseContent: value.responseContent,
      customerId: agreement.customerId, currencyScale: agreement.currency.scale,
      scope: 'RECURRING', issueDate, dueDate: shiftDays(issueDate, terms.dueDays)};
    const compiled = compileQuoteInvoice({...selection, periodCount: 1, periodLabel: 'Original monthly agreement rate'});
    need(compiled.review.accepted, 'AGREEMENT_ACCEPTED_RESPONSE_REQUIRED',
      'Select the original accepted customer response to this exact quotation edition.');
    // The original compiler performs every whole-period price calculation once.
    const amountsByPeriods = {'1': compiled.draft.totals.total};
    for (let count = 2; count <= 12; count++) amountsByPeriods[String(count)] =
      compileQuoteInvoice({...selection, periodCount: count, periodLabel: 'Original whole-month agreement rate'}).draft.totals.total;
    const edition = {id: randomUUID(), fromMonth, effectiveDate: issueDate, ...terms, sourceId: null,
      quote: clone(compiled.source.quote), response: clone(compiled.source.response),
      currency: clone(compiled.draft.currency), ...(renewal ? {renewal} : {}),
      amountsByPeriods, createdAt: at(), actor, reason};
    // Reject an invalid complete calendar before creating retained source files.
    schedule({...agreement, editions: [...agreement.editions, edition]}, this.receivables.data(), today());
    const source = await retainSource(this.workspace, value, compiled); agreement.sources.push(source);
    return {...edition, sourceId: source.id};
  }
  async state({asOf = today()} = {}) {
    return this.workspace.serial(async () => ({schema: AGREEMENTS_SCHEMA, workspaceId: this._workspaceId(),
      revision: this.workspace.state.revision, asOf: dateValue(asOf, 'calendar date'),
      customers: clone(this.workspace.state.customerStatements.customers),
      agreements: this.data().agreements.map(row => this._view(row, asOf)),
      history: clone(this.workspace.state.history.filter(row => row.action.startsWith('service_agreements_')).slice(-200).reverse())}));
  }
  async detail(id, {asOf = today()} = {}) {
    return this.workspace.serial(async () => {
      const agreement = this._view(this._agreement(id), asOf);
      return {workspaceId: this._workspaceId(), revision: this.workspace.state.revision, asOf, agreement, periods: agreement.periods};
    });
  }
  async create(value) {
    return this._mutate('created', null, value, async actor => {
      const selected = normalizedCreation(value), customer = this.receivables._customer(value.customerId);
      need(!this.data().agreements.some(row => row.reference.toLowerCase() === selected.reference.toLowerCase()),
        'AGREEMENT_REFERENCE_EXISTS', 'Choose a distinct agreement reference.', 409);
      const agreement = {id: randomUUID(), reference: selected.reference, title: selected.title,
        customerId: customer.id, currency: selected.currency, startDate: selected.startDate,
        termMonths: selected.termMonths, calendarBreaks: [selected.termMonths], version: 1,
        createdAt: at(), updatedAt: at(), sources: [], editions: [], billings: [], cancellation: null, history: []};
      agreement.editions.push(await this._edition(agreement, value, 0, selected, actor, 'Original accepted service quotation'));
      agreement.history.push({at: at(), actor, action: 'created', termMonths: agreement.termMonths,
        endDate: selected.endDate, editionId: agreement.editions[0].id});
      this.data().agreements.unshift(agreement); return {agreementId: agreement.id};
    });
  }
  async amend(id, value) {
    return this._mutate('amended', id, value, async actor => {
      const agreement = this._agreement(id); this._version(agreement, value);
      const fromMonth = monthIndex(agreement.startDate, value.effectiveDate, effectiveEnd(agreement));
      assertUnbilledFrom(agreement, fromMonth, this.receivables.data());
      const prior = [...agreement.editions].sort((a, b) => a.fromMonth - b.fromMonth).filter(row => row.fromMonth <= fromMonth).at(-1);
      const reason = field(value.reason, 'change reason', 4000);
      const edition = await this._edition(agreement, value, fromMonth, prior, actor, reason);
      agreement.editions.push(edition);
      agreement.history.push({at: at(), actor, action: 'amended', reason, effectiveDate: edition.effectiveDate,
        editionId: edition.id, previousEditionId: prior.id});
      agreement.version++; agreement.updatedAt = at(); return {agreementId: id};
    });
  }
  async renew(id, value) {
    return this._mutate('renewed', id, value, async actor => {
      const agreement = this._agreement(id); this._version(agreement, value);
      const additionalMonths = integer(value.additionalMonths, 'Additional service months', 1, 120);
      const previousEndMonth = effectiveEnd(agreement), nextEnd = previousEndMonth + additionalMonths;
      integer(nextEnd, 'Complete service term months', 1, 1200); monthDate(agreement.startDate, nextEnd);
      const reason = field(value.reason, 'renewal reference and reason', 4000);
      agreement.history.push({at: at(), actor, action: 'renewed', reason, additionalMonths,
        previousEndDate: monthDate(agreement.startDate, previousEndMonth), endDate: monthDate(agreement.startDate, nextEnd),
        previousCancellation: clone(agreement.cancellation), previousCalendarBreaks: clone(agreement.calendarBreaks)});
      agreement.calendarBreaks = [...new Set([...(agreement.calendarBreaks ?? [agreement.termMonths])
        .filter(month => month < previousEndMonth), previousEndMonth, nextEnd].filter(month => month > 0))].sort((a,b) => a-b);
      agreement.termMonths = nextEnd; agreement.cancellation = null;
      agreement.version++; agreement.updatedAt = at(); return {agreementId: id};
    });
  }
  async cancel(id, value) {
    return this._mutate('cancelled', id, value, async actor => {
      const agreement = this._agreement(id); this._version(agreement, value);
      const endMonth = monthIndex(agreement.startDate, value.effectiveDate, agreement.termMonths);
      assertUnbilledFrom(agreement, endMonth, this.receivables.data());
      const reason = field(value.reason, 'cancellation reference and reason', 4000);
      agreement.history.push({at: at(), actor, action: 'cancelled', reason,
        effectiveDate: value.effectiveDate, previousCancellation: clone(agreement.cancellation)});
      agreement.cancellation = {endMonth, effectiveDate: value.effectiveDate, reason, actor, at: at()};
      agreement.version++; agreement.updatedAt = at(); return {agreementId: id};
    });
  }
  async _preview(agreement, periodId, asOf = today()) {
    const period = schedule(agreement, this.receivables.data(), asOf).find(row => row.id === periodId);
    need(period, 'AGREEMENT_PERIOD_NOT_FOUND', 'Choose a period from the current agreement calendar.', 404);
    const pending = period.billingId && agreement.billings.find(row => row.id === period.billingId);
    if (pending && !linkedInvoice(pending, this.receivables.data())) return {
      workspaceId: this._workspaceId(), revision: this.workspace.state.revision, agreementId: agreement.id,
      agreementVersion: agreement.version, period: clone(period), ...clone(pending.preview),
      recoveryRequest: clone(pending.request)};
    const edition = agreement.editions.find(row => row.id === period.editionId);
    const source = this._source(agreement, edition.sourceId), originals = await sourceBodies(this.workspace, source);
    const compiled = compileQuoteInvoice({...originals, customerId: agreement.customerId,
      currencyScale: agreement.currency.scale, scope: 'RECURRING', periodCount: period.periodCount,
      periodLabel: periodLabel(agreement, period), issueDate: period.issueDate, dueDate: period.dueDate});
    need(compiled.review.accepted && compiled.source.quote.sha256 === edition.quote.sha256 &&
      compiled.draft.totals.total === period.amount, 'AGREEMENT_QUOTE_CHANGED',
      'The original accepted quotation no longer matches this calendar edition.', 409);
    const reviewed = {agreementId: agreement.id, agreementVersion: agreement.version,
      customer: customerSnapshot(this.receivables._customer(agreement.customerId)),
      period: {id: period.id, startMonth: period.startMonth, endMonth: period.endMonth,
        startDate: period.startDate, endDate: period.endDate, periodCount: period.periodCount,
        issueDate: period.issueDate, dueDate: period.dueDate, editionId: edition.id, sourceId: source.id},
      invoiceDraft: compiled.draft, quoteReview: compiled.review};
    return {workspaceId: this._workspaceId(), revision: this.workspace.state.revision,
      agreementId: agreement.id, agreementVersion: agreement.version, period, customer: reviewed.customer,
      invoiceDraft: compiled.draft, quoteReview: compiled.review, previewSha256: previewIdentity(reviewed)};
  }
  async preview(id, {periodId, asOf = today()} = {}) {
    return this.workspace.serial(() => this._preview(this._agreement(id), periodId, asOf));
  }
  async bill(id, value) {
    const prepared = await this._mutate('billing_prepared', id, value, async (actor, requestId) => {
      const agreement = this._agreement(id); this._version(agreement, value);
      const preview = await this._preview(agreement, value.periodId), period = preview.period;
      need(preview.previewSha256 === value.previewSha256, 'AGREEMENT_PREVIEW_CHANGED',
        'Review the current agreement period and its original invoice draft before preparing it.', 409);
      need(!agreement.billings.some(row => row.startMonth < period.endMonth && row.endMonth > period.startMonth &&
        billingOccupied(row, this.receivables.data())), 'AGREEMENT_PERIOD_ALREADY_BILLED',
        'This service period already has an invoice or retained billing request. Reopen that original request.', 409);
      const billingId = randomUUID();
      agreement.billings.push({id: billingId, requestId, actor, createdAt: at(), invoiceRequestId: 'agreement-bill:' + billingId,
        periodId: period.id, startMonth: period.startMonth, endMonth: period.endMonth, editionId: period.editionId,
        sourceId: period.sourceId, periodLabel: periodLabel(agreement, period),
        issueDate: period.issueDate, dueDate: period.dueDate, periodCount: period.periodCount,
        request: requestContent(value),
        preview: {invoiceDraft: clone(preview.invoiceDraft), quoteReview: clone(preview.quoteReview),
          customer: clone(preview.customer), previewSha256: preview.previewSha256}});
      agreement.history.push({at: at(), actor, action: 'billing_prepared', billingId,
        startDate: period.startDate, endDate: period.endDate, periodCount: period.periodCount});
      agreement.version++; agreement.updatedAt = at(); return {agreementId: id, billingId};
    });
    if (prepared.invoice) return prepared;
    // The complete request is durable before native import. Its original invoice
    // journal is the durable link, so an uncertain reply needs no second draft.
    const record = prepared.billing;
    const source = prepared.agreement.sources.find(row => row.id === record.sourceId);
    try {
      const originals = await this.workspace.serial(() => sourceBodies(this.workspace, source));
      const invoice = await this.receivables.importQuote({...originals, revision: prepared.revision, actor: record.actor,
        requestId: record.invoiceRequestId, customerId: prepared.agreement.customerId,
        currencyScale: prepared.agreement.currency.scale, scope: 'RECURRING', periodCount: record.periodCount,
        periodLabel: record.periodLabel, issueDate: record.issueDate, dueDate: record.dueDate});
      return this.workspace.serial(async () => ({...this._result({agreementId: id, billingId: record.id}),
        operation: prepared.operation, invoiceOperation: invoice.operation}));
    } catch (error) {
      error.details = {...error.details, agreementBillingPrepared: true, billingId: record.id, requestId: record.requestId};
      throw error;
    }
  }
  async sourceFile(id, sourceId, name) {
    return this.workspace.serial(() => readSourceFile(this.workspace, this._source(this._agreement(id), sourceId), name));
  }
  async exportAgreement(id, {asOf = today()} = {}) {
    return this.workspace.serial(async () => {
      const original = this._agreement(id), agreement = this._view(original, asOf), invoiceRows = [], invoiceIds = new Set();
      for (const billing of original.billings) {
        const invoice = linkedInvoice(billing, this.receivables.data());
        if (invoice && !invoiceIds.has(invoice.id)) { invoiceIds.add(invoice.id); invoiceRows.push(clone(invoice)); }
      }
      const value = {schema: AGREEMENT_EXPORT_SCHEMA, workspaceId: this._workspaceId(),
        revision: this.workspace.state.revision, asOf, agreement, invoices: invoiceRows,
        recovery: 'Use the original merchant-accounting-workspace encrypted backup and restore commands to receive the complete editable accounting workspace.'};
      const files = [
        {name: 'agreement.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json(value))},
        {name: 'schedule.csv', type: 'text/csv; charset=utf-8', bytes: Buffer.from(scheduleCsv(agreement, agreement.periods))},
        {name: 'agreement.html', type: 'text/html; charset=utf-8', bytes: Buffer.from(agreementHtml(agreement, agreement.periods, asOf))}];
      for (const source of original.sources) for (const name of SOURCE_NAMES) {
        if (!source.files[name]) continue;
        const file = await readSourceFile(this.workspace, source, name); files.push({...file, name: 'source-' + source.id + '-' + name});
      }
      for (const invoice of invoiceRows) {
        files.push({name: 'invoice-' + invoice.id + '-record.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json(invoice))});
        if (invoice.document) for (const name of ['invoice.json', 'invoice.html', 'invoice.csv', 'manifest.json', 'status.json']) {
          const file = await this.receivables._file(invoice.id, name); files.push({...file, name: 'invoice-' + invoice.id + '-' + name});
        }
      }
      files.push({name: 'files.json', type: 'application/json; charset=utf-8', bytes: Buffer.from(json({
        schema: AGREEMENT_EXPORT_SCHEMA, agreementId: id,
        files: files.map(file => ({name: file.name, bytes: file.bytes.length, sha256: sha(file.bytes)}))}))});
      return {workspaceId: this._workspaceId(), revision: this.workspace.state.revision, agreementId: id, value, files};
    });
  }
}
