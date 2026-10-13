// MIT. The maintained accounting workspace owns its original customers, invoices and plans.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const need=(condition,message)=>{if(!condition)throw new Error(message);};

/**
 * Continue the same original case using saved selections and native request journals.
 * readSaved returns parsed JSON for .json artifacts and original text for other files.
 * requestFor saves a stable request ID before a mutation is dispatched.
 */
export async function prepareOriginalAccountingCase({service,client,sourceRoot,config,save,actor,
  readSaved=async()=>undefined,requestFor}){
  const accounting=service.accounting;
  if(!accounting)return {status:'native-source-selection',reason:'Select the receiving host’s actual maintained accounting directory.'};
  const root=join(sourceRoot,'stellar/scf-starforge-20261009/merchant-settlement-accounting');
  const carbonRoot=join(sourceRoot,'stellar/scf-starforge-20261009/partners/stellarcarbon-statements');
  const [{ReceivablesClient},{PaymentPlansClient},core,{accountingWorkspaceBinding},{digest},{invoiceDraftForStatement,canonical}]=await Promise.all([
    import(pathToFileURL(join(root,'receivables/client.mjs')).href),
    import(pathToFileURL(join(root,'receivables/payment-plans/client.mjs')).href),
    import(pathToFileURL(join(root,'receivables/core.mjs')).href),
    import(pathToFileURL(join(root,'workspace/binding.mjs')).href),
    import(pathToFileURL(join(carbonRoot,'store.mjs')).href),
    import(pathToFileURL(join(carbonRoot,'engine.mjs')).href),
  ]);
  const binding=accountingWorkspaceBinding(accounting.workspace.directory,accounting.workspace.state);
  const transport={baseUrl:new URL('/api/receivables',service.url).href,
    expectedWorkspaceId:binding.workspaceId,expectedSourcesSha256:binding.sourcesSha256};
  const receivables=new ReceivablesClient(transport);
  const plans=new PaymentPlansClient({...transport,baseUrl:new URL('/api/receivables/payment-plans',service.url).href});
  const keep=async(path,create)=>{
    const prior=await readSaved(path);
    if(prior!==undefined)return prior;
    const value=await create();await save(path,value);return value;
  };
  const checkBinding=value=>{
    if(value)need(value.workspaceId===binding.workspaceId&&value.sourcesSha256===binding.sourcesSha256,
      'Continue the case in its original maintained accounting workspace and source binding.');
  };
  const original=await receivables.state();
  const initial=await keep('accounting/original-case-selection.json',()=>({
    directory:accounting.workspace.directory,binding,
    customers:original.customers.map(row=>({id:row.id,reference:row.reference,name:row.name})),
    invoiceCount:original.invoices.length,
  }));
  checkBinding(initial.binding);
  const selectedBefore=await readSaved('accounting/selected-original-case.json');
  checkBinding(selectedBefore?.accountingBinding);
  const originalConfig=await readSaved('accounting/case-input.json');
  if(originalConfig){
    checkBinding(originalConfig.accountingBinding);
    if(config)for(const [key,value] of Object.entries(config))need(canonical(value)===canonical(originalConfig.config[key]),
      'Keep the original saved accounting case selection while continuing it: '+key+'.');
    config=originalConfig.config;
  }else if(selectedBefore){
    const {accountingCustomerId,accountingBinding,...value}=selectedBefore;
    const legacy={...value,customerId:accountingCustomerId};
    if(config)for(const key of ['customerId','carbonCustomerId','statementId','statementVersion','invoice','plan']){
      if(config[key]!==undefined&&legacy[key]!==undefined)need(canonical(config[key])===canonical(legacy[key]),
        'Keep the original retained accounting selection: '+key+'.');
    }
    config={...legacy,...(config||{}),customerId:accountingCustomerId};
  }
  if(!config)return {status:'case-selection-ready',...initial};
  need(typeof config==='object'&&!Array.isArray(config),'Use an original accounting-case configuration object.');
  await keep('accounting/case-input.json',()=>({config,accountingBinding:binding,actor}));
  const carbonState=await service.workspace.snapshot();
  const customer=carbonState.customers.find(row=>row.id===(config.carbonCustomerId||'recipient-gc53'));
  need(customer,'Choose the retained source customer for this accounting case.');
  if(selectedBefore)need(selectedBefore.carbonCustomerId===customer.id,
    'Continue with the originally selected source customer.');
  const stableRequest=async(key,value)=>{
    const intent={accountingWorkspaceId:binding.workspaceId,carbonWorkspaceId:carbonState.workspaceId,value};
    if(requestFor)return requestFor('accounting:'+key,intent);
    return 'carbon-receiving-'+createHash('sha256').update(canonical({key,intent})).digest('hex');
  };
  let selectedId=selectedBefore?.accountingCustomerId||config.customerId;
  if(selectedBefore&&config.customerId)need(config.customerId===selectedId,'Keep the originally selected accounting customer.');
  let selected=selectedId?original.customers.find(row=>row.id===selectedId):
    original.customers.find(row=>row.reference===customer.reference);
  if(!selected&&config.createCustomerFromRecipient===true&&!selectedId){
    const intent=await keep('accounting/customer-create-request.json',()=>({actor,
      value:{reference:customer.reference,name:customer.name,email:'',address:'',
        note:'Operator grouping of the exact retained Stellarcarbon recipient. '+customer.note}}));
    // The native customer controller enforces unique references. Re-read that
    // original identity before create; it does not have a mutation request journal.
    const current=await receivables.state();
    selected=current.customers.find(row=>row.reference===intent.value.reference);
    if(!selected){
      const created=await accounting.receivables.saveCustomer({...intent.value,revision:current.revision,
        requestId:await stableRequest('customer-create',intent),actor:intent.actor});
      selected=created.customer;
    }
  }
  if(!selected)return {status:'case-selection-ready',...initial,carbonCustomerId:customer.id,sourceReference:customer.reference};
  const {customerId:createIgnored,createCustomerFromRecipient:flagIgnored,...retainedSelection}=config;
  await keep('accounting/selected-original-case.json',()=>({...retainedSelection,accountingCustomerId:selected.id,
    carbonCustomerId:customer.id,accountingBinding:binding}));
  let state=await client.state();
  const currentCustomer=state.customers.find(row=>row.id===customer.id);
  let customerLink=await readSaved('accounting/customer-link-request.json');
  if(customerLink||currentCustomer.merchantCustomerId!==selected.id){
    customerLink=await keep('accounting/customer-link-request.json',()=>({actor,
      value:{...currentCustomer,merchantCustomerId:selected.id,expectedVersion:currentCustomer.version}}));
    await client.apply('customer',customerLink.value,{revision:state.revision,
      requestId:await stableRequest('customer-link',customerLink),actor:customerLink.actor});
  }
  state=await client.state();
  const statementId=config.statementId||'statement-november-2025';
  const saved=state.statements.find(row=>row.id===statementId);
  need(saved,'Choose the original saved statement for the selected source customer.');
  const invoiceSelection=await readSaved('accounting/proposed-invoice-selection.json');
  if(invoiceSelection)need(invoiceSelection.statementId===statementId&&
    (!config.invoice||canonical(invoiceSelection.selection)===canonical(config.invoice)),
    'Continue the invoice with its original saved statement and billing selection.');
  let statementSelection=await readSaved('accounting/statement-selection.json');
  if(statementSelection)need(statementSelection.statementId===statementId&&statementSelection.accountingCustomerId===selected.id,
    'Keep the original statement and accounting customer for this case.');
  let version=statementSelection?.version||invoiceSelection?.statementVersion||config.statementVersion;
  if(!version&&config.invoice){
    // A legacy process can stop after saveDraft but before saving its invoice-link
    // artifact. Recover the exact native request journal for each saved version.
    const full=await service.workspace.snapshot();
    const data=await accounting.workspace.serial(()=>structuredClone(accounting.receivables.data()));
    const matches=[];
    for(const item of saved.versions){
      const report=full.statements.find(row=>row.id===statementId)?.versions.find(row=>row.version===item.version);
      if(report?.customer?.merchantCustomerId!==selected.id||report.spec.customerId!==customer.id)continue;
      const hex=digest({workspaceId:full.workspaceId,statementId,version:item.version,accountingWorkspaceId:binding.workspaceId});
      const originalRequestId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
      const entry=data.requests.find(row=>row.id===originalRequestId),invoice=data.invoices.find(row=>row.id===entry?.result?.invoiceId);
      if(invoice&&canonical(core.normalizeDraft(invoice.draft))===canonical(core.normalizeDraft(
        invoiceDraftForStatement(full,statementId,{...config.invoice,statementVersion:item.version}))))
        matches.push({version:item.version,invoiceId:invoice.id,originalRequestId});
    }
    if(matches.length){
      const latest=matches.find(row=>row.version===saved.versions.at(-1).version);
      need(matches.length===1||latest,'Choose the original saved statement version among the retained accounting requests.');
      const match=latest||matches[0];version=match.version;
      await keep('accounting/recovered-invoice-request.json',()=>({statementId,...match,accountingBinding:binding}));
    }
  }
  let report=await client.statement(statementId,version||saved.versions.at(-1).version);
  need(report.spec.customerId===customer.id,'Keep the statement with its selected original source customer.');
  let statementRequest=await readSaved('accounting/statement-request.json');
  if(!statementSelection&&(statementRequest||report.customer.merchantCustomerId!==selected.id)){
    statementRequest=await keep('accounting/statement-request.json',()=>({actor,
      value:{...report.spec,id:statementId,expectedVersion:saved.versions.length}}));
    state=await client.state();
    const applied=await client.apply('statement',statementRequest.value,{revision:state.revision,
      requestId:await stableRequest('statement',statementRequest),actor:statementRequest.actor});
    report=await client.statement(statementId,applied.version.version);
  }
  need(report.customer.merchantCustomerId===selected.id,'Keep the saved statement linked to the selected accounting customer.');
  statementSelection=await keep('accounting/statement-selection.json',()=>({
    statementId,version:report.version,accountingCustomerId:selected.id,carbonCustomerId:customer.id,
  }));
  const result={status:'original-case-linked',directory:accounting.workspace.directory,binding,
    accountingCustomerId:selected.id,carbonCustomerId:customer.id,statementId,statementVersion:report.version};
  if(config.invoice){
    const value=config.invoice;
    need(typeof value.amount==='string'&&value.currency&&value.issueDate&&value.dueDate,
      'The proposed invoice requires its selected fee, currency and operator draft dates.');
    const intent=await keep('accounting/invoice-link-request.json',()=>({actor,statementId,
      value:{...value,statementVersion:report.version}}));
    state=await client.state();
    const linked=await client.invoice(statementId,intent.value,{revision:state.revision,
      requestId:await stableRequest('invoice-link',intent),actor:intent.actor});
    const invoiceId=linked.invoice.invoiceId,detail=await receivables.detail(invoiceId);
    const expectedDraft=core.normalizeDraft(invoiceDraftForStatement(await service.workspace.snapshot(),statementId,intent.value));
    need(canonical(core.normalizeDraft(detail.draft))===canonical(expectedDraft),
      'The original linked invoice has different billing content; keep its current native case and saved receiving selection.');
    await keep('accounting/linked-invoice-record.json',()=>detail);
    result.invoiceId=invoiceId;result.invoiceStatus=detail.invoice.status;
    if(detail.invoice.status==='DRAFT'){
      const preview=await receivables.preview(invoiceId);
      const selectedPreview=await keep('accounting/proposed-invoice-selection.json',()=>({statementId,statementVersion:report.version,
        previewSha256:preview.previewSha256,originalRequestId:linked.invoice.originalRequestId,selection:value}));
      need(selectedPreview.previewSha256===preview.previewSha256,'The selected original draft preview changed during receiving.');
      await keep('accounting/proposed-invoice.json',()=>preview.document);
      await keep('accounting/proposed-invoice.html',()=>core.renderDocumentHtml(preview.document));
      await keep('accounting/proposed-invoice.csv',()=>core.renderLinesCsv(preview.document));
      result.status='draft-prepared';result.previewSha256=preview.previewSha256;
    }else{
      for(const name of ['invoice.json','invoice.html','invoice.csv']){
        await keep('accounting/retained-'+name,async()=>{const response=await receivables.file(invoiceId,name);return response.text();});
      }
    }
  }
  const originalPlans=await keep('accounting/original-payment-plans.json',()=>plans.state({customerId:selected.id}));
  result.existingPlans=originalPlans.plans.map(row=>({id:row.id,status:row.status}));
  for(const row of originalPlans.plans){
    const detail=await keep('accounting/payment-plans/'+row.id+'/plan.json',()=>plans.detail(row.id));
    for(const edition of detail.editions)for(const name of ['schedule.json','schedule.html','schedule.csv','manifest.json']){
      await keep('accounting/payment-plans/'+row.id+'/'+edition.id+'/'+name,async()=>{
        const response=await plans.scheduleFile(row.id,edition.id,name);return response.text();
      });
    }
  }
  if(config.plan){
    const input=config.plan,invoice=await receivables.detail(input.invoiceId);
    need(invoice.invoice.customerId===selected.id&&invoice.invoice.status==='ISSUED'&&invoice.document,
      'Prepare a schedule only for the selected customer’s existing original issued invoice.');
    let review=await readSaved('accounting/proposed-payment-schedule.json');
    let planSelection=await readSaved('accounting/payment-plan-request.json');
    if(!review){
      if(!planSelection){
        const generated=await plans.generate(input);
        const data=await accounting.workspace.serial(()=>structuredClone(accounting.receivables.data()));
        const originalIds=new Set(originalPlans.plans.map(row=>row.id));
        const candidates=(data.paymentPlans?.plans||[]).filter(row=>!originalIds.has(row.id)&&row.invoiceId===input.invoiceId&&
          canonical(row.draft)===canonical(generated.draft));
        need(candidates.length<=1,'Recover the original selected payment schedule from its saved native request.');
        planSelection=await keep('accounting/payment-plan-request.json',()=>({actor,input,plan:generated.draft,
          workspaceId:binding.workspaceId,existingPlanId:candidates[0]?.id||null}));
      }
      need(canonical(planSelection.input)===canonical(input),'Keep the original saved installment-generation selection.');
      let planId=planSelection.existingPlanId;
      if(!planId){
        const state=await plans.state({customerId:selected.id});
        const intent={plan:planSelection.plan,workspaceId:binding.workspaceId,actor:planSelection.actor};
        const savedPlan=await plans.savePlan({...intent,revision:state.revision,
          requestId:await stableRequest('payment-plan',intent)});
        planId=savedPlan.plan.id;
      }
      review=await keep('accounting/proposed-payment-schedule.json',()=>plans.previewPlan(planId));
    }
    need(review.source.invoiceId===input.invoiceId&&review.source.customer.id===selected.id,
      'Keep the schedule with its original issued invoice and customer.');
    const current=await plans.previewPlan(review.planId);
    need(current.reviewSha256===review.reviewSha256,'The original proposed schedule changed during receiving.');
    result.planDraft={id:review.planId,version:review.planVersion,reviewSha256:review.reviewSha256};
  }
  await keep('accounting/case-result.json',()=>result);
  return result;
}
