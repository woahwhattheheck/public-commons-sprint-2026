// MIT. Customer refunds borrow the original receivables journal, files and accounting lease.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {AdjustmentWorkspace} from '../workspace/adjustments-workspace.mjs';
import {validateAdjustment, validateRefundProof} from '../adjustments.mjs';
import {json, sha, need, plain, field, identifier, dateValue, currencyKey, minor, money, today,
  invoiceSummary, receiptSummary, agingReport, assertReceiptConservation, receiptUnreconciledRefunds, csv} from './core.mjs';
import {timestamp, validatePaymentVerification, requestTransactionFingerprints} from './payment-requests.mjs';
import {REFUND_SCHEMA, DISPOSITION_SCHEMA, refundRows, dispositionRows, refundSummary, dispositionSummary,
  compileRefundReview, compileCreditDispositionReview, customerFundsView, proposalCandidate,
  planAllocationChanges, requireUniqueRefundTransfer, refundDocumentFiles} from './refunds.mjs';

const clone = value => structuredClone(value);
const HEX = /^[a-f0-9]{64}$/;
const FILE = /^(?:request|refund|reversal|disposition)\.(?:json|csv|html)$/;
const schema = 'stellar-forge.merchant-customer-refunds.v1';
function page(value = {}) {
  const offset = Number(value.offset ?? 0), limit = Number(value.limit ?? 100);
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 500,
    'INVALID_REFUND_PAGE', 'Use a nonnegative offset and a page size from one to 500.');
  return {offset, limit};
}
function immutable(row) {
  need(row && HEX.test(row.proposalSha256 ?? '') && sha(json(row.proposal)) === row.proposalSha256 &&
    HEX.test(row.reviewSha256 ?? '') && row.reviewSha256 === sha(json({proposal:row.proposal,balanceEffects:row.balanceEffects})) &&
    Array.isArray(row.history) && plain(row.files),
    'REFUND_SOURCE_CHANGED', 'The original reviewed customer funds record changed.', 409);
}
function compactVerification(value, artifact) {
  const original = value.proof, proof = {};
  for (const key of ['rpcEndpoint', 'networkResultSha256', 'transactionResultSha256', 'operationIndex',
    'operationType', 'payer', 'recipient', 'asset', 'amountAtomic', 'memo', 'envelopeHash',
    'innerTransactionHash', 'transactionHashes', 'transactionFingerprints', 'envelopeXdrSha256', 'resultXdrSha256'])
    if (Object.hasOwn(original, key)) proof[key] = clone(original[key]);
  proof.networkResponse = original.networkResponse == null ? null : {passphrase: original.networkResponse.passphrase ?? null};
  proof.transactionResponse = original.transactionResponse == null ? null :
    Object.fromEntries(['status', 'txHash', 'ledger', 'createdAt'].map(key => [key, original.transactionResponse[key] ?? null]));
  return {...clone(value), proof, proofArtifact: clone(artifact)};
}
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
function fileIdentities(files) {
  return Object.fromEntries(Object.entries(files).map(([name, file]) =>
    [name, {sha256: file.sha256, bytes: file.bytes, type: file.type}]));
}
function resultIds(row, extra = {}) {
  return {refundId: row.id, receiptId: row.proposal.receiptId,
    invoiceIds: [...new Set(row.proposal.funding.map(item => item.invoiceId))], ...extra};
}
function operatorReference(data, proposal) {
  const payout = proposal.payout;
  if (payout.kind !== 'OPERATOR_RECORDED') return;
  const matching = refundRows(data).filter(row => row.proposal.payout.kind === payout.kind &&
    row.proposal.payout.method.toLowerCase() === payout.method.toLowerCase() &&
    row.proposal.payout.reference === payout.reference);
  if (!payout.replacesRefundId) {
    need(matching.length === 0, 'REFUND_REFERENCE_ALREADY_RECORDED',
      'This original payout reference is already recorded. Recover it or explicitly link its reversed correction.', 409);
    return;
  }
  const prior = refundRows(data).find(row => row.id === payout.replacesRefundId);
  need(prior && matching.some(row => row.id === prior.id) && prior.status === 'REVERSED' &&
    prior.proposal.receiptId === proposal.receiptId && prior.proposal.customerId === proposal.customerId &&
    currencyKey(prior.proposal.currency) === currencyKey(proposal.currency) &&
    prior.reversedDate <= proposal.effectiveDate &&
    proposal.effectiveDate <= [payout.refundDate, prior.reversedDate].sort().at(-1) &&
    !refundRows(data).some(row => row.proposal.payout.replacesRefundId === prior.id),
    'REFUND_CORRECTION_LINK_REQUIRED',
    'Link the same customer payment to its reversed original; fund an already paid correction on the original reversal date.', 409);
  need(matching.every(row => row.status === 'REVERSED'), 'REFUND_REFERENCE_ALREADY_RECORDED',
    'The original payout reference still has an effective refund record.', 409);
}
function dispositionFiles(row) {
  const proposal = row.proposal, e = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const value = {schema: DISPOSITION_SCHEMA, id: row.id, customer: proposal.customer,
    receipt: proposal.receipt, currency: proposal.currency, effectiveDate: proposal.effectiveDate,
    released: proposal.released, allocated: proposal.allocated, customerNote: proposal.customerNote,
    funding: proposal.funding.map(item => ({allocationId:item.allocationId,invoiceId:item.invoiceId,
      invoiceNumber:item.invoiceNumber,amount:item.amount,replacementAmount:item.replacementAmount})),
    allocations: proposal.allocations.map(item => ({allocationId:item.allocationId,invoiceId:item.invoiceId,
      invoiceNumber:item.invoiceNumber,amount:item.amount})),
    unappliedAfter: row.balanceEffects.receipt.after.available};
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Customer credit disposition</title><style>'+
    'body{font:14px/1.5 system-ui,sans-serif;color:#222;margin:32px auto;max-width:980px;padding:0 24px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #bbb}</style></head><body><h1>Customer credit disposition</h1><h2>'+
    e(value.customer.name)+'</h2><p>Original payment '+e(value.receipt.reference)+' · Effective '+e(value.effectiveDate)+
    '</p><p>Released '+e(value.released)+' · Allocated '+e(value.allocated)+' · Unapplied '+e(value.unappliedAfter)+' '+e(value.currency.code)+
    '</p><p>'+e(value.customerNote)+'</p><table><thead><tr><th>Action</th><th>Invoice</th><th>Amount</th></tr></thead><tbody>'+
    [...value.funding.map(item=>({action:'Released credit',...item})),...value.allocations.map(item=>({action:'Applied payment',...item}))]
      .map(item=>'<tr><td>'+e(item.action)+'</td><td>'+e(item.invoiceNumber)+'</td><td>'+e(item.amount)+'</td></tr>').join('')+
    '</tbody></table><p>Original operation '+e(row.id)+'</p></body></html>\n';
  return [
    {name:'disposition.json',type:'application/json; charset=utf-8',bytes:Buffer.from(json(value))},
    {name:'disposition.html',type:'text/html; charset=utf-8',bytes:Buffer.from(html)},
    {name:'disposition.csv',type:'text/csv; charset=utf-8',bytes:Buffer.from(csv([
      ['disposition_id','effective_date','original_receipt','action','invoice','allocation_id','currency','amount'],
      ...value.funding.map(item=>[row.id,value.effectiveDate,value.receipt.reference,'RELEASE',item.invoiceNumber,item.allocationId,value.currency.code,item.amount]),
      ...value.allocations.map(item=>[row.id,value.effectiveDate,value.receipt.reference,'ALLOCATE',item.invoiceNumber,item.allocationId,value.currency.code,item.amount])
    ]))}
  ];
}

