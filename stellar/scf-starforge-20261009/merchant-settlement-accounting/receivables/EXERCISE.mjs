#!/usr/bin/env node
// MIT. One real private-file lifecycle exercise; Node 22+, no network or hosted CI.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {ReceivablesWorkspace} from './store.mjs';
import {createReceivablesServer} from './server.mjs';
import {json, sha} from './core.mjs';
import {newCommissioning} from '../../sf74-merchant-support-console/commissioning.mjs';
import {commercialContext, emptyCommercialDraft, reviewCommercialQuote, sealCommercialQuote,
  makeCommercialDocument} from '../../sf74-merchant-support-console/commercial-quote.mjs';
import {canonical as commercialCanonical} from '../../sf74-merchant-support-console/commercial-pricing.mjs';

function sourceStrKey(version, fill) {
  const bytes = Buffer.alloc(35, fill); bytes[0] = version;
  let crc = 0;
  for (const byte of bytes.subarray(0, 33)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 65535;
  }
  bytes[33] = crc & 255; bytes[34] = crc >> 8;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let result = '', bits = 0, acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(acc >>> bits) & 31]; }
    acc &= (1 << bits) - 1;
  }
  return result;
}

async function originalQuoteInputs(customer, actor) {
  // Exercise input goes through the original producer model and document factory.
  const sourceWorkspace = {commissioning: newCommissioning()}, caseId = randomUUID();
  const context = await commercialContext(sourceWorkspace, {caseId, workspaceId: 'local-receivables-quotation',
    revision: sha(json(sourceWorkspace))});
  const draft = emptyCommercialDraft();
  draft.title = 'Native receivables quotation';
  draft.customer = {name: customer.name, contact: customer.email ?? ''};
  draft.implementation.lines = [{id: 'implementation-hours', taskId: null, title: 'Implementation hours',
    hours: '1.25', rateUsd: '80'}];
  draft.service.lines = [{id: 'recurring-service', commitmentId: null, title: 'Monthly service',
    quantity: '1', unitUsd: '25.123456'}];
  draft.terms = {scope: 'Local software exercise of quote-based invoicing',
    deliverables: 'Retained invoice drafts and complete original quotation files',
    exclusions: '', payment: 'The selected once-only fee or explicit monthly periods',
    acceptance: 'Local operator receiving inside this software exercise'};
  const review = reviewCommercialQuote(context, draft), quoteId = randomUUID(), createdAt = '2026-01-01T00:00:00.000Z';
  const quote = sealCommercialQuote({id: quoteId, createdAt, draft, review});
  const publishArgs = {id: caseId, expectedRevision: context.revision, requestId: quoteId,
    actor, draft, reviewSha256: review.reviewSha256, parentId: null};
  const originalQuote = makeCommercialDocument({kind: 'QUOTE', requestId: quoteId, caseId, createdAt,
    request: {action: 'publish', actor,
      sha256: sha(commercialCanonical({action: 'publish', args: publishArgs}))}, payload: quote});
  const responseId = randomUUID(), observedAt = '2026-01-01T00:01:00.000Z';
  const response = {quoteId, quoteSha256: quote.sha256, status: 'ACCEPTED', observedAt,
    source: 'urn:stellar-forge:local-receivables-exercise:operator-receiving',
    note: 'Controlled local software-exercise receiving'};
  const receiveArgs = {id: caseId, expectedRevision: context.revision, requestId: responseId, actor, ...response};
  const originalResponse = makeCommercialDocument({kind: 'RESPONSE', requestId: responseId, caseId,
    createdAt: observedAt, request: {action: 'receive', actor,
      sha256: sha(commercialCanonical({action: 'receive', args: receiveArgs}))}, payload: response});
  return {quote, quoteContent: json(originalQuote), responseContent: json(originalResponse)};
}

