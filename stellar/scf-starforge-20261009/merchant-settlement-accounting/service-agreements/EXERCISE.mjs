#!/usr/bin/env node
// MIT. One complete local operator journey over original accounting and quote producers.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {ReceivablesWorkspace} from '../receivables/store.mjs';
import {json, sha} from '../receivables/core.mjs';
import {ServiceAgreementWorkspace} from './store.mjs';
import {createServiceAgreementsServer} from './server.mjs';
import {createServiceAgreementClient} from './client.mjs';
import {monthDate} from './core.mjs';
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

async function originalQuoteInputs(customer, actor, monthlyRate = '25.123456') {
  // Exercise input goes through the original producer model and document factory.
  const sourceWorkspace = {commissioning: newCommissioning()}, caseId = randomUUID();
  const context = await commercialContext(sourceWorkspace, {caseId, workspaceId: 'local-service-agreement-quotation',
    revision: sha(json(sourceWorkspace))});
  const draft = emptyCommercialDraft();
  draft.title = 'Native service agreement quotation';
  draft.customer = {name: customer.name, contact: customer.email ?? ''};
  draft.implementation.lines = [{id: 'implementation-hours', taskId: null, title: 'Implementation hours',
    hours: '1.25', rateUsd: '80'}];
  draft.service.lines = [{id: 'recurring-service', commitmentId: null, title: 'Monthly service',
    quantity: '1', unitUsd: monthlyRate}];
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
    source: 'urn:stellar-forge:local-service-agreements-exercise:operator-receiving',
    note: 'Controlled local software-exercise receiving'};
  const receiveArgs = {id: caseId, expectedRevision: context.revision, requestId: responseId, actor, ...response};
  const originalResponse = makeCommercialDocument({kind: 'RESPONSE', requestId: responseId, caseId,
    createdAt: observedAt, request: {action: 'receive', actor,
      sha256: sha(commercialCanonical({action: 'receive', args: receiveArgs}))}, payload: response});
  return {quote, quoteContent: json(originalQuote), responseContent: json(originalResponse)};
}