export class RefundsWorkspace {
  constructor(receivables, {verifyTransfer} = {}) {
    this.receivables = receivables; this.workspace = receivables.workspace;
    this.verifyTransfer = verifyTransfer ?? receivables.paymentRequestWorkspace.verifyTransfer;
    this.adjustments = new AdjustmentWorkspace(this.workspace);
  }
  data() { return this.receivables.data(); }
  _refund(id) {
    identifier(id, 'refund');
    const row = refundRows(this.data()).find(item => item.id === id);
    need(row, 'REFUND_NOT_FOUND', 'Choose an original customer refund.', 404);
    immutable(row); refundSummary(row, this.data()); return row;
  }
  _disposition(id) {
    identifier(id, 'credit disposition');
    const row = dispositionRows(this.data()).find(item => item.id === id);
    need(row, 'CREDIT_DISPOSITION_NOT_FOUND', 'Choose an original customer credit disposition.', 404);
    immutable(row); return row;
  }
  _return(row, id) {
    identifier(id, 'refund return');
    const returned = row.returns.find(item => item.id === id);
    need(returned, 'REFUND_RETURN_NOT_FOUND', 'Choose a transaction reported for this refund.', 404);
    return returned;
  }
  _adjustmentSummary(record, receipt) {
    validateAdjustment(record);
    need(record.kind === 'REFUND' && record.status === 'VERIFIED' && receipt.source?.kind === 'ORIGINAL_STELLAR_SETTLEMENT' &&
      receipt.source.network === record.original.network &&
      receipt.source.transactionFingerprint === record.original.transactionFingerprint &&
      record.refundTerms.network === 'stellar:pubnet' && record.verification.transferAt,
      'ORIGINAL_REFUND_ADJUSTMENT_REQUIRED', 'Select this original receipt’s verified public-network reverse transfer and ledger date.', 409);
    validateRefundProof(record.verification.proof, record);
    const proof = record.verification.proof;
    return {adjustmentId:record.id,receiptId:receipt.id,network:record.refundTerms.network,
      asset:record.refundTerms.asset,amountAtomic:record.amountAtomic,transaction:record.verification.transaction,
      transactionFingerprint:sha(record.verification.transaction),transferAt:record.verification.transferAt,
      sourceAccount:record.refundTerms.from,destination:record.refundTerms.to,ledger:record.verification.ledger,
      requestSha256:record.requestSha256,proofSha256:record.verification.sha256,
      proofReference:{path:record.verification.path,bytes:record.verification.bytes,sha256:record.verification.sha256},
      originalReceiptValuation:receipt.source.valuationNote,
      alreadyVisibleAtReceiptImport:(receipt.source.adjustments ?? []).some(item=>item.id===record.id)};
  }
  async _selectedAdjustment(receipt, payout) {
    if (payout?.kind !== 'ORIGINAL_STELLAR_ADJUSTMENT') return null;
    identifier(payout.adjustmentId, 'original adjustment');
    const record = (this.workspace.state.adjustments ?? []).find(row=>row.id===payout.adjustmentId);
    need(record, 'ORIGINAL_REFUND_ADJUSTMENT_REQUIRED', 'Choose a retained original refund adjustment.', 404);
    const result = this._adjustmentSummary(record, receipt);
    need(!refundRows(this.data()).some(row=>row.proposal.payout.adjustmentId===record.id),
      'ORIGINAL_REFUND_ADJUSTMENT_CONSUMED', 'This original adjustment already has a customer refund record.', 409);
    await this.adjustments.assertRequestFile(record);
    return result;
  }
  _availableAdjustments(data) {
    const consumed = new Set(refundRows(data).map(row=>row.proposal.payout.adjustmentId).filter(Boolean)), result = [];
    for (const record of this.workspace.state.adjustments ?? []) {
      if (record.kind !== 'REFUND' || record.status !== 'VERIFIED' || consumed.has(record.id) ||
        record.refundTerms?.network !== 'stellar:pubnet' || !record.verification?.transferAt) continue;
      const receipt = data.receipts.find(row=>row.status==='RECORDED' &&
        row.source?.kind==='ORIGINAL_STELLAR_SETTLEMENT' && row.source.network===record.original.network &&
        row.source.transactionFingerprint===record.original.transactionFingerprint);
      if (receipt) result.push(this._adjustmentSummary(record, receipt));
    }
    return result;
  }
  _returnSummary(source, returned, observation) {
    const payout=source.proposal.payout,verification=observation.verification;
    return {originalRefundId:source.id,originalReturnId:returned.id,observationId:observation.id,
      receiptId:source.proposal.receiptId,network:verification.network,
      sourceAccount:verification.payer,destination:verification.recipient,asset:clone(verification.asset),
      stellarAmount:payout.stellarAmount,amountAtomic:verification.amountAtomic,memo:clone(verification.memo),
      transaction:returned.transaction,transactionFingerprint:verification.transactionFingerprint,
      closedAt:verification.closedAt,ledger:verification.ledger,amount:source.proposal.amount,
      currency:clone(source.proposal.currency),verificationScope:verification.verificationScope,
      proofSha256:observation.verification.proofArtifact?.sha256??sha(json(observation.verification)),
      status:observation.status,originalStatus:source.status,originalEffectiveDate:source.proposal.effectiveDate,
      valuationNote:payout.valuationNote??'',customerNote:source.proposal.customerNote??''};
  }
  _availableReturns(data,customerId) {
    const result=[];
    for(const receipt of data.receipts) {
      if(receipt.status!=='RECORDED'||customerId&&receipt.customerId!==customerId)continue;
      for(const pending of receiptUnreconciledRefunds(receipt,data,'9999-12-31')) {
        const source=refundRows(data).find(row=>row.id===pending.refundId),
          returned=source.returns.find(row=>row.id===pending.returnId),
          observation=returned.observations.find(row=>row.id===pending.observationId);
        immutable(source);result.push(this._returnSummary(source,returned,observation));
      }
    }
    return result;
  }
  async _selectedReturn(receipt,payout) {
    if(payout?.originalRefundId===undefined&&payout?.originalReturnId===undefined)return null;
    identifier(payout.originalRefundId,'original refund');identifier(payout.originalReturnId,'original refund return');
    const source=this._refund(payout.originalRefundId),returned=this._return(source,payout.originalReturnId);
    need(source.proposal.receiptId===receipt.id&&source.proposal.payout.kind==='STELLAR_TRANSFER',
      'ORIGINAL_REFUND_RETURN_REQUIRED','Choose the original return of this customer payment.',409);
    const selected=this._availableReturns(this.data(),receipt.customerId).find(row=>
      row.originalRefundId===source.id&&row.originalReturnId===returned.id);
    need(selected,'ORIGINAL_REFUND_RETURN_NOT_SELECTABLE',
      'Choose the original unposted return listed for this transaction.',409);
    const observation=returned.observations.find(row=>row.id===selected.observationId);
    const verification=validatePaymentVerification(source.proposal.payout,
      {transaction:returned.transaction,payer:source.proposal.payout.sourceAccount},
      await this.receivables.paymentRequestWorkspace._proof(observation));
    need(verification.status==='VERIFIED'&&verification.verificationScope==='OFFICIAL_PUBNET_RPC',
      'ORIGINAL_PUBLIC_REFUND_RETURN_REQUIRED','Choose the original verified public-network outgoing transfer.',409);
    await this._readRetained(source.files['request.json']);
    return {summary:selected,source,returned,observation,verification};
  }
  async customerFunds(query = {}) {
    return this.workspace.serial(async()=>{
      const data = this.data(), asOf = query.asOf ?? today();
      const value = customerFundsView(data,this.workspace.state.customerStatements.customers,this._availableAdjustments(data),{...query,asOf});
      return clone({...value,revision:this.workspace.state.revision,
        currencies:agingReport(data,asOf,query.customerId ?? null).currencies,
        availableRefundReturns:this._availableReturns(data,query.customerId)});
    });
  }
  async previewRefund(value) {
    return this.workspace.serial(async()=>{
      const receipt = this.receivables._receipt(value?.receiptId);
      const adjustment = await this._selectedAdjustment(receipt,value?.payout);
      const originalReturn=await this._selectedReturn(receipt,value?.payout);
      const review = compileRefundReview(this.data(),this.receivables._customer(receipt.customerId),value,
        {adjustment,originalReturn:originalReturn?.summary});
      operatorReference(this.data(),review.proposal);
      if (adjustment || originalReturn) requireUniqueRefundTransfer(this.data(),this.workspace.state.adjustments,
        {id:review.proposal.id,proposal:review.proposal,returns:[]},null,originalReturn?.verification ?? adjustment);
      return clone({revision:this.workspace.state.revision,...review});
    });
  }
  async previewCreditDisposition(value) {
    return this.workspace.serial(async()=>{
      const receipt = this.receivables._receipt(value?.receiptId);
      return clone({revision:this.workspace.state.revision,
        ...compileCreditDispositionReview(this.data(),this.receivables._customer(receipt.customerId),value)});
    });
  }
  async _retainFiles(files) {
    const root = join(this.workspace.directory,'exports'), parent = await lstat(root);
    need(parent.isDirectory()&&!parent.isSymbolicLink(),'REFUND_EXPORT_DIRECTORY_CHANGED',
      'The original accounting export directory changed.',409);
    const directoryId = randomUUID(), directory = join(root,directoryId);
    await mkdir(directory,{mode:0o700}); const result = {};
    for (const file of files) {
      need(FILE.test(file.name),'INVALID_REFUND_DOCUMENT_NAME','Use the original refund document filename.',409);
      const bytes = Buffer.from(file.bytes);
      need(bytes.length>0&&bytes.length<=4_000_000,'REFUND_DOCUMENT_LIMIT','The customer refund document exceeds its retained limit.');
      const handle = await open(join(directory,file.name),
        constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      result[file.name] = {directoryId,name:file.name,bytes:bytes.length,sha256:sha(bytes),type:file.type};
    }
    await syncDirectory(directory);await syncDirectory(root);return result;
  }
  async _readRetained(metadata) {
    identifier(metadata?.directoryId,'refund export');
    need((FILE.test(metadata.name) || metadata.name==='transfer-proof.json') && HEX.test(metadata.sha256??'') &&
      Number.isSafeInteger(metadata.bytes)&&metadata.bytes>0&&metadata.bytes<=128_000_000,
      'INVALID_REFUND_FILE_REFERENCE','The retained original refund file identity is invalid.',409);
    const root = join(this.workspace.directory,'exports'), directory = join(root,metadata.directoryId);
    const parent = await lstat(root), dir = await lstat(directory);
    need(parent.isDirectory()&&!parent.isSymbolicLink()&&dir.isDirectory()&&!dir.isSymbolicLink(),
      'REFUND_EXPORT_DIRECTORY_CHANGED','The retained refund export directory changed.',409);
    const handle = await open(join(directory,metadata.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    let bytes;
    try { const stat = await handle.stat();
      need(stat.isFile()&&stat.size===metadata.bytes,'REFUND_FILE_CHANGED','The retained original refund file size changed.',409);
      bytes=await handle.readFile();
    } finally {await handle.close();}
    need(bytes.length===metadata.bytes&&sha(bytes)===metadata.sha256,'REFUND_FILE_CHANGED',
      'The retained refund document differs from its original bytes.',409);
    return {bytes,type:metadata.type??'application/json; charset=utf-8'};
  }
  async _originalInvoices(proposal) {
    for (const id of new Set([...proposal.funding.map(row=>row.invoiceId),...(proposal.allocations??[]).map(row=>row.invoiceId)]))
      await this.receivables._file(id,'invoice.json');
  }
  _applyAllocations(data, row, actor, recordedAt) {
    if (row.proposal.accountingScope==='TESTNET_OBSERVATION') return {invoiceIds:[],allocationIds:[]};
    const changes=planAllocationChanges(data,row.proposal,actor,recordedAt);
    data.allocations=changes.allocations;
    const invoiceIds=[...new Set([...row.proposal.funding.map(item=>item.invoiceId),
      ...(row.proposal.allocations??[]).map(item=>item.invoiceId)])];
    for (const id of invoiceIds) {
      const invoice=this.receivables._invoice(id);
      invoice.version++;invoice.updatedAt=recordedAt;
      invoice.history.push({at:recordedAt,actor,action:'customer_funds_disposition',
        dispositionId:row.id,effectiveDate:row.proposal.effectiveDate,
        releasedAllocationIds:changes.released.filter(item=>item.invoiceId===id).map(item=>item.id),
        createdAllocationIds:changes.created.filter(item=>item.invoiceId===id).map(item=>item.id)});
    }
    const receipt=this.receivables._receipt(row.proposal.receiptId);
    receipt.history.push({at:recordedAt,actor,action:'customer_funds_disposition',
      dispositionId:row.id,effectiveDate:row.proposal.effectiveDate,
      releasedAllocationIds:changes.released.map(item=>item.id),createdAllocationIds:changes.created.map(item=>item.id)});
    return {invoiceIds,allocationIds:changes.created.map(item=>item.id)};
  }
  async commitRefund(input) {
    return this.receivables._mutate('refund_committed',input,async(data,actor)=>{
      need(plain(input.proposal)&&HEX.test(input.reviewSha256??''),'REFUND_REVIEW_REQUIRED','Review the complete refund proposal before recording it.');
      const receipt=this.receivables._receipt(input.proposal.receiptId), adjustment=await this._selectedAdjustment(receipt,input.proposal.payout);
      const originalReturn=await this._selectedReturn(receipt,input.proposal.payout);
      const review=compileRefundReview(data,this.receivables._customer(receipt.customerId),input.proposal,
        {adjustment,originalReturn:originalReturn?.summary});
      need(json(review.proposal)===json(input.proposal)&&review.reviewSha256===input.reviewSha256,
        'REFUND_REVIEW_CHANGED','The original receipt, credited allocation, payout or balance changed. Review this refund again.',409);
      operatorReference(data,review.proposal);
      need(refundRows(data).length<5000,'REFUND_REGISTER_LIMIT','This workspace already retains 5,000 customer refunds.');
      await this._originalInvoices(review.proposal);
      const recordedAt=timestamp(), payout=review.proposal.payout;
      const row={schema:REFUND_SCHEMA,id:review.proposal.id,proposal:clone(review.proposal),
        proposalSha256:sha(json(review.proposal)),reviewSha256:review.reviewSha256,
        status:payout.refundDate?'RECORDED':'AWAITING_TRANSFER',
        refundDate:payout.refundDate??null,accountingDate:payout.accountingDate??payout.refundDate??null,
        cancelledDate:null,reversedDate:null,createdAt:recordedAt,actor,returns:[],files:{},
        payoutRecord:null,balanceEffects:clone(review.balanceEffects),
        history:[{at:recordedAt,actor,action:'refund_committed',effectiveDate:review.proposal.effectiveDate,
          accountingScope:review.proposal.accountingScope,refundDate:payout.refundDate??null,
          accountingDate:payout.accountingDate??payout.refundDate??null}]};
      if (payout.kind==='OPERATOR_RECORDED') row.payoutRecord={kind:payout.kind,method:payout.method,
        reference:payout.reference,refundDate:payout.refundDate,accountingDate:payout.accountingDate,
        replacesRefundId:payout.replacesRefundId};
      if (adjustment) {
        requireUniqueRefundTransfer(data,this.workspace.state.adjustments,row,null,adjustment);
        row.payoutRecord={kind:payout.kind,method:'Original Stellar adjustment',reference:payout.adjustmentId,
          ...clone(adjustment),valuationNote:payout.valuationNote,refundDate:payout.refundDate,
          accountingDate:payout.accountingDate??payout.refundDate};
      }
      if (originalReturn) {
        requireUniqueRefundTransfer(data,this.workspace.state.adjustments,row,null,originalReturn.verification);
        const verification=originalReturn.observation.verification;
        row.payoutRecord={kind:'STELLAR_TRANSFER',method:'Original verified Stellar refund',
          reference:payout.transaction,transaction:payout.transaction,transactionFingerprint:verification.transactionFingerprint,
          transactionFingerprints:requestTransactionFingerprints(verification),
          originalRefundId:payout.originalRefundId,originalReturnId:payout.originalReturnId,
          observationId:payout.observationId,network:payout.network,networkPassphrase:payout.networkPassphrase,
          sourceAccount:payout.sourceAccount,destination:payout.destination,asset:clone(payout.asset),
          amountAtomic:payout.amountAtomic,stellarAmount:payout.stellarAmount,memo:clone(payout.memo),
          valuationNote:payout.valuationNote,refundDate:payout.refundDate,accountingDate:payout.accountingDate??payout.refundDate,
          ledger:payout.ledger,closedAt:payout.closedAt,
          verificationScope:payout.verificationScope,proof:clone(verification.proof),
          ...(verification.proofArtifact?{proofArtifact:clone(verification.proofArtifact)}:{})};
      }
      proposalCandidate(data,row.proposal,row);
      row.files=await this._retainFiles([...refundDocumentFiles(row,'REQUEST'),
        ...(row.refundDate?refundDocumentFiles(row,'ADVICE'):[])]);
      if(originalReturn?.observation.verification.proofArtifact)
        row.files['proof-'+originalReturn.observation.id+'.json']={
          ...clone(originalReturn.observation.verification.proofArtifact),type:'application/json; charset=utf-8'};
      const applied=this._applyAllocations(data,row,actor,recordedAt);
      if(originalReturn){
        const selected=row.proposal.sourceRefundCancellation;
        if(selected){
          Object.assign(originalReturn.source,{status:'CANCELLED',cancelledDate:selected.cancelledDate,
            cancellationReason:'Superseded by reviewed original-return adoption '+row.id});
          originalReturn.source.history.push({at:recordedAt,actor,action:'refund_reservation_replaced',
            cancelledDate:selected.cancelledDate,resolvedRefundId:row.id});
        }
        const aliases=new Set(requestTransactionFingerprints(originalReturn.verification));
        for(const reference of originalReturn.source.returns) if(aliases.has(sha(reference.transaction)) ||
          reference.observations.some(observation=>requestTransactionFingerprints(observation.verification).some(value=>aliases.has(value))))
          reference.resolvedRefundId=row.id;
        originalReturn.source.history.push({at:recordedAt,actor,action:'original_refund_return_adopted',
          refundReturnId:originalReturn.returned.id,resolvedRefundId:row.id,observationId:originalReturn.observation.id});
      }
      if (data.refunds===undefined)data.refunds=[];
      data.refunds.unshift(row);
      return resultIds(row,{allocationIds:applied.allocationIds,invoiceIds:applied.invoiceIds,
        ...(originalReturn?{sourceRefundId:originalReturn.source.id,sourceRefundReturnId:originalReturn.returned.id}:{})});
    });
  }
  async applyCreditDisposition(input) {
    return this.receivables._mutate('credit_disposition_applied',input,async(data,actor)=>{
      need(plain(input.proposal)&&HEX.test(input.reviewSha256??''),'CREDIT_DISPOSITION_REVIEW_REQUIRED','Review the complete credit disposition before applying it.');
      const receipt=this.receivables._receipt(input.proposal.receiptId);
      const review=compileCreditDispositionReview(data,this.receivables._customer(receipt.customerId),input.proposal);
      need(json(review.proposal)===json(input.proposal)&&review.reviewSha256===input.reviewSha256,
        'CREDIT_DISPOSITION_REVIEW_CHANGED','The original receipt, invoices or dated balances changed. Review this disposition again.',409);
      need(dispositionRows(data).length<5000,'CREDIT_DISPOSITION_LIMIT','This workspace already retains 5,000 customer credit dispositions.');
      await this._originalInvoices(review.proposal);
      const recordedAt=timestamp(),row={schema:DISPOSITION_SCHEMA,id:review.proposal.id,
        proposal:clone(review.proposal),proposalSha256:sha(json(review.proposal)),reviewSha256:review.reviewSha256,
        createdAt:recordedAt,actor,balanceEffects:clone(review.balanceEffects),invoiceIds:[],allocationIds:[],
        history:[{at:recordedAt,actor,action:'credit_disposition_applied',effectiveDate:review.proposal.effectiveDate}],files:{}};
      row.files=await this._retainFiles(dispositionFiles(row));
      const applied=this._applyAllocations(data,row,actor,recordedAt);
      Object.assign(row,applied);
      if (data.creditDispositions===undefined)data.creditDispositions=[];
      data.creditDispositions.unshift(row);
      return {creditDispositionId:row.id,receiptId:row.proposal.receiptId,...applied};
    });
  }
  async cancelRefund(id, input) {
    return this.receivables._mutate('refund_cancelled',{...input,refundId:id},async(data,actor)=>{
      const row=this._refund(id),cancelledDate=dateValue(input.cancelledDate,'refund cancellation date'),
        reason=field(input.reason,'refund cancellation reason',3000);
      need(row.proposal.payout.kind==='STELLAR_TRANSFER'&&row.status==='AWAITING_TRANSFER'&&!row.refundDate,
        'REFUND_CANCELLATION_UNAVAILABLE','Cancel a pending Stellar refund reservation.',409);
      need(cancelledDate>=row.proposal.effectiveDate,'REFUND_CANCELLATION_BEFORE_FUNDING',
        'Cancel on or after the original funding date.');
      const candidate={...row,status:'CANCELLED',cancelledDate};
      assertReceiptConservation(this.receivables._receipt(row.proposal.receiptId),
        {...data,refunds:refundRows(data).map(item=>item.id===id?candidate:item)});
      const recordedAt=timestamp();
      row.status='CANCELLED';row.cancelledDate=cancelledDate;row.cancellationReason=reason;
      row.history.push({at:recordedAt,actor,action:'refund_cancelled',cancelledDate,reason});
      if (row.proposal.accountingScope==='COMMERCIAL') this.receivables._receipt(row.proposal.receiptId).history.push({
        at:recordedAt,actor,action:'refund_reservation_cancelled',refundId:id,cancelledDate,reason});
      return resultIds(row);
    });
  }
  async reverseRefund(id, input) {
    return this.receivables._mutate('refund_reversed',{...input,refundId:id},async(data,actor)=>{
      const row=this._refund(id),reversedDate=dateValue(input.reversedDate,'refund correction date'),
        reason=field(input.reason,'refund correction reason',3000);
      need(row.status==='RECORDED'&&row.refundDate&&!row.reversedDate&&row.proposal.payout.kind==='OPERATOR_RECORDED',
        'REFUND_CORRECTION_UNAVAILABLE','Correct an original operator-recorded payout entry.',409);
      need(reversedDate>=(row.accountingDate??row.refundDate),'REFUND_CORRECTION_BEFORE_PAYOUT',
        'Use a correction date on or after the refund became effective in the original account.');
      const candidate={...row,status:'REVERSED',reversedDate,reversalReason:reason};
      assertReceiptConservation(this.receivables._receipt(row.proposal.receiptId),
        {...data,refunds:refundRows(data).map(item=>item.id===id?candidate:item)});
      const files=await this._retainFiles(refundDocumentFiles(candidate,'REVERSAL')),recordedAt=timestamp();
      Object.assign(row,{status:'REVERSED',reversedDate,reversalReason:reason,files:{...row.files,...files}});
      row.history.push({at:recordedAt,actor,action:'refund_reversed',reversedDate,reason});
      this.receivables._receipt(row.proposal.receiptId).history.push({
        at:recordedAt,actor,action:'refund_reversed',refundId:id,reversedDate,reason});
      return resultIds(row);
    });
  }
  async reportRefundReturn(id, input) {
    return this.receivables._mutate('refund_return_reported',{...input,refundId:id},async(data,actor)=>{
      const row=this._refund(id);
      need(row.proposal.payout.kind==='STELLAR_TRANSFER'&&row.proposal.payout.walletHandoff!==false,'STELLAR_REFUND_REQUIRED',
        'Report a wallet transaction for a retained Stellar refund request.',409);
      need(typeof input.transaction==='string'&&HEX.test(input.transaction),'INVALID_REFUND_TRANSACTION',
        'Enter the exact 64-character lowercase wallet transaction hash.');
      const note=field(input.note??'','refund transaction note',4000,true),
        existing=row.returns.find(item=>item.transaction===input.transaction);
      if(existing)return resultIds(row,{refundReturnId:existing.id});
      need(row.returns.length<200,'REFUND_RETURN_LIMIT','This refund already retains 200 transaction references.');
      const returned={id:randomUUID(),transaction:input.transaction,note,reportedAt:timestamp(),actor,observations:[]};
      requireUniqueRefundTransfer(data,this.workspace.state.adjustments,row,returned,
        {transaction:returned.transaction,transactionFingerprint:sha(returned.transaction)});
      row.returns.push(returned);
      row.history.push({at:returned.reportedAt,actor,action:'refund_transaction_reported',
        refundReturnId:returned.id,transaction:returned.transaction});
      return resultIds(row,{refundReturnId:returned.id});
    });
  }
  async receiveRefund(id, input) {
    return this.receivables._mutate('refund_received',{...input,refundId:id},async(data,actor)=>{
      const row=this._refund(id),returned=this._return(row,input.returnId),payout=row.proposal.payout;
      need(payout.kind==='STELLAR_TRANSFER','STELLAR_REFUND_REQUIRED','Receive an original Stellar refund request.',409);
      if(row.payoutRecord?.returnId===returned.id||returned.resolvedRefundId)
        return resultIds(row,{refundReturnId:returned.id,...(returned.resolvedRefundId?{resolvedRefundId:returned.resolvedRefundId}:{})});
      need(typeof this.verifyTransfer==='function','NATIVE_REFUND_VERIFIER_REQUIRED',
        'Connect the original Stellar transfer verifier before receiving this refund.',503);
      need(returned.observations.length<200,'REFUND_OBSERVATION_LIMIT','This return already retains 200 original observations.');
      const reference={transaction:returned.transaction,payer:payout.sourceAccount};
      const verification=validatePaymentVerification(payout,reference,
        await this.verifyTransfer({request:clone(payout),returned:clone(reference)}));
      let status=verification.status,error=null,nextRow=null;
      if(status==='FAILED'&&verification.proof.transactionResponse?.status!=='FAILED')status='VERIFICATION_UNAVAILABLE';
      if(status==='VERIFIED'){
        const seconds=value=>Math.floor(Date.parse(value)/1000);
        status=seconds(verification.closedAt)<seconds(row.createdAt)?'TRANSFER_PRECEDES_REQUEST':
          verification.closedAt.slice(0,10)<row.proposal.effectiveDate?'TRANSFER_PRECEDES_FUNDING':
          payout.network==='stellar:testnet'?'TESTNET_VERIFIED':row.refundDate?'ADDITIONAL_TRANSFER':'RECORDED';
        try {
          requireUniqueRefundTransfer(data,this.workspace.state.adjustments,row,returned,verification);
          if(status==='RECORDED'){
            const refundDate=dateValue(verification.closedAt.slice(0,10),'native refund date');
            nextRow={...row,status:'RECORDED',refundDate,accountingDate:refundDate,
              payoutRecord:{kind:'STELLAR_TRANSFER',method:'Stellar refund',reference:returned.transaction,
                transaction:returned.transaction,transactionFingerprint:verification.transactionFingerprint,
                transactionFingerprints:clone(verification.transactionFingerprints),returnId:returned.id,
                network:payout.network,networkPassphrase:payout.networkPassphrase,
                sourceAccount:verification.payer,destination:verification.recipient,asset:clone(verification.asset),
                amountAtomic:verification.amountAtomic,stellarAmount:payout.stellarAmount,memo:clone(verification.memo),
                valuationNote:payout.valuationNote,refundDate,accountingDate:refundDate,ledger:verification.ledger,closedAt:verification.closedAt,
                verificationScope:verification.verificationScope}};
            assertReceiptConservation(this.receivables._receipt(row.proposal.receiptId),
              {...data,refunds:refundRows(data).map(item=>item.id===row.id?nextRow:item)});
          }
        } catch(cause) {
          // Preserve the exact native observation while the operator reconciles its original funds or source conflict.
          if(!['REFUND_REUSES_RECEIPT_TRANSACTION','REFUND_TRANSACTION_ALREADY_ASSIGNED',
            'REFUND_TRANSACTION_ALREADY_ADJUSTED','REFUND_RETURN_ALIAS_REUSED',
            'RECEIPT_ALLOCATION_INVARIANT','RECEIPT_FUNDS_ALREADY_COMMITTED'].includes(cause.code))throw cause;
          status=['RECEIPT_ALLOCATION_INVARIANT','RECEIPT_FUNDS_ALREADY_COMMITTED'].includes(cause.code)?
            'REFUND_FUNDS_CONFLICT':'REFUND_SOURCE_CONFLICT';
          error={code:cause.code,message:cause.message};nextRow=null;
        }
      }
      const recordedAt=timestamp(),observationId=randomUUID(),
        artifact=await this.receivables.paymentRequestWorkspace._retainProof(verification,observationId);
      const compact=compactVerification(verification,artifact),
        observation={id:observationId,recordedAt,actor,status,verification:compact,...(error?{error}: {})};
      const proofName='proof-'+observationId+'.json',
        proofFile={...artifact,type:'application/json; charset=utf-8'};
      let files={...row.files,[proofName]:proofFile};
      if(nextRow){
        nextRow.payoutRecord.proof=clone(compact.proof);
        nextRow.payoutRecord.proofArtifact=clone(artifact);
        files={...files,...await this._retainFiles(refundDocumentFiles(nextRow,'ADVICE'))};
      }
      returned.observations.push(observation);row.files=files;
      row.history.push({at:recordedAt,actor,action:'refund_transaction_observed',
        refundReturnId:returned.id,observationId,transaction:returned.transaction,status,...(error?{error}: {})});
      if(nextRow){
        row.status=nextRow.status;row.refundDate=nextRow.refundDate;row.accountingDate=nextRow.accountingDate;row.payoutRecord=nextRow.payoutRecord;
        row.history.push({at:recordedAt,actor,action:'refund_recorded',refundDate:row.refundDate,accountingDate:row.accountingDate,
          refundReturnId:returned.id,observationId,transaction:returned.transaction});
        this.receivables._receipt(row.proposal.receiptId).history.push({
          at:recordedAt,actor,action:'native_refund_recorded',refundId:id,refundReturnId:returned.id,
          observationId,refundDate:row.refundDate,accountingDate:row.accountingDate,transaction:returned.transaction,amount:row.proposal.amount});
      }
      return resultIds(row,{refundReturnId:returned.id});
    });
  }
  summaries(data=this.data(),asOf=today()) {
    return refundRows(data).map(row=>{immutable(row);return refundSummary(row,data,asOf);});
  }
  summary(id,data=this.data(),asOf=today()) {
    const row=refundRows(data).find(item=>item.id===id);
    need(row,'REFUND_NOT_FOUND','Choose an original customer refund.',404);immutable(row);
    return refundSummary(row,data,asOf);
  }
  dispositionSummary(id,data=this.data()) {
    const row=dispositionRows(data).find(item=>item.id===id);
    need(row,'CREDIT_DISPOSITION_NOT_FOUND','Choose an original customer credit disposition.',404);immutable(row);
    return dispositionSummary(row);
  }
  async refunds(query={}) {
    return this.workspace.serial(async()=>{
      const asOf=dateValue(query.asOf??today(),'report date'),{offset,limit}=page(query);
      if(query.customerId!==undefined)identifier(query.customerId,'customer');
      if(query.receiptId!==undefined)identifier(query.receiptId,'receipt');
      if(query.status!==undefined)field(query.status,'refund status',100);
      const all=this.summaries(this.data(),asOf).filter(row=>(!query.customerId||row.customerId===query.customerId)&&
        (!query.receiptId||row.receiptId===query.receiptId)&&(!query.status||row.status===query.status));
      return clone({schema,revision:this.workspace.state.revision,asOf,total:all.length,offset,limit,refunds:all.slice(offset,offset+limit)});
    });
  }
  _detail(id,query={}) {
    const row=this._refund(id),asOf=dateValue(query.asOf??today(),'report date');
    return clone({schema,revision:this.workspace.state.revision,asOf,refund:refundSummary(row,this.data(),asOf),
      proposal:row.proposal,returns:row.returns,history:row.history,files:fileIdentities(row.files),
      balanceEffects:row.balanceEffects});
  }
  async refund(id,query={}) { return this.workspace.serial(async()=>this._detail(id,query)); }
  async _file(id,name) {
    const row=refundRows(this.data()).find(item=>item.id===id)??dispositionRows(this.data()).find(item=>item.id===id);
    need(row,'REFUND_NOT_FOUND','Choose an original customer funds record.',404);
    identifier(id,'customer funds record');immutable(row);
    if(name==='status.json'){
      const status=row.schema===DISPOSITION_SCHEMA?dispositionSummary(row):refundSummary(row,this.data());
      return {bytes:Buffer.from(json({schema,revision:this.workspace.state.revision,status,history:row.history})),
        name:id+'-status.json',type:'application/json; charset=utf-8'};
    }
    if(name==='receiving.json'){
      need(row.schema===REFUND_SCHEMA,'REFUND_RECEIVING_REQUIRED','Choose an original refund receiving record.',404);
      const returns=[];
      for(const original of row.returns){
        const returned=clone(original);
        for(const observation of returned.observations)
          observation.verification=await this.receivables.paymentRequestWorkspace._proof(observation);
        returns.push(returned);
      }
      const bytes=Buffer.from(json({...this._detail(id),proposalSha256:row.proposalSha256,reviewSha256:row.reviewSha256,
        payoutRecord:row.payoutRecord,returns}));
      need(bytes.length<=128_000_000,'REFUND_RECEIVING_EXPORT_LIMIT',
        'Choose individual original proof files for this refund’s receiving history.');
      return {bytes,name:id+'-receiving.json',type:'application/json; charset=utf-8'};
    }
    need(typeof name==='string'&&Object.hasOwn(row.files,name),'REFUND_FILE_NOT_FOUND','Choose a retained original refund file.',404);
    return {...await this._readRetained(row.files[name]),name:id+'-'+name};
  }
  async refundFile(id,name) { return this.workspace.serial(async()=>this._file(id,name)); }
  async customerFiles(customerId,asOf=today()) {
    dateValue(asOf,'report date');
    const result=[];
    for(const row of refundRows(this.data())){
      if(row.proposal.customerId!==customerId||row.proposal.accountingScope!=='COMMERCIAL')continue;
      const stems=[...(row.refundDate&&(row.accountingDate??row.refundDate)<=asOf?['refund']:[]),
        ...(row.reversedDate&&row.reversedDate<=asOf?['reversal']:[])];
      for(const stem of stems)for(const extension of ['json','html','csv']){
        const name=stem+'.'+extension;
        need(row.files[name],'REFUND_CUSTOMER_DOCUMENT_MISSING','The original customer refund document is missing.',409);
        result.push({...await this._file(row.id,name),name:'documents/'+row.id+'-'+name});
      }
    }
    for(const row of dispositionRows(this.data())){
      if(row.proposal.customerId!==customerId||row.proposal.effectiveDate>asOf)continue;
      for(const extension of ['json','html','csv']){
        const name='disposition.'+extension;
        result.push({...await this._file(row.id,name),name:'documents/'+row.id+'-'+name});
      }
    }
    return result;
  }
}
