// MIT. Merchant-selected credit rules share the original invoice writer and request journal.
import {randomUUID} from 'node:crypto';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {need,field,identifier,currencyOf,currencyKey,today,invoiceSummary,customerSnapshot,sha,json} from './core.mjs';
import {CREDIT_POLICY_SCHEMA,CREDIT_DECISION_SCHEMA,creditPolicyRows,creditDecisionRows,
  normalizeCreditTerms,creditPolicySummary,activeCreditPolicy,currentCreditDecision,creditDecisionSummary,
  assessCustomerCredit,creditAssessmentHash,creditDecisionFiles} from './credit-control.mjs';

const now=()=>new Date().toISOString(),clone=value=>structuredClone(value);
const noReview=()=>({creditReviewRequired:false,creditTriggers:[],creditAssessmentSha256:null,
  creditDecisionId:null,creditDecisionStale:false});
export class CreditControlWorkspace {
  constructor(receivables){this.receivables=receivables;this.workspace=receivables.workspace;}
  workspaceId(){return accountingWorkspaceBinding(this.workspace.directory,this.workspace.state).workspaceId;}
  guard(value){need(value?.workspaceId===this.workspaceId(),'CREDIT_WORKSPACE_CHANGED',
    'Open the original accounting workspace for this retained credit request.',409);}
  policyRow(id){
    identifier(id,'customer credit policy');
    const row=creditPolicyRows(this.receivables.data()).find(item=>item.id===id);
    need(row,'CREDIT_POLICY_NOT_FOUND','Choose a saved customer credit policy.',404);return row;
  }
  decisionRow(id){
    identifier(id,'customer credit decision');
    const row=creditDecisionRows(this.receivables.data()).find(item=>item.id===id);
    need(row,'CREDIT_DECISION_NOT_FOUND','Choose a retained customer credit decision.',404);return row;
  }
  calculate(invoiceId){
    const invoice=this.receivables._invoice(invoiceId),customer=this.receivables._customer(invoice.draft.customerId);
    // Release always uses the current account date, independently of historical report filters.
    const assessment=assessCustomerCredit(this.receivables.data(),invoice,customer,today());
    const workspaceId=this.workspaceId();
    return {workspaceId,revision:this.workspace.state.revision,assessment,
      assessmentSha256:creditAssessmentHash(assessment,workspaceId),
      invoicePreview:{previewSha256:assessment.source.previewSha256,expectedVersion:invoice.version}};
  }
  metadata(preview){
    const current=currentCreditDecision(this.receivables.data(),preview.assessment.invoiceId);
    const matching=Boolean(current&&current.workspaceId===preview.workspaceId&&
      current.assessmentSha256===preview.assessmentSha256);
    const declined=matching&&current.status==='DECLINED';
    return {creditReviewRequired:preview.assessment.reviewRequired||Boolean(declined),
      creditTriggers:[...clone(preview.assessment.triggers),...(declined?[{code:'OPERATOR_DECLINED',
        message:'The current operator decision declined this invoice release.'}]:[])],
      creditAssessmentSha256:preview.assessmentSha256,
      creditDecisionId:matching&&current.status==='APPROVED'?current.id:null,
      creditDecisionStale:Boolean(current&&!matching)};
  }
  previewMetadata(invoiceId){
    const invoice=this.receivables._invoice(invoiceId);
    const policy=activeCreditPolicy(this.receivables.data(),invoice.draft.customerId,invoice.draft.currency);
    return policy?.terms.enabled?this.metadata(this.calculate(invoiceId)):noReview();
  }
  fail(code,message,preview){
    throw Object.assign(new Error(message),{code,status:409,details:{
      workspaceId:preview.workspaceId,revision:preview.revision,
      ...this.metadata(preview),assessment:clone(preview.assessment),
      assessmentSha256:preview.assessmentSha256,invoicePreview:clone(preview.invoicePreview)}});
  }
  result(record){
    const result={workspaceId:this.workspaceId()};
    if(record.creditPolicyId){
      const row=this.policyRow(record.creditPolicyId);
      result.creditPolicy=creditPolicySummary(row);
      if(record.creditPolicyVersion)result.creditPolicyEdition=clone(row.editions.find(item=>item.version===record.creditPolicyVersion));
    }
    if(record.creditDecisionId)result.creditDecision=clone(this.decisionRow(record.creditDecisionId));
    if(record.creditRelease)result.creditRelease=clone(record.creditRelease);
    return result;
  }
  async control(query={}){
    return this.workspace.serial(async()=>{
      if(query.customerId)this.receivables._customer(query.customerId);
      const data=this.receivables.data(),asOf=today(),search=String(query.search??'').trim().toLowerCase();
      const matching=(row,fields)=> (!query.customerId||row.customerId===query.customerId)&&
        (!search||fields.some(value=>String(value??'').toLowerCase().includes(search)));
      const policies=creditPolicyRows(data).map(creditPolicySummary)
        .filter(row=>matching(row,[row.id,row.customerName,row.owner,row.currency.code]))
        .sort((a,b)=>a.customerName.localeCompare(b.customerName)||currencyKey(a.currency).localeCompare(currencyKey(b.currency)));
      const drafts=data.invoices.filter(row=>row.status==='DRAFT').map(row=>({...invoiceSummary(row,data,asOf),purchaseOrder:row.draft.purchaseOrder||''}))
        .filter(row=>matching(row,[row.id,row.customerName,row.currency.code,row.purchaseOrder]))
        .sort((a,b)=>a.customerName.localeCompare(b.customerName)||a.id.localeCompare(b.id));
      const decisions=creditDecisionRows(data).map(creditDecisionSummary)
        .filter(row=>matching(row,[row.id,row.invoiceId,row.customerName,row.actor,row.reason,row.issuedNumber,row.purchaseOrder]))
        .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
      const customers=this.workspace.state.customerStatements.customers.map(customerSnapshot)
        .filter(row=>!query.customerId||row.id===query.customerId)
        .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
      return clone({workspaceId:this.workspaceId(),revision:this.workspace.state.revision,asOf,customers,policies,drafts,decisions});
    });
  }
  async policy(id){
    return this.workspace.serial(async()=>{
      const row=this.policyRow(id);
      return {workspaceId:this.workspaceId(),revision:this.workspace.state.revision,policy:creditPolicySummary(row),
        editions:clone(row.editions),history:clone(row.history)};
    });
  }
  async savePolicy(value){
    this.guard(value);
    return this.receivables._mutate('credit_policy_saved',value,async(data,actor)=>{
      const customer=this.receivables._customer(value.customerId),currency=currencyOf(value.currency);
      const terms=normalizeCreditTerms(value.terms,currency),owner=field(value.owner,'policy owner',300);
      const reason=field(value.reason,'policy change reason',3000);
      let row=value.id?this.policyRow(value.id):null;
      if(row){
        need(value.expectedVersion===row.version,'STALE_CREDIT_POLICY',
          'Open the current customer policy before saving this edit.',409);
        need(row.customerId===customer.id&&currencyKey(row.currency)===currencyKey(currency),'CREDIT_POLICY_IDENTITY_CHANGED',
          'Keep this original policy with its customer and currency. Create a separate policy for a different account.',409);
      }else{
        need(!activeCreditPolicy(data,customer.id,currency),'CREDIT_POLICY_EXISTS',
          'Edit the existing policy for this customer and currency.',409);
      }
      const timestamp=now();
      if(!row){
        row={schema:CREDIT_POLICY_SCHEMA,id:randomUUID(),version:0,customerId:customer.id,
          customerName:customer.name,currency,owner,terms,createdAt:timestamp,updatedAt:timestamp,editions:[],history:[]};
        (data.creditPolicies??=[]).push(row);
      }
      row.version++;Object.assign(row,{customerName:customer.name,owner,terms,updatedAt:timestamp});
      row.editions.push({version:row.version,createdAt:timestamp,actor,reason,customerId:row.customerId,
        customerName:row.customerName,currency:clone(row.currency),owner,terms:clone(terms)});
      row.history.push({kind:row.version===1?'POLICY_CREATED':'POLICY_CHANGED',at:timestamp,actor,reason,
        version:row.version,enabled:terms.enabled});
      return {creditPolicyId:row.id,creditPolicyVersion:row.version};
    });
  }
  async preview(invoiceId,value){
    return this.workspace.serial(async()=>{this.guard(value);return this.calculate(invoiceId);});
  }
  async saveDecision(invoiceId,value){
    this.guard(value);identifier(invoiceId,'invoice');
    return this.receivables._mutate('credit_decision_saved',{...value,invoiceId},async(data,actor)=>{
      const preview=this.calculate(invoiceId);
      if(!preview.assessment.policy?.terms.enabled)this.fail('CREDIT_POLICY_DISABLED',
        'Enable an explicit customer policy before recording a credit-release decision.',preview);
      if(value.assessmentSha256!==preview.assessmentSha256)this.fail('CREDIT_ASSESSMENT_CHANGED',
        'The draft, account date or customer account changed. Review the current assessment before saving a decision.',preview);
      need(['APPROVE','DECLINE'].includes(value.outcome),'INVALID_CREDIT_DECISION','Choose approve or decline.');
      const reason=field(value.reason,'credit decision reason',3000),timestamp=now(),id=randomUUID();
      for(const row of creditDecisionRows(data).filter(item=>item.invoiceId===invoiceId&&['APPROVED','DECLINED'].includes(item.status))){
        row.status='SUPERSEDED';row.version++;row.updatedAt=timestamp;row.supersededById=id;
        row.history.push({kind:'SUPERSEDED',at:timestamp,actor,reason:'Replaced by a new operator decision.',supersededById:id});
      }
      const decision={schema:CREDIT_DECISION_SCHEMA,id,invoiceId,workspaceId:preview.workspaceId,version:1,
        outcome:value.outcome,status:value.outcome==='APPROVE'?'APPROVED':'DECLINED',
        createdAt:timestamp,updatedAt:timestamp,actor,reason,sourceRevision:preview.revision,
        assessmentSha256:preview.assessmentSha256,assessment:clone(preview.assessment),
        history:[{kind:value.outcome==='APPROVE'?'APPROVED':'DECLINED',at:timestamp,actor,reason}]};
      (data.creditDecisions??=[]).push(decision);
      return {creditDecisionId:decision.id};
    });
  }
  async detail(id){
    return this.workspace.serial(async()=>{
      const row=this.decisionRow(id),invoice=this.receivables._invoice(row.invoiceId);
      const current=invoice.status==='DRAFT'?this.calculate(invoice.id):null;
      const metadata=current?this.metadata(current):null;
      const canRelease=Boolean(current?.assessment.policy?.terms.enabled&&row.status==='APPROVED'&&metadata.creditDecisionId===row.id);
      let releaseReason;
      if(canRelease)releaseReason='The saved approval matches the current draft, customer policy and account date.';
      else if(row.status==='CONSUMED')releaseReason='This decision released original invoice '+row.issuedNumber+'.';
      else if(invoice.status==='VOID')releaseReason='The original invoice was voided. Create a replacement draft for a new credit assessment.';
      else if(invoice.status!=='DRAFT')releaseReason='The original invoice has already been issued.';
      else if(row.status!=='APPROVED')releaseReason='Only the current approved decision can release the original invoice.';
      else if(!current.assessment.policy?.terms.enabled)releaseReason='The merchant disabled this customer policy; ordinary invoice issue is available.';
      else releaseReason='The draft, customer policy or current account basis changed. Review and save a new decision.';
      return {workspaceId:this.workspaceId(),revision:this.workspace.state.revision,decision:clone(row),
        assessment:clone(row.assessment),currentAssessment:current?clone(current.assessment):null,
        currentAssessmentSha256:current?.assessmentSha256??null,canRelease,releaseReason,
        invoicePreview:current?{...clone(current.invoicePreview),...metadata}:null};
    });
  }
  async withdraw(id,value){
    this.guard(value);identifier(id,'customer credit decision');
    return this.receivables._mutate('credit_decision_withdrawn',{...value,creditDecisionId:id},async(data,actor)=>{
      const row=this.decisionRow(id);
      need(value.expectedVersion===row.version,'STALE_CREDIT_DECISION','Open the current decision before withdrawing it.',409);
      need(['APPROVED','DECLINED'].includes(row.status),'CREDIT_DECISION_FINAL','Choose a current approval or decline to withdraw.',409);
      const reason=field(value.reason,'withdrawal reason',3000),timestamp=now();
      row.status='WITHDRAWN';row.version++;row.updatedAt=timestamp;
      row.history.push({kind:'WITHDRAWN',at:timestamp,actor,reason});
      return {creditDecisionId:row.id};
    });
  }
  async file(id,name){
    return this.workspace.serial(async()=>{
      const file=creditDecisionFiles(this.decisionRow(id)).find(item=>item.name===name);
      need(file,'CREDIT_DECISION_FILE_NOT_FOUND','Choose the retained decision JSON, HTML or manifest.',404);return file;
    });
  }
  async operation(requestId){
    return this.workspace.serial(async()=>{
      const id=field(requestId,'request ID',160);
      const saved=this.receivables.data().requests.find(row=>row.id===id&&
        (row.action.startsWith('credit_policy_')||row.action.startsWith('credit_decision_')||
         row.action==='invoice_issued'&&row.result.creditRelease));
      return {workspaceId:this.workspaceId(),revision:this.workspace.state.revision,operation:saved?clone(saved):null,
        ...(saved?this.receivables._result(saved.result):{})};
    });
  }
  checkIssue(invoiceId,value){
    // Called only inside the original mutation callback, after request-journal replay.
    const invoice=this.receivables._invoice(invoiceId);
    const policy=activeCreditPolicy(this.receivables.data(),invoice.draft.customerId,invoice.draft.currency);
    if(!policy?.terms.enabled&&!value.creditDecisionId)return null;
    const preview=this.calculate(invoiceId),metadata=this.metadata(preview);
    if(!policy?.terms.enabled)this.fail('CREDIT_POLICY_DISABLED',
      'The merchant changed this policy. Review the current invoice and issue with its current selected policy.',preview);
    let decision=null;
    if(value.creditDecisionId){
      identifier(value.creditDecisionId,'customer credit decision');
      decision=creditDecisionRows(this.receivables.data()).find(row=>row.id===value.creditDecisionId);
      if(!decision||decision.invoiceId!==invoiceId||decision.workspaceId!==preview.workspaceId||
        decision.status!=='APPROVED'||metadata.creditDecisionId!==decision.id)
        this.fail('CREDIT_DECISION_STALE',
          'This approval no longer matches the current draft, policy and account date. Review the current assessment.',preview);
    }else if(metadata.creditReviewRequired)this.fail('CREDIT_REVIEW_REQUIRED',
      'The selected customer policy requires an operator decision before issuing this invoice.',preview);
    return {preview,decisionId:decision?.id??null};
  }
  consumeIssue(check,invoice,actor){
    if(!check)return {};
    // Original document retention succeeded. Invoice and decision commit together in the sole ledger writer.
    const timestamp=now(),a=check.preview.assessment;
    const creditRelease={schema:'stellar-forge.merchant-credit-release.v1',asOf:a.asOf,assessedAt:timestamp,
      policyId:a.policy.id,policyVersion:a.policy.version,assessmentSha256:check.preview.assessmentSha256,
      exposure:clone(a.exposure),triggerCodes:a.triggers.map(row=>row.code),creditDecisionId:check.decisionId};
    invoice.creditControl=clone(creditRelease);
    invoice.history.at(-1).creditControl=clone(creditRelease);
    if(check.decisionId){
      const row=this.decisionRow(check.decisionId);
      row.status='CONSUMED';row.version++;row.updatedAt=timestamp;row.consumedAt=timestamp;
      row.issuedInvoiceId=invoice.id;row.issuedNumber=invoice.number;row.issuedDocumentSha256=sha(json(invoice.document));
      row.history.push({kind:'CONSUMED',at:timestamp,actor,reason:'Released the original invoice in the same ledger commit.',
        invoiceId:invoice.id,invoiceNumber:invoice.number,documentSha256:row.issuedDocumentSha256});
    }
    return {creditRelease,...(check.decisionId?{creditDecisionId:check.decisionId}:{})};
  }
}