const root = await mkdtemp(join(process.env.SCF_RECEIVABLES_TMP ?? tmpdir(), 'receivables-'));
let workspace, running;
try {
  const directory = join(root, 'accounting'), outboxDir = join(root, 'outbox'), proofDir = join(root, 'proofs'), termsFile = join(root, 'terms.json');
  await mkdir(outboxDir, {mode: 0o700}); await mkdir(proofDir, {mode: 0o700});
  await writeFile(termsFile, json({schema: 'stellar-forge.merchant-accounting-terms.v1', routes: [{
    routeId: 'exercise', method: 'GET', network: 'stellar:testnet', asset: sourceStrKey(16, 1), payTo: sourceStrKey(48, 2),
    amountAtomic: '1000000', unitPriceUsd: '1', unitCostUsd: null, priceBasis: 'Local software exercise'
  }]}), {mode: 0o600});
  workspace = await openAccountingWorkspace({directory, outboxDir, proofDir, termsFile});
  let r = await new ReceivablesWorkspace(workspace).init();
  const actor = 'Local receivables exercise', request = values => ({revision: workspace.state.revision, actor, requestId: randomUUID(), ...values});
  const customer = (await r.saveCustomer({revision: workspace.state.revision, actor, reference: 'EXERCISE', name: 'Exercise customer',
    email: '', address: 'Local exercise', note: 'Private operator note'})).customer;
  await r.settings(request({name: 'Exercise merchant', invoicePrefix: 'EX', creditPrefix: 'CR'}));
  const currency = {code: 'USD', scale: 2}, draft = {customerId: customer.id, currency,
    issueDate: '2026-01-01', dueDate: '2026-01-31', lines: [
      {id: 'service', description: 'Service hours', quantity: '2.5', unitAmount: '40.00', discountAmount: '10.00', taxAmount: '9.00'},
      {id: 'setup', description: 'Setup', quantity: '1', unitAmount: '25.00', taxAmount: '0'}
    ], note: 'Customer-visible note'};
  const draftRequest = request(draft), saved = await r.saveDraft(draftRequest), invoiceId = saved.invoice.id;
  assert.equal(saved.invoice.total, '124.00');
  const duplicate = await r.saveDraft(draftRequest);
  assert.equal(duplicate.invoice.id, invoiceId); assert.equal(duplicate.operation.replayed, true);
  const privateDraft = await r.exportCustomer(customer.id, {asOf: '2026-02-01'});
  assert.equal(privateDraft.value.invoices.length, 0);
  const preview = await r.preview(invoiceId);
  const issued = await r.issue(invoiceId, request({expectedVersion: preview.expectedVersion, previewSha256: preview.previewSha256}));
  assert.match(issued.invoice.number, /^EX-2026-000001$/);
  const original = await r.file(invoiceId, 'invoice.json'), originalHash = sha(original.bytes);
  assert.match((await r.file(invoiceId, 'invoice.html')).bytes.toString(), /Discount/);
  const receipt = (await r.receipt(request({customerId: customer.id, currency, amount: '200.00',
    receivedDate: '2026-01-02', method: 'Bank transfer', reference: 'LOCAL-EXERCISE-1', note: 'Private payment note'}))).receipt;
  const first = await r.allocate(request({invoiceId, receiptId: receipt.id, amount: '100.00', allocatedDate: '2026-01-02'}));
  assert.equal(first.invoice.amountDue, '24.00');
  assert.equal(first.receipt.available, '100.00');
  const credited = await r.credit(invoiceId, request({creditDate: '2026-01-03', reason: 'Agreed adjustment',
    lines: [{invoiceLineId: 'service', netAmount: '10.00', taxAmount: '1.00'}]}));
  assert.equal(credited.invoice.amountDue, '13.00');
  await assert.rejects(r.credit(invoiceId, request({creditDate: '2026-01-03', reason: 'Excess',
    lines: [{invoiceLineId: 'service', netAmount: '100.00', taxAmount: '0'}]})), {code: 'CREDIT_EXCEEDS_INVOICE_LINE'});
  const last = await r.allocate(request({invoiceId, receiptId: receipt.id, amount: '13.00', allocatedDate: '2026-01-04'}));
  assert.equal(last.invoice.paymentStatus, 'PAID');
  await r.release(first.allocation.id, request({releasedDate: '2026-02-01', reason: 'Correct the payment allocation'}));
  assert.equal((await r.detail(invoiceId, {asOf: '2026-01-31'})).invoice.amountDue, '0.00');
  const later = await r.detail(invoiceId, {asOf: '2026-02-02'});
  assert.equal(later.invoice.amountDue, '100.00'); assert.equal(later.invoice.overdueDays, 2);
  await r.allocate(request({invoiceId, receiptId: receipt.id, amount: '100.00', allocatedDate: '2026-02-02'}));
  assert.equal(sha((await r.file(invoiceId, 'invoice.json')).bytes), originalHash);

  // Future allocations must conserve the same receipt across every historical interval.
  const secondDraft = await r.saveDraft(request({...draft, lines: [{id: 'other', description: 'Other service', quantity: '1', unitAmount: '100.00'}]}));
  const secondPreview = await r.preview(secondDraft.invoice.id);
  await r.issue(secondDraft.invoice.id, request({expectedVersion: secondPreview.expectedVersion, previewSha256: secondPreview.previewSha256}));
  const futureReceipt = (await r.receipt(request({customerId: customer.id, currency, amount: '100.00', receivedDate: '2026-01-02',
    method: 'Bank transfer', reference: 'LOCAL-EXERCISE-2'}))).receipt;
  await r.allocate(request({invoiceId: secondDraft.invoice.id, receiptId: futureReceipt.id, amount: '100.00', allocatedDate: '2026-03-01'}));
  await assert.rejects(r.allocate(request({invoiceId: secondDraft.invoice.id, receiptId: futureReceipt.id,
    amount: '1.00', allocatedDate: '2026-02-01'})), {code: 'RECEIPT_ALREADY_ALLOCATED'});

  const exported = await r.exportCustomer(customer.id, {asOf: '2026-03-02'});
  assert.equal(exported.value.invoices.length, 2);
  assert.ok(exported.files.some(file => file.name.startsWith('documents/')));
  const account = exported.files.find(file => file.name === 'account.json').bytes.toString();
  assert.ok(!account.includes('Private payment note') && !account.includes('Private operator note'));
  const quotation = await originalQuoteInputs(customer, actor);
  const quoteInput = {customerId: customer.id, quoteContent: quotation.quoteContent,
    issueDate: '2026-04-01', dueDate: '2026-04-30', currencyScale: 2};
  const oneTime = await r.importQuote(request({...quoteInput, scope: 'IMPLEMENTATION'}));
  assert.equal(oneTime.invoice.total, '100.00');
  const oneTimeDetail = await r.detail(oneTime.invoice.id);
  assert.equal(oneTimeDetail.sourceQuote.review.accepted, false);
  assert.equal(oneTimeDetail.sourceQuote.review.selection.periodUnit, 'ONCE');
  await assert.rejects(r.importQuote(request({...quoteInput, scope: 'IMPLEMENTATION',
    periodLabel: 'Different display label'})), {code: 'QUOTE_SCOPE_ALREADY_IMPORTED'});
  const recurring = await r.importQuote(request({...quoteInput, responseContent: quotation.responseContent,
    scope: 'RECURRING', periodCount: 3, periodLabel: 'April through June 2026'}));
  assert.equal(recurring.invoice.total, '75.37');
  const recurringDetail = await r.detail(recurring.invoice.id);
  assert.equal(recurringDetail.sourceQuote.review.accepted, true);
  assert.equal(recurringDetail.sourceQuote.review.selection.periodCount, 3);
  assert.equal(recurringDetail.sourceQuote.review.totals.selectedAmountUsd, '75.370368');
  assert.equal(recurringDetail.sourceQuote.review.totals.roundingDifferenceUsd, '-0.000368');
  assert.equal(sha((await r.quoteFile(recurring.invoice.id, 'quote.json')).bytes), sha(quotation.quoteContent));
  assert.equal(sha((await r.quoteFile(recurring.invoice.id, 'response.json')).bytes), sha(quotation.responseContent));
  assert.equal((await r.exportCustomer(customer.id, {asOf: '2026-05-01'})).value.invoices.length, 2);

  const before = workspace.state.revision;
  await workspace.close(); workspace = null;
  workspace = await openAccountingWorkspace({directory});
  r = await new ReceivablesWorkspace(workspace).init();
  assert.equal(workspace.state.revision, before);
  assert.equal(sha((await r.quoteFile(recurring.invoice.id, 'quote.json')).bytes), sha(quotation.quoteContent));
  assert.equal((await r.detail(invoiceId, {asOf: '2026-03-02'})).invoice.paymentStatus, 'PAID');
  running = await createReceivablesServer({workspace, port: 0});
  const origin = new URL(running.url).origin, response = await fetch(origin + '/api/receivables/state');
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.revision, workspace.state.revision);
  const page = await fetch(running.url);
  assert.equal(page.status, 200); assert.match(await page.text(), /Receivables|receivables/);
  const savedState = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
  assert.equal(savedState.receivables.invoices.length, 4);
  console.log(JSON.stringify({schema: 'stellar-forge.merchant-receivables-exercise.v1', result: 'PASS',
    invoices: 4, issuedInvoices: 2, importedQuoteDrafts: 2, originalQuoteSha256: quotation.quote.sha256, originalInvoiceSha256: originalHash, revision: savedState.revision,
    checks: ['native workspace', 'exact invoice arithmetic', 'request replay', 'private draft export', 'frozen issue files',
      'credit limits', 'partial and excess payment', 'dated allocation release', 'historical aging', 'future allocation conservation',
      'customer account files', 'original SF74 quotation model', 'once-only scope and duplicate rejection',
      'explicit recurring periods and rounding', 'original response material binding', 'retained quote files after reopen',
      'native reopen', 'HTTP state and operator page']}, null, 2));
} finally {
  await running?.close().catch(() => {});
  await workspace?.close().catch(() => {});
  await rm(root, {recursive: true, force: true});
}
