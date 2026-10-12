#!/usr/bin/env node
// MIT. One complete local invoice/credit/Xero-return/correction/reopen journey on the real workspace.
// Provider-shaped fixtures exercise the software contract; no network requests or hosted CI.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openAccountingWorkspace} from '../../workspace/store.mjs';
import {ReceivablesWorkspace} from '../store.mjs';
import {XeroReceivablesWorkspace} from './store.mjs';
import {createXeroReceivablesServer} from './server.mjs';
import {XeroReceivablesClient} from './client.mjs';
import {json,sha} from '../core.mjs';
import {readXeroCsv,evaluateXeroReturnRows} from './domain.mjs';

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

const root=await mkdtemp(join(process.env.SCF_XERO_TMP??tmpdir(),'xero-receivables-'));
let workspace,running;
try {
  const directory=join(root,'accounting'),outboxDir=join(root,'outbox'),proofDir=join(root,'proofs'),termsFile=join(root,'terms.json');
  await mkdir(outboxDir,{mode:0o700});await mkdir(proofDir,{mode:0o700});
  await writeFile(termsFile,json({schema:'stellar-forge.merchant-accounting-terms.v1',routes:[{
    routeId:'exercise',method:'GET',network:'stellar:testnet',asset:sourceStrKey(16,1),payTo:sourceStrKey(48,2),
    amountAtomic:'1000000',unitPriceUsd:'1',unitCostUsd:null,priceBasis:'Local Xero software exercise'
  }]}),{mode:0o600});
  workspace=await openAccountingWorkspace({directory,outboxDir,proofDir,termsFile});
  const r=await new ReceivablesWorkspace(workspace).init(),x=await new XeroReceivablesWorkspace(r).init();
  const actor='Local Xero handover exercise',request=values=>({revision:workspace.state.revision,actor,requestId:randomUUID(),...values});
  const customer=(await r.saveCustomer({revision:workspace.state.revision,actor,reference:'XERO-EXERCISE',name:'Exercise & Company',
    email:'',address:'Local exercise',note:'Private operator fixture'})).customer;
  await r.settings(request({name:'Exercise merchant',invoicePrefix:'XE',creditPrefix:'XC'}));
  const currency={code:'USD',scale:2},common={customerId:customer.id,currency,issueDate:'2026-01-04',dueDate:'2026-01-31'};
  async function issue(lines) {
    const draft=await r.saveDraft(request({...common,lines}));
    const preview=await r.preview(draft.invoice.id);
    return (await r.issue(draft.invoice.id,request({expectedVersion:preview.expectedVersion,previewSha256:preview.previewSha256}))).invoice;
  }
  const first=await issue([
    {id:'service',description:'Service hours, with agreed discount',quantity:'2.5',unitAmount:'40.00',discountAmount:'10.00',taxAmount:'9.00'},
    {id:'setup',description:'Setup',quantity:'1',unitAmount:'25.00',taxAmount:'0.00'}]);
  const second=await issue([{id:'support',description:'Monthly support',quantity:'1',unitAmount:'50.00',taxAmount:'0.00'}]);
  const credit=(await r.credit(first.id,request({creditDate:'2026-01-05',reason:'Agreed reduction',
    lines:[{invoiceLineId:'service',netAmount:'10.00',taxAmount:'1.00'}]}))).credit;
  const payment=(await r.receipt(request({customerId:customer.id,currency,amount:'90.00',receivedDate:'2026-01-06',
    method:'Bank transfer',reference:'XERO-EXERCISE-1'}))).receipt;
  await r.allocate(request({invoiceId:first.id,receiptId:payment.id,amount:'90.00',allocatedDate:'2026-01-06'}));
  const originals=new Map();
  for(const [id,name] of [[first.id,'invoice.json'],[second.id,'invoice.json'],[credit.id,'credit.json']])
    originals.set(id,sha((await r.file(id,name)).bytes));

  running=await createXeroReceivablesServer({workspace,port:0});
  let origin=new URL(running.url).origin,client=new XeroReceivablesClient({baseUrl:origin+'/api/receivables/xero'});
  const initial=await client.state({asOf:'2026-01-31'});
  assert.match(initial.workspaceId,/^[0-9a-f]{64}$/);assert.match(initial.sourcesSha256,/^[0-9a-f]{64}$/);
  assert.equal((await fetch(origin+'/api/receivables/state')).status,200);
  for(const path of ['/payment-plans/','/api/receivables/payment-plans/state'])
    assert.equal((await fetch(origin+path)).status,200);
  assert.match(await (await fetch(running.url)).text(),/Xero/);
  for(const path of ['native-json.mjs','NATIVE_RETURN.md']){
    const response=await fetch(new URL(path,running.url));assert.equal(response.status,200);assert.ok((await response.text()).length>1000);
  }
  const headers=['*ContactName','EmailAddress','*InvoiceNumber','Reference','*InvoiceDate','*DueDate',
    '*Description','*Quantity','*UnitAmount','Discount','*AccountCode','*TaxType','Currency','BrandingTheme'];
  const templateBytes=Buffer.from('\uFEFF'+headers.join(',')+'\r\n');
  const upload=(name,bytes)=>({name,dataBase64:Buffer.from(bytes).toString('base64')});
  const profileValue={name:'Exercise USD',organisation:'Exercise Xero organisation',currency,
    invoiceDateFormat:'MM/DD/YYYY',creditDateFormat:'DD/MM/YYYY',accountCode:'200',taxType:'Tax on Sales',
    contacts:[{customerId:customer.id,contactName:'Exercise, Company'}],lineMappings:[],
    invoiceTemplate:upload('Original-invoice-template.csv',templateBytes),
    creditTemplate:upload('Original-credit-template.csv',templateBytes)};
  const saved=await client.saveProfile(request(profileValue)),profile=saved.profile;
  const selection={profileId:profile.id,documentIds:[first.id,second.id,credit.id],asOf:'2026-01-31'};
  const preview=await client.preview(selection);
  assert.equal(preview.ready,true);assert.equal(preview.totals.invoices.total,'174.00');
  assert.equal(preview.totals.credits.total,'11.00');
  const preparedRequest=request({...selection,previewSha256:preview.previewSha256,title:'Native Xero document handover'});
  const prepared=await client.prepare(preparedRequest),packageId=prepared.package.id;
  assert.equal(prepared.package.state,'PREPARED');assert.equal(prepared.package.documentCount,3);
  const repeated=await client.prepare(preparedRequest);
  assert.equal(repeated.package.id,packageId);assert.equal(repeated.operation.replayed,true);
  const invoiceBytes=Buffer.from(await (await client.file(packageId,'xero-invoices-001.csv')).arrayBuffer());
  const invoiceCsv=readXeroCsv(invoiceBytes),column=name=>invoiceCsv.headers.findIndex(h=>h.replace(/^\*/,'')===name);
  assert.equal(invoiceCsv.bom,true);assert.deepEqual(invoiceCsv.headers,[...headers,'TaxAmount']);
  assert.equal(invoiceCsv.records[0].values[column('UnitAmount')],'90.00');
  assert.equal(invoiceCsv.records[0].values[column('Quantity')],'1');
  assert.equal(invoiceCsv.records[0].values[column('TaxAmount')],'9.00');
  assert.equal(invoiceCsv.records[0].values[column('Discount')],'');
  assert.equal(invoiceCsv.records[0].values[column('InvoiceDate')],'01/04/2026');
  assert.equal(invoiceCsv.records[0].values[column('ContactName')],'Exercise, Company');
  const creditBytes=Buffer.from(await (await client.file(packageId,'xero-credits-001.csv')).arrayBuffer());
  const creditCsv=readXeroCsv(creditBytes);
  assert.equal(creditCsv.records[0].values[column('UnitAmount')],'-10.00');
  assert.equal(creditCsv.records[0].values[column('TaxAmount')],'-1.00');
  assert.equal(creditCsv.records[0].values[column('InvoiceDate')],'05/01/2026');
  assert.equal(sha(Buffer.from(await (await client.file(packageId,'invoice-template.csv')).arrayBuffer())),sha(templateBytes));
  const retainedSnapshot=await (await client.file(packageId,'original-account-snapshot.json')).json();
  assert.equal(retainedSnapshot.receipts[0].amount,'90.00');assert.equal(retainedSnapshot.allocations.length,1);

  const firstXero=randomUUID(),creditXero=randomUUID(),secondXero=randomUUID(),duplicateXero=randomUUID();
  const invoiceRecord=(invoice,id,total,extras={})=>({
    Type:'ACCREC',InvoiceID:id,InvoiceNumber:invoice.number,Status:'DRAFT',CurrencyCode:'USD',
    SubTotal:total==='124.00'?115:Number(total),TotalTax:total==='124.00'?9:0,Total:Number(total),
    DateString:'2026-01-04T00:00:00',DueDateString:'2026-01-31T00:00:00',Contact:{Name:'Exercise, Company'},
    LineItems:total==='124.00'?[{Description:'Service hours',Quantity:1,UnitAmount:90,LineAmount:90,TaxAmount:9},
      {Description:'Setup',Quantity:1,UnitAmount:25,LineAmount:25,TaxAmount:0}]:
      [{Description:'Monthly support',Quantity:1,UnitAmount:Number(total),LineAmount:Number(total),TaxAmount:0}],...extras});
  const creditRecord={Type:'ACCRECCREDIT',CreditNoteID:creditXero,CreditNoteNumber:credit.number,
    Status:'AUTHORISED',CurrencyCode:'USD',SubTotal:10,TotalTax:1,Total:11,DateString:'2026-01-05T00:00:00',
    Contact:{Name:'Exercise, Company'},LineItems:[{Description:'Agreed reduction',Quantity:1,UnitAmount:10,LineAmount:10,TaxAmount:1}]};
  const native=(kind,records,name)=>upload(name,Buffer.from(json({Id:randomUUID(),Status:'OK',ProviderName:'Local software exercise',
    DateTimeUTC:'/Date(1767657600000)/',[kind]:records})));
  const receiveNative=(id,file)=>client.receive(id,request({organisation:profile.organisation,format:'NATIVE_JSON',file}));
  const firstReturn=native('Invoices',[invoiceRecord(first,firstXero,'124.00')],'original-invoices.json');
  const firstReceive=await receiveNative(packageId,firstReturn);
  assert.equal(firstReceive.package.resolvedCount,1);
  const creditRequest=request({organisation:profile.organisation,format:'NATIVE_JSON',
    file:native('CreditNotes',[creditRecord],'original-credit-notes.json')});
  const receivedCredit=await client.receive(packageId,creditRequest);
  assert.equal(receivedCredit.package.resolvedCount,2);
  const beforeReplay=workspace.state.revision;
  assert.equal((await client.receive(packageId,creditRequest)).operation.replayed,true);
  assert.equal(workspace.state.revision,beforeReplay);
  await assert.rejects(client.receive(packageId,request({organisation:'Another organisation',format:'NATIVE_JSON',file:firstReturn})),
    {code:'XERO_RETURN_ORGANISATION'});
  const update=await client.saveProfile(request({...profileValue,id:profile.id,expectedVersion:profile.version,
    invoiceTemplate:undefined,creditTemplate:undefined,
    lineMappings:[{documentId:second.id,lineId:'support',accountCode:'210',taxType:'Tax on Sales'}]}));
  assert.equal(update.profile.version,2);assert.equal(update.profile.invoiceTemplate.sha256,profile.invoiceTemplate.sha256);
  const correctionSelection={profileId:profile.id,parentId:packageId};
  const correctionPreview=await client.preview(correctionSelection);
  assert.deepEqual(correctionPreview.selection.documentIds,[second.id]);
  const corrected=await client.correct(packageId,request({...correctionSelection,previewSha256:correctionPreview.previewSha256}));
  const successorId=corrected.package.id;
  assert.equal(corrected.package.parentId,packageId);assert.equal(corrected.package.documentCount,1);
  const notDuplicate=await client.preview({profileId:profile.id,documentIds:[second.id],asOf:'2026-01-31'});
  assert.equal(notDuplicate.ready,false);assert.ok(notDuplicate.issues.some(row=>row.code==='XERO_DOCUMENT_ALREADY_PREPARED'));
  const mismatch=await receiveNative(successorId,native('Invoices',[invoiceRecord(second,secondXero,'49.00')],'original-mismatch.json'));
  assert.equal(mismatch.package.resolutions[0].status,'MISMATCH');assert.equal(mismatch.package.resolutions[0].canCorrect,false);
  const collision=await receiveNative(successorId,native('Invoices',[invoiceRecord(second,duplicateXero,'50.00')],'original-conflicting-id.json'));
  assert.equal(collision.package.resolutions[0].status,'CONFLICT');
  assert.equal(collision.package.resolutions[0].activeExternalDocumentIds.length,2);
  const retirement=await receiveNative(successorId,native('Invoices',[
    invoiceRecord(second,duplicateXero,'50.00',{Status:'VOIDED'})],'original-voided-duplicate.json'));
  assert.equal(retirement.package.resolutions[0].status,'MISMATCH');
  const completed=await receiveNative(successorId,native('Invoices',[invoiceRecord(second,secondXero,'50.00')],'original-corrected-invoice.json'));
  assert.equal(completed.package.state,'RECEIVED');assert.equal((await client.detail(packageId)).package.state,'RECEIVED');
  assert.deepEqual(completed.package.resolutions[0].activeExternalDocumentIds,[secondXero]);

  // One physical Xero UUID cannot belong to two different original documents, even with identical totals.
  const duplicateDocs=[{...completed.package.documents[0],id:randomUUID(),number:'IDENTICAL-A'},
    {...completed.package.documents[0],id:randomUUID(),number:'IDENTICAL-B'}];
  const duplicateRows=duplicateDocs.map(doc=>({rowNumbers:[2],documentNumber:doc.number,externalDocumentId:randomUUID(),
    externalStatus:'DRAFT',net:doc.net,tax:doc.tax,total:doc.total,currency:'USD'}));
  duplicateRows[1].externalDocumentId=duplicateRows[0].externalDocumentId;
  assert.ok(evaluateXeroReturnRows(duplicateRows,duplicateDocs).rows.every(row=>row.status==='CONFLICT'));

  const bundle=await x.export(packageId);
  const rawReturns=bundle.files.filter(item=>item.role==='original-xero-result');
  assert.equal(rawReturns.length,6);assert.ok(rawReturns.every(item=>item.name.endsWith('.json')));
  assert.ok(bundle.files.some(item=>item.name==='line-correspondence.csv'));
  for(const [id,name] of [[first.id,'invoice.json'],[second.id,'invoice.json'],[credit.id,'credit.json']])
    assert.equal(sha((await r.file(id,name)).bytes),originals.get(id));
  const tarResponse=await client.exportFile(packageId);
  const tar=Buffer.from(await tarResponse.arrayBuffer());
  assert.equal(tarResponse.headers.get('content-type'),'application/x-tar');assert.equal(tar.length%512,0);
  assert.equal(tar.subarray(257,262).toString(),'ustar');
  const rev=workspace.state.revision,firstPackageHash=sha((await x.file(packageId,'review.json')).bytes);
  await running.close();running=null;await workspace.close();workspace=null;
  workspace=await openAccountingWorkspace({directory});
  const reopenedReceivables=await new ReceivablesWorkspace(workspace).init();
  const reopened=await new XeroReceivablesWorkspace(reopenedReceivables).init();
  assert.equal(workspace.state.revision,rev);
  assert.equal((await reopened.detail(packageId)).package.state,'RECEIVED');
  assert.equal(sha((await reopened.file(packageId,'review.json')).bytes),firstPackageHash);
  const savedState=JSON.parse(await readFile(join(directory,'workspace.json'),'utf8'));
  assert.equal(savedState.receivables.xero.packages.length,2);
  assert.equal(savedState.receivables.xero.profiles.length,2);
  console.log(JSON.stringify({schema:'stellar-forge.merchant-receivables-xero-exercise.v1',result:'PASS',
    packages:2,profiles:2,issuedInvoices:2,creditNotes:1,originalReturnedFiles:rawReturns.length,
    revision:rev,originalInvoiceSha256:originals.get(first.id),templateSha256:sha(templateBytes),
    checks:['one original accounting owner','native HTTP and client','original template bytes and regional dates',
      'exact discounted invoice and negative credit lines','private account and payment schedules','same-request replay',
      'original native Xero invoice and credit JSON','organisation identity','unresolved-only successor',
      'retained profile templates','active Xero ID mismatch and duplicate retirement','cross-document UUID ownership',
      'complete original handover TAR','unchanged issued files','cold durable reopen']},null,2));
} finally {
  await running?.close().catch(()=>{});await workspace?.close().catch(()=>{});
  await rm(root,{recursive:true,force:true});
}
