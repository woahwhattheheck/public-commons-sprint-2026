// MIT. The maintained accounting workspace owns its original customers, invoices and plans.
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function prepareOriginalAccountingCase({service,client,sourceRoot,config,save,actor}){
  const accounting=service.accounting;
  if(!accounting)return {status:'native-source-selection',reason:'Select the receiving host’s actual maintained accounting directory.'};
  const root=join(sourceRoot,'stellar/scf-starforge-20261009/merchant-settlement-accounting');
  const [{ReceivablesClient},{PaymentPlansClient},core,{accountingWorkspaceBinding}]=await Promise.all([
    import(pathToFileURL(join(root,'receivables/client.mjs')).href),
    import(pathToFileURL(join(root,'receivables/payment-plans/client.mjs')).href),
    import(pathToFileURL(join(root,'receivables/core.mjs')).href),
    import(pathToFileURL(join(root,'workspace/binding.mjs')).href),
  ]);
  const binding=accountingWorkspaceBinding(accounting.workspace.directory,accounting.workspace.state);
  const transport={baseUrl:new URL('/api/receivables',service.url).href,
    expectedWorkspaceId:binding.workspaceId,expectedSourcesSha256:binding.sourcesSha256};
  const receivables=new ReceivablesClient(transport);
  const plans=new PaymentPlansClient({...transport,baseUrl:new URL('/api/receivables/payment-plans',service.url).href});
  const original=await receivables.state();
  const initial={directory:accounting.workspace.directory,binding,
    customers:original.customers.map(row=>({id:row.id,reference:row.reference,name:row.name})),
    invoiceCount:original.invoices.length};
  await save('accounting/original-case-selection.json',initial);
  if(!config)return {status:'case-selection-ready',...initial};
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Use an original accounting-case configuration object.');
  const carbonState=await service.workspace.snapshot();
  const customer=carbonState.customers.find(row=>row.id===(config.carbonCustomerId||'recipient-gc53'));
  if(!customer)throw new Error('Choose the retained source customer for this accounting case.');
  let selected=config.customerId?original.customers.find(row=>row.id===config.customerId):
    original.customers.find(row=>row.reference===customer.reference);
  if(!selected&&config.createCustomerFromRecipient===true){
    const created=await accounting.receivables.saveCustomer({revision:original.revision,requestId:randomUUID(),actor,
      reference:customer.reference,name:customer.name,email:'',address:'',
      note:'Operator grouping of the exact retained Stellarcarbon recipient. '+customer.note});
    selected=created.customer;
  }
  if(!selected)return {status:'case-selection-ready',...initial,carbonCustomerId:customer.id,sourceReference:customer.reference};
  const {customerId:createIgnored,createCustomerFromRecipient:flagIgnored,...retainedSelection}=config;
  await save('accounting/selected-original-case.json',{...retainedSelection,accountingCustomerId:selected.id,
    carbonCustomerId:customer.id,accountingBinding:binding});
  let state=await client.state();
  const currentCustomer=state.customers.find(row=>row.id===customer.id);
  if(currentCustomer.merchantCustomerId!==selected.id){
    await client.apply('customer',{...currentCustomer,merchantCustomerId:selected.id,expectedVersion:currentCustomer.version},
      {revision:state.revision,requestId:randomUUID(),actor});
  }
  state=await client.state();
  const statementId=config.statementId||'statement-november-2025';
  const saved=state.statements.find(row=>row.id===statementId);
  if(!saved)throw new Error('Choose the original saved statement for the selected source customer.');
  let report=await client.statement(statementId,config.statementVersion||saved.versions.at(-1).version);
  if(report.spec.customerId!==customer.id)throw new Error('Keep the statement with its selected original source customer.');
  if(report.customer.merchantCustomerId!==selected.id){
    await client.apply('statement',{...report.spec,id:statementId,expectedVersion:saved.versions.length},
      {revision:state.revision,requestId:randomUUID(),actor});
    report=await client.statement(statementId);
  }
  const result={status:'original-case-linked',directory:accounting.workspace.directory,binding,
    accountingCustomerId:selected.id,carbonCustomerId:customer.id,statementId,statementVersion:report.version};
  if(config.invoice){
    const value=config.invoice;
    if(typeof value.amount!=='string'||!value.currency||!value.issueDate||!value.dueDate)
      throw new Error('The proposed invoice requires its selected fee, currency and operator draft dates.');
    state=await client.state();
    const linked=await client.invoice(statementId,{...value,statementVersion:report.version},
      {revision:state.revision,requestId:randomUUID(),actor});
    const invoiceId=linked.invoice.invoiceId;
    const detail=await receivables.detail(invoiceId);
    await save('accounting/linked-invoice-record.json',detail);
    result.invoiceId=invoiceId;result.invoiceStatus=detail.invoice.status;
    if(detail.invoice.status==='DRAFT'){
      const preview=await receivables.preview(invoiceId);
      await save('accounting/proposed-invoice.json',preview.document);
      await save('accounting/proposed-invoice.html',core.renderDocumentHtml(preview.document));
      await save('accounting/proposed-invoice.csv',core.renderLinesCsv(preview.document));
      await save('accounting/proposed-invoice-selection.json',{statementId,statementVersion:report.version,
        previewSha256:preview.previewSha256,originalRequestId:linked.invoice.originalRequestId,selection:value});
      result.status='draft-prepared';result.previewSha256=preview.previewSha256;
    }else{
      for(const name of ['invoice.json','invoice.html','invoice.csv']){
        const response=await receivables.file(invoiceId,name);await save('accounting/retained-'+name,await response.text());
      }
    }
  }
  const currentPlans=await plans.state({customerId:selected.id});
  await save('accounting/original-payment-plans.json',currentPlans);
  result.existingPlans=currentPlans.plans.map(row=>({id:row.id,status:row.status}));
  for(const row of currentPlans.plans){
    const detail=await plans.detail(row.id);await save('accounting/payment-plans/'+row.id+'/plan.json',detail);
    for(const edition of detail.editions)for(const name of ['schedule.json','schedule.html','schedule.csv','manifest.json']){
      const response=await plans.scheduleFile(row.id,edition.id,name);
      await save('accounting/payment-plans/'+row.id+'/'+edition.id+'/'+name,await response.text());
    }
  }
  if(config.plan){
    const input=config.plan,invoice=await receivables.detail(input.invoiceId);
    if(invoice.invoice.customerId!==selected.id||invoice.invoice.status!=='ISSUED'||!invoice.document)
      throw new Error('Prepare a schedule only for the selected customer’s existing original issued invoice.');
    const generated=await plans.generate(input);
    const savedPlan=await plans.savePlan({plan:generated.draft,revision:generated.revision,
      workspaceId:binding.workspaceId,requestId:randomUUID(),actor});
    const review=await plans.previewPlan(savedPlan.plan.id);
    await save('accounting/proposed-payment-schedule.json',review);
    result.planDraft={id:savedPlan.plan.id,version:savedPlan.plan.version,reviewSha256:review.reviewSha256};
  }
  await save('accounting/case-result.json',result);
  return result;
}
