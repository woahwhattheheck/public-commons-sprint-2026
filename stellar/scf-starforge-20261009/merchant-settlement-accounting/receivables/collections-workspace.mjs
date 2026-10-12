// MIT. Collections casework uses the original accounting writer and request journal.
import {randomUUID} from 'node:crypto';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {need, field, identifier, dateValue, currencyOf, minor, invoiceSummary, json, today} from './core.mjs';
import {COLLECTION_CASE_SCHEMA, collectionRows, collectionTerms, collectionDate, projectCollection,
  normalizeCollectionActivity, collectionsReport, collectionReminder, collectionsCsv, collectionCaseFiles} from './collections.mjs';

const now = () => new Date().toISOString();
export class CollectionsWorkspace {
  constructor(receivables) { this.receivables = receivables; this.workspace = receivables.workspace; }
  workspaceId() { return accountingWorkspaceBinding(this.workspace.directory, this.workspace.state).workspaceId; }
  guard(value) {
    need(value?.workspaceId === this.workspaceId(), 'COLLECTION_WORKSPACE_CHANGED',
      'Reopen the original accounting workspace for this retained case request.', 409);
  }
  row(id) {
    identifier(id, 'collection case');
    const row = collectionRows(this.receivables.data()).find(item => item.id === id);
    need(row, 'COLLECTION_CASE_NOT_FOUND', 'Choose an existing collection case.', 404);
    return row;
  }
  summary(id, asOf = today()) { return projectCollection(this.row(id), this.receivables.data(), asOf); }
  expected(row, value) {
    need(value.expectedVersion === row.version, 'STALE_COLLECTION_CASE',
      'The case changed. Reopen its current history before saving the retained edit.', 409);
  }
  append(row, actor, event) {
    const saved = {id: randomUUID(), recordedAt: now(), actor, ...event};
    row.events.push(saved); row.version++; row.updatedAt = saved.recordedAt; return saved;
  }
  async list(query = {}) {
    return this.workspace.serial(async () => ({...collectionsReport(this.receivables.data(), query),
      revision: this.workspace.state.revision, workspaceId: this.workspaceId()}));
  }
  async detail(id, query = {}) {
    return this.workspace.serial(async () => {
      const row = this.row(id), asOf = query.asOf ?? today();
      return {collectionCase: this.summary(id, asOf), record: structuredClone(row),
        revision: this.workspace.state.revision, workspaceId: this.workspaceId()};
    });
  }
  async save(value) {
    this.guard(value);
    return this.receivables._mutate('collection_case_saved', value, async (data, actor) => {
      const effectiveDate = dateValue(value.effectiveDate, 'case effective date'), terms = collectionTerms(value);
      need(terms.nextActionDate >= effectiveDate, 'INVALID_COLLECTION_FOLLOW_UP',
        'Choose a next follow-up date on or after this effective date.');
      let row;
      if (value.id) {
        row = this.row(value.id); this.expected(row, value); collectionDate(row, effectiveDate);
        need(this.summary(row.id, effectiveDate).status === 'OPEN', 'COLLECTION_CASE_CLOSED',
          'Reopen the closed case before changing its assignment.', 409);
        this.append(row, actor, {kind: 'UPDATE', effectiveDate, terms,
          note: field(value.note ?? '', 'assignment note', 6000, true)});
      } else {
        const invoice = this.receivables._invoice(value.invoiceId);
        need(invoice.status === 'ISSUED' && invoice.document, 'COLLECTION_ISSUED_INVOICE_REQUIRED',
          'Open a collection case for an issued invoice.', 409);
        const original = invoiceSummary(invoice, data, effectiveDate);
        need(original.issueDate <= effectiveDate && minor(original.amountDue, original.currency) > 0n,
          'COLLECTION_OUTSTANDING_INVOICE_REQUIRED', 'Choose an invoice with a balance on this effective date.');
        const duplicate = collectionRows(data).find(item => item.invoiceId === invoice.id);
        need(!duplicate, 'COLLECTION_CASE_EXISTS', 'This invoice already has a retained case. Open or reopen it.', 409);
        row = {schema: COLLECTION_CASE_SCHEMA, id: randomUUID(), version: 0, invoiceId: invoice.id,
          customerId: original.customerId, currency: currencyOf(original.currency), openedDate: effectiveDate,
          createdAt: now(), createdBy: actor, events: []};
        this.append(row, actor, {kind: 'OPEN', effectiveDate, terms, invoiceBasis: original,
          note: field(value.note ?? '', 'opening note', 6000, true)});
        (data.collectionCases ??= []).push(row);
      }
      return {collectionCaseId: row.id, collectionAsOf: effectiveDate};
    });
  }
  async activity(id, value) {
    this.guard(value); identifier(id, 'collection case');
    return this.receivables._mutate('collection_activity_recorded', {...value, collectionCaseId: id}, async (data, actor) => {
      const row = this.row(id); this.expected(row, value);
      const effectiveDate = collectionDate(row, value.effectiveDate), summary = this.summary(id, effectiveDate);
      need(summary.status === 'OPEN' || ['NOTE', 'CONTACT'].includes(value.kind),
        'COLLECTION_CASE_CLOSED', 'Reopen the case before recording a new promise or dispute.', 409);
      const event = normalizeCollectionActivity({...value, effectiveDate}, summary);
      const saved = this.append(row, actor, event);
      return {collectionCaseId: row.id, collectionEventId: saved.id, collectionAsOf: effectiveDate};
    });
  }
  async transition(id, value, kind) {
    this.guard(value); identifier(id, 'collection case');
    need(['CLOSE', 'REOPEN'].includes(kind), 'INVALID_COLLECTION_TRANSITION', 'Choose Close or Reopen.');
    return this.receivables._mutate('collection_case_' + kind.toLowerCase(), {...value, collectionCaseId: id}, async (data, actor) => {
      const row = this.row(id); this.expected(row, value);
      const effectiveDate = collectionDate(row, value.effectiveDate), current = this.summary(id, effectiveDate);
      need(current.status === (kind === 'CLOSE' ? 'OPEN' : 'CLOSED'), 'COLLECTION_STATUS_CHANGED',
        kind === 'CLOSE' ? 'The case is already closed.' : 'The case is already open.', 409);
      const event = {kind, effectiveDate, note: field(value.note, 'case reason', 6000)};
      if (kind === 'REOPEN') {
        event.nextActionDate = dateValue(value.nextActionDate, 'next follow-up date');
        need(event.nextActionDate >= effectiveDate, 'INVALID_COLLECTION_FOLLOW_UP',
          'Choose a next follow-up date on or after reopening.');
      }
      this.append(row, actor, event);
      return {collectionCaseId: row.id, collectionAsOf: effectiveDate};
    });
  }
  async reminder(id, query = {}) {
    return this.workspace.serial(async () => {
      const summary = this.summary(id, query.asOf ?? today());
      return {...collectionReminder(summary, this.receivables.data().issuer),
        revision: this.workspace.state.revision, workspaceId: this.workspaceId()};
    });
  }
  async file(id, name, query = {}) {
    return this.workspace.serial(async () => {
      const row = this.row(id), asOf = dateValue(query.asOf ?? today(), 'export date');
      need(name !== 'reminder.txt' || asOf >= row.openedDate, 'COLLECTION_CASE_FUTURE',
        'Use a date on or after this case opened.');
      const files = collectionCaseFiles(row, this.receivables.data(), asOf, this.receivables.data().issuer);
      const selected = files.find(file => file.name === name);
      need(selected, 'COLLECTION_FILE_NOT_FOUND', 'Choose an available case export or reminder file.', 404);
      return selected;
    });
  }
  async reportFile(name, query = {}) {
    return this.workspace.serial(async () => {
      const report = {...collectionsReport(this.receivables.data(), query),
        revision: this.workspace.state.revision, workspaceId: this.workspaceId()};
      need(['collections.json', 'collections.csv'].includes(name), 'COLLECTION_FILE_NOT_FOUND',
        'Choose the complete collections JSON or CSV report.', 404);
      return {name, type: name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        bytes: Buffer.from(name.endsWith('.csv') ? collectionsCsv(report) : json(report))};
    });
  }
  async operation(requestId) {
    return this.workspace.serial(async () => {
      const id = field(requestId, 'request ID', 160);
      const saved = this.receivables.data().requests.find(row => row.id === id && row.action.startsWith('collection_'));
      return {workspaceId: this.workspaceId(), revision: this.workspace.state.revision,
        operation: saved ? structuredClone(saved) : null,
        ...(saved ? this.receivables._result(saved.result) : {})};
    });
  }
}
