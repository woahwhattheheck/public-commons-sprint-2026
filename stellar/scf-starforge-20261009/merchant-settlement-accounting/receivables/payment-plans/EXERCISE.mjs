#!/usr/bin/env node
// MIT. One complete native operator journey using the original accounting and receivables source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openAccountingWorkspace } from '../../workspace/store.mjs';
import { ReceivablesWorkspace } from '../store.mjs';
import { json } from '../core.mjs';
import { createReceivablesServer } from '../server.mjs';
import { PaymentPlanWorkspace } from './store.mjs';
import { PaymentPlansClient } from './client.mjs';

const OPERATION = 'SCF-PAYMENT-PLANS-3FC8-20261012';
const actor = 'payment-plan-operator-journey';
const asOf = { baseline:'2026-10-02', paid:'2026-10-03', credited:'2026-10-04', released:'2026-10-06', replanned:'2026-10-07', cancelled:'2026-10-08' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const root = await mkdtemp(join(resolve(process.env.SCF_PAYMENT_PLANS_TMP || tmpdir()), 'scf-payment-plans-'));
const directory = join(root, 'workspace');
const outputDirectory = join(root, 'receiving');
await mkdir(outputDirectory, { recursive:true });
const artifacts = [];
const steps = [];
let accounting;
let running;
const options = suffix => ({ revision: accounting.state.revision, actor, requestId: OPERATION + ':' + suffix });
function record(name, details = {}) { steps.push({name, ...details}); }
async function retain(name, bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const path = join(outputDirectory, name);
  await writeFile(path, content, {flag:'wx', mode:0o600});
  const item = {name, bytes:content.length, sha256:sha256(content)};
  artifacts.push(item);
  return item;
}
function usd(report) {
  const value = report.currencies.find(item => item.currency.code === 'USD' && item.currency.scale === 2);
  assert.ok(value, 'USD currency collection is present');
  return value;
}
async function snapshot(plans, planId, date, expected) {
  const detail = await plans.detail(planId, {asOf:date});
  const state = await plans.state({asOf:date, through:'2027-01-31'});
  const currency = usd(state.report);
  for (const [key,value] of Object.entries(expected.plan || {})) assert.equal(detail.plan[key], value, date + ' plan ' + key);
  for (const [key,value] of Object.entries(expected.currency || {})) assert.equal(currency[key], value, date + ' currency ' + key);
  record(date, {editionId: detail.plan.editionId, amountDue: currency.amountDue, scheduledOutstanding:detail.plan.scheduledOutstanding, unscheduled:currency.unscheduled});
  return {detail,state,currency};
}
async function frozenEdition(plans, planId, editionId, label) {
  const result = new Map();
  for (const name of ['schedule.json','schedule.csv','schedule.html','manifest.json']) {
    const file = await plans.scheduleFile(planId, editionId, name);
    const bytes = Buffer.from(file.bytes);
    assert.ok(bytes.length > 0, name + ' contains its frozen edition');
    result.set(name, bytes);
    await retain(label + '-' + name, bytes);
  }
  return result;
}
async function sameEdition(plans, planId, editionId, originals) {
  for (const [name,bytes] of originals) {
    const current = await plans.scheduleFile(planId, editionId, name);
    assert.deepEqual(Buffer.from(current.bytes), bytes, 'archived ' + editionId + '/' + name + ' is unchanged');
  }
}

// Original source input helper from receivables/EXERCISE.mjs blob033ae261caf720f1de950fb3273b35a8dd05598e.
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

try {
  const outboxDir = join(root,'outbox'), proofDir = join(root,'proofs'), termsFile = join(root,'terms.json');
  await mkdir(outboxDir,{mode:0o700});
  await mkdir(proofDir,{mode:0o700});
  await writeFile(termsFile,json({schema:'stellar-forge.merchant-accounting-terms.v1',routes:[{
    routeId:'exercise',method:'GET',network:'stellar:testnet',asset:sourceStrKey(16,1),payTo:sourceStrKey(48,2),
    amountAtomic:'1000000',unitPriceUsd:'1',unitCostUsd:null,priceBasis:'Local software exercise'
  }]}),{mode:0o600});
  accounting = await openAccountingWorkspace({directory,outboxDir,proofDir,termsFile});
  const receivables = await new ReceivablesWorkspace(accounting).init();
  const customer = (await receivables.saveCustomer({
    revision:accounting.state.revision,actor,reference:OPERATION,name:'Payment-plan customer',
    email:'',address:'Local exercise',note:'Private operator note'
  })).customer;
  const customerId = customer.id;
  await receivables.settings({...options('merchant-settings'),name:'Payment-plan merchant',invoicePrefix:'PP',creditPrefix:'CR'});
  record('original accounting workspace, customer and merchant',{customerId});

  const invoiceCreated = await receivables.saveDraft({
    ...options('invoice-draft'), customerId, currency:{code:'USD',scale:2},
    issueDate:'2026-10-01', dueDate:'2026-10-15',
    lines:[{id:'service',description:'Merchant service implementation',quantity:'1',unitAmount:'1200.00',discountAmount:'0.00',taxAmount:'0.00'}]
  });
  const invoiceId = invoiceCreated.invoice.id;
  const invoiceReview = await receivables.preview(invoiceId);
  await receivables.issue(invoiceId, {
    ...options('invoice-issue'), expectedVersion:invoiceReview.expectedVersion,
    previewSha256:invoiceReview.previewSha256
  });
  const invoiceDetail = await receivables.detail(invoiceId,{asOf:'2026-10-01'});
  const invoiceLineId = invoiceDetail.document.lines[0].id;
  const receipt = async (suffix, amount, date) => receivables.receipt({
    ...options(suffix), customerId, currency:{code:'USD',scale:2}, amount,
    receivedDate:date, method:'bank transfer', reference:OPERATION + ':' + suffix
  });
  const baselineReceipt = await receipt('receipt-baseline','200.00','2026-10-01');
  const baselineAllocation = await receivables.allocate({
    ...options('allocate-baseline'), invoiceId, receiptId:baselineReceipt.receipt.id,
    allocatedDate:'2026-10-01', amount:'200.00'
  });
  const plans = await new PaymentPlanWorkspace(accounting).init();
  const saveIntent = {
    ...options('plan-original-save'),
    plan:{
      invoiceId, balanceDate:asOf.baseline, title:'Four monthly installments',
      reference:OPERATION + ':customer-schedule', customerNote:'Pay the reference on the issued invoice.',
      installments:[
        {dueDate:'2026-10-15',amount:'250.00',label:'October'},
        {dueDate:'2026-11-15',amount:'250.00',label:'November'},
        {dueDate:'2026-12-15',amount:'250.00',label:'December'},
        {dueDate:'2027-01-15',amount:'250.00',label:'January'}
      ]
    }
  };
  const saved = await plans.savePlan(saveIntent);
  const planId = saved.plan.id;
  const review = await plans.previewPlan(planId);
  const activationIntent = {
    ...options('plan-original-activate'), expectedVersion:review.planVersion,
    reviewSha256:review.reviewSha256
  };
  const activated = await plans.activate(planId, activationIntent);
  const originalEditionId = activated.edition.id;
  const originalFiles = await frozenEdition(plans,planId,originalEditionId,'edition-1');
  const revisionBeforeReplay = accounting.state.revision;
  const replaySaved = await plans.savePlan(saveIntent);
  const replayActivated = await plans.activate(planId,activationIntent);
  assert.equal(replaySaved.operation.replayed,true);
  assert.equal(replayActivated.operation.replayed,true);
  assert.equal(replayActivated.edition.id,originalEditionId);
  assert.equal(accounting.state.revision,revisionBeforeReplay);
  const known = await plans.getOperation(saveIntent.requestId);
  const unknown = await plans.getOperation(OPERATION + ':unknown');
  assert.equal(known.operation.replayed,true);
  assert.equal(unknown.operation,null);
  await snapshot(plans,planId,asOf.baseline,{
    plan:{scheduledOutstanding:'1000.00',unscheduledAmount:'0.00'},
    currency:{amountDue:'1000.00',unscheduled:'0.00'}
  });
  record('save and activation replay',{revision:revisionBeforeReplay,originalEditionId});

  const laterReceipt = await receipt('receipt-later','300.00',asOf.paid);
  const laterAllocation = await receivables.allocate({
    ...options('allocate-later'),invoiceId,receiptId:laterReceipt.receipt.id,
    allocatedDate:asOf.paid,amount:'300.00'
  });
  const paid = await snapshot(plans,planId,asOf.paid,{
    plan:{scheduledOutstanding:'700.00',unscheduledAmount:'0.00'},
    currency:{amountDue:'700.00',unscheduled:'0.00'}
  });
  assert.equal(paid.detail.plan.installments[0].paid,'250.00');
  assert.equal(paid.detail.plan.installments[1].paid,'50.00');
  await receivables.credit(invoiceId,{
    ...options('credit'),creditDate:asOf.credited,reason:'Agreed service adjustment',
    lines:[{invoiceLineId,netAmount:'100.00',taxAmount:'0.00'}]
  });
  const credited = await snapshot(plans,planId,asOf.credited,{
    plan:{scheduledOutstanding:'600.00',unscheduledAmount:'0.00'},
    currency:{amountDue:'600.00',unscheduled:'0.00'}
  });
  assert.equal(credited.detail.plan.installments.at(-1).credited,'100.00');
  assert.equal(credited.detail.plan.installments.at(-1).remaining,'150.00');
  await receivables.release(baselineAllocation.allocation.id,{
    ...options('release-baseline'),releasedDate:'2026-10-05',reason:'Baseline allocation corrected'
  });
  await receivables.release(laterAllocation.allocation.id,{
    ...options('release-later'),releasedDate:asOf.released,reason:'Later allocation corrected'
  });
  await snapshot(plans,planId,asOf.released,{
    plan:{scheduledOutstanding:'900.00',unscheduledAmount:'200.00'},
    currency:{amountDue:'1100.00',unscheduled:'200.00'}
  });

  const generated = await plans.generate({
    invoiceId,balanceDate:asOf.replanned,firstDueDate:'2026-11-01',count:2,intervalDays:30,
    title:'Replacement agreement',reference:OPERATION + ':replacement'
  });
  assert.deepEqual(generated.draft.installments.map(row=>row.amount),['550.00','550.00']);
  const current = await plans.detail(planId,{asOf:asOf.replanned});
  await plans.savePlan({
    ...options('plan-replacement-save'),expectedVersion:current.plan.version,
    plan:{...generated.draft,id:planId}
  });
  const replacementReview = await plans.previewPlan(planId);
  const replacement = await plans.activate(planId,{
    ...options('plan-replacement-activate'),expectedVersion:replacementReview.planVersion,
    reviewSha256:replacementReview.reviewSha256
  });
  const replacementEditionId = replacement.edition.id;
  assert.notEqual(replacementEditionId,originalEditionId);
  const replacementFiles = await frozenEdition(plans,planId,replacementEditionId,'edition-2');
  const historical = await snapshot(plans,planId,asOf.credited,{
    plan:{scheduledOutstanding:'600.00',unscheduledAmount:'0.00'},
    currency:{amountDue:'600.00',unscheduled:'0.00'}
  });
  assert.equal(historical.detail.plan.editionId,originalEditionId);
  const replanned = await snapshot(plans,planId,asOf.replanned,{
    plan:{scheduledOutstanding:'1100.00',unscheduledAmount:'0.00'},
    currency:{amountDue:'1100.00',unscheduled:'0.00'}
  });
  assert.equal(replanned.detail.plan.editionId,replacementEditionId);
  const cancelCurrent = await plans.detail(planId,{asOf:asOf.cancelled});
  await plans.cancelPlan(planId,{
    ...options('plan-cancel'),expectedVersion:cancelCurrent.plan.version,
    cancelledDate:asOf.cancelled,reason:'Customer requested a revised agreement'
  });
  await snapshot(plans,planId,asOf.cancelled,{
    plan:{scheduledOutstanding:'0.00',unscheduledAmount:'1100.00'},
    currency:{amountDue:'1100.00',unscheduled:'1100.00'}
  });
  await sameEdition(plans,planId,originalEditionId,originalFiles);
  await sameEdition(plans,planId,replacementEditionId,replacementFiles);
  const collections = await plans.collectionsFiles({asOf:asOf.cancelled,through:'2027-01-31',customerId});
  assert.equal(usd(collections.report).unscheduled,'1100.00');
  for (const file of collections.files) await retain(file.name,Buffer.from(file.bytes));
  record('replacement and cancellation retain both archived editions',{originalEditionId,replacementEditionId});

  const beforeClose = await plans.state({asOf:asOf.cancelled,through:'2027-01-31',customerId});
  const workspaceId = beforeClose.workspaceId;
  const persistedRevision = accounting.state.revision;
  await accounting.close();
  accounting = undefined;

  running = await createReceivablesServer({directory,port:0,includeCustomerStatements:true});
  accounting = running.workspace;
  assert.equal(accounting.state.revision,persistedRevision);
  const reopened = await running.paymentPlans.state({asOf:asOf.cancelled,through:'2027-01-31',customerId});
  assert.equal(reopened.workspaceId,workspaceId);
  assert.deepEqual(reopened.report,beforeClose.report);
  await sameEdition(running.paymentPlans,planId,originalEditionId,originalFiles);
  await sameEdition(running.paymentPlans,planId,replacementEditionId,replacementFiles);
  record('disk close and original server reopen',{workspaceId,revision:persistedRevision});

  const base = new URL(running.url);
  const route = path => new URL(path,base);
  const api = '/api/receivables/payment-plans';
  const client = new PaymentPlansClient({baseUrl:route(api).href});
  const query = new URLSearchParams({asOf:asOf.cancelled,through:'2027-01-31',customerId});
  const get = async path => {
    const response = await fetch(route(path));
    assert.equal(response.status,200,path + ' returns 200');
    return response;
  };
  const httpState = await client.state({asOf:asOf.cancelled,through:'2027-01-31',customerId});
  assert.equal(httpState.workspaceId,workspaceId);
  assert.deepEqual(httpState.report,beforeClose.report);
  const page = await get('/payment-plans/');
  assert.match(page.headers.get('content-type'),/text\/html/);
  const html = await page.text();
  assert.match(html,/Payment plans/i);
  const config = await (await get('/payment-plans/config.json')).json();
  assert.equal(config.apiPath,api);
  assert.equal(config.uiPath,'/payment-plans');
  const post = async (path,value) => {
    const response = await fetch(route(path),{
      method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},
      body:JSON.stringify(value)
    });
    const result = await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    return {response,result};
  };
  const httpReplay = await post(api + '/plans/' + encodeURIComponent(planId) + '/activate',activationIntent);
  assert.equal(httpReplay.result.operation.replayed,true);
  assert.equal(httpReplay.result.edition.id,originalEditionId);
  assert.equal(httpReplay.response.headers.get('x-request-id'),activationIntent.requestId);
  const httpKnown = await client.getOperation(activationIntent.requestId);
  assert.equal(httpKnown.operation.replayed,true);
  const httpUnknown = await client.getOperation(OPERATION + ':http-unknown');
  assert.equal(httpUnknown.operation,null);
  const httpGenerated = await client.generate({
    invoiceId,balanceDate:'2026-10-09',firstDueDate:'2026-11-01',count:2,intervalDays:30,
    title:'Customer replacement proposal',reference:OPERATION + ':http-proposal'
  });
  assert.deepEqual(httpGenerated.draft.installments.map(row=>row.amount),['550.00','550.00']);
  for (const [editionId,files] of [[originalEditionId,originalFiles],[replacementEditionId,replacementFiles]]) {
    for (const [name,expected] of files) {
      const response = await client.scheduleFile(planId,editionId,name);
      assert.equal(response.status,200,'typed client receives the saved edition');
      assert.match(response.headers.get('content-disposition'),/attachment/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected,'HTTP frozen ' + editionId + '/' + name);
    }
  }
  const exportResponse = await get(api + '/collections/export?' + query + '&name=collections.csv');
  const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
  const directCsv = collections.files.find(file=>file.name==='collections.csv');
  assert.deepEqual(exportBytes,Buffer.from(directCsv.bytes));
  await retain('http-collections.csv',exportBytes);
  assert.equal(accounting.state.revision,persistedRevision);
  record('native HTTP startup, recovery, proposal and all saved downloads',{url:running.url,requestId:activationIntent.requestId});

  await running.close();
  running = undefined;
  accounting = undefined;
  const report = {
    schema:'stellar-forge.merchant-payment-plans-exercise.v1',operation:OPERATION,result:'PASS',
    runtime:{node:process.version,platform:process.platform,arch:process.arch},
    workspaceId,invoiceId,planId,originalEditionId,replacementEditionId,
    revision:persistedRevision,steps,artifacts,directory,outputDirectory
  };
  await writeFile(join(outputDirectory,'result.json'),JSON.stringify(report,null,2) + '\n',{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify(report,null,2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    schema:'stellar-forge.merchant-payment-plans-exercise.v1',operation:OPERATION,result:'FAIL',
    error:{name:error.name,code:error.code,message:error.message,stack:error.stack},
    steps,artifacts,directory,outputDirectory
  },null,2) + '\n');
  process.exitCode = 1;
} finally {
  if (running) await running.close();
  else if (accounting) await accounting.close();
}