const root = await mkdtemp(join(process.env.SCF_AGREEMENTS_TMP ?? tmpdir(), 'service-agreements-'));
let workspace, running;
try {
  const directory = join(root, 'accounting'), outboxDir = join(root, 'outbox'), proofDir = join(root, 'proofs'),
    termsFile = join(root, 'terms.json');
  await mkdir(outboxDir, {mode: 0o700}); await mkdir(proofDir, {mode: 0o700});
  await writeFile(termsFile, json({schema: 'stellar-forge.merchant-accounting-terms.v1', routes: [{
    routeId: 'exercise', method: 'GET', network: 'stellar:testnet', asset: sourceStrKey(16, 1), payTo: sourceStrKey(48, 2),
    amountAtomic: '1000000', unitPriceUsd: '1', unitCostUsd: null, priceBasis: 'Local software exercise'
  }]}), {mode: 0o600});
  workspace = await openAccountingWorkspace({directory, outboxDir, proofDir, termsFile});
  let r = await new ReceivablesWorkspace(workspace).init();
  let a = await new ServiceAgreementWorkspace(workspace, {receivables: r}).init();
  const actor = 'Local service agreement operator', request = values => ({
    revision: workspace.state.revision, actor, requestId: randomUUID(), ...values});
  const customer = (await r.saveCustomer({revision: workspace.state.revision, actor,
    reference: 'AGREEMENT-EXERCISE', name: 'Agreement exercise customer', email: '',
    address: 'Local exercise', note: 'Original saved accounting customer'})).customer;
  await r.settings(request({name: 'Agreement exercise merchant', invoicePrefix: 'SA', creditPrefix: 'CR'}));
  const originals = await originalQuoteInputs(customer, actor);
  const createRequest = request({reference: 'SA-2026-001', title: 'Dated service agreement',
    customerId: customer.id, startDate: '2026-01-31', termMonths: 5, billingMonths: 3,
    invoiceTiming: 'START', dueDays: 30, currencyScale: 2,
    quoteContent: originals.quoteContent, responseContent: originals.responseContent});
  await assert.rejects(a.create({...createRequest, workspaceId: 'different-workspace'}),
    error => error.code === 'AGREEMENT_WORKSPACE_CHANGED');
  const created = await a.create(createRequest), id = created.agreementId;
  assert.equal((await a.create(createRequest)).agreementId, id);
  assert.equal(monthDate('2026-01-31', 1), '2026-02-28');
  assert.equal(monthDate('2026-01-31', 2), '2026-03-31');
  assert.deepEqual(created.agreement.periods.map(row => [row.id, row.periodCount, row.amount]),
    [['p-0-3', 3, '75.37'], ['p-3-5', 2, '50.25']]);
  const preview = await a.preview(id, {periodId: 'p-0-3', asOf: '2026-02-01'});
  const billRequest = request({expectedVersion: preview.agreementVersion, periodId: preview.period.id,
    previewSha256: preview.previewSha256});
  // Interrupt the original invoice import after the service request has been retained.
  const importQuote = r.importQuote.bind(r);
  let interrupted = false;
  r.importQuote = async () => { interrupted = true; throw Object.assign(new Error('Controlled interruption after retained service request'),
    {code: 'LOCAL_EXERCISE_INTERRUPTION', status: 409}); };
  await assert.rejects(a.bill(id, billRequest), error =>
    error.details?.agreementBillingPrepared === true && error.details.requestId === billRequest.requestId);
  r.importQuote = importQuote;
  assert.equal(interrupted, true);
  const pending = await a.preview(id, {periodId: 'p-0-3'});
  assert.equal(pending.period.status, 'PREPARING');
  assert.equal(pending.recoveryRequest.requestId, billRequest.requestId);
  await workspace.close(); workspace = null;
  workspace = await openAccountingWorkspace({directory});
  r = await new ReceivablesWorkspace(workspace).init();
  a = await new ServiceAgreementWorkspace(workspace, {receivables: r}).init();
  const recoveredRequest = (await a.preview(id, {periodId: 'p-0-3'})).recoveryRequest;
  const reorderedRequest = Object.fromEntries(Object.entries(recoveredRequest).reverse());
  const billed = await a.bill(id, {...reorderedRequest, revision: workspace.state.revision});
  const duplicate = await a.bill(id, {...billRequest, revision: workspace.state.revision});
  assert.equal(duplicate.invoice.id, billed.invoice.id);
  assert.equal(r.data().invoices.length, 1);
  const invoicePreview = await r.preview(billed.invoice.id);
  const issued = await r.issue(billed.invoice.id, request({expectedVersion: invoicePreview.expectedVersion,
    previewSha256: invoicePreview.previewSha256}));
  const invoiceHash = sha((await r.file(issued.invoice.id, 'invoice.json')).bytes);
  const finalPreview = await a.preview(id, {periodId: 'p-3-5'});
  await a.bill(id, request({expectedVersion: finalPreview.agreementVersion,
    periodId: finalPreview.period.id, previewSha256: finalPreview.previewSha256}));
  const beforeRenewal = await a.detail(id);
  const renewed = await a.renew(id, request({expectedVersion: beforeRenewal.agreement.version,
    additionalMonths: 4, reason: 'Original operator renewal at the five-month boundary'}));
  assert.deepEqual(renewed.agreement.periods.map(row => row.id), ['p-0-3','p-3-5','p-5-8','p-8-9']);
  assert.equal(renewed.agreement.periods[1].status, 'DRAFT');
  assert.equal(renewed.agreement.periods[1].amount, '50.25');
  const replacement = await originalQuoteInputs(customer, actor, '40');
  const amended = await a.amend(id, request({expectedVersion: renewed.agreement.version, effectiveDate: '2026-06-30',
    reason: 'Accepted service price for the renewal term', billingMonths: 2,
    quoteContent: replacement.quoteContent, responseContent: replacement.responseContent}));
  assert.deepEqual(amended.agreement.periods.map(row => [row.id, row.amount]),
    [['p-0-3','75.37'], ['p-3-5','50.25'], ['p-5-7','80.00'], ['p-7-9','80.00']]);
  await assert.rejects(a.cancel(id, request({expectedVersion: amended.agreement.version,
    effectiveDate: '2026-04-30', reason: 'Exercise of original billed-period protection'})),
    error => error.code === 'AGREEMENT_PERIOD_ALREADY_BILLED');
  const cancelled = await a.cancel(id, request({expectedVersion: amended.agreement.version,
    effectiveDate: '2026-08-31', reason: 'Retain the completed July and August service term'}));
  assert.deepEqual(cancelled.agreement.periods.map(row => row.id), ['p-0-3','p-3-5','p-5-7']);
  const source = await a.sourceFile(id, cancelled.agreement.sources[0].id, 'quote.json');
  assert.equal(source.bytes.toString('utf8'), originals.quoteContent);
  const exported = await a.exportAgreement(id, {asOf: '2026-09-01'});
  assert.equal(exported.value.agreement.status, 'CANCELLED');
  assert.equal(exported.value.invoices.length, 2);
  assert.equal(exported.files.find(file => file.name === 'invoice-' + issued.invoice.id + '-invoice.json')?.bytes.length > 0, true);
  assert.equal(sha((await r.file(issued.invoice.id, 'invoice.json')).bytes), invoiceHash);
  const originalRevision = workspace.state.revision;
  await workspace.close(); workspace = null;
  running = await createServiceAgreementsServer({directory, port: 0});
  const client = createServiceAgreementClient({baseUrl: new URL('/api/service-agreements', running.url).href, fetch});
  const reopened = await client.detail(id, {asOf: '2026-09-01'});
  assert.equal(reopened.agreement.version, cancelled.agreement.version);
  assert.equal(reopened.revision, originalRevision);
  for (const route of ['/service-agreements/','/service-agreements/app.mjs','/service-agreements/client.mjs','/receivables/']) {
    const response = await fetch(new URL(route, running.url));
    assert.equal(response.status, 200, route);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const download = await fetch(new URL('/api/service-agreements/agreements/' + id + '/export?format=tar', running.url));
  assert.equal(download.status, 200);
  assert.ok((await download.arrayBuffer()).byteLength > 1024);
  process.stdout.write(json({schema: 'stellar-forge.merchant-service-agreements-exercise.v1',
    result: 'complete', node: process.version, agreementId: id, invoices: reopened.agreement.billings.length,
    revision: reopened.revision, periods: reopened.periods.map(row => row.id), retainedSources: reopened.agreement.sources.length,
    workflows: ['original accepted SF74 quotation','dated calendar and whole-month prices','retained interruption and reopen',
      'native invoice issue','renewal preserves billed short cycle','accepted amendment','effective cancellation',
      'original files and full export','typed client and shared browser listener']}));
} finally {
  if (running) await running.close();
  if (workspace) await workspace.close();
  await rm(root, {recursive: true, force: true});
}
